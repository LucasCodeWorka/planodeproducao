# CLAUDE.md

Convenções deste repositório para quem for trabalhar no código (humano ou agente).

## Stack

- **Frontend**: Next.js (App Router), em `frontend/`, com TypeScript, Tailwind CSS e `recharts` para gráficos.
- **Backend**: Node.js com Express, em `src/`, expondo a API consumida pelo frontend.
- **Banco de dados**: PostgreSQL, acessado via `pg` a partir do backend.
- Há também um módulo de Machine Learning em Python (`ml/`) para projeções e um conjunto de scripts utilitários (`scripts/`) para cargas, sincronizações e diagnósticos pontuais.

## Organização de pastas

```
src/                    # Backend (Express)
├── index.js            # Ponto de entrada do servidor
├── routes/             # Rotas HTTP, uma por domínio/feature
├── services/           # Regras de negócio e acesso a dados
├── cache/              # Camadas de cache em memória
└── migrations/         # Migrações SQL

frontend/               # Frontend (Next.js App Router)
└── app/
    ├── <rota>/page.tsx     # Uma pasta por rota/tela
    ├── components/         # Componentes React compartilhados
    └── lib/                # Funções utilitárias e client de API

ml/                     # Módulo de Machine Learning (Python) para projeções
scripts/                # Scripts utilitários (cargas, checagens, sincronização)
```

Ao adicionar uma nova feature de API, siga o padrão existente: rota em `src/routes/`, regra de negócio em `src/services/`. No frontend, cada tela nova ganha sua própria pasta em `frontend/app/`.

## Padrão de comentários

Os comentários são escritos em português e explicam o **porquê** de uma decisão, não o **o quê** do código (o código já deve ser autoexplicativo quanto a isso). Exemplos reais do projeto:

```js
// Query otimizada: usa subquery com LIMIT para evitar full table scan
// +1 pois getMonth() retorna 0-11
// Otimizado: pré-filtrar produtos em uma CTE para evitar chamadas lentas no WHERE
```

Ao escrever ou revisar código, mantenha esse estilo: evite comentários que apenas descrevem literalmente a linha seguinte, e prefira explicar motivação, trade-off ou uma armadilha evitada.

## Mensagens de commit

- Escritas em português, **sem acentos**.
- Com prefixo indicando o tipo da mudança: `feat:`, `fix:`, `perf:`, `ci:`, `config:`.

Exemplo real do histórico:

```
ci: adiciona workflow do Claude Code para mencoes de @claude
```

## Verificação

- Frontend: rodar `npx tsc --noEmit` dentro de `frontend/` para checar tipos antes de considerar uma mudança pronta.
- Backend: não há suíte de testes automatizada configurada; validar manualmente as rotas afetadas.

## O que não incluir neste repositório

Este repositório é público. Não documentar aqui (nem em outros arquivos versionados) credenciais, portas, variáveis de ambiente ou qualquer detalhe de operação/infraestrutura local. Esse tipo de informação deve ficar fora do versionamento (ex: arquivos `.env` locais, não rastreados) ou no provedor de deploy.
