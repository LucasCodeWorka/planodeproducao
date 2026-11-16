/**
 * Disponibilidade de venda: lê mv_geo3 diretamente, sem reimplementar a fórmula.
 *
 * mv_geo3 já é a escada de disponibilidade correta (estoque + produção + lotes
 * MA/MG/PX/UL), construída e mantida fora deste repo pelo projeto irmão
 * C:\Users\ce_lu\OneDrive\Documentos\geo2 (view `geo3` + materialized view +
 * refresh a cada 2h via tarefa agendada do Windows). Aqui só consultamos o
 * resultado — mesma query usada em
 * dashboard-disponibilidade/app/api/disponibilidade/route.ts, agora servida
 * pelo backend principal (um único pool de conexão, em vez de duplicar).
 *
 * Fase 1 do plano de unificação plano/disponibilidade/atendimento — ver
 * C:\Users\ce_lu\.claude\plans\uma-grande-dificuldade-da-toasty-bentley.md
 */

const fs = require("fs");

let cache = { data: null, expiresAt: 0 };
const CACHE_TTL_MS = 1000 * 60 * 60; // 1h, igual ao dashboard-disponibilidade

// Melhor esforço, só funciona nesta máquina de desenvolvimento: o refresh de
// mv_geo3 roda fora deste repo (projeto geo2, tarefa agendada do Windows a
// cada 2h) e grava este log. Em produção (Render) esse caminho não existe —
// por isso tudo aqui é opcional e nunca derruba quem chama.
const GEO2_REFRESH_LOG = "C:\\Users\\ce_lu\\OneDrive\\Documentos\\geo2\\refresh_service.log";

/**
 * Última atualização conhecida de mv_geo3, lendo o log do refresh do geo2.
 * Retorna null (nunca lança) quando o arquivo não existe ou não tem uma linha
 * reconhecível — isso DEVE ser reportado como "desconhecida" pela UI, não
 * escondido nem estimado.
 */
function lerUltimaAtualizacaoMvGeo3() {
  try {
    if (!fs.existsSync(GEO2_REFRESH_LOG)) return { disponivel: false, motivo: "log não encontrado neste ambiente" };
    const conteudo = fs.readFileSync(GEO2_REFRESH_LOG, "utf-8");
    const linhas = conteudo.split(/\r?\n/).filter(Boolean);
    for (let i = linhas.length - 1; i >= 0; i -= 1) {
      const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+ - INFO - REFRESH OK/.exec(linhas[i]);
      if (m) return { disponivel: true, atualizadoEm: m[1], fonte: "local:geo2/refresh_service.log" };
    }
    return { disponivel: false, motivo: "nenhuma linha 'REFRESH OK' encontrada" };
  } catch (error) {
    return { disponivel: false, motivo: error.message };
  }
}

/**
 * @param {Object} pool
 * @param {Object} [opts]
 * @param {Array<number|string>} [opts.idproduto] - filtra por codigoproduto; omitido = tudo
 * @param {boolean} [opts.forceRefresh]
 * @returns {Promise<Array>}
 */
async function buscarDisponibilidadeVenda(pool, { idproduto, forceRefresh = false } = {}) {
  const temFiltro = Array.isArray(idproduto) && idproduto.length;

  if (!temFiltro && !forceRefresh && cache.data && cache.expiresAt > Date.now()) {
    return cache.data;
  }

  const params = [];
  let filtro = "";
  if (temFiltro) {
    params.push(idproduto.map(String));
    filtro = `WHERE g.codigoproduto = ANY($1::BIGINT[])`;
  }

  const { rows } = await pool.query(
    `WITH produtos AS (
       SELECT DISTINCT codigoproduto FROM public.mv_geo3 g ${filtro}
     ), classificacoes AS (
       SELECT codigoproduto,
         COALESCE(f_dic_prd_classificacao(g.codigoproduto, 'DS', 20), '') AS marca,
         COALESCE(f_dic_prd_classificacao(g.codigoproduto, 'DS', 27), '') AS status,
         COALESCE(f_dic_prd_classificacao(g.codigoproduto, 'DS', 802), '') AS continuidade,
         COALESCE(f_dic_prd_classificacao(g.codigoproduto, 'DS', 23), '') AS linha,
         COALESCE(f_dic_prd_classificacao(codigoproduto, 'DS', 24), '') AS familia
       FROM produtos g
     )
     SELECT g.codigoproduto, g.cd_nivel, g.codtamanho, g.seqtamanho, g.nomecolecao,
       g.dataproduto, g.quantidade, g.quantidadeprontaentrega, g.codcorbase,
       g.nm_produto, g.nomecor, g.ean13, c.marca, c.status, c.continuidade, c.linha, c.familia
     FROM public.mv_geo3 g JOIN classificacoes c USING (codigoproduto)`,
    params
  );

  if (!temFiltro) {
    cache = { data: rows, expiresAt: Date.now() + CACHE_TTL_MS };
  }

  return rows;
}

/**
 * Versão enxuta para reconciliação em lote: só codigoproduto/quantidade, sem
 * o JOIN de classificação (marca/status/continuidade/linha/família). Medido
 * em 2026-11-13: 3.643 SKUs — 30.8s com classificação, 0.6s sem. Usar esta
 * função sempre que só precisar somar quantidade por SKU (ex.: macro/lotes da
 * Operação Integrada); usar buscarDisponibilidadeVenda quando a tela realmente
 * exibe marca/status/linha por linha.
 */
async function buscarQuantidadeMvGeo3PorSku(pool, idproduto) {
  if (!Array.isArray(idproduto) || !idproduto.length) return [];
  const { rows } = await pool.query(
    `SELECT codigoproduto, quantidade FROM public.mv_geo3 WHERE codigoproduto = ANY($1::BIGINT[])`,
    [idproduto.map(String)]
  );
  return rows;
}

module.exports = { buscarDisponibilidadeVenda, buscarQuantidadeMvGeo3PorSku, lerUltimaAtualizacaoMvGeo3 };
