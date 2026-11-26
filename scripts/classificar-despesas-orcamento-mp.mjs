// Classifica as MPs do orçamento que não têm despesa no plano 500/CC 506 e diz o que cada
// uma precisa para chegar no FCPFM017. Somente leitura (sessão READ ONLY). Uso:
//   node scripts/classificar-despesas-orcamento-mp.mjs PREPARO.json [PASTA_SAIDA]
//
// Ações possíveis, da mais barata para a mais cara:
//   LIGAR_LOCAL      já existe despesa no ERP com o MESMO nome da MP e ela está no plano 500/506:
//                    só falta o vínculo local em app_mp_despesa (tabela nossa).
//   LIGAR_E_VINCULAR mesma coisa, mas a despesa existente está fora do plano: app_mp_despesa +
//                    FCPFM043.
//   VINCULAR_PLANO   a MP já tem despesa local, só falta pô-la no plano 500/506 (FCPFM043).
//   REVISAR          o nome sem a cor bate com uma despesa genérica (sem cor) ou há mais de uma
//                    despesa com o mesmo nome: decisão humana (evita duplicar como em 19/10).
//   CRIAR            nenhuma despesa com o nome COMPLETO (com a cor): FCPFM003 (criar) ->
//                    app_mp_despesa -> FCPFM043. As irmãs (mesma MP, outra cor) vão junto como
//                    referência do padrão de cadastro.
// O nome comparado é o do produto com a cor (vr_prd_prdgrade.nm_produto, "RENDA ZG05914
// BRANCO U"): as despesas do ERP são uma por cor. Comparar sem a cor confundia irmãs com
// equivalentes (25/11/2026).
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const [arqPreparo, pastaSaida = '.agents/totvs_agent_minimo/data'] = process.argv.slice(2);
if (!arqPreparo) throw new Error('Uso: node scripts/classificar-despesas-orcamento-mp.mjs PREPARO.json [PASTA_SAIDA]');
const preparo = JSON.parse(fs.readFileSync(arqPreparo, 'utf8'));
const alvo = preparo.linhas.filter((l) => l.valorOrcamento > 0 && (!l.despesa || !l.noPlano500Cc506));

const norm = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Z0-9]+/g, ' ').trim().replace(/ U$/, '');
const grams = (s) => { const v = ` ${s} `; const g = new Set(); for (let i = 0; i + 2 < v.length; i++) g.add(v.slice(i, i + 3)); return g; };
const sim = (a, b) => { let c = 0; for (const x of a) if (b.has(x)) c++; return (2 * c) / (a.size + b.size || 1); };

const pool = new pg.Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
  options: '-c default_transaction_read_only=on -c statement_timeout=120000', max: 1,
});
let despesas; let noPlano; let nomes;
try {
  nomes = new Map((await pool.query(`SELECT cd_produto::text AS mp, nm_produto FROM vr_prd_prdgrade WHERE cd_produto::text = ANY($1::text[])`, [alvo.map((l) => String(l.mp))])).rows.map((r) => [r.mp, r.nm_produto]));
  despesas = (await pool.query(`SELECT cd_despesaitem::int AS codigo, ds_despesaitem AS nome, ds_original FROM vr_fcp_despesaitem WHERE cd_despesaitem IS NOT NULL`)).rows;
  noPlano = new Set((await pool.query(`SELECT DISTINCT cd_despesaitem::int AS d FROM vr_fcp_planoctai WHERE cd_planoctac = 500 AND cd_ccusto = 506 AND cd_despesaitem IS NOT NULL`)).rows.map((r) => r.d));
} finally { await pool.end(); }

const porNome = new Map(); const porPrimeira = new Map();
for (const d of despesas) for (const nome of [d.nome, d.ds_original]) {
  const n = norm(nome); if (!n) continue;
  if (!porNome.has(n)) porNome.set(n, new Set()); porNome.get(n).add(d.codigo);
  const p = n.split(' ')[0]; if (!porPrimeira.has(p)) porPrimeira.set(p, []);
  porPrimeira.get(p).push({ codigo: d.codigo, nome, g: grams(n) });
}

