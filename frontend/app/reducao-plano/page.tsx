'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { PeriodosPlano, Planejamento, ProjecoesMap } from '../types';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';
import { projecaoMesPlanejamento } from '../lib/projecao';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MARCA_FIXA = 'LIEBE';
const STATUS_FIXO = 'EM LINHA';
const PERIODOS = ['MA', 'PX', 'UL', 'QT', 'QU', 'SX'] as const;
const EXTRA_MEIO_CORTE_MAX = 5000;
const EXTRA_TOLERANCIA_OPTIONS = [0, 2500, 5000, 7500, 10000];

type Periodo = typeof PERIODOS[number];
type PlanoCompleto = Record<Periodo, number>;
type ModoAnalise = 'SKU' | 'REFERENCIA';
type ReducaoRow = {
  chave: string;
  idproduto: string;
  referencia: string;
  produto: string;
  cor: string;
  tamanho: string;
  continuidade: string;
  linha: string;
  familia: string;
  curva: 'A' | 'B' | 'C' | 'D';
  estoqueMin: number;
  corteMin: number;
  plano: PlanoCompleto;
  disp: PlanoCompleto;
  target: Periodo;
  next: Periodo | null;
  menorSaldoFuturo: number;
  saldoMinimoFuturo: number;
  reducaoCorteInteiro: number;
  extraMeioCorte: number;
  reducaoSemTolerancia: number;
  extraTolerancia: number;
  reducaoSegura: number;
  planoTargetNovo: number;
  transferencia: number;
  planoNextNovo: number | null;
  dispTargetPosTransfer: number;
  refReducaoTotal?: number;
  refTransferenciaTotal?: number;
  refSkus?: number;
  refSkusBloqueados?: number;
};

function fmt(v: number) {
  return Math.round(v || 0).toLocaleString('pt-BR');
}

function norm(value: string) {
  return String(value || '').trim().toUpperCase();
}

function mesSeguinte(mes: number) {
  const m = Number(mes || 0);
  if (!Number.isFinite(m) || m <= 0) return 1;
  return (m % 12) + 1;
}

function roundDownByLot(qtd: number, lot: number) {
  const l = Math.max(1, Math.round(Number(lot || 0)));
  const q = Math.max(0, Number(qtd || 0));
  return Math.floor(q / l) * l;
}

function roundUpByLot(qtd: number, lot: number) {
  const l = Math.max(1, Math.round(Number(lot || 0)));
  const q = Math.max(0, Number(qtd || 0));
  return Math.ceil(q / l) * l;
}

function chaveItem(item: Planejamento) {
  const id = Number(item.produto.idproduto);
  if (Number.isFinite(id)) return `ID-${id}`;
  return `REF-${item.produto.referencia || ''}-${item.produto.cor || ''}-${item.produto.tamanho || ''}`;
}

function getPlano(item: Planejamento): PlanoCompleto {
  return {
    MA: Number(item.plano?.ma || 0),
    PX: Number(item.plano?.px || 0),
    UL: Number(item.plano?.ul || 0),
    QT: Number(item.plano?.qt || 0),
    QU: Number(item.plano?.qu || 0),
    SX: Number(item.plano?.sx || 0),
  };
}

function planoParaSnapshot(chave: string, plano: PlanoCompleto) {
  return {
    chave,
    ma: Math.round(plano.MA || 0),
    px: Math.round(plano.PX || 0),
    ul: Math.round(plano.UL || 0),
    qt: Math.round(plano.QT || 0),
    qu: Math.round(plano.QU || 0),
    sx: Math.round(plano.SX || 0),
  };
}

function mesesDoPlano(periodos: PeriodosPlano) {
  const qt = Number(periodos.QT || mesSeguinte(Number(periodos.UL || 0)));
  const qu = Number(periodos.QU || mesSeguinte(qt));
  return {
    MA: Number(periodos.MA || 1),
    PX: Number(periodos.PX || mesSeguinte(Number(periodos.MA || 1))),
    UL: Number(periodos.UL || mesSeguinte(Number(periodos.PX || 1))),
    QT: qt,
    QU: qu,
    SX: mesSeguinte(qu),
  } as Record<Periodo, number>;
}

function calcularDisp(item: Planejamento, projecoes: ProjecoesMap, periodos: PeriodosPlano, plano: PlanoCompleto): PlanoCompleto {
  const meses = mesesDoPlano(periodos);
  const proj = projecoes[String(item.produto.idproduto)] || {};
  const dispAtual = Number(item.estoques.estoque_atual || 0) - Number(item.demanda.pedidos_pendentes || 0);
  let saldo = dispAtual + Number(item.estoques.em_processo || 0);
  const result = {} as PlanoCompleto;
  for (const periodo of PERIODOS) {
    const mes = meses[periodo];
    const projMes = periodo === 'MA'
      ? projecaoMesPlanejamento(Number(proj[String(mes)] || 0), mes)
      : Number(proj[String(mes)] || 0);
    saldo = saldo + Number(plano[periodo] || 0) - projMes;
    result[periodo] = saldo;
  }
  return result;
}

