"""
ML Model Diagnostics Dashboard

Análise completa do modelo de projeção de vendas:
- Gráficos de regressão (predito vs real)
- Análise de resíduos
- Detecção de anomalias e ruídos
- Importância de features
- Análise de erros por segmento

Execute: python ml/diagnostics.py
"""
from __future__ import annotations

import json
import warnings
from pathlib import Path

import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from scipy import stats
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

from config import DATA_DIR, MODELS_DIR, OUTPUT_DIR, TARGET_COLUMN, TRAIN_END

warnings.filterwarnings("ignore")

# Configurar estilo dos gráficos
plt.style.use("seaborn-v0_8-whitegrid")
sns.set_palette("husl")

DIAGNOSTICS_DIR = OUTPUT_DIR / "diagnostics"
DIAGNOSTICS_DIR.mkdir(parents=True, exist_ok=True)


def load_data_and_models():
    """Carrega dados e modelos treinados."""
    print("[diagnostics] Carregando dados e modelos...")

    features_path = DATA_DIR / "features.parquet"
    models_path = MODELS_DIR / "forecast_models.pkl"

    if not features_path.exists():
        raise FileNotFoundError(f"Arquivo de features não encontrado: {features_path}")
    if not models_path.exists():
        raise FileNotFoundError(f"Modelos não encontrados: {models_path}")

    df = pd.read_parquet(features_path).sort_values(["idproduto", "periodo"])
    artifacts = joblib.load(models_path)

    return df, artifacts


def split_train_test(df: pd.DataFrame):
    """Divide dados em treino/teste."""
    train_mask = (df["ano"] < TRAIN_END[0]) | ((df["ano"] == TRAIN_END[0]) & (df["mes"] <= TRAIN_END[1]))
    return df[train_mask].copy(), df[~train_mask].copy()


def compute_predictions(df: pd.DataFrame, model, features: list[str]) -> np.ndarray:
    """Gera predições usando o modelo."""
    X = df[features].fillna(0.0)
    return np.maximum(0.0, model.predict(X))


