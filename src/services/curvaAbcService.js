function buildCurvaAbcQuery() {
  return `
    WITH referencias_validas AS (
      SELECT DISTINCT
        f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar) AS referencia
      FROM vr_prd_prdgrade a
      WHERE UPPER(TRIM(COALESCE(f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 20::bigint), ''))) = 'LIEBE'
        AND UPPER(TRIM(COALESCE(f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 27::bigint), ''))) IN ('EM LINHA', 'NOVA COLECAO')
        AND UPPER(COALESCE(a.nm_produto, '')) NOT LIKE '%MEIA DE SEDA%'
        AND UPPER(TRIM(COALESCE(a.ds_tamanho, ''))) <> 'PT 99'
        AND f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar) IS NOT NULL
        AND f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar) != ''
        AND UPPER(TRIM(f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar))) NOT LIKE 'PT%'
    ),
    sku_por_referencia AS (
      SELECT
        f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar) AS referencia,
        COUNT(DISTINCT a.cd_produto)::INT AS qtd_skus
      FROM vr_prd_prdgrade a
      WHERE UPPER(TRIM(COALESCE(f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 20::bigint), ''))) = 'LIEBE'
        AND UPPER(TRIM(COALESCE(f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 27::bigint), ''))) IN ('EM LINHA', 'NOVA COLECAO')
        AND UPPER(COALESCE(a.nm_produto, '')) NOT LIKE '%MEIA DE SEDA%'
        AND UPPER(TRIM(COALESCE(a.ds_tamanho, ''))) <> 'PT 99'
        AND f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar) IS NOT NULL
        AND f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar) != ''
        AND UPPER(TRIM(f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar))) NOT LIKE 'PT%'
      GROUP BY f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar)
    ),
    vendas_qtd AS (
      SELECT
        f_dic_prd_nivel(v.idproduto, 'CD'::bpchar) AS referencia,
        SUM(v.qt_liquida) AS total_qty,
        COUNT(DISTINCT DATE(v.data)) AS dias_com_vendas
      FROM vr_vendas_qtd v
      INNER JOIN referencias_validas rv
        ON rv.referencia = f_dic_prd_nivel(v.idproduto, 'CD'::bpchar)
      WHERE v.data >= CURRENT_DATE - INTERVAL '90 days'
        AND v.idempresa = 1
      GROUP BY f_dic_prd_nivel(v.idproduto, 'CD'::bpchar)
    ),
    vendas_valor AS (
      SELECT
        f_dic_prd_nivel(v.idproduto, 'CD'::bpchar) AS referencia,
        SUM(v.valor) AS total_valor
      FROM vr_vendas_valor v
      INNER JOIN referencias_validas rv
        ON rv.referencia = f_dic_prd_nivel(v.idproduto, 'CD'::bpchar)
      WHERE v.data >= CURRENT_DATE - INTERVAL '90 days'
        AND v.idempresa = 1
      GROUP BY f_dic_prd_nivel(v.idproduto, 'CD'::bpchar)
    ),
    combinado AS (
      SELECT
        COALESCE(q.referencia, val.referencia) AS referencia,
        COALESCE(q.total_qty, 0) AS total_qty,
        COALESCE(val.total_valor, 0) AS total_valor,
        COALESCE(q.dias_com_vendas, 0) AS dias_com_vendas,
        COALESCE(sku.qtd_skus, 0) AS qtd_skus
      FROM vendas_qtd q
      FULL OUTER JOIN vendas_valor val ON q.referencia = val.referencia
      LEFT JOIN sku_por_referencia sku
        ON sku.referencia = COALESCE(q.referencia, val.referencia)
      WHERE COALESCE(q.total_qty, 0) > 0 OR COALESCE(val.total_valor, 0) > 0
    ),
    ranked AS (
      SELECT
        referencia,
        total_qty,
        total_valor,
        dias_com_vendas,
        qtd_skus,
        ROW_NUMBER() OVER (ORDER BY total_qty DESC) AS rank_qty,
        ROW_NUMBER() OVER (ORDER BY total_valor DESC) AS rank_valor,
        COUNT(*) OVER () AS total_refs
      FROM combinado
    ),
    com_curva AS (
      SELECT
        r.*,
        CASE
          WHEN r.rank_qty <= 30 OR r.rank_valor <= 30 THEN 'A'
          WHEN r.rank_qty > r.total_refs - 20 THEN 'C'
          ELSE 'B'
        END AS curva,
        (r.rank_qty <= 30) AS top30_qtd,
        (r.rank_valor <= 30) AS top30_valor
      FROM ranked r
    )
    SELECT * FROM com_curva
    ORDER BY rank_qty
  `;
}

function mapCurvaPayload(rows) {
  const curvaA = [];
  const curvaB = [];
  const curvaC = [];
  const porReferencia = {};

  let top30ApenasQtd = 0;
  let top30ApenasValor = 0;
  let top30Ambos = 0;

  for (const row of rows) {
    const ref = String(row.referencia || '').trim().toUpperCase();
    if (!ref) continue;

    const isTop30Qtd = row.top30_qtd === true;
    const isTop30Valor = row.top30_valor === true;

    if (isTop30Qtd && isTop30Valor) top30Ambos += 1;
    else if (isTop30Qtd) top30ApenasQtd += 1;
    else if (isTop30Valor) top30ApenasValor += 1;

    const item = {
      referencia: ref,
      totalQtd: Number(row.total_qty) || 0,
      totalValor: Number(row.total_valor) || 0,
      diasComVendas: Number(row.dias_com_vendas) || 0,
      qtdSkus: Number(row.qtd_skus) || 0,
      mediaQtdPorSku: (Number(row.qtd_skus) || 0) > 0 ? (Number(row.total_qty) || 0) / Number(row.qtd_skus) : 0,
      rankQtd: Number(row.rank_qty) || 0,
      rankValor: Number(row.rank_valor) || 0,
      curva: row.curva,
      top30Qtd: isTop30Qtd,
      top30Valor: isTop30Valor
    };

    porReferencia[ref] = row.curva;

    if (row.curva === 'A') curvaA.push(item);
    else if (row.curva === 'C') curvaC.push(item);
    else curvaB.push(item);
  }

  curvaA.sort((a, b) => a.rankQtd - b.rankQtd);

  return {
    success: true,
    totalReferencias: rows.length,
    resumo: {
      curvaA: curvaA.length,
      curvaB: curvaB.length,
      curvaC: curvaC.length
    },
    estatisticas: {
      top30ApenasQtd,
      top30ApenasValor,
      top30Ambos,
      sobreposicaoPerc: curvaA.length > 0 ? ((top30Ambos / curvaA.length) * 100).toFixed(1) : '0'
    },
    porReferencia,
    detalhes: {
      curvaA,
      curvaB,
      curvaC
    }
  };
}

async function calcularCurvaAbcReferencias(pool) {
  const result = await pool.query(buildCurvaAbcQuery());
  return mapCurvaPayload(result.rows || []);
}

module.exports = {
  calcularCurvaAbcReferencias
};
