const express = require("express");

const router = express.Router();

const OPERACOES_CONSUMO_MP = [1100, 100, 1150, 150, 1210, 210, 1219, 219, 128, 280];
const CACHE_TTL_MS = (Number(process.env.EXCESSO_MP_CACHE_TTL_SECONDS) || 900) * 1000;
const memCache = new Map();

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function dataRegraCompra(periodo, now = new Date()) {
  const mesAtual = startOfMonth(now);
  const offset = periodo === "ma" ? -1 : periodo === "px" ? 0 : periodo === "ul" ? 1 : periodo === "qt" ? 2 : 3;
  return addMonths(mesAtual, offset);
}

function classifyCompraPeriodo(dtDisponivel, now = new Date()) {
  const data = new Date(dtDisponivel);
  if (Number.isNaN(data.getTime())) return null;
  for (const periodo of ["ma", "px", "ul", "qt"]) {
    if (data <= dataRegraCompra(periodo, now)) return periodo;
  }
  return null;
}

function getCache(key) {
  const item = memCache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > CACHE_TTL_MS) {
    memCache.delete(key);
    return null;
  }
  return item.payload;
}

function setCache(key, payload) {
  memCache.set(key, { timestamp: Date.now(), payload });
  for (const [cacheKey, item] of memCache) {
    if (Date.now() - item.timestamp > CACHE_TTL_MS) memCache.delete(cacheKey);
  }
}

