'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Planejamento, ProjecoesMap, PeriodosPlano, EstoqueLojaDisponivelAggregado } from '../types';
import { projecaoMesDecorrida, projecaoMesPlanejamento } from '../lib/projecao';

const MESES_PT = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function fmt(v: number, dec = 0) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

type Situacao = 'deficit' | 'abaixo' | 'ok';

function situacao(estoque: number, pedidos: number, estoqueMin: number): Situacao {
  const d = estoque - pedidos;
  if (d < 0) return 'deficit';
  if (d < estoqueMin) return 'abaixo';
  return 'ok';
}

// ─── GrupoTotais ──────────────────────────────────────────────────────────────

interface GrupoTotais {
  estoque: number; emProcesso: number; estoqueMin: number;
  pedidos: number; disponivel: number; deficit: number; abaixo: number;
  planoMA: number; planoPX: number; planoUL: number; planoQT: number;
  projMA:  number; projPX:  number; projUL:  number; projQT: number;
  projJan: number; projFev: number; projMarProp: number;
  vendaJan: number; vendaFev: number; vendaMar: number;
  dispFutMar: number; dispFutAbr: number; dispFutMai: number; dispFutJun: number;
  negFutMar: number; negFutAbr: number; negFutMai: number; negFutJun: number;
  projCount: number;
  excedenteLojas: number;
}

type RefGroup  = { referencia: string; nomeRef: string; itens: Planejamento[]; totais: GrupoTotais };
type ContGroup = { continuidade: string; referencias: RefGroup[]; totais: GrupoTotais };

function somar(
  itens: Planejamento[],
  projecoes: ProjecoesMap,
  vendasReais: Record<string, Record<string, number>>,
  periodos: PeriodosPlano,
  excedentesLojas: Map<number, EstoqueLojaDisponivelAggregado> | null = null
): GrupoTotais {
  const mesQT = periodos.QT ?? (((periodos.UL || 1) - 1 + 1) % 12) + 1;
  return itens.reduce((acc, i) => {
    const disp    = (i.estoques.estoque_atual || 0) - (i.demanda.pedidos_pendentes || 0);
    const proj    = projecoes[i.produto.idproduto] ?? null;
    const real    = vendasReais[i.produto.idproduto] ?? null;
    const hasProj = proj !== null;
    const emP = i.estoques.em_processo || 0;
    const pMA = i.plano?.ma || 0;
    const pPX = i.plano?.px || 0;
    const pUL = i.plano?.ul || 0;
    const pQT = i.plano?.qt || 0;
    const prMA = hasProj ? projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA) : 0;
    const prPX = hasProj ? (proj[String(periodos.PX)] ?? 0) : 0;
    const prUL = hasProj ? (proj[String(periodos.UL)] ?? 0) : 0;
    const prQT = hasProj ? (proj[String(mesQT)] ?? 0) : 0;
    const prJan = hasProj ? (proj['1'] ?? 0) : 0;
    const prFev = hasProj ? (proj['2'] ?? 0) : 0;
    const prMarProp = hasProj ? projecaoMesDecorrida((proj['3'] ?? 0), 3) : 0;
    const vdJan = real ? (real['1'] ?? 0) : 0;
    const vdFev = real ? (real['2'] ?? 0) : 0;
    const vdMar = real ? (real['3'] ?? 0) : 0;
    const dMar = hasProj ? disp + emP + pMA - prMA : 0;
    const dAbr = hasProj ? dMar + pPX - prPX : 0;
    const dMai = hasProj ? dAbr + pUL - prUL : 0;
    const dJun = hasProj ? dMai + pQT - prQT : 0;
    const excLoja = excedentesLojas?.get(Number(i.produto.idproduto))?.qtd_disponivel_total || 0;
    return {
      estoque:    acc.estoque    + (i.estoques.estoque_atual || 0),
      emProcesso: acc.emProcesso + emP,
      estoqueMin: acc.estoqueMin + (i.estoques.estoque_minimo || 0),
      pedidos:    acc.pedidos    + (i.demanda.pedidos_pendentes || 0),
      disponivel: acc.disponivel + disp,
      deficit:    acc.deficit    + (disp < 0 ? disp : 0),
      abaixo:     acc.abaixo     + (disp >= 0 && disp < (i.estoques.estoque_minimo || 0) ? 1 : 0),
      planoMA:    acc.planoMA    + pMA,
      planoPX:    acc.planoPX    + pPX,
      planoUL:    acc.planoUL    + pUL,
      planoQT:    acc.planoQT    + pQT,
      projMA:     acc.projMA     + prMA,
      projPX:     acc.projPX     + prPX,
      projUL:     acc.projUL     + prUL,
      projQT:     acc.projQT     + prQT,
      projJan:    acc.projJan    + prJan,
      projFev:    acc.projFev    + prFev,
      projMarProp:acc.projMarProp+ prMarProp,
      vendaJan:   acc.vendaJan   + vdJan,
      vendaFev:   acc.vendaFev   + vdFev,
      vendaMar:   acc.vendaMar   + vdMar,
      dispFutMar: acc.dispFutMar + dMar,
      dispFutAbr: acc.dispFutAbr + dAbr,
      dispFutMai: acc.dispFutMai + dMai,
      dispFutJun: acc.dispFutJun + dJun,
      negFutMar: acc.negFutMar + (dMar < 0 ? Math.abs(dMar) : 0),
      negFutAbr: acc.negFutAbr + (dAbr < 0 ? Math.abs(dAbr) : 0),
      negFutMai: acc.negFutMai + (dMai < 0 ? Math.abs(dMai) : 0),
      negFutJun: acc.negFutJun + (dJun < 0 ? Math.abs(dJun) : 0),
      projCount:  acc.projCount  + (hasProj ? 1 : 0),
      excedenteLojas: acc.excedenteLojas + excLoja,
    };
  }, {
    estoque:0, emProcesso:0, estoqueMin:0, pedidos:0, disponivel:0, deficit:0, abaixo:0,
    planoMA:0, planoPX:0, planoUL:0, planoQT:0, projMA:0, projPX:0, projUL:0, projQT:0,
    projJan:0, projFev:0, projMarProp:0, vendaJan:0, vendaFev:0, vendaMar:0,
    dispFutMar:0, dispFutAbr:0, dispFutMai:0, dispFutJun:0, negFutMar:0, negFutAbr:0, negFutMai:0, negFutJun:0, projCount:0,
    excedenteLojas:0,
  });
}

function agrupar(
  dados: Planejamento[],
  projecoes: ProjecoesMap,
  vendasReais: Record<string, Record<string, number>>,
  periodos: PeriodosPlano,
  excedentesLojas: Map<number, EstoqueLojaDisponivelAggregado> | null = null
): ContGroup[] {
  const ordemContinuidade: Record<string, number> = {
    'PERMANENTE': 1,
    'PERMANENTE COR NOVA': 2,
    'EDICAO LIMITADA': 3,
    'EDICCAO LIMITADA': 3,
    'EDIÇÃO LIMITADA': 3,
  };

  const contMap = new Map<string, Map<string, Planejamento[]>>();
  for (const item of dados) {
    const cont = (item.produto.continuidade || 'SEM CONTINUIDADE').trim();
    const ref  = (item.produto.referencia   || 'SEM REFERENCIA').trim();
    if (!contMap.has(cont)) contMap.set(cont, new Map());
    const refMap = contMap.get(cont)!;
    if (!refMap.has(ref)) refMap.set(ref, []);
    refMap.get(ref)!.push(item);
  }
  return Array.from(contMap.entries())
    .map(([continuidade, refMap]) => {
      const referencias = Array.from(refMap.entries())
        .map(([referencia, raw]) => {
          const itens = [...raw].sort((a, b) =>
            `${a.produto.cor}-${a.produto.tamanho}`.localeCompare(`${b.produto.cor}-${b.produto.tamanho}`)
          );
          return { referencia, nomeRef: raw[0]?.produto?.produto || '', itens, totais: somar(itens, projecoes, vendasReais, periodos, excedentesLojas) };
        })
        .sort((a, b) => a.referencia.localeCompare(b.referencia));
      return { continuidade, referencias, totais: somar(referencias.flatMap(r => r.itens), projecoes, vendasReais, periodos, excedentesLojas) };
    })
    .sort((a, b) => {
      const keyA = (a.continuidade || '').toUpperCase().trim();
      const keyB = (b.continuidade || '').toUpperCase().trim();
      const ordA = ordemContinuidade[keyA] ?? 999;
      const ordB = ordemContinuidade[keyB] ?? 999;
      if (ordA !== ordB) return ordA - ordB;
      return a.continuidade.localeCompare(b.continuidade);
    });
}

