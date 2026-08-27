const express = require("express");
const {
  buscarEstoqueFabrica,
  buscarProdutosEmProcesso,
  buscarPedidosPendentes,
  buscarCatalogoProdutos,
  buscarPlanejamentoProduto,
  buscarMatrizPlanejamentoRapida,
  buscarEmProcessoPorLocal,
  buscarProducaoPorLocalCompleta,
  buscarLocaisProducao,
  buscarExecucaoPlanoResumo
} = require("../services/producaoService");

const { readCache, filterCache } = require("../cache/matrizCache");

const router = express.Router();
const catalogoCache = new Map();
const CATALOGO_CACHE_TTL_MS = (Number(process.env.CATALOGO_CACHE_TTL_SECONDS) || 600) * 1000;
const ORCAMENTO_MP_CACHE_KEY = "orcamento_mp_liebe";

async function ensureOrcamentoMpCacheTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.app_orcamento_mp_cache (
      cache_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function buildCatalogoCacheKey(query) {
  const entries = Object.entries(query || {})
    .map(([k, v]) => [k, String(v)])
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}=${v}`).join("&");
}

/**
 * GET /api/producao/estoque
 * Retorna estoque atual de produtos na fábrica
 *
 * Query params:
 * - limit: número máximo de registros (padrão: 100, máximo: 500)
 * - offset: deslocamento para paginação
 * - cd_produto: filtrar por código do produto
 * - cd_empresa: código da empresa (padrão: 1)
 * - apenas_com_estoque: retornar apenas produtos com estoque > 0 (true/false)
 */
router.get("/estoque", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const cdProduto = req.query.cd_produto ? Number(req.query.cd_produto) : null;
    const cdEmpresa = req.query.cd_empresa || '1';
    const apenasComEstoque = req.query.apenas_com_estoque === 'true';

    const estoque = await buscarEstoqueFabrica(pool, {
      limit,
      offset,
      cdProduto,
      cdEmpresa,
      apenasComEstoque
    });

    return res.status(200).json({
      success: true,
      total: estoque.length,
      limit,
      offset,
      data: estoque
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar estoque",
      details: error.message
    });
  }
});

/**
 * GET /api/producao/em-processo
 * Retorna produtos em processo de produção
 *
 * Query params:
 * - limit: número máximo de registros (padrão: 100, máximo: 500)
 * - offset: deslocamento para paginação
 * - cd_produto: filtrar por código do produto
 * - cd_empresa: código da empresa (padrão: 1)
 */
router.get("/em-processo", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const cdProduto = req.query.cd_produto ? Number(req.query.cd_produto) : null;
    const cdEmpresa = Number(req.query.cd_empresa) || 1;

    const emProcesso = await buscarProdutosEmProcesso(pool, {
      limit,
      offset,
      cdProduto,
      cdEmpresa
    });

    return res.status(200).json({
      success: true,
      total: emProcesso.length,
      limit,
      offset,
      data: emProcesso
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar produtos em processo",
      details: error.message
    });
  }
});

/**
 * GET /api/producao/pedidos-pendentes/:cdProduto
 * Retorna pedidos pendentes de um produto específico
 *
 * Query params:
 * - cd_empresa: código da empresa (padrão: 1)
 */
router.get("/pedidos-pendentes/:cdProduto", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const cdProduto = Number(req.params.cdProduto);
    const cdEmpresa = Number(req.query.cd_empresa) || 1;

    if (isNaN(cdProduto)) {
      return res.status(400).json({
        success: false,
        error: "Código do produto inválido"
      });
    }

    const qtPendente = await buscarPedidosPendentes(pool, cdProduto, cdEmpresa);

    return res.status(200).json({
      success: true,
      data: {
        cd_produto: cdProduto,
        cd_empresa: cdEmpresa,
        qt_pendente: qtPendente
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar pedidos pendentes",
      details: error.message
    });
  }
});

/**
 * GET /api/producao/catalogo
 * Retorna catálogo de produtos
 *
 * Query params:
 * - limit: número máximo de registros (padrão: 100, máximo: 500)
 * - offset: deslocamento para paginação
 * - cd_produto: filtrar por código do produto
 * - idfamilia: filtrar por família
 * - status: filtrar por status
 * - continuidade: filtrar por continuidade
 */
router.get("/catalogo", async (req, res) => {
  try {
    const forceRefresh = req.query.no_cache === "true";
    const cacheKey = buildCatalogoCacheKey(req.query);
    const now = Date.now();

    if (!forceRefresh) {
      const cached = catalogoCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        res.set("X-Cache", "HIT");
        return res.status(200).json(cached.payload);
      }
    }

    const pool = req.app.get("pool");
    const campos = req.query.campos === "minimos" ? "minimos" : "completo";
    const maxLimit = campos === "minimos" ? 2000 : 500;
    const limit = Math.min(Number(req.query.limit) || 100, maxLimit);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const cdProduto = req.query.cd_produto ? Number(req.query.cd_produto) : null;
    const idFamilia = req.query.idfamilia || null;
    const status = req.query.status || null;
    const continuidade = req.query.continuidade || null;
    const referencias = req.query.referencias
      ? String(req.query.referencias)
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean)
      : [];

    const catalogo = await buscarCatalogoProdutos(pool, {
      limit,
      offset,
      cdProduto,
      idFamilia,
      status,
      continuidade,
      campos,
      referencias
    });

    const payload = {
      success: true,
      total: catalogo.length,
      limit,
      offset,
      data: catalogo
    };

    catalogoCache.set(cacheKey, {
      payload,
      expiresAt: now + CATALOGO_CACHE_TTL_MS
    });

    res.set("X-Cache", "MISS");
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar catálogo",
      details: error.message
    });
  }
});

/**
 * GET /api/producao/planejamento/:cdProduto
 * Retorna planejamento completo de produção para um produto
 * Combina: estoque, vendas, pedidos pendentes, em processo, estoque mínimo
 *
 * Query params:
 * - cd_empresa: código da empresa (padrão: 1)
 */
router.get("/planejamento/:cdProduto", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const cdProduto = Number(req.params.cdProduto);
    const cdEmpresa = Number(req.query.cd_empresa) || 1;

    if (isNaN(cdProduto)) {
      return res.status(400).json({
        success: false,
        error: "Código do produto inválido"
      });
    }

    const planejamento = await buscarPlanejamentoProduto(pool, cdProduto, cdEmpresa);

    if (!planejamento) {
      return res.status(404).json({
        success: false,
        error: "Produto não encontrado"
      });
    }

    return res.status(200).json({
      success: true,
      data: planejamento
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar planejamento de produção",
      details: error.message
    });
  }
});

/**
 * GET /api/producao/planejamento
 * Retorna planejamento de produção para múltiplos produtos
 *
 * Query params:
 * - limit: número máximo de produtos (padrão: 50, máximo: 200)
 * - offset: deslocamento para paginação
 * - cd_empresa: código da empresa (padrão: 1)
 * - apenas_necessidade: retornar apenas produtos que precisam produzir (true/false)
 * - ordenar_por: prioridade | necessidade | produto (padrão: prioridade)
 */
router.get("/planejamento", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const cdEmpresa = Number(req.query.cd_empresa) || 1;
    const apenasNecessidade = req.query.apenas_necessidade === 'true';
    const ordenarPor = req.query.ordenar_por || 'prioridade';

    // Buscar produtos do catálogo
    const catalogo = await buscarCatalogoProdutos(pool, {
      limit: limit * 2, // Buscar mais para filtrar depois
      offset
    });

    // Buscar planejamento para cada produto
    const planejamentos = [];

    for (const produto of catalogo) {
      try {
        const planejamento = await buscarPlanejamentoProduto(
          pool,
          produto.idproduto,
          cdEmpresa
        );

        if (planejamento) {
          // Filtrar apenas produtos com necessidade de produção se solicitado
          if (!apenasNecessidade || planejamento.planejamento.necessidade_producao > 0) {
            planejamentos.push(planejamento);
          }
        }
      } catch (error) {
        console.log(`Erro ao processar produto ${produto.idproduto}:`, error.message);
      }

      // Limitar ao número solicitado
      if (planejamentos.length >= limit) {
        break;
      }
    }

    // Ordenar resultados
    if (ordenarPor === 'prioridade') {
      const prioridadeOrdem = { ALTA: 1, MEDIA: 2, BAIXA: 3 };
      planejamentos.sort((a, b) => {
        const prioA = prioridadeOrdem[a.planejamento.prioridade] || 999;
        const prioB = prioridadeOrdem[b.planejamento.prioridade] || 999;
        return prioA - prioB;
      });
    } else if (ordenarPor === 'necessidade') {
      planejamentos.sort((a, b) =>
        b.planejamento.necessidade_producao - a.planejamento.necessidade_producao
      );
    } else if (ordenarPor === 'produto') {
      planejamentos.sort((a, b) =>
        a.produto.idproduto - b.produto.idproduto
      );
    }

    return res.status(200).json({
      success: true,
      total: planejamentos.length,
      limit,
      offset,
      filtros: {
        apenas_necessidade: apenasNecessidade,
        ordenar_por: ordenarPor
      },
      data: planejamentos
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar planejamento de produção",
      details: error.message
    });
  }
});

/**
 * GET /api/producao/matriz
 * Matriz de planejamento em query única (CTE agregada, sem N+1).
 *
 * Query params:
 * - limit: máximo de produtos (padrão: 200, máximo: 1000)
 * - offset: paginação
 * - cd_empresa: código da empresa (padrão: 1)
 * - marca: filtrar por marca (ex: "Liebe") — usa classificação 20 DS
 * - status: filtrar por status (ex: "EM LINHA")
 */
router.get("/matriz", async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query.limit)  || 500, 5000);
    const offset = Math.max(Number(req.query.offset) || 0,   0);
    const marca  = req.query.marca ? String(req.query.marca).trim() : null;
    const status = req.query.status ? String(req.query.status).trim() : null;
    const preferCache = req.query.prefer_cache === "true";
    const noCache = req.query.no_cache === "true";
    const referencias = req.query.referencias
      ? String(req.query.referencias).split(',').map((r) => r.trim()).filter(Boolean)
      : [];

    // ── tenta servir do cache ───────────────────────────────────────────────
    const cached = await readCache();
    const cacheMarca = cached?.meta?.marca ? String(cached.meta.marca).trim().toUpperCase() : null;
    const cacheStatus = cached?.meta?.status ? String(cached.meta.status).trim().toUpperCase() : null;
    const reqMarca   = marca ? marca.toUpperCase() : null;
    const reqStatus  = status ? status.toUpperCase() : null;
    const parseStatusSet = (value) =>
      new Set(
        String(value || '')
          .split(',')
          .map((s) => String(s || '').trim().toUpperCase())
          .filter(Boolean)
      );
    const cacheAtendeMarca =
      !cached
        ? false
        : (
            // cache global (sem marca) atende qualquer filtro de marca
            !cacheMarca ||
            // cache por marca só atende mesma marca
            cacheMarca === reqMarca
          );
    const cacheAtendeStatus =
      !cached
        ? false
        : (
            // cache global (sem status) atende qualquer filtro de status
            !cacheStatus ||
            // request sem status aceita qualquer cache por status
            !reqStatus ||
            // cache por status atende mesmo status ou subconjunto do request
            (() => {
              const cacheSet = parseStatusSet(cacheStatus);
              const reqSet = parseStatusSet(reqStatus);
              if (!cacheSet.size || !reqSet.size) return false;
              for (const st of reqSet) {
                if (!cacheSet.has(st)) return false;
              }
              return true;
            })()
          );

    const cachePayload = cached?.data;
    const cacheRows = Array.isArray(cachePayload)
      ? cachePayload
      : Array.isArray(cachePayload?.rows)
        ? cachePayload.rows
        : [];
    const cacheExecucaoPlanoResumo = !Array.isArray(cachePayload) && cachePayload?.execucaoPlanoResumo
      ? cachePayload.execucaoPlanoResumo
      : null;

    if (!noCache && cached && (cached.fresh || preferCache) && cacheAtendeMarca && cacheAtendeStatus) {
      const filtrado = filterCache(cacheRows, { referencias, marca, status });
      const pagina   = filtrado.slice(offset, offset + limit);

      res.set('X-Cache', cached.fresh ? 'HIT' : 'STALE');
      res.set('X-Cache-Age', String(cached.ageHours.toFixed(1)) + 'h');
      return res.status(200).json({
        success: true,
        total:   pagina.length,
        totalAll: filtrado.length,
        fromCache: true,
        cacheUpdatedAt: new Date(cached.timestamp).toLocaleString('pt-BR'),
        limit,
        offset,
        data: pagina,
        execucaoPlanoResumo: cacheExecucaoPlanoResumo
      });
    }

    // ── fallback: consulta direta ao banco ──────────────────────────────────
    const pool      = req.app.get("pool");
    const cdEmpresa = Number(req.query.cd_empresa) || 1;

    const resultados = await buscarMatrizPlanejamentoRapida(pool, {
      limit,
      offset,
      cdEmpresa,
      marca,
      status,
      referencias
    });
    const execucaoPlanoResumo = await buscarExecucaoPlanoResumo(pool, {
      cdEmpresa,
      marca: marca || 'LIEBE',
      status: status || 'EM LINHA',
    });

    res.set('X-Cache', 'MISS');
    return res.status(200).json({
      success: true,
      total:   resultados.length,
      fromCache: false,
      limit,
      offset,
      data: resultados,
      execucaoPlanoResumo
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar matriz"
    });
  }
});

router.get("/plano-execucao-resumo", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const cdEmpresa = Number(req.query.cd_empresa) || 1;
    const marca = String(req.query.marca || 'LIEBE');
    const status = String(req.query.status || 'EM LINHA');

    const data = await buscarExecucaoPlanoResumo(pool, {
      cdEmpresa,
      marca,
      status,
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar execucao do plano"
    });
  }
});

router.post("/plano-original", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const productIds = Array.isArray(req.body?.productIds)
      ? [...new Set(req.body.productIds.map((id) => String(id || "").trim()).filter(Boolean))]
      : [];

    if (!productIds.length) {
      return res.status(200).json({ success: true, data: {} });
    }

    const result = await pool.query(`
      SELECT
        a.cd_produto::TEXT AS idproduto,
        UPPER(TRIM(COALESCE(p.cd_auxiliar, ''))) AS periodo,
        COALESCE(SUM(COALESCE(a.qt_lote, 0)), 0)::FLOAT AS plano_original
      FROM vr_pcp_lotepl2 a
      LEFT JOIN pcp_lotepv p ON a.nr_lote = p.nr_lote
      WHERE p.tp_situacao = 1
        AND p.cd_auxiliar IN ('MA', 'PX', 'UL', 'QT', 'QU')
        AND a.cd_produto::TEXT = ANY($1::TEXT[])
      GROUP BY a.cd_produto, p.cd_auxiliar
    `, [productIds]);

    const data = {};
    for (const id of productIds) {
      data[id] = { ma: 0, px: 0, ul: 0, qt: 0, qu: 0 };
    }
    for (const row of result.rows) {
      const id = String(row.idproduto || "");
      const periodo = String(row.periodo || "").toLowerCase();
      if (!data[id] || !["ma", "px", "ul", "qt", "qu"].includes(periodo)) continue;
      data[id][periodo] = Number(row.plano_original || 0);
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar plano original",
      details: error.message
    });
  }
});

/**
 * GET /api/producao/percentual-finalizado
 * Retorna qtd_lote, qtd_finalizada e qtd_gerouop por periodo
 * Filtrado por marca LIEBE e status EM LINHA/NOVA COLECAO
 * OTIMIZADO: Usa CTE para pré-filtrar produtos (evita f_dic_prd_classificacao no WHERE)
 */
router.get("/percentual-finalizado", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const marca = String(req.query.marca || "LIEBE").trim().toUpperCase();
    const statusList = String(req.query.status || "EM LINHA,NOVA COLECAO")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    // Otimizado: pré-filtrar produtos em uma CTE para evitar chamadas lentas no WHERE
    const result = await pool.query(`
      WITH produtos_filtrados AS (
        SELECT cd_produto
        FROM vr_prd_prdgrade
        WHERE UPPER(TRIM(COALESCE(f_dic_prd_classificacao(cd_produto, 'DS'::text, 20::bigint), ''))) = $1
          AND UPPER(TRIM(COALESCE(f_dic_prd_classificacao(cd_produto, 'DS'::text, 27::bigint), ''))) = ANY($2)
      )
      SELECT
        UPPER(TRIM(COALESCE(p.cd_auxiliar, ''))) AS periodo,
        SUM(COALESCE(a.qt_lote, 0))::FLOAT AS qtd_lote,
        SUM(COALESCE(a.qt_finalizada, 0))::FLOAT AS qtd_finalizada,
        SUM(COALESCE(a.qt_gerouop, 0))::FLOAT AS qtd_gerouop
      FROM vr_pcp_lotepl2 a
      INNER JOIN produtos_filtrados pf ON pf.cd_produto = a.cd_produto
      LEFT JOIN pcp_lotepv p ON a.nr_lote = p.nr_lote
      WHERE p.cd_auxiliar IN ('MA', 'PX', 'UL', 'QT', 'QU')
        AND p.tp_situacao = 1
      GROUP BY p.cd_auxiliar
    `, [marca, statusList]);

    const data = { MA: null, PX: null, UL: null, QT: null, QU: null };
    for (const row of result.rows) {
      const periodo = String(row.periodo || "").toUpperCase();
      if (!["MA", "PX", "UL", "QT", "QU"].includes(periodo)) continue;
      const qtdLote = Number(row.qtd_lote || 0);
      const qtdFinalizada = Number(row.qtd_finalizada || 0);
      const qtdGerouOp = Number(row.qtd_gerouop || 0);
      const percentual = qtdLote > 0 ? (qtdFinalizada / qtdLote) * 100 : 0;
      const percentualGerouOp = qtdLote > 0 ? (qtdGerouOp / qtdLote) * 100 : 0;
      data[periodo] = {
        qtdLote: Math.round(qtdLote),
        qtdFinalizada: Math.round(qtdFinalizada),
        qtdGerouOp: Math.round(qtdGerouOp),
        percentual: Math.round(percentual * 10) / 10, // 1 casa decimal
        percentualGerouOp: Math.round(percentualGerouOp * 10) / 10, // 1 casa decimal
      };
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar percentual finalizado",
      details: error.message
    });
  }
});

/**
 * GET /api/producao/consumo-mp-lotes
 * Calcula o consumo de MP baseado nos lotes reais (qt_lote), não na matriz
 */
router.get("/consumo-mp-lotes", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const marca = String(req.query.marca || "LIEBE").trim().toUpperCase();
    const statusList = String(req.query.status || "EM LINHA,NOVA COLECAO")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    console.log(`[consumo-mp-lotes] Iniciando calculo para marca=${marca}, status=${statusList.join(',')}`);
    const t0 = Date.now();

    // 1. Buscar lotes por produto/período
    const lotesResult = await pool.query(`
      WITH produtos_filtrados AS (
        SELECT cd_produto
        FROM vr_prd_prdgrade
        WHERE UPPER(TRIM(COALESCE(f_dic_prd_classificacao(cd_produto, 'DS'::text, 20::bigint), ''))) = $1
          AND UPPER(TRIM(COALESCE(f_dic_prd_classificacao(cd_produto, 'DS'::text, 27::bigint), ''))) = ANY($2)
      )
      SELECT
        a.cd_produto,
        UPPER(TRIM(COALESCE(p.cd_auxiliar, ''))) AS periodo,
        SUM(COALESCE(a.qt_lote, 0))::FLOAT AS qt_lote,
        SUM(COALESCE(a.qt_gerouop, 0))::FLOAT AS qt_gerouop
      FROM vr_pcp_lotepl2 a
      INNER JOIN produtos_filtrados pf ON pf.cd_produto = a.cd_produto
      LEFT JOIN pcp_lotepv p ON a.nr_lote = p.nr_lote
      WHERE p.cd_auxiliar IN ('MA', 'PX', 'UL', 'QT', 'QU')
        AND p.tp_situacao = 1
      GROUP BY a.cd_produto, p.cd_auxiliar
    `, [marca, statusList]);

    console.log(`[consumo-mp-lotes] Encontrados ${lotesResult.rows.length} registros de lotes`);

    // Agrupar lotes por produto
    const lotesPorProduto = {};
    for (const row of lotesResult.rows) {
      const cdProduto = String(row.cd_produto || '').trim();
      const periodo = String(row.periodo || '').toUpperCase();
      if (!cdProduto || !['MA', 'PX', 'UL', 'QT', 'QU'].includes(periodo)) continue;

      if (!lotesPorProduto[cdProduto]) {
        lotesPorProduto[cdProduto] = { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0, gerouOp: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 } };
      }
      lotesPorProduto[cdProduto][periodo] = Number(row.qt_lote || 0);
      lotesPorProduto[cdProduto].gerouOp[periodo] = Number(row.qt_gerouop || 0);
    }

    const produtosComLote = Object.keys(lotesPorProduto);
    console.log(`[consumo-mp-lotes] ${produtosComLote.length} produtos com lotes`);

    if (produtosComLote.length === 0) {
      return res.json({
        success: true,
        data: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
        gerouOp: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
        pendente: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
        qtdLote: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
        qtdGerouOp: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
      });
    }

    // 2. Buscar estrutura de MP para os produtos (primeiro nível)
    const estruturaResult = await pool.query(`
      SELECT
        e.cd_produto,
        e.cd_componente,
        COALESCE(e.qt_utilizada, 0) AS qt_utilizada,
        COALESCE(mp.vl_customedio, 0) AS custo_mp
      FROM prd_estrutura e
      LEFT JOIN vr_est_saldos mp ON mp.cd_produto = e.cd_componente AND mp.cd_deposito = '01'
      WHERE e.cd_produto = ANY($1)
        AND e.tp_situacao = 1
        AND e.tp_estrutura = 'MP'
    `, [produtosComLote]);

    console.log(`[consumo-mp-lotes] Encontrados ${estruturaResult.rows.length} registros de estrutura`);

    // Agrupar estrutura por produto
    const estruturaPorProduto = {};
    for (const row of estruturaResult.rows) {
      const cdProduto = String(row.cd_produto || '').trim();
      if (!cdProduto) continue;

      if (!estruturaPorProduto[cdProduto]) {
        estruturaPorProduto[cdProduto] = [];
      }
      estruturaPorProduto[cdProduto].push({
        cdComponente: row.cd_componente,
        qtUtilizada: Number(row.qt_utilizada || 0),
        custoMp: Number(row.custo_mp || 0),
      });
    }

    // 3. Calcular consumo de MP por período
    const consumoPorPeriodo = { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 };
    const consumoGerouOp = { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 };
    const consumoPendente = { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 };
    const qtdLotePorPeriodo = { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 };
    const qtdGerouOpPorPeriodo = { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 };

    for (const cdProduto of produtosComLote) {
      const lotes = lotesPorProduto[cdProduto];
      const estrutura = estruturaPorProduto[cdProduto] || [];

      // Calcular custo de MP por unidade do produto
      let custoMpPorUnidade = 0;
      for (const comp of estrutura) {
        custoMpPorUnidade += comp.qtUtilizada * comp.custoMp;
      }

      // Calcular consumo por período
      for (const periodo of ['MA', 'PX', 'UL', 'QT', 'QU']) {
        const qtLote = lotes[periodo] || 0;
        const qtGerouOp = lotes.gerouOp[periodo] || 0;
        const qtPendente = Math.max(0, qtLote - qtGerouOp);

        qtdLotePorPeriodo[periodo] += qtLote;
        qtdGerouOpPorPeriodo[periodo] += qtGerouOp;
        consumoPorPeriodo[periodo] += qtLote * custoMpPorUnidade;
        consumoGerouOp[periodo] += qtGerouOp * custoMpPorUnidade;
        consumoPendente[periodo] += qtPendente * custoMpPorUnidade;
      }
    }

    console.log(`[consumo-mp-lotes] Calculo concluido em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`[consumo-mp-lotes] Consumo MA=${consumoPorPeriodo.MA.toFixed(2)}, PX=${consumoPorPeriodo.PX.toFixed(2)}`);

    return res.json({
      success: true,
      data: consumoPorPeriodo,
      gerouOp: consumoGerouOp,
      pendente: consumoPendente,
      qtdLote: qtdLotePorPeriodo,
      qtdGerouOp: qtdGerouOpPorPeriodo,
    });
  } catch (error) {
    console.error("[consumo-mp-lotes] Erro:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao calcular consumo de MP por lotes",
      details: error.message
    });
  }
});

