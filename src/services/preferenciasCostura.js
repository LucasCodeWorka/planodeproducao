/** Ordena o histórico da referência antes das opções inferidas pelo mix. */
function montarOpcoesCostura(historico, mix, capacidades, revisadas = []) {
  const entradas = [...(historico || new Map()).entries()]
    .filter(([, pecas]) => Number(pecas) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]) || String(a[0]).localeCompare(String(b[0]), 'pt-BR'));
  const total = entradas.reduce((soma, [, pecas]) => soma + Number(pecas), 0);
  const historicas = entradas.map(([grupo, pecas]) => ({
    grupo, origem: 'historico', pecasHistorico: Math.round(pecas),
    capacidadeDisponivel: capacidades.has(grupo), concentracao: total > 0 ? pecas / total : null,
  }));
  // Sem produção própria na janela consultada, não substituir a revisão do PCP por mix.
  const doPcp = historicas.length ? [] : Array.from(new Set(revisadas.map((g) => String(g || '').trim()).filter(Boolean)))
    .map((grupo) => ({ grupo, origem: 'revisao', concentracao: null, capacidadeDisponivel: capacidades.has(grupo) }));
  const jaTem = new Set([...historicas, ...doPcp].map((c) => c.grupo));
  const porMix = [...(mix || new Map()).entries()]
    .filter(([grupo, pecas]) => !jaTem.has(grupo) && capacidades.has(grupo) && Number(pecas) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]) || String(a[0]).localeCompare(String(b[0]), 'pt-BR'))
    .map(([grupo, pecas]) => ({ grupo, origem: 'mix', pecasMix: Math.round(pecas), concentracao: null, capacidadeDisponivel: true }));
  return [...historicas, ...doPcp, ...porMix];
}

module.exports = { montarOpcoesCostura };
