'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { PeriodosPlano, Planejamento, ProjecoesMap } from '../types';
import { authHeaders, getToken } from '../lib/auth';
import { projecaoMesPlanejamento } from '../lib/projecao';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MARCA_FIXA = 'LIEBE';
const STATUS_FIXO = 'EM LINHA';

type PlanoSnapshotItem = { chave: string; ma: number; px: number; ul: number; qt?: number };
type Suggestion = {
  id: string;
  nome: string;
  createdAt: number;
  parametros?: {
    tipo?: string;
    statusAprovacao?: 'PENDENTE' | 'APROVADA';
    aprovadoEm?: number;
    aprovadoPor?: string;
    planos?: PlanoSnapshotItem[];
  };
  resumo?: { alterados?: number; retiradoTotal?: number };
  observacoes?: string;
};

function chaveItem(item: Planejamento) {
  const id = Number(item.produto.idproduto);
  if (Number.isFinite(id)) return `ID-${id}`;
  return `REF-${item.produto.referencia || ''}-${item.produto.cor || ''}-${item.produto.tamanho || ''}`;
}

function calculaDispECobPorPlano(
  item: Planejamento,
  projecoes: ProjecoesMap,
  periodos: PeriodosPlano,
  plano: { ma: number; px: number; ul: number; qt: number }
) {
  const mesQT = Number(periodos.QT || (((periodos.UL || 1) - 1 + 1) % 12) + 1);
  const min = Number(item.estoques.estoque_minimo || 0);
  const dispAtual = Number(item.estoques.estoque_atual || 0) - Number(item.demanda.pedidos_pendentes || 0);
  const proj = projecoes[item.produto.idproduto] ?? null;
  const emP = Number(item.estoques.em_processo || 0);
  const prMA = proj ? projecaoMesPlanejamento(Number(proj[String(periodos.MA)] || 0), periodos.MA) : 0;
  const prPX = proj ? Number(proj[String(periodos.PX)] || 0) : 0;
  const prUL = proj ? Number(proj[String(periodos.UL)] || 0) : 0;
  const prQT = proj ? Number(proj[String(mesQT)] || 0) : 0;
  const dispMA = dispAtual + emP + plano.ma - prMA;
  const dispPX = dispMA + plano.px - prPX;
  const dispUL = dispPX + plano.ul - prUL;
  const dispQT = dispUL + plano.qt - prQT;
  return {
    dispMA,
    dispPX,
    dispUL,
    dispQT,
    cobMA: min > 0 ? dispMA / min : 0,
    cobPX: min > 0 ? dispPX / min : 0,
    cobUL: min > 0 ? dispUL / min : 0,
    cobQT: min > 0 ? dispQT / min : 0,
  };
}

function fmtPeca(v: number) {
  return Math.round(v || 0).toLocaleString('pt-BR');
}

