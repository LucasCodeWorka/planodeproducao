require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:String(process.env.DB_SSL).toLowerCase()==='true'?{rejectUnauthorized:String(process.env.DB_SSL_REJECT_UNAUTHORIZED).toLowerCase()==='true'}:undefined,connectionTimeoutMillis:20000});
(async()=>{
  const locais=await pool.query("SELECT cd_local::text, ds_local::text FROM pcp_cache_locais ORDER BY cd_local");
  const cols=await pool.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='vr_cdf_movopi' ORDER BY ordinal_position");
  console.log(JSON.stringify({locais:locais.rows, colunas:cols.rows}));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end());
