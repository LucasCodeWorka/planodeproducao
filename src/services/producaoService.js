/**
 * Serviço para consultas relacionadas ao planejamento de produção
 */

/**
 * Busca estoque atual de produtos na fábrica
 * @param {Object} pool - Pool de conexão PostgreSQL
 * @param {Object} options - Opções de consulta
 * @returns {Promise<Array>} Lista de produtos com estoque
 */
async function buscarEstoqueFabrica(pool, options = {}) {
  const {
    limit = 100,
    offset = 0,
    cdProduto = null,
    cdEmpresa = '1',
    apenasComEstoque = false
  } = options;

  let query = `
    SELECT
      cd_produto,
      f_dic_sld_prd_produto(
        $1::TEXT,
        '1'::TEXT,
        cd_produto,
        NULL::TIMESTAMP WITHOUT TIME ZONE
      ) AS estoque,
      CURRENT_DATE as data
    FROM vr_prd_prdgrade
    WHERE cd_produto < 1000000
  `;

  const params = [cdEmpresa];
  let paramIndex = 2;

  if (cdProduto !== null) {
    query += ` AND cd_produto = $${paramIndex}`;
    params.push(cdProduto);
    paramIndex++;
  }

  if (apenasComEstoque) {
    query += ` AND f_dic_sld_prd_produto($1::TEXT, '1'::TEXT, cd_produto, NULL::TIMESTAMP WITHOUT TIME ZONE) > 0`;
  }

  query += ` ORDER BY cd_produto LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);

  return result.rows.map(row => ({
    cd_produto: row.cd_produto,
    estoque: parseFloat(row.estoque) || 0,
    data: row.data
  }));
}

/**
 * Busca produtos em processo de produção
 * @param {Object} pool - Pool de conexão PostgreSQL
 * @param {Object} options - Opções de consulta
 * @returns {Promise<Array>} Lista de produtos em processo
 */
async function buscarProdutosEmProcesso(pool, options = {}) {
  const {
    limit = 100,
    offset = 0,
    cdProduto = null,
    cdEmpresa = 1
  } = options;

  let query = `
    SELECT
      aa.cd_produto,
      SUM(
        COALESCE(aa.qt_real, 0)::DOUBLE PRECISION
        - COALESCE(aa.qt_finalizada, 0)::DOUBLE PRECISION
      ) AS qt_em_processo
    FROM
      vr_pcp_opi aa,
      vr_pcp_opc bb
    WHERE
      aa.cd_empresa = $1
      AND aa.cd_empresa = bb.cd_empresa
      AND aa.nr_ciclo = bb.nr_ciclo
      AND aa.nr_op = bb.nr_op
      AND COALESCE(bb.cd_categoria, 0)::BIGINT <> 15
      AND aa.tp_situacao = ANY(ARRAY[5, 10, 15, 20]::BIGINT[])
  `;

  const params = [cdEmpresa];
  let paramIndex = 2;

  if (cdProduto !== null) {
    query += ` AND aa.cd_produto = $${paramIndex}`;
    params.push(cdProduto);
    paramIndex++;
  }

  query += ` GROUP BY aa.cd_produto ORDER BY aa.cd_produto LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);

  return result.rows.map(row => ({
    cd_produto: row.cd_produto,
    qt_em_processo: parseFloat(row.qt_em_processo) || 0
  }));
}

/**
 * Busca pedidos pendentes por produto
 * @param {Object} pool - Pool de conexão PostgreSQL
 * @param {number} cdProduto - Código do produto
 * @param {number} cdEmpresa - Código da empresa
 * @returns {Promise<number>} Quantidade pendente
 */
async function buscarPedidosPendentes(pool, cdProduto, cdEmpresa = 1) {
  const query = `
    SELECT
      COALESCE(SUM(aaa.qt_pendente), 0::DOUBLE PRECISION) AS qt_pendente,
      f_prd_saldo_produto($1::BIGINT, 7::BIGINT, $2::BIGINT, NULL::TIMESTAMP WITHOUT TIME ZONE) AS saldo_adicional
    FROM vr_ped_pedidoi aaa
    WHERE
      aaa.cd_produto = $2
      AND aaa.cd_operacao <> 44::BIGINT
      AND aaa.cd_empresa = $1::BIGINT
      AND aaa.tp_situacao <> 6::BIGINT
  `;

  const result = await pool.query(query, [cdEmpresa, cdProduto]);

  if (result.rows.length === 0) {
    return 0;
  }

  const qtPendente = parseFloat(result.rows[0].qt_pendente) || 0;
  const saldoAdicional = parseFloat(result.rows[0].saldo_adicional) || 0;

  return qtPendente + saldoAdicional;
}

