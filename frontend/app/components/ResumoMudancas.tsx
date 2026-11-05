'use client';

import type { MesCapacidadeVenda } from './CapacidadeVsVenda';

// O QUE MUDOU, EM TEXTO.
//
// A marca celula a celula diz ONDE mudou, mas obriga a varrer a tabela inteira para montar
// a historia. Quem abre uma foto quer a frase: "a capacidade subiu em novembro e dezembro,
// fevereiro perdeu 4 dias de ferias, e a ocupacao acumulada subiu de fevereiro em diante".
//
// So fala do que REALMENTE mudou. Linha sem diferenca nao vira frase — um resumo que lista
// tudo, inclusive o que ficou igual, tem o mesmo problema da tabela crua.

type Props = {
  foto: MesCapacidadeVenda[];
  hoje: MesCapacidadeVenda[];
  parametrosFoto: Record<string, unknown>;
  parametrosHoje: Record<string, unknown>;
  nomeFoto: string;
};

type Medida = {
  rotulo: string;
  get: (m: MesCapacidadeVenda) => number | null;
  /** Como escrever a diferenca. Dias e pontos percentuais nao se escrevem como pecas. */
  unidade?: 'peca' | 'dia' | 'pp';
  /** Subir e bom? Governa a cor, nao o texto. */
  bomSubir: boolean;
};

const MEDIDAS: Medida[] = [
  { rotulo: 'Capacidade', get: (m) => m.capacidadePecas, unidade: 'peca', bomSubir: true },
  { rotulo: 'Venda projetada', get: (m) => m.demanda + Number(m.demandaEl || 0), unidade: 'peca', bomSubir: true },
  { rotulo: 'Plano lançado', get: (m) => Number(m.planoCompleto || 0), unidade: 'peca', bomSubir: true },
  { rotulo: 'Em processo', get: (m) => Number(m.emProcessoMes || 0), unidade: 'peca', bomSubir: true },
  { rotulo: 'Dias de fábrica', get: (m) => m.diasDisponiveis, unidade: 'dia', bomSubir: true },
  { rotulo: 'Dias necessários', get: (m) => m.diasNecessarios, unidade: 'dia', bomSubir: false },
  { rotulo: 'Ocupação acumulada', get: (m) => (m.ocupAcumPlano ?? null), unidade: 'pp', bomSubir: false },
];

function escreve(d: number, unidade: Medida['unidade']) {
  const sinal = d > 0 ? '+' : '−';
  const v = Math.abs(d);
  if (unidade === 'dia') return `${sinal}${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}d`;
  if (unidade === 'pp') return `${sinal}${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.`;
  return `${sinal}${Math.round(v).toLocaleString('pt-BR')}`;
}

// Diferenca pequena demais nao e noticia: arredondamento de peca, meio dia de calendario,
// meio ponto de ocupacao. Sem este corte o resumo vira ruido e ninguem le.
function relevante(d: number, unidade: Medida['unidade']) {
  if (unidade === 'dia') return Math.abs(d) >= 0.5;
  if (unidade === 'pp') return Math.abs(d) >= 0.005;
  return Math.abs(d) >= 1;
}

