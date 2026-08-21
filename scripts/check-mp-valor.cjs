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

  // 1. Ver detalhes do produto/MP
  console.log('=== PRODUTO ===');
  const produto = await pool.query(`
    SELECT
      p.cd_produto,
      p.nm_produto
    FROM vr_prd_prdgrade p
    WHERE p.cd_produto::TEXT = $1
  `, [idMp]);
  if (produto.rows[0]) {
    console.log(JSON.stringify(produto.rows[0], null, 2));
  }

  // 1.1 Verificar unidade do produto na tabela base
  console.log('\n=== UNIDADE PRODUTO (prd_produto) ===');
  try {
    const unidProd = await pool.query(`
      SELECT cd_produto, cd_unidade, fc_conversao
      FROM prd_produto
      WHERE cd_produto::TEXT = $1
    `, [idMp]);
    if (unidProd.rows[0]) {
      console.log(JSON.stringify(unidProd.rows[0], null, 2));
    }
  } catch (e) {
    console.log('Tabela prd_produto não acessível');
  }

  // 2. Ver pedidos de compra recentes dessa MP
  console.log('\n=== PEDIDOS DE COMPRA (FINALIZADOS) ===');
  const pedidos = await pool.query(`
    SELECT
      c.cd_pedido,
      c.cd_empresa,
      i.cd_produto,
      i.qt_atendida,
      i.vl_atendido,
      COALESCE(i.dt_ultentrega, c.dt_ultentrega)::date as dt_entrega,
      CASE WHEN COALESCE(i.qt_atendida, 0) > 0
           THEN COALESCE(i.vl_atendido, 0) / COALESCE(i.qt_atendida, 1)
           ELSE 0
      END as valor_unit_calculado
    FROM vr_cmp_pedidoc2 c
    JOIN vr_cmp_pedidoi i ON i.cd_empresa = c.cd_empresa AND i.cd_pedido = c.cd_pedido
    WHERE i.cd_produto::TEXT = $1
      AND COALESCE(i.qt_atendida, 0) > 0
    ORDER BY COALESCE(i.dt_ultentrega, c.dt_ultentrega) DESC NULLS LAST
    LIMIT 10
  `, [idMp]);

  pedidos.rows.forEach(r => {
    const vlUnit = Number(r.valor_unit_calculado) || 0;
    const vlAtend = Number(r.vl_atendido) || 0;
    const qtAtend = Number(r.qt_atendida) || 0;
    console.log(`Pedido: ${r.cd_pedido} | Qt.Atend: ${qtAtend} | Valor: R$ ${vlAtend.toFixed(2)} | Unit: R$ ${vlUnit.toFixed(4)} | Data: ${r.dt_entrega}`);
  });

  // 3. Ver fornecedor padrão
  console.log('\n=== FORNECEDORES ===');
  const fornecedor = await pool.query(`
    SELECT
      f.cd_produto,
      f.cd_fornecedor,
      f.nm_fornecedor,
      f.cd_original,
      f.in_padrao,
      f.pr_markup
    FROM vr_prd_fornecedor f
    WHERE f.cd_produto::TEXT = $1
    ORDER BY CASE WHEN UPPER(COALESCE(f.in_padrao, '')) IN ('T', 'S', '1', 'TRUE') THEN 0 ELSE 1 END
  `, [idMp]);

  fornecedor.rows.forEach(r => {
    console.log(`Forn: ${r.cd_fornecedor} - ${r.nm_fornecedor} | Padrao: ${r.in_padrao} | Markup: ${r.pr_markup}`);
  });

  // 4. Verificar dados na tabela de itens de pedido completa
  console.log('\n=== ESTRUTURA ITENS PEDIDO (colunas disponiveis) ===');
  try {
    const cols = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'vr_cmp_pedidoi'
      ORDER BY ordinal_position
    `);
    console.log(cols.rows.map(r => r.column_name).join(', '));
  } catch(e) {
    console.log('Erro ao buscar colunas');
  }

  // 5. Verificar se há fator de conversão nos pedidos
  console.log('\n=== VERIFICAR UNIDADE NOS PEDIDOS ===');
  try {
    const checkUnit = await pool.query(`
      SELECT *
      FROM vr_cmp_pedidoi i
      WHERE i.cd_produto::TEXT = $1
      LIMIT 1
    `, [idMp]);
    if (checkUnit.rows[0]) {
      console.log('Colunas disponíveis no item:', Object.keys(checkUnit.rows[0]).join(', '));
      console.log('Valores:', JSON.stringify(checkUnit.rows[0], null, 2));
    }
  } catch(e) {
    console.log('Erro:', e.message);
  }

  await pool.end();
}

check().catch(e => { console.error(e); process.exit(1); });
