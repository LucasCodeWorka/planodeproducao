# Contexto do projeto

## Remotes do Git

O projeto tem dois remotes ativos, conforme verificado no Git local:

- origin: git@github.com:LIEBEGIT/plano_producao.git
- lucas: https://github.com/LucasCodeWorka/planodeproducao.git

Uso esperado:

- origin = repositório principal / da empresa / de produção
- lucas = espelho pessoal / publicação alternativa
- quando houver publicação oficial, validar ambos antes de fechar

## Estilo de fonte e legibilidade

A tela principal já usa a escala "confortável" com a classe .tela-fonte-confortavel e persistência em localStorage via pp_tela_fonte.

A mesma regra foi aplicada ao orçamento MP para remover o visual antigo e melhorar legibilidade:

- tela principal: frontend/app/page.tsx
- escala global: frontend/app/globals.css
- orçamento MP: frontend/app/orcamento-mp/page.tsx

A lógica é manter o layout mais legível sem inflar toda a interface; a opção pode ser alternada via botão na barra do header.

## Regras importantes

- não rodar next build com o dev server do projeto ainda ativo; pode bater em EPERM ao tentar escrever .next/trace
- preservar o backup antes de operações sensíveis
- validar por build/checagem estática antes de afirmar que ficou bom
- manter mudanças reversíveis e confirmadas antes de publicar

## Observações de manutenção

- os ajustes de fonte foram feitos no padrão da tela principal e devem ser reaproveitados em outras telas quando houver a mesma queixa de legibilidade
- o contexto do projeto deve ser revisado antes de publicar em ambos os remotes
