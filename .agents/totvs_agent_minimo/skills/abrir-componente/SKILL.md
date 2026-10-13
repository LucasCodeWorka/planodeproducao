# Skill: abrir-componente

## Objetivo

Abrir um componente do TOTVS Moda pelo codigo, por exemplo `PRDFL035` ou
`FCCFP023`.

Este e o padrao geral validado para componentes: escrever o codigo, dar um
unico `Tab` e esperar um pouco.

## Quando usar

Use quando o pedido mencionar abrir, acessar ou preparar um componente.

Se o pedido tambem exigir interpretar a tela, primeiro use esta skill e so
depois chame o agente com visao.

Pre-condicao obrigatoria: o sistema ja deve estar aberto e o cursor deve estar
no campo/ponto de digitar o componente. Para chegar nesse estado, use antes
`abrir-sistema`.

## Comando

```powershell
.\.venv\Scripts\python.exe totvs_agent_minimo\main.py abrir PRDFL035
```

## Fluxo validado

1. pressupor que `abrir-sistema` ja deixou o cursor no ponto correto;
2. digitar o codigo do componente;
3. pressionar `Tab`;
4. esperar alguns segundos a janela interna abrir;
5. usar `ver_tela` se precisar confirmar visualmente.

Nao clicar, nao limpar, nao usar `Enter` e nao navegar antes de digitar o
componente.

## Observacoes

O fluxo validado nao usa coordenada: ele depende do cursor deixado por
`abrir-sistema`. Se precisar clicar em algo novo, deve olhar a tela atual com
grade e tratar como aprendizado separado.
