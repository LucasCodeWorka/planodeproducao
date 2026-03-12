'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { PeriodosPlano, Planejamento, ProjecoesMap } from '../types';
import { projecaoMesDecorrida, projecaoMesPlanejamento } from '../lib/projecao';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type DiagResp = {
  termometro?: { score: number; nivel: string };
  diagnostico?: {
    resumoExecutivo?: string;
    diagnosticoCurtoPrazo?: string[];
    diagnosticoMedioPrazo?: string[];
    diagnosticoLongoPrazo?: string[];
    riscosCriticos?: string[];
    oportunidades?: string[];
    planoAcao90Dias?: string[];
    filtrosRecomendados?: Array<{ objetivo: string; nome: string; prioridade: string }>;
  };
};

function normalizaRef(ref: string) {
  return String(ref || '').trim().toUpperCase();
}

type ContextItem = {
  idproduto: string;
  referencia: string;
  produto: string;
  continuidade: string;
  tendenciaProjPct: number;
  taxaJan: number;
  taxaFev: number;
  cobMA: number;
  cobPX: number;
  dispUL: number;
  cobUL: number;
  planoMA: number;
  planoPX: number;
  planoUL: number;
};

export default function DiagnosticosPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [executando, setExecutando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [dados, setDados] = useState<Planejamento[]>([]);
  const [projecoes, setProjecoes] = useState<ProjecoesMap>({});
  const [vendasReais, setVendasReais] = useState<Record<string, Record<string, number>>>({});
  const [periodos, setPeriodos] = useState<PeriodosPlano>({ MA: new Date().getMonth() + 1, PX: new Date().getMonth() + 2, UL: new Date().getMonth() + 3 });
  const [top30Ids, setTop30Ids] = useState<Set<string>>(new Set());
  const [top30Refs, setTop30Refs] = useState<Set<string>>(new Set());
  const [foco, setFoco] = useState('Balancear retirada x aumento para reduzir negativos sem sobrar estoque.');
  const [resp, setResp] = useState<DiagResp | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregarTudo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregarTudo() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '5000', marca: 'LIEBE', status: 'EM LINHA' });
      const [rMatriz, rProj, rTop30] = await Promise.all([
        fetch(`${API_URL}/api/producao/matriz?${params}`),
        fetch(`${API_URL}/api/projecoes`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/analises/top30-produtos`, { headers: authHeaders() }),
      ]);
      if (!rMatriz.ok) throw new Error(`Matriz erro ${rMatriz.status}`);
      if (!rProj.ok) throw new Error(`Projeções erro ${rProj.status}`);
      if (!rTop30.ok) throw new Error(`Top30 erro ${rTop30.status}`);

      const pMatriz = await rMatriz.json();
      const pProj = await rProj.json();
      const pTop30 = await rTop30.json();
      const rows = (pMatriz.data || []) as Planejamento[];
      setDados(rows);
      setProjecoes((pProj && pProj.data) || {});
      if (pProj?.periodos) setPeriodos(pProj.periodos as PeriodosPlano);
      setTop30Ids(new Set(((pTop30 && pTop30.ids) || []).map((v: string) => String(v))));
      setTop30Refs(new Set(((pTop30 && pTop30.referencias) || []).map((v: string) => normalizaRef(v))));

      const ids = rows.map((i) => Number(i.produto.idproduto)).filter((n) => Number.isFinite(n)).slice(0, 2500);
      carregarVendas(ids);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar diagnósticos');
    } finally {
      setLoading(false);
    }
  }

  async function carregarVendas(ids: number[]) {
    if (!ids.length) return;
    try {
      const r = await fetch(`${API_URL}/api/analises/projecao-vs-venda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ano: new Date().getFullYear(), ids }),
      });
      if (!r.ok) throw new Error();
      const p = await r.json();
      setVendasReais((p && p.data) || {});
    } catch {
      setVendasReais({});
    }
  }

  const parametros = useMemo(() => {
    const base = dados.filter((i) => !String(i.produto.produto || '').toUpperCase().includes('MEIA DE SEDA'));
    let projJan = 0; let projFev = 0; let projMar = 0;
    let realJan = 0; let realFev = 0; let realMar = 0;
    let negAtual = 0; let negMA = 0; let negPX = 0; let negUL = 0;
    let somaCobAtual = 0; let countCobAtual = 0;
    let skusAbaixo05 = 0; let totalSkusCob = 0;

    base.forEach((i) => {
      const id = String(i.produto.idproduto || '');
      const pj = Number(projecoes[id]?.['1'] || 0);
      const pf = Number(projecoes[id]?.['2'] || 0);
      const pm = projecaoMesDecorrida(Number(projecoes[id]?.['3'] || 0), 3);
      const rj = Number(vendasReais[id]?.['1'] || 0);
      const rf = Number(vendasReais[id]?.['2'] || 0);
      const rm = Number(vendasReais[id]?.['3'] || 0);
      projJan += pj; projFev += pf; projMar += pm;
      realJan += rj; realFev += rf; realMar += rm;

      const min = Number(i.estoques.estoque_minimo || 0);
      const dispAtual = (i.estoques.estoque_atual || 0) - (i.demanda.pedidos_pendentes || 0);
      const emP = i.estoques.em_processo || 0;
      const ma = i.plano?.ma || 0; const px = i.plano?.px || 0; const ul = i.plano?.ul || 0;
      const prMA = projecaoMesPlanejamento(Number(projecoes[id]?.[String(periodos.MA)] || 0), periodos.MA);
      const prPX = Number(projecoes[id]?.[String(periodos.PX)] || 0);
      const prUL = Number(projecoes[id]?.[String(periodos.UL)] || 0);
      const dispMA = dispAtual + emP + ma - prMA;
      const dispPX = dispMA + px - prPX;
      const dispUL = dispPX + ul - prUL;
      negAtual += Math.max(0, -dispAtual);
      negMA += Math.max(0, -dispMA);
      negPX += Math.max(0, -dispPX);
      negUL += Math.max(0, -dispUL);

      if (min > 0) {
        const cobAtual = dispAtual / min;
        const cobUL = dispUL / min;
        somaCobAtual += cobAtual;
        countCobAtual += 1;
        totalSkusCob += 1;
        if (cobUL < 0.5) skusAbaixo05 += 1;
      }
    });

    const dv = (real: number, proj: number) => (proj > 0 ? ((real - proj) / proj) * 100 : 0);
    return {
      variacaoJanPct: Number(dv(realJan, projJan).toFixed(1)),
      variacaoFevPct: Number(dv(realFev, projFev).toFixed(1)),
      variacaoMarPct: Number(dv(realMar, projMar).toFixed(1)),
      taxaJan: projJan > 0 ? realJan / projJan : 1,
      taxaFev: projFev > 0 ? realFev / projFev : 1,
      taxaMar: projMar > 0 ? realMar / projMar : 1,
      coberturaAtual: countCobAtual > 0 ? somaCobAtual / countCobAtual : 0,
      coberturaAlvo: 1,
      pecasNegativasAtual: Math.round(negAtual),
      pecasNegativasMA: Math.round(negMA),
      pecasNegativasPX: Math.round(negPX),
      pecasNegativasUL: Math.round(negUL),
      pctSkusAbaixo05: totalSkusCob > 0 ? Number(((skusAbaixo05 / totalSkusCob) * 100).toFixed(1)) : 0,
      qtdVacasLeiteirasRisco: 0,
    };
  }, [dados, projecoes, vendasReais, periodos]);

  const contextoTabela = useMemo(() => {
    const base = dados.filter((i) => !String(i.produto.produto || '').toUpperCase().includes('MEIA DE SEDA'));
    const candidatosReducao: ContextItem[] = [];
    const candidatosAumento: ContextItem[] = [];
    const vacasRisco: ContextItem[] = [];

    base.forEach((i) => {
      const id = String(i.produto.idproduto || '');
      const ref = String(i.produto.referencia || '');
      const isTop30 = top30Refs.has(normalizaRef(ref)) || top30Ids.has(id);

      const pj = Number(projecoes[id]?.['1'] || 0);
      const pf = Number(projecoes[id]?.['2'] || 0);
      const rj = Number(vendasReais[id]?.['1'] || 0);
      const rf = Number(vendasReais[id]?.['2'] || 0);
      const taxaJan = pj > 0 ? rj / pj : 1;
      const taxaFev = pf > 0 ? rf / pf : 1;
      const projMA = projecaoMesPlanejamento(Number(projecoes[id]?.[String(periodos.MA)] || 0), periodos.MA);
      const projPX = Number(projecoes[id]?.[String(periodos.PX)] || 0);
      const projUL = Number(projecoes[id]?.[String(periodos.UL)] || 0);
      const tendenciaProjPct = projMA > 0 ? ((projUL - projMA) / projMA) * 100 : 0;

      const min = Number(i.estoques.estoque_minimo || 0);
      const dispAtual = (i.estoques.estoque_atual || 0) - (i.demanda.pedidos_pendentes || 0);
      const emP = i.estoques.em_processo || 0;
      const ma = i.plano?.ma || 0; const px = i.plano?.px || 0; const ul = i.plano?.ul || 0;
      const prMA = projecaoMesPlanejamento(Number(projecoes[id]?.[String(periodos.MA)] || 0), periodos.MA);
      const prPX = Number(projecoes[id]?.[String(periodos.PX)] || 0);
      const prUL = Number(projecoes[id]?.[String(periodos.UL)] || 0);
      const dispMA = dispAtual + emP + ma - prMA;
      const dispPX = dispMA + px - prPX;
      const dispUL = dispPX + ul - prUL;
      const cobMA = min > 0 ? dispMA / min : 0;
      const cobPX = min > 0 ? dispPX / min : 0;
      const cobUL = min > 0 ? dispUL / min : 0;

      const item = {
        idproduto: id,
        referencia: ref,
        produto: i.produto.produto || i.produto.apresentacao || '',
        continuidade: i.produto.continuidade || 'SEM CONTINUIDADE',
        tendenciaProjPct: Number(tendenciaProjPct.toFixed(1)),
        taxaJan: Number(taxaJan.toFixed(2)),
        taxaFev: Number(taxaFev.toFixed(2)),
        cobMA: Number(cobMA.toFixed(2)),
        cobPX: Number(cobPX.toFixed(2)),
        dispUL: Math.round(dispUL),
        cobUL: Number(cobUL.toFixed(2)),
        planoMA: Math.round(ma),
        planoPX: Math.round(px),
        planoUL: Math.round(ul),
      };

      const projecaoEmQueda = tendenciaProjPct < 0;
      const coberturaAltaAgora = cobMA >= 1;
      const naoComprometeProximos = cobPX >= 0.8 && cobUL >= 0.8;
      const podeReduzirComSeguranca = projecaoEmQueda && coberturaAltaAgora && naoComprometeProximos;

      const riscoRuptura = dispMA < 0 || dispPX < 0 || dispUL < 0 || cobMA < 0.5 || cobPX < 0.5 || cobUL < 0.5;

      if (podeReduzirComSeguranca) candidatosReducao.push(item);
      if (riscoRuptura) candidatosAumento.push(item);
      if (isTop30 && riscoRuptura) vacasRisco.push(item);
    });

    candidatosReducao.sort((a, b) => a.tendenciaProjPct - b.tendenciaProjPct);
    candidatosAumento.sort((a, b) => Math.min(a.cobMA, a.cobPX, a.cobUL) - Math.min(b.cobMA, b.cobPX, b.cobUL));
    vacasRisco.sort((a, b) => Math.min(a.cobMA, a.cobPX, a.cobUL) - Math.min(b.cobMA, b.cobPX, b.cobUL));

    return {
      candidatosReducao: candidatosReducao.slice(0, 30),
      candidatosAumento: candidatosAumento.slice(0, 30),
      vacasRisco: vacasRisco.slice(0, 30),
    };
  }, [dados, projecoes, vendasReais, periodos, top30Ids, top30Refs]);

  async function gerarDiagnostico() {
    setExecutando(true);
    setError(null);
    setOkMsg(null);
    try {
      const r = await fetch(`${API_URL}/api/openai/diagnostico`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          nomeCenario: 'Diagnóstico Executivo do Plano',
          foco,
          parametros,
          contexto: {
            totalSkus: dados.length,
            periodos,
            ...contextoTabela,
          },
          model: 'gpt-4.1-mini',
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.error || 'Erro ao gerar diagnóstico');
      setResp(data as DiagResp);
      setOkMsg('Diagnóstico gerado com sucesso.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar diagnóstico');
    } finally {
      setExecutando(false);
    }
  }

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 min-w-0 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="bg-brand-primary shadow-sm px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-white font-bold font-secondary tracking-wide text-base">DIAGNÓSTICOS</h1>
            <p className="text-white/70 text-xs">Análise executiva de PCP e Supply Chain via OpenAI</p>
          </div>
          <button onClick={gerarDiagnostico} disabled={executando || loading} className="px-3 py-2 text-xs font-semibold bg-white text-brand-primary rounded disabled:opacity-60">
            {executando ? 'Gerando...' : 'Gerar diagnóstico completo'}
          </button>
        </header>

        <main className="flex-1 px-6 py-5 space-y-4">
          {loading && <div className="bg-white rounded-lg border p-4 text-sm text-gray-500">Carregando...</div>}
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}
          {okMsg && <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700">{okMsg}</div>}

          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <label className="block text-xs font-semibold text-brand-dark mb-1">Foco do diagnóstico</label>
            <textarea value={foco} onChange={(e) => setFoco(e.target.value)} rows={2} className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs" />
          </div>

          <ContextTable
            titulo="Candidatos de Redução (enviados para IA)"
            subtitulo="Projeção em queda + cobertura MA >= 1x + segurança nos próximos meses (PX/UL >= 0.8x)"
            itens={contextoTabela.candidatosReducao}
          />
          <ContextTable
            titulo="Candidatos de Aumento (enviados para IA)"
            subtitulo="Risco de ruptura em qualquer etapa (MA/PX/UL)"
            itens={contextoTabela.candidatosAumento}
          />
          <ContextTable
            titulo="Vacas Leiteiras em Risco (Top30 enviados para IA)"
            subtitulo="Top30 com risco de ruptura no UL"
            itens={contextoTabela.vacasRisco}
          />

          {resp?.termometro && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Kpi label="Score termômetro" value={resp.termometro.score.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} />
              <Kpi label="Nível" value={resp.termometro.nivel} />
              <Kpi label="% SKUs < 0.5x" value={`${parametros.pctSkusAbaixo05.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`} />
            </div>
          )}

          {resp?.diagnostico?.resumoExecutivo && (
            <Bloco titulo="Resumo Executivo" linhas={[resp.diagnostico.resumoExecutivo]} />
          )}
          {resp?.diagnostico?.diagnosticoCurtoPrazo?.length ? <Bloco titulo="Curto Prazo" linhas={resp.diagnostico.diagnosticoCurtoPrazo} /> : null}
          {resp?.diagnostico?.diagnosticoMedioPrazo?.length ? <Bloco titulo="Médio Prazo" linhas={resp.diagnostico.diagnosticoMedioPrazo} /> : null}
          {resp?.diagnostico?.diagnosticoLongoPrazo?.length ? <Bloco titulo="Longo Prazo" linhas={resp.diagnostico.diagnosticoLongoPrazo} /> : null}
          {resp?.diagnostico?.riscosCriticos?.length ? <Bloco titulo="Riscos Críticos" linhas={resp.diagnostico.riscosCriticos} /> : null}
          {resp?.diagnostico?.oportunidades?.length ? <Bloco titulo="Oportunidades" linhas={resp.diagnostico.oportunidades} /> : null}
          {resp?.diagnostico?.planoAcao90Dias?.length ? <Bloco titulo="Plano de Ação 90 Dias" linhas={resp.diagnostico.planoAcao90Dias} /> : null}
        </main>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-xl font-bold text-brand-dark">{value}</div>
    </div>
  );
}

