'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type Curva = 'A' | 'B' | 'C' | 'D';

type CurvaItem = {
  referencia: string;
  totalQtd: number;
  totalValor: number;
  diasComVendas: number;
  qtdSkus: number;
  mediaQtdPorSku: number;
  rankQtd: number;
  rankValor: number;
  curva: Curva;
};

type CurvaData = {
  totalReferencias: number;
  resumo: {
    curvaA: number;
    curvaB: number;
    curvaC: number;
    curvaD: number;
  };
  porReferencia: Record<string, Curva>;
  detalhes: {
    curvaA: CurvaItem[];
    curvaB: CurvaItem[];
    curvaC: CurvaItem[];
    curvaD: CurvaItem[];
  };
};

type CurvaStats = {
  totalQtd: number;
  totalValor: number;
  percQtd: number;
  percValor: number;
  percRefs: number;
  ultima: CurvaItem | null;
};

function fmt(v: number) {
  return Math.round(v || 0).toLocaleString('pt-BR');
}

function fmtValor(v: number) {
  return (v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function estiloCurva(curva: Curva | 'TODAS') {
  if (curva === 'A') {
    return {
      card: 'border-green-300 bg-green-50',
      badge: 'bg-green-100 text-green-800',
      text: 'text-green-800',
      soft: 'text-green-600',
      row: 'bg-green-50/30',
      button: 'bg-green-600 text-white border-green-600',
    };
  }
  if (curva === 'B') {
    return {
      card: 'border-slate-300 bg-slate-50',
      badge: 'bg-slate-200 text-slate-700',
      text: 'text-slate-700',
      soft: 'text-slate-500',
      row: 'bg-slate-50/40',
      button: 'bg-slate-600 text-white border-slate-600',
    };
  }
  if (curva === 'C') {
    return {
      card: 'border-red-300 bg-red-50',
      badge: 'bg-red-100 text-red-800',
      text: 'text-red-800',
      soft: 'text-red-600',
      row: 'bg-red-50/30',
      button: 'bg-red-600 text-white border-red-600',
    };
  }
  if (curva === 'D') {
    return {
      card: 'border-amber-300 bg-amber-50',
      badge: 'bg-amber-100 text-amber-800',
      text: 'text-amber-800',
      soft: 'text-amber-600',
      row: 'bg-amber-50/40',
      button: 'bg-amber-600 text-white border-amber-600',
    };
  }
  return {
    card: '',
    badge: '',
    text: 'text-gray-700',
    soft: 'text-gray-500',
    row: '',
    button: 'bg-brand-primary text-white border-brand-primary',
  };
}

export default function CurvaABCPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CurvaData | null>(null);
  const [filtroCurva, setFiltroCurva] = useState<'TODAS' | Curva>('TODAS');
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
      if (!res.ok) throw new Error('Erro ao carregar curva ABCD');
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
      ...(data.detalhes.curvaA || []),
      ...(data.detalhes.curvaB || []),
      ...(data.detalhes.curvaC || []),
      ...(data.detalhes.curvaD || []),
    ].sort((a, b) => a.rankQtd - b.rankQtd);
  }, [data]);

  const itensFiltrados = useMemo(() => {
    let itens = todosItens;

    if (filtroCurva !== 'TODAS') {
      itens = itens.filter((item) => item.curva === filtroCurva);
    }

    if (filtroTexto.trim()) {
      const termo = filtroTexto.trim().toUpperCase();
      itens = itens.filter((item) => item.referencia.includes(termo));
    }

    if (ordenacao === 'rank_valor') {
      return [...itens].sort((a, b) => a.rankValor - b.rankValor);
    }
    if (ordenacao === 'qtd') {
      return [...itens].sort((a, b) => b.totalQtd - a.totalQtd);
    }
    if (ordenacao === 'valor') {
      return [...itens].sort((a, b) => b.totalValor - a.totalValor);
    }
    if (ordenacao === 'media_sku') {
      return [...itens].sort((a, b) => b.mediaQtdPorSku - a.mediaQtdPorSku);
    }
    if (ordenacao === 'ref') {
      return [...itens].sort((a, b) => a.referencia.localeCompare(b.referencia));
    }
    return itens;
  }, [todosItens, filtroCurva, filtroTexto, ordenacao]);

  const stats = useMemo(() => {
    if (!data) return null;

    const grupos: Record<Curva, CurvaItem[]> = {
      A: data.detalhes.curvaA || [],
      B: data.detalhes.curvaB || [],
      C: data.detalhes.curvaC || [],
      D: data.detalhes.curvaD || [],
    };

    const totalQtdGeral = todosItens.reduce((acc, item) => acc + item.totalQtd, 0);
    const totalValorGeral = todosItens.reduce((acc, item) => acc + item.totalValor, 0);

    const porCurva = (['A', 'B', 'C', 'D'] as const).reduce<Record<Curva, CurvaStats>>((acc, curva) => {
      const itens = grupos[curva];
      const totalQtd = itens.reduce((sum, item) => sum + item.totalQtd, 0);
      const totalValor = itens.reduce((sum, item) => sum + item.totalValor, 0);
      const ultima = [...itens].sort((a, b) => a.rankQtd - b.rankQtd).pop() || null;

      acc[curva] = {
        totalQtd,
        totalValor,
        percQtd: totalQtdGeral > 0 ? (totalQtd / totalQtdGeral) * 100 : 0,
        percValor: totalValorGeral > 0 ? (totalValor / totalValorGeral) * 100 : 0,
        percRefs: data.totalReferencias > 0 ? (itens.length / data.totalReferencias) * 100 : 0,
        ultima,
      };
      return acc;
    }, {} as Record<Curva, CurvaStats>);

    return {
      totalQtdGeral,
      totalValorGeral,
      porCurva,
    };
  }, [data, todosItens]);

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="min-h-screen bg-gray-100">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`${ml} transition-all duration-300 p-6`}>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-brand-dark">Curva ABCD</h1>
          <p className="text-sm text-gray-500 mt-1">
            Referencias filtradas com a mesma base da matriz principal e classificadas por quantidade vendida nos ultimos 90 dias.
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
            <div className="bg-white rounded-lg shadow p-4 mb-6">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-4">Resumo por Curva</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {(['A', 'B', 'C', 'D'] as const).map((curva) => {
                  const estilo = estiloCurva(curva);
                  const resumo = stats.porCurva[curva];
                  const qtdRefs = curva === 'A'
                    ? data.resumo.curvaA
                    : curva === 'B'
                      ? data.resumo.curvaB
                      : curva === 'C'
                        ? data.resumo.curvaC
                        : data.resumo.curvaD;

                  return (
                    <div key={curva} className={`rounded-lg border-2 p-4 ${estilo.card}`}>
                      <div className="flex items-center justify-between mb-3">
                        <span className={`text-lg font-bold ${estilo.text}`}>Curva {curva}</span>
                        <span className={`px-2 py-1 text-xs font-bold rounded ${estilo.badge}`}>
                          {fmt(qtdRefs)} refs
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className={`text-[10px] uppercase ${estilo.soft}`}>Quantidade</div>
                          <div className={`font-semibold ${estilo.text}`}>{fmt(resumo.totalQtd)}</div>
                          <div className={`text-[10px] ${estilo.soft}`}>{resumo.percQtd.toFixed(1)}% do total</div>
                        </div>
                        <div>
                          <div className={`text-[10px] uppercase ${estilo.soft}`}>Valor (R$)</div>
                          <div className={`font-semibold ${estilo.text}`}>{fmtValor(resumo.totalValor)}</div>
                          <div className={`text-[10px] ${estilo.soft}`}>{resumo.percValor.toFixed(1)}% do total</div>
                        </div>
                      </div>
                      <div className={`mt-3 pt-3 border-t text-[11px] ${estilo.soft}`}>
                        {resumo.percRefs.toFixed(1)}% das referencias analisadas
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
              {(['A', 'B', 'C', 'D'] as const).map((curva) => {
                const estilo = estiloCurva(curva);
                const ultima = stats.porCurva[curva].ultima;

                return (
                  <div key={curva} className={`bg-white rounded-lg shadow p-4 border ${estilo.card}`}>
                    <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
                      Ultima Ref Curva {curva}
                    </h3>
                    {ultima ? (
                      <>
                        <div className={`text-2xl font-bold ${estilo.text}`}>{ultima.referencia}</div>
                        <div className="text-sm text-gray-500 mt-1">
                          {fmt(ultima.totalQtd)} unidades | {fmt(ultima.qtdSkus)} SKUs
                        </div>
                        <div className="text-xs text-gray-500 mt-2">
                          Rank Qtd #{ultima.rankQtd} | Media / SKU {fmt(ultima.mediaQtdPorSku)}
                        </div>
                      </>
                    ) : (
                      <div className="text-gray-400">Sem dados</div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
              <h3 className="text-sm font-semibold text-amber-800 mb-2">Regras de Classificacao</h3>
              <ul className="text-sm text-amber-700 space-y-1">
                <li><span className="font-semibold text-green-700">Curva A:</span> referencias com 2.500 unidades ou mais no periodo.</li>
                <li><span className="font-semibold text-slate-700">Curva B:</span> todas as referencias restantes, exceto as separadas para Curva C e D.</li>
                <li><span className="font-semibold text-red-700">Curva C:</span> 30 referencias anteriores as ultimas 20 no ranking de quantidade.</li>
                <li><span className="font-semibold text-amber-700">Curva D:</span> ultimas 20 referencias no ranking de quantidade.</li>
              </ul>
              <div className="mt-2 pt-2 border-t border-amber-200 text-xs text-amber-600">
                Filtros aplicados: marca LIEBE, status EM LINHA e NOVA COLECAO, excluindo PT%, PT 99 e MEIA DE SEDA.
              </div>
            </div>

            <div className="bg-white rounded-lg shadow">
              <div className="p-4 border-b border-gray-200">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase">Curva:</span>
                    {(['TODAS', 'A', 'B', 'C', 'D'] as const).map((curva) => (
                      <button
                        key={curva}
                        onClick={() => setFiltroCurva(curva)}
                        className={`px-3 py-1.5 text-xs font-bold rounded border transition-colors ${
                          filtroCurva === curva
                            ? estiloCurva(curva).button
                            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
                        }`}
                      >
                        {curva === 'TODAS' ? 'Todas' : curva}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase">Buscar:</span>
                    <input
                      type="text"
                      value={filtroTexto}
                      onChange={(e) => setFiltroTexto(e.target.value)}
                      placeholder="Referencia..."
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
                      <option value="ref">Por Referencia</option>
                    </select>
                  </div>

                  <div className="ml-auto text-sm text-gray-500">
                    {fmt(itensFiltrados.length)} referencias
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Referencia</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Curva</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Rank Qtd</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Qtd Vendida</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600 uppercase">SKUs</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Media / SKU</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Rank Valor</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Valor (R$)</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Dias c/ Venda</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {itensFiltrados.map((item) => {
                      const estilo = estiloCurva(item.curva);
                      return (
                        <tr key={item.referencia} className={`hover:bg-gray-50 ${estilo.row}`}>
                          <td className="px-3 py-2.5 font-semibold text-gray-800">{item.referencia}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={`inline-block px-2.5 py-0.5 rounded text-xs font-bold ${estilo.badge}`}>
                              {item.curva}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-gray-600">#{item.rankQtd}</td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums">{fmt(item.totalQtd)}</td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-gray-600">{fmt(item.qtdSkus)}</td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-emerald-700">{fmt(item.mediaQtdPorSku)}</td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-gray-600">#{item.rankValor}</td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums">{fmtValor(item.totalValor)}</td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-gray-500">{item.diasComVendas}</td>
                        </tr>
                      );
                    })}
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
