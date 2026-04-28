# Projeto ML - Projecao Permanente 2026

## Status atual

### Pausa temporaria

- O modulo de Machine Learning esta em pausa temporaria.
- O codigo, os artefatos, o backtest e os dados no banco foram mantidos.
- A aba foi ocultada do menu para nao aparecer no fluxo atual do sistema.
- Quando for retomado, a recomendacao e continuar a partir da linha `v1` estavel e do comparativo `jan-abr/2026`.

| Etapa | Arquivo | Status | Observacao |
|---|---|---|---|
| 1 | `requirements.txt` | feito | Dependencias base do pipeline |
| 2 | `config.py` | feito | Configuracao central, filtros e janela de treino |
| 3 | `extract.py` | feito | Extracao mensal densa por SKU ate o ultimo mes fechado |
| 4 | `features.py` | feito | Features sem vazamento temporal |
| 5 | `train.py` | feito | Treino por curva A, B e grupo C/D |
| 6 | `predict.py` | feito | Projecao recursiva jul-nov/2026 |
| 7 | `evaluate.py` | feito | Leitura e exibicao das metricas |
| 8 | `main.py` | feito | Pipeline completo ponta a ponta |
| 9 | Instalar dependencias | feito | Dependencias Python instaladas |
| 10 | Persistencia em banco | feito | Pipeline grava em `app_ml_runs` e `app_ml_forecasts` |
| 11 | Executar pipeline | pendente | `python ml/main.py` ou `POST /api/ml/run-pipeline` |
| 12 | Validar metricas | pendente | Conferir `app_ml_runs.metrics` ou aba ML |
| 13 | Revisar forecast | pendente | Conferir aba ML e tabela `app_ml_forecasts` |

## O que foi consolidado

- O pipeline usa os mesmos filtros principais do planejamento:
  - marca `LIEBE`
  - status `EM LINHA`
  - continuidade `PERMANENTE` e `PERMANENTE COR NOVA`
  - exclusao de situacao `007`
  - exclusao de `PT 99`, referencias `PT*` e itens bloqueados
- A extracao agora trabalha com meses fechados e gera um painel denso SKU x mes.
- A curva ABC foi alinhada com a regra por referencia dos ultimos 3 meses.
- As features foram corrigidas para nao usar o proprio alvo do mes previsto.
- A saida final fica no formato de upload do sistema:
  - `idproduto,mes,qtd`
- Agora o pipeline tambem grava diretamente no PostgreSQL:
  - `app_ml_runs`
  - `app_ml_forecasts`

## Arquivos do pipeline

```text
ml/
├── PROJETO_ML.md
├── requirements.txt
├── config.py
├── extract.py
├── features.py
├── train.py
├── predict.py
├── evaluate.py
├── main.py
├── diagnostics.py      # Dashboard de diagnóstico do modelo
├── optimize.py         # Otimização de hiperparâmetros
├── data/
├── models/
└── output/
    └── diagnostics/    # Gráficos de análise
    └── optimization/   # Resultados de otimização
```

## Fluxo do pipeline

1. `extract.py`
   - Busca vendas mensais dos ultimos 36 meses fechados.
   - Busca catalogo e aplica filtros de planejamento.
   - Gera `ml/data/vendas_mensais.parquet`.

2. `features.py`
   - Calcula curva ABC por referencia.
   - Cria lags, medias moveis, tendencia, YoY e sazonalidade.
   - Cria features de grupo para curvas C/D.
   - Gera `ml/data/features.parquet`.

3. `train.py`
   - Curva A: XGBoost mais completo.
   - Curva B: XGBoost simplificado.
   - Curvas C/D: previsao no nivel do grupo e depois rateio por share medio.
   - Treino ate `2025-12`.
   - Teste no restante disponivel apos essa data.
   - Salva artefatos em `ml/models/forecast_models.pkl`.

4. `evaluate.py`
   - Le `ml/models/metrics.json`.
   - Mostra MAE, RMSE, MAPE e R2.

5. `predict.py`
   - Usa historico ate o ultimo mes fechado.
   - Gera previsoes recursivas para julho, agosto, setembro, outubro e novembro de 2026.
   - Salva:
     - `ml/output/projecoes_2026_h2.csv`
     - `ml/output/projecoes_2026_h2_detalhe.csv`
     - `ml/output/projecoes_2026_h2.parquet`

6. `persist.py`
   - Cria as tabelas do ML se nao existirem.
   - Salva a execucao, metricas e previsoes no PostgreSQL.

7. `main.py`
   - Executa o pipeline completo.
   - Persiste no banco por padrao.

