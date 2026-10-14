'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { MesCapacidadeVenda } from './CapacidadeVsVenda';

// Explica a projecao de venda mes a mes: de qual venda ela parte, quanto cresceu e por que.
// A pergunta que ele responde e "por que este mes esta tao alto?" — quase sempre porque o
// mesmo mes do ano anterior foi alto, e a projecao so aplica o crescimento por cima.

type Props = {
  meses: MesCapacidadeVenda[];
  onClose: () => void;
};

const fmt = (v: number) => Math.round(v || 0).toLocaleString('pt-BR');
const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1).replace('.', ',')}%`;
const fmtSinal = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v))}`;

type Analise = {
  m: MesCapacidadeVenda;
  total: number;
  perm: number;
  el: number;
  basePerm: number;
  baseEl: number;
  base: number;
  variacao: number;
  crescPerm: number;
  crescEl: number;
  resto: number;
  mesBase: string;
};

function analisar(m: MesCapacidadeVenda): Analise {
  const perm = Number(m.demanda || 0);
  const el = Number(m.demandaEl || 0);
  const total = perm + el;
  const bp = m.basePerm;
  const be = m.elBase;
  const basePerm = bp ? bp.fabrica + bp.lojas : 0;
  const baseEl = be ? be.fabricaBase + be.lojasBase : 0;
  const base = basePerm + baseEl;
  const crescPerm = bp ? bp.fabrica * (Number(m.fatorFabrica || 1) - 1) : 0;
  const crescEl = be ? be.fabricaBase * (Number(be.fatorFabrica || 1) - 1) : 0;
  const [abrev] = m.mes.split('/');
  const anoBase = bp?.ano ?? be?.anoFonte;
  return {
    m, total, perm, el, basePerm, baseEl, base,
    variacao: base > 0 ? total / base - 1 : 0,
    crescPerm, crescEl,
    resto: total - base - crescPerm - crescEl,
    mesBase: anoBase ? `${abrev}/${String(anoBase).slice(2)}` : '—',
  };
}

