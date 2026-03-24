const express = require("express");

const router = express.Router();

/**
 * GET /api/filtros/status
 * Retorna lista de status únicos disponíveis
 */
router.get("/status", async (req, res) => {
  try {
    const pool = req.app.get("pool");

    const query = `
      SELECT DISTINCT
        f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 27::bigint) AS status
      FROM vr_prd_prdgrade a
      WHERE f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 27::bigint) IS NOT NULL
        AND f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 27::bigint) != ''
        AND UPPER(TRIM(COALESCE(a.ds_tamanho, ''))) <> 'PT 99'
      ORDER BY status
    `;

    const result = await pool.query(query);

    const statusList = result.rows.map(row => row.status).filter(s => s);

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
    const pool = req.app.get("pool");

    const query = `
      SELECT DISTINCT
        f_dic_prd_classificacao(a.cd_produto, 'CD'::text, 24::bigint) AS idfamilia,
        f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 24::bigint) AS nome_familia
      FROM vr_prd_prdgrade a
      WHERE f_dic_prd_classificacao(a.cd_produto, 'CD'::text, 24::bigint) IS NOT NULL
        AND f_dic_prd_classificacao(a.cd_produto, 'CD'::text, 24::bigint) != ''
        AND UPPER(TRIM(COALESCE(a.ds_tamanho, ''))) <> 'PT 99'
      ORDER BY idfamilia
    `;

    const result = await pool.query(query);

    const familias = result.rows.filter(row => row.idfamilia);

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
    const pool = req.app.get("pool");

    const query = `
      SELECT DISTINCT
        f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 802::bigint) AS continuidade
      FROM vr_prd_prdgrade a
      WHERE f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 802::bigint) IS NOT NULL
        AND f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 802::bigint) != ''
        AND UPPER(TRIM(COALESCE(a.ds_tamanho, ''))) <> 'PT 99'
      ORDER BY continuidade
    `;

    const result = await pool.query(query);

    const continuidades = result.rows.map(row => row.continuidade).filter(c => c);

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
