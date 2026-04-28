/**
 * Serviço de Indicadores de OP (Ordem de Produção)
 *
 * Calcula indicadores de tempo de produção:
 * - OP LIEBE: pior tempo e média geral
 * - OP Oficina: pior tempo e média por oficina de costura
 */

const COMPANY_ID = 1;

/**
 * Busca indicadores gerais de OP LIEBE
 * @param {object} pool - Pool de conexão PostgreSQL
 * @param {string} desde - Data inicial (YYYY-MM-DD)
 * @param {string} ate - Data final (YYYY-MM-DD), opcional
 */
async function getIndicadoresLiebe(pool, desde, ate = null) {
  const query = `
    WITH ops_encerradas AS (
      SELECT
        opc.nr_op,
        opc.dt_inclusao,
        opc.dt_inicio,
        opc.dt_encerramento,
        EXTRACT(DAY FROM (opc.dt_encerramento - opc.dt_inicio))::INTEGER AS dias
      FROM vr_pcp_opc opc
      WHERE opc.cd_empresa = $1
        AND COALESCE(opc.cd_categoria, 0) <> 15
        AND opc.dt_encerramento >= $2::DATE
        ${ate ? "AND opc.dt_encerramento <= $3::DATE" : ""}
        AND opc.dt_encerramento IS NOT NULL
        AND opc.dt_inicio IS NOT NULL
        AND EXTRACT(DAY FROM (opc.dt_encerramento - opc.dt_inicio))::INTEGER > 0
    ),
    ops_ranked AS (
      SELECT
        nr_op,
        dt_inclusao,
        dt_inicio,
        dt_encerramento,
        dias,
        ROW_NUMBER() OVER (ORDER BY dias DESC) AS rn_desc,
        ROW_NUMBER() OVER (ORDER BY dias ASC) AS rn_asc,
        COUNT(*) OVER () AS total
      FROM ops_encerradas
    ),
    indicadores AS (
      SELECT
        -- Pior dia: segundo maior (ignora outlier máximo)
        MAX(CASE WHEN rn_desc > 1 OR total = 1 THEN dias END) AS pior_dias,
        -- Média: exclui o maior e o menor se tiver mais de 2
        ROUND(AVG(CASE WHEN (rn_desc > 1 AND rn_asc > 1) OR total <= 2 THEN dias END)::NUMERIC, 1) AS media_dias,
        -- Melhor dia: segundo menor (ignora outlier mínimo)
        MIN(CASE WHEN rn_asc > 1 OR total = 1 THEN dias END) AS melhor_dias,
        COUNT(*) AS total_ops
      FROM ops_ranked
    ),
    pior_op AS (
      -- Pega o segundo pior (primeiro após excluir o outlier)
      SELECT
        nr_op,
        dt_inclusao,
        dt_inicio,
        dt_encerramento,
        dias
      FROM ops_ranked
      WHERE rn_desc = 2 OR total = 1
      LIMIT 1
    )
    SELECT
      i.pior_dias,
      i.media_dias,
      i.melhor_dias,
      i.total_ops,
      p.nr_op AS pior_nr_op,
      p.dt_inclusao AS pior_dt_inclusao,
      p.dt_inicio AS pior_dt_inicio,
      p.dt_encerramento AS pior_dt_encerramento,
      p.dias AS pior_op_dias
    FROM indicadores i
    LEFT JOIN pior_op p ON true
  `;

  const params = ate ? [COMPANY_ID, desde, ate] : [COMPANY_ID, desde];
  const result = await pool.query(query, params);

  if (result.rows.length === 0 || !result.rows[0].total_ops) {
    return {
      tipo: 'LIEBE',
      periodo: { desde, ate },
      indicadores: null,
      pior_op: null,
    };
  }

  const row = result.rows[0];
  return {
    tipo: 'LIEBE',
    periodo: { desde, ate },
    indicadores: {
      pior_dias: Number(row.pior_dias),
      media_dias: Number(row.media_dias),
      melhor_dias: Number(row.melhor_dias),
      total_ops: Number(row.total_ops),
    },
    pior_op: row.pior_nr_op ? {
      nr_op: row.pior_nr_op,
      dt_inclusao: row.pior_dt_inclusao,
      dt_inicio: row.pior_dt_inicio,
      dt_encerramento: row.pior_dt_encerramento,
      dias: Number(row.pior_op_dias),
    } : null,
  };
}