def plot_regression_analysis(y_true, y_pred, title: str, filename: str):
    """
    Gráfico de regressão: Predito vs Real com linha de identidade.
    """
    fig, axes = plt.subplots(1, 3, figsize=(18, 5))

    # 1. Scatter plot Predito vs Real
    ax1 = axes[0]
    ax1.scatter(y_true, y_pred, alpha=0.3, s=10, color="steelblue")

    # Linha de identidade (perfeita previsão)
    max_val = max(y_true.max(), y_pred.max())
    ax1.plot([0, max_val], [0, max_val], "r--", linewidth=2, label="Perfeito (y=x)")

    # Linha de regressão
    if len(y_true) > 10:
        z = np.polyfit(y_true, y_pred, 1)
        p = np.poly1d(z)
        x_line = np.linspace(0, max_val, 100)
        ax1.plot(x_line, p(x_line), "g-", linewidth=2, alpha=0.7,
                 label=f"Regressão (slope={z[0]:.2f})")

    ax1.set_xlabel("Valor Real", fontsize=12)
    ax1.set_ylabel("Valor Predito", fontsize=12)
    ax1.set_title(f"{title}\nPredito vs Real", fontsize=14)
    ax1.legend()
    ax1.grid(True, alpha=0.3)

    # Métricas no gráfico
    r2 = r2_score(y_true, y_pred)
    mae = mean_absolute_error(y_true, y_pred)
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    textstr = f'R² = {r2:.4f}\nMAE = {mae:.1f}\nRMSE = {rmse:.1f}'
    ax1.text(0.05, 0.95, textstr, transform=ax1.transAxes, fontsize=10,
             verticalalignment='top', bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))

    # 2. Resíduos vs Predito (Homoscedasticidade)
    ax2 = axes[1]
    residuals = y_true - y_pred
    ax2.scatter(y_pred, residuals, alpha=0.3, s=10, color="coral")
    ax2.axhline(y=0, color="red", linestyle="--", linewidth=2)
    ax2.set_xlabel("Valor Predito", fontsize=12)
    ax2.set_ylabel("Resíduo (Real - Predito)", fontsize=12)
    ax2.set_title("Análise de Resíduos\n(Homoscedasticidade)", fontsize=14)
    ax2.grid(True, alpha=0.3)

    # Linhas de ±2 desvios padrão
    std_res = np.std(residuals)
    ax2.axhline(y=2*std_res, color="orange", linestyle=":", alpha=0.7, label=f"+2σ ({2*std_res:.0f})")
    ax2.axhline(y=-2*std_res, color="orange", linestyle=":", alpha=0.7, label=f"-2σ ({-2*std_res:.0f})")
    ax2.legend(fontsize=9)

    # 3. Distribuição dos Resíduos (Normalidade)
    ax3 = axes[2]
    ax3.hist(residuals, bins=50, density=True, alpha=0.7, color="lightblue", edgecolor="steelblue")

    # Curva normal teórica
    mu, sigma = np.mean(residuals), np.std(residuals)
    x = np.linspace(residuals.min(), residuals.max(), 100)
    ax3.plot(x, stats.norm.pdf(x, mu, sigma), 'r-', linewidth=2, label='Normal teórica')

    ax3.set_xlabel("Resíduo", fontsize=12)
    ax3.set_ylabel("Densidade", fontsize=12)
    ax3.set_title("Distribuição dos Resíduos\n(Normalidade)", fontsize=14)
    ax3.legend()

    # Teste de normalidade
    if len(residuals) > 20 and len(residuals) < 5000:
        _, p_value = stats.shapiro(residuals[:min(5000, len(residuals))])
        ax3.text(0.95, 0.95, f'Shapiro p={p_value:.4f}', transform=ax3.transAxes,
                 fontsize=9, ha='right', va='top',
                 bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))

    plt.tight_layout()
    plt.savefig(DIAGNOSTICS_DIR / filename, dpi=150, bbox_inches='tight')
    plt.close()
    print(f"  Salvo: {filename}")


