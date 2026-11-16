/**
 * Operação Integrada: a carteira de pedidos como demanda central, confrontada
 * por SKU contra as fontes de oferta (estoque, produção em andamento, plano
 * MA/PX, UL, fora do horizonte GEO) — NÃO uma comparação de totais.
 *
 * Decisões de escopo (explícitas, para não presumir):
 * - Carteira elegível: cd_empresa=1, cd_operacao<>44 (exclui transferência),
 *   tp_situacao<>6 (exclui cancelado), qt_pendente>0. Mesmo filtro que
 *   producaoService.buscarPedidosPendentes já usa para o agregado oficial da
 *   matriz — carteira aqui bate com "pedidos_pendentes" de lá, por construção.
 * - "Hoje": CURRENT_DATE do banco. Não há parâmetro de data de corte nesta
 *   entrega — é sempre a foto atual.
 * - Estoque/produção: f_dic_sld_prd_produto e vr_pcp_opi/opc, mesma função que
 *   o resto do app usa — não reimplementei regra de depósito.
 * - Pedido sem cd_lote (1.954 linhas / 8.205 peças medido em 2026-11-13) entra
 *   num grupo explícito "(sem lote)", nunca é descartado.
 * - Fora do horizonte GEO = baldes do plano a partir de QT (QT..QZ) — mv_geo3
 *   só soma MA/MG/PX (60d) e UL (90d), nada além disso.
 * - NÃO existe cálculo de cobertura/alocação nesta entrega (Entrega 2). Os
 *   números aqui são oferta e demanda BRUTAS, lado a lado — nunca combinadas
 *   num "% atendido".
 *
 * Fonte de oferta (estoque/produção/plano por SKU): lê o MESMO cache que
 * /api/producao/matriz usa (app_cache, chave matriz_planejamento), sem
 * recalcular — evita rodar a consulta pesada da matriz (medida em >90s a
 * frio) numa tela que o PCP vai abrir o dia inteiro. Se o cache não existir
 * ainda, isso é reportado como limitação, não escondido.
 */

const { readCache, readCacheByKey, writeCacheByKey, filterCache } = require("../cache/matrizCache");
const { PERIODOS_PLANO } = require("./periodoPlanoService");
const { parseLote } = require("./alocacaoPedidosService");
const { buscarQuantidadeMvGeo3PorSku } = require("./disponibilidadeVendaService");

const PERIODOS_HORIZONTE_GEO = ["ma", "px", "ul"];
const PERIODOS_FORA_HORIZONTE = PERIODOS_PLANO.map((p) => p.toLowerCase()).filter((p) => !PERIODOS_HORIZONTE_GEO.includes(p));

const CARTEIRA_CACHE_KEY = "carteira_sku_lote";
const CARTEIRA_CACHE_TTL_MS = 15 * 60 * 1000; // carteira muda mais rápido que o plano

/**
 * Carteira elegível, agrupada por SKU x lote (não por pedido individual —
 * isso fica para buscarPedidosDoLote). Uma linha por combinação.
 */
async function buscarCarteiraAgrupadaBruta(pool, cdEmpresa = 1) {
  const { rows } = await pool.query(
    `SELECT
       p.cd_produto::TEXT AS idproduto,
       COALESCE(TRIM(p.cd_lote), '') AS cd_lote,
       SUM(p.qt_pendente)::FLOAT AS qtd_pendente
     FROM vr_ped_pedidoi p
     WHERE p.cd_empresa = $1
       AND p.cd_operacao <> 44
       AND p.tp_situacao <> 6
       AND p.qt_pendente > 0
     GROUP BY p.cd_produto, COALESCE(TRIM(p.cd_lote), '')`,
    [cdEmpresa]
  );
  return rows;
}

/**
 * Contagem REAL de pedidos distintos por lote (um pedido com vários SKUs no
 * mesmo lote conta uma vez só) e o total geral — não dá para derivar isso da
 * query agrupada por sku+lote acima sem contar o mesmo pedido mais de uma vez.
 */
