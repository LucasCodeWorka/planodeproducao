'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type Loja = { cd_empresa: number; nm_grupoempresa?: string; nome?: string; cidade?: string };
type ItemEntrada = { referencia: string; cor: string; tamanho: string; qtd: number };
type AnaliseRow = {
  linha: number;
  cdProduto?: string;
  referencia: string;
  produto?: string;
  cor: string;
  tamanho: string;
  qtdSolicitada: number;
  estoqueAtual?: number;
  vendas6m?: number;
  vendas3m?: number;
  mediaTrimestral?: number;
  estoqueMinimo?: number;
  alvoEstoque?: number;
  necessidade?: number;
  qtdJustificada?: number;
  excessoPedido?: number;
  coberturaAtual?: number | null;
  coberturaPos?: number | null;
  decisao?: 'NECESSARIO' | 'PARCIAL' | 'SEM_NECESSIDADE' | 'SEM_HISTORICO' | 'NAO_ANALISADO';
  status?: 'NAO_ENCONTRADO' | 'ENTRADA_INVALIDA';
  descricaoRegra?: string;
};
type AnalisePayload = {
  success: boolean;
  error?: string;
  details?: string;
  resumo?: {
    itens: number;
    qtdSolicitada: number;
    qtdJustificada: number;
    excessoPedido: number;
    necessarios: number;
    parciais: number;
    semNecessidade: number;
    semHistorico: number;
    naoEncontrados: number;
  };
  data?: AnaliseRow[];
};

function fmt(v: number | null | undefined, casas = 0) {
  const n = Number(v || 0);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function parseItens(texto: string): ItemEntrada[] {
  return texto
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.includes(';') ? line.split(';') : line.split(/\t|,/);
      const clean = parts.map((p) => p.trim()).filter(Boolean);
      return {
        referencia: clean[0] || '',
        cor: clean[1] || '',
        tamanho: clean[2] || '',
        qtd: Number(String(clean[3] || '0').replace(',', '.')) || 0,
      };
    })
    .filter((i) => i.referencia && i.cor && i.tamanho && i.qtd > 0);
}

function decisaoLabel(row: AnaliseRow) {
  if (row.status === 'NAO_ENCONTRADO') return 'Nao encontrado';
  if (row.status === 'ENTRADA_INVALIDA') return 'Entrada invalida';
  if (row.decisao === 'NECESSARIO') return 'Necessario';
  if (row.decisao === 'PARCIAL') return 'Parcial';
  if (row.decisao === 'SEM_HISTORICO') return 'Sem historico';
  if (row.decisao === 'SEM_NECESSIDADE') return 'Sem necessidade';
  return '-';
}

function decisaoClass(row: AnaliseRow) {
  if (row.status) return 'bg-gray-100 text-gray-700 border-gray-200';
  if (row.decisao === 'NECESSARIO') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (row.decisao === 'PARCIAL') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (row.decisao === 'SEM_HISTORICO') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (row.decisao === 'SEM_NECESSIDADE') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-gray-50 text-gray-600 border-gray-200';
}

