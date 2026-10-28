import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const fonte = path.join(raiz, 'data', 'conciliacao-fcpfm017-2026-10-15.json');
const destino = path.join(raiz, 'data', 'lote-embalagens-pino-fcpfm017-2026-10-19.json');
const pares = new Map([
  ['5000110', 1470], ['5000126', 1471], ['5000127', 1472],
  ['5000138', 1473], ['5000140', 1474], ['5000141', 1475],
  ['5000681', 1476], ['5002671', 1477],
]);
const conciliacao = JSON.parse(fs.readFileSync(fonte, 'utf8'));
if (conciliacao.criterio !== 'NECESSIDADE_FUTURA_COM_FOLGA_SEM_COMPRAS_EM_ANDAMENTO'
    || conciliacao.plano !== 500 || conciliacao.centroCusto !== 506) {
  throw new Error('Fonte de conciliação inesperada');
}
const itens = conciliacao.despesas.filter((item) => item.mps.some((mp) => pares.has(mp)));
if (itens.length !== 8 || itens.some((item) => item.categoria !== 'SEM_DESPESA' || item.mps.length !== 1)) {
  throw new Error(`Esperadas oito MPs sem despesa, encontradas ${itens.length}`);
}
const lancamentos = [];
for (const item of itens) {
  const mp = item.mps[0];
  const despesa = pares.get(mp);
  const soma = Object.values(item.valoresCentavos).reduce((a, b) => a + b, 0);
  if (soma !== item.totalCentavos) throw new Error(`Total divergente para MP ${mp}`);
  for (const [competencia, valorCentavos] of Object.entries(item.valoresCentavos)) {
    if (!valorCentavos) continue;
    const [ano, mes] = competencia.split('-').map(Number);
    lancamentos.push({ ano, mes, competencia, plano: 500, centroCusto: 506,
      despesa, mp, valorCentavos });
  }
}
lancamentos.sort((a, b) => a.competencia.localeCompare(b.competencia) || a.despesa - b.despesa);
const totalCentavos = lancamentos.reduce((s, item) => s + item.valorCentavos, 0);
if (totalCentavos !== 2038570 || new Set(lancamentos.map((x) => x.despesa)).size !== 8) {
  throw new Error(`Total/quantidade divergente: ${totalCentavos}`);
}
const totaisPorCompetencia = Object.fromEntries(conciliacao.meses.map((mes) => [mes,
  lancamentos.filter((x) => x.competencia === mes).reduce((s, x) => s + x.valorCentavos, 0)]));
const lote = {
  fonte: path.relative(path.resolve(raiz, '..', '..'), fonte).replaceAll('\\', '/'),
  criterio: conciliacao.criterio,
  status: 'PREPARADO_NAO_LANCADO',
  plano: 500, centroCusto: 506, despesas: 8, entradas: lancamentos.length,
  totalCentavos, totaisPorCompetencia, lancamentos,
};
fs.writeFileSync(destino, `${JSON.stringify(lote, null, 2)}\n`);
console.log({ destino, despesas: 8, entradas: lancamentos.length,
  totalCentavos, totaisPorCompetencia });
