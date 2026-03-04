# 📤 Como Publicar no GitHub

Guia para publicar o projeto no repositório `planodeproducao.git`

---

## ✅ Já Feito

- ✅ Repositório Git inicializado
- ✅ Arquivos adicionados
- ✅ Commit inicial criado
- ✅ .gitignore configurado

---

## 🚀 Publicar no GitHub

### Opção 1: Via Linha de Comando

```bash
# Adicionar o repositório remoto (substitua USERNAME pelo seu usuário GitHub)
git remote add origin https://github.com/USERNAME/planodeproducao.git

# Verificar se foi adicionado
git remote -v

# Fazer push para o GitHub
git push -u origin master

# Ou se preferir usar 'main' como branch principal:
git branch -M main
git push -u origin main
```

---

### Opção 2: Via GitHub Desktop

1. Abra o **GitHub Desktop**
2. Vá em `File` → `Add Local Repository`
3. Selecione a pasta: `C:\Users\ce_lu\OneDrive\Imagens\planoprojeto`
4. Clique em `Publish repository`
5. Escolha o nome: `planodeproducao`
6. Marque `Public` ou `Private`
7. Clique em `Publish Repository`

---

## 🔄 Clonar em Outro PC

No seu outro PC, execute:

```bash
# Clonar o repositório
git clone https://github.com/USERNAME/planodeproducao.git

# Entrar na pasta
cd planodeproducao

# Instalar dependências do backend
npm install

# Instalar dependências do frontend
cd frontend
npm install
cd ..

# Configurar variáveis de ambiente
cp .env.example .env
# Editar o .env com suas credenciais

# Criar .env.local do frontend
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > frontend/.env.local
```

---

## 📋 Estrutura do Repositório

```
planodeproducao/
├── src/                    # Backend (Node.js/Express)
│   ├── index.js
│   ├── routes/
│   └── services/
├── frontend/              # Frontend (Next.js)
│   ├── app/
│   ├── package.json
│   └── tsconfig.json
├── scripts/               # Scripts de teste
├── *.md                   # Documentação
├── package.json           # Backend dependencies
└── .gitignore
```

---

## ⚠️ Arquivos NÃO Incluídos (Privados)

Os seguintes arquivos estão no `.gitignore` e **NÃO** serão publicados:

- `.env` - Credenciais do banco (NUNCA publique!)
- `node_modules/` - Dependências (serão instaladas com npm install)
- `frontend/.next/` - Build do Next.js
- Logs e caches

---

## 🔐 Segurança - IMPORTANTE!

### Antes de publicar, verifique:

```bash
# Ver o que será publicado
git status

# Ver arquivos ignorados
cat .gitignore

# Verificar se .env está ignorado
git check-ignore .env
# Deve retornar: .env
```

### Se .env foi adicionado por engano:

```bash
# Remover .env do Git (mas manter no disco)
git rm --cached .env

# Adicionar ao .gitignore
echo ".env" >> .gitignore

# Fazer novo commit
git add .gitignore
git commit -m "Remove .env do repositório"
```

---

## 📝 Exemplo de .env.example

O arquivo `.env.example` está incluído como modelo:

```env
DB_HOST=seu_host
DB_PORT=5432
DB_NAME=seu_banco
DB_USER=seu_usuario
DB_PASSWORD=sua_senha

API_PORT=8000
API_HOST=0.0.0.0
```

---

## 🔄 Comandos Git Úteis

### Verificar Status
```bash
git status
```

### Adicionar Novas Mudanças
```bash
git add .
git commit -m "Descrição da mudança"
git push
```

### Atualizar do Repositório Remoto
```bash
git pull
```

### Ver Histórico
```bash
git log --oneline
```

### Criar Nova Branch
```bash
git checkout -b feature/nova-funcionalidade
git push -u origin feature/nova-funcionalidade
```

---

## 📦 O Que Está Incluído

### Backend
- ✅ API REST completa
- ✅ Serviços de cálculo de estoque mínimo
- ✅ Integração com PostgreSQL
- ✅ Rotas de produção, vendas e estoque
- ✅ Scripts de teste

### Frontend
- ✅ Next.js 14 com TypeScript
- ✅ Componentes React
- ✅ Tabelas interativas
- ✅ Filtros dinâmicos
- ✅ Tailwind CSS

### Documentação
- ✅ README.md principal
- ✅ Guias de instalação
- ✅ Documentação de APIs
- ✅ Exemplos de uso

---

## 🎯 Próximos Passos Após Publicar

1. **No outro PC:**
   ```bash
   git clone https://github.com/USERNAME/planodeproducao.git
   cd planodeproducao
   npm install
   cd frontend && npm install
   ```

2. **Configurar .env:**
   - Copiar `.env.example` para `.env`
   - Preencher com credenciais do banco

3. **Testar:**
   ```bash
   # Backend
   npm start

   # Frontend (em outro terminal)
   cd frontend
   npm run dev
   ```

---

## 🆘 Solução de Problemas

### Erro: "remote origin already exists"
```bash
git remote remove origin
git remote add origin https://github.com/USERNAME/planodeproducao.git
```

### Erro: "Permission denied"
Configure suas credenciais GitHub:
```bash
git config --global user.name "Seu Nome"
git config --global user.email "seu@email.com"
```

### Erro ao fazer push
Se for a primeira vez:
```bash
git push -u origin master --force
```

---

## ✅ Checklist Final

Antes de publicar:

- [ ] Verificar se `.env` está no `.gitignore`
- [ ] Verificar se `node_modules/` está no `.gitignore`
- [ ] Revisar arquivos com `git status`
- [ ] Testar clone em pasta temporária
- [ ] Verificar se documentação está atualizada
- [ ] Confirmar que não há senhas no código

---

**Pronto para publicar!** 🚀

Execute:
```bash
git remote add origin https://github.com/USERNAME/planodeproducao.git
git push -u origin master
```

Substitua `USERNAME` pelo seu usuário GitHub.
