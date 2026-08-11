'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { Planejamento } from '../types';
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

const MARCA_FIXA = 'LIEBE';
const STATUS_FIXO = 'EM LINHA,NOVA COLECAO';
const PERIODOS = ['MA', 'PX', 'UL', 'QT', 'QU'] as const;
const CACHE_VERSION = 2;

type Periodo = typeof PERIODOS[number];

type PedidoCompraDetalhe = {
  empresa?: number | string;
  pedido?: number | string;
  data?: string;
  quantidade?: number;
  valor?: number;
  periodo?: string;
};

type PriceOption = {
  id: string;
  value: number | null;
};

type MpRow = {
  idmateriaprima: string;
  nome_materiaprima?: string;
  cor?: string;
  artigo?: string;
  estoquetotal: number;
  entrada_ma?: number;
  entrada_px?: number;
  entrada_ul?: number;
  entrada_qt?: number;
  entrada_qu?: number;
  entrada_andamento?: number;
  entrada_fora_horizonte?: number;
  consumo_ma?: number;
  consumo_px?: number;
  consumo_ul?: number;
  consumo_qt?: number;
  consumo_qu?: number;
  saldo_ma?: number;
  saldo_px?: number;
  saldo_ul?: number;
  saldo_qt?: number;
  saldo_qu?: number;
  pedidos_detalhe?: PedidoCompraDetalhe[];
  finalizados_detalhe?: PedidoCompraDetalhe[];
  fator_conversao?: number;
  unidade_compra?: string;
  ds_conversao?: string;
};

type MpCalculada = MpRow & {
  valorUnitario: number;
  origemValor: string;
  valorEstoque: number;
  consumoAte: number;
  valorConsumo: number;
  comprasRegra: number;
  comprasTotal: number;
  valorComprasRegra: number;
  valorComprasTotal: number;
  necessidadeRegra: number;
  necessidadeTotal: number;
  valorNecessidadeRegra: number;
  valorNecessidadeTotal: number;
};

type OrcamentoCachePayload = {
  version: number;
  rowsBase: MpRow[];
  rowsOriginalBase: MpRow[];
  priceOptionsByMp: Record<string, PriceOption[]>;
  createdAt: string;
};

type SortDir = 'asc' | 'desc';
type ArtigoSortKey =
  | 'artigo' | 'itens' | 'estoque' | 'valorEstoque' | 'consumo' | 'valorConsumo'
  | 'comprasRegra' | 'valorComprasRegra' | 'comprasTotal' | 'valorComprasTotal'
  | 'necessidadeRegra' | 'valorRegra' | 'necessidadeTotal' | 'valorTotal';
type MpSortKey =
  | 'idmateriaprima' | 'nome_materiaprima' | 'cor' | 'artigo' | 'estoquetotal'
  | 'valorEstoque' | 'consumoAte' | 'valorUnitario' | 'valorConsumo'
  | 'comprasRegra' | 'valorComprasRegra' | 'comprasTotal' | 'valorComprasTotal'
  | 'necessidadeRegra' | 'valorNecessidadeRegra' | 'necessidadeTotal' | 'valorNecessidadeTotal';

type ArtigoRow = {
  artigo: string;
  itens: number;
  estoque: number;
  valorEstoque: number;
  consumo: number;
  valorConsumo: number;
  comprasRegra: number;
  comprasTotal: number;
  valorComprasRegra: number;
  valorComprasTotal: number;
  necessidadeRegra: number;
  necessidadeTotal: number;
  valorRegra: number;
  valorTotal: number;
  itensSemValor: number;
};

