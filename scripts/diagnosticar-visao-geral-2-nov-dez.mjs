import 'dotenv/config';
import pg from 'pg';
import { createRequire } from 'node:module';

const ano = Number(process.argv[2] || new Date().getFullYear());
if (!Number.isInteger(ano) || ano < 2020 || ano > 2100) throw new Error('Ano inválido');

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
    ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true' }
    : undefined,
  connectionTimeoutMillis: 15000,
});

try {
  const proj = await pool.query(`
    SELECT mes, COUNT(*)::INT AS linhas, COUNT(DISTINCT idproduto)::INT AS skus,
           SUM(quantidade)::BIGINT AS pecas,
           COUNT(*) FILTER (WHERE quantidade = 0)::INT AS zeros
    FROM public.app_projecoes
    WHERE ano = $1 AND mes IN (9, 10, 11, 12)
    GROUP BY mes ORDER BY mes
  `, [ano]);
  console.log('PROJECOES_GRAVADAS', JSON.stringify(proj.rows));

  const projDestino = await pool.query(`
    SELECT mes, COUNT(*)::INT AS skus, SUM(quantidade)::BIGINT AS pecas
    FROM public.app_projecoes
    WHERE ano = $1 + 1 AND mes IN (10, 11, 12)
    GROUP BY mes ORDER BY mes
  `, [ano]);
  console.log('PROJECOES_ANO_DESTINO', JSON.stringify(projDestino.rows));

  const cobertura = await pool.query(`
    WITH p AS (
      SELECT idproduto,
             SUM(quantidade) FILTER (WHERE mes = 11) AS nov,
             SUM(quantidade) FILTER (WHERE mes = 12) AS dez
      FROM public.app_projecoes
      WHERE ano = $1 AND mes IN (11, 12)
      GROUP BY idproduto
    )
    SELECT COUNT(*) FILTER (WHERE nov IS NOT NULL AND dez IS NOT NULL)::INT AS ambos,
           COUNT(*) FILTER (WHERE nov IS NOT NULL AND dez IS NULL)::INT AS so_nov,
           COUNT(*) FILTER (WHERE nov IS NULL AND dez IS NOT NULL)::INT AS so_dez,
           SUM(nov) FILTER (WHERE dez IS NULL)::BIGINT AS pecas_so_nov,
           SUM(nov) FILTER (WHERE dez IS NOT NULL)::BIGINT AS nov_mesmos_skus,
           SUM(dez) FILTER (WHERE nov IS NOT NULL)::BIGINT AS dez_mesmos_skus
    FROM p
  `, [ano]);
  console.log('COBERTURA_NOV_DEZ', JSON.stringify(cobertura.rows));

  const vendas = await pool.query(`
    SELECT EXTRACT(YEAR FROM v.data)::INT AS ano,
           EXTRACT(MONTH FROM v.data)::INT AS mes,
           v.idempresa,
           SUM(v.qt_liquida)::BIGINT AS pecas,
           COUNT(DISTINCT v.idproduto)::INT AS skus
    FROM public.mv_vendas_qtd v
    WHERE v.data >= make_date($1::INT - 1, 9, 1)
      AND v.data < make_date($1::INT + 1, 1, 1)
      AND EXTRACT(MONTH FROM v.data) IN (9, 10, 11, 12)
      AND EXISTS (
        SELECT 1 FROM public.app_projecoes p
        WHERE p.ano = $1 AND p.idproduto::BIGINT = v.idproduto
      )
    GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
  `, [ano]);
  const resumo = {};
  for (const row of vendas.rows) {
    const chave = `${row.ano}-${String(row.mes).padStart(2, '0')}`;
    resumo[chave] ||= { fabrica: 0, outrasEmpresas: 0 };
    resumo[chave][String(row.idempresa) === '1' ? 'fabrica' : 'outrasEmpresas'] += Number(row.pecas);
  }
  console.log('VENDAS_PRODUTOS_PROJETADOS', JSON.stringify(resumo));
  const historicoBase = [11, 12].map((mes) => {
    const r = resumo[`${ano - 1}-${String(mes).padStart(2, '0')}`] || { fabrica: 0, outrasEmpresas: 0 };
    const fab2026 = Math.round(r.fabrica * 1.1);
    const fab2027 = Math.round(fab2026 * 1.1);
    return { mes, ano2025: { fabrica: r.fabrica, lojas: r.outrasEmpresas, total: r.fabrica + r.outrasEmpresas },
      ano2026: { fabrica: fab2026, lojas: r.outrasEmpresas, total: fab2026 + r.outrasEmpresas },
      ano2027: { fabrica: fab2027, lojas: r.outrasEmpresas, total: fab2027 + r.outrasEmpresas } };
  });
  console.log('CADEIA_2025_2027_REGRA_ATUAL', JSON.stringify(historicoBase));

  const mesesFechados = await pool.query(`
    SELECT SUM(CASE WHEN v.idempresa = 1 THEN v.qt_liquida ELSE 0 END)::BIGINT AS fabrica,
           SUM(CASE WHEN v.idempresa <> 1 THEN v.qt_liquida ELSE 0 END)::BIGINT AS lojas
    FROM public.mv_vendas_qtd v
    WHERE v.data >= make_date($1::INT, 1, 1)
      AND v.data < make_date($1::INT, 10, 1)
      AND EXISTS (
        SELECT 1 FROM public.app_projecoes p
        WHERE p.ano = $1 AND p.idproduto::BIGINT = v.idproduto
      )
  `, [ano]);
  const fechado = mesesFechados.rows[0];
  const participacao = Number(fechado.fabrica) / (Number(fechado.fabrica) + Number(fechado.lojas));
  console.log('PARTICIPACAO_FECHADOS_MODELO_ATUAL', JSON.stringify({ ...fechado, participacaoFabrica: participacao }));
  console.log('PROJECAO_2027_MODELO_ATUAL', JSON.stringify(proj.rows.filter((r) => [11, 12].includes(r.mes)).map((r) => {
    const fabricaBase = Math.round(Number(r.pecas) * participacao);
    return { mes: r.mes, fabrica: Math.round(fabricaBase * 1.1), lojas: Number(r.pecas) - fabricaBase,
      total: Math.round(fabricaBase * 1.1) + Number(r.pecas) - fabricaBase };
  })));
  console.log('IDS_OUTRAS_EMPRESAS', JSON.stringify([...new Set(vendas.rows.map((row) => String(row.idempresa)))].filter((id) => id !== '1')));

  const tabelasEmpresa = await pool.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema IN ('public', 'syscorp')
      AND (table_name ILIKE '%empresa%' OR table_name ILIKE '%filial%')
    ORDER BY table_schema, table_name
  `);
  console.log('TABELAS_EMPRESA', JSON.stringify(tabelasEmpresa.rows));

  const colunasProjecao = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'app_projecoes'
    ORDER BY ordinal_position
  `);
  console.log('COLUNAS_APP_PROJECOES', JSON.stringify(colunasProjecao.rows));

  const colunasEmpresa = await pool.query(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('dEMPRESA', 'dempresa_ativa')
    ORDER BY table_name, ordinal_position
  `);
  console.log('COLUNAS_EMPRESA', JSON.stringify(colunasEmpresa.rows));

  const empresas = await pool.query(`
    SELECT idempresa, empresa, suplojas, area, cidade
    FROM public."dEMPRESA"
    WHERE idempresa = ANY($1::BIGINT[])
    ORDER BY idempresa
  `, [[1, 2, 3, 4, 5, 6, 7, 8, 10, 14, 15, 17, 19, 20, 21, 22]]);
  console.log('EMPRESAS_CLASSIFICADAS', JSON.stringify(empresas.rows));

  const origens = await pool.query(`
    SELECT mes, COALESCE(origem, '<vazio>') AS origem,
           COUNT(*)::INT AS skus, SUM(quantidade)::BIGINT AS pecas,
           MIN(created_at) AS primeiro_cadastro,
           MAX(updated_at) AS ultima_atualizacao
    FROM public.app_projecoes
    WHERE ano = $1 AND mes IN (11, 12)
    GROUP BY mes, origem ORDER BY mes, origem
  `, [ano]);
  console.log('ORIGEM_PROJECOES', JSON.stringify(origens.rows));

  if (process.argv.includes('--preview')) {
    const require = createRequire(import.meta.url);
    const service = require('../src/services/projecaoPermanentesService.js');
    const preview = await service.gerarPreviewProjecoes(pool, ano, ano + 1, { completarMesesAbertos: true });
    const ids = preview.itens.map((item) => String(item.idproduto));
    const projTabela = await pool.query(`
      SELECT mes, COUNT(*)::INT AS skus, SUM(quantidade)::BIGINT AS pecas
      FROM public.app_projecoes
      WHERE ano = $1 AND mes IN (9, 10, 11, 12) AND idproduto = ANY($2::TEXT[])
      GROUP BY mes ORDER BY mes
    `, [ano, ids]);
    console.log('SKUS_TABELA', ids.length);
    console.log('PROJECAO_TABELA', JSON.stringify(projTabela.rows));
    console.log('SETEMBRO_REAL_TABELA', JSON.stringify(preview.totalizadores?.[9]));
    console.log('OUTUBRO_REAL_PARCIAL_TABELA', JSON.stringify(preview.totalizadores?.[10]));
    console.log('NOVEMBRO_REAL_TABELA', JSON.stringify(preview.totalizadores?.[11]));
    console.log('DEZEMBRO_REAL_TABELA', JSON.stringify(preview.totalizadores?.[12]));
    console.log('MODELO_DESTINO_TABELA', JSON.stringify({ out: preview.resumo?.totalPorMes?.out, nov: preview.resumo?.totalPorMes?.nov, dez: preview.resumo?.totalPorMes?.dez }));

    const historicoTabela = await pool.query(`
      SELECT EXTRACT(MONTH FROM v.data)::INT AS mes,
             SUM(CASE WHEN v.idempresa = 1 THEN v.qt_liquida ELSE 0 END)::BIGINT AS fabrica,
             SUM(CASE WHEN v.idempresa <> 1 THEN v.qt_liquida ELSE 0 END)::BIGINT AS lojas
      FROM public.mv_vendas_qtd v
      WHERE v.data >= make_date($1::INT - 1, 10, 1)
        AND v.data < make_date($1::INT, 1, 1)
        AND v.idproduto = ANY($2::BIGINT[])
      GROUP BY 1 ORDER BY 1
    `, [ano, ids.map(Number)]);
    console.log('HISTORICO_2025_SKUS_TABELA', JSON.stringify(historicoTabela.rows));
    console.log('HISTORICO_PREVIEW_TABELA', JSON.stringify(Object.fromEntries([10, 11, 12].map((mes) => [mes, {
      fabrica: preview.vendasItensPorAno?.[String(ano - 1)]?.fabrica?.[mes] || 0,
      lojas: preview.vendasItensPorAno?.[String(ano - 1)]?.lojas?.[mes] || 0,
    }]))));
    console.log('REAL_PREVIEW_TABELA', JSON.stringify(Object.fromEntries([9, 10].map((mes) => [mes, {
      fabrica: preview.vendasItensPorAno?.[String(ano)]?.fabrica?.[mes] || 0,
      lojas: preview.vendasItensPorAno?.[String(ano)]?.lojas?.[mes] || 0,
    }]))));
    console.log('CADEIA_2025_2027_SKUS_TABELA', JSON.stringify(historicoTabela.rows.map((row) => {
      const fab2026 = Math.round(Number(row.fabrica) * 1.1);
      const fab2027 = Math.round(fab2026 * 1.1);
      return { mes: row.mes, ano2025: { fabrica: Number(row.fabrica), lojas: Number(row.lojas) },
        ano2026: { fabrica: fab2026, lojas: Number(row.lojas) },
        ano2027: { fabrica: fab2027, lojas: Number(row.lojas) } };
    })));
  }
} finally {
  await pool.end();
}
