'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { EstoqueLojaDisponivelAggregado, PeriodosPlano, Planejamento, ProjecoesMap } from '../types';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';
import { OP_MIN_REGRAS_FIXAS, RegraOpMinRow } from '../lib/opMinRules';
import { projecaoMesPlanejamento } from '../lib/projecao';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MARCA_FIXA = 'LIEBE';
const STATUS_FIXO = 'EM LINHA';
const COB_ALVO_MA_NEGATIVO = 0.7;
const MARGEM_COB_MA_NEGATIVO_PADRAO = 0.05;
const COB_SAUDAVEL_UL_TOP30 = 0.8;
const COB_SAUDAVEL_UL_KISSME = 0.8;
const COB_SAUDAVEL_UL_DEMAIS = 0.6;

type PeriodoAlvo = 'MA' | 'PX' | 'UL' | 'QT';
type MAModo = 'EMERGENCIA' | 'COBERTURA';
type SugestaoCfg = {
  cobertura_top30: number;
  cobertura_demais: number;
  cobertura_kissme: number;
  usar_corte_minimo: boolean;
  usar_op_minima_ref: boolean;
};
type Row = {
  idproduto: string;
  idreferencia: string;
  chave: string;
  referencia: string;
  cor: string;
  tamanho: string;
  continuidade: string;
  cod_situacao: string;
  linha: string;
  grupoProduto: string;
  classe: 'TOP30' | 'KISS ME' | 'DEMAIS';
  estoqueAtual: number;
  pedidosPendentes: number;
  emProcesso: number;
  dispAtualSemProcesso: number;
  dispAtualComProcesso: number;
  estoqueMin: number;
  media6m: number;
  media3m: number;
  variacaoPct: number | null;
  regraEstoqueMin: string;
  taxaJan: number | null;
  taxaFev: number | null;
  corteMin: number;
  coberturaAlvo: number;
  alvoDisp: number;
  necessidadeBruta: number;
  loteAplicado: number;
  planoSemCorte: number;
  projMes: number;
  dispAnterior: number;
  dispMA: number;
  dispPX: number;
  dispUL: number;
  dispQT: number;
  dispMesAlvo: number;
  coberturaMA: number;
  planoMA: number;
  planoPX: number;
  planoUL: number;
  planoQT: number;
  planoAtual: number;
  planoSugerido: number;
  planoBaseSemOpMin: number;
  planoAntesCapacidade: number;
  deltaPlano: number;
  dispPos: number;
  coberturaPos: number;
  regraOpMin?: RegraOpMinRow | null;
  rateioOpMinExtra?: number;
  opMinNaoAtendida?: boolean;
  opMinFaltante?: number;
  planoComOpMin?: number; // MA: Quanto seria COM OP mínima (informativo)
  tempoRef: number;
  grupoRateios: Array<{ grupo: string; rateio: number }>;
  usouMeioLote?: boolean; // MA Emergência: usou corte_min / 2
};
type VendasReaisMap = Record<string, Record<string, number>>;
type MpViabilidade = {
  loading: boolean;
  erro: string | null;
  aumentoMA: number;
  mpCriticas: number;
  deficitMA: number;
  viavelPlanoTotal: boolean;
  viavelEscopo: boolean;
  scopeTotalMA: number;
  scopeViavelMA: number;
  percViavelMA: number;
  refsViaveis: number;
  refsBloqueadas: number;
    refsBloqueadasDetalhe: Array<{
      idreferencia: string;
      materiasprimas_criticas: string[];
      materiasprimas_criticas_detalhe?: Array<{
        idmateriaprima: string;
        nome_materiaprima?: string;
        estoquetotal?: number;
        entrada_ma?: number;
        entrada_px?: number;
        entrada_ul?: number;
        consumo_ma?: number;
        consumo_px?: number;
        consumo_ul?: number;
        saldo_ma: number;
        saldo_px?: number;
        saldo_ul?: number;
        deficit_ma: number;
        deficit_px?: number;
        deficit_ul?: number;
      }>;
      materiasprimas_todas_detalhe?: Array<{
        idmateriaprima: string;
        nome_materiaprima?: string;
        estoquetotal?: number;
        entrada_ma?: number;
        entrada_px?: number;
        entrada_ul?: number;
        consumo_ma?: number;
        consumo_px?: number;
        consumo_ul?: number;
        saldo_ma: number;
        saldo_px?: number;
        saldo_ul?: number;
        deficit_ma: number;
        deficit_px?: number;
        deficit_ul?: number;
        critica?: boolean;
      }>;
    }>;
    refsEscopoDetalhe: Array<{
      idreferencia: string;
      bloqueada: boolean;
      materiasprimas_criticas: string[];
      materiasprimas_criticas_detalhe?: Array<{
        idmateriaprima: string;
        nome_materiaprima?: string;
        estoquetotal?: number;
        entrada_ma?: number;
        entrada_px?: number;
        entrada_ul?: number;
        consumo_ma?: number;
        consumo_px?: number;
        consumo_ul?: number;
        saldo_ma: number;
        saldo_px?: number;
        saldo_ul?: number;
        deficit_ma: number;
        deficit_px?: number;
        deficit_ul?: number;
      }>;
      materiasprimas_todas_detalhe?: Array<{
        idmateriaprima: string;
        nome_materiaprima?: string;
        estoquetotal?: number;
        entrada_ma?: number;
        entrada_px?: number;
        entrada_ul?: number;
        consumo_ma?: number;
        consumo_px?: number;
        consumo_ul?: number;
        saldo_ma: number;
        saldo_px?: number;
        saldo_ul?: number;
        deficit_ma: number;
        deficit_px?: number;
        deficit_ul?: number;
        critica?: boolean;
      }>;
    }>;
    refsPlanoTotalDetalhe: Array<{
      idreferencia: string;
      bloqueada: boolean;
      materiasprimas_criticas: string[];
      materiasprimas_criticas_detalhe?: Array<{
        idmateriaprima: string;
        nome_materiaprima?: string;
        estoquetotal?: number;
        entrada_ma?: number;
        entrada_px?: number;
        entrada_ul?: number;
        consumo_ma?: number;
        consumo_px?: number;
        consumo_ul?: number;
        saldo_ma: number;
        saldo_px?: number;
        saldo_ul?: number;
        deficit_ma: number;
        deficit_px?: number;
        deficit_ul?: number;
      }>;
      materiasprimas_todas_detalhe?: Array<{
        idmateriaprima: string;
        nome_materiaprima?: string;
        estoquetotal?: number;
        entrada_ma?: number;
        entrada_px?: number;
        entrada_ul?: number;
        consumo_ma?: number;
        consumo_px?: number;
        consumo_ul?: number;
        saldo_ma: number;
        saldo_px?: number;
        saldo_ul?: number;
        deficit_ma: number;
        deficit_px?: number;
        deficit_ul?: number;
        critica?: boolean;
      }>;
    }>;
};

type MpStatus = 'OK' | 'PRODUTIVEL' | 'BLOQUEADO' | 'SOLICITAR_COMPRA' | 'NA';
type GrupoCapacidadeConfig = { grupo: string; tipo: string; capacidade_diaria: number };
type GrupoRefConfig = { grupo: string; referencia: string };
type TempoRefConfig = { idreferencia: string; referencia_padrao?: string; tempo_segundos: number };
type ReprojecaoPreview = {
  idproduto: string;
  recalculada: { ma: number; px: number; ul: number };
};

function chaveItem(item: Planejamento) {
  const id = Number(item.produto.idproduto);
  if (Number.isFinite(id)) return `ID-${id}`;
  return `REF-${item.produto.referencia || ''}-${item.produto.cor || ''}-${item.produto.tamanho || ''}`;
}

function fmt(v: number) {
  return Math.round(v || 0).toLocaleString('pt-BR');
}

function normRef(ref: string) {
  return String(ref || '').trim().toUpperCase();
}

function roundUpByLot(qtd: number, lot: number) {
  const l = Math.max(1, Math.round(Number(lot || 0)));
  const q = Math.max(0, Number(qtd || 0));
  return Math.ceil(q / l) * l;
}

function roundDownByLot(qtd: number, lot: number) {
  const l = Math.max(1, Math.round(Number(lot || 0)));
  const q = Math.max(0, Number(qtd || 0));
  return Math.floor(q / l) * l;
}

function mesSeguinte(mes: number) {
  const m = Number(mes || 0);
  if (!Number.isFinite(m) || m <= 0) return 1;
  return (m % 12) + 1;
}

function healthyCoverageTarget(classe: Row['classe']) {
  if (classe === 'TOP30') return COB_SAUDAVEL_UL_TOP30;
  if (classe === 'KISS ME') return COB_SAUDAVEL_UL_KISSME;
  return COB_SAUDAVEL_UL_DEMAIS;
}

function normalizeRuleText(value: string) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function matchRuleValue(ruleValue: string, actualValue: string) {
  const rule = normalizeRuleText(ruleValue);
  const actual = normalizeRuleText(actualValue);
  if (!rule) return false;
  if (rule.startsWith('<>')) {
    const expectedNot = normalizeRuleText(rule.replace(/^<>\s*/, ''));
    return actual !== expectedNot;
  }
  if (rule.includes('<> SUTIA') && rule.includes('<> CALCA')) {
    return actual !== 'SUTIA' && actual !== 'CALCA';
  }
  return rule === actual;
}

function findRegraOpMin(rules: RegraOpMinRow[], continuidade: string, linha: string, grupo: string) {
  const cont = normalizeRuleText(continuidade);
  const lin = normalizeRuleText(linha);
  const grp = normalizeRuleText(grupo);
  return rules.find((rule) =>
    normalizeRuleText(rule.continuidade) === cont &&
    matchRuleValue(rule.linha, lin) &&
    matchRuleValue(rule.grupo, grp)
  ) || null;
}

