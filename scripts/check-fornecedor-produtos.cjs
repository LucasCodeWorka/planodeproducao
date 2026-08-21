require('dotenv').config();
const { Pool } = require('pg');

const ids = process.argv.slice(2).map((v) => String(v || '').trim()).filter(Boolean);

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
  if (!ids.length) {
    console.error('Informe os cd_produto para consultar.');
    process.exitCode = 1;
    return;
  }

  const result = await pool.query(`
    SELECT
      f.cd_produto::TEXT AS cd_produto,
      f.cd_fornecedor::TEXT AS cd_fornecedor,
      COALESCE(f.nm_fornecedor, '')::TEXT AS nm_fornecedor,
      COALESCE(f.cd_original, '')::TEXT AS cd_original,
      COALESCE(f.in_padrao, '')::TEXT AS in_padrao
    FROM public.vr_prd_fornecedor f
    WHERE f.cd_produto::TEXT = ANY($1::TEXT[])
    ORDER BY
      f.cd_produto,
      CASE WHEN UPPER(COALESCE(f.in_padrao, '')) IN ('T', 'S', '1', 'TRUE') THEN 0 ELSE 1 END,
      f.cd_fornecedor
  `, [ids]);

  console.table(result.rows);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
