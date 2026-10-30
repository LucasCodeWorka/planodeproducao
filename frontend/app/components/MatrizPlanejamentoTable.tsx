'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Planejamento, ProjecoesMap, PeriodosPlano, EstoqueLojaDisponivelAggregado } from '../types';
import { projecaoMesPlanejamento } from '../lib/projecao';
import { PERIODOS_PLANO, campoDoPeriodo, type CampoPeriodo, type PeriodoPlano } from '../lib/periodos';

const MESES_PT = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
type TaxaMes = { mes: number; ano?: number; label: string; proporcional?: boolean };

function fmt(v: number, dec = 0) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function mesAnteriorFechado(base = new Date(), voltar: number) {
  const date = new Date(base.getFullYear(), base.getMonth() - voltar, 1);
  const mes = date.getMonth() + 1;
  return { mes, ano: date.getFullYear(), label: MESES_PT[mes] };
}

function taxaMesesDefault(): [TaxaMes, TaxaMes, TaxaMes] {
  return [mesAnteriorFechado(new Date(), 3), mesAnteriorFechado(new Date(), 2), mesAnteriorFechado(new Date(), 1)];
}

type Situacao = 'deficit' | 'abaixo' | 'ok';

function situacao(estoque: number, pedidos: number, estoqueMin: number): Situacao {
  const d = estoque - pedidos;
  if (d < 0) return 'deficit';
  if (d < estoqueMin) return 'abaixo';
  return 'ok';
}

// â”€â”€â”€ GrupoTotais â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface GrupoTotais {
  estoque: number; emProcesso: number; estoqueMin: number;
  pedidos: number; disponivel: number; disponivelPosProcesso: number; deficit: number; deficitPosProcesso: number; abaixo: number;
  // MAPAS POR PERIODO — a forma boa, com os NOVE periodos.
  //
  // Os campos chapados abaixo continuam, DERIVADOS destes, para nao quebrar as dezenas de
  // pontos que ja os leem. Eles param em seis e tem nome de MES (`dispFutMar`,
  // `dispFutNov`) que nao corresponde a mes nenhum ha muito tempo: sao posicionais
  // disfarcados, resto de quando o horizonte era fixo. Codigo novo le daqui.
  plano:   Record<CampoPeriodo, number>;
  proj:    Record<CampoPeriodo, number>;
  dispFut: Record<CampoPeriodo, number>;
  negFut:  Record<CampoPeriodo, number>;
  planoMA: number; planoPX: number; planoUL: number; planoQT: number; planoQU: number; planoSX: number;
  projMA:  number; projPX:  number; projUL:  number; projQT: number; projQU: number; projSX: number;
  projJan: number; projFev: number; projMarProp: number;
  vendaJan: number; vendaFev: number; vendaMar: number;
  dispFutMar: number; dispFutAbr: number; dispFutMai: number; dispFutJun: number; dispFutJul: number; dispFutNov: number;
  negFutMar: number; negFutAbr: number; negFutMai: number; negFutJun: number; negFutJul: number; negFutNov: number;
  projCount: number;
  excedenteLojas: number;
}

type RefGroup  = { referencia: string; nomeRef: string; itens: Planejamento[]; totais: GrupoTotais };
type ContGroup = { continuidade: string; referencias: RefGroup[]; totais: GrupoTotais };

// Mes de um periodo. Usa o que a API mandou; se faltar (resposta antiga em cache), deriva
// de MA pelo ordinal — os rotulos sao posicionais, entao a conta e sempre a mesma.
function mesDoPeriodo(periodos: PeriodosPlano, p: PeriodoPlano): number {
  const dado = Number((periodos as unknown as Record<string, number | undefined>)[p] || 0);
  if (dado >= 1 && dado <= 12) return dado;
  const base = Number(periodos.MA || 0);
  if (!base) return 0;
  return ((base - 1 + PERIODOS_PLANO.indexOf(p)) % 12) + 1;
}

function zeradoPorPeriodo(): Record<CampoPeriodo, number> {
  return Object.fromEntries(PERIODOS_PLANO.map((p) => [campoDoPeriodo(p), 0])) as Record<CampoPeriodo, number>;
}

// Cadeia de um ITEM, periodo a periodo: plano, projecao, disponivel, negativo e cobertura.
//
// A mesma conta estava escrita duas vezes — no export CSV e nas linhas de SKU — cada uma
// com suas seis variaveis (`pMA`...`pSX`, `dMA`...`dSX`, `cobMA`...`cobSX`). Duas copias
// de seis periodos sao doze lugares para esquecer um periodo novo; viraram uma so.
type CeluladoPeriodo = { plano: number; proj: number; disp: number; neg: number; cob: number | null };

function cadeiaDoItem(
  item: Planejamento,
  proj: Record<string, number> | null,
  periodos: PeriodosPlano,
): Record<CampoPeriodo, CeluladoPeriodo> {
  const dispAtual = (item.estoques.estoque_atual || 0) - (item.demanda.pedidos_pendentes || 0);
  const min = item.estoques.estoque_minimo || 0;
  let corrente = dispAtual + (item.estoques.em_processo || 0);
  const out = {} as Record<CampoPeriodo, CeluladoPeriodo>;
  for (const p of PERIODOS_PLANO) {
    const campo = campoDoPeriodo(p);
    const mes = mesDoPeriodo(periodos, p);
    const plano = Number((item.plano as unknown as Record<string, number> | undefined)?.[campo] || 0);
    // So o mes corrente e pro-rata: dele ja passou parte, e o plano cobre o que falta.
    const projetado = !proj ? 0
      : p === 'MA' ? projecaoMesPlanejamento((proj[String(mes)] ?? 0), mes) : (proj[String(mes)] ?? 0);
    corrente = corrente + plano - projetado;
    out[campo] = {
      plano,
      proj: projetado,
      disp: corrente,
      neg: corrente < 0 ? Math.abs(corrente) : 0,
      cob: min > 0 ? Number((corrente / min).toFixed(2)) : null,
    };
  }
  return out;
}

function somar(
  itens: Planejamento[],
  projecoes: ProjecoesMap,
  vendasReais: Record<string, Record<string, number>>,
  periodos: PeriodosPlano,
  excedentesLojas: Map<number, EstoqueLojaDisponivelAggregado> | null = null,
  taxaMeses: [TaxaMes, TaxaMes, TaxaMes] = taxaMesesDefault()
): GrupoTotais {
  // Os NOVE periodos num laco, em vez de seis variaveis escritas a mao (`pMA`...`pSX`,
  // `dMar`...`dNov`). Era essa lista fixa que deixava ST, OT e NV fora da Cobertura do
  // Plano mesmo depois de o Fagner os implantar no ERP.
  const mesPorPeriodo = Object.fromEntries(
    PERIODOS_PLANO.map((p) => [p, mesDoPeriodo(periodos, p)])
  ) as Record<PeriodoPlano, number>;

  const acc: GrupoTotais = {
    estoque: 0, emProcesso: 0, estoqueMin: 0, pedidos: 0, disponivel: 0, disponivelPosProcesso: 0,
    deficit: 0, deficitPosProcesso: 0, abaixo: 0,
    plano: zeradoPorPeriodo(), proj: zeradoPorPeriodo(), dispFut: zeradoPorPeriodo(), negFut: zeradoPorPeriodo(),
    planoMA: 0, planoPX: 0, planoUL: 0, planoQT: 0, planoQU: 0, planoSX: 0,
    projMA: 0, projPX: 0, projUL: 0, projQT: 0, projQU: 0, projSX: 0,
    projJan: 0, projFev: 0, projMarProp: 0, vendaJan: 0, vendaFev: 0, vendaMar: 0,
    dispFutMar: 0, dispFutAbr: 0, dispFutMai: 0, dispFutJun: 0, dispFutJul: 0, dispFutNov: 0,
    negFutMar: 0, negFutAbr: 0, negFutMai: 0, negFutJun: 0, negFutJul: 0, negFutNov: 0,
    projCount: 0, excedenteLojas: 0,
  };

  for (const i of itens) {
    const disp = (i.estoques.estoque_atual || 0) - (i.demanda.pedidos_pendentes || 0);
    const proj = projecoes[i.produto.idproduto] ?? null;
    const real = vendasReais[i.produto.idproduto] ?? null;
    const hasProj = proj !== null;
    const emP = i.estoques.em_processo || 0;
    const dispPosProcesso = disp + emP;

    acc.estoque += (i.estoques.estoque_atual || 0);
    acc.emProcesso += emP;
    acc.estoqueMin += (i.estoques.estoque_minimo || 0);
    acc.pedidos += (i.demanda.pedidos_pendentes || 0);
    acc.disponivel += disp > 0 ? disp : 0;
    acc.disponivelPosProcesso += dispPosProcesso > 0 ? dispPosProcesso : 0;
    acc.deficit += disp < 0 ? disp : 0;
    acc.deficitPosProcesso += dispPosProcesso < 0 ? dispPosProcesso : 0;
    acc.abaixo += disp >= 0 && disp < (i.estoques.estoque_minimo || 0) ? 1 : 0;

    // Cadeia do disponivel: parte do estoque de hoje com o processo e, periodo a periodo,
    // soma o plano e tira a projecao. So o MES CORRENTE e pro-rata — dele ja passou parte.
    let corrente = hasProj ? disp + emP : 0;
    for (const p of PERIODOS_PLANO) {
      const campo = campoDoPeriodo(p);
      const mes = mesPorPeriodo[p];
      const plano = Number((i.plano as unknown as Record<string, number> | undefined)?.[campo] || 0);
      const projetado = !hasProj ? 0
        : p === 'MA'
          ? projecaoMesPlanejamento((proj[String(mes)] ?? 0), mes)
          : (proj[String(mes)] ?? 0);
      acc.plano[campo] += plano;
      acc.proj[campo] += projetado;
      if (hasProj) {
        corrente = corrente + plano - projetado;
        acc.dispFut[campo] += corrente;
        acc.negFut[campo] += corrente < 0 ? Math.abs(corrente) : 0;
      }
    }

    acc.projJan += hasProj ? (proj[String(taxaMeses[0].mes)] ?? 0) : 0;
    acc.projFev += hasProj ? (proj[String(taxaMeses[1].mes)] ?? 0) : 0;
    acc.projMarProp += hasProj ? (proj[String(taxaMeses[2].mes)] ?? 0) : 0;
    acc.vendaJan += real ? (real[String(taxaMeses[0].mes)] ?? 0) : 0;
    acc.vendaFev += real ? (real[String(taxaMeses[1].mes)] ?? 0) : 0;
    acc.vendaMar += real ? (real[String(taxaMeses[2].mes)] ?? 0) : 0;
    acc.projCount += hasProj ? 1 : 0;
    acc.excedenteLojas += excedentesLojas?.get(Number(i.produto.idproduto))?.qtd_disponivel_total || 0;
  }

  // Aliases legados, DERIVADOS dos mapas — uma fonte so. Os nomes de mes (`dispFutMar`,
  // `dispFutNov`) sao posicionais e seguem assim para nao quebrar quem ja os le.
  acc.planoMA = acc.plano.ma; acc.planoPX = acc.plano.px; acc.planoUL = acc.plano.ul;
  acc.planoQT = acc.plano.qt; acc.planoQU = acc.plano.qu; acc.planoSX = acc.plano.sx;
  acc.projMA = acc.proj.ma; acc.projPX = acc.proj.px; acc.projUL = acc.proj.ul;
  acc.projQT = acc.proj.qt; acc.projQU = acc.proj.qu; acc.projSX = acc.proj.sx;
  acc.dispFutMar = acc.dispFut.ma; acc.dispFutAbr = acc.dispFut.px; acc.dispFutMai = acc.dispFut.ul;
  acc.dispFutJun = acc.dispFut.qt; acc.dispFutJul = acc.dispFut.qu; acc.dispFutNov = acc.dispFut.sx;
  acc.negFutMar = acc.negFut.ma; acc.negFutAbr = acc.negFut.px; acc.negFutMai = acc.negFut.ul;
  acc.negFutJun = acc.negFut.qt; acc.negFutJul = acc.negFut.qu; acc.negFutNov = acc.negFut.sx;
  return acc;
}

