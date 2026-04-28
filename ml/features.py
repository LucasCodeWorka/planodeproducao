"""
Feature engineering for the forecasting pipeline.
"""
from __future__ import annotations

import joblib
import numpy as np
import pandas as pd
from sklearn.preprocessing import LabelEncoder

from config import DATA_DIR, GROUP_COLUMN, TARGET_COLUMN


def classify_abc_by_reference(df: pd.DataFrame) -> pd.DataFrame:
    print("[features] classifying ABC curve")

    latest_period = df["periodo"].max()
    start_period = latest_period - pd.DateOffset(months=2)
    recent = df[df["periodo"] >= start_period].copy()

    reference_sales = (
        recent.groupby("referencia", as_index=False)[TARGET_COLUMN]
        .sum()
        .rename(columns={TARGET_COLUMN: "total_qty"})
        .sort_values("total_qty", ascending=False)
        .reset_index(drop=True)
    )

    total_refs = len(reference_sales)
    curve_values = []
    for idx, row in reference_sales.iterrows():
        rank = idx + 1
        qty = float(row["total_qty"] or 0)
        if qty >= 2500:
            curve = "A"
        elif rank > total_refs - 20:
            curve = "D"
        elif rank > total_refs - 50:
            curve = "C"
        else:
            curve = "B"
        curve_values.append(curve)

    reference_sales["curva_abc"] = curve_values
    return reference_sales[["referencia", "curva_abc"]]


def add_calendar_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["trimestre"] = ((df["mes"] - 1) // 3) + 1
    df["semestre"] = ((df["mes"] - 1) // 6) + 1
    df["mes_sin"] = np.sin(2 * np.pi * df["mes"] / 12.0)
    df["mes_cos"] = np.cos(2 * np.pi * df["mes"] / 12.0)
    df["is_inicio_ano"] = df["mes"].isin([1, 2]).astype(int)
    df["is_fim_ano"] = df["mes"].isin([11, 12]).astype(int)
    return df


def add_lag_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["idproduto", "periodo"]).copy()
    group = df.groupby("idproduto")[TARGET_COLUMN]

    for lag in (1, 2, 3, 6, 12):
        df[f"lag_{lag}"] = group.shift(lag).fillna(0.0)

    for window in (3, 6, 12):
        df[f"media_{window}m"] = (
            group.shift(1).rolling(window=window, min_periods=1).mean().reset_index(level=0, drop=True).fillna(0.0)
        )
        df[f"soma_{window}m"] = (
            group.shift(1).rolling(window=window, min_periods=1).sum().reset_index(level=0, drop=True).fillna(0.0)
        )

    df["std_6m"] = (
        group.shift(1).rolling(window=6, min_periods=2).std().reset_index(level=0, drop=True).fillna(0.0)
    )
    df["max_6m"] = (
        group.shift(1).rolling(window=6, min_periods=1).max().reset_index(level=0, drop=True).fillna(0.0)
    )

    return df


def add_trend_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["idproduto", "periodo"]).copy()

    previous = df.groupby("idproduto")[TARGET_COLUMN].shift(1)
    previous_2 = df.groupby("idproduto")[TARGET_COLUMN].shift(2)
    df["variacao_mes_anterior"] = np.where(
        previous_2 > 0,
        (previous - previous_2) / previous_2,
        0.0,
    )
    df["variacao_mes_anterior"] = df["variacao_mes_anterior"].replace([np.inf, -np.inf], 0.0).clip(-2, 2)

    def rolling_slope(values: pd.Series) -> float:
        arr = values.to_numpy(dtype=float)
        if len(arr) < 2 or np.allclose(arr, arr[0]):
            return 0.0
        x = np.arange(len(arr), dtype=float)
        slope = np.polyfit(x, arr, 1)[0]
        mean = float(arr.mean())
        return 0.0 if mean == 0 else slope / mean

    df["tendencia_3m"] = (
        df.groupby("idproduto")[TARGET_COLUMN]
        .transform(lambda s: s.shift(1).rolling(window=3, min_periods=2).apply(rolling_slope, raw=False))
        .fillna(0.0)
        .clip(-2, 2)
    )
    return df


def add_yoy_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    previous_year = df[["idproduto", "periodo", TARGET_COLUMN]].copy()
    previous_year["periodo"] = previous_year["periodo"] + pd.DateOffset(years=1)
    previous_year = previous_year.rename(columns={TARGET_COLUMN: "qtd_ano_anterior"})

    df = df.merge(previous_year, on=["idproduto", "periodo"], how="left")
    df["qtd_ano_anterior"] = df["qtd_ano_anterior"].fillna(0.0)
    previous = df.groupby("idproduto")[TARGET_COLUMN].shift(1)
    df["variacao_yoy"] = np.where(
        df["qtd_ano_anterior"] > 0,
        (previous - df["qtd_ano_anterior"]) / df["qtd_ano_anterior"],
        0.0,
    )
    df["variacao_yoy"] = df["variacao_yoy"].replace([np.inf, -np.inf], 0.0).clip(-2, 2)
    return df


def add_seasonality_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    sku_avg = df.groupby("idproduto")[TARGET_COLUMN].mean().rename("sku_media")
    sku_month_avg = (
        df.groupby(["idproduto", "mes"])[TARGET_COLUMN].mean().rename("sku_mes_media").reset_index()
    )

    df = df.merge(sku_month_avg, on=["idproduto", "mes"], how="left")
    df = df.merge(sku_avg.reset_index(), on="idproduto", how="left")
    df["indice_sazonal_mes"] = np.where(
        df["sku_media"] > 0,
        df["sku_mes_media"] / df["sku_media"],
        1.0,
    )
    df["indice_sazonal_mes"] = df["indice_sazonal_mes"].fillna(1.0).clip(0.1, 4.0)
    df = df.drop(columns=["sku_mes_media", "sku_media"])
    return df


