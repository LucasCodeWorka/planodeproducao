// Consulta somente leitura: item genérico de despesa 3 e centros usados no histórico.
import 'dotenv/config';
import pg from 'pg';

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

try {
  const { rows: despesa } = await pool.query(`
    SELECT cd_despesaitem::int AS codigo, ds_despesaitem AS descricao,
           in_bloqueada AS bloqueada
      FROM public.vr_fcp_despesaitem
     WHERE cd_despesaitem=3`);
  console.log('DESPESA_3');
  console.table(despesa);

  const { rows: plano } = await pool.query(`
    SELECT cd_planoctac::int AS plano, nr_seqplanoctai::int AS sequencia,
           ds_planoctai AS descricao, cd_ccusto::int AS centro_custo,
           nr_seqplanopai::int AS pai
      FROM public.vr_fcp_planoctai
     WHERE cd_despesaitem=3 AND cd_ccusto=ANY($1::int[])
     ORDER BY cd_planoctac, cd_ccusto, nr_seqplanoctai`, [[501, 510]]);
  console.log('VINCULOS_DESPESA_3_NOS_CENTROS_501_510');
  console.table(plano);

  const { rows: tabelas } = await pool.query(`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_name ILIKE '%ccusto%'
     ORDER BY table_name`);
  console.log('TABELAS_CENTRO_CUSTO');
  console.table(tabelas);
  const { rows: colunas } = await pool.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='vr_gec_ccusto'
     ORDER BY ordinal_position`);
  console.log('COLUNAS_CENTRO_CUSTO');
  console.table(colunas);
  const { rows: centros } = await pool.query(`
    SELECT cd_ccusto::int AS codigo, ds_ccusto AS descricao,
           in_inativo AS inativo
      FROM public.vr_gec_ccusto
     WHERE cd_ccusto=ANY($1::int[])
     ORDER BY cd_ccusto`, [[501, 506, 510]]);
  console.log('CENTROS_RELEVANTES');
  console.table(centros);
} finally {
  await pool.end();
}
