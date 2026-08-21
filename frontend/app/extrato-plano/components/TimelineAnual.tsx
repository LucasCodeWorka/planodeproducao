'use client';

import { useMemo } from 'react';

interface SnapshotData {
  data: string;
  totalSkus: number;
  totalQtd: number;
  variacao: number;
}

interface TimelineAnualProps {
  snapshots: SnapshotData[];
  selectedDate: string | null;
  onSelectDate: (data: string) => void;
  loading?: boolean;
}

function fmtDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}/${month}`;
}

function fmtMonth(value: string) {
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const [, month] = value.split('-');
  return meses[parseInt(month, 10) - 1] || '';
}

export default function TimelineAnual({ snapshots, selectedDate, onSelectDate, loading }: TimelineAnualProps) {
  // Agrupar por mês
  const meses = useMemo(() => {
    const grupos: Record<string, SnapshotData[]> = {};
    for (const snap of snapshots) {
      const key = snap.data.slice(0, 7); // YYYY-MM
      if (!grupos[key]) grupos[key] = [];
      grupos[key].push(snap);
    }
    return Object.entries(grupos).sort((a, b) => a[0].localeCompare(b[0]));
  }, [snapshots]);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="h-4 w-40 bg-gray-200 rounded mb-3 animate-pulse" />
        <div className="flex gap-2 overflow-x-auto">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-16 w-24 bg-gray-100 rounded animate-pulse flex-shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  if (!snapshots.length) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 text-center text-gray-500">
        Nenhum snapshot encontrado para o ano selecionado.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-sm font-bold text-gray-800 mb-3">Timeline de Snapshots</div>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {meses.map(([mesKey, snaps]) => (
          <div key={mesKey} className="flex-shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2 text-center">
              {fmtMonth(snaps[0].data)}
            </div>
            <div className="flex gap-1">
              {snaps.map((snap) => {
                const isSelected = snap.data === selectedDate;
                const varClass = snap.variacao > 0 ? 'bg-emerald-500' : snap.variacao < 0 ? 'bg-red-500' : 'bg-gray-400';
                return (
                  <button
                    key={snap.data}
                    type="button"
                    onClick={() => onSelectDate(snap.data)}
                    title={`${fmtDate(snap.data)} - ${snap.totalSkus} SKUs, ${snap.totalQtd.toLocaleString('pt-BR')} peças, ${snap.variacao >= 0 ? '+' : ''}${snap.variacao}%`}
                    className={`relative w-3 h-12 rounded-sm transition-all ${isSelected ? 'ring-2 ring-brand-primary ring-offset-1' : 'hover:ring-1 hover:ring-gray-300'}`}
                  >
                    <div className={`absolute inset-0 rounded-sm ${varClass} opacity-${Math.min(100, Math.abs(snap.variacao * 10))}`} />
                    <div className={`absolute inset-0 rounded-sm ${isSelected ? 'bg-brand-primary' : 'bg-gray-200'}`} style={{ opacity: isSelected ? 1 : 0.3 }} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-4 mt-3 text-[10px] text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-500" /> Aumento
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500" /> Redução
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-gray-400" /> Estável
        </span>
      </div>
    </div>
  );
}
