'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { getToken, authHeaders } from '../lib/auth';
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
  original: { ma: number; px: number; ul: number };
  recalculada: { ma: number; px: number; ul: number };
};

type ReprojecaoState = {
  loading: boolean;
  base: { ano: number; mes: number } | null;
  resumo: { aumentoForte: number; media: number; manter: number; quedaLeve: number; quedaForte: number };
  sugestoes: ReprojecaoPreview[];
};

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
  const [msg,       setMsg]       = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [filtro,    setFiltro]    = useState('');
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function buscarProjecoes() {
    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/api/projecoes`, { headers: authHeaders() });
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
    finally { setLoading(false); }
  }

  async function buscarReprojecaoFechada() {
    setReprojecao((prev) => ({ ...prev, loading: true }));
    try {
      const res = await fetch(`${API_URL}/api/projecoes/reprojecao-fechada`, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setReprojecao({
          loading: false,
          base: data.base || null,
          resumo: data.resumo || { aumentoForte: 0, media: 0, manter: 0, quedaLeve: 0, quedaForte: 0 },
          sugestoes: Array.isArray(data.sugestoes) ? data.sugestoes : [],
        });
        return;
      }
    } catch {
      // silencioso
    }
    setReprojecao((prev) => ({ ...prev, loading: false }));
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setMsg(null);

    try {
      const texto = await file.text();
      const res   = await fetch(`${API_URL}/api/projecoes/upload`, {
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
      await fetch(`${API_URL}/api/projecoes`, { method: 'DELETE', headers: authHeaders() });
      setProjecoes({ timestamp: null, count: 0, data: {}, meses: [], periodos: defaultPeriodos });
      setMsg({ type: 'ok', text: 'Projeções removidas.' });
    } catch {
      setMsg({ type: 'err', text: 'Erro ao remover projeções.' });
    }
  }

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  const entradas = Object.entries(projecoes.data)
    .filter(([id]) => !filtro || id.includes(filtro.trim()))
    .sort(([a], [b]) => Number(a) - Number(b));

  const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });

  const { meses, periodos } = projecoes;

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

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="text-sm font-semibold text-brand-dark">Reprojeção por último mês fechado</div>
              <div className="mt-1 text-xs text-gray-500">
                Base atual: {reprojecao.base ? `${MESES_PT[reprojecao.base.mes]}/${reprojecao.base.ano}` : '-'} ·
                {' '}regra aplicada sobre {MESES_PT[defaultPeriodos.MA]}, {MESES_PT[defaultPeriodos.PX]} e {MESES_PT[defaultPeriodos.UL]}
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
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 sticky left-0 bg-gray-50">idproduto</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">ref</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">cont.</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">proj. base</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">venda base</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">% atend.</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">regra</th>
                    <th className="px-3 py-2 text-right font-semibold text-violet-700 bg-violet-50">MA</th>
                    <th className="px-3 py-2 text-right font-semibold text-violet-700 bg-violet-50">novo MA</th>
                    <th className="px-3 py-2 text-right font-semibold text-violet-700 bg-violet-50">PX</th>
                    <th className="px-3 py-2 text-right font-semibold text-violet-700 bg-violet-50">novo PX</th>
                    <th className="px-3 py-2 text-right font-semibold text-violet-700 bg-violet-50">UL</th>
                    <th className="px-3 py-2 text-right font-semibold text-violet-700 bg-violet-50">novo UL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {reprojecao.loading ? (
                    <tr><td colSpan={13} className="px-4 py-8 text-center text-gray-500">Carregando preview de reprojeção...</td></tr>
                  ) : reprojecao.sugestoes.length === 0 ? (
                    <tr><td colSpan={13} className="px-4 py-8 text-center text-gray-500">Sem dados para preview.</td></tr>
                  ) : (
                    reprojecao.sugestoes
                      .filter((r) => !filtro || r.idproduto.includes(filtro.trim()) || r.referencia.includes(filtro.trim()))
                      .map((r) => (
                        <tr key={`reproj-${r.idproduto}`} className="hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-1.5 font-mono text-gray-700 sticky left-0 bg-white">{r.idproduto}</td>
                          <td className="px-3 py-1.5 font-mono text-gray-700">{r.referencia || '—'}</td>
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
                        </tr>
                      ))
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
              <span>MA = <strong>{MESES_PT[periodos.MA]}</strong></span>
              <span>PX = <strong>{MESES_PT[periodos.PX]}</strong></span>
              <span>UL = <strong>{MESES_PT[periodos.UL]}</strong></span>
              <span className="text-violet-400 ml-auto">
                Meses na base: {meses.map(m => MESES_PT[m]).join(', ')}
              </span>
            </div>
          )}

          {/* Tabela de projeções */}
          {loading ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-sm text-gray-500">
              Carregando projeções...
            </div>
          ) : projecoes.count === 0 ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-sm text-gray-400 text-center">
              Nenhuma projeção cadastrada. Importe um arquivo CSV para começar.
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-4">
                <span className="text-sm font-semibold text-brand-dark">
                  {projecoes.count.toLocaleString('pt-BR')} produtos com projeção
                </span>
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
                          const val = proj[String(m)];
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
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
