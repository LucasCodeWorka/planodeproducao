'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import MatrizPlanejamentoTable, { type GrupoTotais } from './components/MatrizPlanejamentoTable';
import Sidebar from './components/Sidebar';
import { Planejamento, ProjecoesMap, PeriodosPlano, EstoqueLojaDisponivelAggregado } from './types';
import { getToken, authHeaders, clearToken } from './lib/auth';
import { fetchNoCache } from './lib/api';
import { projecaoMesPlanejamento } from './lib/projecao';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MARCA_FIXA = 'LIEBE';
const STATUS_FIXO = 'EM LINHA,NOVA COLECAO';
const CENARIO_STORAGE_KEY = 'pp_cenario_projecao';
const CENARIO_MODO_STORAGE_KEY = 'pp_cenario_modo';
const APROVADAS_LIMIT = 10;
const DIAS_RECUPERAR_NEGATIVOS = new Set([1, 10, 20]);
const PARAM_SIMULAR_DIA_ROTINA = 'simularDiaRotina';
const PERIODOS_RECUPERAR_NEGATIVOS = ['MA', 'PX', 'UL', 'QT', 'QU', 'SX'] as const;
const MESES_PT = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dataLocalInputValue(date: Date) {
  const ano = date.getFullYear();
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  const dia = String(date.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function defaultDataDe() {
  const date = new Date();
  date.setDate(date.getDate() - 10);
  return dateInputValue(date);
}

function isSimulandoDiaRotina() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get(PARAM_SIMULAR_DIA_ROTINA) === '1';
}

function inicioCicloRecuperarNegativos(date = new Date()) {
  const dia = date.getDate();
  const inicio = new Date(date);
  if (dia >= 20) inicio.setDate(20);
  else if (dia >= 10) inicio.setDate(10);
  else inicio.setDate(1);
  return inicio;
}

function fimCicloRecuperarNegativos(date = new Date()) {
  const dia = date.getDate();
  const fim = new Date(date);
  if (dia >= 20) fim.setMonth(fim.getMonth() + 1, 0);
  else if (dia >= 10) fim.setDate(19);
  else fim.setDate(9);
  return fim;
}

function proximaRotinaRecuperarNegativos(date = new Date()) {
  const dia = date.getDate();
  const proxima = new Date(date);
  if (dia < 10) proxima.setDate(10);
  else if (dia < 20) proxima.setDate(20);
  else proxima.setMonth(proxima.getMonth() + 1, 1);
  return proxima;
}

function formatDateBR(date: Date) {
  return date.toLocaleDateString('pt-BR');
}

function fmt(value: number) {
  return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function taxaMesesFechados(base = new Date()) {
  return [3, 2, 1].map((voltar) => {
    const date = new Date(base.getFullYear(), base.getMonth() - voltar, 1);
    const mes = date.getMonth() + 1;
    return { mes, ano: date.getFullYear(), label: MESES_PT[mes] };
  }) as [{ mes: number; ano: number; label: string }, { mes: number; ano: number; label: string }, { mes: number; ano: number; label: string }];
}

type SerieMes = { mes: string; total: number; top30: number; demais: number; kissme: number };
type PeriodoRecuperarNegativos = typeof PERIODOS_RECUPERAR_NEGATIVOS[number];

function clampPct(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function normalizaRef(ref: string) {
  return String(ref || '').trim().toUpperCase();
}

interface CacheStatus {
  exists:     boolean;
  fresh:      boolean;
  updatedAt?: string;
  ageHours?:  number;
  count?:     number;
}

type PlanoSnapshotItem = { chave: string; ma: number; px: number; ul: number; qt?: number; qu?: number; sx?: number };
type AnaliseAprovada = {
  id: string;
  createdAt: number;
  parametros?: {
    tipo?: string;
    statusAprovacao?: 'PENDENTE' | 'APROVADA';
    planos?: PlanoSnapshotItem[];
  };
};

type RotinaNegativosInfo = {
  inicio: string;
  fim: string;
  proxima: string;
  simulando: boolean;
};

type PreviaNegativoPeriodo = {
  periodo: PeriodoRecuperarNegativos;
  skus: number;
  pecas: number;
};

type ReprojecaoPreview = {
  idproduto: string;
  recalculada: { ma: number; px: number; ul: number; qt?: number; qu?: number; sx?: number };
};

type ExecucaoPlanoItem = {
  qtdReal: number;
  qtdFinalizada: number;
  percentual: number | null;
};

type RiscoMpMes = {
  em_risco: boolean;
  quantidade_mps: number;
  principal_mp: null | {
    idmateriaprima: string;
    nome: string;
    artigo: string;
    saldo: number;
    falta: number;
  };
};

type RiscoMpDetalhePorSku = Record<string, {
  ma: RiscoMpMes;
  px: RiscoMpMes;
  ul: RiscoMpMes;
  qt: RiscoMpMes;
  qu: RiscoMpMes;
  sx: RiscoMpMes;
}>;

type ExecucaoPlanoResumo = {
  geral: {
    MA: ExecucaoPlanoItem | null;
    PX: ExecucaoPlanoItem | null;
    UL: ExecucaoPlanoItem | null;
    QT: ExecucaoPlanoItem | null;
    QU: ExecucaoPlanoItem | null;
    SX: ExecucaoPlanoItem | null;
  };
  continuidade: Record<string, {
    MA: ExecucaoPlanoItem | null;
    PX: ExecucaoPlanoItem | null;
    UL: ExecucaoPlanoItem | null;
    QT: ExecucaoPlanoItem | null;
    QU: ExecucaoPlanoItem | null;
    SX: ExecucaoPlanoItem | null;
  }>;
};

type HistoricoMinimoFechamento = { ano: number; mes: number; label: string; minimo: number; mediaTri: number };
type HistoricoMinimoRow = { sku: string; fechamentos: HistoricoMinimoFechamento[] };

function mesNormalizado(mes: number) {
  const m = Number(mes || 0);
  if (!Number.isFinite(m) || m <= 0) return 1;
  return ((m - 1) % 12) + 1;
}

function nomeMesCurto(mes: number) {
  return new Date(2000, mesNormalizado(mes) - 1, 1).toLocaleString('pt-BR', { month: 'short' });
}

function formatPct(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}


function chaveItem(item: Planejamento) {
  const id = Number(item.produto.idproduto);
  if (Number.isFinite(id)) return `ID-${id}`;
  return `REF-${item.produto.referencia || ''}-${item.produto.cor || ''}-${item.produto.tamanho || ''}`;
}

export default function Home() {
  const router = useRouter();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dados,        setDados]        = useState<Planejamento[]>([]);
  const [historicoMinimo, setHistoricoMinimo] = useState<HistoricoMinimoRow[]>([]);
  const [fechamentosMinimo, setFechamentosMinimo] = useState<Array<{ ano: number; mes: number; label: string }>>([]);
  const [historicoMinimoStatus, setHistoricoMinimoStatus] = useState<'idle' | 'carregando' | 'ok' | 'erro'>('idle');
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [fromCache,    setFromCache]    = useState(false);
  const [cacheStatus,  setCacheStatus]  = useState<CacheStatus | null>(null);
  const [refreshing,   setRefreshing]   = useState(false);
  const [refreshMsg,   setRefreshMsg]   = useState<string | null>(null);
  const [building,     setBuilding]     = useState(false);
  const [buildElapsed, setBuildElapsed] = useState(0);
  const [apenasNegativos, setApenasNegativos] = useState(false);
  const [filtroNegativoPeriodo, setFiltroNegativoPeriodo] = useState<'TODOS' | 'ATUAL' | 'MA' | 'PX' | 'UL' | 'QT' | 'QU' | 'SX'>('TODOS');
  const [filtroNaoPrecisaProduzir, setFiltroNaoPrecisaProduzir] = useState(false);
  const [filtroSomenteComPlano, setFiltroSomenteComPlano] = useState(true);
  const [filtroContinuidade, setFiltroContinuidade] = useState<string[]>([]);
  const [filtroSuspensos, setFiltroSuspensos] = useState<'INCLUIR' | 'EXCLUIR'>('INCLUIR');
  const [filtroReferencia, setFiltroReferencia] = useState('');
  const [filtroCor, setFiltroCor] = useState('TODAS');
  const [filtroCobertura, setFiltroCobertura] = useState<'TODAS' | 'NEGATIVA' | 'ZERO_UM' | 'MAIOR_UM' | 'MAIOR_2'>('TODAS');
  const [filtroCoberturaBase, setFiltroCoberturaBase] = useState<'ATUAL' | 'MA' | 'PX' | 'UL' | 'QT' | 'QU' | 'SX'>('ATUAL');
  const [filtroTaxa, setFiltroTaxa] = useState<'TODAS' | 'ATE_70'>('TODAS');
  const [filtroCoberturaMinima, setFiltroCoberturaMinima] = useState<string>('');
  const [filtroEmProcessoMinimo, setFiltroEmProcessoMinimo] = useState<string>('');
  // gap de dias acumulado por mês, na mesma regra da tela de Capacidade
  const [gapPorPeriodo, setGapPorPeriodo] = useState<Record<string, number>>({});
  // totais por continuidade que a matriz calcula, espelhados no quadro do topo
  const [totaisContinuidade, setTotaisContinuidade] = useState<{ continuidade: string; totais: GrupoTotais }[]>([]);
  // cobertura configurada por curva (mesma config que a Sugestão de Plano usa), só para consulta
  const [cfgCurvas, setCfgCurvas] = useState({
    cobertura_min_a: 0.5, cobertura_max_a: 1.0,
    cobertura_min_b: 1.0, cobertura_max_b: 2.0,
    cobertura_min_c: 1.0, cobertura_max_c: 2.5,
    cobertura_min_d: 1.0, cobertura_max_d: 3.0,
  });
  const [projecoes,    setProjecoes]    = useState<ProjecoesMap>({});
  const [cenarioProjecao, setCenarioProjecao] = useState<'sistema' | 'cairo' | 'envelope'>('sistema');
  const [modoCenario, setModoCenario] = useState<'reducao' | 'aumento' | 'completo'>('reducao');
  const [cenarioInfo, setCenarioInfo] = useState<{
    nome: string;
    detalhe: string;
    totalizadores: Record<string, number>;
    modo?: 'reducao' | 'aumento' | 'completo';
    resumo?: {
      skusAlterados: number;
      pecasReduzidas: number;
      pecasAumentadas: number;
      skusComReducao: number;
      pecasDeReducao: number;
      skusComAumento: number;
      pecasDeAumento: number;
    };
  } | null>(null);
  const [carregandoCenario, setCarregandoCenario] = useState(false);
  const [cortesMinimos, setCortesMinimos] = useState<Record<string, number>>({});
  const [loadingCortesMinimos, setLoadingCortesMinimos] = useState(true);
  const [erroCortesMinimos, setErroCortesMinimos] = useState(false);
  const [vendasReais,  setVendasReais]  = useState<Record<string, Record<string, number>>>({});
  const [top30Ids,     setTop30Ids]     = useState<Set<string>>(new Set());
  const [top30Refs,    setTop30Refs]    = useState<Set<string>>(new Set());
  const [periodos,     setPeriodos]     = useState<PeriodosPlano>({ MA: new Date().getMonth() + 1, PX: new Date().getMonth() + 2, UL: new Date().getMonth() + 3, QT: new Date().getMonth() + 4, QU: new Date().getMonth() + 5 });
  const [aplicarAprovadas, setAplicarAprovadas] = useState(false);
  const [aprovadas, setAprovadas] = useState<AnaliseAprovada[]>([]);
  const [aprovadasSelecionadasIds, setAprovadasSelecionadasIds] = useState<string[]>([]);
  const [abrirSeletorAprovadas, setAbrirSeletorAprovadas] = useState(false);
  const [abrirSeletorContinuidade, setAbrirSeletorContinuidade] = useState(false);
  const [filtroLinha, setFiltroLinha] = useState<string[]>([]);
  const [filtroFamilia, setFiltroFamilia] = useState<string[]>([]);
  const [abrirSeletorLinha, setAbrirSeletorLinha] = useState(false);
  const [abrirSeletorFamilia, setAbrirSeletorFamilia] = useState(false);
  const [considerarProjecaoNova, setConsiderarProjecaoNova] = useState(false);
  const [reprojecaoPreview, setReprojecaoPreview] = useState<ReprojecaoPreview[]>([]);
  const [recalculandoProjecao, setRecalculandoProjecao] = useState(false);
  const [resultadoReprojecaoMsg, setResultadoReprojecaoMsg] = useState<string | null>(null);
  const [usarEstoqueLojas, setUsarEstoqueLojas] = useState(false);
  const [estoqueLojasDisponivel, setEstoqueLojasDisponivel] = useState<Map<number, EstoqueLojaDisponivelAggregado>>(new Map());
  const [carregandoEstoqueLojas, setCarregandoEstoqueLojas] = useState(false);
  const [curvaABC, setCurvaABC] = useState<Record<string, 'A' | 'B' | 'C' | 'D'>>({});
  const [filtroCurvaABC, setFiltroCurvaABC] = useState<('A' | 'B' | 'C' | 'D')[]>([]);
  const [referenciasDeParaSet, setReferenciasDeParaSet] = useState<Set<string>>(new Set());
  const [idsDeParaSet, setIdsDeParaSet] = useState<Set<string>>(new Set());
  const [execucaoPlanoResumo, setExecucaoPlanoResumo] = useState<ExecucaoPlanoResumo | null>(null);
  const [riscoMpPorSku, setRiscoMpPorSku] = useState<Record<string, { ma: boolean; px: boolean; ul: boolean; qt: boolean; qu: boolean; sx: boolean }>>({});
  const [detalheRiscoMpPorSku, setDetalheRiscoMpPorSku] = useState<RiscoMpDetalhePorSku>({});
  const [loadingRiscoMp, setLoadingRiscoMp] = useState(false);
  const [indicadoresLocais, setIndicadoresLocais] = useState<{
    oficinas: { nome: string; pior_dias: number; media_dias: number }[];
    outrosLocais: { nome: string; pior_dias: number; media_dias: number }[];
  }>({ oficinas: [], outrosLocais: [] });
  const [mostrarModalNegativos, setMostrarModalNegativos] = useState(false);
  const [rotinaNegativosInfo, setRotinaNegativosInfo] = useState<RotinaNegativosInfo | null>(null);
  const taxaMeses = useMemo(() => taxaMesesFechados(), []);
  const taxaFiltroLabel = useMemo(() => taxaMeses.map((m) => m.label.charAt(0).toUpperCase() + m.label.slice(1)).join('/'), [taxaMeses]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reprojecaoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    // Cairo/só reduções virou a projeção oficial, gravada em app_projecoes:
    // a tela lê direto do banco, sem cenário por cima.
    try {
      localStorage.removeItem(CENARIO_STORAGE_KEY);
      localStorage.removeItem(CENARIO_MODO_STORAGE_KEY);
    } catch { /* navegador sem storage: nada a limpar */ }

    verificarRotinaRecuperarNegativos();
    buscarDados();
    buscarStatusCache();
    buscarProjecoes('sistema', 'reducao').finally(() => setCarregandoCenario(false));
    buscarCortesMinimos();
    buscarCfgCurvas();
    buscarGapMensal();
    buscarReprojecaoFechada();
    buscarTop30();
    buscarAprovadas();
    buscarCurvaABC();
    buscarReferenciasDePara();
    buscarIndicadoresOutrosLocais();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verificarRotinaRecuperarNegativos() {
    try {
      const hoje = new Date();
      const simulandoDiaRotina = isSimulandoDiaRotina();
      const ciclo = inicioCicloRecuperarNegativos(hoje);
      const fimCiclo = fimCicloRecuperarNegativos(hoje);
      setRotinaNegativosInfo({
        inicio: formatDateBR(ciclo),
        fim: formatDateBR(fimCiclo),
        proxima: formatDateBR(proximaRotinaRecuperarNegativos(hoje)),
        simulando: simulandoDiaRotina,
      });
      const params = new URLSearchParams({
        tipo: 'SUGESTAO_PLANO',
        origem: 'RECUPERAR_NEGATIVOS',
        de: dataLocalInputValue(ciclo),
        ate: dataLocalInputValue(hoje),
        limit: '50',
      });
      const res = await fetchNoCache(`${API_URL}/api/simulacoes?${params}`, { headers: authHeaders() });
      const data = await res.json();
      const jaSalvouRotina = res.ok && Array.isArray(data?.data) && data.data.some((item: AnaliseAprovada & { parametros?: { origem?: string } }) => {
        return String(item?.parametros?.origem || '').trim().toUpperCase() === 'RECUPERAR_NEGATIVOS';
      });
      setMostrarModalNegativos(simulandoDiaRotina || !jaSalvouRotina);
    } catch {
      setMostrarModalNegativos(true);
    }
  }

  function verRecuperarNegativosMaisTarde() {
    setMostrarModalNegativos(false);
  }

  async function buscarIndicadoresOutrosLocais() {
    try {
      const desde = new Date();
      desde.setDate(1);
      const desdeStr = desde.toISOString().split('T')[0];
      const res = await fetchNoCache(`${API_URL}/api/indicadores-op/outros-locais?desde=${desdeStr}`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setIndicadoresLocais({
        oficinas: Array.isArray(data.oficinas) ? data.oficinas.slice(0, 1) : [],
        outrosLocais: Array.isArray(data.outrosLocais) ? data.outrosLocais.slice(0, 1) : [],
      });
    } catch { /* silencioso */ }
  }

  async function buscarStatusCache() {
    try {
      const res = await fetchNoCache(`${API_URL}/api/admin/status`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) setCacheStatus(data.cache);
    } catch { /* silencioso */ }
  }

  async function buscarProjecoes(cenario: string = 'sistema', modo: string = 'reducao') {
    try {
      const query = cenario && cenario !== 'sistema'
        ? `?cenario=${encodeURIComponent(cenario)}&modo=${encodeURIComponent(modo)}`
        : '';
      const res  = await fetchNoCache(`${API_URL}/api/projecoes${query}`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setProjecoes(data.data as ProjecoesMap);
        setCenarioInfo(data.cenario || null);
        if (data.periodos) setPeriodos(data.periodos as PeriodosPlano);
      }
    } catch { /* silencioso */ }
  }

  // Troca a projeção que alimenta o plano. Nada é gravado: o cenário vive só na resposta.
  async function aplicarCenarioNaTela(
    cenario: 'sistema' | 'cairo' | 'envelope',
    modo: 'reducao' | 'aumento' | 'completo'
  ) {
    if (carregandoCenario) return;
    setCenarioProjecao(cenario);
    setModoCenario(modo);
    try {
      localStorage.setItem(CENARIO_STORAGE_KEY, cenario);
      localStorage.setItem(CENARIO_MODO_STORAGE_KEY, modo);
    } catch { /* navegador sem storage: a escolha vale só nesta sessão */ }
    setCarregandoCenario(true);
    try {
      await buscarProjecoes(cenario, modo);
    } finally {
      setCarregandoCenario(false);
    }
  }

  function trocarCenarioProjecao(cenario: 'sistema' | 'cairo' | 'envelope') {
    if (cenario === cenarioProjecao) return;
    void aplicarCenarioNaTela(cenario, modoCenario);
  }

  function trocarModoCenario(modo: 'reducao' | 'aumento' | 'completo') {
    if (modo === modoCenario) return;
    void aplicarCenarioNaTela(cenarioProjecao, modo);
  }

  function textoResumoCenario(info: NonNullable<typeof cenarioInfo>) {
    const r = info.resumo;
    const fmtPecas = (n: number) => Math.round(n || 0).toLocaleString('pt-BR');
    if (!r) return `Simulando ${info.nome}. Nada gravado.`;
    if (info.modo === 'reducao') {
      const fora = r.pecasDeAumento > 0
        ? ` ${fmtPecas(r.pecasDeAumento)} peças de aumento ficaram de fora, em ${r.skusComAumento} SKUs.`
        : '';
      return `${info.nome}, só reduções: −${fmtPecas(r.pecasReduzidas)} peças em ${r.skusAlterados} SKUs.${fora} Nada gravado.`;
    }
    if (info.modo === 'aumento') {
      return `${info.nome}, só aumentos: +${fmtPecas(r.pecasAumentadas)} peças em ${r.skusAlterados} SKUs. Nada gravado.`;
    }
    return `${info.nome}, completo: −${fmtPecas(r.pecasReduzidas)} e +${fmtPecas(r.pecasAumentadas)} peças em ${r.skusAlterados} SKUs. Nada gravado.`;
  }

  async function buscarCortesMinimos() {
    setLoadingCortesMinimos(true);
    setErroCortesMinimos(false);
    try {
      const res = await fetchNoCache(`${API_URL}/api/configuracoes/corte-minimos`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const data = await res.json();
      const mapa: Record<string, number> = {};
      for (const item of Array.isArray(data?.data) ? data.data : []) {
        const id = String(item?.idproduto || '').trim();
        if (id) mapa[id] = Number(item?.corte_min || 0);
      }
      setCortesMinimos(mapa);
    } catch {
      setCortesMinimos({});
      setErroCortesMinimos(true);
    } finally {
      setLoadingCortesMinimos(false);
    }
  }

  async function buscarCurvaABC() {
    try {
      const res = await fetchNoCache(`${API_URL}/api/analises/curva-abc-referencias`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.porReferencia) {
        setCurvaABC(data.porReferencia as Record<string, 'A' | 'B' | 'C' | 'D'>);
      }
    } catch { /* silencioso */ }
  }

  async function buscarGapMensal() {
    try {
      const res = await fetchNoCache(`${API_URL}/api/capacidade/gap-mensal`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.success || !Array.isArray(data.meses)) return;
      const mapa: Record<string, number> = {};
      for (const m of data.meses) {
        const periodo = String(m?.periodo || '');
        if (periodo) mapa[periodo] = Number(m?.gap || 0);
      }
      setGapPorPeriodo(mapa);
    } catch { /* silencioso: sem gap o card só não mostra o indicador */ }
  }

  async function buscarCfgCurvas() {
    try {
      const res = await fetchNoCache(`${API_URL}/api/configuracoes/sugestao-plano`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const c = data?.data;
      if (!c) return;
      setCfgCurvas((prev) => ({
        cobertura_min_a: Number(c.cobertura_min_a ?? prev.cobertura_min_a),
        cobertura_max_a: Number(c.cobertura_max_a ?? prev.cobertura_max_a),
        cobertura_min_b: Number(c.cobertura_min_b ?? prev.cobertura_min_b),
        cobertura_max_b: Number(c.cobertura_max_b ?? prev.cobertura_max_b),
        cobertura_min_c: Number(c.cobertura_min_c ?? prev.cobertura_min_c),
        cobertura_max_c: Number(c.cobertura_max_c ?? prev.cobertura_max_c),
        cobertura_min_d: Number(c.cobertura_min_d ?? prev.cobertura_min_d),
        cobertura_max_d: Number(c.cobertura_max_d ?? prev.cobertura_max_d),
      }));
    } catch { /* silencioso: mantem os valores padrao */ }
  }

  async function buscarTop30() {
    try {
      const res = await fetchNoCache(`${API_URL}/api/analises/top30-produtos`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setTop30Ids(new Set(((data && data.ids) || []).map((v: string) => String(v))));
      setTop30Refs(new Set(((data && data.referencias) || []).map((v: string) => normalizaRef(v))));
    } catch { /* silencioso */ }
  }

  async function buscarReprojecaoFechada() {
    try {
      const res = await fetchNoCache(`${API_URL}/api/projecoes/reprojecao-fechada`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setReprojecaoPreview(Array.isArray(data.sugestoes) ? data.sugestoes : []);
      }
    } catch {
      setReprojecaoPreview([]);
    }
  }

  async function buscarReferenciasDePara() {
    try {
      const res = await fetchNoCache(`${API_URL}/api/projecoes/de-para`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.referencias)) {
        setReferenciasDeParaSet(new Set(data.referencias.map((r: string) => String(r).trim().toUpperCase())));
      }
      if (data.success && Array.isArray(data.idprodutos_ocultar)) {
        setIdsDeParaSet(new Set(data.idprodutos_ocultar.map((id: string | number) => String(id).trim())));
      }
    } catch { /* silencioso */ }
  }

  async function buscarAprovadas() {
    try {
      console.log('[buscarAprovadas] Iniciando fetch...');
      const params = new URLSearchParams({
        tipo: 'SUGESTAO_PLANO,LAB_SUGESTAO_RETIRADA',
        statusAprovacao: 'APROVADA',
        limit: String(APROVADAS_LIMIT),
        de: defaultDataDe(),
        ate: dateInputValue(new Date()),
      });
      const res = await fetchNoCache(`${API_URL}/api/simulacoes?${params}`, { headers: authHeaders() });
      console.log('[buscarAprovadas] Resposta:', res.status, res.ok);
      if (!res.ok) {
        console.error('[buscarAprovadas] Resposta não OK:', res.status);
        return;
      }
      const data = await res.json();
      console.log('[buscarAprovadas] Total recebido:', data?.data?.length || 0);
      const lista = (Array.isArray(data?.data) ? data.data : []) as AnaliseAprovada[];
      const aprov = lista.filter((a) => Array.isArray(a?.parametros?.planos));
      console.log('[buscarAprovadas] Aprovadas com planos:', aprov.length);
      setAprovadas(aprov);
      setAprovadasSelecionadasIds((prev) => {
        if (!prev.length) return aprov.map((a) => a.id);
        const validos = prev.filter((id) => aprov.some((a) => a.id === id));
        return validos.length ? validos : aprov.map((a) => a.id);
      });
    } catch (err) {
      console.error('[buscarAprovadas] Erro:', err);
      setAprovadas([]);
      setAprovadasSelecionadasIds([]);
    }
  }

  async function buscarEstoqueLojasDisponivel() {
    if (carregandoEstoqueLojas || estoqueLojasDisponivel.size > 0) return;
    setCarregandoEstoqueLojas(true);
    try {
      const res = await fetchNoCache(
        `${API_URL}/api/estoque-lojas/disponivel-total?lojaDestino=1&incluirDetalhes=false`,
        { headers: authHeaders() }
      );
      if (!res.ok) throw new Error('Erro ao buscar estoque disponível das lojas');
      const data = await res.json();
      const map = new Map<number, EstoqueLojaDisponivelAggregado>();
      if (Array.isArray(data?.data)) {
        for (const item of data.data) {
          map.set(Number(item.cd_produto), item as EstoqueLojaDisponivelAggregado);
        }
      }
      setEstoqueLojasDisponivel(map);
    } catch (e) {
      console.error('[buscarEstoqueLojasDisponivel]', e);
      setEstoqueLojasDisponivel(new Map());
    } finally {
      setCarregandoEstoqueLojas(false);
    }
  }

  useEffect(() => {
    if (usarEstoqueLojas) {
      buscarEstoqueLojasDisponivel();
    }
  }, [usarEstoqueLojas]);

  async function carregarVendasReais(ids: number[]) {
    if (!ids.length) {
      setVendasReais({});
      return;
    }
    try {
      const anos = Array.from(new Set(taxaMeses.map((m) => m.ano)));
      const respostas = await Promise.all(anos.map(async (ano) => {
        const rReal = await fetchNoCache(`${API_URL}/api/analises/projecao-vs-venda`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ ano, ids }),
        });
        if (!rReal.ok) throw new Error(`Vendas reais erro ${rReal.status}`);
        return rReal.json();
      }));
      const merged: Record<string, Record<string, number>> = {};
      for (const payload of respostas) {
        const data = (payload && payload.data) || {};
        for (const [id, meses] of Object.entries(data)) {
          merged[id] = { ...(merged[id] || {}), ...(meses as Record<string, number>) };
        }
      }
      setVendasReais(merged);
    } catch {
      setVendasReais({});
    }
  }

  async function carregarHistoricoMinimo(ids: number[]) {
    if (!ids.length) return;
    setHistoricoMinimoStatus('carregando');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180000);
      const r = await fetchNoCache(`${API_URL}/api/producao/estoque-minimo-fechamentos?marca=${MARCA_FIXA}&status=${encodeURIComponent(STATUS_FIXO)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ids: ids.map(String) }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!r.ok) throw new Error(`Historico ${r.status}`);
      const payload = await r.json();
      if (payload?.success) {
        setHistoricoMinimo(Array.isArray(payload.data) ? payload.data : []);
        setFechamentosMinimo(Array.isArray(payload.fechamentos) ? payload.fechamentos : []);
        setHistoricoMinimoStatus(Array.isArray(payload.data) && payload.data.length ? 'ok' : 'erro');
      } else setHistoricoMinimoStatus('erro');
    } catch {
      setHistoricoMinimoStatus('erro');
      // A matriz principal continua disponivel se o historico nao responder.
    }
  }

  const buscarDados = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: '5000',
        marca: MARCA_FIXA,
        status: STATUS_FIXO,
        prefer_cache: 'true'
      });
      const res    = await fetchNoCache(`${API_URL}/api/producao/matriz?${params}`);
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const payload = await res.json();
      if (!payload.success) throw new Error(payload.error || 'Erro no servidor');
      const rows = payload.data as Planejamento[];
      setDados(rows);
      setExecucaoPlanoResumo((payload.execucaoPlanoResumo || null) as ExecucaoPlanoResumo | null);
      const ids = rows
        .map((i) => Number(i.produto.idproduto))
        .filter((n) => Number.isFinite(n))
        .slice(0, 2500);
      carregarVendasReais(ids);
      setFromCache(payload.fromCache ?? false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dados');
      setExecucaoPlanoResumo(null);
    } finally {
      setLoading(false);
    }
  }, [taxaMeses]);

  useEffect(() => {
    // O historico mensal sera reativado por cache consolidado; nao consultar a view pesada na abertura.
    return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados]);

  useEffect(() => {
    if (!building) return;
    const startedAt = Date.now();
    pollRef.current = setInterval(async () => {
      setBuildElapsed(Math.round((Date.now() - startedAt) / 1000));
      try {
        const res  = await fetchNoCache(`${API_URL}/api/admin/build-status`, { headers: authHeaders() });
        if (res.status === 401) {
          clearToken();
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          setBuilding(false);
          setRefreshing(false);
          setRefreshMsg(null);
          setError('Sessao expirada. Faca login novamente.');
          router.replace('/login');
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (!data.buildState.running) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setBuilding(false);
          setRefreshing(false);
          if (data.buildState.error) {
            setRefreshMsg(null);
            setError(`Erro ao atualizar: ${data.buildState.error}`);
          } else {
            const mins = (data.buildState.durationMs / 1000 / 60).toFixed(1);
            setRefreshMsg(`Cache atualizado — ${data.buildState.count} produtos em ${mins} min`);
            if (data.cache) setCacheStatus(data.cache);
            await buscarDados();
          }
        }
      } catch { /* silencioso */ }
    }, 3000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [building, buscarDados]);

  useEffect(() => {
    return () => {
      if (reprojecaoTimeoutRef.current) clearTimeout(reprojecaoTimeoutRef.current);
    };
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    setBuilding(false);
    setBuildElapsed(0);
    setRefreshMsg('Iniciando atualização em background...');
    setError(null);
    try {
      const res  = await fetchNoCache(`${API_URL}/api/admin/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ marca: MARCA_FIXA, status: STATUS_FIXO }),
      });
      if (res.status === 401) {
        setRefreshing(false);
        setRefreshMsg(null);
        clearToken();
        setError('Sessao expirada. Faca login novamente.');
        router.replace('/login');
        return;
      }
      const data = await res.json();
      if (!res.ok || !data.success) {
        setRefreshing(false); setRefreshMsg(null);
        setError(data.error || 'Erro ao iniciar atualização');
        return;
      }
      setRefreshMsg(data.alreadyRunning ? 'Atualização já em andamento...' : 'Atualizando dados...');
      setBuilding(true);
      setBuildElapsed(0);
    } catch (err) {
      setRefreshing(false); setRefreshMsg(null);
      setError(err instanceof Error ? err.message : 'Erro ao iniciar atualização');
    }
  }

  const planosAprovadosMap = useMemo(() => {
    const map = new Map<string, { ma: number; px: number; ul: number; qt: number; qu: number; sx: number }>();
    const base = aprovadas.filter((a) => aprovadasSelecionadasIds.includes(a.id));
    const ordenadas = [...base].sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    for (const a of ordenadas) {
      const planos = Array.isArray(a?.parametros?.planos) ? a.parametros!.planos! : [];
      for (const p of planos) {
        const k = String(p?.chave || '').trim();
        if (!k) continue;
        map.set(k, {
          ma: Number(p?.ma || 0),
          px: Number(p?.px || 0),
          ul: Number(p?.ul || 0),
          qt: Number(p?.qt || 0),
          qu: Number(p?.qu || 0),
          sx: Number(p?.sx || 0),
        });
      }
    }
    return map;
  }, [aprovadas, aprovadasSelecionadasIds]);

  const dadosAtivos = useMemo(() => {
    if (!aplicarAprovadas || planosAprovadosMap.size === 0) return dados;
    return dados.map((i) => {
      const k = chaveItem(i);
      const p = planosAprovadosMap.get(k);
      if (!p) return i;
      return {
        ...i,
        plano: {
          ...(i.plano || {}),
          ma: p.ma,
          px: p.px,
          ul: p.ul,
          qt: p.qt,
          qu: p.qu,
          sx: p.sx,
        },
      };
    });
  }, [dados, aplicarAprovadas, planosAprovadosMap]);

  useEffect(() => {
    let active = true;
    async function carregarRiscoMp() {
      if (!dadosAtivos.length) {
        if (active) setLoadingRiscoMp(false);
        if (active) setRiscoMpPorSku({});
        if (active) setDetalheRiscoMpPorSku({});
        return;
      }
      try {
        if (active) setLoadingRiscoMp(true);
        const planos = dadosAtivos.map((d) => ({
          idproduto: String(d.produto.idproduto || ''),
          idreferencia: d.produto.referencia || '',
          ma: d.plano?.ma || 0,
          px: d.plano?.px || 0,
          ul: d.plano?.ul || 0,
          qt: d.plano?.qt || 0,
          qu: d.plano?.qu || 0,
          sx: d.plano?.sx || 0,
        }));
        const res = await fetchNoCache(`${API_URL}/api/consumo-mp/check-risco-lote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planos }),
        });
        const json = await res.json();
        if (!active) return;
        if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao carregar risco de MP');
        setRiscoMpPorSku((json.risco_por_sku || {}) as Record<string, { ma: boolean; px: boolean; ul: boolean; qt: boolean; qu: boolean; sx: boolean }>);
        setDetalheRiscoMpPorSku((json.detalhe_risco_por_sku || {}) as RiscoMpDetalhePorSku);
      } catch {
        if (active) setRiscoMpPorSku({});
        if (active) setDetalheRiscoMpPorSku({});
      } finally {
        if (active) setLoadingRiscoMp(false);
      }
    }
    carregarRiscoMp();
    return () => { active = false; };
  }, [dadosAtivos]);

  const dadosAtivosComEstoqueLojas = useMemo(() => {
    if (!usarEstoqueLojas || estoqueLojasDisponivel.size === 0) return dadosAtivos;
    return dadosAtivos.map((item) => {
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
  }, [dadosAtivos, usarEstoqueLojas, estoqueLojasDisponivel]);

  const dadosPagina = useMemo(() => {
    let base = dadosAtivosComEstoqueLojas;

    if (filtroSuspensos === 'EXCLUIR') {
      base = base.filter((i) => String(i.produto.cod_situacao || '').trim() !== '007');
    }

    if (filtroContinuidade.length > 0) {
      const selecionadas = new Set(filtroContinuidade.map((v) => String(v || '').trim()));
      base = base.filter((i) => selecionadas.has((i.produto.continuidade || '').trim()));
    }

    if (filtroLinha.length > 0) {
      const selecionadas = new Set(filtroLinha.map((v) => String(v || '').trim()));
      base = base.filter((i) => selecionadas.has((i.produto.linha || '').trim()));
    }

    if (filtroFamilia.length > 0) {
      const selecionadas = new Set(filtroFamilia.map((v) => String(v || '').trim()));
      base = base.filter((i) => selecionadas.has((i.produto.idfamilia || '').trim()));
    }

    if (filtroCurvaABC.length > 0) {
      const curvasSelecionadas = new Set(filtroCurvaABC);
      base = base.filter((i) => {
        const ref = (i.produto.referencia || '').trim().toUpperCase();
        const curva = curvaABC[ref] || 'B';
        return curvasSelecionadas.has(curva);
      });
    }

    // Filtro para excluir referências do de-para
    if (referenciasDeParaSet.size > 0) {
      base = base.filter((i) => {
        const ref = (i.produto.referencia || '').trim().toUpperCase();
        return !referenciasDeParaSet.has(ref);
      });
    }

    // De-para de cor: a referência antiga e a nova são a mesma, então só dá para esconder
    // a cor que sai pelo idproduto — filtrar por referência apagaria as duas cores.
    if (idsDeParaSet.size > 0) {
      base = base.filter((i) => !idsDeParaSet.has(String(i.produto.idproduto || '').trim()));
    }

    // Filtro para excluir SKUs sem plano em nenhum período (só tem estoque+processo para vender)
    if (filtroSomenteComPlano) {
      base = base.filter((i) => {
        const pMA = Number(i.plano?.ma || 0);
        const pPX = Number(i.plano?.px || 0);
        const pUL = Number(i.plano?.ul || 0);
        const pQT = Number((i.plano as { qt?: number } | undefined)?.qt || 0);
        const pQU = Number((i.plano as { qu?: number } | undefined)?.qu || 0);
        const pSX = Number((i.plano as { sx?: number } | undefined)?.sx || 0);
        return pMA > 0 || pPX > 0 || pUL > 0 || pQT > 0 || pQU > 0 || pSX > 0;
      });
    }

    return base;
  }, [dadosAtivosComEstoqueLojas, filtroContinuidade, filtroSuspensos, filtroLinha, filtroFamilia, filtroCurvaABC, curvaABC, referenciasDeParaSet, idsDeParaSet, filtroSomenteComPlano]);

  const projecoesAtivas = useMemo<ProjecoesMap>(() => {
    // Se não tem preview de reprojeção, retorna projeções originais
    if (reprojecaoPreview.length === 0) return projecoes;

    const clone: ProjecoesMap = { ...projecoes };
    const mesQT = mesNormalizado((periodos.UL || 0) + 1);
    const mesQU = mesNormalizado((periodos.UL || 0) + 2);
    const mesSX = mesNormalizado((periodos.UL || 0) + 3);

    for (const item of reprojecaoPreview) {
      const id = String(item.idproduto || '');
      if (!id) continue;
      const base = clone[id] ? { ...clone[id] } : {};

      // AUTO-APLICAR para UL, QT, QU, SX (novembro em diante) - SEMPRE
      base[String(periodos.UL)] = Number(item.recalculada?.ul || 0);
      base[String(mesQT)] = Number(item.recalculada?.qt || 0);
      base[String(mesQU)] = Number(item.recalculada?.qu || 0);
      base[String(mesSX)] = Number(item.recalculada?.sx || 0);

      // MA e PX só aplicam quando botão é clicado
      if (considerarProjecaoNova) {
        base[String(periodos.MA)] = Number(item.recalculada?.ma || 0);
        base[String(periodos.PX)] = Number(item.recalculada?.px || 0);
      }

      clone[id] = base;
    }
    return clone;
  }, [considerarProjecaoNova, reprojecaoPreview, projecoes, periodos]);

  const resumoMudancaProjecao = useMemo(() => {
    let alterados = 0;
    let deltaMA = 0;
    let deltaPX = 0;
    let deltaUL = 0;
    let deltaQT = 0;
    const mesQT = mesNormalizado((periodos.UL || 0) + 1);
    for (const item of dadosPagina) {
      const id = String(item.produto.idproduto || '');
      const originalMA = Number(projecoes[id]?.[String(periodos.MA)] || 0);
      const originalPX = Number(projecoes[id]?.[String(periodos.PX)] || 0);
      const originalUL = Number(projecoes[id]?.[String(periodos.UL)] || 0);
      const originalQT = Number(projecoes[id]?.[String(mesQT)] || 0);
      const novoMA = Number(projecoesAtivas[id]?.[String(periodos.MA)] || 0);
      const novoPX = Number(projecoesAtivas[id]?.[String(periodos.PX)] || 0);
      const novoUL = Number(projecoesAtivas[id]?.[String(periodos.UL)] || 0);
      const novoQT = Number(projecoesAtivas[id]?.[String(mesQT)] || 0);
      if (
        Math.round(originalMA) !== Math.round(novoMA) ||
        Math.round(originalPX) !== Math.round(novoPX) ||
        Math.round(originalUL) !== Math.round(novoUL) ||
        Math.round(originalQT) !== Math.round(novoQT)
      ) {
        alterados += 1;
      }
      deltaMA += novoMA - originalMA;
      deltaPX += novoPX - originalPX;
      deltaUL += novoUL - originalUL;
      deltaQT += novoQT - originalQT;
    }
    return {
      alterados,
      deltaMA: Math.round(deltaMA),
      deltaPX: Math.round(deltaPX),
      deltaUL: Math.round(deltaUL),
      deltaQT: Math.round(deltaQT),
    };
  }, [dadosPagina, projecoes, projecoesAtivas, periodos]);

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
        setResultadoReprojecaoMsg('Nenhum item teve projeção alterada.');
        return;
      }
      setResultadoReprojecaoMsg(
        `${resumoMudancaProjecao.alterados.toLocaleString('pt-BR')} itens com projeção alterada. ` +
        `Δ MA ${resumoMudancaProjecao.deltaMA.toLocaleString('pt-BR')} · ` +
        `Δ PX ${resumoMudancaProjecao.deltaPX.toLocaleString('pt-BR')} · ` +
        `Δ UL ${resumoMudancaProjecao.deltaUL.toLocaleString('pt-BR')} · ` +
        `Δ QT ${resumoMudancaProjecao.deltaQT.toLocaleString('pt-BR')}`
      );
    }, 550);
  }, [considerarProjecaoNova, reprojecaoPreview, resumoMudancaProjecao]);

  const totais = useMemo(() => dadosPagina.reduce(
    (acc, i) => ({
      itens:      acc.itens      + 1,
      estoque:    acc.estoque    + (i.estoques.estoque_atual    || 0),
      emProc:     acc.emProc     + (i.estoques.em_processo      || 0),
      estoqueMin: acc.estoqueMin + (i.estoques.estoque_minimo   || 0),
      pedidos:    acc.pedidos    + (i.demanda.pedidos_pendentes  || 0),
    }),
    { itens: 0, estoque: 0, emProc: 0, estoqueMin: 0, pedidos: 0 }
  ), [dadosPagina]);

  // Totalizador que reflete os filtros customizados (cobertura e em processo)
  const totaisFiltrados = useMemo(() => {
    let base = dadosPagina;

    // Aplica filtro de cobertura mínima (mesma lógica da tabela)
    if (filtroCoberturaMinima.trim()) {
      const valorCobertura = parseFloat(filtroCoberturaMinima);
      if (!isNaN(valorCobertura)) {
        base = base.filter((i) => {
          const estoqueAtual = Number(i.estoques?.estoque_atual || 0);
          const pedidos = Number(i.demanda?.pedidos_pendentes || 0);
          const estoqueMin = Number(i.estoques?.estoque_minimo || 0);
          const disponivelSemProcesso = estoqueAtual - pedidos;
          const coberturaAtual = estoqueMin > 0 ? disponivelSemProcesso / estoqueMin : Number.NEGATIVE_INFINITY;
          return coberturaAtual > valorCobertura;
        });
      }
    }

    // Aplica filtro de em processo mínimo
    if (filtroEmProcessoMinimo.trim()) {
      const valorProcesso = parseFloat(filtroEmProcessoMinimo);
      if (!isNaN(valorProcesso)) {
        base = base.filter((i) => {
          const emProcesso = Number(i.estoques?.em_processo || 0);
          return emProcesso > valorProcesso;
        });
      }
    }

    return base.reduce(
      (acc, i) => ({
        itens:      acc.itens      + 1,
        estoque:    acc.estoque    + (i.estoques.estoque_atual    || 0),
        emProc:     acc.emProc     + (i.estoques.em_processo      || 0),
        estoqueMin: acc.estoqueMin + (i.estoques.estoque_minimo   || 0),
        pedidos:    acc.pedidos    + (i.demanda.pedidos_pendentes  || 0),
      }),
      { itens: 0, estoque: 0, emProc: 0, estoqueMin: 0, pedidos: 0 }
    );
  }, [dadosPagina, filtroCoberturaMinima, filtroEmProcessoMinimo]);

  const skusSemCorteMinimo = useMemo(() => {
    const contagem = {
      permanente: new Set<string>(),
      permanenteCorNova: new Set<string>(),
    };

    for (const item of dados) {
      const continuidade = String(item.produto.continuidade || '').trim().toUpperCase();
      if (continuidade !== 'PERMANENTE' && continuidade !== 'PERMANENTE COR NOVA') continue;

      const idproduto = String(item.produto.idproduto || '').trim();
      if (!idproduto || Number(cortesMinimos[idproduto] || 0) > 0) continue;

      if (continuidade === 'PERMANENTE') contagem.permanente.add(idproduto);
      else contagem.permanenteCorNova.add(idproduto);
    }

    return {
      permanente: contagem.permanente.size,
      permanenteCorNova: contagem.permanenteCorNova.size,
    };
  }, [dados, cortesMinimos]);

  const analiseCobertura = useMemo(() => {
    let base = dadosPagina;

    if (apenasNegativos) {
      base = base.filter((i) => {
        const dispAtual = (i.estoques.estoque_atual || 0) - (i.demanda.pedidos_pendentes || 0);
        const proj = projecoesAtivas[i.produto.idproduto] ?? null;
        if (!proj) return dispAtual < 0;

        const emP = i.estoques.em_processo || 0;
        const pMA = i.plano?.ma || 0;
        const pPX = i.plano?.px || 0;
        const pUL = i.plano?.ul || 0;
        const pQT = (i.plano as { qt?: number } | undefined)?.qt || 0;
        const prMA = projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA);
        const prPX = proj[String(periodos.PX)] ?? 0;
        const prUL = proj[String(periodos.UL)] ?? 0;
        const prQT = proj[String(mesNormalizado((periodos.UL || 0) + 1))] ?? 0;
        const dispMA = dispAtual + emP + pMA - prMA;
        const dispPX = dispMA + pPX - prPX;
        const dispUL = dispPX + pUL - prUL;
        const dispQT = dispUL + pQT - prQT;
        return dispAtual < 0 || dispMA < 0 || dispPX < 0 || dispUL < 0 || dispQT < 0;
      });
    }

    const buckets = [
      { key: 'negativo', label: '< 0x', atual: 0, ultimo: 0 },
      { key: 'baixo', label: '0x a < 1x', atual: 0, ultimo: 0 },
      { key: 'alerta', label: '1x a < 1.5x', atual: 0, ultimo: 0 },
      { key: 'bom', label: '1.5x a < 2x', atual: 0, ultimo: 0 },
      { key: 'alto', label: '>= 2x', atual: 0, ultimo: 0 },
    ];

    let somaAtual = 0;
    let somaUltimo = 0;
    let countCobertura = 0;
    let criticoAtual = 0;
    let criticoUltimo = 0;
    let linhaAtual = 0;
    let linhaUltimo = 0;
    let riscoAtual = 0;
    let riscoUltimo = 0;
    let negativoAtual = 0;
    let negativoUltimo = 0;

    const bucketIndex = (cob: number) => {
      if (cob < 0) return 0;
      if (cob < 1) return 1;
      if (cob < 1.5) return 2;
      if (cob < 2) return 3;
      return 4;
    };

    for (const i of base) {
      const min = i.estoques.estoque_minimo || 0;
      if (min <= 0) continue;

      const dispAtual = (i.estoques.estoque_atual || 0) - (i.demanda.pedidos_pendentes || 0);
      const proj = projecoesAtivas[i.produto.idproduto] ?? null;
      const emP = i.estoques.em_processo || 0;
      const pMA = i.plano?.ma || 0;
      const pPX = i.plano?.px || 0;
      const pUL = i.plano?.ul || 0;
      const pQT = (i.plano as { qt?: number } | undefined)?.qt || 0;
      const prMA = proj ? projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA) : 0;
      const prPX = proj ? (proj[String(periodos.PX)] ?? 0) : 0;
      const prUL = proj ? (proj[String(periodos.UL)] ?? 0) : 0;
      const prQT = proj ? (proj[String(mesNormalizado((periodos.UL || 0) + 1))] ?? 0) : 0;
      const dispUltimo = dispAtual + emP + pMA - prMA + pPX - prPX + pUL - prUL + pQT - prQT;

      const cobAtual = dispAtual / min;
      const cobUltimo = dispUltimo / min;

      buckets[bucketIndex(cobAtual)].atual += 1;
      buckets[bucketIndex(cobUltimo)].ultimo += 1;

      somaAtual += cobAtual;
      somaUltimo += cobUltimo;
      countCobertura += 1;
      if (cobAtual < 1) criticoAtual += 1;
      if (cobUltimo < 1) criticoUltimo += 1;
      if (cobAtual < 0) negativoAtual += 1;
      else if (cobAtual < 0.5) riscoAtual += 1;
      else linhaAtual += 1;

      if (cobUltimo < 0) negativoUltimo += 1;
      else if (cobUltimo < 0.5) riscoUltimo += 1;
      else linhaUltimo += 1;
    }

    return {
      buckets,
      countCobertura,
      mediaAtual: countCobertura ? somaAtual / countCobertura : 0,
      mediaUltimo: countCobertura ? somaUltimo / countCobertura : 0,
      criticoAtual,
      criticoUltimo,
      totalBuckets: buckets.reduce((acc, b) => Math.max(acc, b.atual, b.ultimo), 0),
      linhaAtualPct: countCobertura ? (linhaAtual / countCobertura) * 100 : 0,
      linhaUltimoPct: countCobertura ? (linhaUltimo / countCobertura) * 100 : 0,
      riscoAtualPct: countCobertura ? (riscoAtual / countCobertura) * 100 : 0,
      riscoUltimoPct: countCobertura ? (riscoUltimo / countCobertura) * 100 : 0,
      negativoAtualPct: countCobertura ? (negativoAtual / countCobertura) * 100 : 0,
      negativoUltimoPct: countCobertura ? (negativoUltimo / countCobertura) * 100 : 0,
    };
  }, [dadosPagina, apenasNegativos, projecoesAtivas, periodos]);

  const resumoNegativos = useMemo(() => {
    let base = dadosPagina;

    let atual = 0;
    let atualPosProcesso = 0;
    let ma = 0;
    let px = 0;
    let ul = 0;
    let qt = 0;
    let qu = 0;
    let sx = 0;
    const porContinuidade = new Map<string, { atual: number; atualPosProcesso: number; ma: number; px: number; ul: number; qt: number; qu: number; sx: number }>();

    for (const i of base) {
      const continuidade = (i.produto.continuidade || 'SEM CONTINUIDADE').trim();
      const bucket = porContinuidade.get(continuidade) || { atual: 0, atualPosProcesso: 0, ma: 0, px: 0, ul: 0, qt: 0, qu: 0, sx: 0 };
      const dispAtual = (i.estoques.estoque_atual || 0) - (i.demanda.pedidos_pendentes || 0);
      const proj = projecoesAtivas[i.produto.idproduto] ?? null;
      const emP = i.estoques.em_processo || 0;
      const dispAtualPosProcesso = dispAtual + emP;
      const pMA = i.plano?.ma || 0;
      const pPX = i.plano?.px || 0;
      const pUL = i.plano?.ul || 0;
      const pQT = (i.plano as { qt?: number } | undefined)?.qt || 0;
      const pQU = (i.plano as { qu?: number } | undefined)?.qu || 0;
      const pSX = (i.plano as { sx?: number } | undefined)?.sx || 0;
      const prMA = proj ? projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA) : 0;
      const prPX = proj ? (proj[String(periodos.PX)] ?? 0) : 0;
      const prUL = proj ? (proj[String(periodos.UL)] ?? 0) : 0;
      const prQT = proj ? (proj[String(mesNormalizado((periodos.UL || 0) + 1))] ?? 0) : 0;
      const prQU = proj ? (proj[String(mesNormalizado((periodos.UL || 0) + 2))] ?? 0) : 0;
      const prSX = proj ? (proj[String(mesNormalizado((periodos.UL || 0) + 3))] ?? 0) : 0;
      const dispMA = dispAtual + emP + pMA - prMA;
      const dispPX = dispMA + pPX - prPX;
      const dispUL = dispPX + pUL - prUL;
      const dispQT = dispUL + pQT - prQT;
      const dispQU = dispQT + pQU - prQU;
      const dispSX = dispQU + pSX - prSX;

      if (dispAtual < 0) atual += Math.abs(dispAtual);
      if (dispAtualPosProcesso < 0) atualPosProcesso += Math.abs(dispAtualPosProcesso);
      if (dispMA < 0) ma += Math.abs(dispMA);
      if (dispPX < 0) px += Math.abs(dispPX);
      if (dispUL < 0) ul += Math.abs(dispUL);
      if (dispQT < 0) qt += Math.abs(dispQT);
      if (dispQU < 0) qu += Math.abs(dispQU);
      if (dispSX < 0) sx += Math.abs(dispSX);

      if (dispAtual < 0) bucket.atual += Math.abs(dispAtual);
      if (dispAtualPosProcesso < 0) bucket.atualPosProcesso += Math.abs(dispAtualPosProcesso);
      if (dispMA < 0) bucket.ma += Math.abs(dispMA);
      if (dispPX < 0) bucket.px += Math.abs(dispPX);
      if (dispUL < 0) bucket.ul += Math.abs(dispUL);
      if (dispQT < 0) bucket.qt += Math.abs(dispQT);
      if (dispQU < 0) bucket.qu += Math.abs(dispQU);
      if (dispSX < 0) bucket.sx += Math.abs(dispSX);
      porContinuidade.set(continuidade, bucket);
    }

    return {
      atual: Math.round(atual),
      atualPosProcesso: Math.round(atualPosProcesso),
      ma: Math.round(ma),
      px: Math.round(px),
      ul: Math.round(ul),
      qt: Math.round(qt),
      qu: Math.round(qu),
      sx: Math.round(sx),
      continuidade: Array.from(porContinuidade.entries())
        .map(([nome, valores]) => ({
          nome,
          atual: Math.round(valores.atual),
          atualPosProcesso: Math.round(valores.atualPosProcesso),
          ma: Math.round(valores.ma),
          px: Math.round(valores.px),
          ul: Math.round(valores.ul),
          qt: Math.round(valores.qt),
          qu: Math.round(valores.qu),
          sx: Math.round(valores.sx),
        }))
        .sort((a, b) => {
          const ordem: Record<string, number> = {
            'PERMANENTE': 1,
            'PERMANENTE COR NOVA': 2,
          };
          const oa = ordem[(a.nome || '').toUpperCase()] ?? 999;
          const ob = ordem[(b.nome || '').toUpperCase()] ?? 999;
          if (oa !== ob) return oa - ob;
          return a.nome.localeCompare(b.nome);
        }),
    };
  }, [dadosPagina, projecoesAtivas, periodos]);

  const previaNegativosRotina = useMemo<PreviaNegativoPeriodo[]>(() => {
    const statusPermitidos = STATUS_FIXO.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    const totais: Record<PeriodoRecuperarNegativos, { skus: number; pecas: number }> = {
      MA: { skus: 0, pecas: 0 },
      PX: { skus: 0, pecas: 0 },
      UL: { skus: 0, pecas: 0 },
      QT: { skus: 0, pecas: 0 },
      QU: { skus: 0, pecas: 0 },
      SX: { skus: 0, pecas: 0 },
    };

    const mesQT = periodos.QT || mesNormalizado((periodos.UL || 0) + 1);
    const mesQU = periodos.QU || mesNormalizado(mesQT + 1);
    const mesSX = mesNormalizado(mesQU + 1);

    for (const i of dadosAtivos) {
      const marca = String(i.produto?.marca || '').trim().toUpperCase();
      const status = String(i.produto?.status || '').trim().toUpperCase();
      const continuidade = String(i.produto?.continuidade || '').trim().toUpperCase();
      if (marca !== MARCA_FIXA) continue;
      if (!statusPermitidos.some((s) => status.startsWith(s))) continue;
      if (continuidade !== 'PERMANENTE' && continuidade !== 'PERMANENTE COR NOVA') continue;

      const proj = projecoesAtivas[String(i.produto.idproduto)] ?? null;
      const dispAtual = Number(i.estoques.estoque_atual || 0) - Number(i.demanda.pedidos_pendentes || 0);
      const emP = Number(i.estoques.em_processo || 0);
      const pMA = Number(i.plano?.ma || 0);
      const pPX = Number(i.plano?.px || 0);
      const pUL = Number(i.plano?.ul || 0);
      const pQT = Number((i.plano as { qt?: number } | undefined)?.qt || 0);
      const pQU = Number((i.plano as { qu?: number } | undefined)?.qu || 0);
      const pSX = Number((i.plano as { sx?: number } | undefined)?.sx || 0);
      const prMA = proj ? projecaoMesPlanejamento(Number(proj[String(periodos.MA)] || 0), periodos.MA) : 0;
      const prPX = proj ? Number(proj[String(periodos.PX)] || 0) : 0;
      const prUL = proj ? Number(proj[String(periodos.UL)] || 0) : 0;
      const prQT = proj ? Number(proj[String(mesQT)] || 0) : 0;
      const prQU = proj ? Number(proj[String(mesQU)] || 0) : 0;
      const prSX = proj ? Number(proj[String(mesSX)] || 0) : 0;

      const saldos: Record<PeriodoRecuperarNegativos, number> = {
        MA: dispAtual + emP + pMA - prMA,
        PX: 0,
        UL: 0,
        QT: 0,
        QU: 0,
        SX: 0,
      };
      saldos.PX = saldos.MA + pPX - prPX;
      saldos.UL = saldos.PX + pUL - prUL;
      saldos.QT = saldos.UL + pQT - prQT;
      saldos.QU = saldos.QT + pQU - prQU;
      saldos.SX = saldos.QU + pSX - prSX;

      for (const periodo of PERIODOS_RECUPERAR_NEGATIVOS) {
        const saldo = saldos[periodo];
        if (saldo < 0) {
          totais[periodo].skus += 1;
          totais[periodo].pecas += Math.abs(saldo);
        }
      }
    }

    return PERIODOS_RECUPERAR_NEGATIVOS.map((periodo) => ({
      periodo,
      skus: totais[periodo].skus,
      pecas: Math.round(totais[periodo].pecas),
    }));
  }, [dadosAtivos, projecoesAtivas, periodos]);

  const resumoRiscoMpPlano = useMemo(() => {
    let planoMA = 0;
    let planoPX = 0;
    let planoUL = 0;
    let planoQT = 0;
    let planoQU = 0;
    let planoSX = 0;
    let riscoMA = 0;
    let riscoPX = 0;
    let riscoUL = 0;
    let riscoQT = 0;
    let riscoQU = 0;
    let riscoSX = 0;

    for (const i of dadosPagina) {
      const id = String(i.produto.idproduto || '');
      const risco = riscoMpPorSku[id];
      const ma = Math.max(0, Number(i.plano?.ma || 0));
      const px = Math.max(0, Number(i.plano?.px || 0));
      const ul = Math.max(0, Number(i.plano?.ul || 0));
      const qt = Math.max(0, Number((i.plano as { qt?: number } | undefined)?.qt || 0));
      const qu = Math.max(0, Number((i.plano as { qu?: number } | undefined)?.qu || 0));
      const sx = Math.max(0, Number((i.plano as { sx?: number } | undefined)?.sx || 0));

      planoMA += ma;
      planoPX += px;
      planoUL += ul;
      planoQT += qt;
      planoQU += qu;
      planoSX += sx;

      if (risco?.ma) riscoMA += ma;
      if (risco?.px) riscoPX += px;
      if (risco?.ul) riscoUL += ul;
      if (risco?.qt) riscoQT += qt;
      if (risco?.qu) riscoQU += qu;
      if (risco?.sx) riscoSX += sx;
    }

    const pct = (risco: number, plano: number) => (plano > 0 ? clampPct((risco / plano) * 100) : 0);

    return {
      riscoMA: Math.round(riscoMA),
      riscoPX: Math.round(riscoPX),
      riscoUL: Math.round(riscoUL),
      riscoQT: Math.round(riscoQT),
      riscoQU: Math.round(riscoQU),
      riscoSX: Math.round(riscoSX),
      planoMA: Math.round(planoMA),
      planoPX: Math.round(planoPX),
      planoUL: Math.round(planoUL),
      planoQT: Math.round(planoQT),
      planoQU: Math.round(planoQU),
      planoSX: Math.round(planoSX),
      pctMA: pct(riscoMA, planoMA),
      pctPX: pct(riscoPX, planoPX),
      pctUL: pct(riscoUL, planoUL),
      pctQT: pct(riscoQT, planoQT),
      pctQU: pct(riscoQU, planoQU),
      pctSX: pct(riscoSX, planoSX),
    };
  }, [dadosPagina, riscoMpPorSku]);

  const graficosCobertura = useMemo(() => {
    type AcumSku = { total: number; cobertos: number };
    type AcumRef = { totalDisp: number; totalMin: number };
    type AcumMes = {
      total: AcumSku;
      top30: AcumSku;
      demais: AcumSku;
      kissme: AcumSku;
      refTotal: Map<string, AcumRef>;
      refTop30: Map<string, AcumRef>;
      refDemais: Map<string, AcumRef>;
      refKissme: Map<string, AcumRef>;
    };

    const initSku = (): AcumSku => ({ total: 0, cobertos: 0 });
    const initMes = (): AcumMes => ({
      total: initSku(),
      top30: initSku(),
      demais: initSku(),
      kissme: initSku(),
      refTotal: new Map(),
      refTop30: new Map(),
      refDemais: new Map(),
      refKissme: new Map(),
    });

    const meses = { MA: initMes(), PX: initMes(), UL: initMes(), QT: initMes(), QU: initMes() };
    const addRef = (mapa: Map<string, AcumRef>, ref: string, disp: number, min: number) => {
      const atual = mapa.get(ref) || { totalDisp: 0, totalMin: 0 };
      atual.totalDisp += disp;
      atual.totalMin += min;
      mapa.set(ref, atual);
    };
    const acumSku = (acc: AcumSku, cob: number) => {
      acc.total += 1;
      if (cob > 0.2) acc.cobertos += 1;
    };
    const pctSku = (acc: AcumSku) => (acc.total > 0 ? clampPct((acc.cobertos / acc.total) * 100) : 0);
    const pctRef = (mapa: Map<string, AcumRef>) => {
      const refs = Array.from(mapa.values());
      if (!refs.length) return 0;
      const cobertas = refs.filter((r) => r.totalMin > 0 && (r.totalDisp / r.totalMin) > 0.2).length;
      return clampPct((cobertas / refs.length) * 100);
    };

    dadosPagina.forEach((i) => {
      const min = Number(i.estoques.estoque_minimo || 0);
      if (min <= 0) return;
      const ref = (i.produto.referencia || '').trim() || 'SEM REF';
      const id = String(i.produto.idproduto || '');
      const isTop30 = top30Refs.has(normalizaRef(ref)) || top30Ids.has(id);
      const texto = `${i.produto.produto || ''} ${i.produto.apresentacao || ''}`.toUpperCase();
      const isKissMe = texto.includes('KISS ME');

      const dispAtual = (i.estoques.estoque_atual || 0) - (i.demanda.pedidos_pendentes || 0);
      const emP = i.estoques.em_processo || 0;
      const pMA = i.plano?.ma || 0;
      const pPX = i.plano?.px || 0;
      const pUL = i.plano?.ul || 0;
      const pQT = (i.plano as { qt?: number } | undefined)?.qt || 0;
      const pQU = (i.plano as { qu?: number } | undefined)?.qu || 0;
      const proj = projecoesAtivas[i.produto.idproduto] ?? null;
      const prMA = proj ? projecaoMesPlanejamento((proj[String(periodos.MA)] ?? 0), periodos.MA) : 0;
      const prPX = proj ? (proj[String(periodos.PX)] ?? 0) : 0;
      const prUL = proj ? (proj[String(periodos.UL)] ?? 0) : 0;
      const prQT = proj ? (proj[String(mesNormalizado((periodos.UL || 0) + 1))] ?? 0) : 0;
      const prQU = proj ? (proj[String(mesNormalizado((periodos.UL || 0) + 2))] ?? 0) : 0;
      const dispMA = dispAtual + emP + pMA - prMA;
      const dispPX = dispMA + pPX - prPX;
      const dispUL = dispPX + pUL - prUL;
      const dispQT = dispUL + pQT - prQT;
      const dispQU = dispQT + pQU - prQU;

      const porMes: Array<{ mes: 'MA' | 'PX' | 'UL' | 'QT' | 'QU'; cob: number; disp: number }> = [
        { mes: 'MA', cob: dispMA / min, disp: dispMA },
        { mes: 'PX', cob: dispPX / min, disp: dispPX },
        { mes: 'UL', cob: dispUL / min, disp: dispUL },
        { mes: 'QT', cob: dispQT / min, disp: dispQT },
        { mes: 'QU', cob: dispQU / min, disp: dispQU },
      ];

      porMes.forEach(({ mes, cob, disp }) => {
        const t = meses[mes];
        acumSku(t.total, cob);
        addRef(t.refTotal, ref, disp, min);
        if (isTop30) {
          acumSku(t.top30, cob);
          addRef(t.refTop30, ref, disp, min);
        } else {
          acumSku(t.demais, cob);
          addRef(t.refDemais, ref, disp, min);
        }
        if (isKissMe) {
          acumSku(t.kissme, cob);
          addRef(t.refKissme, ref, disp, min);
        }
      });
    });

    const toSku = (mes: 'MA' | 'PX' | 'UL' | 'QT' | 'QU', x: AcumMes): SerieMes => ({
      mes, total: pctSku(x.total), top30: pctSku(x.top30), demais: pctSku(x.demais), kissme: pctSku(x.kissme),
    });
    const toRef = (mes: 'MA' | 'PX' | 'UL' | 'QT' | 'QU', x: AcumMes): SerieMes => ({
      mes, total: pctRef(x.refTotal), top30: pctRef(x.refTop30), demais: pctRef(x.refDemais), kissme: pctRef(x.refKissme),
    });

    return {
      sku: [toSku('MA', meses.MA), toSku('PX', meses.PX), toSku('UL', meses.UL), toSku('QT', meses.QT), toSku('QU', meses.QU)],
      ref: [toRef('MA', meses.MA), toRef('PX', meses.PX), toRef('UL', meses.UL), toRef('QT', meses.QT), toRef('QU', meses.QU)],
    };
  }, [dadosPagina, projecoesAtivas, periodos, top30Ids, top30Refs]);

  const opcoesContinuidade = useMemo(
    () => Array.from(new Set(dadosAtivos.map((i) => (i.produto.continuidade || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [dadosAtivos]
  );
  const opcoesCor = useMemo(
    () => ['TODAS', ...Array.from(new Set(dadosPagina.map((i) => (i.produto.cor || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))],
    [dadosPagina]
  );

  const opcoesLinha = useMemo(
    () => Array.from(new Set(dadosAtivos.map((i) => (i.produto.linha || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [dadosAtivos]
  );

  const opcoesFamilia = useMemo(
    () => Array.from(new Set(dadosAtivos.map((i) => (i.produto.idfamilia || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [dadosAtivos]
  );

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  const resumoHistoricoMinimo = useMemo(() => {
    const ids = new Set(dados.map((item) => String(item.produto.idproduto)));
    const rows = historicoMinimo.filter((item) => ids.has(item.sku));
    return fechamentosMinimo.map((fechamento, index) => ({
      ...fechamento,
      total: rows.reduce((sum, row) => sum + Number(row.fechamentos[index]?.minimo || 0), 0),
      mediaTri: rows.reduce((sum, row) => sum + Number(row.fechamentos[index]?.mediaTri || 0), 0),
    }));
  }, [dados, historicoMinimo, fechamentosMinimo]);

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />

      {mostrarModalNegativos && (
        <div className="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center p-6">
          <div className="w-full max-w-3xl bg-white rounded-lg shadow-2xl border border-amber-200 overflow-hidden">
            <div className="bg-amber-600 px-6 py-4">
              <div className="text-white text-lg font-bold">Recuperacao de negativos pendente</div>
              <div className="text-amber-50 text-sm">
                Falta salvar a sugestao desta rotina para o ciclo atual.
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <div className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Pendente desde</div>
                  <div className="text-2xl font-bold text-amber-800">{rotinaNegativosInfo?.inicio || '-'}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ciclo atual</div>
                  <div className="text-lg font-bold text-gray-900">
                    {rotinaNegativosInfo ? `${rotinaNegativosInfo.inicio} a ${rotinaNegativosInfo.fim}` : '-'}
                  </div>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Como concluir</div>
                  <div className="text-lg font-bold text-emerald-800">Salvar simulacao</div>
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Previa dos negativos</div>
                    <div className="text-sm font-semibold text-gray-800">Somente Permanente e Permanente cor nova</div>
                  </div>
                  {(loading || Object.keys(projecoesAtivas).length === 0) && <div className="text-xs text-gray-500">Carregando valores...</div>}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                  {previaNegativosRotina.map((p) => (
                    <div key={p.periodo} className={`rounded-md border px-3 py-2 ${p.pecas > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
                      <div className={`text-sm font-bold ${p.pecas > 0 ? 'text-red-700' : 'text-gray-700'}`}>{p.periodo}</div>
                      {(loading || Object.keys(projecoesAtivas).length === 0) ? (
                        <>
                          <div className="h-6 w-16 rounded bg-gray-200 animate-pulse mt-1" />
                          <div className="h-3 w-12 rounded bg-gray-200 animate-pulse mt-2" />
                        </>
                      ) : (
                        <>
                          <div className="text-lg font-bold text-gray-900">{p.pecas.toLocaleString('pt-BR')}</div>
                          <div className="text-[11px] text-gray-500">{p.skus.toLocaleString('pt-BR')} SKUs</div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
                <p>
                  Abra o painel, escolha o periodo que precisa corrigir e salve a sugestao de recuperacao. Enquanto nenhuma simulacao
                  de recuperacao de negativos for salva neste ciclo, este aviso volta ao abrir o plano ou apertar F5.
                </p>
                <p className="mt-2 text-xs text-gray-500">
                  Rotina programada para os dias 1, 10 e 20. Proxima verificacao: {rotinaNegativosInfo?.proxima || '-'}.
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={verRecuperarNegativosMaisTarde}
                  className="px-4 py-2 text-sm font-semibold border border-gray-300 rounded hover:bg-gray-50"
                >
                  Ver mais tarde
                </button>
                <button
                  type="button"
                  onClick={() => router.push('/recuperar-negativos')}
                  className="px-4 py-2 text-sm font-semibold bg-amber-600 text-white rounded hover:bg-amber-700"
                >
                  Resolver agora
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={`flex-1 min-w-0 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>

        {/* Header */}
        <header className="bg-brand-primary shadow-sm px-6 py-3 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-white font-bold font-secondary tracking-wide text-base">
              PLANO DE PRODUÇÃO
            </h1>
            <p className="text-white/70 text-xs font-secondary font-light">
              {MARCA_FIXA} · {STATUS_FIXO} · Continuidade › Referência › Cor/Tam
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs">
            {cacheStatus && (
              <div className="flex items-center gap-1.5 text-white/80">
                <span className={`w-2 h-2 rounded-full ${cacheStatus.fresh ? 'bg-green-300' : 'bg-amber-300'}`} />
                <span>
                  {cacheStatus.exists
                    ? `Cache: ${cacheStatus.updatedAt}${cacheStatus.ageHours !== undefined ? ` (${cacheStatus.ageHours}h)` : ''}`
                    : 'Sem cache'}
                </span>
              </div>
            )}
            {fromCache && <span className="text-green-200 font-medium">⚡ cache</span>}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-3 py-1.5 text-xs font-semibold text-brand-primary bg-white rounded hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              {refreshing ? 'Atualizando...' : 'Atualizar dados'}
            </button>
          </div>
        </header>

        {/* Conteúdo */}
        <main className="flex-1 min-w-0 px-4 py-3 space-y-3 xl:px-5">

          {/* mensagem de refresh */}
          {refreshMsg && (
            <div className="bg-brand-primary/10 border border-brand-primary/30 rounded-lg px-4 py-3 text-sm text-brand-dark">
              <div className="flex items-center gap-2">
                {building && (
                  <svg className="animate-spin w-4 h-4 text-brand-primary shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                )}
                <span>{refreshMsg}</span>
                {building && buildElapsed > 0 && (
                  <span className="ml-auto text-brand-primary font-mono text-xs">{buildElapsed}s</span>
                )}
              </div>
              {building && (
                <div className="mt-2 h-1 bg-brand-primary/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-primary rounded-full transition-all duration-1000"
                    style={{ width: `${Math.min((buildElapsed / 120) * 100, 95)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Barra de filtros */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-4 py-2.5">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Filtros</span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>
                <div className="relative z-[100] flex w-full flex-wrap items-center gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        onClick={() => setApenasNegativos((v) => !v)}
                        className={`inline-flex h-8 items-center px-3 text-xs font-semibold rounded-l-md border transition-colors ${
                          apenasNegativos
                            ? 'bg-red-600 text-white border-red-600'
                            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        Negativos
                      </button>
                      {apenasNegativos && (
                        <select
                          value={filtroNegativoPeriodo}
                          onChange={(e) => setFiltroNegativoPeriodo(e.target.value as 'TODOS' | 'ATUAL' | 'MA' | 'PX' | 'UL' | 'QT' | 'QU')}
                          className="h-8 px-2 text-xs border border-l-0 border-red-600 rounded-r-md bg-red-50 text-red-800 font-semibold"
                        >
                          <option value="TODOS">Todos</option>
                          <option value="ATUAL">Atual</option>
                          <option value="MA">{nomeMesCurto(periodos.MA).toUpperCase()}</option>
                          <option value="PX">{nomeMesCurto(periodos.PX).toUpperCase()}</option>
                          <option value="UL">{nomeMesCurto(periodos.UL).toUpperCase()}</option>
                          <option value="QT">{nomeMesCurto(periodos.QT || ((periodos.UL % 12) + 1)).toUpperCase()}</option>
                          <option value="QU">{nomeMesCurto(periodos.QU || (((periodos.QT || ((periodos.UL % 12) + 1)) % 12) + 1)).toUpperCase()}</option>
                        </select>
                      )}
                      <button
                        onClick={() => setFiltroSomenteComPlano((v) => !v)}
                        className={`inline-flex h-8 items-center px-3 text-xs font-semibold rounded-md border transition-colors ml-1 ${
                          filtroSomenteComPlano
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                        }`}
                        title="Exibir apenas SKUs que têm plano em algum período"
                      >
                        Com Plano
                      </button>
                    </div>
                  </div>

                  <div className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 shadow-sm focus-within:border-brand-primary">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 whitespace-nowrap">Cob. &gt;</span>
                    <input
                      type="text"
                      value={filtroCoberturaMinima}
                      onChange={(e) => setFiltroCoberturaMinima(e.target.value)}
                      placeholder="1"
                      className="h-full w-10 border-0 bg-transparent text-xs text-gray-700 outline-none placeholder:text-gray-300"
                    />
                  </div>

                  <div className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 shadow-sm focus-within:border-brand-primary">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 whitespace-nowrap">Em proc. &gt;</span>
                    <input
                      type="text"
                      value={filtroEmProcessoMinimo}
                      onChange={(e) => setFiltroEmProcessoMinimo(e.target.value)}
                      placeholder="0"
                      className="h-full w-10 border-0 bg-transparent text-xs text-gray-700 outline-none placeholder:text-gray-300"
                    />
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className={`relative ${abrirSeletorAprovadas ? 'z-[200]' : 'z-10'}`}>
                        <button
                          type="button"
                          onClick={() => setAbrirSeletorAprovadas((v) => !v)}
                          className="inline-flex h-8 w-[220px] items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 text-left shadow-sm hover:bg-gray-50"
                        >
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 whitespace-nowrap">Simulação</span>
                          <span className="flex-1 truncate text-xs text-gray-700">{aprovadasSelecionadasIds.length}/{aprovadas.length}</span>
                          <span className="text-[9px] text-gray-400">{abrirSeletorAprovadas ? '▲' : '▼'}</span>
                        </button>
                        {abrirSeletorAprovadas && (
                          <div className="absolute z-[200] mt-1 w-full border border-gray-300 rounded p-2 bg-white shadow-xl">
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-[11px] text-gray-500">Ultimas {APROVADAS_LIMIT} aprovadas</span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setAprovadasSelecionadasIds(aprovadas.map((a) => a.id))}
                                  className="px-2 py-0.5 text-[11px] rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                                >
                                  Todas
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setAprovadasSelecionadasIds([])}
                                  className="px-2 py-0.5 text-[11px] rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                                >
                                  Limpar
                                </button>
                              </div>
                            </div>
                            <div className="max-h-36 overflow-auto space-y-1 pr-1">
                              {aprovadas.map((a) => (
                                <label key={a.id} className="flex items-center gap-2 text-[11px] text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={aprovadasSelecionadasIds.includes(a.id)}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setAprovadasSelecionadasIds((prev) => {
                                        if (checked) return prev.includes(a.id) ? prev : [...prev, a.id];
                                        return prev.filter((id) => id !== a.id);
                                      });
                                    }}
                                  />
                                  <span className="truncate">
                                    {new Date(a.createdAt).toLocaleDateString('pt-BR')} · {String((a as { nome?: string }).nome || a.id)}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => setAplicarAprovadas((v) => !v)}
                        className={`inline-flex h-8 items-center px-3 text-xs font-semibold rounded-md border transition-colors ${
                          aplicarAprovadas
                            ? 'bg-brand-primary text-white border-brand-primary'
                            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        {aplicarAprovadas ? 'Aplicada' : 'Aplicar cálculos'}
                      </button>
                      <div className="text-[11px] text-gray-500">
                        Itens com plano aprovado: {planosAprovadosMap.size.toLocaleString('pt-BR')}
                      </div>
                    </div>
                  </div>

                  <div className="mx-1 h-6 w-px bg-gray-200" />
                  <div>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Curva</span>
                      {(['A', 'B', 'C', 'D'] as const).map((curva) => (
                        <button
                          key={curva}
                          onClick={() => {
                            setFiltroCurvaABC((prev) => {
                              if (prev.includes(curva)) return prev.filter((c) => c !== curva);
                              return [...prev, curva];
                            });
                          }}
                          className={`inline-flex h-8 w-8 items-center justify-center text-xs font-bold rounded-md border transition-colors ${
                            filtroCurvaABC.includes(curva)
                              ? curva === 'A'
                                ? 'bg-green-600 text-white border-green-600'
                                : curva === 'C'
                                  ? 'bg-red-600 text-white border-red-600'
                                  : curva === 'D'
                                    ? 'bg-amber-600 text-white border-amber-600'
                                    : 'bg-gray-600 text-white border-gray-600'
                              : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {curva}
                        </button>
                      ))}
                      {filtroCurvaABC.length > 0 && (
                        <button
                          onClick={() => setFiltroCurvaABC([])}
                          className="px-2 py-1.5 text-[10px] text-gray-500 hover:text-gray-700"
                        >
                          Limpar
                        </button>
                      )}
                    </div>
                  </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                  <div>
                    <div className={`relative ${abrirSeletorContinuidade ? 'z-[200]' : 'z-10'}`}>
                      <button
                        type="button"
                        onClick={() => setAbrirSeletorContinuidade((v) => !v)}
                        className="inline-flex h-8 w-[190px] items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 text-left shadow-sm hover:bg-gray-50"
                      >
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 whitespace-nowrap">Contin.</span>
                        <span className="flex-1 truncate text-xs text-gray-700">
                          {filtroContinuidade.length === 0 ? 'Todas' : `${filtroContinuidade.length} selec.`}
                        </span>
                        <span className="text-[9px] text-gray-400">{abrirSeletorContinuidade ? '▲' : '▼'}</span>
                      </button>
                      {abrirSeletorContinuidade && (
                        <div className="absolute z-[200] mt-1 w-full border border-gray-300 rounded p-2 bg-white shadow-xl">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-[11px] text-gray-500">Escolha as continuidades</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setFiltroContinuidade(opcoesContinuidade)}
                                className="px-2 py-0.5 text-[11px] rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                              >
                                Todas
                              </button>
                              <button
                                type="button"
                                onClick={() => setFiltroContinuidade([])}
                                className="px-2 py-0.5 text-[11px] rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                              >
                                Limpar
                              </button>
                            </div>
                          </div>
                          <div className="max-h-36 overflow-auto space-y-1 pr-1">
                            {opcoesContinuidade.map((c) => (
                              <label key={c} className="flex items-center gap-2 text-[11px] text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={filtroContinuidade.includes(c)}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setFiltroContinuidade((prev) => {
                                      if (checked) return prev.includes(c) ? prev : [...prev, c];
                                      return prev.filter((v) => v !== c);
                                    });
                                  }}
                                />
                                <span className="truncate">{c}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className={`relative ${abrirSeletorLinha ? 'z-[200]' : 'z-10'}`}>
                      <button
                        type="button"
                        onClick={() => setAbrirSeletorLinha((v) => !v)}
                        className="inline-flex h-8 w-[170px] items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 text-left shadow-sm hover:bg-gray-50"
                      >
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 whitespace-nowrap">Linha</span>
                        <span className="flex-1 truncate text-xs text-gray-700">
                          {filtroLinha.length === 0 ? 'Todas' : `${filtroLinha.length} selec.`}
                        </span>
                        <span className="text-[9px] text-gray-400">{abrirSeletorLinha ? '▲' : '▼'}</span>
                      </button>
                      {abrirSeletorLinha && (
                        <div className="absolute z-[200] mt-1 w-full border border-gray-300 rounded p-2 bg-white shadow-xl">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-[11px] text-gray-500">Escolha as linhas</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setFiltroLinha(opcoesLinha)}
                                className="px-2 py-0.5 text-[11px] rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                              >
                                Todas
                              </button>
                              <button
                                type="button"
                                onClick={() => setFiltroLinha([])}
                                className="px-2 py-0.5 text-[11px] rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                              >
                                Limpar
                              </button>
                            </div>
                          </div>
                          <div className="max-h-36 overflow-auto space-y-1 pr-1">
                            {opcoesLinha.map((c) => (
                              <label key={c} className="flex items-center gap-2 text-[11px] text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={filtroLinha.includes(c)}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setFiltroLinha((prev) => {
                                      if (checked) return prev.includes(c) ? prev : [...prev, c];
                                      return prev.filter((v) => v !== c);
                                    });
                                  }}
                                />
                                <span className="truncate">{c}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className={`relative ${abrirSeletorFamilia ? 'z-[200]' : 'z-10'}`}>
                      <button
                        type="button"
                        onClick={() => setAbrirSeletorFamilia((v) => !v)}
                        className="inline-flex h-8 w-[170px] items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 text-left shadow-sm hover:bg-gray-50"
                      >
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 whitespace-nowrap">Família</span>
                        <span className="flex-1 truncate text-xs text-gray-700">
                          {filtroFamilia.length === 0 ? 'Todas' : `${filtroFamilia.length} selec.`}
                        </span>
                        <span className="text-[9px] text-gray-400">{abrirSeletorFamilia ? '▲' : '▼'}</span>
                      </button>
                      {abrirSeletorFamilia && (
                        <div className="absolute z-[200] mt-1 w-full border border-gray-300 rounded p-2 bg-white shadow-xl">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-[11px] text-gray-500">Escolha as familias</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setFiltroFamilia(opcoesFamilia)}
                                className="px-2 py-0.5 text-[11px] rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                              >
                                Todas
                              </button>
                              <button
                                type="button"
                                onClick={() => setFiltroFamilia([])}
                                className="px-2 py-0.5 text-[11px] rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                              >
                                Limpar
                              </button>
                            </div>
                          </div>
                          <div className="max-h-36 overflow-auto space-y-1 pr-1">
                            {opcoesFamilia.map((c) => (
                              <label key={c} className="flex items-center gap-2 text-[11px] text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={filtroFamilia.includes(c)}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setFiltroFamilia((prev) => {
                                      if (checked) return prev.includes(c) ? prev : [...prev, c];
                                      return prev.filter((v) => v !== c);
                                    });
                                  }}
                                />
                                <span className="truncate">{c}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 shadow-sm focus-within:border-brand-primary">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 whitespace-nowrap">Ref.</span>
                    <input
                      value={filtroReferencia}
                      onChange={(e) => setFiltroReferencia(e.target.value)}
                      placeholder="4025"
                      className="h-full w-16 border-0 bg-transparent text-xs text-gray-700 outline-none placeholder:text-gray-300"
                    />
                  </div>

                  <div className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white pl-2 pr-1 shadow-sm focus-within:border-brand-primary">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 whitespace-nowrap">Cor</span>
                    <select
                      value={filtroCor}
                      onChange={(e) => setFiltroCor(e.target.value)}
                      className="h-full w-[104px] border-0 bg-transparent text-xs text-gray-700 outline-none"
                    >
                      {opcoesCor.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                  <div className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white pl-2 pr-1 shadow-sm focus-within:border-brand-primary">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 whitespace-nowrap">Cobertura</span>
                    <select
                      value={filtroCobertura}
                      onChange={(e) => setFiltroCobertura(e.target.value as 'TODAS' | 'NEGATIVA' | 'ZERO_UM' | 'MAIOR_UM' | 'MAIOR_2')}
                      className="h-full w-[82px] border-0 bg-transparent text-xs text-gray-700 outline-none"
                    >
                      <option value="TODAS">Todas</option>
                      <option value="NEGATIVA">{'< 0x'}</option>
                      <option value="ZERO_UM">0x a &lt;1x</option>
                      <option value="MAIOR_UM">{'>= 1x'}</option>
                      <option value="MAIOR_2">{'>= 2x'}</option>
                    </select>
                  </div>

                  <div className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white pl-2 pr-1 shadow-sm focus-within:border-brand-primary">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 whitespace-nowrap">{taxaFiltroLabel}</span>
                    <select
                      value={filtroTaxa}
                      onChange={(e) => setFiltroTaxa(e.target.value as 'TODAS' | 'ATE_70')}
                      className="h-full w-[92px] border-0 bg-transparent text-xs text-gray-700 outline-none"
                    >
                      <option value="TODAS">Todas</option>
                      <option value="ATE_70">Ambas ≤ 70%</option>
                    </select>
                  </div>
                  </div>
                </div>
              </div>
          </div>

          {/* Portfólio */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-4 py-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Portfólio</span>
                <div className="flex-1 h-px bg-gray-100" />
                {(() => {
                  const curvas = [
                    { letra: 'A', cor: 'text-emerald-600', min: cfgCurvas.cobertura_min_a, max: cfgCurvas.cobertura_max_a },
                    { letra: 'B', cor: 'text-blue-600',    min: cfgCurvas.cobertura_min_b, max: cfgCurvas.cobertura_max_b },
                    { letra: 'C', cor: 'text-amber-600',   min: cfgCurvas.cobertura_min_c, max: cfgCurvas.cobertura_max_c },
                    { letra: 'D', cor: 'text-red-600',     min: cfgCurvas.cobertura_min_d, max: cfgCurvas.cobertura_max_d },
                  ];
                  const fmtX = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x`;
                  return (
                    <div className="flex shrink-0 items-center gap-x-2.5 rounded-md border border-gray-200 bg-gray-50 px-3 py-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Cob. mín</span>
                      {curvas.map((c) => (
                        <span key={`min-${c.letra}`} className="text-xs text-gray-700">
                          <span className={`font-bold ${c.cor}`}>{c.letra}</span> {fmtX(c.min)}
                        </span>
                      ))}
                      <span className="h-3 w-px bg-gray-300" />
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Cob. máx</span>
                      {curvas.map((c) => (
                        <span key={`max-${c.letra}`} className="text-xs text-gray-700">
                          <span className={`font-bold ${c.cor}`}>{c.letra}</span> {fmtX(c.max)}
                        </span>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 xl:grid-cols-7">
                {(() => {
                  const usarFiltrados = filtroCoberturaMinima.trim() || filtroEmProcessoMinimo.trim();
                  const t = usarFiltrados ? totaisFiltrados : totais;
                  // SKUs sem corte mínimo cadastrado entram como mais dois indicadores do portfólio
                  const semCorte = (qtd: number) => (loadingCortesMinimos ? '...' : erroCortesMinimos ? '—' : qtd.toLocaleString('pt-BR'));
                  const corSemCorte = (qtd: number) => (qtd > 0 ? 'text-amber-600' : 'text-emerald-600');
                  return [
                    { label: 'Itens',         value: t.itens.toLocaleString('pt-BR'),                                    accent: 'text-brand-primary' },
                    { label: 'Estoque atual', value: t.estoque.toLocaleString('pt-BR',    { maximumFractionDigits: 0 }), accent: 'text-blue-600' },
                    { label: 'Em processo',   value: t.emProc.toLocaleString('pt-BR',     { maximumFractionDigits: 0 }), accent: 'text-sky-600' },
                    { label: 'Est. mínimo',   value: t.estoqueMin.toLocaleString('pt-BR', { maximumFractionDigits: 0 }), accent: 'text-gray-700' },
                    { label: 'Pedidos pend.', value: t.pedidos.toLocaleString('pt-BR',    { maximumFractionDigits: 0 }), accent: 'text-amber-600' },
                    { label: 'Perm. sem corte mín.',     value: semCorte(skusSemCorteMinimo.permanente),        accent: corSemCorte(skusSemCorteMinimo.permanente) },
                    { label: 'Cor nova sem corte mín.',  value: semCorte(skusSemCorteMinimo.permanenteCorNova), accent: corSemCorte(skusSemCorteMinimo.permanenteCorNova) },
                  ].map((c) => (
                    <div key={c.label}>
                      <div className="text-[10px] text-gray-400 leading-tight">{c.label}</div>
                      <div className={`text-lg font-bold font-mono leading-tight ${c.accent}`}>{c.value}</div>
                    </div>
                  ));
                })()}
              </div>


            </div>

          {/* Totais do plano por continuidade — espelha a linha de totalizador da matriz */}
          {!loading && !error && totaisContinuidade.length > 0 && (() => {
            const meses = [
              { label: nomeMesCurto(periodos.MA), bg: 'bg-indigo-50', head: 'bg-indigo-100 text-indigo-900', periodo: 'MA',
                proj: 'projMA', plano: 'planoMA', disp: 'dispFutMar', neg: 'negFutMar' },
              { label: nomeMesCurto(periodos.PX), bg: 'bg-emerald-50', head: 'bg-emerald-100 text-emerald-900', periodo: 'PX',
                proj: 'projPX', plano: 'planoPX', disp: 'dispFutAbr', neg: 'negFutAbr' },
              { label: nomeMesCurto(periodos.UL), bg: 'bg-amber-50', head: 'bg-amber-100 text-amber-900', periodo: 'UL',
                proj: 'projUL', plano: 'planoUL', disp: 'dispFutMai', neg: 'negFutMai' },
              { label: nomeMesCurto((periodos.UL || 0) + 1), bg: 'bg-cyan-50', head: 'bg-cyan-100 text-cyan-900', periodo: 'QT',
                proj: 'projQT', plano: 'planoQT', disp: 'dispFutJun', neg: 'negFutJun' },
              { label: nomeMesCurto((periodos.UL || 0) + 2), bg: 'bg-rose-50', head: 'bg-rose-100 text-rose-900', periodo: 'QU',
                proj: 'projQU', plano: 'planoQU', disp: 'dispFutJul', neg: 'negFutJul' },
              { label: nomeMesCurto((periodos.UL || 0) + 3), bg: 'bg-purple-50', head: 'bg-purple-100 text-purple-900', periodo: 'SX',
                proj: 'projSX', plano: 'planoSX', disp: 'dispFutNov', neg: 'negFutNov' },
            ] as const;
            const num = (t: GrupoTotais, campo: string) => Number((t as unknown as Record<string, number>)[campo] || 0);
            const fmtN = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
            // soma as continuidades que a matriz devolveu já filtradas
            const soma = (campo: string) => totaisContinuidade.reduce((acc, t) => acc + num(t.totais, campo), 0);
            const minTotal = totaisContinuidade.reduce((acc, t) => acc + (t.totais.estoqueMin || 0), 0);

            return (
              <div className="rounded-xl shadow-sm border border-gray-200 bg-gradient-to-br from-slate-50 via-white to-slate-50/70 px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-primary shrink-0" />
                  <span className="text-[10px] font-bold text-brand-primary uppercase tracking-widest">Cobertura do Plano</span>
                  <div className="flex-1 h-px bg-gray-100" />
                  <span className="text-[10px] text-gray-400">negativo aberto por continuidade em cada mês</span>
                </div>

                <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-3 xl:grid-cols-6">
                  {meses.map((m) => {
                    const plano = soma(m.plano);
                    const proj = soma(m.proj);
                    const disp = soma(m.disp);
                    const neg = soma(m.neg);
                    const cob = minTotal > 0 ? disp / minTotal : null;
                    const exec = execucaoPlanoResumo?.geral?.[m.periodo]?.percentual ?? null;
                    const gapMes = m.periodo in gapPorPeriodo ? gapPorPeriodo[m.periodo] : null;
                    // bateria de 10 células: qualquer execução acima de zero já acende a primeira
                    const celulas = exec === null ? 0 : Math.max(0, Math.min(10, Math.ceil((exec / 100) * 10)));

                    const linhas = totaisContinuidade
                      .map((t) => ({ nome: t.continuidade, valor: num(t.totais, m.neg) }))
                      .sort((a, b) => b.valor - a.valor);
                    const maiorNeg = Math.max(1, ...linhas.map((l) => l.valor));

                    return (
                      <div
                        key={m.label}
                        className="overflow-hidden rounded-lg border border-gray-200 bg-white transition-shadow duration-200 hover:shadow-md"
                      >
                        <div className={`flex items-baseline justify-between px-3 py-1 ${m.head}`}>
                          <span className="text-sm font-bold uppercase tracking-wide">{m.label}</span>
                          <span className={`font-mono text-sm font-bold ${cob !== null && cob < 0 ? 'text-red-600' : ''}`}>
                            {cob === null ? '—' : `${cob.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x`}
                          </span>
                        </div>

                        <div className="px-3 pb-2 pt-1.5">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Plano</div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-mono text-3xl font-bold leading-tight text-brand-dark tabular-nums">{fmtN(plano)}</span>
                            {gapMes !== null && (
                              <span
                                title="Gap de dias acumulado até este mês: dias necessários − dias produtivos"
                                className={`shrink-0 font-mono text-[13px] font-bold tabular-nums ${gapMes > 0 ? 'text-red-600' : 'text-emerald-600'}`}
                              >
                                {gapMes > 0 ? '+' : ''}{gapMes.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}d
                              </span>
                            )}
                          </div>

                          <div className="mt-1.5 space-y-0.5 border-t border-gray-200 pt-1.5 text-[13px]">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-medium text-gray-600">Projeção</span>
                              <span className="font-mono font-semibold tabular-nums text-gray-900">{fmtN(proj)}</span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-medium text-gray-600">Disponível</span>
                              <span className={`font-mono font-semibold tabular-nums ${disp < 0 ? 'font-bold text-red-600' : 'text-gray-900'}`}>{fmtN(disp)}</span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-medium text-gray-600">Negativo</span>
                              <span className={`font-mono font-semibold tabular-nums ${neg > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                {neg > 0 ? fmtN(neg) : '—'}
                              </span>
                            </div>
                          </div>

                          <div className="mt-2 border-t border-gray-200 pt-1.5">
                            <div className="flex items-baseline justify-between">
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Execução</span>
                              <span className="font-mono text-[13px] font-bold tabular-nums text-brand-dark">
                                {exec === null ? '—' : formatPct(exec)}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center gap-[3px]">
                              <div className="flex h-4 flex-1 items-center gap-[2px] rounded-[4px] border border-gray-300 bg-white px-[2px]">
                                {Array.from({ length: 10 }).map((_, i) => (
                                  <div
                                    key={i}
                                    className={`h-[10px] flex-1 rounded-[1px] transition-colors duration-500 ${i < celulas ? 'bg-emerald-500' : 'bg-gray-100'}`}
                                    style={{ transitionDelay: `${i * 45}ms` }}
                                  />
                                ))}
                              </div>
                              <span className="h-2 w-[3px] rounded-r-sm bg-gray-300" />
                            </div>
                          </div>
                        </div>

                        <div className="space-y-1.5 border-t border-gray-100 bg-gray-50/60 px-3 py-2">
                          {linhas.map((l) => (
                            <div key={l.nome} className="space-y-0.5">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="truncate text-[11px] font-semibold uppercase text-brand-dark">{l.nome}</span>
                                <span className={`shrink-0 font-mono text-[12px] font-bold tabular-nums ${l.valor > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                  {l.valor > 0 ? fmtN(l.valor) : '—'}
                                </span>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                                <div
                                  className={`h-full rounded-full transition-[width] duration-700 ease-out ${l.valor > 0 ? 'bg-red-500' : 'bg-gray-200'}`}
                                  style={{ width: `${(l.valor / maiorNeg) * 100}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

              </div>
            );
          })()}

          {/* Tempo de OP por local — a execução do plano agora vive na bateria de cada mês */}
          {!loading && !error && (indicadoresLocais.oficinas.length > 0 || indicadoresLocais.outrosLocais.length > 0) && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-4 py-3">

              {/* Tempo de OP */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Tempo de OP por local</span>
                  <div className="flex-1 h-px bg-gray-100" />
                  <span className="text-[10px] text-gray-400">dias do início ao encerramento</span>
                </div>
                {indicadoresLocais.oficinas.length === 0 && indicadoresLocais.outrosLocais.length === 0 ? (
                  <div className="text-xs text-gray-400">Sem OP encerrada no período.</div>
                ) : (
                  <div className="space-y-0.5">
                    {[...indicadoresLocais.oficinas, ...indicadoresLocais.outrosLocais].map((local) => (
                      <div key={local.nome} className="flex items-center justify-between gap-3 border-b border-gray-100 py-1 last:border-b-0">
                        <span className="text-[12px] font-semibold text-brand-dark uppercase truncate">{local.nome}</span>
                        <span className="flex shrink-0 items-center gap-3">
                          <span className="text-[10px] text-gray-400">Pior <span className="text-sm font-bold font-mono text-amber-600">{local.pior_dias}d</span></span>
                          <span className="text-[10px] text-gray-400">Média <span className="text-sm font-bold font-mono text-brand-dark">{local.media_dias}d</span></span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-1 text-[10px] text-gray-400 leading-snug">
                  OPs encerradas desde o dia 1º · duração total da OP, não da etapa · pior = 2º maior, média exclui extremos.
                </div>
              </div>

            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 flex items-center gap-3 text-sm text-gray-600">
              <svg className="animate-spin w-5 h-5 text-brand-primary shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Carregando dados...
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && !error && loadingRiscoMp && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              Recalculando impacto de matéria-prima no plano de produção...
            </div>
          )}

          {false && !loading && (
            <section className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-slate-800">Evolucao do estoque minimo</div>
                  <div className="text-xs text-slate-500">Tres ultimos fechamentos dos SKUs carregados no plano</div>
                </div>
                <div className="text-[11px] text-slate-500">A variacao mostra a mudanca do minimo, nao do plano</div>
              </div>
              {resumoHistoricoMinimo.length === 0 ? (
                <div className="px-4 py-4 text-sm text-slate-500">
                  {historicoMinimoStatus === 'erro' ? 'Historico nao carregado: a consulta demorou mais de 15 segundos e foi interrompida.' : 'Calculando os fechamentos historicos...'}
                </div>
              ) : <div className="overflow-x-auto">
                <table className="min-w-[760px] w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-2 text-left">Fechamento</th>
                      {resumoHistoricoMinimo.map((item) => <th key={`${item.ano}-${item.mes}`} className="px-4 py-2 text-right">{item.label}/{item.ano}</th>)}
                      <th className="px-4 py-2 text-right">Var. 1º → 2º</th>
                      <th className="px-4 py-2 text-right">Var. 2º → 3º</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-slate-100">
                      <td className="px-4 py-2 font-semibold text-slate-700">Estoque minimo total</td>
                      {resumoHistoricoMinimo.map((item) => <td key={`${item.ano}-${item.mes}-min`} className="px-4 py-2 text-right font-mono font-bold">{fmt(item.total)}</td>)}
                      <td className="px-4 py-2 text-right font-mono font-bold">{resumoHistoricoMinimo.length >= 2 ? fmt(resumoHistoricoMinimo[1].total - resumoHistoricoMinimo[0].total) : '-'}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold">{resumoHistoricoMinimo.length >= 3 ? fmt(resumoHistoricoMinimo[2].total - resumoHistoricoMinimo[1].total) : '-'}</td>
                    </tr>
                    <tr className="border-t border-slate-100">
                      <td className="px-4 py-2 text-slate-500">Media trimestral usada</td>
                      {resumoHistoricoMinimo.map((item) => <td key={`${item.ano}-${item.mes}-tri`} className="px-4 py-2 text-right font-mono text-slate-600">{fmt(item.mediaTri)}</td>)}
                      <td colSpan={2} className="px-4 py-2 text-right text-slate-400">-</td>
                    </tr>
                  </tbody>
                </table>
              </div>}
            </section>
          )}

          {/* Tabela */}
          {!loading && !error && dadosPagina.length > 0 && (
            <div className="text-xs text-gray-500 -mb-2">
              Filtros fixos da matriz: <span className="font-semibold text-brand-dark">{MARCA_FIXA}</span> · <span className="font-semibold text-brand-dark">{STATUS_FIXO}</span>
            </div>
          )}
          {!loading && !error && dadosPagina.length > 0 && (
            <MatrizPlanejamentoTable
              dados={dadosPagina}
              projecoes={projecoesAtivas}
              vendasReais={vendasReais}
              taxaMeses={taxaMeses}
              periodos={periodos}
              apenasNegativos={apenasNegativos}
              filtroNegativoPeriodo={filtroNegativoPeriodo}
              filtroContinuidade={filtroContinuidade}
              filtroReferencia={filtroReferencia}
              filtroCor={filtroCor}
              filtroCobertura={filtroCobertura}
              filtroCoberturaBase={filtroCoberturaBase}
              filtroTaxa={filtroTaxa}
              excedentesLojas={usarEstoqueLojas ? estoqueLojasDisponivel : null}
              filtroCoberturaMinima={filtroCoberturaMinima}
              filtroEmProcessoMinimo={filtroEmProcessoMinimo}
              curvaABC={curvaABC}
              riscoMpPorSku={riscoMpPorSku}
              detalheRiscoMpPorSku={detalheRiscoMpPorSku}
              onTotaisContinuidade={setTotaisContinuidade}
            />
          )}

        </main>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  subtitle,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  subtitle?: string;
  tone?: 'neutral' | 'warning' | 'danger';
}) {
  const palette = tone === 'danger'
    ? { box: 'border-red-200 bg-red-50', label: 'text-red-600', value: 'text-red-700' }
    : tone === 'warning'
      ? { box: 'border-amber-200 bg-amber-50', label: 'text-amber-700', value: 'text-amber-800' }
      : { box: 'border-gray-200 bg-gray-50', label: 'text-gray-500', value: 'text-gray-900' };

  return (
    <div className={`rounded-lg border px-3 py-2 ${palette.box}`}>
      <div className={`text-[11px] ${palette.label}`}>{label}</div>
      <div className={`text-lg font-bold font-mono ${palette.value}`}>{value}</div>
      {subtitle && <div className="text-[11px] text-gray-500 mt-0.5">{subtitle}</div>}
    </div>
  );
}

function VerticalCoverageChart({ title, series }: { title: string; series: SerieMes[] }) {
  const legendas = [
    { key: 'total' as const, label: 'Total', color: 'bg-slate-500' },
    { key: 'top30' as const, label: 'Top 30', color: 'bg-blue-600' },
    { key: 'demais' as const, label: 'Demais', color: 'bg-amber-500' },
    { key: 'kissme' as const, label: 'KISS ME', color: 'bg-emerald-600' },
  ];

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="text-xs font-semibold text-brand-dark mb-2">{title}</div>
      <div className="flex flex-wrap gap-3 text-[11px] text-gray-600 mb-3">
        {legendas.map((l) => (
          <div key={l.key} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-sm ${l.color}`} />
            <span>{l.label}</span>
          </div>
        ))}
      </div>
      <div className="h-56 border border-gray-200 rounded-md p-2 bg-gray-50">
        <div className="h-full grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.max(1, series.length)}, minmax(0, 1fr))` }}>
          {series.map((s) => (
            <div key={s.mes} className="h-full flex flex-col">
              <div className="flex-1 flex items-end justify-center gap-1.5">
                {legendas.map((l) => {
                  const valor = clampPct(Number(s[l.key] || 0));
                  return (
                    <div key={`${s.mes}-${l.key}`} className="w-8 flex flex-col items-center justify-end h-full">
                      <div className="text-[10px] text-gray-600 mb-1">{valor.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</div>
                      <div className={`w-full rounded-t-sm ${l.color}`} style={{ height: `${Math.max(2, valor)}%` }} />
                    </div>
                  );
                })}
              </div>
              <div className="pt-2 text-center text-xs font-semibold text-gray-700">{s.mes}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
