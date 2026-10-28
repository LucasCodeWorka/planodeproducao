// Auditoria somente leitura das duas despesas duplicadas no plano 500/CC 506.
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
  const { rows: itens } = await pool.query(`
    SELECT p.nr_seqplanoctai::int AS sequencia,
           p.cd_despesaitem::int AS despesa,
           p.ds_planoctai AS descricao_plano,
           p.nr_seqplanopai::int AS pai,
           pai.ds_planoctai AS descricao_pai,
           p.cd_ccusto::int AS centro_custo,
           p.nr_ordem,
           p.dt_cadastro,
           p.cd_operador,
           p.in_expande,
           p.cd_tipoclass,
           p.cd_class,
           p.cd_tipoclasun,
           p.cd_clasun
      FROM public.vr_fcp_planoctai p
      LEFT JOIN public.vr_fcp_planoctai pai ON pai.nr_seqplanoctai=p.nr_seqplanopai
     WHERE p.cd_planoctac=500 AND p.cd_ccusto=506
       AND p.cd_despesaitem=ANY($1::int[])
     ORDER BY p.cd_despesaitem, p.nr_seqplanoctai`, [[11103, 11399]]);
  console.log('ITENS_DUPLICADOS');
  console.table(itens);

  const { rows: orcamento } = await pool.query(`
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='orcamento_valores'
     ORDER BY ordinal_position`);
  console.log('COLUNAS_ORCAMENTO_VALORES');
  console.table(orcamento);

  const { rows: outras } = await pool.query(`
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema='public'
       AND (table_name ILIKE '%fcp%orc%' OR table_name ILIKE '%orc%valor%')
     ORDER BY table_name`);
  console.log('TABELAS_CANDIDATAS');
  console.table(outras);

  const { rows: referencias } = await pool.query(`
    SELECT table_name, column_name, data_type
      FROM information_schema.columns
     WHERE table_schema='public'
       AND (column_name ILIKE '%seqplanoctai%' OR column_name ILIKE '%seqplanocta%')
     ORDER BY table_name, column_name`);
  console.log('COLUNAS_QUE_REFERENCIAM_SEQUENCIA');
  console.table(referencias);

  const { rows: valores } = await pool.query(`
    SELECT cd_despesaitem::int AS despesa, cd_ccusto::int AS centro_custo,
           ano::int, mes::int, valor_orcado, dt_alteracao
      FROM public.orcamento_valores
     WHERE cd_despesaitem=ANY($1::int[]) AND ano IN (2026, 2027)
     ORDER BY cd_despesaitem, ano, mes`, [[11103, 11399]]);
  console.log('VALORES_NO_ESPELHO');
  console.table(valores);

  for (const tabela of ['vr_fcp_planocta', 'vr_fcp_visaoi']) {
    const { rows: colunas } = await pool.query(`
      SELECT column_name, data_type
        FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1
       ORDER BY ordinal_position`, [tabela]);
    console.log(`COLUNAS_${tabela.toUpperCase()}`);
    console.table(colunas);
    const { rows: usos } = await pool.query(`
      SELECT nr_seqplanoctai::int AS sequencia, COUNT(*)::int AS referencias
        FROM public.${tabela}
       WHERE nr_seqplanoctai=ANY($1::bigint[])
       GROUP BY nr_seqplanoctai ORDER BY nr_seqplanoctai`,
      [[26306, 26308, 26312, 26314]]);
    console.log(`USOS_${tabela.toUpperCase()}`);
    console.table(usos);
  }
} finally {
  await pool.end();
}
