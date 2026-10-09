# 🏭 Módulo de Planejamento de Produção

Sistema completo de planejamento de produção que integra estoque mínimo, vendas, estoque atual, produtos em processo e pedidos pendentes para determinar a necessidade de produção.

---

## 📋 Visão Geral

O módulo de planejamento de produção combina múltiplas fontes de dados para fornecer uma visão completa e recomendações de produção:

### Dados Integrados

1. **Estoque Atual** - Quantidade disponível na fábrica
2. **Produtos em Processo** - Quantidade sendo produzida
3. **Pedidos Pendentes** - Demanda confirmada de clientes
4. **Histórico de Vendas** - Médias de vendas (6 e 3 meses)
5. **Estoque Mínimo** - Calculado com base nas 3 regras de negócio

### Cálculo de Necessidade de Produção

```
Estoque Disponível = Estoque Atual + Em Processo
Necessidade Total = Estoque Mínimo + Pedidos Pendentes
Necessidade Produção = MAX(0, Necessidade Total - Estoque Disponível)
```

### Classificação de Prioridade

- **ALTA**: Estoque atual < Estoque mínimo (produto em falta)
- **MEDIA**: Necessidade de produção > 0, mas estoque OK
- **BAIXA**: Sem necessidade de produção

---

## 📡 Endpoints da API

### 1. Estoque de Fábrica

**GET** `/api/producao/estoque`

Retorna estoque atual de produtos na fábrica.

**Query Parameters:**
- `limit` (opcional): Máximo de registros (padrão: 100, máx: 500)
- `offset` (opcional): Paginação (padrão: 0)
- `cd_produto` (opcional): Filtrar por código do produto
- `cd_empresa` (opcional): Código da empresa (padrão: '1')
- `apenas_com_estoque` (opcional): Retornar apenas produtos com estoque > 0 (true/false)

**Exemplo:**
```bash
curl "http://localhost:8000/api/producao/estoque?apenas_com_estoque=true&limit=10"
```

**Resposta:**
```json
{
  "success": true,
  "total": 10,
  "data": [
    {
      "cd_produto": "4",
      "estoque": 22.0,
      "data": "2026-03-03"
    }
  ]
}
```

---

### 2. Produtos em Processo

**GET** `/api/producao/em-processo`

Retorna produtos atualmente em processo de produção.

**Query Parameters:**
- `limit`, `offset`, `cd_produto`, `cd_empresa`

**Exemplo:**
```bash
curl "http://localhost:8000/api/producao/em-processo?limit=10"
```

**Resposta:**
```json
{
  "success": true,
  "total": 5,
  "data": [
    {
      "cd_produto": "4130",
      "qt_em_processo": 640.0
    }
  ]
}
```

---

### 3. Pedidos Pendentes

**GET** `/api/producao/pedidos-pendentes/:cdProduto`

Retorna quantidade de pedidos pendentes de um produto.

**Query Parameters:**
- `cd_empresa` (opcional): Código da empresa (padrão: 1)

**Exemplo:**
```bash
curl "http://localhost:8000/api/producao/pedidos-pendentes/4130"
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "cd_produto": 4130,
    "cd_empresa": 1,
    "qt_pendente": 269.0
  }
}
```

---

### 4. Catálogo de Produtos

**GET** `/api/producao/catalogo`

Retorna catálogo completo de produtos com informações detalhadas.

**Query Parameters:**
- `limit`, `offset` (paginação)
- `cd_produto`: Filtrar por código do produto
- `idfamilia`: Filtrar por família
- `status`: Filtrar por status
- `continuidade`: Filtrar por continuidade

**Exemplo:**
```bash
curl "http://localhost:8000/api/producao/catalogo?status=CONFORT&limit=10"
```

**Resposta:**
```json
{
  "success": true,
  "total": 10,
  "data": [
    {
      "cd_seqgrupo": "1462",
      "idproduto": "4130",
      "apresentacao": "SUTIA PUSH UP EM MICROF BASICA TACA B CHOCOLATE 44",
      "cor": "CHOCOLATE",
      "tamanho": "44",
      "referencia": "103101",
      "produto": "SUTIA PUSH UP EM MICROF BASICA TACA B",
      "status": "CONFORT",
      "idfamilia": "24",
      "continuidade": "PERMANENTE"
    }
  ]
}
```

---

### 5. Planejamento de Produto Específico

**GET** `/api/producao/planejamento/:cdProduto`

Retorna planejamento completo para um produto específico.

**Query Parameters:**
- `cd_empresa` (opcional): Código da empresa (padrão: 1)