function fmt(v: number, d = 0) {
  return Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function money(v: number) {
  return Number(v || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function periodosAte(periodo: Periodo) {
  return PERIODOS.slice(0, PERIODOS.indexOf(periodo) + 1);
}

function valorPeriodo(row: MpRow, prefixo: 'consumo' | 'entrada', periodo: Periodo) {
  const key = `${prefixo}_${periodo.toLowerCase()}` as keyof MpRow;
  return Number(row[key] || 0);
}

function somaAte(row: MpRow, prefixo: 'consumo' | 'entrada', periodo: Periodo) {
  return periodosAte(periodo).reduce((acc, p) => acc + valorPeriodo(row, prefixo, p), 0);
}

function saldoAte(row: MpRow, periodo: Periodo) {
  const key = `saldo_${periodo.toLowerCase()}` as keyof MpRow;
  return Number(row[key] || 0);
}

function ultimaCompra(row: MpRow) {
  const compras = (Array.isArray(row.finalizados_detalhe) ? row.finalizados_detalhe : [])
    .filter((item) => Number(item.quantidade || 0) > 0 && Number(item.valor || 0) > 0)
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
  const item = compras[0];
  if (!item) return 0;
  return Number(item.valor || 0) / Number(item.quantidade || 1);
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

export default function OrcamentoMpPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rowsBase, setRowsBase] = useState<MpRow[]>([]);
  const [rowsOriginalBase, setRowsOriginalBase] = useState<MpRow[]>([]);
  const [priceOptionsByMp, setPriceOptionsByMp] = useState<Record<string, PriceOption[]>>({});
  const [cacheUpdatedAt, setCacheUpdatedAt] = useState<string | null>(null);
  const [cacheStatus, setCacheStatus] = useState<string | null>(null);
  const [planoAte, setPlanoAte] = useState<Periodo>('QU');
  const [artigosSelecionados, setArtigosSelecionados] = useState<string[]>([]);
  const [somenteComNecessidade, setSomenteComNecessidade] = useState(false);
  const [busca, setBusca] = useState('');
  const [artigoSort, setArtigoSort] = useState<{ key: ArtigoSortKey; dir: SortDir }>({ key: 'valorRegra', dir: 'desc' });
  const [mpSort, setMpSort] = useState<{ key: MpSortKey; dir: SortDir }>({ key: 'valorNecessidadeRegra', dir: 'desc' });
  const [mpModal, setMpModal] = useState<MpCalculada | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregar(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading && !loadingPrices) {
      if (progress > 0) {
        const timer = window.setTimeout(() => setProgress(0), 800);
        return () => window.clearTimeout(timer);
      }
      return;
    }
    const timer = window.setInterval(() => {
      setProgress((prev) => Math.min(96, prev + Math.max(1, Math.round((96 - prev) * 0.08))));
    }, 450);
    return () => window.clearInterval(timer);
  }, [loading, loadingPrices, progress]);

  async function carregar(forceRefresh = false) {
    setLoading(true);
    setProgress(8);
    setError(null);
    setCacheStatus(null);
    try {
      if (!forceRefresh) {
        const cacheHit = await carregarCachePersistido();
        if (cacheHit) {
          setProgress(100);
          setLoading(false);
          return;
        }
      }

      const params = new URLSearchParams({
        limit: '3000',
        marca: MARCA_FIXA,
        status: STATUS_FIXO,
        prefer_cache: 'true',
      });
      const rMatriz = await fetchNoCache(`${API_URL}/api/producao/matriz?${params}`, {}, 240000);
      const pMatriz = await rMatriz.json();
      if (!rMatriz.ok || !pMatriz?.success) throw new Error(pMatriz?.error || 'Erro ao carregar plano oficial');

      const matriz = (Array.isArray(pMatriz.data) ? pMatriz.data : []) as Planejamento[];
      const planoOriginalByProduto = await carregarPlanoOriginal(
        matriz.map((item) => String(item.produto.idproduto || '')).filter(Boolean)
      );
      const planos = matriz
        .map((i) => ({
          idproduto: String(i.produto.idproduto || ''),
          idreferencia: String(i.produto.cd_seqgrupo || ''),
          ma: Number(i.plano?.ma || 0),
          px: Number(i.plano?.px || 0),
          ul: Number(i.plano?.ul || 0),
          qt: Number(i.plano?.qt || 0),
          qu: Number(i.plano?.qu || 0),
        }))
        .filter((p) => p.idproduto && (p.ma + p.px + p.ul + p.qt + p.qu) > 0);
      const planosOriginais = matriz
        .map((i) => ({
          idproduto: String(i.produto.idproduto || ''),
          idreferencia: String(i.produto.cd_seqgrupo || ''),
          ma: Number((planoOriginalByProduto[String(i.produto.idproduto || '')] || i.plano_original || i.plano)?.ma || 0),
          px: Number((planoOriginalByProduto[String(i.produto.idproduto || '')] || i.plano_original || i.plano)?.px || 0),
          ul: Number((planoOriginalByProduto[String(i.produto.idproduto || '')] || i.plano_original || i.plano)?.ul || 0),
          qt: Number((planoOriginalByProduto[String(i.produto.idproduto || '')] || i.plano_original || i.plano)?.qt || 0),
          qu: Number((planoOriginalByProduto[String(i.produto.idproduto || '')] || i.plano_original || i.plano)?.qu || 0),
        }))
        .filter((p) => p.idproduto && (p.ma + p.px + p.ul + p.qt + p.qu) > 0);

      setProgress(48);
      const [rAnalise, rAnaliseOriginal] = await Promise.all([
        fetchNoCache(`${API_URL}/api/consumo-mp/analise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ planos, multinivel: true }),
        }, 600000),
        fetchNoCache(`${API_URL}/api/consumo-mp/analise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ planos: planosOriginais, multinivel: true }),
        }, 600000),
      ]);
      const pAnalise = await rAnalise.json();
      const pAnaliseOriginal = await rAnaliseOriginal.json();
      if (!rAnalise.ok || !pAnalise?.success) throw new Error(pAnalise?.error || 'Erro ao calcular consumo MP');
      if (!rAnaliseOriginal.ok || !pAnaliseOriginal?.success) throw new Error(pAnaliseOriginal?.error || 'Erro ao calcular consumo MP original');

      const mps = Array.isArray(pAnalise.data) ? pAnalise.data as MpRow[] : [];
      const mpsOriginais = Array.isArray(pAnaliseOriginal.data) ? pAnaliseOriginal.data as MpRow[] : [];
      setRowsBase(mps);
      setRowsOriginalBase(mpsOriginais);
      setProgress(78);
      const precos = await carregarPrecosMp([...mps, ...mpsOriginais]);
      await salvarCachePersistido({
        version: CACHE_VERSION,
        rowsBase: mps,
        rowsOriginalBase: mpsOriginais,
        priceOptionsByMp: precos,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      setRowsBase([]);
      setRowsOriginalBase([]);
      setPriceOptionsByMp({});
      setError(e instanceof Error ? e.message : 'Erro ao carregar orcamento MP');
    } finally {
      setLoading(false);
    }
  }

  async function carregarPrecosMp(rows: MpRow[]) {
    const productCodes = Array.from(new Set(rows.map((row) => String(row.idmateriaprima || '').trim()).filter(Boolean)));
    if (!productCodes.length) {
      setPriceOptionsByMp({});
      setProgress(100);
      return {};
    }
    setLoadingPrices(true);
    try {
      const response = await fetchNoCache(`${API_URL}/api/totvs-moda/prices/mp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ productCodes }),
      }, 180000);
      const payload = await response.json();
      const data = response.ok && payload?.success && payload.data ? payload.data as Record<string, PriceOption[]> : {};
      setPriceOptionsByMp(data);
      return data;
    } catch {
      setPriceOptionsByMp({});
      return {};
    } finally {
      setProgress(100);
      setLoadingPrices(false);
    }
  }

  async function carregarCachePersistido() {
    try {
      const response = await fetchNoCache(`${API_URL}/api/producao/orcamento-mp-cache`, {
        headers: authHeaders(),
      }, 30000);
      const payload = await response.json();
      const data = payload?.data as OrcamentoCachePayload | null;
      if (!response.ok || !payload?.success || !payload.exists || !data || data.version !== CACHE_VERSION) {
        return false;
      }
      if (!Array.isArray(data.rowsBase) || !Array.isArray(data.rowsOriginalBase)) return false;
      setRowsBase(data.rowsBase);
      setRowsOriginalBase(data.rowsOriginalBase);
      setPriceOptionsByMp(data.priceOptionsByMp || {});
      setCacheUpdatedAt(payload.updatedAt || data.createdAt || null);
      setCacheStatus('Cache carregado');
      return true;
    } catch {
      return false;
    }
  }

  async function salvarCachePersistido(payload: OrcamentoCachePayload) {
    try {
      const response = await fetchNoCache(`${API_URL}/api/producao/orcamento-mp-cache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ payload }),
      }, 120000);
      const result = await response.json();
      if (response.ok && result?.success) {
        setCacheUpdatedAt(result.updatedAt || payload.createdAt);
        setCacheStatus('Cache atualizado');
      }
    } catch {
      setCacheStatus('Nao foi possivel salvar o cache');
    }
  }

  async function carregarPlanoOriginal(productIds: string[]) {
    if (!productIds.length) return {} as Record<string, { ma: number; px: number; ul: number; qt: number; qu: number }>;
    try {
      const response = await fetchNoCache(`${API_URL}/api/producao/plano-original`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ productIds }),
      }, 120000);
      const payload = await response.json();
      if (!response.ok || !payload?.success || !payload.data) return {};
      return payload.data as Record<string, { ma: number; px: number; ul: number; qt: number; qu: number }>;
    } catch {
      return {};
    }
  }

  function valorUnitario(row: MpRow) {
    // Fator de conversão (ex: milheiro = 1000)
    const fatorConv = Number(row.fator_conversao || 1);
    const unidCompra = String(row.unidade_compra || 'UND');

    const ultima = ultimaCompra(row);
    if (ultima > 0) {
      // Se tiver fator de conversão, dividir o preço por ele
      const valorConvertido = fatorConv > 1 ? ultima / fatorConv : ultima;
      const origem = fatorConv > 1 ? `Ultima compra (${unidCompra}/${fatorConv})` : 'Ultima compra';
      return { valor: valorConvertido, origem };
    }
    const preco = Number(priceOptionsByMp[String(row.idmateriaprima || '').trim()]?.[0]?.value || 0);
    if (preco > 0) {
      const valorConvertido = fatorConv > 1 ? preco / fatorConv : preco;
      const origem = fatorConv > 1 ? `TOTVS (${unidCompra}/${fatorConv})` : 'Preco TOTVS';
      return { valor: valorConvertido, origem };
    }
    return { valor: 0, origem: 'Sem valor' };
  }

  const artigosDisponiveis = useMemo(() => {
    return Array.from(new Set(rowsBase.map((r) => String(r.artigo || '-').trim() || '-')))
      .sort((a, b) => a.localeCompare(b));
  }, [rowsBase]);

  const rowsCalculadas = useMemo<MpCalculada[]>(() => {
    const artigoSet = new Set(artigosSelecionados);
    const q = busca.trim().toUpperCase();

    return rowsBase
      .map((row) => {
        const preco = valorUnitario(row);
        const consumoAte = somaAte(row, 'consumo', planoAte);
        const comprasRegra = somaAte(row, 'entrada', planoAte);
        const comprasTotal = Number(row.entrada_andamento || 0);
        const necessidadeRegra = Math.max(0, -saldoAte(row, planoAte));
        const necessidadeTotal = Math.max(0, consumoAte - Number(row.estoquetotal || 0) - comprasTotal);
        return {
          ...row,
          valorUnitario: preco.valor,
          origemValor: preco.origem,
          valorEstoque: Number(row.estoquetotal || 0) * preco.valor,
          consumoAte,
          valorConsumo: consumoAte * preco.valor,
          comprasRegra,
          comprasTotal,
          valorComprasRegra: comprasRegra * preco.valor,
          valorComprasTotal: comprasTotal * preco.valor,
          necessidadeRegra,
          necessidadeTotal,
          valorNecessidadeRegra: necessidadeRegra * preco.valor,
          valorNecessidadeTotal: necessidadeTotal * preco.valor,
        };
      })
      .filter((row) => {
        const artigo = String(row.artigo || '-').trim() || '-';
        if (artigoSet.size > 0 && !artigoSet.has(artigo)) return false;
        if (somenteComNecessidade && row.necessidadeRegra <= 0 && row.necessidadeTotal <= 0) return false;
        if (!q) return true;
        return String(row.idmateriaprima || '').includes(q)
          || String(row.nome_materiaprima || '').toUpperCase().includes(q)
          || artigo.toUpperCase().includes(q);
      });
  }, [rowsBase, priceOptionsByMp, planoAte, artigosSelecionados, somenteComNecessidade, busca]);

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
          comprasRegra: 0,
          comprasTotal: 0,
          valorConsumo: 0,
          valorComprasRegra: 0,
          valorComprasTotal: 0,
          necessidadeRegra: 0,
          necessidadeTotal: 0,
          valorRegra: 0,
          valorTotal: 0,
          itensSemValor: 0,
        });
      }
      const acc = map.get(artigo)!;
      acc.itens += 1;
      acc.estoque += Number(row.estoquetotal || 0);
      acc.valorEstoque += row.valorEstoque;
      acc.consumo += row.consumoAte;
      acc.valorConsumo += row.valorConsumo;
      acc.comprasRegra += row.comprasRegra;
      acc.comprasTotal += row.comprasTotal;
      acc.valorComprasRegra += row.valorComprasRegra;
      acc.valorComprasTotal += row.valorComprasTotal;
      acc.necessidadeRegra += row.necessidadeRegra;
      acc.necessidadeTotal += row.necessidadeTotal;
      acc.valorRegra += row.valorNecessidadeRegra;
      acc.valorTotal += row.valorNecessidadeTotal;
      if ((row.necessidadeRegra > 0 || row.necessidadeTotal > 0) && row.valorUnitario <= 0) acc.itensSemValor += 1;
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
      acc.estoque += Number(row.estoquetotal || 0);
      acc.valorEstoque += row.valorEstoque;
      acc.consumo += row.consumoAte;
      acc.comprasRegra += row.comprasRegra;
      acc.comprasTotal += row.comprasTotal;
      acc.valorConsumo += row.valorConsumo;
      for (const periodo of PERIODOS) {
        const consumoPeriodo = valorPeriodo(row, 'consumo', periodo);
        acc.consumoPorPeriodo[periodo] += consumoPeriodo;
        acc.valorConsumoPorPeriodo[periodo] += consumoPeriodo * row.valorUnitario;
      }
      acc.valorComprasRegra += row.valorComprasRegra;
      acc.valorComprasTotal += row.valorComprasTotal;
      acc.necessidadeRegra += row.necessidadeRegra;
      acc.necessidadeTotal += row.necessidadeTotal;
      acc.valorRegra += row.valorNecessidadeRegra;
      acc.valorTotal += row.valorNecessidadeTotal;
      if ((row.necessidadeRegra > 0 || row.necessidadeTotal > 0) && row.valorUnitario <= 0) acc.itensSemValor += 1;
      return acc;
    }, {
      estoque: 0,
      valorEstoque: 0,
      consumo: 0,
      comprasRegra: 0,
      comprasTotal: 0,
      valorConsumo: 0,
      consumoPorPeriodo: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
      valorConsumoPorPeriodo: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
      valorComprasRegra: 0,
      valorComprasTotal: 0,
      necessidadeRegra: 0,
      necessidadeTotal: 0,
      valorRegra: 0,
      valorTotal: 0,
      itensSemValor: 0,
    });
  }, [rowsCalculadas]);

  const custoPlanoOriginal = useMemo(() => {
    return rowsOriginalBase.reduce((acc, row) => {
      const preco = valorUnitario(row).valor;
      for (const periodo of PERIODOS) {
        const consumoPeriodo = valorPeriodo(row, 'consumo', periodo);
        acc.consumoPorPeriodo[periodo] += consumoPeriodo;
        acc.valorConsumoPorPeriodo[periodo] += consumoPeriodo * preco;
      }
      return acc;
    }, {
      consumoPorPeriodo: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
      valorConsumoPorPeriodo: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
    });
  }, [rowsOriginalBase, priceOptionsByMp]);

  const valorConsumoOriginalAte = useMemo(() => {
    return periodosAte(planoAte).reduce((acc, periodo) => acc + custoPlanoOriginal.valorConsumoPorPeriodo[periodo], 0);
  }, [custoPlanoOriginal, planoAte]);

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';
  const periodosLabel = periodosAte(planoAte).join('+');
  const periodosSelecionados = periodosAte(planoAte);
  const pedidosModal = useMemo(() => {
    return [...(Array.isArray(mpModal?.pedidos_detalhe) ? mpModal.pedidos_detalhe : [])]
      .sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
  }, [mpModal]);

  function toggleArtigoSort(key: ArtigoSortKey) {
    setArtigoSort((prev) => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });
  }

  function toggleMpSort(key: MpSortKey) {
    setMpSort((prev) => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 min-w-0 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="bg-brand-primary shadow-sm px-6 py-3">
          <h1 className="text-white font-bold font-secondary tracking-wide text-base">ORCAMENTO MP</h1>
          <p className="text-white/70 text-xs">Necessidade em valor por regra de chegada e por compras totais ja feitas</p>
        </header>

        <main className="flex-1 min-w-0 px-6 py-5 space-y-4">
          {(loading || loadingPrices) && (
            <div className="bg-white rounded-lg border p-4">
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span>{loading ? 'Calculando consumo, estoque e compras...' : 'Buscando valores unitarios...'}</span>
                <span className="font-semibold">{fmt(progress)}%</span>
              </div>
              <div className="mt-2 h-2.5 bg-gray-100 rounded-full overflow-hidden border border-gray-200">
                <div className="h-full bg-brand-primary transition-[width] duration-200" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Card label="Custo plano original" value={money(valorConsumoOriginalAte)} detail={`Qt lote ${periodosLabel}`} tone="stone" />
            <Card label="Custo plano atual" value={money(totais.valorConsumo)} detail={`Restante ${periodosLabel}`} tone="slate" />
            <Card label="Estoque em casa" value={money(totais.valorEstoque)} detail={`Qtd ${fmt(totais.estoque)}`} tone="slate" />
            <Card label="Necessidade regra" value={money(totais.valorRegra)} detail={`Qtd ${fmt(totais.necessidadeRegra)}`} tone="red" />
            <Card label="Necessidade total" value={money(totais.valorTotal)} detail={`Qtd ${fmt(totais.necessidadeTotal)}`} tone="orange" />
            <Card label="Compras regra" value={money(totais.valorComprasRegra)} detail={`Qtd ${fmt(totais.comprasRegra)}`} tone="sky" />
            <Card label="Compras andamento" value={money(totais.valorComprasTotal)} detail={`Qtd ${fmt(totais.comprasTotal)} | ${totais.itensSemValor} MPs sem valor`} tone="emerald" />
          </div>

          <section className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-xs font-semibold text-brand-dark">Custo do plano por periodo</div>
              <div className="text-[11px] text-gray-500">Original filtrado: {money(valorConsumoOriginalAte)} | atual/restante: {money(totais.valorConsumo)}</div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {PERIODOS.map((periodo) => {
                const ativo = periodosSelecionados.includes(periodo);
                const valorOriginal = ativo ? custoPlanoOriginal.valorConsumoPorPeriodo[periodo] : 0;
                const qtdOriginal = ativo ? custoPlanoOriginal.consumoPorPeriodo[periodo] : 0;
                const valorAtual = ativo ? totais.valorConsumoPorPeriodo[periodo] : 0;
                const qtdAtual = ativo ? totais.consumoPorPeriodo[periodo] : 0;
                return (
                  <div key={periodo} className={`rounded border px-3 py-2 ${ativo ? 'border-stone-300 bg-stone-50' : 'border-gray-200 bg-gray-50 opacity-55'}`}>
                    <div className="text-[11px] font-semibold text-gray-500">{periodo}</div>
                    <div className="text-sm font-bold text-stone-800">{valorOriginal > 0 ? money(valorOriginal) : '-'}</div>
                    <div className="text-[10px] text-gray-500">Original qtd {fmt(qtdOriginal)}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-700">{valorAtual > 0 ? money(valorAtual) : '-'}</div>
                    <div className="text-[10px] text-gray-500">Atual qtd {fmt(qtdAtual)}</div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="flex flex-wrap items-start gap-5">
              <div>
                <div className="text-xs font-semibold text-gray-700 mb-1">Planos considerados</div>
                <div className="flex flex-wrap gap-2">
                  {PERIODOS.map((periodo) => (
                    <button
                      key={periodo}
                      type="button"
                      onClick={() => setPlanoAte(periodo)}
                      className={`px-3 py-1.5 rounded border text-xs font-semibold ${
                        planoAte === periodo
                          ? 'bg-brand-primary text-white border-brand-primary'
                          : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      ate {periodo}
                    </button>
                  ))}
                </div>
              </div>

              <label className="text-xs font-semibold text-gray-700">
                Buscar MP
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="codigo, nome ou artigo"
                  className="mt-1 block w-56 rounded border border-gray-300 px-2 py-1.5 text-xs font-normal"
                />
              </label>

              <label className="inline-flex items-center gap-2 pt-6 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={somenteComNecessidade}
                  onChange={(e) => setSomenteComNecessidade(e.target.checked)}
                />
                Mostrar somente necessidade
              </label>

              <button
                type="button"
                onClick={() => carregar(true)}
                disabled={loading || loadingPrices}
                className="mt-5 inline-flex items-center gap-2 rounded border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                <RefreshCw size={14} />
                Atualizar
              </button>

              <div className="pt-5 text-[11px] text-gray-500">
                <div>{cacheStatus || 'Cache persistido no banco'}</div>
                {cacheUpdatedAt && <div>Atualizado: {new Date(cacheUpdatedAt).toLocaleString('pt-BR')}</div>}
              </div>

              <div className="min-w-[240px]">
                <div className="text-xs font-semibold text-gray-700 mb-1">Artigos</div>
                <select
                  multiple
                  value={artigosSelecionados}
                  onChange={(e) => setArtigosSelecionados(Array.from(e.target.selectedOptions).map((o) => o.value))}
                  className="w-full h-20 rounded border border-gray-300 px-2 py-1 text-xs"
                >
                  {artigosDisponiveis.map((artigo) => <option key={artigo} value={artigo}>{artigo}</option>)}
                </select>
                <div className="mt-1 flex gap-2">
                  <button type="button" onClick={() => setArtigosSelecionados([])} className="px-2 py-0.5 text-[11px] rounded border border-gray-300 text-gray-700 hover:bg-gray-100">Limpar</button>
                  <button type="button" onClick={() => setArtigosSelecionados(artigosDisponiveis)} className="px-2 py-0.5 text-[11px] rounded border border-gray-300 text-gray-700 hover:bg-gray-100">Todos</button>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
              <span className="text-xs font-semibold text-brand-dark">Resumo por artigo - {periodosLabel}</span>
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
                    <SortTh align="right" active={artigoSort.key === 'comprasRegra'} dir={artigoSort.dir} onClick={() => toggleArtigoSort('comprasRegra')}>Compras regra</SortTh>
                    <SortTh align="right" active={artigoSort.key === 'valorComprasRegra'} dir={artigoSort.dir} onClick={() => toggleArtigoSort('valorComprasRegra')}>R$ compras regra</SortTh>
                    <SortTh align="right" active={artigoSort.key === 'comprasTotal'} dir={artigoSort.dir} onClick={() => toggleArtigoSort('comprasTotal')}>Compras total</SortTh>
                    <SortTh align="right" active={artigoSort.key === 'valorComprasTotal'} dir={artigoSort.dir} onClick={() => toggleArtigoSort('valorComprasTotal')}>R$ compras total</SortTh>
                    <SortTh align="right" active={artigoSort.key === 'necessidadeRegra'} dir={artigoSort.dir} onClick={() => toggleArtigoSort('necessidadeRegra')}>Nec. regra</SortTh>
                    <SortTh align="right" active={artigoSort.key === 'valorRegra'} dir={artigoSort.dir} onClick={() => toggleArtigoSort('valorRegra')}>R$ regra</SortTh>
                    <SortTh align="right" active={artigoSort.key === 'necessidadeTotal'} dir={artigoSort.dir} onClick={() => toggleArtigoSort('necessidadeTotal')}>Nec. total</SortTh>
                    <SortTh align="right" active={artigoSort.key === 'valorTotal'} dir={artigoSort.dir} onClick={() => toggleArtigoSort('valorTotal')}>R$ total</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {porArtigoOrdenado.map((row, idx) => (
                    <tr key={row.artigo} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
                      <Td strong>{row.artigo}</Td>
                      <Td align="right">{fmt(row.itens)}</Td>
                      <Td align="right">{fmt(row.estoque)}</Td>
                      <Td align="right" strong>{row.valorEstoque > 0 ? money(row.valorEstoque) : '-'}</Td>
                      <Td align="right">{fmt(row.consumo)}</Td>
                      <Td align="right" strong>{row.valorConsumo > 0 ? money(row.valorConsumo) : '-'}</Td>
                      <Td align="right" tone="sky">{fmt(row.comprasRegra)}</Td>
                      <Td align="right" tone="sky" strong>{row.valorComprasRegra > 0 ? money(row.valorComprasRegra) : '-'}</Td>
                      <Td align="right" tone="emerald">{fmt(row.comprasTotal)}</Td>
                      <Td align="right" tone="emerald" strong>{row.valorComprasTotal > 0 ? money(row.valorComprasTotal) : '-'}</Td>
                      <Td align="right" tone={row.necessidadeRegra > 0 ? 'red' : undefined}>{fmt(row.necessidadeRegra)}</Td>
                      <Td align="right" tone={row.valorRegra > 0 ? 'red' : undefined} strong>{row.valorRegra > 0 ? money(row.valorRegra) : '-'}</Td>
                      <Td align="right" tone={row.necessidadeTotal > 0 ? 'orange' : undefined}>{fmt(row.necessidadeTotal)}</Td>
                      <Td align="right" tone={row.valorTotal > 0 ? 'orange' : undefined} strong>{row.valorTotal > 0 ? money(row.valorTotal) : '-'}</Td>
                    </tr>
                  ))}
                  {porArtigoOrdenado.length === 0 && <tr><td colSpan={14} className="px-3 py-8 text-center text-gray-500">Sem dados para exibir.</td></tr>}
                </tbody>
                {porArtigoOrdenado.length > 0 && (
                  <tfoot className="sticky bottom-0 z-10 bg-gray-200 font-semibold text-gray-900">
                    <tr>
                      <Td strong>TOTAL</Td>
                      <Td align="right" strong>{fmt(porArtigoOrdenado.reduce((acc, row) => acc + row.itens, 0))}</Td>
                      <Td align="right" strong>{fmt(totais.estoque)}</Td>
                      <Td align="right" strong>{money(totais.valorEstoque)}</Td>
                      <Td align="right" strong>{fmt(totais.consumo)}</Td>
                      <Td align="right" strong>{money(totais.valorConsumo)}</Td>
                      <Td align="right" tone="sky" strong>{fmt(totais.comprasRegra)}</Td>
                      <Td align="right" tone="sky" strong>{money(totais.valorComprasRegra)}</Td>
                      <Td align="right" tone="emerald" strong>{fmt(totais.comprasTotal)}</Td>
                      <Td align="right" tone="emerald" strong>{money(totais.valorComprasTotal)}</Td>
                      <Td align="right" tone={totais.necessidadeRegra > 0 ? 'red' : undefined} strong>{fmt(totais.necessidadeRegra)}</Td>
                      <Td align="right" tone={totais.valorRegra > 0 ? 'red' : undefined} strong>{money(totais.valorRegra)}</Td>
                      <Td align="right" tone={totais.necessidadeTotal > 0 ? 'orange' : undefined} strong>{fmt(totais.necessidadeTotal)}</Td>
                      <Td align="right" tone={totais.valorTotal > 0 ? 'orange' : undefined} strong>{money(totais.valorTotal)}</Td>
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
            <div className="max-h-[52vh] overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 z-10 bg-gray-100">
                  <tr>
                    <SortTh active={mpSort.key === 'idmateriaprima'} dir={mpSort.dir} onClick={() => toggleMpSort('idmateriaprima')}>MP</SortTh>
                    <SortTh active={mpSort.key === 'nome_materiaprima'} dir={mpSort.dir} onClick={() => toggleMpSort('nome_materiaprima')}>Descricao</SortTh>
                    <SortTh active={mpSort.key === 'cor'} dir={mpSort.dir} onClick={() => toggleMpSort('cor')}>COR</SortTh>
                    <SortTh active={mpSort.key === 'artigo'} dir={mpSort.dir} onClick={() => toggleMpSort('artigo')}>Artigo</SortTh>
                    <SortTh align="right" active={mpSort.key === 'estoquetotal'} dir={mpSort.dir} onClick={() => toggleMpSort('estoquetotal')}>Estoque</SortTh>
                    <SortTh align="right" active={mpSort.key === 'valorEstoque'} dir={mpSort.dir} onClick={() => toggleMpSort('valorEstoque')}>R$ estoque</SortTh>
                    <SortTh align="right" active={mpSort.key === 'consumoAte'} dir={mpSort.dir} onClick={() => toggleMpSort('consumoAte')}>Consumo plano</SortTh>
                    <SortTh align="right" active={mpSort.key === 'valorUnitario'} dir={mpSort.dir} onClick={() => toggleMpSort('valorUnitario')}>V. unit.</SortTh>
                    <SortTh align="right" active={mpSort.key === 'valorConsumo'} dir={mpSort.dir} onClick={() => toggleMpSort('valorConsumo')}>R$ consumo</SortTh>
                    <SortTh align="right" active={mpSort.key === 'comprasRegra'} dir={mpSort.dir} onClick={() => toggleMpSort('comprasRegra')}>Compras regra</SortTh>
                    <SortTh align="right" active={mpSort.key === 'valorComprasRegra'} dir={mpSort.dir} onClick={() => toggleMpSort('valorComprasRegra')}>R$ compras regra</SortTh>
                    <SortTh align="right" active={mpSort.key === 'comprasTotal'} dir={mpSort.dir} onClick={() => toggleMpSort('comprasTotal')}>Compras total</SortTh>
                    <SortTh align="right" active={mpSort.key === 'valorComprasTotal'} dir={mpSort.dir} onClick={() => toggleMpSort('valorComprasTotal')}>R$ compras total</SortTh>
                    <SortTh align="right" active={mpSort.key === 'necessidadeRegra'} dir={mpSort.dir} onClick={() => toggleMpSort('necessidadeRegra')}>Nec. regra</SortTh>
                    <SortTh align="right" active={mpSort.key === 'valorNecessidadeRegra'} dir={mpSort.dir} onClick={() => toggleMpSort('valorNecessidadeRegra')}>R$ regra</SortTh>
                    <SortTh align="right" active={mpSort.key === 'necessidadeTotal'} dir={mpSort.dir} onClick={() => toggleMpSort('necessidadeTotal')}>Nec. total</SortTh>
                    <SortTh align="right" active={mpSort.key === 'valorNecessidadeTotal'} dir={mpSort.dir} onClick={() => toggleMpSort('valorNecessidadeTotal')}>R$ total</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {rowsOrdenadas.map((row, idx) => (
                    <tr key={`${row.idmateriaprima}-${idx}`} onClick={() => setMpModal(row)} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200 cursor-pointer hover:bg-amber-50`}>
                      <Td strong>{row.idmateriaprima}</Td>
                      <Td>{String(row.nome_materiaprima || '-')}</Td>
                      <Td>{String(row.cor || '-')}</Td>
                      <Td>{String(row.artigo || '-')}</Td>
                      <Td align="right">{fmt(Number(row.estoquetotal || 0))}</Td>
                      <Td align="right" strong>{row.valorEstoque > 0 ? money(row.valorEstoque) : '-'}</Td>
                      <Td align="right">{fmt(row.consumoAte)}</Td>
                      <Td align="right">
                        <div className="font-semibold">{row.valorUnitario > 0 ? money(row.valorUnitario) : '-'}</div>
                        <div className="text-[10px] text-gray-400">{row.origemValor}</div>
                      </Td>
                      <Td align="right" strong>{row.valorConsumo > 0 ? money(row.valorConsumo) : '-'}</Td>
                      <Td align="right" tone="sky">{fmt(row.comprasRegra)}</Td>
                      <Td align="right" tone="sky" strong>{row.valorComprasRegra > 0 ? money(row.valorComprasRegra) : '-'}</Td>
                      <Td align="right" tone="emerald">{fmt(row.comprasTotal)}</Td>
                      <Td align="right" tone="emerald" strong>{row.valorComprasTotal > 0 ? money(row.valorComprasTotal) : '-'}</Td>
                      <Td align="right" tone={row.necessidadeRegra > 0 ? 'red' : undefined}>{fmt(row.necessidadeRegra)}</Td>
                      <Td align="right" tone={row.valorNecessidadeRegra > 0 ? 'red' : undefined} strong>{row.valorNecessidadeRegra > 0 ? money(row.valorNecessidadeRegra) : '-'}</Td>
                      <Td align="right" tone={row.necessidadeTotal > 0 ? 'orange' : undefined}>{fmt(row.necessidadeTotal)}</Td>
                      <Td align="right" tone={row.valorNecessidadeTotal > 0 ? 'orange' : undefined} strong>{row.valorNecessidadeTotal > 0 ? money(row.valorNecessidadeTotal) : '-'}</Td>
                    </tr>
                  ))}
                  {rowsOrdenadas.length === 0 && <tr><td colSpan={17} className="px-3 py-8 text-center text-gray-500">Sem dados para exibir.</td></tr>}
                </tbody>
                {rowsOrdenadas.length > 0 && (
                  <tfoot className="sticky bottom-0 z-10 bg-gray-200 font-semibold text-gray-900">
                    <tr>
                      <Td strong>TOTAL</Td>
                      <Td />
                      <Td />
                      <Td />
                      <Td align="right" strong>{fmt(totais.estoque)}</Td>
                      <Td align="right" strong>{money(totais.valorEstoque)}</Td>
                      <Td align="right" strong>{fmt(totais.consumo)}</Td>
                      <Td />
                      <Td align="right" strong>{money(totais.valorConsumo)}</Td>
                      <Td align="right" tone="sky" strong>{fmt(totais.comprasRegra)}</Td>
                      <Td align="right" tone="sky" strong>{money(totais.valorComprasRegra)}</Td>
                      <Td align="right" tone="emerald" strong>{fmt(totais.comprasTotal)}</Td>
                      <Td align="right" tone="emerald" strong>{money(totais.valorComprasTotal)}</Td>
                      <Td align="right" tone={totais.necessidadeRegra > 0 ? 'red' : undefined} strong>{fmt(totais.necessidadeRegra)}</Td>
                      <Td align="right" tone={totais.valorRegra > 0 ? 'red' : undefined} strong>{money(totais.valorRegra)}</Td>
                      <Td align="right" tone={totais.necessidadeTotal > 0 ? 'orange' : undefined} strong>{fmt(totais.necessidadeTotal)}</Td>
                      <Td align="right" tone={totais.valorTotal > 0 ? 'orange' : undefined} strong>{money(totais.valorTotal)}</Td>
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
                    <div className="text-sm font-bold text-brand-dark">Extrato da necessidade total</div>
                    <div className="mt-1 text-xs text-gray-500">
                      MP {mpModal.idmateriaprima} | {mpModal.nome_materiaprima || '-'} | {mpModal.cor || '-'} | {mpModal.artigo || '-'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMpModal(null)}
                    className="rounded border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Fechar
                  </button>
                </div>

                <div className="overflow-auto p-5 space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <InfoCard label="Consumo plano" value={fmt(mpModal.consumoAte)} detail={money(mpModal.valorConsumo)} />
                    <InfoCard label="Estoque em casa" value={fmt(Number(mpModal.estoquetotal || 0))} detail={money(mpModal.valorEstoque)} />
                    <InfoCard label="Compras andamento" value={fmt(mpModal.comprasTotal)} detail={money(mpModal.valorComprasTotal)} />
                    <InfoCard label="Nec. total" value={fmt(mpModal.necessidadeTotal)} detail={money(mpModal.valorNecessidadeTotal)} tone="orange" />
                    <InfoCard label="Valor unit." value={mpModal.valorUnitario > 0 ? money(mpModal.valorUnitario) : '-'} detail={mpModal.origemValor} />
                  </div>

                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 text-xs font-semibold text-brand-dark">
                      Conta: consumo do plano - estoque - compras em andamento = necessidade total
                    </div>
                    <table className="min-w-full text-xs">
                      <tbody>
                        <tr className="border-t border-gray-100">
                          <td className="px-3 py-2 font-semibold text-gray-700">Consumo do plano ({periodosLabel})</td>
                          <td className="px-3 py-2 text-right">{fmt(mpModal.consumoAte)}</td>
                          <td className="px-3 py-2 text-right font-semibold">{money(mpModal.valorConsumo)}</td>
                        </tr>
                        <tr className="border-t border-gray-100">
                          <td className="px-3 py-2 font-semibold text-gray-700">(-) Estoque em casa</td>
                          <td className="px-3 py-2 text-right">{fmt(Number(mpModal.estoquetotal || 0))}</td>
                          <td className="px-3 py-2 text-right font-semibold">{money(mpModal.valorEstoque)}</td>
                        </tr>
                        <tr className="border-t border-gray-100">
                          <td className="px-3 py-2 font-semibold text-gray-700">(-) Pedidos/compras em andamento</td>
                          <td className="px-3 py-2 text-right">{fmt(mpModal.comprasTotal)}</td>
                          <td className="px-3 py-2 text-right font-semibold">{money(mpModal.valorComprasTotal)}</td>
                        </tr>
                        <tr className="border-t border-gray-200 bg-orange-50">
                          <td className="px-3 py-2 font-bold text-orange-800">Necessidade total</td>
                          <td className="px-3 py-2 text-right font-bold text-orange-800">{fmt(mpModal.necessidadeTotal)}</td>
                          <td className="px-3 py-2 text-right font-bold text-orange-800">{money(mpModal.valorNecessidadeTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                      <span className="text-xs font-semibold text-brand-dark">Pedidos em andamento considerados</span>
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
                          <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">Sem pedidos em andamento detalhados para esta MP.</td></tr>
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

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={`px-2.5 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>{children}</th>;
}

function SortTh({ children, align = 'left', active, dir, onClick }: { children: React.ReactNode; align?: 'left' | 'right'; active: boolean; dir: SortDir; onClick: () => void }) {
  return (
    <th className={`px-2.5 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end' : 'justify-start'} w-full hover:underline underline-offset-2`}>
        <span>{children}</span>
        <span className="text-[10px] text-gray-500">{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
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
