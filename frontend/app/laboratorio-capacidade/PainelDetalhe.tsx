'use client';

// PAINEL DE INVESTIGAÇÃO da matriz do plano (19/11/2026). Só lê o que a distribuição já
// devolve — nenhum número novo:
//   referência → grupos A–D, mês a mês (plano, veio, produzido, empurra, quem fez) e o
//                rastro da simulação no mês (`tentativas`: cada grupo tentado, na ordem,
//                quanto tinha livre e quanto coube);
//   grupo      → capacidade e ocupação, o que ELE costurou × o produzido das referências
//                DELE (feito por ele ou por alternativos), e as listas das duas coisas.

import { useMemo } from 'react';
import { PERIODOS, ROTULO_MOVE, type DistribuicaoDados, type Matriz, type Linha } from './matriz';

export type Selecao =
  | { tipo: 'ref'; ref: string; col: number | null }
  | { tipo: 'grupo'; grupo: string; col: number | null };

const num = (v: number) => Math.round(v || 0).toLocaleString('pt-BR');
const curto = (g: string) => (g.includes(' - ') ? g.split(' - ')[1] : g);
const ORIGEM: Record<string, string> = { historico: 'histórico', mix: 'mix', coringa: 'coringa', apontado: 'apontado', pcp: 'PCP' };

export default function PainelDetalhe({ sel, dados, matriz, meses, cols, rotuloProximo, onFechar, onSel }: {
  sel: Selecao;
  dados: DistribuicaoDados;
  matriz: Matriz;
  meses: string[];
  cols: number[];
  rotuloProximo: string;
  onFechar: () => void;
  onSel: (s: Selecao) => void;
}) {
  return (
    <aside className="fixed right-0 top-0 z-50 flex h-full w-[min(500px,100vw)] flex-col border-l border-gray-300 bg-white shadow-2xl" role="dialog" aria-label="Detalhes">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{sel.tipo === 'ref' ? 'Referência' : 'Grupo de costura'}</span>
        <button type="button" onClick={onFechar} className="rounded px-2 py-0.5 text-lg leading-none text-gray-500 hover:bg-gray-200" aria-label="Fechar">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 text-xs">
        {sel.tipo === 'ref'
          ? <DetalheRef sel={sel} dados={dados} meses={meses} cols={cols} rotuloProximo={rotuloProximo} onSel={onSel} />
          : <DetalheGrupo sel={sel} dados={dados} matriz={matriz} meses={meses} cols={cols} onSel={onSel} />}
      </div>
    </aside>
  );
}

