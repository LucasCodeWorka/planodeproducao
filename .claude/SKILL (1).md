---
name: liebe-design-system
description: Padrão visual dos sistemas internos da LIEBE (Cairo Benevides). Use ao criar ou alterar qualquer tela, página, tabela, card, gráfico, sidebar ou dashboard em frontends de PCP, R1, REPOSICAO_LOJAS, SisCob, SIREP, FOLHA, LancHR, Formulario etc. Define cores neutras com rosa da marca, tamanhos de fonte e contraste, sidebar com zoom/fonte, tabelas padronizadas (ordenação, rolagem dupla, totalizadores), cards KPI e regras de gráficos.
---

# Design System LIEBE

Origem: consolidado de `PCP/design-system-base.md`, `R1/PCP` (cards), `REPOSICAO_LOJAS` (sidebar, tabelas, tokens) e `LancHR`.
Stacks encontradas: Next.js + Tailwind (R1, PCP, REPOSICAO_LOJAS), React/Vite (SisCob, SIREP) e Recharts nos gráficos.

## Princípios
1. **Neutro primeiro**: fundo `#F5F5F5`, cards brancos, bordas cinza claro. O rosa é acento, nunca fundo grande.
2. **Legibilidade acima de tudo**: todo texto e dado sempre em preto (`--text`), inclusive rodapé e nota. Cinza não é cor de texto. Mínimo de contraste 4.5:1 (7:1 para texto de dados).
3. **Leitura rápida**: o número importante é o maior elemento do card; cor só comunica status.
4. **Consistência**: mesmos tokens, mesmos componentes em todos os sistemas. Não inventar cor nova.

## Tokens (CSS variables; em Tailwind usar `brand-*`)
```css
:root {
  --bg: #f5f5f5;          --panel: #ffffff;
  --line: #e5e7eb;        --line-strong: #d1d5db;
  --text: #1d1d1d;        /* todo dado e texto: tabela, label, unidade, cabeçalho, rodapé */
  --brand-primary: #b3838c;   /* botões, item ativo, bordas de destaque */
  --brand-secondary: #c5949d; /* hover */
  --brand-text: #8e5e68;      /* rosa para TEXTO/ícone sobre branco (>=5:1) */
  --brand-soft: #f5ecef;      /* fundo de seleção/linha ativa */
  --brand-dark: #585858;      /* sidebar */
  --green: #15803d; --amber: #b45309; --red: #b91c1c; --blue: #1d4ed8; /* texto semântico */
  --green-bg: #f0fdf4; --amber-bg: #fffbeb; --red-bg: #fef2f2; --blue-bg: #eff6ff;
  --shadow: 0 1px 2px rgba(0,0,0,.05);
  --shadow-lg: 0 4px 6px -1px rgba(0,0,0,.1), 0 2px 4px -1px rgba(0,0,0,.06);
}
```
Tailwind: `brand-primary #B3838C`, `brand-secondary #C5949D`, `brand-dark #585858`, `brand-black #1D1D1D`.

### Proibido
- Cinza em texto: qualquer `text-gray-*`, `#9ca3af`, `#cbd5e1`, `--text-secondary` ou `--muted` em valores, unidades, labels, percentuais, cabeçalhos, rodapés e notas (hoje aparece em vários cards como "de atingimento" e em colunas de %). Usar sempre `--text`, sem exceção.
- Rosa `#B3838C` como cor de texto pequeno sobre branco (contraste ~3:1). Usar `--brand-text`.
- Texto branco sobre rosa claro. Branco só sobre `--brand-primary` em botão com fonte >= 14px semibold.
- Fundos coloridos saturados em células. Usar os `*-bg` pastel + texto escuro da mesma família.

## Tipografia
Inter (`font-sans`); Lato só em material institucional.

