// Verifica a rota publicada com mais de 500 codigos reais, sem gravar dados.
import 'dotenv/config';
import pg from 'pg';

const api = process.env.ORCAMENTO_API_URL || 'https://planodeproducao-api.onrender.com';
const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
    ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true' }
    : undefined,
});

try {
  const { rows } = await pool.query("SELECT payload FROM public.app_orcamento_mp_cache WHERE cache_key='orcamento_mp_liebe'");
  if (rows.length !== 1) throw new Error('Cache do Orcamento MP ausente');
  const cache = rows[0].payload;
  const requestedLimit = Number(process.argv[2] || 501);
  const codes = [...new Set([...(cache.rowsBase || []), ...(cache.rowsOriginalBase || [])]
    .map((row) => String(row.idmateriaprima || '').trim()).filter(Boolean))].slice(0, requestedLimit);
  if (codes.length < requestedLimit) throw new Error(`Somente ${codes.length} MPs disponiveis`);

  const response = await fetch(`${api}/api/totvs-moda/prices/mp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ADMIN_PASSWORD}` },
    body: JSON.stringify({ productCodes: codes }),
    signal: AbortSignal.timeout(180000),
  });
  const result = await response.json();
  const returned = Object.keys(result.data || {});
  console.log(JSON.stringify({ status: response.status, success: result.success, requested: codes.length,
    returned: returned.length, rawCount: result.rawCount, error: result.error || null }));
  if (!response.ok || !result.success || returned.length !== codes.length) process.exitCode = 1;
} finally {
  await pool.end();
}