function DetalheRef({ sel, dados, meses, cols, rotuloProximo, onSel }: {
  sel: Extract<Selecao, { tipo: 'ref' }>;
  dados: DistribuicaoDados;
  meses: string[];
  cols: number[];
  rotuloProximo: string;
  onSel: (s: Selecao) => void;
}) {
  const r = useMemo(() => dados.referencias.find((x) => x.referencia === sel.ref) || null, [dados, sel.ref]);
  if (sel.ref === ROTULO_MOVE) {
    return (
      <div className="space-y-2 text-gray-700">
        <h3 className="text-base font-bold text-gray-900">Liebe Move</h3>
        <p>A Move não tem SKU no plano: entra como carga em minutos direcionada à LIDERANÇA (mix anatomic do ERP) e aparece em peças pelo min/peça medido dela.
          O que não cabe no mês passa para o mês seguinte do grupo, como qualquer atraso.</p>
      </div>
    );
  }
  if (!r) return <p className="text-gray-500">Referência {sel.ref} não está na distribuição.</p>;
  const t = Number(r.tempoMin || 0);
  const porPer = new Map((r.periodos || []).map((p) => [p.periodo, p]));
  const linhas = cols.map((i) => {
    const p = porPer.get(PERIODOS[i]);
    const veio = t > 0 ? Number(p?.herdadoMin || 0) / t : 0;
    const plano = t > 0 ? Number(p?.pedidoMin || 0) / t : 0;
    const emp = t > 0 ? Number(p?.pendenteMin || 0) / t : 0;
    return { i, p, veio, plano, emp, feito: Math.max(0, veio + plano - emp) };
  });
  // Mês do rastro: o clicado; senão o primeiro que empurra; senão o primeiro do ano.
  const colRastro = sel.col ?? linhas.find((l) => l.emp >= 0.5)?.i ?? cols[0];
  const pr = porPer.get(PERIODOS[colRastro]);
  const tot = linhas.reduce((s, l) => ({ plano: s.plano + l.plano, feito: s.feito + l.feito }), { plano: 0, feito: 0 });
  const ultima = linhas[linhas.length - 1];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-mono text-lg font-bold text-gray-900">{r.referencia}</h3>
        <div className="text-gray-500">{r.mix}</div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-gray-700">
          <span>Tempo <strong>{t.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} min/pç</strong>
            {r.tempoFonte && r.tempoFonte !== 'roteiro' ? <span className="text-amber-700"> ({r.tempoFonte}; roteiro {Number(r.tempoRoteiroMin || 0).toLocaleString('pt-BR')})</span> : <span className="text-gray-400"> (roteiro)</span>}
          </span>
          <span>Plano no ano <strong>{num(tot.plano)}</strong></span>
          <span>Produzido <strong>{num(tot.feito)}</strong></span>
          {ultima && ultima.emp >= 0.5 && <span className="font-semibold text-red-700">⚑ {num(ultima.emp)} vão p/ {rotuloProximo}</span>}
        </div>
      </div>

      <section>
        <h4 className="mb-1 font-semibold text-gray-800">Ordem dos grupos (a lista)</h4>
        {r.opcoes?.length ? (
          <ol className="space-y-0.5">
            {r.opcoes.map((o) => (
              <li key={o.grupo} className="flex items-baseline gap-2">
                <span className="w-4 font-bold text-gray-500">{o.ordem}</span>
                <button type="button" className="text-left font-medium text-indigo-700 hover:underline" onClick={() => onSel({ tipo: 'grupo', grupo: o.grupo, col: sel.col })}>{curto(o.grupo)}</button>
                <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-600">{ORIGEM[o.origem] || o.origem}</span>
                {o.pecasHistorico ? <span className="text-gray-400">{num(o.pecasHistorico)} pç no histórico</span> : null}
              </li>
            ))}
          </ol>
        ) : <p className="text-red-700">∅ Sem grupo candidato: todo o plano dela fica pendente.</p>}
      </section>

      <section>
        <h4 className="mb-1 font-semibold text-gray-800">Mês a mês <span className="font-normal text-gray-400">· clique num mês para ver o rastro</span></h4>
        <table className="w-full tabular-nums">
          <thead className="text-[10px] text-gray-500">
            <tr>
              <th className="py-1 text-left font-normal">mês</th>
              <th className="text-right font-normal">plano</th>
              <th className="text-right font-normal text-orange-700">veio</th>
              <th className="text-right font-normal text-emerald-800">produzido</th>
              <th className="text-right font-normal text-red-700">empurra</th>
              <th className="pl-2 text-left font-normal">feito por</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.i} onClick={() => onSel({ tipo: 'ref', ref: r.referencia, col: l.i })}
                className={`cursor-pointer border-t border-gray-100 hover:bg-indigo-50 ${l.i === colRastro ? 'bg-indigo-50 font-semibold' : ''}`}>
                <td className="py-1">{meses[l.i]}</td>
                <td className="text-right">{l.plano >= 0.5 ? num(l.plano) : '·'}</td>
                <td className="text-right text-orange-700">{l.veio >= 0.5 ? num(l.veio) : '·'}</td>
                <td className="text-right text-emerald-800">{l.feito >= 0.5 ? num(l.feito) : '·'}</td>
                <td className="text-right text-red-700">{l.emp >= 0.5 ? `↪ ${num(l.emp)}` : '·'}</td>
                <td className="pl-2 text-[10px] text-gray-600">
                  {(l.p?.destinos || []).filter((d) => d.minutos > 0.5).map((d) => `${curto(d.grupo)} ${num(t > 0 ? d.minutos / t : 0)}`).join(' · ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded border border-indigo-200 bg-indigo-50/50 p-2">
        <h4 className="mb-1 font-semibold text-indigo-900">Como a simulação chegou nisso · {meses[colRastro]}</h4>
        {pr ? (
          <>
            <p className="mb-1.5 text-gray-600">
              Pedido do mês {num(t > 0 ? pr.pedidoMin / t : 0)} + veio {num(t > 0 ? Number(pr.herdadoMin || 0) / t : 0)} = <strong>{num(t > 0 ? (pr.pedidoMin + Number(pr.herdadoMin || 0)) / t : 0)} pç</strong> na fila.
              Os grupos são tentados na ordem; cada um dá o que tem livre naquele ponto do mês.
            </p>
            {pr.tentativas?.length ? (
              <ol className="space-y-0.5">
                {pr.tentativas.map((x, k) => (
                  <li key={`${x.grupo}-${k}`} className="grid grid-cols-[1.2rem_1fr_auto_auto] items-baseline gap-2 tabular-nums">
                    <span className="text-gray-400">{k + 1}.</span>
                    <span>
                      <button type="button" className="font-medium text-indigo-700 hover:underline" onClick={() => onSel({ tipo: 'grupo', grupo: x.grupo, col: colRastro })}>{curto(x.grupo)}</button>
                      <span className="ml-1 text-[10px] text-gray-500">{ORIGEM[x.origem] || x.origem}</span>
                    </span>
                    <span className="text-right text-gray-500" title="Minutos livres no grupo quando chegou a vez desta referência">livre {num(x.disponivelMin)} min</span>
                    <span className={`w-20 text-right ${x.alocadoPecas >= 0.5 ? 'font-semibold text-emerald-800' : 'text-gray-400'}`}>→ {num(x.alocadoPecas)} pç</span>
                  </li>
                ))}
              </ol>
            ) : <p className="text-gray-500">Nada para alocar neste mês.</p>}
            <p className={`mt-1.5 font-semibold ${pr.pendentePecas >= 0.5 ? 'text-red-700' : 'text-emerald-800'}`}>
              {pr.pendentePecas >= 0.5 ? `↪ Não coube ${num(pr.pendentePecas)} pç → vai para o mês seguinte` : '✓ Tudo coube no mês'}
            </p>
          </>
        ) : <p className="text-gray-500">Sem dados neste mês.</p>}
      </section>
    </div>
  );
}

