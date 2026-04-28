"""
ML Model Hyperparameter Optimization

Otimização avançada de hiperparâmetros usando:
- Optuna para busca bayesiana
- Cross-validation temporal
- Comparação entre XGBoost e LightGBM
- Feature selection automática
- Recomendações de melhoria

Execute: python ml/optimize.py
"""
from __future__ import annotations

import json
import warnings
from pathlib import Path
from typing import Callable

import joblib
import numpy as np
import optuna
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import TimeSeriesSplit

from config import DATA_DIR, MODELS_DIR, OUTPUT_DIR, TARGET_COLUMN, TRAIN_END
from train import FEATURES_CURVE_A, FEATURES_CURVE_B, FEATURES_GROUP

warnings.filterwarnings("ignore")
optuna.logging.set_verbosity(optuna.logging.WARNING)

OPTIMIZE_DIR = OUTPUT_DIR / "optimization"
OPTIMIZE_DIR.mkdir(parents=True, exist_ok=True)

# Tentar importar LightGBM (opcional)
try:
    import lightgbm as lgb
    HAS_LIGHTGBM = True
except ImportError:
    HAS_LIGHTGBM = False
    print("[optimize] LightGBM não instalado, usando apenas XGBoost")


def compute_mape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Calcula MAPE evitando divisão por zero."""
    mask = y_true > 0
    if mask.sum() == 0:
        return 0.0
    return float(np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])))


def evaluate_predictions(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    """Calcula todas as métricas de avaliação."""
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


def temporal_cross_validation(
    X: pd.DataFrame,
    y: pd.Series,
    model_fn: Callable,
    n_splits: int = 5,
) -> dict:
    """
    Cross-validation temporal para séries temporais.
    Usa TimeSeriesSplit para respeitar a ordem temporal.
    """
    tscv = TimeSeriesSplit(n_splits=n_splits)

    all_metrics = {"mae": [], "rmse": [], "mape": [], "r2": []}

    for train_idx, val_idx in tscv.split(X):
        X_train, X_val = X.iloc[train_idx], X.iloc[val_idx]
        y_train, y_val = y.iloc[train_idx], y.iloc[val_idx]

        model = model_fn()
        model.fit(X_train, y_train, verbose=False)
        preds = np.maximum(0.0, model.predict(X_val))

        metrics = evaluate_predictions(y_val.values, preds)
        for key in all_metrics:
            all_metrics[key].append(metrics[key])

    return {key: float(np.mean(vals)) for key, vals in all_metrics.items()}


class XGBoostOptimizer:
    """Otimizador de hiperparâmetros para XGBoost usando Optuna."""

    def __init__(self, X: pd.DataFrame, y: pd.Series, n_trials: int = 50):
        self.X = X
        self.y = y
        self.n_trials = n_trials
        self.best_params = None
        self.best_score = float("inf")

    def objective(self, trial: optuna.Trial) -> float:
        """Função objetivo para o Optuna."""
        params = {
            "n_estimators": trial.suggest_int("n_estimators", 50, 500),
            "max_depth": trial.suggest_int("max_depth", 3, 12),
            "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
            "min_child_weight": trial.suggest_int("min_child_weight", 1, 10),
            "subsample": trial.suggest_float("subsample", 0.6, 1.0),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.6, 1.0),
            "gamma": trial.suggest_float("gamma", 0, 5),
            "reg_alpha": trial.suggest_float("reg_alpha", 0, 2),
            "reg_lambda": trial.suggest_float("reg_lambda", 0, 2),
        }

        def model_fn():
            return xgb.XGBRegressor(
                objective="reg:squarederror",
                random_state=42,
                n_jobs=-1,
                **params,
            )

        metrics = temporal_cross_validation(self.X, self.y, model_fn, n_splits=5)

        # Usar MAPE como métrica principal
        score = metrics["mape"]

        if score < self.best_score:
            self.best_score = score
            self.best_params = params

        return score

    def optimize(self) -> dict:
        """Executa a otimização."""
        study = optuna.create_study(direction="minimize", study_name="xgboost_optimization")
        study.optimize(self.objective, n_trials=self.n_trials, show_progress_bar=True)

        return {
            "best_params": study.best_params,
            "best_mape": study.best_value,
            "n_trials": self.n_trials,
            "optimization_history": [
                {"trial": t.number, "mape": t.value}
                for t in study.trials
            ],
        }


class LightGBMOptimizer:
    """Otimizador de hiperparâmetros para LightGBM usando Optuna."""

    def __init__(self, X: pd.DataFrame, y: pd.Series, n_trials: int = 50):
        self.X = X
        self.y = y
        self.n_trials = n_trials
        self.best_params = None
        self.best_score = float("inf")

    def objective(self, trial: optuna.Trial) -> float:
        """Função objetivo para o Optuna."""
        params = {
            "n_estimators": trial.suggest_int("n_estimators", 50, 500),
            "max_depth": trial.suggest_int("max_depth", 3, 12),
            "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
            "num_leaves": trial.suggest_int("num_leaves", 10, 150),
            "min_child_samples": trial.suggest_int("min_child_samples", 5, 100),
            "subsample": trial.suggest_float("subsample", 0.6, 1.0),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.6, 1.0),
            "reg_alpha": trial.suggest_float("reg_alpha", 0, 2),
            "reg_lambda": trial.suggest_float("reg_lambda", 0, 2),
        }

        def model_fn():
            return lgb.LGBMRegressor(
                objective="regression",
                random_state=42,
                n_jobs=-1,
                verbosity=-1,
                **params,
            )

        metrics = temporal_cross_validation(self.X, self.y, model_fn, n_splits=5)
        score = metrics["mape"]

        if score < self.best_score:
            self.best_score = score
            self.best_params = params

        return score

    def optimize(self) -> dict:
        """Executa a otimização."""
        study = optuna.create_study(direction="minimize", study_name="lightgbm_optimization")
        study.optimize(self.objective, n_trials=self.n_trials, show_progress_bar=True)

        return {
            "best_params": study.best_params,
            "best_mape": study.best_value,
            "n_trials": self.n_trials,
        }


def feature_importance_selection(
    X: pd.DataFrame,
    y: pd.Series,
    threshold: float = 0.01,
) -> list[str]:
    """
    Seleciona features com importância acima do threshold.
    Remove features com baixa contribuição.
    """
    model = xgb.XGBRegressor(
        n_estimators=100,
        max_depth=6,
        learning_rate=0.1,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X, y, verbose=False)

    importance = pd.DataFrame({
        "feature": X.columns,
        "importance": model.feature_importances_,
    }).sort_values("importance", ascending=False)

    # Manter features acima do threshold
    selected = importance[importance["importance"] >= threshold]["feature"].tolist()

    print(f"  Features selecionadas: {len(selected)}/{len(X.columns)}")
    print(f"  Removidas: {importance[importance['importance'] < threshold]['feature'].tolist()}")

    return selected


def compare_models(X: pd.DataFrame, y: pd.Series, features: list[str]) -> dict:
    """
    Compara diferentes modelos e configurações.
    """
    results = {}
    X_subset = X[features].fillna(0.0)

    # 1. XGBoost padrão
    print("  Testando XGBoost padrão...")
    def xgb_default():
        return xgb.XGBRegressor(
            n_estimators=200,
            max_depth=6,
            learning_rate=0.1,
            random_state=42,
            n_jobs=-1,
        )
    results["xgboost_default"] = temporal_cross_validation(X_subset, y, xgb_default)

    # 2. XGBoost conservador (menos overfitting)
    print("  Testando XGBoost conservador...")
    def xgb_conservative():
        return xgb.XGBRegressor(
            n_estimators=100,
            max_depth=4,
            learning_rate=0.05,
            min_child_weight=5,
            subsample=0.8,
            colsample_bytree=0.8,
            reg_alpha=0.5,
            reg_lambda=1.0,
            random_state=42,
            n_jobs=-1,
        )
    results["xgboost_conservative"] = temporal_cross_validation(X_subset, y, xgb_conservative)

    # 3. XGBoost agressivo (mais complexo)
    print("  Testando XGBoost agressivo...")
    def xgb_aggressive():
        return xgb.XGBRegressor(
            n_estimators=500,
            max_depth=10,
            learning_rate=0.15,
            min_child_weight=1,
            subsample=0.9,
            colsample_bytree=0.9,
            random_state=42,
            n_jobs=-1,
        )
    results["xgboost_aggressive"] = temporal_cross_validation(X_subset, y, xgb_aggressive)

    # 4. LightGBM (se disponível)
    if HAS_LIGHTGBM:
        print("  Testando LightGBM...")
        def lgb_default():
            return lgb.LGBMRegressor(
                n_estimators=200,
                max_depth=6,
                learning_rate=0.1,
                random_state=42,
                n_jobs=-1,
                verbosity=-1,
            )
        results["lightgbm_default"] = temporal_cross_validation(X_subset, y, lgb_default)

    return results


def generate_recommendations(
    current_metrics: dict,
    optimization_results: dict,
    model_comparison: dict,
) -> list[str]:
    """
    Gera recomendações baseadas nos resultados da otimização.
    """
    recommendations = []

    # 1. Análise de MAPE atual vs otimizado
    if "best_mape" in optimization_results:
        current_mape = current_metrics.get("mape", 1.0)
        best_mape = optimization_results["best_mape"]
        improvement = (current_mape - best_mape) / current_mape * 100

        if improvement > 5:
            recommendations.append(
                f"✅ OTIMIZAÇÃO RECOMENDADA: Redução potencial de {improvement:.1f}% no MAPE "
                f"(de {current_mape:.2%} para {best_mape:.2%})"
            )

    # 2. Comparação de modelos
    if model_comparison:
        best_model = min(model_comparison.items(), key=lambda x: x[1]["mape"])
        worst_model = max(model_comparison.items(), key=lambda x: x[1]["mape"])

        recommendations.append(
            f"📊 MELHOR MODELO: {best_model[0]} com MAPE={best_model[1]['mape']:.2%}"
        )

        if best_model[0] != "xgboost_default":
            recommendations.append(
                f"   Considere trocar para {best_model[0]} para melhor performance"
            )

    # 3. Análise de overfitting
    if model_comparison:
        conservative = model_comparison.get("xgboost_conservative", {})
        aggressive = model_comparison.get("xgboost_aggressive", {})

        if conservative and aggressive:
            if conservative["mape"] < aggressive["mape"]:
                recommendations.append(
                    "⚠️ OVERFITTING DETECTADO: Modelo conservador está melhor. "
                    "Considere reduzir complexidade."
                )
            else:
                recommendations.append(
                    "✅ Modelo agressivo não mostra overfitting significativo."
                )

    # 4. Recomendações de features
    recommendations.append(
        "\n📝 RECOMENDAÇÕES GERAIS:"
    )
    recommendations.append(
        "   1. Execute feature_importance_selection() para remover features pouco importantes"
    )
    recommendations.append(
        "   2. Considere adicionar mais features de sazonalidade (feriados, eventos)"
    )
    recommendations.append(
        "   3. Teste ensemble de modelos (média das previsões)"
    )
    recommendations.append(
        "   4. Adicione features de tendência de mercado se disponíveis"
    )

    # 5. Sugestões de dados
    recommendations.append(
        "\n📊 RECOMENDAÇÕES DE DADOS:"
    )
    recommendations.append(
        "   1. Verifique SKUs com alta variabilidade (std_6m alto)"
    )
    recommendations.append(
        "   2. Considere separar modelos por família/linha para maior precisão"
    )
    recommendations.append(
        "   3. Avalie se há outliers que precisam de tratamento especial"
    )

    return recommendations


def optimize_curve(
    df: pd.DataFrame,
    curve: str,
    features: list[str],
    n_trials: int = 30,
) -> dict:
    """
    Otimiza hiperparâmetros para uma curva específica.
    """
    print(f"\n{'='*60}")
    print(f"OTIMIZAÇÃO - CURVA {curve}")
    print(f"{'='*60}")

    # Filtrar dados
    if curve == "C/D":
        from config import GROUP_COLUMN
        subset = df[df["curva_abc"].isin(["C", "D"])].copy()
        # Agregar por grupo
        group_df = (
            subset.groupby([GROUP_COLUMN, "periodo"], as_index=False)
            .agg({col: "first" for col in features if col in subset.columns})
        )
        group_df[TARGET_COLUMN] = subset.groupby([GROUP_COLUMN, "periodo"])[TARGET_COLUMN].sum().values
        X = group_df[features].fillna(0.0)
        y = group_df[TARGET_COLUMN].fillna(0.0)
    else:
        subset = df[df["curva_abc"] == curve].copy()
        X = subset[features].fillna(0.0)
        y = subset[TARGET_COLUMN].fillna(0.0)

    if len(X) < 100:
        print(f"  Poucos dados para otimização ({len(X)} amostras)")
        return {}

    print(f"  Amostras: {len(X):,}")

    # 1. Comparação de modelos
    print("\n[optimize] Comparando modelos...")
    comparison = compare_models(X, y, features)

    print("\n  Resultados da comparação:")
    for model_name, metrics in sorted(comparison.items(), key=lambda x: x[1]["mape"]):
        print(f"    {model_name}: MAPE={metrics['mape']:.2%} R²={metrics['r2']:.4f}")

    # 2. Otimização XGBoost
    print(f"\n[optimize] Otimizando XGBoost ({n_trials} trials)...")
    xgb_optimizer = XGBoostOptimizer(X, y, n_trials=n_trials)
    xgb_results = xgb_optimizer.optimize()

    print(f"  Melhor MAPE: {xgb_results['best_mape']:.2%}")
    print(f"  Melhores parâmetros: {json.dumps(xgb_results['best_params'], indent=4)}")

    # 3. Otimização LightGBM (se disponível)
    lgb_results = None
    if HAS_LIGHTGBM:
        print(f"\n[optimize] Otimizando LightGBM ({n_trials} trials)...")
        lgb_optimizer = LightGBMOptimizer(X, y, n_trials=n_trials)
        lgb_results = lgb_optimizer.optimize()
        print(f"  Melhor MAPE: {lgb_results['best_mape']:.2%}")

    # 4. Feature selection
    print("\n[optimize] Selecionando features importantes...")
    selected_features = feature_importance_selection(X, y, threshold=0.01)

    # 5. Métricas atuais (do modelo já treinado)
    artifacts = joblib.load(MODELS_DIR / "forecast_models.pkl")
    curve_key = f"curve_{curve.lower().replace('/', '')}"
    current_metrics = artifacts.get(curve_key, {}).get("metrics", {})

    # 6. Gerar recomendações
    recommendations = generate_recommendations(
        current_metrics=current_metrics,
        optimization_results=xgb_results,
        model_comparison=comparison,
    )

    print("\n" + "=" * 60)
    print("RECOMENDAÇÕES")
    print("=" * 60)
    for rec in recommendations:
        print(rec)

    return {
        "curve": curve,
        "n_samples": len(X),
        "current_metrics": current_metrics,
        "model_comparison": comparison,
        "xgboost_optimization": xgb_results,
        "lightgbm_optimization": lgb_results,
        "selected_features": selected_features,
        "recommendations": recommendations,
    }


def run_full_optimization(n_trials: int = 30):
    """
    Executa otimização completa para todas as curvas.
    """
    print("=" * 60)
    print("ML HYPERPARAMETER OPTIMIZATION")
    print("=" * 60)

    # Carregar dados
    features_path = DATA_DIR / "features.parquet"
    if not features_path.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {features_path}")

    df = pd.read_parquet(features_path).sort_values(["idproduto", "periodo"])

    # Filtrar apenas período de treino
    train_mask = (df["ano"] < TRAIN_END[0]) | ((df["ano"] == TRAIN_END[0]) & (df["mes"] <= TRAIN_END[1]))
    df_train = df[train_mask].copy()

    print(f"[optimize] Dados de treino: {len(df_train):,} amostras")

    all_results = {}

    # Otimizar cada curva
    for curve, features in [
        ("A", FEATURES_CURVE_A),
        ("B", FEATURES_CURVE_B),
        ("C/D", FEATURES_GROUP),
    ]:
        try:
            results = optimize_curve(df_train, curve, features, n_trials=n_trials)
            all_results[curve] = results
        except Exception as e:
            print(f"  Erro na curva {curve}: {e}")
            all_results[curve] = {"error": str(e)}

    # Salvar resultados
    results_path = OPTIMIZE_DIR / "optimization_results.json"

    # Converter para JSON-serializable
    json_results = {}
    for curve, res in all_results.items():
        json_results[curve] = {
            k: v for k, v in res.items()
            if k not in ["optimization_history"]  # Excluir histórico grande
        }

    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(json_results, f, indent=2, default=str)

    print(f"\n[optimize] Resultados salvos em: {results_path}")

    # Resumo final
    print("\n" + "=" * 60)
    print("RESUMO FINAL")
    print("=" * 60)

    for curve, res in all_results.items():
        if "error" not in res:
            current = res.get("current_metrics", {}).get("mape", 0)
            best = res.get("xgboost_optimization", {}).get("best_mape", 0)
            if current and best:
                improvement = (current - best) / current * 100
                print(f"\nCurva {curve}:")
                print(f"  MAPE Atual: {current:.2%}")
                print(f"  MAPE Otimizado: {best:.2%}")
                print(f"  Melhoria Potencial: {improvement:.1f}%")

    return all_results


def quick_test(curve: str = "A", n_trials: int = 10):
    """
    Teste rápido de otimização para uma curva específica.
    """
    print(f"[optimize] Teste rápido para Curva {curve}...")

    features_path = DATA_DIR / "features.parquet"
    df = pd.read_parquet(features_path).sort_values(["idproduto", "periodo"])

    train_mask = (df["ano"] < TRAIN_END[0]) | ((df["ano"] == TRAIN_END[0]) & (df["mes"] <= TRAIN_END[1]))
    df_train = df[train_mask].copy()

    if curve == "A":
        features = FEATURES_CURVE_A
    elif curve == "B":
        features = FEATURES_CURVE_B
    else:
        features = FEATURES_GROUP

    return optimize_curve(df_train, curve, features, n_trials=n_trials)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Otimização de hiperparâmetros do modelo ML")
    parser.add_argument("--trials", type=int, default=30, help="Número de trials do Optuna")
    parser.add_argument("--quick", action="store_true", help="Teste rápido com 10 trials")
    parser.add_argument("--curve", type=str, default=None, help="Curva específica (A, B, CD)")

    args = parser.parse_args()

    if args.quick:
        curve = args.curve or "A"
        quick_test(curve=curve, n_trials=10)
    elif args.curve:
        features_path = DATA_DIR / "features.parquet"
        df = pd.read_parquet(features_path)
        train_mask = (df["ano"] < TRAIN_END[0]) | ((df["ano"] == TRAIN_END[0]) & (df["mes"] <= TRAIN_END[1]))
        df_train = df[train_mask].copy()

        if args.curve == "A":
            features = FEATURES_CURVE_A
        elif args.curve == "B":
            features = FEATURES_CURVE_B
        else:
            features = FEATURES_GROUP

        optimize_curve(df_train, args.curve, features, n_trials=args.trials)
    else:
        run_full_optimization(n_trials=args.trials)
