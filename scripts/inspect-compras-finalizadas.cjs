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
  const names = ['vr_cmp_pedidoc2', 'vr_cmp_pedidoi'];
  const cols = await pool.query(`
    SELECT table_name, ordinal_position, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY($1)
    ORDER BY table_name, ordinal_position
  `, [names]);
  console.table(cols.rows);

  const tables = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND (
        lower(table_name) LIKE '%cmp%'
        OR lower(table_name) LIKE '%receb%'
        OR lower(table_name) LIKE '%entrada%'
        OR lower(table_name) LIKE '%nota%'
      )
    ORDER BY table_name
    LIMIT 200
  `);
  console.table(tables.rows);

  for (const table of names) {
    const sample = await pool.query(`SELECT * FROM public.${table} LIMIT 3`);
    console.log(`\n=== ${table} sample ===`);
    console.dir(sample.rows, { depth: null });
  }

  const recent = await pool.query(`
    SELECT
      DATE_TRUNC('month', COALESCE(i.dt_ultentrega, c.dt_ultentrega, i.dt_ultaltped))::date AS mes_ref,
      COUNT(*)::INT AS linhas,
      COUNT(*) FILTER (WHERE i.dt_ultentrega IS NOT NULL)::INT AS item_com_dt_ultentrega,
      COUNT(*) FILTER (WHERE c.dt_ultentrega IS NOT NULL)::INT AS capa_com_dt_ultentrega,
      SUM(COALESCE(i.qt_atendida, 0))::FLOAT AS qt_atendida,
      SUM(COALESCE(i.qt_pendente, 0))::FLOAT AS qt_pendente,
      SUM(COALESCE(i.vl_atendido, 0))::FLOAT AS vl_atendido
    FROM public.vr_cmp_pedidoi i
    JOIN public.vr_cmp_pedidoc2 c
      ON c.cd_empresa = i.cd_empresa
     AND c.cd_pedido = i.cd_pedido
    WHERE i.cd_produto >= 1000000
      AND i.cd_produto < 5000000
      AND COALESCE(i.qt_atendida, 0) > 0
      AND COALESCE(i.dt_ultentrega, c.dt_ultentrega, i.dt_ultaltped) >= DATE '2026-01-01'
    GROUP BY 1
    ORDER BY 1 DESC
  `);
  console.log('\n=== atendido/finalizado por mes em 2026 ===');
  console.table(recent.rows);

  const sampleRecent = await pool.query(`
    SELECT
      i.cd_pedido,
      i.cd_produto,
      i.ds_ultnivel,
      i.qt_solicitada,
      i.qt_atendida,
      i.qt_pendente,
      i.vl_unitario,
      i.vl_atendido,
      i.dt_preventrega,
      i.dt_ultentrega AS dt_ultentrega_item,
      c.dt_ultentrega AS dt_ultentrega_capa,
      i.dt_ultaltped
    FROM public.vr_cmp_pedidoi i
    JOIN public.vr_cmp_pedidoc2 c
      ON c.cd_empresa = i.cd_empresa
     AND c.cd_pedido = i.cd_pedido
    WHERE i.cd_produto >= 1000000
      AND i.cd_produto < 5000000
      AND COALESCE(i.qt_atendida, 0) > 0
      AND COALESCE(i.dt_ultentrega, c.dt_ultentrega, i.dt_ultaltped) >= DATE '2026-06-01'
    ORDER BY COALESCE(i.dt_ultentrega, c.dt_ultentrega, i.dt_ultaltped) DESC
    LIMIT 20
  `);
  console.log('\n=== amostra atendidos recentes ===');
  console.table(sampleRecent.rows);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