export default function SugestaoPlanoPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [salvandoSugestao, setSalvandoSugestao] = useState(false);
  const [dados, setDados] = useState<Planejamento[]>([]);
  const [projecoes, setProjecoes] = useState<ProjecoesMap>({});
  const [vendasReais, setVendasReais] = useState<VendasReaisMap>({});
  const [reprojecaoPreview, setReprojecaoPreview] = useState<ReprojecaoPreview[]>([]);
  const [periodos, setPeriodos] = useState<PeriodosPlano>({
    MA: new Date().getMonth() + 1,
    PX: new Date().getMonth() + 2,
    UL: new Date().getMonth() + 3,
  });
  const [cortes, setCortes] = useState<Record<string, number>>({});
  const [top30Ids, setTop30Ids] = useState<Set<string>>(new Set());
  const [top30Refs, setTop30Refs] = useState<Set<string>>(new Set());
  const [capacidadeGrupos, setCapacidadeGrupos] = useState<GrupoCapacidadeConfig[]>([]);
  const [capacidadeGrupoRefs, setCapacidadeGrupoRefs] = useState<GrupoRefConfig[]>([]);
  const [capacidadeDias, setCapacidadeDias] = useState<Record<string, number>>({});
  const [capacidadeTemposRef, setCapacidadeTemposRef] = useState<TempoRefConfig[]>([]);
  const [cfg, setCfg] = useState<SugestaoCfg>({
    cobertura_top30: 1.2,
    cobertura_demais: 0.8,
    cobertura_kissme: 1.5,
    usar_corte_minimo: true,
    usar_op_minima_ref: true,
  });
  const [periodoAlvo, setPeriodoAlvo] = useState<PeriodoAlvo>('MA');
  const [maModo, setMaModo] = useState<MAModo>('EMERGENCIA');
  const [somenteDeltaNegativo, setSomenteDeltaNegativo] = useState(false);
  const [somenteNegativoMA, setSomenteNegativoMA] = useState(false);
  const [considerarCapacidade, setConsiderarCapacidade] = useState(false);
  const [usarEstoqueLojas, setUsarEstoqueLojas] = useState(false);
  const [estoqueLojasDisponivel, setEstoqueLojasDisponivel] = useState<Map<number, EstoqueLojaDisponivelAggregado>>(new Map());
  const [carregandoEstoqueLojas, setCarregandoEstoqueLojas] = useState(false);
  const [considerarProjecaoNova, setConsiderarProjecaoNova] = useState(false);
  const [recalculandoProjecao, setRecalculandoProjecao] = useState(false);
  const [resultadoReprojecaoMsg, setResultadoReprojecaoMsg] = useState<string | null>(null);
  const [margemCobMA, setMargemCobMA] = useState<number>(MARGEM_COB_MA_NEGATIVO_PADRAO);
  const [filtroCont, setFiltroCont] = useState<'TODAS' | 'PERMANENTE' | 'PERMANENTE COR NOVA'>('TODAS');
  const [filtroSuspensos, setFiltroSuspensos] = useState<'INCLUIR' | 'EXCLUIR'>('INCLUIR');
  const [filtroOpMin, setFiltroOpMin] = useState<'TODOS' | 'BLOQUEADA'>('TODOS');
  const [filtroViabilidade, setFiltroViabilidade] = useState<'TODOS' | 'PRODUTIVEL' | 'BLOQUEADO' | 'OK' | 'SOLICITAR_COMPRA'>('TODOS');
  const [activeRowKey, setActiveRowKey] = useState<string | null>(null);
  const [expandedConts, setExpandedConts] = useState<Set<string>>(new Set());
  const [expandedRefs, setExpandedRefs] = useState<Set<string>>(new Set());
  const [mpViab, setMpViab] = useState<MpViabilidade>({
    loading: false,
    erro: null,
    aumentoMA: 0,
    mpCriticas: 0,
    deficitMA: 0,
    viavelPlanoTotal: true,
    viavelEscopo: true,
    scopeTotalMA: 0,
    scopeViavelMA: 0,
    percViavelMA: 100,
    refsViaveis: 0,
    refsBloqueadas: 0,
    refsBloqueadasDetalhe: [],
    refsEscopoDetalhe: [],
    refsPlanoTotalDetalhe: [],
  });
  const [mpModalRef, setMpModalRef] = useState<{
    idreferencia: string;
    bloqueada?: boolean;
    materiasprimas_criticas: string[];
    materiasprimas_criticas_detalhe?: Array<{
      idmateriaprima: string;
      nome_materiaprima?: string;
      estoquetotal?: number;
      entrada_ma?: number;
      entrada_px?: number;
      entrada_ul?: number;
      consumo_ma?: number;
      consumo_px?: number;
      consumo_ul?: number;
      saldo_ma: number;
      saldo_px?: number;
      saldo_ul?: number;
      deficit_ma: number;
      deficit_px?: number;
      deficit_ul?: number;
    }>;
    materiasprimas_todas_detalhe?: Array<{
      idmateriaprima: string;
      nome_materiaprima?: string;
      estoquetotal?: number;
      entrada_ma?: number;
      entrada_px?: number;
      entrada_ul?: number;
      consumo_ma?: number;
      consumo_px?: number;
      consumo_ul?: number;
      saldo_ma: number;
      saldo_px?: number;
      saldo_ul?: number;
      deficit_ma: number;
      deficit_px?: number;
      deficit_ul?: number;
      critica?: boolean;
    }>;
  } | null>(null);
  const leftScrollRef = useRef<HTMLDivElement | null>(null);
  const rightScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef<'left' | 'right' | null>(null);
  const reprojecaoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (reprojecaoTimeoutRef.current) clearTimeout(reprojecaoTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!usarEstoqueLojas) {
      setEstoqueLojasDisponivel(new Map());
      return;
    }
    carregarEstoqueLojasDisponivel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usarEstoqueLojas]);

  async function carregar() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '5000', marca: MARCA_FIXA, status: STATUS_FIXO });
      const [rMatriz, rProj, rTop30, rCortes, rCfg, rCapConfig, rCapTempos, rReproj] = await Promise.all([
        fetchNoCache(`${API_URL}/api/producao/matriz?${params}`),
        fetchNoCache(`${API_URL}/api/projecoes`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/analises/top30-produtos`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/configuracoes/corte-minimos`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/configuracoes/sugestao-plano`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/capacidade/config`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/capacidade/tempos-ref`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/projecoes/reprojecao-fechada`, { headers: authHeaders() }),
      ]);
      if (!rMatriz.ok || !rProj.ok || !rTop30.ok || !rCortes.ok || !rCfg.ok || !rCapConfig.ok || !rCapTempos.ok || !rReproj.ok) {
        throw new Error('Erro ao carregar dados da sugestão de plano');
      }
      const pMatriz = await rMatriz.json();
      const pProj = await rProj.json();
      const pTop30 = await rTop30.json();
      const pCortes = await rCortes.json();
      const pCfg = await rCfg.json();
      const pCapConfig = await rCapConfig.json();
      const pCapTempos = await rCapTempos.json();
      const pReproj = await rReproj.json();

      setDados((pMatriz?.data || []) as Planejamento[]);
      setProjecoes((pProj?.data || {}) as ProjecoesMap);
      if (pProj?.periodos) setPeriodos(pProj.periodos as PeriodosPlano);
      setTop30Ids(new Set(((pTop30?.ids || []) as string[]).map((v) => String(v))));
      setTop30Refs(new Set(((pTop30?.referencias || []) as string[]).map((v) => normRef(v))));
      setCapacidadeGrupos(Array.isArray(pCapConfig?.data?.grupos) ? pCapConfig.data.grupos : []);
      setCapacidadeGrupoRefs(Array.isArray(pCapConfig?.data?.grupo_refs) ? pCapConfig.data.grupo_refs : []);
      setCapacidadeDias((pCapConfig?.data?.dias && typeof pCapConfig.data.dias === 'object') ? pCapConfig.data.dias : {});
      setCapacidadeTemposRef(Array.isArray(pCapTempos?.data) ? pCapTempos.data : []);
      setReprojecaoPreview(Array.isArray(pReproj?.sugestoes) ? pReproj.sugestoes : []);

      const map: Record<string, number> = {};
      const cortesRows = Array.isArray(pCortes?.data) ? pCortes.data : [];
      cortesRows.forEach((r: { idproduto?: string; corte_min?: number }) => {
        const id = String(r?.idproduto || '').trim();
        const c = Number(r?.corte_min || 0);
        if (id && c > 0) map[id] = Math.round(c);
      });
      setCortes(map);
      if (pCfg?.data) {
        setCfg({
          cobertura_top30: Number(pCfg.data.cobertura_top30 || 1.2),
          cobertura_demais: Number(pCfg.data.cobertura_demais || 0.8),
          cobertura_kissme: Number(pCfg.data.cobertura_kissme || 1.5),
          usar_corte_minimo: pCfg.data.usar_corte_minimo !== false,
          usar_op_minima_ref: true,
        });
      }

      const ids = ((pMatriz?.data || []) as Planejamento[])
        .map((i) => Number(i.produto.idproduto))
        .filter((n) => Number.isFinite(n))
        .slice(0, 5000);
      if (ids.length) {
        try {
          const rReal = await fetchNoCache(`${API_URL}/api/analises/projecao-vs-venda`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ ano: new Date().getFullYear(), ids }),
          });
          if (rReal.ok) {
            const pReal = await rReal.json();
            setVendasReais((pReal?.data || {}) as VendasReaisMap);
          } else {
            setVendasReais({});
          }
        } catch {
          setVendasReais({});
        }
      } else {
        setVendasReais({});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }

  async function carregarEstoqueLojasDisponivel() {
    setCarregandoEstoqueLojas(true);
    try {
      const res = await fetchNoCache(`${API_URL}/api/estoque-lojas/disponivel-total?lojaDestino=1`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Estoque lojas erro ${res.status}`);
      const payload = await res.json();
      const map = new Map<number, EstoqueLojaDisponivelAggregado>();
      if (Array.isArray(payload?.data)) {
        for (const item of payload.data) {
          map.set(Number(item.cd_produto), item as EstoqueLojaDisponivelAggregado);
        }
      }
      setEstoqueLojasDisponivel(map);
    } catch {
      setEstoqueLojasDisponivel(new Map());
    } finally {
      setCarregandoEstoqueLojas(false);
    }
  }

  const dadosBase = useMemo(() => {
    if (!usarEstoqueLojas || estoqueLojasDisponivel.size === 0) return dados;
    return dados.map((item) => {
      const estoqueExtra = Number(estoqueLojasDisponivel.get(Number(item.produto.idproduto))?.qtd_disponivel_total || 0);
      if (!(estoqueExtra > 0)) return item;
      const estoqueAtual = Number(item.estoques.estoque_atual || 0);
      const emProcesso = Number(item.estoques.em_processo || 0);
      const estoqueMinimo = Number(item.estoques.estoque_minimo || 0);
      const pedidosPendentes = Number(item.demanda.pedidos_pendentes || 0);
      const estoqueDisponivel = estoqueAtual + estoqueExtra + emProcesso;
      const necessidadeTotal = estoqueMinimo + pedidosPendentes;
      const necessidadeProducao = Math.max(0, necessidadeTotal - estoqueDisponivel);
      const situacao: 'PRODUZIR' | 'ESTOQUE_OK' = necessidadeProducao > 0 ? 'PRODUZIR' : 'ESTOQUE_OK';
      const prioridade: 'ALTA' | 'MEDIA' | 'BAIXA' = necessidadeProducao > 0
        ? ((estoqueAtual + estoqueExtra) < estoqueMinimo ? 'ALTA' : 'MEDIA')
        : 'BAIXA';

      return {
        ...item,
        estoques: {
          ...item.estoques,
          estoque_atual: estoqueAtual + estoqueExtra,
          estoque_disponivel: estoqueDisponivel,
        },
        planejamento: {
          ...item.planejamento,
          necessidade_producao: necessidadeProducao,
          situacao,
          prioridade,
        },
      };
    });
  }, [dados, usarEstoqueLojas, estoqueLojasDisponivel]);

  const projecoesAtivas = useMemo<ProjecoesMap>(() => {
    if (!considerarProjecaoNova || reprojecaoPreview.length === 0) return projecoes;
    const clone: ProjecoesMap = { ...projecoes };
    for (const item of reprojecaoPreview) {
      const id = String(item.idproduto || '');
      if (!id) continue;
      const base = clone[id] ? { ...clone[id] } : {};
      base[String(periodos.MA)] = Number(item.recalculada?.ma || 0);
      base[String(periodos.PX)] = Number(item.recalculada?.px || 0);
      base[String(periodos.UL)] = Number(item.recalculada?.ul || 0);
      clone[id] = base;
    }
    return clone;
  }, [considerarProjecaoNova, reprojecaoPreview, projecoes, periodos]);

  const resumoMudancaProjecao = useMemo(() => {
    const mesQT = mesSeguinte(Number(periodos.UL || 0));
    const targetMes = String(periodoAlvo === 'QT' ? mesQT : periodos[periodoAlvo]);
    let alterados = 0;
    let originalTotal = 0;
    let novoTotal = 0;
    for (const item of dadosBase) {
      const id = String(item.produto.idproduto || '');
      const original = Number(projecoes[id]?.[targetMes] || 0);
      const novo = Number(projecoesAtivas[id]?.[targetMes] || 0);
      originalTotal += original;
      novoTotal += novo;
      if (Math.round(original) !== Math.round(novo)) alterados += 1;
    }
    return {
      alterados,
      originalTotal: Math.round(originalTotal),
      novoTotal: Math.round(novoTotal),
      deltaTotal: Math.round(novoTotal - originalTotal),
    };
  }, [dadosBase, projecoes, projecoesAtivas, periodos, periodoAlvo]);

  useEffect(() => {
    if (reprojecaoTimeoutRef.current) clearTimeout(reprojecaoTimeoutRef.current);
    setResultadoReprojecaoMsg(null);
    if (!considerarProjecaoNova) {
      setRecalculandoProjecao(false);
      return;
    }
    setRecalculandoProjecao(true);
    reprojecaoTimeoutRef.current = setTimeout(() => {
      setRecalculandoProjecao(false);
      if (reprojecaoPreview.length === 0) {
        setResultadoReprojecaoMsg('Sem preview de reprojeção disponível.');
        return;
      }
      if (resumoMudancaProjecao.alterados === 0) {
        setResultadoReprojecaoMsg(`Nenhum item teve projeção alterada em ${periodoAlvo}.`);
        return;
      }
      setResultadoReprojecaoMsg(
        `${resumoMudancaProjecao.alterados.toLocaleString('pt-BR')} itens com projeção alterada em ${periodoAlvo}. ` +
        `Delta total: ${fmt(resumoMudancaProjecao.deltaTotal)}.`
      );
    }, 550);
  }, [considerarProjecaoNova, reprojecaoPreview, resumoMudancaProjecao, periodoAlvo]);

  const rows = useMemo<Row[]>(() => {
    const mesQT = mesSeguinte(Number(periodos.UL || 0));
    // Agora todos os períodos (MA, PX, UL, QT) usam OP mínima e capacidade
    const alvoComOpMinECapacidade = true;
    const capacidadeDiariaByGrupo = new Map<string, number>();
    capacidadeGrupos.forEach((g) => {
      const key = normRef(g.grupo);
      if (key) capacidadeDiariaByGrupo.set(key, Number(g.capacidade_diaria || 0));
    });
    const gruposByReferencia = new Map<string, string[]>();
    capacidadeGrupoRefs.forEach((r) => {
      const ref = normRef(r.referencia);
      const grupo = normRef(r.grupo);
      if (!ref || !grupo) return;
      const cur = gruposByReferencia.get(ref) || [];
      if (!cur.includes(grupo)) cur.push(grupo);
      gruposByReferencia.set(ref, cur);
    });
    const tempoByIdRef = new Map<string, number>();
    capacidadeTemposRef.forEach((t) => {
      const key = String(t.idreferencia || '').trim();
      if (key) tempoByIdRef.set(key, Number(t.tempo_segundos || 0));
    });

    // Debug: verificar produto suspenso específico (29148)
    const baseRows = dadosBase
      .filter((item) => {
        const marca = String(item.produto?.marca || '').trim().toUpperCase();
        const status = String(item.produto?.status || '').trim().toUpperCase();
        const continuidade = String(item.produto?.continuidade || '').trim().toUpperCase();

        // Verifica se é produto suspenso usando o Set de IDs carregado da API
        const isSuspenso = String(item.produto?.cod_situacao || '').trim() === '007';


        // Filtro de suspensos - aplicado ANTES do cálculo do plano
        if (filtroSuspensos === 'EXCLUIR' && isSuspenso) {
          return false;
        }

        // Define continuidades válidas: PERMANENTE, PERMANENTE COR NOVA, ou SUSPENSO (se incluído)
        const continuidadeOk =
          continuidade === 'PERMANENTE' ||
          continuidade === 'PERMANENTE COR NOVA' ||
          (isSuspenso && filtroSuspensos === 'INCLUIR');

        return marca === MARCA_FIXA && status.startsWith(STATUS_FIXO) && continuidadeOk;
      });

    // Debug: contar produtos após filtro
    const baseRowsMapped = baseRows.map((item) => {
      const id = String(item.produto.idproduto || '');
      const refNorm = normRef(item.produto.referencia || '');
      const texto = `${String(item.produto.continuidade || '')} ${String(item.produto.produto || '')}`.toUpperCase();
      const isKiss = texto.includes('KISS ME');
      const isTop30 = top30Refs.has(refNorm) || top30Ids.has(id);
      const classe: Row['classe'] = isKiss ? 'KISS ME' : (isTop30 ? 'TOP30' : 'DEMAIS');
      const cobAlvoBase = isKiss ? cfg.cobertura_kissme : isTop30 ? cfg.cobertura_top30 : cfg.cobertura_demais;
      const gruposRef = gruposByReferencia.get(refNorm) || [];
      const somaCapGrupos = gruposRef.reduce((acc, grupo) => acc + Math.max(0, Number(capacidadeDiariaByGrupo.get(grupo) || 0)), 0);
      const grupoRateios = gruposRef.map((grupo) => {
        const cap = Math.max(0, Number(capacidadeDiariaByGrupo.get(grupo) || 0));
        const rateio = somaCapGrupos > 0 ? cap / somaCapGrupos : 0;
        return { grupo, rateio };
      }).filter((g) => g.rateio > 0);

      const min = Number(item.estoques.estoque_minimo || 0);
      const media6m = Number(item.demanda?.media_vendas_6m || 0);
      const media3m = Number(item.demanda?.media_vendas_3m || 0);
      const variacaoPctRaw = item.calculo_estoque_minimo?.variacaoPercentual;
      const variacaoPct = Number.isFinite(Number(variacaoPctRaw)) ? Number(variacaoPctRaw) : null;
      const regra = item.calculo_estoque_minimo?.regraAplicada;
      const regraEstoqueMin = regra === 1 ? 'Regra 1' : regra === 2 ? 'Regra 2' : regra === 3 ? 'Regra 3' : '-';
      const vendaJan = Number(vendasReais[id]?.['1'] || 0);
      const vendaFev = Number(vendasReais[id]?.['2'] || 0);
      const projJan = Number(projecoesAtivas[id]?.['1'] || projecoes[id]?.['1'] || 0);
      const projFev = Number(projecoesAtivas[id]?.['2'] || projecoes[id]?.['2'] || 0);
      const taxaJan = projJan > 0 ? vendaJan / projJan : null;
      const taxaFev = projFev > 0 ? vendaFev / projFev : null;
      const estoqueAtual = Number(item.estoques.estoque_atual || 0);
      const pedidosPendentes = Number(item.demanda.pedidos_pendentes || 0);
      const emP = Number(item.estoques.em_processo || 0);
      const dispAtual = estoqueAtual - pedidosPendentes;
      const dispAtualComProcesso = dispAtual + emP;
      const pMA = Number(item.plano?.ma || 0);
      const pPX = Number(item.plano?.px || 0);
      const pUL = Number(item.plano?.ul || 0);
      const pQT = Number((item.plano as { qt?: number } | undefined)?.qt || 0);
      const prMA = projecaoMesPlanejamento(Number(projecoesAtivas[id]?.[String(periodos.MA)] || 0), periodos.MA);
      const prPX = Number(projecoesAtivas[id]?.[String(periodos.PX)] || 0);
      const prUL = Number(projecoesAtivas[id]?.[String(periodos.UL)] || 0);
      const prQT = Number(projecoesAtivas[id]?.[String(mesQT)] || 0);
      const dispMA = dispAtual + emP + pMA - prMA;
      const dispPX = dispMA + pPX - prPX;
      const dispUL = dispPX + pUL - prUL;
      const dispQT = dispUL + pQT - prQT;

      const mesAlvo = periodoAlvo === 'QT' ? mesQT : periodos[periodoAlvo];
      const projMes = Number(projecoesAtivas[id]?.[String(mesAlvo)] || 0);
      const dispAnterior = periodoAlvo === 'MA' ? dispAtualComProcesso : (periodoAlvo === 'PX' ? dispMA : (periodoAlvo === 'UL' ? dispPX : dispUL));
      const dispMesAlvo = periodoAlvo === 'MA' ? dispMA : (periodoAlvo === 'PX' ? dispPX : (periodoAlvo === 'UL' ? dispUL : dispQT));

      // Para MA, o comportamento depende do modo selecionado.
      let cobAlvo = cobAlvoBase;

      if (periodoAlvo === 'MA') {
        cobAlvo = maModo === 'EMERGENCIA' ? (isKiss ? 0.5 : 0) : cobAlvoBase;
      } else if (maModo === 'EMERGENCIA' && dispMA < 0) {
        cobAlvo = COB_ALVO_MA_NEGATIVO;
      }

      const alvoDisp = min > 0 ? (cobAlvo * min) : 0;
      const necessidadeBruta = Math.max(0, alvoDisp + projMes - dispAnterior);

      // Para MA, mantém a lógica especial de lote flexível nos dois modos.
      let lote = cfg.usar_corte_minimo ? (Number(cortes[id] || 0) > 0 ? Number(cortes[id]) : Math.max(1, Math.round(min))) : 1;
      const loteOriginal = lote; // Guarda o lote original para comparação
      let planoSugerido = 0;
      let usouMeioLote = false;

      if (periodoAlvo === 'MA') {
        if (necessidadeBruta <= 0) {
          planoSugerido = 0; // Estoque já atende
        } else {
          // Calcula arredondamentos
          const planoFloor = Math.floor(necessidadeBruta / lote) * lote;
          const planoCeil = Math.ceil(necessidadeBruta / lote) * lote;

          // Verifica dispPos de cada opção
          const dispPosFloor = dispAnterior + planoFloor - projMes;
          const dispPosCeil = dispAnterior + planoCeil - projMes;

          // PRIORIDADE 1: Arredondar para BAIXO se dispPos >= 0
          if (planoFloor > 0 && dispPosFloor >= 0) {
            planoSugerido = planoFloor;
          }
          // PRIORIDADE 2: Usar arredondamento para CIMA (sempre deixa dispPos >= 0)
          else if (planoCeil > 0) {
            planoSugerido = planoCeil;

            // Se ultrapassar muito (cob > 0.5 em emergência, > 1.0 normal), tenta lote/2
            const cobPosCeil = min > 0 ? dispPosCeil / min : 0;
            const thresholdMeioLote = maModo === 'EMERGENCIA' ? 0.5 : 1.0;
            if (cobPosCeil > thresholdMeioLote && lote > 1) {
              lote = Math.max(1, Math.round(lote / 2));
              const planoMeioLote = Math.ceil(necessidadeBruta / lote) * lote;

              // Valida que lote/2 também não deixa negativo
              const dispPosMeio = dispAnterior + planoMeioLote - projMes;
              if (dispPosMeio >= 0) {
                planoSugerido = planoMeioLote;
                usouMeioLote = true; // Marcamos que usou meio lote
              } else {
                // Se lote/2 deixaria negativo, mantém lote inteiro
                planoSugerido = planoCeil;
                lote = loteOriginal; // Restaura o lote original
              }
            }
          }
          // FALLBACK: Se tudo falhar, usa necessidadeBruta arredondada para cima
          else {
            planoSugerido = Math.ceil(necessidadeBruta);
          }
        }
      } else {
        // Outros períodos: lógica normal
        planoSugerido = roundUpByLot(necessidadeBruta, lote);

        if (maModo === 'EMERGENCIA' && dispMA < 0 && cfg.usar_corte_minimo && lote > 1 && min > 0) {
          const lowerLot = Math.floor(Math.max(0, necessidadeBruta) / lote) * lote;
          if (lowerLot > 0 && lowerLot < planoSugerido) {
            const dispPosLower = dispAnterior + lowerLot - projMes;
            const cobPosLower = dispPosLower / min;
            if (cobPosLower >= (COB_ALVO_MA_NEGATIVO - Math.max(0, margemCobMA))) {
              planoSugerido = lowerLot;
            }
          }
        }
      }

      const planoSemCorte = Math.ceil(necessidadeBruta);
      const planoAtual = periodoAlvo === 'MA' ? pMA : (periodoAlvo === 'PX' ? pPX : (periodoAlvo === 'UL' ? pUL : pQT));
      const dispPos = dispAnterior + planoSugerido - projMes;
      const coberturaMA = min > 0 ? dispMA / min : 0;
      const coberturaPos = min > 0 ? dispPos / min : 0;

      return {
        idproduto: String(item.produto.idproduto || ''),
        idreferencia: String(item.produto.cd_seqgrupo || ''),
        chave: chaveItem(item),
        referencia: item.produto.referencia || '-',
        cor: item.produto.cor || '-',
        tamanho: item.produto.tamanho || '-',
        continuidade: item.produto.continuidade || '-',
        cod_situacao: String(item.produto.cod_situacao || '').trim(),
        linha: item.produto.linha || '-',
        grupoProduto: item.produto.grupo || '-',
        classe,
        estoqueAtual,
        pedidosPendentes,
        emProcesso: emP,
        dispAtualSemProcesso: dispAtual,
        dispAtualComProcesso,
        estoqueMin: min,
        media6m,
        media3m,
        variacaoPct,
        regraEstoqueMin,
        taxaJan,
        taxaFev,
        corteMin: lote,
        coberturaAlvo: cobAlvo,
        alvoDisp,
        necessidadeBruta,
        loteAplicado: lote,
        planoSemCorte,
        projMes,
        dispAnterior,
        dispMA,
        dispPX,
        dispUL,
        dispQT,
        dispMesAlvo,
        coberturaMA,
        planoMA: pMA,
        planoPX: pPX,
        planoUL: pUL,
        planoQT: pQT,
        planoAtual,
        planoSugerido,
        planoBaseSemOpMin: planoSugerido,
        planoAntesCapacidade: planoSugerido,
        deltaPlano: planoSugerido - planoAtual,
        dispPos,
        coberturaPos,
        regraOpMin: findRegraOpMin(OP_MIN_REGRAS_FIXAS, item.produto.continuidade || '', item.produto.linha || '', item.produto.grupo || ''),
        rateioOpMinExtra: 0,
        opMinNaoAtendida: false,
        opMinFaltante: 0,
        planoComOpMin: planoSugerido, // Inicialmente igual, pode ser atualizado depois
        tempoRef: Number(tempoByIdRef.get(String(item.produto.cd_seqgrupo || '')) || 0),
        grupoRateios,
        usouMeioLote,
      };
    });

    if (!alvoComOpMinECapacidade) return baseRowsMapped;

    const byRef = new Map<string, Row[]>();
    for (const row of baseRowsMapped) {
      const key = normRef(row.referencia);
      if (!byRef.has(key)) byRef.set(key, []);
      byRef.get(key)!.push(row); // SEM spread - usa referência direta para MA poder marcar opMinNaoAtendida
    }

    // ─── REGRA ESPECIAL ABRIL (MA): Calcula OP mínima SIMULADA (informativo) ─────
    if (periodoAlvo === 'MA') {
      console.log('[DEBUG OP MIN MA] Entrando na lógica de OP mínima para MA');
      let countRefsAbaixo = 0;

      // Para MA: calcula quanto seria COM OP mínima + marca referências abaixo
      for (const rowsRef of Array.from(byRef.values())) {
        const regra = rowsRef[0]?.regraOpMin || null;
        if (!regra) continue;

        const totalRef = rowsRef.reduce((acc: number, r: Row) => acc + Number(r.planoSugerido || 0), 0);
        if (totalRef > 0 && totalRef < Number(regra.op_min_ref || 0)) {
          countRefsAbaixo++;
          const faltante = Math.max(0, Number(regra.op_min_ref || 0) - totalRef);
          console.log(`[DEBUG OP MIN] Ref ${rowsRef[0].referencia}: total=${totalRef}, opMin=${regra.op_min_ref}, faltam=${faltante}`);

          // SIMULA a distribuição da OP mínima (SEM aplicar de verdade)
          const ordenadas = [...rowsRef].sort((a, b) => {
            const diffProj = Number(b.projMes || 0) - Number(a.projMes || 0);
            if (diffProj !== 0) return diffProj;
            return Number(a.coberturaPos || 0) - Number(b.coberturaPos || 0);
          });

          let restanteSimulado = faltante;
          const planoSimuladoPorRow = new Map<Row, number>();

          for (const row of ordenadas) {
            if (restanteSimulado <= 0) break;
            const min = Number(row.estoqueMin || 0);
            const cobMax = Number(regra.cobertura_max || 0);
            const maxPlanoPorCob = min > 0
              ? Math.max(0, (cobMax * min) + Number(row.projMes || 0) - Number(row.dispAnterior || 0))
              : Number.POSITIVE_INFINITY;
            const folga = Math.max(0, maxPlanoPorCob - Number(row.planoSugerido || 0));
            if (!(folga > 0)) continue;
            const extra = Math.min(restanteSimulado, folga);
            planoSimuladoPorRow.set(row, Number(row.planoSugerido || 0) + extra);
            restanteSimulado -= extra;
          }

          // Marca TODOS os SKUs da referência + armazena plano simulado
          rowsRef.forEach((row) => {
            row.opMinNaoAtendida = true;
            row.opMinFaltante = faltante;
            row.planoComOpMin = planoSimuladoPorRow.get(row) || row.planoSugerido;
            console.log(`[DEBUG OP MIN] SKU ${row.referencia}-${row.cor}-${row.tamanho}: planoSug=${row.planoSugerido}, planoComOpMin=${row.planoComOpMin}`);
          });
        }
      }
      console.log(`[DEBUG OP MIN MA] Total de referências abaixo da OP mínima: ${countRefsAbaixo}`);

      // Verifica se as marcações foram aplicadas em baseRowsMapped
      const marcadas = baseRowsMapped.filter(r => r.opMinNaoAtendida);
      console.log(`[DEBUG OP MIN MA] Total de SKUs marcados em baseRowsMapped: ${marcadas.length}`);
      if (marcadas.length > 0) {
        console.log(`[DEBUG OP MIN MA] Exemplo de SKU marcado:`, {
          ref: marcadas[0].referencia,
          cor: marcadas[0].cor,
          tam: marcadas[0].tamanho,
          opMinNaoAtendida: marcadas[0].opMinNaoAtendida,
          planoSugerido: marcadas[0].planoSugerido,
          planoComOpMin: marcadas[0].planoComOpMin
        });
      }

      return baseRowsMapped;
    }

    // ─── Outros períodos (PX, UL, QT): Aplica rateio de OP mínima normal ──────────
    const ajustadas: Row[] = [];
    for (const rowsRef of Array.from(byRef.values())) {
      const regra = rowsRef[0]?.regraOpMin || null;
      if (!regra) {
        ajustadas.push(...rowsRef);
        continue;
      }

      const totalRef = rowsRef.reduce((acc: number, r: Row) => acc + Number(r.planoSugerido || 0), 0);
      if (!(totalRef > 0 && totalRef < Number(regra.op_min_ref || 0))) {
        ajustadas.push(...rowsRef);
        continue;
      }

      let restante = Math.max(0, Number(regra.op_min_ref || 0) - totalRef);
      const extrasAplicados = new Map<Row, number>();
      const ordenadas = [...rowsRef].sort((a, b) => {
        const diffProj = Number(b.projMes || 0) - Number(a.projMes || 0);
        if (diffProj !== 0) return diffProj;
        return Number(a.coberturaPos || 0) - Number(b.coberturaPos || 0);
      });

      for (const row of ordenadas) {
        if (restante <= 0) break;
        const min = Number(row.estoqueMin || 0);
        const cobMax = Number(regra.cobertura_max || 0);
        const maxPlanoPorCob = min > 0
          ? Math.max(0, (cobMax * min) + Number(row.projMes || 0) - Number(row.dispAnterior || 0))
          : Number.POSITIVE_INFINITY;
        const folga = Math.max(0, maxPlanoPorCob - Number(row.planoSugerido || 0));
        if (!(folga > 0)) continue;
        const extra = Math.min(restante, folga);
        row.planoSugerido = Number(row.planoSugerido || 0) + extra;
        row.rateioOpMinExtra = extra;
        extrasAplicados.set(row, Number(extrasAplicados.get(row) || 0) + extra);
        row.deltaPlano = row.planoSugerido - row.planoAtual;
        row.dispPos = row.dispAnterior + row.planoSugerido - row.projMes;
        row.coberturaPos = min > 0 ? row.dispPos / min : 0;
        restante -= extra;
      }

      if (restante > 0) {
        ordenadas.forEach((row) => {
          const extraAplicado = Number(extrasAplicados.get(row) || 0);
          if (extraAplicado > 0) {
            const min = Number(row.estoqueMin || 0);
            row.planoSugerido = Number(row.planoSugerido || 0) - extraAplicado;
            row.rateioOpMinExtra = 0;
            row.deltaPlano = row.planoSugerido - row.planoAtual;
            row.dispPos = row.dispAnterior + row.planoSugerido - row.projMes;
            row.coberturaPos = min > 0 ? row.dispPos / min : 0;
          }
          row.opMinNaoAtendida = true;
          row.opMinFaltante = Math.max(0, Number(regra.op_min_ref || 0) - totalRef);
        });
      }

      ajustadas.push(...ordenadas);
    }

    if (!considerarCapacidade) return ajustadas;

    const diasMA = Number(capacidadeDias[String(periodos.MA)] || 0);
    const diasPX = Number(capacidadeDias[String(periodos.PX)] || 0);
    const diasUL = Number(capacidadeDias[String(periodos.UL)] || 0);
    const diasQT = Number(capacidadeDias[String(mesQT)] || 0);
    const extraCargaPorGrupo = new Map<string, number>();

    capacidadeGrupos.forEach((grupo) => {
      const grupoKey = normRef(grupo.grupo);
      const capDiaria = Number(grupo.capacidade_diaria || 0);
      const capMA = capDiaria * diasMA;
      const capPX = capDiaria * diasPX;
      const capUL = capDiaria * diasUL;
      const capQT = capDiaria * diasQT;

      let processoCarga = 0;
      let cargaMA = 0;
      let cargaPX = 0;
      let cargaUL = 0;
      let cargaAlvoTotalDisponivel = 0;

      ajustadas.forEach((row) => {
        const rateio = row.grupoRateios.find((g) => g.grupo === grupoKey)?.rateio || 0;
        if (!(rateio > 0) || !(row.tempoRef > 0)) return;
        processoCarga += row.emProcesso * row.tempoRef * rateio;
        cargaMA += row.planoMA * row.tempoRef * rateio;
        cargaPX += row.planoPX * row.tempoRef * rateio;
        cargaUL += row.planoUL * row.tempoRef * rateio;
      });

      const saldoAcumPX = (capMA - (processoCarga + cargaMA)) + (capPX - cargaPX);
      const saldoAcumUL = saldoAcumPX + (capUL - cargaUL);
      cargaAlvoTotalDisponivel =
        periodoAlvo === 'PX' ? Math.max(0, (capMA - (processoCarga + cargaMA)) + capPX) :
        periodoAlvo === 'UL' ? Math.max(0, saldoAcumPX + capUL) :
        Math.max(0, saldoAcumUL + capQT);
      extraCargaPorGrupo.set(grupoKey, cargaAlvoTotalDisponivel);
    });

    const planoCampoAlvo: 'planoMA' | 'planoPX' | 'planoUL' | 'planoQT' =
      periodoAlvo === 'PX' ? 'planoPX' :
      periodoAlvo === 'UL' ? 'planoUL' : 'planoQT';
    const rowsCap = ajustadas.map((r) => ({
      ...r,
      planoSugerido: Number(r[planoCampoAlvo] || 0),
      planoBaseSemOpMin: Number(r.planoBaseSemOpMin || 0),
      planoAntesCapacidade: Number(r.planoSugerido || 0),
      deltaPlano: Number(r[planoCampoAlvo] || 0) - Number(r.planoAtual || 0),
      dispPos: Number(r.dispAnterior || 0) + Number(r[planoCampoAlvo] || 0) - Number(r.projMes || 0),
      coberturaPos: Number(r.estoqueMin || 0) > 0
        ? (Number(r.dispAnterior || 0) + Number(r[planoCampoAlvo] || 0) - Number(r.projMes || 0)) / Number(r.estoqueMin || 0)
        : 0,
    }));

    for (const row of rowsCap) {
      row.grupoRateios.forEach((g) => {
        const consumo = Number(row.planoSugerido || 0) * Number(row.tempoRef || 0) * g.rateio;
        extraCargaPorGrupo.set(g.grupo, Number(extraCargaPorGrupo.get(g.grupo) || 0) - consumo);
      });
    }

    const prioridadeClasse = (classe: Row['classe']) => (classe === 'TOP30' ? 3 : classe === 'KISS ME' ? 2 : 1);
    const coberturaAtual = (row: Row) => {
      if (!(Number(row.estoqueMin || 0) > 0)) return 0;
      const dispBase =
        periodoAlvo === 'PX' ? Number(row.dispPX || 0) :
        periodoAlvo === 'UL' ? Number(row.dispUL || 0) :
        Number(row.dispQT || 0);
      return dispBase / Number(row.estoqueMin || 0);
    };

    const candidatosCorteSemNegativo = rowsCap
      .filter((r) => Number(r.planoSugerido || 0) > 0 && Number(r.tempoRef || 0) > 0 && r.grupoRateios.length > 0)
      .sort((a, b) => {
        const aFolga = Math.max(0, Number(a.dispPos || 0));
        const bFolga = Math.max(0, Number(b.dispPos || 0));
        if (bFolga !== aFolga) return bFolga - aFolga;
        const covDiff = coberturaAtual(b) - coberturaAtual(a);
        if (covDiff !== 0) return covDiff;
        const classeDiff = prioridadeClasse(a.classe) - prioridadeClasse(b.classe);
        if (classeDiff !== 0) return classeDiff;
        const tempoDiff = Number(b.tempoRef || 0) - Number(a.tempoRef || 0);
        if (tempoDiff !== 0) return tempoDiff;
        return Number(a.projMes || 0) - Number(b.projMes || 0);
      });

    for (const row of candidatosCorteSemNegativo) {
      const gruposCriticos = row.grupoRateios.filter((g) => Number(extraCargaPorGrupo.get(g.grupo) || 0) < 0);
      if (!gruposCriticos.length) continue;
      const reducaoSemNegativo = Math.max(0, Number(row.dispPos || 0));
      if (!(reducaoSemNegativo > 0)) continue;
      let maxReducao = Number(row.planoSugerido || 0);
      for (const g of gruposCriticos) {
        const cargaRateadaPorPeca = Number(row.tempoRef || 0) * g.rateio;
        if (!(cargaRateadaPorPeca > 0)) continue;
        const falta = Math.abs(Math.min(0, Number(extraCargaPorGrupo.get(g.grupo) || 0)));
        maxReducao = Math.min(maxReducao, falta / cargaRateadaPorPeca);
      }
      maxReducao = Math.min(maxReducao, reducaoSemNegativo);
      const reducaoAplicada = cfg.usar_corte_minimo
        ? roundDownByLot(maxReducao, row.corteMin)
        : Math.floor(maxReducao);
      const reducaoFinal = Math.max(0, Math.min(Number(row.planoSugerido || 0), reducaoAplicada));
      if (!(reducaoFinal > 0)) continue;
      row.planoSugerido = Math.max(0, Number(row.planoSugerido || 0) - reducaoFinal);
      row.deltaPlano = row.planoSugerido - row.planoAtual;
      row.dispPos = row.dispAnterior + row.planoSugerido - row.projMes;
      row.coberturaPos = Number(row.estoqueMin || 0) > 0 ? row.dispPos / Number(row.estoqueMin || 0) : 0;
      row.grupoRateios.forEach((g) => {
        const alivio = reducaoFinal * Number(row.tempoRef || 0) * g.rateio;
        extraCargaPorGrupo.set(g.grupo, Number(extraCargaPorGrupo.get(g.grupo) || 0) + alivio);
      });
    }

    const candidatosCorteComDano = rowsCap
      .filter((r) => Number(r.planoSugerido || 0) > 0 && Number(r.tempoRef || 0) > 0 && r.grupoRateios.length > 0)
      .sort((a, b) => {
        const classeDiff = prioridadeClasse(a.classe) - prioridadeClasse(b.classe);
        if (classeDiff !== 0) return classeDiff;
        const tempoDiff = Number(b.tempoRef || 0) - Number(a.tempoRef || 0);
        if (tempoDiff !== 0) return tempoDiff;
        const negA = Math.abs(Math.min(0, Number(a.dispPos || 0)));
        const negB = Math.abs(Math.min(0, Number(b.dispPos || 0)));
        if (negA !== negB) return negA - negB;
        return Number(a.projMes || 0) - Number(b.projMes || 0);
      });

    for (const row of candidatosCorteComDano) {
      const gruposCriticos = row.grupoRateios.filter((g) => Number(extraCargaPorGrupo.get(g.grupo) || 0) < 0);
      if (!gruposCriticos.length) continue;
      let maxReducao = Number(row.planoSugerido || 0);
      for (const g of gruposCriticos) {
        const cargaRateadaPorPeca = Number(row.tempoRef || 0) * g.rateio;
        if (!(cargaRateadaPorPeca > 0)) continue;
        const falta = Math.abs(Math.min(0, Number(extraCargaPorGrupo.get(g.grupo) || 0)));
        maxReducao = Math.min(maxReducao, falta / cargaRateadaPorPeca);
      }
      const reducaoAplicada = cfg.usar_corte_minimo
        ? roundDownByLot(maxReducao, row.corteMin)
        : Math.floor(maxReducao);
      const reducaoFinal = Math.max(0, Math.min(Number(row.planoSugerido || 0), reducaoAplicada));
      if (!(reducaoFinal > 0)) continue;
      row.planoSugerido = Math.max(0, Number(row.planoSugerido || 0) - reducaoFinal);
      row.deltaPlano = row.planoSugerido - row.planoAtual;
      row.dispPos = row.dispAnterior + row.planoSugerido - row.projMes;
      row.coberturaPos = Number(row.estoqueMin || 0) > 0 ? row.dispPos / Number(row.estoqueMin || 0) : 0;
      row.grupoRateios.forEach((g) => {
        const alivio = reducaoFinal * Number(row.tempoRef || 0) * g.rateio;
        extraCargaPorGrupo.set(g.grupo, Number(extraCargaPorGrupo.get(g.grupo) || 0) + alivio);
      });
    }

    const desejadosMap = new Map(rowsCap.map((r) => [r.chave, Number(ajustadas.find((x) => x.chave === r.chave)?.planoSugerido || 0)]));
    const incrementos = rowsCap
      .filter((r) => Number(desejadosMap.get(r.chave) || 0) > Number(r.planoSugerido || 0) && Number(r.tempoRef || 0) > 0 && r.grupoRateios.length > 0)
      .sort((a, b) => {
        const aNeg = Number(a.dispPos || 0) < 0 ? 1 : 0;
        const bNeg = Number(b.dispPos || 0) < 0 ? 1 : 0;
        if (aNeg !== bNeg) return bNeg - aNeg;
        const classeDiff = prioridadeClasse(b.classe) - prioridadeClasse(a.classe);
        if (classeDiff !== 0) return classeDiff;
        const retornoA = Math.abs(Math.min(0, Number(a.dispPos || 0))) / Math.max(1, Number(a.tempoRef || 0));
        const retornoB = Math.abs(Math.min(0, Number(b.dispPos || 0))) / Math.max(1, Number(b.tempoRef || 0));
        if (retornoB !== retornoA) return retornoB - retornoA;
        return Number(b.projMes || 0) - Number(a.projMes || 0);
      });

    for (const row of incrementos) {
      const desiredPlano = Math.max(0, Number(desejadosMap.get(row.chave) || 0));
      const faltaPlano = Math.max(0, desiredPlano - Number(row.planoSugerido || 0));
      if (!(faltaPlano > 0)) continue;
      let maxExtraByCap = faltaPlano;
      for (const g of row.grupoRateios) {
        const cargaRateadaPorPeca = Number(row.tempoRef || 0) * g.rateio;
        if (!(cargaRateadaPorPeca > 0)) continue;
        const disponivel = Math.max(0, Number(extraCargaPorGrupo.get(g.grupo) || 0));
        maxExtraByCap = Math.min(maxExtraByCap, disponivel / cargaRateadaPorPeca);
      }
      const extraAplicado = cfg.usar_corte_minimo
        ? roundDownByLot(maxExtraByCap, row.corteMin)
        : Math.floor(maxExtraByCap);
      const extraFinal = Math.max(0, Math.min(faltaPlano, extraAplicado));
      if (!(extraFinal > 0)) continue;
      row.planoSugerido = Number(row.planoSugerido || 0) + extraFinal;
      row.deltaPlano = row.planoSugerido - row.planoAtual;
      row.dispPos = row.dispAnterior + row.planoSugerido - row.projMes;
      row.coberturaPos = Number(row.estoqueMin || 0) > 0 ? row.dispPos / Number(row.estoqueMin || 0) : 0;
      row.grupoRateios.forEach((g) => {
        const consumo = extraFinal * Number(row.tempoRef || 0) * g.rateio;
        extraCargaPorGrupo.set(g.grupo, Math.max(0, Number(extraCargaPorGrupo.get(g.grupo) || 0) - consumo));
      });
    }

    return rowsCap;
  }, [dadosBase, top30Ids, top30Refs, cfg, cortes, projecoes, projecoesAtivas, periodos, periodoAlvo, vendasReais, margemCobMA, maModo, capacidadeGrupos, capacidadeGrupoRefs, capacidadeDias, capacidadeTemposRef, considerarCapacidade, filtroSuspensos]);

  const rowsVisiveis = useMemo(() => {
    return rows.filter((r) => {
      if (somenteDeltaNegativo && !(r.deltaPlano < 0)) return false;
      if (somenteNegativoMA && !(r.dispMesAlvo < 0)) return false;
      if (filtroCont !== 'TODAS' && String(r.continuidade || '').trim().toUpperCase() !== filtroCont) return false;
      if (filtroOpMin === 'BLOQUEADA' && !Boolean(r.opMinNaoAtendida)) return false;
      return true;
    });
  }, [rows, periodoAlvo, maModo, somenteDeltaNegativo, somenteNegativoMA, filtroCont, filtroOpMin]);

  const refEscopoStatusMap = useMemo(() => {
    const m = new Map<string, boolean>(); // true = bloqueada
    for (const r of mpViab.refsEscopoDetalhe || []) {
      const k = String(r.idreferencia || '').trim();
      if (!k) continue;
      m.set(k, Boolean(r.bloqueada));
    }
    return m;
  }, [mpViab.refsEscopoDetalhe]);

  function statusViabilidadeRow(r: Row): MpStatus {
    const k1 = String(r.referencia || '').trim();
    const k2 = String(r.idreferencia || '').trim();
    if (periodoAlvo === 'MA') {
      const hit = refEscopoStatusMap.has(k1) ? refEscopoStatusMap.get(k1) : refEscopoStatusMap.get(k2);
      if (typeof hit !== 'boolean') return 'NA';
      return hit ? 'BLOQUEADO' : 'PRODUTIVEL';
    }
    const detalhe = planoTotalRefMap.get(k1) || planoTotalRefMap.get(k2) || null;
    const materias = detalhe?.materiasprimas_todas_detalhe || detalhe?.materiasprimas_criticas_detalhe || [];
    if (!materias.length) return 'NA';
    const faltaCompra = materias.some((m) => {
      if (periodoAlvo === 'PX') return Number(m.saldo_px || 0) < 0;
      return Number(m.saldo_ul || 0) < 0;
    });
    return faltaCompra ? 'SOLICITAR_COMPRA' : 'OK';
  }

  const rowsVisiveisTela = useMemo(() => {
    if (filtroViabilidade === 'TODOS') return rowsVisiveis;
    return rowsVisiveis.filter((r) => {
      const st = statusViabilidadeRow(r);
      if (filtroViabilidade === 'PRODUTIVEL') return st === 'PRODUTIVEL';
      if (filtroViabilidade === 'BLOQUEADO') return st === 'BLOQUEADO';
      if (filtroViabilidade === 'OK') return st === 'OK';
      if (filtroViabilidade === 'SOLICITAR_COMPRA') return st === 'SOLICITAR_COMPRA';
      return true;
    });
  }, [rowsVisiveis, filtroViabilidade, periodoAlvo, refEscopoStatusMap]);

  const gruposTabela = useMemo(() => {
    const contMap = new Map<string, Map<string, Row[]>>();
    for (const row of rowsVisiveisTela) {
      const cont = String(row.continuidade || 'SEM CONTINUIDADE').trim();
      const ref = String(row.referencia || 'SEM REFERENCIA').trim();
      if (!contMap.has(cont)) contMap.set(cont, new Map());
      const refMap = contMap.get(cont)!;
      if (!refMap.has(ref)) refMap.set(ref, []);
      refMap.get(ref)!.push(row);
    }
    return Array.from(contMap.entries()).map(([continuidade, refMap]) => ({
      continuidade,
      referencias: Array.from(refMap.entries())
        .map(([referencia, itens]) => ({
          referencia,
          descricao: itens[0]?.grupoProduto || itens[0]?.linha || '',
          itens: [...itens].sort((a, b) => `${a.cor}-${a.tamanho}`.localeCompare(`${b.cor}-${b.tamanho}`)),
        }))
        .sort((a, b) => a.referencia.localeCompare(b.referencia)),
    }));
  }, [rowsVisiveisTela]);

  useEffect(() => {
    setExpandedConts(new Set(gruposTabela.map((g) => g.continuidade)));
  }, [gruposTabela]);

  const resumo = useMemo(() => {
    let atual = 0;
    let sugerido = 0;
    let delta = 0;
    rowsVisiveisTela.forEach((r) => {
      atual += r.planoAtual;
      sugerido += r.planoSugerido;
      delta += r.deltaPlano;
    });
    return { atual, sugerido, delta };
  }, [rowsVisiveisTela]);

  const resumoSuspensos = useMemo(() => {
    let totalSuspensos = 0;
    let planoSuspensos = 0;
    rows.forEach((r) => {
      // Verifica se o produto está no Set de IDs suspensos
      if (String(r.cod_situacao || '').trim() === '007') {
        totalSuspensos += 1;
        planoSuspensos += r.planoSugerido;
      }
    });
    return { total: totalSuspensos, plano: planoSuspensos };
  }, [rows]);

  const resumoOpMin = useMemo(() => {
    // Agora funciona para todos os períodos (MA, PX, UL, QT)
    let semOpMin = 0;
    let extraOpMin = 0;
    rowsVisiveisTela.forEach((r) => {
      semOpMin += Number(r.planoBaseSemOpMin || 0);
      extraOpMin += Number(r.rateioOpMinExtra || 0);
    });
    return { semOpMin, extraOpMin, comOpMinBase: semOpMin + extraOpMin };
  }, [rowsVisiveisTela]);

  const resumoSkuOpMinBloqueada = useMemo(() => {
    // Agora funciona para todos os períodos (MA, PX, UL, QT)
    return rowsVisiveisTela.filter((r) => Boolean(r.opMinNaoAtendida)).length;
  }, [rowsVisiveisTela]);

  // Conta SKUs que usaram corte_min / 2 no MA Emergência
  const resumoMeioLote = useMemo(() => {
    if (periodoAlvo !== 'MA' || maModo !== 'EMERGENCIA') {
      return { skus: 0, pecas: 0 };
    }
    let skus = 0;
    let pecas = 0;
    rowsVisiveisTela.forEach((r) => {
      if (r.usouMeioLote) {
        skus += 1;
        pecas += r.planoSugerido;
      }
    });
    return { skus, pecas };
  }, [rowsVisiveisTela, periodoAlvo, maModo]);

  const resumoNegativos = useMemo(() => {
    let itensAtuais = 0;
    let pecasAtuais = 0;
    let itensPos = 0;
    let pecasPos = 0;
    rowsVisiveisTela.forEach((r) => {
      if (Number(r.dispMesAlvo || 0) < 0) {
        itensAtuais += 1;
        pecasAtuais += Math.abs(Number(r.dispMesAlvo || 0));
      }
      if (Number(r.dispPos || 0) < 0) {
        itensPos += 1;
        pecasPos += Math.abs(Number(r.dispPos || 0));
      }
    });
    return { itensAtuais, pecasAtuais: Math.round(pecasAtuais), itensPos, pecasPos: Math.round(pecasPos) };
  }, [rowsVisiveisTela]);

  const resumoCapacidadeUL = useMemo(() => {
    if (!(periodoAlvo === 'UL' || periodoAlvo === 'QT')) {
      return { ligado: false, cortados: 0, qtdCortada: 0, qtdMantida: 0, itensNegativos: 0, pecasNegativas: 0 };
    }
    let cortados = 0;
    let qtdCortada = 0;
    let qtdMantida = 0;
    let itensNegativos = 0;
    let pecasNegativas = 0;
    rowsVisiveisTela.forEach((r) => {
      const base = Math.max(0, Number(r.planoSugerido || 0));
      const atual = Math.max(0, Number((periodoAlvo === 'UL' ? r.planoUL : r.planoQT) || 0));
      if (base > 0) qtdMantida += base;
      if (considerarCapacidade && base < atual) {
        cortados += 1;
        qtdCortada += Math.max(0, atual - base);
      }
      if (considerarCapacidade && Number(r.dispPos || 0) < 0) {
        itensNegativos += 1;
        pecasNegativas += Math.abs(Number(r.dispPos || 0));
      }
    });
    return {
      ligado: considerarCapacidade,
      cortados: Math.round(cortados),
      qtdCortada: Math.round(qtdCortada),
      qtdMantida: Math.round(qtdMantida),
      itensNegativos: Math.round(itensNegativos),
      pecasNegativas: Math.round(pecasNegativas),
    };
  }, [periodoAlvo, rowsVisiveisTela, considerarCapacidade]);

  const diagnosticoCapacidadeUL = useMemo(() => {
    if (!(periodoAlvo === 'UL' || periodoAlvo === 'QT')) {
      return {
        cargaDisponivelUL: 0,
        cargaSugeridaUL: 0,
        fatorCobertura: 1,
        top30Estimado: cfg.cobertura_top30,
        demaisEstimado: cfg.cobertura_demais,
        kissEstimado: cfg.cobertura_kissme,
        gruposEstourados: [] as Array<{ grupo: string; saldo: number; diasFaltantes: number; cargaUL: number; capacidadeUL: number }>,
      };
    }

    const diasMA = Number(capacidadeDias[String(periodos.MA)] || 0);
    const diasPX = Number(capacidadeDias[String(periodos.PX)] || 0);
    const diasUL = Number(capacidadeDias[String(periodos.UL)] || 0);
    const diasQT = Number(capacidadeDias[String(mesSeguinte(Number(periodos.UL || 0)))] || 0);
    let cargaDisponivelUL = 0;
    let cargaSugeridaUL = 0;
    const gruposEstourados: Array<{ grupo: string; saldo: number; diasFaltantes: number; cargaUL: number; capacidadeUL: number }> = [];

    capacidadeGrupos.forEach((grupo) => {
      const grupoKey = normRef(grupo.grupo);
      const capDiaria = Number(grupo.capacidade_diaria || 0);
      const capMA = capDiaria * diasMA;
      const capPX = capDiaria * diasPX;
      const capUL = capDiaria * diasUL;
      const capQT = capDiaria * diasQT;

      let processoCarga = 0;
      let cargaMA = 0;
      let cargaPX = 0;
      let cargaUL = 0;
      let cargaQT = 0;

      rows.forEach((row) => {
        const rateio = row.grupoRateios.find((g) => g.grupo === grupoKey)?.rateio || 0;
        if (!(rateio > 0) || !(Number(row.tempoRef || 0) > 0)) return;
        processoCarga += Number(row.emProcesso || 0) * Number(row.tempoRef || 0) * rateio;
        cargaMA += Number(row.planoMA || 0) * Number(row.tempoRef || 0) * rateio;
        cargaPX += Number(row.planoPX || 0) * Number(row.tempoRef || 0) * rateio;
        cargaUL += Number((periodoAlvo === 'UL'
          ? (considerarCapacidade ? row.planoAntesCapacidade : row.planoSugerido)
          : row.planoUL) || 0) * Number(row.tempoRef || 0) * rateio;
        cargaQT += Number((periodoAlvo === 'QT'
          ? (considerarCapacidade ? row.planoAntesCapacidade : row.planoSugerido)
          : row.planoQT) || 0) * Number(row.tempoRef || 0) * rateio;
      });

      const disponivelUL = Math.max(0, (capMA - (processoCarga + cargaMA)) + (capPX - cargaPX) + capUL);
      const disponivelQT = Math.max(0, disponivelUL - cargaUL + capQT);
      const disponibilidadeAlvo = periodoAlvo === 'UL' ? disponivelUL : disponivelQT;
      const cargaAlvo = periodoAlvo === 'UL' ? cargaUL : cargaQT;
      const saldoFinal = disponibilidadeAlvo - cargaAlvo;
      cargaDisponivelUL += disponibilidadeAlvo;
      cargaSugeridaUL += cargaAlvo;

      if (saldoFinal < 0) {
        gruposEstourados.push({
          grupo: String(grupo.grupo || '-'),
          saldo: saldoFinal,
          diasFaltantes: capDiaria > 0 ? Math.abs(saldoFinal) / capDiaria : 0,
          cargaUL: cargaAlvo,
          capacidadeUL: disponibilidadeAlvo,
        });
      }
    });

    gruposEstourados.sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo));
    const fatorCobertura = cargaSugeridaUL > 0 ? Math.min(1, cargaDisponivelUL / cargaSugeridaUL) : 1;

    return {
      cargaDisponivelUL,
      cargaSugeridaUL,
      fatorCobertura,
      top30Estimado: Number(cfg.cobertura_top30 || 0) * fatorCobertura,
      demaisEstimado: Number(cfg.cobertura_demais || 0) * fatorCobertura,
      kissEstimado: Number(cfg.cobertura_kissme || 0) * fatorCobertura,
      gruposEstourados,
    };
  }, [periodoAlvo, capacidadeDias, periodos, capacidadeGrupos, rows, cfg, considerarCapacidade]);

  const coberturaSugeridaAutomatica = useMemo(() => {
    if (!(periodoAlvo === 'UL' || periodoAlvo === 'QT')) {
      return {
        top30: Number(cfg.cobertura_top30 || 0),
        demais: Number(cfg.cobertura_demais || 0),
        kiss: Number(cfg.cobertura_kissme || 0),
        observacao: '',
      };
    }

    const mediaPorClasse = (classe: Row['classe']) => {
      const itens = rowsVisiveisTela.filter((r) => r.classe === classe && Number(r.estoqueMin || 0) > 0);
      if (!itens.length) {
        if (classe === 'TOP30') return Number(cfg.cobertura_top30 || 0);
        if (classe === 'KISS ME') return Number(cfg.cobertura_kissme || 0);
        return Number(cfg.cobertura_demais || 0);
      }
      let somaPeso = 0;
      let somaCob = 0;
      itens.forEach((r) => {
        const peso = Math.max(1, Number(r.estoqueMin || 0));
        const cob = Math.max(0, Number(r.coberturaPos || 0));
        somaPeso += peso;
        somaCob += cob * peso;
      });
      return somaPeso > 0 ? somaCob / somaPeso : 0;
    };

    const top30 = Number(mediaPorClasse('TOP30').toFixed(2));
    const demais = Number(mediaPorClasse('DEMAIS').toFixed(2));
    const kiss = Number(mediaPorClasse('KISS ME').toFixed(2));
    const observacao = diagnosticoCapacidadeUL.gruposEstourados.length > 0
      ? 'Cobertura média viável do plano final. Ainda existem grupos gargalo na tabela vermelha.'
      : 'Cobertura média viável do plano final que coube na capacidade.';
    return { top30, demais, kiss, observacao };
  }, [periodoAlvo, diagnosticoCapacidadeUL, cfg, rowsVisiveisTela]);

  const resumoCoberturaPos = useMemo(() => {
    const mediaPorClasse = (classe: Row['classe']) => {
      const itens = rowsVisiveisTela.filter((r) => r.classe === classe && Number(r.estoqueMin || 0) > 0);
      if (!itens.length) return 0;
      let somaPeso = 0;
      let somaCob = 0;
      itens.forEach((r) => {
        const peso = Math.max(1, Number(r.estoqueMin || 0));
        const cob = Number(r.coberturaPos || 0);
        somaPeso += peso;
        somaCob += cob * peso;
      });
      return somaPeso > 0 ? somaCob / somaPeso : 0;
    };
    return {
      top30: mediaPorClasse('TOP30'),
      kiss: mediaPorClasse('KISS ME'),
      demais: mediaPorClasse('DEMAIS'),
    };
  }, [rowsVisiveisTela]);

  const bloqueioRefMap = useMemo(() => {
    const map = new Map<string, NonNullable<MpViabilidade['refsBloqueadasDetalhe']>[number]>();
    for (const b of mpViab.refsBloqueadasDetalhe || []) {
      const key = String(b.idreferencia || '').trim();
      if (key) map.set(key, b);
    }
    return map;
  }, [mpViab.refsBloqueadasDetalhe]);

  const escopoRefMap = useMemo(() => {
    const map = new Map<string, NonNullable<MpViabilidade['refsEscopoDetalhe']>[number]>();
    for (const b of mpViab.refsEscopoDetalhe || []) {
      const key = String(b.idreferencia || '').trim();
      if (key) map.set(key, b);
    }
    return map;
  }, [mpViab.refsEscopoDetalhe]);
  const planoTotalRefMap = useMemo(() => {
    const map = new Map<string, NonNullable<MpViabilidade['refsPlanoTotalDetalhe']>[number]>();
    for (const b of mpViab.refsPlanoTotalDetalhe || []) {
      const key = String(b.idreferencia || '').trim();
      if (key) map.set(key, b);
    }
    return map;
  }, [mpViab.refsPlanoTotalDetalhe]);

  function abrirModalMpDaLinha(r: Row) {
    if (periodoAlvo !== 'MA' || maModo !== 'EMERGENCIA') return;
    const k1 = String(r.referencia || '').trim();
    const k2 = String(r.idreferencia || '').trim();
    const hitEscopo = escopoRefMap.get(k1) || escopoRefMap.get(k2) || null;
    if (hitEscopo) {
      setMpModalRef(hitEscopo);
      return;
    }
    const hitBloq = bloqueioRefMap.get(k1) || bloqueioRefMap.get(k2) || null;
    if (hitBloq) {
      setMpModalRef(hitBloq);
      return;
    }
    const hitTotal = planoTotalRefMap.get(k1) || planoTotalRefMap.get(k2) || null;
    if (hitTotal) {
      setMpModalRef(hitTotal);
      return;
    }
    setMpModalRef({
      idreferencia: k1 || k2 || '-',
      bloqueada: false,
      materiasprimas_criticas: [],
      materiasprimas_criticas_detalhe: [],
    });
  }

  useEffect(() => {
    let cancelado = false;
    async function analisarMpPeriodo() {
      if (periodoAlvo === 'MA' || rows.length === 0) {
        setMpViab({
          loading: false, erro: null, aumentoMA: 0, mpCriticas: 0, deficitMA: 0, viavelPlanoTotal: true, viavelEscopo: true,
          scopeTotalMA: 0, scopeViavelMA: 0,
          percViavelMA: 100, refsViaveis: 0, refsBloqueadas: 0, refsBloqueadasDetalhe: [], refsEscopoDetalhe: [], refsPlanoTotalDetalhe: [],
        });
        return;
      }

      const rowsVisiveisSet = new Set(rowsVisiveis.map((r) => String(r.idproduto || '').trim()));
      const planos = rows
        .map((r) => {
          const inScope = rowsVisiveisSet.has(String(r.idproduto || '').trim());
          const maAjustado = Math.max(0, Number(r.planoMA || 0));
          const pxAjustado = periodoAlvo === 'PX' && inScope ? Math.max(0, Number(r.planoSugerido || 0)) : Math.max(0, Number(r.planoPX || 0));
          const ulAjustado = periodoAlvo === 'UL' && inScope ? Math.max(0, Number(r.planoSugerido || 0)) : Math.max(0, Number(r.planoUL || 0));
          const qtAjustado = periodoAlvo === 'QT' && inScope ? Math.max(0, Number(r.planoSugerido || 0)) : Math.max(0, Number(r.planoQT || 0));
          return {
            idproduto: String(r.idproduto || '').trim(),
            idreferencia: String(r.idreferencia || '').trim(),
            ma: maAjustado,
            px: pxAjustado,
            ul: ulAjustado,
            qt: qtAjustado,
            ma_scope: 0,
          };
        })
        .filter((p) => p.idproduto && (p.ma > 0 || p.px > 0 || p.ul > 0 || p.qt > 0));

      const aumentoMA = rowsVisiveis.reduce((acc, r) => {
        if (periodoAlvo === 'PX') return acc + Math.max(0, Number(r.planoSugerido || 0) - Number(r.planoPX || 0));
        if (periodoAlvo === 'UL') return acc + Math.max(0, Number(r.planoSugerido || 0) - Number(r.planoUL || 0));
        return acc + Math.max(0, Number(r.planoSugerido || 0) - Number(r.planoQT || 0));
      }, 0);
      if (!planos.length) {
        setMpViab({
          loading: false, erro: null, aumentoMA, mpCriticas: 0, deficitMA: 0, viavelPlanoTotal: true, viavelEscopo: true,
          scopeTotalMA: 0, scopeViavelMA: 0,
          percViavelMA: 100, refsViaveis: 0, refsBloqueadas: 0, refsBloqueadasDetalhe: [], refsEscopoDetalhe: [], refsPlanoTotalDetalhe: [],
        });
        return;
      }

      setMpViab((prev) => ({ ...prev, loading: true, erro: null, aumentoMA }));
      try {
        const r = await fetchNoCache(`${API_URL}/api/consumo-mp/analise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planos, multinivel: true }),
        });
        const p = await r.json();
        if (!r.ok || !p?.success) throw new Error(p?.error || 'Erro ao validar MP');
        const rowsMp = Array.isArray(p?.data) ? p.data : [];
        let mpCriticas = 0;
        let deficitMA = 0;
        for (const mp of rowsMp) {
          const saldoMA = Number(mp?.saldo_ma || 0);
          if (saldoMA < 0) {
            mpCriticas += 1;
            deficitMA += Math.abs(saldoMA);
          }
        }
        if (cancelado) return;
        const diag = p?.diagnostico_ma || {};
        const scopeTotalMA = Number(diag?.scope_ma_total ?? p?.meta?.scope_ma_total ?? 0);
        const scopeViavelMA = Number(diag?.scope_ma_viavel ?? p?.meta?.scope_ma_viavel ?? 0);
        const percViavelMA = Number(diag?.scope_ma_viavel_pct ?? p?.meta?.scope_ma_viavel_pct ?? 100);
        const refsViaveis = Number(diag?.refs_viaveis ?? p?.meta?.refs_viaveis ?? 0);
        const refsBloqueadas = Number(diag?.refs_bloqueadas ?? p?.meta?.refs_bloqueadas ?? 0);
        const refsBloqueadasDetalhe = Array.isArray(diag?.refs_bloqueadas_detalhe) ? diag.refs_bloqueadas_detalhe : [];
        const refsEscopoDetalhe = Array.isArray(diag?.refs_escopo_detalhe) ? diag.refs_escopo_detalhe : [];
        const refsPlanoTotalDetalhe = Array.isArray(diag?.refs_plano_total_detalhe) ? diag.refs_plano_total_detalhe : [];
        const viavelEscopo = scopeTotalMA <= 0 ? true : refsBloqueadas === 0;
        setMpViab({
          loading: false,
          erro: null,
          aumentoMA,
          mpCriticas,
          deficitMA,
          viavelPlanoTotal: mpCriticas === 0,
          viavelEscopo,
          scopeTotalMA: Number.isFinite(scopeTotalMA) ? scopeTotalMA : 0,
          scopeViavelMA: Number.isFinite(scopeViavelMA) ? scopeViavelMA : 0,
          percViavelMA: Number.isFinite(percViavelMA) ? percViavelMA : 100,
          refsViaveis,
          refsBloqueadas,
          refsBloqueadasDetalhe,
          refsEscopoDetalhe,
          refsPlanoTotalDetalhe,
        });
      } catch (e) {
        if (cancelado) return;
        setMpViab((prev) => ({
          ...prev,
          loading: false,
          erro: e instanceof Error ? e.message : 'Erro ao validar MP',
          viavelPlanoTotal: false,
          viavelEscopo: false,
        }));
      }
    }
    analisarMpPeriodo();
    return () => { cancelado = true; };
  }, [periodoAlvo, maModo, rowsVisiveis, rows]);

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  function syncScroll(from: 'left' | 'right') {
    const left = leftScrollRef.current;
    const right = rightScrollRef.current;
    if (!left || !right) return;
    if (syncingRef.current && syncingRef.current !== from) return;

    syncingRef.current = from;
    if (from === 'left') {
      right.scrollTop = left.scrollTop;
    } else {
      left.scrollTop = right.scrollTop;
    }
    requestAnimationFrame(() => {
      syncingRef.current = null;
    });
  }

  function syncWheel(from: 'left' | 'right', deltaY: number) {
    const left = leftScrollRef.current;
    const right = rightScrollRef.current;
    if (!left || !right) return;
    if (syncingRef.current && syncingRef.current !== from) return;

    syncingRef.current = from;
    left.scrollTop += deltaY;
    right.scrollTop += deltaY;
    requestAnimationFrame(() => {
      syncingRef.current = null;
    });
  }

  async function salvarSugestaoAtual() {
    try {
      setSalvandoSugestao(true);
      setError(null);
      setOkMsg(null);

      const candidatosSalvar =
        periodoAlvo === 'MA' && maModo === 'EMERGENCIA'
          ? rows
          : rowsVisiveisTela;

      const alterados =
        periodoAlvo === 'MA' && maModo === 'EMERGENCIA'
          ? candidatosSalvar
          : candidatosSalvar.filter((r) => Math.round(r.planoSugerido || 0) !== Math.round(r.planoAtual || 0));
      const alteradosKeys = new Set(alterados.map((r) => String(r.chave || '').trim()).filter(Boolean));
      const isPlanoCompletoCont = (cont: string) => {
        const norm = String(cont || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
          .toUpperCase();
        return norm === 'PERMANENTE' || norm === 'PERMANENTE COR NOVA';
      };
      const buildPlano = (r: Row, aplicarSugestao: boolean) => ({
        chave: r.chave,
        ma: Math.round(periodoAlvo === 'MA' && aplicarSugestao ? r.planoSugerido : r.planoMA),
        px: Math.round(periodoAlvo === 'PX' && aplicarSugestao ? r.planoSugerido : r.planoPX),
        ul: Math.round(periodoAlvo === 'UL' && aplicarSugestao ? r.planoSugerido : r.planoUL),
        qt: Math.round(periodoAlvo === 'QT' && aplicarSugestao ? r.planoSugerido : r.planoQT),
      });

      const planosMap = new Map<string, { chave: string; ma: number; px: number; ul: number; qt: number }>();

      // Sempre levar plano completo de PERMANENTE e PERMANENTE COR NOVA.
      rows
        .filter((r) => isPlanoCompletoCont(String(r.continuidade || '')))
        .forEach((r) => {
          const chave = String(r.chave || '').trim();
          if (!chave) return;
          planosMap.set(chave, buildPlano(r, alteradosKeys.has(chave)));
        });

      // Mantém também alterações de outros grupos/continuidade.
      alterados.forEach((r) => {
        const chave = String(r.chave || '').trim();
        if (!chave) return;
        planosMap.set(chave, buildPlano(r, true));
      });

      if (periodoAlvo === 'MA' && maModo === 'EMERGENCIA') {
        planosMap.clear();
        candidatosSalvar.forEach((r) => {
          const chave = String(r.chave || '').trim();
          if (!chave) return;
          planosMap.set(chave, buildPlano(r, true));
        });
      }

      const planos = Array.from(planosMap.values());
      if (!planos.length) throw new Error('Nenhum item elegível para salvar.');

      const deltaTotal = alterados.reduce((acc, r) => acc + Math.round(r.deltaPlano || 0), 0);
      const payload = {
        nome: `Sugestão Plano ${periodoAlvo}${periodoAlvo === 'MA' ? ` · ${maModo === 'EMERGENCIA' ? 'Emergência' : 'Cobertura'}` : ''} · ${new Date().toLocaleDateString('pt-BR')}`,
        parametros: {
          tipo: 'SUGESTAO_PLANO',
          subtipo: periodoAlvo === 'MA' ? (maModo === 'EMERGENCIA' ? 'MA_EMERGENCIA' : 'MA_COBERTURA') : `MES_${periodoAlvo}`,
          statusAprovacao: 'PENDENTE',
          origem: 'SUGESTAO_PLANO',
          periodoAlvo,
          maModo: periodoAlvo === 'MA' ? maModo : null,
          filtros: {
            continuidade: filtroCont,
            suspensos: filtroSuspensos,
          },
          usarEstoqueLojas,
          estoqueLojasSnapshot: usarEstoqueLojas
            ? Array.from(estoqueLojasDisponivel.values()).map((item) => ({
                idproduto: String(item.cd_produto || ''),
                qtd_disponivel_total: Number(item.qtd_disponivel_total || 0),
              }))
            : [],
          considerarProjecaoNova,
          reprojecaoPreview: considerarProjecaoNova ? reprojecaoPreview : [],
          planos,
        },
        resumo: {
          alterados: alterados.length,
          deltaTotal,
          aumentoTotal: alterados.reduce((acc, r) => acc + Math.max(0, Math.round(r.deltaPlano || 0)), 0),
          retiradaTotal: alterados.reduce((acc, r) => acc + Math.max(0, -Math.round(r.deltaPlano || 0)), 0),
        },
        observacoes: `Gerado na Sugestão de Plano. Filtros: cont=${filtroCont}, suspensos=${filtroSuspensos}, viab=${filtroViabilidade}, estoqueLojas=${usarEstoqueLojas ? 'SIM' : 'NAO'}.`,
      };

      const res = await fetchNoCache(`${API_URL}/api/simulacoes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Erro ao salvar sugestão');
      const bloqueadosIgnorados =
        periodoAlvo === 'MA' && maModo === 'EMERGENCIA'
          ? Math.max(0, rowsVisiveisTela.length - candidatosSalvar.length)
          : 0;
      setOkMsg(
        bloqueadosIgnorados > 0
          ? `Sugestão salva com ${alterados.length} itens alterados e ${planos.length} itens no plano completo (${bloqueadosIgnorados} bloqueados ignorados).`
          : `Sugestão salva com ${alterados.length} itens alterados e ${planos.length} itens no plano completo.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar sugestão');
    } finally {
      setSalvandoSugestao(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 min-w-0 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="bg-brand-primary shadow-sm px-6 py-3">
          <h1 className="text-white font-bold font-secondary tracking-wide text-base">SUGESTÃO DE PLANO</h1>
          <p className="text-white/70 text-xs">Geração por mês-alvo: disponibilidade anterior + projeção atual + cobertura alvo por classe</p>
        </header>

        <main className="flex-1 min-w-0 px-6 py-5 space-y-4">
          {loading && <div className="bg-white rounded-lg border p-4 text-sm text-gray-500">Carregando...</div>}
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}
          {okMsg && <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700">{okMsg}</div>}

          <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap gap-3 items-end">
            <label className="text-xs text-gray-600">
              Mês-alvo
              <select value={periodoAlvo} onChange={(e) => setPeriodoAlvo(e.target.value as PeriodoAlvo)} className="mt-1 border border-gray-300 rounded px-2 py-1.5">
                <option value="MA">MA</option>
                <option value="PX">PX</option>
                <option value="UL">UL</option>
                <option value="QT">QT</option>
              </select>
            </label>
            {periodoAlvo === 'MA' && (
              <label className="text-xs text-gray-600">
                Modo MA
                <select value={maModo} onChange={(e) => setMaModo(e.target.value as MAModo)} className="mt-1 border border-gray-300 rounded px-2 py-1.5">
                  <option value="EMERGENCIA">MA - Emergência</option>
                  <option value="COBERTURA">MA - Cobertura</option>
                </select>
              </label>
            )}
            <div className="text-xs text-gray-600">
              Coberturas config:
              {' '}Top30 <strong>{cfg.cobertura_top30.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x</strong>
              {' '}· Demais <strong>{cfg.cobertura_demais.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x</strong>
              {' '}· KISS ME <strong>{cfg.cobertura_kissme.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x</strong>
              {' '}· Corte mínimo <strong>{cfg.usar_corte_minimo ? 'ATIVO' : 'INATIVO'}</strong>
            </div>
            <label className="text-xs text-gray-600">
              Margem MA negativo (x)
              <input
                type="number"
                min={0}
                max={0.3}
                step={0.01}
                value={margemCobMA}
                onChange={(e) => setMargemCobMA(Math.max(0, Math.min(0.3, Number(e.target.value || 0))))}
                className="mt-1 w-24 border border-gray-300 rounded px-2 py-1.5"
              />
            </label>
            <div className="text-xs text-gray-500">
              Piso MA negativo: <strong>{(COB_ALVO_MA_NEGATIVO - Math.max(0, margemCobMA)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x</strong>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-gray-300"
                checked={somenteDeltaNegativo}
                onChange={(e) => setSomenteDeltaNegativo(e.target.checked)}
              />
              Somente delta negativo
            </label>
            <button
              type="button"
              onClick={() => setSomenteNegativoMA((v) => !v)}
              className={`px-3 py-1.5 text-xs font-semibold rounded border ${
                somenteNegativoMA
                  ? 'bg-red-100 text-red-700 border-red-300'
                  : 'bg-white text-gray-700 border-gray-300'
              }`}
            >
              Negativo {periodoAlvo}
            </button>
            <label className="text-xs text-gray-600">
              Continuidade
              <select
                value={filtroCont}
                onChange={(e) => setFiltroCont(e.target.value as typeof filtroCont)}
                className="mt-1 border border-gray-300 rounded px-2 py-1.5"
              >
                <option value="TODAS">Todas</option>
                <option value="PERMANENTE">PERMANENTE</option>
                <option value="PERMANENTE COR NOVA">PERMANENTE COR NOVA</option>
              </select>
            </label>
            <label className="text-xs text-gray-600">
              Suspensos (124)
              <select
                value={filtroSuspensos}
                onChange={(e) => setFiltroSuspensos(e.target.value as typeof filtroSuspensos)}
                className="mt-1 border border-gray-300 rounded px-2 py-1.5"
              >
                <option value="INCLUIR">Incluir</option>
                <option value="EXCLUIR">Excluir</option>
              </select>
            </label>
            <label className="text-xs text-gray-600">
              OP Min
              <select
                value={filtroOpMin}
                onChange={(e) => setFiltroOpMin(e.target.value as typeof filtroOpMin)}
                className="mt-1 border border-gray-300 rounded px-2 py-1.5"
              >
                <option value="TODOS">Todos</option>
                <option value="BLOQUEADA">Só bloqueada</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-gray-300"
                checked={considerarProjecaoNova}
                onChange={(e) => setConsiderarProjecaoNova(e.target.checked)}
              />
              Considerar projeção nova
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-gray-300"
                checked={considerarCapacidade}
                onChange={(e) => setConsiderarCapacidade(e.target.checked)}
              />
              Considerar capacidade
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-gray-300"
                checked={usarEstoqueLojas}
                onChange={(e) => setUsarEstoqueLojas(e.target.checked)}
              />
              Usar estoque lojas
            </label>
            {carregandoEstoqueLojas ? (
              <div className="text-xs text-violet-700">Carregando estoque disponível...</div>
            ) : (
              usarEstoqueLojas && estoqueLojasDisponivel.size > 0 && (
                <div className="text-xs text-gray-500">
                  {estoqueLojasDisponivel.size.toLocaleString('pt-BR')} produtos com saldo disponível
                </div>
              )
            )}
            {periodoAlvo !== 'MA' && (
              <label className="text-xs text-gray-600">
                Filtro MP
                <select
                  value={filtroViabilidade}
                  onChange={(e) => setFiltroViabilidade(e.target.value as typeof filtroViabilidade)}
                  className="mt-1 border border-gray-300 rounded px-2 py-1.5"
                >
                  <option value="TODOS">Todos</option>
                  {false ? (
                    <>
                      <option value="PRODUTIVEL">Só produzível</option>
                      <option value="BLOQUEADO">Só bloqueado</option>
                    </>
                  ) : (
                    <>
                      <option value="OK">Só OK</option>
                      <option value="SOLICITAR_COMPRA">Só solicitar compra</option>
                    </>
                  )}
                </select>
              </label>
            )}
            <button
              type="button"
              onClick={salvarSugestaoAtual}
              disabled={salvandoSugestao || loading}
              className="ml-auto px-3 py-1.5 text-xs font-semibold rounded border border-brand-primary bg-brand-primary text-white hover:bg-brand-secondary disabled:opacity-60"
            >
              {salvandoSugestao ? 'Salvando...' : 'Salvar sugestão'}
            </button>
          </div>

          {(considerarProjecaoNova || recalculandoProjecao || resultadoReprojecaoMsg) && (
            <div className={`rounded-lg border px-4 py-3 text-sm ${
              recalculandoProjecao
                ? 'bg-violet-50 border-violet-200 text-violet-800'
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}>
              {recalculandoProjecao ? (
                <div className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4 shrink-0 text-violet-700" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  <span>Gerando novos cálculos de projeção...</span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-semibold">Resultado</span>
                  <span>{resultadoReprojecaoMsg}</span>
                  <span className="text-xs text-gray-500">
                    Original: <strong>{fmt(resumoMudancaProjecao.originalTotal)}</strong> ·
                    {' '}Novo: <strong>{fmt(resumoMudancaProjecao.novoTotal)}</strong>
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
            <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Resumo do Plano</div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                <div className="text-[11px] text-gray-500">Plano atual ({periodoAlvo})</div>
                <div className="text-xl font-bold text-gray-900 leading-tight">{fmt(resumo.atual)}</div>
              </div>
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                <div className="text-[11px] text-gray-500">Plano sugerido ({periodoAlvo})</div>
                <div className="text-xl font-bold text-brand-dark leading-tight">{fmt(resumo.sugerido)}</div>
              </div>
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                <div className="text-[11px] text-gray-500">Delta</div>
                <div className={`text-xl font-bold leading-tight ${resumo.delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmt(resumo.delta)}</div>
              </div>
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                <div className="text-[11px] text-gray-500">Negativos atuais</div>
                <div className={`text-xl font-bold leading-tight ${resumoNegativos.itensAtuais > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                  {fmt(resumoNegativos.pecasAtuais)}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">Itens: {fmt(resumoNegativos.itensAtuais)}</div>
              </div>
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                <div className="text-[11px] text-gray-500">Negativos após gerar plano</div>
                <div className={`text-xl font-bold leading-tight ${resumoNegativos.itensPos > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                  {fmt(resumoNegativos.pecasPos)}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">Itens: {fmt(resumoNegativos.itensPos)}</div>
              </div>
            </div>

            {resumoSuspensos.total > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <div className="text-[11px] text-amber-700">SKUs Suspensos (124)</div>
                  <div className="text-xl font-bold text-amber-800 leading-tight">{fmt(resumoSuspensos.total)}</div>
                </div>
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <div className="text-[11px] text-amber-700">Plano Suspensos ({periodoAlvo})</div>
                  <div className="text-xl font-bold text-amber-800 leading-tight">{fmt(resumoSuspensos.plano)}</div>
                </div>
                <div className={`rounded-md border px-3 py-2.5 ${
                  filtroSuspensos === 'INCLUIR'
                    ? 'border-amber-300 bg-amber-100'
                    : 'border-emerald-300 bg-emerald-100'
                }`}>
                  <div className={`text-[11px] ${filtroSuspensos === 'INCLUIR' ? 'text-amber-800' : 'text-emerald-800'}`}>
                    Status filtro
                  </div>
                  <div className={`text-xl font-bold leading-tight ${filtroSuspensos === 'INCLUIR' ? 'text-amber-900' : 'text-emerald-900'}`}>
                    {filtroSuspensos === 'INCLUIR' ? 'INCLUÍDOS' : 'EXCLUÍDOS'}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                <div className="text-[11px] text-gray-500">Plano {periodoAlvo} sem OP mínima</div>
                <div className="text-xl font-bold text-gray-900 leading-tight">{fmt(resumoOpMin.semOpMin)}</div>
              </div>
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                <div className="text-[11px] text-gray-500">Extra puxado por OP mínima</div>
                <div className={`text-xl font-bold leading-tight ${resumoOpMin.extraOpMin > 0 ? 'text-emerald-700' : 'text-gray-700'}`}>{fmt(resumoOpMin.extraOpMin)}</div>
              </div>
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                <div className="text-[11px] text-gray-500">Plano {periodoAlvo} com OP mínima</div>
                <div className="text-xl font-bold text-brand-dark leading-tight">{fmt(resumoOpMin.comOpMinBase)}</div>
              </div>
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5">
                <div className="text-[11px] text-rose-700">SKUs OP Min bloqueada</div>
                <div className="text-xl font-bold text-rose-700 leading-tight">{fmt(resumoSkuOpMinBloqueada)}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                <div className="text-[11px] text-gray-500">Cob. Pós Top30</div>
                <div className="text-xl font-bold text-gray-900 leading-tight">
                  {resumoCoberturaPos.top30.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x
                </div>
              </div>
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                <div className="text-[11px] text-gray-500">Cob. Pós KISS ME</div>
                <div className="text-xl font-bold text-gray-900 leading-tight">
                  {resumoCoberturaPos.kiss.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x
                </div>
              </div>
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                <div className="text-[11px] text-gray-500">Cob. Pós Demais</div>
                <div className="text-xl font-bold text-gray-900 leading-tight">
                  {resumoCoberturaPos.demais.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x
                </div>
              </div>
            </div>

            {periodoAlvo === 'MA' && maModo === 'EMERGENCIA' && (
              <>
                {resumoMeioLote.skus > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5">
                      <div className="text-[11px] text-amber-700">SKUs com Corte Mín ÷ 2</div>
                      <div className="text-xl font-bold text-amber-800 leading-tight">{fmt(resumoMeioLote.skus)}</div>
                      <div className="text-[11px] text-amber-600 mt-0.5">Peças: {fmt(resumoMeioLote.pecas)}</div>
                    </div>
                    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5 flex items-center">
                      <div className="text-[11px] text-gray-500">
                        Esses SKUs tiveram o corte mínimo dividido por 2 para evitar cobertura &gt; 1x
                      </div>
                    </div>
                  </div>
                )}

                <div className="pt-1 text-xs font-semibold text-gray-600 uppercase tracking-wide">Viabilidade de Matéria-Prima</div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <div className="text-[11px] text-gray-500">Aumento MA (negativos)</div>
                    <div className="text-xl font-bold text-brand-dark leading-tight">{fmt(mpViab.aumentoMA)}</div>
                  </div>
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <div className="text-[11px] text-gray-500">MP críticas (MA)</div>
                    <div className={`text-xl font-bold leading-tight ${mpViab.mpCriticas > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmt(mpViab.mpCriticas)}</div>
                  </div>
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <div className="text-[11px] text-gray-500">Déficit MP MA</div>
                    <div className={`text-xl font-bold leading-tight ${mpViab.deficitMA > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmt(mpViab.deficitMA)}</div>
                  </div>
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <div className="text-[11px] text-gray-500">Viabilidade MP (plano total)</div>
                    <div className={`text-xl font-bold leading-tight ${mpViab.viavelPlanoTotal ? 'text-emerald-700' : 'text-red-700'}`}>
                      {mpViab.loading ? 'Analisando...' : mpViab.viavelPlanoTotal ? 'VIÁVEL' : 'LIMITADO'}
                    </div>
                    {mpViab.erro && <div className="text-[11px] text-red-700 mt-0.5">{mpViab.erro}</div>}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <div className="text-[11px] text-gray-500">% plano MA viável (escopo)</div>
                    <div className="text-xl font-bold text-brand-dark leading-tight">
                      {mpViab.loading ? '...' : mpViab.scopeTotalMA <= 0 ? '-' : `${mpViab.percViavelMA.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
                    </div>
                    {!mpViab.loading && (
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        Viável: {fmt(mpViab.scopeViavelMA)} / Escopo: {fmt(mpViab.scopeTotalMA)}
                      </div>
                    )}
                  </div>
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <div className="text-[11px] text-gray-500">Referências viáveis</div>
                    <div className="text-xl font-bold text-emerald-700 leading-tight">{mpViab.loading ? '...' : fmt(mpViab.refsViaveis)}</div>
                  </div>
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <div className="text-[11px] text-gray-500">Referências bloqueadas</div>
                    <div className="text-xl font-bold text-red-700 leading-tight">{mpViab.loading ? '...' : fmt(mpViab.refsBloqueadas)}</div>
                  </div>
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <div className="text-[11px] text-gray-500">Plano sugerido MA</div>
                    <div className={`text-xl font-bold leading-tight ${mpViab.loading ? 'text-gray-700' : mpViab.viavelEscopo ? 'text-emerald-700' : 'text-red-700'}`}>
                      {mpViab.loading ? 'Analisando...' : mpViab.scopeTotalMA <= 0 ? 'SEM AUMENTO' : mpViab.viavelEscopo ? 'SIM' : 'NÃO'}
                    </div>
                    {!mpViab.loading && !mpViab.viavelEscopo && mpViab.scopeTotalMA > 0 && (
                      <div className="text-[11px] text-red-700 mt-0.5">Existe bloqueio de MP no escopo.</div>
                    )}
                  </div>
                </div>
              </>
            )}
            {periodoAlvo !== 'MA' && (
              <>
                <div className="pt-1 text-xs font-semibold text-gray-600 uppercase tracking-wide">Matéria-Prima Acumulada ({periodoAlvo})</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <div className="text-[11px] text-gray-500">Status MP plano sugerido</div>
                    <div className={`text-xl font-bold leading-tight ${
                      rowsVisiveisTela.some((r) => statusViabilidadeRow(r) === 'SOLICITAR_COMPRA') ? 'text-amber-700' : 'text-emerald-700'
                    }`}>
                      {rowsVisiveisTela.some((r) => statusViabilidadeRow(r) === 'SOLICITAR_COMPRA') ? 'SOLICITAR COMPRA' : 'OK'}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-0.5">Consumo acumulado com prioridade MA → PX → UL.</div>
                  </div>
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <div className="text-[11px] text-gray-500">Itens com compra necessária</div>
                    <div className="text-xl font-bold text-amber-700 leading-tight">
                      {fmt(rowsVisiveisTela.filter((r) => statusViabilidadeRow(r) === 'SOLICITAR_COMPRA').length)}
                    </div>
                  </div>
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <div className="text-[11px] text-gray-500">Itens sem compra necessária</div>
                    <div className="text-xl font-bold text-emerald-700 leading-tight">
                      {fmt(rowsVisiveisTela.filter((r) => statusViabilidadeRow(r) === 'OK').length)}
                    </div>
                  </div>
                </div>
                {(periodoAlvo === 'UL' || periodoAlvo === 'QT') && (
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                    <div className={`rounded-md border px-3 py-2.5 ${considerarCapacidade ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                      <div className="text-[11px] text-gray-500">Capacidade ativa ({periodoAlvo})</div>
                      <div className={`text-xl font-bold leading-tight ${considerarCapacidade ? 'text-amber-700' : 'text-gray-700'}`}>
                        {considerarCapacidade ? 'ATIVA' : 'DESLIGADA'}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        {considerarCapacidade ? `${periodoAlvo} recalculado pelo saldo acumulado dos meses anteriores.` : 'Usando somente a lógica saudável do plano.'}
                      </div>
                    </div>
                    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                      <div className="text-[11px] text-gray-500">Itens ajustados pela capacidade</div>
                      <div className="text-xl font-bold text-brand-dark leading-tight">{fmt(resumoCapacidadeUL.cortados)}</div>
                    </div>
                    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                      <div className="text-[11px] text-gray-500">Quantidade cortada por capacidade</div>
                      <div className="text-xl font-bold text-red-700 leading-tight">{fmt(resumoCapacidadeUL.qtdCortada)}</div>
                    </div>
                    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                      <div className="text-[11px] text-gray-500">Itens negativos gerados</div>
                      <div className={`text-xl font-bold leading-tight ${resumoCapacidadeUL.itensNegativos > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                        {fmt(resumoCapacidadeUL.itensNegativos)}
                      </div>
                    </div>
                    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                      <div className="text-[11px] text-gray-500">Peças negativas geradas</div>
                      <div className={`text-xl font-bold leading-tight ${resumoCapacidadeUL.pecasNegativas > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                        {fmt(resumoCapacidadeUL.pecasNegativas)}
                      </div>
                    </div>
                  </div>
                )}
                {(periodoAlvo === 'UL' || periodoAlvo === 'QT') && (
                  <>
                    <div className="pt-1 text-xs font-semibold text-gray-600 uppercase tracking-wide">Ajuste estimado pela capacidade</div>
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                        <div className="text-[11px] text-gray-500">Carga UL que cabe</div>
                        <div className="text-xl font-bold text-gray-900 leading-tight">{fmt(diagnosticoCapacidadeUL.cargaDisponivelUL)}</div>
                      </div>
                      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                        <div className="text-[11px] text-gray-500">Carga UL sugerida</div>
                        <div className="text-xl font-bold text-brand-dark leading-tight">{fmt(diagnosticoCapacidadeUL.cargaSugeridaUL)}</div>
                      </div>
                      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                        <div className="text-[11px] text-gray-500">Fator de cobertura que cabe</div>
                        <div className="text-xl font-bold text-amber-700 leading-tight">
                          {(diagnosticoCapacidadeUL.fatorCobertura * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                        </div>
                      </div>
                      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                        <div className="text-[11px] text-gray-500">Cob. estimada Top30 / KISS</div>
                        <div className="text-lg font-bold text-gray-900 leading-tight">
                          {diagnosticoCapacidadeUL.top30Estimado.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x / {diagnosticoCapacidadeUL.kissEstimado.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x
                        </div>
                      </div>
                      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                        <div className="text-[11px] text-gray-500">Cob. estimada Demais</div>
                        <div className="text-xl font-bold text-gray-900 leading-tight">
                          {diagnosticoCapacidadeUL.demaisEstimado.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-3">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-blue-800">Cobertura sugerida automática</div>
                          <div className="mt-1 text-sm text-slate-700">
                            Top30 <strong>{coberturaSugeridaAutomatica.top30.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x</strong>
                            {' '}· KISS ME <strong>{coberturaSugeridaAutomatica.kiss.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x</strong>
                            {' '}· Demais <strong>{coberturaSugeridaAutomatica.demais.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x</strong>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-600">{coberturaSugeridaAutomatica.observacao}</div>
                        </div>
                        <button
                          type="button"
                          className="rounded-md border border-blue-300 bg-white px-3 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-100"
                          onClick={() => setCfg((prev) => ({
                            ...prev,
                            cobertura_top30: coberturaSugeridaAutomatica.top30,
                            cobertura_demais: coberturaSugeridaAutomatica.demais,
                            cobertura_kissme: coberturaSugeridaAutomatica.kiss,
                          }))}
                        >
                          Usar Cobertura Sugerida
                        </button>
                      </div>
                    </div>

                    {diagnosticoCapacidadeUL.gruposEstourados.length > 0 && (
                      <div className="rounded-lg border border-red-200 bg-red-50 overflow-hidden">
                        <div className="px-3 py-2 border-b border-red-200 text-xs font-semibold text-red-700 uppercase tracking-wide">
                          Grupos que estão estourando e podem deixar negativo
                        </div>
                        <div className="max-h-56 overflow-auto">
                          <table className="min-w-full text-[11px] leading-tight">
                            <thead className="sticky top-0 bg-red-100 text-red-900 z-10">
                              <tr>
                                <th className="text-left px-2 py-1.5 whitespace-nowrap">Grupo</th>
                                <th className="text-right px-2 py-1.5 whitespace-nowrap">Cap. UL útil</th>
                                <th className="text-right px-2 py-1.5 whitespace-nowrap">Carga UL</th>
                                <th className="text-right px-2 py-1.5 whitespace-nowrap">Saldo</th>
                                <th className="text-right px-2 py-1.5 whitespace-nowrap">Dias faltantes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {diagnosticoCapacidadeUL.gruposEstourados.slice(0, 12).map((g, idx) => (
                                <tr key={`${g.grupo}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-red-50/40'} border-t border-red-100`}>
                                  <td className="px-2 py-1.5 font-semibold whitespace-nowrap">{g.grupo}</td>
                                  <td className="px-2 py-1.5 text-right whitespace-nowrap">{fmt(g.capacidadeUL)}</td>
                                  <td className="px-2 py-1.5 text-right whitespace-nowrap">{fmt(g.cargaUL)}</td>
                                  <td className="px-2 py-1.5 text-right whitespace-nowrap text-red-700 font-semibold">{fmt(g.saldo)}</td>
                                  <td className="px-2 py-1.5 text-right whitespace-nowrap text-red-700 font-semibold">
                                    {g.diasFaltantes.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
          {periodoAlvo === 'MA' && maModo === 'EMERGENCIA' && !mpViab.loading && mpViab.refsBloqueadasDetalhe.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-200 text-xs font-semibold text-red-700">Referências bloqueadas por MP crítica</div>
              <div className="max-h-36 overflow-auto">
                <table className="min-w-full text-[11px] leading-tight">
                  <thead className="sticky top-0 bg-gray-100 z-10">
                    <tr>
                      <th className="text-left px-2 py-1 whitespace-nowrap">Referência</th>
                      <th className="text-left px-2 py-1 whitespace-nowrap">MPs críticas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mpViab.refsBloqueadasDetalhe.slice(0, 30).map((r, idx) => (
                      <tr key={`${r.idreferencia}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
                        <td className="px-2 py-1 font-semibold whitespace-nowrap">{r.idreferencia}</td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => abrirModalMpDaLinha({
                              idproduto: '',
                              idreferencia: r.idreferencia,
                              chave: '',
                              referencia: r.idreferencia,
                              cor: '',
                              tamanho: '',
                              continuidade: '',
                              cod_situacao: '',
                              linha: '',
                              grupoProduto: '',
                              classe: 'DEMAIS',
                              estoqueAtual: 0,
                              pedidosPendentes: 0,
                              emProcesso: 0,
                              dispAtualSemProcesso: 0,
                              dispAtualComProcesso: 0,
                              estoqueMin: 0,
                              media6m: 0,
                              media3m: 0,
                              variacaoPct: null,
                              regraEstoqueMin: '',
                              taxaJan: null,
                              taxaFev: null,
                              corteMin: 0,
                              coberturaAlvo: 0,
                              alvoDisp: 0,
                              necessidadeBruta: 0,
                              loteAplicado: 0,
                              planoSemCorte: 0,
                              projMes: 0,
                              dispAnterior: 0,
                              dispMA: 0,
                              dispPX: 0,
                              dispUL: 0,
                              dispQT: 0,
                              dispMesAlvo: 0,
                              coberturaMA: 0,
                              planoMA: 0,
                              planoPX: 0,
                              planoUL: 0,
                              planoQT: 0,
                              planoAtual: 0,
                              planoSugerido: 0,
                              planoBaseSemOpMin: 0,
                              planoAntesCapacidade: 0,
                              deltaPlano: 0,
                              dispPos: 0,
                              coberturaPos: 0,
                              regraOpMin: null,
                              rateioOpMinExtra: 0,
                              tempoRef: 0,
                              grupoRateios: [],
                            })}
                            className="px-2 py-0.5 text-[11px] rounded border border-red-300 text-red-700 bg-red-50 hover:bg-red-100"
                          >
                            Ver MPs ({(r.materiasprimas_criticas || []).length})
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {mpModalRef && (
            <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4">
              <div className="bg-white w-full max-w-6xl rounded-lg border border-gray-200 shadow-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-brand-dark">MPs críticas da referência {mpModalRef.idreferencia}</div>
                    <div className="text-xs text-gray-500">Saldo/deficit no MA para as matérias-primas que bloqueiam a referência</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMpModalRef(null)}
                    className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
                  >
                    Fechar
                  </button>
                </div>
                <div className="max-h-[72vh] overflow-auto">
                  {(!mpModalRef.materiasprimas_todas_detalhe || mpModalRef.materiasprimas_todas_detalhe.length === 0) &&
                   (!mpModalRef.materiasprimas_criticas_detalhe || mpModalRef.materiasprimas_criticas_detalhe.length === 0) && (
                    <div className="px-4 py-3 text-xs text-emerald-700 bg-emerald-50 border-b border-emerald-100">
                      Sem MP crítica para essa referência no escopo atual do MA.
                    </div>
                  )}
                  <table className="min-w-full text-[11px] leading-tight">
                    <thead className="sticky top-0 bg-gray-100 z-10">
                      <tr>
                        <th className="text-left px-2 py-1 whitespace-nowrap">MP</th>
                        <th className="text-left px-2 py-1 whitespace-nowrap">Produto</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Estoque MP</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Entr. MA</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Consumo MA</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Saldo MA</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Déficit MA</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Entr. PX</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Consumo PX</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Saldo PX</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Déficit PX</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Entr. UL</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Consumo UL</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Saldo UL</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Déficit UL</th>
                        <th className="text-left px-2 py-1 whitespace-nowrap">Status</th>
                        <th className="text-left px-2 py-1 whitespace-nowrap">Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(mpModalRef.materiasprimas_todas_detalhe && mpModalRef.materiasprimas_todas_detalhe.length > 0
                        ? mpModalRef.materiasprimas_todas_detalhe
                        : (mpModalRef.materiasprimas_criticas_detalhe || [])
                      ).length > 0 ? (
                        (mpModalRef.materiasprimas_todas_detalhe && mpModalRef.materiasprimas_todas_detalhe.length > 0
                          ? mpModalRef.materiasprimas_todas_detalhe
                          : (mpModalRef.materiasprimas_criticas_detalhe || [])
                        ).map((m, idx) => (
                          <tr key={`${m.idmateriaprima}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
                            <td className="px-2 py-1 font-semibold whitespace-nowrap">{m.idmateriaprima}</td>
                            <td className="px-2 py-1 whitespace-nowrap">{String(m.nome_materiaprima || '-')}</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap">{fmt(Number(m.estoquetotal || 0))}</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap text-sky-700">{fmt(Number(m.entrada_ma || 0))}</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap">{fmt(Number(m.consumo_ma || 0))}</td>
                            <td className={`px-2 py-1 text-right whitespace-nowrap ${Number(m.saldo_ma || 0) < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmt(m.saldo_ma)}</td>
                            <td className={`px-2 py-1 text-right font-semibold whitespace-nowrap ${Number(m.deficit_ma || 0) > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmt(m.deficit_ma)}</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap text-sky-700">{fmt(Number(m.entrada_px || 0))}</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap">{fmt(Number(m.consumo_px || 0))}</td>
                            <td className={`px-2 py-1 text-right whitespace-nowrap ${Number(m.saldo_px || 0) < 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{fmt(Number(m.saldo_px || 0))}</td>
                            <td className={`px-2 py-1 text-right font-semibold whitespace-nowrap ${Number(m.deficit_px || 0) > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{fmt(Number(m.deficit_px || 0))}</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap text-sky-700">{fmt(Number(m.entrada_ul || 0))}</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap">{fmt(Number(m.consumo_ul || 0))}</td>
                            <td className={`px-2 py-1 text-right whitespace-nowrap ${Number(m.saldo_ul || 0) < 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{fmt(Number(m.saldo_ul || 0))}</td>
                            <td className={`px-2 py-1 text-right font-semibold whitespace-nowrap ${Number(m.deficit_ul || 0) > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{fmt(Number(m.deficit_ul || 0))}</td>
                            <td className={`px-2 py-1 whitespace-nowrap font-semibold ${Number(m.saldo_ma || 0) < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                              {Number(m.saldo_ma || 0) < 0 ? 'Bloqueado MA' : (Number(m.saldo_px || 0) < 0 || Number(m.saldo_ul || 0) < 0) ? 'Solicitar compra' : 'OK'}
                            </td>
                            <td className={`px-2 py-1 whitespace-nowrap ${Number(m.deficit_ma || 0) > 0 ? 'text-red-700' : (Number(m.deficit_px || 0) > 0 || Number(m.deficit_ul || 0) > 0) ? 'text-amber-700' : 'text-gray-600'}`}>
                              {Number(m.deficit_ma || 0) > 0
                                ? `Consumo MA maior que estoque em ${fmt(Number(m.deficit_ma || 0))}`
                                : (Number(m.deficit_px || 0) > 0 || Number(m.deficit_ul || 0) > 0)
                                  ? 'Compra prevista necessária em PX/UL'
                                  : '-'}
                            </td>
                          </tr>
                        ))
                      ) : (
                        (mpModalRef.materiasprimas_criticas || []).map((id, idx) => (
                          <tr key={`${id}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
                            <td className="px-2 py-1 font-semibold whitespace-nowrap">{id}</td>
                            <td className="px-2 py-1 whitespace-nowrap">-</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap">-</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap">-</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap">-</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap">-</td>
                            <td className="px-2 py-1 whitespace-nowrap">-</td>
                            <td className="px-2 py-1 whitespace-nowrap">-</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              onClick={() => {
                setExpandedConts(new Set(gruposTabela.map((g) => g.continuidade)));
                setExpandedRefs(new Set(gruposTabela.flatMap((g) => g.referencias.map((r) => `${g.continuidade}__${r.referencia}`))));
              }}
            >
              Expandir Todos
            </button>
            <button
              type="button"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              onClick={() => {
                setExpandedConts(new Set());
                setExpandedRefs(new Set());
              }}
            >
              Recolher Todos
            </button>
          </div>

          <div className="overflow-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-[1800px] w-full text-[11px] leading-tight">
              <thead className="sticky top-0 z-20 bg-slate-100 text-slate-900">
                <tr>
                  <th className="sticky left-0 z-30 text-left px-2 py-2 whitespace-nowrap min-w-[110px] bg-slate-100 text-slate-900 shadow-[1px_0_0_0_rgba(148,163,184,0.35)]">Ref</th>
                  <th className="text-left px-2 py-2 whitespace-nowrap">Cor</th>
                  <th className="text-left px-2 py-2 whitespace-nowrap">Tam</th>
                  <th className="text-left px-2 py-2 whitespace-nowrap">Classe</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap bg-stone-200">Estoque</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap bg-stone-200">Proc.</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap bg-stone-200">Disp. Atual</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap">Ating. Jan</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap">Ating. Fev</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap">Est. Min</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap bg-indigo-100">Corte Min</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap bg-indigo-100">Disp. Anterior</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap bg-indigo-100">Proj.</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap bg-indigo-100">Plano Atual</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap bg-indigo-100">Plano Sug.</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap bg-indigo-100">Delta</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap bg-indigo-100">Disp. Pós</th>
                  <th className="text-right px-2 py-2 whitespace-nowrap bg-indigo-100">Cob. Pós</th>
                  <th className="text-left px-2 py-2 whitespace-nowrap bg-amber-100">MP</th>
                </tr>
              </thead>
              <tbody>
                {gruposTabela.map((cont) => {
                  const contOpen = expandedConts.has(cont.continuidade);
                  const contTotais = cont.referencias.flatMap((r) => r.itens).reduce((acc, r) => ({
                    estoqueAtual: acc.estoqueAtual + Number(r.estoqueAtual || 0),
                    emProcesso: acc.emProcesso + Number(r.emProcesso || 0),
                    dispAtualComProcesso: acc.dispAtualComProcesso + Number(r.dispAtualComProcesso || 0),
                    estoqueMin: acc.estoqueMin + Number(r.estoqueMin || 0),
                    corteMin: acc.corteMin + Number(r.corteMin || 0),
                    dispAnterior: acc.dispAnterior + Number(r.dispAnterior || 0),
                    projMes: acc.projMes + Number(r.projMes || 0),
                    planoAtual: acc.planoAtual + Number(r.planoAtual || 0),
                    planoSugerido: acc.planoSugerido + Number(r.planoSugerido || 0),
                    deltaPlano: acc.deltaPlano + Number(r.deltaPlano || 0),
                    dispPos: acc.dispPos + Number(r.dispPos || 0),
                  }), {
                    estoqueAtual: 0,
                    emProcesso: 0,
                    dispAtualComProcesso: 0,
                    estoqueMin: 0,
                    corteMin: 0,
                    dispAnterior: 0,
                    projMes: 0,
                    planoAtual: 0,
                    planoSugerido: 0,
                    deltaPlano: 0,
                    dispPos: 0,
                  });
                  const contCobPos = contTotais.estoqueMin > 0 ? contTotais.dispPos / contTotais.estoqueMin : 0;
                  return (
                    <Fragment key={cont.continuidade}>
                      <tr className="bg-slate-300 text-slate-900">
                        <td className="px-2 py-2 font-semibold bg-slate-300 border-t border-slate-400 whitespace-nowrap">
                          <button type="button" className="mr-2" onClick={() => setExpandedConts((prev) => {
                            const next = new Set(prev);
                            if (next.has(cont.continuidade)) next.delete(cont.continuidade); else next.add(cont.continuidade);
                            return next;
                          })}>
                            {contOpen ? '▼' : '▶'}
                          </button>
                          {cont.continuidade}
                        </td>
                        <td className="px-2 py-2 bg-slate-300 border-t border-slate-400">-</td>
                        <td className="px-2 py-2 bg-slate-300 border-t border-slate-400">-</td>
                        <td className="px-2 py-2 bg-slate-300 border-t border-slate-400">-</td>
                        <td className="px-2 py-2 text-right bg-stone-100 border-t border-slate-400">{fmt(contTotais.estoqueAtual)}</td>
                        <td className="px-2 py-2 text-right bg-stone-100 border-t border-slate-400">{fmt(contTotais.emProcesso)}</td>
                        <td className="px-2 py-2 text-right bg-stone-100 border-t border-slate-400 font-semibold">{fmt(contTotais.dispAtualComProcesso)}</td>
                        <td className="px-2 py-2 border-t border-slate-400">-</td>
                        <td className="px-2 py-2 border-t border-slate-400">-</td>
                        <td className="px-2 py-2 text-right border-t border-slate-400">{fmt(contTotais.estoqueMin)}</td>
                        <td className="px-2 py-2 text-right bg-indigo-50 border-t border-slate-400">{fmt(contTotais.corteMin)}</td>
                        <td className="px-2 py-2 text-right bg-indigo-50 border-t border-slate-400">{fmt(contTotais.dispAnterior)}</td>
                        <td className="px-2 py-2 text-right bg-indigo-50 border-t border-slate-400">{fmt(contTotais.projMes)}</td>
                        <td className="px-2 py-2 text-right bg-indigo-50 border-t border-slate-400">{fmt(contTotais.planoAtual)}</td>
                        <td className="px-2 py-2 text-right bg-indigo-50 border-t border-slate-400 font-semibold">{fmt(contTotais.planoSugerido)}</td>
                        <td className={`px-2 py-2 text-right bg-indigo-100 border-t border-slate-400 font-semibold ${contTotais.deltaPlano >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmt(contTotais.deltaPlano)}</td>
                        <td className={`px-2 py-2 text-right bg-indigo-100 border-t border-slate-400 font-semibold ${contTotais.dispPos < 0 ? 'text-red-700' : 'text-slate-800'}`}>{fmt(contTotais.dispPos)}</td>
                        <td className="px-2 py-2 text-right bg-indigo-50 border-t border-slate-400">{contCobPos.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x</td>
                        <td className="px-2 py-2 bg-amber-50 border-t border-slate-400 font-semibold text-slate-700">-</td>
                      </tr>
                      {contOpen && cont.referencias.map((refGroup) => {
                        const refKey = `${cont.continuidade}__${refGroup.referencia}`;
                        const refOpen = expandedRefs.has(refKey);
                        const refOpMinNaoAtendida = refGroup.itens.some((r) => Boolean(r.opMinNaoAtendida));
                        const refOpMinFaltante = refGroup.itens.reduce((max, r) => Math.max(max, Number(r.opMinFaltante || 0)), 0);
                        const refTotais = refGroup.itens.reduce((acc, r) => ({
                          estoqueAtual: acc.estoqueAtual + Number(r.estoqueAtual || 0),
                          emProcesso: acc.emProcesso + Number(r.emProcesso || 0),
                          dispAtualComProcesso: acc.dispAtualComProcesso + Number(r.dispAtualComProcesso || 0),
                          estoqueMin: acc.estoqueMin + Number(r.estoqueMin || 0),
                          corteMin: acc.corteMin + Number(r.corteMin || 0),
                          dispAnterior: acc.dispAnterior + Number(r.dispAnterior || 0),
                          projMes: acc.projMes + Number(r.projMes || 0),
                          planoAtual: acc.planoAtual + Number(r.planoAtual || 0),
                          planoSugerido: acc.planoSugerido + Number(r.planoSugerido || 0),
                          planoComOpMin: acc.planoComOpMin + Number(r.planoComOpMin || r.planoSugerido || 0),
                          deltaPlano: acc.deltaPlano + Number(r.deltaPlano || 0),
                          dispPos: acc.dispPos + Number(r.dispPos || 0),
                        }), {
                          estoqueAtual: 0,
                          emProcesso: 0,
                          dispAtualComProcesso: 0,
                          estoqueMin: 0,
                          corteMin: 0,
                          dispAnterior: 0,
                          projMes: 0,
                          planoAtual: 0,
                          planoSugerido: 0,
                          planoComOpMin: 0,
                          deltaPlano: 0,
                          dispPos: 0,
                        });
                        const refCobPos = refTotais.estoqueMin > 0 ? refTotais.dispPos / refTotais.estoqueMin : 0;
                        const refMpStatus = refGroup.itens.some((r) => statusViabilidadeRow(r) === 'SOLICITAR_COMPRA')
                          ? 'Solicitar compra'
                          : refGroup.itens.some((r) => statusViabilidadeRow(r) === 'BLOQUEADO')
                            ? 'Bloqueado MP'
                            : refGroup.itens.some((r) => statusViabilidadeRow(r) === 'PRODUTIVEL')
                              ? 'Produzível'
                              : 'OK';
                        return (
                          <Fragment key={refKey}>
                                <tr className={`${refOpMinNaoAtendida ? 'bg-rose-100 text-rose-950 border-rose-200' : 'bg-slate-100 text-slate-800 border-slate-200'} border-t`}>
                              <td className={`sticky left-0 z-20 px-2 py-2 shadow-[1px_0_0_0_rgba(148,163,184,0.22)] ${refOpMinNaoAtendida ? 'bg-rose-100' : 'bg-slate-100'}`}>
                                <button type="button" className="mr-2" onClick={() => setExpandedRefs((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(refKey)) next.delete(refKey); else next.add(refKey);
                                  return next;
                                })}>
                                  {refOpen ? '▼' : '▶'}
                                </button>
                                <span className="font-semibold">{refGroup.referencia}</span>
                                {refOpMinNaoAtendida && (
                                  <span className="ml-2 inline-flex items-center rounded-full bg-rose-200 px-2 py-0.5 text-[10px] font-semibold text-rose-900">
                                    OP min bloqueada · faltam {fmt(refOpMinFaltante)}
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-2">-</td>
                              <td className="px-2 py-2">-</td>
                              <td className="px-2 py-2">-</td>
                              <td className="px-2 py-2 text-right bg-stone-100">{fmt(refTotais.estoqueAtual)}</td>
                              <td className="px-2 py-2 text-right bg-stone-100">{fmt(refTotais.emProcesso)}</td>
                              <td className="px-2 py-2 text-right bg-stone-100 font-semibold">{fmt(refTotais.dispAtualComProcesso)}</td>
                              <td className="px-2 py-2 text-right">-</td>
                              <td className="px-2 py-2 text-right">-</td>
                              <td className="px-2 py-2 text-right">{fmt(refTotais.estoqueMin)}</td>
                              <td className="px-2 py-2 text-right bg-indigo-50">{fmt(refTotais.corteMin)}</td>
                              <td className="px-2 py-2 text-right bg-indigo-50">{fmt(refTotais.dispAnterior)}</td>
                              <td className="px-2 py-2 text-right bg-indigo-50">{fmt(refTotais.projMes)}</td>
                              <td className="px-2 py-2 text-right bg-indigo-50">{fmt(refTotais.planoAtual)}</td>
                              <td className="px-2 py-2 text-right bg-indigo-50 font-semibold">
                                {fmt(refTotais.planoSugerido)}
                                {refOpMinNaoAtendida && refTotais.planoComOpMin && refTotais.planoComOpMin !== refTotais.planoSugerido && (
                                  <div className="text-[9px] text-rose-600 font-normal mt-0.5">
                                    c/OP: {fmt(refTotais.planoComOpMin)}
                                  </div>
                                )}
                              </td>
                              <td className={`px-2 py-2 text-right bg-indigo-100 font-semibold ${refTotais.deltaPlano >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmt(refTotais.deltaPlano)}</td>
                              <td className={`px-2 py-2 text-right bg-indigo-100 font-semibold ${refTotais.dispPos < 0 ? 'text-red-700' : 'text-slate-800'}`}>{fmt(refTotais.dispPos)}</td>
                              <td className="px-2 py-2 text-right bg-indigo-50">{refCobPos.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x</td>
                              <td className={`px-2 py-2 bg-amber-50 font-semibold ${
                                refMpStatus === 'Solicitar compra'
                                  ? 'text-amber-700'
                                  : refMpStatus === 'Bloqueado MP'
                                    ? 'text-red-700'
                                    : 'text-emerald-700'
                              }`}>
                                {refMpStatus}
                              </td>
                            </tr>
                            {refOpen && refGroup.itens.map((r, idx) => {
                              const rowKey = `${r.chave}-${idx}`;
                              const isActive = activeRowKey === rowKey;
                              const st = statusViabilidadeRow(r);
                              const aumentoPlano = Number(r.deltaPlano || 0) > 0;
                              const opMinBloqueada = Boolean(r.opMinNaoAtendida);
                              const rowBgClass = isActive
                                ? 'bg-blue-50'
                                : opMinBloqueada
                                  ? 'bg-rose-50'
                                : aumentoPlano
                                  ? 'bg-emerald-50'
                                  : (idx % 2 === 0 ? 'bg-white' : 'bg-slate-50');
                              return (
                                <tr
                                  key={rowKey}
                                  onMouseEnter={() => setActiveRowKey(rowKey)}
                                  onClick={() => {
                                    setActiveRowKey(rowKey);
                                    abrirModalMpDaLinha(r);
                                  }}
                                  className={`${rowBgClass} border-t border-gray-200 cursor-pointer`}
                                >
                                  <td className={`sticky left-0 z-20 px-2 py-1.5 font-semibold whitespace-nowrap min-w-[110px] ${rowBgClass} shadow-[1px_0_0_0_rgba(148,163,184,0.24)]`}>{r.referencia}</td>
                                  <td className="px-2 py-1.5 whitespace-nowrap">{r.cor}</td>
                                  <td className="px-2 py-1.5 whitespace-nowrap">{r.tamanho}</td>
                                  <td className="px-2 py-1.5 whitespace-nowrap">{r.classe}</td>
                                  <td className="px-2 py-1.5 text-right bg-stone-50">{fmt(r.estoqueAtual)}</td>
                                  <td className="px-2 py-1.5 text-right bg-stone-50">{fmt(r.emProcesso)}</td>
                                  <td className="px-2 py-1.5 text-right font-semibold bg-stone-50">{fmt(r.dispAtualComProcesso)}</td>
                                  <td className="px-2 py-1.5 text-right">{r.taxaJan === null ? '-' : `${(r.taxaJan * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}</td>
                                  <td className="px-2 py-1.5 text-right">{r.taxaFev === null ? '-' : `${(r.taxaFev * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}</td>
                                  <td className="px-2 py-1.5 text-right">{fmt(r.estoqueMin)}</td>
                                  <td className="px-2 py-1.5 text-right bg-indigo-50">{fmt(r.corteMin)}</td>
                                  <td className="px-2 py-1.5 text-right bg-indigo-50">{fmt(r.dispAnterior)}</td>
                                  <td className="px-2 py-1.5 text-right bg-indigo-50">{fmt(r.projMes)}</td>
                                  <td className="px-2 py-1.5 text-right bg-indigo-50">{fmt(r.planoAtual)}</td>
                                  <td className={`px-2 py-1.5 text-right font-semibold ${
                                    opMinBloqueada
                                      ? 'text-rose-900 bg-rose-100/80'
                                      : aumentoPlano
                                        ? 'text-emerald-800 bg-emerald-100/70'
                                        : 'text-brand-dark bg-indigo-50'
                                  }`}>
                                    {fmt(r.planoSugerido)}
                                    {opMinBloqueada && r.planoComOpMin && r.planoComOpMin !== r.planoSugerido && (
                                      <div className="text-[9px] text-rose-600 font-normal mt-0.5">
                                        c/OP: {fmt(r.planoComOpMin)}
                                      </div>
                                    )}
                                  </td>
                                  <td className={`px-2 py-1.5 text-right font-semibold bg-indigo-50 ${r.deltaPlano >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmt(r.deltaPlano)}</td>
                                  <td className={`px-2 py-1.5 text-right font-semibold bg-indigo-50 ${r.dispPos < 0 ? 'text-red-700' : 'text-gray-800'}`}>{fmt(r.dispPos)}</td>
                                  <td className="px-2 py-1.5 text-right bg-indigo-50">{r.coberturaPos.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x</td>
                                  <td className={`px-2 py-1.5 whitespace-nowrap font-semibold bg-amber-50 ${st === 'PRODUTIVEL' || st === 'OK' ? 'text-emerald-700' : st === 'BLOQUEADO' ? 'text-red-700' : st === 'SOLICITAR_COMPRA' ? 'text-amber-700' : 'text-gray-500'}`}>
                                    {st === 'PRODUTIVEL' ? 'Produzível' : st === 'BLOQUEADO' ? 'Bloqueado MP' : st === 'SOLICITAR_COMPRA' ? 'Solicitar compra' : st === 'OK' ? 'OK' : '-'}
                                  </td>
                                </tr>
                              );
                            })}
                          </Fragment>
                        );
                      })}
                    </Fragment>
                  );
                })}
                {gruposTabela.length === 0 && (
                  <tr>
                    <td colSpan={19} className="px-3 py-8 text-center text-gray-500">Sem dados para exibir.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </div>
  );
}
