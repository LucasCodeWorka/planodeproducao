'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { getToken, authHeaders } from '../lib/auth';
import { fetchNoCache } from '../lib/api';
import { ProjecoesMap, PeriodosPlano } from '../types';
import { REPROJECAO_REGRAS_FIXAS } from '../lib/reprojecaoFechada';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const MESES_PT = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

interface ProjecoesState {
  timestamp: string | null;
  count:     number;
  data:      ProjecoesMap;
  meses:     number[];   // meses únicos presentes nos dados
  periodos:  PeriodosPlano;
}

type ReprojecaoPreview = {
  idproduto: string;
  referencia: string;
  produto: string;
  continuidade: string;
  base: { ano: number; mes: number; projecao: number; venda: number; percentualAtendido: number };
  regra: { faixa: string; acao: string; descricao: string; sinalOperacional?: string | null };
  original: { ma: number; px: number; ul: number; qt?: number };
  recalculada: { ma: number; px: number; ul: number; qt?: number };
};

type ReprojecaoState = {
  loading: boolean;
  base: { ano: number; mes: number } | null;
  resumo: { aumentoForte: number; media: number; manter: number; quedaLeve: number; quedaForte: number };
  sugestoes: ReprojecaoPreview[];
};

type NivelProduto = 'TOP30' | 'KISS ME' | 'DEMAIS';

