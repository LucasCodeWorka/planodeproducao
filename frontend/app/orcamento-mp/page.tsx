'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Save, History, Trash2, GitCompare, Eye, X } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { Planejamento } from '../types';
import { authHeaders, getToken } from '../lib/auth';
import { apiErrorMessage, fetchNoCache } from '../lib/api';

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
const CACHE_VERSION = 3;

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
  consumo_ultimos_dias?: number;
  consumo_dia?: number;
  estoque_cinco_dias?: number;
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

type PercentualPeriodo = { qtdLote: number; qtdFinalizada: number; qtdGerouOp: number; percentual: number; percentualGerouOp: number };
type DiasCapacidade = { porPeriodo: Record<Periodo, number>; acumulado: Record<Periodo, number>; capacidadeDiaria: number };
type OpsAntigas = { qtdTotal: number; opsCount: number; porFaixa: Record<string, { qtd: number; ops: number }>; data: Array<{ cdProduto: string; nrOp: string; nrCiclo: string; dtInicio: string; diasEmProcesso: number; qtdEmProcesso: number; descricao: string; referencia: string }> };
type ComparacaoSnapshotType = {
  snapshotA?: { descricao?: string; totalPlanoAtual?: number };
  snapshotB?: { descricao?: string; totalPlanoAtual?: number };
  comparacao?: { diferencaTotal?: number; mpsAdicionadas?: number; mpsRemovidas?: number; mpsAlteradas?: number };
};