const itens = alvo.map((l) => {
  const nomeCompleto = nomes.get(String(l.mp)) || l.descricao;
  const n = norm(nomeCompleto);
  const nBase = norm(l.descricao);
  const base = { mp: l.mp, grupo: l.grupo, cor: l.cor, descricao: nomeCompleto, futuroCentavos: Math.round(l.valorFuturo * 100), compradoCentavos: Math.round(l.valorComprado * 100), despesaLocal: l.despesa || null };
  if (l.despesa) return { ...base, acao: 'VINCULAR_PLANO', despesa: l.despesa };
  const exatas = [...(porNome.get(n) || [])].sort((a, b) => a - b);
  if (exatas.length === 1) return { ...base, acao: noPlano.has(exatas[0]) ? 'LIGAR_LOCAL' : 'LIGAR_E_VINCULAR', despesa: exatas[0] };
  if (exatas.length > 1) return { ...base, acao: 'REVISAR', motivo: 'mais de uma despesa com o mesmo nome', candidatos: exatas.map((c) => ({ codigo: c, score: 1, noPlano: noPlano.has(c) })) };
  const genericas = nBase && nBase !== n ? [...(porNome.get(nBase) || [])] : [];
  if (genericas.length) return { ...base, acao: 'REVISAR', motivo: 'existe despesa generica sem cor', candidatos: genericas.map((c) => ({ codigo: c, score: 1, noPlano: noPlano.has(c) })) };
  // Irmãs: despesas com o mesmo nome-base e outra cor (só referência do padrão de cadastro).
  const irmas = (porPrimeira.get(nBase.split(' ')[0]) || [])
    .filter((c) => nBase && norm(c.nome).startsWith(`${nBase} `))
    .map((c) => ({ codigo: c.codigo, nome: c.nome, noPlano: noPlano.has(c.codigo) }))
    .filter((c, i, xs) => xs.findIndex((y) => y.codigo === c.codigo) === i).slice(0, 4);
  return { ...base, acao: 'CRIAR', irmas };
});

const ordem = ['LIGAR_LOCAL', 'LIGAR_E_VINCULAR', 'VINCULAR_PLANO', 'REVISAR', 'CRIAR'];
const resumo = Object.fromEntries(ordem.map((a) => {
  const xs = itens.filter((i) => i.acao === a);
  return [a, { mps: xs.length, despesasDistintas: new Set(xs.map((x) => x.despesa).filter(Boolean)).size, futuroCentavos: xs.reduce((s, x) => s + x.futuroCentavos, 0), compradoCentavos: xs.reduce((s, x) => s + x.compradoCentavos, 0) }];
}));
const hoje = new Date().toISOString().slice(0, 10);
const arq = path.join(pastaSaida, `classificacao-despesas-orcamento-mp-${hoje}.json`);
fs.writeFileSync(arq, JSON.stringify({ calculadoEm: preparo.resumo.criadoEm, totalDespesasErp: despesas.length, resumo, itens }, null, 2) + '\n');
const csv = [['acao', 'mp', 'grupo', 'cor', 'descricao', 'despesa', 'candidatos ou irmas', 'futuro', 'comprado'].join(';'),
  ...itens.sort((a, b) => ordem.indexOf(a.acao) - ordem.indexOf(b.acao) || (b.futuroCentavos + b.compradoCentavos) - (a.futuroCentavos + a.compradoCentavos))
    .map((i) => [i.acao, i.mp, i.grupo, i.cor, `"${String(i.descricao).replace(/"/g, '""')}"`, i.despesa || '', (i.candidatos || i.irmas || []).map((c) => `${c.codigo}${c.nome ? ` ${c.nome}` : ''}${c.noPlano ? ' [plano]' : ''}`).join(' | '), (i.futuroCentavos / 100).toFixed(2).replace('.', ','), (i.compradoCentavos / 100).toFixed(2).replace('.', ',')].join(';'))];
fs.writeFileSync(arq.replace(/\.json$/, '.csv'), '﻿' + csv.join('\r\n') + '\r\n');
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
console.log(JSON.stringify({ arquivo: arq, totalDespesasErp: despesas.length, resumo: Object.fromEntries(Object.entries(resumo).map(([k, v]) => [k, { ...v, futuroCentavos: brl(v.futuroCentavos), compradoCentavos: brl(v.compradoCentavos) }])) }, null, 2));
