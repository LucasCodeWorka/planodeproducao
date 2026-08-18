/**
 * Rotas de API para estoque das lojas
 *
 * Endpoints:
 * - GET /api/estoque-lojas           - Lista estoque atual das lojas
 * - GET /api/estoque-lojas/excedente - Excedente por loja/produto
 * - GET /api/estoque-lojas/excedente-total - Excedente agregado por produto
 * - GET /api/estoque-lojas/lojas     - Lista de lojas disponíveis
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const {
  buscarEstoqueLojas,
  calcularEstoqueExcedentePorLoja,
  calcularExcedenteTotalPorProduto,
  buscarLojas,
  buscarEstoqueDisponivelTransferencia,
  buscarEstoqueDisponivelAgregadoPorProduto,
} = require("../services/estoqueLojas");
const { withCache, invalidateCache, getCacheStatus } = require("../cache/estoqueLojaCache");

const DATA_DIR = path.join(__dirname, "../../data");
const ESTOQUE_LOJAS_FILE = path.join(DATA_DIR, "config_estoque_lojas.json");

/**
 * Lê a configuração de cobertura mínima do arquivo JSON
 */
function lerCoberturaConfigurada() {
  try {
    const raw = fs.readFileSync(ESTOQUE_LOJAS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const cfg = parsed?.data || {};
    return Number(cfg.cobertura_minima_lojas || 1.0);
  } catch {
    return 1.0; // fallback padrão
  }
}

// Middleware de autenticação (mesmo padrão de configuracoes.js)
function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
  const expected = (process.env.ADMIN_PASSWORD || "").trim();
  if (!expected) {
    return res.status(500).json({ success: false, error: "ADMIN_PASSWORD nao configurado" });
  }
  if (token !== expected) {
    return res.status(401).json({ success: false, error: "Nao autorizado" });
  }
  next();
}

/**
 * GET /api/estoque-lojas
 * Retorna estoque atual de todas as lojas
 *
 * Query params:
 * - cdProduto: filtrar por produto específico
 * - cdEmpresa: filtrar por loja específica
 */