type OrcamentoCachePayload = {
  version: number;
  rowsBase: MpRow[];
  rowsOriginalBase: MpRow[];
  priceOptionsByMp: Record<string, PriceOption[]>;
  createdAt: string;
  // Dados adicionais
  percentualPorPeriodo?: Record<Periodo, PercentualPeriodo | null>;
  diasFaltantesPorPeriodo?: Record<Periodo, number | null>;
  diasCapacidade?: DiasCapacidade | null;
  opsAntigas?: OpsAntigas | null;
  pecasPAPorPeriodo?: Record<Periodo, number>;
  pecasPAOriginalPorPeriodo?: Record<Periodo, number>;
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

type CoberturaPedidoDetalhe = {
  periodo: Periodo;
  empresa: string;
  pedido: string;
  data: string;
  valor: number;
};

type CoberturaPedidoResumo = {
  periodo: Periodo;
  datas: string[];
  pedidos: string[];
  valor: number;
};

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

function dateBR(value?: string) {
  if (!value) return '-';
  const [datePart] = String(value).split('T');
  const parts = datePart.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return String(value);
}

function periodosAte(periodo: Periodo) {
  return PERIODOS.slice(0, PERIODOS.indexOf(periodo) + 1);
}

function valorPeriodo(row: MpRow, prefixo: 'consumo' | 'entrada' | 'saldo', periodo: Periodo) {
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
  const [showComprasRegraModal, setShowComprasRegraModal] = useState(false);
  const [showComprasForaModal, setShowComprasForaModal] = useState(false);
  const [excessoModalPeriodo, setExcessoModalPeriodo] = useState<Periodo | null>(null);
  const [excessoArtigosExpandidos, setExcessoArtigosExpandidos] = useState<Set<string>>(new Set());
  const [percentualPorPeriodo, setPercentualPorPeriodo] = useState<Record<Periodo, PercentualPeriodo | null>>({ MA: null, PX: null, UL: null, QT: null, QU: null });
  const [diasFaltantesPorPeriodo, setDiasFaltantesPorPeriodo] = useState<Record<Periodo, number | null>>({ MA: null, PX: null, UL: null, QT: null, QU: null });
  const [diasCapacidade, setDiasCapacidade] = useState<{ porPeriodo: Record<Periodo, number>; acumulado: Record<Periodo, number>; capacidadeDiaria: number } | null>(null);
  const [opsAntigas, setOpsAntigas] = useState<{ qtdTotal: number; opsCount: number; porFaixa: Record<string, { qtd: number; ops: number }>; data: Array<{ cdProduto: string; nrOp: string; nrCiclo: string; dtInicio: string; diasEmProcesso: number; qtdEmProcesso: number; descricao: string; referencia: string }> } | null>(null);
  const [opsAntigasModalAberto, setOpsAntigasModalAberto] = useState(false);
  const [pecasPAPorPeriodo, setPecasPAPorPeriodo] = useState<Record<Periodo, number>>({ MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 });
  const [pecasPAOriginalPorPeriodo, setPecasPAOriginalPorPeriodo] = useState<Record<Periodo, number>>({ MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 });

  // Versionamento
  type Snapshot = { id: number; descricao: string; createdAt: string; totalPlanoOriginal: number; totalPlanoAtual: number; totalDiferenca: number; qtdMps: number; qtdSkus: number };
  type SnapshotDetalhe = {
    id: number; descricao: string; createdAt: string;
    totalPlanoOriginal: number; totalPlanoAtual: number; totalDiferenca: number;
    detalhesMps: Array<{
      idmp: number; nome: string; cor: string; artigo: string; unidade: string;
      estoque: number; valorUnitario: number; consumoQtd: number; valorConsumo: number;
      necessidadeRegra: number; valorNecessidadeRegra: number;
      necessidadeTotal: number; valorNecessidadeTotal: number;
      comprasRegra: number; valorComprasRegra: number;
      comprasTotal: number; valorComprasTotal: number;
    }>;
  };
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotModalAberto, setSnapshotModalAberto] = useState(false);
  const [snapshotDescricao, setSnapshotDescricao] = useState('');
  const [salvandoSnapshot, setSalvandoSnapshot] = useState(false);
  const [snapshotsModalAberto, setSnapshotsModalAberto] = useState(false);
  const [snapshotComparando, setSnapshotComparando] = useState<{ idA: number; idB: number } | null>(null);
  const [comparacaoSnapshot, setComparacaoSnapshot] = useState<ComparacaoSnapshotType | null>(null);
  const [snapshotDetalheAberto, setSnapshotDetalheAberto] = useState<SnapshotDetalhe | null>(null);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);

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
        const cacheResult = await carregarCachePersistido();
        if (cacheResult) {
          setProgress(100);
          setLoading(false);
          // Se o cache já tem dados adicionais, não precisa buscar novamente
          if (typeof cacheResult === 'object' && cacheResult.hasAdditionalData) {
            console.log('[orcamento-mp] Cache completo com dados adicionais');
            return;
          }
          // Cache antigo sem dados adicionais, buscar APIs
          console.log('[orcamento-mp] Cache sem dados adicionais, buscando APIs...');
          carregarDadosAdicionais();
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
      if (!rMatriz.ok || !pMatriz?.success) throw new Error(apiErrorMessage(pMatriz, 'Erro ao carregar plano oficial'));

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

      // Calcular totais de peças PA por período
      const totaisPecasPA = planos.reduce((acc, p) => {
        acc.MA += p.ma;
        acc.PX += p.px;
        acc.UL += p.ul;
        acc.QT += p.qt;
        acc.QU += p.qu;
        return acc;
      }, { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 });
      const totaisPecasPAOriginal = planosOriginais.reduce((acc, p) => {
        acc.MA += p.ma;
        acc.PX += p.px;
        acc.UL += p.ul;
        acc.QT += p.qt;
        acc.QU += p.qu;
        return acc;
      }, { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 });
      setPecasPAPorPeriodo(totaisPecasPA);
      setPecasPAOriginalPorPeriodo(totaisPecasPAOriginal);

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
      if (!rAnalise.ok || !pAnalise?.success) throw new Error(apiErrorMessage(pAnalise, 'Erro ao calcular consumo MP'));
      if (!rAnaliseOriginal.ok || !pAnaliseOriginal?.success) throw new Error(apiErrorMessage(pAnaliseOriginal, 'Erro ao calcular consumo MP original'));

      const mps = Array.isArray(pAnalise.data) ? pAnalise.data as MpRow[] : [];
      const mpsOriginais = Array.isArray(pAnaliseOriginal.data) ? pAnaliseOriginal.data as MpRow[] : [];
      setRowsBase(mps);
      setRowsOriginalBase(mpsOriginais);
      setProgress(78);
      const precos = await carregarPrecosMp([...mps, ...mpsOriginais]);

      // Buscar dados adicionais ANTES de salvar cache
      console.log('[orcamento-mp] Buscando dados adicionais para cache...');
      const dadosAdicionais = await carregarDadosAdicionais();

      await salvarCachePersistido({
        version: CACHE_VERSION,
        rowsBase: mps,
        rowsOriginalBase: mpsOriginais,
        priceOptionsByMp: precos,
        createdAt: new Date().toISOString(),
        // Incluir dados adicionais no cache
        percentualPorPeriodo: dadosAdicionais.percentualPorPeriodo,
        diasFaltantesPorPeriodo: dadosAdicionais.diasFaltantesPorPeriodo,
        diasCapacidade: dadosAdicionais.diasCapacidade,
        opsAntigas: dadosAdicionais.opsAntigas,
        pecasPAPorPeriodo: totaisPecasPA,
        pecasPAOriginalPorPeriodo: totaisPecasPAOriginal,
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

  async function carregarDadosAdicionais(): Promise<{
    percentualPorPeriodo: Record<Periodo, PercentualPeriodo | null>;
    diasFaltantesPorPeriodo: Record<Periodo, number | null>;
    diasCapacidade: DiasCapacidade | null;
    opsAntigas: OpsAntigas | null;
  }> {
    console.log('[orcamento-mp] Iniciando carregarDadosAdicionais...');

    let resultPercentual: Record<Periodo, PercentualPeriodo | null> = { MA: null, PX: null, UL: null, QT: null, QU: null };
    let resultDiasFaltantes: Record<Periodo, number | null> = { MA: null, PX: null, UL: null, QT: null, QU: null };
    let resultDiasCapacidade: DiasCapacidade | null = null;
    let resultOpsAntigas: OpsAntigas | null = null;

    // Carregar cada endpoint separadamente para que falha de um não afete os outros
    // 1. Percentual finalizado
    try {
      console.log('[orcamento-mp] Buscando percentual-finalizado...');
      const rPercentual = await fetchNoCache(`${API_URL}/api/producao/percentual-finalizado?marca=LIEBE&status=EM LINHA,NOVA COLECAO`, { headers: authHeaders() }, 180000);
      const pPercentual = await rPercentual.json();
      console.log('[orcamento-mp] percentual-finalizado resposta:', pPercentual?.success, pPercentual?.data);
      if (rPercentual.ok && pPercentual?.success && pPercentual.data) {
        resultPercentual = pPercentual.data;
        setPercentualPorPeriodo(resultPercentual);
      }
    } catch (err) {
      console.error('[orcamento-mp] Erro ao buscar percentual-finalizado:', err);
    }

    // 2. Dias resumo
    try {
      console.log('[orcamento-mp] Buscando dias-resumo...');
      const rDiasResumo = await fetchNoCache(`${API_URL}/api/capacidade/dias-resumo`, { headers: authHeaders() }, 180000);
      const pDiasResumo = await rDiasResumo.json();
      console.log('[orcamento-mp] dias-resumo resposta:', pDiasResumo?.success);
      if (rDiasResumo.ok && pDiasResumo?.success) {
        const diasNec = pDiasResumo.diasNecessarios || {};
        const diasAcum = pDiasResumo.diasAcumulado || {};
        const diasDisp = pDiasResumo.diasDisponiveis || {};

        // Calcular dias faltantes (acumulado - disponíveis até o período)
        let diasDisponiveisAcumulado = 0;
        for (const periodo of PERIODOS) {
          diasDisponiveisAcumulado += Number(diasDisp[periodo] || 0);
          const acumulado = Number(diasAcum[periodo] || 0);
          resultDiasFaltantes[periodo] = acumulado - diasDisponiveisAcumulado;
        }
        setDiasFaltantesPorPeriodo(resultDiasFaltantes);

        // Setar diasCapacidade com info de dias individual e acumulado
        resultDiasCapacidade = {
          porPeriodo: {
            MA: Number(diasNec.MA || 0),
            PX: Number(diasNec.PX || 0),
            UL: Number(diasNec.UL || 0),
            QT: Number(diasNec.QT || 0),
            QU: Number(diasNec.QU || 0),
          },
          acumulado: {
            MA: Number(diasAcum.MA || 0),
            PX: Number(diasAcum.PX || 0),
            UL: Number(diasAcum.UL || 0),
            QT: Number(diasAcum.QT || 0),
            QU: Number(diasAcum.QU || 0),
          },
          capacidadeDiaria: Number(pDiasResumo.capacidadeDiaria || 0),
        };
        setDiasCapacidade(resultDiasCapacidade);
      }
    } catch (err) {
      console.error('[orcamento-mp] Erro ao buscar dias-resumo:', err);
    }

    // 3. OPs antigas (> 20 dias em processo)
    try {
      console.log('[orcamento-mp] Buscando ops-antigas...');
      const rOpsAntigas = await fetchNoCache(`${API_URL}/api/producao/ops-antigas?dias=20&marca=LIEBE&status=EM LINHA,NOVA COLECAO`, { headers: authHeaders() }, 180000);
      const pOpsAntigas = await rOpsAntigas.json();
      console.log('[opsAntigas] Resposta:', pOpsAntigas);
      if (rOpsAntigas.ok && pOpsAntigas?.success) {
        resultOpsAntigas = {
          qtdTotal: Number(pOpsAntigas.totais?.qtdTotal || 0),
          opsCount: Number(pOpsAntigas.totais?.opsCount || 0),
          porFaixa: pOpsAntigas.porFaixa || {},
          data: Array.isArray(pOpsAntigas.data) ? pOpsAntigas.data : [],
        };
        setOpsAntigas(resultOpsAntigas);
      }
    } catch (err) {
      console.error('[orcamento-mp] Erro ao buscar ops-antigas:', err);
    }

    console.log('[orcamento-mp] carregarDadosAdicionais concluído');
    return {
      percentualPorPeriodo: resultPercentual,
      diasFaltantesPorPeriodo: resultDiasFaltantes,
      diasCapacidade: resultDiasCapacidade,
      opsAntigas: resultOpsAntigas,
    };
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

  // ══════════════════════════════════════════════════════════════════════════
  // VERSIONAMENTO / SNAPSHOTS
  // ══════════════════════════════════════════════════════════════════════════

  async function carregarSnapshots() {
    try {
      const response = await fetchNoCache(`${API_URL}/api/producao/orcamento-mp-snapshots?marca=LIEBE`, { headers: authHeaders() }, 30000);
      const payload = await response.json();
      if (response.ok && payload?.success && Array.isArray(payload.data)) {
        setSnapshots(payload.data);
      }
    } catch (err) {
      console.error('[orcamento-mp] Erro ao carregar snapshots:', err);
    }
  }

  async function salvarSnapshot() {
    if (!snapshotDescricao.trim()) return;
    setSalvandoSnapshot(true);
    try {
      // Calcular totais por periodo
      const planoOriginalPorPeriodo: Record<string, number> = {};
      const planoAtualPorPeriodo: Record<string, number> = {};
      let totalPlanoOriginal = 0;
      let totalPlanoAtual = 0;

      for (const periodo of PERIODOS) {
        planoOriginalPorPeriodo[periodo] = custoPlanoOriginal.valorConsumoPorPeriodo[periodo] || 0;
        planoAtualPorPeriodo[periodo] = coberturaPorPeriodo[periodo]?.consumo || 0;
        totalPlanoOriginal += planoOriginalPorPeriodo[periodo];
        totalPlanoAtual += planoAtualPorPeriodo[periodo];
      }

      // Preparar detalhes de TODAS as MPs com dados completos
      const detalhesMps = rowsCalculadas
        .map(row => ({
          idmp: row.idmateriaprima,
          nome: row.nome_materiaprima,
          cor: row.cor,
          artigo: row.artigo,
          unidade: row.unidade_compra || 'UND',
          estoque: row.estoquetotal || 0,
          valorUnitario: row.valorUnitario || 0,
          consumoQtd: row.consumoAte || 0,
          valorConsumo: row.valorConsumo || 0,
          necessidadeRegra: row.necessidadeRegra || 0,
          valorNecessidadeRegra: row.valorNecessidadeRegra || 0,
          necessidadeTotal: row.necessidadeTotal || 0,
          valorNecessidadeTotal: row.valorNecessidadeTotal || 0,
          comprasRegra: row.comprasRegra || 0,
          valorComprasRegra: row.valorComprasRegra || 0,
          comprasTotal: row.comprasTotal || 0,
          valorComprasTotal: row.valorComprasTotal || 0,
        }))
        .filter(mp => mp.consumoQtd > 0 || mp.necessidadeRegra > 0)
        .sort((a, b) => b.valorConsumo - a.valorConsumo);

      const response = await fetchNoCache(`${API_URL}/api/producao/orcamento-mp-snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          descricao: snapshotDescricao.trim(),
          marca: 'LIEBE',
          totalPlanoOriginal,
          totalPlanoAtual,
          planoOriginalPorPeriodo,
          planoAtualPorPeriodo,
          pecasPaOriginalPorPeriodo: pecasPAOriginalPorPeriodo,
          pecasPaAtualPorPeriodo: pecasPAPorPeriodo,
          detalhesMps,
          qtdMps: rowsCalculadas.length,
          qtdSkus: rowsBase.length,
        }),
      }, 60000);

      const payload = await response.json();
      if (response.ok && payload?.success) {
        setSnapshotModalAberto(false);
        setSnapshotDescricao('');
        await carregarSnapshots();
      } else {
        alert('Erro ao salvar versão: ' + (payload?.error || 'Erro desconhecido'));
      }
    } catch (err) {
      console.error('[orcamento-mp] Erro ao salvar snapshot:', err);
      alert('Erro ao salvar versão');
    } finally {
      setSalvandoSnapshot(false);
    }
  }

  async function compararSnapshots(idA: number, idB: number) {
    setSnapshotComparando({ idA, idB });
    try {
      const response = await fetchNoCache(`${API_URL}/api/producao/orcamento-mp-snapshots/comparar?idA=${idA}&idB=${idB}`, { headers: authHeaders() }, 30000);
      const payload = await response.json();
      if (response.ok && payload?.success) {
        setComparacaoSnapshot(payload.data);
      }
    } catch (err) {
      console.error('[orcamento-mp] Erro ao comparar snapshots:', err);
    }
  }

  async function verDetalhesSnapshot(id: number) {
    setCarregandoDetalhe(true);
    try {
      const response = await fetchNoCache(`${API_URL}/api/producao/orcamento-mp-snapshot/${id}`, { headers: authHeaders() }, 30000);
      const payload = await response.json();
      if (response.ok && payload?.success) {
        setSnapshotDetalheAberto(payload.data);
      } else {
        alert('Erro ao carregar detalhes: ' + (payload?.error || 'Erro desconhecido'));
      }
    } catch (err) {
      console.error('[orcamento-mp] Erro ao carregar detalhes do snapshot:', err);
      alert('Erro ao carregar detalhes');
    } finally {
      setCarregandoDetalhe(false);
    }
  }

  async function excluirSnapshot(id: number) {
    if (!confirm('Tem certeza que deseja excluir esta versão?')) return;
    try {
      await fetchNoCache(`${API_URL}/api/producao/orcamento-mp-snapshot/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      }, 30000);
      await carregarSnapshots();
    } catch (err) {
      console.error('[orcamento-mp] Erro ao excluir snapshot:', err);
    }
  }

  // Carregar snapshots ao montar
  useEffect(() => {
    carregarSnapshots();
  }, []);

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
      // Restaurar dados adicionais do cache
      if (data.percentualPorPeriodo) setPercentualPorPeriodo(data.percentualPorPeriodo);
      if (data.diasFaltantesPorPeriodo) setDiasFaltantesPorPeriodo(data.diasFaltantesPorPeriodo);
      if (data.diasCapacidade) setDiasCapacidade(data.diasCapacidade);
      if (data.opsAntigas) setOpsAntigas(data.opsAntigas);
      if (data.pecasPAPorPeriodo) setPecasPAPorPeriodo(data.pecasPAPorPeriodo);
      if (data.pecasPAOriginalPorPeriodo) setPecasPAOriginalPorPeriodo(data.pecasPAOriginalPorPeriodo);
      setCacheUpdatedAt(payload.updatedAt || data.createdAt || null);
      setCacheStatus('Cache carregado');
      // Retorna se tem dados adicionais ou não
      return { hasAdditionalData: !!(data.percentualPorPeriodo && data.diasCapacidade) };
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

  const rowsComValores = useMemo<MpCalculada[]>(() => {
    return rowsBase.map((row) => {
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
      });
  }, [rowsBase, priceOptionsByMp, planoAte]);

  const rowsCalculadas = useMemo<MpCalculada[]>(() => {
    const artigoSet = new Set(artigosSelecionados);
    const q = busca.trim().toUpperCase();

    return rowsComValores
      .filter((row) => {
        const artigo = String(row.artigo || '-').trim() || '-';
        if (artigoSet.size > 0 && !artigoSet.has(artigo)) return false;
        if (somenteComNecessidade && row.necessidadeRegra <= 0 && row.necessidadeTotal <= 0) return false;
        if (!q) return true;
        return String(row.idmateriaprima || '').includes(q)
          || String(row.nome_materiaprima || '').toUpperCase().includes(q)
          || artigo.toUpperCase().includes(q);
      });
  }, [rowsComValores, artigosSelecionados, somenteComNecessidade, busca]);

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
      let necessidadeTotalAnterior = 0;
      for (const periodo of PERIODOS) {
        const consumoPeriodo = valorPeriodo(row, 'consumo', periodo);
        acc.consumoPorPeriodo[periodo] += consumoPeriodo;
        acc.valorConsumoPorPeriodo[periodo] += consumoPeriodo * row.valorUnitario;
        // Necessidade total cumulativa: max(0, consumo_ate_periodo - estoque - compras_totais)
        const consumoAtePeriodo = somaAte(row, 'consumo', periodo);
        const necessidadeCumulativa = Math.max(0, consumoAtePeriodo - Number(row.estoquetotal || 0) - row.comprasTotal);
        acc.necessidadeCumulativaPorPeriodo[periodo] += necessidadeCumulativa;
        acc.valorNecessidadeCumulativaPorPeriodo[periodo] += necessidadeCumulativa * row.valorUnitario;
        // Compras por periodo (regra de chegada)
        const comprasPeriodo = valorPeriodo(row, 'entrada', periodo);
        acc.comprasPorPeriodo[periodo] += comprasPeriodo;
        acc.valorComprasPorPeriodo[periodo] += comprasPeriodo * row.valorUnitario;
        // Necessidade individual baseada sempre na necessidade total:
        // mostra quanto do total foi gerado especificamente neste periodo.
        const necessidadeIndividualTotal = Math.max(0, necessidadeCumulativa - necessidadeTotalAnterior);
        acc.necessidadeIndividualPorPeriodo[periodo] += necessidadeIndividualTotal;
        acc.valorNecessidadeIndividualPorPeriodo[periodo] += necessidadeIndividualTotal * row.valorUnitario;
        necessidadeTotalAnterior = necessidadeCumulativa;
        // Compras cumulativas ate o periodo
        const comprasAtePeriodo = somaAte(row, 'entrada', periodo);
        acc.comprasCumulativaPorPeriodo[periodo] += comprasAtePeriodo;
        acc.valorComprasCumulativaPorPeriodo[periodo] += comprasAtePeriodo * row.valorUnitario;
        // Excesso por periodo (saldo - estoque_seguranca com 5 dias)
        const saldoPeriodo = valorPeriodo(row, 'saldo', periodo);
        const estoqueSeguranca = Number(row.estoque_cinco_dias || 0);
        const excessoPeriodo = Math.max(0, saldoPeriodo - estoqueSeguranca);
        acc.excessoPorPeriodo[periodo] += excessoPeriodo;
        acc.valorExcessoPorPeriodo[periodo] += excessoPeriodo * row.valorUnitario;
      }
      acc.valorComprasRegra += row.valorComprasRegra;
      acc.valorComprasTotal += row.valorComprasTotal;
      acc.necessidadeRegra += row.necessidadeRegra;
      acc.necessidadeTotal += row.necessidadeTotal;
      acc.valorRegra += row.valorNecessidadeRegra;
      acc.valorTotal += row.valorNecessidadeTotal;

      // Calcular compras que cobrem a diferenca entre nec.regra e nec.total
      // Diferenca = compras que chegam APOS o periodo filtrado e cobrem necessidade
      const diferencaNecessidade = row.necessidadeRegra - row.necessidadeTotal;
      if (diferencaNecessidade > 0) {
        // Essa MP tem necessidade que é coberta por compras futuras
        // Distribuir pelos periodos APOS planoAte
        const idxPlanoAte = PERIODOS.indexOf(planoAte);
        let restanteParaCobrir = diferencaNecessidade;
        for (let i = idxPlanoAte + 1; i < PERIODOS.length && restanteParaCobrir > 0; i++) {
          const periodoFuturo = PERIODOS[i];
          const comprasPeriodoFuturo = valorPeriodo(row, 'entrada', periodoFuturo);
          const coberturaQtd = Math.min(restanteParaCobrir, comprasPeriodoFuturo);
          if (coberturaQtd > 0) {
            acc.comprasCoberturaPorPeriodo[periodoFuturo] += coberturaQtd;
            acc.valorComprasCoberturaPorPeriodo[periodoFuturo] += coberturaQtd * row.valorUnitario;
            restanteParaCobrir -= coberturaQtd;
          }
        }
      }

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
      necessidadeCumulativaPorPeriodo: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
      valorNecessidadeCumulativaPorPeriodo: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
      necessidadeIndividualPorPeriodo: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
      valorNecessidadeIndividualPorPeriodo: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
      comprasPorPeriodo: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
      valorComprasPorPeriodo: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
      comprasCumulativaPorPeriodo: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
      valorComprasCumulativaPorPeriodo: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
      // Compras que cobrem necessidade por periodo (para justificar diferenca nec.regra vs nec.total)
      comprasCoberturaPorPeriodo: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
      valorComprasCoberturaPorPeriodo: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
      // Excesso por periodo (saldo - estoque_seguranca)
      excessoPorPeriodo: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
      valorExcessoPorPeriodo: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
      valorComprasRegra: 0,
      valorComprasTotal: 0,
      necessidadeRegra: 0,
      necessidadeTotal: 0,
      valorRegra: 0,
      valorTotal: 0,
      itensSemValor: 0,
    });
  }, [rowsCalculadas]);

  const comprasAndamentoGeral = useMemo(() => {
    return rowsComValores.reduce((acc, row) => {
      acc.qtd += row.comprasTotal;
      acc.valor += row.valorComprasTotal;
      if ((row.necessidadeRegra > 0 || row.necessidadeTotal > 0) && row.valorUnitario <= 0) acc.itensSemValor += 1;
      return acc;
    }, { qtd: 0, valor: 0, itensSemValor: 0 });
  }, [rowsComValores]);

  // Calculo de cobertura por periodo (estoque + compras) - CALCULADO POR MP
  // O calculo precisa ser feito por MP porque excesso de uma MP NAO cobre falta de outra
  const coberturaPorPeriodo = useMemo(() => {
    const result: Record<Periodo, {
      coberturaEstoque: number;
      coberturaCompras: number;
      coberturaTotal: number;
      consumo: number;
      necessidade: number;  // o que falta apos estoque + compras
      percentual: number;
    }> = {
      MA: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
      PX: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
      UL: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
      QT: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
      QU: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
    };

    // Para cada MP, calcular cobertura por periodo
    for (const row of rowsCalculadas) {
      let saldoMp = Number(row.estoquetotal || 0) * row.valorUnitario; // estoque em valor

      for (const periodo of PERIODOS) {
        const consumoPeriodo = valorPeriodo(row, 'consumo', periodo) * row.valorUnitario;
        const comprasPeriodo = valorPeriodo(row, 'entrada', periodo) * row.valorUnitario;

        if (consumoPeriodo <= 0) {
          // Sem consumo, apenas acumula compras no saldo
          saldoMp += comprasPeriodo;
          continue;
        }

        // Quanto do saldo/estoque cobre esse periodo
        const coberturaEstoque = Math.min(saldoMp, consumoPeriodo);
        const necessidadeAposEstoque = Math.max(0, consumoPeriodo - saldoMp);

        // Quanto das compras cobre o restante
        const coberturaCompras = Math.min(comprasPeriodo, necessidadeAposEstoque);
        const necessidadeAposCompras = Math.max(0, necessidadeAposEstoque - comprasPeriodo);

        // Acumula nos totais do periodo
        result[periodo].consumo += consumoPeriodo;
        result[periodo].coberturaEstoque += coberturaEstoque;
        result[periodo].coberturaCompras += coberturaCompras;
        result[periodo].coberturaTotal += coberturaEstoque + coberturaCompras;
        result[periodo].necessidade += necessidadeAposCompras;

        // Atualiza saldo para proximo periodo
        // saldo = (estoque anterior + compras) - consumo
        saldoMp = Math.max(0, saldoMp + comprasPeriodo - consumoPeriodo);
      }
    }

    // Calcula percentuais
    for (const periodo of PERIODOS) {
      const r = result[periodo];
      r.percentual = r.consumo > 0 ? Math.min(100, (r.coberturaTotal / r.consumo) * 100) : 100;
    }

    return result;
  }, [rowsCalculadas]);

  // Cobertura por periodo por categoria de artigo (BOJO, ALCA, DEMAIS)
  type CategoriaArtigo = 'BOJO' | 'ALCA' | 'DEMAIS';
  const CATEGORIAS_ARTIGO: CategoriaArtigo[] = ['BOJO', 'ALCA', 'DEMAIS'];

  const coberturaPorArtigoPorPeriodo = useMemo(() => {
    const categorizarArtigo = (artigo: string): CategoriaArtigo => {
      const upper = (artigo || '').toUpperCase().trim();
      if (upper.includes('BOJO')) return 'BOJO';
      if (upper.includes('ALCA') || upper.includes('ALÇA')) return 'ALCA';
      return 'DEMAIS';
    };

    const result: Record<CategoriaArtigo, Record<Periodo, {
      coberturaEstoque: number;
      coberturaCompras: number;
      coberturaTotal: number;
      consumo: number;
      necessidade: number;
      percentual: number;
    }>> = {
      BOJO: {
        MA: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
        PX: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
        UL: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
        QT: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
        QU: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
      },
      ALCA: {
        MA: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
        PX: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
        UL: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
        QT: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
        QU: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
      },
      DEMAIS: {
        MA: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
        PX: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
        UL: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
        QT: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
        QU: { coberturaEstoque: 0, coberturaCompras: 0, coberturaTotal: 0, consumo: 0, necessidade: 0, percentual: 0 },
      },
    };

    // Para cada MP, calcular cobertura por periodo e categoria
    for (const row of rowsCalculadas) {
      const categoria = categorizarArtigo(row.artigo || '');
      let saldoMp = Number(row.estoquetotal || 0) * row.valorUnitario;

      for (const periodo of PERIODOS) {
        const consumoPeriodo = valorPeriodo(row, 'consumo', periodo) * row.valorUnitario;
        const comprasPeriodo = valorPeriodo(row, 'entrada', periodo) * row.valorUnitario;

        if (consumoPeriodo <= 0) {
          saldoMp += comprasPeriodo;
          continue;
        }

        const coberturaEstoque = Math.min(saldoMp, consumoPeriodo);
        const necessidadeAposEstoque = Math.max(0, consumoPeriodo - saldoMp);
        const coberturaCompras = Math.min(comprasPeriodo, necessidadeAposEstoque);
        const necessidadeAposCompras = Math.max(0, necessidadeAposEstoque - comprasPeriodo);

        result[categoria][periodo].consumo += consumoPeriodo;
        result[categoria][periodo].coberturaEstoque += coberturaEstoque;
        result[categoria][periodo].coberturaCompras += coberturaCompras;
        result[categoria][periodo].coberturaTotal += coberturaEstoque + coberturaCompras;
        result[categoria][periodo].necessidade += necessidadeAposCompras;

        saldoMp = Math.max(0, saldoMp + comprasPeriodo - consumoPeriodo);
      }
    }

    // Calcular percentuais
    for (const cat of CATEGORIAS_ARTIGO) {
      for (const periodo of PERIODOS) {
        const r = result[cat][periodo];
        r.percentual = r.consumo > 0 ? Math.min(100, (r.coberturaTotal / r.consumo) * 100) : 100;
      }
    }

    return result;
  }, [rowsCalculadas]);

  // Total de cobertura (estoque + compras vs consumo total) - POR MP
  const totalCobertura = useMemo(() => {
    let totalConsumo = 0;
    let totalCoberturaEstoque = 0;
    let totalCoberturaCompras = 0;
    let totalNecessidade = 0;

    for (const periodo of PERIODOS) {
      totalConsumo += coberturaPorPeriodo[periodo].consumo;
      totalCoberturaEstoque += coberturaPorPeriodo[periodo].coberturaEstoque;
      totalCoberturaCompras += coberturaPorPeriodo[periodo].coberturaCompras;
      totalNecessidade += coberturaPorPeriodo[periodo].necessidade;
    }

    const totalCoberturaVal = totalCoberturaEstoque + totalCoberturaCompras;
    const percentual = totalConsumo > 0 ? (totalCoberturaVal / totalConsumo) * 100 : 0;

    return {
      totalConsumo,
      totalCoberturaEstoque,
      totalCoberturaCompras,
      totalCobertura: totalCoberturaVal,
      totalNecessidade,
      percentual,
    };
  }, [coberturaPorPeriodo]);

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

  const pedidosCoberturaFutura = useMemo(() => {
    const idxPlanoAte = PERIODOS.indexOf(planoAte);
    const detalhesMap = new Map<string, CoberturaPedidoDetalhe>();

    for (const row of rowsCalculadas) {
      const diferencaNecessidade = row.necessidadeRegra - row.necessidadeTotal;
      if (diferencaNecessidade <= 0) continue;

      let restanteParaCobrir = diferencaNecessidade;
      for (let i = idxPlanoAte + 1; i < PERIODOS.length && restanteParaCobrir > 0; i++) {
        const periodo = PERIODOS[i];
        const comprasPeriodoFuturo = valorPeriodo(row, 'entrada', periodo);
        let coberturaPeriodo = Math.min(restanteParaCobrir, comprasPeriodoFuturo);
        if (coberturaPeriodo <= 0) continue;

        const pedidosPeriodo = (Array.isArray(row.pedidos_detalhe) ? row.pedidos_detalhe : [])
          .filter((pedido) => pedido.periodo === periodo.toLowerCase() || pedido.periodo === periodo)
          .sort((a, b) => {
            const byDate = String(a.data || '').localeCompare(String(b.data || ''));
            if (byDate) return byDate;
            return String(a.pedido || '').localeCompare(String(b.pedido || ''), 'pt-BR', { numeric: true });
          });

        for (const pedido of pedidosPeriodo) {
          if (coberturaPeriodo <= 0) break;
          const qtdPedido = Number(pedido.quantidade || 0);
          if (qtdPedido <= 0) continue;
          const quantidade = Math.min(coberturaPeriodo, qtdPedido);
          const empresa = String(pedido.empresa || '-');
          const numeroPedido = String(pedido.pedido || '-');
          const data = String(pedido.data || '');
          const key = `${periodo}|${data}|${empresa}|${numeroPedido}`;
          const atual = detalhesMap.get(key);
          const valor = quantidade * row.valorUnitario;
          if (atual) {
            atual.valor += valor;
          } else {
            detalhesMap.set(key, {
              periodo,
              empresa,
              pedido: numeroPedido,
              data,
              valor,
            });
          }
          coberturaPeriodo -= quantidade;
          restanteParaCobrir -= quantidade;
        }
      }
    }

    return Array.from(detalhesMap.values()).sort((a, b) => {
      const byPeriodo = PERIODOS.indexOf(a.periodo) - PERIODOS.indexOf(b.periodo);
      if (byPeriodo) return byPeriodo;
      const byDate = a.data.localeCompare(b.data);
      if (byDate) return byDate;
      return a.pedido.localeCompare(b.pedido, 'pt-BR', { numeric: true });
    });
  }, [rowsCalculadas, planoAte]);

  const resumoPedidosCoberturaFutura = useMemo(() => {
    const map = new Map<Periodo, CoberturaPedidoResumo>();
    for (const item of pedidosCoberturaFutura) {
      const atual = map.get(item.periodo) || {
        periodo: item.periodo,
        datas: [],
        pedidos: [],
        valor: 0,
      };
      const data = dateBR(item.data);
      const pedido = item.pedido;
      if (!atual.datas.includes(data)) atual.datas.push(data);
      if (!atual.pedidos.includes(pedido)) atual.pedidos.push(pedido);
      atual.valor += item.valor;
      map.set(item.periodo, atual);
    }

    return Array.from(map.values()).sort((a, b) => PERIODOS.indexOf(a.periodo) - PERIODOS.indexOf(b.periodo));
  }, [pedidosCoberturaFutura]);

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';
  const periodosLabel = periodosAte(planoAte).join('+');
  const periodosSelecionados = periodosAte(planoAte);
  const pedidosModal = useMemo(() => {
    return [...(Array.isArray(mpModal?.pedidos_detalhe) ? mpModal.pedidos_detalhe : [])]
      .sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
  }, [mpModal]);

  // Pedidos dentro da regra de chegada (para o modal de "Compras regra")
  const pedidosComprasRegra = useMemo(() => {
    const periodosValidos = new Set(periodosSelecionados.map((p) => p.toLowerCase()));
    const detalhes: Array<{
      mp: string;
      nome: string;
      artigo: string;
      pedido: string;
      empresa: string;
      data: string;
      periodo: string;
      quantidade: number;
      valorUnitario: number;
      valor: number;
    }> = [];

    for (const row of rowsCalculadas) {
      const pedidos = Array.isArray(row.pedidos_detalhe) ? row.pedidos_detalhe : [];
      for (const pedido of pedidos) {
        const periodoLower = String(pedido.periodo || '').toLowerCase();
        if (!periodosValidos.has(periodoLower)) continue;
        const qtd = Number(pedido.quantidade || 0);
        if (qtd <= 0) continue;
        detalhes.push({
          mp: String(row.idmateriaprima || ''),
          nome: String(row.nome_materiaprima || '-'),
          artigo: String(row.artigo || '-'),
          pedido: String(pedido.pedido || '-'),
          empresa: String(pedido.empresa || '-'),
          data: String(pedido.data || ''),
          periodo: String(pedido.periodo || '-').toUpperCase(),
          quantidade: qtd,
          valorUnitario: row.valorUnitario,
          valor: qtd * row.valorUnitario,
        });
      }
    }

    return detalhes.sort((a, b) => {
      const byPeriodo = PERIODOS.indexOf(a.periodo as Periodo) - PERIODOS.indexOf(b.periodo as Periodo);
      if (byPeriodo) return byPeriodo;
      const byData = a.data.localeCompare(b.data);
      if (byData) return byData;
      return a.pedido.localeCompare(b.pedido, 'pt-BR', { numeric: true });
    });
  }, [rowsCalculadas, periodosSelecionados]);

  // Resumo por periodo para modal de compras regra
  const resumoComprasRegraPorPeriodo = useMemo(() => {
    const map = new Map<string, { periodo: string; quantidade: number; valor: number; pedidos: Set<string> }>();
    for (const item of pedidosComprasRegra) {
      const atual = map.get(item.periodo) || { periodo: item.periodo, quantidade: 0, valor: 0, pedidos: new Set<string>() };
      atual.quantidade += item.quantidade;
      atual.valor += item.valor;
      atual.pedidos.add(item.pedido);
      map.set(item.periodo, atual);
    }
    return Array.from(map.values())
      .map((item) => ({ ...item, pedidosCount: item.pedidos.size }))
      .sort((a, b) => PERIODOS.indexOf(a.periodo as Periodo) - PERIODOS.indexOf(b.periodo as Periodo));
  }, [pedidosComprasRegra]);

  // Pedidos FORA da regra de chegada (para o modal de diferenca)
  const pedidosForaRegra = useMemo(() => {
    const periodosValidos = new Set(periodosSelecionados.map((p) => p.toLowerCase()));
    const detalhes: Array<{
      mp: string;
      nome: string;
      artigo: string;
      pedido: string;
      empresa: string;
      data: string;
      periodo: string;
      quantidade: number;
      valorUnitario: number;
      valor: number;
    }> = [];

    for (const row of rowsCalculadas) {
      const pedidos = Array.isArray(row.pedidos_detalhe) ? row.pedidos_detalhe : [];
      for (const pedido of pedidos) {
        const periodoLower = String(pedido.periodo || '').toLowerCase();
        // Pegar apenas os que NAO estao nos periodos selecionados
        if (periodosValidos.has(periodoLower)) continue;
        const qtd = Number(pedido.quantidade || 0);
        if (qtd <= 0) continue;
        detalhes.push({
          mp: String(row.idmateriaprima || ''),
          nome: String(row.nome_materiaprima || '-'),
          artigo: String(row.artigo || '-'),
          pedido: String(pedido.pedido || '-'),
          empresa: String(pedido.empresa || '-'),
          data: String(pedido.data || ''),
          periodo: String(pedido.periodo || '-').toUpperCase(),
          quantidade: qtd,
          valorUnitario: row.valorUnitario,
          valor: qtd * row.valorUnitario,
        });
      }
    }

    return detalhes.sort((a, b) => {
      const byPeriodo = PERIODOS.indexOf(a.periodo as Periodo) - PERIODOS.indexOf(b.periodo as Periodo);
      if (byPeriodo) return byPeriodo;
      const byData = a.data.localeCompare(b.data);
      if (byData) return byData;
      return a.pedido.localeCompare(b.pedido, 'pt-BR', { numeric: true });
    });
  }, [rowsCalculadas, periodosSelecionados]);

  // Resumo por periodo para modal de compras fora da regra
  const resumoComprasForaPorPeriodo = useMemo(() => {
    const map = new Map<string, { periodo: string; quantidade: number; valor: number; pedidos: Set<string> }>();
    for (const item of pedidosForaRegra) {
      const atual = map.get(item.periodo) || { periodo: item.periodo, quantidade: 0, valor: 0, pedidos: new Set<string>() };
      atual.quantidade += item.quantidade;
      atual.valor += item.valor;
      atual.pedidos.add(item.pedido);
      map.set(item.periodo, atual);
    }
    return Array.from(map.values())
      .map((item) => ({ ...item, pedidosCount: item.pedidos.size }))
      .sort((a, b) => PERIODOS.indexOf(a.periodo as Periodo) - PERIODOS.indexOf(b.periodo as Periodo));
  }, [pedidosForaRegra]);

  const totalForaRegra = useMemo(() => {
    return pedidosForaRegra.reduce((acc, item) => ({ qtd: acc.qtd + item.quantidade, valor: acc.valor + item.valor }), { qtd: 0, valor: 0 });
  }, [pedidosForaRegra]);

  // Calcula MPs com excesso para o período selecionado no modal - com cálculo completo
  const excessoModalRows = useMemo(() => {
    if (!excessoModalPeriodo) return [];
    const periodosAte = (ate: Periodo): Periodo[] => {
      const idx = PERIODOS.indexOf(ate);
      return idx >= 0 ? PERIODOS.slice(0, idx + 1) as Periodo[] : [];
    };
    const periodosIncluidos = periodosAte(excessoModalPeriodo);

    return rowsCalculadas
      .map((row) => {
        const estoque = Number(row.estoquetotal || 0);
        // Somar entradas até o período
        let entradasAte = 0;
        for (const p of periodosIncluidos) {
          entradasAte += Number(row[`entrada_${p.toLowerCase()}` as keyof MpCalculada] || 0);
        }
        // Somar consumo até o período
        let consumoAte = 0;
        for (const p of periodosIncluidos) {
          consumoAte += Number(row[`consumo_${p.toLowerCase()}` as keyof MpCalculada] || 0);
        }
        const saldoPeriodo = estoque + entradasAte - consumoAte;
        const estoqueSeguranca = Number(row.estoque_cinco_dias || 0);
        const excessoPeriodo = Math.max(0, saldoPeriodo - estoqueSeguranca);
        const valorExcesso = excessoPeriodo * row.valorUnitario;
        return {
          ...row,
          estoque,
          entradasAte,
          consumoAte,
          saldoPeriodo,
          estoqueSeguranca,
          excessoPeriodo,
          valorExcesso,
        };
      })
      .filter((row) => row.excessoPeriodo > 0)
      .sort((a, b) => b.valorExcesso - a.valorExcesso);
  }, [rowsCalculadas, excessoModalPeriodo]);

  // Agrupa por artigo para o modal de excesso
  const excessoModalPorArtigo = useMemo(() => {
    const map = new Map<string, {
      artigo: string;
      mps: typeof excessoModalRows;
      estoque: number;
      entradasAte: number;
      consumoAte: number;
      saldo: number;
      estoqueSeguranca: number;
      excesso: number;
      valorExcesso: number;
    }>();
    for (const row of excessoModalRows) {
      const artigo = String(row.artigo || 'SEM ARTIGO').trim().toUpperCase();
      if (!map.has(artigo)) {
        map.set(artigo, {
          artigo,
          mps: [],
          estoque: 0,
          entradasAte: 0,
          consumoAte: 0,
          saldo: 0,
          estoqueSeguranca: 0,
          excesso: 0,
          valorExcesso: 0,
        });
      }
      const acc = map.get(artigo)!;
      acc.mps.push(row);
      acc.estoque += row.estoque;
      acc.entradasAte += row.entradasAte;
      acc.consumoAte += row.consumoAte;
      acc.saldo += row.saldoPeriodo;
      acc.estoqueSeguranca += row.estoqueSeguranca;
      acc.excesso += row.excessoPeriodo;
      acc.valorExcesso += row.valorExcesso;
    }
    return Array.from(map.values()).sort((a, b) => b.valorExcesso - a.valorExcesso);
  }, [excessoModalRows]);

  const excessoModalTotais = useMemo(() => {
    return excessoModalRows.reduce(
      (acc, row) => ({
        itens: acc.itens + 1,
        estoque: acc.estoque + row.estoque,
        entradasAte: acc.entradasAte + row.entradasAte,
        consumoAte: acc.consumoAte + row.consumoAte,
        saldo: acc.saldo + row.saldoPeriodo,
        estoqueSeguranca: acc.estoqueSeguranca + row.estoqueSeguranca,
        excesso: acc.excesso + row.excessoPeriodo,
        valorExcesso: acc.valorExcesso + row.valorExcesso,
      }),
      { itens: 0, estoque: 0, entradasAte: 0, consumoAte: 0, saldo: 0, estoqueSeguranca: 0, excesso: 0, valorExcesso: 0 }
    );
  }, [excessoModalRows]);

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
            <Card label="Compras regra" value={money(totais.valorComprasRegra)} detail={`Qtd ${fmt(totais.comprasRegra)}`} tone="sky" onClick={() => setShowComprasRegraModal(true)} />
            <Card label="Compras fora do plano" value={money(totalForaRegra.valor)} detail={`Qtd ${fmt(totalForaRegra.qtd)} | Apos ${planoAte}`} tone="orange" onClick={totalForaRegra.valor > 0 ? () => setShowComprasForaModal(true) : undefined} />
            <Card label="Compras andamento" value={money(comprasAndamentoGeral.valor)} detail={`Qtd ${fmt(comprasAndamentoGeral.qtd)} | ${comprasAndamentoGeral.itensSemValor} MPs sem valor`} tone="emerald" />
          </div>

          <section className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-xs font-semibold text-brand-dark">Custo do plano por periodo</div>
              <div className="text-[11px] text-gray-500">Custo atual/restante: {money(totais.valorConsumo)}</div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {PERIODOS.map((periodo) => {
                const ativo = periodosSelecionados.includes(periodo);
                const valorOriginal = ativo ? custoPlanoOriginal.valorConsumoPorPeriodo[periodo] : 0;
                const necAcumQtd = ativo ? totais.necessidadeCumulativaPorPeriodo[periodo] : 0;
                const necAcumValor = ativo ? totais.valorNecessidadeCumulativaPorPeriodo[periodo] : 0;
                const necIndividualQtd = ativo ? totais.necessidadeIndividualPorPeriodo[periodo] : 0;
                const necIndividualValor = ativo ? totais.valorNecessidadeIndividualPorPeriodo[periodo] : 0;
                // Excesso
                const valorExcesso = ativo ? totais.valorExcessoPorPeriodo[periodo] : 0;
                // Percentual gerou OP
                const percData = percentualPorPeriodo[periodo];
                const percentualGerouOp = percData?.percentualGerouOp ?? null;
                // Dias faltantes (acumulado)
                const diasFalt = diasFaltantesPorPeriodo[periodo];
                // Dias individual e acumulado
                const diasIndiv = diasCapacidade?.porPeriodo[periodo] ?? null;
                const diasAcum = diasCapacidade?.acumulado[periodo] ?? null;
                return (
                  <div key={periodo} className={`rounded border px-3 py-2 ${ativo ? 'border-stone-300 bg-stone-50' : 'border-gray-200 bg-gray-50 opacity-55'}`}>
                    <div className="text-[11px] font-semibold text-gray-500 mb-1">{periodo}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-sm font-bold text-stone-800">{valorOriginal > 0 ? money(valorOriginal) : '-'}</div>
                        <div className="text-[10px] text-gray-500">Plano</div>
                        <div
                          className={`mt-1 text-xs font-semibold ${valorExcesso > 0 ? 'text-orange-600 cursor-pointer hover:underline' : 'text-gray-400'}`}
                          onClick={valorExcesso > 0 ? () => setExcessoModalPeriodo(periodo) : undefined}
                          title={valorExcesso > 0 ? 'Clique para ver detalhes do excesso' : undefined}
                        >
                          {valorExcesso > 0 ? money(valorExcesso) : '-'}
                        </div>
                        <div className="text-[10px] text-gray-500">Excesso</div>
                      </div>
                      <div>
                        <div className={`text-sm font-bold ${percentualGerouOp !== null ? (percentualGerouOp >= 100 ? 'text-emerald-600' : percentualGerouOp >= 50 ? 'text-amber-600' : 'text-red-600') : 'text-gray-400'}`}>
                          {percentualGerouOp !== null ? `${percentualGerouOp.toFixed(1)}%` : '-'}
                        </div>
                        <div className="text-[10px] text-gray-500">Gerou OP</div>
                        <div className="mt-1 flex gap-1.5 items-baseline">
                          <span className={`text-xs font-semibold ${diasIndiv !== null ? 'text-blue-700' : 'text-gray-400'}`}>
                            {diasIndiv !== null ? `${diasIndiv.toFixed(1)}d` : '-'}
                          </span>
                          <span className={`text-[10px] ${diasAcum !== null ? (diasFalt !== null && diasFalt > 0 ? 'text-red-600' : 'text-emerald-600') : 'text-gray-400'}`}>
                            {diasAcum !== null ? `(${diasAcum.toFixed(1)})` : ''}
                          </span>
                        </div>
                        <div className="text-[10px] text-gray-500">Dias (acum)</div>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 border-t border-stone-200 pt-2">
                      <div className="rounded border border-orange-200 bg-orange-50 px-2 py-1.5">
                        <div className="text-[10px] font-semibold text-orange-700">Nec. total acum</div>
                        <div className="text-xs font-bold text-orange-800">{necAcumValor > 0 ? money(necAcumValor) : '-'}</div>
                        <div className="text-[10px] text-orange-700">Qtd {fmt(necAcumQtd)}</div>
                      </div>
                      <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5">
                        <div className="text-[10px] font-semibold text-red-700">Nec. individual total</div>
                        <div className="text-xs font-bold text-red-800">{necIndividualValor > 0 ? money(necIndividualValor) : '-'}</div>
                        <div className="text-[10px] text-red-700">Qtd {fmt(necIndividualQtd)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-xs font-semibold text-brand-dark">Pecas PA por periodo</div>
              <div className="text-[11px] text-gray-500">Total: {fmt(periodosSelecionados.reduce((acc, p) => acc + (pecasPAOriginalPorPeriodo[p] || 0), 0))} pçs</div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {PERIODOS.map((periodo) => {
                const ativo = periodosSelecionados.includes(periodo);
                const qtdPlano = ativo ? pecasPAOriginalPorPeriodo[periodo] : 0;
                const percData = percentualPorPeriodo[periodo];
                const percentualGerouOp = percData?.percentualGerouOp ?? null;
                const qtdGerouOp = percData?.qtdGerouOp ?? 0;
                const diasIndiv = diasCapacidade?.porPeriodo[periodo] ?? null;
                const diasAcum = diasCapacidade?.acumulado[periodo] ?? null;
                const diasFalt = diasFaltantesPorPeriodo[periodo];
                return (
                  <div key={periodo} className={`rounded border px-3 py-2 ${ativo ? 'border-stone-300 bg-stone-50' : 'border-gray-200 bg-gray-50 opacity-55'}`}>
                    <div className="text-[11px] font-semibold text-gray-500 mb-1">{periodo}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-sm font-bold text-stone-800">{qtdPlano > 0 ? fmt(qtdPlano) : '-'}</div>
                        <div className="text-[10px] text-gray-500">Plano</div>
                        <div className={`mt-1 text-xs font-semibold ${qtdGerouOp > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                          {qtdGerouOp > 0 ? fmt(qtdGerouOp) : '-'}
                        </div>
                        <div className="text-[10px] text-gray-500">Gerou OP</div>
                      </div>
                      <div>
                        <div className={`text-sm font-bold ${percentualGerouOp !== null ? (percentualGerouOp >= 100 ? 'text-emerald-600' : percentualGerouOp >= 50 ? 'text-amber-600' : 'text-red-600') : 'text-gray-400'}`}>
                          {percentualGerouOp !== null ? `${percentualGerouOp.toFixed(1)}%` : '-'}
                        </div>
                        <div className="text-[10px] text-gray-500">% OP</div>
                        <div className="mt-1 flex gap-1.5 items-baseline">
                          <span className={`text-xs font-semibold ${diasIndiv !== null ? 'text-blue-700' : 'text-gray-400'}`}>
                            {diasIndiv !== null ? `${diasIndiv.toFixed(1)}d` : '-'}
                          </span>
                          <span className={`text-[10px] ${diasAcum !== null ? (diasFalt !== null && diasFalt > 0 ? 'text-red-600' : 'text-emerald-600') : 'text-gray-400'}`}>
                            {diasAcum !== null ? `(${diasAcum.toFixed(1)})` : ''}
                          </span>
                        </div>
                        <div className="text-[10px] text-gray-500">Dias (acum)</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Cobertura por periodo - calculado por MP */}
          <section className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-sm font-semibold text-brand-dark">Cobertura por periodo</div>
              <div className="text-xs text-gray-500">
                Cobertura: {money(totalCobertura.totalCobertura)} (Est. {money(totalCobertura.totalCoberturaEstoque)} + Comp. {money(totalCobertura.totalCoberturaCompras)}) | Consumo: {money(totalCobertura.totalConsumo)} | {totalCobertura.totalNecessidade <= 0 ? <span className="text-emerald-600 font-semibold">100% coberto</span> : <span className="text-red-600 font-semibold">Falta {money(totalCobertura.totalNecessidade)}</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {PERIODOS.map((periodo) => {
                const ativo = periodosSelecionados.includes(periodo);
                const cob = coberturaPorPeriodo[periodo];
                const coberto100 = cob.necessidade <= 0;
                const cobertoParcial = cob.coberturaTotal > 0 && cob.necessidade > 0;

                // Dados por categoria de artigo
                const cobBojo = coberturaPorArtigoPorPeriodo.BOJO[periodo];
                const cobAlca = coberturaPorArtigoPorPeriodo.ALCA[periodo];
                const cobDemais = coberturaPorArtigoPorPeriodo.DEMAIS[periodo];

                return (
                  <div key={periodo} className={`rounded border px-3 py-2 ${
                    !ativo ? 'border-gray-200 bg-gray-50 opacity-55' :
                    coberto100 ? 'border-emerald-300 bg-emerald-50' :
                    cobertoParcial ? 'border-amber-300 bg-amber-50' :
                    'border-red-300 bg-red-50'
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs font-semibold text-gray-500">{periodo}</div>
                      {ativo && cob.consumo > 0 && (
                        <div className={`text-xs font-bold uppercase ${
                          coberto100 ? 'text-emerald-600' : cobertoParcial ? 'text-amber-600' : 'text-red-600'
                        }`}>
                          {cob.percentual.toFixed(0)}%
                        </div>
                      )}
                    </div>
                    {ativo && cob.consumo > 0 ? (
                      <>
                        <div className="text-xs text-gray-500 mb-0.5">Consumo: {money(cob.consumo)}</div>
                        <div className="text-xs">
                          <span className="text-slate-500">Est:</span>
                          <span className="ml-1 font-semibold text-slate-700">{money(cob.coberturaEstoque)}</span>
                        </div>
                        {/* Breakdown por artigo */}
                        <div className="mt-2 pt-2 border-t border-gray-200 space-y-1">
                          {cobBojo.consumo > 0 && (
                            <div className="flex justify-between text-[10px]">
                              <span className="text-gray-500">BOJO</span>
                              <span className={`font-semibold ${cobBojo.percentual >= 100 ? 'text-emerald-600' : cobBojo.percentual >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
                                {cobBojo.percentual.toFixed(0)}%
                              </span>
                            </div>
                          )}
                          {cobAlca.consumo > 0 && (
                            <div className="flex justify-between text-[10px]">
                              <span className="text-gray-500">ALCA</span>
                              <span className={`font-semibold ${cobAlca.percentual >= 100 ? 'text-emerald-600' : cobAlca.percentual >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
                                {cobAlca.percentual.toFixed(0)}%
                              </span>
                            </div>
                          )}
                          {cobDemais.consumo > 0 && (
                            <div className="flex justify-between text-[10px]">
                              <span className="text-gray-500">DEMAIS</span>
                              <span className={`font-semibold ${cobDemais.percentual >= 100 ? 'text-emerald-600' : cobDemais.percentual >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
                                {cobDemais.percentual.toFixed(0)}%
                              </span>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="text-gray-400">-</div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* OPs antigas - em processo > 20 dias */}
          {opsAntigas && opsAntigas.qtdTotal > 0 && (
            <div
              className="bg-amber-50 border border-amber-200 rounded-lg p-3 cursor-pointer hover:border-amber-400 hover:shadow-sm transition-all"
              onClick={() => setOpsAntigasModalAberto(true)}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-amber-800">
                    OPs em processo ha mais de 20 dias
                    <span className="ml-2 text-[10px] text-blue-500">(clique p/ detalhes)</span>
                  </div>
                  <div className="text-xl font-bold text-amber-700">{fmt(opsAntigas.qtdTotal)} pecas</div>
                  <div className="text-xs text-amber-600">{opsAntigas.opsCount} OPs paradas</div>
                </div>
                <div className="flex gap-3 text-xs">
                  {Object.entries(opsAntigas.porFaixa).map(([faixa, dados]) => (
                    dados.qtd > 0 && (
                      <div key={faixa} className="text-center px-2 py-1 bg-amber-100 rounded">
                        <div className="font-semibold text-amber-800">{fmt(dados.qtd)}</div>
                        <div className="text-amber-600">{faixa}</div>
                      </div>
                    )
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Mostrar cobertura apenas quando há diferença entre nec.regra e nec.total (ou seja, ha compras futuras) */}
          <section className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-xs font-semibold text-brand-dark">Compras por periodo (horizonte completo)</div>
              <div className="text-[11px] text-gray-500">
                Compras ate {planoAte}: {money(totais.valorComprasRegra)} | Cobertura apos {planoAte}: {money(totais.valorRegra - totais.valorTotal)}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {PERIODOS.map((periodo) => {
                const dentroHorizonte = periodosSelecionados.includes(periodo);
                const valorCompras = totais.valorComprasPorPeriodo[periodo];
                const qtdCompras = totais.comprasPorPeriodo[periodo];

                if (!dentroHorizonte) {
                  const valorCobertura = totais.valorComprasCoberturaPorPeriodo[periodo];
                  const qtdCobertura = totais.comprasCoberturaPorPeriodo[periodo];
                  return (
                    <div key={periodo} className={`rounded border px-3 py-2 ${valorCobertura > 0 ? 'border-amber-400 bg-amber-100' : 'border-gray-200 bg-gray-50 opacity-50'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-[11px] font-semibold text-gray-500">{periodo}</div>
                        <div className="text-[9px] font-bold text-amber-600 uppercase">Cobertura</div>
                      </div>
                      <div className={`text-lg font-bold ${valorCobertura > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{valorCobertura > 0 ? money(valorCobertura) : '-'}</div>
                      <div className="text-[10px] text-gray-500">Qtd {fmt(qtdCobertura)}</div>
                    </div>
                  );
                }

                const valorComprasCum = totais.valorComprasCumulativaPorPeriodo[periodo];
                const qtdComprasCum = totais.comprasCumulativaPorPeriodo[periodo];
                return (
                  <div key={periodo} className="rounded border border-sky-300 bg-sky-50 px-3 py-2">
                    <div className="text-[11px] font-semibold text-gray-500 mb-1">{periodo}</div>
                    <div className="text-sm font-bold text-sky-700">{valorCompras > 0 ? money(valorCompras) : '-'}</div>
                    <div className="text-[10px] text-gray-500">Compra {fmt(qtdCompras)}</div>
                    <div className="mt-1 text-xs font-semibold text-sky-800">{valorComprasCum > 0 ? money(valorComprasCum) : '-'}</div>
                    <div className="text-[10px] text-gray-500">Acum. {fmt(qtdComprasCum)}</div>
                  </div>
                );
              })}
            </div>
            {totais.valorComprasTotal - totais.valorComprasRegra > 0 && (
              <div className="mt-2 p-2 rounded bg-amber-100 border border-amber-300 text-xs text-amber-800">
                <strong>Justificativa:</strong> Nec. regra {money(totais.valorRegra)} - Nec. total {money(totais.valorTotal)} = {money(totais.valorRegra - totais.valorTotal)} em compras que chegam apos {planoAte}
              </div>
            )}
          </section>

          {totais.valorRegra - totais.valorTotal > 0 && planoAte !== 'QU' && (
            <section className="bg-amber-50 rounded-lg border border-amber-300 p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="text-xs font-semibold text-amber-800">Cobertura apos {planoAte} (justifica diferenca nec.regra vs nec.total)</div>
                <div className="text-[11px] font-bold text-amber-700">Total: {money(totais.valorRegra - totais.valorTotal)}</div>
              </div>
              <div className="text-[11px] text-amber-700 mb-2">
                Nec. regra {money(totais.valorRegra)} - Nec. total {money(totais.valorTotal)} = <strong>{money(totais.valorRegra - totais.valorTotal)}</strong> em compras que chegam apos {planoAte}:
              </div>
              <div className="space-y-1.5">
                {resumoPedidosCoberturaFutura.length === 0 ? (
                  <div className="rounded border border-amber-200 bg-white px-3 py-2 text-xs text-amber-700">
                    Nenhum pedido detalhado encontrado para essa cobertura.
                  </div>
                ) : resumoPedidosCoberturaFutura.map((item) => (
                  <div key={item.periodo} className="grid grid-cols-[44px_1fr_1fr_120px] gap-3 rounded border border-amber-200 bg-white px-3 py-2 text-xs items-start">
                    <div className="font-bold text-amber-800">{item.periodo}</div>
                    <div className="text-gray-700">
                      <span className="font-semibold text-gray-500">Datas: </span>
                      {item.datas.join(', ')}
                    </div>
                    <div className="text-gray-700">
                      <span className="font-semibold text-gray-500">Pedidos: </span>
                      {item.pedidos.join(', ')}
                    </div>
                    <div className="text-right font-mono font-bold text-amber-800">{money(item.valor)}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

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

              {/* Indicador de alteração e botões de versionamento */}
              <div className="mt-5 flex items-center gap-3">
                {(() => {
                  const totalOriginal = PERIODOS.reduce((acc, p) => acc + (custoPlanoOriginal?.valorConsumoPorPeriodo?.[p] || 0), 0);
                  const totalAtual = PERIODOS.reduce((acc, p) => acc + (coberturaPorPeriodo?.[p]?.consumo || 0), 0);
                  const diferenca = totalAtual - totalOriginal;
                  const temDiferenca = Math.abs(diferenca) > 100;
                  return (
                    <>
                      {temDiferenca && (
                        <div className={`px-3 py-1.5 rounded-full text-xs font-semibold ${diferenca > 0 ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-blue-100 text-blue-800 border border-blue-300'}`}>
                          {diferenca > 0 ? '+' : ''}{money(diferenca)} vs original
                        </div>
                      )}
                    </>
                  );
                })()}
                <button
                  type="button"
                  onClick={() => setSnapshotModalAberto(true)}
                  className="inline-flex items-center gap-1.5 rounded border border-emerald-500 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  <Save size={14} />
                  Salvar Versao
                </button>
                <button
                  type="button"
                  onClick={() => setSnapshotsModalAberto(true)}
                  className="inline-flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  <History size={14} />
                  Historico ({snapshots.length})
                </button>
              </div>

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

          {showComprasRegraModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
              <div className="w-full max-w-6xl max-h-[90vh] overflow-hidden rounded-lg bg-white shadow-xl border border-gray-200">
                <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
                  <div>
                    <div className="text-sm font-bold text-brand-dark">Compras regra - Pedidos ate {planoAte}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      Pedidos que chegam dentro do horizonte selecionado ({periodosLabel})
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowComprasRegraModal(false)}
                    className="rounded border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Fechar
                  </button>
                </div>

                <div className="overflow-auto p-5 space-y-4" style={{ maxHeight: 'calc(90vh - 80px)' }}>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <InfoCard label="Total compras regra" value={money(totais.valorComprasRegra)} detail={`Qtd ${fmt(totais.comprasRegra)}`} tone="sky" />
                    {resumoComprasRegraPorPeriodo.map((item) => (
                      <InfoCard
                        key={item.periodo}
                        label={`Compras ${item.periodo}`}
                        value={money(item.valor)}
                        detail={`Qtd ${fmt(item.quantidade)} | ${item.pedidosCount} pedidos`}
                        tone="sky"
                      />
                    ))}
                  </div>

                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                      <span className="text-xs font-semibold text-brand-dark">Detalhamento de todos os pedidos</span>
                      <span className="text-[11px] text-gray-500">{pedidosComprasRegra.length} linhas</span>
                    </div>
                    <div className="overflow-auto" style={{ maxHeight: '50vh' }}>
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-100 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left">Periodo</th>
                            <th className="px-3 py-2 text-left">Pedido</th>
                            <th className="px-3 py-2 text-left">Empresa</th>
                            <th className="px-3 py-2 text-left">Data prevista</th>
                            <th className="px-3 py-2 text-left">MP</th>
                            <th className="px-3 py-2 text-left">Nome</th>
                            <th className="px-3 py-2 text-left">Artigo</th>
                            <th className="px-3 py-2 text-right">Quantidade</th>
                            <th className="px-3 py-2 text-right">Valor unit.</th>
                            <th className="px-3 py-2 text-right">Valor total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pedidosComprasRegra.map((item, idx) => (
                            <tr key={`${item.pedido}-${item.mp}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} border-t border-gray-100`}>
                              <td className="px-3 py-2 font-semibold text-sky-700">{item.periodo}</td>
                              <td className="px-3 py-2 font-semibold text-gray-700">{item.pedido}</td>
                              <td className="px-3 py-2 text-gray-600">{item.empresa}</td>
                              <td className="px-3 py-2 text-gray-600">{dateBR(item.data)}</td>
                              <td className="px-3 py-2 text-gray-700">{item.mp}</td>
                              <td className="px-3 py-2 text-gray-600 truncate max-w-[200px]" title={item.nome}>{item.nome}</td>
                              <td className="px-3 py-2 text-gray-600">{item.artigo}</td>
                              <td className="px-3 py-2 text-right">{fmt(item.quantidade)}</td>
                              <td className="px-3 py-2 text-right">{item.valorUnitario > 0 ? money(item.valorUnitario) : '-'}</td>
                              <td className="px-3 py-2 text-right font-semibold">{money(item.valor)}</td>
                            </tr>
                          ))}
                          {pedidosComprasRegra.length === 0 && (
                            <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-500">Nenhum pedido encontrado dentro do horizonte selecionado.</td></tr>
                          )}
                        </tbody>
                        {pedidosComprasRegra.length > 0 && (
                          <tfoot className="bg-sky-100 font-semibold sticky bottom-0">
                            <tr>
                              <td className="px-3 py-2" colSpan={7}>TOTAL</td>
                              <td className="px-3 py-2 text-right">{fmt(pedidosComprasRegra.reduce((acc, item) => acc + item.quantidade, 0))}</td>
                              <td className="px-3 py-2 text-right">-</td>
                              <td className="px-3 py-2 text-right">{money(pedidosComprasRegra.reduce((acc, item) => acc + item.valor, 0))}</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {showComprasForaModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
              <div className="w-full max-w-6xl max-h-[90vh] overflow-hidden rounded-lg bg-white shadow-xl border border-gray-200">
                <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
                  <div>
                    <div className="text-sm font-bold text-brand-dark">Compras FORA da regra - Pedidos apos {planoAte}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      Pedidos que chegam DEPOIS do horizonte selecionado (apos {planoAte})
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowComprasForaModal(false)}
                    className="rounded border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Fechar
                  </button>
                </div>

                <div className="overflow-auto p-5 space-y-4" style={{ maxHeight: 'calc(90vh - 80px)' }}>
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                    <InfoCard label="Total fora do plano" value={money(totalForaRegra.valor)} detail={`Qtd ${fmt(totalForaRegra.qtd)}`} tone="orange" />
                    {resumoComprasForaPorPeriodo.map((item) => (
                      <InfoCard
                        key={item.periodo}
                        label={`Compras ${item.periodo}`}
                        value={money(item.valor)}
                        detail={`Qtd ${fmt(item.quantidade)} | ${item.pedidosCount} pedidos`}
                        tone="orange"
                      />
                    ))}
                  </div>

                  <div className="p-3 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800">
                    <strong>Entendendo:</strong> Esses pedidos estao em andamento mas chegam DEPOIS do periodo {planoAte}.
                    Por isso a diferenca entre &quot;Compras regra&quot; ({money(totais.valorComprasRegra)}) e &quot;Compras andamento&quot; ({money(comprasAndamentoGeral.valor)}) = {money(totalForaRegra.valor)}
                  </div>

                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                      <span className="text-xs font-semibold text-brand-dark">Detalhamento dos pedidos fora do plano</span>
                      <span className="text-[11px] text-gray-500">{pedidosForaRegra.length} linhas</span>
                    </div>
                    <div className="overflow-auto" style={{ maxHeight: '50vh' }}>
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-100 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left">Periodo</th>
                            <th className="px-3 py-2 text-left">Pedido</th>
                            <th className="px-3 py-2 text-left">Empresa</th>
                            <th className="px-3 py-2 text-left">Data prevista</th>
                            <th className="px-3 py-2 text-left">MP</th>
                            <th className="px-3 py-2 text-left">Nome</th>
                            <th className="px-3 py-2 text-left">Artigo</th>
                            <th className="px-3 py-2 text-right">Quantidade</th>
                            <th className="px-3 py-2 text-right">Valor unit.</th>
                            <th className="px-3 py-2 text-right">Valor total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pedidosForaRegra.map((item, idx) => (
                            <tr key={`${item.pedido}-${item.mp}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} border-t border-gray-100`}>
                              <td className="px-3 py-2 font-semibold text-orange-700">{item.periodo}</td>
                              <td className="px-3 py-2 font-semibold text-gray-700">{item.pedido}</td>
                              <td className="px-3 py-2 text-gray-600">{item.empresa}</td>
                              <td className="px-3 py-2 text-gray-600">{dateBR(item.data)}</td>
                              <td className="px-3 py-2 text-gray-700">{item.mp}</td>
                              <td className="px-3 py-2 text-gray-600 truncate max-w-[200px]" title={item.nome}>{item.nome}</td>
                              <td className="px-3 py-2 text-gray-600">{item.artigo}</td>
                              <td className="px-3 py-2 text-right">{fmt(item.quantidade)}</td>
                              <td className="px-3 py-2 text-right">{item.valorUnitario > 0 ? money(item.valorUnitario) : '-'}</td>
                              <td className="px-3 py-2 text-right font-semibold">{money(item.valor)}</td>
                            </tr>
                          ))}
                          {pedidosForaRegra.length === 0 && (
                            <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-500">Nenhum pedido encontrado fora do plano selecionado.</td></tr>
                          )}
                        </tbody>
                        {pedidosForaRegra.length > 0 && (
                          <tfoot className="bg-orange-100 font-semibold sticky bottom-0">
                            <tr>
                              <td className="px-3 py-2" colSpan={7}>TOTAL</td>
                              <td className="px-3 py-2 text-right">{fmt(pedidosForaRegra.reduce((acc, item) => acc + item.quantidade, 0))}</td>
                              <td className="px-3 py-2 text-right">-</td>
                              <td className="px-3 py-2 text-right">{money(pedidosForaRegra.reduce((acc, item) => acc + item.valor, 0))}</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {excessoModalPeriodo && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
              <div className="w-full max-w-7xl max-h-[90vh] overflow-hidden rounded-lg bg-white shadow-xl border border-gray-200">
                <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
                  <div>
                    <div className="text-sm font-bold text-brand-dark">Excesso MP - Periodo ate {excessoModalPeriodo}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      Calculo: Estoque + Entradas ate {excessoModalPeriodo} - Consumo ate {excessoModalPeriodo} = Saldo - Est. Seguranca = <span className="font-semibold text-orange-600">Excesso</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setExcessoModalPeriodo(null); setExcessoArtigosExpandidos(new Set()); }}
                    className="rounded border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Fechar
                  </button>
                </div>

                <div className="overflow-auto p-5 space-y-4" style={{ maxHeight: 'calc(90vh - 80px)' }}>
                  {/* Cards resumo com cálculo explicado */}
                  <div className="grid grid-cols-2 md:grid-cols-7 gap-2 text-center">
                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-2">
                      <div className="text-[10px] text-gray-500">Estoque</div>
                      <div className="text-sm font-bold text-slate-700">{fmt(excessoModalTotais.estoque)}</div>
                    </div>
                    <div className="flex items-center justify-center text-lg text-gray-400">+</div>
                    <div className="rounded border border-sky-200 bg-sky-50 px-2 py-2">
                      <div className="text-[10px] text-gray-500">Entradas ate {excessoModalPeriodo}</div>
                      <div className="text-sm font-bold text-sky-700">{fmt(excessoModalTotais.entradasAte)}</div>
                    </div>
                    <div className="flex items-center justify-center text-lg text-gray-400">-</div>
                    <div className="rounded border border-red-200 bg-red-50 px-2 py-2">
                      <div className="text-[10px] text-gray-500">Consumo ate {excessoModalPeriodo}</div>
                      <div className="text-sm font-bold text-red-700">{fmt(excessoModalTotais.consumoAte)}</div>
                    </div>
                    <div className="flex items-center justify-center text-lg text-gray-400">=</div>
                    <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-2">
                      <div className="text-[10px] text-gray-500">Saldo</div>
                      <div className="text-sm font-bold text-emerald-700">{fmt(excessoModalTotais.saldo)}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-center">
                    <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-2">
                      <div className="text-[10px] text-gray-500">Saldo</div>
                      <div className="text-sm font-bold text-emerald-700">{fmt(excessoModalTotais.saldo)}</div>
                    </div>
                    <div className="flex items-center justify-center text-lg text-gray-400">-</div>
                    <div className="rounded border border-gray-200 bg-gray-50 px-2 py-2">
                      <div className="text-[10px] text-gray-500">Est. Seguranca (5d)</div>
                      <div className="text-sm font-bold text-gray-700">{fmt(excessoModalTotais.estoqueSeguranca)}</div>
                    </div>
                    <div className="flex items-center justify-center text-lg text-gray-400">=</div>
                    <div className="rounded border border-orange-300 bg-orange-100 px-2 py-2">
                      <div className="text-[10px] text-gray-500">EXCESSO</div>
                      <div className="text-sm font-bold text-orange-700">{fmt(excessoModalTotais.excesso)}</div>
                      <div className="text-[10px] text-orange-600 font-semibold">{money(excessoModalTotais.valorExcesso)}</div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                      <span className="text-xs font-semibold text-brand-dark">Excesso por Artigo - {excessoModalPorArtigo.length} artigos ({excessoModalTotais.itens} MPs)</span>
                      <span className="text-[11px] text-gray-500">Clique no artigo para ver MPs</span>
                    </div>
                    <div className="overflow-auto" style={{ maxHeight: '45vh' }}>
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-100 sticky top-0 z-10">
                          <tr>
                            <th className="px-3 py-2 text-left w-8"></th>
                            <th className="px-3 py-2 text-left">Artigo</th>
                            <th className="px-3 py-2 text-right">Estoque</th>
                            <th className="px-3 py-2 text-right text-sky-700">+ Entradas</th>
                            <th className="px-3 py-2 text-right text-red-700">- Consumo</th>
                            <th className="px-3 py-2 text-right text-emerald-700">= Saldo</th>
                            <th className="px-3 py-2 text-right">- Est.Seg</th>
                            <th className="px-3 py-2 text-right text-orange-700">= Excesso</th>
                            <th className="px-3 py-2 text-right">Valor Excesso</th>
                          </tr>
                        </thead>
                        <tbody>
                          {excessoModalPorArtigo.map((art, artIdx) => {
                            const isExpanded = excessoArtigosExpandidos.has(art.artigo);
                            return (
                              <React.Fragment key={art.artigo}>
                                <tr
                                  className={`${artIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} border-t border-gray-200 cursor-pointer hover:bg-orange-50`}
                                  onClick={() => {
                                    setExcessoArtigosExpandidos(prev => {
                                      const next = new Set(prev);
                                      if (next.has(art.artigo)) next.delete(art.artigo);
                                      else next.add(art.artigo);
                                      return next;
                                    });
                                  }}
                                >
                                  <td className="px-3 py-2 text-center">
                                    <span className={`inline-block transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                                  </td>
                                  <td className="px-3 py-2 font-semibold text-gray-800">{art.artigo} <span className="text-[10px] text-gray-400 font-normal">({art.mps.length} MPs)</span></td>
                                  <td className="px-3 py-2 text-right">{fmt(art.estoque)}</td>
                                  <td className="px-3 py-2 text-right text-sky-600">{fmt(art.entradasAte)}</td>
                                  <td className="px-3 py-2 text-right text-red-600">{fmt(art.consumoAte)}</td>
                                  <td className="px-3 py-2 text-right text-emerald-600 font-semibold">{fmt(art.saldo)}</td>
                                  <td className="px-3 py-2 text-right text-gray-500">{fmt(art.estoqueSeguranca)}</td>
                                  <td className="px-3 py-2 text-right font-bold text-orange-600">{fmt(art.excesso)}</td>
                                  <td className="px-3 py-2 text-right font-bold text-orange-700">{money(art.valorExcesso)}</td>
                                </tr>
                                {isExpanded && art.mps.map((mp, mpIdx) => (
                                  <tr key={mp.idmateriaprima} className="bg-orange-50/50 border-t border-orange-100">
                                    <td className="px-3 py-1.5"></td>
                                    <td className="px-3 py-1.5 pl-6">
                                      <span className="text-gray-600">{mp.idmateriaprima}</span>
                                      <span className="ml-2 text-[10px] text-gray-400 truncate" title={mp.nome_materiaprima}>{(mp.nome_materiaprima || '').substring(0, 30)}</span>
                                    </td>
                                    <td className="px-3 py-1.5 text-right text-gray-600">{fmt(mp.estoque)}</td>
                                    <td className="px-3 py-1.5 text-right text-sky-500">{fmt(mp.entradasAte)}</td>
                                    <td className="px-3 py-1.5 text-right text-red-500">{fmt(mp.consumoAte)}</td>
                                    <td className="px-3 py-1.5 text-right text-emerald-500">{fmt(mp.saldoPeriodo)}</td>
                                    <td className="px-3 py-1.5 text-right text-gray-400">{fmt(mp.estoqueSeguranca)}</td>
                                    <td className="px-3 py-1.5 text-right text-orange-500">{fmt(mp.excessoPeriodo)}</td>
                                    <td className="px-3 py-1.5 text-right text-orange-600">{money(mp.valorExcesso)}</td>
                                  </tr>
                                ))}
                              </React.Fragment>
                            );
                          })}
                          {excessoModalPorArtigo.length === 0 && (
                            <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-500">Nenhum artigo com excesso neste periodo.</td></tr>
                          )}
                        </tbody>
                        {excessoModalPorArtigo.length > 0 && (
                          <tfoot className="bg-orange-100 font-semibold sticky bottom-0">
                            <tr>
                              <td className="px-3 py-2"></td>
                              <td className="px-3 py-2">TOTAL ({excessoModalPorArtigo.length} artigos)</td>
                              <td className="px-3 py-2 text-right">{fmt(excessoModalTotais.estoque)}</td>
                              <td className="px-3 py-2 text-right text-sky-700">{fmt(excessoModalTotais.entradasAte)}</td>
                              <td className="px-3 py-2 text-right text-red-700">{fmt(excessoModalTotais.consumoAte)}</td>
                              <td className="px-3 py-2 text-right text-emerald-700">{fmt(excessoModalTotais.saldo)}</td>
                              <td className="px-3 py-2 text-right">{fmt(excessoModalTotais.estoqueSeguranca)}</td>
                              <td className="px-3 py-2 text-right text-orange-600">{fmt(excessoModalTotais.excesso)}</td>
                              <td className="px-3 py-2 text-right text-orange-700">{money(excessoModalTotais.valorExcesso)}</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Modal detalhamento OPs antigas */}
          {opsAntigasModalAberto && opsAntigas && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
              <div className="w-full max-w-lg max-h-[90vh] overflow-hidden rounded-lg bg-white shadow-xl border border-gray-200">
                <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 bg-amber-50">
                  <div>
                    <div className="text-sm font-bold text-amber-800">OPs em processo ha mais de 20 dias - Detalhamento</div>
                    <div className="mt-1 text-xs text-amber-700">
                      {opsAntigas.opsCount} OPs com {fmt(opsAntigas.qtdTotal)} pecas paradas
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpsAntigasModalAberto(false)}
                    className="rounded border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                  >
                    Fechar
                  </button>
                </div>

                <div className="overflow-auto p-4 space-y-3" style={{ maxHeight: 'calc(90vh - 80px)' }}>
                  <div className="grid grid-cols-4 gap-2">
                    {Object.entries(opsAntigas.porFaixa).map(([faixa, dados]) => (
                      dados.qtd > 0 && (
                        <div key={faixa} className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-center">
                          <div className="text-[10px] text-amber-600">{faixa}</div>
                          <div className="text-sm font-bold text-amber-700">{fmt(dados.qtd)}</div>
                          <div className="text-[10px] text-amber-600">{dados.ops} OPs</div>
                        </div>
                      )
                    ))}
                  </div>

                  <div className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                      <span className="text-xs font-semibold text-brand-dark">Lista de OPs paradas</span>
                      <span className="text-[11px] text-gray-500">{opsAntigas.data.length} OPs</span>
                    </div>
                    <div className="overflow-auto" style={{ maxHeight: '55vh' }}>
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-100 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left">OP</th>
                            <th className="px-3 py-2 text-right">Dias</th>
                            <th className="px-3 py-2 text-right">Quantidade</th>
                          </tr>
                        </thead>
                        <tbody>
                          {opsAntigas.data.map((op, idx) => {
                            const diasClass = op.diasEmProcesso > 60
                              ? 'text-red-700 font-bold'
                              : op.diasEmProcesso > 40
                                ? 'text-orange-700 font-semibold'
                                : 'text-amber-700';
                            return (
                              <tr key={`${op.nrOp}-${op.nrCiclo}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} border-t border-gray-100`}>
                                <td className="px-3 py-2 font-semibold text-gray-700">{op.nrOp}</td>
                                <td className={`px-3 py-2 text-right ${diasClass}`}>{op.diasEmProcesso}</td>
                                <td className="px-3 py-2 text-right font-semibold text-amber-700">{fmt(op.qtdEmProcesso)}</td>
                              </tr>
                            );
                          })}
                          {opsAntigas.data.length === 0 && (
                            <tr><td colSpan={3} className="px-3 py-8 text-center text-gray-500">Nenhuma OP encontrada.</td></tr>
                          )}
                        </tbody>
                        {opsAntigas.data.length > 0 && (
                          <tfoot className="bg-amber-100 font-semibold sticky bottom-0">
                            <tr>
                              <td className="px-3 py-2">TOTAL ({opsAntigas.data.length} OPs)</td>
                              <td className="px-3 py-2 text-right">-</td>
                              <td className="px-3 py-2 text-right text-amber-700">{fmt(opsAntigas.data.reduce((acc, op) => acc + op.qtdEmProcesso, 0))}</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Modal salvar versão */}
          {snapshotModalAberto && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
              <div className="w-full max-w-md rounded-lg bg-white shadow-xl border border-gray-200">
                <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                  <div className="text-sm font-bold text-brand-dark">Salvar Versao do Orcamento</div>
                  <button type="button" onClick={() => setSnapshotModalAberto(false)} className="text-gray-400 hover:text-gray-600">&times;</button>
                </div>
                <div className="px-5 py-4">
                  <label className="block text-xs font-semibold text-gray-700 mb-2">
                    Descricao da versao
                    <input
                      type="text"
                      value={snapshotDescricao}
                      onChange={(e) => setSnapshotDescricao(e.target.value)}
                      placeholder="Ex: Versao inicial, Ajuste pos-reuniao, etc."
                      className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm font-normal"
                      autoFocus
                    />
                  </label>
                  <div className="mt-4 text-xs text-gray-500">
                    <div>Total Plano Original: {money(PERIODOS.reduce((acc, p) => acc + (custoPlanoOriginal?.valorConsumoPorPeriodo?.[p] || 0), 0))}</div>
                    <div>Total Plano Atual: {money(PERIODOS.reduce((acc, p) => acc + (coberturaPorPeriodo?.[p]?.consumo || 0), 0))}</div>
                    <div>MPs: {rowsCalculadas.length} | SKUs: {rowsBase.length}</div>
                  </div>
                </div>
                <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
                  <button type="button" onClick={() => setSnapshotModalAberto(false)} className="px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 rounded">Cancelar</button>
                  <button
                    type="button"
                    onClick={salvarSnapshot}
                    disabled={salvandoSnapshot || !snapshotDescricao.trim()}
                    className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded disabled:opacity-50"
                  >
                    {salvandoSnapshot ? 'Salvando...' : 'Salvar Versao'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal historico de versões */}
          {snapshotsModalAberto && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
              <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-lg bg-white shadow-xl border border-gray-200">
                <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                  <div className="text-sm font-bold text-brand-dark">Historico de Versoes do Orcamento</div>
                  <button type="button" onClick={() => { setSnapshotsModalAberto(false); setComparacaoSnapshot(null); setSnapshotComparando(null); }} className="text-gray-400 hover:text-gray-600">&times;</button>
                </div>
                <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">
                  {snapshots.length === 0 ? (
                    <div className="text-center text-gray-500 py-8">Nenhuma versao salva ainda.</div>
                  ) : (
                    <div className="space-y-2">
                      {snapshots.map((snap, idx) => (
                        <div key={snap.id} className={`flex items-center justify-between gap-4 p-3 rounded border ${snapshotComparando?.idA === snap.id || snapshotComparando?.idB === snap.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
                          <div className="flex-1">
                            <div className="font-semibold text-sm text-gray-800">{snap.descricao}</div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {new Date(snap.createdAt).toLocaleString('pt-BR')} | {snap.qtdMps} MPs | {snap.qtdSkus} SKUs
                            </div>
                            <div className="text-xs mt-1">
                              <span className="text-gray-600">Plano: </span>
                              <span className="font-semibold">{money(snap.totalPlanoAtual)}</span>
                              {snap.totalDiferenca !== 0 && (
                                <span className={`ml-2 ${snap.totalDiferenca > 0 ? 'text-amber-600' : 'text-blue-600'}`}>
                                  ({snap.totalDiferenca > 0 ? '+' : ''}{money(snap.totalDiferenca)} vs original)
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => verDetalhesSnapshot(snap.id)}
                              disabled={carregandoDetalhe}
                              className="p-1.5 rounded text-emerald-600 hover:bg-emerald-100 disabled:opacity-50"
                              title="Ver detalhes item a item"
                            >
                              <Eye size={16} />
                            </button>
                            {idx > 0 && (
                              <button
                                type="button"
                                onClick={() => compararSnapshots(snapshots[idx].id, snapshots[0].id)}
                                className="p-1.5 rounded text-blue-600 hover:bg-blue-100"
                                title="Comparar com versao mais recente"
                              >
                                <GitCompare size={16} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => excluirSnapshot(snap.id)}
                              className="p-1.5 rounded text-red-500 hover:bg-red-100"
                              title="Excluir versao"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Resultado da comparação */}
                  {comparacaoSnapshot && (
                    <div className="mt-6 p-4 rounded border border-blue-200 bg-blue-50">
                      <div className="text-sm font-bold text-blue-800 mb-3">Comparacao de Versoes</div>
                      <div className="grid grid-cols-2 gap-4 text-xs">
                        <div>
                          <div className="font-semibold text-gray-700">{comparacaoSnapshot.snapshotA?.descricao || 'Versao A'}</div>
                          <div className="text-gray-500">{money(comparacaoSnapshot.snapshotA?.totalPlanoAtual || 0)}</div>
                        </div>
                        <div>
                          <div className="font-semibold text-gray-700">{comparacaoSnapshot.snapshotB?.descricao || 'Versao B'}</div>
                          <div className="text-gray-500">{money(comparacaoSnapshot.snapshotB?.totalPlanoAtual || 0)}</div>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-blue-200">
                        <div className={`text-lg font-bold ${(comparacaoSnapshot.comparacao?.diferencaTotal || 0) > 0 ? 'text-amber-700' : 'text-blue-700'}`}>
                          Diferenca: {(comparacaoSnapshot.comparacao?.diferencaTotal || 0) > 0 ? '+' : ''}{money(comparacaoSnapshot.comparacao?.diferencaTotal || 0)}
                        </div>
                        <div className="mt-2 text-xs text-gray-600">
                          MPs adicionadas: {comparacaoSnapshot.comparacao?.mpsAdicionadas || 0} |
                          MPs removidas: {comparacaoSnapshot.comparacao?.mpsRemovidas || 0} |
                          MPs alteradas: {comparacaoSnapshot.comparacao?.mpsAlteradas || 0}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Modal de Detalhes do Snapshot */}
          {snapshotDetalheAberto && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
              <div className="w-full max-w-6xl max-h-[95vh] overflow-hidden rounded-lg bg-white shadow-xl border border-gray-200 flex flex-col">
                <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 bg-emerald-50">
                  <div>
                    <div className="text-sm font-bold text-emerald-800">{snapshotDetalheAberto.descricao}</div>
                    <div className="text-xs text-emerald-600 mt-0.5">
                      {new Date(snapshotDetalheAberto.createdAt).toLocaleString('pt-BR')} |
                      Total: {money(snapshotDetalheAberto.totalPlanoAtual)}
                      {snapshotDetalheAberto.totalDiferenca !== 0 && (
                        <span className={snapshotDetalheAberto.totalDiferenca > 0 ? 'text-amber-600' : 'text-blue-600'}>
                          {' '}({snapshotDetalheAberto.totalDiferenca > 0 ? '+' : ''}{money(snapshotDetalheAberto.totalDiferenca)} vs original)
                        </span>
                      )}
                    </div>
                  </div>
                  <button type="button" onClick={() => setSnapshotDetalheAberto(null)} className="p-1.5 rounded hover:bg-emerald-100">
                    <X size={20} className="text-emerald-700" />
                  </button>
                </div>
                <div className="flex-1 overflow-auto p-4">
                  <div className="text-xs text-gray-500 mb-2">{snapshotDetalheAberto.detalhesMps?.length || 0} MPs com consumo/necessidade</div>
                  <table className="w-full text-xs">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        <th className="text-left p-2 font-semibold">MP</th>
                        <th className="text-left p-2 font-semibold">Nome</th>
                        <th className="text-left p-2 font-semibold">Cor</th>
                        <th className="text-left p-2 font-semibold">Artigo</th>
                        <th className="text-right p-2 font-semibold">Estoque</th>
                        <th className="text-right p-2 font-semibold">Consumo</th>
                        <th className="text-right p-2 font-semibold">R$ Consumo</th>
                        <th className="text-right p-2 font-semibold">Necessidade</th>
                        <th className="text-right p-2 font-semibold">R$ Necessidade</th>
                        <th className="text-right p-2 font-semibold">Compras</th>
                        <th className="text-right p-2 font-semibold">R$ Compras</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(snapshotDetalheAberto.detalhesMps || []).map((mp, idx) => (
                        <tr key={mp.idmp} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="p-2 font-mono">{mp.idmp}</td>
                          <td className="p-2 truncate max-w-[200px]" title={mp.nome}>{mp.nome}</td>
                          <td className="p-2">{mp.cor}</td>
                          <td className="p-2">{mp.artigo}</td>
                          <td className="p-2 text-right">{fmt(mp.estoque)}</td>
                          <td className="p-2 text-right">{fmt(mp.consumoQtd)}</td>
                          <td className="p-2 text-right text-emerald-700">{money(mp.valorConsumo)}</td>
                          <td className="p-2 text-right">{fmt(mp.necessidadeRegra)}</td>
                          <td className="p-2 text-right text-amber-700">{money(mp.valorNecessidadeRegra)}</td>
                          <td className="p-2 text-right">{fmt(mp.comprasRegra)}</td>
                          <td className="p-2 text-right text-blue-700">{money(mp.valorComprasRegra)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(!snapshotDetalheAberto.detalhesMps || snapshotDetalheAberto.detalhesMps.length === 0) && (
                    <div className="text-center text-gray-500 py-8">
                      Esta versao nao possui detalhes de MPs salvos.<br />
                      <span className="text-xs">Versoes antigas podem nao ter os detalhes completos.</span>
                    </div>
                  )}
                </div>
                <div className="border-t border-gray-200 px-5 py-3 bg-gray-50 flex justify-between items-center">
                  <div className="text-xs text-gray-500">
                    Totais: Consumo {money(snapshotDetalheAberto.detalhesMps?.reduce((s, m) => s + (m.valorConsumo || 0), 0) || 0)} |
                    Necessidade {money(snapshotDetalheAberto.detalhesMps?.reduce((s, m) => s + (m.valorNecessidadeRegra || 0), 0) || 0)} |
                    Compras {money(snapshotDetalheAberto.detalhesMps?.reduce((s, m) => s + (m.valorComprasRegra || 0), 0) || 0)}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSnapshotDetalheAberto(null)}
                    className="px-4 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Card({ label, value, detail, tone, onClick }: { label: string; value: string; detail: string; tone: 'red' | 'orange' | 'sky' | 'emerald' | 'stone' | 'slate'; onClick?: () => void }) {
  const cls = {
    red: 'text-red-700',
    orange: 'text-orange-700',
    sky: 'text-sky-700',
    emerald: 'text-emerald-700',
    stone: 'text-stone-800',
    slate: 'text-slate-700',
  }[tone];
  const clickable = !!onClick;
  return (
    <div
      className={`bg-white rounded-lg border border-gray-200 p-3 ${clickable ? 'cursor-pointer hover:border-gray-400 hover:shadow-sm transition-all' : ''}`}
      onClick={onClick}
    >
      <div className="text-xs text-gray-500">{label}{clickable && <span className="ml-1 text-[10px] text-blue-500">(clique)</span>}</div>
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

function InfoCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: 'orange' | 'sky' | 'slate' }) {
  const bgClass = tone === 'orange' ? 'border-orange-200 bg-orange-50' : tone === 'sky' ? 'border-sky-200 bg-sky-50' : tone === 'slate' ? 'border-slate-200 bg-slate-50' : 'border-gray-200 bg-gray-50';
  const textClass = tone === 'orange' ? 'text-orange-700' : tone === 'sky' ? 'text-sky-700' : tone === 'slate' ? 'text-slate-700' : 'text-gray-900';
  return (
    <div className={`rounded border px-3 py-2 ${bgClass}`}>
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${textClass}`}>{value}</div>
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
