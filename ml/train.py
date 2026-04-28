"""
Model training for the forecasting pipeline.
"""
from __future__ import annotations

import json

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

from config import DATA_DIR, GROUP_COLUMN, MODEL_CONFIG, MODELS_DIR, TARGET_COLUMN, TRAIN_END


FEATURES_CURVE_A = [
    "mes",
    "trimestre",
    "semestre",
    "mes_sin",
    "mes_cos",
    "is_inicio_ano",
    "is_fim_ano",
    "lag_1",
    "lag_2",
    "lag_3",
    "lag_6",
    "lag_12",
    "media_3m",
    "media_6m",
    "media_12m",
    "soma_6m",
    "soma_12m",
    "std_6m",
    "max_6m",
    "tendencia_3m",
    "qtd_ano_anterior",
    "variacao_yoy",
    "indice_sazonal_mes",
    "linha_encoded",
    "familia_encoded",
]

FEATURES_CURVE_B = [
    "mes",
    "trimestre",
    "mes_sin",
    "mes_cos",
    "lag_1",
    "lag_2",
    "lag_3",
    "lag_12",
    "media_3m",
    "media_6m",
    "qtd_ano_anterior",
    "indice_sazonal_mes",
    "linha_encoded",
    "familia_encoded",
]

FEATURES_GROUP = [
    "mes",
    "trimestre",
    "mes_sin",
    "mes_cos",
    "media_grupo_3m",
    "media_grupo_6m",
    "qtd_grupo_ano_anterior",
    "indice_sazonal_grupo",
]


def compute_mape(y_true, y_pred) -> float:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    mask = y_true > 0
    if mask.sum() == 0:
        return 0.0
    return float(np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])))


def evaluate_predictions(y_true, y_pred) -> dict:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    if len(y_true) == 0:
        return {"mae": 0.0, "rmse": 0.0, "mape": 0.0, "r2": 0.0}
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "mape": compute_mape(y_true, y_pred),
        "r2": float(r2_score(y_true, y_pred)) if len(y_true) > 1 else 0.0,
    }


