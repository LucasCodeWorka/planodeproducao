const express = require("express");
const fs = require("fs");
const path = require("path");
const { readCacheByKey, writeCacheByKey } = require("../cache/matrizCache");
const { calcularCurvaAbcReferencias } = require("../services/curvaAbcService");

const router = express.Router();

const DATA_DIR = path.join(__dirname, "../../data");
const ANALISES_FILE = path.join(DATA_DIR, "analises_plano.json");
const TABLE_NAME = "app_simulacoes";
const CURVA_ABC_CACHE_KEY = "curva_abc_referencias";

function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
  const expected = (process.env.ADMIN_PASSWORD || "").trim();
  if (!expected) {
    return res.status(500).json({ success: false, error: "ADMIN_PASSWORD não configurado" });
  }
  if (token !== expected) {
    return res.status(401).json({ success: false, error: "Não autorizado" });
  }
  next();
}

function readAnalisesFile() {
  try {
    const raw = fs.readFileSync(ANALISES_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.data)) return [];
    return parsed.data;
  } catch {
    return [];
  }
}

function writeAnalisesFile(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    ANALISES_FILE,
    JSON.stringify({ timestamp: Date.now(), count: data.length, data }, null, 2),
    "utf-8"
  );
}

async function ensureSimulacoesTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id           TEXT PRIMARY KEY,
      nome         TEXT NOT NULL,
      created_at   BIGINT NOT NULL,
      updated_at   BIGINT NULL,
      parametros   TEXT NOT NULL,
      resumo       TEXT NOT NULL,
      observacoes  TEXT NOT NULL
    )
  `);
}

async function migrateLegacyFile(pool) {
  const legacy = readAnalisesFile();
  if (!legacy.length) return;

  const existsRes = await pool.query(`SELECT COUNT(*)::INT AS total FROM ${TABLE_NAME}`);
  const total = Number(existsRes.rows?.[0]?.total || 0);
  if (total > 0) return;

  for (const item of legacy) {
    await pool.query(
      `INSERT INTO ${TABLE_NAME} (id, nome, created_at, updated_at, parametros, resumo, observacoes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        String(item.id),
        String(item.nome || ""),
        Number(item.createdAt || Date.now()),
        item.updatedAt ? Number(item.updatedAt) : null,
        JSON.stringify(item.parametros || {}),
        JSON.stringify(item.resumo || {}),
        String(item.observacoes || "")
      ]
    );
  }
}

async function readAnalises(pool) {
  await ensureSimulacoesTable(pool);
  await migrateLegacyFile(pool);

  const result = await pool.query(`
    SELECT id, nome, created_at, updated_at, parametros, resumo, observacoes
    FROM ${TABLE_NAME}
    ORDER BY created_at DESC
    LIMIT 200
  `);

  return result.rows.map((row) => ({
    id: String(row.id),
    nome: String(row.nome || ""),
    createdAt: Number(row.created_at || 0),
    updatedAt: row.updated_at ? Number(row.updated_at) : undefined,
    parametros: safeParseJson(row.parametros, {}),
    resumo: safeParseJson(row.resumo, {}),
    observacoes: String(row.observacoes || ""),
  }));
}

function safeParseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

router.get("/", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const data = await readAnalises(pool);
    return res.json({
      success: true,
      total: data.length,
      data,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Erro ao listar simulações", details: error.message });
  }
});

router.get("/produtos-suspensos", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const result = await pool.query(`
      SELECT DISTINCT a.cd_produto::TEXT AS idproduto
      FROM vr_prd_prdgrade a
      WHERE f_dic_prd_classificacao(a.cd_produto, 'CD'::text, 124::bigint) = '007'
    `);

    const ids = result.rows.map(row => String(row.idproduto));

    return res.json({
      success: true,
      total: ids.length,
      ids: ids
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar produtos suspensos",
      details: error.message,
    });
  }
});

router.get("/top30-produtos", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const result = await pool.query("SELECT * FROM mv_top30_produtos");

    const idKeys = ["idproduto", "cd_produto", "produto_id", "id_produto"];
    const refKeys = ["referencia", "referência", "ref", "cd_referencia", "cd_ref", "nr_referencia"];
    const ids = new Set();
    const referencias = new Set();

    for (const row of result.rows) {
      let value = null;
      for (const k of idKeys) {
        if (row[k] !== undefined && row[k] !== null) {
          value = row[k];
          break;
        }
      }

      if (value === null) {
        const keyByName = Object.keys(row).find((k) => k.toLowerCase().includes("produto"));
        if (keyByName && row[keyByName] !== null && row[keyByName] !== undefined) {
          value = row[keyByName];
        }
      }

      if (value !== null && value !== undefined && String(value).trim() !== "") {
        ids.add(String(value).trim());
      }

      let refValue = null;
      for (const k of refKeys) {
        if (row[k] !== undefined && row[k] !== null) {
          refValue = row[k];
          break;
        }
      }

      if (refValue === null) {
        const keyByName = Object.keys(row).find((k) => {
          const kk = k.toLowerCase();
          return kk.includes("refer") || kk === "ref";
        });
        if (keyByName && row[keyByName] !== null && row[keyByName] !== undefined) {
          refValue = row[keyByName];
        }
      }

      if (refValue !== null && refValue !== undefined && String(refValue).trim() !== "") {
        referencias.add(String(refValue).trim());
      }
    }

    return res.json({
      success: true,
      totalRows: result.rows.length,
      totalProdutos: ids.size,
      totalReferencias: referencias.size,
      ids: Array.from(ids),
      referencias: Array.from(referencias),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar mv_top30_produtos",
      details: error.message,
    });
  }
});

/**
 * GET /api/analises/curva-abc-referencias
 * Retorna a curva ABCD por referência baseada nas vendas dos últimos 90 dias
 * Curva A: Referências com 2.500+ unidades vendidas no período
 * Curva B: Referências intermediárias (não são A, C ou D)
 * Curva C: 30 referências anteriores às últimas 20 no ranking de quantidade
 * Curva D: Últimas 20 referências no ranking de quantidade
 */
router.get("/curva-abc-referencias", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const cached = await readCacheByKey(CURVA_ABC_CACHE_KEY);
    if (cached?.data && !req.query?.refresh) {
      res.set("X-Cache", "HIT");
      return res.json({
        ...cached.data,
        cache: {
          updatedAt: new Date(cached.timestamp).toLocaleString("pt-BR"),
          fresh: cached.fresh,
          ageHours: Number(cached.ageHours?.toFixed?.(1) || 0),
        },
      });
    }

    const payload = await calcularCurvaAbcReferencias(pool);
    await writeCacheByKey(CURVA_ABC_CACHE_KEY, payload, {
      marca: "LIEBE",
      status: "EM LINHA",
      geradoPor: req.query?.refresh ? "analises/curva-abc-referencias?refresh=true" : "analises/curva-abc-referencias",
    });

    res.set("X-Cache", cached ? "MISS" : "BUILD");
    return res.json(payload);
  } catch (error) {
    console.error('[curva-abc-referencias] Erro:', error);
    return res.status(500).json({
      success: false,
      error: "Erro ao calcular curva ABC por referências",
      details: error.message
    });
  }
});

router.post("/projecao-vs-venda", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const ano = Number(req.body?.ano) || new Date().getFullYear();
    const idsRaw = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = idsRaw
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));

    if (ids.length === 0) {
      return res.json({ success: true, ano, data: {} });
    }

    const query = `
      SELECT
        v.idproduto::TEXT AS idproduto,
        EXTRACT(MONTH FROM v.data)::INT AS mes,
        SUM(v.qt_liquida)::FLOAT AS quantidade
      FROM vr_vendas_qtd v
      WHERE
        v.idproduto = ANY($1::BIGINT[])
        AND EXTRACT(YEAR FROM v.data)::INT = $2
      GROUP BY v.idproduto, EXTRACT(MONTH FROM v.data)
    `;

    const result = await pool.query(query, [ids, ano]);

    const data = {};
    for (const row of result.rows) {
      const id = String(row.idproduto);
      if (!data[id]) data[id] = {};
      data[id][String(row.mes)] = Number(row.quantidade) || 0;
    }

    return res.json({
      success: true,
      ano,
      produtos: ids.length,
      data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao calcular projeção vs venda",
      details: error.message
    });
  }
});

router.get("/snapshot-lotes/datas", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const result = await pool.query(`
      SELECT
        DATE(data_snapshot) AS data,
        TO_CHAR(MAX(data_snapshot), 'YYYY-MM-DD HH24:MI:SS.MS') AS snapshot_at,
        COUNT(*)::INT AS linhas
      FROM snapshot_lotes
      GROUP BY DATE(data_snapshot)
      ORDER BY DATE(data_snapshot) DESC
      LIMIT 500
    `);

    return res.json({
      success: true,
      data: result.rows.map((row) => ({
        data: row.data,
        snapshotAt: row.snapshot_at,
        linhas: Number(row.linhas || 0),
      })),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao listar snapshots do plano",
      details: error.message,
    });
  }
});

