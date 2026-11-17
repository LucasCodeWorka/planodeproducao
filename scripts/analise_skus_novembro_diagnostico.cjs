require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: String(process.env.DB_SSL).toLowerCase() === 'true' ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED).toLowerCase() === 'true' } : undefined, connectionTimeoutMillis: 12000 });
(async () => {
  const r = await pool.query("SELECT key, timestamp, length(data) AS tamanho FROM app_cache WHERE key LIKE '%matriz%' ORDER BY timestamp DESC LIMIT 10");
  console.log(JSON.stringify(r.rows));
  const p = await pool.query("SELECT ano, mes, count(*)::int AS registros FROM app_projecoes WHERE ano IN (2026,2027) AND mes IN (11,12) GROUP BY 1,2 ORDER BY 1,2");
  console.log(JSON.stringify(p.rows));
  const cache = await pool.query("SELECT data FROM app_cache WHERE key='matriz_planejamento'");
  const conteudo = JSON.parse(cache.rows[0].data);
  const linhas = conteudo.data?.rows || conteudo.data?.data || conteudo.data;
  const fs = require('fs');
  fs.writeFileSync('outputs/novembro_skus/matriz_destinos.json', JSON.stringify(linhas.map(x => ({ idproduto: String(x?.produto?.idproduto || ''), referencia: String(x?.produto?.referencia || ''), cor: x?.produto?.cor, tamanho: x?.produto?.tamanho }))));
  console.log('estrutura', JSON.stringify({chaves: Object.keys(conteudo), data: Object.keys(conteudo.data || {}), quantidade: linhas?.length, exemplo: Array.isArray(linhas) ? linhas.find(x => String(x?.produto?.idproduto)==='4129') || linhas[0] : null}));
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
