# Contexto rapido - plano/orcamento + TOTVS

Use este arquivo para economizar contexto. Nao reler o projeto inteiro sem
pedido explicito.

## Regra TOTVS

- O agent minimo fica em `.agents/totvs_agent_minimo`.
- Nao usar a pasta antiga `va_agent`.
- Primeiro: `python .agents\totvs_agent_minimo\main.py abrir-sistema`
- Depois: `python .agents\totvs_agent_minimo\main.py abrir CODIGO`
- `abrir CODIGO` so digita o componente e envia um unico `Tab`.
- Nunca usar `F3`, `F5`, `F8`, salvar, incluir, excluir, enviar ou cancelar
  sem autorizacao explicita.

## Ideia do projeto

Este repo e o plano de producao/orcamento. O TOTVS e ferramenta operacional do
projeto, nao um fluxo separado.

Fluxo mental:

`Plano de Producao` -> `Orcamento MP` -> `Pedido Compra` -> `TOTVS/API ou tela`

## Pontes ja existentes

- `src/routes/totvsModa.js`
  - `POST /api/totvs-moda/prices/mp`: consulta custo de MP no TOTVS.
  - `POST /api/totvs-moda/purchase-orders`: cria pedido de compra no TOTVS.
  - `POST /api/totvs-moda/purchase-orders/cancel`: cancela pedido no TOTVS.

- `frontend/app/orcamento-mp/page.tsx`
  - carrega matriz oficial;
  - chama `POST /api/consumo-mp/analise`;
  - consulta custo TOTVS;
  - calcula necessidade, folga e valor do orcamento;
  - salva snapshots;
  - exporta espelho atual para `app_orcamento_mp_exportacao`.

- `frontend/app/pedido-compra/page.tsx`
  - calcula faltas de MP;
  - agrupa pedidos por fornecedor;
  - monta payload TOTVS com `branchCode`, `supplierCode`, `buyerCode`,
    `operationCode`, `paymentConditionCode`, `status`, `orderDate`,
    `totalAmountOrder`, `items`;
  - envia/cancela pela API TOTVS.

## Fonte do plano

- `GET /api/producao/matriz`
- backend em `src/routes/producao.js` e `src/services/producaoService.js`
- cache em `src/cache/matrizCache.js`

Campos importantes:

- `produto.idproduto`, `produto.cd_seqgrupo`, `produto.referencia`,
  `produto.cor`, `produto.tamanho`, `produto.curva`, `produto.continuidade`
- `estoques.estoque_atual`, `estoques.em_processo`,
  `estoques.estoque_minimo`
- `demanda.pedidos_pendentes`
- `plano.ma`, `plano.px`, `plano.ul`, `plano.qt`, `plano.qu`

## Consumo MP

- `POST /api/consumo-mp/analise`
- arquivo: `src/routes/consumoMp.js`
- explode o plano em consumo de MP, estoque, compras, OP interna, fornecedor,
  finalizados, saldos e detalhes de pedido.

## O que ainda falta descobrir

- Qual tela/componente TOTVS recebe ou confere plano/OP/programacao.
- Se o orcamento MP deve virar pedido, verba, despesa, centro de custo ou apenas
  espelho interno.
- Quais componentes correspondem a custo de MP, fornecedor, pedido pela tela,
  classificacao de despesa e programacao.

## Componente conhecido

- `FCPFM003 - Lista/Manutencao Item de Despesa`
- Abre corretamente.
- Teclas perigosas: `F5` incluir, `F3` salvar, `F8` excluir.

