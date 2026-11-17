require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const p = new Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:String(process.env.DB_SSL).toLowerCase()==='true'?{rejectUnauthorized:String(process.env.DB_SSL_REJECT_UNAUTHORIZED).toLowerCase()==='true'}:undefined,connectionTimeoutMillis:20000});
(async()=>{const r=await p.query('SELECT grupo, capacidade_diaria FROM app_capacidade_grupos');fs.writeFileSync('outputs/revisao_producao/grupos.json',JSON.stringify(r.rows));console.log('Grupos cadastrados:',r.rows.length)})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.end());
