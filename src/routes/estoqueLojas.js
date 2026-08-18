/**
 * Rotas de API para estoque das lojas
 *
 * Endpoints:
 * - GET /api/estoque-lojas           - Lista estoque atual das lojas
 * - GET /api/estoque-lojas/excedente - Excedente por loja/produto
 * - GET /api/estoque-lojas/excedente-total - Excedente agregado por produto
 * - GET /api/estoque-lojas/lojas     - Lista de lojas disponíveis
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const {
  buscarEstoqueLojas,
  calcularEstoqueExcedentePorLoja,
  calcularExcedenteTotalPorProduto,
  buscarLojas,
  buscarEstoqueDisponivelTransferencia,
  buscarEstoqueDisponivelAgregadoPorProduto,
} = require("../services/estoqueLojas");
const { calcularEstoqueMinimo } = require("../services/estoqueMinimo");
const { withCache, invalidateCache, getCacheStatus } = require("../cache/estoqueLojaCache");

const DATA_DIR = path.join(__dirname, "../../data");
const ESTOQUE_LOJAS_FILE = path.join(DATA_DIR, "config_estoque_lojas.json");

/**
 * Lê a configuração de cobertura mínima do arquivo JSON
 */
function lerCoberturaConfigurada() {
  try {
    const raw = fs.readFileSync(ESTOQUE_LOJAS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const cfg = parsed?.data || {};
    return Number(cfg.cobertura_minima_lojas || 1.0);
  } catch {
    return 1.0; // fallback padrão
  }
}

function normalizarTexto(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

// Middleware de autenticação (mesmo padrão de configuracoes.js)
function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
  const expected = (process.env.ADMIN_PASSWORD || "").trim();
  if (!expected) {
    return res.status(500).json({ success: false, error: "ADMIN_PASSWORD nao configurado" });
  }
  if (token !== expected) {
    return res.status(401).json({ success: false, error: "Nao autorizado" });
  }
  next();
}

/**
 * GET /api/estoque-lojas
 * Retorna estoque atual de todas as lojas
 *
 * Query params:
 * - cdProduto: filtrar por produto específico
 * - cdEmpresa: filtrar por loja específica
 */
router.get("/", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const { cdProduto, cdEmpresa } = req.query;

    const data = await buscarEstoqueLojas(pool, {
      cdProduto: cdProduto ? Number(cdProduto) : null,
      cdEmpresa: cdEmpresa ? Number(cdEmpresa) : null
    });

    return res.json({
      success: true,
      total: data.length,
      data
    });
  } catch (error) {
    console.error("[estoqueLojas] Erro em GET /:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/estoque-lojas/lojas
 * Retorna lista de lojas disponíveis (com cache)
 */
router.get("/lojas", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const forceRefresh = req.query.refresh === 'true';

    const data = await withCache('lojas', async () => {
      return await buscarLojas(pool);
    }, forceRefresh);

    return res.json({
      success: true,
      total: data.length,
      cached: !forceRefresh,
      data
    });
  } catch (error) {
    console.error("[estoqueLojas] Erro em GET /lojas:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get("/disponivel", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const { refresh, lojaDestino, cdProduto, lojaOrigem } = req.query;
    const forceRefresh = refresh === "true";
    const destino = Number(lojaDestino || 1);
    const produto = cdProduto ? Number(cdProduto) : null;
    const origem = lojaOrigem ? Number(lojaOrigem) : null;
    const cacheKey = `disponivel_dest${destino}_prod${produto || "all"}_orig${origem || "all"}`;

    const data = await withCache(cacheKey, async () => {
      return await buscarEstoqueDisponivelTransferencia(pool, {
        lojaDestino: destino,
        cdProduto: produto,
        lojaOrigem: origem,
      });
    }, forceRefresh);

    return res.json({
      success: true,
      total: data.length,
      lojaDestino: destino,
      cached: !forceRefresh,
      data,
    });
  } catch (error) {
    console.error("[estoqueLojas] Erro em GET /disponivel:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get("/disponivel-total", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const { refresh, lojaDestino, cdProduto, incluirDetalhes } = req.query;
    const forceRefresh = refresh === "true";
    const destino = Number(lojaDestino || 1);
    const produto = cdProduto ? Number(cdProduto) : null;
    const detalhes = incluirDetalhes !== "false";
    const cacheKey = `disponivel_total_dest${destino}`;

    const data = await withCache(cacheKey, async () => {
      return await buscarEstoqueDisponivelAgregadoPorProduto(pool, {
        lojaDestino: destino,
        incluirDetalhes: true,
      });
    }, forceRefresh);

    let resultado = data;
    if (produto !== null) {
      resultado = resultado.filter((item) => Number(item.cd_produto) === produto);
    }

    const somaDisponivel = resultado.reduce((acc, item) => acc + Number(item.qtd_disponivel_total || 0), 0);

    return res.json({
      success: true,
      total: resultado.length,
      lojaDestino: destino,
      cached: !forceRefresh,
      resumo: {
        soma_disponivel_total: Math.round(somaDisponivel),
      },
      data: resultado.map((item) => ({
        ...item,
        detalhes_lojas: detalhes ? (item.detalhes_lojas || []) : [],
      })),
    });
  } catch (error) {
    console.error("[estoqueLojas] Erro em GET /disponivel-total:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/estoque-lojas/excedente
 * Retorna estoque excedente por loja/produto
 *
 * Query params:
 * - cdProduto: filtrar por produto específico
 * - coberturaMinima: cobertura mínima que a loja deve manter (padrão: lê do config_estoque_lojas.json)
 */
router.get("/excedente", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const { cdProduto, coberturaMinima } = req.query;

    // Se não foi passado coberturaMinima, usa o valor configurado no arquivo
    const coberturaConfigurada = lerCoberturaConfigurada();
    const cob = coberturaMinima ? Number(coberturaMinima) : coberturaConfigurada;

    if (cob <= 0) {
      return res.status(400).json({
        success: false,
        error: "coberturaMinima deve ser maior que zero"
      });
    }

    const data = await calcularEstoqueExcedentePorLoja(pool, {
      cdProduto: cdProduto ? Number(cdProduto) : null,
      coberturaMinima: cob
    });

    // Filtra apenas com excedente se solicitado
    const apenasComExcedente = req.query.apenasComExcedente === 'true';
    const resultado = apenasComExcedente
      ? data.filter(d => d.excedente > 0)
      : data;

    return res.json({
      success: true,
      total: resultado.length,
      coberturaMinima: cob,
      data: resultado
    });
  } catch (error) {
    console.error("[estoqueLojas] Erro em GET /excedente:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/estoque-lojas/excedente-total
 * Retorna excedente agregado por produto (soma de todas as lojas) - COM CACHE
 *
 * Query params:
 * - coberturaMinima: cobertura mínima que a loja deve manter (padrão: lê do config_estoque_lojas.json)
 * - apenasComExcedente: se 'true', retorna apenas produtos com excedente > 0
 * - refresh: se 'true', força atualização do cache
 */
router.get("/excedente-total", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const { coberturaMinima, apenasComExcedente, refresh, incluirDetalhes, cdProduto } = req.query;

    // Se não foi passado coberturaMinima, usa o valor configurado no arquivo
    const coberturaConfigurada = lerCoberturaConfigurada();
    const cob = coberturaMinima ? Number(coberturaMinima) : coberturaConfigurada;

    if (cob <= 0) {
      return res.status(400).json({
        success: false,
        error: "coberturaMinima deve ser maior que zero"
      });
    }

    const forceRefresh = refresh === 'true';
    const cacheKey = `excedente_total_cob${cob}`;

    // Busca dados com cache
    const data = await withCache(cacheKey, async () => {
      return await calcularExcedenteTotalPorProduto(pool, {
        coberturaMinima: cob
      });
    }, forceRefresh);

    // Por padrão, retorna apenas produtos com excedente
    const incluirDetalhesResultado = incluirDetalhes !== 'false';
    const cdProdutoFiltro = cdProduto ? Number(cdProduto) : null;
    const filtrar = apenasComExcedente !== 'false';
    let comExcedente = filtrar
      ? data.filter(p => p.excedente_total > 0)
      : data;

    if (cdProdutoFiltro) {
      comExcedente = comExcedente.filter(p => p.cd_produto === cdProdutoFiltro);
    }

    // Calcula totais
    const somaExcedente = comExcedente.reduce((acc, p) => acc + p.excedente_total, 0);
    const somaEstoqueLojas = comExcedente.reduce((acc, p) => acc + p.estoque_total_lojas, 0);
    const totalLojas = comExcedente.reduce((acc, p) => acc + p.lojas_com_excedente, 0);

    return res.json({
      success: true,
      total: comExcedente.length,
      coberturaMinima: cob,
      coberturaConfigurada: coberturaConfigurada,
      cached: !forceRefresh,
      resumo: {
        soma_excedente: Math.round(somaExcedente),
        soma_estoque_lojas: Math.round(somaEstoqueLojas),
        total_lojas_com_excedente: totalLojas
      },
      data: comExcedente.map(p => ({
        cd_produto: p.cd_produto,
        excedente_total: Math.round(p.excedente_total),
        estoque_total_lojas: Math.round(p.estoque_total_lojas),
        lojas_com_excedente: p.lojas_com_excedente,
        detalhes_lojas: incluirDetalhesResultado
          ? (p.detalhes_lojas || []).map(l => ({
              cd_empresa: l.cd_empresa,
              excedente: Math.round(l.excedente),
              estoque_loja: Math.round(l.estoque_loja),
              cobertura_atual: l.cobertura_atual ? Number(l.cobertura_atual.toFixed(2)) : null
            }))
          : []
      }))
    });
  } catch (error) {
    console.error("[estoqueLojas] Erro em GET /excedente-total:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post("/analise-pedido", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const loja = Number(req.body?.loja);
    const cobertura = Math.max(0, Number(req.body?.cobertura || lerCoberturaConfigurada() || 1));
    const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];

    if (!loja || !Number.isFinite(loja)) {
      return res.status(400).json({ success: false, error: "Loja invalida" });
    }
    if (!itens.length) {
      return res.status(400).json({ success: false, error: "Informe ao menos um item" });
    }

    const entradas = itens.map((item, idx) => ({
      linha: idx + 1,
      referencia: normalizarTexto(item?.referencia),
      cor: normalizarTexto(item?.cor),
      tamanho: normalizarTexto(item?.tamanho),
      qtd: Math.max(0, Number(item?.qtd || 0)),
      raw: item,
    }));

    const resolvidos = [];
    for (const entrada of entradas) {
      if (!entrada.referencia || !entrada.cor || !entrada.tamanho || entrada.qtd <= 0) {
        resolvidos.push({ entrada, produto: null, statusResolucao: "ENTRADA_INVALIDA", candidatos: [] });
        continue;
      }

      const candidatosRes = await pool.query(`
        SELECT
          a.cd_produto::BIGINT AS cd_produto,
          f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar)::TEXT AS referencia,
          f_dic_prd_nivel(a.cd_produto, 'DS'::bpchar)::TEXT AS produto,
          a.ds_cor AS cor,
          a.ds_tamanho AS tamanho,
          f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 20::bigint) AS marca,
          f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 27::bigint) AS status
        FROM vr_prd_prdgrade a
        WHERE UPPER(TRIM(COALESCE(f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar)::TEXT, ''))) = $1
          AND UPPER(TRIM(COALESCE(a.ds_tamanho, ''))) = $2
        LIMIT 80
      `, [entrada.referencia, entrada.tamanho]);

      const candidatos = candidatosRes.rows.map((row) => ({
        cdProduto: Number(row.cd_produto),
        referencia: String(row.referencia || ""),
        produto: String(row.produto || ""),
        cor: String(row.cor || ""),
        tamanho: String(row.tamanho || ""),
        marca: String(row.marca || ""),
        status: String(row.status || ""),
      }));
      const porCor = candidatos.filter((p) => normalizarTexto(p.cor) === entrada.cor);
      const produto = porCor[0] || null;

      resolvidos.push({
        entrada,
        produto,
        statusResolucao: produto ? "OK" : "NAO_ENCONTRADO",
        candidatos: produto ? [] : candidatos.slice(0, 10),
      });
    }

    const ids = [...new Set(resolvidos.map((r) => r.produto?.cdProduto).filter(Boolean))];
    const estoqueMap = new Map();
    const vendasMap = new Map();

    if (ids.length) {
      const estoqueRes = await pool.query(`
        SELECT
          cd_produto::BIGINT AS cd_produto,
          COALESCE(f_dic_sld_prd_produto($1::TEXT, '1'::TEXT, cd_produto, NULL::TIMESTAMP), 0)::FLOAT AS estoque
        FROM vr_prd_prdinfo
        WHERE cd_empresa = $1::BIGINT
          AND cd_produto = ANY($2::BIGINT[])
      `, [loja, ids]);

      estoqueRes.rows.forEach((row) => {
        estoqueMap.set(Number(row.cd_produto), Number(row.estoque || 0));
      });

      const hoje = new Date();
      const inicio6m = new Date(hoje.getFullYear(), hoje.getMonth() - 6, 1);
      const inicio3m = new Date(hoje.getFullYear(), hoje.getMonth() - 3, 1);
      const vendasRes = await pool.query(`
        SELECT
          i.cd_produto::BIGINT AS cd_produto,
          SUM(CASE WHEN i.dt_transacao >= $2 THEN i.qt_solicitada * (CASE WHEN t.tp_modalidade = '3' THEN -1 ELSE 1 END) ELSE 0 END)::FLOAT AS vendas_6m,
          SUM(CASE WHEN i.dt_transacao >= $3 THEN i.qt_solicitada * (CASE WHEN t.tp_modalidade = '3' THEN -1 ELSE 1 END) ELSE 0 END)::FLOAT AS vendas_3m
        FROM vr_tra_transacao t
        JOIN vr_tra_transitem i
          ON t.cd_empresa = i.cd_empresa
         AND t.nr_transacao = i.nr_transacao
        WHERE t.cd_empresa = $1
          AND i.cd_produto = ANY($4::BIGINT[])
          AND i.dt_transacao >= $2
          AND t.cd_operacao NOT IN (140, 76, 25, 26, 27, 273, 44, 240, 241, 242, 243, 244, 245, 239, 238, 237, 236)
          AND i.cd_compvend <> 1
          AND t.tp_situacao <> 6
          AND t.tp_modalidade IN ('3', '4')
        GROUP BY i.cd_produto
      `, [loja, inicio6m, inicio3m, ids]);

      vendasRes.rows.forEach((row) => {
        vendasMap.set(Number(row.cd_produto), {
          vendas6m: Math.max(0, Number(row.vendas_6m || 0)),
          vendas3m: Math.max(0, Number(row.vendas_3m || 0)),
        });
      });
    }

    const data = resolvidos.map((item) => {
      const produto = item.produto;
      if (!produto) {
        return {
          linha: item.entrada.linha,
          referencia: item.entrada.raw?.referencia || item.entrada.referencia,
          cor: item.entrada.raw?.cor || item.entrada.cor,
          tamanho: item.entrada.raw?.tamanho || item.entrada.tamanho,
          qtdSolicitada: item.entrada.qtd,
          status: item.statusResolucao,
          decisao: "NAO_ANALISADO",
          candidatos: item.candidatos,
        };
      }

      const vendas = vendasMap.get(produto.cdProduto) || { vendas6m: 0, vendas3m: 0 };
      const mediaSemestral = vendas.vendas6m / 6;
      const mediaTrimestral = vendas.vendas3m / 3;
      const calculo = calcularEstoqueMinimo(mediaSemestral, mediaTrimestral);
      const estoqueAtual = Number(estoqueMap.get(produto.cdProduto) || 0);
      const estoqueMinimo = Number(calculo.estoqueMinimo || 0);
      const alvo = estoqueMinimo * cobertura;
      const necessidade = Math.max(0, Math.ceil(alvo - estoqueAtual));
      const qtdSolicitada = Math.round(item.entrada.qtd);
      const qtdJustificada = Math.min(qtdSolicitada, necessidade);
      const excessoPedido = Math.max(0, qtdSolicitada - necessidade);
      const coberturaAtual = estoqueMinimo > 0 ? estoqueAtual / estoqueMinimo : null;
      const coberturaPos = estoqueMinimo > 0 ? (estoqueAtual + qtdSolicitada) / estoqueMinimo : null;
      const semHistorico = mediaSemestral <= 0 && mediaTrimestral <= 0;
      const decisao = semHistorico
        ? "SEM_HISTORICO"
        : necessidade <= 0
          ? "SEM_NECESSIDADE"
          : excessoPedido > 0
            ? "PARCIAL"
            : "NECESSARIO";

      return {
        linha: item.entrada.linha,
        cdProduto: String(produto.cdProduto),
        referencia: produto.referencia,
        produto: produto.produto,
        cor: produto.cor,
        tamanho: produto.tamanho,
        marca: produto.marca,
        statusProduto: produto.status,
        qtdSolicitada,
        estoqueAtual: Math.round(estoqueAtual),
        vendas6m: Math.round(vendas.vendas6m),
        vendas3m: Math.round(vendas.vendas3m),
        mediaSemestral,
        mediaTrimestral,
        estoqueMinimo,
        coberturaAlvo: cobertura,
        alvoEstoque: alvo,
        necessidade,
        qtdJustificada,
        excessoPedido,
        coberturaAtual,
        coberturaPos,
        decisao,
        regraEstoqueMinimo: calculo.regraAplicada,
        descricaoRegra: calculo.descricaoRegra,
      };
    });

    const resumo = data.reduce((acc, row) => {
      acc.itens += 1;
      acc.qtdSolicitada += Number(row.qtdSolicitada || 0);
      acc.qtdJustificada += Number(row.qtdJustificada || 0);
      acc.excessoPedido += Number(row.excessoPedido || 0);
      if (row.decisao === "NECESSARIO") acc.necessarios += 1;
      if (row.decisao === "PARCIAL") acc.parciais += 1;
      if (row.decisao === "SEM_NECESSIDADE") acc.semNecessidade += 1;
      if (row.decisao === "SEM_HISTORICO") acc.semHistorico += 1;
      if (row.status === "NAO_ENCONTRADO" || row.status === "ENTRADA_INVALIDA") acc.naoEncontrados += 1;
      return acc;
    }, { itens: 0, qtdSolicitada: 0, qtdJustificada: 0, excessoPedido: 0, necessarios: 0, parciais: 0, semNecessidade: 0, semHistorico: 0, naoEncontrados: 0 });

    return res.json({
      success: true,
      loja,
      cobertura,
      resumo,
      data,
    });
  } catch (error) {
    console.error("[estoqueLojas] Erro em POST /analise-pedido:", error.message);
    return res.status(500).json({
      success: false,
      error: "Erro ao analisar necessidade do pedido da loja",
      details: error.message,
    });
  }
});

/**
 * GET /api/estoque-lojas/cache-status
 * Retorna status do cache de estoque de lojas
 */
router.get("/cache-status", auth, async (req, res) => {
  try {
    const status = getCacheStatus();
    return res.json({
      success: true,
      ...status
    });
  } catch (error) {
    console.error("[estoqueLojas] Erro em GET /cache-status:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/estoque-lojas/invalidate-cache
 * Invalida o cache de estoque de lojas
 *
 * Body:
 * - key: chave específica do cache para invalidar (opcional, se omitido invalida tudo)
 */
router.post("/invalidate-cache", auth, async (req, res) => {
  try {
    const { key } = req.body;
    invalidateCache(key || null);

    return res.json({
      success: true,
      message: key ? `Cache '${key}' invalidado` : 'Todo o cache foi invalidado'
    });
  } catch (error) {
    console.error("[estoqueLojas] Erro em POST /invalidate-cache:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
