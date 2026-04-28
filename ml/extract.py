"""
Data extraction for the forecasting pipeline.
"""
from __future__ import annotations

from typing import Iterable

import pandas as pd
import psycopg2

from config import (
    COMPANY_ID,
    DATA_DIR,
    DB_CONFIG,
    EXCLUDED_PRODUCT_TERMS,
    EXCLUDED_REFERENCE_CODES,
    EXCLUDED_SIZE_LABELS,
    EXCLUDED_SITUATIONS,
    GROUP_COLUMN,
    HISTORY_MONTHS,
    VALID_BRAND,
    VALID_CONTINUITIES,
    VALID_STATUS,
)


def normalize_text(value: object) -> str:
    return str(value or "").strip().upper()


def contains_any(text: str, terms: Iterable[str]) -> bool:
    return any(term in text for term in terms)


def get_connection():
    return psycopg2.connect(**DB_CONFIG)


def extract_monthly_sales(history_months: int = HISTORY_MONTHS) -> pd.DataFrame:
    print(f"[extract] extracting monthly sales for last {history_months} closed months")

    query = f"""
        WITH bounds AS (
            SELECT
                date_trunc('month', CURRENT_DATE) AS current_month,
                date_trunc('month', CURRENT_DATE) - INTERVAL '{history_months} months' AS start_month
        )
        SELECT
            v.idproduto::BIGINT AS idproduto,
            date_trunc('month', v.data)::date AS periodo,
            SUM(v.qt_liquida)::float AS qtd_mensal,
            COUNT(DISTINCT DATE(v.data))::int AS dias_com_venda
        FROM vr_vendas_qtd v
        CROSS JOIN bounds b
        WHERE v.idempresa = %s
          AND v.idproduto < 1000000
          AND v.data >= b.start_month
          AND v.data < b.current_month
        GROUP BY v.idproduto, date_trunc('month', v.data)::date
        ORDER BY v.idproduto, periodo
    """

    with get_connection() as conn:
        df = pd.read_sql_query(query, conn, params=[COMPANY_ID])

    if df.empty:
        raise RuntimeError("No sales history was returned from vr_vendas_qtd.")

    df["periodo"] = pd.to_datetime(df["periodo"])
    df["qtd_mensal"] = df["qtd_mensal"].astype(float)
    df["dias_com_venda"] = df["dias_com_venda"].fillna(0).astype(int)
    return df


def extract_products(product_ids: list[int] | None = None) -> pd.DataFrame:
    print("[extract] extracting product catalog")

    query = """
        SELECT
            p.cd_produto::BIGINT AS idproduto,
            COALESCE(f_dic_prd_nivel(p.cd_produto, 'CD'::bpchar), '') AS referencia,
            COALESCE(f_dic_prd_nivel(p.cd_produto, 'DS'::bpchar), p.nm_produto, '') AS produto,
            COALESCE(p.nm_produto, '') AS apresentacao,
            COALESCE(p.ds_cor, '') AS cor,
            COALESCE(p.ds_tamanho, '') AS tamanho,
            COALESCE(f_dic_prd_classificacao(p.cd_produto, 'DS'::text, 20::bigint), '') AS marca,
            COALESCE(f_dic_prd_classificacao(p.cd_produto, 'DS'::text, 27::bigint), '') AS status,
            COALESCE(f_dic_prd_classificacao(p.cd_produto, 'DS'::text, 802::bigint), '') AS continuidade,
            COALESCE(f_dic_prd_classificacao(p.cd_produto, 'CD'::text, 124::bigint), '') AS cod_situacao,
            COALESCE(f_dic_prd_classificacao(p.cd_produto, 'DS'::text, 23::bigint), '') AS linha,
            COALESCE(f_dic_prd_classificacao(p.cd_produto, 'DS'::text, 24::bigint), '') AS familia
        FROM vr_prd_prdgrade p
        WHERE p.cd_produto < 1000000
    """

    params = None
    if product_ids:
        query += "\n        AND p.cd_produto = ANY(%s)"
        params = [product_ids]

    with get_connection() as conn:
        df = pd.read_sql_query(query, conn, params=params)

    for column in df.columns:
        if column != "idproduto":
            df[column] = df[column].map(normalize_text)

    return df


