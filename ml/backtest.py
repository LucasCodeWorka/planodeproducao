"""
Backtest for Jan-Apr 2026 comparing official projection, ML projection, and actual sales.
"""
from __future__ import annotations

import calendar
import json
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg2

from config import COMPANY_ID, DATA_DIR, DB_CONFIG, OUTPUT_DIR, TRAIN_END
from predict import build_group_feature_row, build_sku_feature_row
from train import FEATURES_CURVE_A, FEATURES_CURVE_B, FEATURES_GROUP, make_regressor


BACKTEST_YEAR = 2026
BACKTEST_MONTHS = [1, 2, 3, 4]
BACKTEST_END_DATE = pd.Timestamp("2026-04-24")
OFFICIAL_PROJECTIONS_PATH = Path(__file__).resolve().parent.parent / "data" / "projecoes.json"


def get_connection():
    return psycopg2.connect(**DB_CONFIG)


def elapsed_factor(year: int, month: int) -> float:
    if year != BACKTEST_END_DATE.year or month != BACKTEST_END_DATE.month:
        return 1.0
    days_in_month = calendar.monthrange(year, month)[1]
    return float(BACKTEST_END_DATE.day / days_in_month)


def load_features() -> pd.DataFrame:
    path = DATA_DIR / "features.parquet"
    if not path.exists():
        raise FileNotFoundError(f"Missing features file: {path}")
    return pd.read_parquet(path).sort_values(["idproduto", "periodo"]).reset_index(drop=True)


def load_official_projections() -> dict:
    if not OFFICIAL_PROJECTIONS_PATH.exists():
        return {}
    parsed = json.loads(OFFICIAL_PROJECTIONS_PATH.read_text(encoding="utf-8"))
    data = parsed.get("data", {})
    return data if isinstance(data, dict) else {}


def load_actual_sales(ids: list[str]) -> dict[str, dict[str, float]]:
    if not ids:
        return {}

    query = """
        SELECT
            v.idproduto::TEXT AS idproduto,
            EXTRACT(MONTH FROM v.data)::INT AS mes,
            SUM(v.qt_liquida)::FLOAT AS quantidade
        FROM vr_vendas_qtd v
        WHERE v.idempresa = %s
          AND v.idproduto = ANY(%s::BIGINT[])
          AND EXTRACT(YEAR FROM v.data)::INT = %s
          AND EXTRACT(MONTH FROM v.data)::INT <= %s
          AND DATE(v.data) <= %s::DATE
        GROUP BY v.idproduto, EXTRACT(MONTH FROM v.data)
    """

    numeric_ids = [int(value) for value in ids if str(value).isdigit()]
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                query,
                [COMPANY_ID, numeric_ids, BACKTEST_YEAR, max(BACKTEST_MONTHS), BACKTEST_END_DATE.date()],
            )
            rows = cur.fetchall()

    data: dict[str, dict[str, float]] = {}
    for idproduto, mes, quantidade in rows:
        data.setdefault(str(idproduto), {})[str(int(mes))] = float(quantidade or 0)
    return data


def fit_curve_models(training_df: pd.DataFrame) -> dict:
    models = {}

    subset_a = training_df[training_df["curva_abc"] == "A"].copy()
    if not subset_a.empty:
        model = make_regressor({"n_estimators": 350, "max_depth": 6, "learning_rate": 0.05, "subsample": 0.9, "colsample_bytree": 0.9})
        model.fit(subset_a[FEATURES_CURVE_A].fillna(0.0), subset_a["qtd_mensal"].fillna(0.0), verbose=False)
        models["curve_a"] = {"model": model, "features": FEATURES_CURVE_A}

    subset_b = training_df[training_df["curva_abc"] == "B"].copy()
    if not subset_b.empty:
        model = make_regressor({"n_estimators": 220, "max_depth": 4, "learning_rate": 0.06, "subsample": 0.9, "colsample_bytree": 0.9})
        model.fit(subset_b[FEATURES_CURVE_B].fillna(0.0), subset_b["qtd_mensal"].fillna(0.0), verbose=False)
        models["curve_b"] = {"model": model, "features": FEATURES_CURVE_B}

    subset_cd = training_df[training_df["curva_abc"].isin(["C", "D"])].copy()
    if not subset_cd.empty:
        group_df = (
            subset_cd.groupby(["grupo", "periodo"], as_index=False)
            .agg(
                {
                    "mes": "first",
                    "trimestre": "first",
                    "mes_sin": "first",
                    "mes_cos": "first",
                    "media_grupo_3m": "first",
                    "media_grupo_6m": "first",
                    "qtd_grupo_ano_anterior": "first",
                    "indice_sazonal_grupo": "first",
                    "qtd_grupo": "first",
                }
            )
            .rename(columns={"qtd_grupo": "target"})
            .sort_values(["grupo", "periodo"])
        )
        model = make_regressor({"n_estimators": 160, "max_depth": 4, "learning_rate": 0.06, "subsample": 0.9, "colsample_bytree": 0.9})
        model.fit(group_df[FEATURES_GROUP].fillna(0.0), group_df["target"].fillna(0.0), verbose=False)
        shares = (
            subset_cd.groupby(["idproduto", "grupo"], as_index=False)["participacao_media_grupo"]
            .mean()
            .rename(columns={"participacao_media_grupo": "share"})
        )
        models["curve_cd"] = {"model": model, "features": FEATURES_GROUP, "shares": shares}

    return models


