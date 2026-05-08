const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const util = require('util');
const projecoesService = require('../services/projecoesService');

const router = express.Router();
const execFileAsync = util.promisify(execFile);

const ROOT_DIR = path.join(__dirname, '../../');
const ML_DIR = path.join(ROOT_DIR, 'ml');
const MODELS_DIR = path.join(ML_DIR, 'models');
const OUTPUT_DIR = path.join(ML_DIR, 'output');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PROJECOES_FILE = path.join(DATA_DIR, 'projecoes.json');

// Flag para usar banco de dados
const USAR_BANCO = true;
const BACKTEST_FILE = path.join(OUTPUT_DIR, 'backtest_jan_abr_2026.json');
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';
const ML_RUNS_TABLE = 'app_ml_runs';
const ML_FORECASTS_TABLE = 'app_ml_forecasts';
const MONITOR_START_DATE = '2026-04-01';
const MONITOR_END_DATE = '2026-12-31';

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  const expected = (process.env.ADMIN_PASSWORD || '').trim();
  if (!expected) return res.status(500).json({ success: false, error: 'ADMIN_PASSWORD nao configurado' });
  if (token !== expected) return res.status(401).json({ success: false, error: 'Nao autorizado' });
  return next();
}

function readJsonIfExists(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function readForecastCsv(filePath) {
  if (!fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) return [];

  const header = lines[0].split(',').map((col) => col.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',').map((col) => col.trim());
    const item = {};
    header.forEach((key, index) => {
      item[key] = cols[index] ?? '';
    });
    rows.push({
      idproduto: String(item.idproduto || ''),
      referencia: String(item.referencia || ''),
      curva_abc: String(item.curva_abc || ''),
      linha: '',
      familia: '',
      continuidade: '',
      ano: Number(item.ano || 0),
      mes: Number(item.mes || 0),
      qtd: Number(item.qtd || 0),
    });
  }

  return rows;
}

