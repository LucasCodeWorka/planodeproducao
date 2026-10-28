// Auditoria somente leitura para preparar valores do FCPFM017.
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

const pendentes = [1004031, 1011461, 1011955, 1012650, 1013020, 1014576,
  1014698, 1014970, 1015809, 1015810, 1016252, 5000110, 5000126,
  5000127, 5000138, 5000140, 5000141, 5000681, 5002671, 1011733, 1015290];

async function mostrar(nome, sql, params = []) {
  try {
    const { rows } = await pool.query(sql, params);
    console.log(`\n${nome}`);
    console.table(rows);
  } catch (error) {
    console.log(`\n${nome}: ERRO ${error.message}`);
  }
}

try {
  await mostrar('CACHE_MATRIZ', `
    SELECT key, to_timestamp(timestamp / 1000.0) AS atualizado_em,
           length(data) AS bytes,
           data::jsonb->'meta'->>'marca' AS marca,
           data::jsonb->'meta'->>'status' AS status,
           data::jsonb->'count' AS quantidade
    FROM public.app_cache
    WHERE key LIKE 'matriz%'
    ORDER BY timestamp DESC LIMIT 10
  `);
  await mostrar('CACHE_ORCAMENTO', `
    SELECT updated_at, payload->>'createdAt' AS criado_em,
           jsonb_array_length(COALESCE(payload->'rowsBase', '[]'::jsonb)) AS linhas,
           (SELECT COUNT(*) FROM jsonb_object_keys(
             COALESCE(payload->'priceOptionsByMp', '{}'::jsonb))) AS mps_com_preco
    FROM public.app_orcamento_mp_cache
    WHERE cache_key='orcamento_mp_liebe'
  `);
  await mostrar('FILA_DESPESAS', `
    SELECT COUNT(*)::int AS linhas, COUNT(DISTINCT idmateriaprima)::int AS mps,
           SUM(valor_orcamento)::numeric(18,2) AS valor, MAX(preparado_em) AS ultima_preparacao
    FROM public.app_orcamento_mp_despesas_totvs
  `);
  await mostrar('COLUNAS_EXPORTACAO_MP', `
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='app_orcamento_mp_exportacao'
    ORDER BY ordinal_position
  `);
  await mostrar('COLUNAS_CADASTRO_MP', `
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='app_mp_cadastro'
    ORDER BY ordinal_position
  `);
  await mostrar('ORCAMENTO_ESPELHO', `
    SELECT ano, cd_ccusto, COUNT(*)::int AS linhas,
           SUM(valor_orcado)::numeric(18,2) AS valor
    FROM public.orcamento_valores
    WHERE ano IN (2026, 2027)
    GROUP BY ano, cd_ccusto ORDER BY ano, cd_ccusto
  `);
  await mostrar('COLUNAS_PLANO', `
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vr_fcp_planoctai'
    ORDER BY ordinal_position
  `);
  await mostrar('PLANO_500_CC506', `
    SELECT COUNT(*)::int AS linhas,
           COUNT(DISTINCT cd_despesaitem)::int AS despesas_distintas
    FROM public.vr_fcp_planoctai
    WHERE cd_planoctac=500 AND cd_ccusto=506
  `);
  await mostrar('DESPESAS_DUPLICADAS_NO_PLANO', `
    SELECT cd_despesaitem::int AS despesa, COUNT(*)::int AS linhas,
           array_agg(nr_seqplanoctai ORDER BY nr_seqplanoctai) AS sequencias
    FROM public.vr_fcp_planoctai
    WHERE cd_planoctac=500 AND cd_ccusto=506 AND cd_despesaitem IS NOT NULL
    GROUP BY cd_despesaitem HAVING COUNT(*)>1
    ORDER BY cd_despesaitem
  `);
  await mostrar('PENDENCIAS_ANTERIORES_AGORA', `
    SELECT g.cd_produto::int AS mp, g.cd_seqgrupo::int AS grupo,
           TRIM(g.cd_cor) AS cor, d.iddespesa::int AS despesa, d.status,
           f.ds_despesaitem AS descricao_despesa
    FROM public.vr_prd_prdgrade g
    LEFT JOIN public.app_mp_despesa d
      ON d.seqgrupo::text=g.cd_seqgrupo::text AND TRIM(d.cor)=TRIM(g.cd_cor)
    LEFT JOIN public.vr_fcp_despesaitem f ON f.cd_despesaitem=d.iddespesa
    WHERE g.cd_produto=ANY($1::bigint[])
    ORDER BY g.cd_produto
  `, [pendentes]);
} finally {
  await pool.end();
}
