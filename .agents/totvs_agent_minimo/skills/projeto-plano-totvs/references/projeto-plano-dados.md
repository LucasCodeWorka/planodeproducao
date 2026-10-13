# Dados do projeto plano/orcamento

Use esta referencia quando precisar entender quais dados do projeto podem se
conectar ao TOTVS Moda.

## Fontes principais

### Projecoes de venda

Arquivos e modulos:

- `src/services/projecoesService.js`
- `src/routes/projecoes.js`
- `data/projecoes.json`
- `data/insert_piso_*.sql`

Tabela principal criada pelo projeto:

- `app_projecoes`

Campos relevantes:

- `idproduto`
- `mes`
- `ano`
- `quantidade`
- `origem`
- `created_at`
- `updated_at`

Uso no projeto:

- planejar demanda futura por SKU;
- aplicar de/para de referencias novas;
- sugerir itens sem projecao;
- comparar projecao contra venda real.

Destino TOTVS:

- ainda nao validado por componente.
- tratar como dado de planejamento ate descobrir o destino correto.

### Matriz de planejamento/producao

Arquivos e modulos:

- `src/routes/producao.js`
- `src/services/producaoService.js`
- `src/cache/matrizCache.js`
- `frontend/app/analise/page.tsx`
- `frontend/app/capacidade-matriz/page.tsx`

Estrutura recorrente por item:

- `produto.idproduto`
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
- `demanda.media_vendas_3m`
- `demanda.media_vendas_6m`
- `plano.ma`
- `plano.px`
- `plano.ul`
- `plano.qt`

Uso no projeto:

- calcular necessidade de producao;
- priorizar SKU/referencia;
- avaliar cobertura e risco de ruptura;
- alimentar analises de capacidade.

Destino TOTVS:

- pode virar conferencia de OP, plano ou programacao, mas o componente exato
  ainda precisa ser aprendido.

### Orcamento e necessidade de materia-prima

Arquivos e modulos:

- `src/routes/consumoMp.js`
- `frontend/app/orcamento-mp/page.tsx`
- `frontend/app/analise-consumo-mp/page.tsx`
- `scripts/carga-mp-cadastro.cjs`
- `scripts/check-mp-fields.cjs`

Caches/tabelas citadas no projeto:

- `app_orcamento_mp_cache`
- `app_mp_cadastro`

Campos recorrentes:

- `idmateriaprima`
- `nome_materiaprima`
- `estoquefisico`
- `estoqueinsp`
- `estoquecorte`
- `estoquetotal`
- `entrada_andamento`
- `necessidade_total`
- `valor_necessidade_total`
- `seqgrupo`
- `cor`
- `descricao`

Uso no projeto:

- consolidar consumo de MP do plano;
- calcular cobertura/falta;
- estimar valor da necessidade;
- apoiar compra por grupo/cor/MP.

Destino TOTVS:

- consulta de custos de MP ja existe via API.
- envio de pedido de compra tambem existe via API, mas e mutavel e exige
  autorizacao explicita.

### API TOTVS Moda no projeto

Arquivo:

- `src/routes/totvsModa.js`

Rotas relevantes:

- `POST /api/totvs-moda/prices/mp`: consulta custos de MPs.
- `POST /api/totvs-moda/purchase-orders`: envia pedido de compra.
- `POST /api/totvs-moda/purchase-orders/cancel`: cancela pedido de compra.

Regras:

- consulta de custo e leitura.
- envio e cancelamento de pedido sao acoes mutaveis.
- antes de envio/cancelamento, montar payload, validar totais, fornecedor,
  condicao de pagamento, empresa, operacao e itens.
- pedir autorizacao explicita mostrando o resumo do pedido ou cancelamento.

### Capacidade

Arquivos e modulos:

- `src/routes/capacidade.js`
- `frontend/app/capacidade/page.tsx`
- `frontend/app/capacidade-matriz/page.tsx`
- `data/capacidade_grupos.json`
- `data/capacidade_grupo_refs.json`
- `data/capacidade_dias.json`

Campos/conceitos:

- grupo produtivo;
- referencia;
- tempo por peca;
- carga em minutos;
- folga/deficit;
- sequenciamento por horizonte.

Destino TOTVS:

- ainda nao validado para gravacao.
- usar para conferencia e tomada de decisao ate descobrir componente seguro.

## Mutabilidade

Considere mutaveis e exigir autorizacao explicita:

- salvar cadastro em tela TOTVS;
- incluir ou excluir item;
- enviar pedido de compra;
- cancelar pedido de compra;
- apagar/importar projecoes no banco;
- alterar regras de capacidade ou cortes minimos.

Considere seguros para diagnostico:

- ler arquivos e rotas;
- montar mapeamento;
- gerar dry-run;
- consultar custos;
- abrir componente para observacao, sem teclas de gravacao.
