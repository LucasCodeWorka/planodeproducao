'use client';

import { Factory } from 'lucide-react';

// Painel de carga x capacidade, compartilhado entre a Reducao de Plano e a Visao Geral.
// A conta vem pronta de quem chama; o que este componente acrescenta e a leitura ACUMULADA —
// o que nao cabe num periodo transborda para o seguinte, entao gap e ocupacao isolados por
// mes enganam.
//
// Duas variantes porque as telas tem densidades diferentes: "compacto" para a Reducao de
// Plano, que empilha varios blocos, e "amplo" no padrao visual da Visao Geral.

export type ResumoDiasCapacidade = {
  capacidadeDiaria: number;
  diasNecessarios: Partial<Record<string, number>>;
  diasDisponiveis: Partial<Record<string, number>>;
};

type Props = {
  resumo: ResumoDiasCapacidade | null;
  /** Periodos a exibir, em ordem cronologica. */
  periodos: readonly string[];
  /** Minutos de carga retirados por periodo. Sem isto o painel mostra so a situacao atual. */
  cargaRetirada?: Partial<Record<string, number>>;
  /** Periodos fora do corte, marcados com cadeado. */
  bloqueado?: (periodo: string) => boolean;
  rotulo?: (periodo: string) => string;
  titulo?: string;
  /** Substitui a explicacao de origem dos numeros no rodape. */
  nota?: string;
  variante?: 'compacto' | 'amplo';
};

function fmtInt(v: number) {
  return Math.round(v || 0).toLocaleString('pt-BR');
}

function fmtDias(v: number) {
  return v.toFixed(1).replace('.', ',');
}

function fmtSinal(v: number) {
  return `${v > 0 ? '+' : ''}${fmtDias(v)}`;
}

type Linha = {
  periodo: string;
  diasDisponiveis: number;
  diasAtual: number;
  diasRetirados: number;
  diasNovo: number;
  gapAtual: number;
  gapNovo: number;
  ocupAtual: number;
  ocupNova: number;
};

type LinhaDef = {
  rotulo: string;
  rotuloClasse?: string;
  fundo?: string;
  celula: (l: Linha) => React.ReactNode;
};