// ─── Cells ────────────────────────────────────────────────────────────────────
// Regra de cor: texto escuro (gray-800) no claro, claro (gray-100) no escuro.
// Cor só para alertas: vermelho = déficit, âmbar = abaixo do mínimo.

const D  = 'text-gray-800';  // normal light-bg
const DK = 'text-gray-100';  // normal dark-bg
const MT = 'text-gray-400';  // muted light-bg
const MK = 'text-gray-500';  // muted dark-bg
const dash = (dark: boolean) => <span className={dark ? MK : MT}>—</span>;

function BadgeSit({ t }: { t: GrupoTotais }) {
  if (t.deficit < 0) return <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-300">déficit</span>;
  if (t.abaixo > 0)  return <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-400/20 text-amber-300">{t.abaixo} abaixo</span>;
  return null;
}

function CellDisp({ v, min, dark = false }: { v: number; min: number; dark?: boolean }) {
  if (v < 0)   return <span className={`font-bold   ${dark ? 'text-red-400'   : 'text-red-600'}`}>{fmt(v)}</span>;
  return <span className={`font-semibold ${dark ? DK : D}`}>{fmt(v)}</span>;
}

function CellNegativo({ v, dark = false }: { v: number; dark?: boolean }) {
  if (v >= 0) return dash(dark);
  return <span className={`font-bold ${dark ? 'text-red-300' : 'text-red-700'}`}>{fmt(Math.abs(v))}</span>;
}

function CellCob({ disp, min, dark = false }: { disp: number; min: number; dark?: boolean }) {
  if (min <= 0) return dash(dark);
  const c = disp / min;
  const s = c.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'x';
  if (c < 0)   return <span className={`font-bold     ${dark ? 'text-red-400'   : 'text-red-600'}`}>{s}</span>;
  return <span className={dark ? DK : D}>{s}</span>;
}

function CellProj({ v, dark = false }: { v: number; dark?: boolean }) {
  if (v <= 0) return dash(dark);
  return <span className={dark ? DK : D}>{fmt(v)}</span>;
}

function CellPlano({ v, dark = false }: { v: number; dark?: boolean }) {
  if (v <= 0) return dash(dark);
  return <span className={`font-semibold ${dark ? DK : D}`}>{fmt(v)}</span>;
}

function CellDispFut({ v, min, dark = false }: { v: number | null; min: number; dark?: boolean }) {
  if (v === null) return dash(dark);
  if (v < 0)     return <span className={`font-bold     ${dark ? 'text-red-400'   : 'text-red-600'}`}>{fmt(v)}</span>;
  if (v < min)   return <span className={`font-semibold ${dark ? 'text-amber-300' : 'text-amber-600'}`}>{fmt(v)}</span>;
  return <span className={`font-semibold ${dark ? DK : D}`}>{fmt(v)}</span>;
}

function CellCobFut({ v, min, dark = false }: { v: number | null; min: number; dark?: boolean }) {
  if (v === null || min <= 0) return dash(dark);
  const c = v / min;
  const s = c.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'x';
  if (c < 0)   return <span className={`font-bold     ${dark ? 'text-red-400'   : 'text-red-600'}`}>{s}</span>;
  if (c < 1)   return <span className={`font-semibold ${dark ? 'text-red-400'   : 'text-red-500'}`}>{s}</span>;
  if (c < 1.5) return <span className={`font-semibold ${dark ? 'text-amber-300' : 'text-amber-600'}`}>{s}</span>;
  return <span className={dark ? DK : D}>{s}</span>;
}

