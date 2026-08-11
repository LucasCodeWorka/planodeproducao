'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Download, RefreshCw, Search } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';

const API_URL = (() => {
  const raw = String(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000')
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (!raw) return 'http://localhost:8000';
  const withProto = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withProto.replace(/\/+$/, '');
})();

type ExcessoMpRow = {
  idmateriaprima: string;
  descricao: string;
  artigo: string;
  estoquefisico: number;
  estoqueinsp: number;
  estoquecorte: number;
  estoquetotal: number;
  skus_em_linha: number;
  consumo_ultimos_dias: number;
  consumo_dia: number;
  estoque_cinco_dias: number;
  consumo_op: number;
  consumo_ma: number;
  consumo_px: number;
  consumo_ul: number;
  consumo_qt: number;
  consumo_direto: number;
  consumo_indireto: number;
  entrada_ma: number;
  entrada_px: number;
  entrada_ul: number;
  entrada_qt: number;
  saldo_ma: number;
  saldo_px: number;
  saldo_ul: number;
  saldo_qt: number;
  dias_cobertura_qt: number | null;
  excesso_ma: number;
  excesso_px: number;
  excesso_ul: number;
  excesso_qt: number;
  custo_unitario: number;
  valor_excesso_ma: number;
  valor_excesso_px: number;
  valor_excesso_ul: number;
  valor_excesso_qt: number;
  valor_saldo_qt: number;
};

type Resumo = {
  itens: number;
  estoque: number;
  excesso_ma: number;
  excesso_px: number;
  excesso_ul: number;
  excesso_qt: number;
  saldo_qt: number;
  consumo_qt: number;
  consumo_ultimos_dias: number;
  valor_excesso_ma: number;
  valor_excesso_px: number;
  valor_excesso_ul: number;
  valor_excesso_qt: number;
  valor_saldo_qt: number;
  valor_consumo_30d: number;
};

type ArtigoResumo = {
  artigo: string;
  itens: number;
  estoque: number;
  saldo_qt: number;
  excesso_ma: number;
  excesso_px: number;
  excesso_ul: number;
  excesso_qt: number;
  valor_excesso_ma: number;
  valor_excesso_px: number;
  valor_excesso_ul: number;
  valor_excesso_qt: number;
  valor_saldo_qt: number;
};

type PriceOption = {
  id: string;
  value: number | null;
  price?: number | null;
  description?: string;
};

function fmt(n: number | null | undefined, digits = 0) {
  const value = Number(n || 0);
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function money(n: number | null | undefined) {
  return Number(n || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  if (/[",\n;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export default function ExcessoMpPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rows, setRows] = useState<ExcessoMpRow[]>([]);
  const [priceOptionsByMp, setPriceOptionsByMp] = useState<Record<string, PriceOption[]>>({});
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [buscar, setBuscar] = useState('');
  const [artigo, setArtigo] = useState('');
  const [diasConsumo, setDiasConsumo] = useState(30);
  const [diasCobertura, setDiasCobertura] = useState(5);
  const [somenteExcesso, setSomenteExcesso] = useState(true);
  const [sortBy, setSortBy] = useState<keyof ExcessoMpRow>('excesso_qt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading && !loadingPrices) {
      if (progress > 0) {
        const timer = window.setTimeout(() => {
          setProgress(0);
          setLoadingStage('');
        }, 900);
        return () => window.clearTimeout(timer);
      }
      return;
    }
    const timer = window.setInterval(() => {
      setProgress((prev) => {
        const max = loadingPrices ? 96 : 82;
        if (prev >= max) return prev;
        return Math.min(max, prev + Math.max(1, Math.round((max - prev) * 0.08)));
      });
    }, 700);
    return () => window.clearInterval(timer);
  }, [loading, loadingPrices, progress]);

  async function carregar() {
    setLoading(true);
    setLoadingStage('Calculando plano, estoque, compras e consumo...');
    setProgress(8);
    setError(null);
    try {
      const params = new URLSearchParams({
        dias_consumo: String(diasConsumo),
        dias_cobertura: String(diasCobertura),
        somente_excesso: 'false',
        limit: '3000',
      });

      const response = await fetchNoCache(`${API_URL}/api/excesso-mp?${params}`, {}, 600000);
      setProgress(72);
      setLoadingStage('Recebendo dados calculados...');
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Erro ao carregar excesso de MP');
      }
      const data = Array.isArray(payload.data) ? payload.data : [];
      setRows(data);
      carregarPrecosMp(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar excesso de MP');
    } finally {
      setLoading(false);
    }
  }

  async function carregarPrecosMp(mps: ExcessoMpRow[]) {
    const productCodes = Array.from(new Set(mps.map((row) => String(row.idmateriaprima || '').trim()).filter(Boolean)));
    if (!productCodes.length) {
      setPriceOptionsByMp({});
      setProgress(100);
      setLoadingStage('Finalizado');
      return;
    }
    setLoadingPrices(true);
    setProgress((prev) => Math.max(prev, 82));
    setLoadingStage('Buscando valores unitarios das MPs...');
    try {
      const response = await fetchNoCache(`${API_URL}/api/totvs-moda/prices/mp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ productCodes }),
      }, 180000);
      const payload = await response.json();
      setPriceOptionsByMp(response.ok && payload?.success && payload.data ? payload.data : {});
      setProgress(100);
      setLoadingStage('Finalizado');
    } catch {
      setPriceOptionsByMp({});
      setProgress(100);
      setLoadingStage('Finalizado sem valores unitarios');
    } finally {
      setLoadingPrices(false);
    }
  }

  function valorUnitarioMp(productCode: string) {
    const option = priceOptionsByMp[productCode]?.[0];
    return Number(option?.value || 0);
  }

  function withValores(row: ExcessoMpRow): ExcessoMpRow {
    const valorUnitario = valorUnitarioMp(String(row.idmateriaprima || '').trim());
    return {
      ...row,
      custo_unitario: valorUnitario,
      valor_excesso_ma: Number(row.excesso_ma || 0) * valorUnitario,
      valor_excesso_px: Number(row.excesso_px || 0) * valorUnitario,
      valor_excesso_ul: Number(row.excesso_ul || 0) * valorUnitario,
      valor_excesso_qt: Number(row.excesso_qt || 0) * valorUnitario,
      valor_saldo_qt: Number(row.saldo_qt || 0) * valorUnitario,
    };
  }

  const artigos = useMemo(() => {
    return Array.from(new Set(rows.map((row) => String(row.artigo || '-').trim() || '-')))
      .sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = buscar.trim().toUpperCase();
    return rows.filter((row) => {
      if (artigo && String(row.artigo || '').trim() !== artigo) return false;
      if (somenteExcesso && !(Number(row.consumo_dia || 0) > 0 && Number(row.saldo_qt || 0) > Number(row.estoque_cinco_dias || 0))) return false;
      if (!q) return true;
      const hay = [
        row.idmateriaprima,
        row.descricao,
        row.artigo,
      ].join(' ').toUpperCase();
      return hay.includes(q);
    }).map(withValores);
  }, [rows, buscar, artigo, somenteExcesso, priceOptionsByMp]);

  const resumo = useMemo<Resumo>(() => {
    return filteredRows.reduce((acc, row) => {
      acc.itens += 1;
      acc.estoque += Number(row.estoquetotal || 0);
      acc.excesso_ma += Number(row.excesso_ma || 0);
      acc.excesso_px += Number(row.excesso_px || 0);
      acc.excesso_ul += Number(row.excesso_ul || 0);
      acc.excesso_qt += Number(row.excesso_qt || 0);
      acc.saldo_qt += Number(row.saldo_qt || 0);
      acc.consumo_qt += Number(row.consumo_qt || 0);
      acc.consumo_ultimos_dias += Number(row.consumo_ultimos_dias || 0);
      acc.valor_excesso_ma += Number(row.valor_excesso_ma || 0);
      acc.valor_excesso_px += Number(row.valor_excesso_px || 0);
      acc.valor_excesso_ul += Number(row.valor_excesso_ul || 0);
      acc.valor_excesso_qt += Number(row.valor_excesso_qt || 0);
      acc.valor_saldo_qt += Number(row.valor_saldo_qt || 0);
      // Valor do consumo 30 dias = consumo_ultimos_dias * custo_unitario
      acc.valor_consumo_30d += Number(row.consumo_ultimos_dias || 0) * Number(row.custo_unitario || 0);
      return acc;
    }, {
      itens: 0,
      estoque: 0,
      excesso_ma: 0,
      excesso_px: 0,
      excesso_ul: 0,
      excesso_qt: 0,
      saldo_qt: 0,
      consumo_qt: 0,
      consumo_ultimos_dias: 0,
      valor_excesso_ma: 0,
      valor_excesso_px: 0,
      valor_excesso_ul: 0,
      valor_excesso_qt: 0,
      valor_saldo_qt: 0,
      valor_consumo_30d: 0,
    });
  }, [filteredRows]);

  const porArtigo = useMemo<ArtigoResumo[]>(() => {
    const map = new Map<string, ArtigoResumo>();
    for (const row of filteredRows) {
      const key = String(row.artigo || 'SEM ARTIGO').trim() || 'SEM ARTIGO';
      if (!map.has(key)) {
        map.set(key, {
          artigo: key,
          itens: 0,
          estoque: 0,
          saldo_qt: 0,
          excesso_ma: 0,
          excesso_px: 0,
          excesso_ul: 0,
          excesso_qt: 0,
          valor_excesso_ma: 0,
          valor_excesso_px: 0,
          valor_excesso_ul: 0,
          valor_excesso_qt: 0,
          valor_saldo_qt: 0,
        });
      }
      const acc = map.get(key)!;
      acc.itens += 1;
      acc.estoque += Number(row.estoquetotal || 0);
      acc.saldo_qt += Number(row.saldo_qt || 0);
      acc.excesso_ma += Number(row.excesso_ma || 0);
      acc.excesso_px += Number(row.excesso_px || 0);
      acc.excesso_ul += Number(row.excesso_ul || 0);
      acc.excesso_qt += Number(row.excesso_qt || 0);
      acc.valor_excesso_ma += Number(row.valor_excesso_ma || 0);
      acc.valor_excesso_px += Number(row.valor_excesso_px || 0);
      acc.valor_excesso_ul += Number(row.valor_excesso_ul || 0);
      acc.valor_excesso_qt += Number(row.valor_excesso_qt || 0);
      acc.valor_saldo_qt += Number(row.valor_saldo_qt || 0);
    }
    return Array.from(map.values()).sort((a, b) => b.valor_excesso_qt - a.valor_excesso_qt);
  }, [filteredRows]);

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      const av = Number(a[sortBy] || 0);
      const bv = Number(b[sortBy] || 0);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [filteredRows, sortBy, sortDir]);

  function toggleSort(col: keyof ExcessoMpRow) {
    if (sortBy === col) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  }

  function exportarCsv() {
    const header = [
      'idmateriaprima', 'descricao', 'artigo', 'estoque_total', 'consumo_30d', 'consumo_dia',
      'estoque_5_dias', 'skus_em_linha', 'consumo_op', 'consumo_ma', 'consumo_px', 'consumo_ul', 'consumo_qt',
      'saldo_ma', 'saldo_px', 'saldo_ul', 'saldo_qt', 'custo_unitario', 'excesso_ma', 'excesso_px', 'excesso_ul', 'excesso_qt',
      'valor_excesso_ma', 'valor_excesso_px', 'valor_excesso_ul', 'valor_excesso_qt',
    ];
    const body = sortedRows.map((row) => [
      row.idmateriaprima, row.descricao, row.artigo, row.estoquetotal, row.consumo_ultimos_dias, row.consumo_dia,
      row.estoque_cinco_dias, row.skus_em_linha, row.consumo_op, row.consumo_ma, row.consumo_px, row.consumo_ul, row.consumo_qt,
      row.saldo_ma, row.saldo_px, row.saldo_ul, row.saldo_qt, row.custo_unitario, row.excesso_ma, row.excesso_px, row.excesso_ul, row.excesso_qt,
      row.valor_excesso_ma, row.valor_excesso_px, row.valor_excesso_ul, row.valor_excesso_qt,
    ]);
    const csv = [header, ...body].map((line) => line.map(csvEscape).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `excesso_mp_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 min-w-0 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        {(loading || loadingPrices || progress > 0) && (
          <div className="fixed top-0 left-0 right-0 z-50 bg-white/95 border-b border-gray-200 shadow-sm">
            <div className="h-1 bg-gray-100">
              <div
                className="h-full bg-brand-primary transition-all duration-500"
                style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
              />
            </div>
            <div className={`${ml} transition-all duration-300 px-6 py-1.5 text-xs text-gray-700 flex items-center justify-between`}>
              <span>{loadingStage || 'Carregando...'}</span>
              <span className="tabular-nums font-semibold">{Math.round(Math.min(100, progress))}%</span>
            </div>
          </div>
        )}
        <header className="bg-brand-primary shadow-sm px-6 py-3">
          <h1 className="text-white font-bold font-secondary tracking-wide text-base">EXCESSO MP</h1>
          <p className="text-white/75 text-xs">Saldo apos consumir o plano MA/PX/UL/QT, comparado com cobertura minima por consumo real. OP aberta fica apenas informativa.</p>
        </header>

        <main className="flex-1 min-w-0 px-6 py-5 space-y-4">
          {/* Resumo geral */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card label="Itens c/ Excesso" value={fmt(resumo?.itens)} />
            <Card label="Estoque Total" value={fmt(resumo?.estoque)} />
            <Card label="Consumo 30d (qtd)" value={fmt(resumo?.consumo_ultimos_dias)} />
            <Card label="Consumo 30d (R$)" value={money(resumo?.valor_consumo_30d)} tone="emerald" />
          </div>

          {/* Excesso por periodo */}
          <section className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm font-semibold text-brand-dark mb-3">Excesso por Periodo vs Orcamento (Consumo 30d)</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <PeriodoCard
                periodo="MA"
                excessoQtd={resumo?.excesso_ma || 0}
                excessoValor={resumo?.valor_excesso_ma || 0}
                orcamento={resumo?.valor_consumo_30d || 0}
              />
              <PeriodoCard
                periodo="PX"
                excessoQtd={resumo?.excesso_px || 0}
                excessoValor={resumo?.valor_excesso_px || 0}
                orcamento={resumo?.valor_consumo_30d || 0}
              />
              <PeriodoCard
                periodo="UL"
                excessoQtd={resumo?.excesso_ul || 0}
                excessoValor={resumo?.valor_excesso_ul || 0}
                orcamento={resumo?.valor_consumo_30d || 0}
              />
              <PeriodoCard
                periodo="QT"
                excessoQtd={resumo?.excesso_qt || 0}
                excessoValor={resumo?.valor_excesso_qt || 0}
                orcamento={resumo?.valor_consumo_30d || 0}
              />
            </div>
          </section>

          <section className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-gray-600">
                Buscar
                <div className="mt-1 flex items-center gap-2 rounded border border-gray-300 bg-white px-2 py-1.5">
                  <Search size={14} className="text-gray-400" />
                  <input
                    value={buscar}
                    onChange={(e) => setBuscar(e.target.value)}
                    className="outline-none text-sm w-56"
                    placeholder="MP, descricao ou artigo"
                  />
                </div>
              </label>

              <label className="text-xs text-gray-600">
                Artigo
                <select value={artigo} onChange={(e) => setArtigo(e.target.value)} className="mt-1 block border border-gray-300 rounded px-2 py-1.5 text-sm min-w-44">
                  <option value="">Todos</option>
                  {artigos.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>

              <label className="text-xs text-gray-600">
                Dias consumo
                <input value={diasConsumo} min={1} max={365} type="number" onChange={(e) => setDiasConsumo(Number(e.target.value || 30))} className="mt-1 block border border-gray-300 rounded px-2 py-1.5 text-sm w-24 text-right" />
              </label>

              <label className="text-xs text-gray-600">
                Cobertura minima
                <input value={diasCobertura} min={0} max={365} type="number" onChange={(e) => setDiasCobertura(Number(e.target.value || 5))} className="mt-1 block border border-gray-300 rounded px-2 py-1.5 text-sm w-24 text-right" />
              </label>

              <label className="inline-flex items-center gap-2 text-xs text-gray-700 pb-2">
                <input type="checkbox" checked={somenteExcesso} onChange={(e) => setSomenteExcesso(e.target.checked)} />
                Somente excesso
              </label>

              <button onClick={carregar} disabled={loading || loadingPrices} className="inline-flex items-center gap-2 px-3 py-2 rounded bg-brand-primary text-white text-xs font-semibold disabled:opacity-60">
                <RefreshCw size={14} />
                {loading ? 'Carregando...' : loadingPrices ? 'Buscando valores...' : 'Atualizar'}
              </button>
              <button onClick={exportarCsv} disabled={!rows.length} className="inline-flex items-center gap-2 px-3 py-2 rounded border border-gray-300 bg-white text-gray-700 text-xs font-semibold disabled:opacity-60">
                <Download size={14} />
                CSV
              </button>
            </div>
          </section>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}

          <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-200 text-sm font-semibold text-brand-dark">
              Resumo por artigo
            </div>
            <div className="overflow-auto max-h-[34vh]">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-gray-100 z-10 border-b border-gray-200">
                  <tr>
                    <Th>Artigo</Th>
                    <SortTh onClick={() => undefined}>Itens</SortTh>
                    <SortTh onClick={() => undefined}>Estoque</SortTh>
                    <SortTh onClick={() => undefined}>Saldo QT</SortTh>
                    <SortTh onClick={() => undefined}>Excesso MA</SortTh>
                    <SortTh onClick={() => undefined}>Valor MA</SortTh>
                    <SortTh onClick={() => undefined}>Excesso PX</SortTh>
                    <SortTh onClick={() => undefined}>Valor PX</SortTh>
                    <SortTh onClick={() => undefined}>Excesso UL</SortTh>
                    <SortTh onClick={() => undefined}>Valor UL</SortTh>
                    <SortTh onClick={() => undefined}>Excesso QT</SortTh>
                    <SortTh onClick={() => undefined}>Valor QT</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {porArtigo.map((row, idx) => (
                    <tr key={row.artigo} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-b border-gray-100`}>
                      <td className="px-2.5 py-2 font-semibold whitespace-nowrap">{row.artigo || '-'}</td>
                      <Num>{row.itens}</Num>
                      <Num>{row.estoque}</Num>
                      <Num>{row.saldo_qt}</Num>
                      <Num tone="amber">{row.excesso_ma}</Num>
                      <MoneyCell tone="amber">{row.valor_excesso_ma}</MoneyCell>
                      <Num tone="amber">{row.excesso_px}</Num>
                      <MoneyCell tone="amber">{row.valor_excesso_px}</MoneyCell>
                      <Num tone="amber">{row.excesso_ul}</Num>
                      <MoneyCell tone="amber">{row.valor_excesso_ul}</MoneyCell>
                      <Num tone="emerald">{row.excesso_qt}</Num>
                      <MoneyCell tone="emerald">{row.valor_excesso_qt}</MoneyCell>
                    </tr>
                  ))}
                  {!porArtigo.length && (
                    <tr><td colSpan={12} className="px-3 py-8 text-center text-gray-500">{loading ? 'Carregando...' : 'Sem resumo por artigo.'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-auto max-h-[72vh]">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-gray-100 z-10 border-b border-gray-200">
                  <tr>
                    <Th>MP</Th>
                    <Th>Descricao</Th>
                    <Th>Artigo</Th>
                    <SortTh onClick={() => toggleSort('estoquetotal')}>Estoque</SortTh>
                    <SortTh onClick={() => toggleSort('consumo_ultimos_dias')}>Cons. {diasConsumo}d</SortTh>
                    <SortTh onClick={() => toggleSort('estoque_cinco_dias')}>Est. {diasCobertura}d</SortTh>
                    <SortTh onClick={() => toggleSort('skus_em_linha')}>SKUs linha</SortTh>
                    <SortTh onClick={() => toggleSort('consumo_op')}>OP aberta</SortTh>
                    <SortTh onClick={() => toggleSort('consumo_ma')}>Cons. MA</SortTh>
                    <SortTh onClick={() => toggleSort('saldo_ma')}>Saldo MA</SortTh>
                    <SortTh onClick={() => toggleSort('excesso_ma')}>Excesso MA</SortTh>
                    <SortTh onClick={() => toggleSort('consumo_px')}>Cons. PX</SortTh>
                    <SortTh onClick={() => toggleSort('saldo_px')}>Saldo PX</SortTh>
                    <SortTh onClick={() => toggleSort('excesso_px')}>Excesso PX</SortTh>
                    <SortTh onClick={() => toggleSort('consumo_ul')}>Cons. UL</SortTh>
                    <SortTh onClick={() => toggleSort('saldo_ul')}>Saldo UL</SortTh>
                    <SortTh onClick={() => toggleSort('excesso_ul')}>Excesso UL</SortTh>
                    <SortTh onClick={() => toggleSort('consumo_qt')}>Cons. QT</SortTh>
                    <SortTh onClick={() => toggleSort('saldo_qt')}>Saldo QT</SortTh>
                    <SortTh onClick={() => toggleSort('excesso_qt')}>Excesso QT</SortTh>
                    <SortTh onClick={() => toggleSort('custo_unitario')}>Valor unit.</SortTh>
                    <SortTh onClick={() => toggleSort('valor_excesso_qt')}>Valor QT</SortTh>
                    <SortTh onClick={() => toggleSort('consumo_indireto')}>Indireto</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, idx) => (
                    <tr key={row.idmateriaprima} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-b border-gray-100 hover:bg-amber-50/50`}>
                      <td className="px-2.5 py-2 font-mono font-semibold text-gray-800">{row.idmateriaprima}</td>
                      <td className="px-2.5 py-2 min-w-64 max-w-96 truncate" title={row.descricao}>{row.descricao || '-'}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap">{row.artigo || '-'}</td>
                      <Num>{row.estoquetotal}</Num>
                      <Num>{row.consumo_ultimos_dias}</Num>
                      <Num>{row.estoque_cinco_dias}</Num>
                      <Num>{row.skus_em_linha}</Num>
                      <Num>{row.consumo_op}</Num>
                      <Num>{row.consumo_ma}</Num>
                      <Num tone={row.saldo_ma < 0 ? 'red' : undefined}>{row.saldo_ma}</Num>
                      <Num tone="amber">{row.excesso_ma}</Num>
                      <Num>{row.consumo_px}</Num>
                      <Num tone={row.saldo_px < 0 ? 'red' : undefined}>{row.saldo_px}</Num>
                      <Num tone="amber">{row.excesso_px}</Num>
                      <Num>{row.consumo_ul}</Num>
                      <Num tone={row.saldo_ul < 0 ? 'red' : undefined}>{row.saldo_ul}</Num>
                      <Num tone="amber">{row.excesso_ul}</Num>
                      <Num>{row.consumo_qt}</Num>
                      <Num tone={row.saldo_qt < 0 ? 'red' : undefined}>{row.saldo_qt}</Num>
                      <Num tone="emerald">{row.excesso_qt}</Num>
                      <MoneyCell>{row.custo_unitario}</MoneyCell>
                      <MoneyCell tone="emerald">{row.valor_excesso_qt}</MoneyCell>
                      <Num>{row.consumo_indireto}</Num>
                    </tr>
                  ))}
                  {!sortedRows.length && (
                    <tr><td colSpan={23} className="px-3 py-10 text-center text-gray-500">{loading ? 'Carregando...' : 'Nenhum excesso encontrado.'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone?: 'amber' | 'emerald' }) {
  const color = tone === 'amber' ? 'text-amber-700' : tone === 'emerald' ? 'text-emerald-700' : 'text-brand-dark';
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function PeriodoCard({ periodo, excessoQtd, excessoValor, orcamento }: { periodo: string; excessoQtd: number; excessoValor: number; orcamento: number }) {
  const pctOrcamento = orcamento > 0 ? (excessoValor / orcamento) * 100 : 0;
  const dentroOrcamento = pctOrcamento <= 100;
  const corFundo = dentroOrcamento ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200';
  const corTexto = dentroOrcamento ? 'text-emerald-700' : 'text-red-700';
  const corBarra = dentroOrcamento ? 'bg-emerald-500' : 'bg-red-500';

  return (
    <div className={`rounded-lg border p-4 ${corFundo}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold text-gray-800">Ate {periodo}</span>
        <span className={`text-xs font-semibold ${corTexto}`}>
          {pctOrcamento.toFixed(0)}% do orcamento
        </span>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-gray-600">Excesso (qtd)</span>
          <span className="font-semibold text-gray-800">{fmt(excessoQtd)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-600">Excesso (R$)</span>
          <span className={`font-bold ${corTexto}`}>{money(excessoValor)}</span>
        </div>
      </div>
      {/* Barra de progresso */}
      <div className="mt-3 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full ${corBarra} transition-all`}
          style={{ width: `${Math.min(100, pctOrcamento)}%` }}
        />
      </div>
      <div className="mt-1 text-[10px] text-gray-500 text-right">
        Orcamento: {money(orcamento)}
      </div>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-2.5 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">{children}</th>;
}

function SortTh({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <th className="px-2.5 py-2 text-right font-semibold text-gray-700 whitespace-nowrap">
      <button type="button" onClick={onClick} className="hover:underline underline-offset-2">{children}</button>
    </th>
  );
}

function Num({ children, tone }: { children: number; tone?: 'red' | 'amber' | 'emerald' }) {
  const color = tone === 'red' ? 'text-red-700 font-semibold' : tone === 'amber' ? 'text-amber-700 font-semibold' : tone === 'emerald' ? 'text-emerald-700 font-bold' : '';
  return <td className={`px-2.5 py-2 text-right tabular-nums whitespace-nowrap ${color}`}>{fmt(children)}</td>;
}

function MoneyCell({ children, tone }: { children: number; tone?: 'amber' | 'emerald' }) {
  const color = tone === 'amber' ? 'text-amber-700 font-semibold' : tone === 'emerald' ? 'text-emerald-700 font-bold' : '';
  return <td className={`px-2.5 py-2 text-right tabular-nums whitespace-nowrap ${color}`}>{money(children)}</td>;
}
