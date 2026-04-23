const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const DATA_DIR = path.join(__dirname, "../../data");
const CORTES_FILE = path.join(DATA_DIR, "cortes_minimos_produto.json");
const SUGESTAO_FILE = path.join(DATA_DIR, "config_sugestao_plano.json");
const REGRAS_OPMIN_FILE = path.join(DATA_DIR, "regras_op_min_ref.json");
const ESTOQUE_LOJAS_FILE = path.join(DATA_DIR, "config_estoque_lojas.json");

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

function readCortes() {
  try {
    const raw = fs.readFileSync(CORTES_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const data = Array.isArray(parsed?.data) ? parsed.data : [];
    return data
      .map((r) => ({
        idproduto: String(r.idproduto || "").trim(),
        corte_min: Number(r.corte_min || 0),
      }))
      .filter((r) => r.idproduto && Number.isFinite(r.corte_min) && r.corte_min > 0);
  } catch {
    return [];
  }
}

function writeCortes(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    CORTES_FILE,
    JSON.stringify({ timestamp: Date.now(), count: data.length, data }, null, 2),
    "utf-8"
  );
}

function readSugestaoPlano() {
  try {
    const raw = fs.readFileSync(SUGESTAO_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const cfg = parsed?.data || {};
    return {
      // Novos campos por Curva ABC
      cobertura_min_a: Number(cfg.cobertura_min_a ?? 0.5),
      cobertura_max_a: Number(cfg.cobertura_max_a ?? 1.0),
      cobertura_min_b: Number(cfg.cobertura_min_b ?? 1.0),
      cobertura_max_b: Number(cfg.cobertura_max_b ?? 2.0),
      cobertura_min_c: Number(cfg.cobertura_min_c ?? 1.0),
      cobertura_max_c: Number(cfg.cobertura_max_c ?? 2.5),
      cobertura_min_d: Number(cfg.cobertura_min_d ?? 1.0),
      cobertura_max_d: Number(cfg.cobertura_max_d ?? 3.0),
      // Cobertura máxima especial para linha IDEAL
      cobertura_max_ideal: Number(cfg.cobertura_max_ideal ?? 6.0),
      usar_corte_minimo: cfg.usar_corte_minimo !== false,
      usar_op_minima_ref: cfg.usar_op_minima_ref !== false,
    };
  } catch {
    return {
      cobertura_min_a: 0.5,
      cobertura_max_a: 1.0,
      cobertura_min_b: 1.0,
      cobertura_max_b: 2.0,
      cobertura_min_c: 1.0,
      cobertura_max_c: 2.5,
      cobertura_min_d: 1.0,
      cobertura_max_d: 3.0,
      cobertura_max_ideal: 6.0,
      usar_corte_minimo: true,
      usar_op_minima_ref: true,
    };
  }
}

function writeSugestaoPlano(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    SUGESTAO_FILE,
    JSON.stringify({ timestamp: Date.now(), data }, null, 2),
    "utf-8"
  );
}

