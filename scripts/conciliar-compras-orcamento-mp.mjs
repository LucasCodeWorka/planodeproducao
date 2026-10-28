// Separa o valor exibido como "comprado" em pedidos de compra e OPs internas.
// Somente leitura. Reproduz as consultas Q3/Q4 da analise de consumo MP.
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const preparo = JSON.parse(fs.readFileSync(process.argv[2] || '.agents/totvs_agent_minimo/data/preparo-fcpfm017-2026-10-27.json', 'utf8'));
const linhas = preparo.linhas.filter((row) => row.valorComprado > 0);
const porMp = new Map(linhas.map((row) => [row.mp, row]));
const ids = [...porMp.keys()];
const pool = new pg.Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
    ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true' }
    : undefined,
});

const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const totals = {};
const pedidos = [];
const add = (key, value, count = 1) => {
  totals[key] ||= { valor: 0, quantidadeRegistros: 0 };
  totals[key].valor += value;
  totals[key].quantidadeRegistros += count;
};
const cadastro = (row) => !row.despesa ? 'sem_despesa' : !row.noPlano500Cc506 ? 'fora_plano' : 'no_plano';

try {
  const compras = (await pool.query(`
    SELECT i.cd_produto::text AS mp, c.cd_empresa, c.cd_pedido,
           COALESCE(i.dt_preventrega::date, c.dt_preventrega::date) AS data,
           SUM(COALESCE(i.qt_pendente, 0))::float AS qtd
    FROM vr_cmp_pedidoc2 c
    JOIN vr_cmp_pedidoi i ON i.cd_empresa=c.cd_empresa AND i.cd_pedido=c.cd_pedido
    WHERE c.tp_situacao=ANY(ARRAY[1::bigint,3::bigint])
      AND i.cd_produto::text=ANY($1::text[]) AND COALESCE(i.qt_pendente,0)>0
    GROUP BY i.cd_produto,c.cd_empresa,c.cd_pedido,
             COALESCE(i.dt_preventrega::date, c.dt_preventrega::date)
  `, [ids])).rows;

  const ops = (await pool.query(`
    SELECT CASE WHEN op.cd_produto=(d."para-CODIGO")::bigint
                THEN (d."de-CODIGO")::bigint::text ELSE op.cd_produto::text END AS mp,
           op.dt_preventrega::date AS data,
           SUM(COALESCE(op.qt_real,0)-COALESCE(op.qt_finalizada,0))::float AS qtd
    FROM vr_pcp_opi op
    LEFT JOIN "de-para1" d ON op.cd_produto=(d."de-CODIGO")::bigint
    WHERE op.nr_ciclo='99' AND op.tp_situacao NOT IN (40,30)
      AND COALESCE(op.qt_real,0)-COALESCE(op.qt_finalizada,0)>0
      AND (CASE WHEN op.cd_produto=(d."para-CODIGO")::bigint
                THEN (d."de-CODIGO")::bigint::text ELSE op.cd_produto::text END)=ANY($1::text[])
    GROUP BY 1,op.dt_preventrega::date
  `, [ids])).rows;

  const qtdPorMp = new Map();
  for (const [tipo, registros] of [['pedido', compras], ['op_interna', ops]]) {
    for (const item of registros) {
      const row = porMp.get(item.mp);
      if (!row) continue;
      const qtd = Number(item.qtd || 0);
      const valor = qtd * row.preco;
      const classe = cadastro(row);
      const mes = item.data ? new Date(item.data).toISOString().slice(0, 7) : 'sem_data';
      add(`${tipo}|${classe}`, valor);
      add(`${tipo}|${mes}`, valor);
      const current = qtdPorMp.get(item.mp) || 0;
      qtdPorMp.set(item.mp, current + qtd);
      if (tipo === 'pedido') pedidos.push({ mp: item.mp, empresa: item.cd_empresa,
        pedido: item.cd_pedido, data: item.data, qtd, valor: money(valor),
        despesa: row.despesa, classe });
    }
  }
  const divergencias = linhas.map((row) => ({ mp: row.mp,
    diferenca: row.valorComprado - Number(qtdPorMp.get(row.mp) || 0) * row.preco }))
    .filter((row) => Math.abs(row.diferenca) > 0.01);
  const report = { calculadoEm: new Date().toISOString(), baseEm: preparo.resumo.criadoEm,
    valorCompradoBase: preparo.resumo.valorComprado,
    totais: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, { ...v, valor: money(v.valor) }])),
    somaPedidos: money(compras.reduce((s, item) => s + Number(item.qtd || 0) * Number(porMp.get(item.mp)?.preco || 0), 0)),
    somaOps: money(ops.reduce((s, item) => s + Number(item.qtd || 0) * Number(porMp.get(item.mp)?.preco || 0), 0)),
    divergencias, pedidos: pedidos.sort((a, b) => b.valor - a.valor) };
  const path = process.argv[3] || '.agents/totvs_agent_minimo/data/conciliacao-compras-orcamento-mp-2026-10-27.json';
  fs.writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ arquivo: path, baseEm: report.baseEm,
    valorCompradoBase: report.valorCompradoBase,
    somaPedidos: report.somaPedidos, somaOps: report.somaOps,
    diferenca: money(report.valorCompradoBase - report.somaPedidos - report.somaOps),
    totais: report.totais, divergencias: divergencias.slice(0, 10),
    maioresPedidos: report.pedidos.slice(0, 15) }, null, 2));
} finally {
  await pool.end();
}