**Exemplo:**
```bash
curl "http://localhost:8000/api/producao/planejamento/4130"
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "produto": {
      "idproduto": "4130",
      "apresentacao": "SUTIA PUSH UP EM MICROF BASICA TACA B CHOCOLATE 44",
      "cor": "CHOCOLATE",
      "tamanho": "44",
      "referencia": "103101",
      "status": "CONFORT",
      "idfamilia": "24",
      "continuidade": "PERMANENTE"
    },
    "estoques": {
      "estoque_atual": 1167,
      "em_processo": 640,
      "estoque_disponivel": 1807,
      "estoque_minimo": 17.90
    },
    "demanda": {
      "pedidos_pendentes": 269,
      "media_vendas_6m": 19.88,
      "media_vendas_3m": 15.92
    },
    "planejamento": {
      "necessidade_total": 286.90,
      "necessidade_producao": 0,
      "situacao": "ESTOQUE_OK",
      "prioridade": "BAIXA"
    },
    "calculo_estoque_minimo": {
      "estoqueMinimo": 17.90,
      "variacaoPercentual": -19.93,
      "regraAplicada": 3,
      "descricaoRegra": "Cenário estável (-19.93%) - média entre semestral e trimestral"
    }
  }
}
```

---

### 6. Planejamento de Múltiplos Produtos

**GET** `/api/producao/planejamento`

Retorna planejamento para múltiplos produtos com opções de filtro e ordenação.

**Query Parameters:**
- `limit` (opcional): Máximo de produtos (padrão: 50, máx: 200)
- `offset` (opcional): Paginação
- `cd_empresa` (opcional): Código da empresa (padrão: 1)
- `apenas_necessidade` (opcional): Retornar apenas produtos que precisam produzir (true/false)
- `ordenar_por` (opcional): prioridade | necessidade | produto (padrão: prioridade)

**Exemplo - Produtos com necessidade de produção ordenados por prioridade:**
```bash
curl "http://localhost:8000/api/producao/planejamento?apenas_necessidade=true&ordenar_por=prioridade&limit=20"
```

**Exemplo - Todos os produtos ordenados por necessidade de produção:**
```bash
curl "http://localhost:8000/api/producao/planejamento?ordenar_por=necessidade&limit=50"
```

**Resposta:**
```json
{
  "success": true,
  "total": 20,
  "filtros": {
    "apenas_necessidade": true,
    "ordenar_por": "prioridade"
  },
  "data": [
    {
      "produto": { ... },
      "estoques": { ... },
      "demanda": { ... },
      "planejamento": {
        "necessidade_producao": 150,
        "situacao": "PRODUZIR",
        "prioridade": "ALTA"
      }
    }
  ]
}
```

---

## 🧪 Testar o Sistema

### Script de Teste Completo

```bash
node scripts/testar-producao.js
```

Este script:
- Testa planejamento de 5 produtos
- Mostra informações detalhadas de cada produto
- Lista produtos que necessitam produção
- Classifica por prioridade

### Exemplo de Saída

```
1. PRODUTO: SUTIA PUSH UP EM MICROF BASICA TACA B CHOCOLATE 44 (ID: 4130)

   📦 PRODUTO:
      • Apresentação: SUTIA PUSH UP EM MICROF BASICA TACA B CHOCOLATE 44
      • Status: CONFORT
      • Família: 24

   📊 ESTOQUES:
      • Estoque Atual: 1167.00
      • Em Processo: 640.00
      • Estoque Disponível: 1807.00
      • Estoque Mínimo: 17.90

   📈 DEMANDA:
      • Pedidos Pendentes: 269.00
      • Média Vendas 6m: 19.88
      • Média Vendas 3m: 15.92

   🎯 PLANEJAMENTO:
      • Necessidade Total: 286.90
      • Necessidade Produção: 0.00
      • Situação: ESTOQUE_OK
      • Prioridade: BAIXA

   💡 DECISÃO:
      ✅ ESTOQUE ADEQUADO - Produção não necessária no momento
```

---

## 🔧 Casos de Uso

### 1. Dashboard de Produção

Obter produtos que precisam ser produzidos ordenados por prioridade:

```bash
curl "http://localhost:8000/api/producao/planejamento?apenas_necessidade=true&ordenar_por=prioridade&limit=100"
```

### 2. Consultar Produto Específico

Análise detalhada de um produto antes de decidir produzir:

```bash
curl "http://localhost:8000/api/producao/planejamento/4130"
```

### 3. Relatório de Estoque

Listar produtos com estoque disponível:

```bash
curl "http://localhost:8000/api/producao/estoque?apenas_com_estoque=true&limit=100"
```

### 4. Produtos em Produção

Ver o que está sendo produzido:

```bash
curl "http://localhost:8000/api/producao/em-processo?limit=50"
```

### 5. Catálogo Filtrado

Listar produtos de uma família específica:

```bash
curl "http://localhost:8000/api/producao/catalogo?idfamilia=24&limit=50"
```

---

## 📊 Exemplo Real - Produto 4130