/**
 * Busca catálogo completo de produtos
 * @param {Object} pool - Pool de conexão PostgreSQL
 * @param {Object} options - Opções de consulta
 * @returns {Promise<Array>} Lista de produtos
 */
async function buscarCatalogoProdutos(pool, options = {}) {
  const {
    limit = 100,
    offset = 0,
    cdProduto = null,
    idFamilia = null,
    status = null,
    continuidade = null,
    campos = "completo",
    referencias = []
  } = options;

  const selectBase = campos === "minimos"
    ? `
      SELECT
        a.cd_produto AS idproduto,
        a.ds_cor AS cor,
        a.ds_tamanho AS tamanho,
        f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar) AS referencia,
        f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 802::bigint) AS continuidade,
        f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 27::bigint) AS status
      FROM vr_prd_prdgrade a
      WHERE 1=1
    `
    : `
      SELECT
        a.cd_seqgrupo,
        a.cd_produto AS idproduto,
        a.nm_produto AS apresentacao,
        a.ds_cor AS cor,
        a.ds_tamanho AS tamanho,
        f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar) AS referencia,
        f_dic_prd_nivel(a.cd_produto, 'DS'::bpchar) AS produto,
        f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 27::bigint) AS status,
        f_dic_prd_classificacao(a.cd_produto, 'CD'::text, 24::bigint) AS idfamilia,
        f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 802::bigint) AS continuidade
      FROM vr_prd_prdgrade a
      WHERE 1=1
    `;

  let query = `
    SELECT *
    FROM (
      ${selectBase}
  `;

  const params = [];
  let paramIndex = 1;

  if (cdProduto !== null) {
    query += ` AND a.cd_produto = $${paramIndex}`;
    params.push(cdProduto);
    paramIndex++;
  }

  query += `
    ) catalogo
    WHERE 1=1
  `;

  if (idFamilia !== null) {
    query += ` AND catalogo.idfamilia = $${paramIndex}`;
    params.push(idFamilia);
    paramIndex++;
  }

  if (status !== null) {
    query += ` AND UPPER(TRIM(catalogo.status)) = UPPER(TRIM($${paramIndex}))`;
    params.push(status);
    paramIndex++;
  }

  if (continuidade !== null) {
    query += ` AND catalogo.continuidade = $${paramIndex}`;
    params.push(continuidade);
    paramIndex++;
  }

  if (Array.isArray(referencias) && referencias.length > 0) {
    query += ` AND catalogo.referencia = ANY($${paramIndex})`;
    params.push(referencias);
    paramIndex++;
  }

  query += ` ORDER BY catalogo.idproduto LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);

  return result.rows;
}

/**
 * Busca planejamento completo de produção para um produto
 * Combina: estoque, vendas, pedidos pendentes, em processo
 * @param {Object} pool - Pool de conexão PostgreSQL
 * @param {number} cdProduto - Código do produto
 * @param {number} cdEmpresa - Código da empresa
 * @returns {Promise<Object>} Dados completos de planejamento
 */
async function buscarPlanejamentoProduto(pool, cdProduto, cdEmpresa = 1) {
  // 1. Buscar informações do produto
  const catalogoQuery = `
    SELECT
      a.cd_seqgrupo,
      a.cd_produto AS idproduto,
      a.nm_produto AS apresentacao,
      a.ds_cor AS cor,
      a.ds_tamanho AS tamanho,
      f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar) AS referencia,
      f_dic_prd_nivel(a.cd_produto, 'DS'::bpchar) AS produto,
      f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 27::bigint) AS status,
      f_dic_prd_classificacao(a.cd_produto, 'CD'::text, 24::bigint) AS idfamilia,
      f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 802::bigint) AS continuidade
    FROM vr_prd_prdgrade a
    WHERE a.cd_produto = $1
    LIMIT 1
  `;

  const catalogoResult = await pool.query(catalogoQuery, [cdProduto]);

  if (catalogoResult.rows.length === 0) {
    return null;
  }

  const produto = catalogoResult.rows[0];

  // 2. Buscar estoque
  const estoqueQuery = `
    SELECT
      f_dic_sld_prd_produto($1::TEXT, '1'::TEXT, $2::BIGINT, NULL::TIMESTAMP WITHOUT TIME ZONE) AS estoque
  `;
  const estoqueResult = await pool.query(estoqueQuery, [cdEmpresa.toString(), cdProduto]);
  const estoque = parseFloat(estoqueResult.rows[0].estoque) || 0;

  // 3. Buscar em processo
  const processoQuery = `
    SELECT
      COALESCE(SUM(
        COALESCE(aa.qt_real, 0)::DOUBLE PRECISION
        - COALESCE(aa.qt_finalizada, 0)::DOUBLE PRECISION
      ), 0) AS qt_em_processo
    FROM vr_pcp_opi aa, vr_pcp_opc bb
    WHERE
      aa.cd_empresa = $1
      AND aa.cd_produto = $2
      AND aa.cd_empresa = bb.cd_empresa
      AND aa.nr_ciclo = bb.nr_ciclo
      AND aa.nr_op = bb.nr_op
      AND COALESCE(bb.cd_categoria, 0)::BIGINT <> 15
      AND aa.tp_situacao = ANY(ARRAY[5, 10, 15, 20]::BIGINT[])
  `;
  const processoResult = await pool.query(processoQuery, [cdEmpresa, cdProduto]);
  const emProcesso = parseFloat(processoResult.rows[0].qt_em_processo) || 0;

  // 4. Buscar pedidos pendentes
  const pedidosPendentes = await buscarPedidosPendentes(pool, cdProduto, cdEmpresa);

  // 5. Calcular médias de vendas (importar do vendasService)
  const { buscarProdutoComMedias } = require('./vendasService');
  const { calcularEstoqueMinimo } = require('./estoqueMinimo');

  let dadosVendas = null;
  let estoqueMinimo = null;

  try {
    dadosVendas = await buscarProdutoComMedias(pool, cdProduto, cdEmpresa);

    if (dadosVendas) {
      const calculoEstoque = calcularEstoqueMinimo(
        dadosVendas.media_semestral,
        dadosVendas.media_trimestral
      );
      estoqueMinimo = calculoEstoque;
    }
  } catch (error) {
    // Produto pode não ter histórico de vendas
    console.log(`Produto ${cdProduto} sem histórico de vendas`);
  }

  // 6. Calcular necessidade de produção
  const estoqueDisponivel = estoque + emProcesso;
  const necessidadeTotal = (estoqueMinimo?.estoqueMinimo || 0) + pedidosPendentes;
  const necessidadeProducao = Math.max(0, necessidadeTotal - estoqueDisponivel);

  return {
    produto: {
      ...produto,
      cd_empresa: cdEmpresa
    },
    estoques: {
      estoque_atual: estoque,
      em_processo: emProcesso,
      estoque_disponivel: estoqueDisponivel,
      estoque_minimo: estoqueMinimo?.estoqueMinimo || 0
    },
    demanda: {
      pedidos_pendentes: pedidosPendentes,
      media_vendas_6m: dadosVendas?.media_semestral || 0,
      media_vendas_3m: dadosVendas?.media_trimestral || 0
    },
    planejamento: {
      necessidade_total: necessidadeTotal,
      necessidade_producao: necessidadeProducao,
      situacao: necessidadeProducao > 0 ? 'PRODUZIR' : 'ESTOQUE_OK',
      prioridade: necessidadeProducao > 0
        ? (estoque < (estoqueMinimo?.estoqueMinimo || 0) ? 'ALTA' : 'MEDIA')
        : 'BAIXA'
    },
    calculo_estoque_minimo: estoqueMinimo
  };
}

/**
 * Busca produtos elegiveis para matriz enxuta:
 * - teve venda nos ultimos 12 meses
 * - OU status em linha
 * O filtro de estoque minimo > 0 e aplicado apos calcular planejamento.
 * @param {Object} pool
 * @param {Object} options
 * @returns {Promise<Array>}
 */
async function buscarProdutosElegiveisMatriz(pool, options = {}) {
  const {
    limit = 200,
    offset = 0,
    cdEmpresa = 1
  } = options;

  const query = `
    SELECT *
    FROM (
      SELECT
        a.cd_produto AS idproduto,
        f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar) AS referencia,
        f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 802::bigint) AS continuidade,
        f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 27::bigint) AS status,
        EXISTS (
          SELECT 1
          FROM vr_vendas_qtd v
          WHERE v.idproduto = a.cd_produto
            AND v.idempresa = $1
            AND v.data >= (CURRENT_DATE - INTERVAL '12 months')
        ) AS teve_venda_12m
      FROM vr_prd_prdgrade a
      WHERE a.cd_produto < 1000000
    ) x
    WHERE
      x.teve_venda_12m = TRUE
      OR UPPER(TRIM(COALESCE(x.status, ''))) LIKE 'EM LINHA%'
    ORDER BY x.idproduto
    LIMIT $2 OFFSET $3
  `;

  const result = await pool.query(query, [cdEmpresa, limit, offset]);
  return result.rows;
}

/**
 * Busca matriz de planejamento em consulta agregada (sem N+1).
 * @param {Object} pool
 * @param {Object} options
 * @returns {Promise<Array>}
 */
async function buscarMatrizPlanejamentoRapida(pool, options = {}) {
  const {
    limit = 200,
    offset = 0,
    cdEmpresa = 1
  } = options;

  const query = `
    WITH sales_daily AS (
      SELECT
        v.idproduto::BIGINT AS idproduto,
        DATE(v.data) AS dia,
        SUM(v.qt_liquida)::DOUBLE PRECISION AS qtd_dia
      FROM vr_vendas_qtd v
      WHERE
        v.idempresa = $1
        AND v.data >= (CURRENT_DATE - INTERVAL '12 months')
      GROUP BY v.idproduto, DATE(v.data)
    ),
    sales_stats AS (
      SELECT
        sd.idproduto,
        COUNT(*)::BIGINT AS dias_venda_12m,
        COALESCE(AVG(CASE WHEN sd.dia >= (CURRENT_DATE - INTERVAL '6 months') THEN sd.qtd_dia END), 0)::DOUBLE PRECISION AS media_6m,
        COALESCE(AVG(CASE WHEN sd.dia >= (CURRENT_DATE - INTERVAL '3 months') THEN sd.qtd_dia END), 0)::DOUBLE PRECISION AS media_3m
      FROM sales_daily sd
      GROUP BY sd.idproduto
    ),
    base AS (
      SELECT
        a.cd_seqgrupo,
        a.cd_produto::BIGINT AS idproduto,
        a.nm_produto AS apresentacao,
        a.ds_cor AS cor,
        a.ds_tamanho AS tamanho,
        f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar) AS referencia,
        f_dic_prd_nivel(a.cd_produto, 'DS'::bpchar) AS produto,
        f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 27::bigint) AS status,
        f_dic_prd_classificacao(a.cd_produto, 'CD'::text, 24::bigint) AS idfamilia,
        f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 802::bigint) AS continuidade
      FROM vr_prd_prdgrade a
      WHERE a.cd_produto < 1000000
    ),
    candidatos AS (
      SELECT
        b.*,
        COALESCE(ss.dias_venda_12m, 0) AS dias_venda_12m,
        COALESCE(ss.media_6m, 0) AS media_6m,
        COALESCE(ss.media_3m, 0) AS media_3m
      FROM base b
      LEFT JOIN sales_stats ss ON ss.idproduto = b.idproduto
      WHERE
        COALESCE(ss.dias_venda_12m, 0) > 0
        OR UPPER(TRIM(COALESCE(b.status, ''))) LIKE 'EM LINHA%'
      ORDER BY b.idproduto
      LIMIT $2 OFFSET $3
    ),
    em_processo AS (
      SELECT
        aa.cd_produto::BIGINT AS cd_produto,
        COALESCE(SUM(
          COALESCE(aa.qt_real, 0)::DOUBLE PRECISION
          - COALESCE(aa.qt_finalizada, 0)::DOUBLE PRECISION
        ), 0)::DOUBLE PRECISION AS qt_em_processo
      FROM vr_pcp_opi aa
      JOIN vr_pcp_opc bb
        ON aa.cd_empresa = bb.cd_empresa
       AND aa.nr_ciclo = bb.nr_ciclo
       AND aa.nr_op = bb.nr_op
      WHERE
        aa.cd_empresa = $1
        AND COALESCE(bb.cd_categoria, 0)::BIGINT <> 15
        AND aa.tp_situacao = ANY(ARRAY[5, 10, 15, 20]::BIGINT[])
      GROUP BY aa.cd_produto
    ),
    pedidos AS (
      SELECT
        p.cd_produto::BIGINT AS cd_produto,
        COALESCE(SUM(p.qt_pendente), 0)::DOUBLE PRECISION AS qt_pendente
      FROM vr_ped_pedidoi p
      WHERE
        p.cd_empresa = $1
        AND p.cd_operacao <> 44::BIGINT
        AND p.tp_situacao <> 6::BIGINT
      GROUP BY p.cd_produto
    )
    SELECT
      c.*,
      f_dic_sld_prd_produto(
        $1::TEXT,
        '1'::TEXT,
        c.idproduto,
        NULL::TIMESTAMP WITHOUT TIME ZONE
      )::DOUBLE PRECISION AS estoque_atual,
      COALESCE(ep.qt_em_processo, 0)::DOUBLE PRECISION AS em_processo,
      (
        COALESCE(p.qt_pendente, 0)::DOUBLE PRECISION
        + COALESCE(
          f_prd_saldo_produto(
            $1::BIGINT,
            7::BIGINT,
            c.idproduto,
            NULL::TIMESTAMP WITHOUT TIME ZONE
          )::DOUBLE PRECISION,
          0
        )
      )::DOUBLE PRECISION AS pedidos_pendentes
    FROM candidatos c
    LEFT JOIN em_processo ep ON ep.cd_produto = c.idproduto
    LEFT JOIN pedidos p ON p.cd_produto = c.idproduto
    ORDER BY c.idproduto
  `;

  const result = await pool.query(query, [cdEmpresa, limit, offset]);
  const { calcularEstoqueMinimo } = require('./estoqueMinimo');

  return result.rows.map((row) => {
    const media6m = parseFloat(row.media_6m) || 0;
    const media3m = parseFloat(row.media_3m) || 0;
    const estoqueAtual = parseFloat(row.estoque_atual) || 0;
    const emProcesso = parseFloat(row.em_processo) || 0;
    const pedidosPendentes = parseFloat(row.pedidos_pendentes) || 0;
    const diasVenda12m = Number(row.dias_venda_12m) || 0;

    const calculo = calcularEstoqueMinimo(media6m, media3m);
    const estoqueMinimo = calculo.estoqueMinimo || 0;
    const estoqueDisponivel = estoqueAtual + emProcesso;
    const necessidadeTotal = estoqueMinimo + pedidosPendentes;
    const necessidadeProducao = Math.max(0, necessidadeTotal - estoqueDisponivel);
    const status = (row.status || "").trim().toUpperCase();
    const emLinha = status.startsWith("EM LINHA");
    const teveVenda12m = diasVenda12m > 0;
    const estoqueMinimoPositivo = estoqueMinimo > 0;

    return {
      produto: {
        cd_seqgrupo: row.cd_seqgrupo,
        idproduto: String(row.idproduto),
        apresentacao: row.apresentacao,
        cor: row.cor,
        tamanho: row.tamanho,
        referencia: row.referencia,
        produto: row.produto,
        status: row.status,
        idfamilia: row.idfamilia,
        continuidade: row.continuidade,
        cd_empresa: cdEmpresa
      },
      estoques: {
        estoque_atual: estoqueAtual,
        em_processo: emProcesso,
        estoque_disponivel: estoqueDisponivel,
        estoque_minimo: estoqueMinimo
      },
      demanda: {
        pedidos_pendentes: pedidosPendentes,
        media_vendas_6m: media6m,
        media_vendas_3m: media3m
      },
      planejamento: {
        necessidade_total: necessidadeTotal,
        necessidade_producao: necessidadeProducao,
        situacao: necessidadeProducao > 0 ? 'PRODUZIR' : 'ESTOQUE_OK',
        prioridade: necessidadeProducao > 0
          ? (estoqueAtual < estoqueMinimo ? 'ALTA' : 'MEDIA')
          : 'BAIXA'
      },
      calculo_estoque_minimo: calculo,
      criterios: {
        teve_venda_12m: teveVenda12m,
        status_em_linha: emLinha,
        estoque_minimo_positivo: estoqueMinimoPositivo
      }
    };
  });
}

module.exports = {
  buscarEstoqueFabrica,
  buscarProdutosEmProcesso,
  buscarPedidosPendentes,
  buscarCatalogoProdutos,
  buscarPlanejamentoProduto,
  buscarProdutosElegiveisMatriz,
  buscarMatrizPlanejamentoRapida
};
