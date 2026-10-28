# TOTVS Agent Minimo

Base limpa para operar o TOTVS Moda / Virtual Age sem fazer o agente gastar
tokens com passos repetitivos.

Resumo do que foi decidido/validado nesta conversa:
[docs/CONTEXTO_CURTO.md](docs/CONTEXTO_CURTO.md).

Para continuar em outro projeto como se esta conversa ainda estivesse ativa:
[docs/HANDOFF_CONVERSA.md](docs/HANDOFF_CONVERSA.md).

Esta pasta ja inclui o nucleo minimo validado para abrir o TOTVS e componentes,
sem depender da pasta antiga de experimentos.

- `skills/`: conhecimento reutilizavel em Markdown. Explica o que cada fluxo
  faz, quando usar, quais riscos existem e como validar o resultado.
- `va_core/`: captura, teclado/mouse e sessao do TOTVS.
- `core/va_bridge.py`: ponte deterministica usada pelo CLI.
- `main.py`: CLI para plugar isso em outro projeto ou rodar manualmente.
- `requirements.txt`: dependencias Python necessarias.
- `.env.example`: modelo de variaveis para credenciais/caminhos.

## Por que essa divisao

Abrir o cliente, logar, dispensar avisos e abrir um componente sao tarefas de
maquina. Elas devem ser scripts/skills deterministicas.

Entender a tela, descobrir um componente novo, decidir se uma conciliacao faz
sentido, registrar aprendizado e pedir autorizacao antes de alterar dados sao
tarefas de agente.

## Comandos

Neste projeto, a entrada recomendada para abrir um componente com seguranca e:

```powershell
python .agents\totvs_agent_minimo\main.py abrir-fluxo FCPFM003
```

`abrir-fluxo` foi testado em 26/10/2026 com a aplicacao fechada e com a
sessao ja logada. Ele confirma cada etapa do login, limpa o campo de busca e
abre o componente com um `Tab`. Se o login nao for confirmado, interrompe
antes de digitar o codigo do componente. O fluxo separado `abrir-sistema`
seguido de `abrir CODIGO` continua disponivel.

Rode a partir da raiz do repositorio:

```powershell
python .agents\totvs_agent_minimo\main.py status
python .agents\totvs_agent_minimo\main.py abrir-sistema
python .agents\totvs_agent_minimo\main.py abrir PRDFL035
python .agents\totvs_agent_minimo\main.py skills
python .agents\totvs_agent_minimo\main.py skill abrir-componente
```

## Regra pratica

Quando um passo puder ser repetido sem raciocinio, vire uma skill/script.
Quando exigir olhar a tela e interpretar o contexto, deixe para o agente.

## Abrir sistema

`abrir-sistema` executa o fluxo deterministico informado pelo usuario:
espera 14 segundos na tela de login, digita usuario, Tab, senha, Enter,
empresa, Enter, Enter, espera 16 segundos e depois envia 6 Tabs para deixar o
cursor no campo de componente.

As credenciais continuam fora do codigo, lidas do `.env` (`VA_APP_USER`,
`VA_APP_PASS`, `VA_EMPRESA`).

## Abrir componente

Depois de `abrir-sistema`, qualquer componente abre pelo mesmo padrao:

```powershell
python .agents\totvs_agent_minimo\main.py abrir FCPFM003
```

A skill apenas digita o codigo, envia um unico `Tab` e espera alguns segundos.
Nao clica, nao limpa, nao usa `Enter` e nao tenta logar.

## Levar para outro projeto

Copie a pasta `totvs_agent_minimo` inteira.

No projeto de destino:

```powershell
.\.venv\Scripts\python.exe -m pip install -r totvs_agent_minimo\requirements.txt
copy totvs_agent_minimo\.env.example .env
```

Preencha o `.env` do projeto com os caminhos e credenciais.
