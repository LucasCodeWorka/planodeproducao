'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import MatrizPlanejamentoTable from '../components/MatrizPlanejamentoTable';
import { Planejamento, ProjecoesMap, PeriodosPlano } from '../types';
import { authHeaders, getToken } from '../lib/auth';
import { projecaoMesDecorrida, projecaoMesPlanejamento } from '../lib/projecao';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MARCA_FIXA = 'LIEBE';
const STATUS_FIXO = 'EM LINHA';

type CoberturaFaixa = 'TODAS' | 'NEGATIVA' | 'ZERO_UM' | 'MAIOR_UM' | 'MAIOR_2';
type CoberturaBase = 'ATUAL' | 'MA' | 'PX' | 'UL';
type TaxaFaixa = 'TODAS' | 'ATE_70';
type NivelMatriz = 'CONTINUIDADE' | 'ITEM';
type ResumoPeriodo = { base: number; cenario: number; retirado: number };
type PlanoSnapshotItem = { chave: string; ma: number; px: number; ul: number };
type ReprojecaoPreviewItem = {
  idproduto: string;
  recalculada: { ma: number; px: number; ul: number; qt?: number };
};
type SimulacaoParametros = {
  tipo?: string;
  subtipo?: string;
  origem?: string;
  periodoAlvo?: 'MA' | 'PX' | 'UL' | 'QT';
  maModo?: 'EMERGENCIA' | 'COBERTURA' | null;
  statusAprovacao?: 'PENDENTE' | 'APROVADA';
  aprovadoEm?: number;
  aprovadoPor?: string;
  origemId?: string;
  coberturaAlvo?: number;
  coberturaAlvoAumento?: number;
  coberturaMinimaUL?: number;
  reducaoCoberturaBase?: CoberturaBase;
  reducaoCoberturaMin?: number;
  aumentoCoberturaBase?: CoberturaBase;
  aumentoCoberturaMax?: number;
  aumentoSomenteTop30?: boolean;
  aumentoSomenteNegativos?: boolean;
  aumentoSomenteCoberturaBaixa?: boolean;
  reducaoConfirmacao70?: boolean;
  aumentoConfirmacao70?: boolean;
  filtros?: {
    apenasNegativos?: boolean;
    continuidade?: string;
    referencia?: string;
    cor?: string;
    cobertura?: CoberturaFaixa;
    coberturaBase?: CoberturaBase;
    taxa?: TaxaFaixa;
    suspensos?: 'INCLUIR' | 'EXCLUIR';
  };
  usarEstoqueLojas?: boolean;
  estoqueLojasSnapshot?: Array<{ idproduto: string; qtd_disponivel_total: number }>;
  considerarProjecaoNova?: boolean;
  reprojecaoPreview?: ReprojecaoPreviewItem[];
  planos?: PlanoSnapshotItem[];
};
type SugestaoPlanoCfg = {
  cobertura_top30: number;
  cobertura_demais: number;
  cobertura_kissme: number;
  usar_corte_minimo: boolean;
};
type SavedSimulacao = {
  id: string;
  nome: string;
  createdAt: number;
  parametros?: SimulacaoParametros;
  resumo?: {
    alterados?: number;
    retiradoTotal?: number;
    retiradoMA?: number;
    retiradoPX?: number;
    retiradoUL?: number;
    incluidoTotal?: number;
    incluidoMA?: number;
    incluidoPX?: number;
    incluidoUL?: number;
  };
  observacoes?: string;
};
type DetalheSimulacaoLinha = {
  chave: string;
  referencia: string;
  produto: string;
  cor: string;
  tamanho: string;
  continuidade: string;
  ma: number;
  px: number;
  ul: number;
};
type SerieMes = { mes: string; total: number; top30: number; demais: number; kissme: number };
type AnalyserResp = {
  termometro?: { score: number; nivel: string; componentes?: Record<string, number> };
  estrategiaBase?: { filtrosSugeridos?: Array<{ objetivo: string; nome: string; prioridade: string; criterios?: Record<string, unknown> }> };
  analise?: { resumoExecutivo?: string; acoesRecomendadas?: string[] };
};
type DetalheRetiradaItem = {
  chave: string;
  continuidade: string;
  referencia: string;
  descricao: string;
  cor: string;
  tamanho: string;
  retiradoMA: number;
  retiradoPX: number;
  retiradoUL: number;
  retiradoTotal: number;
  planoBaseMA: number;
  planoBasePX: number;
  planoBaseUL: number;
  planoCenarioMA: number;
  planoCenarioPX: number;
  planoCenarioUL: number;
  dispBaseMA: number;
  dispBasePX: number;
  dispBaseUL: number;
  dispCenarioMA: number;
  dispCenarioPX: number;
  dispCenarioUL: number;
  coberturaBaseMA: number;
  coberturaBasePX: number;
  coberturaBaseUL: number;
  coberturaCenarioMA: number;
  coberturaCenarioPX: number;
  coberturaCenarioUL: number;
};

function chaveItem(item: Planejamento) {
  const id = Number(item.produto.idproduto);
  if (Number.isFinite(id)) return `ID-${id}`;
  return `REF-${item.produto.referencia || ''}-${item.produto.cor || ''}-${item.produto.tamanho || ''}`;
}

function arredPeca(valor: number) {
  return Math.round(valor || 0);
}

function fmtPeca(valor: number) {
  return arredPeca(valor).toLocaleString('pt-BR');
}

function clampPct(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function normalizaRef(ref: string) {
  return String(ref || '').trim().toUpperCase();
}

function calculaDispECobPorPlano(
  item: Planejamento,
  projecoes: ProjecoesMap,
  periodos: PeriodosPlano,
  plano: { ma: number; px: number; ul: number }
) {
  const min = item.estoques.estoque_minimo || 0;
  const dispAtual = (item.estoques.estoque_atual || 0) - (item.demanda.pedidos_pendentes || 0);
  const proj = projecoes[item.produto.idproduto] ?? null;
  const emP = item.estoques.em_processo || 0;
  const prMA = proj ? projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA) : 0;
  const prPX = proj ? (proj[String(periodos.PX)] ?? 0) : 0;
  const prUL = proj ? (proj[String(periodos.UL)] ?? 0) : 0;

  const dispMA = dispAtual + emP + plano.ma - prMA;
  const dispPX = dispMA + plano.px - prPX;
  const dispUL = dispPX + plano.ul - prUL;
  return {
    dispMA,
    dispPX,
    dispUL,
    cobMA: min > 0 ? dispMA / min : 0,
    cobPX: min > 0 ? dispPX / min : 0,
    cobUL: min > 0 ? dispUL / min : 0,
  };
}

function aplicarEstoqueLojasNaBase(
  base: Planejamento[],
  snapshot: Array<{ idproduto: string; qtd_disponivel_total: number }>
) {
  if (!snapshot.length) return base;
  const estoqueMap = new Map<number, number>();
  snapshot.forEach((row) => {
    const id = Number(row.idproduto);
    if (!Number.isFinite(id)) return;
    estoqueMap.set(id, Number(row.qtd_disponivel_total || 0));
  });
  if (estoqueMap.size === 0) return base;

  return base.map((item) => {
    const id = Number(item.produto.idproduto);
    const adicional = Number(estoqueMap.get(id) || 0);
    if (!(adicional > 0)) return item;
    const estoqueAtual = Number(item.estoques.estoque_atual || 0) + adicional;
    const pedidosPendentes = Number(item.demanda.pedidos_pendentes || 0);
    const estoqueDisponivel = Math.max(0, estoqueAtual - pedidosPendentes);
    const estoqueMinimo = Number(item.estoques.estoque_minimo || 0);
    const necessidadeProducao = Math.max(0, estoqueMinimo - estoqueDisponivel);
    return {
      ...item,
      estoques: {
        ...item.estoques,
        estoque_atual: estoqueAtual,
        estoque_disponivel: estoqueDisponivel,
      },
      planejamento: {
        ...item.planejamento,
        necessidade_producao: necessidadeProducao,
      },
    };
  });
}

function coberturaNaBase(
  base: CoberturaBase,
  min: number,
  dispAtual: number,
  dispMA: number,
  dispPX: number,
  dispUL: number
) {
  if (min <= 0) return 0;
  const disp = base === 'MA' ? dispMA : base === 'PX' ? dispPX : base === 'UL' ? dispUL : dispAtual;
  return disp / min;
}

function quantizaRetiradaPorLote(qtd: number, loteBase: number) {
  const lote = Math.max(1, Math.round(Number(loteBase || 0)));
  const bruto = Math.max(0, Math.floor(qtd));
  return Math.floor(bruto / lote) * lote;
}

function quantizaAumentoPorLote(qtd: number, loteBase: number) {
  const lote = Math.max(1, Math.round(Number(loteBase || 0)));
  const bruto = Math.max(0, Number(qtd || 0));
  return Math.ceil(bruto / lote) * lote;
}