function normalizeText(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function readRegrasOpMin() {
  try {
    const raw = fs.readFileSync(REGRAS_OPMIN_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const data = Array.isArray(parsed?.data) ? parsed.data : [];
    return data
      .map((r) => ({
        continuidade: normalizeText(r.continuidade),
        linha: normalizeText(r.linha),
        grupo: normalizeText(r.grupo),
        op_min_ref: Number(r.op_min_ref || 0),
        cobertura_max: Number(r.cobertura_max || 0),
      }))
      .filter((r) => r.continuidade && r.linha && r.grupo && r.op_min_ref > 0 && r.cobertura_max > 0);
  } catch {
    return [];
  }
}

function writeRegrasOpMin(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    REGRAS_OPMIN_FILE,
    JSON.stringify({ timestamp: Date.now(), count: data.length, data }, null, 2),
    "utf-8"
  );
}

function readEstoqueLojas() {
  try {
    const raw = fs.readFileSync(ESTOQUE_LOJAS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const cfg = parsed?.data || {};
    return {
      cobertura_minima_lojas: Number(cfg.cobertura_minima_lojas || 1.0),
    };
  } catch {
    return {
      cobertura_minima_lojas: 1.0,
    };
  }
}

function writeEstoqueLojas(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    ESTOQUE_LOJAS_FILE,
    JSON.stringify({ timestamp: Date.now(), data }, null, 2),
    "utf-8"
  );
}

router.get("/corte-minimos", auth, (_req, res) => {
  const data = readCortes().sort((a, b) => a.idproduto.localeCompare(b.idproduto));
  return res.json({ success: true, total: data.length, data });
});

router.post("/corte-minimos", auth, (req, res) => {
  const rows = Array.isArray(req.body?.data) ? req.body.data : [];
  if (!rows.length) {
    return res.status(400).json({ success: false, error: "data é obrigatório" });
  }

  const map = new Map();
  for (const row of rows) {
    const idproduto = String(row?.idproduto || "").trim();
    const corte_min = Number(row?.corte_min || 0);
    if (!idproduto || !Number.isFinite(corte_min) || corte_min <= 0) continue;
    map.set(idproduto, { idproduto, corte_min: Math.round(corte_min) });
  }
  const data = Array.from(map.values());
  if (!data.length) {
    return res.status(400).json({ success: false, error: "Nenhum registro válido para salvar" });
  }

  writeCortes(data);
  return res.status(201).json({ success: true, total: data.length, data });
});

router.get("/sugestao-plano", auth, (_req, res) => {
  const data = readSugestaoPlano();
  return res.json({ success: true, data });
});

router.post("/sugestao-plano", auth, (req, res) => {
  const inData = req.body || {};
  const data = {
    // Novos campos por Curva ABC
    cobertura_min_a: Number(inData.cobertura_min_a ?? 0.5),
    cobertura_max_a: Number(inData.cobertura_max_a ?? 1.0),
    cobertura_min_b: Number(inData.cobertura_min_b ?? 1.0),
    cobertura_max_b: Number(inData.cobertura_max_b ?? 2.0),
    cobertura_min_c: Number(inData.cobertura_min_c ?? 1.0),
    cobertura_max_c: Number(inData.cobertura_max_c ?? 2.5),
    cobertura_min_d: Number(inData.cobertura_min_d ?? 1.0),
    cobertura_max_d: Number(inData.cobertura_max_d ?? 3.0),
    // Cobertura máxima especial para linha IDEAL
    cobertura_max_ideal: Number(inData.cobertura_max_ideal ?? 6.0),
    usar_corte_minimo: inData.usar_corte_minimo !== false,
    usar_op_minima_ref: inData.usar_op_minima_ref !== false,
  };

  // Validar que todas as coberturas são maiores que zero
  const coberturas = [
    data.cobertura_min_a, data.cobertura_max_a,
    data.cobertura_min_b, data.cobertura_max_b,
    data.cobertura_min_c, data.cobertura_max_c,
    data.cobertura_min_d, data.cobertura_max_d,
    data.cobertura_max_ideal,
  ];
  if (coberturas.some(c => !(c > 0))) {
    return res.status(400).json({ success: false, error: "Coberturas devem ser maiores que zero" });
  }

  writeSugestaoPlano(data);
  return res.status(201).json({ success: true, data });
});

router.get("/regras-op-minimas", auth, (_req, res) => {
  const data = readRegrasOpMin();
  return res.json({ success: true, total: data.length, data });
});

router.post("/regras-op-minimas", auth, (req, res) => {
  const rows = Array.isArray(req.body?.data) ? req.body.data : [];
  if (!rows.length) {
    return res.status(400).json({ success: false, error: "data é obrigatório" });
  }

  const map = new Map();
  for (const row of rows) {
    const continuidade = normalizeText(row?.continuidade);
    const linha = normalizeText(row?.linha);
    const grupo = normalizeText(row?.grupo);
    const op_min_ref = Number(row?.op_min_ref || row?.opMinRef || 0);
    const cobertura_max = Number(row?.cobertura_max || row?.coberturaMax || 0);
    if (!continuidade || !linha || !grupo || !(op_min_ref > 0) || !(cobertura_max > 0)) continue;
    const key = `${continuidade}__${linha}__${grupo}`;
    map.set(key, { continuidade, linha, grupo, op_min_ref, cobertura_max });
  }

  const data = Array.from(map.values()).sort((a, b) =>
    `${a.continuidade}-${a.linha}-${a.grupo}`.localeCompare(`${b.continuidade}-${b.linha}-${b.grupo}`)
  );

  if (!data.length) {
    return res.status(400).json({ success: false, error: "Nenhuma regra válida para salvar" });
  }

  writeRegrasOpMin(data);
  return res.status(201).json({ success: true, total: data.length, data });
});

router.get("/estoque-lojas", auth, (_req, res) => {
  const data = readEstoqueLojas();
  return res.json({ success: true, data });
});

router.post("/estoque-lojas", auth, (req, res) => {
  const inData = req.body || {};
  const data = {
    cobertura_minima_lojas: Math.max(0.1, Number(inData.cobertura_minima_lojas || 1.0)),
  };

  writeEstoqueLojas(data);
  return res.status(201).json({ success: true, data });
});

module.exports = router;