export default function ProjecoesPage() {
  const router  = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const defaultPeriodos: PeriodosPlano = {
    MA: new Date().getMonth() + 1,
    PX: new Date().getMonth() + 2,
    UL: new Date().getMonth() + 3,
  };

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [projecoes, setProjecoes] = useState<ProjecoesState>({
    timestamp: null, count: 0, data: {}, meses: [], periodos: defaultPeriodos,
  });
  const [loading,   setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const [loadingRequests, setLoadingRequests] = useState(0);
  const [msg,       setMsg]       = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [filtro,    setFiltro]    = useState('');
  const [filtroCont, setFiltroCont] = useState('TODAS');
  const [filtroRef, setFiltroRef] = useState('TODAS');
  const [filtroNivel, setFiltroNivel] = useState<'TODOS' | NivelProduto>('TODOS');
  const [mostrarTabelaBase, setMostrarTabelaBase] = useState(false);
  const [top30Ids, setTop30Ids] = useState<Set<string>>(new Set());
  const [top30Refs, setTop30Refs] = useState<Set<string>>(new Set());
  const [reprojecao, setReprojecao] = useState<ReprojecaoState>({
    loading: true,
    base: null,
    resumo: { aumentoForte: 0, media: 0, manter: 0, quedaLeve: 0, quedaForte: 0 },
    sugestoes: [],
  });

  useEffect(() => {
    if (!getToken()) { router.replace('/login'); return; }
    buscarProjecoes();
    buscarReprojecaoFechada();
    buscarTop30();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function beginLoadingRequest() {
    setLoadingRequests((prev) => prev + 1);
  }

  function endLoadingRequest() {
    setLoadingRequests((prev) => Math.max(0, prev - 1));
  }

  async function buscarProjecoes() {
    beginLoadingRequest();
    setLoading(true);
    try {
      const res  = await fetchNoCache(`${API_URL}/api/projecoes`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        // Deriva os meses únicos presentes em todos os registros
        const mesesSet = new Set<number>();
        for (const proj of Object.values(data.data as ProjecoesMap)) {
          for (const mes of Object.keys(proj)) {
            const n = parseInt(mes, 10);
            if (n >= 1 && n <= 12) mesesSet.add(n);
          }
        }
        // Mantém junho sempre visível na tabela, mesmo sem dados
        mesesSet.add(6);
        const meses = Array.from(mesesSet).sort((a, b) => a - b);
        setProjecoes({
          timestamp: data.timestamp,
          count:     data.count,
          data:      data.data,
          meses,
          periodos:  data.periodos ?? defaultPeriodos,
        });
      }
    } catch { /* silencioso */ }
    finally {
      setLoading(false);
      endLoadingRequest();
    }
  }

  async function buscarReprojecaoFechada() {
    beginLoadingRequest();
    setReprojecao((prev) => ({ ...prev, loading: true }));
    try {
      const res = await fetchNoCache(`${API_URL}/api/projecoes/reprojecao-fechada`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setReprojecao({
          loading: false,
          base: data.base || null,
          resumo: data.resumo || { aumentoForte: 0, media: 0, manter: 0, quedaLeve: 0, quedaForte: 0 },
          sugestoes: Array.isArray(data.sugestoes) ? data.sugestoes : [],
        });
        endLoadingRequest();
        return;
      }
    } catch {
      // silencioso
    }
    setReprojecao((prev) => ({ ...prev, loading: false }));
    endLoadingRequest();
  }

  async function buscarTop30() {
    beginLoadingRequest();
    try {
      const res = await fetchNoCache(`${API_URL}/api/analises/top30-produtos`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok && data?.success) {
        setTop30Ids(new Set((Array.isArray(data.ids) ? data.ids : []).map((v: string) => String(v))));
        setTop30Refs(new Set((Array.isArray(data.referencias) ? data.referencias : []).map((v: string) => String(v).trim().toUpperCase())));
      }
    } catch {
      // silencioso
    } finally {
      endLoadingRequest();
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setMsg(null);

    try {
      const texto = await file.text();
      const res   = await fetchNoCache(`${API_URL}/api/projecoes/upload`, {
        method:  'POST',
        headers: { 'Content-Type': 'text/plain', ...authHeaders() },
        body:    texto,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setMsg({ type: 'err', text: data.error || 'Erro ao importar' });
      } else {
        const mesesLabel = (data.meses as number[]).map(m => MESES_PT[m]).join(', ');
        setMsg({
          type: 'ok',
          text: `${data.importados} linhas importadas para ${data.produtos} produto(s) · meses: ${mesesLabel}.${data.avisos?.length ? ` Avisos: ${data.avisos.slice(0,2).join('; ')}` : ''}`,
        });
        await buscarProjecoes();
      }
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Erro ao importar' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleLimpar() {
    if (!confirm('Remover TODAS as projeções salvas?')) return;
    try {
      await fetchNoCache(`${API_URL}/api/projecoes`, { method: 'DELETE', headers: authHeaders() });
      setProjecoes({ timestamp: null, count: 0, data: {}, meses: [], periodos: defaultPeriodos });
      setMsg({ type: 'ok', text: 'Projeções removidas.' });
    } catch {
      setMsg({ type: 'err', text: 'Erro ao remover projeções.' });
    }
  }

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';
  const carregandoDadosTabela = loadingRequests > 0;

  const mesNorm = (mes: number) => {
    const m = Number(mes || 0);
    if (!Number.isFinite(m) || m <= 0) return 1;
    return ((m - 1) % 12) + 1;
  };

  const continuidades = useMemo(() => {
    const set = new Set<string>();
    reprojecao.sugestoes.forEach((r) => {
      const c = String(r.continuidade || '').trim().toUpperCase();
      if (c) set.add(c);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [reprojecao.sugestoes]);

  const referencias = useMemo(() => {
    const set = new Set<string>();
    reprojecao.sugestoes.forEach((r) => {
      const ref = String(r.referencia || '').trim().toUpperCase();
      if (ref) set.add(ref);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [reprojecao.sugestoes]);

  const nivelProduto = (r: ReprojecaoPreview): NivelProduto => {
    const texto = `${String(r.continuidade || '')} ${String(r.produto || '')}`.toUpperCase();
    if (texto.includes('KISS ME')) return 'KISS ME';
    const ref = String(r.referencia || '').trim().toUpperCase();
    const id = String(r.idproduto || '');
    if (top30Refs.has(ref) || top30Ids.has(id)) return 'TOP30';
    return 'DEMAIS';
  };

  const sugestoesFiltradas = useMemo(() => {
    return reprojecao.sugestoes.filter((r) => {
      const matchTexto = !filtro || r.idproduto.includes(filtro.trim()) || r.referencia.includes(filtro.trim());
      const cont = String(r.continuidade || '').trim().toUpperCase();
      const ref = String(r.referencia || '').trim().toUpperCase();
      const nivel = nivelProduto(r);
      const matchCont = filtroCont === 'TODAS' || cont === filtroCont;
      const matchRef = filtroRef === 'TODAS' || ref === filtroRef;
      const matchNivel = filtroNivel === 'TODOS' || nivel === filtroNivel;
      return matchTexto && matchCont && matchRef && matchNivel;
    });
  }, [reprojecao.sugestoes, filtro, filtroCont, filtroRef, filtroNivel, top30Ids, top30Refs]);

  const gruposReprojecao = useMemo(() => {
    const nivelMap = new Map<NivelProduto, Map<string, Map<string, ReprojecaoPreview[]>>>();
    for (const item of sugestoesFiltradas) {
      const nivel = nivelProduto(item);
      const cont = String(item.continuidade || 'SEM CONTINUIDADE').trim().toUpperCase();
      const ref = String(item.referencia || 'SEM REFERENCIA').trim().toUpperCase();
      if (!nivelMap.has(nivel)) nivelMap.set(nivel, new Map());
      const contMap = nivelMap.get(nivel)!;
      if (!contMap.has(cont)) contMap.set(cont, new Map());
      const refMap = contMap.get(cont)!;
      if (!refMap.has(ref)) refMap.set(ref, []);
      refMap.get(ref)!.push(item);
    }
    const ordemNivel: NivelProduto[] = ['TOP30', 'KISS ME', 'DEMAIS'];
    return ordemNivel
      .filter((nivel) => nivelMap.has(nivel))
      .map((nivel) => {
        const contMap = nivelMap.get(nivel)!;
        return {
          nivel,
          continuidades: Array.from(contMap.entries())
            .map(([continuidade, refMap]) => ({
              continuidade,
              referencias: Array.from(refMap.entries())
                .map(([referencia, itens]) => ({
                  referencia,
                  itens: [...itens].sort((a, b) => Number(a.idproduto) - Number(b.idproduto)),
                }))
                .sort((a, b) => a.referencia.localeCompare(b.referencia, 'pt-BR')),
            }))
            .sort((a, b) => a.continuidade.localeCompare(b.continuidade, 'pt-BR')),
        };
      });
  }, [sugestoesFiltradas, top30Ids, top30Refs]);

  const entradas = Object.entries(projecoes.data)
    .filter(([id]) => !filtro || id.includes(filtro.trim()))
    .sort(([a], [b]) => Number(a) - Number(b));

  const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });

  const { meses, periodos } = projecoes;
  const mesMA = mesNorm(periodos.MA);
  const mesPX = mesNorm(periodos.PX);
  const mesUL = mesNorm(periodos.UL);
  const mesQT = mesNorm((periodos.UL || 0) + 1);

  function totalizar(itens: ReprojecaoPreview[]) {
    return itens.reduce((acc, r) => {
      acc.baseProj += Number(r.base?.projecao || 0);
      acc.baseVenda += Number(r.base?.venda || 0);
      acc.maOrig += Number(r.original?.ma || 0);
      acc.maCorr += Number(r.recalculada?.ma || 0);
      acc.pxOrig += Number(r.original?.px || 0);
      acc.pxCorr += Number(r.recalculada?.px || 0);
      acc.ulOrig += Number(r.original?.ul || 0);
      acc.ulCorr += Number(r.recalculada?.ul || 0);
      acc.qtOrig += Number(r.original?.qt || 0);
      acc.qtCorr += Number(r.recalculada?.qt || 0);
      return acc;
    }, {
      baseProj: 0, baseVenda: 0,
      maOrig: 0, maCorr: 0,
      pxOrig: 0, pxCorr: 0,
      ulOrig: 0, ulCorr: 0,
      qtOrig: 0, qtCorr: 0,
    });
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />

      <div className={`flex-1 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>

        {/* Header */}
        <header className="bg-brand-primary shadow-sm px-6 py-3 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-white font-bold font-secondary tracking-wide text-base">PROJEÇÕES DE VENDA</h1>
            <p className="text-white/70 text-xs font-secondary font-light">Upload CSV · idproduto, mes (jan–dez), qtd</p>
          </div>
          {projecoes.timestamp && (
            <span className="text-white/70 text-xs">Última importação: {projecoes.timestamp}</span>
          )}
        </header>

        <main className="flex-1 px-6 py-5 space-y-4">
          {carregandoDadosTabela && (
            <div className="bg-sky-50 border border-sky-200 rounded-lg px-4 py-2.5 text-xs text-sky-800 flex items-center gap-2">
              <svg className="animate-spin w-3.5 h-3.5 text-sky-700" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Atualizando dados das tabelas...
            </div>
          )}

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="text-sm font-semibold text-brand-dark">Reprojeção por último mês fechado</div>
              <div className="mt-1 text-xs text-gray-500">
                Base atual: {reprojecao.base ? `${MESES_PT[mesNorm(reprojecao.base.mes)]}/${reprojecao.base.ano}` : '-'} ·
                {' '}regras aplicadas sobre projeção enviada para {MESES_PT[mesMA]}, {MESES_PT[mesPX]}, {MESES_PT[mesUL]} e {MESES_PT[mesQT]}
              </div>
            </div>
            <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-5 gap-3 border-b border-gray-100">
              {[
                { label: 'Aumento cheio', value: reprojecao.resumo.aumentoForte, accent: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
                { label: 'Média', value: reprojecao.resumo.media, accent: 'text-sky-700 bg-sky-50 border-sky-200' },
                { label: 'Manter', value: reprojecao.resumo.manter, accent: 'text-slate-700 bg-slate-50 border-slate-200' },
                { label: 'Queda leve', value: reprojecao.resumo.quedaLeve, accent: 'text-amber-700 bg-amber-50 border-amber-200' },
                { label: 'Queda forte', value: reprojecao.resumo.quedaForte, accent: 'text-red-700 bg-red-50 border-red-200' },
              ].map((c) => (
                <div key={c.label} className={`rounded-lg border px-3 py-3 ${c.accent}`}>
                  <div className="text-[11px] uppercase tracking-wide">{c.label}</div>
                  <div className="text-xl font-bold mt-1">{c.value.toLocaleString('pt-BR')}</div>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="text-xs font-semibold text-brand-dark mb-2">Regras fixas</div>
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
                {REPROJECAO_REGRAS_FIXAS.map((r) => (
                  <div key={r.faixa} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
                    <div className="text-xs font-bold text-brand-dark">{r.faixa}</div>
                    <div className="text-[11px] text-gray-600 mt-1">{r.acao}</div>
                    <div className="text-[11px] text-gray-500 mt-1">{r.descricao}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3">
                <label className="text-xs text-gray-600">
                  Nível
                  <select
                    value={filtroNivel}
                    onChange={(e) => setFiltroNivel(e.target.value as typeof filtroNivel)}
                    className="ml-2 border border-gray-300 rounded px-2 py-1 text-xs"
                  >
                    <option value="TODOS">Todos</option>
                    <option value="TOP30">TOP30</option>
                    <option value="KISS ME">KISS ME</option>
                    <option value="DEMAIS">Demais</option>
                  </select>
                </label>
                <label className="text-xs text-gray-600">
                  Continuidade
                  <select
                    value={filtroCont}
                    onChange={(e) => setFiltroCont(e.target.value)}
                    className="ml-2 border border-gray-300 rounded px-2 py-1 text-xs"
                  >
                    <option value="TODAS">Todas</option>
                    {continuidades.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-gray-600">
                  Referência
                  <select
                    value={filtroRef}
                    onChange={(e) => setFiltroRef(e.target.value)}
                    className="ml-2 border border-gray-300 rounded px-2 py-1 text-xs"
                  >
                    <option value="TODAS">Todas</option>
                    {referencias.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </label>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 sticky left-0 bg-gray-50">idproduto</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">ref</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">nível</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">cont.</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">proj. base</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">venda base</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">% atend.</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">regra</th>
                    <th className="px-3 py-2 text-right font-semibold text-violet-700 bg-violet-50">{MESES_PT[mesMA]} original</th>
                    <th className="px-3 py-2 text-right font-semibold text-violet-700 bg-violet-50">{MESES_PT[mesMA]} corrigido</th>
                    <th className="px-3 py-2 text-right font-semibold text-violet-700 bg-violet-50">{MESES_PT[mesPX]} original</th>
                    <th className="px-3 py-2 text-right font-semibold text-violet-700 bg-violet-50">{MESES_PT[mesPX]} corrigido</th>
                    <th className="px-3 py-2 text-right font-semibold text-violet-700 bg-violet-50">{MESES_PT[mesUL]} original</th>
                    <th className="px-3 py-2 text-right font-semibold text-violet-700 bg-violet-50">{MESES_PT[mesUL]} corrigido</th>
                    <th className="px-3 py-2 text-right font-semibold text-teal-700 bg-teal-50">{MESES_PT[mesQT]} original</th>
                    <th className="px-3 py-2 text-right font-semibold text-teal-700 bg-teal-50">{MESES_PT[mesQT]} corrigido</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {reprojecao.loading ? (
                    <tr><td colSpan={16} className="px-4 py-8 text-center text-gray-500">Carregando preview de reprojeção...</td></tr>
                  ) : gruposReprojecao.length === 0 ? (
                    <tr><td colSpan={16} className="px-4 py-8 text-center text-gray-500">Sem dados para preview.</td></tr>
                  ) : (
                    gruposReprojecao.map((nivelGroup) => {
                      const itensNivel = nivelGroup.continuidades.flatMap((c) => c.referencias.flatMap((r) => r.itens));
                      const tNivel = totalizar(itensNivel);
                      const atendNivel = tNivel.baseProj > 0 ? (tNivel.baseVenda / tNivel.baseProj) * 100 : 0;
                      return (
                        <Fragment key={`nivel-${nivelGroup.nivel}`}>
                          <tr className="bg-slate-200 border-t border-slate-300">
                            <td className="px-3 py-2 font-bold sticky left-0 bg-slate-200">{nivelGroup.nivel}</td>
                            <td className="px-3 py-2">-</td>
                            <td className="px-3 py-2">-</td>
                            <td className="px-3 py-2">-</td>
                            <td className="px-3 py-2 text-right font-semibold">{fmt(tNivel.baseProj)}</td>
                            <td className="px-3 py-2 text-right font-semibold">{fmt(tNivel.baseVenda)}</td>
                            <td className="px-3 py-2 text-right font-semibold">{atendNivel.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
                            <td className="px-3 py-2">-</td>
                            <td className="px-3 py-2 text-right bg-violet-50 font-semibold">{fmt(tNivel.maOrig)}</td>
                            <td className="px-3 py-2 text-right bg-violet-50 font-semibold">{fmt(tNivel.maCorr)}</td>
                            <td className="px-3 py-2 text-right bg-violet-50 font-semibold">{fmt(tNivel.pxOrig)}</td>
                            <td className="px-3 py-2 text-right bg-violet-50 font-semibold">{fmt(tNivel.pxCorr)}</td>
                            <td className="px-3 py-2 text-right bg-violet-50 font-semibold">{fmt(tNivel.ulOrig)}</td>
                            <td className="px-3 py-2 text-right bg-violet-50 font-semibold">{fmt(tNivel.ulCorr)}</td>
                            <td className="px-3 py-2 text-right bg-teal-50 font-semibold">{fmt(tNivel.qtOrig)}</td>
                            <td className="px-3 py-2 text-right bg-teal-50 font-semibold">{fmt(tNivel.qtCorr)}</td>
                          </tr>
                          {nivelGroup.continuidades.map((contGroup) => {
                            const itensCont = contGroup.referencias.flatMap((r) => r.itens);
                            const tCont = totalizar(itensCont);
                            const atendCont = tCont.baseProj > 0 ? (tCont.baseVenda / tCont.baseProj) * 100 : 0;
                            return (
                              <Fragment key={`cont-${nivelGroup.nivel}-${contGroup.continuidade}`}>
                                <tr className="bg-slate-100 border-t border-slate-200">
                                  <td className="px-3 py-2 sticky left-0 bg-slate-100">-</td>
                                  <td className="px-3 py-2 font-semibold">{contGroup.continuidade}</td>
                                  <td className="px-3 py-2">-</td>
                                  <td className="px-3 py-2">-</td>
                                  <td className="px-3 py-2 text-right font-semibold">{fmt(tCont.baseProj)}</td>
                                  <td className="px-3 py-2 text-right font-semibold">{fmt(tCont.baseVenda)}</td>
                                  <td className="px-3 py-2 text-right font-semibold">{atendCont.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
                                  <td className="px-3 py-2">-</td>
                                  <td className="px-3 py-2 text-right bg-violet-50">{fmt(tCont.maOrig)}</td>
                                  <td className="px-3 py-2 text-right bg-violet-50">{fmt(tCont.maCorr)}</td>
                                  <td className="px-3 py-2 text-right bg-violet-50">{fmt(tCont.pxOrig)}</td>
                                  <td className="px-3 py-2 text-right bg-violet-50">{fmt(tCont.pxCorr)}</td>
                                  <td className="px-3 py-2 text-right bg-violet-50">{fmt(tCont.ulOrig)}</td>
                                  <td className="px-3 py-2 text-right bg-violet-50">{fmt(tCont.ulCorr)}</td>
                                  <td className="px-3 py-2 text-right bg-teal-50">{fmt(tCont.qtOrig)}</td>
                                  <td className="px-3 py-2 text-right bg-teal-50">{fmt(tCont.qtCorr)}</td>
                                </tr>
                                {contGroup.referencias.map((refGroup) => {
                                  const tRef = totalizar(refGroup.itens);
                                  const atendRef = tRef.baseProj > 0 ? (tRef.baseVenda / tRef.baseProj) * 100 : 0;
                                  return (
                                    <Fragment key={`ref-${nivelGroup.nivel}-${contGroup.continuidade}-${refGroup.referencia}`}>
                                      <tr className="bg-white border-t border-gray-200">
                                        <td className="px-3 py-2 sticky left-0 bg-white">-</td>
                                        <td className="px-3 py-2 font-semibold">{refGroup.referencia}</td>
                                        <td className="px-3 py-2">
                                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                            nivelGroup.nivel === 'TOP30'
                                              ? 'bg-blue-100 text-blue-700'
                                              : nivelGroup.nivel === 'KISS ME'
                                                ? 'bg-amber-100 text-amber-700'
                                                : 'bg-slate-100 text-slate-700'
                                          }`}>
                                            {nivelGroup.nivel}
                                          </span>
                                        </td>
                                        <td className="px-3 py-2">-</td>
                                        <td className="px-3 py-2 text-right font-semibold">{fmt(tRef.baseProj)}</td>
                                        <td className="px-3 py-2 text-right font-semibold">{fmt(tRef.baseVenda)}</td>
                                        <td className="px-3 py-2 text-right font-semibold">{atendRef.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
                                        <td className="px-3 py-2">-</td>
                                        <td className="px-3 py-2 text-right bg-violet-50">{fmt(tRef.maOrig)}</td>
                                        <td className="px-3 py-2 text-right bg-violet-50">{fmt(tRef.maCorr)}</td>
                                        <td className="px-3 py-2 text-right bg-violet-50">{fmt(tRef.pxOrig)}</td>
                                        <td className="px-3 py-2 text-right bg-violet-50">{fmt(tRef.pxCorr)}</td>
                                        <td className="px-3 py-2 text-right bg-violet-50">{fmt(tRef.ulOrig)}</td>
                                        <td className="px-3 py-2 text-right bg-violet-50">{fmt(tRef.ulCorr)}</td>
                                        <td className="px-3 py-2 text-right bg-teal-50">{fmt(tRef.qtOrig)}</td>
                                        <td className="px-3 py-2 text-right bg-teal-50">{fmt(tRef.qtCorr)}</td>
                                      </tr>
                                      {refGroup.itens.map((r) => (
                                        <tr key={`reproj-${r.idproduto}`} className="hover:bg-gray-50 transition-colors">
                                          <td className="px-3 py-1.5 font-mono text-gray-700 sticky left-0 bg-white">{r.idproduto}</td>
                                          <td className="px-3 py-1.5 font-mono text-gray-700">{r.referencia || '—'}</td>
                                          <td className="px-3 py-1.5 text-gray-600">{nivelProduto(r)}</td>
                                          <td className="px-3 py-1.5 text-gray-600">{r.continuidade || '—'}</td>
                                          <td className="px-3 py-1.5 text-right font-mono">{fmt(r.base.projecao)}</td>
                                          <td className="px-3 py-1.5 text-right font-mono">{fmt(r.base.venda)}</td>
                                          <td className={`px-3 py-1.5 text-right font-mono font-semibold ${r.base.percentualAtendido >= 130 ? 'text-emerald-700' : r.base.percentualAtendido <= 69.99 ? 'text-red-700' : 'text-gray-700'}`}>
                                            {r.base.percentualAtendido.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                                          </td>
                                          <td className="px-3 py-1.5">
                                            <div className="font-semibold text-gray-800">{r.regra.faixa}</div>
                                            <div className="text-[11px] text-gray-500">{r.regra.acao}</div>
                                          </td>
                                          <td className="px-3 py-1.5 text-right font-mono bg-violet-50/40">{fmt(r.original.ma)}</td>
                                          <td className="px-3 py-1.5 text-right font-mono font-semibold bg-violet-50/40">{fmt(r.recalculada.ma)}</td>
                                          <td className="px-3 py-1.5 text-right font-mono bg-violet-50/40">{fmt(r.original.px)}</td>
                                          <td className="px-3 py-1.5 text-right font-mono font-semibold bg-violet-50/40">{fmt(r.recalculada.px)}</td>
                                          <td className="px-3 py-1.5 text-right font-mono bg-violet-50/40">{fmt(r.original.ul)}</td>
                                          <td className="px-3 py-1.5 text-right font-mono font-semibold bg-violet-50/40">{fmt(r.recalculada.ul)}</td>
                                          <td className="px-3 py-1.5 text-right font-mono bg-teal-50/40">{fmt(Number(r.original.qt || 0))}</td>
                                          <td className="px-3 py-1.5 text-right font-mono font-semibold bg-teal-50/40">{fmt(Number(r.recalculada.qt || 0))}</td>
                                        </tr>
                                      ))}
                                    </Fragment>
                                  );
                                })}
                              </Fragment>
                            );
                          })}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Upload */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-brand-dark mb-3">Importar CSV</h2>

            <div className="flex flex-wrap items-center gap-3">
              <label className="cursor-pointer">
                <span className="px-4 py-2 text-sm font-semibold bg-brand-primary text-white rounded hover:bg-brand-secondary transition-colors inline-block">
                  {uploading ? 'Importando...' : 'Selecionar arquivo CSV'}
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="hidden"
                  disabled={uploading}
                  onChange={handleUpload}
                />
              </label>

              {projecoes.count > 0 && (
                <button
                  onClick={handleLimpar}
                  className="px-4 py-2 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50 transition-colors"
                >
                  Limpar projeções
                </button>
              )}

              <span className="text-xs text-gray-400 ml-auto">
                Formato: <code className="bg-gray-100 px-1 rounded">idproduto,mes,qtd</code>
                &nbsp;· mes: <code className="bg-gray-100 px-1 rounded">jan</code> … <code className="bg-gray-100 px-1 rounded">dez</code>
              </span>
            </div>

            {msg && (
              <div className={`mt-3 px-3 py-2 rounded text-sm ${
                msg.type === 'ok'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}>
                {msg.text}
              </div>
            )}
          </div>

          {/* Info períodos do plano */}
          {meses.length > 0 && (
            <div className="bg-violet-50 border border-violet-200 rounded-lg px-4 py-2.5 text-xs text-violet-700 flex items-center gap-4 flex-wrap">
              <span className="font-semibold">Períodos do plano → disponível futuro:</span>
              <span>MA = <strong>{MESES_PT[mesMA]}</strong></span>
              <span>PX = <strong>{MESES_PT[mesPX]}</strong></span>
              <span>UL = <strong>{MESES_PT[mesUL]}</strong></span>
              <span className="text-violet-400 ml-auto">
                Meses na base: {meses.map(m => MESES_PT[m]).join(', ')}
              </span>
            </div>
          )}

          {/* Tabela base (recolhível) */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setMostrarTabelaBase((v) => !v)}
              className="w-full px-5 py-3 border-b border-gray-100 flex items-center justify-between text-left"
            >
              <span className="text-sm font-semibold text-brand-dark">
                Tabela base de projeções ({projecoes.count.toLocaleString('pt-BR')} produtos)
              </span>
              <span className="text-xs text-gray-500">{mostrarTabelaBase ? 'Ocultar' : 'Mostrar'}</span>
            </button>

            {mostrarTabelaBase && (
              loading ? (
                <div className="p-6 text-sm text-gray-500">Carregando projeções...</div>
              ) : projecoes.count === 0 ? (
                <div className="p-6 text-sm text-gray-400 text-center">
                  Nenhuma projeção cadastrada. Importe um arquivo CSV para começar.
                </div>
              ) : (
                <>
                  <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-4">
                    <input
                      type="text"
                      value={filtro}
                      onChange={e => setFiltro(e.target.value)}
                      placeholder="Filtrar por idproduto..."
                      className="ml-auto border border-gray-300 rounded px-2 py-1 text-xs w-48 focus:outline-none focus:ring-1 focus:ring-brand-primary"
                    />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="px-4 py-2 text-left font-semibold text-gray-600 sticky left-0 bg-gray-50">idproduto</th>
                          {meses.map(m => (
                            <th key={m} className={`px-4 py-2 text-right font-semibold ${
                              m === periodos.MA || m === periodos.PX || m === periodos.UL
                                ? 'text-violet-700 bg-violet-50'
                                : 'text-teal-700 bg-teal-50'
                            }`}>
                              {MESES_PT[m]}
                              {m === periodos.MA && <span className="ml-1 text-[9px] text-violet-400">MA</span>}
                              {m === periodos.PX && <span className="ml-1 text-[9px] text-violet-400">PX</span>}
                              {m === periodos.UL && <span className="ml-1 text-[9px] text-violet-400">UL</span>}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {entradas.map(([id, proj]) => (
                          <tr key={id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-1.5 font-mono text-gray-700 sticky left-0 bg-white">{id}</td>
                            {meses.map(m => {
                              const chaveMes = String(m);
                              const chaveMes2 = String(m).padStart(2, '0');
                              const val = proj[chaveMes] ?? proj[chaveMes2];
                              const isPlano = m === periodos.MA || m === periodos.PX || m === periodos.UL;
                              return (
                                <td key={m} className={`px-4 py-1.5 text-right font-mono tabular-nums ${isPlano ? 'bg-violet-50/40' : 'bg-teal-50/40'}`}>
                                  {val !== undefined && val > 0
                                    ? fmt(val)
                                    : <span className="text-gray-300">—</span>}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
