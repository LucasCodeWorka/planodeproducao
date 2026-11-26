// Monta o lote do FCPFM017 a partir do preparo e da conferência de hoje, contra o espelho do
// TOTVS lido AGORA (só leitura). Separa:
//   - lancar:   célula vazia no TOTVS com necessidade -> vai no lote, no formato que o
//               .agents/totvs_agent_minimo/scripts/lancar_lote_fcpfm017.py lê;
//   - ajustar:  célula já preenchida com valor diferente (o lançador NÃO altera; decisão humana);
//   - bloqueado: necessidade de MP sem despesa ou com despesa fora do plano 500/CC 506.
// Não grava no banco nem no TOTVS. Uso:
//   node scripts/montar-lote-fcpfm017.mjs PREPARO.json CONFERENCIA.json [PASTA_SAIDA]
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const [arqPreparo, arqConferencia, pastaArg] = process.argv.slice(2);
const pastaSaida = pastaArg && !pastaArg.startsWith('--') ? pastaArg : '.agents/totvs_agent_minimo/data';
if (!arqPreparo || !arqConferencia) throw new Error('Uso: node scripts/montar-lote-fcpfm017.mjs PREPARO.json CONFERENCIA.json [PASTA_SAIDA]');
const preparo = JSON.parse(fs.readFileSync(arqPreparo, 'utf8'));
const conferencia = JSON.parse(fs.readFileSync(arqConferencia, 'utf8'));
const meses = new Set(conferencia.resumo.meses);
const hoje = new Date().toISOString().slice(0, 10);

// Despesa -> MPs e se TODAS as MPs dela estão com a despesa no plano 500/CC 506.
const porDespesa = new Map();
for (const l of preparo.linhas.filter((x) => x.valorFuturo > 0)) {
  const id = l.despesa ? String(l.despesa) : `MP_${l.mp}`;
  const g = porDespesa.get(id) || { mps: [], noPlano: true, descricoes: new Set() };
  g.mps.push(l.mp); g.noPlano = g.noPlano && Boolean(l.noPlano500Cc506); g.descricoes.add(l.descricao);
  porDespesa.set(id, g);
}
const necessidade = new Map(conferencia.necessidadePorCompetencia.map((x) => [x.id, x.valorCentavos]));
// Despesas que o bot VIU vincular ao plano 500/506 hoje (aviso de sucesso no FCPFM043), mas
// que a cópia do ERP no banco ainda não trouxe (25/11/2026: a sincronização parou às 19:12).
// `--vinculadas a.jsonl,b.jsonl` = resultados do vinculador; só status CONFIRMADO conta.
const iVinc = process.argv.indexOf('--vinculadas');
const vinculadasHoje = new Set();
if (iVinc > 0) for (const arq of String(process.argv[iVinc + 1] || '').split(',').filter(Boolean)) {
  const ultimo = new Map();
  for (const linha of fs.readFileSync(arq, 'utf8').split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean)) { const r = JSON.parse(linha); ultimo.set(String(r.codigo), r.status); }
  for (const [c, st] of ultimo) if (st === 'CONFIRMADO') vinculadasHoje.add(c);
}

const pool = new pg.Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
  options: '-c default_transaction_read_only=on -c statement_timeout=120000', max: 1,
});
let espelho;
try {
  const { rows } = await pool.query(`
    SELECT p.cd_despesaitem::text AS despesa, v.nr_ano::int AS ano, v.nr_mes::int AS mes,
           ROUND(SUM(v.vl_visao)::numeric * 100)::bigint AS centavos
      FROM public.vr_fcp_visaoi v
      JOIN public.vr_fcp_planoctai p ON p.nr_seqplanoctai = v.nr_seqplanoctai
     WHERE v.cd_visao = 1 AND p.cd_planoctac = 500 AND p.cd_ccusto = 506 AND v.nr_ano IN (2026, 2027)
     GROUP BY 1, 2, 3`);
  espelho = new Map(rows
    .map((r) => [`${r.despesa}|${r.ano}-${String(r.mes).padStart(2, '0')}`, Number(r.centavos)])
    .filter(([id]) => meses.has(id.split('|')[1])));
} finally { await pool.end(); }

