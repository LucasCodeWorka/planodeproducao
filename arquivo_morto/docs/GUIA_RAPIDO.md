# 🚀 Guia Rápido - API de Estoque Mínimo

## Iniciar a API

```bash
npm start
```

Acesse: `http://localhost:8000`

---

## ✅ Testar se está funcionando

```bash
curl http://localhost:8000/health
```

---

## 📊 Exemplos Práticos

### 1. Listar 5 Produtos com Estoque Mínimo Calculado

```bash
curl "http://localhost:8000/api/vendas/produtos/com-estoque-minimo?limit=5"
```

**Resultado:**
```json
{
  "success": true,
  "total": 5,
  "data": [
    {
      "idproduto": "4130",
      "idempresa": "1",
      "media_trimestral": 15.92,
      "media_semestral": 19.88,
      "estoque_minimo": 17.90,
      "variacao_percentual": -19.93,
      "regra_aplicada": 3,
      "descricao_regra": "Cenário estável (-19.93%) - média entre semestral e trimestral"
    }
  ]
}
```

---

### 2. Consultar Estoque Mínimo do Produto 4130

```bash
curl "http://localhost:8000/api/vendas/produtos/4130/estoque-minimo"
```

---

### 3. Ver Estatísticas Completas do Produto 4130

```bash
curl "http://localhost:8000/api/vendas/produtos/4130/estatisticas"
```

**Resultado:**
```json
{
  "success": true,
  "data": {
    "idproduto": "4130",
    "total_vendas": 346,
    "quantidade_total": 6921,
    "primeira_venda": "2025-01-07T03:00:00.000Z",
    "ultima_venda": "2026-03-03T03:00:00.000Z",
    "ultimos_6_meses": {
      "quantidade_total": 2903,
      "dias_com_vendas": 146,
      "media_por_dia": 19.88
    },
    "ultimos_3_meses": {
      "quantidade_total": 1003,
      "dias_com_vendas": 63,
      "media_por_dia": 15.92
    },
    "estoque_minimo": {
      "valor": 17.90,
      "variacao_percentual": -19.93,
      "regra_aplicada": 3,
      "descricao_regra": "Cenário estável (-19.93%) - média entre semestral e trimestral"
    }
  }
}
```

---

### 4. Calcular Estoque Mínimo Manualmente

```bash
curl -X POST http://localhost:8000/api/estoque-minimo/calcular \
  -H "Content-Type: application/json" \
  -d '{"mediaSemestral": 100, "mediaTrimestral": 150}'
```

**Resultado:**
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

---

### 5. Calcular em Lote (Múltiplos Produtos)

```bash
curl -X POST http://localhost:8000/api/estoque-minimo/calcular-lote \
  -H "Content-Type: application/json" \
  -d '{
    "produtos": [
      {"id": "A", "mediaSemestral": 100, "mediaTrimestral": 160},
      {"id": "B", "mediaSemestral": 200, "mediaTrimestral": 180},
      {"id": "C", "mediaSemestral": 0, "mediaTrimestral": 90}
    ]
  }'
```

---

## 🧪 Executar Testes

### Ver Estrutura do Banco
```bash
node scripts/verificar-estrutura.js
```

### Testar com Dados Reais
```bash
node scripts/testar-estoque-minimo.js
```

**Saída esperada:**
```
=== TESTE DE CÁLCULO DE ESTOQUE MÍNIMO COM DADOS REAIS ===

1. PRODUTO ID: 4130 | EMPRESA: 1
   📊 Histórico:
      • Total de vendas: 346 registros
      • Quantidade total: 6921.00 unidades

   📈 Últimos 6 meses:
      • Média por dia: 19.88

   📈 Últimos 3 meses:
      • Média por dia: 15.92

   🎯 ESTOQUE MÍNIMO:
      • Valor calculado: 17.90 unidades/dia
      • Variação: -19.93%
      • Regra aplicada: 3
```

---

## 🎯 As 3 Regras Explicadas

### Regra 1: Variação Acentuada
- **Quando:** Variação ≥ 49% ou ≤ -50%
- **Usa:** Média dos últimos 3 meses
- **Por quê:** Mudança brusca = usar dado mais recente

**Exemplo:**
- Média 6m: 100 → Média 3m: 160 = +60% → **Estoque: 160**

---

### Regra 2: Sem Histórico
- **Quando:** Sem dados dos últimos 6 meses
- **Usa:** Média dos últimos 3 meses
- **Por quê:** Não há comparação possível

**Exemplo:**
- Média 6m: 0 → Média 3m: 80 → **Estoque: 80**

---

### Regra 3: Estável
- **Quando:** Variação entre -49% e +48%
- **Usa:** Média entre 6m e 3m
- **Por quê:** Equilibra histórico com tendência

**Exemplo:**
- Média 6m: 100 → Média 3m: 110 = +10% → **Estoque: 105**

---

## 📌 Dicas

1. **Filtrar por empresa:**
   ```bash
   curl "http://localhost:8000/api/vendas/produtos/com-estoque-minimo?idempresa=1&limit=10"
   ```

2. **Paginação:**
   ```bash
   # Página 1
   curl "http://localhost:8000/api/vendas/produtos/com-estoque-minimo?limit=10&offset=0"

   # Página 2
   curl "http://localhost:8000/api/vendas/produtos/com-estoque-minimo?limit=10&offset=10"
   ```

3. **Ver logs no console:**
   - A API mostra todos os endpoints disponíveis ao iniciar
   - Use `npm run dev` para auto-reload durante desenvolvimento

---

## 🔍 Endpoints Disponíveis

```
Sistema:
  GET  /health

Vendas:
  GET  /api/vendas
  GET  /api/vendas/produtos
  GET  /api/vendas/produtos/com-estoque-minimo
  GET  /api/vendas/produtos/:idProduto/estoque-minimo
  GET  /api/vendas/produtos/:idProduto/estatisticas

Estoque Minimo:
  POST /api/estoque-minimo/calcular
  POST /api/estoque-minimo/calcular-lote

Legado:
  GET  /api/vr-vendas-qtd
```

---

## 📚 Documentação Completa

- [README.md](README.md) - Documentação principal
- [API_ESTOQUE_MINIMO.md](API_ESTOQUE_MINIMO.md) - API detalhada
- [exemplos-teste.http](exemplos-teste.http) - Exemplos HTTP
- [exemplos-uso.js](exemplos-uso.js) - Exemplos JavaScript

---

## ✅ Checklist de Sucesso

- [ ] API iniciada (`npm start`)
- [ ] Health check OK (`curl http://localhost:8000/health`)
- [ ] Testado com produto real (`curl http://localhost:8000/api/vendas/produtos/4130/estoque-minimo`)
- [ ] Script de teste executado (`node scripts/testar-estoque-minimo.js`)

**Sistema pronto para uso!** 🎉
