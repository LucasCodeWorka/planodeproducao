'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { apiErrorMessage, fetchNoCache } from '../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const PERIODOS = ['MA', 'PX', 'UL', 'QT', 'QU'] as const;

type Periodo = typeof PERIODOS[number];
type SnapshotDia = { data: string; snapshotAt: string; linhas: number };
type AlteracaoRow = {
  cdProduto: string;
  periodo: Periodo | string;
  mes: string;
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
  qtdGerouOpDe: number;
  qtdGerouOpAte: number;
  deltaAberto: number;
  deltaLote: number;
  deltaGerouOp: number;
  venda90d: number;
  vendaPeriodo: number;
  ultimaVenda: string | null;
  tipo: 'ADICIONADO' | 'RETIRADO' | 'AUMENTADO' | 'REDUZIDO' | 'SEM_ALTERACAO';
  alerta: boolean;
  motivos: string[];
};
type MpRow = {
  idmateriaprima: string;
  nome: string;
  artigo: string;
  cor: string;
  deltaMa: number;
  deltaPx: number;
  deltaUl: number;
  deltaQt: number;
  deltaQu: number;
  deltaTotal: number;
  aumentoConsumo: number;
  reducaoConsumo: number;
  skusImpactados: number;
  estoquetotal: number;
  comprasPendentes: number;
  comprasFinalizadas: number;
  valorFinalizado: number;
  risco: 'FALTA_GERADA' | 'AUMENTO_COBERTO' | 'COMPRA_PODE_SOBRAR' | 'REDUCAO_CONSUMO' | 'NEUTRO';
  tipo: 'AUMENTOU_CONSUMO' | 'REDUZIU_CONSUMO' | 'SEM_IMPACTO';
};
type ResumoImpacto = {
  itensAlterados: number;
  aumentoPecas: number;
  reducaoPecas: number;
  deltaPecas: number;
  planoTotalDelta: number;
  gerouOpDelta: number;
  alertas: number;
  skusComVendaAlterados: number;
  mpsImpactadas: number;
  mpsFaltaGerada: number;
  mpsCompraPodeSobrar: number;
  aumentoConsumoMp: number;
  reducaoConsumoMp: number;
};
type PeriodoResumo = {
  periodo: string;
  mes: string;
  itens: number;
  aumento: number;
  reducao: number;
  delta: number;
  deltaLote: number;
  alertas: number;
};
type Diagnostico = { tipo: string; severidade: string; titulo: string; quantidade: number };
type ImpactoPayload = {
  success: boolean;
  error?: string;
  details?: string;
  snapshots?: { de: string; ate: string };
  meses?: Record<string, string>;
  resumo?: ResumoImpacto;
  porPeriodo?: PeriodoResumo[];
  diagnosticos?: Diagnostico[];
  alteracoes?: AlteracaoRow[];
  impactoMp?: MpRow[];
};

function fmt(v: number, d = 0) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function money(v: number) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dateInput(value: string | null | undefined) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function fmtDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return new Date(value).toLocaleString('pt-BR');
}

function tipoClass(tipo: AlteracaoRow['tipo']) {
  if (tipo === 'ADICIONADO' || tipo === 'AUMENTADO') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (tipo === 'RETIRADO' || tipo === 'REDUZIDO') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-gray-50 text-gray-600 border-gray-200';
}

function riscoClass(risco: MpRow['risco']) {
  if (risco === 'FALTA_GERADA') return 'bg-red-50 text-red-700 border-red-200';
  if (risco === 'COMPRA_PODE_SOBRAR') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (risco === 'AUMENTO_COBERTO') return 'bg-sky-50 text-sky-700 border-sky-200';
  return 'bg-gray-50 text-gray-600 border-gray-200';
}