/**
 * Busca indicadores por oficina de costura
 * Usa vr_cdf_movopi com ds_localorigem contendo "OFICINA"
 * @param {object} pool - Pool de conexão PostgreSQL
 * @param {string} desde - Data inicial (YYYY-MM-DD)
 * @param {string} ate - Data final (YYYY-MM-DD), opcional
 */
async function getIndicadoresOficinas(pool, desde, ate = null) {
  const query = `
    WITH oficinas_ops AS (
      -- Identifica quais OPs passaram por cada oficina (sem duplicar)
      SELECT DISTINCT
        mov.cd_localorigem AS cd_local,
        mov.ds_localorigem AS oficina,
        opc.nr_op,
        opc.nr_ciclo,
        opc.cd_empresa
      FROM vr_cdf_movopi mov
      JOIN vr_pcp_opi opi ON mov.cd_produto = opi.cd_produto
      JOIN vr_pcp_opc opc ON opi.cd_empresa = opc.cd_empresa
                         AND opi.nr_ciclo = opc.nr_ciclo
                         AND opi.nr_op = opc.nr_op
      WHERE UPPER(mov.ds_localorigem) LIKE '%OFICINA%'
        AND opc.cd_empresa = $1
        AND COALESCE(opc.cd_categoria, 0) <> 15
        AND opc.dt_encerramento >= $2::DATE
        ${ate ? "AND opc.dt_encerramento <= $3::DATE" : ""}
        AND opc.dt_encerramento IS NOT NULL
        AND opc.dt_inicio IS NOT NULL
        AND EXTRACT(DAY FROM (opc.dt_encerramento - opc.dt_inicio))::INTEGER > 0
    ),
    ops_oficina AS (
      -- Pega os dados da OP (duração total) para cada oficina
      SELECT
        oo.cd_local,
        oo.oficina,
        opc.nr_op,
        opc.dt_inclusao,
        opc.dt_inicio,
        opc.dt_encerramento,
        EXTRACT(DAY FROM (opc.dt_encerramento - opc.dt_inicio))::INTEGER AS dias
      FROM oficinas_ops oo
      JOIN vr_pcp_opc opc ON oo.cd_empresa = opc.cd_empresa
                         AND oo.nr_ciclo = opc.nr_ciclo
                         AND oo.nr_op = opc.nr_op
    ),
    ops_sem_extremos AS (
      -- Remove o pior e o melhor de cada oficina para cálculo
      SELECT
        cd_local,
        oficina,
        nr_op,
        dias,
        ROW_NUMBER() OVER (PARTITION BY cd_local ORDER BY dias DESC) AS rn_desc,
        ROW_NUMBER() OVER (PARTITION BY cd_local ORDER BY dias ASC) AS rn_asc,
        COUNT(*) OVER (PARTITION BY cd_local) AS total
      FROM ops_oficina
    ),
    indicadores_por_oficina AS (
      SELECT
        cd_local,
        oficina,
        -- Pior dia: segundo maior (ignora o outlier máximo)
        MAX(CASE WHEN rn_desc > 1 OR total = 1 THEN dias END) AS pior_dias,
        -- Média: exclui o maior e o menor se tiver mais de 2
        ROUND(AVG(CASE WHEN (rn_desc > 1 AND rn_asc > 1) OR total <= 2 THEN dias END)::NUMERIC, 1) AS media_dias,
        -- Melhor dia: segundo menor (ignora o outlier mínimo)
        MIN(CASE WHEN rn_asc > 1 OR total = 1 THEN dias END) AS melhor_dias,
        COUNT(DISTINCT nr_op) AS total_ops
      FROM ops_oficina
      GROUP BY cd_local, oficina
    ),
    pior_op_por_oficina AS (
      SELECT DISTINCT ON (cd_local)
        cd_local,
        nr_op AS pior_nr_op,
        dt_inicio AS pior_dt_inicio,
        dt_encerramento AS pior_dt_encerramento,
        dias AS pior_op_dias
      FROM ops_oficina
      ORDER BY cd_local, dias DESC
    )
    SELECT
      i.cd_local,
      i.oficina,
      i.pior_dias,
      i.media_dias,
      i.melhor_dias,
      i.total_ops,
      p.pior_nr_op,
      p.pior_dt_inicio,
      p.pior_dt_encerramento,
      p.pior_op_dias
    FROM indicadores_por_oficina i
    LEFT JOIN pior_op_por_oficina p ON i.cd_local = p.cd_local
    ORDER BY i.pior_dias DESC
  `;

  const params = ate ? [COMPANY_ID, desde, ate] : [COMPANY_ID, desde];
  const result = await pool.query(query, params);

  return {
    tipo: 'OFICINAS',
    periodo: { desde, ate },
    oficinas: result.rows.map(row => ({
      cd_local: row.cd_local,
      nome: row.oficina,
      indicadores: {
        pior_dias: Number(row.pior_dias),
        media_dias: Number(row.media_dias),
        melhor_dias: Number(row.melhor_dias),
        total_ops: Number(row.total_ops),
      },
      pior_op: row.pior_nr_op ? {
        nr_op: row.pior_nr_op,
        dt_inicio: row.pior_dt_inicio,
        dt_encerramento: row.pior_dt_encerramento,
        dias: Number(row.pior_op_dias),
      } : null,
    })),
  };
}

