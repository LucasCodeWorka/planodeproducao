# Skills base do TOTVS Agent

Este documento separa o que deve ser automacao deterministica do que deve ser
trabalho de agente.

## Regra principal

Se o passo e sempre igual e nao exige interpretacao, ele vira skill base e nao
gasta token.

Se o passo exige olhar a tela, entender contexto, decidir, comparar dados ou
registrar aprendizado novo, entra o agente e pode gastar token.

## Skill: abrir-sistema

**Objetivo:** abrir o TOTVS Moda, fazer login, selecionar empresa/produto e
deixar no ponto de digitar o codigo de um componente.

**Gasta token:** nao.

**Comando:**

```powershell
.\.venv\Scripts\python.exe totvs_agent_minimo\main.py abrir-sistema
```

**Fluxo atual:**

1. abrir/encontrar a janela do TOTVS Moda;
2. esperar 14 segundos;
3. digitar usuario do `.env`;
4. `Tab`;
5. digitar senha do `.env`;
6. `Enter`;
7. digitar empresa do `.env` ou `1`;
8. `Enter`;
9. `Enter`;
10. esperar 16 segundos;
11. enviar `Tab` 6 vezes.

**Resultado esperado:** cursor no ponto de escrever o codigo do componente.

## Skill: abrir-componente

**Objetivo:** com o sistema ja aberto e posicionado pelo `abrir-sistema`,
digitar o codigo do componente e abrir a tela.

**Gasta token:** nao.

**Comando:**

```powershell
.\.venv\Scripts\python.exe totvs_agent_minimo\main.py abrir PRDFL035
```

**Resultado esperado:** componente aberto na tela.

**Fluxo atual:** com o cursor ja deixado por `abrir-sistema`, digitar o codigo
do componente, pressionar `Tab` e aguardar a janela interna abrir. Nao clicar,
nao limpar, nao navegar antes.

**Padrao geral validado:** todos os componentes devem abrir dessa forma:
escrever o codigo, dar um unico `Tab` e esperar um pouco.

**Pre-condicao:** nao tenta logar nem detectar estado automaticamente. Se o
sistema estiver na tela de login, nao use esta skill; use `abrir-sistema`
primeiro.

## Skill: analisar-componente

**Objetivo:** entender uma tela nova, mapear campos, botoes, riscos,
validacoes e registrar conhecimento para proximas execucoes.

**Gasta token:** sim, porque exige visao/raciocinio.

**Quando usar:** depois que `abrir-sistema` e `abrir-componente` ja deixaram o
ERP no lugar certo.

**Saida esperada:** um arquivo documentando o componente em
`skills/componentes/<CODIGO>.md`.

## Skill: registrar-procedimento

**Objetivo:** quando um fluxo ja foi entendido, transformar a descoberta em
passo a passo reutilizavel.

**Gasta token:** normalmente sim na primeira vez; depois o procedimento pode
virar automacao deterministica.

**Saida esperada:** documento com objetivo, pre-condicoes, passos, validacao,
armadilhas e acoes que alteram dados.

## Ordem recomendada para qualquer projeto

1. `abrir-sistema`
2. `abrir-componente`
3. `analisar-componente`, somente se ainda nao houver documentacao suficiente
4. transformar o que for repetitivo em nova skill deterministica