async function buscarContagemPedidosPorLote(pool, cdEmpresa = 1) {
  const { rows } = await pool.query(
    `SELECT COALESCE(TRIM(p.cd_lote), '') AS cd_lote, COUNT(DISTINCT p.cd_pedido)::INT AS pedidos
     FROM vr_ped_pedidoi p
     WHERE p.cd_empresa = $1
       AND p.cd_operacao <> 44
       AND p.tp_situacao <> 6
       AND p.qt_pendente > 0
     GROUP BY COALESCE(TRIM(p.cd_lote), '')`,
    [cdEmpresa]
  );
  const porLote = new Map(rows.map((r) => [r.cd_lote, r.pedidos]));
  const totalResult = await pool.query(
    `SELECT COUNT(DISTINCT p.cd_pedido)::INT AS pedidos
     FROM vr_ped_pedidoi p
     WHERE p.cd_empresa = $1
       AND p.cd_operacao <> 44
       AND p.tp_situacao <> 6
       AND p.qt_pendente > 0`,
    [cdEmpresa]
  );
  return { porLote, total: totalResult.rows[0]?.pedidos || 0 };
}

async function buscarCarteiraAgrupada(pool, { cdEmpresa = 1, forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = await readCacheByKey(CARTEIRA_CACHE_KEY);
    if (cached && Date.now() - cached.timestamp < CARTEIRA_CACHE_TTL_MS) {
      const payload = cached.data;
      return {
        linhas: payload.linhas,
        pedidosPorLote: new Map(payload.pedidosPorLote),
        pedidosTotal: payload.pedidosTotal,
        cacheTimestamp: cached.timestamp,
        fromCache: true,
      };
    }
  }
  const [linhas, contagem] = [
    await buscarCarteiraAgrupadaBruta(pool, cdEmpresa),
    await buscarContagemPedidosPorLote(pool, cdEmpresa),
  ];
  const payload = {
    linhas,
    pedidosPorLote: [...contagem.porLote.entries()],
    pedidosTotal: contagem.total,
  };
  await writeCacheByKey(CARTEIRA_CACHE_KEY, payload, { cdEmpresa });
  return { linhas, pedidosPorLote: contagem.porLote, pedidosTotal: contagem.total, cacheTimestamp: Date.now(), fromCache: false };
}

/**
 * Oferta por SKU, lida do cache da matriz oficial (não recalculada aqui).
 * Retorna null se o cache ainda não existir — quem chama decide como avisar.
 */
async function buscarOfertaDoCacheMatriz() {
  const cached = await readCache();
  if (!cached) return null;
  // O payload cacheado pode vir como array puro ou como { rows: [...] } —
  // mesma ambiguidade que /api/producao/matriz já trata na leitura do cache.
  const payload = cached.data;
  const linhasCache = Array.isArray(payload) ? payload : Array.isArray(payload?.rows) ? payload.rows : null;
  if (!linhasCache) return null;
  const linhasFiltradas = filterCache(linhasCache, {});

  const porSku = new Map();
  for (const row of linhasFiltradas) {
    const id = String(row?.produto?.idproduto || "");
    if (!id) continue;
    const estoqueAtual = Number(row?.estoques?.estoque_atual || 0);
    const emProcesso = Number(row?.estoques?.em_processo || 0);
    const plano = row?.plano || {};
    let planoMaPx = 0;
    let planoUl = 0;
    let planoForaHorizonte = 0;
    for (const per of PERIODOS_HORIZONTE_GEO) {
      const v = Number(plano[per] || 0);
      if (per === "ul") planoUl += v;
      else planoMaPx += v;
    }
    for (const per of PERIODOS_FORA_HORIZONTE) planoForaHorizonte += Number(plano[per] || 0);
    porSku.set(id, { estoqueAtual, emProcesso, planoMaPx, planoUl, planoForaHorizonte });
  }
  return { porSku, timestamp: cached.timestamp, ageHours: cached.ageHours, fresh: cached.fresh };
}

/**
 * Disponibilidade comercial (mv_geo3) para um conjunto de SKUs, reduzida a um
 * total por SKU (a view tem até 3 linhas por SKU — 30/60/90d — cumulativas
 * por construção; usamos a de maior quantidade, que corresponde à mais
 * distante). Só para reconciliação/exibição lado a lado — nunca somada à
 * oferta bruta (ela já é líquida de pedidos pendentes).
 */
async function buscarDisponibilidadeComercialPorSku(pool, idprodutos) {
  if (!idprodutos.length) return { porSku: new Map(), total: 0, skus: 0 };
  const linhas = await buscarQuantidadeMvGeo3PorSku(pool, idprodutos);
  const porSku = new Map();
  for (const row of linhas) {
    const id = String(row.codigoproduto);
    const qtd = Number(row.quantidade || 0);
    const atual = porSku.get(id) || 0;
    if (qtd > atual) porSku.set(id, qtd);
  }
  let total = 0;
  for (const v of porSku.values()) total += v;
  return { porSku, total, skus: porSku.size };
}