router.get("/", async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const diasConsumo = clampInt(req.query.dias_consumo, 30, 1, 365);
    const diasCobertura = clampInt(req.query.dias_cobertura, 5, 0, 365);
    const limit = clampInt(req.query.limit, 1000, 1, 5000);
    const somenteExcesso = req.query.somente_excesso !== "false";
    const buscar = String(req.query.buscar || "").trim();
    const artigo = String(req.query.artigo || "").trim();
    const noCache = req.query.no_cache === "true";
    const cacheKey = JSON.stringify({
      v: "plano_v2_datas_compra",
      diasConsumo,
      diasCobertura,
      limit,
      buscar,
      artigo,
    });

    if (!noCache) {
      const cached = getCache(cacheKey);
      if (cached) {
        return res.json({
          ...cached,
          meta: {
            ...(cached.meta || {}),
            cacheHit: true,
            cacheAgeSec: Math.round((Date.now() - cached.cachedAt) / 1000),
          },
        });
      }
    }

    const params = [
      OPERACOES_CONSUMO_MP,
      diasConsumo,
      diasCobertura,
      limit,
      somenteExcesso,
      buscar || null,
      artigo || null,
    ];

    const result = await pool.query(`
      WITH RECURSIVE
      sku_em_linha AS (
        SELECT DISTINCT
          a.cd_produto::text AS idproduto
        FROM public.vr_prd_prdgrade a
        WHERE UPPER(TRIM(COALESCE(f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 27::bigint), ''))) = 'EM LINHA'
      ),
      bom AS (
        SELECT
          c.cd_produtopa::text AS parent_id,
          c.cd_produtomp::text AS child_id,
          SUM(COALESCE(c.qt_consumo, 0))::float AS fator
        FROM public.vr_pcp_fcconsumo c
        GROUP BY c.cd_produtopa, c.cd_produtomp
        HAVING SUM(COALESCE(c.qt_consumo, 0)) > 0
      ),
      plano AS (
        SELECT
          p.cd_auxiliar::text AS periodo,
          a.cd_produto::text AS idproduto,
          SUM(GREATEST(COALESCE(a.qt_lote, 0) - COALESCE(a.qt_gerouop, 0), 0))::float AS qtd
        FROM public.vr_pcp_lotepl2 a
        LEFT JOIN public.pcp_lotepv p ON a.nr_lote = p.nr_lote
        JOIN sku_em_linha sku ON sku.idproduto = a.cd_produto::text
        WHERE p.tp_situacao = 1
          AND p.cd_auxiliar IN ('MA', 'PX', 'UL', 'QT')
        GROUP BY p.cd_auxiliar, a.cd_produto
        HAVING SUM(GREATEST(COALESCE(a.qt_lote, 0) - COALESCE(a.qt_gerouop, 0), 0)) > 0
      ),
      expl AS (
        SELECT
          p.periodo,
          p.idproduto::text AS root_id,
          b.child_id,
          (p.qtd * b.fator)::float AS consumo,
          1 AS depth,
          ARRAY[p.idproduto::text, b.child_id] AS path
        FROM plano p
        JOIN bom b ON b.parent_id = p.idproduto::text

        UNION ALL

        SELECT
          e.periodo,
          e.root_id,
          b.child_id,
          (e.consumo * b.fator)::float AS consumo,
          e.depth + 1 AS depth,
          e.path || b.child_id
        FROM expl e
        JOIN bom b ON b.parent_id = e.child_id
        WHERE e.depth < 8
          AND NOT b.child_id = ANY(e.path)
      ),
      consumo_plano AS (
        SELECT
          child_id AS idmateriaprima,
          SUM(consumo) FILTER (WHERE periodo = 'MA')::float AS consumo_ma,
          SUM(consumo) FILTER (WHERE periodo = 'PX')::float AS consumo_px,
          SUM(consumo) FILTER (WHERE periodo = 'UL')::float AS consumo_ul,
          SUM(consumo) FILTER (WHERE periodo = 'QT')::float AS consumo_qt,
          SUM(consumo) FILTER (WHERE depth = 1)::float AS consumo_direto,
          SUM(consumo) FILTER (WHERE depth > 1)::float AS consumo_indireto,
          COUNT(DISTINCT root_id)::int AS produtos_raiz
        FROM expl
        GROUP BY child_id
      ),
      ops_abertas AS (
        SELECT
          aa.cd_produto::text AS idproduto,
          SUM(COALESCE(aa.qt_real, 0) - COALESCE(aa.qt_finalizada, 0))::float AS qtd
        FROM public.vr_pcp_opi aa
        JOIN public.vr_pcp_opc bb
          ON aa.cd_empresa = bb.cd_empresa
         AND aa.nr_ciclo = bb.nr_ciclo
         AND aa.nr_op = bb.nr_op
        WHERE aa.cd_empresa = 1
          AND COALESCE(bb.cd_categoria, 0)::bigint <> 15
          AND aa.tp_situacao = ANY(ARRAY[5, 10, 15, 20]::bigint[])
          AND (COALESCE(aa.qt_real, 0) - COALESCE(aa.qt_finalizada, 0)) > 0
          AND EXISTS (
            SELECT 1
            FROM sku_em_linha sku
            WHERE sku.idproduto = aa.cd_produto::text
          )
        GROUP BY aa.cd_produto
      ),
      op_expl AS (
        SELECT
          o.idproduto::text AS root_id,
          b.child_id,
          (o.qtd * b.fator)::float AS consumo,
          1 AS depth,
          ARRAY[o.idproduto::text, b.child_id] AS path
        FROM ops_abertas o
        JOIN bom b ON b.parent_id = o.idproduto::text

        UNION ALL

        SELECT
          e.root_id,
          b.child_id,
          (e.consumo * b.fator)::float AS consumo,
          e.depth + 1 AS depth,
          e.path || b.child_id
        FROM op_expl e
        JOIN bom b ON b.parent_id = e.child_id
        WHERE e.depth < 8
          AND NOT b.child_id = ANY(e.path)
      ),
      consumo_op AS (
        SELECT
          child_id AS idmateriaprima,
          SUM(consumo)::float AS consumo_op,
          COUNT(DISTINCT root_id)::int AS produtos_op
        FROM op_expl
        GROUP BY child_id
      ),
      candidatos AS (
        SELECT idmateriaprima FROM consumo_plano
      ),
      estoque AS (
        SELECT
          a.cd_produto::text AS idmateriaprima,
          MAX(COALESCE(a.nm_produto, ''))::text AS nome_materiaprima,
          MAX(COALESCE(f_dic_prd_nivel(a.cd_produto, 'DS'::bpchar), ''))::text AS materia_prima_ds,
          MAX(COALESCE(f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 111::bigint), ''))::text AS artigo,
          MAX(COALESCE(f_dic_sld_prd_produto('1', '1'::text, a.cd_produto, NULL::timestamp), 0))::float AS estoquefisico,
          MAX(COALESCE(f_dic_sld_prd_produto('1', '2'::text, a.cd_produto, NULL::timestamp), 0))::float AS estoqueinsp,
          MAX(COALESCE(f_dic_sld_prd_produto('1', '15'::text, a.cd_produto, NULL::timestamp), 0))::float AS estoquecorte
        FROM public.vr_prd_prdgrade a
        JOIN candidatos cand ON cand.idmateriaprima = a.cd_produto::text
        WHERE a.cd_produto >= 1000000
          AND a.cd_produto < 5000000
        GROUP BY a.cd_produto
      ),
      consumo_real AS (
        SELECT
          t.cd_produto::text AS idmateriaprima,
          SUM(COALESCE(t.qt_saldo, t.qt_solicitada, t.qt_atendida, 0))::float AS consumo_ultimos_dias
        FROM public.vr_tra_transitem t
        JOIN candidatos cand ON cand.idmateriaprima = t.cd_produto::text
        WHERE t.cd_operacao = ANY($1::bigint[])
          AND t.tp_situacao <> 6
          AND t.tp_operacao = 'S'
          AND t.dt_transacao >= (CURRENT_DATE - ($2::int * INTERVAL '1 day'))
        GROUP BY t.cd_produto
      ),
      compras AS (
        SELECT
          i.cd_produto::text AS idmateriaprima,
          COALESCE(i.dt_preventrega::date, c.dt_preventrega::date) AS dt_disponivel,
          SUM(COALESCE(i.qt_pendente, 0))::float AS qt_entrada
        FROM public.vr_cmp_pedidoc2 c
        JOIN public.vr_cmp_pedidoi i
          ON i.cd_empresa = c.cd_empresa
         AND i.cd_pedido = c.cd_pedido
        JOIN candidatos cand ON cand.idmateriaprima = i.cd_produto::text
        WHERE c.tp_situacao = ANY (ARRAY[1::bigint, 3::bigint])
          AND COALESCE(i.qt_pendente, 0) > 0
        GROUP BY i.cd_produto, COALESCE(i.dt_preventrega::date, c.dt_preventrega::date)
      ),
      compras_periodo AS (
        SELECT
          idmateriaprima,
          JSONB_AGG(JSONB_BUILD_OBJECT(
            'data', dt_disponivel,
            'quantidade', qt_entrada
          ) ORDER BY dt_disponivel) AS compras_detalhe
        FROM compras
        GROUP BY idmateriaprima
      ),
      base AS (
        SELECT
          e.idmateriaprima,
          e.nome_materiaprima,
          COALESCE(NULLIF(e.materia_prima_ds, ''), e.nome_materiaprima) AS descricao,
          e.artigo,
          e.estoquefisico,
          e.estoqueinsp,
          e.estoquecorte,
          (e.estoquefisico + e.estoqueinsp + e.estoquecorte)::float AS estoquetotal,
          COALESCE(cp.produtos_raiz, 0)::int AS skus_em_linha,
          COALESCE(cr.consumo_ultimos_dias, 0)::float AS consumo_ultimos_dias,
          (COALESCE(cr.consumo_ultimos_dias, 0) / NULLIF($2::float, 0))::float AS consumo_dia,
          (COALESCE(cr.consumo_ultimos_dias, 0) / NULLIF($2::float, 0) * $3::float)::float AS estoque_cinco_dias,
          COALESCE(co.consumo_op, 0)::float AS consumo_op,
          COALESCE(cp.consumo_ma, 0)::float AS consumo_ma,
          COALESCE(cp.consumo_px, 0)::float AS consumo_px,
          COALESCE(cp.consumo_ul, 0)::float AS consumo_ul,
          COALESCE(cp.consumo_qt, 0)::float AS consumo_qt,
          COALESCE(cp.consumo_direto, 0)::float AS consumo_direto,
          COALESCE(cp.consumo_indireto, 0)::float AS consumo_indireto,
          COALESCE(cp.produtos_raiz, 0)::int AS produtos_raiz,
          COALESCE(co.produtos_op, 0)::int AS produtos_op,
          COALESCE(cpr.compras_detalhe, '[]'::jsonb) AS compras_detalhe,
          0::float AS entrada_ma,
          0::float AS entrada_px,
          0::float AS entrada_ul,
          0::float AS entrada_qt
        FROM estoque e
        LEFT JOIN consumo_real cr ON cr.idmateriaprima = e.idmateriaprima
        LEFT JOIN consumo_plano cp ON cp.idmateriaprima = e.idmateriaprima
        LEFT JOIN consumo_op co ON co.idmateriaprima = e.idmateriaprima
        LEFT JOIN compras_periodo cpr ON cpr.idmateriaprima = e.idmateriaprima
      ),
      saldos AS (
        SELECT
          *,
          (estoquetotal + entrada_ma - consumo_ma)::float AS saldo_ma,
          (estoquetotal + entrada_ma + entrada_px - consumo_ma - consumo_px)::float AS saldo_px,
          (estoquetotal + entrada_ma + entrada_px + entrada_ul - consumo_ma - consumo_px - consumo_ul)::float AS saldo_ul,
          (estoquetotal + entrada_ma + entrada_px + entrada_ul + entrada_qt - consumo_ma - consumo_px - consumo_ul - consumo_qt)::float AS saldo_qt
        FROM base
      )
      SELECT
        *,
        CASE WHEN consumo_dia > 0 THEN saldo_ma / consumo_dia ELSE NULL END AS dias_cobertura_ma,
        CASE WHEN consumo_dia > 0 THEN saldo_px / consumo_dia ELSE NULL END AS dias_cobertura_px,
        CASE WHEN consumo_dia > 0 THEN saldo_ul / consumo_dia ELSE NULL END AS dias_cobertura_ul,
        CASE WHEN consumo_dia > 0 THEN saldo_qt / consumo_dia ELSE NULL END AS dias_cobertura_qt,
        GREATEST(saldo_ma - estoque_cinco_dias, 0)::float AS excesso_ma,
        GREATEST(saldo_px - estoque_cinco_dias, 0)::float AS excesso_px,
        GREATEST(saldo_ul - estoque_cinco_dias, 0)::float AS excesso_ul,
        GREATEST(saldo_qt - estoque_cinco_dias, 0)::float AS excesso_qt
      FROM saldos
      WHERE (true OR $5::boolean = false OR (consumo_dia > 0 AND saldo_qt > estoque_cinco_dias))
        AND ($6::text IS NULL OR idmateriaprima ILIKE '%' || $6::text || '%' OR descricao ILIKE '%' || $6::text || '%' OR artigo ILIKE '%' || $6::text || '%')
        AND ($7::text IS NULL OR artigo = $7::text)
      ORDER BY excesso_qt DESC, saldo_qt DESC
      LIMIT $4
    `, params);

    const rows = result.rows.map((row) => {
      const next = { ...row };
      const detalhes = Array.isArray(next.compras_detalhe) ? next.compras_detalhe : [];
      next.entrada_ma = 0;
      next.entrada_px = 0;
      next.entrada_ul = 0;
      next.entrada_qt = 0;
      next.entrada_fora_horizonte = 0;
      next.compras_detalhe = detalhes.map((item) => {
        const quantidade = Number(item?.quantidade || 0);
        const periodo = classifyCompraPeriodo(item?.data);
        if (periodo === "ma") next.entrada_ma += quantidade;
        else if (periodo === "px") next.entrada_px += quantidade;
        else if (periodo === "ul") next.entrada_ul += quantidade;
        else if (periodo === "qt") next.entrada_qt += quantidade;
        else next.entrada_fora_horizonte += quantidade;
        return { ...item, quantidade, periodo: periodo || "fora_horizonte" };
      });

      const estoqueTotal = Number(next.estoquetotal || 0);
      const consumoMa = Number(next.consumo_ma || 0);
      const consumoPx = Number(next.consumo_px || 0);
      const consumoUl = Number(next.consumo_ul || 0);
      const consumoQt = Number(next.consumo_qt || 0);
      const estoqueSeguranca = Number(next.estoque_cinco_dias || 0);
      next.saldo_ma = estoqueTotal + next.entrada_ma - consumoMa;
      next.saldo_px = estoqueTotal + next.entrada_ma + next.entrada_px - consumoMa - consumoPx;
      next.saldo_ul = estoqueTotal + next.entrada_ma + next.entrada_px + next.entrada_ul - consumoMa - consumoPx - consumoUl;
      next.saldo_qt = estoqueTotal + next.entrada_ma + next.entrada_px + next.entrada_ul + next.entrada_qt - consumoMa - consumoPx - consumoUl - consumoQt;
      next.excesso_ma = Math.max(next.saldo_ma - estoqueSeguranca, 0);
      next.excesso_px = Math.max(next.saldo_px - estoqueSeguranca, 0);
      next.excesso_ul = Math.max(next.saldo_ul - estoqueSeguranca, 0);
      next.excesso_qt = Math.max(next.saldo_qt - estoqueSeguranca, 0);
      next.dias_cobertura_ma = Number(next.consumo_dia || 0) > 0 ? next.saldo_ma / Number(next.consumo_dia || 0) : null;
      next.dias_cobertura_px = Number(next.consumo_dia || 0) > 0 ? next.saldo_px / Number(next.consumo_dia || 0) : null;
      next.dias_cobertura_ul = Number(next.consumo_dia || 0) > 0 ? next.saldo_ul / Number(next.consumo_dia || 0) : null;
      next.dias_cobertura_qt = Number(next.consumo_dia || 0) > 0 ? next.saldo_qt / Number(next.consumo_dia || 0) : null;
      return next;
    }).filter((row) => !somenteExcesso || (Number(row.consumo_dia || 0) > 0 && Number(row.saldo_qt || 0) > Number(row.estoque_cinco_dias || 0)));
    for (const row of rows) {
      row.custo_unitario = 0;
      row.data_custo = null;
      row.valor_excesso_ma = 0;
      row.valor_excesso_px = 0;
      row.valor_excesso_ul = 0;
      row.valor_excesso_qt = 0;
      row.valor_saldo_qt = 0;
    }

    const resumo = rows.reduce((acc, row) => {
      acc.itens += 1;
      acc.estoque += Number(row.estoquetotal || 0);
      acc.excesso_ma += Number(row.excesso_ma || 0);
      acc.excesso_px += Number(row.excesso_px || 0);
      acc.excesso_ul += Number(row.excesso_ul || 0);
      acc.excesso_qt += Number(row.excesso_qt || 0);
      acc.valor_excesso_ma += Number(row.valor_excesso_ma || 0);
      acc.valor_excesso_px += Number(row.valor_excesso_px || 0);
      acc.valor_excesso_ul += Number(row.valor_excesso_ul || 0);
      acc.valor_excesso_qt += Number(row.valor_excesso_qt || 0);
      acc.valor_saldo_qt += Number(row.valor_saldo_qt || 0);
      acc.saldo_qt += Number(row.saldo_qt || 0);
      acc.consumo_qt += Number(row.consumo_qt || 0);
      acc.consumo_ultimos_dias += Number(row.consumo_ultimos_dias || 0);
      return acc;
    }, {
      itens: 0,
      estoque: 0,
      excesso_ma: 0,
      excesso_px: 0,
      excesso_ul: 0,
      excesso_qt: 0,
      valor_excesso_ma: 0,
      valor_excesso_px: 0,
      valor_excesso_ul: 0,
      valor_excesso_qt: 0,
      valor_saldo_qt: 0,
      saldo_qt: 0,
      consumo_qt: 0,
      consumo_ultimos_dias: 0,
    });

    const porArtigoMap = new Map();
    for (const row of rows) {
      const key = String(row.artigo || "SEM ARTIGO").trim() || "SEM ARTIGO";
      if (!porArtigoMap.has(key)) {
        porArtigoMap.set(key, {
          artigo: key,
          itens: 0,
          estoque: 0,
          saldo_qt: 0,
          excesso_ma: 0,
          excesso_px: 0,
          excesso_ul: 0,
          excesso_qt: 0,
          valor_excesso_ma: 0,
          valor_excesso_px: 0,
          valor_excesso_ul: 0,
          valor_excesso_qt: 0,
          valor_saldo_qt: 0,
        });
      }
      const acc = porArtigoMap.get(key);
      acc.itens += 1;
      acc.estoque += Number(row.estoquetotal || 0);
      acc.saldo_qt += Number(row.saldo_qt || 0);
      acc.excesso_ma += Number(row.excesso_ma || 0);
      acc.excesso_px += Number(row.excesso_px || 0);
      acc.excesso_ul += Number(row.excesso_ul || 0);
      acc.excesso_qt += Number(row.excesso_qt || 0);
      acc.valor_excesso_ma += Number(row.valor_excesso_ma || 0);
      acc.valor_excesso_px += Number(row.valor_excesso_px || 0);
      acc.valor_excesso_ul += Number(row.valor_excesso_ul || 0);
      acc.valor_excesso_qt += Number(row.valor_excesso_qt || 0);
      acc.valor_saldo_qt += Number(row.valor_saldo_qt || 0);
    }

    const porArtigo = Array.from(porArtigoMap.values())
      .sort((a, b) => Number(b.valor_excesso_qt || 0) - Number(a.valor_excesso_qt || 0));

    const payload = {
      success: true,
      total: rows.length,
      meta: {
        diasConsumo,
        diasCobertura,
        operacoes: OPERACOES_CONSUMO_MP,
        somenteExcesso,
        consumoBase: "plano_emitido",
      },
      resumo,
      porArtigo,
      data: rows,
      cachedAt: Date.now(),
    };

    setCache(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    console.error("[excesso-mp] Erro:", error);
    return res.status(500).json({
      success: false,
      error: "Erro ao calcular excesso de MP",
      details: error.message,
    });
  }
});

module.exports = router;
