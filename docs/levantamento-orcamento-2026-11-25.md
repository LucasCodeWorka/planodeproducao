# Levantamento provisório do orçamento de MP — 25/11/2026

## Escopo e limites

Fotografia calculada às 09:06 de Fortaleza em 25/11, a partir da matriz compartilhada de 24/11 às 09:21, marca LIEBE, situações em linha e nova coleção. A tentativa de recalcular a matriz diretamente em 25/11 foi interrompida após longa espera na consulta de histórico de vendas. O consumo, estoque, pedidos, custos e vínculos foram consultados novamente em 25/11. Os planos podem ter mudado desde a matriz; confirmar antes de usar para lançamento. Leituras somente; nenhum valor foi gravado no ERP.

O cálculo segue a tela de orçamento: cinco períodos, novembro/2026 a março/2027, para 3.345 SKUs na matriz, 2.140 com plano e 1.256 MPs calculadas. Há 690 MPs com necessidade valorizada ou compra em andamento. O custo usa última compra ou custo TOTVS, com regra de conversão e alça sem custo; necessidade futura tem folga de 5%, mínimo R$ 250 por MP. São estimativas aos preços usados pelo painel, não necessariamente os valores contratuais dos pedidos. As exclusões da análise de consumo existente também se aplicam; não é um inventário de todas as MPs cadastradas.

## Valores calculados

| Componente | Valor |
| --- | ---: |
| Compras pendentes valorizadas pelo critério da tela | R$ 1.367.485,06 |
| Necessidade futura com folga | R$ 942.888,81 |
| **Total dos dois componentes** | **R$ 2.310.373,87** |

O valor das compras fechou com a consulta de pedidos por MP ao mesmo preço de referência; OPs internas totalizaram zero e não houve divergência de quantidade valorizada. Nenhuma MP com necessidade foi classificada como sem preço, conforme a regra do cálculo; isso não certifica individualmente a adequação de cada preço.

| Situação do vínculo local | MPs com valor | Necessidade futura | Compras |
| --- | ---: | ---: | ---: |
| Despesa no plano 500/CC 506 | 415 | R$ 671.197,23 | R$ 577.620,03 |
| Sem despesa vinculada | 172 | R$ 119.198,93 | R$ 693.466,45 |
| Despesa fora do plano | 103 | R$ 152.492,65 | R$ 96.398,58 |

Há 215 MPs com valor nesta fotografia que não estavam entre as MPs com valor na fotografia de 27/10. Isso **não comprova que foram cadastradas agora**: elas podem já existir e não ter tido valor na base anterior. Revisar cadastro, histórico e vínculo antes de criar despesas.

## Comparação com o TOTVS

Espelho FCPFM017, visão 1, plano 500/CC 506, consultado em 25/11. Comparação apenas com a necessidade futura com folga, sem incluir compras, como no lançamento anterior:

| Competência | TOTVS | Necessidade calculada |
| --- | ---: | ---: |
| Nov/2026 | R$ 43.497,08 | R$ 4.100,02 |
| Dez/2026 | R$ 103.106,14 | R$ 19.527,62 |
| Jan/2027 | R$ 325.583,94 | R$ 92.617,39 |
| Fev/2027 | R$ 51.336,56 | R$ 241.317,24 |
| Mar/2027 | R$ 0,00 | R$ 585.326,54 |
| **Total** | **R$ 523.523,72** | **R$ 942.888,81** |

Na comparação por despesa e competência, a auditoria aponta R$ 878.589,91 de faltas em linhas específicas e R$ 459.224,82 de excessos em outras, incluindo necessidades ainda sem despesa vinculada. Não representam ordem automática de lançamento ou transferência. O total histórico de R$ 533.089,01 inclui outubro/2026, fora da janela acima. As 22 divergências de lote exibidas no JSON da auditoria são de outubro: o script filtra o espelho pela janela nova, mas compara com todos os lotes históricos. Não são prova de exclusão no ERP; outubro permanece no espelho, somando R$ 9.565,29.

## Planos depois da janela

Consulta geral de lotes ativos, sem o filtro LIEBE/situação usado no orçamento, encontrou planos restantes de 98.380 peças em abril/2027 (SX), 118.190 em maio (ST) e 108.080 em junho (OT). Esses totais gerais não são valores de MP nem substituem uma análise filtrada por marca; podem mudar durante o dia. Não houve lote NV na consulta. A tela e o cálculo de MP ainda param em QU/março, portanto o custo e a necessidade posteriores não estão incluídos no total acima.

## Próximas conferências

1. Atualizar a matriz de hoje e repetir consumo, preços e conciliação; garantir que a comparação usa o mesmo filtro e todos os SKUs.
2. Estender a apuração de consumo e necessidade para os períodos posteriores a QU, preservando estoques e compras acumulados entre períodos.
3. Revisar as 172 MPs sem despesa e as 103 com despesa fora do plano, começando pelos maiores valores; verificar antes se há despesas equivalentes existentes.
4. Conferir preços e datas dos pedidos, além da competência e dos valores já existentes no TOTVS; só então preparar proposta por despesa/mês.

Arquivos detalhados: `docs/orcamento-levantamento-2026-11-25.json` (por MP), `docs/orcamento-compras-2026-11-25.json` (pedidos), `docs/orcamento-conferencia-2026-11-25.json` e `docs/orcamento-totvs-auditoria-2026-11-25.json`.
