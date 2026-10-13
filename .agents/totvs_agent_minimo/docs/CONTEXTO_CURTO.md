# Contexto curto - TOTVS Agent Minimo

## Objetivo

Criar um agente/kit minimo para o TOTVS Moda que saiba mexer no basico do
sistema sem gastar token com passos repetitivos.

Para uma retomada mais conversacional em outro projeto, leia tambem
`docs/HANDOFF_CONVERSA.md`.

## Decisao principal

Separar:

- **skills deterministicas**: abrir sistema, logar, deixar no campo de
  componente, abrir componente;
- **agente**: olhar tela, entender componente, analisar dados, registrar
  aprendizado e decidir proximos passos.

## Skill validada: abrir-sistema

Comando:

```powershell
python totvs_agent_minimo\main.py abrir-sistema
```

Fluxo atual:

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

Resultado esperado: cursor no campo/ponto de escrever o codigo do componente.

Nao gasta token.

## Skill validada: abrir-componente

Comando:

```powershell
python totvs_agent_minimo\main.py abrir PRDFL035
```

Fluxo atual:

1. pressupor que `abrir-sistema` ja deixou o cursor no ponto correto;
2. digitar codigo do componente;
3. pressionar um unico `Tab`;
4. aguardar alguns segundos a janela interna abrir.

Nao usa `Enter` nesse fluxo.
Nao clica, nao limpa e nao navega antes de digitar o componente.

Este e o padrao geral validado para abrir componentes: todos abrem escrevendo o
codigo, dando um unico `Tab` e esperando um pouco.

Nao gasta token.

## Arquivos principais

- `totvs_agent_minimo/main.py`: comandos CLI.
- `totvs_agent_minimo/va_core/`: nucleo local de captura, input e sessao.
- `totvs_agent_minimo/core/va_bridge.py`: ponte para automacao do TOTVS.
- `totvs_agent_minimo/docs/SKILLS_BASE.md`: contrato das skills base.
- `totvs_agent_minimo/skills/abrir-sistema/SKILL.md`: skill principal.
- `totvs_agent_minimo/skills/abrir-componente/SKILL.md`: abrir componente.
- `totvs_agent_minimo/requirements.txt`: dependencias Python.
- `totvs_agent_minimo/.env.example`: modelo de configuracao.

## Estado atual da portabilidade

`totvs_agent_minimo` agora esta autocontido para o fluxo validado de abrir
sistema e abrir componente. Nao precisa copiar a pasta antiga de experimentos.

## Proximo passo recomendado

No projeto grande de orcamento:

1. levar esta pasta `totvs_agent_minimo`;
2. instalar `totvs_agent_minimo/requirements.txt`;
3. criar/preencher `.env` no projeto de destino;
4. testar `abrir-sistema` e depois `abrir <CODIGO>`;
5. criar skills especificas do projeto, por exemplo:
   - abrir-sistema;
   - abrir-componente;
   - abrir-tela-orcamento;
   - consultar-orcamento;
   - analisar-orcamento;
   - registrar-procedimento-orcamento.

## Regra de uso

Tudo que for repetitivo e igual vira skill/script sem token.

Tudo que exigir entendimento visual ou decisao entra no agente.

## Componente em aprendizado: FCPFM003

`FCPFM003 - Lista/Manutencao Item de Despesa` esta documentado inicialmente em
`skills/componentes/FCPFM003.md`.

Atalhos informados pelo usuario:

- `F5`: incluir;
- `F3`: salvar;
- `F8`: excluir.

Esses atalhos alteram cadastro e exigem autorizacao explicita antes de uso.
