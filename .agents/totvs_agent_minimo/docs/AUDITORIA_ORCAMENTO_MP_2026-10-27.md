# Auditoria do Orçamento MP — 27/10/2026

Escopo: plano LIEBE, competências 2026-10 a 2027-02, TOTVS empresa 1,
FCPFM017 plano 500, orçamento/visão 1, centro de custo 506. Esta auditoria
consultou dados e gerou arquivos locais; não alterou o orçamento no ERP.

## O que está no TOTVS

O espelho `vr_fcp_visaoi`, filtrado por visão 1 e plano 500/CC 506, contém
646 linhas mensais e **R$ 533.089,01**. As 646 chaves despesa/competência e
seus valores coincidem, centavo a centavo, com os cinco lotes lançados em
15–19/10: nenhuma linha faltante, extra ou diferente. Isso confirma de forma
independente o orçamento da **necessidade futura com folga calculada em 15/10**.
As compras em andamento foram excluídas daquele lançamento por decisão
registrada na época. Portanto, R$ 533.089,01 não é o total do cartão
`Orçamento MP` da página.

## Necessidade recalculada em 27/10

A matriz foi consultada diretamente no banco, sem o cache de 26/10, e o consumo
e os custos foram recalculados. Fotografia às 08:20 de Fortaleza: 2.928 SKUs,
1.419 MPs, das quais 643 têm algum valor de compra ou necessidade.

| Componente | Valor |
| --- | ---: |
| Compras em andamento | R$ 1.619.994,18 |
| Necessidade futura com folga | R$ 311.860,72 |
| **Comprado + necessidade com folga** | **R$ 1.931.854,90** |

Comparação mensal da **parte futura** com o que está orçado no TOTVS:

| Competência | TOTVS | Necessidade atual | Falta em linhas específicas | Excesso em outras linhas |
| --- | ---: | ---: | ---: | ---: |
| 2026-10 | R$ 9.565,29 | R$ 5.691,80 | R$ 2.884,81 | R$ 6.758,30 |
| 2026-11 | R$ 43.497,08 | R$ 26.698,67 | R$ 7.668,22 | R$ 24.466,63 |
| 2026-12 | R$ 103.106,14 | R$ 57.795,81 | R$ 13.901,41 | R$ 59.211,74 |
| 2027-01 | R$ 325.583,94 | R$ 184.187,71 | R$ 31.603,99 | R$ 173.000,22 |
| 2027-02 | R$ 51.336,56 | R$ 37.486,73 | R$ 6.301,34 | R$ 20.151,17 |
| **Total** | **R$ 533.089,01** | **R$ 311.860,72** | **R$ 62.359,77** | **R$ 283.588,06** |

Existem 631 diferenças por despesa/competência. Um total orçado maior não
cobre automaticamente a falta de outra despesa ou mês. Entre as faltas atuais,
12 MPs somam R$ 14.463,57 sem despesa vinculada e cinco despesas somam
R$ 5.750,15 fora do plano 500/506. Esses cadastros/vínculos precisam ser
resolvidos antes de qualquer lançamento correspondente.

## Por que a página mostrou R$ 1.669.878,30

O cartão da página soma compras em andamento e necessidade com folga. Seu cache
persistido foi criado em 27/10 às 08:07 de Fortaleza, com 1.393 MPs, mas
`priceOptionsByMp` contém somente 500 códigos. A rota `/prices/mp` da versão
publicada corta a entrada após 500 MPs; o backend local tem uma correção de
lotes ainda não publicada. O valor exibido foi reproduzido exatamente do cache:
aproximadamente R$ 1.359.085,40 em compras e R$ 310.792,89 em necessidade,
total apresentado de **R$ 1.669.878,30** (arredondamento do total bruto).

Aplicando os custos completos já consultados localmente às mesmas 1.393 MPs,
o cartão seria **R$ 1.930.787,07**; a omissão de custos reduz as compras em
R$ 260.908,77. A matriz atual, consultada sem cache, acrescenta R$ 1.067,83
ao total combinado. O frontend local foi ajustado para buscar custos em lotes
de 500, falhar quando algum lote não retornar todos os códigos e invalidar o
cache antigo (versão 4). A correção ainda precisa ser publicada para mudar a
página hospedada. `tsc --noEmit` e `npm run build` passaram no frontend local.

