'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { Planejamento } from '../types';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MARCA_FIXA = 'LIEBE';
const STATUS_FIXO = 'EM LINHA,NOVA COLECAO';

type PeriodoCompra = 'MA' | 'PX' | 'UL' | 'QT' | 'QU' | 'ATE_QU';
type PeriodoPlano = 'MA' | 'PX' | 'UL' | 'QT' | 'QU';
const PERIODOS_PLANO: PeriodoPlano[] = ['MA', 'PX', 'UL', 'QT', 'QU'];

type MpRow = {
  idmateriaprima: string;
  nome_materiaprima?: string;
  artigo?: string;
  cd_fornecedor?: string;
  nm_fornecedor?: string;
  cd_original_fornecedor?: string;
  in_fornecedor_padrao?: string;
  estoquetotal: number;
  entrada_ma?: number;
  entrada_px?: number;
  entrada_ul?: number;
  entrada_qt?: number;
  entrada_qu?: number;
  entrada_andamento?: number;
  entrada_fora_horizonte?: number;
  entrada_fora_prazo_ma?: number;
  finalizado_ma?: number;
  finalizado_px?: number;
  finalizado_ul?: number;
  finalizado_qt?: number;
  finalizado_qu?: number;
  valor_finalizado_ma?: number;
  valor_finalizado_px?: number;
  valor_finalizado_ul?: number;
  valor_finalizado_qt?: number;
  valor_finalizado_qu?: number;
  consumo_ma?: number;
  consumo_px?: number;
  consumo_ul?: number;
  consumo_qt?: number;
  consumo_qu?: number;
  consumo_total: number;
  saldo_ma: number;
  saldo_px: number;
  saldo_ul: number;
  saldo_qt?: number;
  saldo_qu?: number;
  pedidos_detalhe?: PedidoCompraDetalhe[];
  finalizados_detalhe?: PedidoCompraDetalhe[];
};

type PedidoCompraDetalhe = {
  empresa?: number | string;
  pedido?: number | string;
  data?: string;
  quantidade?: number;
  valor?: number;
  periodo?: string;
  data_base?: string;
  dataRegra?: string;
  diasDiferenca?: number;
  dentroRegra?: boolean;
};

type CompraRow = {
  idmateriaprima: string;
  nome: string;
  artigo: string;
  cdFornecedor: string;
  fornecedor: string;
  codigoFornecedor: string;
  estoque: number;
  entradas: number;
  entradasAndamento: number;
  entradasForaPrazo: number;
  entradasForaHorizonte: number;
  pedidosDetalhe: PedidoCompraDetalhe[];
  consumo: number;
  consumoAteCritico: number;
  saldoMA: number;
  saldoPX: number;
  saldoUL: number;
  saldoQT: number;
  saldoQU: number;
  faltaBase: number;
  faltaPrazo: number;
  quantidadeSugerida: number;
  periodoCritico: 'MA' | 'PX' | 'UL' | 'QT' | 'QU';
  dataSugeridaEntrada: string;
  valorUnitario: number;
  coberturaResumo: string[];
  coberturaPedidos: string[];
  compraAtende: string;
  riscoCobertura: string;
};

type AgendaChegadaItem = {
  key: string;
  periodo: 'MA' | 'PX' | 'UL' | 'QT' | 'QU';
  dataRegra: string;
  artigo: string;
  idmateriaprima: string;
  nome: string;
  pedido: string;
  dataPedido: string;
  quantidade: number;
  consumoAteData: number;
  diasDiferenca: number;
  tipo: 'PEDIDO_FORA_PRAZO' | 'PEDIDO_FORA_HORIZONTE';
  guia: string;
};

type AgendaChegadaPeriodo = {
  periodo: 'MA' | 'PX' | 'UL' | 'QT' | 'QU';
  dataRegra: string;
  itens: AgendaChegadaItem[];
  artigosRows: AgendaChegadaArtigo[];
  pedidos: number;
  artigos: number;
  quantidadePedidos: number;
  foraPrazo: number;
  foraHorizonte: number;
  consumoAteData: number;
};

type AgendaChegadaArtigo = {
  key: string;
  artigo: string;
  itens: AgendaChegadaItem[];
  pedidos: number;
  mps: number;
  quantidadePedidos: number;
  foraPrazo: number;
  foraHorizonte: number;
  consumoAteData: number;
};

type OrcamentoResumo = {
  qtdTotal: number;
  valorTotal: number;
  itensComFalta: number;
  itensSemPreco: number;
  qtdIncremental: number;
  valorIncremental: number;
  itensIncremental: number;
  itensSemPrecoIncremental: number;
};

type OrcamentoArtigoRow = {
  artigo: string;
  itens: number;
  MA: OrcamentoResumo;
  PX: OrcamentoResumo;
  UL: OrcamentoResumo;
  QT: OrcamentoResumo;
  QU: OrcamentoResumo;
};

type AnaliseComprasPlanoRow = {
  idmateriaprima: string;
  nome: string;
  artigo: string;
  periodoCritico: 'MA' | 'PX' | 'UL' | 'QT' | 'QU';
  dataSugeridaEntrada: string;
  consumo: number;
  estoque: number;
  comprasAndamento: number;
  comprasNoPrazo: number;
  comprasForaPrazo: number;
  comprasForaHorizonte: number;
  pedidosDetalhe: PedidoCompraDetalhe[];
  faltaPrazo: number;
  compraAdicional: number;
  status: 'COMPRADO' | 'COMPRADO_FORA_PRAZO' | 'FORA_HORIZONTE' | 'COMPRAR';
};

type AnaliseComprasPlanoArtigo = {
  artigo: string;
  itens: number;
  consumo: number;
  estoque: number;
  comprasAndamento: number;
  comprasNoPrazo: number;
  comprasForaPrazo: number;
  comprasForaHorizonte: number;
  faltaPrazo: number;
  compraAdicional: number;
  comprarItens: number;
  foraPrazoItens: number;
  foraHorizonteItens: number;
  rows: AnaliseComprasPlanoRow[];
};

type PriceOption = {
  id: string;
  branchCode: number | null;
  priceCode: number | null;
  description: string;
  price: number | null;
  promotionalPrice: number | null;
  value: number;
};

type PedidoDraft = {
  key: string;
  supplierCode: number | null;
  supplierName: string;
  branchCode: number;
  buyerCode: number;
  operationCode: number;
  paymentConditionCode: number;
  valorUnitario: number;
  compraMinima: number;
  status: 5;
  totalAmountOrder: number;
  items: CompraRow[];
};

type PedidoConfig = {
  branchCode: number;
  buyerCode: number;
  operationCode: number;
  paymentConditionCode: number;
  valorUnitario: number;
  compraMinima: number;
};

type ArtigoGroup = {
  key: string;
  artigo: string;
  items: CompraRow[];
  quantidade: number;
  falta: number;
  consumo: number;
};

type PedidoTotvsPayload = {
  branchCode: number;
  supplierCode: number | null;
  buyerCode: number;
  operationCode: number;
  paymentConditionCode: number;
  status: 5;
  orderDate: string;
  totalAmountOrder: number;
  items: {
    productCode: number;
    value: number;
    quantity: number;
  }[];
  observations: {
    observation: string;
    visualizationType: 1;
  }[];
};

type PedidoEnviadoInfo = {
  branchCode: number;
  orderCode: number;
  raw: unknown;
  cancelado?: boolean;
};

function fmt(v: number, d = 0) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function aplicarCompraMinima(qtd: number, compraMinima: number) {
  const base = Math.max(0, Number(qtd || 0));
  const minimo = Math.max(0, Number(compraMinima || 0));
  return Math.max(base, minimo);
}

function faltaPorPeriodo(row: MpRow, periodo: PeriodoCompra) {
  const faltaMA = Math.max(0, -Number(row.saldo_ma || 0));
  const faltaPX = Math.max(0, -Number(row.saldo_px || 0));
  const faltaUL = Math.max(0, -Number(row.saldo_ul || 0));
  const faltaQT = Math.max(0, -Number(row.saldo_qt || 0));
  const faltaQU = Math.max(0, -Number(row.saldo_qu || 0));
  if (periodo === 'MA') return faltaMA;
  if (periodo === 'PX') return faltaPX;
  if (periodo === 'UL') return faltaUL;
  if (periodo === 'QT') return faltaQT;
  if (periodo === 'QU') return faltaQU;
  return Math.max(faltaMA, faltaPX, faltaUL, faltaQT, faltaQU);
}

function entradasAtePeriodo(row: MpRow, periodo: PeriodoCompra) {
  const ma = Number(row.entrada_ma || 0);
  const px = Number(row.entrada_px || 0);
  const ul = Number(row.entrada_ul || 0);
  const qt = Number(row.entrada_qt || 0);
  const qu = Number(row.entrada_qu || 0);
  if (periodo === 'MA') return ma;
  if (periodo === 'PX') return ma + px;
  if (periodo === 'UL') return ma + px + ul;
  if (periodo === 'QT') return ma + px + ul + qt;
  return ma + px + ul + qt + qu;
}

function consumoAtePeriodo(row: MpRow, periodo: PeriodoCompra) {
  const ma = Number(row.consumo_ma || 0);
  const px = Number(row.consumo_px || 0);
  const ul = Number(row.consumo_ul || 0);
  const qt = Number(row.consumo_qt || 0);
  const qu = Number(row.consumo_qu || 0);
  if (periodo === 'MA') return ma;
  if (periodo === 'PX') return ma + px;
  if (periodo === 'UL') return ma + px + ul;
  if (periodo === 'QT') return ma + px + ul + qt;
  return ma + px + ul + qt + qu;
}

function faltaCompraLiquida(row: MpRow, periodo: PeriodoCompra) {
  const estoque = Number(row.estoquetotal || 0);
  const andamentoTotal = Number(row.entrada_andamento || entradasAtePeriodo(row, 'QU') || 0);
  if (periodo === 'ATE_QU') {
    return Math.max(0, Number(row.consumo_total || 0) - estoque - andamentoTotal);
  }
  const consumoPeriodo =
    periodo === 'MA' ? Number(row.consumo_ma || 0) :
    periodo === 'PX' ? Number(row.consumo_ma || 0) + Number(row.consumo_px || 0) :
    periodo === 'UL' ? Number(row.consumo_ma || 0) + Number(row.consumo_px || 0) + Number(row.consumo_ul || 0) :
    periodo === 'QT' ? Number(row.consumo_ma || 0) + Number(row.consumo_px || 0) + Number(row.consumo_ul || 0) + Number(row.consumo_qt || 0) :
    Number(row.consumo_ma || 0) + Number(row.consumo_px || 0) + Number(row.consumo_ul || 0) + Number(row.consumo_qt || 0) + Number(row.consumo_qu || 0);
  return Math.max(0, consumoPeriodo - estoque - andamentoTotal);
}

function periodoAnterior(periodo: 'MA' | 'PX' | 'UL' | 'QT' | 'QU') {
  if (periodo === 'MA') return null;
  if (periodo === 'PX') return 'MA';
  if (periodo === 'UL') return 'PX';
  if (periodo === 'QT') return 'UL';
  return 'QT';
}

