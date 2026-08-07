'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';
import type { Planejamento } from '../types';
import { OP_MIN_REGRAS_FIXAS, RegraOpMinRow } from '../lib/opMinRules';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type ReferenciaRow = {
  referencia: string;
  idreferencia: string;
  rateio: number;
  tempo: number;
  processoPecas: number;
  processoCarga: number;
  planoMA: number;
  planoPX: number;
  planoUL: number;
  planoQT: number;
  planoQU: number;
  planoSX: number;
  cargaMA: number;
  cargaPX: number;
  cargaUL: number;
  cargaQT: number;
  cargaQU: number;
  cargaSX: number;
  cargaTotal: number;
};

// Tipo para visão agregada por referência (mostra em quais grupos ela está)
type ReferenciaAgregada = {
  referencia: string;
  idreferencia: string;
  tempo: number;
  grupos: Array<{
    grupo: string;
    rateio: number;
    capacidadeDiaria: number;
    saldoAcum: number; // saldo acumulado do grupo (positivo = folga, negativo = estourado)
    cargaAcum: number; // carga da referencia neste grupo ate o horizonte
    estourado: boolean; // se o grupo está estourado
  }>;
  totalGrupos: number;
  gruposComFolga: number; // quantos grupos têm folga
  gruposEstourados: number; // quantos grupos estão estourados
  // Totais (soma de todos os grupos, ou seja, 100% da carga)
  planoMA: number;
  planoPX: number;
  planoUL: number;
  planoQT: number;
  planoQU: number;
  planoSX: number;
  cargaMA: number;
  cargaPX: number;
  cargaUL: number;
  cargaQT: number;
  cargaQU: number;
  cargaSX: number;
  cargaTotal: number;
  // Quanto falta para atender (baseado nos saldos dos grupos)
  diasFaltantes: number;
  estourado: boolean;
};

type MovimentoBalanceamento = {
  referencia: string;
  origem: string;
  destino: string;
  tempo: number;
  minutos: number;
  pecas: number;
  percentualRef: number;
  saldoOrigemAntes: number;
  saldoOrigemDepois: number;
  saldoDestinoAntes: number;
  saldoDestinoDepois: number;
};

type SequenciamentoRow = {
  ordem: number;
  grupo: string;
  referencia: string;
  periodo: Horizonte;
  planoReferencia: number;
  percentualGrupo: number;
  qtdSugerida: number;
  qtdAjustada: number;
  corteMinRef: number;
  opMinRef: number;
  tempo: number;
  cargaMinutos: number;
  saldoGrupoProjetado: number;
  status: 'OK' | 'QUEBRA_OP_MIN' | 'VALIDAR_CORTE_SKU' | 'SEM_PLANO';
};

type SequenciamentoReferencia = {
  referencia: string;
  ordem: number;
  grupos: string[];
  totalPecas: number;
  totalCargaMinutos: number;
  dias: number;
  cabe: boolean;
  alertasOpMin: number;
  periodos: Record<Horizonte, { qtd: number; cargaMinutos: number }>;
  linhas: SequenciamentoRow[];
};

type ReferenciaRestrita = {
  referencia: string;
  gruposTotal: number;
  origensNegativas: string[];
  destinosDisponiveis: string[];
  cargaEmGargalo: number;
  folgaCompativel: number;
  deficitProjetado: number;
  motivo: 'SEM_DESTINO' | 'UMA_OPCAO' | 'POUCA_FOLGA' | 'AINDA_ESTOURA';
};

type GrupoRow = {
  grupo: string;
  tipo: string;
  capacidadeDiaria: number;
  refs: number;
  refsComTempo: number;
  referencias: ReferenciaRow[];
  processoPecas: number;
  processoCarga: number;
  planoMA: number;
  planoPX: number;
  planoUL: number;
  planoQT: number;
  planoQU: number;
  planoSX: number;
  cargaMA: number;
  cargaPX: number;
  cargaUL: number;
  cargaQT: number;
  cargaQU: number;
  cargaSX: number;
  cargaTotal: number;
  capacidadeMA: number;
  capacidadePX: number;
  capacidadeUL: number;
  capacidadeQT: number;
  capacidadeQU: number;
  capacidadeSX: number;
  capacidadeTotal: number;
  saldoMA: number;
  saldoPX: number;
  saldoUL: number;
  saldoQT: number;
  saldoQU: number;
  saldoSX: number;
  saldoAcumMA: number;
  saldoAcumPX: number;
  saldoAcumUL: number;
  saldoAcumQT: number;
  saldoAcumQU: number;
  saldoAcumSX: number;
  atendimentoMA: number;
  atendimentoPX: number;
  atendimentoUL: number;
  atendimentoQT: number;
  atendimentoQU: number;
  atendimentoSX: number;
  diasNecMA: number;
  diasNecPX: number;
  diasNecUL: number;
  diasNecQT: number;
  diasNecQU: number;
  diasNecSX: number;
  diasFaltMA: number;
  diasFaltPX: number;
  diasFaltUL: number;
  diasFaltQT: number;
  diasFaltQU: number;
  diasFaltSX: number;
  estourado: boolean;
};

type Periodos = {
  MA: number;
  PX: number;
  UL: number;
  QT: number;
  QU: number;
  SX: number;
};

type Resumo = {
  grupos: number;
  refs: number;
  refsComTempo: number;
  capacidadeDiaria: number;
  processoPecas: number;
  processoCarga: number;
  planoMA: number;
  planoPX: number;
  planoUL: number;
  planoQT: number;
  planoQU: number;
  planoSX: number;
  cargaMA: number;
  cargaPX: number;
  cargaUL: number;
  cargaQT: number;
  cargaQU: number;
  cargaSX: number;
  capacidadeMA: number;
  capacidadePX: number;
  capacidadeUL: number;
  capacidadeQT: number;
  capacidadeQU: number;
  capacidadeSX: number;
};

const MESES_PT: Record<number, string> = {
  1: 'Jan', 2: 'Fev', 3: 'Mar', 4: 'Abr', 5: 'Mai', 6: 'Jun',
  7: 'Jul', 8: 'Ago', 9: 'Set', 10: 'Out', 11: 'Nov', 12: 'Dez',
};

// Horizontes disponíveis
const HORIZONTES = ['MA', 'PX', 'UL', 'QT', 'QU', 'SX'] as const;
type Horizonte = typeof HORIZONTES[number];

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

function findRegraOpMin(rules: RegraOpMinRow[], continuidade: string, linha: string, grupoProduto: string) {
  const cont = normalizeRuleText(continuidade);
  const lin = normalizeRuleText(linha);
  const grp = normalizeRuleText(grupoProduto);
  return rules.find((rule) =>
    normalizeRuleText(rule.continuidade) === cont &&
    matchRuleValue(rule.linha, lin) &&
    matchRuleValue(rule.grupo, grp)
  ) || null;
}

function roundUpByLot(qtd: number, lot: number) {
  const l = Math.max(1, Math.round(Number(lot || 0)));
  const q = Math.max(0, Number(qtd || 0));
  return Math.ceil(q / l) * l;
}