/**
 * Visão macro: totais da carteira elegível confrontados, SKU a SKU, contra a
 * oferta bruta — nunca uma divisão de totais agregados.
 */
async function montarMacro(pool, { cdEmpresa = 1 } = {}) {
  const [{ linhas: carteira, pedidosTotal, cacheTimestamp: carteiraTimestamp }, oferta] = [
    await buscarCarteiraAgrupada(pool, { cdEmpresa }),
    await buscarOfertaDoCacheMatriz(),
  ];

  const porSkuDemanda = new Map();
  for (const linha of carteira) {
    const atual = porSkuDemanda.get(linha.idproduto) || 0;
    porSkuDemanda.set(linha.idproduto, atual + Number(linha.qtd_pendente || 0));
  }

  let carteiraPendente = 0;
  let estoqueDisponivel = 0;
  let producaoEmAndamento = 0;
  let planoMaPx = 0;
  let planoUl = 0;
  let planoForaHorizonte = 0;
  let skusSemOferta = 0;
  let pecasSemOferta = 0;

  for (const [idproduto, qtd] of porSkuDemanda) {
    carteiraPendente += qtd;
    const dadosOferta = oferta?.porSku.get(idproduto);
    if (!dadosOferta) {
      skusSemOferta += 1;
      pecasSemOferta += qtd;
      continue;
    }
    estoqueDisponivel += dadosOferta.estoqueAtual;
    producaoEmAndamento += dadosOferta.emProcesso;
    planoMaPx += dadosOferta.planoMaPx;
    planoUl += dadosOferta.planoUl;
    planoForaHorizonte += dadosOferta.planoForaHorizonte;
  }

  const skusCarteira = [...porSkuDemanda.keys()];
  const disponibilidadeComercial = await buscarDisponibilidadeComercialPorSku(pool, skusCarteira);

  return {
    referencia: { cdEmpresa, calculadoEm: Date.now() },
    carteira: {
      pecasPendentes: carteiraPendente,
      skus: skusCarteira.length,
      pedidos: pedidosTotal,
    },
    oferta: {
      estoqueDisponivel,
      producaoEmAndamento,
      planoMaPx,
      planoUl,
      planoForaHorizonte,
      fonte: oferta
        ? { cacheTimestamp: oferta.timestamp, ageHours: Number(oferta.ageHours.toFixed(1)), fresh: oferta.fresh }
        : null,
    },
    disponibilidadeComercial: {
      pecas: disponibilidadeComercial.total,
      skus: disponibilidadeComercial.skus,
      nota: "mv_geo3: já líquida de pedidos pendentes. Não some com 'oferta' acima — é um número de reconciliação, não um insumo bruto.",
    },
    limitacoes: {
      cacheMatrizIndisponivel: !oferta,
      skusCarteiraSemDadoDeOferta: skusSemOferta,
      pecasCarteiraSemDadoDeOferta: pecasSemOferta,
    },
    atendimentoPrevisto: null, // calculado na Entrega 2 (motor de alocação SKU a SKU); nunca estimar por divisão de totais aqui.
    carteiraCacheTimestamp: carteiraTimestamp,
  };
}

/**
 * Visão por lote comercial: agrupa a carteira (já agrupada por sku+lote) por
 * cd_lote, somando entre SKUs. Ordenação default = cronológica por cd_lote
 * (neutra — NÃO é a prioridade oficial, que ainda não foi validada com o
 * usuário). nr_prioridade aparece como dado bruto, não usado para ordenar.
 */
