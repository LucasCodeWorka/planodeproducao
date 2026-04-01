'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type PlanoSnapshotItem = { chave: string; ma: number; px: number; ul: number; qt?: number };
type SavedSugestaoPlano = {
  id: string;
  nome: string;
  createdAt: number;
  parametros?: {
    tipo?: string;
    subtipo?: string;
    statusAprovacao?: 'PENDENTE' | 'APROVADA';
    periodoAlvo?: 'MA' | 'PX' | 'UL' | 'QT';
    maModo?: 'EMERGENCIA' | 'COBERTURA' | null;
    planos?: PlanoSnapshotItem[];
  };
  resumo?: {
    alterados?: number;
    deltaTotal?: number;
    aumentoTotal?: number;
    retiradaTotal?: number;
  };
  observacoes?: string;
};

type MpRow = {
  idmateriaprima: string;
  nome_materiaprima?: string;
  artigo?: string;
  estoquetotal: number;
  entrada_ma?: number;
  entrada_px?: number;
  entrada_ul?: number;
  consumo_ma: number;
  consumo_px: number;
  consumo_ul: number;
  consumo_total: number;
  saldo_ma: number;
  saldo_px: number;
  saldo_ul: number;
  saldo: number;
};

type RefRow = {
  idreferencia: string;
  bloqueada?: boolean;
  materiasprimas_criticas?: string[];
  materiasprimas_criticas_detalhe?: Array<{
    idmateriaprima: string;
    nome_materiaprima?: string;
    artigo?: string;
    saldo_ma: number;
    saldo_px?: number;
    saldo_ul?: number;
  }>;
  materiasprimas_todas_detalhe?: Array<{
    idmateriaprima: string;
    nome_materiaprima?: string;
    artigo?: string;
    saldo_ma: number;
    saldo_px?: number;
    saldo_ul?: number;
  }>;
};

type PeriodoFiltro = 'TODOS' | 'MA' | 'PX' | 'UL';

