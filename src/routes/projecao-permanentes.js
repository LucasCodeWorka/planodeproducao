const express = require('express');
const projecaoPermanentesService = require('../services/projecaoPermanentesService');
const projecoesService = require('../services/projecoesService');
const { memoizar } = require('../cache/resultadoCache');

const router = express.Router();

// Preview guardado por 15 min; ?refresh=true (botao Atualizar) recalcula.
const TTL_PREVIEW_MS = 15 * 60 * 1000;

// ── autenticação ─────────────────────────────────────────
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  const expected = (process.env.ADMIN_PASSWORD || '').trim();
  if (!expected) return res.status(500).json({ success: false, error: 'ADMIN_PASSWORD não configurado' });
  if (token !== expected) return res.status(401).json({ success: false, error: 'Não autorizado' });
  next();
}

/**
 * GET /api/projecao-permanentes/preview
 * Gera preview das projeções sem salvar
 * Query params:
 *   - anoBase: ano de referência para histórico (default: ano atual)
 *   - anoDestino: ano para aplicar projeções (default: anoBase + 1)
 *   - crescimentoFabrica: cenário de crescimento anual da fábrica, 0-1 (default: 0.10,
 *     o histórico). Sobrescreve a mesma taxa em todos os meses — usado para simular
 *     "e se crescêssemos X% em vez de 10%".
 */
router.get('/preview', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    if (!pool) {
      return res.status(500).json({ success: false, error: 'Pool de conexão não disponível' });
    }

    const anoAtual = new Date().getFullYear();
    const anoBase = parseInt(req.query.anoBase, 10) || anoAtual;
    const anoDestino = parseInt(req.query.anoDestino, 10) || anoBase + 1;
    const crescimentoFabrica = req.query.crescimentoFabrica !== undefined && req.query.crescimentoFabrica !== ''
      ? Number(req.query.crescimentoFabrica)
      : null;

    const completarMesesAbertos = req.query.completarMesesAbertos === 'true';
    const chave = `preview:${anoBase}:${anoDestino}:${completarMesesAbertos}:${crescimentoFabrica}`;
    const resultado = await memoizar(chave, TTL_PREVIEW_MS, async () => {
      console.log(`[projecao-permanentes] Gerando preview: anoBase=${anoBase}, anoDestino=${anoDestino}`);
      const r = await projecaoPermanentesService.gerarPreviewProjecoes(pool, anoBase, anoDestino, {
        completarMesesAbertos,
        crescimentoFabrica,
      });
      console.log(`[projecao-permanentes] Preview gerado: ${r.resumo?.totalSkus || 0} SKUs`);
      return r;
    }, { forcar: req.query.refresh === 'true' });

    res.json(resultado);
  } catch (err) {
    console.error('[projecao-permanentes] Erro no preview:', err);
    res.status(500).json({ success: false, error: err.message || 'Erro ao gerar preview' });
  }
});

/**
 * POST /api/projecao-permanentes/aplicar
 * Aplica as projeções geradas (salva no banco)
 * Body:
 *   - anoDestino: ano para salvar projeções
 *   - itens: array de { idproduto, projecoes: { jan, fev, ..., jun } }
 */
router.post('/aplicar', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    if (!pool) {
      return res.status(500).json({ success: false, error: 'Pool de conexão não disponível' });
    }

    const { anoDestino, itens } = req.body;

    if (!anoDestino) {
      return res.status(400).json({ success: false, error: 'anoDestino é obrigatório' });
    }

    if (!itens || !Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ success: false, error: 'Nenhum item para aplicar' });
    }

    console.log(`[projecao-permanentes] Aplicando projeções: ${itens.length} SKUs para ano ${anoDestino}`);

    // Mapear meses
    const mesesMap = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };

    // Preparar registros para inserção em lote
    const registros = [];

    for (const item of itens) {
      const idproduto = String(item.idproduto);
      const projecoes = item.projecoes || {};

      for (const [nomeMes, mes] of Object.entries(mesesMap)) {
        const qtd = Math.round(Number(projecoes[nomeMes]) || 0);
        if (qtd > 0) {
          registros.push({
            idproduto,
            mes,
            ano: anoDestino,
            quantidade: qtd,
            origem: 'PERMANENTE_AUTO',
          });
        }
      }
    }

    if (registros.length === 0) {
      return res.json({
        success: true,
        message: 'Nenhuma projeção com valor > 0 para salvar',
        importados: 0,
      });
    }

    // Salvar em lotes
    let importados = 0;
    const BATCH_SIZE = 500;

    for (let i = 0; i < registros.length; i += BATCH_SIZE) {
      const batch = registros.slice(i, i + BATCH_SIZE);
      const saved = await projecoesService.importarRegistrosEmLotes(pool, batch);
      importados += saved;
    }

    console.log(`[projecao-permanentes] Projeções aplicadas: ${importados} registros`);

    res.json({
      success: true,
      message: `Projeções aplicadas com sucesso`,
      importados,
      skus: itens.length,
      anoDestino,
    });
  } catch (err) {
    console.error('[projecao-permanentes] Erro ao aplicar:', err);
    res.status(500).json({ success: false, error: err.message || 'Erro ao aplicar projeções' });
  }
});

/**
 * GET /api/projecao-permanentes/totalizadores
 * Retorna apenas os totalizadores (vendas por canal e ajustes)
 */
router.get('/totalizadores', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    if (!pool) {
      return res.status(500).json({ success: false, error: 'Pool de conexão não disponível' });
    }

    const anoAtual = new Date().getFullYear();
    const anoBase = parseInt(req.query.anoBase, 10) || anoAtual;

    const vendas = await projecaoPermanentesService.buscarVendasPorCanal(pool, anoBase);
    const totalizadores = projecaoPermanentesService.calcularTotalizadores(vendas);

    res.json({
      success: true,
      anoBase,
      vendas,
      totalizadores,
      ajustes: projecaoPermanentesService.AJUSTES_FABRICA,
    });
  } catch (err) {
    console.error('[projecao-permanentes] Erro ao buscar totalizadores:', err);
    res.status(500).json({ success: false, error: err.message || 'Erro ao buscar totalizadores' });
  }
});

/**
 * GET /api/projecao-permanentes/skus
 * Retorna apenas a lista de SKUs permanentes (sem cálculos)
 */
router.get('/skus', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    if (!pool) {
      return res.status(500).json({ success: false, error: 'Pool de conexão não disponível' });
    }

    const skus = await projecaoPermanentesService.buscarSkusPermanentes(pool);

    res.json({
      success: true,
      total: skus.length,
      skus,
    });
  } catch (err) {
    console.error('[projecao-permanentes] Erro ao buscar SKUs:', err);
    res.status(500).json({ success: false, error: err.message || 'Erro ao buscar SKUs' });
  }
});

module.exports = router;
