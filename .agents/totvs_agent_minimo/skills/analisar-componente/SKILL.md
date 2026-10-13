# Skill: analisar-componente

## Objetivo

Entender o que um componente faz, mapear filtros, botoes, grades, riscos e
formas de validar o resultado.

## Quando usar agente

Use agente quando a tarefa pedir para:

- descrever o que existe na tela;
- entender um componente ainda nao documentado;
- decidir qual botao ou filtro usar;
- analisar dados exibidos;
- registrar um procedimento novo.

## Saida esperada

Ao terminar uma descoberta, registre um arquivo em:

```text
totvs_agent_minimo/skills/componentes/<CODIGO>.md
```

Formato sugerido:

```markdown
# <CODIGO> - <nome visto na tela>

## Para que serve

## Como abrir

## Layout

## Fluxo seguro de consulta

## Acoes que alteram dados

## Como validar

## Armadilhas
```

## Regra de producao

Consultar e livre. Gravar, excluir, conciliar, confirmar ou qualquer acao que
altere dados exige autorizacao explicita do usuario antes do clique final.

