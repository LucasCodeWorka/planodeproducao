const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const DATA_DIR = path.join(__dirname, "../../data");
const GRUPOS_FILE = path.join(DATA_DIR, "capacidade_grupos.json");
const GRUPO_REFS_FILE = path.join(DATA_DIR, "capacidade_grupo_refs.json");
const DIAS_FILE = path.join(DATA_DIR, "capacidade_dias.json");

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

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, payload) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
}

function readGrupos() {
  const parsed = readJson(GRUPOS_FILE, { data: [] });
  const rows = Array.isArray(parsed?.data) ? parsed.data : [];
  return rows
    .map((r) => ({
      grupo: String(r.grupo || "").trim().toUpperCase(),
      tipo: String(r.tipo || "").trim().toUpperCase(),
      capacidade_diaria: Number(r.capacidade_diaria || 0),
    }))
    .filter((r) => r.grupo && Number.isFinite(r.capacidade_diaria) && r.capacidade_diaria > 0)
    .sort((a, b) => a.grupo.localeCompare(b.grupo));
}

function writeGrupos(data) {
  writeJson(GRUPOS_FILE, { timestamp: Date.now(), total: data.length, data });
}

function readGrupoRefs() {
  const parsed = readJson(GRUPO_REFS_FILE, { data: [] });
  const rows = Array.isArray(parsed?.data) ? parsed.data : [];
  return rows
    .map((r) => ({
      grupo: String(r.grupo || "").trim().toUpperCase(),
      referencia: String(r.referencia || "").trim().toUpperCase(),
    }))
    .filter((r) => r.grupo && r.referencia)
    .sort((a, b) => (a.grupo + a.referencia).localeCompare(b.grupo + b.referencia));
}

function writeGrupoRefs(data) {
  writeJson(GRUPO_REFS_FILE, { timestamp: Date.now(), total: data.length, data });
}

function buildDefaultDias() {
  return {
    "1": 22, "2": 20, "3": 22, "4": 22, "5": 22, "6": 22,
    "7": 22, "8": 22, "9": 22, "10": 22, "11": 22, "12": 22,
  };
}

function readDias() {
  const parsed = readJson(DIAS_FILE, { data: buildDefaultDias() });
  const src = parsed?.data && typeof parsed.data === "object" ? parsed.data : buildDefaultDias();
  const out = {};
  for (let mes = 1; mes <= 12; mes += 1) {
    const key = String(mes);
    const value = Number(src[key] || 0);
    out[key] = Number.isFinite(value) && value >= 0 ? value : 0;
  }
  return out;
}

function writeDias(data) {
  writeJson(DIAS_FILE, { timestamp: Date.now(), data });
}

