# Indicadores de OP - Tempo de Produção

## Objetivo

Criar indicadores de desempenho de Ordens de Produção (OP) medindo:
1. **OP LIEBE**: Pior tempo (dias) e média de todas as OPs da marca LIEBE
2. **OP Oficina**: Pior tempo (dias) e média por oficina de costura

---

## Estrutura de Dados

### Tabelas principais

| Tabela | Descrição |
|--------|-----------|
| `vr_pcp_opc` | Cabeçalho da OP (nr_op, datas, categoria) |
| `vr_pcp_opi` | Itens da OP (produtos, quantidades) |
| `vr_cdf_locop` | Locais/setores de operação |
| `vr_cdf_movopi` | Movimentação de OPs (histórico) |

### Campos de tempo na vr_pcp_opc

| Campo | Descrição |
|-------|-----------|
| `dt_inclusao` | Data de criação da OP |
| `dt_inicio` | Data de início da produção |
| `dt_encerramento` | Data de encerramento da OP |
| `dias = dt_encerramento - dt_inicio` | Tempo total de produção |

### Identificação de Oficinas

Oficinas de costura são identificadas pelo campo `ds_local` ou `grupo` contendo "OFICINA":
- "OFICINA" (CALÇA)
- "NOVO OFICINA" (SUTIÃ)

---

## Queries SQL

### 1. Validar estrutura da tabela vr_pcp_opc

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'vr_pcp_opc'
ORDER BY column_name;
```

### 2. OP LIEBE - Visão geral (OPs encerradas)

```sql
SELECT
    opc.nr_op,
    opc.dt_inclusao,
    opc.dt_inicio,
    opc.dt_encerramento,
    (opc.dt_encerramento - opc.dt_inicio) AS dias_producao
FROM vr_pcp_opc opc
WHERE opc.cd_empresa = 1
  AND COALESCE(opc.cd_categoria, 0) <> 15
  AND opc.dt_encerramento >= DATE '2026-04-01'
  AND opc.dt_encerramento IS NOT NULL
  AND opc.dt_inicio IS NOT NULL
ORDER BY dias_producao DESC;
```

### 3. OP LIEBE - Indicadores (pior e média)

```sql
WITH ops_liebe AS (
    SELECT
        opc.nr_op,
        opc.dt_inicio,
        opc.dt_encerramento,
        (opc.dt_encerramento - opc.dt_inicio) AS dias
    FROM vr_pcp_opc opc
    WHERE opc.cd_empresa = 1
      AND COALESCE(opc.cd_categoria, 0) <> 15
      AND opc.dt_encerramento >= DATE '2026-04-01'
      AND opc.dt_encerramento IS NOT NULL
      AND opc.dt_inicio IS NOT NULL
)
SELECT
    'LIEBE' AS tipo,
    MAX(dias) AS pior_dias,
    ROUND(AVG(dias)::NUMERIC, 1) AS media_dias,
    COUNT(*) AS total_ops,
    MIN(dias) AS melhor_dias
FROM ops_liebe;
```

### 4. OP Oficina - Indicadores por oficina

```sql
WITH ops_oficina AS (
    SELECT
        loc.cd_local,
        loc.ds_local AS oficina,
        opc.nr_op,
        opc.dt_inicio,
        opc.dt_encerramento,
        (opc.dt_encerramento - opc.dt_inicio) AS dias
    FROM vr_cdf_locop loc
    JOIN vr_pcp_opi opi ON loc.cd_produto = opi.cd_produto
    JOIN vr_pcp_opc opc ON opi.cd_empresa = opc.cd_empresa
                       AND opi.nr_ciclo = opc.nr_ciclo
                       AND opi.nr_op = opc.nr_op
    WHERE loc.ds_local ILIKE '%OFICINA%'
      AND opc.cd_empresa = 1
      AND COALESCE(opc.cd_categoria, 0) <> 15
      AND opc.dt_encerramento >= DATE '2026-04-01'
      AND opc.dt_encerramento IS NOT NULL
      AND opc.dt_inicio IS NOT NULL
)
SELECT
    oficina,
    MAX(dias) AS pior_dias,
    ROUND(AVG(dias)::NUMERIC, 1) AS media_dias,
    COUNT(DISTINCT nr_op) AS total_ops,
    MIN(dias) AS melhor_dias
