const express = require("express");
const { calcularEstoqueMinimo, validarValor } = require("../services/estoqueMinimo");

const router = express.Router();

/**
 * POST /api/estoque-minimo/calcular
 * Calcula o estoque mínimo com base nas médias fornecidas
 *
 * Body:
 * {
 *   "mediaSemestral": number,
 *   "mediaTrimestral": number
 * }
 */
router.post("/calcular", (req, res) => {
  try {
    const { mediaSemestral, mediaTrimestral } = req.body;

    // Validações de entrada
    if (mediaSemestral !== undefined && mediaSemestral !== null && !validarValor(mediaSemestral)) {
      return res.status(400).json({
        success: false,
        error: "mediaSemestral deve ser um número positivo"
      });
    }

    if (mediaTrimestral !== undefined && mediaTrimestral !== null && !validarValor(mediaTrimestral)) {
      return res.status(400).json({
        success: false,
        error: "mediaTrimestral deve ser um número positivo"
      });
    }

    const resultado = calcularEstoqueMinimo(
      mediaSemestral || null,
      mediaTrimestral || null
    );

    return res.status(200).json({
      success: true,
      data: resultado
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao calcular estoque mínimo",
      details: error.message
    });
  }
});

/**
 * POST /api/estoque-minimo/calcular-lote
 * Calcula o estoque mínimo para múltiplos produtos
 *
 * Body:
 * {
 *   "produtos": [
 *     {
 *       "id": "produto1",
 *       "mediaSemestral": number,
 *       "mediaTrimestral": number
 *     }
 *   ]
 * }
 */
router.post("/calcular-lote", (req, res) => {
  try {
    const { produtos } = req.body;

    if (!Array.isArray(produtos)) {
      return res.status(400).json({
        success: false,
        error: "produtos deve ser um array"
      });
    }

    const resultados = produtos.map(produto => {
      const { id, mediaSemestral, mediaTrimestral, ...outrosDados } = produto;

      const resultado = calcularEstoqueMinimo(
        mediaSemestral || null,
        mediaTrimestral || null
      );

      return {
        id: id || null,
        ...outrosDados,
        ...resultado
      };
    });

    return res.status(200).json({
      success: true,
      totalProcessados: resultados.length,
      data: resultados
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao calcular estoque mínimo em lote",
      details: error.message
    });
  }
});

module.exports = router;
