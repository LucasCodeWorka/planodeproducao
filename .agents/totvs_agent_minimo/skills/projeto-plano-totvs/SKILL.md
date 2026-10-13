# Skill: projeto-plano-totvs

## Objetivo

Entender quais dados deste projeto de plano de producao/orcamento podem precisar
ser consultados, conferidos ou enviados ao TOTVS Moda.

Esta skill nao abre sistema, nao abre componente e nao grava dados. Ela serve
para mapear origem, destino provavel, riscos e lacunas antes de qualquer acao
operacional no TOTVS.

## Regras principais

- Nao redescobrir o fluxo basico do TOTVS.
- Nao misturar esta skill com `abrir-sistema` ou `abrir-componente`.
- Quando precisar olhar uma tela do TOTVS, usar primeiro `abrir-sistema` e
  depois `abrir-componente`.
- Nunca usar `F3`, `F5`, `F8` ou confirmacoes de gravacao/exclusao sem
  autorizacao explicita do usuario no momento.
- Nunca enviar pedido, cancelar pedido, salvar cadastro, incluir item ou excluir
  registro apenas por inferencia do mapeamento.

## Fluxo recomendado

1. Identificar qual decisao do projeto esta em jogo: compra de MP, plano de
   producao, projecao de venda, capacidade, custo/preco ou classificacao de
   despesa.
2. Localizar as fontes no projeto usando a referencia
   `references/projeto-plano-dados.md`.
3. Separar dados que ja existem via API/TOTVS Moda REST dos dados que exigem
   tela do Virtual Age.
4. Se uma tela do TOTVS precisar ser aberta, executar nesta ordem:

```powershell
python .agents\totvs_agent_minimo\main.py abrir-sistema
python .agents\totvs_agent_minimo\main.py abrir CODIGO_COMPONENTE
```

5. Ler a skill do componente quando houver documento em `skills/componentes/`.
6. Produzir primeiro uma proposta de mapeamento ou arquivo de conferencia.
7. Pedir autorizacao explicita antes de qualquer acao que altere dados.

## Areas do projeto que provavelmente se conectam ao TOTVS

- Projecoes de venda e plano por SKU: podem alimentar decisoes de producao, mas
  o componente/tabela de destino ainda precisa ser confirmado.
- Necessidade de materia-prima: pode apoiar pedidos de compra ou conferencias de
  cobertura de estoque.
- Orcamento de MP e custos: ja usa consulta de custos TOTVS via API no projeto.
- Pedidos de compra: o projeto possui rota de envio/cancelamento via API; ambas
  sao acoes mutaveis e exigem autorizacao.
- Capacidade por grupo/referencia: ajuda a sequenciar plano, mas ainda nao e um
  dado validado para gravacao no TOTVS.
- Itens de despesa (`FCPFM003`): atualmente documentado para leitura e
  aprendizado; nao incluir, salvar ou excluir sem autorizacao.

## Resultado esperado

Ao usar esta skill, entregar uma resposta em formato de mapeamento:

- dado de origem no projeto;
- arquivo, rota, tabela ou cache onde ele aparece;
- destino TOTVS conhecido ou hipotese de destino;
- se a acao e consulta, conferencia, exportacao ou gravacao;
- risco operacional;
- proximo passo seguro.

Se o destino TOTVS ainda for desconhecido, registrar isso como lacuna em vez de
inventar componente, tecla ou fluxo.
