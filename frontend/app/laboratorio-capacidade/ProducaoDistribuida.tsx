'use client';

// PRODUÇÃO DO PLANO COM O RELACIONAMENTO DE HOJE — a matriz da Distribuição sugerida.
//
// Redesenho de 19/11/2026 (pedido do PCP): mesma conta, outra leitura. A conta mora em
// matriz.ts (extraída sem mudar regra, travada por teste); aqui só se desenha, em 4 faixas:
//   A. barra do cenário  — o que está sendo simulado, sempre à vista; "Configurar" abre os
//                          controles (ESPERANÇA, lista da SUPERAÇÃO, comparativo);
//   B. visão macro       — plano, produzido, atendimento, vem/vai e a ocupação por família;
//   C. matriz            — Compacto (1 coluna por mês: atendimento + empurra + ocupação) ou
//                          Completo (veio, produzido, empurra — a tabela de antes), filtros;
//   D. painel lateral    — clique numa referência, grupo ou mês: o rastro da simulação.
//
// Conta de cada linha: veio + plano do mês − produzido = empurra. Veio de um mês é o
// empurra do anterior (por construção), por isso o Compacto não o repete.

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  FAMILIAS, PERIODOS, ROTULO_MOVE, atendimento, calendario, montarMatriz, producao,
  type DistribuicaoDados, type FamiliaPorGrupo, type GrupoDist, type Linha, type Quadra, type RefLinha,
} from './matriz';
import type { FamiliaOcupacao } from './OcupacaoFamilias';
import PainelDetalhe, { type Selecao } from './PainelDetalhe';

export type { DistribuicaoDados, FamiliaPorGrupo } from './matriz';

const num = (v: number) => Math.round(v || 0).toLocaleString('pt-BR');
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const curto = (g: string) => (g.includes(' - ') ? g.split(' - ')[1] : g);

const COR_FAMILIA: Record<string, { faixa: string; texto: string; borda: string }> = {
  'Sutiã': { faixa: 'bg-rose-50', texto: 'text-rose-900', borda: 'border-l-rose-400' },
  Calcinha: { faixa: 'bg-sky-50', texto: 'text-sky-900', borda: 'border-l-sky-400' },
  Anatomic: { faixa: 'bg-teal-50', texto: 'text-teal-900', borda: 'border-l-teal-400' },
  Noite: { faixa: 'bg-violet-50', texto: 'text-violet-900', borda: 'border-l-violet-400' },
  Outros: { faixa: 'bg-gray-50', texto: 'text-gray-800', borda: 'border-l-gray-400' },
};

function corOcupacao(o: number | null) {
  if (o === null) return 'text-gray-300';
  if (o > 1.005) return 'text-red-700 font-semibold';
  if (o >= 0.9) return 'text-amber-700';
  return 'text-gray-400';
}
function corBarra(o: number) {
  if (o > 1.005) return 'bg-red-600';
  if (o >= 0.995) return 'bg-amber-500';
  if (o >= 0.9) return 'bg-amber-300';
  return 'bg-gray-300';
}

type Coringa = { grupo: string; modelo: string };

// O que a ESPERANÇA faz na simulação (P25, 18/11/2026). Nada é gravado.
export type ModoEsperanca = 'calcinha' | 'coringa' | 'vira-positivo' | 'vira-3refs';
export const MODOS_ESPERANCA: Record<ModoEsperanca, { rotulo: string; cenario: string; selo: string }> = {
  'vira-positivo': { rotulo: 'Vira sutiã em dez/26, copiando a POSITIVO (padrão)', cenario: ', ESPERANÇA vira sutiã em dez/26 copiando a POSITIVO, com 10 pessoas', selo: 'vira sutiã dez/26 · copia positivo · 10 pessoas' },
  'vira-3refs': { rotulo: 'Vira sutiã em dez/26, só 341001 · 103102 · 123019', cenario: ', ESPERANÇA vira sutiã em dez/26 só com 341001, 103102 e 123019, com 10 pessoas', selo: 'vira sutiã dez/26 · 3 refs · 10 pessoas' },
  coringa: { rotulo: 'Coringa: copia a POSITIVO sem largar a calcinha', cenario: ', ESPERANÇA como coringa de sutiã básico', selo: 'coringa · positivo' },
  calcinha: { rotulo: 'Fica na calcinha (sem simulação)', cenario: '', selo: '' },
};
// LISTA DE REBALANCEAMENTO (P26, 19/11/2026, cenário ESPERANÇA vira sutiã com 10 pessoas):
// 10 referências dos sutiãs básicos lotados que a SUPERAÇÃO pode fazer (já fez ou tem
// costura gêmea). Ela entra como ÚLTIMA opção: só pega o que os grupos atuais não dão conta.
export const LISTA_APONTAMENTO = {
  grupo: '04 - SUPERACAO SU FASHION/BASICO',
  refs: [
    { ref: '123101', motivo: 'vai p/ 2028 · já fez 5.078' },
    { ref: '123022', motivo: 'vai p/ 2028 · gêmea 703001 (0,95)' },
    { ref: '123020', motivo: 'vai p/ 2028 · gêmea 703001 (0,95)' },
    { ref: '703604', motivo: 'vai p/ 2028 · gêmea 703013 (0,94)' },
    { ref: '123121', motivo: 'vai p/ 2028 · gêmea 703001 (0,93)' },
    { ref: '103006', motivo: 'atrasa no 2º sem. · já fez 10.201' },
    { ref: '203601', motivo: 'atrasa no 2º sem. · já fez 1.080' },
    { ref: '411001', motivo: 'atrasa no 2º sem. · já fez 720' },
    { ref: '103602', motivo: 'atrasa no 2º sem. · gêmea 103008 (0,91)' },
    { ref: '103102', motivo: 'atrasa no 2º sem. · já fez 4.800' },
  ],
};

// Resumo de um cenário para comparar com/sem a lista: peças que vão para o ano seguinte e a
// soma do atraso mês a mês no ano (peças paradas esperando, somadas de jan a dez).
export type ResumoCenario = { vaiSutia: number; vaiFabrica: number; atrasoSutiaAno: number; atrasoFabricaAno: number };
export function resumoCenario(d: DistribuicaoDados): ResumoCenario {
  const familiaA = new Map((d.grupos || []).map((g) => [g.grupo, (g as { familia?: string }).familia || 'Outros']));
  const ano = new Date().getFullYear() + 1;
  const doAno = PERIODOS.map((_, i) => new Date(new Date().getFullYear(), new Date().getMonth() + i, 1).getFullYear() === ano);
  const ultimo = PERIODOS[PERIODOS.length - 1];
  const r: ResumoCenario = { vaiSutia: 0, vaiFabrica: 0, atrasoSutiaAno: 0, atrasoFabricaAno: 0 };
  for (const ref of d.referencias) {
    const A = ref.opcoes?.[0]?.grupo;
    const sutia = A ? familiaA.get(A) === 'Sutiã' : false;
    for (const p of ref.periodos || []) {
      const i = PERIODOS.indexOf(p.periodo);
      const pend = Number(p.pendentePecas || 0);
      if (i >= 0 && doAno[i]) { r.atrasoFabricaAno += pend; if (sutia) r.atrasoSutiaAno += pend; }
      if (p.periodo === ultimo) { r.vaiFabrica += pend; if (sutia) r.vaiSutia += pend; }
    }
  }
  return r;
}

export type RegraCenario = { rotulo: string; simulacao: boolean };
type Vista = 'compacto' | 'completo';
type Filtro = 'todos' | 'empurra' | 'proximo' | 'semgrupo';
// Destaque da linha e do mês em investigação: sombra interna, por cima de qualquer fundo.
const HL = 'shadow-[inset_0_0_0_9999px_rgba(79,70,229,0.09)]';
// O mesmo destaque aplicado a todas as células de uma linha (escrito por extenso para o Tailwind ver).
const HL_LINHA = '[&>td]:shadow-[inset_0_0_0_9999px_rgba(79,70,229,0.09)]';

