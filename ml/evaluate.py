"""
Evaluation helpers for trained models.
"""
from __future__ import annotations

import json

from config import MODELS_DIR


def run_evaluation() -> dict:
    metrics_path = MODELS_DIR / "metrics.json"
    if not metrics_path.exists():
        raise FileNotFoundError(f"Missing metrics file: {metrics_path}")

    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))

    print("=" * 60)
    print("ML EVALUATION")
    print("=" * 60)
    for model_name, values in metrics.items():
        print(
            f"[evaluate] {model_name}: "
            f"MAE={values['mae']:.2f} RMSE={values['rmse']:.2f} "
            f"MAPE={values['mape']:.2%} R2={values['r2']:.4f}"
        )

    return metrics


if __name__ == "__main__":
    run_evaluation()
