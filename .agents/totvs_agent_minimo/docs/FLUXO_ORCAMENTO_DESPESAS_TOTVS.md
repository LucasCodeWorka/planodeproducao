# Fluxo em analise - orcamento MP para despesas TOTVS

Este fluxo ainda esta em analise. Nao executar gravacao no TOTVS sem nova
autorizacao explicita.

## Objetivo

Levar o orcamento calculado na tela `http://localhost:3000/orcamento-mp` para o
TOTVS, provavelmente como despesas vinculadas ao plano de contas.

No projeto, a base atual e a tabela `Detalhe por MP` da tela de orcamento MP.
Ela ja esta no formato desejado para o orcamento e alimenta a fila interna:

- `app_orcamento_mp_despesas_totvs`
- rota `POST /api/producao/orcamento-mp-despesas/preparar`
- rota `GET /api/producao/orcamento-mp-despesas`

Essa fila interna nao envia nada ao TOTVS; serve para conferencia/preparacao.

## Componentes TOTVS citados pelo usuario

### FCPFM043

Uso esperado:

1. abrir componente `FCPFM043`;
2. informar codigo `500`, que corresponde ao plano de contas;
3. consultar/abrir a estrutura;
4. procurar dentro da estrutura uma sublinha/bancada de despesa cadastrada;
5. verificar se as despesas de materia-prima existem ali;
6. mapear cada linha de despesa do TOTVS com a tabela de orcamento MP do projeto.

Estado: componente ainda nao mapeado pelo agente.

### FCPFM017

Uso esperado:

1. abrir componente `FCPFM017`;
2. informar plano/codigo `500`;
3. informar numero `1`;
4. informar ano `2026`;
5. usar `F4` para consultar;
6. validar se as despesas exibidas correspondem as linhas da tabela de orcamento;
7. preencher/conferir o valor disponivel para compra por despesa;
8. validar os meses/valores mensais disponiveis para cada despesa.

Estado: componente ainda nao mapeado pelo agente.

## Hipotese de dados

A tabela `Detalhe por MP` fornece, por materia-prima:

- `idmateriaprima`
- `artigo`
- `descricao`
- `unidade`
- `quantidade_necessidade`
- `valor_unitario`
- `valor_necessidade`
- `valor_folga`
- `valor_orcamento`
- `periodo_ate`
- `origem_valor`

Possivel relacionamento com o TOTVS:

- `artigo` ou algum agrupamento de MP pode corresponder a uma despesa/bancada
  no plano de contas 500;
- `valor_orcamento` e o valor que deve ficar disponivel para compra;
- valores por mes precisam ser derivados do detalhe por periodo da tela de
  orcamento, nao apenas do total acumulado.

## Lacunas importantes

- Confirmar quais campos aparecem em `FCPFM043`.
- Confirmar qual coluna identifica a despesa/bancada dentro do plano 500.
- Confirmar se o relacionamento deve ser por `artigo`, por `idmateriaprima`, por
  descricao, por classificacao do TOTVS ou por algum codigo de item de despesa.
- Confirmar quais campos aparecem em `FCPFM017`.
- Confirmar como o TOTVS distribui valor por mes e se aceita total anual.
- Confirmar se `F4` e apenas consulta nesse componente.
- Confirmar quais teclas salvam/alteram dados em `FCPFM017` e `FCPFM043`.

## Regras de seguranca

- Pode abrir componente e consultar tela com autorizacao do usuario.
- Nao usar `F3`, `F5`, `F8` sem autorizacao explicita.
- Nao salvar, incluir, excluir ou confirmar alteracao sem autorizacao explicita.
- Antes de qualquer gravacao, gerar uma tabela de conferencia com:
  - despesa TOTVS;
  - MP/artigo origem;
  - valor total;
  - valores por mes;
  - status de relacionamento;
  - divergencias.

## Proximo passo seguro

1. Analisar a tabela interna `app_orcamento_mp_despesas_totvs`.
2. Ver se ela precisa guardar codigo/descricao da despesa TOTVS e valores por
   mes.
3. Abrir `FCPFM043` apenas para mapear estrutura do plano 500.
4. Abrir `FCPFM017` apenas para mapear consulta do orcamento 500/1/2026.
5. Criar skills/documentacao dos dois componentes antes de qualquer tentativa de
   preenchimento.

