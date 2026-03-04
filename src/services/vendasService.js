/**
 * Serviço para consultas e cálculos relacionados a vendas
 */

/**
 * Calcula a média de vendas por dia para um produto em um período específico
 * @param {Object} pool - Pool de conexão do PostgreSQL
 * @param {number} idProduto - ID do produto
 * @param {number} meses - Número de meses para considerar (3 ou 6)
 * @param {number} idEmpresa - ID da empresa (opcional)
 * @returns {Promise<number>} Média de vendas por dia
 */
async function calcularMediaVendasPorDia(pool, idProduto, meses, idEmpresa = null) {
  const dataInicio = new Date();
  dataInicio.setMonth(dataInicio.getMonth() - meses);

  let query = `
    SELECT
      COALESCE(AVG(vendas_diarias.total_dia), 0) as media_por_dia
    FROM (
      SELECT
        DATE(data) as data_venda,
        SUM(qt_liquida) as total_dia
      FROM vr_vendas_qtd
      WHERE idproduto = $1
        AND data >= $2
  `;

  const params = [idProduto, dataInicio];
  let paramIndex = 3;

  if (idEmpresa !== null) {
    query += ` AND idempresa = $${paramIndex}`;
    params.push(idEmpresa);
    paramIndex++;
  }

  query += `
      GROUP BY DATE(data)
    ) vendas_diarias
  `;

  const result = await pool.query(query, params);
  return parseFloat(result.rows[0].media_por_dia) || 0;
}

/**
 * Busca dados de vendas com médias calculadas para múltiplos produtos
 * @param {Object} pool - Pool de conexão do PostgreSQL
 * @param {Object} options - Opções de consulta
 * @returns {Promise<Array>} Array com produtos e suas médias
 */
