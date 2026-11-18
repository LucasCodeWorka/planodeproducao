'use client';

// DISTRIBUIÇÃO SUGERIDA
//
// A Lista x Producao mostra que o cadastro nao descreve a producao: 59% dos vinculos nunca
// rodaram e 55% da carga acaba num grupo que nao a executou. Diagnosticar o erro nao diz o
// que fazer. Esta tela diz: uma linha por referencia, com ate quatro grupos em ordem.
//
//   Grupo A = quem mais produziu aquela referencia nos meses fechados
//   B, C, D = para onde ela vai quando o A enche
//
// O rateio e por PERIODO, nao no agregado: no horizonte inteiro a capacidade e 2,4x a
// carga e tudo caberia no A, mas o aperto e mensal. O que nao cabe num mes volta na frente
// da fila do mes seguinte, que e o transbordo que a fabrica de fato faz.
//
// Nada e gravado. A tela propoe; aplicar e outra decisao, com backup.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import MapaGruposCostura from '../components/MapaGruposCostura';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type GrupoDaRef = {
  ordem: string;
  grupo: string;
  origem: 'historico' | 'mix' | 'revisao';
  pecasHistorico: number | null;
  pecasMix: number | null;
  concentracao: number | null;
  minutos: number;
  pecas: number;
  fatia: number;
};

type Referencia = {
  referencia: string;
  pecas: number;
  tempoMin: number;
  cargaMin: number;
  mix: string | null;
  grupoProduto: string;
  semTempo: boolean;
  candidatas: number;
  opcoes: Array<{ ordem: string; grupo: string; origem: 'historico' | 'mix' | 'revisao'; pecasHistorico: number | null; pecasMix: number | null; capacidadeDisponivel: boolean }>;
  grupos: GrupoDaRef[];
  periodos: Array<{ periodo: string; pecas: number; pedidoMin: number; herdadoMin: number; alocadoMin: number; pendenteMin: number; herdadoPecas: number; pendentePecas: number; destinos: Array<{ grupo: string; minutos: number }>; tentativas: Array<{ grupo: string; origem: 'historico' | 'mix' | 'revisao'; solicitadoPecas: number; disponivelMin: number; alocadoMin: number; alocadoPecas: number; restantePecas: number; lotou: boolean }> }>;
  naoCoubeMin: number;
  atraso: number;
  mudou: boolean;
};

type MesDaCelula = {
  periodo: string;
  capacidadeMin: number;
  alocadoMin: number;
  extraMin: number;
  pedidoPreferencialMin: number;
  herdadoPreferencialMin: number;
  remanejadoPreferencialMin: number;
  pendentePreferencialMin: number;
  referenciasPreferenciais: Array<{ referencia: string; pedidoMin: number; herdadoMin: number; remanejadoMin: number; pendenteMin: number; destinosAlternativos: Array<{ grupo: string; minutos: number }> }>;
  ocupacao: number | null;
};

type FluxoMix = { pedido: number; deTras: number; coube: number; empurrado: number };

type GrupoResultado = {
  grupo: string;
  capacidadeDiaria: number;
  capacidadeMin: number;
  alocadoMin: number;
  ocupacao: number | null;
  meses: MesDaCelula[];
  mesesPorMix: Record<string, Record<string, number>>;
  mesesPorReferencia: Record<string, Record<string, number>>;
  periodosCheios: number;
  refs: number;
  refsNovas: number;
  referencias: string[];
};

type Resumo = {
  refs: number;
  pecasPlano: number;
  cargaTotalMin: number;
  alocadoMin: number;
  naoCoubeMin: number;
  fecha: boolean;
  refsComHistorico: number;
  refsSoMix: number;
  refsSemDestino: number;
  refsRateadas: number;
  refsSemTempo: number;
  capacidadeHorizonteMin: number;
  cargaExtraMin: number;
  emProcessoOk: boolean;
  atrasadoMin: number;
  periodosEstourados: number;
  extraExcedeCapacidade: boolean;
};

type PeriodoLinha = {
  porMix: Record<string, FluxoMix>;
  periodo: string;
  mes: string;
  dias: number;
  capacidadeMin: number;
  extraMin: number;
  pedidoMin: number;
  vindoDeTrasMin: number;
  coubeMin: number;
  empurradoMin: number;
};

type Dados = {
  meses: number;
  loteId: string | null;
  diasHorizonte: number;
  capacidadeDiariaTotal: number;
  temMedida: boolean;
  referencias: Referencia[];
  grupos: GrupoResultado[];
  periodos: PeriodoLinha[];
  resumo: Resumo;
};

type Filtro = 'todas' | 'rateadas' | 'mudaram' | 'semDestino' | 'pendentes' | 'semTempo';

const num = (v: number) => Math.round(v || 0).toLocaleString('pt-BR');
const pecasEstimadas = (v: number) => (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const pct = (v: number | null) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);

