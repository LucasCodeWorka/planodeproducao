/**
 * Serviço para geração de projeções automáticas para itens PERMANENTE e PERMANENTE COR NOVA
 * Regras:
 * 1. Totalizadores = Vendas Fábrica × ajuste + Vendas Lojas (ajuste: 10% em todos os meses)
 * 2. Representatividade por SKU baseada em média 6m vs 3m (usa tendência se variação > 50%)
 * 3. Projeção = Totalizador × Representatividade
 */

const { readCache, readCacheByKey, writeCacheByKey } = require('../cache/matrizCache');
const { isExcludedPlanningItem, normalizePlanningText } = require('./planningExclusions');

// Ajustes de fábrica por mês (1 = janeiro, ..., 6 = junho)
const AJUSTES_FABRICA = {
  1: 1.10,  // Janeiro: +10%
  2: 1.10,  // Fevereiro: +10%
  3: 1.10,  // Março: +10%
  // Abril e maio de 2026 ficaram baixos por problemas de estoque que não devem
  // se repetir, então a base é corrigida com um ajuste maior que o dos demais meses.
  4: 1.20,  // Abril: +20%
  5: 1.20,  // Maio: +20%
  6: 1.10,  // Junho: +10%
};

const MESES_SEMESTRE = [1, 2, 3, 4, 5, 6]; // jan a jun

// Prefixo da chave de cache do catalogo de permanentes vindo do banco.
const CACHE_SKUS_BANCO = 'skus_permanentes_banco';

/**
 * Busca vendas reais por canal a partir da mv_vendas_qtd.
 * Fábrica = empresa 1; Lojas = demais empresas.
 * @param {Object} pool - Pool de conexão PostgreSQL
 * @param {number} ano - Ano base
 * @returns {Promise<Object>} { fabrica: { 1: qtd, 2: qtd, ... }, lojas: { 1: qtd, 2: qtd, ... } }
 */