router.get("/orcamento-mp-cache", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const key = String(req.query.key || ORCAMENTO_MP_CACHE_KEY);
    await ensureOrcamentoMpCacheTable(pool);

    const result = await pool.query(`
      SELECT payload, updated_at
      FROM public.app_orcamento_mp_cache
      WHERE cache_key = $1
      LIMIT 1
    `, [key]);

    if (!result.rows.length) {
      return res.status(200).json({ success: true, exists: false, data: null });
    }

    return res.status(200).json({
      success: true,
      exists: true,
      updatedAt: result.rows[0].updated_at,
      data: result.rows[0].payload,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar cache do orcamento MP",
      details: error.message
    });
  }
});

router.post("/orcamento-mp-cache", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const key = String(req.body?.key || ORCAMENTO_MP_CACHE_KEY);
    const payload = req.body?.payload;

    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ success: false, error: "Payload de cache invalido" });
    }

    await ensureOrcamentoMpCacheTable(pool);
    const result = await pool.query(`
      INSERT INTO public.app_orcamento_mp_cache (cache_key, payload, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (cache_key)
      DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
      RETURNING updated_at
    `, [key, JSON.stringify(payload)]);

    return res.status(200).json({
      success: true,
      updatedAt: result.rows[0]?.updated_at || new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao salvar cache do orcamento MP",
      details: error.message
    });
  }
});

