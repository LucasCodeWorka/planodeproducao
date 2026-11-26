# Orçamento de MP — levantamento de 25/11/2026

Base medida às 10:08 (Fortaleza): matriz recalculada às 09:33, consumo de MP recalculado, custo TOTVS consultado. Somente leitura; nada foi gravado no ERP. Janela: nov/26 a mar/27 (MA…QU).

## A cadeia, de ponta a ponta

| Etapa | Onde | Estado |
|---|---|---|
| 1. Necessidade por MP (painel) | `/orcamento-mp` → `frontend/app/lib/orcamentoMp.ts` | funciona; conta agora num lugar só (ver abaixo) |
| 2. Cache da tela | `app_orcamento_mp_cache` (rota `/api/producao/orcamento-mp-cache`) | atualizado hoje 09:50, 1.206 MPs |
| 3. Cadastro de MP e vínculo de despesa | `app_mp_cadastro` (sync a cada 5 min), `app_mp_despesa` | roda; **duplicado** (serviço do Windows + `.bat` em loop) |
| 4. Preparo do FCPFM017 | `scripts/preparar-valores-fcpfm017.mjs` | usa a mesma conta da tela desde hoje |
| 5. Conferência e auditoria contra o TOTVS | `scripts/conferir-orcamento-necessidade-atual.mjs` → `scripts/auditar-orcamento-totvs-atual.mjs` | corrigido: não acusa mais divergência falsa de outubro |
| 6. Lançamento no TOTVS (bot) | `.agents/totvs_agent_minimo/scripts/lancar_lote_fcpfm017.py`, FCPFM043, FCPFM003 | último lote em 19/10; o TOTVS bate centavo a centavo com os lotes |
| 7. Exportação para sistema externo | `app_orcamento_mp_exportacao` | **nunca usada** (a tabela nem existe) |
| 8. Fila de despesas para conferência | `app_orcamento_mp_despesas_totvs` | **vazia** |
| 9. Bloqueio de compra acima do orçamento | CMPFM020 | não começou |

## Números de hoje

| | MPs | Necessidade futura (+folga) | Compras em andamento |
|---|---:|---:|---:|
| Despesa no plano 500 / CC 506 | 410 | R$ 662.227 | R$ 577.129 |
| Sem despesa vinculada | 167 | R$ 111.217 | R$ 691.737 |
| Despesa fora do plano 500/506 | 102 | R$ 150.799 | R$ 95.547 |
| **Total** | **679** | **R$ 924.243** | **R$ 1.364.413** |

Contra o TOTVS (FCPFM017, visão 1, plano 500/CC 506), só a necessidade futura, como nos lançamentos anteriores:

| Competência | TOTVS | Necessidade | Falta (linhas) | Excesso (linhas) |
|---|---:|---:|---:|---:|
| nov/26 | R$ 43.497 | R$ 2.520 | R$ 989 | R$ 41.967 |
| dez/26 | R$ 103.106 | R$ 18.613 | R$ 14.413 | R$ 98.907 |
| jan/27 | R$ 325.584 | R$ 90.648 | R$ 40.672 | R$ 275.607 |
| fev/27 | R$ 51.337 | R$ 237.578 | R$ 230.764 | R$ 44.522 |
| mar/27 | R$ 0 | R$ 574.884 | R$ 574.884 | R$ 0 |
| **Total** | **R$ 523.524** | **R$ 924.243** | **R$ 861.722** | **R$ 461.003** |

Lotes lançados pelo bot × TOTVS na janela: R$ 523.523,72 nos dois, zero divergência. O que está no sistema é exatamente o que foi lançado em outubro; a diferença é toda do plano que andou desde então.

Leitura: nov–jan estão com orçamento sobrando (o plano empurrou a necessidade para frente e as compras já em andamento cobrem o início); fev ficou curto e mar/27 nunca foi lançado. As maiores MPs sem despesa são rendas (1011793 RENDA ZG05914, R$ 76.000 com compras; 1011795, 1015524, 1015716 da mesma renda; 1014170 RENDA FM 313).

## O que mudou hoje

