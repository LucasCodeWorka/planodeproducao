'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';
import { projecaoMesPlanejamento } from '../lib/projecao';
import { Planejamento, PeriodosPlano, ProjecoesMap } from '../types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MARCA_FIXA = 'LIEBE';
const STATUS_FIXO = 'EM LINHA';

type VendasReaisMap = Record<string, Record<string, number>>;
type ReprojecaoPreview = {
  idproduto: string;
  recalculada: { ma: number; px: number; ul: number };
};

type MpStatus = 'OK' | 'SOLICITAR_COMPRA' | 'BLOQUEADO' | 'NA';

type MpRefDetalhe = {
  idreferencia: string;
  bloqueada?: boolean;
  materiasprimas_todas_detalhe?: Array<{
    idmateriaprima?: string;
    nome_materiaprima?: string;
    estoquetotal?: number;
    entrada_ma?: number;
    entrada_px?: number;
    entrada_ul?: number;
    consumo_ma?: number;
    consumo_px?: number;
    consumo_ul?: number;
    saldo_ma?: number;
    saldo_px?: number;
    saldo_ul?: number;
    deficit_ma?: number;
    deficit_px?: number;
    deficit_ul?: number;
  }>;
};

type Row = {
  chave: string;
  idproduto: string;
  idreferencia: string;
  referencia: string;
  cor: string;
  tamanho: string;
  continuidade: string;
  classe: string;
  estoqueAtual: number;
  emProcesso: number;
  pedidosPendentes: number;
  estoqueMin: number;
  projOriginalMA: number;
  projOriginalPX: number;
  projOriginalUL: number;
  projNovaMA: number;
  projNovaPX: number;
  projNovaUL: number;
  planoMA: number;
  planoPX: number;
  planoUL: number;
  dispAtual: number;
  dispMA: number;
  dispPX: number;
  dispUL: number;
  cobMA: number;
  cobPX: number;
  cobUL: number;
  taxaJan: number | null;
  taxaFev: number | null;
  mpMA: MpStatus;
  mpPX: MpStatus;
  mpUL: MpStatus;
  acao: 'AUMENTAR' | 'RETIRAR' | 'BLOQUEADO_MP' | 'MANTER';
  mesAcao: 'MA' | 'PX' | 'UL' | 'TODOS';
  aumentoSugerido: number;
  retiradaSugerida: number;
};

function chaveItem(item: Planejamento) {
  const id = Number(item.produto.idproduto);
  if (Number.isFinite(id)) return `ID-${id}`;
  return `REF-${item.produto.referencia || ''}-${item.produto.cor || ''}-${item.produto.tamanho || ''}`;
}

function normalizaRef(ref: string) {
  return String(ref || '').trim().toUpperCase();
}

function fmt(v: number) {
  return Math.round(Number(v || 0)).toLocaleString('pt-BR');
}

