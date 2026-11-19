'use client';

// CAPACIDADE x PLANO — a aba única (18/11/2026).
//
// Junta o Laboratório de capacidade e a Distribuição sugerida numa história só, com UM plano
// (o do gráfico da Visão Geral 2, com a Liebe Move), UMA capacidade (nível × sazonalidade ×
// dias, a mesma do gráfico) e UMA alocação (a lista referência → grupo). Capítulos:
//   1. O que a fábrica faz — o finalizado dos últimos 12 meses, por grupo e referência.
//   2. O plano contra a capacidade — em peças, acumulado.
//   3. A lista — referência → grupos A a D.
//   4. Como o plano roda pela lista — ocupação por família e o que cada grupo faz e empurra.
//   5. O que precisa mudar — o setup ideal por perfil.
//   6. Registro da investigação.
// Nada aqui grava dados.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';
import SetupIdeal, { type SetupIdealDados } from './SetupIdeal';
import type { DistribuicaoDados } from './ProducaoDistribuida';
import PlanoPelaLista from './PlanoPelaLista';
import { carregarPlanoVisaoGeral, type PlanoVisaoGeral } from './planoVisaoGeral';
import CapacidadePlano, { type PeriodoCapacidade } from './CapacidadePlano';
import DistribuicaoConteudo from './DistribuicaoConteudo';

// Capítulos "plano contra a capacidade", "o que precisa mudar" e "registro da investigação":
// guardados a pedido do PCP (19/11/2026) — a aba fica só com o fato 2026, o plano 2027 pela
// lista e a lista. O código continua aqui; true traz de volta (e volta a buscar os dados deles).
const MOSTRAR_CAPITULOS_GUARDADOS = false;

// Cabeçalho de capítulo: a aba conta uma história, na ordem.
function Capitulo({ n, titulo, texto, id }: { n: number; titulo: string; texto: string; id?: string }) {
  return (
    <div id={id} className="mb-3 mt-8 flex items-baseline gap-3 border-b-2 border-indigo-200 pb-2 first:mt-0">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">{n}</span>
      <div>
        <h2 className="text-lg font-bold text-brand-dark">{titulo}</h2>
        <p className="text-xs text-gray-500">{texto}</p>
      </div>
    </div>
  );
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
// Cenário da ESPERANÇA, lista da SUPERAÇÃO e a carga da distribuição: PlanoPelaLista.tsx
// (o mesmo componente da Visão Geral 2).

type RefFinalizada = {
  referencia: string;
  descricao: string;
  familia: string;
  status: string;
  total: number;
  porMes: Record<string, number>;
};

type CelulaFinalizada = {
  celula: string;
  ativa: boolean;
  total: number;
  porMes: Record<string, number>;
  diasPorMes: Record<string, number>;
  refs: RefFinalizada[];
};

type PlanoAno = {
  success: boolean;
  ano: number;
  loteId: string | null;
  total: number;
  meses: { mes: string; periodo: string | null; pecas: number | null; doLote: number | null }[];
};

type Finalizado = {
  success: boolean;
  de: string;
  geradoEm: string;
  meses: string[];
  diasPorMes: Record<string, number>;
  ultimoMovimento: string | null;
  totalPorMes: Record<string, number>;
  total: number;
  celulas: CelulaFinalizada[];
};

const num = (v: number) => Math.round(v || 0).toLocaleString('pt-BR');
const MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rotuloMes = (iso: string) => {
  const [a, m] = iso.split('-');
  return `${MESES_PT[Number(m) - 1] || m}/${String(a).slice(2)}`;
};
const dataBr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

// Markdown mínimo: títulos, listas, citação, negrito e parágrafos.
function negrito(texto: string): ReactNode[] {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
    parte.startsWith('**') && parte.endsWith('**')
      ? <strong key={i} className="font-semibold text-gray-900">{parte.slice(2, -2)}</strong>
      : <Fragment key={i}>{parte}</Fragment>);
}
function Markdown({ texto }: { texto: string }) {
  const blocos: ReactNode[] = [];
  let lista: string[] = [];
  const fecharLista = () => {
    if (!lista.length) return;
    blocos.push(
      <ul key={`ul-${blocos.length}`} className="mb-3 ml-5 list-disc space-y-1 text-sm text-gray-700">
        {lista.map((l, i) => <li key={i}>{negrito(l)}</li>)}
      </ul>,
    );
    lista = [];
  };
  texto.split(/\r?\n/).forEach((linha, i) => {
    const l = linha.trimEnd();
    if (/^\s*[-*] /.test(l)) { lista.push(l.replace(/^\s*[-*] /, '')); return; }
    fecharLista();
    if (!l.trim()) return;
    if (l.startsWith('### ')) blocos.push(<h4 key={i} className="mb-1 mt-4 text-sm font-semibold text-gray-800">{negrito(l.slice(4))}</h4>);
    else if (l.startsWith('## ')) blocos.push(<h3 key={i} className="mb-2 mt-6 border-b border-gray-200 pb-1 text-base font-bold text-brand-dark">{negrito(l.slice(3))}</h3>);
    else if (l.startsWith('# ')) blocos.push(<h2 key={i} className="mb-3 text-lg font-bold text-brand-dark">{negrito(l.slice(2))}</h2>);
    else if (l.startsWith('> ')) blocos.push(<p key={i} className="mb-3 border-l-4 border-indigo-200 bg-indigo-50/50 px-3 py-2 text-sm text-gray-700">{negrito(l.slice(2))}</p>);
    else blocos.push(<p key={i} className="mb-3 text-sm leading-relaxed text-gray-700">{negrito(l)}</p>);
  });
  fecharLista();
  return <div>{blocos}</div>;
}