async function montarLotes(pool, { cdEmpresa = 1 } = {}) {
  const [{ linhas: carteira, pedidosPorLote }, oferta] = [
    await buscarCarteiraAgrupada(pool, { cdEmpresa }),
    await buscarOfertaDoCacheMatriz(),
  ];

  const porLote = new Map();
  for (const linha of carteira) {
    const chave = linha.cd_lote || "(sem lote)";
    if (!porLote.has(chave)) {
      porLote.set(chave, {
        cdLote: chave,
        semLote: !linha.cd_lote,
        formatoReconhecido: linha.cd_lote ? parseLote(linha.cd_lote) !== null : null,
        skus: new Set(),
        pedidos: pedidosPorLote.get(linha.cd_lote) || 0,
        pecasPendentes: 0,
        estoqueDisponivel: 0,
        producaoEmAndamento: 0,
        planoMaPx: 0,
        planoUl: 0,
        planoForaHorizonte: 0,
        skusSemOferta: 0,
      });
    }
    const grupo = porLote.get(chave);
    grupo.skus.add(linha.idproduto);
    grupo.pecasPendentes += Number(linha.qtd_pendente || 0);
    const dadosOferta = oferta?.porSku.get(linha.idproduto);
    if (dadosOferta) {
      grupo.estoqueDisponivel += dadosOferta.estoqueAtual;
      grupo.producaoEmAndamento += dadosOferta.emProcesso;
      grupo.planoMaPx += dadosOferta.planoMaPx;
      grupo.planoUl += dadosOferta.planoUl;
      grupo.planoForaHorizonte += dadosOferta.planoForaHorizonte;
    } else {
      grupo.skusSemOferta += 1;
    }
  }

  const lotes = [...porLote.values()]
    .map((g) => ({ ...g, skus: g.skus.size }))
    .sort((a, b) => {
      const chaveA = a.semLote ? null : parseLote(a.cdLote);
      const chaveB = b.semLote ? null : parseLote(b.cdLote);
      if (chaveA === null && chaveB === null) return a.cdLote.localeCompare(b.cdLote);
      if (chaveA === null) return 1;
      if (chaveB === null) return -1;
      return chaveA - chaveB;
    });

  return {
    lotes,
    ofertaFonte: oferta ? { cacheTimestamp: oferta.timestamp, ageHours: Number(oferta.ageHours.toFixed(1)) } : null,
    criterioOrdenacao: "cronologico_cd_lote",
    avisoPrioridade: "nr_prioridade existe no ERP mas sua direção/uso não foi validado — não usado para ordenar esta lista.",
  };
}

/**
 * Pedidos de um lote comercial específico, com seus itens — nível 3 de
 * detalhamento (clicar no lote). Prioridade exibida como veio do ERP, sem
 * interpretação.
 */
async function buscarPedidosDoLote(pool, cdLote, { cdEmpresa = 1 } = {}) {
  const semLote = !cdLote || cdLote === "(sem lote)";
  const { rows } = await pool.query(
    `SELECT
       p.cd_pedido::TEXT AS cd_pedido,
       p.cd_cliente::TEXT AS cd_cliente,
       COALESCE(TRIM(p.cd_lote), '') AS cd_lote,
       c.nr_prioridade::INT AS nr_prioridade,
       c.dt_pedido AS dt_pedido,
       c.tp_situacao::INT AS tp_situacao,
       p.cd_produto::TEXT AS cd_produto,
       p.qt_pendente::FLOAT AS qt_pendente,
       p.qt_solicitada::FLOAT AS qt_solicitada,
       p.qt_atendida::FLOAT AS qt_atendida,
       p.dt_prevbaixa AS dt_prevbaixa
     FROM vr_ped_pedidoi p
     LEFT JOIN vr_ped_pedidoc2 c ON c.cd_empresa = p.cd_empresa AND c.cd_pedido = p.cd_pedido
     WHERE p.cd_empresa = $1
       AND p.cd_operacao <> 44
       AND p.tp_situacao <> 6
       AND p.qt_pendente > 0
       AND ${semLote ? "(p.cd_lote IS NULL OR TRIM(p.cd_lote) = '')" : "TRIM(p.cd_lote) = $2"}
     ORDER BY p.cd_pedido, p.cd_produto`,
    semLote ? [cdEmpresa] : [cdEmpresa, cdLote]
  );

  const porPedido = new Map();
  for (const row of rows) {
    if (!porPedido.has(row.cd_pedido)) {
      porPedido.set(row.cd_pedido, {
        cdPedido: row.cd_pedido,
        cdCliente: row.cd_cliente,
        cdLote: row.cd_lote,
        nrPrioridade: row.nr_prioridade,
        dtPedido: row.dt_pedido,
        tpSituacao: row.tp_situacao,
        itens: [],
      });
    }
    porPedido.get(row.cd_pedido).itens.push({
      cdProduto: row.cd_produto,
      qtPendente: row.qt_pendente,
      qtSolicitada: row.qt_solicitada,
      qtAtendida: row.qt_atendida,
      dtPrevbaixa: row.dt_prevbaixa,
    });
  }

  return [...porPedido.values()];
}

module.exports = {
  montarMacro,
  montarLotes,
  buscarPedidosDoLote,
  buscarCarteiraAgrupada,
  buscarOfertaDoCacheMatriz,
};
