'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, LayoutGrid, RefreshCw, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import PainelCapacidade, { type ResumoDiasCapacidade } from '../components/PainelCapacidade';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;
type Month = typeof MONTHS[number];
const CURVAS = ['A', 'B', 'C', 'D'] as const;
type Curva = typeof CURVAS[number];
// Uma cor por mês. O fundo entra só nas linhas filhas: na linha-pai já existe a cor do
// bloco, e pintar coluna por cima embolaria as duas leituras.
const MONTH_LABELS = ['SET', 'OUT', 'NOV', 'DEZ', 'JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const MES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const PERIODOS_CAPACIDADE = ['MA', 'PX', 'UL', 'QT'] as const;
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
type PctContinuidade = { permanente: number; corNova: number; edicaoLimitada: number };
// Insumos por SKU guardados crus: o laço mês a mês virou memo para reagir ao seletor
// de cobertura sem refazer as consultas.
type BaseSku = { id: string; curva: Curva; projecoes: Record<Month, number>; estoqueInicial: number; minimo: number; lote: number; tempo: number };
type Group = { grupo: string; capacidade_diaria: number };
type RealCapacity = { grupo: string; minutosTrabalhados: number; diasComMovimento: number; mes?: string };
type MonthRow = { mes: Month; demanda: number; producao: number; producaoPorCurva: Record<Curva, number>; estoque: number; cobertura: number; carga: number; capacidade: number; capacidadePecas: number; diasDisponiveis: number; diasNecessarios: number; utilizacao: number };
type VendasCanal = { fabrica: Record<string, number>; lojas: Record<string, number> };
type Totalizador = { fabrica: number; fabricaAjustada: number; lojas: number; total: number };

// Posição atual dos SKUs em linha da matriz. `emProcessoPorPeriodo` ainda não existe na
// matriz, então o processo entra só como total.
type Posicao = { skus: number; estoqueAtual: number; pedidosPendentes: number; estoqueDisponivel: number; emProcesso: number };

type PlanoPeriodo = { qtdLote: number; qtdGerouOp: number };

type PlanoCurva = Record<string, Record<Curva, { lote: number; op: number }>>;

// Linha crua de /api/producao/lotes-execucao-matriz: uma por SKU x periodo do plano.
type LoteExecucaoRow = { referencia: string; periodo: string; qtdLote: number; qtdFinalizada: number; qtdProcesso: number };

// Processo móvel (etapa 3 da issue #12): o que está em OP aberta hoje, por período do
// plano, e uma previsão de quanto estará em processo nos próximos meses — assumindo que a
// produção decidida num mês fica "em processo" por `leadTimeMeses` antes de virar estoque.
// Capacidade que rola com o mês (etapa 4): quanto ainda cabe no mês corrente e quando o
// plano do período MA deve terminar, dado o ritmo real de produção.
type ProcessoCapacidade = {
  processoPorPeriodo: Record<string, number>;
  leadTimeDias: number;
  cargaRestanteMA: number;
  capacidadeRestanteMes: number;
  minutosExecutadosMesAtual: number;
  diasUteisRestantes: number;
  previsaoTermino: string | null;
};

const fmt = (n: number) => Math.round(n || 0).toLocaleString('pt-BR');
const fmtPct = (n: number) => `${Math.round(n || 0)}%`;
const norm = (v: unknown) => String(v || '').trim().toUpperCase();
// Soma dias úteis (seg-sex) a partir de hoje — usado só para estimar quando o plano
// corrente termina; não desconta feriados.
const addDiasUteis = (base: Date, dias: number) => {
  const data = new Date(base);
  let restantes = Math.max(0, Math.round(dias));
  while (restantes > 0) {
    data.setDate(data.getDate() + 1);
    const diaSemana = data.getDay();
    if (diaSemana !== 0 && diaSemana !== 6) restantes -= 1;
  }
  return data;
};

export default function VisaoGeral2Page() {
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
  // Capacidade vem pronta do backend, a mesma conta da tela de Capacidade e da Reducao de
  // Plano. Busca separada do carregar(): e barata, cacheada no servidor, e se falhar o
  // painel some sem derrubar o resto da pagina.
  const [resumoDias, setResumoDias] = useState<(ResumoDiasCapacidade & { periodos?: Record<string, number> }) | null>(null);
  const [rawData, setRawData] = useState<{ anoBase: number; anoDestino: number; skus: number; estoqueInicial: number; emProcesso: number; pedidosPendentes: number; estoqueFimDezembro: number; planoAteDezembro: number; capacidadeDiaria: number; baseSkus: BaseSku[]; capacidadePorMes: number[]; pctContinuidade: PctContinuidade; vendas: VendasCanal; totalizadores: Record<string, Totalizador>; projecaoTotal: number[]; projecaoMatrizTotal: number[]; estoqueBaseReal: number; estoqueFisicoItems: number; agendaWip: Record<string, number>; agendaPendente: Record<string, number>; agendaMeta: { wipVencido: number }; posicao: Posicao; planoPeriodos: Record<string, PlanoPeriodo>; planoPorCurva: PlanoCurva } & ProcessoCapacidade | null>(null);

  async function carregar() {
    setLoading(true); setError(null);
    try {
      const anoBase = new Date().getFullYear();
      const anoDestino = anoBase + 1;
      const hoje = new Date();
      const isoMes = (offset: number) => new Date(hoje.getFullYear(), hoje.getMonth() + offset, 1).toISOString().slice(0, 10);
      // Só o tempos-ref depende do preview (precisa da lista de referências). Config, matriz
      // e capacidade real são independentes e estavam esperando na fila sem motivo: disparar
      // tudo junto tira ~38s do caminho crítico.
      // Etapa 3 (processo móvel): 6 meses de historico bastam pra media de dias de OP
      // nao ficar refem de um unico pico sazonal.
      const desdeLeadTime = new Date(hoje.getFullYear(), hoje.getMonth() - 6, hoje.getDate()).toISOString().slice(0, 10);
      const [previewResponse, configResponse, matrixResponse, realResponse, realMesAtualResponse, curvaResponse, corteResponse, projBaseResponse, proj2027Response, planoResponse, lotesExecResponse, indicadoresOpResponse, agendaResponse] = await Promise.all([
        fetchNoCache(`${API_URL}/api/projecao-permanentes/preview?anoBase=${anoBase}&anoDestino=${anoDestino}&completarMesesAbertos=true`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/capacidade/config`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/producao/matriz?limit=5000&prefer_cache=true&marca=LIEBE&status=EM%20LINHA%2CNOVA%20COLECAO`),
        // `ate=isoMes(0)` corta no dia 1 do mês corrente de propósito, pra média de 3M não
        // levar um mês ainda incompleto. Por isso o executado deste mês vem de outra chamada.
        fetchNoCache(`${API_URL}/api/capacidade/real?de=${isoMes(-3)}&ate=${isoMes(0)}`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/capacidade/real?de=${isoMes(0)}&ate=${isoMes(1)}`, { headers: authHeaders() }),
        // Vão no mesmo Promise.all de propósito: se fossem fetches soltos, o cálculo poderia
        // rodar antes de chegarem, e todo SKU cairia no default de curva e de lote.
        fetchNoCache(`${API_URL}/api/analises/curva-abc-referencias`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/configuracoes/corte-minimos`, { headers: authHeaders() }),
        // Projeção gravada de set a dez, para não estimar a demanda por média. Custa ~20s e
        // é a chamada mais lenta da tela. Atenção: este endpoint colapsa os anos na mesma
        // chave de mês — hoje funciona porque a busca de baixo é de um ANO SEPARADO
        // (anoDestino), então não tem risco de um sobrescrever o outro aqui.
        fetchNoCache(`${API_URL}/api/projecoes/por-mes?ano=${anoBase}&meses=9,10,11,12`, { headers: authHeaders() }),
        // Projeção gravada de 2027: conferido em 30/09/2026 que jan-jun já está lançado
        // (~1.600 SKUs, sem os buracos de dez/2026). O modelo (fábrica+10% do mesmo mês do
        // ano anterior) só entra onde isto não cobrir.
        fetchNoCache(`${API_URL}/api/projecoes/por-mes?ano=${anoDestino}&meses=1,2,3,4,5,6,7,8,9,10,11,12`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/producao/percentual-finalizado?marca=LIEBE&status=EM%20LINHA,NOVA%20COLECAO`),
        // Processo por período do plano (etapa 3) e carga restante do MA (etapa 4): mesma
        // view usada no Extrato do Plano, sem filtro de período.
        fetchNoCache(`${API_URL}/api/producao/lotes-execucao-matriz?marca=LIEBE&status=EM%20LINHA,NOVA%20COLECAO`, { headers: authHeaders() }),
        // Tempo médio real de OP (etapa 3/4): media_dias já exclui outliers (melhor e pior OP).
        fetchNoCache(`${API_URL}/api/indicadores-op/liebe?desde=${desdeLeadTime}`, { headers: authHeaders() }),
        // Quando o estoque se mexe: OP por mês de entrega prevista e pedido pendente por mês
        // de baixa prevista, com a data do próprio ERP. Vem por SKU, sem filtro de marca.
        fetchNoCache(`${API_URL}/api/producao/agenda-estoque`, { headers: authHeaders() }),
      ]);
      const preview = await previewResponse.json();
      if (!previewResponse.ok || !preview.success) throw new Error(preview.error || 'Erro ao carregar projeção');
      const refs = Array.from(new Set((preview.itens || []).map((i: ProjectionItem) => norm(i.referencia)).filter(Boolean)));
      const tempoResponse = await fetchNoCache(`${API_URL}/api/capacidade/tempos-ref?referencias=${encodeURIComponent(refs.join(','))}`, { headers: authHeaders() });
      const config = await configResponse.json(); const matrix = await matrixResponse.json(); const tempos = await tempoResponse.json();
      const real = await realResponse.json();
      const realMesAtual = await realMesAtualResponse.json();
      // Processo e lead time são complementares: se falharem, a tela segue com os
      // cartões zerados em vez de derrubar a Visão Geral inteira.
      const lotesExecJson = lotesExecResponse.ok ? await lotesExecResponse.json() : null;
      const indicadoresOpJson = indicadoresOpResponse.ok ? await indicadoresOpResponse.json() : null;
      const lotesExecucao: LoteExecucaoRow[] = Array.isArray(lotesExecJson?.data) ? lotesExecJson.data : [];
      const processoPorPeriodo: Record<string, number> = { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 };
      for (const row of lotesExecucao) {
        const periodo = norm(row.periodo);
        if (periodo in processoPorPeriodo) processoPorPeriodo[periodo] += Number(row.qtdProcesso || 0);
      }
      const leadTimeDias = Number(indicadoresOpJson?.indicadores?.media_dias) || 25;
      const referenciaPorId = new Map<string, string>((matrix.data || []).map((r: MatrixRow) => [String(r.produto?.idproduto), norm(r.produto?.referencia)]));
      const curvaJson = await curvaResponse.json();
      const curvaPorRef = new Map<string, Curva>(
        Object.entries((curvaJson?.porReferencia || {}) as Record<string, string>)
          .map(([ref, cv]) => [norm(ref), norm(cv) as Curva])
      );
      const projBaseJson = await projBaseResponse.json();
      const proj2027Json = await proj2027Response.json();
      const proj2027PorSku = (proj2027Json?.data || {}) as Record<string, Record<string, number>>;
      const planoJson = await planoResponse.json();
      const execucaoJson = { data: planoJson?.detalhes || [] };
      const planoPeriodos = (planoJson?.data || {}) as Record<string, PlanoPeriodo>;
      const planoPorCurva: PlanoCurva = {};
      const lotesProcessados = new Set<string>();
      for (const row of (Array.isArray(execucaoJson?.data) ? execucaoJson.data : [])) {
        const periodo = norm(row.periodo);
        const chaveLote = String(row.sku || row.idproduto || '') + ':' + periodo;
        if (lotesProcessados.has(chaveLote)) continue;
        lotesProcessados.add(chaveLote);
        const referencia = String(row.referencia || referenciaPorId.get(String(row.idproduto)));
        const curva = curvaPorRef.get(norm(referencia));
        if (!periodo || !['MA', 'PX', 'UL', 'QT', 'QU'].includes(periodo) || !curva || !['A', 'B', 'C', 'D'].includes(curva)) continue;
        planoPorCurva[periodo] ||= { A: { lote: 0, op: 0 }, B: { lote: 0, op: 0 }, C: { lote: 0, op: 0 }, D: { lote: 0, op: 0 } };
        planoPorCurva[periodo][curva].lote += Number(row.qtdLote || 0);
        planoPorCurva[periodo][curva].op += Number(row.qtdGerouOp || 0);
      }
      const projBasePorSku = (projBaseJson?.data || {}) as Record<string, Record<string, number>>;
      const projPorSku = projBasePorSku;
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
      const totalHoje = estoqueHoje.permanente + estoqueHoje.corNova + estoqueHoje.edicaoLimitada + estoqueHoje.outros;
      const pctContinuidade: PctContinuidade = totalHoje > 0
        ? { permanente: estoqueHoje.permanente / totalHoje, corNova: estoqueHoje.corNova / totalHoje, edicaoLimitada: estoqueHoje.edicaoLimitada / totalHoje }
        : { permanente: 0, corNova: 0, edicaoLimitada: 0 };
      const items: ProjectionItem[] = preview.itens || [];
      // set-dez de 2026 vêm só da projeção gravada de 2026; o por-mes de 2027 colapsa o mês
      // na mesma chave e sobrescreveria. Os meses de 2027 usam as regras de permanentes
      // (preview), lidas de `meses` e não daqui.
      const projecaoTotal = Array.from({ length: 13 }, (_, mes) => items.reduce((sum, item) => sum + Number(projBasePorSku[String(item.idproduto)]?.[String(mes)] || 0), 0));
      // Mesma projeção gravada, mas somada sobre TODOS os SKUs da matriz, não só os
      // permanentes. O estoque de 364.623 e o plano são da matriz inteira; a venda tem que
      // ser da mesma população, senão a projeção de estoque sobra (set: 187.489 contra
      // 149.695 dos permanentes).
      const projecaoMatrizTotal = Array.from({ length: 13 }, (_, mes) => (matrix.data || []).reduce(
        (sum: number, r: MatrixRow) => sum + Number(projBasePorSku[String(r.produto?.idproduto || '')]?.[String(mes)] || 0), 0
      ));
      const posicao: Posicao = { skus: 0, estoqueAtual: 0, pedidosPendentes: 0, estoqueDisponivel: 0, emProcesso: 0 };
      for (const r of (matrix.data || []) as MatrixRow[]) {
        posicao.skus += 1;
        posicao.estoqueAtual += Number(r.estoques?.estoque_atual || 0);
        posicao.pedidosPendentes += Number(r.demanda?.pedidos_pendentes || 0);
        posicao.estoqueDisponivel += Number(r.estoques?.estoque_disponivel || 0);
        posicao.emProcesso += Number(r.estoques?.em_processo || 0);
      }
      const initial = items.reduce((sum, item) => sum + Number(matrixById.get(String(item.idproduto))?.estoques?.estoque_disponivel || 0), 0);
      // Estoque FÍSICO da mesma população que a projeção cobre (os permanentes do preview).
      // Os cards do topo somam a matriz inteira, que é outra população — por isso os dois
      // números não batem, e a tabela precisa se ancorar neste aqui pra não dar degrau.
      const estoqueFisicoItems = items.reduce((sum, item) => sum + Number(matrixById.get(String(item.idproduto))?.estoques?.estoque_atual || 0), 0);
      const process = items.reduce((sum, item) => sum + Number(matrixById.get(String(item.idproduto))?.estoques?.em_processo || 0), 0);
      const pedidosPendentes = items.reduce((sum, item) => sum + Number(matrixById.get(String(item.idproduto))?.demanda?.pedidos_pendentes || 0), 0);
      const planToDecember = items.reduce((sum, item) => { const p = matrixById.get(String(item.idproduto))?.plano || {}; return sum + Number(p.ma || 0) + Number(p.px || 0) + Number(p.ul || 0) + Number(p.qt || 0); }, 0);
      const demandToDecember = items.reduce((sum, item) => sum + vendaAteDezDe(String(item.idproduto), Number(matrixById.get(String(item.idproduto))?.demanda?.media_vendas_3m || item.media_3m || 0)), 0);
      // Composição medida no backend (producaoService: estoqueDisponivel = estoque + emProcesso):
      //   `estoque_disponivel` = estoque físico + em processo (NÃO abate pendente)
      //   `plano.ma/px/ul/qt/qu` da matriz = plano RESTANTE (lote que ainda não gerou OP)
      // Então estoque_disponivel + plano restante - vendas = estoque BRUTO no fim do período,
      // e o pendente só entra depois, virando o DISPONÍVEL.
      const estoqueFimDezembro = initial - pedidosPendentes + planToDecember - demandToDecember;
      // 2027 no preview é MODELO (mesmo mês do ano anterior, fábrica +10%) — mas jan-jun/2027
      // já têm projeção gravada de verdade em app_projecoes (~1.600 SKUs, conferido em
      // 30/09/2026). Onde tiver gravado, usa; o modelo cobre só o que ainda falta lançar.
      const projecoesAjustadas = (item: ProjectionItem): Record<Month, number> => {
        const gravado = proj2027PorSku[String(item.idproduto)];
        if (!gravado) return item.projecoes;
        const ajustada = { ...item.projecoes };
        MONTHS.forEach((mesNome, idx) => {
          const valor = gravado[String(idx + 1)];
          if (valor !== undefined) ajustada[mesNome] = Number(valor);
        });
        return ajustada;
      };
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
          projecoes: projecoesAjustadas(item),
          // Série LÍQUIDA (disponível): o que sobra pra atender venda nova. O estoque bruto
          // sai daqui somando o pendente de volta, na montagem das linhas.
          estoqueInicial: Number(stock.estoque_disponivel || 0) - pending + Number(p.ma || 0) + Number(p.px || 0) + Number(p.ul || 0) + Number(p.qt || 0) - vendaAteDezDe(String(item.idproduto), media3m),
          minimo,
          // Sem corte cadastrado o lote vira o próprio estoque mínimo — mesmo fallback da
          // Sugestão de Plano. Só 14 dos ~1.600 SKUs caem aqui.
          lote: corte > 0 ? corte : Math.max(1, Math.round(minimo)),
          tempo: timeByRef.get(norm(item.referencia)) || 0,
        };
      });
      // Agenda de estoque: o endpoint devolve por SKU e por mês (sem filtro de marca, porque
      // filtrar lá custa mais de um minuto). A agregação aqui é sobre `items`, a mesma
      // população dos permanentes que a projeção usa.
      const agendaJson = agendaResponse.ok ? await agendaResponse.json() : null;
      const agendaWipPorSku = (agendaJson?.data?.wip || {}) as Record<string, Record<string, number>>;
      const agendaPendPorSku = (agendaJson?.data?.pendente || {}) as Record<string, Record<string, number>>;
      const somarAgenda = (fonte: Record<string, Record<string, number>>) => {
        const total: Record<string, number> = {};
        for (const r of (matrix.data || []) as MatrixRow[]) {
          const porMes = fonte[String(r.produto?.idproduto || '')];
          if (!porMes) continue;
          for (const [mes, qtd] of Object.entries(porMes)) total[mes] = (total[mes] || 0) + Number(qtd || 0);
        }
        return total;
      };
      const agendaWip = somarAgenda(agendaWipPorSku);
      const agendaPendente = somarAgenda(agendaPendPorSku);
      const agendaMeta = { wipVencido: Number(agendaJson?.meta?.totais?.wipVencido || 0) };
      const capacidadePorMes = MONTHS.map((_, index) => capacityGroups.reduce((sum, g) => sum + Number(g.capacidade_diaria || 0) * Number(days[String(index + 1)] || 0), 0));
      const vendas: VendasCanal = { fabrica: preview.vendas?.fabrica || {}, lojas: preview.vendas?.lojas || {} };
      const totalizadores: Record<string, Totalizador> = preview.totalizadores || {};

      // Etapa 4: capacidade que "rola" com o mês. `capacidadePorMes` é por mês do
      // calendário (índice 0 = jan), então dá pra reaproveitar direto no mês atual.
      const minutosExecutadosMesAtual = ((realMesAtual.data || []) as RealCapacity[])
        .reduce((soma, row) => soma + Number(row.minutosTrabalhados || 0), 0);
      const capacidadeMesAtualTotal = Number(capacidadePorMes[hoje.getMonth()] || 0);
      const capacidadeRestanteMes = Math.max(0, capacidadeMesAtualTotal - minutosExecutadosMesAtual);
      // Carga restante do plano do período corrente (MA): peças do lote que ainda não
      // foram finalizadas, no tempo padrão da referência — mesma base de `s.tempo` acima.
      const cargaRestanteMA = lotesExecucao
        .filter((row) => norm(row.periodo) === 'MA')
        .reduce((soma, row) => {
          const restante = Math.max(0, Number(row.qtdLote || 0) - Number(row.qtdFinalizada || 0));
          return soma + restante * (timeByRef.get(norm(row.referencia)) || 0);
        }, 0);
      const diasUteisRestantes = capacidadeDiariaTotal > 0 ? cargaRestanteMA / capacidadeDiariaTotal : 0;
      const previsaoTermino = diasUteisRestantes > 0 ? addDiasUteis(hoje, diasUteisRestantes).toISOString().slice(0, 10) : null;

      setRawData({ anoBase, anoDestino, skus: items.length, estoqueInicial: initial, estoqueBaseReal: initial, estoqueFisicoItems, agendaWip, agendaPendente, agendaMeta, posicao, emProcesso: process, pedidosPendentes, estoqueFimDezembro, planoAteDezembro: planToDecember, capacidadeDiaria: capacidadeDiariaTotal, baseSkus, capacidadePorMes, pctContinuidade, vendas, totalizadores, projecaoTotal, projecaoMatrizTotal, planoPeriodos, planoPorCurva, processoPorPeriodo, leadTimeDias, cargaRestanteMA, capacidadeRestanteMes, minutosExecutadosMesAtual, diasUteisRestantes, previsaoTermino });
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

  useEffect(() => { if (!getToken()) { router.replace('/login'); return; } carregar(); buscarCfgCurvas(); carregarCapacidade(); }, [router]);

  async function carregarCapacidade() {
    try {
      const r = await fetchNoCache(`${API_URL}/api/capacidade/dias-resumo`, { headers: authHeaders() });
      const p = await r.json();
      if (!r.ok || !p?.success) return;
      setResumoDias({
        capacidadeDiaria: Number(p.capacidadeDiaria || 0),
        diasNecessarios: p.diasNecessarios || {},
        diasDisponiveis: p.diasDisponiveis || {},
        periodos: p.periodos || {},
      });
    } catch {
      setResumoDias(null);
    }
  }
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
      const minutosPorPeca = producao > 0 ? carga / producao : 0;
      const capacidadePecas = minutosPorPeca > 0 ? capacidade / minutosPorPeca : 0;
      return { mes, demanda, producao, producaoPorCurva, estoque, cobertura: demanda > 0 ? estoque / demanda : 0, carga, capacidade, capacidadePecas, diasDisponiveis, diasNecessarios, utilizacao: capacidade > 0 ? (carga / capacidade) * 100 : 0 };
    });
  }, [rawData, modoCobertura, multiplicadorCobertura, coberturaPorCurva, coberturaMaxPorCurva]);
  // `data` continua com o mesmo formato de antes, então todos os consumidores de
  // `data.meses` seguem funcionando sem alteração.
  const data = useMemo(() => (rawData ? { ...rawData, meses } : null), [rawData, meses]);

  // Uma unica linha do tempo: sai do plano fechado (out -> jan) e entra no projetado
  // (fev -> dez), acumulando sem quebra. Tudo na capacidade diaria MEDIDA do dias-resumo.
  //
  // Os dias necessarios desta tela nao servem: `capacidadeDiaria` daqui esta numa escala
  // ~18x maior que a medida, o que fazia janeiro aparecer como 2,3 dias em vez de dezenas.
  // `diasDisponiveis` daqui esta certo (numerador e denominador inflados juntos se anulam),
  // entao dele aproveitamos; dos necessarios reaproveitamos so a `carga`, que ja esta em
  // minutos reais, e dividimos pela capacidade medida.
  const resumoContinuo = useMemo<(ResumoDiasCapacidade & { chaves: string[] }) | null>(() => {
    if (!resumoDias || !data) return null;
    const capDiaria = Number(resumoDias.capacidadeDiaria || 0);
    if (capDiaria <= 0) return null;

    const anoBase = data.anoDestino - 1;
    const mesMA = Number(resumoDias.periodos?.MA || 0);
    const diasNecessarios: Record<string, number> = {};
    const diasDisponiveis: Record<string, number> = {};
    const chaves: string[] = [];

    for (const p of PERIODOS_CAPACIDADE) {
      const mes = Number(resumoDias.periodos?.[p] || 0);
      if (!mes) continue;
      const ano = mes >= mesMA ? anoBase : data.anoDestino;
      const chave = `${MES_ABREV[mes - 1]}/${String(ano).slice(2)}`;
      chaves.push(chave);
      diasNecessarios[chave] = Number(resumoDias.diasNecessarios?.[p] || 0);
      diasDisponiveis[chave] = Number(resumoDias.diasDisponiveis?.[p] || 0);
    }

    const ultimoMesFechado = Number(resumoDias.periodos?.QT || 0);
    for (const m of data.meses) {
      const mes = MONTHS.indexOf(m.mes) + 1;
      if (mes <= ultimoMesFechado) continue;
      const chave = `${m.mes}/${String(data.anoDestino).slice(2)}`;
      chaves.push(chave);
      diasNecessarios[chave] = m.carga / capDiaria;
      diasDisponiveis[chave] = m.diasDisponiveis;
    }

    return { capacidadeDiaria: capDiaria, diasNecessarios, diasDisponiveis, chaves };
  }, [resumoDias, data]);

  const ultimo = data?.meses[data.meses.length - 1];
  const primeiroNegativo = data?.meses.find((m) => m.estoque < 0);
  // Agrupamento visual por semestre (pedido do usuário): 4 meses (set-dez do ano corrente) +
  // 6 + 6. Os índices em `fimDeSemestre` são posições de MONTH_LABELS (0-15) que fecham um
  // semestre e recebem a borda mais forte à direita; o último semestre não fecha nada, é o
  // fim da tabela.
  const anoSemestre = data?.anoBase ?? new Date().getFullYear();
  const SEMESTRES = [
    { label: `${anoSemestre}.2`, meses: 4 },
    { label: `${anoSemestre + 1}.1`, meses: 6 },
    { label: `${anoSemestre + 1}.2`, meses: 6 },
  ];
  const fimDeSemestre = new Set([3, 9]);
  // A partir daqui a coluna "Real" nunca tem dado de verdade: 2027 não fecha mês com
  // totalizador realizado, só projeção. Só set-dez do ano corrente (índices 0-3) tem Real.
  const ULTIMA_COLUNA_REAL = 4;
  type VisaoGeralLinha = { label: string; hint?: string; values: (number | null)[]; decimals?: number; suffix?: string; dangerBelow?: number };
  type VisaoGeralBloco = VisaoGeralLinha & { id: string; rowClass: string; filhos: VisaoGeralLinha[] };
  const visaoGeralBlocos = useMemo<VisaoGeralBloco[]>(() => {
    if (!data) return [];
    const tot = (mes: number) => data.totalizadores[String(mes)] || { fabrica: 0, fabricaAjustada: 0, lojas: 0, total: 0 };
    const atual = [9, 10, 11, 12];
    // 2027 sai da projeção de permanentes (`meses[].demanda`), a mesma regra do preview.
    const projecao2027 = (i: number) => Number(data.meses[i]?.demanda || 0);
    const vendas = [...atual.flatMap((mes) => [Number(data.projecaoTotal[mes] || 0), Number(tot(mes).fabrica || 0) + Number(tot(mes).lojas || 0)]), ...MONTHS.map((_, i) => [projecao2027(i), null]).flat()];
    const realSetembro = tot(9);
    const totalRealSetembro = Number(realSetembro.fabrica || 0) + Number(realSetembro.lojas || 0);
    const participacaoFabrica = totalRealSetembro > 0 ? Number(realSetembro.fabrica || 0) / totalRealSetembro : 0;
    const fabrica = [
      ...atual.flatMap((mes) => {
        const real = tot(mes);
        const totalReal = Number(real.fabrica || 0) + Number(real.lojas || 0);
        const participacao = totalReal > 0 ? Number(real.fabrica || 0) / totalReal : participacaoFabrica;
        const projetado = Number(data.projecaoTotal[mes] || 0);
        return [Math.round(projetado * participacao), Number(real.fabrica || 0)];
      }),
      ...MONTHS.map((_, i) => [Math.round(projecao2027(i) * participacaoFabrica), null]).flat(),
    ];
    const lojas = [
      ...atual.flatMap((mes) => {
        const real = tot(mes);
        const totalReal = Number(real.fabrica || 0) + Number(real.lojas || 0);
        const participacao = totalReal > 0 ? Number(real.lojas || 0) / totalReal : 1 - participacaoFabrica;
        const projetado = Number(data.projecaoTotal[mes] || 0);
        return [Math.round(projetado * participacao), Number(real.lojas || 0)];
      }),
      ...MONTHS.map((_, i) => {
        const projetado = projecao2027(i);
        return [projetado -Math.round(projetado * participacaoFabrica), null];
      }).flat(),
    ];
    const periodosPlano = ['MA', 'PX', 'UL', 'QT', 'QU'];
    // O ERP empurra MA pro mês seguinte no último dia do mês corrente (mesma regra de
    // capacidade.js) — MA deixou de ser SET e virou OUT hoje (30/09/2026). Por isso a coluna
    // de cada período é calculada, não fixada: senão a tabela mostra o plano de outubro sob
    // o rótulo "SET", que é exatamente o que o usuário notou faltando no sistema.
    const hojeCalc = new Date();
    const ultimoDiaMesAtual = new Date(hojeCalc.getFullYear(), hojeCalc.getMonth() + 1, 0).getDate();
    const maMes = hojeCalc.getDate() === ultimoDiaMesAtual ? hojeCalc.getMonth() + 2 : hojeCalc.getMonth() + 1;
    // Coluna 0 = SET do anoBase; mês >= 9 cai no mesmo ano, mês < 9 é ano seguinte.
    const colunaDoMes = (m: number) => { const mm = ((m - 1) % 12) + 1; return (mm - 9 + 12) % 12; };
    const periodoParaColuna: Record<string, number> = {};
    periodosPlano.forEach((p, idx) => { periodoParaColuna[p] = colunaDoMes(maMes + idx); });
    const maxColunaPeriodo = Math.max(...Object.values(periodoParaColuna));
    // Coluna com período: usa o dado real do plano. Coluna depois do último período: usa a
    // simulação de 2027 (sempre ancorada em JAN = coluna 4, isso não muda com o rollover).
    // Coluna antes do primeiro período (hoje, só SET): fica em branco — não existe mais
    // plano em aberto pra um mês que o próprio ERP já fechou.
    const linhaPorPeriodo = (
      doPeriodo: (p: string) => [number, number],
      doSimulado: (idx: number) => [number, number | null]
    ): (number | null)[] => {
      const arr: (number | null)[] = [];
      for (let c = 0; c < 16; c += 1) {
        const periodo = periodosPlano.find((p) => periodoParaColuna[p] === c);
        if (periodo) {
          // O Real de um periodo de plano e o quanto dele ja virou OP. Em mes que ainda nao
          // chegou isso e zero por construcao, e um zero ali se disfarca de "produziu nada".
          // Fora da faixa de meses fechados o Real fica em branco, como ja acontece nas
          // colunas simuladas — e como o proprio cabecalho da tabela indica.
          const [projetado, real] = doPeriodo(periodo);
          arr.push(projetado, c < ULTIMA_COLUNA_REAL ? real : null);
        }
        else if (c > maxColunaPeriodo) arr.push(...doSimulado(c - 4));
        else arr.push(null, null);
      }
      return arr;
    };
    const planoPrevisto = linhaPorPeriodo(
      (p) => [Number(data.planoPeriodos[p]?.qtdLote || 0), Number(data.planoPeriodos[p]?.qtdGerouOp || 0)],
      (idx) => [Number(data.meses[idx]?.producao || 0), null]
    );
    const curvaPlano = (cv: Curva) => linhaPorPeriodo(
      (p) => [Number(data.planoPorCurva[p]?.[cv]?.lote || 0), Number(data.planoPorCurva[p]?.[cv]?.op || 0)],
      (idx) => [Number(data.meses[idx]?.producaoPorCurva[cv] || 0), null]
    );

    // ── Estoque atual ──────────────────────────────────────────────────────────────
    // Parte das 364.623 peças em casa (card, matriz inteira) e caminha pela variação do
    // mês: o que ainda ENTRA do plano menos o que SAI de venda.
    //
    // O que já está em processo tem data real de entrega (`dt_preventrega`, do ERP) e por
    // isso NÃO pode ser jogado inteiro no mês corrente: uma OP com entrega prevista pra
    // outubro entra em outubro, não em setembro só porque hoje é dia 30. `agendaWip` já vem
    // datado e somado por mês do calendário (mesma fonte da linha de Pendente/carteira).
    const chaveMes = (i: number) => {
      const d = new Date(data.anoBase, 8 + i, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    const wipPorColuna = Array.from({ length: 16 }, (_, i) => Number(data.agendaWip[chaveMes(i)] || 0));
    // O que ainda nem gerou OP não tem data — ninguém começou a produzir. Assume-se que
    // entra `leadTimeMeses` depois do período em que foi planejado (mesmo lead time medido
    // nas OPs reais, ~{leadTimeDias}d), sem passar de JAN (índice 4): além disso já é
    // território da simulação de 2027, que tem sua própria conta de produção.
    const leadTimeMeses = Math.max(1, Math.round(data.leadTimeDias / 30));
    const naoGerouOpDe = (p: string) => Math.max(0, Number(data.planoPeriodos[p]?.qtdLote || 0) - Number(data.planoPeriodos[p]?.qtdGerouOp || 0));
    const naoGerouOpPorColuna = Array(16).fill(0);
    periodosPlano.forEach((p) => { naoGerouOpPorColuna[Math.min(maxColunaPeriodo, periodoParaColuna[p] + leadTimeMeses)] += naoGerouOpDe(p); });
    // A simulação de 2027 (venda E produção) roda só sobre os permanentes, mas esta linha
    // está na matriz inteira. O fator abaixo é medido, não arbitrado: é a razão entre as
    // duas populações nos meses em que as duas existem (set-nov; dez fica de fora porque lá
    // as duas dão o mesmo número, sinal de projeção incompleta). Ele vale para os dois
    // lados da conta — escalar só a venda derrubaria o estoque de mentira.
    const baseMatriz = [9, 10, 11].reduce((s, m) => s + Number(data.projecaoMatrizTotal[m] || 0), 0);
    const basePerm = [9, 10, 11].reduce((s, m) => s + Number(data.projecaoTotal[m] || 0), 0);
    const fatorPopulacao = basePerm > 0 ? baseMatriz / basePerm : 1;
    // Entra: nos 5 primeiros períodos (MA→QU) é o WIP datado mais o que ainda não gerou OP
    // (deslocado pelo lead time); de FEV/2027 em diante é a produção que a simulação planeja.
    const entradaPlano = Array.from({ length: 16 }, (_, i) => (
      i <= maxColunaPeriodo ? wipPorColuna[i] + naoGerouOpPorColuna[i] : Math.round(Number(data.meses[i - 4]?.producao || 0) * fatorPopulacao)
    ));
    // No mês corrente sai só o que FALTA faturar: as 364.623 de hoje já estão líquidas do
    // que saiu no mês.
    const mesCorrenteIdx = Math.max(0, new Date().getMonth() - 8);
    const vendaProjetada = Array.from({ length: 16 }, (_, i) => {
      if (i >= 4) return Math.round(Number(data.meses[i - 4]?.demanda || 0) * fatorPopulacao);
      const mes = 9 + i;
      const projetado = Number(data.projecaoMatrizTotal[mes] || 0);
      return i === mesCorrenteIdx ? Math.max(0, projetado - Number(tot(mes).total || 0)) : projetado;
    });
    // Carteira com baixa prevista no mês (dt_prevbaixa, do ERP). A saída do mês é o maior
    // entre a venda projetada e essa carteira: o pedido pendente é compromisso firme e sai
    // de qualquer jeito, mas quando cabe dentro da projeção ele já está contado ali — somar
    // os dois tiraria a mesma peça duas vezes.
    const carteiraDoMes = Array.from({ length: 16 }, (_, i) => {
      const d = new Date(data.anoBase, 8 + i, 1);
      return Number(data.agendaPendente[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`] || 0);
    });
    const saidaVenda = vendaProjetada.map((v, i) => Math.max(v, carteiraDoMes[i]));
    const variacao = entradaPlano.map((v, i) => v - saidaVenda[i]);
    let saldoEstoque = Number(data.posicao.estoqueAtual || 0);
    const aberturaEstoque = variacao.map((v) => {
      const abertura = saldoEstoque;
      saldoEstoque = abertura + v;
      return abertura;
    });
    const linha16 = (valores: (number | null)[], realNaPrimeira: number | null = null) =>
      valores.flatMap((v, i) => [v, i === 0 ? realNaPrimeira : null]);
    return [
      {
        id: 'vendas', label: 'Vendas', rowClass: 'bg-sky-50', values: vendas,
        filhos: [
          { label: 'Fabrica', values: fabrica },
          { label: 'Lojas', values: lojas },
        ],
      },
      {
        id: 'producao', label: 'Plano', rowClass: 'bg-emerald-50',
        values: planoPrevisto,
        filhos: CURVAS.map((cv) => ({
          label: `Curva ${cv}`,
          values: curvaPlano(cv),
        })),
      },
      {
        id: 'estoque-atual', label: 'Estoque atual', rowClass: 'bg-blue-50',
        hint: 'Estoque físico na abertura do período, nos 2.947 SKUs da matriz. Caminha pela variação: o que ainda entra do plano menos a venda projetada.',
        values: linha16(aberturaEstoque, Number(data.posicao.estoqueAtual || 0)),
        filhos: [
          {
            label: '+ Plano que falta entrar',
            hint: `OP em processo, no mês em que o ERP prevê a entrega (dt_preventrega) — não tudo de uma vez no mês corrente. O que ainda não gerou OP entra ~${leadTimeMeses} mês(es) depois do período planejado (lead time medido: ${fmt(data.leadTimeDias)}d). Peças já finalizadas não entram aqui: já estão no estoque atual.`,
            values: linha16(entradaPlano),
          },
          {
            label: '− Saída (venda ou carteira)',
            hint: 'O maior entre a venda projetada e a carteira que vence no mês. Projeção somada sobre os 2.947 SKUs da matriz (a linha Vendas acima mostra só os 1.723 permanentes); de 2027 em diante, ajustada pela razão medida entre as duas populações.',
            values: linha16(saidaVenda),
          },
          {
            label: 'do qual carteira firme',
            hint: 'Pedido já vendido com baixa prevista no mês (dt_prevbaixa, do ERP). Quando passa a venda projetada, é ele que manda na saída.',
            values: linha16(carteiraDoMes),
          },
          {
            label: '= Variação do mês',
            hint: 'Plano que entra menos venda que sai. É o que move o estoque de um mês para o outro.',
            values: linha16(variacao),
          },
        ],
      },
    ];
  }, [data, coberturaPorCurva, modoCobertura, multiplicadorCobertura]);  const Trend = ({ curr, prev }: { curr: number | null; prev: number | null }) => {
    if (curr === null || prev === null || curr === prev) return null;
    return curr > prev
      ? <span className="text-emerald-600 ml-1 text-[10px] align-middle">▲</span>
      : <span className="text-red-600 ml-1 text-[10px] align-middle">▼</span>;
  };

  return <div className="min-h-screen bg-gray-100"><Sidebar onCollapse={setCollapsed} /><main className={`${collapsed ? 'ml-20' : 'ml-64'} p-6 transition-all`}>
    <div className="flex items-start justify-between mb-6"><div><p className="text-xs uppercase tracking-widest text-gray-500">Planejamento agregado</p><h1 className="text-2xl font-bold text-gray-900">Visão Geral 2 (teste)</h1><p className="text-sm text-gray-500 mt-1">Projeção {data?.anoDestino || new Date().getFullYear() + 1}.1 usando permanentes com venda em 6m ou 3m.</p></div><button onClick={carregar} className="flex items-center gap-2 px-3 py-2 bg-white border rounded-lg text-sm text-gray-700 hover:bg-gray-50"><RefreshCw size={16} /> Atualizar</button></div>
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
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Posição atual · {fmt(data.posicao.skus)} SKUs em linha da matriz</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
        {[
          ['Estoque atual', fmt(data.posicao.estoqueAtual), 'text-blue-700', 'Estoque físico em casa hoje'],
          ['Pedidos pendentes', fmt(data.posicao.pedidosPendentes), 'text-amber-700', 'Vendido e ainda não atendido: sai do estoque'],
          ['Disponível', fmt(data.posicao.estoqueAtual - data.posicao.pedidosPendentes), (data.posicao.estoqueAtual - data.posicao.pedidosPendentes) < 0 ? 'text-red-700' : 'text-emerald-700', 'Estoque atual menos pedidos pendentes: o que sobra para venda nova'],
          ['Em processo', fmt(data.posicao.emProcesso), 'text-indigo-700', 'Produzindo agora, ainda não entrou no estoque'],
          ['Estoque + processo', fmt(data.posicao.estoqueDisponivel), 'text-slate-800', 'Coluna estoque_disponivel da matriz: estoque físico + em processo (não abate pendente)'],
        ].map(([label, value, color, hint]) => <div key={label} title={hint} className="bg-white border border-gray-200 rounded-lg px-4 py-3"><div className="text-xs uppercase tracking-wide text-gray-500 truncate">{label}</div><div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div></div>)}
      </div>
      {/* Cards cortados por ja aparecerem em outro lugar desta tela:
          - "Disponivel em dezembro", "Demanda 2027.1" e "Plano previsto 2027.1": a tabela
            abaixo mostra os tres mes a mes;
          - "Ja executado no mes" e "Carga restante do plano (MA)": o painel de capacidade
            diz a mesma coisa em dias, que e a unidade de decisao;
          - "Capacidade diaria media 3M" e "Capacidade restante (mes)": estavam numa escala
            ~18x maior que a medida no ERP.
          Sobram aqui so os dois que nao existem em nenhum outro ponto da tela. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-6 text-sm">
        <span className="text-gray-600">
          Previsão de término do plano (MA):{' '}
          <strong className={data.previsaoTermino ? 'text-red-700' : 'text-emerald-700'}>
            {data.previsaoTermino ? new Date(`${data.previsaoTermino}T00:00:00`).toLocaleDateString('pt-BR') : 'Concluído'}
          </strong>
          <span className="text-gray-400"> · {fmt(data.diasUteisRestantes)} dias úteis no ritmo atual</span>
        </span>
        <span className="text-gray-600">
          Lead time médio de OP: <strong className="text-indigo-700">{fmt(data.leadTimeDias)}d</strong>
        </span>
      </div>
      <PainelCapacidade
        resumo={resumoContinuo}
        periodos={resumoContinuo?.chaves || []}
        variante="amplo"
        titulo={`Capacidade · plano fechado até jan, projetado até dez/${String(data.anoDestino).slice(2)}`}
        nota={`Até jan: plano fechado, mesmos números das telas de Capacidade e Redução. De fev em diante: produção simulada por esta tela pela política de cobertura. Os dois lados usam a mesma capacidade diária medida, então o acumulado corre sem quebra.`}
      />

      <div className="bg-white border border-gray-200 rounded-lg mb-6 overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center gap-2">
          <LayoutGrid size={18} className="text-slate-600" />
          <div>
            <h2 className="font-semibold text-gray-900">Visão Geral</h2>
            <p className="text-xs text-gray-500">Cobre os {fmt(data.skus)} SKUs permanentes da projeção (os cards acima somam os {fmt(data.posicao.skus)} da matriz). As demais linhas do plano de contas entram uma a uma, depois de validadas.</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase">
              <tr>
                <th rowSpan={3} className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-gray-700 w-56 min-w-[14rem]">Indicador</th>
                {SEMESTRES.map((sem) => (
                  <th
                    key={sem.label}
                    colSpan={sem.meses * 2}
                    className={`border-r-2 border-slate-300 bg-slate-100 px-2 py-1 text-center text-[11px] font-bold tracking-wide text-slate-500 last:border-r-0`}
                  >
                    {sem.label}
                  </th>
                ))}
              </tr>
              <tr>
                {MONTH_LABELS.map((m, i) => (
                  <th key={`${m}-${i}`} colSpan={2} className={`px-4 py-2 text-center font-bold ${CORES_MES[i % CORES_MES.length].th} ${fimDeSemestre.has(i) ? 'border-r-2 border-slate-300' : ''}`}>{m}</th>
                ))}
              </tr>
              <tr>
                {MONTH_LABELS.flatMap((_, i) => [
                  <th key={`r-${i}`} className={`px-3 py-2 text-right text-[10px] font-semibold ${i < ULTIMA_COLUNA_REAL ? CORES_MES[i % CORES_MES.length].th : 'text-gray-300'}`}>Real</th>,
                  <th key={`p-${i}`} className={`px-3 py-2 text-right text-[10px] font-semibold ${CORES_MES[i % CORES_MES.length].th} ${fimDeSemestre.has(i) ? 'border-r-2 border-slate-300' : ''} ${i === ULTIMA_COLUNA_REAL - 1 ? 'border-r-4 border-slate-500' : ''}`}>Projetado</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {visaoGeralBlocos.map((bloco) => {
                const aberto = abertos[bloco.id] !== false;
                const celulas = (linha: VisaoGeralLinha, destaque: boolean) => {
                  // As linhas são montadas como [projetado, real] por mês; a tabela mostra
                  // Real primeiro. Inverter aqui evita mexer em cada array e correr o risco
                  // de desalinhar um deles em silêncio.
                  const vals = linha.values.map((_, i) => linha.values[i % 2 === 0 ? i + 1 : i - 1] ?? null);
                  return vals.map((v, i) => {
                    const perigo = linha.dangerBelow !== undefined && v !== null && v < linha.dangerBelow;
                    const texto = v === null ? '—' : linha.decimals !== undefined ? `${v.toFixed(linha.decimals)}${linha.suffix || ''}` : fmt(v);
                    // A borda de semestre/real-projetado só faz sentido na 2ª coluna do par
                    // (Projetado): é ali que a dupla do mês termina e a próxima começa.
                    const mesIdx = Math.floor(i / 2);
                    const divisor = i % 2 === 1 && mesIdx === ULTIMA_COLUNA_REAL - 1
                      ? 'border-r-4 border-slate-500'
                      : i % 2 === 1 && fimDeSemestre.has(mesIdx)
                        ? 'border-r-2 border-slate-300'
                        : '';
                    return (
                      <td key={i} className={`px-4 py-3 text-right font-mono ${destaque ? '' : CORES_MES[Math.floor(i / 2) % CORES_MES.length].td} ${perigo ? 'text-red-600 font-semibold' : destaque ? 'font-semibold text-gray-900' : 'text-gray-900'} ${divisor}`}>
                        {texto}
                        {i > 0 && <Trend curr={v} prev={vals[i - 1]} />}
                      </td>
                    );
                  });
                };
                const temFilhos = bloco.filhos.length > 0;
                return (
                  <Fragment key={bloco.id}>
                    <tr
                      className={`border-t select-none ${temFilhos ? 'cursor-pointer hover:brightness-95' : ''} ${bloco.rowClass}`}
                      onClick={temFilhos ? () => setAbertos((prev) => ({ ...prev, [bloco.id]: !aberto })) : undefined}
                    >
                      <td title={bloco.hint} className={`sticky left-0 z-10 w-56 min-w-[14rem] whitespace-nowrap px-4 py-3 font-semibold text-gray-900 ${bloco.rowClass}`}>
                        <span className="inline-flex items-center gap-1.5">
                          {temFilhos
                            ? (aberto ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />)
                            : <span className="inline-block w-3.5" />}
                          {bloco.label}
                        </span>
                      </td>
                      {celulas(bloco, true)}
                    </tr>
                    {aberto && bloco.filhos.map((filho) => (
                      <tr key={filho.label} className="border-t border-gray-100">
                        <td title={filho.hint} className="sticky left-0 z-10 w-56 min-w-[14rem] whitespace-nowrap bg-white px-4 py-2 pl-11 text-[13px] font-medium text-gray-900">{filho.label}</td>
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
