/**
 * Rotas de Indicadores de OP (Ordem de Produção)
 */

const express = require('express');
const router = express.Router();
const indicadoresOpService = require('../services/indicadoresOpService');

/**
 * GET /api/indicadores-op/liebe
 * Indicadores de tempo de OP LIEBE
 * Query params: desde (obrigatório), ate (opcional)
 */
router.get('/liebe', async (req, res) => {
  try {
    const pool = req.app.get('pool');
    const { desde, ate } = req.query;

    if (!desde) {
      return res.status(400).json({ error: 'Parâmetro "desde" é obrigatório (YYYY-MM-DD)' });
    }

    const result = await indicadoresOpService.getIndicadoresLiebe(pool, desde, ate || null);
    res.json(result);
  } catch (error) {
    console.error('[indicadores-op] Erro ao buscar indicadores LIEBE:', error);
    res.status(500).json({ error: 'Erro ao buscar indicadores LIEBE' });
  }
});

/**
 * GET /api/indicadores-op/oficinas
 * Indicadores de tempo por oficina de costura
 * Query params: desde (obrigatório), ate (opcional)
 */
router.get('/oficinas', async (req, res) => {
  try {
    const pool = req.app.get('pool');
    const { desde, ate } = req.query;

    if (!desde) {
      return res.status(400).json({ error: 'Parâmetro "desde" é obrigatório (YYYY-MM-DD)' });
    }

    const result = await indicadoresOpService.getIndicadoresOficinas(pool, desde, ate || null);
    res.json(result);
  } catch (error) {
    console.error('[indicadores-op] Erro ao buscar indicadores oficinas:', error);
    res.status(500).json({ error: 'Erro ao buscar indicadores oficinas' });
  }
});

/**
 * GET /api/indicadores-op/resumo
 * Resumo consolidado LIEBE + oficinas
 * Query params: desde (obrigatório), ate (opcional)
 */
router.get('/resumo', async (req, res) => {
  try {
    const pool = req.app.get('pool');
    const { desde, ate } = req.query;

    if (!desde) {
      return res.status(400).json({ error: 'Parâmetro "desde" é obrigatório (YYYY-MM-DD)' });
    }

    const result = await indicadoresOpService.getResumoConsolidado(pool, desde, ate || null);
    res.json(result);
  } catch (error) {
    console.error('[indicadores-op] Erro ao buscar resumo:', error);
    res.status(500).json({ error: 'Erro ao buscar resumo consolidado' });
  }
});

/**
 * GET /api/indicadores-op/detalhes/:tipo
 * Lista detalhada de OPs
 * Params: tipo ('liebe' ou 'oficina')
 * Query params: desde (obrigatório), ate (opcional), cd_local (para oficina), limit
 */
router.get('/detalhes/:tipo', async (req, res) => {
  try {
    const pool = req.app.get('pool');
    const { tipo } = req.params;
    const { desde, ate, cd_local, limit } = req.query;

    if (!desde) {
      return res.status(400).json({ error: 'Parâmetro "desde" é obrigatório (YYYY-MM-DD)' });
    }

    if (!['liebe', 'oficina'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo deve ser "liebe" ou "oficina"' });
    }

    const result = await indicadoresOpService.getDetalhesOps(
      pool,
      tipo,
      desde,
      ate || null,
      cd_local ? Number(cd_local) : null,
      limit ? Number(limit) : 50
    );
    res.json(result);
  } catch (error) {
    console.error('[indicadores-op] Erro ao buscar detalhes:', error);
    res.status(500).json({ error: 'Erro ao buscar detalhes das OPs' });
  }
});

/**
 * GET /api/indicadores-op/outros-locais
 * Indicadores de tempo por outros locais (não oficinas)
 * Query params: desde (obrigatório), ate (opcional)
 */
router.get('/outros-locais', async (req, res) => {
  try {
    const pool = req.app.get('pool');
    const { desde, ate } = req.query;

    if (!desde) {
      return res.status(400).json({ error: 'Parâmetro "desde" é obrigatório (YYYY-MM-DD)' });
    }

    const result = await indicadoresOpService.getIndicadoresOutrosLocais(pool, desde, ate || null);
    res.json(result);
  } catch (error) {
    console.error('[indicadores-op] Erro ao buscar indicadores outros locais:', error);
    res.status(500).json({ error: 'Erro ao buscar indicadores outros locais' });
  }
});

/**
 * GET /api/indicadores-op/oficinas/lista
 * Lista todas as oficinas disponíveis
 */
router.get('/oficinas/lista', async (req, res) => {
  try {
    const pool = req.app.get('pool');
    const result = await indicadoresOpService.listarOficinas(pool);
    res.json(result);
  } catch (error) {
    console.error('[indicadores-op] Erro ao listar oficinas:', error);
    res.status(500).json({ error: 'Erro ao listar oficinas' });
  }
});

module.exports = router;
