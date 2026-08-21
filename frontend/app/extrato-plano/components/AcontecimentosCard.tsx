'use client';

interface Acontecimento {
  data: string;
  tipo: 'NOVOS' | 'ZERADOS' | 'AUMENTO' | 'REDUCAO';
  periodo: string;
  mesCompetencia: string;
  valor: number;
  qtd: number;
  descricao: string;
}

interface AcontecimentosCardProps {
  acontecimentos: Acontecimento[];
  loading?: boolean;
  maxItems?: number;
}

function fmtDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}/${month}`;
}

function fmt(v: number) {
  return Number(v || 0).toLocaleString('pt-BR');
}

function tipoIcon(tipo: Acontecimento['tipo']) {
  switch (tipo) {
    case 'NOVOS':
      return { icon: '+', color: 'text-emerald-600 bg-emerald-100 border-emerald-200' };
    case 'ZERADOS':
      return { icon: '0', color: 'text-red-600 bg-red-100 border-red-200' };
    case 'AUMENTO':
      return { icon: '↑', color: 'text-blue-600 bg-blue-100 border-blue-200' };
    case 'REDUCAO':
      return { icon: '↓', color: 'text-orange-600 bg-orange-100 border-orange-200' };
    default:
      return { icon: '?', color: 'text-gray-600 bg-gray-100 border-gray-200' };
  }
}

export default function AcontecimentosCard({ acontecimentos, loading, maxItems = 10 }: AcontecimentosCardProps) {
  const items = acontecimentos.slice(0, maxItems);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="px-4 py-3 border-b border-gray-200">
          <div className="h-4 w-48 bg-gray-200 rounded animate-pulse" />
        </div>
        <div className="p-4 space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-start gap-3 animate-pulse">
              <div className="w-6 h-6 rounded-full bg-gray-200" />
              <div className="flex-1">
                <div className="h-3 w-full bg-gray-200 rounded mb-1" />
                <div className="h-3 w-24 bg-gray-100 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!acontecimentos.length) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="px-4 py-3 border-b border-gray-200">
          <div className="text-sm font-bold text-gray-800">Principais Acontecimentos</div>
        </div>
        <div className="p-4 text-center text-gray-500 text-sm">
          Nenhum acontecimento relevante no período.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div className="text-sm font-bold text-gray-800">Principais Acontecimentos</div>
        <div className="text-xs text-gray-500">{acontecimentos.length} eventos</div>
      </div>
      <div className="divide-y divide-gray-100 max-h-[400px] overflow-y-auto">
        {items.map((item, idx) => {
          const { icon, color } = tipoIcon(item.tipo);
          return (
            <div key={`${item.data}-${item.tipo}-${item.periodo}-${idx}`} className="px-4 py-3 flex items-start gap-3 hover:bg-gray-50">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${color}`}>
                {icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-800">{item.descricao}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-gray-500">{fmtDate(item.data)}</span>
                  <span className="text-[10px] text-gray-400">|</span>
                  <span className="text-[10px] font-medium text-gray-600">{item.periodo}</span>
                  <span className="text-[10px] text-gray-400">({item.mesCompetencia})</span>
                  {item.qtd > 0 && (
                    <>
                      <span className="text-[10px] text-gray-400">|</span>
                      <span className="text-[10px] text-gray-500">{fmt(item.qtd)} peças</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {acontecimentos.length > maxItems && (
        <div className="px-4 py-2 border-t border-gray-100 text-center">
          <span className="text-xs text-gray-500">+{acontecimentos.length - maxItems} mais eventos</span>
        </div>
      )}
    </div>
  );
}