function fmt(v: number, d = 0) {
  return Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function compraNecessaria(row: MpRow, periodo: PeriodoFiltro) {
  if (periodo === 'MA') return Math.max(0, -Number(row.saldo_ma || 0));
  if (periodo === 'PX') return Math.max(0, -Number(row.saldo_px || 0));
  if (periodo === 'UL') return Math.max(0, -Number(row.saldo_ul || 0));
  return Math.max(0, -Math.min(0, Number(row.saldo_ma || 0), Number(row.saldo_px || 0), Number(row.saldo_ul || 0)));
}

function periodoCritico(row: MpRow, periodo: PeriodoFiltro) {
  if (periodo !== 'TODOS') return periodo;
  if (Number(row.saldo_ma || 0) < 0) return 'MA';
  if (Number(row.saldo_px || 0) < 0) return 'PX';
  if (Number(row.saldo_ul || 0) < 0) return 'UL';
  return 'OK';
}

export default function AnaliseMpPlanosPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [analisando, setAnalisando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulacoes, setSimulacoes] = useState<SavedSugestaoPlano[]>([]);
  const [selecionadaId, setSelecionadaId] = useState('');
  const [rowsMp, setRowsMp] = useState<MpRow[]>([]);
  const [refsPlano, setRefsPlano] = useState<RefRow[]>([]);
  const [somenteCompra, setSomenteCompra] = useState(true);
  const [periodoFiltro, setPeriodoFiltro] = useState<PeriodoFiltro>('TODOS');
  const [artigoFiltro, setArtigoFiltro] = useState('TODOS');

  const selecionada = useMemo(
    () => simulacoes.find((s) => s.id === selecionadaId) || null,
    [simulacoes, selecionadaId]
  );

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregarSimulacoes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregarSimulacoes() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchNoCache(`${API_URL}/api/simulacoes`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Erro ${res.status} ao carregar simulacoes`);
      const data = await res.json();
      const lista = (Array.isArray(data?.data) ? data.data : []) as SavedSugestaoPlano[];
      const filtradas = lista
        .filter((s) => s?.parametros?.tipo === 'SUGESTAO_PLANO' && Array.isArray(s?.parametros?.planos))
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      setSimulacoes(filtradas);
      if (filtradas.length > 0) setSelecionadaId((prev) => prev || filtradas[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar simulacoes');
    } finally {
      setLoading(false);
    }
  }

  async function analisarSelecionada(id = selecionadaId) {
    const sim = simulacoes.find((s) => s.id === id);
    const planos = Array.isArray(sim?.parametros?.planos) ? sim!.parametros!.planos! : [];
    if (!sim || !planos.length) {
      setError('Selecione uma simulacao com planos salvos.');
      return;
    }

    setAnalisando(true);
    setError(null);
    try {
      const payload = {
        planos: planos.map((p) => ({
          chave: p.chave,
          idproduto: String(p.chave || '').startsWith('ID-') ? String(p.chave).replace(/^ID-/, '') : '',
          ma: Number(p.ma || 0),
          px: Number(p.px || 0),
          ul: Number(p.ul || 0),
        })),
        multinivel: true,
      };

      const res = await fetchNoCache(`${API_URL}/api/consumo-mp/analise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Erro ao analisar consumo de MP');
      setRowsMp(Array.isArray(data?.data) ? data.data : []);
      setRefsPlano(Array.isArray(data?.diagnostico_ma?.refs_plano_total_detalhe) ? data.diagnostico_ma.refs_plano_total_detalhe : []);
    } catch (e) {
      setRowsMp([]);
      setRefsPlano([]);
      setError(e instanceof Error ? e.message : 'Erro ao analisar plano salvo');
    } finally {
      setAnalisando(false);
    }
  }

  useEffect(() => {
    if (!selecionadaId || simulacoes.length === 0) return;
    analisarSelecionada(selecionadaId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionadaId, simulacoes.length]);

  const opcoesArtigo = useMemo(() => {
    return ['TODOS', ...Array.from(new Set(rowsMp.map((r) => String(r.artigo || '-').trim() || '-'))).sort((a, b) => a.localeCompare(b))];
  }, [rowsMp]);

  const rowsMpView = useMemo(() => {
    let base = somenteCompra ? rowsMp.filter((r) => compraNecessaria(r, periodoFiltro) > 0) : rowsMp;
    if (periodoFiltro === 'MA') base = base.filter((r) => Number(r.saldo_ma || 0) < 0);
    if (periodoFiltro === 'PX') base = base.filter((r) => Number(r.saldo_px || 0) < 0);
    if (periodoFiltro === 'UL') base = base.filter((r) => Number(r.saldo_ul || 0) < 0);
    if (artigoFiltro !== 'TODOS') base = base.filter((r) => (String(r.artigo || '-').trim() || '-') === artigoFiltro);
    return [...base].sort((a, b) => compraNecessaria(b, periodoFiltro) - compraNecessaria(a, periodoFiltro));
  }, [rowsMp, somenteCompra, periodoFiltro, artigoFiltro]);

  const artigosView = useMemo(() => {
    const map = new Map<string, {
      artigo: string;
      itens: number;
      estoque: number;
      entradas: number;
      consumo: number;
      saldoMA: number;
      saldoPX: number;
      saldoUL: number;
      comprar: number;
    }>();

    rowsMpView.forEach((r) => {
      const artigo = String(r.artigo || '-').trim() || '-';
      const atual = map.get(artigo) || {
        artigo,
        itens: 0,
        estoque: 0,
        entradas: 0,
        consumo: 0,
        saldoMA: 0,
        saldoPX: 0,
        saldoUL: 0,
        comprar: 0,
      };
      atual.itens += 1;
      atual.estoque += Number(r.estoquetotal || 0);
      atual.entradas += Number(r.entrada_ma || 0) + Number(r.entrada_px || 0) + Number(r.entrada_ul || 0);
      atual.consumo += Number(r.consumo_total || 0);
      atual.saldoMA += Number(r.saldo_ma || 0);
      atual.saldoPX += Number(r.saldo_px || 0);
      atual.saldoUL += Number(r.saldo_ul || 0);
      atual.comprar += compraNecessaria(r, periodoFiltro);
      map.set(artigo, atual);
    });

    return Array.from(map.values()).sort((a, b) => b.comprar - a.comprar);
  }, [rowsMpView, periodoFiltro]);

  const refsView = useMemo(() => {
    return [...refsPlano]
      .map((r) => {
        const materias = r.materiasprimas_todas_detalhe || r.materiasprimas_criticas_detalhe || [];
        const faltaCompra = materias.some((m) => Number(m.saldo_ma || 0) < 0 || Number(m.saldo_px || 0) < 0 || Number(m.saldo_ul || 0) < 0);
        const faltaMA = materias.some((m) => Number(m.saldo_ma || 0) < 0);
        const faltaPX = materias.some((m) => Number(m.saldo_px || 0) < 0);
        const faltaUL = materias.some((m) => Number(m.saldo_ul || 0) < 0);
        return { ...r, faltaCompra, faltaMA, faltaPX, faltaUL };
      })
      .filter((r) => {
        if (periodoFiltro === 'MA') return r.faltaMA;
        if (periodoFiltro === 'PX') return r.faltaPX;
        if (periodoFiltro === 'UL') return r.faltaUL;
        return true;
      })
      .filter((r) => {
        if (artigoFiltro === 'TODOS') return true;
        const materias = r.materiasprimas_todas_detalhe || r.materiasprimas_criticas_detalhe || [];
        return materias.some((m) => (String(m.artigo || '-').trim() || '-') === artigoFiltro);
      })
      .sort((a, b) => Number(b.faltaCompra) - Number(a.faltaCompra));
  }, [refsPlano, periodoFiltro, artigoFiltro]);

  const resumo = useMemo(() => {
    let compra = 0;
    let deficitMA = 0;
    let deficitPX = 0;
    let deficitUL = 0;
    rowsMpView.forEach((r) => {
      compra += compraNecessaria(r, periodoFiltro);
      deficitMA += Math.max(0, -Number(r.saldo_ma || 0));
      deficitPX += Math.max(0, -Number(r.saldo_px || 0));
      deficitUL += Math.max(0, -Number(r.saldo_ul || 0));
    });
    const refsComFalta = refsView.filter((r) => r.faltaCompra).length;
    return {
      compra,
      deficitMA,
      deficitPX,
      deficitUL,
      mpsCriticas: rowsMpView.filter((r) => compraNecessaria(r, periodoFiltro) > 0).length,
      refsComFalta,
    };
  }, [rowsMpView, refsView, periodoFiltro]);

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="bg-brand-primary shadow-sm px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-white font-bold font-secondary tracking-wide text-base">ANALISE MP DE PLANOS</h1>
            <p className="text-white/70 text-xs">Compra necessaria para produzir a sugestao salva</p>
          </div>
        </header>

        <main className="flex-1 px-6 py-5 space-y-4">
          {loading && <div className="bg-white border rounded-lg p-4 text-sm text-gray-500">Carregando simulacoes...</div>}
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}

          {!loading && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-brand-dark mb-1">Simulacao salva</label>
                  <select value={selecionadaId} onChange={(e) => setSelecionadaId(e.target.value)} className="w-full lg:w-[520px] border border-gray-300 rounded px-3 py-2 text-sm">
                    {simulacoes.length === 0 && <option value="">Nenhuma sugestao salva</option>}
                    {simulacoes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nome} · {new Date(s.createdAt).toLocaleString('pt-BR')}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={somenteCompra} onChange={(e) => setSomenteCompra(e.target.checked)} />
                    Mostrar so MPs com compra
                  </label>
                  <label className="text-sm text-gray-700">
                    Artigo
                    <select value={artigoFiltro} onChange={(e) => setArtigoFiltro(e.target.value)} className="ml-2 border border-gray-300 rounded px-2 py-1.5 text-sm">
                      {opcoesArtigo.map((artigo) => (
                        <option key={artigo} value={artigo}>{artigo}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-gray-700">
                    Periodo
                    <select value={periodoFiltro} onChange={(e) => setPeriodoFiltro(e.target.value as PeriodoFiltro)} className="ml-2 border border-gray-300 rounded px-2 py-1.5 text-sm">
                      <option value="TODOS">Todos</option>
                      <option value="MA">MA</option>
                      <option value="PX">PX</option>
                      <option value="UL">UL</option>
                    </select>
                  </label>
                  <button onClick={() => analisarSelecionada()} disabled={!selecionadaId || analisando} className="px-4 py-2 rounded bg-brand-primary text-white text-sm font-semibold disabled:opacity-60">
                    {analisando ? 'Analisando...' : 'Analisar'}
                  </button>
                </div>
              </div>

              {selecionada && (
                <div className="text-sm text-gray-600">
                  <span className="font-semibold text-brand-dark">{selecionada.parametros?.subtipo || 'SUGESTAO_PLANO'}</span>
                  {' · '}
                  <span>Status: {selecionada.parametros?.statusAprovacao || 'PENDENTE'}</span>
                  {' · '}
                  <span>Alterados: {fmt(Number(selecionada.resumo?.alterados || 0))}</span>
                  {selecionada.observacoes ? ` · ${selecionada.observacoes}` : ''}
                </div>
              )}
            </div>
          )}

          {!loading && selecionada && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <Card label="MPs com compra" value={fmt(resumo.mpsCriticas)} tone="red" />
                <Card label="Compra necessaria" value={fmt(resumo.compra)} tone="red" />
                <Card label="Deficit MA" value={fmt(resumo.deficitMA)} tone="red" />
                <Card label="Deficit PX" value={fmt(resumo.deficitPX)} tone="amber" />
                <Card label="Deficit UL" value={fmt(resumo.deficitUL)} tone="amber" />
                <Card label="Refs afetadas" value={fmt(resumo.refsComFalta)} tone="stone" />
              </div>

              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200">
                  <div className="text-sm font-semibold text-brand-dark">Resumo por Artigo</div>
                  <div className="text-xs text-gray-500">Consolidado do recorte atual</div>
                </div>
                <div className="overflow-x-auto border-b border-gray-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-3 py-2 text-left">Artigo</th>
                        <th className="px-3 py-2 text-right">Itens</th>
                        <th className="px-3 py-2 text-right">Estoque</th>
                        <th className="px-3 py-2 text-right">Entradas</th>
                        <th className="px-3 py-2 text-right">Consumo</th>
                        <th className="px-3 py-2 text-right">Saldo MA</th>
                        <th className="px-3 py-2 text-right">Saldo PX</th>
                        <th className="px-3 py-2 text-right">Saldo UL</th>
                        <th className="px-3 py-2 text-right">Comprar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {artigosView.map((r) => (
                        <tr key={r.artigo} className="border-t border-gray-100">
                          <td className="px-3 py-2 font-medium text-brand-dark">{r.artigo}</td>
                          <td className="px-3 py-2 text-right">{fmt(r.itens)}</td>
                          <td className="px-3 py-2 text-right">{fmt(r.estoque)}</td>
                          <td className="px-3 py-2 text-right">{fmt(r.entradas)}</td>
                          <td className="px-3 py-2 text-right">{fmt(r.consumo)}</td>
                          <td className={`px-3 py-2 text-right ${r.saldoMA < 0 ? 'text-red-700 font-semibold' : 'text-emerald-700'}`}>{fmt(r.saldoMA)}</td>
                          <td className={`px-3 py-2 text-right ${r.saldoPX < 0 ? 'text-red-700 font-semibold' : 'text-emerald-700'}`}>{fmt(r.saldoPX)}</td>
                          <td className={`px-3 py-2 text-right ${r.saldoUL < 0 ? 'text-red-700 font-semibold' : 'text-emerald-700'}`}>{fmt(r.saldoUL)}</td>
                          <td className={`px-3 py-2 text-right font-semibold ${r.comprar > 0 ? 'text-red-700' : 'text-gray-700'}`}>{fmt(r.comprar)}</td>
                        </tr>
                      ))}
                      {artigosView.length === 0 && (
                        <tr>
                          <td colSpan={9} className="px-3 py-6 text-center text-sm text-gray-500">Nenhum artigo encontrado neste recorte.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-brand-dark">Lista de Compra de MP</div>
                    <div className="text-xs text-gray-500">Saldo ja considera estoque atual, conferencia, corte e entradas a receber</div>
                  </div>
                  <div className="text-xs text-gray-500">{fmt(rowsMpView.length)} MPs na lista</div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-3 py-2 text-left">MP</th>
                        <th className="px-3 py-2 text-left">Artigo</th>
                        <th className="px-3 py-2 text-right">Estoque</th>
                        <th className="px-3 py-2 text-right">Entrada MA</th>
                        <th className="px-3 py-2 text-right">Entrada PX</th>
                        <th className="px-3 py-2 text-right">Entrada UL</th>
                        <th className="px-3 py-2 text-right">Consumo Total</th>
                        <th className="px-3 py-2 text-right">Saldo MA</th>
                        <th className="px-3 py-2 text-right">Saldo PX</th>
                        <th className="px-3 py-2 text-right">Saldo UL</th>
                        <th className="px-3 py-2 text-right">Comprar</th>
                        <th className="px-3 py-2 text-center">Periodo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rowsMpView.map((r) => {
                        const comprar = compraNecessaria(r, periodoFiltro);
                        const periodo = periodoCritico(r, periodoFiltro);
                        return (
                          <tr key={r.idmateriaprima} className="border-t border-gray-100">
                            <td className="px-3 py-2">
                              <div className="font-medium text-brand-dark">{r.idmateriaprima}</div>
                              <div className="text-xs text-gray-500">{r.nome_materiaprima || '-'}</div>
                            </td>
                            <td className="px-3 py-2 text-gray-700">{r.artigo || '-'}</td>
                            <td className="px-3 py-2 text-right">{fmt(r.estoquetotal)}</td>
                            <td className="px-3 py-2 text-right">{fmt(Number(r.entrada_ma || 0))}</td>
                            <td className="px-3 py-2 text-right">{fmt(Number(r.entrada_px || 0))}</td>
                            <td className="px-3 py-2 text-right">{fmt(Number(r.entrada_ul || 0))}</td>
                            <td className="px-3 py-2 text-right">{fmt(r.consumo_total)}</td>
                            <td className={`px-3 py-2 text-right ${Number(r.saldo_ma || 0) < 0 ? 'text-red-700 font-semibold' : 'text-emerald-700'}`}>{fmt(r.saldo_ma)}</td>
                            <td className={`px-3 py-2 text-right ${Number(r.saldo_px || 0) < 0 ? 'text-red-700 font-semibold' : 'text-emerald-700'}`}>{fmt(r.saldo_px)}</td>
                            <td className={`px-3 py-2 text-right ${Number(r.saldo_ul || 0) < 0 ? 'text-red-700 font-semibold' : 'text-emerald-700'}`}>{fmt(r.saldo_ul)}</td>
                            <td className={`px-3 py-2 text-right font-semibold ${comprar > 0 ? 'text-red-700' : 'text-gray-700'}`}>{fmt(comprar)}</td>
                            <td className={`px-3 py-2 text-center font-semibold ${periodo === 'OK' ? 'text-emerald-700' : 'text-red-700'}`}>{periodo}</td>
                          </tr>
                        );
                      })}
                      {rowsMpView.length === 0 && (
                        <tr>
                          <td colSpan={12} className="px-3 py-6 text-center text-sm text-gray-500">Nenhuma MP com necessidade de compra neste recorte.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200">
                  <div className="text-sm font-semibold text-brand-dark">Impacto por Referencia</div>
                  <div className="text-xs text-gray-500">Quais referencias do plano salvo ficam com falta de MP</div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-3 py-2 text-left">Referencia</th>
                        <th className="px-3 py-2 text-center">Status</th>
                        <th className="px-3 py-2 text-right">MPs criticas</th>
                        <th className="px-3 py-2 text-left">Principais MPs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {refsView.map((r) => {
                        const materias = (r.materiasprimas_criticas_detalhe || r.materiasprimas_todas_detalhe || []).slice(0, 3);
                        return (
                          <tr key={r.idreferencia} className="border-t border-gray-100">
                            <td className="px-3 py-2 font-medium text-brand-dark">{r.idreferencia}</td>
                            <td className={`px-3 py-2 text-center font-semibold ${r.faltaCompra ? 'text-red-700' : 'text-emerald-700'}`}>
                              {r.faltaCompra ? 'COMPRAR MP' : 'OK'}
                            </td>
                            <td className="px-3 py-2 text-right">{fmt((r.materiasprimas_criticas || []).length)}</td>
                            <td className="px-3 py-2 text-gray-700">
                              {materias.length ? materias.map((m) => `${m.idmateriaprima} (${m.nome_materiaprima || '-'})`).join(' · ') : '-'}
                            </td>
                          </tr>
                        );
                      })}
                      {refsView.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-500">Nenhum detalhamento por referencia retornado pela analise.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone: 'red' | 'amber' | 'stone' }) {
  const toneMap = {
    red: 'bg-red-50 border-red-100 text-red-700',
    amber: 'bg-amber-50 border-amber-100 text-amber-700',
    stone: 'bg-stone-50 border-stone-200 text-stone-700',
  } as const;

  return (
    <div className={`rounded-lg border p-4 ${toneMap[tone]}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
