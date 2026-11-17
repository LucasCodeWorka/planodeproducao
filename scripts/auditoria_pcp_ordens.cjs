require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const base=JSON.parse(fs.readFileSync('outputs/revisao_producao/auditoria_historico_completo.json','utf8'));
const ids=base.sku.map(x=>x.sku);
const pool=new Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:String(process.env.DB_SSL).toLowerCase()==='true'?{rejectUnauthorized:String(process.env.DB_SSL_REJECT_UNAUTHORIZED).toLowerCase()==='true'}:undefined,connectionTimeoutMillis:20000,statement_timeout:300000});
(async()=>{
 const {rows}=await pool.query(`SELECT cd_produto::text AS sku, cd_empresa::text AS empresa,
  COUNT(*) FILTER (WHERE COALESCE(qt_finalizada,0)>0 AND dt_cancelamento IS NULL)::int AS ops_com_finalizacao,
  COALESCE(SUM(GREATEST(COALESCE(qt_finalizada,0),0)) FILTER (WHERE dt_cancelamento IS NULL),0)::float AS pecas_finalizadas,
  COUNT(*) FILTER (WHERE dt_cancelamento IS NOT NULL)::int AS ops_canceladas,
  MIN(dt_inclusao)::date AS primeira_inclusao,MAX(dt_inclusao)::date AS ultima_inclusao
  FROM vr_pcp_opi WHERE cd_produto=ANY($1::bigint[]) GROUP BY cd_produto,cd_empresa`,[ids]);
 fs.writeFileSync('outputs/revisao_producao/auditoria_ordens_32.json',JSON.stringify(rows));
 console.log(JSON.stringify({skusConsultados:ids.length, registros:rows.length,skusComFinalizacao:rows.filter(x=>x.pecas_finalizadas>0).length}));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end());
