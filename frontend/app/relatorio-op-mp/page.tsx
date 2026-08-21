'use client';

import { useState, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { Printer } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type MateriaPrima = {
  codigo: string;
  id: string;
  nome: string;
  cor: string;
  tamanho: string;
  artigo: string;
  unidadeMedida: string;
  quantidade: number;
};
type ProdutoOp = {
  sku: string;
  referencia: string;
  produto: string;
  cor: string;
  tamanho: string;
  unidadeMedida: string;
  quantidade: number;
  materiasPrimas: MateriaPrima[];
};
type OpRelatorio = {
  empresa: number;
  ciclo: number;
  op: number;
  emitidaEm: string;
  iniciadaEm: string | null;
  encerradaEm: string | null;
  produtos: ProdutoOp[];
};

function fmt(value: number) {
  return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

function dataHora(value: string | null | undefined) {
  if (!value) return '-';
  return new Date(value).toLocaleString('pt-BR');
}

function consolidarMp(op: OpRelatorio) {
  const mapa = new Map<string, MateriaPrima>();
  for (const produto of op.produtos) {
    for (const mp of produto.materiasPrimas) {
      const atual = mapa.get(mp.id) || { ...mp, quantidade: 0 };
      atual.quantidade += Number(mp.quantidade || 0);
      mapa.set(mp.id, atual);
    }
  }
  return Array.from(mapa.values()).sort((a, b) => a.codigo.localeCompare(b.codigo));
}

function agruparPorArtigo(materiasPrimas: MateriaPrima[]) {
  const grupos = new Map<string, MateriaPrima[]>();
  for (const mp of materiasPrimas) {
    const artigo = mp.artigo?.trim() || 'Sem artigo';
    if (!grupos.has(artigo)) grupos.set(artigo, []);
    grupos.get(artigo)?.push(mp);
  }
  return Array.from(grupos.entries()).sort(([a], [b]) => a.localeCompare(b));
}

export default function RelatorioOpMpPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [op, setOp] = useState('');
  const [referencia, setReferencia] = useState('');
  const [sku, setSku] = useState('');
  const [relatorio, setRelatorio] = useState<OpRelatorio[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [orientacao, setOrientacao] = useState<'portrait' | 'landscape'>('portrait');

  async function gerar() {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    if ((!de || !ate) && !op && !referencia && !sku) {
      setErro('Informe um período, OP, referência ou SKU.');
      return;
    }
    if ((de && !ate) || (!de && ate)) {
      setErro('Informe as duas datas do período.');
      return;
    }
    setLoading(true);
    setErro(null);
    try {
      const params = new URLSearchParams();
      if (de && ate) { params.set('de', de); params.set('ate', ate); }
      if (op.trim()) params.set('op', op.trim());
      if (referencia.trim()) params.set('referencia', referencia.trim());
      if (sku.trim()) params.set('sku', sku.trim());
      const response = await fetch(`${API_URL}/api/relatorio-op-mp?${params}`, { headers: authHeaders() });
      const payload = await response.json();
      if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Erro ao gerar relatório');
      setRelatorio(Array.isArray(payload.data) ? payload.data : []);
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Erro ao gerar relatório');
      setRelatorio([]);
    } finally {
      setLoading(false);
    }
  }

  const mainMargin = sidebarCollapsed ? 'ml-20' : 'ml-64';
  const isLandscape = orientacao === 'landscape';

  return (
    <div className="min-h-screen bg-gray-100">
      <style jsx global>{`
        @media print {
          @page {
            size: A4 ${orientacao};
            margin: 5mm;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          html, body {
            background: white !important;
            font-size: ${isLandscape ? '8pt' : '7pt'} !important;
            line-height: 1.2 !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .no-print, aside, nav { display: none !important; }
          .print-main {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
          }
          .print-sheet {
            break-after: page;
            page-break-after: always;
            padding: 2mm !important;
            margin: 0 !important;
            border: none !important;
          }
          .print-sheet:last-child {
            break-after: auto;
            page-break-after: auto;
          }
          .print-header {
            border-bottom: 1px solid #000 !important;
            padding: 1mm 2mm !important;
            margin-bottom: 2mm !important;
          }
          .print-header h2 {
            font-size: ${isLandscape ? '12pt' : '11pt'} !important;
          }
          .print-header span, .print-header div {
            font-size: ${isLandscape ? '7pt' : '6pt'} !important;
          }
          .print-section-title {
            font-size: ${isLandscape ? '7pt' : '6pt'} !important;
            padding: 1mm 2mm !important;
            margin-bottom: 1mm !important;
          }
          .print-table {
            border-collapse: collapse;
            width: 100%;
            font-size: ${isLandscape ? '7pt' : '6pt'} !important;
            line-height: 1.1 !important;
          }
          .print-table th, .print-table td {
            border: 0.5pt solid #333 !important;
            padding: ${isLandscape ? '1mm 2mm' : '0.5mm 1.5mm'} !important;
          }
          .print-table th {
            background-color: #e0e0e0 !important;
            font-weight: 700 !important;
            font-size: ${isLandscape ? '6.5pt' : '5.5pt'} !important;
          }
          .print-table .artigo-row {
            background-color: #d0d0d0 !important;
          }
          .print-table .artigo-row td {
            font-weight: 700 !important;
            padding: ${isLandscape ? '0.8mm 2mm' : '0.5mm 1.5mm'} !important;
          }
          /* Thead repete em cada página */
          .print-thead {
            display: table-header-group !important;
          }
          .print-thead .op-header th {
            padding: 1.5mm 2mm !important;
            border-bottom: 1px solid #333 !important;
          }
          .print-thead .op-header th div {
            font-size: ${isLandscape ? '7pt' : '6pt'} !important;
          }
          .print-thead .op-header th span.text-base {
            font-size: ${isLandscape ? '11pt' : '10pt'} !important;
          }
          /* Código MP não quebra linha */
          .print-table td.whitespace-nowrap,
          .print-table th.whitespace-nowrap {
            white-space: nowrap !important;
            min-width: ${isLandscape ? '22mm' : '20mm'} !important;
          }
        }
      `}</style>
      <Sidebar onCollapse={setSidebarCollapsed} />
      <main className={`${mainMargin} print-main p-5 transition-all duration-300`}>
        <section className="no-print bg-white border border-gray-200 rounded-lg p-5 space-y-5 shadow-sm">
          <div className="border-b border-gray-100 pb-4">
            <h1 className="text-xl font-bold text-brand-dark">Relatório de MP por OP</h1>
            <p className="text-sm text-gray-500 mt-1">Lista operacional para separar matérias-primas por ordem de produção.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-600">
              De
              <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="border border-gray-300 rounded-md px-3 py-2 font-normal text-sm focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-colors" />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-600">
              Até
              <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="border border-gray-300 rounded-md px-3 py-2 font-normal text-sm focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-colors" />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-600">
              OP
              <input value={op} onChange={(e) => setOp(e.target.value)} placeholder="Ex.: 65625" className="border border-gray-300 rounded-md px-3 py-2 font-normal text-sm focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-colors" />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-600">
              Referência
              <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Ex.: 501000" className="border border-gray-300 rounded-md px-3 py-2 font-normal text-sm focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-colors" />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-600">
              SKU
              <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Código do SKU" className="border border-gray-300 rounded-md px-3 py-2 font-normal text-sm focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-colors" />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-gray-600">
              Orientação
              <select value={orientacao} onChange={(e) => setOrientacao(e.target.value as 'portrait' | 'landscape')} className="border border-gray-300 rounded-md px-3 py-2 font-normal text-sm bg-white focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary transition-colors">
                <option value="portrait">Vertical (Retrato)</option>
                <option value="landscape">Horizontal (Paisagem)</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button type="button" onClick={gerar} disabled={loading} className="px-5 py-2.5 rounded-md bg-brand-primary hover:bg-brand-primary/90 text-white text-sm font-semibold disabled:opacity-50 transition-colors shadow-sm">
              {loading ? 'Gerando...' : 'Gerar relatório'}
            </button>
            <button type="button" onClick={() => window.print()} disabled={!relatorio.length} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-semibold disabled:opacity-50 transition-colors" title="Imprimir relatório">
              <Printer size={16} />
              Imprimir relatório
            </button>
          </div>

          {erro && <div className="border border-red-200 bg-red-50 text-red-700 rounded-md px-4 py-3 text-sm">{erro}</div>}
        </section>

        {!loading && !relatorio.length && (
          <div className="no-print mt-6 bg-white border border-gray-200 rounded-lg p-10 text-center">
            <div className="text-gray-400 mb-2">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm text-gray-500">Informe os filtros e clique em &quot;Gerar relatório&quot;</p>
          </div>
        )}

        {relatorio.map((item) => {
          const materiasPrimas = consolidarMp(item);
          return (
            <section key={`${item.empresa}-${item.ciclo}-${item.op}`} className="print-sheet mt-4 bg-white border border-gray-300 print:border-0">
              {/* Tabela única com thead que repete em cada página */}
              <table className="print-table w-full text-xs border-collapse">
                <thead className="print-thead">
                  {/* Cabeçalho da OP - repete em cada página */}
                  <tr className="op-header">
                    <th colSpan={7} className="text-left px-2 py-1 border-b border-gray-400 bg-white">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <span className="text-base font-black text-gray-900">OP {item.op}</span>
                          <span className="text-[10px] text-gray-600 font-normal">Emitida: {dataHora(item.emitidaEm)}</span>
                          <span className="text-[10px] text-gray-600 font-normal">Ciclo: {item.ciclo}</span>
                        </div>
                        <span className="text-[10px] text-gray-500 font-normal">
                          Romaneio de Separação MP <span className="font-bold text-gray-700">| Liebe</span>
                        </span>
                      </div>
                    </th>
                  </tr>
                  {/* Seção Produtos */}
                  <tr>
                    <th colSpan={7} className="text-left px-2 py-0.5 bg-gray-200 text-[10px] font-bold uppercase text-gray-600 border border-gray-300">
                      Produtos da OP
                    </th>
                  </tr>
                  <tr className="bg-gray-100">
                    <th className="text-left px-2 py-1 font-bold text-gray-700 border border-gray-300 w-16">SKU</th>
                    <th className="text-left px-2 py-1 font-bold text-gray-700 border border-gray-300 w-16">Ref.</th>
                    <th className="text-left px-2 py-1 font-bold text-gray-700 border border-gray-300">Produto</th>
                    <th className="text-left px-2 py-1 font-bold text-gray-700 border border-gray-300 w-24">Cor</th>
                    <th className="text-center px-2 py-1 font-bold text-gray-700 border border-gray-300 w-12">Tam.</th>
                    <th className="text-center px-2 py-1 font-bold text-gray-700 border border-gray-300 w-10">Un.</th>
                    <th className="text-right px-2 py-1 font-bold text-gray-700 border border-gray-300 w-14">Qtd.</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Linhas dos produtos */}
                  {item.produtos.map((produto) => (
                    <tr key={`${produto.sku}-${produto.referencia}`}>
                      <td className="px-2 py-1 text-gray-800 border border-gray-300">{produto.sku}</td>
                      <td className="px-2 py-1 text-gray-600 border border-gray-300">{produto.referencia || '-'}</td>
                      <td className="px-2 py-1 text-gray-800 border border-gray-300">{produto.produto}</td>
                      <td className="px-2 py-1 text-gray-600 border border-gray-300">{produto.cor || '-'}</td>
                      <td className="px-2 py-1 text-gray-600 text-center border border-gray-300">{produto.tamanho || '-'}</td>
                      <td className="px-2 py-1 text-gray-600 text-center border border-gray-300">{produto.unidadeMedida || '-'}</td>
                      <td className="px-2 py-1 text-right font-bold text-gray-900 border border-gray-300">{fmt(produto.quantidade)}</td>
                    </tr>
                  ))}
                  {/* Separador e cabeçalho MPs */}
                  <tr>
                    <td colSpan={7} className="px-2 py-0.5 bg-gray-200 text-[10px] font-bold uppercase text-gray-600 border border-gray-300">
                      Matérias-Primas para Separar
                    </td>
                  </tr>
                  <tr className="bg-gray-100 mp-header">
                    <td className="text-left px-2 py-1 font-bold text-gray-700 border border-gray-300 whitespace-nowrap min-w-[80px]">Cód. MP</td>
                    <td className="text-left px-2 py-1 font-bold text-gray-700 border border-gray-300" colSpan={2}>Matéria-Prima</td>
                    <td className="text-left px-2 py-1 font-bold text-gray-700 border border-gray-300">Cor</td>
                    <td className="text-center px-2 py-1 font-bold text-gray-700 border border-gray-300">Tam.</td>
                    <td className="text-center px-2 py-1 font-bold text-gray-700 border border-gray-300">Un.</td>
                    <td className="text-right px-2 py-1 font-bold text-gray-700 border border-gray-300">Qtd.</td>
                  </tr>
                  {/* Linhas das MPs */}
                  {materiasPrimas.length > 0 ? (
                    agruparPorArtigo(materiasPrimas).map(([artigo, materias]) => (
                      <Fragment key={artigo}>
                        <tr className="artigo-row bg-gray-200">
                          <td colSpan={7} className="px-2 py-0.5 font-bold text-xs text-gray-800 border border-gray-300">
                            {artigo}
                          </td>
                        </tr>
                        {materias.map((mp) => (
                          <tr key={mp.id}>
                            <td className="px-2 py-1 text-gray-800 border border-gray-300 font-medium whitespace-nowrap">{mp.codigo || mp.id}</td>
                            <td className="px-2 py-1 text-gray-800 border border-gray-300" colSpan={2}>{mp.nome}</td>
                            <td className="px-2 py-1 text-gray-600 border border-gray-300">{mp.cor || '-'}</td>
                            <td className="px-2 py-1 text-gray-600 text-center border border-gray-300">{mp.tamanho || '-'}</td>
                            <td className="px-2 py-1 text-gray-600 text-center border border-gray-300">{mp.unidadeMedida || '-'}</td>
                            <td className="px-2 py-1 text-right font-bold text-gray-900 border border-gray-300">{fmt(mp.quantidade)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="px-2 py-1 text-gray-500 italic border border-gray-300">Nenhuma MP cadastrada.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          );
        })}
      </main>
    </div>
  );
}
