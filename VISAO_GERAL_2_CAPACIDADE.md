# Capacidade na Visão Geral 2

Este documento descreve a linha **Capacidade** da tabela “Capacidade produtiva x projeção de venda” em `/visao-geral-2`, de onde vêm os números e como os grupos ativos afetam o cálculo.

## Fluxo dos dados

1. `data/capacidade_grupos.json` define quais grupos estão ativos no planejamento. Referências ligadas a grupos fora dessa lista não entram nos cálculos por grupo.
2. `GET /api/capacidade/dias-resumo` calcula a capacidade diária medida por grupo. Para cada grupo ativo, usa os minutos produzidos divididos pelos dias com produção no último mês fechado. Se não houver medição para nenhum grupo, usa a capacidade diária cadastrada como fallback.
3. O endpoint soma as capacidades medidas dos grupos ativos e devolve `capacidadeDiaria`, os dias necessários por período e os dias disponíveis. A tela de capacidade e a Visão Geral 2 usam esse mesmo resumo.
4. `GET /api/capacidade/indice-mensal` calcula o nível recente de produtividade e os índices sazonais. A consulta cruza os locais do ERP com os nomes de `data/capacidade_grupos.json`; só os grupos ativos participam.
5. `frontend/app/visao-geral-2/page.tsx` converte a capacidade em minutos para peças conforme a carga e o tempo por peça. `CapacidadeVsVenda.tsx` apresenta esse valor na linha Capacidade.

## Capacidade diária medida

Para cada grupo ativo `g`:

```text
capacidade_diaria(g) = minutos produzidos no último mês fechado(g)
                       / dias com produção(g)
```

```text
capacidade diária total = soma(capacidade_diaria(g), para cada grupo ativo g)
```

Os dados históricos vêm de `pcp_cache_eficiencia_dia` e os nomes dos grupos, de `pcp_cache_locais`. Quando existe medição para a fábrica, um grupo ativo sem medição contribui com zero; a capacidade cadastrada só é usada como fallback se não houver medições reais para nenhum grupo.

O Progresso (`08 - PROGRESSO SO BASICO`, local ERP `111`) e a Oficina Atila (`OFICINA - ATILA`, local ERP `1241`) estão desativados em `data/capacidade_grupos.json`. Por isso não entram na soma diária, nos rateios das referências, no nível recente nem nos índices sazonais. Os locais ERP continuam conhecidos no conjunto de locais possíveis, mas a consulta exige que o nome também esteja na lista ativa.

## Nível e sazonalidade

O índice mensal parte dos minutos agregados de todos os grupos ativos, por competência. Considera dias de segunda a sexta com minutos produzidos positivos.

```text
produtividade diária do mês = minutos produzidos no mês
                              / dias de produção considerados
```

Para reduzir o efeito do aumento de produtividade entre anos, cada observação mensal é dividida pela média de produtividade diária do próprio ano. O índice sazonal de cada mês é a média dessas observações normalizadas. Meses sem observação recebem índice `1`.

O nível recente (`nivel`) é a média da produtividade diária dos três últimos meses fechados disponíveis. A tela compara esse valor com a capacidade diária atual:

```text
fator de nível = nivel recente / capacidade diária total
```

O efeito sazonal é amortecido pela metade, evitando extrapolar integralmente índices que podem ter poucas observações:

```text
fator sazonal do mês = 1 + (índice sazonal do mês - 1) * 0,5
fator do mês = fator de nível * fator sazonal do mês
```

## Conversão mensal para peças

Na parte projetada da tabela, a capacidade do mês usa a carga e o tempo médio por peça do mix projetado:

```text
capacidade mensal em minutos = capacidade diária medida * dias disponíveis
capacidade mensal em peças = capacidade mensal em minutos / minutos por peça do mix
```

Na linha projetada, a capacidade em peças recebe ainda o fator do mês e a reserva operacional de 5% para faltas:

```text
capacidade exibida = capacidade mensal em peças * fator do mês * 0,95
```

Para períodos já fechados ou em andamento, a tela preserva a carga real do período, converte-a em dias necessários sobre a capacidade diária medida e aplica os mesmos fatores de nível, sazonalidade e faltas. O mês corrente não é elevado ao teto de capacidade: a linha representa o que ainda cabe no período considerando os dias disponíveis.

## Relação com a tela de Capacidade

- A capacidade diária de base e os dias necessários vêm de `/api/capacidade/dias-resumo`.
- `/api/capacidade/indice-mensal` ajusta a produtividade recente e a sazonalidade da tabela projetada.
- A tela `/capacidade` exibe os grupos individualmente e soma somente os ativos configurados.
- A Visão Geral 2 usa a mesma lista ativa nos dois endpoints, portanto um grupo desativado não pode continuar influenciando o fator de nível ou os índices sazonais.

## Arquivos principais

- `data/capacidade_grupos.json`: grupos ativos e capacidade de fallback.
- `src/routes/capacidade.js`: cálculo da capacidade diária, dias necessários, nível recente e índices mensais.
- `frontend/app/visao-geral-2/page.tsx`: cálculo mensal da linha Capacidade.
- `frontend/app/components/CapacidadeVsVenda.tsx`: apresentação da capacidade mensal em peças.
