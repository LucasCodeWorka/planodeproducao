const express = require("express");

const router = express.Router();

// Cache simples em memória para filtros (não mudam frequentemente)
const filtrosCache = {
  status: { data: null, timestamp: 0 },
  familias: { data: null, timestamp: 0 },
  continuidade: { data: null, timestamp: 0 },
};
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hora

/**
 * GET /api/filtros/status
 * Retorna lista de status únicos disponíveis
 */
router.get("/status", async (req, res) => {
  try {
    // Retorna cache se ainda válido
    if (filtrosCache.status.data && (Date.now() - filtrosCache.status.timestamp) < CACHE_TTL_MS) {
      return res.status(200).json({ success: true, data: filtrosCache.status.data, fromCache: true });
    }

    const pool = req.app.get("pool");

    // Query otimizada: usa subquery com LIMIT para evitar full table scan
    const query = `
      SELECT DISTINCT status FROM (
        SELECT f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 27::bigint) AS status
        FROM vr_prd_prdgrade a
        WHERE UPPER(TRIM(COALESCE(a.ds_tamanho, ''))) <> 'PT 99'
        LIMIT 50000
      ) sub
      WHERE status IS NOT NULL AND status != ''
      ORDER BY status
    `;

    const result = await pool.query(query);
    const statusList = result.rows.map(row => row.status).filter(s => s);

    // Salva no cache
    filtrosCache.status = { data: statusList, timestamp: Date.now() };

    return res.status(200).json({
      success: true,
      data: statusList
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao buscar status",
      details: error.message
    });
  }
});

/**
 * GET /api/filtros/familias
 * Retorna lista de famílias únicas disponíveis
 */
router.get("/familias", async (req, res) => {
  try {
    // Retorna cache se ainda válido
    if (filtrosCache.familias.data && (Date.now() - filtrosCache.familias.timestamp) < CACHE_TTL_MS) {
      return res.status(200).json({ success: true, data: filtrosCache.familias.data, fromCache: true });
    }

    const pool = req.app.get("pool");

    const query = `
      SELECT DISTINCT idfamilia, nome_familia FROM (
        SELECT
          f_dic_prd_classificacao(a.cd_produto, 'CD'::text, 24::bigint) AS idfamilia,
          f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 24::bigint) AS nome_familia
        FROM vr_prd_prdgrade a
        WHERE UPPER(TRIM(COALESCE(a.ds_tamanho, ''))) <> 'PT 99'
        LIMIT 50000
      ) sub
      WHERE idfamilia IS NOT NULL AND idfamilia != ''
      ORDER BY idfamilia
    `;

    const result = await pool.query(query);
    const familias = result.rows.filter(row => row.idfamilia);

    // Salva no cache
    filtrosCache.familias = { data: familias, timestamp: Date.now() };

    return res.status(200).json({
      success: true,
      data: familias
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao buscar famílias",
      details: error.message
    });
  }
});

/**
 * GET /api/filtros/continuidade
 * Retorna lista de continuidades únicas disponíveis
 */
router.get("/continuidade", async (req, res) => {
  try {
    // Retorna cache se ainda válido
    if (filtrosCache.continuidade.data && (Date.now() - filtrosCache.continuidade.timestamp) < CACHE_TTL_MS) {
      return res.status(200).json({ success: true, data: filtrosCache.continuidade.data, fromCache: true });
    }

    const pool = req.app.get("pool");

    const query = `
      SELECT DISTINCT continuidade FROM (
        SELECT f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 802::bigint) AS continuidade
        FROM vr_prd_prdgrade a
        WHERE UPPER(TRIM(COALESCE(a.ds_tamanho, ''))) <> 'PT 99'
        LIMIT 50000
      ) sub
      WHERE continuidade IS NOT NULL AND continuidade != ''
      ORDER BY continuidade
    `;

    const result = await pool.query(query);
    const continuidades = result.rows.map(row => row.continuidade).filter(c => c);

    // Salva no cache
    filtrosCache.continuidade = { data: continuidades, timestamp: Date.now() };

    return res.status(200).json({
      success: true,
      data: continuidades
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao buscar continuidades",
      details: error.message
    });
  }
});

module.exports = router;