| Uso | Tamanho | Peso |
|---|---|---|
| Título da página | 24-28px | 700 |
| Título de card/seção | 16-18px | 600-700 |
| Corpo, inputs, botões | 14px (base do body) | 400-500 |
| **Dados de tabela** | **14px mínimo** | 400-500 |
| Cabeçalho de tabela | 14px mínimo, MAIÚSCULO, letter-spacing .04em | 700 (o negrito diferencia dos dados) |
| Label de KPI | 14px | 600 |
| Número de KPI | 28-32px | 700 |
| Nota/rodapé | 12px (nunca < 11px) | 400 |

- Números sempre com `font-variant-numeric: tabular-nums` e alinhados à direita.
- Formato pt-BR: `toLocaleString("pt-BR")`; moeda `R$`; percentual com 1 casa.
- Todo texto em `--text` (preto), nunca cinza, inclusive rodapé e nota.

## Layout e sidebar
- Sidebar `--brand-dark`, 256px expandida / 80px recolhida, transição 300ms; item ativo `--brand-primary` + texto branco; inativo branco `#ffffff` (nunca cinza).
- **Painel de Acessibilidade no rodapé da sidebar** (obrigatório), com botões − / % / + para **Fonte** (0.90-1.25, passo .05) e **Zoom** (0.90-1.15, passo .05), persistidos em `localStorage` e aplicados em `documentElement.style.fontSize` e `body.style.zoom`. Implementação de referência: `REPOSICAO_LOJAS/frontend/components/layout/Sidebar.tsx` (linhas ~53-76 e ~170-195). Copiar, trocando o prefixo da chave do localStorage por `<app>_font_scale` / `<app>_zoom_scale`.
- Conteúdo: container com `max-width` fluido, padding 16-24px, gap 16px entre blocos.
- Header de página: título + subtítulo + filtros alinhados à direita; filtros quebram linha no mobile.

## Tabelas (padrão obrigatório)
Ver detalhes e código em [references/tabelas.md](references/tabelas.md). Resumo:
1. Container branco, borda `--line`, raio 8px, `overflow-x:auto`; cabeçalho `sticky top`.
2. **Ordenação em todo cabeçalho de coluna** (clique alterna asc → desc → nenhuma), com indicador ⇅ / ▲ / ▼ e `aria-sort`. Texto ordena com `localeCompare("pt-BR")`, números como número, nulos sempre no fim.
3. **Barra de rolagem acima e abaixo** da tabela, sincronizadas (componente `DualScroll`).
4. **Totalizadores** em `<tfoot>` (fundo `--card-gray`, borda superior 2px, negrito), somando o conjunto **filtrado** (não só a página visível). Percentuais/médias no total devem ser recalculados (soma/soma), nunca média de médias.
5. **Colunas padronizadas**: texto à esquerda, números/moeda/% à direita, status centralizado como badge; largura mínima por coluna; coluna principal (ex.: Referência) com `flex`/truncate + `title`.
6. **Responsividade**: tabela mantém `min-width` e rola na horizontal; primeira coluna `sticky left`; em < 640px filtros empilham e KPIs vão para 1-2 colunas.
7. Linhas: hover `--brand-soft`, zebra opcional bem sutil, linha clicável com cursor pointer.
8. Estado vazio sempre com mensagem ("Nenhum registro para o filtro").

