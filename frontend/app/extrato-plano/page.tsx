'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { apiErrorMessage, fetchNoCache } from '../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const PERIODOS = ['MA', 'PX', 'UL', 'QT', 'QU'] as const;

type Periodo = typeof PERIODOS[number];
type SnapshotDia = { data: string; snapshotAt: string; linhas: number };
type Resumo = {
  itensAlterados: number;
  adicionado: number;
  retirado: number;
  aumento: number;
  reducao: number;
  delta: number;
  alertas: number;
};
type PeriodoResumo = Resumo & { periodo: string; itens: number };
type Row = {
  cdProduto: string;
  periodo: string;
  referencia: string;
  produto: string;
  cor: string;
  tamanho: string;
  linha: string;
  grupo: string;
  status: string;
  nrLoteDe: string;
  nrLoteAte: string;
  dtIntegracaoDe: string | null;
  dtIntegracaoAte: string | null;
  qtdAbertoDe: number;
  qtdAbertoAte: number;
  qtdLoteDe: number;
  qtdLoteAte: number;
  deltaAberto: number;
  deltaLote: number;
  tipo: 'ADICIONADO' | 'RETIRADO' | 'AUMENTADO' | 'REDUZIDO' | 'SEM_ALTERACAO';
  alerta: boolean;
  motivos: string[];
};
type ComparativoPayload = {
  success: boolean;
  error?: string;
  details?: string;
  snapshots?: { de: string; ate: string };
  resumo?: Resumo;
  porPeriodo?: PeriodoResumo[];
  data?: Row[];
};

function fmt(v: number) {
  return Math.round(Number(v || 0)).toLocaleString('pt-BR');
}

function dateInput(value: string | null | undefined) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function fmtDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return new Date(value).toLocaleString('pt-BR');
}

function tipoClass(tipo: Row['tipo']) {
  if (tipo === 'ADICIONADO' || tipo === 'AUMENTADO') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (tipo === 'RETIRADO' || tipo === 'REDUZIDO') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-gray-50 text-gray-600 border-gray-200';
}

