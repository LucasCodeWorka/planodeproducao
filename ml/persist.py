"""
Persistence helpers for storing ML runs directly in PostgreSQL.
"""
from __future__ import annotations

import json
from datetime import datetime

import psycopg2

from config import DB_CONFIG, MODEL_VERSION


ML_RUNS_TABLE = "app_ml_runs"
ML_FORECASTS_TABLE = "app_ml_forecasts"


def get_connection():
    return psycopg2.connect(**DB_CONFIG)


def ensure_tables(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {ML_RUNS_TABLE} (
              id BIGSERIAL PRIMARY KEY,
              nome TEXT NOT NULL,
              source_type TEXT NOT NULL DEFAULT 'python_pipeline',
              status TEXT NOT NULL DEFAULT 'completed',
              model_version TEXT NULL,
              forecast_year INT NULL,
              forecast_months TEXT NULL,
              metrics TEXT NOT NULL DEFAULT '{{}}',
              summary TEXT NOT NULL DEFAULT '{{}}',
              created_at BIGINT NOT NULL,
              finished_at BIGINT NULL
            )
            """
        )
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {ML_FORECASTS_TABLE} (
              id BIGSERIAL PRIMARY KEY,
              run_id BIGINT NOT NULL REFERENCES {ML_RUNS_TABLE}(id) ON DELETE CASCADE,
              idproduto TEXT NOT NULL,
              referencia TEXT NULL,
              curva_abc TEXT NULL,
              ano INT NOT NULL,
              mes INT NOT NULL,
              qtd FLOAT NOT NULL DEFAULT 0
            )
            """
        )
        cur.execute(
            f"""
            CREATE INDEX IF NOT EXISTS idx_{ML_FORECASTS_TABLE}_run_id
            ON {ML_FORECASTS_TABLE}(run_id)
            """
        )
        cur.execute(
            f"""
            CREATE INDEX IF NOT EXISTS idx_{ML_FORECASTS_TABLE}_produto_mes
            ON {ML_FORECASTS_TABLE}(idproduto, ano, mes)
            """
        )


def build_summary(forecast_df):
    return {
        "forecast_rows": int(len(forecast_df)),
        "sku_count": int(forecast_df["idproduto"].nunique() if not forecast_df.empty else 0),
        "total_qtd": int(round(float(forecast_df["qtd"].sum()))) if not forecast_df.empty else 0,
    }


def persist_pipeline_run(metrics: dict, forecast_df, source_type: str = "python_pipeline") -> int:
    if forecast_df is None or forecast_df.empty:
        raise ValueError("Forecast dataframe is empty. Nothing to persist.")

    now = int(datetime.now().timestamp() * 1000)
    forecast_year = int(forecast_df["ano"].iloc[0])
    forecast_months = sorted(int(value) for value in forecast_df["mes"].unique().tolist())
    summary = build_summary(forecast_df)
    run_name = f"ML Forecast {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}"

    rows = [
        (
            str(row["idproduto"]),
            str(row.get("referencia", "") or ""),
            str(row.get("curva_abc", "") or ""),
            int(row["ano"]),
            int(row["mes"]),
            float(row["qtd"]),
        )
        for _, row in forecast_df.iterrows()
    ]

    with get_connection() as conn:
        ensure_tables(conn)
        with conn.cursor() as cur:
            cur.execute(
                f"""
                INSERT INTO {ML_RUNS_TABLE} (
                  nome, source_type, status, model_version, forecast_year, forecast_months,
                  metrics, summary, created_at, finished_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    run_name,
                    source_type,
                    "completed",
                    MODEL_VERSION,
                    forecast_year,
                    json.dumps(forecast_months),
                    json.dumps(metrics or {}),
                    json.dumps(summary),
                    now,
                    now,
                ),
            )
            run_id = int(cur.fetchone()[0])
            cur.executemany(
                f"""
                INSERT INTO {ML_FORECASTS_TABLE} (
                  run_id, idproduto, referencia, curva_abc, ano, mes, qtd
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                [(run_id, *row) for row in rows],
            )
        conn.commit()

    return run_id