## Cards KPI
Referência: `R1/PCP/frontend/app/components/ResponsaveisCards.tsx` e `PCP/frontend/src/components/KPICard.tsx`. Ver [references/cards-e-graficos.md](references/cards-e-graficos.md).
- Grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4`.
- Card: `bg-white border border-gray-200 rounded-lg px-5 py-4`, hover `border-brand-primary`, selecionado `ring-1 ring-brand-primary`.
- Estrutura: label (14px, `--text`) → número grande (28-32px bold) → barra de progresso fina (6px) ou delta → rodapé 12px.
- Cor do número só por status (verde/âmbar/vermelho escuros). Sem status: `--text`.
- Delta: seta + valor, verde se bom, vermelho se ruim, `--text` se neutro. "Bom/ruim" depende da métrica (queda de inadimplência é bom).
- Cards clicáveis servem de filtro da tabela (aria-pressed).

## Gráficos
Ver regras completas em [references/cards-e-graficos.md](references/cards-e-graficos.md). Resumo:
- Biblioteca: **Recharts** (já usada). Cores via tokens, nunca default da lib.
- Escolha pela pergunta: comparar → barras (horizontais se rótulo longo, ordenadas); tendência → linha; composição simples (≤4 partes) → barra empilhada 100% ou donut; meta vs realizado → barra com marcador/bullet; muito detalhe → tabela com sparkline.
- **Evitar**: pizza com > 4 fatias, 3D, eixo duplo, gradientes, legenda distante (rotular direto).
- Paleta: uma cor de destaque (rosa) + cinzas/azul-acinzentado neutros; verde/vermelho só para status.

## Filtros lembrados (obrigatório em toda tela com filtros)
Quando a pessoa volta à tela, os filtros e a ordenação da última visita já estão aplicados. Código em [references/persistencia.md](references/persistencia.md).
- Salvar em **cookie** por tela: `<app>_filtros_<tela>` (JSON pequeno, < 3 KB), validade 180 dias, `Path=/; SameSite=Lax` (e `Secure` em HTTPS).
- Salvar: filtros, ordenação (campo + direção), empresa/loja/período selecionados, colunas visíveis e tamanho de página. Não salvar: busca digitada de texto livre sensível, dados de clientes, senhas, tokens.
- Ler na abertura da tela, **validar contra as opções atuais** (valor que não existe mais é descartado) e já buscar os dados.
- Parâmetros da URL (link vindo do dashboard, ex.: `?faixa=...`) **vencem** o cookie.
- Botão **"Limpar filtros"** visível: volta ao padrão e apaga o cookie. Indicar na tela quando há filtro salvo ativo ("Filtros salvos aplicados").
- Falha ao ler/gravar cookie nunca pode quebrar a tela (try/catch, seguir com o padrão).
- Fonte/zoom da sidebar seguem o mesmo princípio (já ficam salvos).

## Tela de login
- Campo **e-mail/usuário**, campo **senha** com botão mostrar/ocultar, checkbox **"Lembrar meu acesso"**, mensagem de erro clara e botão com estado de carregando. Texto e inputs >= 14px, contraste normal da skill.
- **Lembrar acesso marcado**: sessão persistente (30 dias) e o e-mail/usuário pré-preenchido na próxima visita. **Desmarcado**: sessão só da aba/navegador aberto (`sessionStorage`).
- **Nunca guardar a senha** (nem em cookie, localStorage ou base64). Guardar só o token/sessão. O ideal é o backend emitir cookie `HttpOnly; Secure; SameSite=Lax` com expiração; se o sistema ainda guarda o usuário no `localStorage`, registrar a data de expiração e conferir ao abrir.
- Expirou ou o servidor respondeu 401: limpar a sessão e voltar ao login mantendo a página de destino (`?next=`).
- Sair (logout) apaga a sessão mas **mantém** os filtros e preferências visuais.
- Marcar como `autocomplete="username"` e `autocomplete="current-password"` para o gerenciador de senhas do navegador funcionar.

## Checklist antes de entregar
- [ ] Nenhum texto com contraste < 4.5:1; nenhum cinza em texto, inclusive rodapé
- [ ] Fonte de tabela (dados e cabeçalho) >= 14px, cabeçalho em negrito; números tabulares e à direita
- [ ] Sidebar com Fonte/Zoom persistidos
- [ ] Toda coluna ordenável, rolagem dupla, `tfoot` com totais do filtrado
- [ ] Funciona em 360px, 768px e 1440px sem rolagem horizontal da página (só da tabela)
- [ ] Filtros e ordenação salvos em cookie e restaurados ao abrir (com "Limpar filtros")
- [ ] Login com "Lembrar meu acesso", sem guardar senha, com expiração
- [ ] Rosa usado só como acento (botão, item ativo, destaque de gráfico)
- [ ] Estados: carregando, vazio, erro
- [ ] Tokens reutilizados em vez de hex solto