export default function CapacidadeMatrizPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grupos, setGrupos] = useState<GrupoRow[]>([]);
  const [matrizBase, setMatrizBase] = useState<Planejamento[]>([]);
  const [cortesMinimos, setCortesMinimos] = useState<Record<string, number>>({});
  const [periodos, setPeriodos] = useState<Periodos>({ MA: 8, PX: 9, UL: 10, QT: 11, QU: 12, SX: 1 });
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [filtroGrupo, setFiltroGrupo] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('TODOS');
  const [somenteEstourados, setSomenteEstourados] = useState(false);
  const [horizonte, setHorizonte] = useState<Horizonte>('SX');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [filtroRefMultiGrupo, setFiltroRefMultiGrupo] = useState(false);
  const [filtroRefTexto, setFiltroRefTexto] = useState('');
  const [filtroRefProblema, setFiltroRefProblema] = useState(false);

  // Estado para simulação de redistribuição
  const [mostrarRedistribuicao, setMostrarRedistribuicao] = useState(false);
  const [refSelecionadaRedist, setRefSelecionadaRedist] = useState<string | null>(null);
  // Mapa: grupo -> percentual alocado (0-100)
  const [alocacaoSimulada, setAlocacaoSimulada] = useState<Record<string, number>>({});
  const redistribuicaoRef = useRef<HTMLDivElement | null>(null);

  // Determina quais períodos mostrar baseado no horizonte selecionado
  const horizonteIndex = HORIZONTES.indexOf(horizonte);
  const mostrarMA = horizonteIndex >= 0;
  const mostrarPX = horizonteIndex >= 1;
  const mostrarUL = horizonteIndex >= 2;
  const mostrarQT = horizonteIndex >= 3;
  const mostrarQU = horizonteIndex >= 4;
  const mostrarSX = horizonteIndex >= 5;

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregar();
  }, [router]);

  useEffect(() => {
    if (!mostrarRedistribuicao) return;
    window.setTimeout(() => {
      redistribuicaoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, [mostrarRedistribuicao, refSelecionadaRedist]);

  async function carregar() {
    setLoading(true);
    setError(null);
    try {
      const paramsMatriz = new URLSearchParams({ limit: '5000', marca: 'LIEBE', status: 'EM LINHA' });
      const [res, resMatriz, resCortes] = await Promise.all([
        fetchNoCache(`${API_URL}/api/capacidade/matriz`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/producao/matriz?${paramsMatriz}`),
        fetchNoCache(`${API_URL}/api/configuracoes/corte-minimos`, { headers: authHeaders() }),
      ]);
      const data = await res.json();
      const dataMatriz = await resMatriz.json();
      const dataCortes = await resCortes.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao carregar matriz');
      if (!resMatriz.ok || !dataMatriz.success) throw new Error(dataMatriz.error || 'Erro ao carregar matriz de produtos');
      setGrupos(data.grupos || []);
      setMatrizBase(Array.isArray(dataMatriz?.data) ? dataMatriz.data : []);
      const cortesMap: Record<string, number> = {};
      const cortesRows = Array.isArray(dataCortes?.data) ? dataCortes.data : [];
      cortesRows.forEach((r: { idproduto?: string; corte_min?: number }) => {
        const id = String(r?.idproduto || '').trim();
        const corte = Number(r?.corte_min || 0);
        if (id && corte > 0) cortesMap[id] = Math.round(corte);
      });
      setCortesMinimos(cortesMap);
      setPeriodos(data.periodos || { MA: 8, PX: 9, UL: 10, QT: 11, QU: 12, SX: 1 });
      setResumo(data.resumo || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }

  function toggleExpandir(grupo: string) {
    setExpandidos((prev) => {
      const novo = new Set(prev);
      if (novo.has(grupo)) {
        novo.delete(grupo);
      } else {
        novo.add(grupo);
      }
      return novo;
    });
  }

  function expandirTodos() {
    setExpandidos(new Set(gruposFiltrados.map((g) => g.grupo)));
  }

  function recolherTodos() {
    setExpandidos(new Set());
  }

  const tipos = useMemo(() => {
    const set = new Set<string>();
    grupos.forEach((g) => { if (g.tipo) set.add(g.tipo); });
    return Array.from(set).sort();
  }, [grupos]);

  const gruposFiltrados = useMemo(() => {
    return grupos.filter((g) => {
      if (filtroGrupo && !g.grupo.includes(filtroGrupo.toUpperCase())) return false;
      if (filtroTipo !== 'TODOS' && g.tipo !== filtroTipo) return false;
      if (somenteEstourados && !g.estourado) return false;
      return true;
    });
  }, [grupos, filtroGrupo, filtroTipo, somenteEstourados]);

  const resumoFiltrado = useMemo(() => {
    return gruposFiltrados.reduce(
      (acc, g) => ({
        grupos: acc.grupos + 1,
        refs: acc.refs + g.refs,
        capacidadeDiaria: acc.capacidadeDiaria + g.capacidadeDiaria,
        cargaMA: acc.cargaMA + g.cargaMA,
        cargaPX: acc.cargaPX + g.cargaPX,
        cargaUL: acc.cargaUL + g.cargaUL,
        cargaQT: acc.cargaQT + g.cargaQT,
        cargaQU: acc.cargaQU + g.cargaQU,
        cargaSX: acc.cargaSX + g.cargaSX,
        capacidadeMA: acc.capacidadeMA + g.capacidadeMA,
        capacidadePX: acc.capacidadePX + g.capacidadePX,
        capacidadeUL: acc.capacidadeUL + g.capacidadeUL,
        capacidadeQT: acc.capacidadeQT + g.capacidadeQT,
        capacidadeQU: acc.capacidadeQU + g.capacidadeQU,
        capacidadeSX: acc.capacidadeSX + g.capacidadeSX,
      }),
      {
        grupos: 0, refs: 0, capacidadeDiaria: 0,
        cargaMA: 0, cargaPX: 0, cargaUL: 0, cargaQT: 0, cargaQU: 0, cargaSX: 0,
        capacidadeMA: 0, capacidadePX: 0, capacidadeUL: 0, capacidadeQT: 0, capacidadeQU: 0, capacidadeSX: 0,
      }
    );
  }, [gruposFiltrados]);

  // Calcular saldo acumulado total baseado no horizonte selecionado
  const saldoAcumTotal = useMemo(() => {
    const saldoMA = resumoFiltrado.capacidadeMA - resumoFiltrado.cargaMA;
    const saldoPX = resumoFiltrado.capacidadePX - resumoFiltrado.cargaPX;
    const saldoUL = resumoFiltrado.capacidadeUL - resumoFiltrado.cargaUL;
    const saldoQT = resumoFiltrado.capacidadeQT - resumoFiltrado.cargaQT;
    const saldoQU = resumoFiltrado.capacidadeQU - resumoFiltrado.cargaQU;
    const saldoSX = resumoFiltrado.capacidadeSX - resumoFiltrado.cargaSX;

    // Saldo acumulado até o horizonte selecionado
    let acum = 0;
    if (mostrarMA) acum += saldoMA;
    if (mostrarPX) acum += saldoPX;
    if (mostrarUL) acum += saldoUL;
    if (mostrarQT) acum += saldoQT;
    if (mostrarQU) acum += saldoQU;
    if (mostrarSX) acum += saldoSX;

    // Calcular em dias (usando capacidade diária total)
    const dias = resumoFiltrado.capacidadeDiaria > 0 ? acum / resumoFiltrado.capacidadeDiaria : 0;

    return { minutos: acum, dias };
  }, [resumoFiltrado, mostrarMA, mostrarPX, mostrarUL, mostrarQT, mostrarQU, mostrarSX]);

  // Agregar referências de todos os grupos para visão por referência
  const referenciasAgregadas = useMemo(() => {
    const mapa = new Map<string, ReferenciaAgregada>();

    // Calcular o saldo acumulado de cada grupo baseado no horizonte
    const calcularSaldoAcumGrupo = (g: GrupoRow): number => {
      let saldo = 0;
      if (mostrarMA) saldo += g.saldoMA;
      if (mostrarPX) saldo += g.saldoPX;
      if (mostrarUL) saldo += g.saldoUL;
      if (mostrarQT) saldo += g.saldoQT;
      if (mostrarQU) saldo += g.saldoQU;
      if (mostrarSX) saldo += g.saldoSX;
      return saldo;
    };

    const calcularCargaAcumRef = (ref: ReferenciaRow): number => {
      let carga = 0;
      if (mostrarMA) carga += ref.cargaMA;
      if (mostrarPX) carga += ref.cargaPX;
      if (mostrarUL) carga += ref.cargaUL;
      if (mostrarQT) carga += ref.cargaQT;
      if (mostrarQU) carga += ref.cargaQU;
      if (mostrarSX) carga += ref.cargaSX;
      return carga;
    };

    for (const grupo of gruposFiltrados) {
      const saldoAcumGrupo = calcularSaldoAcumGrupo(grupo);
      const grupoEstourado = saldoAcumGrupo < 0;

      for (const ref of grupo.referencias) {
        const key = ref.referencia;
        const existing = mapa.get(key);
        const cargaAcumRef = calcularCargaAcumRef(ref);

        if (existing) {
          // Adiciona este grupo à lista
          existing.grupos.push({
            grupo: grupo.grupo,
            rateio: ref.rateio,
            capacidadeDiaria: grupo.capacidadeDiaria,
            saldoAcum: saldoAcumGrupo,
            cargaAcum: cargaAcumRef,
            estourado: grupoEstourado,
          });
          existing.totalGrupos = existing.grupos.length;
          existing.gruposComFolga = existing.grupos.filter(g => !g.estourado).length;
          existing.gruposEstourados = existing.grupos.filter(g => g.estourado).length;
          // Soma os valores (já vem rateados do backend)
          existing.planoMA += ref.planoMA;
          existing.planoPX += ref.planoPX;
          existing.planoUL += ref.planoUL;
          existing.planoQT += ref.planoQT;
          existing.planoQU += ref.planoQU;
          existing.planoSX += ref.planoSX;
          existing.cargaMA += ref.cargaMA;
          existing.cargaPX += ref.cargaPX;
          existing.cargaUL += ref.cargaUL;
          existing.cargaQT += ref.cargaQT;
          existing.cargaQU += ref.cargaQU;
          existing.cargaSX += ref.cargaSX;
          existing.cargaTotal += ref.cargaTotal;
        } else {
          const grupoEstouradoFlag = grupoEstourado;
          mapa.set(key, {
            referencia: ref.referencia,
            idreferencia: ref.idreferencia,
            tempo: ref.tempo,
            grupos: [{
              grupo: grupo.grupo,
              rateio: ref.rateio,
              capacidadeDiaria: grupo.capacidadeDiaria,
              saldoAcum: saldoAcumGrupo,
              cargaAcum: cargaAcumRef,
              estourado: grupoEstourado,
            }],
            totalGrupos: 1,
            gruposComFolga: grupoEstouradoFlag ? 0 : 1,
            gruposEstourados: grupoEstouradoFlag ? 1 : 0,
            planoMA: ref.planoMA,
            planoPX: ref.planoPX,
            planoUL: ref.planoUL,
            planoQT: ref.planoQT,
            planoQU: ref.planoQU,
            planoSX: ref.planoSX,
            cargaMA: ref.cargaMA,
            cargaPX: ref.cargaPX,
            cargaUL: ref.cargaUL,
            cargaQT: ref.cargaQT,
            cargaQU: ref.cargaQU,
            cargaSX: ref.cargaSX,
            cargaTotal: ref.cargaTotal,
            diasFaltantes: 0,
            estourado: false,
          });
        }
      }
    }

    // Calcular dias faltantes baseado na capacidade total dos grupos da referência
    const resultado = Array.from(mapa.values()).map(ref => {
      const capDiariaTotal = ref.grupos.reduce((acc, g) => acc + g.capacidadeDiaria, 0);
      const cargaTotal = ref.cargaMA + ref.cargaPX + ref.cargaUL + ref.cargaQT + ref.cargaQU + ref.cargaSX;
      const diasNecessarios = capDiariaTotal > 0 ? cargaTotal / capDiariaTotal : 0;

      // Calcular capacidade disponível baseada no horizonte
      let diasDisponiveis = 0;
      if (mostrarMA) diasDisponiveis += 22; // média de dias úteis por mês
      if (mostrarPX) diasDisponiveis += 22;
      if (mostrarUL) diasDisponiveis += 22;
      if (mostrarQT) diasDisponiveis += 22;
      if (mostrarQU) diasDisponiveis += 22;
      if (mostrarSX) diasDisponiveis += 22;

      const diasFaltantes = diasNecessarios - diasDisponiveis;

      return {
        ...ref,
        diasFaltantes: Number(diasFaltantes.toFixed(2)),
        estourado: diasFaltantes > 0,
      };
    });

    // Ordenar: primeiro por maior número de grupos estourados, depois por carga total decrescente
    return resultado.sort((a, b) => {
      // Primeiro: referências com grupos estourados
      if (a.gruposEstourados !== b.gruposEstourados) return b.gruposEstourados - a.gruposEstourados;
      // Segundo: referências estouradas (dias faltantes)
      if (a.estourado !== b.estourado) return a.estourado ? -1 : 1;
      // Terceiro: por carga total decrescente
      return b.cargaTotal - a.cargaTotal;
    });
  }, [gruposFiltrados, mostrarMA, mostrarPX, mostrarUL, mostrarQT, mostrarQU, mostrarSX]);

  const referenciasFiltradas = useMemo(() => {
    return referenciasAgregadas.filter(ref => {
      if (filtroRefMultiGrupo && ref.totalGrupos <= 1) return false;
      if (filtroRefTexto && !ref.referencia.includes(filtroRefTexto.toUpperCase())) return false;
      if (filtroRefProblema && ref.gruposEstourados === 0) return false;
      return true;
    });
  }, [referenciasAgregadas, filtroRefMultiGrupo, filtroRefTexto, filtroRefProblema]);

  const planoBalanceamento = useMemo(() => {
    const saldosIniciais = new Map<string, number>();
    gruposFiltrados.forEach((g) => {
      let saldo = 0;
      if (mostrarMA) saldo += g.saldoMA;
      if (mostrarPX) saldo += g.saldoPX;
      if (mostrarUL) saldo += g.saldoUL;
      if (mostrarQT) saldo += g.saldoQT;
      if (mostrarQU) saldo += g.saldoQU;
      if (mostrarSX) saldo += g.saldoSX;
      saldosIniciais.set(g.grupo, saldo);
    });

    const saldosProjetados = new Map(saldosIniciais);
    const movimentos: MovimentoBalanceamento[] = [];
    const refsCandidatas = referenciasAgregadas
      .filter((ref) => ref.gruposEstourados > 0 && ref.gruposComFolga > 0 && ref.tempo > 0)
      .map((ref) => {
        const destinosDisponiveis = ref.grupos.filter((g) => (saldosIniciais.get(g.grupo) ?? 0) > 0).length;
        const cargaEmGargalo = ref.grupos
          .filter((g) => (saldosIniciais.get(g.grupo) ?? 0) < 0)
          .reduce((acc, g) => acc + g.cargaAcum, 0);
        return { ref, destinosDisponiveis, cargaEmGargalo };
      })
      .sort((a, b) => {
        if (a.destinosDisponiveis !== b.destinosDisponiveis) return a.destinosDisponiveis - b.destinosDisponiveis;
        if (a.ref.totalGrupos !== b.ref.totalGrupos) return a.ref.totalGrupos - b.ref.totalGrupos;
        return b.cargaEmGargalo - a.cargaEmGargalo;
      })
      .map((item) => item.ref);

    for (const ref of refsCandidatas) {
      const cargaRefAcum = ref.grupos.reduce((acc, g) => acc + g.cargaAcum, 0);
      if (cargaRefAcum <= 0) continue;

      const origens = ref.grupos
        .filter((g) => (saldosProjetados.get(g.grupo) ?? 0) < 0 && g.cargaAcum > 0)
        .sort((a, b) => (saldosProjetados.get(a.grupo) ?? 0) - (saldosProjetados.get(b.grupo) ?? 0));

      for (const origem of origens) {
        let saldoOrigem = saldosProjetados.get(origem.grupo) ?? origem.saldoAcum;
        if (saldoOrigem >= 0) continue;

        const destinos = ref.grupos
          .filter((g) => g.grupo !== origem.grupo && (saldosProjetados.get(g.grupo) ?? 0) > 0)
          .sort((a, b) => (saldosProjetados.get(b.grupo) ?? 0) - (saldosProjetados.get(a.grupo) ?? 0));

        let cargaOrigemDisponivel = origem.cargaAcum;

        for (const destino of destinos) {
          saldoOrigem = saldosProjetados.get(origem.grupo) ?? origem.saldoAcum;
          const saldoDestino = saldosProjetados.get(destino.grupo) ?? destino.saldoAcum;
          if (saldoOrigem >= 0 || saldoDestino <= 0 || cargaOrigemDisponivel <= 0) continue;

          const minutos = Math.min(Math.abs(saldoOrigem), saldoDestino, cargaOrigemDisponivel);
          if (minutos <= 0) continue;

          const saldoOrigemDepois = saldoOrigem + minutos;
          const saldoDestinoDepois = saldoDestino - minutos;

          movimentos.push({
            referencia: ref.referencia,
            origem: origem.grupo,
            destino: destino.grupo,
            tempo: ref.tempo,
            minutos,
            pecas: Math.max(1, Math.round(minutos / ref.tempo)),
            percentualRef: (minutos / cargaRefAcum) * 100,
            saldoOrigemAntes: saldoOrigem,
            saldoOrigemDepois,
            saldoDestinoAntes: saldoDestino,
            saldoDestinoDepois,
          });

          saldosProjetados.set(origem.grupo, saldoOrigemDepois);
          saldosProjetados.set(destino.grupo, saldoDestinoDepois);
          cargaOrigemDisponivel -= minutos;
        }
      }
    }

    const gruposResumo = Array.from(saldosIniciais.entries())
      .map(([grupo, saldoInicial]) => {
        const saldoProjetado = saldosProjetados.get(grupo) ?? saldoInicial;
        const minutosEntrada = movimentos
          .filter((m) => m.destino === grupo)
          .reduce((acc, m) => acc + m.minutos, 0);
        const minutosSaida = movimentos
          .filter((m) => m.origem === grupo)
          .reduce((acc, m) => acc + m.minutos, 0);
        return {
          grupo,
          saldoInicial,
          saldoProjetado,
          melhorou: saldoProjetado - saldoInicial,
          minutosEntrada,
          minutosSaida,
        };
      })
      .sort((a, b) => a.saldoProjetado - b.saldoProjetado);

    const deficitInicial = gruposResumo.reduce((acc, g) => acc + Math.max(0, -g.saldoInicial), 0);
    const deficitProjetado = gruposResumo.reduce((acc, g) => acc + Math.max(0, -g.saldoProjetado), 0);
    const minutosMovidos = movimentos.reduce((acc, m) => acc + m.minutos, 0);
    const saldoTotalInicial = gruposResumo.reduce((acc, g) => acc + g.saldoInicial, 0);
    const saldoTotalProjetado = gruposResumo.reduce((acc, g) => acc + g.saldoProjetado, 0);

    const referenciasRestritas: ReferenciaRestrita[] = referenciasAgregadas
      .map((ref) => {
        const origensNegativas = ref.grupos
          .filter((g) => (saldosProjetados.get(g.grupo) ?? 0) < 0 && g.cargaAcum > 0)
          .map((g) => g.grupo);
        const destinosDisponiveis = ref.grupos
          .filter((g) => (saldosProjetados.get(g.grupo) ?? 0) > 0 && !origensNegativas.includes(g.grupo))
          .map((g) => g.grupo);
        const cargaEmGargalo = ref.grupos
          .filter((g) => (saldosProjetados.get(g.grupo) ?? 0) < 0 && g.cargaAcum > 0)
          .reduce((acc, g) => acc + g.cargaAcum, 0);
        const folgaCompativel = ref.grupos
          .filter((g) => (saldosProjetados.get(g.grupo) ?? 0) > 0)
          .reduce((acc, g) => acc + Math.max(0, saldosProjetados.get(g.grupo) ?? 0), 0);
        const deficitRef = Math.min(cargaEmGargalo, Math.max(0, cargaEmGargalo - folgaCompativel));
        let motivo: ReferenciaRestrita['motivo'] = 'AINDA_ESTOURA';
        if (!destinosDisponiveis.length) motivo = 'SEM_DESTINO';
        else if (destinosDisponiveis.length === 1) motivo = 'UMA_OPCAO';
        else if (folgaCompativel < cargaEmGargalo) motivo = 'POUCA_FOLGA';

        return {
          referencia: ref.referencia,
          gruposTotal: ref.totalGrupos,
          origensNegativas,
          destinosDisponiveis,
          cargaEmGargalo,
          folgaCompativel,
          deficitProjetado: deficitRef,
          motivo,
        };
      })
      .filter((ref) => ref.cargaEmGargalo > 0)
      .sort((a, b) => {
        const motivoRank = (m: ReferenciaRestrita['motivo']) => (
          m === 'SEM_DESTINO' ? 0 : m === 'UMA_OPCAO' ? 1 : m === 'POUCA_FOLGA' ? 2 : 3
        );
        const rank = motivoRank(a.motivo) - motivoRank(b.motivo);
        if (rank !== 0) return rank;
        return b.cargaEmGargalo - a.cargaEmGargalo;
      });

    return {
      movimentos,
      gruposResumo,
      deficitInicial,
      deficitProjetado,
      minutosMovidos,
      saldoTotalInicial,
      saldoTotalProjetado,
      referenciasRestritas,
    };
  }, [gruposFiltrados, referenciasAgregadas, mostrarMA, mostrarPX, mostrarUL, mostrarQT, mostrarQU, mostrarSX]);

  const metaPorReferencia = useMemo(() => {
    const mapa = new Map<string, {
      corteMinRef: number;
      regraOpMin: RegraOpMinRow | null;
      skus: number;
    }>();

    for (const item of matrizBase) {
      const refPadrao = String(item?.produto?.referencia || '').trim().toUpperCase();
      const refSistema = String(item?.produto?.cd_seqgrupo || '').trim().toUpperCase();
      const idproduto = String(item?.produto?.idproduto || '').trim();
      const corte = Math.max(0, Number(cortesMinimos[idproduto] || 0));
      const regraOpMin = findRegraOpMin(
        OP_MIN_REGRAS_FIXAS,
        item?.produto?.continuidade || '',
        item?.produto?.linha || '',
        item?.produto?.grupo || ''
      );

      for (const ref of [refPadrao, refSistema]) {
        if (!ref) continue;
        const atual = mapa.get(ref) || { corteMinRef: 0, regraOpMin: null, skus: 0 };
        atual.corteMinRef = Math.max(atual.corteMinRef, corte);
        atual.regraOpMin = atual.regraOpMin || regraOpMin;
        atual.skus += 1;
        mapa.set(ref, atual);
      }
    }

    return mapa;
  }, [matrizBase, cortesMinimos]);

  const sequenciamento = useMemo(() => {
    const saldoGrupoMap = new Map(planoBalanceamento.gruposResumo.map((g) => [g.grupo, g.saldoProjetado]));
    const movimentosPorRef = new Map<string, MovimentoBalanceamento[]>();
    planoBalanceamento.movimentos.forEach((mov) => {
      const lista = movimentosPorRef.get(mov.referencia) || [];
      lista.push(mov);
      movimentosPorRef.set(mov.referencia, lista);
    });

    const rows: SequenciamentoRow[] = [];
    const periodosSequencia = HORIZONTES.slice(0, horizonteIndex + 1);

    for (const ref of referenciasAgregadas) {
      const meta = metaPorReferencia.get(ref.referencia) || metaPorReferencia.get(ref.idreferencia) || { corteMinRef: 0, regraOpMin: null, skus: 0 };
      const percentuais = new Map<string, number>();
      ref.grupos.forEach((g) => {
        percentuais.set(g.grupo, g.rateio);
      });

      const cargaRefAcum = ref.grupos.reduce((acc, g) => acc + g.cargaAcum, 0);
      (movimentosPorRef.get(ref.referencia) || []).forEach((mov) => {
        const percentualMovido = cargaRefAcum > 0 ? (mov.minutos / cargaRefAcum) * 100 : mov.percentualRef;
        percentuais.set(mov.origem, Math.max(0, (percentuais.get(mov.origem) || 0) - percentualMovido));
        percentuais.set(mov.destino, Math.min(100, (percentuais.get(mov.destino) || 0) + percentualMovido));
      });

      const somaPercentual = Array.from(percentuais.values()).reduce((acc, v) => acc + v, 0) || 100;
      const planosPorPeriodo: Record<Horizonte, number> = {
        MA: ref.planoMA,
        PX: ref.planoPX,
        UL: ref.planoUL,
        QT: ref.planoQT,
        QU: ref.planoQU,
        SX: ref.planoSX,
      };

      for (const periodo of periodosSequencia) {
        const planoReferencia = Math.max(0, Math.round(Number(planosPorPeriodo[periodo] || 0)));
        if (planoReferencia <= 0) continue;

        const opMinRef = Math.max(0, Math.round(Number(meta.regraOpMin?.op_min_ref || 0)));
        const lote = Math.max(1, Math.round(meta.corteMinRef || 1));
        const alocacoesBase = ref.grupos
          .map((grupo) => {
            const percentualGrupo = ((percentuais.get(grupo.grupo) || 0) / somaPercentual) * 100;
            const bruto = planoReferencia * (percentualGrupo / 100);
            return {
              grupo,
              percentualGrupo,
              bruto,
              qtd: Math.floor(bruto),
              resto: bruto - Math.floor(bruto),
            };
          })
          .filter((row) => row.bruto > 0);

        let restanteInteiro = planoReferencia - alocacoesBase.reduce((acc, row) => acc + row.qtd, 0);
        [...alocacoesBase]
          .sort((a, b) => b.resto - a.resto)
          .forEach((row) => {
            if (restanteInteiro <= 0) return;
            row.qtd += 1;
            restanteInteiro -= 1;
          });

        if (opMinRef > 0 && planoReferencia >= opMinRef) {
          let mudou = true;
          while (mudou) {
            mudou = false;
            const pequenas = alocacoesBase
              .filter((row) => row.qtd > 0 && row.qtd < opMinRef)
              .sort((a, b) => a.qtd - b.qtd);
            if (!pequenas.length) break;

            for (const pequena of pequenas) {
              const destino = alocacoesBase
                .filter((row) => row !== pequena && row.qtd > 0)
                .sort((a, b) => b.qtd - a.qtd)[0];
              if (!destino) continue;
              destino.qtd += pequena.qtd;
              pequena.qtd = 0;
              mudou = true;
            }
          }
        }

        for (const alocacao of alocacoesBase) {
          const grupo = alocacao.grupo;
          const qtdSugerida = Math.round(planoReferencia * (alocacao.percentualGrupo / 100));
          const qtdAjustada = alocacao.qtd;
          if (qtdAjustada <= 0) continue;
          const quebraOpMin = opMinRef > 0 && qtdAjustada < opMinRef;
          const quebraCorteRef = lote > 1 && qtdAjustada % lote !== 0;
          const status: SequenciamentoRow['status'] = quebraOpMin
            ? 'QUEBRA_OP_MIN'
            : quebraCorteRef
            ? 'VALIDAR_CORTE_SKU'
            : 'OK';

          rows.push({
            ordem: 0,
            grupo: grupo.grupo,
            referencia: ref.referencia,
            periodo,
            planoReferencia,
            percentualGrupo: alocacao.percentualGrupo,
            qtdSugerida,
            qtdAjustada,
            corteMinRef: lote,
            opMinRef,
            tempo: ref.tempo,
            cargaMinutos: qtdAjustada * ref.tempo,
            saldoGrupoProjetado: saldoGrupoMap.get(grupo.grupo) ?? grupo.saldoAcum,
            status,
          });
        }
      }
    }

    return rows
      .sort((a, b) => {
        const saldoDiff = a.saldoGrupoProjetado - b.saldoGrupoProjetado;
        if (saldoDiff !== 0) return saldoDiff;
        const periodoDiff = HORIZONTES.indexOf(a.periodo) - HORIZONTES.indexOf(b.periodo);
        if (periodoDiff !== 0) return periodoDiff;
        return b.cargaMinutos - a.cargaMinutos;
      })
      .map((row, idx) => ({ ...row, ordem: idx + 1 }));
  }, [horizonteIndex, metaPorReferencia, planoBalanceamento.gruposResumo, planoBalanceamento.movimentos, referenciasAgregadas]);

  const resumoSequenciamento = useMemo(() => {
    const refs = new Set<string>();
    const gruposSeq = new Set<string>();
    let pecas = 0;
    let cargaMinutos = 0;
    let alertasOpMin = 0;

    sequenciamento.forEach((row) => {
      refs.add(row.referencia);
      gruposSeq.add(row.grupo);
      pecas += row.qtdAjustada;
      cargaMinutos += row.cargaMinutos;
      if (row.status === 'QUEBRA_OP_MIN') alertasOpMin += 1;
    });

    return { refs: refs.size, grupos: gruposSeq.size, pecas, cargaMinutos, alertasOpMin };
  }, [sequenciamento]);

  const sequenciamentoPorReferencia = useMemo(() => {
    const capacidadeGrupo = new Map(gruposFiltrados.map((g) => [g.grupo, g.capacidadeDiaria]));
    const mapa = new Map<string, SequenciamentoReferencia>();

    for (const row of sequenciamento) {
      const atual = mapa.get(row.referencia) || {
        referencia: row.referencia,
        ordem: 0,
        grupos: [],
        totalPecas: 0,
        totalCargaMinutos: 0,
        dias: 0,
        cabe: true,
        alertasOpMin: 0,
        periodos: {
          MA: { qtd: 0, cargaMinutos: 0 },
          PX: { qtd: 0, cargaMinutos: 0 },
          UL: { qtd: 0, cargaMinutos: 0 },
          QT: { qtd: 0, cargaMinutos: 0 },
          QU: { qtd: 0, cargaMinutos: 0 },
          SX: { qtd: 0, cargaMinutos: 0 },
        },
        linhas: [],
      };

      if (!atual.grupos.includes(row.grupo)) atual.grupos.push(row.grupo);
      atual.totalPecas += row.qtdAjustada;
      atual.totalCargaMinutos += row.cargaMinutos;
      atual.alertasOpMin += row.status === 'QUEBRA_OP_MIN' ? 1 : 0;
      atual.periodos[row.periodo].qtd += row.qtdAjustada;
      atual.periodos[row.periodo].cargaMinutos += row.cargaMinutos;
      atual.linhas.push(row);
      mapa.set(row.referencia, atual);
    }

    return Array.from(mapa.values())
      .map((ref) => {
        const cargaPorGrupo = new Map<string, number>();
        ref.linhas.forEach((row) => {
          cargaPorGrupo.set(row.grupo, (cargaPorGrupo.get(row.grupo) || 0) + row.cargaMinutos);
        });
        const dias = Array.from(cargaPorGrupo.entries()).reduce((max, [grupo, carga]) => {
          const cap = Math.max(1, Number(capacidadeGrupo.get(grupo) || 0));
          return Math.max(max, carga / cap);
        }, 0);
        const cabe = ref.linhas.every((row) => row.cargaMinutos <= Math.max(0, row.saldoGrupoProjetado));
        return {
          ...ref,
          dias,
          cabe,
          linhas: [...ref.linhas].sort((a, b) => a.grupo.localeCompare(b.grupo) || HORIZONTES.indexOf(a.periodo) - HORIZONTES.indexOf(b.periodo)),
        };
      })
      .sort((a, b) => {
        if (a.cabe !== b.cabe) return a.cabe ? 1 : -1;
        return b.totalCargaMinutos - a.totalCargaMinutos;
      })
      .map((ref, idx) => ({ ...ref, ordem: idx + 1 }));
  }, [gruposFiltrados, sequenciamento]);

  // Referência selecionada para redistribuição
  const refParaRedistribuir = useMemo(() => {
    if (!refSelecionadaRedist) return null;
    return referenciasAgregadas.find(r => r.referencia === refSelecionadaRedist) || null;
  }, [refSelecionadaRedist, referenciasAgregadas]);

  // Calcular peças totais e por grupo da referência selecionada
  const dadosRedistribuicao = useMemo(() => {
    if (!refParaRedistribuir) return null;

    const tempo = refParaRedistribuir.tempo || 1;
    // Calcular peças totais baseado na carga total
    const pecasTotal = tempo > 0 ? Math.round(refParaRedistribuir.cargaTotal / tempo) : 0;

    // Calcular peças por grupo (baseado no rateio atual)
    const gruposComPecas = refParaRedistribuir.grupos.map(g => {
      const pecasAlocadas = alocacaoSimulada[g.grupo] !== undefined
        ? Math.round(pecasTotal * (alocacaoSimulada[g.grupo] / 100))
        : Math.round(pecasTotal * (g.rateio / 100));

      // Calcular folga em peças (saldo do grupo / tempo da ref)
      const folgaPecas = tempo > 0 ? Math.round(g.saldoAcum / tempo) : 0;

      return {
        ...g,
        pecasAlocadas,
        folgaPecas,
        pecasAposAlocacao: folgaPecas - pecasAlocadas,
        percentualAlocado: alocacaoSimulada[g.grupo] ?? g.rateio,
      };
    });

    const pecasAlocadasTotal = gruposComPecas.reduce((acc, g) => acc + g.pecasAlocadas, 0);
    const pecasRestantes = pecasTotal - pecasAlocadasTotal;

    return {
      referencia: refParaRedistribuir.referencia,
      tempo,
      pecasTotal,
      pecasAlocadasTotal,
      pecasRestantes,
      grupos: gruposComPecas,
    };
  }, [refParaRedistribuir, alocacaoSimulada]);

  const movimentosReferenciaSelecionada = useMemo(() => {
    if (!refSelecionadaRedist) return [];
    return planoBalanceamento.movimentos.filter((mov) => mov.referencia === refSelecionadaRedist);
  }, [planoBalanceamento.movimentos, refSelecionadaRedist]);

  // Função para iniciar redistribuição de uma referência
  function iniciarRedistribuicao(referencia: string) {
    const ref = referenciasAgregadas.find(r => r.referencia === referencia);
    if (!ref) return;

    // Inicializar alocação com os rateios atuais
    const alocacaoInicial: Record<string, number> = {};
    ref.grupos.forEach(g => {
      alocacaoInicial[g.grupo] = g.rateio;
    });

    const cargaRefAcum = ref.grupos.reduce((acc, g) => acc + g.cargaAcum, 0);
    planoBalanceamento.movimentos
      .filter((mov) => mov.referencia === referencia)
      .forEach((mov) => {
        const percentualMovido = cargaRefAcum > 0 ? (mov.minutos / cargaRefAcum) * 100 : mov.percentualRef;
        alocacaoInicial[mov.origem] = Math.max(0, (alocacaoInicial[mov.origem] || 0) - percentualMovido);
        alocacaoInicial[mov.destino] = Math.min(100, (alocacaoInicial[mov.destino] || 0) + percentualMovido);
      });

    setAlocacaoSimulada(alocacaoInicial);
    setRefSelecionadaRedist(referencia);
    setMostrarRedistribuicao(true);
  }

  // Função para ajustar alocação de um grupo
  function simularMovimentoBalanceamento(movimento: MovimentoBalanceamento) {
    const ref = referenciasAgregadas.find(r => r.referencia === movimento.referencia);
    if (!ref) return;

    const alocacao: Record<string, number> = {};
    ref.grupos.forEach(g => {
      alocacao[g.grupo] = g.rateio;
    });

    const cargaRefAcum = ref.grupos.reduce((acc, g) => acc + g.cargaAcum, 0);
    const percentualMovido = cargaRefAcum > 0 ? (movimento.minutos / cargaRefAcum) * 100 : movimento.percentualRef;
    alocacao[movimento.origem] = Math.max(0, (alocacao[movimento.origem] || 0) - percentualMovido);
    alocacao[movimento.destino] = Math.min(100, (alocacao[movimento.destino] || 0) + percentualMovido);

    setAlocacaoSimulada(alocacao);
    setRefSelecionadaRedist(movimento.referencia);
    setMostrarRedistribuicao(true);
  }

  function ajustarAlocacao(grupo: string, novoPercentual: number) {
    if (!refParaRedistribuir) return;

    // Limitar entre 0 e 100
    const percentualLimitado = Math.max(0, Math.min(100, novoPercentual));

    setAlocacaoSimulada(prev => ({
      ...prev,
      [grupo]: percentualLimitado,
    }));
  }

  // Função para resetar alocação para os valores originais
  function resetarAlocacao() {
    if (!refParaRedistribuir) return;

    const alocacaoInicial: Record<string, number> = {};
    refParaRedistribuir.grupos.forEach(g => {
      alocacaoInicial[g.grupo] = g.rateio;
    });
    setAlocacaoSimulada(alocacaoInicial);
  }

  // Função para redistribuir automaticamente
  function redistribuirAutomatico() {
    if (!refParaRedistribuir || !dadosRedistribuicao) return;

    // Estratégia: alocar proporcionalmente à folga disponível de cada grupo
    const gruposComFolga = dadosRedistribuicao.grupos.filter(g => g.folgaPecas > 0);
    const folgaTotal = gruposComFolga.reduce((acc, g) => acc + g.folgaPecas, 0);

    if (folgaTotal <= 0) {
      // Não tem folga em nenhum grupo, distribuir igualmente
      const percentualPorGrupo = 100 / refParaRedistribuir.grupos.length;
      const novaAlocacao: Record<string, number> = {};
      refParaRedistribuir.grupos.forEach(g => {
        novaAlocacao[g.grupo] = Number(percentualPorGrupo.toFixed(1));
      });
      setAlocacaoSimulada(novaAlocacao);
      return;
    }

    // Distribuir proporcionalmente à folga
    const novaAlocacao: Record<string, number> = {};
    refParaRedistribuir.grupos.forEach(g => {
      if (g.saldoAcum > 0) {
        // Grupo com folga: alocar proporcionalmente à folga
        const folgaPecas = dadosRedistribuicao.tempo > 0 ? g.saldoAcum / dadosRedistribuicao.tempo : 0;
        novaAlocacao[g.grupo] = Number(((folgaPecas / folgaTotal) * 100).toFixed(1));
      } else {
        // Grupo estourado: não alocar nada
        novaAlocacao[g.grupo] = 0;
      }
    });

    setAlocacaoSimulada(novaAlocacao);
  }

  function exportarPlanoBalanceamento() {
    const linhas = [
      [
        'ordem',
        'referencia',
        'grupo_origem',
        'grupo_destino',
        'pecas',
        'minutos',
        'tempo_min_peca',
        'percentual_ref_horizonte',
        'saldo_origem_antes',
        'saldo_origem_depois',
        'saldo_destino_antes',
        'saldo_destino_depois',
      ],
      ...planoBalanceamento.movimentos.map((mov, idx) => [
        idx + 1,
        mov.referencia,
        mov.origem,
        mov.destino,
        Math.round(mov.pecas),
        Math.round(mov.minutos),
        mov.tempo.toFixed(2).replace('.', ','),
        mov.percentualRef.toFixed(2).replace('.', ','),
        Math.round(mov.saldoOrigemAntes),
        Math.round(mov.saldoOrigemDepois),
        Math.round(mov.saldoDestinoAntes),
        Math.round(mov.saldoDestinoDepois),
      ]),
    ];

    const csv = linhas
      .map((linha) => linha.map((valor) => `"${String(valor).replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rebalanceamento-${horizonte}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function exportarSequenciamento() {
    const linhas = [
      [
        'ordem',
        'grupo',
        'referencia',
        'periodo',
        'plano_referencia',
        'percentual_grupo',
        'qtd_sugerida_rateio',
        'qtd_final_corte_op',
        'corte_min_ref',
        'op_min_ref',
        'tempo_min_peca',
        'carga_minutos',
        'saldo_grupo_projetado',
        'status',
      ],
      ...sequenciamento.map((row) => [
        row.ordem,
        row.grupo,
        row.referencia,
        row.periodo,
        row.planoReferencia,
        row.percentualGrupo.toFixed(2).replace('.', ','),
        row.qtdSugerida,
        row.qtdAjustada,
        row.corteMinRef,
        row.opMinRef || '',
        row.tempo.toFixed(2).replace('.', ','),
        Math.round(row.cargaMinutos),
        Math.round(row.saldoGrupoProjetado),
        row.status,
      ]),
    ];

    const csv = linhas
      .map((linha) => linha.map((valor) => `"${String(valor).replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sequenciamento-producao-${horizonte}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  const fmtDec = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmtPct = (n: number) => `${n.toFixed(1)}%`;
  const nomeMes = (m: number) => MESES_PT[m] || `M${m}`;

  const saldoClass = (v: number) => v < 0 ? 'text-red-700 font-semibold' : 'text-emerald-700';
  const atendClass = (v: number) => v < 100 ? 'text-red-700 font-semibold' : 'text-emerald-700';

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando matriz de capacidade...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 min-w-0 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-800">Matriz de Capacidade</h1>
              <p className="text-sm text-gray-500">Visão consolidada por grupo com detalhamento por referência</p>
            </div>
            <button
              onClick={carregar}
              className="px-4 py-2 text-sm font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-secondary transition-colors"
            >
              Atualizar
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Resumo geral */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 text-xs">
              <div className="bg-gray-50 rounded p-3">
                <div className="text-gray-500">Grupos</div>
                <div className="text-lg font-bold text-gray-800">{fmt(resumoFiltrado.grupos)}</div>
              </div>
              <div className="bg-gray-50 rounded p-3">
                <div className="text-gray-500">Referências</div>
                <div className="text-lg font-bold text-gray-800">{fmt(resumoFiltrado.refs)}</div>
              </div>
              {([
                mostrarMA && { label: nomeMes(periodos.MA), carga: resumoFiltrado.cargaMA, cap: resumoFiltrado.capacidadeMA },
                mostrarPX && { label: nomeMes(periodos.PX), carga: resumoFiltrado.cargaPX, cap: resumoFiltrado.capacidadePX },
                mostrarUL && { label: nomeMes(periodos.UL), carga: resumoFiltrado.cargaUL, cap: resumoFiltrado.capacidadeUL },
                mostrarQT && { label: nomeMes(periodos.QT), carga: resumoFiltrado.cargaQT, cap: resumoFiltrado.capacidadeQT },
                mostrarQU && { label: nomeMes(periodos.QU), carga: resumoFiltrado.cargaQU, cap: resumoFiltrado.capacidadeQU },
                mostrarSX && { label: nomeMes(periodos.SX), carga: resumoFiltrado.cargaSX, cap: resumoFiltrado.capacidadeSX },
              ].filter(Boolean) as { label: string; carga: number; cap: number }[]).map((m) => (
                <div key={m.label} className={`rounded p-3 ${m.cap - m.carga < 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
                  <div className="text-gray-500">{m.label}</div>
                  <div className={`text-sm font-bold ${m.cap - m.carga < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {fmt(m.cap - m.carga)}
                  </div>
                  <div className="text-[10px] text-gray-400">Cap: {fmt(m.cap)} | Carga: {fmt(m.carga)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Filtros */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap items-center gap-4">
            <label className="text-xs text-gray-600">
              Grupo
              <input
                type="text"
                value={filtroGrupo}
                onChange={(e) => setFiltroGrupo(e.target.value)}
                placeholder="Filtrar..."
                className="ml-2 border border-gray-300 rounded px-2 py-1 text-xs w-32"
              />
            </label>
            <label className="text-xs text-gray-600">
              Tipo
              <select
                value={filtroTipo}
                onChange={(e) => setFiltroTipo(e.target.value)}
                className="ml-2 border border-gray-300 rounded px-2 py-1 text-xs"
              >
                <option value="TODOS">Todos</option>
                {tipos.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-600 flex items-center gap-2">
              <input
                type="checkbox"
                checked={somenteEstourados}
                onChange={(e) => setSomenteEstourados(e.target.checked)}
                className="rounded"
              />
              Somente estourados
            </label>
            <label className="text-xs text-gray-600">
              Horizonte
              <select
                value={horizonte}
                onChange={(e) => setHorizonte(e.target.value as Horizonte)}
                className="ml-2 border border-gray-300 rounded px-2 py-1 text-xs bg-blue-50 font-semibold"
              >
                <option value="MA">Até {nomeMes(periodos.MA)} (1 mês)</option>
                <option value="PX">Até {nomeMes(periodos.PX)} (2 meses)</option>
                <option value="UL">Até {nomeMes(periodos.UL)} (3 meses)</option>
                <option value="QT">Até {nomeMes(periodos.QT)} (4 meses)</option>
                <option value="QU">Até {nomeMes(periodos.QU)} (5 meses)</option>
                <option value="SX">Até {nomeMes(periodos.SX)} (6 meses)</option>
              </select>
            </label>
            <div className="ml-auto flex gap-2">
              <button onClick={expandirTodos} className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50">
                Expandir todos
              </button>
              <button onClick={recolherTodos} className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50">
                Recolher todos
              </button>
            </div>
          </div>

          {/* Tabela com accordion */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-100 sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-3 py-2 w-8"></th>
                    <th className="text-left px-3 py-2">Grupo</th>
                    <th className="text-left px-3 py-2">Tipo</th>
                    <th className="text-right px-3 py-2">Refs</th>
                    <th className="text-right px-3 py-2">Cap/dia</th>
                    {mostrarMA && <th className="text-right px-3 py-2 bg-blue-50">Carga {nomeMes(periodos.MA)}</th>}
                    {mostrarMA && <th className="text-right px-3 py-2 bg-blue-50">Cap {nomeMes(periodos.MA)}</th>}
                    {mostrarMA && <th className="text-right px-3 py-2 bg-blue-50">Saldo {nomeMes(periodos.MA)}</th>}
                    {mostrarPX && <th className="text-right px-3 py-2 bg-green-50">Carga {nomeMes(periodos.PX)}</th>}
                    {mostrarPX && <th className="text-right px-3 py-2 bg-green-50">Cap {nomeMes(periodos.PX)}</th>}
                    {mostrarPX && <th className="text-right px-3 py-2 bg-green-50">Saldo Acum</th>}
                    {mostrarUL && <th className="text-right px-3 py-2 bg-yellow-50">Carga {nomeMes(periodos.UL)}</th>}
                    {mostrarUL && <th className="text-right px-3 py-2 bg-yellow-50">Cap {nomeMes(periodos.UL)}</th>}
                    {mostrarUL && <th className="text-right px-3 py-2 bg-yellow-50">Saldo Acum</th>}
                    {mostrarQT && <th className="text-right px-3 py-2 bg-orange-50">Carga {nomeMes(periodos.QT)}</th>}
                    {mostrarQT && <th className="text-right px-3 py-2 bg-orange-50">Cap {nomeMes(periodos.QT)}</th>}
                    {mostrarQT && <th className="text-right px-3 py-2 bg-orange-50">Saldo Acum</th>}
                    {mostrarQU && <th className="text-right px-3 py-2 bg-red-50">Carga {nomeMes(periodos.QU)}</th>}
                    {mostrarQU && <th className="text-right px-3 py-2 bg-red-50">Cap {nomeMes(periodos.QU)}</th>}
                    {mostrarQU && <th className="text-right px-3 py-2 bg-red-50">Saldo Acum</th>}
                    {mostrarSX && <th className="text-right px-3 py-2 bg-purple-50">Carga {nomeMes(periodos.SX)}</th>}
                    {mostrarSX && <th className="text-right px-3 py-2 bg-purple-50">Cap {nomeMes(periodos.SX)}</th>}
                    {mostrarSX && <th className="text-right px-3 py-2 bg-purple-50">Saldo Acum</th>}
                  </tr>
                </thead>
                <tbody>
                  {gruposFiltrados.map((g) => (
                    <>
                      {/* Linha do grupo (pai) */}
                      <tr
                        key={g.grupo}
                        className={`cursor-pointer hover:bg-blue-100 border-t-2 border-gray-300 font-semibold ${
                          g.estourado ? 'bg-red-100' : 'bg-slate-200'
                        }`}
                        onClick={() => toggleExpandir(g.grupo)}
                      >
                        <td className="px-3 py-2.5 text-center">
                          <span className={`transition-transform inline-block text-lg ${expandidos.has(g.grupo) ? 'rotate-90' : ''}`}>
                            {expandidos.has(g.grupo) ? '▼' : '▶'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-900 text-sm">{g.grupo}</td>
                        <td className="px-3 py-2.5 text-gray-700">{g.tipo}</td>
                        <td className="px-3 py-2.5 text-right">{g.refs}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{fmt(g.capacidadeDiaria)}</td>
                        {mostrarMA && <td className="px-3 py-2.5 text-right font-mono bg-blue-100">{fmt(g.cargaMA)}</td>}
                        {mostrarMA && <td className="px-3 py-2.5 text-right font-mono bg-blue-100">{fmt(g.capacidadeMA)}</td>}
                        {mostrarMA && <td className={`px-3 py-2.5 text-right font-mono bg-blue-200 ${saldoClass(g.saldoAcumMA)}`}>{fmt(g.saldoAcumMA)}</td>}
                        {mostrarPX && <td className="px-3 py-2.5 text-right font-mono bg-green-100">{fmt(g.cargaPX)}</td>}
                        {mostrarPX && <td className="px-3 py-2.5 text-right font-mono bg-green-100">{fmt(g.capacidadePX)}</td>}
                        {mostrarPX && <td className={`px-3 py-2.5 text-right font-mono bg-green-200 ${saldoClass(g.saldoAcumPX)}`}>{fmt(g.saldoAcumPX)}</td>}
                        {mostrarUL && <td className="px-3 py-2.5 text-right font-mono bg-yellow-100">{fmt(g.cargaUL)}</td>}
                        {mostrarUL && <td className="px-3 py-2.5 text-right font-mono bg-yellow-100">{fmt(g.capacidadeUL)}</td>}
                        {mostrarUL && <td className={`px-3 py-2.5 text-right font-mono bg-yellow-200 ${saldoClass(g.saldoAcumUL)}`}>{fmt(g.saldoAcumUL)}</td>}
                        {mostrarQT && <td className="px-3 py-2.5 text-right font-mono bg-orange-100">{fmt(g.cargaQT)}</td>}
                        {mostrarQT && <td className="px-3 py-2.5 text-right font-mono bg-orange-100">{fmt(g.capacidadeQT)}</td>}
                        {mostrarQT && <td className={`px-3 py-2.5 text-right font-mono bg-orange-200 ${saldoClass(g.saldoAcumQT)}`}>{fmt(g.saldoAcumQT)}</td>}
                        {mostrarQU && <td className="px-3 py-2.5 text-right font-mono bg-red-100">{fmt(g.cargaQU)}</td>}
                        {mostrarQU && <td className="px-3 py-2.5 text-right font-mono bg-red-100">{fmt(g.capacidadeQU)}</td>}
                        {mostrarQU && <td className={`px-3 py-2.5 text-right font-mono bg-red-200 ${saldoClass(g.saldoAcumQU)}`}>{fmt(g.saldoAcumQU)}</td>}
                        {mostrarSX && <td className="px-3 py-2.5 text-right font-mono bg-purple-100">{fmt(g.cargaSX)}</td>}
                        {mostrarSX && <td className="px-3 py-2.5 text-right font-mono bg-purple-100">{fmt(g.capacidadeSX)}</td>}
                        {mostrarSX && <td className={`px-3 py-2.5 text-right font-mono bg-purple-200 ${saldoClass(g.saldoAcumSX)}`}>{fmt(g.saldoAcumSX)}</td>}
                      </tr>
                      {/* Linhas das referências (filhas) */}
                      {expandidos.has(g.grupo) && g.referencias.map((r, rIdx) => (
                        <tr key={`${g.grupo}-${r.referencia}`} className={`border-l-4 border-l-slate-400 ${rIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                          <td className="px-3 py-1.5"></td>
                          <td className="px-3 py-1.5 pl-10 text-gray-700 font-mono">{r.referencia}</td>
                          <td className="px-3 py-1.5 text-gray-400 text-[11px]">{r.idreferencia}</td>
                          <td className="px-3 py-1.5 text-right text-gray-500">{r.rateio}%</td>
                          <td className="px-3 py-1.5 text-right font-mono text-gray-600">{fmtDec(r.tempo)}</td>
                          {mostrarMA && <td className="px-3 py-1.5 text-right font-mono text-gray-700 bg-blue-50">{fmt(r.cargaMA)}</td>}
                          {mostrarMA && <td className="px-3 py-1.5 text-right font-mono text-gray-500 bg-blue-50">{fmt(r.planoMA)}</td>}
                          {mostrarMA && <td className="px-3 py-1.5 bg-blue-50/50"></td>}
                          {mostrarPX && <td className="px-3 py-1.5 text-right font-mono text-gray-700 bg-green-50">{fmt(r.cargaPX)}</td>}
                          {mostrarPX && <td className="px-3 py-1.5 text-right font-mono text-gray-500 bg-green-50">{fmt(r.planoPX)}</td>}
                          {mostrarPX && <td className="px-3 py-1.5 bg-green-50/50"></td>}
                          {mostrarUL && <td className="px-3 py-1.5 text-right font-mono text-gray-700 bg-yellow-50">{fmt(r.cargaUL)}</td>}
                          {mostrarUL && <td className="px-3 py-1.5 text-right font-mono text-gray-500 bg-yellow-50">{fmt(r.planoUL)}</td>}
                          {mostrarUL && <td className="px-3 py-1.5 bg-yellow-50/50"></td>}
                          {mostrarQT && <td className="px-3 py-1.5 text-right font-mono text-gray-700 bg-orange-50">{fmt(r.cargaQT)}</td>}
                          {mostrarQT && <td className="px-3 py-1.5 text-right font-mono text-gray-500 bg-orange-50">{fmt(r.planoQT)}</td>}
                          {mostrarQT && <td className="px-3 py-1.5 bg-orange-50/50"></td>}
                          {mostrarQU && <td className="px-3 py-1.5 text-right font-mono text-gray-700 bg-red-50">{fmt(r.cargaQU)}</td>}
                          {mostrarQU && <td className="px-3 py-1.5 text-right font-mono text-gray-500 bg-red-50">{fmt(r.planoQU)}</td>}
                          {mostrarQU && <td className="px-3 py-1.5 bg-red-50/50"></td>}
                          {mostrarSX && <td className="px-3 py-1.5 text-right font-mono text-gray-700 bg-purple-50">{fmt(r.cargaSX)}</td>}
                          {mostrarSX && <td className="px-3 py-1.5 text-right font-mono text-gray-500 bg-purple-50">{fmt(r.planoSX)}</td>}
                          {mostrarSX && <td className="px-3 py-1.5 bg-purple-50/50"></td>}
                        </tr>
                      ))}
                    </>
                  ))}
                  {gruposFiltrados.length === 0 && (
                    <tr>
                      <td colSpan={5 + (horizonteIndex + 1) * 3} className="px-4 py-8 text-center text-gray-500">
                        Nenhum grupo encontrado com os filtros aplicados.
                      </td>
                    </tr>
                  )}
                </tbody>
                {gruposFiltrados.length > 0 && (
                  <tfoot className="bg-sky-100 border-t-2 border-sky-300 sticky bottom-0">
                    <tr className="font-semibold text-gray-800">
                      <td className="px-3 py-2"></td>
                      <td className="px-3 py-2" colSpan={2}>Total ({resumoFiltrado.grupos} grupos)</td>
                      <td className="px-3 py-2 text-right">{fmt(resumoFiltrado.refs)}</td>
                      <td className="px-3 py-2"></td>
                      {mostrarMA && <td className="px-3 py-2 text-right font-mono bg-blue-100">{fmt(resumoFiltrado.cargaMA)}</td>}
                      {mostrarMA && <td className="px-3 py-2 text-right font-mono bg-blue-100">{fmt(resumoFiltrado.capacidadeMA)}</td>}
                      {mostrarMA && <td className={`px-3 py-2 text-right font-mono bg-blue-100 ${saldoClass(resumoFiltrado.capacidadeMA - resumoFiltrado.cargaMA)}`}>
                        {fmt(resumoFiltrado.capacidadeMA - resumoFiltrado.cargaMA)}
                      </td>}
                      {mostrarPX && <td className="px-3 py-2 text-right font-mono bg-green-100">{fmt(resumoFiltrado.cargaPX)}</td>}
                      {mostrarPX && <td className="px-3 py-2 text-right font-mono bg-green-100">{fmt(resumoFiltrado.capacidadePX)}</td>}
                      {mostrarPX && <td className={`px-3 py-2 text-right font-mono bg-green-100 ${saldoClass(
                        (resumoFiltrado.capacidadeMA - resumoFiltrado.cargaMA) + (resumoFiltrado.capacidadePX - resumoFiltrado.cargaPX)
                      )}`}>
                        {fmt((resumoFiltrado.capacidadeMA - resumoFiltrado.cargaMA) + (resumoFiltrado.capacidadePX - resumoFiltrado.cargaPX))}
                      </td>}
                      {mostrarUL && <td className="px-3 py-2 text-right font-mono bg-yellow-100">{fmt(resumoFiltrado.cargaUL)}</td>}
                      {mostrarUL && <td className="px-3 py-2 text-right font-mono bg-yellow-100">{fmt(resumoFiltrado.capacidadeUL)}</td>}
                      {mostrarUL && <td className="px-3 py-2 bg-yellow-100"></td>}
                      {mostrarQT && <td className="px-3 py-2 text-right font-mono bg-orange-100">{fmt(resumoFiltrado.cargaQT)}</td>}
                      {mostrarQT && <td className="px-3 py-2 text-right font-mono bg-orange-100">{fmt(resumoFiltrado.capacidadeQT)}</td>}
                      {mostrarQT && <td className="px-3 py-2 bg-orange-100"></td>}
                      {mostrarQU && <td className="px-3 py-2 text-right font-mono bg-red-100">{fmt(resumoFiltrado.cargaQU)}</td>}
                      {mostrarQU && <td className="px-3 py-2 text-right font-mono bg-red-100">{fmt(resumoFiltrado.capacidadeQU)}</td>}
                      {mostrarQU && <td className="px-3 py-2 bg-red-100"></td>}
                      {mostrarSX && <td className="px-3 py-2 text-right font-mono bg-purple-100">{fmt(resumoFiltrado.cargaSX)}</td>}
                      {mostrarSX && <td className="px-3 py-2 text-right font-mono bg-purple-100">{fmt(resumoFiltrado.capacidadeSX)}</td>}
                      {mostrarSX && <td className="px-3 py-2 bg-purple-100"></td>}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Resumo Saldo Acumulado Total */}
          <div className={`rounded-lg border-2 p-4 ${saldoAcumTotal.minutos < 0 ? 'bg-red-50 border-red-300' : 'bg-emerald-50 border-emerald-300'}`}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-700">
                Saldo Acumulado Total (até {nomeMes(periodos[horizonte as keyof Periodos])})
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <div className="text-[11px] text-gray-500 uppercase">Minutos</div>
                  <div className={`text-xl font-bold font-mono ${saldoAcumTotal.minutos < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {fmt(Math.round(saldoAcumTotal.minutos))}
                  </div>
                </div>
                <div className="text-2xl text-gray-300">=</div>
                <div className="text-right">
                  <div className="text-[11px] text-gray-500 uppercase">Dias</div>
                  <div className={`text-xl font-bold font-mono ${saldoAcumTotal.dias < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {saldoAcumTotal.dias.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                  </div>
                </div>
                <div className="text-xs text-gray-500 ml-2">
                  (Cap. diária: {fmt(resumoFiltrado.capacidadeDiaria)} min)
                </div>
              </div>
            </div>
            <div className="text-[11px] text-gray-500 mt-2">
              {saldoAcumTotal.minutos < 0
                ? `Capacidade insuficiente: faltam ${Math.abs(saldoAcumTotal.dias).toFixed(1)} dias de produção para atender a demanda até ${nomeMes(periodos[horizonte as keyof Periodos])}.`
                : `Capacidade disponível: sobram ${saldoAcumTotal.dias.toFixed(1)} dias de produção após atender toda a demanda até ${nomeMes(periodos[horizonte as keyof Periodos])}.`
              }
            </div>
          </div>

          {/* Esquema sugerido de balanceamento */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 bg-sky-50">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-sky-900">Esquema sugerido de balanceamento</div>
                  <div className="text-xs text-sky-700 mt-1">
                    Movimentos calculados no conjunto, tirando carga de grupos estourados e usando folga de grupos que ja fazem a mesma referencia.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={exportarPlanoBalanceamento}
                    disabled={planoBalanceamento.movimentos.length === 0}
                    className="px-3 py-1.5 text-xs font-semibold bg-white text-sky-800 border border-sky-200 rounded hover:bg-sky-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Exportar guia ERP
                  </button>
                  <div className={`px-3 py-1.5 rounded text-xs font-semibold ${
                    planoBalanceamento.deficitProjetado <= 0
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      : planoBalanceamento.minutosMovidos > 0
                      ? 'bg-amber-100 text-amber-800 border border-amber-200'
                      : 'bg-red-100 text-red-800 border border-red-200'
                  }`}>
                    {planoBalanceamento.deficitProjetado <= 0
                      ? 'SAUDAVEL'
                      : planoBalanceamento.minutosMovidos > 0
                      ? 'MELHORA PARCIAL'
                      : 'SEM TROCA VIAVEL'}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="bg-red-50 border border-red-100 rounded p-3">
                  <div className="text-gray-500 uppercase">Deficit inicial</div>
                  <div className="text-xl font-bold font-mono text-red-700">{fmt(Math.round(planoBalanceamento.deficitInicial))}</div>
                  <div className="text-[10px] text-gray-400">minutos em grupos negativos</div>
                </div>
                <div className="bg-sky-50 border border-sky-100 rounded p-3">
                  <div className="text-gray-500 uppercase">Carga realocada</div>
                  <div className="text-xl font-bold font-mono text-sky-800">{fmt(Math.round(planoBalanceamento.minutosMovidos))}</div>
                  <div className="text-[10px] text-gray-400">{fmt(planoBalanceamento.movimentos.reduce((acc, m) => acc + m.pecas, 0))} pecas sugeridas</div>
                </div>
                <div className="bg-emerald-50 border border-emerald-100 rounded p-3">
                  <div className="text-gray-500 uppercase">Deficit depois</div>
                  <div className="text-xl font-bold font-mono text-emerald-700">{fmt(Math.round(planoBalanceamento.deficitProjetado))}</div>
                  <div className="text-[10px] text-gray-400">saldo projetado apos sugestoes</div>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded p-3">
                  <div className="text-gray-500 uppercase">Movimentos</div>
                  <div className="text-xl font-bold font-mono text-gray-800">{fmt(planoBalanceamento.movimentos.length)}</div>
                  <div className="text-[10px] text-gray-400">trocas entre grupos</div>
                </div>
              </div>

              <div className={`rounded-lg border px-4 py-3 text-sm ${
                planoBalanceamento.saldoTotalProjetado >= 0
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="font-semibold">
                    {planoBalanceamento.saldoTotalProjetado >= 0
                      ? 'No geral cabe no horizonte selecionado.'
                      : `No geral ainda nao cabe: faltam ${fmt(Math.round(Math.abs(planoBalanceamento.saldoTotalProjetado)))} min (${fmtDec(Math.abs(planoBalanceamento.saldoTotalProjetado) / Math.max(1, resumoFiltrado.capacidadeDiaria))} dias).`}
                  </div>
                  <div className="text-xs font-mono">
                    Saldo geral: {fmt(Math.round(planoBalanceamento.saldoTotalInicial))} -&gt; {fmt(Math.round(planoBalanceamento.saldoTotalProjetado))}
                  </div>
                </div>
              </div>

              <div className="border border-amber-200 rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs font-semibold text-amber-900">
                  Referencias com poucas opcoes ou ainda sem encaixe
                </div>
                <div className="max-h-72 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-left">Referencia</th>
                        <th className="px-2 py-2 text-left">Origem negativa</th>
                        <th className="px-2 py-2 text-left">Destinos possiveis</th>
                        <th className="px-2 py-2 text-right">Carga no gargalo</th>
                        <th className="px-2 py-2 text-right">Folga compativel</th>
                        <th className="px-2 py-2 text-right">Deficit ref</th>
                        <th className="px-2 py-2 text-center">Motivo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {planoBalanceamento.referenciasRestritas.slice(0, 80).map((ref) => (
                        <tr key={ref.referencia} className="hover:bg-amber-50/60">
                          <td className="px-2 py-1.5 font-mono font-semibold text-gray-800">{ref.referencia}</td>
                          <td className="px-2 py-1.5 text-red-800">{ref.origensNegativas.join(', ') || '-'}</td>
                          <td className="px-2 py-1.5 text-emerald-800">{ref.destinosDisponiveis.join(', ') || '-'}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{fmt(Math.round(ref.cargaEmGargalo))}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{fmt(Math.round(ref.folgaCompativel))}</td>
                          <td className={`px-2 py-1.5 text-right font-mono ${ref.deficitProjetado > 0 ? 'text-red-700 font-semibold' : 'text-emerald-700'}`}>
                            {fmt(Math.round(ref.deficitProjetado))}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              ref.motivo === 'SEM_DESTINO'
                                ? 'bg-red-200 text-red-900'
                                : ref.motivo === 'UMA_OPCAO'
                                ? 'bg-amber-200 text-amber-900'
                                : 'bg-orange-100 text-orange-800'
                            }`}>
                              {ref.motivo === 'SEM_DESTINO'
                                ? 'SEM DESTINO'
                                : ref.motivo === 'UMA_OPCAO'
                                ? '1 OPCAO'
                                : ref.motivo === 'POUCA_FOLGA'
                                ? 'POUCA FOLGA'
                                : 'AINDA ESTOURA'}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {planoBalanceamento.referenciasRestritas.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                            Nenhuma referencia restrita depois do rebalanceamento sugerido.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {planoBalanceamento.referenciasRestritas.length > 80 && (
                  <div className="px-4 py-2 border-t border-amber-100 text-xs text-gray-500 text-center">
                    Mostrando 80 de {planoBalanceamento.referenciasRestritas.length} referencias restritas.
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div className="xl:col-span-2 border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700">
                    Fila de realocacao sugerida
                  </div>
                  {planoBalanceamento.movimentos.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-gray-500">
                      Nao foi encontrada folga compativel nas referencias multi-grupo dentro dos filtros atuais.
                    </div>
                  ) : (
                    <div className="max-h-80 overflow-auto divide-y divide-gray-100">
                      {planoBalanceamento.movimentos.slice(0, 40).map((mov, idx) => (
                        <div key={`${mov.referencia}-${mov.origem}-${mov.destino}-${idx}`} className="px-4 py-3 flex flex-wrap items-center gap-3 text-xs">
                          <div className="w-7 h-7 rounded bg-sky-100 text-sky-800 flex items-center justify-center font-bold">{idx + 1}</div>
                          <div className="min-w-0 flex-1">
                            <div className="font-mono font-semibold text-gray-800 truncate">{mov.referencia}</div>
                            <div className="text-gray-500">
                              {fmt(mov.pecas)} pecas | {fmt(Math.round(mov.minutos))} min | {fmtPct(mov.percentualRef)} da carga no horizonte
                            </div>
                          </div>
                          <div className="flex items-center gap-2 font-mono">
                            <span className="px-2 py-1 rounded bg-red-100 text-red-800 border border-red-200">{mov.origem}</span>
                            <span className="text-gray-400">-&gt;</span>
                            <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">{mov.destino}</span>
                          </div>
                          <div className="hidden lg:grid grid-cols-2 gap-2 text-right font-mono">
                            <div>
                              <div className="text-[10px] text-gray-400">Origem</div>
                              <div className={saldoClass(mov.saldoOrigemDepois)}>{fmt(Math.round(mov.saldoOrigemAntes))} -&gt; {fmt(Math.round(mov.saldoOrigemDepois))}</div>
                            </div>
                            <div>
                              <div className="text-[10px] text-gray-400">Destino</div>
                              <div className={saldoClass(mov.saldoDestinoDepois)}>{fmt(Math.round(mov.saldoDestinoAntes))} -&gt; {fmt(Math.round(mov.saldoDestinoDepois))}</div>
                            </div>
                          </div>
                          <button
                            onClick={() => simularMovimentoBalanceamento(mov)}
                            className="px-3 py-1.5 text-xs font-semibold bg-sky-700 text-white rounded hover:bg-sky-800 transition-colors"
                          >
                            Simular troca
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700">
                    Matriz por grupo apos sugestao
                  </div>
                  <div className="max-h-80 overflow-auto">
                    <table className="w-full text-[11px]">
                      <thead className="bg-gray-100 sticky top-0">
                        <tr>
                          <th className="px-2 py-1.5 text-left">Grupo</th>
                          <th className="px-2 py-1.5 text-right">Antes</th>
                          <th className="px-2 py-1.5 text-right">Sai</th>
                          <th className="px-2 py-1.5 text-right">Entra</th>
                          <th className="px-2 py-1.5 text-right">Depois</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {planoBalanceamento.gruposResumo.slice(0, 40).map((g) => (
                          <tr key={g.grupo} className={g.saldoProjetado < 0 ? 'bg-red-50/60' : 'bg-emerald-50/40'}>
                            <td className="px-2 py-1.5 font-semibold text-gray-800">{g.grupo}</td>
                            <td className={`px-2 py-1.5 text-right font-mono ${saldoClass(g.saldoInicial)}`}>{fmt(Math.round(g.saldoInicial))}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-red-700">{g.minutosSaida > 0 ? fmt(Math.round(g.minutosSaida)) : '-'}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-emerald-700">{g.minutosEntrada > 0 ? fmt(Math.round(g.minutosEntrada)) : '-'}</td>
                            <td className={`px-2 py-1.5 text-right font-mono ${saldoClass(g.saldoProjetado)}`}>{fmt(Math.round(g.saldoProjetado))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {planoBalanceamento.movimentos.length > 40 && (
                <div className="text-xs text-gray-500 text-center">
                  Mostrando 40 de {planoBalanceamento.movimentos.length} movimentos sugeridos.
                </div>
              )}
            </div>
          </div>

          {/* Sequenciamento sugerido */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 bg-emerald-50">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-emerald-900">Sequenciamento por referencia</div>
                  <div className="text-xs text-emerald-700 mt-1">
                    Referencia como matriz pai; os grupos aparecem no segundo nivel com plano, previsao em dias e capacidade.
                  </div>
                </div>
                <button
                  onClick={exportarSequenciamento}
                  disabled={sequenciamento.length === 0}
                  className="px-3 py-1.5 text-xs font-semibold bg-white text-emerald-800 border border-emerald-200 rounded hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Exportar sequenciamento
                </button>
              </div>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                <div className="bg-gray-50 border border-gray-100 rounded p-3">
                  <div className="text-gray-500 uppercase">Linhas</div>
                  <div className="text-xl font-bold font-mono text-gray-800">{fmt(sequenciamento.length)}</div>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded p-3">
                  <div className="text-gray-500 uppercase">Refs</div>
                  <div className="text-xl font-bold font-mono text-gray-800">{fmt(resumoSequenciamento.refs)}</div>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded p-3">
                  <div className="text-gray-500 uppercase">Grupos</div>
                  <div className="text-xl font-bold font-mono text-gray-800">{fmt(resumoSequenciamento.grupos)}</div>
                </div>
                <div className="bg-emerald-50 border border-emerald-100 rounded p-3">
                  <div className="text-gray-500 uppercase">Pecas finais</div>
                  <div className="text-xl font-bold font-mono text-emerald-800">{fmt(resumoSequenciamento.pecas)}</div>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded p-3">
                  <div className="text-gray-500 uppercase">Quebras OP min</div>
                  <div className="text-xl font-bold font-mono text-amber-800">{fmt(resumoSequenciamento.alertasOpMin)}</div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-gray-200 max-h-[560px]">
                <table className="w-full text-xs">
                  <thead className="bg-gray-100 sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 text-right">Ordem</th>
                      <th className="px-2 py-2 text-left">Referencia</th>
                      <th className="px-2 py-2 text-left">Grupo produtor</th>
                      {mostrarMA && <th className="px-2 py-2 text-right bg-blue-50">{nomeMes(periodos.MA)}</th>}
                      {mostrarPX && <th className="px-2 py-2 text-right bg-green-50">{nomeMes(periodos.PX)}</th>}
                      {mostrarUL && <th className="px-2 py-2 text-right bg-yellow-50">{nomeMes(periodos.UL)}</th>}
                      {mostrarQT && <th className="px-2 py-2 text-right bg-orange-50">{nomeMes(periodos.QT)}</th>}
                      {mostrarQU && <th className="px-2 py-2 text-right bg-red-50">{nomeMes(periodos.QU)}</th>}
                      {mostrarSX && <th className="px-2 py-2 text-right bg-purple-50">{nomeMes(periodos.SX)}</th>}
                      <th className="px-2 py-2 text-right">Total</th>
                      <th className="px-2 py-2 text-right">Dias</th>
                      <th className="px-2 py-2 text-center">Cabe?</th>
                      <th className="px-2 py-2 text-right">Corte/OP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sequenciamentoPorReferencia.slice(0, 180).flatMap((ref) => {
                      const linhasPorGrupo = Array.from(
                        ref.linhas.reduce((mapa, row) => {
                          const atual = mapa.get(row.grupo) || {
                            grupo: row.grupo,
                            totalPecas: 0,
                            cargaMinutos: 0,
                            corteMinRef: row.corteMinRef,
                            opMinRef: row.opMinRef,
                            saldoGrupoProjetado: row.saldoGrupoProjetado,
                            periodos: {
                              MA: 0, PX: 0, UL: 0, QT: 0, QU: 0, SX: 0,
                            } as Record<Horizonte, number>,
                            alertas: 0,
                          };
                          atual.totalPecas += row.qtdAjustada;
                          atual.cargaMinutos += row.cargaMinutos;
                          atual.periodos[row.periodo] += row.qtdAjustada;
                          atual.alertas += row.status === 'QUEBRA_OP_MIN' ? 1 : 0;
                          mapa.set(row.grupo, atual);
                          return mapa;
                        }, new Map<string, {
                          grupo: string;
                          totalPecas: number;
                          cargaMinutos: number;
                          corteMinRef: number;
                          opMinRef: number;
                          saldoGrupoProjetado: number;
                          periodos: Record<Horizonte, number>;
                          alertas: number;
                        }>())
                      .values()).sort((a, b) => b.cargaMinutos - a.cargaMinutos);

                      const pai = (
                        <tr key={`ref-${ref.referencia}`} className={ref.cabe ? 'bg-emerald-50/70 border-t border-emerald-200' : 'bg-red-50/80 border-t border-red-200'}>
                          <td className="px-2 py-2 text-right font-mono text-gray-500">{ref.ordem}</td>
                          <td className="px-2 py-2 font-mono font-bold text-gray-900">{ref.referencia}</td>
                          <td className="px-2 py-2 text-gray-600">{ref.grupos.length} grupos</td>
                          {mostrarMA && <td className="px-2 py-2 text-right font-mono bg-blue-50/70">{ref.periodos.MA.qtd > 0 ? fmt(ref.periodos.MA.qtd) : '-'}</td>}
                          {mostrarPX && <td className="px-2 py-2 text-right font-mono bg-green-50/70">{ref.periodos.PX.qtd > 0 ? fmt(ref.periodos.PX.qtd) : '-'}</td>}
                          {mostrarUL && <td className="px-2 py-2 text-right font-mono bg-yellow-50/70">{ref.periodos.UL.qtd > 0 ? fmt(ref.periodos.UL.qtd) : '-'}</td>}
                          {mostrarQT && <td className="px-2 py-2 text-right font-mono bg-orange-50/70">{ref.periodos.QT.qtd > 0 ? fmt(ref.periodos.QT.qtd) : '-'}</td>}
                          {mostrarQU && <td className="px-2 py-2 text-right font-mono bg-red-50/70">{ref.periodos.QU.qtd > 0 ? fmt(ref.periodos.QU.qtd) : '-'}</td>}
                          {mostrarSX && <td className="px-2 py-2 text-right font-mono bg-purple-50/70">{ref.periodos.SX.qtd > 0 ? fmt(ref.periodos.SX.qtd) : '-'}</td>}
                          <td className="px-2 py-2 text-right font-mono font-bold">{fmt(ref.totalPecas)}</td>
                          <td className="px-2 py-2 text-right font-mono font-bold">{fmtDec(ref.dias)}</td>
                          <td className="px-2 py-2 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${ref.cabe ? 'bg-emerald-200 text-emerald-900' : 'bg-red-200 text-red-900'}`}>
                              {ref.cabe ? 'CABE' : 'NAO CABE'}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-right text-[10px] text-gray-500">{ref.alertasOpMin > 0 ? `${ref.alertasOpMin} OP min` : '-'}</td>
                        </tr>
                      );

                      const filhos = linhasPorGrupo.map((grupo) => {
                        const cap = Math.max(1, Number(gruposFiltrados.find((g) => g.grupo === grupo.grupo)?.capacidadeDiaria || 0));
                        const diasGrupo = grupo.cargaMinutos / cap;
                        const cabeGrupo = grupo.cargaMinutos <= Math.max(0, grupo.saldoGrupoProjetado);
                        return (
                          <tr key={`${ref.referencia}-${grupo.grupo}`} className="bg-white hover:bg-gray-50">
                            <td className="px-2 py-1.5"></td>
                            <td className="px-2 py-1.5 pl-6 text-gray-500 font-mono">{ref.referencia}</td>
                            <td className="px-2 py-1.5 font-semibold text-gray-800">{grupo.grupo}</td>
                            {mostrarMA && <td className="px-2 py-1.5 text-right font-mono bg-blue-50/40">{grupo.periodos.MA > 0 ? fmt(grupo.periodos.MA) : '-'}</td>}
                            {mostrarPX && <td className="px-2 py-1.5 text-right font-mono bg-green-50/40">{grupo.periodos.PX > 0 ? fmt(grupo.periodos.PX) : '-'}</td>}
                            {mostrarUL && <td className="px-2 py-1.5 text-right font-mono bg-yellow-50/40">{grupo.periodos.UL > 0 ? fmt(grupo.periodos.UL) : '-'}</td>}
                            {mostrarQT && <td className="px-2 py-1.5 text-right font-mono bg-orange-50/40">{grupo.periodos.QT > 0 ? fmt(grupo.periodos.QT) : '-'}</td>}
                            {mostrarQU && <td className="px-2 py-1.5 text-right font-mono bg-red-50/40">{grupo.periodos.QU > 0 ? fmt(grupo.periodos.QU) : '-'}</td>}
                            {mostrarSX && <td className="px-2 py-1.5 text-right font-mono bg-purple-50/40">{grupo.periodos.SX > 0 ? fmt(grupo.periodos.SX) : '-'}</td>}
                            <td className="px-2 py-1.5 text-right font-mono font-semibold">{fmt(grupo.totalPecas)}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{fmtDec(diasGrupo)}</td>
                            <td className="px-2 py-1.5 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${cabeGrupo ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                                {cabeGrupo ? 'OK' : 'ESTOURA'}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-right text-[10px] text-gray-500">
                              {grupo.corteMinRef > 1 ? `C ${fmt(grupo.corteMinRef)}` : '-'}
                              {grupo.opMinRef > 0 ? ` / OP ${fmt(grupo.opMinRef)}` : ''}
                            </td>
                          </tr>
                        );
                      });

                      return [pai, ...filhos];
                    })}
                    {sequenciamentoPorReferencia.length === 0 && (
                      <tr>
                        <td colSpan={7 + (horizonteIndex + 1)} className="px-4 py-8 text-center text-gray-500">
                          Nenhuma linha de sequenciamento gerada com o horizonte atual.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {sequenciamentoPorReferencia.length > 180 && (
                <div className="text-xs text-gray-500 text-center">
                  Mostrando 180 de {sequenciamentoPorReferencia.length} referencias. Use o CSV para a lista completa.
                </div>
              )}
            </div>
          </div>

          {/* Matriz por Referência */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mt-6">
            <div className="px-5 py-4 border-b border-gray-100 bg-violet-50">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-violet-800 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                    </svg>
                    Matriz por Referência
                  </div>
                  <div className="text-xs text-violet-700 mt-1">
                    Visão consolidada de cada referência, mostrando em quantos grupos ela está e o rateio aplicado.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-violet-800">{referenciasFiltradas.length}</span>
                  <span className="text-xs text-violet-600">referências</span>
                </div>
              </div>
            </div>

            {/* Filtros */}
            <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-4">
              <label className="text-xs text-gray-600">
                Referência
                <input
                  type="text"
                  value={filtroRefTexto}
                  onChange={(e) => setFiltroRefTexto(e.target.value)}
                  placeholder="Filtrar..."
                  className="ml-2 border border-gray-300 rounded px-2 py-1 text-xs w-32"
                />
              </label>
              <label className="text-xs text-gray-600 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={filtroRefMultiGrupo}
                  onChange={(e) => setFiltroRefMultiGrupo(e.target.checked)}
                  className="rounded"
                />
                Somente multi-grupo
              </label>
              <label className="text-xs text-red-700 flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={filtroRefProblema}
                  onChange={(e) => setFiltroRefProblema(e.target.checked)}
                  className="rounded border-red-300"
                />
                Somente com gargalo
              </label>
              <div className="ml-auto flex items-center gap-4 text-xs">
                <span className="text-gray-500">
                  {referenciasAgregadas.filter(r => r.totalGrupos > 1).length} multi-grupo
                </span>
                <span className="text-red-600 font-semibold">
                  {referenciasAgregadas.filter(r => r.gruposEstourados > 0).length} com gargalo
                </span>
                <span className="text-amber-600 font-semibold">
                  {referenciasAgregadas.filter(r => r.gruposEstourados > 0 && r.gruposComFolga > 0).length} redistribuíveis
                </span>
              </div>
            </div>

            {/* Legenda */}
            <div className="px-5 py-2 border-b border-gray-100 bg-slate-50 text-xs">
              <div className="flex flex-wrap gap-4 items-center">
                <span className="font-semibold text-gray-700">Legenda:</span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-3 h-3 rounded bg-emerald-200 border border-emerald-300"></span>
                  <span className="text-emerald-800">Grupo com folga (saldo positivo)</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-3 h-3 rounded bg-red-200 border border-red-300"></span>
                  <span className="text-red-800">Grupo estourado (saldo negativo)</span>
                </span>
                <span className="text-gray-400">|</span>
                <span className="inline-flex items-center gap-1">
                  <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold bg-amber-200 text-amber-800">REDISTRIBUIR</span>
                  <span className="text-gray-600">= tem grupo estourado E grupo com folga</span>
                </span>
              </div>
            </div>

            {/* Tabela */}
            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-xs">
                <thead className="bg-gray-100 sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-3 py-2">Referência</th>
                    <th className="text-right px-3 py-2">Tempo</th>
                    <th className="text-center px-3 py-2">Grupos</th>
                    <th className="text-left px-3 py-2">Distribuição (Grupo → Saldo do Grupo)</th>
                    {mostrarMA && <th className="text-right px-3 py-2 bg-blue-50">{nomeMes(periodos.MA)}</th>}
                    {mostrarPX && <th className="text-right px-3 py-2 bg-green-50">{nomeMes(periodos.PX)}</th>}
                    {mostrarUL && <th className="text-right px-3 py-2 bg-yellow-50">{nomeMes(periodos.UL)}</th>}
                    {mostrarQT && <th className="text-right px-3 py-2 bg-orange-50">{nomeMes(periodos.QT)}</th>}
                    {mostrarQU && <th className="text-right px-3 py-2 bg-red-50">{nomeMes(periodos.QU)}</th>}
                    {mostrarSX && <th className="text-right px-3 py-2 bg-purple-50">{nomeMes(periodos.SX)}</th>}
                    <th className="text-right px-3 py-2 bg-slate-100">Carga Total</th>
                    <th className="text-center px-3 py-2 bg-amber-50">Gargalo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {referenciasFiltradas.length === 0 ? (
                    <tr>
                      <td colSpan={7 + (horizonteIndex + 1)} className="px-4 py-8 text-center text-gray-500">
                        Nenhuma referência encontrada com os filtros aplicados.
                      </td>
                    </tr>
                  ) : (
                    referenciasFiltradas.slice(0, 500).map((ref) => {
                      // Determina se esta referência tem problema (está em grupo estourado)
                      const temProblema = ref.gruposEstourados > 0;
                      const todosEstourados = ref.gruposEstourados === ref.totalGrupos;
                      const temFolga = ref.gruposComFolga > 0;

                      return (
                        <tr
                          key={ref.referencia}
                          className={`hover:bg-gray-50 transition-colors ${
                            todosEstourados ? 'bg-red-50/50' :
                            temProblema ? 'bg-amber-50/30' :
                            ref.totalGrupos > 1 ? 'bg-blue-50/20' : ''
                          }`}
                        >
                          <td className="px-3 py-2">
                            <div className="font-mono font-semibold text-gray-800">{ref.referencia}</div>
                            <div className="text-[10px] text-gray-400">{ref.idreferencia}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-gray-600">{fmtDec(ref.tempo)}</td>
                          <td className="px-3 py-2 text-center">
                            <div className="flex flex-col items-center gap-0.5">
                              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${
                                todosEstourados ? 'bg-red-200 text-red-800' :
                                temProblema ? 'bg-amber-200 text-amber-800' :
                                ref.totalGrupos > 1 ? 'bg-blue-200 text-blue-800' :
                                'bg-gray-100 text-gray-600'
                              }`}>
                                {ref.totalGrupos}
                              </span>
                              {ref.totalGrupos > 1 && (
                                <span className="text-[9px] text-gray-500">
                                  {ref.gruposComFolga > 0 && <span className="text-emerald-600">{ref.gruposComFolga}✓</span>}
                                  {ref.gruposEstourados > 0 && <span className="text-red-600 ml-0.5">{ref.gruposEstourados}✗</span>}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {ref.grupos.map((g, idx) => (
                                <span
                                  key={idx}
                                  className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] ${
                                    g.estourado
                                      ? 'bg-red-100 text-red-800 border border-red-200'
                                      : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                  }`}
                                  title={`Capacidade diária: ${fmt(g.capacidadeDiaria)} min | Saldo acum: ${fmt(g.saldoAcum)} min`}
                                >
                                  {g.grupo}
                                  <span className={`font-bold ml-1 ${g.estourado ? 'text-red-700' : 'text-emerald-700'}`}>
                                    {g.estourado ? fmt(g.saldoAcum) : '+' + fmt(g.saldoAcum)}
                                  </span>
                                </span>
                              ))}
                            </div>
                          </td>
                          {mostrarMA && <td className="px-3 py-2 text-right font-mono text-gray-700 bg-blue-50/50">{ref.cargaMA > 0 ? fmt(ref.cargaMA) : '-'}</td>}
                          {mostrarPX && <td className="px-3 py-2 text-right font-mono text-gray-700 bg-green-50/50">{ref.cargaPX > 0 ? fmt(ref.cargaPX) : '-'}</td>}
                          {mostrarUL && <td className="px-3 py-2 text-right font-mono text-gray-700 bg-yellow-50/50">{ref.cargaUL > 0 ? fmt(ref.cargaUL) : '-'}</td>}
                          {mostrarQT && <td className="px-3 py-2 text-right font-mono text-gray-700 bg-orange-50/50">{ref.cargaQT > 0 ? fmt(ref.cargaQT) : '-'}</td>}
                          {mostrarQU && <td className="px-3 py-2 text-right font-mono text-gray-700 bg-red-50/50">{ref.cargaQU > 0 ? fmt(ref.cargaQU) : '-'}</td>}
                          {mostrarSX && <td className="px-3 py-2 text-right font-mono text-gray-700 bg-purple-50/50">{ref.cargaSX > 0 ? fmt(ref.cargaSX) : '-'}</td>}
                          <td className="px-3 py-2 text-right font-mono font-semibold text-gray-800 bg-slate-50">
                            {fmt(Math.round(ref.cargaTotal))}
                          </td>
                          <td className="px-3 py-2 text-center bg-amber-50/30">
                            <div className="flex flex-col items-center gap-1">
                              {todosEstourados ? (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-red-200 text-red-800">
                                  CRÍTICO
                                </span>
                              ) : temProblema && temFolga ? (
                                <>
                                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-200 text-amber-800">
                                    REDISTRIBUIR
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      iniciarRedistribuicao(ref.referencia);
                                    }}
                                    className="px-2 py-0.5 text-[9px] font-semibold bg-violet-600 text-white rounded hover:bg-violet-700 transition-colors"
                                  >
                                    Simular
                                  </button>
                                </>
                              ) : temProblema ? (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-orange-200 text-orange-800">
                                  ATENÇÃO
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                                  OK
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {referenciasFiltradas.length > 500 && (
              <div className="px-5 py-2 border-t border-gray-100 text-xs text-gray-500 text-center">
                Mostrando 500 de {referenciasFiltradas.length} referências. Use os filtros para refinar a lista.
              </div>
            )}
          </div>

          {/* Seção de Simulação de Redistribuição */}
          {mostrarRedistribuicao && dadosRedistribuicao && (
            <div ref={redistribuicaoRef} className="bg-gradient-to-br from-violet-50 to-indigo-50 rounded-xl border-2 border-violet-300 overflow-hidden mt-6 shadow-lg">
              {/* Header */}
              <div className="px-5 py-4 bg-gradient-to-r from-violet-600 to-indigo-600 text-white">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white/20 rounded-lg">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-lg font-bold">Simulação de Redistribuição</div>
                      <div className="text-violet-200 text-sm">
                        Referência: <span className="font-mono font-semibold text-white">{dadosRedistribuicao.referencia}</span>
                        <span className="ml-3 text-violet-200">Tempo: <span className="font-mono font-semibold text-white">{fmtDec(dadosRedistribuicao.tempo)} min/pç</span></span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setMostrarRedistribuicao(false);
                      setRefSelecionadaRedist(null);
                      setAlocacaoSimulada({});
                    }}
                    className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Resumo da Referência */}
              <div className="px-5 py-4 bg-white/50 border-b border-violet-200">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white rounded-lg p-3 shadow-sm border border-violet-100">
                    <div className="text-xs text-gray-500 uppercase">Total de Peças</div>
                    <div className="text-2xl font-bold text-violet-800 font-mono">{fmt(dadosRedistribuicao.pecasTotal)}</div>
                    <div className="text-[10px] text-gray-400">{fmt(Math.round(dadosRedistribuicao.pecasTotal * dadosRedistribuicao.tempo))} min</div>
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm border border-violet-100">
                    <div className="text-xs text-gray-500 uppercase">Peças Alocadas</div>
                    <div className="text-2xl font-bold text-emerald-700 font-mono">{fmt(dadosRedistribuicao.pecasAlocadasTotal)}</div>
                    <div className="text-[10px] text-gray-400">{fmtPct(dadosRedistribuicao.pecasTotal > 0 ? (dadosRedistribuicao.pecasAlocadasTotal / dadosRedistribuicao.pecasTotal) * 100 : 0)}</div>
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm border border-violet-100">
                    <div className="text-xs text-gray-500 uppercase">Peças Restantes</div>
                    <div className={`text-2xl font-bold font-mono ${dadosRedistribuicao.pecasRestantes > 0 ? 'text-amber-600' : dadosRedistribuicao.pecasRestantes < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {fmt(dadosRedistribuicao.pecasRestantes)}
                    </div>
                    <div className="text-[10px] text-gray-400">
                      {dadosRedistribuicao.pecasRestantes > 0 ? 'Falta alocar' : dadosRedistribuicao.pecasRestantes < 0 ? 'Excesso' : 'Balanceado'}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm border border-violet-100">
                    <div className="text-xs text-gray-500 uppercase">Grupos</div>
                    <div className="text-2xl font-bold text-blue-700 font-mono">{dadosRedistribuicao.grupos.length}</div>
                    <div className="text-[10px] text-gray-400">
                      {dadosRedistribuicao.grupos.filter(g => g.folgaPecas > 0).length} com folga
                    </div>
                  </div>
                </div>
              </div>

              {/* Botões de ação */}
              <div className="px-5 py-3 bg-white/30 border-b border-violet-200 flex items-center gap-3">
                <button
                  onClick={redistribuirAutomatico}
                  className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Redistribuir Automático
                </button>
                <button
                  onClick={resetarAlocacao}
                  className="px-4 py-2 bg-gray-500 text-white text-sm font-semibold rounded-lg hover:bg-gray-600 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Resetar
                </button>
                <div className="ml-auto text-xs text-violet-700">
                  Arraste os sliders para ajustar a alocação de peças por grupo
                </div>
              </div>

              <div className="px-5 py-4 bg-white/70 border-b border-violet-200">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div className="text-sm font-semibold text-gray-800">Matriz da referencia apos simulacao</div>
                  <div className="text-xs text-gray-500">
                    {movimentosReferenciaSelecionada.length > 0
                      ? `${movimentosReferenciaSelecionada.length} movimento(s) sugerido(s) aplicados no clique`
                      : 'Sem movimento automatico encontrado para esta referencia nos filtros atuais'}
                  </div>
                </div>
                <div className="overflow-x-auto rounded-lg border border-violet-100">
                  <table className="w-full text-xs">
                    <thead className="bg-violet-50 text-violet-900">
                      <tr>
                        <th className="px-3 py-2 text-left">Grupo</th>
                        <th className="px-3 py-2 text-right">Rateio original</th>
                        <th className="px-3 py-2 text-right">Rateio simulado</th>
                        <th className="px-3 py-2 text-right">Pecas</th>
                        <th className="px-3 py-2 text-right">Folga</th>
                        <th className="px-3 py-2 text-right">Saldo apos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-violet-100 bg-white">
                      {dadosRedistribuicao.grupos.map((grupo) => (
                        <tr key={grupo.grupo} className={grupo.pecasAposAlocacao < 0 ? 'bg-red-50' : 'bg-emerald-50/40'}>
                          <td className="px-3 py-2 font-semibold text-gray-800">{grupo.grupo}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmtPct(grupo.rateio)}</td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-violet-800">{fmtPct(grupo.percentualAlocado)}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(grupo.pecasAlocadas)}</td>
                          <td className={`px-3 py-2 text-right font-mono ${saldoClass(grupo.folgaPecas)}`}>{grupo.folgaPecas > 0 ? '+' : ''}{fmt(grupo.folgaPecas)}</td>
                          <td className={`px-3 py-2 text-right font-mono ${saldoClass(grupo.pecasAposAlocacao)}`}>{grupo.pecasAposAlocacao > 0 ? '+' : ''}{fmt(grupo.pecasAposAlocacao)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Blocos dos Grupos - Interface Visual */}
              <div className="px-5 py-5">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {dadosRedistribuicao.grupos.map((grupo) => {
                    const percentualUsado = grupo.folgaPecas !== 0 ? (grupo.pecasAlocadas / Math.abs(grupo.folgaPecas)) * 100 : 0;
                    const estaCheio = grupo.pecasAposAlocacao < 0;
                    const estaVazio = grupo.pecasAlocadas === 0;
                    const barraFolga = Math.max(0, Math.min(100, grupo.folgaPecas > 0 ? 100 : 0));
                    const barraAlocacao = Math.max(0, Math.min(100, grupo.folgaPecas > 0 ? (grupo.pecasAlocadas / grupo.folgaPecas) * 100 : 100));

                    return (
                      <div
                        key={grupo.grupo}
                        className={`rounded-xl border-2 overflow-hidden transition-all ${
                          estaCheio
                            ? 'border-red-400 bg-red-50 shadow-red-100'
                            : grupo.folgaPecas <= 0
                            ? 'border-gray-300 bg-gray-50 opacity-60'
                            : 'border-emerald-300 bg-white shadow-emerald-50'
                        } shadow-lg`}
                      >
                        {/* Header do grupo */}
                        <div className={`px-4 py-3 ${
                          estaCheio ? 'bg-red-100' : grupo.folgaPecas <= 0 ? 'bg-gray-100' : 'bg-emerald-50'
                        }`}>
                          <div className="flex items-center justify-between">
                            <div className="font-bold text-gray-800">{grupo.grupo}</div>
                            <div className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              estaCheio ? 'bg-red-200 text-red-800' :
                              grupo.folgaPecas <= 0 ? 'bg-gray-200 text-gray-600' :
                              'bg-emerald-200 text-emerald-800'
                            }`}>
                              {estaCheio ? 'ESTOURADO' : grupo.folgaPecas <= 0 ? 'SEM FOLGA' : 'DISPONÍVEL'}
                            </div>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            Rateio original: <span className="font-mono font-semibold">{fmtPct(grupo.rateio)}</span>
                          </div>
                        </div>

                        {/* Corpo com visualização */}
                        <div className="px-4 py-4 space-y-4">
                          {/* Barra de nível visual */}
                          <div className="relative h-20 bg-gradient-to-b from-gray-100 to-gray-200 rounded-lg overflow-hidden border border-gray-300">
                            {/* Marcadores de nível */}
                            <div className="absolute inset-0 flex flex-col justify-between py-1 pointer-events-none">
                              {[0, 25, 50, 75, 100].map((nivel) => (
                                <div key={nivel} className="flex items-center text-[9px] text-gray-400 px-1">
                                  <span className="w-6">{100 - nivel}%</span>
                                  <div className="flex-1 border-t border-gray-300 border-dashed"></div>
                                </div>
                              ))}
                            </div>

                            {/* Barra de folga disponível */}
                            {grupo.folgaPecas > 0 && (
                              <div
                                className="absolute bottom-0 left-2 right-2 bg-gradient-to-t from-emerald-200 to-emerald-100 rounded-t-lg transition-all duration-300"
                                style={{ height: `${barraFolga}%` }}
                              >
                                <div className="absolute inset-x-0 top-0 h-1 bg-emerald-400 rounded-t-lg"></div>
                              </div>
                            )}

                            {/* Barra de peças alocadas */}
                            <div
                              className={`absolute bottom-0 left-2 right-2 rounded-t-lg transition-all duration-300 ${
                                estaCheio
                                  ? 'bg-gradient-to-t from-red-500 to-red-400'
                                  : 'bg-gradient-to-t from-violet-500 to-violet-400'
                              }`}
                              style={{ height: `${Math.min(barraAlocacao, 100)}%` }}
                            >
                              <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-white font-bold text-lg drop-shadow">
                                  {fmt(grupo.pecasAlocadas)}
                                </span>
                              </div>
                            </div>

                            {/* Indicador de overflow */}
                            {estaCheio && (
                              <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-red-600 text-white px-2 py-0.5 rounded text-[10px] font-bold animate-pulse">
                                EXCESSO: {fmt(Math.abs(grupo.pecasAposAlocacao))} pçs
                              </div>
                            )}
                          </div>

                          {/* Informações numéricas */}
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div className={`rounded-lg p-2 ${grupo.folgaPecas > 0 ? 'bg-emerald-50' : 'bg-gray-100'}`}>
                              <div className="text-[10px] text-gray-500 uppercase">Folga</div>
                              <div className={`font-bold font-mono ${grupo.folgaPecas > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                                {grupo.folgaPecas > 0 ? '+' : ''}{fmt(grupo.folgaPecas)}
                              </div>
                              <div className="text-[9px] text-gray-400">peças</div>
                            </div>
                            <div className="bg-violet-50 rounded-lg p-2">
                              <div className="text-[10px] text-gray-500 uppercase">Alocado</div>
                              <div className="font-bold font-mono text-violet-700">{fmt(grupo.pecasAlocadas)}</div>
                              <div className="text-[9px] text-gray-400">peças</div>
                            </div>
                            <div className={`rounded-lg p-2 ${
                              grupo.pecasAposAlocacao < 0 ? 'bg-red-50' : 'bg-blue-50'
                            }`}>
                              <div className="text-[10px] text-gray-500 uppercase">Após</div>
                              <div className={`font-bold font-mono ${
                                grupo.pecasAposAlocacao < 0 ? 'text-red-700' : 'text-blue-700'
                              }`}>
                                {grupo.pecasAposAlocacao > 0 ? '+' : ''}{fmt(grupo.pecasAposAlocacao)}
                              </div>
                              <div className="text-[9px] text-gray-400">peças</div>
                            </div>
                          </div>

                          {/* Slider de ajuste */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-gray-600">Alocação:</span>
                              <span className="font-mono font-bold text-violet-700">{fmtPct(grupo.percentualAlocado)}</span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              step="1"
                              value={grupo.percentualAlocado}
                              onChange={(e) => ajustarAlocacao(grupo.grupo, Number(e.target.value))}
                              className={`w-full h-3 rounded-lg appearance-none cursor-pointer ${
                                grupo.folgaPecas <= 0 ? 'bg-gray-200' : estaCheio ? 'bg-red-200' : 'bg-violet-200'
                              }`}
                              style={{
                                background: `linear-gradient(to right, ${
                                  estaCheio ? '#ef4444' : '#8b5cf6'
                                } ${grupo.percentualAlocado}%, ${
                                  grupo.folgaPecas <= 0 ? '#e5e7eb' : '#ddd6fe'
                                } ${grupo.percentualAlocado}%)`
                              }}
                            />
                            <div className="flex justify-between text-[9px] text-gray-400">
                              <span>0%</span>
                              <span>50%</span>
                              <span>100%</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Status de balanceamento */}
              <div className={`px-5 py-4 border-t ${
                dadosRedistribuicao.pecasRestantes === 0
                  ? 'bg-emerald-100 border-emerald-300'
                  : dadosRedistribuicao.pecasRestantes > 0
                  ? 'bg-amber-100 border-amber-300'
                  : 'bg-red-100 border-red-300'
              }`}>
                <div className="flex items-center justify-center gap-3">
                  {dadosRedistribuicao.pecasRestantes === 0 ? (
                    <>
                      <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div className="text-emerald-800 font-semibold">
                        BALANCEADO! Todas as {fmt(dadosRedistribuicao.pecasTotal)} peças foram alocadas corretamente.
                      </div>
                    </>
                  ) : dadosRedistribuicao.pecasRestantes > 0 ? (
                    <>
                      <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div className="text-amber-800 font-semibold">
                        FALTA ALOCAR: {fmt(dadosRedistribuicao.pecasRestantes)} peças ({fmtPct((dadosRedistribuicao.pecasRestantes / dadosRedistribuicao.pecasTotal) * 100)} do total)
                      </div>
                    </>
                  ) : (
                    <>
                      <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div className="text-red-800 font-semibold">
                        EXCESSO: {fmt(Math.abs(dadosRedistribuicao.pecasRestantes))} peças alocadas a mais!
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Info */}
          <div className="text-xs text-gray-500 text-center mt-4">
            Clique em um grupo para expandir e ver as referências. Dados calculados no servidor para melhor performance.
          </div>
        </main>
      </div>
    </div>
  );
}
