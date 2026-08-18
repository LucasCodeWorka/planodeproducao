const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const DATA_DIR = path.join(__dirname, "../../data");
const GRUPOS_FILE = path.join(DATA_DIR, "capacidade_grupos.json");
const GRUPO_REFS_FILE = path.join(DATA_DIR, "capacidade_grupo_refs.json");
const DIAS_FILE = path.join(DATA_DIR, "capacidade_dias.json");

// Cache para dias-resumo (evita recalcular a cada requisição)
const diasResumoCache = { data: null, timestamp: 0 };
const DIAS_RESUMO_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

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

function parseListQuery(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => String(item || "").trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 2000);
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
  if (Array.isArray(filters.idreferencias) && filters.idreferencias.length) {
    params.push(filters.idreferencias);
    where.push(`base.idreferencia = ANY($${params.length}::text[])`);
  }
  if (Array.isArray(filters.referencias) && filters.referencias.length) {
    params.push(filters.referencias);
    where.push(`base.referencia_padrao = ANY($${params.length}::text[])`);
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
    const idreferencias = parseListQuery(req.query.idreferencias);
    const referencias = parseListQuery(req.query.referencias);
    const includeDiagnostico = req.query.diagnostico === "true";
    const result = await queryTempoBaseRows(pool, referenciaFiltro
      ? { idreferencia: referenciaFiltro }
      : { idreferencias, referencias });

    const map = new Map();
    const debugMap = includeDiagnostico ? new Map() : null;
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
      if (!debugMap) continue;
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

    const payload = { success: true, total: data.length, data };
    if (debugMap) {
      payload.diagnostico = Array.from(debugMap.values()).map((row) => ({
        idreferencia: row.idreferencia,
        referencia_padrao: row.referencia_padrao || '',
        operacoes: row.operacoes,
        operacoes_com_tempo: row.operacoes_com_tempo,
        tipos_operacao: Array.from(row.tipos_operacao).sort(),
      }));
    }

    return res.json(payload);
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

// ── GET /api/capacidade/matriz ─────────────────────────────────────────────────
// Endpoint otimizado que retorna a matriz de capacidade já calculada
// Faz todos os cálculos no backend para melhor performance
router.get("/matriz", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const { readCache } = require('../cache/matrizCache');
    const projecoesService = require('../services/projecoesService');

    // 1. Carregar todas as configurações em paralelo
    const grupos = readGrupos();
    const grupoRefs = readGrupoRefs();
    const dias = readDias();

    // 2. Carregar tempos por referência
    const temposResult = await queryTempoBaseRows(pool, {});
    const tempoPorRef = new Map();
    for (const row of temposResult.rows || []) {
      const idreferencia = String(row.idreferencia || "").trim().toUpperCase();
      if (!idreferencia) continue;
      const base = resolveTempoLikePowerBi(row.hr_tempo, row.hr_tempopadrao);
      const total = Number.isFinite(base) ? base : 0;
      const atual = tempoPorRef.get(idreferencia) || 0;
      tempoPorRef.set(idreferencia, atual + total);
    }

    // 3. Carregar matriz da cache
    const matrizCache = await readCache();
    const matrizRows = Array.isArray(matrizCache?.data?.rows)
      ? matrizCache.data.rows
      : (Array.isArray(matrizCache?.data?.data) ? matrizCache.data.data : []);

    // 4. Carregar projeções
    const anoAtual = new Date().getFullYear();
    let projecoes = {};
    try {
      projecoes = await projecoesService.lerProjecoesMultiplosAnos(pool, [anoAtual, anoAtual + 1]);
    } catch { /* silencioso */ }

    // 5. Calcular períodos
    const hoje = new Date();
    const mesAtualJs = hoje.getMonth();
    const ano = hoje.getFullYear();
    const diaAtual = hoje.getDate();
    const ultimoDia = new Date(ano, mesAtualJs + 1, 0).getDate();
    const eUltimoDia = diaAtual === ultimoDia;
    let ma = eUltimoDia ? mesAtualJs + 2 : mesAtualJs + 1;
    if (ma > 12) ma -= 12;
    const px = ma + 1 > 12 ? ma + 1 - 12 : ma + 1;
    const ul = ma + 2 > 12 ? ma + 2 - 12 : ma + 2;
    const qt = ma + 3 > 12 ? ma + 3 - 12 : ma + 3;
    const qu = ma + 4 > 12 ? ma + 4 - 12 : ma + 4;
    const sx = ma + 5 > 12 ? ma + 5 - 12 : ma + 5;
    const periodos = { MA: ma, PX: px, UL: ul, QT: qt, QU: qu, SX: sx };

    // 6. Criar mapa de planos por referência (agregado da matriz)
    const planoPorRefMap = new Map();
    const processoPorRefMap = new Map();
    const seqgrupoPorRefMap = new Map();

    for (const item of matrizRows) {
      const marca = String(item?.produto?.marca || '').trim().toUpperCase();
      const status = String(item?.produto?.status || '').trim().toUpperCase();
      const descricao = String(item?.produto?.produto || '').trim().toUpperCase();

      // Filtro de marca e status
      if (marca !== 'LIEBE') continue;
      if (!['EM LINHA', 'NOVA COLECAO'].includes(status)) continue;
      if (descricao.includes('MEIA DE SEDA')) continue;

      const refPadrao = String(item?.produto?.referencia || '').trim().toUpperCase();
      const refSistema = String(item?.produto?.cd_seqgrupo || '').trim().toUpperCase();
      const emProcesso = Number(item?.estoques?.em_processo || 0);
      const planoMA = Number(item?.plano?.ma || 0);
      const planoPX = Number(item?.plano?.px || 0);
      const planoUL = Number(item?.plano?.ul || 0);
      const planoQT = Number(item?.plano?.qt || 0);
      const planoQU = Number(item?.plano?.qu || 0);
      const planoSX = Number(item?.plano?.sx || 0);

      // Agregar por referência
      for (const chave of [refPadrao, refSistema]) {
        if (!chave) continue;
        const atual = planoPorRefMap.get(chave) || { ma: 0, px: 0, ul: 0, qt: 0, qu: 0, sx: 0 };
        atual.ma += planoMA;
        atual.px += planoPX;
        atual.ul += planoUL;
        atual.qt += planoQT;
        atual.qu += planoQU;
        atual.sx += planoSX;
        planoPorRefMap.set(chave, atual);

        const processoAtual = processoPorRefMap.get(chave) || 0;
        processoPorRefMap.set(chave, processoAtual + emProcesso);
      }

      // Mapear seqgrupo
      if (refPadrao && refSistema && !seqgrupoPorRefMap.has(refPadrao)) {
        seqgrupoPorRefMap.set(refPadrao, refSistema);
      }
    }

    // 7. Criar mapa de capacidade por grupo
    const capacidadePorGrupo = new Map();
    for (const g of grupos) {
      capacidadePorGrupo.set(g.grupo.toUpperCase(), g.capacidade_diaria);
    }

    // 8. Criar mapa de grupos por referência (para rateio)
    const gruposPorRef = new Map();
    for (const row of grupoRefs) {
      const ref = row.referencia.toUpperCase();
      const grupo = row.grupo.toUpperCase();
      const atual = gruposPorRef.get(ref) || [];
      if (!atual.includes(grupo)) atual.push(grupo);
      gruposPorRef.set(ref, atual);
    }

    // 9. Calcular detalhes por referência dentro de cada grupo
    const detalhesPorGrupo = new Map();

    for (const row of grupoRefs) {
      const referencia = row.referencia.toUpperCase();
      const grupo = row.grupo.toUpperCase();
      const idreferencia = seqgrupoPorRefMap.get(referencia) || '';
      const planoBase = planoPorRefMap.get(referencia) || { ma: 0, px: 0, ul: 0, qt: 0, qu: 0, sx: 0 };
      const tempo = tempoPorRef.get(idreferencia) || 0;
      const processoBase = processoPorRefMap.get(referencia) || 0;
      const gruposDaRef = gruposPorRef.get(referencia) || [];

      // Calcular rateio
      const capacidadeTotalRateio = gruposDaRef.reduce((acc, g) => acc + (capacidadePorGrupo.get(g) || 0), 0);
      const capacidadeGrupoAtual = capacidadePorGrupo.get(grupo) || 0;
      const rateio = gruposDaRef.length <= 1
        ? 1
        : (capacidadeTotalRateio > 0 ? (capacidadeGrupoAtual / capacidadeTotalRateio) : (1 / gruposDaRef.length));

      // Aplicar rateio aos planos
      const plano = {
        ma: planoBase.ma * rateio,
        px: planoBase.px * rateio,
        ul: planoBase.ul * rateio,
        qt: planoBase.qt * rateio,
        qu: planoBase.qu * rateio,
        sx: planoBase.sx * rateio,
      };
      const processoPecas = processoBase * rateio;
      const processoCarga = tempo * processoPecas;

      const detalhe = {
        referencia,
        idreferencia,
        rateio: Number((rateio * 100).toFixed(2)),
        tempo: Number(tempo.toFixed(2)),
        processoPecas: Math.round(processoPecas),
        processoCarga: Number(processoCarga.toFixed(2)),
        planoMA: Math.round(plano.ma),
        planoPX: Math.round(plano.px),
        planoUL: Math.round(plano.ul),
        planoQT: Math.round(plano.qt),
        planoQU: Math.round(plano.qu),
        planoSX: Math.round(plano.sx),
        cargaMA: Number((tempo * plano.ma).toFixed(2)),
        cargaPX: Number((tempo * plano.px).toFixed(2)),
        cargaUL: Number((tempo * plano.ul).toFixed(2)),
        cargaQT: Number((tempo * plano.qt).toFixed(2)),
        cargaQU: Number((tempo * plano.qu).toFixed(2)),
        cargaSX: Number((tempo * plano.sx).toFixed(2)),
        cargaTotal: Number((processoCarga + tempo * (plano.ma + plano.px + plano.ul + plano.qt + plano.qu + plano.sx)).toFixed(2)),
      };

      if (!detalhesPorGrupo.has(grupo)) detalhesPorGrupo.set(grupo, []);
      detalhesPorGrupo.get(grupo).push(detalhe);
    }

    // 10. Calcular análise por grupo
    const gruposAnalise = [];
    let totalGeral = {
      grupos: 0,
      refs: 0,
      refsComTempo: 0,
      capacidadeDiaria: 0,
      processoPecas: 0,
      processoCarga: 0,
      planoMA: 0, planoPX: 0, planoUL: 0, planoQT: 0, planoQU: 0, planoSX: 0,
      cargaMA: 0, cargaPX: 0, cargaUL: 0, cargaQT: 0, cargaQU: 0, cargaSX: 0,
      capacidadeMA: 0, capacidadePX: 0, capacidadeUL: 0, capacidadeQT: 0, capacidadeQU: 0, capacidadeSX: 0,
    };

    for (const g of grupos) {
      const grupo = g.grupo.toUpperCase();
      const refs = detalhesPorGrupo.get(grupo) || [];
      const capacidadeDiaria = g.capacidade_diaria;

      // Capacidades por mês
      const capacidadeMA = capacidadeDiaria * (dias[String(periodos.MA)] || 0);
      const capacidadePX = capacidadeDiaria * (dias[String(periodos.PX)] || 0);
      const capacidadeUL = capacidadeDiaria * (dias[String(periodos.UL)] || 0);
      const capacidadeQT = capacidadeDiaria * (dias[String(periodos.QT)] || 0);
      const capacidadeQU = capacidadeDiaria * (dias[String(periodos.QU)] || 0);
      const capacidadeSX = capacidadeDiaria * (dias[String(periodos.SX)] || 0);

      // Somar referências
      const processoPecas = refs.reduce((acc, r) => acc + r.processoPecas, 0);
      const processoCarga = refs.reduce((acc, r) => acc + r.processoCarga, 0);
      const planoMA = refs.reduce((acc, r) => acc + r.planoMA, 0);
      const planoPX = refs.reduce((acc, r) => acc + r.planoPX, 0);
      const planoUL = refs.reduce((acc, r) => acc + r.planoUL, 0);
      const planoQT = refs.reduce((acc, r) => acc + r.planoQT, 0);
      const planoQU = refs.reduce((acc, r) => acc + r.planoQU, 0);
      const planoSX = refs.reduce((acc, r) => acc + r.planoSX, 0);
      const cargaMAPlano = refs.reduce((acc, r) => acc + r.cargaMA, 0);
      const cargaMA = cargaMAPlano + processoCarga; // Processo entra em MA
      const cargaPX = refs.reduce((acc, r) => acc + r.cargaPX, 0);
      const cargaUL = refs.reduce((acc, r) => acc + r.cargaUL, 0);
      const cargaQT = refs.reduce((acc, r) => acc + r.cargaQT, 0);
      const cargaQU = refs.reduce((acc, r) => acc + r.cargaQU, 0);
      const cargaSX = refs.reduce((acc, r) => acc + r.cargaSX, 0);
      const refsComTempo = refs.filter(r => r.tempo > 0).length;

      // Saldos
      const saldoMA = capacidadeMA - cargaMA;
      const saldoPX = capacidadePX - cargaPX;
      const saldoUL = capacidadeUL - cargaUL;
      const saldoQT = capacidadeQT - cargaQT;
      const saldoQU = capacidadeQU - cargaQU;
      const saldoSX = capacidadeSX - cargaSX;

      // Saldos acumulados
      const saldoAcumMA = saldoMA;
      const saldoAcumPX = saldoAcumMA + saldoPX;
      const saldoAcumUL = saldoAcumPX + saldoUL;
      const saldoAcumQT = saldoAcumUL + saldoQT;
      const saldoAcumQU = saldoAcumQT + saldoQU;
      const saldoAcumSX = saldoAcumQU + saldoSX;

      // Atendimento (%)
      const atendimentoMA = cargaMA > 0 ? Math.min(100, (capacidadeMA / cargaMA) * 100) : 100;
      const atendimentoPX = cargaPX > 0 ? Math.min(100, ((Math.max(0, saldoAcumMA) + capacidadePX) / cargaPX) * 100) : 100;
      const atendimentoUL = cargaUL > 0 ? Math.min(100, ((Math.max(0, saldoAcumPX) + capacidadeUL) / cargaUL) * 100) : 100;
      const atendimentoQT = cargaQT > 0 ? Math.min(100, ((Math.max(0, saldoAcumUL) + capacidadeQT) / cargaQT) * 100) : 100;
      const atendimentoQU = cargaQU > 0 ? Math.min(100, ((Math.max(0, saldoAcumQT) + capacidadeQU) / cargaQU) * 100) : 100;
      const atendimentoSX = cargaSX > 0 ? Math.min(100, ((Math.max(0, saldoAcumQU) + capacidadeSX) / cargaSX) * 100) : 100;

      // Dias necessários
      const diasNecMA = capacidadeDiaria > 0 ? cargaMA / capacidadeDiaria : 0;
      const diasNecPX = capacidadeDiaria > 0 ? cargaPX / capacidadeDiaria : 0;
      const diasNecUL = capacidadeDiaria > 0 ? cargaUL / capacidadeDiaria : 0;
      const diasNecQT = capacidadeDiaria > 0 ? cargaQT / capacidadeDiaria : 0;
      const diasNecQU = capacidadeDiaria > 0 ? cargaQU / capacidadeDiaria : 0;
      const diasNecSX = capacidadeDiaria > 0 ? cargaSX / capacidadeDiaria : 0;

      // Dias faltantes
      const diasFaltMA = Math.max(0, diasNecMA - (dias[String(periodos.MA)] || 0));
      const diasFaltPX = Math.max(0, diasNecPX - (dias[String(periodos.PX)] || 0) - Math.max(0, saldoAcumMA / Math.max(1, capacidadeDiaria)));
      const diasFaltUL = Math.max(0, diasNecUL - (dias[String(periodos.UL)] || 0) - Math.max(0, saldoAcumPX / Math.max(1, capacidadeDiaria)));
      const diasFaltQT = Math.max(0, diasNecQT - (dias[String(periodos.QT)] || 0) - Math.max(0, saldoAcumUL / Math.max(1, capacidadeDiaria)));
      const diasFaltQU = Math.max(0, diasNecQU - (dias[String(periodos.QU)] || 0) - Math.max(0, saldoAcumQT / Math.max(1, capacidadeDiaria)));
      const diasFaltSX = Math.max(0, diasNecSX - (dias[String(periodos.SX)] || 0) - Math.max(0, saldoAcumQU / Math.max(1, capacidadeDiaria)));

      const cargaTotal = cargaMA + cargaPX + cargaUL + cargaQT + cargaQU + cargaSX;
      const capacidadeTotal = capacidadeMA + capacidadePX + capacidadeUL + capacidadeQT + capacidadeQU + capacidadeSX;

      gruposAnalise.push({
        grupo,
        tipo: g.tipo || '-',
        capacidadeDiaria,
        refs: refs.length,
        refsComTempo,
        referencias: refs, // Incluir detalhes das referências
        processoPecas,
        processoCarga: Number(processoCarga.toFixed(2)),
        planoMA, planoPX, planoUL, planoQT, planoQU, planoSX,
        cargaMA: Number(cargaMA.toFixed(2)),
        cargaPX: Number(cargaPX.toFixed(2)),
        cargaUL: Number(cargaUL.toFixed(2)),
        cargaQT: Number(cargaQT.toFixed(2)),
        cargaQU: Number(cargaQU.toFixed(2)),
        cargaSX: Number(cargaSX.toFixed(2)),
        cargaTotal: Number(cargaTotal.toFixed(2)),
        capacidadeMA, capacidadePX, capacidadeUL, capacidadeQT, capacidadeQU, capacidadeSX,
        capacidadeTotal,
        saldoMA: Number(saldoMA.toFixed(2)),
        saldoPX: Number(saldoPX.toFixed(2)),
        saldoUL: Number(saldoUL.toFixed(2)),
        saldoQT: Number(saldoQT.toFixed(2)),
        saldoQU: Number(saldoQU.toFixed(2)),
        saldoSX: Number(saldoSX.toFixed(2)),
        saldoAcumMA: Number(saldoAcumMA.toFixed(2)),
        saldoAcumPX: Number(saldoAcumPX.toFixed(2)),
        saldoAcumUL: Number(saldoAcumUL.toFixed(2)),
        saldoAcumQT: Number(saldoAcumQT.toFixed(2)),
        saldoAcumQU: Number(saldoAcumQU.toFixed(2)),
        saldoAcumSX: Number(saldoAcumSX.toFixed(2)),
        atendimentoMA: Number(atendimentoMA.toFixed(1)),
        atendimentoPX: Number(atendimentoPX.toFixed(1)),
        atendimentoUL: Number(atendimentoUL.toFixed(1)),
        atendimentoQT: Number(atendimentoQT.toFixed(1)),
        atendimentoQU: Number(atendimentoQU.toFixed(1)),
        atendimentoSX: Number(atendimentoSX.toFixed(1)),
        diasNecMA: Number(diasNecMA.toFixed(2)),
        diasNecPX: Number(diasNecPX.toFixed(2)),
        diasNecUL: Number(diasNecUL.toFixed(2)),
        diasNecQT: Number(diasNecQT.toFixed(2)),
        diasNecQU: Number(diasNecQU.toFixed(2)),
        diasNecSX: Number(diasNecSX.toFixed(2)),
        diasFaltMA: Number(diasFaltMA.toFixed(2)),
        diasFaltPX: Number(diasFaltPX.toFixed(2)),
        diasFaltUL: Number(diasFaltUL.toFixed(2)),
        diasFaltQT: Number(diasFaltQT.toFixed(2)),
        diasFaltQU: Number(diasFaltQU.toFixed(2)),
        diasFaltSX: Number(diasFaltSX.toFixed(2)),
        estourado: saldoAcumMA < 0 || saldoAcumPX < 0 || saldoAcumUL < 0 || saldoAcumQT < 0 || saldoAcumQU < 0 || saldoAcumSX < 0,
      });

      // Atualizar totais
      totalGeral.grupos++;
      totalGeral.refs += refs.length;
      totalGeral.refsComTempo += refsComTempo;
      totalGeral.capacidadeDiaria += capacidadeDiaria;
      totalGeral.processoPecas += processoPecas;
      totalGeral.processoCarga += processoCarga;
      totalGeral.planoMA += planoMA;
      totalGeral.planoPX += planoPX;
      totalGeral.planoUL += planoUL;
      totalGeral.planoQT += planoQT;
      totalGeral.planoQU += planoQU;
      totalGeral.planoSX += planoSX;
      totalGeral.cargaMA += cargaMA;
      totalGeral.cargaPX += cargaPX;
      totalGeral.cargaUL += cargaUL;
      totalGeral.cargaQT += cargaQT;
      totalGeral.cargaQU += cargaQU;
      totalGeral.cargaSX += cargaSX;
      totalGeral.capacidadeMA += capacidadeMA;
      totalGeral.capacidadePX += capacidadePX;
      totalGeral.capacidadeUL += capacidadeUL;
      totalGeral.capacidadeQT += capacidadeQT;
      totalGeral.capacidadeQU += capacidadeQU;
      totalGeral.capacidadeSX += capacidadeSX;
    }

    // Ordenar por grupo
    gruposAnalise.sort((a, b) => a.grupo.localeCompare(b.grupo));

    // Arredondar totais
    totalGeral.processoCarga = Number(totalGeral.processoCarga.toFixed(2));
    totalGeral.cargaMA = Number(totalGeral.cargaMA.toFixed(2));
    totalGeral.cargaPX = Number(totalGeral.cargaPX.toFixed(2));
    totalGeral.cargaUL = Number(totalGeral.cargaUL.toFixed(2));
    totalGeral.cargaQT = Number(totalGeral.cargaQT.toFixed(2));
    totalGeral.cargaQU = Number(totalGeral.cargaQU.toFixed(2));
    totalGeral.cargaSX = Number(totalGeral.cargaSX.toFixed(2));

    return res.json({
      success: true,
      periodos,
      dias,
      grupos: gruposAnalise,
      resumo: totalGeral,
    });
  } catch (error) {
    console.error('[capacidade/matriz] Erro:', error);
    return res.status(500).json({
      success: false,
      error: "Erro ao calcular matriz de capacidade",
      details: error.message,
    });
  }
});

