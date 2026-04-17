const CACHE_TTL_HOURS = Number(process.env.CACHE_TTL_HOURS) || 24;
const CACHE_KEY = 'matriz_planejamento';

let _pool = null;

function resolveCacheCount(payload) {
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload?.data)) return payload.data.length;
  if (Number.isFinite(payload?.totalReferencias)) return Number(payload.totalReferencias);
  if (Number.isFinite(payload?.count)) return Number(payload.count);
  return 0;
}

async function initCache(pool) {
  _pool = pool;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_cache (
        key       TEXT    PRIMARY KEY,
        timestamp BIGINT  NOT NULL,
        data      TEXT    NOT NULL
      )
    `);
    console.log('[matrizCache] Tabela app_cache pronta');
  } catch (err) {
    console.error('[matrizCache] Erro ao criar tabela app_cache:', err.message);
  }
}

async function readCacheByKey(key = CACHE_KEY) {
  if (!_pool) return null;
  try {
    const res = await _pool.query(
      'SELECT timestamp, data FROM app_cache WHERE key = $1',
      [key]
    );
    if (res.rows.length === 0) return null;
    const { timestamp, data } = res.rows[0];
    const cache = JSON.parse(data);
    if (cache.data === undefined || cache.data === null) return null;
    const ageMs = Date.now() - Number(timestamp);
    return {
      data:      cache.data,
      timestamp: Number(timestamp),
      ageHours:  ageMs / 3_600_000,
      fresh:     ageMs < CACHE_TTL_HOURS * 3_600_000,
      meta:      cache.meta || {}
    };
  } catch (err) {
    console.error(`[matrizCache] readCache erro (${key}):`, err.message);
    return null;
  }
}

async function writeCacheByKey(key = CACHE_KEY, data, meta = {}) {
  if (!_pool) return;
  const timestamp = Date.now();
  const json = JSON.stringify({ timestamp, count: resolveCacheCount(data), meta, data });
  await _pool.query(
    `INSERT INTO app_cache (key, timestamp, data)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE
       SET timestamp = EXCLUDED.timestamp,
           data      = EXCLUDED.data`,
    [key, timestamp, json]
  );
}

async function getCacheStatusByKey(key = CACHE_KEY) {
  if (!_pool) return { exists: false, fresh: false };
  try {
    const res = await _pool.query(
      'SELECT timestamp, data FROM app_cache WHERE key = $1',
      [key]
    );
    if (res.rows.length === 0) return { exists: false, fresh: false };
    const { timestamp, data } = res.rows[0];
    const cache  = JSON.parse(data);
    const ageMs  = Date.now() - Number(timestamp);
    return {
      exists:    true,
      timestamp: Number(timestamp),
      updatedAt: new Date(Number(timestamp)).toLocaleString('pt-BR'),
      ageHours:  +(ageMs / 3_600_000).toFixed(1),
      count:     cache.count || resolveCacheCount(cache.data),
      fresh:     ageMs < CACHE_TTL_HOURS * 3_600_000,
      meta:      cache.meta || {}
    };
  } catch (err) {
    console.error(`[matrizCache] getCacheStatus erro (${key}):`, err.message);
    return { exists: false, fresh: false };
  }
}

async function readCache() {
  return readCacheByKey(CACHE_KEY);
}

async function writeCache(data, meta = {}) {
  return writeCacheByKey(CACHE_KEY, data, meta);
}

async function getCacheStatus() {
  return getCacheStatusByKey(CACHE_KEY);
}

function normalizeStatus(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function filterCache(cacheData, { referencias = [], marca = null, status = null } = {}) {
  let result = cacheData.filter((r) => {
    const apresentacao = String(r?.produto?.apresentacao || '').toUpperCase();
    const produto      = String(r?.produto?.produto      || '').toUpperCase();
    const tamanho = String(r?.produto?.tamanho || '').trim().toUpperCase();
    return !apresentacao.includes('MEIA DE SEDA') && !produto.includes('MEIA DE SEDA') && tamanho !== 'PT 99';
  });
  if (marca) {
    const m = marca.toUpperCase().trim();
    result = result.filter(r => (r.produto?.marca || '').toUpperCase().trim() === m);
  }
  if (status) {
    const statuses = String(status)
      .split(',')
      .map((s) => normalizeStatus(s))
      .filter(Boolean);
    result = result.filter((r) => {
      const st = normalizeStatus(r.produto?.status || '');
      return statuses.includes(st);
    });
  }
  if (referencias.length > 0) {
    const refSet = new Set(referencias.map(r => r.trim()));
    result = result.filter(r => refSet.has((r.produto?.referencia || '').trim()));
  }
  return result;
}

module.exports = {
  initCache,
  readCache,
  writeCache,
  getCacheStatus,
  readCacheByKey,
  writeCacheByKey,
  getCacheStatusByKey,
  filterCache
};