function faltaCompraIncremental(row: MpRow, periodo: 'MA' | 'PX' | 'UL' | 'QT' | 'QU') {
  const acumulada = faltaCompraLiquida(row, periodo);
  const anterior = periodoAnterior(periodo);
  const acumuladaAnterior = anterior ? faltaCompraLiquida(row, anterior) : 0;
  return Math.max(0, acumulada - acumuladaAnterior);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dataSugeridaCompra(periodo: 'MA' | 'PX' | 'UL' | 'QT' | 'QU', base = new Date()) {
  const mesAtual = new Date(base.getFullYear(), base.getMonth(), 1);
  const offset = periodo === 'MA' ? -1 : periodo === 'PX' ? 0 : periodo === 'UL' ? 1 : periodo === 'QT' ? 2 : 3;
  return isoDate(new Date(mesAtual.getFullYear(), mesAtual.getMonth() + offset, 1));
}

function diffDias(dataPedido?: string, dataRegra?: string) {
  if (!dataPedido || !dataRegra) return 0;
  const pedido = new Date(dataPedido);
  const regra = new Date(`${dataRegra}T00:00:00`);
  if (Number.isNaN(pedido.getTime()) || Number.isNaN(regra.getTime())) return 0;
  return Math.ceil((pedido.getTime() - regra.getTime()) / 86400000);
}

function enriquecerPedidosDetalhe(pedidos: PedidoCompraDetalhe[], dataRegra: string) {
  return pedidos.map((pedido) => {
    const diasDiferenca = diffDias(String(pedido.data || ''), dataRegra);
    return {
      ...pedido,
      dataRegra,
      diasDiferenca,
      dentroRegra: diasDiferenca <= 0,
    };
  });
}

function textoSugestaoPedido(pedido: PedidoCompraDetalhe) {
  const numero = pedido.pedido || '-';
  const dataPedido = String(pedido.data || '').slice(0, 10) || '-';
  const dataRegra = pedido.dataRegra || '-';
  const qtd = fmt(Number(pedido.quantidade || 0));
  if (pedido.dentroRegra) {
    return `Pedido ${numero}: ${qtd} chega em ${dataPedido}, dentro da regra ate ${dataRegra}`;
  }
  return `Pedido ${numero}: ${qtd} deveria chegar ate ${dataRegra}; previsao ${dataPedido} (${fmt(Number(pedido.diasDiferenca || 0))} dias depois)`;
}

function periodosAte(horizonte: PeriodoPlano) {
  return PERIODOS_PLANO.slice(0, PERIODOS_PLANO.indexOf(horizonte) + 1);
}

function consumoPeriodo(row: MpRow, periodo: PeriodoPlano) {
  if (periodo === 'MA') return Number(row.consumo_ma || 0);
  if (periodo === 'PX') return Number(row.consumo_px || 0);
  if (periodo === 'UL') return Number(row.consumo_ul || 0);
  if (periodo === 'QT') return Number(row.consumo_qt || 0);
  return Number(row.consumo_qu || 0);
}

function resumirAlocacao(alocacoes: Array<{ periodo: PeriodoPlano; qtd: number }>) {
  return alocacoes
    .filter((item) => item.qtd > 0)
    .map((item) => `${item.periodo} ${fmt(item.qtd)}`)
    .join(' / ');
}

function alocarQuantidade(qtdOriginal: number, demandas: Array<{ periodo: PeriodoPlano; restante: number }>) {
  let qtd = Math.max(0, Number(qtdOriginal || 0));
  const alocacoes: Array<{ periodo: PeriodoPlano; qtd: number }> = [];
  for (const demanda of demandas) {
    if (qtd <= 0) break;
    if (demanda.restante <= 0) continue;
    const usado = Math.min(qtd, demanda.restante);
    demanda.restante -= usado;
    qtd -= usado;
    alocacoes.push({ periodo: demanda.periodo, qtd: usado });
  }
  return alocacoes;
}

function montarCoberturaCompra(row: MpRow, quantidadeNova: number, horizonteCompra: PeriodoCompra) {
  const horizonte: PeriodoPlano = horizonteCompra === 'ATE_QU' ? 'QU' : horizonteCompra;
  const demandas = periodosAte(horizonte).map((periodo) => ({
    periodo,
    restante: consumoPeriodo(row, periodo),
  }));
  const demandaTotal = demandas.reduce((acc, item) => acc + item.restante, 0);
  const estoqueAloc = alocarQuantidade(Number(row.estoquetotal || 0), demandas);
  const pedidos = [...(Array.isArray(row.pedidos_detalhe) ? row.pedidos_detalhe : [])]
    .sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
  const pedidosLinhas: string[] = [];
  let qtdPedidosAlocada = 0;

  for (const pedido of pedidos) {
    const aloc = alocarQuantidade(Number(pedido.quantidade || 0), demandas);
    if (!aloc.length) continue;
    qtdPedidosAlocada += aloc.reduce((acc, item) => acc + item.qtd, 0);
    const primeiroPeriodo = aloc[0].periodo;
    const dataRegra = dataSugeridaCompra(primeiroPeriodo);
    const dataPedido = String(pedido.data || '').slice(0, 10) || '-';
    const dias = diffDias(dataPedido, dataRegra);
    const status = dias > 0
      ? `fora da regra; puxar para ${dataRegra}`
      : `dentro da regra ate ${dataRegra}`;
    pedidosLinhas.push(`Pedido ${pedido.pedido || '-'}: ${resumirAlocacao(aloc)} | previsto ${dataPedido} | ${status}`);
  }

  const compraNovaAloc = alocarQuantidade(quantidadeNova, demandas);
  const sobra = demandas.reduce((acc, item) => acc + Math.max(0, item.restante), 0);
  const resumo = [
    `Demanda ate ${horizonte}: ${fmt(demandaTotal)}`,
    `Estoque cobre: ${resumirAlocacao(estoqueAloc) || '-'}`,
    `Pedidos em andamento cobrem: ${qtdPedidosAlocada > 0 ? fmt(qtdPedidosAlocada) : '-'}`,
    `Compra nova cobre: ${resumirAlocacao(compraNovaAloc) || '-'}`,
  ];
  return {
    resumo,
    pedidos: pedidosLinhas.slice(0, 4),
    compraAtende: resumirAlocacao(compraNovaAloc) || 'Somente ajuste/minimo de compra; estoque e pedidos ja cobrem o horizonte selecionado',
    risco: sobra > 0 ? `Ainda sobra falta de ${fmt(sobra)} ate ${horizonte}` : '',
  };
}

function guiaChegadaMp(row: AnaliseComprasPlanoRow) {
  const avisos: string[] = [];
  if (row.compraAdicional > 0) {
    avisos.push(`Comprar ${fmt(row.compraAdicional)} para chegar ate ${row.dataSugeridaEntrada}`);
  }
  const pedidosForaRegra = row.pedidosDetalhe.filter((pedido) => !pedido.dentroRegra);
  if (pedidosForaRegra.length > 0) {
    avisos.push(...pedidosForaRegra.slice(0, 2).map(textoSugestaoPedido));
    if (pedidosForaRegra.length > 2) avisos.push(`Mais ${pedidosForaRegra.length - 2} pedido(s) fora da regra`);
  }
  if (!avisos.length && row.pedidosDetalhe.length > 0) {
    avisos.push('Pedidos em andamento dentro da regra');
  }
  return avisos.length ? avisos.join(' | ') : 'Sem acao pendente';
}

function guiaChegadaArtigo(artigo: AnaliseComprasPlanoArtigo) {
  const avisos: string[] = [];
  if (artigo.compraAdicional > 0) {
    const primeiraCompra = artigo.rows.find((row) => row.compraAdicional > 0);
    avisos.push(`Comprar liquido ${fmt(artigo.compraAdicional)}${primeiraCompra ? ` ate ${primeiraCompra.dataSugeridaEntrada}` : ''}`);
  }
  if (artigo.comprasForaHorizonte > 0) {
    avisos.push(`${fmt(artigo.comprasForaHorizonte)} comprado fora de MA/PX/UL/QT/QU`);
  }
  if (artigo.comprasForaPrazo > 0) {
    avisos.push(`${fmt(artigo.comprasForaPrazo)} comprado fora da data regra`);
  }
  return avisos.length ? avisos.join(' | ') : 'Coberto dentro da regra';
}

function periodoCritico(row: MpRow): 'MA' | 'PX' | 'UL' | 'QT' | 'QU' {
  if (Number(row.saldo_ma || 0) < 0) return 'MA';
  if (Number(row.saldo_px || 0) < 0) return 'PX';
  if (Number(row.saldo_ul || 0) < 0) return 'UL';
  if (Number(row.saldo_qt || 0) < 0) return 'QT';
  return 'QU';
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const DEFAULT_PEDIDO_CONFIG: PedidoConfig = {
  branchCode: 1,
  buyerCode: 10,
  operationCode: 106,
  paymentConditionCode: 2,
  valorUnitario: 0,
  compraMinima: 0,
};

export default function PedidoCompraPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceWarning, setPriceWarning] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [matriz, setMatriz] = useState<Planejamento[]>([]);
  const [mpRows, setMpRows] = useState<MpRow[]>([]);
  const [periodoCompra, setPeriodoCompra] = useState<PeriodoCompra>('ATE_QU');
  const [somenteComCompra, setSomenteComCompra] = useState(true);
  const [artigosDesmarcados, setArtigosDesmarcados] = useState<Set<string>>(new Set());
  const [continuidadeFiltro, setContinuidadeFiltro] = useState('TODAS');
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [pedidoConfigs, setPedidoConfigs] = useState<Record<string, PedidoConfig>>({});
  const [priceOptionsByMp, setPriceOptionsByMp] = useState<Record<string, PriceOption[]>>({});
  const [selectedPriceByMp, setSelectedPriceByMp] = useState<Record<string, string>>({});
  const [pedidosNaoAbrir, setPedidosNaoAbrir] = useState<Set<string>>(new Set());
  const [pedidosExpandidos, setPedidosExpandidos] = useState<Set<string>>(new Set());
  const [artigosExpandidos, setArtigosExpandidos] = useState<Set<string>>(new Set());
  const [orcamentoExpandidos, setOrcamentoExpandidos] = useState<Set<string>>(new Set());
  const [analiseArtigosExpandidos, setAnaliseArtigosExpandidos] = useState<Set<string>>(new Set());
  const [agendaExpandidos, setAgendaExpandidos] = useState<Set<string>>(new Set());
  const [pedidosEnviando, setPedidosEnviando] = useState<Set<string>>(new Set());
  const [pedidosCancelando, setPedidosCancelando] = useState<Set<string>>(new Set());
  const [pedidosEnviados, setPedidosEnviados] = useState<Record<string, PedidoEnviadoInfo>>({});
  const [artigoDropdownOpen, setArtigoDropdownOpen] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregarPlanoOficial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregarPlanoOficial() {
    setLoading(true);
    setError(null);
    setPriceWarning(null);
    setOkMsg(null);
    try {
      const params = new URLSearchParams({
        limit: '3000',
        marca: MARCA_FIXA,
        status: STATUS_FIXO,
        prefer_cache: 'true',
      });
      const rMatriz = await fetchNoCache(`${API_URL}/api/producao/matriz?${params}`);
      const pMatriz = await rMatriz.json();
      if (!rMatriz.ok || !pMatriz?.success) throw new Error(pMatriz?.error || 'Erro ao carregar plano oficial');

      const rows = (Array.isArray(pMatriz?.data) ? pMatriz.data : []) as Planejamento[];
      setMatriz(rows);

      setMpRows([]);
      setSelecionados(new Set());
      setPedidosNaoAbrir(new Set());
      setPedidosExpandidos(new Set());
      setArtigosExpandidos(new Set());
      setOrcamentoExpandidos(new Set());
      setAnaliseArtigosExpandidos(new Set());
      setAgendaExpandidos(new Set());
      setPedidosEnviando(new Set());
      setPedidosEnviados({});
      setArtigosDesmarcados(new Set());
      setPedidoConfigs({});
      setPriceOptionsByMp({});
      setSelectedPriceByMp({});
      setOkMsg('Plano oficial carregado. Clique em Calcular sugestao para consultar MP, estoque e compras.');
    } catch (e) {
      setMatriz([]);
      setMpRows([]);
      setSelecionados(new Set());
      setPedidosNaoAbrir(new Set());
      setPedidosExpandidos(new Set());
      setArtigosExpandidos(new Set());
      setOrcamentoExpandidos(new Set());
      setAnaliseArtigosExpandidos(new Set());
      setAgendaExpandidos(new Set());
      setPedidosEnviando(new Set());
      setPedidosEnviados({});
      setArtigosDesmarcados(new Set());
      setPedidoConfigs({});
      setPriceOptionsByMp({});
      setSelectedPriceByMp({});
      setError(e instanceof Error ? e.message : 'Erro ao carregar pedido de compra');
    } finally {
      setLoading(false);
    }
  }

  const planosOficiais = useMemo(() => {
    return matriz
      .map((item) => ({
        idproduto: String(item.produto.idproduto || ''),
        idreferencia: String(item.produto.cd_seqgrupo || ''),
        ma: Number(item.plano?.ma || 0),
        px: Number(item.plano?.px || 0),
        ul: Number(item.plano?.ul || 0),
        qt: Number(item.plano?.qt || 0),
        qu: Number(item.plano?.qu || 0),
      }))
      .filter((item) => item.idproduto && (item.ma + item.px + item.ul + item.qt + item.qu) > 0);
  }, [matriz]);

  async function calcularSugestao() {
    if (!planosOficiais.length) {
      setError('Nenhum item com plano MA/PX/UL/QT/QU para calcular.');
      return;
    }
    setCalculating(true);
    setError(null);
    setPriceWarning(null);
    setOkMsg(null);
    try {
      const rAnalise = await fetchNoCache(`${API_URL}/api/consumo-mp/analise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ planos: planosOficiais, multinivel: true }),
      });
      const pAnalise = await rAnalise.json();
      if (!rAnalise.ok || !pAnalise?.success) throw new Error(pAnalise?.error || 'Erro ao calcular MP do plano oficial');

      const mps = Array.isArray(pAnalise?.data) ? pAnalise.data as MpRow[] : [];
      setMpRows(mps);
      setSelecionados(new Set(mps.filter((row) => faltaCompraLiquida(row, periodoCompra) > 0).map((row) => row.idmateriaprima)));
      setPedidosNaoAbrir(new Set());
      setPedidosExpandidos(new Set());
      setArtigosExpandidos(new Set());
      setOrcamentoExpandidos(new Set());
      setAnaliseArtigosExpandidos(new Set());
      setAgendaExpandidos(new Set());
      setPedidosEnviando(new Set());
      setPedidosEnviados({});
      setArtigosDesmarcados(new Set());
      setPedidoConfigs({});
      await carregarPrecosMp(mps);
      setOkMsg('Sugestao calculada com estoque, compras de MP e precos TOTVS quando disponiveis.');
    } catch (e) {
      setMpRows([]);
      setSelecionados(new Set());
      setPedidosNaoAbrir(new Set());
      setPedidosExpandidos(new Set());
      setArtigosExpandidos(new Set());
      setOrcamentoExpandidos(new Set());
      setAnaliseArtigosExpandidos(new Set());
      setAgendaExpandidos(new Set());
      setPedidosEnviando(new Set());
      setPedidosEnviados({});
      setArtigosDesmarcados(new Set());
      setPedidoConfigs({});
      setPriceOptionsByMp({});
      setSelectedPriceByMp({});
      setError(e instanceof Error ? e.message : 'Erro ao calcular sugestao de pedido');
    } finally {
      setCalculating(false);
    }
  }

  async function carregarPrecosMp(mps: MpRow[]) {
    const productCodes = Array.from(new Set(mps.map((row) => String(row.idmateriaprima || '').trim()).filter(Boolean)));
    if (!productCodes.length) {
      setPriceOptionsByMp({});
      setSelectedPriceByMp({});
      return;
    }
    setLoadingPrices(true);
    setPriceWarning(null);
    try {
      const response = await fetchNoCache(`${API_URL}/api/totvs-moda/prices/mp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ productCodes }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Erro ao consultar precos TOTVS');

      const optionsByMp = (payload.data || {}) as Record<string, PriceOption[]>;
      const selected: Record<string, string> = {};
      for (const code of productCodes) {
        const first = optionsByMp[code]?.[0];
        if (first) selected[code] = first.id;
      }
      setPriceOptionsByMp(optionsByMp);
      setSelectedPriceByMp(selected);
    } catch (e) {
      setPriceOptionsByMp({});
      setSelectedPriceByMp({});
      setPriceWarning(e instanceof Error ? e.message : 'Nao foi possivel carregar precos TOTVS.');
    } finally {
      setLoadingPrices(false);
    }
  }

  const continuidades = useMemo(() => {
    return ['TODAS', ...Array.from(new Set(matriz.map((item) => String(item.produto.continuidade || '-').trim() || '-'))).sort((a, b) => a.localeCompare(b))];
  }, [matriz]);

  const planoBase = useMemo(() => {
    let rows = matriz;
    if (continuidadeFiltro !== 'TODAS') {
      rows = rows.filter((item) => String(item.produto.continuidade || '-').trim() === continuidadeFiltro);
    }
    return rows;
  }, [matriz, continuidadeFiltro]);

  const compraRows = useMemo<CompraRow[]>(() => {
    return mpRows.map((row) => {
      const entradasPeriodo = Number(row.entrada_ma || 0) + Number(row.entrada_px || 0) + Number(row.entrada_ul || 0) + Number(row.entrada_qt || 0) + Number(row.entrada_qu || 0);
      const entradasAndamento = Number(row.entrada_andamento || entradasPeriodo || 0);
      const critico = periodoCritico(row);
      const faltaPrazo = faltaPorPeriodo(row, periodoCompra);
      const faltaBase = faltaCompraLiquida(row, periodoCompra);
      const cobertura = montarCoberturaCompra(row, faltaBase, periodoCompra);
      return {
        idmateriaprima: String(row.idmateriaprima || ''),
        nome: String(row.nome_materiaprima || '-'),
        artigo: String(row.artigo || '-').trim() || '-',
        cdFornecedor: String(row.cd_fornecedor || ''),
        fornecedor: String(row.nm_fornecedor || '').trim() || 'A definir',
        codigoFornecedor: String(row.cd_original_fornecedor || '').trim(),
        estoque: Number(row.estoquetotal || 0),
        entradas: entradasPeriodo,
        entradasAndamento,
        entradasForaPrazo: Math.max(0, entradasAndamento - entradasAtePeriodo(row, critico)),
        entradasForaHorizonte: Number(row.entrada_fora_horizonte || 0),
        pedidosDetalhe: enriquecerPedidosDetalhe(Array.isArray(row.pedidos_detalhe) ? row.pedidos_detalhe : [], dataSugeridaCompra(critico)),
        consumo: Number(row.consumo_total || 0),
        consumoAteCritico: consumoAtePeriodo(row, critico),
        saldoMA: Number(row.saldo_ma || 0),
        saldoPX: Number(row.saldo_px || 0),
        saldoUL: Number(row.saldo_ul || 0),
        saldoQT: Number(row.saldo_qt || 0),
        saldoQU: Number(row.saldo_qu || 0),
        faltaBase,
        faltaPrazo,
        quantidadeSugerida: faltaBase,
        periodoCritico: critico,
        dataSugeridaEntrada: dataSugeridaCompra(critico),
        valorUnitario: getSelectedPriceValue(String(row.idmateriaprima || '').trim()),
        coberturaResumo: cobertura.resumo,
        coberturaPedidos: cobertura.pedidos,
        compraAtende: cobertura.compraAtende,
        riscoCobertura: cobertura.risco,
      };
    });
  }, [mpRows, periodoCompra, selectedPriceByMp, priceOptionsByMp]);

  const artigosDisponiveis = useMemo(() => Array.from(new Set(compraRows.map((row) => row.artigo))).sort((a, b) => a.localeCompare(b)), [compraRows]);
  const artigosSelecionados = useMemo(() => {
    return artigosDisponiveis.filter((artigo) => !artigosDesmarcados.has(artigo));
  }, [artigosDisponiveis, artigosDesmarcados]);

  const compraRowsView = useMemo(() => {
    let base = compraRows;
    if (somenteComCompra) base = base.filter((row) => row.quantidadeSugerida > 0);
    if (artigosDisponiveis.length > 0) {
      base = base.filter((row) => !artigosDesmarcados.has(row.artigo));
    }
    return [...base].sort((a, b) => {
      if (b.quantidadeSugerida !== a.quantidadeSugerida) return b.quantidadeSugerida - a.quantidadeSugerida;
      return a.nome.localeCompare(b.nome);
    });
  }, [compraRows, somenteComCompra, artigosDisponiveis.length, artigosDesmarcados]);

  const resumoArtigo = useMemo(() => {
    const map = new Map<string, { artigo: string; itens: number; compra: number; falta: number; consumo: number }>();
    for (const row of compraRowsView) {
      const atual = map.get(row.artigo) || { artigo: row.artigo, itens: 0, compra: 0, falta: 0, consumo: 0 };
      atual.itens += 1;
      atual.compra += row.quantidadeSugerida;
      atual.falta += row.faltaBase;
      atual.consumo += row.consumo;
      map.set(row.artigo, atual);
    }
    return Array.from(map.values()).sort((a, b) => b.compra - a.compra);
  }, [compraRowsView]);

  const resumo = useMemo(() => {
    const selecionadosRows = compraRowsView.filter((row) => selecionados.has(row.idmateriaprima));
    return {
      skusPlano: planoBase.length,
      planoMA: planoBase.reduce((acc, item) => acc + Number(item.plano?.ma || 0), 0),
      planoPX: planoBase.reduce((acc, item) => acc + Number(item.plano?.px || 0), 0),
      planoUL: planoBase.reduce((acc, item) => acc + Number(item.plano?.ul || 0), 0),
      planoQT: planoBase.reduce((acc, item) => acc + Number(item.plano?.qt || 0), 0),
      planoQU: planoBase.reduce((acc, item) => acc + Number(item.plano?.qu || 0), 0),
      itens: selecionadosRows.length,
      pedidos: new Set(selecionadosRows.map((row) => row.cdFornecedor || 'SEM_FORNECEDOR')).size,
      compra: selecionadosRows.reduce((acc, row) => acc + row.quantidadeSugerida, 0),
      faltaBase: selecionadosRows.reduce((acc, row) => acc + row.faltaBase, 0),
      artigos: new Set(selecionadosRows.map((row) => row.artigo)).size,
    };
  }, [planoBase, compraRowsView, selecionados]);

  // Orçamento por horizonte de compra - calcula quanto gastaria até cada período
  const orcamentoPorPeriodo = useMemo(() => {
    const calcularOrcamento = (periodo: PeriodoCompra) => {
      let qtdTotal = 0;
      let valorTotal = 0;
      let itensComFalta = 0;
      let itensSemPreco = 0;
      let qtdIncremental = 0;
      let valorIncremental = 0;
      let itensIncremental = 0;
      let itensSemPrecoIncremental = 0;

      for (const row of compraRows) {
        const mp = mpRows.find((item) => String(item.idmateriaprima || '') === row.idmateriaprima);
        const falta = mp ? faltaCompraLiquida(mp, periodo) : 0;
        const incremento = mp ? faltaCompraIncremental(mp, periodo as 'MA' | 'PX' | 'UL' | 'QT' | 'QU') : 0;
        if (falta > 0) {
          itensComFalta++;
          const preco = row.valorUnitario || 0;
          if (preco > 0) {
            qtdTotal += falta;
            valorTotal += falta * preco;
          } else {
            itensSemPreco++;
          }
        }
        if (incremento > 0) {
          itensIncremental++;
          const preco = row.valorUnitario || 0;
          if (preco > 0) {
            qtdIncremental += incremento;
            valorIncremental += incremento * preco;
          } else {
            itensSemPrecoIncremental++;
          }
        }
      }

      return { qtdTotal, valorTotal, itensComFalta, itensSemPreco, qtdIncremental, valorIncremental, itensIncremental, itensSemPrecoIncremental };
    };

    return {
      MA: calcularOrcamento('MA'),
      PX: calcularOrcamento('PX'),
      UL: calcularOrcamento('UL'),
      QT: calcularOrcamento('QT'),
      QU: calcularOrcamento('QU'),
    };
  }, [compraRows, mpRows]);

  const orcamentoPorArtigo = useMemo<OrcamentoArtigoRow[]>(() => {
    const periodos: Array<'MA' | 'PX' | 'UL' | 'QT' | 'QU'> = ['MA', 'PX', 'UL', 'QT', 'QU'];
    const vazio = (): OrcamentoResumo => ({
      qtdTotal: 0,
      valorTotal: 0,
      itensComFalta: 0,
      itensSemPreco: 0,
      qtdIncremental: 0,
      valorIncremental: 0,
      itensIncremental: 0,
      itensSemPrecoIncremental: 0,
    });
    const map = new Map<string, OrcamentoArtigoRow>();

    for (const row of compraRows) {
      if (!map.has(row.artigo)) {
        map.set(row.artigo, {
          artigo: row.artigo,
          itens: 0,
          MA: vazio(),
          PX: vazio(),
          UL: vazio(),
          QT: vazio(),
          QU: vazio(),
        });
      }
      const artigoRow = map.get(row.artigo)!;
      artigoRow.itens += 1;
      const mp = mpRows.find((item) => String(item.idmateriaprima || '') === row.idmateriaprima);
      if (!mp) continue;
      for (const periodo of periodos) {
        const falta = faltaCompraLiquida(mp, periodo);
        const incremento = faltaCompraIncremental(mp, periodo);
        const resumoPeriodo = artigoRow[periodo];
        if (falta <= 0) continue;
        resumoPeriodo.itensComFalta += 1;
        if (row.valorUnitario > 0) {
          resumoPeriodo.qtdTotal += falta;
          resumoPeriodo.valorTotal += falta * row.valorUnitario;
        } else {
          resumoPeriodo.itensSemPreco += 1;
        }
        if (incremento > 0) {
          resumoPeriodo.itensIncremental += 1;
          if (row.valorUnitario > 0) {
            resumoPeriodo.qtdIncremental += incremento;
            resumoPeriodo.valorIncremental += incremento * row.valorUnitario;
          } else {
            resumoPeriodo.itensSemPrecoIncremental += 1;
          }
        }
      }
    }

    return Array.from(map.values())
      .filter((row) => {
        const periodos = [row.MA, row.PX, row.UL, row.QT, row.QU];
        return periodos.some((p) => p.itensComFalta > 0);
      })
      .sort((a, b) => b.QU.valorTotal - a.QU.valorTotal || b.QU.itensComFalta - a.QU.itensComFalta || a.artigo.localeCompare(b.artigo));
  }, [compraRows, mpRows]);

  const analiseComprasPlano = useMemo<AnaliseComprasPlanoRow[]>(() => {
    return compraRows
      .map((row) => {
        const comprasAndamento = row.entradasAndamento;
        const comprasForaHorizonte = row.entradasForaHorizonte;
        const comprasForaPrazo = Math.max(0, row.entradasForaPrazo - comprasForaHorizonte);
        const comprasNoPrazo = Math.max(0, comprasAndamento - comprasForaPrazo - comprasForaHorizonte);
        const status: AnaliseComprasPlanoRow['status'] =
          row.quantidadeSugerida > 0 ? 'COMPRAR' :
          comprasForaHorizonte > 0 ? 'FORA_HORIZONTE' :
          comprasForaPrazo > 0 && row.faltaPrazo > 0 ? 'COMPRADO_FORA_PRAZO' :
          'COMPRADO';
        return {
          idmateriaprima: row.idmateriaprima,
          nome: row.nome,
          artigo: row.artigo,
          periodoCritico: row.periodoCritico,
          dataSugeridaEntrada: row.dataSugeridaEntrada,
          consumo: row.consumo,
          estoque: row.estoque,
          comprasAndamento,
          comprasNoPrazo,
          comprasForaPrazo,
          comprasForaHorizonte,
          pedidosDetalhe: row.pedidosDetalhe,
          faltaPrazo: row.faltaPrazo,
          compraAdicional: row.quantidadeSugerida,
          status,
        };
      })
      .filter((row) => row.comprasAndamento > 0 || row.compraAdicional > 0 || row.faltaPrazo > 0)
      .sort((a, b) => {
        const peso = { COMPRAR: 0, FORA_HORIZONTE: 1, COMPRADO_FORA_PRAZO: 2, COMPRADO: 3 } as const;
        return peso[a.status] - peso[b.status] || b.compraAdicional - a.compraAdicional || a.artigo.localeCompare(b.artigo);
      });
  }, [compraRows]);

  const analiseComprasPlanoPorArtigo = useMemo<AnaliseComprasPlanoArtigo[]>(() => {
    const map = new Map<string, AnaliseComprasPlanoArtigo>();
    for (const row of analiseComprasPlano) {
      if (!map.has(row.artigo)) {
        map.set(row.artigo, {
          artigo: row.artigo,
          itens: 0,
          consumo: 0,
          estoque: 0,
          comprasAndamento: 0,
          comprasNoPrazo: 0,
          comprasForaPrazo: 0,
          comprasForaHorizonte: 0,
          faltaPrazo: 0,
          compraAdicional: 0,
          comprarItens: 0,
          foraPrazoItens: 0,
          foraHorizonteItens: 0,
          rows: [],
        });
      }
      const acc = map.get(row.artigo)!;
      acc.itens += 1;
      acc.consumo += row.consumo;
      acc.estoque += row.estoque;
      acc.comprasAndamento += row.comprasAndamento;
      acc.comprasNoPrazo += row.comprasNoPrazo;
      acc.comprasForaPrazo += row.comprasForaPrazo;
      acc.comprasForaHorizonte += row.comprasForaHorizonte;
      acc.faltaPrazo += row.faltaPrazo;
      acc.compraAdicional += row.compraAdicional;
      if (row.compraAdicional > 0) acc.comprarItens += 1;
      if (row.comprasForaPrazo > 0) acc.foraPrazoItens += 1;
      if (row.comprasForaHorizonte > 0) acc.foraHorizonteItens += 1;
      acc.rows.push(row);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (b.compraAdicional !== a.compraAdicional) return b.compraAdicional - a.compraAdicional;
      if (b.comprasForaHorizonte !== a.comprasForaHorizonte) return b.comprasForaHorizonte - a.comprasForaHorizonte;
      if (b.comprasForaPrazo !== a.comprasForaPrazo) return b.comprasForaPrazo - a.comprasForaPrazo;
      return a.artigo.localeCompare(b.artigo);
    });
  }, [analiseComprasPlano]);

  const agendaChegadaPorData = useMemo<AgendaChegadaPeriodo[]>(() => {
    const periodos: Array<'MA' | 'PX' | 'UL' | 'QT' | 'QU'> = ['MA', 'PX', 'UL', 'QT', 'QU'];
    const map = new Map<string, AgendaChegadaPeriodo>();
    for (const periodo of periodos) {
      map.set(periodo, {
        periodo,
        dataRegra: dataSugeridaCompra(periodo),
        itens: [],
        artigosRows: [],
        pedidos: 0,
        artigos: 0,
        quantidadePedidos: 0,
        foraPrazo: 0,
        foraHorizonte: 0,
        consumoAteData: 0,
      });
    }

    for (const row of compraRows) {
      const periodo = row.periodoCritico;
      const bucket = map.get(periodo);
      if (!bucket) continue;
      bucket.consumoAteData += row.consumoAteCritico;

      for (const pedido of row.pedidosDetalhe) {
        const quantidade = Number(pedido.quantidade || 0);
        const foraHorizonte = String(pedido.periodo || '').toLowerCase() === 'fora_horizonte';
        const dentroRegra = pedido.dentroRegra === true;
        if (dentroRegra && !foraHorizonte) continue;
        const tipo: AgendaChegadaItem['tipo'] = foraHorizonte ? 'PEDIDO_FORA_HORIZONTE' : 'PEDIDO_FORA_PRAZO';
        bucket.itens.push({
          key: `${periodo}-${row.idmateriaprima}-${pedido.pedido || 'pedido'}-${pedido.data || ''}-${quantidade}`,
          periodo,
          dataRegra: bucket.dataRegra,
          artigo: row.artigo,
          idmateriaprima: row.idmateriaprima,
          nome: row.nome,
          pedido: String(pedido.pedido || '-'),
          dataPedido: String(pedido.data || '').slice(0, 10),
          quantidade,
          consumoAteData: row.consumoAteCritico,
          diasDiferenca: Number(pedido.diasDiferenca || 0),
          tipo,
          guia: textoSugestaoPedido(pedido),
        });
      }
    }

    return periodos.map((periodo) => {
      const bucket = map.get(periodo)!;
      const pedidosSet = new Set(bucket.itens.map((item) => item.pedido));
      const artigosSet = new Set(bucket.itens.map((item) => item.artigo));
      bucket.pedidos = pedidosSet.size;
      bucket.artigos = artigosSet.size;
      bucket.quantidadePedidos = bucket.itens.reduce((acc, item) => acc + Number(item.quantidade || 0), 0);
      bucket.foraPrazo = bucket.itens.filter((item) => item.tipo === 'PEDIDO_FORA_PRAZO').reduce((acc, item) => acc + Number(item.quantidade || 0), 0);
      bucket.foraHorizonte = bucket.itens.filter((item) => item.tipo === 'PEDIDO_FORA_HORIZONTE').reduce((acc, item) => acc + Number(item.quantidade || 0), 0);
      bucket.itens.sort((a, b) => {
        const peso = { PEDIDO_FORA_HORIZONTE: 0, PEDIDO_FORA_PRAZO: 1 } as const;
        return peso[a.tipo] - peso[b.tipo] || b.quantidade - a.quantidade || a.artigo.localeCompare(b.artigo);
      });
      const artigosMap = new Map<string, AgendaChegadaArtigo>();
      for (const item of bucket.itens) {
        if (!artigosMap.has(item.artigo)) {
          artigosMap.set(item.artigo, {
            key: `${periodo}-${item.artigo}`,
            artigo: item.artigo,
            itens: [],
            pedidos: 0,
            mps: 0,
            quantidadePedidos: 0,
            foraPrazo: 0,
            foraHorizonte: 0,
            consumoAteData: 0,
          });
        }
        const artigo = artigosMap.get(item.artigo)!;
        artigo.itens.push(item);
        artigo.quantidadePedidos += Number(item.quantidade || 0);
        artigo.consumoAteData += Number(item.consumoAteData || 0);
        if (item.tipo === 'PEDIDO_FORA_PRAZO') artigo.foraPrazo += Number(item.quantidade || 0);
        if (item.tipo === 'PEDIDO_FORA_HORIZONTE') artigo.foraHorizonte += Number(item.quantidade || 0);
      }
      bucket.artigosRows = Array.from(artigosMap.values()).map((artigo) => ({
        ...artigo,
        pedidos: new Set(artigo.itens.map((item) => item.pedido)).size,
        mps: new Set(artigo.itens.map((item) => item.idmateriaprima)).size,
      })).sort((a, b) => b.foraHorizonte - a.foraHorizonte || b.foraPrazo - a.foraPrazo || a.artigo.localeCompare(b.artigo));
      return bucket;
    });
  }, [compraRows]);

  function selecionarVisiveis() {
    setSelecionados(new Set(compraRowsView.filter((row) => row.quantidadeSugerida > 0).map((row) => row.idmateriaprima)));
  }

  function limparSelecao() {
    setSelecionados(new Set());
  }

  function toggleArtigoFiltro(artigo: string) {
    setArtigosDesmarcados((prev) => {
      const next = new Set(prev);
      if (next.has(artigo)) next.delete(artigo);
      else next.add(artigo);
      return next;
    });
  }

  function selecionarTodosArtigos() {
    setArtigosDesmarcados(new Set());
  }

  function limparTodosArtigos() {
    setArtigosDesmarcados(new Set(artigosDisponiveis));
  }

  function getPedidoConfig(key: string): PedidoConfig {
    return { ...DEFAULT_PEDIDO_CONFIG, ...(pedidoConfigs[key] || {}) };
  }

  function updatePedidoConfig(key: string, field: keyof PedidoConfig, value: number) {
    setPedidoConfigs((prev) => ({
      ...prev,
      [key]: {
        ...getPedidoConfig(key),
        [field]: field === 'compraMinima' ? Math.max(0, Number(value || 0)) : Number(value || 0),
      },
    }));
  }

  function getSelectedPriceValue(productCode: string) {
    const options = priceOptionsByMp[productCode] || [];
    const selectedId = selectedPriceByMp[productCode];
    const option = options.find((item) => item.id === selectedId) || options[0];
    return Number(option?.value || 0);
  }

  function toggleSelecionado(id: string) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAbrirPedido(key: string) {
    setPedidosNaoAbrir((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleDetalhesPedido(key: string) {
    setPedidosExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleArtigoPedido(key: string) {
    setArtigosExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleOrcamentoPeriodo(periodo: string) {
    setOrcamentoExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(periodo)) next.delete(periodo);
      else next.add(periodo);
      return next;
    });
  }

  function toggleAnaliseArtigo(artigo: string) {
    setAnaliseArtigosExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(artigo)) next.delete(artigo);
      else next.add(artigo);
      return next;
    });
  }

  function toggleAgendaPeriodo(periodo: string) {
    setAgendaExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(periodo)) next.delete(periodo);
      else next.add(periodo);
      return next;
    });
  }

  function marcarTodosPedidos() {
    setPedidosNaoAbrir(new Set());
  }

  function desmarcarTodosPedidos() {
    setPedidosNaoAbrir(new Set(pedidosDraft.map((pedido) => pedido.key)));
  }

  const pedidosDraft = useMemo<PedidoDraft[]>(() => {
    const rows = compraRowsView.filter((row) => selecionados.has(row.idmateriaprima) && row.quantidadeSugerida > 0);
    const map = new Map<string, PedidoDraft>();
    for (const row of rows) {
      const key = row.cdFornecedor || 'SEM_FORNECEDOR';
      const cfg = { ...DEFAULT_PEDIDO_CONFIG, ...(pedidoConfigs[key] || {}) };
      const itemPedido = {
        ...row,
        quantidadeSugerida: aplicarCompraMinima(Number(row.faltaBase || 0), cfg.compraMinima),
      };
      if (!map.has(key)) {
        map.set(key, {
          key,
          supplierCode: row.cdFornecedor ? Number(row.cdFornecedor) : null,
          supplierName: row.fornecedor,
          branchCode: Number(cfg.branchCode || 0),
          buyerCode: Number(cfg.buyerCode || 0),
          operationCode: Number(cfg.operationCode || 0),
          paymentConditionCode: Number(cfg.paymentConditionCode || 0),
          valorUnitario: Number(cfg.valorUnitario || 0),
          compraMinima: Math.max(0, Number(cfg.compraMinima || 0)),
          status: 5,
          totalAmountOrder: 0,
          items: [],
        });
      }
      const pedido = map.get(key);
      if (!pedido) continue;
      pedido.items.push(itemPedido);
      const valorUnitario = Number(itemPedido.valorUnitario || cfg.valorUnitario || 0);
      pedido.totalAmountOrder += Number(itemPedido.quantidadeSugerida || 0) * valorUnitario;
    }
    return Array.from(map.values()).sort((a, b) => a.supplierName.localeCompare(b.supplierName));
  }, [compraRowsView, selecionados, pedidoConfigs]);

  const pedidosParaAbrir = useMemo(() => {
    return pedidosDraft.filter((pedido) => !pedidosNaoAbrir.has(pedido.key));
  }, [pedidosDraft, pedidosNaoAbrir]);

  const valorTotalPedidos = useMemo(() => {
    return pedidosParaAbrir.reduce((acc, pedido) => acc + Number(pedido.totalAmountOrder || 0), 0);
  }, [pedidosParaAbrir]);

  const pedidosValidosEnvio = useMemo(() => {
    return pedidosParaAbrir.filter((pedido) => {
      if (!pedido.supplierCode) return false;
      if (pedido.totalAmountOrder <= 0) return false;
      const temItemSemValor = pedido.items.some((item) => Number(item.valorUnitario || pedido.valorUnitario || 0) <= 0);
      if (temItemSemValor) return false;
      return true;
    });
  }, [pedidosParaAbrir]);

  function gruposArtigoPedido(pedido: PedidoDraft): ArtigoGroup[] {
    const map = new Map<string, ArtigoGroup>();
    for (const item of pedido.items) {
      const key = `${pedido.key}::${item.artigo}`;
      const atual = map.get(key) || { key, artigo: item.artigo, items: [], quantidade: 0, falta: 0, consumo: 0 };
      atual.items.push(item);
      atual.quantidade += Number(item.quantidadeSugerida || 0);
      atual.falta += Number(item.faltaBase || 0);
      atual.consumo += Number(item.consumo || 0);
      map.set(key, atual);
    }
    return Array.from(map.values()).sort((a, b) => b.quantidade - a.quantidade || a.artigo.localeCompare(b.artigo));
  }

  function exportarCSV() {
    if (!pedidosParaAbrir.length) {
      setError('Marque ao menos um pedido para abrir.');
      return;
    }
    const rows = pedidosParaAbrir.flatMap((pedido, index) => pedido.items.map((row) => ({ pedido, row, index: index + 1 })));
    if (!rows.length) {
      setError('Selecione ao menos uma materia-prima com compra sugerida.');
      return;
    }
    const header = [
      'pedido_sugerido', 'branch_code', 'supplier_code', 'supplier_name', 'buyer_code', 'operation_code', 'payment_condition_code', 'compra_minima', 'status',
      'product_code', 'product_name', 'artigo', 'codigo_fornecedor', 'periodo_critico', 'data_sugerida_entrada',
      'estoque', 'entradas_prazo', 'entradas_andamento', 'entradas_fora_prazo', 'consumo_total', 'saldo_ma', 'saldo_px', 'saldo_ul', 'saldo_qt', 'saldo_qu',
      'falta_base', 'quantity', 'value'
    ];
    const csvRows = rows.map(({ pedido, row, index }) => [
      index, pedido.branchCode, pedido.supplierCode || '', pedido.supplierName, pedido.buyerCode, pedido.operationCode, pedido.paymentConditionCode, pedido.compraMinima, pedido.status,
      row.idmateriaprima, row.nome, row.artigo, row.codigoFornecedor, row.periodoCritico, row.dataSugeridaEntrada,
      row.estoque, row.entradas, row.entradasAndamento, row.entradasForaPrazo, row.consumo, row.saldoMA, row.saldoPX, row.saldoUL, row.saldoQT, row.saldoQU,
      row.faltaBase, row.quantidadeSugerida, row.valorUnitario || pedido.valorUnitario
    ]);
    const csv = [header, ...csvRows]
      .map((arr) => arr.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(';'))
      .join('\n');
    downloadText(`pedidos_compra_plano_oficial_${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8;');
    setOkMsg('CSV de pedidos sugeridos gerado.');
  }

  function exportarPayloadTotvs() {
    if (!pedidosParaAbrir.length) {
      setError('Marque ao menos um pedido para abrir.');
      return;
    }
    const payload = montarPayloadTotvs(pedidosParaAbrir);
    downloadText(`payload_totvs_pedidos_compra_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8;');
    setOkMsg('JSON de payload TOTVS gerado.');
  }

  function montarPayloadTotvs(pedidos: PedidoDraft[]): PedidoTotvsPayload[] {
    // TOTVS espera orderDate no formato ISO 8601 - usar data local com hora 00:00:00
    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = String(agora.getMonth() + 1).padStart(2, '0');
    const dia = String(agora.getDate()).padStart(2, '0');
    const orderDate = `${ano}-${mes}-${dia}T00:00:00`;
    console.log('[montarPayloadTotvs] orderDate:', orderDate);
    return pedidos.map((pedido) => {
      // Primeiro, montar os items com valores arredondados
      const items = pedido.items.map((row) => {
        const value = Math.round((row.valorUnitario || pedido.valorUnitario || 0) * 1000) / 1000;
        const quantity = Math.round(row.quantidadeSugerida || 0);
        return {
          productCode: Number(row.idmateriaprima),
          value,
          quantity,
        };
      });
      // Calcular o total usando exatamente os mesmos valores arredondados
      const totalAmountOrder = Math.round(items.reduce((acc, item) => acc + item.value * item.quantity, 0) * 1000) / 1000;
      return {
        branchCode: pedido.branchCode,
        supplierCode: pedido.supplierCode,
        buyerCode: pedido.buyerCode,
        operationCode: pedido.operationCode,
        paymentConditionCode: pedido.paymentConditionCode,
        status: pedido.status,
        orderDate,
        totalAmountOrder,
        items,
        observations: [
          {
            observation: `Pedido sugerido pelo plano de producao. Datas sugeridas: ${pedido.items.map((row) => `${row.idmateriaprima}=${row.dataSugeridaEntrada}`).join(', ')}`,
            visualizationType: 1,
          },
        ],
      };
    });
  }

  const [enviandoTodos, setEnviandoTodos] = useState(false);

  async function enviarTodosPedidos() {
    if (!pedidosValidosEnvio.length) {
      setError('Nenhum pedido valido para enviar. Verifique fornecedor e precos.');
      return;
    }
    setError(null);
    setOkMsg(null);
    setEnviandoTodos(true);

    let enviados = 0;
    let erros: string[] = [];

    for (const pedido of pedidosValidosEnvio) {
      // Pular se já foi enviado
      if (pedidosEnviados[pedido.key]?.orderCode) {
        enviados++;
        continue;
      }
      setPedidosEnviando((prev) => new Set(prev).add(pedido.key));
      try {
        const payload = montarPayloadTotvs([pedido])[0];
        const response = await fetchNoCache(`${API_URL}/api/totvs-moda/purchase-orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok || !result?.success) {
          erros.push(`${pedido.supplierName}: ${result?.error || 'Erro desconhecido'}`);
        } else {
          const branchCode = Number(result.data?.branchCode || pedido.branchCode || 0);
          const orderCode = Number(result.data?.orderCode || 0);
          if (orderCode) {
            setPedidosEnviados((prev) => ({
              ...prev,
              [pedido.key]: { branchCode, orderCode, raw: result.data },
            }));
            setPedidosNaoAbrir((prev) => new Set(prev).add(pedido.key));
            enviados++;
          } else {
            erros.push(`${pedido.supplierName}: TOTVS nao retornou orderCode`);
          }
        }
      } catch (e) {
        erros.push(`${pedido.supplierName}: ${e instanceof Error ? e.message : 'Erro'}`);
      } finally {
        setPedidosEnviando((prev) => {
          const next = new Set(prev);
          next.delete(pedido.key);
          return next;
        });
      }
    }

    setEnviandoTodos(false);
    if (erros.length > 0) {
      setError(`Erros ao enviar: ${erros.join(' | ')}`);
    }
    if (enviados > 0) {
      setOkMsg(`${enviados} pedido(s) enviado(s) com sucesso para TOTVS.`);
    }
  }

  async function aprovarEnviarPedido(pedido: PedidoDraft) {
    if (!pedido.supplierCode) {
      setError(`Pedido ${pedido.supplierName} sem fornecedor cadastrado.`);
      return;
    }
    const itemSemValor = pedido.items.find((item) => Number(item.valorUnitario || pedido.valorUnitario || 0) <= 0);
    if (itemSemValor) {
      setError(`Nao foi possivel enviar: MP ${itemSemValor.idmateriaprima} esta sem custo/preco TOTVS. O pedido ficaria com valor zerado.`);
      return;
    }
    if (Number(pedido.totalAmountOrder || 0) <= 0) {
      setError('Nao foi possivel enviar: pedido com valor total zerado.');
      return;
    }
    setError(null);
    setOkMsg(null);
    setPedidosEnviando((prev) => new Set(prev).add(pedido.key));
    try {
      const payload = montarPayloadTotvs([pedido])[0];
      const response = await fetchNoCache(`${API_URL}/api/totvs-moda/purchase-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result?.success) throw new Error(result?.error || 'Erro ao enviar pedido para TOTVS');
      const branchCode = Number(result.data?.branchCode || pedido.branchCode || 0);
      const orderCode = Number(result.data?.orderCode || 0);
      if (!orderCode) throw new Error(`Pedido enviado, mas a TOTVS nao retornou orderCode. Retorno: ${JSON.stringify(result.data || {})}`);

      setPedidosEnviados((prev) => ({
        ...prev,
        [pedido.key]: { branchCode, orderCode, raw: result.data },
      }));
      setPedidosNaoAbrir((prev) => new Set(prev).add(pedido.key));
      setOkMsg(`Pedido de ${pedido.supplierName} enviado para a TOTVS. Numero ${orderCode}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar pedido para TOTVS');
    } finally {
      setPedidosEnviando((prev) => {
        const next = new Set(prev);
        next.delete(pedido.key);
        return next;
      });
    }
  }

  async function cancelarPedidoTeste(pedido: PedidoDraft) {
    const enviado = pedidosEnviados[pedido.key];
    if (!enviado?.orderCode) {
      setError('Envie o pedido antes de cancelar o teste.');
      return;
    }
    setError(null);
    setOkMsg(null);
    setPedidosCancelando((prev) => new Set(prev).add(pedido.key));
    try {
      const response = await fetchNoCache(`${API_URL}/api/totvs-moda/purchase-orders/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ branchCode: enviado.branchCode, orderCode: enviado.orderCode }),
      });
      const result = await response.json();
      if (!response.ok || !result?.success) throw new Error(result?.error || 'Erro ao cancelar pedido na TOTVS');
      // Remover do estado de enviados para permitir reenvio
      setPedidosEnviados((prev) => {
        const next = { ...prev };
        delete next[pedido.key];
        return next;
      });
      // Remover do estado de "nao abrir" para voltar a aparecer como pendente
      setPedidosNaoAbrir((prev) => {
        const next = new Set(prev);
        next.delete(pedido.key);
        return next;
      });
      setOkMsg(`Pedido TOTVS ${enviado.orderCode} cancelado. Voce pode reenviar se necessario.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao cancelar pedido na TOTVS');
    } finally {
      setPedidosCancelando((prev) => {
        const next = new Set(prev);
        next.delete(pedido.key);
        return next;
      });
    }
  }

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 min-w-0 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="bg-brand-primary shadow-sm px-6 py-3 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-white font-bold font-secondary tracking-wide text-base">PEDIDO DE COMPRA</h1>
            <p className="text-white/70 text-xs">Sugestao de compra de MP com base no plano oficial capturado do banco</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={enviarTodosPedidos}
              disabled={pedidosValidosEnvio.length === 0 || enviandoTodos}
              className="px-4 py-2 rounded bg-emerald-600 text-white text-xs font-semibold disabled:opacity-60"
              title={pedidosParaAbrir.length > 0 && pedidosValidosEnvio.length === 0 ? 'Nenhum pedido valido para envio (verificar fornecedor e precos)' : undefined}
            >
              {enviandoTodos ? 'Enviando...' : `Enviar todos TOTVS (${pedidosValidosEnvio.length})`}
            </button>
            <button onClick={exportarPayloadTotvs} disabled={pedidosParaAbrir.length === 0} className="px-4 py-2 rounded bg-white text-brand-primary text-xs font-semibold disabled:opacity-60">
              Exportar JSON TOTVS
            </button>
            <button onClick={exportarCSV} disabled={pedidosParaAbrir.length === 0} className="px-4 py-2 rounded bg-white/90 text-brand-primary text-xs font-semibold disabled:opacity-60">
              Exportar CSV
            </button>
          </div>
        </header>

        <main className="flex-1 min-w-0 px-6 py-5 space-y-4">
          {loading && <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-500">Carregando plano oficial...</div>}
          {calculating && <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-500">Calculando MP, estoque e compras...</div>}
          {loadingPrices && <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-500">Consultando precos das MPs na TOTVS...</div>}
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}
          {priceWarning && <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">{priceWarning}</div>}
          {okMsg && <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700">{okMsg}</div>}

          <section className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs font-semibold text-gray-700">
                Plano
                <div className="mt-1 px-3 py-2 rounded border border-gray-200 bg-gray-50 text-sm font-semibold text-brand-dark">Oficial do banco - MA/PX/UL/QT/QU</div>
              </label>
              <label className="text-xs font-semibold text-gray-700">
                Continuidade
                <select value={continuidadeFiltro} onChange={(e) => setContinuidadeFiltro(e.target.value)} className="block mt-1 border border-gray-300 rounded px-2 py-2 text-sm font-normal">
                  {continuidades.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-gray-700">
                Horizonte compra
                <select value={periodoCompra} onChange={(e) => setPeriodoCompra(e.target.value as PeriodoCompra)} className="block mt-1 border border-gray-300 rounded px-2 py-2 text-sm font-normal">
                  <option value="ATE_QU">Ate QU</option>
                  <option value="MA">MA</option>
                  <option value="PX">PX</option>
                  <option value="UL">UL</option>
                  <option value="QT">QT</option>
                  <option value="QU">QU</option>
                </select>
              </label>
              <div className="text-xs font-semibold text-gray-700">
                Artigo
                <div className="relative mt-1">
                  <button
                    type="button"
                    onClick={() => setArtigoDropdownOpen((v) => !v)}
                    className="w-[220px] rounded border border-gray-300 bg-white px-2 py-2 text-left text-sm font-normal text-gray-800"
                  >
                    {artigosDisponiveis.length === 0
                      ? 'Sem artigos'
                      : artigosSelecionados.length === artigosDisponiveis.length
                        ? 'Todos'
                        : `${artigosSelecionados.length}/${artigosDisponiveis.length} artigos`}
                  </button>
                  {artigoDropdownOpen && (
                    <div className="absolute left-0 top-[42px] z-50 w-[280px] rounded border border-gray-200 bg-white shadow-lg">
                      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-2 py-1.5">
                        <span className="text-[11px] font-normal text-gray-500">{artigosSelecionados.length}/{artigosDisponiveis.length} selecionados</span>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={selecionarTodosArtigos} className="px-2 py-1 rounded text-[11px] font-semibold text-brand-dark hover:bg-gray-100">Todos</button>
                          <button type="button" onClick={limparTodosArtigos} className="px-2 py-1 rounded text-[11px] font-semibold text-brand-dark hover:bg-gray-100">Nenhum</button>
                        </div>
                      </div>
                      <div className="max-h-56 overflow-y-auto p-1">
                        {artigosDisponiveis.map((artigo) => (
                          <label key={artigo} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs font-normal text-gray-700 hover:bg-gray-50">
                            <input type="checkbox" checked={!artigosDesmarcados.has(artigo)} onChange={() => toggleArtigoFiltro(artigo)} />
                            <span className="truncate" title={artigo}>{artigo}</span>
                          </label>
                        ))}
                        {artigosDisponiveis.length === 0 && <div className="px-2 py-2 text-xs font-normal text-gray-400">Calcule a sugestao para listar artigos.</div>}
                      </div>
                      <div className="border-t border-gray-100 px-2 py-1.5 text-right">
                        <button type="button" onClick={() => setArtigoDropdownOpen(false)} className="px-2 py-1 rounded text-[11px] font-semibold text-brand-dark hover:bg-gray-100">Fechar</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <button onClick={carregarPlanoOficial} disabled={loading || calculating} className="px-4 py-2 rounded bg-brand-primary text-white text-sm font-semibold disabled:opacity-60">
                {loading ? 'Carregando...' : 'Atualizar do banco'}
              </button>
              <button onClick={calcularSugestao} disabled={loading || calculating || planosOficiais.length === 0} className="px-4 py-2 rounded bg-red-700 text-white text-sm font-semibold disabled:opacity-60">
                {calculating ? 'Calculando...' : 'Calcular sugestao'}
              </button>
            </div>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-10 gap-3">
            <Card label="SKUs plano" value={fmt(resumo.skusPlano)} tone="stone" />
            <Card label="Plano MA" value={fmt(resumo.planoMA)} tone="stone" />
            <Card label="Plano PX" value={fmt(resumo.planoPX)} tone="stone" />
            <Card label="Plano UL" value={fmt(resumo.planoUL)} tone="stone" />
            <Card label="Plano QT" value={fmt(resumo.planoQT)} tone="stone" />
            <Card label="Plano QU" value={fmt(resumo.planoQU)} tone="stone" />
            <Card label="Falta base" value={fmt(resumo.faltaBase)} tone="red" />
            <Card label="Comprar" value={fmt(resumo.compra)} tone="red" />
            <Card label="Pedidos" value={fmt(resumo.pedidos)} tone="amber" />
            <Card label="Valor pedidos" value={`R$ ${fmt(valorTotalPedidos, 2)}`} tone="amber" />
          </section>

          {/* Orcamento por horizonte */}
          <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200">
              <div className="text-sm font-semibold text-brand-dark">Orcamento por horizonte de compra</div>
              <div className="text-xs text-gray-500">Visao acumulada: quanto gastaria para cobrir tudo ate cada horizonte, sem recomprar o que ja esta em pedido.</div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold text-gray-700 min-w-[240px]">Horizonte / Artigo</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-gray-700">MPs c/ falta</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-gray-700">MPs s/ preco</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-gray-700">Qtd. compra</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-gray-700">Valor estimado</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-gray-700">Qtd. adicional</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-gray-700">Valor adicional</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-gray-700">Data sugerida</th>
                  </tr>
                </thead>
                <tbody>
                  {(['MA', 'PX', 'UL', 'QT', 'QU'] as const).map((periodo) => {
                    const orc = orcamentoPorPeriodo[periodo];
                    const expanded = orcamentoExpandidos.has(periodo);
                    const artigosPeriodo = orcamentoPorArtigo.filter((row) => row[periodo].itensComFalta > 0);
                    return (
                      <Fragment key={periodo}>
                        <tr className="border-t border-gray-100 bg-white hover:bg-gray-50">
                          <td className="px-4 py-2.5">
                            <button type="button" onClick={() => toggleOrcamentoPeriodo(periodo)} className="flex items-center gap-2 text-left font-semibold text-brand-dark">
                              <span className="inline-flex w-5 justify-center text-xs font-bold">{expanded ? 'v' : '>'}</span>
                              Ate {periodo}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-700">{fmt(orc.itensComFalta)}</td>
                          <td className="px-4 py-2.5 text-right text-amber-600 font-semibold">{orc.itensSemPreco > 0 ? fmt(orc.itensSemPreco) : '-'}</td>
                          <td className="px-4 py-2.5 text-right text-red-700 font-semibold">{fmt(orc.qtdTotal)}</td>
                          <td className="px-4 py-2.5 text-right text-emerald-700 font-bold">R$ {fmt(orc.valorTotal, 2)}</td>
                          <td className={`px-4 py-2.5 text-right font-semibold ${orc.qtdIncremental > 0 ? 'text-red-700' : 'text-gray-400'}`}>{orc.qtdIncremental > 0 ? fmt(orc.qtdIncremental) : '-'}</td>
                          <td className={`px-4 py-2.5 text-right font-bold ${orc.valorIncremental > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>{orc.valorIncremental > 0 ? `R$ ${fmt(orc.valorIncremental, 2)}` : '-'}</td>
                          <td className="px-4 py-2.5 text-right text-gray-700">{dataSugeridaCompra(periodo)}</td>
                        </tr>
                        {expanded && artigosPeriodo.map((row) => {
                          const detalhe = row[periodo];
                          return (
                            <tr key={`${periodo}-${row.artigo}`} className="border-t border-gray-100 bg-stone-50 hover:bg-stone-100">
                              <td className="px-4 py-2.5 pl-12 font-semibold text-gray-700" title={row.artigo}>{row.artigo}</td>
                              <td className="px-4 py-2.5 text-right text-gray-600">{fmt(detalhe.itensComFalta)}</td>
                              <td className="px-4 py-2.5 text-right text-amber-600 font-semibold">{detalhe.itensSemPreco > 0 ? fmt(detalhe.itensSemPreco) : '-'}</td>
                              <td className="px-4 py-2.5 text-right text-red-700 font-semibold">{fmt(detalhe.qtdTotal)}</td>
                              <td className={`px-4 py-2.5 text-right font-bold ${detalhe.valorTotal > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>{detalhe.valorTotal > 0 ? `R$ ${fmt(detalhe.valorTotal, 2)}` : 'Sem preco'}</td>
                              <td className={`px-4 py-2.5 text-right font-semibold ${detalhe.qtdIncremental > 0 ? 'text-red-700' : 'text-gray-400'}`}>{detalhe.qtdIncremental > 0 ? fmt(detalhe.qtdIncremental) : '-'}</td>
                              <td className={`px-4 py-2.5 text-right font-bold ${detalhe.valorIncremental > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>{detalhe.valorIncremental > 0 ? `R$ ${fmt(detalhe.valorIncremental, 2)}` : '-'}</td>
                              <td className="px-4 py-2.5 text-right text-gray-500">{dataSugeridaCompra(periodo)}</td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {compraRows.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-gray-500">Clique em "Calcular sugestao" para ver o orcamento.</div>
            )}
          </section>

          <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-brand-dark">Resumo por artigo</div>
              </div>
              <div className="text-xs text-gray-500">{resumoArtigo.length} artigos no recorte</div>
            </div>
            <div className="px-4 py-3 flex flex-wrap gap-2">
              {resumoArtigo.slice(0, 12).map((row) => (
                <button
                  key={row.artigo}
                  onClick={() => {
                    setArtigosDesmarcados(new Set(artigosDisponiveis.filter((artigo) => artigo !== row.artigo)));
                  }}
                  className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-left hover:bg-gray-100"
                  title={row.artigo}
                >
                  <div className="max-w-[180px] truncate text-xs font-semibold text-brand-dark">{row.artigo}</div>
                  <div className="text-[11px] text-gray-500">{fmt(row.itens)} MPs | comprar {fmt(row.compra)}</div>
                </button>
              ))}
              {resumoArtigo.length === 0 && <div className="text-sm text-gray-500">Sem compra sugerida neste recorte.</div>}
            </div>
          </section>

          <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-brand-dark">Agenda por data e pedidos</div>
                <div className="text-xs text-gray-500">Somente pedidos ja comprados que precisam reprogramacao ou acompanhamento por estarem fora da regra.</div>
              </div>
              <div className="text-xs text-gray-500">{agendaChegadaPorData.reduce((acc, row) => acc + row.itens.length, 0)} eventos na agenda</div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-semibold text-gray-700 min-w-[240px]">Data regra</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-700">Pedidos</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-700">Artigos</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-700">Consumo aprox.</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-700">Qtd. pedidos</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-700">Fora prazo</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-700">Fora horizonte</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-gray-700 min-w-[360px]">Leitura</th>
                    <th className="px-3 py-2.5 text-center font-semibold text-gray-700">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {agendaChegadaPorData.map((agenda) => {
                    const expanded = agendaExpandidos.has(agenda.periodo);
                    const status = agenda.foraHorizonte > 0
                      ? 'Fora horizonte'
                      : agenda.foraPrazo > 0
                        ? 'Reprogramar'
                        : 'Sem evento';
                    const leitura = agenda.itens.length === 0
                      ? 'Nenhum pedido comprado fora da regra nesta data.'
                      : `${fmt(agenda.quantidadePedidos)} comprado precisa revisao para chegar ate ${agenda.dataRegra}.`;
                    return (
                      <Fragment key={agenda.periodo}>
                        <tr className="border-t border-gray-100 bg-white hover:bg-gray-50">
                          <td className="px-3 py-2.5">
                            <button type="button" onClick={() => toggleAgendaPeriodo(agenda.periodo)} className="flex items-center gap-2 text-left font-bold text-brand-dark">
                              <span className="inline-flex w-5 justify-center text-xs">{expanded ? 'v' : '>'}</span>
                              <span>{agenda.periodo} | {agenda.dataRegra}</span>
                            </button>
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-700">{fmt(agenda.pedidos)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-700">{fmt(agenda.artigos)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-700">{fmt(agenda.consumoAteData)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-gray-700">{fmt(agenda.quantidadePedidos)}</td>
                          <td className={`px-3 py-2.5 text-right font-semibold ${agenda.foraPrazo > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{agenda.foraPrazo > 0 ? fmt(agenda.foraPrazo) : '-'}</td>
                          <td className={`px-3 py-2.5 text-right font-semibold ${agenda.foraHorizonte > 0 ? 'text-red-700' : 'text-gray-400'}`}>{agenda.foraHorizonte > 0 ? fmt(agenda.foraHorizonte) : '-'}</td>
                          <td className="px-3 py-2.5 text-gray-700">{leitura}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={`inline-flex px-2 py-1 rounded font-semibold ${agenda.foraHorizonte > 0 ? 'bg-red-50 text-red-700' : agenda.foraPrazo > 0 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{status}</span>
                          </td>
                        </tr>
                        {expanded && agenda.artigosRows.map((artigo) => {
                          const artigoOpen = agendaExpandidos.has(artigo.key);
                          const statusArtigo = artigo.foraHorizonte > 0
                              ? 'Fora horizonte'
                              : artigo.foraPrazo > 0
                                ? 'Reprogramar'
                                : 'Sem evento';
                          return (
                            <Fragment key={artigo.key}>
                              <tr className="border-t border-gray-100 bg-stone-50 hover:bg-stone-100">
                                <td className="px-3 py-2.5 pl-12">
                                  <button type="button" onClick={() => toggleAgendaPeriodo(artigo.key)} className="flex items-center gap-2 text-left font-semibold text-brand-dark">
                                    <span className="inline-flex w-5 justify-center text-xs">{artigoOpen ? 'v' : '>'}</span>
                                    <span className="max-w-[320px] truncate" title={artigo.artigo}>{artigo.artigo}</span>
                                  </button>
                                </td>
                                <td className="px-3 py-2.5 text-right text-gray-700">{fmt(artigo.pedidos)}</td>
                                <td className="px-3 py-2.5 text-right text-gray-700">{fmt(artigo.mps)}</td>
                                <td className="px-3 py-2.5 text-right text-gray-700">{fmt(artigo.consumoAteData)}</td>
                                <td className="px-3 py-2.5 text-right font-semibold text-gray-700">{artigo.quantidadePedidos > 0 ? fmt(artigo.quantidadePedidos) : '-'}</td>
                                <td className={`px-3 py-2.5 text-right font-semibold ${artigo.foraPrazo > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{artigo.foraPrazo > 0 ? fmt(artigo.foraPrazo) : '-'}</td>
                                <td className={`px-3 py-2.5 text-right font-semibold ${artigo.foraHorizonte > 0 ? 'text-red-700' : 'text-gray-400'}`}>{artigo.foraHorizonte > 0 ? fmt(artigo.foraHorizonte) : '-'}</td>
                                <td className="px-3 py-2.5 text-gray-700">{artigo.foraPrazo > 0 || artigo.foraHorizonte > 0 ? 'Ver pedidos abaixo para reprogramar' : 'Sem pedidos fora da regra'}</td>
                                <td className="px-3 py-2.5 text-center">
                                  <span className={`inline-flex px-2 py-1 rounded font-semibold ${artigo.foraHorizonte > 0 ? 'bg-red-50 text-red-700' : artigo.foraPrazo > 0 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{statusArtigo}</span>
                                </td>
                              </tr>
                              {artigoOpen && artigo.itens.map((item) => (
                                <tr key={item.key} className="border-t border-gray-100 bg-white hover:bg-gray-50">
                                  <td className="px-3 py-2.5 pl-20">
                                    <div className="font-semibold text-brand-dark">{item.idmateriaprima}</div>
                                    <div className="text-[11px] text-gray-500">{item.pedido} {item.dataPedido !== '-' ? `| previsto ${item.dataPedido}` : `| deve chegar ate ${item.dataRegra}`}</div>
                                    <div className="text-[11px] text-gray-400 max-w-[360px] truncate" title={item.nome}>{item.nome}</div>
                                  </td>
                                  <td className="px-3 py-2.5 text-right text-gray-600">1</td>
                                  <td className="px-3 py-2.5 text-right text-gray-600">1</td>
                                  <td className="px-3 py-2.5 text-right text-gray-700">{fmt(item.consumoAteData)}</td>
                                  <td className="px-3 py-2.5 text-right font-semibold text-gray-700">{item.quantidade > 0 ? fmt(item.quantidade) : '-'}</td>
                                  <td className={`px-3 py-2.5 text-right font-semibold ${item.tipo === 'PEDIDO_FORA_PRAZO' ? 'text-amber-700' : 'text-gray-400'}`}>{item.tipo === 'PEDIDO_FORA_PRAZO' ? fmt(item.quantidade) : '-'}</td>
                                  <td className={`px-3 py-2.5 text-right font-semibold ${item.tipo === 'PEDIDO_FORA_HORIZONTE' ? 'text-red-700' : 'text-gray-400'}`}>{item.tipo === 'PEDIDO_FORA_HORIZONTE' ? fmt(item.quantidade) : '-'}</td>
                                  <td className="px-3 py-2.5 text-gray-700">{item.guia}</td>
                                  <td className="px-3 py-2.5 text-center">
                                    {item.tipo === 'PEDIDO_FORA_HORIZONTE' ? (
                                      <span className="inline-flex px-2 py-1 rounded bg-red-50 text-red-700 font-semibold">Fora horizonte</span>
                                    ) : item.tipo === 'PEDIDO_FORA_PRAZO' ? (
                                      <span className="inline-flex px-2 py-1 rounded bg-amber-50 text-amber-700 font-semibold">Reprogramar</span>
                                    ) : null}
                                  </td>
                                </tr>
                              ))}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-brand-dark">Analise dos pedidos de compra x plano</div>
                <div className="text-xs text-gray-500">Matriz por artigo para entender o que esta comprado, fora do prazo, fora do horizonte e o saldo liquido que ainda precisa comprar.</div>
              </div>
              <div className="text-xs text-gray-500">{analiseComprasPlanoPorArtigo.length} artigos | {analiseComprasPlano.length} MPs analisadas</div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-semibold text-gray-700 min-w-[300px]">Artigo / Materia-prima</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-700">MPs</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-700">Consumo</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-700">Estoque</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-700">Comprado total</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-700">No prazo</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-700">Fora prazo</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-700">Fora horizonte</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-700">Comprar liquido</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-gray-700 min-w-[360px]">Guia de chegada</th>
                    <th className="px-3 py-2.5 text-center font-semibold text-gray-700">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {analiseComprasPlanoPorArtigo.map((artigo) => {
                    const expanded = analiseArtigosExpandidos.has(artigo.artigo);
                    const statusArtigo = artigo.compraAdicional > 0
                      ? 'Comprar'
                      : artigo.comprasForaHorizonte > 0
                        ? 'Fora horizonte'
                        : artigo.comprasForaPrazo > 0
                          ? 'Fora prazo'
                          : 'Coberto';
                    return (
                      <Fragment key={artigo.artigo}>
                        <tr className="border-t border-gray-100 bg-white hover:bg-gray-50">
                          <td className="px-3 py-2.5">
                            <button type="button" onClick={() => toggleAnaliseArtigo(artigo.artigo)} className="flex items-center gap-2 text-left font-bold text-brand-dark">
                              <span className="inline-flex w-5 justify-center text-xs">{expanded ? 'v' : '>'}</span>
                              <span className="max-w-[360px] truncate" title={artigo.artigo}>{artigo.artigo}</span>
                            </button>
                            <div className="ml-7 text-[11px] text-gray-500">
                              {artigo.comprarItens} MPs para comprar | {artigo.foraPrazoItens} fora prazo | {artigo.foraHorizonteItens} fora horizonte
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-700">{fmt(artigo.itens)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-700">{fmt(artigo.consumo)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-700">{fmt(artigo.estoque)}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-gray-700">{fmt(artigo.comprasAndamento)}</td>
                          <td className="px-3 py-2.5 text-right text-emerald-700 font-semibold">{artigo.comprasNoPrazo > 0 ? fmt(artigo.comprasNoPrazo) : '-'}</td>
                          <td className={`px-3 py-2.5 text-right font-semibold ${artigo.comprasForaPrazo > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{artigo.comprasForaPrazo > 0 ? fmt(artigo.comprasForaPrazo) : '-'}</td>
                          <td className={`px-3 py-2.5 text-right font-semibold ${artigo.comprasForaHorizonte > 0 ? 'text-red-700' : 'text-gray-400'}`}>{artigo.comprasForaHorizonte > 0 ? fmt(artigo.comprasForaHorizonte) : '-'}</td>
                          <td className={`px-3 py-2.5 text-right font-bold ${artigo.compraAdicional > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{artigo.compraAdicional > 0 ? fmt(artigo.compraAdicional) : '-'}</td>
                          <td className="px-3 py-2.5 text-gray-700">{guiaChegadaArtigo(artigo)}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={`inline-flex px-2 py-1 rounded font-semibold ${artigo.compraAdicional > 0 ? 'bg-red-50 text-red-700' : artigo.comprasForaHorizonte > 0 ? 'bg-red-50 text-red-700' : artigo.comprasForaPrazo > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{statusArtigo}</span>
                          </td>
                        </tr>
                        {expanded && artigo.rows.map((row) => (
                          <tr key={`${artigo.artigo}-${row.idmateriaprima}`} className="border-t border-gray-100 bg-stone-50 hover:bg-stone-100">
                            <td className="px-3 py-2.5 pl-12">
                              <div className="font-semibold text-brand-dark">{row.idmateriaprima}</div>
                              <div className="text-[11px] text-gray-500 max-w-[360px] truncate" title={row.nome}>{row.nome}</div>
                              <div className="text-[11px] text-gray-400">Periodo critico {row.periodoCritico} | regra {row.dataSugeridaEntrada}</div>
                              {row.pedidosDetalhe.length > 0 && (
                                <div className="mt-1 text-[11px] text-gray-500">
                                  Pedidos: {row.pedidosDetalhe.slice(0, 3).map((pedido) => `${pedido.pedido || '-'} ${String(pedido.data || '').slice(0, 10)} ${fmt(Number(pedido.quantidade || 0))} ${pedido.periodo || ''}`).join(' | ')}
                                  {row.pedidosDetalhe.length > 3 ? ` +${row.pedidosDetalhe.length - 3}` : ''}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right text-gray-500">1</td>
                            <td className="px-3 py-2.5 text-right text-gray-700">{fmt(row.consumo)}</td>
                            <td className="px-3 py-2.5 text-right text-gray-700">{fmt(row.estoque)}</td>
                            <td className="px-3 py-2.5 text-right font-semibold text-gray-700">{fmt(row.comprasAndamento)}</td>
                            <td className="px-3 py-2.5 text-right text-emerald-700 font-semibold">{row.comprasNoPrazo > 0 ? fmt(row.comprasNoPrazo) : '-'}</td>
                            <td className={`px-3 py-2.5 text-right font-semibold ${row.comprasForaPrazo > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{row.comprasForaPrazo > 0 ? fmt(row.comprasForaPrazo) : '-'}</td>
                            <td className={`px-3 py-2.5 text-right font-semibold ${row.comprasForaHorizonte > 0 ? 'text-red-700' : 'text-gray-400'}`}>{row.comprasForaHorizonte > 0 ? fmt(row.comprasForaHorizonte) : '-'}</td>
                            <td className={`px-3 py-2.5 text-right font-bold ${row.compraAdicional > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{row.compraAdicional > 0 ? fmt(row.compraAdicional) : '-'}</td>
                            <td className="px-3 py-2.5 text-gray-700">{guiaChegadaMp(row)}</td>
                            <td className="px-3 py-2.5 text-center">
                              {row.status === 'COMPRAR' ? (
                                <span className="inline-flex px-2 py-1 rounded bg-red-50 text-red-700 font-semibold">Comprar</span>
                              ) : row.status === 'FORA_HORIZONTE' ? (
                                <span className="inline-flex px-2 py-1 rounded bg-red-50 text-red-700 font-semibold">Fora horizonte</span>
                              ) : row.status === 'COMPRADO_FORA_PRAZO' ? (
                                <span className="inline-flex px-2 py-1 rounded bg-amber-50 text-amber-700 font-semibold">Fora prazo</span>
                              ) : (
                                <span className="inline-flex px-2 py-1 rounded bg-emerald-50 text-emerald-700 font-semibold">Comprado</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                  {analiseComprasPlanoPorArtigo.length === 0 && (
                    <tr><td colSpan={11} className="px-3 py-8 text-center text-sm text-gray-500">Clique em "Calcular sugestao" para comparar compras em andamento com o plano.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-brand-dark">Pedidos sugeridos</div>
                <div className="text-xs text-gray-500">Um rascunho por fornecedor, sempre com status Bloqueado</div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={marcarTodosPedidos} className="px-3 py-2 rounded border border-gray-300 text-xs font-semibold hover:bg-gray-50">Abrir todos</button>
                <button onClick={desmarcarTodosPedidos} className="px-3 py-2 rounded border border-gray-300 text-xs font-semibold hover:bg-gray-50">Nao abrir</button>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={somenteComCompra} onChange={(e) => setSomenteComCompra(e.target.checked)} />
                  Mostrar so faltas
                </label>
                <button onClick={selecionarVisiveis} className="px-3 py-2 rounded border border-gray-300 text-xs font-semibold hover:bg-gray-50">Selecionar</button>
                <button onClick={limparSelecao} className="px-3 py-2 rounded border border-gray-300 text-xs font-semibold hover:bg-gray-50">Limpar</button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-brand-dark text-white">
                  <tr>
                    <th className="px-3 py-2.5 text-center w-[64px]">Abrir</th>
                    <th className="px-3 py-2.5 text-left min-w-[360px]">Pedido / Item</th>
                    <th className="px-3 py-2.5 text-right">Compra min.</th>
                    <th className="px-3 py-2.5 text-right">Itens</th>
                    <th className="px-3 py-2.5 text-right">Falta</th>
                    <th className="px-3 py-2.5 text-right">Qtd.</th>
                    <th className="px-3 py-2.5 text-right">Total</th>
                    <th className="px-3 py-2.5 text-center">Status</th>
                    <th className="px-3 py-2.5 text-center">Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {pedidosDraft.map((pedido, index) => {
                    const abrir = !pedidosNaoAbrir.has(pedido.key);
                    const expanded = pedidosExpandidos.has(pedido.key);
                    const enviando = pedidosEnviando.has(pedido.key);
                    const enviadoInfo = pedidosEnviados[pedido.key];
                    const enviado = Boolean(enviadoInfo);
                    const cancelando = pedidosCancelando.has(pedido.key);
                    const quantidade = pedido.items.reduce((acc, item) => acc + Number(item.quantidadeSugerida || 0), 0);
                    const falta = pedido.items.reduce((acc, item) => acc + Number(item.faltaBase || 0), 0);
                    return (
                      <Fragment key={pedido.key}>
                        <tr key={`${pedido.key}-pedido`} className={`${abrir ? 'bg-stone-100 hover:bg-stone-200' : 'bg-gray-100 text-gray-400'} border-t border-white`}>
                          <td className="px-3 py-2.5 text-center">
                            <input type="checkbox" checked={abrir} onChange={() => toggleAbrirPedido(pedido.key)} />
                          </td>
                          <td className="px-3 py-2.5">
                            <button type="button" onClick={() => toggleDetalhesPedido(pedido.key)} className="text-left w-full">
                              <div className="flex items-center gap-2">
                                <span className="inline-flex w-5 justify-center text-xs font-bold text-brand-dark">{expanded ? 'v' : '>'}</span>
                                <span className="font-bold text-brand-dark">Pedido sugerido #{index + 1}</span>
                                <span className={`text-xs ${pedido.supplierCode ? 'text-gray-500' : 'text-red-600 font-semibold'}`}>Fornecedor {pedido.supplierCode || 'sem cadastro'}</span>
                                {enviadoInfo?.orderCode && <span className="text-xs font-semibold text-emerald-700">TOTVS {enviadoInfo.orderCode}</span>}
                              </div>
                              <div className="ml-7 text-xs text-gray-600 truncate" title={pedido.supplierName}>{pedido.supplierName}</div>
                            </button>
                          </td>
                          <td className="px-2 py-2.5 text-right">
                            <input value={pedido.compraMinima} onChange={(e) => updatePedidoConfig(pedido.key, 'compraMinima', Number(e.target.value || 0))} type="number" min={0} className="w-20 rounded border border-gray-300 px-1.5 py-1 text-right text-xs text-gray-800" />
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold">{fmt(pedido.items.length)}</td>
                          <td className="px-3 py-2.5 text-right text-red-700 font-semibold">{fmt(falta)}</td>
                          <td className="px-3 py-2.5 text-right font-bold">{fmt(quantidade)}</td>
                          <td className="px-3 py-2.5 text-right">{fmt(pedido.totalAmountOrder, 2)}</td>
                          <td className="px-3 py-2.5 text-center">
                            {enviadoInfo?.cancelado ? (
                              <span className="inline-flex px-2 py-1 rounded bg-gray-100 text-gray-600 text-xs font-semibold">Cancelado</span>
                            ) : enviado ? (
                              <span className="inline-flex px-2 py-1 rounded bg-emerald-50 text-emerald-700 text-xs font-semibold">Enviado</span>
                            ) : (
                              <span className="inline-flex px-2 py-1 rounded bg-red-50 text-red-700 text-xs font-semibold">Bloqueado</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => aprovarEnviarPedido(pedido)}
                                disabled={!abrir || enviando || enviado || pedido.items.length === 0 || !pedido.supplierCode}
                                className="px-3 py-1.5 rounded bg-emerald-600 text-white text-xs font-semibold disabled:opacity-60"
                                title={!pedido.supplierCode ? 'Fornecedor sem cadastro no sistema' : undefined}
                              >
                                {enviando ? 'Enviando...' : enviado ? 'Enviado' : 'Aprovar e enviar'}
                              </button>
                              {enviadoInfo?.orderCode && !enviadoInfo.cancelado && (
                                <button
                                  onClick={() => cancelarPedidoTeste(pedido)}
                                  disabled={cancelando}
                                  className="px-3 py-1.5 rounded border border-red-300 bg-red-50 text-red-700 text-xs font-semibold disabled:opacity-60"
                                >
                                  {cancelando ? 'Cancelando...' : 'Cancelar teste'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expanded && gruposArtigoPedido(pedido).map((grupo) => {
                          const artigoOpen = artigosExpandidos.has(grupo.key);
                          return (
                            <Fragment key={grupo.key}>
                              <tr className="border-t border-gray-200 bg-amber-50 hover:bg-amber-100">
                                <td className="px-3 py-2 text-center">-</td>
                                <td className="px-3 py-2">
                                  <button type="button" onClick={() => toggleArtigoPedido(grupo.key)} className="text-left w-full">
                                    <div className="ml-7 flex items-center gap-2">
                                      <span className="inline-flex w-5 justify-center text-xs font-bold text-amber-900">{artigoOpen ? 'v' : '>'}</span>
                                      <span className="font-bold text-amber-900">{grupo.artigo}</span>
                                      <span className="text-xs text-amber-700">{fmt(grupo.items.length)} MPs</span>
                                    </div>
                                  </button>
                                </td>
                                <td className="px-3 py-2 text-right">Cons. {fmt(grupo.consumo)}</td>
                                <td className="px-3 py-2 text-right font-semibold">{fmt(grupo.items.length)}</td>
                                <td className="px-3 py-2 text-right text-red-700 font-semibold">{fmt(grupo.falta)}</td>
                                <td className="px-3 py-2 text-right text-red-700 font-bold">{fmt(grupo.quantidade)}</td>
                                <td className="px-3 py-2 text-right">{fmt(grupo.items.reduce((acc, item) => acc + Number(item.quantidadeSugerida || 0) * Number(item.valorUnitario || pedido.valorUnitario || 0), 0), 2)}</td>
                                <td className="px-3 py-2 text-center text-amber-900 font-semibold">Artigo</td>
                                <td className="px-3 py-2" />
                              </tr>
                              {artigoOpen && grupo.items.map((row) => (
                                <tr key={`${pedido.key}-${row.idmateriaprima}`} className="border-t border-gray-100 bg-white hover:bg-gray-50">
                                  <td className="px-3 py-2 text-center">
                                    <input type="checkbox" checked={selecionados.has(row.idmateriaprima)} onChange={() => toggleSelecionado(row.idmateriaprima)} />
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="ml-14">
                                      <div className="font-semibold text-brand-dark">{row.idmateriaprima}</div>
                                      <div className="text-xs text-gray-500 max-w-[360px] truncate" title={row.nome}>{row.nome}</div>
                                      {row.codigoFornecedor && <div className="text-xs text-gray-400">Cod. forn.: {row.codigoFornecedor}</div>}
                                      <div className="text-xs text-gray-400">Entrada sugerida: {row.dataSugeridaEntrada}</div>
                                      <div className="mt-1 text-[11px] font-semibold text-emerald-700">Compra atende: {row.compraAtende}</div>
                                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
                                        {row.coberturaResumo.map((linha) => <span key={linha}>{linha}</span>)}
                                      </div>
                                      {row.coberturaPedidos.length > 0 && (
                                        <div className="mt-1 space-y-0.5 text-[11px] text-amber-700">
                                          {row.coberturaPedidos.map((linha) => <div key={linha}>{linha}</div>)}
                                        </div>
                                      )}
                                      {row.riscoCobertura && <div className="mt-1 text-[11px] font-semibold text-red-700">{row.riscoCobertura}</div>}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-right text-gray-500" colSpan={2}>{row.artigo}</td>
                                  <td className="px-3 py-2 text-right text-gray-600">
                                    <div>Est. {fmt(row.estoque)} | Ent. prazo {fmt(row.entradas)} | Cons. {fmt(row.consumo)}</div>
                                    {row.entradasForaPrazo > 0 && <div className="text-[11px] font-semibold text-amber-700">Em andamento fora do prazo: {fmt(row.entradasForaPrazo)}</div>}
                                  </td>
                                  <td className="px-3 py-2 text-right text-red-700 font-semibold">{fmt(row.faltaBase)}</td>
                                  <td className="px-3 py-2 text-right text-red-700 font-bold">{fmt(row.quantidadeSugerida)}</td>
                                  <td className="px-3 py-2 text-right">{fmt(row.quantidadeSugerida * Number(row.valorUnitario || pedido.valorUnitario || 0), 2)}</td>
                                  <td className="px-3 py-2 text-center font-semibold text-brand-dark">{row.periodoCritico}</td>
                                  <td className="px-3 py-2" />
                                </tr>
                              ))}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                  {pedidosDraft.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-gray-500">Nenhum pedido sugerido neste recorte.</td></tr>
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

function SaldoCell({ value }: { value: number }) {
  return (
    <td className={`px-3 py-2 text-right ${value < 0 ? 'text-red-700 font-semibold' : 'text-emerald-700'}`}>
      {fmt(value)}
    </td>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="text-[11px] uppercase text-gray-400">{label}</div>
      <div className="font-semibold text-brand-dark">{value}</div>
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone: 'red' | 'amber' | 'stone' }) {
  const toneMap = {
    red: 'bg-red-50 border-red-100 text-red-700',
    amber: 'bg-amber-50 border-amber-100 text-amber-700',
    stone: 'bg-stone-50 border-stone-200 text-stone-700',
  } as const;

  return (
    <div className={`rounded-lg border p-4 ${toneMap[tone]}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
