# API de Estoque Mínimo - Sistema Completo

Sistema de cálculo de estoque mínimo baseado em análise de vendas históricas, com cálculo automático de médias a partir dos dados da view `vr_vendas_qtd`.

## 📋 Visão Geral

Este sistema calcula o **estoque mínimo** de produtos com base em 3 regras de negócio aplicadas sobre médias de vendas calculadas dinamicamente a partir de **828.613 registros reais** de vendas.

### Estrutura da View

- `idempresa`: ID da empresa
- `data`: Data da venda
- `idproduto`: ID do produto
- `qt_liquida`: Quantidade vendida

## 🎯 Regras de Negócio

### Regra 1 - Variação Acentuada (≥49% ou ≤-50%)
```
Estoque Mínimo = Média dos Últimos 3 Meses
```

### Regra 2 - Sem Histórico Semestral
```
Estoque Mínimo = Média dos Últimos 3 Meses
```

### Regra 3 - Cenário Estável
```
Estoque Mínimo = (Média 6 Meses + Média 3 Meses) / 2
```

## 🚀 Como Usar

### 1. Instalar
```bash
npm install
```

### 2. Configurar `.env`
```env
DB_HOST=dbexp.vcenter.com.br
DB_PORT=20168
DB_NAME=liebe
DB_USER=liebe_ro
DB_PASSWORD=%eTS$33qPO8XZNMc
API_PORT=8000
```

### 3. Executar
```bash
npm start        # Produção
npm run dev      # Desenvolvimento
```

### 4. Testar
```bash
node scripts/verificar-estrutura.js      # Ver estrutura do banco
node scripts/testar-estoque-minimo.js    # Testar cálculos
```

## 📡 Endpoints Principais

### Consultar Produtos com Estoque Mínimo
```bash
GET /api/vendas/produtos/com-estoque-minimo?limit=10
```

### Consultar Produto Específico
```bash
GET /api/vendas/produtos/4130/estoque-minimo
```

### Estatísticas Detalhadas
```bash
GET /api/vendas/produtos/4130/estatisticas
```

### Cálculo Manual
```bash
POST /api/estoque-minimo/calcular
Body: {"mediaSemestral": 100, "mediaTrimestral": 150}
```

## 📊 Exemplo de Resultado Real

```json
{
  "idproduto": "4130",
  "media_semestral": 19.88,
  "media_trimestral": 15.92,
  "estoque_minimo": 17.90,
  "variacao_percentual": -19.93,
  "regra_aplicada": 3,
  "descricao_regra": "Cenário estável (-19.93%) - média entre semestral e trimestral"
}
```

## 📁 Estrutura

```
src/
├── index.js                 # Servidor principal
├── services/
│   ├── estoqueMinimo.js     # Lógica de cálculo
│   └── vendasService.js     # Queries SQL
└── routes/
    ├── estoque.js           # Rotas de cálculo
    └── vendas.js            # Rotas de consulta

scripts/
├── verificar-estrutura.js   # Ver estrutura do banco
└── testar-estoque-minimo.js # Testes completos
```

## ✅ Sistema Testado

- ✅ Conectado ao banco real Liebe
- ✅ Testado com 828.613 registros de vendas
- ✅ 3 regras de negócio implementadas
- ✅ Cálculo automático de médias
- ✅ Endpoints funcionais
- ✅ Módulo de planejamento de produção integrado

## 🏭 Módulo de Planejamento de Produção

Sistema completo que integra:
- Estoque atual da fábrica
- Produtos em processo de produção
- Pedidos pendentes
- Histórico de vendas
- Estoque mínimo calculado

### Exemplo de Uso

```bash
# Ver planejamento de um produto
curl "http://localhost:8000/api/producao/planejamento/4130"

# Listar produtos que precisam produzir
curl "http://localhost:8000/api/producao/planejamento?apenas_necessidade=true&ordenar_por=prioridade"
```

Veja [PLANEJAMENTO_PRODUCAO.md](PLANEJAMENTO_PRODUCAO.md) para documentação completa do módulo de produção.

Veja [API_ESTOQUE_MINIMO.md](API_ESTOQUE_MINIMO.md) para documentação detalhada do cálculo de estoque mínimo.