- **Uma conta só.** A necessidade por MP existia em três cópias (tela, preparo do agente, `sync_mp_cadastro.py`) e duas já divergiam: o preparo dividia o preço pelo fator de conversão sempre; a tela, só com fator > 1. Hoje nenhuma MP tem fator < 1, então o número não mudou — mas era questão de tempo. A conta está em `frontend/app/lib/orcamentoMp.ts`; a tela e o preparo importam dali (o Node ≥ 23 lê o `.ts` direto). O `sync_mp_cadastro.py` (Python) ainda tem a dele.
- **Paridade medida em dado real** (`npm run test:paridade-orcamento`): as 1.206 MPs do cache da tela, conta nova × conta antiga do preparo — 0 divergências; R$ 925.912,68 de futuro e R$ 1.367.485,06 de comprado nas duas.
- **Login no `/api/producao`.** O roteador não pedia login em nada: pela URL pública do Render qualquer um podia apagar o cache do orçamento, as fotos salvas e a exportação. Agora toda gravação e todo o orçamento de MP pedem o token (a tela já mandava em todas essas chamadas). Leituras do plano seguem abertas.
- **Backend não cai mais por falha de conexão** na exportação e no preparar despesas: o `pool.connect()` estava fora do `try`, e uma falha de banco ali derrubava o processo.
- **Auditoria sem divergência falsa:** os lotes eram comparados com o histórico inteiro (outubro) contra um espelho filtrado pela janela — 22 divergências falsas e saída com erro.

## Testes

- `npm test` (raiz): 14 passando — regras do orçamento (folga, alça, preço, fator, necessidade, rateio por período, paridade com a fórmula antiga), portão de login do `/api/producao`, e os 5 que já existiam da costura.
- `npm run test:paridade-orcamento`: paridade em dado real (lê o banco, só leitura).
- Frontend: `npx tsc --noEmit` limpo.
- Cheese: `pytest tests/` 212 passando.

## O que falta fechar (ordem sugerida)

1. **Proposta de lançamento fev–mar/27 por despesa.** Mar/27 está zerado no TOTVS (R$ 574.884) e fev curto em R$ 230.764. O preparo e a auditoria já dão o valor por despesa e mês; falta virar o lote do FCPFM017 e passar pela sua aprovação linha a linha.
2. **167 MPs sem despesa e 102 fora do plano.** Sem vínculo, a necessidade delas (R$ 262 mil) não tem onde entrar no FCPFM017. Caminho já testado em outubro: FCPFM003 (criar despesa) → FCPFM043 (pôr no plano 500/CC 506). Antes, conferir se já existe despesa equivalente (há o script de similaridade).
3. **Excesso em nov–jan (R$ 416 mil).** Decidir se reduz no TOTVS ou deixa como reserva — é decisão sua/da controladoria, não do bot.
4. **Horizonte além de mar/27.** A tela e o cálculo param em QU; há plano ativo em abr–jun/27 (≈98 mil, 118 mil e 108 mil peças) sem orçamento de MP. O combinado em 06/10 incluía SX (abril). Mexe na análise de consumo (`/api/consumo-mp/analise`), não só na tela.
5. **Exportação e fila de despesas da tela:** nunca usadas. Decidir: ligar no fluxo do bot (a fila vira a "mesa de aprovação" do lançamento) ou tirar da tela.
6. **`sync_mp_cadastro` duplicado:** escolher serviço do Windows *ou* `.bat` — hoje os dois rodam.
7. **Hermes:** a tarefa "ConciliacaoItauDiaria" recupera execuções perdidas e reabre o TOTVS no meio do uso; pausar a recuperação antes de subir o gateway.
8. **CMPFM020** (bloquear compra acima do orçamento): depois que o FCPFM017 estiver fechado.

Arquivos de hoje (fora do git, scratchpad desta sessão): preparo, conferência e auditoria em JSON. O levantamento provisório do agente das 09:08 (`docs/levantamento-orcamento-2026-11-25.md` e os JSON `docs/orcamento-*-2026-11-25.json`) usou a matriz de 24/11 e fica superado por este.
