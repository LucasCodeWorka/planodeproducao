const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function check() {
  const idMp = '1010252';

  // 1. Listar todas as tabelas/views que possam ter informação de conversão
  console.log('=== BUSCANDO TABELAS COM CONVERSAO ===');
  const tabelas = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND (table_name LIKE '%unid%' OR table_name LIKE '%conv%' OR table_name LIKE '%prd_produto%')
    ORDER BY table_name
  `);
  console.log(tabelas.rows.map(r => r.table_name).join('\n'));

  // 2. Verificar prd_produto diretamente
  console.log('\n=== PRD_PRODUTO ===');
  try {
    const prod = await pool.query(`
      SELECT *
      FROM prd_produto
      WHERE cd_produto::TEXT = $1
    `, [idMp]);
    if (prod.rows[0]) {
      // Mostrar apenas colunas que podem ter informação de unidade/conversão
      const r = prod.rows[0];
      const relevantes = Object.keys(r).filter(k =>
        k.includes('unid') || k.includes('conv') || k.includes('embal') ||
        k.includes('fator') || k.includes('fc_') || k.includes('cd_') ||
        k.includes('qt_')
      );
      console.log('Colunas relevantes:');
      relevantes.forEach(k => {
        if (r[k] !== null && r[k] !== 0) {
          console.log(`  ${k}: ${r[k]}`);
        }
      });
    }
  } catch(e) {
    console.log('Erro:', e.message);
  }

  // 3. Verificar vr_prd_produto
  console.log('\n=== VR_PRD_PRODUTO ===');
  try {
    const prod = await pool.query(`
      SELECT *
      FROM vr_prd_produto
      WHERE cd_produto::TEXT = $1
    `, [idMp]);
    if (prod.rows[0]) {
      const r = prod.rows[0];
      console.log('Todas as colunas:');
      Object.keys(r).forEach(k => {
        console.log(`  ${k}: ${r[k]}`);
      });
    }
  } catch(e) {
    console.log('Erro:', e.message);
  }

  // 4. Verificar se há padrão por artigo
  console.log('\n=== OUTROS PRODUTOS ACESSORIO ===');
  try {
    const outros = await pool.query(`
      SELECT
        p.cd_produto,
        p.nm_produto,
        COALESCE(f_dic_prd_classificacao(p.cd_produto, 'DS'::text, 111::bigint), '')::TEXT AS artigo
      FROM vr_prd_prdgrade p
      WHERE COALESCE(f_dic_prd_classificacao(p.cd_produto, 'DS'::text, 111::bigint), '') = 'ACESSORIO'
      LIMIT 5
    `);
    outros.rows.forEach(r => {
      console.log(`${r.cd_produto} - ${r.nm_produto}`);
    });
  } catch(e) {
    console.log('Erro:', e.message);
  }

  await pool.end();
}

check().catch(e => { console.error(e); process.exit(1); });