const lancar = []; const ajustar = []; const bloqueado = []; let jaCorreto = 0;
for (const [id, centavos] of necessidade) {
  const [desp, competencia] = id.split('|');
  const g = porDespesa.get(desp);
  if (g && !g.noPlano && vinculadasHoje.has(desp)) g.noPlano = true;
  if (!g || desp.startsWith('MP_') || !g.noPlano) {
    bloqueado.push({ id, motivo: desp.startsWith('MP_') ? 'SEM_DESPESA' : 'FORA_DO_PLANO_500_506', mps: g?.mps || [desp.replace('MP_', '')], necessidadeCentavos: centavos });
    continue;
  }
  const totvs = espelho.get(id) || 0;
  if (totvs === centavos) { jaCorreto += 1; continue; }
  const [ano, mes] = competencia.split('-').map(Number);
  if (totvs === 0) {
    lancar.push({ ano, mes, competencia, plano: 500, centroCusto: 506, despesa: Number(desp), sequenciaPlano: null, mps: g.mps, valorCentavos: centavos });
  } else {
    ajustar.push({ despesa: Number(desp), competencia, totvsCentavos: totvs, propostoCentavos: centavos, diferencaCentavos: centavos - totvs, mps: g.mps });
  }
}
// Excesso: TOTVS tem valor e a necessidade de hoje é zero naquela despesa/mês.
for (const [id, totvs] of espelho) {
  if (necessidade.has(id) || totvs === 0) continue;
  const [desp, competencia] = id.split('|');
  ajustar.push({ despesa: Number(desp), competencia, totvsCentavos: totvs, propostoCentavos: 0, diferencaCentavos: -totvs, mps: porDespesa.get(desp)?.mps || [] });
}
lancar.sort((a, b) => a.ano - b.ano || a.despesa - b.despesa || a.mes - b.mes);
ajustar.sort((a, b) => Math.abs(b.diferencaCentavos) - Math.abs(a.diferencaCentavos));

const soma = (xs, k) => xs.reduce((s, x) => s + x[k], 0);
const porCompetencia = (xs, k) => Object.fromEntries([...meses].map((m) => [m, soma(xs.filter((x) => x.competencia === m || x.id?.endsWith(`|${m}`)), k)]));
const lote = {
  fonte: path.basename(arqPreparo),
  criterio: 'NECESSIDADE_FUTURA_COM_FOLGA_SEM_COMPRAS_EM_ANDAMENTO__SO_CELULA_VAZIA',
  status: 'PREPARADO_NAO_LANCADO',
  plano: 500,
  centroCusto: 506,
  despesas: new Set(lancar.map((x) => x.despesa)).size,
  entradas: lancar.length,
  totalCentavos: soma(lancar, 'valorCentavos'),
  totaisPorCompetencia: porCompetencia(lancar, 'valorCentavos'),
  lancamentos: lancar,
};
const relatorio = {
  calculadoEm: preparo.resumo.criadoEm, espelhoLidoEm: new Date().toISOString(),
  jaCorretoNoTotvs: jaCorreto,
  lancar: { entradas: lancar.length, despesas: lote.despesas, totalCentavos: lote.totalCentavos, porCompetencia: lote.totaisPorCompetencia },
  ajustar: { entradas: ajustar.length, subirCentavos: soma(ajustar.filter((x) => x.diferencaCentavos > 0), 'diferencaCentavos'), descerCentavos: -soma(ajustar.filter((x) => x.diferencaCentavos < 0), 'diferencaCentavos'), itens: ajustar },
  bloqueado: { entradas: bloqueado.length, totalCentavos: soma(bloqueado, 'necessidadeCentavos'), porMotivo: Object.fromEntries(['SEM_DESPESA', 'FORA_DO_PLANO_500_506'].map((m) => [m, soma(bloqueado.filter((x) => x.motivo === m), 'necessidadeCentavos')])), itens: bloqueado },
};
fs.mkdirSync(pastaSaida, { recursive: true });
const arqLote = path.join(pastaSaida, `lote-fcpfm017-${hoje}.json`);
const arqRel = path.join(pastaSaida, `lote-fcpfm017-${hoje}-relatorio.json`);
fs.writeFileSync(arqLote, JSON.stringify(lote, null, 2) + '\n', 'utf8');
fs.writeFileSync(arqRel, JSON.stringify(relatorio, null, 2) + '\n', 'utf8');
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
console.log(JSON.stringify({
  arquivos: [arqLote, arqRel],
  jaCorretoNoTotvs: jaCorreto,
  lancar: { entradas: lancar.length, despesas: lote.despesas, total: brl(lote.totalCentavos), porCompetencia: Object.fromEntries(Object.entries(lote.totaisPorCompetencia).map(([k, v]) => [k, brl(v)])) },
  ajustar: { entradas: ajustar.length, subir: brl(relatorio.ajustar.subirCentavos), descer: brl(relatorio.ajustar.descerCentavos) },
  bloqueado: { entradas: bloqueado.length, total: brl(relatorio.bloqueado.totalCentavos), semDespesa: brl(relatorio.bloqueado.porMotivo.SEM_DESPESA), foraDoPlano: brl(relatorio.bloqueado.porMotivo.FORA_DO_PLANO_500_506) },
}, null, 2));
