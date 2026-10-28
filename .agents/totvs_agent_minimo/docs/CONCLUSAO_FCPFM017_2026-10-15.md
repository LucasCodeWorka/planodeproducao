# FCPFM017 — conclusão do primeiro lote de necessidade futura

Data: 15/10/2026. Plano 500, orçamento 1, centro de custo 506.

O usuário autorizou lançar agora **somente a necessidade futura com folga**
das 197 despesas prontas. Compras em andamento e casos não conciliados ficaram
fora. O lançamento foi feito por competência, em 2026 e 2027.

## Resultado conferido

| Competência | Valor |
| --- | ---: |
| 2026-10 | R$ 6.553,01 |
| 2026-11 | R$ 36.814,42 |
| 2026-12 | R$ 75.809,09 |
| 2027-01 | R$ 268.591,14 |
| 2027-02 | R$ 39.904,03 |
| **Total** | **R$ 427.671,69** |

São 197 despesas distintas, 313 pares ano/despesa (117 em 2026, 196 em
2027) e 513 entradas mensais. Dessas, 309 foram gravadas nesta execução e
quatro já estavam corretas no TOTVS, sendo novamente consultadas e verificadas.
Cada par foi reconsultado após salvar; o OCR conferiu código, ano e valores
mensais. A auditoria do registro contra o lote passou sem centavos faltantes,
extras ou diferentes. Isso é uma conferência via interface, não um extrato
independente do banco de dados do TOTVS.

- Lote imutável de entrada: `data/lote-pronto-fcpfm017-2026-10-15.json`.
  O campo `status: PREPARADO_NAO_LANCADO` descreve o estado **original** desse
  arquivo, não o estado atual no TOTVS; não alterar a fonte para simular baixa.
- Registro de cada par reconsultado: `data/resultado-lote-fcpfm017-2026-10-15.jsonl`.
- Capturas antes/depois: `shots/lote_fcpfm017_20261015/`.
- Automação retomável: `scripts/lancar_lote_fcpfm017.py`.
- Auditoria reproduzível: `python .agents\totvs_agent_minimo\scripts\auditar_resultado_fcpfm017.py`.

## Fora deste primeiro lote

O preparo identificou 351 MPs com necessidade futura, somando R$ 533.089,01
na base considerada. Destas, 269 MPs compõem as 197 despesas prontas acima.
As demais categorias requerem tratamento separado: duas despesas com ID
duplicado (R$ 6.581,65), 42 despesas fora do plano 500/CC 506 (R$ 75.456,59)
e 16 MPs sem despesa (R$ 23.379,08). Duas MPs de viés também carecem de preço
válido. Compras em andamento, R$ 1.675.409,69, não foram adicionadas ao
orçamento neste lote. Não incluir esses grupos automaticamente nem duplicar
os valores já lançados.

O FCRFP018/remessa e o XML são assuntos separados; esta conclusão não os
altera nem aciona geração de remessa.