export default function PainelCapacidade({
  resumo,
  periodos,
  cargaRetirada,
  bloqueado,
  rotulo,
  titulo,
  nota,
  variante = 'compacto',
}: Props) {
  const capDiaria = Number(resumo?.capacidadeDiaria || 0);
  if (!resumo || capDiaria <= 0) return null;

  const amplo = variante === 'amplo';
  const s = amplo
    ? {
        wrapper: 'bg-white border border-gray-200 rounded-lg mb-6 overflow-hidden',
        header: 'px-5 py-4 border-b flex items-center justify-between gap-2',
        titulo: 'font-semibold text-gray-900',
        sub: 'text-xs text-gray-500',
        tabela: 'w-full text-sm',
        thead: 'bg-gray-50 text-xs uppercase',
        th: 'px-4 py-3 text-center font-bold text-gray-700',
        thPrimeira: 'px-4 py-3 text-left text-gray-700',
        td: 'px-4 py-3 text-center font-mono',
        tdRotulo: 'px-4 py-3 text-left text-gray-600',
        linha: 'border-t border-gray-100',
        rodape: 'px-5 py-3 border-t text-xs text-gray-500',
      }
    : {
        wrapper: 'bg-gradient-to-r from-amber-50 to-orange-50 rounded border border-amber-300 p-2 mb-3',
        header: 'flex items-center justify-between mb-1',
        titulo: 'text-[11px] font-bold text-amber-800',
        sub: 'text-[9px] text-amber-700',
        tabela: 'w-full text-[11px]',
        thead: '',
        th: 'py-0.5 px-1 text-center text-amber-700 font-bold',
        thPrimeira: 'py-0.5 px-1 text-left text-amber-700',
        td: 'py-0.5 px-1 text-center font-mono',
        tdRotulo: 'py-0.5 px-1 text-left text-gray-600',
        linha: 'border-b border-amber-200',
        rodape: 'text-[9px] text-amber-700 mt-1',
      };

  const temReducao = Boolean(cargaRetirada);
  let necAcum = 0;
  let novoAcum = 0;
  let dispAcum = 0;
  const linhas = periodos.map((p) => {
    const diasDisponiveis = Number(resumo.diasDisponiveis?.[p] || 0);
    const diasAtual = Number(resumo.diasNecessarios?.[p] || 0);
    const diasRetirados = Number(cargaRetirada?.[p] || 0) / capDiaria;
    const diasNovo = Math.max(0, diasAtual - diasRetirados);
    necAcum += diasAtual;
    novoAcum += diasNovo;
    dispAcum += diasDisponiveis;
    return {
      periodo: p,
      diasDisponiveis,
      diasAtual,
      diasRetirados,
      diasNovo,
      gapAtual: necAcum - dispAcum,
      gapNovo: novoAcum - dispAcum,
      ocupAtual: dispAcum > 0 ? necAcum / dispAcum : 0,
      ocupNova: dispAcum > 0 ? novoAcum / dispAcum : 0,
    };
  });

  const corOcupacao = (v: number) => (v > 1 ? 'text-red-700' : v >= 0.85 ? 'text-emerald-700' : 'text-amber-700');
  // Zebra so na variante ampla: a compacta ja tem fundo em degrade e ficaria suja.
  const zebra = (i: number) => (amplo && i % 2 === 1 ? 'bg-gray-50' : '');
  const tituloTexto = titulo || 'Capacidade (carga x capacidade do período)';
  const subTexto = `Capac. diária ${fmtInt(capDiaria)} min · plano total, sem filtros de tela`;

  return (
    <div className={s.wrapper}>
      <div className={s.header}>
        {amplo ? (
          <div className="flex items-center gap-2">
            <Factory size={18} className="text-slate-600" />
            <div>
              <h2 className={s.titulo}>{tituloTexto}</h2>
              <p className={s.sub}>{subTexto}</p>
            </div>
          </div>
        ) : (
          <>
            <span className={s.titulo}>🏭 {tituloTexto}</span>
            <span className={s.sub}>{subTexto}</span>
          </>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className={s.tabela}>
          <thead className={s.thead}>
            <tr className={amplo ? '' : 'border-b border-amber-300'}>
              <th className={s.thPrimeira}></th>
              {linhas.map((l) => (
                <th key={l.periodo} className={s.th}>
                  {rotulo ? rotulo(l.periodo) : l.periodo}
                  {bloqueado?.(l.periodo) ? ' 🔒' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {([
              {
                rotulo: 'Dias disponíveis',
                celula: (l) => <span className="text-gray-700">{l.diasDisponiveis.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</span>,
              },
              {
                rotulo: `Dias necessários${temReducao ? ' (atual)' : ''}`,
                celula: (l) => <span className="text-gray-700">{fmtDias(l.diasAtual)}</span>,
              },
              ...(temReducao
                ? [
                    {
                      rotulo: 'Dias tirados pela redução',
                      celula: (l: Linha) => (
                        <span className="text-red-600">{l.diasRetirados > 0 ? `-${fmtDias(l.diasRetirados)}` : '-'}</span>
                      ),
                    },
                    {
                      rotulo: 'Dias necessários (novo)',
                      fundo: 'bg-red-50',
                      rotuloClasse: 'text-red-700',
                      celula: (l: Linha) => <span className="text-red-700 font-semibold">{fmtDias(l.diasNovo)}</span>,
                    },
                  ]
                : []),
              {
                rotulo: 'Gap acumulado (dias)',
                rotuloClasse: 'font-semibold',
                celula: (l) =>
                  temReducao ? (
                    <>
                      <span className="text-gray-500">{fmtSinal(l.gapAtual)}</span>
                      <span className="text-gray-400 mx-1">→</span>
                      <span className={`font-bold ${l.gapNovo > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                        {fmtSinal(l.gapNovo)}
                      </span>
                    </>
                  ) : (
                    <span className={`font-bold ${l.gapAtual > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                      {fmtSinal(l.gapAtual)}
                    </span>
                  ),
              },
              {
                rotulo: 'Ocupação acumulada',
                rotuloClasse: 'font-semibold',
                celula: (l) =>
                  temReducao ? (
                    <>
                      <span className="text-gray-500">{Math.round(l.ocupAtual * 100)}%</span>
                      <span className="text-gray-400 mx-1">→</span>
                      <span className={`font-bold ${corOcupacao(l.ocupNova)}`}>{Math.round(l.ocupNova * 100)}%</span>
                    </>
                  ) : (
                    <span className={`font-bold ${corOcupacao(l.ocupAtual)}`}>{Math.round(l.ocupAtual * 100)}%</span>
                  ),
              },
            ] as LinhaDef[]).map((def, i) => (
              <tr key={def.rotulo} className={`${s.linha} ${def.fundo || zebra(i)}`}>
                <td className={`${s.tdRotulo} ${def.rotuloClasse || ''}`}>{def.rotulo}</td>
                {linhas.map((l) => (
                  <td key={l.periodo} className={`${s.td} whitespace-nowrap`}>
                    {def.celula(l)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={s.rodape}>
        {bloqueado ? '🔒 = período fora do corte: continua na conta acumulada, mas o plano dele não é tocado. ' : ''}
        ⚠️ Gap e ocupação são <strong>acumulados</strong>: o que não cabe num período transborda para o
        seguinte. Gap positivo = estourado · ocupação verde 85-100% (fábrica cheia) · amarelo = ociosa.
        {' '}
        {nota || (
          <>
            Mesmo cálculo da tela de Capacidade, sobre o plano total (MA inclui o em-processo)
            {temReducao ? '; a redução é descontada por cima, ponderada pelo tempo de costura.' : '.'}
          </>
        )}
      </div>
    </div>
  );
}