/**
 * GET /api/producao/em-processo-local/:cdProduto
 * Retorna detalhes de produção em processo por local (setor)
 * Mostra em qual local está cada quantidade em processo
 *
 * Path params:
 * - cdProduto: código do produto
 */
router.get("/em-processo-local/:cdProduto", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const cdProduto = Number(req.params.cdProduto);

    if (isNaN(cdProduto)) {
      return res.status(400).json({
        success: false,
        error: "Código do produto inválido"
      });
    }

    const locais = await buscarEmProcessoPorLocal(pool, cdProduto);

    const totalEmProcesso = locais.reduce((acc, l) => acc + l.qtd_em_processo, 0);

    return res.status(200).json({
      success: true,
      cd_produto: cdProduto,
      total_em_processo: totalEmProcesso,
      total_locais: locais.length,
      data: locais
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar produção por local",
      details: error.message
    });
  }
});

/**
 * GET /api/producao/producao-por-local
 * Retorna visão completa de produção por local com estoque, pedidos, cobertura
 *
 * Query params:
 * - cd_local: filtrar por local específico
 * - marca: filtrar por marca (ex: "LIEBE")
 */
router.get("/producao-por-local", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const cdLocal = req.query.cd_local ? Number(req.query.cd_local) : null;
    const marca = req.query.marca ? String(req.query.marca).trim() : null;

    const dados = await buscarProducaoPorLocalCompleta(pool, { cdLocal, marca });

    return res.status(200).json({
      success: true,
      total: dados.length,
      data: dados
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar produção por local",
      details: error.message
    });
  }
});

