// Reproduz a carga principal de /orcamento-mp pela API local e publica um cache v4.
// Guarda uma copia do cache anterior antes da gravacao.
import 'dotenv/config';
import fs from 'node:fs';

const api = process.env.ORCAMENTO_API_URL || 'http://127.0.0.1:8000';
const token = String(process.env.ADMIN_PASSWORD || '').trim();
if (!token) throw new Error('ADMIN_PASSWORD ausente');
const headers = { Authorization: `Bearer ${token}` };
const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
const periods = ['MA', 'PX', 'UL', 'QT', 'QU'];

async function request(path, options = {}, timeout = 600000) {
  const response = await fetch(`${api}${path}`, { ...options, signal: AbortSignal.timeout(timeout) });
  const payload = await response.json();
  if (!response.ok || payload?.success !== true) {
    throw new Error(`${path}: HTTP ${response.status}: ${payload?.error || payload?.details || 'resposta invalida'}`);
  }
  return payload;
}

const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const n = (value) => Number(value || 0);
const planOf = (item, override) => {
  const plan = override || item.plano_original || item.plano || {};
  return { idproduto: String(item.produto?.idproduto || ''),
    idreferencia: String(item.produto?.cd_seqgrupo || ''),
    ma: n(plan.ma), px: n(plan.px), ul: n(plan.ul), qt: n(plan.qt), qu: n(plan.qu) };
};
const active = (plan) => plan.idproduto && plan.ma + plan.px + plan.ul + plan.qt + plan.qu > 0;
const pieces = (plans) => Object.fromEntries(periods.map((period) =>
  [period, plans.reduce((sum, plan) => sum + n(plan[period.toLowerCase()]), 0)]));

function card(rows, prices) {
  let bought = 0;
  let future = 0;
  let withoutCost = 0;
  for (const row of rows) {
    const code = String(row.idmateriaprima || '').trim();
    const noCostArticle = ['ALCA', 'ALÇA'].includes(String(row.artigo || '').trim().toUpperCase());
    let price = 0;
    if (!noCostArticle) {
      const latest = (Array.isArray(row.finalizados_detalhe) ? row.finalizados_detalhe : [])
        .filter((item) => n(item.quantidade) > 0 && n(item.valor) > 0)
        .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))[0];
      const raw = latest ? n(latest.valor) / n(latest.quantidade) : n(prices[code]?.[0]?.value);
      const factor = n(row.fator_conversao) || 1;
      price = factor > 1 ? raw / factor : raw;
    }
    const consumption = periods.reduce((sum, period) => sum + n(row[`consumo_${period.toLowerCase()}`]), 0);
    const need = Math.max(0, consumption - n(row.estoquetotal) - n(row.entrada_andamento));
    const value = need * price;
    bought += n(row.entrada_andamento) * price;
    future += value > 0 ? value + Math.max(value * 0.05, 250) : 0;
    if (need > 0 && price <= 0 && !noCostArticle) withoutCost++;
  }
  return { bought: round(bought), future: round(future), total: round(bought + future), withoutCost };
}

async function optional(path, transform, fallback) {
  try {
    return transform(await request(path, { headers }, 180000));
  } catch (error) {
    console.log('opcional_falhou', path, error.message);
    return fallback;
  }
}