async function resolveSnapshotAt(pool, data, offset) {
  if (data) {
    const result = await pool.query(
      `SELECT TO_CHAR(MAX(data_snapshot), 'YYYY-MM-DD HH24:MI:SS.MS') AS snapshot_at
       FROM snapshot_lotes
       WHERE DATE(data_snapshot) = $1::DATE`,
      [data]
    );
    return result.rows?.[0]?.snapshot_at || null;
  }

  const result = await pool.query(
    `SELECT TO_CHAR(MAX(data_snapshot), 'YYYY-MM-DD HH24:MI:SS.MS') AS snapshot_at
     FROM snapshot_lotes
     GROUP BY DATE(data_snapshot)
     ORDER BY DATE(data_snapshot) DESC
     OFFSET $1 LIMIT 1`,
    [offset]
  );
  return result.rows?.[0]?.snapshot_at || null;
}

function tipoAlteracao(delta, qtdDe, qtdAte) {
  if (qtdDe <= 0 && qtdAte > 0) return "ADICIONADO";
  if (qtdDe > 0 && qtdAte <= 0) return "RETIRADO";
  if (delta > 0) return "AUMENTADO";
  if (delta < 0) return "REDUZIDO";
  return "SEM_ALTERACAO";
}

const PERIODOS_PLANO = ["MA", "PX", "UL", "QT", "QU"];

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function periodoParaMes(periodo, baseDate = new Date()) {
  const idx = PERIODOS_PLANO.indexOf(String(periodo || "").toUpperCase());
  if (idx < 0) return "";
  const data = addMonths(startOfMonth(baseDate), idx);
  return data.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
}

function impactoTipoMp(delta) {
  if (delta > 0) return "AUMENTOU_CONSUMO";
  if (delta < 0) return "REDUZIU_CONSUMO";
  return "SEM_IMPACTO";
}

function classificarRiscoMp(row) {
  const deltaTotal = Number(row.delta_consumo_total || 0);
  const comprasAndamento = Number(row.compras_pendentes_total || 0);
  const comprasFinalizadas = Number(row.compras_finalizadas_total || 0);
  const saldoAtual = Number(row.estoquetotal || 0) + comprasAndamento;

  if (deltaTotal > 0 && saldoAtual < deltaTotal) return "FALTA_GERADA";
  if (deltaTotal > 0) return "AUMENTO_COBERTO";
  if (deltaTotal < 0 && (comprasAndamento > 0 || comprasFinalizadas > 0)) return "COMPRA_PODE_SOBRAR";
  if (deltaTotal < 0) return "REDUCAO_CONSUMO";
  return "NEUTRO";
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function queryBomPorPais(pool, idsPais) {
  if (!idsPais.length) return [];
  const result = await pool.query(`
    SELECT
      c.cd_produtopa::TEXT AS parent_id,
      c.cd_produtomp::TEXT AS child_id,
      SUM(COALESCE(c.qt_consumo, 0))::FLOAT AS fator
    FROM public.vr_pcp_fcconsumo c
    WHERE c.cd_produtopa::TEXT = ANY($1::TEXT[])
    GROUP BY c.cd_produtopa, c.cd_produtomp
    HAVING SUM(COALESCE(c.qt_consumo, 0)) > 0
  `, [idsPais]);
  return result.rows;
}

router.get("/snapshot-lotes/comparativo", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const dataDe = req.query.de ? String(req.query.de).slice(0, 10) : null;
    const dataAte = req.query.ate ? String(req.query.ate).slice(0, 10) : null;
    const periodos = String(req.query.periodos || "MA,PX,UL,QT,QU")
      .split(",")
      .map((p) => p.trim().toUpperCase())
      .filter((p) => ["MA", "PX", "UL", "QT", "QU"].includes(p));
    const apenasAlterados = req.query.apenas_alterados !== "false";
    const limit = Math.min(Number(req.query.limit) || 1000, 5000);

    const snapshotAte = await resolveSnapshotAt(pool, dataAte, 0);
    const snapshotDe = await resolveSnapshotAt(pool, dataDe, dataAte ? 1 : 1);

    if (!snapshotDe || !snapshotAte) {
      return res.status(404).json({
        success: false,
        error: "Snapshots insuficientes para comparar",
      });
    }

    const result = await pool.query(`
      WITH snap_de AS (
        SELECT
          cd_produto::BIGINT AS cd_produto,
          UPPER(TRIM(COALESCE(cd_auxiliar, ''))) AS periodo,
          MIN(nr_lote)::BIGINT AS nr_lote,
          MIN(dt_cadastro) AS dt_cadastro,
          MIN(dt_integracao) AS dt_integracao,
          SUM(COALESCE(qt_lote, 0))::FLOAT AS qtd_lote,
          SUM(GREATEST(COALESCE(qt_lote, 0) - COALESCE(qt_gerouop, 0), 0))::FLOAT AS qtd_aberto,
          SUM(COALESCE(qt_gerouop, 0))::FLOAT AS qtd_gerouop
        FROM snapshot_lotes
        WHERE data_snapshot = (SELECT MAX(data_snapshot) FROM snapshot_lotes WHERE DATE(data_snapshot) = DATE($1::TIMESTAMP))
          AND UPPER(TRIM(COALESCE(cd_auxiliar, ''))) = ANY($3::TEXT[])
          AND COALESCE(tp_situacao, 0) = 1
        GROUP BY cd_produto, UPPER(TRIM(COALESCE(cd_auxiliar, '')))
      ),
      snap_ate AS (
        SELECT
          cd_produto::BIGINT AS cd_produto,
          UPPER(TRIM(COALESCE(cd_auxiliar, ''))) AS periodo,
          MIN(nr_lote)::BIGINT AS nr_lote,
          MIN(dt_cadastro) AS dt_cadastro,
          MIN(dt_integracao) AS dt_integracao,
          SUM(COALESCE(qt_lote, 0))::FLOAT AS qtd_lote,
          SUM(GREATEST(COALESCE(qt_lote, 0) - COALESCE(qt_gerouop, 0), 0))::FLOAT AS qtd_aberto,
          SUM(COALESCE(qt_gerouop, 0))::FLOAT AS qtd_gerouop
        FROM snapshot_lotes
        WHERE data_snapshot = (SELECT MAX(data_snapshot) FROM snapshot_lotes WHERE DATE(data_snapshot) = DATE($2::TIMESTAMP))
          AND UPPER(TRIM(COALESCE(cd_auxiliar, ''))) = ANY($3::TEXT[])
          AND COALESCE(tp_situacao, 0) = 1
        GROUP BY cd_produto, UPPER(TRIM(COALESCE(cd_auxiliar, '')))
      ),
      diff AS (
        SELECT
          COALESCE(a.cd_produto, b.cd_produto) AS cd_produto,
          COALESCE(a.periodo, b.periodo) AS periodo,
          a.nr_lote AS nr_lote_de,
          b.nr_lote AS nr_lote_ate,
          a.dt_cadastro AS dt_cadastro_de,
          b.dt_cadastro AS dt_cadastro_ate,
          a.dt_integracao AS dt_integracao_de,
          b.dt_integracao AS dt_integracao_ate,
          COALESCE(a.qtd_lote, 0)::FLOAT AS qtd_lote_de,
          COALESCE(b.qtd_lote, 0)::FLOAT AS qtd_lote_ate,
          COALESCE(a.qtd_aberto, 0)::FLOAT AS qtd_aberto_de,
          COALESCE(b.qtd_aberto, 0)::FLOAT AS qtd_aberto_ate,
          COALESCE(a.qtd_gerouop, 0)::FLOAT AS qtd_gerouop_de,
          COALESCE(b.qtd_gerouop, 0)::FLOAT AS qtd_gerouop_ate
        FROM snap_de a
        FULL OUTER JOIN snap_ate b
          ON a.cd_produto = b.cd_produto
         AND a.periodo = b.periodo
      )
      SELECT
        d.*,
        (d.qtd_aberto_ate - d.qtd_aberto_de)::FLOAT AS delta_aberto,
        (d.qtd_lote_ate - d.qtd_lote_de)::FLOAT AS delta_lote,
        p.cd_seqgrupo::TEXT AS referencia,
        p.nm_produto AS produto,
        p.ds_cor AS cor,
        p.ds_tamanho AS tamanho,
        f_dic_prd_classificacao(d.cd_produto, 'DS'::text, 20::bigint) AS marca,
        f_dic_prd_classificacao(d.cd_produto, 'DS'::text, 27::bigint) AS status,
        f_dic_prd_classificacao(d.cd_produto, 'DS'::text, 22::bigint) AS linha,
        f_dic_prd_classificacao(d.cd_produto, 'DS'::text, 25::bigint) AS grupo
      FROM diff d
      LEFT JOIN vr_prd_prdgrade p ON p.cd_produto = d.cd_produto
      WHERE ($4::BOOLEAN = FALSE OR d.qtd_aberto_ate <> d.qtd_aberto_de OR d.qtd_lote_ate <> d.qtd_lote_de)
      ORDER BY ABS(d.qtd_aberto_ate - d.qtd_aberto_de) DESC, d.periodo, d.cd_produto
      LIMIT $5
    `, [snapshotDe, snapshotAte, periodos, apenasAlterados, limit]);

    const resumoPorPeriodo = {};
    const resumo = {
      itensAlterados: 0,
      adicionado: 0,
      retirado: 0,
      aumento: 0,
      reducao: 0,
      delta: 0,
      alertas: 0,
    };

    const rows = result.rows.map((row) => {
      const delta = Math.round(Number(row.delta_aberto || 0));
      const qtdDe = Math.round(Number(row.qtd_aberto_de || 0));
      const qtdAte = Math.round(Number(row.qtd_aberto_ate || 0));
      const tipo = tipoAlteracao(delta, qtdDe, qtdAte);
      const periodo = String(row.periodo || "");
      const dtIntegracao = row.dt_integracao_ate || row.dt_integracao_de || null;
      const dataVencida = dtIntegracao ? new Date(dtIntegracao).getTime() <= Date.now() : false;
      const periodoSensivel = periodo === "MA";
      const alerta = delta !== 0 && (periodoSensivel || dataVencida);
      const motivos = [];
      if (periodoSensivel) motivos.push("Alteracao no MA");
      if (dataVencida) motivos.push("Data de integracao vencida/hoje");
      if (qtdDe > 0 && qtdAte <= 0) motivos.push("Plano zerado/retirado");

      if (!resumoPorPeriodo[periodo]) {
        resumoPorPeriodo[periodo] = { periodo, itens: 0, adicionado: 0, retirado: 0, aumento: 0, reducao: 0, delta: 0, alertas: 0 };
      }
      const rp = resumoPorPeriodo[periodo];
      rp.itens += 1;
      rp.delta += delta;
      if (delta > 0) {
        rp.adicionado += tipo === "ADICIONADO" ? delta : 0;
        rp.aumento += delta;
      }
      if (delta < 0) {
        rp.retirado += tipo === "RETIRADO" ? Math.abs(delta) : 0;
        rp.reducao += Math.abs(delta);
      }
      if (alerta) rp.alertas += 1;

      resumo.itensAlterados += 1;
      resumo.delta += delta;
      if (delta > 0) {
        resumo.adicionado += tipo === "ADICIONADO" ? delta : 0;
        resumo.aumento += delta;
      }
      if (delta < 0) {
        resumo.retirado += tipo === "RETIRADO" ? Math.abs(delta) : 0;
        resumo.reducao += Math.abs(delta);
      }
      if (alerta) resumo.alertas += 1;

      return {
        cdProduto: String(row.cd_produto || ""),
        periodo,
        referencia: String(row.referencia || ""),
        produto: String(row.produto || ""),
        cor: String(row.cor || ""),
        tamanho: String(row.tamanho || ""),
        marca: String(row.marca || ""),
        status: String(row.status || ""),
        linha: String(row.linha || ""),
        grupo: String(row.grupo || ""),
        nrLoteDe: row.nr_lote_de ? String(row.nr_lote_de) : "",
        nrLoteAte: row.nr_lote_ate ? String(row.nr_lote_ate) : "",
        dtCadastroDe: row.dt_cadastro_de,
        dtCadastroAte: row.dt_cadastro_ate,
        dtIntegracaoDe: row.dt_integracao_de,
        dtIntegracaoAte: row.dt_integracao_ate,
        qtdAbertoDe: qtdDe,
        qtdAbertoAte: qtdAte,
        qtdLoteDe: Math.round(Number(row.qtd_lote_de || 0)),
        qtdLoteAte: Math.round(Number(row.qtd_lote_ate || 0)),
        deltaAberto: delta,
        deltaLote: Math.round(Number(row.delta_lote || 0)),
        tipo,
        alerta,
        motivos,
      };
    });

    return res.json({
      success: true,
      filtros: { dataDe, dataAte, periodos, apenasAlterados, limit },
      snapshots: { de: snapshotDe, ate: snapshotAte },
      resumo,
      porPeriodo: Object.values(resumoPorPeriodo).sort((a, b) => periodos.indexOf(a.periodo) - periodos.indexOf(b.periodo)),
      data: rows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao comparar snapshots do plano",
      details: error.message,
    });
  }
});

