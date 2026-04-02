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
  buscarLocaisProducao
} = require("../services/producaoService");

const { readCache, filterCache } = require("../cache/matrizCache");

const router = express.Router();
const catalogoCache = new Map();
const CATALOGO_CACHE_TTL_MS = (Number(process.env.CATALOGO_CACHE_TTL_SECONDS) || 600) * 1000;

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
    const referencias = req.query.referencias
      ? String(req.query.referencias).split(',').map((r) => r.trim()).filter(Boolean)
      : [];

    // ── tenta servir do cache ───────────────────────────────────────────────
    const cached = await readCache();
    const cacheMarca = cached?.meta?.marca ? String(cached.meta.marca).trim().toUpperCase() : null;
    const cacheStatus = cached?.meta?.status ? String(cached.meta.status).trim().toUpperCase() : null;
    const reqMarca   = marca ? marca.toUpperCase() : null;
    const reqStatus  = status ? status.toUpperCase() : null;
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
            // cache por status só atende mesmo status
            cacheStatus === reqStatus
          );

    if (cached && cached.fresh && cacheAtendeMarca && cacheAtendeStatus) {
      const filtrado = filterCache(cached.data, { referencias, marca, status });
      const pagina   = filtrado.slice(offset, offset + limit);

      res.set('X-Cache', 'HIT');
      res.set('X-Cache-Age', String(cached.ageHours.toFixed(1)) + 'h');
      return res.status(200).json({
        success: true,
        total:   pagina.length,
        totalAll: filtrado.length,
        fromCache: true,
        cacheUpdatedAt: new Date(cached.timestamp).toLocaleString('pt-BR'),
        limit,
        offset,
        data: pagina
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

    res.set('X-Cache', 'MISS');
    return res.status(200).json({
      success: true,
      total:   resultados.length,
      fromCache: false,
      limit,
      offset,
      data: resultados
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar matriz"
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

module.exports = router;
