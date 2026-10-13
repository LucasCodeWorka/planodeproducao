# Contexto do projeto plano de producao/orcamento + TOTVS

Este projeto nao usa o agent TOTVS como algo separado. O agent minimo em
`.agents/totvs_agent_minimo` e uma ferramenta operacional para conectar o plano
de producao/orcamento ao TOTVS Moda/Virtual Age.

## Ideia central

O projeto calcula plano, necessidade de producao, consumo de materia-prima,
orcamento de MP e sugestao de compra. O TOTVS entra em dois papeis:

1. fonte de dados: views/tabelas/funcoes do banco e API TOTVS Moda;
2. destino operacional: pedidos, cadastros, componentes/telas do Virtual Age.

Separar sempre:

- calculo/diagnostico no projeto;
- consulta segura ao TOTVS;
- gravacao ou alteracao no TOTVS, sempre com autorizacao explicita.

## Fluxo TOTVS validado

Nao redescobrir e nao misturar skills.

```powershell
python .agents\totvs_agent_minimo\main.py abrir-sistema
python .agents\totvs_agent_minimo\main.py abrir FCPFM003
```

`abrir-sistema` deixa o cursor no ponto de digitar componente.
`abrir CODIGO` apenas digita o codigo, pressiona um unico `Tab` e espera.

Nao usar `F3`, `F5`, `F8` ou qualquer confirmacao de gravacao/exclusao sem
autorizacao explicita do usuario.

## Backend

Entrada principal:

- `src/index.js`

Rotas principais:

- `/api/producao`: matriz/plano oficial, snapshots de orcamento, cache,
  exportacao de orcamento MP, OPs antigas, lotes e execucao do plano.
- `/api/consumo-mp`: explode plano em consumo de MP, consulta estoque,
  fornecedores, compras em andamento, OPs internas e finalizados.
- `/api/totvs-moda`: integra com API TOTVS Moda para custo de MP e pedido de
  compra.
- `/api/projecoes`: projecoes, reprojecao, sem-projecao, upload e reajustes.
- `/api/capacidade`: grupos, tempos, dias e gargalos.

## Frontend

Entrada principal:

- `frontend/app/page.tsx`: plano de producao/matriz principal.

Telas mais relacionadas com TOTVS:

- `frontend/app/orcamento-mp/page.tsx`: calcula orcamento de MP, consulta custos
  TOTVS, salva snapshots e exporta espelho de valores.
- `frontend/app/pedido-compra/page.tsx`: transforma falta de MP em pedidos
  sugeridos, monta payload TOTVS e envia/cancela pedido pela API.
- `frontend/app/sugestao-plano/page.tsx`: calcula sugestoes do plano usando
  projecao, estoque, capacidade, OP minima, curvas e ajustes.
- `frontend/app/capacidade*.tsx`: apoia sequenciamento e gargalos, mas ainda nao
  tem destino TOTVS validado para gravacao.

## Matriz / plano oficial

Fonte principal:

- `GET /api/producao/matriz`
- servico: `src/services/producaoService.js`
- cache: `src/cache/matrizCache.js`

Campos recorrentes:

- `produto.idproduto`
- `produto.cd_seqgrupo`
- `produto.referencia`
- `produto.produto`
- `produto.cor`
- `produto.tamanho`
- `produto.curva`
- `produto.continuidade`
- `estoques.estoque_atual`
- `estoques.em_processo`
- `estoques.estoque_minimo`
- `demanda.pedidos_pendentes`
- `plano.ma`, `plano.px`, `plano.ul`, `plano.qt`, `plano.qu`

Uso:

- alimentar tela principal;
- alimentar sugestao de plano;
- alimentar orcamento de MP e pedido de compra.

Destino TOTVS ainda em aberto:

- plano/OP/programacao precisa de componente ou API validada antes de gravar.

## Orcamento MP

Tela:

- `frontend/app/orcamento-mp/page.tsx`

Fluxo:

1. carrega matriz oficial;
2. monta lista de planos por SKU;
3. chama `POST /api/consumo-mp/analise` para consumo de MP;
4. chama `POST /api/totvs-moda/prices/mp` para custo de MPs;
5. calcula valor de consumo, necessidade, folga e orcamento;
6. pode salvar snapshot versionado;
7. pode exportar espelho atual para `app_orcamento_mp_exportacao`.

Tabelas internas:

- `app_orcamento_mp_cache`: cache da tela de orcamento MP.
- `app_orcamento_mp_snapshots`: historico/fotos completas do orcamento.
- `app_orcamento_mp_exportacao`: espelho atual por MP com valores em reais.