async function buscarVendasPorCanal(pool, ano) {
  console.log(`[projecao-permanentes] Buscando vendas reais por canal de ${ano}.1...`);
  const t0 = Date.now();

  const vendas = {
    fabrica: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    lojas: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
  };

  // O cadastro do banco preserva produtos que ja sairam de linha; o cache atual pode nao preserva-los.
  let skusBanco = [];
  try {
    skusBanco = await buscarSkusPermanentesBanco(pool, ano);
  } catch (error) {
    console.warn(`[projecao-permanentes] Erro ao buscar catalogo do banco: ${error.message}`);
  }

  const idsBanco = skusBanco.map((sku) => Number(sku.idproduto)).filter(Number.isFinite);
  if (idsBanco.length > 0) {
    const result = await pool.query(`
      WITH produtos AS (
        SELECT UNNEST($1::BIGINT[]) AS idproduto
      )
      SELECT
        EXTRACT(MONTH FROM v.data)::INT AS mes,
        SUM(CASE WHEN v.idempresa = 1 THEN v.qt_liquida ELSE 0 END)::FLOAT AS fabrica,
        SUM(CASE WHEN v.idempresa <> 1 THEN v.qt_liquida ELSE 0 END)::FLOAT AS lojas
      FROM public.mv_vendas_qtd v
      INNER JOIN produtos p ON p.idproduto = v.idproduto
      WHERE v.data >= $2::DATE
        AND v.data < $3::DATE
        AND EXTRACT(MONTH FROM v.data) BETWEEN 1 AND 6
      GROUP BY 1
      ORDER BY 1
    `, [idsBanco, `${ano}-01-01`, `${ano}-07-01`]);

    for (const row of result.rows) {
      const mes = Number(row.mes);
      if (!MESES_SEMESTRE.includes(mes)) continue;
      vendas.fabrica[mes] = Math.round(Number(row.fabrica) || 0);
      vendas.lojas[mes] = Math.round(Number(row.lojas) || 0);
    }

    const totalVendasBanco = MESES_SEMESTRE.reduce(
      (acc, mes) => acc + vendas.fabrica[mes] + vendas.lojas[mes],
      0
    );
    console.log(`[projecao-permanentes] Vendas reais: ${totalVendasBanco.toFixed(0)} total em ${((Date.now()-t0)/1000).toFixed(3)}s`);
    return vendas;
  }

  // Fallback legado: usa o cache apenas se o catalogo do banco estiver indisponivel.
  const cached = await readCache();
  let cacheData = [];

  if (!cached || !cached.data) {
    console.log(`[projecao-permanentes] Cache não disponível, usando catálogo do banco`);
  } else {
    cacheData = cached.data.rows || cached.data;
    if (!Array.isArray(cacheData)) {
      console.log(`[projecao-permanentes] Cache inválido, usando catálogo do banco`);
      cacheData = [];
    }
  }

  // Base historica da marca: inclui itens fora de linha, exceto edicao limitada.
  const produtosFiltrados = cacheData.filter(item => {
    const produto = item?.produto || {};
    const continuidade = normalizePlanningText(produto.continuidade);
    const marca = normalizePlanningText(produto.marca);
    return (
      marca === 'LIEBE' &&
      continuidade !== 'EDICAO LIMITADA' &&
      !isExcludedPlanningItem({
        referencia: produto.referencia,
        produto: produto.produto,
        apresentacao: produto.apresentacao,
      })
    );
  });

  const ids = [...new Set(produtosFiltrados
    .map(item => Number(item?.produto?.idproduto))
    .filter(Number.isFinite)
  )];

  const idsConsulta = ids.length > 0
    ? ids
    : (await buscarSkusPermanentesBanco(pool, ano)).map((sku) => Number(sku.idproduto)).filter(Number.isFinite);

  if (idsConsulta.length === 0) {
    console.log(`[projecao-permanentes] Nenhum produto elegivel encontrado, retornando zeros`);
    return vendas;
  }

  const result = await pool.query(`
    WITH produtos AS (
      SELECT UNNEST($1::BIGINT[]) AS idproduto
    )
    SELECT
      EXTRACT(MONTH FROM v.data)::INT AS mes,
      SUM(CASE WHEN v.idempresa = 1 THEN v.qt_liquida ELSE 0 END)::FLOAT AS fabrica,
      SUM(CASE WHEN v.idempresa <> 1 THEN v.qt_liquida ELSE 0 END)::FLOAT AS lojas
    FROM public.mv_vendas_qtd v
    INNER JOIN produtos p ON p.idproduto = v.idproduto
    WHERE v.data >= $2::DATE
      AND v.data < $3::DATE
      AND EXTRACT(MONTH FROM v.data) BETWEEN 1 AND 6
    GROUP BY 1
    ORDER BY 1
  `, [idsConsulta, `${ano}-01-01`, `${ano}-07-01`]);

  for (const row of result.rows) {
    const mes = Number(row.mes);
    if (!MESES_SEMESTRE.includes(mes)) continue;
    vendas.fabrica[mes] = Math.round(Number(row.fabrica) || 0);
    vendas.lojas[mes] = Math.round(Number(row.lojas) || 0);
  }

  const totalVendas6m = MESES_SEMESTRE.reduce(
    (acc, mes) => acc + vendas.fabrica[mes] + vendas.lojas[mes],
    0
  );

  console.log(`[projecao-permanentes] Vendas reais: ${totalVendas6m.toFixed(0)} total em ${((Date.now()-t0)/1000).toFixed(3)}s`);

  return vendas;
}

/**
 * Calcula os totalizadores por mês aplicando os ajustes
 * @param {Object} vendas - { fabrica: {...}, lojas: {...} }
 * @returns {Object} { 1: { fabrica, lojas, ajuste, total }, 2: {...}, ... }
 */
function calcularTotalizadores(vendas) {
  const totalizadores = {};

  for (const mes of MESES_SEMESTRE) {
    const fabricaBase = Number(vendas.fabrica[mes]) || 0;
    const lojasBase = Number(vendas.lojas[mes]) || 0;
    const ajuste = AJUSTES_FABRICA[mes] || 1.10;
    const fabricaAjustada = Math.round(fabricaBase * ajuste);
    const total = fabricaAjustada + lojasBase;

    totalizadores[mes] = {
      fabrica: fabricaBase,
      fabricaAjustada,
      lojas: lojasBase,
      ajuste,
      ajustePct: Math.round((ajuste - 1) * 100),
      total,
    };
  }

  return totalizadores;
}

