// Detecta nomes quase iguais antes de propor novos itens FCPFM003.
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const file = '.agents/totvs_agent_minimo/data/mapeamento-compras-orcamento-mp-2026-10-27.json';
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const output = '.agents/totvs_agent_minimo/data/similaridade-despesas-orcamento-mp-2026-10-27.json';
const pool = new pg.Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
    ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true' }
    : undefined,
});
const norm = (s) => String(s || '').toUpperCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim().replace(/ U$/, '');
const grams = (s) => {
  const value = ` ${s} `;
  const set = new Set();
  for (let i = 0; i + 2 < value.length; i++) set.add(value.slice(i, i + 3));
  return set;
};
const similarity = (left, right) => {
  let common = 0;
  for (const part of left) if (right.has(part)) common++;
  return 2 * common / (left.size + right.size || 1);
};
try {
  const { rows } = await pool.query(`
    SELECT cd_despesaitem::int AS codigo, ds_despesaitem AS nome, ds_original
    FROM vr_fcp_despesaitem WHERE cd_despesaitem IS NOT NULL
  `);
  const list = rows.flatMap((row) => [row.nome, row.ds_original]
    .map((name) => ({ codigo: row.codigo, nome: name, normalized: norm(name) }))
    .filter((item) => item.normalized));
  const indexed = new Map();
  for (const item of list) {
    const first = item.normalized.split(' ')[0];
    if (!indexed.has(first)) indexed.set(first, []);
    indexed.get(first).push({ ...item, gram: grams(item.normalized) });
  }
  const findings = report.findings.map((item) => {
    const normalized = norm(item.nomeProduto);
    const first = normalized.split(' ')[0];
    const own = grams(normalized);
    const candidates = (indexed.get(first) || []).map((other) => ({
      codigo: other.codigo, nome: other.nome,
      score: Math.round(similarity(own, other.gram) * 1000) / 1000,
    })).filter((other) => other.score >= 0.78)
      .sort((a, b) => b.score - a.score).slice(0, 5);
    return { mp: item.mp, nomeProduto: item.nomeProduto,
      comprado: item.comprado, futuro: item.futuro, candidatos: candidates };
  });
  const high = findings.filter((item) => item.candidatos[0]?.score >= 0.9);
  fs.writeFileSync(output, JSON.stringify({ totalDespesas: rows.length, findings }, null, 2) + '\n');
  console.log(JSON.stringify({ output, totalDespesas: rows.length,
    mps: findings.length, altaSimilaridade: high.length,
    top: high.slice(0, 20) }, null, 2));
} finally {
  await pool.end();
}
