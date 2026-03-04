'use client';

import { useEffect, useMemo, useState } from 'react';
import MatrizPlanejamentoTable from './components/MatrizPlanejamentoTable';
import { Planejamento } from './types';

export default function Home() {
  const [dados, setDados] = useState<Planejamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState("sem cache");
  const [loadingPage, setLoadingPage] = useState(0);
  const [loadedItems, setLoadedItems] = useState(0);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  const CACHE_KEY = 'matriz_planejamento_em_linha_cache_v1';
  const CACHE_TTL_MS = 20 * 60 * 1000;

  useEffect(() => {
    carregarComCache();
  }, []);

  const carregarComCache = async () => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { timestamp: number; data: Planejamento[] };
        if (Array.isArray(parsed.data) && Date.now() - parsed.timestamp < CACHE_TTL_MS) {
          setDados(parsed.data);
          setCacheInfo('cache local');
          setLoading(false);
          return;
        }
      }
    } catch (_e) {
      // ignora cache invalido
    }
    await buscarMatriz(true);
  };

  const buscarMatriz = async (forceRefresh: boolean) => {
    setLoading(true);
    setError(null);
    setLoadingPage(0);
    setLoadedItems(0);

    try {
      const limit = 200;
      let offset = 0;
      let page = 1;
      let terminou = false;
      const acumulado: Planejamento[] = [];

      while (!terminou && page <= 20) {
        setLoadingPage(page);
        const params = new URLSearchParams({
          limit: String(limit),
          offset: String(offset),
          concorrencia: "10"
        });
        if (forceRefresh) params.append("no_cache", "true");

        const response = await fetch(`${apiUrl}/api/producao/matriz?${params}`);
        if (!response.ok) {
          throw new Error(`Erro ao buscar matriz: ${response.status}`);
        }

        const payload = await response.json();
        if (!payload.success || !Array.isArray(payload.data)) {
          throw new Error(payload.error || 'Erro ao carregar matriz');
        }

        const pagina = payload.data as Planejamento[];
        acumulado.push(...pagina);
        setDados([...acumulado]);
        setLoadedItems(acumulado.length);
        setCacheInfo(`carregando pagina ${page}...`);

        if (pagina.length < limit) {
          terminou = true;
        } else {
          offset += limit;
          page += 1;
        }
      }

      localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: acumulado }));
      setCacheInfo('atualizado do servidor');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar matriz');
    } finally {
      setLoading(false);
    }
  };

  const totais = useMemo(() => {
    return dados.reduce(
      (acc, item) => {
        acc.estoque += item.estoques.estoque_atual || 0;
        acc.estoqueMin += item.estoques.estoque_minimo || 0;
        acc.produzir += item.planejamento.necessidade_producao || 0;
        return acc;
      },
      { estoque: 0, estoqueMin: 0, produzir: 0 }
    );
  }, [dados]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold text-gray-900">Matriz de Planejamento</h1>
          <p className="text-sm text-gray-600 mt-1">
            Continuidade &gt; Referencia &gt; Cor-Tam com metricas de estoque e producao
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Status considerado: somente EM LINHA
          </p>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white rounded-lg shadow p-4 mb-4 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Fonte: <span className="font-medium text-gray-900">{cacheInfo}</span>
          </div>
          <button
            onClick={() => buscarMatriz(true)}
            className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Atualizar matriz
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-xs text-gray-500">Itens carregados</div>
            <div className="text-xl font-bold">{dados.length}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-xs text-gray-500">Estoque total</div>
            <div className="text-xl font-bold">{totais.estoque.toLocaleString("pt-BR")}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-xs text-gray-500">Estoque minimo total</div>
            <div className="text-xl font-bold">{totais.estoqueMin.toLocaleString("pt-BR")}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-xs text-gray-500">Produzir total</div>
            <div className="text-xl font-bold">{totais.produzir.toLocaleString("pt-BR")}</div>
          </div>
        </div>

        {loading && (
          <div className="bg-white rounded-lg shadow p-4 mb-4">
            <div className="flex justify-between text-sm text-gray-700">
              <span>Carregando matriz...</span>
              <span>Pagina {loadingPage || 1}</span>
            </div>
            <div className="mt-2 h-2 bg-gray-100 rounded">
              <div className="h-2 w-2/5 bg-blue-500 rounded animate-pulse" />
            </div>
            <div className="mt-2 text-sm text-gray-600">Registros carregados: {loadedItems}</div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 mb-4">
            {error}
          </div>
        )}

        {!error && dados.length > 0 && <MatrizPlanejamentoTable dados={dados} />}
      </div>
    </div>
  );
}

