// Guarda o resultado de calculos caros por alguns minutos e junta pedidos iguais simultaneos.
//
// A Visao Geral dispara projecao de permanentes (30-90s) e de edicao limitada a cada abertura,
// F5 ou Atualizar, sem cancelar a anterior. Com o banco disputado por cargas do BI, cada
// clique empilhava mais um calculo identico e todos estouravam o timeout do navegador.
// Erro nao fica guardado: a proxima chamada tenta de novo.

const resultados = new Map(); // chave -> { valor, em }
const emAndamento = new Map(); // chave -> Promise

async function memoizar(chave, ttlMs, calcular, { forcar = false } = {}) {
  const guardado = resultados.get(chave);
  if (!forcar && guardado && Date.now() - guardado.em < ttlMs) return guardado.valor;
  if (emAndamento.has(chave)) return emAndamento.get(chave);
  const promessa = (async () => {
    const valor = await calcular();
    resultados.set(chave, { valor, em: Date.now() });
    return valor;
  })().finally(() => emAndamento.delete(chave));
  emAndamento.set(chave, promessa);
  return promessa;
}

module.exports = { memoizar };
