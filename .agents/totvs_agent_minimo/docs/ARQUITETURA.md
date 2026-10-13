# Arquitetura proposta

## Divisao mental

Use tres camadas:

1. **Ferramenta deterministica**: captura, clique, digitacao, login, abrir
   componente. Deve ser barata, testavel e sem raciocinio.
2. **Skill**: memoria operacional. Diz quando usar uma ferramenta, riscos,
   pre-condicoes, validacao e armadilhas.
3. **Agente**: raciocinio. Observa tela, interpreta, decide, pede autorizacao
   quando uma acao altera dados e registra aprendizado novo.

## Exemplo

Pedido: "abra o PRDFL035 e me diga quais filtros existem".

Fluxo:

1. `abrir-sistema` roda sem agente;
2. `abrir-componente` roda sem agente;
3. agente recebe a tela ja no componente e usa visao para descrever os filtros;
4. se descobrir algo novo, registra em `skills/componentes/PRDFL035.md`.

## Como levar para outro projeto

Copie a pasta `totvs_agent_minimo` inteira. Ela ja inclui as primitivas
validadas (`capture.py`, `input.py`, `session.py`, `tools.py`) em `va_core/`.

O ponto de integracao e `core/va_bridge.py`.

## Proxima evolucao natural

- transformar cada skill em manifesto com entradas/saidas;
- adicionar historico de execucao por tarefa;
- criar comando `ensinar` para registrar componente novo por template;
- separar skills de consulta e skills de mutacao;
- exigir uma politica de autorizacao para qualquer skill que altera dados.
