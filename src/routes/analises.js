const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const DATA_DIR = path.join(__dirname, "../../data");
const ANALISES_FILE = path.join(DATA_DIR, "analises_plano.json");

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

function readAnalises() {
  try {
    const raw = fs.readFileSync(ANALISES_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.data)) return [];
    return parsed.data;
  } catch {
    return [];
  }
}

function writeAnalises(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    ANALISES_FILE,
    JSON.stringify({ timestamp: Date.now(), count: data.length, data }, null, 2),
    "utf-8"
  );
}

router.get("/", auth, (_req, res) => {
  const data = readAnalises()
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, 200);

  return res.json({
    success: true,
    total: data.length,
    data,
  });
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

      // fallback: tenta identificar coluna de produto pelo nome
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

      // fallback: tenta identificar coluna de referencia pelo nome
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

router.post("/", auth, (req, res) => {
  const { nome, parametros = {}, resumo = {}, observacoes = "" } = req.body || {};
  const nomeTrim = String(nome || "").trim();
  if (!nomeTrim) {
    return res.status(400).json({ success: false, error: "nome é obrigatório" });
  }

  const analises = readAnalises();
  const item = {
    id: `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`,
    nome: nomeTrim,
    createdAt: Date.now(),
    parametros,
    resumo,
    observacoes: String(observacoes || ""),
  };

  analises.push(item);
  writeAnalises(analises);

  return res.status(201).json({ success: true, data: item });
});

router.delete("/:id", auth, (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, error: "id inválido" });

  const analises = readAnalises();
  const filtradas = analises.filter((a) => String(a.id) !== id);
  if (filtradas.length === analises.length) {
    return res.status(404).json({ success: false, error: "Análise não encontrada" });
  }

  writeAnalises(filtradas);
  return res.json({ success: true });
});

router.put("/:id", auth, (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, error: "id inválido" });

  const { nome, parametros, resumo, observacoes } = req.body || {};
  const analises = readAnalises();
  const idx = analises.findIndex((a) => String(a.id) === id);
  if (idx < 0) {
    return res.status(404).json({ success: false, error: "Análise não encontrada" });
  }

  const atual = analises[idx];
  const atualizado = {
    ...atual,
    nome: nome !== undefined ? String(nome || "").trim() || atual.nome : atual.nome,
    parametros: parametros !== undefined ? parametros : atual.parametros,
    resumo: resumo !== undefined ? resumo : atual.resumo,
    observacoes: observacoes !== undefined ? String(observacoes || "") : atual.observacoes,
    updatedAt: Date.now(),
  };

  analises[idx] = atualizado;
  writeAnalises(analises);
  return res.json({ success: true, data: atualizado });
});

module.exports = router;