export default function ProducaoDistribuida({
  dados, familias, familiasOcupacao, regras, cenario, planoTela, minPecaMove, coringa, modo, onModo, recalculando,
  comLista, onComLista, semListaResumo, comListaResumo,
  antecipar = 0, onAntecipar, semPuxarResumo = null, comPuxarResumo = null,
}: {
  dados: DistribuicaoDados;
  familias: FamiliaPorGrupo;
  familiasOcupacao?: FamiliaOcupacao[] | null;
  regras: RegraCenario[];
  cenario: string;
  planoTela: Record<string, number> | null;
  minPecaMove: number;
  coringa: Coringa | null;
  modo: ModoEsperanca;
  onModo: (modo: ModoEsperanca) => void;
  recalculando: boolean;
  comLista: boolean;
  onComLista: (v: boolean) => void;
  semListaResumo: ResumoCenario | null;
  comListaResumo: ResumoCenario | null;
  /** Puxar da frente: quantos meses à frente a capacidade parada pode adiantar (0 = não). */
  antecipar?: number;
  onAntecipar?: (n: number) => void;
  semPuxarResumo?: ResumoCenario | null;
  comPuxarResumo?: ResumoCenario | null;
}) {
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [familiasFechadas, setFamiliasFechadas] = useState<Record<string, boolean>>({});
  const [vista, setVista] = useState<Vista>('compacto');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');
  const [sel, setSel] = useState<Selecao | null>(null);
  const [configAberta, setConfigAberta] = useState(false);
  const [comoLer, setComoLer] = useState(false);

  // Vista lembrada por quem olha (conveniência local; a conta não depende disso).
  useEffect(() => {
    try { const v = window.localStorage.getItem('matrizPlano.vista'); if (v === 'compacto' || v === 'completo') setVista(v); } catch { /* sem storage */ }
  }, []);
  const trocarVista = (v: Vista) => {
    setVista(v);
    try { window.localStorage.setItem('matrizPlano.vista', v); } catch { /* sem storage */ }
  };
  // Esc fecha o painel.
  useEffect(() => {
    if (!sel) return;
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') setSel(null); };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [sel]);

  const { anoAlvo, meses, chaves, cols } = useMemo(() => calendario(), []);
  const matriz = useMemo(() => montarMatriz(dados, familias, minPecaMove, cols), [dados, familias, minPecaMove, cols]);
  const { blocos, planoSku, pendente, semGrupo, fabrica, semCandidato } = matriz;

  const somaCols = (a: number[]) => cols.reduce((x, i) => x + (a[i] || 0), 0);
  const ultimaCol = cols.length ? cols[cols.length - 1] : -1;
  const herdadoJan = cols.length && cols[0] > 0 ? pendente[cols[0] - 1] : 0;
  const vaiParaProximo = ultimaCol >= 0 ? pendente[ultimaCol] : 0;
  const rotuloProximo = `jan/${String(anoAlvo + 1).slice(2)}`;
  const rotuloAnterior = `nov–dez/${String(anoAlvo - 1).slice(2)}`;
  const planoVg = planoTela ? cols.map((i) => planoTela[chaves[i]] ?? null) : null;
  const feitoAno = (t: Quadra) => cols.reduce((x, i) => x + producao(t, i).feito, 0);
  // Atendimento no ano = produzido ÷ (veio do 1º mês + plano do ano): a mesma razão do mês,
  // sobre o ano inteiro (veio dos outros meses é o empurra do anterior, já dentro da conta).
  const atendAno = (t: Quadra) => {
    const fila = (cols.length ? t.veio[cols[0]] : 0) + somaCols(t.plano);
    return fila > 0.5 ? feitoAno(t) / fila : null;
  };

  // ── Macro ────────────────────────────────────────────────────────────────────
  const gruposReais = matriz.linhas.filter((l) => l.papel !== 'largou');
  const lotados = gruposReais
    .map((l) => ({ grupo: l.grupo, meses: cols.filter((i) => (l.ocupacao[i] ?? 0) >= 0.995).length }))
    .filter((x) => x.meses > 0)
    .sort((a, b) => b.meses - a.meses);

  // ── Filtros (nunca mexem nos totais: família e fábrica são sempre do conjunto inteiro) ──
  const q = busca.trim().toUpperCase();
  const critica = (t: Quadra) => (filtro === 'empurra' ? somaCols(t.empurra) >= 0.5 : filtro === 'proximo' ? (t.empurra[ultimaCol] || 0) >= 0.5 : true);
  const refsVisiveis = (g: Linha): RefLinha[] => g.refs
    .filter((r) => somaCols(r.plano) >= 0.5)
    .filter((r) => critica(r))
    .filter((r) => !q || r.referencia.includes(q))
    .sort((a, b) => (somaCols(b.empurra) - somaCols(a.empurra)) || (somaCols(b.plano) - somaCols(a.plano)));
  const costuradasVisiveis = (g: Linha) => g.refsCosturadas
    .filter((r) => somaCols(r.pecas) >= 0.5)
    .filter((r) => !q || r.referencia.includes(q))
    .sort((a, b) => somaCols(b.pecas) - somaCols(a.pecas));
  const grupoVisivel = (g: Linha) => {
    if (filtro === 'semgrupo') return false;
    if (g.papel === 'convertido') return filtro === 'todos' && (!q || g.grupo.includes(q) || costuradasVisiveis(g).length > 0);
    if (!critica(g)) return false;
    return !q || g.grupo.includes(q) || refsVisiveis(g).length > 0;
  };
  const filtrando = filtro !== 'todos' || q !== '';
  const blocosVisiveis = blocos.map((b) => ({ ...b, visiveis: b.grupos.filter(grupoVisivel) })).filter((b) => b.visiveis.length > 0);
  const totalGrupos = blocos.reduce((s, b) => s + b.grupos.filter((g) => g.papel !== 'largou').length, 0);
  const gruposMostrados = blocosVisiveis.reduce((s, b) => s + b.visiveis.filter((g) => g.papel !== 'largou').length, 0);

  const abrirRef = (ref: string, col: number | null = null) => setSel({ tipo: 'ref', ref, col });
  const abrirGrupo = (grupo: string, col: number | null = null) => setSel({ tipo: 'grupo', grupo, col });
  const colSel = sel?.col ?? null;
  const linhaSel = sel ? (sel.tipo === 'ref' ? `ref:${sel.ref}` : `grupo:${sel.grupo}`) : null;

  // ── Células ──────────────────────────────────────────────────────────────────
  const dica = (t: Quadra, i: number, ocup?: number | null) => {
    const pr = producao(t, i);
    const at = atendimento(t, i);
    return [
      `${meses[i]} · plano do mês ${num(t.plano[i])}`,
      `veio ${num(t.veio[i])} + plano ${num(t.plano[i])} − produzido ${num(pr.feito)} = empurra ${num(t.empurra[i])}`,
      (t.adianta?.[i] || 0) >= 0.5 || (i > 0 && (t.adianta?.[i - 1] || 0) >= 0.5)
        ? `puxar da frente: entrou adiantado de antes ${num(i > 0 ? t.adianta[i - 1] : 0)}, ficou adiantado no fim do mês ${num(t.adianta[i])} (já no produzido)`
        : '',
      at !== null ? `atendimento = produzido ÷ (veio + plano) = ${pct(at)}` : '',
      ocup !== undefined && ocup !== null ? `ocupação do grupo = (alocado + extra) ÷ capacidade = ${pct(ocup)}` : '',
    ].filter(Boolean).join('\n');
  };

  // Compacto: 1 célula por mês.
  const celCompacta = (t: Quadra, i: number, o: { ocup?: number | null; forte?: boolean; onClick?: () => void; nivel: 'fab' | 'fam' | 'grupo' | 'ref' }) => {
    const at = atendimento(t, i);
    const emp = t.empurra[i];
    const hl = colSel === i ? HL : '';
    return (
      <td key={i} onClick={o.onClick} title={dica(t, i, o.ocup)}
        className={`border-r border-gray-100 px-1.5 py-1 align-top tabular-nums ${o.onClick ? 'cursor-pointer hover:bg-indigo-50/60' : ''} ${hl}`}>
        <div className="flex items-baseline justify-between gap-1 whitespace-nowrap">
          <span className={`${o.forte ? 'font-bold' : 'font-medium'} ${at === null ? 'text-gray-300' : at >= 0.995 ? 'text-gray-700' : 'text-gray-900'}`}>{at === null ? '·' : pct(at)}</span>
          {emp >= 0.5 && <span className={`text-[10px] text-red-700 ${o.forte ? 'font-bold' : 'font-semibold'}`}>↪{num(emp)}</span>}
          {emp < 0.5 && (t.adianta?.[i] || 0) >= 0.5 && <span className={`text-[10px] text-violet-700 ${o.forte ? 'font-bold' : 'font-semibold'}`} title="adiantado: feito agora para os meses seguintes">+{num(t.adianta[i])}</span>}
        </div>
        {o.ocup !== undefined && o.ocup !== null && (
          <div className="mt-0.5 h-1 w-full rounded-full bg-gray-100" aria-hidden>
            <div className={`h-1 rounded-full ${corBarra(o.ocup)}`} style={{ width: `${Math.min(100, Math.max(2, o.ocup * 100))}%` }} />
          </div>
        )}
      </td>
    );
  };
  // Compacto, linha do grupo convertido: só o que ele costurou (fora do total do bloco).
  const celCompactaCosturou = (pecas: number, i: number, ocup: number | null, onClick?: () => void) => (
    <td key={i} onClick={onClick}
      title={`${meses[i]} · costurou ${num(pecas)} peças de referências cujo grupo A é outro — já contadas no produzido do grupo A delas, por isso não somam no total do bloco${ocup !== null ? `\nocupação do grupo = ${pct(ocup)}` : ''}`}
      className={`border-r border-gray-100 px-1.5 py-1 align-top tabular-nums ${onClick ? 'cursor-pointer hover:bg-indigo-50/60' : ''} ${colSel === i ? HL : ''}`}>
      <div className="font-medium text-sky-800">{pecas >= 0.5 ? num(pecas) : '·'}</div>
      {ocup !== null && (
        <div className="mt-0.5 h-1 w-full rounded-full bg-gray-100" aria-hidden>
          <div className={`h-1 rounded-full ${corBarra(ocup)}`} style={{ width: `${Math.min(100, Math.max(2, ocup * 100))}%` }} />
        </div>
      )}
    </td>
  );

  // Completo: as três colunas de antes (veio, produzido, empurra).
  const celCompleta = (t: Quadra, i: number, o: { forte?: boolean; ocup?: number | null; onClick?: () => void } = {}) => {
    const pr = producao(t, i);
    const hl = colSel === i ? HL : '';
    return (
      <Fragment key={i}>
        <td className={`border-l border-gray-100 px-2 py-1.5 text-right tabular-nums ${t.veio[i] >= 0.5 ? 'text-orange-700' : 'text-gray-300'} ${o.forte ? 'font-bold' : ''} ${hl}`}>
          {t.veio[i] >= 0.5 ? num(t.veio[i]) : '·'}
        </td>
        <td onClick={o.onClick} className={`px-2 py-1.5 text-right tabular-nums text-emerald-800 ${o.onClick ? 'cursor-pointer hover:bg-indigo-50/60' : ''} ${hl}`} title={dica(t, i, o.ocup)}>
          <div className={o.forte ? 'font-bold' : 'font-medium'}>{pr.feito >= 0.5 ? num(pr.feito) : '·'}</div>
          {o.ocup !== undefined && o.ocup !== null && <div className={`text-[10px] ${corOcupacao(o.ocup)}`}>{pct(o.ocup)}</div>}
        </td>
        <td className={`border-r border-gray-200 px-2 py-1.5 text-right tabular-nums ${t.empurra[i] >= 0.5 ? `bg-red-50/60 text-red-700 ${o.forte ? 'font-bold' : 'font-semibold'}` : (t.adianta?.[i] || 0) >= 0.5 ? `bg-violet-50/70 text-violet-700 ${o.forte ? 'font-bold' : 'font-semibold'}` : 'text-gray-300'} ${hl}`}
          title={(t.adianta?.[i] || 0) >= 0.5 ? 'Adiantado: feito neste mês com capacidade que sobrou, para os meses seguintes (puxar da frente).' : undefined}>
          {t.empurra[i] >= 0.5 ? `↪${num(t.empurra[i])}` : (t.adianta?.[i] || 0) >= 0.5 ? `+${num(t.adianta[i])}` : '·'}
        </td>
      </Fragment>
    );
  };
  const celCompletaCosturou = (pecas: number, i: number, ocup: number | null, onClick?: () => void) => (
    <Fragment key={i}>
      <td className={`border-l border-gray-100 px-2 py-1.5 text-right text-gray-300 ${colSel === i ? HL : ''}`}>·</td>
      <td onClick={onClick} className={`px-2 py-1.5 text-right tabular-nums text-sky-800 ${onClick ? 'cursor-pointer' : ''} ${colSel === i ? HL : ''}`}
        title={`Costurou ${num(pecas)} peças de referências cujo grupo A é outro — já contadas no produzido do grupo A delas, por isso não somam no total do bloco`}>
        <div className="font-medium">{pecas >= 0.5 ? num(pecas) : '·'}</div>
        {ocup !== null && <div className={`text-[10px] ${corOcupacao(ocup)}`}>{pct(ocup)}</div>}
      </td>
      <td className={`border-r border-gray-200 px-2 py-1.5 text-right text-gray-300 ${colSel === i ? HL : ''}`}>·</td>
    </Fragment>
  );

  const meses12 = (t: Quadra, o: { forte?: boolean; ocup?: (number | null)[]; nivel: 'fab' | 'fam' | 'grupo' | 'ref'; clique?: (i: number) => void }) =>
    cols.map((i) => (vista === 'compacto'
      ? celCompacta(t, i, { ocup: o.ocup?.[i], forte: o.forte, nivel: o.nivel, onClick: o.clique ? () => o.clique!(i) : undefined })
      : celCompleta(t, i, { ocup: o.ocup?.[i], forte: o.forte, onClick: o.clique ? () => o.clique!(i) : undefined })));

  const vemDe = (t: Quadra | null, forte = false) => (
    <td className={`border-r border-gray-200 bg-gray-50 px-2 py-1 text-right tabular-nums ${forte ? 'font-bold' : ''} ${t && cols.length && t.veio[cols[0]] >= 0.5 ? 'text-orange-700' : 'text-gray-300'}`}
      title={`Atraso que entra em ${meses[cols[0]]} vindo de ${rotuloAnterior}`}>
      {t && cols.length && t.veio[cols[0]] >= 0.5 ? num(t.veio[cols[0]]) : '·'}
    </td>
  );
  const vaiPara = (t: Quadra | null, forte = false) => {
    const v = t && ultimaCol >= 0 ? t.empurra[ultimaCol] : 0;
    return (
      <td className={`border-l border-gray-200 bg-gray-50 px-2 py-1 text-right tabular-nums ${forte ? 'font-bold' : 'font-semibold'} ${v >= 0.5 ? 'text-red-700' : 'text-gray-300'}`}
        title={`O que não coube em ${meses[ultimaCol]} e vai para ${rotuloProximo}`}>
        {v >= 0.5 ? `⚑ ${num(v)}` : '·'}
      </td>
    );
  };
  const noAno = (t: Quadra, forte = false) => {
    const at = atendAno(t);
    return (
      <>
        <td className={`px-2 py-1 text-right tabular-nums ${forte ? 'font-bold' : ''}`}>{num(somaCols(t.plano))}</td>
        <td className={`px-2 py-1 text-right tabular-nums text-emerald-800 ${forte ? 'font-bold' : ''}`}>{num(feitoAno(t))}</td>
        <td className={`px-2 py-1 text-right tabular-nums ${forte ? 'font-bold' : ''} ${at !== null && at < 0.995 ? 'text-gray-900' : 'text-gray-500'}`}
          title="Atendimento no ano = produzido ÷ (veio do 1º mês + plano do ano)">{pct(at)}</td>
      </>
    );
  };
  const noAnoCosturou = (pecas: number[]) => (
    <>
      <td className="px-2 py-1 text-right text-gray-300">·</td>
      <td className="px-2 py-1 text-right tabular-nums text-sky-800">{num(somaCols(pecas))}</td>
      <td className="px-2 py-1 text-right text-gray-300">·</td>
    </>
  );

  const nColunasMes = vista === 'compacto' ? cols.length : cols.length * 3;
  const largMes = vista === 'compacto' ? 'min-w-[5.5rem]' : '';
  const STICKY_NOME = 'sticky left-0 z-10';

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white">
      {/* ── A. Barra do cenário ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 rounded-t-lg border-b border-gray-200 bg-white/95 px-4 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-2 font-semibold text-gray-900">Plano {anoAlvo} pela lista</h2>
          {regras.some((r) => r.simulacao)
            ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900 ring-1 ring-amber-300">● Simulação</span>
            : <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-600">Base</span>}
          {regras.map((r) => (
            <span key={r.rotulo} className={`rounded px-1.5 py-0.5 text-[11px] ${r.simulacao ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-200' : 'bg-gray-100 text-gray-600'}`}>{r.rotulo}</span>
          ))}
          {recalculando && <span className="animate-pulse text-[11px] font-semibold text-indigo-700">recalculando…</span>}
          <span className="ml-auto flex gap-1">
            <button type="button" onClick={() => setComoLer((v) => !v)} className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50">{comoLer ? '▾' : '▸'} Como ler</button>
            <button type="button" onClick={() => setConfigAberta((v) => !v)} className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${configAberta ? 'border-indigo-400 bg-indigo-50 text-indigo-800' : 'border-indigo-200 text-indigo-700 hover:bg-indigo-50'}`}>{configAberta ? '▾' : '▸'} Configurar simulação</button>
          </span>
        </div>
        {comoLer && (
          <p className="mt-2 text-xs text-gray-600">
            A mesma conta da Distribuição sugerida ({cenario}): cada referência vai para o grupo A pelo histórico e passa para B, C e D quando o A enche; o que não cabe vai
            para o mês seguinte. Cada linha é sobre as referências que são <strong>dela</strong> (grupo A). Conta: <strong>veio + plano do mês − produzido = empurra</strong>;
            o veio de um mês é o empurra do anterior. <strong>Compacto</strong>: por mês, o atendimento (produzido ÷ (veio + plano)), o ↪ empurra e, nos grupos, a barra de
            ocupação ((alocado + extra) ÷ capacidade). <strong>Completo</strong>: veio, produzido e empurra separados. ⚑ = vai para {rotuloProximo}. Clique numa referência,
            grupo ou mês para ver como a simulação chegou no número. Produzido = feito pelo próprio grupo ou por um alternativo; o que o grupo de fato costurou está no painel.
          </p>
        )}
        {configAberta && (
          <div className="mt-2 grid gap-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 rounded border border-sky-200 bg-sky-50 px-2 py-1.5 text-xs text-sky-900">
              <span className="flex flex-wrap items-center gap-2">
                <strong>ESPERANÇA</strong>
                <select value={modo} onChange={(e) => onModo(e.target.value as ModoEsperanca)} disabled={recalculando} className="rounded border border-sky-300 bg-white px-1 py-0.5 text-xs">
                  {(Object.keys(MODOS_ESPERANCA) as ModoEsperanca[]).map((k) => <option key={k} value={k}>{MODOS_ESPERANCA[k].rotulo}</option>)}
                </select>
              </span>
              <span className="text-sky-800">
                {modo === 'vira-positivo' && 'A partir de dez/26 ela passa de 6 para 10 pessoas (capacidade × 10/6), larga as calcinhas e entra logo depois da POSITIVO em toda referência dela; as calcinhas dela vão para os outros grupos de calcinha.'}
                {modo === 'vira-3refs' && 'A partir de dez/26 ela passa de 6 para 10 pessoas (capacidade × 10/6), larga as calcinhas e entra logo depois do grupo A só nas 3 referências que mais travam o sutiã básico.'}
                {modo === 'coringa' && 'Copia a POSITIVO mas continua com as calcinhas dela.'}
                {modo === 'calcinha' && 'Sem simulação: a ESPERANÇA segue como grupo de calcinha.'}
                {' '}Só simulação, nada é gravado.
              </span>
            </label>
            <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900">
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={comLista} onChange={(e) => onComLista(e.target.checked)} disabled={recalculando} />
                <strong>Apontar a lista de {LISTA_APONTAMENTO.refs.length} referências para a {curto(LISTA_APONTAMENTO.grupo)}</strong>
              </label>
              <div className="text-emerald-800">Ela entra como última opção: só pega o que os básicos não dão conta. Só simulação.</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {LISTA_APONTAMENTO.refs.map((r, k) => (
                  <button type="button" key={r.ref} onClick={() => abrirRef(r.ref)} className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-emerald-900 ring-1 ring-emerald-200 hover:ring-emerald-400" title={r.motivo}>
                    {k + 1}. {r.ref}
                  </button>
                ))}
              </div>
              {(semListaResumo || comListaResumo) && (
                <table className="mt-1.5 text-[11px]">
                  <thead>
                    <tr className="text-emerald-700">
                      <th className="pr-3 text-left font-normal" />
                      <th className="px-2 text-right font-normal">Sutiã vai p/ {rotuloProximo}</th>
                      <th className="px-2 text-right font-normal">Fábrica vai p/ {rotuloProximo}</th>
                      <th className="px-2 text-right font-normal" title="Peças paradas esperando, somadas de jan a dez: mede o atraso dentro do ano, mesmo do que não chega no ano seguinte">Sutiã: atraso somado no ano</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {([['Sem a lista', semListaResumo], ['Com a lista', comListaResumo]] as const).map(([rot, r]) => (
                      <tr key={rot} className={(rot === 'Com a lista') === comLista ? 'font-semibold' : ''}>
                        <td className="pr-3">{rot}</td>
                        {r ? (
                          <>
                            <td className="px-2 text-right">{num(r.vaiSutia)}</td>
                            <td className="px-2 text-right">{num(r.vaiFabrica)}</td>
                            <td className="px-2 text-right">{num(r.atrasoSutiaAno)}</td>
                          </>
                        ) : <td colSpan={3} className="px-2 text-emerald-600">marque/desmarque para calcular</td>}
                      </tr>
                    ))}
                    {semListaResumo && comListaResumo && (
                      <tr className="text-emerald-700">
                        <td className="pr-3">Melhora</td>
                        <td className="px-2 text-right">{num(semListaResumo.vaiSutia - comListaResumo.vaiSutia)}</td>
                        <td className="px-2 text-right">{num(semListaResumo.vaiFabrica - comListaResumo.vaiFabrica)}</td>
                        <td className="px-2 text-right">{num(semListaResumo.atrasoSutiaAno - comListaResumo.atrasoSutiaAno)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
            {onAntecipar && (
              <div className="rounded border border-violet-200 bg-violet-50 px-2 py-1.5 text-xs text-violet-900">
                <span className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input type="checkbox" checked={antecipar > 0} onChange={(e) => onAntecipar(e.target.checked ? 2 : 0)} disabled={recalculando} />
                    <strong>Puxar da frente</strong>
                  </label>
                  {antecipar > 0 && (
                    <select value={antecipar} onChange={(e) => onAntecipar(Number(e.target.value))} disabled={recalculando} className="rounded border border-violet-300 bg-white px-1 py-0.5 text-xs">
                      {[1, 2, 3].map((k) => <option key={k} value={k}>até {k} {k === 1 ? 'mês' : 'meses'} à frente</option>)}
                    </select>
                  )}
                </span>
                <div className="text-violet-800">
                  Depois que o mês está resolvido — o plano dele, o atraso e a ajuda aos grupos lotados pela lista —, a capacidade que ainda sobrou parada adianta o plano dos
                  meses seguintes, só de referências que estão na lista daquele grupo. O adiantado aparece em <span className="font-semibold text-violet-700">+roxo</span>; o plano não muda. Só simulação.
                </div>
                {(semPuxarResumo || comPuxarResumo) && (
                  <table className="mt-1.5 text-[11px]">
                    <thead>
                      <tr className="text-violet-700">
                        <th className="pr-3 text-left font-normal" />
                        <th className="px-2 text-right font-normal">Fábrica vai p/ {rotuloProximo}</th>
                        <th className="px-2 text-right font-normal" title="Peças paradas esperando, somadas de jan a dez">Fábrica: atraso somado no ano</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {([['Sem puxar', semPuxarResumo], ['Puxando', comPuxarResumo]] as const).map(([rot, r]) => (
                        <tr key={rot} className={(rot === 'Puxando') === (antecipar > 0) ? 'font-semibold' : ''}>
                          <td className="pr-3">{rot}</td>
                          {r ? (
                            <>
                              <td className="px-2 text-right">{num(r.vaiFabrica)}</td>
                              <td className="px-2 text-right">{num(r.atrasoFabricaAno)}</td>
                            </>
                          ) : <td colSpan={2} className="px-2 text-violet-600">calculando…</td>}
                        </tr>
                      ))}
                      {semPuxarResumo && comPuxarResumo && (
                        <tr className="text-violet-700">
                          <td className="pr-3">Melhora</td>
                          <td className="px-2 text-right">{num(semPuxarResumo.vaiFabrica - comPuxarResumo.vaiFabrica)}</td>
                          <td className="px-2 text-right">{num(semPuxarResumo.atrasoFabricaAno - comPuxarResumo.atrasoFabricaAno)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── B. Visão macro ──────────────────────────────────────────────────── */}
      <div className="border-b border-gray-200 px-4 py-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Indicador rotulo={`Plano ${anoAlvo}`} valor={num(somaCols(fabrica.plano))} nota={planoVg ? `Visão Geral: ${num(planoVg.reduce((x: number, v) => x + (v || 0), 0))}` : 'plano por SKU'}
            dica="Plano das referências (SKU) nos 12 meses. A Visão Geral soma ainda edição limitada, Move e previsto, que entram como carga em minutos, sem peça." />
          <Indicador rotulo="Vem de" sub={rotuloAnterior} valor={num(herdadoJan)} tom={herdadoJan >= 0.5 ? 'atencao' : undefined}
            dica={`Atraso que entra em ${meses[cols[0]]}, vindo de ${rotuloAnterior}.`} />
          <Indicador rotulo="Produzido" valor={num(feitoAno(fabrica))} nota="do veio + plano"
            dica="Σ dos meses de (veio + plano − empurra), pelas referências." />
          <Indicador rotulo="Atendimento" valor={pct(atendAno(fabrica))} nota="produzido ÷ (vem de + plano)"
            dica="Produzido no ano ÷ (o que veio de nov–dez + plano do ano)." />
          <Indicador rotulo="Vai para" sub={rotuloProximo} valor={num(vaiParaProximo)} tom={vaiParaProximo >= 0.5 ? 'critico' : 'ok'}
            nota={blocos.filter((b) => (b.empurra[ultimaCol] || 0) >= 0.5).map((b) => `${b.familia} ${num(b.empurra[ultimaCol])}`).join(' · ') || 'nada'}
            dica={`O que não coube em ${meses[ultimaCol]} e passa para ${rotuloProximo}. Por família (grupo A da referência); o resto é sem grupo candidato.`} />
          <Indicador rotulo="Grupos que lotaram" valor={`${lotados.length} de ${gruposReais.length}`} nota="chegaram a 100% em algum mês" tom={lotados.length ? 'atencao' : 'ok'}
            dica={lotados.map((x) => `${curto(x.grupo)}: ${x.meses} ${x.meses === 1 ? 'mês' : 'meses'} a 100%`).join('\n') || 'nenhum'} />
        </div>
        {familiasOcupacao && familiasOcupacao.length > 0 && <FaixaFamilias dados={dados} familias={familias} blocos={blocos} familiasOcupacao={familiasOcupacao} meses={meses} anoAlvo={anoAlvo} colSel={colSel} />}
      </div>

      {/* ── C. Matriz ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2 text-xs">
        <div className="inline-flex overflow-hidden rounded border border-gray-300" role="group" aria-label="Modo de visualização">
          {(['compacto', 'completo'] as Vista[]).map((v) => (
            <button key={v} type="button" onClick={() => trocarVista(v)} aria-pressed={vista === v}
              className={`px-2.5 py-1 ${vista === v ? 'bg-gray-800 font-semibold text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
              {v === 'compacto' ? 'Compacto' : 'Completo'}
            </button>
          ))}
        </div>
        <div className="inline-flex flex-wrap gap-1" role="group" aria-label="Filtro rápido">
          {([
            ['todos', 'Todos'],
            ['empurra', '↪ Com empurra'],
            ['proximo', `⚑ Vai p/ ${rotuloProximo}`],
            ['semgrupo', `∅ Sem grupo (${semCandidato.length})`],
          ] as [Filtro, string][]).map(([f, rot]) => (
            <button key={f} type="button" onClick={() => setFiltro(f)} aria-pressed={filtro === f}
              className={`rounded-full border px-2.5 py-0.5 ${filtro === f ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
              {rot}
            </button>
          ))}
        </div>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="buscar referência ou grupo"
          className="w-48 rounded border border-gray-300 px-2 py-1 text-xs" />
        {filtrando && (
          <span className="text-gray-500">mostrando {gruposMostrados} de {totalGrupos} grupos · totais de família e fábrica são sempre do conjunto inteiro</span>
        )}
        <span className="ml-auto flex gap-1">
          <button type="button" onClick={() => setAbertos(Object.fromEntries(matriz.linhas.map((l) => [l.chave, true])))} className="rounded border border-gray-200 px-2 py-0.5 text-gray-600 hover:bg-gray-50">abrir todos</button>
          <button type="button" onClick={() => setAbertos({})} className="rounded border border-gray-200 px-2 py-0.5 text-gray-600 hover:bg-gray-50">fechar todos</button>
        </span>
      </div>

      <div className="max-h-[calc(100vh-9rem)] overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-20">
            <tr className="bg-gray-100 text-gray-600">
              <th rowSpan={vista === 'completo' ? 2 : 1} className={`${STICKY_NOME} z-30 min-w-[17rem] border-b border-gray-300 bg-gray-100 px-3 py-2 text-left align-bottom`}>Família · grupo · referência</th>
              <th rowSpan={vista === 'completo' ? 2 : 1} className="border-b border-r border-gray-300 bg-gray-100 px-2 py-2 text-right align-bottom whitespace-nowrap" title={`Atraso que entra em ${meses[cols[0]]} vindo de ${rotuloAnterior}`}>
                Vem de<div className="text-[10px] font-normal">{rotuloAnterior}</div>
              </th>
              {cols.map((i) => (
                <th key={i} colSpan={vista === 'completo' ? 3 : 1}
                  onClick={() => setSel((s) => (s ? { ...s, col: s.col === i ? null : i } : s))}
                  className={`border-b border-r border-gray-300 px-2 py-2 text-center whitespace-nowrap ${largMes} ${colSel === i ? 'bg-indigo-100 text-indigo-900' : 'bg-gray-100'} ${sel ? 'cursor-pointer' : ''}`}>
                  {meses[i]}
                </th>
              ))}
              <th rowSpan={vista === 'completo' ? 2 : 1} className="border-b border-l border-gray-300 bg-gray-100 px-2 py-2 text-right align-bottom whitespace-nowrap" title={`O que não coube em ${meses[ultimaCol]} e vai para ${rotuloProximo}`}>
                Vai para<div className="text-[10px] font-normal">{rotuloProximo}</div>
              </th>
              <th colSpan={3} className="border-b border-gray-300 bg-gray-100 px-2 pt-2 text-center">No ano</th>
            </tr>
            {vista === 'completo' ? (
              <tr className="bg-gray-100 text-gray-600">
                {cols.map((i) => (
                  <Fragment key={i}>
                    <th className="border-b border-gray-300 bg-gray-100 px-2 pb-2 text-right text-[10px] font-semibold leading-tight text-orange-700" title="Demanda reprimida: o que chegou atrasado do mês anterior">veio do<br />mês ant.</th>
                    <th className="border-b border-gray-300 bg-gray-100 px-2 pb-2 text-right text-[10px] font-semibold text-emerald-800" title="O que dá para produzir no mês, do que veio e do plano do mês">produzido</th>
                    <th className="border-b border-r border-gray-300 bg-gray-100 px-2 pb-2 text-right text-[10px] font-semibold text-red-700">empurra</th>
                  </Fragment>
                ))}
                <th className="border-b border-gray-300 bg-gray-100 px-2 pb-2 text-right text-[10px] font-normal">plano</th>
                <th className="border-b border-gray-300 bg-gray-100 px-2 pb-2 text-right text-[10px] font-semibold text-emerald-800">produzido</th>
                <th className="border-b border-gray-300 bg-gray-100 px-2 pb-2 text-right text-[10px] font-normal">atend.</th>
              </tr>
            ) : (
              <tr className="bg-gray-100 text-gray-500">
                <th className={`${STICKY_NOME} z-30 border-b border-gray-300 bg-gray-100 px-3 pb-1 text-left text-[10px] font-normal`}>atendimento · ↪ empurra · ▬ ocupação</th>
                <th className="border-b border-r border-gray-300 bg-gray-100" />
                {cols.map((i) => <th key={i} className="border-b border-r border-gray-300 bg-gray-100" />)}
                <th className="border-b border-l border-gray-300 bg-gray-100" />
                <th className="border-b border-gray-300 bg-gray-100 px-2 pb-1 text-right text-[10px] font-normal">plano</th>
                <th className="border-b border-gray-300 bg-gray-100 px-2 pb-1 text-right text-[10px] font-semibold text-emerald-800">produzido</th>
                <th className="border-b border-gray-300 bg-gray-100 px-2 pb-1 text-right text-[10px] font-normal">atend.</th>
              </tr>
            )}
            {/* Fábrica: o consolidado, fixo no topo junto com os meses. */}
            <tr className="bg-slate-200 text-[12.5px] text-slate-900 [&>td]:border-b-[3px] [&>td]:border-double [&>td]:border-b-slate-500 [&>td]:bg-slate-200">
              <td className={`${STICKY_NOME} z-30 border-b-[3px] border-double border-slate-500 bg-slate-200 px-3 py-1.5 font-extrabold uppercase tracking-wide`}
                title="Fábrica inteira, pelas referências: veio, plano, produzido e empurrado">Σ Fábrica</td>
              <td className="border-b-[3px] border-r border-double border-slate-500 bg-slate-200 px-2 py-1.5 text-right font-bold tabular-nums text-red-700">{herdadoJan >= 0.5 ? num(herdadoJan) : '·'}</td>
              {cols.map((i) => (vista === 'compacto' ? celCompacta(fabrica, i, { forte: true, nivel: 'fab' }) : celCompleta(fabrica, i, { forte: true })))}
              <td className="border-b-[3px] border-l border-double border-slate-500 bg-slate-200 px-2 py-1.5 text-right font-extrabold tabular-nums text-red-700">{vaiParaProximo >= 0.5 ? `⚑ ${num(vaiParaProximo)}` : '·'}</td>
              <td className="border-b-[3px] border-double border-slate-500 bg-slate-200 px-2 py-1.5 text-right font-bold tabular-nums">{num(somaCols(fabrica.plano))}</td>
              <td className="border-b-[3px] border-double border-slate-500 bg-slate-200 px-2 py-1.5 text-right font-bold tabular-nums text-emerald-800">{num(feitoAno(fabrica))}</td>
              <td className="border-b-[3px] border-double border-slate-500 bg-slate-200 px-2 py-1.5 text-right font-bold tabular-nums">{pct(atendAno(fabrica))}</td>
            </tr>
          </thead>

          <tbody>
            {filtro === 'semgrupo' && (
              <>
                <tr className="bg-gray-100">
                  <td className={`${STICKY_NOME} border-t-2 border-gray-400 bg-gray-100 px-3 py-1.5 font-bold uppercase tracking-wide text-gray-800`}>∅ Sem grupo candidato <span className="ml-1 text-[10px] font-normal normal-case">{semCandidato.length} ref.</span></td>
                  <td className="border-t-2 border-gray-400 bg-gray-50" />
                  {cols.map((i) => (
                    <td key={i} colSpan={vista === 'completo' ? 3 : 1} className="border-t-2 border-r border-gray-400 border-r-gray-100 px-2 py-1.5 text-right tabular-nums text-red-700">
                      {semGrupo[i] >= 0.5 ? `↪${num(semGrupo[i])}` : '·'}
                    </td>
                  ))}
                  <td className="border-t-2 border-gray-400 bg-gray-50 px-2 text-right font-semibold tabular-nums text-red-700">{semGrupo[ultimaCol] >= 0.5 ? `⚑ ${num(semGrupo[ultimaCol])}` : '·'}</td>
                  <td colSpan={3} className="border-t-2 border-gray-400" />
                </tr>
                {semCandidato.length === 0 && (
                  <tr><td colSpan={nColunasMes + 6} className="px-3 py-3 text-gray-500">Nenhuma referência sem grupo candidato neste cenário.</td></tr>
                )}
                {semCandidato.filter((r) => !q || r.referencia.includes(q)).map((r) => (
                  <LinhaRef key={`sem|${r.referencia}`} r={r} sel={linhaSel === `ref:${r.referencia}`} onAbrir={(col) => abrirRef(r.referencia, col)}
                    meses12={meses12} vemDe={vemDe} vaiPara={vaiPara} noAno={noAno} />
                ))}
              </>
            )}

            {blocosVisiveis.map((b) => {
              const cor = COR_FAMILIA[b.familia] || COR_FAMILIA.Outros;
              const fechada = familiasFechadas[b.familia] === true;
              const nGrupos = b.grupos.filter((g) => g.papel !== 'largou').length;
              const vai = b.empurra[ultimaCol] || 0;
              return (
                <Fragment key={b.familia}>
                  <tr className={`${cor.faixa} ${cor.texto} text-[12.5px] [&>td]:border-t-2 [&>td]:border-t-gray-400`}>
                    <td className={`${STICKY_NOME} cursor-pointer border-l-4 border-t-2 border-gray-400 ${cor.borda} ${cor.faixa} px-3 py-2 font-bold`}
                      onClick={() => setFamiliasFechadas((f) => ({ ...f, [b.familia]: !fechada }))}>
                      <span className="mr-1 inline-block w-3 text-gray-500">{fechada ? '▸' : '▾'}</span>
                      <span className="uppercase tracking-wide">{b.familia}</span>
                      <span className="ml-2 text-[10px] font-normal">{filtrando ? `${b.visiveis.filter((g) => g.papel !== 'largou').length} de ${nGrupos}` : nGrupos} grupo{nGrupos === 1 ? '' : 's'}</span>
                      {vai >= 0.5 && <span className="ml-2 text-[10px] font-semibold text-red-700">⚑ {num(vai)}</span>}
                    </td>
                    {vemDe(b, true)}
                    {meses12(b, { forte: true, nivel: 'fam' })}
                    {vaiPara(b, true)}
                    {noAno(b, true)}
                  </tr>
                  {!fechada && b.visiveis.map((g) => {
                    const aberto = abertos[g.chave] === true || (q !== '' && g.papel !== 'convertido' && refsVisiveis(g).some((r) => r.referencia.includes(q)));
                    const convertido = g.papel === 'convertido';
                    const refs = convertido ? [] : refsVisiveis(g);
                    const costuradas = convertido ? costuradasVisiveis(g) : [];
                    const nRefs = convertido ? costuradas.length : g.refs.filter((r) => somaCols(r.plano) >= 0.5).length;
                    const temEmpurra = !convertido && somaCols(g.empurra) >= 0.5;
                    const vaiG = convertido ? 0 : g.empurra[ultimaCol] || 0;
                    const destacada = linhaSel === `grupo:${g.grupo}`;
                    return (
                      <Fragment key={g.chave}>
                        <tr className={`group bg-white hover:bg-gray-50 [&>td]:border-t [&>td]:border-t-gray-200 ${g.papel === 'largou' ? 'text-gray-500' : 'text-gray-900'} ${destacada ? HL_LINHA : ''}`}>
                          <td className={`${STICKY_NOME} bg-white px-3 py-1.5 whitespace-nowrap group-hover:bg-gray-50`}>
                            <button type="button" onClick={() => setAbertos((a) => ({ ...a, [g.chave]: !aberto }))} className="mr-1 inline-block w-4 text-gray-400 hover:text-gray-700" aria-label={aberto ? 'Recolher' : 'Expandir'}>
                              {aberto ? '▾' : '▸'}
                            </button>
                            <button type="button" onClick={() => abrirGrupo(g.grupo)} className="font-semibold hover:text-indigo-700 hover:underline" title="Ver detalhes do grupo">
                              {g.papel === 'largou' ? <span className="italic font-normal">{curto(g.grupo)} · referências que largou</span> : curto(g.grupo)}
                            </button>
                            {coringa && g.grupo === coringa.grupo && g.papel !== 'largou' && MODOS_ESPERANCA[modo].selo && (
                              <span className="ml-1.5 rounded bg-sky-100 px-1 py-0.5 text-[10px] font-semibold text-sky-800" title={MODOS_ESPERANCA[modo].rotulo}>{MODOS_ESPERANCA[modo].selo}</span>
                            )}
                            {comLista && g.grupo === LISTA_APONTAMENTO.grupo && (
                              <span className="ml-1.5 rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-semibold text-emerald-800" title={LISTA_APONTAMENTO.refs.map((r) => r.ref).join(', ')}>+ lista {LISTA_APONTAMENTO.refs.length} refs</span>
                            )}
                            <span className="ml-1.5 text-[10px] text-gray-400">{nRefs} ref.{convertido ? ' costuradas' : ''}</span>
                            {temEmpurra && <span className="ml-1 text-[10px] text-red-700" title="Empurra em algum mês do ano">↪</span>}
                            {vaiG >= 0.5 && <span className="ml-0.5 text-[10px] font-semibold text-red-700" title={`${num(vaiG)} vão para ${rotuloProximo}`}>⚑</span>}
                          </td>
                          {convertido ? <td className="border-r border-gray-200 bg-gray-50" /> : vemDe(g)}
                          {convertido
                            ? cols.map((i) => (vista === 'compacto'
                              ? celCompactaCosturou(g.costurado[i], i, g.ocupacao[i], () => abrirGrupo(g.grupo, i))
                              : <Fragment key={i}>{celCompletaCosturou(g.costurado[i], i, g.ocupacao[i], () => abrirGrupo(g.grupo, i))}</Fragment>))
                            : meses12(g, { ocup: g.papel === 'largou' ? undefined : g.ocupacao, nivel: 'grupo', clique: (i) => abrirGrupo(g.grupo, i) })}
                          {convertido ? <td className="border-l border-gray-200 bg-gray-50" /> : vaiPara(g)}
                          {convertido ? noAnoCosturou(g.costurado) : noAno(g)}
                        </tr>
                        {aberto && convertido && costuradas.map((r) => {
                          const a = dados.referencias.find((x) => x.referencia === r.referencia)?.opcoes?.[0]?.grupo;
                          return (
                            <tr key={`${g.chave}|${r.referencia}`} className={`bg-gray-50/70 text-gray-600 ${linhaSel === `ref:${r.referencia}` ? HL_LINHA : ''}`}>
                              <td className={`${STICKY_NOME} border-t border-gray-100 bg-gray-50 py-1 pl-10 pr-3 whitespace-nowrap`}>
                                <button type="button" onClick={() => abrirRef(r.referencia)} className="font-mono text-[11px] text-gray-800 hover:text-indigo-700 hover:underline">{r.referencia}</button>
                                {a && <span className="ml-2 text-[10px] text-gray-400">grupo A: {curto(a)}</span>}
                              </td>
                              <td className="border-r border-gray-200 bg-gray-50" />
                              {cols.map((i) => (vista === 'compacto'
                                ? <Fragment key={i}>{celCompactaCosturou(r.pecas[i], i, null, () => abrirRef(r.referencia, i))}</Fragment>
                                : <Fragment key={i}>{celCompletaCosturou(r.pecas[i], i, null, () => abrirRef(r.referencia, i))}</Fragment>))}
                              <td className="border-l border-gray-200 bg-gray-50" />
                              {noAnoCosturou(r.pecas)}
                            </tr>
                          );
                        })}
                        {aberto && !convertido && refs.map((r) => (
                          <LinhaRef key={`${g.chave}|${r.referencia}`} r={r} sel={linhaSel === `ref:${r.referencia}`} onAbrir={(col) => abrirRef(r.referencia, col)}
                            meses12={meses12} vemDe={vemDe} vaiPara={vaiPara} noAno={noAno} />
                        ))}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
            {filtro !== 'semgrupo' && blocosVisiveis.length === 0 && (
              <tr><td colSpan={nColunasMes + 6} className="px-3 py-4 text-center text-gray-500">Nenhum grupo com esse filtro.</td></tr>
            )}
          </tbody>

          <tfoot>
            {planoVg && (
              <tr className="bg-amber-50 font-bold text-amber-900">
                <td className={`${STICKY_NOME} border-t-2 border-gray-300 bg-amber-50 px-3 py-2`} title="O plano que o gráfico da Visão Geral desenha: lote + edição limitada + Liebe Move">Plano da Visão Geral</td>
                <td className="border-t-2 border-gray-300 bg-amber-50" />
                {planoVg.map((v, k) => <td key={k} colSpan={vista === 'completo' ? 3 : 1} className="border-r border-t-2 border-gray-300 border-r-amber-100 px-2 py-2 text-right tabular-nums">{v === null ? '—' : num(v)}</td>)}
                <td className="border-t-2 border-gray-300 bg-amber-50" />
                <td className="border-t-2 border-gray-300 px-2 py-2 text-right tabular-nums">{num(planoVg.reduce((x: number, v) => x + (v || 0), 0))}</td>
                <td colSpan={2} className="border-t-2 border-gray-300" />
              </tr>
            )}
            <tr className="bg-gray-50 text-gray-600">
              <td className={`${STICKY_NOME} bg-gray-50 px-3 py-2`}
                title="Peças por SKU que a distribuição reparte: plano do lote mais o em processo. Edição limitada, Move e previsto entram como carga extra em minutos, ocupando os grupos, mas sem peça.">
                Plano por SKU que a distribuição reparte
              </td>
              <td className="bg-gray-50" />
              {cols.map((i) => <td key={i} colSpan={vista === 'completo' ? 3 : 1} className="border-r border-gray-100 px-2 py-2 text-right tabular-nums">{num(planoSku[i])}</td>)}
              <td className="bg-gray-50" />
              <td className="px-2 py-2 text-right tabular-nums">{num(somaCols(planoSku))}</td>
              <td colSpan={2} />
            </tr>
            {cols.some((i) => semGrupo[i] >= 0.5) && filtro !== 'semgrupo' && (
              <tr className="bg-gray-50 text-gray-500">
                <td className={`${STICKY_NOME} bg-gray-50 px-3 py-1`} title="Referências sem nenhum grupo candidato: ficam pendentes sem passar por grupo. Somadas aos empurrados dos grupos, fecham o empurrado da fábrica.">
                  <button type="button" onClick={() => setFiltro('semgrupo')} className="hover:text-indigo-700 hover:underline">∅ dos empurrados, sem grupo candidato</button>
                </td>
                <td className="bg-gray-50" />
                {cols.map((i) => (
                  <td key={i} colSpan={vista === 'completo' ? 3 : 1} className="border-r border-gray-100 px-2 py-1 text-right tabular-nums">{semGrupo[i] >= 0.5 ? `↪${num(semGrupo[i])}` : '·'}</td>
                ))}
                <td className="bg-gray-50 px-2 text-right tabular-nums">{semGrupo[ultimaCol] >= 0.5 ? `⚑ ${num(semGrupo[ultimaCol])}` : '·'}</td>
                <td colSpan={3} />
              </tr>
            )}
          </tfoot>
        </table>
      </div>
      <div className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-500">
        Produzido = feito pelo próprio grupo ou por um alternativo; o que o grupo de fato costurou está no painel (clique no nome do grupo). A parte do plano sem SKU — edição
        limitada projetada, Move e previsto — entra como carga extra em minutos, ocupando os grupos; por isso a ocupação pode chegar a 100% sem peça correspondente.
      </div>

      {sel && (
        <PainelDetalhe sel={sel} dados={dados} matriz={matriz} meses={meses} cols={cols} rotuloProximo={rotuloProximo}
          onFechar={() => setSel(null)} onSel={setSel} />
      )}
    </section>
  );
}

function LinhaRef({ r, sel, onAbrir, meses12, vemDe, vaiPara, noAno }: {
  r: RefLinha;
  sel: boolean;
  onAbrir: (col: number | null) => void;
  meses12: (t: Quadra, o: { forte?: boolean; ocup?: (number | null)[]; nivel: 'fab' | 'fam' | 'grupo' | 'ref'; clique?: (i: number) => void }) => ReactNode[];
  vemDe: (t: Quadra | null, forte?: boolean) => ReactNode;
  vaiPara: (t: Quadra | null, forte?: boolean) => ReactNode;
  noAno: (t: Quadra, forte?: boolean) => ReactNode;
}) {
  const move = r.referencia === ROTULO_MOVE;
  return (
    <tr className={`bg-gray-50/70 text-gray-600 [&>td]:border-t [&>td]:border-t-gray-100 ${sel ? HL_LINHA : ''}`}>
      <td className="sticky left-0 z-10 bg-gray-50 py-1 pl-10 pr-3 whitespace-nowrap">
        <button type="button" onClick={() => onAbrir(null)} className={`${move ? 'font-sans italic' : 'font-mono'} text-[11px] text-gray-800 hover:text-indigo-700 hover:underline`}>{r.referencia}</button>
      </td>
      {vemDe(r)}
      {meses12(r, { nivel: 'ref', clique: (i) => onAbrir(i) }).map((c, k) => <Fragment key={k}>{c}</Fragment>)}
      {vaiPara(r)}
      {noAno(r)}
    </tr>
  );
}

function Indicador({ rotulo, sub, valor, nota, dica, tom }: { rotulo: string; sub?: string; valor: string; nota?: string; dica?: string; tom?: 'ok' | 'atencao' | 'critico' }) {
  const cor = tom === 'critico' ? 'border-red-300 bg-red-50' : tom === 'atencao' ? 'border-amber-200 bg-amber-50/60' : 'border-gray-200 bg-white';
  const sinal = tom === 'critico' ? '⚑ ' : tom === 'atencao' ? '▲ ' : '';
  return (
    <div className={`rounded border px-3 py-2 ${cor}`} title={dica}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{rotulo}{sub ? <span className="ml-1 normal-case">{sub}</span> : null}</div>
      <div className="text-lg font-bold tabular-nums text-gray-900">{sinal}{valor}</div>
      {nota && <div className="truncate text-[10px] text-gray-500" title={nota}>{nota}</div>}
    </div>
  );
}

// OCUPAÇÃO POR FAMÍLIA PELA LISTA, mês a mês (corrigida em 19/11/2026, pedido do PCP).
// A versão anterior juntava a capacidade de todos os grupos da família num balde só e a
// comparava com todo o plano da família: a sobra da SUPERAÇÃO, FELICIDADE e PERSEVERANÇA
// "pagava" o atraso dos básicos — dizia "sobra 21 dias" no Sutiã com 9.103 peças indo para
// o ano seguinte. Pela lista, uma não compensa a outra: um grupo parado não faz referência
// que não pode ir para ele. Por isso, por família e mês, separado:
//   ocupação = Σ (alocado + extra) ÷ Σ capacidade dos grupos dela (o que a distribuição usou)
//   ↪       = peças empurradas das referências cujo grupo A é dela (as mesmas da matriz);
//             em dias = minutos pendentes ÷ capacidade diária da família
//   ociosa  = Σ por GRUPO de (capacidade − alocado − extra), em dias da família
// Grupo convertido (a ESPERANÇA) conta na família nova a partir do mês da conversão.
type FamiliaMes = { cap: number; uso: number; ociosoMin: number; atrasoMin: number; atrasoPc: number; adiantPc: number; ociosos: { grupo: string; min: number }[] };

// A conta da faixa, sem desenho: a Visão Geral lê a linha Σ Fábrica daqui para o gráfico,
// então gráfico e faixa saem do MESMO número.
export function contaFaixa(dados: DistribuicaoDados, familias: FamiliaPorGrupo, blocos: { familia: string; empurra: number[]; adianta?: number[] }[], familiasOcupacao: FamiliaOcupacao[]) {
  const n = PERIODOS.length;
  // Dias de cada mês: o backend manda os dias ACUMULADOS; a diferença dá os do mês.
  const diasAcum = (familiasOcupacao[0]?.meses || []).map((m) => Number(m.diasDisponiveis || 0));
  const dias = PERIODOS.map((_, i) => (diasAcum[i] || 0) - (i > 0 ? diasAcum[i - 1] || 0 : 0));
  const base = (g: string) => familias[g]?.familia || 'Outros';
  const tab = new Map<string, FamiliaMes[]>();
  const de = (f: string) => {
    if (!tab.has(f)) tab.set(f, Array.from({ length: n }, () => ({ cap: 0, uso: 0, ociosoMin: 0, atrasoMin: 0, atrasoPc: 0, adiantPc: 0, ociosos: [] })));
    return tab.get(f)!;
  };
  for (const g of dados.grupos as (GrupoDist & { viraFamilia?: string | null; viraDesde?: string | null })[]) {
    const desde = g.viraDesde ? PERIODOS.indexOf(g.viraDesde) : -1;
    for (const m of g.meses || []) {
      const i = PERIODOS.indexOf(m.periodo);
      if (i < 0) continue;
      const f = g.viraFamilia && desde >= 0 && i >= desde ? g.viraFamilia : base(g.grupo);
      const x = de(f)[i];
      const uso = Number(m.alocadoMin || 0) + Number(m.extraMin || 0);
      const ocioso = Math.max(0, Number(m.capacidadeMin || 0) - uso);
      x.cap += Number(m.capacidadeMin || 0);
      x.uso += uso;
      x.ociosoMin += ocioso;
      if (ocioso >= 500) x.ociosos.push({ grupo: g.grupo, min: ocioso });
      // Move que não coube fica pendente no grupo dela (família de origem do grupo).
      const dir = m.extraDirecionado;
      if (dir) de(base(g.grupo))[i].atrasoMin += Number(dir.pendenteMin || 0);
    }
  }
  for (const r of dados.referencias) {
    const A = r.opcoes?.[0]?.grupo;
    if (!A) continue;
    const linha = de(base(A));
    for (const p of r.periodos || []) {
      const i = PERIODOS.indexOf(p.periodo);
      if (i >= 0) linha[i].atrasoMin += Number(p.pendenteMin || 0);
    }
  }
  // Peças empurradas: as mesmas da matriz (inclui a Move em peças).
  for (const b of blocos) {
    const linha = de(b.familia);
    b.empurra.forEach((v, i) => { linha[i].atrasoPc = v; });
    (b.adianta || []).forEach((v, i) => { linha[i].adiantPc = v; });
  }
  const lista = FAMILIAS.filter((f) => tab.has(f) && tab.get(f)!.some((x) => x.cap > 0));
  const fabrica: FamiliaMes[] = PERIODOS.map((_, i) => lista.reduce((acc, f) => {
    const x = tab.get(f)![i];
    return { cap: acc.cap + x.cap, uso: acc.uso + x.uso, ociosoMin: acc.ociosoMin + x.ociosoMin, atrasoMin: acc.atrasoMin + x.atrasoMin, atrasoPc: acc.atrasoPc + x.atrasoPc, adiantPc: acc.adiantPc + x.adiantPc, ociosos: acc.ociosos.concat(x.ociosos) };
  }, { cap: 0, uso: 0, ociosoMin: 0, atrasoMin: 0, atrasoPc: 0, adiantPc: 0, ociosos: [] } as FamiliaMes));
  return { dias, tab, lista, fabrica, base };
}

// LEITURA DA FÁBRICA PELA LISTA, mês a mês (índice = PERIODOS: 0 = MA). É a linha Σ Fábrica
// da faixa por família, para quem precisa do número sem a tabela (o gráfico da Visão Geral).
export type LeituraListaMes = { periodo: string; ocupacao: number | null; empurraPc: number; empurraDias: number; ociosaDias: number };
export function leituraFabricaPelaLista(dados: DistribuicaoDados, familias: FamiliaPorGrupo, familiasOcupacao: FamiliaOcupacao[], minPecaMove: number): LeituraListaMes[] {
  const { cols } = calendario();
  const { blocos } = montarMatriz(dados, familias, minPecaMove, cols);
  const { dias, fabrica } = contaFaixa(dados, familias, blocos, familiasOcupacao);
  return fabrica.map((x, i) => {
    const capDia = dias[i] > 0 ? x.cap / dias[i] : 0;
    return {
      periodo: PERIODOS[i],
      ocupacao: x.cap > 0 ? x.uso / x.cap : null,
      empurraPc: x.atrasoPc,
      empurraDias: capDia > 0 ? x.atrasoMin / capDia : 0,
      ociosaDias: capDia > 0 ? x.ociosoMin / capDia : 0,
    };
  });
}

function FaixaFamilias({ dados, familias, blocos, familiasOcupacao, meses, anoAlvo, colSel }: {
  dados: DistribuicaoDados;
  familias: FamiliaPorGrupo;
  blocos: { familia: string; empurra: number[]; adianta?: number[] }[];
  familiasOcupacao: FamiliaOcupacao[];
  meses: string[];
  anoAlvo: number;
  colSel: number | null;
}) {
  // Só refaz quando o cenário muda — clicar numa célula não recalcula a faixa.
  const { dias, tab, lista, fabrica, base } = useMemo(() => contaFaixa(dados, familias, blocos, familiasOcupacao), [dados, familias, blocos, familiasOcupacao]);
  const capDiaFam = (f: string) => {
    const xs = tab.get(f)!;
    const i = xs.findIndex((x, k) => x.cap > 0 && dias[k] > 0 && k >= 2);
    return i >= 0 ? xs[i].cap / dias[i] : 0;
  };
  const anoDe = (i: number) => Number(`20${meses[i].slice(-2)}`);
  const fmtD = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const cel = (x: FamiliaMes, i: number, forte = false) => {
    const o = x.cap > 0 ? x.uso / x.cap : null;
    const capDia = dias[i] > 0 ? x.cap / dias[i] : 0;
    const dAtraso = capDia > 0 ? x.atrasoMin / capDia : 0;
    const dOcioso = capDia > 0 ? x.ociosoMin / capDia : 0;
    const fundo = x.atrasoPc >= 0.5 && dOcioso >= 0.05 ? 'bg-amber-50' : x.atrasoPc >= 0.5 ? 'bg-red-50' : dOcioso >= 0.05 ? 'bg-emerald-50' : '';
    return (
      <td key={i} className={`min-w-[7.5rem] px-2.5 py-2 text-right tabular-nums ${fundo} ${anoDe(i) < anoAlvo ? 'opacity-50' : ''} ${colSel === i ? HL : ''}`}
        title={[
          `${meses[i]} · ocupação ${pct(o)} = (alocado + extra) ÷ capacidade dos grupos`,
          x.atrasoPc >= 0.5 ? `↪ ${num(x.atrasoPc)} peças empurradas para o mês seguinte (${fmtD(dAtraso)} dias de capacidade da família)` : 'nada empurrado',
          x.adiantPc >= 0.5 ? `+ ${num(x.adiantPc)} peças adiantadas no fim do mês (feitas antes, para os meses seguintes)` : '',
          dOcioso >= 0.05 ? `ociosa ${fmtD(dOcioso)} dias: ${[...x.ociosos].sort((a, b) => b.min - a.min).map((g) => `${curto(g.grupo)} ${num(g.min / 1000)} mil min`).join(', ')}` : 'sem capacidade parada',
          x.atrasoPc >= 0.5 && dOcioso >= 0.05 ? 'Atraso e ociosidade ao mesmo tempo: os grupos parados não estão na lista das referências que atrasam.' : '',
        ].filter(Boolean).join('\n')}>
        <div className={`text-base leading-tight ${forte ? 'font-extrabold' : 'font-bold'} ${o !== null && o > 1.005 ? 'text-red-800' : 'text-gray-800'}`}>{o !== null && o > 1.005 ? '▲' : ''}{pct(o)}</div>
        <div className={`mt-1 text-[13px] leading-tight ${x.atrasoPc >= 0.5 ? 'font-semibold text-red-700' : 'text-gray-300'}`}>{x.atrasoPc >= 0.5 ? `↪ ${num(x.atrasoPc)}` : '·'}</div>
        {x.atrasoPc >= 0.5 && <div className="text-xs leading-tight text-red-600">{fmtD(dAtraso)} dias</div>}
        {x.adiantPc >= 0.5 && <div className="mt-1 text-xs font-semibold leading-tight text-violet-700">+ {num(x.adiantPc)} adiant.</div>}
        <div className={`mt-1 text-xs leading-tight ${dOcioso >= 0.05 ? 'font-semibold text-emerald-700' : 'text-gray-300'}`}>{dOcioso >= 0.05 ? `ociosa ${fmtD(dOcioso)} d` : ''}</div>
      </td>
    );
  };
  return (
    <div className="mt-3">
      <div className="mb-2 text-xs text-gray-600">
        <strong>Ocupação por família, pela lista — mês a mês.</strong> Em cima, a ocupação dos grupos da família; no meio, <span className="text-red-700">↪ o que as referências
        dela empurram</span> (peças e dias); embaixo, <span className="text-emerald-700">a capacidade que ficou parada</span> nos grupos dela, em dias. Os dois podem aparecer
        juntos (fundo amarelo): um grupo parado não faz referência que a lista não manda para ele — passe o mouse para ver quais grupos ficaram parados.
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead className="text-gray-500">
            <tr>
              <th className="sticky left-0 z-10 bg-white px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide">Família</th>
              {PERIODOS.map((_, i) => <th key={i} className={`px-2.5 py-1.5 text-right text-sm font-semibold whitespace-nowrap ${anoDe(i) < anoAlvo ? 'text-gray-400' : 'text-gray-600'}`}>{meses[i]}</th>)}
            </tr>
          </thead>
          <tbody>
            {lista.map((f) => {
              const nGrupos = new Set(dados.grupos.filter((g) => base(g.grupo) === f || (g as { viraFamilia?: string | null }).viraFamilia === f).map((g) => g.grupo)).size;
              return (
                <tr key={f} className="[&>td]:border-t [&>td]:border-white">
                  <td className={`sticky left-0 z-10 whitespace-nowrap border-l-4 px-3 py-2 ${(COR_FAMILIA[f] || COR_FAMILIA.Outros).borda} ${(COR_FAMILIA[f] || COR_FAMILIA.Outros).faixa}`}>
                    <div className="text-base font-bold">{f}</div>
                    <div className="text-xs text-gray-500">{nGrupos} grupo{nGrupos === 1 ? '' : 's'} · {num(capDiaFam(f))} min/dia</div>
                  </td>
                  {tab.get(f)!.map((x, i) => cel(x, i))}
                </tr>
              );
            })}
            <tr className="[&>td]:border-t-2 [&>td]:border-gray-400">
              <td className="sticky left-0 z-10 bg-slate-100 px-3 py-2 text-base font-extrabold uppercase tracking-wide">Σ Fábrica</td>
              {fabrica.map((x, i) => cel(x, i, true))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
