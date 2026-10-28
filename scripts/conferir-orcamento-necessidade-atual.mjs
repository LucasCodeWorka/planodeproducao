// Compara a necessidade recalculada com os cinco lotes historicos do FCPFM017.
// Somente arquivos locais: os lotes nao substituem uma leitura atual do ERP.
import fs from 'node:fs';
import path from 'node:path';

const arquivoAtual = process.argv[2];
const arquivoSaida = process.argv[3];
if (!arquivoAtual || !arquivoSaida) {
  throw new Error('Uso: node scripts/conferir-orcamento-necessidade-atual.mjs PREPARO_ATUAL RELATORIO_JSON');
}
const atual = JSON.parse(fs.readFileSync(arquivoAtual, 'utf8'));
const periodos = ['MA', 'PX', 'UL', 'QT', 'QU'];
const meses = periodos.map((p) => atual.resumo.periodos[p]);
const arquivosLote = [
  'lote-pronto-fcpfm017-2026-10-15.json',
  'lote-oito-fcpfm017-2026-10-16.json',
  'lote-42-fcpfm017-pronto-2026-10-16.json',
  'lote-duas-duplicadas-fcpfm017-2026-10-19.json',
  'lote-embalagens-pino-fcpfm017-2026-10-19.json',
].map((nome) => path.resolve('.agents/totvs_agent_minimo/data', nome));
const centavos = (n) => Math.round((Number(n) + Number.EPSILON) * 100);
const chave = (despesa, mes) => `${despesa}|${mes}`;

function distribuir(valores, alvo) {
  const brutos = valores.map((valor) => valor * 100);
  const partes = brutos.map((valor) => Math.floor(valor + 1e-8));
  const faltantes = alvo - partes.reduce((a, b) => a + b, 0);
  if (faltantes < 0 || faltantes > partes.length) throw new Error(`Residuo invalido: ${faltantes}`);
  const ordem = brutos.map((valor, i) => ({ i, resto: valor - partes[i] }))
    .sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (const { i } of ordem.slice(0, faltantes)) partes[i]++;
  return partes;
}

const grupos = new Map();
for (const linha of atual.linhas.filter((item) => item.valorFuturo > 0)) {
  const id = linha.despesa ? String(linha.despesa) : `MP_${linha.mp}`;
  if (!grupos.has(id)) grupos.set(id, []);
  grupos.get(id).push(linha);
}
const propostas = [...grupos].map(([id, linhas]) => ({
  id,
  despesa: id.startsWith('MP_') ? null : Number(id),
  mps: linhas.map((linha) => linha.mp),
  noPlano: linhas.every((linha) => linha.noPlano500Cc506),
  totalBruto: linhas.reduce((s, linha) => s + linha.valorFuturo, 0),
  mesesBrutos: periodos.map((p) => linhas.reduce((s, linha) => s + linha.porPeriodo[p].futuro, 0)),
}));
const totais = distribuir(propostas.map((p) => p.totalBruto), centavos(atual.resumo.valorFuturo));
const esperado = new Map();
propostas.forEach((proposta, i) => {
  proposta.totalCentavos = totais[i];
  proposta.mesesCentavos = distribuir(proposta.mesesBrutos, totais[i]);
  proposta.mesesCentavos.forEach((valor, indice) => {
    if (valor) esperado.set(chave(proposta.id, meses[indice]), valor);
  });
});

const registrado = new Map();
const loteResumo = [];
for (const arquivo of arquivosLote) {
  const lote = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const soma = lote.lancamentos.reduce((s, item) => s + item.valorCentavos, 0);
  if (lote.plano !== 500 || lote.centroCusto !== 506 || soma !== lote.totalCentavos) {
    throw new Error(`Lote invalido: ${arquivo}`);
  }
  loteResumo.push({ arquivo: path.basename(arquivo), entradas: lote.lancamentos.length, totalCentavos: soma });
  for (const item of lote.lancamentos) {
    const id = chave(item.despesa, item.competencia);
    if (registrado.has(id)) throw new Error(`Competencia repetida nos lotes: ${id}`);
    registrado.set(id, item.valorCentavos);
  }
}

const diferencas = [...new Set([...esperado.keys(), ...registrado.keys()])]
  .map((id) => {
    const [despesa, competencia] = id.split('|');
    const necessidadeCentavos = esperado.get(id) || 0;
    const lancadoCentavos = registrado.get(id) || 0;
    return { despesa, competencia, necessidadeCentavos, lancadoCentavos,
      diferencaCentavos: necessidadeCentavos - lancadoCentavos };
  }).filter((item) => item.diferencaCentavos !== 0)
  .sort((a, b) => Math.abs(b.diferencaCentavos) - Math.abs(a.diferencaCentavos));
const totalLancado = [...registrado.values()].reduce((a, b) => a + b, 0);
const resumo = {
  calculadoEm: atual.resumo.criadoEm,
  meses,
  mps: atual.resumo.mps,
  mpsComValor: atual.resumo.mpsComValor,
  necessidadeCentavos: centavos(atual.resumo.valorFuturo),
  lancadoHistoricoCentavos: totalLancado,
  diferencaCentavos: centavos(atual.resumo.valorFuturo) - totalLancado,
  despesasComNecessidade: propostas.filter((p) => p.despesa).length,
  mpsSemDespesa: propostas.filter((p) => !p.despesa).map((p) => ({ mp: p.mps[0], totalCentavos: p.totalCentavos })),
  despesasForaPlano: propostas.filter((p) => p.despesa && !p.noPlano).map((p) => ({ despesa: p.despesa, mps: p.mps, totalCentavos: p.totalCentavos })),
  mpsSemPreco: atual.semPrecoComNecessidade || [],
  competenciasDiferentes: diferencas.length,
  lotes: loteResumo,
};
const relatorio = {
  resumo,
  diferencas,
  necessidadePorCompetencia: [...esperado].map(([id, valorCentavos]) => ({ id, valorCentavos })),
  lotesPorCompetencia: [...registrado].map(([id, valorCentavos]) => ({ id, valorCentavos })),
};
fs.writeFileSync(arquivoSaida, JSON.stringify(relatorio, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ resumo, maioresDiferencas: diferencas.slice(0, 25) }, null, 2));
