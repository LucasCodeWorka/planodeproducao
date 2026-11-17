require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const revisao = JSON.parse(fs.readFileSync('outputs/revisao_producao/comparacao_simulacao.json', 'utf8'));
const refs = revisao.filter(x => x.revisao.toLowerCase()==='corretas' && x.opcoes?.length && x.revisado.length && x.opcoes[0].grupo !== x.revisado[0]).map(x => x.referencia);
const locais = [82,83,101,102,103,104,105,106,107,108,109,110,111,112,113,114,421,681,722,1241,1402,1422].map(String);
const pool = new Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:String(process.env.DB_SSL).toLowerCase()==='true'?{rejectUnauthorized:String(process.env.DB_SSL_REJECT_UNAUTHORIZED).toLowerCase()==='true'}:undefined,connectionTimeoutMillis:20000});
(async()=>{
  const {rows} = await pool.query(`SELECT UPPER(TRIM(f_dic_prd_nivel(m.cd_produto,'CD'::bpchar)))::text AS referencia,
    m.cd_localorigem::text AS local, SUM(COALESCE(m.qt_movimento,0))::float AS pecas,
    MIN(m.dt_movimento)::date AS primeiro, MAX(m.dt_movimento)::date AS ultimo
    FROM vr_cdf_movopi m WHERE m.tp_historicomov=51 AND m.in_estorno='F'
    AND m.cd_localorigem::text=ANY($1::text[])
    AND m.dt_movimento>=DATE_TRUNC('month',CURRENT_DATE - INTERVAL '24 months')::date
    AND m.dt_movimento<DATE_TRUNC('month',CURRENT_DATE)::date
    AND UPPER(TRIM(f_dic_prd_nivel(m.cd_produto,'CD'::bpchar)))::text=ANY($2::text[])
    GROUP BY 1,2`, [locais,refs]);
  const nomes = await pool.query('SELECT cd_local::text AS local, UPPER(TRIM(ds_local::text)) AS grupo FROM pcp_cache_locais WHERE cd_local::text=ANY($1::text[])',[locais]);
  const mapa = new Map(nomes.rows.map(x=>[x.local,x.grupo]));
  const dados=rows.map(x=>({...x,grupo:mapa.get(x.local)||x.local}));
  fs.writeFileSync('outputs/revisao_producao/historico_32_24meses.json',JSON.stringify(dados));
  console.log(JSON.stringify({referencias:refs.length,comHistorico:new Set(dados.map(x=>x.referencia)).size,vinculos:dados.length}));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end());