function CellTaxa({ venda, proj, dark = false }: { venda: number; proj: number; dark?: boolean }) {
  if (proj <= 0) {
    return <span title={`Previsto: ${fmt(proj)} · Realizado: ${fmt(venda)}`}>{dash(dark)}</span>;
  }
  const taxa = venda / proj;
  const s = `${fmt(taxa * 100, 1)}%`;
  const tooltip = `Previsto: ${fmt(proj)} · Realizado: ${fmt(venda)}`;
  if (taxa < 0) return <span title={tooltip} className={dark ? 'text-red-300 font-semibold' : 'text-red-600 font-semibold'}>{s}</span>;
  return <span title={tooltip} className={dark ? DK : D}>{s}</span>;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  dados:        Planejamento[];
  filtroTexto?: string;
  projecoes?:   ProjecoesMap;
  vendasReais?: Record<string, Record<string, number>>;
  periodos?:    PeriodosPlano;
  apenasNegativos?: boolean;
  filtroContinuidade?: string | string[];
  filtroReferencia?: string;
  filtroCor?: string;
  filtroCobertura?: 'TODAS' | 'NEGATIVA' | 'ZERO_UM' | 'MAIOR_UM' | 'MAIOR_2';
  filtroCoberturaBase?: 'ATUAL' | 'MA' | 'PX' | 'UL' | 'QT';
  filtroTaxa?: 'TODAS' | 'ATE_70';
  excedentesLojas?: Map<number, EstoqueLojaDisponivelAggregado> | null;
  filtroCoberturaMinima?: string;
  filtroEmProcessoMinimo?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MatrizPlanejamentoTable({
  dados,
  filtroTexto = '',
  projecoes   = {},
  vendasReais = {},
  periodos    = { MA: new Date().getMonth() + 1, PX: new Date().getMonth() + 2, UL: new Date().getMonth() + 3, QT: new Date().getMonth() + 4 },
  apenasNegativos = false,
  filtroContinuidade = [],
  filtroReferencia = '',
  filtroCor = 'TODAS',
  filtroCobertura = 'TODAS',
  filtroCoberturaBase = 'ATUAL',
  filtroTaxa = 'TODAS',
  excedentesLojas = null,
  filtroCoberturaMinima = '',
  filtroEmProcessoMinimo = '',
}: Props) {
  type SortKey =
    | 'estoque' | 'emProcesso' | 'estoqueMin' | 'pedidos' | 'disponivel' | 'negativo' | 'cobertura'
    | 'taxaJan' | 'taxaFev' | 'taxaMar'
    | 'projMA' | 'planoMA' | 'dispMA' | 'cobMA'
    | 'projPX' | 'planoPX' | 'dispPX' | 'cobPX'
    | 'projUL' | 'planoUL' | 'dispUL' | 'cobUL'
    | 'projQT' | 'planoQT' | 'dispQT' | 'cobQT';

  const [expandedConts, setExpandedConts] = useState<Set<string>>(new Set());
  const [expandedRefs,  setExpandedRefs ] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>('disponivel');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const marFactor = useMemo(() => projecaoMesDecorrida(1, 3), []);

  // Modal de Em Processo por Local
  const [modalEmProcesso, setModalEmProcesso] = useState<{
    open: boolean;
    cdProduto: number | null;
    referencia: string;
    cor: string;
    tamanho: string;
    loading: boolean;
    error: string | null;
    data: Array<{ cd_local: number; ds_local: string; qtd_em_processo: number; qtd_op: number; qtd_finalizada: number }>;
  }>({ open: false, cdProduto: null, referencia: '', cor: '', tamanho: '', loading: false, error: null, data: [] });

  const abrirModalEmProcesso = async (cdProduto: number, referencia: string, cor: string, tamanho: string) => {
    setModalEmProcesso({ open: true, cdProduto, referencia, cor, tamanho, loading: true, error: null, data: [] });
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const res = await fetch(`${API_URL}/api/producao/em-processo-local/${cdProduto}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao buscar dados');
      setModalEmProcesso((prev) => ({ ...prev, loading: false, data: json.data || [] }));
    } catch (e) {
      setModalEmProcesso((prev) => ({ ...prev, loading: false, error: e instanceof Error ? e.message : 'Erro desconhecido' }));
    }
  };

  const fecharModalEmProcesso = () => setModalEmProcesso({ open: false, cdProduto: null, referencia: '', cor: '', tamanho: '', loading: false, error: null, data: [] });
  const mesQT = useMemo(() => periodos.QT ?? (((periodos.UL || 1) - 1 + 1) % 12) + 1, [periodos.QT, periodos.UL]);

  const grupos = useMemo(() => {
    let base = dados;
    if (filtroTexto) {
      const q = filtroTexto.toLowerCase();
      base = base.filter(i =>
        (i.produto.referencia   || '').toLowerCase().includes(q) ||
        (i.produto.continuidade || '').toLowerCase().includes(q) ||
        (i.produto.produto      || '').toLowerCase().includes(q) ||
        (i.produto.cor          || '').toLowerCase().includes(q)
      );
    }
    const filtroContinuidadeLista = Array.isArray(filtroContinuidade)
      ? filtroContinuidade
      : (filtroContinuidade && filtroContinuidade !== 'TODAS' ? [filtroContinuidade] : []);
    if (filtroContinuidadeLista.length > 0) {
      const setCont = new Set(filtroContinuidadeLista.map((v) => String(v || '').trim()));
      base = base.filter((i) => setCont.has((i.produto.continuidade || '').trim()));
    }
    if (filtroReferencia.trim()) {
      const qRef = filtroReferencia.toLowerCase().trim();
      base = base.filter((i) => (i.produto.referencia || '').toLowerCase().includes(qRef));
    }
    if (filtroCor !== 'TODAS') {
      base = base.filter((i) => (i.produto.cor || '').trim() === filtroCor);
    }
    if (filtroCobertura !== 'TODAS') {
      base = base.filter((i) => {
        const min = i.estoques.estoque_minimo || 0;
        if (min <= 0) return false;
        const dispAtual = (i.estoques.estoque_atual || 0) - (i.demanda.pedidos_pendentes || 0);
        const proj = projecoes[i.produto.idproduto] ?? null;
        const emP  = i.estoques.em_processo || 0;
        const pMA  = i.plano?.ma || 0;
        const pPX  = i.plano?.px || 0;
        const pUL  = i.plano?.ul || 0;
        const pQT  = i.plano?.qt || 0;
        const prMA = proj ? projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA) : 0;
        const prPX = proj ? (proj[String(periodos.PX)] ?? 0) : 0;
        const prUL = proj ? (proj[String(periodos.UL)] ?? 0) : 0;
        const prQT = proj ? (proj[String(mesQT)] ?? 0) : 0;
        const dispMA = dispAtual + emP + pMA - prMA;
        const dispPX = dispMA + pPX - prPX;
        const dispUL = dispPX + pUL - prUL;
        const dispQT = dispUL + pQT - prQT;
        const disp =
          filtroCoberturaBase === 'MA' ? dispMA :
          filtroCoberturaBase === 'PX' ? dispPX :
          filtroCoberturaBase === 'UL' ? dispUL :
          filtroCoberturaBase === 'QT' ? dispQT :
          dispAtual;
        const cob = disp / min;
        if (filtroCobertura === 'NEGATIVA') return cob < 0;
        if (filtroCobertura === 'ZERO_UM') return cob >= 0 && cob < 1;
        if (filtroCobertura === 'MAIOR_2') return cob >= 2;
        return cob >= 1;
      });
    }
    if (filtroTaxa === 'ATE_70') {
      base = base.filter((i) => {
        const proj = projecoes[i.produto.idproduto] ?? null;
        const real = vendasReais[i.produto.idproduto] ?? null;
        const projJan = proj ? (proj['1'] ?? 0) : 0;
        const projFev = proj ? (proj['2'] ?? 0) : 0;
        const vendaJan = real ? (real['1'] ?? 0) : 0;
        const vendaFev = real ? (real['2'] ?? 0) : 0;
        if (projJan <= 0 || projFev <= 0) return false;
        const taxaJan = vendaJan / projJan;
        const taxaFev = vendaFev / projFev;
        return taxaJan <= 0.7 && taxaFev <= 0.7;
      });
    }

    // Filtro customizado por cobertura mínima (SEM considerar em_processo)
    if (filtroCoberturaMinima.trim()) {
      const valorCobertura = parseFloat(filtroCoberturaMinima);
      console.log('[TABELA] Filtro cobertura recebido:', filtroCoberturaMinima, 'valor:', valorCobertura);
      console.log('[TABELA] Base ANTES do filtro:', base.length, 'produtos');
      if (!isNaN(valorCobertura)) {
        base = base.filter((i) => {
          // Cobertura ATUAL = (estoque - pedidos) / estoque_minimo
          // NÃO inclui em_processo pois queremos saber o que NÃO precisa produzir
          const estoqueAtual = Number(i.estoques?.estoque_atual || 0);
          const pedidos = Number(i.demanda?.pedidos_pendentes || 0);
          const estoqueMin = Number(i.estoques?.estoque_minimo || 0);
          const disponivelSemProcesso = estoqueAtual - pedidos;
          const coberturaAtual = estoqueMin > 0 ? disponivelSemProcesso / estoqueMin : Number.NEGATIVE_INFINITY;
          return coberturaAtual > valorCobertura;
        });
        console.log('[TABELA] Base DEPOIS do filtro:', base.length, 'produtos');
      }
    }

    // Filtro customizado por em processo mínimo
    if (filtroEmProcessoMinimo.trim()) {
      const valorProcesso = parseFloat(filtroEmProcessoMinimo);
      if (!isNaN(valorProcesso)) {
        base = base.filter((i) => {
          const emProcesso = Number(i.estoques?.em_processo || 0);
          return emProcesso > valorProcesso;
        });
      }
    }

    if (apenasNegativos) {
      base = base.filter((i) => {
        const dispAtual = (i.estoques.estoque_atual || 0) - (i.demanda.pedidos_pendentes || 0);
        const proj = projecoes[i.produto.idproduto] ?? null;
        if (!proj) return dispAtual < 0;

        const emP  = i.estoques.em_processo || 0;
        const pMA  = i.plano?.ma || 0;
        const pPX  = i.plano?.px || 0;
        const pUL  = i.plano?.ul || 0;
        const pQT  = i.plano?.qt || 0;
        const prMA = projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA);
        const prPX = proj[String(periodos.PX)] ?? 0;
        const prUL = proj[String(periodos.UL)] ?? 0;
        const prQT = proj[String(mesQT)] ?? 0;
        const dispMA = dispAtual + emP + pMA - prMA;
        const dispPX = dispMA + pPX - prPX;
        const dispUL = dispPX + pUL - prUL;
        const dispQT = dispUL + pQT - prQT;

        return dispAtual < 0 || dispMA < 0 || dispPX < 0 || dispUL < 0 || dispQT < 0;
      });
    }
    const grouped = agrupar(base, projecoes, vendasReais, periodos, excedentesLojas);

    const sortFactor = sortDir === 'asc' ? 1 : -1;

    const refMetric = (t: GrupoTotais, key: SortKey) => {
      switch (key) {
        case 'estoque': return t.estoque;
        case 'emProcesso': return t.emProcesso;
        case 'estoqueMin': return t.estoqueMin;
        case 'pedidos': return t.pedidos;
        case 'disponivel': return t.disponivel;
        case 'negativo': return Math.abs(t.deficit);
        case 'cobertura': return t.estoqueMin > 0 ? t.disponivel / t.estoqueMin : Number.NEGATIVE_INFINITY;
        case 'taxaJan': return t.projJan > 0 ? t.vendaJan / t.projJan : Number.NEGATIVE_INFINITY;
        case 'taxaFev': return t.projFev > 0 ? t.vendaFev / t.projFev : Number.NEGATIVE_INFINITY;
        case 'taxaMar': return t.projMarProp > 0 ? t.vendaMar / t.projMarProp : Number.NEGATIVE_INFINITY;
        case 'projMA': return t.projMA;
        case 'planoMA': return t.planoMA;
        case 'dispMA': return t.dispFutMar;
        case 'cobMA': return t.estoqueMin > 0 ? t.dispFutMar / t.estoqueMin : Number.NEGATIVE_INFINITY;
        case 'projPX': return t.projPX;
        case 'planoPX': return t.planoPX;
        case 'dispPX': return t.dispFutAbr;
        case 'cobPX': return t.estoqueMin > 0 ? t.dispFutAbr / t.estoqueMin : Number.NEGATIVE_INFINITY;
        case 'projUL': return t.projUL;
        case 'planoUL': return t.planoUL;
        case 'dispUL': return t.dispFutMai;
        case 'cobUL': return t.estoqueMin > 0 ? t.dispFutMai / t.estoqueMin : Number.NEGATIVE_INFINITY;
        case 'projQT': return t.projQT;
        case 'planoQT': return t.planoQT;
        case 'dispQT': return t.dispFutJun;
        case 'cobQT': return t.estoqueMin > 0 ? t.dispFutJun / t.estoqueMin : Number.NEGATIVE_INFINITY;
      }
    };

    const itemMetric = (i: Planejamento, key: SortKey) => {
      const disp = (i.estoques.estoque_atual || 0) - (i.demanda.pedidos_pendentes || 0);
      const proj = projecoes[i.produto.idproduto] ?? null;
      const real = vendasReais[i.produto.idproduto] ?? null;
      const emP = i.estoques.em_processo || 0;
      const pMA = i.plano?.ma || 0;
      const pPX = i.plano?.px || 0;
      const pUL = i.plano?.ul || 0;
      const pQT = i.plano?.qt || 0;
      const prMA = proj ? projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA) : 0;
      const prPX = proj ? (proj[String(periodos.PX)] ?? 0) : 0;
      const prUL = proj ? (proj[String(periodos.UL)] ?? 0) : 0;
      const prQT = proj ? (proj[String(mesQT)] ?? 0) : 0;
      const prJan = proj ? (proj['1'] ?? 0) : 0;
      const prFev = proj ? (proj['2'] ?? 0) : 0;
      const prMar = proj ? (proj['3'] ?? 0) * marFactor : 0;
      const vdJan = real ? (real['1'] ?? 0) : 0;
      const vdFev = real ? (real['2'] ?? 0) : 0;
      const vdMar = real ? (real['3'] ?? 0) : 0;
      const dMA = disp + emP + pMA - prMA;
      const dPX = dMA + pPX - prPX;
      const dUL = dPX + pUL - prUL;
      const dQT = dUL + pQT - prQT;
      const min = i.estoques.estoque_minimo || 0;

      switch (key) {
        case 'estoque': return i.estoques.estoque_atual || 0;
        case 'emProcesso': return emP;
        case 'estoqueMin': return min;
        case 'pedidos': return i.demanda.pedidos_pendentes || 0;
        case 'disponivel': return disp;
        case 'negativo': return disp < 0 ? Math.abs(disp) : 0;
        case 'cobertura': return min > 0 ? disp / min : Number.NEGATIVE_INFINITY;
        case 'taxaJan': return prJan > 0 ? vdJan / prJan : Number.NEGATIVE_INFINITY;
        case 'taxaFev': return prFev > 0 ? vdFev / prFev : Number.NEGATIVE_INFINITY;
        case 'taxaMar': return prMar > 0 ? vdMar / prMar : Number.NEGATIVE_INFINITY;
        case 'projMA': return prMA;
        case 'planoMA': return pMA;
        case 'dispMA': return dMA;
        case 'cobMA': return min > 0 ? dMA / min : Number.NEGATIVE_INFINITY;
        case 'projPX': return prPX;
        case 'planoPX': return pPX;
        case 'dispPX': return dPX;
        case 'cobPX': return min > 0 ? dPX / min : Number.NEGATIVE_INFINITY;
        case 'projUL': return prUL;
        case 'planoUL': return pUL;
        case 'dispUL': return dUL;
        case 'cobUL': return min > 0 ? dUL / min : Number.NEGATIVE_INFINITY;
        case 'projQT': return prQT;
        case 'planoQT': return pQT;
        case 'dispQT': return dQT;
        case 'cobQT': return min > 0 ? dQT / min : Number.NEGATIVE_INFINITY;
      }
    };

    return grouped.map((g) => ({
      ...g,
      referencias: [...g.referencias]
        .map((r) => ({
          ...r,
          itens: [...r.itens].sort((a, b) => (itemMetric(a, sortKey) - itemMetric(b, sortKey)) * sortFactor),
        }))
        .sort((a, b) => (refMetric(a.totais, sortKey) - refMetric(b.totais, sortKey)) * sortFactor),
    }));
  }, [dados, filtroTexto, projecoes, vendasReais, periodos, apenasNegativos, filtroContinuidade, filtroReferencia, filtroCor, filtroCobertura, filtroCoberturaBase, filtroTaxa, filtroCoberturaMinima, filtroEmProcessoMinimo, sortKey, sortDir, marFactor, mesQT]);

  useEffect(() => {
    if (grupos.length === 0) return;
    setExpandedConts(new Set(grupos.map(g => g.continuidade)));
    // Abrir por padrão no nível de referência (sem expandir SKUs automaticamente)
    setExpandedRefs(new Set());
  }, [grupos.length > 0 ? grupos[0].continuidade : '']);

  const totalItens   = grupos.reduce((a, g) => a + g.referencias.reduce((b, r) => b + r.itens.length, 0), 0);
  const temProjecoes = Object.keys(projecoes).length > 0;

  function toggleCont(c: string) { setExpandedConts(p => { const s = new Set(p); s.has(c) ? s.delete(c) : s.add(c); return s; }); }
  function toggleRef(k: string)  { setExpandedRefs(p  => { const s = new Set(p); s.has(k) ? s.delete(k) : s.add(k); return s; }); }
  function onSortClick(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir('asc');
  }
  function sortBadge(key: SortKey) {
    if (sortKey !== key) return <span className="ml-1 text-gray-500">↕</span>;
    return <span className="ml-1 text-brand-secondary">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  if (!dados.length) return <div className="bg-white rounded-lg shadow p-8 text-center text-sm text-gray-500">Nenhum dado encontrado.</div>;

  // month descriptors
  const mNomes = [
    MESES_PT[((periodos.MA - 1) % 12) + 1],
    MESES_PT[((periodos.PX - 1) % 12) + 1],
    MESES_PT[((periodos.UL - 1) % 12) + 1],
    MESES_PT[((mesQT - 1) % 12) + 1],
  ];

  // th style helpers
  const thBase = 'px-3 py-3.5 text-right font-semibold text-[10px] uppercase tracking-wide';
  const fmtTaxaCsv = (venda: number, proj: number) => (proj > 0 ? Number(((venda / proj) * 100).toFixed(1)) : null);

  function exportarCsvMatriz() {
    const toCsv = (v: string | number | null | undefined) => {
      const s = v === null || v === undefined ? '' : String(v);
      return `"${s.replaceAll('"', '""')}"`;
    };
    const header = [
      'continuidade', 'referencia', 'produto', 'idproduto', 'cor', 'tamanho',
      'estoque', 'em_processo', 'estoque_minimo', 'pedidos', 'disponivel_atual', 'negativo_atual', 'cobertura_atual',
      'taxa_jan_pct', 'taxa_fev_pct', 'taxa_mar_pct',
      `proj_${mNomes[0]}`, `plano_${mNomes[0]}`, `disp_${mNomes[0]}`, `neg_${mNomes[0]}`, `cob_${mNomes[0]}`,
      `proj_${mNomes[1]}`, `plano_${mNomes[1]}`, `disp_${mNomes[1]}`, `neg_${mNomes[1]}`, `cob_${mNomes[1]}`,
      `proj_${mNomes[2]}`, `plano_${mNomes[2]}`, `disp_${mNomes[2]}`, `neg_${mNomes[2]}`, `cob_${mNomes[2]}`,
      `proj_${mNomes[3]}`, `plano_${mNomes[3]}`, `disp_${mNomes[3]}`, `neg_${mNomes[3]}`, `cob_${mNomes[3]}`,
    ];
    const rows = grupos.flatMap((g) => g.referencias.flatMap((r) => r.itens.map((item) => {
      const dispAtual = (item.estoques.estoque_atual || 0) - (item.demanda.pedidos_pendentes || 0);
      const proj = projecoes[item.produto.idproduto] ?? null;
      const real = vendasReais[item.produto.idproduto] ?? null;
      const emP = item.estoques.em_processo || 0;
      const min = item.estoques.estoque_minimo || 0;
      const pMA = item.plano?.ma || 0;
      const pPX = item.plano?.px || 0;
      const pUL = item.plano?.ul || 0;
      const pQT = item.plano?.qt || 0;
      const prMA = proj ? projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA) : 0;
      const prPX = proj ? (proj[String(periodos.PX)] ?? 0) : 0;
      const prUL = proj ? (proj[String(periodos.UL)] ?? 0) : 0;
      const prQT = proj ? (proj[String(mesQT)] ?? 0) : 0;
      const dMA = dispAtual + emP + pMA - prMA;
      const dPX = dMA + pPX - prPX;
      const dUL = dPX + pUL - prUL;
      const dQT = dUL + pQT - prQT;
      const vendaJan = real ? (real['1'] ?? 0) : 0;
      const vendaFev = real ? (real['2'] ?? 0) : 0;
      const vendaMar = real ? (real['3'] ?? 0) : 0;
      const projJan = proj ? (proj['1'] ?? 0) : 0;
      const projFev = proj ? (proj['2'] ?? 0) : 0;
      const projMar = proj ? (proj['3'] ?? 0) * marFactor : 0;
      const cobAtual = min > 0 ? Number((dispAtual / min).toFixed(2)) : null;
      const cobMA = min > 0 ? Number((dMA / min).toFixed(2)) : null;
      const cobPX = min > 0 ? Number((dPX / min).toFixed(2)) : null;
      const cobUL = min > 0 ? Number((dUL / min).toFixed(2)) : null;
      const cobQT = min > 0 ? Number((dQT / min).toFixed(2)) : null;

      return [
        g.continuidade,
        item.produto.referencia || '',
        item.produto.produto || '',
        item.produto.idproduto || '',
        item.produto.cor || '',
        item.produto.tamanho || '',
        Number(item.estoques.estoque_atual || 0),
        Number(emP),
        Number(min),
        Number(item.demanda.pedidos_pendentes || 0),
        Number(dispAtual),
        dispAtual < 0 ? Math.abs(dispAtual) : 0,
        cobAtual,
        fmtTaxaCsv(vendaJan, projJan),
        fmtTaxaCsv(vendaFev, projFev),
        fmtTaxaCsv(vendaMar, projMar),
        Number(prMA), Number(pMA), Number(dMA), dMA < 0 ? Math.abs(dMA) : 0, cobMA,
        Number(prPX), Number(pPX), Number(dPX), dPX < 0 ? Math.abs(dPX) : 0, cobPX,
        Number(prUL), Number(pUL), Number(dUL), dUL < 0 ? Math.abs(dUL) : 0, cobUL,
        Number(prQT), Number(pQT), Number(dQT), dQT < 0 ? Math.abs(dQT) : 0, cobQT,
      ];
    })));

    const csv = [header, ...rows].map((line) => line.map(toCsv).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `matriz_plano_producao_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden w-full min-w-0">

      {/* top bar */}
      <div className="flex items-center justify-between px-3 py-3.5 border-b border-gray-100 bg-gray-50/80 text-xs text-gray-500">
        <span className="font-medium">{totalItens.toLocaleString('pt-BR')} itens · {grupos.length} continuidades</span>
        <div className="flex gap-4">
          <button onClick={exportarCsvMatriz} className="text-emerald-700 hover:text-emerald-900 font-medium">Exportar CSV</button>
          <button onClick={() => {
            setExpandedConts(new Set(grupos.map(g => g.continuidade)));
            setExpandedRefs(new Set(grupos.flatMap(g => g.referencias.map(r => `${g.continuidade}|${r.referencia}`))));
          }} className="text-indigo-600 hover:text-indigo-800 font-medium">Expandir tudo</button>
          <button onClick={() => { setExpandedConts(new Set()); setExpandedRefs(new Set()); }}
            className="text-gray-400 hover:text-gray-600">Recolher tudo</button>
        </div>
      </div>

      {/* scrollable table with sticky header */}
      <div className="w-full min-w-0 overflow-x-auto overflow-y-auto max-h-[calc(100vh-13rem)]">
        <table className="min-w-[2780px] border-collapse text-xs">

          <thead className="sticky top-0 z-30">
            {temProjecoes ? (
              <>
                {/* Row 1 — group labels */}
                <tr className="bg-brand-dark text-gray-200 text-[11px] font-semibold uppercase tracking-wide">
                  <th rowSpan={2} className="sticky left-0 z-40 px-2 py-2.5 text-left w-[240px] min-w-[240px] max-w-[240px] border-b border-gray-600 bg-brand-dark shadow-[1px_0_0_0_rgba(55,65,81,0.5)]">Referência / Produto</th>
                  <th rowSpan={2} onClick={() => onSortClick('estoque')} className="px-3 py-3.5 text-right border-b border-gray-600 bg-brand-dark cursor-pointer">Estoque{sortBadge('estoque')}</th>
                  <th rowSpan={2} onClick={() => onSortClick('emProcesso')} className="px-3 py-3.5 text-right border-b border-gray-600 bg-brand-dark cursor-pointer">Em Proc.{sortBadge('emProcesso')}</th>
                  {excedentesLojas && excedentesLojas.size > 0 && (
                    <th rowSpan={2} className="px-3 py-3.5 text-right border-b border-gray-600 bg-purple-900 text-purple-200">Estq. Lojas</th>
                  )}
                  <th rowSpan={2} onClick={() => onSortClick('estoqueMin')} className="px-3 py-3.5 text-right border-b border-gray-600 bg-brand-dark cursor-pointer">Est. Mín.{sortBadge('estoqueMin')}</th>
                  <th rowSpan={2} onClick={() => onSortClick('pedidos')} className="px-3 py-3.5 text-right border-b border-gray-600 bg-brand-dark cursor-pointer">Pedidos{sortBadge('pedidos')}</th>
                  <th rowSpan={2} onClick={() => onSortClick('disponivel')} className="px-3 py-3.5 text-right border-b border-gray-600 bg-brand-dark cursor-pointer">Disponível{sortBadge('disponivel')}</th>
                  <th rowSpan={2} onClick={() => onSortClick('negativo')} className="px-3 py-3.5 text-right border-b border-gray-600 bg-brand-dark cursor-pointer">Negativo{sortBadge('negativo')}</th>
                  <th rowSpan={2} onClick={() => onSortClick('cobertura')} className="px-3 py-3.5 text-right border-b border-gray-600 bg-brand-dark cursor-pointer">Cobertura{sortBadge('cobertura')}</th>
                  <th rowSpan={2} onClick={() => onSortClick('taxaJan')} className="px-3 py-3.5 text-right border-b border-gray-600 bg-brand-dark cursor-pointer">Taxa Jan{sortBadge('taxaJan')}</th>
                  <th rowSpan={2} onClick={() => onSortClick('taxaFev')} className="px-3 py-3.5 text-right border-b border-gray-600 bg-brand-dark cursor-pointer">Taxa Fev{sortBadge('taxaFev')}</th>
                  <th rowSpan={2} onClick={() => onSortClick('taxaMar')} className="px-3 py-3.5 text-right border-b border-gray-600 bg-brand-dark cursor-pointer">Taxa Mar{sortBadge('taxaMar')}</th>
                  <th colSpan={5} className="px-3 py-3.5 text-center bg-indigo-900 border-b border-indigo-700 font-bold">{mNomes[0]}</th>
                  <th colSpan={5} className="px-3 py-3.5 text-center bg-emerald-800 border-b border-emerald-700 font-bold">{mNomes[1]}</th>
                  <th colSpan={5} className="px-3 py-3.5 text-center bg-amber-700 border-b border-amber-600 font-bold">{mNomes[2]}</th>
                  <th colSpan={5} className="px-3 py-3.5 text-center bg-cyan-800 border-b border-cyan-700 font-bold">{mNomes[3]}</th>
                </tr>
                {/* Row 2 — sub-headers */}
                <tr className="text-gray-300">
                  {([
                    { bg: 'bg-indigo-900', label: 'Proj.', key: 'projMA' as const },
                    { bg: 'bg-indigo-900', label: 'Plano', key: 'planoMA' as const },
                    { bg: 'bg-indigo-900', label: 'Disp.', key: 'dispMA' as const },
                    { bg: 'bg-indigo-900', label: 'Neg.', key: 'dispMA' as const },
                    { bg: 'bg-indigo-900', label: 'Cob.', key: 'cobMA' as const },
                    { bg: 'bg-emerald-800', label: 'Proj.', key: 'projPX' as const },
                    { bg: 'bg-emerald-800', label: 'Plano', key: 'planoPX' as const },
                    { bg: 'bg-emerald-800', label: 'Disp.', key: 'dispPX' as const },
                    { bg: 'bg-emerald-800', label: 'Neg.', key: 'dispPX' as const },
                    { bg: 'bg-emerald-800', label: 'Cob.', key: 'cobPX' as const },
                    { bg: 'bg-amber-700', label: 'Proj.', key: 'projUL' as const },
                    { bg: 'bg-amber-700', label: 'Plano', key: 'planoUL' as const },
                    { bg: 'bg-amber-700', label: 'Disp.', key: 'dispUL' as const },
                    { bg: 'bg-amber-700', label: 'Neg.', key: 'dispUL' as const },
                    { bg: 'bg-amber-700', label: 'Cob.', key: 'cobUL' as const },
                    { bg: 'bg-cyan-800', label: 'Proj.', key: 'projQT' as const },
                    { bg: 'bg-cyan-800', label: 'Plano', key: 'planoQT' as const },
                    { bg: 'bg-cyan-800', label: 'Disp.', key: 'dispQT' as const },
                    { bg: 'bg-cyan-800', label: 'Neg.', key: 'dispQT' as const },
                    { bg: 'bg-cyan-800', label: 'Cob.', key: 'cobQT' as const },
                  ]).map((h, i) => (
                    <th key={i} onClick={() => onSortClick(h.key)} className={`${thBase} ${h.bg} border-b border-gray-600 cursor-pointer`}>
                      {h.label}{sortBadge(h.key)}
                    </th>
                  ))}
                </tr>
              </>
            ) : (
              <tr className="bg-brand-dark text-gray-200 text-[11px] font-semibold uppercase tracking-wide">
                <th className="sticky left-0 z-40 px-2 py-2.5 text-left w-[240px] min-w-[240px] max-w-[240px] bg-brand-dark shadow-[1px_0_0_0_rgba(55,65,81,0.5)]">Referência / Produto</th>
                <th onClick={() => onSortClick('estoque')} className="px-3 py-3 text-right cursor-pointer">Estoque{sortBadge('estoque')}</th>
                <th onClick={() => onSortClick('emProcesso')} className="px-3 py-3 text-right cursor-pointer">Em Proc.{sortBadge('emProcesso')}</th>
                {excedentesLojas && excedentesLojas.size > 0 && (
                  <th className="px-3 py-3 text-right bg-purple-900 text-purple-200">Estq. Lojas</th>
                )}
                <th onClick={() => onSortClick('estoqueMin')} className="px-3 py-3 text-right cursor-pointer">Est. Mín.{sortBadge('estoqueMin')}</th>
                <th onClick={() => onSortClick('pedidos')} className="px-3 py-3 text-right cursor-pointer">Pedidos{sortBadge('pedidos')}</th>
                <th onClick={() => onSortClick('disponivel')} className="px-3 py-3 text-right cursor-pointer">Disponível{sortBadge('disponivel')}</th>
                <th onClick={() => onSortClick('negativo')} className="px-3 py-3 text-right cursor-pointer">Negativo{sortBadge('negativo')}</th>
                <th onClick={() => onSortClick('cobertura')} className="px-3 py-3 text-right cursor-pointer">Cobertura{sortBadge('cobertura')}</th>
                <th onClick={() => onSortClick('taxaJan')} className="px-3 py-3 text-right cursor-pointer">Taxa Jan{sortBadge('taxaJan')}</th>
                <th onClick={() => onSortClick('taxaFev')} className="px-3 py-3 text-right cursor-pointer">Taxa Fev{sortBadge('taxaFev')}</th>
                <th onClick={() => onSortClick('taxaMar')} className="px-3 py-3 text-right cursor-pointer">Taxa Mar{sortBadge('taxaMar')}</th>
                <th onClick={() => onSortClick('planoMA')} className="px-3 py-3 text-right bg-teal-800 cursor-pointer">{mNomes[0]}{sortBadge('planoMA')}</th>
                <th onClick={() => onSortClick('planoPX')} className="px-3 py-3 text-right bg-teal-800 cursor-pointer">{mNomes[1]}{sortBadge('planoPX')}</th>
                <th onClick={() => onSortClick('planoUL')} className="px-3 py-3 text-right bg-teal-800 cursor-pointer">{mNomes[2]}{sortBadge('planoUL')}</th>
                <th onClick={() => onSortClick('planoQT')} className="px-3 py-3 text-right bg-teal-800 cursor-pointer">{mNomes[3]}{sortBadge('planoQT')}</th>
              </tr>
            )}
          </thead>

          <tbody className="divide-y divide-gray-100">
            {grupos.map(grupo => {
              const contOpen = expandedConts.has(grupo.continuidade);
              const gt = grupo.totais;

              return (
                <React.Fragment key={grupo.continuidade}>

                  {/* ── continuidade ── */}
                  <tr
                    onClick={() => toggleCont(grupo.continuidade)}
                    className="group cursor-pointer select-none transition-colors bg-[#585858] hover:bg-[#4a4a4a]"
                  >
                    <td className="sticky left-0 z-20 bg-[#585858] group-hover:bg-[#4a4a4a] px-2 py-2.5 text-white font-bold text-[11px] w-[240px] min-w-[240px] max-w-[240px] shadow-[1px_0_0_0_rgba(55,65,81,0.25)]">
                      <span className="text-brand-secondary mr-2 text-[10px]">{contOpen ? '▼' : '▶'}</span>
                      {grupo.continuidade}
                      <BadgeSit t={gt} />
                    </td>
                    <td className="px-2 py-2.5 text-right text-gray-200 font-mono text-[11px] tabular-nums font-semibold">{fmt(gt.estoque)}</td>
                    <td className="px-2 py-2.5 text-right font-mono text-[11px] tabular-nums">
                      {gt.emProcesso > 0 ? <span className="text-gray-200 font-semibold">{fmt(gt.emProcesso)}</span> : <span className="text-gray-600">—</span>}
                    </td>
                    {excedentesLojas && excedentesLojas.size > 0 && (
                      <td className="px-2 py-2.5 text-right font-mono text-[11px] tabular-nums bg-purple-900/50">
                        {gt.excedenteLojas > 0 ? <span className="text-purple-300 font-semibold">{fmt(gt.excedenteLojas)}</span> : <span className="text-gray-600">—</span>}
                      </td>
                    )}
                    <td className="px-2 py-2.5 text-right text-gray-400 font-mono text-[11px] tabular-nums">{fmt(gt.estoqueMin)}</td>
                    <td className="px-2 py-2.5 text-right font-mono text-[11px] tabular-nums">
                      {gt.pedidos > 0 ? <span className="text-brand-secondary font-semibold">{fmt(gt.pedidos)}</span> : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono text-[11px] tabular-nums font-bold">
                      <CellDisp v={gt.disponivel} min={gt.estoqueMin} dark />
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono text-[11px] tabular-nums">
                      <CellNegativo v={gt.deficit} dark />
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono text-[11px] tabular-nums font-semibold">
                      <CellCob disp={gt.disponivel} min={gt.estoqueMin} dark />
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono text-[11px] tabular-nums"><CellTaxa venda={gt.vendaJan} proj={gt.projJan} dark /></td>
                    <td className="px-2 py-2.5 text-right font-mono text-[11px] tabular-nums"><CellTaxa venda={gt.vendaFev} proj={gt.projFev} dark /></td>
                    <td className="px-2 py-2.5 text-right font-mono text-[11px] tabular-nums"><CellTaxa venda={gt.vendaMar} proj={gt.projMarProp} dark /></td>
                    {temProjecoes ? (
                      <>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-violet-950">
                          {gt.projCount > 0 ? <CellProj v={gt.projMA} dark /> : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-indigo-950">
                          <CellPlano v={gt.planoMA} dark />
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-indigo-950">
                          {gt.projCount > 0 ? <CellDispFut v={gt.dispFutMar} min={gt.estoqueMin} dark /> : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-indigo-950">
                          {gt.projCount > 0 ? <span className="text-red-300 font-semibold">{fmt(gt.negFutMar)}</span> : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-indigo-950">
                          {gt.projCount > 0 ? <CellCobFut v={gt.dispFutMar} min={gt.estoqueMin} dark /> : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-emerald-900">
                          {gt.projCount > 0 ? <CellProj v={gt.projPX} dark /> : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-emerald-900">
                          <CellPlano v={gt.planoPX} dark />
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-emerald-900">
                          {gt.projCount > 0 ? <CellDispFut v={gt.dispFutAbr} min={gt.estoqueMin} dark /> : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-emerald-900">
                          {gt.projCount > 0 ? <span className="text-red-300 font-semibold">{fmt(gt.negFutAbr)}</span> : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-emerald-900">
                          {gt.projCount > 0 ? <CellCobFut v={gt.dispFutAbr} min={gt.estoqueMin} dark /> : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-amber-900">
                          {gt.projCount > 0 ? <CellProj v={gt.projUL} dark /> : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-amber-900">
                          <CellPlano v={gt.planoUL} dark />
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-amber-900">
                          {gt.projCount > 0 ? <CellDispFut v={gt.dispFutMai} min={gt.estoqueMin} dark /> : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-amber-900">
                          {gt.projCount > 0 ? <span className="text-red-300 font-semibold">{fmt(gt.negFutMai)}</span> : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-amber-900">
                          {gt.projCount > 0 ? <CellCobFut v={gt.dispFutMai} min={gt.estoqueMin} dark /> : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-cyan-900">
                          {gt.projCount > 0 ? <CellProj v={gt.projQT} dark /> : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-cyan-900">
                          <CellPlano v={gt.planoQT} dark />
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-cyan-900">
                          {gt.projCount > 0 ? <CellDispFut v={gt.dispFutJun} min={gt.estoqueMin} dark /> : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-cyan-900">
                          {gt.projCount > 0 ? <span className="text-red-300 font-semibold">{fmt(gt.negFutJun)}</span> : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-cyan-900">
                          {gt.projCount > 0 ? <CellCobFut v={gt.dispFutJun} min={gt.estoqueMin} dark /> : <span className="text-gray-700">—</span>}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-teal-900"><CellPlano v={gt.planoMA} dark /></td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-teal-900"><CellPlano v={gt.planoPX} dark /></td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-teal-900"><CellPlano v={gt.planoUL} dark /></td>
                        <td className="px-3 py-3.5 text-right font-mono text-xs tabular-nums bg-teal-900"><CellPlano v={gt.planoQT} dark /></td>
                      </>
                    )}
                  </tr>

                  {contOpen && grupo.referencias.map(ref => {
                    const refKey  = `${grupo.continuidade}|${ref.referencia}`;
                    const refOpen = expandedRefs.has(refKey);
                    const rt      = ref.totais;
                    const rtSit   = rt.disponivel < 0 ? 'deficit' : rt.disponivel < rt.estoqueMin ? 'abaixo' : 'ok';

                    return (
                      <React.Fragment key={refKey}>

                        {/* ── referência ── */}
                        <tr
                          onClick={() => toggleRef(refKey)}
                          className={`group cursor-pointer select-none transition-colors text-xs
                            ${rtSit === 'deficit' ? 'bg-red-50 hover:bg-red-100 border-l-2 border-l-red-400'
                            : rtSit === 'abaixo'  ? 'bg-amber-50 hover:bg-amber-100 border-l-2 border-l-amber-400'
                            : 'bg-slate-50 hover:bg-slate-100 border-l-2 border-l-slate-200'}`}
                        >
                          <td className={`sticky left-0 z-10 px-3 py-3.5 pl-8 font-semibold text-slate-800 w-[280px] min-w-[280px] max-w-[280px] shadow-[1px_0_0_0_rgba(148,163,184,0.25)]
                            ${rtSit === 'deficit' ? 'bg-red-50 group-hover:bg-red-100'
                            : rtSit === 'abaixo' ? 'bg-amber-50 group-hover:bg-amber-100'
                            : 'bg-slate-50 group-hover:bg-slate-100'}`}
                          >
                            <span className="text-slate-400 mr-2 text-[10px]">{refOpen ? '▼' : '▶'}</span>
                            <span className="font-mono text-slate-500 mr-2 text-[11px]">{ref.referencia}</span>
                            <span
                              className="inline-block max-w-[140px] truncate align-bottom text-slate-700"
                              title={ref.nomeRef}
                            >
                              {ref.nomeRef}
                            </span>
                          </td>
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums text-slate-700 font-semibold">{fmt(rt.estoque)}</td>
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                            {rt.emProcesso > 0 ? <span className="text-gray-700 font-semibold">{fmt(rt.emProcesso)}</span> : <span className="text-slate-300">—</span>}
                          </td>
                          {excedentesLojas && excedentesLojas.size > 0 && (
                            <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-purple-50">
                              {rt.excedenteLojas > 0 ? <span className="text-purple-700 font-semibold">{fmt(rt.excedenteLojas)}</span> : <span className="text-slate-300">—</span>}
                            </td>
                          )}
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums text-slate-500">{fmt(rt.estoqueMin)}</td>
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                            {rt.pedidos > 0 ? <span className="text-gray-700 font-semibold">{fmt(rt.pedidos)}</span> : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums font-bold">
                            <CellDisp v={rt.disponivel} min={rt.estoqueMin} />
                          </td>
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                            <CellNegativo v={rt.deficit} />
                          </td>
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                            <CellCob disp={rt.disponivel} min={rt.estoqueMin} />
                          </td>
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums"><CellTaxa venda={rt.vendaJan} proj={rt.projJan} /></td>
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums"><CellTaxa venda={rt.vendaFev} proj={rt.projFev} /></td>
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums"><CellTaxa venda={rt.vendaMar} proj={rt.projMarProp} /></td>
                          {temProjecoes ? (
                            <>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-violet-50">
                                {rt.projCount > 0 ? <CellProj v={rt.projMA} /> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-indigo-50">
                                <CellPlano v={rt.planoMA} />
                              </td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-indigo-50">
                                {rt.projCount > 0 ? <CellDispFut v={rt.dispFutMar} min={rt.estoqueMin} /> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-indigo-50">
                                {rt.projCount > 0 ? <span className="text-red-700 font-semibold">{fmt(rt.negFutMar)}</span> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-indigo-50">
                                {rt.projCount > 0 ? <CellCobFut v={rt.dispFutMar} min={rt.estoqueMin} /> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-emerald-50">
                                {rt.projCount > 0 ? <CellProj v={rt.projPX} /> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-emerald-50">
                                <CellPlano v={rt.planoPX} />
                              </td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-emerald-50">
                                {rt.projCount > 0 ? <CellDispFut v={rt.dispFutAbr} min={rt.estoqueMin} /> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-emerald-50">
                                {rt.projCount > 0 ? <span className="text-red-700 font-semibold">{fmt(rt.negFutAbr)}</span> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-emerald-50">
                                {rt.projCount > 0 ? <CellCobFut v={rt.dispFutAbr} min={rt.estoqueMin} /> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-amber-50">
                                {rt.projCount > 0 ? <CellProj v={rt.projUL} /> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-amber-50">
                                <CellPlano v={rt.planoUL} />
                              </td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-amber-50">
                                {rt.projCount > 0 ? <CellDispFut v={rt.dispFutMai} min={rt.estoqueMin} /> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-amber-50">
                                {rt.projCount > 0 ? <span className="text-red-700 font-semibold">{fmt(rt.negFutMai)}</span> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-amber-50">
                                {rt.projCount > 0 ? <CellCobFut v={rt.dispFutMai} min={rt.estoqueMin} /> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-cyan-50">
                                {rt.projCount > 0 ? <CellProj v={rt.projQT} /> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-cyan-50">
                                <CellPlano v={rt.planoQT} />
                              </td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-cyan-50">
                                {rt.projCount > 0 ? <CellDispFut v={rt.dispFutJun} min={rt.estoqueMin} /> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-cyan-50">
                                {rt.projCount > 0 ? <span className="text-red-700 font-semibold">{fmt(rt.negFutJun)}</span> : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-cyan-50">
                                {rt.projCount > 0 ? <CellCobFut v={rt.dispFutJun} min={rt.estoqueMin} /> : <span className="text-slate-300">—</span>}
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-teal-50"><CellPlano v={rt.planoMA} /></td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-teal-50"><CellPlano v={rt.planoPX} /></td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-teal-50"><CellPlano v={rt.planoUL} /></td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-teal-50"><CellPlano v={rt.planoQT} /></td>
                            </>
                          )}
                        </tr>

                        {/* ── SKUs ── */}
                        {refOpen && ref.itens.map(item => {
                          const disp    = item.estoques.estoque_atual - item.demanda.pedidos_pendentes;
                          const sit     = situacao(item.estoques.estoque_atual, item.demanda.pedidos_pendentes, item.estoques.estoque_minimo);
                          const proj    = projecoes[item.produto.idproduto] ?? null;
                          const emP     = item.estoques.em_processo || 0;
                          const pMA     = item.plano?.ma || 0;
                          const pPX     = item.plano?.px || 0;
                          const pUL     = item.plano?.ul || 0;
                          const pQT     = item.plano?.qt || 0;
                          const prMA    = proj ? projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA) : 0;
                          const prPX    = proj ? (proj[String(periodos.PX)] ?? 0) : 0;
                          const prUL    = proj ? (proj[String(periodos.UL)] ?? 0) : 0;
                          const prQT    = proj ? (proj[String(mesQT)] ?? 0) : 0;
                          const dFutMar = proj !== null ? disp + emP + pMA - prMA : null;
                          const dFutAbr = proj !== null && dFutMar !== null ? dFutMar + pPX - prPX : null;
                          const dFutMai = proj !== null && dFutAbr !== null ? dFutAbr + pUL - prUL : null;
                          const dFutJun = proj !== null && dFutMai !== null ? dFutMai + pQT - prQT : null;
                          const eMin    = item.estoques.estoque_minimo;

                          return (
                            <tr
                              key={item.produto.idproduto}
                              className={`group text-xs transition-colors
                                ${sit === 'deficit' ? 'bg-red-50 hover:bg-red-100'
                                : sit === 'abaixo'  ? 'bg-amber-50 hover:bg-amber-100'
                                : 'bg-white hover:bg-gray-50'}`}
                            >
                              <td className={`sticky left-0 z-10 px-3 py-3 pl-12 text-gray-600 w-[280px] min-w-[280px] max-w-[280px] shadow-[1px_0_0_0_rgba(148,163,184,0.2)]
                                ${sit === 'deficit' ? 'bg-red-50 group-hover:bg-red-100'
                                : sit === 'abaixo' ? 'bg-amber-50 group-hover:bg-amber-100'
                                : 'bg-white group-hover:bg-gray-50'}`}
                              >
                                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle
                                  ${sit === 'deficit' ? 'bg-red-400' : sit === 'abaixo' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                                <span className="text-gray-400 font-mono text-[10px] mr-2">{item.produto.idproduto}</span>
                                <span className="font-medium text-gray-700">{(item.produto.cor || '—').trim()}</span>
                                <span className="text-gray-400 mx-1.5">/</span>
                                <span className="text-gray-500">{(item.produto.tamanho || '—').trim()}</span>
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">
                                {item.estoques.estoque_atual > 0 ? <span className="text-gray-700">{fmt(item.estoques.estoque_atual)}</span> : <span className="text-gray-300">0</span>}
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">
                                {emP > 0 ? (
                                  <button
                                    onClick={() => abrirModalEmProcesso(
                                      Number(item.produto.idproduto),
                                      item.produto.referencia || '',
                                      item.produto.cor || '',
                                      item.produto.tamanho || ''
                                    )}
                                    className="text-sky-700 hover:text-sky-900 hover:underline cursor-pointer font-semibold"
                                    title="Clique para ver detalhes por local"
                                  >
                                    {fmt(emP)}
                                  </button>
                                ) : <span className="text-gray-300">—</span>}
                              </td>
                              {excedentesLojas && excedentesLojas.size > 0 && (() => {
                                const excItem = excedentesLojas.get(Number(item.produto.idproduto));
                                const excVal = excItem?.qtd_disponivel_total || 0;
                                return (
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-purple-50/50">
                                    {excVal > 0 ? <span className="text-purple-700">{fmt(excVal)}</span> : <span className="text-gray-300">—</span>}
                                  </td>
                                );
                              })()}
                              <td className="px-3 py-3 text-right font-mono tabular-nums text-gray-400">{fmt(eMin)}</td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">
                                {item.demanda.pedidos_pendentes > 0 ? <span className="text-gray-700">{fmt(item.demanda.pedidos_pendentes)}</span> : <span className="text-gray-300">—</span>}
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums font-semibold">
                                <CellDisp v={disp} min={eMin} />
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">
                                <CellNegativo v={disp} />
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">
                                <CellCob disp={disp} min={eMin} />
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">
                                <CellTaxa venda={(vendasReais[item.produto.idproduto]?.['1'] ?? 0)} proj={(projecoes[item.produto.idproduto]?.['1'] ?? 0)} />
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">
                                <CellTaxa venda={(vendasReais[item.produto.idproduto]?.['2'] ?? 0)} proj={(projecoes[item.produto.idproduto]?.['2'] ?? 0)} />
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">
                                <CellTaxa
                                  venda={(vendasReais[item.produto.idproduto]?.['3'] ?? 0)}
                                  proj={(projecoes[item.produto.idproduto]?.['3'] ?? 0) * marFactor}
                                />
                              </td>
                              {temProjecoes ? (
                                <>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-violet-50/60">
                                    <CellProj v={prMA} />
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-indigo-50/70">
                                    <CellPlano v={pMA} />
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-indigo-50/70">
                                    <CellDispFut v={dFutMar} min={eMin} />
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-indigo-50/70">
                                    {dFutMar !== null && dFutMar < 0 ? <span className="text-red-700 font-semibold">{fmt(Math.abs(dFutMar))}</span> : <span className="text-gray-300">—</span>}
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-indigo-50/70">
                                    <CellCobFut v={dFutMar} min={eMin} />
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-emerald-50/70">
                                    <CellProj v={prPX} />
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-emerald-50/70">
                                    <CellPlano v={pPX} />
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-emerald-50/70">
                                    <CellDispFut v={dFutAbr} min={eMin} />
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-emerald-50/70">
                                    {dFutAbr !== null && dFutAbr < 0 ? <span className="text-red-700 font-semibold">{fmt(Math.abs(dFutAbr))}</span> : <span className="text-gray-300">—</span>}
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-emerald-50/70">
                                    <CellCobFut v={dFutAbr} min={eMin} />
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-amber-50/70">
                                    <CellProj v={prUL} />
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-amber-50/70">
                                    <CellPlano v={pUL} />
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-amber-50/70">
                                    <CellDispFut v={dFutMai} min={eMin} />
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-amber-50/70">
                                    {dFutMai !== null && dFutMai < 0 ? <span className="text-red-700 font-semibold">{fmt(Math.abs(dFutMai))}</span> : <span className="text-gray-300">—</span>}
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-amber-50/70">
                                    <CellCobFut v={dFutMai} min={eMin} />
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-cyan-50/70">
                                    <CellProj v={prQT} />
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-cyan-50/70">
                                    <CellPlano v={pQT} />
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-cyan-50/70">
                                    <CellDispFut v={dFutJun} min={eMin} />
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-cyan-50/70">
                                    {dFutJun !== null && dFutJun < 0 ? <span className="text-red-700 font-semibold">{fmt(Math.abs(dFutJun))}</span> : <span className="text-gray-300">—</span>}
                                  </td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-cyan-50/70">
                                    <CellCobFut v={dFutJun} min={eMin} />
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-teal-50/60"><CellPlano v={pMA} /></td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-teal-50/60"><CellPlano v={pPX} /></td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-teal-50/60"><CellPlano v={pUL} /></td>
                                  <td className="px-3 py-3 text-right font-mono tabular-nums bg-teal-50/60"><CellPlano v={pQT} /></td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* legenda */}
      <div className="flex items-center gap-6 px-3 py-3 border-t border-gray-100 bg-gray-50/60 text-[11px] text-gray-500 flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"/>Déficit</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"/>Abaixo do mínimo</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"/>OK</span>
        {temProjecoes && (
          <span className="flex items-center gap-1.5 text-violet-600">
            <span className="w-2 h-2 rounded-full bg-violet-400 inline-block"/>
            Disp. futuro = Disp. + Em Proc. + Plano − Projeção
          </span>
        )}
        <span className="ml-auto text-gray-400">Disponível = Estoque − Pedidos · Cobertura = Disp. ÷ Est. Mín.</span>
      </div>

      {/* Modal Em Processo por Local */}
      {modalEmProcesso.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={fecharModalEmProcesso}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-200 bg-sky-50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-sky-800">Em Processo por Local</h3>
                <p className="text-xs text-sky-600">
                  {modalEmProcesso.referencia} · {modalEmProcesso.cor} / {modalEmProcesso.tamanho}
                  <span className="ml-2 text-gray-400">ID: {modalEmProcesso.cdProduto}</span>
                </p>
              </div>
              <button onClick={fecharModalEmProcesso} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="p-4 max-h-[60vh] overflow-auto">
              {modalEmProcesso.loading && (
                <div className="text-center py-8 text-gray-500 text-sm">Carregando...</div>
              )}
              {modalEmProcesso.error && (
                <div className="text-center py-8 text-red-600 text-sm">{modalEmProcesso.error}</div>
              )}
              {!modalEmProcesso.loading && !modalEmProcesso.error && modalEmProcesso.data.length === 0 && (
                <div className="text-center py-8 text-gray-500 text-sm">Nenhum registro em processo encontrado.</div>
              )}
              {!modalEmProcesso.loading && !modalEmProcesso.error && modalEmProcesso.data.length > 0 && (
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-gray-700">Cód. Local</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-700">Local (Setor)</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-700">Qtd. OP</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-700">Finalizada</th>
                      <th className="text-right px-3 py-2 font-semibold text-sky-700">Em Processo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalEmProcesso.data.map((loc, idx) => (
                      <tr key={loc.cd_local} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-3 py-2 text-gray-500 font-mono">{loc.cd_local}</td>
                        <td className="px-3 py-2 text-gray-700 font-medium">{loc.ds_local}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-600">{fmt(loc.qtd_op)}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-600">{fmt(loc.qtd_finalizada)}</td>
                        <td className="px-3 py-2 text-right font-mono text-sky-700 font-semibold">{fmt(loc.qtd_em_processo)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-sky-50 border-t border-sky-200">
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-right font-semibold text-sky-800">Total Em Processo:</td>
                      <td className="px-3 py-2 text-right font-mono text-sky-800 font-bold">
                        {fmt(modalEmProcesso.data.reduce((acc, l) => acc + l.qtd_em_processo, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 text-right">
              <button onClick={fecharModalEmProcesso} className="px-4 py-2 text-xs font-semibold bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
