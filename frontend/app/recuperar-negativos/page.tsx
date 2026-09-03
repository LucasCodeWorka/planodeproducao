'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { PeriodosPlano, Planejamento, ProjecoesMap } from '../types';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';
import { projecaoMesPlanejamento } from '../lib/projecao';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MARCA_FIXA = 'LIEBE';
const STATUS_FIXO = 'EM LINHA';
const PERIODOS = ['MA', 'PX', 'UL', 'QT', 'QU', 'SX'] as const;

type Periodo = typeof PERIODOS[number];
type PlanoCompleto = Record<Periodo, number>;
type CurvaABC = 'A' | 'B' | 'C' | 'D';
type ReprojecaoItem = {
  idproduto: string;
  base?: { variacaoPercentual?: number };
  original?: Partial<Record<Lowercase<Periodo>, number>>;
  recalculada?: Partial<Record<Lowercase<Periodo>, number>>;
};
type MpRiscoPeriodo = {
  em_risco: boolean;
  quantidade_mps: number;
  principal_mp: null | {
    idmateriaprima: string;
    nome: string;
    artigo: string;
    saldo: number;
    falta: number;
  };
};
type RowNegativo = {
  chave: string;
  idproduto: string;
  referencia: string;
  produto: string;
  cor: string;
  tamanho: string;
  continuidade: string;
  linha: string;
  familia: string;
  curvaABC: CurvaABC;
  estoqueMin: number;
  projAtual: number;
  projNova: number;
  variacaoProjPct: number | null;
  plano: PlanoCompleto;
  disp: PlanoCompleto;
  negativo: number;
  corteMin: number;
  sugestao: number;
  planoNovo: number;
  saldoApos: number;
  coberturaApos: number;
  saldoProximoAntes: number | null;
  saldoProximoApos: number | null;
  melhoriaProximo: number;
};
type RefGroup = {
  referencia: string;
  produto: string;
  continuidade: string;
  linha: string;
  familia: string;
  curvaABC: CurvaABC;
  itens: RowNegativo[];
  skus: number;
  estoqueMin: number;
  projAtual: number;
  projNova: number;
  variacaoProjPct: number | null;
  negativo: number;
  sugestao: number;
  planoAtual: number;
  planoNovo: number;
  saldoApos: number;
  coberturaApos: number;
  saldoProximoAntes: number | null;
  saldoProximoApos: number | null;
  melhoriaProximo: number;
};

function fmt(v: number) {
  return Math.round(v || 0).toLocaleString('pt-BR');
}

