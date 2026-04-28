"""
Forecast generation for Jul-Nov 2026.
"""
from __future__ import annotations

import math

import joblib
import numpy as np
import pandas as pd

from config import DATA_DIR, FORECAST_MONTHS, FORECAST_YEAR, GROUP_COLUMN, MODELS_DIR, OUTPUT_DIR


def month_features(month: int) -> dict:
    return {
        "mes": month,
        "trimestre": ((month - 1) // 3) + 1,
        "semestre": ((month - 1) // 6) + 1,
        "mes_sin": math.sin(2 * math.pi * month / 12.0),
        "mes_cos": math.cos(2 * math.pi * month / 12.0),
        "is_inicio_ano": int(month in [1, 2]),
        "is_fim_ano": int(month in [11, 12]),
    }


def series_value(history: list[tuple[pd.Timestamp, float]], months_back: int) -> float:
    if len(history) < months_back:
        return 0.0
    return float(history[-months_back][1])


def rolling_mean(history: list[tuple[pd.Timestamp, float]], window: int) -> float:
    values = [value for _, value in history[-window:]]
    if not values:
        return 0.0
    return float(np.mean(values))


def rolling_sum(history: list[tuple[pd.Timestamp, float]], window: int) -> float:
    values = [value for _, value in history[-window:]]
    if not values:
        return 0.0
    return float(np.sum(values))


def rolling_std(history: list[tuple[pd.Timestamp, float]], window: int) -> float:
    values = [value for _, value in history[-window:]]
    if len(values) < 2:
        return 0.0
    return float(np.std(values, ddof=1))


def rolling_max(history: list[tuple[pd.Timestamp, float]], window: int) -> float:
    values = [value for _, value in history[-window:]]
    return float(max(values)) if values else 0.0


def rolling_slope(history: list[tuple[pd.Timestamp, float]], window: int = 3) -> float:
    values = np.asarray([value for _, value in history[-window:]], dtype=float)
    if len(values) < 2 or np.allclose(values, values[0]):
        return 0.0
    x = np.arange(len(values), dtype=float)
    slope = np.polyfit(x, values, 1)[0]
    mean = float(values.mean())
    return 0.0 if mean == 0 else float(slope / mean)


def qty_last_year(history: list[tuple[pd.Timestamp, float]], target_period: pd.Timestamp) -> float:
    ref_period = target_period - pd.DateOffset(years=1)
    for period, value in reversed(history):
        if period == ref_period:
            return float(value)
    return 0.0


def seasonal_index(history: list[tuple[pd.Timestamp, float]], month: int) -> float:
    values = [value for _, value in history]
    if not values:
        return 1.0
    month_values = [value for period, value in history if period.month == month]
    overall = float(np.mean(values))
    if overall <= 0:
        return 1.0
    return float(np.clip(np.mean(month_values) / overall if month_values else 1.0, 0.1, 4.0))


def build_sku_feature_row(history: list[tuple[pd.Timestamp, float]], base_row: pd.Series, target_period: pd.Timestamp) -> dict:
    month = int(target_period.month)
    lag_1 = series_value(history, 1)
    lag_2 = series_value(history, 2)
    current_last = history[-1][1] if history else 0.0
    yoy_qty = qty_last_year(history, target_period)

    row = {
        **month_features(month),
        "lag_1": lag_1,
        "lag_2": lag_2,
        "lag_3": series_value(history, 3),
        "lag_6": series_value(history, 6),
        "lag_12": series_value(history, 12),
        "media_3m": rolling_mean(history, 3),
        "media_6m": rolling_mean(history, 6),
        "media_12m": rolling_mean(history, 12),
        "soma_6m": rolling_sum(history, 6),
        "soma_12m": rolling_sum(history, 12),
        "std_6m": rolling_std(history, 6),
        "max_6m": rolling_max(history, 6),
        "tendencia_3m": rolling_slope(history, 3),
        "qtd_ano_anterior": yoy_qty,
        "variacao_yoy": ((current_last - yoy_qty) / yoy_qty) if yoy_qty > 0 else 0.0,
        "indice_sazonal_mes": seasonal_index(history, month),
        "linha_encoded": float(base_row["linha_encoded"]),
        "familia_encoded": float(base_row["familia_encoded"]),
    }

    row["variacao_mes_anterior"] = ((lag_1 - lag_2) / lag_2) if lag_2 > 0 else 0.0
    row["variacao_mes_anterior"] = float(np.clip(row["variacao_mes_anterior"], -2, 2))
    row["variacao_yoy"] = float(np.clip(row["variacao_yoy"], -2, 2))
    return row


def build_group_feature_row(history: list[tuple[pd.Timestamp, float]], target_period: pd.Timestamp) -> dict:
    month = int(target_period.month)
    yoy_qty = qty_last_year(history, target_period)
    return {
        "mes": month,
        "trimestre": ((month - 1) // 3) + 1,
        "mes_sin": math.sin(2 * math.pi * month / 12.0),
        "mes_cos": math.cos(2 * math.pi * month / 12.0),
        "media_grupo_3m": rolling_mean(history, 3),
        "media_grupo_6m": rolling_mean(history, 6),
        "qtd_grupo_ano_anterior": yoy_qty,
        "indice_sazonal_grupo": seasonal_index(history, month),
    }


def run_prediction() -> pd.DataFrame:
    print("=" * 60)
    print("ML PREDICTION")
    print("=" * 60)

    artifacts = joblib.load(MODELS_DIR / "forecast_models.pkl")
    features_df = pd.read_parquet(DATA_DIR / "features.parquet").sort_values(["idproduto", "periodo"])

    latest_rows = features_df.groupby("idproduto", as_index=False).tail(1).copy()
    sku_history = {
        sku: list(zip(group["periodo"].tolist(), group["qtd_mensal"].astype(float).tolist()))
        for sku, group in features_df.groupby("idproduto")
    }
    group_history = {
        group_name: list(zip(group["periodo"].tolist(), group["qtd_mensal"].astype(float).tolist()))
        for group_name, group in (
            features_df.groupby([GROUP_COLUMN, "periodo"], as_index=False)["qtd_mensal"].sum().groupby(GROUP_COLUMN)
        )
    }

    forecast_periods = [pd.Timestamp(year=FORECAST_YEAR, month=month, day=1) for month in FORECAST_MONTHS]
    forecast_rows: list[dict] = []

    curve_a = artifacts.get("curve_a")
    curve_b = artifacts.get("curve_b")
    curve_cd = artifacts.get("curve_cd")

    group_predictions: dict[tuple[str, pd.Timestamp], float] = {}
    if curve_cd:
        group_model = curve_cd["model"]
        group_features = curve_cd["features"]
        for group_name, history in group_history.items():
            local_history = history.copy()
            for period in forecast_periods:
                feature_row = build_group_feature_row(local_history, period)
                x = pd.DataFrame([feature_row])[group_features].fillna(0.0)
                pred = max(0.0, float(group_model.predict(x)[0]))
                group_predictions[(group_name, period)] = pred
                local_history.append((period, pred))

    for _, row in latest_rows.iterrows():
        sku = row["idproduto"]
        curve = row["curva_abc"]
        history = sku_history[sku].copy()

        if curve == "A" and curve_a:
            model_bundle = curve_a
        elif curve == "B" and curve_b:
            model_bundle = curve_b
        else:
            model_bundle = None

        if model_bundle is not None:
            for period in forecast_periods:
                feature_row = build_sku_feature_row(history, row, period)
                x = pd.DataFrame([feature_row])[model_bundle["features"]].fillna(0.0)
                pred = max(0.0, float(model_bundle["model"].predict(x)[0]))
                pred = round(pred)
                forecast_rows.append(
                    {
                        "idproduto": str(sku),
                        "referencia": row["referencia"],
                        "curva_abc": curve,
                        "ano": period.year,
                        "mes": period.month,
                        "qtd": pred,
                    }
                )
                history.append((period, float(pred)))
        else:
            group_name = row[GROUP_COLUMN]
            share = float(row.get("participacao_media_grupo", 0.0) or 0.0)
            for period in forecast_periods:
                group_pred = group_predictions.get((group_name, period), 0.0)
                pred = round(max(0.0, group_pred * share))
                forecast_rows.append(
                    {
                        "idproduto": str(sku),
                        "referencia": row["referencia"],
                        "curva_abc": curve,
                        "ano": period.year,
                        "mes": period.month,
                        "qtd": pred,
                    }
                )

    forecast_df = pd.DataFrame(forecast_rows).sort_values(["idproduto", "ano", "mes"]).reset_index(drop=True)

    csv_upload = forecast_df[["idproduto", "mes", "qtd"]].copy()
    csv_upload_path = OUTPUT_DIR / "projecoes_2026_h2.csv"
    details_path = OUTPUT_DIR / "projecoes_2026_h2_detalhe.csv"
    parquet_path = OUTPUT_DIR / "projecoes_2026_h2.parquet"

    csv_upload.to_csv(csv_upload_path, index=False)
    forecast_df.to_csv(details_path, index=False)
    forecast_df.to_parquet(parquet_path, index=False)

    print(f"[predict] saved upload csv: {csv_upload_path}")
    print(f"[predict] saved detail csv: {details_path}")
    print(f"[predict] rows: {len(forecast_df):,}")
    return forecast_df


if __name__ == "__main__":
    run_prediction()
