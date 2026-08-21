const express = require('express');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const pool = req.app.get('pool');
    const de = String(req.query.de || '').slice(0, 10);
    const ate = String(req.query.ate || '').slice(0, 10);
    const op = String(req.query.op || '').trim();
    const referencia = String(req.query.referencia || '').trim();
    const sku = String(req.query.sku || '').trim();

    if (!de && !ate && !op && !referencia && !sku) {
      return res.status(400).json({ success: false, error: 'Informe um período, OP, referência ou SKU.' });
    }
    if ((de && !ate) || (!de && ate)) {
      return res.status(400).json({ success: false, error: 'Informe as duas datas do período.' });
    }

    const params = [];
    const conditions = [
      'opc.cd_empresa = 1',
      'COALESCE(opc.cd_categoria, 0) <> 15',
      'opi.cd_empresa = opc.cd_empresa',
      'opi.nr_ciclo = opc.nr_ciclo',
      'opi.nr_op = opc.nr_op',
    ];
    if (de && ate) {
      params.push(de);
      conditions.push(`opc.dt_inclusao >= $${params.length}::DATE`);
      params.push(ate);
      conditions.push(`opc.dt_inclusao < ($${params.length}::DATE + INTERVAL '1 day')`);
    }
    if (op) {
      params.push(op);
      conditions.push(`opc.nr_op::TEXT = $${params.length}`);
    }
    if (referencia) {
      params.push(referencia);
      conditions.push(`f_dic_prd_nivel(opi.cd_produto, 'CD'::BPCHAR)::TEXT = $${params.length}`);
    }
    if (sku) {
      params.push(sku);
      conditions.push(`opi.cd_produto::TEXT = $${params.length}`);
    }

    const result = await pool.query(`
      WITH RECURSIVE
      op_itens AS (
        SELECT
          opc.cd_empresa, opc.nr_ciclo, opc.nr_op, opc.dt_inclusao, opc.dt_inicio, opc.dt_encerramento,
          opi.cd_produto::TEXT AS sku, COALESCE(opi.qt_real, 0)::FLOAT AS qtd_op,
          f_dic_prd_nivel(opi.cd_produto, 'CD'::BPCHAR)::TEXT AS referencia,
          COALESCE(f_dic_prd_nivel(opi.cd_produto, 'DS'::BPCHAR), grade.nm_produto, '')::TEXT AS produto,
          COALESCE(grade.ds_cor, '')::TEXT AS cor, COALESCE(grade.ds_tamanho, '')::TEXT AS tamanho,
          COALESCE(conv_produto.unidade_medida, '')::TEXT AS unidade_medida
        FROM vr_pcp_opc opc
        INNER JOIN vr_pcp_opi opi
          ON opi.cd_empresa = opc.cd_empresa AND opi.nr_ciclo = opc.nr_ciclo AND opi.nr_op = opc.nr_op
        LEFT JOIN vr_prd_prdgrade grade ON grade.cd_produto = opi.cd_produto
        LEFT JOIN LATERAL (
          SELECT c.cd_especieconv::TEXT AS unidade_medida
          FROM vr_prd_prdconvmed c
          WHERE c.cd_produto = opi.cd_produto
            AND UPPER(COALESCE(c.in_padrao, '')) IN ('T', 'S', '1', 'TRUE')
          ORDER BY c.in_padrao DESC
          LIMIT 1
        ) conv_produto ON TRUE
        WHERE ${conditions.join(' AND ')}
      ),
      explosao AS (
        SELECT
          i.cd_empresa, i.nr_ciclo, i.nr_op, i.dt_inclusao, i.dt_inicio, i.dt_encerramento,
          i.sku AS sku_pai, i.referencia, i.produto, i.cor, i.tamanho, i.unidade_medida, i.qtd_op,
          c.cd_produtomp::TEXT AS id_mp,
          (i.qtd_op * COALESCE(c.qt_consumo, 0))::FLOAT AS qtd_mp,
          1 AS nivel, ARRAY[i.sku, c.cd_produtomp::TEXT] AS caminho
        FROM op_itens i
        INNER JOIN vr_pcp_fcconsumo c ON c.cd_produtopa::TEXT = i.sku
        WHERE COALESCE(c.qt_consumo, 0) > 0
        UNION ALL
        SELECT
          e.cd_empresa, e.nr_ciclo, e.nr_op, e.dt_inclusao, e.dt_inicio, e.dt_encerramento,
          e.sku_pai, e.referencia, e.produto, e.cor, e.tamanho, e.unidade_medida, e.qtd_op,
          c.cd_produtomp::TEXT AS id_mp,
          (e.qtd_mp * COALESCE(c.qt_consumo, 0))::FLOAT AS qtd_mp,
          e.nivel + 1, e.caminho || c.cd_produtomp::TEXT
        FROM explosao e
        INNER JOIN vr_pcp_fcconsumo c ON c.cd_produtopa::TEXT = e.id_mp
        WHERE e.nivel < 8 AND COALESCE(c.qt_consumo, 0) > 0
          AND NOT c.cd_produtomp::TEXT = ANY(e.caminho)
      ),
      folhas AS (
        SELECT e.* FROM explosao e
        WHERE NOT EXISTS (
          SELECT 1 FROM vr_pcp_fcconsumo proximo
          WHERE proximo.cd_produtopa::TEXT = e.id_mp AND COALESCE(proximo.qt_consumo, 0) > 0
        )
      )
      SELECT
        f.cd_empresa, f.nr_ciclo, f.nr_op, f.dt_inclusao, f.dt_inicio, f.dt_encerramento,
        f.sku_pai, f.referencia, f.produto, f.cor, f.tamanho, f.unidade_medida, f.qtd_op, f.id_mp,
        COALESCE(f_dic_prd_nivel(mp.cd_produto, 'CD'::BPCHAR), f.id_mp)::TEXT AS codigo_mp,
        COALESCE(f_dic_prd_nivel(mp.cd_produto, 'DS'::BPCHAR), mp.nm_produto, f.id_mp)::TEXT AS materia_prima,
        COALESCE(mp.ds_cor, '')::TEXT AS cor_mp,
        COALESCE(mp.ds_tamanho, '')::TEXT AS tamanho_mp,
        COALESCE(f_dic_prd_classificacao(mp.cd_produto, 'DS'::TEXT, 111::BIGINT), '')::TEXT AS artigo_mp,
        COALESCE(conv_mp.unidade_medida, '')::TEXT AS unidade_medida_mp,
        SUM(f.qtd_mp)::FLOAT AS qtd_mp
      FROM folhas f
      LEFT JOIN vr_prd_prdgrade mp ON mp.cd_produto::TEXT = f.id_mp
      LEFT JOIN LATERAL (
        SELECT c.cd_especieconv::TEXT AS unidade_medida
        FROM vr_prd_prdconvmed c
        WHERE c.cd_produto = mp.cd_produto
          AND UPPER(COALESCE(c.in_padrao, '')) IN ('T', 'S', '1', 'TRUE')
        ORDER BY c.in_padrao DESC
        LIMIT 1
      ) conv_mp ON TRUE
      GROUP BY f.cd_empresa, f.nr_ciclo, f.nr_op, f.dt_inclusao, f.dt_inicio, f.dt_encerramento,
        f.sku_pai, f.referencia, f.produto, f.cor, f.tamanho, f.unidade_medida, f.qtd_op, f.id_mp,
        mp.cd_produto, mp.nm_produto, mp.ds_cor, mp.ds_tamanho, conv_mp.unidade_medida,
        f_dic_prd_classificacao(mp.cd_produto, 'DS'::TEXT, 111::BIGINT)
      ORDER BY f.dt_inclusao, f.nr_op, f.referencia, f.sku_pai, artigo_mp, codigo_mp
    `, params);

    const ops = new Map();
    for (const row of result.rows) {
      const opKey = `${row.cd_empresa}|${row.nr_ciclo}|${row.nr_op}`;
      if (!ops.has(opKey)) ops.set(opKey, {
        empresa: row.cd_empresa, ciclo: row.nr_ciclo, op: row.nr_op,
        emitidaEm: row.dt_inclusao, iniciadaEm: row.dt_inicio, encerradaEm: row.dt_encerramento,
        produtos: new Map(),
      });
      const opData = ops.get(opKey);
      const produtoKey = `${row.sku_pai}|${row.referencia}`;
      if (!opData.produtos.has(produtoKey)) opData.produtos.set(produtoKey, {
        sku: row.sku_pai, referencia: row.referencia, produto: row.produto,
        cor: row.cor, tamanho: row.tamanho, unidadeMedida: row.unidade_medida,
        quantidade: Number(row.qtd_op || 0), materiasPrimas: [],
      });
      opData.produtos.get(produtoKey).materiasPrimas.push({
        codigo: row.codigo_mp, id: row.id_mp, nome: row.materia_prima,
        cor: row.cor_mp, tamanho: row.tamanho_mp, artigo: row.artigo_mp,
        unidadeMedida: row.unidade_medida_mp, quantidade: Number(row.qtd_mp || 0),
      });
    }
    const data = Array.from(ops.values()).map((item) => ({ ...item, produtos: Array.from(item.produtos.values()) }));
    return res.json({ success: true, filtros: { de, ate, op, referencia, sku }, totalOps: data.length, data });
  } catch (error) {
    console.error('[relatorio-op-mp] Erro:', error);
    return res.status(500).json({ success: false, error: 'Erro ao gerar relatório de MP da OP', details: error.message });
  }
});

module.exports = router;