def plot_anomaly_detection(df: pd.DataFrame, y_true, y_pred, title: str, filename: str):
    """
    Detecção de anomalias e outliers.
    """
    fig, axes = plt.subplots(2, 2, figsize=(14, 12))

    residuals = y_true - y_pred
    abs_error = np.abs(residuals)
    pct_error = np.where(y_true > 0, abs_error / y_true * 100, 0)

    # 1. Boxplot de erros por mês
    ax1 = axes[0, 0]
    df_plot = pd.DataFrame({
        "mes": df["mes"].values,
        "erro_abs": abs_error,
        "erro_pct": pct_error
    })
    df_plot.boxplot(column="erro_abs", by="mes", ax=ax1)
    ax1.set_xlabel("Mês", fontsize=12)
    ax1.set_ylabel("Erro Absoluto", fontsize=12)
    ax1.set_title(f"{title}\nErro Absoluto por Mês", fontsize=14)
    plt.suptitle("")  # Remove título automático

    # 2. Detecção de outliers (IQR)
    ax2 = axes[0, 1]
    Q1 = np.percentile(abs_error, 25)
    Q3 = np.percentile(abs_error, 75)
    IQR = Q3 - Q1
    outlier_threshold = Q3 + 1.5 * IQR
    is_outlier = abs_error > outlier_threshold

    ax2.scatter(y_true[~is_outlier], y_pred[~is_outlier], alpha=0.3, s=10,
                color="steelblue", label=f"Normal ({(~is_outlier).sum():,})")
    ax2.scatter(y_true[is_outlier], y_pred[is_outlier], alpha=0.7, s=30,
                color="red", marker="x", label=f"Outliers ({is_outlier.sum():,})")

    max_val = max(y_true.max(), y_pred.max())
    ax2.plot([0, max_val], [0, max_val], "g--", linewidth=1, alpha=0.7)
    ax2.set_xlabel("Valor Real", fontsize=12)
    ax2.set_ylabel("Valor Predito", fontsize=12)
    ax2.set_title(f"Detecção de Outliers\n(IQR method, threshold={outlier_threshold:.0f})", fontsize=14)
    ax2.legend()

    # 3. Distribuição de erros percentuais
    ax3 = axes[1, 0]
    # Limitar a 200% para visualização
    pct_error_clipped = np.clip(pct_error, 0, 200)
    ax3.hist(pct_error_clipped, bins=50, alpha=0.7, color="salmon", edgecolor="darkred")
    ax3.axvline(x=20, color="green", linestyle="--", linewidth=2, label="Meta 20%")
    ax3.axvline(x=50, color="orange", linestyle="--", linewidth=2, label="Alerta 50%")
    ax3.set_xlabel("Erro Percentual (%)", fontsize=12)
    ax3.set_ylabel("Frequência", fontsize=12)
    ax3.set_title("Distribuição de Erros Percentuais\n(Clipped em 200%)", fontsize=14)
    ax3.legend()

    # Estatísticas
    within_20 = (pct_error <= 20).mean() * 100
    within_50 = (pct_error <= 50).mean() * 100
    textstr = f'Dentro de 20%: {within_20:.1f}%\nDentro de 50%: {within_50:.1f}%'
    ax3.text(0.95, 0.95, textstr, transform=ax3.transAxes, fontsize=10,
             ha='right', va='top', bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))

    # 4. Q-Q Plot (normalidade dos resíduos)
    ax4 = axes[1, 1]
    stats.probplot(residuals, dist="norm", plot=ax4)
    ax4.set_title("Q-Q Plot dos Resíduos\n(Normalidade)", fontsize=14)
    ax4.grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig(DIAGNOSTICS_DIR / filename, dpi=150, bbox_inches='tight')
    plt.close()
    print(f"  Salvo: {filename}")


def plot_feature_importance(importance_df: pd.DataFrame, title: str, filename: str):
    """
    Gráfico de importância das features.
    """
    fig, ax = plt.subplots(figsize=(12, 8))

    # Top 15 features
    top_features = importance_df.head(15).sort_values("importance", ascending=True)

    colors = plt.cm.RdYlGn(np.linspace(0.2, 0.8, len(top_features)))[::-1]
    bars = ax.barh(top_features["feature"], top_features["importance"], color=colors)

    ax.set_xlabel("Importância", fontsize=12)
    ax.set_ylabel("Feature", fontsize=12)
    ax.set_title(f"{title}\nImportância das Features (Top 15)", fontsize=14)

    # Adicionar valores nas barras
    for bar, val in zip(bars, top_features["importance"]):
        ax.text(val + 0.005, bar.get_y() + bar.get_height()/2,
                f'{val:.3f}', va='center', fontsize=9)

    plt.tight_layout()
    plt.savefig(DIAGNOSTICS_DIR / filename, dpi=150, bbox_inches='tight')
    plt.close()
    print(f"  Salvo: {filename}")


