import { Planejamento } from '../types';

interface Props {
  planejamentos: Planejamento[];
}

export default function PlanejamentoTable({ planejamentos }: Props) {
  const getPrioridadeBadge = (prioridade: string) => {
    const classes = {
      ALTA: 'bg-red-100 text-red-800 border-red-200',
      MEDIA: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      BAIXA: 'bg-green-100 text-green-800 border-green-200',
    };

    const icons = {
      ALTA: '🔴',
      MEDIA: '🟡',
      BAIXA: '🟢',
    };

    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${classes[prioridade as keyof typeof classes]}`}>
        <span>{icons[prioridade as keyof typeof icons]}</span>
        {prioridade}
      </span>
    );
  };

  const getSituacaoBadge = (situacao: string) => {
    if (situacao === 'PRODUZIR') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 border border-orange-200">
          ⚠️ PRODUZIR
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
        ✅ OK
      </span>
    );
  };

  const formatNumber = (num: number) => {
    return Math.round(num).toLocaleString('pt-BR');
  };

  if (planejamentos.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-12 text-center">
        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900">Nenhum produto encontrado</h3>
        <p className="mt-1 text-sm text-gray-500">
          Tente ajustar os filtros ou aguarde o carregamento dos dados.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Produto
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Cor/Tam
              </th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Estoque Atual
              </th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Em Processo
              </th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Estoque Mín
              </th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Pedidos Pend.
              </th>
              <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Produzir
              </th>
              <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                Situação
              </th>
              <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                Prioridade
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {planejamentos.map((item, index) => (
              <tr
                key={`${item.produto.idproduto}-${index}`}
                className={`hover:bg-gray-50 transition-colors ${
                  item.planejamento.prioridade === 'ALTA' ? 'bg-red-50' : ''
                }`}
              >
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex flex-col">
                    <div className="text-sm font-medium text-gray-900">
                      {item.produto.apresentacao?.substring(0, 50)}
                      {item.produto.apresentacao?.length > 50 && '...'}
                    </div>
                    <div className="text-xs text-gray-500">
                      ID: {item.produto.idproduto} | Ref: {item.produto.referencia || 'N/A'}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{item.produto.cor || '-'}</div>
                  <div className="text-xs text-gray-500">{item.produto.tamanho || '-'}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900 font-medium">
                  {formatNumber(item.estoques.estoque_atual)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-blue-600 font-medium">
                  {formatNumber(item.estoques.em_processo)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-purple-600 font-medium">
                  {formatNumber(item.estoques.estoque_minimo)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-orange-600 font-medium">
                  {formatNumber(item.demanda.pedidos_pendentes)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  {item.planejamento.necessidade_producao > 0 ? (
                    <span className="text-sm font-bold text-red-600">
                      {formatNumber(item.planejamento.necessidade_producao)}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-400">-</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-center">
                  {getSituacaoBadge(item.planejamento.situacao)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-center">
                  {getPrioridadeBadge(item.planejamento.prioridade)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Resumo */}
      <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
        <div className="text-sm text-gray-600">
          Exibindo <span className="font-medium text-gray-900">{planejamentos.length}</span> produtos
        </div>
      </div>
    </div>
  );
}
