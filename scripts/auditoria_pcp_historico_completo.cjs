require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const refs = ['503806','603188','603390','603410','603589','604088','606790','123018','123020','123022','123121','123606','136124','501052','501053','501252','503306','503352','504053','505244','506124','506152','603187','603189','603190','603191','603391','213001','411001','501723','506120','703801'];
const pool = new Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:String(process.env.DB_SSL).toLowerCase()==='true'?{rejectUnauthorized:String(process.env.DB_SSL_REJECT_UNAUTHORIZED).toLowerCase()==='true'}:undefined,connectionTimeoutMillis:20000,statement_timeout:300000});
(async()=>{
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN READ ONLY');
    const mapa = await cliente.query(`SELECT UPPER(TRIM(f_dic_prd_nivel(p.cd_produto, 'CD'::bpchar)))::text AS referencia, p.cd_produto::text AS sku
      FROM vr_prd_prdgrade p
      WHERE UPPER(TRIM(f_dic_prd_nivel(p.cd_produto, 'CD'::bpchar)))::text=ANY($1::text[])`, [refs]);
    console.log('SKUs mapeados para as referências:', mapa.rows.length);
    if (!mapa.rows.length) throw new Error('Nenhum SKU encontrado para as referências.');
    const movimentos = await cliente.query(`SELECT m.cd_produto::text AS sku, m.cd_empresa::text AS empresa,
      m.cd_localorigem::text AS local, MAX(m.ds_localorigem)::text AS nome_local,
      SUM(COALESCE(m.qt_movimento,0))::float AS pecas, COUNT(*)::int AS movimentos,
      COUNT(DISTINCT (m.cd_empresa,m.nr_ciclo,m.nr_op))::int AS ops,
      MIN(m.dt_movimento)::date AS primeiro, MAX(m.dt_movimento)::date AS ultimo
      FROM vr_cdf_movopi m
      WHERE m.cd_produto=ANY($1::bigint[]) AND m.tp_historicomov=51 AND m.in_estorno='F'
      GROUP BY m.cd_produto,m.cd_empresa,m.cd_localorigem`, [mapa.rows.map(r=>r.sku)]);
    const cols = await cliente.query("SELECT column_name FROM information_schema.columns WHERE table_name='vr_pcp_opi' ORDER BY ordinal_position");
    const periodo = await cliente.query('SELECT CURRENT_TIMESTAMP AS consulta');
    await cliente.query('COMMIT');
    fs.writeFileSync('outputs/revisao_producao/auditoria_historico_completo.json', JSON.stringify({refs, sku:mapa.rows, movimentos:movimentos.rows, colunasOp:cols.rows.map(x=>x.column_name), consulta:periodo.rows[0].consulta}));
    console.log(JSON.stringify({referencias:refs.length, skus:mapa.rows.length, movimentosAgrupados:movimentos.rows.length, colunasOp:cols.rows.map(x=>x.column_name), consulta:periodo.rows[0].consulta}));
  } finally { cliente.release(); }
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end());
