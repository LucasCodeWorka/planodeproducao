# API de Estoque Mínimo

Sistema de cálculo de estoque mínimo baseado em análise de vendas históricas.

## Regras de Cálculo

O estoque mínimo é calculado com base em 3 regras:

### Regra 1 - Crescimento ou Queda Acentuada
**Condição:** Variação ≥ 49% ou ≤ -50%

**Fórmula:** `Estoque Mínimo = Média dos Últimos 3 Meses`

**Justificativa:** Variações acentuadas indicam mudança recente e relevante, tornando a média trimestral mais representativa.

### Regra 2 - Ausência de Histórico Semestral
**Condição:** Média semestral indisponível ou em branco

**Fórmula:** `Estoque Mínimo = Média dos Últimos 3 Meses`

**Justificativa:** Na ausência de histórico consolidado, o comportamento mais recente é a base do cálculo.

### Regra 3 - Cenário Estável
**Condição:** Nenhuma das condições anteriores

**Fórmula:** `Estoque Mínimo = (Média Semestral + Média Trimestral) / 2`

**Justificativa:** Equilibra estabilidade histórica com tendência recente.

---

## Endpoints da API

### 1. Health Check

**GET** `/health`

Verifica o status da API e conexão com o banco de dados.

**Resposta:**
```json
{
  "ok": true,
  "database": "connected",
  "timestamp": "2024-01-01T10:00:00.000Z"
}
```

---

### 2. Calcular Estoque Mínimo (Único)

**POST** `/api/estoque-minimo/calcular`

Calcula o estoque mínimo para um único produto.

**Body:**
```json
{
  "mediaSemestral": 100,
  "mediaTrimestral": 150
}
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "estoqueMinimo": 150,
    "mediaSemestral": 100,
    "mediaTrimestral": 150,
    "variacaoPercentual": 50,
    "regraAplicada": 1,
    "descricaoRegra": "Variação acentuada (50.00%) - usando média trimestral"
  }
}
```

**Exemplos de Cenários:**

#### Exemplo 1: Crescimento Acentuado (Regra 1)
```bash
curl -X POST http://localhost:8000/api/estoque-minimo/calcular \
  -H "Content-Type: application/json" \
  -d '{"mediaSemestral": 100, "mediaTrimestral": 150}'
```

Resultado: `estoqueMinimo = 150` (variação de 50%)

#### Exemplo 2: Queda Acentuada (Regra 1)
```bash
curl -X POST http://localhost:8000/api/estoque-minimo/calcular \
  -H "Content-Type: application/json" \
  -d '{"mediaSemestral": 100, "mediaTrimestral": 45}'
```

Resultado: `estoqueMinimo = 45` (variação de -55%)

#### Exemplo 3: Sem Histórico Semestral (Regra 2)
```bash
curl -X POST http://localhost:8000/api/estoque-minimo/calcular \
  -H "Content-Type: application/json" \
  -d '{"mediaTrimestral": 80}'
```

Resultado: `estoqueMinimo = 80`

#### Exemplo 4: Cenário Estável (Regra 3)
```bash
curl -X POST http://localhost:8000/api/estoque-minimo/calcular \
  -H "Content-Type: application/json" \
  -d '{"mediaSemestral": 100, "mediaTrimestral": 110}'
```

Resultado: `estoqueMinimo = 105` (média entre 100 e 110)

---

### 3. Calcular Estoque Mínimo em Lote

**POST** `/api/estoque-minimo/calcular-lote`

Calcula o estoque mínimo para múltiplos produtos de uma só vez.

**Body:**
```json
{
  "produtos": [
    {
      "id": "PROD001",
      "nome": "Produto A",
      "mediaSemestral": 100,
      "mediaTrimestral": 150
    },
    {
      "id": "PROD002",
      "nome": "Produto B",
      "mediaSemestral": 200,
      "mediaTrimestral": 180
    }
  ]
}
```

**Resposta:**
```json
{
  "success": true,
  "totalProcessados": 2,
  "data": [
    {
      "id": "PROD001",
      "nome": "Produto A",
      "estoqueMinimo": 150,
      "mediaSemestral": 100,
      "mediaTrimestral": 150,
      "variacaoPercentual": 50,
      "regraAplicada": 1,
      "descricaoRegra": "Variação acentuada (50.00%) - usando média trimestral"
    },
    {
      "id": "PROD002",
      "nome": "Produto B",
      "estoqueMinimo": 190,
      "mediaSemestral": 200,
      "mediaTrimestral": 180,
      "variacaoPercentual": -10,
      "regraAplicada": 3,
      "descricaoRegra": "Cenário estável (-10.00%) - média entre semestral e trimestral"
    }
  ]
}
```

---

