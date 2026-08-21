// Script para investigar elástico - verificar cache do orçamento-mp
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
    // 1. Ver estrutura do cache do orçamento-mp
    console.log("=== 1. Estrutura do app_orcamento_mp_cache ===\n");
    const colunas = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'app_orcamento_mp_cache'
      ORDER BY ordinal_position
    `);
    console.log("Colunas:", colunas.rows.map(r => `${r.column_name} (${r.data_type})`).join(", "));

    // 2. Ver dados do cache
    console.log("\n=== 2. Dados do cache ===\n");
    const cache = await pool.query(`
      SELECT * FROM app_orcamento_mp_cache LIMIT 1
    `);
    if (cache.rows.length > 0) {
      console.log("Registro encontrado:");
      const row = cache.rows[0];
      console.log("Colunas:", Object.keys(row).join(", "));

      // Se tiver payload JSON, parsear e verificar
      if (row.payload) {
        try {
          const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
          console.log("\nPayload keys:", Object.keys(payload).join(", "));

          if (payload.rowsBase && Array.isArray(payload.rowsBase)) {
            console.log(`\nrowsBase: ${payload.rowsBase.length} registros`);

            // Buscar elásticos
            const elasticos = payload.rowsBase.filter(r => {
              const nome = String(r.nome_materiaprima || "").toUpperCase();
              return nome.includes("ELAST.") || nome.includes(" ELAST ");
            });

            console.log(`Elásticos encontrados: ${elasticos.length}`);
            elasticos.slice(0, 10).forEach(r => {
              console.log(`\n  MP ${r.idmateriaprima}: ${r.nome_materiaprima}`);
              console.log(`    Estoque: ${Number(r.estoquetotal || 0).toLocaleString("pt-BR")}`);
              console.log(`    Consumo MA: ${Number(r.consumo_ma || 0).toLocaleString("pt-BR")}`);
              console.log(`    Consumo PX: ${Number(r.consumo_px || 0).toLocaleString("pt-BR")}`);
              console.log(`    Consumo UL: ${Number(r.consumo_ul || 0).toLocaleString("pt-BR")}`);
              console.log(`    Consumo QT: ${Number(r.consumo_qt || 0).toLocaleString("pt-BR")}`);
              console.log(`    Consumo QU: ${Number(r.consumo_qu || 0).toLocaleString("pt-BR")}`);
            });
          }
        } catch (e) {
          console.log("Erro ao parsear payload:", e.message);
        }
      }
    } else {
      console.log("Nenhum registro no cache");
    }

    // 3. Verificar se excesso_mp é uma tabela ou view
    console.log("\n=== 3. Excesso_mp é tabela ou view? ===\n");
    const tipoExcesso = await pool.query(`
      SELECT table_type
      FROM information_schema.tables
      WHERE table_name = 'excesso_mp'
    `);
    console.log("Tipo:", tipoExcesso.rows[0]?.table_type || "Não encontrado");

    // 4. Ver quando excesso_mp foi atualizada
    console.log("\n=== 4. Quando excesso_mp foi atualizada? ===\n");
    const dataExcesso = await pool.query(`
      SELECT DISTINCT data_insercao
      FROM excesso_mp
      ORDER BY data_insercao DESC
      LIMIT 5
    `);
    console.log("Datas de inserção:");
    dataExcesso.rows.forEach(r => console.log(`  ${r.data_insercao}`));

  } catch (err) {
    console.error("Erro:", err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

main();