function DetalheGrupo({ sel, dados, matriz, meses, cols, onSel }: {
  sel: Extract<Selecao, { tipo: 'grupo' }>;
  dados: DistribuicaoDados;
  matriz: Matriz;
  meses: string[];
  cols: number[];
  onSel: (s: Selecao) => void;
}) {
  const g = dados.grupos.find((x) => x.grupo === sel.grupo) || null;
  // Linha das referências DELE (normal ou "largou") e linha do que ele costura (normal ou convertido).
  const doGrupo = matriz.linhas.filter((l) => l.grupo === sel.grupo);
  const comRefs: Linha | undefined = doGrupo.find((l) => l.papel !== 'convertido');
  const costura: Linha | undefined = doGrupo.find((l) => l.papel !== 'largou');
  const grupoA = useMemo(() => new Map(dados.referencias.map((r) => [r.referencia, r.opcoes?.[0]?.grupo || null])), [dados]);
  if (!g) return <p className="text-gray-500">Grupo {sel.grupo} não está na distribuição.</p>;
  const porPer = new Map(g.meses.map((m) => [m.periodo, m]));
  const soma = (a: number[] | undefined) => cols.reduce((s, i) => s + (a?.[i] || 0), 0);
  const proprias = (comRefs?.refs || []).filter((r) => soma(r.plano) >= 0.5).sort((a, b) => soma(b.empurra) - soma(a.empurra) || soma(b.plano) - soma(a.plano));
  const deOutros = Array.from((matriz.costuradoPorRef.get(sel.grupo) || new Map<string, number[]>()).entries())
    .map(([referencia, pecas]) => ({ referencia, pecas: soma(pecas), A: grupoA.get(referencia) }))
    .filter((x) => x.pecas >= 0.5 && x.A !== sel.grupo)
    .sort((a, b) => b.pecas - a.pecas);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-gray-900">{g.grupo}</h3>
        <div className="mt-1 flex flex-wrap gap-x-4 text-gray-700">
          <span>Capacidade medida <strong>{num(g.capacidadeDiaria)} min/dia</strong></span>
          {(comRefs || costura) && <span>Família <strong>{(comRefs || costura)!.familia}</strong></span>}
          {/* "convertido" só quando houve conversão de fato (existe a linha das refs que largou). */}
          {comRefs?.papel === 'largou' && costura?.papel === 'convertido' && <span className="text-sky-700">convertido para {costura.familia}</span>}
        </div>
        <p className="mt-1.5 rounded bg-gray-50 p-1.5 text-[11px] text-gray-600">
          <strong>Costurou</strong> = o que passou pelas máquinas deste grupo, de qualquer referência.{' '}
          <strong>Produzido das refs dele</strong> = o que saiu das referências que têm este grupo como A, feito por ele <em>ou por alternativos</em> — é o número da matriz.
        </p>
      </div>

      <section>
        <h4 className="mb-1 font-semibold text-gray-800">Mês a mês</h4>
        <table className="w-full tabular-nums">
          <thead className="text-[10px] text-gray-500">
            <tr>
              <th className="py-1 text-left font-normal">mês</th>
              <th className="text-right font-normal" title="Capacidade do mês, em minutos">cap. min</th>
              <th className="text-right font-normal" title="(alocado + carga extra) ÷ capacidade">ocupação</th>
              <th className="text-right font-normal text-sky-800">costurou</th>
              <th className="text-right font-normal text-emerald-800">produzido refs dele</th>
              <th className="text-right font-normal text-red-700">empurra</th>
            </tr>
          </thead>
          <tbody>
            {cols.map((i) => {
              const m = porPer.get(PERIODOS[i]);
              const o = costura?.ocupacao[i] ?? null;
              const feito = comRefs ? Math.max(0, comRefs.veio[i] + comRefs.plano[i] - comRefs.empurra[i]) : 0;
              return (
                <tr key={i} className={`border-t border-gray-100 ${sel.col === i ? 'bg-indigo-50 font-semibold' : ''}`}>
                  <td className="py-1">{meses[i]}</td>
                  <td className="text-right">{num(m?.capacidadeMin || 0)}</td>
                  <td className={`text-right ${o !== null && o >= 0.995 ? 'font-semibold text-amber-700' : 'text-gray-600'}`}>{o === null ? '—' : `${Math.round(o * 100)}%`}</td>
                  <td className="text-right text-sky-800">{num(costura?.costurado[i] || 0)}</td>
                  <td className="text-right text-emerald-800">{comRefs ? num(feito) : '—'}</td>
                  <td className="text-right text-red-700">{comRefs && comRefs.empurra[i] >= 0.5 ? `↪ ${num(comRefs.empurra[i])}` : '·'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h4 className="mb-1 font-semibold text-gray-800">Referências dele (grupo A) <span className="font-normal text-gray-400">· {proprias.length}</span></h4>
        {proprias.length ? (
          <ul className="space-y-0.5">
            {proprias.map((r) => (
              <li key={r.referencia} className="flex items-baseline justify-between gap-2 tabular-nums">
                <button type="button" className="font-mono text-indigo-700 hover:underline" onClick={() => onSel({ tipo: 'ref', ref: r.referencia, col: sel.col })}>{r.referencia}</button>
                <span className="text-gray-500">plano {num(soma(r.plano))}{soma(r.empurra) >= 0.5 ? <span className="ml-2 text-red-700">↪ {num(soma(r.empurra))} no ano</span> : null}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-gray-500">Nenhuma referência tem este grupo como A{comRefs?.papel === 'largou' ? ' depois da conversão' : ': ele costura o que os grupos A não dão conta (lista abaixo)'}.</p>}
      </section>

      <section>
        <h4 className="mb-1 font-semibold text-gray-800">Costurou de outros grupos <span className="font-normal text-gray-400">· {deOutros.length}</span></h4>
        {deOutros.length ? (
          <ul className="space-y-0.5">
            {deOutros.map((r) => (
              <li key={r.referencia} className="flex items-baseline justify-between gap-2 tabular-nums">
                <button type="button" className="font-mono text-indigo-700 hover:underline" onClick={() => onSel({ tipo: 'ref', ref: r.referencia, col: sel.col })}>{r.referencia}</button>
                <span className="text-gray-500">{num(r.pecas)} pç · grupo A {r.A ? curto(r.A) : '—'}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-gray-500">Só costurou as próprias.</p>}
      </section>
    </div>
  );
}