router.get("/snapshot-lotes/impacto", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const dataDe = req.query.de ? String(req.query.de).slice(0, 10) : null;
    const dataAte = req.query.ate ? String(req.query.ate).slice(0, 10) : null;
    const periodos = String(req.query.periodos || "MA,PX,UL,QT,QU")
      .split(",")
      .map((p) => p.trim().toUpperCase())
      .filter((p) => PERIODOS_PLANO.includes(p));
    const limit = Math.min(Number(req.query.limit) || 5000, 10000);

    const snapshotAte = await resolveSnapshotAt(pool, dataAte, 0);
    const snapshotDe = await resolveSnapshotAt(pool, dataDe, dataAte ? 1 : 1);

    if (!snapshotDe || !snapshotAte) {
      return res.status(404).json({
        success: false,
        error: "Snapshots insuficientes para analisar impacto",
      });
    }

    const baseDate = new Date(snapshotAte);
    const vendasInicio = addMonths(startOfMonth(baseDate), -3).toISOString().slice(0, 10);
    const dataDeSql = String(snapshotDe).slice(0, 10);
    const dataAteSql = String(snapshotAte).slice(0, 10);

    const result = await pool.query(`
      WITH RECURSIVE
      snap_de AS (
        SELECT
          cd_produto::BIGINT AS cd_produto,
          UPPER(TRIM(COALESCE(cd_auxiliar, ''))) AS periodo,
          MIN(nr_lote)::BIGINT AS nr_lote,
          MIN(dt_cadastro) AS dt_cadastro,
          MIN(dt_integracao) AS dt_integracao,
          SUM(COALESCE(qt_lote, 0))::FLOAT AS qtd_lote,
          SUM(GREATEST(COALESCE(qt_lote, 0) - COALESCE(qt_gerouop, 0), 0))::FLOAT AS qtd_aberto,
          SUM(COALESCE(qt_gerouop, 0))::FLOAT AS qtd_gerouop
        FROM snapshot_lotes
        WHERE data_snapshot = (SELECT MAX(data_snapshot) FROM snapshot_lotes WHERE DATE(data_snapshot) = DATE($1::TIMESTAMP))
          AND UPPER(TRIM(COALESCE(cd_auxiliar, ''))) = ANY($3::TEXT[])
          AND COALESCE(tp_situacao, 0) = 1
        GROUP BY cd_produto, UPPER(TRIM(COALESCE(cd_auxiliar, '')))
      ),
      snap_ate AS (
        SELECT
          cd_produto::BIGINT AS cd_produto,
          UPPER(TRIM(COALESCE(cd_auxiliar, ''))) AS periodo,
          MIN(nr_lote)::BIGINT AS nr_lote,
          MIN(dt_cadastro) AS dt_cadastro,
          MIN(dt_integracao) AS dt_integracao,
          SUM(COALESCE(qt_lote, 0))::FLOAT AS qtd_lote,
          SUM(GREATEST(COALESCE(qt_lote, 0) - COALESCE(qt_gerouop, 0), 0))::FLOAT AS qtd_aberto,
          SUM(COALESCE(qt_gerouop, 0))::FLOAT AS qtd_gerouop
        FROM snapshot_lotes
        WHERE data_snapshot = (SELECT MAX(data_snapshot) FROM snapshot_lotes WHERE DATE(data_snapshot) = DATE($2::TIMESTAMP))
          AND UPPER(TRIM(COALESCE(cd_auxiliar, ''))) = ANY($3::TEXT[])
          AND COALESCE(tp_situacao, 0) = 1
        GROUP BY cd_produto, UPPER(TRIM(COALESCE(cd_auxiliar, '')))
      ),
      diff AS (
        SELECT
          COALESCE(a.cd_produto, b.cd_produto) AS cd_produto,
          COALESCE(a.periodo, b.periodo) AS periodo,
          a.nr_lote AS nr_lote_de,
          b.nr_lote AS nr_lote_ate,
          a.dt_cadastro AS dt_cadastro_de,
          b.dt_cadastro AS dt_cadastro_ate,
          a.dt_integracao AS dt_integracao_de,
          b.dt_integracao AS dt_integracao_ate,
          COALESCE(a.qtd_lote, 0)::FLOAT AS qtd_lote_de,
          COALESCE(b.qtd_lote, 0)::FLOAT AS qtd_lote_ate,
          COALESCE(a.qtd_aberto, 0)::FLOAT AS qtd_aberto_de,
          COALESCE(b.qtd_aberto, 0)::FLOAT AS qtd_aberto_ate,
          COALESCE(a.qtd_gerouop, 0)::FLOAT AS qtd_gerouop_de,
          COALESCE(b.qtd_gerouop, 0)::FLOAT AS qtd_gerouop_ate
        FROM snap_de a
        FULL OUTER JOIN snap_ate b
          ON a.cd_produto = b.cd_produto
         AND a.periodo = b.periodo
      ),
      alteracoes_base AS (
        SELECT
          d.*,
          (d.qtd_aberto_ate - d.qtd_aberto_de)::FLOAT AS delta_aberto,
          (d.qtd_lote_ate - d.qtd_lote_de)::FLOAT AS delta_lote,
          (d.qtd_gerouop_ate - d.qtd_gerouop_de)::FLOAT AS delta_gerouop,
          p.cd_seqgrupo::TEXT AS referencia,
          p.nm_produto AS produto,
          p.ds_cor AS cor,
          p.ds_tamanho AS tamanho,
          f_dic_prd_classificacao(d.cd_produto, 'DS'::text, 20::bigint) AS marca,
          f_dic_prd_classificacao(d.cd_produto, 'DS'::text, 27::bigint) AS status,
          f_dic_prd_classificacao(d.cd_produto, 'DS'::text, 22::bigint) AS linha,
          f_dic_prd_classificacao(d.cd_produto, 'DS'::text, 25::bigint) AS grupo
        FROM diff d
        LEFT JOIN vr_prd_prdgrade p ON p.cd_produto = d.cd_produto
        WHERE d.qtd_aberto_ate <> d.qtd_aberto_de
           OR d.qtd_lote_ate <> d.qtd_lote_de
           OR d.qtd_gerouop_ate <> d.qtd_gerouop_de
      ),
      alteracoes AS (
        SELECT *
        FROM alteracoes_base
        ORDER BY ABS(delta_aberto) DESC, periodo, cd_produto
        LIMIT $4
      ),
      expl AS (
        SELECT
          a.cd_produto::TEXT AS root_id,
          a.periodo,
          c.cd_produtomp::TEXT AS child_id,
          (a.delta_aberto * COALESCE(c.qt_consumo, 0))::FLOAT AS delta_consumo,
          1 AS depth,
          ARRAY[a.cd_produto::TEXT, c.cd_produtomp::TEXT] AS path
        FROM alteracoes a
        JOIN public.vr_pcp_fcconsumo c ON c.cd_produtopa::TEXT = a.cd_produto::TEXT
        WHERE a.delta_aberto <> 0
          AND COALESCE(c.qt_consumo, 0) > 0

        UNION ALL

        SELECT
          e.root_id,
          e.periodo,
          c.cd_produtomp::TEXT AS child_id,
          (e.delta_consumo * COALESCE(c.qt_consumo, 0))::FLOAT AS delta_consumo,
          e.depth + 1 AS depth,
          e.path || c.cd_produtomp::TEXT
        FROM expl e
        JOIN public.vr_pcp_fcconsumo c ON c.cd_produtopa::TEXT = e.child_id
        WHERE e.depth < 8
          AND COALESCE(c.qt_consumo, 0) > 0
          AND NOT c.cd_produtomp::TEXT = ANY(e.path)
      ),
      mp_delta AS (
        SELECT
          child_id AS idmateriaprima,
          SUM(delta_consumo) FILTER (WHERE periodo = 'MA')::FLOAT AS delta_ma,
          SUM(delta_consumo) FILTER (WHERE periodo = 'PX')::FLOAT AS delta_px,
          SUM(delta_consumo) FILTER (WHERE periodo = 'UL')::FLOAT AS delta_ul,
          SUM(delta_consumo) FILTER (WHERE periodo = 'QT')::FLOAT AS delta_qt,
          SUM(delta_consumo) FILTER (WHERE periodo = 'QU')::FLOAT AS delta_qu,
          SUM(delta_consumo)::FLOAT AS delta_consumo_total,
          SUM(CASE WHEN delta_consumo > 0 THEN delta_consumo ELSE 0 END)::FLOAT AS aumento_consumo,
          ABS(SUM(CASE WHEN delta_consumo < 0 THEN delta_consumo ELSE 0 END))::FLOAT AS reducao_consumo,
          COUNT(DISTINCT root_id)::INT AS skus_impactados
        FROM expl
        GROUP BY child_id
      ),
      mp_candidatas AS (
        SELECT idmateriaprima FROM mp_delta
      ),
      estoque AS (
        SELECT
          a.cd_produto::TEXT AS idmateriaprima,
          MAX(COALESCE(a.nm_produto, ''))::TEXT AS nome_materiaprima,
          MAX(COALESCE(f_dic_prd_nivel(a.cd_produto, 'DS'::bpchar), ''))::TEXT AS materia_prima_ds,
          MAX(COALESCE(f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 111::bigint), ''))::TEXT AS artigo,
          MAX(COALESCE(a.ds_cor, ''))::TEXT AS cor_mp,
          MAX(COALESCE(f_dic_sld_prd_produto('1', '1'::text, a.cd_produto, NULL::timestamp), 0))::FLOAT AS estoquefisico,
          MAX(COALESCE(f_dic_sld_prd_produto('1', '2'::text, a.cd_produto, NULL::timestamp), 0))::FLOAT AS estoqueinsp,
          MAX(COALESCE(f_dic_sld_prd_produto('1', '15'::text, a.cd_produto, NULL::timestamp), 0))::FLOAT AS estoquecorte
        FROM public.vr_prd_prdgrade a
        JOIN mp_candidatas m ON m.idmateriaprima = a.cd_produto::TEXT
        GROUP BY a.cd_produto
      ),
      compras_pendentes AS (
        SELECT
          i.cd_produto::TEXT AS idmateriaprima,
          SUM(COALESCE(i.qt_pendente, 0))::FLOAT AS compras_pendentes_total,
          JSONB_AGG(JSONB_BUILD_OBJECT(
            'empresa', c.cd_empresa,
            'pedido', c.cd_pedido,
            'data', COALESCE(i.dt_preventrega::date, c.dt_preventrega::date),
            'quantidade', COALESCE(i.qt_pendente, 0)
          ) ORDER BY COALESCE(i.dt_preventrega::date, c.dt_preventrega::date), c.cd_pedido) AS compras_pendentes_detalhe
        FROM public.vr_cmp_pedidoc2 c
        JOIN public.vr_cmp_pedidoi i
          ON i.cd_empresa = c.cd_empresa
         AND i.cd_pedido = c.cd_pedido
        JOIN mp_candidatas m ON m.idmateriaprima = i.cd_produto::TEXT
        WHERE c.tp_situacao = ANY (ARRAY[1::bigint, 3::bigint])
          AND COALESCE(i.qt_pendente, 0) > 0
        GROUP BY i.cd_produto
      ),
      compras_finalizadas AS (
        SELECT
          i.cd_produto::TEXT AS idmateriaprima,
          SUM(COALESCE(i.qt_atendida, 0))::FLOAT AS compras_finalizadas_total,
          SUM(COALESCE(i.vl_atendido, 0))::FLOAT AS valor_finalizado_total,
          JSONB_AGG(JSONB_BUILD_OBJECT(
            'empresa', c.cd_empresa,
            'pedido', c.cd_pedido,
            'data', COALESCE(i.dt_ultentrega, c.dt_ultentrega, i.dt_ultaltped)::date,
            'quantidade', COALESCE(i.qt_atendida, 0),
            'valor', COALESCE(i.vl_atendido, 0)
          ) ORDER BY COALESCE(i.dt_ultentrega, c.dt_ultentrega, i.dt_ultaltped), c.cd_pedido) AS compras_finalizadas_detalhe
        FROM public.vr_cmp_pedidoc2 c
        JOIN public.vr_cmp_pedidoi i
          ON i.cd_empresa = c.cd_empresa
         AND i.cd_pedido = c.cd_pedido
        JOIN mp_candidatas m ON m.idmateriaprima = i.cd_produto::TEXT
        WHERE COALESCE(i.qt_atendida, 0) > 0
          AND COALESCE(i.dt_ultentrega, c.dt_ultentrega, i.dt_ultaltped)::date >= $4::date
          AND COALESCE(i.dt_ultentrega, c.dt_ultentrega, i.dt_ultaltped)::date <= $5::date
        GROUP BY i.cd_produto
      ),
      vendas AS (
        SELECT
          v.idproduto::BIGINT AS cd_produto,
          SUM(v.qt_liquida) FILTER (WHERE v.data >= $6::date)::FLOAT AS venda_90d,
          SUM(v.qt_liquida) FILTER (WHERE v.data::date >= $4::date AND v.data::date <= $5::date)::FLOAT AS venda_periodo,
          MAX(v.data)::DATE AS ultima_venda
        FROM vr_vendas_qtd v
        JOIN (SELECT DISTINCT cd_produto FROM alteracoes) a ON a.cd_produto = v.idproduto::BIGINT
        WHERE v.data >= $6::date
        GROUP BY v.idproduto
      ),
      alteracoes_vendas AS (
        SELECT
          a.*,
          COALESCE(v.venda_90d, 0)::FLOAT AS venda_90d,
          COALESCE(v.venda_periodo, 0)::FLOAT AS venda_periodo,
          v.ultima_venda
        FROM alteracoes a
        LEFT JOIN vendas v ON v.cd_produto = a.cd_produto
      ),
      mp_rows AS (
        SELECT
          md.*,
          COALESCE(NULLIF(e.materia_prima_ds, ''), e.nome_materiaprima, md.idmateriaprima)::TEXT AS nome_materiaprima,
          COALESCE(e.artigo, '')::TEXT AS artigo,
          COALESCE(e.cor_mp, '')::TEXT AS cor,
          COALESCE(e.estoquefisico, 0)::FLOAT AS estoquefisico,
          COALESCE(e.estoqueinsp, 0)::FLOAT AS estoqueinsp,
          COALESCE(e.estoquecorte, 0)::FLOAT AS estoquecorte,
          (COALESCE(e.estoquefisico, 0) + COALESCE(e.estoqueinsp, 0) + COALESCE(e.estoquecorte, 0))::FLOAT AS estoquetotal,
          COALESCE(cp.compras_pendentes_total, 0)::FLOAT AS compras_pendentes_total,
          COALESCE(cp.compras_pendentes_detalhe, '[]'::JSONB) AS compras_pendentes_detalhe,
          COALESCE(cf.compras_finalizadas_total, 0)::FLOAT AS compras_finalizadas_total,
          COALESCE(cf.valor_finalizado_total, 0)::FLOAT AS valor_finalizado_total,
          COALESCE(cf.compras_finalizadas_detalhe, '[]'::JSONB) AS compras_finalizadas_detalhe
        FROM mp_delta md
        LEFT JOIN estoque e ON e.idmateriaprima = md.idmateriaprima
        LEFT JOIN compras_pendentes cp ON cp.idmateriaprima = md.idmateriaprima
        LEFT JOIN compras_finalizadas cf ON cf.idmateriaprima = md.idmateriaprima
      )
      SELECT
        COALESCE((
          SELECT JSONB_AGG(TO_JSONB(av) ORDER BY ABS(av.delta_aberto) DESC, av.periodo, av.cd_produto)
          FROM (SELECT * FROM alteracoes_vendas LIMIT $7) av
        ), '[]'::JSONB) AS alteracoes,
        COALESCE((
          SELECT JSONB_AGG(TO_JSONB(mr) ORDER BY ABS(mr.delta_consumo_total) DESC, mr.idmateriaprima)
          FROM (SELECT * FROM mp_rows LIMIT $7) mr
        ), '[]'::JSONB) AS impacto_mp
    `, [snapshotDe, snapshotAte, periodos, dataDeSql, dataAteSql, vendasInicio, limit]);

    const alteracoesRaw = Array.isArray(result.rows?.[0]?.alteracoes) ? result.rows[0].alteracoes : [];
    const impactoMpRaw = Array.isArray(result.rows?.[0]?.impacto_mp) ? result.rows[0].impacto_mp : [];

    const resumo = {
      itensAlterados: 0,
      aumentoPecas: 0,
      reducaoPecas: 0,
      deltaPecas: 0,
      planoTotalDelta: 0,
      gerouOpDelta: 0,
      alertas: 0,
      skusComVendaAlterados: 0,
      mpsImpactadas: impactoMpRaw.length,
      mpsFaltaGerada: 0,
      mpsCompraPodeSobrar: 0,
      aumentoConsumoMp: 0,
      reducaoConsumoMp: 0,
    };
    const porPeriodo = {};

    const alteracoes = alteracoesRaw.map((row) => {
      const delta = Math.round(Number(row.delta_aberto || 0));
      const deltaLote = Math.round(Number(row.delta_lote || 0));
      const qtdDe = Math.round(Number(row.qtd_aberto_de || 0));
      const qtdAte = Math.round(Number(row.qtd_aberto_ate || 0));
      const tipo = tipoAlteracao(delta, qtdDe, qtdAte);
      const periodo = String(row.periodo || "");
      const dtIntegracao = row.dt_integracao_ate || row.dt_integracao_de || null;
      const dataVencida = dtIntegracao ? new Date(dtIntegracao).getTime() <= baseDate.getTime() : false;
      const venda90 = Number(row.venda_90d || 0);
      const planoDepois = Math.round(Number(row.qtd_lote_ate || 0));
      const motivos = [];
      if (periodo === "MA") motivos.push("Alteracao no MA");
      if (dataVencida) motivos.push("Data de integracao vencida/hoje");
      if (qtdDe > 0 && qtdAte <= 0) motivos.push("Plano aberto zerado/retirado");
      if (delta < 0 && venda90 > 0) motivos.push("Reducao em SKU com venda recente");
      if (planoDepois < venda90 / 3 && venda90 > 0) motivos.push("Plano abaixo da media mensal 90d");
      const alerta = motivos.length > 0;

      if (!porPeriodo[periodo]) {
        porPeriodo[periodo] = {
          periodo,
          mes: periodoParaMes(periodo, baseDate),
          itens: 0,
          aumento: 0,
          reducao: 0,
          delta: 0,
          deltaLote: 0,
          alertas: 0,
        };
      }
      const rp = porPeriodo[periodo];
      rp.itens += 1;
      rp.delta += delta;
      rp.deltaLote += deltaLote;
      if (delta > 0) rp.aumento += delta;
      if (delta < 0) rp.reducao += Math.abs(delta);
      if (alerta) rp.alertas += 1;

      resumo.itensAlterados += 1;
      resumo.deltaPecas += delta;
      resumo.planoTotalDelta += deltaLote;
      resumo.gerouOpDelta += Math.round(Number(row.delta_gerouop || 0));
      if (delta > 0) resumo.aumentoPecas += delta;
      if (delta < 0) resumo.reducaoPecas += Math.abs(delta);
      if (alerta) resumo.alertas += 1;
      if (venda90 > 0) resumo.skusComVendaAlterados += 1;

      return {
        cdProduto: String(row.cd_produto || ""),
        periodo,
        mes: periodoParaMes(periodo, baseDate),
        referencia: String(row.referencia || ""),
        produto: String(row.produto || ""),
        cor: String(row.cor || ""),
        tamanho: String(row.tamanho || ""),
        marca: String(row.marca || ""),
        status: String(row.status || ""),
        linha: String(row.linha || ""),
        grupo: String(row.grupo || ""),
        nrLoteDe: row.nr_lote_de ? String(row.nr_lote_de) : "",
        nrLoteAte: row.nr_lote_ate ? String(row.nr_lote_ate) : "",
        dtCadastroDe: row.dt_cadastro_de,
        dtCadastroAte: row.dt_cadastro_ate,
        dtIntegracaoDe: row.dt_integracao_de,
        dtIntegracaoAte: row.dt_integracao_ate,
        qtdAbertoDe: qtdDe,
        qtdAbertoAte: qtdAte,
        qtdLoteDe: Math.round(Number(row.qtd_lote_de || 0)),
        qtdLoteAte: Math.round(Number(row.qtd_lote_ate || 0)),
        qtdGerouOpDe: Math.round(Number(row.qtd_gerouop_de || 0)),
        qtdGerouOpAte: Math.round(Number(row.qtd_gerouop_ate || 0)),
        deltaAberto: delta,
        deltaLote,
        deltaGerouOp: Math.round(Number(row.delta_gerouop || 0)),
        venda90d: Math.round(venda90),
        vendaPeriodo: Math.round(Number(row.venda_periodo || 0)),
        ultimaVenda: row.ultima_venda,
        tipo,
        alerta,
        motivos,
      };
    });

    const impactoMp = impactoMpRaw.map((row) => {
      const risco = classificarRiscoMp(row);
      const aumentoConsumo = Number(row.aumento_consumo || 0);
      const reducaoConsumo = Number(row.reducao_consumo || 0);
      resumo.aumentoConsumoMp += aumentoConsumo;
      resumo.reducaoConsumoMp += reducaoConsumo;
      if (risco === "FALTA_GERADA") resumo.mpsFaltaGerada += 1;
      if (risco === "COMPRA_PODE_SOBRAR") resumo.mpsCompraPodeSobrar += 1;

      return {
        idmateriaprima: String(row.idmateriaprima || ""),
        nome: String(row.nome_materiaprima || ""),
        artigo: String(row.artigo || ""),
        cor: String(row.cor || ""),
        deltaMa: Number(row.delta_ma || 0),
        deltaPx: Number(row.delta_px || 0),
        deltaUl: Number(row.delta_ul || 0),
        deltaQt: Number(row.delta_qt || 0),
        deltaQu: Number(row.delta_qu || 0),
        deltaTotal: Number(row.delta_consumo_total || 0),
        aumentoConsumo,
        reducaoConsumo,
        skusImpactados: Number(row.skus_impactados || 0),
        estoquetotal: Number(row.estoquetotal || 0),
        comprasPendentes: Number(row.compras_pendentes_total || 0),
        comprasFinalizadas: Number(row.compras_finalizadas_total || 0),
        valorFinalizado: Number(row.valor_finalizado_total || 0),
        risco,
        tipo: impactoTipoMp(Number(row.delta_consumo_total || 0)),
        comprasPendentesDetalhe: Array.isArray(row.compras_pendentes_detalhe) ? row.compras_pendentes_detalhe.slice(0, 8) : [],
        comprasFinalizadasDetalhe: Array.isArray(row.compras_finalizadas_detalhe) ? row.compras_finalizadas_detalhe.slice(0, 8) : [],
      };
    });

    const diagnosticos = [
      {
        tipo: "MP_FALTA_GERADA",
        severidade: "alta",
        titulo: "MP pode faltar por aumento de plano",
        quantidade: resumo.mpsFaltaGerada,
      },
      {
        tipo: "MP_COMPRA_PODE_SOBRAR",
        severidade: "media",
        titulo: "Compra de MP pode sobrar por reducao de plano",
        quantidade: resumo.mpsCompraPodeSobrar,
      },
      {
        tipo: "ALTERACAO_PERIODO_SENSIVEL",
        severidade: "alta",
        titulo: "Alteracoes em MA/data vencida/SKU com venda",
        quantidade: resumo.alertas,
      },
    ];

    return res.json({
      success: true,
      filtros: { dataDe, dataAte, periodos, limit },
      snapshots: { de: snapshotDe, ate: snapshotAte },
      meses: Object.fromEntries(PERIODOS_PLANO.map((p) => [p, periodoParaMes(p, baseDate)])),
      resumo,
      porPeriodo: Object.values(porPeriodo).sort((a, b) => PERIODOS_PLANO.indexOf(a.periodo) - PERIODOS_PLANO.indexOf(b.periodo)),
      diagnosticos,
      alteracoes,
      impactoMp,
    });
  } catch (error) {
    console.error("[snapshot-lotes/impacto] Erro:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao analisar impacto dos snapshots",
      details: error.message,
    });
  }
});