function parseNumericLikePowerBi(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function resolveTempoLikePowerBi(hrTempoRaw, hrTempoPadraoRaw) {
  const hrTempo = parseNumericLikePowerBi(hrTempoRaw);
  const hrTempoPadrao = parseNumericLikePowerBi(hrTempoPadraoRaw);
  // In the source model, zero behaves like an empty measured time and must
  // fall back to the standard time, otherwise several references stay far
  // below the benchmark load.
  if (hrTempo === null || hrTempo === 0) {
    return (hrTempoPadrao || 0) * 1440;
  }
  return hrTempo;
}

async function queryTempoBaseRows(pool, filters = {}) {
  const params = [];
  const where = [];
  if (filters.idreferencia) {
    params.push(String(filters.idreferencia).trim().toUpperCase());
    where.push(`base.idreferencia = $${params.length}`);
  }
  if (filters.referencia) {
    params.push(String(filters.referencia).trim().toUpperCase());
    where.push(`base.referencia_padrao = $${params.length}`);
  }

  const sql = `
    WITH refmap AS (
      SELECT
        pg.cd_seqgrupo::TEXT AS idreferencia,
        MAX(COALESCE(f_dic_prd_nivel(pg.cd_produto, 'CD'::bpchar), ''))::TEXT AS referencia_padrao
      FROM public.vr_prd_prdgrade AS pg
      GROUP BY pg.cd_seqgrupo::TEXT
    )
    SELECT
      so.cd_seqgrupopa::TEXT AS idreferencia,
      COALESCE(refmap.referencia_padrao, '')::TEXT AS referencia_padrao,
      COALESCE(so.hr_tempo::TEXT, '') AS hr_tempo,
      COALESCE(op.hr_tempopadrao::TEXT, '') AS hr_tempopadrao,
      COALESCE(so.qt_operacao, 1)::FLOAT AS qt_operacao,
      UPPER(COALESCE(op.ds_tipooperacao, ''))::TEXT AS ds_tipooperacao,
      COALESCE(op.cd_tipooperacao::TEXT, '') AS cd_tipooperacao,
      COALESCE(so.cd_operacao::TEXT, '') AS cd_operacao,
      COALESCE(so.ds_operacao, '')::TEXT AS ds_operacao
    FROM public.vr_cdf_seqope AS so
    INNER JOIN public.vr_cdf_operac AS op ON so.cd_operacao = op.cd_operacao
    LEFT JOIN refmap ON refmap.idreferencia = so.cd_seqgrupopa::TEXT
    ${where.length ? `WHERE ${where.join(" OR ")}` : ""}
    ORDER BY so.cd_seqgrupopa::TEXT, op.cd_tipooperacao, so.cd_operacao
  `;

  return pool.query(sql, params);
}

router.get("/grupos", auth, (_req, res) => {
  const data = readGrupos();
  return res.json({ success: true, total: data.length, data });
});

router.post("/grupos", auth, (req, res) => {
  const rows = Array.isArray(req.body?.data) ? req.body.data : [];
  if (!rows.length) {
    return res.status(400).json({ success: false, error: "data é obrigatório" });
  }
  const map = new Map();
  for (const row of rows) {
    const grupo = String(row?.grupo || "").trim().toUpperCase();
    const tipo = String(row?.tipo || "").trim().toUpperCase();
    const capacidade_diaria = Number(row?.capacidade_diaria || 0);
    if (!grupo || !Number.isFinite(capacidade_diaria) || capacidade_diaria <= 0) continue;
    map.set(grupo, { grupo, tipo, capacidade_diaria });
  }
  const data = Array.from(map.values()).sort((a, b) => a.grupo.localeCompare(b.grupo));
  if (!data.length) {
    return res.status(400).json({ success: false, error: "Nenhum grupo válido para salvar" });
  }
  writeGrupos(data);
  return res.status(201).json({ success: true, total: data.length, data });
});

router.get("/grupo-refs", auth, (_req, res) => {
  const data = readGrupoRefs();
  return res.json({ success: true, total: data.length, data });
});

router.post("/grupo-refs", auth, (req, res) => {
  const rows = Array.isArray(req.body?.data) ? req.body.data : [];
  if (!rows.length) {
    return res.status(400).json({ success: false, error: "data é obrigatório" });
  }
  const map = new Map();
  for (const row of rows) {
    const grupo = String(row?.grupo || "").trim().toUpperCase();
    const referencia = String(row?.referencia || row?.ref || "").trim().toUpperCase();
    if (!grupo || !referencia) continue;
    map.set(`${grupo}__${referencia}`, { grupo, referencia });
  }
  const data = Array.from(map.values()).sort((a, b) => (a.grupo + a.referencia).localeCompare(b.grupo + b.referencia));
  if (!data.length) {
    return res.status(400).json({ success: false, error: "Nenhum vínculo grupo/ref válido para salvar" });
  }
  writeGrupoRefs(data);
  return res.status(201).json({ success: true, total: data.length, data });
});

router.get("/dias", auth, (_req, res) => {
  return res.json({ success: true, data: readDias() });
});

router.post("/dias", auth, (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const data = {};
  for (let mes = 1; mes <= 12; mes += 1) {
    const key = String(mes);
    const value = Number(body[key] || 0);
    data[key] = Number.isFinite(value) && value >= 0 ? value : 0;
  }
  writeDias(data);
  return res.status(201).json({ success: true, data });
});

router.get("/tempos-ref", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const referenciaFiltro = String(req.query.idreferencia || req.query.referencia || "").trim().toUpperCase();
    const result = await queryTempoBaseRows(pool, referenciaFiltro ? { idreferencia: referenciaFiltro } : {});

    const map = new Map();
    const debugMap = new Map();
    for (const row of result.rows || []) {
      const idreferencia = String(row.idreferencia || "").trim().toUpperCase();
      const referenciaPadrao = String(row.referencia_padrao || "").trim().toUpperCase();
      if (!idreferencia) continue;
      const base = resolveTempoLikePowerBi(row.hr_tempo, row.hr_tempopadrao);
      const total = Number.isFinite(base) ? base : 0;
      const atual = map.get(idreferencia) || { idreferencia, referencia_padrao: referenciaPadrao, tempo_segundos: 0 };
      atual.tempo_segundos += total;
      if (!atual.referencia_padrao && referenciaPadrao) atual.referencia_padrao = referenciaPadrao;
      map.set(idreferencia, atual);
      if (!debugMap.has(idreferencia)) {
        debugMap.set(idreferencia, {
          idreferencia,
          referencia_padrao: referenciaPadrao,
          operacoes: 0,
          operacoes_com_tempo: 0,
          tipos_operacao: new Set(),
        });
      }
      const dbg = debugMap.get(idreferencia);
      if (!dbg.referencia_padrao && referenciaPadrao) dbg.referencia_padrao = referenciaPadrao;
      dbg.operacoes += 1;
      if (total > 0) dbg.operacoes_com_tempo += 1;
      if (row.ds_tipooperacao) dbg.tipos_operacao.add(String(row.ds_tipooperacao || '').trim().toUpperCase());
    }

    const data = Array.from(map.values())
      .sort((a, b) => a.idreferencia.localeCompare(b.idreferencia));

    const diagnostico = Array.from(debugMap.values()).map((row) => ({
      idreferencia: row.idreferencia,
      referencia_padrao: row.referencia_padrao || '',
      operacoes: row.operacoes,
      operacoes_com_tempo: row.operacoes_com_tempo,
      tipos_operacao: Array.from(row.tipos_operacao).sort(),
    }));

    return res.json({ success: true, total: data.length, data, diagnostico });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar tempos por referência",
      details: error.message,
    });
  }
});