/**
 * Busca SKUs permanentes direto do catálogo do banco.
 * Usado como fallback quando o cache da matriz não está carregado.
 * @param {Object} pool - Pool de conexão PostgreSQL
 * @returns {Promise<Array>} Lista de SKUs com dados cadastrais
 */
async function buscarSkusPermanentesBanco(pool, ano = null, somenteAtuais = false) {
  const t0 = Date.now();

  // Esta consulta roda seis funcoes escalares por linha sobre o catalogo inteiro e leva
  // ~67s, dominando sozinha o tempo da Visao Macro. O resultado e cadastral e muda pouco,
  // entao vale cachear por chave. Falha de cache nunca impede a consulta de rodar.
  const chaveCache = `${CACHE_SKUS_BANCO}_${ano ?? 'sem_ano'}_${somenteAtuais ? 'atuais' : 'todos'}`;
  try {
    const cache = await readCacheByKey(chaveCache);
    if (cache?.fresh && Array.isArray(cache.data)) {
      console.log(`[projecao-permanentes] SKUs do banco (cache): ${cache.data.length} em ${((Date.now() - t0) / 1000).toFixed(3)}s`);
      return cache.data;
    }
  } catch (error) {
    console.warn(`[projecao-permanentes] cache de catalogo indisponivel: ${error.message}`);
  }

  console.log('[projecao-permanentes] Buscando SKUs permanentes do banco...');
  const temPeriodoVenda = ano !== null && ano !== undefined && Number.isInteger(Number(ano));
  const periodoVenda = temPeriodoVenda
    ? `AND EXISTS (
        SELECT 1
        FROM public.mv_vendas_qtd vendas_periodo
        WHERE vendas_periodo.idproduto = a.cd_produto
          AND vendas_periodo.data >= $1::DATE
          AND vendas_periodo.data < $2::DATE
      )`
    : '';
  const parametros = temPeriodoVenda
    ? [`${ano}-01-01`, `${ano}-07-01`]
    : [];
  const filtroStatusAtual = somenteAtuais
    ? "AND UPPER(TRIM(COALESCE(p.status, ''))) IN ('EM LINHA', 'NOVA COLECAO')"
    : '';

  const result = await pool.query(`
    SELECT *
    FROM (
      SELECT
        a.cd_produto::TEXT AS idproduto,
        a.ds_cor AS cor,
        a.ds_tamanho AS tamanho,
        a.nm_produto AS apresentacao,
        f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar) AS referencia,
        f_dic_prd_nivel(a.cd_produto, 'DS'::bpchar) AS produto,
        f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 20::bigint) AS marca,
        f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 27::bigint) AS status,
        f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 802::bigint) AS continuidade,
        f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 23::bigint) AS linha
      FROM vr_prd_prdgrade a
      WHERE a.cd_produto < 1000000
        AND UPPER(COALESCE(a.nm_produto, '')) NOT LIKE '%MEIA DE SEDA%'
        AND UPPER(TRIM(COALESCE(a.ds_tamanho, ''))) <> 'PT 99'
        ${periodoVenda}
    ) p
    WHERE UPPER(TRIM(COALESCE(p.marca, ''))) = 'LIEBE'
      AND UPPER(TRIM(COALESCE(p.continuidade, ''))) IN ('PERMANENTE', 'PERMANENTE COR NOVA')
      AND UPPER(TRIM(COALESCE(p.continuidade, ''))) NOT IN ('EDIÇÃO LIMITADA', 'EDICAO LIMITADA')
      ${filtroStatusAtual}
    ORDER BY p.referencia, p.idproduto
  `, parametros);

  const skus = result.rows
    .filter((row) => !isExcludedPlanningItem({
      referencia: row.referencia,
      produto: row.produto,
      apresentacao: row.apresentacao,
    }))
    .map((row) => ({
      idproduto: String(row.idproduto || ''),
      referencia: String(row.referencia || '').trim(),
      produto: String(row.produto || '').trim(),
      cor: String(row.cor || '').trim(),
      tamanho: String(row.tamanho || '').trim(),
      continuidade: String(row.continuidade || 'SEM CONTINUIDADE').trim().toUpperCase(),
      status: String(row.status || 'INDEFINIDO').trim().toUpperCase(),
      linha: String(row.linha || '').trim(),
      media_6m: 0,
      media_3m: 0,
    }));

  try {
    await writeCacheByKey(chaveCache, skus, { ano, somenteAtuais, geradoPor: 'projecaoPermanentesService' });
  } catch (error) {
    console.warn(`[projecao-permanentes] nao consegui gravar o cache de catalogo: ${error.message}`);
  }

  console.log(`[projecao-permanentes] SKUs do banco: ${skus.length} em ${((Date.now()-t0)/1000).toFixed(3)}s`);
  return skus;
}

