// Lote de CRIAÇÃO de despesas no FCPFM003 a partir da classificação (ação CRIAR).
// Regra do cadastro: UMA despesa por grupo+cor da MP (os tamanhos dividem a mesma despesa),
// com o nome que já está em app_mp_despesa.desc_mp — o mesmo padrão das existentes
// ("BJ 904.731 REMOVIVEL AMEIXA 44" cobre todos os tamanhos). Sem linha local, usa o nome
// completo da MP de maior valor do grupo+cor. Recusa nome que já exista no ERP (duplicaria).
// Somente leitura. Uso: node scripts/preparar-criacao-despesas-fcpfm003.mjs CLASSIFICACAO.json
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const [arq] = process.argv.slice(2);
if (!arq) throw new Error('Uso: node scripts/preparar-criacao-despesas-fcpfm003.mjs CLASSIFICACAO.json');
const classificacao = JSON.parse(fs.readFileSync(arq, 'utf8'));
const norm = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();

const grupos = new Map();
for (const i of classificacao.itens.filter((x) => x.acao === 'CRIAR')) {
  const k = `${i.grupo}|${i.cor}`;
  const g = grupos.get(k) || { seqgrupo: String(i.grupo), cor: String(i.cor), mps: [], valorCentavos: 0, maior: null };
  g.mps.push(i.mp); g.valorCentavos += i.futuroCentavos + i.compradoCentavos;
  if (!g.maior || i.futuroCentavos + i.compradoCentavos > g.maior.v) g.maior = { v: i.futuroCentavos + i.compradoCentavos, nome: i.descricao };
  grupos.set(k, g);
}

const pool = new pg.Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
  options: '-c default_transaction_read_only=on -c statement_timeout=120000', max: 1,
});
try {
  const locais = new Map((await pool.query(`SELECT seqgrupo::text, cor::text, desc_mp, iddespesa FROM public.app_mp_despesa`)).rows.map((r) => [`${r.seqgrupo}|${r.cor}`, r]));
  const existentes = new Map();
  for (const r of (await pool.query(`SELECT cd_despesaitem::int AS codigo, ds_despesaitem AS nome FROM public.vr_fcp_despesaitem`)).rows) existentes.set(norm(r.nome), r.codigo);
  const itens = []; const recusados = [];
  for (const [k, g] of grupos) {
    const local = locais.get(k);
    if (local?.iddespesa) { recusados.push({ ...g, motivo: `app_mp_despesa já aponta ${local.iddespesa}` }); continue; }
    const nome = String(local?.desc_mp || g.maior.nome).trim().toUpperCase();
    if (existentes.has(norm(nome))) { recusados.push({ ...g, nome, motivo: `já existe despesa ${existentes.get(norm(nome))} com esse nome` }); continue; }
    if (nome.length > 60) { recusados.push({ ...g, nome, motivo: 'nome com mais de 60 caracteres' }); continue; }
    itens.push({ seqgrupo: g.seqgrupo, cor: g.cor, descricao: nome, origemNome: local?.desc_mp ? 'app_mp_despesa' : 'mp', linhaLocal: Boolean(local), mps: g.mps, valorCentavos: g.valorCentavos });
  }
  itens.sort((a, b) => b.valorCentavos - a.valorCentavos);
  const hoje = new Date().toISOString().slice(0, 10);
  const destino = `.agents/totvs_agent_minimo/data/lote-criacao-fcpfm003-${hoje}.json`;
  // Perfil das despesas de MP já validadas (vr_fcp_despesaitem): o conferidor pós-sincronização
  // exige exatamente estes campos.
  const perfil = { pr_rateio: 100, tp_custodespesa: '2', tp_fixovariavel: '1', tp_diretoindireto: '3', in_padrao: 'T', tp_ccusto: '1' };
  fs.writeFileSync(destino, JSON.stringify({ fonte: arq, status: 'PREPARADO_NAO_CRIADO', perfil, despesas: itens.length, valorCentavos: itens.reduce((s, x) => s + x.valorCentavos, 0), recusados, itens }, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ destino, despesas: itens.length, mps: itens.reduce((s, x) => s + x.mps.length, 0),
    semLinhaLocal: itens.filter((x) => !x.linhaLocal).length, comBarra: itens.filter((x) => x.descricao.includes('/')).length,
    recusados: recusados.map((r) => `${r.seqgrupo}/${r.cor} ${r.nome || ''} — ${r.motivo}`), exemplo: itens.slice(0, 4).map((x) => `${x.seqgrupo}/${x.cor} ${x.descricao} (${x.mps.length} MPs)`) }, null, 2));
} finally { await pool.end(); }
