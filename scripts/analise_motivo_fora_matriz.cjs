require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const d = JSON.parse(fs.readFileSync('outputs/novembro_skus/dados.json', 'utf8'));
const ids = d.linhas.filter(x => !x.encontrado).map(x => x.sku);
const pool = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: String(process.env.DB_SSL).toLowerCase() === 'true' ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED).toLowerCase() === 'true' } : undefined, connectionTimeoutMillis: 20000 });
(async () => {
  const c = await pool.query("SELECT data FROM app_cache WHERE key='matriz_planejamento'");
  const cache = JSON.parse(c.rows[0].data);
  const dados = await pool.query(`SELECT cd_produto::text AS sku, nm_produto AS apresentacao, ds_tamanho AS tamanho, ds_cor AS cor,
    f_dic_prd_nivel(cd_produto,'CD'::bpchar)::text AS referencia,
    f_dic_prd_classificacao(cd_produto,'DS'::text,20::bigint)::text AS marca,
    f_dic_prd_classificacao(cd_produto,'DS'::text,27::bigint)::text AS status,
    f_dic_prd_classificacao(cd_produto,'DS'::text,802::bigint)::text AS continuidade
    FROM vr_prd_prdgrade WHERE cd_produto=ANY($1::bigint[])`, [ids]);
  const matriz = cache.data?.rows || [];
  const destinos = matriz.map((x) => ({ idproduto: String(x?.produto?.idproduto || ''), referencia: String(x?.produto?.referencia || ''), cor: x?.produto?.cor, tamanho: x?.produto?.tamanho }));
  fs.writeFileSync('outputs/novembro_skus/diagnostico_cadastro.json', JSON.stringify({meta: cache.meta || {}, rows: dados.rows, destinos}));
  console.log(JSON.stringify({meta: cache.meta || {}, solicitados: ids.length, encontrados: dados.rows.length}));
})().catch(e => { console.error(e.message); process.exitCode=1; }).finally(() => pool.end());
