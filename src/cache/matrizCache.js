const fs   = require('fs');
const path = require('path');

const CACHE_FILE     = path.join(__dirname, '../../data/matriz_cache.json');
const CACHE_TTL_HOURS = Number(process.env.CACHE_TTL_HOURS) || 24;

function readCache() {
  try {
    const raw   = fs.readFileSync(CACHE_FILE, 'utf-8');
    const cache = JSON.parse(raw);
    if (!Array.isArray(cache.data) || cache.data.length === 0) return null;
    const ageMs = Date.now() - cache.timestamp;
    return {
      data:      cache.data,
      timestamp: cache.timestamp,
      ageHours:  ageMs / 3_600_000,
      fresh:     ageMs < CACHE_TTL_HOURS * 3_600_000,
      meta:      cache.meta || {}
    };
  } catch {
    return null;
  }
}

function writeCache(data, meta = {}) {
  const dir = path.dirname(CACHE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    CACHE_FILE,
    JSON.stringify({ timestamp: Date.now(), count: data.length, meta, data })
  );
}

function getCacheStatus() {
  try {
    const raw   = fs.readFileSync(CACHE_FILE, 'utf-8');
    const cache = JSON.parse(raw);
    const ageMs = Date.now() - cache.timestamp;
    return {
      exists:    true,
      timestamp: cache.timestamp,
      updatedAt: new Date(cache.timestamp).toLocaleString('pt-BR'),
      ageHours:  +(ageMs / 3_600_000).toFixed(1),
      count:     cache.count || (Array.isArray(cache.data) ? cache.data.length : 0),
      fresh:     ageMs < CACHE_TTL_HOURS * 3_600_000,
      meta:      cache.meta || {}
    };
  } catch {
    return { exists: false, fresh: false };
  }
}

// Aplica filtros em memória no cache (evita query ao banco)
function filterCache(cacheData, { referencias = [], marca = null, status = null } = {}) {
  let result = cacheData.filter((r) => {
    const apresentacao = String(r?.produto?.apresentacao || '').toUpperCase();
    const produto = String(r?.produto?.produto || '').toUpperCase();
    return !apresentacao.includes('MEIA DE SEDA') && !produto.includes('MEIA DE SEDA');
  });
  if (marca) {
    const m = marca.toUpperCase().trim();
    result = result.filter(r => (r.produto?.marca || '').toUpperCase().trim() === m);
  }
  if (status) {
    const s = status.toUpperCase().trim();
    result = result.filter((r) => {
      const st = (r.produto?.status || '').toUpperCase().trim();
      return st.startsWith(s);
    });
  }
  if (referencias.length > 0) {
    const refSet = new Set(referencias.map(r => r.trim()));
    result = result.filter(r => refSet.has((r.produto?.referencia || '').trim()));
  }
  return result;
}

module.exports = { readCache, writeCache, getCacheStatus, filterCache };