export default function AnalisePedidoLojaPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [loja, setLoja] = useState('');
  const [referencia, setReferencia] = useState('');
  const [cores, setCores] = useState('PRETO;NUDE;BRANCO');
  const [tamanho, setTamanho] = useState('M');
  const [qtd, setQtd] = useState(4);
  const [cobertura, setCobertura] = useState(1);
  const [texto, setTexto] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<AnalisePayload | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregarLojas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregarLojas() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchNoCache(`${API_URL}/api/estoque-lojas/lojas`, { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Erro ao carregar lojas');
      const lista = (json.data || []) as Loja[];
      setLojas(lista);
      const domLuis = lista.find((l) => `${l.nm_grupoempresa || l.nome || ''}`.toUpperCase().includes('DOM'));
      setLoja(String((domLuis || lista[0])?.cd_empresa || ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar lojas');
    } finally {
      setLoading(false);
    }
  }

  function gerarItens() {
    const listaCores = cores
      .split(/[;,]/)
      .map((c) => c.trim())
      .filter(Boolean);
    const linhas = listaCores.map((cor) => `${referencia};${cor};${tamanho};${qtd}`);
    setTexto((prev) => [prev.trim(), ...linhas].filter(Boolean).join('\n'));
  }

  async function analisar() {
    const itens = parseItens(texto);
    if (!loja || !itens.length) {
      setError('Selecione a loja e informe os itens no formato referencia;cor;tamanho;qtd.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchNoCache(`${API_URL}/api/estoque-lojas/analise-pedido`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ loja: Number(loja), cobertura, itens }),
      });
      const json = (await res.json()) as AnalisePayload;
      if (!res.ok || !json?.success) throw new Error(json?.details || json?.error || 'Erro ao analisar pedido');
      setPayload(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao analisar pedido');
    } finally {
      setLoading(false);
    }
  }

  const rows = payload?.data || [];
  const resumo = payload?.resumo;
  const lojaSelecionada = useMemo(() => lojas.find((l) => String(l.cd_empresa) === loja), [lojas, loja]);
  const mainMargin = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <main className={`${mainMargin} transition-all duration-300 p-5 space-y-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-brand-dark">Analise Pedido Loja</h1>
            <p className="text-xs text-gray-500">Verifica se o pedido da loja tinha necessidade por SKU, usando estoque e venda da propria loja.</p>
          </div>
          <button onClick={analisar} disabled={loading} className="px-4 py-2 rounded-md bg-brand-primary text-white text-xs font-bold disabled:opacity-50">
            {loading ? 'Analisando...' : 'Analisar'}
          </button>
        </div>

        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <section className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <label className="flex flex-col md:col-span-2">
              <span className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Loja</span>
              <select value={loja} onChange={(e) => setLoja(e.target.value)} className="border rounded px-2 py-1.5 text-sm bg-white">
                {lojas.map((l) => (
                  <option key={l.cd_empresa} value={l.cd_empresa}>
                    {l.cd_empresa} - {l.nm_grupoempresa || l.nome || 'Loja'} {l.cidade ? `(${l.cidade})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col">
              <span className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Cobertura</span>
              <input type="number" min={0} step={0.1} value={cobertura} onChange={(e) => setCobertura(Number(e.target.value || 0))} className="border rounded px-2 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col">
              <span className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Referencia</span>
              <input value={referencia} onChange={(e) => setReferencia(e.target.value)} className="border rounded px-2 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col">
              <span className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Tamanho</span>
              <input value={tamanho} onChange={(e) => setTamanho(e.target.value)} className="border rounded px-2 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col">
              <span className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Qtd/cor</span>
              <input type="number" min={1} value={qtd} onChange={(e) => setQtd(Number(e.target.value || 0))} className="border rounded px-2 py-1.5 text-sm" />
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col min-w-[360px] flex-1">
              <span className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Cores</span>
              <input value={cores} onChange={(e) => setCores(e.target.value)} className="border rounded px-2 py-1.5 text-sm" />
            </label>
            <button type="button" onClick={gerarItens} className="px-3 py-2 rounded-md border border-gray-300 bg-white text-xs font-semibold text-gray-700">
              Gerar linhas
            </button>
          </div>
          <label className="block">
            <span className="text-[10px] font-semibold text-gray-500 uppercase mb-1 block">Itens para analisar</span>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={7}
              placeholder="referencia;cor;tamanho;qtd&#10;12345;PRETO;M;4&#10;12345;NUDE;M;4&#10;12345;BRANCO;M;4"
              className="w-full border rounded px-3 py-2 text-sm font-mono"
            />
          </label>
          <div className="text-xs text-gray-500">
            Loja selecionada: <strong>{lojaSelecionada?.nm_grupoempresa || lojaSelecionada?.nome || loja || '-'}</strong>. A necessidade considera estoque atual da loja e media de venda 3m/6m.
          </div>
        </section>

        {resumo && (
          <section className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="rounded-md border border-gray-200 bg-white px-3 py-2.5">
              <div className="text-[11px] text-gray-500">Pedido total</div>
              <div className="text-xl font-bold text-gray-900">{fmt(resumo.qtdSolicitada)}</div>
              <div className="text-[11px] text-gray-500">Itens: {fmt(resumo.itens)}</div>
            </div>
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5">
              <div className="text-[11px] text-emerald-700">Justificado</div>
              <div className="text-xl font-bold text-emerald-700">{fmt(resumo.qtdJustificada)}</div>
              <div className="text-[11px] text-emerald-600">Necessarios: {fmt(resumo.necessarios)}</div>
            </div>
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5">
              <div className="text-[11px] text-red-700">Sem justificativa</div>
              <div className="text-xl font-bold text-red-700">{fmt(resumo.excessoPedido)}</div>
              <div className="text-[11px] text-red-600">Sem necessidade: {fmt(resumo.semNecessidade)}</div>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
              <div className="text-[11px] text-amber-700">Parcial</div>
              <div className="text-xl font-bold text-amber-800">{fmt(resumo.parciais)}</div>
              <div className="text-[11px] text-amber-700">Parte do pedido fazia sentido</div>
            </div>
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2.5">
              <div className="text-[11px] text-blue-700">Sem historico/erro</div>
              <div className="text-xl font-bold text-blue-800">{fmt(resumo.semHistorico + resumo.naoEncontrados)}</div>
              <div className="text-[11px] text-blue-700">Revisar manualmente</div>
            </div>
          </section>
        )}

        <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-auto max-h-[64vh]">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-slate-100 text-slate-700 z-10">
                <tr>
                  <th className="text-left px-2 py-2">Decisao</th>
                  <th className="text-left px-2 py-2">Ref</th>
                  <th className="text-left px-2 py-2">Produto</th>
                  <th className="text-left px-2 py-2">Cor</th>
                  <th className="text-left px-2 py-2">Tam</th>
                  <th className="text-right px-2 py-2">Pedido</th>
                  <th className="text-right px-2 py-2">Estoque loja</th>
                  <th className="text-right px-2 py-2">Venda 3m</th>
                  <th className="text-right px-2 py-2">Min loja</th>
                  <th className="text-right px-2 py-2">Necessidade</th>
                  <th className="text-right px-2 py-2">Justificado</th>
                  <th className="text-right px-2 py-2">Excesso</th>
                  <th className="text-right px-2 py-2">Cob atual</th>
                  <th className="text-right px-2 py-2">Cob pos</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={`${r.linha}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} border-t border-gray-200`}>
                    <td className="px-2 py-1.5">
                      <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold ${decisaoClass(r)}`}>{decisaoLabel(r)}</span>
                    </td>
                    <td className="px-2 py-1.5 font-semibold">{r.referencia || '-'}</td>
                    <td className="px-2 py-1.5 min-w-[220px]">{r.produto || r.cdProduto || '-'}</td>
                    <td className="px-2 py-1.5">{r.cor || '-'}</td>
                    <td className="px-2 py-1.5">{r.tamanho || '-'}</td>
                    <td className="px-2 py-1.5 text-right font-semibold">{fmt(r.qtdSolicitada)}</td>
                    <td className="px-2 py-1.5 text-right">{fmt(r.estoqueAtual)}</td>
                    <td className="px-2 py-1.5 text-right">{fmt(r.vendas3m)}</td>
                    <td className="px-2 py-1.5 text-right">{fmt(r.estoqueMinimo)}</td>
                    <td className="px-2 py-1.5 text-right">{fmt(r.necessidade)}</td>
                    <td className="px-2 py-1.5 text-right text-emerald-700 font-semibold">{fmt(r.qtdJustificada)}</td>
                    <td className="px-2 py-1.5 text-right text-red-700 font-semibold">{fmt(r.excessoPedido)}</td>
                    <td className="px-2 py-1.5 text-right">{r.coberturaAtual == null ? '-' : `${fmt(r.coberturaAtual, 1)}x`}</td>
                    <td className="px-2 py-1.5 text-right">{r.coberturaPos == null ? '-' : `${fmt(r.coberturaPos, 1)}x`}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={14} className="px-3 py-8 text-center text-gray-500">Informe os itens e clique em analisar.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
