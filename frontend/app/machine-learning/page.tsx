'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MESES_PT = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

type BacktestMonthRow = {
  mes: number;
  official_projected: number;
  ml_projected: number;
  actual: number;
  official_abs_error: number;
  ml_abs_error: number;
  official_accuracy_pct: number;
  ml_accuracy_pct: number;
  winner: string;
};

type BacktestSkuRow = {
  idproduto: string;
  referencia: string;
  produto: string;
  curva_abc: string;
  continuidade: string;
  linha: string;
  familia: string;
  official_projected: number;
  ml_projected: number;
  actual: number;
  official_abs_error: number;
  ml_abs_error: number;
  improvement_abs: number;
  winner: string;
};

type BacktestState = {
  available: boolean;
  timestamp: string | null;
  summary: {
    sku_count: number;
    official_accuracy_pct: number;
    ml_accuracy_pct: number;
    actual_total: number;
    official_abs_error_total: number;
    ml_abs_error_total: number;
  };
  monthly: BacktestMonthRow[];
  skuRows: BacktestSkuRow[];
};

const emptyBacktest: BacktestState = {
  available: false,
  timestamp: null,
  summary: {
    sku_count: 0,
    official_accuracy_pct: 0,
    ml_accuracy_pct: 0,
    actual_total: 0,
    official_abs_error_total: 0,
    ml_abs_error_total: 0,
  },
  monthly: [],
  skuRows: [],
};

function fmt(n: number) {
  return Number(n || 0).toLocaleString('pt-BR');
}

