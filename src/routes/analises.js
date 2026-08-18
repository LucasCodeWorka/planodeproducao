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
        MAX(data_snapshot) AS snapshot_at,
        COUNT(*)::INT AS linhas
      FROM snapshot_lotes
      GROUP BY DATE(data_snapshot)
      ORDER BY DATE(data_snapshot) DESC
      LIMIT 120
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
      `SELECT MAX(data_snapshot) AS snapshot_at
       FROM snapshot_lotes
       WHERE DATE(data_snapshot) = $1::DATE`,
      [data]
    );
    return result.rows?.[0]?.snapshot_at || null;
  }

  const result = await pool.query(
    `SELECT MAX(data_snapshot) AS snapshot_at
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
        WHERE data_snapshot = $1
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
        WHERE data_snapshot = $2
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
