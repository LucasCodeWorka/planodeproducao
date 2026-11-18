'use client';

// EXECUÇÃO IDEAL DE 2027 — "se eu pudesse montar a fábrica do zero, sem viajar".
//
// Esquece os grupos de hoje. Por PERFIL: quantas peças o plano pede e quantos grupos daquele
// perfil seriam necessários em cada mês, no ritmo que um grupo do perfil já demonstrou.
// Grupo não para: o número é fixo no ano (nivelado). Os perfis se juntam em BLOCOS — quem
// cobre quem na prática — e cada bloco tem uma proposta de grupos inteiros, com o saldo
// acumulado mês a mês mostrando onde ela folga e onde fica devendo.

import { Fragment } from 'react';

type Perfil = {
  perfil: string;
  ritmo: number;
  gruposHoje: { grupo: string; entregaMes: number }[];
  plano: number[];
  totalPlano: number;
  gruposMes: number[];
  media: number;
  nivelado: number;
  pico: number;
};

export type SetupIdealDados = {
  ano: number;
  loteId: string | null;
  janela: { de: string; ate: string };
  mesesAno: string[];
  dias: number[];
  totalPlano: number;
  gruposHoje: number;
  perfis: Perfil[];
  blocos: {
    bloco: string;
    perfis: string[];
    proposta: number;
    motivo: string;
    hoje: number;
    plano: number[];
    totalPlano: number;
    gruposMes: number[];
    media: number;
    nivelado: number;
    saldoMes: number[];
    saldoAcum: number[];
  }[];
  foraDeBloco: string[];
};

const MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const num = (v: number) => Math.round(v || 0).toLocaleString('pt-BR');
const g1 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const mesRotulo = (iso: string) => `${MESES_PT[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;
const curto = (g: string) => (g.includes(' - ') ? g.split(' - ')[1] : g);

const FAMILIAS = ['Sutiã', 'Calcinha', 'Anatomic', 'Noite', 'Outros'];
const COR_FAMILIA: Record<string, string> = {
  'Sutiã': 'bg-rose-50 text-rose-800',
  Calcinha: 'bg-sky-50 text-sky-800',
  Anatomic: 'bg-teal-50 text-teal-800',
  Noite: 'bg-violet-50 text-violet-800',
  Outros: 'bg-gray-50 text-gray-700',
};
function familiaDoPerfil(mix: string) {
  const m = mix.toUpperCase();
  if (m.includes('ANATOMIC')) return 'Anatomic';
  if (m.includes('NOITE')) return 'Noite';
  if (m.startsWith('SO ')) return 'Sutiã';
  if (m.startsWith('CA ') || m.startsWith('SC ')) return 'Calcinha';
  return 'Outros';
}
const PREFIXO: Record<string, string> = { SO: 'Sutiã', CA: 'Calcinha', SC: 'Sem costura', BO: 'Body', AC: 'Acessório' };
function nomePerfil(mix: string) {
  if (mix === 'ANATOMIC') return 'Anatomic (sutiã + calcinha)';
  const limpo = mix.replace(/\s*PRODUCAO$/, '').trim();
  const [pre, ...resto] = limpo.split(' ');
  const corpo = resto.join(' ').toLowerCase().replace('basico', 'básico');
  return PREFIXO[pre] ? `${PREFIXO[pre]} ${corpo}`.trim() : limpo;
}
function corGrupos(v: number) {
  if (!(v > 0.05)) return 'text-gray-300';
  if (v >= 3) return 'bg-indigo-200 text-indigo-900 font-semibold';
  if (v >= 1.5) return 'bg-indigo-100 text-indigo-900';
  if (v >= 0.5) return 'bg-indigo-50 text-indigo-800';
  return 'text-indigo-700';
}

export default function SetupIdeal({ dados }: { dados: SetupIdealDados }) {
  const blocosFamilia = FAMILIAS.map((familia) => ({
    familia,
    perfis: dados.perfis.filter((p) => familiaDoPerfil(p.perfil) === familia),
  })).filter((b) => b.perfis.length > 0);
  const n = dados.mesesAno.length;
  const totalGruposMes = Array.from({ length: n }, (_, i) => dados.perfis.reduce((s, p) => s + p.gruposMes[i], 0));
  const totalPlanoMes = Array.from({ length: n }, (_, i) => dados.perfis.reduce((s, p) => s + p.plano[i], 0));
  const propostaTotal = dados.blocos.reduce((s, b) => s + b.proposta, 0);
  const saldoAcumTotal = Array.from({ length: n }, (_, i) => dados.blocos.reduce((s, b) => s + b.saldoAcum[i], 0));

  return (
    <>
      <section className="mb-6 rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3">
          <h2 className="font-semibold text-gray-900">Execução ideal de {dados.ano} · se a fábrica fosse montada do zero para o plano</h2>
          <p className="mt-1 text-xs text-gray-500">
            Esquece os grupos de hoje. Cada referência do plano emitido (matriz + lote {dados.loteId || '—'}) vai para o <strong>perfil</strong> do grupo que hoje mais a produz.
            Em cada mês: peças do perfil e <strong>quantos grupos daquele perfil</strong> ela pede, no ritmo que um grupo do perfil já entrega
            (média de {mesRotulo(dados.janela.de)} a {mesRotulo(dados.janela.ate)}, ajustada aos dias). <strong>Nivelado</strong> = número fixo de grupos no ano, que antecipa
            nos meses de folga e nunca fica devendo no acumulado desde janeiro. Sem edição limitada projetada nem Move.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left">Perfil</th>
                {dados.mesesAno.map((m, i) => (
                  <th key={m} className="px-2 py-2 text-right whitespace-nowrap">
                    {mesRotulo(m)}<div className="text-[10px] font-normal text-gray-400">{dados.dias[i]}d</div>
                  </th>
                ))}
                <th className="px-3 py-2 text-right">Peças no ano</th>
                <th className="bg-indigo-50 px-2 py-2 text-right text-indigo-700" title="Peças por mês que um grupo deste perfil entrega hoje">Ritmo de 1 grupo</th>
                <th className="bg-indigo-50 px-2 py-2 text-right text-indigo-700">Média</th>
                <th className="bg-indigo-50 px-2 py-2 text-right text-indigo-700">Pico</th>
                <th className="bg-indigo-100 px-2 py-2 text-right text-indigo-800">Nivelado</th>
              </tr>
            </thead>
            <tbody>
              {blocosFamilia.map((b) => (
                <Fragment key={b.familia}>
                  <tr className={`border-t-2 border-gray-300 font-bold ${COR_FAMILIA[b.familia]}`}>
                    <td className={`sticky left-0 z-10 px-3 py-1.5 ${COR_FAMILIA[b.familia]}`}>{b.familia}</td>
                    {dados.mesesAno.map((_, i) => {
                      const pecas = b.perfis.reduce((s, p) => s + p.plano[i], 0);
                      const gr = b.perfis.reduce((s, p) => s + p.gruposMes[i], 0);
                      return (
                        <td key={i} className="px-2 py-1.5 text-right tabular-nums">
                          <div>{num(pecas)}</div>
                          <div className="text-[10px] font-normal">{g1(gr)} gr</div>
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-right tabular-nums">{num(b.perfis.reduce((s, p) => s + p.totalPlano, 0))}</td>
                    <td className="px-2 py-1.5" />
                    <td className="px-2 py-1.5 text-right tabular-nums">{g1(b.perfis.reduce((s, p) => s + p.media, 0))}</td>
                    <td className="px-2 py-1.5" />
                    <td className="px-2 py-1.5 text-right tabular-nums">{g1(b.perfis.reduce((s, p) => s + p.nivelado, 0))}</td>
                  </tr>
                  {b.perfis.map((p) => (
                    <tr key={p.perfil} className="border-t border-gray-100">
                      <td className="sticky left-0 z-10 bg-white py-1.5 pl-7 pr-3 whitespace-nowrap"
                        title={`Grupos com este perfil hoje: ${p.gruposHoje.map((g) => `${curto(g.grupo)} (${num(g.entregaMes)}/mês)`).join(', ') || 'nenhum'}`}>
                        <div className="font-semibold text-gray-800">{nomePerfil(p.perfil)}</div>
                        <div className="text-[10px] text-gray-400">hoje: {p.gruposHoje.map((g) => curto(g.grupo)).join(', ') || '—'}</div>
                      </td>
                      {p.plano.map((v, i) => (
                        <td key={i} className={`px-2 py-1.5 text-right tabular-nums ${corGrupos(p.gruposMes[i])}`}>
                          <div>{v ? num(v) : '·'}</div>
                          {v > 0 && <div className="text-[10px]">{g1(p.gruposMes[i])} gr</div>}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{num(p.totalPlano)}</td>
                      <td className="bg-indigo-50/60 px-2 py-1.5 text-right tabular-nums">{num(p.ritmo)}</td>
                      <td className="bg-indigo-50/60 px-2 py-1.5 text-right tabular-nums">{g1(p.media)}</td>
                      <td className="bg-indigo-50/60 px-2 py-1.5 text-right tabular-nums">{g1(p.pico)}</td>
                      <td className="bg-indigo-100/70 px-2 py-1.5 text-right tabular-nums font-bold text-indigo-900">{g1(p.nivelado)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2">Fábrica</td>
                {totalPlanoMes.map((v, i) => (
                  <td key={i} className="px-2 py-2 text-right tabular-nums">
                    <div>{num(v)}</div>
                    <div className={`text-[10px] ${totalGruposMes[i] > dados.gruposHoje ? 'text-red-700' : 'font-normal text-gray-600'}`}>{g1(totalGruposMes[i])} gr</div>
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums">{num(dados.totalPlano)}</td>
                <td className="bg-indigo-50" />
                <td className="bg-indigo-50 px-2 py-2 text-right tabular-nums">{g1(dados.perfis.reduce((s, p) => s + p.media, 0))}</td>
                <td className="bg-indigo-50" />
                <td className="bg-indigo-100 px-2 py-2 text-right tabular-nums" title="Soma dos nivelados, cada perfil sozinho">{g1(dados.perfis.reduce((s, p) => s + p.nivelado, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="mb-6 rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3">
          <h2 className="font-semibold text-gray-900">Setup proposto · {propostaTotal} grupos em {dados.blocos.length} blocos</h2>
          <p className="mt-1 text-xs text-gray-500">
            Perfis que se cobrem na prática viram um bloco, com um número inteiro e fixo de grupos. O <strong>saldo acumulado</strong> soma, mês a mês, o que a
            proposta entrega a mais (vira estoque) ou a menos (vira atraso), em grupos-mês. Negativo = o bloco está devendo naquele ponto do ano.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Bloco</th>
                <th className="px-2 py-2 text-right">Hoje</th>
                <th className="px-2 py-2 text-right">Média</th>
                <th className="px-2 py-2 text-right">Nivelado</th>
                <th className="bg-indigo-100 px-2 py-2 text-right text-indigo-800">Proposta</th>
                {dados.mesesAno.map((m) => <th key={m} className="px-2 py-2 text-right whitespace-nowrap">{mesRotulo(m)}</th>)}
              </tr>
            </thead>
            <tbody>
              {dados.blocos.map((b) => (
                <tr key={b.bloco} className="border-t border-gray-100 align-top">
                  <td className="max-w-[22rem] px-3 py-2">
                    <div className="font-semibold text-gray-800">{b.bloco}</div>
                    <div className="mt-0.5 text-[10px] leading-snug text-gray-500">{b.motivo}</div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-500">{b.hoje}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{g1(b.media)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{g1(b.nivelado)}</td>
                  <td className="bg-indigo-100/70 px-2 py-2 text-right text-base tabular-nums font-bold text-indigo-900">{b.proposta}</td>
                  {b.saldoAcum.map((v, i) => (
                    <td key={i} className={`px-2 py-2 text-right tabular-nums ${v < -0.05 ? 'bg-red-50 font-semibold text-red-700' : 'text-emerald-700'}`}
                      title={`Pede ${g1(b.gruposMes[i])} grupos neste mês · ${num(b.plano[i])} peças`}>
                      {v > 0 ? '+' : ''}{g1(v)}
                      <div className="text-[10px] font-normal text-gray-400">pede {g1(b.gruposMes[i])}</div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                <td className="px-3 py-2">Fábrica</td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-500">{dados.gruposHoje}</td>
                <td className="px-2 py-2 text-right tabular-nums">{g1(dados.blocos.reduce((s, b) => s + b.media, 0))}</td>
                <td className="px-2 py-2 text-right tabular-nums">{g1(dados.blocos.reduce((s, b) => s + b.nivelado, 0))}</td>
                <td className="bg-indigo-100 px-2 py-2 text-right text-base tabular-nums text-indigo-900">{propostaTotal}</td>
                {saldoAcumTotal.map((v, i) => (
                  <td key={i} className={`px-2 py-2 text-right tabular-nums ${v < -0.05 ? 'text-red-700' : 'text-emerald-700'}`}>{v > 0 ? '+' : ''}{g1(v)}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-500">
          O saldo da fábrica soma os blocos como se a folga de um pudesse cobrir outro — vale só para grupos que de fato trocam de perfil.
          {dados.foraDeBloco.length > 0 && ` Perfis sem bloco: ${dados.foraDeBloco.map(nomePerfil).join(', ')}.`}
        </div>
      </section>
    </>
  );
}