/**
 * Busca lista detalhada de OPs
 * @param {object} pool - Pool de conexão PostgreSQL
 * @param {string} tipo - 'liebe' ou 'oficina'
 * @param {string} desde - Data inicial (YYYY-MM-DD)
 * @param {string} ate - Data final (YYYY-MM-DD), opcional
 * @param {number} cdLocal - Código do local (apenas para tipo 'oficina')
 * @param {number} limit - Limite de registros
 */
async function getDetalhesOps(pool, tipo, desde, ate = null, cdLocal = null, limit = 50) {
  let query;
  let params;

  if (tipo === 'oficina' && cdLocal) {
    query = `
      SELECT DISTINCT
        mov.ds_localorigem AS oficina,
        opc.nr_op,
        opc.dt_inclusao,
        opc.dt_inicio,
        opc.dt_encerramento,
        EXTRACT(DAY FROM (opc.dt_encerramento - opc.dt_inicio))::INTEGER AS dias
      FROM vr_cdf_movopi mov
      JOIN vr_pcp_opi opi ON mov.cd_produto = opi.cd_produto
      JOIN vr_pcp_opc opc ON opi.cd_empresa = opc.cd_empresa
                         AND opi.nr_ciclo = opc.nr_ciclo
                         AND opi.nr_op = opc.nr_op
      WHERE mov.cd_localorigem = $1
        AND opc.cd_empresa = $2
        AND COALESCE(opc.cd_categoria, 0) <> 15
        AND opc.dt_encerramento >= $3::DATE
        ${ate ? "AND opc.dt_encerramento <= $4::DATE" : ""}
        AND opc.dt_encerramento IS NOT NULL
        AND opc.dt_inicio IS NOT NULL
        AND EXTRACT(DAY FROM (opc.dt_encerramento - opc.dt_inicio))::INTEGER > 0
      ORDER BY dias DESC
      LIMIT $${ate ? 5 : 4}
    `;
    params = ate
      ? [cdLocal, COMPANY_ID, desde, ate, limit]
      : [cdLocal, COMPANY_ID, desde, limit];
  } else {
    query = `
      SELECT
        opc.nr_op,
        opc.dt_inclusao,
        opc.dt_inicio,
        opc.dt_encerramento,
        EXTRACT(DAY FROM (opc.dt_encerramento - opc.dt_inicio))::INTEGER AS dias
      FROM vr_pcp_opc opc
      WHERE opc.cd_empresa = $1
        AND COALESCE(opc.cd_categoria, 0) <> 15
        AND opc.dt_encerramento >= $2::DATE
        ${ate ? "AND opc.dt_encerramento <= $3::DATE" : ""}
        AND opc.dt_encerramento IS NOT NULL
        AND opc.dt_inicio IS NOT NULL
        AND EXTRACT(DAY FROM (opc.dt_encerramento - opc.dt_inicio))::INTEGER > 0
      ORDER BY dias DESC
      LIMIT $${ate ? 4 : 3}
    `;
    params = ate
      ? [COMPANY_ID, desde, ate, limit]
      : [COMPANY_ID, desde, limit];
  }

  const result = await pool.query(query, params);

  return {
    tipo: tipo.toUpperCase(),
    periodo: { desde, ate },
    cd_local: cdLocal,
    ops: result.rows.map(row => ({
      oficina: row.oficina || null,
      nr_op: row.nr_op,
      dt_inclusao: row.dt_inclusao,
      dt_inicio: row.dt_inicio,
      dt_encerramento: row.dt_encerramento,
      dias: Number(row.dias),
    })),
  };
}