function Bloco({ titulo, linhas }: { titulo: string; linhas: string[] }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h2 className="text-sm font-bold text-brand-dark mb-2">{titulo}</h2>
      <ul className="space-y-1 text-xs text-gray-700">
        {linhas.map((l, i) => <li key={`${titulo}-${i}`}>• {l}</li>)}
      </ul>
    </div>
  );
}

function ContextTable({ titulo, subtitulo, itens }: { titulo: string; subtitulo: string; itens: ContextItem[] }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h3 className="text-sm font-bold text-brand-dark">{titulo}</h3>
        <p className="text-[11px] text-gray-500">{subtitulo} · {itens.length.toLocaleString('pt-BR')} itens</p>
      </div>
      <div className="overflow-auto max-h-64">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-gray-100 z-10">
            <tr>
              <th className="px-2 py-2 text-left">Ref</th>
              <th className="px-2 py-2 text-left">Produto</th>
              <th className="px-2 py-2 text-left">Continuidade</th>
              <th className="px-2 py-2 text-right">Tend. Proj.</th>
              <th className="px-2 py-2 text-right">Taxa Jan</th>
              <th className="px-2 py-2 text-right">Taxa Fev</th>
              <th className="px-2 py-2 text-right">Cob MA</th>
              <th className="px-2 py-2 text-right">Cob PX</th>
              <th className="px-2 py-2 text-right">Disp UL</th>
              <th className="px-2 py-2 text-right">Cob UL</th>
              <th className="px-2 py-2 text-right">MA</th>
              <th className="px-2 py-2 text-right">PX</th>
              <th className="px-2 py-2 text-right">UL</th>
            </tr>
          </thead>
          <tbody>
            {itens.length === 0 && (
              <tr>
                <td colSpan={13} className="px-3 py-4 text-center text-gray-500 border-t border-gray-200">
                  Nenhum item neste bloco.
                </td>
              </tr>
            )}
            {itens.map((i, idx) => (
              <tr key={`${i.idproduto}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
                <td className="px-2 py-1.5 font-semibold">{i.referencia}</td>
                <td className="px-2 py-1.5 max-w-[260px] truncate" title={i.produto}>{i.produto}</td>
                <td className="px-2 py-1.5">{i.continuidade}</td>
                <td className={`px-2 py-1.5 text-right font-semibold ${i.tendenciaProjPct < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{i.tendenciaProjPct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
                <td className="px-2 py-1.5 text-right">{i.taxaJan.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="px-2 py-1.5 text-right">{i.taxaFev.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className={`px-2 py-1.5 text-right ${i.cobMA >= 1 ? 'text-emerald-700' : 'text-amber-700'}`}>{i.cobMA.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x</td>
                <td className={`px-2 py-1.5 text-right ${i.cobPX >= 0.8 ? 'text-emerald-700' : 'text-amber-700'}`}>{i.cobPX.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x</td>
                <td className={`px-2 py-1.5 text-right font-semibold ${i.dispUL < 0 ? 'text-red-700' : 'text-gray-700'}`}>{i.dispUL.toLocaleString('pt-BR')}</td>
                <td className={`px-2 py-1.5 text-right font-semibold ${i.cobUL < 0.5 ? 'text-amber-700' : 'text-gray-700'}`}>{i.cobUL.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x</td>
                <td className="px-2 py-1.5 text-right">{i.planoMA.toLocaleString('pt-BR')}</td>
                <td className="px-2 py-1.5 text-right">{i.planoPX.toLocaleString('pt-BR')}</td>
                <td className="px-2 py-1.5 text-right">{i.planoUL.toLocaleString('pt-BR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