/**
 * GET /api/producao/locais
 * Retorna lista de locais de produção com produção ativa
 */
router.get("/locais", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const locais = await buscarLocaisProducao(pool);

    return res.status(200).json({
      success: true,
      total: locais.length,
      data: locais
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar locais de produção",
      details: error.message
    });
  }
});

/**
 * POST /api/producao/mp-cadastro
 * Salva cadastro de MPs (codigo e descricao) em tabela dedicada
 */
async function ensureMpCadastroTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.app_mp_cadastro (
      codigo TEXT PRIMARY KEY,
      descricao TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

router.post("/mp-cadastro", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const mps = req.body?.mps;

    if (!Array.isArray(mps) || mps.length === 0) {
      return res.status(400).json({ success: false, error: "Lista de MPs invalida" });
    }

    await ensureMpCadastroTable(pool);

    // Upsert em batch
    const values = mps.map((mp, i) => `($${i * 2 + 1}, $${i * 2 + 2}, NOW())`).join(", ");
    const params = mps.flatMap(mp => [String(mp.codigo || mp.idmateriaprima || ""), String(mp.descricao || mp.nome_materiaprima || "")]);

    await pool.query(`
      INSERT INTO public.app_mp_cadastro (codigo, descricao, updated_at)
      VALUES ${values}
      ON CONFLICT (codigo)
      DO UPDATE SET descricao = EXCLUDED.descricao, updated_at = NOW()
    `, params);

    return res.status(200).json({
      success: true,
      count: mps.length,
      message: `${mps.length} MPs salvos com sucesso`
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao salvar cadastro de MPs",
      details: error.message
    });
  }
});

