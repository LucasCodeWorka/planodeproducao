'use client';

// PRODUÇÃO DO PLANO COM O RELACIONAMENTO DE HOJE — a matriz da Distribuição sugerida.
//
// Mesma conta da tela /distribuicao-sugerida (grupo A pelo histórico, B/C/D quando o A
// enche, capacidade medida de cada grupo, o que não cabe passa para o mês seguinte), lida
// em PEÇAS por grupo e mês. Nada é recalculado aqui — é a mesma resposta da outra tela.
//
// Cada mês tem TRÊS colunas por linha (família, grupo, referência ou fábrica), sobre as
// referências que são do grupo (1ª opção) — versão simples pedida pelo PCP em 18/11/2026:
//   veio do mês ant. = o que chegou atrasado (demanda reprimida)
//   produzido        = o que dá para produzir no mês, do que veio e do plano do mês
//                      (feito pelo próprio grupo ou por um alternativo)
//   empurra          = o que vai para o mês seguinte
// Conta da linha: veio + plano do mês − produzido = empurra. O plano do mês fica na dica.

import { Fragment, useMemo, useState } from 'react';

type Destino = { grupo: string; minutos: number };
type PeriodoRef = {
  periodo: string;
  pecas: number;
  pedidoMin: number;
  herdadoMin?: number;
  alocadoMin: number;
  pendenteMin: number;
  pendentePecas: number;
  destinos: Destino[];
};
type RefDist = { referencia: string; tempoMin: number; mix: string; periodos: PeriodoRef[] };
type RefPreferencial = { referencia: string; pedidoMin: number; herdadoMin: number; remanejadoMin: number; pendenteMin: number };
type MesGrupo = {
  periodo: string;
  capacidadeMin: number;
  alocadoMin: number;
  extraMin?: number;
  /** Carga extra DIRECIONADA ao grupo (Liebe Move na LIDERANÇA), em minutos. */
  extraDirecionado?: { doMesMin: number; herdadoMin: number; coubeMin: number; pendenteMin: number } | null;
  /** As referências que têm este grupo como 1ª opção, com o que foi pedido, herdado,
   *  mandado a alternativos e deixado pendente no mês. */
  referenciasPreferenciais?: RefPreferencial[];
};
type GrupoDist = { grupo: string; capacidadeDiaria: number; meses: MesGrupo[] };

export type DistribuicaoDados = {
  loteId: string | null;
  comFerias: boolean;
  capacidadeDiariaTotal: number;
  referencias: RefDist[];
  grupos: GrupoDist[];
  resumo: { atrasadoMin: number; naoCoubeMin: number; cargaExtraMin: number; periodosEstourados: number };
};

export type FamiliaPorGrupo = Record<string, { familia: string; perfil: string | null }>;

const PERIODOS = ['MA', 'PX', 'UL', 'QT', 'QU', 'SX', 'ST', 'OT', 'NV', 'DZ', 'ON', 'DO', 'DT', 'QZ'];
const MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const num = (v: number) => Math.round(v || 0).toLocaleString('pt-BR');
const FAMILIAS = ['Sutiã', 'Calcinha', 'Anatomic', 'Noite', 'Outros'];
const COR_FAMILIA: Record<string, string> = {
  'Sutiã': 'bg-rose-50 text-rose-800',
  Calcinha: 'bg-sky-50 text-sky-800',
  Anatomic: 'bg-teal-50 text-teal-800',
  Noite: 'bg-violet-50 text-violet-800',
  Outros: 'bg-gray-50 text-gray-700',
};

