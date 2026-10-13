# Skill: abrir-sistema

## Objetivo

Abrir o TOTVS Moda, fazer login, selecionar empresa/produto e deixar o cursor
no ponto de digitar o codigo de um componente.

## Custo

Nao gasta token. E uma automacao local por teclado.

## Comando

```powershell
.\.venv\Scripts\python.exe totvs_agent_minimo\main.py abrir-sistema
```

## Fluxo atual

1. abrir ou encontrar a janela do TOTVS Moda;
2. esperar 14 segundos;
3. digitar usuario;
4. pressionar `Tab`;
5. digitar senha;
6. pressionar `Enter`;
7. digitar empresa;
8. pressionar `Enter`;
9. pressionar `Enter`;
10. esperar 16 segundos;
11. pressionar `Tab` 6 vezes.

## Resultado esperado

O sistema fica pronto para receber o codigo do componente.

## Dados sensiveis

Usuario, senha e empresa ficam fora da skill e sao lidos do `.env`.

