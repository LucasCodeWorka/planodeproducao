'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type CurvaItem = {
  referencia: string;
  totalQtd: number;
  totalValor: number;
  diasComVendas: number;
  qtdSkus: number;
  mediaQtdPorSku: number;
  rankQtd: number;
  rankValor: number;
  curva: 'A' | 'B' | 'C';
  top30Qtd: boolean;
  top30Valor: boolean;
};

type CurvaData = {
  totalReferencias: number;
  resumo: {
    curvaA: number;
    curvaB: number;
    curvaC: number;
  };
  estatisticas: {
    top30ApenasQtd: number;
    top30ApenasValor: number;
    top30Ambos: number;
    sobreposicaoPerc: string;
  };
  porReferencia: Record<string, 'A' | 'B' | 'C'>;
  detalhes: {
    curvaA: CurvaItem[];
    curvaB: CurvaItem[];
    curvaC: CurvaItem[];
  };
};

function fmt(v: number) {
  return Math.round(v || 0).toLocaleString('pt-BR');
}

function fmtValor(v: number) {
  return (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CurvaABCPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CurvaData | null>(null);
  const [filtroCurva, setFiltroCurva] = useState<'TODAS' | 'A' | 'B' | 'C'>('TODAS');
  const [filtroTop30, setFiltroTop30] = useState<'TODOS' | 'QTD' | 'VALOR' | 'AMBOS'>('TODOS');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [ordenacao, setOrdenacao] = useState<'rank_qtd' | 'rank_valor' | 'qtd' | 'valor' | 'media_sku' | 'ref'>('rank_qtd');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregar();
  }, []);

  async function carregar() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchNoCache(`${API_URL}/api/analises/curva-abc-referencias`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Erro ao carregar curva ABC');
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Erro ao carregar');
      setData(json as CurvaData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }

  const todosItens = useMemo(() => {
    if (!data) return [];
    return [
      ...data.detalhes.curvaA,
      ...data.detalhes.curvaB,
      ...data.detalhes.curvaC,
    ].sort((a, b) => a.rankQtd - b.rankQtd);
  }, [data]);

  const itensFiltrados = useMemo(() => {
    let itens = todosItens;

    if (filtroCurva !== 'TODAS') {
      itens = itens.filter((i) => i.curva === filtroCurva);
    }

    if (filtroTop30 !== 'TODOS') {
      if (filtroTop30 === 'QTD') {
        itens = itens.filter((i) => i.top30Qtd && !i.top30Valor);
      } else if (filtroTop30 === 'VALOR') {
        itens = itens.filter((i) => i.top30Valor && !i.top30Qtd);
      } else if (filtroTop30 === 'AMBOS') {
        itens = itens.filter((i) => i.top30Qtd && i.top30Valor);
      }
    }

    if (filtroTexto.trim()) {
      const termo = filtroTexto.trim().toUpperCase();
      itens = itens.filter((i) => i.referencia.includes(termo));
    }

    // Ordenar
    if (ordenacao === 'rank_valor') {
      itens = [...itens].sort((a, b) => a.rankValor - b.rankValor);
    } else if (ordenacao === 'qtd') {
      itens = [...itens].sort((a, b) => b.totalQtd - a.totalQtd);
    } else if (ordenacao === 'valor') {
      itens = [...itens].sort((a, b) => b.totalValor - a.totalValor);
    } else if (ordenacao === 'media_sku') {
      itens = [...itens].sort((a, b) => b.mediaQtdPorSku - a.mediaQtdPorSku);
    } else if (ordenacao === 'ref') {
      itens = [...itens].sort((a, b) => a.referencia.localeCompare(b.referencia));
    }
    // 'rank_qtd' já está ordenado por padrão

    return itens;
  }, [todosItens, filtroCurva, filtroTop30, filtroTexto, ordenacao]);

  // Estatísticas
  const stats = useMemo(() => {
    if (!data) return null;

    const totalQtdA = data.detalhes.curvaA.reduce((acc, i) => acc + i.totalQtd, 0);
    const totalQtdB = data.detalhes.curvaB.reduce((acc, i) => acc + i.totalQtd, 0);
    const totalQtdC = data.detalhes.curvaC.reduce((acc, i) => acc + i.totalQtd, 0);
    const totalQtdGeral = totalQtdA + totalQtdB + totalQtdC;

    const totalValorA = data.detalhes.curvaA.reduce((acc, i) => acc + i.totalValor, 0);
    const totalValorB = data.detalhes.curvaB.reduce((acc, i) => acc + i.totalValor, 0);
    const totalValorC = data.detalhes.curvaC.reduce((acc, i) => acc + i.totalValor, 0);
    const totalValorGeral = totalValorA + totalValorB + totalValorC;

    const percQtdA = totalQtdGeral > 0 ? (totalQtdA / totalQtdGeral) * 100 : 0;
    const percQtdB = totalQtdGeral > 0 ? (totalQtdB / totalQtdGeral) * 100 : 0;
    const percQtdC = totalQtdGeral > 0 ? (totalQtdC / totalQtdGeral) * 100 : 0;

    const percValorA = totalValorGeral > 0 ? (totalValorA / totalValorGeral) * 100 : 0;
    const percValorB = totalValorGeral > 0 ? (totalValorB / totalValorGeral) * 100 : 0;
    const percValorC = totalValorGeral > 0 ? (totalValorC / totalValorGeral) * 100 : 0;

    const percRefsA = data.totalReferencias > 0 ? (data.resumo.curvaA / data.totalReferencias) * 100 : 0;
    const percRefsB = data.totalReferencias > 0 ? (data.resumo.curvaB / data.totalReferencias) * 100 : 0;
    const percRefsC = data.totalReferencias > 0 ? (data.resumo.curvaC / data.totalReferencias) * 100 : 0;

    // Última ref curva A por quantidade
    const curvaAOrdenadaQtd = [...data.detalhes.curvaA].sort((a, b) => a.rankQtd - b.rankQtd);
    const ultimaAQtd = curvaAOrdenadaQtd.filter(i => i.top30Qtd).pop() || null;

    // Última ref curva A por valor
    const curvaAOrdenadaValor = [...data.detalhes.curvaA].sort((a, b) => a.rankValor - b.rankValor);
    const ultimaAValor = curvaAOrdenadaValor.filter(i => i.top30Valor).pop() || null;

    return {
      totalQtdA,
      totalQtdB,
      totalQtdC,
      totalQtdGeral,
      totalValorA,
      totalValorB,
      totalValorC,
      totalValorGeral,
      percQtdA,
      percQtdB,
      percQtdC,
      percValorA,
      percValorB,
      percValorC,
      percRefsA,
      percRefsB,
      percRefsC,
      ultimaAQtd,
      ultimaAValor,
    };
  }, [data]);

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="min-h-screen bg-gray-100">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`${ml} transition-all duration-300 p-6`}>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-brand-dark">Curva ABC</h1>
          <p className="text-sm text-gray-500 mt-1">
            Análise da curva ABC por referência baseada nas vendas dos últimos 90 dias (Quantidade + Valor)
          </p>
        </div>

        {loading && (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="animate-spin h-8 w-8 border-4 border-brand-primary border-t-transparent rounded-full mx-auto" />
            <p className="text-gray-500 mt-4">Carregando dados...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && data && stats && (
          <>
            {/* Estatísticas de Sobreposição */}
            <div className="bg-white rounded-lg shadow p-4 mb-6">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-4">Composição da Curva A (Top 30 Qtd + Top 30 Valor)</h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                  <div className="text-[11px] text-green-700">Total Curva A</div>
                  <div className="text-2xl font-bold text-green-800">{fmt(data.resumo.curvaA)}</div>
                  <div className="text-[10px] text-green-600">referências</div>
                </div>
                <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
                  <div className="text-[11px] text-purple-700">Apenas Top 30 Qtd</div>
                  <div className="text-2xl font-bold text-purple-800">{fmt(data.estatisticas.top30ApenasQtd)}</div>
                  <div className="text-[10px] text-purple-600">exclusivas por quantidade</div>
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                  <div className="text-[11px] text-blue-700">Apenas Top 30 Valor</div>
                  <div className="text-2xl font-bold text-blue-800">{fmt(data.estatisticas.top30ApenasValor)}</div>
                  <div className="text-[10px] text-blue-600">exclusivas por valor</div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="text-[11px] text-amber-700">Em Ambos Rankings</div>
                  <div className="text-2xl font-bold text-amber-800">{fmt(data.estatisticas.top30Ambos)}</div>
                  <div className="text-[10px] text-amber-600">top 30 qtd E valor</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="text-[11px] text-gray-500">Sobreposição</div>
                  <div className="text-2xl font-bold text-gray-700">{data.estatisticas.sobreposicaoPerc}%</div>
                  <div className="text-[10px] text-gray-500">refs em ambos rankings</div>
                </div>
              </div>
            </div>

            {/* Resumo por Curva */}
            <div className="bg-white rounded-lg shadow p-4 mb-6">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-4">Resumo por Curva</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Curva A */}
                <div className="rounded-lg border-2 border-green-300 bg-green-50 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-lg font-bold text-green-800">Curva A</span>
                    <span className="px-2 py-1 bg-green-200 text-green-800 text-xs font-bold rounded">{fmt(data.resumo.curvaA)} refs</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-[10px] text-green-600 uppercase">Quantidade</div>
                      <div className="font-semibold text-green-800">{fmt(stats.totalQtdA)}</div>
                      <div className="text-[10px] text-green-600">{stats.percQtdA.toFixed(1)}% do total</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-green-600 uppercase">Valor (R$)</div>
                      <div className="font-semibold text-green-800">{fmtValor(stats.totalValorA)}</div>
                      <div className="text-[10px] text-green-600">{stats.percValorA.toFixed(1)}% do total</div>
                    </div>
                  </div>
                </div>

                {/* Curva B */}
                <div className="rounded-lg border-2 border-gray-300 bg-gray-50 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-lg font-bold text-gray-700">Curva B</span>
                    <span className="px-2 py-1 bg-gray-200 text-gray-700 text-xs font-bold rounded">{fmt(data.resumo.curvaB)} refs</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase">Quantidade</div>
                      <div className="font-semibold text-gray-700">{fmt(stats.totalQtdB)}</div>
                      <div className="text-[10px] text-gray-500">{stats.percQtdB.toFixed(1)}% do total</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase">Valor (R$)</div>
                      <div className="font-semibold text-gray-700">{fmtValor(stats.totalValorB)}</div>
                      <div className="text-[10px] text-gray-500">{stats.percValorB.toFixed(1)}% do total</div>
                    </div>
                  </div>
                </div>

                {/* Curva C */}
                <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-lg font-bold text-red-800">Curva C</span>
                    <span className="px-2 py-1 bg-red-200 text-red-800 text-xs font-bold rounded">{fmt(data.resumo.curvaC)} refs</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-[10px] text-red-600 uppercase">Quantidade</div>
                      <div className="font-semibold text-red-800">{fmt(stats.totalQtdC)}</div>
                      <div className="text-[10px] text-red-600">{stats.percQtdC.toFixed(1)}% do total</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-red-600 uppercase">Valor (R$)</div>
                      <div className="font-semibold text-red-800">{fmtValor(stats.totalValorC)}</div>
                      <div className="text-[10px] text-red-600">{stats.percValorC.toFixed(1)}% do total</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Limites dos Rankings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="bg-white rounded-lg shadow p-4">
                <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Última Ref Top 30 por Quantidade</h3>
                {stats.ultimaAQtd ? (
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="text-2xl font-bold text-purple-700">{stats.ultimaAQtd.referencia}</div>
                      <div className="text-sm text-gray-500 mt-1">
                        Rank Qtd: #{stats.ultimaAQtd.rankQtd} | Rank Valor: #{stats.ultimaAQtd.rankValor}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold text-gray-700">{fmt(stats.ultimaAQtd.totalQtd)} pçs</div>
                      <div className="text-sm text-gray-500">R$ {fmtValor(stats.ultimaAQtd.totalValor)}</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-400">Sem dados</div>
                )}
              </div>

              <div className="bg-white rounded-lg shadow p-4">
                <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Última Ref Top 30 por Valor</h3>
                {stats.ultimaAValor ? (
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="text-2xl font-bold text-blue-700">{stats.ultimaAValor.referencia}</div>
                      <div className="text-sm text-gray-500 mt-1">
                        Rank Valor: #{stats.ultimaAValor.rankValor} | Rank Qtd: #{stats.ultimaAValor.rankQtd}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold text-gray-700">R$ {fmtValor(stats.ultimaAValor.totalValor)}</div>
                      <div className="text-sm text-gray-500">{fmt(stats.ultimaAValor.totalQtd)} pçs</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-400">Sem dados</div>
                )}
              </div>
            </div>

            {/* Regras */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
              <h3 className="text-sm font-semibold text-amber-800 mb-2">Regras de Classificação</h3>
              <ul className="text-sm text-amber-700 space-y-1">
                <li><span className="font-semibold text-green-700">Curva A:</span> União das Top 30 por quantidade + Top 30 por valor (mín 30, máx 60 refs)</li>
                <li><span className="font-semibold text-gray-700">Curva B:</span> Referências intermediárias (não estão no Top 30 de nenhum ranking e não são as últimas 20)</li>
                <li><span className="font-semibold text-red-700">Curva C:</span> Últimas 20 referências no ranking de quantidade</li>
              </ul>
              <div className="mt-2 pt-2 border-t border-amber-200 text-xs text-amber-600">
                Período de análise: últimos 90 dias | Empresa: 1
              </div>
            </div>

            {/* Filtros e Tabela */}
            <div className="bg-white rounded-lg shadow">
              <div className="p-4 border-b border-gray-200">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase">Curva:</span>
                    {(['TODAS', 'A', 'B', 'C'] as const).map((curva) => (
                      <button
                        key={curva}
                        onClick={() => setFiltroCurva(curva)}
                        className={`px-3 py-1.5 text-xs font-bold rounded border transition-colors ${
                          filtroCurva === curva
                            ? curva === 'A'
                              ? 'bg-green-600 text-white border-green-600'
                              : curva === 'C'
                                ? 'bg-red-600 text-white border-red-600'
                                : curva === 'B'
                                  ? 'bg-gray-600 text-white border-gray-600'
                                  : 'bg-brand-primary text-white border-brand-primary'
                            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
                        }`}
                      >
                        {curva === 'TODAS' ? 'Todas' : curva}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase">Top 30:</span>
                    <select
                      value={filtroTop30}
                      onChange={(e) => setFiltroTop30(e.target.value as typeof filtroTop30)}
                      className="border border-gray-300 rounded px-2 py-1 text-xs"
                    >
                      <option value="TODOS">Todos</option>
                      <option value="QTD">Apenas Qtd</option>
                      <option value="VALOR">Apenas Valor</option>
                      <option value="AMBOS">Ambos Rankings</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase">Buscar:</span>
                    <input
                      type="text"
                      value={filtroTexto}
                      onChange={(e) => setFiltroTexto(e.target.value)}
                      placeholder="Referência..."
                      className="border border-gray-300 rounded px-2 py-1 text-sm w-32"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase">Ordenar:</span>
                    <select
                      value={ordenacao}
                      onChange={(e) => setOrdenacao(e.target.value as typeof ordenacao)}
                      className="border border-gray-300 rounded px-2 py-1 text-sm"
                    >
                      <option value="rank_qtd">Rank Quantidade</option>
                      <option value="rank_valor">Rank Valor</option>
                      <option value="qtd">Por Quantidade</option>
                      <option value="valor">Por Valor</option>
                      <option value="media_sku">Media por SKU</option>
                      <option value="ref">Por Referência</option>
                    </select>
                  </div>

                  <div className="ml-auto text-sm text-gray-500">
                    {fmt(itensFiltrados.length)} referências
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Referência</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Curva</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Top 30</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-purple-600 uppercase">Rank Qtd</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-purple-600 uppercase">Qtd Vendida</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-emerald-600 uppercase">SKUs</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-emerald-600 uppercase">Media / SKU</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-blue-600 uppercase">Rank Valor</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-blue-600 uppercase">Valor (R$)</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Dias c/ Venda</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {itensFiltrados.map((item) => (
                      <tr
                        key={item.referencia}
                        className={`hover:bg-gray-50 ${
                          item.curva === 'A'
                            ? 'bg-green-50/30'
                            : item.curva === 'C'
                              ? 'bg-red-50/30'
                              : ''
                        }`}
                      >
                        <td className="px-3 py-2.5 font-semibold text-gray-800">{item.referencia}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded text-xs font-bold ${
                              item.curva === 'A'
                                ? 'bg-green-100 text-green-800'
                                : item.curva === 'C'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {item.curva}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {item.top30Qtd && (
                              <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-bold rounded">QTD</span>
                            )}
                            {item.top30Valor && (
                              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded">R$</span>
                            )}
                            {!item.top30Qtd && !item.top30Valor && (
                              <span className="text-gray-400 text-[10px]">-</span>
                            )}
                          </div>
                        </td>
                        <td className={`px-3 py-2.5 text-right font-mono tabular-nums ${item.top30Qtd ? 'text-purple-700 font-semibold' : 'text-gray-500'}`}>
                          #{item.rankQtd}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">{fmt(item.totalQtd)}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-gray-600">{fmt(item.qtdSkus)}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-emerald-700">{fmt(item.mediaQtdPorSku)}</td>
                        <td className={`px-3 py-2.5 text-right font-mono tabular-nums ${item.top30Valor ? 'text-blue-700 font-semibold' : 'text-gray-500'}`}>
                          #{item.rankValor}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">{fmtValor(item.totalValor)}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-gray-500">{item.diasComVendas}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