export default function ExtratoPlanoPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datas, setDatas] = useState<SnapshotDia[]>([]);
  const [dataDe, setDataDe] = useState('');
  const [dataAte, setDataAte] = useState('');
  const [periodos, setPeriodos] = useState<Periodo[]>(['MA', 'PX', 'UL', 'QT', 'QU']);
  const [tipoFiltro, setTipoFiltro] = useState<'TODOS' | Row['tipo'] | 'ALERTA'>('TODOS');
  const [busca, setBusca] = useState('');
  const [payload, setPayload] = useState<ComparativoPayload | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregarDatas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregarDatas() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchNoCache(`${API_URL}/api/analises/snapshot-lotes/datas`, { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(apiErrorMessage(json, 'Erro ao carregar snapshots'));
      const lista = (json.data || []) as SnapshotDia[];
      setDatas(lista);
      const ate = dateInput(lista[0]?.data);
      const de = dateInput(lista[1]?.data);
      setDataAte(ate);
      setDataDe(de);
      if (de && ate) await carregarComparativo(de, ate, periodos);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar snapshots');
    } finally {
      setLoading(false);
    }
  }

  async function carregarComparativo(de = dataDe, ate = dataAte, pers = periodos) {
    if (!de || !ate) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        de,
        ate,
        periodos: pers.join(','),
        apenas_alterados: 'true',
        limit: '5000',
      });
      const res = await fetchNoCache(`${API_URL}/api/analises/snapshot-lotes/comparativo?${params}`, { headers: authHeaders() });
      const json = (await res.json()) as ComparativoPayload;
      if (!res.ok || !json?.success) throw new Error(apiErrorMessage(json, 'Erro ao comparar snapshots'));
      setPayload(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao comparar snapshots');
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return (payload?.data || []).filter((r) => {
      if (tipoFiltro === 'ALERTA' && !r.alerta) return false;
      if (tipoFiltro !== 'TODOS' && tipoFiltro !== 'ALERTA' && r.tipo !== tipoFiltro) return false;
      if (!q) return true;
      return [r.cdProduto, r.referencia, r.produto, r.cor, r.tamanho, r.linha, r.grupo, r.nrLoteDe, r.nrLoteAte]
        .some((v) => String(v || '').toUpperCase().includes(q));
    });
  }, [payload, tipoFiltro, busca]);

  const resumoFiltrado = useMemo(() => {
    return rows.reduce((acc, r) => {
      acc.itens += 1;
      acc.delta += r.deltaAberto;
      if (r.deltaAberto > 0) acc.aumento += r.deltaAberto;
      if (r.deltaAberto < 0) acc.reducao += Math.abs(r.deltaAberto);
      if (r.tipo === 'ADICIONADO') acc.adicionado += r.deltaAberto;
      if (r.tipo === 'RETIRADO') acc.retirado += Math.abs(r.deltaAberto);
      if (r.alerta) acc.alertas += 1;
      return acc;
    }, { itens: 0, aumento: 0, reducao: 0, adicionado: 0, retirado: 0, delta: 0, alertas: 0 });
  }, [rows]);

  function togglePeriodo(periodo: Periodo) {
    setPeriodos((prev) => {
      if (prev.includes(periodo)) return prev.filter((p) => p !== periodo);
      return [...prev, periodo];
    });
  }

  const mainMargin = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <main className={`${mainMargin} transition-all duration-300 p-5 space-y-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-brand-dark">Extrato do Plano</h1>
            <p className="text-xs text-gray-500">Comparativo diario da snapshot_lotes por SKU e periodo.</p>
          </div>
          <button
            type="button"
            onClick={() => carregarComparativo()}
            disabled={loading || !dataDe || !dataAte || periodos.length === 0}
            className="px-4 py-2 rounded-md bg-brand-primary text-white text-xs font-bold disabled:opacity-50"
          >
            {loading ? 'Carregando...' : 'Atualizar'}
          </button>
        </div>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <section className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col">
              <span className="text-[10px] font-semibold text-gray-500 uppercase mb-1">De</span>
              <input type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} className="border rounded px-2 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col">
              <span className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Ate</span>
              <input type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} className="border rounded px-2 py-1.5 text-sm" />
            </label>
            <div className="flex flex-col">
              <span className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Periodos</span>
              <div className="flex gap-1">
                {PERIODOS.map((p) => (
                  <button key={p} type="button" onClick={() => togglePeriodo(p)} className={`px-2.5 py-1 rounded border text-xs font-bold ${periodos.includes(p) ? 'bg-brand-primary border-brand-primary text-white' : 'bg-white border-gray-300 text-gray-600'}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex flex-col">
              <span className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Tipo</span>
              <select value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value as typeof tipoFiltro)} className="border rounded px-2 py-1.5 text-sm">
                <option value="TODOS">Todos</option>
                <option value="ALERTA">So alertas</option>
                <option value="ADICIONADO">Adicionado</option>
                <option value="RETIRADO">Retirado</option>
                <option value="AUMENTADO">Aumentado</option>
                <option value="REDUZIDO">Reduzido</option>
              </select>
            </label>
            <label className="flex flex-col min-w-[260px]">
              <span className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Busca</span>
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Produto, ref, cor, tamanho, lote..." className="border rounded px-2 py-1.5 text-sm" />
            </label>
          </div>
          <div className="text-xs text-gray-500">
            Snapshot inicial: <strong>{fmtDateTime(payload?.snapshots?.de)}</strong> | Snapshot final: <strong>{fmtDateTime(payload?.snapshots?.ate)}</strong>
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="rounded-md border border-gray-200 bg-white px-3 py-2.5">
            <div className="text-[11px] text-gray-500">Itens alterados</div>
            <div className="text-xl font-bold text-gray-900">{fmt(resumoFiltrado.itens)}</div>
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <div className="text-[11px] text-emerald-700">Colocado/aumentado</div>
            <div className="text-xl font-bold text-emerald-700">+{fmt(resumoFiltrado.aumento)}</div>
            <div className="text-[11px] text-emerald-600">Novo: +{fmt(resumoFiltrado.adicionado)}</div>
          </div>
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5">
            <div className="text-[11px] text-red-700">Retirado/reduzido</div>
            <div className="text-xl font-bold text-red-700">-{fmt(resumoFiltrado.reducao)}</div>
            <div className="text-[11px] text-red-600">Zerado: -{fmt(resumoFiltrado.retirado)}</div>
          </div>
          <div className="rounded-md border border-gray-200 bg-white px-3 py-2.5">
            <div className="text-[11px] text-gray-500">Delta liquido</div>
            <div className={`text-xl font-bold ${resumoFiltrado.delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmt(resumoFiltrado.delta)}</div>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
            <div className="text-[11px] text-amber-700">Alertas</div>
            <div className="text-xl font-bold text-amber-800">{fmt(resumoFiltrado.alertas)}</div>
            <div className="text-[11px] text-amber-700">MA, data vencida ou plano zerado</div>
          </div>
        </section>

        {!!payload?.porPeriodo?.length && (
          <section className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {payload.porPeriodo.map((p) => (
              <div key={p.periodo} className="rounded-md border border-gray-200 bg-white px-3 py-2.5">
                <div className="text-[11px] text-gray-500">{p.periodo}</div>
                <div className={`text-lg font-bold ${p.delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmt(p.delta)}</div>
                <div className="text-[11px] text-gray-500">+{fmt(p.aumento)} / -{fmt(p.reducao)} | alertas {fmt(p.alertas)}</div>
              </div>
            ))}
          </section>
        )}

        <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-auto max-h-[68vh]">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                <tr>
                  <th className="text-left px-2 py-2">Periodo</th>
                  <th className="text-left px-2 py-2">Tipo</th>
                  <th className="text-left px-2 py-2">Ref</th>
                  <th className="text-left px-2 py-2">Produto</th>
                  <th className="text-left px-2 py-2">Cor</th>
                  <th className="text-left px-2 py-2">Tam</th>
                  <th className="text-right px-2 py-2">Antes</th>
                  <th className="text-right px-2 py-2">Depois</th>
                  <th className="text-right px-2 py-2">Delta</th>
                  <th className="text-left px-2 py-2">Lote</th>
                  <th className="text-left px-2 py-2">Integracao</th>
                  <th className="text-left px-2 py-2">Alerta</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={`${r.cdProduto}-${r.periodo}-${idx}`} className={`${r.alerta ? 'bg-amber-50' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} border-t border-gray-200`}>
                    <td className="px-2 py-1.5 font-bold">{r.periodo}</td>
                    <td className="px-2 py-1.5">
                      <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold ${tipoClass(r.tipo)}`}>{r.tipo}</span>
                    </td>
                    <td className="px-2 py-1.5 font-semibold">{r.referencia || '-'}</td>
                    <td className="px-2 py-1.5 min-w-[220px]">{r.produto || r.cdProduto}</td>
                    <td className="px-2 py-1.5">{r.cor || '-'}</td>
                    <td className="px-2 py-1.5">{r.tamanho || '-'}</td>
                    <td className="px-2 py-1.5 text-right">{fmt(r.qtdAbertoDe)}</td>
                    <td className="px-2 py-1.5 text-right">{fmt(r.qtdAbertoAte)}</td>
                    <td className={`px-2 py-1.5 text-right font-bold ${r.deltaAberto >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmt(r.deltaAberto)}</td>
                    <td className="px-2 py-1.5">{r.nrLoteDe || '-'} {'->'} {r.nrLoteAte || '-'}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{fmtDateTime(r.dtIntegracaoAte || r.dtIntegracaoDe)}</td>
                    <td className="px-2 py-1.5 min-w-[180px]">{r.motivos.length ? r.motivos.join(' | ') : '-'}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={12} className="px-3 py-8 text-center text-gray-500">Sem alteracoes para os filtros.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {datas.length > 0 && (
          <div className="text-[11px] text-gray-400">
            Datas disponiveis: {datas.slice(0, 8).map((d) => dateInput(d.data)).join(', ')}
          </div>
        )}
      </main>
    </div>
  );
}