export default function LaboratorioPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dadosBase, setDadosBase] = useState<Planejamento[]>([]);
  const [dadosBaseOriginal, setDadosBaseOriginal] = useState<Planejamento[]>([]);
  const [dadosCenario, setDadosCenario] = useState<Planejamento[]>([]);
  const [projecoes, setProjecoes] = useState<ProjecoesMap>({});
  const [reprojecaoPreviewAtiva, setReprojecaoPreviewAtiva] = useState<ReprojecaoPreviewItem[]>([]);
  const [vendasReais, setVendasReais] = useState<Record<string, Record<string, number>>>({});
  const [corteMinPorProduto, setCorteMinPorProduto] = useState<Record<string, number>>({});
  const [top30Ids, setTop30Ids] = useState<Set<string>>(new Set());
  const [top30Refs, setTop30Refs] = useState<Set<string>>(new Set());
  const [cfgSugestaoPlano, setCfgSugestaoPlano] = useState<SugestaoPlanoCfg>({
    cobertura_top30: 1.2,
    cobertura_demais: 0.8,
    cobertura_kissme: 1.5,
    usar_corte_minimo: true,
  });
  const [periodos, setPeriodos] = useState<PeriodosPlano>({
    MA: new Date().getMonth() + 1,
    PX: new Date().getMonth() + 2,
    UL: new Date().getMonth() + 3,
  });

  const [apenasNegativos, setApenasNegativos] = useState(false);
  const [filtroContinuidade, setFiltroContinuidade] = useState('TODAS');
  const [filtroReferencia, setFiltroReferencia] = useState('');
  const [filtroCor, setFiltroCor] = useState('TODAS');
  const [filtroCobertura, setFiltroCobertura] = useState<CoberturaFaixa>('TODAS');
  const [filtroCoberturaBase, setFiltroCoberturaBase] = useState<CoberturaBase>('ATUAL');
  const [filtroTaxa, setFiltroTaxa] = useState<TaxaFaixa>('TODAS');
  const [usarFiltrosTabelaNaSimulacao, setUsarFiltrosTabelaNaSimulacao] = useState(true);

  const [coberturaAlvo, setCoberturaAlvo] = useState(1);
  const [coberturaAlvoAumento, setCoberturaAlvoAumento] = useState(1);
  const [coberturaMinimaUL, setCoberturaMinimaUL] = useState(0);
  const [reducaoCoberturaBase, setReducaoCoberturaBase] = useState<CoberturaBase>('UL');
  const [reducaoCoberturaMin, setReducaoCoberturaMin] = useState(1);
  const [aumentoCoberturaBase, setAumentoCoberturaBase] = useState<CoberturaBase>('UL');
  const [aumentoCoberturaMax, setAumentoCoberturaMax] = useState(0.5);
  const [aumentoSomenteTop30, setAumentoSomenteTop30] = useState(true);
  const [aumentoSomenteNegativos, setAumentoSomenteNegativos] = useState(true);
  const [aumentoSomenteCoberturaBaixa, setAumentoSomenteCoberturaBaixa] = useState(true);
  const [reducaoConfirmacao70, setReducaoConfirmacao70] = useState(false);
  const [aumentoConfirmacao70, setAumentoConfirmacao70] = useState(false);
  const [abrirDetalheRetirada, setAbrirDetalheRetirada] = useState(false);
  const [nivelMatrizDetalhe, setNivelMatrizDetalhe] = useState<NivelMatriz>('ITEM');
  const [simulacoes, setSimulacoes] = useState<SavedSimulacao[]>([]);
  const [nomeSimulacao, setNomeSimulacao] = useState('');
  const [obsSimulacao, setObsSimulacao] = useState('');
  const [salvandoSimulacao, setSalvandoSimulacao] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [simulacaoDetalhe, setSimulacaoDetalhe] = useState<SavedSimulacao | null>(null);
  const [executandoAnalyser, setExecutandoAnalyser] = useState(false);
  const [resultadoAnalyser, setResultadoAnalyser] = useState<AnalyserResp | null>(null);
  const [gerandoSugestaoRetirada, setGerandoSugestaoRetirada] = useState(false);
  const [vendasReaisLoading, setVendasReaisLoading] = useState(false);

  const projecoesAtivas = useMemo<ProjecoesMap>(() => {
    if (!reprojecaoPreviewAtiva.length) return projecoes;
    const clone: ProjecoesMap = { ...projecoes };
    for (const item of reprojecaoPreviewAtiva) {
      const id = String(item.idproduto || '').trim();
      if (!id) continue;
      const base = clone[id] ? { ...clone[id] } : {};
      base[String(periodos.MA)] = Number(item.recalculada?.ma || 0);
      base[String(periodos.PX)] = Number(item.recalculada?.px || 0);
      base[String(periodos.UL)] = Number(item.recalculada?.ul || 0);
      clone[id] = base;
    }
    return clone;
  }, [projecoes, reprojecaoPreviewAtiva, periodos]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregarTudo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregarTudo() {
    setLoading(true);
    setError(null);
    setOkMsg(null);
    try {
      const params = new URLSearchParams({ limit: '5000', marca: MARCA_FIXA, status: STATUS_FIXO });
      const [rMatriz, rProj, rSaved, rTop30, rCortes, rCfgSugestao] = await Promise.all([
        fetch(`${API_URL}/api/producao/matriz?${params}`),
        fetch(`${API_URL}/api/projecoes`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/simulacoes`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/analises/top30-produtos`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/configuracoes/corte-minimos`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/configuracoes/sugestao-plano`, { headers: authHeaders() }),
      ]);
      if (!rMatriz.ok) throw new Error(`Matriz erro ${rMatriz.status}`);
      if (!rProj.ok) throw new Error(`Projeções erro ${rProj.status}`);
      if (!rSaved.ok) throw new Error(`Simulações erro ${rSaved.status}`);
      if (!rTop30.ok) throw new Error(`Top30 erro ${rTop30.status}`);
      if (!rCortes.ok) throw new Error(`Cortes mínimos erro ${rCortes.status}`);
      if (!rCfgSugestao.ok) throw new Error(`Config. sugestão erro ${rCfgSugestao.status}`);

      const pMatriz = await rMatriz.json();
      const pProj = await rProj.json();
      const pSaved = await rSaved.json();
      const pTop30 = await rTop30.json();
      const pCortes = await rCortes.json();
      const pCfgSugestao = await rCfgSugestao.json();
      const rows = (pMatriz.data || []) as Planejamento[];

      setDadosBaseOriginal(rows);
      setDadosBase(rows);
      setDadosCenario(rows);
      setProjecoes((pProj && pProj.data) || {});
      setReprojecaoPreviewAtiva([]);
      if (pProj && pProj.periodos) setPeriodos(pProj.periodos as PeriodosPlano);
      const salvas = Array.isArray(pSaved?.data) ? (pSaved.data as SavedSimulacao[]) : [];
      setSimulacoes(
        salvas.filter((s) => s?.parametros?.tipo === 'LABORATORIO_SIMULACAO')
      );
      setTop30Ids(new Set(((pTop30 && pTop30.ids) || []).map((v: string) => String(v))));
      setTop30Refs(new Set(((pTop30 && pTop30.referencias) || []).map((v: string) => normalizaRef(v))));
      setCfgSugestaoPlano({
        cobertura_top30: Number(pCfgSugestao?.data?.cobertura_top30 || 1.2),
        cobertura_demais: Number(pCfgSugestao?.data?.cobertura_demais || 0.8),
        cobertura_kissme: Number(pCfgSugestao?.data?.cobertura_kissme || 1.5),
        usar_corte_minimo: pCfgSugestao?.data?.usar_corte_minimo !== false,
      });
      const corteMap: Record<string, number> = {};
      const cortesRows = Array.isArray(pCortes?.data) ? pCortes.data : [];
      cortesRows.forEach((r: { idproduto?: string; corte_min?: number }) => {
        const id = String(r?.idproduto || '').trim();
        const corte = Number(r?.corte_min || 0);
        if (!id || !Number.isFinite(corte) || corte <= 0) return;
        corteMap[id] = Math.round(corte);
      });
      setCorteMinPorProduto(corteMap);

      const ids = rows
        .map((i) => Number(i.produto.idproduto))
        .filter((n) => Number.isFinite(n))
        .slice(0, 2500);
      // Nao trava a tela aguardando venda real; carrega em segundo plano.
      carregarVendasReais(ids);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar laboratório');
    } finally {
      setLoading(false);
    }
  }

  async function carregarVendasReais(ids: number[]) {
    if (!ids.length) return;
    setVendasReaisLoading(true);
    try {
      const rReal = await fetch(`${API_URL}/api/analises/projecao-vs-venda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ano: new Date().getFullYear(), ids }),
      });
      if (!rReal.ok) throw new Error();
      const pReal = await rReal.json();
      setVendasReais((pReal && pReal.data) || {});
    } catch {
      setVendasReais({});
    } finally {
      setVendasReaisLoading(false);
    }
  }

  const opcoesContinuidade = useMemo(
    () => ['TODAS', ...Array.from(new Set(dadosBase.map((i) => (i.produto.continuidade || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))],
    [dadosBase]
  );
  const opcoesCor = useMemo(
    () => ['TODAS', ...Array.from(new Set(dadosBase.map((i) => (i.produto.cor || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))],
    [dadosBase]
  );

  function passaFiltros(item: Planejamento) {
    if (filtroContinuidade !== 'TODAS' && (item.produto.continuidade || '').trim() !== filtroContinuidade) return false;
    if (filtroCor !== 'TODAS' && (item.produto.cor || '').trim() !== filtroCor) return false;
    if (filtroReferencia.trim() && !(item.produto.referencia || '').toLowerCase().includes(filtroReferencia.toLowerCase().trim())) return false;

    const dispAtual = (item.estoques.estoque_atual || 0) - (item.demanda.pedidos_pendentes || 0);
    const proj = projecoesAtivas[item.produto.idproduto] ?? null;
    const emP = item.estoques.em_processo || 0;
    const pMA = item.plano?.ma || 0;
    const pPX = item.plano?.px || 0;
    const pUL = item.plano?.ul || 0;
    const prMA = proj ? projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA) : 0;
    const prPX = proj ? (proj[String(periodos.PX)] ?? 0) : 0;
    const prUL = proj ? (proj[String(periodos.UL)] ?? 0) : 0;
    const dispMA = dispAtual + emP + pMA - prMA;
    const dispPX = dispMA + pPX - prPX;
    const dispUL = dispPX + pUL - prUL;

    if (apenasNegativos && !(dispAtual < 0 || dispMA < 0 || dispPX < 0 || dispUL < 0)) return false;

    if (filtroCobertura !== 'TODAS') {
      const min = item.estoques.estoque_minimo || 0;
      if (min <= 0) return false;
      const disp = filtroCoberturaBase === 'MA' ? dispMA : filtroCoberturaBase === 'PX' ? dispPX : filtroCoberturaBase === 'UL' ? dispUL : dispAtual;
      const cob = disp / min;
      if (filtroCobertura === 'NEGATIVA' && !(cob < 0)) return false;
      if (filtroCobertura === 'ZERO_UM' && !(cob >= 0 && cob < 1)) return false;
      if (filtroCobertura === 'MAIOR_UM' && !(cob >= 1)) return false;
      if (filtroCobertura === 'MAIOR_2' && !(cob >= 2)) return false;
    }

    if (filtroTaxa === 'ATE_70') {
      const projSku = projecoesAtivas[item.produto.idproduto] || {};
      const realSku = vendasReais[item.produto.idproduto] || {};
      const pj = Number(projSku['1'] || 0);
      const pf = Number(projSku['2'] || 0);
      if (pj <= 0 || pf <= 0) return false;
      const tj = Number(realSku['1'] || 0) / pj;
      const tf = Number(realSku['2'] || 0) / pf;
      if (!(tj <= 0.7 && tf <= 0.7)) return false;
    }

    return true;
  }

  function passaEscopoSimulacao(item: Planejamento) {
    if (!usarFiltrosTabelaNaSimulacao) return true;
    return passaFiltros(item);
  }

  function obterLoteCorte(item: Planejamento) {
    const id = String(item.produto.idproduto || '').trim();
    const cfg = Number(corteMinPorProduto[id] || 0);
    if (Number.isFinite(cfg) && cfg > 0) return cfg;
    return Math.max(1, Math.round(Number(item.estoques.estoque_minimo || 0)));
  }

  function obterCoberturaAlvoConfig(item: Planejamento) {
    const texto = `${String(item.produto.continuidade || '')} ${String(item.produto.produto || '')}`.toUpperCase();
    const id = String(item.produto.idproduto || '');
    const refNorm = normalizaRef(item.produto.referencia || '');
    const isTop30 = top30Refs.has(refNorm) || top30Ids.has(id);
    if (texto.includes('KISS ME')) return Number(cfgSugestaoPlano.cobertura_kissme || 1.5);
    if (isTop30) return Number(cfgSugestaoPlano.cobertura_top30 || 1.2);
    return Number(cfgSugestaoPlano.cobertura_demais || 0.8);
  }

  function sugerirPlanoFuturoPorConfig() {
    setError(null);
    setOkMsg(null);
    const novo = dadosCenario.map((item) => {
      if (!passaEscopoSimulacao(item)) return item;
      const min = Number(item.estoques.estoque_minimo || 0);
      if (min <= 0) return item;

      const dispAtual = (item.estoques.estoque_atual || 0) - (item.demanda.pedidos_pendentes || 0);
      const proj = projecoesAtivas[item.produto.idproduto] ?? null;
      const emP = item.estoques.em_processo || 0;
      let ma = arredPeca(item.plano?.ma || 0);
      let px = arredPeca(item.plano?.px || 0);
      const ul = arredPeca(item.plano?.ul || 0);
      const prMA = proj ? projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA) : 0;
      const prPX = proj ? (proj[String(periodos.PX)] ?? 0) : 0;
      const prUL = proj ? (proj[String(periodos.UL)] ?? 0) : 0;

      const dispMA = dispAtual + emP + ma - prMA;
      const dispPX = dispMA + px - prPX;
      const dispUL = dispPX + ul - prUL;
      const alvoCob = Math.max(0, obterCoberturaAlvoConfig(item));
      const alvoDisp = alvoCob * min;
      const delta = alvoDisp - dispUL;
      if (Math.abs(delta) < 1) return item;

      const lote = cfgSugestaoPlano.usar_corte_minimo ? obterLoteCorte(item) : 1;
      if (delta > 0) {
        const add = quantizaAumentoPorLote(delta, lote);
        ma += add;
      } else {
        let remover = quantizaRetiradaPorLote(Math.abs(delta), lote);
        const redMA = Math.min(ma, remover); ma -= redMA; remover -= redMA;
        const redPX = Math.min(px, remover); px -= redPX; remover -= redPX;
      }

      return { ...item, plano: { ma: arredPeca(ma), px: arredPeca(px), ul: arredPeca(ul) } };
    });
    setDadosCenario(novo);
    setOkMsg(
      `Sugestão futura aplicada: Top30 ${cfgSugestaoPlano.cobertura_top30.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x, Demais ${cfgSugestaoPlano.cobertura_demais.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x, KISS ME ${cfgSugestaoPlano.cobertura_kissme.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x.`
    );
  }

  function taxaJanFev(item: Planejamento) {
    const projSku = projecoesAtivas[item.produto.idproduto] || {};
    const realSku = vendasReais[item.produto.idproduto] || {};
    const pj = Number(projSku['1'] || 0);
    const pf = Number(projSku['2'] || 0);
    const rj = Number(realSku['1'] || 0);
    const rf = Number(realSku['2'] || 0);
    if (pj <= 0 || pf <= 0) return { valida: false, tj: 0, tf: 0 };
    const tj = rj / pj;
    const tf = rf / pf;
    return { valida: true, tj, tf };
  }

  function confirmaAderencia70(item: Planejamento) {
    const tx = taxaJanFev(item);
    if (!tx.valida) return false;
    // Confirmacao valida: >0% e <=70% nos dois meses.
    return tx.tj > 0 && tx.tf > 0 && tx.tj <= 0.7 && tx.tf <= 0.7;
  }

  function confirmaAderencia50(item: Planejamento) {
    const tx = taxaJanFev(item);
    if (!tx.valida) return false;
    // Regra da sugestao: >0% e <=50% nos dois meses.
    return tx.tj > 0 && tx.tf > 0 && tx.tj <= 0.5 && tx.tf <= 0.5;
  }

  async function gerarSugestaoRetiradaVacas() {
    setError(null);
    setOkMsg(null);
    setGerandoSugestaoRetirada(true);
    try {
      if (vendasReaisLoading) throw new Error('Aguardando carregar % atingido Jan/Fev. Tente novamente em instantes.');
      let retiradoTotal = 0;
      let retiradoSkus = 0;

      const aposRetirada = dadosCenario.map((item) => {
        if (!passaEscopoSimulacao(item)) return item;
        if (!confirmaAderencia50(item)) return item;

        const min = item.estoques.estoque_minimo || 0;
        if (min <= 0) return item;

        const dispAtual = (item.estoques.estoque_atual || 0) - (item.demanda.pedidos_pendentes || 0);
        const proj = projecoesAtivas[item.produto.idproduto] ?? null;
        const emP = item.estoques.em_processo || 0;
        let ma = arredPeca(item.plano?.ma || 0);
        let px = arredPeca(item.plano?.px || 0);
        let ul = arredPeca(item.plano?.ul || 0);
        const prMA = proj ? projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA) : 0;
        const prPX = proj ? (proj[String(periodos.PX)] ?? 0) : 0;
        const prUL = proj ? (proj[String(periodos.UL)] ?? 0) : 0;

        const dispMA = dispAtual + emP + ma - prMA;
        const dispPX = dispMA + px - prPX;
        const dispUL = dispPX + ul - prUL;
        const cobMA = dispMA / min;
        if (cobMA <= 1) return item;

        const minUlDisp = min * 0.8;
        let restante = quantizaRetiradaPorLote(Math.max(0, dispUL - minUlDisp), obterLoteCorte(item));
        if (restante <= 0) return item;

        // Nao retira do UL na sugestao automatica.
        const redMA = Math.min(ma, restante); ma -= redMA; restante -= redMA;
        const redPX = Math.min(px, restante); px -= redPX; restante -= redPX;
        const redUL = 0;
        const retirado = redUL + redPX + redMA;
        if (retirado <= 0) return item;

        const novoDispMA = dispAtual + emP + ma - prMA;
        const novoDispPX = novoDispMA + px - prPX;
        const novoDispUL = novoDispPX + ul - prUL;
        const novaCobUL = novoDispUL / min;
        if (novaCobUL < 0.8) return item;

        retiradoTotal += retirado;
        retiradoSkus += 1;
        return { ...item, plano: { ma: arredPeca(ma), px: arredPeca(px), ul: arredPeca(ul) } };
      });

      setDadosCenario(aposRetirada);
      await salvarSugestaoRetirada(aposRetirada, { retiradoTotal, retiradoSkus });
      setOkMsg(
        `Sugestão de retirada aplicada: ${fmtPeca(retiradoTotal)} peças em ${retiradoSkus} SKUs (regra <=50% Jan/Fev, MA>1x, UL>=0.8x).`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar sugestão de retirada');
    } finally {
      setGerandoSugestaoRetirada(false);
    }
  }

  const baseEscopoSimulacao = useMemo(
    () => (usarFiltrosTabelaNaSimulacao ? dadosBase.filter((i) => passaFiltros(i)) : dadosBase),
    [
      dadosBase,
      usarFiltrosTabelaNaSimulacao,
      apenasNegativos,
      filtroContinuidade,
      filtroReferencia,
      filtroCor,
      filtroCobertura,
      filtroCoberturaBase,
      filtroTaxa,
      projecoes,
      periodos,
      vendasReais,
    ]
  );

  const cenarioEscopoSimulacao = useMemo(
    () => (usarFiltrosTabelaNaSimulacao ? dadosCenario.filter((i) => passaFiltros(i)) : dadosCenario),
    [
      dadosCenario,
      usarFiltrosTabelaNaSimulacao,
      apenasNegativos,
      filtroContinuidade,
      filtroReferencia,
      filtroCor,
      filtroCobertura,
      filtroCoberturaBase,
      filtroTaxa,
      projecoes,
      periodos,
      vendasReais,
    ]
  );

  const indicadorAderenciaRetirada = useMemo(() => {
    let totalEscopo = 0;
    let comBase = 0;
    let somaJan = 0;
    let somaFev = 0;
    let qtdFaixa50 = 0;
    cenarioEscopoSimulacao.forEach((item) => {
      totalEscopo += 1;
      const tx = taxaJanFev(item);
      if (!tx.valida) return;
      comBase += 1;
      somaJan += tx.tj;
      somaFev += tx.tf;
      if (tx.tj > 0 && tx.tf > 0 && tx.tj <= 0.5 && tx.tf <= 0.5) qtdFaixa50 += 1;
    });
    return {
      totalEscopo,
      comBase,
      mediaJanPct: comBase > 0 ? (somaJan / comBase) * 100 : 0,
      mediaFevPct: comBase > 0 ? (somaFev / comBase) * 100 : 0,
      qtdFaixa50,
      pctFaixa50: totalEscopo > 0 ? (qtdFaixa50 / totalEscopo) * 100 : 0,
    };
  }, [cenarioEscopoSimulacao, projecoesAtivas, vendasReais]);

  function aplicarReducaoPorCobertura() {
    const novo = dadosCenario.map((item) => {
      if (!passaEscopoSimulacao(item)) return item;
      if (reducaoConfirmacao70 && !confirmaAderencia70(item)) return item;

      const min = item.estoques.estoque_minimo || 0;
      if (min <= 0) return item;

      const dispAtual = (item.estoques.estoque_atual || 0) - (item.demanda.pedidos_pendentes || 0);
      const proj = projecoesAtivas[item.produto.idproduto] ?? null;
      const emP = item.estoques.em_processo || 0;
      let ma = arredPeca(item.plano?.ma || 0);
      let px = arredPeca(item.plano?.px || 0);
      let ul = arredPeca(item.plano?.ul || 0);
      const prMA = proj ? projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA) : 0;
      const prPX = proj ? (proj[String(periodos.PX)] ?? 0) : 0;
      const prUL = proj ? (proj[String(periodos.UL)] ?? 0) : 0;

      const dispMA = dispAtual + emP + ma - prMA;
      const dispPX = dispMA + px - prPX;
      const dispUL = dispPX + ul - prUL;
      const cobBaseReducao = coberturaNaBase(reducaoCoberturaBase, min, dispAtual, dispMA, dispPX, dispUL);
      if (cobBaseReducao < reducaoCoberturaMin) return item;
      const alvoDisp = Math.max(0, min * coberturaAlvo);
      const excesso = Math.max(0, dispUL - alvoDisp);
      if (excesso <= 0) return item;

      let restante = quantizaRetiradaPorLote(excesso, obterLoteCorte(item));
      if (restante <= 0) return item;
      // Nao retira do UL: ajuste focado em MA/PX.
      const redMA = Math.min(ma, restante); ma -= redMA; restante -= redMA;
      const redPX = Math.min(px, restante); px -= redPX; restante -= redPX;
      const redUL = 0;

      const novoDispMA = dispAtual + emP + ma - prMA;
      const novoDispPX = novoDispMA + px - prPX;
      const novoDispUL = novoDispPX + ul - prUL;
      const novaCobUL = min > 0 ? novoDispUL / min : 0;
      if (novaCobUL < coberturaMinimaUL) return item;

      return { ...item, plano: { ma: arredPeca(ma), px: arredPeca(px), ul: arredPeca(ul) } };
    });

    setDadosCenario(novo);
  }

  function aplicarAumentoPorCobertura() {
    const novo = dadosCenario.map((item) => {
      if (!passaEscopoSimulacao(item)) return item;
      if (aumentoConfirmacao70 && !confirmaAderencia70(item)) return item;

      const id = String(item.produto.idproduto || '');
      const refNorm = normalizaRef(item.produto.referencia || '');
      const isTop30 = top30Refs.has(refNorm) || top30Ids.has(id);
      if (aumentoSomenteTop30 && !isTop30) return item;

      const min = item.estoques.estoque_minimo || 0;
      if (min <= 0) return item;

      const dispAtual = (item.estoques.estoque_atual || 0) - (item.demanda.pedidos_pendentes || 0);
      const proj = projecoesAtivas[item.produto.idproduto] ?? null;
      const emP = item.estoques.em_processo || 0;
      let ma = arredPeca(item.plano?.ma || 0);
      let px = arredPeca(item.plano?.px || 0);
      let ul = arredPeca(item.plano?.ul || 0);
      const prMA = proj ? projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA) : 0;
      const prPX = proj ? (proj[String(periodos.PX)] ?? 0) : 0;
      const prUL = proj ? (proj[String(periodos.UL)] ?? 0) : 0;

      const dispMA = dispAtual + emP + ma - prMA;
      const dispPX = dispMA + px - prPX;
      const dispUL = dispPX + ul - prUL;
      const cobBaseAumento = coberturaNaBase(aumentoCoberturaBase, min, dispAtual, dispMA, dispPX, dispUL);

      const temNegativo = dispAtual < 0 || dispMA < 0 || dispPX < 0 || dispUL < 0;
      const temCoberturaBaixa = cobBaseAumento <= aumentoCoberturaMax;
      if (aumentoSomenteNegativos && !temNegativo) return item;
      if (aumentoSomenteCoberturaBaixa && !temCoberturaBaixa) return item;

      const alvoDisp = Math.max(0, min * coberturaAlvoAumento);
      const falta = Math.max(0, alvoDisp - dispUL);
      if (falta <= 0) return item;

      // No aumento prioriza MA (curto prazo), depois PX e UL.
      let restante = Math.ceil(falta);
      ma += restante;
      restante = 0;
      if (restante > 0) { px += restante; restante = 0; }
      if (restante > 0) { ul += restante; }

      return { ...item, plano: { ma: arredPeca(ma), px: arredPeca(px), ul: arredPeca(ul) } };
    });

    setDadosCenario(novo);
  }

  function montarSnapshotPlanosFrom(cenarioLista: Planejamento[]): PlanoSnapshotItem[] {
    const basePorChave = new Map(dadosBase.map((i) => [chaveItem(i), i]));
    return cenarioLista
      .map((cenarioItem) => {
        const key = chaveItem(cenarioItem);
        const baseItem = basePorChave.get(key);
        if (!baseItem) return null;

        const bMa = arredPeca(baseItem.plano?.ma || 0);
        const bPx = arredPeca(baseItem.plano?.px || 0);
        const bUl = arredPeca(baseItem.plano?.ul || 0);
        const cMa = arredPeca(cenarioItem.plano?.ma || 0);
        const cPx = arredPeca(cenarioItem.plano?.px || 0);
        const cUl = arredPeca(cenarioItem.plano?.ul || 0);
        if (bMa === cMa && bPx === cPx && bUl === cUl) return null;
        return { chave: key, ma: cMa, px: cPx, ul: cUl };
      })
      .filter((v): v is PlanoSnapshotItem => Boolean(v));
  }

  function montarSnapshotPlanos(): PlanoSnapshotItem[] {
    return montarSnapshotPlanosFrom(dadosCenario);
  }

  async function salvarSugestaoRetirada(cenarioLista: Planejamento[], meta: { retiradoTotal: number; retiradoSkus: number }) {
    const snapshot = montarSnapshotPlanosFrom(cenarioLista);
    if (!snapshot.length) return;

    const payload = {
      nome: `Sugestão Retirada ${new Date().toLocaleDateString('pt-BR')}`,
      parametros: {
        tipo: 'LAB_SUGESTAO_RETIRADA',
        statusAprovacao: 'PENDENTE',
        coberturaMinimaUL: 0.8,
        regra: 'Jan/Fev <= 50%, cobertura MA > 1x, preserva UL >= 0.8x e sem retirada em UL',
        filtros: {
          apenasNegativos,
          continuidade: filtroContinuidade,
          referencia: filtroReferencia,
          cor: filtroCor,
          cobertura: filtroCobertura,
          coberturaBase: filtroCoberturaBase,
          taxa: filtroTaxa,
        },
        planos: snapshot,
      } as SimulacaoParametros,
      resumo: {
        alterados: meta.retiradoSkus,
        retiradoTotal: Math.round(meta.retiradoTotal),
      },
      observacoes: 'Gerada automaticamente pelo Laboratório',
    };

    const res = await fetch(`${API_URL}/api/simulacoes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao salvar sugestão');
  }

  async function salvarSimulacao() {
    setSalvandoSimulacao(true);
    setError(null);
    setOkMsg(null);
    try {
      const nome = nomeSimulacao.trim();
      if (!nome) throw new Error('Informe um nome para a simulação.');

      const snapshot = montarSnapshotPlanos();
      const payload = {
        nome,
        parametros: {
          tipo: 'LABORATORIO_SIMULACAO',
          coberturaAlvo,
          coberturaAlvoAumento,
          coberturaMinimaUL,
          reducaoCoberturaBase,
          reducaoCoberturaMin,
          aumentoCoberturaBase,
          aumentoCoberturaMax,
          aumentoSomenteTop30,
          aumentoSomenteNegativos,
          aumentoSomenteCoberturaBaixa,
          reducaoConfirmacao70,
          aumentoConfirmacao70,
          filtros: {
            apenasNegativos,
            continuidade: filtroContinuidade,
            referencia: filtroReferencia,
            cor: filtroCor,
            cobertura: filtroCobertura,
            coberturaBase: filtroCoberturaBase,
            taxa: filtroTaxa,
          },
          planos: snapshot,
        } as SimulacaoParametros,
        resumo: {
          alterados: resumoLaboratorio.alterados,
          retiradoTotal: resumoLaboratorio.retiradoTotal,
          retiradoMA: resumoLaboratorio.porPeriodo.ma.retirado,
          retiradoPX: resumoLaboratorio.porPeriodo.px.retirado,
          retiradoUL: resumoLaboratorio.porPeriodo.ul.retirado,
          incluidoTotal: resumoMovimento.aumento.total,
          incluidoMA: resumoMovimento.aumento.ma,
          incluidoPX: resumoMovimento.aumento.px,
          incluidoUL: resumoMovimento.aumento.ul,
        },
        observacoes: obsSimulacao.trim(),
      };

      const res = await fetch(`${API_URL}/api/simulacoes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao salvar simulação');

      setNomeSimulacao('');
      setObsSimulacao('');
      setOkMsg('Simulação salva com sucesso.');
      await carregarTudo();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar simulação');
    } finally {
      setSalvandoSimulacao(false);
    }
  }

  async function aplicarSimulacao(sim: SavedSimulacao) {
    setError(null);
    setOkMsg(null);
    const p = sim.parametros || {};
    if (typeof p.coberturaAlvo === 'number') setCoberturaAlvo(p.coberturaAlvo);
    if (typeof p.coberturaAlvoAumento === 'number') setCoberturaAlvoAumento(p.coberturaAlvoAumento);
    if (typeof p.coberturaMinimaUL === 'number') setCoberturaMinimaUL(p.coberturaMinimaUL);
    if (p.reducaoCoberturaBase) setReducaoCoberturaBase(p.reducaoCoberturaBase);
    if (typeof p.reducaoCoberturaMin === 'number') setReducaoCoberturaMin(p.reducaoCoberturaMin);
    if (p.aumentoCoberturaBase) setAumentoCoberturaBase(p.aumentoCoberturaBase);
    if (typeof p.aumentoCoberturaMax === 'number') setAumentoCoberturaMax(p.aumentoCoberturaMax);
    if (typeof p.aumentoSomenteTop30 === 'boolean') setAumentoSomenteTop30(p.aumentoSomenteTop30);
    if (typeof p.aumentoSomenteNegativos === 'boolean') setAumentoSomenteNegativos(p.aumentoSomenteNegativos);
    if (typeof p.aumentoSomenteCoberturaBaixa === 'boolean') setAumentoSomenteCoberturaBaixa(p.aumentoSomenteCoberturaBaixa);
    if (typeof p.reducaoConfirmacao70 === 'boolean') setReducaoConfirmacao70(p.reducaoConfirmacao70);
    if (typeof p.aumentoConfirmacao70 === 'boolean') setAumentoConfirmacao70(p.aumentoConfirmacao70);

    const f = p.filtros || {};
    if (typeof f.apenasNegativos === 'boolean') setApenasNegativos(f.apenasNegativos);
    if (typeof f.continuidade === 'string') setFiltroContinuidade(f.continuidade || 'TODAS');
    if (typeof f.referencia === 'string') setFiltroReferencia(f.referencia);
    if (typeof f.cor === 'string') setFiltroCor(f.cor || 'TODAS');
    if (f.cobertura) setFiltroCobertura(f.cobertura);
    if (f.coberturaBase) setFiltroCoberturaBase(f.coberturaBase);
    if (f.taxa) setFiltroTaxa(f.taxa);

    const reprojecaoSnapshot = Array.isArray(p.reprojecaoPreview) ? p.reprojecaoPreview : [];
    setReprojecaoPreviewAtiva(Boolean(p.considerarProjecaoNova) ? reprojecaoSnapshot : []);

    const baseOriginal = dadosBaseOriginal.length ? dadosBaseOriginal : dadosBase;
    const estoqueLojasSnapshot = Array.isArray(p.estoqueLojasSnapshot) ? p.estoqueLojasSnapshot : [];
    const baseContexto =
      Boolean(p.usarEstoqueLojas) && estoqueLojasSnapshot.length > 0
        ? aplicarEstoqueLojasNaBase(baseOriginal, estoqueLojasSnapshot)
        : baseOriginal;

    const snapshot = Array.isArray(p.planos) ? p.planos : [];
    const planoPorChave = new Map(snapshot.map((i) => [i.chave, i]));
    const novo = baseContexto.map((baseItem) => {
      const snap = planoPorChave.get(chaveItem(baseItem));
      if (!snap) return baseItem;
      return { ...baseItem, plano: { ma: arredPeca(snap.ma), px: arredPeca(snap.px), ul: arredPeca(snap.ul) } };
    });
    setDadosBase(baseContexto);
    setDadosCenario(novo);
    setOkMsg(`Simulação "${sim.nome}" aplicada.`);
  }

  async function removerSimulacao(id: string) {
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`${API_URL}/api/simulacoes/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao remover simulação');
      setOkMsg('Simulação removida.');
      await carregarTudo();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao remover simulação');
    }
  }

  const linhasDetalheSimulacao = useMemo<DetalheSimulacaoLinha[]>(() => {
    if (!simulacaoDetalhe) return [];
    const planos = simulacaoDetalhe.parametros?.planos || [];
    if (!planos.length) return [];
    const basePorChave = new Map(dadosBase.map((i) => [chaveItem(i), i]));
    return planos.map((p) => {
      const base = basePorChave.get(p.chave);
      return {
        chave: p.chave,
        referencia: base?.produto?.referencia || '-',
        produto: base?.produto?.produto || base?.produto?.apresentacao || '-',
        cor: base?.produto?.cor || '-',
        tamanho: base?.produto?.tamanho || '-',
        continuidade: base?.produto?.continuidade || 'SEM CONTINUIDADE',
        ma: arredPeca(p.ma),
        px: arredPeca(p.px),
        ul: arredPeca(p.ul),
      };
    }).sort((a, b) => a.referencia.localeCompare(b.referencia));
  }, [simulacaoDetalhe, dadosBase]);

  const resumoCenario = useMemo(() => {
    const base = dadosBase.reduce((acc, i) => acc + (i.plano?.ma || 0) + (i.plano?.px || 0) + (i.plano?.ul || 0), 0);
    const cenario = dadosCenario.reduce((acc, i) => acc + (i.plano?.ma || 0) + (i.plano?.px || 0) + (i.plano?.ul || 0), 0);
    return { base, cenario, delta: cenario - base };
  }, [dadosBase, dadosCenario]);

  const resumoLaboratorio = useMemo(() => {
    const cenarioPorChave = new Map(dadosCenario.map((i) => [chaveItem(i), i]));
    const baseFiltrado = baseEscopoSimulacao;

    let alterados = 0;
    let baseTotal = 0;
    let cenarioTotal = 0;

    const porPeriodo: Record<'ma' | 'px' | 'ul', ResumoPeriodo> = {
      ma: { base: 0, cenario: 0, retirado: 0 },
      px: { base: 0, cenario: 0, retirado: 0 },
      ul: { base: 0, cenario: 0, retirado: 0 },
    };

    baseFiltrado.forEach((baseItem) => {
      const cenarioItem = cenarioPorChave.get(chaveItem(baseItem)) || baseItem;
      const bMa = arredPeca(baseItem.plano?.ma || 0);
      const bPx = arredPeca(baseItem.plano?.px || 0);
      const bUl = arredPeca(baseItem.plano?.ul || 0);
      const cMa = arredPeca(cenarioItem.plano?.ma || 0);
      const cPx = arredPeca(cenarioItem.plano?.px || 0);
      const cUl = arredPeca(cenarioItem.plano?.ul || 0);

      porPeriodo.ma.base += bMa;
      porPeriodo.ma.cenario += cMa;
      porPeriodo.px.base += bPx;
      porPeriodo.px.cenario += cPx;
      porPeriodo.ul.base += bUl;
      porPeriodo.ul.cenario += cUl;

      const totalBaseItem = bMa + bPx + bUl;
      const totalCenarioItem = cMa + cPx + cUl;
      baseTotal += totalBaseItem;
      cenarioTotal += totalCenarioItem;

      if (bMa !== cMa || bPx !== cPx || bUl !== cUl) alterados += 1;
    });

    porPeriodo.ma.retirado = Math.max(0, porPeriodo.ma.base - porPeriodo.ma.cenario);
    porPeriodo.px.retirado = Math.max(0, porPeriodo.px.base - porPeriodo.px.cenario);
    porPeriodo.ul.retirado = Math.max(0, porPeriodo.ul.base - porPeriodo.ul.cenario);

    return {
      itensEscopo: baseFiltrado.length,
      alterados,
      baseTotal,
      cenarioTotal,
      retiradoTotal: Math.max(0, baseTotal - cenarioTotal),
      porPeriodo,
    };
  }, [
    baseEscopoSimulacao,
    dadosCenario,
  ]);

  const resumoMovimento = useMemo(() => {
    const cenarioPorChave = new Map(dadosCenario.map((i) => [chaveItem(i), i]));
    const baseFiltrado = baseEscopoSimulacao;
    const out = {
      aumento: { total: 0, ma: 0, px: 0, ul: 0 },
      retirada: { total: 0, ma: 0, px: 0, ul: 0 },
    };

    baseFiltrado.forEach((b) => {
      const c = cenarioPorChave.get(chaveItem(b)) || b;
      const dMa = arredPeca(c.plano?.ma || 0) - arredPeca(b.plano?.ma || 0);
      const dPx = arredPeca(c.plano?.px || 0) - arredPeca(b.plano?.px || 0);
      const dUl = arredPeca(c.plano?.ul || 0) - arredPeca(b.plano?.ul || 0);

      out.aumento.ma += Math.max(0, dMa);
      out.aumento.px += Math.max(0, dPx);
      out.aumento.ul += Math.max(0, dUl);
      out.retirada.ma += Math.max(0, -dMa);
      out.retirada.px += Math.max(0, -dPx);
      out.retirada.ul += Math.max(0, -dUl);
    });

    out.aumento.total = out.aumento.ma + out.aumento.px + out.aumento.ul;
    out.retirada.total = out.retirada.ma + out.retirada.px + out.retirada.ul;
    return out;
  }, [
    baseEscopoSimulacao,
    dadosCenario,
  ]);

  const detalheRetiradas = useMemo<DetalheRetiradaItem[]>(() => {
    const cenarioPorChave = new Map(dadosCenario.map((i) => [chaveItem(i), i]));
    const baseFiltrado = baseEscopoSimulacao;
    const itens: DetalheRetiradaItem[] = [];

    baseFiltrado.forEach((baseItem) => {
      const cenarioItem = cenarioPorChave.get(chaveItem(baseItem)) || baseItem;
      const bMa = arredPeca(baseItem.plano?.ma || 0);
      const bPx = arredPeca(baseItem.plano?.px || 0);
      const bUl = arredPeca(baseItem.plano?.ul || 0);
      const cMa = arredPeca(cenarioItem.plano?.ma || 0);
      const cPx = arredPeca(cenarioItem.plano?.px || 0);
      const cUl = arredPeca(cenarioItem.plano?.ul || 0);

      const retiradoMA = Math.max(0, bMa - cMa);
      const retiradoPX = Math.max(0, bPx - cPx);
      const retiradoUL = Math.max(0, bUl - cUl);
      const retiradoTotal = retiradoMA + retiradoPX + retiradoUL;
      if (retiradoTotal <= 0) return;
      const baseCalc = calculaDispECobPorPlano(baseItem, projecoesAtivas, periodos, { ma: bMa, px: bPx, ul: bUl });
      const cenarioCalc = calculaDispECobPorPlano(baseItem, projecoesAtivas, periodos, { ma: cMa, px: cPx, ul: cUl });

      itens.push({
        chave: chaveItem(baseItem),
        continuidade: baseItem.produto.continuidade || 'SEM CONTINUIDADE',
        referencia: baseItem.produto.referencia || '-',
        descricao: baseItem.produto.produto || '-',
        cor: baseItem.produto.cor || '-',
        tamanho: baseItem.produto.tamanho || '-',
        retiradoMA,
        retiradoPX,
        retiradoUL,
        retiradoTotal,
        planoBaseMA: bMa,
        planoBasePX: bPx,
        planoBaseUL: bUl,
        planoCenarioMA: cMa,
        planoCenarioPX: cPx,
        planoCenarioUL: cUl,
        dispBaseMA: baseCalc.dispMA,
        dispBasePX: baseCalc.dispPX,
        dispBaseUL: baseCalc.dispUL,
        dispCenarioMA: cenarioCalc.dispMA,
        dispCenarioPX: cenarioCalc.dispPX,
        dispCenarioUL: cenarioCalc.dispUL,
        coberturaBaseMA: baseCalc.cobMA,
        coberturaBasePX: baseCalc.cobPX,
        coberturaBaseUL: baseCalc.cobUL,
        coberturaCenarioMA: cenarioCalc.cobMA,
        coberturaCenarioPX: cenarioCalc.cobPX,
        coberturaCenarioUL: cenarioCalc.cobUL,
      });
    });

    return itens.sort((a, b) => b.retiradoTotal - a.retiradoTotal);
  }, [
    baseEscopoSimulacao,
    dadosCenario,
  ]);

  const detalheRetiradasPorContinuidade = useMemo(() => {
    const mapa = new Map<string, { continuidade: string; itens: DetalheRetiradaItem[]; total: number; ma: number; px: number; ul: number }>();

    detalheRetiradas.forEach((item) => {
      const key = item.continuidade || 'SEM CONTINUIDADE';
      if (!mapa.has(key)) {
        mapa.set(key, { continuidade: key, itens: [], total: 0, ma: 0, px: 0, ul: 0 });
      }
      const grupo = mapa.get(key)!;
      grupo.itens.push(item);
      grupo.total += item.retiradoTotal;
      grupo.ma += item.retiradoMA;
      grupo.px += item.retiradoPX;
      grupo.ul += item.retiradoUL;
    });

    return Array.from(mapa.values())
      .map((g) => ({
        ...g,
        itens: g.itens.sort((a, b) => b.retiradoTotal - a.retiradoTotal),
      }))
      .sort((a, b) => b.total - a.total);
  }, [detalheRetiradas]);

  const graficosCobertura = useMemo(() => {
    type AcumSku = { total: number; cobertos: number };
    type AcumRef = { totalDisp: number; totalMin: number };
    type AcumMes = {
      total: AcumSku;
      top30: AcumSku;
      demais: AcumSku;
      kissme: AcumSku;
      refTotal: Map<string, AcumRef>;
      refTop30: Map<string, AcumRef>;
      refDemais: Map<string, AcumRef>;
      refKissme: Map<string, AcumRef>;
    };

    const initSku = (): AcumSku => ({ total: 0, cobertos: 0 });
    const initMes = (): AcumMes => ({
      total: initSku(),
      top30: initSku(),
      demais: initSku(),
      kissme: initSku(),
      refTotal: new Map(),
      refTop30: new Map(),
      refDemais: new Map(),
      refKissme: new Map(),
    });
    const meses = { MA: initMes(), PX: initMes(), UL: initMes() };

    const addRef = (mapa: Map<string, AcumRef>, ref: string, disp: number, min: number) => {
      const atual = mapa.get(ref) || { totalDisp: 0, totalMin: 0 };
      atual.totalDisp += disp;
      atual.totalMin += min;
      mapa.set(ref, atual);
    };

    const acumSku = (acc: AcumSku, cob: number) => {
      acc.total += 1;
      if (cob > 0.2) acc.cobertos += 1;
    };

    dadosCenario.forEach((item) => {
      const min = Number(item.estoques.estoque_minimo || 0);
      if (min <= 0) return;

      const ref = (item.produto.referencia || '').trim() || 'SEM REF';
      const refNorm = normalizaRef(ref);
      const id = String(item.produto.idproduto || '');
      const top30 = top30Refs.has(refNorm) || top30Ids.has(id);
      const texto = `${item.produto.produto || ''} ${item.produto.apresentacao || ''}`.toUpperCase();
      const kissme = texto.includes('KISS ME');

      const dispAtual = (item.estoques.estoque_atual || 0) - (item.demanda.pedidos_pendentes || 0);
      const emP = item.estoques.em_processo || 0;
      const ma = arredPeca(item.plano?.ma || 0);
      const px = arredPeca(item.plano?.px || 0);
      const ul = arredPeca(item.plano?.ul || 0);
      const proj = projecoesAtivas[item.produto.idproduto] ?? null;
      const prMA = proj ? projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA) : 0;
      const prPX = proj ? (proj[String(periodos.PX)] ?? 0) : 0;
      const prUL = proj ? (proj[String(periodos.UL)] ?? 0) : 0;
      const dispMA = dispAtual + emP + ma - prMA;
      const dispPX = dispMA + px - prPX;
      const dispUL = dispPX + ul - prUL;
      const cobMA = dispMA / min;
      const cobPX = dispPX / min;
      const cobUL = dispUL / min;

      const porMes: Array<{ mes: 'MA' | 'PX' | 'UL'; cob: number; disp: number }> = [
        { mes: 'MA', cob: cobMA, disp: dispMA },
        { mes: 'PX', cob: cobPX, disp: dispPX },
        { mes: 'UL', cob: cobUL, disp: dispUL },
      ];

      porMes.forEach(({ mes, cob, disp }) => {
        const target = meses[mes];
        acumSku(target.total, cob);
        addRef(target.refTotal, ref, disp, min);

        if (top30) {
          acumSku(target.top30, cob);
          addRef(target.refTop30, ref, disp, min);
        } else {
          acumSku(target.demais, cob);
          addRef(target.refDemais, ref, disp, min);
        }

        if (kissme) {
          acumSku(target.kissme, cob);
          addRef(target.refKissme, ref, disp, min);
        }
      });
    });

    const pctSku = (acc: AcumSku) => (acc.total > 0 ? clampPct((acc.cobertos / acc.total) * 100) : 0);
    const pctRef = (mapa: Map<string, AcumRef>) => {
      const refs = Array.from(mapa.values());
      if (!refs.length) return 0;
      const cobertas = refs.filter((r) => r.totalMin > 0 && (r.totalDisp / r.totalMin) > 0.2).length;
      return clampPct((cobertas / refs.length) * 100);
    };

    const toSerie = (mes: 'MA' | 'PX' | 'UL', item: AcumMes): SerieMes => ({
      mes,
      total: pctSku(item.total),
      top30: pctSku(item.top30),
      demais: pctSku(item.demais),
      kissme: pctSku(item.kissme),
    });
    const toSerieRef = (mes: 'MA' | 'PX' | 'UL', item: AcumMes): SerieMes => ({
      mes,
      total: pctRef(item.refTotal),
      top30: pctRef(item.refTop30),
      demais: pctRef(item.refDemais),
      kissme: pctRef(item.refKissme),
    });

    return {
      sku: [toSerie('MA', meses.MA), toSerie('PX', meses.PX), toSerie('UL', meses.UL)],
      ref: [toSerieRef('MA', meses.MA), toSerieRef('PX', meses.PX), toSerieRef('UL', meses.UL)],
    };
  }, [dadosCenario, projecoesAtivas, periodos, top30Ids, top30Refs]);

  const parametrosAnalyser = useMemo(() => {
    const base = cenarioEscopoSimulacao.filter((i) => !String(i.produto.produto || '').toUpperCase().includes('MEIA DE SEDA'));
    let projJan = 0; let projFev = 0; let projMarAteHoje = 0;
    let realJan = 0; let realFev = 0; let realMar = 0;
    let somaCobAtual = 0; let countCobAtual = 0;
    let negAtual = 0; let negMA = 0; let negPX = 0; let negUL = 0;
    let skusAbaixo05 = 0; let totalSkusCob = 0;
    let vacasRisco = 0; let vacasTotal = 0; let vacasCobertas = 0;
    let quickWinPecas = 0; let quickWinSkus = 0;

    base.forEach((i) => {
      const id = String(i.produto.idproduto || '');
      const ref = normalizaRef(i.produto.referencia || '');
      const isTop30 = top30Refs.has(ref) || top30Ids.has(id);

      const pj = Number(projecoesAtivas[id]?.['1'] || 0);
      const pf = Number(projecoesAtivas[id]?.['2'] || 0);
      const pm = Number(projecoesAtivas[id]?.['3'] || 0);
      const rj = Number(vendasReais[id]?.['1'] || 0);
      const rf = Number(vendasReais[id]?.['2'] || 0);
      const rm = Number(vendasReais[id]?.['3'] || 0);

      projJan += pj; projFev += pf; projMarAteHoje += projecaoMesDecorrida(pm, 3);
      realJan += rj; realFev += rf; realMar += rm;

      const min = Number(i.estoques.estoque_minimo || 0);
      const dispAtual = (i.estoques.estoque_atual || 0) - (i.demanda.pedidos_pendentes || 0);
      const emP = i.estoques.em_processo || 0;
      const ma = i.plano?.ma || 0;
      const px = i.plano?.px || 0;
      const ul = i.plano?.ul || 0;
      const prMA = projecaoMesPlanejamento(Number(projecoesAtivas[id]?.[String(periodos.MA)] || 0), periodos.MA);
      const prPX = Number(projecoesAtivas[id]?.[String(periodos.PX)] || 0);
      const prUL = Number(projecoesAtivas[id]?.[String(periodos.UL)] || 0);
      const dispMA = dispAtual + emP + ma - prMA;
      const dispPX = dispMA + px - prPX;
      const dispUL = dispPX + ul - prUL;
      const cobMA = min > 0 ? dispMA / min : 0;
      const cobUL = min > 0 ? dispUL / min : 0;

      negAtual += Math.max(0, -dispAtual);
      negMA += Math.max(0, -dispMA);
      negPX += Math.max(0, -dispPX);
      negUL += Math.max(0, -dispUL);

      if (min > 0) {
        const cobAtual = dispAtual / min;
        somaCobAtual += cobAtual;
        countCobAtual += 1;
        totalSkusCob += 1;
        if (cobUL < 0.5) skusAbaixo05 += 1;

        if (isTop30) {
          vacasTotal += 1;
          if (cobUL < 0.5) vacasRisco += 1;
          if (cobUL >= 1) vacasCobertas += 1;
        }

        // Quick win: Cobertura MA >=2 + Taxa Jan/Fev <=70% + alvo 1 + UL minimo 0.8
        const taxaJan = pj > 0 ? (rj / pj) : 1;
        const taxaFev = pf > 0 ? (rf / pf) : 1;
        if (taxaJan <= 0.7 && taxaFev <= 0.7 && cobMA >= 2) {
          const alvoDisp = min * 1;
          let excesso = Math.max(0, dispUL - alvoDisp);
          excesso = Math.floor(excesso);
          if (excesso > 0) {
            let maQ = arredPeca(ma);
            let pxQ = arredPeca(px);
            let ulQ = arredPeca(ul);
            let rest = excesso;
            const redUL = Math.min(ulQ, rest); ulQ -= redUL; rest -= redUL;
            const redPX = Math.min(pxQ, rest); pxQ -= redPX; rest -= redPX;
            const redMA = Math.min(maQ, rest); maQ -= redMA; rest -= redMA;
            const novoDispMA = dispAtual + emP + maQ - prMA;
            const novoDispPX = novoDispMA + pxQ - prPX;
            const novoDispUL = novoDispPX + ulQ - prUL;
            const novaCobUL = novoDispUL / min;
            if (novaCobUL >= 0.8) {
              const retirado = redUL + redPX + redMA;
              if (retirado > 0) {
                quickWinPecas += retirado;
                quickWinSkus += 1;
              }
            }
          }
        }
      }
    });

    const d = (real: number, proj: number) => (proj > 0 ? ((real - proj) / proj) * 100 : 0);
    const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

    return {
      variacaoJanPct: Number(d(realJan, projJan).toFixed(1)),
      variacaoFevPct: Number(d(realFev, projFev).toFixed(1)),
      variacaoMarPct: Number(d(realMar, projMarAteHoje).toFixed(1)),
      taxaJan: projJan > 0 ? realJan / projJan : 1,
      taxaFev: projFev > 0 ? realFev / projFev : 1,
      taxaMar: projMarAteHoje > 0 ? realMar / projMarAteHoje : 1,
      coberturaAtual: countCobAtual > 0 ? somaCobAtual / countCobAtual : 0,
      coberturaAlvo,
      pecasNegativasAtual: Math.round(negAtual),
      pecasNegativasMA: Math.round(negMA),
      pecasNegativasPX: Math.round(negPX),
      pecasNegativasUL: Math.round(negUL),
      pctSkusAbaixo05: Number(pct(skusAbaixo05, totalSkusCob).toFixed(1)),
      qtdVacasLeiteirasRisco: vacasRisco,
      pctCoberturaVacas: Number(pct(vacasCobertas, vacasTotal).toFixed(1)),
      vacasTotal,
      quickWinPecas: Math.round(quickWinPecas),
      quickWinSkus: Math.round(quickWinSkus),
    };
  }, [cenarioEscopoSimulacao, projecoesAtivas, vendasReais, periodos, top30Ids, top30Refs, coberturaAlvo]);

  async function executarAnalyser() {
    setExecutandoAnalyser(true);
    setError(null);
    setOkMsg(null);
    try {
      const r = await fetch(`${API_URL}/api/openai/analyser`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          nomeCenario: 'Laboratório',
          parametros: parametrosAnalyser,
          model: 'gpt-4.1-mini',
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.error || 'Erro ao executar analyser');
      setResultadoAnalyser(data as AnalyserResp);
      setOkMsg('Analyser executado com sucesso.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao executar analyser');
    } finally {
      setExecutandoAnalyser(false);
    }
  }

  function renderGraficoCobertura(title: string, series: SerieMes[]) {
    const legendas = [
      { key: 'total' as const, label: 'Total', color: 'bg-slate-500' },
      { key: 'top30' as const, label: 'Top 30', color: 'bg-blue-600' },
      { key: 'demais' as const, label: 'Demais', color: 'bg-amber-500' },
      { key: 'kissme' as const, label: 'KISS ME', color: 'bg-emerald-600' },
    ];

    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="text-xs font-semibold text-brand-dark mb-2">{title}</div>
        <div className="flex flex-wrap gap-3 text-[11px] text-gray-600 mb-3">
          {legendas.map((l) => (
            <div key={l.key} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm ${l.color}`} />
              <span>{l.label}</span>
            </div>
          ))}
        </div>
        <div className="h-56 border border-gray-200 rounded-md p-2 bg-gray-50">
          <div className="h-full grid grid-cols-3 gap-4">
            {series.map((s) => (
              <div key={s.mes} className="h-full flex flex-col">
                <div className="flex-1 flex items-end justify-center gap-1.5">
                  {legendas.map((l) => {
                    const valor = clampPct(Number(s[l.key] || 0));
                    return (
                      <div key={`${s.mes}-${l.key}`} className="w-8 flex flex-col items-center justify-end h-full">
                        <div className="text-[10px] text-gray-600 mb-1">{valor.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</div>
                        <div
                          className={`w-full rounded-t-sm ${l.color}`}
                          style={{ height: `${Math.max(2, valor)}%` }}
                          title={`${l.label} ${s.mes}: ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="pt-2 text-center text-xs font-semibold text-gray-700">{s.mes}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 min-w-0 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="bg-brand-primary shadow-sm px-6 py-3 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-white font-bold font-secondary tracking-wide text-base">LABORATÓRIO</h1>
            <p className="text-white/70 text-xs">Cenário editável do plano por filtros e cobertura alvo</p>
          </div>
          <div className="text-xs text-white/80">Filtros fixos: {MARCA_FIXA} · {STATUS_FIXO}</div>
        </header>

        <main className="flex-1 min-w-0 px-6 py-5 space-y-4">
          {loading && <div className="bg-white rounded-lg border p-4 text-sm text-gray-500">Carregando...</div>}
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}
          {okMsg && <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700">{okMsg}</div>}

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <div className="text-xs font-bold text-red-800 mb-2">Retirada</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
                  <label className="text-xs text-gray-700">Cobertura alvo
                    <input
                      type="number"
                      step="0.1"
                      value={coberturaAlvo}
                      onChange={(e) => setCoberturaAlvo(Number(e.target.value || 0))}
                      className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 bg-white"
                    />
                  </label>
                  <label className="text-xs text-gray-700">Cobertura alta &gt;=
                    <input
                      type="number"
                      step="0.1"
                      value={reducaoCoberturaMin}
                      onChange={(e) => setReducaoCoberturaMin(Number(e.target.value || 0))}
                      className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 bg-white"
                    />
                  </label>
                  <label className="text-xs text-gray-700">Base cobertura
                    <select
                      value={reducaoCoberturaBase}
                      onChange={(e) => setReducaoCoberturaBase(e.target.value as CoberturaBase)}
                      className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 bg-white"
                    >
                      <option value="ATUAL">Atual</option>
                      <option value="MA">MA</option>
                      <option value="PX">PX</option>
                      <option value="UL">UL</option>
                    </select>
                  </label>
                  <label className="text-xs text-gray-700">Cobertura mínima UL
                    <input
                      type="number"
                      step="0.1"
                      value={coberturaMinimaUL}
                      onChange={(e) => setCoberturaMinimaUL(Number(e.target.value || 0))}
                      className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 bg-white"
                    />
                  </label>
                </div>
                <div className="mt-2 flex items-center gap-4 text-xs">
                  <label className="inline-flex items-center gap-2 text-gray-700">
                    <input type="checkbox" checked={reducaoConfirmacao70} onChange={(e) => setReducaoConfirmacao70(e.target.checked)} />
                    Confirmação Jan/Fev ≤ 70%
                  </label>
                </div>
                <div className="mt-2 rounded border border-red-200 bg-white/80 px-2.5 py-2 text-[11px] text-gray-700">
                  {vendasReaisLoading ? (
                    <span className="text-amber-700 font-semibold">Carregando % atingido Jan/Fev...</span>
                  ) : (
                    <>
                      Atingido médio: Jan <strong>{indicadorAderenciaRetirada.mediaJanPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong>
                      {' '}· Fev <strong>{indicadorAderenciaRetirada.mediaFevPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong>
                      {' '}· Faixa &gt;0% e ≤50%: <strong>{indicadorAderenciaRetirada.qtdFaixa50.toLocaleString('pt-BR')}</strong>
                      {' '}/ {indicadorAderenciaRetirada.totalEscopo.toLocaleString('pt-BR')}
                      {' '}(<strong>{indicadorAderenciaRetirada.pctFaixa50.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</strong>)
                    </>
                  )}
                </div>
                <button
                  onClick={aplicarReducaoPorCobertura}
                  disabled={vendasReaisLoading}
                  title={vendasReaisLoading ? 'Aguardando carregar % atingido Jan/Fev' : ''}
                  className="mt-3 px-3 py-2 text-xs font-semibold bg-red-700 text-white rounded hover:bg-red-800 disabled:opacity-60"
                >
                  Aplicar retirada no cenário
                </button>
                <button
                  onClick={gerarSugestaoRetiradaVacas}
                  disabled={gerandoSugestaoRetirada || vendasReaisLoading}
                  title={vendasReaisLoading ? 'Aguardando carregar % atingido Jan/Fev' : ''}
                  className="mt-2 px-3 py-2 text-xs font-semibold bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-60"
                >
                  {gerandoSugestaoRetirada ? 'Gerando sugestão...' : 'Sugerir retirada'}
                </button>
                <button
                  onClick={sugerirPlanoFuturoPorConfig}
                  className="mt-2 px-3 py-2 text-xs font-semibold bg-indigo-600 text-white rounded hover:bg-indigo-700"
                >
                  Sugerir plano futuro (Configurações)
                </button>
                <div className="mt-1 text-[11px] text-gray-600">
                  Config atual: Top30 {cfgSugestaoPlano.cobertura_top30.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x ·
                  Demais {cfgSugestaoPlano.cobertura_demais.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x ·
                  KISS ME {cfgSugestaoPlano.cobertura_kissme.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x ·
                  Corte mínimo {cfgSugestaoPlano.usar_corte_minimo ? 'ATIVO' : 'INATIVO'}
                </div>
              </div>

              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-xs font-bold text-emerald-800 mb-2">Aumento</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
                  <label className="text-xs text-gray-700">Cobertura alvo
                    <input
                      type="number"
                      step="0.1"
                      value={coberturaAlvoAumento}
                      onChange={(e) => setCoberturaAlvoAumento(Number(e.target.value || 0))}
                      className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 bg-white"
                    />
                  </label>
                  <label className="text-xs text-gray-700">Cobertura baixa &lt;=
                    <input
                      type="number"
                      step="0.1"
                      value={aumentoCoberturaMax}
                      onChange={(e) => setAumentoCoberturaMax(Number(e.target.value || 0))}
                      className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 bg-white"
                    />
                  </label>
                  <label className="text-xs text-gray-700">Base cobertura
                    <select
                      value={aumentoCoberturaBase}
                      onChange={(e) => setAumentoCoberturaBase(e.target.value as CoberturaBase)}
                      className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 bg-white"
                    >
                      <option value="ATUAL">Atual</option>
                      <option value="MA">MA</option>
                      <option value="PX">PX</option>
                      <option value="UL">UL</option>
                    </select>
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
                  <label className="inline-flex items-center gap-2 text-gray-700">
                    <input type="checkbox" checked={aumentoSomenteNegativos} onChange={(e) => setAumentoSomenteNegativos(e.target.checked)} />
                    Negativos
                  </label>
                  <label className="inline-flex items-center gap-2 text-gray-700">
                    <input type="checkbox" checked={aumentoSomenteCoberturaBaixa} onChange={(e) => setAumentoSomenteCoberturaBaixa(e.target.checked)} />
                    Cobertura baixa
                  </label>
                  <label className="inline-flex items-center gap-2 text-gray-700">
                    <input type="checkbox" checked={aumentoSomenteTop30} onChange={(e) => setAumentoSomenteTop30(e.target.checked)} />
                    Só Top30
                  </label>
                  <label className="inline-flex items-center gap-2 text-gray-700">
                    <input type="checkbox" checked={aumentoConfirmacao70} onChange={(e) => setAumentoConfirmacao70(e.target.checked)} />
                    Confirmação Jan/Fev ≤ 70%
                  </label>
                </div>
                <button
                  onClick={aplicarAumentoPorCobertura}
                  className="mt-3 px-3 py-2 text-xs font-semibold bg-emerald-700 text-white rounded hover:bg-emerald-800"
                >
                  Aplicar aumento no cenário
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-3 items-center">
              <button
                onClick={() => setDadosCenario(dadosBase)}
                className="px-3 py-2 text-xs font-semibold border border-gray-300 rounded hover:bg-gray-50"
              >
                Resetar cenário
              </button>
              <div className="text-xs text-gray-500">
                Plano base: <strong>{fmtPeca(resumoCenario.base)}</strong> · Cenário: <strong>{fmtPeca(resumoCenario.cenario)}</strong> · Delta: <strong>{fmtPeca(resumoCenario.delta)}</strong> · Cob. mínima UL: <strong>{coberturaMinimaUL.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x</strong>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
              <div className="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-2.5 py-1.5">
                <span className="text-gray-600">Escopo da simulação:</span>
                <button
                  onClick={() => setUsarFiltrosTabelaNaSimulacao(true)}
                  className={`px-2 py-1 rounded border ${usarFiltrosTabelaNaSimulacao ? 'border-brand-primary bg-brand-primary/10 text-brand-dark font-semibold' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  Usar filtros da tabela
                </button>
                <button
                  onClick={() => setUsarFiltrosTabelaNaSimulacao(false)}
                  className={`px-2 py-1 rounded border ${!usarFiltrosTabelaNaSimulacao ? 'border-brand-primary bg-brand-primary/10 text-brand-dark font-semibold' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  Todos os itens
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <label className="text-xs text-gray-600 md:col-span-3">
                Nome da simulação
                <input
                  value={nomeSimulacao}
                  onChange={(e) => setNomeSimulacao(e.target.value)}
                  placeholder="Ex: Ajuste Gradual Maio v1"
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5"
                />
              </label>
              <label className="text-xs text-gray-600 md:col-span-4">
                Observações
                <input
                  value={obsSimulacao}
                  onChange={(e) => setObsSimulacao(e.target.value)}
                  placeholder="Opcional"
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5"
                />
              </label>
              <button
                onClick={salvarSimulacao}
                disabled={salvandoSimulacao}
                className="px-3 py-2 text-xs font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-60 md:col-span-2"
              >
                {salvandoSimulacao ? 'Salvando...' : 'Salvar simulação'}
              </button>
              <label className="text-xs text-gray-600 md:col-span-3">
                Simulações salvas
                <select
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-xs"
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    const sim = simulacoes.find((s) => s.id === id);
                    if (sim) aplicarSimulacao(sim);
                  }}
                >
                  <option value="">Selecionar para aplicar...</option>
                  {simulacoes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nome} ({new Date(s.createdAt).toLocaleDateString('pt-BR')})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {simulacoes.length > 0 && (
              <div className="mt-3 max-h-44 overflow-auto border border-gray-200 rounded">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr>
                      <th className="text-left px-2 py-2 border-b border-gray-200">Simulação</th>
                      <th className="text-right px-2 py-2 border-b border-gray-200">Alterados</th>
                      <th className="text-right px-2 py-2 border-b border-gray-200">Retirado</th>
                      <th className="text-right px-2 py-2 border-b border-gray-200">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simulacoes.map((s, idx) => (
                      <tr key={s.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'}>
                        <td className="px-2 py-1.5 border-b border-gray-100">
                          <div className="font-semibold text-gray-800">{s.nome}</div>
                          <div className="text-[11px] text-gray-500">
                            {new Date(s.createdAt).toLocaleString('pt-BR')}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 border-b border-gray-100 text-right">{fmtPeca(s.resumo?.alterados || 0)}</td>
                        <td className="px-2 py-1.5 border-b border-gray-100 text-right text-red-700 font-semibold">{fmtPeca(s.resumo?.retiradoTotal || 0)}</td>
                        <td className="px-2 py-1.5 border-b border-gray-100 text-right space-x-2">
                          <button
                            onClick={() => setSimulacaoDetalhe(s)}
                            className="px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                          >
                            Ver
                          </button>
                          <button
                            onClick={() => aplicarSimulacao(s)}
                            className="px-2 py-1 rounded border border-brand-primary text-brand-primary hover:bg-brand-primary/10"
                          >
                            Aplicar
                          </button>
                          <button
                            onClick={() => removerSimulacao(s.id)}
                            className="px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50"
                          >
                            Excluir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-brand-dark">Analyser no Laboratório</h2>
                <p className="text-xs text-gray-500">Termômetro e estratégia automática com base no cenário filtrado</p>
              </div>
              <button
                onClick={executarAnalyser}
                disabled={executandoAnalyser}
                className="px-3 py-2 text-xs font-semibold bg-brand-primary text-white rounded hover:bg-brand-secondary disabled:opacity-60"
              >
                {executandoAnalyser ? 'Analisando...' : 'Rodar Analyser'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-xs">
              <div className="rounded border border-gray-200 p-2">
                <div className="text-gray-500">Variação Jan</div>
                <div className="font-bold">{parametrosAnalyser.variacaoJanPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</div>
              </div>
              <div className="rounded border border-gray-200 p-2">
                <div className="text-gray-500">Variação Fev</div>
                <div className="font-bold">{parametrosAnalyser.variacaoFevPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</div>
              </div>
              <div className="rounded border border-gray-200 p-2">
                <div className="text-gray-500">Variação Mar</div>
                <div className="font-bold">{parametrosAnalyser.variacaoMarPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</div>
              </div>
              <div className="rounded border border-gray-200 p-2">
                <div className="text-gray-500">% SKUs &lt; 0.5x</div>
                <div className="font-bold">{parametrosAnalyser.pctSkusAbaixo05.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</div>
              </div>
              <div className="rounded border border-gray-200 p-2">
                <div className="text-gray-500">% Cobertura vacas</div>
                <div className="font-bold">{parametrosAnalyser.pctCoberturaVacas.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</div>
              </div>
            </div>

            <div className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
              Quick win sugerido (MA&gt;=2 + Jan/Fev&lt;=70% + alvo 1.0 + UL&gt;=0.8):
              {' '}<strong>{parametrosAnalyser.quickWinPecas.toLocaleString('pt-BR')}</strong> peças em
              {' '}<strong>{parametrosAnalyser.quickWinSkus.toLocaleString('pt-BR')}</strong> SKUs.
            </div>

            {resultadoAnalyser?.termometro && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-xs">
                <div className="rounded border border-brand-primary/30 bg-brand-primary/5 p-2">
                  <div className="text-brand-dark">Score</div>
                  <div className="text-xl font-bold text-brand-dark">{resultadoAnalyser.termometro.score.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
                </div>
                <div className="rounded border border-gray-200 p-2">
                  <div className="text-gray-500">Nível</div>
                  <div className="font-bold">{resultadoAnalyser.termometro.nivel}</div>
                </div>
                <div className="rounded border border-gray-200 p-2">
                  <div className="text-gray-500">Componente Cobertura</div>
                  <div className="font-bold">{Number(resultadoAnalyser.termometro.componentes?.cobertura || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</div>
                </div>
                <div className="rounded border border-gray-200 p-2">
                  <div className="text-gray-500">Componente Negativos</div>
                  <div className="font-bold">{Number(resultadoAnalyser.termometro.componentes?.negativos || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</div>
                </div>
              </div>
            )}

            {(resultadoAnalyser?.estrategiaBase?.filtrosSugeridos?.length || 0) > 0 && (
              <div className="rounded border border-gray-200 p-3">
                <div className="text-xs font-semibold text-brand-dark mb-2">Filtros sugeridos</div>
                <div className="space-y-1">
                  {(resultadoAnalyser?.estrategiaBase?.filtrosSugeridos || []).map((f, idx) => (
                    <div key={`${f.nome}-${idx}`} className="text-xs text-gray-700">
                      <strong>{f.objetivo}</strong> · {f.nome} <span className="text-gray-400">({f.prioridade})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Escopo da simulação</div>
              <div className="mt-1 text-xl font-bold text-brand-dark">{resumoLaboratorio.itensEscopo.toLocaleString('pt-BR')}</div>
              <div className="text-xs text-gray-500">
                {usarFiltrosTabelaNaSimulacao ? 'SKUs filtrados da tabela' : 'SKUs de toda a base'}
              </div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">SKUs alterados</div>
              <div className="mt-1 text-xl font-bold text-brand-dark">{resumoLaboratorio.alterados.toLocaleString('pt-BR')}</div>
              <div className="text-xs text-gray-500">Com mudança no plano</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Antes x Depois por mês</div>
              <div className="mt-1 text-xs text-gray-700 space-y-1">
                <div>
                  MA: <strong>{fmtPeca(resumoLaboratorio.porPeriodo.ma.base)}</strong> → <strong>{fmtPeca(resumoLaboratorio.porPeriodo.ma.cenario)}</strong>
                  <span className="text-red-700"> ({fmtPeca(resumoLaboratorio.porPeriodo.ma.cenario - resumoLaboratorio.porPeriodo.ma.base)})</span>
                </div>
                <div>
                  PX: <strong>{fmtPeca(resumoLaboratorio.porPeriodo.px.base)}</strong> → <strong>{fmtPeca(resumoLaboratorio.porPeriodo.px.cenario)}</strong>
                  <span className="text-red-700"> ({fmtPeca(resumoLaboratorio.porPeriodo.px.cenario - resumoLaboratorio.porPeriodo.px.base)})</span>
                </div>
                <div>
                  UL: <strong>{fmtPeca(resumoLaboratorio.porPeriodo.ul.base)}</strong> → <strong>{fmtPeca(resumoLaboratorio.porPeriodo.ul.cenario)}</strong>
                  <span className="text-red-700"> ({fmtPeca(resumoLaboratorio.porPeriodo.ul.cenario - resumoLaboratorio.porPeriodo.ul.base)})</span>
                </div>
              </div>
              <div className="text-xs text-gray-500">Comparativo mensal no escopo filtrado</div>
            </div>
            <div className="bg-red-50 rounded-lg border border-red-200 p-3">
              <div className="text-[11px] uppercase tracking-wide text-red-700">Peças retiradas (líquido)</div>
              <div className="mt-1 text-xl font-bold text-red-700">{fmtPeca(resumoLaboratorio.retiradoTotal)}</div>
              <div className="mt-1 text-xs text-red-700/90">
                MA {fmtPeca(resumoLaboratorio.porPeriodo.ma.retirado)} · PX {fmtPeca(resumoLaboratorio.porPeriodo.px.retirado)} · UL {fmtPeca(resumoLaboratorio.porPeriodo.ul.retirado)}
              </div>
              <button
                onClick={() => setAbrirDetalheRetirada(true)}
                className="mt-2 px-2.5 py-1 text-[11px] font-semibold rounded border border-red-300 text-red-700 bg-white hover:bg-red-100"
              >
                Ver detalhe
              </button>
            </div>
            <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-3">
              <div className="text-[11px] uppercase tracking-wide text-emerald-700">Peças incluídas</div>
              <div className="mt-1 text-xl font-bold text-emerald-700">{fmtPeca(resumoMovimento.aumento.total)}</div>
              <div className="mt-1 text-xs text-emerald-700/90">
                MA {fmtPeca(resumoMovimento.aumento.ma)} · PX {fmtPeca(resumoMovimento.aumento.px)} · UL {fmtPeca(resumoMovimento.aumento.ul)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-red-50 rounded-lg border border-red-200 p-3">
              <div className="text-[11px] uppercase tracking-wide text-red-700">Movimento de retirada bruto (base x cenário)</div>
              <div className="mt-1 text-xl font-bold text-red-700">{fmtPeca(resumoMovimento.retirada.total)}</div>
              <div className="mt-1 text-xs text-red-700/90">
                MA {fmtPeca(resumoMovimento.retirada.ma)} · PX {fmtPeca(resumoMovimento.retirada.px)} · UL {fmtPeca(resumoMovimento.retirada.ul)}
              </div>
            </div>
            <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-3">
              <div className="text-[11px] uppercase tracking-wide text-emerald-700">Movimento de aumento (base x cenário)</div>
              <div className="mt-1 text-xl font-bold text-emerald-700">{fmtPeca(resumoMovimento.aumento.total)}</div>
              <div className="mt-1 text-xs text-emerald-700/90">
                MA {fmtPeca(resumoMovimento.aumento.ma)} · PX {fmtPeca(resumoMovimento.aumento.px)} · UL {fmtPeca(resumoMovimento.aumento.ul)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {renderGraficoCobertura('Cobertura por SKUs (% com cobertura > 0.2x)', graficosCobertura.sku)}
            {renderGraficoCobertura('Cobertura por Referências (% com cobertura > 0.2x)', graficosCobertura.ref)}
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-4 py-3">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="border-l border-gray-200 pl-4">
                <label className="block text-xs font-semibold text-brand-dark mb-1">Filtro rápido</label>
                <button
                  onClick={() => setApenasNegativos((v) => !v)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded border ${apenasNegativos ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                >
                  Negativos
                </button>
              </div>

              <div className="border-l border-gray-200 pl-4">
                <label className="block text-xs font-semibold text-brand-dark mb-1">Continuidade</label>
                <select value={filtroContinuidade} onChange={(e) => setFiltroContinuidade(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-xs w-44">
                  {opcoesContinuidade.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="border-l border-gray-200 pl-4">
                <label className="block text-xs font-semibold text-brand-dark mb-1">Referência</label>
                <input value={filtroReferencia} onChange={(e) => setFiltroReferencia(e.target.value)} placeholder="ex: 4025" className="border border-gray-300 rounded px-2 py-1.5 text-xs w-32" />
              </div>

              <div className="border-l border-gray-200 pl-4">
                <label className="block text-xs font-semibold text-brand-dark mb-1">Cor</label>
                <select value={filtroCor} onChange={(e) => setFiltroCor(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-xs w-36">
                  {opcoesCor.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="border-l border-gray-200 pl-4">
                <label className="block text-xs font-semibold text-brand-dark mb-1">Cobertura</label>
                <select value={filtroCobertura} onChange={(e) => setFiltroCobertura(e.target.value as CoberturaFaixa)} className="border border-gray-300 rounded px-2 py-1.5 text-xs w-32">
                  <option value="TODAS">Todas</option>
                  <option value="NEGATIVA">{'< 0x'}</option>
                  <option value="ZERO_UM">0x a &lt;1x</option>
                  <option value="MAIOR_UM">{'>= 1x'}</option>
                  <option value="MAIOR_2">{'>= 2x'}</option>
                </select>
              </div>

              <div className="border-l border-gray-200 pl-4">
                <label className="block text-xs font-semibold text-brand-dark mb-1">Base Cobertura</label>
                <select value={filtroCoberturaBase} onChange={(e) => setFiltroCoberturaBase(e.target.value as CoberturaBase)} className="border border-gray-300 rounded px-2 py-1.5 text-xs w-28">
                  <option value="ATUAL">Atual</option>
                  <option value="MA">MA</option>
                  <option value="PX">PX</option>
                  <option value="UL">UL</option>
                </select>
              </div>

              <div className="border-l border-gray-200 pl-4">
                <label className="block text-xs font-semibold text-brand-dark mb-1">Taxa Jan/Fev</label>
                <select value={filtroTaxa} onChange={(e) => setFiltroTaxa(e.target.value as TaxaFaixa)} className="border border-gray-300 rounded px-2 py-1.5 text-xs w-36">
                  <option value="TODAS">Todas</option>
                  <option value="ATE_70">Ambas ≤ 70%</option>
                </select>
              </div>
            </div>
          </div>

          {!loading && !error && (
            <MatrizPlanejamentoTable
              dados={dadosCenario}
              projecoes={projecoes}
              vendasReais={vendasReais}
              periodos={periodos}
              apenasNegativos={apenasNegativos}
              filtroContinuidade={filtroContinuidade}
              filtroReferencia={filtroReferencia}
              filtroCor={filtroCor}
              filtroCobertura={filtroCobertura}
              filtroCoberturaBase={filtroCoberturaBase}
              filtroTaxa={filtroTaxa}
            />
          )}
        </main>
      </div>

      {abrirDetalheRetirada && (
        <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="w-full max-w-6xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-brand-primary to-brand-secondary text-white flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold tracking-wide">Detalhe de Retiradas do Laboratório</h2>
                <p className="text-xs text-white/85 mt-0.5">Comparativo antes x depois de plano, disponibilidade e cobertura (MA/PX/UL)</p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[11px] text-white/90">Nível</label>
                <select
                  value={nivelMatrizDetalhe}
                  onChange={(e) => setNivelMatrizDetalhe(e.target.value as NivelMatriz)}
                  className="px-2 py-1.5 text-xs rounded-md border border-white/40 bg-white/10 text-white"
                >
                  <option value="CONTINUIDADE" className="text-gray-900">Só continuidade</option>
                  <option value="ITEM" className="text-gray-900">Continuidade + itens</option>
                </select>
                <button
                  onClick={() => setAbrirDetalheRetirada(false)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md border border-white/40 text-white hover:bg-white/10"
                >
                  Fechar
                </button>
              </div>
            </div>

            <div className="p-5 bg-gray-50/60 max-h-[84vh] overflow-auto space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="text-[11px] uppercase tracking-wide text-gray-500">Peças retiradas</div>
                  <div className="mt-1 text-2xl font-bold text-red-700">{fmtPeca(resumoLaboratorio.retiradoTotal)}</div>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-red-700">MA</div>
                  <div className="mt-1 text-xl font-bold text-red-700">{fmtPeca(resumoLaboratorio.porPeriodo.ma.retirado)}</div>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-red-700">PX</div>
                  <div className="mt-1 text-xl font-bold text-red-700">{fmtPeca(resumoLaboratorio.porPeriodo.px.retirado)}</div>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-red-700">UL</div>
                  <div className="mt-1 text-xl font-bold text-red-700">{fmtPeca(resumoLaboratorio.porPeriodo.ul.retirado)}</div>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                  <h3 className="text-xs font-bold text-brand-dark uppercase tracking-wide">Resumo Mensal</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="text-left px-3 py-2.5 font-bold text-gray-700">Mês</th>
                        <th className="text-right px-3 py-2.5 font-bold text-gray-700">Antes</th>
                        <th className="text-right px-3 py-2.5 font-bold text-gray-700">Depois</th>
                        <th className="text-right px-3 py-2.5 font-bold text-gray-700">Retirado</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-gray-200">
                        <td className="px-3 py-2.5 font-semibold text-gray-800">MA</td>
                        <td className="px-3 py-2.5 text-right text-gray-700">{fmtPeca(resumoLaboratorio.porPeriodo.ma.base)}</td>
                        <td className="px-3 py-2.5 text-right text-gray-700">{fmtPeca(resumoLaboratorio.porPeriodo.ma.cenario)}</td>
                        <td className="px-3 py-2.5 text-right font-bold text-red-700">{fmtPeca(resumoLaboratorio.porPeriodo.ma.retirado)}</td>
                      </tr>
                      <tr className="border-t border-gray-200 bg-gray-50/70">
                        <td className="px-3 py-2.5 font-semibold text-gray-800">PX</td>
                        <td className="px-3 py-2.5 text-right text-gray-700">{fmtPeca(resumoLaboratorio.porPeriodo.px.base)}</td>
                        <td className="px-3 py-2.5 text-right text-gray-700">{fmtPeca(resumoLaboratorio.porPeriodo.px.cenario)}</td>
                        <td className="px-3 py-2.5 text-right font-bold text-red-700">{fmtPeca(resumoLaboratorio.porPeriodo.px.retirado)}</td>
                      </tr>
                      <tr className="border-t border-gray-200">
                        <td className="px-3 py-2.5 font-semibold text-gray-800">UL</td>
                        <td className="px-3 py-2.5 text-right text-gray-700">{fmtPeca(resumoLaboratorio.porPeriodo.ul.base)}</td>
                        <td className="px-3 py-2.5 text-right text-gray-700">{fmtPeca(resumoLaboratorio.porPeriodo.ul.cenario)}</td>
                        <td className="px-3 py-2.5 text-right font-bold text-red-700">{fmtPeca(resumoLaboratorio.porPeriodo.ul.retirado)}</td>
                      </tr>
                      <tr className="border-t border-gray-300 bg-red-50">
                        <td className="px-3 py-2.5 font-bold text-gray-900">TOTAL</td>
                        <td className="px-3 py-2.5 text-right font-bold text-gray-900">{fmtPeca(resumoLaboratorio.baseTotal)}</td>
                        <td className="px-3 py-2.5 text-right font-bold text-gray-900">{fmtPeca(resumoLaboratorio.cenarioTotal)}</td>
                        <td className="px-3 py-2.5 text-right font-extrabold text-red-700">{fmtPeca(resumoLaboratorio.retiradoTotal)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                  <h3 className="text-xs font-bold text-brand-dark uppercase tracking-wide">Detalhe por Continuidade e Item</h3>
                  <span className="text-[11px] text-gray-500">Grupos ordenados por maior retirada total</span>
                </div>
                <div className="max-h-[420px] overflow-auto">
                  {detalheRetiradasPorContinuidade.length === 0 && (
                    <div className="px-4 py-8 text-center text-sm text-gray-500">
                      Nenhuma peça retirada no filtro atual.
                    </div>
                  )}
                  {detalheRetiradasPorContinuidade.length > 0 && (
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0 bg-brand-primary text-white z-10">
                        <tr>
                          <th className="text-left px-2.5 py-2 font-semibold">Continuidade</th>
                          <th className="text-left px-2.5 py-2 font-semibold">Referência</th>
                          <th className="text-left px-2.5 py-2 font-semibold">Produto</th>
                          <th className="text-left px-2.5 py-2 font-semibold">Cor</th>
                          <th className="text-left px-2.5 py-2 font-semibold">Tam</th>
                          <th className="text-right px-2.5 py-2 font-semibold">MA</th>
                          <th className="text-right px-2.5 py-2 font-semibold">PX</th>
                          <th className="text-right px-2.5 py-2 font-semibold">UL</th>
                          <th className="text-right px-2.5 py-2 font-semibold">Ret. Total</th>
                          <th className="text-left px-2.5 py-2 font-semibold">Plano (MA/PX/UL)</th>
                          <th className="text-left px-2.5 py-2 font-semibold">Disp. (MA/PX/UL)</th>
                          <th className="text-left px-2.5 py-2 font-semibold">Cob. (MA/PX/UL)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detalheRetiradasPorContinuidade.map((grupo) => (
                          <Fragment key={grupo.continuidade}>
                            <tr className="bg-brand-primary/10 border-t border-gray-300">
                              <td className="px-2.5 py-2 font-bold text-brand-dark">{grupo.continuidade}</td>
                              <td className="px-2.5 py-2 text-gray-500" colSpan={4}>
                                {nivelMatrizDetalhe === 'ITEM' ? 'Subtotal da continuidade' : 'Resumo da continuidade'}
                              </td>
                              <td className="px-2.5 py-2 text-right font-bold text-red-700">{fmtPeca(grupo.ma)}</td>
                              <td className="px-2.5 py-2 text-right font-bold text-red-700">{fmtPeca(grupo.px)}</td>
                              <td className="px-2.5 py-2 text-right font-bold text-red-700">{fmtPeca(grupo.ul)}</td>
                              <td className="px-2.5 py-2 text-right font-extrabold text-red-700">{fmtPeca(grupo.total)}</td>
                              <td className="px-2.5 py-2 text-gray-400">-</td>
                              <td className="px-2.5 py-2 text-gray-400">-</td>
                              <td className="px-2.5 py-2 text-gray-400">-</td>
                            </tr>
                            {nivelMatrizDetalhe === 'ITEM' && grupo.itens.map((item, idx) => {
                              const planoAntes = `${fmtPeca(item.planoBaseMA)} / ${fmtPeca(item.planoBasePX)} / ${fmtPeca(item.planoBaseUL)}`;
                              const planoDepois = `${fmtPeca(item.planoCenarioMA)} / ${fmtPeca(item.planoCenarioPX)} / ${fmtPeca(item.planoCenarioUL)}`;
                              const dispAntes = `${fmtPeca(item.dispBaseMA)} / ${fmtPeca(item.dispBasePX)} / ${fmtPeca(item.dispBaseUL)}`;
                              const dispDepois = `${fmtPeca(item.dispCenarioMA)} / ${fmtPeca(item.dispCenarioPX)} / ${fmtPeca(item.dispCenarioUL)}`;
                              const cobAntes = `${item.coberturaBaseMA.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x / ${item.coberturaBasePX.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x / ${item.coberturaBaseUL.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;
                              const cobDepois = `${item.coberturaCenarioMA.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x / ${item.coberturaCenarioPX.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x / ${item.coberturaCenarioUL.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;
                              return (
                                <tr key={item.chave} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
                                  <td className="px-2.5 py-2 text-gray-500">{grupo.continuidade}</td>
                                  <td className="px-2.5 py-2 font-semibold text-gray-800">{item.referencia}</td>
                                  <td className="px-2.5 py-2 max-w-[260px] truncate text-gray-700" title={item.descricao}>{item.descricao}</td>
                                  <td className="px-2.5 py-2 text-gray-700">{item.cor}</td>
                                  <td className="px-2.5 py-2 text-gray-700">{item.tamanho}</td>
                                  <td className="px-2.5 py-2 text-right text-gray-700">{fmtPeca(item.retiradoMA)}</td>
                                  <td className="px-2.5 py-2 text-right text-gray-700">{fmtPeca(item.retiradoPX)}</td>
                                  <td className="px-2.5 py-2 text-right text-gray-700">{fmtPeca(item.retiradoUL)}</td>
                                  <td className="px-2.5 py-2 text-right font-bold text-red-700">{fmtPeca(item.retiradoTotal)}</td>
                                  <td className="px-2.5 py-2 text-gray-700 whitespace-nowrap">
                                    <span className="font-medium">{planoAntes}</span>
                                    <span className="mx-1 text-gray-400">→</span>
                                    <span className="font-semibold text-brand-dark">{planoDepois}</span>
                                  </td>
                                  <td className="px-2.5 py-2 text-gray-700 whitespace-nowrap">
                                    <span className="font-medium">{dispAntes}</span>
                                    <span className="mx-1 text-gray-400">→</span>
                                    <span className="font-semibold text-brand-dark">{dispDepois}</span>
                                  </td>
                                  <td className="px-2.5 py-2 text-gray-700 whitespace-nowrap">
                                    <span className="font-medium">{cobAntes}</span>
                                    <span className="mx-1 text-gray-400">→</span>
                                    <span className={`font-semibold ${item.coberturaCenarioUL < 1 ? 'text-amber-700' : 'text-emerald-700'}`}>{cobDepois}</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {simulacaoDetalhe && (
        <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-brand-primary to-brand-secondary text-white flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold tracking-wide">Detalhe da Simulação Salva</h2>
                <p className="text-xs text-white/85 mt-0.5">{simulacaoDetalhe.nome}</p>
              </div>
              <button
                onClick={() => setSimulacaoDetalhe(null)}
                className="px-3 py-1.5 text-xs font-semibold rounded-md border border-white/40 text-white hover:bg-white/10"
              >
                Fechar
              </button>
            </div>

            <div className="p-5 bg-gray-50/60 max-h-[84vh] overflow-auto space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="text-[11px] uppercase tracking-wide text-gray-500">Criada em</div>
                  <div className="mt-1 text-sm font-semibold text-brand-dark">{new Date(simulacaoDetalhe.createdAt).toLocaleString('pt-BR')}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="text-[11px] uppercase tracking-wide text-gray-500">Alterados</div>
                  <div className="mt-1 text-xl font-bold text-brand-dark">{fmtPeca(simulacaoDetalhe.resumo?.alterados || 0)}</div>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-red-700">Retirado total</div>
                  <div className="mt-1 text-xl font-bold text-red-700">{fmtPeca(simulacaoDetalhe.resumo?.retiradoTotal || 0)}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="text-[11px] uppercase tracking-wide text-gray-500">Observações</div>
                  <div className="mt-1 text-xs text-gray-700">{simulacaoDetalhe.observacoes || '-'}</div>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs">
                <div className="font-semibold text-brand-dark mb-1">Parâmetros salvos</div>
                <div className="text-gray-700">
                  Cobertura alvo: <strong>{Number(simulacaoDetalhe.parametros?.coberturaAlvo ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x</strong>
                  {' '}· Cobertura alvo aumento: <strong>{Number(simulacaoDetalhe.parametros?.coberturaAlvoAumento ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x</strong>
                  {' '}· Cobertura mínima UL: <strong>{Number(simulacaoDetalhe.parametros?.coberturaMinimaUL ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x</strong>
                </div>
                <div className="mt-1 text-gray-600">
                  Filtros: continuidade <strong>{simulacaoDetalhe.parametros?.filtros?.continuidade || 'TODAS'}</strong>,
                  {' '}referência <strong>{simulacaoDetalhe.parametros?.filtros?.referencia || 'TODAS'}</strong>,
                  {' '}cor <strong>{simulacaoDetalhe.parametros?.filtros?.cor || 'TODAS'}</strong>,
                  {' '}cobertura <strong>{simulacaoDetalhe.parametros?.filtros?.cobertura || 'TODAS'}</strong>,
                  {' '}base <strong>{simulacaoDetalhe.parametros?.filtros?.coberturaBase || 'ATUAL'}</strong>,
                  {' '}taxa <strong>{simulacaoDetalhe.parametros?.filtros?.taxa || 'TODAS'}</strong>,
                  {' '}negativos <strong>{simulacaoDetalhe.parametros?.filtros?.apenasNegativos ? 'SIM' : 'NÃO'}</strong>,
                  {' '}aumento Top30 <strong>{simulacaoDetalhe.parametros?.aumentoSomenteTop30 ? 'SIM' : 'NÃO'}</strong>,
                  {' '}aumento risco <strong>{simulacaoDetalhe.parametros?.aumentoSomenteNegativos ? 'SIM' : 'NÃO'}</strong>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                  <h3 className="text-xs font-bold text-brand-dark uppercase tracking-wide">Itens Salvos na Simulação</h3>
                </div>
                <div className="max-h-[420px] overflow-auto">
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 bg-gray-100 z-10">
                      <tr>
                        <th className="text-left px-2.5 py-2 font-semibold">Referência</th>
                        <th className="text-left px-2.5 py-2 font-semibold">Produto</th>
                        <th className="text-left px-2.5 py-2 font-semibold">Cor</th>
                        <th className="text-left px-2.5 py-2 font-semibold">Tam</th>
                        <th className="text-left px-2.5 py-2 font-semibold">Continuidade</th>
                        <th className="text-right px-2.5 py-2 font-semibold">MA</th>
                        <th className="text-right px-2.5 py-2 font-semibold">PX</th>
                        <th className="text-right px-2.5 py-2 font-semibold">UL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linhasDetalheSimulacao.length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-3 py-6 text-center text-gray-500 border-t border-gray-200">
                            Nenhum item salvo no snapshot desta simulação.
                          </td>
                        </tr>
                      )}
                      {linhasDetalheSimulacao.map((l, idx) => (
                        <tr key={`${l.chave}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
                          <td className="px-2.5 py-2 font-semibold text-gray-800">{l.referencia}</td>
                          <td className="px-2.5 py-2 max-w-[280px] truncate text-gray-700" title={l.produto}>{l.produto}</td>
                          <td className="px-2.5 py-2 text-gray-700">{l.cor}</td>
                          <td className="px-2.5 py-2 text-gray-700">{l.tamanho}</td>
                          <td className="px-2.5 py-2 text-gray-700">{l.continuidade}</td>
                          <td className="px-2.5 py-2 text-right">{fmtPeca(l.ma)}</td>
                          <td className="px-2.5 py-2 text-right">{fmtPeca(l.px)}</td>
                          <td className="px-2.5 py-2 text-right">{fmtPeca(l.ul)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
