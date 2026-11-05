'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import type { MesCapacidadeVenda } from './CapacidadeVsVenda';

// FOTOS SALVAS, lado a lado com a leitura de hoje.
//
// Salvar sem poder conferir nao serve: a foto existe para resolver a discussao "estava 75%",
// e isso so acontece se der para abrir a de ontem e por ao lado da de hoje.
//
// A comparacao e por MES, nao por total. O total esconde justamente o que interessa: em
// 04/11/2026 um lote de outubro foi baixado com 96.067 pecas e a carga caiu 588 mil minutos
// — no total isso vira "caiu 4 pontos"; no mes, aparece exatamente onde.

export type CenarioSalvo = {
  id: string | number;
  nome: string;
  observacao?: string;
  criado_em: string;
  parametros?: Record<string, unknown>;
  leitura?: { meses?: MesCapacidadeVenda[]; abertura?: number; pedidosPendentes?: number };
};

type Props = {
  cenarios: CenarioSalvo[];
  aberto: CenarioSalvo | null;
  carregando: boolean;
  mesesHoje: MesCapacidadeVenda[];
  onAbrir: (id: string | number) => void;
  onApagar: (id: string | number) => void;
  onFechar: () => void;
  /** Modo foto ligado: a TELA INTEIRA esta mostrando o cenario aberto, nao hoje. */
  verFoto: boolean;
  onVerFoto: (v: boolean) => void;
};

function fmt(v: number | null | undefined) {
  return v === null || v === undefined ? '—' : Math.round(v).toLocaleString('pt-BR');
}

