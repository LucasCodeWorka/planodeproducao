/**
 * Serviço para consultas relacionadas ao planejamento de produção
 */

const { buscarProdutoComMedias } = require('./vendasService');
const { calcularEstoqueMinimo } = require('./estoqueMinimo');

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
        AND UPPER(COALESCE(a.nm_produto, '')) NOT LIKE '%MEIA DE SEDA%'
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
        AND UPPER(COALESCE(a.nm_produto, '')) NOT LIKE '%MEIA DE SEDA%'
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
      AND UPPER(COALESCE(a.nm_produto, '')) NOT LIKE '%MEIA DE SEDA%'
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

  // 5. Calcular médias de vendas
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
 * Busca matriz de planejamento usando consultas paralelas.
 *
 * Estratégia em 2 fases:
 *   Fase 1 (paralelas): filtro de marca/refs (lento, ~28s) + em_processo + pedidos (rápidos)
 *   Fase 2 (paralelas): classificações e estoque apenas para os IDs filtrados (rápidos)
 *
 * @param {Object} pool
 * @param {Object} options
 * @returns {Promise<Array>}
 */
async function buscarMatrizPlanejamentoRapida(pool, options = {}) {
  const {
    cdEmpresa = 1,
    marca     = null,
    status    = null,
    referencias = []
  } = options;

  const t0 = Date.now();

  // ── Fase 1: filtrar produtos (lento) + agregações independentes (rápido) ──
  const paramsF1 = [];
  let   whereF1  = `WHERE a.cd_produto < 1000000
    AND UPPER(COALESCE(a.nm_produto, '')) NOT LIKE '%MEIA DE SEDA%'`;

  if (marca) {
    paramsF1.push(marca);
    whereF1 += ` AND f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 20::bigint) = $${paramsF1.length}`;
  }
  if (status) {
    paramsF1.push(status);
    whereF1 += ` AND UPPER(TRIM(COALESCE(f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 27::bigint), ''))) LIKE UPPER(TRIM($${paramsF1.length})) || '%'`;
  }
  if (Array.isArray(referencias) && referencias.length > 0) {
    paramsF1.push(referencias);
    whereF1 += ` AND f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar) = ANY($${paramsF1.length})`;
  }

  console.log(`[matriz/paralela] Fase 1 — filtro: marca=${marca}, status=${status}, refs=${referencias}`);

  const [rProdutos, rEmProcesso, rPedidos, rPlano] = await Promise.all([
    // Q1 – Produtos filtrados (1 função por linha — lento)
    pool.query(
      `SELECT a.cd_produto::BIGINT AS idproduto, a.cd_seqgrupo,
              a.nm_produto AS apresentacao, a.ds_cor AS cor, a.ds_tamanho AS tamanho
       FROM vr_prd_prdgrade a ${whereF1}
       ORDER BY a.cd_produto`,
      paramsF1
    ),
    // Q2 – Em processo (sem função — rápido)
    pool.query(
      `SELECT aa.cd_produto::BIGINT AS idproduto,
              COALESCE(SUM(
                COALESCE(aa.qt_real,0)::FLOAT - COALESCE(aa.qt_finalizada,0)::FLOAT
              ), 0)::FLOAT AS qt_em_processo
       FROM vr_pcp_opi aa
       JOIN vr_pcp_opc bb
         ON aa.cd_empresa=bb.cd_empresa AND aa.nr_ciclo=bb.nr_ciclo AND aa.nr_op=bb.nr_op
       WHERE aa.cd_empresa=$1
         AND COALESCE(bb.cd_categoria,0)::BIGINT <> 15
         AND aa.tp_situacao = ANY(ARRAY[5,10,15,20]::BIGINT[])
       GROUP BY aa.cd_produto`,
      [cdEmpresa]
    ),
    // Q3 – Pedidos qt_pendente (sem função — rápido)
    pool.query(
      `SELECT p.cd_produto::BIGINT AS idproduto,
              COALESCE(SUM(p.qt_pendente), 0)::FLOAT AS qt_pendente
       FROM vr_ped_pedidoi p
       WHERE p.cd_empresa=$1
         AND p.cd_operacao <> 44
         AND p.tp_situacao <> 6
       GROUP BY p.cd_produto`,
      [cdEmpresa]
    ),
    // Q4_ph1 – Plano de produção futuro (MA=mês atual, PX=próximo, UL=seguinte)
    pool.query(
      `SELECT a.cd_produto::BIGINT AS idproduto,
              p.cd_auxiliar,
              COALESCE(SUM(GREATEST(a.qt_lote - a.qt_gerouop, 0)), 0)::FLOAT AS plano
       FROM vr_pcp_lotepl2 a
       LEFT JOIN pcp_lotepv p ON a.nr_lote = p.nr_lote
       WHERE p.tp_situacao = 1
         AND p.cd_auxiliar IN ('MA', 'PX', 'UL')
       GROUP BY a.cd_produto, p.cd_auxiliar`,
      []
    ),
  ]);

  const ids = rProdutos.rows.map(r => Number(r.idproduto));
  console.log(`[matriz/paralela] Fase 1 concluída em ${((Date.now()-t0)/1000).toFixed(1)}s — ${ids.length} produtos`);

  if (ids.length === 0) return [];

  // ── Períodos fixos para cálculo de estoque mínimo ────────────────────────
  // Semestral: mesmo semestre do ANO ANTERIOR (ex: março/2026 → H1 2025 = jan–jun/2025)
  // 3M: últimos 3 meses FECHADOS, sem o mês corrente (ex: março/2026 → dez/jan/fev)
  const hoje      = new Date();
  const anoAtual  = hoje.getFullYear();
  const mesAtual  = hoje.getMonth();           // 0=jan … 11=dez

  const ehH1      = mesAtual < 6;              // jan–jun = H1, jul–dez = H2
  const anoSem    = anoAtual - 1;
  const inicioSem = new Date(anoSem, ehH1 ? 0 : 6,  1);  // jan ou jul do ano anterior
  const fimSem    = new Date(anoSem, ehH1 ? 6 : 12, 1);  // jul ou jan do ano anterior + 6 meses

  const inicio3m  = new Date(anoAtual, mesAtual - 3, 1);  // 3 meses atrás, dia 1 (JS corrige mês negativo)
  const fim3m     = new Date(anoAtual, mesAtual,     1);  // início do mês corrente (exclusive)

  const inicio12m = new Date(anoAtual, mesAtual - 12, 1); // para filtro "teve vendas nos últimos 12m"

  // A query de vendas precisa cobrir o período mais antigo entre semestral e 12m
  const inicioVendasQuery = new Date(Math.min(inicioSem.getTime(), inicio12m.getTime()));

  console.log(`[períodos] Semestral : ${inicioSem.toISOString().slice(0,10)} → ${new Date(fimSem - 1).toISOString().slice(0,10)}`);
  console.log(`[períodos] 3M fechado: ${inicio3m.toISOString().slice(0,10)} → ${new Date(fim3m - 1).toISOString().slice(0,10)}`);

  // ── Fase 2: classificações + estoque + vendas em paralelo (só para os IDs) ─
  const t1 = Date.now();
  console.log(`[matriz/paralela] Fase 2 — ${ids.length} IDs, 8 consultas paralelas`);

  const [rRef, rProd, rStatus, rFamilia, rCont, rLinha, rGrupo, rEstoque, rSaldo, rVendas] =
    await Promise.all([
      // Q4 – referencia
      pool.query(
        `SELECT cd_produto::BIGINT AS idproduto,
                f_dic_prd_nivel(cd_produto,'CD'::bpchar) AS referencia
         FROM vr_prd_prdgrade WHERE cd_produto = ANY($1)`,
        [ids]
      ),
      // Q5 – nome do produto
      pool.query(
        `SELECT cd_produto::BIGINT AS idproduto,
                f_dic_prd_nivel(cd_produto,'DS'::bpchar) AS produto
         FROM vr_prd_prdgrade WHERE cd_produto = ANY($1)`,
        [ids]
      ),
      // Q6 – status
      pool.query(
        `SELECT cd_produto::BIGINT AS idproduto,
                f_dic_prd_classificacao(cd_produto,'DS'::text,27::bigint) AS status
         FROM vr_prd_prdgrade WHERE cd_produto = ANY($1)`,
        [ids]
      ),
      // Q7 – idfamilia
      pool.query(
        `SELECT cd_produto::BIGINT AS idproduto,
                f_dic_prd_classificacao(cd_produto,'DS'::text,24::bigint) AS idfamilia
         FROM vr_prd_prdgrade WHERE cd_produto = ANY($1)`,
        [ids]
      ),
      // Q8 – continuidade
      pool.query(
        `SELECT cd_produto::BIGINT AS idproduto,
                f_dic_prd_classificacao(cd_produto,'DS'::text,802::bigint) AS continuidade
         FROM vr_prd_prdgrade WHERE cd_produto = ANY($1)`,
        [ids]
      ),
      // Q8.1 – linha
      pool.query(
        `SELECT cd_produto::BIGINT AS idproduto,
                f_dic_prd_classificacao(cd_produto,'DS'::text,23::bigint) AS linha
         FROM vr_prd_prdgrade WHERE cd_produto = ANY($1)`,
        [ids]
      ),
      // Q8.2 – grupo
      pool.query(
        `SELECT cd_produto::BIGINT AS idproduto,
                f_dic_prd_classificacao(cd_produto,'DS'::text,25::bigint) AS grupo
         FROM vr_prd_prdgrade WHERE cd_produto = ANY($1)`,
        [ids]
      ),
      // Q9 – estoque atual
      pool.query(
        `SELECT cd_produto::BIGINT AS idproduto,
                COALESCE(f_dic_sld_prd_produto(
                  $1::TEXT,'1'::TEXT,cd_produto,NULL::TIMESTAMP WITHOUT TIME ZONE
                )::FLOAT, 0) AS estoque
         FROM vr_prd_prdgrade WHERE cd_produto = ANY($2)`,
        [String(cdEmpresa), ids]
      ),
      // Q10 – saldo adicional pedidos
      pool.query(
        `SELECT cd_produto::BIGINT AS idproduto,
                COALESCE(f_prd_saldo_produto(
                  $1::BIGINT,7::BIGINT,cd_produto,NULL::TIMESTAMP WITHOUT TIME ZONE
                )::FLOAT, 0) AS saldo
         FROM vr_prd_prdgrade WHERE cd_produto = ANY($2)`,
        [cdEmpresa, ids]
      ),
      // Q11 – vendas cobrindo semestral + 3m + 12m (filtradas pelos IDs, todas as empresas)
      pool.query(
        `SELECT v.idproduto::BIGINT AS idproduto,
                DATE(v.data) AS dia,
                SUM(v.qt_liquida)::FLOAT AS qtd
         FROM vr_vendas_qtd v
         WHERE v.data >= $2
           AND v.idproduto = ANY($1)
         GROUP BY v.idproduto, DATE(v.data)`,
        [ids, inicioVendasQuery]
      ),
    ]);

  console.log(`[matriz/paralela] Fase 2 concluída em ${((Date.now()-t1)/1000).toFixed(1)}s`);

  // ── Maps de lookup ────────────────────────────────────────────────────────
  const refMap    = new Map(rRef.rows.map(r    => [Number(r.idproduto), r.referencia]));
  const prodMap   = new Map(rProd.rows.map(r   => [Number(r.idproduto), r.produto]));
  const statusMap = new Map(rStatus.rows.map(r => [Number(r.idproduto), r.status]));
  const famMap    = new Map(rFamilia.rows.map(r=> [Number(r.idproduto), r.idfamilia]));
  const contMap   = new Map(rCont.rows.map(r   => [Number(r.idproduto), r.continuidade]));
  const linhaMap  = new Map(rLinha.rows.map(r  => [Number(r.idproduto), r.linha]));
  const grupoMap  = new Map(rGrupo.rows.map(r  => [Number(r.idproduto), r.grupo]));
  const estMap    = new Map(rEstoque.rows.map(r=> [Number(r.idproduto), parseFloat(r.estoque) || 0]));
  const saldoMap  = new Map(rSaldo.rows.map(r  => [Number(r.idproduto), parseFloat(r.saldo)  || 0]));
  const emprocMap = new Map(rEmProcesso.rows.map(r => [Number(r.idproduto), parseFloat(r.qt_em_processo) || 0]));
  const pedMap    = new Map(rPedidos.rows.map(r    => [Number(r.idproduto), parseFloat(r.qt_pendente)    || 0]));

  // Plano de produção: { MA, PX, UL } por produto
  const planoMap  = new Map();
  for (const row of rPlano.rows) {
    const id  = Number(row.idproduto);
    const per = String(row.cd_auxiliar || '').trim().toUpperCase();
    if (!planoMap.has(id)) planoMap.set(id, { MA: 0, PX: 0, UL: 0 });
    if (per === 'MA' || per === 'PX' || per === 'UL') {
      planoMap.get(id)[per] = parseFloat(row.plano) || 0;
    }
  }

  // ── Vendas: stats por produto com períodos fixos ─────────────────────────
  const tInicioSem = inicioSem.getTime();
  const tFimSem    = fimSem.getTime();
  const tInicio3m  = inicio3m.getTime();
  const tFim3m     = fim3m.getTime();
  const tInicio12m = inicio12m.getTime();

  const salesMap = new Map();
  for (const row of rVendas.rows) {
    const id  = Number(row.idproduto);
    const dia = new Date(row.dia).getTime();
    const qtd = parseFloat(row.qtd) || 0;
    let s = salesMap.get(id);
    if (!s) { s = { total12m: 0, sumSem: 0, cntSem: 0, sum3m: 0, cnt3m: 0 }; salesMap.set(id, s); }
    if (dia >= tInicio12m)                          s.total12m++;
    if (dia >= tInicioSem && dia < tFimSem)  { s.sumSem += qtd; s.cntSem++; }
    if (dia >= tInicio3m  && dia < tFim3m)   { s.sum3m  += qtd; s.cnt3m++;  }
  }

  // ── Montar resultado ──────────────────────────────────────────────────────
  const resultado = [];

  for (const row of rProdutos.rows) {
    const id     = Number(row.idproduto);
    const status = (statusMap.get(id) || '').trim().toUpperCase();
    const emLinha = status.startsWith('EM LINHA');

    const s              = salesMap.get(id);
    const diasVenda12m   = s ? s.total12m : 0;
    const mediaSemestral = s ? s.sumSem / 6 : 0;  // média mensal do semestre (total ÷ 6 meses)
    const media3m        = s ? s.sum3m  / 3 : 0;  // média mensal dos 3 meses fechados (total ÷ 3 meses)

    // Filtro: precisa ter vendas nos últimos 12m OU estar em linha
    if (!diasVenda12m && !emLinha) continue;

    const estoqueAtual     = estMap.get(id)    || 0;
    const emProcesso       = emprocMap.get(id) || 0;
    const qtPendente       = pedMap.get(id)    || 0;
    const saldoAdicional   = saldoMap.get(id)  || 0;
    const pedidosPendentes = qtPendente + saldoAdicional;
    const estoqueDisponivel = estoqueAtual + emProcesso;

    const calculo             = calcularEstoqueMinimo(mediaSemestral, media3m);
    const estoqueMinimo       = calculo.estoqueMinimo || 0;
    const necessidadeTotal    = estoqueMinimo + pedidosPendentes;
    const necessidadeProducao = Math.max(0, necessidadeTotal - estoqueDisponivel);

    resultado.push({
      produto: {
        cd_seqgrupo:  row.cd_seqgrupo,
        idproduto:    String(id),
        apresentacao: row.apresentacao,
        cor:          row.cor,
        tamanho:      row.tamanho,
        referencia:   refMap.get(id)  || null,
        produto:      prodMap.get(id) || null,
        status:       statusMap.get(id) || null,
        idfamilia:    famMap.get(id)  || null,
        continuidade: contMap.get(id) || null,
        linha:        linhaMap.get(id) || null,
        grupo:        grupoMap.get(id) || null,
        marca:        marca           || null,
        cd_empresa:   cdEmpresa
      },
      estoques: {
        estoque_atual:      estoqueAtual,
        em_processo:        emProcesso,
        estoque_disponivel: estoqueDisponivel,
        estoque_minimo:     estoqueMinimo
      },
      demanda: {
        pedidos_pendentes:   pedidosPendentes,
        media_vendas_6m:     mediaSemestral,   // semestre fixo do ano anterior
        media_vendas_3m:     media3m           // últimos 3 meses fechados
      },
      plano: {
        ma: planoMap.get(id)?.MA || 0,   // mês atual
        px: planoMap.get(id)?.PX || 0,   // próximo mês
        ul: planoMap.get(id)?.UL || 0    // mês seguinte
      },
      planejamento: {
        necessidade_total:    necessidadeTotal,
        necessidade_producao: necessidadeProducao,
        situacao:   necessidadeProducao > 0 ? 'PRODUZIR' : 'ESTOQUE_OK',
        prioridade: necessidadeProducao > 0
          ? (estoqueAtual < estoqueMinimo ? 'ALTA' : 'MEDIA')
          : 'BAIXA'
      },
      calculo_estoque_minimo: calculo,
      criterios: {
        teve_venda_12m:          diasVenda12m > 0,
        status_em_linha:         emLinha,
        estoque_minimo_positivo: estoqueMinimo > 0
      }
    });
  }

  console.log(`[matriz/paralela] Total: ${((Date.now()-t0)/1000).toFixed(1)}s — ${resultado.length} produtos retornados`);
  return resultado;
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