```json
{
  "produto": {
    "idproduto": "4130",
    "apresentacao": "SUTIA PUSH UP EM MICROF BASICA TACA B CHOCOLATE 44",
    "referencia": "103101",
    "status": "CONFORT",
    "continuidade": "PERMANENTE"
  },
  "estoques": {
    "estoque_atual": 1167,      // ← Estoque físico
    "em_processo": 640,          // ← Em produção
    "estoque_disponivel": 1807,  // ← Total disponível
    "estoque_minimo": 17.90      // ← Calculado pelas 3 regras
  },
  "demanda": {
    "pedidos_pendentes": 269,    // ← Pedidos de clientes
    "media_vendas_6m": 19.88,    // ← Média últimos 6 meses
    "media_vendas_3m": 15.92     // ← Média últimos 3 meses
  },
  "planejamento": {
    "necessidade_total": 286.90,     // ← Estoque mín + Pedidos
    "necessidade_producao": 0,       // ← Quanto produzir
    "situacao": "ESTOQUE_OK",        // ← ESTOQUE_OK | PRODUZIR
    "prioridade": "BAIXA"            // ← ALTA | MEDIA | BAIXA
  }
}
```

**Análise:**
- Estoque disponível (1807) > Necessidade total (286.90)
- **Decisão:** NÃO precisa produzir
- **Prioridade:** BAIXA

---

## 💡 Lógica de Decisão

### Quando PRODUZIR?

```
SE (Estoque Disponível < Necessidade Total)
  ENTÃO situacao = "PRODUZIR"

  SE (Estoque Atual < Estoque Mínimo)
    ENTÃO prioridade = "ALTA"    # Produto em falta!
  SENÃO
    prioridade = "MEDIA"         # Tem estoque, mas insuficiente
FIM
```

### Quando ESTOQUE_OK?

```
SE (Estoque Disponível >= Necessidade Total)
  ENTÃO situacao = "ESTOQUE_OK"
  E prioridade = "BAIXA"
FIM
```

---

## 🎯 Queries SQL Utilizadas

### Estoque de Fábrica
```sql
SELECT
  cd_produto,
  f_dic_sld_prd_produto('1'::TEXT, '1'::TEXT, cd_produto, NULL) AS estoque
FROM vr_prd_prdgrade
WHERE cd_produto < 1000000
```

### Produtos em Processo
```sql
SELECT
  aa.cd_produto,
  SUM(COALESCE(aa.qt_real, 0) - COALESCE(aa.qt_finalizada, 0)) AS qt_em_processo
FROM vr_pcp_opi aa, vr_pcp_opc bb
WHERE aa.cd_empresa = 1
  AND aa.cd_empresa = bb.cd_empresa
  AND aa.nr_ciclo = bb.nr_ciclo
  AND aa.nr_op = bb.nr_op
  AND COALESCE(bb.cd_categoria, 0) <> 15
  AND aa.tp_situacao IN (5, 10, 15, 20)
GROUP BY aa.cd_produto
```

### Pedidos Pendentes
```sql
SELECT COALESCE(SUM(qt_pendente), 0) AS qt_pendente
FROM vr_ped_pedidoi
WHERE cd_produto = ?
  AND cd_operacao <> 44
  AND cd_empresa = 1
  AND tp_situacao <> 6
```

---

## 🚀 Integração com Frontend

### Dashboard de Produção

```javascript
// Buscar produtos que precisam produzir
fetch('/api/producao/planejamento?apenas_necessidade=true&ordenar_por=prioridade&limit=50')
  .then(r => r.json())
  .then(data => {
    data.data.forEach(item => {
      console.log(`${item.produto.apresentacao}`);
      console.log(`  Produzir: ${item.planejamento.necessidade_producao}`);
      console.log(`  Prioridade: ${item.planejamento.prioridade}`);
    });
  });
```

### Indicador de Estoque

```javascript
// Verificar estoque de um produto
fetch('/api/producao/planejamento/4130')
  .then(r => r.json())
  .then(data => {
    const { estoques, planejamento } = data.data;

    if (planejamento.situacao === 'PRODUZIR') {
      alert(`ATENÇÃO: Produzir ${planejamento.necessidade_producao} unidades`);
    }
  });
```

---

## ✅ Benefícios do Sistema

1. **Visão Unificada**: Todos os dados de produção em um só lugar
2. **Decisões Automatizadas**: Sistema calcula automaticamente necessidade de produção
3. **Priorização Inteligente**: Produtos classificados por urgência
4. **Baseado em Dados Reais**: Usa histórico de vendas e estoque atual
5. **Prevenção de Faltas**: Estoque mínimo calculado dinamicamente
6. **API RESTful**: Fácil integração com qualquer frontend

---

## 📚 Documentação Relacionada

- [README.md](README.md) - Documentação principal
- [GUIA_RAPIDO.md](GUIA_RAPIDO.md) - Guia rápido de estoque mínimo
- [API_ESTOQUE_MINIMO.md](API_ESTOQUE_MINIMO.md) - Detalhes do cálculo de estoque mínimo

---

**Sistema testado e funcional com dados reais do banco Liebe!** 🎉
