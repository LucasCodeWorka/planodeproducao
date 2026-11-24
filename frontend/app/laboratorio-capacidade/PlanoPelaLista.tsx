'use client';

// PLANO 2027 PELA LISTA — a análise principal da execução do plano (PCP, 19/11/2026).
//
// Um componente só, usado na Projeção x Capacidade e na aba Capacidade x Plano: carrega a
// Distribuição sugerida com o cenário escolhido (ESPERANÇA, lista da SUPERAÇÃO) e desenha
// a barra do cenário, o resumo, a ocupação por família e a matriz (ProducaoDistribuida).
// Quem usa passa o plano (lote + carga extra em minutos); o cenário escolhido fica lembrado
// neste navegador e vale nas duas telas, para as duas contarem a mesma história.
// Nada aqui grava dados.

import { memo, useEffect, useRef, useState } from 'react';
import { authHeaders } from '../lib/auth';
import { fetchNoCache } from '../lib/api';
import ProducaoDistribuida, {
  LISTA_APONTAMENTO, MODOS_ESPERANCA, leituraFabricaPelaLista, resumoCenario,
  type DistribuicaoDados, type FamiliaPorGrupo, type LeituraListaMes, type ModoEsperanca, type RegraCenario, type ResumoCenario,
} from './ProducaoDistribuida';
import { GRUPO_MOVE } from './planoVisaoGeral';
import type { FamiliaOcupacao } from './OcupacaoFamilias';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
export const CORINGA = { grupo: '08 - ESPERANCA CA BASICO', modelo: '05 - POSITIVO SU BASICO' };
// As 3 referências que mais travam o sutiã básico (P25, 18/11/2026).
const REFS_ESPERANCA = ['341001', '103102', '123019'];
// Equipe da ESPERANÇA (PCP, 19/11/2026): 6 pessoas hoje, 10 quando vira sutiã. A capacidade
// medida reflete as 6; na conversão ela é multiplicada por 10/6 a partir de dez/26 (PX).
const ESPERANCA_PESSOAS = { hoje: 6, sutia: 10 };

const CHAVE_MODO = 'planoLista.esperanca';
const CHAVE_LISTA = 'planoLista.comLista';
// v2 (23/11/2026): o puxar da frente passou a vir ligado; a chave nova esquece o "0" antigo.
const CHAVE_ANTECIPAR = 'planoLista.antecipar.v2';
const ANTECIPAR_PADRAO = 2;

// Respostas já recebidas nesta aba do navegador, por cenário (a URL sem o fura-cache). Vale
// entre a Visão Geral e a Capacidade x Plano e ao voltar a um cenário: aparece na hora. Mais
// velha que VIDA_CLIENTE, aparece na hora e é buscada de novo por trás.
const cacheCliente = new Map<string, { dados: DistribuicaoDados; em: number }>();
const VIDA_CLIENTE = 10 * 60 * 1000;

function urlDoCenario(p: ParametrosPlano, modo: ModoEsperanca, comLista: boolean, antecipar: number) {
  const qs = new URLSearchParams({ meses: '6' });
  // Puxar da frente: capacidade parada adianta o plano dos N meses seguintes (0 = não).
  if (antecipar > 0) qs.set('antecipar', String(antecipar));
  if (comLista) qs.set('apontar', `${LISTA_APONTAMENTO.grupo}>${LISTA_APONTAMENTO.refs.map((r) => r.ref).join(',')}`);
  if (modo === 'coringa' || modo === 'vira-positivo') qs.set('coringa', `${CORINGA.grupo}>${CORINGA.modelo}`);
  if (modo === 'vira-3refs') qs.set('coringa_refs', `${CORINGA.grupo}>${REFS_ESPERANCA.join(',')}`);
  // Conversão: a partir de dez/26 (PX) ela larga as calcinhas próprias, com 10 pessoas.
  if (modo === 'vira-positivo' || modo === 'vira-3refs') {
    qs.set('coringa_desde', 'PX');
    qs.set('reforco', `${CORINGA.grupo}>${(ESPERANCA_PESSOAS.sutia / ESPERANCA_PESSOAS.hoje).toFixed(4)}@PX`);
  }
  if (p.extraMove) qs.set('extra_grupo', `${GRUPO_MOVE}>${p.extraMove}`);
  if (p.lote) qs.set('lote_id', p.lote);
  if (p.extra) qs.set('extra', p.extra);
  if (p.ferias) qs.set('ferias', '1');
  return `${API_URL}/api/capacidade/distribuicao-sugerida?${qs}`;
}

