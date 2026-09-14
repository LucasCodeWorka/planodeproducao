'use client';

import { useEffect, useMemo, useState } from 'react';
import { Boxes, RefreshCw, TriangleAlert, TrendingUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun'] as const;
type Month = typeof MONTHS[number];

type ProjectionItem = { idproduto: string; referencia: string; media_3m?: number; projecoes: Record<Month, number> };
type MatrixRow = { produto?: { idproduto?: string | number; referencia?: string }; estoques?: { estoque_disponivel?: number; em_processo?: number; estoque_minimo?: number }; demanda?: { media_vendas_3m?: number; pedidos_pendentes?: number }; plano?: { ma?: number; px?: number; ul?: number } };
type Group = { grupo: string; capacidade_diaria: number };
type RefGroup = { grupo: string; referencia: string };
type RealCapacity = { grupo: string; minutosTrabalhados: number; diasComMovimento: number };
type MonthRow = { mes: Month; demanda: number; producao: number; estoque: number; cobertura: number; carga: number; capacidade: number; diasDisponiveis: number; diasNecessarios: number; utilizacao: number };
type GroupRow = { grupo: string; demanda: number; producao: number; capacidade: number; carga: number; utilizacao: number; meses: Record<Month, number> };

const fmt = (n: number) => Math.round(n || 0).toLocaleString('pt-BR');
const fmtPct = (n: number) => `${Math.round(n || 0)}%`;
const norm = (v: unknown) => String(v || '').trim().toUpperCase();

export default function ProjecaoMacroPage() {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ anoBase: number; anoDestino: number; skus: number; estoqueInicial: number; emProcesso: number; pedidosPendentes: number; estoqueFimDezembro: number; planoAteDezembro: number; capacidadeDiaria: number; meses: MonthRow[]; grupos: GroupRow[] } | null>(null);

  async function carregar() {
    setLoading(true); setError(null);
    try {
      const anoBase = new Date().getFullYear();
      const anoDestino = anoBase + 1;
      const hoje = new Date();
      const isoMes = (offset: number) => new Date(hoje.getFullYear(), hoje.getMonth() + offset, 1).toISOString().slice(0, 10);
      const previewResponse = await fetchNoCache(`${API_URL}/api/projecao-permanentes/preview?anoBase=${anoBase}&anoDestino=${anoDestino}`, { headers: authHeaders() });
      const preview = await previewResponse.json();
      if (!previewResponse.ok || !preview.success) throw new Error(preview.error || 'Erro ao carregar projeção');
      const refs = Array.from(new Set((preview.itens || []).map((i: ProjectionItem) => norm(i.referencia)).filter(Boolean)));
      const [configResponse, matrixResponse, tempoResponse] = await Promise.all([
        fetchNoCache(`${API_URL}/api/capacidade/config`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/producao/matriz?limit=5000&prefer_cache=true&marca=LIEBE&status=EM%20LINHA%2CNOVA%20COLECAO`),
        fetchNoCache(`${API_URL}/api/capacidade/tempos-ref?referencias=${encodeURIComponent(refs.join(','))}`, { headers: authHeaders() }),
      ]);
      const config = await configResponse.json(); const matrix = await matrixResponse.json(); const tempos = await tempoResponse.json();
      const realResponse = await fetchNoCache(`${API_URL}/api/capacidade/real?de=${isoMes(-3)}&ate=${isoMes(0)}`, { headers: authHeaders() });
      const real = await realResponse.json();
      if (!configResponse.ok || !config.success) throw new Error(config.error || 'Erro ao carregar capacidade');
      const groups: Group[] = config.data?.grupos || [];
      const realByGroup = new Map<string, { minutos: number; dias: number }>();
      ((real.data || []) as RealCapacity[]).forEach((row) => {
        const key = norm(row.grupo); const current = realByGroup.get(key) || { minutos: 0, dias: 0 };
        current.minutos += Number(row.minutosTrabalhados || 0); current.dias += Number(row.diasComMovimento || 0); realByGroup.set(key, current);
      });
      const capacityGroups = groups.map((group) => {
        const current = realByGroup.get(norm(group.grupo));
        const media3m = current && current.dias > 0 ? current.minutos / current.dias : 0;
        return { ...group, capacidade_diaria: media3m > 0 ? media3m : Number(group.capacidade_diaria || 0) };
      });
      const capacidadeDiariaTotal = capacityGroups.reduce((sum, g) => sum + Number(g.capacidade_diaria || 0), 0);
      const refGroups: RefGroup[] = config.data?.grupo_refs || [];
      const days: Record<string, number> = config.data?.dias || {};
      const timeByRef = new Map<string, number>((tempos.data || []).map((t: any) => [norm(t.referencia_padrao || t.idreferencia), Number(t.tempo_segundos || 0)]));
      const matrixById = new Map<string, MatrixRow>((matrix.data || []).map((r: MatrixRow) => [String(r.produto?.idproduto || ''), r]));
      const groupByRef = new Map<string, string[]>();
      refGroups.forEach((r) => { const key = norm(r.referencia); const list = groupByRef.get(key) || []; if (!list.includes(norm(r.grupo))) list.push(norm(r.grupo)); groupByRef.set(key, list); });
      const items: ProjectionItem[] = preview.itens || [];
      const initial = items.reduce((sum, item) => sum + Number(matrixById.get(String(item.idproduto))?.estoques?.estoque_disponivel || 0), 0);
      const process = items.reduce((sum, item) => sum + Number(matrixById.get(String(item.idproduto))?.estoques?.em_processo || 0), 0);
      const pedidosPendentes = items.reduce((sum, item) => sum + Number(matrixById.get(String(item.idproduto))?.demanda?.pedidos_pendentes || 0), 0);
      const planToDecember = items.reduce((sum, item) => { const p = matrixById.get(String(item.idproduto))?.plano || {}; return sum + Number(p.ma || 0) + Number(p.px || 0) + Number(p.ul || 0); }, 0);
      const demandToDecember = items.reduce((sum, item) => sum + Number(matrixById.get(String(item.idproduto))?.demanda?.media_vendas_3m || item.media_3m || 0) * 3, 0);
      const estoqueFimDezembro = initial - pedidosPendentes + planToDecember - demandToDecember;
      const runningBySku = new Map(items.map((item) => {
        const row = matrixById.get(String(item.idproduto));
        const stock = row?.estoques || {};
        const pending = Number(row?.demanda?.pedidos_pendentes || 0);
        const p = row?.plano || {};
        const media3m = Number(row?.demanda?.media_vendas_3m || item.media_3m || 0);
        return [String(item.idproduto), { estoque: Number(stock.estoque_disponivel || 0) - pending + Number(p.ma || 0) + Number(p.px || 0) + Number(p.ul || 0) - media3m * 3, minimo: Number(stock.estoque_minimo || 0) }];
      }));
      const productionBySku = new Map<string, number[]>();
      const months: MonthRow[] = MONTHS.map((mes, index) => {
        const demanda = items.reduce((sum, item) => sum + Number(item.projecoes?.[mes] || 0), 0);
        let producao = 0; let carga = 0;
        items.forEach((item) => {
          const state = runningBySku.get(String(item.idproduto));
          if (!state) return;
          const venda = Number(item.projecoes?.[mes] || 0);
          const necessidade = Math.max(0, state.minimo - (state.estoque - venda));
          state.estoque = state.estoque - venda + necessidade;
          producao += necessidade;
          carga += necessidade * (timeByRef.get(norm(item.referencia)) || 0);
          const plan = productionBySku.get(String(item.idproduto)) || [];
          plan[index] = necessidade;
          productionBySku.set(String(item.idproduto), plan);
        });
        const capacidade = capacityGroups.reduce((sum, g) => sum + Number(g.capacidade_diaria || 0) * Number(days[String(index + 1)] || 0), 0);
        const estoque = Array.from(runningBySku.values()).reduce((sum, state) => sum + state.estoque, 0);
        const diasDisponiveis = capacidadeDiariaTotal > 0 ? capacidade / capacidadeDiariaTotal : 0;
        const diasNecessarios = capacidadeDiariaTotal > 0 ? carga / capacidadeDiariaTotal : 0;
        return { mes, demanda, producao, estoque, cobertura: demanda > 0 ? estoque / demanda : 0, carga, capacidade, diasDisponiveis, diasNecessarios, utilizacao: capacidade > 0 ? (carga / capacidade) * 100 : 0 };
      });
      const groupRows: GroupRow[] = capacityGroups.map((g) => {
        const grupo = norm(g.grupo); const groupItems = items.filter((i) => (groupByRef.get(norm(i.referencia)) || []).includes(grupo));
        const meses = Object.fromEntries(MONTHS.map((mes, index) => [mes, groupItems.reduce((sum, i) => sum + Number(productionBySku.get(String(i.idproduto))?.[index] || 0) * (timeByRef.get(norm(i.referencia)) || 0), 0)])) as Record<Month, number>;
        const demanda = groupItems.reduce((sum, i) => sum + MONTHS.reduce((m, mes) => m + Number(i.projecoes?.[mes] || 0), 0), 0);
        const producao = MONTHS.reduce((sum, mes, index) => sum + groupItems.reduce((inner, i) => inner + Number(productionBySku.get(String(i.idproduto))?.[index] || 0), 0), 0);
        const capacidade = MONTHS.reduce((sum, mes, index) => sum + Number(g.capacidade_diaria || 0) * Number(days[String(index + 1)] || 0), 0);
        const carga = MONTHS.reduce((sum, mes) => sum + meses[mes], 0);
        return { grupo, demanda, producao, capacidade, carga, utilizacao: capacidade > 0 ? (carga / capacidade) * 100 : 0, meses };
      }).filter((g) => g.demanda > 0 || g.carga > 0).sort((a, b) => b.utilizacao - a.utilizacao);
      setData({ anoBase, anoDestino, skus: items.length, estoqueInicial: initial, emProcesso: process, pedidosPendentes, estoqueFimDezembro, planoAteDezembro: planToDecember, capacidadeDiaria: capacidadeDiariaTotal, meses: months, grupos: groupRows });
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao carregar visão macro'); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (!getToken()) { router.replace('/login'); return; } carregar(); }, [router]);
  const totalDemanda = useMemo(() => data?.meses.reduce((s, m) => s + m.demanda, 0) || 0, [data]);
  const totalProducao = useMemo(() => data?.meses.reduce((s, m) => s + m.producao, 0) || 0, [data]);
  const ultimo = data?.meses[data.meses.length - 1];
  const primeiroNegativo = data?.meses.find((m) => m.estoque < 0);

  return <div className="min-h-screen bg-gray-100"><Sidebar onCollapse={setCollapsed} /><main className={`${collapsed ? 'ml-20' : 'ml-64'} p-6 transition-all`}>
    <div className="flex items-start justify-between mb-6"><div><p className="text-xs uppercase tracking-widest text-gray-500">Planejamento agregado</p><h1 className="text-2xl font-bold text-gray-900">Visão Macro de Estoque e Capacidade</h1><p className="text-sm text-gray-500 mt-1">Projeção {data?.anoDestino || new Date().getFullYear() + 1}.1 usando permanentes com venda em 6m ou 3m.</p></div><button onClick={carregar} className="flex items-center gap-2 px-3 py-2 bg-white border rounded-lg text-sm text-gray-700 hover:bg-gray-50"><RefreshCw size={16} /> Atualizar</button></div>
    {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    {loading ? <div className="rounded-lg bg-white p-10 text-center text-gray-500">Calculando visão macro...</div> : data && <>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {[['Estoque em dezembro', fmt(data.estoqueFimDezembro), data.estoqueFimDezembro < 0 ? 'text-red-700' : 'text-blue-700'], ['Demanda 2027.1', fmt(totalDemanda), 'text-emerald-700'], ['Produção macro 2027.1', fmt(totalProducao), 'text-indigo-700'], ['Capacidade diária média 3M', fmt(data.capacidadeDiaria), 'text-slate-800']].map(([label, value, color]) => <div key={label} className="bg-white border border-gray-200 rounded-lg px-4 py-3"><div className="text-xs uppercase tracking-wide text-gray-500 truncate" title={label}>{label}</div><div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div></div>)}
      </div>
      <div className="bg-white border border-gray-200 rounded-lg mb-6 overflow-hidden"><div className="px-5 py-4 border-b flex items-center gap-2"><TrendingUp size={18} className="text-emerald-600" /><div><h2 className="font-semibold text-gray-900">Evolução mensal consolidada</h2><p className="text-xs text-gray-500">Plano virtual pela cobertura: produz somente o necessário para recompor o estoque mínimo configurado.</p></div></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-xs uppercase text-gray-500"><tr>{['Mês','Demanda','Produção macro','Estoque final','Cobertura','Carga do plano','Dias necessários','Dias disponíveis','Capacidade','Utilização'].map((h) => <th key={h} className="px-4 py-3 text-right first:text-left">{h}</th>)}</tr></thead><tbody>{data.meses.map((m) => <tr key={m.mes} className="border-t"><td className="px-4 py-3 font-semibold uppercase">{m.mes}</td><td className="px-4 py-3 text-right font-mono">{fmt(m.demanda)}</td><td className="px-4 py-3 text-right font-mono font-semibold text-blue-700">{fmt(m.producao)}</td><td className={`px-4 py-3 text-right font-mono font-semibold ${m.estoque < 0 ? 'text-red-700' : 'text-gray-800'}`}>{fmt(m.estoque)}</td><td className={`px-4 py-3 text-right font-mono ${m.cobertura < 1 ? 'text-red-700' : 'text-gray-700'}`}>{m.demanda ? `${m.cobertura.toFixed(1)}x` : '-'}</td><td className="px-4 py-3 text-right font-mono">{fmt(m.carga)}</td><td className="px-4 py-3 text-right font-mono">{m.diasNecessarios.toFixed(1)}</td><td className="px-4 py-3 text-right font-mono">{m.diasDisponiveis.toFixed(1)}</td><td className="px-4 py-3 text-right font-mono">{fmt(m.capacidade)}</td><td className={`px-4 py-3 text-right font-mono font-semibold ${m.utilizacao > 100 ? 'text-red-700' : 'text-emerald-700'}`}>{fmtPct(m.utilizacao)}</td></tr>)}</tbody></table></div></div>
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden"><div className="px-5 py-4 border-b flex items-center gap-2"><Boxes size={18} className="text-blue-600" /><div><h2 className="font-semibold text-gray-900">Pressão por grupo de capacidade</h2><p className="text-xs text-gray-500">Carga da produção macro comparada à capacidade diária total cadastrada na aba Capacidade.</p></div></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-xs uppercase text-gray-500"><tr><th className="px-4 py-3 text-left">Grupo</th><th className="px-4 py-3 text-right">Demanda</th><th className="px-4 py-3 text-right">Produção</th><th className="px-4 py-3 text-right">Carga</th><th className="px-4 py-3 text-right">Capacidade</th><th className="px-4 py-3 text-right">Utilização</th>{MONTHS.map((m) => <th key={m} className="px-4 py-3 text-right">{m}</th>)}</tr></thead><tbody>{data.grupos.map((g) => <tr key={g.grupo} className="border-t"><td className="px-4 py-3 font-medium">{g.grupo}</td><td className="px-4 py-3 text-right font-mono">{fmt(g.demanda)}</td><td className="px-4 py-3 text-right font-mono text-blue-700">{fmt(g.producao)}</td><td className="px-4 py-3 text-right font-mono">{fmt(g.carga)}</td><td className="px-4 py-3 text-right font-mono">{fmt(g.capacidade)}</td><td className={`px-4 py-3 text-right font-mono font-semibold ${g.utilizacao > 100 ? 'text-red-700' : 'text-emerald-700'}`}>{fmtPct(g.utilizacao)}</td>{MONTHS.map((m) => <td key={m} className="px-4 py-3 text-right font-mono text-gray-600">{fmt(g.meses[m])}</td>)}</tr>)}</tbody></table></div></div>
      {(primeiroNegativo || (data.meses.some((m) => m.utilizacao > 100))) && <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><TriangleAlert size={17} />{primeiroNegativo ? `O estoque projetado fica negativo em ${primeiroNegativo.mes}.` : 'Há meses ou grupos acima de 100% da capacidade cadastrada.'} Essa tela é uma visão de decisão; o detalhamento continua no plano.</div>}
    </>}
  </main></div>;
}
