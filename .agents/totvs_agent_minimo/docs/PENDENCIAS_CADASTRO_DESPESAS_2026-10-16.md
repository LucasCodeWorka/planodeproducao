# Pendências de cadastro de despesas — 16/10/2026

> Estado mais recente: seção **Fechamento da auditoria em 26/10/2026**, ao fim
> deste arquivo. As pendências e instruções anteriores registram a sequência
> histórica do trabalho.
> Auditoria posterior da necessidade e do orçamento da página em 27/10:
> [AUDITORIA_ORCAMENTO_MP_2026-10-27.md](AUDITORIA_ORCAMENTO_MP_2026-10-27.md).

Base: conciliação da necessidade futura de 15/10, R$ 533.089,01 no total;
R$ 427.671,69 das 197 despesas prontas já foram lançados e verificados no
FCPFM017. Consulta somente leitura do espelho TOTVS em 16/10 (FCPFM003,
`vr_fcp_despesaitem`, `vr_fcp_planoctai`, `app_mp_despesa`, histórico de pedido).
Não confundir falta de cadastro com falta de vínculo ao plano.

| Situação | Quantidade | Valor futuro | Ação |
| --- | ---: | ---: | --- |
| Despesa existente, fora do plano 500/CC 506 | 42 despesas / 60 MPs | R$ 75.456,59 | Vincular códigos existentes no FCPFM043; não recadastrar |
| Código de despesa duplicado dentro do plano | 2 despesas / 6 MPs | R$ 6.581,65 | Decidir qual sequência do plano manter; não incluir novo item |
| MP de produção sem item próprio | 8 MPs | R$ 2.993,38 | Cadastrar itens distintos no FCPFM003, confirmar códigos, atualizar ponte local e vincular ao plano |
| Embalagens sem ponte local | 7 MPs | R$ 16.800,70 | Histórico aponta despesa 3/CC 510; decidir classificação antes de qualquer cadastro PCP/506 |
| Pino de nylon sem ponte local | 1 MP | R$ 3.585,00 | Histórico aponta despesa 3/CC 501; decidir classificação |

As últimas três linhas somam as 16 MPs `SEM_DESPESA` (R$ 23.379,08).
As duas MPs de viés sem preço válido continuam fora desses valores.

## Oito candidatos a cadastro próprio

Não foi encontrada descrição exata no espelho atual de itens de despesa;
há itens irmãos de outras cores/medidas em vários casos. Valor é a necessidade
futura com folga, não valor a preencher no FCPFM003.

| MP | Grupo/cor | Descrição na grade de MP | Valor futuro |
| ---: | --- | --- | ---: |
| 1014698 | 615 / 2379 | ABOTOADOR 60MM X 03 REGULAGEM - 8758483 MAUVE U | R$ 638,74 |
| 1016252 | 805 / 1901 | BJ 213.385 EXT CONFORT TAM 50 AMEIXA U | R$ 457,40 |
| 1015810 | 14378 / 1902 | ELAST JERI 11MM MILKSHAKE U | R$ 362,50 |
| 1015809 | 14378 / 300 | ELAST JERI 11MM PRETO U | R$ 342,90 |
| 1012650 | 12843 / 300 | ELASTICO CERRUTI 11MM PRETO U | R$ 327,81 |
| 1014970 | 13951 / 300 | RENDA JL312214 PRETO U | R$ 319,53 |
| 1004031 | 3329 / 300 | ELAST MANACA BRILHOSO 17MM PRETO U | R$ 289,65 |
| 1011955 | 10979 / 1847 | AVIAMENTO LINHA MISTA 2.500 METROS (CA02) CONHAQUE U | R$ 254,85 |

## Execução no FCPFM003 em 16/10/2026, 08:53–09:02

Os oito itens acima foram incluídos e gravados na empresa 1. Em cada linha foram
conferidos na tela: rateio 100,00000, Padrão marcado, Fixo, Despesa,
Direto/Indireto Administrativo, Tipo de custo Administrativo e Bloquear
desmarcado. O campo Operador/Atualização mostrou operador 100006 e horário da
gravação após F3. O código 1469 foi reconsultado no próprio FCPFM003 e
permaneceu gravado.