/**
 * GET /api/producao/ops-antigas
 * Retorna OPs em processo há mais de X dias (default 20)
 * Query params:
 * - dias: número de dias (padrão: 20)
 * - marca: filtrar por marca (padrão: LIEBE)
 * - status: filtrar por status (padrão: EM LINHA,NOVA COLECAO)
 * OTIMIZADO: Filtra OPs primeiro, depois aplica filtro de produtos
 */
router.get("/ops-antigas", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const diasMinimo = Number(req.query.dias) || 20;
    const marca = String(req.query.marca || "LIEBE").trim().toUpperCase();
    const statusParam = String(req.query.status || "EM LINHA,NOVA COLECAO").trim().toUpperCase();
    const statusList = statusParam.split(",").map(s => s.trim()).filter(Boolean);

    // OTIMIZADO: Primeiro pega as OPs antigas (rápido), depois filtra por marca/status
    const result = await pool.query(`
      WITH ops_em_processo AS (
        SELECT
          opi.cd_produto,
          opi.nr_op,
          opi.nr_ciclo,
          opc.dt_inicio,
          CURRENT_DATE - opc.dt_inicio::DATE AS dias_em_processo,
          SUM(opi.qt_real - COALESCE(opi.qt_finalizada, 0)) AS qtd_em_processo
        FROM vr_pcp_opi opi
        JOIN vr_pcp_opc opc
          ON opi.cd_empresa = opc.cd_empresa
          AND opi.nr_ciclo = opc.nr_ciclo
          AND opi.nr_op = opc.nr_op
        WHERE opi.cd_empresa = 1
          AND opc.dt_encerramento IS NULL
          AND opc.dt_inicio IS NOT NULL
          AND opc.dt_inicio::DATE < CURRENT_DATE - $1::INTEGER
          AND opi.tp_situacao IN (5, 10, 15, 20)
          AND COALESCE(opc.cd_categoria, 0) <> 15
          AND (opi.qt_real - COALESCE(opi.qt_finalizada, 0)) > 0
        GROUP BY opi.cd_produto, opi.nr_op, opi.nr_ciclo, opc.dt_inicio
      ),
      ops_com_grade AS (
        SELECT
          op.*,
          g.nm_produto AS descricao,
          g.cd_seqgrupo AS referencia,
          UPPER(TRIM(COALESCE(f_dic_prd_classificacao(op.cd_produto, 'DS'::text, 20::bigint), ''))) AS marca,
          UPPER(TRIM(COALESCE(f_dic_prd_classificacao(op.cd_produto, 'DS'::text, 27::bigint), ''))) AS status
        FROM ops_em_processo op
        LEFT JOIN vr_prd_prdgrade g ON g.cd_produto = op.cd_produto
      )
      SELECT cd_produto, nr_op, nr_ciclo, dt_inicio, dias_em_processo, qtd_em_processo, descricao, referencia
      FROM ops_com_grade
      WHERE marca = $2 AND status = ANY($3)
      ORDER BY dias_em_processo DESC, qtd_em_processo DESC
    `, [diasMinimo, marca, statusList]);

    // Calcular totais
    const totais = result.rows.reduce((acc, row) => {
      acc.qtdTotal += Number(row.qtd_em_processo || 0);
      acc.opsCount += 1;
      return acc;
    }, { qtdTotal: 0, opsCount: 0 });

    // Agrupar por faixa de dias
    const porFaixa = {
      "20-30 dias": { qtd: 0, ops: 0 },
      "31-45 dias": { qtd: 0, ops: 0 },
      "46-60 dias": { qtd: 0, ops: 0 },
      "60+ dias": { qtd: 0, ops: 0 },
    };
    for (const row of result.rows) {
      const dias = Number(row.dias_em_processo || 0);
      const qtd = Number(row.qtd_em_processo || 0);
      if (dias <= 30) {
        porFaixa["20-30 dias"].qtd += qtd;
        porFaixa["20-30 dias"].ops += 1;
      } else if (dias <= 45) {
        porFaixa["31-45 dias"].qtd += qtd;
        porFaixa["31-45 dias"].ops += 1;
      } else if (dias <= 60) {
        porFaixa["46-60 dias"].qtd += qtd;
        porFaixa["46-60 dias"].ops += 1;
      } else {
        porFaixa["60+ dias"].qtd += qtd;
        porFaixa["60+ dias"].ops += 1;
      }
    }

    return res.status(200).json({
      success: true,
      diasMinimo,
      marca,
      status: statusList,
      totais,
      porFaixa,
      data: result.rows.map(row => ({
        cdProduto: row.cd_produto,
        nrOp: row.nr_op,
        nrCiclo: row.nr_ciclo,
        dtInicio: row.dt_inicio,
        diasEmProcesso: Number(row.dias_em_processo || 0),
        qtdEmProcesso: Number(row.qtd_em_processo || 0),
        descricao: row.descricao,
        referencia: row.referencia,
      }))
    });
  } catch (error) {
    console.error("[producao/ops-antigas] Erro:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao buscar OPs antigas",
      details: error.message
    });
  }
});