async function ensureMlTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${ML_RUNS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'python_artifacts',
      status TEXT NOT NULL DEFAULT 'completed',
      model_version TEXT NULL,
      forecast_year INT NULL,
      forecast_months TEXT NULL,
      metrics TEXT NOT NULL DEFAULT '{}',
      summary TEXT NOT NULL DEFAULT '{}',
      created_at BIGINT NOT NULL,
      finished_at BIGINT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${ML_FORECASTS_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      run_id BIGINT NOT NULL REFERENCES ${ML_RUNS_TABLE}(id) ON DELETE CASCADE,
      idproduto TEXT NOT NULL,
      referencia TEXT NULL,
      curva_abc TEXT NULL,
      ano INT NOT NULL,
      mes INT NOT NULL,
      qtd FLOAT NOT NULL DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_${ML_FORECASTS_TABLE}_run_id
    ON ${ML_FORECASTS_TABLE}(run_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_${ML_FORECASTS_TABLE}_produto_mes
    ON ${ML_FORECASTS_TABLE}(idproduto, ano, mes)
  `);
}

function summarizeForecastRows(forecastRows) {
  const monthMap = new Map();
  const curveMap = new Map();
  const skuSet = new Set();

  for (const row of forecastRows) {
    skuSet.add(row.idproduto);

    const monthKey = String(row.mes || '');
    if (!monthMap.has(monthKey)) monthMap.set(monthKey, { mes: row.mes, qtd_total: 0, skus: new Set() });
    const monthItem = monthMap.get(monthKey);
    monthItem.qtd_total += Number(row.qtd || 0);
    monthItem.skus.add(row.idproduto);

    const curveKey = String(row.curva_abc || 'SEM_CURVA');
    if (!curveMap.has(curveKey)) curveMap.set(curveKey, { curva_abc: curveKey, qtd_total: 0, skus: new Set() });
    const curveItem = curveMap.get(curveKey);
    curveItem.qtd_total += Number(row.qtd || 0);
    curveItem.skus.add(row.idproduto);
  }

  return {
    summary: {
      forecast_rows: forecastRows.length,
      sku_count: skuSet.size,
      total_qtd: Math.round(forecastRows.reduce((acc, row) => acc + Number(row.qtd || 0), 0)),
    },
    totalsByMonth: Array.from(monthMap.values())
      .map((item) => ({
        mes: item.mes,
        qtd_total: Math.round(item.qtd_total),
        skus: item.skus.size,
      }))
      .sort((a, b) => a.mes - b.mes),
    totalsByCurve: Array.from(curveMap.values())
      .map((item) => ({
        curva_abc: item.curva_abc,
        qtd_total: Math.round(item.qtd_total),
        skus: item.skus.size,
      }))
      .sort((a, b) => a.curva_abc.localeCompare(b.curva_abc, 'pt-BR')),
  };
}

async function buildDiagnostics(pool, forecastRows) {
  const historyResult = await pool.query(`
    WITH valid_products AS (
      SELECT
        p.cd_produto::BIGINT AS idproduto,
        COALESCE(f_dic_prd_nivel(p.cd_produto, 'CD'::bpchar), '') AS referencia,
        COALESCE(f_dic_prd_nivel(p.cd_produto, 'DS'::bpchar), p.nm_produto, '') AS produto,
        COALESCE(p.nm_produto, '') AS apresentacao,
        COALESCE(p.ds_tamanho, '') AS tamanho,
        COALESCE(f_dic_prd_classificacao(p.cd_produto, 'DS'::text, 20::bigint), '') AS marca,
        COALESCE(f_dic_prd_classificacao(p.cd_produto, 'DS'::text, 27::bigint), '') AS status,
        COALESCE(f_dic_prd_classificacao(p.cd_produto, 'DS'::text, 802::bigint), '') AS continuidade,
        COALESCE(f_dic_prd_classificacao(p.cd_produto, 'CD'::text, 124::bigint), '') AS cod_situacao
      FROM vr_prd_prdgrade p
      WHERE p.cd_produto < 1000000
    )
    SELECT
      EXTRACT(YEAR FROM v.data)::INT AS ano,
      EXTRACT(MONTH FROM v.data)::INT AS mes,
      TO_CHAR(date_trunc('month', v.data), 'YYYY-MM') AS ano_mes,
      SUM(CASE WHEN v.idempresa = 1 THEN v.qt_liquida ELSE 0 END)::FLOAT AS empresa_1_qtd,
      SUM(CASE WHEN v.idempresa <> 1 THEN v.qt_liquida ELSE 0 END)::FLOAT AS outras_empresas_qtd
    FROM vr_vendas_qtd v
    JOIN valid_products p ON p.idproduto = v.idproduto
    WHERE v.data >= date_trunc('month', CURRENT_DATE) - INTERVAL '36 months'
      AND v.idproduto < 1000000
      AND UPPER(TRIM(p.marca)) = 'LIEBE'
      AND UPPER(TRIM(p.status)) = 'EM LINHA'
      AND UPPER(TRIM(p.continuidade)) IN ('PERMANENTE', 'PERMANENTE COR NOVA')
      AND UPPER(TRIM(p.cod_situacao)) <> '007'
      AND UPPER(TRIM(p.tamanho)) <> 'PT 99'
      AND UPPER(TRIM(p.referencia)) <> ''
      AND UPPER(TRIM(p.referencia)) NOT LIKE 'PT%'
      AND UPPER(TRIM(p.referencia)) NOT IN ('0114', '0138', '0139', '0140', '0171', '0172')
      AND UPPER(TRIM(p.produto)) NOT LIKE '%MEIA DE SEDA%'
      AND UPPER(TRIM(p.produto)) NOT LIKE '%FARDA BABYLOOK%'
      AND UPPER(TRIM(p.produto)) NOT LIKE '%EXTENSOR 30MM%'
      AND UPPER(TRIM(p.produto)) NOT LIKE '%EXTENSOR 40MM%'
      AND UPPER(TRIM(p.produto)) NOT LIKE '%EXTENSOR 60MM%'
      AND UPPER(TRIM(p.produto)) NOT LIKE '%ADESIVO DE VITRINE%'
      AND UPPER(TRIM(p.produto)) NOT LIKE '%URNA LIEBE PAPELAO%'
      AND UPPER(TRIM(p.apresentacao)) NOT LIKE '%MEIA DE SEDA%'
      AND UPPER(TRIM(p.apresentacao)) NOT LIKE '%FARDA BABYLOOK%'
      AND UPPER(TRIM(p.apresentacao)) NOT LIKE '%EXTENSOR 30MM%'
      AND UPPER(TRIM(p.apresentacao)) NOT LIKE '%EXTENSOR 40MM%'
      AND UPPER(TRIM(p.apresentacao)) NOT LIKE '%EXTENSOR 60MM%'
      AND UPPER(TRIM(p.apresentacao)) NOT LIKE '%ADESIVO DE VITRINE%'
      AND UPPER(TRIM(p.apresentacao)) NOT LIKE '%URNA LIEBE PAPELAO%'
    GROUP BY EXTRACT(YEAR FROM v.data), EXTRACT(MONTH FROM v.data), TO_CHAR(date_trunc('month', v.data), 'YYYY-MM')
    ORDER BY ano, mes
  `);

  const historyRows = historyResult.rows.map((row) => ({
    ano: Number(row.ano || 0),
    mes: Number(row.mes || 0),
    ano_mes: String(row.ano_mes || ''),
    empresa_1_qtd: Math.round(Number(row.empresa_1_qtd || 0)),
    outras_empresas_qtd: Math.round(Number(row.outras_empresas_qtd || 0)),
  }));

  const forecastMonthMap = new Map();
  for (const row of forecastRows) {
    const month = Number(row.mes || 0);
    if (!forecastMonthMap.has(month)) forecastMonthMap.set(month, 0);
    forecastMonthMap.set(month, forecastMonthMap.get(month) + Number(row.qtd || 0));
  }

  const seasonalityMap = new Map();
  for (const row of historyRows) {
    if (!seasonalityMap.has(row.mes)) {
      seasonalityMap.set(row.mes, { mes: row.mes });
    }
    const item = seasonalityMap.get(row.mes);
    item[`empresa_1_${row.ano}`] = row.empresa_1_qtd;
    item[`outras_${row.ano}`] = row.outras_empresas_qtd;
  }

  for (const [mes, total] of forecastMonthMap.entries()) {
    if (!seasonalityMap.has(mes)) {
      seasonalityMap.set(mes, { mes });
    }
    seasonalityMap.get(mes).forecast_2026 = Math.round(total);
  }

  const companyComparison = historyRows
    .filter((row) => row.ano >= 2024)
    .map((row) => ({
      ...row,
      forecast_ml: row.ano === 2026 ? Math.round(forecastMonthMap.get(row.mes) || 0) : 0,
    }));

  return {
    companyComparison,
    seasonalityByMonth: Array.from(seasonalityMap.values()).sort((a, b) => a.mes - b.mes),
  };
}

async function fetchProductMetaByIds(pool, ids) {
  const cleanIds = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!cleanIds.length) return new Map();

  const result = await pool.query(
    `
      SELECT
        a.cd_produto::TEXT AS idproduto,
        COALESCE(f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar), '')::TEXT AS referencia,
        COALESCE(f_dic_prd_nivel(a.cd_produto, 'DS'::bpchar), a.nm_produto, '')::TEXT AS produto,
        COALESCE(f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 802::bigint), '')::TEXT AS continuidade,
        COALESCE(f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 23::bigint), '')::TEXT AS linha,
        COALESCE(f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 24::bigint), '')::TEXT AS familia
      FROM vr_prd_prdgrade a
      WHERE a.cd_produto::TEXT = ANY($1::TEXT[])
    `,
    [cleanIds]
  );

  return new Map(
    result.rows.map((row) => [
      String(row.idproduto || '').trim(),
      {
        referencia: String(row.referencia || '').trim(),
        produto: String(row.produto || '').trim(),
        continuidade: String(row.continuidade || '').trim(),
        linha: String(row.linha || '').trim(),
        familia: String(row.familia || '').trim(),
      },
    ])
  );
}

async function getLatestRunFromDb(pool, options = {}) {
  await ensureMlTables(pool);
  const params = [];
  const where = [];
  if (options.modelVersion) {
    params.push(String(options.modelVersion));
    where.push(`model_version = $${params.length}`);
  }

  const runResult = await pool.query(`
    SELECT *
    FROM ${ML_RUNS_TABLE}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `, params);

  if (!runResult.rowCount) return null;

  const run = runResult.rows[0];
  const forecastResult = await pool.query(
    `
      SELECT
        idproduto,
        COALESCE(referencia, '') AS referencia,
        COALESCE(curva_abc, '') AS curva_abc,
        ano,
        mes,
        qtd
      FROM ${ML_FORECASTS_TABLE}
      WHERE run_id = $1
      ORDER BY idproduto, ano, mes
    `,
    [run.id]
  );

  const forecastRows = forecastResult.rows.map((row) => ({
    idproduto: String(row.idproduto || ''),
    referencia: String(row.referencia || ''),
    curva_abc: String(row.curva_abc || ''),
    linha: '',
    familia: '',
    continuidade: '',
    ano: Number(row.ano || 0),
    mes: Number(row.mes || 0),
    qtd: Number(row.qtd || 0),
  }));

  return {
    run: {
      id: Number(run.id),
      nome: String(run.nome || ''),
      source_type: String(run.source_type || ''),
      status: String(run.status || ''),
      model_version: String(run.model_version || ''),
      forecast_year: Number(run.forecast_year || 0),
      forecast_months: String(run.forecast_months || ''),
      created_at: Number(run.created_at || 0),
      finished_at: run.finished_at ? Number(run.finished_at) : null,
    },
    metrics: (() => {
      try {
        return JSON.parse(String(run.metrics || '{}'));
      } catch {
        return {};
      }
    })(),
    summary: (() => {
      try {
        return JSON.parse(String(run.summary || '{}'));
      } catch {
        return {};
      }
    })(),
    forecastRows,
  };
}

async function persistArtifactsToDb(pool) {
  await ensureMlTables(pool);

  const metricsPath = path.join(MODELS_DIR, 'metrics.json');
  const forecastPath = path.join(OUTPUT_DIR, 'projecoes_2026_h2_detalhe.csv');
  const metrics = readJsonIfExists(metricsPath, {});
  const forecastRows = readForecastCsv(forecastPath);

  if (!forecastRows.length) {
    throw new Error('Nenhum forecast detalhado encontrado em ml/output/projecoes_2026_h2_detalhe.csv');
  }

  const derived = summarizeForecastRows(forecastRows);
  const now = Date.now();

  await pool.query('BEGIN');
  try {
    const runResult = await pool.query(
      `
        INSERT INTO ${ML_RUNS_TABLE} (
          nome, source_type, status, model_version, forecast_year, forecast_months,
          metrics, summary, created_at, finished_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
      `,
      [
        `ML Forecast ${new Date(now).toLocaleString('pt-BR')}`,
        'python_artifacts',
        'completed',
        'v1',
        forecastRows[0]?.ano || null,
        JSON.stringify([...new Set(forecastRows.map((row) => row.mes))].sort((a, b) => a - b)),
        JSON.stringify(metrics || {}),
        JSON.stringify(derived.summary || {}),
        now,
        now,
      ]
    );

    const runId = Number(runResult.rows[0].id);

    for (const row of forecastRows) {
      await pool.query(
        `
          INSERT INTO ${ML_FORECASTS_TABLE} (
            run_id, idproduto, referencia, curva_abc, ano, mes, qtd
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          runId,
          String(row.idproduto || ''),
          String(row.referencia || ''),
          String(row.curva_abc || ''),
          Number(row.ano || 0),
          Number(row.mes || 0),
          Number(row.qtd || 0),
        ]
      );
    }

    await pool.query('COMMIT');
    return { runId, metrics, forecastRows, derived };
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