Exportacao atual:

- `POST /api/producao/orcamento-mp-exportacao`
- substitui a tabela toda.
- campos: `idmateriaprima`, `valor_necessidade_total`,
  `valor_folga`, `valor_orcamento`.

Importante:

- exportar orcamento altera tabela interna do projeto, nao necessariamente o
  TOTVS.
- para vincular esse orcamento ao TOTVS, ainda precisa decidir se sera via API,
  componente, classificacao, pedido, verba, centro de custo ou outro destino.

## Pedido de compra

Tela:

- `frontend/app/pedido-compra/page.tsx`

Fluxo:

1. carrega matriz oficial;
2. chama `POST /api/consumo-mp/analise`;
3. calcula faltas por MP e periodo;
4. consulta custos via `POST /api/totvs-moda/prices/mp`;
5. agrupa pedidos por fornecedor;
6. monta payload TOTVS;
7. envia por `POST /api/totvs-moda/purchase-orders`;
8. pode cancelar teste por `POST /api/totvs-moda/purchase-orders/cancel`.

Payload de pedido TOTVS:

- `branchCode`
- `supplierCode`
- `buyerCode`
- `operationCode`
- `paymentConditionCode`
- `status: 5`
- `orderDate`
- `totalAmountOrder`
- `items[]`: `productCode`, `value`, `quantity`
- `observations[]`

Mutabilidade:

- enviar pedido cria dados no TOTVS;
- cancelar pedido altera dados no TOTVS;
- ambos exigem autorizacao explicita do usuario.

## API TOTVS Moda

Arquivo:

- `src/routes/totvsModa.js`

Rotas:

- `POST /api/totvs-moda/prices/mp`: consulta custos de MP.
- `POST /api/totvs-moda/purchase-orders`: envia pedido.
- `POST /api/totvs-moda/purchase-orders/cancel`: cancela pedido.

Configuracao `.env`:

- `TOTVS_MODA_BASE_URL`
- `TOTVS_MODA_GRANT_TYPE`
- `TOTVS_MODA_CLIENT_ID`
- `TOTVS_MODA_CLIENT_SECRET`
- `TOTVS_MODA_USERNAME`
- `TOTVS_MODA_PASSWORD`
- `TOTVS_MODA_PRICE_BRANCH_CODES`
- `TOTVS_MODA_COST_CODES`

Essa API e diferente do cliente Virtual Age usado pelo agent minimo.

## Consumo MP

Arquivo:

- `src/routes/consumoMp.js`

Rota central:

- `POST /api/consumo-mp/analise`

Ela recebe planos por SKU e retorna MPs com:

- consumo por periodo;
- estoque fisico/insp/corte;
- entradas de compras;
- OPs internas;
- finalizados recentes;
- fornecedores;
- conversao/unidade;
- saldo por periodo;
- detalhes de pedidos.

Views/tabelas usadas com frequencia:

- `vr_pcp_fccconsumo` ou fallback `vr_pcp_fcconsumo`
- `vr_prd_prdgrade`
- `vr_prd_fornecedor`
- `vr_cmp_pedidoc2`
- `vr_cmp_pedidoi`
- `vr_pcp_opi`

## Projecoes

Tabela:

- `app_projecoes`

Arquivos:

- `src/routes/projecoes.js`
- `src/services/projecoesService.js`
- `frontend/app/projecoes/page.tsx`
- `frontend/app/sugestao-plano/page.tsx`

Uso:

- alimentar plano futuro;
- reprojecao por venda real;
- itens sem projecao;
- cenarios e de/para.

Destino TOTVS:

- ainda nao validado para gravacao no TOTVS.

## O que ainda falta descobrir no TOTVS

- Onde o plano oficial deveria ser conferido ou gravado no Virtual Age.
- Se o orcamento MP deve virar pedido, verba, item de despesa, centro de custo,
  previsao financeira ou apenas espelho interno.
- Quais componentes TOTVS correspondem a:
  - programacao/plano/OP;
  - pedido de compra pela tela;
  - classificacao de despesa;
  - custos de MP;
  - consulta de fornecedor/MP.

## Componente conhecido: FCPFM003

`FCPFM003 - Lista/Manutencao Item de Despesa`

Ja abre corretamente pelo agent minimo. E cadastro/manutencao:

- `F5`: incluir;
- `F3`: salvar;
- `F8`: excluir.

Nao usar essas teclas sem autorizacao explicita.

