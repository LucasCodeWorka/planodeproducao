// Confere, DEPOIS da sincronização do ERP, as despesas criadas pelo
// .agents/totvs_agent_minimo/scripts/criar_despesas_lote_fcpfm003.py e só então liga cada
// grupo+cor à despesa em app_mp_despesa (tabela nossa).
//   - acha a despesa pelo NOME EXATO (o código não é presumido);
//   - exige o perfil do lote (Padrão, Custo/Despesa = Despesa, Fixo, Administrativo, rateio 100);
//   - mais de uma despesa com o mesmo nome = duplicada: não liga, aponta.
// Sem --gravar só relata. Com --gravar grava app_mp_despesa e escreve uma classificação
// (acao VINCULAR_PLANO) que o scripts/preparar-vinculos-fcpfm043.mjs transforma em lote.
// Uso: node scripts/conferir-criacao-despesas-fcpfm003.mjs LOTE.json RESULTADO.jsonl [--gravar]
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const [arqLote, arqResultado] = process.argv.slice(2);
const gravar = process.argv.includes('--gravar');
if (!arqLote || !arqResultado) throw new Error('Uso: node scripts/conferir-criacao-despesas-fcpfm003.mjs LOTE.json RESULTADO.jsonl [--gravar]');
const lote = JSON.parse(fs.readFileSync(arqLote, 'utf8'));
const gravados = new Set(fs.readFileSync(arqResultado, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.status === 'GRAVADO').map((r) => `${r.seqgrupo}|${r.cor}`));
const norm = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();

const pool = new pg.Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
  options: '-c statement_timeout=120000', max: 1,
});
try {
  const porNome = new Map();
  for (const r of (await pool.query(`SELECT cd_despesaitem::int AS codigo, ds_despesaitem, pr_rateio, tp_custodespesa, tp_fixovariavel, tp_diretoindireto, in_padrao, tp_ccusto, in_bloqueada FROM public.vr_fcp_despesaitem`)).rows) {
    const k = norm(r.ds_despesaitem); if (!porNome.has(k)) porNome.set(k, []); porNome.get(k).push(r);
  }
  const ok = []; const naoSincronizado = []; const duplicado = []; const foraDoPerfil = []; const naoGravado = [];
  for (const item of lote.itens) {
    const chave = `${item.seqgrupo}|${item.cor}`;
    if (!gravados.has(chave)) { naoGravado.push(item); continue; }
    let achados = porNome.get(norm(item.descricao)) || [];
    // Nome CORTADO no ERP (25/11/2026: 1623 "…BRILHOSO 7MM BERINGE", 1624 "…C/ LOGO PRE"):
    // aceita se o nome gravado tem 30+ caracteres, é o começo exato do esperado e é único.
    if (!achados.length) {
      const alvo = norm(item.descricao);
      const prefixos = [...porNome.entries()].filter(([nome]) => nome.length >= 30 && alvo.startsWith(nome) && nome !== alvo);
      if (prefixos.length === 1 && prefixos[0][1].length === 1) {
        achados = prefixos[0][1];
        item.nomeCortado = true;
      }
    }
    if (!achados.length) { naoSincronizado.push(item); continue; }
    if (achados.length > 1) { duplicado.push({ ...item, codigos: achados.map((a) => a.codigo) }); continue; }
    const d = achados[0];
    const diverge = Object.entries(lote.perfil).filter(([campo, esperado]) => String(d[campo] ?? '') !== String(esperado))
      .concat(d.in_bloqueada === 'T' ? [['in_bloqueada', null]] : []);
    if (diverge.length) { foraDoPerfil.push({ ...item, codigo: d.codigo, campos: Object.fromEntries(diverge.map(([c]) => [c, d[c]])) }); continue; }
    ok.push({ ...item, codigo: d.codigo });
  }
  if (gravar && ok.length) {
    await pool.query('BEGIN');
    try {
      for (const i of ok) {
        const up = await pool.query(`UPDATE public.app_mp_despesa SET iddespesa = $3, desc_mp = COALESCE(desc_mp, $4), status = 'OK', erro = NULL, data_atualizacao = NOW() WHERE seqgrupo = $1 AND cor = $2`, [i.seqgrupo, i.cor, i.codigo, i.descricao]);
        if (!up.rowCount) await pool.query(`INSERT INTO public.app_mp_despesa (seqgrupo, cor, iddespesa, desc_mp, status, erro, data_atualizacao) VALUES ($1, $2, $3, $4, 'OK', NULL, NOW())`, [i.seqgrupo, i.cor, i.codigo, i.descricao]);
      }
      await pool.query('COMMIT');
    } catch (e) { await pool.query('ROLLBACK'); throw e; }
    const hoje = new Date().toISOString().slice(0, 10);
    const arqClass = `.agents/totvs_agent_minimo/data/classificacao-criadas-fcpfm003-${hoje}.json`;
    fs.writeFileSync(arqClass, JSON.stringify({ fonte: arqLote, itens: ok.map((i) => ({ acao: 'VINCULAR_PLANO', despesa: i.codigo, mp: i.mps.join(','), futuroCentavos: i.valorCentavos, compradoCentavos: 0, descricao: i.descricao })) }, null, 2) + '\n');
    console.log(`app_mp_despesa: ${ok.length} grupo+cor ligados. Classificação para o FCPFM043: ${arqClass}`);
  }
  console.log(JSON.stringify({
    gravar, conferidas: lote.itens.length, ok: ok.length, naoGravadoNoTotvs: naoGravado.length,
    naoSincronizado: naoSincronizado.map((i) => i.descricao), duplicado: duplicado.map((i) => `${i.descricao}: ${i.codigos.join(', ')}`),
    foraDoPerfil: foraDoPerfil.map((i) => `${i.codigo} ${i.descricao}: ${JSON.stringify(i.campos)}`),
  }, null, 2));
  if (duplicado.length || foraDoPerfil.length) process.exitCode = 1;
} finally { await pool.end(); }
