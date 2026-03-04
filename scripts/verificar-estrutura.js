/**
 * Script para verificar a estrutura da view vr_vendas_qtd
 */

const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function verificarEstrutura() {
  try {
    console.log("Conectando ao banco de dados...\n");

    // 1. Verificar colunas da view
    console.log("=== ESTRUTURA DA VIEW vr_vendas_qtd ===\n");
    const estruturaQuery = `
      SELECT
        column_name,
        data_type,
        character_maximum_length,
        is_nullable
      FROM information_schema.columns
      WHERE table_name = 'vr_vendas_qtd'
      ORDER BY ordinal_position;
    `;

    const estrutura = await pool.query(estruturaQuery);

    if (estrutura.rows.length === 0) {
      console.log("❌ View vr_vendas_qtd não encontrada!");
      return;
    }

    console.log("Colunas disponíveis:");
    console.log("-".repeat(80));
    estrutura.rows.forEach((col, index) => {
      console.log(
        `${index + 1}. ${col.column_name.padEnd(30)} | ` +
        `${col.data_type.padEnd(20)} | ` +
        `Nullable: ${col.is_nullable}`
      );
    });

    // 2. Buscar amostra de dados
    console.log("\n=== AMOSTRA DE DADOS (5 primeiros registros) ===\n");
    const dadosQuery = `SELECT * FROM vr_vendas_qtd LIMIT 5`;
    const dados = await pool.query(dadosQuery);

    if (dados.rows.length === 0) {
      console.log("❌ Nenhum dado encontrado na view");
      return;
    }

    console.log(`Total de registros na amostra: ${dados.rows.length}\n`);
    dados.rows.forEach((row, index) => {
      console.log(`Registro ${index + 1}:`);
      console.log(JSON.stringify(row, null, 2));
      console.log("-".repeat(80));
    });

    // 3. Contar total de registros
    const countQuery = `SELECT COUNT(*) as total FROM vr_vendas_qtd`;
    const count = await pool.query(countQuery);
    console.log(`\n📊 Total de registros na view: ${count.rows[0].total}\n`);

  } catch (error) {
    console.error("❌ Erro ao verificar estrutura:", error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

verificarEstrutura();
