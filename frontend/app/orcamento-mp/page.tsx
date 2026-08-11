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
      })
      .sort((a, b) => b.valorNecessidadeRegra - a.valorNecessidadeRegra || b.valorNecessidadeTotal - a.valorNecessidadeTotal);
  }, [rowsBase, priceOptionsByMp, planoAte, artigosSelecionados, somenteComNecessidade, busca]);

  const porArtigo = useMemo(() => {
    const map = new Map<string, {
      artigo: string;
      itens: number;
      estoque: number;
      valorEstoque: number;
      consumo: number;
      comprasRegra: number;
      comprasTotal: number;
      valorConsumo: number;
      valorComprasRegra: number;
      valorComprasTotal: number;
      necessidadeRegra: number;
      necessidadeTotal: number;
      valorRegra: number;
      valorTotal: number;
      itensSemValor: number;
    }>();

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

    return Array.from(map.values())
      .sort((a, b) => b.valorRegra - a.valorRegra || b.valorTotal - a.valorTotal || a.artigo.localeCompare(b.artigo));
  }, [rowsCalculadas]);

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
              <span className="text-[11px] text-gray-500">{porArtigo.length} artigos</span>
            </div>
            <div className="max-h-[34vh] overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 z-10 bg-gray-100">
                  <tr>
                    <Th>Artigo</Th>
                    <Th align="right">MPs</Th>
                    <Th align="right">Estoque</Th>
                    <Th align="right">R$ estoque</Th>
                    <Th align="right">Consumo plano</Th>
                    <Th align="right">R$ consumo</Th>
                    <Th align="right">Compras regra</Th>
                    <Th align="right">R$ compras regra</Th>
                    <Th align="right">Compras total</Th>
                    <Th align="right">R$ compras total</Th>
                    <Th align="right">Nec. regra</Th>
                    <Th align="right">R$ regra</Th>
                    <Th align="right">Nec. total</Th>
                    <Th align="right">R$ total</Th>
                  </tr>
                </thead>
                <tbody>
                  {porArtigo.map((row, idx) => (
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
                  {porArtigo.length === 0 && <tr><td colSpan={14} className="px-3 py-8 text-center text-gray-500">Sem dados para exibir.</td></tr>}
                </tbody>
                {porArtigo.length > 0 && (
                  <tfoot className="sticky bottom-0 z-10 bg-gray-200 font-semibold text-gray-900">
                    <tr>
                      <Td strong>TOTAL</Td>
                      <Td align="right" strong>{fmt(porArtigo.reduce((acc, row) => acc + row.itens, 0))}</Td>
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
              <span className="text-[11px] text-gray-500">{rowsCalculadas.length} MPs</span>
            </div>
            <div className="max-h-[52vh] overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 z-10 bg-gray-100">
                  <tr>
                    <Th>MP</Th>
                    <Th>Descricao</Th>
                    <Th>COR</Th>
                    <Th>Artigo</Th>
                    <Th align="right">Estoque</Th>
                    <Th align="right">R$ estoque</Th>
                    <Th align="right">Consumo plano</Th>
                    <Th align="right">V. unit.</Th>
                    <Th align="right">R$ consumo</Th>
                    <Th align="right">Compras regra</Th>
                    <Th align="right">R$ compras regra</Th>
                    <Th align="right">Compras total</Th>
                    <Th align="right">R$ compras total</Th>
                    <Th align="right">Nec. regra</Th>
                    <Th align="right">R$ regra</Th>
                    <Th align="right">Nec. total</Th>
                    <Th align="right">R$ total</Th>
                  </tr>
                </thead>
                <tbody>
                  {rowsCalculadas.map((row, idx) => (
                    <tr key={`${row.idmateriaprima}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
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
                  {rowsCalculadas.length === 0 && <tr><td colSpan={17} className="px-3 py-8 text-center text-gray-500">Sem dados para exibir.</td></tr>}
                </tbody>
                {rowsCalculadas.length > 0 && (
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