Dos R$ 1.619.994,18 de compras em andamento no cálculo de 27/10, os campos
`entrada_ma` a `entrada_qu` distribuem aproximadamente R$ 1.327.725,17 nas
cinco competências analisadas. Cerca de R$ 292.269,01 não está distribuído
nesses cinco campos. Assim, a diferença entre o cartão completo e o FCPFM017
não pode ser lançada em bloco: é necessário conferir os pedidos e suas datas.

## Arquivos de conferência

- Fotografia atual: `data/preparo-fcpfm017-2026-10-27.json`.
- Comparação com os lotes: `data/conferencia-orcamento-2026-10-27.json`.
- Auditoria independente do espelho: `data/auditoria-orcamento-totvs-2026-10-27.json`.
- Scripts: `scripts/preparar-valores-fcpfm017.mjs`,
  `scripts/conferir-orcamento-necessidade-atual.mjs`,
  `scripts/auditar-orcamento-totvs-atual.mjs`,
  `scripts/reproduzir-card-orcamento-mp.mjs`.

Próximo passo: conciliar as compras em andamento com seus pedidos, despesas,
centros de custo e competências; depois preparar a revisão do orçamento por
despesa/mês, incluindo as 12 MPs sem despesa e cinco despesas fora do plano.

## Atualização após sincronização local em 27/10, 10:36 Fortaleza

A matriz compartilhada foi reconstruída às 09:08 (2.928 SKUs). A API e o
frontend locais estão nas portas 8000/3000. O cache da página foi atualizado
para versão 4, com 1.418 MPs no plano atual e preços para as 1.506 MPs distintas
dos planos atual e original. O cartão, confirmado pela API e pelo usuário,
mostra **R$ 1.943.059,04**: R$ 1.635.976,58 de pedidos pendentes e
R$ 307.082,46 de necessidade futura com folga. O site Render ainda servia o
frontend antigo nesta conferência; os commits `0e4278a` e `3321229` foram
enviados ao `master`, mas a implantação não foi confirmada.

Todos os R$ 1.635.976,58 de "comprado" foram reconciliados centavo a centavo
com pedidos pendentes; OPs internas somaram zero nesta fotografia. Por vínculo
de despesa local: R$ 717.374,14 estão no plano 500/CC 506, R$ 185.834,04
têm despesa fora desse plano e R$ 732.768,40 não têm despesa vinculada.
Dos 104 MPs sem despesa local, 85 MPs (R$ 684.436,52 em pedidos) têm uma única
despesa própria no histórico do pedido/produto, mas ela está fora do plano;
vários desses vínculos usam a despesa genérica 108 (RENDA). Outros 11 MPs
(R$ 48.331,88 em pedidos) têm múltiplas despesas históricas e oito não têm
candidato próprio. Esses códigos históricos não devem ser transferidos
automaticamente para o plano detalhado por MP/cor.

O espelho FCPFM017 permaneceu em **R$ 533.089,01**, 646 linhas, idêntico aos
lotes históricos. A necessidade futura atual de R$ 307.082,46 difere em 633
pares despesa/competência: faltam R$ 60.908,44 em linhas específicas e sobram
R$ 286.914,99 em outras. Há 12 MPs com necessidade (R$ 14.463,57) sem despesa
local e seis despesas com necessidade fora do plano.

Relatórios desta fotografia: `data/preparo-fcpfm017-2026-10-27-apos-sync.json`,
`data/conciliacao-compras-orcamento-mp-2026-10-27-apos-sync.json`,
`data/mapeamento-compras-orcamento-mp-2026-10-27.json`,
`data/conferencia-orcamento-2026-10-27-apos-sync.json` e
`data/auditoria-orcamento-totvs-2026-10-27-apos-sync.json`. Nenhum valor do
FCPFM017 foi alterado nesta atualização.

Uma checagem adicional por nome normalizado do produto no `vr_fcp_despesaitem`
não encontrou correspondência exata para nenhuma das 104 MPs sem vínculo.
Isso não exclui descrições equivalentes com outra redação. A proposta para
revisão está em `data/proposta-cadastro-despesas-orcamento-mp-2026-10-27.csv`,
com nome completo, grupo/cor, valores e despesas históricas por MP. Não
cadastrar automaticamente a despesa genérica dos pedidos no plano detalhado.