// ── GET /api/capacidade/dias-resumo ─────────────────────────────────────────────
// Endpoint otimizado com cache de 5 minutos (sem autenticacao para uso no dashboard)
router.get("/dias-resumo", async (req, res) => {
  try {
    // Verificar cache (válido por 5 minutos)
    const forceRefresh = req.query.refresh === 'true';
    if (!forceRefresh && diasResumoCache.data && (Date.now() - diasResumoCache.timestamp) < DIAS_RESUMO_CACHE_TTL) {
      return res.json({ ...diasResumoCache.data, fromCache: true });
    }

    const pool = req.app.get("pool");
    const { readCache } = require('../cache/matrizCache');

    // 1. Carregar configurações
    const grupos = readGrupos();
    const grupoRefs = readGrupoRefs();
    const dias = readDias();

    // 2. Carregar tempos por referência
    const temposResult = await queryTempoBaseRows(pool, {});
    const tempoPorRef = new Map();
    for (const row of temposResult.rows || []) {
      const idreferencia = String(row.idreferencia || "").trim().toUpperCase();
      if (!idreferencia) continue;
      const base = resolveTempoLikePowerBi(row.hr_tempo, row.hr_tempopadrao);
      const total = Number.isFinite(base) ? base : 0;
      const atual = tempoPorRef.get(idreferencia) || 0;
      tempoPorRef.set(idreferencia, atual + total);
    }

    // 3. Carregar matriz da cache
    const matrizCache = await readCache();
    const matrizRows = Array.isArray(matrizCache?.data?.rows)
      ? matrizCache.data.rows
      : (Array.isArray(matrizCache?.data?.data) ? matrizCache.data.data : []);

    // 4. Calcular períodos
    const hoje = new Date();
    const mesAtualJs = hoje.getMonth();
    const ano = hoje.getFullYear();
    const diaAtual = hoje.getDate();
    const ultimoDia = new Date(ano, mesAtualJs + 1, 0).getDate();
    const eUltimoDia = diaAtual === ultimoDia;
    let ma = eUltimoDia ? mesAtualJs + 2 : mesAtualJs + 1;
    if (ma > 12) ma -= 12;
    const px = ma + 1 > 12 ? ma + 1 - 12 : ma + 1;
    const ul = ma + 2 > 12 ? ma + 2 - 12 : ma + 2;
    const qt = ma + 3 > 12 ? ma + 3 - 12 : ma + 3;
    const qu = ma + 4 > 12 ? ma + 4 - 12 : ma + 4;
    const periodos = { MA: ma, PX: px, UL: ul, QT: qt, QU: qu };

    // 5. Criar mapa de planos por referência (agregado da matriz)
    const planoPorRefMap = new Map();
    const processoPorRefMap = new Map();
    const seqgrupoPorRefMap = new Map();

    for (const item of matrizRows) {
      const marca = String(item?.produto?.marca || '').trim().toUpperCase();
      const status = String(item?.produto?.status || '').trim().toUpperCase();
      const descricao = String(item?.produto?.produto || '').trim().toUpperCase();

      if (marca !== 'LIEBE') continue;
      if (!['EM LINHA', 'NOVA COLECAO'].includes(status)) continue;
      if (descricao.includes('MEIA DE SEDA')) continue;

      const refPadrao = String(item?.produto?.referencia || '').trim().toUpperCase();
      const refSistema = String(item?.produto?.cd_seqgrupo || '').trim().toUpperCase();
      const emProcesso = Number(item?.estoques?.em_processo || 0);
      const planoMA = Number(item?.plano?.ma || 0);
      const planoPX = Number(item?.plano?.px || 0);
      const planoUL = Number(item?.plano?.ul || 0);
      const planoQT = Number(item?.plano?.qt || 0);
      const planoQU = Number(item?.plano?.qu || 0);

      for (const chave of [refPadrao, refSistema]) {
        if (!chave) continue;
        const atual = planoPorRefMap.get(chave) || { ma: 0, px: 0, ul: 0, qt: 0, qu: 0 };
        atual.ma += planoMA;
        atual.px += planoPX;
        atual.ul += planoUL;
        atual.qt += planoQT;
        atual.qu += planoQU;
        planoPorRefMap.set(chave, atual);

        const processoAtual = processoPorRefMap.get(chave) || 0;
        processoPorRefMap.set(chave, processoAtual + emProcesso);
      }

      if (refPadrao && refSistema && !seqgrupoPorRefMap.has(refPadrao)) {
        seqgrupoPorRefMap.set(refPadrao, refSistema);
      }
    }

    // 6. Criar mapa de capacidade por grupo
    const capacidadePorGrupo = new Map();
    for (const g of grupos) {
      capacidadePorGrupo.set(g.grupo.toUpperCase(), g.capacidade_diaria);
    }

    // 7. Criar mapa de grupos por referência
    const gruposPorRef = new Map();
    for (const row of grupoRefs) {
      const ref = row.referencia.toUpperCase();
      const grupo = row.grupo.toUpperCase();
      const atual = gruposPorRef.get(ref) || [];
      if (!atual.includes(grupo)) atual.push(grupo);
      gruposPorRef.set(ref, atual);
    }

    // 8. Calcular cargas totais
    let cargaTotal = { processo: 0, MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 };
    let capacidadeDiariaTotal = 0;

    for (const g of grupos) {
      capacidadeDiariaTotal += g.capacidade_diaria;
    }

    for (const row of grupoRefs) {
      const referencia = row.referencia.toUpperCase();
      const idreferencia = seqgrupoPorRefMap.get(referencia) || '';
      const planoBase = planoPorRefMap.get(referencia) || { ma: 0, px: 0, ul: 0, qt: 0, qu: 0 };
      const tempo = tempoPorRef.get(idreferencia) || 0;
      const processoBase = processoPorRefMap.get(referencia) || 0;
      const gruposDaRef = gruposPorRef.get(referencia) || [];

      // Calcular rateio
      const capacidadeTotalRateio = gruposDaRef.reduce((acc, g) => acc + (capacidadePorGrupo.get(g) || 0), 0);
      const rateio = gruposDaRef.length <= 1 ? 1 : (capacidadeTotalRateio > 0 ? 1 : (1 / gruposDaRef.length));
      // Para evitar duplicação, só contar uma vez (quando é o primeiro grupo)
      const primeiroGrupo = gruposDaRef[0] === row.grupo.toUpperCase();
      if (!primeiroGrupo) continue;

      cargaTotal.processo += tempo * processoBase;
      cargaTotal.MA += tempo * planoBase.ma;
      cargaTotal.PX += tempo * planoBase.px;
      cargaTotal.UL += tempo * planoBase.ul;
      cargaTotal.QT += tempo * planoBase.qt;
      cargaTotal.QU += tempo * planoBase.qu;
    }

    // 9. Calcular dias necessários
    const diasNecessarios = {
      MA: capacidadeDiariaTotal > 0 ? (cargaTotal.processo + cargaTotal.MA) / capacidadeDiariaTotal : 0,
      PX: capacidadeDiariaTotal > 0 ? cargaTotal.PX / capacidadeDiariaTotal : 0,
      UL: capacidadeDiariaTotal > 0 ? cargaTotal.UL / capacidadeDiariaTotal : 0,
      QT: capacidadeDiariaTotal > 0 ? cargaTotal.QT / capacidadeDiariaTotal : 0,
      QU: capacidadeDiariaTotal > 0 ? cargaTotal.QU / capacidadeDiariaTotal : 0,
    };

    // 10. Calcular dias acumulados
    const diasAcumulado = {
      MA: diasNecessarios.MA,
      PX: diasNecessarios.MA + diasNecessarios.PX,
      UL: diasNecessarios.MA + diasNecessarios.PX + diasNecessarios.UL,
      QT: diasNecessarios.MA + diasNecessarios.PX + diasNecessarios.UL + diasNecessarios.QT,
      QU: diasNecessarios.MA + diasNecessarios.PX + diasNecessarios.UL + diasNecessarios.QT + diasNecessarios.QU,
    };

    // 11. Calcular dias disponíveis por período
    const diasDisponiveis = {
      MA: Number(dias[String(periodos.MA)] || 0),
      PX: Number(dias[String(periodos.PX)] || 0),
      UL: Number(dias[String(periodos.UL)] || 0),
      QT: Number(dias[String(periodos.QT)] || 0),
      QU: Number(dias[String(periodos.QU)] || 0),
    };

    // Preparar resposta e salvar no cache
    const responseData = {
      success: true,
      capacidadeDiaria: capacidadeDiariaTotal,
      diasNecessarios: {
        MA: Number(diasNecessarios.MA.toFixed(1)),
        PX: Number(diasNecessarios.PX.toFixed(1)),
        UL: Number(diasNecessarios.UL.toFixed(1)),
        QT: Number(diasNecessarios.QT.toFixed(1)),
        QU: Number(diasNecessarios.QU.toFixed(1)),
      },
      diasAcumulado: {
        MA: Number(diasAcumulado.MA.toFixed(1)),
        PX: Number(diasAcumulado.PX.toFixed(1)),
        UL: Number(diasAcumulado.UL.toFixed(1)),
        QT: Number(diasAcumulado.QT.toFixed(1)),
        QU: Number(diasAcumulado.QU.toFixed(1)),
      },
      diasDisponiveis,
      periodos,
    };

    // Salvar no cache
    diasResumoCache.data = responseData;
    diasResumoCache.timestamp = Date.now();

    return res.json(responseData);
  } catch (error) {
    console.error('[capacidade/dias-resumo] Erro:', error);
    return res.status(500).json({
      success: false,
      error: "Erro ao calcular dias resumo",
      details: error.message,
    });
  }
});

module.exports = router;