/**
 * GET /api/producao/plano-ops-geradas
 * Analisa a diferenca entre plano original e restante (OPs ja geradas)
 * Mostra quais SKUs tiveram OPs geradas por periodo
 */
router.get("/plano-ops-geradas", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const periodo = String(req.query.periodo || 'PX').toUpperCase();

    if (!['MA', 'PX', 'UL', 'QT', 'QU'].includes(periodo)) {
      return res.status(400).json({ success: false, error: "Periodo invalido" });
    }

    // Buscar SKUs com OPs geradas no periodo
    const result = await pool.query(`
      SELECT
        a.cd_produto::TEXT AS idproduto,
        f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar) AS referencia,
        f_dic_prd_nivel(a.cd_produto, 'DS'::bpchar) AS produto,
        p.cd_auxiliar AS periodo,
        SUM(COALESCE(a.qt_lote, 0))::FLOAT AS plano_original,
        SUM(COALESCE(a.qt_gerouop, 0))::FLOAT AS qt_gerou_op,
        SUM(GREATEST(a.qt_lote - COALESCE(a.qt_gerouop, 0), 0))::FLOAT AS plano_restante
      FROM vr_pcp_lotepl2 a
      LEFT JOIN pcp_lotepv p ON a.nr_lote = p.nr_lote
      WHERE p.tp_situacao = 1
        AND UPPER(p.cd_auxiliar) = $1
        AND COALESCE(a.qt_gerouop, 0) > 0
      GROUP BY a.cd_produto, p.cd_auxiliar
      ORDER BY SUM(COALESCE(a.qt_gerouop, 0)) DESC
      LIMIT 100
    `, [periodo]);

    // Calcular totais
    const totais = result.rows.reduce((acc, row) => {
      acc.planoOriginal += Number(row.plano_original || 0);
      acc.qtGerouOp += Number(row.qt_gerou_op || 0);
      acc.planoRestante += Number(row.plano_restante || 0);
      return acc;
    }, { planoOriginal: 0, qtGerouOp: 0, planoRestante: 0 });

    return res.status(200).json({
      success: true,
      periodo,
      totais: {
        planoOriginal: Math.round(totais.planoOriginal),
        qtGerouOp: Math.round(totais.qtGerouOp),
        planoRestante: Math.round(totais.planoRestante),
        skusComOp: result.rows.length
      },
      data: result.rows.map(row => ({
        idproduto: row.idproduto,
        referencia: row.referencia,
        produto: row.produto,
        planoOriginal: Math.round(Number(row.plano_original || 0)),
        qtGerouOp: Math.round(Number(row.qt_gerou_op || 0)),
        planoRestante: Math.round(Number(row.plano_restante || 0)),
        percentualGerado: Number(row.plano_original || 0) > 0
          ? Math.round((Number(row.qt_gerou_op || 0) / Number(row.plano_original || 0)) * 100)
          : 0
      }))
    });
  } catch (error) {
    console.error("[plano-ops-geradas] Erro:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao buscar OPs geradas",
      details: error.message
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// VERSIONAMENTO DO ORCAMENTO MP
// ══════════════════════════════════════════════════════════════════════════════

async function ensureOrcamentoSnapshotsTable(pool) {
  // Verificar se a tabela existe primeiro para evitar erro de sequence duplicada
  const check = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'app_orcamento_mp_snapshots'
    )
  `);

  if (check.rows[0].exists) {
    return; // Tabela ja existe, nao precisa criar
  }

  await pool.query(`
    CREATE TABLE public.app_orcamento_mp_snapshots (
      id SERIAL PRIMARY KEY,
      descricao TEXT NOT NULL,
      marca TEXT NOT NULL DEFAULT 'LIEBE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      -- Totais gerais
      total_plano_original NUMERIC(15,2) NOT NULL DEFAULT 0,
      total_plano_atual NUMERIC(15,2) NOT NULL DEFAULT 0,
      total_diferenca NUMERIC(15,2) NOT NULL DEFAULT 0,

      -- Totais por periodo (JSONB: {MA: valor, PX: valor, ...})
      plano_original_por_periodo JSONB NOT NULL DEFAULT '{}',
      plano_atual_por_periodo JSONB NOT NULL DEFAULT '{}',

      -- Pecas PA por periodo
      pecas_pa_original_por_periodo JSONB NOT NULL DEFAULT '{}',
      pecas_pa_atual_por_periodo JSONB NOT NULL DEFAULT '{}',

      -- Detalhes por MP (array de objetos com idmp, artigo, valores)
      detalhes_mps JSONB NOT NULL DEFAULT '[]',

      -- Metadata
      qtd_mps INTEGER NOT NULL DEFAULT 0,
      qtd_skus INTEGER NOT NULL DEFAULT 0
    )
  `);
}

/**
 * POST /api/producao/orcamento-mp-snapshot
 * Salva uma versao/snapshot do orcamento MP atual
 */
router.post("/orcamento-mp-snapshot", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    await ensureOrcamentoSnapshotsTable(pool);

    const {
      descricao,
      marca = 'LIEBE',
      totalPlanoOriginal = 0,
      totalPlanoAtual = 0,
      planoOriginalPorPeriodo = {},
      planoAtualPorPeriodo = {},
      pecasPaOriginalPorPeriodo = {},
      pecasPaAtualPorPeriodo = {},
      detalhesMps = [],
      qtdMps = 0,
      qtdSkus = 0,
    } = req.body;

    if (!descricao || !descricao.trim()) {
      return res.status(400).json({
        success: false,
        error: "Descricao e obrigatoria"
      });
    }

    const totalDiferenca = totalPlanoAtual - totalPlanoOriginal;

    const result = await pool.query(`
      INSERT INTO public.app_orcamento_mp_snapshots (
        descricao, marca, total_plano_original, total_plano_atual, total_diferenca,
        plano_original_por_periodo, plano_atual_por_periodo,
        pecas_pa_original_por_periodo, pecas_pa_atual_por_periodo,
        detalhes_mps, qtd_mps, qtd_skus
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, created_at
    `, [
      descricao.trim(),
      marca,
      totalPlanoOriginal,
      totalPlanoAtual,
      totalDiferenca,
      JSON.stringify(planoOriginalPorPeriodo),
      JSON.stringify(planoAtualPorPeriodo),
      JSON.stringify(pecasPaOriginalPorPeriodo),
      JSON.stringify(pecasPaAtualPorPeriodo),
      JSON.stringify(detalhesMps),
      qtdMps,
      qtdSkus
    ]);

    return res.status(201).json({
      success: true,
      data: {
        id: result.rows[0].id,
        createdAt: result.rows[0].created_at,
        descricao: descricao.trim()
      }
    });
  } catch (error) {
    console.error("[orcamento-mp-snapshot] Erro ao salvar:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao salvar snapshot do orcamento",
      details: error.message
    });
  }
});

/**
 * GET /api/producao/orcamento-mp-snapshots
 * Lista todos os snapshots salvos
 */
router.get("/orcamento-mp-snapshots", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    await ensureOrcamentoSnapshotsTable(pool);

    const marca = String(req.query.marca || 'LIEBE').trim().toUpperCase();

    const result = await pool.query(`
      SELECT
        id, descricao, marca, created_at,
        total_plano_original, total_plano_atual, total_diferenca,
        qtd_mps, qtd_skus
      FROM public.app_orcamento_mp_snapshots
      WHERE UPPER(marca) = $1
      ORDER BY created_at DESC
      LIMIT 100
    `, [marca]);

    return res.status(200).json({
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        descricao: row.descricao,
        marca: row.marca,
        createdAt: row.created_at,
        totalPlanoOriginal: Number(row.total_plano_original || 0),
        totalPlanoAtual: Number(row.total_plano_atual || 0),
        totalDiferenca: Number(row.total_diferenca || 0),
        qtdMps: Number(row.qtd_mps || 0),
        qtdSkus: Number(row.qtd_skus || 0),
      }))
    });
  } catch (error) {
    console.error("[orcamento-mp-snapshots] Erro ao listar:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao listar snapshots",
      details: error.message
    });
  }
});

/**
 * GET /api/producao/orcamento-mp-snapshot/:id
 * Busca detalhes de um snapshot especifico
 */
router.get("/orcamento-mp-snapshot/:id", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    await ensureOrcamentoSnapshotsTable(pool);

    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, error: "ID invalido" });
    }

    const result = await pool.query(`
      SELECT * FROM public.app_orcamento_mp_snapshots WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Snapshot nao encontrado" });
    }

    const row = result.rows[0];
    return res.status(200).json({
      success: true,
      data: {
        id: row.id,
        descricao: row.descricao,
        marca: row.marca,
        createdAt: row.created_at,
        totalPlanoOriginal: Number(row.total_plano_original || 0),
        totalPlanoAtual: Number(row.total_plano_atual || 0),
        totalDiferenca: Number(row.total_diferenca || 0),
        planoOriginalPorPeriodo: row.plano_original_por_periodo || {},
        planoAtualPorPeriodo: row.plano_atual_por_periodo || {},
        pecasPaOriginalPorPeriodo: row.pecas_pa_original_por_periodo || {},
        pecasPaAtualPorPeriodo: row.pecas_pa_atual_por_periodo || {},
        detalhesMps: row.detalhes_mps || [],
        qtdMps: Number(row.qtd_mps || 0),
        qtdSkus: Number(row.qtd_skus || 0),
      }
    });
  } catch (error) {
    console.error("[orcamento-mp-snapshot/:id] Erro:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao buscar snapshot",
      details: error.message
    });
  }
});