def make_train_test_split(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    train_mask = (df["ano"] < TRAIN_END[0]) | ((df["ano"] == TRAIN_END[0]) & (df["mes"] <= TRAIN_END[1]))
    return df.loc[train_mask].copy(), df.loc[~train_mask].copy()


def make_regressor(config: dict) -> xgb.XGBRegressor:
    return xgb.XGBRegressor(
        objective="reg:squarederror",
        random_state=MODEL_CONFIG["random_state"],
        n_jobs=-1,
        **config,
    )


def latest_sku_state(df: pd.DataFrame) -> pd.DataFrame:
    ordered = df.sort_values(["idproduto", "periodo"])
    latest = ordered.groupby("idproduto", as_index=False).tail(1).copy()
    return latest


def latest_group_state(df: pd.DataFrame) -> pd.DataFrame:
    group_df = (
        df.groupby([GROUP_COLUMN, "periodo"], as_index=False)
        .agg(
            {
                "ano": "first",
                "mes": "first",
                "mes_sin": "first",
                "mes_cos": "first",
                "trimestre": "first",
                "media_grupo_3m": "first",
                "media_grupo_6m": "first",
                "qtd_grupo_ano_anterior": "first",
                "indice_sazonal_grupo": "first",
                "qtd_grupo": "first",
            }
        )
        .sort_values([GROUP_COLUMN, "periodo"])
    )
    return group_df.groupby(GROUP_COLUMN, as_index=False).tail(1).copy()


def train_single_model(
    df: pd.DataFrame,
    label: str,
    feature_names: list[str],
    config_key: str,
    target_column: str = TARGET_COLUMN,
) -> dict | None:
    df = df.copy()
    if df.empty:
        print(f"[train] skipping {label}: empty dataset")
        return None

    train_df, test_df = make_train_test_split(df)
    if train_df.empty or test_df.empty:
        print(f"[train] skipping {label}: train/test split is empty")
        return None

    model = make_regressor(MODEL_CONFIG[config_key])
    x_train = train_df[feature_names].fillna(0.0)
    y_train = train_df[target_column].fillna(0.0)
    x_test = test_df[feature_names].fillna(0.0)
    y_test = test_df[target_column].fillna(0.0)

    model.fit(x_train, y_train, verbose=False)
    preds = np.maximum(0.0, model.predict(x_test))
    metrics = evaluate_predictions(y_test, preds)

    print(
        f"[train] {label}: "
        f"MAE={metrics['mae']:.2f} RMSE={metrics['rmse']:.2f} "
        f"MAPE={metrics['mape']:.2%} R2={metrics['r2']:.4f}"
    )

    importance = (
        pd.DataFrame({"feature": feature_names, "importance": model.feature_importances_})
        .sort_values("importance", ascending=False)
        .reset_index(drop=True)
    )

    return {
        "model": model,
        "features": feature_names,
        "metrics": metrics,
        "importance": importance,
    }


def train_curve_cd(df: pd.DataFrame) -> dict | None:
    subset = df[df["curva_abc"].isin(["C", "D"])].copy()
    if subset.empty:
        print("[train] skipping curve_cd: empty dataset")
        return None

    group_df = (
        subset.groupby([GROUP_COLUMN, "periodo"], as_index=False)
        .agg(
            {
                "ano": "first",
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
        .sort_values([GROUP_COLUMN, "periodo"])
    )

    result = train_single_model(
        df=group_df.rename(columns={"qtd_grupo": TARGET_COLUMN}),
        label="curve_cd_group",
        feature_names=FEATURES_GROUP,
        config_key="curve_cd",
    )
    if result is None:
        return None

    shares = (
        subset.groupby(["idproduto", GROUP_COLUMN], as_index=False)["participacao_media_grupo"]
        .mean()
        .rename(columns={"participacao_media_grupo": "share"})
    )
    shares["share"] = shares["share"].fillna(0.0)

    result["shares"] = shares
    result["latest_group_state"] = latest_group_state(subset)
    return result


def run_training() -> dict:
    print("=" * 60)
    print("ML TRAINING")
    print("=" * 60)

    input_path = DATA_DIR / "features.parquet"
    if not input_path.exists():
        raise FileNotFoundError(f"Missing input file: {input_path}")

    df = pd.read_parquet(input_path).sort_values(["idproduto", "periodo"]).reset_index(drop=True)

    subset_a = df[df["curva_abc"] == "A"].copy()
    subset_b = df[df["curva_abc"] == "B"].copy()

    result_a = train_single_model(subset_a, "curve_a", FEATURES_CURVE_A, "curve_a")
    result_b = train_single_model(subset_b, "curve_b", FEATURES_CURVE_B, "curve_b")
    result_cd = train_curve_cd(df)

    latest_state = latest_sku_state(df)
    metadata = {
        "latest_period": str(df["periodo"].max().date()),
        "train_end": {"year": TRAIN_END[0], "month": TRAIN_END[1]},
        "sku_latest_state": latest_state,
    }

    artifacts = {
        "curve_a": result_a,
        "curve_b": result_b,
        "curve_cd": result_cd,
        "metadata": metadata,
    }

    artifact_path = MODELS_DIR / "forecast_models.pkl"
    joblib.dump(artifacts, artifact_path)

    summary = {
        key: value["metrics"]
        for key, value in artifacts.items()
        if isinstance(value, dict) and "metrics" in value
    }
    (MODELS_DIR / "metrics.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    importances = {
        key: value["importance"].head(10).to_dict(orient="records")
        for key, value in artifacts.items()
        if isinstance(value, dict) and "importance" in value
    }
    (MODELS_DIR / "feature_importance.json").write_text(json.dumps(importances, indent=2), encoding="utf-8")

    print(f"[train] saved artifacts: {artifact_path}")
    return artifacts


if __name__ == "__main__":
    run_training()
