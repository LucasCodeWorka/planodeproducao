// Paridade da conta do orcamento de MP em dado REAL: aplica frontend/app/lib/orcamentoMp.ts
// as linhas do cache que a tela /orcamento-mp gravou e compara com a formula antiga do
// preparo do agente. Somente leitura (sessao READ ONLY). Uso: node scripts/conferir-paridade-orcamento-mp.mjs
import 'dotenv/config';
import pg from 'pg';
import { calcularOrcamentoMp } from '../frontend/app/lib/orcamentoMp.ts';

const pool = new pg.Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
  options: '-c default_transaction_read_only=on -c statement_timeout=120000', max: 1,
});
const n = (v) => Number(v || 0);
function antigo(row, opcoes) {
  const per = ['ma', 'px', 'ul', 'qt', 'qu'];
  const compras = (row.finalizados_detalhe || []).filter((i) => n(i.quantidade) > 0 && n(i.valor) > 0)
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
  const ultima = compras[0] ? n(compras[0].valor) / n(compras[0].quantidade) : 0;
  const art = String(row.artigo || '').trim().toUpperCase();
  const preco = art === 'ALCA' || art === 'ALÇA' ? 0 : (ultima || n(opcoes[String(row.idmateriaprima || '').trim()]?.[0]?.value)) / (n(row.fator_conversao) || 1);
  const nec = Math.max(0, per.reduce((s, p) => s + n(row[`consumo_${p}`]), 0) - n(row.estoquetotal) - n(row.entrada_andamento));
  const v = nec * preco;
  return { futuro: v + (v <= 0 ? 0 : Math.max(v * 0.05, 250)), comprado: n(row.entrada_andamento) * preco };
}
try {
  const { rows } = await pool.query(`SELECT updated_at, payload FROM app_orcamento_mp_cache WHERE cache_key = 'orcamento_mp_liebe'`);
  if (!rows.length) throw new Error('cache da tela nao encontrado');
  const { rowsBase = [], priceOptionsByMp = {} } = rows[0].payload;
  let futNovo = 0, futAntigo = 0, compNovo = 0, compAntigo = 0, difs = 0, maior = 0;
  for (const row of rowsBase) {
    const a = antigo(row, priceOptionsByMp);
    const b = calcularOrcamentoMp(row, priceOptionsByMp, 'QU');
    futNovo += b.valorOrcamentoTotal; futAntigo += a.futuro; compNovo += b.valorComprasTotal; compAntigo += a.comprado;
    const d = Math.abs(b.valorOrcamentoTotal - a.futuro) + Math.abs(b.valorComprasTotal - a.comprado);
    if (d > 0.005) { difs += 1; maior = Math.max(maior, d); }
  }
  const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  console.log(JSON.stringify({
    cache: rows[0].updated_at, mps: rowsBase.length,
    futuro: { modulo: brl(futNovo), antigo: brl(futAntigo) },
    comprado: { modulo: brl(compNovo), antigo: brl(compAntigo) },
    mpsDivergentes: difs, maiorDiferenca: brl(maior),
  }, null, 2));
  process.exitCode = difs ? 1 : 0;
} finally { await pool.end(); }
