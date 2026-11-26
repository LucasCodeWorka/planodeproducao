const fs = require('fs');
const atual = JSON.parse(fs.readFileSync('docs/orcamento-levantamento-2026-11-25.json'));
const anterior = JSON.parse(fs.readFileSync('.agents/totvs_agent_minimo/data/preparo-fcpfm017-2026-10-27-apos-sync.json'));
const audit = JSON.parse(fs.readFileSync('docs/orcamento-totvs-auditoria-2026-11-25.json'));
const anteriores = new Set(anterior.linhas.map(x => x.mp));
const novas = atual.linhas.filter(x => !anteriores.has(x.mp));
const classes = {};
for (const x of atual.linhas) {
  const k = !x.despesa ? 'sem_despesa' : !x.noPlano500Cc506 ? 'fora_plano' : 'no_plano';
  classes[k] ||= { quantidade: 0, futuro: 0, comprado: 0 };
  classes[k].quantidade++;
  classes[k].futuro += x.valorFuturo;
  classes[k].comprado += x.valorComprado;
}
console.log(JSON.stringify({ novas_na_comparacao: novas.length, classes, auditoria: audit.resumo }, null, 2));
