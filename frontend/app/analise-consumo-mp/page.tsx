'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { Planejamento } from '../types';
import { getToken } from '../lib/auth';

const API_URL = (() => {
  const raw = String(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000')
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (!raw) return 'http://localhost:8000';
  const withProto = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withProto.replace(/\/+$/, '');
})();
const MARCA_FIXA = 'LIEBE';
const STATUS_FIXO = 'EM LINHA';

function fmt(v: number) {
  return Math.round(v || 0).toLocaleString('pt-BR');
}

export default function AnaliseConsumoMpPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingPct, setLoadingPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rowsBase, setRowsBase] = useState<Array<{
    idmateriaprima: string;
    nome_materiaprima?: string;
    artigo?: string;
    estoquefisico: number;
    estoqueinsp: number;
    estoquecorte: number;
    estoquetotal: number;
    consumo_ma: number;
    consumo_px: number;
    consumo_ul: number;
    consumo_total: number;
    saldo_ma: number;
    saldo_px: number;
    saldo_ul: number;
    saldo: number;
  }>>([]);
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null);
  const [somenteFalta, setSomenteFalta] = useState(false);
  const [artigosSelecionados, setArtigosSelecionados] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'saldo_ma' | 'saldo_px' | 'saldo_ul' | 'saldo'>('saldo');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [sortArtigoBy, setSortArtigoBy] = useState<'saldo_ma' | 'saldo_px' | 'saldo_ul' | 'saldo'>('saldo');
  const [sortArtigoDir, setSortArtigoDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading) {
      setLoadingPct(100);
      const t = setTimeout(() => setLoadingPct(0), 300);
      return () => clearTimeout(t);
    }

    setLoadingPct(8);
    const timer = setInterval(() => {
      setLoadingPct((prev) => {
        if (prev >= 90) return prev;
        const next = prev + Math.max(1, Math.round((100 - prev) * 0.08));
        return Math.min(90, next);
      });
    }, 180);
    return () => clearInterval(timer);
  }, [loading]);

  async function carregar() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '5000', marca: MARCA_FIXA, status: STATUS_FIXO });
      const [rMatriz] = await Promise.all([
        fetch(`${API_URL}/api/producao/matriz?${params}`),
      ]);
      if (!rMatriz.ok) throw new Error('Erro ao carregar matriz');
      const pMatriz = await rMatriz.json();
      const matriz = (pMatriz?.data || []) as Planejamento[];

      const planos = matriz.map((i) => ({
        idproduto: String(i.produto.idproduto || ''),
        idreferencia: String(i.produto.cd_seqgrupo || ''),
        ma: Number(i.plano?.ma || 0),
        px: Number(i.plano?.px || 0),
        ul: Number(i.plano?.ul || 0),
      }))
      .filter((p) => (p.ma + p.px + p.ul) > 0);

      const rAnalise = await fetch(`${API_URL}/api/consumo-mp/analise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planos, multinivel: true }),
      });
      const pAnalise = await rAnalise.json();
      if (!rAnalise.ok || !pAnalise.success) throw new Error(pAnalise.error || 'Erro ao calcular análise MP');
      setRowsBase(Array.isArray(pAnalise.data) ? pAnalise.data : []);
      setMeta((pAnalise && pAnalise.meta) || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }

  const artigosDisponiveis = useMemo(() => {
    return Array.from(
      new Set(rowsBase.map((r) => String(r.artigo || '-').trim() || '-'))
    ).sort((a, b) => a.localeCompare(b));
  }, [rowsBase]);

  const rows = useMemo(() => {
    let base = somenteFalta ? rowsBase.filter((r) => r.saldo < 0) : rowsBase;
    if (artigosSelecionados.length > 0) {
      const setArt = new Set(artigosSelecionados);
      base = base.filter((r) => setArt.has(String(r.artigo || '-').trim() || '-'));
    }
    const sorted = [...base].sort((a, b) => {
      const av = Number(a?.[sortBy] || 0);
      const bv = Number(b?.[sortBy] || 0);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return sorted;
  }, [rowsBase, somenteFalta, artigosSelecionados, sortBy, sortDir]);

  function toggleSort(col: 'saldo_ma' | 'saldo_px' | 'saldo_ul' | 'saldo') {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(col);
    setSortDir('asc');
  }

  const rowsPorArtigo = useMemo(() => {
    const map = new Map<string, {
      artigo: string;
      itens: number;
      estoquetotal: number;
      consumo_ma: number;
      consumo_px: number;
      consumo_ul: number;
      consumo_total: number;
      saldo_ma: number;
      saldo_px: number;
      saldo_ul: number;
      saldo: number;
    }>();

    for (const r of rows) {
      const artigo = String(r.artigo || '-').trim() || '-';
      if (!map.has(artigo)) {
        map.set(artigo, {
          artigo,
          itens: 0,
          estoquetotal: 0,
          consumo_ma: 0,
          consumo_px: 0,
          consumo_ul: 0,
          consumo_total: 0,
          saldo_ma: 0,
          saldo_px: 0,
          saldo_ul: 0,
          saldo: 0,
        });
      }
      const acc = map.get(artigo)!;
      acc.itens += 1;
      acc.estoquetotal += Number(r.estoquetotal || 0);
      acc.consumo_ma += Number(r.consumo_ma || 0);
      acc.consumo_px += Number(r.consumo_px || 0);
      acc.consumo_ul += Number(r.consumo_ul || 0);
      acc.consumo_total += Number(r.consumo_total || 0);
      acc.saldo_ma += Number(r.saldo_ma || 0);
      acc.saldo_px += Number(r.saldo_px || 0);
      acc.saldo_ul += Number(r.saldo_ul || 0);
      acc.saldo += Number(r.saldo || 0);
    }

    const out = Array.from(map.values());
    out.sort((a, b) => {
      const av = Number(a?.[sortArtigoBy] || 0);
      const bv = Number(b?.[sortArtigoBy] || 0);
      return sortArtigoDir === 'asc' ? av - bv : bv - av;
    });
    return out;
  }, [rows, sortArtigoBy, sortArtigoDir]);

  function toggleSortArtigo(col: 'saldo_ma' | 'saldo_px' | 'saldo_ul' | 'saldo') {
    if (sortArtigoBy === col) {
      setSortArtigoDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortArtigoBy(col);
    setSortArtigoDir('asc');
  }

  const resumo = useMemo(() => {
    let estoque = 0;
    let consumo = 0;
    let faltantes = 0;
    rows.forEach((r) => {
      estoque += r.estoquetotal;
      consumo += r.consumo_total;
      if (r.saldo < 0) faltantes += 1;
    });
    return { estoque, consumo, saldo: estoque - consumo, faltantes };
  }, [rows]);

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 min-w-0 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="bg-brand-primary shadow-sm px-6 py-3">
          <h1 className="text-white font-bold font-secondary tracking-wide text-base">ANÁLISE CONSUMO MP</h1>
          <p className="text-white/70 text-xs">Consumo do plano MA/PX/UL x estoque de matéria-prima (físico + insp + corte)</p>
        </header>

        <main className="flex-1 min-w-0 px-6 py-5 space-y-4">
          {loading && (
            <div className="bg-white rounded-lg border p-4">
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span>Carregando análise de consumo MP...</span>
                <span className="font-semibold">{loadingPct.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</span>
              </div>
              <div className="mt-2 h-2.5 bg-gray-100 rounded-full overflow-hidden border border-gray-200">
                <div
                  className="h-full bg-brand-primary transition-[width] duration-200"
                  style={{ width: `${loadingPct}%` }}
                />
              </div>
            </div>
          )}
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-lg border border-gray-200 p-3"><div className="text-xs text-gray-500">Estoque MP Total</div><div className="text-xl font-bold">{fmt(resumo.estoque)}</div></div>
            <div className="bg-white rounded-lg border border-gray-200 p-3"><div className="text-xs text-gray-500">Consumo Plano Total</div><div className="text-xl font-bold">{fmt(resumo.consumo)}</div></div>
            <div className="bg-white rounded-lg border border-gray-200 p-3"><div className="text-xs text-gray-500">Saldo</div><div className={`text-xl font-bold ${resumo.saldo < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmt(resumo.saldo)}</div></div>
            <div className="bg-white rounded-lg border border-gray-200 p-3"><div className="text-xs text-gray-500">MP em Falta</div><div className="text-xl font-bold text-red-700">{fmt(resumo.faltantes)}</div></div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="flex flex-wrap gap-4 items-start">
              <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                <input type="checkbox" checked={somenteFalta} onChange={(e) => setSomenteFalta(e.target.checked)} />
                Mostrar somente MP com saldo negativo
              </label>
              <div className="text-xs text-gray-700">
                <div className="mb-1">Filtrar por Artigo</div>
                <select
                  multiple
                  value={artigosSelecionados}
                  onChange={(e) => {
                    const vals = Array.from(e.target.selectedOptions).map((o) => o.value);
                    setArtigosSelecionados(vals);
                  }}
                  className="border border-gray-300 rounded px-2 py-1 min-w-[220px] h-24"
                >
                  {artigosDisponiveis.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setArtigosSelecionados([])}
                    className="px-2 py-0.5 text-[11px] rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
                  >
                    Limpar
                  </button>
                  <button
                    type="button"
                    onClick={() => setArtigosSelecionados(artigosDisponiveis)}
                    className="px-2 py-0.5 text-[11px] rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
                  >
                    Selecionar todos
                  </button>
                </div>
              </div>
            </div>
            {meta && (
              <div className="mt-2 text-[11px] text-gray-600">
                Diagnóstico: modo <strong>{String(meta.modoLigacao || '-')}</strong> ·
                planos <strong>{String(meta.planosRecebidos || 0)}</strong> ·
                estrutura <strong>{String(meta.estruturaEncontrada || 0)}</strong> ·
                MPs <strong>{String(meta.materiasPrimasMapeadas || 0)}</strong> ·
                cache <strong>{Boolean(meta.cacheHit) ? 'HIT' : 'MISS'}</strong>
                {' '}· exclusões artigo <strong>{Array.isArray((meta as { exclusoes_mp?: { artigo_termos?: string[] } }).exclusoes_mp?.artigo_termos) ? (((meta as { exclusoes_mp?: { artigo_termos?: string[] } }).exclusoes_mp?.artigo_termos) || []).join(', ') : '-'}</strong>
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-200 text-xs font-semibold text-brand-dark">
              Resumo por Artigo
            </div>
            <div className="max-h-[36vh] overflow-auto border-b border-gray-200">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-gray-100 z-10">
                  <tr>
                    <th className="text-left px-2.5 py-2">Artigo</th>
                    <th className="text-right px-2.5 py-2">Itens</th>
                    <th className="text-right px-2.5 py-2">Est. Total</th>
                    <th className="text-right px-2.5 py-2">Cons. MA</th>
                    <th className="text-right px-2.5 py-2">Cons. PX</th>
                    <th className="text-right px-2.5 py-2">Cons. UL</th>
                    <th className="text-right px-2.5 py-2">
                      <button type="button" onClick={() => toggleSortArtigo('saldo_ma')} className="underline-offset-2 hover:underline">
                        Saldo MA {sortArtigoBy === 'saldo_ma' ? (sortArtigoDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="text-right px-2.5 py-2">
                      <button type="button" onClick={() => toggleSortArtigo('saldo_px')} className="underline-offset-2 hover:underline">
                        Saldo PX {sortArtigoBy === 'saldo_px' ? (sortArtigoDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="text-right px-2.5 py-2">
                      <button type="button" onClick={() => toggleSortArtigo('saldo_ul')} className="underline-offset-2 hover:underline">
                        Saldo UL {sortArtigoBy === 'saldo_ul' ? (sortArtigoDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="text-right px-2.5 py-2">
                      <button type="button" onClick={() => toggleSortArtigo('saldo')} className="underline-offset-2 hover:underline">
                        Saldo {sortArtigoBy === 'saldo' ? (sortArtigoDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rowsPorArtigo.map((r, idx) => (
                    <tr key={`${r.artigo}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
                      <td className="px-2.5 py-2 font-semibold whitespace-nowrap">{r.artigo}</td>
                      <td className="px-2.5 py-2 text-right">{fmt(r.itens)}</td>
                      <td className="px-2.5 py-2 text-right font-semibold">{fmt(r.estoquetotal)}</td>
                      <td className="px-2.5 py-2 text-right">{fmt(r.consumo_ma)}</td>
                      <td className="px-2.5 py-2 text-right">{fmt(r.consumo_px)}</td>
                      <td className="px-2.5 py-2 text-right">{fmt(r.consumo_ul)}</td>
                      <td className={`px-2.5 py-2 text-right ${r.saldo_ma < 0 ? 'text-red-700 font-semibold' : ''}`}>{fmt(r.saldo_ma)}</td>
                      <td className={`px-2.5 py-2 text-right ${r.saldo_px < 0 ? 'text-red-700 font-semibold' : ''}`}>{fmt(r.saldo_px)}</td>
                      <td className={`px-2.5 py-2 text-right ${r.saldo_ul < 0 ? 'text-red-700 font-semibold' : ''}`}>{fmt(r.saldo_ul)}</td>
                      <td className={`px-2.5 py-2 text-right font-bold ${r.saldo < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmt(r.saldo)}</td>
                    </tr>
                  ))}
                  {rowsPorArtigo.length === 0 && (
                    <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-500">Sem dados para exibir.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="max-h-[70vh] overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-gray-100 z-10">
                  <tr>
                    <th className="text-left px-2.5 py-2">idmateriaprima</th>
                    <th className="text-left px-2.5 py-2">Produto MP</th>
                    <th className="text-left px-2.5 py-2">Artigo</th>
                    <th className="text-right px-2.5 py-2">Est. Físico</th>
                    <th className="text-right px-2.5 py-2">Est. Insp</th>
                    <th className="text-right px-2.5 py-2">Est. Corte</th>
                    <th className="text-right px-2.5 py-2">Est. Total</th>
                    <th className="text-right px-2.5 py-2">Cons. MA</th>
                    <th className="text-right px-2.5 py-2">Cons. PX</th>
                    <th className="text-right px-2.5 py-2">Cons. UL</th>
                    <th className="text-right px-2.5 py-2">
                      <button type="button" onClick={() => toggleSort('saldo_ma')} className="underline-offset-2 hover:underline">
                        Saldo MA {sortBy === 'saldo_ma' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="text-right px-2.5 py-2">
                      <button type="button" onClick={() => toggleSort('saldo_px')} className="underline-offset-2 hover:underline">
                        Saldo PX {sortBy === 'saldo_px' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="text-right px-2.5 py-2">
                      <button type="button" onClick={() => toggleSort('saldo_ul')} className="underline-offset-2 hover:underline">
                        Saldo UL {sortBy === 'saldo_ul' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th className="text-right px-2.5 py-2">Cons. Total</th>
                    <th className="text-right px-2.5 py-2">
                      <button type="button" onClick={() => toggleSort('saldo')} className="underline-offset-2 hover:underline">
                        Saldo {sortBy === 'saldo' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={`${r.idmateriaprima}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
                      <td className="px-2.5 py-2 font-semibold">{r.idmateriaprima}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap">{String(r.nome_materiaprima || '-')}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap">{String(r.artigo || '-')}</td>
                      <td className="px-2.5 py-2 text-right">{fmt(r.estoquefisico)}</td>
                      <td className="px-2.5 py-2 text-right">{fmt(r.estoqueinsp)}</td>
                      <td className="px-2.5 py-2 text-right">{fmt(r.estoquecorte)}</td>
                      <td className="px-2.5 py-2 text-right font-semibold">{fmt(r.estoquetotal)}</td>
                      <td className="px-2.5 py-2 text-right">{fmt(r.consumo_ma)}</td>
                      <td className="px-2.5 py-2 text-right">{fmt(r.consumo_px)}</td>
                      <td className="px-2.5 py-2 text-right">{fmt(r.consumo_ul)}</td>
                      <td className={`px-2.5 py-2 text-right ${r.saldo_ma < 0 ? 'text-red-700 font-semibold' : ''}`}>{fmt(r.saldo_ma)}</td>
                      <td className={`px-2.5 py-2 text-right ${r.saldo_px < 0 ? 'text-red-700 font-semibold' : ''}`}>{fmt(r.saldo_px)}</td>
                      <td className={`px-2.5 py-2 text-right ${r.saldo_ul < 0 ? 'text-red-700 font-semibold' : ''}`}>{fmt(r.saldo_ul)}</td>
                      <td className="px-2.5 py-2 text-right font-semibold">{fmt(r.consumo_total)}</td>
                      <td className={`px-2.5 py-2 text-right font-bold ${r.saldo < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmt(r.saldo)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={15} className="px-3 py-8 text-center text-gray-500">Sem dados para exibir.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
