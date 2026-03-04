# Frontend - Planejamento de Produção

Interface web moderna em Next.js para visualizar o planejamento de produção.

## 🚀 Início Rápido

### 1. Instalar Dependências

```bash
cd frontend
npm install
```

### 2. Configurar API

O arquivo `.env.local` já está configurado para conectar à API local:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 3. Iniciar em Desenvolvimento

```bash
npm run dev
```

Acesse: `http://localhost:3000`

### 4. Build para Produção

```bash
npm run build
npm start
```

---

## 📊 Funcionalidades

### Dashboard Principal

- ✅ Tabela interativa com todos os produtos
- ✅ Estatísticas em tempo real
- ✅ Filtros e ordenação
- ✅ Indicadores visuais de prioridade

### Filtros Disponíveis

1. **Apenas produtos com necessidade** - Mostra apenas produtos que precisam produzir
2. **Ordenação**:
   - Por prioridade (ALTA → MEDIA → BAIXA)
   - Por necessidade de produção (maior → menor)
   - Por código do produto

### Colunas da Tabela

| Coluna | Descrição |
|--------|-----------|
| **Produto** | Nome e ID do produto |
| **Cor/Tam** | Cor e tamanho |
| **Estoque Atual** | Quantidade em estoque |
| **Em Processo** | Quantidade sendo produzida |
| **Estoque Mín** | Estoque mínimo calculado |
| **Pedidos Pend.** | Pedidos de clientes pendentes |
| **Produzir** | Quantidade que precisa produzir |
| **Situação** | OK ou PRODUZIR |
| **Prioridade** | ALTA, MEDIA ou BAIXA |

---

## 🎨 Indicadores Visuais

### Prioridades

- 🔴 **ALTA** - Estoque abaixo do mínimo (produto em falta)
- 🟡 **MEDIA** - Necessita produção, mas estoque OK
- 🟢 **BAIXA** - Sem necessidade de produção

### Situações

- ⚠️ **PRODUZIR** - Produto precisa ser produzido
- ✅ **OK** - Estoque adequado

### Destaque de Linhas

- Produtos com **prioridade ALTA** têm fundo vermelho claro

---

## 🔧 Requisitos

- Node.js 18+
- Backend rodando em `http://localhost:8000`

### Iniciar Backend

```bash
# Na pasta raiz do projeto
npm start
```

---

## 📱 Responsivo

A interface é responsiva e funciona em:
- 💻 Desktop
- 📱 Tablet
- 📱 Mobile

---

## 🛠️ Tecnologias

- **Next.js 14** - Framework React
- **TypeScript** - Tipagem estática
- **Tailwind CSS** - Estilização
- **React Hooks** - Gerenciamento de estado

---

## 📊 Exemplo de Dados

```json
{
  "produto": {
    "apresentacao": "SUTIA PUSH UP EM MICROF BASICA TACA B CHOCOLATE 44",
    "idproduto": "4130"
  },
  "estoques": {
    "estoque_atual": 1167,
    "em_processo": 640,
    "estoque_minimo": 17.90
  },
  "demanda": {
    "pedidos_pendentes": 269
  },
  "planejamento": {
    "necessidade_producao": 0,
    "situacao": "ESTOQUE_OK",
    "prioridade": "BAIXA"
  }
}
```

---

## 🔍 Troubleshooting

### Erro de Conexão com API

Se aparecer erro "Failed to fetch":

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
   npm run dev
   ```

### Erro de CORS

O backend precisa permitir requisições do frontend. Verifique se o backend está configurado para aceitar requisições de `http://localhost:3000`.

---

## 📚 Estrutura de Arquivos

```
frontend/
├── app/
│   ├── components/
│   │   └── PlanejamentoTable.tsx   # Tabela de planejamento
│   ├── globals.css                 # Estilos globais
│   ├── layout.tsx                  # Layout principal
│   ├── page.tsx                    # Página principal
│   └── types.ts                    # Tipos TypeScript
├── public/                         # Arquivos públicos
├── .env.local                      # Variáveis de ambiente
├── next.config.js                  # Configuração Next.js
├── package.json                    # Dependências
├── tailwind.config.ts              # Configuração Tailwind
└── tsconfig.json                   # Configuração TypeScript
```

---

## 🎯 Próximos Passos Sugeridos

1. **Detalhes do Produto** - Modal com informações completas
2. **Gráficos** - Visualização de tendências
3. **Exportar Excel** - Download de relatórios
4. **Notificações** - Alertas de produtos críticos
5. **Histórico** - Acompanhamento temporal

---

**Sistema pronto para uso!** 🎉

Desenvolvido para o banco Liebe