def plot_error_by_segment(df: pd.DataFrame, y_true, y_pred, segment_col: str, title: str, filename: str):
    """
    Análise de erros por segmento (curva, linha, família).
    """
    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    df_plot = pd.DataFrame({
        "segment": df[segment_col].values,
        "y_true": y_true,
        "y_pred": y_pred,
        "error": y_true - y_pred,
        "abs_error": np.abs(y_true - y_pred),
        "pct_error": np.where(y_true > 0, np.abs(y_true - y_pred) / y_true * 100, 0)
    })

    # 1. MAPE por segmento
    ax1 = axes[0]
    segment_metrics = df_plot.groupby("segment").agg({
        "abs_error": "mean",
        "pct_error": lambda x: np.mean(x[x < 500]),  # Excluir extremos
        "y_true": "count"
    }).rename(columns={"y_true": "count"})
    segment_metrics = segment_metrics.sort_values("pct_error")

    colors = plt.cm.RdYlGn_r(np.linspace(0.2, 0.8, len(segment_metrics)))
    bars = ax1.bar(segment_metrics.index, segment_metrics["pct_error"], color=colors)
    ax1.axhline(y=20, color="green", linestyle="--", linewidth=2, label="Meta 20%")
    ax1.set_xlabel(segment_col.replace("_", " ").title(), fontsize=12)
    ax1.set_ylabel("MAPE (%)", fontsize=12)
    ax1.set_title(f"Erro Percentual por {segment_col.replace('_', ' ').title()}", fontsize=14)
    ax1.legend()
    plt.setp(ax1.xaxis.get_majorticklabels(), rotation=45, ha='right')

    # 2. Quantidade de amostras por segmento
    ax2 = axes[1]
    ax2.bar(segment_metrics.index, segment_metrics["count"], color="lightblue", edgecolor="steelblue")
    ax2.set_xlabel(segment_col.replace("_", " ").title(), fontsize=12)
    ax2.set_ylabel("Quantidade de Amostras", fontsize=12)
    ax2.set_title(f"Volume de Dados por {segment_col.replace('_', ' ').title()}", fontsize=14)
    plt.setp(ax2.xaxis.get_majorticklabels(), rotation=45, ha='right')

    plt.suptitle(title, fontsize=16, y=1.02)
    plt.tight_layout()
    plt.savefig(DIAGNOSTICS_DIR / filename, dpi=150, bbox_inches='tight')
    plt.close()
    print(f"  Salvo: {filename}")


def plot_temporal_analysis(df: pd.DataFrame, y_true, y_pred, title: str, filename: str):
    """
    Análise temporal das previsões.
    """
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))

    df_plot = pd.DataFrame({
        "periodo": df["periodo"].values,
        "mes": df["mes"].values,
        "ano": df["ano"].values,
        "y_true": y_true,
        "y_pred": y_pred,
        "error": y_true - y_pred
    })

    # 1. Série temporal agregada
    ax1 = axes[0, 0]
    monthly = df_plot.groupby("periodo").agg({
        "y_true": "sum",
        "y_pred": "sum"
    }).reset_index()

    ax1.plot(monthly["periodo"], monthly["y_true"], "b-", linewidth=2, label="Real", marker="o", markersize=4)
    ax1.plot(monthly["periodo"], monthly["y_pred"], "r--", linewidth=2, label="Predito", marker="s", markersize=4)
    ax1.set_xlabel("Período", fontsize=12)
    ax1.set_ylabel("Quantidade Total", fontsize=12)
    ax1.set_title("Série Temporal Agregada", fontsize=14)
    ax1.legend()
    ax1.tick_params(axis='x', rotation=45)

    # Linha vertical separando treino/teste
    train_end_date = pd.Timestamp(year=TRAIN_END[0], month=TRAIN_END[1], day=1)
    ax1.axvline(x=train_end_date, color="gray", linestyle=":", linewidth=2, label="Fim Treino")

    # 2. Erro médio por período
    ax2 = axes[0, 1]
    monthly_error = df_plot.groupby("periodo")["error"].mean().reset_index()
    colors = ["green" if e >= 0 else "red" for e in monthly_error["error"]]
    ax2.bar(monthly_error["periodo"], monthly_error["error"], color=colors, alpha=0.7)
    ax2.axhline(y=0, color="black", linestyle="-", linewidth=1)
    ax2.set_xlabel("Período", fontsize=12)
    ax2.set_ylabel("Erro Médio (Real - Predito)", fontsize=12)
    ax2.set_title("Viés Temporal\n(Positivo = Subestimando, Negativo = Superestimando)", fontsize=14)
    ax2.tick_params(axis='x', rotation=45)

    # 3. Sazonalidade do erro
    ax3 = axes[1, 0]
    monthly_pattern = df_plot.groupby("mes").agg({
        "y_true": "mean",
        "y_pred": "mean"
    }).reset_index()

    x = np.arange(1, 13)
    width = 0.35
    ax3.bar(x - width/2, monthly_pattern["y_true"], width, label="Real", color="steelblue")
    ax3.bar(x + width/2, monthly_pattern["y_pred"], width, label="Predito", color="coral")
    ax3.set_xlabel("Mês", fontsize=12)
    ax3.set_ylabel("Média", fontsize=12)
    ax3.set_title("Padrão Sazonal\nReal vs Predito", fontsize=14)
    ax3.set_xticks(x)
    ax3.legend()

    # 4. Erro por ano
    ax4 = axes[1, 1]
    yearly = df_plot.groupby("ano").agg({
        "y_true": "sum",
        "y_pred": "sum"
    }).reset_index()
    yearly["error_pct"] = (yearly["y_pred"] - yearly["y_true"]) / yearly["y_true"] * 100

    colors = ["coral" if e > 0 else "steelblue" for e in yearly["error_pct"]]
    ax4.bar(yearly["ano"].astype(str), yearly["error_pct"], color=colors)
    ax4.axhline(y=0, color="black", linestyle="-", linewidth=1)
    ax4.set_xlabel("Ano", fontsize=12)
    ax4.set_ylabel("Erro Percentual (%)", fontsize=12)
    ax4.set_title("Viés por Ano\n(Positivo = Superestimando)", fontsize=14)

    plt.suptitle(title, fontsize=16, y=1.02)
    plt.tight_layout()
    plt.savefig(DIAGNOSTICS_DIR / filename, dpi=150, bbox_inches='tight')
    plt.close()
    print(f"  Salvo: {filename}")


