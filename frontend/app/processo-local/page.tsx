'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface LocalItem {
  cd_local: number;
  ds_local: string;
  cd_produto: number;
  referencia: string;
  produto: string;
  cor: string;
  tamanho: string;
  marca: string;
  status: string;
  continuidade: string;
  qtd_op: number;
  qtd_finalizada: number;
  qtd_em_processo: number;
  estoque: number;
  estoque_minimo: number;
  pedidos: number;
  disponivel: number;
  cobertura: number | null;
}

interface LocalOption {
  cd_local: number;
  ds_local: string;
}

function fmt(v: number) {
  return Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

export default function ProcessoLocalPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dados, setDados] = useState<LocalItem[]>([]);
  const [locais, setLocais] = useState<LocalOption[]>([]);
  const [filtroLocal, setFiltroLocal] = useState<string>('');
  const [filtroReferencia, setFiltroReferencia] = useState('');
  const [filtroContinuidade, setFiltroContinuidade] = useState('TODAS');
  const [filtroCoberturaMinima, setFiltroCoberturaMinima] = useState('');
  const [filtroEmProcessoMinimo, setFiltroEmProcessoMinimo] = useState('');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregarDados();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregarDados() {
    setLoading(true);
    setError(null);
    try {
      const [resLocais, resDados] = await Promise.all([
        fetch(`${API_URL}/api/producao/locais`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/producao/producao-por-local?marca=LIEBE`, { headers: authHeaders() }),
      ]);

      const jsonLocais = await resLocais.json();
      const jsonDados = await resDados.json();

      if (!resLocais.ok || !jsonLocais.success) throw new Error(jsonLocais.error || 'Erro ao carregar locais');
      if (!resDados.ok || !jsonDados.success) throw new Error(jsonDados.error || 'Erro ao carregar dados');

      setLocais(jsonLocais.data || []);
      setDados(jsonDados.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  }

  // Filtros
  const dadosFiltrados = useMemo(() => {
    let base = dados;

    if (filtroLocal) {
      base = base.filter((d) => d.cd_local === Number(filtroLocal));
    }

    if (filtroReferencia.trim()) {
      const q = filtroReferencia.toLowerCase().trim();
      base = base.filter((d) =>
        d.referencia.toLowerCase().includes(q) ||
        d.produto.toLowerCase().includes(q) ||
        String(d.cd_produto).includes(q)
      );
    }

    if (filtroContinuidade !== 'TODAS') {
      base = base.filter((d) => d.continuidade.toUpperCase() === filtroContinuidade);
    }

    // Filtro por cobertura mínima
    if (filtroCoberturaMinima.trim()) {
      const valorCobertura = parseFloat(filtroCoberturaMinima);
      if (!isNaN(valorCobertura)) {
        base = base.filter((d) => {
          // Cobertura = disponível / estoque_minimo (sem considerar em_processo)
          const coberturaAtual = d.estoque_minimo > 0 ? d.disponivel / d.estoque_minimo : Number.NEGATIVE_INFINITY;
          return coberturaAtual > valorCobertura;
        });
      }
    }

    // Filtro por em processo mínimo
    if (filtroEmProcessoMinimo.trim()) {
      const valorProcesso = parseFloat(filtroEmProcessoMinimo);
      if (!isNaN(valorProcesso)) {
        base = base.filter((d) => d.qtd_em_processo > valorProcesso);
      }
    }

    return base;
  }, [dados, filtroLocal, filtroReferencia, filtroContinuidade, filtroCoberturaMinima, filtroEmProcessoMinimo]);

  // Agrupar por local
  const dadosAgrupados = useMemo(() => {
    const map = new Map<number, { local: LocalOption; itens: LocalItem[]; totais: { emProcesso: number; estoque: number; pedidos: number } }>();

    for (const item of dadosFiltrados) {
      if (!map.has(item.cd_local)) {
        map.set(item.cd_local, {
          local: { cd_local: item.cd_local, ds_local: item.ds_local },
          itens: [],
          totais: { emProcesso: 0, estoque: 0, pedidos: 0 },
        });
      }
      const grupo = map.get(item.cd_local)!;
      grupo.itens.push(item);
      grupo.totais.emProcesso += item.qtd_em_processo;
      grupo.totais.estoque += item.estoque;
      grupo.totais.pedidos += item.pedidos;
    }

    return Array.from(map.values()).sort((a, b) => a.local.cd_local - b.local.cd_local);
  }, [dadosFiltrados]);

  // Totais gerais
  const totaisGerais = useMemo(() => {
    return dadosFiltrados.reduce(
      (acc, d) => ({
        emProcesso: acc.emProcesso + d.qtd_em_processo,
        estoque: acc.estoque + d.estoque,
        pedidos: acc.pedidos + d.pedidos,
        itens: acc.itens + 1,
      }),
      { emProcesso: 0, estoque: 0, pedidos: 0, itens: 0 }
    );
  }, [dadosFiltrados]);

  // Continuidades únicas
  const continuidades = useMemo(() => {
    const set = new Set(dados.map((d) => d.continuidade.toUpperCase()).filter(Boolean));
    return Array.from(set).sort();
  }, [dados]);

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 min-w-0 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="bg-brand-primary shadow-sm px-6 py-3">
          <h1 className="text-white font-bold font-secondary tracking-wide text-base">PROCESSO POR LOCAL</h1>
          <p className="text-white/70 text-xs">Visualização de produção em andamento por setor</p>
        </header>

        <main className="flex-1 min-w-0 px-6 py-5 space-y-4">
          {loading && <div className="bg-white rounded-lg border p-4 text-sm text-gray-500">Carregando...</div>}
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

          {!loading && !error && (
            <>
              {/* Totalizadores */}
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="grid grid-cols-4 gap-6">
                  <div>
                    <div className="text-[11px] text-gray-400 mb-0.5">SKUs em Processo</div>
                    <div className="text-xl font-bold font-mono text-brand-primary">{fmt(totaisGerais.itens)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-400 mb-0.5">Total Em Processo</div>
                    <div className="text-xl font-bold font-mono text-sky-600">{fmt(totaisGerais.emProcesso)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-400 mb-0.5">Estoque Atual</div>
                    <div className="text-xl font-bold font-mono text-blue-600">{fmt(totaisGerais.estoque)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-400 mb-0.5">Pedidos Pendentes</div>
                    <div className="text-xl font-bold font-mono text-amber-600">{fmt(totaisGerais.pedidos)}</div>
                  </div>
                </div>
              </div>

              {/* Filtros */}
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex flex-wrap gap-4 items-end">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Local</label>
                    <select
                      value={filtroLocal}
                      onChange={(e) => setFiltroLocal(e.target.value)}
                      className="border border-gray-300 rounded px-3 py-1.5 text-sm min-w-[200px]"
                    >
                      <option value="">Todos os locais</option>
                      {locais.map((l) => (
                        <option key={l.cd_local} value={l.cd_local}>
                          {l.cd_local} - {l.ds_local}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Referência / Produto</label>
                    <input
                      type="text"
                      value={filtroReferencia}
                      onChange={(e) => setFiltroReferencia(e.target.value)}
                      placeholder="Buscar..."
                      className="border border-gray-300 rounded px-3 py-1.5 text-sm w-48"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Continuidade</label>
                    <select
                      value={filtroContinuidade}
                      onChange={(e) => setFiltroContinuidade(e.target.value)}
                      className="border border-gray-300 rounded px-3 py-1.5 text-sm"
                    >
                      <option value="TODAS">Todas</option>
                      {continuidades.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={carregarDados}
                    className="px-4 py-1.5 text-sm font-semibold bg-brand-primary text-white rounded hover:bg-brand-secondary"
                  >
                    Atualizar
                  </button>
                </div>
              </div>

              {/* Tabela por Local */}
              {dadosAgrupados.map((grupo) => (
                <div key={grupo.local.cd_local} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-200 bg-sky-50 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-bold text-sky-800">{grupo.local.cd_local}</span>
                      <span className="mx-2 text-sky-400">·</span>
                      <span className="text-sm font-medium text-sky-700">{grupo.local.ds_local}</span>
                    </div>
                    <div className="flex gap-6 text-xs">
                      <span className="text-gray-500">{grupo.itens.length} SKUs</span>
                      <span className="text-sky-700 font-semibold">Em Proc: {fmt(grupo.totais.emProcesso)}</span>
                    </div>
                  </div>
                  <div className="max-h-[400px] overflow-auto">
                    <table className="min-w-full text-xs">
                      <thead className="bg-gray-100 sticky top-0 z-10">
                        <tr>
                          <th className="text-left px-3 py-2 font-semibold text-gray-700">Referência</th>
                          <th className="text-left px-3 py-2 font-semibold text-gray-700">Produto</th>
                          <th className="text-left px-3 py-2 font-semibold text-gray-700">Cor / Tam</th>
                          <th className="text-left px-3 py-2 font-semibold text-gray-700">Continuidade</th>
                          <th className="text-right px-3 py-2 font-semibold text-gray-700">Estoque</th>
                          <th className="text-right px-3 py-2 font-semibold text-sky-700 bg-sky-50">Em Processo</th>
                          <th className="text-right px-3 py-2 font-semibold text-gray-700">Est. Mín</th>
                          <th className="text-right px-3 py-2 font-semibold text-gray-700">Pedidos</th>
                          <th className="text-right px-3 py-2 font-semibold text-gray-700">Disponível</th>
                          <th className="text-right px-3 py-2 font-semibold text-gray-700">Cobertura</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grupo.itens.map((item, idx) => {
                          const cobClass = item.cobertura === null
                            ? 'text-gray-400'
                            : item.cobertura < 0
                              ? 'text-red-600 font-semibold'
                              : item.cobertura < 1
                                ? 'text-amber-600 font-semibold'
                                : 'text-emerald-600';
                          return (
                            <tr key={`${item.cd_local}-${item.cd_produto}`} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              <td className="px-3 py-2 font-mono text-gray-600">{item.referencia}</td>
                              <td className="px-3 py-2 text-gray-700">{item.produto}</td>
                              <td className="px-3 py-2 text-gray-500">{item.cor} / {item.tamanho}</td>
                              <td className="px-3 py-2 text-gray-500">{item.continuidade}</td>
                              <td className="px-3 py-2 text-right font-mono">{fmt(item.estoque)}</td>
                              <td className="px-3 py-2 text-right font-mono font-semibold text-sky-700 bg-sky-50/50">{fmt(item.qtd_em_processo)}</td>
                              <td className="px-3 py-2 text-right font-mono text-gray-500">{fmt(item.estoque_minimo)}</td>
                              <td className="px-3 py-2 text-right font-mono">{fmt(item.pedidos)}</td>
                              <td className="px-3 py-2 text-right font-mono font-semibold">
                                {item.disponivel < 0 ? (
                                  <span className="text-red-600">{fmt(item.disponivel)}</span>
                                ) : (
                                  <span className="text-gray-700">{fmt(item.disponivel)}</span>
                                )}
                              </td>
                              <td className={`px-3 py-2 text-right font-mono ${cobClass}`}>
                                {item.cobertura !== null ? `${item.cobertura.toFixed(1)}x` : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {dadosAgrupados.length === 0 && (
                <div className="bg-white rounded-lg border p-8 text-center text-gray-500">
                  Nenhum item em processo encontrado com os filtros selecionados.
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