export default function ResumoMudancas({ foto, hoje, parametrosFoto, parametrosHoje, nomeFoto }: Props) {
  const porMes = new Map(hoje.map((m) => [m.mes, m]));

  // PARAMETROS primeiro: eles explicam as linhas. Fevereiro perder 4 dias so faz sentido
  // depois de saber que a foto estava com ferias ligadas e hoje nao.
  const difParam: string[] = [];
  const fFerias = Boolean(parametrosFoto.comFerias);
  const hFerias = Boolean(parametrosHoje.comFerias);
  if (fFerias !== hFerias) {
    difParam.push(`Férias coletivas: ${fFerias ? 'ligadas' : 'desligadas'} na foto, ${hFerias ? 'ligadas' : 'desligadas'} hoje`);
  }
  const fCap = Number(parametrosFoto.capacidadeDiaria || 0);
  const hCap = Number(parametrosHoje.capacidadeDiaria || 0);
  if (fCap > 0 && hCap > 0 && Math.abs(fCap - hCap) >= 1) {
    difParam.push(`Capacidade da fábrica: ${Math.round(fCap).toLocaleString('pt-BR')} → ${Math.round(hCap).toLocaleString('pt-BR')} min/dia`);
  }
  const fCresc = Number(parametrosFoto.cenarioFabrica || 0);
  const hCresc = Number(parametrosHoje.cenarioFabrica || 0);
  if (fCresc !== hCresc) {
    difParam.push(`Cenário de fábrica: ${Math.round(fCresc * 100)}% → ${Math.round(hCresc * 100)}%`);
  }
  const fMin = Number(parametrosFoto.minPecaMedido || 0);
  const hMin = Number(parametrosHoje.minPecaMedido || 0);
  if (fMin > 0 && hMin > 0 && Math.abs(fMin - hMin) >= 0.01) {
    difParam.push(`Min/peça medido: ${fMin.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} → ${hMin.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}`);
  }

  const linhas = MEDIDAS.map((med) => {
    const itens = foto
      .map((f) => {
        const h = porMes.get(f.mes);
        if (!h) return null;
        const a = med.get(f);
        const b = med.get(h);
        if (a === null || b === null) return null;
        const d = b - a;
        return relevante(d, med.unidade) ? { mes: f.mes, d } : null;
      })
      .filter((x): x is { mes: string; d: number } => x !== null);
    return { med, itens };
  }).filter((x) => x.itens.length > 0);

  const sumidos = foto.filter((f) => !porMes.has(f.mes)).map((f) => f.mes);
  const nadaMudou = !linhas.length && !difParam.length;

  return (
    <div className="mb-6 rounded-lg border border-fuchsia-200 bg-fuchsia-50/40">
      <div className="border-b border-fuchsia-100 px-5 py-3">
        <h2 className="font-semibold text-gray-900">O que mudou desde “{nomeFoto}”</h2>
        <p className="text-xs text-gray-500">
          Só o que de fato diferiu. Mês sem diferença não aparece.
        </p>
      </div>

      <div className="space-y-3 px-5 py-4 text-sm">
        {nadaMudou && (
          <p className="text-gray-500">
            Nada mudou entre a foto e hoje — nem nos parâmetros, nem em nenhum mês do horizonte.
          </p>
        )}

        {difParam.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-fuchsia-700">Parâmetros</div>
            <ul className="space-y-0.5">
              {difParam.map((t) => (
                <li key={t} className="text-gray-800">· {t}</li>
              ))}
            </ul>
          </div>
        )}

        {linhas.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-fuchsia-700">Números</div>
            <ul className="space-y-1">
              {linhas.map(({ med, itens }) => (
                <li key={med.rotulo} className="text-gray-800">
                  <span className="font-semibold">{med.rotulo}</span>
                  <span className="text-gray-500"> mudou em {itens.length} {itens.length === 1 ? 'mês' : 'meses'}: </span>
                  {itens.map((it, i) => {
                    const bom = med.bomSubir ? it.d > 0 : it.d < 0;
                    return (
                      <span key={it.mes}>
                        {i > 0 && <span className="text-gray-400">, </span>}
                        <span className="text-gray-600">{it.mes} </span>
                        <span className={`font-mono font-semibold ${bom ? 'text-emerald-700' : 'text-red-700'}`}>
                          {escreve(it.d, med.unidade)}
                        </span>
                      </span>
                    );
                  })}
                </li>
              ))}
            </ul>
          </div>
        )}

        {sumidos.length > 0 && (
          <p className="text-[11px] text-amber-800">
            {sumidos.length} mês(es) da foto já saíram do horizonte e não entram na conta: {sumidos.join(', ')}.
          </p>
        )}
      </div>
    </div>
  );
}