function CaminhoDaReferencia({ referencia, periodos, rotulos }: { referencia: Referencia; periodos: Referencia['periodos']; rotulos: PeriodoLinha[] }) {
  const ativos = periodos.filter((p) => p.pecas > 0 || p.herdadoMin > 0 || p.pendenteMin > 0);
  const grupos = Array.from(new Set(ativos.flatMap((p) => (p.tentativas || []).map((t) => t.grupo))));
  if (!ativos.length) return <p className="text-sm text-slate-500">Não há peças ou atraso neste período.</p>;
  return <div>
    <h3 className="text-base font-semibold text-slate-900">Para onde vão as peças?</h3>
    <p className="mt-1 text-xs text-slate-600">Leia cada coluna de cima para baixo. Verde: o grupo recebeu peças. Cinza: já estava cheio. Traço: o grupo não precisou ser testado. Vermelho: peças que ficaram para o mês seguinte.</p>
    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-xs"><thead className="bg-slate-100"><tr><th className="sticky left-0 bg-slate-100 px-3 py-2 text-left">Referência {referencia.referencia}</th>{ativos.map((p) => <th key={p.periodo} className="min-w-[110px] px-3 py-2 text-center">{rotulos.find((x) => x.periodo === p.periodo)?.mes || p.periodo}</th>)}</tr></thead><tbody>
        <tr className="border-t border-slate-200"><th className="sticky left-0 bg-white px-3 py-2 text-left">Peças do mês</th>{ativos.map((p) => <td key={p.periodo} className="px-3 py-2 text-center font-semibold">{num(p.pecas)}</td>)}</tr>
        <tr className="border-t border-slate-100"><th className="sticky left-0 bg-white px-3 py-2 text-left">Vieram do mês anterior</th>{ativos.map((p) => <td key={p.periodo} className="px-3 py-2 text-center">{p.herdadoMin > 0 ? `≈ ${pecasEstimadas(p.herdadoPecas)}` : '—'}</td>)}</tr>
        {grupos.map((grupo) => <tr key={grupo} className="border-t border-slate-100"><th className="sticky left-0 bg-white px-3 py-2 text-left font-medium">{grupo}</th>{ativos.map((p) => { const t = (p.tentativas || []).find((x) => x.grupo === grupo); return <td key={p.periodo} className={`px-3 py-2 text-center ${!t ? 'text-slate-300' : t.disponivelMin <= 0 ? 'bg-slate-100 font-semibold text-slate-600' : 'bg-emerald-50 font-semibold text-emerald-800'}`} title={!t ? 'Não precisou ser testado' : t.disponivelMin <= 0 ? 'Sem capacidade disponível quando foi testado' : `${num(t.alocadoMin)} minutos alocados${t.lotou ? '; capacidade disponível esgotada' : ''}`}>
          {!t ? '—' : t.disponivelMin <= 0 ? 'CHEIO' : <>≈ {pecasEstimadas(t.alocadoPecas)}<span className="block text-[10px] font-normal">{t.lotou ? 'recebeu · lotou' : 'recebeu'}</span></>}
        </td>; })}</tr>)}
        <tr className="border-t-2 border-slate-300"><th className="sticky left-0 bg-white px-3 py-2 text-left">Ficaram para o próximo mês</th>{ativos.map((p) => <td key={p.periodo} className={`px-3 py-2 text-center font-bold ${p.pendenteMin > 0 ? 'bg-red-100 text-red-800' : 'text-slate-500'}`}>{referencia.semTempo && p.pecas > 0 ? 'não calculado' : p.pendenteMin > 0 ? `≈ ${pecasEstimadas(p.pendentePecas)}` : '0'}</td>)}</tr>
      </tbody></table>
    </div>
    {referencia.semTempo && <p className="mt-2 text-xs font-semibold text-red-700">Falta o tempo de costura: não é possível calcular a distribuição das peças.</p>}
    {!referencia.semTempo && !grupos.length && <p className="mt-2 text-xs font-semibold text-red-700">Nenhum grupo candidato foi encontrado. As peças continuam pendentes.</p>}
    <p className="mt-2 text-xs text-slate-500">≈ indica peças estimadas pela capacidade em minutos; podem ser fracionárias. A capacidade já considera outras referências e a carga adicional estimada. Um atraso reaparece no mês seguinte e não deve ser somado duas vezes. Meses sem peças nem atraso ficam ocultos e não comprovam que exista folga.</p>
    {ativos.map((p) => !referencia.semTempo && (p.tentativas || []).length > 0 && <div key={p.periodo} className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
      <p className="font-semibold text-slate-800">Caminho em {rotulos.find((x) => x.periodo === p.periodo)?.mes || p.periodo}</p>
      <div className="mt-2 flex flex-wrap items-stretch gap-2 text-xs">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-blue-900"><strong>{num(p.pecas)} peças</strong><div>do mês</div>{p.herdadoMin > 0 && <div>+ ≈ {pecasEstimadas(p.herdadoPecas)} atrasadas</div>}</div>
        {(p.tentativas || []).map((t, i) => <Fragment key={`${t.grupo}-${i}`}><span className="self-center text-lg font-bold text-slate-400" aria-hidden="true">→</span><div className={`max-w-[190px] rounded-lg border p-2 ${t.disponivelMin <= 0 ? 'border-slate-300 bg-slate-100 text-slate-700' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}><strong>{t.grupo}</strong><div className="mt-1">{t.disponivelMin <= 0 ? 'Já estava cheio' : `Recebeu ≈ ${pecasEstimadas(t.alocadoPecas)} peças`}</div>{t.lotou && <div className="font-semibold text-amber-700">Ficou cheio</div>}{t.restantePecas > 0.0001 && <div>Seguiram ≈ {pecasEstimadas(t.restantePecas)}</div>}</div></Fragment>)}
        {p.pendenteMin > 0 && <><span className="self-center text-lg font-bold text-slate-400" aria-hidden="true">→</span><div className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-800"><strong>≈ {pecasEstimadas(p.pendentePecas)} peças</strong><div>para o mês seguinte{p.periodo === rotulos[rotulos.length - 1]?.periodo ? ' · fora do horizonte' : ''}</div></div></>}
      </div>
    </div>)}
  </div>;
}

export default function DistribuicaoSugeridaPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dados, setDados] = useState<Dados | null>(null);
  const [loading, setLoading] = useState(true);
  const requisicaoAtual = useRef(0);
  const [erro, setErro] = useState<string | null>(null);
  const [meses, setMeses] = useState(6);
  const [comFerias, setComFerias] = useState(false);
  const [cenario, setCenario] = useState<{ conectado: boolean; lote: string; extra: string; extraGrupo?: string } | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [busca, setBusca] = useState('');
  // PERFIL = o mix de producao (SO BASICO, CA FASHION...), que e o que define a vocacao de
  // cada grupo de costura. GRUPO = a celula em si. Os dois filtram a mesma lista.
  const [perfil, setPerfil] = useState('');
  const [grupoProduto, setGrupoProduto] = useState('');
  const [grupo, setGrupo] = useState('');
  const [leituraMatriz, setLeituraMatriz] = useState<'mes' | 'acumulado'>('mes');
  const [grupoAberto, setGrupoAberto] = useState<string | null>(null);
  const [periodoDetalhe, setPeriodoDetalhe] = useState('MA');
  const [periodoLista, setPeriodoLista] = useState('');
  const [referenciaAberta, setReferenciaAberta] = useState<string | null>(null);

  const carregar = useCallback(async (janela: number, ferias: boolean, contexto: { conectado: boolean; lote: string; extra: string; extraGrupo?: string }, refresh = false) => {
    const requisicao = ++requisicaoAtual.current;
    setLoading(true);
    setDados(null);
    setErro(null);
    try {
      const qs = new URLSearchParams({ meses: String(janela) });
      if (ferias) qs.set('ferias', '1');
      if (contexto.lote) qs.set('lote_id', contexto.lote);
      if (contexto.extra) qs.set('extra', contexto.extra);
      // Liebe Move direcionada ao grupo do anatomic (mix dela no ERP), vinda da Visão Geral.
      if (contexto.extraGrupo) qs.set('extra_grupo', contexto.extraGrupo);
      if (refresh) qs.set('refresh', 'true');
      // 5 minutos: a primeira chamada do processo levanta tempos, matriz e produção.
      // Depois fica em cache de 30 min no backend.
      const resp = await fetchNoCache(`${API_URL}/api/capacidade/distribuicao-sugerida?${qs}`, { headers: authHeaders() }, 300000);
      const json = await resp.json();
      if (!json?.success) throw new Error(json?.error || 'Falha ao carregar');
      if (requisicao === requisicaoAtual.current) setDados(json);
    } catch (e) {
      if (requisicao === requisicaoAtual.current) setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      if (requisicao === requisicaoAtual.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const conectado = q.get('cenario') === 'visao-geral';
    setComFerias(conectado && q.get('ferias') === '1');
    setCenario({ conectado, lote: conectado ? q.get('lote_id') || '' : '', extra: conectado ? q.get('extra') || '' : '', extraGrupo: conectado ? q.get('extra_grupo') || '' : '' });
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    if (cenario) carregar(meses, comFerias, cenario);
  }, [carregar, meses, comFerias, cenario, router]);

  const visiveis = useMemo(() => {
    if (!dados) return [];
    const termo = busca.trim().toUpperCase();
    return dados.referencias.filter((r) => {
      if (filtro === 'rateadas' && r.grupos.length < 2) return false;
      if (filtro === 'mudaram' && !r.mudou) return false;
      if (filtro === 'semDestino' && r.candidatas > 0) return false;
      const periodos = periodoLista ? r.periodos.filter((p) => p.periodo === periodoLista) : r.periodos;
      if (filtro === 'pendentes' && !periodos.some((p) => p.pendenteMin > 0)) return false;
      if (filtro === 'semTempo' && !(r.semTempo && periodos.some((p) => p.pecas > 0))) return false;
      if (perfil && r.mix !== perfil) return false;
      if (grupoProduto && r.grupoProduto !== grupoProduto) return false;
      if (grupo && !r.opcoes.some((g) => g.grupo === grupo)) return false;
      if (termo && !r.referencia.includes(termo)
          && !(r.mix || '').includes(termo)
          && !r.opcoes.some((g) => g.grupo.includes(termo))) return false;
      return true;
    });
  }, [dados, filtro, busca, perfil, grupoProduto, grupo, periodoLista]);

  const gruposProduto = useMemo(() => Array.from(new Set((dados?.referencias || []).map((r) => r.grupoProduto).filter(Boolean))).sort(), [dados]);

  const perfis = useMemo(() => {
    if (!dados) return [];
    const set = new Set<string>();
    dados.referencias.forEach((r) => { if (r.mix) set.add(r.mix); });
    const saida: string[] = [];
    set.forEach((v) => saida.push(v));
    return saida.sort();
  }, [dados]);

  // ATRASO POR MIX. A pergunta do PCP nao e "quanto atrasou no total", e "SUTIA cabe?".
  // O mix do ERP comeca com SO para soutien, CA para calcinha, SC sem costura, BO body.
  const porMix = useMemo(() => {
    if (!dados) return [];
    const m = new Map<string, { carga: number; atrasada: number; refs: number }>();
    for (const r of dados.referencias) {
      const chave = (r.mix || 'SEM MIX').replace(' PRODUCAO', '');
      const a = m.get(chave) || { carga: 0, atrasada: 0, refs: 0 };
      a.carga += r.cargaMin;
      a.atrasada += r.cargaMin * r.atraso;
      a.refs += 1;
      m.set(chave, a);
    }
    const saida: Array<{ mix: string; carga: number; atrasada: number; refs: number; pct: number }> = [];
    m.forEach((v, mix) => saida.push({ mix, ...v, pct: v.carga > 0 ? v.atrasada / v.carga : 0 }));
    return saida.sort((a, b) => b.atrasada - a.atrasada);
  }, [dados]);

  // As duas tabelas de cima passam a somar SO o perfil escolhido. A alocacao nao muda —
  // ela disputou a fabrica inteira; o que muda e o que a tela exibe.
  const gruposFiltrados = useMemo(() => {
    if (!dados) return [];
    const gruposSelecionados = dados.grupos.filter((g) => !grupo || g.grupo === grupo);
    if (!perfil && !grupoProduto) return gruposSelecionados;
    const refsSelecionadas = new Set(dados.referencias.filter((r) => (!perfil || r.mix === perfil) && (!grupoProduto || r.grupoProduto === grupoProduto)).map((r) => r.referencia));
    return gruposSelecionados.map((g) => {
      const meses = g.meses.map((m) => {
        const doMix = Object.entries(g.mesesPorReferencia?.[m.periodo] || {}).reduce((s, [ref, minutos]) => s + (refsSelecionadas.has(ref) ? Number(minutos) : 0), 0);
        return {
          ...m,
          alocadoMin: Math.round(doMix),
          // A ocupacao continua sendo a do MES INTEIRO: e ela que diz se o grupo esta
          // lotado. O que o filtro muda e quanto daquilo e do perfil escolhido.
          fatiaDoPerfil: m.alocadoMin > 0 ? doMix / m.alocadoMin : 0,
        };
      });
      const alocado = meses.reduce((t, m) => t + m.alocadoMin, 0);
      return { ...g, meses, alocadoMin: Math.round(alocado) };
    }).filter((g) => g.alocadoMin > 0);
  }, [dados, perfil, grupoProduto, grupo]);

  const periodosFiltrados = useMemo(() => {
    if (!dados) return [];
    if (!perfil) return dados.periodos;
    return dados.periodos.map((p) => {
      const f = p.porMix?.[perfil] || { pedido: 0, deTras: 0, coube: 0, empurrado: 0 };
      return {
        ...p,
        pedidoMin: Math.round(f.pedido),
        vindoDeTrasMin: Math.round(f.deTras),
        coubeMin: Math.round(f.coube),
        empurradoMin: Math.round(f.empurrado),
      };
    });
  }, [dados, perfil]);

  const baixarCsv = () => {
    if (!dados) return;
    const cab = ['Referência', 'Grupo A', 'Grupo B', 'Grupo C', 'Grupo D'];
    const csvCampo = (valor: string) => {
      const seguro = /^[\s]*[=+@\-\t\r]/.test(valor) ? `'${valor}` : valor;
      return `"${seguro.replace(/"/g, '""')}"`;
    };
    const linhas = visiveis.map((r) => [r.referencia, ...[0, 1, 2, 3].map((i) => r.opcoes[i]?.grupo || '')]);
    const conteudo = [cab, ...linhas].map((linha) => linha.map(csvCampo).join(';')).join('\r\n');
    const blob = new Blob(['\uFEFF', conteudo], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `referencias-grupos-producao-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="min-h-screen bg-gray-100">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`${ml} transition-all duration-300 p-6`}>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-brand-dark">Distribuição sugerida</h1>
            <p className="mt-1 text-sm text-gray-500">
              Para onde cada referência deveria ir, pelo histórico de produção e pelo mix — respeitando a capacidade de cada grupo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={comFerias} onChange={(e) => setComFerias(e.target.checked)} />
              férias coletivas
            </label>
            {/* PERFIL NO TOPO: ele governa a tela inteira, nao so a lista — e a primeira
                pergunta de quem abre ("o sutia cabe?"), entao fica junto dos controles. */}
            <select
              value={perfil}
              onChange={(ev) => setPerfil(ev.target.value)}
              className="rounded border border-indigo-300 bg-white px-2 py-1 text-sm font-medium text-indigo-900"
              title="Filtra a página inteira — tabela de grupos, mês a mês e a lista"
            >
              <option value="">Todos os perfis</option>
              {perfis.map((p) => (
                <option key={p} value={p}>{p.replace(' PRODUCAO', '')}</option>
              ))}
            </select>
            <select value={grupoProduto} onChange={(e) => setGrupoProduto(e.target.value)} className="rounded border border-indigo-300 bg-white px-2 py-1 text-sm" title="Filtra a matriz e a lista por grupo de produto">
              <option value="">Todos os grupos de produto</option>
              {gruposProduto.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <label className="text-xs text-gray-500">Histórico</label>
            <select
              value={meses}
              onChange={(ev) => setMeses(Number(ev.target.value))}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
            >
              {[3, 6, 12].map((m) => <option key={m} value={m}>{m} meses</option>)}
            </select>
            <button
              type="button"
              onClick={() => cenario && carregar(meses, comFerias, cenario, true)}
              className="rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
            >
              Recalcular
            </button>
          </div>
        </div>
        <div className={`mb-5 rounded-lg border px-4 py-3 text-sm ${cenario?.conectado ? 'border-indigo-200 bg-indigo-50 text-indigo-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          {cenario?.conectado
            ? <>Cenário recebido da Visão Geral 2: {cenario.lote ? 'com lote de simulação' : 'plano da matriz'}, {comFerias ? 'com férias' : 'sem férias'} e {cenario.extra ? 'com carga adicional' : 'sem carga adicional informada'}. A carga adicional é estimada por capacidade de cada grupo. Alterações posteriores na visão geral exigem abrir o link novamente.</>
            : <>Leitura independente: plano da matriz, sem lote de simulação e sem carga adicional da Visão Geral 2. Para comparar o mesmo cenário, abra esta página pelo link na visão geral.</>}
        </div>
        {dados?.resumo.extraExcedeCapacidade && <div className="mb-5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">Em pelo menos um mês a carga adicional estimada excede toda a capacidade. O excedente dessa carga agregada não é transferido para o mês seguinte; a proposta de atraso está incompleta nesses períodos.</div>}

        {loading && (
          <div className="rounded-lg bg-white p-8 text-center shadow">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-brand-primary border-t-transparent" />
            <p className="mt-4 text-gray-500">Montando a distribuição — a primeira carga leva cerca de um minuto.</p>
          </div>
        )}

        {erro && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{erro}</div>}

        {!loading && !erro && dados && (
          <>
            {/* ───── A LEITURA ───── */}
            <div className="mb-6 grid items-start gap-6 2xl:grid-cols-3 xl:grid-cols-2">
              <div className="flex flex-col gap-6">
                <div className="rounded-lg bg-white p-6 shadow">
                  <p className="text-lg leading-relaxed text-gray-800">
                    O plano dos 14 períodos tem <strong>{num(dados.resumo.pecasPlano)} peças</strong> em{' '}
                    <strong>{num(dados.resumo.refs)} referências</strong>. Desta proposta,{' '}
                    <strong>{num(dados.resumo.refsRateadas)}</strong> precisaram ser rateadas entre dois ou
                    mais grupos porque o primeiro não comportava o mês inteiro.
                  </p>
                  <p className="mt-3 leading-relaxed text-gray-600">
                    O <strong>Grupo A</strong> é quem mais produziu a referência nos últimos {dados.meses} meses fechados. Sem histórico próprio nessa janela, a revisão do PCP vem antes das opções sugeridas por mix. A simulação só aloca em grupos com capacidade no cenário.
                  </p>

                  <div className="mt-6 grid grid-cols-3 gap-4 border-t border-gray-200 pt-5">
                    <div>
                      <div className="text-2xl font-semibold tabular-nums text-gray-800">{num(dados.resumo.refsComHistorico)}</div>
                      <div className="mt-0.5 text-xs leading-snug text-gray-500">referências com histórico próprio</div>
                    </div>
                    <div>
                      <div className="text-2xl font-semibold tabular-nums text-gray-800">{num(dados.resumo.refsSoMix)}</div>
                      <div className="mt-0.5 text-xs leading-snug text-gray-500">que saíram só pelo mix</div>
                    </div>
                    <div>
                      <div className={`text-2xl font-semibold tabular-nums ${dados.resumo.refsSemDestino > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                        {num(dados.resumo.refsSemDestino)}
                      </div>
                      <div className="mt-0.5 text-xs leading-snug text-gray-500">sem nenhum destino possível</div>
                    </div>
                  </div>
                </div>

                <div className="flex-1 rounded-lg border border-gray-200 bg-white p-6 shadow">
                  <h2 className="mb-2 text-base font-semibold text-gray-800">As contas que a tela confere sozinha</h2>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-baseline gap-2">
                      <span className={dados.resumo.fecha ? 'text-emerald-700' : 'text-red-700'}>
                        {dados.resumo.fecha ? '✓' : '✗'}
                      </span>
                      <span className="text-gray-700">
                        <strong>Nada some.</strong> {num(dados.resumo.cargaTotalMin)} min de carga ={' '}
                        {num(dados.resumo.alocadoMin)} alocados + {num(dados.resumo.naoCoubeMin)} que não couberam.
                      </span>
                    </li>
                    <li className="flex items-baseline gap-2">
                      <span className={dados.grupos.every((g) => (g.ocupacao || 0) <= 1.0001) ? 'text-emerald-700' : 'text-red-700'}>
                        {dados.grupos.every((g) => (g.ocupacao || 0) <= 1.0001) ? '✓' : '✗'}
                      </span>
                      <span className="text-gray-700">
                        <strong>Ninguém estoura.</strong> A mais cheia fica em{' '}
                        {pct(Math.max(...dados.grupos.map((g) => g.ocupacao || 0)))} do horizonte.
                      </span>
                    </li>
                  </ul>
                  <div className="mt-4 rounded border border-amber-200 bg-amber-50/60 p-3 text-xs leading-relaxed text-gray-700">
                    <p className="mb-1 font-semibold text-gray-800">Por que esta ocupação é menor que a da Visão Geral 2</p>
                    <p>
                      Esta lista distribui o <strong>plano lançado mais o que está em processo</strong>:{' '}
                      {num(dados.resumo.cargaTotalMin)} min, {pct(dados.resumo.cargaTotalMin / dados.resumo.capacidadeHorizonteMin)}{' '}
                      da capacidade do horizonte. A Ocupação por grupo, chamada da mesma forma, dá o mesmo número.
                    </p>
                    <p className="mt-1.5">
                      A Visão Geral 2 termina perto de 100% porque soma <strong>Liebe Move, edição limitada e o
                      plano previsto</strong> dos meses sem lote — cerca de 7 milhões de minutos a mais. Essa carga
                      vem em minutos por período, <strong>sem abertura por referência</strong>, então não há como
                      distribuí-la numa lista como esta. Quando ela é informada, entra descontando a capacidade
                      livre de cada grupo, na proporção do tamanho de cada um
                      {dados.resumo.cargaExtraMin > 0
                        ? <> — nesta leitura são <strong>{num(dados.resumo.cargaExtraMin)} min</strong>.</>
                        : <> — nesta leitura ela não foi informada.</>}
                    </p>
                  </div>
                </div>
              </div>

              {/* ───── OCUPAÇÃO RESULTANTE ───── */}
              <div className="rounded-lg bg-white p-4 shadow 2xl:col-span-2">
                <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-600">
                  Como cada grupo fica, mês a mês
                </h2>
                <p className="mb-3 text-xs text-gray-500">
                <strong>Pressão inicial</strong> é a carga das referências que têm o grupo como primeira opção, mais a carga adicional estimada. Pode passar de 100%; não inclui carga recebida como alternativa de outros grupos. <strong>Alocado</strong> é o que a proposta conseguiu encaixar no grupo após distribuir; por isso geralmente para em 100%. Referências sem nenhuma candidata não têm pressão atribuída a um grupo. No acumulado, somamos apenas os pedidos novos para não contar atrasos duas vezes. Os percentuais consideram toda a carga; filtros mostram a parcela selecionada do alocado. Abra um grupo para ver os remanejamentos por referência.
                </p>
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                  <label htmlFor="grupo-matriz">Grupo de costura</label>
                  <select id="grupo-matriz" value={grupo} onChange={(e) => setGrupo(e.target.value)} className="rounded border border-gray-300 bg-white px-2 py-1">
                    <option value="">Todos os grupos</option>
                    {dados.grupos.map((g) => <option key={g.grupo} value={g.grupo}>{g.grupo}</option>)}
                  </select>
                  <label htmlFor="leitura-matriz">Leitura</label>
                  <select id="leitura-matriz" value={leituraMatriz} onChange={(e) => setLeituraMatriz(e.target.value as 'mes' | 'acumulado')} className="rounded border border-gray-300 bg-white px-2 py-1">
                    <option value="mes">Mês</option><option value="acumulado">Acumulado</option>
                  </select>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                        <th className="whitespace-nowrap px-2 py-1.5 text-left">grupo de costura</th>
                        <th className="whitespace-nowrap px-2 py-1.5 text-right">min/dia</th>
                        {periodosFiltrados.map((p) => (
                          <th key={p.periodo} className="whitespace-nowrap px-1.5 py-1.5 text-right" title={p.periodo}>{p.mes}</th>
                        ))}
                        <th className="whitespace-nowrap px-2 py-1.5 text-right" title="Meses em que a ocupação após a distribuição atingiu pelo menos 99,5%">meses lotado (alocado)</th>
                        <th className="px-2 py-1.5 text-right">refs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gruposFiltrados.map((g) => (
                        <>
                          <tr
                            key={g.grupo}
                            onClick={() => setGrupoAberto(grupoAberto === g.grupo ? null : g.grupo)}
                            className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                          >
                            <td className="whitespace-nowrap px-2 py-1.5 text-gray-800">{g.grupo}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{num(g.capacidadeDiaria)}</td>
                            {g.meses.map((m, i) => {
                              const originais = dados.grupos.find((x) => x.grupo === g.grupo)?.meses || [];
                              const janela = leituraMatriz === 'mes' ? originais.slice(i, i + 1) : originais.slice(0, i + 1);
                              const capacidade = janela.reduce((s, x) => s + x.capacidadeMin, 0);
                              const alocado = janela.reduce((s, x) => s + x.alocadoMin, 0);
                              const extra = janela.reduce((s, x) => s + x.extraMin, 0);
                              const parcela = (leituraMatriz === 'mes' ? g.meses.slice(i, i + 1) : g.meses.slice(0, i + 1)).reduce((s, x) => s + x.alocadoMin, 0);
                              const o = capacidade > 0 ? (alocado + extra) / capacidade : 0;
                              const pedido = janela.reduce((s, x) => s + x.pedidoPreferencialMin + (leituraMatriz === 'mes' ? x.herdadoPreferencialMin : 0), 0);
                              const remanejado = janela.reduce((s, x) => s + x.remanejadoPreferencialMin, 0);
                              const pendente = leituraMatriz === 'mes' ? m.pendentePreferencialMin : (janela[janela.length - 1]?.pendentePreferencialMin || 0);
                              const pressao = capacidade > 0 ? (pedido + extra) / capacidade : 0;
                              const cor = pressao > 1 ? 'bg-red-100 font-bold text-red-700'
                                : pressao >= 0.85 ? 'font-semibold text-amber-700'
                                : pressao > 0 ? 'text-gray-700' : 'text-gray-300';
                              return (
                                <td
                                  key={m.periodo}
                                  className={`px-1.5 py-1.5 text-right tabular-nums ${cor}`}
                                  title={`Capacidade: ${num(capacidade)} min; pedido para primeira opção: ${num(pedido)} min; carga adicional estimada: ${num(extra)} min; alocado no grupo: ${num(alocado)} min; enviado a alternativas: ${num(remanejado)} min; pendente no fim: ${num(pendente)} min${perfil || grupoProduto ? `; seleção alocada: ${num(parcela)} min` : ''}.`}
                                >
                                  {capacidade > 0 ? `${Math.round(pressao * 100)}%` : '—'}
                                  <div className="text-[10px] font-normal text-gray-600">alocado {capacidade > 0 ? `${Math.round(o * 100)}%` : '—'}</div>
                                  {(perfil || grupoProduto) && parcela > 0 && <div className="text-[10px] font-normal text-indigo-700">{num(parcela)} min seleção</div>}
                                </td>
                              );
                            })}
                            <td className={`px-2 py-1.5 text-right font-bold tabular-nums ${g.periodosCheios > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                              {g.periodosCheios || '—'}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">
                              {g.refs}
                              {g.refsNovas > 0 && <span className="ml-1 text-[10px] text-amber-700">+{g.refsNovas}</span>}
                            </td>
                          </tr>
                          {grupoAberto === g.grupo && (
                            <tr key={`${g.grupo}-refs`} className="border-b border-gray-200 bg-gray-50">
                              <td colSpan={periodosFiltrados.length + 4} className="px-3 py-2 text-xs leading-relaxed text-gray-700">
                                <span className="font-semibold">{g.refs} referências no total, incluindo {g.refsNovas} novas: </span>
                                {g.referencias.join(' · ')}
                                <div className="mt-1 text-gray-500">
                                  Carga alocada {perfil || grupoProduto ? 'à seleção' : 'às referências'} no horizonte: {num(g.alocadoMin)} min. Capacidade total: {num(g.capacidadeMin)} min. A carga adicional estimada não integra esse subtotal.
                                </div>
                                <div className="mt-3 border-t border-gray-200 pt-2">
                                  <label className="font-semibold">Primeira opção e remanejamento no período: {' '}
                                    <select value={periodoDetalhe} onChange={(e) => setPeriodoDetalhe(e.target.value)} className="rounded border border-gray-300 bg-white px-2 py-1 font-normal">
                                      {dados.periodos.map((p) => <option key={p.periodo} value={p.periodo}>{p.mes}</option>)}
                                    </select>
                                  </label>
                                  <p className="mt-1 text-gray-500">A primeira opção vem do histórico ou do mix; não confirma que o grupo esteja obrigado a receber a referência. O pendente ainda não foi alocado em nenhum grupo neste período.</p>
                                  {(() => {
                                    const mes = g.meses.find((x) => x.periodo === periodoDetalhe);
                                    const refs = mes?.referenciasPreferenciais || [];
                                    if (!refs.length) return <p className="mt-2 text-gray-500">Nenhuma demanda com este grupo como primeira opção no período.</p>;
                                    return <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-gray-200 text-gray-500"><th className="py-1">Referência</th><th className="px-2 text-right">Pedido</th><th className="px-2 text-right">Atraso recebido</th><th className="px-2 text-left">Enviado a outros grupos</th><th className="px-2 text-right">Pendente</th></tr></thead><tbody>{refs.map((r) => <tr key={r.referencia} className="border-b border-gray-100"><td className="py-1 font-medium">{r.referencia}</td><td className="px-2 text-right">{num(r.pedidoMin)} min</td><td className="px-2 text-right">{num(r.herdadoMin)} min</td><td className="px-2">{r.destinosAlternativos.length ? r.destinosAlternativos.map((d) => `${d.grupo}: ${num(d.minutos)} min`).join(' · ') : '—'}</td><td className="px-2 text-right">{num(r.pendenteMin)} min</td></tr>)}</tbody></table></div>;
                                  })()}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* ───── O APERTO, MES A MES ─────
                 A media do horizonte esconde tudo: com transbordo para o mes seguinte,
                 quase tudo acaba cabendo em algum lugar ate dez/27, porque de jul/27 em
                 diante mal ha plano. Mas "coube em 2027" nao e "cabe". E aqui que o PCP ve
                 que SUTIA nao fecha em novembro. */}
            <div className="mb-6 rounded-lg border-2 border-red-300 bg-white p-6 shadow">
              <h2 className="mb-2 text-base font-semibold text-gray-800">O aperto, mês a mês</h2>
              <p className="mb-4 text-3xl font-semibold tabular-nums text-red-600">
                {dados.resumo.periodosEstourados} de {dados.periodos.length}
                <span className="ml-3 align-middle text-base font-normal text-gray-600">
                  períodos pedem mais do que a fábrica faz naquele mês
                </span>
              </p>
              <p className="mb-4 leading-relaxed text-gray-700">
                <strong>{num(dados.resumo.atrasadoMin)} minutos</strong>{' '}
                ({pct(dados.resumo.atrasadoMin / dados.resumo.cargaTotalMin)} da carga) só são costurados{' '}
                <strong>depois do mês em que foram pedidos</strong>. O resto do horizonte absorve porque de
                jul/27 em diante quase não há plano lançado — mas isso é adiar, não caber.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                      <th className="px-2 py-1.5 text-left">período</th>
                      <th className="px-2 py-1.5 text-right">dias</th>
                      <th className="px-2 py-1.5 text-right">capacidade</th>
                      <th className="px-2 py-1.5 text-right">extra estimado</th>
                      <th className="px-2 py-1.5 text-right">pedido do mês</th>
                      <th className="px-2 py-1.5 text-right">veio de trás</th>
                      <th className="px-2 py-1.5 text-right">coube</th>
                      <th className="px-2 py-1.5 text-right">empurrado</th>
                      <th className="px-2 py-1.5 text-right">ocupação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodosFiltrados.map((p) => {
                      const demanda = p.pedidoMin + p.vindoDeTrasMin + (perfil ? 0 : p.extraMin);
                      const oc = p.capacidadeMin > 0 ? demanda / p.capacidadeMin : 0;
                      return (
                        <tr key={p.periodo} className={`border-b border-gray-100 ${oc > 1 ? 'bg-red-50/40' : ''}`}>
                          <td className="px-2 py-1.5 font-medium text-gray-800" title={p.periodo}>{p.mes}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{p.dias}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{num(p.capacidadeMin)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{perfil ? '—' : num(p.extraMin)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{num(p.pedidoMin)}</td>
                          <td className={`px-2 py-1.5 text-right tabular-nums ${p.vindoDeTrasMin > 0 ? 'text-amber-700' : 'text-gray-300'}`}>
                            {p.vindoDeTrasMin > 0 ? num(p.vindoDeTrasMin) : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">{num(p.coubeMin)}</td>
                          <td className={`px-2 py-1.5 text-right tabular-nums ${p.empurradoMin > 0 ? 'font-semibold text-red-700' : 'text-gray-300'}`}>
                            {p.empurradoMin > 0 ? num(p.empurradoMin) : '—'}
                          </td>
                          <td className={`px-2 py-1.5 text-right font-bold tabular-nums ${oc > 1 ? 'text-red-600' : 'text-gray-800'}`}>
                            {pct(oc)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-gray-500">
                “Veio de trás” é o que não coube no mês anterior e entra na fila deste. A carga adicional é reservada na capacidade dos grupos e não aparece nas colunas de pedido e atraso desta tabela. Com filtro de perfil, o extra não é atribuído ao perfil por falta de detalhe.
                A ocupação aqui é do MÊS, não acumulada — por isso difere da Visão Geral 2, que acumula.
                Meses sem plano lançado não representam necessariamente capacidade livre para novos pedidos.
              </p>

              {porMix.length > 0 && (
                <div className="mt-6 border-t border-gray-200 pt-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Quem atrasa — por mix de produção
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                          <th className="px-2 py-1.5 text-left">mix</th>
                          <th className="px-2 py-1.5 text-right">refs</th>
                          <th className="px-2 py-1.5 text-right">carga</th>
                          <th className="px-2 py-1.5 text-right">atrasada</th>
                          <th className="px-2 py-1.5 text-right">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {porMix.filter((m) => m.atrasada > 0).map((m) => (
                          <tr key={m.mix} className="border-b border-gray-100">
                            <td className="px-2 py-1.5 text-gray-800">{m.mix}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{m.refs}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{num(m.carga)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-red-700">{num(m.atrasada)}</td>
                            <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${m.pct > 0.3 ? 'text-red-600' : 'text-amber-700'}`}>
                              {pct(m.pct)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* ───── SEM DESTINO ───── */}
            {dados.resumo.refsSemDestino > 0 && (
              <div className="mb-6 rounded-lg border-2 border-red-300 bg-white p-6 shadow">
                <h2 className="mb-2 text-base font-semibold text-gray-800">
                  {dados.resumo.refsSemDestino} referências que esta lista não consegue decidir
                </h2>
                <p className="mb-3 leading-relaxed text-gray-700">
                  A simulação não encontrou destino com capacidade medida para estas referências. Pode haver histórico em um grupo sem capacidade medida; consulte as opções e valide com o PCP.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                        <th className="px-2 py-1.5 text-left">referência</th>
                        <th className="px-2 py-1.5 text-left">mix</th>
                        <th className="px-2 py-1.5 text-right">peças</th>
                        <th className="px-2 py-1.5 text-right">minutos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.referencias.filter((r) => r.candidatas === 0).map((r) => (
                        <tr key={r.referencia} className="border-b border-gray-100">
                          <td className="px-2 py-1.5 font-medium tabular-nums">{r.referencia}</td>
                          <td className="px-2 py-1.5 text-gray-700">{r.mix || '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{num(r.pecas)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-red-700">{num(r.cargaMin)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ───── A LISTA ───── */}
            <div className="rounded-lg bg-white p-4 shadow">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
                    A lista: referência → grupo
                  </h2>
                  <p className="text-xs text-gray-500">
                    Os grupos A–D mostram primeiro os grupos ativos que produziram a referência nos últimos {dados.meses} meses fechados, ordenados pela quantidade. Sem esse histórico, prevalecem as opções marcadas como corretas ou explicitamente indicadas como primeiro grupo na revisão do PCP de 16/11/2026; depois aparecem opções inferidas pelo mix. Sugestões por mix precisam de confirmação e a lista não garante capacidade. As demais observações dos casos marcados para ajuste ainda exigem análise. Abra a referência para ver a sequência simulada.
                    <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">hist</span>{' '}
                    o grupo já produziu a peça ·
                    <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">mix</span>{' '}
                    produz o mesmo tipo, sem histórico próprio na janela ·
                    <span className="ml-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-800">PCP</span>{' '}
                    indicado na revisão, sem histórico próprio na janela
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={baixarCsv} disabled={!visiveis.length} className="rounded bg-indigo-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-40" title="Exporta as referências mostradas com os grupos A a D">
                    Baixar lista para produção (CSV)
                  </button>
                  <select value={periodoLista} onChange={(e) => setPeriodoLista(e.target.value)} className="rounded border border-gray-300 bg-white px-2 py-1 text-sm" title="O período afeta a situação e os filtros de pendência e tempo">
                    <option value="">Todos os períodos</option>
                    {dados.periodos.map((p) => <option key={p.periodo} value={p.periodo}>{p.mes}</option>)}
                  </select>
                  <select
                    value={grupo}
                    onChange={(ev) => setGrupo(ev.target.value)}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
                    title="Mostra só as referências que esta proposta manda para este grupo"
                  >
                    <option value="">Todos os grupos</option>
                    {dados.grupos.map((g) => (
                      <option key={g.grupo} value={g.grupo}>{g.grupo}</option>
                    ))}
                  </select>
                  <input
                    value={busca}
                    onChange={(ev) => setBusca(ev.target.value)}
                    placeholder="referência"
                    className="w-40 rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                  {([
                    { id: 'todas' as const, rotulo: 'Todas' },
                    { id: 'rateadas' as const, rotulo: `Rateadas na simulação (${dados.resumo.refsRateadas})` },
                    { id: 'mudaram' as const, rotulo: 'Mudaram' },
                    { id: 'pendentes' as const, rotulo: 'Com pendência' },
                    { id: 'semTempo' as const, rotulo: 'Sem tempo' },
                    { id: 'semDestino' as const, rotulo: `Sem destino (${dados.resumo.refsSemDestino})` },
                  ]).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFiltro(f.id)}
                      className={`rounded border px-3 py-1 text-sm ${
                        filtro === f.id
                          ? 'border-brand-primary bg-brand-primary text-white'
                          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {f.rotulo}
                    </button>
                  ))}
                </div>
              </div>

              <p className="mb-3 text-xs text-gray-500">
                Mostrando {num(visiveis.length)} de {num(dados.referencias.length)} referências
                {' '}· O arquivo contém as opções A a D das referências mostradas. Confirme capacidade e aptidão com a produção antes de utilizá-las.
                {(perfil || grupoProduto || grupo) && (
                  <>
                    {' '}— {num(visiveis.reduce((t, r) => t + r.pecas, 0))} peças,{' '}
                    {num(visiveis.reduce((t, r) => t + r.cargaMin, 0))} min
                    {(() => {
                      const carga = visiveis.reduce((t, r) => t + r.cargaMin, 0);
                      const atrasada = visiveis.reduce((t, r) => t + r.cargaMin * r.atraso, 0);
                      return carga > 0 && atrasada > 0
                        ? <span className="text-red-700">, {pct(atrasada / carga)} atrasados</span>
                        : null;
                    })()}
                  </>
                )}
                {(perfil || grupoProduto || grupo) && (
                  <button
                    type="button"
                    onClick={() => { setPerfil(''); setGrupoProduto(''); setGrupo(''); }}
                    className="ml-2 text-brand-primary underline"
                  >
                    limpar filtros
                  </button>
                )}
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                      <th className="px-2 py-2 text-left">referência</th>
                      <th className="px-2 py-2 text-left">mix</th>
                      <th className="px-2 py-2 text-right">peças no horizonte</th>
                      <th className="px-2 py-2 text-left">situação por período</th>
                      {['A', 'B', 'C', 'D'].map((o) => (
                        <th key={o} className="px-2 py-2 text-left">Grupo {o}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((r) => {
                      const periodos = periodoLista ? r.periodos.filter((p) => p.periodo === periodoLista) : r.periodos;
                      const pendentes = periodos.filter((p) => p.pendenteMin > 0);
                      const atrasados = periodos.filter((p) => p.herdadoMin > 0);
                      const semTempo = r.semTempo && periodos.some((p) => p.pecas > 0);
                      const aberto = referenciaAberta === r.referencia;
                      return <Fragment key={r.referencia}>
                      <tr className={`border-b border-gray-100 ${pendentes.length || semTempo ? 'bg-red-50/50' : ''}`}>
                        <td className="whitespace-nowrap px-2 py-1.5 font-medium tabular-nums">
                          <button type="button" className="text-indigo-700 underline" onClick={() => setReferenciaAberta(aberto ? null : r.referencia)} aria-expanded={aberto}>{aberto ? '▾' : '▸'} {r.referencia}</button>
                          {r.naoCoubeMin > 0 && (
                            <span className="ml-1 text-[10px] font-semibold text-red-600" title={`${num(r.naoCoubeMin)} minutos seguem pendentes no fim do horizonte`}>!</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-xs text-gray-600">{r.mix || '—'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{num(r.pecas)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-xs">
                          {semTempo ? <span className="font-semibold text-red-700">Sem tempo de costura</span>
                            : pendentes.length ? <span className="font-semibold text-red-700">Pendente em {pendentes.length} {pendentes.length === 1 ? 'mês' : 'meses'}</span>
                            : atrasados.length ? <span className="font-semibold text-amber-700">Recebeu atraso em {atrasados.length} {atrasados.length === 1 ? 'mês' : 'meses'}</span>
                            : periodos.some((p) => p.pecas > 0 || p.herdadoMin > 0) ? <span className="text-emerald-700">Sem pendência registrada</span>
                            : <span className="text-gray-400">Sem carga no período</span>}
                        </td>
                        {[0, 1, 2, 3].map((i) => {
                          const g = r.opcoes[i];
                          if (!g) return <td key={i} className="px-2 py-1.5 text-gray-300">—</td>;
                          return (
                            <td key={i} className="whitespace-nowrap px-2 py-1.5">
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-xs text-gray-700">{g.grupo}</span>
                                <span className={`rounded px-1 py-0.5 text-[9px] font-semibold ${
                                  g.origem === 'historico' ? 'bg-emerald-100 text-emerald-800' : g.origem === 'revisao' ? 'bg-indigo-100 text-indigo-800' : 'bg-amber-100 text-amber-800'
                                }`}>
                                  {g.origem === 'historico' ? 'hist' : g.origem === 'revisao' ? 'PCP' : 'mix'}
                                </span>
                                {!g.capacidadeDisponivel && <span className="rounded bg-red-100 px-1 text-[9px] font-semibold text-red-800" title="Grupo fora das células ativas ou sem capacidade no cenário; não recebe carga na simulação">sem capacidade disponível</span>}
                              </div>
                              {g.origem === 'historico' && <div className="text-[10px] text-gray-500">{num(g.pecasHistorico || 0)} peças no histórico</div>}
                            </td>
                          );
                        })}
                      </tr>
                      {aberto && <tr className="border-b border-gray-200 bg-slate-50"><td colSpan={8} className="px-4 py-3">
                        <CaminhoDaReferencia referencia={r} periodos={periodos} rotulos={dados.periodos} />
                      </td></tr>}
                      </Fragment>;
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <MapaGruposCostura dados={dados} />

            <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4 text-xs leading-relaxed text-gray-500">
              <p className="mb-1 font-semibold text-gray-600">Como esta lista foi montada</p>
              <p>
                <strong>Quem já produziu:</strong> <code>vr_cdf_movopi</code> com{' '}
                <code>tp_historicomov = 51</code>, nos meses fechados, restrito aos locais dos grupos de
                capacidade. <strong>Mix:</strong> classificação 29 do ERP (<code>vr_prd_produtoclas</code>) —
                e a célula ganha o mix que ela <em>costurou</em>, não o que o cadastro diz, senão esta tela
                herdaria o erro que a Lista × Produção denuncia. <strong>Plano:</strong> a matriz, 14 períodos.{' '}
                <strong>Tempo:</strong> <code>vr_cdf_seqope</code> × <code>vr_cdf_operac</code>.{' '}
                <strong>Capacidade:</strong> <code>pcp_cache_eficiencia_dia</code>, minutos medidos ÷ dias com
                movimento — célula sem medição não entra como destino.
              </p>
              <p className="mt-2">
                O rateio é guloso e por período: a referência com menos saídas escolhe antes, para não perder a
                vaga para outra que tem quatro opções. Cada grupo respeita a capacidade estimada; o que não cabe fica pendente e pode atrasar. A proposta não é necessariamente a distribuição ótima. <strong>Nada é gravado no cadastro.</strong>
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
