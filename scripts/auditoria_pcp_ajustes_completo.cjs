require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const rev=JSON.parse(fs.readFileSync('outputs/revisao_producao/revisao.json','utf8'));
const itens=rev.filter(x=>x.revisao.toLowerCase()==='ajuste' || x.observacao.toLowerCase().includes('falta o grupo secundário'));
const refs=[...new Set(itens.map(x=>x.referencia))];
const pool=new Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:String(process.env.DB_SSL).toLowerCase()==='true'?{rejectUnauthorized:String(process.env.DB_SSL_REJECT_UNAUTHORIZED).toLowerCase()==='true'}:undefined,connectionTimeoutMillis:20000,statement_timeout:300000});
(async()=>{
 const client=await pool.connect();
 try {
  await client.query('BEGIN READ ONLY');
  const sku=await client.query(`SELECT UPPER(TRIM(f_dic_prd_nivel(p.cd_produto,'CD'::bpchar)))::text AS referencia,p.cd_produto::text AS sku FROM vr_prd_prdgrade p WHERE UPPER(TRIM(f_dic_prd_nivel(p.cd_produto,'CD'::bpchar)))::text=ANY($1::text[])`,[refs]);
  console.log('Referências:',refs.length,'SKUs mapeados:',sku.rows.length);
  const ids=sku.rows.map(x=>x.sku);
  const mov=await client.query(`SELECT m.cd_produto::text AS sku,m.cd_empresa::text AS empresa,m.cd_localorigem::text AS local,MAX(m.ds_localorigem)::text AS nome_local,SUM(COALESCE(m.qt_movimento,0))::float AS pecas,COUNT(*)::int AS movimentos,COUNT(DISTINCT (m.cd_empresa,m.nr_ciclo,m.nr_op))::int AS ops,MIN(m.dt_movimento)::date AS primeiro,MAX(m.dt_movimento)::date AS ultimo FROM vr_cdf_movopi m WHERE m.cd_produto=ANY($1::bigint[]) AND m.tp_historicomov=51 AND m.in_estorno='F' GROUP BY m.cd_produto,m.cd_empresa,m.cd_localorigem`,[ids]);
  const op=await client.query(`SELECT cd_produto::text AS sku,cd_empresa::text AS empresa,COUNT(*) FILTER (WHERE COALESCE(qt_finalizada,0)>0 AND dt_cancelamento IS NULL)::int AS ops_com_finalizacao,COALESCE(SUM(GREATEST(COALESCE(qt_finalizada,0),0)) FILTER (WHERE dt_cancelamento IS NULL),0)::float AS pecas_finalizadas FROM vr_pcp_opi WHERE cd_produto=ANY($1::bigint[]) GROUP BY cd_produto,cd_empresa`,[ids]);
  await client.query('COMMIT');
  fs.writeFileSync('outputs/revisao_producao/auditoria_ajustes_completo.json',JSON.stringify({refs,sku:sku.rows,movimentos:mov.rows,ordens:op.rows}));
  console.log(JSON.stringify({referencias:refs.length,skus:sku.rows.length,movimentosAgrupados:mov.rows.length,ordensAgrupadas:op.rows.length}));
 } finally {client.release()}
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end());