export default function SugestoesAprovacoesPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [dadosBase, setDadosBase] = useState<Planejamento[]>([]);
  const [projecoes, setProjecoes] = useState<ProjecoesMap>({});
  const [periodos, setPeriodos] = useState<PeriodosPlano>({
    MA: new Date().getMonth() + 1,
    PX: new Date().getMonth() + 2,
    UL: new Date().getMonth() + 3,
  });
  const [sugestoes, setSugestoes] = useState<Suggestion[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [aprovando, setAprovando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

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
      const params = new URLSearchParams({ limit: '5000', marca: MARCA_FIXA, status: STATUS_FIXO });
      const [rMatriz, rAnalises, rProj] = await Promise.all([
        fetch(`${API_URL}/api/producao/matriz?${params}`),
        fetch(`${API_URL}/api/simulacoes`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/projecoes`, { headers: authHeaders() }),
      ]);
      if (!rMatriz.ok) throw new Error(`Matriz erro ${rMatriz.status}`);
      if (!rAnalises.ok) throw new Error(`Simulações erro ${rAnalises.status}`);
      if (!rProj.ok) throw new Error(`Projeções erro ${rProj.status}`);
      const pMatriz = await rMatriz.json();
      const pAnalises = await rAnalises.json();
      const pProj = await rProj.json();
      const base = (pMatriz.data || []) as Planejamento[];
      const sugs = (Array.isArray(pAnalises?.data) ? pAnalises.data : [])
        .filter((s: Suggestion) => {
          const t = String(s?.parametros?.tipo || '');
          return t === 'LAB_SUGESTAO_RETIRADA' || t === 'SUGESTAO_PLANO';
        });
      setDadosBase(base);
      setProjecoes((pProj && pProj.data) || {});
      if (pProj && pProj.periodos) setPeriodos(pProj.periodos as PeriodosPlano);
      setSugestoes(sugs);
      if (sugs.length > 0) setSelectedId((prev) => prev || sugs[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar sugestões');
    } finally {
      setLoading(false);
    }
  }

  const selecionada = useMemo(
    () => sugestoes.find((s) => s.id === selectedId) || null,
    [sugestoes, selectedId]
  );

  const linhasAlteradas = useMemo(() => {
    if (!selecionada) return [];
    const planos = Array.isArray(selecionada.parametros?.planos) ? selecionada.parametros?.planos : [];
    const basePorChave = new Map(dadosBase.map((i) => [chaveItem(i), i]));
    return planos
      .map((p) => {
        const b = basePorChave.get(p.chave);
        if (!b) return null;
        const bMA = Math.round(b.plano?.ma || 0);
        const bPX = Math.round(b.plano?.px || 0);
        const bUL = Math.round(b.plano?.ul || 0);
        const bQT = Math.round(b.plano?.qt || 0);
        const cMA = Math.round(p.ma || 0);
        const cPX = Math.round(p.px || 0);
        const cUL = Math.round(p.ul || 0);
        const cQT = Math.round(p.qt || 0);
        return {
          chave: p.chave,
          referencia: b.produto.referencia || '-',
          produto: b.produto.produto || '-',
          cor: b.produto.cor || '-',
          tamanho: b.produto.tamanho || '-',
          continuidade: b.produto.continuidade || 'SEM CONTINUIDADE',
          baseMA: bMA, basePX: bPX, baseUL: bUL, baseQT: bQT,
          cenarioMA: cMA, cenarioPX: cPX, cenarioUL: cUL, cenarioQT: cQT,
          deltaMA: cMA - bMA,
          deltaPX: cPX - bPX,
          deltaUL: cUL - bUL,
          deltaQT: cQT - bQT,
          deltaTotal: (cMA + cPX + cUL + cQT) - (bMA + bPX + bUL + bQT),
          baseCalc: calculaDispECobPorPlano(b, projecoes, periodos, { ma: bMA, px: bPX, ul: bUL, qt: bQT }),
          cenarioCalc: calculaDispECobPorPlano(b, projecoes, periodos, { ma: cMA, px: cPX, ul: cUL, qt: cQT }),
        };
      })
      .filter((v): v is NonNullable<typeof v> => Boolean(v))
      .sort((a, b) => a.referencia.localeCompare(b.referencia));
  }, [dadosBase, selecionada, projecoes, periodos]);

  async function aprovarSelecionada() {
    if (!selecionada) return;
    setAprovando(true);
    setError(null);
    setOkMsg(null);
    try {
      const parametros = {
        ...(selecionada.parametros || {}),
        statusAprovacao: 'APROVADA',
        aprovadoEm: Date.now(),
        aprovadoPor: 'PCP',
      };
      const res = await fetch(`${API_URL}/api/simulacoes/${selecionada.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ parametros }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao aprovar sugestão');
      setOkMsg('Sugestão aprovada com sucesso.');
      await carregarTudo();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao aprovar');
    } finally {
      setAprovando(false);
    }
  }

  async function excluirSelecionada() {
    if (!selecionada || excluindo) return;
    const ok = window.confirm(`Excluir a simulação "${selecionada.nome}"?`);
    if (!ok) return;
    setExcluindo(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`${API_URL}/api/simulacoes/${selecionada.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao excluir simulação');
      const restantes = sugestoes.filter((s) => s.id !== selecionada.id);
      setSugestoes(restantes);
      setSelectedId(restantes[0]?.id || '');
      setOkMsg('Simulação excluída com sucesso.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao excluir simulação');
    } finally {
      setExcluindo(false);
    }
  }

  function exportarCSV() {
    if (!linhasAlteradas.length) return;
    const header = [
      'referencia', 'produto', 'cor', 'tamanho', 'continuidade',
      'base_ma', 'base_px', 'base_ul', 'base_qt',
      'cenario_ma', 'cenario_px', 'cenario_ul', 'cenario_qt',
      'delta_ma', 'delta_px', 'delta_ul', 'delta_qt', 'delta_total'
    ];
    const rows = linhasAlteradas.map((r) => [
      r.referencia, r.produto, r.cor, r.tamanho, r.continuidade,
      r.baseMA, r.basePX, r.baseUL, r.baseQT, r.cenarioMA, r.cenarioPX, r.cenarioUL, r.cenarioQT,
      r.deltaMA, r.deltaPX, r.deltaUL, r.deltaQT, r.deltaTotal,
    ]);
    const csv = [header, ...rows]
      .map((arr) => arr.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `planos_aprovados_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';
  const pendentes = sugestoes.filter((s) => s.parametros?.statusAprovacao !== 'APROVADA').length;
  const aprovadas = sugestoes.filter((s) => s.parametros?.statusAprovacao === 'APROVADA').length;

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 min-w-0 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="bg-brand-primary shadow-sm px-6 py-3 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-white font-bold font-secondary tracking-wide text-base">SUGESTÕES E APROVAÇÕES</h1>
            <p className="text-white/70 text-xs">Validação de sugestões do laboratório e exportação do plano aprovado</p>
          </div>
        </header>

        <main className="flex-1 min-w-0 px-6 py-5 space-y-4">
          {loading && <div className="bg-white rounded-lg border p-4 text-sm text-gray-500">Carregando...</div>}
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}
          {okMsg && <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700">{okMsg}</div>}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-white rounded-lg border border-gray-200 p-3"><div className="text-xs text-gray-500">Sugestões</div><div className="text-xl font-bold">{fmtPeca(sugestoes.length)}</div></div>
            <div className="bg-amber-50 rounded-lg border border-amber-200 p-3"><div className="text-xs text-amber-700">Pendentes</div><div className="text-xl font-bold text-amber-700">{fmtPeca(pendentes)}</div></div>
            <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-3"><div className="text-xs text-emerald-700">Aprovadas</div><div className="text-xl font-bold text-emerald-700">{fmtPeca(aprovadas)}</div></div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <div className="bg-white rounded-lg border border-gray-200 p-3 xl:col-span-1">
              <div className="text-xs font-semibold text-brand-dark mb-2">Sugestões salvas</div>
              <div className="max-h-[65vh] overflow-auto space-y-2">
                {sugestoes.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    className={`w-full text-left p-2 rounded border ${selectedId === s.id ? 'border-brand-primary bg-brand-primary/5' : 'border-gray-200 hover:bg-gray-50'}`}
                  >
                    <div className="text-xs font-semibold text-gray-800">{s.nome}</div>
                    <div className="text-[11px] text-gray-500">{new Date(s.createdAt).toLocaleString('pt-BR')}</div>
                    <div className={`text-[11px] mt-1 inline-block px-1.5 py-0.5 rounded ${s.parametros?.statusAprovacao === 'APROVADA' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {s.parametros?.statusAprovacao === 'APROVADA' ? 'APROVADA' : 'PENDENTE'}
                    </div>
                  </button>
                ))}
                {sugestoes.length === 0 && <div className="text-xs text-gray-500">Nenhuma sugestão salva ainda.</div>}
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-3 xl:col-span-2">
              {!selecionada && <div className="text-sm text-gray-500">Selecione uma sugestão para visualizar.</div>}
              {selecionada && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <div>
                      <div className="text-sm font-bold text-brand-dark">{selecionada.nome}</div>
                      <div className="text-xs text-gray-500">{new Date(selecionada.createdAt).toLocaleString('pt-BR')}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={aprovarSelecionada} disabled={aprovando || selecionada.parametros?.statusAprovacao === 'APROVADA'} className="px-3 py-2 text-xs font-semibold bg-emerald-600 text-white rounded disabled:opacity-60">
                        {selecionada.parametros?.statusAprovacao === 'APROVADA' ? 'Já aprovada' : (aprovando ? 'Aprovando...' : 'Aprovar')}
                      </button>
                      <button onClick={exportarCSV} className="px-3 py-2 text-xs font-semibold border border-gray-300 rounded hover:bg-gray-50">
                        Exportar CSV
                      </button>
                      <button
                        onClick={excluirSelecionada}
                        disabled={excluindo}
                        className="px-3 py-2 text-xs font-semibold border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-60"
                      >
                        {excluindo ? 'Excluindo...' : 'Excluir'}
                      </button>
                    </div>
                  </div>

                  <div className="text-xs text-gray-600 mb-3">
                    Itens no plano: <strong>{fmtPeca(linhasAlteradas.length)}</strong> · Retirada total: <strong>{fmtPeca(Number(selecionada.resumo?.retiradoTotal || 0))}</strong>
                  </div>

                  <div className="max-h-[60vh] overflow-auto border border-gray-200 rounded">
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0 bg-gray-100 z-10">
                        <tr>
                          <th className="text-left px-2 py-2">Ref</th>
                          <th className="text-left px-2 py-2">Cor</th>
                          <th className="text-left px-2 py-2">Tam</th>
                          <th className="text-left px-2 py-2">Plano (MA/PX/UL/QT)</th>
                          <th className="text-left px-2 py-2">Disp. (MA/PX/UL/QT)</th>
                          <th className="text-left px-2 py-2">Cob. (MA/PX/UL/QT)</th>
                          <th className="text-right px-2 py-2">Δ Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {linhasAlteradas.map((r, idx) => (
                          <tr key={`${r.chave}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
                            <td className="px-2 py-1.5 font-semibold">{r.referencia}</td>
                            <td className="px-2 py-1.5">{r.cor}</td>
                            <td className="px-2 py-1.5">{r.tamanho}</td>
                            <td className="px-2 py-1.5 whitespace-nowrap">
                              <span className="text-gray-700">{fmtPeca(r.baseMA)} / {fmtPeca(r.basePX)} / {fmtPeca(r.baseUL)} / {fmtPeca(r.baseQT)}</span>
                              <span className="mx-1 text-gray-400">→</span>
                              <span className="font-semibold text-brand-dark">{fmtPeca(r.cenarioMA)} / {fmtPeca(r.cenarioPX)} / {fmtPeca(r.cenarioUL)} / {fmtPeca(r.cenarioQT)}</span>
                            </td>
                            <td className="px-2 py-1.5 whitespace-nowrap">
                              <span className="text-gray-700">{fmtPeca(r.baseCalc.dispMA)} / {fmtPeca(r.baseCalc.dispPX)} / {fmtPeca(r.baseCalc.dispUL)} / {fmtPeca(r.baseCalc.dispQT)}</span>
                              <span className="mx-1 text-gray-400">→</span>
                              <span className="font-semibold text-brand-dark">{fmtPeca(r.cenarioCalc.dispMA)} / {fmtPeca(r.cenarioCalc.dispPX)} / {fmtPeca(r.cenarioCalc.dispUL)} / {fmtPeca(r.cenarioCalc.dispQT)}</span>
                            </td>
                            <td className="px-2 py-1.5 whitespace-nowrap">
                              <span className="text-gray-700">
                                {r.baseCalc.cobMA.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x /
                                {' '}{r.baseCalc.cobPX.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x /
                                {' '}{r.baseCalc.cobUL.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x /
                                {' '}{r.baseCalc.cobQT.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x
                              </span>
                              <span className="mx-1 text-gray-400">→</span>
                              <span className={`font-semibold ${r.cenarioCalc.cobQT < 1 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                {r.cenarioCalc.cobMA.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x /
                                {' '}{r.cenarioCalc.cobPX.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x /
                                {' '}{r.cenarioCalc.cobUL.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x /
                                {' '}{r.cenarioCalc.cobQT.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x
                              </span>
                            </td>
                            <td className={`px-2 py-1.5 text-right font-bold ${r.deltaTotal < 0 ? 'text-red-700' : (r.deltaTotal > 0 ? 'text-emerald-700' : 'text-gray-600')}`}>{fmtPeca(r.deltaTotal)}</td>
                          </tr>
                        ))}
                        {linhasAlteradas.length === 0 && (
                          <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">Sem itens no plano para esta sugestão.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