function pct(v: number | null | undefined) {
  return v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`;
}

// Verde quando o numero de hoje esta melhor que o da foto, vermelho quando pior. "Melhor"
// depende da linha: mais capacidade e bom, mais carga nao — por isso o `bomSubir`.
function delta(hoje: number | null | undefined, antes: number | null | undefined, bomSubir: boolean) {
  if (hoje === null || hoje === undefined || antes === null || antes === undefined) return null;
  const d = hoje - antes;
  if (Math.abs(d) < 0.5) return <span className="text-gray-300">=</span>;
  const bom = bomSubir ? d > 0 : d < 0;
  return (
    <span className={bom ? 'text-emerald-600' : 'text-red-600'}>
      {d > 0 ? '+' : '−'}{fmt(Math.abs(d))}
    </span>
  );
}

const LINHAS = [
  { rotulo: 'Capacidade (peças)', get: (m: MesCapacidadeVenda) => m.capacidadePecas, bomSubir: true },
  { rotulo: 'Venda projetada', get: (m: MesCapacidadeVenda) => m.demanda + Number(m.demandaEl || 0), bomSubir: true },
  { rotulo: 'Plano (completo)', get: (m: MesCapacidadeVenda) => Number(m.planoCompleto || 0), bomSubir: true },
  { rotulo: 'Dias disponíveis', get: (m: MesCapacidadeVenda) => m.diasDisponiveis, bomSubir: true },
  { rotulo: 'Dias necessários', get: (m: MesCapacidadeVenda) => m.diasNecessarios, bomSubir: false },
] as const;

export default function CenariosSalvos({ cenarios, aberto, carregando, mesesHoje, onAbrir, onApagar, onFechar, verFoto, onVerFoto }: Props) {
  const [confirmando, setConfirmando] = useState<string | number | null>(null);

  const salvos = aberto?.leitura?.meses || [];
  // Casa pelo ROTULO do mes ("nov/26"), nao pela posicao: o horizonte rola, e a foto de
  // ontem comeca num mes que hoje pode nem estar mais na tela. Comparar por indice poria
  // dezembro contra novembro sem avisar.
  const porMes = new Map(mesesHoje.map((m) => [m.mes, m]));
  const linhasComuns = salvos.filter((m) => porMes.has(m.mes));
  const sumidos = salvos.filter((m) => !porMes.has(m.mes)).map((m) => m.mes);

  const p = (aberto?.parametros || {}) as Record<string, number | boolean | null>;

  return (
    <div className="mb-6 rounded-lg border border-indigo-200 bg-white">
      <div className="flex items-center justify-between border-b border-indigo-100 bg-indigo-50/60 px-5 py-3">
        <div>
          <h2 className="font-semibold text-gray-900">Cenários salvos</h2>
          <p className="text-xs text-gray-500">
            A foto de um dia, ao lado da leitura de hoje. Clique num cenário para comparar mês a mês.
          </p>
        </div>
        <button onClick={onFechar} className="rounded p-1 text-gray-400 hover:bg-white hover:text-gray-700" title="Fechar">
          <X size={16} />
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-100 px-5 py-3">
        {!cenarios.length && (
          <span className="text-xs text-gray-400">Nenhuma foto salva ainda. Use o botão “Salvar cenário”, no relatório abaixo.</span>
        )}
        {cenarios.map((c) => {
          const sel = String(aberto?.id) === String(c.id);
          const cap = Number((c.parametros as Record<string, number>)?.capacidadeDiaria || 0);
          return (
            <div key={c.id} className="flex items-center gap-1">
              <button
                onClick={() => onAbrir(c.id)}
                className={`rounded border px-3 py-1.5 text-left text-xs transition-colors ${
                  sel ? 'border-indigo-400 bg-indigo-50 font-semibold text-indigo-900' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div>{c.nome}</div>
                <div className="font-mono text-[10px] text-gray-400">
                  {new Date(c.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  {cap > 0 && ` · ${fmt(cap)} min/dia`}
                </div>
              </button>
              {confirmando === c.id ? (
                <button onClick={() => { onApagar(c.id); setConfirmando(null); }} className="rounded bg-red-600 px-2 py-1.5 text-[10px] font-bold text-white">
                  apagar?
                </button>
              ) : (
                <button onClick={() => setConfirmando(c.id)} className="px-1 text-[10px] text-gray-300 hover:text-red-500" title="Apagar esta foto">
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>

      {carregando && <div className="px-5 py-6 text-sm text-gray-400">Carregando a foto…</div>}

      {!carregando && aberto && (
        <>
          {/* PARAMETROS DA FOTO, antes da tabela de proposito: 70% com 53.300 min/dia nao e
              a mesma coisa que 70% com 57.660, e quem compara precisa ver isso antes de ler
              qualquer numero. */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-gray-100 bg-gray-50 px-5 py-2 text-[11px] text-gray-600">
            <span>capacidade <strong className="font-mono">{fmt(Number(p.capacidadeDiaria) || 0)}</strong> min/dia</span>
            {Number(p.minPecaMedido) > 0 && (
              <span>min/peça <strong className="font-mono">{Number(p.minPecaMedido).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</strong></span>
            )}
            <span>cenário fábrica <strong className="font-mono">{Math.round(Number(p.cenarioFabrica || 0) * 100)}%</strong></span>
            <span>férias <strong>{p.comFerias ? 'ligadas' : 'desligadas'}</strong></span>
            {aberto.observacao && <span className="italic text-gray-500">{aberto.observacao}</span>}
            {/* ASSUMIR A FOTO. A tabela abaixo compara numero a numero; isto e outra coisa:
                poe a TELA INTEIRA naquele dia — relatorio, grafico e ocupacao por grupo —
                que e como se confere se a memoria bate com o que a tela mostrava. */}
            <button
              onClick={() => onVerFoto(!verFoto)}
              className={`ml-auto rounded border px-3 py-1 text-[11px] font-semibold transition-colors ${
                verFoto
                  ? 'border-amber-400 bg-amber-100 text-amber-900'
                  : 'border-indigo-300 bg-white text-indigo-800 hover:bg-indigo-50'
              }`}
            >
              {verFoto ? 'Voltando para hoje…' : 'Ver a tela como estava neste dia'}
            </button>
          </div>

          {sumidos.length > 0 && (
            <div className="border-b border-amber-100 bg-amber-50/60 px-5 py-2 text-[11px] text-amber-800">
              {sumidos.length} mês(es) da foto já saíram do horizonte de hoje e não têm com o que comparar: {sumidos.join(', ')}.
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-50 px-4 py-2.5 text-left">Indicador</th>
                  {linhasComuns.map((m) => (
                    <th key={m.mes} className="px-3 py-2.5 text-center whitespace-nowrap">{m.mes}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LINHAS.map((linha) => (
                  <tr key={linha.rotulo} className="border-t border-gray-100">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2 text-left font-semibold text-gray-700">{linha.rotulo}</td>
                    {linhasComuns.map((antes) => {
                      const hoje = porMes.get(antes.mes)!;
                      return (
                        <td key={antes.mes} className="px-3 py-2 text-center font-mono tabular-nums whitespace-nowrap">
                          <div className="text-gray-900">{fmt(linha.get(hoje))}</div>
                          <div className="text-[10px] text-gray-400">era {fmt(linha.get(antes))}</div>
                          <div className="text-[10px] font-semibold">{delta(linha.get(hoje), linha.get(antes), linha.bomSubir)}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-300 bg-gray-50">
                  <td className="sticky left-0 z-10 bg-gray-50 px-4 py-2.5 text-left font-bold text-gray-900">Ocupação acumulada</td>
                  {linhasComuns.map((antes) => {
                    const hoje = porMes.get(antes.mes)!;
                    const a = antes.ocupAcumPlano ?? null;
                    const h = hoje.ocupAcumPlano ?? null;
                    const d = a !== null && h !== null ? (h - a) * 100 : null;
                    return (
                      <td key={antes.mes} className="px-3 py-2.5 text-center font-mono tabular-nums whitespace-nowrap">
                        <div className="font-bold text-gray-900">{pct(h)}</div>
                        <div className="text-[10px] text-gray-400">era {pct(a)}</div>
                        <div className={`text-[10px] font-semibold ${d === null ? 'text-gray-300' : d > 0 ? 'text-red-600' : d < 0 ? 'text-emerald-600' : 'text-gray-300'}`}>
                          {d === null ? '—' : `${d > 0 ? '+' : ''}${d.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.`}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
