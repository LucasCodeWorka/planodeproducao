'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { PeriodosPlano, Planejamento } from '../types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MARCA_FIXA = 'LIEBE';
const STATUS_FIXO = 'EM LINHA';

type GrupoCapacidadeRow = {
  grupo: string;
  tipo: string;
  capacidade_diaria: number;
};

type GrupoRefRow = {
  grupo: string;
  referencia: string;
};

type TempoRefRow = {
  idreferencia: string;
  referencia_padrao?: string;
  tempo_segundos: number;
};

type TempoDebugRow = {
  idreferencia: string;
  referencia_padrao: string;
  cd_operacao: string;
  ds_operacao: string;
  cd_tipooperacao: string;
  ds_tipooperacao: string;
  qt_operacao: number;
  hr_tempo: string;
  hr_tempopadrao: string;
  tempo_resolvido: number;
};

type PlanoSnapshotItem = { chave: string; ma: number; px: number; ul: number };
type AnaliseAprovada = {
  id: string;
  nome?: string;
  createdAt: number;
  parametros?: {
    statusAprovacao?: 'PENDENTE' | 'APROVADA';
    planos?: PlanoSnapshotItem[];
  };
};

type GrupoAnaliseRow = {
  grupo: string;
  tipo: string;
  pessoasIdeal: number | null;
  capacidadeDiaria: number;
  refsMapeadas: number;
  refsComTempo: number;
  processoPecas: number;
  processoCarga: number;
  cargaTotal: number;
  capacidadeTotal: number;
  atendimentoTotal: number;
  diasTotal: number;
  tempoMarco: number;
  tempoAbril: number;
  tempoMaio: number;
  tempoPrp: number;
  difCapacidadeFinal: number;
  diasDif: number;
  difCapacidadeAteAbr: number;
  diasDifAteAbr: number;
  planoMA: number;
  planoPX: number;
  planoUL: number;
  planoJUN: number;
  cargaMA: number;
  cargaPX: number;
  cargaUL: number;
  cargaJUN: number;
  capacidadeMA: number;
  capacidadePX: number;
  capacidadeUL: number;
  capacidadeJUN: number;
  saldoMA: number;
  saldoPX: number;
  saldoUL: number;
  saldoJUN: number;
  saldoAcumMA: number;
  saldoAcumPX: number;
  saldoAcumUL: number;
  saldoAcumJUN: number;
  atendimentoMA: number;
  atendimentoPX: number;
  atendimentoUL: number;
  atendimentoJUN: number;
  diasNecMA: number;
  diasNecPX: number;
  diasNecUL: number;
  diasNecJUN: number;
  diasFaltMA: number;
  diasFaltPX: number;
  diasFaltUL: number;
  diasFaltJUN: number;
};

type RefAnaliseRow = {
  grupo: string;
  referencia: string;
  idreferencia: string;
  rateio: number;
  tempoSegundos: number;
  processoPecas: number;
  processoCarga: number;
  cargaTotal: number;
  diasTotal: number;
  planoMA: number;
  planoPX: number;
  planoUL: number;
  planoJUN: number;
  cargaMA: number;
  cargaPX: number;
  cargaUL: number;
  cargaJUN: number;
};