export default function LaboratorioCapacidadePage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dados, setDados] = useState<Finalizado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [plano, setPlano] = useState<PlanoAno | null>(null);
  // PLANO DA VISÃO GERAL — o que o gráfico dela desenha, com edição limitada, Move e
  // previsto dentro. Chega pela URL (`plano=MA:121562,PX:...`) no link "Abrir no
  // Laboratório". Chave 'YYYY-MM'. Sem ele, vale o plano da matriz + lote.
  const [planoTela, setPlanoTela] = useState<Record<string, number> | null>(null);
  const [planoVG, setPlanoVG] = useState<PlanoVisaoGeral | null>(null);
  const [capUnica, setCapUnica] = useState<{ periodos: PeriodoCapacidade[]; minPeca: number } | null>(null);
  const [erroPlanoVG, setErroPlanoVG] = useState<string | null>(null);
  const [planoGrupo, setPlanoGrupo] = useState<SetupIdealDados | null>(null);
  const [erroPlanoGrupo, setErroPlanoGrupo] = useState<string | null>(null);
  const [distrib, setDistrib] = useState<DistribuicaoDados | null>(null);
  // A lista referência → grupo é grande: fica por último e só abre quando o PCP pede.
  const [mostrarLista, setMostrarLista] = useState(false);
  // Quem chega pelo link antigo da Distribuição sugerida (/laboratorio-capacidade#lista) quer a lista.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#lista') setMostrarLista(true);
  }, []);
  const [conclusoes, setConclusoes] = useState<{ texto: string; atualizadoEm: string | null } | null>(null);
  const [abertas, setAbertas] = useState<Record<string, boolean>>({});
  const [busca, setBusca] = useState('');
  // Grupos DESCONSIDERADOS da conta. Começa com os desativados: a capacidade deles não
  // existe mais, e somá-los superestima a fábrica de hoje. Cada grupo pode ser ligado ou
  // desligado à mão, para medir o efeito de qualquer um.
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set());
  const [mostrarControles, setMostrarControles] = useState(true);

  const carregar = useCallback(async (refresh = false) => {
    setLoading(true);
    setErro(null);
    try {
      // JANELA MÓVEL: os 12 meses FECHADOS antes do mês corrente, mais o corrente como coluna
      // parcial, fora das médias. Em 17/11/2026 isso é nov/25 a out/26 (pedido do PCP: nov e
      // dez de 2025 completam o ano). Quando novembro fechar, a janela anda sozinha.
      const hoje = new Date();
      const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 12, 1);
      const de = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}-01`;
      const qs = new URLSearchParams({ de });
      if (refresh) qs.set('refresh', 'true');
      const resp = await fetchNoCache(`${API_URL}/api/analise-capacidade/finalizado?${qs}`, { headers: authHeaders() }, 300000);
      const json = await resp.json();
      if (!json?.success) throw new Error(json?.error || 'Falha ao carregar');
      setDados(json);
      setExcluidos((atual) => (atual.size ? atual : new Set((json.celulas as CelulaFinalizada[]).filter((c) => !c.ativa).map((c) => c.celula))));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, []);

  const carregarPlanoGrupo = useCallback(async () => {
    try {
      const resp = await fetchNoCache(`${API_URL}/api/analise-capacidade/setup-ideal`, { headers: authHeaders() }, 300000);
      const json = await resp.json();
      if (!json?.success) throw new Error(json?.error || 'Falha ao distribuir o plano');
      setPlanoGrupo(json);
      setErroPlanoGrupo(null);
    } catch (e) {
      setErroPlanoGrupo(e instanceof Error ? e.message : 'Falha ao distribuir o plano');
    }
  }, []);

  const carregarPlano = useCallback(async () => {
    try {
      const ano = new Date().getFullYear() + 1;
      const resp = await fetchNoCache(`${API_URL}/api/analise-capacidade/plano-ano?ano=${ano}`, { headers: authHeaders() }, 300000);
      const json = await resp.json();
      if (json?.success) setPlano(json);
    } catch {
      setPlano(null);
    }
  }, []);

  const carregarConclusoes = useCallback(async () => {
    try {
      const resp = await fetchNoCache(`${API_URL}/api/analise-capacidade/conclusoes`, { headers: authHeaders() }, 60000);
      const json = await resp.json();
      if (json?.success) setConclusoes({ texto: json.texto || '', atualizadoEm: json.atualizadoEm || null });
    } catch {
      setConclusoes(null);
    }
  }, []);

  // CAPACIDADE ÚNICA — a mesma do gráfico da Visão Geral e da distribuição.
  const carregarCapUnica = useCallback(async () => {
    try {
      const resp = await fetchNoCache(`${API_URL}/api/capacidade/capacidade-mensal`, { headers: authHeaders() }, 300000);
      const json = await resp.json();
      if (json?.success) setCapUnica({ periodos: json.periodos, minPeca: Number(json.minPeca || 0) });
    } catch {
      setCapUnica(null);
    }
  }, []);

  // PLANO DA VISÃO GERAL, com Liebe Move — padrão desta aba.
  const carregarPlanoVG = useCallback(async () => {
    try {
      const pvg = await carregarPlanoVisaoGeral();
      setPlanoVG(pvg);
      setPlanoTela(pvg.porMes);
      setErroPlanoVG(null);
    } catch (e) {
      setErroPlanoVG(e instanceof Error ? e.message : 'Falha ao montar o plano da Visão Geral');
    }
  }, []);
  const planoVGFalhou = erroPlanoVG !== null;

  useEffect(() => {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    carregar();
    carregarPlano();
    carregarPlanoVG();
    // Só carregam se os capítulos guardados voltarem (setup-ideal é pesado).
    if (MOSTRAR_CAPITULOS_GUARDADOS) {
      carregarConclusoes();
      carregarPlanoGrupo();
      carregarCapUnica();
    }
  }, [carregar, carregarConclusoes, carregarPlano, carregarPlanoGrupo, carregarPlanoVG, carregarCapUnica, router]);

  // O plano 2027 pela lista espera o plano da Visão Geral (lote e carga extra). Se ele
  // falhar, roda com o lote mais recente, sem carga extra, e o aviso amarelo diz por quê.
  const parametrosLista = planoVG
    ? { lote: planoVG.loteId || '', extra: planoVG.extraParam, extraMove: planoVG.extraMoveParam }
    : planoVGFalhou ? { lote: '', extra: '', extraMove: '' } : null;

  // Busca por referência ou descrição: mostra só os grupos que a produziram, já abertos
  // e só com as referências que casam.
  const termo = busca.trim().toUpperCase();
  const linhas = useMemo(() => {
    if (!dados) return [];
    return dados.celulas
      .filter((c) => !excluidos.has(c.celula))
      .map((c) => ({
        ...c,
        refsVisiveis: termo
          ? c.refs.filter((r) => r.referencia.includes(termo) || r.descricao.toUpperCase().includes(termo))
          : c.refs,
      }))
      .filter((c) => !termo || c.refsVisiveis.length > 0);
  }, [dados, termo, excluidos]);

  const meses = dados?.meses || [];
  const totalVisivel = (m: string) => linhas.reduce((s, c) => s + (termo ? c.refsVisiveis.reduce((t, r) => t + (r.porMes[m] || 0), 0) : (c.porMes[m] || 0)), 0);

  // MESES FECHADOS: tudo antes do mes corrente. O mes corrente entra na matriz, mas fica
  // fora das medias — meio mes puxaria a media para baixo.
  const mesCorrente = dados ? dados.geradoEm.slice(0, 7) : '';
  const fechados = meses.filter((m) => m < mesCorrente);
  const nFechados = Math.max(1, fechados.length);
  const producaoFechados = fechados.reduce((s, m) => s + totalVisivel(m), 0);
  const diasFechados = dados ? fechados.reduce((s, m) => s + (dados.diasPorMes[m] || 0), 0) : 0;
  const mediaMensal = producaoFechados / nFechados;
  const mediaDias = diasFechados / nFechados;
  const mediaPorDia = diasFechados > 0 ? producaoFechados / diasFechados : 0;
  const mediaFechados = (porMes: Record<string, number>) => fechados.reduce((s, m) => s + (porMes[m] || 0), 0) / nFechados;
  // Por GRUPO: media de dias que ele finalizou peca nos meses fechados, e o ritmo dele
  // nesses dias. Mes em que o grupo nao trabalhou nenhum dia entra como zero na media de
  // dias — e o que a capacidade dele de fato foi naquele mes.
  const diasFechadosDoGrupo = (c: CelulaFinalizada) => fechados.reduce((s, m) => s + (c.diasPorMes?.[m] || 0), 0);
  // ORDEM DAS COLUNAS (pedido do PCP): jan a dez do calendário, cada mês com a ocorrência
  // fechada mais recente — hoje jan/26 a out/26 e depois nov/25 e dez/25. O mês corrente
  // não entra na matriz. Quando novembro fechar, nov/26 assume a coluna de nov sozinho.
  const colunas = [...fechados].sort((a, b) => Number(a.slice(5, 7)) - Number(b.slice(5, 7)) || a.localeCompare(b));
  const somaColunas = (porMes: Record<string, number>) => colunas.reduce((s, m) => s + (porMes[m] || 0), 0);
  // PLANO x FINALIZADO, coluna a coluna, pelo número do mês: a jan/26 finalizada fica ao
  // lado do plano de jan/27. Conta simples de peças: finalizado − plano. Positivo = o ritmo
  // do ano que passou cobre o plano daquele mês; negativo = falta.
  const planoDaColuna = (m: string) => {
    if (!plano) return null;
    const chave = `${plano.ano}-${m.slice(5, 7)}`;
    if (planoTela && planoTela[chave] !== undefined) return planoTela[chave];
    return plano.meses.find((x) => x.mes.slice(5, 7) === m.slice(5, 7))?.pecas ?? null;
  };
  const planoTotal = colunas.reduce((s, m) => s + (planoDaColuna(m) || 0), 0);
  const finalizadoTotal = colunas.reduce((s, m) => s + totalVisivel(m), 0);
  const corSaldo = (v: number) => (v >= 0 ? 'text-emerald-700' : 'text-red-700');
  const sinal = (v: number) => `${v > 0 ? '+' : ''}${num(v)}`;
  const periodoFechados = fechados.length ? `${rotuloMes(fechados[0])} a ${rotuloMes(fechados[fechados.length - 1])}` : '—';

  const alternar = (celula: string) => setExcluidos((atual) => {
    const novo = new Set(atual);
    if (novo.has(celula)) novo.delete(celula); else novo.add(celula);
    return novo;
  });
  const desativados = dados ? dados.celulas.filter((c) => !c.ativa) : [];
  const ativos = dados ? dados.celulas.filter((c) => c.ativa) : [];
  const pecasDesconsideradas = dados ? dados.celulas.filter((c) => excluidos.has(c.celula)).reduce((s, c) => s + c.total, 0) : 0;

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="min-h-screen bg-gray-100">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`${ml} transition-all duration-300 p-6`}>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-brand-dark">Capacidade x Plano</h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-600">
              Um plano (o do gráfico da Visão Geral, com a Liebe Move), uma capacidade (nível × sazonalidade × dias) e uma alocação: a <strong>lista referência → grupo</strong>.
              Do que a fábrica faz até o que precisa mudar. Nada aqui grava dados.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar referência ou descrição"
              className="w-60 rounded border border-gray-300 bg-white px-2 py-1"
            />
            <button type="button" onClick={() => carregar(true)} disabled={loading}
              className="rounded border border-gray-300 bg-white px-3 py-1 hover:bg-gray-50">
              {loading ? 'Lendo…' : 'Ler de novo'}
            </button>
          </div>
        </div>

        {erro && <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>}
        {loading && !dados && <div className="rounded border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">Lendo a produção finalizada no ERP…</div>}

        <Capitulo n={1} titulo="O que a fábrica faz" texto="O que foi finalizado nos últimos 12 meses fechados, por grupo de costura e referência, em peças — o fato, sem plano." />
        {dados && (
          <section className="mb-4 rounded-lg border border-gray-200 bg-white px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <span className="font-semibold text-gray-900">Grupos na conta</span>
                <span className="ml-2 text-gray-500">
                  {dados.celulas.length - excluidos.size} de {dados.celulas.length} considerados
                  {excluidos.size > 0 && <> · <strong className="text-amber-700">{num(pecasDesconsideradas)} peças desconsideradas</strong></>}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <button type="button" onClick={() => setExcluidos(new Set(desativados.map((c) => c.celula)))}
                  className="rounded border border-gray-300 bg-white px-2 py-1 hover:bg-gray-50">Desconsiderar desativados</button>
                <button type="button" onClick={() => setExcluidos(new Set())}
                  className="rounded border border-gray-300 bg-white px-2 py-1 hover:bg-gray-50">Considerar todos</button>
                <button type="button" onClick={() => setMostrarControles((v) => !v)}
                  className="rounded border border-gray-300 bg-white px-2 py-1 hover:bg-gray-50">{mostrarControles ? 'Recolher' : 'Escolher grupos'}</button>
              </div>
            </div>
            {mostrarControles && (
              <div className="mt-3 space-y-2">
                {[{ titulo: 'Desativados', lista: desativados }, { titulo: 'Ativos', lista: ativos }].map(({ titulo, lista }) => lista.length > 0 && (
                  <div key={titulo} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-20 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{titulo}</span>
                    {lista.map((c) => {
                      const dentro = !excluidos.has(c.celula);
                      return (
                        <button key={c.celula} type="button" onClick={() => alternar(c.celula)}
                          title={`${num(c.total)} peças em 2026 · clique para ${dentro ? 'desconsiderar' : 'considerar'}`}
                          className={`rounded-full border px-2 py-0.5 text-[11px] ${dentro
                            ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                            : 'border-gray-200 bg-gray-50 text-gray-400 line-through'}`}>
                          {c.celula}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {dados && fechados.length > 0 && (
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Média de produção por mês</div>
              <div className="mt-1 text-2xl font-bold text-gray-900">{num(mediaMensal)} <span className="text-sm font-normal text-gray-500">pç</span></div>
              <div className="mt-1 text-xs text-gray-500">{periodoFechados} · {fechados.length} meses fechados, só os grupos na conta</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Média de dias trabalhados por mês</div>
              <div className="mt-1 text-2xl font-bold text-gray-900">{mediaDias.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} <span className="text-sm font-normal text-gray-500">dias</span></div>
              <div className="mt-1 text-xs text-gray-500">{diasFechados} dias com finalização em {fechados.length} meses (inclui sábado trabalhado)</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Média por dia trabalhado</div>
              <div className="mt-1 text-2xl font-bold text-gray-900">{num(mediaPorDia)} <span className="text-sm font-normal text-gray-500">pç/dia</span></div>
              <div className="mt-1 text-xs text-gray-500">{num(producaoFechados)} peças ÷ {diasFechados} dias</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Mês corrente (parcial)</div>
              <div className="mt-1 text-2xl font-bold text-gray-900">{num(totalVisivel(mesCorrente))} <span className="text-sm font-normal text-gray-500">pç</span></div>
              <div className="mt-1 text-xs text-gray-500">
                {dados.diasPorMes[mesCorrente] || 0} dias até {dataBr(dados.ultimoMovimento)} · {dados.diasPorMes[mesCorrente] ? num(totalVisivel(mesCorrente) / dados.diasPorMes[mesCorrente]) : '—'} pç/dia · fora das médias
              </div>
            </div>
          </div>
        )}

        {dados && (
          <section className="mb-6 rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-3 text-xs text-gray-500">
              Fonte: <code>vr_cdf_movopi</code>, movimento 51 (baixa de peça acabada), sem estorno, só nos locais que são grupos de costura.
              Último movimento: <strong>{dataBr(dados.ultimoMovimento)}</strong>. O mês corrente não entra na matriz (só no cartão de parcial). Colunas em ordem de calendário, com o mês fechado mais recente de cada uma.
              Clique num grupo para abrir as referências.
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left">Grupo de costura / referência</th>
                    {colunas.map((m) => (
                      <th key={m} className={`px-2 py-2 text-right whitespace-nowrap ${m === mesCorrente ? 'text-gray-400' : ''}`}>
                        {rotuloMes(m)}
                        {m === mesCorrente && <div className="text-[10px] font-normal">parcial</div>}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="bg-indigo-50 px-3 py-2 text-right text-indigo-700" title={`Média de ${periodoFechados}, sem o mês corrente`}>Média/mês</th>
                    <th className="bg-indigo-50 px-3 py-2 text-right text-indigo-700" title="Média de dias em que o grupo finalizou peça, nos meses fechados">Dias/mês</th>
                    <th className="bg-indigo-50 px-3 py-2 text-right text-indigo-700" title="Peças dos meses fechados ÷ dias trabalhados pelo grupo">Pç/dia</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((c) => {
                    const aberta = termo ? true : abertas[c.celula] === true;
                    const totalLinha = termo ? c.refsVisiveis.reduce((s, r) => s + somaColunas(r.porMes), 0) : somaColunas(c.porMes);
                    return (
                      <Fragment key={c.celula}>
                        <tr
                          className={`cursor-pointer border-t border-gray-200 hover:bg-gray-50 ${c.ativa ? '' : 'text-gray-400'}`}
                          onClick={() => setAbertas((a) => ({ ...a, [c.celula]: !aberta }))}
                        >
                          <td className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold whitespace-nowrap">
                            <span className="mr-1 inline-block w-3 text-gray-400">{aberta ? '▾' : '▸'}</span>
                            {c.celula}
                            {!c.ativa && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-500">desativado</span>}
                            <span className="ml-2 text-[10px] font-normal text-gray-400">{c.refsVisiveis.length} ref.</span>
                          </td>
                          {colunas.map((m) => {
                            const v = termo ? c.refsVisiveis.reduce((s, r) => s + (r.porMes[m] || 0), 0) : (c.porMes[m] || 0);
                            const d = c.diasPorMes?.[m] || 0;
                            return (
                              <td key={m} className="px-2 py-2 text-right tabular-nums font-medium">
                                {v ? num(v) : '·'}
                                {d > 0 && <div className="text-[10px] font-normal text-gray-400">{d}d</div>}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-right tabular-nums font-bold">{num(totalLinha)}</td>
                          <td className="bg-indigo-50/60 px-3 py-2 text-right tabular-nums font-bold text-indigo-800">
                            {num(termo
                              ? c.refsVisiveis.reduce((s, r) => s + mediaFechados(r.porMes), 0)
                              : mediaFechados(c.porMes))}
                          </td>
                          <td className="bg-indigo-50/60 px-3 py-2 text-right tabular-nums font-semibold text-indigo-800">
                            {(diasFechadosDoGrupo(c) / nFechados).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
                          </td>
                          <td className="bg-indigo-50/60 px-3 py-2 text-right tabular-nums font-semibold text-indigo-800">
                            {diasFechadosDoGrupo(c) > 0
                              ? num((termo
                                ? c.refsVisiveis.reduce((s, r) => s + fechados.reduce((t, m) => t + (r.porMes[m] || 0), 0), 0)
                                : fechados.reduce((s, m) => s + (c.porMes[m] || 0), 0)) / diasFechadosDoGrupo(c))
                              : '—'}
                          </td>
                        </tr>
                        {aberta && c.refsVisiveis.map((r) => (
                          <tr key={`${c.celula}|${r.referencia}`} className="border-t border-gray-50 bg-gray-50/60 text-gray-600">
                            <td className="sticky left-0 z-10 bg-gray-50 py-1 pl-9 pr-3 whitespace-nowrap" title={r.descricao}>
                              <span className="font-mono text-gray-800">{r.referencia}</span>
                              <span className="ml-2 inline-block max-w-[16rem] truncate align-bottom">{r.descricao || '—'}</span>
                              <span className={`ml-2 rounded px-1 text-[10px] ${r.familia === 'FORA DA MATRIZ' ? 'bg-amber-50 text-amber-700' : 'bg-indigo-50 text-indigo-700'}`}>{r.familia}</span>
                            </td>
                            {colunas.map((m) => <td key={m} className="px-2 py-1 text-right tabular-nums">{r.porMes[m] ? num(r.porMes[m]) : ''}</td>)}
                            <td className="px-3 py-1 text-right tabular-nums font-semibold text-gray-800">{num(somaColunas(r.porMes))}</td>
                            <td className="bg-indigo-50/40 px-3 py-1 text-right tabular-nums text-indigo-800">{num(mediaFechados(r.porMes))}</td>
                            <td className="bg-indigo-50/40" />
                            <td className="bg-indigo-50/40" />
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                    <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2">Total finalizado</td>
                    {colunas.map((m) => <td key={m} className="px-2 py-2 text-right tabular-nums">{num(totalVisivel(m))}</td>)}
                    <td className="px-3 py-2 text-right tabular-nums">{num(colunas.reduce((s, m) => s + totalVisivel(m), 0))}</td>
                    <td className="bg-indigo-50 px-3 py-2 text-right tabular-nums text-indigo-800">{num(mediaMensal)}</td>
                    <td className="bg-indigo-50 px-3 py-2 text-right tabular-nums text-indigo-800">{mediaDias.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
                    <td className="bg-indigo-50 px-3 py-2 text-right tabular-nums text-indigo-800">{num(mediaPorDia)}</td>
                  </tr>
                  {plano && (
                    <>
                      <tr className="border-t border-gray-200 bg-amber-50/50 font-semibold text-amber-900">
                        <td className="sticky left-0 z-10 bg-amber-50 px-3 py-2" title={planoTela ? 'Plano da Visão Geral: o mesmo do gráfico — lote lançado no ERP, ou simulação + edição limitada projetada — com a Liebe Move somada.' : `Plano da matriz com o lote ${plano.loteId || '—'}, enquanto o plano da Visão Geral carrega.`}>
                          Plano {plano.ano}
                          <div className="text-[10px] font-normal">{planoTela ? 'Visão Geral + Liebe Move' : 'matriz + lote'}</div>
                        </td>
                        {colunas.map((m) => {
                          const v = planoDaColuna(m);
                          return <td key={m} className="px-2 py-2 text-right tabular-nums">{v === null ? '—' : num(v)}</td>;
                        })}
                        <td className="px-3 py-2 text-right tabular-nums">{num(planoTotal)}</td>
                        <td className="bg-indigo-50 px-3 py-2 text-right tabular-nums text-indigo-800">{num(planoTotal / nFechados)}</td>
                        <td className="bg-indigo-50" colSpan={2} />
                      </tr>
                      <tr className="border-b-2 border-gray-300 bg-white font-bold">
                        <td className="sticky left-0 z-10 bg-white px-3 py-2">Sobra / falta</td>
                        {colunas.map((m) => {
                          const p = planoDaColuna(m);
                          if (p === null) return <td key={m} className="px-2 py-2 text-right text-gray-300">—</td>;
                          const v = totalVisivel(m) - p;
                          return (
                            <td key={m} className={`px-2 py-2 text-right tabular-nums ${corSaldo(v)}`}>
                              {sinal(v)}
                              <div className="text-[10px] font-normal opacity-70">{p > 0 ? `${Math.round((totalVisivel(m) / p) * 100)}%` : ''}</div>
                            </td>
                          );
                        })}
                        <td className={`px-3 py-2 text-right tabular-nums ${corSaldo(finalizadoTotal - planoTotal)}`}>
                          {sinal(finalizadoTotal - planoTotal)}
                          <div className="text-[10px] font-normal opacity-70">{planoTotal > 0 ? `${Math.round((finalizadoTotal / planoTotal) * 100)}%` : ''}</div>
                        </td>
                        <td className={`bg-indigo-50 px-3 py-2 text-right tabular-nums ${corSaldo(finalizadoTotal - planoTotal)}`}>{sinal((finalizadoTotal - planoTotal) / nFechados)}</td>
                        <td className="bg-indigo-50" colSpan={2} />
                      </tr>
                    </>
                  )}
                  <tr className="bg-gray-50 text-gray-500">
                    <td className="sticky left-0 z-10 bg-gray-50 px-3 py-1">Dias com finalização</td>
                    {colunas.map((m) => <td key={m} className="px-2 py-1 text-right tabular-nums">{dados.diasPorMes[m] || 0}</td>)}
                    <td className="px-3 py-1 text-right tabular-nums">{colunas.reduce((s, m) => s + (dados.diasPorMes[m] || 0), 0)}</td>
                    <td className="bg-indigo-50" colSpan={3} />
                  </tr>
                  <tr className="bg-gray-50 text-gray-500">
                    <td className="sticky left-0 z-10 bg-gray-50 px-3 py-1">Peças por dia</td>
                    {colunas.map((m) => (
                      <td key={m} className="px-2 py-1 text-right tabular-nums">
                        {dados.diasPorMes[m] ? num(totalVisivel(m) / dados.diasPorMes[m]) : '—'}
                      </td>
                    ))}
                    <td className="px-3 py-1 text-right tabular-nums">
                      {num(colunas.reduce((s, m) => s + totalVisivel(m), 0) / Math.max(1, colunas.reduce((s, m) => s + (dados.diasPorMes[m] || 0), 0)))}
                    </td>
                    <td className="bg-indigo-50" colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        )}

        <Capitulo n={2} titulo="Como o plano 2027 roda pela lista" texto="Obedecendo a lista: em cima, o cenário e o resumo do ano (plano, atendimento, o que vai para o ano seguinte, ocupação por família); embaixo, grupo a grupo. Clique em qualquer número para ver como a simulação chegou nele." />
        <PlanoPelaLista parametros={parametrosLista} planoTela={planoTela} minPecaMove={planoVG?.minPecaMove || 0} onDistribuicao={setDistrib} />
        {/* A ocupação por família agora fica na visão macro da matriz (redesenho 19/11/2026). */}

        {erroPlanoVG && <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Plano da Visão Geral não carregou ({erroPlanoVG}): as tabelas usam o plano da matriz + lote.</div>}

        {/* GUARDADO (PCP, 19/11/2026): plano x capacidade, setup ideal e registro saíram da aba.
            Para voltar, troque MOSTRAR_CAPITULOS_GUARDADOS para true no topo do arquivo. */}
        {MOSTRAR_CAPITULOS_GUARDADOS && (<>
        <Capitulo n={3} titulo="O plano contra a capacidade" texto="O plano da Visão Geral (com a Liebe Move) contra a capacidade da fábrica, em peças, acumulado — o total, antes de olhar onde aperta." />
        {capUnica && planoVG ? (
          <CapacidadePlano capacidade={capUnica.periodos} plano={planoVG.meses} minPeca={capUnica.minPeca} />
        ) : (
          <div className="mb-4 rounded border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">Montando a capacidade e o plano da Visão Geral…</div>
        )}

        <Capitulo n={4} titulo="O que precisa mudar" texto="Se a fábrica fosse montada para este plano: quantos grupos de cada perfil, e onde a configuração de hoje sobra ou falta." />
        {erroPlanoGrupo && <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Execução ideal: {erroPlanoGrupo}</div>}
        {planoGrupo && <SetupIdeal dados={planoGrupo} />}

        <Capitulo n={5} titulo="Registro da investigação" texto="As conclusões, com data e o que é fato, hipótese e pendência." />
        <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold text-gray-900">Registro da investigação</h2>
            <span className="text-xs text-gray-400">
              docs/analise-capacidade/conclusoes.md{conclusoes?.atualizadoEm ? ` · atualizado em ${new Date(conclusoes.atualizadoEm).toLocaleString('pt-BR')}` : ''}
            </span>
          </div>
          {conclusoes?.texto ? <Markdown texto={conclusoes.texto} /> : <p className="text-sm text-gray-500">Nenhuma conclusão registrada ainda.</p>}
        </section>
        </>)}

        <Capitulo n={MOSTRAR_CAPITULOS_GUARDADOS ? 6 : 3} id="lista" titulo="A lista: referência → grupo" texto="Para onde cada referência vai: grupo A (quem mais produziu), e B, C, D quando o A enche. É a regra que a fábrica obedece — e a única que a aba usa." />
        <div className="mb-3">
          <button type="button" onClick={() => setMostrarLista((v) => !v)} className="rounded border border-indigo-200 bg-white px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50">
            {mostrarLista ? '▾ Esconder a lista' : `▸ Mostrar a lista (${distrib ? (distrib.referencias || []).length : '…'} referências)`}
          </button>
        </div>
        {mostrarLista && distrib && <DistribuicaoConteudo dadosExternos={distrib} embutido />}
        <div className="mb-6" />
      </div>
    </div>
  );
}
