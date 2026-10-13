import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD || "").replace(/^"|"$/g, ""),
  ssl: String(process.env.DB_SSL || "").toLowerCase() === "true"
    ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "").toLowerCase() === "true" }
    : undefined,
});

try {
  const columns = await pool.query(`
    SELECT a.attname AS column_name,
           pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'mv_geo3'
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
  `);
  console.table(columns.rows);

  const sample = await pool.query("SELECT * FROM public.mv_geo3 LIMIT 5");
  console.table(sample.rows);

  const total = await pool.query("SELECT COUNT(*)::int AS total FROM public.mv_geo3");
  console.table(total.rows);
  const referencias = await pool.query(`
    SELECT COUNT(DISTINCT cd_nivel)::int AS referencias
    FROM public.mv_geo3
    WHERE dataproduto >= CURRENT_DATE + INTERVAL '60 days'
  `);
  console.table(referencias.rows);

  const disponibilidade = await pool.query(`
    SELECT dataproduto::date AS data_disponibilidade,
           COUNT(*)::int AS skus,
           SUM(quantidade)::numeric(15,0) AS estoque_total,
           SUM(quantidadeprontaentrega)::numeric(15,0) AS pronta_entrega
    FROM public.mv_geo3
    GROUP BY dataproduto::date
    ORDER BY data_disponibilidade
  `);
  console.table(disponibilidade.rows);

  const classificacoes = await pool.query(`
    SELECT
      COALESCE(f_dic_prd_classificacao(codigoproduto::bigint, 'DS', 20), '') AS marca,
      COALESCE(f_dic_prd_classificacao(codigoproduto::bigint, 'DS', 27), '') AS status,
      COALESCE(f_dic_prd_classificacao(codigoproduto::bigint, 'DS', 802), '') AS continuidade,
      COALESCE(f_dic_prd_classificacao(codigoproduto::bigint, 'DS', 23), '') AS linha,
      COALESCE(f_dic_prd_classificacao(codigoproduto::bigint, 'DS', 24), '') AS familia,
      COUNT(*)::int AS skus,
      SUM(quantidade)::numeric(15,0) AS estoque_total,
      SUM(quantidadeprontaentrega)::numeric(15,0) AS pronta_entrega
    FROM public.mv_geo3
    GROUP BY 1,2,3,4,5
    ORDER BY estoque_total DESC
    LIMIT 30
  `);
  console.table(classificacoes.rows);
} finally {
  await pool.end();
}
