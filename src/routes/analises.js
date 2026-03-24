const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const DATA_DIR = path.join(__dirname, "../../data");
const ANALISES_FILE = path.join(DATA_DIR, "analises_plano.json");
const TABLE_NAME = "app_simulacoes";

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

router.get("/", auth, async (req, res) => {
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

router.get("/top30-produtos", auth, async (req, res) => {
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
