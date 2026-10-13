# Prompt de continuacao - plano de producao/orcamento + TOTVS

Use este prompt ao abrir uma nova conversa neste projeto.

```text
Quero continuar exatamente desse contexto. A pasta .agents/totvs_agent_minimo e
um agent minimo para TOTVS Moda.

Regra principal:
- Nao redescobrir o fluxo basico.
- Nao misturar as skills.
- Primeiro usar abrir-sistema.
- Depois abrir-componente.
- Nao usar F3, F5, F8 ou qualquer acao que altere dados sem minha autorizacao
  explicita.

O fluxo validado e:

python .agents\totvs_agent_minimo\main.py abrir-sistema
python .agents\totvs_agent_minimo\main.py abrir FCPFM003

A pasta ja tem o nucleo minimo em va_core. Nao depender da pasta antiga
va_agent.

Quero plugar isso neste projeto de plano de producao/orcamento e criar skills
especificas daqui para entender quais dados do projeto devem ir para o TOTVS.

Comece lendo:
- .agents/totvs_agent_minimo/docs/HANDOFF_CONVERSA.md
- .agents/totvs_agent_minimo/skills/projeto-plano-totvs/SKILL.md
- .agents/totvs_agent_minimo/skills/projeto-plano-totvs/references/projeto-plano-dados.md

Estado atual:
- A skill projeto-plano-totvs foi criada para mapear dados do projeto para o
  TOTVS sem executar gravacoes.
- O comando abrir-sistema foi tentado, mas o .env deste projeto ainda nao tem
  as variaveis VA_CLIENT, VA_HOST, VA_USER, VA_PASS, VA_APP_USER e VA_APP_PASS.
- Antes de testar a abertura real do Virtual Age, preencher essas variaveis no
  .env local.
```

