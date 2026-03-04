const express = require("express");
const { calcularEstoqueMinimo } = require("../services/estoqueMinimo");
const {
  buscarVendasComMedias,
  buscarProdutoComMedias,
  buscarEstatisticasProduto
} = require("../services/vendasService");

const router = express.Router();

/**
 * GET /api/vendas
 * Retorna dados brutos de vendas da view vr_vendas_qtd
 *
 * Query params:
 * - limit: número máximo de registros (padrão: 100, máximo: 1000)
 * - offset: deslocamento para paginação (padrão: 0)
 * - idproduto: filtrar por ID do produto (opcional)
 * - idempresa: filtrar por ID da empresa (opcional)
 */
router.get("/", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const idProduto = req.query.idproduto ? Number(req.query.idproduto) : null;
    const idEmpresa = req.query.idempresa ? Number(req.query.idempresa) : null;

    let query = `SELECT * FROM vr_vendas_qtd WHERE 1=1`;
    const params = [];
    let paramIndex = 1;

    if (idProduto !== null) {
      query += ` AND idproduto = $${paramIndex}`;
      params.push(idProduto);
      paramIndex++;
    }

    if (idEmpresa !== null) {
      query += ` AND idempresa = $${paramIndex}`;
      params.push(idEmpresa);
      paramIndex++;
    }

    query += ` ORDER BY data DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      total: result.rowCount,
      limit,
      offset,
      data: result.rows
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar vendas",
      details: error.message
    });
  }
});

/**
 * GET /api/vendas/produtos
 * Retorna lista de produtos únicos com suas médias de vendas calculadas
 *
 * Query params:
 * - limit: número máximo de produtos (padrão: 50, máximo: 500)
 * - offset: deslocamento para paginação (padrão: 0)
 * - idproduto: filtrar por ID do produto específico (opcional)
 * - idempresa: filtrar por ID da empresa (opcional)
 */
router.get("/produtos", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const idProduto = req.query.idproduto ? Number(req.query.idproduto) : null;
    const idEmpresa = req.query.idempresa ? Number(req.query.idempresa) : null;

    const produtos = await buscarVendasComMedias(pool, {
      limit,
      offset,
      idProduto,
      idEmpresa
    });

    return res.status(200).json({
      success: true,
      total: produtos.length,
      limit,
      offset,
      data: produtos
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar produtos",
      details: error.message
    });
  }
});

/**
 * GET /api/vendas/produtos/com-estoque-minimo
 * Retorna produtos com médias de vendas e estoque mínimo calculado
 *
 * Query params:
 * - limit: número máximo de produtos (padrão: 50, máximo: 500)
 * - offset: deslocamento para paginação (padrão: 0)
 * - idproduto: filtrar por ID do produto (opcional)
 * - idempresa: filtrar por ID da empresa (opcional)
 */
router.get("/produtos/com-estoque-minimo", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const idProduto = req.query.idproduto ? Number(req.query.idproduto) : null;
    const idEmpresa = req.query.idempresa ? Number(req.query.idempresa) : null;

    const produtos = await buscarVendasComMedias(pool, {
      limit,
      offset,
      idProduto,
      idEmpresa
    });

    // Calcular estoque mínimo para cada produto
    const produtosComEstoque = produtos.map(produto => {
      const estoqueCalculo = calcularEstoqueMinimo(
        produto.media_semestral,
        produto.media_trimestral
      );

      return {
        ...produto,
        estoque_minimo: estoqueCalculo.estoqueMinimo,
        variacao_percentual: estoqueCalculo.variacaoPercentual,
        regra_aplicada: estoqueCalculo.regraAplicada,
        descricao_regra: estoqueCalculo.descricaoRegra
      };
    });

    return res.status(200).json({
      success: true,
      total: produtosComEstoque.length,
      limit,
      offset,
      data: produtosComEstoque
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar produtos com estoque mínimo",
      details: error.message
    });
  }
});

/**
 * GET /api/vendas/produtos/:idProduto/estoque-minimo
 * Retorna o estoque mínimo calculado para um produto específico
 *
 * Query params:
 * - idempresa: filtrar por ID da empresa (opcional)
 */
router.get("/produtos/:idProduto/estoque-minimo", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const idProduto = Number(req.params.idProduto);
    const idEmpresa = req.query.idempresa ? Number(req.query.idempresa) : null;

    if (isNaN(idProduto)) {
      return res.status(400).json({
        success: false,
        error: "ID do produto inválido"
      });
    }

    const produto = await buscarProdutoComMedias(pool, idProduto, idEmpresa);

    if (!produto) {
      return res.status(404).json({
        success: false,
        error: "Produto não encontrado"
      });
    }

    const estoqueCalculo = calcularEstoqueMinimo(
      produto.media_semestral,
      produto.media_trimestral
    );

    return res.status(200).json({
      success: true,
      data: {
        ...produto,
        ...estoqueCalculo
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar estoque mínimo do produto",
      details: error.message
    });
  }
});

/**
 * GET /api/vendas/produtos/:idProduto/estatisticas
 * Retorna estatísticas detalhadas de vendas de um produto
 *
 * Query params:
 * - idempresa: filtrar por ID da empresa (opcional)
 */
router.get("/produtos/:idProduto/estatisticas", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const idProduto = Number(req.params.idProduto);
    const idEmpresa = req.query.idempresa ? Number(req.query.idempresa) : null;

    if (isNaN(idProduto)) {
      return res.status(400).json({
        success: false,
        error: "ID do produto inválido"
      });
    }

    const estatisticas = await buscarEstatisticasProduto(pool, idProduto, idEmpresa);

    if (!estatisticas) {
      return res.status(404).json({
        success: false,
        error: "Produto não encontrado ou sem histórico de vendas"
      });
    }

    // Calcular estoque mínimo baseado nas médias
    const estoqueCalculo = calcularEstoqueMinimo(
      estatisticas.ultimos_6_meses.media_por_dia,
      estatisticas.ultimos_3_meses.media_por_dia
    );

    return res.status(200).json({
      success: true,
      data: {
        ...estatisticas,
        estoque_minimo: {
          valor: estoqueCalculo.estoqueMinimo,
          variacao_percentual: estoqueCalculo.variacaoPercentual,
          regra_aplicada: estoqueCalculo.regraAplicada,
          descricao_regra: estoqueCalculo.descricaoRegra
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar estatísticas do produto",
      details: error.message
    });
  }
});

module.exports = router;
