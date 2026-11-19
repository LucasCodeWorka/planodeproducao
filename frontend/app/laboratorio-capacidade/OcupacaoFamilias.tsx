'use client';

// OCUPAÇÃO POR FAMÍLIA PELA LISTA — a mesma conta da Ocupação por grupo da Visão Geral 2
// (rota ocupacao-por-grupo-produto, modo lista), lida da distribuição que a aba já calculou.
// Família = o perfil que cada grupo de costura mais faz; demanda = o plano das referências
// cujo grupo A é da família + a carga extra que cai nos grupos dela; capacidade = a única.

type MesFamilia = {
  periodo: string;
  pecas: number;
  cargaAcumMin: number;
  capacidadeMin: number;
  diasDisponiveis: number;
  ocupacao: number | null;
  gapDias: number;
};
export type FamiliaOcupacao = { familia: string; grupos: string[]; capacidadeDiaria: number; meses: MesFamilia[] };

const PERIODOS = ['MA', 'PX', 'UL', 'QT', 'QU', 'SX', 'ST', 'OT', 'NV', 'DZ', 'ON', 'DO', 'DT', 'QZ'];
const MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const ORDEM = ['Sutiã', 'Calcinha', 'Anatomic', 'Noite', 'Outros'];
const COR: Record<string, string> = {
  'Sutiã': 'bg-rose-50 text-rose-800',
  Calcinha: 'bg-sky-50 text-sky-800',
  Anatomic: 'bg-teal-50 text-teal-800',
  Noite: 'bg-violet-50 text-violet-800',
  Outros: 'bg-gray-50 text-gray-700',
};
const curto = (g: string) => (g.includes(' - ') ? g.split(' - ')[1] : g);

function cor(o: number | null) {
  if (o === null) return 'text-gray-300';
  if (o > 1.005) return 'text-red-700 font-semibold';
  if (o >= 0.9) return 'text-amber-700';
  return 'text-emerald-700';
}

export default function OcupacaoFamilias({ familias }: { familias: FamiliaOcupacao[] }) {
  const hoje = new Date();
  const rotulos = PERIODOS.map((_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
    return { ano: d.getFullYear(), rotulo: `${MESES_PT[d.getMonth()]}/${String(d.getFullYear()).slice(2)}` };
  });
  const lista = [...familias].sort((a, b) => ORDEM.indexOf(a.familia) - ORDEM.indexOf(b.familia));
  // Fábrica: soma das famílias, mês a mês.
  const fabrica = PERIODOS.map((_, i) => {
    const carga = lista.reduce((s, f) => s + (f.meses[i]?.cargaAcumMin || 0), 0);
    const cap = lista.reduce((s, f) => s + (f.meses[i]?.capacidadeMin || 0), 0);
    const dias = lista[0]?.meses[i]?.diasDisponiveis || 0;
    const capDia = dias > 0 ? cap / dias : 0;
    return { ocupacao: cap > 0 ? carga / cap : null, gapDias: capDia > 0 ? carga / capDia - dias : 0 };
  });
  const celula = (o: number | null, gap: number, forte = false) => (
    <>
      <div className={`${cor(o)} ${forte ? 'font-bold' : ''}`}>{o === null ? '—' : `${Math.round(o * 100)}%`}</div>
      <div className={`text-[10px] ${gap > 0.05 ? 'text-red-700' : 'text-emerald-700'}`}>{gap > 0 ? '+' : ''}{gap.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}d</div>
    </>
  );

  return (
    <section className="mb-4 rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="font-semibold text-gray-900">Ocupação por família, pela lista</h3>
        <p className="mt-1 text-xs text-gray-500">
          A mesma tabela da Visão Geral 2. Ocupação <strong>acumulada</strong> de cada família: o plano das referências cujo grupo A é dela, mais a carga extra que
          cai nos grupos dela (Liebe Move na LIDERANÇA, edição limitada rateada), contra a capacidade dos grupos dela. Embaixo, os <strong>dias</strong>: positivo = falta
          produção para tantos dias; negativo = sobra.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left">Família</th>
              {rotulos.map((r, i) => <th key={i} className={`px-2 py-2 text-right whitespace-nowrap ${r.ano < hoje.getFullYear() + 1 ? 'text-gray-400' : ''}`}>{r.rotulo}</th>)}
            </tr>
          </thead>
          <tbody>
            {lista.map((f) => (
              <tr key={f.familia} className="border-t border-gray-100">
                <td className={`sticky left-0 z-10 px-3 py-1.5 ${COR[f.familia] || ''}`}>
                  <div className="font-semibold">{f.familia}</div>
                  <div className="text-[10px] opacity-80" title={f.grupos.join(', ')}>
                    {f.grupos.length} grupo{f.grupos.length === 1 ? '' : 's'} · {Math.round(f.capacidadeDiaria).toLocaleString('pt-BR')} min/dia · {f.grupos.map(curto).join(', ')}
                  </div>
                </td>
                {f.meses.map((m, i) => <td key={i} className="px-2 py-1.5 text-right tabular-nums">{celula(m.ocupacao, m.gapDias)}</td>)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50">
              <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2 font-bold">Fábrica</td>
              {fabrica.map((f, i) => <td key={i} className="px-2 py-2 text-right tabular-nums">{celula(f.ocupacao, f.gapDias, true)}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
