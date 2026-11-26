// PLANO EFETIVO por SKU: o plano da matriz com a simulação por cima — só onde ela vale.
//
// Até 25/11/2026 a simulação trocava o plano do SKU INTEIRO (os 14 períodos). A de 05/11
// (LOTE-1793901304394) foi feita para jul–dez/27, mas reescrevia também jan–jun/27, que
// já tinham lote lançado depois dela: o laboratório via janeiro com 138.670 (109.770 da
// simulação) e abril–junho ~48 mil peças abaixo dos lotes reais. Regra agora:
//   1. a simulação só vale nos períodos dela (`lotePeriodos`); sem a lista, em todos;
//   2. e só em período SEM lote lançado — período com plano na matriz usa a matriz (o
//      restante do lote; o que já virou OP entra como processo, não de novo como plano).
const { PERIODOS_PLANO } = require('../services/periodoPlanoService');

const CAMPOS = PERIODOS_PLANO.map((p) => p.toLowerCase());

/** Períodos com lote lançado: algum plano na matriz (qualquer marca). */
function periodosLancados(matrizRows) {
  const soma = Object.fromEntries(CAMPOS.map((c) => [c, 0]));
  for (const item of matrizRows || []) {
    const plano = item?.plano || {};
    for (const c of CAMPOS) soma[c] += Number(plano[c] || 0);
  }
  return new Set(PERIODOS_PLANO.filter((p, i) => soma[CAMPOS[i]] > 0));
}

/** Guarda o plano simulado de um SKU junto com os períodos que a simulação cobre. */
function entradaSimulada(plano, parametros) {
  const lista = Array.isArray(parametros?.lotePeriodos)
    ? parametros.lotePeriodos.map((p) => String(p).toUpperCase())
    : null;
  return { plano, periodos: lista && lista.length ? new Set(lista) : null };
}

/**
 * Plano do SKU por período (chaves minúsculas, como `item.plano`). `entrada` é o que
 * `entradaSimulada` devolveu (ou undefined). Devolve também quais períodos vieram da
 * simulação, para quem quiser contar.
 */
function planoEfetivo(item, entrada, lancados) {
  const base = item?.plano || {};
  if (!entrada) return { plano: base, simulados: [] };
  const plano = { ...base };
  const simulados = [];
  PERIODOS_PLANO.forEach((per, i) => {
    if (lancados.has(per)) return;
    if (entrada.periodos && !entrada.periodos.has(per)) return;
    const c = CAMPOS[i];
    if (entrada.plano?.[c] === undefined) return;
    plano[c] = entrada.plano[c];
    simulados.push(per);
  });
  return { plano, simulados };
}

// Uma conta por leitura da matriz (o array do cache é o mesmo objeto entre requisições).
const cacheLancados = new WeakMap();
function lancadosDe(matrizRows) {
  if (!Array.isArray(matrizRows)) return periodosLancados(matrizRows);
  if (!cacheLancados.has(matrizRows)) cacheLancados.set(matrizRows, periodosLancados(matrizRows));
  return cacheLancados.get(matrizRows);
}

module.exports = { periodosLancados, entradaSimulada, planoEfetivo, lancadosDe };