/**
 * Busca SKUs com continuidade PERMANENTE ou PERMANENTE COR NOVA
 * OTIMIZADO: usa o cache matriz_planejamento já existente em memória
 * Isso é INSTANTÂNEO pois apenas filtra dados já carregados
 * @param {Object} pool - Pool de conexão PostgreSQL (não usado, mantido para compatibilidade)
 * @returns {Promise<Array>} Lista de SKUs com dados cadastrais
 */
async function buscarSkusPermanentes(pool, ano = null) {
  console.log('[projecao-permanentes] Buscando SKUs permanentes do cache...');
  const t0 = Date.now();

  // Usa o cache matriz_planejamento que já está em memória
  const cached = await readCache();

  if (!cached || !cached.data) {
    console.log('[projecao-permanentes] Cache não disponível, usando banco');
    return buscarSkusPermanentesBanco(pool, null, true);
  }

  const cacheData = cached.data.rows || cached.data;

  if (!Array.isArray(cacheData)) {
    console.log('[projecao-permanentes] Cache inválido (não é array), usando banco');
    return buscarSkusPermanentesBanco(pool, null, true);
  }

  // Inclui produtos fora de linha na base historica, exceto edicao limitada.
  const skusFiltrados = cacheData.filter(item => {
    const produto = item?.produto || {};
    const continuidade = normalizePlanningText(produto.continuidade);
    const marca = normalizePlanningText(produto.marca);
    const status = normalizePlanningText(produto.status);

    return (
      marca === 'LIEBE' &&
      (continuidade === 'PERMANENTE' || continuidade === 'PERMANENTE COR NOVA') &&
      continuidade !== 'EDICAO LIMITADA' &&
      (status === 'EM LINHA' || status === 'NOVA COLECAO') &&
      !isExcludedPlanningItem({
        referencia: produto.referencia,
        produto: produto.produto,
        apresentacao: produto.apresentacao,
      })
    );
  });

  console.log(`[projecao-permanentes] Filtrado do cache: ${skusFiltrados.length} SKUs em ${((Date.now()-t0)/1000).toFixed(3)}s`);

  // Mapeia para o formato esperado - incluindo dados de demanda
  return skusFiltrados.map(item => {
    const produto = item?.produto || {};
    const demanda = item?.demanda || {};
    return {
      idproduto: String(produto.idproduto || ''),
      referencia: String(produto.referencia || '').trim(),
      produto: String(produto.produto || '').trim(),
      cor: String(produto.cor || '').trim(),
      tamanho: String(produto.tamanho || '').trim(),
      continuidade: String(produto.continuidade || 'SEM CONTINUIDADE').trim().toUpperCase(),
      status: String(produto.status || 'INDEFINIDO').trim().toUpperCase(),
      linha: String(produto.linha || '').trim(),
      // Inclui dados de demanda do cache
      media_6m: Number(demanda.media_vendas_6m) || 0,
      media_3m: Number(demanda.media_vendas_3m) || 0,
    };
  });
}

/**
 * Calcula médias de vendas a partir dos dados já presentes nos SKUs (do cache).
 * Mantido como fallback/debug; o preview usa calcularMediasVendas para respeitar o anoBase.
 * @param {Object} pool - Pool de conexão PostgreSQL (não usado)
 * @param {Array} skus - Lista de SKUs com media_6m e media_3m já preenchidos
 * @param {number} anoBase - Ano base (não usado)
 * @returns {Object} { idproduto: { media_6m, total_6m, media_3m, total_3m } }
 */
