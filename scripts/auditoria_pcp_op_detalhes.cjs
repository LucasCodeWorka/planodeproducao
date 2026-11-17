require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const base=JSON.parse(fs.readFileSync('outputs/revisao_producao/auditoria_historico_completo.json','utf8'));
const refs=['603410','606790','136124','504053','603187'];
const ids=base.sku.filter(x=>refs.includes(x.referencia)).map(x=>x.sku);
const locais=[82,83,101,102,103,104,105,106,107,108,109,110,111,112,113,114,421,681,722,1241,1402,1422].map(String);
const pool=new Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:String(process.env.DB_SSL).toLowerCase()==='true'?{rejectUnauthorized:String(process.env.DB_SSL_REJECT_UNAUTHORIZED).toLowerCase()==='true'}:undefined,connectionTimeoutMillis:20000,statement_timeout:120000});
(async()=>{
 const movimentos=await pool.query(`SELECT cd_produto::text AS sku, cd_empresa::text AS empresa,nr_ciclo::text AS ciclo,nr_op::text AS op,
   cd_localorigem::text AS local,ds_localorigem AS grupo,dt_movimento::date AS data,qt_movimento::float AS pecas
   FROM vr_cdf_movopi WHERE cd_produto=ANY($1::bigint[]) AND cd_localorigem::text=ANY($2::text[])
   AND dt_movimento>=DATE '2026-11-01' AND tp_historicomov=51 AND in_estorno='F'
   ORDER BY dt_movimento,cd_produto,nr_op`,[ids,locais]);
 const ops=[...new Set(movimentos.rows.map(r=>r.op))];
 const ordens=ops.length ? await pool.query(`SELECT cd_produto::text AS sku,cd_empresa::text AS empresa,nr_ciclo::text AS ciclo,nr_op::text AS op,
   qt_real::float AS quantidade_op,qt_finalizada::float AS finalizada,tp_situacao,dt_cancelamento
   FROM vr_pcp_opi WHERE cd_produto=ANY($1::bigint[]) AND nr_op=ANY($2::bigint[])`,[ids,ops]) : {rows:[]};
 fs.writeFileSync('outputs/revisao_producao/auditoria_op_novembro.json',JSON.stringify({movimentos:movimentos.rows,ordens:ordens.rows}));
 console.log(JSON.stringify({referencias:refs.length,movimentos:movimentos.rows.length,ops:ordens.rows.length}));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end());
