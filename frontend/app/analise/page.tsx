'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { PeriodosPlano, Planejamento, ProjecoesMap } from '../types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MARCA_FIXA = 'LIEBE';
const STATUS_FIXO = 'EM LINHA';
const MESES_PT = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
type MesPlanoKey = 'ma' | 'px' | 'ul';
const LIMIAR_VARIACAO_PCT = 30;

type SavedAnalise = {
  id: string;
  nome: string;
  createdAt: number;
  parametros: {
    projecaoPct: number;
    planoPct: number;
    coberturaPecas: number;
    coberturaDemais: number;
    mesAlvo: number;
  };
  resumo: {
    itens: number;
    negativosMA: number;
    negativosPX: number;
    negativosUL: number;
    deficitTotal: number;
    gargalos: number;
    coberturasMelhorar: number;
  };
  observacoes: string;
};

type CalcRow = {
  idproduto: string;
  referencia: string;
  produto: string;
  continuidade: string;
  estoqueMin: number;
  projMA: number;
  projPX: number;
  projUL: number;
  dispMA: number;
  dispPX: number;
  dispUL: number;
  cobMA: number | null;
  cobPX: number | null;
  cobUL: number | null;
  tendenciaPct: number;
};

function fmt(v: number, d = 0) {
  return Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function distribuirAjuste(total: number, pesos: [number, number, number], limites?: [number, number, number]) {
  const bruto = pesos.map((p) => total * p);
  const base = bruto.map((v) => Math.floor(v));
  let restante = Math.max(0, Math.round(total - base.reduce((a, b) => a + b, 0)));

  const ordemFracao = bruto
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  for (const { i } of ordemFracao) {
    if (restante <= 0) break;
    base[i] += 1;
    restante -= 1;
  }

  if (!limites) return base as [number, number, number];

  const out: [number, number, number] = [
    Math.min(base[0], Math.max(0, Math.floor(limites[0]))),
    Math.min(base[1], Math.max(0, Math.floor(limites[1]))),
    Math.min(base[2], Math.max(0, Math.floor(limites[2]))),
  ];

  let sobra = Math.max(0, Math.round(total - (out[0] + out[1] + out[2])));
  const ordemReposicao = [2, 1, 0];
  for (const idx of ordemReposicao) {
    if (sobra <= 0) break;
    const limite = Math.max(0, Math.floor(limites[idx]));
    const folga = Math.max(0, limite - out[idx]);
    if (folga <= 0) continue;
    const add = Math.min(folga, sobra);
    out[idx] += add;
    sobra -= add;
  }

  return out;
}

export default function AnalisePage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [dados, setDados] = useState<Planejamento[]>([]);
  const [projecoes, setProjecoes] = useState<ProjecoesMap>({});
  const [vendasReais, setVendasReais] = useState<Record<string, Record<string, number>>>({});
  const [top30Ids, setTop30Ids] = useState<Set<string>>(new Set());
  const [periodos, setPeriodos] = useState<PeriodosPlano>({
    MA: new Date().getMonth() + 1,
    PX: new Date().getMonth() + 2,
    UL: new Date().getMonth() + 3,
  });
  const [saved, setSaved] = useState<SavedAnalise[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingVendas, setLoadingVendas] = useState(false);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [nomeAnalise, setNomeAnalise] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [projecaoPct, setProjecaoPct] = useState(0);
  const [planoPct, setPlanoPct] = useState(0);
  const [coberturaPecas, setCoberturaPecas] = useState(1.5);
  const [coberturaDemais, setCoberturaDemais] = useState(0.7);
  const [mesAlvo, setMesAlvo] = useState(6);
  const [modoListaSugestao, setModoListaSugestao] = useState<'top30' | 'com_sugestao' | 'todos'>('com_sugestao');
  const [modoTendencia, setModoTendencia] = useState<'todos' | 'alta' | 'queda'>('todos');
  const [mesAjustePlano, setMesAjustePlano] = useState<MesPlanoKey>('ma');
  const [expandedContAnalise, setExpandedContAnalise] = useState<Set<string>>(new Set());
  const [expandedRefAnalise, setExpandedRefAnalise] = useState<Set<string>>(new Set());

  const mesAjusteNumero = useMemo(() => {
    if (mesAjustePlano === 'ma') return periodos.MA;
    if (mesAjustePlano === 'px') return periodos.PX;
    return periodos.UL;
  }, [mesAjustePlano, periodos]);

  const mesAjusteNome = MESES_PT[mesAjusteNumero];

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
    setErro(null);
    try {
      const params = new URLSearchParams({
        limit: '5000',
        marca: MARCA_FIXA,
        status: STATUS_FIXO,
      });

      const [rMatriz, rProj, rSaved, rTop30] = await Promise.all([
        fetch(`${API_URL}/api/producao/matriz?${params}`),
        fetch(`${API_URL}/api/projecoes`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/simulacoes`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/analises/top30-produtos`, { headers: authHeaders() }),
      ]);

      if (!rMatriz.ok) throw new Error(`Matriz erro ${rMatriz.status}`);
      if (!rProj.ok) throw new Error(`Projeções erro ${rProj.status}`);
      if (!rSaved.ok) throw new Error(`Simulações erro ${rSaved.status}`);
      if (!rTop30.ok) throw new Error(`Top30 erro ${rTop30.status}`);

      const pMatriz = await rMatriz.json();
      const pProj = await rProj.json();
      const pSaved = await rSaved.json();
      const pTop30 = await rTop30.json();

      setDados(pMatriz.data || []);
      setProjecoes((pProj && pProj.data) || {});
      if (pProj && pProj.periodos) setPeriodos(pProj.periodos);
      setSaved((pSaved && pSaved.data) || []);
      setTop30Ids(new Set(((pTop30 && pTop30.ids) || []).map((v: string) => String(v))));

      // Carrega vendas reais em segundo plano para não travar a página
      const ids = (pMatriz.data || [])
        .map((i: Planejamento) => Number(i.produto.idproduto))
        .filter((n: number) => Number.isFinite(n))
        .slice(0, 2500);
      carregarVendasReais(ids);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar análise');
    } finally {
      setLoading(false);
    }
  }

  async function carregarVendasReais(ids: number[]) {
    if (!ids.length) {
      setVendasReais({});
      return;
    }

    setLoadingVendas(true);
    try {
      const rReal = await fetch(`${API_URL}/api/analises/projecao-vs-venda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ano: new Date().getFullYear(), ids }),
      });
      if (!rReal.ok) throw new Error(`Vendas reais erro ${rReal.status}`);
      const pReal = await rReal.json();
      setVendasReais((pReal && pReal.data) || {});
    } catch {
      // Não bloqueia a tela principal
      setVendasReais({});
    } finally {
      setLoadingVendas(false);
    }
  }

  const calcRows = useMemo<CalcRow[]>(() => {
    const fatorProj = 1 + projecaoPct / 100;
    const fatorPlano = 1 + planoPct / 100;
    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();
    const diasNoMesAtual = new Date(anoAtual, mesAtual, 0).getDate();
    const diaAtual = Math.min(hoje.getDate(), diasNoMesAtual);
    const fatorProjecaoMA = periodos.MA === mesAtual
      ? Math.max(0, (diasNoMesAtual - diaAtual) / diasNoMesAtual)
      : 1;

    return dados.map((i) => {
      const proj = projecoes[i.produto.idproduto] || {};
      const projMA = (proj[String(periodos.MA)] || 0) * fatorProj * fatorProjecaoMA;
      const projPX = (proj[String(periodos.PX)] || 0) * fatorProj;
      const projUL = (proj[String(periodos.UL)] || 0) * fatorProj;

      const planoMA = (i.plano?.ma || 0) * fatorPlano;
      const planoPX = (i.plano?.px || 0) * fatorPlano;
      const planoUL = (i.plano?.ul || 0) * fatorPlano;

      const dispBase = (i.estoques.estoque_atual || 0) - (i.demanda.pedidos_pendentes || 0);
      const dispMA = dispBase + (i.estoques.em_processo || 0) + planoMA - projMA;
      const dispPX = dispMA + planoPX - projPX;
      const dispUL = dispPX + planoUL - projUL;
      const estMin = i.estoques.estoque_minimo || 0;

      const cobMA = estMin > 0 ? dispMA / estMin : null;
      const cobPX = estMin > 0 ? dispPX / estMin : null;
      const cobUL = estMin > 0 ? dispUL / estMin : null;
      const tendenciaPct = projMA > 0 ? ((projUL - projMA) / projMA) * 100 : 0;

      return {
        idproduto: i.produto.idproduto,
        referencia: i.produto.referencia || '',
        produto: i.produto.produto || i.produto.apresentacao || '',
        continuidade: i.produto.continuidade || 'SEM CONTINUIDADE',
        estoqueMin: estMin,
        projMA,
        projPX,
        projUL,
        dispMA,
        dispPX,
        dispUL,
        cobMA,
        cobPX,
        cobUL,
        tendenciaPct,
      };
    });
  }, [dados, projecoes, periodos, projecaoPct, planoPct]);

  const resumo = useMemo(() => {
    const negativosMA = calcRows.filter((r) => r.dispMA < 0).length;
    const negativosPX = calcRows.filter((r) => r.dispPX < 0).length;
    const negativosUL = calcRows.filter((r) => r.dispUL < 0).length;
    const deficitTotal = calcRows.reduce((acc, r) => {
      const menor = Math.min(r.dispMA, r.dispPX, r.dispUL);
      return acc + (menor < 0 ? menor : 0);
    }, 0);
    return { negativosMA, negativosPX, negativosUL, deficitTotal };
  }, [calcRows]);

  const gargalos = useMemo(() => {
    return [...calcRows]
      .map((r) => ({ ...r, piorDisp: Math.min(r.dispMA, r.dispPX, r.dispUL) }))
      .filter((r) => r.piorDisp < 0)
      .sort((a, b) => a.piorDisp - b.piorDisp)
      .slice(0, 20);
  }, [calcRows]);

  const coberturasMelhorar = useMemo(() => {
    return [...calcRows]
      .filter((r) => r.tendenciaPct > 0 && (r.cobUL !== null && r.cobUL < coberturaPecas))
      .sort((a, b) => (a.cobUL || 999) - (b.cobUL || 999))
      .slice(0, 20);
  }, [calcRows, coberturaPecas]);

  const sugestaoMesAlvo = useMemo(() => {
    const fatorProj = 1 + projecaoPct / 100;

    const rows = calcRows.map((r) => {
      const projSku = projecoes[r.idproduto] || {};
      const projMesAlvo = (Number(projSku[String(mesAlvo)] || 0)) * fatorProj;

      const isPeca = top30Ids.has(String(r.idproduto));
      const coberturaTarget = isPeca ? coberturaPecas : coberturaDemais;
      const targetEstoque = Math.max(0, (r.estoqueMin || 0) * coberturaTarget);

      // dispUL = posição após MA/PX/UL. Mês alvo parte desse saldo.
      const planoSugerido = Math.max(0, targetEstoque + projMesAlvo - r.dispUL);
      const dispPosMesAlvo = r.dispUL + planoSugerido - projMesAlvo;
      const coberturaPosMesAlvo = r.estoqueMin > 0 ? dispPosMesAlvo / r.estoqueMin : null;

      return {
        ...r,
        isPeca,
        coberturaTarget,
        projMesAlvo,
        planoSugerido,
        dispPosMesAlvo,
        coberturaPosMesAlvo,
      };
    });

    const totalSugerido = rows.reduce((acc, r) => acc + r.planoSugerido, 0);
    const rowsOrdenadas = [...rows].sort((a, b) => b.planoSugerido - a.planoSugerido);
    const comSugestao = rowsOrdenadas.filter((r) => r.planoSugerido > 0);
    const comPlanoAtual = rows.filter((r) => {
      const base = dados.find((d) => d.produto.idproduto === r.idproduto);
      const somaPlanoAtual = (base?.plano?.ma || 0) + (base?.plano?.px || 0) + (base?.plano?.ul || 0);
      return somaPlanoAtual > 0;
    }).length;

    return {
      totalSugerido,
      totalItens: rows.length,
      comPlanoAtual,
      rowsOrdenadas,
      comSugestao,
      top30: rowsOrdenadas.slice(0, 30),
    };
  }, [
    calcRows,
    projecoes,
    top30Ids,
    mesAlvo,
    projecaoPct,
    coberturaPecas,
    coberturaDemais,
  ]);

  const rowsSugestaoVisiveis = useMemo(() => {
    if (modoListaSugestao === 'top30') return sugestaoMesAlvo.top30;
    if (modoListaSugestao === 'todos') return sugestaoMesAlvo.rowsOrdenadas;
    return sugestaoMesAlvo.comSugestao;
  }, [sugestaoMesAlvo, modoListaSugestao]);

  const variacaoMensal = useMemo(() => {
    const monthTotals = new Map<number, number>();
    for (const proj of Object.values(projecoes)) {
      for (const [mes, qtd] of Object.entries(proj)) {
        const m = Number(mes);
        if (!m || m < 1 || m > 12) continue;
        monthTotals.set(m, (monthTotals.get(m) || 0) + Number(qtd || 0));
      }
    }

    return Array.from({ length: 12 }, (_, i) => i + 1).map((m, idx) => {
      const total = monthTotals.get(m) || 0;
      const prevMes = idx > 0 ? m - 1 : null;
      const prevTotal = prevMes ? monthTotals.get(prevMes) || 0 : 0;
      const variacaoPct = prevMes && prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;
      return { mes: m, total, variacaoPct, temDados: monthTotals.has(m) };
    });
  }, [projecoes]);

  const maxMensal = useMemo(
    () => Math.max(...variacaoMensal.map((v) => v.total), 1),
    [variacaoMensal]
  );

  const tendenciaPorReferencia = useMemo(() => {
    const fatorProj = 1 + projecaoPct / 100;
    const fatorPlano = 1 + planoPct / 100;
    const acc = new Map<string, {
      referencia: string;
      projMA: number;
      projPX: number;
      projUL: number;
      planoTotal: number;
      skus: number;
    }>();

    for (const item of dados) {
      const ref = String(item.produto.referencia || 'SEM_REFERENCIA').trim();
      if (!acc.has(ref)) {
        acc.set(ref, { referencia: ref, projMA: 0, projPX: 0, projUL: 0, planoTotal: 0, skus: 0 });
      }
      const row = acc.get(ref)!;
      const projSku = projecoes[item.produto.idproduto] || {};
      row.projMA += Number(projSku[String(periodos.MA)] || 0) * fatorProj;
      row.projPX += Number(projSku[String(periodos.PX)] || 0) * fatorProj;
      row.projUL += Number(projSku[String(periodos.UL)] || 0) * fatorProj;
      row.planoTotal += ((item.plano?.ma || 0) + (item.plano?.px || 0) + (item.plano?.ul || 0)) * fatorPlano;
      row.skus += 1;
    }

    return Array.from(acc.values())
      .map((r) => {
        const variacaoPct = r.projMA > 0 ? ((r.projUL - r.projMA) / r.projMA) * 100 : 0;
        const projTotal = r.projMA + r.projPX + r.projUL;
        const gapPlano = projTotal - r.planoTotal;
        const acao = gapPlano > 0 ? 'ACRESCENTAR' : gapPlano < 0 ? 'TIRAR' : 'MANTER';
        const tendencia = variacaoPct > 0 ? 'ALTA' : variacaoPct < 0 ? 'QUEDA' : 'ESTAVEL';
        return { ...r, variacaoPct, projTotal, gapPlano, acao, tendencia };
      })
      .sort((a, b) => Math.abs(b.gapPlano) - Math.abs(a.gapPlano));
  }, [dados, projecoes, periodos, projecaoPct, planoPct]);

  const referenciasFiltradas = useMemo(() => {
    if (modoTendencia === 'alta') return tendenciaPorReferencia.filter((r) => r.tendencia === 'ALTA');
    if (modoTendencia === 'queda') return tendenciaPorReferencia.filter((r) => r.tendencia === 'QUEDA');
    return tendenciaPorReferencia;
  }, [tendenciaPorReferencia, modoTendencia]);

  const dispPlanoPorSku = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of calcRows) {
      const disp =
        mesAjustePlano === 'ma'
          ? row.dispMA
          : mesAjustePlano === 'px'
            ? row.dispPX
            : row.dispUL;
      map.set(String(row.idproduto), Number(disp || 0));
    }
    return map;
  }, [calcRows, mesAjustePlano]);

  const ajusteMarPorSku = useMemo(() => {
    return dados.map((item) => {
      const projSku = projecoes[item.produto.idproduto] || {};
      const realSku = vendasReais[item.produto.idproduto] || {};
      const projJan = Number(projSku["1"] || 0);
      const projFev = Number(projSku["2"] || 0);
      const vendaJan = Number(realSku["1"] || 0);
      const vendaFev = Number(realSku["2"] || 0);
      const planoMesAtual = Number(item.plano?.[mesAjustePlano] || 0);

      const taxaJan = projJan > 0 ? vendaJan / projJan : null;
      const taxaFev = projFev > 0 ? vendaFev / projFev : null;
      const variacaoAderenciaPct =
        taxaJan !== null && taxaJan > 0 && taxaFev !== null
          ? ((taxaFev - taxaJan) / taxaJan) * 100
          : 0;

      const quedaAderencia = taxaJan !== null && taxaFev !== null && taxaFev < taxaJan;
      const quedaVendas = vendaFev < vendaJan;
      const altaAderencia = taxaJan !== null && taxaFev !== null && taxaFev > taxaJan;
      const altaVendas = vendaFev > vendaJan;

        let acao = 'MANTER';
        let ajustePct = 0;

      const variacaoRelevante = Math.abs(variacaoAderenciaPct) >= LIMIAR_VARIACAO_PCT;

      if (variacaoRelevante && quedaAderencia && quedaVendas) {
        acao = 'BAIXAR_PLANO';
        const delta = Math.max(0, (taxaJan || 0) - (taxaFev || 0));
        ajustePct = -Math.min(35, Math.max(5, delta * 100));
      } else if (variacaoRelevante && altaAderencia && altaVendas) {
        acao = 'SUBIR_PLANO';
        const delta = Math.max(0, (taxaFev || 0) - (taxaJan || 0));
        ajustePct = Math.min(35, Math.max(5, delta * 100));
      }

      // Só gera sugestão/ação quando |ajuste%| for estritamente maior que 30
      if (Math.abs(ajustePct) <= LIMIAR_VARIACAO_PCT) {
        acao = 'MANTER';
        ajustePct = 0;
      }

      const planoMesSugerido = Math.max(0, planoMesAtual * (1 + ajustePct / 100));

      return {
        continuidade: String(item.produto.continuidade || 'SEM CONTINUIDADE').trim(),
        referencia: String(item.produto.referencia || 'SEM_REFERENCIA').trim(),
        idproduto: String(item.produto.idproduto),
        cor: String(item.produto.cor || '').trim(),
        tamanho: String(item.produto.tamanho || '').trim(),
        projJan,
        projFev,
        vendaJan,
        vendaFev,
        taxaJan,
        taxaFev,
        variacaoAderenciaPct,
        planoMesAtual,
        ajustePct,
        planoMesSugerido,
        acao,
        dispPlanoMes: Number(dispPlanoPorSku.get(String(item.produto.idproduto)) || 0),
        negativoDispPlano: Math.min(0, Number(dispPlanoPorSku.get(String(item.produto.idproduto)) || 0)),
      };
    });
  }, [dados, projecoes, vendasReais, mesAjustePlano, dispPlanoPorSku]);

  const ajusteMarMatriz = useMemo(() => {
    const ordemContinuidade: Record<string, number> = {
      'PERMANENTE': 1,
      'PERMANENTE COR NOVA': 2,
      'EDICAO LIMITADA': 3,
      'EDICCAO LIMITADA': 3,
      'EDIÇÃO LIMITADA': 3,
    };

    function zero() {
      return {
        projJan: 0,
        vendaJan: 0,
        projFev: 0,
        vendaFev: 0,
        planoMesAtual: 0,
        planoMesSugerido: 0,
        negativoDispPlano: 0,
      };
    }

    function avaliar(
      projJan: number,
      vendaJan: number,
      projFev: number,
      vendaFev: number,
      planoMesAtual: number
    ) {
      const taxaJan = projJan > 0 ? vendaJan / projJan : null;
      const taxaFev = projFev > 0 ? vendaFev / projFev : null;
      const variacaoAderenciaPct =
        taxaJan !== null && taxaJan > 0 && taxaFev !== null
          ? ((taxaFev - taxaJan) / taxaJan) * 100
          : 0;
      const quedaAderencia = taxaJan !== null && taxaFev !== null && taxaFev < taxaJan;
      const quedaVendas = vendaFev < vendaJan;
      const altaAderencia = taxaJan !== null && taxaFev !== null && taxaFev > taxaJan;
      const altaVendas = vendaFev > vendaJan;
      const variacaoRelevante = Math.abs(variacaoAderenciaPct) >= LIMIAR_VARIACAO_PCT;

      let acao = 'MANTER';
      let ajustePct = 0;
      if (variacaoRelevante && quedaAderencia && quedaVendas) {
        acao = 'BAIXAR_PLANO';
        const delta = Math.max(0, (taxaJan || 0) - (taxaFev || 0));
        ajustePct = -Math.min(35, Math.max(5, delta * 100));
      } else if (variacaoRelevante && altaAderencia && altaVendas) {
        acao = 'SUBIR_PLANO';
        const delta = Math.max(0, (taxaFev || 0) - (taxaJan || 0));
        ajustePct = Math.min(35, Math.max(5, delta * 100));
      }

      const planoMesSugerido = Math.max(0, planoMesAtual * (1 + ajustePct / 100));
      return { taxaJan, taxaFev, variacaoAderenciaPct, acao, ajustePct, planoMesSugerido };
    }

    const contMap = new Map<string, Map<string, typeof ajusteMarPorSku>>();
    for (const row of ajusteMarPorSku) {
      if ((row.planoMesAtual || 0) <= 0) continue;
      if (!contMap.has(row.continuidade)) contMap.set(row.continuidade, new Map());
      const refMap = contMap.get(row.continuidade)!;
      if (!refMap.has(row.referencia)) refMap.set(row.referencia, []);
      refMap.get(row.referencia)!.push(row);
    }

    return Array.from(contMap.entries())
      .map(([continuidade, refMap]) => {
        const referencias = Array.from(refMap.entries())
          .map(([referencia, skus]) => {
            const tot = skus.reduce((acc, s) => ({
              projJan: acc.projJan + s.projJan,
              vendaJan: acc.vendaJan + s.vendaJan,
              projFev: acc.projFev + s.projFev,
              vendaFev: acc.vendaFev + s.vendaFev,
              planoMesAtual: acc.planoMesAtual + s.planoMesAtual,
              planoMesSugerido: 0,
              negativoDispPlano: acc.negativoDispPlano + s.negativoDispPlano,
            }), zero());
            const av = avaliar(tot.projJan, tot.vendaJan, tot.projFev, tot.vendaFev, tot.planoMesAtual);
            return {
              referencia,
              skus: [...skus].sort((a, b) => Number(a.idproduto) - Number(b.idproduto)),
              totais: {
                ...tot,
                taxaJan: av.taxaJan,
                taxaFev: av.taxaFev,
                variacaoAderenciaPct: av.variacaoAderenciaPct,
                ajustePct: av.ajustePct,
                acao: av.acao,
                planoMesSugerido: av.planoMesSugerido,
              },
            };
          })
          .sort((a, b) => a.referencia.localeCompare(b.referencia));

        const tot = referencias.flatMap((r) => r.skus).reduce((acc, s) => ({
          projJan: acc.projJan + s.projJan,
          vendaJan: acc.vendaJan + s.vendaJan,
          projFev: acc.projFev + s.projFev,
          vendaFev: acc.vendaFev + s.vendaFev,
          planoMesAtual: acc.planoMesAtual + s.planoMesAtual,
          planoMesSugerido: 0,
          negativoDispPlano: acc.negativoDispPlano + s.negativoDispPlano,
        }), zero());
        const av = avaliar(tot.projJan, tot.vendaJan, tot.projFev, tot.vendaFev, tot.planoMesAtual);
        return {
          continuidade,
          referencias,
          totais: {
            ...tot,
            taxaJan: av.taxaJan,
            taxaFev: av.taxaFev,
            variacaoAderenciaPct: av.variacaoAderenciaPct,
            ajustePct: av.ajustePct,
            acao: av.acao,
            planoMesSugerido: av.planoMesSugerido,
          },
        };
      })
      .sort((a, b) => {
        const keyA = a.continuidade.toUpperCase().trim();
        const keyB = b.continuidade.toUpperCase().trim();
        const ordA = ordemContinuidade[keyA] ?? 999;
        const ordB = ordemContinuidade[keyB] ?? 999;
        if (ordA !== ordB) return ordA - ordB;
        return a.continuidade.localeCompare(b.continuidade);
      });
  }, [ajusteMarPorSku]);

  const balanceamentoPlano = useMemo(() => {
    const calcMap = new Map(calcRows.map((r) => [String(r.idproduto), r]));
    const hoje = new Date();
    const anoAtual = hoje.getFullYear();
    const diasMar = new Date(anoAtual, 3, 0).getDate();
    const diaMar = hoje.getMonth() + 1 === 3 ? Math.min(hoje.getDate(), diasMar) : diasMar;
    const rowsBase = dados
      .map((item) => {
        const id = String(item.produto.idproduto);
        const calc = calcMap.get(id);
        if (!calc) return null;

        const estMin = Number(item.estoques.estoque_minimo || 0);
        if (estMin <= 0) return null;

        const planoMA = Number(item.plano?.ma || 0);
        const planoPX = Number(item.plano?.px || 0);
        const planoUL = Number(item.plano?.ul || 0);
        const planoTotal = planoMA + planoPX + planoUL;
        const isTop30 = top30Ids.has(id);
        const coberturaAlvo = isTop30 ? coberturaPecas : coberturaDemais;
        const estoqueAlvo = estMin * coberturaAlvo;
        const gapFinalUL = estoqueAlvo - calc.dispUL;

        const realSku = vendasReais[id] || {};
        const projSku = projecoes[id] || {};
        const projJan = Number(projSku['1'] || 0);
        const projFev = Number(projSku['2'] || 0);
        const projMar = Number(projSku['3'] || 0);
        const vendaJan = Number(realSku['1'] || 0);
        const vendaFev = Number(realSku['2'] || 0);
        const vendaMar = Number(realSku['3'] || 0);
        const projMarProporcional = projMar * (diaMar / Math.max(1, diasMar));
        const taxaJan = projJan > 0 ? vendaJan / projJan : null;
        const taxaFev = projFev > 0 ? vendaFev / projFev : null;
        const taxaMar = projMarProporcional > 0 ? vendaMar / projMarProporcional : null;
        const aderenciaDeltaPct =
          taxaJan !== null && taxaJan > 0 && taxaFev !== null
            ? ((taxaFev - taxaJan) / taxaJan) * 100
            : 0;
        const aderenciaJanAte70 = taxaJan !== null && taxaJan <= 0.7;
        const aderenciaFevAte70 = taxaFev !== null && taxaFev <= 0.7;
        const elegivelBaixa70 = aderenciaJanAte70 && aderenciaFevAte70;
        const marcoTravadoParaSubida = periodos.MA === 3;

        let acao: 'SUBIR' | 'BAIXAR' | 'MANTER' = 'MANTER';
        let ajusteMA = 0;
        let ajustePX = 0;
        let ajusteUL = 0;
        let prioridade = 0;
        let motivo = 'Sem ajuste';

        const precisaSubir = calc.dispUL < 0 || gapFinalUL > 0;
        const excessoUL = Math.max(0, -gapFinalUL);
        const quedaProj = calc.tendenciaPct <= -10;
        const quedaAder = taxaJan !== null && taxaFev !== null && taxaFev < taxaJan;
        const sobraForte = calc.cobUL !== null && calc.cobUL >= coberturaAlvo + 0.7;

        if (precisaSubir) {
          acao = 'SUBIR';
          const necessidade = Math.ceil(Math.max(-calc.dispUL, gapFinalUL));
          [ajusteMA, ajustePX, ajusteUL] = distribuirAjuste(
            necessidade,
            marcoTravadoParaSubida ? [0, 0.45, 0.55] : [0.2, 0.35, 0.45]
          );
          prioridade =
            (calc.dispMA < 0 ? 100 : 0) +
            ((calc.cobMA !== null && calc.cobMA < 0.5) ? 40 : 0) +
            (calc.tendenciaPct > 0 ? 20 : 0) +
            (aderenciaDeltaPct > 0 ? 15 : 0);
          motivo = 'Ajuste gradativo até o fim de maio para cobrir negativo/alvo';
        } else if (excessoUL > 0 && planoTotal > 0 && elegivelBaixa70 && (quedaProj || quedaAder || sobraForte)) {
          acao = 'BAIXAR';
          const corteTotal = Math.ceil(Math.min(planoTotal, excessoUL));
          [ajusteMA, ajustePX, ajusteUL] = distribuirAjuste(corteTotal, [0.2, 0.35, 0.45], [planoMA, planoPX, planoUL]);
          prioridade =
            (quedaProj ? 30 : 0) +
            (quedaAder ? 20 : 0) +
            (sobraForte ? 30 : 0) +
            Math.min(20, Math.floor(excessoUL / Math.max(estMin, 1)));
          motivo = 'Redução gradativa por sobra até o fim de maio';
        }

        return {
          idproduto: id,
          referencia: String(item.produto.referencia || ''),
          continuidade: String(item.produto.continuidade || 'SEM CONTINUIDADE'),
          produto: String(item.produto.produto || item.produto.apresentacao || ''),
          dispMA: calc.dispMA,
          dispUL: calc.dispUL,
          cobMA: calc.cobMA,
          cobUL: calc.cobUL,
          coberturaAlvo,
          planoMA,
          planoPX,
          planoUL,
          ajusteMA,
          ajustePX,
          ajusteUL,
          ajusteTotal: ajusteMA + ajustePX + ajusteUL,
          acao,
          prioridade,
          motivo,
          tendenciaPct: calc.tendenciaPct,
          aderenciaDeltaPct,
          taxaJan,
          taxaFev,
          taxaMar,
          elegivelBaixa70,
          isTop30,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const ajustes = rowsBase.filter((r) => r.acao !== 'MANTER' && r.ajusteTotal > 0);
    const totalSubir = ajustes
      .filter((r) => r.acao === 'SUBIR')
      .reduce((acc, r) => acc + r.ajusteTotal, 0);
    const totalBaixarInicial = ajustes
      .filter((r) => r.acao === 'BAIXAR')
      .reduce((acc, r) => acc + r.ajusteTotal, 0);

    if (totalBaixarInicial < totalSubir) {
      let faltanteCorte = Math.ceil(totalSubir - totalBaixarInicial);
      const extras = rowsBase
        .filter((r) =>
          r.acao === 'MANTER' &&
          r.elegivelBaixa70 &&
          (r.planoMA + r.planoPX + r.planoUL) > 0 &&
          (r.cobUL !== null && r.cobUL >= r.coberturaAlvo + 0.5)
        )
        .sort((a, b) => (b.cobUL || 0) - (a.cobUL || 0));

      for (const extra of extras) {
        if (faltanteCorte <= 0) break;
        const planoTotal = extra.planoMA + extra.planoPX + extra.planoUL;
        const corte = Math.min(planoTotal, faltanteCorte);
        if (corte <= 0) continue;
        const [ajMA, ajPX, ajUL] = distribuirAjuste(corte, [0.2, 0.35, 0.45], [extra.planoMA, extra.planoPX, extra.planoUL]);
        ajustes.push({
          ...extra,
          acao: 'BAIXAR',
          ajusteMA: ajMA,
          ajustePX: ajPX,
          ajusteUL: ajUL,
          ajusteTotal: ajMA + ajPX + ajUL,
          prioridade: extra.prioridade + 10,
          motivo: 'Corte gradativo extra para balancear volume',
        });
        faltanteCorte -= ajMA + ajPX + ajUL;
      }
    }

    const somaMes = (acao: 'SUBIR' | 'BAIXAR', mes: 'ajusteMA' | 'ajustePX' | 'ajusteUL') =>
      ajustes
        .filter((r) => r.acao === acao)
        .reduce((acc, r) => acc + r[mes], 0);

    const totalSubirMA = somaMes('SUBIR', 'ajusteMA');
    const totalSubirPX = somaMes('SUBIR', 'ajustePX');
    const totalSubirUL = somaMes('SUBIR', 'ajusteUL');
    const totalBaixarMA = somaMes('BAIXAR', 'ajusteMA');
    const totalBaixarPX = somaMes('BAIXAR', 'ajustePX');
    const totalBaixarUL = somaMes('BAIXAR', 'ajusteUL');

    const totalSubirFinal = ajustes
      .filter((r) => r.acao === 'SUBIR')
      .reduce((acc, r) => acc + r.ajusteTotal, 0);
    const totalBaixarFinal = ajustes
      .filter((r) => r.acao === 'BAIXAR')
      .reduce((acc, r) => acc + r.ajusteTotal, 0);

    const ord = [...ajustes].sort((a, b) => {
      if (a.acao !== b.acao) return a.acao === 'SUBIR' ? -1 : 1;
      if (b.prioridade !== a.prioridade) return b.prioridade - a.prioridade;
      if (b.ajusteTotal !== a.ajusteTotal) return b.ajusteTotal - a.ajusteTotal;
      return a.referencia.localeCompare(b.referencia);
    });

    return {
      rows: ord,
      totalSubir: totalSubirFinal,
      totalBaixar: totalBaixarFinal,
      saldo: totalSubirFinal - totalBaixarFinal,
      skusSubir: ord.filter((r) => r.acao === 'SUBIR').length,
      skusBaixar: ord.filter((r) => r.acao === 'BAIXAR').length,
      totalAcoes: ord.length,
      totalSubirMA,
      totalSubirPX,
      totalSubirUL,
      totalBaixarMA,
      totalBaixarPX,
      totalBaixarUL,
      saldoMA: totalSubirMA - totalBaixarMA,
      saldoPX: totalSubirPX - totalBaixarPX,
      saldoUL: totalSubirUL - totalBaixarUL,
    };
  }, [
    dados,
    calcRows,
    top30Ids,
    coberturaPecas,
    coberturaDemais,
    vendasReais,
    projecoes,
    periodos,
  ]);

  const balanceamentoMatriz = useMemo(() => {
    const ordemContinuidade: Record<string, number> = {
      'PERMANENTE': 1,
      'PERMANENTE COR NOVA': 2,
      'EDICAO LIMITADA': 3,
      'EDICCAO LIMITADA': 3,
      'EDIÇÃO LIMITADA': 3,
    };

    const somar = (rows: typeof balanceamentoPlano.rows) => rows.reduce((acc, r) => {
      acc.dispMA += r.dispMA;
      acc.dispUL += r.dispUL;
      acc.ajusteMA += r.ajusteMA;
      acc.ajustePX += r.ajustePX;
      acc.ajusteUL += r.ajusteUL;
      acc.ajusteTotal += r.ajusteTotal;
      acc.subir += r.acao === 'SUBIR' ? r.ajusteTotal : 0;
      acc.baixar += r.acao === 'BAIXAR' ? r.ajusteTotal : 0;
      acc.count += 1;
      if (r.taxaJan !== null) {
        acc.taxaJanSum += r.taxaJan;
        acc.taxaJanCount += 1;
      }
      if (r.taxaFev !== null) {
        acc.taxaFevSum += r.taxaFev;
        acc.taxaFevCount += 1;
      }
      if (r.taxaMar !== null) {
        acc.taxaMarSum += r.taxaMar;
        acc.taxaMarCount += 1;
      }
      return acc;
    }, {
      dispMA: 0, dispUL: 0, ajusteMA: 0, ajustePX: 0, ajusteUL: 0, ajusteTotal: 0, subir: 0, baixar: 0, count: 0,
      taxaJanSum: 0, taxaJanCount: 0, taxaFevSum: 0, taxaFevCount: 0, taxaMarSum: 0, taxaMarCount: 0,
    });

    const contMap = new Map<string, Map<string, typeof balanceamentoPlano.rows>>();
    for (const row of balanceamentoPlano.rows) {
      const cont = (row.continuidade || 'SEM CONTINUIDADE').trim();
      const ref = (row.referencia || 'SEM REFERENCIA').trim();
      if (!contMap.has(cont)) contMap.set(cont, new Map());
      const refMap = contMap.get(cont)!;
      if (!refMap.has(ref)) refMap.set(ref, []);
      refMap.get(ref)!.push(row);
    }

    return Array.from(contMap.entries())
      .map(([continuidade, refMap]) => {
        const referencias = Array.from(refMap.entries())
          .map(([referencia, skus]) => {
            const skusOrd = [...skus].sort((a, b) => Number(a.idproduto) - Number(b.idproduto));
            const s = somar(skusOrd);
            const totais = {
              ...s,
              taxaJan: s.taxaJanCount > 0 ? s.taxaJanSum / s.taxaJanCount : null,
              taxaFev: s.taxaFevCount > 0 ? s.taxaFevSum / s.taxaFevCount : null,
              taxaMar: s.taxaMarCount > 0 ? s.taxaMarSum / s.taxaMarCount : null,
            };
            return { referencia, skus: skusOrd, totais };
          })
          .sort((a, b) => a.referencia.localeCompare(b.referencia));
        const s = somar(referencias.flatMap((r) => r.skus));
        const totais = {
          ...s,
          taxaJan: s.taxaJanCount > 0 ? s.taxaJanSum / s.taxaJanCount : null,
          taxaFev: s.taxaFevCount > 0 ? s.taxaFevSum / s.taxaFevCount : null,
          taxaMar: s.taxaMarCount > 0 ? s.taxaMarSum / s.taxaMarCount : null,
        };
        return { continuidade, referencias, totais };
      })
      .sort((a, b) => {
        const keyA = a.continuidade.toUpperCase().trim();
        const keyB = b.continuidade.toUpperCase().trim();
        const ordA = ordemContinuidade[keyA] ?? 999;
        const ordB = ordemContinuidade[keyB] ?? 999;
        if (ordA !== ordB) return ordA - ordB;
        return a.continuidade.localeCompare(b.continuidade);
      });
  }, [balanceamentoPlano.rows]);

  useEffect(() => {
    if (balanceamentoMatriz.length === 0) return;
    setExpandedContAnalise(new Set(balanceamentoMatriz.map((g) => g.continuidade)));
    setExpandedRefAnalise(new Set());
  }, [balanceamentoMatriz]);

  async function salvarAnalise() {
    setSaving(true);
    setErro(null);
    setOkMsg(null);
    try {
      const nome = nomeAnalise.trim();
      if (!nome) {
        setErro('Informe um nome para salvar a análise.');
        return;
      }

      const payload = {
        nome,
        parametros: {
          projecaoPct,
          planoPct,
          coberturaPecas,
          coberturaDemais,
          mesAlvo,
        },
        resumo: {
          itens: calcRows.length,
          negativosMA: resumo.negativosMA,
          negativosPX: resumo.negativosPX,
          negativosUL: resumo.negativosUL,
          deficitTotal: resumo.deficitTotal,
          gargalos: gargalos.length,
          coberturasMelhorar: coberturasMelhorar.length,
        },
        observacoes,
      };

      const res = await fetch(`${API_URL}/api/simulacoes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao salvar simulação');

      setOkMsg('Simulação salva com sucesso.');
      setNomeAnalise('');
      setObservacoes('');
      await carregarTudo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar simulação');
    } finally {
      setSaving(false);
    }
  }

  async function removerAnalise(id: string) {
    try {
      const res = await fetch(`${API_URL}/api/simulacoes/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao remover');
      await carregarTudo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao remover simulação');
    }
  }

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="bg-brand-primary shadow-sm px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-white font-bold font-secondary tracking-wide text-base">ANÁLISE DO PLANO</h1>
            <p className="text-white/70 text-xs">Simulação · Gargalos · Cobertura futura · Projeções</p>
          </div>
          <div className="text-xs text-white/80">
            Filtros fixos: {MARCA_FIXA} · {STATUS_FIXO}
          </div>
        </header>

        <main className="flex-1 px-6 py-5 space-y-4">
          {loading && <div className="bg-white border rounded-lg p-4 text-sm text-gray-500">Carregando dados...</div>}
          {erro && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{erro}</div>}

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-brand-dark mb-3">Parâmetros do Balanceamento</h2>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <label className="text-xs text-gray-600">
                Ajuste projeção (%)
                <input
                  type="number"
                  value={projecaoPct}
                  onChange={(e) => setProjecaoPct(Number(e.target.value || 0))}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5"
                />
              </label>
              <label className="text-xs text-gray-600">
                Ajuste plano (%)
                <input
                  type="number"
                  value={planoPct}
                  onChange={(e) => setPlanoPct(Number(e.target.value || 0))}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5"
                />
              </label>
              <label className="text-xs text-gray-600">
                Cobertura peças (x)
                <input
                  type="number"
                  step="0.1"
                  value={coberturaPecas}
                  onChange={(e) => setCoberturaPecas(Number(e.target.value || 0))}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5"
                />
              </label>
              <label className="text-xs text-gray-600">
                Cobertura demais (x)
                <input
                  type="number"
                  step="0.1"
                  value={coberturaDemais}
                  onChange={(e) => setCoberturaDemais(Number(e.target.value || 0))}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5"
                />
              </label>
              <div className="text-xs text-gray-500 flex items-end">
                Top30 ativos: <span className="font-semibold text-brand-dark ml-1">{top30Ids.size}</span>
              </div>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Períodos: MA={MESES_PT[periodos.MA]} · PX={MESES_PT[periodos.PX]} · UL={MESES_PT[periodos.UL]}
            </div>
          </div>

          {false && (
          <section id="balanceador" className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden scroll-mt-20">
            <div className="px-4 py-3 border-b text-sm font-semibold text-brand-dark">
              Balanceador gradativo até {MESES_PT[periodos.UL]}
            </div>
            <div className="px-4 py-2 text-xs text-gray-600 border-b">
              Lógica: não corrige tudo em {MESES_PT[periodos.MA]}. Distribui os ajustes entre {MESES_PT[periodos.MA]}, {MESES_PT[periodos.PX]} e {MESES_PT[periodos.UL]}, priorizando negativos e cobertura alvo no fechamento do período.
            </div>
            <div className="px-4 py-2 text-xs text-indigo-700 bg-indigo-50 border-b border-indigo-100">
              Março está proporcional ao dia atual para cálculo de atingimento e projeção do mês corrente.
            </div>
            <div className="grid grid-cols-2 md:grid-cols-9 gap-3 p-4 border-b bg-gray-50">
              <Card label="SKUs com ação" value={balanceamentoPlano.totalAcoes} />
              <Card label="SKUs subir" value={balanceamentoPlano.skusSubir} />
              <Card label="SKUs baixar" value={balanceamentoPlano.skusBaixar} />
              <Card label={`Saldo ${MESES_PT[periodos.MA]}`} value={fmt(balanceamentoPlano.saldoMA)} />
              <Card label={`Saldo ${MESES_PT[periodos.PX]}`} value={fmt(balanceamentoPlano.saldoPX)} />
              <Card label={`Saldo ${MESES_PT[periodos.UL]}`} value={fmt(balanceamentoPlano.saldoUL)} />
              <Card label="Total subir (3m)" value={fmt(balanceamentoPlano.totalSubir)} />
              <Card label="Total baixar (3m)" value={fmt(balanceamentoPlano.totalBaixar)} />
              <Card label="Saldo líquido" value={fmt(balanceamentoPlano.saldo)} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="px-3 py-2 text-left">Ref</th>
                    <th className="px-3 py-2 text-left">SKU</th>
                    <th className="px-3 py-2 text-right">Disp. {MESES_PT[periodos.MA]}</th>
                    <th className="px-3 py-2 text-right">Disp. {MESES_PT[periodos.UL]}</th>
                    <th className="px-3 py-2 text-right">Cob. {MESES_PT[periodos.MA]}</th>
                    <th className="px-3 py-2 text-right">Cob. {MESES_PT[periodos.UL]}</th>
                    <th className="px-3 py-2 text-right">Cob. alvo</th>
                    <th className="px-3 py-2 text-right">Taxa Jan</th>
                    <th className="px-3 py-2 text-right">Taxa Fev</th>
                    <th className="px-3 py-2 text-right">Taxa Mar</th>
                    <th className="px-3 py-2 text-right">Ajuste {MESES_PT[periodos.MA]}</th>
                    <th className="px-3 py-2 text-right">Ajuste {MESES_PT[periodos.PX]}</th>
                    <th className="px-3 py-2 text-right">Ajuste {MESES_PT[periodos.UL]}</th>
                    <th className="px-3 py-2 text-right">Ajuste total</th>
                    <th className="px-3 py-2 text-right">Ação</th>
                    <th className="px-3 py-2 text-left">Motivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {balanceamentoMatriz.map((g) => {
                    const contOpen = expandedContAnalise.has(g.continuidade);
                    return (
                      <Fragment key={`cont-${g.continuidade}`}>
                        <tr
                          className="bg-brand-dark text-white cursor-pointer"
                          onClick={() => {
                            setExpandedContAnalise((prev) => {
                              const next = new Set(prev);
                              if (next.has(g.continuidade)) next.delete(g.continuidade);
                              else next.add(g.continuidade);
                              return next;
                            });
                          }}
                        >
                          <td className="px-3 py-2 font-semibold">
                            <span className="mr-2 text-[10px]">{contOpen ? '▼' : '▶'}</span>
                            {g.continuidade} <span className="text-gray-300 font-normal">({g.totais.count} skus)</span>
                          </td>
                          <td className="px-3 py-2 font-mono text-right">—</td>
                          <td className={`px-3 py-2 text-right font-mono ${g.totais.dispMA < 0 ? 'text-red-300' : ''}`}>{fmt(g.totais.dispMA)}</td>
                          <td className={`px-3 py-2 text-right font-mono ${g.totais.dispUL < 0 ? 'text-red-300' : ''}`}>{fmt(g.totais.dispUL)}</td>
                          <td className="px-3 py-2 text-right font-mono">—</td>
                          <td className="px-3 py-2 text-right font-mono">—</td>
                          <td className="px-3 py-2 text-right font-mono">—</td>
                          <td className="px-3 py-2 text-right font-mono">{g.totais.taxaJan === null ? '—' : `${fmt(g.totais.taxaJan * 100, 1)}%`}</td>
                          <td className="px-3 py-2 text-right font-mono">{g.totais.taxaFev === null ? '—' : `${fmt(g.totais.taxaFev * 100, 1)}%`}</td>
                          <td className="px-3 py-2 text-right font-mono">{g.totais.taxaMar === null ? '—' : `${fmt(g.totais.taxaMar * 100, 1)}%`}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(g.totais.ajusteMA)}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(g.totais.ajustePX)}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt(g.totais.ajusteUL)}</td>
                          <td className="px-3 py-2 text-right font-mono font-semibold">{fmt(g.totais.ajusteTotal)}</td>
                          <td className="px-3 py-2 text-right font-semibold">{g.totais.subir >= g.totais.baixar ? 'SUBIR' : 'BAIXAR'}</td>
                          <td className="px-3 py-2 text-gray-200">Totalizador continuidade</td>
                        </tr>

                        {contOpen && g.referencias.map((r) => {
                          const refKey = `${g.continuidade}|${r.referencia}`;
                          const refOpen = expandedRefAnalise.has(refKey);
                          return (
                            <Fragment key={`ref-${refKey}`}>
                              <tr
                                className="bg-gray-50 hover:bg-gray-100 cursor-pointer"
                                onClick={() => {
                                  setExpandedRefAnalise((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(refKey)) next.delete(refKey);
                                    else next.add(refKey);
                                    return next;
                                  });
                                }}
                              >
                                <td className="px-3 py-1.5 font-mono font-semibold">
                                  <span className="mr-2 text-[10px] text-gray-500">{refOpen ? '▼' : '▶'}</span>
                                  {r.referencia} <span className="text-gray-500 font-normal">({r.totais.count} skus)</span>
                                </td>
                                <td className="px-3 py-1.5 font-mono text-right">—</td>
                                <td className={`px-3 py-1.5 text-right font-mono ${r.totais.dispMA < 0 ? 'text-red-700' : ''}`}>{fmt(r.totais.dispMA)}</td>
                                <td className={`px-3 py-1.5 text-right font-mono ${r.totais.dispUL < 0 ? 'text-red-700' : ''}`}>{fmt(r.totais.dispUL)}</td>
                                <td className="px-3 py-1.5 text-right font-mono">—</td>
                                <td className="px-3 py-1.5 text-right font-mono">—</td>
                                <td className="px-3 py-1.5 text-right font-mono">—</td>
                                <td className="px-3 py-1.5 text-right font-mono">{r.totais.taxaJan === null ? '—' : `${fmt(r.totais.taxaJan * 100, 1)}%`}</td>
                                <td className="px-3 py-1.5 text-right font-mono">{r.totais.taxaFev === null ? '—' : `${fmt(r.totais.taxaFev * 100, 1)}%`}</td>
                                <td className="px-3 py-1.5 text-right font-mono">{r.totais.taxaMar === null ? '—' : `${fmt(r.totais.taxaMar * 100, 1)}%`}</td>
                                <td className="px-3 py-1.5 text-right font-mono">{fmt(r.totais.ajusteMA)}</td>
                                <td className="px-3 py-1.5 text-right font-mono">{fmt(r.totais.ajustePX)}</td>
                                <td className="px-3 py-1.5 text-right font-mono">{fmt(r.totais.ajusteUL)}</td>
                                <td className="px-3 py-1.5 text-right font-mono font-semibold">{fmt(r.totais.ajusteTotal)}</td>
                                <td className="px-3 py-1.5 text-right font-semibold">{r.totais.subir >= r.totais.baixar ? 'SUBIR' : 'BAIXAR'}</td>
                                <td className="px-3 py-1.5 text-gray-600">Totalizador referência</td>
                              </tr>

                              {refOpen && r.skus.map((sku) => (
                                <tr
                                  key={`sku-${refKey}-${sku.idproduto}`}
                                  className={sku.acao === 'SUBIR' ? 'bg-red-50/60' : 'bg-blue-50/50'}
                                >
                                  <td className="px-3 py-1.5 font-mono">{sku.referencia}</td>
                                  <td className="px-3 py-1.5 font-mono">
                                    {sku.idproduto}
                                    {sku.isTop30 && <span className="ml-1 text-[10px] text-amber-700 font-semibold">TOP30</span>}
                                  </td>
                                  <td className={`px-3 py-1.5 text-right font-mono ${sku.dispMA < 0 ? 'text-red-700 font-semibold' : ''}`}>{fmt(sku.dispMA)}</td>
                                  <td className={`px-3 py-1.5 text-right font-mono ${sku.dispUL < 0 ? 'text-red-700 font-semibold' : ''}`}>{fmt(sku.dispUL)}</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{sku.cobMA === null ? '—' : `${fmt(sku.cobMA, 2)}x`}</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{sku.cobUL === null ? '—' : `${fmt(sku.cobUL, 2)}x`}</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{fmt(sku.coberturaAlvo, 1)}x</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{sku.taxaJan === null ? '—' : `${fmt(sku.taxaJan * 100, 1)}%`}</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{sku.taxaFev === null ? '—' : `${fmt(sku.taxaFev * 100, 1)}%`}</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{sku.taxaMar === null ? '—' : `${fmt(sku.taxaMar * 100, 1)}%`}</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{fmt(sku.ajusteMA)}</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{fmt(sku.ajustePX)}</td>
                                  <td className="px-3 py-1.5 text-right font-mono">{fmt(sku.ajusteUL)}</td>
                                  <td className="px-3 py-1.5 text-right font-mono font-semibold">{fmt(sku.ajusteTotal)}</td>
                                  <td className={`px-3 py-1.5 text-right font-semibold ${sku.acao === 'SUBIR' ? 'text-red-700' : 'text-blue-700'}`}>
                                    {sku.acao}
                                  </td>
                                  <td className="px-3 py-1.5 text-gray-600">{sku.motivo}</td>
                                </tr>
                              ))}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                  {balanceamentoMatriz.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-center text-gray-400" colSpan={16}>
                        Nenhum ajuste necessário para os parâmetros atuais.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          )}

        </main>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-lg font-bold font-mono text-gray-900">{value}</div>
    </div>
  );
}