function calcularMediasVendasDoCache(skus) {
  console.log(`[projecao-permanentes] Calculando médias de vendas do cache para ${skus.length} SKUs...`);
  const t0 = Date.now();

  const medias = {};

  for (const sku of skus) {
    const id = String(sku.idproduto);
    const media6m = Number(sku.media_6m) || 0;
    const media3m = Number(sku.media_3m) || 0;

    medias[id] = {
      media_6m: media6m,
      total_6m: media6m * 6,  // média mensal × 6 meses
      media_3m: media3m,
      total_3m: media3m * 3,  // média mensal × 3 meses
    };
  }

  console.log(`[projecao-permanentes] Médias calculadas em ${((Date.now()-t0)/1000).toFixed(3)}s`);
  return medias;
}

/**
 * Calcula vendas reais para a representatividade.
 * 6m = jan-jun do anoBase na MV; 3m atual = jun-ago na view vr_vendas_qtd.
 */
async function calcularMediasVendas(pool, idprodutos, anoBase) {
  if (!idprodutos || idprodutos.length === 0) {
    return {};
  }

  const ids = idprodutos.map((id) => Number(id)).filter(Number.isFinite);

  const medias = {};
  for (const id of idprodutos) {
    medias[String(id)] = {
      media_6m: 0,
      total_6m: 0,
      media_3m: 0,
      total_3m: 0,
    };
  }

  if (ids.length === 0) {
    return medias;
  }

  const cached = await readCache();
  const cacheRows = Array.isArray(cached?.data?.rows)
    ? cached.data.rows
    : (Array.isArray(cached?.data) ? cached.data : []);
  const medias3mCache = new Map();

  for (const item of cacheRows) {
    const id = String(item?.produto?.idproduto || '');
    const media3m = Number(item?.demanda?.media_vendas_3m);
    if (id && Number.isFinite(media3m)) medias3mCache.set(id, media3m);
  }

  for (const id of ids) {
    const media3m = medias3mCache.get(String(id));
    if (media3m !== undefined) {
      medias[String(id)].media_3m = media3m;
      medias[String(id)].total_3m = media3m * 3;
    }
  }

  const idsSem3mCache = ids.filter((id) => !medias3mCache.has(String(id)));
  const result6m = await pool.query(`
      SELECT
        v.idproduto::TEXT AS idproduto,
        COALESCE(SUM(v.qt_liquida), 0)::FLOAT AS total_6m
      FROM public.mv_vendas_qtd v
      WHERE v.idproduto = ANY($1::BIGINT[])
        AND v.data >= $2::DATE
        AND v.data < $3::DATE
      GROUP BY v.idproduto
    `, [ids, `${anoBase}-01-01`, `${anoBase}-07-01`]);
  const result3m = idsSem3mCache.length > 0
    ? await pool.query(`
      SELECT
        vendas.idproduto::TEXT AS idproduto,
        COALESCE(SUM(vendas.qt_liquida), 0)::FLOAT AS total_3m
      FROM (
        SELECT
          i.cd_produto AS idproduto,
          SUM(i.qt_solicitada * CASE WHEN t.tp_modalidade::TEXT = '3' THEN -1 ELSE 1 END::DOUBLE PRECISION) AS qt_liquida
        FROM vr_tra_transacao t
        INNER JOIN vr_tra_transitem i
          ON t.nr_transacao = i.nr_transacao
         AND t.cd_empresa = i.cd_empresa
        WHERE t.cd_empresa <> 1
          AND t.cd_operacao <> ALL (ARRAY[140, 76, 25, 26, 27, 273, 44, 240, 241, 242, 243, 244, 245, 239, 238, 237, 236]::BIGINT[])
          AND i.dt_transacao >= $1::DATE
          AND i.dt_transacao < $2::DATE
          AND i.cd_produto = ANY($3::BIGINT[])
          AND i.cd_compvend <> 1
          AND t.tp_situacao <> 6
          AND t.tp_modalidade::TEXT = ANY (ARRAY['3', '4']::TEXT[])
        GROUP BY i.cd_produto

        UNION ALL

        SELECT
          i.cd_produto AS idproduto,
          SUM(i.qt_solicitada) AS qt_liquida
        FROM vr_ped_pedidoc2 c
        LEFT JOIN vr_ped_pedidoi i
          ON c.cd_empresa = i.cd_empresa
         AND i.cd_pedido = c.cd_pedido
        WHERE c.dt_pedido >= $1::DATE
          AND c.dt_pedido < $2::DATE
          AND i.cd_produto = ANY($3::BIGINT[])
          AND c.cd_cliente <> 110000001
          AND c.cd_representant <> 32098
          AND c.tp_situacao <> 6
          AND c.cd_empresa = 1
          AND c.cd_operacao = ANY (ARRAY[1, 18, 52, 166, 148, 98, 55, 97, 30, 79, 93, 137, 141, 142, 156, 159, 310, 598, 180, 58, 69, 85, 124, 182]::BIGINT[])
        GROUP BY i.cd_produto
      ) vendas
      GROUP BY vendas.idproduto
    `, [`${anoBase}-06-01`, `${anoBase}-09-01`, idsSem3mCache])
    : { rows: [] };

  for (const row of result6m.rows) {
    const id = String(row.idproduto);
    if (medias[id]) {
      medias[id].total_6m = Number(row.total_6m) || 0;
      medias[id].media_6m = medias[id].total_6m / 6;
    }
  }

  for (const row of result3m.rows) {
    const id = String(row.idproduto);
    if (medias[id]) {
      medias[id].total_3m = Number(row.total_3m) || 0;
      medias[id].media_3m = medias[id].total_3m / 3;
    }
  }

  return medias;
}

