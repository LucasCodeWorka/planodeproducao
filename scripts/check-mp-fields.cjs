// Script para verificar campos disponíveis no cache de MP
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl:
    process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

async function main() {
  try {
    const r = await pool.query(`
      SELECT payload FROM public.app_orcamento_mp_cache
      WHERE cache_key = 'orcamento_mp_liebe'
      LIMIT 1
    `);

    if (r.rows.length === 0) {
      console.log("Cache nao encontrado");
      return;
    }

    const data = r.rows[0].payload;
    const sample = (data.rowsBase || []).slice(0, 3);

    console.log("Campos disponiveis:");
    console.log(JSON.stringify(Object.keys(sample[0] || {}), null, 2));

    console.log("\nExemplo de registro:");
    console.log(JSON.stringify(sample[0], null, 2));

  } catch (err) {
    console.error("Erro:", err.message);
  } finally {
    await pool.end();
  }
}

main();