function fmtCob(v: number) {
  return `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;
}

function fmtPct(v: number | null) {
  if (v === null || !Number.isFinite(v)) return '-';
  const sinal = v > 0 ? '+' : '';
  return `${sinal}${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function norm(value: string) {
  return String(value || '').trim().toUpperCase();
}

function curvaClass(curva: CurvaABC) {
  if (curva === 'A') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (curva === 'B') return 'text-blue-700 bg-blue-50 border-blue-200';
  if (curva === 'C') return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-red-700 bg-red-50 border-red-200';
}

function variacaoClass(v: number | null) {
  if (v === null || !Number.isFinite(v)) return 'text-gray-500';
  if (v > 0) return 'text-emerald-700';
  if (v < 0) return 'text-red-700';
  return 'text-gray-700';
}

function mesSeguinte(mes: number) {
  const m = Number(mes || 0);
  if (!Number.isFinite(m) || m <= 0) return 1;
  return (m % 12) + 1;
}

function periodoSeguinte(periodo: Periodo): Periodo | null {
  const idx = PERIODOS.indexOf(periodo);
  return idx >= 0 && idx < PERIODOS.length - 1 ? PERIODOS[idx + 1] : null;
}

function roundUpByLot(qtd: number, lot: number) {
  const l = Math.max(1, Math.round(Number(lot || 0)));
  const q = Math.max(0, Number(qtd || 0));
  return Math.ceil(q / l) * l;
}

function chaveItem(item: Planejamento) {
  const id = Number(item.produto.idproduto);
  if (Number.isFinite(id)) return `ID-${id}`;
  return `REF-${item.produto.referencia || ''}-${item.produto.cor || ''}-${item.produto.tamanho || ''}`;
}

function getPlano(item: Planejamento): PlanoCompleto {
  return {
    MA: Number(item.plano?.ma || 0),
    PX: Number(item.plano?.px || 0),
    UL: Number(item.plano?.ul || 0),
    QT: Number(item.plano?.qt || 0),
    QU: Number(item.plano?.qu || 0),
    SX: Number(item.plano?.sx || 0),
  };
}

function planoParaSnapshot(chave: string, plano: PlanoCompleto) {
  return {
    chave,
    ma: Math.round(plano.MA || 0),
    px: Math.round(plano.PX || 0),
    ul: Math.round(plano.UL || 0),
    qt: Math.round(plano.QT || 0),
    qu: Math.round(plano.QU || 0),
    sx: Math.round(plano.SX || 0),
  };
}

function mesesDoPlano(periodos: PeriodosPlano) {
  const qt = Number(periodos.QT || mesSeguinte(Number(periodos.UL || 0)));
  const qu = Number(periodos.QU || mesSeguinte(qt));
  return {
    MA: Number(periodos.MA || 1),
    PX: Number(periodos.PX || mesSeguinte(Number(periodos.MA || 1))),
    UL: Number(periodos.UL || mesSeguinte(Number(periodos.PX || 1))),
    QT: qt,
    QU: qu,
    SX: mesSeguinte(qu),
  } as Record<Periodo, number>;
}

function calcularDisp(item: Planejamento, projecoes: ProjecoesMap, periodos: PeriodosPlano, plano: PlanoCompleto): PlanoCompleto {
  const meses = mesesDoPlano(periodos);
  const proj = projecoes[String(item.produto.idproduto)] || {};
  const dispAtual = Number(item.estoques.estoque_atual || 0) - Number(item.demanda.pedidos_pendentes || 0);
  let saldo = dispAtual + Number(item.estoques.em_processo || 0);
  const result = {} as PlanoCompleto;
  for (const periodo of PERIODOS) {
    const mes = meses[periodo];
    const projMes = periodo === 'MA'
      ? projecaoMesPlanejamento(Number(proj[String(mes)] || 0), mes)
      : Number(proj[String(mes)] || 0);
    saldo = saldo + Number(plano[periodo] || 0) - projMes;
    result[periodo] = saldo;
  }
  return result;
}

function mesDoPeriodo(periodos: PeriodosPlano, periodo: Periodo) {
  return mesesDoPlano(periodos)[periodo];
}

function projecaoPeriodo(projecoes: ProjecoesMap, idproduto: string, periodos: PeriodosPlano, periodo: Periodo) {
  const mes = mesDoPeriodo(periodos, periodo);
  const valor = Number(projecoes[idproduto]?.[String(mes)] || 0);
  return periodo === 'MA' ? projecaoMesPlanejamento(valor, mes) : valor;
}

function reprojecaoPeriodo(item: ReprojecaoItem | undefined, periodos: PeriodosPlano, periodo: Periodo) {
  const key = periodo.toLowerCase() as Lowercase<Periodo>;
  const valor = Number(item?.recalculada?.[key]);
  if (!Number.isFinite(valor)) return null;
  const mes = mesDoPeriodo(periodos, periodo);
  return periodo === 'MA' ? projecaoMesPlanejamento(valor, mes) : valor;
}

export default function RecuperarNegativosPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingComplementar, setLoadingComplementar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [dados, setDados] = useState<Planejamento[]>([]);
  const [projecoes, setProjecoes] = useState<ProjecoesMap>({});
  const [periodos, setPeriodos] = useState<PeriodosPlano>({
    MA: new Date().getMonth() + 1,
    PX: new Date().getMonth() + 2,
    UL: new Date().getMonth() + 3,
  });
  const [cortes, setCortes] = useState<Record<string, number>>({});
  const [curvaABC, setCurvaABC] = useState<Record<string, CurvaABC>>({});
  const [reprojecao, setReprojecao] = useState<Record<string, ReprojecaoItem>>({});
  const [periodoAlvo, setPeriodoAlvo] = useState<Periodo>('MA');
  const [usarMeioCorte, setUsarMeioCorte] = useState(true);
  const [filtroCont, setFiltroCont] = useState('TODAS');
  const [filtroCurvaABC, setFiltroCurvaABC] = useState<CurvaABC[]>([]);
  const [expandedRefs, setExpandedRefs] = useState<Set<string>>(new Set());
  const [mpModal, setMpModal] = useState<{
    open: boolean;
    titulo: string;
    loading: boolean;
    error: string | null;
    periodo: Periodo;
    skus: number;
    quantidade: number;
    risco: boolean;
    detalhe: MpRiscoPeriodo | null;
  }>({ open: false, titulo: '', loading: false, error: null, periodo: 'MA', skus: 0, quantidade: 0, risco: false, detalhe: null });

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregar() {
    setLoading(true);
    setError(null);
    setOkMsg(null);
    try {
      const params = new URLSearchParams({ limit: '5000', marca: MARCA_FIXA, status: STATUS_FIXO, prefer_cache: 'true' });
      const [rMatriz, rProj, rCortes] = await Promise.all([
        fetchNoCache(`${API_URL}/api/producao/matriz?${params}`),
        fetchNoCache(`${API_URL}/api/projecoes`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/configuracoes/corte-minimos`, { headers: authHeaders() }),
      ]);
      if (!rMatriz.ok || !rProj.ok || !rCortes.ok) throw new Error('Erro ao carregar negativos');
      const pMatriz = await rMatriz.json();
      const pProj = await rProj.json();
      const pCortes = await rCortes.json();
      const mapaCortes: Record<string, number> = {};
      for (const item of Array.isArray(pCortes?.data) ? pCortes.data : []) {
        const id = String(item?.idproduto || '').trim();
        if (id) mapaCortes[id] = Number(item?.corte_min || 0);
      }
      setDados((pMatriz?.data || []) as Planejamento[]);
      setProjecoes((pProj?.data || {}) as ProjecoesMap);
      if (pProj?.periodos) setPeriodos(pProj.periodos as PeriodosPlano);
      setCortes(mapaCortes);
      void carregarComplementares();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }

  async function carregarComplementares() {
    setLoadingComplementar(true);
    try {
      const [curvaResult, reprojResult] = await Promise.allSettled([
        fetchNoCache(`${API_URL}/api/analises/curva-abc-referencias`, { headers: authHeaders() }, 10000),
        fetchNoCache(`${API_URL}/api/projecoes/reprojecao-fechada`, { headers: authHeaders() }, 8000),
      ]);

      if (curvaResult.status === 'fulfilled' && curvaResult.value.ok) {
        const pCurva = await curvaResult.value.json();
        setCurvaABC((pCurva?.porReferencia || {}) as Record<string, CurvaABC>);
      }

      if (reprojResult.status === 'fulfilled' && reprojResult.value.ok) {
        const pReproj = await reprojResult.value.json();
        const mapaReproj: Record<string, ReprojecaoItem> = {};
        for (const item of Array.isArray(pReproj?.sugestoes) ? pReproj.sugestoes : []) {
          const id = String(item?.idproduto || '').trim();
          if (id) mapaReproj[id] = item as ReprojecaoItem;
        }
        setReprojecao(mapaReproj);
      }
    } finally {
      setLoadingComplementar(false);
    }
  }

  const rows = useMemo<RowNegativo[]>(() => {
    return dados
      .filter((item) => {
        const marca = norm(item.produto?.marca || '');
        const status = norm(item.produto?.status || '');
        const cont = norm(item.produto?.continuidade || '');
        if (marca !== MARCA_FIXA || !status.startsWith(STATUS_FIXO)) return false;
        if (filtroCont !== 'TODAS' && cont !== filtroCont) return false;
        return cont === 'PERMANENTE' || cont === 'PERMANENTE COR NOVA';
      })
      .map((item) => {
        const id = String(item.produto.idproduto || '');
        const refNorm = norm(item.produto.referencia || '');
        const curvaRef = curvaABC[refNorm] || 'B';
        const plano = getPlano(item);
        const disp = calcularDisp(item, projecoes, periodos, plano);
        const saldoPeriodo = Number(disp[periodoAlvo] || 0);
        const negativo = Math.max(0, -saldoPeriodo);
        const estoqueMin = Math.max(0, Number(item.estoques.estoque_minimo || 0));
        const projAtual = projecaoPeriodo(projecoes, id, periodos, periodoAlvo);
        const projNovaCalculada = reprojecaoPeriodo(reprojecao[id], periodos, periodoAlvo);
        const projNova = projNovaCalculada === null ? projAtual : projNovaCalculada;
        const variacaoFallbackRaw = item.calculo_estoque_minimo?.variacaoPercentual;
        const variacaoFallback = Number.isFinite(Number(variacaoFallbackRaw)) ? Number(variacaoFallbackRaw) : null;
        const variacaoProjPct = projNovaCalculada !== null
          ? (projAtual > 0 ? ((projNova - projAtual) / projAtual) * 100 : null)
          : variacaoFallback;
        const corteInteiro = Math.max(1, Number(cortes[id] || 0) || Math.round(Number(item.estoques.estoque_minimo || 1)));
        const lote = usarMeioCorte ? Math.max(1, Math.round(corteInteiro / 2)) : corteInteiro;
        const sugestao = negativo > 0 ? roundUpByLot(negativo, lote) : 0;
        const prox = periodoSeguinte(periodoAlvo);
        const saldoProximoAntes = prox ? Number(disp[prox] || 0) : null;
        const saldoProximoApos = saldoProximoAntes !== null ? saldoProximoAntes + sugestao : null;
        const negativoProximoAntes = saldoProximoAntes !== null ? Math.max(0, -saldoProximoAntes) : 0;
        const negativoProximoApos = saldoProximoApos !== null ? Math.max(0, -saldoProximoApos) : 0;
        return {
          chave: chaveItem(item),
          idproduto: id,
          referencia: item.produto.referencia || '-',
          produto: item.produto.produto || '-',
          cor: item.produto.cor || '-',
          tamanho: item.produto.tamanho || '-',
          continuidade: item.produto.continuidade || '-',
          linha: item.produto.linha || '-',
          familia: item.produto.idfamilia || '-',
          curvaABC: curvaRef,
          estoqueMin,
          projAtual,
          projNova,
          variacaoProjPct,
          plano,
          disp,
          negativo,
          corteMin: corteInteiro,
          sugestao,
          planoNovo: Number(plano[periodoAlvo] || 0) + sugestao,
          saldoApos: saldoPeriodo + sugestao,
          coberturaApos: estoqueMin > 0 ? (saldoPeriodo + sugestao) / estoqueMin : 0,
          saldoProximoAntes,
          saldoProximoApos,
          melhoriaProximo: Math.max(0, negativoProximoAntes - negativoProximoApos),
        };
      })
      .filter((row) => row.negativo > 0)
      .filter((row) => filtroCurvaABC.length === 0 || filtroCurvaABC.includes(row.curvaABC))
      .sort((a, b) => b.negativo - a.negativo);
  }, [dados, projecoes, periodos, cortes, periodoAlvo, usarMeioCorte, filtroCont, filtroCurvaABC, curvaABC, reprojecao]);

  const resumo = useMemo(() => ({
    skus: rows.length,
    negativo: rows.reduce((acc, r) => acc + r.negativo, 0),
    sugestao: rows.reduce((acc, r) => acc + r.sugestao, 0),
    refs: new Set(rows.map((r) => norm(r.referencia))).size,
    coberturaApos: rows.reduce((acc, r) => acc + r.estoqueMin, 0) > 0
      ? rows.reduce((acc, r) => acc + r.saldoApos, 0) / rows.reduce((acc, r) => acc + r.estoqueMin, 0)
      : 0,
    variacaoProjPct: rows.reduce((acc, r) => acc + r.projAtual, 0) > 0
      ? ((rows.reduce((acc, r) => acc + r.projNova, 0) - rows.reduce((acc, r) => acc + r.projAtual, 0)) / rows.reduce((acc, r) => acc + r.projAtual, 0)) * 100
      : null,
    melhoriaProximo: rows.reduce((acc, r) => acc + r.melhoriaProximo, 0),
  }), [rows]);

  const gruposRef = useMemo<RefGroup[]>(() => {
    const map = new Map<string, RowNegativo[]>();
    rows.forEach((row) => {
      const key = norm(row.referencia) || row.referencia;
      const atual = map.get(key) || [];
      atual.push(row);
      map.set(key, atual);
    });

    return Array.from(map.entries())
      .map(([referencia, itens]) => ({
        referencia,
        produto: itens[0]?.produto || '-',
        continuidade: itens[0]?.continuidade || '-',
        linha: itens[0]?.linha || '-',
        familia: itens[0]?.familia || '-',
        curvaABC: itens[0]?.curvaABC || 'B',
        itens: [...itens].sort((a, b) => `${a.cor}-${a.tamanho}`.localeCompare(`${b.cor}-${b.tamanho}`)),
        skus: itens.length,
        estoqueMin: itens.reduce((acc, r) => acc + r.estoqueMin, 0),
        projAtual: itens.reduce((acc, r) => acc + r.projAtual, 0),
        projNova: itens.reduce((acc, r) => acc + r.projNova, 0),
        variacaoProjPct: itens.reduce((acc, r) => acc + r.projAtual, 0) > 0
          ? ((itens.reduce((acc, r) => acc + r.projNova, 0) - itens.reduce((acc, r) => acc + r.projAtual, 0)) / itens.reduce((acc, r) => acc + r.projAtual, 0)) * 100
          : null,
        negativo: itens.reduce((acc, r) => acc + r.negativo, 0),
        sugestao: itens.reduce((acc, r) => acc + r.sugestao, 0),
        planoAtual: itens.reduce((acc, r) => acc + Number(r.plano[periodoAlvo] || 0), 0),
        planoNovo: itens.reduce((acc, r) => acc + r.planoNovo, 0),
        saldoApos: itens.reduce((acc, r) => acc + r.saldoApos, 0),
        coberturaApos: itens.reduce((acc, r) => acc + r.estoqueMin, 0) > 0
          ? itens.reduce((acc, r) => acc + r.saldoApos, 0) / itens.reduce((acc, r) => acc + r.estoqueMin, 0)
          : 0,
        saldoProximoAntes: itens.some((r) => r.saldoProximoAntes !== null)
          ? itens.reduce((acc, r) => acc + Number(r.saldoProximoAntes || 0), 0)
          : null,
        saldoProximoApos: itens.some((r) => r.saldoProximoApos !== null)
          ? itens.reduce((acc, r) => acc + Number(r.saldoProximoApos || 0), 0)
          : null,
        melhoriaProximo: itens.reduce((acc, r) => acc + r.melhoriaProximo, 0),
      }))
      .sort((a, b) => b.negativo - a.negativo);
  }, [rows, periodoAlvo]);

  function toggleRef(ref: string) {
    setExpandedRefs((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  }

  function expandirTodas() {
    setExpandedRefs(new Set(gruposRef.map((g) => g.referencia)));
  }

  function recolherTodas() {
    setExpandedRefs(new Set());
  }

  function toggleCurva(curva: CurvaABC) {
    setFiltroCurvaABC((prev) => {
      if (prev.includes(curva)) return prev.filter((c) => c !== curva);
      return [...prev, curva];
    });
  }

  async function verificarMpRecuperacao(titulo: string, itens: RowNegativo[]) {
    const periodoMp = ['MA', 'PX', 'UL', 'QT'].includes(periodoAlvo) ? periodoAlvo : null;
    const quantidade = itens.reduce((acc, r) => acc + r.sugestao, 0);
    if (!periodoMp) {
      setMpModal({
        open: true,
        titulo,
        loading: false,
        error: 'A checagem rapida de MP hoje cobre MA, PX, UL e QT.',
        periodo: periodoAlvo,
        skus: itens.length,
        quantidade,
        risco: false,
        detalhe: null,
      });
      return;
    }

    setMpModal({ open: true, titulo, loading: true, error: null, periodo: periodoAlvo, skus: itens.length, quantidade, risco: false, detalhe: null });
    try {
      const planos = itens.map((r) => ({
        idproduto: r.idproduto,
        idreferencia: r.referencia,
        ma: periodoMp === 'MA' ? r.sugestao : 0,
        px: periodoMp === 'PX' ? r.sugestao : 0,
        ul: periodoMp === 'UL' ? r.sugestao : 0,
        qt: periodoMp === 'QT' ? r.sugestao : 0,
      }));
      const res = await fetchNoCache(`${API_URL}/api/consumo-mp/check-risco-lote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ planos }),
      }, 120000);
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Erro ao verificar MP');
      const key = periodoMp.toLowerCase();
      const detalhes = Object.values((data.detalhe_risco_por_sku || {}) as Record<string, Record<string, MpRiscoPeriodo>>)
        .map((d) => d?.[key])
        .filter(Boolean);
      const riscos = detalhes.filter((d) => d.em_risco);
      const principal = riscos
        .map((d) => d.principal_mp)
        .filter(Boolean)
        .sort((a, b) => Number(a!.saldo || 0) - Number(b!.saldo || 0))[0] || null;
      setMpModal({
        open: true,
        titulo,
        loading: false,
        error: null,
        periodo: periodoAlvo,
        skus: itens.length,
        quantidade,
        risco: riscos.length > 0,
        detalhe: {
          em_risco: riscos.length > 0,
          quantidade_mps: riscos.reduce((acc, d) => acc + Number(d.quantidade_mps || 0), 0),
          principal_mp: principal,
        },
      });
    } catch (e) {
      setMpModal((prev) => ({ ...prev, loading: false, error: e instanceof Error ? e.message : 'Erro ao verificar MP' }));
    }
  }

  async function salvarSugestao() {
    if (!rows.length) return;
    setSalvando(true);
    setError(null);
    setOkMsg(null);
    try {
      const alterados = new Map(rows.map((r) => [r.chave, r]));
      const planos = dados
        .filter((item) => {
          const marca = norm(item.produto?.marca || '');
          const status = norm(item.produto?.status || '');
          return marca === MARCA_FIXA && status.startsWith(STATUS_FIXO);
        })
        .map((item) => {
          const plano = getPlano(item);
          const row = alterados.get(chaveItem(item));
          if (row) plano[periodoAlvo] = row.planoNovo;
          return planoParaSnapshot(chaveItem(item), plano);
        });
      const res = await fetchNoCache(`${API_URL}/api/simulacoes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          nome: `Recuperar negativos ${periodoAlvo} - ${new Date().toLocaleDateString('pt-BR')}`,
          parametros: {
            tipo: 'SUGESTAO_PLANO',
            subtipo: `RECUPERAR_NEGATIVOS_${periodoAlvo}`,
            statusAprovacao: 'PENDENTE',
            origem: 'RECUPERAR_NEGATIVOS',
            periodoAlvo,
            filtros: { continuidade: filtroCont, usarMeioCorte, curvasABC: filtroCurvaABC },
            planos,
          },
          resumo: {
            alterados: rows.length,
            deltaTotal: resumo.sugestao,
            aumentoTotal: resumo.sugestao,
            negativosCorrigidos: rows.length,
          },
          observacoes: `Sugestao resumida para zerar saldos negativos no periodo ${periodoAlvo}. Curvas: ${filtroCurvaABC.length ? filtroCurvaABC.join('/') : 'TODAS'}.`,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Erro ao salvar sugestao');
      setOkMsg(`Sugestao salva com ${rows.length.toLocaleString('pt-BR')} SKUs e ${fmt(resumo.sugestao)} pecas.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 min-w-0 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="bg-brand-primary shadow-sm px-6 py-3">
          <h1 className="text-white font-bold font-secondary tracking-wide text-base">RECUPERAR NEGATIVOS</h1>
          <p className="text-white/70 text-xs">Painel resumido para corrigir saldos negativos por periodo</p>
        </header>

        <main className="flex-1 min-w-0 px-6 py-5 space-y-4">
          {loading && <div className="bg-white rounded-lg border p-4 text-sm text-gray-500">Carregando...</div>}
          {!loading && loadingComplementar && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
              Carregando curva ABC e variacao de projecao em segundo plano.
            </div>
          )}
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}
          {okMsg && <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700">{okMsg}</div>}

          <div className="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-600">Periodo</span>
              <select value={periodoAlvo} onChange={(e) => setPeriodoAlvo(e.target.value as Periodo)} className="border border-gray-300 rounded px-2 py-1.5 text-xs">
                {PERIODOS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-600">Continuidade</span>
              <select value={filtroCont} onChange={(e) => setFiltroCont(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-xs">
                <option value="TODAS">Todas</option>
                <option value="PERMANENTE">Permanente</option>
                <option value="PERMANENTE COR NOVA">Permanente cor nova</option>
              </select>
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-600">Curva ABCD</span>
              <div className="flex items-center gap-1">
                {(['A', 'B', 'C', 'D'] as CurvaABC[]).map((curva) => (
                  <button
                    key={curva}
                    type="button"
                    onClick={() => toggleCurva(curva)}
                    className={`w-8 h-8 rounded border text-xs font-bold ${filtroCurvaABC.includes(curva) ? curvaClass(curva) : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                  >
                    {curva}
                  </button>
                ))}
                {filtroCurvaABC.length > 0 && (
                  <button type="button" onClick={() => setFiltroCurvaABC([])} className="px-2 h-8 text-[11px] font-semibold border border-gray-300 rounded hover:bg-gray-50">
                    Todas
                  </button>
                )}
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={usarMeioCorte} onChange={(e) => setUsarMeioCorte(e.target.checked)} />
              Corte min / 2
            </label>
            <button onClick={carregar} disabled={loading} className="px-3 py-1.5 text-xs font-semibold border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-60">Atualizar</button>
            <button onClick={salvarSugestao} disabled={salvando || rows.length === 0} className="px-3 py-1.5 text-xs font-semibold bg-brand-primary text-white rounded disabled:opacity-60">
              {salvando ? 'Salvando...' : 'Salvar sugestao'}
            </button>
            <button onClick={expandirTodas} disabled={gruposRef.length === 0} className="px-3 py-1.5 text-xs font-semibold border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-60">
              Abrir refs
            </button>
            <button onClick={recolherTodas} disabled={expandedRefs.size === 0} className="px-3 py-1.5 text-xs font-semibold border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-60">
              Recolher
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
            <div className="bg-white rounded-lg border border-gray-200 p-3"><div className="text-xs text-gray-500">SKUs negativos</div><div className="text-xl font-bold">{fmt(resumo.skus)}</div></div>
            <div className="bg-white rounded-lg border border-gray-200 p-3"><div className="text-xs text-gray-500">Referencias</div><div className="text-xl font-bold">{fmt(resumo.refs)}</div></div>
            <div className="bg-red-50 rounded-lg border border-red-200 p-3"><div className="text-xs text-red-700">Negativo</div><div className="text-xl font-bold text-red-700">{fmt(resumo.negativo)}</div></div>
            <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-3"><div className="text-xs text-emerald-700">Plano sugerido</div><div className="text-xl font-bold text-emerald-700">{fmt(resumo.sugestao)}</div></div>
            <div className="bg-white rounded-lg border border-gray-200 p-3"><div className="text-xs text-gray-500">Cob. apos</div><div className="text-xl font-bold">{fmtCob(resumo.coberturaApos)}</div></div>
            <div className="bg-blue-50 rounded-lg border border-blue-200 p-3"><div className="text-xs text-blue-700">Melhora prox.</div><div className="text-xl font-bold text-blue-700">{fmt(resumo.melhoriaProximo)}</div></div>
            <div className="bg-white rounded-lg border border-gray-200 p-3"><div className="text-xs text-gray-500">Var. projecao</div><div className={`text-xl font-bold ${variacaoClass(resumo.variacaoProjPct)}`}>{fmtPct(resumo.variacaoProjPct)}</div></div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-auto max-h-[70vh]">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-gray-100 z-10">
                <tr>
                  <th className="text-left px-2 py-2">Ref</th>
                  <th className="text-left px-2 py-2">Produto / SKU</th>
                  <th className="text-left px-2 py-2">Curva</th>
                  <th className="text-right px-2 py-2">SKUs</th>
                  <th className="text-left px-2 py-2">Continuidade</th>
                  <th className="text-right px-2 py-2">Negativo</th>
                  <th className="text-right px-2 py-2">Plano atual</th>
                  <th className="text-right px-2 py-2">Sugestao</th>
                  <th className="text-right px-2 py-2">Plano novo</th>
                  <th className="text-right px-2 py-2">Saldo apos</th>
                  <th className="text-right px-2 py-2">Cob. apos</th>
                  <th className="text-right px-2 py-2">Melhora prox.</th>
                  <th className="text-right px-2 py-2">Var. proj.</th>
                  <th className="text-center px-2 py-2">MP</th>
                </tr>
              </thead>
              <tbody>
                {gruposRef.slice(0, 500).map((g, idx) => {
                  const aberta = expandedRefs.has(g.referencia);
                  return (
                    <Fragment key={g.referencia}>
                      <tr
                        onClick={() => toggleRef(g.referencia)}
                        className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200 cursor-pointer hover:bg-blue-50`}
                      >
                        <td className="px-2 py-2 font-semibold whitespace-nowrap">
                          <span className="inline-block w-4 text-gray-500">{aberta ? '-' : '+'}</span>
                          {g.referencia}
                        </td>
                        <td className="px-2 py-2 min-w-[260px]">
                          <div className="font-semibold text-gray-800">{g.produto}</div>
                          <div className="text-[11px] text-gray-500">{g.linha} · Familia {g.familia}</div>
                        </td>
                        <td className="px-2 py-2">
                          <span className={`inline-flex h-6 w-6 items-center justify-center rounded border text-xs font-bold ${curvaClass(g.curvaABC)}`}>{g.curvaABC}</span>
                        </td>
                        <td className="px-2 py-2 text-right font-mono">{fmt(g.skus)}</td>
                        <td className="px-2 py-2">{g.continuidade}</td>
                        <td className="px-2 py-2 text-right font-mono text-red-700 font-semibold">{fmt(g.negativo)}</td>
                        <td className="px-2 py-2 text-right font-mono">{fmt(g.planoAtual)}</td>
                        <td className="px-2 py-2 text-right font-mono text-emerald-700 font-semibold">{fmt(g.sugestao)}</td>
                        <td className="px-2 py-2 text-right font-mono">{fmt(g.planoNovo)}</td>
                        <td className="px-2 py-2 text-right font-mono text-emerald-700">{fmt(g.saldoApos)}</td>
                        <td className="px-2 py-2 text-right font-mono">{fmtCob(g.coberturaApos)}</td>
                        <td className="px-2 py-2 text-right font-mono text-blue-700 font-semibold">{fmt(g.melhoriaProximo)}</td>
                        <td className={`px-2 py-2 text-right font-mono font-semibold ${variacaoClass(g.variacaoProjPct)}`}>{fmtPct(g.variacaoProjPct)}</td>
                        <td className="px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); verificarMpRecuperacao(`Ref ${g.referencia}`, g.itens); }}
                            className="px-2 py-1 text-[11px] font-semibold rounded border border-gray-300 bg-white hover:bg-gray-50"
                          >
                            Ver
                          </button>
                        </td>
                      </tr>
                      {aberta && g.itens.map((r) => (
                        <tr key={r.chave} className="bg-gray-50 border-t border-gray-100">
                          <td className="px-2 py-1.5 pl-8 text-gray-500">SKU</td>
                          <td className="px-2 py-1.5">
                            <span className="font-semibold">{r.cor} / {r.tamanho}</span>
                            <span className="ml-2 text-gray-500">Corte {fmt(r.corteMin)}</span>
                          </td>
                          <td className="px-2 py-1.5">
                            <span className={`inline-flex h-5 w-5 items-center justify-center rounded border text-[11px] font-bold ${curvaClass(r.curvaABC)}`}>{r.curvaABC}</span>
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono">1</td>
                          <td className="px-2 py-1.5">{r.continuidade}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-red-700 font-semibold">{fmt(r.negativo)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{fmt(r.plano[periodoAlvo])}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-emerald-700 font-semibold">{fmt(r.sugestao)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{fmt(r.planoNovo)}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-emerald-700">{fmt(r.saldoApos)}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{fmtCob(r.coberturaApos)}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-blue-700 font-semibold">{fmt(r.melhoriaProximo)}</td>
                          <td className={`px-2 py-1.5 text-right font-mono font-semibold ${variacaoClass(r.variacaoProjPct)}`}>{fmtPct(r.variacaoProjPct)}</td>
                          <td className="px-2 py-1.5 text-center">
                            <button
                              type="button"
                              onClick={() => verificarMpRecuperacao(`${r.referencia} ${r.cor}/${r.tamanho}`, [r])}
                              className="px-2 py-1 text-[11px] font-semibold rounded border border-gray-300 bg-white hover:bg-gray-50"
                            >
                              Ver
                            </button>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
                {gruposRef.length === 0 && (
                  <tr><td colSpan={14} className="px-3 py-8 text-center text-gray-500">Nenhum SKU negativo no periodo selecionado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </main>
      </div>
      {mpModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMpModal((prev) => ({ ...prev, open: false }))}>
          <div className="w-full max-w-lg rounded-lg bg-white shadow-xl border border-gray-200 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className={`px-5 py-4 ${mpModal.risco ? 'bg-red-700' : 'bg-emerald-700'}`}>
              <div className="text-white text-sm font-bold">Viabilidade de materia-prima</div>
              <div className="text-white/80 text-xs">{mpModal.titulo} · {mpModal.periodo}</div>
            </div>
            <div className="p-5 space-y-4">
              {mpModal.loading && <div className="text-sm text-gray-500">Verificando estoque e entradas de MP...</div>}
              {mpModal.error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{mpModal.error}</div>}
              {!mpModal.loading && !mpModal.error && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded border border-gray-200 bg-gray-50 p-3">
                      <div className="text-[11px] text-gray-500">SKUs</div>
                      <div className="text-lg font-bold">{fmt(mpModal.skus)}</div>
                    </div>
                    <div className="rounded border border-gray-200 bg-gray-50 p-3">
                      <div className="text-[11px] text-gray-500">Recuperar</div>
                      <div className="text-lg font-bold">{fmt(mpModal.quantidade)}</div>
                    </div>
                    <div className={`rounded border p-3 ${mpModal.risco ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
                      <div className={`text-[11px] ${mpModal.risco ? 'text-red-700' : 'text-emerald-700'}`}>Status</div>
                      <div className={`text-lg font-bold ${mpModal.risco ? 'text-red-700' : 'text-emerald-700'}`}>{mpModal.risco ? 'Falta MP' : 'OK'}</div>
                    </div>
                  </div>
                  {mpModal.risco && mpModal.detalhe?.principal_mp && (
                    <div className="rounded border border-red-200 bg-red-50 p-3 text-sm">
                      <div className="font-semibold text-red-800">Principal falta</div>
                      <div className="mt-1 text-red-700">
                        MP {mpModal.detalhe.principal_mp.idmateriaprima} · {mpModal.detalhe.principal_mp.nome || '-'}
                      </div>
                      <div className="text-xs text-red-700 mt-1">
                        Artigo {mpModal.detalhe.principal_mp.artigo || '-'} · saldo {fmt(mpModal.detalhe.principal_mp.saldo)} · falta {fmt(mpModal.detalhe.principal_mp.falta)}
                      </div>
                    </div>
                  )}
                  {!mpModal.risco && (
                    <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                      Pela checagem rapida, a recuperacao selecionada cabe com o estoque/entradas de MP considerados no projeto.
                    </div>
                  )}
                </>
              )}
              <div className="flex justify-end">
                <button type="button" onClick={() => setMpModal((prev) => ({ ...prev, open: false }))} className="px-4 py-2 text-xs font-semibold rounded border border-gray-300 hover:bg-gray-50">
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
