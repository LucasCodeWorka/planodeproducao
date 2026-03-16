const express = require("express");
const crypto = require("crypto");

const router = express.Router();
const CACHE_TTL_MS = (Number(process.env.CONSUMO_MP_CACHE_TTL_SECONDS) || 900) * 1000;
const CACHE_SCHEMA_VERSION = "v3_filtro_artigo_mp";

// Cache em memória (TTL 15min — não precisa persistir entre deploys)
const _memCache = new Map();
const EXCLUDED_MP_ARTIGO_TERMS = String(process.env.MP_EXCLUIR_ARTIGOS || "SACOLA,SACO PP,ETIQUETA COMPOSICAO,EMBALAGEM,JOIA")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const EXCLUDED_MP_NOME_TERMS = String(process.env.MP_EXCLUIR_NOMES || "SACOLA,SACO PP,ETIQUETA COMPOSICAO,EMBALAGEM,JOIA")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const EXCLUDED_MP_IDS = new Set(
  String(process.env.MP_EXCLUIR_IDS || "1006032,5001084,5000139,1006176")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

function readCache() {
  return { items: Object.fromEntries(_memCache) };
}

function writeCache(cache) {
  if (cache && typeof cache.items === 'object') {
    for (const [k, v] of Object.entries(cache.items)) {
      _memCache.set(k, v);
    }
    // Limpa entradas expiradas
    const now = Date.now();
    for (const [k, v] of _memCache) {
      if (now - Number(v?.timestamp || 0) > CACHE_TTL_MS) _memCache.delete(k);
    }
  }
}

function buildCacheKey(planos, options = {}) {
  const norm = planos
    .map((p) => ({
      idproduto: String(p?.idproduto || "").trim(),
      idreferencia: String(p?.idreferencia || "").trim(),
      ma: Number(p?.ma || 0),
      px: Number(p?.px || 0),
      ul: Number(p?.ul || 0),
    }))
    .filter((p) => p.idproduto)
    .sort((a, b) => a.idproduto.localeCompare(b.idproduto));

  const hash = crypto.createHash("sha1");
  hash.update(CACHE_SCHEMA_VERSION);
  hash.update(JSON.stringify({
    EXCLUDED_MP_ARTIGO_TERMS,
    EXCLUDED_MP_NOME_TERMS,
    EXCLUDED_MP_IDS: Array.from(EXCLUDED_MP_IDS).sort(),
    options,
  }));
  hash.update(JSON.stringify(norm));
  return hash.digest("hex");
}

function contemTermoBloqueado(texto, termos) {
  const t = String(texto || "").toUpperCase();
  if (!t) return false;
  return termos.some((x) => x && t.includes(x));
}

async function queryEstruturaPorPais(pool, idsPais) {
  try {
    return await pool.query(`
      SELECT
        c.cd_produtopa::TEXT AS idproduto_pa,
        c.cd_seqgrupopa::TEXT AS idreferencia_pa,
        c.cd_produtomp::TEXT AS idmateriaprima,
        SUM(COALESCE(c.qt_consumo, 0))::FLOAT AS qtdconsumo
      FROM vr_pcp_fccconsumo c
      WHERE c.cd_produtopa::TEXT = ANY($1::TEXT[])
      GROUP BY c.cd_produtopa, c.cd_seqgrupopa, c.cd_produtomp
    `, [idsPais]);
  } catch {
    return await pool.query(`
      SELECT
        c.cd_produtopa::TEXT AS idproduto_pa,
        c.cd_seqgrupopa::TEXT AS idreferencia_pa,
        c.cd_produtomp::TEXT AS idmateriaprima,
        SUM(COALESCE(c.qt_consumo, 0))::FLOAT AS qtdconsumo
      FROM vr_pcp_fcconsumo c
      WHERE c.cd_produtopa::TEXT = ANY($1::TEXT[])
      GROUP BY c.cd_produtopa, c.cd_seqgrupopa, c.cd_produtomp
    `, [idsPais]);
  }
}

async function queryEstruturaPorRefs(pool, idsRefs) {
  try {
    return await pool.query(`
      SELECT
        c.cd_produtopa::TEXT AS idproduto_pa,
        c.cd_seqgrupopa::TEXT AS idreferencia_pa,
        c.cd_produtomp::TEXT AS idmateriaprima,
        SUM(COALESCE(c.qt_consumo, 0))::FLOAT AS qtdconsumo
      FROM vr_pcp_fccconsumo c
      WHERE c.cd_seqgrupopa::TEXT = ANY($1::TEXT[])
      GROUP BY c.cd_produtopa, c.cd_seqgrupopa, c.cd_produtomp
    `, [idsRefs]);
  } catch {
    return await pool.query(`
      SELECT
        c.cd_produtopa::TEXT AS idproduto_pa,
        c.cd_seqgrupopa::TEXT AS idreferencia_pa,
        c.cd_produtomp::TEXT AS idmateriaprima,
        SUM(COALESCE(c.qt_consumo, 0))::FLOAT AS qtdconsumo
      FROM vr_pcp_fcconsumo c
      WHERE c.cd_seqgrupopa::TEXT = ANY($1::TEXT[])
      GROUP BY c.cd_produtopa, c.cd_seqgrupopa, c.cd_produtomp
    `, [idsRefs]);
  }
}

router.get("/estrutura", async (req, res) => {
  try {
    const pool = req.app.get("pool");

    let result;
    try {
      result = await pool.query(`
        SELECT
          c.cd_produtopa::TEXT AS idproduto_pa,
          c.cd_produtomp::TEXT AS idmateriaprima,
          SUM(COALESCE(c.qt_consumo, 0))::FLOAT AS qtdconsumo
        FROM vr_pcp_fccconsumo c
        GROUP BY c.cd_produtopa, c.cd_produtomp
      `);
    } catch {
      // fallback para ambientes onde a view está sem o segundo "c"
      result = await pool.query(`
        SELECT
          c.cd_produtopa::TEXT AS idproduto_pa,
          c.cd_produtomp::TEXT AS idmateriaprima,
          SUM(COALESCE(c.qt_consumo, 0))::FLOAT AS qtdconsumo
        FROM vr_pcp_fcconsumo c
        GROUP BY c.cd_produtopa, c.cd_produtomp
      `);
    }

    return res.json({
      success: true,
      total: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar estrutura de consumo MP",
      details: error.message,
    });
  }
});

router.get("/estoque", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const result = await pool.query(`
      SELECT
        a.cd_produto::TEXT AS idmateriaprima,
        MAX(COALESCE(f_dic_sld_prd_produto('1', '1'::text, a.cd_produto, NULL::timestamp), 0))::FLOAT AS estoquefisico,
        MAX(COALESCE(f_dic_sld_prd_produto('1', '2'::text, a.cd_produto, NULL::timestamp), 0))::FLOAT AS estoqueinsp,
        MAX(COALESCE(f_dic_sld_prd_produto('1', '15'::text, a.cd_produto, NULL::timestamp), 0))::FLOAT AS estoquecorte
      FROM public.vr_prd_prdgrade a
      WHERE a.cd_produto >= 1000000
        AND a.cd_produto < 5000000
      GROUP BY a.cd_produto
    `);

    const data = result.rows.map((r) => {
      const fis = Number(r.estoquefisico || 0);
      const insp = Number(r.estoqueinsp || 0);
      const corte = Number(r.estoquecorte || 0);
      return {
        idmateriaprima: String(r.idmateriaprima || ""),
        estoquefisico: fis,
        estoqueinsp: insp,
        estoquecorte: corte,
        estoquetotal: fis + insp + corte,
      };
    });

    return res.json({
      success: true,
      total: data.length,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar estoque de MP",
      details: error.message,
    });
  }
});