router.get("/", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const { cdProduto, cdEmpresa } = req.query;

    const data = await buscarEstoqueLojas(pool, {
      cdProduto: cdProduto ? Number(cdProduto) : null,
      cdEmpresa: cdEmpresa ? Number(cdEmpresa) : null
    });

    return res.json({
      success: true,
      total: data.length,
      data
    });
  } catch (error) {
    console.error("[estoqueLojas] Erro em GET /:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/estoque-lojas/lojas
 * Retorna lista de lojas disponíveis (com cache)
 */
router.get("/lojas", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const forceRefresh = req.query.refresh === 'true';

    const data = await withCache('lojas', async () => {
      return await buscarLojas(pool);
    }, forceRefresh);

    return res.json({
      success: true,
      total: data.length,
      cached: !forceRefresh,
      data
    });
  } catch (error) {
    console.error("[estoqueLojas] Erro em GET /lojas:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get("/disponivel", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const { refresh, lojaDestino, cdProduto, lojaOrigem } = req.query;
    const forceRefresh = refresh === "true";
    const destino = Number(lojaDestino || 1);
    const produto = cdProduto ? Number(cdProduto) : null;
    const origem = lojaOrigem ? Number(lojaOrigem) : null;
    const cacheKey = `disponivel_dest${destino}_prod${produto || "all"}_orig${origem || "all"}`;

    const data = await withCache(cacheKey, async () => {
      return await buscarEstoqueDisponivelTransferencia(pool, {
        lojaDestino: destino,
        cdProduto: produto,
        lojaOrigem: origem,
      });
    }, forceRefresh);

    return res.json({
      success: true,
      total: data.length,
      lojaDestino: destino,
      cached: !forceRefresh,
      data,
    });
  } catch (error) {
    console.error("[estoqueLojas] Erro em GET /disponivel:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get("/disponivel-total", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const { refresh, lojaDestino, cdProduto, incluirDetalhes } = req.query;
    const forceRefresh = refresh === "true";
    const destino = Number(lojaDestino || 1);
    const produto = cdProduto ? Number(cdProduto) : null;
    const detalhes = incluirDetalhes !== "false";
    const cacheKey = `disponivel_total_dest${destino}`;

    const data = await withCache(cacheKey, async () => {
      return await buscarEstoqueDisponivelAgregadoPorProduto(pool, {
        lojaDestino: destino,
        incluirDetalhes: true,
      });
    }, forceRefresh);

    let resultado = data;
    if (produto !== null) {
      resultado = resultado.filter((item) => Number(item.cd_produto) === produto);
    }

    const somaDisponivel = resultado.reduce((acc, item) => acc + Number(item.qtd_disponivel_total || 0), 0);

    return res.json({
      success: true,
      total: resultado.length,
      lojaDestino: destino,
      cached: !forceRefresh,
      resumo: {
        soma_disponivel_total: Math.round(somaDisponivel),
      },
      data: resultado.map((item) => ({
        ...item,
        detalhes_lojas: detalhes ? (item.detalhes_lojas || []) : [],
      })),
    });
  } catch (error) {
    console.error("[estoqueLojas] Erro em GET /disponivel-total:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/estoque-lojas/excedente
 * Retorna estoque excedente por loja/produto
 *
 * Query params:
 * - cdProduto: filtrar por produto específico
 * - coberturaMinima: cobertura mínima que a loja deve manter (padrão: lê do config_estoque_lojas.json)
 */
router.get("/excedente", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const { cdProduto, coberturaMinima } = req.query;

    // Se não foi passado coberturaMinima, usa o valor configurado no arquivo
    const coberturaConfigurada = lerCoberturaConfigurada();
    const cob = coberturaMinima ? Number(coberturaMinima) : coberturaConfigurada;

    if (cob <= 0) {
      return res.status(400).json({
        success: false,
        error: "coberturaMinima deve ser maior que zero"
      });
    }

    const data = await calcularEstoqueExcedentePorLoja(pool, {
      cdProduto: cdProduto ? Number(cdProduto) : null,
      coberturaMinima: cob
    });

    // Filtra apenas com excedente se solicitado
    const apenasComExcedente = req.query.apenasComExcedente === 'true';
    const resultado = apenasComExcedente
      ? data.filter(d => d.excedente > 0)
      : data;

    return res.json({
      success: true,
      total: resultado.length,
      coberturaMinima: cob,
      data: resultado
    });
  } catch (error) {
    console.error("[estoqueLojas] Erro em GET /excedente:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/estoque-lojas/excedente-total
 * Retorna excedente agregado por produto (soma de todas as lojas) - COM CACHE
 *
 * Query params:
 * - coberturaMinima: cobertura mínima que a loja deve manter (padrão: lê do config_estoque_lojas.json)
 * - apenasComExcedente: se 'true', retorna apenas produtos com excedente > 0
 * - refresh: se 'true', força atualização do cache
 */
router.get("/excedente-total", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const { coberturaMinima, apenasComExcedente, refresh, incluirDetalhes, cdProduto } = req.query;

    // Se não foi passado coberturaMinima, usa o valor configurado no arquivo
    const coberturaConfigurada = lerCoberturaConfigurada();
    const cob = coberturaMinima ? Number(coberturaMinima) : coberturaConfigurada;

    if (cob <= 0) {
      return res.status(400).json({
        success: false,
        error: "coberturaMinima deve ser maior que zero"
      });
    }

    const forceRefresh = refresh === 'true';
    const cacheKey = `excedente_total_cob${cob}`;

    // Busca dados com cache
    const data = await withCache(cacheKey, async () => {
      return await calcularExcedenteTotalPorProduto(pool, {
        coberturaMinima: cob
      });
    }, forceRefresh);

    // Por padrão, retorna apenas produtos com excedente
    const incluirDetalhesResultado = incluirDetalhes !== 'false';
    const cdProdutoFiltro = cdProduto ? Number(cdProduto) : null;
    const filtrar = apenasComExcedente !== 'false';
    let comExcedente = filtrar
      ? data.filter(p => p.excedente_total > 0)
      : data;

    if (cdProdutoFiltro) {
      comExcedente = comExcedente.filter(p => p.cd_produto === cdProdutoFiltro);
    }

    // Calcula totais
    const somaExcedente = comExcedente.reduce((acc, p) => acc + p.excedente_total, 0);
    const somaEstoqueLojas = comExcedente.reduce((acc, p) => acc + p.estoque_total_lojas, 0);
    const totalLojas = comExcedente.reduce((acc, p) => acc + p.lojas_com_excedente, 0);

    return res.json({
      success: true,
      total: comExcedente.length,
      coberturaMinima: cob,
      coberturaConfigurada: coberturaConfigurada,
      cached: !forceRefresh,
      resumo: {
        soma_excedente: Math.round(somaExcedente),
        soma_estoque_lojas: Math.round(somaEstoqueLojas),
        total_lojas_com_excedente: totalLojas
      },
      data: comExcedente.map(p => ({
        cd_produto: p.cd_produto,
        excedente_total: Math.round(p.excedente_total),
        estoque_total_lojas: Math.round(p.estoque_total_lojas),
        lojas_com_excedente: p.lojas_com_excedente,
        detalhes_lojas: incluirDetalhesResultado
          ? (p.detalhes_lojas || []).map(l => ({
              cd_empresa: l.cd_empresa,
              excedente: Math.round(l.excedente),
              estoque_loja: Math.round(l.estoque_loja),
              cobertura_atual: l.cobertura_atual ? Number(l.cobertura_atual.toFixed(2)) : null
            }))
          : []
      }))
    });
  } catch (error) {
    console.error("[estoqueLojas] Erro em GET /excedente-total:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/estoque-lojas/cache-status
 * Retorna status do cache de estoque de lojas
 */
router.get("/cache-status", auth, async (req, res) => {
  try {
    const status = getCacheStatus();
    return res.json({
      success: true,
      ...status
    });
  } catch (error) {
    console.error("[estoqueLojas] Erro em GET /cache-status:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/estoque-lojas/invalidate-cache
 * Invalida o cache de estoque de lojas
 *
 * Body:
 * - key: chave específica do cache para invalidar (opcional, se omitido invalida tudo)
 */
router.post("/invalidate-cache", auth, async (req, res) => {
  try {
    const { key } = req.body;
    invalidateCache(key || null);

    return res.json({
      success: true,
      message: key ? `Cache '${key}' invalidado` : 'Todo o cache foi invalidado'
    });
  } catch (error) {
    console.error("[estoqueLojas] Erro em POST /invalidate-cache:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