/**
 * Calcula a representatividade de cada SKU
 * Regra: se variação > 50%, usa tendência (3m), senão média das representatividades
 * @param {Object} medias - { idproduto: { media_6m, total_6m, media_3m, total_3m } }
 * @returns {Object} { idproduto: { representatividade, usaTendencia, variacao_pct } }
 */
 function calcularRepresentatividade(medias, totaisBase = null) {
  // Primeiro calcula totais globais
  let totalGeral6m = 0;
  let totalGeral3m = 0;

  if (totaisBase) {
    totalGeral6m = Number(totaisBase.total_6m) || 0;
    totalGeral3m = Number(totaisBase.total_3m) || 0;
  } else {
    for (const id of Object.keys(medias)) {
      totalGeral6m += Number(medias[id].total_6m) || 0;
      totalGeral3m += Number(medias[id].total_3m) || 0;
    }
  }

  // Evita divisão por zero
  totalGeral6m = totalGeral6m || 1;
  totalGeral3m = totalGeral3m || 1;

  const representatividades = {};

  for (const id of Object.keys(medias)) {
    const m = medias[id];
    const media6m = Number(m.media_6m) || 0;
    const media3m = Number(m.media_3m) || 0;
    const total6m = Number(m.total_6m) || 0;
    const total3m = Number(m.total_3m) || 0;

    // Representatividade de cada período
    const rep6m = total6m / totalGeral6m;
    const rep3m = total3m / totalGeral3m;

    // Variação da REPRESENTATIVIDADE (participação % no total), não do valor absoluto.
    // Isso evita que uma queda geral da marca (que afeta todos os SKUs igualmente)
    // seja interpretada como mudança de comportamento de um SKU específico —
    // só conta como variação real se o SKU ganhou ou perdeu peso relativo.
    // Caso especial: sem histórico em 6m (SKU novo/recém-lançado) — não dá pra
    // calcular variação percentual sobre uma base zero, então força tendência (3m).
    const semHistorico6m = rep6m <= 0 && rep3m > 0;
    let variacao;
    let variacaoPct;

    if (semHistorico6m) {
      variacao = 1; // força usaTendencia
      variacaoPct = null; // sem percentual válido para exibir (SKU novo)
    } else if (rep6m <= 0) {
      variacao = 0;
      variacaoPct = 0;
    } else {
      variacao = Math.abs(rep3m - rep6m) / rep6m;
      variacaoPct = variacao * 100;
    }

    // Decide qual usar
    const usaTendencia = variacao > 0.5;
    let representatividade;

    if (usaTendencia) {
      // Usa tendência (3 meses)
      representatividade = rep3m;
    } else {
      // Usa média das duas representatividades
      representatividade = (rep6m + rep3m) / 2;
    }

    representatividades[id] = {
      media_6m: media6m,
      media_3m: media3m,
      total_6m: total6m,
      total_3m: total3m,
      rep_6m: rep6m,
      rep_3m: rep3m,
      variacao_pct: variacaoPct === null ? null : Number(variacaoPct.toFixed(1)),
      semHistorico6m,
      usaTendencia,
      representatividade,
    };
  }

  const somaRepresentatividade = Object.values(representatividades)
    .reduce((acc, item) => acc + (Number(item.representatividade) || 0), 0);

  if (somaRepresentatividade > 0) {
    for (const id of Object.keys(representatividades)) {
      representatividades[id].representatividade =
        representatividades[id].representatividade / somaRepresentatividade;
    }
  }

  return representatividades;
}