async function buscarCenario(url: string): Promise<DistribuicaoDados> {
  const r = await fetchNoCache(url, { headers: authHeaders() }, 300000);
  const j = await r.json();
  if (!j?.success) throw new Error(j?.error || 'Falha ao carregar a distribuição');
  cacheCliente.set(url, { dados: j, em: Date.now() });
  return j;
}

export type ParametrosPlano = {
  lote: string;
  /** Edição limitada (e previsto) em minutos por período, rateada pela fábrica. */
  extra: string;
  /** Liebe Move em minutos por período, direcionada à LIDERANÇA. */
  extraMove: string;
  ferias?: boolean;
};

function PlanoPelaLista({
  parametros, planoTela, minPecaMove, onDistribuicao, onLeitura,
}: {
  /** null enquanto o plano de quem chama não está pronto: nada é calculado antes. */
  parametros: ParametrosPlano | null;
  planoTela: Record<string, number> | null;
  minPecaMove: number;
  onDistribuicao?: (d: DistribuicaoDados | null) => void;
  onLeitura?: (l: LeituraListaMes[] | null) => void;
}) {
  // Padrão (P25): a ESPERANÇA vira sutiã em dez/26 copiando a POSITIVO; lista desligada.
  const [modo, setModoEstado] = useState<ModoEsperanca>('vira-positivo');
  const [comLista, setComListaEstado] = useState(false);
  // Padrão (PCP, 23/11/2026): capacidade parada puxa o plano de até 2 meses à frente.
  const [antecipar, setAnteciparEstado] = useState(ANTECIPAR_PADRAO);
  const [distrib, setDistrib] = useState<DistribuicaoDados | null>(null);
  const [familias, setFamilias] = useState<FamiliaPorGrupo>({});
  const [regras, setRegras] = useState<RegraCenario[]>([]);
  const [cenario, setCenario] = useState('');
  const [comparativo, setComparativo] = useState<Record<string, ResumoCenario>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const seq = useRef(0);

  // Cenário lembrado neste navegador: o mesmo nas duas telas.
  useEffect(() => {
    try {
      const m = window.localStorage.getItem(CHAVE_MODO);
      if (m && m in MODOS_ESPERANCA) setModoEstado(m as ModoEsperanca);
      if (window.localStorage.getItem(CHAVE_LISTA) === '1') setComListaEstado(true);
      const salvo = window.localStorage.getItem(CHAVE_ANTECIPAR);
      const a = Number(salvo);
      if (salvo !== null && a >= 0 && a <= 3) setAnteciparEstado(a);
    } catch { /* sem storage: fica o padrão */ }
  }, []);
  const setModo = (m: ModoEsperanca) => {
    setModoEstado(m);
    try { window.localStorage.setItem(CHAVE_MODO, m); } catch { /* sem storage */ }
  };
  const setComLista = (v: boolean) => {
    setComListaEstado(v);
    try { window.localStorage.setItem(CHAVE_LISTA, v ? '1' : '0'); } catch { /* sem storage */ }
  };
  const setAntecipar = (n: number) => {
    setAnteciparEstado(n);
    try { window.localStorage.setItem(CHAVE_ANTECIPAR, String(n)); } catch { /* sem storage */ }
  };
  // Chave do quadro comparativo: ESPERANÇA | lista | puxar.
  const k = (m: ModoEsperanca, l: boolean, a: number) => `${m}|${l ? 1 : 0}|${a}`;

  const chave = parametros ? `${parametros.lote}|${parametros.extra}|${parametros.extraMove}|${parametros.ferias ? 1 : 0}|${modo}|${comLista ? 1 : 0}|${antecipar}` : '';
  // Aplica uma resposta na tela.
  const aplicar = (j: DistribuicaoDados) => {
    if (!parametros) return;
    const { lote, extra, extraMove, ferias } = parametros;
    const mapa: FamiliaPorGrupo = {};
    for (const g of (j?.grupos || []) as { grupo: string; familia?: string; perfil?: string | null; viraFamilia?: string | null }[]) {
      mapa[g.grupo] = { familia: g.familia || 'Outros', perfil: g.perfil || null, vira: g.viraFamilia || null };
    }
    setFamilias(mapa);
    setDistrib(j);
    setComparativo((c) => ({ ...c, [k(modo, comLista, antecipar)]: resumoCenario(j) }));
    setRegras([
      { rotulo: `lote ${lote || '—'}`, simulacao: false },
      ...(extra ? [{ rotulo: 'edição limitada rateada', simulacao: false }] : []),
      ...(extraMove ? [{ rotulo: 'Liebe Move → LIDERANÇA', simulacao: false }] : []),
      ...(ferias ? [{ rotulo: 'férias de fevereiro', simulacao: false }] : []),
      ...(modo !== 'calcinha' ? [{ rotulo: `ESPERANÇA: ${MODOS_ESPERANCA[modo].selo}`, simulacao: true }] : []),
      ...(comLista ? [{ rotulo: `SUPERAÇÃO: + lista ${LISTA_APONTAMENTO.refs.length} refs`, simulacao: true }] : []),
      ...(antecipar > 0 ? [{ rotulo: `puxa da frente: até ${antecipar} ${antecipar === 1 ? 'mês' : 'meses'}`, simulacao: true }] : []),
    ]);
    setCenario(`lote ${lote || '—'}${extra ? ', edição limitada como carga extra rateada' : ''}${extraMove ? ', Liebe Move na LIDERANÇA (mix anatomic)' : ''}${ferias ? ', com as férias de fevereiro' : ''}${MODOS_ESPERANCA[modo].cenario}${comLista ? `, lista de ${LISTA_APONTAMENTO.refs.length} refs apontada para a SUPERAÇÃO` : ''}${antecipar > 0 ? `, capacidade parada puxando o plano de até ${antecipar} ${antecipar === 1 ? 'mês' : 'meses'} à frente` : ''}`);
    setErro(null);
  };
  useEffect(() => {
    if (!parametros) return;
    const meu = ++seq.current;
    const url = urlDoCenario(parametros, modo, comLista, antecipar);
    // As variações vizinhas, buscadas por trás: a outra posição da lista da SUPERAÇÃO e o
    // puxar da frente ligado/desligado. Marcar/desmarcar fica instantâneo e os quadros
    // comparativos se preenchem sozinhos.
    const vizinhas: [string, string][] = [
      [urlDoCenario(parametros, modo, !comLista, antecipar), k(modo, !comLista, antecipar)],
      [urlDoCenario(parametros, modo, comLista, antecipar > 0 ? 0 : 2), k(modo, comLista, antecipar > 0 ? 0 : 2)],
    ];
    const preCarregar = () => {
      for (const [u, chaveComp] of vizinhas) {
        const c = cacheCliente.get(u);
        if (c && Date.now() - c.em < VIDA_CLIENTE) {
          setComparativo((x) => ({ ...x, [chaveComp]: resumoCenario(c.dados) }));
          continue;
        }
        buscarCenario(u)
          .then((j) => setComparativo((x) => ({ ...x, [chaveComp]: resumoCenario(j) })))
          .catch(() => { /* só pré-carga */ });
      }
    };
    const guardado = cacheCliente.get(url);
    if (guardado) {
      aplicar(guardado.dados);
      if (Date.now() - guardado.em < VIDA_CLIENTE) { setCarregando(false); preCarregar(); return undefined; }
    }
    // Espera os parâmetros assentarem: a Visão Geral monta a carga extra aos poucos.
    const t = window.setTimeout(async () => {
      setCarregando(true);
      try {
        const j = await buscarCenario(url);
        if (meu !== seq.current) return; // chegou depois de outro pedido: descarta
        aplicar(j);
        preCarregar();
      } catch (e) {
        if (meu === seq.current) setErro(e instanceof Error ? e.message : 'Falha ao carregar a distribuição');
      } finally {
        if (meu === seq.current) setCarregando(false);
      }
    }, guardado ? 0 : 400);
    return () => window.clearTimeout(t);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [chave]);

  const familiasOcupacao = distrib ? ((distrib as unknown as { familias?: FamiliaOcupacao[] }).familias || null) : null;

  // Avisa quem usa: a distribuição (a lista da aba) e a leitura da fábrica (o gráfico).
  useEffect(() => { onDistribuicao?.(distrib); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [distrib]);
  useEffect(() => {
    if (!onLeitura) return;
    onLeitura(distrib && familiasOcupacao?.length ? leituraFabricaPelaLista(distrib, familias, familiasOcupacao, minPecaMove) : null);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [distrib, familias, minPecaMove]);

  const corr = (distrib as unknown as { temposCorrigidos?: { referencia: string; grupo: string | null; tempoRoteiro: number; tempoUsado: number; pecas: number }[] } | null)?.temposCorrigidos || [];
  const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

  return (
    <>
      {erro && <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Distribuição: {erro}</div>}
      {!distrib && !erro && (
        <div className="mb-4 rounded border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
          {carregando || parametros
            ? 'Calculando a distribuição do plano pelos grupos… a primeira leitura pode levar alguns minutos.'
            : 'Montando o plano (lote, Liebe Move e edição limitada)…'}
        </div>
      )}
      {distrib && (
        <ProducaoDistribuida dados={distrib} familias={familias} regras={regras}
          familiasOcupacao={familiasOcupacao} cenario={cenario} planoTela={planoTela} minPecaMove={minPecaMove}
          coringa={modo === 'calcinha' ? null : CORINGA} modo={modo} onModo={setModo} recalculando={carregando}
          comLista={comLista} onComLista={setComLista}
          semListaResumo={comparativo[k(modo, false, antecipar)] || null} comListaResumo={comparativo[k(modo, true, antecipar)] || null}
          antecipar={antecipar} onAntecipar={setAntecipar}
          semPuxarResumo={comparativo[k(modo, comLista, 0)] || null} comPuxarResumo={comparativo[k(modo, comLista, antecipar || 2)] || null} />
      )}
      {corr.length > 0 && (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <strong>{corr.length} referências sem roteiro de costura no ERP</strong> (só &quot;SETOR DE ALÇA&quot;, ou tempo zero) entram com o <strong>min/peça medido do grupo A</strong> —
          senão contariam quase sem carga e o grupo pareceria vago. O conserto definitivo é cadastrar o roteiro.
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
            {corr.map((c) => (
              <span key={c.referencia} className="whitespace-nowrap tabular-nums">
                <strong>{c.referencia}</strong> · {c.grupo ? (c.grupo.includes(' - ') ? c.grupo.split(' - ')[1] : c.grupo) : 'sem grupo'} · {fmt(c.tempoRoteiro)} → {fmt(c.tempoUsado)} min · {c.pecas.toLocaleString('pt-BR')} pç
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// memo: a Visão Geral redesenha muito; este bloco só redesenha quando as props dele mudam.
export default memo(PlanoPelaLista);