| MP | Grupo/cor | Código FCPFM003 |
| ---: | --- | ---: |
| 1014698 | 615 / 2379 | 1462 |
| 1016252 | 805 / 1901 | 1463 |
| 1015810 | 14378 / 1902 | 1464 |
| 1015809 | 14378 / 300 | 1465 |
| 1012650 | 12843 / 300 | 1466 |
| 1014970 | 13951 / 300 | 1467 |
| 1004031 | 3329 / 300 | 1468 |
| 1011955 | 10979 / 1847 | 1469 |

Para 1011955, foi adotado no cadastro o padrão dos itens irmãos:
`LINHA MISTA 2.500 METROS (CA02) CONHAQUE U`, sem o prefixo `AVIAMENTO` da
descrição da MP. A ponte local `app_mp_despesa` foi atualizada em transação
somente para esses oito pares; auditoria local confirmou 8/8 com status OK.
O espelho `vr_fcp_despesaitem` ainda não mostrava os novos códigos às 09:04;
validar após a próxima sincronização (minuto 45) com
`node scripts/auditar-despesas-fcpfm003-2026-10-16.mjs`.

## Vínculo ao plano em 16/10/2026, 09:10–09:14

Os oito itens foram vinculados ao pai PCP, sequência 26081, no plano 500/CC
506 pelo FCPFM043. Cada busca no FCPFL020 retornou o código e a descrição
esperados; em cada confirmação o TOTVS exibiu `Despesa(s) gravada(s) com
sucesso`. A árvore do plano mostrou simultaneamente os oito filhos:

| Despesa | Sequência no plano |
| ---: | ---: |
| 1462 | 26702 |
| 1463 | 26704 |
| 1464 | 26706 |
| 1465 | 26708 |
| 1466 | 26710 |
| 1467 | 26712 |
| 1468 | 26714 |
| 1469 | 26716 |

O espelho SQL ainda aguarda a sincronização para auditoria independente.

## Valores lançados no FCPFM017 em 16/10/2026, 09:25–09:33

Somente necessidade futura com folga, conforme a conciliação imutável de
15/10/2026; compras em andamento ficaram fora. Os oito itens somam 16 valores
mensais em 11 pares ano/despesa. Cada par foi reconsultado após gravar, e a
auditoria do lote contra o registro de verificação passou sem faltas, extras
ou diferenças de centavos.

| Competência | Valor |
| --- | ---: |
| 2026-10 | R$ 648,39 |
| 2026-11 | R$ 121,96 |
| 2026-12 | R$ 289,79 |
| 2027-01 | R$ 1.080,28 |
| 2027-02 | R$ 852,96 |
| **Total** | **R$ 2.993,38** |

Lote: `data/lote-oito-fcpfm017-2026-10-16.json`. Resultado:
`data/resultado-oito-fcpfm017-2026-10-16.jsonl`. Capturas:
`shots/lote_oito_fcpfm017_20261016/`. Reproduzir auditoria:
`python .agents\totvs_agent_minimo\scripts\auditar_resultado_fcpfm017.py --lote .agents\totvs_agent_minimo\data\lote-oito-fcpfm017-2026-10-16.json --resultado .agents\totvs_agent_minimo\data\resultado-oito-fcpfm017-2026-10-16.jsonl`.

O primeiro lote de 197 despesas também foi auditado novamente nesta data e permaneceu
íntegro em R$ 427.671,69. Assim, 205 despesas distintas totalizam
R$ 430.665,07 verificados pela interface do FCPFM017. As 42 despesas
existentes fora do plano e as duas duplicidades ainda não foram alteradas.
A alteração acidental não salva na linha 89 do FCPFM003 foi descartada antes
das inclusões; não afetou o cadastro existente.

Para a MP 1011955, os itens irmãos usam a descrição sem o prefixo
`AVIAMENTO`; confirmar a nomenclatura antes de gravar. Não inferir código
sequencial: o FCPFM003 atribui/mostra o código na interface e cada inclusão
precisa ser reconsultada. A ponte `app_mp_despesa` deve ser atualizada apenas
após confirmar o código real.

## Outros pontos

- As 42 despesas têm códigos de item existentes, mas não aparecem no
  `vr_fcp_planoctai` do plano 500/CC 506. A lista integral com MPs e valores
  está em `data/conciliacao-fcpfm017-2026-10-15.md`, linhas `FORA_PLANO`.