router.post("/analise", async (req, res) => {
  try {
    const planos = Array.isArray(req.body?.planos) ? req.body.planos : [];
    const usarMultinivel = req.body?.multinivel === true || req.query.multinivel === "true";
    const maxDepth = Math.max(1, Math.min(Number(req.body?.max_depth || process.env.CONSUMO_MP_MAX_DEPTH || 6), 12));
    const cacheKey = buildCacheKey(planos, { usarMultinivel, maxDepth });
    const noCache = req.query.no_cache === "true";

    if (!noCache) {
      const cache = readCache();
      const item = cache?.items?.[cacheKey];
      if (item && (Date.now() - Number(item.timestamp || 0)) <= CACHE_TTL_MS) {
        return res.json({
          ...item.payload,
          meta: {
            ...(item.payload?.meta || {}),
            cacheHit: true,
            cacheAgeSec: Math.round((Date.now() - Number(item.timestamp || 0)) / 1000),
          },
        });
      }
    }

    if (!planos.length) {
      const payload = {
        success: true,
        total: 0,
        meta: {
          planosRecebidos: 0,
          idsPaSelecionados: 0,
          idsRefSelecionados: 0,
          modoLigacao: "cd_produtopa",
          estruturaEncontrada: 0,
          materiasPrimasMapeadas: 0,
        },
        data: [],
      };
      return res.json(payload);
    }

    const planoMap = new Map();
    const planoRefMap = new Map();
    const planoScopeMap = new Map();
    for (const p of planos) {
      const id = String(p?.idproduto || "").trim();
      const ref = String(p?.idreferencia || "").trim();
      const ma = Number(p?.ma || 0);
      const px = Number(p?.px || 0);
      const ul = Number(p?.ul || 0);
      const maScope = Number(p?.ma_scope || 0);
      if (!id) continue;
      if (!planoMap.has(id)) {
        planoMap.set(id, { ma: 0, px: 0, ul: 0 });
      }
      const accPlano = planoMap.get(id);
      accPlano.ma += ma;
      accPlano.px += px;
      accPlano.ul += ul;
      if (!planoScopeMap.has(id)) {
        planoScopeMap.set(id, { idreferencia: ref, ma_scope: 0 });
      }
      const accScope = planoScopeMap.get(id);
      if (!accScope.idreferencia && ref) accScope.idreferencia = ref;
      accScope.ma_scope += maScope;
      if (ref) {
        if (!planoRefMap.has(ref)) planoRefMap.set(ref, { ma: 0, px: 0, ul: 0 });
        const acc = planoRefMap.get(ref);
        acc.ma += ma;
        acc.px += px;
        acc.ul += ul;
      }
    }
    const idsPa = Array.from(planoMap.keys()).map((v) => String(v).trim()).filter(Boolean);
    if (!idsPa.length) {
      return res.status(400).json({ success: false, error: "Nenhum idproduto válido em planos" });
    }

    const pool = req.app.get("pool");
    let estruturaRows = await queryEstruturaPorPais(pool, idsPa);
    let modoLigacao = "cd_produtopa";
    if (!estruturaRows.rows.length && planoRefMap.size > 0) {
      const idsRef = Array.from(planoRefMap.keys());
      modoLigacao = "cd_seqgrupopa";
      estruturaRows = await queryEstruturaPorRefs(pool, idsRef);
    }

    const consumoMap = new Map();
    const bomByParent = new Map();
    const refByProduto = new Map();
    const visitedParentQuery = new Set();
    let totalEstruturaRows = 0;

    function addBomRows(rows) {
      totalEstruturaRows += rows.length;
      for (const r of rows) {
        const idPa = String(r.idproduto_pa || "");
        const idMp = String(r.idmateriaprima || "");
        if (!idPa || !idMp) continue;
        const qtd = Number(r.qtdconsumo || 0);
        if (qtd <= 0) continue;
        const idRef = String(r.idreferencia_pa || "").trim();
        if (idRef && !refByProduto.has(idPa)) refByProduto.set(idPa, idRef);
        if (!bomByParent.has(idPa)) bomByParent.set(idPa, []);
        bomByParent.get(idPa).push({ idmateriaprima: idMp, qtdconsumo: qtd });
      }
    }

    addBomRows(estruturaRows.rows);
    idsPa.forEach((id) => visitedParentQuery.add(String(id)));

    if (usarMultinivel) {
      let frontier = new Set();
      for (const rows of bomByParent.values()) {
        for (const e of rows) frontier.add(String(e.idmateriaprima || ""));
      }

      let depth = 1;
      while (frontier.size > 0 && depth < maxDepth) {
        const batch = Array.from(frontier).filter((id) => id && !visitedParentQuery.has(id));
        frontier = new Set();
        if (!batch.length) break;
        batch.forEach((id) => visitedParentQuery.add(id));

        const nextRowsResult = await queryEstruturaPorPais(pool, batch);
        addBomRows(nextRowsResult.rows);

        for (const r of nextRowsResult.rows) {
          const child = String(r.idmateriaprima || "");
          if (child) frontier.add(child);
        }
        depth += 1;
      }
    }

    if (!usarMultinivel) {
      for (const r of estruturaRows.rows) {
        const idPa = String(r.idproduto_pa || "");
        const idMp = String(r.idmateriaprima || "");
        if (!idPa || !idMp) continue;
        const qtd = Number(r.qtdconsumo || 0);
        if (qtd <= 0) continue;
        const idRef = String(r.idreferencia_pa || "");
        const plano = modoLigacao === "cd_produtopa"
          ? planoMap.get(idPa)
          : planoRefMap.get(idRef);
        if (!plano) continue;
        if (!consumoMap.has(idMp)) {
          consumoMap.set(idMp, { consumo_ma: 0, consumo_px: 0, consumo_ul: 0 });
        }
        const acc = consumoMap.get(idMp);
        acc.consumo_ma += plano.ma * qtd;
        acc.consumo_px += plano.px * qtd;
        acc.consumo_ul += plano.ul * qtd;
      }
    } else {
      function explode(parentId, demanda, depth, trail) {
        if (depth > maxDepth) return;
        const edges = bomByParent.get(parentId) || [];
        if (!edges.length) return;
        for (const e of edges) {
          const childId = String(e.idmateriaprima || "");
          const fator = Number(e.qtdconsumo || 0);
          if (!childId || fator <= 0) continue;
          const childDem = {
            ma: demanda.ma * fator,
            px: demanda.px * fator,
            ul: demanda.ul * fator,
          };
          // Sempre contabiliza o filho como necessidade (inclui semiacabados, ex.: alça).
          if (!consumoMap.has(childId)) {
            consumoMap.set(childId, { consumo_ma: 0, consumo_px: 0, consumo_ul: 0 });
          }
          const acc = consumoMap.get(childId);
          acc.consumo_ma += childDem.ma;
          acc.consumo_px += childDem.px;
          acc.consumo_ul += childDem.ul;

          const childHasBom = (bomByParent.get(childId) || []).length > 0;
          const ciclo = trail.has(childId);
          if (childHasBom && !ciclo && depth < maxDepth) {
            const nextTrail = new Set(trail);
            nextTrail.add(childId);
            explode(childId, childDem, depth + 1, nextTrail);
          }
        }
      }

      for (const [idPa, plano] of planoMap.entries()) {
        const start = new Set([idPa]);
        explode(idPa, { ma: Number(plano.ma || 0), px: Number(plano.px || 0), ul: Number(plano.ul || 0) }, 1, start);
      }
    }

    const idsMp = Array.from(consumoMap.keys()).map((v) => String(v).trim()).filter(Boolean);
    if (!idsMp.length) return res.json({ success: true, total: 0, data: [] });

    const estoqueRows = await pool.query(`
      SELECT
        a.cd_produto::TEXT AS idmateriaprima,
        MAX(COALESCE(a.nm_produto, ''))::TEXT AS nome_materiaprima,
        MAX(COALESCE(f_dic_prd_nivel(a.cd_produto, 'DS'::bpchar), ''))::TEXT AS materia_prima_ds,
        MAX(COALESCE(f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 111::bigint), ''))::TEXT AS artigo,
        MAX(COALESCE(f_dic_sld_prd_produto('1', '1'::text, a.cd_produto, NULL::timestamp), 0))::FLOAT AS estoquefisico,
        MAX(COALESCE(f_dic_sld_prd_produto('1', '2'::text, a.cd_produto, NULL::timestamp), 0))::FLOAT AS estoqueinsp,
        MAX(COALESCE(f_dic_sld_prd_produto('1', '15'::text, a.cd_produto, NULL::timestamp), 0))::FLOAT AS estoquecorte
      FROM public.vr_prd_prdgrade a
      WHERE a.cd_produto::TEXT = ANY($1::TEXT[])
      GROUP BY a.cd_produto
    `, [idsMp]);

    const estoqueMap = new Map(estoqueRows.rows.map((r) => [String(r.idmateriaprima || ""), r]));

    const data = Array.from(consumoMap.entries()).map(([idmateriaprima, c]) => {
      const e = estoqueMap.get(idmateriaprima) || {};
      const fis = Number(e.estoquefisico || 0);
      const insp = Number(e.estoqueinsp || 0);
      const corte = Number(e.estoquecorte || 0);
      const nome_materiaprima = String(e.materia_prima_ds || e.nome_materiaprima || "").trim();
      const artigo = String(e.artigo || "").trim();
      const estoquetotal = fis + insp + corte;
      const consumo_ma = Number(c.consumo_ma || 0);
      const consumo_px = Number(c.consumo_px || 0);
      const consumo_ul = Number(c.consumo_ul || 0);
      const saldo_ma = estoquetotal - consumo_ma;
      const saldo_px = saldo_ma - consumo_px;
      const saldo_ul = saldo_px - consumo_ul;
      const consumo_total = consumo_ma + consumo_px + consumo_ul;
      return {
        idmateriaprima,
        nome_materiaprima,
        artigo,
        estoquefisico: fis,
        estoqueinsp: insp,
        estoquecorte: corte,
        estoquetotal,
        consumo_ma,
        consumo_px,
        consumo_ul,
        consumo_total,
        saldo_ma,
        saldo_px,
        saldo_ul,
        saldo: saldo_ul,
      };
    })
      .filter((d) => {
        if (EXCLUDED_MP_IDS.has(String(d.idmateriaprima || "").trim())) return false;
        if (contemTermoBloqueado(d.artigo, EXCLUDED_MP_ARTIGO_TERMS)) return false;
        if (contemTermoBloqueado(d.nome_materiaprima, EXCLUDED_MP_NOME_TERMS)) return false;
        return true;
      })
      .sort((a, b) => a.saldo - b.saldo);

    const mpCriticasSet = new Set(
      data.filter((d) => Number(d.saldo_ma || 0) < 0).map((d) => String(d.idmateriaprima || ""))
    );

    const mpPorProduto = new Map();
    for (const [idPa, edges] of bomByParent.entries()) {
      if (!mpPorProduto.has(idPa)) mpPorProduto.set(idPa, new Set());
      const setMp = mpPorProduto.get(idPa);
      for (const e of edges || []) {
        const idMp = String(e.idmateriaprima || "");
        if (idMp) setMp.add(idMp);
      }
    }

    let totalScopeMA = 0;
    let viavelScopeMA = 0;
    const refsViaveis = new Set();
    const refsBloqueadas = new Set();
    const bloqueiosPorRef = new Map();

    for (const [idProduto, s] of planoScopeMap.entries()) {
      const maScope = Math.max(0, Number(s?.ma_scope || 0));
      if (maScope <= 0) continue;
      totalScopeMA += maScope;
      const idRef = String(s?.idreferencia || "");
      const mps = Array.from(mpPorProduto.get(idProduto) || []);
      const criticasDoProduto = mps.filter((mp) => mpCriticasSet.has(mp));
      const bloqueado = criticasDoProduto.length > 0;

      if (!bloqueado) {
        viavelScopeMA += maScope;
        if (idRef) refsViaveis.add(idRef);
      } else {
        if (idRef) refsBloqueadas.add(idRef);
        if (idRef && !bloqueiosPorRef.has(idRef)) bloqueiosPorRef.set(idRef, new Set());
        if (idRef) {
          const setRef = bloqueiosPorRef.get(idRef);
          criticasDoProduto.forEach((mp) => setRef.add(mp));
        }
      }
    }

    const refsEscopoMap = new Map();
    const refsPlanoTotalMap = new Map();
    for (const [idProduto, s] of planoScopeMap.entries()) {
      const maScope = Math.max(0, Number(s?.ma_scope || 0));
      if (maScope <= 0) continue;
      const idRef = String(s?.idreferencia || "").trim();
      if (!idRef) continue;
      if (!refsEscopoMap.has(idRef)) {
        refsEscopoMap.set(idRef, {
          idreferencia: idRef,
          materiasprimas_set: new Set(),
          materiasprimas_criticas_set: new Set(),
        });
      }
      const mps = Array.from(mpPorProduto.get(idProduto) || []);
      const criticasDoProduto = mps.filter((mp) => mpCriticasSet.has(mp));
      const accRef = refsEscopoMap.get(idRef);
      mps.forEach((mp) => accRef.materiasprimas_set.add(mp));
      criticasDoProduto.forEach((mp) => accRef.materiasprimas_criticas_set.add(mp));
    }

    for (const [idProduto, plano] of planoMap.entries()) {
      const maTotal = Math.max(0, Number(plano?.ma || 0));
      if (maTotal <= 0) continue;
      let idRef = String(planoScopeMap.get(idProduto)?.idreferencia || "").trim();
      if (!idRef) {
        idRef = String(refByProduto.get(idProduto) || "").trim();
      }
      if (!idRef) continue;
      if (!refsPlanoTotalMap.has(idRef)) {
        refsPlanoTotalMap.set(idRef, {
          idreferencia: idRef,
          materiasprimas_set: new Set(),
          materiasprimas_criticas_set: new Set(),
        });
      }
      const mps = Array.from(mpPorProduto.get(idProduto) || []);
      const criticasDoProduto = mps.filter((mp) => mpCriticasSet.has(mp));
      const accRef = refsPlanoTotalMap.get(idRef);
      mps.forEach((mp) => accRef.materiasprimas_set.add(mp));
      criticasDoProduto.forEach((mp) => accRef.materiasprimas_criticas_set.add(mp));
    }

    const mpDataMap = new Map(
      data.map((d) => [
        String(d.idmateriaprima || ""),
        {
          nome_materiaprima: String(d.nome_materiaprima || ""),
          estoquetotal: Number(d.estoquetotal || 0),
          consumo_ma: Number(d.consumo_ma || 0),
          consumo_px: Number(d.consumo_px || 0),
          consumo_ul: Number(d.consumo_ul || 0),
          saldo_ma: Number(d.saldo_ma || 0),
          saldo_px: Number(d.saldo_px || 0),
          saldo_ul: Number(d.saldo_ul || 0),
          deficit_ma: Math.max(0, -Number(d.saldo_ma || 0)),
          deficit_px: Math.max(0, -Number(d.saldo_px || 0)),
          deficit_ul: Math.max(0, -Number(d.saldo_ul || 0)),
        },
      ])
    );

    const refsEscopoDetalhe = Array.from(refsEscopoMap.values()).map((r) => {
      const materiasTodas = Array.from(r.materiasprimas_set || []);
      const materias = Array.from(r.materiasprimas_criticas_set);
      const materiasDetalhe = materias.map((idmateriaprima) => {
        const info = mpDataMap.get(idmateriaprima) || {
          nome_materiaprima: "",
          estoquetotal: 0,
          consumo_ma: 0,
          consumo_px: 0,
          consumo_ul: 0,
          saldo_ma: 0,
          saldo_px: 0,
          saldo_ul: 0,
          deficit_ma: 0,
          deficit_px: 0,
          deficit_ul: 0,
        };
        return {
          idmateriaprima,
          nome_materiaprima: info.nome_materiaprima,
          estoquetotal: info.estoquetotal,
          consumo_ma: info.consumo_ma,
          consumo_px: info.consumo_px,
          consumo_ul: info.consumo_ul,
          saldo_ma: info.saldo_ma,
          saldo_px: info.saldo_px,
          saldo_ul: info.saldo_ul,
          deficit_ma: info.deficit_ma,
          deficit_px: info.deficit_px,
          deficit_ul: info.deficit_ul,
        };
      });
      const materiasTodasDetalhe = materiasTodas.map((idmateriaprima) => {
        const info = mpDataMap.get(idmateriaprima) || {
          nome_materiaprima: "",
          estoquetotal: 0,
          consumo_ma: 0,
          consumo_px: 0,
          consumo_ul: 0,
          saldo_ma: 0,
          saldo_px: 0,
          saldo_ul: 0,
          deficit_ma: 0,
          deficit_px: 0,
          deficit_ul: 0,
        };
        return {
          idmateriaprima,
          nome_materiaprima: info.nome_materiaprima,
          estoquetotal: info.estoquetotal,
          consumo_ma: info.consumo_ma,
          consumo_px: info.consumo_px,
          consumo_ul: info.consumo_ul,
          saldo_ma: info.saldo_ma,
          saldo_px: info.saldo_px,
          saldo_ul: info.saldo_ul,
          deficit_ma: info.deficit_ma,
          deficit_px: info.deficit_px,
          deficit_ul: info.deficit_ul,
          critica: Number(info.saldo_ma || 0) < 0,
        };
      });
      return {
        idreferencia: r.idreferencia,
        bloqueada: materias.length > 0,
        materiasprimas_criticas: materias,
        materiasprimas_criticas_detalhe: materiasDetalhe,
        materiasprimas_todas_detalhe: materiasTodasDetalhe,
      };
    });

    const refsPlanoTotalDetalhe = Array.from(refsPlanoTotalMap.values()).map((r) => {
      const materiasTodas = Array.from(r.materiasprimas_set || []);
      const materias = Array.from(r.materiasprimas_criticas_set);
      const materiasDetalhe = materias.map((idmateriaprima) => {
        const info = mpDataMap.get(idmateriaprima) || {
          nome_materiaprima: "",
          estoquetotal: 0,
          consumo_ma: 0,
          consumo_px: 0,
          consumo_ul: 0,
          saldo_ma: 0,
          saldo_px: 0,
          saldo_ul: 0,
          deficit_ma: 0,
          deficit_px: 0,
          deficit_ul: 0,
        };
        return {
          idmateriaprima,
          nome_materiaprima: info.nome_materiaprima,
          estoquetotal: info.estoquetotal,
          consumo_ma: info.consumo_ma,
          consumo_px: info.consumo_px,
          consumo_ul: info.consumo_ul,
          saldo_ma: info.saldo_ma,
          saldo_px: info.saldo_px,
          saldo_ul: info.saldo_ul,
          deficit_ma: info.deficit_ma,
          deficit_px: info.deficit_px,
          deficit_ul: info.deficit_ul,
        };
      });
      const materiasTodasDetalhe = materiasTodas.map((idmateriaprima) => {
        const info = mpDataMap.get(idmateriaprima) || {
          nome_materiaprima: "",
          estoquetotal: 0,
          consumo_ma: 0,
          consumo_px: 0,
          consumo_ul: 0,
          saldo_ma: 0,
          saldo_px: 0,
          saldo_ul: 0,
          deficit_ma: 0,
          deficit_px: 0,
          deficit_ul: 0,
        };
        return {
          idmateriaprima,
          nome_materiaprima: info.nome_materiaprima,
          estoquetotal: info.estoquetotal,
          consumo_ma: info.consumo_ma,
          consumo_px: info.consumo_px,
          consumo_ul: info.consumo_ul,
          saldo_ma: info.saldo_ma,
          saldo_px: info.saldo_px,
          saldo_ul: info.saldo_ul,
          deficit_ma: info.deficit_ma,
          deficit_px: info.deficit_px,
          deficit_ul: info.deficit_ul,
          critica: Number(info.saldo_ma || 0) < 0,
        };
      });
      return {
        idreferencia: r.idreferencia,
        bloqueada: materias.length > 0,
        materiasprimas_criticas: materias,
        materiasprimas_criticas_detalhe: materiasDetalhe,
        materiasprimas_todas_detalhe: materiasTodasDetalhe,
      };
    });

    const percViavelScopeMA = totalScopeMA > 0 ? (viavelScopeMA / totalScopeMA) * 100 : 100;
    const refsBloqueadasDetalhe = Array.from(bloqueiosPorRef.entries()).map(([idreferencia, mps]) => {
      const materias = Array.from(mps);
      const materiasDetalhe = materias.map((idmateriaprima) => {
        const info = mpDataMap.get(idmateriaprima) || {
          nome_materiaprima: "",
          estoquetotal: 0,
          consumo_ma: 0,
          consumo_px: 0,
          consumo_ul: 0,
          saldo_ma: 0,
          saldo_px: 0,
          saldo_ul: 0,
          deficit_ma: 0,
          deficit_px: 0,
          deficit_ul: 0,
        };
        return {
          idmateriaprima,
          nome_materiaprima: info.nome_materiaprima,
          estoquetotal: info.estoquetotal,
          consumo_ma: info.consumo_ma,
          consumo_px: info.consumo_px,
          consumo_ul: info.consumo_ul,
          saldo_ma: info.saldo_ma,
          saldo_px: info.saldo_px,
          saldo_ul: info.saldo_ul,
          deficit_ma: info.deficit_ma,
          deficit_px: info.deficit_px,
          deficit_ul: info.deficit_ul,
        };
      });
      return {
        idreferencia,
        materiasprimas_criticas: materias,
        materiasprimas_criticas_detalhe: materiasDetalhe,
      };
    });

    const payload = {
      success: true,
      total: data.length,
      meta: {
        planosRecebidos: planos.length,
        idsPaSelecionados: idsPa.length,
        idsRefSelecionados: planoRefMap.size,
        modoLigacao,
        estruturaEncontrada: totalEstruturaRows || estruturaRows.rows.length,
        materiasPrimasMapeadas: idsMp.length,
        multinivel: usarMultinivel,
        maxDepth,
        exclusoes_mp: {
          ids: Array.from(EXCLUDED_MP_IDS).sort(),
          artigo_termos: EXCLUDED_MP_ARTIGO_TERMS,
          nome_termos: EXCLUDED_MP_NOME_TERMS,
        },
        scope_ma_total: totalScopeMA,
        scope_ma_viavel: viavelScopeMA,
        scope_ma_viavel_pct: percViavelScopeMA,
        refs_viaveis: refsViaveis.size,
        refs_bloqueadas: refsBloqueadas.size,
        cacheHit: false,
      },
      diagnostico_ma: {
        scope_ma_total: totalScopeMA,
        scope_ma_viavel: viavelScopeMA,
        scope_ma_viavel_pct: percViavelScopeMA,
        refs_viaveis: refsViaveis.size,
        refs_bloqueadas: refsBloqueadas.size,
        refs_bloqueadas_detalhe: refsBloqueadasDetalhe,
        refs_escopo_detalhe: refsEscopoDetalhe,
        refs_plano_total_detalhe: refsPlanoTotalDetalhe,
      },
      data,
    };

    const cache = readCache();
    if (!cache.items || typeof cache.items !== "object") cache.items = {};
    cache.items[cacheKey] = { timestamp: Date.now(), payload };
    const keys = Object.keys(cache.items);
    if (keys.length > 50) {
      keys
        .sort((a, b) => Number(cache.items[b]?.timestamp || 0) - Number(cache.items[a]?.timestamp || 0))
        .slice(50)
        .forEach((k) => delete cache.items[k]);
    }
    writeCache(cache);

    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao calcular análise de consumo MP",
      details: error.message,
    });
  }
});

module.exports = router;