def generate_backtest_predictions(features_df: pd.DataFrame) -> pd.DataFrame:
    cutoff_period = pd.Timestamp(year=TRAIN_END[0], month=TRAIN_END[1], day=1)
    training_df = features_df[features_df["periodo"] <= cutoff_period].copy()
    if training_df.empty:
        raise RuntimeError("Training dataframe is empty for backtest.")

    models = fit_curve_models(training_df)
    base_rows = training_df[training_df["periodo"] == cutoff_period].copy()

    sku_history = {
        sku: list(zip(group["periodo"].tolist(), group["qtd_mensal"].astype(float).tolist()))
        for sku, group in training_df.groupby("idproduto")
    }
    group_history = {
        group_name: list(zip(group["periodo"].tolist(), group["qtd_mensal"].astype(float).tolist()))
        for group_name, group in (
            training_df.groupby(["grupo", "periodo"], as_index=False)["qtd_mensal"].sum().groupby("grupo")
        )
    }

    periods = [pd.Timestamp(year=BACKTEST_YEAR, month=month, day=1) for month in BACKTEST_MONTHS]
    group_predictions: dict[tuple[str, pd.Timestamp], float] = {}

    if "curve_cd" in models:
        bundle = models["curve_cd"]
        for group_name, history in group_history.items():
            local_history = history.copy()
            for period in periods:
                feature_row = build_group_feature_row(local_history, period)
                x = pd.DataFrame([feature_row])[bundle["features"]].fillna(0.0)
                pred = max(0.0, float(bundle["model"].predict(x)[0]))
                group_predictions[(group_name, period)] = pred
                local_history.append((period, pred))

    rows = []
    shares_map = {}
    if "curve_cd" in models:
        shares_map = {
            (str(row["idproduto"]), str(row["grupo"])): float(row["share"] or 0.0)
            for _, row in models["curve_cd"]["shares"].iterrows()
        }

    for _, row in base_rows.iterrows():
        sku = str(row["idproduto"])
        curve = str(row["curva_abc"])
        history = sku_history.get(row["idproduto"], []).copy()

        if curve == "A" and "curve_a" in models:
            bundle = models["curve_a"]
        elif curve == "B" and "curve_b" in models:
            bundle = models["curve_b"]
        else:
            bundle = None

        if bundle is not None:
            for period in periods:
                feature_row = build_sku_feature_row(history, row, period)
                x = pd.DataFrame([feature_row])[bundle["features"]].fillna(0.0)
                pred = round(max(0.0, float(bundle["model"].predict(x)[0])))
                rows.append(
                    {
                        "idproduto": sku,
                        "referencia": str(row["referencia"]),
                        "produto": str(row.get("produto", "") or ""),
                        "curva_abc": curve,
                        "continuidade": str(row.get("continuidade", "") or ""),
                        "linha": str(row.get("linha", "") or ""),
                        "familia": str(row.get("familia", "") or ""),
                        "ano": period.year,
                        "mes": period.month,
                        "ml_qtd": pred,
                    }
                )
                history.append((period, float(pred)))
        else:
            share = shares_map.get((sku, str(row["grupo"])), float(row.get("participacao_media_grupo", 0.0) or 0.0))
            for period in periods:
                pred = round(max(0.0, group_predictions.get((str(row["grupo"]), period), 0.0) * share))
                rows.append(
                    {
                        "idproduto": sku,
                        "referencia": str(row["referencia"]),
                        "produto": str(row.get("produto", "") or ""),
                        "curva_abc": curve,
                        "continuidade": str(row.get("continuidade", "") or ""),
                        "linha": str(row.get("linha", "") or ""),
                        "familia": str(row.get("familia", "") or ""),
                        "ano": period.year,
                        "mes": period.month,
                        "ml_qtd": pred,
                    }
                )

    return pd.DataFrame(rows).sort_values(["idproduto", "mes"]).reset_index(drop=True)


