'use client';

import { useEffect, useMemo, useState } from 'react';
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

const PERIODOS = ['MA', 'PX', 'UL', 'QT'] as const;

type Periodo = typeof PERIODOS[number];
type SortDir = 'asc' | 'desc';

type PedidoCompraDetalhe = {
  empresa?: number | string;
  pedido?: number | string;
  data?: string;
  quantidade?: number;
  valor?: number;
  periodo?: string;
};

type ExcessoMpRow = {
  idmateriaprima: string;
  descricao: string;
  artigo: string;
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
  entrada_ma: number;
  entrada_px: number;
  entrada_ul: number;
  entrada_qt: number;
  entrada_fora_horizonte?: number;
  saldo_ma: number;
  saldo_px: number;
  saldo_ul: number;
  saldo_qt: number;
  excesso_ma: number;
  excesso_px: number;
  excesso_ul: number;
  excesso_qt: number;
  custo_unitario?: number;
  compras_detalhe?: PedidoCompraDetalhe[];
};

type PriceOption = {
  id: string;
  value: number | null;
};

type ExcessoCalculado = ExcessoMpRow & {
  valorUnitario: number;
  consumoAte: number;
  comprasAte: number;
  saldoAte: number;
  estoqueSeguranca: number;
  excessoAte: number;
  coberturaDias: number | null;
  valorEstoque: number;
  valorConsumo: number;
  valorCompras: number;
  valorSaldo: number;
  valorExcesso: number;
};

type ArtigoRow = {
  artigo: string;
  itens: number;
  estoque: number;
  valorEstoque: number;
  consumo: number;
  valorConsumo: number;
  compras: number;
  valorCompras: number;
  saldo: number;
  valorSaldo: number;
  estoqueSeguranca: number;
  excesso: number;
  valorExcesso: number;
};

type MpSortKey =
  | 'idmateriaprima' | 'descricao' | 'artigo' | 'estoquetotal' | 'valorEstoque'
  | 'consumoAte' | 'valorConsumo' | 'comprasAte' | 'valorCompras'
  | 'saldoAte' | 'valorSaldo' | 'estoqueSeguranca' | 'excessoAte'
  | 'valorExcesso' | 'valorUnitario' | 'coberturaDias';

type ArtigoSortKey =
  | 'artigo' | 'itens' | 'estoque' | 'valorEstoque' | 'consumo'
  | 'valorConsumo' | 'compras' | 'valorCompras' | 'saldo'
  | 'valorSaldo' | 'estoqueSeguranca' | 'excesso' | 'valorExcesso';

