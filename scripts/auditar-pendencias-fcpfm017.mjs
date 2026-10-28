import 'dotenv/config';
import pg from 'pg';

const ids = [1004031, 1011461, 1011955, 1012650, 1013020, 1014576,
  1014698, 1014970, 1015809, 1015810, 1016252, 5000110, 5000126,
  5000127, 5000138, 5000140, 5000141, 5000681, 5002671, 1011733, 1015290];
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

function norm(value) {
  return String(value || '').toUpperCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim()
    .replace(/ U$/, '');
}

try {
  const grade = (await pool.query(`
    SELECT cd_produto::int AS id, cd_seqgrupo::int AS grupo, cd_cor AS cor,
           nm_produto AS nome, ds_cor
      FROM public.vr_prd_prdgrade
     WHERE cd_produto = ANY($1::bigint[])
     ORDER BY cd_produto`, [ids])).rows;
  const despesas = (await pool.query(`
    SELECT cd_despesaitem::int AS id, ds_despesaitem AS nome,
           ds_original, in_bloqueada
      FROM public.vr_fcp_despesaitem
     ORDER BY cd_despesaitem`)).rows;
  const vinculos = (await pool.query(`
    SELECT cd_produto::int AS id, cd_despesaitem::int AS despesa,
           cd_ccusto::int AS ccusto, cd_empresa::int AS empresa
      FROM public.vr_prd_prddesp
     WHERE cd_produto = ANY($1::bigint[])
     ORDER BY cd_produto, cd_ccusto, cd_despesaitem`, [ids])).rows;
  const local = (await pool.query(`
    SELECT seqgrupo::int AS grupo, cor, iddespesa::int AS despesa,
           desc_mp AS nome, status
      FROM public.app_mp_despesa
     WHERE seqgrupo::bigint IN (SELECT DISTINCT cd_seqgrupo FROM public.vr_prd_prdgrade
                         WHERE cd_produto = ANY($1::bigint[]))
     ORDER BY seqgrupo, cor`, [ids])).rows;
  const pedidos = (await pool.query(`
    SELECT i.cd_produto::int AS id, i.cd_pedido::int AS pedido,
           i.cd_empresa::int AS empresa, i.qt_pendente, i.vl_pendente,
           i.vl_unitario, i.dt_preventrega,
           d.cd_despesaitem::int AS despesa_item, d.cd_ccusto::int AS cc_item,
           c.cd_despesaitem::int AS despesa_capa, c.cd_ccusto::int AS cc_capa
      FROM public.vr_cmp_pedidoi i
      LEFT JOIN public.vr_cmp_pedidoidesp d
        ON d.cd_empresa=i.cd_empresa AND d.cd_pedido=i.cd_pedido AND d.cd_produto=i.cd_produto
      LEFT JOIN public.vr_cmp_pedidocdesp c
        ON c.cd_empresa=i.cd_empresa AND c.cd_pedido=i.cd_pedido
     WHERE i.cd_produto = ANY($1::bigint[])
       AND i.dt_inclusao >= DATE '2025-01-01'
     ORDER BY i.cd_produto, i.dt_inclusao DESC
     LIMIT 200`, [ids])).rows;

  for (const id of ids) {
    const g = grade.find((row) => row.id === id);
    const n = norm(g?.nome);
    const exact = despesas.filter((row) => norm(row.nome) === n || norm(row.ds_original) === n);
    const prefix = n.split(' ').slice(0, 3).join(' ');
    const similar = exact.length ? [] : despesas.filter((row) =>
      norm(row.nome).startsWith(prefix) || norm(row.ds_original).startsWith(prefix)).slice(0, 8);
    const own = local.find((row) => row.grupo === g?.grupo && row.cor.trim() === g?.cor?.trim());
    const sibling = local.filter((row) => row.grupo === g?.grupo && row.cor.trim() !== g?.cor?.trim()).slice(0, 5);
    const po = pedidos.filter((row) => row.id === id);
    console.log(JSON.stringify({ id, grupo: g?.grupo, cor: g?.cor, nome: g?.nome,
      own, exact, similar, sibling, vinculos: vinculos.filter((row) => row.id === id),
      pedidos: po.slice(0, 6), totalPedidos: po.length }));
  }
} finally {
  await pool.end();
}
