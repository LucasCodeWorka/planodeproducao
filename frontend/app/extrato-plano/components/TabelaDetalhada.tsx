'use client';

import { useMemo, useState } from 'react';

interface SnapshotPosicao {
  skus: number;
  qtd: number;
  novos: number;
  zerados: number;
  aumentos: number;
  reducoes: number;
  qtdNovos: number;
  qtdZerados: number;
  qtdAumentos: number;
  qtdReducoes: number;
}

interface SnapshotData {
  data: string;
  posicoes: Record<string, SnapshotPosicao>;
  mesCompetencia: Record<string, string>;
  totalSkus: number;
  totalQtd: number;
  variacao: number;
}

interface TabelaDetalhadaProps {
  snapshots: SnapshotData[];
  loading?: boolean;
}

const PERIODOS = ['MA', 'PX', 'UL', 'QT', 'QU'] as const;

function fmtDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year.slice(2)}`;
}

function fmt(v: number) {
  return Number(v || 0).toLocaleString('pt-BR');
}

export default function TabelaDetalhada({ snapshots, loading }: TabelaDetalhadaProps) {
  const [periodoFiltro, setPeriodoFiltro] = useState<string>('TODOS');
  const [statusFiltro, setStatusFiltro] = useState<string>('TODOS');

  const rows = useMemo(() => {
    const result: Array<{
      data: string;
      periodo: string;
      mesCompetencia: string;
      skus: number;
      qtd: number;
      novos: number;
      zerados: number;
      aumentos: number;
      reducoes: number;
      qtdNovos: number;
      qtdZerados: number;
      qtdAumentos: number;
      qtdReducoes: number;
    }> = [];

    for (const snap of snapshots) {
      for (const periodo of PERIODOS) {
        const pos = snap.posicoes[periodo];
        if (!pos) continue;

        // Aplicar filtro de período
        if (periodoFiltro !== 'TODOS' && periodo !== periodoFiltro) continue;

        // Aplicar filtro de status
        if (statusFiltro === 'NOVOS' && pos.novos === 0) continue;
        if (statusFiltro === 'ZERADOS' && pos.zerados === 0) continue;
        if (statusFiltro === 'AUMENTOS' && pos.aumentos === 0) continue;
        if (statusFiltro === 'REDUCOES' && pos.reducoes === 0) continue;

        result.push({
          data: snap.data,
          periodo,
          mesCompetencia: snap.mesCompetencia[periodo] || '',
          skus: pos.skus,
          qtd: pos.qtd,
          novos: pos.novos,
          zerados: pos.zerados,
          aumentos: pos.aumentos,
          reducoes: pos.reducoes,
          qtdNovos: pos.qtdNovos,
          qtdZerados: pos.qtdZerados,
          qtdAumentos: pos.qtdAumentos,
          qtdReducoes: pos.qtdReducoes,
        });
      }
    }

    return result.sort((a, b) => b.data.localeCompare(a.data));
  }, [snapshots, periodoFiltro, statusFiltro]);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <div className="h-4 w-48 bg-gray-200 rounded animate-pulse" />
        </div>
        <div className="p-4 space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-bold text-gray-800">Detalhamento por Snapshot</div>
        <div className="flex gap-3">
          <select
            value={periodoFiltro}
            onChange={(e) => setPeriodoFiltro(e.target.value)}
            className="border rounded px-2 py-1 text-xs"
          >
            <option value="TODOS">Todos períodos</option>
            {PERIODOS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value)}
            className="border rounded px-2 py-1 text-xs"
          >
            <option value="TODOS">Todos status</option>
            <option value="NOVOS">Com novos</option>
            <option value="ZERADOS">Com zerados</option>
            <option value="AUMENTOS">Com aumentos</option>
            <option value="REDUCOES">Com reduções</option>
          </select>
        </div>
      </div>
      <div className="overflow-auto max-h-[500px]">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-slate-100 text-slate-700">
            <tr>
              <th className="text-left px-3 py-2">Data</th>
              <th className="text-left px-3 py-2">Período</th>
              <th className="text-left px-3 py-2">Mês Comp.</th>
              <th className="text-right px-3 py-2">SKUs</th>
              <th className="text-right px-3 py-2">Qtd Total</th>
              <th className="text-right px-3 py-2 text-emerald-700">Novos</th>
              <th className="text-right px-3 py-2 text-red-700">Zerados</th>
              <th className="text-right px-3 py-2 text-blue-700">Aumentos</th>
              <th className="text-right px-3 py-2 text-orange-700">Reduções</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={`${row.data}-${row.periodo}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} border-t border-gray-100`}>
                <td className="px-3 py-2 font-medium">{fmtDate(row.data)}</td>
                <td className="px-3 py-2 font-bold">{row.periodo}</td>
                <td className="px-3 py-2 text-gray-600">{row.mesCompetencia}</td>
                <td className="px-3 py-2 text-right">{fmt(row.skus)}</td>
                <td className="px-3 py-2 text-right font-medium">{fmt(row.qtd)}</td>
                <td className="px-3 py-2 text-right">
                  {row.novos > 0 && (
                    <span className="text-emerald-700">
                      {fmt(row.novos)} <span className="text-[10px] text-gray-400">({fmt(row.qtdNovos)})</span>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {row.zerados > 0 && (
                    <span className="text-red-700">
                      {fmt(row.zerados)} <span className="text-[10px] text-gray-400">({fmt(row.qtdZerados)})</span>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {row.aumentos > 0 && (
                    <span className="text-blue-700">
                      {fmt(row.aumentos)} <span className="text-[10px] text-gray-400">(+{fmt(row.qtdAumentos)})</span>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {row.reducoes > 0 && (
                    <span className="text-orange-700">
                      {fmt(row.reducoes)} <span className="text-[10px] text-gray-400">(-{fmt(row.qtdReducoes)})</span>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-gray-500">
                  Nenhum registro encontrado para os filtros selecionados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-500">
          {fmt(rows.length)} registros
        </div>
      )}
    </div>
  );
}