/**
 * Busca resumo consolidado (LIEBE + todas oficinas)
 * @param {object} pool - Pool de conexão PostgreSQL
 * @param {string} desde - Data inicial (YYYY-MM-DD)
 * @param {string} ate - Data final (YYYY-MM-DD), opcional
 */
async function getResumoConsolidado(pool, desde, ate = null) {
  const [liebe, oficinas] = await Promise.all([
    getIndicadoresLiebe(pool, desde, ate),
    getIndicadoresOficinas(pool, desde, ate),
  ]);

  return {
    periodo: { desde, ate },
    liebe: liebe.indicadores,
    liebe_pior_op: liebe.pior_op,
    oficinas: oficinas.oficinas,
  };
}

/**
 * Busca indicadores por tipo de local (oficinas ou outros)
 * @param {object} pool - Pool de conexão PostgreSQL
 * @param {string} desde - Data inicial (YYYY-MM-DD)
 * @param {string} ate - Data final (YYYY-MM-DD), opcional
 * @param {boolean} isOficina - true para LIKE '%OFICINA%', false para NOT LIKE
 */
async function getIndicadoresPorTipoLocal(pool, desde, ate = null, isOficina = true) {
  const likeCondition = isOficina
    ? "UPPER(mov.ds_localorigem) LIKE '%OFICINA%'"
    : "UPPER(mov.ds_localorigem) NOT LIKE '%OFICINA%'";

  const query = `
    WITH locais_ops AS (
      SELECT DISTINCT
        mov.cd_localorigem AS cd_local,
        mov.ds_localorigem AS local_nome,
        opc.nr_op,
        opc.nr_ciclo,
        opc.cd_empresa
      FROM vr_cdf_movopi mov
      JOIN vr_pcp_opi opi ON mov.cd_produto = opi.cd_produto
      JOIN vr_pcp_opc opc ON opi.cd_empresa = opc.cd_empresa
                         AND opi.nr_ciclo = opc.nr_ciclo
                         AND opi.nr_op = opc.nr_op
      WHERE ${likeCondition}
        AND opc.cd_empresa = $1
        AND COALESCE(opc.cd_categoria, 0) <> 15
        AND opc.dt_encerramento >= $2::DATE
        ${ate ? "AND opc.dt_encerramento <= $3::DATE" : ""}
        AND opc.dt_encerramento IS NOT NULL
        AND opc.dt_inicio IS NOT NULL
        AND EXTRACT(DAY FROM (opc.dt_encerramento - opc.dt_inicio))::INTEGER > 0
    ),
    ops_local AS (
      SELECT
        oo.cd_local,
        oo.local_nome,
        opc.nr_op,
        opc.dt_inclusao,
        opc.dt_inicio,
        opc.dt_encerramento,
        EXTRACT(DAY FROM (opc.dt_encerramento - opc.dt_inicio))::INTEGER AS dias
      FROM locais_ops oo
      JOIN vr_pcp_opc opc ON oo.cd_empresa = opc.cd_empresa
                         AND oo.nr_ciclo = opc.nr_ciclo
                         AND oo.nr_op = opc.nr_op
    ),
    ops_ranked AS (
      SELECT
        cd_local,
        local_nome,
        nr_op,
        dias,
        ROW_NUMBER() OVER (PARTITION BY cd_local ORDER BY dias DESC) AS rn_desc,
        ROW_NUMBER() OVER (PARTITION BY cd_local ORDER BY dias ASC) AS rn_asc,
        COUNT(*) OVER (PARTITION BY cd_local) AS total
      FROM ops_local
    ),
    indicadores_por_local AS (
      SELECT
        cd_local,
        local_nome,
        MAX(CASE WHEN rn_desc > 1 OR total = 1 THEN dias END) AS pior_dias,
        ROUND(AVG(CASE WHEN (rn_desc > 1 AND rn_asc > 1) OR total <= 2 THEN dias END)::NUMERIC, 1) AS media_dias,
        COUNT(DISTINCT nr_op) AS total_ops
      FROM ops_ranked
      GROUP BY cd_local, local_nome
    )
    SELECT
      cd_local,
      local_nome,
      pior_dias,
      media_dias,
      total_ops
    FROM indicadores_por_local
    ORDER BY pior_dias DESC
  `;

  const params = ate ? [COMPANY_ID, desde, ate] : [COMPANY_ID, desde];
  const result = await pool.query(query, params);

  return result.rows.map(row => ({
    cd_local: row.cd_local,
    nome: row.local_nome,
    pior_dias: Number(row.pior_dias),
    media_dias: Number(row.media_dias),
    total_ops: Number(row.total_ops),
  }));
}