def generate_model_report(metrics: dict, curve: str) -> str:
    """Gera relatório textual do modelo."""
    report = []
    report.append(f"\n{'='*60}")
    report.append(f"ANÁLISE DO MODELO - CURVA {curve}")
    report.append(f"{'='*60}")

    report.append(f"\n📊 MÉTRICAS DE PERFORMANCE:")
    report.append(f"  • MAE (Erro Absoluto Médio): {metrics['mae']:.2f}")
    report.append(f"  • RMSE (Raiz do Erro Quadrático): {metrics['rmse']:.2f}")
    report.append(f"  • MAPE (Erro Percentual Médio): {metrics['mape']:.2%}")
    report.append(f"  • R² (Coef. Determinação): {metrics['r2']:.4f}")

    # Análise qualitativa
    report.append(f"\n📈 ANÁLISE QUALITATIVA:")

    # R²
    if metrics['r2'] >= 0.9:
        report.append(f"  ✅ R² Excelente (≥0.90): Modelo explica {metrics['r2']*100:.1f}% da variância")
    elif metrics['r2'] >= 0.7:
        report.append(f"  ✅ R² Bom (≥0.70): Modelo explica {metrics['r2']*100:.1f}% da variância")
    elif metrics['r2'] >= 0.5:
        report.append(f"  ⚠️ R² Moderado (≥0.50): Modelo explica apenas {metrics['r2']*100:.1f}% da variância")
    else:
        report.append(f"  ❌ R² Baixo (<0.50): Modelo tem baixo poder preditivo")

    # MAPE
    if metrics['mape'] <= 0.10:
        report.append(f"  ✅ MAPE Excelente (≤10%): Previsões muito precisas")
    elif metrics['mape'] <= 0.20:
        report.append(f"  ✅ MAPE Bom (≤20%): Previsões dentro da meta")
    elif metrics['mape'] <= 0.30:
        report.append(f"  ⚠️ MAPE Moderado (≤30%): Margem de melhoria")
    else:
        report.append(f"  ❌ MAPE Alto (>{metrics['mape']:.0%}): Requer ajustes")

    return "\n".join(report)