// O período MA é o mês corrente; os seguintes andam um mês cada (mesma regra do backend).
function rotulos() {
  const hoje = new Date();
  return PERIODOS.map((_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
    return `${MESES_PT[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
  });
}

function corOcupacao(o: number | null) {
  if (o === null) return 'text-gray-300';
  if (o > 1.005) return 'text-red-700 font-semibold';
  if (o >= 0.9) return 'text-amber-700';
  return 'text-gray-400';
}

type Coringa = { grupo: string; modelo: string };
const curto = (g: string) => (g.includes(' - ') ? g.split(' - ')[1] : g);
const zeros = (n: number) => Array(n).fill(0) as number[];

type Quadra = { veio: number[]; plano: number[]; empurra: number[] };
const quadraVazia = (n: number): Quadra => ({ veio: zeros(n), plano: zeros(n), empurra: zeros(n) });

// Produção de um mês com a reprimida em primeiro lugar, sobre os totais da linha.
function producao(t: Quadra, i: number) {
  const feito = Math.max(0, t.veio[i] + t.plano[i] - t.empurra[i]);
  const reprimida = Math.min(t.veio[i], feito);
  const plano = Math.max(0, feito - reprimida);
  return { feito, reprimida, plano, pctPlano: t.plano[i] > 0.5 ? plano / t.plano[i] : null };
}

const somar = (q: Quadra, i: number, veio: number, plano: number, empurra: number) => {
  q.veio[i] += veio;
  q.plano[i] += plano;
  q.empurra[i] += empurra;
};

export default function ProducaoDistribuida({ dados, familias, cenario, planoTela, minPecaMove, coringa, onCoringa, recalculando }: {
  dados: DistribuicaoDados;
  familias: FamiliaPorGrupo;
  cenario: string;
  planoTela: Record<string, number> | null;
  minPecaMove: number;
  coringa: Coringa | null;
  onCoringa: (ligado: boolean) => void;
  recalculando: boolean;
}) {
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const meses = rotulos();
  const n = PERIODOS.length;
  // Só jan–dez do ano que vem (pedido do PCP). Nov–dez do ano corrente continuam na conta
  // — o atraso deles entra em janeiro —, só não viram coluna.
  const anoAlvo = new Date().getFullYear() + 1;
  const chaves = PERIODOS.map((_, i) => {
    const d = new Date(new Date().getFullYear(), new Date().getMonth() + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const cols = chaves.map((c, i) => (c.startsWith(String(anoAlvo)) ? i : -1)).filter((i) => i >= 0);

  const { linhas, planoSku, pendente, semGrupo, fabrica } = useMemo(() => {
    const tempoRef = new Map(dados.referencias.map((r) => [r.referencia, Number(r.tempoMin || 0)]));
    const pc = (min: number, ref: string) => {
      const t = tempoRef.get(ref) || 0;
      return t > 0 ? Number(min || 0) / t : 0;
    };

    // Fábrica, pelas referências: plano por SKU, o que coube e o que ficou pendente.
    const planoSku = zeros(n);
    const alocado = zeros(n);
    const pendente = zeros(n);
    const fabrica = quadraVazia(n);
    const costurado = new Map<string, number[]>(); // peças que de fato passaram por cada grupo
    for (const r of dados.referencias) {
      const t = Number(r.tempoMin || 0);
      for (const p of r.periodos || []) {
        const i = PERIODOS.indexOf(p.periodo);
        if (i < 0) continue;
        planoSku[i] += Number(p.pecas || 0);
        pendente[i] += Number(p.pendentePecas || 0);
        if (t > 0) somar(fabrica, i, Number(p.herdadoMin || 0) / t, Number(p.pedidoMin || 0) / t, Number(p.pendenteMin || 0) / t);
        for (const d of p.destinos || []) {
          const v = t > 0 ? Number(d.minutos || 0) / t : 0;
          alocado[i] += v;
          if (!costurado.has(d.grupo)) costurado.set(d.grupo, zeros(n));
          costurado.get(d.grupo)![i] += v;
        }
      }
    }

    // Grupo, pelas referências que são DELE.
    const linhas = dados.grupos.map((g) => {
      const t = quadraVazia(n);
      const porRef = new Map<string, Quadra>();
      const ocupacao: (number | null)[] = Array(n).fill(null);
      for (const m of g.meses || []) {
        const i = PERIODOS.indexOf(m.periodo);
        if (i < 0) continue;
        ocupacao[i] = m.capacidadeMin > 0 ? (Number(m.alocadoMin || 0) + Number(m.extraMin || 0)) / m.capacidadeMin : null;
        for (const r of m.referenciasPreferenciais || []) {
          const veio = pc(r.herdadoMin, r.referencia);
          const plano = pc(r.pedidoMin, r.referencia);
          const emp = pc(r.pendenteMin, r.referencia);
          somar(t, i, veio, plano, emp);
          if (!porRef.has(r.referencia)) porRef.set(r.referencia, quadraVazia(n));
          somar(porRef.get(r.referencia)!, i, veio, plano, emp);
        }
        // LIEBE MOVE: não tem SKU, mas tem dono (o grupo do anatomic). Entra como uma linha
        // própria do grupo, em peças pelo min/peça dela, para aparecer na conta dele.
        const dir = m.extraDirecionado;
        if (dir && minPecaMove > 0 && (dir.doMesMin > 0 || dir.herdadoMin > 0)) {
          const veio = dir.herdadoMin / minPecaMove;
          const plano = dir.doMesMin / minPecaMove;
          const emp = dir.pendenteMin / minPecaMove;
          somar(t, i, veio, plano, emp);
          const k = 'LIEBE MOVE (sem SKU · mix anatomic)';
          if (!porRef.has(k)) porRef.set(k, quadraVazia(n));
          somar(porRef.get(k)!, i, veio, plano, emp);
        }
      }
      return {
        grupo: g.grupo,
        familia: familias[g.grupo]?.familia || 'Outros',
        ...t,
        costurado: costurado.get(g.grupo) || zeros(n),
        ocupacao,
        refs: Array.from(porRef.entries()).map(([referencia, x]) => ({ referencia, ...x })),
      };
    });
    // Referências sem grupo candidato ficam pendentes sem passar por grupo nenhum.
    const empGrupos = Array.from({ length: n }, (_, i) => linhas.reduce((s, l) => s + l.empurra[i], 0));
    const semGrupo = pendente.map((v, i) => Math.max(0, v - empGrupos[i]));
    return { linhas, planoSku, pendente, semGrupo, fabrica };
  }, [dados, familias, n, minPecaMove]);

  const somaCols = (a: number[]) => cols.reduce((x, i) => x + (a[i] || 0), 0);
  const ultimaCol = cols.length ? cols[cols.length - 1] : -1;
  const herdadoJan = cols.length && cols[0] > 0 ? pendente[cols[0] - 1] : 0;
  const vaiParaProximo = ultimaCol >= 0 ? pendente[ultimaCol] : 0;
  const rotuloProximo = `jan/${String(anoAlvo + 1).slice(2)}`;
  const planoVg = planoTela ? cols.map((i) => planoTela[chaves[i]] ?? null) : null;

  const linhasOrdenadas = [...linhas].sort((a, b) => somaCols(b.plano) - somaCols(a.plano));
  const blocos = FAMILIAS.map((familia) => {
    const gs = linhasOrdenadas.filter((l) => l.familia === familia && somaCols(l.plano) + somaCols(l.costurado) >= 0.5);
    const soma = (k: keyof Quadra) => Array.from({ length: n }, (_, i) => gs.reduce((s, g) => s + g[k][i], 0));
    return { familia, grupos: gs, veio: soma('veio'), plano: soma('plano'), empurra: soma('empurra') };
  }).filter((b) => b.grupos.length > 0);

  // As três colunas de um mês: veio, produzido, empurra.
  const quatro = (t: Quadra, i: number, opts: { forte?: boolean; ocup?: number | null; costurado?: number } = {}) => {
    const pr = producao(t, i);
    return (
      <Fragment key={i}>
        <td className={`border-l border-gray-100 px-2 py-1.5 text-right tabular-nums ${t.veio[i] >= 0.5 ? 'text-orange-700' : 'text-gray-300'} ${opts.forte ? 'font-bold' : ''}`}>
          {t.veio[i] >= 0.5 ? num(t.veio[i]) : '·'}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-emerald-800"
          title={[
            `Plano do mês: ${num(t.plano[i])} peças`,
            `veio ${num(t.veio[i])} + plano ${num(t.plano[i])} − produzido ${num(pr.feito)} = empurra ${num(t.empurra[i])}`,
            opts.ocup !== undefined && opts.ocup !== null ? `ocupação do grupo: ${Math.round(opts.ocup * 100)}%` : '',
          ].filter(Boolean).join(' · ')}>
          <div className={opts.forte ? 'font-bold' : 'font-medium'}>{pr.feito >= 0.5 ? num(pr.feito) : '·'}</div>
          {opts.ocup !== undefined && opts.ocup !== null && <div className={`text-[10px] ${corOcupacao(opts.ocup)}`}>{Math.round(opts.ocup * 100)}%</div>}
        </td>
        <td className={`border-r border-gray-200 px-2 py-1.5 text-right tabular-nums ${t.empurra[i] >= 0.5 ? `bg-red-50/60 text-red-700 ${opts.forte ? 'font-bold' : 'font-semibold'}` : 'text-gray-300'}`}>
          {t.empurra[i] >= 0.5 ? num(t.empurra[i]) : '·'}
        </td>
      </Fragment>
    );
  };
  const totais = (t: Quadra) => (
    <>
      <td className="px-2 py-1.5 text-right tabular-nums">{num(somaCols(t.plano))}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-emerald-800">{num(cols.reduce((x, i) => x + producao(t, i).feito, 0))}</td>
    </>
  );
  const CINZA_E = <td className="border-r border-gray-200 bg-gray-100" />;
  const CINZA_D = <td className="border-l border-gray-200 bg-gray-100" />;

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="font-semibold text-gray-900">Produção do plano {anoAlvo} com o relacionamento de hoje · Distribuição sugerida em peças</h2>
        <p className="mt-1 text-xs text-gray-500">
          A mesma conta da tela Distribuição sugerida ({cenario}): cada referência vai para o grupo A pelo histórico e passa para B, C e D quando o A enche;
          o que não cabe vai para o mês seguinte. Para cada grupo, sobre as referências que são <strong>dele</strong>, três colunas por mês:
          <span className="font-semibold text-orange-700"> veio do mês anterior</span>, <span className="font-semibold text-emerald-800">produzido</span> (o que dá para fazer
          no mês, por ele ou por um alternativo; embaixo, a ocupação do grupo) e <span className="font-semibold text-red-700">empurra</span> (vai para o mês seguinte).
          Conta: veio + plano do mês − produzido = empurra — passe o mouse no produzido para ver o plano do mês. Clique num grupo para ver as referências.
        </p>
        <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-900">
          <input type="checkbox" checked={coringa !== null} onChange={(e) => onCoringa(e.target.checked)} disabled={recalculando} />
          <span>
            <strong>Simular ESPERANÇA como coringa</strong>: copia o perfil da POSITIVO (sutiã básico) sem largar as calcinhas dela — entra logo depois da POSITIVO
            em toda referência que a POSITIVO faz. Só simulação, nada é gravado.
          </span>
          {recalculando && <span className="ml-1 text-sky-700">recalculando…</span>}
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th rowSpan={2} className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left align-bottom">Grupo de costura / referência</th>
              <th rowSpan={2} className="border-r border-gray-200 bg-gray-100 px-2 py-2 text-right align-bottom whitespace-nowrap" title="Atraso que entra em janeiro vindo de nov–dez do ano corrente">
                Vem de<div className="text-[10px] font-normal">nov–dez/{String(anoAlvo - 1).slice(2)}</div>
              </th>
              {cols.map((i) => <th key={i} colSpan={3} className="border-r border-gray-200 px-2 pt-2 text-center whitespace-nowrap">{meses[i]}</th>)}
              <th rowSpan={2} className="border-l border-gray-200 bg-gray-100 px-2 py-2 text-right align-bottom whitespace-nowrap" title="O que não coube em dezembro e vai para o ano seguinte">
                Vai para<div className="text-[10px] font-normal">{rotuloProximo}</div>
              </th>
              <th colSpan={2} className="px-2 pt-2 text-center">No ano</th>
            </tr>
            <tr>
              {cols.map((i) => (
                <Fragment key={i}>
                  <th className="border-l border-gray-100 px-2 pb-2 text-right text-[10px] font-semibold leading-tight text-orange-700" title="Demanda reprimida: o que chegou atrasado do mês anterior">veio do<br />mês ant.</th>
                  <th className="px-2 pb-2 text-right text-[10px] font-semibold text-emerald-800" title="O que dá para produzir no mês, do que veio e do plano do mês">produzido</th>
                  <th className="border-r border-gray-200 px-2 pb-2 text-right text-[10px] font-semibold text-red-700">empurra</th>
                </Fragment>
              ))}
              <th className="px-2 pb-2 text-right text-[10px] font-normal">plano</th>
              <th className="px-2 pb-2 text-right text-[10px] font-semibold text-emerald-800">produzido</th>
            </tr>
          </thead>
          <tbody>
            {blocos.map((b) => (
              <Fragment key={b.familia}>
                <tr className={`border-t-2 border-gray-300 font-bold ${COR_FAMILIA[b.familia]}`}>
                  <td className={`sticky left-0 z-10 px-3 py-1.5 ${COR_FAMILIA[b.familia]}`}>
                    {b.familia} <span className="ml-1 text-[10px] font-normal">{b.grupos.length} grupo{b.grupos.length === 1 ? '' : 's'}</span>
                  </td>
                  {CINZA_E}
                  {cols.map((i) => quatro(b, i, { forte: true }))}
                  {CINZA_D}
                  {totais(b)}
                </tr>
                {b.grupos.map((g) => {
                  const aberto = abertos[g.grupo] === true;
                  const refs = g.refs
                    .filter((r) => somaCols(r.plano) >= 0.5)
                    .sort((a, b2) => (somaCols(b2.empurra) - somaCols(a.empurra)) || (somaCols(b2.plano) - somaCols(a.plano)));
                  return (
                    <Fragment key={g.grupo}>
                      <tr className="cursor-pointer border-t border-gray-100 hover:bg-gray-50" onClick={() => setAbertos((a) => ({ ...a, [g.grupo]: !aberto }))}>
                        <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-semibold whitespace-nowrap">
                          <span className="mr-1 inline-block w-3 text-gray-400">{aberto ? '▾' : '▸'}</span>
                          {g.grupo}
                          {coringa && g.grupo === coringa.grupo && (
                            <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800" title={`Coringa: copia o perfil da ${curto(coringa.modelo)}`}>
                              coringa · {curto(coringa.modelo).toLowerCase()}
                            </span>
                          )}
                          <span className="ml-2 text-[10px] font-normal text-gray-400">{refs.length} ref.</span>
                        </td>
                        {CINZA_E}
                        {cols.map((i) => quatro(g, i, { ocup: g.ocupacao[i], costurado: g.costurado[i] }))}
                        {CINZA_D}
                        {totais(g)}
                      </tr>
                      {aberto && refs.map((r) => (
                        <tr key={`${g.grupo}|${r.referencia}`} className="border-t border-gray-50 bg-gray-50/60 text-gray-600">
                          <td className="sticky left-0 z-10 bg-gray-50 py-1 pl-9 pr-3 font-mono text-gray-800">{r.referencia}</td>
                          {CINZA_E}
                          {cols.map((i) => quatro(r, i))}
                          {CINZA_D}
                          {totais(r)}
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            {planoVg && (
              <tr className="border-t-2 border-gray-300 bg-amber-50 font-bold text-amber-900">
                <td className="sticky left-0 z-10 bg-amber-50 px-3 py-2" title="O plano que o gráfico da Visão Geral desenha: lote + edição limitada + Liebe Move">Plano da Visão Geral</td>
                {CINZA_E}
                {planoVg.map((v, k) => <td key={k} colSpan={3} className="border-r border-gray-200 px-2 py-2 text-right tabular-nums">{v === null ? '—' : num(v)}</td>)}
                {CINZA_D}
                <td className="px-2 py-2 text-right tabular-nums">{num(planoVg.reduce((x: number, v) => x + (v || 0), 0))}</td>
                <td />
              </tr>
            )}
            <tr className={`${planoVg ? '' : 'border-t-2 border-gray-300 '}bg-gray-50 text-gray-600`}>
              <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2"
                title="Peças por SKU que a distribuição reparte: plano do lote mais o em processo. Edição limitada, Move e previsto entram como carga extra em minutos, ocupando os grupos, mas sem peça.">
                Plano por SKU que a distribuição reparte
              </td>
              {CINZA_E}
              {cols.map((i) => <td key={i} colSpan={3} className="border-r border-gray-200 px-2 py-2 text-right tabular-nums">{num(planoSku[i])}</td>)}
              {CINZA_D}
              <td className="px-2 py-2 text-right tabular-nums">{num(somaCols(planoSku))}</td>
              <td />
            </tr>
            <tr className="border-t border-gray-300 bg-gray-50 font-semibold">
              <td className="sticky left-0 z-10 bg-gray-50 px-3 py-1" title="Fábrica inteira, pelas referências: plano do mês, produzido do plano, produzido da reprimida e empurrado">Fábrica</td>
              <td className="border-r border-gray-200 bg-gray-100 px-2 py-1 text-right tabular-nums text-red-700"
                title={`Janeiro já começa com ${num(herdadoJan)} peças atrasadas de nov–dez/${String(anoAlvo - 1).slice(2)}.`}>
                {herdadoJan >= 0.5 ? num(herdadoJan) : '·'}
              </td>
              {cols.map((i) => quatro(fabrica, i, { forte: true }))}
              <td className="border-l border-gray-200 bg-gray-100 px-2 py-1 text-right tabular-nums font-bold text-red-700"
                title={`Saem do ano ${num(vaiParaProximo)} peças que não couberam e vão para ${rotuloProximo}.`}>
                {vaiParaProximo >= 0.5 ? num(vaiParaProximo) : '·'}
              </td>
              {totais(fabrica)}
            </tr>
            {cols.some((i) => semGrupo[i] >= 0.5) && (
              <tr className="bg-gray-50 text-gray-500">
                <td className="sticky left-0 z-10 bg-gray-50 px-3 py-1" title="Referências sem nenhum grupo candidato: ficam pendentes sem passar por grupo. Somadas aos empurrados dos grupos, fecham o empurrado da fábrica.">
                  ↳ dos empurrados, sem grupo candidato
                </td>
                {CINZA_E}
                {cols.map((i) => (
                  <Fragment key={i}>
                    <td />
                    <td />
                    <td className="border-r border-gray-200 px-2 py-1 text-right tabular-nums">{semGrupo[i] >= 0.5 ? num(semGrupo[i]) : '·'}</td>
                  </Fragment>
                ))}
                {CINZA_D}
                <td />
                <td />
              </tr>
            )}
          </tfoot>
        </table>
      </div>
      <div className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-500">
        Produzido = feito pelo próprio grupo ou por um alternativo. Passe o mouse no produzido do plano para ver o que de fato foi costurado no grupo (inclui referências de
        outros grupos que ele absorveu). A parte do plano sem SKU — edição limitada projetada, Move e previsto — entra como carga extra em minutos, ocupando os
        grupos; por isso a ocupação pode passar de 100% sem peça correspondente.
      </div>
    </section>
  );
}
