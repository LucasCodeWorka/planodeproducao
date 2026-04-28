"""
End-to-end pipeline runner.
"""
from __future__ import annotations

import argparse

from evaluate import run_evaluation
from extract import run_extraction
from features import run_feature_engineering
from persist import persist_pipeline_run
from predict import run_prediction
from train import run_training


def run_pipeline(persist_db: bool = True):
    run_extraction()
    run_feature_engineering()
    run_training()
    metrics = run_evaluation()
    forecast_df = run_prediction()

    run_id = None
    if persist_db:
        run_id = persist_pipeline_run(metrics=metrics, forecast_df=forecast_df)
        print(f"[main] persisted ML run to database with run_id={run_id}")

    return {
        "metrics": metrics,
        "forecast_rows": len(forecast_df),
        "run_id": run_id,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the ML forecasting pipeline.")
    parser.add_argument("--no-persist-db", action="store_true", help="Do not persist results to PostgreSQL.")
    args = parser.parse_args()
    run_pipeline(persist_db=not args.no_persist_db)
