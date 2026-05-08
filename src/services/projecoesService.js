/**
 * Service para gerenciar projeções no PostgreSQL
 * Substitui o armazenamento em arquivo JSON
 */

/**
 * Garante que as tabelas de projeções existem no banco
 * @param {Pool} pool - Pool de conexão PostgreSQL
 */
async function ensureTabelas(pool) {
  const sql = `
    CREATE TABLE IF NOT EXISTS app_projecoes (
      id SERIAL PRIMARY KEY,
      idproduto TEXT NOT NULL,
      mes INTEGER NOT NULL CHECK (mes >= 1 AND mes <= 12),
      ano INTEGER NOT NULL CHECK (ano >= 2020 AND ano <= 2100),
      quantidade INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      origem TEXT DEFAULT 'IMPORT',
      UNIQUE(idproduto, mes, ano)
    );

    CREATE INDEX IF NOT EXISTS idx_projecoes_produto ON app_projecoes(idproduto);
    CREATE INDEX IF NOT EXISTS idx_projecoes_periodo ON app_projecoes(ano, mes);
    CREATE INDEX IF NOT EXISTS idx_projecoes_ano ON app_projecoes(ano);
  `;

  await pool.query(sql);
}

/**
 * Lê todas as projeções de um ano do banco
 * @param {Pool} pool - Pool de conexão PostgreSQL
 * @param {number} ano - Ano das projeções
 * @returns {Promise<Object>} Objeto no formato { idproduto: { mes: qtd, ... }, ... }
 */
async function lerProjecoesBanco(pool, ano) {
  const sql = `
    SELECT idproduto, mes, quantidade
    FROM app_projecoes
    WHERE ano = $1
    ORDER BY idproduto, mes
  `;

  const result = await pool.query(sql, [ano]);

  // Converter para formato legado (compatível com JSON anterior)
  const data = {};
  for (const row of result.rows) {
    const id = String(row.idproduto);
    if (!data[id]) {
      data[id] = {};
    }
    data[id][String(row.mes)] = Number(row.quantidade);
  }

  return data;
}

/**
 * Lê projeções de múltiplos anos
 * @param {Pool} pool - Pool de conexão PostgreSQL
 * @param {number[]} anos - Array de anos
 * @returns {Promise<Object>} Objeto combinado de todos os anos
 */
async function lerProjecoesMultiplosAnos(pool, anos) {
  const sql = `
    SELECT idproduto, mes, ano, quantidade
    FROM app_projecoes
    WHERE ano = ANY($1::INTEGER[])
    ORDER BY idproduto, ano, mes
  `;

  const result = await pool.query(sql, [anos]);

  // Agrupar por produto (combina todos os anos)
  const data = {};
  for (const row of result.rows) {
    const id = String(row.idproduto);
    if (!data[id]) {
      data[id] = {};
    }
    // Usar mês como chave (formato legado)
    data[id][String(row.mes)] = Number(row.quantidade);
  }

  return data;
}

/**
 * Salva/atualiza uma projeção no banco
 * @param {Pool} pool - Pool de conexão PostgreSQL
 * @param {string} idproduto - ID do produto
 * @param {number} mes - Mês (1-12)
 * @param {number} ano - Ano
 * @param {number} quantidade - Quantidade projetada
 * @param {string} origem - Origem do registro (API, IMPORT, etc)
 */
async function salvarProjecao(pool, idproduto, mes, ano, quantidade, origem = 'API') {
  const sql = `
    INSERT INTO app_projecoes (idproduto, mes, ano, quantidade, origem)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (idproduto, mes, ano)
    DO UPDATE SET
      quantidade = EXCLUDED.quantidade,
      updated_at = CURRENT_TIMESTAMP,
      origem = EXCLUDED.origem
    RETURNING id
  `;

  const result = await pool.query(sql, [
    String(idproduto),
    Number(mes),
    Number(ano),
    Number(quantidade),
    origem
  ]);

  return result.rows[0];
}

/**
 * Importa múltiplos registros de uma vez (bulk upsert)
 * @param {Pool} pool - Pool de conexão PostgreSQL
 * @param {Array} registros - Array de { idproduto, mes, ano, quantidade }
 * @param {string} origem - Origem dos registros
 * @returns {Promise<number>} Número de registros importados
 */
async function importarRegistros(pool, registros, origem = 'IMPORT') {
  if (!registros || !registros.length) {
    return 0;
  }

  // Construir VALUES para bulk insert
  const valores = registros.map((r, i) => {
    const offset = i * 5;
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
  }).join(', ');

  const params = registros.flatMap(r => [
    String(r.idproduto),
    Number(r.mes),
    Number(r.ano),
    Number(r.quantidade),
    origem
  ]);

  const sql = `
    INSERT INTO app_projecoes (idproduto, mes, ano, quantidade, origem)
    VALUES ${valores}
    ON CONFLICT (idproduto, mes, ano)
    DO UPDATE SET
      quantidade = EXCLUDED.quantidade,
      updated_at = CURRENT_TIMESTAMP,
      origem = EXCLUDED.origem
  `;

  await pool.query(sql, params);
  return registros.length;
}