- Duplicadas no plano: despesa 11103 nas sequências 26306/26308 e despesa
  11399 nas sequências 26312/26314. O espelho de 16/10 mantém essas duas
  duplicidades. Não alterar antes de decidir a sequência correta.
- O espelho de 16/10 ainda mostra 277 despesas distintas em 280 linhas do
  plano 500/CC 506. Essa contagem é de estrutura, não de valores orçados.
- O histórico de sete embalagens registra despesa 3 e predominantemente CC
  510 (Expedição). O pino registra despesa 3/CC 501 em pedidos. Não presumir
  que devem virar despesas PCP/506 só porque entram no consumo do plano.
- As compras em andamento permanecem fora do lote FCPFM017 já lançado.

## Continuação das 42 despesas existentes em 16/10/2026

A auditoria no espelho confirmou os oito cadastros/vínculos 1462–1469 (8/8 OK)
e identificou 42 itens já cadastrados, dos quais 41 ainda faltam no plano
500/CC 506. A despesa 11681 (ABOTOADOR 30MM X 03 REGULAGEM - 8418352
MILKSHAKE U) foi vinculada como piloto à sequência 26718, confirmada na tela
e no espelho após a sincronização. Nenhuma das outras 41 recebeu vínculo ou
valor nesta etapa.

Lote de vínculo conferido: `data/lote-42-fcpfm043-2026-10-16.json`, com 41
códigos distintos e filtro descritivo individual. O código 11647 retorna
duas linhas no FCPFL020; a seleção precisa validar o código exibido. O script
`scripts/vincular_42_fcpfm043_2026_10_16.py` registrará cada sucesso em
`data/resultado-42-fcpfm043-2026-10-16.jsonl`, mas ainda não processou
nenhum dos 41 porque o TOTVS foi fechado antes da execução.

O lote de valores futuros está preparado em
`data/lote-42-fcpfm017-2026-10-16.json`: 42 despesas distintas, 78 entradas
mensais, R$ 75.456,59, sem compras em andamento. Seu status é
`PREPARADO_AGUARDANDO_41_VINCULOS`; não entregar diretamente ao lançador
FCPFM017 antes de concluir e auditar os vínculos. A sequência 26718 da
despesa 11681 é a única das 42 resolvida nesse arquivo.

### Entrada única para retomar

Na raiz do projeto, `continuar-orcamento.cmd` chama
`scripts/continuar_orcamento_2026_10_16.py --fase completo`. O processo
abre o cliente se necessário e **aguarda** a sessão ficar logada; não digita
usuário ou senha. Depois identifica/abre o FCPFM043, processa apenas os
41 códigos não confirmados, valida cada código encontrado antes de marcar e
registra o sucesso individual. Somente com 41/41 vínculos confirmados ele
gera `data/lote-42-fcpfm017-pronto-2026-10-16.json`, abre o FCPFM017, lança
os 78 valores de forma retomável e roda a auditoria final. Se uma gravação
de vínculo ficar com resultado incerto, interrompe sem repetir o código.

Para ver o andamento sem alterar o ERP:
`python .agents\totvs_agent_minimo\scripts\continuar_orcamento_2026_10_16.py --fase status`.
Para testar apenas o próximo vínculo:
`python .agents\totvs_agent_minimo\scripts\continuar_orcamento_2026_10_16.py --fase vinculos --limite 1`.

## Atualização final de 16/10/2026

Os 41 vínculos que faltavam foram confirmados individualmente no FCPFM043.
Com o piloto 11681, as 42 despesas existentes estão vinculadas ao plano
500/CC 506 pela interface. Resultado: `data/resultado-42-fcpfm043-2026-10-16.jsonl`.
O espelho SQL foi auditado depois da sincronização: 42/42 cadastradas,
42/42 vinculadas, nenhuma faltando. O plano 500/CC 506 passou a 330 linhas
e 327 despesas distintas; as duas duplicidades antigas permanecem.

No FCPFM017, os valores futuros das 42 despesas foram lançados e reconsultados:
57 pares ano/despesa, 78 entradas mensais, R$ 75.456,59, todos `VERIFICADO`.
Distribuição: out/2026 R$ 291,78; nov/2026 R$ 1.865,62; dez/2026
R$ 19.751,11; jan/2027 R$ 44.140,76; fev/2027 R$ 9.407,32. Resultado:
`data/resultado-42-fcpfm017-2026-10-16.jsonl`. A auditoria final do lote
retornou 42 despesas, 78 entradas e R$ 75.456,59 sem divergências.

