'use client';

import { useState } from 'react';

// PREVISTO CONTRA REALIZADO, nos meses que ja fecharam.
//
// O horizonte do plano rola com o calendario. Em 03/11/2026 a Visao Geral passou a comecar
// em novembro e OUTUBRO SUMIU da tela — e com ele a unica leitura de quanto a projecao
// acertou. Nao e porque o mes virou que o fechamento dele deixa de importar: o mes fechado
// e o unico que diz se o modelo esta calibrado.
//
// So meses FECHADOS entram. O mes em curso tem venda parcial e apareceria como despenque —
// em 03/11 novembro tinha 875 pecas contra 108.226 projetadas, o que e calendario, nao erro
// de previsao.
//
// A ABERTURA POR CONTINUIDADE e o ponto, nao um detalhe. Em outubro o desvio do conjunto
// foi -16,3%, mas permanentes erraram 5,3% e edicao limitada errou 53,6%. Sem abrir, a
// conclusao seria "a projecao erra 16%" — verdadeira e inutil.

export type MesFechado = {
  mes: number;
  projetado: number;
  realizado: number;
  desvio: number | null;
  porContinuidade: { continuidade: string; projetado: number; realizado: number; desvio: number | null }[];
};

type Props = {
  ano: number;
  meses: MesFechado[];
};

const MES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function fmt(v: number) {
  return Math.round(v || 0).toLocaleString('pt-BR');
}

function pctDesvio(v: number | null) {
  if (v === null) return '—';
  return `${v > 0 ? '+' : ''}${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

// Verde so quando o erro e pequeno nos DOIS sentidos. Vender muito acima do previsto nao e
// vitoria: significa que o plano foi dimensionado para outra coisa.
function corDesvio(v: number | null) {
  if (v === null) return 'text-gray-400';
  const a = Math.abs(v);
  if (a <= 0.05) return 'text-emerald-600';
  if (a <= 0.15) return 'text-amber-600';
  return 'text-red-600';
}

export default function ProjetadoVsRealizado({ ano, meses }: Props) {
  const [aberto, setAberto] = useState<number | null>(null);

  if (!meses.length) return null;

  const ultimo = meses[meses.length - 1];
  const somaProj = meses.reduce((a, m) => a + m.projetado, 0);
  const somaReal = meses.reduce((a, m) => a + m.realizado, 0);
  const desvioAno = somaProj > 0 ? (somaReal - somaProj) / somaProj : null;

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
        <div>
          <h2 className="font-semibold text-gray-900">Projetado × realizado · meses fechados de {ano}</h2>
          <p className="text-xs text-gray-500">
            O mês que fecha é o que diz se a projeção está calibrada. Clique no mês para abrir por continuidade.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-gray-400">no ano, até {MES_ABREV[ultimo.mes - 1]}</div>
          <div className={`font-mono text-lg font-bold ${corDesvio(desvioAno)}`}>{pctDesvio(desvioAno)}</div>
          <div className="font-mono text-[11px] text-gray-500">{fmt(somaReal)} de {fmt(somaProj)}</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left">Indicador</th>
              {meses.map((m) => (
                <th key={m.mes} className="px-3 py-3 text-center whitespace-nowrap">
                  {MES_ABREV[m.mes - 1]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-gray-100">
              <td className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left font-semibold text-gray-700">Previsto</td>
              {meses.map((m) => (
                <td key={m.mes} className="px-3 py-2.5 text-center font-mono tabular-nums text-amber-700">{fmt(m.projetado)}</td>
              ))}
            </tr>
            <tr className="border-t border-gray-100">
              <td className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left font-semibold text-gray-700">Realizado</td>
              {meses.map((m) => (
                <td key={m.mes} className="px-3 py-2.5 text-center font-mono tabular-nums font-semibold text-gray-900">{fmt(m.realizado)}</td>
              ))}
            </tr>
            <tr className="border-t border-gray-200 bg-gray-50">
              <td className="sticky left-0 z-10 bg-gray-50 px-4 py-2.5 text-left font-semibold text-gray-800">Desvio</td>
              {meses.map((m) => (
                <td key={m.mes} className="px-3 py-2.5 text-center">
                  <button
                    type="button"
                    onClick={() => setAberto(aberto === m.mes ? null : m.mes)}
                    className={`font-mono text-sm font-bold hover:underline ${corDesvio(m.desvio)}`}
                    title="Abrir por continuidade"
                  >
                    {pctDesvio(m.desvio)}
                  </button>
                </td>
              ))}
            </tr>

            {/* Abertura por continuidade do mes clicado. E onde o numero do conjunto se
                explica: em out/2026 o -16,3% era permanente -5,3% e edicao limitada -53,6%. */}
            {aberto !== null && (() => {
              const m = meses.find((x) => x.mes === aberto);
              if (!m) return null;
              return m.porContinuidade.map((c) => (
                <tr key={`${aberto}-${c.continuidade}`} className="border-t border-gray-50 bg-sky-50/40">
                  <td className="sticky left-0 z-10 bg-sky-50/40 py-2 pl-9 pr-4 text-left text-xs text-gray-600 whitespace-nowrap">
                    <span className="mr-1 text-gray-300">└</span>
                    {MES_ABREV[m.mes - 1]} · {c.continuidade}
                  </td>
                  <td colSpan={meses.length} className="px-3 py-2 text-left">
                    <span className="font-mono text-xs text-amber-700">{fmt(c.projetado)}</span>
                    <span className="mx-1 text-gray-400">→</span>
                    <span className="font-mono text-xs font-semibold text-gray-900">{fmt(c.realizado)}</span>
                    <span className={`ml-2 font-mono text-xs font-bold ${corDesvio(c.desvio)}`}>{pctDesvio(c.desvio)}</span>
                  </td>
                </tr>
              ));
            })()}
          </tbody>
        </table>
      </div>
    </div>
  );
}