export default function AnaliseProjecaoModal({ meses, onClose }: Props) {
  const analises = useMemo(() => meses.map(analisar), [meses]);
  const [sel, setSel] = useState(() => Math.max(0, meses.findIndex((m) => m.mes.startsWith('jan'))));
  const a = analises[sel];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Posicao do mes de origem entre os meses de venda REAL do mesmo ano que aparecem aqui.
  const ranking = useMemo(() => {
    if (!a?.m.basePerm || a.m.basePerm.fonte !== 'venda') return null;
    const ano = a.m.basePerm.ano;
    const pares = analises.filter((x) => x.m.basePerm?.ano === ano && x.m.basePerm.fonte === 'venda');
    const ordem = [...pares].sort((x, y) => y.base - x.base);
    const media = pares.reduce((s, x) => s + x.base, 0) / Math.max(1, pares.length);
    return { posicao: ordem.indexOf(a) + 1, de: pares.length, ano, media };
  }, [a, analises]);

  if (!a) return null;
  const fatorPct = Math.round((Number(a.m.fatorFabrica || 1) - 1) * 100);
  const lancada = Number(a.m.baseLancada || 0);
  const modelo = Number(a.m.baseModelo || 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Análise da projeção de venda"
        className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <h2 className="font-semibold text-gray-900">Análise da projeção de venda</h2>
            <p className="text-xs text-gray-500">
              Cada mês parte da venda do mesmo mês do ano anterior. Clique num mês para ver a conta.
            </p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="rounded p-1 text-gray-500 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto">
          <div className="overflow-x-auto px-5 pt-4">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left">Mês</th>
                  <th className="px-3 py-2 text-right">Base (mesmo mês ano anterior)</th>
                  <th className="px-3 py-2 text-right">Projeção</th>
                  <th className="px-3 py-2 text-right">Variação</th>
                  <th className="px-3 py-2 text-right">Permanentes</th>
                  <th className="px-3 py-2 text-right">Edição limitada</th>
                </tr>
              </thead>
              <tbody>
                {analises.map((x, i) => (
                  <tr
                    key={x.m.mes}
                    onClick={() => setSel(i)}
                    className={`cursor-pointer border-t ${i === sel ? 'bg-amber-50' : 'hover:bg-gray-50'}`}
                  >
                    <td className="px-3 py-2 font-semibold text-gray-800">
                      {x.m.mes}
                      {x.m.travado && <span className="ml-1 text-[10px] font-normal text-gray-400">🔒 real</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-600">
                      {x.base > 0 ? fmt(x.base) : '—'}
                      <span className="ml-1 text-[10px] text-gray-400">{x.mesBase}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-amber-700">{fmt(x.total)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${x.variacao > 0.15 ? 'text-red-700' : 'text-gray-700'}`}>
                      {x.base > 0 ? fmtPct(x.variacao) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-600">{fmt(x.perm)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-600">{fmt(x.el)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="m-5 rounded-lg border border-amber-200 bg-amber-50/50 p-4 text-sm text-gray-800">
            <h3 className="mb-2 font-semibold text-gray-900">
              {a.m.mes}: {fmt(a.total)} peças
            </h3>
            {a.base > 0 && (
              <p className="mb-3">
                Em <strong>{a.mesBase}</strong> esses produtos {a.m.basePerm?.fonte === 'projecao' ? 'têm projeção gravada de' : 'venderam'}{' '}
                <strong>{fmt(a.base)}</strong>. A projeção fica <strong>{fmtPct(a.variacao)}</strong> em relação a isso.
                {ranking && ranking.de > 1 && (
                  <>
                    {' '}{a.mesBase} foi o <strong>{ranking.posicao}º maior mês</strong> de {ranking.ano} entre os {ranking.de} meses
                    fechados mostrados aqui (média {fmt(ranking.media)}).
                  </>
                )}
              </p>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded border border-gray-200 bg-white p-3">
                <div className="mb-1 text-xs font-semibold uppercase text-gray-500">Permanentes · {fmt(a.perm)}</div>
                {a.m.basePerm ? (
                  <table className="w-full text-xs">
                    <tbody>
                      <tr><td className="py-0.5 text-gray-600">Base fábrica {a.mesBase}</td><td className="text-right font-mono">{fmt(a.m.basePerm.fabrica)}</td></tr>
                      <tr><td className="py-0.5 text-gray-600">Base lojas {a.mesBase}</td><td className="text-right font-mono">{fmt(a.m.basePerm.lojas)}</td></tr>
                      {fatorPct !== 0 && (
                        <tr><td className="py-0.5 text-gray-600">Crescimento fábrica +{fatorPct}%</td><td className="text-right font-mono">{fmtSinal(a.crescPerm)}</td></tr>
                      )}
                      {(lancada > 0 || modelo > 0) && (
                        <>
                          <tr className="border-t"><td className="pt-1 text-gray-600">Lançado no sistema</td><td className="pt-1 text-right font-mono">{fmt(lancada)}</td></tr>
                          <tr><td className="py-0.5 text-gray-600">Completado pelo modelo</td><td className="text-right font-mono">{fmt(modelo)}</td></tr>
                        </>
                      )}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-xs text-gray-500">Sem base histórica: projeção gravada.</p>
                )}
              </div>

              <div className="rounded border border-gray-200 bg-white p-3">
                <div className="mb-1 text-xs font-semibold uppercase text-gray-500">Edição limitada · {fmt(a.el)}</div>
                {a.m.elBase ? (
                  <table className="w-full text-xs">
                    <tbody>
                      <tr><td className="py-0.5 text-gray-600">Coleção em linha em {a.mesBase} · fábrica</td><td className="text-right font-mono">{fmt(a.m.elBase.fabricaBase)}</td></tr>
                      <tr><td className="py-0.5 text-gray-600">Coleção em linha em {a.mesBase} · lojas</td><td className="text-right font-mono">{fmt(a.m.elBase.lojasBase)}</td></tr>
                      {a.crescEl !== 0 && (
                        <tr><td className="py-0.5 text-gray-600">Crescimento fábrica ×{String(a.m.elBase.fatorFabrica).replace('.', ',')}</td><td className="text-right font-mono">{fmtSinal(a.crescEl)}</td></tr>
                      )}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-xs text-gray-500">Sem base histórica de coleção.</p>
                )}
              </div>
            </div>

            {a.base > 0 && (
              <div className="mt-3 rounded border border-gray-200 bg-white p-3 text-xs">
                <div className="mb-1 font-semibold uppercase text-gray-500">De {fmt(a.base)} para {fmt(a.total)}</div>
                <table className="w-full">
                  <tbody>
                    <tr><td className="py-0.5 text-gray-600">Base {a.mesBase} (permanentes + edição limitada)</td><td className="text-right font-mono">{fmt(a.base)}</td></tr>
                    {a.crescPerm !== 0 && <tr><td className="py-0.5 text-gray-600">Crescimento da fábrica nos permanentes</td><td className="text-right font-mono">{fmtSinal(a.crescPerm)}</td></tr>}
                    {a.crescEl !== 0 && <tr><td className="py-0.5 text-gray-600">Crescimento da fábrica na edição limitada</td><td className="text-right font-mono">{fmtSinal(a.crescEl)}</td></tr>}
                    {Math.abs(a.resto) >= 1 && (
                      <tr>
                        <td className="py-0.5 text-gray-600">
                          {a.m.projecaoGravada
                            ? 'Projeção gravada acima/abaixo da venda do ano anterior'
                            : 'Projeção lançada no sistema e canais acima/abaixo do modelo'}
                        </td>
                        <td className="text-right font-mono">{fmtSinal(a.resto)}</td>
                      </tr>
                    )}
                    <tr className="border-t font-semibold"><td className="pt-1">Projeção {a.m.mes}</td><td className="pt-1 text-right font-mono">{fmt(a.total)}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