Somados aos 197 valores originais (R$ 427.671,69) e aos oito cadastros novos
(R$ 2.993,38), há 247 despesas distintas com R$ 506.121,66 lançados e
verificados na interface. Isso não resolve automaticamente as duas sequências
duplicadas, as MPs sem despesa e as compras em andamento descritas acima.

Para nova retomada, `continuar-orcamento.cmd` agora usa a abertura/login
existente em `main.py abrir-sistema` quando o TOTVS não está logado; depois
abre o componente necessário e pula os itens já confirmados. Não é preciso
pedir ao usuário para abrir o sistema manualmente.

## Conferência das duas duplicidades em 19/10/2026

Auditoria somente leitura em `scripts/auditar-duplicadas-fcpfm017-2026-10-19.mjs`
e inspeção visual no FCPFM017 (empresa 1, plano 500, orçamento 1, CC 506):

| Despesa | Sequências duplicadas | Valor futuro pendente | Meses |
| ---: | --- | ---: | --- |
| 11103 | 26306 e 26308 | R$ 5.354,16 | jan/2027 |
| 11399 | 26312 e 26314 | R$ 1.227,49 | jan/2027 R$ 796,34; fev/2027 R$ 431,15 |

Cada par tem o mesmo código, descrição, pai PCP/26081, CC 506, operador e
data de cadastro; muda apenas a sequência e a ordem. No FCPFM017 as duas
linhas de cada despesa aparecem com valor orçado 0,00 em 2026 e 2027.
Nenhum valor dessas duas despesas foi lançado nesta conferência. O espelho
`orcamento_valores` também não contém linhas para elas, mas não é fonte
completa dos valores lançados na interface. `vr_fcp_visaoi` não referencia
nenhuma das quatro sequências.

Não há critério material para escolher entre as duas sequências de cada par.
Proposta conservadora: manter a menor (26306 e 26312) e retirar a maior
(26308 e 26314), após autorização explícita; depois lançar e reconsultar
os R$ 6.581,65 para verificar que cada despesa aparece uma única vez.

### Execução autorizada em 19/10/2026, 08:26–08:33

O usuário autorizou a continuação. No FCPFM043 foram selecionadas e
conferidas individualmente as sequências 26308 (despesa 11103) e 26314
(despesa 11399), ambas sob PCP/26081 e CC 506. Cada remoção foi confirmada.
O botão Salvar foi acionado depois das duas remoções; a tela mostrou
`Gravação efetuada com sucesso`, e o componente fechou sem aviso de
manutenções pendentes. Na árvore permaneceram 26306 e 26312. As sequências
excluídas podem ser recriadas pelo FCPFM043, mas não há desfazer automático.

O FCPFM017 foi reaberto em empresa 1, plano 500, orçamento 1, ano 2027.
As consultas de 11103 e 11399 passaram a retornar uma única linha cada.
Lote: `data/lote-duas-duplicadas-fcpfm017-2026-10-19.json`.
Resultado: `data/resultado-duas-duplicadas-fcpfm017-2026-10-19.jsonl`.
Ambas foram gravadas e reconsultadas com status `VERIFICADO`:

| Despesa | jan/2027 | fev/2027 | Total |
| ---: | ---: | ---: | ---: |
| 11103 | R$ 5.354,16 | R$ 0,00 | R$ 5.354,16 |
| 11399 | R$ 796,34 | R$ 431,15 | R$ 1.227,49 |
| **Total** | **R$ 6.150,50** | **R$ 431,15** | **R$ 6.581,65** |

A auditoria local do resultado confirmou 2 pares ano/despesa e 3 entradas,
total R$ 6.581,65. No horário da verificação, o espelho SQL ainda mostrava
as quatro sequências antigas; aguardar a próxima sincronização para a
auditoria independente da estrutura. O espelho `orcamento_valores` não cobre
estes lançamentos, por isso a confirmação de valores foi feita pela interface.

Total acumulado verificado no FCPFM017: 249 despesas distintas,
R$ 512.703,31. Da base futura de R$ 533.089,01, restam R$ 20.385,70
referentes às sete embalagens e ao pino cuja classificação/centro de custo
ainda precisam de decisão; duas MPs de viés sem preço válido continuam fora
desses valores. Compras em andamento permanecem fora deste cenário.

