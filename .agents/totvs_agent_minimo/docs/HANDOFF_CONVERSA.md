# Handoff da conversa - TOTVS Agent Minimo

Use este arquivo quando mover a pasta `totvs_agent_minimo` para outro projeto.
A ideia e permitir continuar como se a conversa ainda estivesse em andamento,
sem redescobrir as decisoes basicas.

## Intencao do usuario

O usuario quer um **agent minimo para TOTVS Moda**, mas nao quer gastar token
com processos repetitivos como abrir o sistema, logar e abrir componente.

O objetivo e plugar essa pasta em outro projeto grande, relacionado a
orcamento, e ali ensinar o agente a entender o que daquele projeto precisa ir
para dentro do TOTVS.

## Divisao combinada

**Skill/script deterministico, sem token:**

- abrir o sistema;
- logar;
- selecionar empresa/produto;
- deixar no ponto de escrever componente;
- abrir componente pelo codigo.

**Agente pensante, com token quando necessario:**

- olhar tela;
- entender um componente novo;
- mapear campos, botoes e riscos;
- analisar dados;
- registrar aprendizado;
- orquestrar skills quando o fluxo ja estiver claro.

## Contrato validado: abrir sistema

Comando:

```powershell
python totvs_agent_minimo\main.py abrir-sistema
```

Fluxo validado:

1. abrir/encontrar janela do TOTVS Moda;
2. esperar 14 segundos;
3. limpar o campo atual antes de digitar usuario;
4. digitar usuario do `.env`;
5. `Tab`;
6. digitar senha do `.env`;
7. `Enter`;
8. digitar empresa do `.env` ou `1`;
9. `Enter`;
10. `Enter`;
11. esperar 16 segundos;
12. enviar `Tab` 6 vezes.

Resultado esperado: o sistema fica no ponto de escrever o codigo do componente.

### Fluxo composto recomendado

Para evitar que o componente seja digitado antes de a tela terminar de
estabilizar, usar o comando composto:

```powershell
python .agents\totvs_agent_minimo\main.py abrir-fluxo FCPFM043
```

Esse comando executa `abrir-sistema`, aguarda a estabilizacao do foco e entao
executa `abrir FCPFM043`. O comando simples `abrir` continua disponivel para
quando o sistema ja estiver comprovadamente no campo de componente.

## Contrato validado: abrir componente

Comando:

```powershell
python totvs_agent_minimo\main.py abrir FCPFM003
```

Pre-condicao: `abrir-sistema` ja rodou e deixou o cursor no ponto certo.

Fluxo validado:

1. digitar o codigo do componente;
2. pressionar **um unico `Tab`**;
3. esperar alguns segundos.

Nao clicar, nao limpar, nao usar `Enter`, nao tentar logar, nao navegar antes.

Esse e o padrao geral para todos os componentes: escrever codigo + um `Tab` +
esperar.

## Cuidado importante aprendido

Nao misturar as skills.

O erro que quase baguncou tudo foi tentar fazer `abrir-componente` tambem
"garantir sessao". Isso colocou `FCPFM003` na tela de login quando o sistema
nao estava realmente logado.

Regra daqui para frente:

```text
abrir-sistema primeiro.
abrir-componente depois.
```

Cada uma deve fazer so sua parte.

## Componente em aprendizado: FCPFM003

Codigo correto: `FCPFM003`.

O usuario corrigiu uma fala inicial em que tinha dito `FCPFM033`.

Nome visto:

```text
FCPFM003 - Lista/Manutencao Item de Despesa
```

O componente abre direto em uma listagem grande.

Informacoes do usuario:

- `F8`: excluir;
- `F3`: salvar;
- `F5`: incluir.

Essas teclas alteram cadastro. Nunca usar sem autorizacao explicita.

Observacao visual ja registrada:

- primeiro codigo visivel em uma captura: `89 - ETIQUETA COMPOSICAO MP`;
- pode haver linha selecionada diferente do primeiro item visivel.

Documento do componente:

```text
totvs_agent_minimo/skills/componentes/FCPFM003.md
```

