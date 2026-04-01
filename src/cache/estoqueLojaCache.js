/**
 * Sistema de cache para dados de estoque de lojas
 * Armazena em memória os dados calculados de excedentes para melhorar performance
 */

const CACHE_TTL_MINUTES = Number(process.env.ESTOQUE_CACHE_TTL_MINUTES) || 120; // 2 horas padrão

// Cache em memória
let cache = {
  excedente: null,
  excedente_total: null,
  lojas: null,
  estoque: null,
};

let cacheTimestamps = {
  excedente: null,
  excedente_total: null,
  lojas: null,
  estoque: null,
};

/**
 * Verifica se o cache está fresco (dentro do TTL)
 */
function isCacheFresh(key) {
  if (!cacheTimestamps[key]) return false;
  const ageMs = Date.now() - cacheTimestamps[key];
  return ageMs < CACHE_TTL_MINUTES * 60 * 1000;
}

/**
 * Lê dados do cache
 */
function readCache(key) {
  if (!isCacheFresh(key)) return null;

  const data = cache[key];
  if (!data) return null;

  const ageMs = Date.now() - cacheTimestamps[key];
  return {
    data,
    timestamp: cacheTimestamps[key],
    ageMinutes: (ageMs / 60000).toFixed(1),
    fresh: true,
  };
}

/**
 * Escreve dados no cache
 */
function writeCache(key, data) {
  cache[key] = data;
  cacheTimestamps[key] = Date.now();
  console.log(`[estoqueLojaCache] Cache atualizado para '${key}' (${Array.isArray(data) ? data.length : 'N/A'} itens)`);
}

/**
 * Invalida cache específico ou todo o cache
 */
function invalidateCache(key = null) {
  if (key) {
    cache[key] = null;
    cacheTimestamps[key] = null;
    console.log(`[estoqueLojaCache] Cache invalidado para '${key}'`);
  } else {
    // Invalida tudo
    Object.keys(cache).forEach(k => {
      cache[k] = null;
      cacheTimestamps[k] = null;
    });
    console.log('[estoqueLojaCache] Todo o cache foi invalidado');
  }
}

/**
 * Retorna status do cache
 */
function getCacheStatus() {
  const status = {};

  Object.keys(cache).forEach(key => {
    if (cacheTimestamps[key]) {
      const ageMs = Date.now() - cacheTimestamps[key];
      const ageMinutes = (ageMs / 60000).toFixed(1);
      const fresh = ageMs < CACHE_TTL_MINUTES * 60 * 1000;

      status[key] = {
        exists: true,
        timestamp: cacheTimestamps[key],
        updatedAt: new Date(cacheTimestamps[key]).toLocaleString('pt-BR'),
        ageMinutes: Number(ageMinutes),
        fresh,
        itemCount: Array.isArray(cache[key]) ? cache[key].length : null,
      };
    } else {
      status[key] = {
        exists: false,
        fresh: false,
      };
    }
  });

  return {
    ttl_minutes: CACHE_TTL_MINUTES,
    caches: status,
  };
}

/**
 * Gera chave de cache baseada em parâmetros
 */
function getCacheKey(baseKey, params = {}) {
  const sortedParams = Object.keys(params)
    .sort()
    .map(k => `${k}:${params[k]}`)
    .join('|');

  return sortedParams ? `${baseKey}_${sortedParams}` : baseKey;
}

/**
 * Wrapper para usar cache com fallback para função de dados
 *
 * Uso:
 * const data = await withCache('lojas', async () => {
 *   return await buscarLojas(pool);
 * });
 */
async function withCache(key, dataFn, forceRefresh = false) {
  // Se forçar refresh, ignora cache
  if (!forceRefresh) {
    const cached = readCache(key);
    if (cached) {
      console.log(`[estoqueLojaCache] Cache HIT para '${key}' (idade: ${cached.ageMinutes}min)`);
      return cached.data;
    }
  }

  // Cache miss ou forçado - busca dados frescos
  console.log(`[estoqueLojaCache] Cache MISS para '${key}' - buscando dados...`);
  const data = await dataFn();
  writeCache(key, data);
  return data;
}

module.exports = {
  readCache,
  writeCache,
  invalidateCache,
  getCacheStatus,
  isCacheFresh,
  getCacheKey,
  withCache,
};
