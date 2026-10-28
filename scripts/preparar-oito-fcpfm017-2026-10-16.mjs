import fs from "node:fs";

const origem = ".agents/totvs_agent_minimo/data/conciliacao-fcpfm017-2026-10-15.json";
const destino = ".agents/totvs_agent_minimo/data/lote-oito-fcpfm017-2026-10-16.json";
const conciliacao = JSON.parse(fs.readFileSync(origem, "utf8"));

// Vinculos confirmados visualmente no FCPFM043 em 16/10/2026.
const mapeamento = [
  ["1014698", 1462, "26702"],
  ["1016252", 1463, "26704"],
  ["1015810", 1464, "26706"],
  ["1015809", 1465, "26708"],
  ["1012650", 1466, "26710"],
  ["1014970", 1467, "26712"],
  ["1004031", 1468, "26714"],
  ["1011955", 1469, "26716"],
];

if (conciliacao.criterio !== "NECESSIDADE_FUTURA_COM_FOLGA_SEM_COMPRAS_EM_ANDAMENTO" ||
    conciliacao.plano !== 500 || conciliacao.centroCusto !== 506) {
  throw new Error("Critério/plano da conciliação histórica mudou");
}

const lancamentos = [];
for (const [mp, despesa, sequenciaPlano] of mapeamento) {
  const propostas = conciliacao.despesas.filter((item) =>
    item.categoria === "SEM_DESPESA" && item.mps.length === 1 && item.mps[0] === mp);
  if (propostas.length !== 1) throw new Error(`Proposta histórica não única para MP ${mp}`);
  const proposta = propostas[0];
  const somaMeses = Object.values(proposta.valoresCentavos).reduce((soma, valor) => soma + valor, 0);
  if (somaMeses !== proposta.totalCentavos) throw new Error(`Meses não fecham para MP ${mp}`);
  for (const [competencia, valorCentavos] of Object.entries(proposta.valoresCentavos)) {
    if (!valorCentavos) continue;
    const [ano, mes] = competencia.split("-").map(Number);
    lancamentos.push({ ano, mes, competencia, plano: 500, centroCusto: 506,
      despesa, sequenciaPlano, mp, valorCentavos });
  }
}
lancamentos.sort((a, b) => a.competencia.localeCompare(b.competencia) || a.despesa - b.despesa);
const totalCentavos = lancamentos.reduce((soma, item) => soma + item.valorCentavos, 0);
if (totalCentavos !== 299338 || lancamentos.length !== 16) {
  throw new Error(`Lote inesperado: ${lancamentos.length} lançamentos, ${totalCentavos} centavos`);
}
const totaisPorCompetencia = Object.fromEntries(conciliacao.meses.map((mes) =>
  [mes, lancamentos.filter((item) => item.competencia === mes)
    .reduce((soma, item) => soma + item.valorCentavos, 0)]));

const lote = {
  fonte: origem,
  criterio: conciliacao.criterio,
  status: "PREPARADO_NAO_LANCADO",
  plano: 500,
  centroCusto: 506,
  despesas: 8,
  entradas: lancamentos.length,
  totalCentavos,
  totaisPorCompetencia,
  lancamentos,
};
fs.writeFileSync(destino, JSON.stringify(lote, null, 2) + "\n", "utf8");
console.log({ destino, despesas: lote.despesas, entradas: lote.entradas,
  totalCentavos, totaisPorCompetencia });