router.post('/run-pipeline', auth, async (req, res) => {
  try {
    const scriptPath = path.join(ML_DIR, 'main.py');
    const { stdout, stderr } = await execFileAsync(PYTHON_BIN, [scriptPath], {
      cwd: ROOT_DIR,
      timeout: 60 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 20,
    });

    const pool = req.app.get('pool');
    const latestDb = await getLatestRunFromDb(pool);
    const derived = latestDb ? summarizeForecastRows(latestDb.forecastRows) : null;

    return res.json({
      success: true,
      source: 'python_pipeline',
      stdout: String(stdout || ''),
      stderr: String(stderr || ''),
      dbRun: latestDb
        ? {
            id: latestDb.run.id,
            nome: latestDb.run.nome,
            source_type: latestDb.run.source_type,
            status: latestDb.run.status,
            model_version: latestDb.run.model_version,
            forecast_year: latestDb.run.forecast_year,
            forecast_months: latestDb.run.forecast_months,
            created_at: latestDb.run.created_at,
            finished_at: latestDb.run.finished_at,
          }
        : null,
      summary: latestDb?.summary && Object.keys(latestDb.summary).length ? latestDb.summary : derived?.summary || {},
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Erro ao executar pipeline ML',
      details: error.message,
      stdout: String(error.stdout || ''),
      stderr: String(error.stderr || ''),
    });
  }
});