/**
 * Importa registros em lotes para evitar queries muito grandes
 * @param {Pool} pool - Pool de conexão PostgreSQL
 * @param {Array} registros - Array de registros
 * @param {string} origem - Origem dos registros
 * @param {number} tamanhoLote - Tamanho de cada lote (padrão: 500)
 * @returns {Promise<number>} Total de registros importados
 */
async function importarRegistrosEmLotes(pool, registros, origem = 'IMPORT', tamanhoLote = 500) {
  if (!registros || !registros.length) {
    return 0;
  }

  let total = 0;

  for (let i = 0; i < registros.length; i += tamanhoLote) {
    const lote = registros.slice(i, i + tamanhoLote);
    const importados = await importarRegistros(pool, lote, origem);
    total += importados;
  }

  return total;
}

/**
 * Deleta projeções de um produto
 * @param {Pool} pool - Pool de conexão PostgreSQL
 * @param {string} idproduto - ID do produto
 * @param {number} ano - Ano (opcional, se não informado deleta todos)
 */
async function deletarProjecoesProduto(pool, idproduto, ano = null) {
  let sql;
  let params;

  if (ano) {
    sql = 'DELETE FROM app_projecoes WHERE idproduto = $1 AND ano = $2';
    params = [String(idproduto), Number(ano)];
  } else {
    sql = 'DELETE FROM app_projecoes WHERE idproduto = $1';
    params = [String(idproduto)];
  }

  const result = await pool.query(sql, params);
  return result.rowCount;
}

/**
 * Deleta todas as projeções de um ano
 * @param {Pool} pool - Pool de conexão PostgreSQL
 * @param {number} ano - Ano
 */
async function deletarProjecoesAno(pool, ano) {
  const sql = 'DELETE FROM app_projecoes WHERE ano = $1';
  const result = await pool.query(sql, [Number(ano)]);
  return result.rowCount;
}

/**
 * Retorna estatísticas das projeções
 * @param {Pool} pool - Pool de conexão PostgreSQL
 * @param {number} ano - Ano (opcional)
 */
async function obterEstatisticas(pool, ano = null) {
  let sql;
  let params;

  if (ano) {
    sql = `
      SELECT
        COUNT(DISTINCT idproduto) as produtos,
        COUNT(*) as registros,
        array_agg(DISTINCT mes ORDER BY mes) as meses,
        SUM(quantidade) as total_quantidade,
        MIN(created_at) as primeira_insercao,
        MAX(updated_at) as ultima_atualizacao
      FROM app_projecoes
      WHERE ano = $1
    `;
    params = [Number(ano)];
  } else {
    sql = `
      SELECT
        ano,
        COUNT(DISTINCT idproduto) as produtos,
        COUNT(*) as registros,
        array_agg(DISTINCT mes ORDER BY mes) as meses,
        SUM(quantidade) as total_quantidade
      FROM app_projecoes
      GROUP BY ano
      ORDER BY ano
    `;
    params = [];
  }

  const result = await pool.query(sql, params);
  return ano ? result.rows[0] : result.rows;
}

/**
 * Verifica se existem projeções no banco
 * @param {Pool} pool - Pool de conexão PostgreSQL
 * @returns {Promise<boolean>}
 */
async function existemProjecoes(pool) {
  const sql = 'SELECT EXISTS(SELECT 1 FROM app_projecoes LIMIT 1) as existe';
  const result = await pool.query(sql);
  return result.rows[0]?.existe || false;
}

/**
 * Obtém o timestamp da última atualização
 * @param {Pool} pool - Pool de conexão PostgreSQL
 * @param {number} ano - Ano (opcional)
 */
async function obterUltimaAtualizacao(pool, ano = null) {
  let sql;
  let params;

  if (ano) {
    sql = 'SELECT MAX(updated_at) as ultima FROM app_projecoes WHERE ano = $1';
    params = [Number(ano)];
  } else {
    sql = 'SELECT MAX(updated_at) as ultima FROM app_projecoes';
    params = [];
  }

  const result = await pool.query(sql, params);
  return result.rows[0]?.ultima || null;
}

module.exports = {
  ensureTabelas,
  lerProjecoesBanco,
  lerProjecoesMultiplosAnos,
  salvarProjecao,
  importarRegistros,
  importarRegistrosEmLotes,
  deletarProjecoesProduto,
  deletarProjecoesAno,
  obterEstatisticas,
  existemProjecoes,
  obterUltimaAtualizacao,
};