def build_backtest_output(pred_df: pd.DataFrame) -> dict:
    official = load_official_projections()
    actual = load_actual_sales(pred_df["idproduto"].astype(str).unique().tolist())

    monthly = []
    sku_rows = []
    official_abs_total = 0.0
    ml_abs_total = 0.0
    actual_total = 0.0

    for month in BACKTEST_MONTHS:
        factor = elapsed_factor(BACKTEST_YEAR, month)
        month_df = pred_df[pred_df["mes"] == month].copy()
        month_df["official_qtd"] = month_df["idproduto"].map(lambda sku: float(official.get(str(sku), {}).get(str(month), 0) or 0))
        month_df["actual_qtd"] = month_df["idproduto"].map(lambda sku: float(actual.get(str(sku), {}).get(str(month), 0) or 0))
        month_df["official_cmp"] = month_df["official_qtd"] * factor
        month_df["ml_cmp"] = month_df["ml_qtd"] * factor

        official_cmp_total = float(month_df["official_cmp"].sum())
        ml_cmp_total = float(month_df["ml_cmp"].sum())
        actual_month_total = float(month_df["actual_qtd"].sum())
        official_abs = float(np.abs(month_df["actual_qtd"] - month_df["official_cmp"]).sum())
        ml_abs = float(np.abs(month_df["actual_qtd"] - month_df["ml_cmp"]).sum())

        official_abs_total += official_abs
        ml_abs_total += ml_abs
        actual_total += actual_month_total

        monthly.append(
            {
                "mes": month,
                "official_projected": round(official_cmp_total),
                "ml_projected": round(ml_cmp_total),
                "actual": round(actual_month_total),
                "official_abs_error": round(official_abs),
                "ml_abs_error": round(ml_abs),
                "official_accuracy_pct": 0 if actual_month_total <= 0 else round(max(0.0, 1 - (official_abs / actual_month_total)) * 100, 2),
                "ml_accuracy_pct": 0 if actual_month_total <= 0 else round(max(0.0, 1 - (ml_abs / actual_month_total)) * 100, 2),
                "winner": "ML" if ml_abs < official_abs else ("OFICIAL" if official_abs < ml_abs else "EMPATE"),
            }
        )

    for sku, group in pred_df.groupby("idproduto"):
        official_adjusted = 0.0
        ml_adjusted = 0.0
        actual_adjusted = 0.0
        for _, row in group.iterrows():
            factor = elapsed_factor(int(row["ano"]), int(row["mes"]))
            official_value = float(official.get(str(sku), {}).get(str(int(row["mes"])), 0) or 0)
            actual_value = float(actual.get(str(sku), {}).get(str(int(row["mes"])), 0) or 0)
            official_adjusted += official_value * factor
            ml_adjusted += float(row["ml_qtd"]) * factor
            actual_adjusted += actual_value

        official_error = abs(actual_adjusted - official_adjusted)
        ml_error = abs(actual_adjusted - ml_adjusted)

        first = group.iloc[0]
        sku_rows.append(
            {
                "idproduto": str(sku),
                "referencia": str(first["referencia"]),
                "produto": str(first["produto"]),
                "curva_abc": str(first["curva_abc"]),
                "continuidade": str(first["continuidade"]),
                "linha": str(first["linha"]),
                "familia": str(first["familia"]),
                "official_projected": round(official_adjusted),
                "ml_projected": round(ml_adjusted),
                "actual": round(actual_adjusted),
                "official_abs_error": round(official_error),
                "ml_abs_error": round(ml_error),
                "improvement_abs": round(official_error - ml_error),
                "winner": "ML" if ml_error < official_error else ("OFICIAL" if official_error < ml_error else "EMPATE"),
            }
        )

    sku_rows = sorted(sku_rows, key=lambda row: abs(float(row["improvement_abs"])), reverse=True)
    return {
        "success": True,
        "scenario": "backtest_jan_abr_2026",
        "trained_until": {"ano": TRAIN_END[0], "mes": TRAIN_END[1]},
        "compared_until": str(BACKTEST_END_DATE.date()),
        "summary": {
            "sku_count": int(pred_df["idproduto"].nunique()),
            "official_accuracy_pct": 0 if actual_total <= 0 else round(max(0.0, 1 - (official_abs_total / actual_total)) * 100, 2),
            "ml_accuracy_pct": 0 if actual_total <= 0 else round(max(0.0, 1 - (ml_abs_total / actual_total)) * 100, 2),
            "actual_total": round(actual_total),
            "official_abs_error_total": round(official_abs_total),
            "ml_abs_error_total": round(ml_abs_total),
        },
        "monthly": monthly,
        "skuRows": sku_rows[:400],
    }


def run_backtest() -> dict:
    features_df = load_features()
    pred_df = generate_backtest_predictions(features_df)
    payload = build_backtest_output(pred_df)

    json_path = OUTPUT_DIR / "backtest_jan_abr_2026.json"
    csv_path = OUTPUT_DIR / "backtest_jan_abr_2026.csv"
    json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    pred_df.to_csv(csv_path, index=False)

    print(f"[backtest] saved json: {json_path}")
    print(f"[backtest] saved csv: {csv_path}")
    print(f"[backtest] sku_count: {payload['summary']['sku_count']}")
    print(f"[backtest] official_accuracy_pct: {payload['summary']['official_accuracy_pct']}")
    print(f"[backtest] ml_accuracy_pct: {payload['summary']['ml_accuracy_pct']}")
    return payload


if __name__ == "__main__":
    run_backtest()