export default function ReducaoPlanoPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [dados, setDados] = useState<Planejamento[]>([]);
  const [projecoes, setProjecoes] = useState<ProjecoesMap>({});
  const [periodos, setPeriodos] = useState<PeriodosPlano>({
    MA: new Date().getMonth() + 1,
    PX: new Date().getMonth() + 2,
    UL: new Date().getMonth() + 3,
  });
  const [cortes, setCortes] = useState<Record<string, number>>({});
  const [curvaABC, setCurvaABC] = useState<Record<string, 'A' | 'B' | 'C' | 'D'>>({});
  const [periodoAlvo, setPeriodoAlvo] = useState<Periodo>('PX');
  const [usarMeioCorte, setUsarMeioCorte] = useState(true);
  const [filtroCont, setFiltroCont] = useState('TODAS');
  const [filtroLinha, setFiltroLinha] = useState('TODAS');
  const [filtroFamilia, setFiltroFamilia] = useState('TODAS');
  const [somenteComReducao, setSomenteComReducao] = useState(true);
  const [coberturaMinimaFutura, setCoberturaMinimaFutura] = useState(0);
  const [limiteReducaoPct, setLimiteReducaoPct] = useState(100);
  const [limiteExtraTolerancia, setLimiteExtraTolerancia] = useState(0);
  const [modoAnalise, setModoAnalise] = useState<ModoAnalise>('SKU');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregar() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '5000', marca: MARCA_FIXA, status: STATUS_FIXO, prefer_cache: 'true' });
      const [rMatriz, rProj, rCortes, rCurva] = await Promise.all([
        fetchNoCache(`${API_URL}/api/producao/matriz?${params}`),
        fetchNoCache(`${API_URL}/api/projecoes`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/configuracoes/corte-minimos`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/analises/curva-abc-referencias`, { headers: authHeaders() }),
      ]);
      if (!rMatriz.ok || !rProj.ok || !rCortes.ok) throw new Error('Erro ao carregar dados de reducao');
      const pMatriz = await rMatriz.json();
      const pProj = await rProj.json();
      const pCortes = await rCortes.json();
      const pCurva = rCurva.ok ? await rCurva.json() : null;
      const mapaCortes: Record<string, number> = {};
      for (const item of Array.isArray(pCortes?.data) ? pCortes.data : []) {
        const id = String(item?.idproduto || '').trim();
        if (id) mapaCortes[id] = Number(item?.corte_min || 0);
      }
      setDados((pMatriz?.data || []) as Planejamento[]);
      setProjecoes((pProj?.data || {}) as ProjecoesMap);
      if (pProj?.periodos) setPeriodos(pProj.periodos as PeriodosPlano);
      setCortes(mapaCortes);
      setCurvaABC((pCurva?.porReferencia || {}) as Record<string, 'A' | 'B' | 'C' | 'D'>);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo<ReducaoRow[]>(() => {
    const targetIndex = PERIODOS.indexOf(periodoAlvo);
    const next = PERIODOS[targetIndex + 1] || null;
    return dados
      .filter((item) => {
        const marca = norm(item.produto?.marca || '');
        const status = norm(item.produto?.status || '');
        const continuidade = norm(item.produto?.continuidade || '');
        return marca === MARCA_FIXA && status.startsWith(STATUS_FIXO) && ['PERMANENTE', 'PERMANENTE COR NOVA'].includes(continuidade);
      })
      .map((item) => {
        const id = String(item.produto.idproduto || '');
        const plano = getPlano(item);
        const disp = calcularDisp(item, projecoes, periodos, plano);
        const min = Number(item.estoques.estoque_minimo || 0);
        const corteInteiro = Math.max(1, Number(cortes[id] || 0) || Math.round(min || 1));
        const lote = usarMeioCorte ? Math.max(1, Math.round(corteInteiro / 2)) : corteInteiro;
        const saldosFuturos = PERIODOS.slice(targetIndex).map((p) => Number(disp[p] || 0));
        const menorSaldoFuturo = Math.min(...saldosFuturos);
        const saldoMinimoFuturo = Math.max(0, min * coberturaMinimaFutura);
        const limitePorPct = Number(plano[periodoAlvo] || 0) * (Math.max(0, limiteReducaoPct) / 100);
        // Reducao sem tolerancia (segura)
        const maxReducaoSegura = Math.min(
          Number(plano[periodoAlvo] || 0),
          limitePorPct,
          Math.max(0, menorSaldoFuturo - saldoMinimoFuturo)
        );
        // Reducao com tolerancia (permite até -120 por SKU)
        const TOLERANCIA_POR_SKU = 120;
        const maxReducaoComTolerancia = Math.min(
          Number(plano[periodoAlvo] || 0),
          limitePorPct,
          Math.max(0, menorSaldoFuturo - saldoMinimoFuturo + TOLERANCIA_POR_SKU)
        );
        const reducaoCorteInteiro = roundDownByLot(maxReducaoSegura, corteInteiro);
        const reducaoComLoteSelecionado = roundDownByLot(maxReducaoSegura, lote);
        const extraMeioCorte = usarMeioCorte ? Math.max(0, reducaoComLoteSelecionado - reducaoCorteInteiro) : 0;
        const reducaoSemTolerancia = reducaoComLoteSelecionado;
        const reducaoComToleranciaLote = roundDownByLot(maxReducaoComTolerancia, lote);
        const extraTolerancia = Math.max(0, reducaoComToleranciaLote - reducaoSemTolerancia);
        const reducaoSegura = reducaoSemTolerancia; // será ajustado em rowsVisiveis
        const faltaAtual = Math.max(0, -Number(disp[periodoAlvo] || 0));
        let transferencia = 0;
        if (next && faltaAtual > 0 && Number(plano[next] || 0) > 0) {
          const desejado = roundUpByLot(faltaAtual, lote);
          transferencia = Math.min(Number(plano[next] || 0), desejado);
          transferencia = roundDownByLot(transferencia, lote);
        }
        const refNorm = norm(item.produto.referencia || '');
        return {
          chave: chaveItem(item),
          idproduto: id,
          referencia: item.produto.referencia || '-',
          produto: item.produto.produto || '-',
          cor: item.produto.cor || '-',
          tamanho: item.produto.tamanho || '-',
          continuidade: item.produto.continuidade || '-',
          linha: item.produto.linha || '-',
          familia: item.produto.idfamilia || '-',
          curva: curvaABC[refNorm] || 'B',
          estoqueMin: min,
          corteMin: corteInteiro,
          plano,
          disp,
          target: periodoAlvo,
          next,
          menorSaldoFuturo,
          saldoMinimoFuturo,
          reducaoCorteInteiro,
          extraMeioCorte,
          reducaoSemTolerancia,
          extraTolerancia,
          reducaoSegura,
          planoTargetNovo: Math.max(0, Number(plano[periodoAlvo] || 0) - reducaoSegura),
          transferencia,
          planoNextNovo: next ? Math.max(0, Number(plano[next] || 0) - transferencia) : null,
          dispTargetPosTransfer: Number(disp[periodoAlvo] || 0) + transferencia,
        };
      });
  }, [dados, projecoes, periodos, periodoAlvo, cortes, curvaABC, usarMeioCorte, coberturaMinimaFutura, limiteReducaoPct]);

  const opcoesLinha = useMemo(() => ['TODAS', ...Array.from(new Set(rows.map((r) => norm(r.linha)).filter(Boolean))).sort()], [rows]);
  const opcoesFamilia = useMemo(() => ['TODAS', ...Array.from(new Set(rows.map((r) => norm(r.familia)).filter(Boolean))).sort()], [rows]);

  const rowsVisiveis = useMemo(() => {
    let restanteExtraMeioCorte = EXTRA_MEIO_CORTE_MAX;
    let restanteExtraTolerancia = limiteExtraTolerancia;
    const filtradas = rows.filter((r) => {
      if (filtroCont !== 'TODAS' && norm(r.continuidade) !== filtroCont) return false;
      if (filtroLinha !== 'TODAS' && norm(r.linha) !== filtroLinha) return false;
      if (filtroFamilia !== 'TODAS' && norm(r.familia) !== filtroFamilia) return false;
      return true;
    });

    const statsPorRef = new Map<string, { reducao: number; transferencia: number; skus: number; bloqueados: number }>();
    filtradas.forEach((r) => {
      const key = norm(r.referencia);
      const atual = statsPorRef.get(key) || { reducao: 0, transferencia: 0, skus: 0, bloqueados: 0 };
      atual.reducao += Number(r.reducaoSegura || 0);
      atual.transferencia += Number(r.transferencia || 0);
      atual.skus += 1;
      if (Number(r.plano[periodoAlvo] || 0) > 0 && Number(r.reducaoSegura || 0) <= 0) atual.bloqueados += 1;
      statsPorRef.set(key, atual);
    });

    return filtradas
      .filter((r) => {
        if (!somenteComReducao) return true;
        if (modoAnalise === 'REFERENCIA') {
          const stats = statsPorRef.get(norm(r.referencia));
          return Boolean(stats && (stats.reducao > 0 || stats.transferencia > 0));
        }
        return r.reducaoSegura > 0 || r.transferencia > 0;
      })
      .map((r) => {
        const stats = statsPorRef.get(norm(r.referencia));
        if (!stats) return r;
        return {
          ...r,
          refReducaoTotal: stats.reducao,
          refTransferenciaTotal: stats.transferencia,
          refSkus: stats.skus,
          refSkusBloqueados: stats.bloqueados,
        };
      })
      .sort((a, b) => (b.reducaoSegura + b.transferencia) - (a.reducaoSegura + a.transferencia))
      .sort((a, b) => {
        if (modoAnalise !== 'REFERENCIA') return 0;
        const refDiff = ((b.refReducaoTotal || 0) + (b.refTransferenciaTotal || 0)) - ((a.refReducaoTotal || 0) + (a.refTransferenciaTotal || 0));
        if (refDiff !== 0) return refDiff;
        const refName = a.referencia.localeCompare(b.referencia);
        if (refName !== 0) return refName;
        return Number(b.reducaoSegura || 0) - Number(a.reducaoSegura || 0);
      })
      .map((r) => {
        if (!usarMeioCorte || r.extraMeioCorte <= 0) return { ...r, extraMeioCorte: 0 };
        if (restanteExtraMeioCorte <= 0) return { ...r, extraMeioCorte: 0 };
        const loteMeio = Math.max(1, Math.round(r.corteMin / 2));
        const extraAplicado = roundDownByLot(Math.min(r.extraMeioCorte, restanteExtraMeioCorte), loteMeio);
        restanteExtraMeioCorte -= extraAplicado;
        const reducaoSegura = r.reducaoCorteInteiro + extraAplicado;
        return {
          ...r,
          extraMeioCorte: extraAplicado,
          reducaoSegura,
          planoTargetNovo: Math.max(0, Number(r.plano[periodoAlvo] || 0) - reducaoSegura),
        }
      })
      .map((r) => {
        // Aplica extra da tolerancia com limite total
        if (r.extraTolerancia <= 0) return r;
        if (restanteExtraTolerancia <= 0) return { ...r, extraTolerancia: 0 };
        const lote = usarMeioCorte ? Math.max(1, Math.round(r.corteMin / 2)) : r.corteMin;
        const extraAplicado = roundDownByLot(Math.min(r.extraTolerancia, restanteExtraTolerancia), lote);
        restanteExtraTolerancia -= extraAplicado;
        const reducaoSegura = r.reducaoSegura + extraAplicado;
        return {
          ...r,
          extraTolerancia: extraAplicado,
          reducaoSegura,
          planoTargetNovo: Math.max(0, Number(r.plano[periodoAlvo] || 0) - reducaoSegura),
        };
      })
      .filter((r) => {
        if (!somenteComReducao) return true;
        if (modoAnalise === 'REFERENCIA') {
          return Number(r.refReducaoTotal || 0) > 0 || Number(r.refTransferenciaTotal || 0) > 0;
        }
        return r.reducaoSegura > 0 || r.transferencia > 0;
      });
  }, [rows, filtroCont, filtroLinha, filtroFamilia, somenteComReducao, periodoAlvo, usarMeioCorte, modoAnalise, limiteExtraTolerancia]);

  const resumo = useMemo(() => ({
    skusReducao: rowsVisiveis.filter((r) => r.reducaoSegura > 0).length,
    qtdReducao: rowsVisiveis.reduce((acc, r) => acc + r.reducaoSegura, 0),
    skusTransferencia: rowsVisiveis.filter((r) => r.transferencia > 0).length,
    qtdTransferencia: rowsVisiveis.reduce((acc, r) => acc + r.transferencia, 0),
    extraMeioCorte: rowsVisiveis.reduce((acc, r) => acc + r.extraMeioCorte, 0),
    extraTolerancia: rowsVisiveis.reduce((acc, r) => acc + r.extraTolerancia, 0),
    refsReducao: new Set(rowsVisiveis.filter((r) => r.reducaoSegura > 0).map((r) => norm(r.referencia))).size,
  }), [rowsVisiveis]);

  // Resumo geral: análise do plano completo
  // Calcula independente do período selecionado, usando dados base
  const resumoGeral = useMemo(() => {
    const planoTotal: Record<Periodo, number> = { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0, SX: 0 };
    const reducaoPorPeriodo: Record<Periodo, number> = { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0, SX: 0 };
    const antecipacaoPorPeriodo: Record<Periodo, number> = { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0, SX: 0 };
    const skusComReducao: Record<Periodo, number> = { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0, SX: 0 };
    const skusComAntecipacao: Record<Periodo, number> = { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0, SX: 0 };
    let excessoReduzivel = 0;
    let saldoFinalPositivo = 0;
    let saldoFinalNegativo = 0;
    let skusComExcesso = 0;
    let skusComDeficit = 0;
    let skusAnalisados = 0;

    // Filtra dados igual ao rows, mas sem depender de periodoAlvo
    const dadosFiltrados = dados.filter((item) => {
      const marca = norm(item.produto?.marca || '');
      const status = norm(item.produto?.status || '');
      const continuidade = norm(item.produto?.continuidade || '');
      return marca === MARCA_FIXA && status.startsWith(STATUS_FIXO) && ['PERMANENTE', 'PERMANENTE COR NOVA'].includes(continuidade);
    });

    // Primeiro passo: calcular plano total por período
    dadosFiltrados.forEach((item) => {
      const plano = getPlano(item);
      PERIODOS.forEach((p) => {
        planoTotal[p] += Number(plano[p] || 0);
      });
    });

    // Encontrar o último período com plano
    const periodosComPlano = PERIODOS.filter((p) => planoTotal[p] > 0);
    const ultimoPeriodoComPlano = periodosComPlano[periodosComPlano.length - 1] || 'QT';

    // Segundo passo: calcular redução para cada SKU e período
    dadosFiltrados.forEach((item) => {
      const id = String(item.produto.idproduto || '');
      const plano = getPlano(item);
      const disp = calcularDisp(item, projecoes, periodos, plano);
      const min = Number(item.estoques.estoque_minimo || 0);
      const corteInteiro = Math.max(1, Number(cortes[id] || 0) || Math.round(min || 1));
      const lote = usarMeioCorte ? Math.max(1, Math.round(corteInteiro / 2)) : corteInteiro;

      skusAnalisados++;

      // Calcula redução e antecipação para CADA período de forma independente
      periodosComPlano.forEach((p, pIdx) => {
        const idx = PERIODOS.indexOf(p);
        const planoNoPeriodo = Number(plano[p] || 0);
        const saldoPeriodo = Number(disp[p] || 0);
        const nextPeriodo = periodosComPlano[pIdx + 1] || null;

        // REDUÇÃO: se tem plano e saldo positivo futuro
        if (planoNoPeriodo > 0) {
          const saldosFuturos = PERIODOS.slice(idx).map((pf) => Number(disp[pf] || 0));
          const menorSaldoFuturo = Math.min(...saldosFuturos);
          const maxReducaoSegura = Math.min(planoNoPeriodo, Math.max(0, menorSaldoFuturo));
          const reducaoComLote = roundDownByLot(maxReducaoSegura, lote);
          if (reducaoComLote > 0) {
            reducaoPorPeriodo[p] += reducaoComLote;
            skusComReducao[p]++;
          }
        }

        // ANTECIPAÇÃO: se saldo negativo no período e tem plano no próximo
        if (saldoPeriodo < 0 && nextPeriodo) {
          const planoProximo = Number(plano[nextPeriodo] || 0);
          if (planoProximo > 0) {
            const faltaAtual = Math.abs(saldoPeriodo);
            const desejado = roundUpByLot(faltaAtual, lote);
            const antecipacao = Math.min(planoProximo, desejado);
            const antecipacaoComLote = roundDownByLot(antecipacao, lote);
            if (antecipacaoComLote > 0) {
              antecipacaoPorPeriodo[p] += antecipacaoComLote;
              skusComAntecipacao[p]++;
            }
          }
        }
      });

      // Saldo final no último período com plano
      const saldoFinal = Number(disp[ultimoPeriodoComPlano] || 0);
      if (saldoFinal > 0) {
        saldoFinalPositivo += saldoFinal;
        skusComExcesso++;
      } else if (saldoFinal < 0) {
        saldoFinalNegativo += saldoFinal;
        skusComDeficit++;
      }

      // Menor saldo futuro (apenas períodos com plano)
      const menorSaldo = Math.min(...periodosComPlano.map((p) => Number(disp[p] || 0)));
      if (menorSaldo > 0) {
        excessoReduzivel += menorSaldo;
      }
    });

    const planoTotalGeral = Object.values(planoTotal).reduce((a, b) => a + b, 0);
    const reducaoTotalGeral = Object.values(reducaoPorPeriodo).reduce((a, b) => a + b, 0);
    const antecipacaoTotalGeral = Object.values(antecipacaoPorPeriodo).reduce((a, b) => a + b, 0);

    // CÁLCULO SEQUENCIAL: aplica reduções em ordem MA→PX→UL→QT recalculando saldos
    const reducaoSequencial: Record<Periodo, number> = { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0, SX: 0 };
    let reducaoSequencialTotal = 0;

    dadosFiltrados.forEach((item) => {
      const id = String(item.produto.idproduto || '');
      const planoOriginal = getPlano(item);
      const min = Number(item.estoques.estoque_minimo || 0);
      const corteInteiro = Math.max(1, Number(cortes[id] || 0) || Math.round(min || 1));
      const lote = usarMeioCorte ? Math.max(1, Math.round(corteInteiro / 2)) : corteInteiro;

      // Cria cópia do plano para modificar sequencialmente
      const planoAjustado = { ...planoOriginal };

      // Para cada período em ordem, calcula redução e atualiza plano
      periodosComPlano.forEach((p) => {
        // Recalcula disp com o plano ajustado
        const dispAtual = calcularDisp(item, projecoes, periodos, planoAjustado);
        const idx = PERIODOS.indexOf(p);
        const planoNoPeriodo = Number(planoAjustado[p] || 0);

        if (planoNoPeriodo > 0) {
          const saldosFuturos = PERIODOS.slice(idx).map((pf) => Number(dispAtual[pf] || 0));
          const menorSaldoFuturo = Math.min(...saldosFuturos);
          const maxReducao = Math.min(planoNoPeriodo, Math.max(0, menorSaldoFuturo));
          const reducaoComLote = roundDownByLot(maxReducao, lote);

          if (reducaoComLote > 0) {
            reducaoSequencial[p] += reducaoComLote;
            reducaoSequencialTotal += reducaoComLote;
            // Atualiza plano para próxima iteração
            planoAjustado[p] = planoNoPeriodo - reducaoComLote;
          }
        }
      });
    });

    // MELHOR PERÍODO: qual período isolado dá mais redução
    let melhorPeriodo: Periodo = 'MA';
    let melhorReducao = 0;
    periodosComPlano.forEach((p) => {
      if (reducaoPorPeriodo[p] > melhorReducao) {
        melhorReducao = reducaoPorPeriodo[p];
        melhorPeriodo = p;
      }
    });

    return {
      planoTotal,
      planoTotalGeral,
      reducaoPorPeriodo,
      reducaoTotalGeral,
      reducaoSequencial,
      reducaoSequencialTotal,
      melhorPeriodo,
      melhorReducao,
      antecipacaoPorPeriodo,
      antecipacaoTotalGeral,
      skusComReducao,
      skusComAntecipacao,
      saldoFinalPositivo,
      saldoFinalNegativo,
      skusComExcesso,
      skusComDeficit,
      skusTotal: skusAnalisados,
      ultimoPeriodo: ultimoPeriodoComPlano,
    };
  }, [dados, projecoes, periodos, cortes, usarMeioCorte]);

  async function salvar(tipo: 'REDUCAO' | 'ANTECIPACAO' | 'AMBAS') {
    setSalvando(true);
    setError(null);
    setOkMsg(null);
    try {
      const salvarReducao = tipo === 'REDUCAO' || tipo === 'AMBAS';
      const salvarAntecipacao = tipo === 'ANTECIPACAO' || tipo === 'AMBAS';
      const reducoes = rowsVisiveis.filter((r) => r.reducaoSegura > 0);
      const antecipacoes = rowsVisiveis.filter((r) => r.transferencia > 0 && r.next);
      const basePorChave = new Map(rows.map((r) => [r.chave, r]));

      const montarPlanos = (alterar: (row: ReducaoRow, plano: PlanoCompleto) => void) =>
        Array.from(basePorChave.values()).map((row) => {
          const plano = { ...row.plano };
          alterar(row, plano);
          return planoParaSnapshot(row.chave, plano);
        });

      const requests = [];
      if (salvarReducao && reducoes.length) {
        const keys = new Set(reducoes.map((r) => r.chave));
        requests.push(fetchNoCache(`${API_URL}/api/simulacoes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            nome: `Reducao segura ${periodoAlvo} - ${new Date().toLocaleDateString('pt-BR')}`,
            parametros: {
              tipo: 'SUGESTAO_PLANO',
              subtipo: `REDUCAO_SEGURA_${periodoAlvo}`,
              statusAprovacao: 'PENDENTE',
              origem: 'REDUCAO_PLANO',
              periodoAlvo,
              planos: montarPlanos((row, plano) => {
                if (keys.has(row.chave)) plano[periodoAlvo] = row.planoTargetNovo;
              }),
            },
            resumo: {
              alterados: reducoes.length,
              deltaTotal: -resumo.qtdReducao,
              retiradaTotal: resumo.qtdReducao,
            },
            observacoes: `Reducao calculada sem gerar saldo negativo no periodo alvo nem nos futuros. Ganho adicional do corte minimo / 2 limitado a ${EXTRA_MEIO_CORTE_MAX.toLocaleString('pt-BR')} pecas; acima disso usar antecipacao casada com o proximo periodo.`,
          }),
        }));
      }
      if (salvarAntecipacao && antecipacoes.length) {
        const byKey = new Map(antecipacoes.map((r) => [r.chave, r]));
        requests.push(fetchNoCache(`${API_URL}/api/simulacoes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            nome: `Antecipacao para ${periodoAlvo} - ${new Date().toLocaleDateString('pt-BR')}`,
            parametros: {
              tipo: 'SUGESTAO_PLANO',
              subtipo: `ANTECIPACAO_${periodoAlvo}`,
              statusAprovacao: 'PENDENTE',
              origem: 'REDUCAO_PLANO',
              periodoAlvo,
              planos: montarPlanos((row, plano) => {
                const mov = byKey.get(row.chave);
                if (!mov || !mov.next) return;
                plano[periodoAlvo] = Number(plano[periodoAlvo] || 0) + mov.transferencia;
                plano[mov.next] = Math.max(0, Number(plano[mov.next] || 0) - mov.transferencia);
              }),
            },
            resumo: {
              alterados: antecipacoes.length,
              deltaTotal: 0,
              antecipadoTotal: resumo.qtdTransferencia,
            },
            observacoes: 'Antecipacao: aumenta o periodo atual e reduz o proximo periodo na mesma quantidade.',
          }),
        }));
      }
      if (!requests.length) throw new Error('Nenhuma sugestao elegivel para salvar.');
      const responses = await Promise.all(requests);
      for (const res of responses) {
        const data = await res.json();
        if (!res.ok || !data?.success) throw new Error(data?.error || 'Erro ao salvar sugestao');
      }
      setOkMsg(`${responses.length} sugestao(oes) salva(s) para aprovacao.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 min-w-0 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="bg-brand-primary shadow-sm px-6 py-3">
          <h1 className="text-white font-bold font-secondary tracking-wide text-base">REDUCAO DE PLANO</h1>
          <p className="text-white/70 text-xs">Reducao segura e antecipacao entre periodos sem criar saldo negativo futuro</p>
        </header>

        <main className="flex-1 min-w-0 px-6 py-5 space-y-4">
          {loading && <div className="bg-white rounded-lg border p-4 text-sm text-gray-500">Carregando...</div>}
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}
          {okMsg && <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700">{okMsg}</div>}

          <div className="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-600">Periodo</span>
              <select value={periodoAlvo} onChange={(e) => setPeriodoAlvo(e.target.value as Periodo)} className="border border-gray-300 rounded px-2 py-1.5 text-xs">
                {PERIODOS.filter((p) => resumoGeral.planoTotal[p] > 0 || rows.length === 0).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-600">Modo</span>
              <select value={modoAnalise} onChange={(e) => setModoAnalise(e.target.value as ModoAnalise)} className="border border-gray-300 rounded px-2 py-1.5 text-xs">
                <option value="SKU">SKU</option>
                <option value="REFERENCIA">Referencia/Grade</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-600">Continuidade</span>
              <select value={filtroCont} onChange={(e) => setFiltroCont(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-xs">
                <option value="TODAS">Todas</option>
                <option value="PERMANENTE">Permanente</option>
                <option value="PERMANENTE COR NOVA">Permanente cor nova</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-600">Linha</span>
              <select value={filtroLinha} onChange={(e) => setFiltroLinha(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-xs">
                {opcoesLinha.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-600">Familia</span>
              <select value={filtroFamilia} onChange={(e) => setFiltroFamilia(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-xs">
                {opcoesFamilia.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={usarMeioCorte} onChange={(e) => setUsarMeioCorte(e.target.checked)} />
              Corte min / 2 max {fmt(EXTRA_MEIO_CORTE_MAX)}
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={somenteComReducao} onChange={(e) => setSomenteComReducao(e.target.checked)} />
              Somente oportunidades
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-600">Extra tolerancia</span>
              <select value={limiteExtraTolerancia} onChange={(e) => setLimiteExtraTolerancia(Number(e.target.value))} className="border border-gray-300 rounded px-2 py-1.5 text-xs">
                {EXTRA_TOLERANCIA_OPTIONS.map((v) => (
                  <option key={v} value={v}>{v === 0 ? '0 (seguro)' : `+${fmt(v)}`}</option>
                ))}
              </select>
            </label>
            <button onClick={carregar} disabled={loading} className="px-3 py-1.5 text-xs font-semibold border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-60">
              Atualizar
            </button>
          </div>

          {/* Resumo Geral do Plano */}
          {(() => {
            const periodosComPlano = PERIODOS.filter((p) => resumoGeral.planoTotal[p] > 0);
            const primeiro = periodosComPlano[0] || 'MA';
            const ultimo = periodosComPlano[periodosComPlano.length - 1] || 'MA';
            const tituloRange = primeiro === ultimo ? primeiro : `${primeiro} → ${ultimo}`;
            return (
          <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg border border-gray-300 p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-bold text-gray-700">📊 Visão Geral do Plano ({tituloRange})</span>
              <span className="text-[10px] text-gray-500">Análise completa</span>
            </div>
            {/* Cards de plano por período */}
            <div className="grid grid-cols-4 gap-2 mb-2">
              {periodosComPlano.map((p) => {
                const plano = resumoGeral.planoTotal[p];
                return (
                  <div key={p} className="rounded border bg-white px-2 py-1.5 text-center">
                    <div className="text-[10px] text-gray-500 font-semibold">{p}</div>
                    <div className="text-sm font-bold">{fmt(plano)}</div>
                  </div>
                );
              })}
            </div>
            {/* STORYTELLING: Comparação de estratégias */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
              {/* 1. Foco em UM período */}
              <div className="bg-gray-50 rounded border border-gray-300 p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold text-gray-700">Foco em UM período</span>
                  <span className="text-[9px] text-gray-500">clique para selecionar</span>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {periodosComPlano.map((p) => {
                    const reducao = resumoGeral.reducaoPorPeriodo[p];
                    const isMelhor = p === resumoGeral.melhorPeriodo;
                    const isSelecionado = p === periodoAlvo;
                    return (
                      <button
                        key={p}
                        onClick={() => setPeriodoAlvo(p)}
                        className={`text-center h-12 rounded border transition-all ${
                          isSelecionado ? 'bg-red-100 border-red-500 ring-1 ring-red-300' :
                          isMelhor ? 'bg-amber-50 border-amber-400' : 'bg-white border-gray-200 hover:border-gray-400'
                        }`}
                      >
                        <div className="text-[9px] text-gray-600 font-semibold">{p}{isMelhor ? ' 👑' : ''}</div>
                        <div className="text-sm font-bold text-red-600">-{fmt(reducao)}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="text-[9px] text-gray-500 mt-1">
                  Melhor opção: <strong className="text-amber-700">{resumoGeral.melhorPeriodo}</strong> com -{fmt(resumoGeral.melhorReducao)}
                </div>
              </div>

              {/* 2. Aplicar em TODOS */}
              <div className="bg-gray-50 rounded border border-gray-300 p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold text-gray-700">Aplicar em TODOS ({primeiro}→{ultimo})</span>
                  <span className="text-[9px] font-bold text-red-600">-{fmt(resumoGeral.reducaoSequencialTotal)} total</span>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {periodosComPlano.map((p) => {
                    const seqReducao = resumoGeral.reducaoSequencial[p];
                    const indReducao = resumoGeral.reducaoPorPeriodo[p];
                    const perdido = indReducao - seqReducao;
                    return (
                      <div key={p} className="text-center h-12 flex flex-col justify-center rounded border bg-white border-gray-200">
                        <div className="text-[9px] text-gray-600 font-semibold">{p}</div>
                        <div className="text-sm font-bold text-red-600">-{fmt(seqReducao)}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="text-[9px] text-gray-500 mt-1">
                  <span className="text-orange-500">Δ</span> MA já consumiu margem de PX/UL/QT
                </div>
              </div>
            </div>

            {/* 3. Antes e Depois - Visão completa */}
            {(() => {
              // Calcula antecipação cedida por período (o que o período dá para o anterior)
              const antecipacaoCedida: Record<Periodo, number> = { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0, SX: 0 };
              periodosComPlano.forEach((p, idx) => {
                if (idx > 0) {
                  const periodoAnterior = periodosComPlano[idx - 1];
                  antecipacaoCedida[p] = resumoGeral.antecipacaoPorPeriodo[periodoAnterior] || 0;
                }
              });

              // Plano novo = atual - redução + recebido - cedido
              const planoNovo: Record<Periodo, number> = { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0, SX: 0 };
              let planoNovoTotal = 0;
              periodosComPlano.forEach((p) => {
                const atual = resumoGeral.planoTotal[p];
                const reducao = resumoGeral.reducaoSequencial[p];
                const recebido = resumoGeral.antecipacaoPorPeriodo[p] || 0;
                const cedido = antecipacaoCedida[p] || 0;
                planoNovo[p] = atual - reducao + recebido - cedido;
                planoNovoTotal += planoNovo[p];
              });

              const diferencaTotal = resumoGeral.planoTotalGeral - planoNovoTotal;

              return (
            <div className="bg-gradient-to-r from-slate-50 to-slate-100 rounded border border-slate-300 p-2">
              <div className="text-[11px] font-bold text-slate-800 mb-1">📈 Antes e Depois (reduções + antecipações)</div>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-slate-300">
                    <th className="text-left py-0.5 px-1 text-slate-600"></th>
                    {periodosComPlano.map((p) => (
                      <th key={p} className="text-center py-0.5 px-1 text-slate-600 font-bold">{p}</th>
                    ))}
                    <th className="text-center py-0.5 px-1 text-slate-800 font-bold bg-slate-200">TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-200">
                    <td className="py-0.5 px-1 text-slate-600">Atual</td>
                    {periodosComPlano.map((p) => (
                      <td key={p} className="text-center py-0.5 px-1 font-mono">{fmt(resumoGeral.planoTotal[p])}</td>
                    ))}
                    <td className="text-center py-0.5 px-1 font-mono font-bold bg-slate-100">{fmt(resumoGeral.planoTotalGeral)}</td>
                  </tr>
                  <tr className="border-b border-slate-200 bg-red-50">
                    <td className="py-0.5 px-1 text-red-700">Redução</td>
                    {periodosComPlano.map((p) => (
                      <td key={p} className="text-center py-0.5 px-1 font-mono text-red-600">
                        {resumoGeral.reducaoSequencial[p] > 0 ? `-${fmt(resumoGeral.reducaoSequencial[p])}` : '-'}
                      </td>
                    ))}
                    <td className="text-center py-0.5 px-1 font-mono font-bold text-red-700 bg-red-100">-{fmt(resumoGeral.reducaoSequencialTotal)}</td>
                  </tr>
                  <tr className="border-b border-slate-200 bg-blue-50">
                    <td className="py-0.5 px-1 text-blue-700">Antecip. (+)</td>
                    {periodosComPlano.map((p) => {
                      const recebido = resumoGeral.antecipacaoPorPeriodo[p] || 0;
                      return (
                        <td key={p} className="text-center py-0.5 px-1 font-mono text-blue-600">
                          {recebido > 0 ? `+${fmt(recebido)}` : '-'}
                        </td>
                      );
                    })}
                    <td className="text-center py-0.5 px-1 font-mono font-bold text-blue-700 bg-blue-100">+{fmt(resumoGeral.antecipacaoTotalGeral)}</td>
                  </tr>
                  <tr className="border-b border-slate-200 bg-orange-50">
                    <td className="py-0.5 px-1 text-orange-700">Cedido (-)</td>
                    {periodosComPlano.map((p) => {
                      const cedido = antecipacaoCedida[p] || 0;
                      return (
                        <td key={p} className="text-center py-0.5 px-1 font-mono text-orange-600">
                          {cedido > 0 ? `-${fmt(cedido)}` : '-'}
                        </td>
                      );
                    })}
                    <td className="text-center py-0.5 px-1 font-mono font-bold text-orange-700 bg-orange-100">-{fmt(resumoGeral.antecipacaoTotalGeral)}</td>
                  </tr>
                  <tr className="bg-emerald-50 font-semibold">
                    <td className="py-0.5 px-1 text-emerald-700">Novo</td>
                    {periodosComPlano.map((p) => (
                      <td key={p} className="text-center py-0.5 px-1 font-mono text-emerald-700">{fmt(planoNovo[p])}</td>
                    ))}
                    <td className="text-center py-0.5 px-1 font-mono font-bold text-emerald-800 bg-emerald-100">{fmt(planoNovoTotal)}</td>
                  </tr>
                  <tr className="border-t border-slate-300 text-[10px]">
                    <td className="py-0.5 px-1 text-slate-500">Diferença</td>
                    {periodosComPlano.map((p) => {
                      const diff = resumoGeral.planoTotal[p] - planoNovo[p];
                      return (
                        <td key={p} className={`text-center py-0.5 px-1 font-semibold ${diff > 0 ? 'text-red-600' : diff < 0 ? 'text-blue-600' : 'text-slate-500'}`}>
                          {diff > 0 ? `-${fmt(diff)}` : diff < 0 ? `+${fmt(Math.abs(diff))}` : '-'}
                        </td>
                      );
                    })}
                    <td className={`text-center py-0.5 px-1 font-bold bg-slate-100 ${diferencaTotal > 0 ? 'text-red-700' : 'text-slate-600'}`}>
                      {diferencaTotal > 0 ? `-${fmt(diferencaTotal)}` : fmt(diferencaTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="text-[9px] text-slate-500 mt-1">
                💡 Redução líquida: <strong className="text-red-600">{fmt(resumoGeral.reducaoSequencialTotal)}</strong> · Antecipação apenas redistribui
              </div>
            </div>
              );
            })()}

            {/* 4. Resumo executivo inline */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] bg-emerald-50 rounded border border-emerald-200 px-2 py-1.5 mb-2">
              <span className="font-bold text-emerald-800">📋 Resumo:</span>
              <span className="text-emerald-700">Melhor: <strong>{resumoGeral.melhorPeriodo}</strong> (-{fmt(resumoGeral.melhorReducao)})</span>
              <span className="text-emerald-700">Máx. todos: <strong>-{fmt(resumoGeral.reducaoSequencialTotal)}</strong> ({((resumoGeral.reducaoSequencialTotal / resumoGeral.planoTotalGeral) * 100).toFixed(1)}%)</span>
              <span className="text-emerald-700">Plano: {fmt(resumoGeral.planoTotalGeral)} → <strong>{fmt(resumoGeral.planoTotalGeral - resumoGeral.reducaoSequencialTotal)}</strong></span>
            </div>

            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
              <div className="bg-white rounded border px-2 py-1.5">
                <div className="text-[9px] text-gray-500">Plano Total</div>
                <div className="text-sm font-bold">{fmt(resumoGeral.planoTotalGeral)}</div>
              </div>
              <div className="bg-emerald-50 rounded border border-emerald-200 px-2 py-1.5">
                <div className="text-[9px] text-emerald-700">Saldo {resumoGeral.ultimoPeriodo} (+)</div>
                <div className="text-sm font-bold text-emerald-700">{fmt(resumoGeral.saldoFinalPositivo)}</div>
                <div className="text-[9px] text-emerald-600">{fmt(resumoGeral.skusComExcesso)} SKUs</div>
              </div>
              <div className="bg-red-50 rounded border border-red-200 px-2 py-1.5">
                <div className="text-[9px] text-red-700">Saldo {resumoGeral.ultimoPeriodo} (-)</div>
                <div className="text-sm font-bold text-red-700">{fmt(resumoGeral.saldoFinalNegativo)}</div>
                <div className="text-[9px] text-red-600">{fmt(resumoGeral.skusComDeficit)} SKUs</div>
              </div>
              <div className="bg-red-50 rounded border border-red-200 px-2 py-1.5">
                <div className="text-[9px] text-red-700">Redução possível</div>
                <div className="text-sm font-bold text-red-700">-{fmt(resumoGeral.reducaoSequencialTotal)}</div>
              </div>
              <div className="bg-blue-50 rounded border border-blue-200 px-2 py-1.5">
                <div className="text-[9px] text-blue-700">Antecipação</div>
                <div className="text-sm font-bold text-blue-700">{fmt(resumoGeral.antecipacaoTotalGeral)}</div>
              </div>
              <div className="bg-white rounded border px-2 py-1.5">
                <div className="text-[9px] text-gray-500">SKUs</div>
                <div className="text-sm font-bold">{fmt(resumoGeral.skusTotal)}</div>
              </div>
            </div>
          </div>
            );
          })()}

          {/* Resumo do Período Selecionado + Ações */}
          <div className="flex flex-wrap items-center gap-2 bg-white rounded-lg border border-gray-200 p-2">
            <div className="flex items-center gap-1 px-2 py-1 bg-gray-50 rounded border">
              <span className="text-[10px] text-gray-500">{modoAnalise === 'REFERENCIA' ? 'Refs' : 'SKUs'}:</span>
              <span className="text-sm font-bold">{fmt(modoAnalise === 'REFERENCIA' ? resumo.refsReducao : resumo.skusReducao)}</span>
            </div>
            <div className="flex items-center gap-1 px-2 py-1 bg-red-50 rounded border border-red-200">
              <span className="text-[10px] text-red-700">Redução:</span>
              <span className="text-sm font-bold text-red-700">{fmt(resumo.qtdReducao)}</span>
              <span className="text-[9px] text-red-600">(+{fmt(resumo.extraMeioCorte)} corte/2, +{fmt(resumo.extraTolerancia)} toler)</span>
            </div>
            <div className="flex items-center gap-1 px-2 py-1 bg-blue-50 rounded border border-blue-200">
              <span className="text-[10px] text-blue-700">Antecipação:</span>
              <span className="text-sm font-bold text-blue-700">{fmt(resumo.qtdTransferencia)}</span>
              <span className="text-[9px] text-blue-600">({fmt(resumo.skusTransferencia)} SKUs)</span>
            </div>
            <div className="flex-1" />
            <button onClick={() => salvar('REDUCAO')} disabled={salvando || resumo.qtdReducao <= 0} className="px-2 py-1 text-xs font-semibold bg-red-600 text-white rounded disabled:opacity-60">Salvar redução</button>
            <button onClick={() => salvar('ANTECIPACAO')} disabled={salvando || resumo.qtdTransferencia <= 0} className="px-2 py-1 text-xs font-semibold bg-blue-600 text-white rounded disabled:opacity-60">Salvar antecip.</button>
            <button onClick={() => salvar('AMBAS')} disabled={salvando || (resumo.qtdReducao <= 0 && resumo.qtdTransferencia <= 0)} className="px-2 py-1 text-xs font-semibold bg-brand-primary text-white rounded disabled:opacity-60">Salvar ambas</button>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-auto max-h-[72vh]">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-gray-100 z-10">
                <tr>
                  <th className="text-left px-2 py-2">Ref</th>
                  {modoAnalise === 'REFERENCIA' && <th className="text-right px-2 py-2">Red. ref</th>}
                  {modoAnalise === 'REFERENCIA' && <th className="text-right px-2 py-2">Bloq.</th>}
                  <th className="text-left px-2 py-2">Cor/Tam</th>
                  <th className="text-left px-2 py-2">Curva</th>
                  <th className="text-right px-2 py-2">Plano {periodoAlvo}</th>
                  <th className="text-right px-2 py-2">Saldo min futuro</th>
                  <th className="text-right px-2 py-2">Reduzir</th>
                  <th className="text-right px-2 py-2">Novo {periodoAlvo}</th>
                  <th className="text-right px-2 py-2">Trazer prox.</th>
                  <th className="text-right px-2 py-2">Saldo {periodoAlvo} apos</th>
                </tr>
              </thead>
              <tbody>
                {rowsVisiveis.slice(0, 1000).map((r, idx) => (
                  <tr key={r.chave} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
                    <td className="px-2 py-1.5 font-semibold">{r.referencia}</td>
                    {modoAnalise === 'REFERENCIA' && <td className="px-2 py-1.5 text-right font-mono font-semibold text-red-700">{fmt(Number(r.refReducaoTotal || 0))}</td>}
                    {modoAnalise === 'REFERENCIA' && <td className={`px-2 py-1.5 text-right font-mono ${Number(r.refSkusBloqueados || 0) > 0 ? 'text-amber-700 font-semibold' : 'text-gray-500'}`}>{fmt(Number(r.refSkusBloqueados || 0))}/{fmt(Number(r.refSkus || 0))}</td>}
                    <td className="px-2 py-1.5">{r.cor} / {r.tamanho}</td>
                    <td className="px-2 py-1.5">{r.curva}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmt(r.plano[periodoAlvo])}</td>
                    <td className={`px-2 py-1.5 text-right font-mono ${r.menorSaldoFuturo < 0 ? 'text-red-700 font-bold' : 'text-gray-700'}`}>{fmt(r.menorSaldoFuturo)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-red-700 font-semibold">{fmt(r.reducaoSegura)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmt(r.planoTargetNovo)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-blue-700 font-semibold">{r.next ? fmt(r.transferencia) : '-'}</td>
                    <td className={`px-2 py-1.5 text-right font-mono ${r.dispTargetPosTransfer < 0 ? 'text-red-700 font-bold' : 'text-emerald-700'}`}>{fmt(r.dispTargetPosTransfer)}</td>
                  </tr>
                ))}
                {rowsVisiveis.length === 0 && (
                  <tr><td colSpan={modoAnalise === 'REFERENCIA' ? 11 : 9} className="px-3 py-8 text-center text-gray-500">Nenhuma oportunidade encontrada.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </div>
  );
}
