// Reproduz a busca de custos da pagina com os codigos do cache persistido.
// Somente leitura no banco e na API de custos; nao atualiza o cache.
import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pool = new pg.Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
    ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true' }
    : undefined,
});
let server;
try {
  const { rows } = await pool.query(`
    SELECT payload FROM public.app_orcamento_mp_cache
    WHERE cache_key='orcamento_mp_liebe'
  `);
  if (rows.length !== 1) throw new Error('Cache do Orcamento MP ausente');
  const cache = rows[0].payload;
  const codigos = [...new Set([...(cache.rowsBase || []), ...(cache.rowsOriginalBase || [])]
    .map((row) => String(row.idmateriaprima || '').trim()).filter(Boolean))];
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api/totvs-moda', require('../src/routes/totvsModa'));
  server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const retornados = new Set();
  const faltantes = [];
  for (let inicio = 0; inicio < codigos.length; inicio += 500) {
    const lote = codigos.slice(inicio, inicio + 500);
    const resposta = await fetch(`http://127.0.0.1:${server.address().port}/api/totvs-moda/prices/mp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ADMIN_PASSWORD}` },
      body: JSON.stringify({ productCodes: lote }),
      signal: AbortSignal.timeout(180000),
    });
    const payload = await resposta.json();
    if (!resposta.ok || !payload.success) throw new Error(`Lote ${inicio / 500 + 1}: ${payload.error || resposta.status}`);
    for (const codigo of Object.keys(payload.data || {})) retornados.add(codigo);
    faltantes.push(...lote.filter((codigo) => !(codigo in (payload.data || {}))));
  }
  const resultado = {
    linhasAtuais: cache.rowsBase?.length || 0,
    linhasOriginais: cache.rowsOriginalBase?.length || 0,
    codigosUnicos: codigos.length,
    precosNoCache: Object.keys(cache.priceOptionsByMp || {}).length,
    precosConsultados: retornados.size,
    faltantes: faltantes.slice(0, 20),
    totalFaltantes: faltantes.length,
  };
  console.log(JSON.stringify(resultado, null, 2));
  if (faltantes.length) process.exitCode = 1;
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
}