/**
 * Gera projeções finais para cada SKU
 * @param {Object} totalizadores - Totalizadores por mês
 * @param {Object} representatividades - Representatividade por SKU
 * @returns {Object} { idproduto: { 1: qtd, 2: qtd, ..., 6: qtd } }
 */
function gerarProjecoes(totalizadores, representatividades) {
  const projecoes = {};
  const ids = Object.keys(representatividades);

  for (const id of ids) {
    projecoes[id] = {};
  }

  for (const mes of MESES_SEMESTRE) {
    const total = Math.round(Number(totalizadores[mes]?.total) || 0);
    const calculos = ids.map((id) => {
      const rep = Number(representatividades[id].representatividade) || 0;
      const bruto = total * rep;
      const base = Math.floor(bruto);
      return { id, base, sobra: bruto - base };
    });

    let distribuido = calculos.reduce((acc, item) => acc + item.base, 0);
    let restante = total - distribuido;

    calculos.sort((a, b) => b.sobra - a.sobra);
    for (const item of calculos) {
      const adicional = restante > 0 ? 1 : 0;
      projecoes[item.id][mes] = item.base + adicional;
      restante -= adicional;
    }
  }

  return projecoes;
}

/**
 * @deprecated A distribuição com Math.round podia deixar a soma mensal diferente do totalizador.
 */
function gerarProjecoesComArredondamentoSimples(totalizadores, representatividades) {
  const projecoes = {};

  for (const id of Object.keys(representatividades)) {
    const rep = representatividades[id].representatividade || 0;
    projecoes[id] = {};
    for (const mes of MESES_SEMESTRE) {
      const total = totalizadores[mes]?.total || 0;
      projecoes[id][mes] = Math.round(total * rep);
    }
  }

  return projecoes;
}

/**
 * Função principal que executa todo o processo de geração de projeções
 * @param {Object} pool - Pool de conexão PostgreSQL
 * @param {number} anoBase - Ano base para histórico (ex: 2026)
 * @param {number} anoDestino - Ano destino para projeções (ex: 2027)
 * @returns {Promise<Object>} Resultado completo com totalizadores, SKUs e projeções
 */