function fmtPct(n: number) {
  return Number(n || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function fmtDate(value: string | null) {
  if (!value) return '---';
  return new Date(value).toLocaleString('pt-BR');
}

function ScatterCompare({
  rows,
  title,
  colorClass,
  getPredicted,
}: {
  rows: BacktestSkuRow[];
  title: string;
  colorClass: string;
  getPredicted: (row: BacktestSkuRow) => number;
}) {
  const width = 360;
  const height = 280;
  const padding = 28;
  const maxValue = Math.max(
    1,
    ...rows.flatMap((row) => [Number(row.actual || 0), Number(getPredicted(row) || 0)])
  );

  const points = rows.map((row) => {
    const actual = Number(row.actual || 0);
    const predicted = Number(getPredicted(row) || 0);
    const x = padding + (actual / maxValue) * (width - padding * 2);
    const y = height - padding - (predicted / maxValue) * (height - padding * 2);
    return { x, y };
  });

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="text-sm font-semibold text-brand-dark">{title}</div>
      <div className="mt-1 text-[11px] text-gray-500">Eixo X = realizado, eixo Y = previsto. Quanto mais perto da diagonal, melhor.</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 w-full h-[280px] overflow-visible">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={padding} y1={height - padding} x2={width - padding} y2={padding} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth="1.5" />
        {points.map((point, index) => (
          <circle key={`${title}-${index}`} cx={point.x} cy={point.y} r="3.2" className={colorClass} opacity="0.55" />
        ))}
      </svg>
    </div>
  );
}

function NoiseBars({
  rows,
  title,
}: {
  rows: BacktestSkuRow[];
  title: string;
}) {
  const recent = rows.slice(0, 40).map((row) => ({
    label: row.referencia || row.idproduto,
    error: Number(row.ml_projected || 0) - Number(row.actual || 0),
  }));
  const maxAbs = Math.max(1, ...recent.map((row) => Math.abs(row.error)));

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="text-sm font-semibold text-brand-dark">{title}</div>
      <div className="mt-1 text-[11px] text-gray-500">Erro por SKU no ML. Verde = acima do real, vermelho = abaixo do real.</div>
      <div className="mt-4 space-y-2">
        {recent.map((row) => (
          <div key={`${title}-${row.label}`} className="grid grid-cols-[74px_1fr] gap-3 items-center">
            <div className="truncate text-[11px] text-gray-500">{row.label}</div>
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1 text-gray-600">
                <span>erro</span>
                <span className="font-mono">{fmt(row.error)}</span>
              </div>
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full ${row.error >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}
                  style={{ width: `${(Math.abs(row.error) / maxAbs) * 100}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnomalyScatter({
  rows,
  title,
}: {
  rows: Array<BacktestSkuRow & { residual: number; zscore: number }>;
  title: string;
}) {
  const width = 360;
  const height = 280;
  const padding = 28;
  const maxActual = Math.max(1, ...rows.map((row) => Number(row.actual || 0)));
  const maxZ = Math.max(3, ...rows.map((row) => Math.abs(Number(row.zscore || 0))));

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="text-sm font-semibold text-brand-dark">{title}</div>
      <div className="mt-1 text-[11px] text-gray-500">Eixo X = realizado, eixo Y = z-score do erro do ML. Pontos fora de +/-2,5 sao anomalias.</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 w-full h-[280px] overflow-visible">
        <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="#cbd5e1" strokeWidth="1" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#cbd5e1" strokeWidth="1" />
        {rows.map((row, index) => {
          const x = padding + (Number(row.actual || 0) / maxActual) * (width - padding * 2);
          const normalizedZ = (Number(row.zscore || 0) + maxZ) / (maxZ * 2);
          const y = height - padding - normalizedZ * (height - padding * 2);
          return (
            <circle
              key={`${title}-${index}`}
              cx={x}
              cy={y}
              r="3.2"
              className={Math.abs(Number(row.zscore || 0)) >= 2.5 ? 'fill-amber-500' : 'fill-slate-400'}
              opacity="0.7"
            />
          );
        })}
      </svg>
    </div>
  );
}

export default function MachineLearningPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [runningBacktest, setRunningBacktest] = useState(false);
  const [backtest, setBacktest] = useState<BacktestState>(emptyBacktest);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [filtroContinuidade, setFiltroContinuidade] = useState('TODAS');
  const [filtroLinha, setFiltroLinha] = useState('TODAS');
  const [filtroFamilia, setFiltroFamilia] = useState('TODAS');
  const [filtroReferencia, setFiltroReferencia] = useState('TODAS');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    loadBacktest();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadBacktest() {
    setLoading(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetchNoCache(`${API_URL}/api/ml/backtest-status`, {
        headers: authHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Erro ao carregar comparativo jan-abr');
      }
      if (!data.available || !data.data) {
        setBacktest(emptyBacktest);
      } else {
        setBacktest({
          available: true,
          timestamp: data.timestamp || null,
          summary: data.data.summary || emptyBacktest.summary,
          monthly: Array.isArray(data.data.monthly) ? data.data.monthly : [],
          skuRows: Array.isArray(data.data.skuRows) ? data.data.skuRows : [],
        });
      }
    } catch (err) {
      const message = err instanceof Error && err.name === 'AbortError'
        ? 'Tempo esgotado ao carregar comparativo jan-abr'
        : err instanceof Error
          ? err.message
          : 'Erro ao carregar comparativo jan-abr';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function runBacktest() {
    setRunningBacktest(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetchNoCache(`${API_URL}/api/ml/run-backtest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Erro ao executar backtest');
      }
      setInfo('Backtest jan-abr executado com sucesso.');
      await loadBacktest();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao executar backtest');
    } finally {
      setRunningBacktest(false);
    }
  }

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';
  const continuidades = useMemo(
    () => Array.from(new Set(backtest.skuRows.map((row) => row.continuidade).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [backtest.skuRows]
  );
  const linhas = useMemo(
    () => Array.from(new Set(backtest.skuRows.map((row) => row.linha).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [backtest.skuRows]
  );
  const familias = useMemo(
    () => Array.from(new Set(backtest.skuRows.map((row) => row.familia).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [backtest.skuRows]
  );
  const referencias = useMemo(
    () => Array.from(new Set(backtest.skuRows.map((row) => row.referencia).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [backtest.skuRows]
  );

  const filteredSkuRows = useMemo(
    () =>
      backtest.skuRows.filter((row) =>
        (filtroContinuidade === 'TODAS' || row.continuidade === filtroContinuidade) &&
        (filtroLinha === 'TODAS' || row.linha === filtroLinha) &&
        (filtroFamilia === 'TODAS' || row.familia === filtroFamilia) &&
        (filtroReferencia === 'TODAS' || row.referencia === filtroReferencia)
      ),
    [backtest.skuRows, filtroContinuidade, filtroLinha, filtroFamilia, filtroReferencia]
  );

  const filteredMonthly = backtest.monthly;

  const filteredSummary = useMemo(() => {
    const actual = filteredSkuRows.reduce((acc, row) => acc + Number(row.actual || 0), 0);
    const officialError = filteredSkuRows.reduce((acc, row) => acc + Number(row.official_abs_error || 0), 0);
    const mlError = filteredSkuRows.reduce((acc, row) => acc + Number(row.ml_abs_error || 0), 0);
    return {
      sku_count: filteredSkuRows.length,
      actual_total: Math.round(actual),
      official_abs_error_total: Math.round(officialError),
      ml_abs_error_total: Math.round(mlError),
      official_accuracy_pct: actual > 0 ? Math.max(0, 1 - officialError / actual) * 100 : 0,
      ml_accuracy_pct: actual > 0 ? Math.max(0, 1 - mlError / actual) * 100 : 0,
    };
  }, [filteredSkuRows]);

  const backtestMax = useMemo(
    () => Math.max(1, ...filteredMonthly.flatMap((row) => [row.official_projected, row.ml_projected, row.actual])),
    [filteredMonthly]
  );

  const scatterRows = useMemo(() => filteredSkuRows.slice(0, 300), [filteredSkuRows]);
  const residualRows = useMemo(() => {
    const rows = filteredSkuRows.map((row) => ({
      ...row,
      residual: Number(row.ml_projected || 0) - Number(row.actual || 0),
    }));
    const values = rows.map((row) => row.residual);
    const avg = values.length ? values.reduce((acc, value) => acc + value, 0) / values.length : 0;
    const variance = values.length > 1
      ? values.reduce((acc, value) => acc + ((value - avg) ** 2), 0) / (values.length - 1)
      : 0;
    const deviation = Math.sqrt(variance);
    return rows.map((row) => ({
      ...row,
      zscore: deviation > 0 ? (row.residual - avg) / deviation : 0,
    }));
  }, [filteredSkuRows]);
  const anomalyRows = useMemo(
    () => residualRows.filter((row) => Math.abs(row.zscore) >= 2.5).slice(0, 300),
    [residualRows]
  );

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />

      <div className={`flex-1 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="bg-brand-primary shadow-sm px-6 py-3 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-white font-bold font-secondary tracking-wide text-base">COMPARATIVO JAN-ABR 2026</h1>
            <p className="text-white/70 text-xs font-secondary font-light">
              Projecao oficial x ML x realizado
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={runBacktest}
              className="px-3 py-2 rounded-lg bg-white text-brand-primary text-sm font-semibold hover:bg-slate-100 transition-colors disabled:opacity-60"
              disabled={runningBacktest}
            >
              {runningBacktest ? 'Executando...' : 'Executar backtest'}
            </button>
            <button
              onClick={loadBacktest}
              className="px-3 py-2 rounded-lg bg-white/10 text-white text-sm font-semibold hover:bg-white/20 transition-colors"
            >
              Atualizar
            </button>
          </div>
        </header>

        <main className="flex-1 px-6 py-5 space-y-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-5 py-4">
            <div className="text-sm font-semibold text-brand-dark">Objetivo</div>
            <p className="mt-2 text-sm text-gray-600 leading-6">
              Essa tela volta para a comparacao que ja estava funcionando: usar `jan-abr/2026` como prova real do modelo,
              comparando `oficial x ML x realizado`.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {info && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-700">
              {info}
            </div>
          )}

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-5 py-4">
            <div className="text-sm font-semibold text-brand-dark mb-3">Filtros</div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <label className="text-xs text-gray-600">
                Continuidade
                <select value={filtroContinuidade} onChange={(e) => setFiltroContinuidade(e.target.value)} className="mt-1 w-full border border-gray-300 rounded px-2 py-2 text-sm">
                  <option value="TODAS">Todas</option>
                  {continuidades.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-600">
                Linha
                <select value={filtroLinha} onChange={(e) => setFiltroLinha(e.target.value)} className="mt-1 w-full border border-gray-300 rounded px-2 py-2 text-sm">
                  <option value="TODAS">Todas</option>
                  {linhas.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-600">
                Familia
                <select value={filtroFamilia} onChange={(e) => setFiltroFamilia(e.target.value)} className="mt-1 w-full border border-gray-300 rounded px-2 py-2 text-sm">
                  <option value="TODAS">Todas</option>
                  {familias.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-600">
                Referencia
                <select value={filtroReferencia} onChange={(e) => setFiltroReferencia(e.target.value)} className="mt-1 w-full border border-gray-300 rounded px-2 py-2 text-sm">
                  <option value="TODAS">Todas</option>
                  {referencias.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            </div>
          </div>

          {loading ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-5 py-10 text-sm text-gray-500 text-center">
              Carregando comparativo jan-abr...
            </div>
          ) : !backtest.available ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-5 py-10 text-sm text-gray-500 text-center">
              Nenhum backtest salvo ainda.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="text-[11px] uppercase tracking-wide text-slate-600">SKUs</div>
                  <div className="mt-1 text-2xl font-bold text-slate-800">{fmt(filteredSummary.sku_count)}</div>
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-4">
                  <div className="text-[11px] uppercase tracking-wide text-blue-600">Acur. oficial</div>
                  <div className="mt-1 text-2xl font-bold text-blue-800">{fmtPct(filteredSummary.official_accuracy_pct)}%</div>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4">
                  <div className="text-[11px] uppercase tracking-wide text-emerald-600">Acur. ML</div>
                  <div className="mt-1 text-2xl font-bold text-emerald-800">{fmtPct(filteredSummary.ml_accuracy_pct)}%</div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4">
                  <div className="text-[11px] uppercase tracking-wide text-amber-600">Erro oficial</div>
                  <div className="mt-1 text-2xl font-bold text-amber-800">{fmt(filteredSummary.official_abs_error_total)}</div>
                </div>
                <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-4">
                  <div className="text-[11px] uppercase tracking-wide text-violet-600">Erro ML</div>
                  <div className="mt-1 text-2xl font-bold text-violet-800">{fmt(filteredSummary.ml_abs_error_total)}</div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <div className="text-sm font-semibold text-brand-dark">Comparativo mensal</div>
                  <div className="mt-1 text-xs text-gray-500">
                    Ultima geracao: {fmtDate(backtest.timestamp)}
                  </div>
                </div>
                <div className="px-5 py-5 border-b border-gray-100">
                  <div className="space-y-5">
                    {filteredMonthly.map((row) => (
                      <div key={row.mes} className="grid grid-cols-[56px_1fr] gap-4 items-center">
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{MESES_PT[row.mes] || row.mes}</div>
                        <div className="space-y-2">
                          {[
                            { label: 'Oficial', value: row.official_projected, color: 'bg-blue-500', bg: 'bg-blue-100', text: 'text-blue-700' },
                            { label: 'ML', value: row.ml_projected, color: 'bg-emerald-500', bg: 'bg-emerald-100', text: 'text-emerald-700' },
                            { label: 'Real', value: row.actual, color: 'bg-violet-500', bg: 'bg-violet-100', text: 'text-violet-700' },
                          ].map((item) => (
                            <div key={item.label}>
                              <div className={`flex items-center justify-between text-[11px] mb-1 ${item.text}`}>
                                <span>{item.label}</span>
                                <span className="font-mono">{fmt(item.value)}</span>
                              </div>
                              <div className={`h-3 rounded-full overflow-hidden ${item.bg}`}>
                                <div className={`h-full rounded-full ${item.color}`} style={{ width: `${(item.value / backtestMax) * 100}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 px-5 py-5">
                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 text-sm font-semibold text-brand-dark">
                      Tabela mensal
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">Mes</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-600">Oficial</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-600">ML</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-600">Real</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-600">Erro oficial</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-600">Erro ML</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">Vencedor</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {filteredMonthly.map((row) => (
                            <tr key={row.mes}>
                              <td className="px-3 py-2 font-semibold text-gray-800">{MESES_PT[row.mes] || row.mes}</td>
                              <td className="px-3 py-2 text-right font-mono">{fmt(row.official_projected)}</td>
                              <td className="px-3 py-2 text-right font-mono">{fmt(row.ml_projected)}</td>
                              <td className="px-3 py-2 text-right font-mono">{fmt(row.actual)}</td>
                              <td className="px-3 py-2 text-right font-mono">{fmt(row.official_abs_error)}</td>
                              <td className="px-3 py-2 text-right font-mono">{fmt(row.ml_abs_error)}</td>
                              <td className="px-3 py-2 font-semibold">{row.winner}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 text-sm font-semibold text-brand-dark">
                      SKUs: ML vs oficial
                    </div>
                    <div className="overflow-x-auto max-h-[460px]">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-gray-50 z-10">
                          <tr className="border-b border-gray-200">
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">SKU</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">Ref</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-600">Oficial</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-600">ML</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-600">Real</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-600">Ganho ML</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">Vencedor</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {filteredSkuRows.slice(0, 120).map((row) => (
                            <tr key={row.idproduto}>
                              <td className="px-3 py-2 font-mono text-gray-700">{row.idproduto}</td>
                              <td className="px-3 py-2 font-mono text-gray-700">{row.referencia || '---'}</td>
                              <td className="px-3 py-2 text-right font-mono">{fmt(row.official_projected)}</td>
                              <td className="px-3 py-2 text-right font-mono">{fmt(row.ml_projected)}</td>
                              <td className="px-3 py-2 text-right font-mono">{fmt(row.actual)}</td>
                              <td className={`px-3 py-2 text-right font-mono font-semibold ${row.improvement_abs >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                                {fmt(row.improvement_abs)}
                              </td>
                              <td className="px-3 py-2 font-semibold">{row.winner}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <ScatterCompare
                  rows={scatterRows}
                  title="Projecao oficial x realizado"
                  colorClass="fill-blue-500"
                  getPredicted={(row) => row.official_projected}
                />
                <ScatterCompare
                  rows={scatterRows}
                  title="Projecao ML x realizado"
                  colorClass="fill-emerald-500"
                  getPredicted={(row) => row.ml_projected}
                />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <NoiseBars
                  rows={filteredSkuRows}
                  title="Grafico de ruido do ML"
                />
                <AnomalyScatter
                  rows={anomalyRows}
                  title="Grafico de anomalias do ML"
                />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
