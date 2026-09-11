'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { getToken, authHeaders } from '../lib/auth';
import { fetchNoCache } from '../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const MESES_NOMES = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun'];

type Totalizador = {
  fabrica: number;
  fabricaAjustada: number;
  lojas: number;
  ajuste: number;
  ajustePct: number;
  total: number;
};

type ItemProjecao = {
  idproduto: string;
  referencia: string;
  produto: string;
  cor: string;
  tamanho: string;
  continuidade: string;
  linha: string;
  media_6m: number;
  media_3m: number;
  rep_6m: number;
  rep_3m: number;
  variacao_pct: number | null;
  semHistorico6m: boolean;
  usaTendencia: boolean;
  representatividade: number;
  projecoes: {
    jan: number;
    fev: number;
    mar: number;
    abr: number;
    mai: number;
    jun: number;
  };
  totalProjecao: number;
};

type Resumo = {
  totalSkus: number;
  skusPermanente: number;
  skusPermanenteCorNova: number;
  skusComTendencia: number;
  skusComMedia: number;
  totalProjecao: number;
  totalPorMes: {
    jan: number;
    fev: number;
    mar: number;
    abr: number;
    mai: number;
    jun: number;
  };
};

type PreviewData = {
  success: boolean;
  anoBase: number;
  anoDestino: number;
  vendas?: {
    fabrica: Record<number, number>;
    lojas: Record<number, number>;
  };
  totalizadores: Record<number, Totalizador>;
  resumo: Resumo;
  itens: ItemProjecao[];
};