### Análise somente leitura das embalagens e do pino em 19/10/2026

Os sete códigos de embalagem somam R$ 16.800,70 de necessidade futura com
folga. No histórico de pedidos, a classificação predominante é despesa 3,
centro 510; o cadastro confirma que despesa 3 se chama `EMBALAGENS` e o
centro 510 é `EXPEDICAO`. Há exceções antigas no saco 5000110 (também 501).
Uma das embalagens, MP 5000141, tem pedido ainda pendente; esse pedido não
entrou no cenário lançado, que exclui compras em andamento.

O pino 5002671 soma R$ 3.585,00. Os pedidos classificados usam despesa 3,
centro 501 (`PRODUCAO`), mas despesa 3 se chama `EMBALAGENS` e portanto a
classificação do pino merece revisão, não cópia automática. O centro 506 é
`PCP`. No espelho atual do plano, despesa 3 não está vinculada a 501 ou 510.

Nenhum desses R$ 20.385,70 foi lançado. Antes de cadastrar/vincular novos
itens ou orçamento, decidir se o objetivo é seguir os centros históricos
(embalagens 510; pino 501 com classificação própria) ou incluí-los no
orçamento PCP/506 por decisão gerencial. Consultas reproduzíveis:
`scripts/auditar-pendencias-fcpfm017.mjs` e
`scripts/auditar-centros-embalagem-pino-2026-10-19.mjs`.

## Decisão gerencial e execução das embalagens/pino em 19/10/2026

O usuário informou a decisão do gestor: criar itens próprios para as sete
embalagens e o pino, seguindo o fluxo das demais MPs, para viabilizar o pedido.
Esta decisão substitui a pendência de classificação acima para o orçamento:
os oito itens foram vinculados ao plano 500, pai PCP/26081, CC 506. O histórico
de pedidos com despesa genérica 3 e CC 510/501 não foi reclassificado.

No FCPFM003 da empresa 1, os oito cadastros foram gravados com rateio 100%,
Padrão marcado, Fixo, Despesa, Direto/Indireto Administrativo, Tipo de custo
Administrativo e Bloquear desmarcado. Os códigos foram vistos na interface,
sem inferir sequência antecipadamente. Após salvar o pino, a lista exibiu
simultaneamente os oito itens persistidos. A ponte `app_mp_despesa` foi
atualizada em transação, com validação do grupo, cor e descrição da MP no
espelho e proteção contra mapeamento conflitante (8/8 status OK).

| MP | Grupo/cor | Despesa | Sequência plano 500/PCP/506 | Total futuro |
| ---: | --- | ---: | ---: | ---: |
| 5000110 | 269/904 | 1470 | 26802 | R$ 251,59 |
| 5000126 | 299/904 | 1471 | 26804 | R$ 250,79 |
| 5000127 | 301/904 | 1472 | 26806 | R$ 251,76 |
| 5000138 | 319/904 | 1473 | 26808 | R$ 2.307,00 |
| 5000140 | 323/904 | 1474 | 26810 | R$ 8.304,65 |
| 5000141 | 325/904 | 1475 | 26812 | R$ 5.184,48 |
| 5000681 | 4608/904 | 1476 | 26814 | R$ 250,43 |
| 5002671 | 12203/904 | 1477 | 26816 | R$ 3.585,00 |

No FCPFM043, cada busca do FCPFL020 retornou o código exato antes da seleção.
O filtro inicial de 1473 encontrou também a despesa antiga 10137: a rotina
parou antes de gravar, o filtro foi estreitado e a nova busca confirmou só
1473. As oito confirmações exibiram `Despesa(s) gravada(s) com sucesso`, e
a árvore do PCP mostrou os oito filhos e as sequências da tabela. Resultado
retomável: `data/resultado-embalagens-pino-fcpfm043-2026-10-19.jsonl`.

No FCPFM017 foram lançados exclusivamente os valores da necessidade futura
com folga da conciliação imutável de 15/10, sem compras em andamento. O lote
teve 15 pares ano/despesa e 36 entradas mensais; todos foram reconsultados e
marcados `VERIFICADO`. A auditoria de resultado fechou sem faltas, extras ou
diferenças de centavos:

