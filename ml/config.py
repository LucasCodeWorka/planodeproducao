"""
Central configuration for the sales forecasting pipeline.
"""
import os
from pathlib import Path

from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parent.parent
ML_DIR = Path(__file__).resolve().parent
DATA_DIR = ML_DIR / "data"
MODELS_DIR = ML_DIR / "models"
OUTPUT_DIR = ML_DIR / "output"

for directory in (DATA_DIR, MODELS_DIR, OUTPUT_DIR):
    directory.mkdir(parents=True, exist_ok=True)

load_dotenv(ROOT_DIR / ".env")

DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", "5432")),
    "database": os.getenv("DB_NAME", "postgres"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", ""),
}

COMPANY_ID = int(os.getenv("DB_COMPANY_ID", "1"))
HISTORY_MONTHS = int(os.getenv("ML_HISTORY_MONTHS", "36"))
FORECAST_YEAR = int(os.getenv("ML_FORECAST_YEAR", "2026"))
FORECAST_MONTHS = [7, 8, 9, 10, 11]
TRAIN_END = (2025, 12)

VALID_CONTINUITIES = {
    "PERMANENTE",
    "PERMANENTE COR NOVA",
}
VALID_STATUS = {
    "EM LINHA",
}
VALID_BRAND = "LIEBE"
EXCLUDED_SITUATIONS = {"007"}
EXCLUDED_SIZE_LABELS = {"PT 99"}
EXCLUDED_REFERENCE_CODES = {"0114", "0138", "0139", "0140", "0171", "0172"}
EXCLUDED_PRODUCT_TERMS = {
    "MEIA DE SEDA",
    "FARDA BABYLOOK",
    "EXTENSOR 30MM",
    "EXTENSOR 40MM",
    "EXTENSOR 60MM",
    "ADESIVO DE VITRINE",
    "URNA LIEBE PAPELAO",
}

MODEL_CONFIG = {
    "random_state": 42,
    "curve_a": {
        "n_estimators": 350,
        "max_depth": 6,
        "learning_rate": 0.05,
        "subsample": 0.9,
        "colsample_bytree": 0.9,
    },
    "curve_b": {
        "n_estimators": 220,
        "max_depth": 4,
        "learning_rate": 0.06,
        "subsample": 0.9,
        "colsample_bytree": 0.9,
    },
    "curve_cd": {
        "n_estimators": 160,
        "max_depth": 4,
        "learning_rate": 0.06,
        "subsample": 0.9,
        "colsample_bytree": 0.9,
    },
}

TARGET_COLUMN = "qtd_mensal"
GROUP_COLUMN = "grupo"
MODEL_VERSION = "v1"