def run_full_diagnostics():
    """
    Executa diagnóstico completo do modelo.
    """
    print("=" * 60)
    print("ML MODEL DIAGNOSTICS")
    print("=" * 60)

    df, artifacts = load_data_and_models()
    _, test_df = split_train_test(df)

    full_report = []
    full_report.append("# RELATÓRIO DE DIAGNÓSTICO DO MODELO ML")
    full_report.append(f"Data: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    full_report.append(f"Período de Teste: após {TRAIN_END[0]}-{TRAIN_END[1]:02d}")

    # Processar cada curva
    for curve_key, curve_name in [("curve_a", "A"), ("curve_b", "B"), ("curve_cd", "C/D")]:
        print(f"\n[diagnostics] Processando Curva {curve_name}...")

        curve_data = artifacts.get(curve_key)
        if curve_data is None:
            print(f"  Curva {curve_name} não encontrada, pulando...")
            continue

        model = curve_data["model"]
        features = curve_data["features"]
        metrics = curve_data["metrics"]
        importance = curve_data.get("importance", pd.DataFrame())

        # Filtrar dados da curva
        if curve_name == "C/D":
            curve_df = test_df[test_df["curva_abc"].isin(["C", "D"])].copy()
        else:
            curve_df = test_df[test_df["curva_abc"] == curve_name].copy()

        if len(curve_df) < 10:
            print(f"  Poucos dados para curva {curve_name}, pulando gráficos...")
            continue

        # Para curva C/D, usar dados de grupo
        if curve_name == "C/D":
            from config import GROUP_COLUMN
            group_df = curve_df.groupby([GROUP_COLUMN, "periodo"], as_index=False).agg({
                "ano": "first",
                "mes": "first",
                "mes_sin": "first",
                "mes_cos": "first",
                "trimestre": "first",
                "media_grupo_3m": "first",
                "media_grupo_6m": "first",
                "qtd_grupo_ano_anterior": "first",
                "indice_sazonal_grupo": "first",
                TARGET_COLUMN: "sum"
            })
            y_true = group_df[TARGET_COLUMN].values
            y_pred = compute_predictions(group_df, model, features)
            plot_df = group_df
        else:
            y_true = curve_df[TARGET_COLUMN].values
            y_pred = compute_predictions(curve_df, model, features)
            plot_df = curve_df

        # Gerar gráficos
        print(f"  Gerando gráficos para Curva {curve_name}...")

        # 1. Análise de regressão
        plot_regression_analysis(
            y_true, y_pred,
            f"Curva {curve_name}",
            f"regression_curve_{curve_name.lower().replace('/', '')}.png"
        )

        # 2. Detecção de anomalias
        plot_anomaly_detection(
            plot_df, y_true, y_pred,
            f"Curva {curve_name}",
            f"anomalies_curve_{curve_name.lower().replace('/', '')}.png"
        )

        # 3. Importância das features
        if not importance.empty:
            plot_feature_importance(
                importance,
                f"Curva {curve_name}",
                f"importance_curve_{curve_name.lower().replace('/', '')}.png"
            )

        # 4. Análise temporal
        if "periodo" in plot_df.columns:
            plot_temporal_analysis(
                plot_df, y_true, y_pred,
                f"Curva {curve_name}",
                f"temporal_curve_{curve_name.lower().replace('/', '')}.png"
            )

        # 5. Erro por mês (se não for grupo)
        if curve_name != "C/D" and "mes" in plot_df.columns:
            plot_error_by_segment(
                plot_df, y_true, y_pred, "mes",
                f"Curva {curve_name}",
                f"error_by_month_curve_{curve_name.lower()}.png"
            )

        # Relatório textual
        full_report.append(generate_model_report(metrics, curve_name))

    # Salvar relatório
    report_path = DIAGNOSTICS_DIR / "diagnostic_report.txt"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(full_report))
    print(f"\n[diagnostics] Relatório salvo: {report_path}")

    # Gerar resumo visual
    generate_summary_dashboard(artifacts)

    print(f"\n[diagnostics] Todos os gráficos salvos em: {DIAGNOSTICS_DIR}")
    print("\n" + "\n".join(full_report))


