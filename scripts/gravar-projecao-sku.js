// Grava a projecao de FEVEREIRO/2027 em app_projecoes, numa transacao so.
//
// Dois arquivos, ambos no formato `idproduto<TAB>quantidade`:
//
//   1) LANCAMENTO (data/projecao_fev2027_lancamento.tsv) — a lista enviada pelo usuario,
//      765 SKUs / 33.383 pecas, gravada EXATAMENTE como veio. Nenhum valor e recalculado,
//      rateado ou arredondado aqui: 588 SKUs de edicao limitada (27.385), 131 de
//      permanente e cor nova (4.812) e 46 fora do filtro de marca/status da matriz.
//
//   2) AJUSTE (data/projecao_fev2027_ajuste_permanentes.tsv, opcional) — os permanentes e
//      cor nova que NAO estao na lista, reduzidos pro-rata para o total da matriz voltar a
//      137.500. Sem ele o mes fecha em 141.483, porque a edicao limitada lancada (27.385)
//      e maior que a do modelo de colecao (25.599) que formava aquele numero.
//      O arquivo ja vem com o valor final de cada SKU, calculado por maior-resto para
//      fechar exato — o script nao refaz a conta, so aplica.
//
// Sem --executar, simula e nao grava nada. O backup das linhas de mes=2/ano=2027 e escrito
// em data/ antes de qualquer alteracao, e o COMMIT so acontece se o total conferir.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const useSsl = String(process.env.DB_SSL || '').trim().toLowerCase() === 'true';
const pool = new Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  ssl: useSsl ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').trim().toLowerCase() === 'true' } : undefined,
});

const f = (v) => Math.round(Number(v) || 0).toLocaleString('pt-BR');