### 4. Consultar Vendas

**GET** `/api/vendas`

Retorna dados brutos de vendas da view `vr_vendas_qtd`.

**Query Parameters:**
- `limit` (opcional): Número máximo de registros (padrão: 100, máximo: 1000)
- `offset` (opcional): Deslocamento para paginação (padrão: 0)

**Exemplo:**
```bash
curl http://localhost:8000/api/vendas?limit=10&offset=0
```

**Resposta:**
```json
{
  "success": true,
  "total": 10,
  "limit": 10,
  "offset": 0,
  "data": [...]
}
```

---

### 5. Consultar Vendas com Estoque Mínimo Calculado

**GET** `/api/vendas/com-estoque-minimo`

Retorna dados de vendas com o estoque mínimo já calculado automaticamente.

**Query Parameters:**
- `limit` (opcional): Número máximo de registros (padrão: 100, máximo: 1000)
- `offset` (opcional): Deslocamento para paginação (padrão: 0)
- `produto_id` (opcional): Filtrar por ID do produto

**Exemplo:**
```bash
curl http://localhost:8000/api/vendas/com-estoque-minimo?limit=10
```

**Resposta:**
```json
{
  "success": true,
  "total": 10,
  "limit": 10,
  "offset": 0,
  "data": [
    {
      "produto_id": "PROD001",
      "media_semestral": 100,
      "media_trimestral": 150,
      "estoque_minimo": 150,
      "variacao_percentual": 50,
      "regra_aplicada": 1,
      "descricao_regra": "Variação acentuada (50.00%) - usando média trimestral"
    }
  ]
}
```

---

### 6. Consultar Estoque Mínimo de um Produto

**GET** `/api/vendas/:produtoId/estoque-minimo`

Retorna o estoque mínimo calculado para um produto específico.

**Exemplo:**
```bash
curl http://localhost:8000/api/vendas/PROD001/estoque-minimo
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "produto_id": "PROD001",
    "media_semestral": 100,
    "media_trimestral": 150,
    "estoqueMinimo": 150,
    "variacaoPercentual": 50,
    "regraAplicada": 1,
    "descricaoRegra": "Variação acentuada (50.00%) - usando média trimestral"
  }
}
```

---

## Estrutura do Projeto

```
planoprojeto/
├── src/
│   ├── index.js                    # Servidor principal
│   ├── services/
│   │   └── estoqueMinimo.js        # Lógica de cálculo de estoque mínimo
│   └── routes/
│       ├── estoque.js              # Rotas de cálculo de estoque
│       └── vendas.js               # Rotas de consulta de vendas
├── package.json
└── .env                            # Configurações do ambiente
```

---

## Configuração

### Variáveis de Ambiente (.env)

```env
DB_HOST=seu_host
DB_PORT=5432
DB_NAME=seu_banco
DB_USER=seu_usuario
DB_PASSWORD=sua_senha

API_PORT=8000
API_HOST=0.0.0.0
```

### Instalação

```bash
npm install
```

### Executar

```bash
# Modo produção
npm start

# Modo desenvolvimento (com auto-reload)
npm run dev
```

---

## Observações Importantes

1. **Ajuste de Colunas:** As rotas de vendas assumem que a view `vr_vendas_qtd` possui as colunas `media_semestral` e `media_trimestral`. Ajuste os nomes das colunas no arquivo [vendas.js](src/routes/vendas.js) conforme a estrutura real da sua view.

2. **Performance:** Para grandes volumes de dados, considere adicionar índices na view ou criar uma tabela materializada.

3. **Validações:** A API valida que as médias sejam números positivos.

4. **Compatibilidade:** A rota legada `/api/vr-vendas-qtd` foi mantida para compatibilidade com sistemas existentes.

---

## Testando a API

### Teste Completo de Regras

```bash
# Regra 1: Variação acentuada positiva
curl -X POST http://localhost:8000/api/estoque-minimo/calcular \
  -H "Content-Type: application/json" \
  -d '{"mediaSemestral": 100, "mediaTrimestral": 160}'

# Regra 1: Variação acentuada negativa
curl -X POST http://localhost:8000/api/estoque-minimo/calcular \
  -H "Content-Type: application/json" \
  -d '{"mediaSemestral": 100, "mediaTrimestral": 40}'

# Regra 2: Sem histórico semestral
curl -X POST http://localhost:8000/api/estoque-minimo/calcular \
  -H "Content-Type: application/json" \
  -d '{"mediaTrimestral": 75}'

# Regra 3: Cenário estável
curl -X POST http://localhost:8000/api/estoque-minimo/calcular \
  -H "Content-Type: application/json" \
  -d '{"mediaSemestral": 100, "mediaTrimestral": 120}'
```
