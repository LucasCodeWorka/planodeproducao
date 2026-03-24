'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import MatrizPlanejamentoTable from './components/MatrizPlanejamentoTable';
import Sidebar from './components/Sidebar';
import { Planejamento, ProjecoesMap, PeriodosPlano } from './types';
import { getToken, authHeaders, clearToken } from './lib/auth';
import { fetchNoCache } from './lib/api';
import { projecaoMesPlanejamento } from './lib/projecao';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MARCA_FIXA = 'LIEBE';
const STATUS_FIXO = 'EM LINHA';

type SerieMes = { mes: string; total: number; top30: number; demais: number; kissme: number };

function clampPct(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function normalizaRef(ref: string) {
  return String(ref || '').trim().toUpperCase();
}

interface CacheStatus {
  exists:     boolean;
  fresh:      boolean;
  updatedAt?: string;
  ageHours?:  number;
  count?:     number;
}

type PlanoSnapshotItem = { chave: string; ma: number; px: number; ul: number; qt?: number };
type AnaliseAprovada = {
  id: string;
  createdAt: number;
  parametros?: {
    tipo?: string;
    statusAprovacao?: 'PENDENTE' | 'APROVADA';
    planos?: PlanoSnapshotItem[];
  };
};

type ReprojecaoPreview = {
  idproduto: string;
  recalculada: { ma: number; px: number; ul: number; qt?: number };
};

function mesNormalizado(mes: number) {
  const m = Number(mes || 0);
  if (!Number.isFinite(m) || m <= 0) return 1;
  return ((m - 1) % 12) + 1;
}

function nomeMesCurto(mes: number) {
  return new Date(2000, mesNormalizado(mes) - 1, 1).toLocaleString('pt-BR', { month: 'short' });
}

function chaveItem(item: Planejamento) {
  const id = Number(item.produto.idproduto);
  if (Number.isFinite(id)) return `ID-${id}`;
  return `REF-${item.produto.referencia || ''}-${item.produto.cor || ''}-${item.produto.tamanho || ''}`;
}

export default function Home() {
  const router = useRouter();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dados,        setDados]        = useState<Planejamento[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [fromCache,    setFromCache]    = useState(false);
  const [cacheStatus,  setCacheStatus]  = useState<CacheStatus | null>(null);
  const [refreshing,   setRefreshing]   = useState(false);
  const [refreshMsg,   setRefreshMsg]   = useState<string | null>(null);
  const [building,     setBuilding]     = useState(false);
  const [buildElapsed, setBuildElapsed] = useState(0);
  const [apenasNegativos, setApenasNegativos] = useState(false);
  const [filtroContinuidade, setFiltroContinuidade] = useState<string[]>([]);
  const [filtroReferencia, setFiltroReferencia] = useState('');
  const [filtroCor, setFiltroCor] = useState('TODAS');
  const [filtroCobertura, setFiltroCobertura] = useState<'TODAS' | 'NEGATIVA' | 'ZERO_UM' | 'MAIOR_UM' | 'MAIOR_2'>('TODAS');
  const [filtroCoberturaBase, setFiltroCoberturaBase] = useState<'ATUAL' | 'MA' | 'PX' | 'UL' | 'QT'>('ATUAL');
  const [filtroTaxa, setFiltroTaxa] = useState<'TODAS' | 'ATE_70'>('TODAS');
  const [projecoes,    setProjecoes]    = useState<ProjecoesMap>({});
  const [vendasReais,  setVendasReais]  = useState<Record<string, Record<string, number>>>({});
  const [top30Ids,     setTop30Ids]     = useState<Set<string>>(new Set());
  const [top30Refs,    setTop30Refs]    = useState<Set<string>>(new Set());
  const [periodos,     setPeriodos]     = useState<PeriodosPlano>({ MA: new Date().getMonth() + 1, PX: new Date().getMonth() + 2, UL: new Date().getMonth() + 3 });
  const [aplicarAprovadas, setAplicarAprovadas] = useState(false);
  const [aprovadas, setAprovadas] = useState<AnaliseAprovada[]>([]);
  const [aprovadasSelecionadasIds, setAprovadasSelecionadasIds] = useState<string[]>([]);
  const [abrirSeletorAprovadas, setAbrirSeletorAprovadas] = useState(false);
  const [abrirSeletorContinuidade, setAbrirSeletorContinuidade] = useState(false);
  const [considerarProjecaoNova, setConsiderarProjecaoNova] = useState(false);
  const [reprojecaoPreview, setReprojecaoPreview] = useState<ReprojecaoPreview[]>([]);
  const [recalculandoProjecao, setRecalculandoProjecao] = useState(false);
  const [resultadoReprojecaoMsg, setResultadoReprojecaoMsg] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reprojecaoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    buscarDados();
    buscarStatusCache();
    buscarProjecoes();
    buscarReprojecaoFechada();
    buscarTop30();
    buscarAprovadas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function buscarStatusCache() {
    try {
      const res = await fetchNoCache(`${API_URL}/api/admin/status`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) setCacheStatus(data.cache);
    } catch { /* silencioso */ }
  }

  async function buscarProjecoes() {
    try {
      const res  = await fetchNoCache(`${API_URL}/api/projecoes`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setProjecoes(data.data as ProjecoesMap);
        if (data.periodos) setPeriodos(data.periodos as PeriodosPlano);
      }
    } catch { /* silencioso */ }
  }

  async function buscarTop30() {
    try {
      const res = await fetchNoCache(`${API_URL}/api/analises/top30-produtos`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setTop30Ids(new Set(((data && data.ids) || []).map((v: string) => String(v))));
      setTop30Refs(new Set(((data && data.referencias) || []).map((v: string) => normalizaRef(v))));
    } catch { /* silencioso */ }
  }

  async function buscarReprojecaoFechada() {
    try {
      const res = await fetchNoCache(`${API_URL}/api/projecoes/reprojecao-fechada`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setReprojecaoPreview(Array.isArray(data.sugestoes) ? data.sugestoes : []);
      }
    } catch {
      setReprojecaoPreview([]);
    }
  }

  async function buscarAprovadas() {
    try {
      const res = await fetchNoCache(`${API_URL}/api/simulacoes`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const lista = (Array.isArray(data?.data) ? data.data : []) as AnaliseAprovada[];
      const aprov = lista.filter((a) => a?.parametros?.statusAprovacao === 'APROVADA' && Array.isArray(a?.parametros?.planos));
      setAprovadas(aprov);
      setAprovadasSelecionadasIds((prev) => {
        if (!prev.length) return aprov.map((a) => a.id);
        const validos = prev.filter((id) => aprov.some((a) => a.id === id));
        return validos.length ? validos : aprov.map((a) => a.id);
      });
    } catch {
      setAprovadas([]);
      setAprovadasSelecionadasIds([]);
    }
  }

  async function carregarVendasReais(ids: number[]) {
    if (!ids.length) {
      setVendasReais({});
      return;
    }
    try {
      const rReal = await fetchNoCache(`${API_URL}/api/analises/projecao-vs-venda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ano: new Date().getFullYear(), ids }),
      });
      if (!rReal.ok) throw new Error(`Vendas reais erro ${rReal.status}`);
      const pReal = await rReal.json();
      setVendasReais((pReal && pReal.data) || {});
    } catch {
      setVendasReais({});
    }
  }

  const buscarDados = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: '5000',
        marca: MARCA_FIXA,
        status: STATUS_FIXO
      });
      const res    = await fetchNoCache(`${API_URL}/api/producao/matriz?${params}`);
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const payload = await res.json();
      if (!payload.success) throw new Error(payload.error || 'Erro no servidor');
      const rows = payload.data as Planejamento[];
      setDados(rows);
      const ids = rows
        .map((i) => Number(i.produto.idproduto))
        .filter((n) => Number.isFinite(n))
        .slice(0, 2500);
      carregarVendasReais(ids);
      setFromCache(payload.fromCache ?? false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!building) return;
    const startedAt = Date.now();
    pollRef.current = setInterval(async () => {
      setBuildElapsed(Math.round((Date.now() - startedAt) / 1000));
      try {
        const res  = await fetchNoCache(`${API_URL}/api/admin/build-status`, { headers: authHeaders() });
        if (res.status === 401) {
          clearToken();
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          setBuilding(false);
          setRefreshing(false);
          setRefreshMsg(null);
          setError('Sessao expirada. Faca login novamente.');
          router.replace('/login');
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (!data.buildState.running) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setBuilding(false);
          setRefreshing(false);
          if (data.buildState.error) {
            setRefreshMsg(null);
            setError(`Erro ao atualizar: ${data.buildState.error}`);
          } else {
            const mins = (data.buildState.durationMs / 1000 / 60).toFixed(1);
            setRefreshMsg(`Cache atualizado — ${data.buildState.count} produtos em ${mins} min`);
            if (data.cache) setCacheStatus(data.cache);
            await buscarDados();
          }
        }
      } catch { /* silencioso */ }
    }, 3000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [building, buscarDados]);

  useEffect(() => {
    return () => {
      if (reprojecaoTimeoutRef.current) clearTimeout(reprojecaoTimeoutRef.current);
    };
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    setBuilding(false);
    setBuildElapsed(0);
    setRefreshMsg('Iniciando atualização em background...');
    setError(null);
    try {
      const res  = await fetchNoCache(`${API_URL}/api/admin/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ marca: MARCA_FIXA, status: STATUS_FIXO }),
      });
      if (res.status === 401) {
        setRefreshing(false);
        setRefreshMsg(null);
        clearToken();
        setError('Sessao expirada. Faca login novamente.');
        router.replace('/login');
        return;
      }
      const data = await res.json();
      if (!res.ok || !data.success) {
        setRefreshing(false); setRefreshMsg(null);
        setError(data.error || 'Erro ao iniciar atualização');
        return;
      }
      setRefreshMsg(data.alreadyRunning ? 'Atualização já em andamento...' : 'Atualizando dados...');
      setBuilding(true);
      setBuildElapsed(0);
    } catch (err) {
      setRefreshing(false); setRefreshMsg(null);
      setError(err instanceof Error ? err.message : 'Erro ao iniciar atualização');
    }
  }

  const planosAprovadosMap = useMemo(() => {
    const map = new Map<string, { ma: number; px: number; ul: number; qt: number }>();
    const base = aprovadas.filter((a) => aprovadasSelecionadasIds.includes(a.id));
    const ordenadas = [...base].sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    for (const a of ordenadas) {
      const planos = Array.isArray(a?.parametros?.planos) ? a.parametros!.planos! : [];
      for (const p of planos) {
        const k = String(p?.chave || '').trim();
        if (!k) continue;
        map.set(k, {
          ma: Number(p?.ma || 0),
          px: Number(p?.px || 0),
          ul: Number(p?.ul || 0),
          qt: Number(p?.qt || 0),
        });
      }
    }
    return map;
  }, [aprovadas, aprovadasSelecionadasIds]);

  const dadosAtivos = useMemo(() => {
    if (!aplicarAprovadas || planosAprovadosMap.size === 0) return dados;
    return dados.map((i) => {
      const k = chaveItem(i);
      const p = planosAprovadosMap.get(k);
      if (!p) return i;
      return {
        ...i,
        plano: {
          ...(i.plano || {}),
          ma: p.ma,
          px: p.px,
          ul: p.ul,
          qt: p.qt,
        },
      };
    });
  }, [dados, aplicarAprovadas, planosAprovadosMap]);

  const dadosPagina = useMemo(() => {
    if (filtroContinuidade.length === 0) return dadosAtivos;
    const selecionadas = new Set(filtroContinuidade.map((v) => String(v || '').trim()));
    return dadosAtivos.filter((i) => selecionadas.has((i.produto.continuidade || '').trim()));
  }, [dadosAtivos, filtroContinuidade]);

  const projecoesAtivas = useMemo<ProjecoesMap>(() => {
    if (!considerarProjecaoNova || reprojecaoPreview.length === 0) return projecoes;
    const clone: ProjecoesMap = { ...projecoes };
    for (const item of reprojecaoPreview) {
      const id = String(item.idproduto || '');
      if (!id) continue;
      const base = clone[id] ? { ...clone[id] } : {};
      base[String(periodos.MA)] = Number(item.recalculada?.ma || 0);
      base[String(periodos.PX)] = Number(item.recalculada?.px || 0);
      base[String(periodos.UL)] = Number(item.recalculada?.ul || 0);
      base[String(mesNormalizado((periodos.UL || 0) + 1))] = Number(item.recalculada?.qt || 0);
      clone[id] = base;
    }
    return clone;
  }, [considerarProjecaoNova, reprojecaoPreview, projecoes, periodos]);

  const resumoMudancaProjecao = useMemo(() => {
    let alterados = 0;
    let deltaMA = 0;
    let deltaPX = 0;
    let deltaUL = 0;
    let deltaQT = 0;
    const mesQT = mesNormalizado((periodos.UL || 0) + 1);
    for (const item of dadosPagina) {
      const id = String(item.produto.idproduto || '');
      const originalMA = Number(projecoes[id]?.[String(periodos.MA)] || 0);
      const originalPX = Number(projecoes[id]?.[String(periodos.PX)] || 0);
      const originalUL = Number(projecoes[id]?.[String(periodos.UL)] || 0);
      const originalQT = Number(projecoes[id]?.[String(mesQT)] || 0);
      const novoMA = Number(projecoesAtivas[id]?.[String(periodos.MA)] || 0);
      const novoPX = Number(projecoesAtivas[id]?.[String(periodos.PX)] || 0);
      const novoUL = Number(projecoesAtivas[id]?.[String(periodos.UL)] || 0);
      const novoQT = Number(projecoesAtivas[id]?.[String(mesQT)] || 0);
      if (
        Math.round(originalMA) !== Math.round(novoMA) ||
        Math.round(originalPX) !== Math.round(novoPX) ||
        Math.round(originalUL) !== Math.round(novoUL) ||
        Math.round(originalQT) !== Math.round(novoQT)
      ) {
        alterados += 1;
      }
      deltaMA += novoMA - originalMA;
      deltaPX += novoPX - originalPX;
      deltaUL += novoUL - originalUL;
      deltaQT += novoQT - originalQT;
    }
    return {
      alterados,
      deltaMA: Math.round(deltaMA),
      deltaPX: Math.round(deltaPX),
      deltaUL: Math.round(deltaUL),
      deltaQT: Math.round(deltaQT),
    };
  }, [dadosPagina, projecoes, projecoesAtivas, periodos]);

  useEffect(() => {
    if (reprojecaoTimeoutRef.current) clearTimeout(reprojecaoTimeoutRef.current);
    setResultadoReprojecaoMsg(null);
    if (!considerarProjecaoNova) {
      setRecalculandoProjecao(false);
      return;
    }
    setRecalculandoProjecao(true);
    reprojecaoTimeoutRef.current = setTimeout(() => {
      setRecalculandoProjecao(false);
      if (reprojecaoPreview.length === 0) {
        setResultadoReprojecaoMsg('Sem preview de reprojeção disponível.');
        return;
      }
      if (resumoMudancaProjecao.alterados === 0) {
        setResultadoReprojecaoMsg('Nenhum item teve projeção alterada.');
        return;
      }
      setResultadoReprojecaoMsg(
        `${resumoMudancaProjecao.alterados.toLocaleString('pt-BR')} itens com projeção alterada. ` +
        `Δ MA ${resumoMudancaProjecao.deltaMA.toLocaleString('pt-BR')} · ` +
        `Δ PX ${resumoMudancaProjecao.deltaPX.toLocaleString('pt-BR')} · ` +
        `Δ UL ${resumoMudancaProjecao.deltaUL.toLocaleString('pt-BR')} · ` +
        `Δ QT ${resumoMudancaProjecao.deltaQT.toLocaleString('pt-BR')}`
      );
    }, 550);
  }, [considerarProjecaoNova, reprojecaoPreview, resumoMudancaProjecao]);

  const totais = useMemo(() => dadosPagina.reduce(
    (acc, i) => ({
      itens:      acc.itens      + 1,
      estoque:    acc.estoque    + (i.estoques.estoque_atual    || 0),
      emProc:     acc.emProc     + (i.estoques.em_processo      || 0),
      estoqueMin: acc.estoqueMin + (i.estoques.estoque_minimo   || 0),
      pedidos:    acc.pedidos    + (i.demanda.pedidos_pendentes  || 0),
    }),
    { itens: 0, estoque: 0, emProc: 0, estoqueMin: 0, pedidos: 0 }
  ), [dadosPagina]);

  const analiseCobertura = useMemo(() => {
    let base = dadosPagina;

    if (apenasNegativos) {
      base = base.filter((i) => {
        const dispAtual = (i.estoques.estoque_atual || 0) - (i.demanda.pedidos_pendentes || 0);
        const proj = projecoesAtivas[i.produto.idproduto] ?? null;
        if (!proj) return dispAtual < 0;

        const emP = i.estoques.em_processo || 0;
        const pMA = i.plano?.ma || 0;
        const pPX = i.plano?.px || 0;
        const pUL = i.plano?.ul || 0;
        const pQT = (i.plano as { qt?: number } | undefined)?.qt || 0;
        const prMA = projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA);
        const prPX = proj[String(periodos.PX)] ?? 0;
        const prUL = proj[String(periodos.UL)] ?? 0;
        const prQT = proj[String(mesNormalizado((periodos.UL || 0) + 1))] ?? 0;
        const dispMA = dispAtual + emP + pMA - prMA;
        const dispPX = dispMA + pPX - prPX;
        const dispUL = dispPX + pUL - prUL;
        const dispQT = dispUL + pQT - prQT;
        return dispAtual < 0 || dispMA < 0 || dispPX < 0 || dispUL < 0 || dispQT < 0;
      });
    }

    const buckets = [
      { key: 'negativo', label: '< 0x', atual: 0, ultimo: 0 },
      { key: 'baixo', label: '0x a < 1x', atual: 0, ultimo: 0 },
      { key: 'alerta', label: '1x a < 1.5x', atual: 0, ultimo: 0 },
      { key: 'bom', label: '1.5x a < 2x', atual: 0, ultimo: 0 },
      { key: 'alto', label: '>= 2x', atual: 0, ultimo: 0 },
    ];

    let somaAtual = 0;
    let somaUltimo = 0;
    let countCobertura = 0;
    let criticoAtual = 0;
    let criticoUltimo = 0;
    let linhaAtual = 0;
    let linhaUltimo = 0;
    let riscoAtual = 0;
    let riscoUltimo = 0;
    let negativoAtual = 0;
    let negativoUltimo = 0;

    const bucketIndex = (cob: number) => {
      if (cob < 0) return 0;
      if (cob < 1) return 1;
      if (cob < 1.5) return 2;
      if (cob < 2) return 3;
      return 4;
    };

    for (const i of base) {
      const min = i.estoques.estoque_minimo || 0;
      if (min <= 0) continue;

      const dispAtual = (i.estoques.estoque_atual || 0) - (i.demanda.pedidos_pendentes || 0);
      const proj = projecoesAtivas[i.produto.idproduto] ?? null;
      const emP = i.estoques.em_processo || 0;
      const pMA = i.plano?.ma || 0;
      const pPX = i.plano?.px || 0;
      const pUL = i.plano?.ul || 0;
      const pQT = (i.plano as { qt?: number } | undefined)?.qt || 0;
      const prMA = proj ? projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA) : 0;
      const prPX = proj ? (proj[String(periodos.PX)] ?? 0) : 0;
      const prUL = proj ? (proj[String(periodos.UL)] ?? 0) : 0;
      const prQT = proj ? (proj[String(mesNormalizado((periodos.UL || 0) + 1))] ?? 0) : 0;
      const dispUltimo = dispAtual + emP + pMA - prMA + pPX - prPX + pUL - prUL + pQT - prQT;

      const cobAtual = dispAtual / min;
      const cobUltimo = dispUltimo / min;

      buckets[bucketIndex(cobAtual)].atual += 1;
      buckets[bucketIndex(cobUltimo)].ultimo += 1;

      somaAtual += cobAtual;
      somaUltimo += cobUltimo;
      countCobertura += 1;
      if (cobAtual < 1) criticoAtual += 1;
      if (cobUltimo < 1) criticoUltimo += 1;
      if (cobAtual < 0) negativoAtual += 1;
      else if (cobAtual < 0.5) riscoAtual += 1;
      else linhaAtual += 1;

      if (cobUltimo < 0) negativoUltimo += 1;
      else if (cobUltimo < 0.5) riscoUltimo += 1;
      else linhaUltimo += 1;
    }

    return {
      buckets,
      countCobertura,
      mediaAtual: countCobertura ? somaAtual / countCobertura : 0,
      mediaUltimo: countCobertura ? somaUltimo / countCobertura : 0,
      criticoAtual,
      criticoUltimo,
      totalBuckets: buckets.reduce((acc, b) => Math.max(acc, b.atual, b.ultimo), 0),
      linhaAtualPct: countCobertura ? (linhaAtual / countCobertura) * 100 : 0,
      linhaUltimoPct: countCobertura ? (linhaUltimo / countCobertura) * 100 : 0,
      riscoAtualPct: countCobertura ? (riscoAtual / countCobertura) * 100 : 0,
      riscoUltimoPct: countCobertura ? (riscoUltimo / countCobertura) * 100 : 0,
      negativoAtualPct: countCobertura ? (negativoAtual / countCobertura) * 100 : 0,
      negativoUltimoPct: countCobertura ? (negativoUltimo / countCobertura) * 100 : 0,
    };
  }, [dadosPagina, apenasNegativos, projecoesAtivas, periodos]);

  const resumoNegativos = useMemo(() => {
    let base = dadosPagina;

    let atual = 0;
    let ma = 0;
    let px = 0;
    let ul = 0;
    let qt = 0;
    const porContinuidade = new Map<string, { atual: number; ma: number; px: number; ul: number; qt: number }>();

    for (const i of base) {
      const continuidade = (i.produto.continuidade || 'SEM CONTINUIDADE').trim();
      const bucket = porContinuidade.get(continuidade) || { atual: 0, ma: 0, px: 0, ul: 0, qt: 0 };
      const dispAtual = (i.estoques.estoque_atual || 0) - (i.demanda.pedidos_pendentes || 0);
      const proj = projecoesAtivas[i.produto.idproduto] ?? null;
      const emP = i.estoques.em_processo || 0;
      const pMA = i.plano?.ma || 0;
      const pPX = i.plano?.px || 0;
      const pUL = i.plano?.ul || 0;
      const pQT = (i.plano as { qt?: number } | undefined)?.qt || 0;
      const prMA = proj ? projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA) : 0;
      const prPX = proj ? (proj[String(periodos.PX)] ?? 0) : 0;
      const prUL = proj ? (proj[String(periodos.UL)] ?? 0) : 0;
      const prQT = proj ? (proj[String(mesNormalizado((periodos.UL || 0) + 1))] ?? 0) : 0;
      const dispMA = dispAtual + emP + pMA - prMA;
      const dispPX = dispMA + pPX - prPX;
      const dispUL = dispPX + pUL - prUL;
      const dispQT = dispUL + pQT - prQT;

      if (dispAtual < 0) atual += Math.abs(dispAtual);
      if (dispMA < 0) ma += Math.abs(dispMA);
      if (dispPX < 0) px += Math.abs(dispPX);
      if (dispUL < 0) ul += Math.abs(dispUL);
      if (dispQT < 0) qt += Math.abs(dispQT);

      if (dispAtual < 0) bucket.atual += Math.abs(dispAtual);
      if (dispMA < 0) bucket.ma += Math.abs(dispMA);
      if (dispPX < 0) bucket.px += Math.abs(dispPX);
      if (dispUL < 0) bucket.ul += Math.abs(dispUL);
      if (dispQT < 0) bucket.qt += Math.abs(dispQT);
      porContinuidade.set(continuidade, bucket);
    }

    return {
      atual: Math.round(atual),
      ma: Math.round(ma),
      px: Math.round(px),
      ul: Math.round(ul),
      qt: Math.round(qt),
      continuidade: Array.from(porContinuidade.entries())
        .map(([nome, valores]) => ({
          nome,
          atual: Math.round(valores.atual),
          ma: Math.round(valores.ma),
          px: Math.round(valores.px),
          ul: Math.round(valores.ul),
          qt: Math.round(valores.qt),
        }))
        .sort((a, b) => {
          const ordem: Record<string, number> = {
            'PERMANENTE': 1,
            'PERMANENTE COR NOVA': 2,
          };
          const oa = ordem[(a.nome || '').toUpperCase()] ?? 999;
          const ob = ordem[(b.nome || '').toUpperCase()] ?? 999;
          if (oa !== ob) return oa - ob;
          return a.nome.localeCompare(b.nome);
        }),
    };
  }, [dadosPagina, projecoesAtivas, periodos]);

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

    const meses = { MA: initMes(), PX: initMes(), UL: initMes(), QT: initMes() };
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
    const pctSku = (acc: AcumSku) => (acc.total > 0 ? clampPct((acc.cobertos / acc.total) * 100) : 0);
    const pctRef = (mapa: Map<string, AcumRef>) => {
      const refs = Array.from(mapa.values());
      if (!refs.length) return 0;
      const cobertas = refs.filter((r) => r.totalMin > 0 && (r.totalDisp / r.totalMin) > 0.2).length;
      return clampPct((cobertas / refs.length) * 100);
    };

    dadosPagina.forEach((i) => {
      const min = Number(i.estoques.estoque_minimo || 0);
      if (min <= 0) return;
      const ref = (i.produto.referencia || '').trim() || 'SEM REF';
      const id = String(i.produto.idproduto || '');
      const isTop30 = top30Refs.has(normalizaRef(ref)) || top30Ids.has(id);
      const texto = `${i.produto.produto || ''} ${i.produto.apresentacao || ''}`.toUpperCase();
      const isKissMe = texto.includes('KISS ME');

      const dispAtual = (i.estoques.estoque_atual || 0) - (i.demanda.pedidos_pendentes || 0);
      const emP = i.estoques.em_processo || 0;
      const pMA = i.plano?.ma || 0;
      const pPX = i.plano?.px || 0;
      const pUL = i.plano?.ul || 0;
      const pQT = (i.plano as { qt?: number } | undefined)?.qt || 0;
      const proj = projecoesAtivas[i.produto.idproduto] ?? null;
      const prMA = proj ? projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA) : 0;
      const prPX = proj ? (proj[String(periodos.PX)] ?? 0) : 0;
      const prUL = proj ? (proj[String(periodos.UL)] ?? 0) : 0;
      const prQT = proj ? (proj[String(mesNormalizado((periodos.UL || 0) + 1))] ?? 0) : 0;
      const dispMA = dispAtual + emP + pMA - prMA;
      const dispPX = dispMA + pPX - prPX;
      const dispUL = dispPX + pUL - prUL;
      const dispQT = dispUL + pQT - prQT;

      const porMes: Array<{ mes: 'MA' | 'PX' | 'UL' | 'QT'; cob: number; disp: number }> = [
        { mes: 'MA', cob: dispMA / min, disp: dispMA },
        { mes: 'PX', cob: dispPX / min, disp: dispPX },
        { mes: 'UL', cob: dispUL / min, disp: dispUL },
        { mes: 'QT', cob: dispQT / min, disp: dispQT },
      ];

      porMes.forEach(({ mes, cob, disp }) => {
        const t = meses[mes];
        acumSku(t.total, cob);
        addRef(t.refTotal, ref, disp, min);
        if (isTop30) {
          acumSku(t.top30, cob);
          addRef(t.refTop30, ref, disp, min);
        } else {
          acumSku(t.demais, cob);
          addRef(t.refDemais, ref, disp, min);
        }
        if (isKissMe) {
          acumSku(t.kissme, cob);
          addRef(t.refKissme, ref, disp, min);
        }
      });
    });

    const toSku = (mes: 'MA' | 'PX' | 'UL' | 'QT', x: AcumMes): SerieMes => ({
      mes, total: pctSku(x.total), top30: pctSku(x.top30), demais: pctSku(x.demais), kissme: pctSku(x.kissme),
    });
    const toRef = (mes: 'MA' | 'PX' | 'UL' | 'QT', x: AcumMes): SerieMes => ({
      mes, total: pctRef(x.refTotal), top30: pctRef(x.refTop30), demais: pctRef(x.refDemais), kissme: pctRef(x.refKissme),
    });

    return {
      sku: [toSku('MA', meses.MA), toSku('PX', meses.PX), toSku('UL', meses.UL), toSku('QT', meses.QT)],
      ref: [toRef('MA', meses.MA), toRef('PX', meses.PX), toRef('UL', meses.UL), toRef('QT', meses.QT)],
    };
  }, [dadosPagina, projecoesAtivas, periodos, top30Ids, top30Refs]);

  const opcoesContinuidade = useMemo(
    () => Array.from(new Set(dadosAtivos.map((i) => (i.produto.continuidade || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [dadosAtivos]
  );
  const opcoesCor = useMemo(
    () => ['TODAS', ...Array.from(new Set(dadosPagina.map((i) => (i.produto.cor || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))],
    [dadosPagina]
  );

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />

      <div className={`flex-1 min-w-0 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>

        {/* Header */}
        <header className="bg-brand-primary shadow-sm px-6 py-3 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-white font-bold font-secondary tracking-wide text-base">
              PLANO DE PRODUÇÃO
            </h1>
            <p className="text-white/70 text-xs font-secondary font-light">
              {MARCA_FIXA} · {STATUS_FIXO} · Continuidade › Referência › Cor/Tam
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs">
            {cacheStatus && (
              <div className="flex items-center gap-1.5 text-white/80">
                <span className={`w-2 h-2 rounded-full ${cacheStatus.fresh ? 'bg-green-300' : 'bg-amber-300'}`} />
                <span>
                  {cacheStatus.exists
                    ? `Cache: ${cacheStatus.updatedAt}${cacheStatus.ageHours !== undefined ? ` (${cacheStatus.ageHours}h)` : ''}`
                    : 'Sem cache'}
                </span>
              </div>
            )}
            {fromCache && <span className="text-green-200 font-medium">⚡ cache</span>}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-3 py-1.5 text-xs font-semibold text-brand-primary bg-white rounded hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              {refreshing ? 'Atualizando...' : 'Atualizar dados'}
            </button>
          </div>
        </header>

        {/* Conteúdo */}
        <main className="flex-1 min-w-0 px-6 py-5 space-y-4">

          {/* mensagem de refresh */}
          {refreshMsg && (
            <div className="bg-brand-primary/10 border border-brand-primary/30 rounded-lg px-4 py-3 text-sm text-brand-dark">
              <div className="flex items-center gap-2">
                {building && (
                  <svg className="animate-spin w-4 h-4 text-brand-primary shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                )}
                <span>{refreshMsg}</span>
                {building && buildElapsed > 0 && (
                  <span className="ml-auto text-brand-primary font-mono text-xs">{buildElapsed}s</span>
                )}
              </div>
              {building && (
                <div className="mt-2 h-1 bg-brand-primary/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-primary rounded-full transition-all duration-1000"
                    style={{ width: `${Math.min((buildElapsed / 120) * 100, 95)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* KPIs unificados */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex">

            {/* Grupo: Portfólio */}
            <div className="flex-1 px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Portfólio</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>
              <div className="grid grid-cols-5 gap-6">
                {[
                  { label: 'Itens',         value: totais.itens.toLocaleString('pt-BR'),                                    accent: 'text-brand-primary' },
                  { label: 'Estoque atual', value: totais.estoque.toLocaleString('pt-BR',    { maximumFractionDigits: 0 }), accent: 'text-blue-600' },
                  { label: 'Em processo',   value: totais.emProc.toLocaleString('pt-BR',     { maximumFractionDigits: 0 }), accent: 'text-sky-600' },
                  { label: 'Est. mínimo',   value: totais.estoqueMin.toLocaleString('pt-BR', { maximumFractionDigits: 0 }), accent: 'text-gray-700' },
                  { label: 'Pedidos pend.', value: totais.pedidos.toLocaleString('pt-BR',    { maximumFractionDigits: 0 }), accent: 'text-amber-600' },
                ].map((c) => (
                  <div key={c.label}>
                    <div className="text-[11px] text-gray-400 mb-0.5">{c.label}</div>
                    <div className={`text-xl font-bold font-mono ${c.accent}`}>{c.value}</div>
                  </div>
                ))}
              </div>

              {/* Filtros integrados */}
              <div className="mt-4 pt-3 border-t border-gray-100">
                <div className="relative z-40 flex flex-wrap gap-x-4 gap-y-2 items-end justify-center">
                  <div>
                    <label className="block text-xs font-semibold text-brand-dark mb-1">Filtro rápido</label>
                    <button
                      onClick={() => setApenasNegativos((v) => !v)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded border transition-colors ${
                        apenasNegativos
                          ? 'bg-red-600 text-white border-red-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      Negativos
                    </button>
                  </div>

                  <div className="border-l border-gray-200 pl-4">
                    <label className="block text-xs font-semibold text-brand-dark mb-1">Simulação aprovada</label>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative z-50 w-72">
                        <button
                          type="button"
                          onClick={() => setAbrirSeletorAprovadas((v) => !v)}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs text-left bg-white hover:bg-gray-50"
                        >
                          Selecionadas: {aprovadasSelecionadasIds.length}/{aprovadas.length} {abrirSeletorAprovadas ? '▲' : '▼'}
                        </button>
                        {abrirSeletorAprovadas && (
                          <div className="absolute z-[120] mt-1 w-full border border-gray-300 rounded p-2 bg-white shadow-xl">
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-[11px] text-gray-500">Escolha as simulações</span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setAprovadasSelecionadasIds(aprovadas.map((a) => a.id))}
                                  className="px-2 py-0.5 text-[11px] rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                                >
                                  Todas
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setAprovadasSelecionadasIds([])}
                                  className="px-2 py-0.5 text-[11px] rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                                >
                                  Limpar
                                </button>
                              </div>
                            </div>
                            <div className="max-h-36 overflow-auto space-y-1 pr-1">
                              {aprovadas.map((a) => (
                                <label key={a.id} className="flex items-center gap-2 text-[11px] text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={aprovadasSelecionadasIds.includes(a.id)}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setAprovadasSelecionadasIds((prev) => {
                                        if (checked) return prev.includes(a.id) ? prev : [...prev, a.id];
                                        return prev.filter((id) => id !== a.id);
                                      });
                                    }}
                                  />
                                  <span className="truncate">
                                    {new Date(a.createdAt).toLocaleDateString('pt-BR')} · {String((a as { nome?: string }).nome || a.id)}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => setAplicarAprovadas((v) => !v)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded border transition-colors ${
                          aplicarAprovadas
                            ? 'bg-brand-primary text-white border-brand-primary'
                            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        {aplicarAprovadas ? 'Aplicada' : 'Aplicar cálculos'}
                      </button>
                      <div className="text-[11px] text-gray-500">
                        Itens com plano aprovado: {planosAprovadosMap.size.toLocaleString('pt-BR')}
                      </div>
                    </div>
                  </div>

                  <div className="border-l border-gray-200 pl-4">
                    <label className="block text-xs font-semibold text-brand-dark mb-1">Projeção</label>
                    <div className="flex flex-col gap-1.5">
                      <button
                        onClick={() => setConsiderarProjecaoNova((v) => !v)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded border transition-colors ${
                          considerarProjecaoNova
                            ? 'bg-violet-600 text-white border-violet-600'
                            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        {considerarProjecaoNova ? 'Projeção nova ativa' : 'Considerar projeção nova'}
                      </button>
                      {recalculandoProjecao ? (
                        <div className="flex items-center gap-1.5 text-[11px] text-violet-700">
                          <svg className="animate-spin w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                          </svg>
                          Gerando novos cálculos...
                        </div>
                      ) : (
                        considerarProjecaoNova && resultadoReprojecaoMsg && (
                          <div className="text-[11px] text-gray-500 max-w-[280px] leading-relaxed">
                            {resultadoReprojecaoMsg}
                          </div>
                        )
                      )}
                    </div>
                  </div>

                  <div className="border-l border-gray-200 pl-4">
                    <label className="block text-xs font-semibold text-brand-dark mb-1">Continuidade</label>
                    <div className="relative z-50 w-56">
                      <button
                        type="button"
                        onClick={() => setAbrirSeletorContinuidade((v) => !v)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs text-left bg-white hover:bg-gray-50"
                      >
                        {filtroContinuidade.length === 0
                          ? 'Todas'
                          : `${filtroContinuidade.length} selecionada(s)`} {abrirSeletorContinuidade ? '▲' : '▼'}
                      </button>
                      {abrirSeletorContinuidade && (
                        <div className="absolute z-[120] mt-1 w-full border border-gray-300 rounded p-2 bg-white shadow-xl">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-[11px] text-gray-500">Escolha as continuidades</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setFiltroContinuidade(opcoesContinuidade)}
                                className="px-2 py-0.5 text-[11px] rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                              >
                                Todas
                              </button>
                              <button
                                type="button"
                                onClick={() => setFiltroContinuidade([])}
                                className="px-2 py-0.5 text-[11px] rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                              >
                                Limpar
                              </button>
                            </div>
                          </div>
                          <div className="max-h-36 overflow-auto space-y-1 pr-1">
                            {opcoesContinuidade.map((c) => (
                              <label key={c} className="flex items-center gap-2 text-[11px] text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={filtroContinuidade.includes(c)}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setFiltroContinuidade((prev) => {
                                      if (checked) return prev.includes(c) ? prev : [...prev, c];
                                      return prev.filter((v) => v !== c);
                                    });
                                  }}
                                />
                                <span className="truncate">{c}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="border-l border-gray-200 pl-4">
                    <label className="block text-xs font-semibold text-brand-dark mb-1">Referência</label>
                    <input
                      value={filtroReferencia}
                      onChange={(e) => setFiltroReferencia(e.target.value)}
                      placeholder="ex: 4025"
                      className="border border-gray-300 rounded px-2 py-1.5 text-xs w-32 focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    />
                  </div>

                  <div className="border-l border-gray-200 pl-4">
                    <label className="block text-xs font-semibold text-brand-dark mb-1">Cor</label>
                    <select
                      value={filtroCor}
                      onChange={(e) => setFiltroCor(e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1.5 text-xs w-36 focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    >
                      {opcoesCor.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                  <div className="border-l border-gray-200 pl-4">
                    <label className="block text-xs font-semibold text-brand-dark mb-1">Cobertura</label>
                    <select
                      value={filtroCobertura}
                      onChange={(e) => setFiltroCobertura(e.target.value as 'TODAS' | 'NEGATIVA' | 'ZERO_UM' | 'MAIOR_UM' | 'MAIOR_2')}
                      className="border border-gray-300 rounded px-2 py-1.5 text-xs w-32 focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    >
                      <option value="TODAS">Todas</option>
                      <option value="NEGATIVA">{'< 0x'}</option>
                      <option value="ZERO_UM">0x a &lt;1x</option>
                      <option value="MAIOR_UM">{'>= 1x'}</option>
                      <option value="MAIOR_2">{'>= 2x'}</option>
                    </select>
                  </div>

                  <div className="border-l border-gray-200 pl-4">
                    <label className="block text-xs font-semibold text-brand-dark mb-1">Taxa Jan/Fev</label>
                    <select
                      value={filtroTaxa}
                      onChange={(e) => setFiltroTaxa(e.target.value as 'TODAS' | 'ATE_70')}
                      className="border border-gray-300 rounded px-2 py-1.5 text-xs w-36 focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    >
                      <option value="TODAS">Todas</option>
                      <option value="ATE_70">Ambas ≤ 70%</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Divisor */}
            <div className="w-px bg-gray-100 my-3" />

            {/* Grupo: Déficits */}
            <div className="bg-red-50/50 px-5 py-4 shrink-0">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest">Déficits por mês</span>
                <div className="flex-1 h-px bg-red-100" />
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-5 gap-6">
                  {[
                    { label: 'Atual', value: resumoNegativos.atual },
                    { label: nomeMesCurto(periodos.MA), value: resumoNegativos.ma },
                    { label: nomeMesCurto(periodos.PX), value: resumoNegativos.px },
                    { label: nomeMesCurto(periodos.UL), value: resumoNegativos.ul },
                    { label: nomeMesCurto((periodos.UL || 0) + 1), value: resumoNegativos.qt },
                  ].map((c) => (
                    <div key={c.label}>
                      <div className="text-[11px] text-red-400 mb-0.5">{c.label}</div>
                      <div className="text-xl font-bold font-mono text-red-600">{c.value.toLocaleString('pt-BR')}</div>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 pt-2 border-t border-red-100">
                  {resumoNegativos.continuidade
                    .filter((c) => ['PERMANENTE', 'PERMANENTE COR NOVA', 'EDICAO LIMITADA', 'EDIÇÃO LIMITADA'].includes((c.nome || '').toUpperCase()))
                    .map((c) => (
                      <div key={c.nome} className="grid grid-cols-[160px_repeat(5,minmax(72px,1fr))] gap-4 items-center">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-red-500">{c.nome}</div>
                        <div>
                          <div className="text-[10px] text-red-300">Atual</div>
                          <div className="text-sm font-bold font-mono text-red-700">{c.atual.toLocaleString('pt-BR')}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-red-300">{nomeMesCurto(periodos.MA)}</div>
                          <div className="text-sm font-bold font-mono text-red-700">{c.ma.toLocaleString('pt-BR')}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-red-300">{nomeMesCurto(periodos.PX)}</div>
                          <div className="text-sm font-bold font-mono text-red-700">{c.px.toLocaleString('pt-BR')}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-red-300">{nomeMesCurto(periodos.UL)}</div>
                          <div className="text-sm font-bold font-mono text-red-700">{c.ul.toLocaleString('pt-BR')}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-red-300">{nomeMesCurto((periodos.UL || 0) + 1)}</div>
                          <div className="text-sm font-bold font-mono text-red-700">{c.qt.toLocaleString('pt-BR')}</div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>

          </div>

          {/* Loading */}
          {loading && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 flex items-center gap-3 text-sm text-gray-600">
              <svg className="animate-spin w-5 h-5 text-brand-primary shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Carregando dados...
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Tabela */}
          {!loading && !error && dadosPagina.length > 0 && (
            <div className="text-xs text-gray-500 -mb-2">
              Filtros fixos da matriz: <span className="font-semibold text-brand-dark">{MARCA_FIXA}</span> · <span className="font-semibold text-brand-dark">{STATUS_FIXO}</span>
            </div>
          )}
          {!loading && !error && dadosPagina.length > 0 && (
            <MatrizPlanejamentoTable
              dados={dadosPagina}
              projecoes={projecoesAtivas}
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

          {!loading && !error && dadosPagina.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              <VerticalCoverageChart title="Cobertura por SKUs (% com cobertura > 0.2x)" series={graficosCobertura.sku} />
              <VerticalCoverageChart title="Cobertura por Referências (% com cobertura > 0.2x)" series={graficosCobertura.ref} />
            </div>
          )}

          {/* Análise de cobertura */}
          {!loading && !error && analiseCobertura.countCobertura > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-brand-dark">Análise de cobertura: Atual x Último mês do plano</h2>
                <span className="text-xs text-gray-500">
                  Base: {analiseCobertura.countCobertura.toLocaleString('pt-BR')} SKUs com estoque mínimo
                </span>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Metric
                  label="Cobertura média atual"
                  value={`${analiseCobertura.mediaAtual.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`}
                />
                <Metric
                  label={`Cobertura média ${nomeMesCurto((periodos.UL || 0) + 1)}`}
                  value={`${analiseCobertura.mediaUltimo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`}
                />
                <Metric
                  label="Críticos atuais (<1x)"
                  value={analiseCobertura.criticoAtual.toLocaleString('pt-BR')}
                  tone="danger"
                />
                <Metric
                  label={`Críticos ${nomeMesCurto((periodos.UL || 0) + 1)} (<1x)`}
                  value={analiseCobertura.criticoUltimo.toLocaleString('pt-BR')}
                  tone="danger"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <Metric
                  label="Em linha (>= 0.5x)"
                  value={`${analiseCobertura.linhaAtualPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
                  subtitle={`Último: ${analiseCobertura.linhaUltimoPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
                />
                <Metric
                  label="Risco ruptura (0 a <0.5x)"
                  value={`${analiseCobertura.riscoAtualPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
                  subtitle={`Último: ${analiseCobertura.riscoUltimoPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
                  tone="warning"
                />
                <Metric
                  label="SKUs negativos (<0x)"
                  value={`${analiseCobertura.negativoAtualPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
                  subtitle={`Último: ${analiseCobertura.negativoUltimoPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
                  tone="danger"
                />
              </div>

              <div className="space-y-2">
                {analiseCobertura.buckets.map((bucket) => {
                  const max = Math.max(analiseCobertura.totalBuckets, 1);
                  const atualPct = (bucket.atual / max) * 100;
                  const ultimoPct = (bucket.ultimo / max) * 100;
                  return (
                    <div key={bucket.key} className="grid grid-cols-[110px_1fr_1fr] gap-2 items-center">
                      <div className="text-xs font-semibold text-gray-600">{bucket.label}</div>
                      <div className="h-5 bg-gray-100 rounded relative overflow-hidden">
                        <div className="h-full bg-rose-500/75 rounded" style={{ width: `${atualPct}%` }} />
                        <span className="absolute inset-0 px-2 flex items-center text-[11px] font-semibold text-gray-700">
                          Atual: {bucket.atual}
                        </span>
                      </div>
                      <div className="h-5 bg-gray-100 rounded relative overflow-hidden">
                        <div className="h-full bg-indigo-500/75 rounded" style={{ width: `${ultimoPct}%` }} />
                        <span className="absolute inset-0 px-2 flex items-center text-[11px] font-semibold text-gray-700">
                          Último: {bucket.ultimo}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  subtitle,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  subtitle?: string;
  tone?: 'neutral' | 'warning' | 'danger';
}) {
  const palette = tone === 'danger'
    ? { box: 'border-red-200 bg-red-50', label: 'text-red-600', value: 'text-red-700' }
    : tone === 'warning'
      ? { box: 'border-amber-200 bg-amber-50', label: 'text-amber-700', value: 'text-amber-800' }
      : { box: 'border-gray-200 bg-gray-50', label: 'text-gray-500', value: 'text-gray-900' };

  return (
    <div className={`rounded-lg border px-3 py-2 ${palette.box}`}>
      <div className={`text-[11px] ${palette.label}`}>{label}</div>
      <div className={`text-lg font-bold font-mono ${palette.value}`}>{value}</div>
      {subtitle && <div className="text-[11px] text-gray-500 mt-0.5">{subtitle}</div>}
    </div>
  );
}

function VerticalCoverageChart({ title, series }: { title: string; series: SerieMes[] }) {
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
        <div className="h-full grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.max(1, series.length)}, minmax(0, 1fr))` }}>
          {series.map((s) => (
            <div key={s.mes} className="h-full flex flex-col">
              <div className="flex-1 flex items-end justify-center gap-1.5">
                {legendas.map((l) => {
                  const valor = clampPct(Number(s[l.key] || 0));
                  return (
                    <div key={`${s.mes}-${l.key}`} className="w-8 flex flex-col items-center justify-end h-full">
                      <div className="text-[10px] text-gray-600 mb-1">{valor.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</div>
                      <div className={`w-full rounded-t-sm ${l.color}`} style={{ height: `${Math.max(2, valor)}%` }} />
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
