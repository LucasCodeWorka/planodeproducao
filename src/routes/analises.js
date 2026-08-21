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

async function resolveSnapshotAt(pool, data, offset, direction = "exact") {
  if (data) {
    const comparator = direction === "gte" ? ">=" : direction === "lte" ? "<=" : "=";
    const order = direction === "gte" ? "ASC" : "DESC";
    const result = await pool.query(
      `WITH dia AS (
         SELECT DATE(data_snapshot) AS data
         FROM snapshot_lotes
         WHERE DATE(data_snapshot) ${comparator} $1::DATE
         GROUP BY DATE(data_snapshot)
         ORDER BY DATE(data_snapshot) ${order}
         LIMIT 1
       )
       SELECT TO_CHAR(MAX(s.data_snapshot), 'YYYY-MM-DD HH24:MI:SS.MS') AS snapshot_at
       FROM snapshot_lotes s
       INNER JOIN dia d ON DATE(s.data_snapshot) = d.data`,
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

    const snapshotAte = await resolveSnapshotAt(pool, dataAte, 0, dataAte ? "lte" : "exact");
    const snapshotDe = await resolveSnapshotAt(pool, dataDe, dataAte ? 1 : 1, dataDe ? "gte" : "exact");

    if (!snapshotDe || !snapshotAte || new Date(snapshotDe).getTime() > new Date(snapshotAte).getTime()) {
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
        f_dic_prd_nivel(d.cd_produto, 'CD'::bpchar)::TEXT AS referencia,
        COALESCE(f_dic_prd_nivel(d.cd_produto, 'DS'::bpchar), p.nm_produto) AS produto,
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

    const snapshotAte = await resolveSnapshotAt(pool, dataAte, 0, dataAte ? "lte" : "exact");
    const snapshotDe = await resolveSnapshotAt(pool, dataDe, dataAte ? 1 : 1, dataDe ? "gte" : "exact");

    if (!snapshotDe || !snapshotAte || new Date(snapshotDe).getTime() > new Date(snapshotAte).getTime()) {
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
          f_dic_prd_nivel(d.cd_produto, 'CD'::bpchar)::TEXT AS referencia,
          COALESCE(f_dic_prd_nivel(d.cd_produto, 'DS'::bpchar), p.nm_produto) AS produto,
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

    const snapshotAte = await resolveSnapshotAt(pool, dataAte, 0, dataAte ? "lte" : "exact");
    const snapshotDe = await resolveSnapshotAt(pool, dataDe, dataAte ? 1 : 1, dataDe ? "gte" : "exact");
    if (!snapshotDe || !snapshotAte || new Date(snapshotDe).getTime() > new Date(snapshotAte).getTime()) {
      return res.status(404).json({ success: false, error: "Snapshots insuficientes para analisar impacto" });
    }

    const baseDate = new Date(snapshotAte);
    const dataDeSql = String(snapshotDe).slice(0, 10);
    const dataAteSql = String(snapshotAte).slice(0, 10);
    const vendasInicio = addMonths(startOfMonth(baseDate), -3).toISOString().slice(0, 10);

    const alteracoesResult = await pool.query(`
      WITH snapshots AS (
        SELECT
          MAX(data_snapshot) FILTER (WHERE DATE(data_snapshot) = DATE($1::TIMESTAMP)) AS snap_de,
          MAX(data_snapshot) FILTER (WHERE DATE(data_snapshot) = DATE($2::TIMESTAMP)) AS snap_ate
        FROM snapshot_lotes
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
          f_dic_prd_nivel(d.cd_produto, 'CD'::bpchar)::TEXT AS referencia,
          COALESCE(f_dic_prd_nivel(d.cd_produto, 'DS'::bpchar), p.nm_produto) AS produto,
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

function monthStartIso(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function nextMonthIso(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

function mesesEntre(dataDe, dataAte) {
  const meses = [];
  let atual = monthStartIso(dataDe);
  const limite = monthStartIso(dataAte);
  while (atual <= limite && meses.length < 24) {
    meses.push(atual);
    atual = nextMonthIso(atual);
  }
  return meses;
}

function diferencaDias(dataDe, dataAte) {
  const inicio = new Date(`${dataDe}T00:00:00Z`).getTime();
  const fim = new Date(`${dataAte}T00:00:00Z`).getTime();
  return Math.round((fim - inicio) / 86400000);
}

function classificarRotacao(antes, depois) {
  if (antes > 0 && depois <= 0) return "LIMBO";
  if (antes <= 0 && depois > 0) return "INSERIDO";
  if (antes > 0 && depois > 0 && antes !== depois) return "ALTERADO";
  if (antes > 0 && depois > 0) return "PRESERVADO";
  return "VAZIO";
}

async function queryProducaoPorLotes(pool, lotes, skus = []) {
  const ids = Array.from(new Set((lotes || []).map((id) => String(id || "")).filter(Boolean)));
  const produtos = Array.from(new Set((skus || []).map((id) => String(id || "")).filter(Boolean)));
  if (!ids.length) return new Map();
  const params = [ids];
  const filtroProduto = produtos.length ? `AND cd_produto::TEXT = ANY($2::TEXT[])` : "";
  if (produtos.length) params.push(produtos);
  const result = await pool.query(`
    SELECT
      nr_lote::TEXT AS nr_lote,
      cd_produto::TEXT AS sku,
      SUM(COALESCE(qt_gerouop, 0))::FLOAT AS qt_gerouop,
      SUM(COALESCE(qt_real, 0))::FLOAT AS qt_real,
      SUM(COALESCE(qt_finalizada, 0))::FLOAT AS qt_finalizada,
      ARRAY_AGG(DISTINCT nr_op::TEXT) FILTER (WHERE nr_op IS NOT NULL) AS ops
    FROM vr_pcp_loteplop
    WHERE nr_lote::TEXT = ANY($1::TEXT[])
      ${filtroProduto}
    GROUP BY nr_lote, cd_produto
  `, params);
  return new Map(result.rows.map((row) => [`${row.nr_lote}|${row.sku}`, {
    qtGerouop: Number(row.qt_gerouop || 0),
    qtReal: Number(row.qt_real || 0),
    qtFinalizada: Number(row.qt_finalizada || 0),
    ops: Array.isArray(row.ops) ? row.ops.map(String) : [],
  }]));
}

function producaoDoEstado(estado, producaoPorLote) {
  const itens = (estado?.lotes || []).map((lote) => producaoPorLote.get(`${lote}|${estado?.sku}`)).filter(Boolean);
  const qtGerouop = Number(estado?.qtGerouop || 0) || itens.reduce((total, item) => total + item.qtGerouop, 0);
  return {
    gerouOp: qtGerouop > 0,
    qtGerouop,
    qtReal: itens.reduce((total, item) => total + item.qtReal, 0),
    qtFinalizada: itens.reduce((total, item) => total + item.qtFinalizada, 0),
    ops: Array.from(new Set(itens.flatMap((item) => item.ops))),
  };
}

router.get("/snapshot-lotes/rotacao-anual", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const dataDe = req.query.de ? String(req.query.de).slice(0, 10) : null;
    const dataAte = req.query.ate ? String(req.query.ate).slice(0, 10) : null;
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    if (!dataDe || !dataAte) {
      return res.status(400).json({ success: false, error: "Informe o período da análise anual" });
    }

    const diasResult = await pool.query(`
      SELECT DATE(data_snapshot)::TEXT AS data,
             TO_CHAR(MAX(data_snapshot), 'YYYY-MM-DD HH24:MI:SS.US') AS snapshot_at
      FROM snapshot_lotes
      WHERE data_snapshot >= $1::DATE
        AND data_snapshot < ($2::DATE + INTERVAL '1 day')
      GROUP BY DATE(data_snapshot)
      ORDER BY DATE(data_snapshot)
    `, [dataDe, dataAte]);
    const dias = diasResult.rows.map((row) => ({ data: String(row.data), snapshotAt: row.snapshot_at }));

    const transicoesBase = [];
    for (const mes of mesesEntre(dataDe, dataAte)) {
      const anteriores = dias.filter((dia) => dia.data < mes);
      const posteriores = dias.filter((dia) => dia.data >= mes);
      const antes = anteriores[anteriores.length - 1];
      const depois = posteriores[0];
      if (antes && depois && antes.data !== depois.data) transicoesBase.push({ mes, antes, depois });
    }

    const snapshotsSelecionados = Array.from(new Set(transicoesBase.flatMap((item) => [item.antes.snapshotAt, item.depois.snapshotAt])));
    const estadosResult = snapshotsSelecionados.length ? await pool.query(`
      SELECT TO_CHAR(data_snapshot, 'YYYY-MM-DD HH24:MI:SS.US') AS snapshot_at,
             cd_produto::TEXT AS sku,
             UPPER(TRIM(COALESCE(cd_auxiliar, ''))) AS periodo,
             SUM(GREATEST(COALESCE(qt_lote, 0) - COALESCE(qt_gerouop, 0), 0))::FLOAT AS qtd_aberto,
             SUM(COALESCE(qt_gerouop, 0))::FLOAT AS qt_gerouop,
             ARRAY_AGG(DISTINCT nr_lote::TEXT) AS lotes
      FROM snapshot_lotes
      WHERE data_snapshot = ANY($1::TIMESTAMP[])
        AND UPPER(TRIM(COALESCE(cd_auxiliar, ''))) = ANY($2::TEXT[])
        AND COALESCE(tp_situacao, 0) = 1
      GROUP BY data_snapshot, cd_produto, UPPER(TRIM(COALESCE(cd_auxiliar, '')))
    `, [snapshotsSelecionados, PERIODOS_PLANO]) : { rows: [] };

    const estados = new Map();
    for (const row of estadosResult.rows) {
      const mapa = estados.get(row.snapshot_at) || new Map();
      mapa.set(`${row.sku}|${row.periodo}`, {
        sku: String(row.sku),
        periodo: String(row.periodo),
         qtdAberto: Math.round(Number(row.qtd_aberto || 0)),
         qtGerouop: Number(row.qt_gerouop || 0),
         lotes: Array.isArray(row.lotes) ? row.lotes.map(String) : [],
      });
      estados.set(row.snapshot_at, mapa);
    }

    const todosLotes = Array.from(new Set(Array.from(estados.values()).flatMap((mapa) => Array.from(mapa.values()).flatMap((row) => row.lotes || []))));
    const todosSkus = Array.from(new Set(Array.from(estados.values()).flatMap((mapa) => Array.from(mapa.keys()).map((key) => key.split("|")[0]))));
    const producaoPorLote = await queryProducaoPorLotes(pool, todosLotes, todosSkus);
    const rotacao = { preservados: 0, alterados: 0, inseridos: 0, produzidos: 0, limbos: 0, pecasLimbo: 0, pecasProduzidas: 0, skusAfetados: new Set() };
    const transferencias = [{ de: "PX", para: "MA" }, { de: "UL", para: "PX" }, { de: "QT", para: "UL" }, { de: "QU", para: "QT" }];
    const transicoes = transicoesBase.map((item) => {
      const antes = estados.get(item.antes.snapshotAt) || new Map();
      const depois = estados.get(item.depois.snapshotAt) || new Map();
      const porPeriodo = transferencias.map((transferencia) => {
        const skus = new Set();
        for (const key of antes.keys()) if (key.endsWith(`|${transferencia.de}`)) skus.add(key.split("|")[0]);
        for (const key of depois.keys()) if (key.endsWith(`|${transferencia.para}`)) skus.add(key.split("|")[0]);
        const resumo = { de: transferencia.de, para: transferencia.para, preservados: 0, alterados: 0, inseridos: 0, produzidos: 0, limbos: 0, pecasLimbo: 0, pecasProduzidas: 0, delta: 0 };
        for (const sku of skus) {
          const origem = antes.get(`${sku}|${transferencia.de}`)?.qtdAberto || 0;
          const destino = depois.get(`${sku}|${transferencia.para}`)?.qtdAberto || 0;
          let tipo = classificarRotacao(origem, destino);
          const producao = tipo === "LIMBO" ? producaoDoEstado(antes.get(`${sku}|${transferencia.de}`), producaoPorLote) : null;
          if (tipo === "LIMBO" && producao.gerouOp) tipo = "PRODUZIDO";
          if (tipo === "PRESERVADO") resumo.preservados += 1;
          if (tipo === "ALTERADO") resumo.alterados += 1;
          if (tipo === "INSERIDO") resumo.inseridos += 1;
          if (tipo === "PRODUZIDO") { resumo.produzidos += 1; resumo.pecasProduzidas += origem; }
          if (tipo === "LIMBO") { resumo.limbos += 1; resumo.pecasLimbo += origem; }
          resumo.delta += destino - origem;
          if (tipo !== "VAZIO") rotacao.skusAfetados.add(sku);
        }
        rotacao.preservados += resumo.preservados;
        rotacao.alterados += resumo.alterados;
        rotacao.inseridos += resumo.inseridos;
        rotacao.produzidos += resumo.produzidos;
        rotacao.pecasProduzidas += resumo.pecasProduzidas;
        rotacao.limbos += resumo.limbos;
        rotacao.pecasLimbo += resumo.pecasLimbo;
        return resumo;
      });
      // QU nao tem uma origem fixa na rotacao; conta apenas quando entrou do zero.
      const novosQu = Array.from(depois.values()).filter((row) => (
        row.periodo === "QU" && row.qtdAberto > 0 && !(antes.get(`${row.sku}|QU`)?.qtdAberto > 0)
      )).length;
      const limbos = porPeriodo.reduce((total, periodo) => total + periodo.limbos, 0);
      const inseridos = porPeriodo.reduce((total, periodo) => total + periodo.inseridos, 0) + novosQu;
      rotacao.inseridos += novosQu;
      return {
        mes: item.mes,
        antes: item.antes.data,
        depois: item.depois.data,
        diasEntre: diferencaDias(item.antes.data, item.depois.data),
        status: limbos > 0 ? "CRITICA" : inseridos > 0 ? "COM_INSERCOES" : "ROTACAO_OK",
        limbos,
        produzidos: porPeriodo.reduce((total, periodo) => total + periodo.produzidos, 0),
        inseridos,
        alterados: porPeriodo.reduce((total, periodo) => total + periodo.alterados, 0),
        preservados: porPeriodo.reduce((total, periodo) => total + periodo.preservados, 0),
        novosPlanos: inseridos,
        porPeriodo,
      };
    });

    const eventosForaJanela = [];

    return res.json({
      success: true,
      filtros: { dataDe, dataAte },
      snapshots: { dias: dias.length, primeiro: dias[0]?.data || null, ultimo: dias[dias.length - 1]?.data || null },
      rotacao: {
        ...rotacao,
        skusAfetados: rotacao.skusAfetados.size,
        transicoesAnalisadas: transicoes.length,
        transicoesCriticas: transicoes.filter((item) => item.status === "CRITICA").length,
        novosPlanos: rotacao.inseridos,
        produzidos: rotacao.produzidos,
        pecasProduzidas: rotacao.pecasProduzidas,
        viradasForaJanela: transicoes.filter((item) => item.diasEntre > 3).length,
        diasForaJanela: transicoes.filter((item) => item.diasEntre > 3).reduce((total, item) => total + item.diasEntre, 0),
      },
      transicoes,
      eventosForaJanela,
    });
  } catch (error) {
    console.error("[snapshot-lotes/rotacao-anual] Erro:", error);
    return res.status(500).json({ success: false, error: "Erro ao analisar rotacao anual do plano", details: error.message });
  }
});

router.get("/snapshot-lotes/rotacao-detalhe", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const dataDe = req.query.de ? String(req.query.de).slice(0, 10) : null;
    const dataAte = req.query.ate ? String(req.query.ate).slice(0, 10) : null;
    const limit = Math.min(Number(req.query.limit) || 2000, 5000);

    if (!dataDe || !dataAte) {
      return res.status(400).json({ success: false, error: "Informe as duas datas da virada" });
    }

    const snapshotsResult = await pool.query(`
      SELECT
        TO_CHAR(MAX(data_snapshot) FILTER (WHERE DATE(data_snapshot) = $1::DATE), 'YYYY-MM-DD HH24:MI:SS.US') AS snap_de,
        TO_CHAR(MAX(data_snapshot) FILTER (WHERE DATE(data_snapshot) = $2::DATE), 'YYYY-MM-DD HH24:MI:SS.US') AS snap_ate
      FROM snapshot_lotes
    `, [dataDe, dataAte]);
    const snapDeValue = snapshotsResult.rows[0]?.snap_de;
    const snapAteValue = snapshotsResult.rows[0]?.snap_ate;
    if (!snapDeValue || !snapAteValue) {
      return res.status(404).json({ success: false, error: "Snapshots insuficientes para detalhar a virada" });
    }

    const estadosResult = await pool.query(`
      SELECT
        CASE WHEN s.data_snapshot = $1::TIMESTAMP THEN 'DE' ELSE 'ATE' END AS lado,
        s.cd_produto::TEXT AS sku,
        UPPER(TRIM(COALESCE(s.cd_auxiliar, ''))) AS periodo,
        SUM(GREATEST(COALESCE(s.qt_lote, 0) - COALESCE(s.qt_gerouop, 0), 0))::FLOAT AS qtd_aberto,
        SUM(COALESCE(s.qt_gerouop, 0))::FLOAT AS qt_gerouop,
        ARRAY_AGG(DISTINCT s.nr_lote::TEXT) AS lotes,
        TO_CHAR(s.data_snapshot, 'YYYY-MM-DD HH24:MI:SS.US') AS snapshot_at
      FROM snapshot_lotes s
      WHERE s.data_snapshot IN ($1::TIMESTAMP, $2::TIMESTAMP)
        AND UPPER(TRIM(COALESCE(s.cd_auxiliar, ''))) = ANY($3::TEXT[])
        AND COALESCE(s.tp_situacao, 0) = 1
      GROUP BY s.data_snapshot, s.cd_produto, UPPER(TRIM(COALESCE(s.cd_auxiliar, '')))
    `, [snapDeValue, snapAteValue, PERIODOS_PLANO]);

    const snapshotDe = estadosResult.rows.find((row) => row.lado === "DE")?.snapshot_at || snapDeValue;
    const snapshotAt = estadosResult.rows.find((row) => row.lado === "ATE")?.snapshot_at || snapAteValue;

    const estados = { DE: new Map(), ATE: new Map() };
    for (const row of estadosResult.rows) {
      estados[row.lado].set(`${row.sku}|${row.periodo}`, {
        sku: String(row.sku),
        qtdAberto: Number(row.qtd_aberto || 0),
        qtGerouop: Number(row.qt_gerouop || 0),
        lotes: Array.isArray(row.lotes) ? row.lotes.map(String) : [],
      });
    }

    const todosLotes = Array.from(new Set(Object.values(estados).flatMap((mapa) => Array.from(mapa.values()).flatMap((row) => row.lotes || []))));
    const todosSkus = Array.from(new Set(Object.values(estados).flatMap((mapa) => Array.from(mapa.keys()).map((key) => key.split("|")[0]))));
    const producaoPorLote = await queryProducaoPorLotes(pool, todosLotes, todosSkus);

    const transferencias = [
      { de: "PX", para: "MA" },
      { de: "UL", para: "PX" },
      { de: "QT", para: "UL" },
      { de: "QU", para: "QT" },
    ];
    const rows = [];
    const tipos = ["PRESERVADO", "ALTERADO", "INSERIDO", "PRODUZIDO", "LIMBO"];

    for (const transferencia of transferencias) {
      const skus = new Set();
      for (const key of estados.DE.keys()) {
        if (key.endsWith(`|${transferencia.de}`)) skus.add(key.split("|")[0]);
      }
      for (const key of estados.ATE.keys()) {
        if (key.endsWith(`|${transferencia.para}`)) skus.add(key.split("|")[0]);
      }

      for (const sku of skus) {
        const estadoAntes = estados.DE.get(`${sku}|${transferencia.de}`) || { qtdAberto: 0, qtGerouop: 0, lotes: [] };
        const estadoDepois = estados.ATE.get(`${sku}|${transferencia.para}`) || { qtdAberto: 0, qtGerouop: 0, lotes: [] };
        const antes = estadoAntes.qtdAberto;
        const depois = estadoDepois.qtdAberto;
        let tipo = classificarRotacao(antes, depois);
        const producao = tipo === "LIMBO" ? producaoDoEstado(estadoAntes, producaoPorLote) : null;
        if (tipo === "LIMBO" && producao.gerouOp) tipo = "PRODUZIDO";
        if (!tipos.includes(tipo)) continue;
        rows.push({
          sku,
          de: transferencia.de,
          para: transferencia.para,
          antes,
          depois,
          delta: depois - antes,
          tipo,
          qtOpGerada: producao?.qtGerouop || 0,
          qtReal: producao?.qtReal || 0,
          qtFinalizada: producao?.qtFinalizada || 0,
          ops: producao?.ops || [],
        });
      }
    }

    // QU pode receber uma inclusao nova sem ter uma posicao anterior correspondente.
    for (const [key, depois] of estados.ATE.entries()) {
      if (!key.endsWith("|QU") || depois.qtdAberto <= 0) continue;
      const sku = key.split("|")[0];
       const antes = estados.DE.get(key)?.qtdAberto || 0;
       if (antes > 0) continue;
       rows.push({ sku, de: "", para: "QU", antes: 0, depois: depois.qtdAberto, delta: depois.qtdAberto, tipo: "INSERIDO", qtOpGerada: 0, qtReal: 0, qtFinalizada: 0, ops: [] });
    }

    const skuIds = Array.from(new Set(rows.map((row) => row.sku)));
    let produtos = new Map();
    if (skuIds.length) {
      const produtosResult = await pool.query(`
        SELECT
          p.cd_produto::TEXT AS sku,
          f_dic_prd_nivel(p.cd_produto, 'CD'::BPCHAR)::TEXT AS referencia,
          COALESCE(f_dic_prd_nivel(p.cd_produto, 'DS'::BPCHAR), p.nm_produto, '')::TEXT AS produto,
          COALESCE(p.ds_cor, '')::TEXT AS cor,
          COALESCE(p.ds_tamanho, '')::TEXT AS tamanho
        FROM vr_prd_prdgrade p
        WHERE p.cd_produto::TEXT = ANY($1::TEXT[])
      `, [skuIds]);
      produtos = new Map(produtosResult.rows.map((row) => [String(row.sku), row]));
    }

    const enriquecidas = rows.map((row) => ({
      ...row,
      referencia: String(produtos.get(row.sku)?.referencia || ""),
      produto: String(produtos.get(row.sku)?.produto || ""),
      cor: String(produtos.get(row.sku)?.cor || ""),
      tamanho: String(produtos.get(row.sku)?.tamanho || ""),
    }));
    const ordemTipo = { LIMBO: 0, INSERIDO: 1, PRODUZIDO: 2, ALTERADO: 3, PRESERVADO: 4 };
    enriquecidas.sort((a, b) => (
      (ordemTipo[a.tipo] - ordemTipo[b.tipo]) || Math.abs(b.delta) - Math.abs(a.delta) || a.sku.localeCompare(b.sku)
    ));

    const categoriasCompletas = Object.fromEntries(tipos.map((tipo) => [
      `${tipo}S`, enriquecidas.filter((row) => row.tipo === tipo),
    ]));
    const categorias = Object.fromEntries(tipos.map((tipo) => [
      `${tipo}S`, categoriasCompletas[`${tipo}S`].slice(0, limit),
    ]));
    const resumo = {
      preservados: categoriasCompletas.PRESERVADOS.length,
      alterados: categoriasCompletas.ALTERADOS.length,
      inseridos: categoriasCompletas.INSERIDOS.length,
      limbos: categoriasCompletas.LIMBOS.length,
      produzidos: categoriasCompletas.PRODUZIDOS.length,
      inseridosDoZero: categoriasCompletas.INSERIDOS.length,
    };

    return res.json({
      success: true,
      filtros: { dataDe, dataAte, limit },
      snapshots: { de: snapshotDe, ate: snapshotAt },
      resumo,
      categorias,
      data: enriquecidas.slice(0, limit),
    });
  } catch (error) {
    console.error("[snapshot-lotes/rotacao-detalhe] Erro:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao detalhar a virada do plano",
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

// Dashboard Extrato do Plano - Evolução Anual
router.get("/snapshot-lotes/evolucao-anual", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const ano = Number(req.query.ano) || new Date().getFullYear();

    const dataDe = `${ano}-01-01`;
    const dataAte = `${ano}-12-31`;

    // Buscar todos os snapshots do ano
    const snapshotsResult = await pool.query(`
      SELECT
        DATE(data_snapshot)::TEXT AS data,
        TO_CHAR(MAX(data_snapshot), 'YYYY-MM-DD HH24:MI:SS.US') AS snapshot_at
      FROM snapshot_lotes
      WHERE data_snapshot >= $1::DATE
        AND data_snapshot < ($2::DATE + INTERVAL '1 day')
      GROUP BY DATE(data_snapshot)
      ORDER BY DATE(data_snapshot)
    `, [dataDe, dataAte]);

    const diasSnapshot = snapshotsResult.rows.map(r => ({ data: r.data, snapshotAt: r.snapshot_at }));

    if (!diasSnapshot.length) {
      return res.json({
        success: true,
        ano,
        snapshots: [],
        kpis: { totalSnapshots: 0, skusAtivos: 0, variacaoMedia: 0, tendencia: "sem_dados" },
        acontecimentos: [],
      });
    }

    // Buscar dados agregados por snapshot e posição
    const dadosResult = await pool.query(`
      SELECT
        DATE(data_snapshot)::TEXT AS data,
        UPPER(TRIM(COALESCE(cd_auxiliar, ''))) AS periodo,
        COUNT(DISTINCT cd_produto)::INT AS skus,
        SUM(GREATEST(COALESCE(qt_lote, 0) - COALESCE(qt_gerouop, 0), 0))::FLOAT AS qtd_aberto
      FROM snapshot_lotes
      WHERE data_snapshot >= $1::DATE
        AND data_snapshot < ($2::DATE + INTERVAL '1 day')
        AND UPPER(TRIM(COALESCE(cd_auxiliar, ''))) = ANY($3::TEXT[])
        AND COALESCE(tp_situacao, 0) = 1
      GROUP BY DATE(data_snapshot), UPPER(TRIM(COALESCE(cd_auxiliar, '')))
      ORDER BY DATE(data_snapshot), periodo
    `, [dataDe, dataAte, PERIODOS_PLANO]);

    // Agrupar por data
    const dadosPorData = new Map();
    for (const row of dadosResult.rows) {
      const posicoes = dadosPorData.get(row.data) || {};
      posicoes[row.periodo] = {
        skus: Number(row.skus || 0),
        qtd: Math.round(Number(row.qtd_aberto || 0)),
      };
      dadosPorData.set(row.data, posicoes);
    }

    // Buscar dados detalhados por SKU para comparação entre snapshots
    const detalhesResult = await pool.query(`
      SELECT
        DATE(data_snapshot)::TEXT AS data,
        cd_produto::TEXT AS sku,
        UPPER(TRIM(COALESCE(cd_auxiliar, ''))) AS periodo,
        SUM(GREATEST(COALESCE(qt_lote, 0) - COALESCE(qt_gerouop, 0), 0))::FLOAT AS qtd_aberto
      FROM snapshot_lotes
      WHERE data_snapshot >= $1::DATE
        AND data_snapshot < ($2::DATE + INTERVAL '1 day')
        AND UPPER(TRIM(COALESCE(cd_auxiliar, ''))) = ANY($3::TEXT[])
        AND COALESCE(tp_situacao, 0) = 1
      GROUP BY DATE(data_snapshot), cd_produto, UPPER(TRIM(COALESCE(cd_auxiliar, '')))
    `, [dataDe, dataAte, PERIODOS_PLANO]);

    // Agrupar detalhes por data
    const detalhesPorData = new Map();
    for (const row of detalhesResult.rows) {
      const skus = detalhesPorData.get(row.data) || new Map();
      skus.set(`${row.sku}|${row.periodo}`, {
        sku: row.sku,
        periodo: row.periodo,
        qtd: Math.round(Number(row.qtd_aberto || 0)),
      });
      detalhesPorData.set(row.data, skus);
    }

    // Calcular evolução e comparação entre snapshots
    const snapshots = [];
    const acontecimentos = [];
    let dataAnterior = null;
    let variacaoTotal = 0;
    let countVariacoes = 0;

    for (const dia of diasSnapshot) {
      const posicoes = dadosPorData.get(dia.data) || {};
      const skusAtual = detalhesPorData.get(dia.data) || new Map();
      const skusAnterior = dataAnterior ? (detalhesPorData.get(dataAnterior) || new Map()) : new Map();

      // Calcular mês de competência para cada posição
      const dataSnapshot = new Date(dia.data);
      const mesBase = dataSnapshot.getMonth();
      const anoBase = dataSnapshot.getFullYear();
      const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

      const mesCompetencia = {};
      const offsets = { MA: 1, PX: 2, UL: 3, QT: 4, QU: 5 };
      for (const periodo of PERIODOS_PLANO) {
        const mesIdx = (mesBase + offsets[periodo]) % 12;
        const anoComp = mesBase + offsets[periodo] > 11 ? anoBase + 1 : anoBase;
        mesCompetencia[periodo] = `${meses[mesIdx]}/${String(anoComp).slice(2)}`;
      }

      // Analisar mudanças por posição
      const resumoPosicoes = {};
      for (const periodo of PERIODOS_PLANO) {
        const dados = posicoes[periodo] || { skus: 0, qtd: 0 };
        let novos = 0, zerados = 0, aumentos = 0, reducoes = 0;
        let qtdNovos = 0, qtdZerados = 0, qtdAumentos = 0, qtdReducoes = 0;

        // Comparar com snapshot anterior
        for (const [key, atual] of skusAtual.entries()) {
          if (!key.endsWith(`|${periodo}`)) continue;
          const sku = key.split("|")[0];
          const anterior = skusAnterior.get(key);

          if (!anterior || anterior.qtd === 0) {
            if (atual.qtd > 0) { novos++; qtdNovos += atual.qtd; }
          } else if (atual.qtd > anterior.qtd) {
            aumentos++; qtdAumentos += (atual.qtd - anterior.qtd);
          } else if (atual.qtd < anterior.qtd && atual.qtd > 0) {
            reducoes++; qtdReducoes += (anterior.qtd - atual.qtd);
          }
        }

        // Verificar zerados (existia antes, não existe agora ou qtd = 0)
        if (dataAnterior) {
          for (const [key, anterior] of skusAnterior.entries()) {
            if (!key.endsWith(`|${periodo}`)) continue;
            const atual = skusAtual.get(key);
            if (anterior.qtd > 0 && (!atual || atual.qtd === 0)) {
              zerados++; qtdZerados += anterior.qtd;
            }
          }
        }

        resumoPosicoes[periodo] = {
          skus: dados.skus,
          qtd: dados.qtd,
          novos, zerados, aumentos, reducoes,
          qtdNovos, qtdZerados, qtdAumentos, qtdReducoes,
        };
      }

      // Calcular variação total
      const qtdAtual = Object.values(resumoPosicoes).reduce((s, p) => s + p.qtd, 0);
      let variacao = 0;
      if (dataAnterior) {
        const posAnterior = dadosPorData.get(dataAnterior) || {};
        const qtdAnterior = Object.values(posAnterior).reduce((s, p) => s + (p?.qtd || 0), 0);
        if (qtdAnterior > 0) {
          variacao = ((qtdAtual - qtdAnterior) / qtdAnterior) * 100;
          variacaoTotal += Math.abs(variacao);
          countVariacoes++;
        }
      }

      snapshots.push({
        data: dia.data,
        snapshotAt: dia.snapshotAt,
        posicoes: resumoPosicoes,
        mesCompetencia,
        totalSkus: Object.values(resumoPosicoes).reduce((s, p) => s + p.skus, 0),
        totalQtd: qtdAtual,
        variacao: Math.round(variacao * 10) / 10,
      });

      // Gerar acontecimentos relevantes
      for (const periodo of PERIODOS_PLANO) {
        const r = resumoPosicoes[periodo];
        if (r.novos >= 10) {
          acontecimentos.push({
            data: dia.data,
            tipo: "NOVOS",
            periodo,
            mesCompetencia: mesCompetencia[periodo],
            valor: r.novos,
            qtd: r.qtdNovos,
            descricao: `+${r.novos} novos SKUs no ${periodo} (${mesCompetencia[periodo]})`,
          });
        }
        if (r.zerados >= 5) {
          acontecimentos.push({
            data: dia.data,
            tipo: "ZERADOS",
            periodo,
            mesCompetencia: mesCompetencia[periodo],
            valor: r.zerados,
            qtd: r.qtdZerados,
            descricao: `${r.zerados} SKUs zerados no ${periodo}`,
          });
        }
        if (r.qtdAumentos > 5000) {
          acontecimentos.push({
            data: dia.data,
            tipo: "AUMENTO",
            periodo,
            mesCompetencia: mesCompetencia[periodo],
            valor: r.aumentos,
            qtd: r.qtdAumentos,
            descricao: `Aumento de ${r.qtdAumentos.toLocaleString("pt-BR")} peças no ${periodo}`,
          });
        }
        if (r.qtdReducoes > 5000) {
          acontecimentos.push({
            data: dia.data,
            tipo: "REDUCAO",
            periodo,
            mesCompetencia: mesCompetencia[periodo],
            valor: r.reducoes,
            qtd: r.qtdReducoes,
            descricao: `Redução de ${r.qtdReducoes.toLocaleString("pt-BR")} peças no ${periodo}`,
          });
        }
      }

      dataAnterior = dia.data;
    }

    // KPIs
    const ultimoSnapshot = snapshots[snapshots.length - 1];
    const primeiroSnapshot = snapshots[0];
    let tendencia = "estavel";
    if (snapshots.length >= 3) {
      const ultimos3 = snapshots.slice(-3);
      const mediaVariacao = ultimos3.reduce((s, sn) => s + sn.variacao, 0) / 3;
      if (mediaVariacao > 5) tendencia = "crescente";
      else if (mediaVariacao < -5) tendencia = "decrescente";
    }

    return res.json({
      success: true,
      ano,
      snapshots,
      kpis: {
        totalSnapshots: snapshots.length,
        skusAtivos: ultimoSnapshot?.totalSkus || 0,
        variacaoMedia: countVariacoes > 0 ? Math.round((variacaoTotal / countVariacoes) * 10) / 10 : 0,
        tendencia,
        qtdTotalAtual: ultimoSnapshot?.totalQtd || 0,
        qtdTotalInicio: primeiroSnapshot?.totalQtd || 0,
      },
      acontecimentos: acontecimentos.sort((a, b) => b.data.localeCompare(a.data)).slice(0, 50),
    });
  } catch (error) {
    console.error("[snapshot-lotes/evolucao-anual] Erro:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao analisar evolução anual do plano",
      details: error.message,
    });
  }
});

module.exports = router;