def filter_products(df: pd.DataFrame) -> pd.DataFrame:
    print("[extract] applying planning filters")

    mask = (
        (df["marca"] == VALID_BRAND)
        & (df["status"].isin(VALID_STATUS))
        & (df["continuidade"].isin(VALID_CONTINUITIES))
        & (~df["cod_situacao"].isin(EXCLUDED_SITUATIONS))
        & (~df["tamanho"].isin(EXCLUDED_SIZE_LABELS))
        & (df["referencia"] != "")
        & (~df["referencia"].str.startswith("PT", na=False))
        & (~df["referencia"].isin(EXCLUDED_REFERENCE_CODES))
        & (~df["produto"].map(lambda value: contains_any(value, EXCLUDED_PRODUCT_TERMS)))
        & (~df["apresentacao"].map(lambda value: contains_any(value, EXCLUDED_PRODUCT_TERMS)))
    )

    filtered = df.loc[mask].copy()
    filtered[GROUP_COLUMN] = (
        filtered["linha"].fillna("SEM_LINHA") + "__" + filtered["familia"].fillna("SEM_FAMILIA")
    )
    print(f"[extract] valid skus after filters: {filtered['idproduto'].nunique():,}")
    return filtered


def build_dense_panel(df_sales: pd.DataFrame, df_products: pd.DataFrame) -> pd.DataFrame:
    print("[extract] building dense sku x month panel")

    min_period = df_sales["periodo"].min()
    max_period = df_sales["periodo"].max()
    periods = pd.date_range(min_period, max_period, freq="MS")

    sku_periods = (
        pd.MultiIndex.from_product(
            [df_products["idproduto"].unique(), periods],
            names=["idproduto", "periodo"],
        )
        .to_frame(index=False)
    )

    panel = sku_periods.merge(df_products, on="idproduto", how="left")
    panel = panel.merge(df_sales, on=["idproduto", "periodo"], how="left")
    panel["qtd_mensal"] = panel["qtd_mensal"].fillna(0.0)
    panel["dias_com_venda"] = panel["dias_com_venda"].fillna(0).astype(int)
    panel["ano"] = panel["periodo"].dt.year
    panel["mes"] = panel["periodo"].dt.month
    panel["ano_mes"] = panel["periodo"].dt.strftime("%Y-%m")
    panel = panel.sort_values(["idproduto", "periodo"]).reset_index(drop=True)
    return panel


def run_extraction() -> pd.DataFrame:
    print("=" * 60)
    print("ML EXTRACTION")
    print("=" * 60)

    sales = extract_monthly_sales()
    sold_ids = sorted(sales["idproduto"].dropna().astype(int).unique().tolist())
    products = filter_products(extract_products(sold_ids))

    valid_ids = set(products["idproduto"].tolist())
    sales = sales[sales["idproduto"].isin(valid_ids)].copy()

    panel = build_dense_panel(sales, products)

    parquet_path = DATA_DIR / "vendas_mensais.parquet"
    csv_path = DATA_DIR / "vendas_mensais.csv"
    panel.to_parquet(parquet_path, index=False)
    panel.to_csv(csv_path, index=False)

    print(f"[extract] saved parquet: {parquet_path}")
    print(f"[extract] saved csv: {csv_path}")
    print(f"[extract] rows: {len(panel):,}")
    print(f"[extract] skus: {panel['idproduto'].nunique():,}")
    print(f"[extract] refs: {panel['referencia'].nunique():,}")
    print(f"[extract] period: {panel['periodo'].min().date()} -> {panel['periodo'].max().date()}")

    return panel


if __name__ == "__main__":
    run_extraction()
