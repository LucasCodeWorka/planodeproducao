// Gera a conferência detalhada (somente arquivos locais, sem gravação no TOTVS).
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const origem = '.agents/totvs_agent_minimo/data/preparo-fcpfm017-atual.json';
const destino = '.agents/totvs_agent_minimo/data/conciliacao-fcpfm017-2026-10-15.md';
const destinoJson = '.agents/totvs_agent_minimo/data/conciliacao-fcpfm017-2026-10-15.json';
const destinoLote = '.agents/totvs_agent_minimo/data/lote-pronto-fcpfm017-2026-10-15.json';
const { resumo, linhas } = JSON.parse(fs.readFileSync(origem, 'utf8'));
const periodos = ['MA', 'PX', 'UL', 'QT', 'QU'];
const meses = periodos.map((periodo) => resumo.periodos[periodo]);
const duplicadas = new Set([11103, 11399]);
const cents = (valor) => Math.round((Number(valor) + Number.EPSILON) * 100);
const brl = (centavos) => `R$ ${(centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Distribui centavos residuais pelos maiores restos para preservar o total.
function distribuirCentavos(valores, alvoCentavos) {
  const centavosBrutos = valores.map((valor) => valor * 100);
  const partes = centavosBrutos.map((valor) => Math.floor(valor + 1e-8));
  const restantes = alvoCentavos - partes.reduce((soma, valor) => soma + valor, 0);
  const ordem = centavosBrutos.map((valor, indice) => ({ indice, resto: valor - partes[indice] }))
    .sort((a, b) => b.resto - a.resto || a.indice - b.indice);
  if (restantes < 0 || restantes > ordem.length) throw new Error(`Resíduo de centavos inesperado: ${restantes}`);
  for (const { indice } of ordem.slice(0, restantes)) partes[indice]++;
  return partes;
}

function categoria(linha) {
  if (!linha.despesa) return 'SEM_DESPESA';
  if (!linha.noPlano500Cc506) return 'FORA_PLANO';
  if (duplicadas.has(linha.despesa)) return 'DESPESA_DUPLICADA';
  return 'PRONTA';
}

const futuras = linhas.filter((linha) => linha.valorFuturo > 0);
const despesas = new Map();
for (const linha of futuras) {
  const chave = linha.despesa ? String(linha.despesa) : `MP_${linha.mp}`;
  if (!despesas.has(chave)) despesas.set(chave, []);
  despesas.get(chave).push(linha);
}

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
    ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true' }
    : undefined,
});
let metadados;
try {
  const ids = [...despesas.keys()].filter((chave) => !chave.startsWith('MP_')).map(Number);
  metadados = (await pool.query(`
    SELECT d.cd_despesaitem::int AS despesa, d.ds_despesaitem AS descricao,
           p.nr_seqplanoctai::text AS sequencia, p.ds_planoctai AS descricao_plano
    FROM public.vr_fcp_despesaitem d
    LEFT JOIN public.vr_fcp_planoctai p
      ON p.cd_despesaitem=d.cd_despesaitem AND p.cd_planoctac=500 AND p.cd_ccusto=506
    WHERE d.cd_despesaitem=ANY($1::int[])
    ORDER BY d.cd_despesaitem, p.nr_seqplanoctai
  `, [ids])).rows;
} finally {
  await pool.end();
}
const metaPorDespesa = new Map();
for (const row of metadados) {
  if (!metaPorDespesa.has(row.despesa)) metaPorDespesa.set(row.despesa, { descricao: row.descricao, sequencias: [] });
  if (row.sequencia) metaPorDespesa.get(row.despesa).sequencias.push(row.sequencia);
}

const propostas = [...despesas.entries()].map(([chave, itens]) => {
  const despesa = chave.startsWith('MP_') ? null : Number(chave);
  if (new Set(itens.map(categoria)).size !== 1) throw new Error(`Categorias divergentes na despesa ${chave}`);
  return {
    categoria: categoria(itens[0]),
    despesa,
    descricao: despesa ? metaPorDespesa.get(despesa)?.descricao || '' : '',
    sequencias: despesa ? metaPorDespesa.get(despesa)?.sequencias || [] : [],
    mps: itens.map((item) => item.mp).sort((a, b) => Number(a) - Number(b)),
    valorBruto: itens.reduce((valor, item) => valor + item.valorFuturo, 0),
    valoresBrutosPorMes: periodos.map((periodo) => itens.reduce((valor, item) => valor + item.porPeriodo[periodo].futuro, 0)),
  };
});
const totaisAlvo = distribuirCentavos(propostas.map((proposta) => proposta.valorBruto), cents(resumo.valorFuturo));
propostas.forEach((proposta, indice) => {
  proposta.totalCentavos = totaisAlvo[indice];
  proposta.centavosPorMes = distribuirCentavos(proposta.valoresBrutosPorMes, proposta.totalCentavos);
  if (proposta.centavosPorMes.reduce((a, b) => a + b, 0) !== proposta.totalCentavos) {
    throw new Error(`Meses não fecham para ${proposta.despesa || proposta.mps[0]}`);
  }
});
const prontas = propostas.filter((proposta) => proposta.categoria === 'PRONTA');
if (prontas.length !== 197 || prontas.some((proposta) => proposta.sequencias.length !== 1)) {
  throw new Error('Lote pronto diferente de 197 despesas com sequência única');
}
if (propostas.reduce((soma, proposta) => soma + proposta.totalCentavos, 0) !== cents(resumo.valorFuturo)) {
  throw new Error('Total geral não confere com a fonte');
}
const categorias = ['PRONTA', 'DESPESA_DUPLICADA', 'FORA_PLANO', 'SEM_DESPESA'];
const markdown = [
  '# Conciliação preliminar FCPFM017 — 15/10/2026',
  '',
  `Base calculada em ${resumo.criadoEm}; plano de produção LIEBE, horizonte MA–QU (${meses.join(', ')}).`,
  'Cenário: **somente necessidade futura com folga**. Compras já em andamento não entram nesta proposta; inclusão delas depende de decisão do usuário e de conciliação de competência.',
  'Fonte: `preparo-fcpfm017-atual.json`. Este arquivo é uma proposta local, **não comprova lançamento no TOTVS**.',
  'Cada despesa agrega todas as MPs vinculadas; centavos residuais são distribuídos pelos maiores restos para preservar o total geral e a soma por despesa.',
  '',
  '| Situação | Despesas/MPs sem despesa | MPs | Total calculado |',
  '|---|---:|---:|---:|',
];
for (const categoriaAtual of categorias) {
  const itens = propostas.filter((proposta) => proposta.categoria === categoriaAtual);
  markdown.push(`| ${categoriaAtual} | ${itens.length} | ${itens.reduce((soma, item) => soma + item.mps.length, 0)} | ${brl(itens.reduce((soma, item) => soma + item.totalCentavos, 0))} |`);
}
markdown.push('', '## Detalhe por despesa e competência', '',
  `| Situação | Despesa | Descrição | Sequência(s) plano 500/506 | MP(s) | ${meses.join(' | ')} | Total |`,
  `|---|---:|---|---|---|${meses.map(() => '---:|').join('')}---:|`);
for (const categoriaAtual of categorias) {
  const itens = propostas.filter((proposta) => proposta.categoria === categoriaAtual)
    .sort((a, b) => b.totalCentavos - a.totalCentavos || (a.despesa || 0) - (b.despesa || 0));
  for (const item of itens) {
    const descricao = item.descricao.replaceAll('|', '/');
    markdown.push(`| ${item.categoria} | ${item.despesa || '—'} | ${descricao} | ${item.sequencias.join(', ') || '—'} | ${item.mps.join(', ')} | ${item.centavosPorMes.map(brl).join(' | ')} | ${brl(item.totalCentavos)} |`);
  }
}
markdown.push('',
  '## Pendências antes de gravar', '',
  '- Confirmar no próprio FCPFM017 se a competência é editada por mês e se 2027 exige orçamento separado.',
  '- Confirmar se incluir compras já em andamento ou apenas necessidade futura; valores desta tabela consideram apenas necessidade futura.',
  '- Vincular as 42 despesas fora do plano, resolver as duas despesas duplicadas e classificar as 16 MPs sem despesa (inclusive embalagens e pino).',
  '- Obter preço válido para as duas MPs de viés ainda sem preço; elas não entram nos valores acima.',
  '- Antes de cada gravação, verificar valor já existente no TOTVS para evitar sobrescrever ou duplicar orçamento.',
  '');
fs.writeFileSync(destino, markdown.join('\n'), 'utf8');
fs.writeFileSync(destinoJson, JSON.stringify({
  fonte: origem,
  calculadoEm: resumo.criadoEm,
  criterio: 'NECESSIDADE_FUTURA_COM_FOLGA_SEM_COMPRAS_EM_ANDAMENTO',
  plano: 500,
  centroCusto: 506,
  meses,
  despesas: propostas.map(({ categoria, despesa, descricao, sequencias, mps, centavosPorMes, totalCentavos }) => ({
    categoria, despesa, descricao, sequencias, mps,
    valoresCentavos: Object.fromEntries(meses.map((mes, indice) => [mes, centavosPorMes[indice]])),
    totalCentavos,
  })),
}, null, 2) + '\n', 'utf8');
const lancamentos = prontas.flatMap((proposta) => meses.map((mes, indice) => ({
  ano: Number(mes.slice(0, 4)),
  mes: Number(mes.slice(5, 7)),
  competencia: mes,
  plano: 500,
  centroCusto: 506,
  despesa: proposta.despesa,
  sequenciaPlano: proposta.sequencias[0],
  valorCentavos: proposta.centavosPorMes[indice],
}))).filter((item) => item.valorCentavos > 0)
  .sort((a, b) => a.ano - b.ano || a.mes - b.mes || Number(a.sequenciaPlano) - Number(b.sequenciaPlano));
const totalLote = lancamentos.reduce((soma, item) => soma + item.valorCentavos, 0);
const totalProntas = prontas.reduce((soma, item) => soma + item.totalCentavos, 0);
if (totalLote !== totalProntas) throw new Error('Lote por competência não fecha com despesas prontas');
fs.writeFileSync(destinoLote, JSON.stringify({
  fonte: destinoJson,
  criterio: 'NECESSIDADE_FUTURA_COM_FOLGA_SEM_COMPRAS_EM_ANDAMENTO',
  status: 'PREPARADO_NAO_LANCADO',
  plano: 500,
  centroCusto: 506,
  despesas: prontas.length,
  entradas: lancamentos.length,
  totalCentavos: totalLote,
  totaisPorCompetencia: Object.fromEntries(meses.map((mes) => [mes, lancamentos
    .filter((item) => item.competencia === mes)
    .reduce((soma, item) => soma + item.valorCentavos, 0)])),
  lancamentos,
}, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ destino, destinoJson, destinoLote, entradas: lancamentos.length,
  totalLoteCentavos: totalLote,
  totaisPorCompetencia: Object.fromEntries(meses.map((mes) => [mes, lancamentos
    .filter((item) => item.competencia === mes)
    .reduce((soma, item) => soma + item.valorCentavos, 0)])),
  linhas: propostas.length, prontas: prontas.length,
  totalCentavos: propostas.reduce((soma, p) => soma + p.totalCentavos, 0) }, null, 2));
