# Skill: criar-despesa-fcpfm003

## Objetivo

Criar itens de despesa de materia-prima no componente `FCPFM003` do TOTVS Moda
e atualizar a ponte local `app_mp_despesa`.

## Pre-condicoes

- O sistema deve estar aberto e logado.
- O componente `FCPFM003 - Lista/Manutencao Item de Despesa` deve estar aberto.
- O usuario autorizou gravar inclusoes no TOTVS.

## Fluxo mecanico validado

1. Clicar no botao `+` da barra do componente.
2. Preencher a nova linha:
   - `Despesa item *`: descricao da MP.
   - `% Rateio`: `100,00000`.
   - `Descricao auxiliar`: mesma descricao da MP.
   - `Fixo/Variavel`: `Fixo`.
   - `Direto/Indireto`: `Administrativo`.
   - `Tipo de custo`: `Administrativo`.
   - `Bloquear`: desmarcado.
3. Salvar com `F3`.
4. Conferir mensagem `Gravacao efetuada com sucesso`.
5. Atualizar `app_mp_despesa` com o codigo gerado.

## Correcao importante aprendida

Depois do lote automatico, foi observado que algumas linhas ficaram sem:

- `Padrao` marcado;
- `Custo/Despesa = Despesa`.

Essas colunas precisam ser conferidas e, se necessario, corrigidas antes ou
apos o salvamento. O comando local validado para corrigir as linhas visiveis
criadas no ultimo lote e:

```powershell
python .agents\totvs_agent_minimo\main.py corrigir-despesas-fcpfm003
```

## Comandos locais

Criar um lote de pendencias codificadas em `main.py`:

```powershell
python .agents\totvs_agent_minimo\main.py criar-despesas-fcpfm003 --start-code 1455 --skip 1 --limit 7
```

Corrigir `Padrao` e `Custo/Despesa` das linhas criadas visiveis:

```powershell
python .agents\totvs_agent_minimo\main.py corrigir-despesas-fcpfm003
```

## Sincronizacao

O banco do ERP nao sincroniza em tempo real. A validacao em
`vr_fcp_despesaitem` deve ser feita somente apos o minuto `45`.