function fmtPct(v: number | null) {
  if (v === null || !Number.isFinite(v)) return '-';
  return `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function isEdicaoLimitada(continuidade: string) {
  const c = String(continuidade || '').trim().toUpperCase();
  return c === 'EDICAO LIMITADA' || c === 'EDIÇÃO LIMITADA';
}

export default function EdicaoLimitadaPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dados, setDados] = useState<Planejamento[]>([]);
  const [projecoes, setProjecoes] = useState<ProjecoesMap>({});
  const [periodos, setPeriodos] = useState<PeriodosPlano>({ MA: 3, PX: 4, UL: 5 });
  const [reprojecaoPreview, setReprojecaoPreview] = useState<ReprojecaoPreview[]>([]);
  const [considerarProjecaoNova, setConsiderarProjecaoNova] = useState(true);
  const [considerarRetiradaSugerida, setConsiderarRetiradaSugerida] = useState(false);
  const [vendasReais, setVendasReais] = useState<VendasReaisMap>({});
  const [mpDetalhe, setMpDetalhe] = useState<MpRefDetalhe[]>([]);
  const [filtroAcao, setFiltroAcao] = useState<'TODAS' | Row['acao']>('TODAS');
  const [filtroMes, setFiltroMes] = useState<'TODOS' | 'MA' | 'PX' | 'UL'>('TODOS');
  const [filtroMp, setFiltroMp] = useState<'TODOS' | 'COM_MP' | 'SEM_MP'>('TODOS');
  const [filtroNegativos, setFiltroNegativos] = useState<'TODOS' | 'NEGATIVOS' | 'SEM_NEGATIVOS'>('TODOS');
  const [filtroReferencia, setFiltroReferencia] = useState('');
  const [expandedRefs, setExpandedRefs] = useState<Set<string>>(new Set());
  const [mpModalRef, setMpModalRef] = useState<MpRefDetalhe | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregar() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '5000', marca: MARCA_FIXA, status: STATUS_FIXO });
      const [rMatriz, rProj, rReproj] = await Promise.all([
        fetchNoCache(`${API_URL}/api/producao/matriz?${params}`),
        fetchNoCache(`${API_URL}/api/projecoes`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/projecoes/reprojecao-fechada`, { headers: authHeaders() }),
      ]);
      if (!rMatriz.ok) throw new Error(`Matriz erro ${rMatriz.status}`);
      if (!rProj.ok) throw new Error(`Projeções erro ${rProj.status}`);
      if (!rReproj.ok) throw new Error(`Reprojeção erro ${rReproj.status}`);
      const pMatriz = await rMatriz.json();
      const pProj = await rProj.json();
      const pReproj = await rReproj.json();

      const rows = (Array.isArray(pMatriz?.data) ? pMatriz.data : []).filter((i: Planejamento) => isEdicaoLimitada(i.produto.continuidade || ''));
      setDados(rows);
      setProjecoes((pProj?.data || {}) as ProjecoesMap);
      if (pProj?.periodos) setPeriodos(pProj.periodos as PeriodosPlano);
      setReprojecaoPreview(Array.isArray(pReproj?.sugestoes) ? pReproj.sugestoes : []);

      const ids = rows
        .map((i: Planejamento) => Number(i.produto.idproduto))
        .filter((n: number) => Number.isFinite(n))
        .slice(0, 5000);

      if (ids.length) {
        const rReal = await fetchNoCache(`${API_URL}/api/analises/projecao-vs-venda`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ ano: new Date().getFullYear(), ids }),
        });
        if (rReal.ok) {
          const pReal = await rReal.json();
          setVendasReais((pReal?.data || {}) as VendasReaisMap);
        } else {
          setVendasReais({});
        }
      } else {
        setVendasReais({});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar edição limitada');
    } finally {
      setLoading(false);
    }
  }

  const projecoesAtivas = useMemo<ProjecoesMap>(() => {
    if (!considerarProjecaoNova || reprojecaoPreview.length === 0) return projecoes;
    const clone: ProjecoesMap = { ...projecoes };
    for (const item of reprojecaoPreview) {
      const id = String(item.idproduto || '');
      if (!id) continue;
      const base = clone[id] ? { ...clone[id] } : {};
      base[String(periodos.MA)] = Number(item.recalculada?.ma || 0);
      base[String(periodos.PX)] = Number(item.recalculada?.px || 0);
      base[String(periodos.UL)] = Number(item.recalculada?.ul || 0);
      clone[id] = base;
    }
    return clone;
  }, [considerarProjecaoNova, reprojecaoPreview, projecoes, periodos]);

  const rowsBase = useMemo<Row[]>(() => {
    return dados.map((item) => {
      const id = String(item.produto.idproduto || '');
      const estoqueAtual = Number(item.estoques.estoque_atual || 0);
      const emProcesso = Number(item.estoques.em_processo || 0);
      const pedidosPendentes = Number(item.demanda.pedidos_pendentes || 0);
      const estoqueMin = Number(item.estoques.estoque_minimo || 0);
      const dispAtual = estoqueAtual - pedidosPendentes + emProcesso;
      const planoMAOriginal = Number(item.plano?.ma || 0);
      const planoPXOriginal = Number(item.plano?.px || 0);
      const planoULOriginal = Number(item.plano?.ul || 0);
      const projOriginalMA = projecaoMesPlanejamento(Number(projecoes[id]?.[String(periodos.MA)] || 0), periodos.MA);
      const projOriginalPX = Number(projecoes[id]?.[String(periodos.PX)] || 0);
      const projOriginalUL = Number(projecoes[id]?.[String(periodos.UL)] || 0);
      const projNovaMA = projecaoMesPlanejamento(Number(projecoesAtivas[id]?.[String(periodos.MA)] || 0), periodos.MA);
      const projNovaPX = Number(projecoesAtivas[id]?.[String(periodos.PX)] || 0);
      const projNovaUL = Number(projecoesAtivas[id]?.[String(periodos.UL)] || 0);
      const vendaJan = Number(vendasReais[id]?.['1'] || 0);
      const vendaFev = Number(vendasReais[id]?.['2'] || 0);
      const projJan = Number(projecoesAtivas[id]?.['1'] || projecoes[id]?.['1'] || 0);
      const projFev = Number(projecoesAtivas[id]?.['2'] || projecoes[id]?.['2'] || 0);
      const taxaJan = projJan > 0 ? vendaJan / projJan : null;
      const taxaFev = projFev > 0 ? vendaFev / projFev : null;

      const quedaReproj =
        (projNovaMA + projNovaPX + projNovaUL) < (projOriginalMA + projOriginalPX + projOriginalUL);
      let planoMA = planoMAOriginal;
      let planoPX = planoPXOriginal;
      let planoUL = planoULOriginal;
      let dispMA = dispAtual + planoMA - projNovaMA;
      let dispPX = dispMA + planoPX - projNovaPX;
      let dispUL = dispPX + planoUL - projNovaUL;
      let cobMA = estoqueMin > 0 ? dispMA / estoqueMin : 0;
      let cobPX = estoqueMin > 0 ? dispPX / estoqueMin : 0;
      let cobUL = estoqueMin > 0 ? dispUL / estoqueMin : 0;
      const sobraEstrutural = (cobUL >= 0.8 || cobPX >= 0.8) && (planoMA + planoPX + planoUL > 0);
      const negMA = dispMA < 0;
      const negPX = dispPX < 0;
      const negUL = dispUL < 0;
      let acao: Row['acao'] = 'MANTER';
      let mesAcao: Row['mesAcao'] = 'TODOS';
      let aumentoSugerido = 0;
      let retiradaSugerida = 0;

      if (negMA || negPX || negUL) {
        acao = 'AUMENTAR';
        mesAcao = negMA ? 'MA' : negPX ? 'PX' : 'UL';
        aumentoSugerido = Math.max(0, Math.ceil(Math.abs(Math.min(dispMA, dispPX, dispUL))));
      } else if (quedaReproj && sobraEstrutural) {
        acao = 'RETIRAR';
        mesAcao = 'TODOS';
        retiradaSugerida = Math.max(0, Math.round(Math.min(planoMA + planoPX + planoUL, Math.max(0, dispUL - Math.max(0.5 * estoqueMin, 0)))));
      }

      if (considerarRetiradaSugerida && retiradaSugerida > 0) {
        let restante = retiradaSugerida;
        const tiraUL = Math.min(planoUL, restante);
        planoUL -= tiraUL;
        restante -= tiraUL;
        const tiraPX = Math.min(planoPX, restante);
        planoPX -= tiraPX;
        restante -= tiraPX;
        const tiraMA = Math.min(planoMA, restante);
        planoMA -= tiraMA;
        restante -= tiraMA;

        dispMA = dispAtual + planoMA - projNovaMA;
        dispPX = dispMA + planoPX - projNovaPX;
        dispUL = dispPX + planoUL - projNovaUL;
        cobMA = estoqueMin > 0 ? dispMA / estoqueMin : 0;
        cobPX = estoqueMin > 0 ? dispPX / estoqueMin : 0;
        cobUL = estoqueMin > 0 ? dispUL / estoqueMin : 0;
      }

      return {
        chave: chaveItem(item),
        idproduto: id,
        idreferencia: String(item.produto.cd_seqgrupo || ''),
        referencia: item.produto.referencia || '-',
        cor: item.produto.cor || '-',
        tamanho: item.produto.tamanho || '-',
        continuidade: item.produto.continuidade || '-',
        classe: item.produto.linha || item.produto.grupo || '-',
        estoqueAtual,
        emProcesso,
        pedidosPendentes,
        estoqueMin,
        projOriginalMA,
        projOriginalPX,
        projOriginalUL,
        projNovaMA,
        projNovaPX,
        projNovaUL,
        planoMA,
        planoPX,
        planoUL,
        dispAtual,
        dispMA,
        dispPX,
        dispUL,
        cobMA,
        cobPX,
        cobUL,
        taxaJan,
        taxaFev,
        mpMA: 'NA',
        mpPX: 'NA',
        mpUL: 'NA',
        acao,
        mesAcao,
        aumentoSugerido,
        retiradaSugerida,
      };
    });
  }, [dados, projecoes, projecoesAtivas, periodos, vendasReais, considerarRetiradaSugerida]);

  useEffect(() => {
    let cancelado = false;
    async function analisarMp() {
      if (!rowsBase.length) {
        setMpDetalhe([]);
        return;
      }
      try {
        const planos = rowsBase.map((r) => ({
          idproduto: r.idproduto,
          idreferencia: r.idreferencia,
          ma: Math.max(0, r.planoMA),
          px: Math.max(0, r.planoPX),
          ul: Math.max(0, r.planoUL),
        })).filter((p) => p.idproduto);
        const res = await fetchNoCache(`${API_URL}/api/consumo-mp/analise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planos, multinivel: true }),
        });
        const data = await res.json();
        if (!res.ok || !data?.success) throw new Error(data?.error || 'Erro ao validar MP');
        if (cancelado) return;
        const detalhe = Array.isArray(data?.diagnostico_ma?.refs_plano_total_detalhe) ? data.diagnostico_ma.refs_plano_total_detalhe : [];
        setMpDetalhe(detalhe);
      } catch {
        if (!cancelado) setMpDetalhe([]);
      }
    }
    analisarMp();
    return () => { cancelado = true; };
  }, [rowsBase]);

  const rows = useMemo<Row[]>(() => {
    const mpMap = new Map<string, MpRefDetalhe>();
    for (const r of mpDetalhe) {
      const k = String(r.idreferencia || '').trim();
      if (k) mpMap.set(k, r);
    }
    return rowsBase.map((r) => {
      const detalhe = mpMap.get(String(r.idreferencia || '').trim()) || mpMap.get(String(r.referencia || '').trim()) || null;
      const materias = detalhe?.materiasprimas_todas_detalhe || [];
      const mpMA: MpStatus = detalhe?.bloqueada ? 'BLOQUEADO' : materias.length ? (materias.some((m) => Number(m.saldo_ma || 0) < 0) ? 'BLOQUEADO' : 'OK') : 'NA';
      const mpPX: MpStatus = materias.length ? (materias.some((m) => Number(m.saldo_px || 0) < 0) ? 'SOLICITAR_COMPRA' : 'OK') : 'NA';
      const mpUL: MpStatus = materias.length ? (materias.some((m) => Number(m.saldo_ul || 0) < 0) ? 'SOLICITAR_COMPRA' : 'OK') : 'NA';
      let acao = r.acao;
      if (acao === 'AUMENTAR') {
        const st = r.mesAcao === 'MA' ? mpMA : r.mesAcao === 'PX' ? mpPX : mpUL;
        if (!(st === 'OK')) acao = 'BLOQUEADO_MP';
      }
      return { ...r, mpMA, mpPX, mpUL, acao };
    });
  }, [rowsBase, mpDetalhe]);

  function abrirModalMp(ref: string, idreferencia: string) {
    const k1 = String(ref || '').trim();
    const k2 = String(idreferencia || '').trim();
    const hit = mpDetalhe.find((r) => String(r.idreferencia || '').trim() === k1 || String(r.idreferencia || '').trim() === k2) || null;
    setMpModalRef(hit || { idreferencia: k1 || k2 || '-', bloqueada: false, materiasprimas_todas_detalhe: [] });
  }

  const rowsVisiveis = useMemo(() => {
    return rows.filter((r) => {
      if (filtroReferencia.trim() && !String(r.referencia || '').toLowerCase().includes(filtroReferencia.trim().toLowerCase())) return false;
      if (filtroAcao !== 'TODAS' && r.acao !== filtroAcao) return false;
      if (filtroMes !== 'TODOS' && r.mesAcao !== filtroMes) return false;
      if (filtroMp === 'COM_MP') {
        const ok = r.mpMA === 'OK' || r.mpPX === 'OK' || r.mpUL === 'OK';
        if (!ok) return false;
      }
      if (filtroMp === 'SEM_MP') {
        const sem = r.mpMA === 'BLOQUEADO' || r.mpPX === 'SOLICITAR_COMPRA' || r.mpUL === 'SOLICITAR_COMPRA';
        if (!sem) return false;
      }
      if (filtroNegativos === 'NEGATIVOS' && !(r.dispMA < 0 || r.dispPX < 0 || r.dispUL < 0)) return false;
      if (filtroNegativos === 'SEM_NEGATIVOS' && (r.dispMA < 0 || r.dispPX < 0 || r.dispUL < 0)) return false;
      return true;
    });
  }, [rows, filtroReferencia, filtroAcao, filtroMes, filtroMp, filtroNegativos]);

  const grupos = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rowsVisiveis) {
      const key = normalizaRef(r.referencia);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries())
      .map(([referencia, itens]) => ({
        referencia,
        itens: [...itens].sort((a, b) => `${a.cor}-${a.tamanho}`.localeCompare(`${b.cor}-${b.tamanho}`)),
      }))
      .sort((a, b) => a.referencia.localeCompare(b.referencia));
  }, [rowsVisiveis]);

  useEffect(() => {
    setExpandedRefs(new Set(grupos.map((g) => g.referencia)));
  }, [grupos]);

  const resumo = useMemo(() => {
    return {
      negativosMA: rows.filter((r) => r.dispMA < 0).reduce((acc, r) => acc + Math.abs(Math.min(0, r.dispMA)), 0),
      negativosPX: rows.filter((r) => r.dispPX < 0).reduce((acc, r) => acc + Math.abs(Math.min(0, r.dispPX)), 0),
      negativosUL: rows.filter((r) => r.dispUL < 0).reduce((acc, r) => acc + Math.abs(Math.min(0, r.dispUL)), 0),
      aumentoPossivel: rows.filter((r) => r.acao === 'AUMENTAR').reduce((acc, r) => acc + r.aumentoSugerido, 0),
      retiradaPossivel: rows.filter((r) => r.acao === 'RETIRAR').reduce((acc, r) => acc + r.retiradaSugerida, 0),
      bloqueados: rows.filter((r) => r.acao === 'BLOQUEADO_MP').length,
    };
  }, [rows]);

  const negativosPorCor = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const negativo = Math.abs(Math.min(0, Math.min(r.dispMA, r.dispPX, r.dispUL)));
      if (!(negativo > 0)) continue;
      const cor = String(r.cor || 'SEM COR').trim() || 'SEM COR';
      map.set(cor, (map.get(cor) || 0) + negativo);
    }
    const lista = Array.from(map.entries())
      .map(([cor, total]) => ({ cor, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
    const totalGeral = lista.reduce((acc, item) => acc + item.total, 0);
    const max = Math.max(0, ...lista.map((item) => item.total));
    return { lista, totalGeral, max };
  }, [rows]);

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 min-w-0 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="bg-brand-primary shadow-sm px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-bold text-white">Edição Limitada</h1>
              <p className="text-xs text-white/80">Visão geral de aumento, retirada, MP e atendimento do projetado em MA/PX/UL.</p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-white/90">
              <input type="checkbox" checked={considerarProjecaoNova} onChange={(e) => setConsiderarProjecaoNova(e.target.checked)} />
              Considerar projeção nova
            </label>
          </div>
        </header>

        <main className="flex-1 p-6 space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <div className="rounded-lg border border-red-200 bg-red-50 p-3"><div className="text-[11px] text-red-700">Negativos MA</div><div className="text-xl font-bold text-red-900">{fmt(resumo.negativosMA)}</div></div>
            <div className="rounded-lg border border-red-200 bg-red-50 p-3"><div className="text-[11px] text-red-700">Negativos PX</div><div className="text-xl font-bold text-red-900">{fmt(resumo.negativosPX)}</div></div>
            <div className="rounded-lg border border-red-200 bg-red-50 p-3"><div className="text-[11px] text-red-700">Negativos UL</div><div className="text-xl font-bold text-red-900">{fmt(resumo.negativosUL)}</div></div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3"><div className="text-[11px] text-emerald-700">Aumento possível</div><div className="text-xl font-bold text-emerald-900">{fmt(resumo.aumentoPossivel)}</div></div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="text-[11px] text-amber-700">Retirada possível</div><div className="text-xl font-bold text-amber-900">{fmt(resumo.retiradaPossivel)}</div></div>
            <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[11px] text-slate-500">Bloqueados MP</div><div className="text-xl font-bold text-slate-900">{fmt(resumo.bloqueados)}</div></div>
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <label className="text-xs">
                <span className="block text-slate-500 mb-1">Referência</span>
                <input
                  value={filtroReferencia}
                  onChange={(e) => setFiltroReferencia(e.target.value)}
                  placeholder="Buscar ref..."
                  className="rounded border border-slate-300 px-2 py-2"
                />
              </label>
              <label className="text-xs">
                <span className="block text-slate-500 mb-1">Ação</span>
                <select value={filtroAcao} onChange={(e) => setFiltroAcao(e.target.value as typeof filtroAcao)} className="rounded border border-slate-300 px-2 py-2">
                  <option value="TODAS">Todas</option>
                  <option value="AUMENTAR">Aumentar</option>
                  <option value="RETIRAR">Retirar</option>
                  <option value="BLOQUEADO_MP">Bloqueado MP</option>
                  <option value="MANTER">Manter</option>
                </select>
              </label>
              <label className="text-xs">
                <span className="block text-slate-500 mb-1">Mês</span>
                <select value={filtroMes} onChange={(e) => setFiltroMes(e.target.value as typeof filtroMes)} className="rounded border border-slate-300 px-2 py-2">
                  <option value="TODOS">Todos</option>
                  <option value="MA">MA</option>
                  <option value="PX">PX</option>
                  <option value="UL">UL</option>
                </select>
              </label>
              <label className="text-xs">
                <span className="block text-slate-500 mb-1">MP</span>
                <select value={filtroMp} onChange={(e) => setFiltroMp(e.target.value as typeof filtroMp)} className="rounded border border-slate-300 px-2 py-2">
                  <option value="TODOS">Todos</option>
                  <option value="COM_MP">Só com MP</option>
                  <option value="SEM_MP">Só sem MP</option>
                </select>
              </label>
              <label className="text-xs">
                <span className="block text-slate-500 mb-1">Negativos</span>
                <select value={filtroNegativos} onChange={(e) => setFiltroNegativos(e.target.value as typeof filtroNegativos)} className="rounded border border-slate-300 px-2 py-2">
                  <option value="TODOS">Todos</option>
                  <option value="NEGATIVOS">Só negativos</option>
                  <option value="SEM_NEGATIVOS">Sem negativos</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-slate-300"
                  checked={considerarRetiradaSugerida}
                  onChange={(e) => setConsiderarRetiradaSugerida(e.target.checked)}
                />
                Considerar retirada sugerida
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Representatividade de Negativos por Cor</h2>
                <p className="text-xs text-slate-500">Peças negativas acumuladas considerando o pior disponível entre MA, PX e UL.</p>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-slate-500">Total analisado</div>
                <div className="text-lg font-bold text-slate-900">{fmt(negativosPorCor.totalGeral)}</div>
              </div>
            </div>
            {negativosPorCor.lista.length === 0 ? (
              <div className="text-sm text-slate-500">Sem negativos por cor para exibir.</div>
            ) : (
              <div className="space-y-2">
                {negativosPorCor.lista.map((item) => {
                  const pct = negativosPorCor.max > 0 ? (item.total / negativosPorCor.max) * 100 : 0;
                  const share = negativosPorCor.totalGeral > 0 ? (item.total / negativosPorCor.totalGeral) * 100 : 0;
                  return (
                    <div key={item.cor} className="grid grid-cols-[120px_1fr_90px_70px] items-center gap-3">
                      <div className="text-xs font-medium text-slate-700 truncate">{item.cor}</div>
                      <div className="h-4 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-rose-400 to-red-600"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="text-right text-xs font-semibold text-slate-800">{fmt(item.total)}</div>
                      <div className="text-right text-[11px] text-slate-500">{share.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            {loading ? (
              <div className="p-8 text-sm text-slate-500">Carregando edição limitada...</div>
            ) : error ? (
              <div className="p-8 text-sm text-red-600">{error}</div>
            ) : (
              <div>
                <div className="flex items-center justify-end gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50">
                  <button
                    type="button"
                    onClick={() => setExpandedRefs(new Set(grupos.map((g) => g.referencia)))}
                    className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Expandir todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedRefs(new Set())}
                    className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Recolher todos
                  </button>
                </div>
                <div className="overflow-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-100 text-slate-900">
                    <tr>
                      <th className="sticky left-0 z-20 bg-slate-100 px-2 py-2 text-left">Ref</th>
                      <th className="px-2 py-2 text-left">Cor</th>
                      <th className="px-2 py-2 text-left">Tam</th>
                      <th className="px-2 py-2 text-left">Classe</th>
                      <th className="px-2 py-2 text-right bg-stone-50">Estoque</th>
                      <th className="px-2 py-2 text-right bg-stone-50">Ped. Pend.</th>
                      <th className="px-2 py-2 text-right bg-stone-50">Processo</th>
                      <th className="px-2 py-2 text-right bg-stone-50">Disp. Atual</th>
                      <th className="px-2 py-2 text-right">Taxa Jan</th>
                      <th className="px-2 py-2 text-right">Taxa Fev</th>
                      <th className="px-2 py-2 text-right bg-indigo-50">Proj. MA</th>
                      <th className="px-2 py-2 text-right bg-indigo-50">Proj. PX</th>
                      <th className="px-2 py-2 text-right bg-indigo-50">Proj. UL</th>
                      <th className="px-2 py-2 text-right bg-indigo-50">Plano MA</th>
                      <th className="px-2 py-2 text-right bg-indigo-50">Plano PX</th>
                      <th className="px-2 py-2 text-right bg-indigo-50">Plano UL</th>
                      <th className="px-2 py-2 text-right bg-indigo-100">Disp. MA</th>
                      <th className="px-2 py-2 text-right bg-indigo-100">Disp. PX</th>
                      <th className="px-2 py-2 text-right bg-indigo-100">Disp. UL</th>
                      <th className="px-2 py-2 text-center bg-amber-50">MP</th>
                      <th className="px-2 py-2 text-center">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupos.map((grupo) => {
                      const refOpen = expandedRefs.has(grupo.referencia);
                      const refAumento = grupo.itens.reduce((acc, r) => acc + r.aumentoSugerido, 0);
                      const refRetirada = grupo.itens.reduce((acc, r) => acc + r.retiradaSugerida, 0);
                      const bloqueada = grupo.itens.some((r) => r.acao === 'BLOQUEADO_MP');
                      const tot = grupo.itens.reduce((acc, r) => ({
                        estoqueAtual: acc.estoqueAtual + r.estoqueAtual,
                        pedidosPendentes: acc.pedidosPendentes + r.pedidosPendentes,
                        emProcesso: acc.emProcesso + r.emProcesso,
                        dispAtual: acc.dispAtual + r.dispAtual,
                        projMA: acc.projMA + r.projNovaMA,
                        projPX: acc.projPX + r.projNovaPX,
                        projUL: acc.projUL + r.projNovaUL,
                        planoMA: acc.planoMA + r.planoMA,
                        planoPX: acc.planoPX + r.planoPX,
                        planoUL: acc.planoUL + r.planoUL,
                        dispMA: acc.dispMA + r.dispMA,
                        dispPX: acc.dispPX + r.dispPX,
                        dispUL: acc.dispUL + r.dispUL,
                      }), {
                        estoqueAtual: 0,
                        pedidosPendentes: 0,
                        emProcesso: 0,
                        dispAtual: 0,
                        projMA: 0,
                        projPX: 0,
                        projUL: 0,
                        planoMA: 0,
                        planoPX: 0,
                        planoUL: 0,
                        dispMA: 0,
                        dispPX: 0,
                        dispUL: 0,
                      });
                      const mpTextoRef = grupo.itens.some((r) => r.mpMA === 'BLOQUEADO')
                        ? 'Bloqueado MA'
                        : grupo.itens.some((r) => r.mpPX === 'SOLICITAR_COMPRA' || r.mpUL === 'SOLICITAR_COMPRA')
                          ? 'Solicitar compra'
                          : grupo.itens.some((r) => r.mpMA === 'OK' || r.mpPX === 'OK' || r.mpUL === 'OK')
                            ? 'OK'
                            : '-';
                      return (
                        <Fragment key={grupo.referencia}>
                          <tr className={`${bloqueada ? 'bg-rose-100 text-rose-950' : 'bg-slate-100 text-slate-800'} border-t border-slate-200`}>
                            <td className={`sticky left-0 z-20 px-2 py-2 ${bloqueada ? 'bg-rose-100' : 'bg-slate-100'}`}>
                              <button type="button" className="mr-2" onClick={() => setExpandedRefs((prev) => {
                                const next = new Set(prev);
                                if (next.has(grupo.referencia)) next.delete(grupo.referencia); else next.add(grupo.referencia);
                                return next;
                              })}>
                                {refOpen ? '▼' : '▶'}
                              </button>
                              <button type="button" className="font-semibold hover:underline" onClick={() => abrirModalMp(grupo.referencia, grupo.itens[0]?.idreferencia || '')}>{grupo.referencia}</button>
                              {refAumento > 0 && <span className="ml-2 rounded-full bg-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-900">Aumentar {fmt(refAumento)}</span>}
                              {refRetirada > 0 && <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-900">Retirar {fmt(refRetirada)}</span>}
                            </td>
                            <td className={`px-2 py-2 ${bloqueada ? 'bg-rose-100' : 'bg-slate-100'}`}>-</td>
                            <td className={`px-2 py-2 ${bloqueada ? 'bg-rose-100' : 'bg-slate-100'}`}>-</td>
                            <td className={`px-2 py-2 ${bloqueada ? 'bg-rose-100' : 'bg-slate-100'}`}>-</td>
                            <td className={`px-2 py-2 text-right bg-stone-50 ${bloqueada ? 'bg-rose-50' : ''}`}>{fmt(tot.estoqueAtual)}</td>
                            <td className={`px-2 py-2 text-right bg-stone-50 ${bloqueada ? 'bg-rose-50' : ''}`}>{fmt(tot.pedidosPendentes)}</td>
                            <td className={`px-2 py-2 text-right bg-stone-50 ${bloqueada ? 'bg-rose-50' : ''}`}>{fmt(tot.emProcesso)}</td>
                            <td className={`px-2 py-2 text-right font-semibold bg-stone-50 ${bloqueada ? 'bg-rose-50' : ''}`}>{fmt(tot.dispAtual)}</td>
                            <td className={`px-2 py-2 text-right ${bloqueada ? 'bg-rose-100' : 'bg-slate-100'}`}>-</td>
                            <td className={`px-2 py-2 text-right ${bloqueada ? 'bg-rose-100' : 'bg-slate-100'}`}>-</td>
                            <td className={`px-2 py-2 text-right bg-indigo-50 ${bloqueada ? 'bg-rose-50' : ''}`}>{fmt(tot.projMA)}</td>
                            <td className={`px-2 py-2 text-right bg-indigo-50 ${bloqueada ? 'bg-rose-50' : ''}`}>{fmt(tot.projPX)}</td>
                            <td className={`px-2 py-2 text-right bg-indigo-50 ${bloqueada ? 'bg-rose-50' : ''}`}>{fmt(tot.projUL)}</td>
                            <td className={`px-2 py-2 text-right bg-indigo-50 ${bloqueada ? 'bg-rose-50' : ''}`}>{fmt(tot.planoMA)}</td>
                            <td className={`px-2 py-2 text-right bg-indigo-50 ${bloqueada ? 'bg-rose-50' : ''}`}>{fmt(tot.planoPX)}</td>
                            <td className={`px-2 py-2 text-right bg-indigo-50 ${bloqueada ? 'bg-rose-50' : ''}`}>{fmt(tot.planoUL)}</td>
                            <td className={`px-2 py-2 text-right font-semibold bg-indigo-100 ${tot.dispMA < 0 ? 'text-red-700' : ''} ${bloqueada ? 'bg-rose-100' : ''}`}>{fmt(tot.dispMA)}</td>
                            <td className={`px-2 py-2 text-right font-semibold bg-indigo-100 ${tot.dispPX < 0 ? 'text-red-700' : ''} ${bloqueada ? 'bg-rose-100' : ''}`}>{fmt(tot.dispPX)}</td>
                            <td className={`px-2 py-2 text-right font-semibold bg-indigo-100 ${tot.dispUL < 0 ? 'text-red-700' : ''} ${bloqueada ? 'bg-rose-100' : ''}`}>{fmt(tot.dispUL)}</td>
                            <td className={`px-2 py-2 text-center font-semibold bg-amber-50 ${mpTextoRef === 'OK' ? 'text-emerald-700' : mpTextoRef === 'Solicitar compra' ? 'text-amber-700' : mpTextoRef === 'Bloqueado MA' ? 'text-red-700' : 'text-slate-500'}`}>{mpTextoRef}</td>
                            <td className={`px-2 py-2 text-center font-semibold ${bloqueada ? 'text-rose-700' : 'text-slate-600'}`}>
                              {refAumento > 0 ? `Aumentar ${fmt(refAumento)}` : refRetirada > 0 ? `Retirar ${fmt(refRetirada)}` : 'Manter'}
                            </td>
                          </tr>
                          {refOpen && grupo.itens.map((r, idx) => {
                            const mpTexto = r.mpMA === 'BLOQUEADO' ? 'Bloqueado MA' : r.mpPX === 'SOLICITAR_COMPRA' || r.mpUL === 'SOLICITAR_COMPRA' ? 'Solicitar compra' : r.mpMA === 'OK' || r.mpPX === 'OK' || r.mpUL === 'OK' ? 'OK' : '-';
                            const rowBg = r.acao === 'AUMENTAR'
                              ? 'bg-emerald-50'
                              : r.acao === 'RETIRAR'
                                ? 'bg-amber-50'
                                : r.acao === 'BLOQUEADO_MP'
                                  ? 'bg-rose-50'
                                  : (idx % 2 === 0 ? 'bg-white' : 'bg-slate-50');
                            return (
                              <tr key={r.chave} className={`${rowBg} border-t border-slate-200`}>
                                <td className={`sticky left-0 z-10 px-2 py-1.5 font-semibold ${rowBg}`}>
                                  <button type="button" className="hover:underline" onClick={() => abrirModalMp(r.referencia, r.idreferencia)}>{r.referencia}</button>
                                </td>
                                <td className="px-2 py-1.5">{r.cor}</td>
                                <td className="px-2 py-1.5">{r.tamanho}</td>
                                <td className="px-2 py-1.5">{r.classe}</td>
                                <td className="px-2 py-1.5 text-right bg-stone-50">{fmt(r.estoqueAtual)}</td>
                                <td className="px-2 py-1.5 text-right bg-stone-50">{fmt(r.pedidosPendentes)}</td>
                                <td className="px-2 py-1.5 text-right bg-stone-50">{fmt(r.emProcesso)}</td>
                                <td className="px-2 py-1.5 text-right bg-stone-50 font-semibold">{fmt(r.dispAtual)}</td>
                                <td className="px-2 py-1.5 text-right">{fmtPct(r.taxaJan)}</td>
                                <td className="px-2 py-1.5 text-right">{fmtPct(r.taxaFev)}</td>
                                <td className="px-2 py-1.5 text-right bg-indigo-50">{fmt(r.projNovaMA)}</td>
                                <td className="px-2 py-1.5 text-right bg-indigo-50">{fmt(r.projNovaPX)}</td>
                                <td className="px-2 py-1.5 text-right bg-indigo-50">{fmt(r.projNovaUL)}</td>
                                <td className="px-2 py-1.5 text-right bg-indigo-50">{fmt(r.planoMA)}</td>
                                <td className="px-2 py-1.5 text-right bg-indigo-50">{fmt(r.planoPX)}</td>
                                <td className="px-2 py-1.5 text-right bg-indigo-50">{fmt(r.planoUL)}</td>
                                <td className={`px-2 py-1.5 text-right bg-indigo-100 ${r.dispMA < 0 ? 'text-red-700 font-semibold' : ''}`}>{fmt(r.dispMA)}</td>
                                <td className={`px-2 py-1.5 text-right bg-indigo-100 ${r.dispPX < 0 ? 'text-red-700 font-semibold' : ''}`}>{fmt(r.dispPX)}</td>
                                <td className={`px-2 py-1.5 text-right bg-indigo-100 ${r.dispUL < 0 ? 'text-red-700 font-semibold' : ''}`}>{fmt(r.dispUL)}</td>
                                <td className={`px-2 py-1.5 text-center bg-amber-50 font-semibold ${mpTexto === 'OK' ? 'text-emerald-700' : mpTexto === 'Solicitar compra' ? 'text-amber-700' : mpTexto === 'Bloqueado MA' ? 'text-red-700' : 'text-slate-500'}`}>{mpTexto}</td>
                                <td className={`px-2 py-1.5 text-center font-semibold ${r.acao === 'AUMENTAR' ? 'text-emerald-700' : r.acao === 'RETIRAR' ? 'text-amber-700' : r.acao === 'BLOQUEADO_MP' ? 'text-rose-700' : 'text-slate-500'}`}>
                                  {r.acao === 'AUMENTAR' ? `Aumentar ${fmt(r.aumentoSugerido)}` : r.acao === 'RETIRAR' ? `Retirar ${fmt(r.retiradaSugerida)}` : r.acao === 'BLOQUEADO_MP' ? 'Bloqueado MP' : 'Manter'}
                                </td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                    {grupos.length === 0 && (
                      <tr>
                        <td colSpan={21} className="px-3 py-8 text-center text-slate-500">Sem dados para exibir.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </section>
          {mpModalRef && (
            <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4">
              <div className="bg-white w-full max-w-6xl rounded-lg border border-gray-200 shadow-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-brand-dark">MPs da referência {mpModalRef.idreferencia}</div>
                    <div className="text-xs text-gray-500">Mostra tanto quando falta quanto quando é possível produzir.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMpModalRef(null)}
                    className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
                  >
                    Fechar
                  </button>
                </div>
                <div className="max-h-[72vh] overflow-auto">
                  {(!mpModalRef.materiasprimas_todas_detalhe || mpModalRef.materiasprimas_todas_detalhe.length === 0) && (
                    <div className="px-4 py-3 text-xs text-slate-500">Sem detalhe de MP para essa referência.</div>
                  )}
                  <table className="min-w-full text-[11px] leading-tight">
                    <thead className="sticky top-0 bg-gray-100 z-10">
                      <tr>
                        <th className="text-left px-2 py-1 whitespace-nowrap">MP</th>
                        <th className="text-left px-2 py-1 whitespace-nowrap">Produto</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Estoque MP</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Entr. MA</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Cons. MA</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Saldo MA</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Entr. PX</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Cons. PX</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Saldo PX</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Entr. UL</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Cons. UL</th>
                        <th className="text-right px-2 py-1 whitespace-nowrap">Saldo UL</th>
                        <th className="text-left px-2 py-1 whitespace-nowrap">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(mpModalRef.materiasprimas_todas_detalhe || []).map((m, idx) => {
                        const saldoMa = Number(m.saldo_ma || 0);
                        const saldoPx = Number(m.saldo_px || 0);
                        const saldoUl = Number(m.saldo_ul || 0);
                        const status = saldoMa < 0 ? 'Bloqueado MA' : (saldoPx < 0 || saldoUl < 0) ? 'Solicitar compra' : 'OK';
                        return (
                          <tr key={`${m.idmateriaprima || 'mp'}-${idx}`} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/70'} border-t border-gray-200`}>
                            <td className="px-2 py-1 font-semibold whitespace-nowrap">{m.idmateriaprima || '-'}</td>
                            <td className="px-2 py-1 whitespace-nowrap">{String(m.nome_materiaprima || '-')}</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap">{fmt(Number(m.estoquetotal || 0))}</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap text-sky-700">{fmt(Number(m.entrada_ma || 0))}</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap">{fmt(Number(m.consumo_ma || 0))}</td>
                            <td className={`px-2 py-1 text-right whitespace-nowrap ${saldoMa < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmt(saldoMa)}</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap text-sky-700">{fmt(Number(m.entrada_px || 0))}</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap">{fmt(Number(m.consumo_px || 0))}</td>
                            <td className={`px-2 py-1 text-right whitespace-nowrap ${saldoPx < 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{fmt(saldoPx)}</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap text-sky-700">{fmt(Number(m.entrada_ul || 0))}</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap">{fmt(Number(m.consumo_ul || 0))}</td>
                            <td className={`px-2 py-1 text-right whitespace-nowrap ${saldoUl < 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{fmt(saldoUl)}</td>
                            <td className={`px-2 py-1 whitespace-nowrap font-semibold ${status === 'OK' ? 'text-emerald-700' : status === 'Bloqueado MA' ? 'text-red-700' : 'text-amber-700'}`}>{status}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