router.get("/tempo-debug", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const idreferencia = String(req.query.idreferencia || "").trim().toUpperCase();
    const referencia = String(req.query.referencia || "").trim().toUpperCase();
    if (!idreferencia && !referencia) {
      return res.status(400).json({ success: false, error: "Informe idreferencia ou referencia" });
    }

    const result = await queryTempoBaseRows(pool, { idreferencia, referencia });

    let total = 0;
    const data = (result.rows || []).map((row) => {
      const tempo_resolvido = resolveTempoLikePowerBi(row.hr_tempo, row.hr_tempopadrao);
      total += tempo_resolvido;
      return {
        idreferencia: String(row.idreferencia || "").trim().toUpperCase(),
        referencia_padrao: String(row.referencia_padrao || "").trim().toUpperCase(),
        cd_operacao: String(row.cd_operacao || "").trim(),
        ds_operacao: String(row.ds_operacao || "").trim(),
        cd_tipooperacao: String(row.cd_tipooperacao || "").trim(),
        ds_tipooperacao: String(row.ds_tipooperacao || "").trim().toUpperCase(),
        qt_operacao: Number(row.qt_operacao || 0),
        hr_tempo: String(row.hr_tempo || "").trim(),
        hr_tempopadrao: String(row.hr_tempopadrao || "").trim(),
        tempo_resolvido,
      };
    });

    return res.json({
      success: true,
      total: data.length,
      tempo_total: total,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar depuração do tempo",
      details: error.message,
    });
  }
});

router.get("/config", auth, (_req, res) => {
  return res.json({
    success: true,
    data: {
      grupos: readGrupos(),
      grupo_refs: readGrupoRefs(),
      dias: readDias(),
    },
  });
});

module.exports = router;