def generate_summary_dashboard(artifacts: dict):
    """
    Dashboard resumo com todas as curvas.
    """
    fig, axes = plt.subplots(2, 2, figsize=(14, 12))

    curves = []
    for key, name in [("curve_a", "A"), ("curve_b", "B"), ("curve_cd", "C/D")]:
        if artifacts.get(key) and artifacts[key].get("metrics"):
            m = artifacts[key]["metrics"]
            curves.append({
                "curve": name,
                "mae": m["mae"],
                "rmse": m["rmse"],
                "mape": m["mape"] * 100,
                "r2": m["r2"]
            })

    if not curves:
        plt.close()
        return

    df_curves = pd.DataFrame(curves)

    # 1. MAPE por curva
    ax1 = axes[0, 0]
    colors = ["green" if m <= 20 else "orange" if m <= 30 else "red" for m in df_curves["mape"]]
    bars = ax1.bar(df_curves["curve"], df_curves["mape"], color=colors)
    ax1.axhline(y=20, color="green", linestyle="--", linewidth=2, label="Meta 20%")
    ax1.set_ylabel("MAPE (%)", fontsize=12)
    ax1.set_title("MAPE por Curva ABC", fontsize=14)
    ax1.legend()
    for bar, val in zip(bars, df_curves["mape"]):
        ax1.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5,
                 f'{val:.1f}%', ha='center', fontsize=11, fontweight='bold')

    # 2. R² por curva
    ax2 = axes[0, 1]
    colors = ["green" if r >= 0.7 else "orange" if r >= 0.5 else "red" for r in df_curves["r2"]]
    bars = ax2.bar(df_curves["curve"], df_curves["r2"], color=colors)
    ax2.axhline(y=0.7, color="green", linestyle="--", linewidth=2, label="Meta 0.70")
    ax2.set_ylabel("R²", fontsize=12)
    ax2.set_title("R² por Curva ABC", fontsize=14)
    ax2.set_ylim(0, 1)
    ax2.legend()
    for bar, val in zip(bars, df_curves["r2"]):
        ax2.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.02,
                 f'{val:.3f}', ha='center', fontsize=11, fontweight='bold')

    # 3. MAE por curva
    ax3 = axes[1, 0]
    ax3.bar(df_curves["curve"], df_curves["mae"], color="steelblue")
    ax3.set_ylabel("MAE", fontsize=12)
    ax3.set_title("MAE por Curva ABC", fontsize=14)
    for bar, val in zip(ax3.patches, df_curves["mae"]):
        ax3.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5,
                 f'{val:.1f}', ha='center', fontsize=11)

    # 4. RMSE por curva
    ax4 = axes[1, 1]
    ax4.bar(df_curves["curve"], df_curves["rmse"], color="coral")
    ax4.set_ylabel("RMSE", fontsize=12)
    ax4.set_title("RMSE por Curva ABC", fontsize=14)
    for bar, val in zip(ax4.patches, df_curves["rmse"]):
        ax4.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.5,
                 f'{val:.1f}', ha='center', fontsize=11)

    plt.suptitle("DASHBOARD - PERFORMANCE DOS MODELOS", fontsize=16, fontweight='bold', y=1.02)
    plt.tight_layout()
    plt.savefig(DIAGNOSTICS_DIR / "summary_dashboard.png", dpi=150, bbox_inches='tight')
    plt.close()
    print(f"  Salvo: summary_dashboard.png")


if __name__ == "__main__":
    run_full_diagnostics()