/**
 * GET /api/producao/orcamento-mp-snapshots/comparar
 * Compara dois snapshots
 */
router.get("/orcamento-mp-snapshots/comparar", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    await ensureOrcamentoSnapshotsTable(pool);

    const idA = Number(req.query.idA);
    const idB = Number(req.query.idB);

    if (!idA || !idB || isNaN(idA) || isNaN(idB)) {
      return res.status(400).json({ success: false, error: "IDs invalidos" });
    }

    const result = await pool.query(`
      SELECT * FROM public.app_orcamento_mp_snapshots WHERE id = ANY($1)
    `, [[idA, idB]]);

    if (result.rows.length !== 2) {
      return res.status(404).json({ success: false, error: "Um ou ambos snapshots nao encontrados" });
    }

    const snapA = result.rows.find(r => r.id === idA);
    const snapB = result.rows.find(r => r.id === idB);

    // Comparar totais
    const diferencaTotal = Number(snapB.total_plano_atual || 0) - Number(snapA.total_plano_atual || 0);

    // Comparar por periodo
    const periodosA = snapA.plano_atual_por_periodo || {};
    const periodosB = snapB.plano_atual_por_periodo || {};
    const diferencaPorPeriodo = {};
    for (const p of ['MA', 'PX', 'UL', 'QT', 'QU']) {
      diferencaPorPeriodo[p] = Number(periodosB[p] || 0) - Number(periodosA[p] || 0);
    }

    // Comparar MPs (simplificado - mostra MPs que mudaram)
    const mpsA = new Map((snapA.detalhes_mps || []).map(m => [m.idmp, m]));
    const mpsB = new Map((snapB.detalhes_mps || []).map(m => [m.idmp, m]));

    const mpsAlteradas = [];
    const mpsAdicionadas = [];
    const mpsRemovidas = [];

    for (const [idmp, mpB] of mpsB.entries()) {
      const mpA = mpsA.get(idmp);
      if (!mpA) {
        mpsAdicionadas.push({ idmp, ...mpB });
      } else {
        const diffValor = Number(mpB.valorTotal || 0) - Number(mpA.valorTotal || 0);
        if (Math.abs(diffValor) > 0.01) {
          mpsAlteradas.push({
            idmp,
            artigo: mpB.artigo,
            valorAntes: Number(mpA.valorTotal || 0),
            valorDepois: Number(mpB.valorTotal || 0),
            diferenca: diffValor
          });
        }
      }
    }

    for (const [idmp, mpA] of mpsA.entries()) {
      if (!mpsB.has(idmp)) {
        mpsRemovidas.push({ idmp, ...mpA });
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        snapshotA: {
          id: snapA.id,
          descricao: snapA.descricao,
          createdAt: snapA.created_at,
          totalPlanoAtual: Number(snapA.total_plano_atual || 0)
        },
        snapshotB: {
          id: snapB.id,
          descricao: snapB.descricao,
          createdAt: snapB.created_at,
          totalPlanoAtual: Number(snapB.total_plano_atual || 0)
        },
        comparacao: {
          diferencaTotal,
          diferencaPorPeriodo,
          mpsAdicionadas: mpsAdicionadas.length,
          mpsRemovidas: mpsRemovidas.length,
          mpsAlteradas: mpsAlteradas.length,
          detalhesAlteracoes: {
            adicionadas: mpsAdicionadas.slice(0, 20),
            removidas: mpsRemovidas.slice(0, 20),
            alteradas: mpsAlteradas
              .sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca))
              .slice(0, 20)
          }
        }
      }
    });
  } catch (error) {
    console.error("[orcamento-mp-snapshots/comparar] Erro:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao comparar snapshots",
      details: error.message
    });
  }
});

/**
 * DELETE /api/producao/orcamento-mp-snapshot/:id
 * Remove um snapshot
 */
router.delete("/orcamento-mp-snapshot/:id", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const id = Number(req.params.id);

    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, error: "ID invalido" });
    }

    await pool.query(`DELETE FROM public.app_orcamento_mp_snapshots WHERE id = $1`, [id]);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("[orcamento-mp-snapshot DELETE] Erro:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao remover snapshot",
      details: error.message
    });
  }
});

module.exports = router;