| Competência | Valor |
| --- | ---: |
| 2026-10 | R$ 2.072,11 |
| 2026-11 | R$ 4.695,08 |
| 2026-12 | R$ 7.256,15 |
| 2027-01 | R$ 5.621,26 |
| 2027-02 | R$ 741,10 |
| **Total** | **R$ 20.385,70** |

Lote: `data/lote-embalagens-pino-fcpfm017-2026-10-19.json`; resultado:
`data/resultado-embalagens-pino-fcpfm017-2026-10-19.jsonl`; capturas:
`shots/lote_embalagens_pino_fcpfm017_20261019/`. Reproduzir auditoria:
`python .agents\totvs_agent_minimo\scripts\auditar_resultado_fcpfm017.py --lote .agents\totvs_agent_minimo\data\lote-embalagens-pino-fcpfm017-2026-10-19.json --resultado .agents\totvs_agent_minimo\data\resultado-embalagens-pino-fcpfm017-2026-10-19.jsonl`.

Total acumulado pela interface: 257 despesas distintas e R$ 533.089,01,
fechando a base futura da conciliação de 15/10. As duas MPs de viés sem preço
válido permanecem fora dessa base. Às ~09:34, o espelho SQL ainda não mostrava
1470–1477; a confirmação de cadastro, plano e valores foi pela interface.
Depois da próxima sincronização, executar
`node scripts/auditar-embalagens-pino-fcpfm003-2026-10-19.mjs` para auditar
`vr_fcp_despesaitem` e `vr_fcp_planoctai` independentemente. Às 09:35, a
auditoria mostrava ponte 8/8 OK e cadastro/plano 8/8 AGUARDANDO sincronização.
A aceitação de um novo
pedido de compra não foi testada nesta execução; os pedidos históricos não
foram alterados.

## Auditoria do espelho SQL em 26/10/2026

`node scripts/auditar-embalagens-pino-fcpfm003-2026-10-19.mjs` confirmou a
sincronização dos oito itens: pontes `app_mp_despesa` 8/8 OK e vínculos no plano
500/CC 506 8/8 OK. Seis cadastros passaram em todos os campos. Os códigos 1470
e 1472 têm rateio, flags e classificações corretos, mas as descrições principal
e auxiliar diferem da descrição da MP usada na preparação:

| Código / MP | Esperado nos dois campos | Encontrado nos dois campos |
| --- | --- | --- |
| 1470 / 5000110 | `SACO PP LISO P/ PICOTE 08X11X0,06 UNICA U` | `SACO PP LISO PQ PICOTE 08X11X0,06 UNICA U` |
| 1472 / 5000127 | `PROT.CONJ ESP  PP 40 X 27 0,05 C/OXI UNICA U` | `PROT.CONJ ESP  PP 40 X 27 0,05 CQOXI UNICA U` |

O script de auditoria agora mostra os campos dos cadastros marcados `CONFERIR`
para permitir diagnóstico sem alterar o ERP. As duas descrições requerem
conferência/correção no FCPFM003 antes de considerar o cadastro 8/8 exato.
Nenhuma alteração foi feita no TOTVS nesta auditoria. A aceitação de novo
pedido de compra segue sem teste.

## Correcao autorizada no FCPFM003 em 26/10/2026

O usuario autorizou corrigir os dois itens e testar o fluxo. No FCPFM003 da
empresa 1, os campos `Despesa item *` e `Descricao auxiliar` dos codigos 1470
e 1472 foram preenchidos com as descricoes esperadas da tabela acima. Cada
item foi salvo com `F3`; o sistema mostrou `Gravacao efetuada com sucesso` e
o horario do operador 100006 mudou para 14:17:32 (1470) e 14:18:37 (1472).
Os dois codigos foram consultados novamente; os trechos `P/ PICOTE` e `C/OXI`
permaneceram visiveis nos dois campos.
Nao foram criadas despesas novas nesta etapa: os oito codigos 1470–1477 ja
estavam cadastrados, vinculados ao plano e orcados. Esta intervencao corrigiu
somente duas descricoes.