function agrupar(
  dados: Planejamento[],
  projecoes: ProjecoesMap,
  vendasReais: Record<string, Record<string, number>>,
  periodos: PeriodosPlano,
  excedentesLojas: Map<number, EstoqueLojaDisponivelAggregado> | null = null,
  taxaMeses: [TaxaMes, TaxaMes, TaxaMes] = taxaMesesDefault()
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
          return { referencia, nomeRef: raw[0]?.produto?.produto || '', itens, totais: somar(itens, projecoes, vendasReais, periodos, excedentesLojas, taxaMeses) };
        })
        .sort((a, b) => a.referencia.localeCompare(b.referencia));
      return { continuidade, referencias, totais: somar(referencias.flatMap(r => r.itens), projecoes, vendasReais, periodos, excedentesLojas, taxaMeses) };
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

function planoRiskClass(baseClass: string, flagged: boolean) {
  return flagged ? `${baseClass} bg-orange-200/80 ring-1 ring-inset ring-orange-300` : baseClass;
}

// â”€â”€â”€ Cells â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Regra de cor: texto escuro (gray-800) no claro, claro (gray-100) no escuro.
// Cor só para alertas: vermelho = déficit, âmbar = abaixo do mínimo.

const D  = 'text-gray-800';  // normal light-bg
const DK = 'text-gray-100';  // normal dark-bg
const MT = 'text-gray-400';  // muted light-bg
const MK = 'text-gray-500';  // muted dark-bg
const dash = (dark: boolean) => <span className={dark ? MK : MT}>—</span>;

function BadgeSit({ t }: { t: GrupoTotais }) {
  if (t.deficit < 0) return <span className="ml-1.5 px-1.5 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-700">déficit</span>;
  if (t.abaixo > 0)  return <span className="ml-1.5 px-1.5 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-700">{t.abaixo} abaixo</span>;
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

function CellPlano({ v, dark = false, onClick, title }: { v: number; dark?: boolean; onClick?: () => void; title?: string }) {
  if (v <= 0) return dash(dark);
  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className={`font-semibold ${dark ? DK : D} hover:underline hover:text-teal-600 cursor-pointer transition-colors`}
        title={title || "Clique para verificar MPs"}
      >
        {fmt(v)}
      </button>
    );
  }
  return <span className={`font-semibold ${dark ? DK : D}`} title={title}>{fmt(v)}</span>;
}

function CellDispFut({ v, min, dark = false }: { v: number | null; min: number; dark?: boolean }) {
  if (v === null) return dash(dark);
  if (v < 0)     return <span className={`font-bold     ${dark ? 'text-red-400'   : 'text-red-600'}`}>{fmt(v)}</span>;
  return <span className={`font-semibold ${dark ? DK : D}`}>{fmt(v)}</span>;
}

function CellCobFut({ v, min, dark = false }: { v: number | null; min: number; dark?: boolean }) {
  if (v === null || min <= 0) return dash(dark);
  const c = v / min;
  const s = c.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'x';
  if (c < 0)   return <span className={`font-bold     ${dark ? 'text-red-400'   : 'text-red-600'}`}>{s}</span>;
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

// â”€â”€â”€ Props â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface Props {
  dados:        Planejamento[];
  filtroTexto?: string;
  projecoes?:   ProjecoesMap;
  vendasReais?: Record<string, Record<string, number>>;
  periodos?:    PeriodosPlano;
  apenasNegativos?: boolean;
  filtroNegativoPeriodo?: 'TODOS' | 'ATUAL' | 'MA' | 'PX' | 'UL' | 'QT' | 'QU' | 'SX';
  filtroContinuidade?: string | string[];
  filtroReferencia?: string;
  filtroCor?: string;
  filtroCobertura?: 'TODAS' | 'NEGATIVA' | 'ZERO_UM' | 'MAIOR_UM' | 'MAIOR_2';
  filtroCoberturaBase?: 'ATUAL' | 'MA' | 'PX' | 'UL' | 'QT' | 'QU' | 'SX';
  filtroTaxa?: 'TODAS' | 'ATE_70';
  excedentesLojas?: Map<number, EstoqueLojaDisponivelAggregado> | null;
  filtroCoberturaMinima?: string;
  filtroEmProcessoMinimo?: string;
  curvaABC?: Record<string, 'A' | 'B' | 'C' | 'D'>;
  taxaMeses?: [TaxaMes, TaxaMes, TaxaMes];
  riscoMpPorSku?: Record<string, { ma: boolean; px: boolean; ul: boolean; qt: boolean; qu: boolean; sx: boolean }>;
  detalheRiscoMpPorSku?: Record<string, {
    ma: { em_risco: boolean; quantidade_mps: number; principal_mp: null | { idmateriaprima: string; nome: string; artigo: string; saldo: number; falta: number } };
    px: { em_risco: boolean; quantidade_mps: number; principal_mp: null | { idmateriaprima: string; nome: string; artigo: string; saldo: number; falta: number } };
    ul: { em_risco: boolean; quantidade_mps: number; principal_mp: null | { idmateriaprima: string; nome: string; artigo: string; saldo: number; falta: number } };
    qt: { em_risco: boolean; quantidade_mps: number; principal_mp: null | { idmateriaprima: string; nome: string; artigo: string; saldo: number; falta: number } };
    qu: { em_risco: boolean; quantidade_mps: number; principal_mp: null | { idmateriaprima: string; nome: string; artigo: string; saldo: number; falta: number } };
    sx: { em_risco: boolean; quantidade_mps: number; principal_mp: null | { idmateriaprima: string; nome: string; artigo: string; saldo: number; falta: number } };
  }>;
  /** Fonte maior, comandada pela tela principal. A classe CSS vem do container da página;
   *  aqui ela só alarga a tabela, para as colunas não se espremerem com a letra maior. */
  fonteConfortavel?: boolean;
  /** Devolve os totais por continuidade já filtrados, para a página mostrar o quadro no topo. */
  onTotaisContinuidade?: (totais: { continuidade: string; totais: GrupoTotais }[]) => void;
}