function fmt(value: number | null | undefined, digits = 0) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function money(value: number | null | undefined) {
  return Number(value || 0).toLocaleString('pt-BR', {
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

function periodosAte(periodo: Periodo) {
  return PERIODOS.slice(0, PERIODOS.indexOf(periodo) + 1);
}

function valorPeriodo(row: ExcessoMpRow, prefixo: 'consumo' | 'entrada' | 'saldo' | 'excesso', periodo: Periodo) {
  const key = `${prefixo}_${periodo.toLowerCase()}` as keyof ExcessoMpRow;
  return Number(row[key] || 0);
}

function somaAte(row: ExcessoMpRow, prefixo: 'consumo' | 'entrada', periodo: Periodo) {
  return periodosAte(periodo).reduce((acc, p) => acc + valorPeriodo(row, prefixo, p), 0);
}

function compareValues(a: unknown, b: unknown, dir: SortDir) {
  const an = typeof a === 'number' ? a : Number(a);
  const bn = typeof b === 'number' ? b : Number(b);
  const bothNumbers = Number.isFinite(an) && Number.isFinite(bn);
  const result = bothNumbers
    ? an - bn
    : String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', { numeric: true, sensitivity: 'base' });
  return dir === 'asc' ? result : -result;
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
  const [artigosSelecionados, setArtigosSelecionados] = useState<string[]>([]);
  const [diasConsumo, setDiasConsumo] = useState(30);
  const [diasCobertura, setDiasCobertura] = useState(5);
  const [planoAte, setPlanoAte] = useState<Periodo>('QT');
  const [somenteExcesso, setSomenteExcesso] = useState(true);
  const [mpSort, setMpSort] = useState<{ key: MpSortKey; dir: SortDir }>({ key: 'valorExcesso', dir: 'desc' });
  const [artigoSort, setArtigoSort] = useState<{ key: ArtigoSortKey; dir: SortDir }>({ key: 'valorExcesso', dir: 'desc' });
  const [mpModal, setMpModal] = useState<ExcessoCalculado | null>(null);

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
        }, 800);
        return () => window.clearTimeout(timer);
      }
      return;
    }
    const timer = window.setInterval(() => {
      setProgress((prev) => {
        const max = loadingPrices ? 96 : 82;
        return Math.min(max, prev + Math.max(1, Math.round((max - prev) * 0.08)));
      });
    }, 500);
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
      setRows([]);
      setPriceOptionsByMp({});
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

  function valorUnitarioMp(row: ExcessoMpRow) {
    const productCode = String(row.idmateriaprima || '').trim();
    const precoTotvs = Number(priceOptionsByMp[productCode]?.[0]?.value || 0);
    return precoTotvs > 0 ? precoTotvs : Number(row.custo_unitario || 0);
  }

  const artigosDisponiveis = useMemo(() => {
    return Array.from(new Set(rows.map((row) => String(row.artigo || '-').trim() || '-')))
      .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  }, [rows]);

  const rowsCalculadas = useMemo<ExcessoCalculado[]>(() => {
    const q = buscar.trim().toUpperCase();
    const artigoSet = new Set(artigosSelecionados);

    return rows
      .map((row) => {
        const valorUnitario = valorUnitarioMp(row);
        const consumoAte = somaAte(row, 'consumo', planoAte);
        const comprasAte = somaAte(row, 'entrada', planoAte);
        const saldoPeriodo = valorPeriodo(row, 'saldo', planoAte);
        const estoqueSeguranca = Number(row.estoque_cinco_dias || 0);
        const excessoAte = Math.max(0, saldoPeriodo - estoqueSeguranca);
        const coberturaDias = Number(row.consumo_dia || 0) > 0 ? saldoPeriodo / Number(row.consumo_dia || 1) : null;
        return {
          ...row,
          valorUnitario,
          consumoAte,
          comprasAte,
          saldoAte: saldoPeriodo,
          estoqueSeguranca,
          excessoAte,
          coberturaDias,
          valorEstoque: Number(row.estoquetotal || 0) * valorUnitario,
          valorConsumo: consumoAte * valorUnitario,
          valorCompras: comprasAte * valorUnitario,
          valorSaldo: saldoPeriodo * valorUnitario,
          valorExcesso: excessoAte * valorUnitario,
        };
      })
      .filter((row) => {
        const artigo = String(row.artigo || '-').trim() || '-';
        if (artigoSet.size > 0 && !artigoSet.has(artigo)) return false;
        if (somenteExcesso && row.excessoAte <= 0) return false;
        if (!q) return true;
        return String(row.idmateriaprima || '').includes(q)
          || String(row.descricao || '').toUpperCase().includes(q)
          || artigo.toUpperCase().includes(q);
      });
  }, [rows, priceOptionsByMp, planoAte, buscar, artigosSelecionados, somenteExcesso]);

  const rowsOrdenadas = useMemo(() => {
    return [...rowsCalculadas].sort((a, b) => {
      const primary = compareValues(a[mpSort.key], b[mpSort.key], mpSort.dir);
      return primary || String(a.idmateriaprima || '').localeCompare(String(b.idmateriaprima || ''), 'pt-BR', { numeric: true });
    });
  }, [rowsCalculadas, mpSort]);

  const porArtigo = useMemo<ArtigoRow[]>(() => {
    const map = new Map<string, ArtigoRow>();
    for (const row of rowsCalculadas) {
      const artigo = String(row.artigo || '-').trim() || '-';
      if (!map.has(artigo)) {
        map.set(artigo, {
          artigo,
          itens: 0,
          estoque: 0,
          valorEstoque: 0,
          consumo: 0,
          valorConsumo: 0,
          compras: 0,
          valorCompras: 0,
          saldo: 0,
          valorSaldo: 0,
          estoqueSeguranca: 0,
          excesso: 0,
          valorExcesso: 0,
        });
      }
      const acc = map.get(artigo)!;
      acc.itens += 1;
      acc.estoque += Number(row.estoquetotal || 0);
      acc.valorEstoque += row.valorEstoque;
      acc.consumo += row.consumoAte;
      acc.valorConsumo += row.valorConsumo;
      acc.compras += row.comprasAte;
      acc.valorCompras += row.valorCompras;
      acc.saldo += row.saldoAte;
      acc.valorSaldo += row.valorSaldo;
      acc.estoqueSeguranca += row.estoqueSeguranca;
      acc.excesso += row.excessoAte;
      acc.valorExcesso += row.valorExcesso;
    }
    return Array.from(map.values());
  }, [rowsCalculadas]);

  const porArtigoOrdenado = useMemo(() => {
    return [...porArtigo].sort((a, b) => {
      const primary = compareValues(a[artigoSort.key], b[artigoSort.key], artigoSort.dir);
      return primary || a.artigo.localeCompare(b.artigo, 'pt-BR', { numeric: true });
    });
  }, [porArtigo, artigoSort]);

  const totais = useMemo(() => {
    return rowsCalculadas.reduce((acc, row) => {
      acc.itens += 1;
      acc.estoque += Number(row.estoquetotal || 0);
      acc.valorEstoque += row.valorEstoque;
      acc.consumo += row.consumoAte;
      acc.valorConsumo += row.valorConsumo;
      acc.compras += row.comprasAte;
      acc.valorCompras += row.valorCompras;
      acc.saldo += row.saldoAte;
      acc.valorSaldo += row.valorSaldo;
      acc.estoqueSeguranca += row.estoqueSeguranca;
      acc.excesso += row.excessoAte;
      acc.valorExcesso += row.valorExcesso;
      return acc;
    }, {
      itens: 0,
      estoque: 0,
      valorEstoque: 0,
      consumo: 0,
      valorConsumo: 0,
      compras: 0,
      valorCompras: 0,
      saldo: 0,
      valorSaldo: 0,
      estoqueSeguranca: 0,
      excesso: 0,
      valorExcesso: 0,
    });
  }, [rowsCalculadas]);

  const periodosLabel = periodosAte(planoAte).join(' + ');
  const pedidosModal = useMemo(() => {
    if (!mpModal) return [];
    const permitidos = new Set(periodosAte(planoAte));
    return (Array.isArray(mpModal.compras_detalhe) ? mpModal.compras_detalhe : [])
      .filter((pedido) => permitidos.has(String(pedido.periodo || '').toUpperCase() as Periodo))
      .sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
  }, [mpModal, planoAte]);

  function toggleMpSort(key: MpSortKey) {
    setMpSort((prev) => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'desc' });
  }

  function toggleArtigoSort(key: ArtigoSortKey) {
    setArtigoSort((prev) => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'desc' });
  }

  function toggleArtigo(artigo: string) {
    setArtigosSelecionados((prev) => (
      prev.includes(artigo) ? prev.filter((item) => item !== artigo) : [...prev, artigo]
    ));
  }

  function exportarCsv() {
    const header = [
      'mp', 'descricao', 'artigo', 'horizonte', 'estoque', 'valor_estoque',
      'consumo_plano', 'valor_consumo', 'compras_ate', 'valor_compras',
      'saldo', 'valor_saldo', 'estoque_seguranca', 'excesso', 'valor_excesso', 'valor_unitario',
    ];
    const body = rowsOrdenadas.map((row) => [
      row.idmateriaprima, row.descricao, row.artigo, periodosLabel, row.estoquetotal, row.valorEstoque,
      row.consumoAte, row.valorConsumo, row.comprasAte, row.valorCompras,
      row.saldoAte, row.valorSaldo, row.estoqueSeguranca, row.excessoAte, row.valorExcesso, row.valorUnitario,
    ]);
    const csv = [header, ...body].map((line) => line.map(csvEscape).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `excesso_mp_${planoAte}_${new Date().toISOString().slice(0, 10)}.csv`;
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
              <div className="h-full bg-brand-primary transition-all duration-500" style={{ width: `${Math.max(4, Math.min(100, progress))}%` }} />
            </div>
            <div className={`${ml} transition-all duration-300 px-6 py-1.5 text-xs text-gray-700 flex items-center justify-between`}>
              <span>{loadingStage || 'Carregando...'}</span>
              <span className="tabular-nums font-semibold">{Math.round(Math.min(100, progress))}%</span>
            </div>
          </div>
        )}

        <header className="bg-brand-primary shadow-sm px-6 py-3">
          <h1 className="text-white font-bold font-secondary tracking-wide text-base">EXCESSO MP</h1>
          <p className="text-white/75 text-xs">
            Excesso calculado pelo horizonte selecionado: estoque + compras ate o periodo - consumo do plano - estoque de seguranca.
          </p>
        </header>

        <main className="flex-1 min-w-0 px-6 py-5 space-y-4">
          <section className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="text-xs text-gray-600">
                Planos considerados
                <div className="mt-1 inline-flex rounded border border-gray-300 overflow-hidden bg-white">
                  {PERIODOS.map((periodo) => (
                    <button
                      key={periodo}
                      type="button"
                      onClick={() => setPlanoAte(periodo)}
                      className={`px-3 py-1.5 text-xs font-semibold border-r border-gray-200 last:border-r-0 ${planoAte === periodo ? 'bg-brand-primary text-white' : 'text-gray-700 hover:bg-gray-50'}`}
                    >
                      Ate {periodo}
                    </button>
                  ))}
                </div>
              </div>

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
              <button onClick={exportarCsv} disabled={!rowsOrdenadas.length} className="inline-flex items-center gap-2 px-3 py-2 rounded border border-gray-300 bg-white text-gray-700 text-xs font-semibold disabled:opacity-60">
                <Download size={14} />
                CSV
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {artigosDisponiveis.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => toggleArtigo(item)}
                  className={`rounded border px-2.5 py-1 text-[11px] font-semibold ${artigosSelecionados.includes(item) ? 'border-brand-primary bg-brand-primary text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  {item}
                </button>
              ))}
              {artigosSelecionados.length > 0 && (
                <button type="button" onClick={() => setArtigosSelecionados([])} className="rounded border border-gray-300 px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
                  Limpar artigos
                </button>
              )}
            </div>
          </section>

          <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
            <Card label={`Excesso ate ${planoAte}`} value={money(totais.valorExcesso)} detail={`${fmt(totais.excesso)} qtd`} tone="orange" />
            <Card label="Estoque em casa" value={money(totais.valorEstoque)} detail={`${fmt(totais.estoque)} qtd`} tone="slate" />
            <Card label="Consumo plano" value={money(totais.valorConsumo)} detail={`${fmt(totais.consumo)} qtd | ${periodosLabel}`} tone="red" />
            <Card label="Compras no prazo" value={money(totais.valorCompras)} detail={`${fmt(totais.compras)} qtd`} tone="emerald" />
            <Card label="Saldo horizonte" value={money(totais.valorSaldo)} detail={`${fmt(totais.saldo)} qtd`} tone="sky" />
            <Card label="Estoque seguranca" value={fmt(totais.estoqueSeguranca)} detail={`${diasCobertura} dias de cobertura`} tone="stone" />
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}

          <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-brand-dark">Resumo por artigo</span>
              <span className="text-[11px] text-gray-500">{porArtigoOrdenado.length} artigos</span>
            </div>
            <div className="max-h-[34vh] overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 z-10 bg-gray-100">
                  <tr>
                    <SortTh active={artigoSort.key === 'artigo'} dir={artigoSort.dir} onClick={() => toggleArtigoSort('artigo')}>Artigo</SortTh>
                    <SortTh align="right" active={artigoSort.key === 'itens'} dir={artigoSort.dir} onClick={() => toggleArtigoSort('itens')}>MPs</SortTh>
                    <SortTh align="right" active={artigoSort.key === 'estoque'} dir={artigoSort.dir} onClick={() => toggleArtigoSort('estoque')}>Estoque</SortTh>
                    <SortTh align="right" active={artigoSort.key === 'valorEstoque'} dir={artigoSort.dir} onClick={() => toggleArtigoSort('valorEstoque')}>R$ estoque</SortTh>
                    <SortTh align="right" active={artigoSort.key === 'consumo'} dir={artigoSort.dir} onClick={() => toggleArtigoSort('consumo')}>Consumo plano</SortTh>
                    <SortTh align="right" active={artigoSort.key === 'valorConsumo'} dir={artigoSort.dir} onClick={() => toggleArtigoSort('valorConsumo')}>R$ consumo</SortTh>
                    <SortTh align="right" active={artigoSort.key === 'compras'} dir={artigoSort.dir} onClick={() => toggleArtigoSort('compras')}>Compras</SortTh>
                    <SortTh align="right" active={artigoSort.key === 'saldo'} dir={artigoSort.dir} onClick={() => toggleArtigoSort('saldo')}>Saldo</SortTh>
                    <SortTh align="right" active={artigoSort.key === 'estoqueSeguranca'} dir={artigoSort.dir} onClick={() => toggleArtigoSort('estoqueSeguranca')}>Est. seg.</SortTh>
                    <SortTh align="right" active={artigoSort.key === 'excesso'} dir={artigoSort.dir} onClick={() => toggleArtigoSort('excesso')}>Excesso</SortTh>
                    <SortTh align="right" active={artigoSort.key === 'valorExcesso'} dir={artigoSort.dir} onClick={() => toggleArtigoSort('valorExcesso')}>R$ excesso</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {porArtigoOrdenado.map((row, idx) => (
                    <tr key={row.artigo} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
                      <Td strong>{row.artigo}</Td>
                      <Td align="right">{fmt(row.itens)}</Td>
                      <Td align="right">{fmt(row.estoque)}</Td>
                      <Td align="right" strong>{money(row.valorEstoque)}</Td>
                      <Td align="right">{fmt(row.consumo)}</Td>
                      <Td align="right" strong>{money(row.valorConsumo)}</Td>
                      <Td align="right" tone="emerald">{fmt(row.compras)}</Td>
                      <Td align="right" tone={row.saldo < 0 ? 'red' : 'sky'}>{fmt(row.saldo)}</Td>
                      <Td align="right">{fmt(row.estoqueSeguranca)}</Td>
                      <Td align="right" tone={row.excesso > 0 ? 'orange' : undefined}>{fmt(row.excesso)}</Td>
                      <Td align="right" tone={row.valorExcesso > 0 ? 'orange' : undefined} strong>{money(row.valorExcesso)}</Td>
                    </tr>
                  ))}
                  {porArtigoOrdenado.length === 0 && <tr><td colSpan={11} className="px-3 py-8 text-center text-gray-500">Sem dados para exibir.</td></tr>}
                </tbody>
                {porArtigoOrdenado.length > 0 && (
                  <tfoot className="sticky bottom-0 z-10 bg-gray-200 font-semibold text-gray-900">
                    <tr>
                      <Td strong>TOTAL</Td>
                      <Td align="right" strong>{fmt(totais.itens)}</Td>
                      <Td align="right" strong>{fmt(totais.estoque)}</Td>
                      <Td align="right" strong>{money(totais.valorEstoque)}</Td>
                      <Td align="right" strong>{fmt(totais.consumo)}</Td>
                      <Td align="right" strong>{money(totais.valorConsumo)}</Td>
                      <Td align="right" tone="emerald" strong>{fmt(totais.compras)}</Td>
                      <Td align="right" tone={totais.saldo < 0 ? 'red' : 'sky'} strong>{fmt(totais.saldo)}</Td>
                      <Td align="right" strong>{fmt(totais.estoqueSeguranca)}</Td>
                      <Td align="right" tone={totais.excesso > 0 ? 'orange' : undefined} strong>{fmt(totais.excesso)}</Td>
                      <Td align="right" tone={totais.valorExcesso > 0 ? 'orange' : undefined} strong>{money(totais.valorExcesso)}</Td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-brand-dark">Detalhe por MP</span>
              <span className="text-[11px] text-gray-500">{rowsOrdenadas.length} MPs</span>
            </div>
            <div className="max-h-[56vh] overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 z-10 bg-gray-100">
                  <tr>
                    <SortTh active={mpSort.key === 'idmateriaprima'} dir={mpSort.dir} onClick={() => toggleMpSort('idmateriaprima')}>MP</SortTh>
                    <SortTh active={mpSort.key === 'descricao'} dir={mpSort.dir} onClick={() => toggleMpSort('descricao')}>Descricao</SortTh>
                    <SortTh active={mpSort.key === 'artigo'} dir={mpSort.dir} onClick={() => toggleMpSort('artigo')}>Artigo</SortTh>
                    <SortTh align="right" active={mpSort.key === 'estoquetotal'} dir={mpSort.dir} onClick={() => toggleMpSort('estoquetotal')}>Estoque</SortTh>
                    <SortTh align="right" active={mpSort.key === 'valorEstoque'} dir={mpSort.dir} onClick={() => toggleMpSort('valorEstoque')}>R$ estoque</SortTh>
                    <SortTh align="right" active={mpSort.key === 'consumoAte'} dir={mpSort.dir} onClick={() => toggleMpSort('consumoAte')}>Consumo plano</SortTh>
                    <SortTh align="right" active={mpSort.key === 'valorConsumo'} dir={mpSort.dir} onClick={() => toggleMpSort('valorConsumo')}>R$ consumo</SortTh>
                    <SortTh align="right" active={mpSort.key === 'comprasAte'} dir={mpSort.dir} onClick={() => toggleMpSort('comprasAte')}>Compras</SortTh>
                    <SortTh align="right" active={mpSort.key === 'saldoAte'} dir={mpSort.dir} onClick={() => toggleMpSort('saldoAte')}>Saldo</SortTh>
                    <SortTh align="right" active={mpSort.key === 'estoqueSeguranca'} dir={mpSort.dir} onClick={() => toggleMpSort('estoqueSeguranca')}>Est. seg.</SortTh>
                    <SortTh align="right" active={mpSort.key === 'excessoAte'} dir={mpSort.dir} onClick={() => toggleMpSort('excessoAte')}>Excesso</SortTh>
                    <SortTh align="right" active={mpSort.key === 'valorExcesso'} dir={mpSort.dir} onClick={() => toggleMpSort('valorExcesso')}>R$ excesso</SortTh>
                    <SortTh align="right" active={mpSort.key === 'valorUnitario'} dir={mpSort.dir} onClick={() => toggleMpSort('valorUnitario')}>V. unit.</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {rowsOrdenadas.map((row, idx) => (
                    <tr key={`${row.idmateriaprima}-${idx}`} onClick={() => setMpModal(row)} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200 cursor-pointer hover:bg-amber-50`}>
                      <Td strong>{row.idmateriaprima}</Td>
                      <Td>{row.descricao || '-'}</Td>
                      <Td>{row.artigo || '-'}</Td>
                      <Td align="right">{fmt(row.estoquetotal)}</Td>
                      <Td align="right" strong>{money(row.valorEstoque)}</Td>
                      <Td align="right">{fmt(row.consumoAte)}</Td>
                      <Td align="right" strong>{money(row.valorConsumo)}</Td>
                      <Td align="right" tone="emerald">{fmt(row.comprasAte)}</Td>
                      <Td align="right" tone={row.saldoAte < 0 ? 'red' : 'sky'}>{fmt(row.saldoAte)}</Td>
                      <Td align="right">{fmt(row.estoqueSeguranca)}</Td>
                      <Td align="right" tone={row.excessoAte > 0 ? 'orange' : undefined}>{fmt(row.excessoAte)}</Td>
                      <Td align="right" tone={row.valorExcesso > 0 ? 'orange' : undefined} strong>{money(row.valorExcesso)}</Td>
                      <Td align="right" strong>{row.valorUnitario > 0 ? money(row.valorUnitario) : '-'}</Td>
                    </tr>
                  ))}
                  {rowsOrdenadas.length === 0 && <tr><td colSpan={13} className="px-3 py-8 text-center text-gray-500">Sem dados para exibir.</td></tr>}
                </tbody>
                {rowsOrdenadas.length > 0 && (
                  <tfoot className="sticky bottom-0 z-10 bg-gray-200 font-semibold text-gray-900">
                    <tr>
                      <Td strong>TOTAL</Td>
                      <Td />
                      <Td />
                      <Td align="right" strong>{fmt(totais.estoque)}</Td>
                      <Td align="right" strong>{money(totais.valorEstoque)}</Td>
                      <Td align="right" strong>{fmt(totais.consumo)}</Td>
                      <Td align="right" strong>{money(totais.valorConsumo)}</Td>
                      <Td align="right" tone="emerald" strong>{fmt(totais.compras)}</Td>
                      <Td align="right" tone={totais.saldo < 0 ? 'red' : 'sky'} strong>{fmt(totais.saldo)}</Td>
                      <Td align="right" strong>{fmt(totais.estoqueSeguranca)}</Td>
                      <Td align="right" tone={totais.excesso > 0 ? 'orange' : undefined} strong>{fmt(totais.excesso)}</Td>
                      <Td align="right" tone={totais.valorExcesso > 0 ? 'orange' : undefined} strong>{money(totais.valorExcesso)}</Td>
                      <Td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          {mpModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
              <div className="w-full max-w-5xl max-h-[88vh] overflow-hidden rounded-lg bg-white shadow-xl border border-gray-200">
                <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
                  <div>
                    <div className="text-sm font-bold text-brand-dark">Extrato do excesso</div>
                    <div className="mt-1 text-xs text-gray-500">
                      MP {mpModal.idmateriaprima} | {mpModal.descricao || '-'} | {mpModal.artigo || '-'} | ate {planoAte}
                    </div>
                  </div>
                  <button type="button" onClick={() => setMpModal(null)} className="rounded border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                    Fechar
                  </button>
                </div>

                <div className="overflow-auto p-5 space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <InfoCard label="Estoque em casa" value={fmt(mpModal.estoquetotal)} detail={money(mpModal.valorEstoque)} />
                    <InfoCard label="Compras no prazo" value={fmt(mpModal.comprasAte)} detail={money(mpModal.valorCompras)} />
                    <InfoCard label="Consumo plano" value={fmt(mpModal.consumoAte)} detail={money(mpModal.valorConsumo)} />
                    <InfoCard label="Estoque seguranca" value={fmt(mpModal.estoqueSeguranca)} detail={`${diasCobertura} dias`} />
                    <InfoCard label="Excesso" value={fmt(mpModal.excessoAte)} detail={money(mpModal.valorExcesso)} tone="orange" />
                  </div>

                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 text-xs font-semibold text-brand-dark">
                      Conta: estoque + compras ate {planoAte} - consumo do plano - estoque de seguranca = excesso
                    </div>
                    <table className="min-w-full text-xs">
                      <tbody>
                        <tr className="border-t border-gray-100">
                          <td className="px-3 py-2 font-semibold text-gray-700">Estoque em casa</td>
                          <td className="px-3 py-2 text-right">{fmt(mpModal.estoquetotal)}</td>
                          <td className="px-3 py-2 text-right font-semibold">{money(mpModal.valorEstoque)}</td>
                        </tr>
                        <tr className="border-t border-gray-100">
                          <td className="px-3 py-2 font-semibold text-gray-700">(+) Compras no prazo ({periodosLabel})</td>
                          <td className="px-3 py-2 text-right">{fmt(mpModal.comprasAte)}</td>
                          <td className="px-3 py-2 text-right font-semibold">{money(mpModal.valorCompras)}</td>
                        </tr>
                        <tr className="border-t border-gray-100">
                          <td className="px-3 py-2 font-semibold text-gray-700">(-) Consumo do plano ({periodosLabel})</td>
                          <td className="px-3 py-2 text-right">{fmt(mpModal.consumoAte)}</td>
                          <td className="px-3 py-2 text-right font-semibold">{money(mpModal.valorConsumo)}</td>
                        </tr>
                        <tr className="border-t border-gray-100">
                          <td className="px-3 py-2 font-semibold text-gray-700">(-) Estoque de seguranca</td>
                          <td className="px-3 py-2 text-right">{fmt(mpModal.estoqueSeguranca)}</td>
                          <td className="px-3 py-2 text-right font-semibold">{money(mpModal.estoqueSeguranca * mpModal.valorUnitario)}</td>
                        </tr>
                        <tr className="border-t border-gray-200 bg-orange-50">
                          <td className="px-3 py-2 font-bold text-orange-800">Excesso</td>
                          <td className="px-3 py-2 text-right font-bold text-orange-800">{fmt(mpModal.excessoAte)}</td>
                          <td className="px-3 py-2 text-right font-bold text-orange-800">{money(mpModal.valorExcesso)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                      <span className="text-xs font-semibold text-brand-dark">Pedidos considerados ate {planoAte}</span>
                      <span className="text-[11px] text-gray-500">{pedidosModal.length} linhas</span>
                    </div>
                    <table className="min-w-full text-xs">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-3 py-2 text-left">Pedido</th>
                          <th className="px-3 py-2 text-left">Empresa</th>
                          <th className="px-3 py-2 text-left">Data prevista</th>
                          <th className="px-3 py-2 text-left">Periodo</th>
                          <th className="px-3 py-2 text-right">Quantidade</th>
                          <th className="px-3 py-2 text-right">Valor estimado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pedidosModal.map((pedido, idx) => {
                          const qtd = Number(pedido.quantidade || 0);
                          return (
                            <tr key={`${pedido.pedido || 'pedido'}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} border-t border-gray-100`}>
                              <td className="px-3 py-2 font-semibold text-gray-700">{String(pedido.pedido || '-')}</td>
                              <td className="px-3 py-2 text-gray-600">{String(pedido.empresa || '-')}</td>
                              <td className="px-3 py-2 text-gray-600">{String(pedido.data || '-').slice(0, 10)}</td>
                              <td className="px-3 py-2 text-gray-600">{String(pedido.periodo || '-')}</td>
                              <td className="px-3 py-2 text-right">{fmt(qtd)}</td>
                              <td className="px-3 py-2 text-right font-semibold">{money(qtd * mpModal.valorUnitario)}</td>
                            </tr>
                          );
                        })}
                        {pedidosModal.length === 0 && (
                          <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">Sem pedidos em andamento para esta MP no horizonte selecionado.</td></tr>
                        )}
                      </tbody>
                      {pedidosModal.length > 0 && (
                        <tfoot className="bg-gray-200 font-semibold">
                          <tr>
                            <td className="px-3 py-2" colSpan={4}>TOTAL</td>
                            <td className="px-3 py-2 text-right">{fmt(pedidosModal.reduce((acc, pedido) => acc + Number(pedido.quantidade || 0), 0))}</td>
                            <td className="px-3 py-2 text-right">{money(pedidosModal.reduce((acc, pedido) => acc + Number(pedido.quantidade || 0) * mpModal.valorUnitario, 0))}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Card({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'red' | 'orange' | 'sky' | 'emerald' | 'stone' | 'slate' }) {
  const cls = {
    red: 'text-red-700',
    orange: 'text-orange-700',
    sky: 'text-sky-700',
    emerald: 'text-emerald-700',
    stone: 'text-stone-800',
    slate: 'text-slate-700',
  }[tone];
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-bold ${cls}`}>{value}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{detail}</div>
    </div>
  );
}

function SortTh({ children, align = 'left', active, dir, onClick }: { children: React.ReactNode; align?: 'left' | 'right'; active: boolean; dir: SortDir; onClick: () => void }) {
  return (
    <th className={`px-2.5 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end' : 'justify-start'} w-full hover:underline underline-offset-2`}>
        <span>{children}</span>
        <span className="text-[10px] text-gray-500">{active ? (dir === 'asc' ? '^' : 'v') : '-'}</span>
      </button>
    </th>
  );
}

function InfoCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: 'orange' }) {
  return (
    <div className={`rounded border px-3 py-2 ${tone === 'orange' ? 'border-orange-200 bg-orange-50' : 'border-gray-200 bg-gray-50'}`}>
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${tone === 'orange' ? 'text-orange-700' : 'text-gray-900'}`}>{value}</div>
      <div className="text-[11px] text-gray-500">{detail}</div>
    </div>
  );
}

function Td({ children = null, align = 'left', tone, strong = false }: { children?: React.ReactNode; align?: 'left' | 'right'; tone?: 'red' | 'orange' | 'sky' | 'emerald'; strong?: boolean }) {
  const toneClass = tone === 'red'
    ? 'text-red-700'
    : tone === 'orange'
      ? 'text-orange-700'
      : tone === 'sky'
        ? 'text-sky-700'
        : tone === 'emerald'
          ? 'text-emerald-700'
          : 'text-gray-700';
  return <td className={`px-2.5 py-2 ${align === 'right' ? 'text-right' : 'text-left'} ${toneClass} ${strong ? 'font-semibold' : ''}`}>{children}</td>;
}
