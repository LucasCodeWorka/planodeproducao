require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const ids = JSON.parse(fs.readFileSync('data/pedidos_ids_novembro.json', 'utf8'));
const pool = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: String(process.env.DB_SSL).toLowerCase() === 'true' ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED).toLowerCase() === 'true' } : undefined, connectionTimeoutMillis: 20000 });
(async () => {
  const resultado = await pool.query(`SELECT cd_pedido::text AS pedido, cd_produto::text AS sku, SUM(qt_pendente)::float AS pendente FROM vr_ped_pedidoi WHERE cd_empresa=1 AND cd_operacao<>44 AND tp_situacao<>6 AND cd_pedido=ANY($1::BIGINT[]) GROUP BY cd_pedido,cd_produto`, [ids]);
  fs.writeFileSync('outputs/novembro_skus/pedidos_erp.json', JSON.stringify(resultado.rows));
  console.log('Itens retornados para os pedidos consultados:', resultado.rows.length);
})().catch(e => { console.error(e.message); process.exitCode=1; }).finally(() => pool.end());
