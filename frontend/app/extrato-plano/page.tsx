'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { apiErrorMessage, fetchNoCache } from '../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

interface RotacaoPeriodo {
  de: string;
  para: string;
  preservados: number;
  alterados: number;
  inseridos: number;
  produzidos: number;
  limbos: number;
  pecasLimbo: number;
  delta: number;
}

interface RotacaoTransicao {
  mes: string;
  antes: string;
  depois: string;
  diasEntre: number;
  status: 'CRITICA' | 'COM_INSERCOES' | 'ROTACAO_OK';
  limbos: number;
  inseridos: number;
  alterados: number;
  produzidos: number;
  preservados: number;
  novosPlanos: number;
  porPeriodo: RotacaoPeriodo[];
}

interface RotacaoResumo {
  preservados: number;
  alterados: number;
  inseridos: number;
  produzidos: number;
  limbos: number;
  pecasLimbo: number;
  novosPlanos: number;
  skusAfetados: number;
  transicoesAnalisadas: number;
  transicoesCriticas: number;
  viradasForaJanela: number;
  diasForaJanela: number;
}

interface RotacaoPayload {
  success: boolean;
  rotacao: RotacaoResumo;
  transicoes: RotacaoTransicao[];
}

// Tipos para detalhamento
interface AlteracaoRow {
  cdProduto: string;
  periodo: string;
  mes: string;
  referencia: string;
  produto: string;
  cor: string;
  tamanho: string;
  qtdAbertoDe: number;
  qtdAbertoAte: number;
  deltaAberto: number;
  tipo: 'ADICIONADO' | 'RETIRADO' | 'AUMENTADO' | 'REDUZIDO' | 'SEM_ALTERACAO';
}

interface MpRow {
  idmateriaprima: string;
  nome: string;
  artigo: string;
  deltaTotal: number;
  estoquetotal: number;
  comprasPendentes: number;
  risco: string;
}

interface ImpactoPayload {
  success: boolean;
  alteracoes?: AlteracaoRow[];
  impactoMp?: MpRow[];
}

type RotacaoDetalheTipo = 'PRESERVADO' | 'ALTERADO' | 'INSERIDO' | 'PRODUZIDO' | 'LIMBO';

interface RotacaoDetalheRow {
  sku: string;
  referencia: string;
  produto: string;
  cor: string;
  tamanho: string;
  de: string;
  para: string;
  antes: number;
  depois: number;
  delta: number;
  tipo: RotacaoDetalheTipo;
  ops?: string[];
}

interface RotacaoDetalhePayload {
  success: boolean;
  resumo: {
    preservados: number;
    alterados: number;
    inseridos: number;
    produzidos: number;
    limbos: number;
    inseridosDoZero: number;
  };
  categorias: {
    PRESERVADOS: RotacaoDetalheRow[];
    ALTERADOS: RotacaoDetalheRow[];
    INSERIDOS: RotacaoDetalheRow[];
    PRODUZIDOS: RotacaoDetalheRow[];
    LIMBOS: RotacaoDetalheRow[];
  };
  data?: RotacaoDetalheRow[];
}

interface OpsAntigasPayload {
  success: boolean;
  totais?: {
    qtdTotal: number;
    opsCount: number;
  };
  porFaixa?: Record<string, { qtd: number; ops: number }>;
  data?: Array<{
    cdProduto: string | number;
    nrOp: string | number;
    nrCiclo: string | number;
    dtInicio: string;
    diasEmProcesso: number;
    qtdEmProcesso: number;
    descricao: string;
    referencia: string;
  }>;
}

