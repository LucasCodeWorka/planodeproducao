'use client';

interface KpiData {
  totalSnapshots: number;
  skusAtivos: number;
  variacaoMedia: number;
  tendencia: string;
  qtdTotalAtual: number;
  qtdTotalInicio: number;
}

interface KpiCardsProps {
  data: KpiData;
  loading?: boolean;
}

function fmt(v: number, d = 0) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function tendenciaLabel(t: string) {
  if (t === 'crescente') return { label: 'Crescente', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' };
  if (t === 'decrescente') return { label: 'Decrescente', color: 'text-red-700', bg: 'bg-red-50 border-red-200' };
  return { label: 'Estável', color: 'text-gray-700', bg: 'bg-gray-50 border-gray-200' };
}

export default function KpiCards({ data, loading }: KpiCardsProps) {
  const tendencia = tendenciaLabel(data.tendencia);
  const variacaoAno = data.qtdTotalInicio > 0
    ? ((data.qtdTotalAtual - data.qtdTotalInicio) / data.qtdTotalInicio) * 100
    : 0;

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-lg border border-gray-200 bg-white p-4 animate-pulse">
            <div className="h-3 w-20 bg-gray-200 rounded mb-2" />
            <div className="h-7 w-16 bg-gray-200 rounded mb-1" />
            <div className="h-3 w-24 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">Snapshots no Ano</div>
        <div className="text-2xl font-bold text-gray-900">{fmt(data.totalSnapshots)}</div>
        <div className="text-xs text-gray-500">registros coletados</div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">SKUs Ativos</div>
        <div className="text-2xl font-bold text-gray-900">{fmt(data.skusAtivos)}</div>
        <div className="text-xs text-gray-500">no último snapshot</div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">Variação Média</div>
        <div className={`text-2xl font-bold ${data.variacaoMedia >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
          {data.variacaoMedia >= 0 ? '+' : ''}{fmt(data.variacaoMedia, 1)}%
        </div>
        <div className="text-xs text-gray-500">entre snapshots</div>
      </div>

      <div className={`rounded-lg border p-4 ${tendencia.bg}`}>
        <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">Tendência</div>
        <div className={`text-2xl font-bold ${tendencia.color}`}>{tendencia.label}</div>
        <div className="text-xs text-gray-500">
          {variacaoAno >= 0 ? '+' : ''}{fmt(variacaoAno, 1)}% no ano
        </div>
      </div>
    </div>
  );
}
