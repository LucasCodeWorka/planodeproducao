# FCPFM003 - Lista/Manutencao Item de Despesa

Origem: observado em tela aberta no TOTVS Moda em 06/10/2026 e informacoes do
usuario.

## Para que serve

Componente de lista/manutencao de itens de despesa.

Titulo visto na tela:

```text
FCPFM003 - Lista/Manutencao Item de Despesa
```

## O que ja sabemos

- A lista e grande e segue uma ordem por codigo.
- Ao abrir o componente, a listagem ja aparece carregada.
- Na captura validada em 06/10/2026, o primeiro codigo visivel da lista era
  `89`, com descricao `ETIQUETA COMPOSICAO MP`.
- A linha selecionada ao abrir pode nao ser a primeira visivel; na captura, a
  selecao estava em `112 - FCPFM003`.
- `F5` inclui um novo item.
- `F3` salva.
- `F8` exclui.
- Por ser manutencao de cadastro, qualquer inclusao, salvamento ou exclusao
  altera dados de producao.

## Layout observado

### Grade principal: Item de despesa

Colunas vistas:

- `Codigo*`
- `Despesa item *`
- `% Rateio`
- `Fornecedor`
- `>>`
- `Descricao auxiliar`
- `Padrao`
- `Fixo/Variavel`
- `Custo/Despesa`
- `Direto/Indireto`
- `Tipo de custo`
- `Bloquear`

Campos/valores observados em linhas:

- itens como `ETIQUETA COMPOSICAO MP`, `ARCO`, `ICMS SOBRE VENDAS`,
  `SIMPLES NACIONAL`, `EMPRESTIMO PRINCIPAL`, `IMPOSTOS DIVERSOS`;
- `Padrao` aparece como checkbox;
- `Fixo/Variavel` aparece como selecao, com valores como `Fixo` e `Variavel`;
- `Custo/Despesa` aparece como selecao, visto como `Despesa`;
- `Direto/Indireto` aparece como selecao, visto como `Administrativo` e
  `Indireto`;
- `Tipo de custo` aparece como selecao, visto como `Administrativo`;
- `Bloquear` aparece como checkbox.

### Rodape da grade principal

Campo/rotulo observado:

- `Fornecedor`
- `Operador/Atualizacao`

### Grade inferior: Classificacao

Area inferior chamada `Classificacao`.

Colunas vistas:

- `Tipo classificacao`
- `>>`
- `Classificacao`
- `>>`
- `Operador/Atualizacao`

## Comandos de teclado

| Tecla | Acao conhecida | Risco |
|---|---|---|
| `F5` | Incluir item | altera cadastro |
| `F3` | Salvar | altera cadastro |
| `F8` | Excluir item | altera cadastro |

## Regras de seguranca

Consultar e navegar na lista pode ser feito sem autorizacao extra.

Nunca pressionar `F3`, `F5` ou `F8` sem autorizacao explicita do usuario na
hora, dizendo qual item/codigo sera afetado.

Nunca confirmar exclusao, gravacao ou inclusao automaticamente.

## O que ainda precisa aprender

- Como pesquisar/localizar um item especifico na lista.
- Se a ordem e sempre por `Codigo`.
- Como ir para o topo/fim da lista sem alterar dados.
- Se existe filtro ou busca pelo icone de lupa.
- Quais campos sao obrigatorios para inclusao.
- Se `Fornecedor` abre busca auxiliar ou e digitavel.
- Como a area `Classificacao` se relaciona com o item selecionado.
- Qual mensagem aparece na barra de status apos salvar, incluir ou tentar
  excluir.

## Estrategia recomendada para aprender mais

1. Capturar tela antes de qualquer acao.
2. Testar apenas navegacao segura: setas, PageDown/PageUp, lupa/pesquisa se
   nao gravar nada.
3. Registrar screenshots e comportamento.
4. Para qualquer teste de `F5`, `F3` ou `F8`, pedir autorizacao explicita antes
   e combinar qual item de teste sera usado.