router.post('/run-backtest', auth, async (_req, res) => {
  try {
    const scriptPath = path.join(ML_DIR, 'backtest.py');
    const { stdout, stderr } = await execFileAsync(PYTHON_BIN, [scriptPath], {
      cwd: ROOT_DIR,
      timeout: 60 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 20,
    });
    const payload = readJsonIfExists(BACKTEST_FILE, null);
    return res.json({
      success: true,
      source: 'python_backtest',
      stdout: String(stdout || ''),
      stderr: String(stderr || ''),
      data: payload,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Erro ao executar backtest ML',
      details: error.message,
      stdout: String(error.stdout || ''),
      stderr: String(error.stderr || ''),
    });
  }
});

router.get('/backtest-status', auth, (_req, res) => {
  try {
    const payload = readJsonIfExists(BACKTEST_FILE, null);
    if (!payload) {
      return res.json({
        success: true,
        available: false,
        data: null,
      });
    }
    return res.json({
      success: true,
      available: true,
      timestamp: fs.existsSync(BACKTEST_FILE) ? fs.statSync(BACKTEST_FILE).mtime.toISOString() : null,
      data: payload,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Erro ao carregar backtest ML',
      details: error.message,
    });
  }
});

function loadOfficialProjectionsFromJSON() {
  const parsed = readJsonIfExists(PROJECOES_FILE, { data: {} });
  return parsed?.data && typeof parsed.data === 'object' ? parsed.data : {};
}

async function loadOfficialProjections(pool = null) {
  if (USAR_BANCO && pool) {
    try {
      const anoAtual = new Date().getFullYear();
      const data = await projecoesService.lerProjecoesMultiplosAnos(pool, [anoAtual, anoAtual + 1]);
      return data;
    } catch (error) {
      console.warn('[ml] Erro ao ler projeções do banco, usando JSON:', error.message);
      return loadOfficialProjectionsFromJSON();
    }
  }
  return loadOfficialProjectionsFromJSON();
}

function computeMonthElapsedFactor(year, month, refDate = new Date()) {
  if (!year || !month) return 1;
  const refYear = refDate.getFullYear();
  const refMonth = refDate.getMonth() + 1;
  if (year !== refYear || month !== refMonth) return 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  const currentDay = Math.min(refDate.getDate(), daysInMonth);
  return daysInMonth > 0 ? Math.max(0, Math.min(1, currentDay / daysInMonth)) : 1;
}

function monthRange(startIso, endIso) {
  const rows = [];
  const current = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  current.setDate(1);
  while (current <= end) {
    rows.push({
      year: current.getFullYear(),
      month: current.getMonth() + 1,
    });
    current.setMonth(current.getMonth() + 1);
  }
  return rows;
}

