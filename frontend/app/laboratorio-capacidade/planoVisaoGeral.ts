// PLANO DA VISÃO GERAL 2, MONTADO AQUI — padrão do Laboratório de capacidade.
//
// O PCP pediu (17/11/2026) que o laboratório fale SEMPRE do mesmo plano que o gráfico da
// Visão Geral desenha, com a Liebe Move aplicada, sem depender de link. A regra é a mesma de
// `planoDoMes` (components/CapacidadeVsVenda.tsx) e de `relatorioCapacidade`
// (visao-geral-2/page.tsx), lida das MESMAS rotas:
//
//   lançado  = lote do ERP pelo mês de verdade (/api/producao/plano-por-mes-real,
//              qtdLoteNoFiltro). Lote lançado já tem edição limitada dentro.
//   simulado = matriz + lote de simulação mais recente (/api/analise-capacidade/plano-ano).
//   Move     = tabela do estudo (lib/liebeMove), somada em todo mês do ano dela.
//   EL       = projeção de edição limitada (/api/projecao-edicao-limitada, cenário padrão),
//              somada SÓ onde o plano é simulado — simulação não tem EL.
//
//   plano do mês = simulado > lançado ? simulado + Move + EL : lançado + Move
//
// Conferido em 17/11/2026 contra o gráfico, mês a mês de jan a dez/27: 145.637 · 135.401 ·
// 164.223 · 89.826 · 101.323 · 83.669 · 182.233 · 184.748 · 186.110 · 152.565 · 123.270 ·
// 81.401 — todos batem.
//
// Diferença conhecida: a Visão Geral troca a projeção de EL pela EL LANÇADA por SKU quando o
// mês tem 30+ SKUs lançados. Hoje nenhum mês simulado de 2027 tem; se passar a ter, este
// arquivo precisa da mesma regra.
//
// Também devolve a CARGA EXTRA em minutos por período para a Distribuição sugerida, em DUAS
// partes (18/11/2026):
//   extraParam     = edição limitada projetada — sem SKU e sem grupo, rateada pela fábrica.
//   extraMoveParam = Liebe Move — o mix dela no ERP é ANATOMIC (304 SKUs CA ANATOMIC, 8 SO
//                    ANATOMIC; 60 TERCEIROS não passam pela costura), então vai inteira para
//                    o grupo do anatomic (GRUPO_MOVE), não para a fábrica toda.

import { authHeaders } from '../lib/auth';
import { fetchNoCache } from '../lib/api';
import { pecasMove } from '../lib/liebeMove';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export type MesPlanoVG = {
  mes: string; // 'YYYY-MM'
  periodo: string | null;
  lancado: number;
  simulado: number;
  move: number;
  el: number;
  origem: 'lançado' | 'simulado';
  plano: number;
};

/** Grupo de costura que recebe a Liebe Move, pelo mix dela (anatomic). */
export const GRUPO_MOVE = '09 - LIDERANCA ANATOMIC';

export type PlanoVisaoGeral = {
  ano: number;
  loteId: string | null;
  meses: MesPlanoVG[];
  /** 'YYYY-MM' -> peças, para cruzar com as colunas das tabelas. */
  porMes: Record<string, number>;
  /** Edição limitada em minutos por período, rateada pela fábrica. */
  extraParam: string;
  /** Liebe Move em minutos por período, direcionada ao GRUPO_MOVE. */
  extraMoveParam: string;
  minPecaMove: number;
  minPecaMedido: number;
};

async function json(url: string, timeout = 300000) {
  const r = await fetchNoCache(url, { headers: authHeaders() }, timeout);
  const p = await r.json();
  if (!r.ok || p?.success === false) throw new Error(p?.error || `Falha em ${url}`);
  return p;
}

export async function carregarPlanoVisaoGeral(): Promise<PlanoVisaoGeral> {
  const ano = new Date().getFullYear() + 1;
  const [planoAno, real, el, move, medido] = await Promise.all([
    json(`${API_URL}/api/analise-capacidade/plano-ano?ano=${ano}`),
    json(`${API_URL}/api/producao/plano-por-mes-real`),
    json(`${API_URL}/api/projecao-edicao-limitada?anoDestino=${ano}&detalhe=1&crescimentoFabrica=0`),
    json(`${API_URL}/api/capacidade/min-peca-move`, 120000).catch(() => null),
    json(`${API_URL}/api/capacidade/min-peca-medido`, 120000).catch(() => null),
  ]);

  const realPorMes: Record<string, { qtdLote?: number; qtdLoteNoFiltro?: number }> = real?.data || {};
  const elPorMes = new Map<number, number>(
    (Array.isArray(el?.porMes) ? el.porMes : []).map((x: { mes: number; quantidade: number }) => [Number(x.mes), Number(x.quantidade || 0)]),
  );
  const minPecaMove = Number(move?.minPeca) > 0 ? Number(move.minPeca) : 0;
  const minPecaMedido = Number(medido?.minPeca) > 0 ? Number(medido.minPeca) : 0;

  const meses: MesPlanoVG[] = (planoAno.meses as { mes: string; periodo: string | null; pecas: number | null }[]).map((m) => {
    const numMes = Number(m.mes.slice(5, 7));
    const r = realPorMes[m.mes];
    const lancado = Number(r?.qtdLoteNoFiltro ?? r?.qtdLote ?? 0);
    const simulado = Number(m.pecas || 0);
    const pecasDaMove = pecasMove(Number(m.mes.slice(0, 4)), numMes);
    const ehSimulado = simulado > 0 && simulado > lancado;
    const elDoMes = ehSimulado ? Number(elPorMes.get(numMes) || 0) : 0;
    const base = ehSimulado ? simulado : lancado;
    return {
      mes: m.mes,
      periodo: m.periodo,
      lancado,
      simulado,
      move: pecasDaMove,
      el: elDoMes,
      origem: ehSimulado ? 'simulado' : 'lançado',
      plano: base > 0 ? base + pecasDaMove + elDoMes : 0,
    };
  });

  // Carga extra em minutos, como a Visão Geral calcula: Move no min/peça dela, EL no
  // min/peça medido da fábrica, só nos meses em que foram somados ao plano.
  const formatar = (f: (m: MesPlanoVG) => number) => meses
    .filter((m) => m.periodo)
    .map((m) => ({ per: m.periodo as string, min: f(m) }))
    .filter((x) => x.min > 0)
    .map((x) => `${x.per}:${Math.round(x.min)}`)
    .join(',');
  const extra = formatar((m) => m.el * minPecaMedido);
  const extraMove = formatar((m) => m.move * (minPecaMove || minPecaMedido));

  return {
    ano,
    loteId: planoAno.loteId || null,
    meses,
    porMes: Object.fromEntries(meses.map((m) => [m.mes, m.plano])),
    extraParam: extra,
    extraMoveParam: extraMove,
    minPecaMove: minPecaMove || minPecaMedido,
    minPecaMedido,
  };
}
