'use client';

import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface SnapshotPosicao {
  skus: number;
  qtd: number;
  novos: number;
  zerados: number;
  aumentos: number;
  reducoes: number;
}

interface SnapshotData {
  data: string;
  posicoes: Record<string, SnapshotPosicao>;
  mesCompetencia: Record<string, string>;
  totalQtd: number;
}

interface EvolucaoChartProps {
  snapshots: SnapshotData[];
  periodoSelecionado: string | null;
  loading?: boolean;
}

const CORES = {
  MA: '#3b82f6', // blue
  PX: '#22c55e', // green
  UL: '#f97316', // orange
  QT: '#8b5cf6', // purple
  QU: '#ec4899', // pink
};

const PERIODOS = ['MA', 'PX', 'UL', 'QT', 'QU'] as const;

function fmtDate(value: string) {
  const [, month, day] = value.split('-');
  return `${day}/${month}`;
}

function fmt(v: number) {
  return Number(v || 0).toLocaleString('pt-BR');
}

export default function EvolucaoChart({ snapshots, periodoSelecionado, loading }: EvolucaoChartProps) {
  const chartData = useMemo(() => {
    return snapshots.map((snap) => {
      const row: Record<string, number | string> = { data: fmtDate(snap.data), dataFull: snap.data };
      for (const periodo of PERIODOS) {
        row[periodo] = snap.posicoes[periodo]?.qtd || 0;
        row[`${periodo}_skus`] = snap.posicoes[periodo]?.skus || 0;
        row[`${periodo}_mes`] = snap.mesCompetencia[periodo] || '';
      }
      row.total = snap.totalQtd;
      return row;
    });
  }, [snapshots]);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="h-4 w-48 bg-gray-200 rounded mb-4 animate-pulse" />
        <div className="h-64 bg-gray-100 rounded animate-pulse" />
      </div>
    );
  }

  if (!snapshots.length) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 text-center text-gray-500">
        Sem dados para exibir o gráfico.
      </div>
    );
  }

  const periodosVisiveis = periodoSelecionado ? [periodoSelecionado] : PERIODOS;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-sm font-bold text-gray-800">Evolução por Posição</div>
          <div className="text-xs text-gray-500">Quantidade planejada ao longo do ano</div>
        </div>
        <div className="flex gap-2">
          {PERIODOS.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 text-[10px] font-medium"
              style={{ color: CORES[p] }}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CORES[p] }} />
              {p}
            </span>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="data"
            tick={{ fontSize: 10, fill: '#6b7280' }}
            tickLine={{ stroke: '#e5e7eb' }}
            axisLine={{ stroke: '#e5e7eb' }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#6b7280' }}
            tickLine={{ stroke: '#e5e7eb' }}
            axisLine={{ stroke: '#e5e7eb' }}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
          />
          <Tooltip
            contentStyle={{ fontSize: 11, backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 }}
            formatter={(value, name, props) => {
              const periodo = String(name);
              const mesKey = `${periodo}_mes`;
              const skusKey = `${periodo}_skus`;
              const mes = props.payload?.[mesKey] || '';
              const skus = props.payload?.[skusKey] || 0;
              const valorFormatado = fmt(Number(value) || 0);
              return [`${valorFormatado} peças (${skus} SKUs)${mes ? ` - ${mes}` : ''}`, periodo];
            }}
            labelFormatter={(label) => `Snapshot: ${label}`}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            iconType="circle"
            iconSize={8}
          />
          {periodosVisiveis.map((periodo) => (
            <Line
              key={periodo}
              type="monotone"
              dataKey={periodo}
              stroke={CORES[periodo as keyof typeof CORES]}
              strokeWidth={2}
              dot={{ r: 2 }}
              activeDot={{ r: 4 }}
              name={periodo}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