def add_group_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    group_month = (
        df.groupby([GROUP_COLUMN, "periodo"], as_index=False)[TARGET_COLUMN]
        .sum()
        .rename(columns={TARGET_COLUMN: "qtd_grupo"})
        .sort_values([GROUP_COLUMN, "periodo"])
    )
    group_month["media_grupo_3m"] = (
        group_month.groupby(GROUP_COLUMN)["qtd_grupo"]
        .transform(lambda s: s.shift(1).rolling(3, min_periods=1).mean())
        .fillna(0.0)
    )
    group_month["media_grupo_6m"] = (
        group_month.groupby(GROUP_COLUMN)["qtd_grupo"]
        .transform(lambda s: s.shift(1).rolling(6, min_periods=1).mean())
        .fillna(0.0)
    )

    prev_group = group_month[[GROUP_COLUMN, "periodo", "qtd_grupo"]].copy()
    prev_group["periodo"] = prev_group["periodo"] + pd.DateOffset(years=1)
    prev_group = prev_group.rename(columns={"qtd_grupo": "qtd_grupo_ano_anterior"})
    group_month = group_month.merge(prev_group, on=[GROUP_COLUMN, "periodo"], how="left")
    group_month["qtd_grupo_ano_anterior"] = group_month["qtd_grupo_ano_anterior"].fillna(0.0)

    group_avg = group_month.groupby(GROUP_COLUMN)["qtd_grupo"].mean().rename("grupo_media")
    group_month_avg = (
        group_month.assign(mes=group_month["periodo"].dt.month)
        .groupby([GROUP_COLUMN, "mes"])["qtd_grupo"]
        .mean()
        .rename("grupo_mes_media")
        .reset_index()
    )

    group_month["mes"] = group_month["periodo"].dt.month
    group_month = group_month.merge(group_month_avg, on=[GROUP_COLUMN, "mes"], how="left")
    group_month = group_month.merge(group_avg.reset_index(), on=GROUP_COLUMN, how="left")
    group_month["indice_sazonal_grupo"] = np.where(
        group_month["grupo_media"] > 0,
        group_month["grupo_mes_media"] / group_month["grupo_media"],
        1.0,
    )
    group_month["indice_sazonal_grupo"] = group_month["indice_sazonal_grupo"].fillna(1.0).clip(0.1, 4.0)

    merge_columns = [
        GROUP_COLUMN,
        "periodo",
        "qtd_grupo",
        "media_grupo_3m",
        "media_grupo_6m",
        "qtd_grupo_ano_anterior",
        "indice_sazonal_grupo",
    ]
    df = df.merge(group_month[merge_columns], on=[GROUP_COLUMN, "periodo"], how="left")
    df["participacao_grupo"] = np.where(df["qtd_grupo"] > 0, df[TARGET_COLUMN] / df["qtd_grupo"], 0.0)
    avg_share = df.groupby("idproduto")["participacao_grupo"].mean().rename("participacao_media_grupo")
    df = df.merge(avg_share.reset_index(), on="idproduto", how="left")
    return df


def encode_product_dimensions(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    line_encoder = LabelEncoder()
    family_encoder = LabelEncoder()
    curve_encoder = LabelEncoder()

    df["linha_encoded"] = line_encoder.fit_transform(df["linha"].fillna("SEM_LINHA"))
    df["familia_encoded"] = family_encoder.fit_transform(df["familia"].fillna("SEM_FAMILIA"))
    df["curva_encoded"] = curve_encoder.fit_transform(df["curva_abc"].fillna("B"))

    joblib.dump(line_encoder, DATA_DIR / "encoder_linha.pkl")
    joblib.dump(family_encoder, DATA_DIR / "encoder_familia.pkl")
    joblib.dump(curve_encoder, DATA_DIR / "encoder_curva.pkl")
    return df


def run_feature_engineering() -> pd.DataFrame:
    print("=" * 60)
    print("ML FEATURES")
    print("=" * 60)

    input_path = DATA_DIR / "vendas_mensais.parquet"
    if not input_path.exists():
        raise FileNotFoundError(f"Missing input file: {input_path}")

    df = pd.read_parquet(input_path)

    curve_map = classify_abc_by_reference(df)
    df = df.merge(curve_map, on="referencia", how="left")
    df["curva_abc"] = df["curva_abc"].fillna("B")

    df = add_calendar_features(df)
    df = add_lag_features(df)
    df = add_trend_features(df)
    df = add_yoy_features(df)
    df = add_seasonality_features(df)
    df = add_group_features(df)
    df = encode_product_dimensions(df)

    df["ativo_ultimos_6m"] = (df["soma_6m"] > 0).astype(int)
    df["ativo_ultimos_12m"] = (df["soma_12m"] > 0).astype(int)

    df = df.sort_values(["idproduto", "periodo"]).reset_index(drop=True)

    parquet_path = DATA_DIR / "features.parquet"
    csv_path = DATA_DIR / "features_sample.csv"
    df.to_parquet(parquet_path, index=False)
    df.head(2000).to_csv(csv_path, index=False)

    print(f"[features] saved parquet: {parquet_path}")
    print(f"[features] saved sample csv: {csv_path}")
    print(f"[features] rows: {len(df):,}")
    print(f"[features] skus: {df['idproduto'].nunique():,}")
    print(df.groupby("curva_abc")["idproduto"].nunique().to_string())

    return df


if __name__ == "__main__":
    run_feature_engineering()
