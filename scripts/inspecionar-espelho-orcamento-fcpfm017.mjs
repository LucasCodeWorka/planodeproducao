// Inspecao somente leitura da cobertura das tabelas espelhadas do FCPFM017.
import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
    ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true' }
    : undefined,
});
try {
  const consultas = [
    ['VR_FCP_VISAOI_POR_VISAO_E_COMPETENCIA', `
      SELECT v.cd_visao, v.nr_ano, v.nr_mes,
             COUNT(*)::int AS linhas,
             COUNT(DISTINCT p.cd_despesaitem)::int AS despesas,
             SUM(v.vl_visao)::numeric(18,2) AS valor
      FROM public.vr_fcp_visaoi v
      JOIN public.vr_fcp_planoctai p ON p.nr_seqplanoctai=v.nr_seqplanoctai
      WHERE p.cd_planoctac=500 AND p.cd_ccusto=506
        AND v.nr_ano IN (2026,2027)
      GROUP BY v.cd_visao, v.nr_ano, v.nr_mes
      ORDER BY v.cd_visao, v.nr_ano, v.nr_mes
    `],
    ['ORCAMENTO_VALORES_CC506', `
      SELECT ano, mes, COUNT(*)::int AS linhas,
             SUM(valor_orcado)::numeric(18,2) AS valor
      FROM public.orcamento_valores
      WHERE cd_ccusto=506 AND ano IN (2026,2027)
      GROUP BY ano, mes ORDER BY ano, mes
    `],
  ];
  for (const [nome, sql] of consultas) {
    const { rows } = await pool.query(sql);
    console.log(nome);
    console.table(rows);
  }
} finally {
  await pool.end();
}
