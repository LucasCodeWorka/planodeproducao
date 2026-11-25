'use client';

// CAPÍTULO 2 — O PLANO CONTRA A CAPACIDADE, em peças, mês a mês.
//
// Capacidade: a única do sistema (`/api/capacidade/capacidade-mensal`) — nível × sazonalidade
// × dias, em peças pelo min/peça medido. É a mesma que o gráfico da Visão Geral desenha e a
// mesma que a distribuição reparte pelos grupos.
// Plano: o do gráfico da Visão Geral, com a Liebe Move (planoVisaoGeral.ts).
// Leitura ACUMULADA (memória: capacidade é sempre acumulada — o que não cabe num mês
// transborda), com o mês isolado ao lado só como diagnóstico.

import type { MesPlanoVG } from './planoVisaoGeral';

export type PeriodoCapacidade = { periodo: string; mes: string; dias: number; minutos: number; pecas: number | null };

const MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const num = (v: number) => Math.round(v || 0).toLocaleString('pt-BR');
const sinal = (v: number) => `${v > 0 ? '+' : ''}${num(v)}`;
const rotulo = (iso: string) => `${MESES_PT[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;

export default function CapacidadePlano({ capacidade, plano, minPeca }: { capacidade: PeriodoCapacidade[]; plano: MesPlanoVG[]; minPeca: number }) {
  const linhas = plano.map((p) => {
    const c = capacidade.find((x) => x.mes === p.mes);
    return { mes: p.mes, dias: c?.dias || 0, capacidade: Number(c?.pecas || 0), plano: p.plano, move: p.move, el: p.el, origem: p.origem };
  });
  let capAcum = 0;
  let planoAcum = 0;
  const acumulado = linhas.map((l) => {
    capAcum += l.capacidade;
    planoAcum += l.plano;
    return { capAcum, planoAcum, saldo: capAcum - planoAcum, ocup: capAcum > 0 ? planoAcum / capAcum : null };
  });
  const capDia = (i: number) => (linhas[i].dias > 0 ? linhas[i].capacidade / linhas[i].dias : 0);
  const totalCap = linhas.reduce((s, l) => s + l.capacidade, 0);
  const totalPlano = linhas.reduce((s, l) => s + l.plano, 0);

  const cor = (o: number | null) => (o === null ? 'text-gray-300' : o > 1.005 ? 'text-red-700 font-semibold' : o >= 0.9 ? 'text-amber-700' : 'text-emerald-700');

  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="font-semibold text-gray-900">O plano de {linhas[0]?.mes.slice(0, 4)} contra a capacidade, em peças</h3>
        <p className="mt-1 text-xs text-gray-500">
          <strong>Capacidade</strong> = a do gráfico da Projeção x Capacidade e da distribuição (nível × sazonalidade × jornada × dias; 42 h/semana a partir de 16/12/2026), em peças a {minPeca.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} min/peça
          medidos. <strong>Plano</strong> = o do gráfico da Projeção x Capacidade, com a Liebe Move. Lido <strong>acumulado</strong>: o que sobra num mês adianta o seguinte,
          o que falta transborda — os dias são quanto de produção sobra ou falta no acumulado, no ritmo do mês.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left">Peças</th>
              {linhas.map((l) => (
                <th key={l.mes} className="px-2 py-2 text-right whitespace-nowrap">
                  {rotulo(l.mes)}<div className="text-[10px] font-normal text-gray-400">{l.dias}d</div>
                </th>
              ))}
              <th className="px-3 py-2 text-right">Ano</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-gray-100">
              <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-semibold text-slate-700">Capacidade</td>
              {linhas.map((l) => <td key={l.mes} className="px-2 py-1.5 text-right tabular-nums text-slate-700">{num(l.capacidade)}</td>)}
              <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{num(totalCap)}</td>
            </tr>
            <tr className="border-t border-gray-100">
              <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-semibold text-violet-800">Plano (Projeção x Capacidade + Move)</td>
              {linhas.map((l) => (
                <td key={l.mes} className="px-2 py-1.5 text-right tabular-nums text-violet-800"
                  title={`${l.origem === 'lançado' ? 'Lote lançado no ERP' : 'Simulação + edição limitada projetada'}${l.move ? ` · Liebe Move ${num(l.move)}` : ''}${l.el ? ` · edição limitada ${num(l.el)}` : ''}`}>
                  {num(l.plano)}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-violet-800">{num(totalPlano)}</td>
            </tr>
            <tr className="border-t border-gray-100 text-gray-500">
              <td className="sticky left-0 z-10 bg-white px-3 py-1.5">no mês, sobra / falta</td>
              {linhas.map((l) => (
                <td key={l.mes} className={`px-2 py-1.5 text-right tabular-nums ${l.capacidade - l.plano < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{sinal(l.capacidade - l.plano)}</td>
              ))}
              <td />
            </tr>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2">Acumulado: sobra / falta</td>
              {acumulado.map((a, i) => (
                <td key={linhas[i].mes} className={`px-2 py-2 text-right tabular-nums ${a.saldo < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                  {sinal(a.saldo)}
                  <div className="text-[10px] font-normal">{capDia(i) > 0 ? `${a.saldo > 0 ? '+' : ''}${(a.saldo / capDia(i)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}d` : ''}</div>
                </td>
              ))}
              <td className={`px-3 py-2 text-right tabular-nums ${totalCap - totalPlano < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{sinal(totalCap - totalPlano)}</td>
            </tr>
            <tr className="bg-gray-50">
              <td className="sticky left-0 z-10 bg-gray-50 px-3 py-1.5 text-gray-600">Ocupação acumulada</td>
              {acumulado.map((a, i) => <td key={linhas[i].mes} className={`px-2 py-1.5 text-right tabular-nums ${cor(a.ocup)}`}>{a.ocup === null ? '—' : `${Math.round(a.ocup * 100)}%`}</td>)}
              <td className={`px-3 py-1.5 text-right tabular-nums ${cor(totalCap > 0 ? totalPlano / totalCap : null)}`}>{totalCap > 0 ? `${Math.round((totalPlano / totalCap) * 100)}%` : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-500">
        Este quadro é o total da fábrica, em peças. Ele não diz <strong>onde</strong> aperta: a capacidade é dos grupos de costura, e cada referência só vai para
        os grupos da lista dela — é o que os capítulos seguintes mostram. A conta começa em jan/27 sem o atraso de nov–dez/26.
      </div>
    </section>
  );
}