## Tom de trabalho preferido

O usuario quer construir isso com calma e de forma pratica.

Ele valoriza:

- testar passo a passo;
- nao pular etapas;
- separar skills pequenas;
- nao usar agente quando script resolve;
- nao apertar teclas que alteram dados;
- salvar o contexto para continuar em outro projeto.

Quando houver duvida operacional, pare e confirme. Principalmente em tela de
producao.

## Proximo passo ao chegar no projeto de orcamento

1. Copiar a pasta `totvs_agent_minimo`.
2. Instalar `totvs_agent_minimo/requirements.txt`.
3. Criar/preencher `.env` no projeto de destino.
4. Testar apenas:

```powershell
python totvs_agent_minimo\main.py abrir-sistema
python totvs_agent_minimo\main.py abrir FCPFM003
```

5. Depois criar skills especificas do projeto de orcamento.

Observacao: a pasta minima ja embute o nucleo que funcionou aqui. Nao precisa
levar a pasta antiga de experimentos.

## Estado atual do projeto de orcamento - 2026-10-06

### O que foi concluido

- A tela `Detalhe por MP` do projeto esta em `/orcamento-mp`.
- Foram analisadas as MPs com valor de orcamento.
- Foram identificadas 392 linhas com valor.
- As 392 linhas possuem cadastro correspondente em `app_mp_cadastro`.
- As 392 linhas possuem vinculo local com uma despesa em `app_mp_despesa`.
- Nao ha MPs com valor sem despesa vinculada.
- Nao ha pendencias locais de despesas.
- As 9 despesas faltantes foram cadastradas manualmente no `FCPFM003`.
- Os codigos criados foram `1453` ate `1461`.
- Depois do cadastro, foi feita uma correcao visual e salvamento para garantir:
  - `Padrao` marcado;
  - `Custo/Despesa = Despesa`;
  - `Fixo/Variavel = Fixo`;
  - classificacoes de custo preenchidas.
- A sincronizacao da visao do ERP foi consultada pelo agente, mas o usuario
  tambem conferiu diretamente no banco e confirmou os registros.

### Decisoes confirmadas

- A tabela principal deve consolidar o orcamento e a integracao com o TOTVS.
- A tabela deve relacionar MP/SKU, cor, descricao, despesa TOTVS, plano de
  contas, centro de custo, valores por periodo, comprado, orcamento e saldo.
- O centro de custo a considerar para o PCP e o `506`.
- O valor mensal sera trabalhado nos periodos usados pelo sistema: `MA`, `PX`,
  `UL`, `QT`, `QU` e `SX`.
- A coluna de orcamento do projeto representa a necessidade somada ao valor ja
  comprado para o plano.
- O proximo componente operacional sera o `FCPFM043`, para cadastrar as 392
  despesas dentro do plano de contas do PCP/centro `506`.
- Depois sera analisado o `FCPFM017`, que devera receber os valores disponiveis
  por despesa e por periodo.

### Proxima sequencia de trabalho

1. Desenhar e validar a tabela principal de integracao.
2. Conferir os campos e regras do `FCPFM043` sem alterar nada inicialmente.
3. Preparar a carga das 392 despesas para o plano de contas do PCP/centro
   `506`.
4. Executar o cadastro no TOTVS somente com autorizacao explicita.
5. Mapear o `FCPFM017` e preparar o controle mensal de valores disponiveis.
6. Em etapa posterior, analisar o `CMPFM020` para bloquear pedidos quando o
   valor comprado ultrapassar o orcamento autorizado.

### Regras para continuar

- Nao desenvolver nem executar novas alteracoes nesta etapa de encerramento.
- Nao redescobrir o fluxo basico do agente.
- Sempre executar `abrir-sistema` antes de abrir um componente.
- Nao usar `F3`, `F5`, `F8` ou outras acoes de alteracao sem autorizacao
  explicita para a etapa correspondente.
- Antes de cadastrar as 392 despesas, validar a tabela principal e o layout
  do `FCPFM043`.