/**
 * Busca indicadores de todos os locais (oficinas + outros)
 * Retorna 2 arrays: oficinas (LIKE) e outrosLocais (NOT LIKE)
 * @param {object} pool - Pool de conexão PostgreSQL
 * @param {string} desde - Data inicial (YYYY-MM-DD)
 * @param {string} ate - Data final (YYYY-MM-DD), opcional
 */
async function getIndicadoresOutrosLocais(pool, desde, ate = null) {
  const [oficinas, outrosLocais] = await Promise.all([
    getIndicadoresPorTipoLocal(pool, desde, ate, true),
    getIndicadoresPorTipoLocal(pool, desde, ate, false),
  ]);

  return {
    tipo: 'LOCAIS',
    periodo: { desde, ate },
    oficinas,
    outrosLocais,
  };
}

/**
 * Lista todas as oficinas disponíveis
 * Usa vr_cdf_movopi com ds_localorigem
 * @param {object} pool - Pool de conexão PostgreSQL
 */
async function listarOficinas(pool) {
  const query = `
    SELECT DISTINCT cd_localorigem AS cd_local, ds_localorigem AS nome
    FROM vr_cdf_movopi
    WHERE UPPER(ds_localorigem) LIKE '%OFICINA%'
    ORDER BY ds_localorigem
  `;

  const result = await pool.query(query);
  return result.rows;
}

module.exports = {
  getIndicadoresLiebe,
  getIndicadoresOficinas,
  getIndicadoresOutrosLocais,
  getDetalhesOps,
  getResumoConsolidado,
  listarOficinas,
};
