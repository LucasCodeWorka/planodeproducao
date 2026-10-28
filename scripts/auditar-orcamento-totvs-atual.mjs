// Confere o espelho mensal do FCPFM017 contra os lotes e a necessidade atual.
// Consulta somente leitura; nao altera o banco nem o TOTVS.
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const origem = process.argv[2];
const destino = process.argv[3];
if (!origem || !destino) throw new Error('Uso: node scripts/auditar-orcamento-totvs-atual.mjs CONFERENCIA_JSON AUDITORIA_JSON');
const conferencia = JSON.parse(fs.readFileSync(origem, 'utf8'));
const meses = new Set(conferencia.resumo.meses);
const lote = new Map(conferencia.lotesPorCompetencia.map((item) => [item.id, item.valorCentavos]));
const necessidade = new Map(conferencia.necessidadePorCompetencia.map((item) => [item.id, item.valorCentavos]));

const pool = new pg.Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
    ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true' }
    : undefined,
});
let rows;
try {
  ({ rows } = await pool.query(`
    SELECT p.cd_despesaitem::text AS despesa,
           v.nr_ano::int AS ano, v.nr_mes::int AS mes,
           COUNT(*)::int AS linhas,
           ROUND(SUM(v.vl_visao)::numeric * 100)::bigint AS valor_centavos
    FROM public.vr_fcp_visaoi v
    JOIN public.vr_fcp_planoctai p ON p.nr_seqplanoctai=v.nr_seqplanoctai
    WHERE v.cd_visao=1 AND p.cd_planoctac=500 AND p.cd_ccusto=506
      AND v.nr_ano IN (2026,2027)
    GROUP BY p.cd_despesaitem, v.nr_ano, v.nr_mes
    ORDER BY v.nr_ano, v.nr_mes, p.cd_despesaitem
  `));
} finally {
  await pool.end();
}
const erp = new Map();
let linhas = 0;
for (const row of rows) {
  const competencia = `${row.ano}-${String(row.mes).padStart(2, '0')}`;
  if (!meses.has(competencia)) continue;
  if (!row.despesa) throw new Error(`Linha de visao sem despesa em ${competencia}`);
  const id = `${row.despesa}|${competencia}`;
  if (erp.has(id)) throw new Error(`Despesa/competencia duplicada no espelho: ${id}`);
  erp.set(id, Number(row.valor_centavos));
  linhas += row.linhas;
}
function comparar(esperado, atual) {
  return [...new Set([...esperado.keys(), ...atual.keys()])]
    .map((id) => ({ id, esperadoCentavos: esperado.get(id) || 0,
      totvsCentavos: atual.get(id) || 0,
      diferencaCentavos: (atual.get(id) || 0) - (esperado.get(id) || 0) }))
    .filter((item) => item.diferencaCentavos !== 0)
    .sort((a, b) => Math.abs(b.diferencaCentavos) - Math.abs(a.diferencaCentavos));
}
const divergenciasLotes = comparar(lote, erp);
const divergenciasNecessidade = comparar(necessidade, erp);
const total = (mapa) => [...mapa.values()].reduce((a, b) => a + b, 0);
const porCompetencia = [...meses].map((competencia) => {
  const linhas = divergenciasNecessidade.filter((item) => item.id.endsWith(`|${competencia}`));
  return {
    competencia,
    totvsCentavos: [...erp].filter(([id]) => id.endsWith(`|${competencia}`))
      .reduce((soma, [, valor]) => soma + valor, 0),
    necessidadeCentavos: [...necessidade].filter(([id]) => id.endsWith(`|${competencia}`))
      .reduce((soma, [, valor]) => soma + valor, 0),
    faltaCentavos: linhas.filter((item) => item.diferencaCentavos < 0)
      .reduce((soma, item) => soma - item.diferencaCentavos, 0),
    excessoCentavos: linhas.filter((item) => item.diferencaCentavos > 0)
      .reduce((soma, item) => soma + item.diferencaCentavos, 0),
  };
});
const resumo = {
  calculadoEm: conferencia.resumo.calculadoEm,
  meses: [...meses],
  linhasEspelho: linhas,
  despesaCompetenciaEspelho: erp.size,
  totalTotvsCentavos: total(erp),
  totalLotesCentavos: total(lote),
  totalNecessidadeCentavos: total(necessidade),
  faltaCentavos: porCompetencia.reduce((soma, item) => soma + item.faltaCentavos, 0),
  excessoCentavos: porCompetencia.reduce((soma, item) => soma + item.excessoCentavos, 0),
  divergenciasTotvsVsLotes: divergenciasLotes.length,
  divergenciasTotvsVsNecessidade: divergenciasNecessidade.length,
  porCompetencia,
};
const relatorio = { resumo, divergenciasLotes, divergenciasNecessidade,
  espelhoPorCompetencia: [...erp].map(([id, valorCentavos]) => ({ id, valorCentavos })) };
fs.writeFileSync(destino, JSON.stringify(relatorio, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ resumo, maioresDiferencasNecessidade: divergenciasNecessidade.slice(0, 25),
  divergenciasLotes: divergenciasLotes.slice(0, 25) }, null, 2));
if (divergenciasLotes.length) process.exitCode = 1;
