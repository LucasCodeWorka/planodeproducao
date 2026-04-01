'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';
import { EstoqueLojaDisponivelDetalhe } from '../types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const ITENS_POR_PAGINA = 100;

type LojaResumo = {
  cd_empresa: number;
  nm_grupoempresa?: string;
  cidade?: string | null;
};

function fmt(v: number) {
  return Number(v || 0).toLocaleString('pt-BR');
}

export default function EstoqueLojaDisponivelPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [itens, setItens] = useState<EstoqueLojaDisponivelDetalhe[]>([]);
  const [lojas, setLojas] = useState<LojaResumo[]>([]);
  const [filtroProduto, setFiltroProduto] = useState('');
  const [filtroReferencia, setFiltroReferencia] = useState('');
  const [filtroLoja, setFiltroLoja] = useState('');
  const [filtroQtdMin, setFiltroQtdMin] = useState(0);
  const [paginaAtual, setPaginaAtual] = useState(1);

  const lojasMap = useMemo(
    () => new Map(lojas.map((loja) => [loja.cd_empresa, `${loja.nm_grupoempresa || `Loja ${loja.cd_empresa}`} (${loja.cidade || 'N/A'})`])),
    [lojas]
  );

  const getNomeLoja = useCallback(
    (lojaOrigem: number) => lojasMap.get(lojaOrigem) || `Loja ${lojaOrigem}`,
    [lojasMap]
  );

  const carregar = useCallback(async (refresh = false) => {
    try {
      setLoading(true);
      setError(null);
      const headers = authHeaders();
      const [resDisponivel, resLojas] = await Promise.all([
        fetchNoCache(`${API_URL}/api/estoque-lojas/disponivel?lojaDestino=1${refresh ? '&refresh=true' : ''}`, { headers }),
        fetchNoCache(`${API_URL}/api/estoque-lojas/lojas`, { headers }),
      ]);

      if (!resDisponivel.ok) {
        let msg = 'Erro ao carregar estoque disponível das lojas';
        try {
          const body = await resDisponivel.json();
          msg = body?.error || msg;
        } catch {}
        throw new Error(msg);
      }
      if (!resLojas.ok) {
        let msg = 'Erro ao carregar lojas';
        try {
          const body = await resLojas.json();
          msg = body?.error || msg;
        } catch {}
        throw new Error(msg);
      }

      const [payloadDisponivel, payloadLojas] = await Promise.all([resDisponivel.json(), resLojas.json()]);
      setItens(Array.isArray(payloadDisponivel?.data) ? payloadDisponivel.data : []);
      setLojas(Array.isArray(payloadLojas?.data) ? payloadLojas.data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregar();
  }, [carregar, router]);

  const dadosFiltrados = useMemo(() => {
    let base = [...itens];

    if (filtroProduto.trim()) {
      const filtro = filtroProduto.trim();
      base = base.filter((item) => String(item.cd_produto).includes(filtro));
    }

    if (filtroReferencia.trim()) {
      const filtro = filtroReferencia.trim().toUpperCase();
      base = base.filter((item) => String(item.referencia || '').trim().toUpperCase().includes(filtro));
    }

    if (filtroLoja) {
      const loja = Number(filtroLoja);
      base = base.filter((item) => Number(item.loja_origem) === loja);
    }

    if (filtroQtdMin > 0) {
      base = base.filter((item) => Number(item.qtd_sugerida || 0) >= filtroQtdMin);
    }

    base.sort((a, b) => {
      const qtdDiff = Number(b.qtd_sugerida || 0) - Number(a.qtd_sugerida || 0);
      if (qtdDiff !== 0) return qtdDiff;
      return Number(a.cd_produto || 0) - Number(b.cd_produto || 0);
    });

    return base;
  }, [itens, filtroProduto, filtroReferencia, filtroLoja, filtroQtdMin]);

  const resumo = useMemo(() => ({
    totalLinhas: dadosFiltrados.length,
    totalProdutos: new Set(dadosFiltrados.map((item) => Number(item.cd_produto))).size,
    totalLojas: new Set(dadosFiltrados.map((item) => Number(item.loja_origem))).size,
    qtdTotal: dadosFiltrados.reduce((acc, item) => acc + Number(item.qtd_sugerida || 0), 0),
  }), [dadosFiltrados]);

  useEffect(() => {
    setPaginaAtual(1);
  }, [filtroProduto, filtroReferencia, filtroLoja, filtroQtdMin, dadosFiltrados.length]);

  const totalPaginas = Math.max(1, Math.ceil(dadosFiltrados.length / ITENS_POR_PAGINA));
  const dadosPaginados = useMemo(() => {
    const inicio = (paginaAtual - 1) * ITENS_POR_PAGINA;
    return dadosFiltrados.slice(inicio, inicio + ITENS_POR_PAGINA);
  }, [dadosFiltrados, paginaAtual]);

  const primeiraLinha = dadosFiltrados.length === 0 ? 0 : (paginaAtual - 1) * ITENS_POR_PAGINA + 1;
  const ultimaLinha = Math.min(paginaAtual * ITENS_POR_PAGINA, dadosFiltrados.length);

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 transition-all duration-300 ${sidebarCollapsed ? 'ml-20' : 'ml-64'}`}>
        <header className="bg-gradient-to-r from-sky-700 to-cyan-600 text-white shadow-lg">
          <div className="px-6 py-5">
            <h1 className="text-3xl font-bold">Estoque Loja Disponível</h1>
            <p className="mt-1 text-sky-100">Base: cenário de transferência para fábrica com `loja_destino = 1`</p>
          </div>
        </header>

        <main className="flex-1 space-y-6 px-6 py-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="rounded-lg border-l-4 border-cyan-500 bg-white p-5 shadow-md">
              <div className="text-sm font-medium text-gray-600">Quantidade Disponível</div>
              <div className="mt-1 text-3xl font-bold text-gray-800">{fmt(resumo.qtdTotal)}</div>
            </div>
            <div className="rounded-lg border-l-4 border-blue-500 bg-white p-5 shadow-md">
              <div className="text-sm font-medium text-gray-600">Linhas</div>
              <div className="mt-1 text-3xl font-bold text-gray-800">{fmt(resumo.totalLinhas)}</div>
            </div>
            <div className="rounded-lg border-l-4 border-indigo-500 bg-white p-5 shadow-md">
              <div className="text-sm font-medium text-gray-600">Produtos</div>
              <div className="mt-1 text-3xl font-bold text-gray-800">{fmt(resumo.totalProdutos)}</div>
            </div>
            <div className="rounded-lg border-l-4 border-emerald-500 bg-white p-5 shadow-md">
              <div className="text-sm font-medium text-gray-600">Lojas Origem</div>
              <div className="mt-1 text-3xl font-bold text-gray-800">{fmt(resumo.totalLojas)}</div>
            </div>
          </div>

          <div className="rounded-lg bg-white p-5 shadow-md">
            <h2 className="mb-4 text-lg font-semibold text-gray-800">Filtros</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Produto</label>
                <input
                  type="text"
                  value={filtroProduto}
                  onChange={(e) => setFiltroProduto(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Referência</label>
                <input
                  type="text"
                  value={filtroReferencia}
                  onChange={(e) => setFiltroReferencia(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Loja Origem</label>
                <select
                  value={filtroLoja}
                  onChange={(e) => setFiltroLoja(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                  <option value="">Todas</option>
                  {lojas.map((loja) => (
                    <option key={loja.cd_empresa} value={loja.cd_empresa}>
                      {loja.nm_grupoempresa || `Loja ${loja.cd_empresa}`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Quantidade Mínima</label>
                <input
                  type="number"
                  value={filtroQtdMin}
                  onChange={(e) => setFiltroQtdMin(Number(e.target.value || 0))}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => carregar(true)}
                  className="w-full rounded-md bg-cyan-600 px-4 py-2 font-medium text-white transition-colors hover:bg-cyan-700"
                >
                  Atualizar Dados
                </button>
              </div>
            </div>
          </div>

          {loading && (
            <div className="py-12 text-center">
              <div className="inline-block h-12 w-12 animate-spin rounded-full border-b-2 border-t-2 border-cyan-600" />
              <p className="mt-4 text-gray-600">Carregando dados...</p>
            </div>
          )}

          {error && (
            <div className="rounded border-l-4 border-red-500 bg-red-50 p-4">
              <p className="font-medium text-red-700">Erro: {error}</p>
            </div>
          )}

          {!loading && !error && (
            <div className="overflow-hidden rounded-lg bg-white shadow-md">
              <div className="flex flex-col gap-3 border-b border-gray-200 px-6 py-4 text-sm text-gray-600 md:flex-row md:items-center md:justify-between">
                <span>
                  Exibindo {primeiraLinha}-{ultimaLinha} de {dadosFiltrados.length} linhas
                </span>
                {totalPaginas > 1 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPaginaAtual((p) => Math.max(1, p - 1))}
                      disabled={paginaAtual === 1}
                      className="rounded border border-gray-300 px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Anterior
                    </button>
                    <span>Página {paginaAtual} de {totalPaginas}</span>
                    <button
                      onClick={() => setPaginaAtual((p) => Math.min(totalPaginas, p + 1))}
                      disabled={paginaAtual === totalPaginas}
                      className="rounded border border-gray-300 px-3 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Próxima
                    </button>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Loja Origem</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Produto</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Referência</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Cor</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Tam</th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Qtd Disponível</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {dadosPaginados.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                          Nenhum item encontrado
                        </td>
                      </tr>
                    ) : (
                      dadosPaginados.map((item) => (
                        <tr key={`${item.loja_origem}-${item.cd_produto}`} className="hover:bg-gray-50">
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">{getNomeLoja(item.loja_origem)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{item.cd_produto}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{item.referencia || '—'}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{item.cor || '—'}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{item.tamanho || '—'}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-bold text-cyan-700">{fmt(item.qtd_sugerida)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
