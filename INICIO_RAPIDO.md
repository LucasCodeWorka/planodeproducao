# 🚀 Início Rápido - Sistema Completo

Guia para iniciar o sistema completo (Backend + Frontend) em minutos.

---

## 📋 O Que Você Vai Executar

1. **Backend (API)** - Node.js/Express na porta 8000
2. **Frontend (Interface)** - Next.js na porta 3000

---

## ⚡ Início Super Rápido (2 comandos)

### Opção 1: Usando 2 terminais (Recomendado)

**Terminal 1 - Backend:**
```bash
npm start
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm install  # Apenas na primeira vez
npm run dev
```

**Acesse:** http://localhost:3000

---

### Opção 2: Script Automatizado

Crie um arquivo `start.bat` (Windows) ou `start.sh` (Linux/Mac):

**Windows (`start.bat`):**
```batch
@echo off
start cmd /k "npm start"
timeout /t 3
start cmd /k "cd frontend && npm run dev"
```

**Linux/Mac (`start.sh`):**
```bash
#!/bin/bash
npm start &
cd frontend && npm run dev
```

Execute:
```bash
# Windows
start.bat

# Linux/Mac
chmod +x start.sh
./start.sh
```

---

## 🔧 Instalação (Primeira Vez)

### 1. Backend

```bash
# Já instalado anteriormente
npm install
```

### 2. Frontend

```bash
cd frontend
npm install
```

**Isso instala:**
- Next.js
- React
- TypeScript
- Tailwind CSS

---

## ✅ Verificar se Está Funcionando

### 1. Backend (API)

```bash
curl http://localhost:8000/health
```

**Deve retornar:**
```json
{
  "ok": true,
  "database": "connected"
}
```

### 2. Frontend (Interface)

Acesse: http://localhost:3000

**Deve exibir:**
- ✅ Header "Planejamento de Produção"
- ✅ Filtros e controles
- ✅ 3 cards com estatísticas
- ✅ Tabela com produtos

---

## 📊 Testar com Dados Reais

### 1. Ver Planejamento de um Produto

```bash
curl "http://localhost:8000/api/producao/planejamento/4130"
```

### 2. No Frontend

1. Acesse http://localhost:3000
2. Marque "Apenas produtos com necessidade de produção"
3. Ordene por "Prioridade"
4. Veja produtos que precisam produzir

---

## 🎯 O Que Ver no Frontend

### Cards de Estatísticas

- **Total de Produtos** - Quantidade total exibida
- **Com Necessidade de Produção** - Produtos que precisam produzir
- **Prioridade Alta** - Produtos urgentes (estoque abaixo do mínimo)

### Tabela

Cada linha mostra:
- **Produto** - Nome completo e código
- **Cor/Tamanho** - Variações
- **Estoque Atual** - Quantidade disponível
- **Em Processo** - Sendo produzido
- **Estoque Mínimo** - Calculado automaticamente
- **Pedidos Pendentes** - Demanda de clientes
- **Produzir** - Quanto precisa produzir
- **Situação** - OK ou PRODUZIR
- **Prioridade** - 🔴 ALTA | 🟡 MEDIA | 🟢 BAIXA

### Filtros

- **Checkbox** - Mostrar apenas produtos que precisam produzir
- **Select** - Ordenar por prioridade, necessidade ou código

---

## 🔍 Entendendo os Dados

### Exemplo: Produto 4130

```
Produto: SUTIA PUSH UP EM MICROF BASICA TACA B CHOCOLATE 44
ID: 4130
Referência: 103101

📊 ESTOQUES:
• Estoque Atual: 1,167
• Em Processo: 640
• Estoque Disponível: 1,807 (atual + processo)
• Estoque Mínimo: 18 (calculado pelas regras)

📈 DEMANDA:
• Pedidos Pendentes: 269
• Média Vendas 6m: 19.88/dia
• Média Vendas 3m: 15.92/dia

🎯 DECISÃO:
• Necessidade Total: 287 (mínimo + pedidos)
• Necessidade Produção: 0
• Situação: ESTOQUE_OK ✅
• Prioridade: BAIXA 🟢
```

**Análise:**
- Estoque disponível (1,807) > Necessidade total (287)
- NÃO precisa produzir
- Prioridade BAIXA

---

## 🚨 Produtos que Precisam Produzir

### Exemplo Hipotético

```
Produto: PRODUTO XYZ
Estoque Atual: 5
Em Processo: 0
Estoque Mínimo: 20
Pedidos Pendentes: 10

→ Necessidade Total: 30 (20 + 10)
→ Estoque Disponível: 5 (5 + 0)
→ PRODUZIR: 25 unidades 🔴
→ Prioridade: ALTA (estoque < mínimo)
```

Estes produtos aparecem com:
- Fundo vermelho claro na tabela
- Badge 🔴 ALTA
- Badge ⚠️ PRODUZIR

---

## 🔧 Troubleshooting Rápido

### Frontend não carrega dados

1. **Verifique o backend:**
   ```bash
   curl http://localhost:8000/health
   ```

2. **Se não responder, inicie o backend:**
   ```bash
   npm start
   ```

3. **Recarregue o frontend:**
   - Pressione F5 no navegador

### Erro de CORS

```bash
# Instalar CORS no backend
npm install cors

# Reiniciar backend
npm start
```

### Tabela vazia

1. **Desmarque o filtro** "Apenas produtos com necessidade"
2. A maioria dos produtos pode ter estoque OK

---

## 📁 Estrutura de Pastas

```
planoprojeto/
├── src/                    # Backend
│   ├── index.js           # ← API principal
│   ├── services/          # Lógica de negócio
│   └── routes/            # Rotas da API
│
├── frontend/              # Frontend Next.js
│   ├── app/
│   │   ├── page.tsx      # ← Página principal
│   │   ├── components/   # Componentes React
│   │   └── types.ts      # Tipos TypeScript
│   └── package.json
│
├── scripts/               # Scripts de teste
├── package.json           # Backend deps
└── .env                   # Config backend
```

---

## 🎓 Fluxo de Dados

```
1. Frontend (http://localhost:3000)
   ↓ Faz requisição

2. Backend (http://localhost:8000/api/producao/planejamento)
   ↓ Consulta banco

3. Banco de Dados PostgreSQL (Liebe)
   ↓ Retorna dados

4. Backend processa:
   • Calcula estoque mínimo
   • Verifica produtos em processo
   • Consulta pedidos pendentes
   • Determina necessidade de produção
   ↓

5. Frontend exibe na tabela
```

---

## ⚙️ Portas Usadas

- **3000** - Frontend (Next.js)
- **8000** - Backend (API)
- **20168** - Banco de dados PostgreSQL

---

## 📚 Documentação Completa

- [README.md](README.md) - Visão geral do sistema
- [PLANEJAMENTO_PRODUCAO.md](PLANEJAMENTO_PRODUCAO.md) - API de produção
- [INSTALACAO_FRONTEND.md](INSTALACAO_FRONTEND.md) - Guia frontend
- [GUIA_RAPIDO.md](GUIA_RAPIDO.md) - Guia de estoque mínimo

---

## ✅ Checklist

- [ ] Backend rodando (porta 8000)
- [ ] Frontend instalado (`cd frontend && npm install`)
- [ ] Frontend rodando (porta 3000)
- [ ] Acessou http://localhost:3000
- [ ] Viu dados na tabela
- [ ] Testou filtros
- [ ] Entendeu as prioridades

---

**Sistema completo funcionando!** 🎉

**Próximo passo:** Explore os dados, identifique produtos críticos e planeje a produção! 🏭
