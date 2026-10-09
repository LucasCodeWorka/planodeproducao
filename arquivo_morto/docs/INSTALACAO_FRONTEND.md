# 🚀 Guia de Instalação - Frontend Next.js

Guia passo a passo para instalar e executar o frontend do sistema de planejamento de produção.

---

## 📋 Pré-requisitos

- Node.js 18 ou superior
- npm ou yarn
- Backend rodando na porta 8000

---

## ⚙️ Instalação

### 1. Navegar para a pasta do frontend

```bash
cd frontend
```

### 2. Instalar dependências

```bash
npm install
```

Isso instalará:
- Next.js 14
- React 18
- TypeScript
- Tailwind CSS
- Todas as dependências necessárias

### 3. Verificar configuração

O arquivo `.env.local` já está configurado:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Se o backend estiver em outro endereço, edite este arquivo.

---

## 🚀 Executar

### Modo Desenvolvimento

```bash
npm run dev
```

A aplicação estará disponível em: **http://localhost:3000**

### Modo Produção

```bash
# Build
npm run build

# Start
npm start
```

---

## ✅ Verificar Instalação

### 1. Backend deve estar rodando

```bash
# Na pasta raiz do projeto (não no frontend)
npm start
```

Verifique se a API está respondendo:

```bash
curl http://localhost:8000/health
```

Deve retornar:
```json
{
  "ok": true,
  "database": "connected"
}
```

### 2. Frontend deve carregar

Acesse: **http://localhost:3000**

Você deve ver:
- Header "Planejamento de Produção"
- Filtros e opções de ordenação
- Cards com estatísticas
- Tabela com dados de produtos

---

## 🎯 Funcionalidades Disponíveis

### Dashboard

- ✅ Visualização de todos os produtos
- ✅ Filtro para produtos que precisam produzir
- ✅ Ordenação por prioridade, necessidade ou código
- ✅ Estatísticas em tempo real:
  - Total de produtos
  - Produtos com necessidade de produção
  - Produtos com prioridade alta

### Tabela Interativa

Colunas exibidas:
1. **Produto** - Nome, ID e referência
2. **Cor/Tamanho** - Variações do produto
3. **Estoque Atual** - Quantidade em estoque
4. **Em Processo** - Sendo produzido
5. **Estoque Mínimo** - Calculado pelas regras
6. **Pedidos Pendentes** - Demanda de clientes
7. **Produzir** - Quantidade necessária
8. **Situação** - OK ou PRODUZIR
9. **Prioridade** - ALTA, MEDIA ou BAIXA

### Indicadores Visuais

- 🔴 **Prioridade ALTA** - Linha com fundo vermelho claro
- 🟡 **Prioridade MEDIA** - Badge amarelo
- 🟢 **Prioridade BAIXA** - Badge verde
- ⚠️ **PRODUZIR** - Badge laranja
- ✅ **ESTOQUE OK** - Badge verde

---

## 🔧 Troubleshooting

### Erro: "Failed to fetch"

**Problema:** Frontend não consegue se conectar ao backend

**Soluções:**

1. Verifique se o backend está rodando:
   ```bash
   curl http://localhost:8000/health
   ```

2. Verifique o arquivo `.env.local`:
   ```env
   NEXT_PUBLIC_API_URL=http://localhost:8000
   ```

3. Reinicie o frontend:
   ```bash
   # Pare o servidor (Ctrl+C)
   npm run dev
   ```

### Erro: "Cannot find module"

**Problema:** Dependências não instaladas

**Solução:**
```bash
rm -rf node_modules
npm install
```

### Porta 3000 já está em uso

**Problema:** Outra aplicação usando a porta 3000

**Solução:** Use outra porta:
```bash
PORT=3001 npm run dev
```

Acesse: `http://localhost:3001`

### Tabela vazia ou sem dados

**Problemas possíveis:**

1. **Backend sem dados:**
   - Verifique se há produtos no banco
   - Teste: `curl http://localhost:8000/api/producao/planejamento?limit=5`

2. **Filtro muito restritivo:**
   - Desmarque "Apenas produtos com necessidade"
   - A maioria dos produtos pode ter estoque OK

3. **Erro de CORS:**
   - Verifique se instalou o pacote cors no backend:
     ```bash
     # Na pasta raiz (não no frontend)
     npm install cors
     ```

---

## 📊 Testando com Dados Reais

### 1. Verificar produtos disponíveis

```bash
curl "http://localhost:8000/api/producao/planejamento?limit=10"
```

### 2. Filtrar apenas produtos que precisam produzir

```bash
curl "http://localhost:8000/api/producao/planejamento?apenas_necessidade=true&limit=10"
```

### 3. Ver um produto específico

```bash
curl "http://localhost:8000/api/producao/planejamento/4130"
```

---

## 🎨 Personalização

### Alterar porta do backend

Edite `.env.local`:
```env
NEXT_PUBLIC_API_URL=http://seu-servidor:8000
```

Reinicie o frontend.

### Alterar limite de produtos

Edite `app/page.tsx`, linha 27:
```typescript
limit: '50',  // Altere para o número desejado
```

### Alterar cores/estilos

Os estilos estão em Tailwind CSS. Edite:
- `app/page.tsx` - Página principal
- `app/components/PlanejamentoTable.tsx` - Tabela

---

## 📱 Tela

### Desktop
- Layout completo com todas as colunas
- Estatísticas em linha

### Tablet/Mobile
- Tabela com scroll horizontal
- Estatísticas empilhadas
- Filtros responsivos

---

## 🚦 Checklist de Instalação

- [ ] Node.js 18+ instalado
- [ ] Navegou para pasta `frontend`
- [ ] Executou `npm install`
- [ ] Backend rodando em `localhost:8000`
- [ ] Executou `npm run dev`
- [ ] Acessou `http://localhost:3000`
- [ ] Viu a tabela com dados
- [ ] Testou filtros e ordenação

---

## 📚 Próximos Passos

Após a instalação bem-sucedida:

1. **Explorar os dados**
   - Use os filtros
   - Ordene por diferentes critérios
   - Identifique produtos críticos

2. **Entender as prioridades**
   - 🔴 ALTA: Produzir urgente
   - 🟡 MEDIA: Produzir em breve
   - 🟢 BAIXA: Sem necessidade

3. **Planejar produção**
   - Foque nos produtos com prioridade ALTA
   - Considere os pedidos pendentes
   - Verifique produtos em processo

---

## 💡 Dicas

- Use `Ctrl+F` no navegador para buscar produtos específicos
- Filtre por "necessidade" para focar no que é urgente
- Ordene por "prioridade" para ver os produtos críticos primeiro
- Recarregue a página (F5) para atualizar os dados

---

**Frontend instalado e pronto para uso!** 🎉

Se tiver problemas, consulte a seção de Troubleshooting ou verifique os logs do console do navegador (F12).