// MES e ANO sao OBRIGATORIOS na linha de comando, sem valor padrao, de proposito. Antes o mes
// era constante (2) no topo do arquivo: rodar a lista de MARCO neste script teria gravado as
// quantidades de marco em cima de FEVEREIRO, que ja esta fechado e conferido. Nao existe
// default seguro aqui — ou o mes vem escrito, ou o script nao roda.
const args = process.argv.slice(2);
const EXECUTAR = args.includes('--executar');
const valorDe = (nome) => {
  const achado = args.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.slice(nome.length + 3) : null;
};
const MES = Number(valorDe('mes'));
const ANO = Number(valorDe('ano'));
const posicionais = args.filter((a) => !a.startsWith('--'));
const ARQ_LANCAMENTO = posicionais[0];
const ARQ_AJUSTE = posicionais[1] || null;
const MESES_PT = ['', 'JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const ORIGEM = `IMPORT_EL_${MESES_PT[MES] || '??'}${ANO}`;

function lerTsv(arquivo) {
  const itens = fs.readFileSync(arquivo, 'utf8').trim().split('\n').map((linha) => {
    const [id, q] = linha.split('\t');
    return { idproduto: String(id || '').trim(), quantidade: Number(q) };
  });
  if (itens.some((i) => !i.idproduto || !Number.isFinite(i.quantidade) || i.quantidade < 0)) {
    throw new Error(`linha invalida em ${arquivo}`);
  }
  const ids = itens.map((i) => i.idproduto);
  if (new Set(ids).size !== ids.length) throw new Error(`idproduto duplicado em ${arquivo}`);
  return itens;
}

(async () => {
  if (!ARQ_LANCAMENTO) throw new Error('uso: node scripts/gravar-projecao-sku.js --mes=N --ano=AAAA <lancamento.tsv> [ajuste.tsv] [--executar]');
  if (!Number.isInteger(MES) || MES < 1 || MES > 12) throw new Error('informe --mes=1..12 (sem padrao: o mes errado sobrescreve um mes ja fechado)');
  if (!Number.isInteger(ANO) || ANO < 2020 || ANO > 2100) throw new Error('informe --ano=AAAA');
  console.log(`destino: mes=${MES} (${MESES_PT[MES]}) ano=${ANO}  origem=${ORIGEM}`);

  const lancamento = lerTsv(ARQ_LANCAMENTO);
  const ajuste = ARQ_AJUSTE ? lerTsv(ARQ_AJUSTE) : [];
  console.log(`lancamento: ${lancamento.length} SKUs, ${f(lancamento.reduce((s, i) => s + i.quantidade, 0))} pecas`);
  if (ARQ_AJUSTE) console.log(`ajuste:     ${ajuste.length} SKUs, ${f(ajuste.reduce((s, i) => s + i.quantidade, 0))} pecas (valor final, ja calculado)`);

  // Um SKU nos dois arquivos seria ambiguo: a lista manda, e o ajuste nunca deveria
  // tocar quem esta nela. Aborta em vez de escolher sozinho.
  const naLista = new Set(lancamento.map((i) => i.idproduto));
  const colisao = ajuste.filter((i) => naLista.has(i.idproduto));
  if (colisao.length) throw new Error(`${colisao.length} SKU(s) aparecem nos dois arquivos (ex: ${colisao.slice(0, 5).map((i) => i.idproduto).join(', ')})`);

  // 1. BACKUP de tudo que existe hoje no mes, superset do que sera tocado.
  const atual = await pool.query(
    `SELECT id, idproduto, mes, ano, quantidade, origem, updated_at
       FROM app_projecoes WHERE mes=$1 AND ano=$2 ORDER BY idproduto`, [MES, ANO]);
  const hoje = new Map(atual.rows.map((r) => [String(r.idproduto), Number(r.quantidade)]));
  // O MES entra no nome: rodando dois meses no mesmo dia, o segundo backup sobrescrevia o
  // primeiro e o estado anterior daquele mes se perdia.
  const dest = path.join('data', `backup_projecoes_antes_${MESES_PT[MES].toLowerCase()}${ANO}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`);
  fs.writeFileSync(dest, ['id;idproduto;mes;ano;quantidade;origem;updated_at']
    .concat(atual.rows.map((r) => [r.id, r.idproduto, r.mes, r.ano, r.quantidade, r.origem,
      r.updated_at ? new Date(r.updated_at).toISOString() : ''].join(';'))).join('\n'), 'utf8');
  console.log(`backup:     ${atual.rows.length} linhas em ${dest}`);

  // 2. O que muda, antes de mudar.
  const todos = [...lancamento, ...ajuste];
  const novos = todos.filter((i) => !hoje.has(i.idproduto));
  const sobrescritos = todos.filter((i) => hoje.has(i.idproduto));
  const antes = atual.rows.reduce((s, r) => s + Number(r.quantidade), 0);
  const depois = antes
    - sobrescritos.reduce((s, i) => s + hoje.get(i.idproduto), 0)
    + todos.reduce((s, i) => s + i.quantidade, 0);
  console.log('');
  console.log(`  inserir ..... ${novos.length} SKUs (${f(novos.reduce((s, i) => s + i.quantidade, 0))} pecas)`);
  console.log(`  sobrescrever  ${sobrescritos.length} SKUs (${f(sobrescritos.reduce((s, i) => s + hoje.get(i.idproduto), 0))} -> ${f(sobrescritos.reduce((s, i) => s + i.quantidade, 0))})`);
  console.log(`  total do mes em app_projecoes: ${f(antes)} -> ${f(depois)}`);

  if (!EXECUTAR) {
    console.log('\n[simulacao] nada foi gravado. rode de novo com --executar');
    await pool.end();
    return;
  }

  // 3. Tudo ou nada.
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const i of todos) {
      await c.query(
        `INSERT INTO app_projecoes (idproduto, mes, ano, quantidade, origem)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (idproduto, mes, ano)
         DO UPDATE SET quantidade = EXCLUDED.quantidade, origem = EXCLUDED.origem, updated_at = CURRENT_TIMESTAMP`,
        [i.idproduto, MES, ANO, i.quantidade, ORIGEM]);
    }
    const conf = await c.query(
      `SELECT COUNT(*)::int n, COALESCE(SUM(quantidade),0)::float s FROM app_projecoes WHERE mes=$1 AND ano=$2`, [MES, ANO]);
    if (Math.round(conf.rows[0].s) !== Math.round(depois)) {
      throw new Error(`conferencia falhou: esperado ${Math.round(depois)}, encontrado ${Math.round(conf.rows[0].s)}`);
    }
    await c.query('COMMIT');
    console.log(`\nGRAVADO. fev/2027 agora: ${conf.rows[0].n} linhas, ${f(conf.rows[0].s)} pecas`);
    console.log(`Para desfazer: data/${path.basename(dest)} tem o estado anterior.`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  await pool.end();
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