export default function ProjecaoPermanentesPage() {
  const router = useRouter();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const anoAtual = new Date().getFullYear();
  const [anoBase, setAnoBase] = useState(anoAtual);
  const [anoDestino, setAnoDestino] = useState(anoAtual + 1);

  const [data, setData] = useState<PreviewData | null>(null);

  // Filtros
  const [filtroRef, setFiltroRef] = useState('');
  const [filtroContinuidade, setFiltroContinuidade] = useState<'TODAS' | 'PERMANENTE' | 'PERMANENTE COR NOVA'>('TODAS');
  const [filtroTendencia, setFiltroTendencia] = useState<'TODOS' | 'SIM' | 'NAO'>('TODOS');

  // Seleção
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  // Árvore (matriz): continuidade > referência > SKU
  const [collapsedConts, setCollapsedConts] = useState<Set<string>>(new Set());
  const [expandedRefs, setExpandedRefs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregarPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregarPreview() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetchNoCache(
        `${API_URL}/api/projecao-permanentes/preview?anoBase=${anoBase}&anoDestino=${anoDestino}`,
        { headers: authHeaders() }
      );
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Erro ao carregar preview');
      }

      setData(json);
      // Seleciona todos por padrão
      setSelecionados(new Set(json.itens.map((i: ItemProjecao) => i.idproduto)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  }

  async function aplicarProjecoes() {
    if (selecionados.size === 0) {
      setError('Selecione pelo menos um item para aplicar');
      return;
    }

    if (!confirm(`Aplicar projeções para ${selecionados.size} SKUs no ano ${anoDestino}?\n\nIsso vai sobrescrever projeções existentes para esses produtos em Jan-Jun ${anoDestino}.`)) {
      return;
    }

    setApplying(true);
    setError(null);
    setOkMsg(null);

    try {
      const itensSelecionados = data?.itens.filter((i) => selecionados.has(i.idproduto)) || [];

      const res = await fetchNoCache(`${API_URL}/api/projecao-permanentes/aplicar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          anoDestino,
          itens: itensSelecionados.map((i) => ({
            idproduto: i.idproduto,
            projecoes: i.projecoes,
          })),
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Erro ao aplicar projeções');
      }

      setOkMsg(`Projeções aplicadas: ${json.importados} registros para ${json.skus} SKUs`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao aplicar');
    } finally {
      setApplying(false);
    }
  }

  // Itens filtrados
  const itensFiltrados = useMemo(() => {
    if (!data?.itens) return [];

    return data.itens.filter((item) => {
      const matchRef = !filtroRef ||
        item.referencia.toLowerCase().includes(filtroRef.toLowerCase()) ||
        item.idproduto.includes(filtroRef);
      const matchCont = filtroContinuidade === 'TODAS' || item.continuidade === filtroContinuidade;
      const matchTend = filtroTendencia === 'TODOS' ||
        (filtroTendencia === 'SIM' && item.usaTendencia) ||
        (filtroTendencia === 'NAO' && !item.usaTendencia);

      return matchRef && matchCont && matchTend;
    });
  }, [data?.itens, filtroRef, filtroContinuidade, filtroTendencia]);

  // Toggle seleção
  function toggleSelecionado(id: string) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selecionarTodos() {
    const todos = itensFiltrados.every((i) => selecionados.has(i.idproduto));
    if (todos) {
      // Desmarca todos filtrados
      setSelecionados((prev) => {
        const next = new Set(prev);
        itensFiltrados.forEach((i) => next.delete(i.idproduto));
        return next;
      });
    } else {
      // Marca todos filtrados
      setSelecionados((prev) => {
        const next = new Set(prev);
        itensFiltrados.forEach((i) => next.add(i.idproduto));
        return next;
      });
    }
  }

  const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
  const fmtRep = (n: number) => `${(n * 100).toFixed(3)}%`;

  // ── Árvore: agrupa itensFiltrados em Continuidade > Referência ──
  type GrupoTotais = {
    rep6m: number; rep3m: number; varPct: number | null; semHistorico: boolean;
    jan: number; fev: number; mar: number; abr: number; mai: number; jun: number;
    total: number; count: number; countTendencia: number;
  };

  function somarGrupo(itens: ItemProjecao[]): GrupoTotais {
    const t: GrupoTotais = {
      rep6m: 0, rep3m: 0, varPct: null, semHistorico: false,
      jan: 0, fev: 0, mar: 0, abr: 0, mai: 0, jun: 0,
      total: 0, count: itens.length, countTendencia: 0,
    };
    for (const i of itens) {
      t.rep6m += i.rep_6m;
      t.rep3m += i.rep_3m;
      t.jan += i.projecoes.jan;
      t.fev += i.projecoes.fev;
      t.mar += i.projecoes.mar;
      t.abr += i.projecoes.abr;
      t.mai += i.projecoes.mai;
      t.jun += i.projecoes.jun;
      t.total += i.totalProjecao;
      if (i.usaTendencia) t.countTendencia += 1;
    }
    if (t.rep6m <= 0 && t.rep3m > 0) {
      t.semHistorico = true;
      t.varPct = null;
    } else if (t.rep6m <= 0) {
      t.varPct = 0;
    } else {
      t.varPct = (Math.abs(t.rep3m - t.rep6m) / t.rep6m) * 100;
    }
    return t;
  }

  type RefGroup = { referencia: string; produto: string; itens: ItemProjecao[]; totais: GrupoTotais };
  type ContGroup = { continuidade: string; itens: ItemProjecao[]; referencias: RefGroup[]; totais: GrupoTotais };

  const grupos = useMemo<ContGroup[]>(() => {
    const contMap = new Map<string, ItemProjecao[]>();
    for (const item of itensFiltrados) {
      const key = item.continuidade || 'SEM CONTINUIDADE';
      if (!contMap.has(key)) contMap.set(key, []);
      contMap.get(key)!.push(item);
    }

    const result: ContGroup[] = [];
    contMap.forEach((itens, continuidade) => {
      const refMap = new Map<string, ItemProjecao[]>();
      for (const item of itens) {
        const key = item.referencia || '(sem referencia)';
        if (!refMap.has(key)) refMap.set(key, []);
        refMap.get(key)!.push(item);
      }
      const referencias: RefGroup[] = [];
      refMap.forEach((refItens, referencia) => {
        referencias.push({
          referencia,
          produto: refItens[0]?.produto || '',
          itens: refItens,
          totais: somarGrupo(refItens),
        });
      });
      referencias.sort((a, b) => a.referencia.localeCompare(b.referencia));

      result.push({ continuidade, itens, referencias, totais: somarGrupo(itens) });
    });
    result.sort((a, b) => a.continuidade.localeCompare(b.continuidade));
    return result;
  }, [itensFiltrados]);

  function toggleCont(cont: string) {
    setCollapsedConts((prev) => {
      const next = new Set(prev);
      if (next.has(cont)) next.delete(cont); else next.add(cont);
      return next;
    });
  }

  function toggleRef(refKey: string) {
    setExpandedRefs((prev) => {
      const next = new Set(prev);
      if (next.has(refKey)) next.delete(refKey); else next.add(refKey);
      return next;
    });
  }

  function grupoTodosSelecionados(itens: ItemProjecao[]) {
    return itens.length > 0 && itens.every((i) => selecionados.has(i.idproduto));
  }

  function toggleSelecaoGrupo(itens: ItemProjecao[], e?: React.MouseEvent) {
    e?.stopPropagation();
    const todos = grupoTodosSelecionados(itens);
    setSelecionados((prev) => {
      const next = new Set(prev);
      itens.forEach((i) => { if (todos) next.delete(i.idproduto); else next.add(i.idproduto); });
      return next;
    });
  }

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />

      <div className={`flex-1 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        {/* Header */}
        <header className="bg-brand-primary shadow-sm px-6 py-3 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-white font-bold font-secondary tracking-wide text-base">
              PROJECAO PERMANENTES
            </h1>
            <p className="text-white/70 text-xs font-secondary font-light">
              Gera projecoes automaticas para itens PERMANENTE e PERMANENTE COR NOVA
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-white/80 text-xs">
              Ano Base:
              <select
                value={anoBase}
                onChange={(e) => setAnoBase(Number(e.target.value))}
                className="ml-2 border border-gray-300 rounded px-2 py-1 text-xs text-gray-800"
              >
                {[anoAtual - 1, anoAtual, anoAtual + 1].map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
            <label className="text-white/80 text-xs">
              Ano Destino:
              <select
                value={anoDestino}
                onChange={(e) => setAnoDestino(Number(e.target.value))}
                className="ml-2 border border-gray-300 rounded px-2 py-1 text-xs text-gray-800"
              >
                {[anoAtual, anoAtual + 1, anoAtual + 2].map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </label>
            <button
              onClick={carregarPreview}
              disabled={loading}
              className="px-4 py-1.5 text-xs font-semibold bg-white text-brand-primary rounded hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              {loading ? 'Carregando...' : 'Atualizar'}
            </button>
          </div>
        </header>

        <main className="flex-1 px-6 py-5 space-y-4">
          {/* Mensagens */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {okMsg && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700">
              {okMsg}
            </div>
          )}

          {loading ? (
            <div className="bg-white rounded-lg border p-8 text-center text-gray-500">
              Carregando preview...
            </div>
          ) : data ? (
            <>
              {/* Totalizadores */}
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
                  <div className="text-sm font-semibold text-gray-700">
                    Totalizadores por Mes - Base {data.anoBase}.1 → Destino {data.anoDestino}.1
                  </div>
                  <div className="text-[11px] text-gray-500">
                    Total {data.anoBase}.1: <span className="font-semibold text-gray-700">{fmt(
                      [1, 2, 3, 4, 5, 6].reduce((acc, mes) => acc + (data.totalizadores[mes]?.total || 0), 0)
                    )}</span>
                    {' '}(Fab: {fmt(
                      [1, 2, 3, 4, 5, 6].reduce((acc, mes) => acc + (data.totalizadores[mes]?.fabrica || 0), 0)
                    )} + Lojas: {fmt(
                      [1, 2, 3, 4, 5, 6].reduce((acc, mes) => acc + (data.totalizadores[mes]?.lojas || 0), 0)
                    )})
                  </div>
                </div>
                <div className="grid grid-cols-6 gap-3">
                  {[1, 2, 3, 4, 5, 6].map((mes) => {
                    const t = data.totalizadores[mes];
                    if (!t) return null;
                    return (
                      <div key={mes} className="rounded-lg border border-gray-200 p-3 text-center">
                        <div className="text-xs font-bold text-gray-500 uppercase">{MESES_NOMES[mes]}</div>
                        <div className="text-lg font-bold text-gray-800 mt-1">{fmt(t.total)}</div>
                        <div className="text-[10px] text-gray-500 mt-1">
                          Fab: {fmt(t.fabrica)} × {t.ajuste.toFixed(2)}
                        </div>
                        <div className="text-[10px] text-gray-500">
                          Lojas: {fmt(t.lojas)}
                        </div>
                        <div className={`text-[10px] font-semibold mt-1 ${t.ajustePct === 20 ? 'text-amber-600' : 'text-emerald-600'}`}>
                          +{t.ajustePct}% fabrica
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Resumo */}
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <div className="bg-blue-50 rounded-lg border border-blue-200 p-3">
                  <div className="text-xs text-blue-700">Total SKUs</div>
                  <div className="text-xl font-bold text-blue-800">{fmt(data.resumo.totalSkus)}</div>
                </div>
                <div className="bg-violet-50 rounded-lg border border-violet-200 p-3">
                  <div className="text-xs text-violet-700">PERMANENTE</div>
                  <div className="text-xl font-bold text-violet-800">{fmt(data.resumo.skusPermanente)}</div>
                </div>
                <div className="bg-pink-50 rounded-lg border border-pink-200 p-3">
                  <div className="text-xs text-pink-700">COR NOVA</div>
                  <div className="text-xl font-bold text-pink-800">{fmt(data.resumo.skusPermanenteCorNova)}</div>
                </div>
                <div className="bg-amber-50 rounded-lg border border-amber-200 p-3">
                  <div className="text-xs text-amber-700">Usa Tendencia (3m)</div>
                  <div className="text-xl font-bold text-amber-800">{fmt(data.resumo.skusComTendencia)}</div>
                </div>
                <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-3">
                  <div className="text-xs text-emerald-700">Usa Media</div>
                  <div className="text-xl font-bold text-emerald-800">{fmt(data.resumo.skusComMedia)}</div>
                </div>
                <div className="bg-slate-100 rounded-lg border border-slate-300 p-3">
                  <div className="text-xs text-slate-700">Total Projecao</div>
                  <div className="text-xl font-bold text-slate-800">{fmt(data.resumo.totalProjecao)}</div>
                </div>
              </div>

              {/* Filtros */}
              <div className="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  value={filtroRef}
                  onChange={(e) => setFiltroRef(e.target.value)}
                  placeholder="Buscar referencia ou idproduto..."
                  className="border border-gray-300 rounded px-3 py-1.5 text-xs w-64"
                />
                <label className="text-xs text-gray-600">
                  Continuidade:
                  <select
                    value={filtroContinuidade}
                    onChange={(e) => setFiltroContinuidade(e.target.value as typeof filtroContinuidade)}
                    className="ml-2 border border-gray-300 rounded px-2 py-1 text-xs"
                  >
                    <option value="TODAS">Todas</option>
                    <option value="PERMANENTE">PERMANENTE</option>
                    <option value="PERMANENTE COR NOVA">PERMANENTE COR NOVA</option>
                  </select>
                </label>
                <label className="text-xs text-gray-600">
                  Tendencia:
                  <select
                    value={filtroTendencia}
                    onChange={(e) => setFiltroTendencia(e.target.value as typeof filtroTendencia)}
                    className="ml-2 border border-gray-300 rounded px-2 py-1 text-xs"
                  >
                    <option value="TODOS">Todos</option>
                    <option value="SIM">Usa tendencia</option>
                    <option value="NAO">Usa media</option>
                  </select>
                </label>

                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-gray-500">
                    {selecionados.size} de {itensFiltrados.length} selecionados
                  </span>
                  <button
                    onClick={selecionarTodos}
                    className="px-3 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                  >
                    {itensFiltrados.every((i) => selecionados.has(i.idproduto)) ? 'Desmarcar todos' : 'Selecionar todos'}
                  </button>
                  <button
                    onClick={aplicarProjecoes}
                    disabled={applying || selecionados.size === 0}
                    className="px-4 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {applying ? 'Aplicando...' : `Aplicar Projecoes (${selecionados.size})`}
                  </button>
                </div>
              </div>

              {/* Matriz: Continuidade > Referência > SKU */}
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto max-h-[70vh]">
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 z-30 bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="sticky left-0 z-30 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-600 w-[300px] min-w-[300px] max-w-[300px] shadow-[1px_0_0_0_rgba(148,163,184,0.3)]">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={itensFiltrados.length > 0 && itensFiltrados.every((i) => selecionados.has(i.idproduto))}
                              onChange={selecionarTodos}
                              className="rounded"
                            />
                            Referência / Produto
                          </div>
                        </th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-600">M. 6m</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-600">Repr. 6m</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-600">M. 3m</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-600">Repr. 3m</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-600">Var%</th>
                        <th className="px-3 py-2 text-center font-semibold text-gray-600">Regra</th>
                        <th className="px-3 py-2 text-right font-semibold text-violet-700 bg-violet-50">Jan</th>
                        <th className="px-3 py-2 text-right font-semibold text-violet-700 bg-violet-50">Fev</th>
                        <th className="px-3 py-2 text-right font-semibold text-violet-700 bg-violet-50">Mar</th>
                        <th className="px-3 py-2 text-right font-semibold text-violet-700 bg-violet-50">Abr</th>
                        <th className="px-3 py-2 text-right font-semibold text-violet-700 bg-violet-50">Mai</th>
                        <th className="px-3 py-2 text-right font-semibold text-violet-700 bg-violet-50">Jun</th>
                        <th className="px-3 py-2 text-right font-semibold text-emerald-700 bg-emerald-50">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {grupos.length === 0 ? (
                        <tr>
                          <td colSpan={14} className="px-4 py-8 text-center text-gray-500">
                            Nenhum item encontrado com os filtros atuais.
                          </td>
                        </tr>
                      ) : (
                        grupos.map((grupo) => {
                          const contOpen = !collapsedConts.has(grupo.continuidade);
                          const gt = grupo.totais;
                          const contSelecionados = grupoTodosSelecionados(grupo.itens);

                          return (
                            <React.Fragment key={grupo.continuidade}>
                              {/* ── continuidade ── */}
                              <tr
                                onClick={() => toggleCont(grupo.continuidade)}
                                className="group cursor-pointer select-none bg-[#585858] hover:bg-[#4a4a4a]"
                              >
                                <td className="sticky left-0 z-20 bg-[#585858] group-hover:bg-[#4a4a4a] px-3 py-2.5 w-[300px] min-w-[300px] max-w-[300px] shadow-[1px_0_0_0_rgba(55,65,81,0.25)]">
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={contSelecionados}
                                      onChange={() => {}}
                                      onClick={(e) => toggleSelecaoGrupo(grupo.itens, e)}
                                      className="rounded"
                                    />
                                    <span className="text-gray-300 text-[10px]">{contOpen ? '▼' : '▶'}</span>
                                    <span className="text-white font-bold text-[11px]">{grupo.continuidade}</span>
                                    <span className="text-gray-300 text-[10px]">({gt.count})</span>
                                    {gt.semHistorico && (
                                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold bg-blue-500/30 text-blue-200">
                                        c/ novos
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-2.5 text-right text-gray-500 text-[11px]">—</td>
                                <td className="px-3 py-2.5 text-right font-mono text-[11px] text-gray-200">{fmtRep(gt.rep6m)}</td>
                                <td className="px-3 py-2.5 text-right text-gray-500 text-[11px]">—</td>
                                <td className="px-3 py-2.5 text-right font-mono text-[11px] text-gray-200">{fmtRep(gt.rep3m)}</td>
                                <td className="px-3 py-2.5 text-right font-mono text-[11px] text-gray-200 font-semibold">
                                  {gt.semHistorico ? '—' : fmtPct(gt.varPct ?? 0)}
                                </td>
                                <td className="px-3 py-2.5 text-center text-gray-500 text-[11px]">—</td>
                                <td className="px-3 py-2.5 text-right font-mono text-[11px] text-gray-100 font-semibold">{fmt(gt.jan)}</td>
                                <td className="px-3 py-2.5 text-right font-mono text-[11px] text-gray-100 font-semibold">{fmt(gt.fev)}</td>
                                <td className="px-3 py-2.5 text-right font-mono text-[11px] text-gray-100 font-semibold">{fmt(gt.mar)}</td>
                                <td className="px-3 py-2.5 text-right font-mono text-[11px] text-gray-100 font-semibold">{fmt(gt.abr)}</td>
                                <td className="px-3 py-2.5 text-right font-mono text-[11px] text-gray-100 font-semibold">{fmt(gt.mai)}</td>
                                <td className="px-3 py-2.5 text-right font-mono text-[11px] text-gray-100 font-semibold">{fmt(gt.jun)}</td>
                                <td className="px-3 py-2.5 text-right font-mono text-[11px] text-emerald-300 font-bold">{fmt(gt.total)}</td>
                              </tr>

                              {contOpen && grupo.referencias.map((ref) => {
                                const refKey = `${grupo.continuidade}|${ref.referencia}`;
                                const refOpen = expandedRefs.has(refKey);
                                const rt = ref.totais;
                                const refSelecionados = grupoTodosSelecionados(ref.itens);

                                return (
                                  <React.Fragment key={refKey}>
                                    {/* ── referência ── */}
                                    <tr
                                      onClick={() => toggleRef(refKey)}
                                      className="group cursor-pointer select-none bg-slate-50 hover:bg-slate-100 border-l-2 border-l-slate-200"
                                    >
                                      <td className="sticky left-0 z-10 bg-slate-50 group-hover:bg-slate-100 px-3 py-2 pl-8 w-[300px] min-w-[300px] max-w-[300px] shadow-[1px_0_0_0_rgba(148,163,184,0.25)]">
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="checkbox"
                                            checked={refSelecionados}
                                            onChange={() => {}}
                                            onClick={(e) => toggleSelecaoGrupo(ref.itens, e)}
                                            className="rounded"
                                          />
                                          <span className="text-slate-400 text-[10px]">{refOpen ? '▼' : '▶'}</span>
                                          <span className="font-mono text-slate-500 text-[11px]">{ref.referencia}</span>
                                          <span className="truncate text-slate-700" title={ref.produto}>{ref.produto}</span>
                                        </div>
                                      </td>
                                      <td className="px-3 py-2 text-right text-slate-300 text-[11px]">—</td>
                                      <td className="px-3 py-2 text-right font-mono text-[11px] text-slate-600">{fmtRep(rt.rep6m)}</td>
                                      <td className="px-3 py-2 text-right text-slate-300 text-[11px]">—</td>
                                      <td className="px-3 py-2 text-right font-mono text-[11px] text-slate-600">{fmtRep(rt.rep3m)}</td>
                                      <td className="px-3 py-2 text-right font-mono text-[11px] font-semibold text-slate-700">
                                        {rt.semHistorico ? 'NOVO' : fmtPct(rt.varPct ?? 0)}
                                      </td>
                                      <td className="px-3 py-2 text-center text-slate-300 text-[11px]">—</td>
                                      <td className="px-3 py-2 text-right font-mono text-[11px] text-slate-700">{fmt(rt.jan)}</td>
                                      <td className="px-3 py-2 text-right font-mono text-[11px] text-slate-700">{fmt(rt.fev)}</td>
                                      <td className="px-3 py-2 text-right font-mono text-[11px] text-slate-700">{fmt(rt.mar)}</td>
                                      <td className="px-3 py-2 text-right font-mono text-[11px] text-slate-700">{fmt(rt.abr)}</td>
                                      <td className="px-3 py-2 text-right font-mono text-[11px] text-slate-700">{fmt(rt.mai)}</td>
                                      <td className="px-3 py-2 text-right font-mono text-[11px] text-slate-700">{fmt(rt.jun)}</td>
                                      <td className="px-3 py-2 text-right font-mono text-[11px] text-emerald-700 font-bold">{fmt(rt.total)}</td>
                                    </tr>

                                    {/* ── SKUs ── */}
                                    {refOpen && ref.itens.map((item) => (
                                      <tr
                                        key={item.idproduto}
                                        className={`hover:bg-gray-50 transition-colors ${selecionados.has(item.idproduto) ? 'bg-emerald-50/50' : 'bg-white'}`}
                                      >
                                        <td className="sticky left-0 z-10 bg-inherit px-3 py-1.5 pl-12 w-[300px] min-w-[300px] max-w-[300px] shadow-[1px_0_0_0_rgba(148,163,184,0.2)]">
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="checkbox"
                                              checked={selecionados.has(item.idproduto)}
                                              onChange={() => toggleSelecionado(item.idproduto)}
                                              className="rounded"
                                            />
                                            <span className="text-gray-400 font-mono text-[10px]">{item.idproduto}</span>
                                            <span className="font-medium text-gray-700">{item.cor || '—'}</span>
                                            <span className="text-gray-400">/</span>
                                            <span className="text-gray-500">{item.tamanho || '—'}</span>
                                          </div>
                                        </td>
                                        <td className="px-3 py-1.5 text-right font-mono">{fmt(item.media_6m)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono text-gray-600">{fmtRep(item.rep_6m)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono">{fmt(item.media_3m)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono text-gray-600">{fmtRep(item.rep_3m)}</td>
                                        <td className={`px-3 py-1.5 text-right font-mono font-semibold ${
                                          item.semHistorico6m ? 'text-blue-600' : item.variacao_pct != null && item.variacao_pct > 50 ? 'text-amber-600' : 'text-gray-600'
                                        }`}>
                                          {item.semHistorico6m ? 'NOVO' : fmtPct(item.variacao_pct ?? 0)}
                                        </td>
                                        <td className="px-3 py-1.5 text-center">
                                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                            item.usaTendencia
                                              ? 'bg-amber-100 text-amber-700'
                                              : 'bg-emerald-100 text-emerald-700'
                                          }`}>
                                            {item.usaTendencia ? '3M' : 'MEDIA'}
                                          </span>
                                        </td>
                                        <td className="px-3 py-1.5 text-right font-mono bg-violet-50/40">{fmt(item.projecoes.jan)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono bg-violet-50/40">{fmt(item.projecoes.fev)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono bg-violet-50/40">{fmt(item.projecoes.mar)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono bg-violet-50/40">{fmt(item.projecoes.abr)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono bg-violet-50/40">{fmt(item.projecoes.mai)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono bg-violet-50/40">{fmt(item.projecoes.jun)}</td>
                                        <td className="px-3 py-1.5 text-right font-mono font-semibold bg-emerald-50/40 text-emerald-700">
                                          {fmt(item.totalProjecao)}
                                        </td>
                                      </tr>
                                    ))}
                                  </React.Fragment>
                                );
                              })}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                    {itensFiltrados.length > 0 && (
                      <tfoot className="sticky bottom-0 z-20 bg-slate-100 border-t-2 border-slate-300">
                        <tr className="font-semibold">
                          <td className="sticky left-0 z-20 bg-slate-100 px-3 py-2 text-right text-slate-700 w-[300px] min-w-[300px] max-w-[300px]">
                            TOTAL ({itensFiltrados.length} SKUs)
                          </td>
                          <td colSpan={6} />
                          <td className="px-3 py-2 text-right font-mono text-slate-800">
                            {fmt(itensFiltrados.reduce((a, i) => a + i.projecoes.jan, 0))}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-800">
                            {fmt(itensFiltrados.reduce((a, i) => a + i.projecoes.fev, 0))}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-800">
                            {fmt(itensFiltrados.reduce((a, i) => a + i.projecoes.mar, 0))}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-800">
                            {fmt(itensFiltrados.reduce((a, i) => a + i.projecoes.abr, 0))}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-800">
                            {fmt(itensFiltrados.reduce((a, i) => a + i.projecoes.mai, 0))}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-800">
                            {fmt(itensFiltrados.reduce((a, i) => a + i.projecoes.jun, 0))}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700 bg-emerald-100">
                            {fmt(itensFiltrados.reduce((a, i) => a + i.totalProjecao, 0))}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
