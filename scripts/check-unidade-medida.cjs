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

  // 1. Verificar tabela de unidades de medida
  console.log('=== TABELA DE UNIDADES DE MEDIDA ===');
  try {
    const unidades = await pool.query(`
      SELECT * FROM vr_grl_unidade ORDER BY cd_unidade LIMIT 20
    `);
    unidades.rows.forEach(r => {
      console.log(JSON.stringify(r));
    });
  } catch(e) {
    console.log('Erro ou tabela não existe:', e.message);
  }

  // 2. Ver se existe relação produto-unidade
  console.log('\n=== UNIDADES DO PRODUTO ===');
  try {
    const prodUnid = await pool.query(`
      SELECT * FROM vr_prd_produtounidade WHERE cd_produto::TEXT = $1
    `, [idMp]);
    prodUnid.rows.forEach(r => {
      console.log(JSON.stringify(r));
    });
    if (!prodUnid.rows.length) {
      console.log('Nenhuma unidade específica cadastrada para este produto');
    }
  } catch(e) {
    console.log('Erro ou tabela não existe:', e.message);
  }

  // 3. Ver unidade padrão do produto na tabela base
  console.log('\n=== VERIFICAR PRODUTO BASE ===');
  try {
    const prod = await pool.query(`
      SELECT p.cd_produto, p.nm_produto, p.cd_unidade, p.qt_embalagem
      FROM vr_prd_produto p
      WHERE p.cd_produto::TEXT = $1
    `, [idMp]);
    if (prod.rows[0]) {
      console.log(JSON.stringify(prod.rows[0], null, 2));
    }
  } catch(e) {
    console.log('Erro:', e.message);
  }

  // 4. Verificar se há conversão na view do fornecedor
  console.log('\n=== FORNECEDOR COM DETALHES ===');
  try {
    const forn = await pool.query(`
      SELECT *
      FROM vr_prd_fornecedor f
      WHERE f.cd_produto::TEXT = $1
      AND f.in_padrao = 'T'
      LIMIT 1
    `, [idMp]);
    if (forn.rows[0]) {
      console.log('Colunas:', Object.keys(forn.rows[0]).join(', '));
      console.log(JSON.stringify(forn.rows[0], null, 2));
    }
  } catch(e) {
    console.log('Erro:', e.message);
  }

  // 5. Calcular valor correto
  console.log('\n=== CÁLCULO CORRETO ===');
  // Se for milheiro, o valor por unidade seria ~0.18626
  const valorMilheiro = 186.26;
  const valorUnidade = valorMilheiro / 1000;
  const necessidade = 7590;
  console.log(`Valor por milheiro: R$ ${valorMilheiro.toFixed(2)}`);
  console.log(`Valor por unidade: R$ ${valorUnidade.toFixed(4)}`);
  console.log(`Necessidade: ${necessidade} unidades`);
  console.log(`Valor correto: R$ ${(necessidade * valorUnidade).toFixed(2)}`);
  console.log(`Valor errado (sem conversão): R$ ${(necessidade * valorMilheiro).toFixed(2)}`);

  await pool.end();
}

check().catch(e => { console.error(e); process.exit(1); });
