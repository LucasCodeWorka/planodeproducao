const express = require('express');
const { projetarEdicaoLimitada } = require('../services/projecaoEdicaoLimitadaService');

const router = express.Router();

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  const expected = (process.env.ADMIN_PASSWORD || '').trim();
  if (!expected) return res.status(500).json({ success: false, error: 'ADMIN_PASSWORD não configurado' });
  if (token !== expected) return res.status(401).json({ success: false, error: 'Não autorizado' });
  next();
}

/**
 * GET /api/projecao-edicao-limitada
 * Projecao mensal de edicao limitada, do historico de colecoes.
 * Query params:
 *   - anoDestino: ano a projetar (default: ano atual + 1)
 *   - marca: default LIEBE
 *   - detalhe: "1" devolve tambem a abertura mes a mes (base, fator e canal)
 */
router.get('/', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    if (!pool) return res.status(500).json({ success: false, error: 'Pool de conexão não disponível' });

    const anoDestino = Number(req.query.anoDestino) || new Date().getFullYear() + 1;
    const marca = String(req.query.marca || 'LIEBE');

    const resultado = await projetarEdicaoLimitada(pool, { anoDestino, marca });
    const { porMes, ...resumo } = resultado;

    res.json({
      success: true,
      ...resumo,
      ...(req.query.detalhe === '1' ? { porMes } : {}),
    });
  } catch (err) {
    console.error('[projecao-edicao-limitada] Erro:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