// â”€â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function MatrizPlanejamentoTable({
  dados,
  filtroTexto = '',
  projecoes   = {},
  vendasReais = {},
  periodos    = { MA: new Date().getMonth() + 1, PX: new Date().getMonth() + 2, UL: new Date().getMonth() + 3, QT: new Date().getMonth() + 4, QU: new Date().getMonth() + 5 },
  apenasNegativos = false,
  filtroNegativoPeriodo = 'TODOS',
  filtroContinuidade = [],
  filtroReferencia = '',
  filtroCor = 'TODAS',
  filtroCobertura = 'TODAS',
  filtroCoberturaBase = 'ATUAL',
  filtroTaxa = 'TODAS',
  excedentesLojas = null,
  filtroCoberturaMinima = '',
  filtroEmProcessoMinimo = '',
  curvaABC = {},
  taxaMeses = taxaMesesDefault(),
  riscoMpPorSku = {},
  detalheRiscoMpPorSku = {},
  fonteConfortavel = false,
  onTotaisContinuidade,
}: Props) {
  // As chaves de ordenacao por periodo saem da LISTA, por tipo de template. Antes eram 24
  // literais escritas a mao que paravam em SX — clicar numa coluna de abril, maio ou junho
  // nem compilaria.
  type SortKey =
    | 'estoque' | 'emProcesso' | 'estoqueMin' | 'pedidos' | 'disponivel' | 'negativo' | 'negativoPosProcesso' | 'cobertura'
    | 'taxaJan' | 'taxaFev' | 'taxaMar'
    | `proj${PeriodoPlano}` | `plano${PeriodoPlano}` | `disp${PeriodoPlano}` | `cob${PeriodoPlano}`;

  const [expandedConts, setExpandedConts] = useState<Set<string>>(new Set());
  const [expandedRefs,  setExpandedRefs ] = useState<Set<string>>(new Set());
  // padrão: disponível do mês corrente do plano, do maior para o menor
  const [sortKey, setSortKey] = useState<SortKey>('dispMA');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [mostrarDetalhes, setMostrarDetalhes] = useState(true);

  useEffect(() => {
    const salvo = localStorage.getItem('pp_matriz_colunas_detalhe');
    if (salvo !== null) setMostrarDetalhes(salvo === '1');
  }, []);

  function alternarDetalhes() {
    setMostrarDetalhes((atual) => {
      const novo = !atual;
      localStorage.setItem('pp_matriz_colunas_detalhe', novo ? '1' : '0');
      return novo;
    });
  }

  const taxaLabels = taxaMeses.map((m) => m.label.charAt(0).toUpperCase() + m.label.slice(1)) as [string, string, string];

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

  // Modal de Verificação de MP
  type MpCheckItem = {
    idmateriaprima: string;
    nome: string;
    artigo: string;
    qtd_por_unidade: number;
    estoque: number;
    entrada_periodo: number;
    consumo_consolidado: number;
    saldo_periodo: number;
    status: 'OK' | 'FALTA';
    deficit: number;
  };
  const [modalCheckMp, setModalCheckMp] = useState<{
    open: boolean;
    idproduto: string;
    referencia: string;
    cor: string;
    tamanho: string;
    mes: string;
    mesNome: string;
    planoQtd: number;
    loading: boolean;
    error: string | null;
    materiasprimas: MpCheckItem[];
    resumo: { total: number; em_risco: number; ok: number };
  }>({ open: false, idproduto: '', referencia: '', cor: '', tamanho: '', mes: 'ma', mesNome: '', planoQtd: 0, loading: false, error: null, materiasprimas: [], resumo: { total: 0, em_risco: 0, ok: 0 } });

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

  const abrirModalCheckMp = async (
    idproduto: string,
    referencia: string,
    cor: string,
    tamanho: string,
    mes: CampoPeriodo,
    mesNome: string,
    planoQtd: number
  ) => {
    setModalCheckMp({
      open: true, idproduto, referencia, cor, tamanho, mes, mesNome, planoQtd,
      loading: true, error: null, materiasprimas: [], resumo: { total: 0, em_risco: 0, ok: 0 },
    });
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      // Montar planos de todos os produtos para cálculo consolidado
      const planos = dados.map((d) => ({
        idproduto: String(d.produto.idproduto),
        idreferencia: d.produto.referencia || '',
        ma: d.plano?.ma || 0,
        px: d.plano?.px || 0,
        ul: d.plano?.ul || 0,
        qt: d.plano?.qt || 0,
        qu: d.plano?.qu || 0,
      }));
      const res = await fetch(`${API_URL}/api/consumo-mp/check-produto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idproduto, mes, planos }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao verificar MPs');
      setModalCheckMp((prev) => ({
        ...prev,
        loading: false,
        materiasprimas: json.materiasprimas || [],
        resumo: json.resumo || { total: 0, em_risco: 0, ok: 0 },
      }));
    } catch (e) {
      setModalCheckMp((prev) => ({ ...prev, loading: false, error: e instanceof Error ? e.message : 'Erro desconhecido' }));
    }
  };

  const fecharModalCheckMp = () => setModalCheckMp({
    open: false, idproduto: '', referencia: '', cor: '', tamanho: '', mes: 'ma', mesNome: '', planoQtd: 0,
    loading: false, error: null, materiasprimas: [], resumo: { total: 0, em_risco: 0, ok: 0 },
  });

  const modalCheckMpProblemas = useMemo(
    () => modalCheckMp.materiasprimas.filter((mp) => mp.status === 'FALTA' || Number(mp.deficit || 0) > 0 || Number(mp.saldo_periodo || 0) < 0),
    [modalCheckMp.materiasprimas]
  );

  const mesQT = useMemo(() => periodos.QT ?? (((periodos.UL || 1) - 1 + 1) % 12) + 1, [periodos.QT, periodos.UL]);
  const mesQU = useMemo(() => periodos.QU ?? ((mesQT % 12) + 1), [periodos.QU, mesQT]);
  const mesSX = useMemo(() => ((mesQU % 12) + 1), [mesQU]);

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
        const pQU  = i.plano?.qu || 0;
        const prMA = proj ? projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA) : 0;
        const prPX = proj ? (proj[String(periodos.PX)] ?? 0) : 0;
        const prUL = proj ? (proj[String(periodos.UL)] ?? 0) : 0;
        const prQT = proj ? (proj[String(mesQT)] ?? 0) : 0;
        const prQU = proj ? (proj[String(mesQU)] ?? 0) : 0;
        const dispMA = dispAtual + emP + pMA - prMA;
        const dispPX = dispMA + pPX - prPX;
        const dispUL = dispPX + pUL - prUL;
        const dispQT = dispUL + pQT - prQT;
        const dispQU = dispQT + pQU - prQU;
        const disp =
          filtroCoberturaBase === 'MA' ? dispMA :
          filtroCoberturaBase === 'PX' ? dispPX :
          filtroCoberturaBase === 'UL' ? dispUL :
          filtroCoberturaBase === 'QT' ? dispQT :
          filtroCoberturaBase === 'QU' ? dispQU :
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
        const projJan = proj ? (proj[String(taxaMeses[0].mes)] ?? 0) : 0;
        const projFev = proj ? (proj[String(taxaMeses[1].mes)] ?? 0) : 0;
        const vendaJan = real ? (real[String(taxaMeses[0].mes)] ?? 0) : 0;
        const vendaFev = real ? (real[String(taxaMeses[1].mes)] ?? 0) : 0;
        if (projJan <= 0 || projFev <= 0) return false;
        const taxaJan = vendaJan / projJan;
        const taxaFev = vendaFev / projFev;
        return taxaJan <= 0.7 && taxaFev <= 0.7;
      });
    }

    // Filtro customizado por cobertura mÃ­nima (SEM considerar em_processo)
    if (filtroCoberturaMinima.trim()) {
      const valorCobertura = parseFloat(filtroCoberturaMinima);
      console.log('[TABELA] Filtro cobertura recebido:', filtroCoberturaMinima, 'valor:', valorCobertura);
      console.log('[TABELA] Base ANTES do filtro:', base.length, 'produtos');
      if (!isNaN(valorCobertura)) {
        base = base.filter((i) => {
          // Cobertura ATUAL = (estoque - pedidos) / estoque_minimo
          // NÃƒO inclui em_processo pois queremos saber o que NÃƒO precisa produzir
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

    // Filtro customizado por em processo mÃ­nimo
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

        // Se filtro por periodo ATUAL, verificar apenas o disponivel atual
        if (filtroNegativoPeriodo === 'ATUAL') {
          return dispAtual < 0;
        }

        if (!proj) return dispAtual < 0;

        const emP  = i.estoques.em_processo || 0;
        const pMA  = i.plano?.ma || 0;
        const pPX  = i.plano?.px || 0;
        const pUL  = i.plano?.ul || 0;
        const pQT  = i.plano?.qt || 0;
        const pQU  = i.plano?.qu || 0;
        const prMA = projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA);
        const prPX = proj[String(periodos.PX)] ?? 0;
        const prUL = proj[String(periodos.UL)] ?? 0;
        const prQT = proj[String(mesQT)] ?? 0;
        const prQU = proj[String(mesQU)] ?? 0;
        const dispMA = dispAtual + emP + pMA - prMA;
        const dispPX = dispMA + pPX - prPX;
        const dispUL = dispPX + pUL - prUL;
        const dispQT = dispUL + pQT - prQT;
        const dispQU = dispQT + pQU - prQU;

        // Filtrar por periodo especifico
        if (filtroNegativoPeriodo === 'MA') return dispMA < 0;
        if (filtroNegativoPeriodo === 'PX') return dispPX < 0;
        if (filtroNegativoPeriodo === 'UL') return dispUL < 0;
        if (filtroNegativoPeriodo === 'QT') return dispQT < 0;
        if (filtroNegativoPeriodo === 'QU') return dispQU < 0;

        // TODOS: qualquer periodo negativo
        return dispAtual < 0 || dispMA < 0 || dispPX < 0 || dispUL < 0 || dispQT < 0 || dispQU < 0;
      });
    }
    const grouped = agrupar(base, projecoes, vendasReais, periodos, excedentesLojas, taxaMeses);

    const sortFactor = sortDir === 'asc' ? 1 : -1;

    // Ordenacao por periodo resolvida pelo PREFIXO da chave, nao por 24 `case` escritos a
    // mao que paravam em SX. Clicar numa coluna de abril, maio ou junho caia fora do
    // switch e devolvia `undefined`, o que no comparador vira NaN e embaralha a tabela.
    const metricaPorPeriodo = (key: SortKey) => {
      const m = /^(proj|plano|disp|cob)(MA|PX|UL|QT|QU|SX|ST|OT|NV)$/.exec(key);
      return m ? { tipo: m[1] as 'proj' | 'plano' | 'disp' | 'cob', campo: campoDoPeriodo(m[2] as PeriodoPlano) } : null;
    };

    const refMetric = (t: GrupoTotais, key: SortKey): number => {
      const porPeriodo = metricaPorPeriodo(key);
      if (porPeriodo) {
        const { tipo, campo } = porPeriodo;
        if (tipo === 'proj') return t.proj[campo];
        if (tipo === 'plano') return t.plano[campo];
        if (tipo === 'disp') return t.dispFut[campo];
        return t.estoqueMin > 0 ? t.dispFut[campo] / t.estoqueMin : Number.NEGATIVE_INFINITY;
      }
      switch (key) {
        case 'estoque': return t.estoque;
        case 'emProcesso': return t.emProcesso;
        case 'estoqueMin': return t.estoqueMin;
        case 'pedidos': return t.pedidos;
        case 'disponivel': return t.disponivel;
        case 'negativo': return Math.abs(t.deficit);
        case 'negativoPosProcesso': return Math.abs(t.deficitPosProcesso);
        case 'cobertura': return t.estoqueMin > 0 ? t.disponivel / t.estoqueMin : Number.NEGATIVE_INFINITY;
        case 'taxaJan': return t.projJan > 0 ? t.vendaJan / t.projJan : Number.NEGATIVE_INFINITY;
        case 'taxaFev': return t.projFev > 0 ? t.vendaFev / t.projFev : Number.NEGATIVE_INFINITY;
        case 'taxaMar': return t.projMarProp > 0 ? t.vendaMar / t.projMarProp : Number.NEGATIVE_INFINITY;
        default: return Number.NEGATIVE_INFINITY;
      }
    };

    const itemMetric = (i: Planejamento, key: SortKey): number => {
      const disp = (i.estoques.estoque_atual || 0) - (i.demanda.pedidos_pendentes || 0);
      const proj = projecoes[i.produto.idproduto] ?? null;
      const real = vendasReais[i.produto.idproduto] ?? null;
      const emP = i.estoques.em_processo || 0;
      const min = i.estoques.estoque_minimo || 0;
      const dispPosProcesso = disp + emP;

      const porPeriodo = metricaPorPeriodo(key);
      if (porPeriodo) {
        // Mesma cadeia que a tabela e o CSV usam, para os tres nunca divergirem.
        const x = cadeiaDoItem(i, proj, periodos)[porPeriodo.campo];
        if (porPeriodo.tipo === 'proj') return x.proj;
        if (porPeriodo.tipo === 'plano') return x.plano;
        if (porPeriodo.tipo === 'disp') return x.disp;
        return min > 0 ? x.disp / min : Number.NEGATIVE_INFINITY;
      }

      const prJan = proj ? (proj[String(taxaMeses[0].mes)] ?? 0) : 0;
      const prFev = proj ? (proj[String(taxaMeses[1].mes)] ?? 0) : 0;
      const prMar = proj ? (proj[String(taxaMeses[2].mes)] ?? 0) : 0;
      const vdJan = real ? (real[String(taxaMeses[0].mes)] ?? 0) : 0;
      const vdFev = real ? (real[String(taxaMeses[1].mes)] ?? 0) : 0;
      const vdMar = real ? (real[String(taxaMeses[2].mes)] ?? 0) : 0;

      switch (key) {
        case 'estoque': return i.estoques.estoque_atual || 0;
        case 'emProcesso': return emP;
        case 'estoqueMin': return min;
        case 'pedidos': return i.demanda.pedidos_pendentes || 0;
        case 'disponivel': return disp;
        case 'negativo': return disp < 0 ? Math.abs(disp) : 0;
        case 'negativoPosProcesso': return dispPosProcesso < 0 ? Math.abs(dispPosProcesso) : 0;
        case 'cobertura': return min > 0 ? disp / min : Number.NEGATIVE_INFINITY;
        case 'taxaJan': return prJan > 0 ? vdJan / prJan : Number.NEGATIVE_INFINITY;
        case 'taxaFev': return prFev > 0 ? vdFev / prFev : Number.NEGATIVE_INFINITY;
        case 'taxaMar': return prMar > 0 ? vdMar / prMar : Number.NEGATIVE_INFINITY;
        default: return Number.NEGATIVE_INFINITY;
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
  }, [dados, filtroTexto, projecoes, vendasReais, periodos, apenasNegativos, filtroNegativoPeriodo, filtroContinuidade, filtroReferencia, filtroCor, filtroCobertura, filtroCoberturaBase, filtroTaxa, filtroCoberturaMinima, filtroEmProcessoMinimo, sortKey, sortDir, mesQT, mesQU, taxaMeses, excedentesLojas]);

  // Depende só de `grupos` de propósito: se dependesse do callback (recriado a cada render
  // do pai), o efeito re-dispararia em loop com o setState do pai.
  useEffect(() => {
    onTotaisContinuidade?.(grupos.map((g) => ({ continuidade: g.continuidade, totais: g.totais })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupos]);

  useEffect(() => {
    if (grupos.length === 0) return;
    // A matriz abre sempre fechada: quem quiser ver o detalhe usa "Expandir tudo" ou clica no grupo.
    setExpandedConts(new Set());
    setExpandedRefs(new Set());
  }, [grupos.length > 0 ? grupos[0].continuidade : '']);

  const totalItens   = grupos.reduce((a, g) => a + g.referencias.reduce((b, r) => b + r.itens.length, 0), 0);
  const temProjecoes = Object.keys(projecoes).length > 0;

  function tooltipRiscoSku(idproduto: string, periodo: CampoPeriodo) {
    // O detalhe de risco do backend ainda cobre so ma..sx. Periodo sem entrada nao tem
    // risco conhecido — vale "sem informacao", nao erro de acesso.
    const detalhe = (detalheRiscoMpPorSku[String(idproduto)] as unknown as Record<string, { em_risco: boolean; quantidade_mps: number; principal_mp: { idmateriaprima: string; nome: string; artigo: string; saldo: number; falta: number } | null }> | undefined)?.[periodo];
    if (!detalhe?.em_risco) return 'Clique para verificar MPs';
    const principal = detalhe.principal_mp;
    if (!principal) return `${detalhe.quantidade_mps} MP(s) em risco no consolidado. Clique para verificar MPs`;
    return `${detalhe.quantidade_mps} MP(s) em risco no consolidado. Principal falta: ${principal.idmateriaprima} (${fmt(principal.falta)})`;
  }

  function tooltipRiscoRef(itens: Planejamento[], periodo: 'ma' | 'px' | 'ul' | 'qt' | 'qu' | 'sx') {
    const itensComRisco = itens
      .map((item) => ({ detalhe: detalheRiscoMpPorSku[String(item.produto.idproduto)]?.[periodo] }))
      .filter((entry) => entry.detalhe?.em_risco);
    if (!itensComRisco.length) return undefined;
    const skuCount = itensComRisco.length;
    const somaMps = itensComRisco.reduce((acc, entry) => acc + (entry.detalhe?.quantidade_mps || 0), 0);
    const principal = itensComRisco
      .map((entry) => entry.detalhe?.principal_mp)
      .filter(Boolean)
      .sort((a, b) => (b!.falta - a!.falta))[0];
    if (!principal) return `${skuCount} SKU(s) com risco de MP. ${somaMps} MP(s) sinalizadas no consolidado.`;
    return `${skuCount} SKU(s) com risco de MP. ${somaMps} MP(s) sinalizadas. Principal falta: ${principal.idmateriaprima} (${fmt(principal.falta)})`;
  }

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
  // UMA COLUNA POR PERIODO DO PLANO, derivadas da lista — nove, nao seis.
  //
  // Estava tudo escrito a mao e parava em SX: os nomes de mes, os cabecalhos, as cinco
  // sub-colunas de cada mes, as celulas em tres blocos diferentes e o cabecalho do CSV.
  // Com abril, maio e junho implantados no ERP, a tabela simplesmente nao os mostrava.
  // As classes sao LITERAIS, nunca montadas (`bg-${cor}-100`): o Tailwind varre o codigo
  // em busca de nomes de classe completos e nao avalia template string, entao a cor
  // montada simplesmente nao existiria no CSS e a tabela sairia sem cor nenhuma. Nao ha
  // safelist no tailwind.config para salvar.
  const PALETA_PERIODO = [
    { sub: 'bg-indigo-50 text-indigo-800',   topo: 'bg-indigo-100 text-indigo-900 border-b border-indigo-200',   cel: 'bg-indigo-100',  sku: 'bg-indigo-50/70',  skuPlano: 'bg-indigo-50/60' },
    { sub: 'bg-emerald-50 text-emerald-800', topo: 'bg-emerald-100 text-emerald-900 border-b border-emerald-200', cel: 'bg-emerald-100', sku: 'bg-emerald-50/70', skuPlano: 'bg-emerald-50/60' },
    { sub: 'bg-amber-50 text-amber-800',     topo: 'bg-amber-100 text-amber-900 border-b border-amber-200',     cel: 'bg-amber-100',   sku: 'bg-amber-50/70',   skuPlano: 'bg-amber-50/60' },
    { sub: 'bg-cyan-50 text-cyan-800',       topo: 'bg-cyan-100 text-cyan-900 border-b border-cyan-200',       cel: 'bg-cyan-100',    sku: 'bg-cyan-50/70',    skuPlano: 'bg-cyan-50/60' },
    { sub: 'bg-rose-50 text-rose-800',       topo: 'bg-rose-100 text-rose-900 border-b border-rose-200',       cel: 'bg-rose-100',    sku: 'bg-rose-50/70',    skuPlano: 'bg-rose-50/60' },
    { sub: 'bg-purple-50 text-purple-800',   topo: 'bg-purple-100 text-purple-900 border-b border-purple-200',   cel: 'bg-purple-100',  sku: 'bg-purple-50/70',  skuPlano: 'bg-purple-50/60' },
    { sub: 'bg-teal-50 text-teal-800',       topo: 'bg-teal-100 text-teal-900 border-b border-teal-200',       cel: 'bg-teal-100',    sku: 'bg-teal-50/70',    skuPlano: 'bg-teal-50/60' },
    { sub: 'bg-orange-50 text-orange-800',   topo: 'bg-orange-100 text-orange-900 border-b border-orange-200',   cel: 'bg-orange-100',  sku: 'bg-orange-50/70',  skuPlano: 'bg-orange-50/60' },
    { sub: 'bg-slate-50 text-slate-800',     topo: 'bg-slate-100 text-slate-900 border-b border-slate-200',     cel: 'bg-slate-100',   sku: 'bg-slate-50/70',   skuPlano: 'bg-slate-50/60' },
  ];
  const COLS_PERIODO = PERIODOS_PLANO.map((periodo, k) => {
    const cores = PALETA_PERIODO[k % PALETA_PERIODO.length];
    const mes = mesDoPeriodo(periodos, periodo);
    return {
      periodo,
      campo: campoDoPeriodo(periodo),
      mes,
      nome: MESES_PT[((mes - 1) % 12) + 1],
      bgSub: cores.sub,
      bgTopo: cores.topo,
      bgCel: cores.cel,
      bgSku: cores.sku,
      bgSkuPlano: cores.skuPlano,
    };
  });
  const mNomes = COLS_PERIODO.map((c) => c.nome);

  // th style helpers
  const thBase = 'px-3 py-3.5 text-right font-semibold text-[11px] uppercase tracking-wide';
  const fmtTaxaCsv = (venda: number, proj: number) => (proj > 0 ? Number(((venda / proj) * 100).toFixed(1)) : null);

  function exportarCsvMatriz() {
    const toCsv = (v: string | number | null | undefined) => {
      const s = v === null || v === undefined ? '' : String(v);
      return `"${s.replaceAll('"', '""')}"`;
    };
    const header = [
      'continuidade', 'referencia', 'produto', 'idproduto', 'cor', 'tamanho',
      'estoque_minimo', 'estoque', 'pedidos', 'disponivel_atual', 'em_processo', 'negativo_atual', 'negativo_pos_processo', 'cobertura_atual',
      `taxa_${taxaLabels[0].toLowerCase()}_pct`, `taxa_${taxaLabels[1].toLowerCase()}_pct`, `taxa_${taxaLabels[2].toLowerCase()}_pct`,
      ...COLS_PERIODO.flatMap((c) => [`proj_${c.nome}`, `plano_${c.nome}`, `disp_${c.nome}`, `neg_${c.nome}`, `cob_${c.nome}`]),
    ];
    const rows = grupos.flatMap((g) => g.referencias.flatMap((r) => r.itens.map((item) => {
      const dispAtual = (item.estoques.estoque_atual || 0) - (item.demanda.pedidos_pendentes || 0);
      const proj = projecoes[item.produto.idproduto] ?? null;
      const real = vendasReais[item.produto.idproduto] ?? null;
      const emP = item.estoques.em_processo || 0;
      const min = item.estoques.estoque_minimo || 0;
      const cadeia = cadeiaDoItem(item, proj, periodos);
      const vendaJan = real ? (real[String(taxaMeses[0].mes)] ?? 0) : 0;
      const vendaFev = real ? (real[String(taxaMeses[1].mes)] ?? 0) : 0;
      const vendaMar = real ? (real[String(taxaMeses[2].mes)] ?? 0) : 0;
      const projJan = proj ? (proj[String(taxaMeses[0].mes)] ?? 0) : 0;
      const projFev = proj ? (proj[String(taxaMeses[1].mes)] ?? 0) : 0;
      const projMar = proj ? (proj[String(taxaMeses[2].mes)] ?? 0) : 0;
      const dispPosProcesso = dispAtual + emP;
      const cobAtual = min > 0 ? Number((dispAtual / min).toFixed(2)) : null;

      return [
        g.continuidade,
        item.produto.referencia || '',
        item.produto.produto || '',
        item.produto.idproduto || '',
        item.produto.cor || '',
        item.produto.tamanho || '',
        Number(min),
        Number(item.estoques.estoque_atual || 0),
        Number(item.demanda.pedidos_pendentes || 0),
        Number(dispAtual),
        Number(emP),
        dispAtual < 0 ? Math.abs(dispAtual) : 0,
        dispPosProcesso < 0 ? Math.abs(dispPosProcesso) : 0,
        cobAtual,
        fmtTaxaCsv(vendaJan, projJan),
        fmtTaxaCsv(vendaFev, projFev),
        fmtTaxaCsv(vendaMar, projMar),
        ...COLS_PERIODO.flatMap((c) => {
          const x = cadeia[c.campo];
          return [Number(x.proj), Number(x.plano), Number(x.disp), x.neg, x.cob];
        }),
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
      <div className="flex items-center justify-between px-3 py-3.5 border-b border-gray-100 bg-gray-50/80 text-[13px] text-gray-500">
        <span className="font-medium">{totalItens.toLocaleString('pt-BR')} itens · {grupos.length} continuidades</span>
        <div className="flex gap-4">
          <button onClick={alternarDetalhes} className="text-gray-500 hover:text-gray-700 font-medium">
            {mostrarDetalhes ? 'Ocultar colunas de estoque' : 'Mostrar colunas de estoque'}
          </button>
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
        <table className={`${mostrarDetalhes
            ? (fonteConfortavel ? 'min-w-[3300px]' : 'min-w-[3040px]')
            : (fonteConfortavel ? 'min-w-[2060px]' : 'min-w-[1900px]')} border-collapse text-[13px]`}>

          <thead className="sticky top-0 z-30">
            {temProjecoes ? (
              <>
                {/* Row 1 â€” group labels */}
                <tr className="bg-gray-100 text-gray-600 text-[12px] font-semibold uppercase tracking-wide">
                  <th rowSpan={2} className="sticky left-0 z-40 px-2 py-2.5 text-left w-[240px] min-w-[240px] max-w-[240px] border-b border-gray-200 bg-gray-100 shadow-[1px_0_0_0_rgba(55,65,81,0.5)]">Referência / Produto</th>
                  {mostrarDetalhes && (<>
                  <th rowSpan={2} className="px-2 py-2.5 text-center border-b border-gray-200 bg-gray-100 w-[50px]">Curva</th>
                  <th rowSpan={2} onClick={() => onSortClick('estoqueMin')} className="px-3 py-3.5 text-right border-b border-gray-200 bg-gray-100 cursor-pointer">Est. Mín.{sortBadge('estoqueMin')}</th>
                  <th rowSpan={2} onClick={() => onSortClick('estoque')} className="px-3 py-3.5 text-right border-b border-gray-200 bg-gray-100 cursor-pointer">Estoque{sortBadge('estoque')}</th>
                  <th rowSpan={2} onClick={() => onSortClick('pedidos')} className="px-3 py-3.5 text-right border-b border-gray-200 bg-gray-100 cursor-pointer">Pedidos{sortBadge('pedidos')}</th>
                  <th rowSpan={2} onClick={() => onSortClick('disponivel')} className="px-3 py-3.5 text-right border-b border-gray-200 bg-gray-100 cursor-pointer">Disponível{sortBadge('disponivel')}</th>
                  <th rowSpan={2} onClick={() => onSortClick('emProcesso')} className="px-3 py-3.5 text-right border-b border-gray-200 bg-gray-100 cursor-pointer">Em Proc.{sortBadge('emProcesso')}</th>
                  {excedentesLojas && excedentesLojas.size > 0 && (
                    <th rowSpan={2} className="px-3 py-3.5 text-right border-b border-gray-200 bg-purple-50 text-purple-800">Estq. Lojas</th>
                  )}
                  <th rowSpan={2} onClick={() => onSortClick('negativo')} className="px-3 py-3.5 text-right border-b border-gray-200 bg-gray-100 cursor-pointer">Negativo{sortBadge('negativo')}</th>
                  <th rowSpan={2} onClick={() => onSortClick('negativoPosProcesso')} className="px-3 py-3.5 text-right border-b border-gray-200 bg-gray-100 cursor-pointer">Neg. Pós Proc.{sortBadge('negativoPosProcesso')}</th>
                  <th rowSpan={2} onClick={() => onSortClick('cobertura')} className="px-3 py-3.5 text-right border-b border-gray-200 bg-gray-100 cursor-pointer">Cobertura{sortBadge('cobertura')}</th>
                  <th rowSpan={2} onClick={() => onSortClick('taxaJan')} className="px-3 py-3.5 text-right border-b border-gray-200 bg-gray-100 cursor-pointer">{taxaLabels[0]}{sortBadge('taxaJan')}</th>
                  <th rowSpan={2} onClick={() => onSortClick('taxaFev')} className="px-3 py-3.5 text-right border-b border-gray-200 bg-gray-100 cursor-pointer">{taxaLabels[1]}{sortBadge('taxaFev')}</th>
                  <th rowSpan={2} onClick={() => onSortClick('taxaMar')} className="px-3 py-3.5 text-right border-b border-gray-200 bg-gray-100 cursor-pointer">{taxaLabels[2]}{sortBadge('taxaMar')}</th>
                  </>)}
                  {COLS_PERIODO.map((c) => (
                    <th key={c.periodo} colSpan={5} className={`px-3 py-3.5 text-center font-bold ${c.bgTopo}`}>{c.nome}</th>
                  ))}
                </tr>
                {/* Row 2 â€” sub-headers */}
                <tr className="text-gray-600">
                  {COLS_PERIODO.flatMap((c) => ([
                    { bg: c.bgSub, label: 'Proj.', key: `proj${c.periodo}` as SortKey },
                    { bg: c.bgSub, label: 'Plano', key: `plano${c.periodo}` as SortKey },
                    { bg: c.bgSub, label: 'Disp.', key: `disp${c.periodo}` as SortKey },
                    { bg: c.bgSub, label: 'Neg.', key: `disp${c.periodo}` as SortKey },
                    { bg: c.bgSub, label: 'Cob.', key: `cob${c.periodo}` as SortKey },
                  ])).map((h, i) => (
                    <th key={i} onClick={() => onSortClick(h.key)} className={`${thBase} ${h.bg} border-b border-gray-200 cursor-pointer`}>
                      {h.label}{sortBadge(h.key)}
                    </th>
                  ))}
                </tr>
              </>
            ) : (
              <tr className="bg-gray-100 text-gray-600 text-[12px] font-semibold uppercase tracking-wide">
                <th className="sticky left-0 z-40 px-2 py-2.5 text-left w-[240px] min-w-[240px] max-w-[240px] bg-gray-100 shadow-[1px_0_0_0_rgba(55,65,81,0.5)]">Referência / Produto</th>
                {mostrarDetalhes && (<>
                <th className="px-2 py-2.5 text-center bg-gray-100 w-[50px]">Curva</th>
                <th onClick={() => onSortClick('estoqueMin')} className="px-3 py-3 text-right cursor-pointer">Est. Mín.{sortBadge('estoqueMin')}</th>
                <th onClick={() => onSortClick('estoque')} className="px-3 py-3 text-right cursor-pointer">Estoque{sortBadge('estoque')}</th>
                <th onClick={() => onSortClick('pedidos')} className="px-3 py-3 text-right cursor-pointer">Pedidos{sortBadge('pedidos')}</th>
                <th onClick={() => onSortClick('disponivel')} className="px-3 py-3 text-right cursor-pointer">Disponível{sortBadge('disponivel')}</th>
                <th onClick={() => onSortClick('emProcesso')} className="px-3 py-3 text-right cursor-pointer">Em Proc.{sortBadge('emProcesso')}</th>
                {excedentesLojas && excedentesLojas.size > 0 && (
                  <th className="px-3 py-3 text-right bg-purple-50 text-purple-800">Estq. Lojas</th>
                )}
                <th onClick={() => onSortClick('negativo')} className="px-3 py-3 text-right cursor-pointer">Negativo{sortBadge('negativo')}</th>
                <th onClick={() => onSortClick('negativoPosProcesso')} className="px-3 py-3 text-right cursor-pointer">Neg. Pós Proc.{sortBadge('negativoPosProcesso')}</th>
                <th onClick={() => onSortClick('cobertura')} className="px-3 py-3 text-right cursor-pointer">Cobertura{sortBadge('cobertura')}</th>
                <th onClick={() => onSortClick('taxaJan')} className="px-3 py-3 text-right cursor-pointer">{taxaLabels[0]}{sortBadge('taxaJan')}</th>
                <th onClick={() => onSortClick('taxaFev')} className="px-3 py-3 text-right cursor-pointer">{taxaLabels[1]}{sortBadge('taxaFev')}</th>
                <th onClick={() => onSortClick('taxaMar')} className="px-3 py-3 text-right cursor-pointer">{taxaLabels[2]}{sortBadge('taxaMar')}</th>
                </>)}
                <th onClick={() => onSortClick('planoMA')} className="px-3 py-3 text-right bg-teal-50 text-teal-800 cursor-pointer">{mNomes[0]}{sortBadge('planoMA')}</th>
                <th onClick={() => onSortClick('planoPX')} className="px-3 py-3 text-right bg-teal-50 text-teal-800 cursor-pointer">{mNomes[1]}{sortBadge('planoPX')}</th>
                <th onClick={() => onSortClick('planoUL')} className="px-3 py-3 text-right bg-teal-50 text-teal-800 cursor-pointer">{mNomes[2]}{sortBadge('planoUL')}</th>
                <th onClick={() => onSortClick('planoQT')} className="px-3 py-3 text-right bg-teal-50 text-teal-800 cursor-pointer">{mNomes[3]}{sortBadge('planoQT')}</th>
                <th onClick={() => onSortClick('planoQU')} className="px-3 py-3 text-right bg-rose-50 text-rose-800 cursor-pointer">{mNomes[4]}{sortBadge('planoQU')}</th>
                <th onClick={() => onSortClick('planoSX')} className="px-3 py-3 text-right bg-purple-50 text-purple-800 cursor-pointer">{mNomes[5]}{sortBadge('planoSX')}</th>
              </tr>
            )}
          </thead>

          <tbody className="divide-y divide-gray-100">
            {grupos.map(grupo => {
              const contOpen = expandedConts.has(grupo.continuidade);
              const gt = grupo.totais;

              return (
                <React.Fragment key={grupo.continuidade}>

                  {/* â”€â”€ continuidade â”€â”€ */}
                  <tr
                    onClick={() => toggleCont(grupo.continuidade)}
                    className="group cursor-pointer select-none transition-colors bg-gray-100 hover:bg-gray-200"
                  >
                    <td className="sticky left-0 z-20 bg-gray-100 group-hover:bg-gray-200 px-2 py-2.5 text-brand-dark font-bold text-[12px] w-[240px] min-w-[240px] max-w-[240px] shadow-[1px_0_0_0_rgba(148,163,184,0.3)]">
                      <span className="text-brand-secondary mr-2 text-[11px]">{contOpen ? '▼' : '▶'}</span>
                      {grupo.continuidade}
                    </td>
                    {mostrarDetalhes && (<>
                    <td className="px-2 py-2.5 text-center text-gray-500 text-[11px]">—</td>
                    <td className="px-2 py-2.5 text-right text-gray-500 font-mono text-[12px] tabular-nums">{fmt(gt.estoqueMin)}</td>
                    <td className="px-2 py-2.5 text-right text-gray-800 font-mono text-[12px] tabular-nums font-semibold">{fmt(gt.estoque)}</td>
                    <td className="px-2 py-2.5 text-right font-mono text-[12px] tabular-nums">
                      {gt.pedidos > 0 ? <span className="text-brand-secondary font-semibold">{fmt(gt.pedidos)}</span> : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono text-[12px] tabular-nums font-bold">
                      <CellDisp v={gt.disponivel} min={gt.estoqueMin} />
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono text-[12px] tabular-nums">
                      {gt.emProcesso > 0 ? <span className="text-gray-800 font-semibold">{fmt(gt.emProcesso)}</span> : <span className="text-gray-400">—</span>}
                    </td>
                    {excedentesLojas && excedentesLojas.size > 0 && (
                      <td className="px-2 py-2.5 text-right font-mono text-[12px] tabular-nums bg-purple-100">
                        {gt.excedenteLojas > 0 ? <span className="text-purple-700 font-semibold">{fmt(gt.excedenteLojas)}</span> : <span className="text-gray-400">—</span>}
                      </td>
                    )}
                    <td className="px-2 py-2.5 text-right font-mono text-[12px] tabular-nums">
                      <CellNegativo v={gt.deficit} />
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono text-[12px] tabular-nums">
                      <CellNegativo v={gt.deficitPosProcesso} />
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono text-[12px] tabular-nums font-semibold">
                      <CellCob disp={gt.disponivel} min={gt.estoqueMin} />
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono text-[12px] tabular-nums"><CellTaxa venda={gt.vendaJan} proj={gt.projJan} /></td>
                    <td className="px-2 py-2.5 text-right font-mono text-[12px] tabular-nums"><CellTaxa venda={gt.vendaFev} proj={gt.projFev} /></td>
                    <td className="px-2 py-2.5 text-right font-mono text-[12px] tabular-nums"><CellTaxa venda={gt.vendaMar} proj={gt.projMarProp} /></td>
                    </>)}
                    {temProjecoes ? (
                      <>
                        {COLS_PERIODO.flatMap((c) => {
                          const cel = `px-3 py-3.5 text-right font-mono text-[13px] tabular-nums ${c.bgCel}`;
                          const vazio = <span className="text-gray-400">—</span>;
                          return [
                            <td key={`${c.periodo}-proj`} className={cel}>{gt.projCount > 0 ? <CellProj v={gt.proj[c.campo]} /> : vazio}</td>,
                            <td key={`${c.periodo}-plano`} className={cel}><CellPlano v={gt.plano[c.campo]} /></td>,
                            <td key={`${c.periodo}-disp`} className={cel}>{gt.projCount > 0 ? <CellDispFut v={gt.dispFut[c.campo]} min={gt.estoqueMin} /> : vazio}</td>,
                            <td key={`${c.periodo}-neg`} className={cel}>{gt.projCount > 0 ? <span className="text-red-700 font-semibold">{fmt(gt.negFut[c.campo])}</span> : vazio}</td>,
                            <td key={`${c.periodo}-cob`} className={cel}>{gt.projCount > 0 ? <CellCobFut v={gt.dispFut[c.campo]} min={gt.estoqueMin} /> : vazio}</td>,
                          ];
                        })}
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-3.5 text-right font-mono text-[13px] tabular-nums bg-teal-100"><CellPlano v={gt.planoMA} /></td>
                        <td className="px-3 py-3.5 text-right font-mono text-[13px] tabular-nums bg-teal-100"><CellPlano v={gt.planoPX} /></td>
                        <td className="px-3 py-3.5 text-right font-mono text-[13px] tabular-nums bg-teal-100"><CellPlano v={gt.planoUL} /></td>
                        <td className="px-3 py-3.5 text-right font-mono text-[13px] tabular-nums bg-teal-100"><CellPlano v={gt.planoQT} /></td>
                        <td className="px-3 py-3.5 text-right font-mono text-[13px] tabular-nums bg-rose-100"><CellPlano v={gt.planoQU} /></td>
                        <td className="px-3 py-3.5 text-right font-mono text-[13px] tabular-nums bg-purple-100"><CellPlano v={gt.planoSX} /></td>
                      </>
                    )}
                  </tr>

                  {contOpen && grupo.referencias.map(ref => {
                    const refKey  = `${grupo.continuidade}|${ref.referencia}`;
                    const refOpen = expandedRefs.has(refKey);
                    const rt      = ref.totais;
                    const rtSit   = rt.deficit < 0 ? 'deficit' : rt.disponivel < rt.estoqueMin ? 'abaixo' : 'ok';
                    const refRiskMa = ref.itens.some((item) => riscoMpPorSku[String(item.produto.idproduto)]?.ma);
                    const refRiskPx = ref.itens.some((item) => riscoMpPorSku[String(item.produto.idproduto)]?.px);
                    const refRiskUl = ref.itens.some((item) => riscoMpPorSku[String(item.produto.idproduto)]?.ul);
                    const refRiskQt = ref.itens.some((item) => riscoMpPorSku[String(item.produto.idproduto)]?.qt);
                    const refRiskQu = ref.itens.some((item) => riscoMpPorSku[String(item.produto.idproduto)]?.qu);

                    return (
                      <React.Fragment key={refKey}>

                        {/* â”€â”€ referÃªncia â”€â”€ */}
                        <tr
                          onClick={() => toggleRef(refKey)}
                          className={`group cursor-pointer select-none transition-colors text-[13px]
                            ${rtSit === 'deficit' ? 'bg-red-50 hover:bg-red-100 border-l-2 border-l-red-400'
                            : 'bg-slate-50 hover:bg-slate-100 border-l-2 border-l-slate-200'}`}
                        >
                          <td className={`sticky left-0 z-10 px-3 py-3.5 pl-8 font-semibold text-slate-800 w-[280px] min-w-[280px] max-w-[280px] shadow-[1px_0_0_0_rgba(148,163,184,0.25)]
                            ${rtSit === 'deficit' ? 'bg-red-50 group-hover:bg-red-100'
                            : 'bg-slate-50 group-hover:bg-slate-100'}`}
                          >
                            <span className="text-slate-400 mr-2 text-[11px]">{refOpen ? '▼' : '▶'}</span>
                            <span className="font-mono text-slate-500 mr-2 text-[12px]">{ref.referencia}</span>
                            <span
                              className="inline-block max-w-[140px] truncate align-bottom text-slate-700"
                              title={ref.nomeRef}
                            >
                              {ref.nomeRef}
                            </span>
                          </td>
                          {mostrarDetalhes && (<>
                          <td className="px-2 py-3.5 text-center">
                            {(() => {
                              const refNorm = (ref.referencia || '').trim().toUpperCase();
                              const curva = curvaABC[refNorm] || 'B';
                              const curvaClass = curva === 'A' ? 'bg-green-100 text-green-800' : curva === 'C' ? 'bg-red-100 text-red-800' : curva === 'D' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600';
                              return <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${curvaClass}`}>{curva}</span>;
                            })()}
                          </td>
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums text-slate-500">{fmt(rt.estoqueMin)}</td>
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums text-slate-700 font-semibold">{fmt(rt.estoque)}</td>
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                            {rt.pedidos > 0 ? <span className="text-gray-700 font-semibold">{fmt(rt.pedidos)}</span> : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums font-bold">
                            <CellDisp v={rt.disponivel} min={rt.estoqueMin} />
                          </td>
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                            {rt.emProcesso > 0 ? <span className="text-gray-700 font-semibold">{fmt(rt.emProcesso)}</span> : <span className="text-slate-300">—</span>}
                          </td>
                          {excedentesLojas && excedentesLojas.size > 0 && (
                            <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-purple-50">
                              {rt.excedenteLojas > 0 ? <span className="text-purple-700 font-semibold">{fmt(rt.excedenteLojas)}</span> : <span className="text-slate-300">—</span>}
                            </td>
                          )}
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                            <CellNegativo v={rt.deficit} />
                          </td>
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                            <CellNegativo v={rt.deficitPosProcesso} />
                          </td>
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums">
                            <CellCob disp={rt.disponivel} min={rt.estoqueMin} />
                          </td>
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums"><CellTaxa venda={rt.vendaJan} proj={rt.projJan} /></td>
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums"><CellTaxa venda={rt.vendaFev} proj={rt.projFev} /></td>
                          <td className="px-3 py-3.5 text-right font-mono tabular-nums"><CellTaxa venda={rt.vendaMar} proj={rt.projMarProp} /></td>
                          </>)}
                          {temProjecoes ? (
                            <>
                          {COLS_PERIODO.flatMap((c) => {
                            const cel = `px-3 py-3.5 text-right font-mono text-[13px] tabular-nums ${c.bgCel}`;
                            const vazio = <span className="text-slate-300">—</span>;
                            return [
                              <td key={`${c.periodo}-proj`} className={cel}>{rt.projCount > 0 ? <CellProj v={rt.proj[c.campo]} /> : vazio}</td>,
                              <td key={`${c.periodo}-plano`} className={cel}><CellPlano v={rt.plano[c.campo]} /></td>,
                              <td key={`${c.periodo}-disp`} className={cel}>{rt.projCount > 0 ? <CellDispFut v={rt.dispFut[c.campo]} min={rt.estoqueMin} /> : vazio}</td>,
                              <td key={`${c.periodo}-neg`} className={cel}>{rt.projCount > 0 ? <span className="text-red-700 font-semibold">{fmt(rt.negFut[c.campo])}</span> : vazio}</td>,
                              <td key={`${c.periodo}-cob`} className={cel}>{rt.projCount > 0 ? <CellCobFut v={rt.dispFut[c.campo]} min={rt.estoqueMin} /> : vazio}</td>,
                            ];
                          })}
                            </>
                          ) : (
                            <>
                              <td className={planoRiskClass("px-3 py-3.5 text-right font-mono tabular-nums bg-teal-50", refRiskMa)}><CellPlano v={rt.planoMA} title={tooltipRiscoRef(ref.itens, 'ma')} /></td>
                              <td className={planoRiskClass("px-3 py-3.5 text-right font-mono tabular-nums bg-teal-50", refRiskPx)}><CellPlano v={rt.planoPX} title={tooltipRiscoRef(ref.itens, 'px')} /></td>
                              <td className={planoRiskClass("px-3 py-3.5 text-right font-mono tabular-nums bg-teal-50", refRiskUl)}><CellPlano v={rt.planoUL} title={tooltipRiscoRef(ref.itens, 'ul')} /></td>
                              <td className={planoRiskClass("px-3 py-3.5 text-right font-mono tabular-nums bg-teal-50", refRiskQt)}><CellPlano v={rt.planoQT} title={tooltipRiscoRef(ref.itens, 'qt')} /></td>
                              <td className={planoRiskClass("px-3 py-3.5 text-right font-mono tabular-nums bg-rose-50", refRiskQu)}><CellPlano v={rt.planoQU} title={tooltipRiscoRef(ref.itens, 'qu')} /></td>
                              <td className="px-3 py-3.5 text-right font-mono tabular-nums bg-purple-50"><CellPlano v={rt.planoSX} title={tooltipRiscoRef(ref.itens, 'sx')} /></td>
                            </>
                          )}
                        </tr>

                        {/* â”€â”€ SKUs â”€â”€ */}
                        {refOpen && ref.itens.map(item => {
                          const disp    = item.estoques.estoque_atual - item.demanda.pedidos_pendentes;
                          const sit     = situacao(item.estoques.estoque_atual, item.demanda.pedidos_pendentes, item.estoques.estoque_minimo);
                          // Risco de MP por periodo. O objeto do backend ainda traz so ma..sx;
                          // periodo sem entrada vale "sem risco" em vez de quebrar o acesso.
                          const skuRiskBruto = riscoMpPorSku[String(item.produto.idproduto)] as unknown as Record<string, boolean> | undefined;
                          const riscoDoPeriodo = (campo: CampoPeriodo) => Boolean(skuRiskBruto?.[campo]);
                          const proj    = projecoes[item.produto.idproduto] ?? null;
                          const emP     = item.estoques.em_processo || 0;
                          const dispPosProcesso = disp + emP;
                          // A mesma cadeia que o CSV e a ordenacao usam.
                          const cadeia  = cadeiaDoItem(item, proj, periodos);
                          const eMin    = item.estoques.estoque_minimo;

                          return (
                            <tr
                              key={item.produto.idproduto}
                              className={`group text-[13px] transition-colors
                                ${sit === 'deficit' ? 'bg-red-50 hover:bg-red-100'
                                : 'bg-white hover:bg-gray-50'}`}
                            >
                              <td className={`sticky left-0 z-10 px-3 py-3 pl-12 text-gray-600 w-[280px] min-w-[280px] max-w-[280px] shadow-[1px_0_0_0_rgba(148,163,184,0.2)]
                                ${sit === 'deficit' ? 'bg-red-50 group-hover:bg-red-100'
                                : 'bg-white group-hover:bg-gray-50'}`}
                              >
                                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle
                                  ${sit === 'deficit' ? 'bg-red-400' : 'bg-emerald-400'}`} />
                                <span className="text-gray-400 font-mono text-[11px] mr-2">{item.produto.idproduto}</span>
                                <span className="font-medium text-gray-700">{(item.produto.cor || '—').trim()}</span>
                                <span className="text-gray-400 mx-1.5">/</span>
                                <span className="text-gray-500">{(item.produto.tamanho || '—').trim()}</span>
                              </td>
                              {mostrarDetalhes && (<>
                              <td className="px-2 py-3 text-center">
                                {(() => {
                                  const refNorm = (item.produto.referencia || '').trim().toUpperCase();
                                  const curva = curvaABC[refNorm] || 'B';
                                  const curvaClass = curva === 'A' ? 'bg-green-100 text-green-800' : curva === 'C' ? 'bg-red-100 text-red-800' : curva === 'D' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600';
                                  return <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${curvaClass}`}>{curva}</span>;
                                })()}
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums text-gray-400">{fmt(eMin)}</td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">
                                {item.estoques.estoque_atual > 0 ? <span className="text-gray-700">{fmt(item.estoques.estoque_atual)}</span> : <span className="text-gray-300">0</span>}
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">
                                {item.demanda.pedidos_pendentes > 0 ? <span className="text-gray-700">{fmt(item.demanda.pedidos_pendentes)}</span> : <span className="text-gray-300">—</span>}
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums font-semibold">
                                <CellDisp v={disp} min={eMin} />
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
                              <td className="px-3 py-3 text-right font-mono tabular-nums">
                                <CellNegativo v={disp} />
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">
                                <CellNegativo v={dispPosProcesso} />
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">
                                <CellCob disp={disp} min={eMin} />
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">
                                <CellTaxa venda={(vendasReais[item.produto.idproduto]?.[String(taxaMeses[0].mes)] ?? 0)} proj={(projecoes[item.produto.idproduto]?.[String(taxaMeses[0].mes)] ?? 0)} />
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">
                                <CellTaxa venda={(vendasReais[item.produto.idproduto]?.[String(taxaMeses[1].mes)] ?? 0)} proj={(projecoes[item.produto.idproduto]?.[String(taxaMeses[1].mes)] ?? 0)} />
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">
                                <CellTaxa
                                  venda={(vendasReais[item.produto.idproduto]?.[String(taxaMeses[2].mes)] ?? 0)}
                                  proj={(projecoes[item.produto.idproduto]?.[String(taxaMeses[2].mes)] ?? 0)}
                                />
                              </td>
                              </>)}
                              {temProjecoes ? (
                                <>
                                  {COLS_PERIODO.flatMap((c) => {
                                    const x = cadeia[c.campo];
                                    const d = proj !== null ? x.disp : null;
                                    const base = `px-3 py-3 text-right font-mono tabular-nums ${c.bgSku}`;
                                    return [
                                      <td key={`${c.periodo}-proj`} className={base}><CellProj v={x.proj} /></td>,
                                      <td key={`${c.periodo}-plano`} className={planoRiskClass(base, riscoDoPeriodo(c.campo))}>
                                        <CellPlano v={x.plano} title={tooltipRiscoSku(String(item.produto.idproduto), c.campo)} onClick={() => abrirModalCheckMp(
                                          String(item.produto.idproduto),
                                          item.produto.referencia || '',
                                          item.produto.cor || '',
                                          item.produto.tamanho || '',
                                          c.campo,
                                          c.nome.toUpperCase(),
                                          x.plano
                                        )} />
                                      </td>,
                                      <td key={`${c.periodo}-disp`} className={base}><CellDispFut v={d} min={eMin} /></td>,
                                      <td key={`${c.periodo}-neg`} className={base}>
                                        {d !== null && d < 0 ? <span className="text-red-700 font-semibold">{fmt(Math.abs(d))}</span> : <span className="text-gray-300">—</span>}
                                      </td>,
                                      <td key={`${c.periodo}-cob`} className={base}><CellCobFut v={d} min={eMin} /></td>,
                                    ];
                                  })}
                                </>
                              ) : (
                                <>
                                  {COLS_PERIODO.map((c) => (
                                    <td key={c.periodo} className={planoRiskClass(`px-3 py-3 text-right font-mono tabular-nums ${c.bgSkuPlano}`, riscoDoPeriodo(c.campo))}>
                                      <CellPlano
                                        v={cadeia[c.campo].plano}
                                        title={tooltipRiscoSku(String(item.produto.idproduto), c.campo)}
                                        onClick={() => abrirModalCheckMp(String(item.produto.idproduto), item.produto.referencia || '', item.produto.cor || '', item.produto.tamanho || '', c.campo, c.nome.toUpperCase(), cadeia[c.campo].plano)}
                                      />
                                    </td>
                                  ))}
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
      <div className="flex items-center gap-6 px-3 py-3 border-t border-gray-100 bg-gray-50/60 text-[12px] text-gray-500 flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"/>Déficit</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"/>OK</span>
        {temProjecoes && (
          <span className="flex items-center gap-1.5 text-violet-600">
            <span className="w-2 h-2 rounded-full bg-violet-400 inline-block"/>
            Disp. futuro = Disp. + Em Proc. + Plano - Projeção
          </span>
        )}
        <span className="ml-auto text-gray-400">Disponível = Estoque - Pedidos · Cobertura = Disp. / Est. Mín.</span>
      </div>

      {/* Modal Em Processo por Local */}
      {modalEmProcesso.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={fecharModalEmProcesso}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-200 bg-sky-50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-sky-800">Em Processo por Local</h3>
                <p className="text-[13px] text-sky-600">
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
                <table className="min-w-full text-[13px]">
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
              <button onClick={fecharModalEmProcesso} className="px-4 py-2 text-[13px] font-semibold bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Verificação de MP */}
      {modalCheckMp.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={fecharModalCheckMp}>
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[85vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-200 bg-teal-50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-teal-800">Verificação de Matéria-Prima</h3>
                <p className="text-[13px] text-teal-600">
                  {modalCheckMp.referencia} · {modalCheckMp.cor} / {modalCheckMp.tamanho}
                  <span className="ml-2 text-gray-400">ID: {modalCheckMp.idproduto}</span>
                </p>
                <p className="text-[13px] text-teal-700 mt-0.5">
                  Plano <span className="font-semibold uppercase">{modalCheckMp.mesNome}</span>: {fmt(modalCheckMp.planoQtd)} unidades
                </p>
              </div>
              <button onClick={fecharModalCheckMp} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            {/* Resumo */}
            {!modalCheckMp.loading && !modalCheckMp.error && modalCheckMp.resumo.total > 0 && (
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-4 text-[13px]">
                <span className="text-gray-600">
                  <span className="font-semibold">{modalCheckMp.resumo.total}</span> MPs na ficha técnica
                </span>
                {modalCheckMp.resumo.em_risco > 0 ? (
                  <span className="text-red-600 font-semibold flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                    {modalCheckMp.resumo.em_risco} em risco de falta
                  </span>
                ) : (
                  <span className="text-green-600 font-semibold flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                    Todas as MPs com saldo suficiente
                  </span>
                )}
              </div>
            )}

            <div className="p-4 max-h-[55vh] overflow-auto">
              {modalCheckMp.loading && (
                <div className="text-center py-8 text-gray-500 text-sm">
                  <svg className="animate-spin w-6 h-6 mx-auto mb-2 text-teal-600" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Verificando matérias-primas...
                </div>
              )}
              {modalCheckMp.error && (
                <div className="text-center py-8 text-red-600 text-sm">{modalCheckMp.error}</div>
              )}
              {!modalCheckMp.loading && !modalCheckMp.error && modalCheckMpProblemas.length === 0 && (
                <div className="text-center py-8 text-gray-500 text-sm">
                  Nenhuma matéria-prima com problema encontrada para este produto neste período.
                </div>
              )}
              {!modalCheckMp.loading && !modalCheckMp.error && modalCheckMpProblemas.length > 0 && (
                <table className="min-w-full text-[13px]">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-2 font-semibold text-gray-700">Código</th>
                      <th className="text-left px-2 py-2 font-semibold text-gray-700">Matéria-Prima</th>
                      <th className="text-right px-2 py-2 font-semibold text-gray-600">Estoque</th>
                      <th className="text-right px-2 py-2 font-semibold text-gray-600">Entrada</th>
                      <th className="text-right px-2 py-2 font-semibold text-gray-600">Consumo Geral</th>
                      <th className="text-right px-2 py-2 font-semibold text-teal-700">Saldo</th>
                      <th className="text-center px-2 py-2 font-semibold text-gray-700">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modalCheckMpProblemas.map((mp, idx) => (
                      <tr key={mp.idmateriaprima} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${mp.status === 'FALTA' ? 'bg-red-50' : ''}`}>
                        <td className="px-2 py-2 text-gray-500 font-mono text-[11px]">{mp.idmateriaprima}</td>
                        <td className="px-2 py-2 text-gray-700">
                          <div className="font-medium truncate max-w-[180px]" title={mp.nome}>{mp.nome || '—'}</div>
                          {mp.artigo && <div className="text-[11px] text-gray-400">{mp.artigo}</div>}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-gray-600">{fmt(mp.estoque)}</td>
                        <td className="px-2 py-2 text-right font-mono text-gray-600">{fmt(mp.entrada_periodo)}</td>
                        <td className="px-2 py-2 text-right font-mono text-gray-600">{fmt(mp.consumo_consolidado)}</td>
                        <td className={`px-2 py-2 text-right font-mono font-semibold ${mp.saldo_periodo < 0 ? 'text-red-600' : 'text-teal-700'}`}>
                          {fmt(mp.saldo_periodo)}
                        </td>
                        <td className="px-2 py-2 text-center">
                          {mp.status === 'OK' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-green-100 text-green-700">OK</span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-red-100 text-red-700">
                              FALTA {fmt(mp.deficit)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
              <p className="text-[11px] text-gray-400">
                Consumo consolidado considera todos os produtos do plano, não apenas este item.
              </p>
              <button onClick={fecharModalCheckMp} className="px-4 py-2 text-[13px] font-semibold bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