const current = await request('/api/producao/orcamento-mp-cache', { headers }, 60000);
if (current.exists && current.data) {
  const backup = `.agents/totvs_agent_minimo/data/backup-orcamento-mp-cache-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(backup, JSON.stringify({ updatedAt: current.updatedAt, payload: current.data }) + '\n');
  console.log('backup', backup, 'versao', current.data.version);
}

const params = new URLSearchParams({ limit: '3000', marca: 'LIEBE',
  status: 'EM LINHA,NOVA COLECAO', prefer_cache: 'true' });
const matrix = (await request(`/api/producao/matriz?${params}`)).data || [];
if (matrix.length < 2800) throw new Error(`Matriz incompleta: ${matrix.length} SKUs`);
console.log('matriz', matrix.length);

const productIds = matrix.map((item) => String(item.produto?.idproduto || '')).filter(Boolean);
const original = (await request('/api/producao/plano-original', {
  method: 'POST', headers: jsonHeaders, body: JSON.stringify({ productIds }),
}, 120000)).data || {};
const plans = matrix.map((item) => planOf(item, item.plano)).filter(active);
const originalPlans = matrix.map((item) =>
  planOf(item, original[String(item.produto?.idproduto || '')])).filter(active);
console.log('planos', plans.length, 'originais', originalPlans.length);

const analyse = (plansInput) => request('/api/consumo-mp/analise', {
  method: 'POST', headers: jsonHeaders,
  body: JSON.stringify({ planos: plansInput, multinivel: true }),
}, 600000);
const [currentAnalysis, originalAnalysis] = await Promise.all([analyse(plans), analyse(originalPlans)]);
const rowsBase = currentAnalysis.data || [];
const rowsOriginalBase = originalAnalysis.data || [];
if (rowsBase.length < 1300 || rowsOriginalBase.length < 1300) {
  throw new Error(`Analise incompleta: atual=${rowsBase.length}, original=${rowsOriginalBase.length}`);
}
console.log('mps', rowsBase.length, rowsOriginalBase.length);

const codes = [...new Set([...rowsBase, ...rowsOriginalBase]
  .map((row) => String(row.idmateriaprima || '').trim()).filter(Boolean))];
const priceOptionsByMp = {};
for (let index = 0; index < codes.length; index += 500) {
  const batch = codes.slice(index, index + 500);
  const result = await request('/api/totvs-moda/prices/mp', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ productCodes: batch }),
  }, 180000);
  const missing = batch.filter((code) => !(code in (result.data || {})));
  if (missing.length) throw new Error(`Lote ${index / 500 + 1}: ${missing.length} MPs sem custo retornado`);
  Object.assign(priceOptionsByMp, result.data);
  console.log('precos', Object.keys(priceOptionsByMp).length, '/', codes.length);
}

const calculated = card(rowsBase, priceOptionsByMp);
if (calculated.total < 1800000 || calculated.total > 2200000 || calculated.withoutCost > 0) {
  throw new Error(`Total incoerente: ${JSON.stringify(calculated)}`);
}
console.log('total_calculado', JSON.stringify(calculated));

const percentualPorPeriodo = await optional(
  '/api/producao/percentual-finalizado?marca=LIEBE&status=EM LINHA,NOVA COLECAO',
  (value) => value.data || {}, {});
const consumoMpLotes = await optional(
  '/api/producao/consumo-mp-lotes?marca=LIEBE&status=EM LINHA,NOVA COLECAO',
  (value) => Object.fromEntries(['data', 'gerouOp', 'pendente', 'qtdLote', 'qtdGerouOp']
    .map((key) => [key, value[key] || Object.fromEntries(periods.map((period) => [period, 0]))])), null);
const dias = await optional('/api/capacidade/dias-resumo', (value) => value, null);
let diasFaltantesPorPeriodo = Object.fromEntries(periods.map((period) => [period, null]));
let diasCapacidade = null;
if (dias) {
  let available = 0;
  diasFaltantesPorPeriodo = Object.fromEntries(periods.map((period) => {
    available += n(dias.diasDisponiveis?.[period]);
    return [period, n(dias.diasAcumulado?.[period]) - available];
  }));
  diasCapacidade = { porPeriodo: Object.fromEntries(periods.map((period) => [period, n(dias.diasNecessarios?.[period])])),
    acumulado: Object.fromEntries(periods.map((period) => [period, n(dias.diasAcumulado?.[period])])),
    capacidadeDiaria: n(dias.capacidadeDiaria) };
}
const opsAntigas = await optional(
  '/api/producao/ops-antigas?dias=20&marca=LIEBE&status=EM LINHA,NOVA COLECAO',
  (value) => ({ qtdTotal: n(value.totais?.qtdTotal), opsCount: n(value.totais?.opsCount),
    porFaixa: value.porFaixa || {}, data: Array.isArray(value.data) ? value.data : [] }), null);

const payload = { version: 4, rowsBase, rowsOriginalBase, priceOptionsByMp,
  createdAt: new Date().toISOString(), percentualPorPeriodo, diasFaltantesPorPeriodo,
  diasCapacidade, opsAntigas, pecasPAPorPeriodo: pieces(plans),
  pecasPAOriginalPorPeriodo: pieces(originalPlans), consumoMpLotes };
const bytes = Buffer.byteLength(JSON.stringify({ payload }));
console.log('payload_bytes', bytes);
if (bytes >= 10 * 1024 * 1024) throw new Error('Payload excede limite da API; nao gravado');
const saved = await request('/api/producao/orcamento-mp-cache', {
  method: 'POST', headers: jsonHeaders, body: JSON.stringify({ payload }),
}, 120000);
const confirmed = await request('/api/producao/orcamento-mp-cache', { headers }, 60000);
const confirmedCard = card(confirmed.data?.rowsBase || [], confirmed.data?.priceOptionsByMp || {});
if (confirmed.data?.version !== 4 ||
    Object.keys(confirmed.data?.priceOptionsByMp || {}).length !== codes.length ||
    confirmedCard.total !== calculated.total) {
  throw new Error(`Cache gravado mas conferencia falhou: ${JSON.stringify(confirmedCard)}`);
}
console.log('cache_atualizado', JSON.stringify({ updatedAt: saved.updatedAt, version: confirmed.data.version,
  skus: matrix.length, mps: rowsBase.length, codes: codes.length, card: confirmedCard }));