function fmt(v: number, d = 0) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtDate(value: string) {
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y?.slice(2)}`;
}

function getMesNome(dataIso: string) {
  const [, m] = dataIso.split('-');
  return MESES[parseInt(m, 10) - 1] || '';
}

function getAnoMes(dataIso: string) {
  const [y, m] = dataIso.split('-');
  return `${MESES[parseInt(m, 10) - 1]}/${y}`;
}

function tipoClass(tipo: string) {
  if (tipo === 'PRESERVADO') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (tipo === 'ALTERADO') return 'bg-blue-100 text-blue-700 border-blue-200';
  if (tipo === 'INSERIDO') return 'bg-amber-100 text-amber-700 border-amber-200';
  if (tipo === 'PRODUZIDO') return 'bg-cyan-100 text-cyan-700 border-cyan-200';
  if (tipo === 'LIMBO') return 'bg-red-100 text-red-700 border-red-200';
  if (tipo === 'ADICIONADO') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (tipo === 'RETIRADO') return 'bg-red-100 text-red-700 border-red-200';
  if (tipo === 'AUMENTADO') return 'bg-blue-100 text-blue-700 border-blue-200';
  if (tipo === 'REDUZIDO') return 'bg-orange-100 text-orange-700 border-orange-200';
  return 'bg-gray-100 text-gray-600 border-gray-200';
}

function prioridadeVirada(t: RotacaoTransicao | null) {
  if (!t) return { tone: 'gray', label: 'Sem dados', texto: 'Selecione uma virada para analisar.' };
  if (t.limbos > 0) return { tone: 'red', label: 'Investigar perdas', texto: `${fmt(t.limbos)} SKUs ficaram em limbo. Verifique se viraram OP, estoque ou se foram removidos sem justificativa.` };
  if (t.inseridos > 20) return { tone: 'amber', label: 'Revisar inserções', texto: `${fmt(t.inseridos)} SKUs entraram do zero na virada. Confirme se são plano novo válido.` };
  if (t.alterados > 0) return { tone: 'blue', label: 'Conferir ajustes', texto: `${fmt(t.alterados)} SKUs mudaram quantidade na virada. Foque nos maiores deltas.` };
  return { tone: 'emerald', label: 'Virada saudável', texto: 'Não há limbo relevante na virada selecionada.' };
}

export default function ExtratoPlanoPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [ano, setAno] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<RotacaoPayload | null>(null);
  const [viradaSelecionada, setViradaSelecionada] = useState<RotacaoTransicao | null>(null);
  const [opsAntigas, setOpsAntigas] = useState<OpsAntigasPayload | null>(null);

  // Estado para detalhes
  const [loadingDetalhes, setLoadingDetalhes] = useState(false);
  const [detalhes, setDetalhes] = useState<ImpactoPayload | null>(null);
  const [detalheRotacao, setDetalheRotacao] = useState<RotacaoDetalhePayload | null>(null);
  const [tabDetalhe, setTabDetalhe] = useState<'posicoes' | 'skus' | 'mp'>('posicoes');
  const [filtroTipo, setFiltroTipo] = useState<'TODOS' | RotacaoDetalheTipo>('TODOS');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregarDados();
  }, [ano]);

  useEffect(() => {
    if (viradaSelecionada) {
      carregarDetalhes(viradaSelecionada);
    }
  }, [viradaSelecionada]);

  async function carregarDados() {
    setLoading(true);
    setError(null);
    try {
      // Mantem o snapshot de dezembro anterior para calcular corretamente a virada de janeiro.
      const de = `${ano - 1}-12-20`;
      const ate = `${ano}-12-31`;
      const params = new URLSearchParams({ de, ate, limit: '100' });
      const [rotacaoResult, opsResult] = await Promise.allSettled([
        fetchNoCache(
        `${API_URL}/api/analises/snapshot-lotes/rotacao-anual?${params}`,
        { headers: authHeaders() },
        180000
        ),
        fetchNoCache(
          `${API_URL}/api/producao/ops-antigas?dias=20&marca=LIEBE&status=EM%20LINHA,NOVA%20COLECAO`,
          { headers: authHeaders() },
          120000
        ),
      ]);
      if (rotacaoResult.status !== 'fulfilled') throw new Error('Erro ao carregar viradas do ano');
      const res = rotacaoResult.value;
      const json = await res.json() as RotacaoPayload & { error?: string };
      if (!res.ok || !json?.success) {
        throw new Error(apiErrorMessage(json, 'Erro ao carregar viradas do ano'));
      }
      setPayload(json);
      if (opsResult.status === 'fulfilled' && opsResult.value.ok) {
        const opsJson = await opsResult.value.json() as OpsAntigasPayload;
        if (opsJson?.success) setOpsAntigas(opsJson);
      }
      if (json.transicoes?.length) {
        setViradaSelecionada(json.transicoes[json.transicoes.length - 1]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  }

  async function carregarDetalhes(virada: RotacaoTransicao) {
    setLoadingDetalhes(true);
    setDetalhes(null);
    setDetalheRotacao(null);
    try {
      const impactoParams = new URLSearchParams({
        de: virada.antes,
        ate: virada.depois,
        periodos: 'MA,PX,UL,QT,QU',
        limit: '500',
      });
      const detalheParams = new URLSearchParams({ de: virada.antes, ate: virada.depois, limit: '5000' });
      const [impactoRes, detalheRes] = await Promise.all([
        fetchNoCache(`${API_URL}/api/analises/snapshot-lotes/impacto-rapido?${impactoParams}`, { headers: authHeaders() }, 120000),
        fetchNoCache(`${API_URL}/api/analises/snapshot-lotes/rotacao-detalhe?${detalheParams}`, { headers: authHeaders() }, 120000),
      ]);
      const impactoJson = await impactoRes.json() as ImpactoPayload;
      const detalheJson = await detalheRes.json() as RotacaoDetalhePayload;
      if (impactoRes.ok && impactoJson?.success) setDetalhes(impactoJson);
      if (detalheRes.ok && detalheJson?.success) setDetalheRotacao(detalheJson);
    } catch {
      // As duas análises são independentes; a tela continua exibindo a parte que respondeu.
    } finally {
      setLoadingDetalhes(false);
    }
  }

  const anos = useMemo(() => {
    const atual = new Date().getFullYear();
    return [atual, atual - 1, atual - 2];
  }, []);

  const mainMargin = sidebarCollapsed ? 'ml-20' : 'ml-64';

  const stats = useMemo(() => {
    if (!payload?.rotacao) return null;
    return payload.rotacao;
  }, [payload]);

  const diagnosticoVirada = useMemo(() => prioridadeVirada(viradaSelecionada), [viradaSelecionada]);

  const itensCriticosVirada = useMemo(() => {
    if (!detalheRotacao) return [];
    return [
      ...detalheRotacao.categorias.LIMBOS.map((r) => ({ ...r, prioridade: 1 })),
      ...detalheRotacao.categorias.INSERIDOS.map((r) => ({ ...r, prioridade: 2 })),
      ...detalheRotacao.categorias.PRODUZIDOS.map((r) => ({ ...r, prioridade: 3 })),
      ...detalheRotacao.categorias.ALTERADOS.map((r) => ({ ...r, prioridade: 4 })),
    ]
      .sort((a, b) => a.prioridade - b.prioridade || Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 8);
  }, [detalheRotacao]);

  const opsMaisAtrasadas = useMemo(() => {
    return [...(opsAntigas?.data || [])]
      .sort((a, b) => Number(b.diasEmProcesso || 0) - Number(a.diasEmProcesso || 0))
      .slice(0, 6);
  }, [opsAntigas]);

  const mpsCriticasCount = useMemo(() => {
    const lista = detalhes?.impactoMp || [];
    return lista.filter((m) => m.risco === 'FALTA_GERADA').length;
  }, [detalhes]);

  // Filtrar SKUs
  const skusFiltrados = useMemo(() => {
    if (!detalheRotacao) return [];
    const categorias = detalheRotacao.categorias;
    if (filtroTipo === 'TODOS') {
      return [
        ...categorias.LIMBOS,
        ...categorias.INSERIDOS,
        ...categorias.PRODUZIDOS,
        ...categorias.ALTERADOS,
        ...categorias.PRESERVADOS,
      ];
    }
    const chave = `${filtroTipo}S` as keyof RotacaoDetalhePayload['categorias'];
    return categorias[chave] || [];
  }, [detalheRotacao, filtroTipo]);

  // Agrupar MPs por risco
  const mpsAgrupadas = useMemo(() => {
    const lista = detalhes?.impactoMp || [];
    return {
      falta: lista.filter(m => m.risco === 'FALTA_GERADA'),
      sobra: lista.filter(m => m.risco === 'COMPRA_PODE_SOBRAR'),
      outros: lista.filter(m => !['FALTA_GERADA', 'COMPRA_PODE_SOBRAR'].includes(m.risco)),
    };
  }, [detalhes]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <main className={`${mainMargin} transition-all duration-300 p-5 space-y-4`}>
        {/* Cabeçalho */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-brand-dark">Extrato do Plano - Viradas Mensais</h1>
            <p className="text-xs text-gray-500">
              Acompanhe como os planos evoluem mês a mês. MA→produção, PX→MA, UL→PX, QT→UL, QU→QT
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={ano}
              onChange={(e) => setAno(Number(e.target.value))}
              className="border rounded px-3 py-2 text-sm font-medium"
            >
              {anos.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <button
              onClick={carregarDados}
              disabled={loading}
              className="px-4 py-2 bg-brand-primary text-white rounded text-sm font-bold disabled:opacity-50"
            >
              {loading ? 'Carregando...' : 'Atualizar'}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="w-10 h-10 border-4 border-brand-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-500">Analisando viradas do ano {ano}...</p>
            </div>
          </div>
        )}

        {!loading && payload && (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
              <div className="xl:col-span-8 space-y-4">
                <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-200 bg-slate-50">
                    <div className="text-sm font-bold text-slate-800">Painel de acompanhamento</div>
                    <div className="text-xs text-slate-500">Do plano emitido ate OP, producao, estoque e virada do mes</div>
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-gray-100">
                    <div className="p-4">
                      <div className="text-[11px] uppercase font-semibold text-gray-500">Plano em rotacao</div>
                      <div className="text-2xl font-bold text-gray-900">{fmt((viradaSelecionada?.preservados || 0) + (viradaSelecionada?.alterados || 0))}</div>
                      <div className="text-xs text-gray-500">continuou entre periodos</div>
                    </div>
                    <div className="p-4">
                      <div className="text-[11px] uppercase font-semibold text-gray-500">Virou OP/producao</div>
                      <div className="text-2xl font-bold text-cyan-700">{fmt(viradaSelecionada?.produzidos || 0)}</div>
                      <div className="text-xs text-gray-500">saiu do plano com OP</div>
                    </div>
                    <div className={`p-4 ${(viradaSelecionada?.limbos || 0) > 0 ? 'bg-red-50' : ''}`}>
                      <div className="text-[11px] uppercase font-semibold text-gray-500">Perdido no caminho</div>
                      <div className={`text-2xl font-bold ${(viradaSelecionada?.limbos || 0) > 0 ? 'text-red-700' : 'text-gray-900'}`}>{fmt(viradaSelecionada?.limbos || 0)}</div>
                      <div className="text-xs text-gray-500">{fmt(viradaSelecionada?.porPeriodo.reduce((acc, p) => acc + p.pecasLimbo, 0) || 0)} pecas em limbo</div>
                    </div>
                    <div className={`p-4 ${(opsAntigas?.totais?.opsCount || 0) > 0 ? 'bg-amber-50' : ''}`}>
                      <div className="text-[11px] uppercase font-semibold text-gray-500">OPs atrasadas</div>
                      <div className={`text-2xl font-bold ${(opsAntigas?.totais?.opsCount || 0) > 0 ? 'text-amber-700' : 'text-gray-900'}`}>{fmt(opsAntigas?.totais?.opsCount || 0)}</div>
                      <div className="text-xs text-gray-500">{fmt(opsAntigas?.totais?.qtdTotal || 0)} pecas em processo</div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Foco da virada selecionada</div>
                      <div className={`mt-1 text-lg font-bold ${diagnosticoVirada.tone === 'red' ? 'text-red-700' : diagnosticoVirada.tone === 'amber' ? 'text-amber-700' : diagnosticoVirada.tone === 'blue' ? 'text-blue-700' : diagnosticoVirada.tone === 'emerald' ? 'text-emerald-700' : 'text-gray-800'}`}>
                        {diagnosticoVirada.label}
                      </div>
                      <p className="mt-1 text-sm text-gray-600">{diagnosticoVirada.texto}</p>
                    </div>
                    <button type="button" onClick={() => setTabDetalhe((viradaSelecionada?.limbos || 0) > 0 ? 'skus' : mpsCriticasCount > 0 ? 'mp' : 'posicoes')} className="px-3 py-2 rounded bg-brand-primary text-white text-xs font-bold">
                      Ver detalhe
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="text-sm font-bold text-gray-800 mb-3">Itens para investigar</div>
                    <div className="space-y-2">
                      {loadingDetalhes && <div className="text-sm text-gray-500">Carregando itens da virada...</div>}
                      {!loadingDetalhes && itensCriticosVirada.map((r) => (
                        <div key={`${r.sku}-${r.de}-${r.para}-${r.tipo}`} className="flex items-center justify-between gap-3 rounded border border-gray-100 bg-gray-50 px-3 py-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${tipoClass(r.tipo)}`}>{r.tipo === 'INSERIDO' ? 'INSERIDO' : r.tipo}</span>
                              <span className="text-xs font-bold text-gray-800">{r.referencia || r.sku}</span>
                            </div>
                            <div className="text-[11px] text-gray-500 truncate">{r.produto || '-'} · {r.cor || '-'} / {r.tamanho || '-'}</div>
                          </div>
                          <div className="text-right text-xs font-mono">
                            <div className={r.delta < 0 ? 'text-red-700 font-bold' : 'text-emerald-700 font-bold'}>{r.delta >= 0 ? '+' : ''}{fmt(r.delta)}</div>
                            <div className="text-gray-500">{r.de || '-'} {'->'} {r.para || '-'}</div>
                          </div>
                        </div>
                      ))}
                      {!loadingDetalhes && itensCriticosVirada.length === 0 && <div className="text-sm text-gray-500">Nenhum item critico carregado para essa virada.</div>}
                    </div>
                  </div>

                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="text-sm font-bold text-gray-800 mb-3">OPs mais atrasadas</div>
                    <div className="space-y-2">
                      {opsMaisAtrasadas.map((op) => (
                        <div key={`${op.nrCiclo}-${op.nrOp}-${op.cdProduto}`} className="flex items-center justify-between gap-3 rounded border border-amber-100 bg-amber-50 px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-amber-800">OP {op.nrOp} · ciclo {op.nrCiclo}</div>
                            <div className="text-[11px] text-amber-700 truncate">{op.referencia || op.cdProduto} · {op.descricao || '-'}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-bold text-amber-800">{fmt(op.diasEmProcesso)} dias</div>
                            <div className="text-[11px] text-amber-700">{fmt(op.qtdEmProcesso)} pcs</div>
                          </div>
                        </div>
                      ))}
                      {opsMaisAtrasadas.length === 0 && <div className="text-sm text-gray-500">Nenhuma OP acima de 20 dias em processo.</div>}
                    </div>
                  </div>
                </div>
              </div>

              <div className="xl:col-span-4 bg-white rounded-lg border border-gray-200 p-4">
                <div className="text-sm font-bold text-gray-800">Linha do tempo</div>
                <div className="text-xs text-gray-500 mb-3">Escolha uma virada para ver o antes e depois</div>
                <div className="space-y-2 max-h-[520px] overflow-auto pr-1">
                  {payload.transicoes.map((t) => {
                    const selected = viradaSelecionada?.mes === t.mes;
                    const statusClass = t.limbos > 0 ? 'border-red-300 bg-red-50' : t.inseridos > 20 ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50';
                    return (
                      <button key={t.mes} type="button" onClick={() => setViradaSelecionada(t)} className={`w-full text-left rounded border px-3 py-2 transition ${selected ? 'ring-2 ring-brand-primary border-brand-primary bg-white' : statusClass}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold text-gray-800">{getAnoMes(t.mes)}</span>
                          <span className="text-[11px] text-gray-500">{fmtDate(t.antes)} {'->'} {fmtDate(t.depois)}</span>
                        </div>
                        <div className="mt-1 grid grid-cols-3 gap-2 text-[11px]">
                          <span className={t.produzidos > 0 ? 'text-cyan-700 font-semibold' : 'text-gray-500'}>OP {fmt(t.produzidos)}</span>
                          <span className={t.limbos > 0 ? 'text-red-700 font-semibold' : 'text-gray-500'}>Limbo {fmt(t.limbos)}</span>
                          <span className={t.inseridos > 0 ? 'text-amber-700 font-semibold' : 'text-gray-500'}>Novos {fmt(t.inseridos)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Seção superior: Cards + Timeline lado a lado */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              {/* Cards resumo (3 colunas) */}
              <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                <div className="bg-white rounded-lg border border-gray-200 p-3">
                  <div className="text-[10px] uppercase text-gray-500">Viradas</div>
                  <div className="text-xl font-bold text-gray-900">{fmt(stats?.transicoesAnalisadas || 0)}</div>
                </div>
                <div className={`rounded-lg border p-3 ${(stats?.transicoesCriticas || 0) > 0 ? 'border-red-200 bg-red-50' : 'bg-white border-gray-200'}`}>
                  <div className="text-[10px] uppercase text-gray-500">Críticas</div>
                  <div className={`text-xl font-bold ${(stats?.transicoesCriticas || 0) > 0 ? 'text-red-700' : 'text-gray-900'}`}>
                    {fmt(stats?.transicoesCriticas || 0)}
                  </div>
                </div>
                <div className={`rounded-lg border p-3 ${(stats?.limbos || 0) > 0 ? 'border-red-200 bg-red-50' : 'bg-white border-gray-200'}`}>
                  <div className="text-[10px] uppercase text-gray-500">Limbo</div>
                  <div className={`text-xl font-bold ${(stats?.limbos || 0) > 0 ? 'text-red-700' : 'text-gray-900'}`}>
                    {fmt(stats?.limbos || 0)}
                  </div>
                  <div className="text-[10px] text-gray-500">{fmt(stats?.pecasLimbo || 0)} pçs</div>
                </div>
                <div className={`rounded-lg border p-3 ${(stats?.inseridos || 0) > 100 ? 'border-amber-200 bg-amber-50' : 'bg-white border-gray-200'}`}>
                  <div className="text-[10px] uppercase text-gray-500">Inseridos</div>
                  <div className={`text-xl font-bold ${(stats?.inseridos || 0) > 100 ? 'text-amber-700' : 'text-gray-900'}`}>
                    {fmt(stats?.inseridos || 0)}
                  </div>
                  <div className="text-[10px] text-gray-500">do zero</div>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <div className="text-[10px] uppercase text-gray-500">Preservados</div>
                  <div className="text-xl font-bold text-emerald-700">{fmt(stats?.preservados || 0)}</div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-3">
                  <div className="text-[10px] uppercase text-gray-500">SKUs afetados</div>
                  <div className="text-xl font-bold text-gray-900">{fmt(stats?.skusAfetados || 0)}</div>
                  <div className="text-[10px] text-gray-500">na rotação</div>
                </div>
              </div>

              {/* Timeline (1 coluna) */}
              <div className="bg-white rounded-lg border border-gray-200 p-3">
                <div className="text-xs font-bold text-gray-700 mb-2">Viradas {ano}</div>
                <div className="flex flex-wrap gap-1">
                  {payload.transicoes.map((t) => {
                    const isSelected = viradaSelecionada?.mes === t.mes;
                    const isCritica = t.status === 'CRITICA';
                    return (
                      <button
                        key={t.mes}
                        type="button"
                        onClick={() => setViradaSelecionada(t)}
                        title={`${getAnoMes(t.mes)} - ${t.limbos} limbo, ${t.inseridos} inseridos`}
                        className={`w-8 h-8 rounded text-[10px] font-bold transition-all ${
                          isSelected
                            ? 'bg-brand-primary text-white ring-2 ring-brand-primary/30'
                            : isCritica
                              ? 'bg-red-100 text-red-700 hover:bg-red-200'
                              : t.inseridos > 20
                                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {getMesNome(t.mes).slice(0, 3)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Detalhe da virada selecionada */}
            {viradaSelecionada && (
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {/* Header da virada */}
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <div className="text-lg font-bold text-gray-800">
                      Virada de {getAnoMes(viradaSelecionada.mes)}
                    </div>
                    <div className="text-xs text-gray-500">
                      {fmtDate(viradaSelecionada.antes)} → {fmtDate(viradaSelecionada.depois)}
                      {viradaSelecionada.diasEntre > 3 && (
                        <span className="text-amber-600 ml-1">({viradaSelecionada.diasEntre} dias)</span>
                      )}
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                    viradaSelecionada.status === 'CRITICA'
                      ? 'bg-red-100 text-red-700'
                      : viradaSelecionada.status === 'COM_INSERCOES'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {viradaSelecionada.status === 'CRITICA' ? 'Crítica' :
                     viradaSelecionada.status === 'COM_INSERCOES' ? 'Atenção' : 'OK'}
                  </span>
                </div>

                {/* Cards resumo da virada */}
                <div className="p-4 grid grid-cols-5 gap-2 border-b border-gray-200">
                  <div className="bg-emerald-50 rounded p-2 text-center">
                    <div className="text-lg font-bold text-emerald-700">{fmt(viradaSelecionada.preservados)}</div>
                    <div className="text-[10px] text-emerald-600">Preservados</div>
                  </div>
                  <div className="bg-blue-50 rounded p-2 text-center">
                    <div className="text-lg font-bold text-blue-700">{fmt(viradaSelecionada.alterados)}</div>
                    <div className="text-[10px] text-blue-600">Alterados</div>
                  </div>
                  <div className="bg-amber-50 rounded p-2 text-center">
                    <div className="text-lg font-bold text-amber-700">{fmt(viradaSelecionada.inseridos)}</div>
                    <div className="text-[10px] text-amber-600">Inseridos</div>
                  </div>
                  <div className="bg-red-50 rounded p-2 text-center">
                    <div className="text-lg font-bold text-red-700">{fmt(viradaSelecionada.limbos)}</div>
                    <div className="text-[10px] text-red-600">Limbo</div>
                  </div>
                  <div className="bg-green-50 rounded p-2 text-center">
                    <div className="text-lg font-bold text-green-700">{fmt(viradaSelecionada.novosPlanos)}</div>
                    <div className="text-[10px] text-green-600">Inseridos do zero</div>
                  </div>
                </div>

                {/* Tabs */}
                <div className="px-4 py-2 border-b border-gray-200 flex gap-2">
                  <button
                    onClick={() => setTabDetalhe('posicoes')}
                    className={`px-3 py-1.5 rounded text-xs font-bold ${tabDetalhe === 'posicoes' ? 'bg-brand-primary text-white' : 'bg-gray-100 text-gray-600'}`}
                  >
                    Por Posição
                  </button>
                  <button
                    onClick={() => setTabDetalhe('skus')}
                    className={`px-3 py-1.5 rounded text-xs font-bold ${tabDetalhe === 'skus' ? 'bg-brand-primary text-white' : 'bg-gray-100 text-gray-600'}`}
                  >
                    SKUs ({detalheRotacao ? fmt(
                      detalheRotacao.resumo.preservados
                      + detalheRotacao.resumo.alterados
                      + detalheRotacao.resumo.inseridos
                      + detalheRotacao.resumo.produzidos
                      + detalheRotacao.resumo.limbos
                    ) : 0})
                  </button>
                  <button
                    onClick={() => setTabDetalhe('mp')}
                    className={`px-3 py-1.5 rounded text-xs font-bold ${tabDetalhe === 'mp' ? 'bg-brand-primary text-white' : 'bg-gray-100 text-gray-600'}`}
                  >
                    Impacto MP ({detalhes?.impactoMp?.length || 0})
                  </button>
                </div>

                {/* Conteúdo das tabs */}
                <div className="p-4">
                  {loadingDetalhes && (
                    <div className="text-center py-8 text-gray-500">
                      <div className="w-6 h-6 border-2 border-brand-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      Carregando detalhes...
                    </div>
                  )}

                  {/* Tab Posições */}
                  {tabDetalhe === 'posicoes' && !loadingDetalhes && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                      {viradaSelecionada.porPeriodo.map((p) => (
                        <div key={`${p.de}-${p.para}`} className={`border rounded-lg p-3 ${p.limbos > 0 ? 'border-red-200 bg-red-50/50' : p.inseridos > 0 ? 'border-amber-200 bg-amber-50/50' : 'border-gray-200'}`}>
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-sm font-bold text-gray-800">{p.de}</span>
                            <span className="text-gray-400">→</span>
                            <span className="text-sm font-bold text-brand-primary">{p.para}</span>
                          </div>
                          <div className="space-y-1.5 text-xs">
                            <div className="flex justify-between">
                              <span className="text-emerald-600">Preservados:</span>
                              <span className="font-bold text-emerald-700">{fmt(p.preservados)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-blue-600">Alterados:</span>
                              <span className="font-bold text-blue-700">{fmt(p.alterados)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-amber-600">Inseridos:</span>
                              <span className={`font-bold ${p.inseridos > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{fmt(p.inseridos)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-cyan-600">Produzidos (OP):</span>
                              <span className={`font-bold ${p.produzidos > 0 ? 'text-cyan-700' : 'text-gray-400'}`}>{fmt(p.produzidos)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-red-600">Limbo:</span>
                              <span className={`font-bold ${p.limbos > 0 ? 'text-red-700' : 'text-gray-400'}`}>{fmt(p.limbos)}</span>
                            </div>
                            {p.limbos > 0 && (
                              <div className="pt-1 border-t border-red-200">
                                <span className="text-red-700 font-bold">{fmt(p.pecasLimbo)} peças perdidas</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Tab SKUs */}
                  {tabDetalhe === 'skus' && !loadingDetalhes && (
                    <div>
                      {/* Filtro */}
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-gray-500">Filtrar:</span>
                        {(['TODOS', 'PRESERVADO', 'ALTERADO', 'INSERIDO', 'PRODUZIDO', 'LIMBO'] as const).map((tipo) => (
                          <button
                            key={tipo}
                            onClick={() => setFiltroTipo(tipo)}
                            className={`px-2 py-1 rounded text-[10px] font-bold ${filtroTipo === tipo ? 'bg-brand-primary text-white' : 'bg-gray-100 text-gray-600'}`}
                          >
                            {tipo === 'TODOS' ? 'Todos' : tipo === 'INSERIDO' ? 'Inseridos do zero' : tipo === 'PRODUZIDO' ? 'Produzidos (OP)' : tipo}
                          </button>
                        ))}
                        <span className="ml-auto text-xs text-gray-500">{fmt(skusFiltrados.length)} resultado(s)</span>
                      </div>

                      {/* Tabela de SKUs */}
                      <div className="overflow-auto max-h-[400px] border rounded">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="text-left px-2 py-2">Situação</th>
                              <th className="text-left px-2 py-2">SKU</th>
                              <th className="text-left px-2 py-2">Referência</th>
                              <th className="text-left px-2 py-2">Produto</th>
                              <th className="text-left px-2 py-2">Cor</th>
                              <th className="text-left px-2 py-2">Tam</th>
                              <th className="text-left px-2 py-2">De</th>
                              <th className="text-left px-2 py-2">Para</th>
                              <th className="text-left px-2 py-2">OP</th>
                              <th className="text-right px-2 py-2">Antes</th>
                              <th className="text-right px-2 py-2">Depois</th>
                              <th className="text-right px-2 py-2">Delta</th>
                            </tr>
                          </thead>
                          <tbody>
                            {skusFiltrados.slice(0, 100).map((r, idx) => (
                              <tr key={`${r.sku}-${r.de}-${r.para}-${idx}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                <td className="px-2 py-1.5">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${tipoClass(r.tipo)}`}>
                                    {r.tipo === 'INSERIDO' ? 'INSERIDO DO ZERO' : r.tipo === 'PRODUZIDO' ? 'PRODUZIDO / OP' : r.tipo}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5 font-medium">{r.sku}</td>
                                <td className="px-2 py-1.5 font-medium">{r.referencia || '-'}</td>
                                <td className="px-2 py-1.5 max-w-[200px] truncate">{r.produto || '-'}</td>
                                <td className="px-2 py-1.5">{r.cor || '-'}</td>
                                <td className="px-2 py-1.5">{r.tamanho || '-'}</td>
                                <td className="px-2 py-1.5 font-bold">{r.de || '-'}</td>
                                <td className="px-2 py-1.5 font-bold text-brand-primary">{r.para || '-'}</td>
                                <td className="px-2 py-1.5">{r.ops?.join(', ') || '-'}</td>
                                <td className="px-2 py-1.5 text-right">{fmt(r.antes)}</td>
                                <td className="px-2 py-1.5 text-right">{fmt(r.depois)}</td>
                                <td className={`px-2 py-1.5 text-right font-bold ${r.delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                                  {r.delta >= 0 ? '+' : ''}{fmt(r.delta)}
                                </td>
                              </tr>
                            ))}
                            {skusFiltrados.length === 0 && (
                              <tr><td colSpan={12} className="px-3 py-8 text-center text-gray-500">Nenhum SKU nessa situacao para a virada selecionada</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      {skusFiltrados.length > 100 && (
                        <div className="text-xs text-gray-500 mt-2">
                          Mostrando 100 de {skusFiltrados.length} registros
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tab MP */}
                  {tabDetalhe === 'mp' && !loadingDetalhes && (
                    <div className="space-y-4">
                      {/* MPs com falta */}
                      {mpsAgrupadas.falta.length > 0 && (
                        <div>
                          <div className="text-xs font-bold text-red-700 mb-2 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-red-500" />
                            Falta Gerada ({mpsAgrupadas.falta.length})
                          </div>
                          <div className="overflow-auto max-h-[200px] border border-red-200 rounded">
                            <table className="w-full text-xs">
                              <thead className="bg-red-50 sticky top-0">
                                <tr>
                                  <th className="text-left px-2 py-2">MP</th>
                                  <th className="text-left px-2 py-2">Artigo</th>
                                  <th className="text-right px-2 py-2">Delta</th>
                                  <th className="text-right px-2 py-2">Estoque</th>
                                  <th className="text-right px-2 py-2">Compras</th>
                                </tr>
                              </thead>
                              <tbody>
                                {mpsAgrupadas.falta.map((m, idx) => (
                                  <tr key={m.idmateriaprima} className={idx % 2 === 0 ? 'bg-white' : 'bg-red-50/50'}>
                                    <td className="px-2 py-1.5">
                                      <div className="font-bold">{m.idmateriaprima}</div>
                                      <div className="text-gray-500 truncate max-w-[200px]">{m.nome}</div>
                                    </td>
                                    <td className="px-2 py-1.5">{m.artigo || '-'}</td>
                                    <td className="px-2 py-1.5 text-right font-bold text-red-700">{fmt(m.deltaTotal, 1)}</td>
                                    <td className="px-2 py-1.5 text-right">{fmt(m.estoquetotal, 1)}</td>
                                    <td className="px-2 py-1.5 text-right">{fmt(m.comprasPendentes, 1)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* MPs com compra que pode sobrar */}
                      {mpsAgrupadas.sobra.length > 0 && (
                        <div>
                          <div className="text-xs font-bold text-amber-700 mb-2 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-amber-500" />
                            Compra Pode Sobrar ({mpsAgrupadas.sobra.length})
                          </div>
                          <div className="overflow-auto max-h-[200px] border border-amber-200 rounded">
                            <table className="w-full text-xs">
                              <thead className="bg-amber-50 sticky top-0">
                                <tr>
                                  <th className="text-left px-2 py-2">MP</th>
                                  <th className="text-left px-2 py-2">Artigo</th>
                                  <th className="text-right px-2 py-2">Delta</th>
                                  <th className="text-right px-2 py-2">Estoque</th>
                                  <th className="text-right px-2 py-2">Compras</th>
                                </tr>
                              </thead>
                              <tbody>
                                {mpsAgrupadas.sobra.map((m, idx) => (
                                  <tr key={m.idmateriaprima} className={idx % 2 === 0 ? 'bg-white' : 'bg-amber-50/50'}>
                                    <td className="px-2 py-1.5">
                                      <div className="font-bold">{m.idmateriaprima}</div>
                                      <div className="text-gray-500 truncate max-w-[200px]">{m.nome}</div>
                                    </td>
                                    <td className="px-2 py-1.5">{m.artigo || '-'}</td>
                                    <td className="px-2 py-1.5 text-right font-bold text-amber-700">{fmt(m.deltaTotal, 1)}</td>
                                    <td className="px-2 py-1.5 text-right">{fmt(m.estoquetotal, 1)}</td>
                                    <td className="px-2 py-1.5 text-right">{fmt(m.comprasPendentes, 1)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Sem impacto relevante */}
                      {mpsAgrupadas.falta.length === 0 && mpsAgrupadas.sobra.length === 0 && (
                        <div className="text-center py-8 text-gray-500">
                          Nenhum impacto crítico em MP nesta virada
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Legenda */}
            <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600">
              <strong>Legenda:</strong>
              <span className="ml-3 text-emerald-600">Preservados = manteve qtd</span>
              <span className="ml-3 text-blue-600">Alterados = mudou qtd</span>
              <span className="ml-3 text-amber-600">Inseridos = apareceu do zero (cuidado!)</span>
              <span className="ml-3 text-red-600">Limbo = sumiu sem ir p/ produção</span>
              <span className="ml-3 text-green-600">Inseridos do zero = entrou em qualquer posição sem origem anterior</span>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