function parseNumberFlexible(raw: string): number {
  const s = String(raw || '').trim().replace(/^"|"$/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) {
    const n = Number(s.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }
  if (s.includes(',') && !s.includes('.')) {
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function norm(raw: string) {
  return String(raw || '').trim().toUpperCase();
}

function parseCsvGeneric(text: string) {
  const cleanText = String(text || '').replace(/^\uFEFF/, '');
  const lines = cleanText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { rows: [], headerCols: [], delim: ',' };
  const delim = lines[0].includes('\t') ? '\t' : (lines[0].includes(';') ? ';' : ',');
  const headerCols = lines[0].split(delim).map((c) => norm(c).replace(/\s+/g, '_'));
  const rows = lines.slice(1).map((line) => line.split(delim).map((c) => String(c || '').trim().replace(/^"|"$/g, '')));
  return { rows, headerCols, delim };
}

function parseGruposCsv(text: string): GrupoCapacidadeRow[] {
  const { rows, headerCols } = parseCsvGeneric(text);
  const idxGrupo = headerCols.findIndex((c) => c === 'GRUPO');
  const idxTipo = headerCols.findIndex((c) => c === 'TIPO');
  const idxCap = headerCols.findIndex((c) => c === 'CAPACIDADE_DIARIA');
  const out = new Map<string, GrupoCapacidadeRow>();
  for (const row of rows) {
    const grupo = norm(idxGrupo >= 0 ? row[idxGrupo] : row[0]);
    const tipo = norm(idxTipo >= 0 ? row[idxTipo] : row[2]);
    const capacidade_diaria = parseNumberFlexible(idxCap >= 0 ? row[idxCap] : row[1]);
    if (!grupo || !Number.isFinite(capacidade_diaria) || capacidade_diaria <= 0) continue;
    out.set(grupo, { grupo, tipo, capacidade_diaria });
  }
  return Array.from(out.values());
}

function parseGrupoRefsCsv(text: string): GrupoRefRow[] {
  const { rows, headerCols } = parseCsvGeneric(text);
  const idxGrupo = headerCols.findIndex((c) => c === 'GRUPO');
  const idxRef = headerCols.findIndex((c) => c === 'REF' || c === 'REFERENCIA');
  const out = new Map<string, GrupoRefRow>();
  for (const row of rows) {
    const grupo = norm(idxGrupo >= 0 ? row[idxGrupo] : row[0]);
    const referencia = norm(idxRef >= 0 ? row[idxRef] : row[1]);
    if (!grupo || !referencia) continue;
    out.set(`${grupo}__${referencia}`, { grupo, referencia });
  }
  return Array.from(out.values());
}

function fmtInt(value: number) {
  return Math.round(Number(value || 0)).toLocaleString('pt-BR');
}

function nomeMes(mes: number) {
  return new Date(2000, mes - 1, 1).toLocaleString('pt-BR', { month: 'short' }).replace('.', '');
}

function toneClass(value: number) {
  if (value > 0) return 'text-red-700';
  if (value < 0) return 'text-emerald-700';
  return 'text-gray-500';
}

function chaveItem(item: Planejamento) {
  const id = Number(item.produto.idproduto);
  if (Number.isFinite(id)) return `ID-${id}`;
  return `REF-${item.produto.referencia || ''}-${item.produto.cor || ''}-${item.produto.tamanho || ''}`;
}

export default function CapacidadePage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [dados, setDados] = useState<Planejamento[]>([]);
  const [periodos, setPeriodos] = useState<PeriodosPlano>({ MA: 3, PX: 4, UL: 5 });
  const [grupos, setGrupos] = useState<GrupoCapacidadeRow[]>([]);
  const [grupoRefs, setGrupoRefs] = useState<GrupoRefRow[]>([]);
  const [temposRef, setTemposRef] = useState<TempoRefRow[]>([]);
  const [dias, setDias] = useState<Record<string, number>>({});
  const [previewGrupos, setPreviewGrupos] = useState<GrupoCapacidadeRow[]>([]);
  const [previewGrupoRefs, setPreviewGrupoRefs] = useState<GrupoRefRow[]>([]);
  const [filtroGrupo, setFiltroGrupo] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('TODOS');
  const [somenteEstourados, setSomenteEstourados] = useState(false);
  const [debugRef, setDebugRef] = useState('');
  const [debugRows, setDebugRows] = useState<TempoDebugRow[]>([]);
  const [debugTotal, setDebugTotal] = useState(0);
  const [debugLoading, setDebugLoading] = useState(false);
  const [aprovadas, setAprovadas] = useState<AnaliseAprovada[]>([]);
  const [aprovadasSelecionadasIds, setAprovadasSelecionadasIds] = useState<string[]>([]);
  const [abrirSeletorAprovadas, setAbrirSeletorAprovadas] = useState(false);
  const [aplicarAprovadas, setAplicarAprovadas] = useState(false);
  const mesJunho = useMemo(() => ((Number(periodos.UL) % 12) + 1), [periodos.UL]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregar();
  }, [router]);

  async function carregar() {
    setLoading(true);
    setError(null);
    try {
      const [rConfig, rTempos, rMatriz, rProj, rAnalises] = await Promise.all([
        fetch(`${API_URL}/api/capacidade/config`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/capacidade/tempos-ref`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/producao/matriz?limit=5000&marca=${encodeURIComponent(MARCA_FIXA)}&status=${encodeURIComponent(STATUS_FIXO)}`),
        fetch(`${API_URL}/api/projecoes`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/analises`, { headers: authHeaders() }),
      ]);
      const pConfig = await rConfig.json();
      const pTempos = await rTempos.json();
      const pMatriz = await rMatriz.json();
      const pProj = await rProj.json();
      const pAnalises = await rAnalises.json();
      if (!rConfig.ok || !pConfig.success) throw new Error(pConfig.error || 'Erro ao carregar configuração de capacidade');
      if (!rTempos.ok || !pTempos.success) throw new Error(pTempos.error || 'Erro ao carregar tempos de costura');
      if (!rMatriz.ok || !pMatriz.success) throw new Error(pMatriz.error || 'Erro ao carregar matriz');
      setGrupos(Array.isArray(pConfig?.data?.grupos) ? pConfig.data.grupos : []);
      setGrupoRefs(Array.isArray(pConfig?.data?.grupo_refs) ? pConfig.data.grupo_refs : []);
      setDias((pConfig?.data?.dias && typeof pConfig.data.dias === 'object') ? pConfig.data.dias : {});
      setTemposRef(Array.isArray(pTempos?.data) ? pTempos.data : []);
      setDados(Array.isArray(pMatriz?.data) ? pMatriz.data : []);
      if (pProj?.periodos) setPeriodos(pProj.periodos as PeriodosPlano);
      const lista = (Array.isArray(pAnalises?.data) ? pAnalises.data : []) as AnaliseAprovada[];
      const aprov = lista.filter((a) => a?.parametros?.statusAprovacao === 'APROVADA' && Array.isArray(a?.parametros?.planos));
      setAprovadas(aprov);
      setAprovadasSelecionadasIds((prev) => {
        if (!prev.length) return aprov.map((a) => a.id);
        const validos = prev.filter((id) => aprov.some((a) => a.id === id));
        return validos.length ? validos : aprov.map((a) => a.id);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar capacidade');
    } finally {
      setLoading(false);
    }
  }

  async function onUploadGrupos(file: File) {
    setError(null);
    setOkMsg(null);
    const parsed = parseGruposCsv(await file.text());
    if (!parsed.length) {
      setError('Arquivo de grupos sem linhas válidas. Use colunas: grupo,capacidade_diaria,tipo');
      return;
    }
    setPreviewGrupos(parsed);
    setOkMsg(`Prévia de grupos carregada: ${parsed.length.toLocaleString('pt-BR')} linhas válidas.`);
  }

  async function onUploadGrupoRefs(file: File) {
    setError(null);
    setOkMsg(null);
    const parsed = parseGrupoRefsCsv(await file.text());
    if (!parsed.length) {
      setError('Arquivo grupo/ref sem linhas válidas. Use colunas: grupo,ref');
      return;
    }
    setPreviewGrupoRefs(parsed);
    setOkMsg(`Prévia grupo/ref carregada: ${parsed.length.toLocaleString('pt-BR')} vínculos válidos.`);
  }

  async function salvarGrupos() {
    if (!previewGrupos.length) return;
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`${API_URL}/api/capacidade/grupos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ data: previewGrupos }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao salvar grupos');
      setPreviewGrupos([]);
      setOkMsg(`Grupos salvos: ${fmtInt(data.total)} registros.`);
      await carregar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar grupos');
    } finally {
      setSaving(false);
    }
  }

  async function salvarGrupoRefs() {
    if (!previewGrupoRefs.length) return;
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`${API_URL}/api/capacidade/grupo-refs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ data: previewGrupoRefs }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao salvar vínculos grupo/ref');
      setPreviewGrupoRefs([]);
      setOkMsg(`Grupo/ref salvos: ${fmtInt(data.total)} vínculos.`);
      await carregar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar grupo/ref');
    } finally {
      setSaving(false);
    }
  }

  async function salvarDias() {
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`${API_URL}/api/capacidade/dias`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(dias),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao salvar dias');
      setOkMsg('Dias produtivos salvos.');
      await carregar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar dias');
    } finally {
      setSaving(false);
    }
  }

  async function carregarTempoDebug(referencia: string) {
    const ref = norm(referencia);
    if (!ref) {
      setDebugRef('');
      setDebugRows([]);
      setDebugTotal(0);
      return;
    }
    setDebugLoading(true);
    setDebugRef(ref);
    try {
      const res = await fetch(`${API_URL}/api/capacidade/tempo-debug?referencia=${encodeURIComponent(ref)}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao carregar depuração do tempo');
      setDebugRows(Array.isArray(data.data) ? data.data : []);
      setDebugTotal(Number(data.tempo_total || 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar depuração do tempo');
      setDebugRows([]);
      setDebugTotal(0);
    } finally {
      setDebugLoading(false);
    }
  }

  const matrizBase = useMemo(() => {
    return dados.filter((item) => {
      const marca = norm(item.produto?.marca || '');
      const status = norm(item.produto?.status || '');
      const descricao = norm(item.produto?.produto || '');
      return marca === MARCA_FIXA && status.startsWith(STATUS_FIXO) && !descricao.includes('MEIA DE SEDA');
    });
  }, [dados]);

  const planosAprovadosMap = useMemo(() => {
    const map = new Map<string, { ma: number; px: number; ul: number }>();
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
        });
      }
    }
    return map;
  }, [aprovadas, aprovadasSelecionadasIds]);

  const matrizAplicada = useMemo(() => {
    if (!aplicarAprovadas || !planosAprovadosMap.size) return matrizBase;
    return matrizBase.map((item) => {
      const aprovado = planosAprovadosMap.get(chaveItem(item));
      if (!aprovado) return item;
      return {
        ...item,
        plano: {
          ...item.plano,
          ma: Number(aprovado.ma || 0),
          px: Number(aprovado.px || 0),
          ul: Number(aprovado.ul || 0),
        },
      };
    });
  }, [matrizBase, aplicarAprovadas, planosAprovadosMap]);

  const planoPorRefMap = useMemo(() => {
    const map = new Map<string, { ma: number; px: number; ul: number; jun: number }>();
    for (const item of matrizAplicada) {
      const refPadrao = norm(item.produto?.referencia || '');
      const refSistema = norm(item.produto?.cd_seqgrupo || '');
      const plano = {
        ma: Number(item.plano?.ma || 0),
        px: Number(item.plano?.px || 0),
        ul: Number(item.plano?.ul || 0),
        jun: 0,
      };
      for (const chave of [refPadrao, refSistema]) {
        if (!chave) continue;
        const atual = map.get(chave) || { ma: 0, px: 0, ul: 0, jun: 0 };
        atual.ma += plano.ma;
        atual.px += plano.px;
        atual.ul += plano.ul;
        map.set(chave, atual);
      }
    }
    return map;
  }, [matrizAplicada]);

  const processoPorRefMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of matrizAplicada) {
      const descricao = norm(item.produto?.produto || '');
      if (descricao.includes('MEIA DE SEDA')) continue;
      const refPadrao = norm(item.produto?.referencia || '');
      const refSistema = norm(item.produto?.cd_seqgrupo || '');
      const processo = Number(item.estoques?.em_processo || 0);
      for (const chave of [refPadrao, refSistema]) {
        if (!chave) continue;
        map.set(chave, (map.get(chave) || 0) + processo);
      }
    }
    return map;
  }, [matrizAplicada]);

  const seqgrupoPorRefMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of matrizAplicada) {
      const descricao = norm(item.produto?.produto || '');
      if (descricao.includes('MEIA DE SEDA')) continue;
      const refPadrao = norm(item.produto?.referencia || '');
      const refSistema = norm(item.produto?.cd_seqgrupo || '');
      if (!refPadrao || !refSistema) continue;
      if (!map.has(refPadrao)) {
        map.set(refPadrao, refSistema);
      }
    }
    return map;
  }, [matrizAplicada]);

  const capacidadeDiariaPorGrupoMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const grupo of grupos) {
      map.set(norm(grupo.grupo), Number(grupo.capacidade_diaria || 0));
    }
    return map;
  }, [grupos]);

  const gruposPorReferenciaMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of grupoRefs) {
      const referencia = norm(row.referencia);
      const grupo = norm(row.grupo);
      if (!referencia || !grupo) continue;
      const atual = map.get(referencia) || [];
      if (!atual.includes(grupo)) atual.push(grupo);
      map.set(referencia, atual);
    }
    return map;
  }, [grupoRefs]);

  const tempoPorRefMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of temposRef) {
      const ref = norm(row.idreferencia || '');
      if (!ref) continue;
      map.set(ref, Number(row.tempo_segundos || 0));
    }
    return map;
  }, [temposRef]);

  const detalhesRef = useMemo<RefAnaliseRow[]>(() => {
    return grupoRefs.map((row) => {
      const referencia = norm(row.referencia);
      const grupo = norm(row.grupo);
      const idreferencia = norm(seqgrupoPorRefMap.get(referencia) || '');
      const planoBase = planoPorRefMap.get(referencia) || { ma: 0, px: 0, ul: 0, jun: 0 };
      const tempo = Number((idreferencia && tempoPorRefMap.get(idreferencia)) || 0);
      const processoBase = Number(processoPorRefMap.get(referencia) || 0);
      const gruposDaReferencia = gruposPorReferenciaMap.get(referencia) || [];
      const capacidadeTotalRateio = gruposDaReferencia.reduce((acc, nomeGrupo) => acc + Number(capacidadeDiariaPorGrupoMap.get(nomeGrupo) || 0), 0);
      const capacidadeGrupoAtual = Number(capacidadeDiariaPorGrupoMap.get(grupo) || 0);
      const rateio = gruposDaReferencia.length <= 1
        ? 1
        : (capacidadeTotalRateio > 0 ? (capacidadeGrupoAtual / capacidadeTotalRateio) : (1 / gruposDaReferencia.length));
      const plano = {
        ma: planoBase.ma * rateio,
        px: planoBase.px * rateio,
        ul: planoBase.ul * rateio,
        jun: planoBase.jun * rateio,
      };
      const processoPecas = processoBase * rateio;
      const processoCarga = tempo * processoPecas;
      return {
        grupo: row.grupo,
        referencia,
        idreferencia,
        rateio,
        tempoSegundos: tempo,
        processoPecas,
        processoCarga,
        cargaTotal: processoCarga + (tempo * plano.ma) + (tempo * plano.px) + (tempo * plano.ul) + (tempo * plano.jun),
        diasTotal: tempo > 0 ? (processoPecas + plano.ma + plano.px + plano.ul + plano.jun) : 0,
        planoMA: plano.ma,
        planoPX: plano.px,
        planoUL: plano.ul,
        planoJUN: plano.jun,
        cargaMA: tempo * plano.ma,
        cargaPX: tempo * plano.px,
        cargaUL: tempo * plano.ul,
        cargaJUN: tempo * plano.jun,
      };
    });
  }, [grupoRefs, planoPorRefMap, processoPorRefMap, tempoPorRefMap, seqgrupoPorRefMap, gruposPorReferenciaMap, capacidadeDiariaPorGrupoMap]);

  const gruposAnalise = useMemo<GrupoAnaliseRow[]>(() => {
    const detalhesPorGrupo = new Map<string, RefAnaliseRow[]>();
    for (const detalhe of detalhesRef) {
      if (!detalhesPorGrupo.has(detalhe.grupo)) detalhesPorGrupo.set(detalhe.grupo, []);
      detalhesPorGrupo.get(detalhe.grupo)!.push(detalhe);
    }
    return grupos
      .map((grupo) => {
        const refs = detalhesPorGrupo.get(grupo.grupo) || [];
        const capacidadeMA = Number(grupo.capacidade_diaria || 0) * Number(dias[String(periodos.MA)] || 0);
        const capacidadePX = Number(grupo.capacidade_diaria || 0) * Number(dias[String(periodos.PX)] || 0);
        const capacidadeUL = Number(grupo.capacidade_diaria || 0) * Number(dias[String(periodos.UL)] || 0);
        const processoPecas = refs.reduce((acc, r) => acc + r.processoPecas, 0);
        const processoCarga = refs.reduce((acc, r) => acc + r.processoCarga, 0);
        const cargaMAPlano = refs.reduce((acc, r) => acc + r.cargaMA, 0);
        const cargaMA = cargaMAPlano + processoCarga;
        const cargaPX = refs.reduce((acc, r) => acc + r.cargaPX, 0);
        const cargaUL = refs.reduce((acc, r) => acc + r.cargaUL, 0);
        const cargaJUN = refs.reduce((acc, r) => acc + r.cargaJUN, 0);
        const capacidadeJUN = cargaJUN > 0
          ? Number(grupo.capacidade_diaria || 0) * Number(dias[String(mesJunho)] || 0)
          : 0;
        const planoMA = refs.reduce((acc, r) => acc + r.planoMA, 0);
        const planoPX = refs.reduce((acc, r) => acc + r.planoPX, 0);
        const planoUL = refs.reduce((acc, r) => acc + r.planoUL, 0);
        const planoJUN = refs.reduce((acc, r) => acc + r.planoJUN, 0);
        const refsComTempo = refs.filter((r) => r.tempoSegundos > 0).length;
        const cargaTotal = cargaMA + cargaPX + cargaUL + cargaJUN;
        const capacidadeTotal = capacidadeMA + capacidadePX + capacidadeUL + capacidadeJUN;
        const saldoMA = capacidadeMA - cargaMA;
        const saldoAcumMA = saldoMA;
        const saldoAcumPX = saldoAcumMA + capacidadePX - cargaPX;
        const saldoAcumUL = saldoAcumPX + capacidadeUL - cargaUL;
        const saldoAcumJUN = saldoAcumUL + capacidadeJUN - cargaJUN;
        const atendimentoMA = cargaMA > 0 ? Math.max(0, Math.min(100, (capacidadeMA / cargaMA) * 100)) : 100;
        const atendimentoPX = cargaPX > 0 ? Math.max(0, Math.min(100, ((Math.max(0, saldoAcumMA) + capacidadePX) / cargaPX) * 100)) : 100;
        const atendimentoUL = cargaUL > 0 ? Math.max(0, Math.min(100, ((Math.max(0, saldoAcumPX) + capacidadeUL) / cargaUL) * 100)) : 100;
        const atendimentoJUN = cargaJUN > 0 ? Math.max(0, Math.min(100, ((Math.max(0, saldoAcumUL) + capacidadeJUN) / cargaJUN) * 100)) : 100;
        const diasNecMA = Number(grupo.capacidade_diaria || 0) > 0 ? (cargaMA / Number(grupo.capacidade_diaria || 0)) : 0;
        const diasNecPX = Number(grupo.capacidade_diaria || 0) > 0 ? (cargaPX / Number(grupo.capacidade_diaria || 0)) : 0;
        const diasNecUL = Number(grupo.capacidade_diaria || 0) > 0 ? (cargaUL / Number(grupo.capacidade_diaria || 0)) : 0;
        const diasNecJUN = Number(grupo.capacidade_diaria || 0) > 0 ? (cargaJUN / Number(grupo.capacidade_diaria || 0)) : 0;
        const diasTotal = diasNecMA + diasNecPX + diasNecUL + diasNecJUN;
        const atendimentoTotal = cargaTotal > 0 ? Math.max(0, Math.min(100, (capacidadeTotal / cargaTotal) * 100)) : 100;
        const diasFaltMA = Math.max(0, diasNecMA - Number(dias[String(periodos.MA)] || 0));
        const diasFaltPX = Math.max(0, diasNecPX - Number(dias[String(periodos.PX)] || 0) - Math.max(0, saldoAcumMA / Math.max(1, Number(grupo.capacidade_diaria || 0))));
        const diasFaltUL = Math.max(0, diasNecUL - Number(dias[String(periodos.UL)] || 0) - Math.max(0, saldoAcumPX / Math.max(1, Number(grupo.capacidade_diaria || 0))));
        const diasFaltJUN = Math.max(0, diasNecJUN - Number(dias[String(mesJunho)] || 0) - Math.max(0, saldoAcumUL / Math.max(1, Number(grupo.capacidade_diaria || 0))));
        const difCapacidadeAteAbr = (capacidadeMA + capacidadePX) - (processoCarga + cargaMAPlano + cargaPX);
        return {
          grupo: grupo.grupo,
          tipo: grupo.tipo || '-',
          pessoasIdeal: null,
          capacidadeDiaria: grupo.capacidade_diaria,
          refsMapeadas: refs.length,
          refsComTempo,
          processoPecas,
          processoCarga,
          cargaTotal,
          capacidadeTotal,
          atendimentoTotal,
          diasTotal,
          tempoMarco: cargaMAPlano,
          tempoAbril: cargaPX,
          tempoMaio: cargaUL,
          tempoPrp: processoCarga + cargaMAPlano + cargaPX + cargaUL,
          difCapacidadeFinal: (capacidadeMA + capacidadePX + capacidadeUL) - (processoCarga + cargaMAPlano + cargaPX + cargaUL),
          diasDif: Number(grupo.capacidade_diaria || 0) > 0
            ? (((capacidadeMA + capacidadePX + capacidadeUL) - (processoCarga + cargaMAPlano + cargaPX + cargaUL)) / Number(grupo.capacidade_diaria || 0))
            : 0,
          difCapacidadeAteAbr,
          diasDifAteAbr: Number(grupo.capacidade_diaria || 0) > 0
            ? (difCapacidadeAteAbr / Number(grupo.capacidade_diaria || 0))
            : 0,
          planoMA,
          planoPX,
          planoUL,
          planoJUN,
          cargaMA,
          cargaPX,
          cargaUL,
          cargaJUN,
          capacidadeMA,
          capacidadePX,
          capacidadeUL,
          capacidadeJUN,
          saldoMA,
          saldoPX: capacidadePX - cargaPX,
          saldoUL: capacidadeUL - cargaUL,
          saldoJUN: capacidadeJUN - cargaJUN,
          saldoAcumMA,
          saldoAcumPX,
          saldoAcumUL,
          saldoAcumJUN,
          atendimentoMA,
          atendimentoPX,
          atendimentoUL,
          atendimentoJUN,
          diasNecMA,
          diasNecPX,
          diasNecUL,
          diasNecJUN,
          diasFaltMA,
          diasFaltPX,
          diasFaltUL,
          diasFaltJUN,
        };
      })
      .filter((row) => {
        if (filtroGrupo && !row.grupo.includes(norm(filtroGrupo))) return false;
        if (filtroTipo !== 'TODOS' && row.tipo !== filtroTipo) return false;
        if (somenteEstourados && !(row.saldoAcumMA < 0 || row.saldoAcumPX < 0 || row.saldoAcumUL < 0 || row.saldoAcumJUN < 0)) return false;
        return true;
      })
      .sort((a, b) => a.grupo.localeCompare(b.grupo));
  }, [detalhesRef, grupos, dias, periodos, mesJunho, filtroGrupo, filtroTipo, somenteEstourados]);

  const detalhesRefFiltrados = useMemo(() => {
    const gruposVisiveis = new Set(gruposAnalise.map((g) => g.grupo));
    return detalhesRef
      .filter((row) => gruposVisiveis.has(row.grupo))
      .sort((a, b) => (a.grupo + a.referencia).localeCompare(b.grupo + b.referencia));
  }, [detalhesRef, gruposAnalise]);

  const auditoriaDetalheResumo = useMemo(() => {
    return detalhesRefFiltrados.reduce((acc, row) => ({
      refs: acc.refs + 1,
      processoPecas: acc.processoPecas + row.processoPecas,
      processoCarga: acc.processoCarga + row.processoCarga,
      planoMA: acc.planoMA + row.planoMA,
      cargaMA: acc.cargaMA + row.cargaMA,
      planoPX: acc.planoPX + row.planoPX,
      cargaPX: acc.cargaPX + row.cargaPX,
      planoUL: acc.planoUL + row.planoUL,
      cargaUL: acc.cargaUL + row.cargaUL,
      planoJUN: acc.planoJUN + row.planoJUN,
      cargaJUN: acc.cargaJUN + row.cargaJUN,
      cargaTotal: acc.cargaTotal + row.cargaTotal,
    }), {
      refs: 0,
      processoPecas: 0,
      processoCarga: 0,
      planoMA: 0,
      cargaMA: 0,
      planoPX: 0,
      cargaPX: 0,
      planoUL: 0,
      cargaUL: 0,
      planoJUN: 0,
      cargaJUN: 0,
      cargaTotal: 0,
    });
  }, [detalhesRefFiltrados]);

  const resumo = useMemo(() => {
    const base = gruposAnalise.reduce((acc, row) => ({
      grupos: acc.grupos + 1,
      refsMapeadas: acc.refsMapeadas + row.refsMapeadas,
      refsComTempo: acc.refsComTempo + row.refsComTempo,
      capacidadeDiariaTotal: acc.capacidadeDiariaTotal + row.capacidadeDiaria,
      capMA: acc.capMA + row.capacidadeMA,
      capPX: acc.capPX + row.capacidadePX,
      capUL: acc.capUL + row.capacidadeUL,
      capJUN: acc.capJUN + row.capacidadeJUN,
      cargaMA: acc.cargaMA + row.cargaMA,
      cargaPX: acc.cargaPX + row.cargaPX,
      cargaUL: acc.cargaUL + row.cargaUL,
      cargaJUN: acc.cargaJUN + row.cargaJUN,
      tempoTotal: acc.tempoTotal + row.tempoPrp,
      capacidadeTotal: acc.capacidadeTotal + row.capacidadeTotal,
    }), {
      grupos: 0,
      refsMapeadas: 0,
      refsComTempo: 0,
      capacidadeDiariaTotal: 0,
      capMA: 0,
      capPX: 0,
      capUL: 0,
      capJUN: 0,
      cargaMA: 0,
      cargaPX: 0,
      cargaUL: 0,
      cargaJUN: 0,
      tempoTotal: 0,
      capacidadeTotal: 0,
    });
    const diasDisponiveis = Number(dias[String(periodos.MA)] || 0)
      + Number(dias[String(periodos.PX)] || 0)
      + Number(dias[String(periodos.UL)] || 0)
      + (base.capJUN > 0 ? Number(dias[String(mesJunho)] || 0) : 0);
    const diasNecessariosTotal = base.capacidadeDiariaTotal > 0
      ? (base.tempoTotal / base.capacidadeDiariaTotal)
      : 0;
    const diasFaltantesHoje = diasNecessariosTotal - diasDisponiveis;
    return {
      ...base,
      diasDisponiveis,
      diasNecessariosTotal,
      diasFaltantesHoje,
    };
  }, [gruposAnalise, dias, periodos, mesJunho]);

  const gruposPorTipo = useMemo(() => {
    const map = new Map<string, {
      tipo: string;
      grupos: number;
      refsMapeadas: number;
      processoPecas: number;
      processoCarga: number;
      capacidadeMA: number;
      cargaMA: number;
      saldoAcumMA: number;
      capacidadePX: number;
      cargaPX: number;
      saldoAcumPX: number;
      capacidadeUL: number;
      cargaUL: number;
      saldoAcumUL: number;
      capacidadeJUN: number;
      cargaJUN: number;
      saldoAcumJUN: number;
    }>();

    for (const row of gruposAnalise) {
      const key = row.tipo || '-';
      const acc = map.get(key) || {
        tipo: key,
        grupos: 0,
        refsMapeadas: 0,
        processoPecas: 0,
        processoCarga: 0,
        capacidadeMA: 0,
        cargaMA: 0,
        saldoAcumMA: 0,
        capacidadePX: 0,
        cargaPX: 0,
        saldoAcumPX: 0,
        capacidadeUL: 0,
        cargaUL: 0,
        saldoAcumUL: 0,
        capacidadeJUN: 0,
        cargaJUN: 0,
        saldoAcumJUN: 0,
      };
      acc.grupos += 1;
      acc.refsMapeadas += row.refsMapeadas;
      acc.processoPecas += row.processoPecas;
      acc.processoCarga += row.processoCarga;
      acc.capacidadeMA += row.capacidadeMA;
      acc.cargaMA += row.cargaMA;
      acc.saldoAcumMA += row.saldoAcumMA;
      acc.capacidadePX += row.capacidadePX;
      acc.cargaPX += row.cargaPX;
      acc.saldoAcumPX += row.saldoAcumPX;
      acc.capacidadeUL += row.capacidadeUL;
      acc.cargaUL += row.cargaUL;
      acc.saldoAcumUL += row.saldoAcumUL;
      acc.capacidadeJUN += row.capacidadeJUN;
      acc.cargaJUN += row.cargaJUN;
      acc.saldoAcumJUN += row.saldoAcumJUN;
      map.set(key, acc);
    }
    return Array.from(map.values()).sort((a, b) => a.tipo.localeCompare(b.tipo));
  }, [gruposAnalise]);

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';
  const tipos = useMemo(() => Array.from(new Set(grupos.map((g) => g.tipo || '-').filter(Boolean))).sort(), [grupos]);
  const gruposOptions = useMemo(() => Array.from(new Set(grupos.map((g) => g.grupo || '').filter(Boolean))).sort(), [grupos]);

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 min-w-0 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="bg-brand-primary shadow-sm px-6 py-3">
          <h1 className="text-white font-bold font-secondary tracking-wide text-base">CAPACIDADE</h1>
          <p className="text-white/70 text-xs">Costura por grupo, tipo e referência com dias produtivos por mês</p>
        </header>

        <main className="flex-1 min-w-0 px-6 py-5 space-y-4">
          {loading && <div className="bg-white rounded-lg border p-4 text-sm text-gray-500">Carregando capacidade...</div>}
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}
          {okMsg && <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700">{okMsg}</div>}

          <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap gap-3 items-end relative z-20">
            <div className="min-w-[280px] relative">
              <label className="block text-xs font-semibold text-brand-dark mb-1">Simulação aprovada</label>
              <button
                type="button"
                onClick={() => setAbrirSeletorAprovadas((v) => !v)}
                className="w-full flex items-center justify-between rounded border border-gray-300 px-3 py-2 text-xs text-gray-700 bg-white"
              >
                <span>Selecionadas: {aprovadasSelecionadasIds.length}/{aprovadas.length}</span>
                <span>{abrirSeletorAprovadas ? '▲' : '▼'}</span>
              </button>
              {abrirSeletorAprovadas && (
                <div className="absolute left-0 right-0 top-full mt-1 rounded-lg border border-gray-200 bg-white shadow-lg z-[120] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-gray-500">Escolha as simulações</span>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setAprovadasSelecionadasIds(aprovadas.map((a) => a.id))} className="text-[11px] px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-100">Todas</button>
                      <button type="button" onClick={() => setAprovadasSelecionadasIds([])} className="text-[11px] px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-100">Limpar</button>
                    </div>
                  </div>
                  <div className="max-h-52 overflow-auto space-y-1">
                    {aprovadas.map((a) => (
                      <label key={a.id} className="flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={aprovadasSelecionadasIds.includes(a.id)}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setAprovadasSelecionadasIds((prev) => checked ? [...prev, a.id] : prev.filter((id) => id !== a.id));
                          }}
                        />
                        <span>
                          <span className="font-semibold text-brand-dark">{a.nome || 'Simulação'}</span>
                          <span className="block text-[11px] text-gray-500">{new Date(a.createdAt).toLocaleString('pt-BR')}</span>
                        </span>
                      </label>
                    ))}
                    {aprovadas.length === 0 && <div className="text-[11px] text-gray-500">Nenhuma simulação aprovada.</div>}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setAplicarAprovadas((v) => !v)}
              className={`px-3 py-2 text-xs font-semibold rounded border ${
                aplicarAprovadas
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  : 'border-gray-300 bg-white text-gray-700'
              }`}
            >
              {aplicarAprovadas ? 'Aplicada' : 'Aplicar cálculos'}
            </button>

            <div className="text-xs text-gray-600">
              Itens com plano aprovado: <strong>{planosAprovadosMap.size.toLocaleString('pt-BR')}</strong>
            </div>
          </div>

          <div className="bg-white rounded-[20px] border border-stone-200 shadow-sm overflow-hidden">
            <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_2fr_1.4fr]">
              <section className="p-5 bg-[linear-gradient(145deg,#f7f3ef_0%,#ffffff_75%)] border-b xl:border-b-0 xl:border-r border-stone-200">
                <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Estrutura</div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-stone-200 bg-white/90 p-4">
                    <div className="text-[11px] uppercase tracking-wide text-stone-500">Grupos</div>
                    <div className="mt-2 text-3xl font-bold text-brand-dark">{fmtInt(resumo.grupos)}</div>
                  </div>
                  <div className="rounded-2xl border border-stone-200 bg-white/90 p-4">
                    <div className="text-[11px] uppercase tracking-wide text-stone-500">Refs</div>
                    <div className="mt-2 text-3xl font-bold text-brand-dark">{fmtInt(resumo.refsMapeadas)}</div>
                    <div className="mt-1 text-[11px] text-stone-500">Com tempo: {fmtInt(resumo.refsComTempo)}</div>
                  </div>
                  <div className="rounded-2xl border border-stone-200 bg-white/90 p-4 col-span-2">
                    <div className="text-[11px] uppercase tracking-wide text-stone-500">Capacidade diária total</div>
                    <div className="mt-2 text-3xl font-bold text-brand-dark">{fmtInt(resumo.capacidadeDiariaTotal)}</div>
                    <div className="mt-1 text-[11px] text-stone-500">Soma dos grupos filtrados</div>
                  </div>
                </div>
              </section>

              <section className="p-5 bg-[linear-gradient(180deg,#fffdf8_0%,#ffffff_100%)] border-b xl:border-b-0 xl:border-r border-stone-200">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Carga por Horizonte</div>
                  <div className="text-xs text-stone-500">Carga x capacidade do mesmo mês</div>
                </div>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { label: nomeMes(periodos.MA), carga: resumo.cargaMA, cap: resumo.capMA },
                    { label: nomeMes(periodos.PX), carga: resumo.cargaPX, cap: resumo.capPX },
                    { label: nomeMes(periodos.UL), carga: resumo.cargaUL, cap: resumo.capUL },
                    { label: nomeMes(mesJunho), carga: resumo.cargaJUN, cap: resumo.capJUN },
                  ].map((card) => {
                    const delta = card.carga - card.cap;
                    return (
                      <div key={card.label} className="rounded-2xl border border-stone-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] uppercase tracking-wide text-stone-500">{card.label}</div>
                          <div className={`text-xs font-semibold ${toneClass(delta)}`}>
                            {delta > 0 ? 'Acima da cap.' : delta < 0 ? 'Folga' : 'No limite'}
                          </div>
                        </div>
                        <div className="mt-3 text-2xl font-bold text-brand-dark">{fmtInt(card.carga)}</div>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-stone-500">
                          <span>Cap.: {fmtInt(card.cap)}</span>
                          <span className={toneClass(delta)}>Delta: {fmtInt(delta)}</span>
                        </div>
                        <div className="mt-3 h-2 rounded-full bg-stone-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${delta > 0 ? 'bg-rose-500' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.max(6, Math.min(100, card.cap > 0 ? (card.carga / card.cap) * 100 : 0))}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="p-5 bg-[radial-gradient(circle_at_top,#f3efe9_0%,#ffffff_68%)]">
                <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500">Capacidade Consolidada</div>
                <div className="mt-4 rounded-[24px] border border-stone-200 bg-white p-5">
                  <div className="text-[11px] uppercase tracking-wide text-stone-500">Tempo total</div>
                  <div className="mt-2 text-4xl font-bold text-brand-dark">{resumo.tempoTotal.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</div>
                  <div className="mt-1 text-[11px] text-stone-500">PRP acumulado</div>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-stone-50 p-4">
                      <div className="text-[11px] uppercase tracking-wide text-stone-500">Capacidade total</div>
                      <div className="mt-2 text-2xl font-bold text-brand-dark">{fmtInt(resumo.capacidadeTotal)}</div>
                      <div className="mt-1 text-[11px] text-stone-500">Dias disp.: {resumo.diasDisponiveis.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</div>
                    </div>
                    <div className="rounded-2xl bg-stone-50 p-4">
                      <div className="text-[11px] uppercase tracking-wide text-stone-500">Dias necessários</div>
                      <div className="mt-2 text-2xl font-bold text-brand-dark">{resumo.diasNecessariosTotal.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</div>
                      <div className={`mt-1 text-[11px] font-semibold ${toneClass(resumo.diasFaltantesHoje)}`}>
                        Faltam hoje: {resumo.diasFaltantesHoje.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 p-4">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-stone-500">Tempo total / Cap. diária total</span>
                      <span className="font-semibold text-brand-dark">
                        {resumo.tempoTotal.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} / {fmtInt(resumo.capacidadeDiariaTotal)}
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
              <div>
                <div className="text-xs font-semibold text-brand-dark">Upload grupos x capacidade diária</div>
                <div className="text-[11px] text-gray-500">Formato: `grupo,capacidade_diaria,tipo`</div>
              </div>
              <input
                type="file"
                accept=".csv,.txt"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUploadGrupos(f);
                }}
                className="text-xs"
              />
              <div className="flex items-center gap-3">
                <button onClick={salvarGrupos} disabled={saving || previewGrupos.length === 0} className="px-3 py-2 text-xs font-semibold bg-brand-primary text-white rounded hover:bg-brand-secondary disabled:opacity-60">
                  {saving ? 'Salvando...' : 'Salvar grupos'}
                </button>
                <div className="text-xs text-gray-600">Prévia: <strong>{fmtInt(previewGrupos.length)}</strong></div>
                <div className="text-xs text-gray-600">Atual: <strong>{fmtInt(grupos.length)}</strong></div>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
              <div>
                <div className="text-xs font-semibold text-brand-dark">Upload grupo x referência</div>
                <div className="text-[11px] text-gray-500">Formato: `grupo,ref` ou `grupo,referencia`</div>
              </div>
              <input
                type="file"
                accept=".csv,.txt"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUploadGrupoRefs(f);
                }}
                className="text-xs"
              />
              <div className="flex items-center gap-3">
                <button onClick={salvarGrupoRefs} disabled={saving || previewGrupoRefs.length === 0} className="px-3 py-2 text-xs font-semibold bg-brand-primary text-white rounded hover:bg-brand-secondary disabled:opacity-60">
                  {saving ? 'Salvando...' : 'Salvar grupo/ref'}
                </button>
                <div className="text-xs text-gray-600">Prévia: <strong>{fmtInt(previewGrupoRefs.length)}</strong></div>
                <div className="text-xs text-gray-600">Atual: <strong>{fmtInt(grupoRefs.length)}</strong></div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <div className="text-xs font-semibold text-brand-dark">Dias produtivos por mês</div>
                <div className="text-[11px] text-gray-500">Base para multiplicar a capacidade diária dos grupos</div>
              </div>
              <button onClick={salvarDias} disabled={saving} className="px-3 py-2 text-xs font-semibold bg-brand-primary text-white rounded hover:bg-brand-secondary disabled:opacity-60">
                {saving ? 'Salvando...' : 'Salvar dias'}
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((mes) => (
                <label key={mes} className="text-xs text-gray-600">
                  {nomeMes(mes)}
                  <input
                    type="number"
                    min={0}
                    value={Number(dias[String(mes)] || 0)}
                    onChange={(e) => setDias((prev) => ({ ...prev, [String(mes)]: Number(e.target.value || 0) }))}
                    className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-xs text-gray-600">
                Grupo
                <select value={filtroGrupo} onChange={(e) => setFiltroGrupo(e.target.value)} className="mt-1 border border-gray-300 rounded px-2 py-1.5 min-w-[20rem]">
                  <option value="">TODOS</option>
                  {gruposOptions.map((grupo) => <option key={grupo} value={grupo}>{grupo}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-600">
                Tipo
                <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="mt-1 border border-gray-300 rounded px-2 py-1.5 w-40">
                  <option value="TODOS">TODOS</option>
                  {tipos.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
                </select>
              </label>
              <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                <input type="checkbox" checked={somenteEstourados} onChange={(e) => setSomenteEstourados(e.target.checked)} />
                Mostrar só grupos estourados
              </label>
              <div className="text-xs text-gray-500">
                Base fixa: <span className="font-semibold text-brand-dark">{MARCA_FIXA}</span> · <span className="font-semibold text-brand-dark">{STATUS_FIXO}</span> · sem MEIA DE SEDA
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 text-xs font-semibold text-brand-dark">
              Total por tipo
            </div>
            <div className="max-h-[24vh] overflow-auto border-b border-gray-200">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-gray-100 z-10">
                  <tr>
                    <th className="text-left px-3 py-2">Tipo</th>
                    <th className="text-right px-3 py-2">Grupos</th>
                    <th className="text-right px-3 py-2">Refs</th>
                    <th className="text-right px-3 py-2">Proc. peças</th>
                    <th className="text-right px-3 py-2">Proc. carga</th>
                    <th className="text-right px-3 py-2">Saldo Ac. {nomeMes(periodos.MA)}</th>
                    <th className="text-right px-3 py-2">Saldo Ac. {nomeMes(periodos.PX)}</th>
                    <th className="text-right px-3 py-2">Saldo Ac. {nomeMes(periodos.UL)}</th>
                    <th className="text-right px-3 py-2">Saldo Ac. {nomeMes(mesJunho)}</th>
                  </tr>
                </thead>
                <tbody>
                  {gruposPorTipo.map((row, idx) => (
                    <tr key={row.tipo} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
                      <td className="px-3 py-2 font-semibold">{row.tipo}</td>
                      <td className="px-3 py-2 text-right">{fmtInt(row.grupos)}</td>
                      <td className="px-3 py-2 text-right">{fmtInt(row.refsMapeadas)}</td>
                      <td className="px-3 py-2 text-right">{fmtInt(row.processoPecas)}</td>
                      <td className="px-3 py-2 text-right">{fmtInt(row.processoCarga)}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${row.saldoAcumMA < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmtInt(row.saldoAcumMA)}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${row.saldoAcumPX < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmtInt(row.saldoAcumPX)}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${row.saldoAcumUL < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmtInt(row.saldoAcumUL)}</td>
                      <td className={`px-3 py-2 text-right font-semibold ${row.saldoAcumJUN < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmtInt(row.saldoAcumJUN)}</td>
                    </tr>
                  ))}
                  {gruposPorTipo.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-gray-500">Sem tipos para exibir.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 text-xs font-semibold text-brand-dark">
              Capacidade por grupo
            </div>
            <div className="max-h-[42vh] overflow-auto">
	              <table className="min-w-full text-xs">
	                <thead className="sticky top-0 bg-gray-100 z-10">
	                  <tr>
	                    <th className="text-left px-3 py-2">Tipo</th>
	                    <th className="text-left px-3 py-2">Grupo</th>
	                    <th className="text-right px-3 py-2">Cap. diária</th>
	                    <th className="text-right px-3 py-2">Pessoas ideal</th>
	                    <th className="text-right px-3 py-2">Processo</th>
	                    <th className="text-right px-3 py-2">Soma tempo processo</th>
	                    <th className="text-right px-3 py-2">Soma tempo março</th>
	                    <th className="text-right px-3 py-2">Soma tempo abril</th>
	                    <th className="text-right px-3 py-2">Soma tempo maio</th>
	                    <th className="text-right px-3 py-2">Tempo PRP</th>
	                    <th className="text-right px-3 py-2">Capacidade</th>
	                    <th className="text-right px-3 py-2">Dias</th>
	                    <th className="text-right px-3 py-2">Dif capacidade final</th>
	                    <th className="text-right px-3 py-2">Dias dif</th>
	                    <th className="text-right px-3 py-2">Dias dif até abr</th>
	                  </tr>
	                </thead>
	                <tbody>
	                  {gruposAnalise.map((row, idx) => (
	                    <tr key={row.grupo} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
	                      <td className="px-3 py-2">{row.tipo}</td>
	                      <td className="px-3 py-2 font-semibold">{row.grupo}</td>
	                      <td className="px-3 py-2 text-right">{fmtInt(row.capacidadeDiaria)}</td>
	                      <td className="px-3 py-2 text-right">{row.pessoasIdeal === null ? '-' : fmtInt(row.pessoasIdeal)}</td>
	                      <td className="px-3 py-2 text-right">{fmtInt(row.processoPecas)}</td>
	                      <td className="px-3 py-2 text-right">{row.processoCarga.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
	                      <td className="px-3 py-2 text-right">{row.tempoMarco.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
	                      <td className="px-3 py-2 text-right">{row.tempoAbril.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
	                      <td className="px-3 py-2 text-right">{row.tempoMaio.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
	                      <td className="px-3 py-2 text-right font-semibold text-brand-dark">{row.tempoPrp.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
	                      <td className="px-3 py-2 text-right">{fmtInt(row.capacidadeMA + row.capacidadePX + row.capacidadeUL)}</td>
	                      <td className="px-3 py-2 text-right">{row.diasTotal.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
	                      <td className={`px-3 py-2 text-right font-semibold ${row.difCapacidadeFinal < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{row.difCapacidadeFinal.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
	                      <td className={`px-3 py-2 text-right font-semibold ${row.diasDif < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{row.diasDif.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
	                      <td className={`px-3 py-2 text-right font-semibold ${row.diasDifAteAbr < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{row.diasDifAteAbr.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
	                    </tr>
	                  ))}
	                  {gruposAnalise.length === 0 && (
	                    <tr>
	                      <td colSpan={15} className="px-3 py-8 text-center text-gray-500">Sem grupos para exibir.</td>
	                    </tr>
	                  )}
                </tbody>
                {gruposAnalise.length > 0 && (
                  <tfoot className="sticky bottom-0 bg-sky-50 border-t-2 border-sky-200">
                    <tr className="font-semibold text-brand-dark">
                      <td className="px-3 py-2" colSpan={2}>Total ({fmtInt(resumo.grupos)} grupos)</td>
                      <td className="px-3 py-2 text-right">{fmtInt(resumo.capacidadeDiariaTotal)}</td>
                      <td className="px-3 py-2 text-right">-</td>
                      <td className="px-3 py-2 text-right">{fmtInt(gruposAnalise.reduce((acc, row) => acc + row.processoPecas, 0))}</td>
                      <td className="px-3 py-2 text-right">{gruposAnalise.reduce((acc, row) => acc + row.processoCarga, 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
                      <td className="px-3 py-2 text-right">{gruposAnalise.reduce((acc, row) => acc + row.tempoMarco, 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
                      <td className="px-3 py-2 text-right">{gruposAnalise.reduce((acc, row) => acc + row.tempoAbril, 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
                      <td className="px-3 py-2 text-right">{gruposAnalise.reduce((acc, row) => acc + row.tempoMaio, 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
                      <td className="px-3 py-2 text-right">{resumo.tempoTotal.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
                      <td className="px-3 py-2 text-right">{fmtInt(resumo.capacidadeTotal)}</td>
                      <td className="px-3 py-2 text-right">{resumo.diasNecessariosTotal.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                      <td className={`px-3 py-2 text-right ${resumo.capacidadeTotal - resumo.tempoTotal < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{(resumo.capacidadeTotal - resumo.tempoTotal).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
                      <td className={`px-3 py-2 text-right ${resumo.diasFaltantesHoje > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{resumo.diasFaltantesHoje.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                      <td className={`px-3 py-2 text-right ${gruposAnalise.reduce((acc, row) => acc + row.diasDifAteAbr, 0) < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                        {gruposAnalise.reduce((acc, row) => acc + row.diasDifAteAbr, 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 text-xs font-semibold text-brand-dark">
              Auditoria por referência
            </div>
            <div className="max-h-[42vh] overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-gray-100 z-10">
                  <tr>
                    <th className="text-left px-3 py-2">Grupo</th>
                    <th className="text-left px-3 py-2">Ref</th>
                    <th className="text-left px-3 py-2">Seqgrupo</th>
                    <th className="text-right px-3 py-2">% rateio</th>
                    <th className="text-right px-3 py-2">Tempo</th>
                    <th className="text-right px-3 py-2">Processo</th>
                    <th className="text-right px-3 py-2">Tempo processo</th>
                    <th className="text-right px-3 py-2">Plano {nomeMes(periodos.MA)}</th>
                    <th className="text-right px-3 py-2">Tempo {nomeMes(periodos.MA)}</th>
                    <th className="text-right px-3 py-2">Plano {nomeMes(periodos.PX)}</th>
                    <th className="text-right px-3 py-2">Tempo {nomeMes(periodos.PX)}</th>
                    <th className="text-right px-3 py-2">Plano {nomeMes(periodos.UL)}</th>
                    <th className="text-right px-3 py-2">Tempo {nomeMes(periodos.UL)}</th>
                    <th className="text-right px-3 py-2">Plano {nomeMes(mesJunho)}</th>
                    <th className="text-right px-3 py-2">Tempo {nomeMes(mesJunho)}</th>
                    <th className="text-right px-3 py-2">Tempo total</th>
                  </tr>
                </thead>
                <tbody>
                  {detalhesRefFiltrados.map((row, idx) => (
                    <tr key={`${row.grupo}-${row.referencia}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
                      <td className="px-3 py-2 font-semibold">{row.grupo}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => carregarTempoDebug(row.referencia)}
                          className={`font-semibold ${debugRef === row.referencia ? 'text-brand-primary underline' : 'text-brand-dark hover:underline'}`}
                        >
                          {row.referencia}
                        </button>
                      </td>
                      <td className="px-3 py-2">{row.idreferencia || '-'}</td>
                      <td className="px-3 py-2 text-right">{(row.rateio * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</td>
                      <td className={`px-3 py-2 text-right ${row.tempoSegundos <= 0 ? 'text-red-700 font-semibold' : ''}`}>{row.tempoSegundos.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right">{fmtInt(row.processoPecas)}</td>
                      <td className="px-3 py-2 text-right">{row.processoCarga.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right">{fmtInt(row.planoMA)}</td>
                      <td className="px-3 py-2 text-right">{row.cargaMA.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right">{fmtInt(row.planoPX)}</td>
                      <td className="px-3 py-2 text-right">{row.cargaPX.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right">{fmtInt(row.planoUL)}</td>
                      <td className="px-3 py-2 text-right">{row.cargaUL.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right">{fmtInt(row.planoJUN)}</td>
                      <td className="px-3 py-2 text-right">{row.cargaJUN.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right font-semibold text-brand-dark">{row.cargaTotal.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                  {detalhesRefFiltrados.length === 0 && (
                    <tr>
                      <td colSpan={16} className="px-3 py-8 text-center text-gray-500">Sem vínculos grupo/ref para exibir.</td>
                    </tr>
                  )}
                </tbody>
                {detalhesRefFiltrados.length > 0 && (
                  <tfoot className="sticky bottom-0 bg-amber-50 border-t-2 border-amber-200">
                    <tr className="font-semibold text-brand-dark">
                      <td className="px-3 py-2" colSpan={3}>Total ({fmtInt(auditoriaDetalheResumo.refs)} refs)</td>
                      <td className="px-3 py-2 text-right">-</td>
                      <td className="px-3 py-2 text-right">-</td>
                      <td className="px-3 py-2 text-right">{fmtInt(auditoriaDetalheResumo.processoPecas)}</td>
                      <td className="px-3 py-2 text-right">{auditoriaDetalheResumo.processoCarga.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right">{fmtInt(auditoriaDetalheResumo.planoMA)}</td>
                      <td className="px-3 py-2 text-right">{auditoriaDetalheResumo.cargaMA.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right">{fmtInt(auditoriaDetalheResumo.planoPX)}</td>
                      <td className="px-3 py-2 text-right">{auditoriaDetalheResumo.cargaPX.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right">{fmtInt(auditoriaDetalheResumo.planoUL)}</td>
                      <td className="px-3 py-2 text-right">{auditoriaDetalheResumo.cargaUL.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right">{fmtInt(auditoriaDetalheResumo.planoJUN)}</td>
                      <td className="px-3 py-2 text-right">{auditoriaDetalheResumo.cargaJUN.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right">{auditoriaDetalheResumo.cargaTotal.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-brand-dark">Depuração do cálculo do tempo</div>
                <div className="text-[11px] text-gray-500">
                  Clique na referência da auditoria para abrir as operações que compõem o tempo.
                </div>
              </div>
              <div className="text-xs text-gray-600">
                Ref: <span className="font-semibold text-brand-dark">{debugRef || '-'}</span> · Tempo total: <span className="font-semibold text-brand-dark">{debugTotal.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</span>
              </div>
            </div>
            <div className="max-h-[34vh] overflow-auto">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-gray-100 z-10">
                  <tr>
                    <th className="text-left px-3 py-2">Seqgrupo</th>
                    <th className="text-left px-3 py-2">Ref</th>
                    <th className="text-left px-3 py-2">Tipo op.</th>
                    <th className="text-left px-3 py-2">Op.</th>
                    <th className="text-right px-3 py-2">qt_op</th>
                    <th className="text-right px-3 py-2">hr_tempo</th>
                    <th className="text-right px-3 py-2">hr_tempopadrao</th>
                    <th className="text-right px-3 py-2">Tempo resolvido</th>
                  </tr>
                </thead>
                <tbody>
                  {debugRows.map((row, idx) => (
                    <tr key={`${row.idreferencia}-${row.cd_operacao}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
                      <td className="px-3 py-2">{row.idreferencia}</td>
                      <td className="px-3 py-2">{row.referencia_padrao}</td>
                      <td className="px-3 py-2">{row.ds_tipooperacao || '-'}</td>
                      <td className="px-3 py-2">{row.cd_operacao} {row.ds_operacao ? `· ${row.ds_operacao}` : ''}</td>
                      <td className="px-3 py-2 text-right">{row.qt_operacao.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-right">{row.hr_tempo || '-'}</td>
                      <td className="px-3 py-2 text-right">{row.hr_tempopadrao || '-'}</td>
                      <td className="px-3 py-2 text-right font-semibold text-brand-dark">{row.tempo_resolvido.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</td>
                    </tr>
                  ))}
                  {!debugLoading && debugRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-gray-500">Selecione uma referência na auditoria para abrir o cálculo do tempo.</td>
                    </tr>
                  )}
                  {debugLoading && (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-gray-500">Carregando cálculo do tempo...</td>
                    </tr>
                  )}
                </tbody>
                {debugRows.length > 0 && (
                  <tfoot className="sticky bottom-0 bg-amber-50 border-t-2 border-amber-200">
                    <tr className="font-semibold text-brand-dark">
                      <td className="px-3 py-2" colSpan={7}>Total</td>
                      <td className="px-3 py-2 text-right">{debugTotal.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
