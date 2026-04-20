const express  = require('express');
const { buscarMatrizPlanejamentoRapida } = require('../services/producaoService');
const { writeCache, writeCacheByKey, getCacheStatus }     = require('../cache/matrizCache');
const { calcularCurvaAbcReferencias } = require('../services/curvaAbcService');

const CURVA_ABC_CACHE_KEY = 'curva_abc_referencias';

const router = express.Router();

// ── estado do build em memória ────────────────────────────────────────────────
let buildState = {
  running:    false,
  startedAt:  null,
  finishedAt: null,
  error:      null,
  count:      null,
  durationMs: null
};

// ── autenticação simples ──────────────────────────────────────────────────────
function auth(req, res, next) {
  const token    = (req.headers.authorization || '').replace('Bearer ', '').trim();
  const expected = (process.env.ADMIN_PASSWORD || '').trim();
  if (!expected) return res.status(500).json({ success: false, error: 'ADMIN_PASSWORD não configurado no servidor' });
  if (token !== expected) return res.status(401).json({ success: false, error: 'Não autorizado' });
  next();
}

// ── POST /api/admin/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { password } = req.body || {};
  const expected     = (process.env.ADMIN_PASSWORD || '').trim();

  if (!expected) return res.status(500).json({ success: false, error: 'ADMIN_PASSWORD não configurado' });
  if (!password || password.trim() !== expected) {
    return res.status(401).json({ success: false, error: 'Senha incorreta' });
  }

  return res.json({
    success: true,
    token:   expected,
    cache:   await getCacheStatus()
  });
});

// ── GET /api/admin/status ─────────────────────────────────────────────────────
router.get('/status', auth, async (req, res) => {
  return res.json({ success: true, cache: await getCacheStatus() });
});

// ── GET /api/admin/build-status ───────────────────────────────────────────────
router.get('/build-status', auth, async (req, res) => {
  return res.json({ success: true, buildState, cache: await getCacheStatus() });
});

// ── POST /api/admin/refresh ───────────────────────────────────────────────────
router.post('/refresh', auth, (req, res) => {
  if (buildState.running) {
    return res.json({ success: true, started: false, alreadyRunning: true });
  }

  const pool  = req.app.get('pool');
  const marcaRaw = req.body && typeof req.body.marca === 'string'
    ? req.body.marca.trim()
    : '';
  const statusRaw = req.body && typeof req.body.status === 'string'
    ? req.body.status.trim()
    : '';
  const marca = marcaRaw || null;
  const status = statusRaw || null;

  buildState = {
    running:    true,
    startedAt:  Date.now(),
    finishedAt: null,
    error:      null,
    count:      null,
    durationMs: null
  };

  console.log(`[admin/refresh] Iniciando rebuild em background — marca: ${marca}, status: ${status}`);

  (async () => {
    try {
      const data = await buscarMatrizPlanejamentoRapida(pool, { marca, status });
      if (data.length === 0) throw new Error('Rebuild retornou 0 produtos — cache não gravado');
      await writeCache(data, { marca, status, geradoPor: 'admin/refresh' });
      const curvaAbc = await calcularCurvaAbcReferencias(pool);
      await writeCacheByKey(CURVA_ABC_CACHE_KEY, curvaAbc, {
        marca: 'LIEBE',
        status: 'EM LINHA',
        geradoPor: 'admin/refresh'
      });

      const ms = Date.now() - buildState.startedAt;
      console.log(`[admin/refresh] Cache reconstruído: ${data.length} produtos em ${ms}ms`);

      buildState = {
        running:    false,
        startedAt:  buildState.startedAt,
        finishedAt: Date.now(),
        error:      null,
        count:      data.length,
        durationMs: ms
      };
    } catch (err) {
      const ms = Date.now() - buildState.startedAt;
      console.error('[admin/refresh] Erro:', err.message);
      buildState = {
        running:    false,
        startedAt:  buildState.startedAt,
        finishedAt: Date.now(),
        error:      err.message,
        count:      null,
        durationMs: ms
      };
    }
  })();

  return res.json({ success: true, started: true });
});

module.exports = router;