async function buscarVendasComMedias(pool, options = {}) {
  const {
    limit = 100,
    offset = 0,
    idProduto = null,
    idEmpresa = null
  } = options;

  // Query para buscar produtos únicos
  let queryProdutos = `
    SELECT DISTINCT
      idproduto,
      idempresa
    FROM vr_vendas_qtd
    WHERE 1=1
  `;

  const params = [];
  let paramIndex = 1;

  if (idProduto !== null) {
    queryProdutos += ` AND idproduto = $${paramIndex}`;
    params.push(idProduto);
    paramIndex++;
  }

  if (idEmpresa !== null) {
    queryProdutos += ` AND idempresa = $${paramIndex}`;
    params.push(idEmpresa);
    paramIndex++;
  }

  queryProdutos += ` ORDER BY idproduto LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(limit, offset);

  const produtos = await pool.query(queryProdutos, params);

  // Calcular médias para cada produto
  const resultados = await Promise.all(
    produtos.rows.map(async (produto) => {
      const mediaTrimestral = await calcularMediaVendasPorDia(
        pool,
        produto.idproduto,
        3,
        produto.idempresa
      );

      const mediaSemestral = await calcularMediaVendasPorDia(
        pool,
        produto.idproduto,
        6,
        produto.idempresa
      );

      return {
        idproduto: produto.idproduto,
        idempresa: produto.idempresa,
        media_trimestral: mediaTrimestral,
        media_semestral: mediaSemestral
      };
    })
  );

  return resultados;
}

/**
 * Busca dados de um produto específico com médias calculadas
 * @param {Object} pool - Pool de conexão do PostgreSQL
 * @param {number} idProduto - ID do produto
 * @param {number} idEmpresa - ID da empresa (opcional)
 * @returns {Promise<Object|null>} Dados do produto ou null se não encontrado
 */
async function buscarProdutoComMedias(pool, idProduto, idEmpresa = null) {
  // Verificar se produto existe
  let queryExiste = `
    SELECT DISTINCT idproduto, idempresa
    FROM vr_vendas_qtd
    WHERE idproduto = $1
  `;

  const params = [idProduto];

  if (idEmpresa !== null) {
    queryExiste += ` AND idempresa = $2`;
    params.push(idEmpresa);
  }

  queryExiste += ` LIMIT 1`;

  const existe = await pool.query(queryExiste, params);

  if (existe.rows.length === 0) {
    return null;
  }

  const produto = existe.rows[0];

  // Calcular médias
  const mediaTrimestral = await calcularMediaVendasPorDia(
    pool,
    produto.idproduto,
    3,
    produto.idempresa
  );

  const mediaSemestral = await calcularMediaVendasPorDia(
    pool,
    produto.idproduto,
    6,
    produto.idempresa
  );

  return {
    idproduto: produto.idproduto,
    idempresa: produto.idempresa,
    media_trimestral: mediaTrimestral,
    media_semestral: mediaSemestral
  };
}

/**
 * Busca estatísticas detalhadas de vendas de um produto
 * @param {Object} pool - Pool de conexão do PostgreSQL
 * @param {number} idProduto - ID do produto
 * @param {number} idEmpresa - ID da empresa (opcional)
 * @returns {Promise<Object>} Estatísticas detalhadas
 */
async function buscarEstatisticasProduto(pool, idProduto, idEmpresa = null) {
  const dataInicio6Meses = new Date();
  dataInicio6Meses.setMonth(dataInicio6Meses.getMonth() - 6);

  const dataInicio3Meses = new Date();
  dataInicio3Meses.setMonth(dataInicio3Meses.getMonth() - 3);

  let query = `
    SELECT
      -- Dados gerais
      COUNT(*) as total_vendas,
      SUM(qt_liquida) as quantidade_total,
      MIN(data) as primeira_venda,
      MAX(data) as ultima_venda,

      -- Últimos 6 meses
      SUM(CASE WHEN data >= $2 THEN qt_liquida ELSE 0 END) as qtd_6_meses,
      COUNT(CASE WHEN data >= $2 THEN 1 END) as dias_vendas_6_meses,

      -- Últimos 3 meses
      SUM(CASE WHEN data >= $3 THEN qt_liquida ELSE 0 END) as qtd_3_meses,
      COUNT(CASE WHEN data >= $3 THEN 1 END) as dias_vendas_3_meses

    FROM vr_vendas_qtd
    WHERE idproduto = $1
  `;

  const params = [idProduto, dataInicio6Meses, dataInicio3Meses];

  if (idEmpresa !== null) {
    query += ` AND idempresa = $4`;
    params.push(idEmpresa);
  }

  const result = await pool.query(query, params);

  if (result.rows.length === 0 || result.rows[0].total_vendas === 0) {
    return null;
  }

  const stats = result.rows[0];

  return {
    idproduto: idProduto,
    idempresa: idEmpresa,
    total_vendas: parseInt(stats.total_vendas),
    quantidade_total: parseFloat(stats.quantidade_total),
    primeira_venda: stats.primeira_venda,
    ultima_venda: stats.ultima_venda,
    ultimos_6_meses: {
      quantidade_total: parseFloat(stats.qtd_6_meses),
      dias_com_vendas: parseInt(stats.dias_vendas_6_meses),
      media_por_dia: stats.dias_vendas_6_meses > 0
        ? parseFloat(stats.qtd_6_meses) / parseInt(stats.dias_vendas_6_meses)
        : 0
    },
    ultimos_3_meses: {
      quantidade_total: parseFloat(stats.qtd_3_meses),
      dias_com_vendas: parseInt(stats.dias_vendas_3_meses),
      media_por_dia: stats.dias_vendas_3_meses > 0
        ? parseFloat(stats.qtd_3_meses) / parseInt(stats.dias_vendas_3_meses)
        : 0
    }
  };
}

module.exports = {
  calcularMediaVendasPorDia,
  buscarVendasComMedias,
  buscarProdutoComMedias,
  buscarEstatisticasProduto
};
