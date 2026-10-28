// Leitura das possiveis despesas TOTVS para MPs com valor sem ponte local.
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const input = process.argv[2] || '.agents/totvs_agent_minimo/data/preparo-fcpfm017-2026-10-27-apos-sync.json';
const output = process.argv[3] || '.agents/totvs_agent_minimo/data/mapeamento-compras-orcamento-mp-2026-10-27.json';
const prep = JSON.parse(fs.readFileSync(input, 'utf8'));
const missing = prep.linhas.filter((row) => !row.despesa && row.valorOrcamento > 0);
const ids = missing.map((row) => Number(row.mp));
const pool = new pg.Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
    ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true' }
    : undefined,
});
const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const norm = (value) => String(value || '').toUpperCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim()
  .replace(/ U$/, '');
try {
  const [productExpense, orderExpense, expenseNames, planItems, siblings, grade] = await Promise.all([
    pool.query(`SELECT cd_produto::text AS mp, cd_despesaitem::int AS despesa,
                       cd_ccusto::int AS cc, cd_empresa::int AS empresa
                FROM vr_prd_prddesp WHERE cd_produto=ANY($1::bigint[])`, [ids]),
    pool.query(`SELECT DISTINCT i.cd_produto::text AS mp, i.cd_pedido::text AS pedido,
                       i.cd_empresa::int AS empresa,
                       d.cd_despesaitem::int AS despesa_item, d.cd_ccusto::int AS cc_item,
                       c.cd_despesaitem::int AS despesa_capa, c.cd_ccusto::int AS cc_capa
                FROM vr_cmp_pedidoi i
                LEFT JOIN vr_cmp_pedidoidesp d ON d.cd_empresa=i.cd_empresa
                  AND d.cd_pedido=i.cd_pedido AND d.cd_produto=i.cd_produto
                LEFT JOIN vr_cmp_pedidocdesp c ON c.cd_empresa=i.cd_empresa
                  AND c.cd_pedido=i.cd_pedido
                WHERE i.cd_produto=ANY($1::bigint[])
                  AND COALESCE(i.qt_pendente,0)>0`, [ids]),
    pool.query('SELECT cd_despesaitem::int AS despesa, ds_despesaitem AS nome, ds_original FROM vr_fcp_despesaitem'),
    pool.query(`SELECT DISTINCT cd_despesaitem::int AS despesa FROM vr_fcp_planoctai
                WHERE cd_planoctac=500 AND cd_ccusto=506 AND cd_despesaitem IS NOT NULL`),
    pool.query(`SELECT seqgrupo::text AS grupo, TRIM(cor) AS cor, iddespesa::int AS despesa,
                       desc_mp AS nome, status
                FROM app_mp_despesa WHERE seqgrupo::text=ANY($1::text[]) AND iddespesa IS NOT NULL`,
      [[...new Set(missing.map((row) => row.grupo).filter(Boolean))]]),
    pool.query(`SELECT cd_produto::text AS mp, nm_produto AS nome, ds_cor AS cor
                FROM vr_prd_prdgrade WHERE cd_produto=ANY($1::bigint[])`, [ids]),
  ]);
  const names = new Map(expenseNames.rows.map((row) => [row.despesa, row.nome]));
  const exactByName = new Map();
  for (const item of expenseNames.rows) {
    for (const name of [item.nome, item.ds_original]) {
      const key = norm(name);
      if (!key) continue;
      if (!exactByName.has(key)) exactByName.set(key, new Set());
      exactByName.get(key).add(item.despesa);
    }
  }
  const gradeByMp = new Map(grade.rows.map((row) => [row.mp, row]));
  const inPlan = new Set(planItems.rows.map((row) => row.despesa));
  const byMp = (rows) => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.mp)) map.set(row.mp, []);
      map.get(row.mp).push(row);
    }
    return map;
  };
  const productsByMp = byMp(productExpense.rows);
  const ordersByMp = byMp(orderExpense.rows);
  const siblingsByGroup = new Map();
  for (const row of siblings.rows) {
    if (!siblingsByGroup.has(row.grupo)) siblingsByGroup.set(row.grupo, []);
    siblingsByGroup.get(row.grupo).push(row);
  }
  const findings = missing.map((row) => {
    const gradeItem = gradeByMp.get(row.mp);
    const products = productsByMp.get(row.mp) || [];
    const orders = ordersByMp.get(row.mp) || [];
    const candidates = new Map();
    const add = (expense, cc, source) => {
      if (!Number.isInteger(expense) || expense <= 0) return;
      const key = `${expense}|${cc || 0}`;
      if (!candidates.has(key)) candidates.set(key, { despesa: expense, cc,
        nome: names.get(expense) || null, noPlano500Cc506: inPlan.has(expense), fontes: [] });
      candidates.get(key).fontes.push(source);
    };
    for (const item of products) add(item.despesa, item.cc, 'produto');
    for (const item of orders) {
      add(item.despesa_item, item.cc_item, `pedido_item_${item.pedido}`);
      add(item.despesa_capa, item.cc_capa, `pedido_capa_${item.pedido}`);
    }
    const own = [...candidates.values()].sort((a, b) => b.fontes.length - a.fontes.length);
    const exact = [...(exactByName.get(norm(gradeItem?.nome)) || [])];
    return { mp: row.mp, descricao: row.descricao, nomeProduto: gradeItem?.nome || null,
      grupo: row.grupo, cor: row.cor,
      comprado: money(row.valorComprado), futuro: money(row.valorFuturo),
      despesasNomeExato: exact.map((expense) => ({ despesa: expense, nome: names.get(expense),
        noPlano500Cc506: inPlan.has(expense) })),
      candidatosProprios: own,
      despesasIrmas: [...new Set((siblingsByGroup.get(row.grupo) || []).map((item) => item.despesa))]
        .map((expense) => ({ despesa: expense, nome: names.get(expense) || null,
          noPlano500Cc506: inPlan.has(expense) })),
      pedidos: orders.length };
  }).sort((a, b) => b.comprado + b.futuro - a.comprado - a.futuro);
  const byKind = {
    unicoProprioNoPlano: findings.filter((row) => row.candidatosProprios.length === 1 && row.candidatosProprios[0].noPlano500Cc506),
    unicoProprioForaPlano: findings.filter((row) => row.candidatosProprios.length === 1 && !row.candidatosProprios[0].noPlano500Cc506),
    multiplosProprios: findings.filter((row) => row.candidatosProprios.length > 1),
    semProprio: findings.filter((row) => row.candidatosProprios.length === 0),
  };
  const summary = Object.fromEntries(Object.entries(byKind).map(([key, rows]) =>
    [key, { mps: rows.length, comprado: money(rows.reduce((sum, row) => sum + row.comprado, 0)),
      futuro: money(rows.reduce((sum, row) => sum + row.futuro, 0)) }]));
  summary.nomeExatoUnico = { mps: findings.filter((row) => row.despesasNomeExato.length === 1).length,
    comprado: money(findings.filter((row) => row.despesasNomeExato.length === 1)
      .reduce((sum, row) => sum + row.comprado, 0)) };
  summary.nomeExatoMultiplo = { mps: findings.filter((row) => row.despesasNomeExato.length > 1).length };
  summary.semNomeExato = { mps: findings.filter((row) => row.despesasNomeExato.length === 0).length };
  fs.writeFileSync(output, JSON.stringify({ baseEm: prep.resumo.criadoEm, summary, findings }, null, 2) + '\n');
  console.log(JSON.stringify({ output, summary,
    top: findings.slice(0, 15).map((row) => ({ mp: row.mp, nomeProduto: row.nomeProduto,
      comprado: row.comprado, futuro: row.futuro, despesasNomeExato: row.despesasNomeExato })) }, null, 2));
} finally {
  await pool.end();
}
