/**
 * Serviço para cálculo de Estoque Mínimo
 *
 * Regras de Cálculo:
 *
 * 1. Crescimento ou Queda Acentuada (variação >= 49% ou <= -50%)
 *    → Estoque Mínimo = Média dos Últimos 3 Meses
 *
 * 2. Ausência de Histórico Semestral (média semestral indisponível)
 *    → Estoque Mínimo = Média dos Últimos 3 Meses
 *
 * 3. Cenário Estável (demais casos)
 *    → Estoque Mínimo = Média entre (Média Semestral e Média dos Últimos 3 Meses)
 */

/**
 * Calcula a variação percentual entre duas médias
 * @param {number} mediaSemestral - Média de vendas dos últimos 6 meses
 * @param {number} mediaTrimestral - Média de vendas dos últimos 3 meses
 * @returns {number|null} Variação percentual ou null se não puder calcular
 */
function calcularVariacaoPercentual(mediaSemestral, mediaTrimestral) {
  if (!mediaSemestral || mediaSemestral === 0) {
    return null;
  }

  return ((mediaTrimestral - mediaSemestral) / mediaSemestral) * 100;
}

/**
 * Calcula o estoque mínimo com base nas regras definidas
 * @param {number|null} mediaSemestral - Média de vendas dos últimos 6 meses
 * @param {number|null} mediaTrimestral - Média de vendas dos últimos 3 meses
 * @returns {Object} Objeto com estoque mínimo e informações de cálculo
 */
function calcularEstoqueMinimo(mediaSemestral, mediaTrimestral) {
  const resultado = {
    estoqueMinimo: 0,
    mediaSemestral: mediaSemestral || 0,
    mediaTrimestral: mediaTrimestral || 0,
    variacaoPercentual: null,
    regraAplicada: null,
    descricaoRegra: null
  };

  // Regra 2: Ausência de Histórico Semestral
  if (!mediaSemestral || mediaSemestral === 0) {
    resultado.estoqueMinimo = mediaTrimestral || 0;
    resultado.regraAplicada = 2;
    resultado.descricaoRegra = "Ausência de histórico semestral - usando média trimestral";
    return resultado;
  }

  // Se não há média trimestral, usa a semestral
  if (!mediaTrimestral || mediaTrimestral === 0) {
    resultado.estoqueMinimo = mediaSemestral;
    resultado.regraAplicada = 2;
    resultado.descricaoRegra = "Ausência de média trimestral - usando média semestral";
    return resultado;
  }

  // Calcula a variação percentual
  const variacao = calcularVariacaoPercentual(mediaSemestral, mediaTrimestral);
  resultado.variacaoPercentual = variacao;

  // Regra 1: Crescimento ou Queda Acentuada
  if (variacao !== null && (variacao >= 49 || variacao <= -50)) {
    resultado.estoqueMinimo = mediaTrimestral;
    resultado.regraAplicada = 1;
    resultado.descricaoRegra = `Variação acentuada (${variacao.toFixed(2)}%) - usando média trimestral`;
    return resultado;
  }

  // Regra 3: Cenário Estável
  resultado.estoqueMinimo = (mediaSemestral + mediaTrimestral) / 2;
  resultado.regraAplicada = 3;
  resultado.descricaoRegra = `Cenário estável (${variacao !== null ? variacao.toFixed(2) + '%' : 'N/A'}) - média entre semestral e trimestral`;

  return resultado;
}

/**
 * Valida se os dados de entrada são numéricos e positivos
 * @param {any} valor - Valor a validar
 * @returns {boolean} True se válido, false caso contrário
 */
function validarValor(valor) {
  return typeof valor === 'number' && !isNaN(valor) && valor >= 0;
}

module.exports = {
  calcularEstoqueMinimo,
  calcularVariacaoPercentual,
  validarValor
};