function resumoZero(): ResumoImpacto {
  return {
    itensAlterados: 0,
    aumentoPecas: 0,
    reducaoPecas: 0,
    deltaPecas: 0,
    planoTotalDelta: 0,
    gerouOpDelta: 0,
    alertas: 0,
    skusComVendaAlterados: 0,
    mpsImpactadas: 0,
    mpsFaltaGerada: 0,
    mpsCompraPodeSobrar: 0,
    aumentoConsumoMp: 0,
    reducaoConsumoMp: 0,
  };
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
  const [tipoFiltro, setTipoFiltro] = useState<'TODOS' | AlteracaoRow['tipo'] | 'ALERTA'>('TODOS');
  const [riscoFiltro, setRiscoFiltro] = useState<'TODOS' | MpRow['risco']>('TODOS');
  const [busca, setBusca] = useState('');
  const [tab, setTab] = useState<'geral' | 'sku' | 'mp' | 'diagnostico'>('geral');
  const [payload, setPayload] = useState<ImpactoPayload | null>(null);

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
      if (de && ate) await carregarImpacto(de, ate, periodos);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar snapshots');
    } finally {
      setLoading(false);
    }
  }

  async function carregarImpacto(de = dataDe, ate = dataAte, pers = periodos) {
    if (!de || !ate) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        de,
        ate,
        periodos: pers.join(','),
        limit: '200',
      });
      const res = await fetchNoCache(`${API_URL}/api/analises/snapshot-lotes/impacto-rapido?${params}`, { headers: authHeaders() }, 240000);
      const json = (await res.json()) as ImpactoPayload;
      if (!res.ok || !json?.success) throw new Error(apiErrorMessage(json, 'Erro ao analisar impacto do plano'));
      setPayload(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao analisar impacto do plano');
    } finally {
      setLoading(false);
    }
  }

  const rowsSku = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return (payload?.alteracoes || []).filter((r) => {
      if (tipoFiltro === 'ALERTA' && !r.alerta) return false;
      if (tipoFiltro !== 'TODOS' && tipoFiltro !== 'ALERTA' && r.tipo !== tipoFiltro) return false;
      if (!q) return true;
      return [r.cdProduto, r.referencia, r.produto, r.cor, r.tamanho, r.linha, r.grupo, r.nrLoteDe, r.nrLoteAte]
        .some((v) => String(v || '').toUpperCase().includes(q));
    });
  }, [payload, tipoFiltro, busca]);

  const rowsMp = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return (payload?.impactoMp || []).filter((r) => {
      if (riscoFiltro !== 'TODOS' && r.risco !== riscoFiltro) return false;
      if (!q) return true;
      return [r.idmateriaprima, r.nome, r.artigo, r.cor, r.risco].some((v) => String(v || '').toUpperCase().includes(q));
    });
  }, [payload, riscoFiltro, busca]);

  const resumo = payload?.resumo || resumoZero();
  const mainMargin = sidebarCollapsed ? 'ml-20' : 'ml-64';
  const snapshotMaisRecente = dateInput(datas[0]?.data);
  const snapshotMaisAntigo = dateInput(datas[datas.length - 1]?.data);

  function togglePeriodo(periodo: Periodo) {
    setPeriodos((prev) => {
      if (prev.includes(periodo)) return prev.filter((p) => p !== periodo);
      return [...prev, periodo];
    });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <main className={`${mainMargin} transition-all duration-300 p-5 space-y-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-brand-dark">Extrato do Plano</h1>
            <p className="text-xs text-gray-500">Mudancas de snapshot, impacto em MP e compras vinculadas ao plano alterado.</p>
          </div>
          <button
            type="button"
            onClick={() => carregarImpacto()}
            disabled={loading || !dataDe || !dataAte || periodos.length === 0}
            className="px-4 py-2 rounded-md bg-brand-primary text-white text-xs font-bold disabled:opacity-50"
          >
            {loading ? 'Analisando...' : 'Atualizar'}
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
            <label className="flex flex-col min-w-[260px]">
              <span className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Busca</span>
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Produto, MP, ref, cor, lote..." className="border rounded px-2 py-1.5 text-sm" />
            </label>
          </div>
          <div className="text-xs text-gray-500">
            Snapshot inicial: <strong>{fmtDateTime(payload?.snapshots?.de)}</strong> | Snapshot final: <strong>{fmtDateTime(payload?.snapshots?.ate)}</strong>
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <Card label="SKUs alterados" value={fmt(resumo.itensAlterados)} detail={`${fmt(resumo.alertas)} alertas`} tone="slate" />
          <Card label="Plano aberto +" value={`+${fmt(resumo.aumentoPecas)}`} detail="Pecas adicionadas" tone="emerald" />
          <Card label="Plano aberto -" value={`-${fmt(resumo.reducaoPecas)}`} detail="Pecas retiradas" tone="red" />
          <Card label="Delta aberto" value={fmt(resumo.deltaPecas)} detail={`Lote ${fmt(resumo.planoTotalDelta)}`} tone={resumo.deltaPecas >= 0 ? 'emerald' : 'red'} />
          <Card label="MP falta" value={fmt(resumo.mpsFaltaGerada)} detail={`${fmt(resumo.mpsImpactadas)} MPs impactadas`} tone="red" />
          <Card label="MP pode sobrar" value={fmt(resumo.mpsCompraPodeSobrar)} detail="Compra x reducao" tone="amber" />
        </section>

        <section className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {(payload?.porPeriodo || []).map((p) => (
            <div key={p.periodo} className="rounded-md border border-gray-200 bg-white px-3 py-2.5">
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-gray-500">{p.periodo}</div>
                <div className="text-[11px] text-gray-400">{p.mes}</div>
              </div>
              <div className={`text-lg font-bold ${p.delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmt(p.delta)}</div>
              <div className="text-[11px] text-gray-500">+{fmt(p.aumento)} / -{fmt(p.reducao)} | alertas {fmt(p.alertas)}</div>
            </div>
          ))}
        </section>

        <div className="flex flex-wrap gap-2">
          {(['geral', 'sku', 'mp', 'diagnostico'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`px-3 py-1.5 rounded border text-xs font-bold ${tab === item ? 'bg-brand-primary border-brand-primary text-white' : 'bg-white border-gray-300 text-gray-600'}`}
            >
              {item === 'geral' ? 'Geral' : item === 'sku' ? 'Mudancas SKU' : item === 'mp' ? 'Impacto MP' : 'Diagnostico'}
            </button>
          ))}
        </div>

        {tab === 'geral' && (
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Panel title="Leitura da execucao">
              <Info label="Plano total alterado" value={fmt(resumo.planoTotalDelta)} />
              <Info label="Aberto alterado" value={fmt(resumo.deltaPecas)} />
              <Info label="Virou OP no periodo" value={fmt(resumo.gerouOpDelta)} />
              <Info label="Base analisada" value="Maiores 200 deltas" />
            </Panel>
            <Panel title="Impacto em MP">
              <Info label="Aumento de consumo MP" value={fmt(resumo.aumentoConsumoMp, 1)} />
              <Info label="Reducao de consumo MP" value={fmt(resumo.reducaoConsumoMp, 1)} />
              <Info label="MPs com falta potencial" value={fmt(resumo.mpsFaltaGerada)} />
              <Info label="MPs com compra que pode sobrar" value={fmt(resumo.mpsCompraPodeSobrar)} />
            </Panel>
            <Panel title="Prioridades">
              {(payload?.diagnosticos || []).map((d) => (
                <div key={d.tipo} className="flex items-center justify-between border-b border-gray-100 py-2 last:border-0">
                  <span className="text-xs text-gray-700">{d.titulo}</span>
                  <span className={`text-sm font-bold ${d.severidade === 'alta' ? 'text-red-700' : 'text-amber-700'}`}>{fmt(d.quantidade)}</span>
                </div>
              ))}
            </Panel>
          </section>
        )}

        {tab === 'sku' && (
          <>
            <section className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="flex flex-wrap items-end gap-3">
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
              </div>
            </section>
            <SkuTable rows={rowsSku} />
          </>
        )}

        {tab === 'mp' && (
          <>
            <section className="bg-white border border-gray-200 rounded-lg p-3">
              <label className="flex flex-col max-w-[260px]">
                <span className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Risco MP</span>
                <select value={riscoFiltro} onChange={(e) => setRiscoFiltro(e.target.value as typeof riscoFiltro)} className="border rounded px-2 py-1.5 text-sm">
                  <option value="TODOS">Todos</option>
                  <option value="FALTA_GERADA">Falta gerada</option>
                  <option value="COMPRA_PODE_SOBRAR">Compra pode sobrar</option>
                  <option value="AUMENTO_COBERTO">Aumento coberto</option>
                  <option value="REDUCAO_CONSUMO">Reducao consumo</option>
                  <option value="NEUTRO">Neutro</option>
                </select>
              </label>
            </section>
            <MpTable rows={rowsMp} />
          </>
        )}

        {tab === 'diagnostico' && (
          <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-200 text-sm font-bold text-gray-800">Alteracoes criticas</div>
            <SkuTable rows={(payload?.alteracoes || []).filter((r) => r.alerta)} />
          </section>
        )}

        {datas.length > 0 && (
          <div className="text-[11px] text-gray-400">
            Snapshots carregados: {fmt(datas.length)} dias, de {snapshotMaisAntigo} ate {snapshotMaisRecente}. Mais recentes: {datas.slice(0, 10).map((d) => `${dateInput(d.data)} (${fmt(d.linhas)})`).join(', ')}.
          </div>
        )}
      </main>
    </div>
  );
}

