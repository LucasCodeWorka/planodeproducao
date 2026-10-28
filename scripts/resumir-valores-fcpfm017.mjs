// Resumo somente leitura da proposta calculada em preparar-valores-fcpfm017.mjs.
import fs from 'node:fs';

const arquivo = '.agents/totvs_agent_minimo/data/preparo-fcpfm017-atual.json';
const { resumo, linhas } = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const periodos = ['MA', 'PX', 'UL', 'QT', 'QU'];
const duplicadas = new Set([11103, 11399]);
const arredondar = (valor) => Math.round((valor + Number.EPSILON) * 100) / 100;
const formatar = (valor) => arredondar(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function categoria(linha) {
  if (!linha.despesa) return 'sem_despesa';
  if (!linha.noPlano500Cc506) return 'fora_plano';
  if (duplicadas.has(linha.despesa)) return 'duplicada_no_plano';
  return 'unica_no_plano';
}

function agregar(itens, campo) {
  const totais = Object.fromEntries(periodos.map((p) => [resumo.periodos[p], 0]));
  for (const linha of itens) {
    for (const periodo of periodos) totais[resumo.periodos[periodo]] += linha.porPeriodo[periodo][campo];
  }
  return Object.fromEntries(Object.entries(totais).map(([mes, valor]) => [mes, arredondar(valor)]));
}

const futuras = linhas.filter((linha) => linha.valorFuturo > 0);
console.log(`Base ${resumo.criadoEm}: ${futuras.length} MPs com necessidade futura; R$ ${formatar(resumo.valorFuturo)}.`);
console.log('Compras em andamento contabilizadas à parte:', `R$ ${formatar(resumo.valorComprado)}`);
console.log('STATUS_VINCULO', futuras.reduce((acumulado, linha) => {
  const status = linha.statusDespesa || 'SEM_VINCULO';
  acumulado[status] = (acumulado[status] || 0) + 1;
  return acumulado;
}, {}));
console.log('TOTAL_FUTURO_POR_MES', agregar(futuras, 'futuro'));
console.log('TOTAL_COMPRADO_POR_MES', agregar(linhas, 'comprado'));

for (const status of ['unica_no_plano', 'duplicada_no_plano', 'fora_plano', 'sem_despesa']) {
  const itens = futuras.filter((linha) => categoria(linha) === status);
  console.log(status, {
    mps: itens.length,
    despesas: new Set(itens.map((linha) => linha.despesa).filter(Boolean)).size,
    total: arredondar(itens.reduce((valor, linha) => valor + linha.valorFuturo, 0)),
    meses: agregar(itens, 'futuro'),
  });
}

const validas = futuras.filter((linha) => categoria(linha) === 'unica_no_plano');
const porDespesa = new Map();
for (const linha of validas) {
  const chave = linha.despesa;
  if (!porDespesa.has(chave)) porDespesa.set(chave, []);
  porDespesa.get(chave).push(linha);
}
console.log('TOP_20_DESPESAS_PRONTAS', [...porDespesa.entries()]
  .map(([despesa, itens]) => ({ despesa, mps: itens.length, valor: arredondar(itens.reduce((v, item) => v + item.valorFuturo, 0)) }))
  .sort((a, b) => b.valor - a.valor).slice(0, 20));
console.log('CHECK_SOMA', arredondar(futuras.reduce((valor, linha) => valor + linha.valorFuturo, 0)));
