// Consultas independentes, sem escrita, para conferência do orçamento.
import 'dotenv/config';
import pg from 'pg';
const pool = new pg.Pool({host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: process.env.DB_USER, password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''), ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' ? {rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true'} : undefined, options: '-c default_transaction_read_only=on -c statement_timeout=90000'});
try {
  const queries = {
    plano: `SELECT upper(trim(p.cd_auxiliar)) periodo, COUNT(DISTINCT a.cd_produto)::int skus, SUM(greatest(coalesce(a.qt_lote,0)-coalesce(a.qt_gerouop,0),0))::numeric restante, SUM(coalesce(a.qt_lote,0))::numeric original FROM vr_pcp_lotepl2 a JOIN pcp_lotepv p ON p.nr_lote=a.nr_lote WHERE p.tp_situacao=1 AND upper(trim(p.cd_auxiliar))=ANY(ARRAY['MA','PX','UL','QT','QU','SX','ST','OT','NV','DZ','ON','DO','DT','QZ']) GROUP BY 1`,
    totvs: `SELECT v.nr_ano ano, v.nr_mes mes, count(*)::int linhas, count(distinct p.cd_despesaitem)::int despesas, round(sum(v.vl_visao)::numeric,2) valor FROM vr_fcp_visaoi v JOIN vr_fcp_planoctai p ON p.nr_seqplanoctai=v.nr_seqplanoctai WHERE v.cd_visao=1 AND p.cd_planoctac=500 AND p.cd_ccusto=506 AND v.nr_ano IN (2026,2027) GROUP BY 1,2 ORDER BY 1,2`,
    cache: `SELECT updated_at, payload->>'createdAt' criado_em, jsonb_array_length(coalesce(payload->'rowsBase','[]'::jsonb)) mps, (SELECT count(*) FROM jsonb_object_keys(coalesce(payload->'priceOptionsByMp','{}'::jsonb))) precos FROM app_orcamento_mp_cache WHERE cache_key='orcamento_mp_liebe'`,
    cache_matriz: `SELECT key, to_timestamp(timestamp/1000.0) atualizado_em FROM app_cache WHERE key='matriz_planejamento'`
  };
  for (const [nome, sql] of Object.entries(queries)) {
    try { console.log(JSON.stringify({nome, rows:(await pool.query(sql)).rows})); }
    catch (e) { console.log(JSON.stringify({nome, erro:e.message})); }
  }
} finally { await pool.end(); }