function Card({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'slate' | 'emerald' | 'red' | 'amber' }) {
  const cls = tone === 'emerald'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : tone === 'red'
      ? 'border-red-200 bg-red-50 text-red-700'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-gray-200 bg-white text-gray-900';
  return (
    <div className={`rounded-md border px-3 py-2.5 ${cls}`}>
      <div className="text-[11px] opacity-80">{label}</div>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-[11px] opacity-75">{detail}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="px-3 py-2 border-b border-gray-200 text-sm font-bold text-gray-800">{title}</div>
      <div className="px-3 py-2">{children}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 py-2 last:border-0">
      <span className="text-xs text-gray-600">{label}</span>
      <span className="text-sm font-bold text-gray-900">{value}</span>
    </div>
  );
}

function SkuTable({ rows }: { rows: AlteracaoRow[] }) {
  return (
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
              <th className="text-right px-2 py-2">Aberto antes</th>
              <th className="text-right px-2 py-2">Aberto depois</th>
              <th className="text-right px-2 py-2">Delta aberto</th>
              <th className="text-right px-2 py-2">Delta lote</th>
              <th className="text-right px-2 py-2">Gerou OP</th>
              <th className="text-left px-2 py-2">Alerta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={`${r.cdProduto}-${r.periodo}-${idx}`} className={`${r.alerta ? 'bg-amber-50' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} border-t border-gray-200`}>
                <td className="px-2 py-1.5 font-bold">{r.periodo}<div className="text-[10px] text-gray-400">{r.mes}</div></td>
                <td className="px-2 py-1.5"><span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold ${tipoClass(r.tipo)}`}>{r.tipo}</span></td>
                <td className="px-2 py-1.5 font-semibold">{r.referencia || '-'}</td>
                <td className="px-2 py-1.5 min-w-[240px]">{r.produto || r.cdProduto}</td>
                <td className="px-2 py-1.5">{r.cor || '-'}</td>
                <td className="px-2 py-1.5">{r.tamanho || '-'}</td>
                <td className="px-2 py-1.5 text-right">{fmt(r.qtdAbertoDe)}</td>
                <td className="px-2 py-1.5 text-right">{fmt(r.qtdAbertoAte)}</td>
                <td className={`px-2 py-1.5 text-right font-bold ${r.deltaAberto >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmt(r.deltaAberto)}</td>
                <td className={`px-2 py-1.5 text-right ${r.deltaLote >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmt(r.deltaLote)}</td>
                <td className="px-2 py-1.5 text-right">{fmt(r.deltaGerouOp)}</td>
                <td className="px-2 py-1.5 min-w-[220px]">{r.motivos.length ? r.motivos.join(' | ') : '-'}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={12} className="px-3 py-8 text-center text-gray-500">Sem alteracoes para os filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MpTable({ rows }: { rows: MpRow[] }) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="overflow-auto max-h-[68vh]">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
            <tr>
              <th className="text-left px-2 py-2">Risco</th>
              <th className="text-left px-2 py-2">MP</th>
              <th className="text-left px-2 py-2">Artigo</th>
              <th className="text-right px-2 py-2">Delta total</th>
              <th className="text-right px-2 py-2">MA</th>
              <th className="text-right px-2 py-2">PX</th>
              <th className="text-right px-2 py-2">UL</th>
              <th className="text-right px-2 py-2">QT</th>
              <th className="text-right px-2 py-2">QU</th>
              <th className="text-right px-2 py-2">Estoque</th>
              <th className="text-right px-2 py-2">Compras pend.</th>
              <th className="text-right px-2 py-2">Compras final.</th>
              <th className="text-right px-2 py-2">Valor final.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={`${r.idmateriaprima}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} border-t border-gray-200`}>
                <td className="px-2 py-1.5"><span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold ${riscoClass(r.risco)}`}>{r.risco}</span></td>
                <td className="px-2 py-1.5 min-w-[260px]"><div className="font-bold">{r.idmateriaprima}</div><div>{r.nome || '-'}</div></td>
                <td className="px-2 py-1.5">{r.artigo || '-'}</td>
                <td className={`px-2 py-1.5 text-right font-bold ${r.deltaTotal >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmt(r.deltaTotal, 1)}</td>
                <td className="px-2 py-1.5 text-right">{fmt(r.deltaMa, 1)}</td>
                <td className="px-2 py-1.5 text-right">{fmt(r.deltaPx, 1)}</td>
                <td className="px-2 py-1.5 text-right">{fmt(r.deltaUl, 1)}</td>
                <td className="px-2 py-1.5 text-right">{fmt(r.deltaQt, 1)}</td>
                <td className="px-2 py-1.5 text-right">{fmt(r.deltaQu, 1)}</td>
                <td className="px-2 py-1.5 text-right">{fmt(r.estoquetotal, 1)}</td>
                <td className="px-2 py-1.5 text-right">{fmt(r.comprasPendentes, 1)}</td>
                <td className="px-2 py-1.5 text-right">{fmt(r.comprasFinalizadas, 1)}</td>
                <td className="px-2 py-1.5 text-right">{money(r.valorFinalizado)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={13} className="px-3 py-8 text-center text-gray-500">Sem MPs para os filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
