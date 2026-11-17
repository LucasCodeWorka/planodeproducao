require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:String(process.env.DB_SSL).toLowerCase()==='true'?{rejectUnauthorized:String(process.env.DB_SSL_REJECT_UNAUTHORIZED).toLowerCase()==='true'}:undefined,connectionTimeoutMillis:20000});
(async()=>{
 const f=await pool.query("SELECT pg_get_functiondef(p.oid) AS definicao FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname='f_dic_prd_nivel' AND n.nspname='public' LIMIT 2");
 const v=await pool.query("SELECT pg_get_viewdef('vr_prd_prdgrade'::regclass,true) AS definicao");
 const op=await pool.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='vr_pcp_opi' ORDER BY ordinal_position");
 console.log(JSON.stringify({funcoes:f.rows,grade:v.rows,op:op.rows}));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end());