router.get("/snapshot-lotes/impacto-rapido", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const dataDe = req.query.de ? String(req.query.de).slice(0, 10) : null;
    const dataAte = req.query.ate ? String(req.query.ate).slice(0, 10) : null;
    const periodos = String(req.query.periodos || "MA,PX,UL,QT,QU")
      .split(",")
      .map((p) => p.trim().toUpperCase())
      .filter((p) => PERIODOS_PLANO.includes(p));
    const limit = Math.min(Number(req.query.limit) || 1000, 2000);

    const snapshotAte = await resolveSnapshotAt(pool, dataAte, 0);
    const snapshotDe = await resolveSnapshotAt(pool, dataDe, dataAte ? 1 : 1);
    if (!snapshotDe || !snapshotAte) {
      return res.status(404).json({ success: false, error: "Snapshots insuficientes para analisar impacto" });
    }

    const baseDate = new Date(snapshotAte);
    const dataDeSql = String(snapshotDe).slice(0, 10);
    const dataAteSql = String(snapshotAte).slice(0, 10);
    const vendasInicio = addMonths(startOfMonth(baseDate), -3).toISOString().slice(0, 10);

    const alteracoesResult = await pool.query(`
      WITH snapshots AS (
        SELECT
          MAX(data_snapshot) FILTER (WHERE DATE(data_snapshot) = $1::DATE) AS snap_de,
          MAX(data_snapshot) FILTER (WHERE DATE(data_snapshot) = $2::DATE) AS snap_ate
        FROM snapshot_lotes
        WHERE DATE(data_snapshot) IN ($1::DATE, $2::DATE)
      ),
      snap_de AS (
        SELECT
          cd_produto::BIGINT AS cd_produto,
          UPPER(TRIM(COALESCE(cd_auxiliar, ''))) AS periodo,
          MIN(nr_lote)::BIGINT AS nr_lote,
          MIN(dt_cadastro) AS dt_cadastro,
          MIN(dt_integracao) AS dt_integracao,
          SUM(COALESCE(qt_lote, 0))::FLOAT AS qtd_lote,
          SUM(GREATEST(COALESCE(qt_lote, 0) - COALESCE(qt_gerouop, 0), 0))::FLOAT AS qtd_aberto,
          SUM(COALESCE(qt_gerouop, 0))::FLOAT AS qtd_gerouop
        FROM snapshot_lotes s
        CROSS JOIN snapshots x
        WHERE s.data_snapshot = x.snap_de
          AND UPPER(TRIM(COALESCE(cd_auxiliar, ''))) = ANY($3::TEXT[])
          AND COALESCE(tp_situacao, 0) = 1
        GROUP BY cd_produto, UPPER(TRIM(COALESCE(cd_auxiliar, '')))
      ),
      snap_ate AS (
        SELECT
          cd_produto::BIGINT AS cd_produto,
          UPPER(TRIM(COALESCE(cd_auxiliar, ''))) AS periodo,
          MIN(nr_lote)::BIGINT AS nr_lote,
          MIN(dt_cadastro) AS dt_cadastro,
          MIN(dt_integracao) AS dt_integracao,
          SUM(COALESCE(qt_lote, 0))::FLOAT AS qtd_lote,
          SUM(GREATEST(COALESCE(qt_lote, 0) - COALESCE(qt_gerouop, 0), 0))::FLOAT AS qtd_aberto,
          SUM(COALESCE(qt_gerouop, 0))::FLOAT AS qtd_gerouop
        FROM snapshot_lotes s
        CROSS JOIN snapshots x
        WHERE s.data_snapshot = x.snap_ate
          AND UPPER(TRIM(COALESCE(cd_auxiliar, ''))) = ANY($3::TEXT[])
          AND COALESCE(tp_situacao, 0) = 1
        GROUP BY cd_produto, UPPER(TRIM(COALESCE(cd_auxiliar, '')))
      ),
      diff AS (
        SELECT
          COALESCE(a.cd_produto, b.cd_produto) AS cd_produto,
          COALESCE(a.periodo, b.periodo) AS periodo,
          a.nr_lote AS nr_lote_de,
          b.nr_lote AS nr_lote_ate,
          a.dt_cadastro AS dt_cadastro_de,
          b.dt_cadastro AS dt_cadastro_ate,
          a.dt_integracao AS dt_integracao_de,
          b.dt_integracao AS dt_integracao_ate,
          COALESCE(a.qtd_lote, 0)::FLOAT AS qtd_lote_de,
          COALESCE(b.qtd_lote, 0)::FLOAT AS qtd_lote_ate,
          COALESCE(a.qtd_aberto, 0)::FLOAT AS qtd_aberto_de,
          COALESCE(b.qtd_aberto, 0)::FLOAT AS qtd_aberto_ate,
          COALESCE(a.qtd_gerouop, 0)::FLOAT AS qtd_gerouop_de,
          COALESCE(b.qtd_gerouop, 0)::FLOAT AS qtd_gerouop_ate
        FROM snap_de a
        FULL OUTER JOIN snap_ate b
          ON a.cd_produto = b.cd_produto
         AND a.periodo = b.periodo
      ),
      alteracoes_base AS (
        SELECT
          d.*,
          (d.qtd_aberto_ate - d.qtd_aberto_de)::FLOAT AS delta_aberto,
          (d.qtd_lote_ate - d.qtd_lote_de)::FLOAT AS delta_lote,
          (d.qtd_gerouop_ate - d.qtd_gerouop_de)::FLOAT AS delta_gerouop
        FROM diff d
        WHERE d.qtd_aberto_ate <> d.qtd_aberto_de
           OR d.qtd_lote_ate <> d.qtd_lote_de
           OR d.qtd_gerouop_ate <> d.qtd_gerouop_de
      ),
      alteracoes_limited AS (
        SELECT *
        FROM alteracoes_base
        ORDER BY ABS(delta_aberto) DESC, periodo, cd_produto
        LIMIT $4
      ),
      alteracoes AS (
        SELECT
          d.*,
          p.cd_seqgrupo::TEXT AS referencia,
          p.nm_produto AS produto,
          p.ds_cor AS cor,
          p.ds_tamanho AS tamanho,
          f_dic_prd_classificacao(d.cd_produto, 'DS'::text, 20::bigint) AS marca,
          f_dic_prd_classificacao(d.cd_produto, 'DS'::text, 27::bigint) AS status,
          f_dic_prd_classificacao(d.cd_produto, 'DS'::text, 22::bigint) AS linha,
          f_dic_prd_classificacao(d.cd_produto, 'DS'::text, 25::bigint) AS grupo
        FROM alteracoes_limited d
        LEFT JOIN vr_prd_prdgrade p ON p.cd_produto = d.cd_produto
      )
      SELECT a.*, 0::FLOAT AS venda_90d, 0::FLOAT AS venda_periodo, NULL::DATE AS ultima_venda
      FROM alteracoes a
      ORDER BY ABS(a.delta_aberto) DESC, a.periodo, a.cd_produto
      LIMIT $4
    `, [dataDeSql, dataAteSql, periodos, limit]);

    const resumo = {
      itensAlterados: 0,
      aumentoPecas: 0,
      reducaoPecas: 0,
      deltaPecas: 0,
      planoTotalDelta: 0,
      gerouOpDelta: 0,
      alertas: 0,
      skusComVendaAlterados: 0,
      mpsImpactadas: 0,
      mpsFaltaGerada: 0,
      mpsCompraPodeSobrar: 0,
      aumentoConsumoMp: 0,
      reducaoConsumoMp: 0,
    };
    const porPeriodo = {};

    const alteracoes = alteracoesResult.rows.map((row) => {
      const delta = Math.round(Number(row.delta_aberto || 0));
      const deltaLote = Math.round(Number(row.delta_lote || 0));
      const qtdDe = Math.round(Number(row.qtd_aberto_de || 0));
      const qtdAte = Math.round(Number(row.qtd_aberto_ate || 0));
      const tipo = tipoAlteracao(delta, qtdDe, qtdAte);
      const periodo = String(row.periodo || "");
      const dtIntegracao = row.dt_integracao_ate || row.dt_integracao_de || null;
      const dataVencida = dtIntegracao ? new Date(dtIntegracao).getTime() <= baseDate.getTime() : false;
      const venda90 = Number(row.venda_90d || 0);
      const planoDepois = Math.round(Number(row.qtd_lote_ate || 0));
      const motivos = [];
      if (periodo === "MA") motivos.push("Alteracao no MA");
      if (dataVencida) motivos.push("Data de integracao vencida/hoje");
      if (qtdDe > 0 && qtdAte <= 0) motivos.push("Plano aberto zerado/retirado");
      if (delta < 0 && venda90 > 0) motivos.push("Reducao em SKU com venda recente");
      if (planoDepois < venda90 / 3 && venda90 > 0) motivos.push("Plano abaixo da media mensal 90d");
      const alerta = motivos.length > 0;

      if (!porPeriodo[periodo]) {
        porPeriodo[periodo] = { periodo, mes: periodoParaMes(periodo, baseDate), itens: 0, aumento: 0, reducao: 0, delta: 0, deltaLote: 0, alertas: 0 };
      }
      const rp = porPeriodo[periodo];
      rp.itens += 1;
      rp.delta += delta;
      rp.deltaLote += deltaLote;
      if (delta > 0) rp.aumento += delta;
      if (delta < 0) rp.reducao += Math.abs(delta);
      if (alerta) rp.alertas += 1;

      resumo.itensAlterados += 1;
      resumo.deltaPecas += delta;
      resumo.planoTotalDelta += deltaLote;
      resumo.gerouOpDelta += Math.round(Number(row.delta_gerouop || 0));
      if (delta > 0) resumo.aumentoPecas += delta;
      if (delta < 0) resumo.reducaoPecas += Math.abs(delta);
      if (alerta) resumo.alertas += 1;
      if (venda90 > 0) resumo.skusComVendaAlterados += 1;

      return {
        cdProduto: String(row.cd_produto || ""),
        periodo,
        mes: periodoParaMes(periodo, baseDate),
        referencia: String(row.referencia || ""),
        produto: String(row.produto || ""),
        cor: String(row.cor || ""),
        tamanho: String(row.tamanho || ""),
        marca: String(row.marca || ""),
        status: String(row.status || ""),
        linha: String(row.linha || ""),
        grupo: String(row.grupo || ""),
        nrLoteDe: row.nr_lote_de ? String(row.nr_lote_de) : "",
        nrLoteAte: row.nr_lote_ate ? String(row.nr_lote_ate) : "",
        dtCadastroDe: row.dt_cadastro_de,
        dtCadastroAte: row.dt_cadastro_ate,
        dtIntegracaoDe: row.dt_integracao_de,
        dtIntegracaoAte: row.dt_integracao_ate,
        qtdAbertoDe: qtdDe,
        qtdAbertoAte: qtdAte,
        qtdLoteDe: Math.round(Number(row.qtd_lote_de || 0)),
        qtdLoteAte: Math.round(Number(row.qtd_lote_ate || 0)),
        qtdGerouOpDe: Math.round(Number(row.qtd_gerouop_de || 0)),
        qtdGerouOpAte: Math.round(Number(row.qtd_gerouop_ate || 0)),
        deltaAberto: delta,
        deltaLote,
        deltaGerouOp: Math.round(Number(row.delta_gerouop || 0)),
        venda90d: Math.round(venda90),
        vendaPeriodo: Math.round(Number(row.venda_periodo || 0)),
        ultimaVenda: row.ultima_venda,
        tipo,
        alerta,
        motivos,
      };
    });

    const demandas = alteracoes
      .filter((a) => Number(a.deltaAberto || 0) !== 0)
      .map((a) => ({ parent: a.cdProduto, periodo: a.periodo, delta: Number(a.deltaAberto || 0), path: [a.cdProduto] }));
    const mpMap = new Map();
    let frontier = demandas;
    for (let depth = 1; depth <= 6 && frontier.length; depth += 1) {
      const ids = Array.from(new Set(frontier.map((d) => d.parent).filter(Boolean)));
      const edges = [];
      for (const batch of chunkArray(ids, 500)) {
        edges.push(...await queryBomPorPais(pool, batch));
      }
      const byParent = new Map();
      for (const edge of edges) {
        const parent = String(edge.parent_id || "");
        if (!byParent.has(parent)) byParent.set(parent, []);
        byParent.get(parent).push(edge);
      }
      const next = [];
      for (const dem of frontier) {
        for (const edge of byParent.get(dem.parent) || []) {
          const child = String(edge.child_id || "");
          const fator = Number(edge.fator || 0);
          if (!child || fator <= 0 || dem.path.includes(child)) continue;
          const delta = dem.delta * fator;
          if (!mpMap.has(child)) {
            mpMap.set(child, { idmateriaprima: child, delta_ma: 0, delta_px: 0, delta_ul: 0, delta_qt: 0, delta_qu: 0, roots: new Set() });
          }
          const acc = mpMap.get(child);
          const key = `delta_${String(dem.periodo || "").toLowerCase()}`;
          if (key in acc) acc[key] += delta;
          acc.roots.add(dem.path[0]);
          next.push({ parent: child, periodo: dem.periodo, delta, path: [...dem.path, child] });
        }
      }
      frontier = next;
    }

    const mpBase = Array.from(mpMap.values()).map((m) => {
      const total = Number(m.delta_ma || 0) + Number(m.delta_px || 0) + Number(m.delta_ul || 0) + Number(m.delta_qt || 0) + Number(m.delta_qu || 0);
      return {
        ...m,
        delta_consumo_total: total,
        aumento_consumo: Math.max(0, total),
        reducao_consumo: Math.abs(Math.min(0, total)),
        skus_impactados: m.roots.size,
      };
    }).sort((a, b) => Math.abs(b.delta_consumo_total) - Math.abs(a.delta_consumo_total)).slice(0, limit);

    const idsMp = mpBase.map((m) => m.idmateriaprima);
    let detalhesMap = new Map();
    if (idsMp.length) {
      const [estoqueRows, pendentesRows, finalizadasRows] = await Promise.all([
        pool.query(`
          SELECT
            a.cd_produto::TEXT AS idmateriaprima,
            MAX(COALESCE(a.nm_produto, ''))::TEXT AS nome_materiaprima,
            MAX(COALESCE(f_dic_prd_nivel(a.cd_produto, 'DS'::bpchar), ''))::TEXT AS materia_prima_ds,
            MAX(COALESCE(f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 111::bigint), ''))::TEXT AS artigo,
            MAX(COALESCE(a.ds_cor, ''))::TEXT AS cor,
            MAX(COALESCE(f_dic_sld_prd_produto('1', '1'::text, a.cd_produto, NULL::timestamp), 0))::FLOAT AS estoquefisico,
            MAX(COALESCE(f_dic_sld_prd_produto('1', '2'::text, a.cd_produto, NULL::timestamp), 0))::FLOAT AS estoqueinsp,
            MAX(COALESCE(f_dic_sld_prd_produto('1', '15'::text, a.cd_produto, NULL::timestamp), 0))::FLOAT AS estoquecorte
          FROM public.vr_prd_prdgrade a
          WHERE a.cd_produto::TEXT = ANY($1::TEXT[])
          GROUP BY a.cd_produto
        `, [idsMp]),
        pool.query(`
          SELECT i.cd_produto::TEXT AS idmateriaprima, SUM(COALESCE(i.qt_pendente, 0))::FLOAT AS compras_pendentes_total
          FROM public.vr_cmp_pedidoc2 c
          JOIN public.vr_cmp_pedidoi i ON i.cd_empresa = c.cd_empresa AND i.cd_pedido = c.cd_pedido
          WHERE c.tp_situacao = ANY (ARRAY[1::bigint, 3::bigint])
            AND i.cd_produto::TEXT = ANY($1::TEXT[])
            AND COALESCE(i.qt_pendente, 0) > 0
          GROUP BY i.cd_produto
        `, [idsMp]),
        pool.query(`
          SELECT i.cd_produto::TEXT AS idmateriaprima,
                 SUM(COALESCE(i.qt_atendida, 0))::FLOAT AS compras_finalizadas_total,
                 SUM(COALESCE(i.vl_atendido, 0))::FLOAT AS valor_finalizado_total
          FROM public.vr_cmp_pedidoc2 c
          JOIN public.vr_cmp_pedidoi i ON i.cd_empresa = c.cd_empresa AND i.cd_pedido = c.cd_pedido
          WHERE i.cd_produto::TEXT = ANY($1::TEXT[])
            AND COALESCE(i.qt_atendida, 0) > 0
            AND COALESCE(i.dt_ultentrega, c.dt_ultentrega, i.dt_ultaltped)::DATE >= $2::DATE
            AND COALESCE(i.dt_ultentrega, c.dt_ultentrega, i.dt_ultaltped)::DATE <= $3::DATE
          GROUP BY i.cd_produto
        `, [idsMp, dataDeSql, dataAteSql]),
      ]);
      detalhesMap = new Map(estoqueRows.rows.map((r) => [String(r.idmateriaprima || ""), { ...r }]));
      for (const row of pendentesRows.rows) {
        const id = String(row.idmateriaprima || "");
        detalhesMap.set(id, { ...(detalhesMap.get(id) || {}), ...row });
      }
      for (const row of finalizadasRows.rows) {
        const id = String(row.idmateriaprima || "");
        detalhesMap.set(id, { ...(detalhesMap.get(id) || {}), ...row });
      }
    }

    const impactoMp = mpBase.map((m) => {
      const d = detalhesMap.get(m.idmateriaprima) || {};
      const estoquetotal = Number(d.estoquefisico || 0) + Number(d.estoqueinsp || 0) + Number(d.estoquecorte || 0);
      const row = {
        ...m,
        estoquetotal,
        compras_pendentes_total: Number(d.compras_pendentes_total || 0),
        compras_finalizadas_total: Number(d.compras_finalizadas_total || 0),
      };
      const risco = classificarRiscoMp(row);
      resumo.aumentoConsumoMp += Number(m.aumento_consumo || 0);
      resumo.reducaoConsumoMp += Number(m.reducao_consumo || 0);
      if (risco === "FALTA_GERADA") resumo.mpsFaltaGerada += 1;
      if (risco === "COMPRA_PODE_SOBRAR") resumo.mpsCompraPodeSobrar += 1;
      return {
        idmateriaprima: m.idmateriaprima,
        nome: String(d.materia_prima_ds || d.nome_materiaprima || ""),
        artigo: String(d.artigo || ""),
        cor: String(d.cor || ""),
        deltaMa: Number(m.delta_ma || 0),
        deltaPx: Number(m.delta_px || 0),
        deltaUl: Number(m.delta_ul || 0),
        deltaQt: Number(m.delta_qt || 0),
        deltaQu: Number(m.delta_qu || 0),
        deltaTotal: Number(m.delta_consumo_total || 0),
        aumentoConsumo: Number(m.aumento_consumo || 0),
        reducaoConsumo: Number(m.reducao_consumo || 0),
        skusImpactados: Number(m.skus_impactados || 0),
        estoquetotal,
        comprasPendentes: Number(d.compras_pendentes_total || 0),
        comprasFinalizadas: Number(d.compras_finalizadas_total || 0),
        valorFinalizado: Number(d.valor_finalizado_total || 0),
        risco,
        tipo: impactoTipoMp(Number(m.delta_consumo_total || 0)),
      };
    });

    resumo.mpsImpactadas = impactoMp.length;
    const diagnosticos = [
      { tipo: "MP_FALTA_GERADA", severidade: "alta", titulo: "MP pode faltar por aumento de plano", quantidade: resumo.mpsFaltaGerada },
      { tipo: "MP_COMPRA_PODE_SOBRAR", severidade: "media", titulo: "Compra de MP pode sobrar por reducao de plano", quantidade: resumo.mpsCompraPodeSobrar },
      { tipo: "ALTERACAO_PERIODO_SENSIVEL", severidade: "alta", titulo: "Alteracoes em MA/data vencida/SKU com venda", quantidade: resumo.alertas },
    ];

    return res.json({
      success: true,
      filtros: { dataDe, dataAte, periodos, limit },
      snapshots: { de: snapshotDe, ate: snapshotAte },
      meses: Object.fromEntries(PERIODOS_PLANO.map((p) => [p, periodoParaMes(p, baseDate)])),
      resumo,
      porPeriodo: Object.values(porPeriodo).sort((a, b) => PERIODOS_PLANO.indexOf(a.periodo) - PERIODOS_PLANO.indexOf(b.periodo)),
      diagnosticos,
      alteracoes,
      impactoMp,
    });
  } catch (error) {
    console.error("[snapshot-lotes/impacto-rapido] Erro:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao analisar impacto rapido dos snapshots",
      details: error.message,
    });
  }
});