async function gerarPreviewProjecoes(pool, anoBase, anoDestino) {
  // 1. Busca vendas por canal
  const vendas = await buscarVendasPorCanal(pool, anoBase);

  // 2. Calcula totalizadores
  const totalizadores = calcularTotalizadores(vendas);

  // 3. Busca SKUs permanentes
  const skus = await buscarSkusPermanentes(pool, anoBase);

  if (skus.length === 0) {
    return {
      success: true,
      anoBase,
      anoDestino,
      totalizadores,
      resumo: {
        totalSkus: 0,
        skusPermanente: 0,
        skusPermanenteCorNova: 0,
        skusComTendencia: 0,
        skusComMedia: 0,
        totalProjecao: 0,
      },
      itens: [],
      itensSemVenda: [],
    };
  }

  // 4. Calcula médias usando venda real do semestre base
  const mediasBrutas = await calcularMediasVendas(pool, skus.map((sku) => sku.idproduto), anoBase);
  const skusSemVenda = skus.filter((sku) => {
    const media = mediasBrutas[String(sku.idproduto)] || {};
    return (Number(media.total_6m) || 0) <= 0 && (Number(media.total_3m) || 0) <= 0;
  });
  const skusProjetaveis = skus.filter((sku) => {
    const media = mediasBrutas[String(sku.idproduto)] || {};
    const camposPt = [sku.tamanho, sku.referencia, sku.produto, sku.apresentacao]
      .map((valor) => normalizePlanningText(valor));
    const temVenda = (Number(media.total_6m) || 0) > 0 || (Number(media.total_3m) || 0) > 0;
    const ehItemPt = camposPt.some((valor) => /^PT(?:\s|$)/.test(valor));
    return temVenda && !ehItemPt;
  });
  const medias = Object.fromEntries(
    skusProjetaveis.map((sku) => [String(sku.idproduto), mediasBrutas[String(sku.idproduto)]])
  );

  // 5. Calcula representatividades
  // Os SKUs atuais absorvem a participacao dos produtos que sairam de linha.
  // Por isso, a representatividade 6m/3m e normalizada dentro da tabela atual.
  const representatividades = calcularRepresentatividade(medias);

  // 6. Gera projeções
  const projecoes = gerarProjecoes(totalizadores, representatividades);

  // 7. Monta resultado final
  const itens = skusProjetaveis.map((sku) => {
    const id = String(sku.idproduto);
    const rep = representatividades[id] || {};
    const proj = projecoes[id] || {};

    return {
      idproduto: id,
      referencia: sku.referencia || '',
      produto: sku.produto || '',
      cor: sku.cor || '',
      tamanho: sku.tamanho || '',
      continuidade: sku.continuidade || '',
      linha: sku.linha || '',
      media_6m: rep.media_6m || 0,
      media_3m: rep.media_3m || 0,
      rep_6m: rep.rep_6m || 0,
      rep_3m: rep.rep_3m || 0,
      variacao_pct: rep.variacao_pct === null ? null : (rep.variacao_pct || 0),
      semHistorico6m: rep.semHistorico6m || false,
      usaTendencia: rep.usaTendencia || false,
      representatividade: rep.representatividade || 0,
      projecoes: {
        jan: proj[1] || 0,
        fev: proj[2] || 0,
        mar: proj[3] || 0,
        abr: proj[4] || 0,
        mai: proj[5] || 0,
        jun: proj[6] || 0,
      },
      totalProjecao: MESES_SEMESTRE.reduce((acc, m) => acc + (proj[m] || 0), 0),
    };
  });

  const itensSemVenda = skusSemVenda.map((sku) => ({
    idproduto: String(sku.idproduto),
    referencia: sku.referencia || '',
    produto: sku.produto || '',
    cor: sku.cor || '',
    tamanho: sku.tamanho || '',
    continuidade: sku.continuidade || '',
    linha: sku.linha || '',
  }));

  // 8. Calcula resumo
  const resumo = {
    totalSkus: itens.length,
    skusPermanente: itens.filter((i) => i.continuidade === 'PERMANENTE').length,
    skusPermanenteCorNova: itens.filter((i) => i.continuidade === 'PERMANENTE COR NOVA').length,
    skusComTendencia: itens.filter((i) => i.usaTendencia).length,
    skusComMedia: itens.filter((i) => !i.usaTendencia).length,
    totalProjecao: itens.reduce((acc, i) => acc + i.totalProjecao, 0),
    totalPorMes: {
      jan: itens.reduce((acc, i) => acc + i.projecoes.jan, 0),
      fev: itens.reduce((acc, i) => acc + i.projecoes.fev, 0),
      mar: itens.reduce((acc, i) => acc + i.projecoes.mar, 0),
      abr: itens.reduce((acc, i) => acc + i.projecoes.abr, 0),
      mai: itens.reduce((acc, i) => acc + i.projecoes.mai, 0),
      jun: itens.reduce((acc, i) => acc + i.projecoes.jun, 0),
    },
  };

  return {
    success: true,
    anoBase,
    anoDestino,
    vendas,
    totalizadores,
    resumo,
    itens,
    itensSemVenda,
  };
}

module.exports = {
  buscarVendasPorCanal,
  calcularTotalizadores,
  buscarSkusPermanentes,
  calcularMediasVendas,
  calcularRepresentatividade,
  gerarProjecoes,
  gerarPreviewProjecoes,
  AJUSTES_FABRICA,
  MESES_SEMESTRE,
};
