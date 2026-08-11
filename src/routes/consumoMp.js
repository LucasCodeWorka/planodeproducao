const express = require("express");
const crypto = require("crypto");

const router = express.Router();
const CACHE_TTL_MS = (Number(process.env.CONSUMO_MP_CACHE_TTL_SECONDS) || 900) * 1000;
const CACHE_SCHEMA_VERSION = "v7_compras_mp_finalizados_janela";

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
      qt: Number(p?.qt || 0),
      qu: Number(p?.qu || 0),
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

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function classifyCompraPeriodo(dtDisponivel, now = new Date()) {
  const data = new Date(dtDisponivel);
  if (Number.isNaN(data.getTime())) return null;

  const mesAtual = startOfMonth(now);
  const corteMa = addMonths(mesAtual, -1);
  const cortePx = mesAtual;
  const corteUl = addMonths(mesAtual, 1);
  const corteQt = addMonths(mesAtual, 2);
  const corteQu = addMonths(mesAtual, 3);

  if (data <= corteMa) return "ma";
  if (data <= cortePx) return "px";
  if (data <= corteUl) return "ul";
  if (data <= corteQt) return "qt";
  if (data <= corteQu) return "qu";
  return null;
}

function getCompraDeadlines(now = new Date()) {
  const mesAtual = startOfMonth(now);
  return {
    ma: addMonths(mesAtual, -1),
    px: mesAtual,
    ul: addMonths(mesAtual, 1),
    qt: addMonths(mesAtual, 2),
    qu: addMonths(mesAtual, 3),
  };
}

