require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
    ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true' }
    : false,
  connectionTimeoutMillis: 30000,
  query_timeout: 30000,
});

async function main() {
  const tables = await pool.query(`
    SELECT table_schema, table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND (
        lower(table_name) LIKE '%fornecedor%'
        OR lower(table_name) LIKE '%supplier%'
        OR lower(table_name) LIKE '%prd_for%'
        OR lower(table_name) LIKE '%compra%'
        OR lower(table_name) LIKE '%pessoa%'
      )
    ORDER BY table_name
    LIMIT 150
  `);
  console.table(tables.rows);

  const names = tables.rows.map((r) => r.table_name);
  if (names.length) {
    const cols = await pool.query(`
      SELECT table_name, ordinal_position, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1)
      ORDER BY table_name, ordinal_position
    `, [names]);
    console.table(cols.rows);
  }

  const stats = await pool.query(`
    SELECT
      COUNT(*)::INT AS total,
      COUNT(*) FILTER (WHERE COALESCE(in_padrao, '') <> '')::INT AS com_padrao,
      COUNT(*) FILTER (WHERE UPPER(COALESCE(in_padrao, '')) IN ('S', '1', 'TRUE'))::INT AS padrao_s,
      COUNT(DISTINCT cd_produto)::INT AS produtos,
      COUNT(DISTINCT cd_fornecedor)::INT AS fornecedores
    FROM public.vr_prd_fornecedor
  `);
  console.table(stats.rows);

  const sample = await pool.query(`
    SELECT cd_produto, cd_fornecedor, nm_fornecedor, pr_markup, cd_original, in_padrao
    FROM public.vr_prd_fornecedor
    ORDER BY
      CASE WHEN UPPER(COALESCE(in_padrao, '')) IN ('S', '1', 'TRUE') THEN 0 ELSE 1 END,
      cd_produto
    LIMIT 30
  `);
  console.table(sample.rows);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
