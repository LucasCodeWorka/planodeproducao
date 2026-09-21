'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, LayoutGrid, RefreshCw, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun'] as const;
type Month = typeof MONTHS[number];
const CURVAS = ['A', 'B', 'C', 'D'] as const;
type Curva = typeof CURVAS[number];
// Capacidade diária fixada a pedido do PCP, substituindo a medição real por grupo. Vale só
// nesta tela: o gap-mensal e a aba de Capacidade seguem com os números deles. Atenção: este
// valor não se atualiza sozinho quando a fábrica mudar.
const CAPACIDADE_DIARIA_FIXA = 57863;
// Uma cor por mês. O fundo entra só nas linhas filhas: na linha-pai já existe a cor do
// bloco, e pintar coluna por cima embolaria as duas leituras.
const CORES_MES = [
  { th: 'text-blue-700',    td: 'bg-blue-50/60' },
  { th: 'text-violet-700',  td: 'bg-violet-50/60' },
  { th: 'text-emerald-700', td: 'bg-emerald-50/60' },
  { th: 'text-amber-700',   td: 'bg-amber-50/60' },
  { th: 'text-rose-700',    td: 'bg-rose-50/60' },
  { th: 'text-cyan-700',    td: 'bg-cyan-50/60' },
] as const;

type ProjectionItem = { idproduto: string; referencia: string; media_3m?: number; projecoes: Record<Month, number> };
type MatrixRow = { produto?: { idproduto?: string | number; referencia?: string; continuidade?: string }; estoques?: { estoque_atual?: number; estoque_disponivel?: number; em_processo?: number; estoque_minimo?: number }; demanda?: { media_vendas_3m?: number; pedidos_pendentes?: number }; plano?: { ma?: number; px?: number; ul?: number; qt?: number } };
// As duas primeiras sao fatias DOS PERMANENTES (somam 1). O uplift e um acrescimo por cima:
// a projecao so cobre permanentes, entao o estoque que ela gera e todo permanente — fatiar
// edicao limitada dele seria trocar o rotulo de estoque que nao e dela.
type PctContinuidade = { permanente: number; corNova: number; upliftEdicaoLimitada: number };
// Insumos por SKU guardados crus: o laço mês a mês virou memo para reagir ao seletor
// de cobertura sem refazer as consultas.
type BaseSku = { id: string; curva: Curva; projecoes: Record<Month, number>; estoqueInicial: number; minimo: number; lote: number; tempo: number };
type MonthRow = { mes: Month; demanda: number; producao: number; producaoPorCurva: Record<Curva, number>; estoque: number; cobertura: number; carga: number; capacidade: number; capacidadePecas: number; diasDisponiveis: number; diasNecessarios: number; utilizacao: number };
type VendasCanal = { fabrica: Record<string, number>; lojas: Record<string, number> };
type Totalizador = { fabrica: number; fabricaAjustada: number; lojas: number; total: number };

const fmt = (n: number) => Math.round(n || 0).toLocaleString('pt-BR');
const fmtPct = (n: number) => `${Math.round(n || 0)}%`;
const norm = (v: unknown) => String(v || '').trim().toUpperCase();

