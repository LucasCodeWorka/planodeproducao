import fs from "node:fs";

const origem = ".agents/totvs_agent_minimo/data/conciliacao-fcpfm017-2026-10-15.json";
const destino = ".agents/totvs_agent_minimo/data/lote-42-fcpfm017-2026-10-16.json";
const conciliacao = JSON.parse(fs.readFileSync(origem, "utf8"));

if (conciliacao.criterio !== "NECESSIDADE_FUTURA_COM_FOLGA_SEM_COMPRAS_EM_ANDAMENTO" ||
    conciliacao.plano !== 500 || conciliacao.centroCusto !== 506) {
  throw new Error("Critério ou plano da conciliação mudou");
}

const despesas = conciliacao.despesas.filter((item) => item.categoria === "FORA_PLANO");
const codigos = new Set(despesas.map((item) => item.despesa));
if (despesas.length !== 42 || codigos.size !== 42 ||
    despesas.reduce((soma, item) => soma + item.totalCentavos, 0) !== 7545659) {
  throw new Error("Grupo das 42 despesas diverge da conciliação histórica");
}

const lancamentos = [];
for (const despesa of despesas) {
  const totalMeses = Object.values(despesa.valoresCentavos).reduce((a, b) => a + b, 0);
  if (totalMeses !== despesa.totalCentavos) {
    throw new Error(`Meses não fecham para despesa ${despesa.despesa}`);
  }
  for (const [competencia, valorCentavos] of Object.entries(despesa.valoresCentavos)) {
    if (!valorCentavos) continue;
    const [ano, mes] = competencia.split("-").map(Number);
    lancamentos.push({ ano, mes, competencia, plano: 500, centroCusto: 506,
      despesa: despesa.despesa, sequenciaPlano: despesa.despesa === 11681 ? "26718" : null,
      mps: despesa.mps, valorCentavos });
  }
}
lancamentos.sort((a, b) => a.competencia.localeCompare(b.competencia) || a.despesa - b.despesa);
const totalCentavos = lancamentos.reduce((soma, item) => soma + item.valorCentavos, 0);
if (totalCentavos !== 7545659) throw new Error(`Total inesperado: ${totalCentavos}`);
const totaisPorCompetencia = Object.fromEntries(conciliacao.meses.map((mes) =>
  [mes, lancamentos.filter((item) => item.competencia === mes)
    .reduce((soma, item) => soma + item.valorCentavos, 0)]));

const lote = { fonte: origem, criterio: conciliacao.criterio,
  status: "PREPARADO_AGUARDANDO_41_VINCULOS", plano: 500, centroCusto: 506,
  despesas: 42, entradas: lancamentos.length, totalCentavos,
  totaisPorCompetencia, lancamentos };
fs.writeFileSync(destino, JSON.stringify(lote, null, 2) + "\n", "utf8");
console.log({ destino, despesas: lote.despesas, entradas: lote.entradas,
  totalCentavos, totaisPorCompetencia });