A causa foi reproduzida antes de salvar: `VkKeyScan('/')` neste teclado retorna
`Ctrl+Alt+Q`; a rotina local enviava apenas `Q`. `va_core/input.py` agora
respeita os modificadores, e `core/va_bridge.py` interrompe a abertura de
componente se o login nao for confirmado. `abrir-fluxo FCPFM003` foi testado
partindo de sessao aberta e de aplicacao fechada, chegando ao componente nas
duas condicoes.

O espelho SQL ainda mostrava as descricoes antigas as 14:50, inclusive apos
14:45. A interface do FCPFM003, consultada novamente apos salvar cada item,
mostra as descricoes corrigidas. Portanto a verificacao independente no espelho
continua pendente; nao registrar o cadastro como 8/8 exato no SQL ate a carga
refletir a alteracao. Reexecutar
`node scripts/auditar-embalagens-pino-fcpfm003-2026-10-19.mjs` depois da carga
do espelho; esperar 8/8 `OK` para ponte, cadastro e plano. O teste de criacao
de pedido de compra continua fora desta correcao.

### Conferencia ao vivo do orcamento em 26/10/2026

No FCPFM017, plano 500, orcamento 1, CC 506, os codigos corrigidos foram
consultados sem editar valores. A interface mostrou uma unica linha de cada
despesa e os valores do lote de 19/10:

| Despesa | Ano | Meses com valor | Total |
| ---: | ---: | --- | ---: |
| 1470 | 2026 | out R$ 12,10; nov R$ 51,64; dez R$ 79,22 | R$ 142,96 |
| 1470 | 2027 | jan R$ 95,63; fev R$ 13,00 | R$ 108,63 |
| 1472 | 2026 | out R$ 66,04; nov R$ 57,95; dez R$ 17,71 | R$ 141,70 |
| 1472 | 2027 | jan R$ 110,06 | R$ 110,06 |

Os cinco lotes historicos do FCPFM017 foram novamente auditados contra seus
registros locais e fecharam sem divergencias, somando R$ 533.089,01. Isso
confirma os registros de execucao; a verificacao atual independente dos dois
cadastros no espelho SQL ainda depende da sincronizacao.

A auditoria independente da estrutura das duas duplicidades antigas tambem foi
repetida em 26/10: o espelho agora mostra somente a sequencia 26306 para a
despesa 11103 e 26312 para a despesa 11399, ambas sob PCP/26081 e CC 506.
As sequencias removidas 26308 e 26314 nao aparecem mais. Isso fecha a
pendencia de sincronizacao da estrutura registrada em 19/10; os valores
orcados dessas despesas continuam confirmados pela interface e pelos lotes,
pois `orcamento_valores` nao espelha esses lancamentos.

As 42 despesas que estavam fora do plano tambem foram auditadas novamente:
42 cadastros corretos, 42 vinculos unicos no plano 500/CC 506, nenhum ausente
ou duplicado. O script agora retorna falha se encontrar falta ou multiplos
vinculos.

## Fechamento da auditoria em 26/10/2026

As 16:53 (horario de Fortaleza), o espelho SQL passou a mostrar as descricoes
corrigidas de 1470 e 1472. A auditoria
`node scripts/auditar-embalagens-pino-fcpfm003-2026-10-19.mjs` retornou
**8/8 OK** em cada uma das tres verificacoes: ponte `app_mp_despesa`, cadastro
`vr_fcp_despesaitem` (incluindo descricao principal e auxiliar) e vinculo
unico ao plano 500/CC 506. O script agora falha tambem se algum item estiver
`AGUARDANDO`, evitando interpretar ausencia como sucesso.

Na mesma retomada, a auditoria de 1462–1469 passou em 8/8 ponte, cadastro e
plano; as 42 despesas antes fora do plano continuam com 42 vinculos unicos;
e as duplicidades 11103/11399 continuam somente nas sequencias 26306/26312.
Assim, o cadastro e a estrutura do plano correspondem ao que foi anotado.
Os valores do FCPFM017 foram verificados pelos cinco registros de execucao e,
para 1470/1472, tambem pela interface; o espelho `orcamento_valores` nao
fornece a conferencia independente de todos os 257 valores lancados.

A base de necessidade futura de 15/10 permanece em 257 despesas e
R$ 533.089,01. As duas MPs de vies sem preco valido ficaram fora da base;
compras em andamento tambem ficaram fora do cenario escolhido. Um novo pedido
de compra usando os itens corrigidos nao foi criado ou testado.