router.post("/", auth, async (req, res) => {
  const { nome, parametros = {}, resumo = {}, observacoes = "" } = req.body || {};
  const nomeTrim = String(nome || "").trim();
  if (!nomeTrim) {
    return res.status(400).json({ success: false, error: "nome é obrigatório" });
  }

  try {
    const pool = req.app.get("pool");
    await ensureSimulacoesTable(pool);

    const item = {
      id: `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`,
      nome: nomeTrim,
      createdAt: Date.now(),
      parametros,
      resumo,
      observacoes: String(observacoes || ""),
    };

    await pool.query(
      `INSERT INTO ${TABLE_NAME} (id, nome, created_at, updated_at, parametros, resumo, observacoes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        item.id,
        item.nome,
        item.createdAt,
        null,
        JSON.stringify(item.parametros || {}),
        JSON.stringify(item.resumo || {}),
        item.observacoes,
      ]
    );

    return res.status(201).json({ success: true, data: item });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Erro ao salvar simulação", details: error.message });
  }
});

router.delete("/:id", auth, async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, error: "id inválido" });

  try {
    const pool = req.app.get("pool");
    await ensureSimulacoesTable(pool);
    const result = await pool.query(`DELETE FROM ${TABLE_NAME} WHERE id = $1`, [id]);
    if (!result.rowCount) {
      return res.status(404).json({ success: false, error: "Simulação não encontrada" });
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Erro ao excluir simulação", details: error.message });
  }
});

router.put("/:id", auth, async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, error: "id inválido" });

  const { nome, parametros, resumo, observacoes } = req.body || {};

  try {
    const pool = req.app.get("pool");
    await ensureSimulacoesTable(pool);
    const currentRes = await pool.query(`SELECT * FROM ${TABLE_NAME} WHERE id = $1`, [id]);
    if (!currentRes.rowCount) {
      return res.status(404).json({ success: false, error: "Simulação não encontrada" });
    }

    const atual = currentRes.rows[0];
    const atualizado = {
      id,
      nome: nome !== undefined ? String(nome || "").trim() || String(atual.nome || "") : String(atual.nome || ""),
      createdAt: Number(atual.created_at || 0),
      updatedAt: Date.now(),
      parametros: parametros !== undefined ? parametros : safeParseJson(atual.parametros, {}),
      resumo: resumo !== undefined ? resumo : safeParseJson(atual.resumo, {}),
      observacoes: observacoes !== undefined ? String(observacoes || "") : String(atual.observacoes || ""),
    };

    await pool.query(
      `UPDATE ${TABLE_NAME}
       SET nome = $2,
           updated_at = $3,
           parametros = $4,
           resumo = $5,
           observacoes = $6
       WHERE id = $1`,
      [
        id,
        atualizado.nome,
        atualizado.updatedAt,
        JSON.stringify(atualizado.parametros || {}),
        JSON.stringify(atualizado.resumo || {}),
        atualizado.observacoes,
      ]
    );

    return res.json({ success: true, data: atualizado });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Erro ao atualizar simulação", details: error.message });
  }
});

module.exports = router;