export default function ProjecaoMacroPage() {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  // Blocos da Visão Geral abertos por padrão; o clique no bloco fecha para a leitura macro.
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  // 'curva' usa a cobertura mínima configurada para cada curva ABC — é a política da casa
  // e o padrão. Um número no lugar dela aplica o mesmo alvo a todo SKU, para simulação.
  // O recálculo é local, sem refazer as consultas.
  const [modoCobertura, setModoCobertura] = useState<'curva' | number>('curva');
  // Multiplica a política por curva. Vive só nesta tela: a config global continua
  // valendo para a Sugestão de Plano, senão as duas passariam a divergir em silêncio.
  const [multiplicadorCobertura, setMultiplicadorCobertura] = useState(3);
  // Mesma configuração de cobertura que a Sugestão de Plano usa; aqui é só consulta.
  const [cfgCurvas, setCfgCurvas] = useState({
    cobertura_min_a: 0.5, cobertura_max_a: 1.0,
    cobertura_min_b: 1.0, cobertura_max_b: 2.0,
    cobertura_min_c: 1.0, cobertura_max_c: 2.5,
    cobertura_min_d: 1.0, cobertura_max_d: 3.0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawData, setRawData] = useState<{ anoBase: number; anoDestino: number; skus: number; estoqueInicial: number; emProcesso: number; pedidosPendentes: number; estoqueFimDezembro: number; planoAteDezembro: number; capacidadeDiaria: number; baseSkus: BaseSku[]; capacidadePorMes: number[]; pctContinuidade: PctContinuidade; vendas: VendasCanal; totalizadores: Record<string, Totalizador> } | null>(null);

  async function carregar() {
    setLoading(true); setError(null);
    try {
      const anoBase = new Date().getFullYear();
      const anoDestino = anoBase + 1;
      // Só o tempos-ref depende do preview (precisa da lista de referências); o resto vai
      // junto. A capacidade real saiu daqui: desde que o valor diário virou constante, ela
      // alimentava apenas código morto e custava ~7s por carregamento.
      const [previewResponse, configResponse, matrixResponse, curvaResponse, corteResponse, projResponse] = await Promise.all([
        fetchNoCache(`${API_URL}/api/projecao-permanentes/preview?anoBase=${anoBase}&anoDestino=${anoDestino}`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/capacidade/config`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/producao/matriz?limit=5000&prefer_cache=true&marca=LIEBE&status=EM%20LINHA%2CNOVA%20COLECAO`),
        // Vão no mesmo Promise.all de propósito: se fossem fetches soltos, o cálculo poderia
        // rodar antes de chegarem, e todo SKU cairia no default de curva e de lote.
        fetchNoCache(`${API_URL}/api/analises/curva-abc-referencias`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/configuracoes/corte-minimos`, { headers: authHeaders() }),
        // Projeção gravada de set-dez, do endpoint enxuto: le app_projecoes direto, sem
        // de-para e sem colapsar os anos. O /api/projecoes equivalente levava ~30s.
        fetchNoCache(`${API_URL}/api/projecoes/por-mes?ano=${anoBase}&meses=9,10,11,12`, { headers: authHeaders() }),
      ]);
      const preview = await previewResponse.json();
      if (!previewResponse.ok || !preview.success) throw new Error(preview.error || 'Erro ao carregar projeção');
      const refs = Array.from(new Set((preview.itens || []).map((i: ProjectionItem) => norm(i.referencia)).filter(Boolean)));
      const tempoResponse = await fetchNoCache(`${API_URL}/api/capacidade/tempos-ref?referencias=${encodeURIComponent(refs.join(','))}`, { headers: authHeaders() });
      const config = await configResponse.json(); const matrix = await matrixResponse.json(); const tempos = await tempoResponse.json();
      const curvaJson = await curvaResponse.json();
      const curvaPorRef = new Map<string, Curva>(
        Object.entries((curvaJson?.porReferencia || {}) as Record<string, string>)
          .map(([ref, cv]) => [norm(ref), norm(cv) as Curva])
      );
      const projJson = await projResponse.json();
      const projPorSku = (projJson?.data || {}) as Record<string, Record<string, number>>;
      // Demanda de set a dez por SKU: projeção gravada quando existe, média 3m como
      // fallback mês a mês. O cálculo anterior usava média × 3, que ignorava dezembro
      // (nem o plano nem a venda) e subestimava a demanda dos outros três meses.
      const vendaAteDezDe = (id: string, media3m: number) =>
        [9, 10, 11, 12].reduce((soma, mes) => {
          const v = projPorSku[id]?.[String(mes)];
          return soma + (v !== undefined ? Number(v) : media3m);
        }, 0);
      const corteJson = await corteResponse.json();
      const cortePorId = new Map<string, number>(
        (Array.isArray(corteJson?.data) ? corteJson.data : [])
          .map((c: { idproduto?: string; corte_min?: number }) => [String(c?.idproduto || '').trim(), Number(c?.corte_min || 0)])
      );
      if (!configResponse.ok || !config.success) throw new Error(config.error || 'Erro ao carregar capacidade');
      const capacidadeDiariaTotal = CAPACIDADE_DIARIA_FIXA;
      const days: Record<string, number> = config.data?.dias || {};
      const timeByRef = new Map<string, number>((tempos.data || []).map((t: any) => [norm(t.referencia_padrao || t.idreferencia), Number(t.tempo_segundos || 0)]));
      const matrixById = new Map<string, MatrixRow>((matrix.data || []).map((r: MatrixRow) => [String(r.produto?.idproduto || ''), r]));
      // Proporção do estoque de HOJE por continuidade. O estoque projetado cobre só as duas
      // permanentes, então a fatia de edição limitada é extrapolação: assume que a proporção
      // atual se mantém. Serve para leitura macro, não é número projetado.
      const estoqueHoje = { permanente: 0, corNova: 0, edicaoLimitada: 0, outros: 0 };
      for (const r of (matrix.data || []) as MatrixRow[]) {
        const c = norm(r.produto?.continuidade);
        const v = Number(r.estoques?.estoque_atual || 0);
        if (c === 'PERMANENTE') estoqueHoje.permanente += v;
        else if (c === 'PERMANENTE COR NOVA') estoqueHoje.corNova += v;
        else if (c === 'EDICAO LIMITADA' || c === 'EDIÇÃO LIMITADA') estoqueHoje.edicaoLimitada += v;
        else estoqueHoje.outros += v;
      }
      // Base = só os permanentes, que é o universo da projeção. O uplift usa a mesma base,
      // por isso é 20,7% (edição limitada ÷ permanentes) e não 17,2% (fatia do total).
      const permHoje = estoqueHoje.permanente + estoqueHoje.corNova;
      const pctContinuidade: PctContinuidade = permHoje > 0
        ? {
            permanente: estoqueHoje.permanente / permHoje,
            corNova: estoqueHoje.corNova / permHoje,
            upliftEdicaoLimitada: estoqueHoje.edicaoLimitada / permHoje,
          }
        : { permanente: 0, corNova: 0, upliftEdicaoLimitada: 0 };
      const items: ProjectionItem[] = preview.itens || [];
      const initial = items.reduce((sum, item) => sum + Number(matrixById.get(String(item.idproduto))?.estoques?.estoque_disponivel || 0), 0);
      const process = items.reduce((sum, item) => sum + Number(matrixById.get(String(item.idproduto))?.estoques?.em_processo || 0), 0);
      const pedidosPendentes = items.reduce((sum, item) => sum + Number(matrixById.get(String(item.idproduto))?.demanda?.pedidos_pendentes || 0), 0);
      const planToDecember = items.reduce((sum, item) => { const p = matrixById.get(String(item.idproduto))?.plano || {}; return sum + Number(p.ma || 0) + Number(p.px || 0) + Number(p.ul || 0) + Number(p.qt || 0); }, 0);
      const demandToDecember = items.reduce((sum, item) => sum + vendaAteDezDe(String(item.idproduto), Number(matrixById.get(String(item.idproduto))?.demanda?.media_vendas_3m || item.media_3m || 0)), 0);
      const estoqueFimDezembro = initial - pedidosPendentes + planToDecember - demandToDecember;
      const baseSkus: BaseSku[] = items.map((item) => {
        const row = matrixById.get(String(item.idproduto));
        const stock = row?.estoques || {};
        const pending = Number(row?.demanda?.pedidos_pendentes || 0);
        const p = row?.plano || {};
        const media3m = Number(row?.demanda?.media_vendas_3m || item.media_3m || 0);
        const minimo = Number(stock.estoque_minimo || 0);
        const corte = cortePorId.get(String(item.idproduto)) || 0;
        return {
          id: String(item.idproduto),
          curva: curvaPorRef.get(norm(item.referencia)) || 'B',
          projecoes: item.projecoes,
          estoqueInicial: Number(stock.estoque_disponivel || 0) - pending + Number(p.ma || 0) + Number(p.px || 0) + Number(p.ul || 0) + Number(p.qt || 0) - vendaAteDezDe(String(item.idproduto), media3m),
          minimo,
          // Sem corte cadastrado o lote vira o próprio estoque mínimo — mesmo fallback da
          // Sugestão de Plano. Só 14 dos ~1.600 SKUs caem aqui.
          lote: corte > 0 ? corte : Math.max(1, Math.round(minimo)),
          tempo: timeByRef.get(norm(item.referencia)) || 0,
        };
      });
      // Mesma base fixa do divisor, senão "dias trabalhados" deixaria de bater com os dias
      // cadastrados em Capacidade.
      const capacidadePorMes = MONTHS.map((_, index) => CAPACIDADE_DIARIA_FIXA * Number(days[String(index + 1)] || 0));
      const vendas: VendasCanal = { fabrica: preview.vendas?.fabrica || {}, lojas: preview.vendas?.lojas || {} };
      const totalizadores: Record<string, Totalizador> = preview.totalizadores || {};
      setRawData({ anoBase, anoDestino, skus: items.length, estoqueInicial: initial, emProcesso: process, pedidosPendentes, estoqueFimDezembro, planoAteDezembro: planToDecember, capacidadeDiaria: capacidadeDiariaTotal, baseSkus, capacidadePorMes, pctContinuidade, vendas, totalizadores });
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao carregar visão macro'); }
    finally { setLoading(false); }
  }

  async function buscarCfgCurvas() {
    try {
      const res = await fetchNoCache(`${API_URL}/api/configuracoes/sugestao-plano`, { headers: authHeaders() });
      if (!res.ok) return;
      const c = (await res.json())?.data;
      if (!c) return;
      setCfgCurvas((prev) => ({
        cobertura_min_a: Number(c.cobertura_min_a ?? prev.cobertura_min_a),
        cobertura_max_a: Number(c.cobertura_max_a ?? prev.cobertura_max_a),
        cobertura_min_b: Number(c.cobertura_min_b ?? prev.cobertura_min_b),
        cobertura_max_b: Number(c.cobertura_max_b ?? prev.cobertura_max_b),
        cobertura_min_c: Number(c.cobertura_min_c ?? prev.cobertura_min_c),
        cobertura_max_c: Number(c.cobertura_max_c ?? prev.cobertura_max_c),
        cobertura_min_d: Number(c.cobertura_min_d ?? prev.cobertura_min_d),
        cobertura_max_d: Number(c.cobertura_max_d ?? prev.cobertura_max_d),
      }));
    } catch { /* silencioso: mantém os valores padrão */ }
  }

  useEffect(() => { if (!getToken()) { router.replace('/login'); return; } carregar(); buscarCfgCurvas(); }, [router]);
  // O estado corrente de estoque é reconstruído do zero a cada cálculo: ele é consumido
  // dentro do laço, então reaproveitar o do cálculo anterior partiria de números já gastos.
  const coberturaPorCurva = useMemo<Record<Curva, number>>(() => ({
    A: Number(cfgCurvas.cobertura_min_a), B: Number(cfgCurvas.cobertura_min_b),
    C: Number(cfgCurvas.cobertura_min_c), D: Number(cfgCurvas.cobertura_min_d),
  }), [cfgCurvas]);
  // Teto que dispara o meio lote. A folga de +0,5 na curva A é a mesma da Sugestão de Plano
  // (getCoberturaMaxToleradaParaCorteMinimo).
  const coberturaMaxPorCurva = useMemo<Record<Curva, number>>(() => ({
    A: Number(cfgCurvas.cobertura_max_a) + 0.5, B: Number(cfgCurvas.cobertura_max_b),
    C: Number(cfgCurvas.cobertura_max_c), D: Number(cfgCurvas.cobertura_max_d),
  }), [cfgCurvas]);
  const meses = useMemo<MonthRow[]>(() => {
    if (!rawData) return [];
    const corrente = new Map(rawData.baseSkus.map((s) => [s.id, s.estoqueInicial]));
    const alvoDe = (s: BaseSku) => (modoCobertura === 'curva' ? (coberturaPorCurva[s.curva] ?? 1) * multiplicadorCobertura : modoCobertura);
    const maxDe = (s: BaseSku) => coberturaMaxPorCurva[s.curva] ?? 3;
    return MONTHS.map((mes, index) => {
      const demanda = rawData.baseSkus.reduce((sum, s) => sum + Number(s.projecoes?.[mes] || 0), 0);
      const producaoPorCurva: Record<Curva, number> = { A: 0, B: 0, C: 0, D: 0 };
      let producao = 0; let carga = 0;
      for (const s of rawData.baseSkus) {
        const venda = Number(s.projecoes?.[mes] || 0);
        const atual = Number(corrente.get(s.id) || 0);
        // Piso em C x estoque mínimo. C sai da curva do SKU (política) ou do alvo único
        // escolhido na tela. Somar por curva aqui garante que os filhos fechem com o pai.
        const bruta = Math.max(0, s.minimo * alvoDe(s) - (atual - venda));
        // A fábrica não corta quantidade exata: todo plano vira lote. Arredonda para baixo
        // quando o disponível ainda fica >= 0, senão para cima; e se isso estourar a
        // cobertura máxima da curva, tenta meio lote. É a regra da Sugestão de Plano.
        let necessidade = 0;
        if (bruta > 0) {
          const piso = Math.floor(bruta / s.lote) * s.lote;
          const teto = Math.ceil(bruta / s.lote) * s.lote;
          necessidade = piso > 0 && atual + piso - venda >= 0 ? piso : teto;
          if (s.minimo > 0 && s.lote > 1 && (atual + necessidade - venda) / s.minimo > maxDe(s)) {
            const meio = Math.max(1, Math.round(s.lote / 2));
            const planoMeio = Math.ceil(bruta / meio) * meio;
            if (atual + planoMeio - venda >= 0) necessidade = planoMeio;
          }
        }
        corrente.set(s.id, atual - venda + necessidade);
        producaoPorCurva[s.curva] += necessidade;
        producao += necessidade;
        carga += necessidade * s.tempo;
      }
      const capacidade = Number(rawData.capacidadePorMes[index] || 0);
      const estoque = Array.from(corrente.values()).reduce((sum, v) => sum + v, 0);
      const diasDisponiveis = rawData.capacidadeDiaria > 0 ? capacidade / rawData.capacidadeDiaria : 0;
      const diasNecessarios = rawData.capacidadeDiaria > 0 ? carga / rawData.capacidadeDiaria : 0;
      // Capacidade em pecas nao e constante: depende do mix. Uma peca vai de 2,3 a 22,7 min,
      // entao o mesmo minuto de fabrica rende quantidades diferentes conforme o que se produz.
      // Aqui e "quantas pecas caberiam no mes, ao mix planejado para ele".
      const minPorPeca = producao > 0 ? carga / producao : 0;
      const capacidadePecas = minPorPeca > 0 ? capacidade / minPorPeca : 0;
      return { mes, demanda, producao, producaoPorCurva, estoque, cobertura: demanda > 0 ? estoque / demanda : 0, carga, capacidade, capacidadePecas, diasDisponiveis, diasNecessarios, utilizacao: capacidade > 0 ? (carga / capacidade) * 100 : 0 };
    });
  }, [rawData, modoCobertura, multiplicadorCobertura, coberturaPorCurva, coberturaMaxPorCurva]);
  // `data` continua com o mesmo formato de antes, então todos os consumidores de
  // `data.meses` seguem funcionando sem alteração.
  const data = useMemo(() => (rawData ? { ...rawData, meses } : null), [rawData, meses]);
  const totalDemanda = useMemo(() => data?.meses.reduce((s, m) => s + m.demanda, 0) || 0, [data]);
  const totalProducao = useMemo(() => data?.meses.reduce((s, m) => s + m.producao, 0) || 0, [data]);
  const ultimo = data?.meses[data.meses.length - 1];
  const primeiroNegativo = data?.meses.find((m) => m.estoque < 0);
  type VisaoGeralLinha = { label: string; values: (number | null)[]; decimals?: number; suffix?: string; dangerBelow?: number };
  type VisaoGeralBloco = VisaoGeralLinha & { id: string; rowClass: string; filhos: VisaoGeralLinha[] };
  const visaoGeralBlocos = useMemo<VisaoGeralBloco[]>(() => {
    if (!data) return [];
    const val = (i: number, rec: Record<string, number>) => Number(rec[String(i + 1)] || 0);
    const tot = (i: number) => data.totalizadores[String(i + 1)] || { fabrica: 0, fabricaAjustada: 0, lojas: 0, total: 0 };
    return [
      {
        id: 'vendas', label: 'Vendas', rowClass: 'bg-sky-50',
        // Fábrica já ajustada + lojas: os filhos somam exatamente o pai.
        values: data.meses.map((_, i) => Number(tot(i).fabricaAjustada || 0) + Number(tot(i).lojas || 0)),
        filhos: [
          { label: 'Fábrica (base)', values: data.meses.map((_, i) => val(i, data.vendas.fabrica)) },
          { label: 'Ajuste de fábrica', values: data.meses.map((_, i) => Number(tot(i).fabricaAjustada || 0) - Number(tot(i).fabrica || 0)) },
          { label: 'Lojas', values: data.meses.map((_, i) => val(i, data.vendas.lojas)) },
        ],
      },
      {
        // Não é produção realizada: é o quanto de plano precisa entrar para o estoque não
        // furar o mínimo depois da venda projetada, já descontado o plano que hoje existe.
        id: 'producao', label: 'Plano previsto', rowClass: 'bg-emerald-50',
        values: data.meses.map((m) => m.producao),
        filhos: [
          ...CURVAS.map((cv) => ({
            // Mostra o alvo efetivamente aplicado, não a política base: com o multiplicador
            // em 3x a curva A opera em 0,60x, e no modo de alvo único todas usam o mesmo.
            label: `Curva ${cv} (${(modoCobertura === 'curva' ? coberturaPorCurva[cv] * multiplicadorCobertura : modoCobertura).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}x)`,
            values: data.meses.map((m) => m.producaoPorCurva[cv]),
          })),
        ],
      },
      {
        id: 'estoque', label: 'Estoque projetado', rowClass: 'bg-amber-50',
        values: data.meses.map((m) => m.estoque),
        filhos: [
          { label: `Permanente (${(data.pctContinuidade.permanente * 100).toFixed(1)}% do projetado)`, values: data.meses.map((m) => m.estoque * data.pctContinuidade.permanente) },
          { label: `Permanente cor nova (${(data.pctContinuidade.corNova * 100).toFixed(1)}%)`, values: data.meses.map((m) => m.estoque * data.pctContinuidade.corNova) },
          { label: `Edição limitada (+${(data.pctContinuidade.upliftEdicaoLimitada * 100).toFixed(1)}%, estimada)`, values: data.meses.map((m) => m.estoque * data.pctContinuidade.upliftEdicaoLimitada) },
          { label: 'Total com edição limitada', values: data.meses.map((m) => m.estoque * (1 + data.pctContinuidade.upliftEdicaoLimitada)) },
          { label: 'Cobertura', values: data.meses.map((m) => (m.demanda > 0 ? m.cobertura : null)), decimals: 1, suffix: 'x', dangerBelow: 1 },
        ],
      },
      {
        id: 'capacidade', label: 'Capacidade (peças)', rowClass: 'bg-slate-100',
        values: data.meses.map((m) => m.capacidadePecas),
        filhos: [
          { label: 'Em minutos', values: data.meses.map((m) => m.capacidade) },
          { label: 'Minutos por peça (mix do mês)', values: data.meses.map((m) => (m.producao > 0 ? m.carga / m.producao : null)), decimals: 2 },
          { label: 'Dias trabalhados', values: data.meses.map((m) => m.diasDisponiveis), decimals: 1 },
          { label: 'Dias necessários', values: data.meses.map((m) => m.diasNecessarios), decimals: 1 },
          { label: 'Utilização', values: data.meses.map((m) => m.utilizacao), decimals: 0, suffix: '%' },
        ],
      },
    ];
    // coberturaPorCurva entra explicitamente: hoje ela chega aqui por tabela (via `meses`),
    // mas os rótulos das curvas a leem direto e ficariam defasados se essa cadeia mudar.
  }, [data, coberturaPorCurva, modoCobertura, multiplicadorCobertura]);
  const Trend = ({ curr, prev }: { curr: number | null; prev: number | null }) => {
    if (curr === null || prev === null || curr === prev) return null;
    return curr > prev
      ? <span className="text-emerald-600 ml-1 text-[10px] align-middle">▲</span>
      : <span className="text-red-600 ml-1 text-[10px] align-middle">▼</span>;
  };

  return <div className="min-h-screen bg-gray-100"><Sidebar onCollapse={setCollapsed} /><main className={`${collapsed ? 'ml-20' : 'ml-64'} p-6 transition-all`}>
    <div className="flex items-start justify-between mb-6"><div><p className="text-xs uppercase tracking-widest text-gray-500">Planejamento agregado</p><h1 className="text-2xl font-bold text-gray-900">Visão Macro de Estoque e Capacidade</h1><p className="text-sm text-gray-500 mt-1">Projeção {data?.anoDestino || new Date().getFullYear() + 1}.1 usando permanentes com venda em 6m ou 3m.</p></div><button onClick={carregar} className="flex items-center gap-2 px-3 py-2 bg-white border rounded-lg text-sm text-gray-700 hover:bg-gray-50"><RefreshCw size={16} /> Atualizar</button></div>
    {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    {loading ? <div className="rounded-lg bg-white p-10 text-center text-gray-500">Calculando visão macro...</div> : data && <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 py-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Cobertura-alvo</span>
          <button
            onClick={() => setModoCobertura('curva')}
            title="Usa a cobertura mínima configurada para cada curva ABC"
            className={`rounded px-2 py-0.5 text-xs font-semibold transition ${modoCobertura === 'curva' ? 'bg-slate-800 text-white' : 'text-gray-600 hover:bg-gray-200'}`}
          >
            Por curva
          </button>
          {modoCobertura === 'curva' && [1, 1.5, 2, 3, 4].map((m) => (
            <button
              key={`m${m}`}
              onClick={() => setMultiplicadorCobertura(m)}
              title={`Política × ${m} — curva A fica em ${(coberturaPorCurva.A * m).toFixed(2)}x`}
              className={`rounded px-1.5 py-0.5 text-[11px] font-semibold transition ${multiplicadorCobertura === m ? 'bg-emerald-700 text-white' : 'text-gray-500 hover:bg-gray-200'}`}
            >
              ×{m.toLocaleString('pt-BR')}
            </button>
          ))}
          <span className="h-3 w-px bg-gray-300" />
          {[0.5, 1, 1.5, 2].map((c) => (
            <button
              key={c}
              onClick={() => setModoCobertura(c)}
              title="Aplica o mesmo alvo a todos os SKUs (simulação)"
              className={`rounded px-2 py-0.5 text-xs font-semibold transition ${modoCobertura === c ? 'bg-slate-800 text-white' : 'text-gray-600 hover:bg-gray-200'}`}
            >
              {c.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x
            </button>
          ))}
          <span className="text-[10px] text-gray-400">do estoque mínimo</span>
        </div>
        {(() => {
          const curvas = [
            { letra: 'A', cor: 'text-emerald-600', min: cfgCurvas.cobertura_min_a, max: cfgCurvas.cobertura_max_a },
            { letra: 'B', cor: 'text-blue-600',    min: cfgCurvas.cobertura_min_b, max: cfgCurvas.cobertura_max_b },
            { letra: 'C', cor: 'text-amber-600',   min: cfgCurvas.cobertura_min_c, max: cfgCurvas.cobertura_max_c },
            { letra: 'D', cor: 'text-red-600',     min: cfgCurvas.cobertura_min_d, max: cfgCurvas.cobertura_max_d },
          ];
          const fmtX = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x`;
          return (
            <div className="flex shrink-0 items-center gap-x-2.5 rounded-md border border-gray-200 bg-gray-50 px-3 py-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Cob. mín</span>
              {curvas.map((c) => (
                <span key={`min-${c.letra}`} className="text-xs text-gray-700">
                  <span className={`font-bold ${c.cor}`}>{c.letra}</span> {fmtX(c.min)}
                </span>
              ))}
              <span className="h-3 w-px bg-gray-300" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Cob. máx</span>
              {curvas.map((c) => (
                <span key={`max-${c.letra}`} className="text-xs text-gray-700">
                  <span className={`font-bold ${c.cor}`}>{c.letra}</span> {fmtX(c.max)}
                </span>
              ))}
            </div>
          );
        })()}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {[['Estoque em dezembro', fmt(data.estoqueFimDezembro), data.estoqueFimDezembro < 0 ? 'text-red-700' : 'text-blue-700'], ['Demanda 2027.1', fmt(totalDemanda), 'text-emerald-700'], ['Plano previsto 2027.1', fmt(totalProducao), 'text-indigo-700'], ['Capacidade diária média 3M', fmt(data.capacidadeDiaria), 'text-slate-800']].map(([label, value, color]) => <div key={label} className="bg-white border border-gray-200 rounded-lg px-4 py-3"><div className="text-xs uppercase tracking-wide text-gray-500 truncate" title={label}>{label}</div><div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div></div>)}
      </div>
      <div className="bg-white border border-gray-200 rounded-lg mb-6 overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center gap-2">
          <LayoutGrid size={18} className="text-slate-600" />
          <div>
            <h2 className="font-semibold text-gray-900">Visão Geral</h2>
            <p className="text-xs text-gray-500">Vendas, plano previsto, estoque projetado e capacidade — mês a mês, cada bloco abrindo em detalhe.</p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => setAbertos(Object.fromEntries(visaoGeralBlocos.map((b) => [b.id, true])))}
              className="rounded border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 transition hover:bg-gray-100"
            >
              Expandir todos
            </button>
            <button
              onClick={() => setAbertos(Object.fromEntries(visaoGeralBlocos.map((b) => [b.id, false])))}
              className="rounded border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 transition hover:bg-gray-100"
            >
              Recolher todos
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-base">
            <thead className="bg-gray-50 text-[13px] uppercase">
              <tr>
                <th className="px-4 py-3 text-left text-gray-700">Indicador</th>
                {MONTHS.map((m, i) => (
                  <th key={m} className={`px-4 py-3 text-right font-bold ${CORES_MES[i].th}`}>{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visaoGeralBlocos.map((bloco) => {
                const aberto = abertos[bloco.id] !== false;
                const celulas = (linha: VisaoGeralLinha, destaque: boolean) => linha.values.map((v, i) => {
                  const perigo = linha.dangerBelow !== undefined && v !== null && v < linha.dangerBelow;
                  const texto = v === null ? '—' : linha.decimals !== undefined ? `${v.toFixed(linha.decimals)}${linha.suffix || ''}` : fmt(v);
                  return (
                    <td key={i} className={`px-4 py-3 text-right font-mono ${destaque ? '' : CORES_MES[i].td} ${perigo ? 'text-red-600 font-semibold' : destaque ? 'font-semibold text-gray-900' : 'text-gray-900'}`}>
                      {texto}
                      {i > 0 && <Trend curr={v} prev={linha.values[i - 1]} />}
                    </td>
                  );
                });
                return (
                  <Fragment key={bloco.id}>
                    <tr
                      className={`border-t cursor-pointer select-none hover:brightness-95 ${bloco.rowClass}`}
                      onClick={() => setAbertos((prev) => ({ ...prev, [bloco.id]: !aberto }))}
                    >
                      <td className="px-4 py-3 font-semibold text-gray-900">
                        <span className="inline-flex items-center gap-1.5">
                          {aberto ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
                          {bloco.label}
                        </span>
                      </td>
                      {celulas(bloco, true)}
                    </tr>
                    {aberto && bloco.filhos.map((filho) => (
                      <tr key={filho.label} className="border-t border-gray-100">
                        <td className="px-4 py-2.5 pl-11 text-[15px] font-medium text-gray-900">{filho.label}</td>
                        {celulas(filho, false)}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {(primeiroNegativo || (data.meses.some((m) => m.utilizacao > 100))) && <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><TriangleAlert size={17} />{primeiroNegativo ? `O estoque projetado fica negativo em ${primeiroNegativo.mes}.` : 'Há meses acima de 100% da capacidade cadastrada.'} Essa tela é uma visão de decisão; o detalhamento continua no plano.</div>}
    </>}
  </main></div>;
}