FROM ops_oficina
GROUP BY oficina
ORDER BY pior_dias DESC;
```

### 5. OP Oficina - Detalhado (pior de cada oficina)

```sql
WITH ops_oficina AS (
    SELECT
        loc.ds_local AS oficina,
        opc.nr_op,
        opc.dt_inicio,
        opc.dt_encerramento,
        (opc.dt_encerramento - opc.dt_inicio) AS dias,
        ROW_NUMBER() OVER (PARTITION BY loc.ds_local ORDER BY (opc.dt_encerramento - opc.dt_inicio) DESC) AS rn
    FROM vr_cdf_locop loc
    JOIN vr_pcp_opi opi ON loc.cd_produto = opi.cd_produto
    JOIN vr_pcp_opc opc ON opi.cd_empresa = opc.cd_empresa
                       AND opi.nr_ciclo = opc.nr_ciclo
                       AND opi.nr_op = opc.nr_op
    WHERE loc.ds_local ILIKE '%OFICINA%'
      AND opc.cd_empresa = 1
      AND COALESCE(opc.cd_categoria, 0) <> 15
      AND opc.dt_encerramento >= DATE '2026-04-01'
      AND opc.dt_encerramento IS NOT NULL
      AND opc.dt_inicio IS NOT NULL
)
SELECT
    oficina,
    nr_op,
    dt_inicio,
    dt_encerramento,
    dias AS pior_dias
FROM ops_oficina
WHERE rn = 1
ORDER BY dias DESC;
```

---

## Implementação

### Etapa 1: Validar queries no banco
- Executar query de estrutura da tabela
- Confirmar campos de data existentes
- Testar filtro de oficinas

### Etapa 2: Criar serviço backend
- Arquivo: `src/services/indicadoresOpService.js`
- Funções:
  - `getIndicadoresLiebe(periodo)`
  - `getIndicadoresOficina(periodo)`
  - `getDetalhesOps(tipo, periodo)`

### Etapa 3: Criar rota API
- Arquivo: `src/routes/indicadores-op.js`
- Endpoints:
  - `GET /api/indicadores-op/liebe?desde=2026-04-01`
  - `GET /api/indicadores-op/oficinas?desde=2026-04-01`
  - `GET /api/indicadores-op/detalhes/:tipo?desde=2026-04-01`

### Etapa 4: Criar página frontend
- Arquivo: `frontend/app/indicadores-op/page.tsx`
- Cards com indicadores
- Tabela detalhada
- Filtro por período

---

## Estrutura de resposta esperada

### Indicadores LIEBE

```json
{
  "tipo": "LIEBE",
  "periodo": {
    "desde": "2026-04-01",
    "ate": "2026-04-27"
  },
  "indicadores": {
    "pior_dias": 45,
    "media_dias": 12.5,
    "melhor_dias": 3,
    "total_ops": 150
  },
  "pior_op": {
    "nr_op": 12345,
    "dt_inicio": "2026-03-01",
    "dt_encerramento": "2026-04-15",
    "dias": 45
  }
}
```

### Indicadores Oficinas

```json
{
  "tipo": "OFICINAS",
  "periodo": {
    "desde": "2026-04-01",
    "ate": "2026-04-27"
  },
  "oficinas": [
    {
      "nome": "OFICINA",
      "tipo_produto": "CALÇA",
      "pior_dias": 30,
      "media_dias": 8.2,
      "total_ops": 45,
      "pior_op": {
        "nr_op": 54321,
        "dias": 30
      }
    },
    {
      "nome": "NOVO OFICINA",
      "tipo_produto": "SUTIÃ",
      "pior_dias": 25,
      "media_dias": 10.1,
      "total_ops": 38,
      "pior_op": {
        "nr_op": 54322,
        "dias": 25
      }
    }
  ]
}
```

---

## Próximos passos

1. [ ] Validar queries SQL no banco de dados
2. [ ] Confirmar relacionamento entre tabelas
3. [ ] Criar serviço backend
4. [ ] Criar rotas API
5. [ ] Criar página frontend com cards e tabelas
6. [ ] Adicionar ao menu de navegação

---

## Observações

- Oficinas são grupos de costura externos (terceirizados)
- LIEBE é a marca principal da empresa
- O campo `cd_categoria <> 15` exclui categorias especiais
- Considerar apenas OPs encerradas para cálculo de dias