function eachDate(startIso, endIso) {
  const rows = [];
  const current = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  while (current <= end) {
    rows.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return rows;
}

function isoWeekKey(dateValue) {
  const date = new Date(Date.UTC(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function weekdayNamePt(day) {
  return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'][day] || '';
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((acc, value) => acc + Number(value || 0), 0) / values.length;
}

function std(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((acc, value) => acc + ((Number(value || 0) - avg) ** 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

router.get('/validacao-ytd', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    const refDate = new Date();
    const year = Number(req.query?.ano) || refDate.getFullYear();
    const currentMonth = refDate.getMonth() + 1;
    const finalMonth = year === refDate.getFullYear() ? currentMonth : 12;

    const official = await loadOfficialProjections(pool);
    const ids = Object.keys(official).map((id) => Number(id)).filter((id) => Number.isFinite(id));

    if (!ids.length) {
      return res.json({
        success: true,
        ano: year,
        finalMonth,
        summary: {
          sku_count: 0,
          total_projection_adjusted: 0,
          total_actual: 0,
          total_abs_error: 0,
          weighted_accuracy_pct: 0,
        },
        monthly: [],
        skuRows: [],
      });
    }

    const [salesResult, productMeta] = await Promise.all([
      pool.query(
        `
          SELECT
            v.idproduto::TEXT AS idproduto,
            EXTRACT(MONTH FROM v.data)::INT AS mes,
            SUM(v.qt_liquida)::FLOAT AS quantidade
          FROM vr_vendas_qtd v
          WHERE v.idproduto = ANY($1::BIGINT[])
            AND EXTRACT(YEAR FROM v.data)::INT = $2
            AND EXTRACT(MONTH FROM v.data)::INT <= $3
            AND (DATE(v.data) <= $4::DATE)
          GROUP BY v.idproduto, EXTRACT(MONTH FROM v.data)
        `,
        [ids, year, finalMonth, refDate.toISOString().slice(0, 10)]
      ),
      fetchProductMetaByIds(pool, ids.map(String)),
    ]);

    const actualMap = new Map();
    for (const row of salesResult.rows) {
      const id = String(row.idproduto || '').trim();
      const month = Number(row.mes || 0);
      if (!actualMap.has(id)) actualMap.set(id, {});
      actualMap.get(id)[String(month)] = Number(row.quantidade) || 0;
    }

    const monthlyMap = new Map();
    const skuRows = [];
    let totalProjectionAdjusted = 0;
    let totalActual = 0;
    let totalAbsError = 0;

    for (const [id, months] of Object.entries(official)) {
      const actualSku = actualMap.get(String(id)) || {};
      const meta = productMeta.get(String(id)) || { referencia: '', produto: '', continuidade: '', linha: '', familia: '' };

      let skuProjectionAdjusted = 0;
      let skuActual = 0;
      let skuAbsError = 0;

      for (let month = 1; month <= finalMonth; month += 1) {
        const projected = Number(months?.[String(month)] || 0);
        const factor = computeMonthElapsedFactor(year, month, refDate);
        const projectedComparable = projected * factor;
        const actual = Number(actualSku[String(month)] || 0);
        const absError = Math.abs(actual - projectedComparable);

        if (!monthlyMap.has(month)) {
          monthlyMap.set(month, {
            mes: month,
            projected_full: 0,
            projected_comparable: 0,
            actual: 0,
            abs_error: 0,
          });
        }

        const monthItem = monthlyMap.get(month);
        monthItem.projected_full += projected;
        monthItem.projected_comparable += projectedComparable;
        monthItem.actual += actual;
        monthItem.abs_error += absError;

        skuProjectionAdjusted += projectedComparable;
        skuActual += actual;
        skuAbsError += absError;
      }

      totalProjectionAdjusted += skuProjectionAdjusted;
      totalActual += skuActual;
      totalAbsError += skuAbsError;

      skuRows.push({
        idproduto: String(id),
        referencia: meta.referencia,
        produto: meta.produto,
        continuidade: meta.continuidade,
        linha: meta.linha,
        familia: meta.familia,
        projected_adjusted: Math.round(skuProjectionAdjusted),
        actual: Math.round(skuActual),
        abs_error: Math.round(skuAbsError),
        accuracy_pct: skuActual > 0 ? Math.max(0, 1 - skuAbsError / skuActual) * 100 : 0,
      });
    }

    const monthly = Array.from(monthlyMap.values())
      .map((item) => ({
        mes: item.mes,
        projected_full: Math.round(item.projected_full),
        projected_comparable: Math.round(item.projected_comparable),
        actual: Math.round(item.actual),
        abs_error: Math.round(item.abs_error),
        attainment_pct: item.projected_comparable > 0 ? (item.actual / item.projected_comparable) * 100 : 0,
        accuracy_pct: item.actual > 0 ? Math.max(0, 1 - item.abs_error / item.actual) * 100 : 0,
      }))
      .sort((a, b) => a.mes - b.mes);

    skuRows.sort((a, b) => b.abs_error - a.abs_error);

    return res.json({
      success: true,
      ano: year,
      finalMonth,
      refDate: refDate.toISOString(),
      summary: {
        sku_count: skuRows.length,
        total_projection_adjusted: Math.round(totalProjectionAdjusted),
        total_actual: Math.round(totalActual),
        total_abs_error: Math.round(totalAbsError),
        weighted_accuracy_pct: totalActual > 0 ? Math.max(0, 1 - totalAbsError / totalActual) * 100 : 0,
      },
      monthly,
      skuRows: skuRows.slice(0, 300),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Erro ao calcular validacao YTD de projecao',
      details: error.message,
    });
  }
});

router.get('/monitor-v1', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    const latestV1 = await getLatestRunFromDb(pool, { modelVersion: 'v1' });
    if (!latestV1) {
      return res.status(404).json({
        success: false,
        error: 'Nenhum run v1 encontrado no banco',
      });
    }

    const official = await loadOfficialProjections(pool);
    const refDate = new Date();
    const endActualDate = refDate < new Date(`${MONITOR_END_DATE}T00:00:00`) ? refDate : new Date(`${MONITOR_END_DATE}T00:00:00`);

    const forecastMeta = await fetchProductMetaByIds(pool, latestV1.forecastRows.map((row) => row.idproduto));

    const monthlyTargets = new Map();
    const addMonthlyTarget = (year, month, continuity, source, qtd) => {
      const key = `${year}-${month}-${continuity}`;
      if (!monthlyTargets.has(key)) {
        monthlyTargets.set(key, { year, month, continuidade: continuity, target: 0, source });
      }
      const item = monthlyTargets.get(key);
      item.target += Number(qtd || 0);
      if (source === 'ml_v1') item.source = source;
    };

    for (const row of latestV1.forecastRows) {
      const meta = forecastMeta.get(String(row.idproduto)) || {};
      const continuidade = String(meta.continuidade || 'SEM_CONTINUIDADE');
      addMonthlyTarget(Number(row.ano || 0), Number(row.mes || 0), continuidade, 'ml_v1', Number(row.qtd || 0));
      addMonthlyTarget(Number(row.ano || 0), Number(row.mes || 0), 'TOTAL', 'ml_v1', Number(row.qtd || 0));
    }

    const officialIds = Object.keys(official).map(String);
    const officialMeta = await fetchProductMetaByIds(pool, officialIds);
    for (const [idproduto, months] of Object.entries(official)) {
      const meta = officialMeta.get(String(idproduto)) || {};
      const continuidade = String(meta.continuidade || 'SEM_CONTINUIDADE');
      for (const [monthKey, qtd] of Object.entries(months || {})) {
        const month = Number(monthKey || 0);
        if (month < 4 || month > 12) continue;
        if (month >= 7 && month <= 11) continue;
        addMonthlyTarget(2026, month, continuidade, 'oficial', Number(qtd || 0));
        addMonthlyTarget(2026, month, 'TOTAL', 'oficial', Number(qtd || 0));
      }
    }

    const actualResult = await pool.query(`
      WITH valid_products AS (
        SELECT
          p.cd_produto::BIGINT AS idproduto,
          COALESCE(f_dic_prd_classificacao(p.cd_produto, 'DS'::text, 802::bigint), '') AS continuidade,
          COALESCE(f_dic_prd_classificacao(p.cd_produto, 'DS'::text, 20::bigint), '') AS marca,
          COALESCE(f_dic_prd_classificacao(p.cd_produto, 'DS'::text, 27::bigint), '') AS status,
          COALESCE(f_dic_prd_classificacao(p.cd_produto, 'CD'::text, 124::bigint), '') AS cod_situacao,
          COALESCE(f_dic_prd_nivel(p.cd_produto, 'CD'::bpchar), '') AS referencia,
          COALESCE(p.nm_produto, '') AS produto,
          COALESCE(p.ds_tamanho, '') AS tamanho
        FROM vr_prd_prdgrade p
        WHERE p.cd_produto < 1000000
      )
      SELECT
        DATE(v.data) AS dia,
        UPPER(TRIM(p.continuidade)) AS continuidade,
        SUM(v.qt_liquida)::FLOAT AS qtd
      FROM vr_vendas_qtd v
      JOIN valid_products p ON p.idproduto = v.idproduto
      WHERE v.idempresa = 1
        AND DATE(v.data) >= $1::DATE
        AND DATE(v.data) <= $2::DATE
        AND UPPER(TRIM(p.marca)) = 'LIEBE'
        AND UPPER(TRIM(p.status)) = 'EM LINHA'
        AND UPPER(TRIM(p.continuidade)) IN ('PERMANENTE', 'PERMANENTE COR NOVA')
        AND UPPER(TRIM(p.cod_situacao)) <> '007'
        AND UPPER(TRIM(p.tamanho)) <> 'PT 99'
        AND UPPER(TRIM(p.referencia)) <> ''
        AND UPPER(TRIM(p.referencia)) NOT LIKE 'PT%'
        AND UPPER(TRIM(p.referencia)) NOT IN ('0114', '0138', '0139', '0140', '0171', '0172')
        AND UPPER(TRIM(p.produto)) NOT LIKE '%MEIA DE SEDA%'
        AND UPPER(TRIM(p.produto)) NOT LIKE '%FARDA BABYLOOK%'
        AND UPPER(TRIM(p.produto)) NOT LIKE '%EXTENSOR 30MM%'
        AND UPPER(TRIM(p.produto)) NOT LIKE '%EXTENSOR 40MM%'
        AND UPPER(TRIM(p.produto)) NOT LIKE '%EXTENSOR 60MM%'
        AND UPPER(TRIM(p.produto)) NOT LIKE '%ADESIVO DE VITRINE%'
        AND UPPER(TRIM(p.produto)) NOT LIKE '%URNA LIEBE PAPELAO%'
      GROUP BY DATE(v.data), UPPER(TRIM(p.continuidade))
      ORDER BY dia, continuidade
    `, [MONITOR_START_DATE, endActualDate.toISOString().slice(0, 10)]);

    const weekdayHistoryResult = await pool.query(`
      WITH valid_products AS (
        SELECT
          p.cd_produto::BIGINT AS idproduto,
          COALESCE(f_dic_prd_classificacao(p.cd_produto, 'DS'::text, 802::bigint), '') AS continuidade,
          COALESCE(f_dic_prd_classificacao(p.cd_produto, 'DS'::text, 20::bigint), '') AS marca,
          COALESCE(f_dic_prd_classificacao(p.cd_produto, 'DS'::text, 27::bigint), '') AS status,
          COALESCE(f_dic_prd_classificacao(p.cd_produto, 'CD'::text, 124::bigint), '') AS cod_situacao,
          COALESCE(f_dic_prd_nivel(p.cd_produto, 'CD'::bpchar), '') AS referencia,
          COALESCE(p.nm_produto, '') AS produto,
          COALESCE(p.ds_tamanho, '') AS tamanho
        FROM vr_prd_prdgrade p
        WHERE p.cd_produto < 1000000
      ),
      daily_sales AS (
        SELECT
          DATE(v.data) AS dia,
          UPPER(TRIM(p.continuidade)) AS continuidade,
          SUM(v.qt_liquida)::FLOAT AS qtd_dia
        FROM vr_vendas_qtd v
        JOIN valid_products p ON p.idproduto = v.idproduto
        WHERE DATE(v.data) >= DATE '2025-01-01'
          AND DATE(v.data) < DATE '2026-04-01'
          AND v.idempresa = 1
          AND UPPER(TRIM(p.marca)) = 'LIEBE'
          AND UPPER(TRIM(p.status)) = 'EM LINHA'
          AND UPPER(TRIM(p.continuidade)) IN ('PERMANENTE', 'PERMANENTE COR NOVA')
          AND UPPER(TRIM(p.cod_situacao)) <> '007'
          AND UPPER(TRIM(p.tamanho)) <> 'PT 99'
          AND UPPER(TRIM(p.referencia)) <> ''
          AND UPPER(TRIM(p.referencia)) NOT LIKE 'PT%'
          AND UPPER(TRIM(p.referencia)) NOT IN ('0114', '0138', '0139', '0140', '0171', '0172')
          AND UPPER(TRIM(p.produto)) NOT LIKE '%MEIA DE SEDA%'
          AND UPPER(TRIM(p.produto)) NOT LIKE '%FARDA BABYLOOK%'
          AND UPPER(TRIM(p.produto)) NOT LIKE '%EXTENSOR 30MM%'
          AND UPPER(TRIM(p.produto)) NOT LIKE '%EXTENSOR 40MM%'
          AND UPPER(TRIM(p.produto)) NOT LIKE '%EXTENSOR 60MM%'
          AND UPPER(TRIM(p.produto)) NOT LIKE '%ADESIVO DE VITRINE%'
          AND UPPER(TRIM(p.produto)) NOT LIKE '%URNA LIEBE PAPELAO%'
        GROUP BY DATE(v.data), UPPER(TRIM(p.continuidade))
      )
      SELECT
        EXTRACT(DOW FROM dia)::INT AS dow,
        continuidade,
        AVG(qtd_dia)::FLOAT AS media_qtd
      FROM daily_sales
      GROUP BY EXTRACT(DOW FROM dia), continuidade
      ORDER BY continuidade, dow
    `);

    const dailyActualMap = new Map();
    for (const row of actualResult.rows) {
      const iso = new Date(row.dia).toISOString().slice(0, 10);
      const continuidade = String(row.continuidade || '');
      if (!dailyActualMap.has(`${iso}|${continuidade}`)) {
        dailyActualMap.set(`${iso}|${continuidade}`, 0);
      }
      dailyActualMap.set(`${iso}|${continuidade}`, dailyActualMap.get(`${iso}|${continuidade}`) + Number(row.qtd || 0));
      if (!dailyActualMap.has(`${iso}|TOTAL`)) dailyActualMap.set(`${iso}|TOTAL`, 0);
      dailyActualMap.set(`${iso}|TOTAL`, dailyActualMap.get(`${iso}|TOTAL`) + Number(row.qtd || 0));
    }

    const weekdayWeights = new Map();
    const continuitySet = new Set(['TOTAL', 'PERMANENTE', 'PERMANENTE COR NOVA']);
    for (const row of weekdayHistoryResult.rows) {
      const continuidade = String(row.continuidade || '');
      const dow = Number(row.dow || 0);
      const key = `${continuidade}|${dow}`;
      weekdayWeights.set(key, Number(row.media_qtd || 0));
      continuitySet.add(continuidade);
    }
    for (let dow = 0; dow <= 6; dow += 1) {
      const perm = Number(weekdayWeights.get(`PERMANENTE|${dow}`) || 0);
      const cor = Number(weekdayWeights.get(`PERMANENTE COR NOVA|${dow}`) || 0);
      weekdayWeights.set(`TOTAL|${dow}`, perm + cor);
    }

    const monthlyRows = Array.from(monthlyTargets.values())
      .filter((row) => row.year === 2026 && row.month >= 4 && row.month <= 12 && continuitySet.has(row.continuidade))
      .sort((a, b) => (a.year - b.year) || (a.month - b.month) || a.continuidade.localeCompare(b.continuidade, 'pt-BR'));

    const dailyRows = [];
    const monthSourceMap = new Map();
    for (const row of monthlyRows) {
      monthSourceMap.set(`${row.year}-${row.month}-${row.continuidade}`, row.source);
    }

    for (const monthRow of monthlyRows) {
      const monthStart = `${monthRow.year}-${String(monthRow.month).padStart(2, '0')}-01`;
      const days = eachDate(monthStart, `${monthRow.year}-${String(monthRow.month).padStart(2, '0')}-${String(new Date(monthRow.year, monthRow.month, 0).getDate()).padStart(2, '0')}`);
      const rawWeights = days.map((day) => {
        const dow = day.getDay();
        const continuity = monthRow.continuidade;
        const baseWeight = Number(weekdayWeights.get(`${continuity}|${dow}`) || weekdayWeights.get(`TOTAL|${dow}`) || 1);
        return baseWeight > 0 ? baseWeight : 1;
      });
      const totalWeight = rawWeights.reduce((acc, value) => acc + value, 0) || 1;

      days.forEach((day, index) => {
        const iso = day.toISOString().slice(0, 10);
        const target = Number(monthRow.target || 0) * (rawWeights[index] / totalWeight);
        const actual = day <= endActualDate ? Number(dailyActualMap.get(`${iso}|${monthRow.continuidade}`) || 0) : null;
        dailyRows.push({
          date: iso,
          continuidade: monthRow.continuidade,
          source: monthRow.source,
          week: isoWeekKey(day),
          month: `${monthRow.year}-${String(monthRow.month).padStart(2, '0')}`,
          weekday: weekdayNamePt(day.getDay()),
          target: Math.round(target),
          actual: actual === null ? null : Math.round(actual),
          error: actual === null ? null : Math.round(actual - target),
        });
      });
    }

    const aggregateRows = (rows, keyField) => {
      const map = new Map();
      for (const row of rows) {
        const key = `${row.continuidade}|${row[keyField]}`;
        if (!map.has(key)) {
          map.set(key, {
            continuidade: row.continuidade,
            period: row[keyField],
            source: row.source,
            target: 0,
            actual: 0,
          });
        }
        const item = map.get(key);
        item.target += Number(row.target || 0);
        item.actual += Number(row.actual || 0);
      }
      return Array.from(map.values()).map((item) => ({
        ...item,
        target: Math.round(item.target),
        actual: Math.round(item.actual),
        error: Math.round(item.actual - item.target),
        abs_error: Math.round(Math.abs(item.actual - item.target)),
      }));
    };

    const realizedDaily = dailyRows.filter((row) => row.actual !== null);
    const weeklyRows = aggregateRows(realizedDaily, 'week');
    const monthlyCompareRows = aggregateRows(realizedDaily, 'month');

    const noiseRows = [];
    const anomalyRows = [];
    for (const continuidade of continuitySet) {
      const rows = realizedDaily.filter((row) => row.continuidade === continuidade);
      const errors = rows.map((row) => Number(row.error || 0));
      const avg = mean(errors);
      const deviation = std(errors);
      for (const row of rows) {
        const zscore = deviation > 0 ? (Number(row.error || 0) - avg) / deviation : 0;
        const enriched = {
          ...row,
          abs_error: Math.round(Math.abs(Number(row.error || 0))),
          zscore: Number(zscore.toFixed(2)),
        };
        noiseRows.push(enriched);
        if (Math.abs(zscore) >= 2.5) {
          anomalyRows.push(enriched);
        }
      }
    }

    noiseRows.sort((a, b) => a.date.localeCompare(b.date, 'pt-BR'));
    anomalyRows.sort((a, b) => Math.abs(Number(b.zscore || 0)) - Math.abs(Number(a.zscore || 0)));

    return res.json({
      success: true,
      modelVersion: 'v1',
      run: latestV1.run,
      startDate: MONITOR_START_DATE,
      endDate: MONITOR_END_DATE,
      actualCutoffDate: endActualDate.toISOString().slice(0, 10),
      daily: dailyRows,
      weekly: weeklyRows,
      monthly: monthlyCompareRows,
      noise: noiseRows,
      anomalies: anomalyRows.slice(0, 120),
      monthSources: Array.from(monthSourceMap.entries()).map(([key, source]) => ({ key, source })),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Erro ao montar monitoramento v1',
      details: error.message,
    });
  }
});

router.post('/sync-db', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    const persisted = await persistArtifactsToDb(pool);
    return res.json({
      success: true,
      runId: persisted.runId,
      summary: persisted.derived.summary,
      totalsByMonth: persisted.derived.totalsByMonth,
      totalsByCurve: persisted.derived.totalsByCurve,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Erro ao sincronizar resultado do ML com o banco',
      details: error.message,
    });
  }
});

router.get('/status', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    const latestDb = await getLatestRunFromDb(pool, { modelVersion: 'v1' }) || await getLatestRunFromDb(pool);

    if (latestDb) {
      const importancePath = path.join(MODELS_DIR, 'feature_importance.json');
      const importanceByModel = readJsonIfExists(importancePath, {});
      const derived = summarizeForecastRows(latestDb.forecastRows);
      const previewRowsBase = latestDb.forecastRows.slice(0, 300);
      const metaMap = await fetchProductMetaByIds(pool, previewRowsBase.map((row) => row.idproduto));
      const previewRows = previewRowsBase.map((row) => {
        const meta = metaMap.get(String(row.idproduto)) || {};
        return {
          ...row,
          referencia: row.referencia || meta.referencia || '',
          continuidade: meta.continuidade || '',
          linha: meta.linha || '',
          familia: meta.familia || '',
        };
      });
      return res.json({
        success: true,
        source: 'database',
        dbRun: {
          id: latestDb.run.id,
          nome: latestDb.run.nome,
          source_type: latestDb.run.source_type,
          status: latestDb.run.status,
          model_version: latestDb.run.model_version,
          forecast_year: latestDb.run.forecast_year,
          forecast_months: latestDb.run.forecast_months,
          created_at: latestDb.run.created_at,
          finished_at: latestDb.run.finished_at,
        },
        files: {
          metrics: true,
          models: true,
          forecast_detail: latestDb.forecastRows.length > 0,
          forecast_upload: latestDb.forecastRows.length > 0,
        },
        timestamps: {
          metrics: latestDb.run.finished_at ? new Date(latestDb.run.finished_at).toISOString() : null,
          models: latestDb.run.finished_at ? new Date(latestDb.run.finished_at).toISOString() : null,
          forecast_detail: latestDb.run.finished_at ? new Date(latestDb.run.finished_at).toISOString() : null,
          forecast_upload: latestDb.run.finished_at ? new Date(latestDb.run.finished_at).toISOString() : null,
        },
        metrics: latestDb.metrics,
        importanceByModel,
        summary: latestDb.summary && Object.keys(latestDb.summary).length ? latestDb.summary : derived.summary,
        totalsByMonth: derived.totalsByMonth,
        totalsByCurve: derived.totalsByCurve,
        preview: previewRows,
      });
    }

    const metricsPath = path.join(MODELS_DIR, 'metrics.json');
    const importancePath = path.join(MODELS_DIR, 'feature_importance.json');
    const modelsPath = path.join(MODELS_DIR, 'forecast_models.pkl');
    const forecastPath = path.join(OUTPUT_DIR, 'projecoes_2026_h2_detalhe.csv');
    const uploadPath = path.join(OUTPUT_DIR, 'projecoes_2026_h2.csv');

    const metrics = readJsonIfExists(metricsPath, {});
    const importanceByModel = readJsonIfExists(importancePath, {});
    const forecastRows = readForecastCsv(forecastPath);
    const derived = summarizeForecastRows(forecastRows);
    const previewRowsBase = forecastRows.slice(0, 300);
    const metaMap = await fetchProductMetaByIds(pool, previewRowsBase.map((row) => row.idproduto));
    const previewRows = previewRowsBase.map((row) => {
      const meta = metaMap.get(String(row.idproduto)) || {};
      return {
        ...row,
        referencia: row.referencia || meta.referencia || '',
        continuidade: meta.continuidade || '',
        linha: meta.linha || '',
        familia: meta.familia || '',
      };
    });

    const files = {
      metrics: fs.existsSync(metricsPath),
      models: fs.existsSync(modelsPath),
      forecast_detail: fs.existsSync(forecastPath),
      forecast_upload: fs.existsSync(uploadPath),
    };

    const timestamps = {
      metrics: files.metrics ? fs.statSync(metricsPath).mtime.toISOString() : null,
      models: files.models ? fs.statSync(modelsPath).mtime.toISOString() : null,
      forecast_detail: files.forecast_detail ? fs.statSync(forecastPath).mtime.toISOString() : null,
      forecast_upload: files.forecast_upload ? fs.statSync(uploadPath).mtime.toISOString() : null,
    };

    return res.json({
      success: true,
      source: 'files',
      files,
      timestamps,
      metrics,
      importanceByModel,
      summary: derived.summary,
      totalsByMonth: derived.totalsByMonth,
      totalsByCurve: derived.totalsByCurve,
      preview: previewRows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Erro ao carregar status do pipeline ML',
      details: error.message,
    });
  }
});

module.exports = router;