8. `diagnostics.py`
   - Dashboard completo de diagnóstico do modelo.
   - Gráficos de regressão (predito vs real).
   - Análise de resíduos (homoscedasticidade, normalidade).
   - Detecção de anomalias e outliers (IQR).
   - Importância das features.
   - Análise temporal e sazonalidade.
   - Q-Q plots para normalidade.
   - Relatório textual com métricas qualitativas.

9. `optimize.py`
   - Otimização de hiperparâmetros com Optuna.
   - Cross-validation temporal (TimeSeriesSplit).
   - Comparação entre XGBoost e LightGBM.
   - Feature selection automática.
   - Recomendações de melhoria baseadas nos resultados.

## O que falta fazer agora

1. Rodar o pipeline real contra o banco.
2. Verificar se o volume de dados retornado esta coerente.
3. Conferir distribuicao das curvas A/B/C/D.
4. Validar as metricas antes de usar a projecao no plano.
5. Se necessario, recalibrar:
   - janela historica
   - features
   - parametros do XGBoost
   - regra de share para curva C/D

## Comandos esperados

```powershell
# Pipeline completo
python ml\main.py

# Diagnóstico do modelo
python ml\diagnostics.py

# Otimização de hiperparâmetros (completa)
python ml\optimize.py

# Otimização rápida (teste com 10 trials)
python ml\optimize.py --quick

# Otimização de curva específica
python ml\optimize.py --curve A --trials 50
```

Ou pela API:

```text
POST /api/ml/run-pipeline
```

## Saidas importantes

- Dados tratados: `ml/data/features.parquet`
- Modelos: `ml/models/forecast_models.pkl`
- Metricas: `ml/models/metrics.json`
- CSV de upload: `ml/output/projecoes_2026_h2.csv`
- Run no banco: `app_ml_runs`
- Forecast no banco: `app_ml_forecasts`
- Diagnósticos: `ml/output/diagnostics/`
  - `summary_dashboard.png` - Dashboard resumo
  - `regression_curve_*.png` - Gráficos de regressão
  - `anomalies_curve_*.png` - Detecção de outliers
  - `importance_curve_*.png` - Importância de features
  - `temporal_curve_*.png` - Análise temporal
  - `diagnostic_report.txt` - Relatório textual
- Otimização: `ml/output/optimization/`
  - `optimization_results.json` - Parâmetros otimizados

## Observacoes importantes

- O pipeline foi validado em sintaxe, mas a execucao completa ainda depende do acesso normal ao banco durante o uso.
- O desempenho real depende do volume, qualidade e estabilidade dos dados do PostgreSQL.
- Se a acuracia da curva B ficar fraca, o proximo passo natural e testar LightGBM ou um baseline sazonal para comparacao.

## Ferramentas de diagnóstico e otimização

### diagnostics.py

Gera análises visuais e relatórios textuais sobre o modelo:

| Gráfico | Descrição |
|---------|-----------|
| Predito vs Real | Scatter plot com linha de identidade e regressão |
| Resíduos | Análise de homoscedasticidade (variância constante) |
| Distribuição | Histograma dos resíduos com curva normal |
| Outliers | Detecção usando IQR (Interquartile Range) |
| Q-Q Plot | Verificação de normalidade dos resíduos |
| Importância | Ranking das features mais importantes |
| Temporal | Série temporal agregada e viés por período |
| Sazonalidade | Padrão mensal real vs predito |

### optimize.py

Otimização automatizada de hiperparâmetros:

| Funcionalidade | Descrição |
|----------------|-----------|
| Optuna | Busca bayesiana de hiperparâmetros |
| TimeSeriesSplit | Cross-validation temporal (5 folds) |
| XGBoost | Otimização de n_estimators, max_depth, learning_rate, etc |
| LightGBM | Alternativa ao XGBoost (se instalado) |
| Feature Selection | Remoção automática de features pouco importantes |
| Comparação | Testa modelo conservador, padrão e agressivo |
| Recomendações | Sugestões baseadas nos resultados |

### Métricas monitoradas

| Métrica | Meta | Descrição |
|---------|------|-----------|
| MAPE | < 20% | Erro percentual médio absoluto |
| R² | > 0.70 | Coeficiente de determinação |
| MAE | - | Erro absoluto médio (em unidades) |
| RMSE | - | Raiz do erro quadrático médio |

### Fluxo de análise recomendado

1. Executar o pipeline: `python ml\main.py`
2. Gerar diagnósticos: `python ml\diagnostics.py`
3. Analisar gráficos em `ml/output/diagnostics/`
4. Se MAPE > 20%, executar otimização: `python ml\optimize.py`
5. Aplicar parâmetros otimizados em `config.py`
6. Re-executar pipeline e validar métricas