function classifyFinalizadoPeriodo(dtFinalizado, now = new Date()) {
  const data = new Date(dtFinalizado);
  if (Number.isNaN(data.getTime())) return null;

  const mesAtual = startOfMonth(now);
  const inicioMa = addMonths(mesAtual, -2);
  const inicioPx = addMonths(mesAtual, -1);
  const inicioUl = mesAtual;
  const inicioQt = addMonths(mesAtual, 1);
  const inicioQu = addMonths(mesAtual, 2);
  const fimQu = addMonths(mesAtual, 3);

  if (data >= inicioMa && data < inicioPx) return "ma";
  if (data >= inicioPx && data < inicioUl) return "px";
  if (data >= inicioUl && data < inicioQt) return "ul";
  if (data >= inicioQt && data < inicioQu) return "qt";
  if (data >= inicioQu && data < fimQu) return "qu";
  return null;
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
      const qt = Number(p?.qt || 0);
      const qu = Number(p?.qu || 0);
      const maScope = Number(p?.ma_scope || 0);
      if (!id) continue;
      if (!planoMap.has(id)) {
        planoMap.set(id, { ma: 0, px: 0, ul: 0, qt: 0, qu: 0 });
      }
      const accPlano = planoMap.get(id);
      accPlano.ma += ma;
      accPlano.px += px;
      accPlano.ul += ul;
      accPlano.qt += qt;
      accPlano.qu += qu;
      if (!planoScopeMap.has(id)) {
        planoScopeMap.set(id, { idreferencia: ref, ma_scope: 0 });
      }
      const accScope = planoScopeMap.get(id);
      if (!accScope.idreferencia && ref) accScope.idreferencia = ref;
      accScope.ma_scope += maScope;
      if (ref) {
        if (!planoRefMap.has(ref)) planoRefMap.set(ref, { ma: 0, px: 0, ul: 0, qt: 0, qu: 0 });
        const acc = planoRefMap.get(ref);
        acc.ma += ma;
        acc.px += px;
        acc.ul += ul;
        acc.qt += qt;
        acc.qu += qu;
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
          consumoMap.set(idMp, { consumo_ma: 0, consumo_px: 0, consumo_ul: 0, consumo_qt: 0, consumo_qu: 0 });
        }
        const acc = consumoMap.get(idMp);
        acc.consumo_ma += plano.ma * qtd;
        acc.consumo_px += plano.px * qtd;
        acc.consumo_ul += plano.ul * qtd;
        acc.consumo_qt += plano.qt * qtd;
        acc.consumo_qu += plano.qu * qtd;
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
            qt: demanda.qt * fator,
            qu: demanda.qu * fator,
          };
          // Sempre contabiliza o filho como necessidade (inclui semiacabados, ex.: alça).
          if (!consumoMap.has(childId)) {
            consumoMap.set(childId, { consumo_ma: 0, consumo_px: 0, consumo_ul: 0, consumo_qt: 0, consumo_qu: 0 });
          }
          const acc = consumoMap.get(childId);
          acc.consumo_ma += childDem.ma;
          acc.consumo_px += childDem.px;
          acc.consumo_ul += childDem.ul;
          acc.consumo_qt += childDem.qt;
          acc.consumo_qu += childDem.qu;

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
        explode(idPa, {
          ma: Number(plano.ma || 0),
          px: Number(plano.px || 0),
          ul: Number(plano.ul || 0),
          qt: Number(plano.qt || 0),
          qu: Number(plano.qu || 0),
        }, 1, start);
      }
    }

    const idsMp = Array.from(consumoMap.keys()).map((v) => String(v).trim()).filter(Boolean);
    if (!idsMp.length) return res.json({ success: true, total: 0, data: [] });

    // Calcular datas para query de finalizados
    const mesAtualFinalizados = startOfMonth(new Date());
    const inicioFinalizados = addMonths(mesAtualFinalizados, -2);
    const fimFinalizados = addMonths(mesAtualFinalizados, 1);

    // ═══ OTIMIZAÇÃO: Executar todas as queries em paralelo ═══
    const t0Queries = Date.now();
    const [estoqueRows, fornecedoresRows, comprasRows, opInternaRows, finalizadosRows, conversaoRows] = await Promise.all([
      // Q1: Estoque e dados de MP
      pool.query(`
        SELECT
          a.cd_produto::TEXT AS idmateriaprima,
          MAX(COALESCE(a.nm_produto, ''))::TEXT AS nome_materiaprima,
          MAX(COALESCE(a.ds_cor, ''))::TEXT AS cor,
          MAX(COALESCE(f_dic_prd_nivel(a.cd_produto, 'DS'::bpchar), ''))::TEXT AS materia_prima_ds,
          MAX(COALESCE(f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 111::bigint), ''))::TEXT AS artigo,
          MAX(COALESCE(f_dic_sld_prd_produto('1', '1'::text, a.cd_produto, NULL::timestamp), 0))::FLOAT AS estoquefisico,
          MAX(COALESCE(f_dic_sld_prd_produto('1', '2'::text, a.cd_produto, NULL::timestamp), 0))::FLOAT AS estoqueinsp,
          MAX(COALESCE(f_dic_sld_prd_produto('1', '15'::text, a.cd_produto, NULL::timestamp), 0))::FLOAT AS estoquecorte
        FROM public.vr_prd_prdgrade a
        WHERE a.cd_produto::TEXT = ANY($1::TEXT[])
        GROUP BY a.cd_produto
      `, [idsMp]),

      // Q2: Fornecedores
      pool.query(`
        SELECT
          f.cd_produto::TEXT AS idmateriaprima,
          f.cd_fornecedor::TEXT AS cd_fornecedor,
          COALESCE(f.nm_fornecedor, '')::TEXT AS nm_fornecedor,
          COALESCE(f.cd_original, '')::TEXT AS cd_original,
          COALESCE(f.in_padrao, '')::TEXT AS in_padrao,
          COALESCE(f.pr_markup, 0)::FLOAT AS pr_markup
        FROM public.vr_prd_fornecedor f
        WHERE f.cd_produto::TEXT = ANY($1::TEXT[])
        ORDER BY
          f.cd_produto,
          CASE WHEN UPPER(COALESCE(f.in_padrao, '')) IN ('T', 'S', '1', 'TRUE') THEN 0 ELSE 1 END,
          f.cd_fornecedor
      `, [idsMp]),

      // Q3: Compras pendentes
      pool.query(`
        SELECT
          i.cd_produto::TEXT AS idmateriaprima,
          COALESCE(i.dt_preventrega::date, c_1.dt_preventrega::date) AS dt_disponivel,
          SUM(COALESCE(i.qt_pendente, 0))::FLOAT AS qt_entrada,
          JSONB_AGG(JSONB_BUILD_OBJECT(
            'empresa', c_1.cd_empresa,
            'pedido', c_1.cd_pedido,
            'data', COALESCE(i.dt_preventrega::date, c_1.dt_preventrega::date),
            'quantidade', COALESCE(i.qt_pendente, 0)
          ) ORDER BY COALESCE(i.dt_preventrega::date, c_1.dt_preventrega::date), c_1.cd_pedido) AS pedidos_detalhe
        FROM vr_cmp_pedidoc2 c_1
        JOIN vr_cmp_pedidoi i
          ON i.cd_empresa = c_1.cd_empresa
         AND i.cd_pedido = c_1.cd_pedido
        WHERE c_1.tp_situacao = ANY (ARRAY[1::bigint, 3::bigint])
          AND i.cd_produto::TEXT = ANY($1::TEXT[])
          AND COALESCE(i.qt_pendente, 0) > 0
        GROUP BY i.cd_produto, COALESCE(i.dt_preventrega::date, c_1.dt_preventrega::date)
      `, [idsMp]),

      // Q4: OPs internas
      pool.query(`
        SELECT
          CASE
            WHEN op.cd_produto = ("de-para1"."para-CODIGO")::bigint
              THEN ("de-para1"."de-CODIGO")::bigint::TEXT
            ELSE op.cd_produto::TEXT
          END AS idmateriaprima,
          op.dt_preventrega::date AS dt_disponivel,
          SUM(COALESCE(op.qt_real, 0) - COALESCE(op.qt_finalizada, 0))::FLOAT AS qt_entrada
        FROM vr_pcp_opi op
        LEFT JOIN "de-para1"
          ON op.cd_produto = ("de-para1"."de-CODIGO")::bigint
        WHERE op.nr_ciclo = '99'
          AND op.tp_situacao NOT IN (40, 30)
          AND (COALESCE(op.qt_real, 0) - COALESCE(op.qt_finalizada, 0)) > 0
          AND (
            CASE
              WHEN op.cd_produto = ("de-para1"."para-CODIGO")::bigint
                THEN ("de-para1"."de-CODIGO")::bigint::TEXT
              ELSE op.cd_produto::TEXT
            END
          ) = ANY($1::TEXT[])
        GROUP BY
          CASE
            WHEN op.cd_produto = ("de-para1"."para-CODIGO")::bigint
              THEN ("de-para1"."de-CODIGO")::bigint::TEXT
            ELSE op.cd_produto::TEXT
          END,
          op.dt_preventrega::date
      `, [idsMp]),

      // Q5: Compras finalizadas
      pool.query(`
        SELECT
          i.cd_produto::TEXT AS idmateriaprima,
          COALESCE(i.dt_ultentrega, c_1.dt_ultentrega, i.dt_ultaltped)::date AS dt_finalizado,
          SUM(COALESCE(i.qt_atendida, 0))::FLOAT AS qt_finalizada,
          SUM(COALESCE(i.vl_atendido, 0))::FLOAT AS vl_finalizado,
          JSONB_AGG(JSONB_BUILD_OBJECT(
            'empresa', c_1.cd_empresa,
            'pedido', c_1.cd_pedido,
            'data', COALESCE(i.dt_ultentrega, c_1.dt_ultentrega, i.dt_ultaltped)::date,
            'quantidade', COALESCE(i.qt_atendida, 0),
            'valor', COALESCE(i.vl_atendido, 0),
            'data_base', CASE
              WHEN i.dt_ultentrega IS NOT NULL THEN 'dt_ultentrega_item'
              WHEN c_1.dt_ultentrega IS NOT NULL THEN 'dt_ultentrega_capa'
              ELSE 'dt_ultaltped'
            END
          ) ORDER BY COALESCE(i.dt_ultentrega, c_1.dt_ultentrega, i.dt_ultaltped), c_1.cd_pedido) AS finalizados_detalhe
        FROM vr_cmp_pedidoc2 c_1
        JOIN vr_cmp_pedidoi i
          ON i.cd_empresa = c_1.cd_empresa
         AND i.cd_pedido = c_1.cd_pedido
        WHERE i.cd_produto::TEXT = ANY($1::TEXT[])
          AND COALESCE(i.qt_atendida, 0) > 0
          AND COALESCE(i.dt_ultentrega, c_1.dt_ultentrega, i.dt_ultaltped) >= $2::date
          AND COALESCE(i.dt_ultentrega, c_1.dt_ultentrega, i.dt_ultaltped) < $3::date
        GROUP BY i.cd_produto, COALESCE(i.dt_ultentrega, c_1.dt_ultentrega, i.dt_ultaltped)::date
      `, [idsMp, inicioFinalizados.toISOString().slice(0, 10), fimFinalizados.toISOString().slice(0, 10)]),

      // Q6: Conversão de unidade de medida (milheiro, etc.)
      pool.query(`
        SELECT
          c.cd_produto::TEXT AS idmateriaprima,
          c.cd_especieconv,
          c.tp_operacao,
          c.qt_conversao::FLOAT AS qt_conversao,
          c.ds_convmed
        FROM vr_prd_prdconvmed c
        WHERE c.cd_produto::TEXT = ANY($1::TEXT[])
          AND UPPER(COALESCE(c.in_padrao, '')) IN ('T', 'S', '1', 'TRUE')
      `, [idsMp]),
    ]);
    console.log(`[consumo-mp/analise] Queries paralelas concluídas em ${((Date.now() - t0Queries) / 1000).toFixed(1)}s`);

    const estoqueMap = new Map(estoqueRows.rows.map((r) => [String(r.idmateriaprima || ""), r]));

    // Mapa de conversão de unidade (ex: milheiro -> unidade = dividir por 1000)
    const conversaoMap = new Map();
    for (const row of conversaoRows.rows) {
      const idMp = String(row.idmateriaprima || "").trim();
      if (!idMp) continue;
      // qt_conversao indica o fator (ex: 1000 para milheiro)
      // tp_operacao: M = multiplicar, D = dividir
      // Para converter PREÇO de milheiro para unidade, dividimos por qt_conversao
      conversaoMap.set(idMp, {
        cd_especieconv: String(row.cd_especieconv || "").trim(),
        tp_operacao: String(row.tp_operacao || "M").trim().toUpperCase(),
        qt_conversao: Number(row.qt_conversao || 1),
        ds_convmed: String(row.ds_convmed || "").trim(),
      });
    }

    const fornecedorMap = new Map();
    for (const row of fornecedoresRows.rows) {
      const idMp = String(row.idmateriaprima || "").trim();
      if (!idMp) continue;
      if (!fornecedorMap.has(idMp)) fornecedorMap.set(idMp, []);
      fornecedorMap.get(idMp).push({
        cd_fornecedor: String(row.cd_fornecedor || "").trim(),
        nm_fornecedor: String(row.nm_fornecedor || "").trim(),
        cd_original: String(row.cd_original || "").trim(),
        in_padrao: String(row.in_padrao || "").trim(),
        pr_markup: Number(row.pr_markup || 0),
      });
    }

    const entradasMap = new Map();
    const deadlinesCompra = getCompraDeadlines(new Date());
    for (const row of [...comprasRows.rows, ...opInternaRows.rows]) {
      const idMp = String(row.idmateriaprima || "").trim();
      if (!idMp) continue;
      if (!entradasMap.has(idMp)) {
        entradasMap.set(idMp, {
          entrada_ma: 0,
          entrada_px: 0,
          entrada_ul: 0,
          entrada_qt: 0,
          entrada_qu: 0,
          entrada_andamento: 0,
          entrada_fora_horizonte: 0,
          entrada_fora_prazo_ma: 0,
          pedidos_detalhe: [],
        });
      }
      const acc = entradasMap.get(idMp);
      const qtEntrada = Number(row.qt_entrada || 0);
      const dataDisponivel = new Date(row.dt_disponivel);
      acc.entrada_andamento += qtEntrada;
      if (!Number.isNaN(dataDisponivel.getTime()) && dataDisponivel > deadlinesCompra.ma) {
        acc.entrada_fora_prazo_ma += qtEntrada;
      }
      const periodo = classifyCompraPeriodo(row.dt_disponivel, new Date());
      if (Array.isArray(row.pedidos_detalhe)) {
        for (const pedido of row.pedidos_detalhe) {
          acc.pedidos_detalhe.push({
            ...pedido,
            periodo: periodo || "fora_horizonte",
          });
        }
      }
      if (!periodo) {
        acc.entrada_fora_horizonte += qtEntrada;
        continue;
      }
      if (periodo === "ma") acc.entrada_ma += qtEntrada;
      if (periodo === "px") acc.entrada_px += qtEntrada;
      if (periodo === "ul") acc.entrada_ul += qtEntrada;
      if (periodo === "qt") acc.entrada_qt += qtEntrada;
      if (periodo === "qu") acc.entrada_qu += qtEntrada;
    }

    for (const row of finalizadosRows.rows) {
      const idMp = String(row.idmateriaprima || "").trim();
      if (!idMp) continue;
      if (!entradasMap.has(idMp)) {
        entradasMap.set(idMp, {
          entrada_ma: 0,
          entrada_px: 0,
          entrada_ul: 0,
          entrada_qt: 0,
          entrada_qu: 0,
          entrada_andamento: 0,
          entrada_fora_horizonte: 0,
          entrada_fora_prazo_ma: 0,
          pedidos_detalhe: [],
        });
      }
      const periodo = classifyFinalizadoPeriodo(row.dt_finalizado, new Date());
      if (!periodo) continue;
      const acc = entradasMap.get(idMp);
      const qtFinalizada = Number(row.qt_finalizada || 0);
      const vlFinalizado = Number(row.vl_finalizado || 0);
      acc[`finalizado_${periodo}`] = Number(acc[`finalizado_${periodo}`] || 0) + qtFinalizada;
      acc[`valor_finalizado_${periodo}`] = Number(acc[`valor_finalizado_${periodo}`] || 0) + vlFinalizado;
      if (!Array.isArray(acc.finalizados_detalhe)) acc.finalizados_detalhe = [];
      if (Array.isArray(row.finalizados_detalhe)) {
        for (const item of row.finalizados_detalhe) {
          acc.finalizados_detalhe.push({ ...item, periodo });
        }
      }
    }

    const data = Array.from(consumoMap.entries()).map(([idmateriaprima, c]) => {
      const e = estoqueMap.get(idmateriaprima) || {};
      const fornecedores = fornecedorMap.get(idmateriaprima) || [];
      const fornecedorPrincipal = fornecedores[0] || {};
      const compras = entradasMap.get(idmateriaprima) || {};
      const fis = Number(e.estoquefisico || 0);
      const insp = Number(e.estoqueinsp || 0);
      const corte = Number(e.estoquecorte || 0);
      const nome_materiaprima = String(e.materia_prima_ds || e.nome_materiaprima || "").trim();
      const artigo = String(e.artigo || "").trim();
      const cor = String(e.cor || "").trim();
      const estoquetotal = fis + insp + corte;
      const entrada_ma = Number(compras.entrada_ma || 0);
      const entrada_px = Number(compras.entrada_px || 0);
      const entrada_ul = Number(compras.entrada_ul || 0);
      const entrada_qt = Number(compras.entrada_qt || 0);
      const entrada_qu = Number(compras.entrada_qu || 0);
      const entrada_andamento = Number(compras.entrada_andamento || 0);
      const entrada_fora_horizonte = Number(compras.entrada_fora_horizonte || 0);
      const entrada_fora_prazo_ma = Number(compras.entrada_fora_prazo_ma || 0);
      const pedidos_detalhe = Array.isArray(compras.pedidos_detalhe) ? compras.pedidos_detalhe : [];
      const finalizados_detalhe = Array.isArray(compras.finalizados_detalhe) ? compras.finalizados_detalhe : [];
      const finalizado_ma = Number(compras.finalizado_ma || 0);
      const finalizado_px = Number(compras.finalizado_px || 0);
      const finalizado_ul = Number(compras.finalizado_ul || 0);
      const finalizado_qt = Number(compras.finalizado_qt || 0);
      const finalizado_qu = Number(compras.finalizado_qu || 0);
      const valor_finalizado_ma = Number(compras.valor_finalizado_ma || 0);
      const valor_finalizado_px = Number(compras.valor_finalizado_px || 0);
      const valor_finalizado_ul = Number(compras.valor_finalizado_ul || 0);
      const valor_finalizado_qt = Number(compras.valor_finalizado_qt || 0);
      const valor_finalizado_qu = Number(compras.valor_finalizado_qu || 0);
      const consumo_ma = Number(c.consumo_ma || 0);
      const consumo_px = Number(c.consumo_px || 0);
      const consumo_ul = Number(c.consumo_ul || 0);
      const consumo_qt = Number(c.consumo_qt || 0);
      const consumo_qu = Number(c.consumo_qu || 0);
      const saldo_ma = estoquetotal + entrada_ma - consumo_ma;
      const saldo_px = saldo_ma + entrada_px - consumo_px;
      const saldo_ul = saldo_px + entrada_ul - consumo_ul;
      const saldo_qt = saldo_ul + entrada_qt - consumo_qt;
      const saldo_qu = saldo_qt + entrada_qu - consumo_qu;
      const consumo_total = consumo_ma + consumo_px + consumo_ul + consumo_qt + consumo_qu;

      // Fator de conversão de unidade (ex: milheiro = 1000)
      const conv = conversaoMap.get(idmateriaprima) || null;
      const fator_conversao = conv ? conv.qt_conversao : 1;
      const unidade_compra = conv ? conv.cd_especieconv : "UND";
      const ds_conversao = conv ? conv.ds_convmed : "";

      return {
        idmateriaprima,
        nome_materiaprima,
        cor,
        artigo,
        cd_fornecedor: fornecedorPrincipal.cd_fornecedor || "",
        nm_fornecedor: fornecedorPrincipal.nm_fornecedor || "",
        cd_original_fornecedor: fornecedorPrincipal.cd_original || "",
        in_fornecedor_padrao: fornecedorPrincipal.in_padrao || "",
        fornecedores,
        fator_conversao,
        unidade_compra,
        ds_conversao,
        estoquefisico: fis,
        estoqueinsp: insp,
        estoquecorte: corte,
        estoquetotal,
        entrada_ma,
        entrada_px,
        entrada_ul,
        entrada_qt,
        entrada_qu,
        entrada_andamento,
        entrada_fora_horizonte,
        entrada_fora_prazo_ma,
        pedidos_detalhe,
        finalizado_ma,
        finalizado_px,
        finalizado_ul,
        finalizado_qt,
        finalizado_qu,
        valor_finalizado_ma,
        valor_finalizado_px,
        valor_finalizado_ul,
        valor_finalizado_qt,
        valor_finalizado_qu,
        finalizados_detalhe,
        consumo_ma,
        consumo_px,
        consumo_ul,
        consumo_qt,
        consumo_qu,
        consumo_total,
        saldo_ma,
        saldo_px,
        saldo_ul,
        saldo_qt,
        saldo_qu,
        saldo: saldo_qu,
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
          entrada_ma: Number(d.entrada_ma || 0),
          entrada_px: Number(d.entrada_px || 0),
          entrada_ul: Number(d.entrada_ul || 0),
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
          entrada_ma: 0,
          entrada_px: 0,
          entrada_ul: 0,
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
          entrada_ma: info.entrada_ma,
          entrada_px: info.entrada_px,
          entrada_ul: info.entrada_ul,
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
          entrada_ma: 0,
          entrada_px: 0,
          entrada_ul: 0,
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
          entrada_ma: info.entrada_ma,
          entrada_px: info.entrada_px,
          entrada_ul: info.entrada_ul,
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
        prazos_compra: {
          ma: deadlinesCompra.ma.toISOString().slice(0, 10),
          px: deadlinesCompra.px.toISOString().slice(0, 10),
          ul: deadlinesCompra.ul.toISOString().slice(0, 10),
          qt: deadlinesCompra.qt.toISOString().slice(0, 10),
          qu: deadlinesCompra.qu.toISOString().slice(0, 10),
        },
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

/**
 * POST /api/consumo-mp/check-produto
 * Verifica status de MP para um produto específico no contexto do plano consolidado
 *
 * Body:
 *   idproduto: string - ID do produto a verificar
 *   mes: "ma" | "px" | "ul" | "qt" - período selecionado
 *   planos: array - plano completo de todos os produtos (para calcular consumo consolidado)
 *
 * Retorna:
 *   materiasprimas: array de MPs do produto com status no consolidado
 *   resumo: { total, em_risco, ok }
 */
router.post("/check-produto", async (req, res) => {
  try {
    const { idproduto, mes, planos } = req.body;

    if (!idproduto) {
      return res.status(400).json({ success: false, error: "idproduto é obrigatório" });
    }

    const mesSelecionado = String(mes || "ma").toLowerCase();
    const planosArray = Array.isArray(planos) ? planos : [];

    const pool = req.app.get("pool");

    // 1. Buscar MPs do produto específico
    const estruturaProduto = await queryEstruturaPorPais(pool, [String(idproduto)]);
    let mpsDoProduto = estruturaProduto.rows.map((r) => ({
      idmateriaprima: String(r.idmateriaprima || ""),
      qtdconsumo: Number(r.qtdconsumo || 0),
    })).filter((m) => m.idmateriaprima && m.qtdconsumo > 0);

    // Se não encontrou por produto, tenta por referência
    if (mpsDoProduto.length === 0) {
      const planoItem = planosArray.find((p) => String(p.idproduto) === String(idproduto));
      if (planoItem?.idreferencia) {
        const estruturaRef = await queryEstruturaPorRefs(pool, [String(planoItem.idreferencia)]);
        mpsDoProduto = estruturaRef.rows.map((r) => ({
          idmateriaprima: String(r.idmateriaprima || ""),
          qtdconsumo: Number(r.qtdconsumo || 0),
        })).filter((m) => m.idmateriaprima && m.qtdconsumo > 0);
      }
    }

    if (mpsDoProduto.length === 0) {
      return res.json({
        success: true,
        idproduto,
        mes: mesSelecionado,
        materiasprimas: [],
        resumo: { total: 0, em_risco: 0, ok: 0 },
        mensagem: "Nenhuma MP encontrada na ficha técnica deste produto",
      });
    }

    const idsMpProduto = mpsDoProduto.map((m) => m.idmateriaprima);

    // 2. Calcular consumo consolidado de TODOS os produtos (não só o clicado)
    // Primeiro, buscar estrutura de todos os produtos do plano
    const idsPaPlano = [...new Set(planosArray.map((p) => String(p.idproduto || "")).filter(Boolean))];

    let estruturaTotal;
    if (idsPaPlano.length > 0) {
      estruturaTotal = await queryEstruturaPorPais(pool, idsPaPlano);
    } else {
      estruturaTotal = { rows: [] };
    }

    // Mapear planos por produto
    const planoMap = new Map();
    for (const p of planosArray) {
      const id = String(p?.idproduto || "").trim();
      if (!id) continue;
      if (!planoMap.has(id)) {
        planoMap.set(id, { ma: 0, px: 0, ul: 0, qt: 0 });
      }
      const acc = planoMap.get(id);
      acc.ma += Number(p?.ma || 0);
      acc.px += Number(p?.px || 0);
      acc.ul += Number(p?.ul || 0);
      acc.qt += Number(p?.qt || 0);
    }

    // Calcular consumo total por MP (consolidado de todos os produtos)
    const consumoConsolidado = new Map();
    for (const r of estruturaTotal.rows) {
      const idPa = String(r.idproduto_pa || "");
      const idMp = String(r.idmateriaprima || "");
      const qtd = Number(r.qtdconsumo || 0);
      if (!idPa || !idMp || qtd <= 0) continue;

      const plano = planoMap.get(idPa);
      if (!plano) continue;

      if (!consumoConsolidado.has(idMp)) {
        consumoConsolidado.set(idMp, { consumo_ma: 0, consumo_px: 0, consumo_ul: 0, consumo_qt: 0 });
      }
      const acc = consumoConsolidado.get(idMp);
      acc.consumo_ma += plano.ma * qtd;
      acc.consumo_px += plano.px * qtd;
      acc.consumo_ul += plano.ul * qtd;
      acc.consumo_qt += plano.qt * qtd;
    }

    // 3. Buscar estoque e entradas em paralelo
    const t0CheckProduto = Date.now();
    const [estoqueRows, comprasRows, opInternaRows] = await Promise.all([
      // Q1: Estoque
      pool.query(`
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
      `, [idsMpProduto]),

      // Q2: Compras
      pool.query(`
        SELECT
          i.cd_produto::TEXT AS idmateriaprima,
          COALESCE(i.dt_preventrega::date, c_1.dt_preventrega::date) AS dt_disponivel,
          SUM(COALESCE(i.qt_pendente, 0))::FLOAT AS qt_entrada
        FROM vr_cmp_pedidoc2 c_1
        JOIN vr_cmp_pedidoi i
          ON i.cd_empresa = c_1.cd_empresa
         AND i.cd_pedido = c_1.cd_pedido
        WHERE c_1.tp_situacao = ANY (ARRAY[1::bigint, 3::bigint])
          AND i.cd_produto::TEXT = ANY($1::TEXT[])
          AND COALESCE(i.qt_pendente, 0) > 0
        GROUP BY i.cd_produto, COALESCE(i.dt_preventrega::date, c_1.dt_preventrega::date)
      `, [idsMpProduto]),

      // Q3: OPs internas
      pool.query(`
        SELECT
          CASE
            WHEN op.cd_produto = ("de-para1"."para-CODIGO")::bigint
              THEN ("de-para1"."de-CODIGO")::bigint::TEXT
            ELSE op.cd_produto::TEXT
          END AS idmateriaprima,
          op.dt_preventrega::date AS dt_disponivel,
          SUM(COALESCE(op.qt_real, 0) - COALESCE(op.qt_finalizada, 0))::FLOAT AS qt_entrada
        FROM vr_pcp_opi op
        LEFT JOIN "de-para1"
          ON op.cd_produto = ("de-para1"."de-CODIGO")::bigint
        WHERE op.nr_ciclo = '99'
          AND op.tp_situacao NOT IN (40, 30)
          AND (COALESCE(op.qt_real, 0) - COALESCE(op.qt_finalizada, 0)) > 0
          AND (
            CASE
              WHEN op.cd_produto = ("de-para1"."para-CODIGO")::bigint
                THEN ("de-para1"."de-CODIGO")::bigint::TEXT
              ELSE op.cd_produto::TEXT
            END
          ) = ANY($1::TEXT[])
        GROUP BY
          CASE
            WHEN op.cd_produto = ("de-para1"."para-CODIGO")::bigint
              THEN ("de-para1"."de-CODIGO")::bigint::TEXT
            ELSE op.cd_produto::TEXT
          END,
          op.dt_preventrega::date
      `, [idsMpProduto]),
    ]);
    console.log(`[consumo-mp/check-produto] Queries paralelas concluídas em ${((Date.now() - t0CheckProduto) / 1000).toFixed(1)}s`);

    const estoqueMap = new Map(estoqueRows.rows.map((r) => [String(r.idmateriaprima || ""), r]));

    // Classificar entradas por período
    const entradasMap = new Map();
    for (const row of [...comprasRows.rows, ...opInternaRows.rows]) {
      const idMp = String(row.idmateriaprima || "").trim();
      if (!idMp) continue;
      const periodo = classifyCompraPeriodo(row.dt_disponivel, new Date());
      if (!periodo) continue;
      if (!entradasMap.has(idMp)) {
        entradasMap.set(idMp, { entrada_ma: 0, entrada_px: 0, entrada_ul: 0 });
      }
      const acc = entradasMap.get(idMp);
      const qtEntrada = Number(row.qt_entrada || 0);
      if (periodo === "ma") acc.entrada_ma += qtEntrada;
      if (periodo === "px") acc.entrada_px += qtEntrada;
      if (periodo === "ul") acc.entrada_ul += qtEntrada;
    }

    // 4. Montar resultado com saldos consolidados
    const materiasprimas = mpsDoProduto
      .filter((m) => {
        if (EXCLUDED_MP_IDS.has(m.idmateriaprima)) return false;
        const e = estoqueMap.get(m.idmateriaprima) || {};
        if (contemTermoBloqueado(e.artigo, EXCLUDED_MP_ARTIGO_TERMS)) return false;
        const nome = String(e.materia_prima_ds || e.nome_materiaprima || "");
        if (contemTermoBloqueado(nome, EXCLUDED_MP_NOME_TERMS)) return false;
        return true;
      })
      .map((m) => {
        const e = estoqueMap.get(m.idmateriaprima) || {};
        const entradas = entradasMap.get(m.idmateriaprima) || {};
        const consumo = consumoConsolidado.get(m.idmateriaprima) || {};

        const fis = Number(e.estoquefisico || 0);
        const insp = Number(e.estoqueinsp || 0);
        const corte = Number(e.estoquecorte || 0);
        const estoquetotal = fis + insp + corte;

        const entrada_ma = Number(entradas.entrada_ma || 0);
        const entrada_px = Number(entradas.entrada_px || 0);
        const entrada_ul = Number(entradas.entrada_ul || 0);

        const consumo_ma = Number(consumo.consumo_ma || 0);
        const consumo_px = Number(consumo.consumo_px || 0);
        const consumo_ul = Number(consumo.consumo_ul || 0);
        const consumo_qt = Number(consumo.consumo_qt || 0);

        // Saldos progressivos
        const saldo_ma = estoquetotal + entrada_ma - consumo_ma;
        const saldo_px = saldo_ma + entrada_px - consumo_px;
        const saldo_ul = saldo_px + entrada_ul - consumo_ul;
        const saldo_qt = saldo_ul - consumo_qt; // QT não tem entrada adicional

        // Determinar status no mês selecionado
        let saldo_periodo;
        switch (mesSelecionado) {
          case "ma": saldo_periodo = saldo_ma; break;
          case "px": saldo_periodo = saldo_px; break;
          case "ul": saldo_periodo = saldo_ul; break;
          case "qt": saldo_periodo = saldo_qt; break;
          default: saldo_periodo = saldo_ma;
        }

        const nome = String(e.materia_prima_ds || e.nome_materiaprima || "").trim();
        const artigo = String(e.artigo || "").trim();

        return {
          idmateriaprima: m.idmateriaprima,
          nome: nome,
          artigo,
          qtd_por_unidade: m.qtdconsumo,
          estoque: estoquetotal,
          entrada_periodo: mesSelecionado === "ma" ? entrada_ma : mesSelecionado === "px" ? entrada_px : entrada_ul,
          consumo_consolidado: mesSelecionado === "ma" ? consumo_ma : mesSelecionado === "px" ? consumo_px : mesSelecionado === "ul" ? consumo_ul : consumo_qt,
          saldo_periodo,
          status: saldo_periodo >= 0 ? "OK" : "FALTA",
          deficit: saldo_periodo < 0 ? Math.abs(saldo_periodo) : 0,
          // Detalhes adicionais
          detalhe: {
            estoquefisico: fis,
            estoqueinsp: insp,
            estoquecorte: corte,
            entrada_ma,
            entrada_px,
            entrada_ul,
            consumo_ma,
            consumo_px,
            consumo_ul,
            consumo_qt,
            saldo_ma,
            saldo_px,
            saldo_ul,
            saldo_qt,
          },
        };
      })
      .sort((a, b) => a.saldo_periodo - b.saldo_periodo); // MPs em falta primeiro

    const emRisco = materiasprimas.filter((m) => m.status === "FALTA").length;
    const ok = materiasprimas.filter((m) => m.status === "OK").length;

    return res.json({
      success: true,
      idproduto,
      mes: mesSelecionado,
      materiasprimas,
      resumo: {
        total: materiasprimas.length,
        em_risco: emRisco,
        ok,
      },
    });

  } catch (error) {
    console.error("[consumo-mp/check-produto] Erro:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao verificar MPs do produto",
      details: error.message,
    });
  }
});

router.post("/check-risco-lote", async (req, res) => {
  try {
    const planosArray = Array.isArray(req.body?.planos) ? req.body.planos : [];
    const idsPaPlano = [...new Set(planosArray.map((p) => String(p?.idproduto || "").trim()).filter(Boolean))];
    const idsRefPlano = [...new Set(planosArray.map((p) => String(p?.idreferencia || "").trim()).filter(Boolean))];
    const pool = req.app.get("pool");

    if (!idsPaPlano.length) {
      return res.json({ success: true, risco_por_sku: {}, detalhe_risco_por_sku: {} });
    }

    const estruturaTotal = await queryEstruturaPorPais(pool, idsPaPlano);
    const estruturaRefs = idsRefPlano.length > 0 ? await queryEstruturaPorRefs(pool, idsRefPlano) : { rows: [] };

    const planoMap = new Map();
    const refPorProduto = new Map();
    for (const p of planosArray) {
      const id = String(p?.idproduto || "").trim();
      const ref = String(p?.idreferencia || "").trim();
      if (!id) continue;
      refPorProduto.set(id, ref);
      if (!planoMap.has(id)) planoMap.set(id, { ma: 0, px: 0, ul: 0, qt: 0 });
      const acc = planoMap.get(id);
      acc.ma += Number(p?.ma || 0);
      acc.px += Number(p?.px || 0);
      acc.ul += Number(p?.ul || 0);
      acc.qt += Number(p?.qt || 0);
    }

    const consumoConsolidado = new Map();
    for (const r of estruturaTotal.rows) {
      const idPa = String(r.idproduto_pa || "");
      const idMp = String(r.idmateriaprima || "");
      const qtd = Number(r.qtdconsumo || 0);
      if (!idPa || !idMp || qtd <= 0) continue;
      const plano = planoMap.get(idPa);
      if (!plano) continue;
      if (!consumoConsolidado.has(idMp)) consumoConsolidado.set(idMp, { consumo_ma: 0, consumo_px: 0, consumo_ul: 0, consumo_qt: 0 });
      const acc = consumoConsolidado.get(idMp);
      acc.consumo_ma += plano.ma * qtd;
      acc.consumo_px += plano.px * qtd;
      acc.consumo_ul += plano.ul * qtd;
      acc.consumo_qt += plano.qt * qtd;
    }

    const mpsPorProduto = new Map();
    for (const r of estruturaTotal.rows) {
      const idPa = String(r.idproduto_pa || "").trim();
      const idMp = String(r.idmateriaprima || "").trim();
      if (!idPa || !idMp) continue;
      if (!mpsPorProduto.has(idPa)) mpsPorProduto.set(idPa, new Set());
      mpsPorProduto.get(idPa).add(idMp);
    }

    const mpsPorReferencia = new Map();
    for (const r of estruturaRefs.rows) {
      const ref = String(r.idreferencia_pa || "").trim();
      const idMp = String(r.idmateriaprima || "").trim();
      if (!ref || !idMp) continue;
      if (!mpsPorReferencia.has(ref)) mpsPorReferencia.set(ref, new Set());
      mpsPorReferencia.get(ref).add(idMp);
    }

    const idsMp = [...new Set([
      ...Array.from(estruturaTotal.rows, (r) => String(r.idmateriaprima || "").trim()),
      ...Array.from(estruturaRefs.rows, (r) => String(r.idmateriaprima || "").trim()),
    ].filter(Boolean))];

    if (!idsMp.length) {
      const vazio = Object.fromEntries(idsPaPlano.map((id) => [id, { ma: false, px: false, ul: false, qt: false }]));
      const detalheVazio = Object.fromEntries(idsPaPlano.map((id) => [id, {
        ma: { em_risco: false, quantidade_mps: 0, principal_mp: null },
        px: { em_risco: false, quantidade_mps: 0, principal_mp: null },
        ul: { em_risco: false, quantidade_mps: 0, principal_mp: null },
        qt: { em_risco: false, quantidade_mps: 0, principal_mp: null },
      }]));
      return res.json({ success: true, risco_por_sku: vazio, detalhe_risco_por_sku: detalheVazio });
    }

    // ═══ OTIMIZAÇÃO: Executar queries em paralelo ═══
    const t0RiscoLote = Date.now();
    const [estoqueRows, comprasRows, opInternaRows] = await Promise.all([
      // Q1: Estoque e dados de MP
      pool.query(`
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
      `, [idsMp]),

      // Q2: Compras pendentes
      pool.query(`
        SELECT
          i.cd_produto::TEXT AS idmateriaprima,
          COALESCE(i.dt_preventrega::date, c_1.dt_preventrega::date) AS dt_disponivel,
          SUM(COALESCE(i.qt_pendente, 0))::FLOAT AS qt_entrada
        FROM vr_cmp_pedidoc2 c_1
        JOIN vr_cmp_pedidoi i
          ON i.cd_empresa = c_1.cd_empresa
         AND i.cd_pedido = c_1.cd_pedido
        WHERE c_1.tp_situacao = ANY (ARRAY[1::bigint, 3::bigint])
          AND i.cd_produto::TEXT = ANY($1::TEXT[])
          AND COALESCE(i.qt_pendente, 0) > 0
        GROUP BY i.cd_produto, COALESCE(i.dt_preventrega::date, c_1.dt_preventrega::date)
      `, [idsMp]),

      // Q3: OPs internas
      pool.query(`
        SELECT
          CASE
            WHEN op.cd_produto = ("de-para1"."para-CODIGO")::bigint
              THEN ("de-para1"."de-CODIGO")::bigint::TEXT
            ELSE op.cd_produto::TEXT
          END AS idmateriaprima,
          op.dt_preventrega::date AS dt_disponivel,
          SUM(COALESCE(op.qt_real, 0) - COALESCE(op.qt_finalizada, 0))::FLOAT AS qt_entrada
        FROM vr_pcp_opi op
        LEFT JOIN "de-para1"
          ON op.cd_produto = ("de-para1"."de-CODIGO")::bigint
        WHERE op.nr_ciclo = '99'
          AND op.tp_situacao NOT IN (40, 30)
          AND (COALESCE(op.qt_real, 0) - COALESCE(op.qt_finalizada, 0)) > 0
          AND (
            CASE
              WHEN op.cd_produto = ("de-para1"."para-CODIGO")::bigint
                THEN ("de-para1"."de-CODIGO")::bigint::TEXT
              ELSE op.cd_produto::TEXT
            END
          ) = ANY($1::TEXT[])
        GROUP BY
          CASE
            WHEN op.cd_produto = ("de-para1"."para-CODIGO")::bigint
              THEN ("de-para1"."de-CODIGO")::bigint::TEXT
            ELSE op.cd_produto::TEXT
          END,
          op.dt_preventrega::date
      `, [idsMp]),
    ]);
    console.log(`[consumo-mp/check-risco-lote] Queries paralelas concluídas em ${((Date.now() - t0RiscoLote) / 1000).toFixed(1)}s`);

    const estoqueMap = new Map(estoqueRows.rows.map((r) => [String(r.idmateriaprima || ""), r]));
    const entradasMap = new Map();
    for (const row of [...comprasRows.rows, ...opInternaRows.rows]) {
      const idMp = String(row.idmateriaprima || "").trim();
      if (!idMp) continue;
      const periodo = classifyCompraPeriodo(row.dt_disponivel, new Date());
      if (!periodo) continue;
      if (!entradasMap.has(idMp)) entradasMap.set(idMp, { entrada_ma: 0, entrada_px: 0, entrada_ul: 0 });
      const acc = entradasMap.get(idMp);
      const qtEntrada = Number(row.qt_entrada || 0);
      if (periodo === "ma") acc.entrada_ma += qtEntrada;
      if (periodo === "px") acc.entrada_px += qtEntrada;
      if (periodo === "ul") acc.entrada_ul += qtEntrada;
    }

    const saldoPorMp = new Map();
    for (const idMp of idsMp) {
      const e = estoqueMap.get(idMp) || {};
      if (EXCLUDED_MP_IDS.has(idMp)) continue;
      if (contemTermoBloqueado(e.artigo, EXCLUDED_MP_ARTIGO_TERMS)) continue;
      const nome = String(e.materia_prima_ds || e.nome_materiaprima || "");
      if (contemTermoBloqueado(nome, EXCLUDED_MP_NOME_TERMS)) continue;

      const entradas = entradasMap.get(idMp) || {};
      const consumo = consumoConsolidado.get(idMp) || {};
      const estoque = Number(e.estoquefisico || 0) + Number(e.estoqueinsp || 0) + Number(e.estoquecorte || 0);
      const saldo_ma = estoque + Number(entradas.entrada_ma || 0) - Number(consumo.consumo_ma || 0);
      const saldo_px = saldo_ma + Number(entradas.entrada_px || 0) - Number(consumo.consumo_px || 0);
      const saldo_ul = saldo_px + Number(entradas.entrada_ul || 0) - Number(consumo.consumo_ul || 0);
      const saldo_qt = saldo_ul - Number(consumo.consumo_qt || 0);
      saldoPorMp.set(idMp, { ma: saldo_ma, px: saldo_px, ul: saldo_ul, qt: saldo_qt });
    }

    const riscoPorSku = {};
    const detalheRiscoPorSku = {};
    for (const id of idsPaPlano) {
      const ref = refPorProduto.get(id) || "";
      const mpsSet = mpsPorProduto.get(id) || mpsPorReferencia.get(ref) || new Set();
      const risco = { ma: false, px: false, ul: false, qt: false };
      const detalhe = {
        ma: { em_risco: false, quantidade_mps: 0, principal_mp: null },
        px: { em_risco: false, quantidade_mps: 0, principal_mp: null },
        ul: { em_risco: false, quantidade_mps: 0, principal_mp: null },
        qt: { em_risco: false, quantidade_mps: 0, principal_mp: null },
      };
      for (const idMp of mpsSet) {
        const saldo = saldoPorMp.get(idMp);
        if (!saldo) continue;
        const estoqueInfo = estoqueMap.get(idMp) || {};
        const nomeMp = String(estoqueInfo.materia_prima_ds || estoqueInfo.nome_materiaprima || "").trim();
        const artigoMp = String(estoqueInfo.artigo || "").trim();
        for (const periodo of ["ma", "px", "ul", "qt"]) {
          const saldoPeriodo = Number(saldo[periodo] || 0);
          if (saldoPeriodo >= 0) continue;
          risco[periodo] = true;
          detalhe[periodo].em_risco = true;
          detalhe[periodo].quantidade_mps += 1;
          if (!detalhe[periodo].principal_mp || saldoPeriodo < detalhe[periodo].principal_mp.saldo) {
            detalhe[periodo].principal_mp = {
              idmateriaprima: idMp,
              nome: nomeMp,
              artigo: artigoMp,
              saldo: saldoPeriodo,
              falta: Math.abs(saldoPeriodo),
            };
          }
        }
      }
      riscoPorSku[id] = risco;
      detalheRiscoPorSku[id] = detalhe;
    }

    return res.json({ success: true, risco_por_sku: riscoPorSku, detalhe_risco_por_sku: detalheRiscoPorSku });
  } catch (error) {
    console.error("[consumo-mp/check-risco-lote] Erro:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao verificar risco de MP em lote",
      details: error.message,
    });
  }
});

module.exports = router;
