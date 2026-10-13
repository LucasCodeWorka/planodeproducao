/**
 * Serviço para geração de projeções automáticas para itens PERMANENTE e PERMANENTE COR NOVA
 * Regras:
 * 1. Totalizadores = Vendas Fábrica × ajuste + Vendas Lojas (ajuste: 10% em todos os meses)
 * 2. Representatividade por SKU baseada em média 6m vs 3m (usa tendência se variação > 50%)
 * 3. Projeção = Totalizador × Representatividade
 */

const { readCache, readCacheByKey, writeCacheByKey } = require('../cache/matrizCache');
const { isExcludedPlanningItem, normalizePlanningText } = require('./planningExclusions');
const {
  carregarPares,
  referenciasParaBuscar,
  selecionarOrigens,
  selecionarDestinos,
  escolherDestinosParaOrigem,
} = require('./deParaReferencias');

// Regra anual: fabrica do mesmo mes do ano anterior +10%; lojas sem acrescimo.
const AJUSTES_FABRICA = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 1.10]));

const MESES_SEMESTRE = Array.from({ length: 12 }, (_, i) => i + 1); // jan a dez

// Prefixo da chave de cache do catalogo de permanentes vindo do banco.
const CACHE_SKUS_BANCO = 'skus_permanentes_banco';
const CACHE_PRODUTOS_DE_PARA = 'produtos_de_para_referencias';

function criarMediaZerada() {
  return {
    media_6m: 0,
    total_6m: 0,
    media_3m: 0,
    total_3m: 0,
  };
}

function clonarMedia(media) {
  return {
    media_6m: Number(media?.media_6m) || 0,
    total_6m: Number(media?.total_6m) || 0,
    media_3m: Number(media?.media_3m) || 0,
    total_3m: Number(media?.total_3m) || 0,
  };
}

function mesAnoReferencia(ano, mes) {
  return `${Number(ano)}-${String(mes).padStart(2, '0')}`;
}

function parAtivoNoSemestre(par, anoDestino) {
  if (!par?.vigenciaInicio) return true;
  const ultimoMesSemestre = mesAnoReferencia(anoDestino, Math.max(...MESES_SEMESTRE));
  return par.vigenciaInicio <= ultimoMesSemestre;
}

function agruparPorReferencia(produtos) {
  const porReferencia = new Map();
  for (const produto of produtos || []) {
    const ref = String(produto?.referencia || '').trim();
    const id = String(produto?.idproduto || '').trim();
    if (!ref || !id) continue;
    if (!porReferencia.has(ref)) porReferencia.set(ref, new Map());
    porReferencia.get(ref).set(id, produto);
  }

  return new Map(
    [...porReferencia.entries()].map(([ref, produtosPorId]) => [ref, [...produtosPorId.values()]])
  );
}

/**
 * Busca vendas reais por canal a partir da mv_vendas_qtd.
 * Fábrica = empresa 1; Lojas = demais empresas.
 * @param {Object} pool - Pool de conexão PostgreSQL
 * @param {number} ano - Ano base
 * @returns {Promise<Object>} { fabrica: { 1: qtd, 2: qtd, ... }, lojas: { 1: qtd, 2: qtd, ... } }
 */
let refreshMvUltimoDia = null;
let refreshMvEmAndamento = null;

function solicitarRefreshMvDiario(pool) {
  const hoje = new Date().toISOString().slice(0, 10);
  if (refreshMvEmAndamento || refreshMvUltimoDia === hoje) return;
  refreshMvEmAndamento = pool.query('REFRESH MATERIALIZED VIEW public.mv_vendas_qtd')
    .then(() => { refreshMvUltimoDia = hoje; console.log(`[projecao-permanentes] mv_vendas_qtd atualizada em ${hoje}`); })
    .catch((error) => { console.warn(`[projecao-permanentes] refresh diário da mv_vendas_qtd falhou: ${error.message}`); })
    .finally(() => { refreshMvEmAndamento = null; });
}

async function buscarVendasPorCanal(pool, ano, idsPermitidos = null) {
  const vendas = {
    fabrica: Object.fromEntries(MESES_SEMESTRE.map((mes) => [mes, 0])),
    lojas: Object.fromEntries(MESES_SEMESTRE.map((mes) => [mes, 0])),
  };
  // Sem filtro: ids de app_projecoes do ano inteiro, a empresa toda — alimenta o REAL da
  // tela (cards, coluna REAL), que precisa contar venda de todo mundo, mesmo quem saiu de
  // linha depois. Com filtro: so os ids passados — restringe o TOTAL que o modelo
  // distribui a mesma populacao que recebe a projecao, senao quem continua em linha
  // herda venda de quem ja saiu.
  let ids;
  if (idsPermitidos) {
    ids = idsPermitidos.map(Number).filter(Number.isFinite);
  } else {
    const idsResult = await pool.query(`
      SELECT DISTINCT idproduto::BIGINT AS idproduto
      FROM public.app_projecoes
      WHERE ano = $1
    `, [ano]);
    ids = idsResult.rows.map((row) => Number(row.idproduto)).filter(Number.isFinite);
  }
  if (ids.length === 0) return vendas;
  const result = await pool.query(`
    SELECT EXTRACT(MONTH FROM v.data)::INT AS mes,
           SUM(CASE WHEN v.idempresa = 1 THEN v.qt_liquida ELSE 0 END)::FLOAT AS fabrica,
           SUM(CASE WHEN v.idempresa <> 1 THEN v.qt_liquida ELSE 0 END)::FLOAT AS lojas
    FROM public.mv_vendas_qtd v
    WHERE v.idproduto = ANY($1::BIGINT[])
      AND v.data >= $2::DATE AND v.data < $3::DATE
    GROUP BY 1 ORDER BY 1
  `, [ids, `${ano}-01-01`, `${ano + 1}-01-01`]);
  for (const row of result.rows) {
    const mes = Number(row.mes);
    if (!MESES_SEMESTRE.includes(mes)) continue;
    vendas.fabrica[mes] = Math.round(Number(row.fabrica) || 0);
    vendas.lojas[mes] = Math.round(Number(row.lojas) || 0);
  }
  return vendas;
}

/**
 * Venda historica dos permanentes, filtrada por quem ERA permanente + em linha NO MES DA
 * VENDA — nao por quem esta em linha hoje.
 *
 * Por que isto existe: status e uma foto do PRESENTE (f_dic_prd_classificacao, direto na
 * vr_prd_prdgrade). Usar essa foto para filtrar a venda de um mes passado deixa de fora
 * todo SKU que vendeu naquele mes e ja saiu de linha depois — e em 2026 isso nao e
 * excecao, e a regra: medido em 13/10/2026, cada um dos nove meses fechados tinha entre
 * 5% (setembro) e 14% (fevereiro) da venda vindo de SKUs que sumiram da foto de hoje.
 * Fevereiro e marco, nao as datas de presente, sao os piores — giro de colecao normal.
 *
 * A correcao e a mesma usada para edicao limitada: hist_dproduto, uma dimensao SCD-2
 * (dt_inicio/dt_fim/atual) que sabe o status de cada SKU em qualquer data, nao so hoje.
 *
 * Duas decisoes de implementacao:
 *
 * 1) GRAO MENSAL, nao por venda individual. A primeira tentativa juntava mv_vendas_qtd
 *    (venda a venda) direto com hist_dproduto por intervalo de data e estourou timeout de
 *    5 minutos. Pre-agregar por SKU/mes ANTES de classificar cai de milhoes de linhas para
 *    poucos milhares, e so entao usa o indice (cd_produto, dt_inicio) do hist — a mesma
 *    granularidade que o resto do sistema usa (app_projecoes tambem e por mes).
 *    Efeito colateral aceito: um SKU que mudou de status NO MEIO do mes conta o mes
 *    inteiro de um lado so (o do intervalo que mais se sobrepoe a primeira/ultima venda).
 *
 * 2) O populacao que RECEBE a projecao de 2027 (representatividade) continua sendo quem
 *    esta em linha HOJE — isso esta certo e nao muda aqui: e para eles que estamos
 *    planejando producao. So o TOTAL historico que vira a base do modelo passa a ser
 *    point-in-time.
 */
async function buscarVendasHistoricasPermanentes(pool, ano, marca = 'LIEBE') {
  const vendas = {
    fabrica: Object.fromEntries(MESES_SEMESTRE.map((mes) => [mes, 0])),
    lojas: Object.fromEntries(MESES_SEMESTRE.map((mes) => [mes, 0])),
  };
  const result = await pool.query(`
    WITH vendas_mes AS (
      SELECT v.idproduto, EXTRACT(MONTH FROM v.data)::INT AS mes,
             MIN(v.data) AS primeira_venda, MAX(v.data) AS ultima_venda,
             SUM(CASE WHEN v.idempresa = 1 THEN v.qt_liquida ELSE 0 END)::FLOAT AS fabrica,
             SUM(CASE WHEN v.idempresa <> 1 THEN v.qt_liquida ELSE 0 END)::FLOAT AS lojas
        FROM public.mv_vendas_qtd v
       WHERE v.data >= $1::DATE AND v.data < $2::DATE
       GROUP BY 1, 2
    ),
    classificado AS (
      SELECT vm.mes, vm.fabrica, vm.lojas,
             EXISTS (
               SELECT 1 FROM public.hist_dproduto h
                WHERE h.cd_produto = vm.idproduto
                  AND UPPER(TRIM(COALESCE(h.marca, ''))) = $3
                  AND UPPER(TRIM(COALESCE(h.continuidade, ''))) IN ('PERMANENTE', 'PERMANENTE COR NOVA')
                  AND UPPER(TRIM(COALESCE(h.status, ''))) IN ('EM LINHA', 'NOVA COLECAO', 'EM LINHA NAO COMPRAR MP')
                  AND h.dt_inicio <= vm.ultima_venda
                  AND (h.dt_fim IS NULL OR h.dt_fim >= vm.primeira_venda)
             ) AS em_linha_na_epoca
        FROM vendas_mes vm
    )
    SELECT mes,
           SUM(fabrica) FILTER (WHERE em_linha_na_epoca)::FLOAT AS fabrica,
           SUM(lojas) FILTER (WHERE em_linha_na_epoca)::FLOAT AS lojas
      FROM classificado
     GROUP BY mes ORDER BY mes
  `, [`${ano}-01-01`, `${ano + 1}-01-01`, marca.toUpperCase()]);
  for (const row of result.rows) {
    const mes = Number(row.mes);
    if (!MESES_SEMESTRE.includes(mes)) continue;
    vendas.fabrica[mes] = Math.round(Number(row.fabrica) || 0);
    vendas.lojas[mes] = Math.round(Number(row.lojas) || 0);
  }
  return vendas;
}

// A abertura por canal da Visao Geral precisa usar exatamente os SKUs do preview.
// O totalizador geral acima usa todos os IDs de app_projecoes e nao serve para
// repartir uma projecao que mostra apenas os permanentes em linha.
async function buscarVendasDosItensPorAno(pool, ids, anoBase) {
  const porAno = {};
  if (!ids.length) return porAno;
  const result = await pool.query(`
    SELECT EXTRACT(YEAR FROM v.data)::INT AS ano,
           EXTRACT(MONTH FROM v.data)::INT AS mes,
           SUM(CASE WHEN v.idempresa = 1 THEN v.qt_liquida ELSE 0 END)::FLOAT AS fabrica,
           SUM(CASE WHEN v.idempresa <> 1 THEN v.qt_liquida ELSE 0 END)::FLOAT AS lojas
    FROM public.mv_vendas_qtd v
    WHERE v.idproduto = ANY($1::BIGINT[])
      AND v.data >= $2::DATE AND v.data < $3::DATE
    GROUP BY 1, 2
  `, [ids.map(Number), `${anoBase - 1}-10-01`, `${anoBase + 1}-01-01`]);
  for (const row of result.rows) {
    const ano = String(row.ano);
    porAno[ano] ||= { fabrica: {}, lojas: {} };
    porAno[ano].fabrica[row.mes] = Math.round(Number(row.fabrica) || 0);
    porAno[ano].lojas[row.mes] = Math.round(Number(row.lojas) || 0);
  }
  return porAno;
}

/**
 * Meses ainda nao fechados do ano base (o corrente e os futuros) nao tem venda real
 * completa; usar so o realizado faria a projecao do mesmo mes do ano seguinte nascer
 * subestimada (ex.: set-dez/2027 a partir de um 2026 que ainda nao aconteceu).
 * Nesses meses a base passa a ser a projecao gravada do ano, dividida entre fabrica e
 * lojas pela participacao dos meses ja fechados. Se o realizado ja superou a projecao,
 * vale o realizado. Devolve uma copia; o realizado original nao e alterado.
 */
async function completarMesesAbertosComProjecao(pool, ano, vendasReais, idsPermitidos = null) {
  const vendas = { fabrica: { ...vendasReais.fabrica }, lojas: { ...vendasReais.lojas } };
  const hoje = new Date();
  if (hoje.getFullYear() !== Number(ano)) return vendas;
  const mesAtual = hoje.getMonth() + 1;
  const fechados = MESES_SEMESTRE.filter((mes) => mes < mesAtual);
  const totalFabrica = fechados.reduce((acc, mes) => acc + (Number(vendas.fabrica[mes]) || 0), 0);
  const totalLojas = fechados.reduce((acc, mes) => acc + (Number(vendas.lojas[mes]) || 0), 0);
  const participacaoFabrica = totalFabrica + totalLojas > 0 ? totalFabrica / (totalFabrica + totalLojas) : 0;
  // Mesmo filtro de populacao do total restrito: sem ele, o mes aberto reintroduziria a
  // projecao gravada de quem ja saiu de linha, do mesmo jeito que o total fechado fazia.
  const idsFiltro = idsPermitidos ? idsPermitidos.map(Number).filter(Number.isFinite) : null;
  const filtroIds = idsFiltro && idsFiltro.length ? "AND idproduto::BIGINT = ANY($3::BIGINT[])" : "";
  const params = idsFiltro && idsFiltro.length ? [ano, mesAtual, idsFiltro] : [ano, mesAtual];
  const result = await pool.query(`
    SELECT mes::INT AS mes, SUM(quantidade)::FLOAT AS total
    FROM public.app_projecoes
    WHERE ano = $1 AND mes >= $2
    ${filtroIds}
    GROUP BY 1
  `, params);
  for (const row of result.rows) {
    const mes = Number(row.mes);
    if (!MESES_SEMESTRE.includes(mes)) continue;
    const projetado = Math.round(Number(row.total) || 0);
    const realizado = (Number(vendas.fabrica[mes]) || 0) + (Number(vendas.lojas[mes]) || 0);
    if (projetado <= realizado) continue;
    const fabrica = Math.round(projetado * participacaoFabrica);
    vendas.fabrica[mes] = fabrica;
    vendas.lojas[mes] = projetado - fabrica;
  }
  return vendas;
}
/**
 * Calcula os totalizadores por mês aplicando os ajustes
 * @param {Object} vendas - { fabrica: {...}, lojas: {...} }
 * @returns {Object} { 1: { fabrica, lojas, ajuste, total }, 2: {...}, ... }
 */
function calcularTotalizadores(vendas, crescimentoFabrica = null) {
  const totalizadores = {};
  // Cenario de crescimento: null usa o padrao histórico (AJUSTES_FABRICA, 10% ao ano);
  // um numero (0, 0.05, 0.10...) sobrescreve TODOS os meses com a mesma taxa, para
  // simular "e se a fabrica crescesse X% em vez de 10%".
  for (const mes of MESES_SEMESTRE) {
    const fabricaBase = Number(vendas.fabrica[mes]) || 0;
    const lojasBase = Number(vendas.lojas[mes]) || 0;
    const ajuste = crescimentoFabrica !== null ? (1 + crescimentoFabrica) : (AJUSTES_FABRICA[mes] || 1.10);
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
    ? [`${ano}-01-01`, `${ano + 1}-01-01`]
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

async function buscarProdutosPorReferencias(pool, referencias) {
  const refs = [...new Set((referencias || []).map((ref) => String(ref || '').trim()).filter(Boolean))].sort();
  if (refs.length === 0) return [];

  const chaveCache = `${CACHE_PRODUTOS_DE_PARA}_${refs.join('_')}`;
  try {
    const cache = await readCacheByKey(chaveCache);
    if (cache?.fresh && Array.isArray(cache.data)) {
      return cache.data;
    }
  } catch (error) {
    console.warn(`[projecao-permanentes] cache de produtos do de-para indisponivel: ${error.message}`);
  }

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
    ) p
    WHERE TRIM(COALESCE(p.referencia::TEXT, '')) = ANY($1::TEXT[])
      AND UPPER(TRIM(COALESCE(p.marca, ''))) = 'LIEBE'
    ORDER BY p.referencia, p.idproduto
  `, [refs]);

  const produtos = result.rows
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
      apresentacao: String(row.apresentacao || '').trim(),
      continuidade: String(row.continuidade || 'SEM CONTINUIDADE').trim().toUpperCase(),
      status: String(row.status || 'INDEFINIDO').trim().toUpperCase(),
      linha: String(row.linha || '').trim(),
      media_6m: 0,
      media_3m: 0,
    }));

  try {
    await writeCacheByKey(chaveCache, produtos, { referencias: refs, geradoPor: 'projecaoPermanentesService' });
  } catch (error) {
    console.warn(`[projecao-permanentes] nao consegui gravar o cache de produtos do de-para: ${error.message}`);
  }

  return produtos;
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

async function montarContextoDeParaPermanentes(pool, skus, anoDestino) {
  const pares = carregarPares().filter((par) => parAtivoNoSemestre(par, anoDestino));

  if (pares.length === 0) {
    return {
      skus,
      fontesPorDestino: new Map(),
      origensRemovidas: new Set(),
      idsHistorico: skus.map((sku) => String(sku.idproduto)),
      deParaAplicado: [],
    };
  }

  const produtosDePara = await buscarProdutosPorReferencias(pool, referenciasParaBuscar(pares));
  const produtosPorId = new Map();

  for (const sku of [...skus, ...produtosDePara]) {
    const id = String(sku?.idproduto || '').trim();
    if (id) produtosPorId.set(id, sku);
  }

  const porReferencia = agruparPorReferencia([...produtosPorId.values()]);
  const skusPorId = new Map(skus.map((sku) => [String(sku.idproduto), sku]));
  const fontesPorDestino = new Map();
  const origensRemovidas = new Set();
  const idsHistorico = new Set(skus.map((sku) => String(sku.idproduto)));
  const deParaAplicado = [];

  for (const par of pares) {
    const origens = selecionarOrigens(porReferencia.get(par.refAntiga) || [], par);
    const destinos = selecionarDestinos(porReferencia.get(par.refNova) || [], par);
    let transferencias = 0;
    let origensSemDestino = 0;

    for (const origem of origens) {
      const idOrigem = String(origem?.idproduto || '').trim();
      if (!idOrigem) continue;
      if (destinos.length > 0) origensRemovidas.add(idOrigem);

      const escolhas = escolherDestinosParaOrigem(destinos, origem, par)
        .filter(({ destino }) => String(destino?.idproduto || '').trim() !== idOrigem);

      if (escolhas.length === 0) {
        origensSemDestino += 1;
        continue;
      }

      idsHistorico.add(idOrigem);
      transferencias += escolhas.length;

      for (const { destino, peso } of escolhas) {
        const idDestino = String(destino?.idproduto || '').trim();
        if (!idDestino) continue;

        idsHistorico.add(idDestino);
        if (!skusPorId.has(idDestino)) skusPorId.set(idDestino, destino);
        if (!fontesPorDestino.has(idDestino)) fontesPorDestino.set(idDestino, []);

        fontesPorDestino.get(idDestino).push({
          idOrigem,
          peso: Number(peso) || 0,
          referenciaOrigem: par.refAntiga,
          referenciaDestino: par.refNova,
          grupo: par.grupo,
          modo: par.modo,
        });
      }
    }

    if (transferencias > 0 || origensSemDestino > 0) {
      deParaAplicado.push({
        ref_antiga: par.refAntiga,
        ref_nova: par.refNova,
        grupo: par.grupo || null,
        vigencia_inicio: par.vigenciaInicio || null,
        origens: origens.length,
        destinos: destinos.length,
        transferencias,
        origens_sem_destino: origensSemDestino,
      });
    }
  }

  return {
    skus: [...skusPorId.values()],
    fontesPorDestino,
    origensRemovidas,
    idsHistorico: [...idsHistorico],
    deParaAplicado,
  };
}

function aplicarDeParaNasMedias(mediasBrutas, fontesPorDestino) {
  const medias = {};

  for (const [id, media] of Object.entries(mediasBrutas || {})) {
    medias[String(id)] = clonarMedia(media);
  }

  for (const [idDestino, fontes] of fontesPorDestino.entries()) {
    const destino = medias[idDestino] || criarMediaZerada();

    for (const fonte of fontes || []) {
      const origem = mediasBrutas[String(fonte.idOrigem)] || criarMediaZerada();
      const peso = Number(fonte.peso) || 0;
      destino.total_6m += (Number(origem.total_6m) || 0) * peso;
      destino.total_3m += (Number(origem.total_3m) || 0) * peso;
    }

    destino.media_6m = destino.total_6m / 6;
    destino.media_3m = destino.total_3m / 3;
    medias[idDestino] = destino;
  }

  return medias;
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
async function gerarPreviewProjecoes(pool, anoBase, anoDestino, opcoes = {}) {
  // 1. Busca SKUs permanentes ativos hoje. Vem ANTES das vendas de proposito: a mesma
  //    populacao que recebe a projecao (representatividades, abaixo) precisa ser a que
  //    fornece o TOTAL a distribuir, senao o sobrevivente herda venda de quem ja saiu de
  //    linha sem limite.
  let skus = await buscarSkusPermanentes(pool, anoBase);

  const crescimentoFabrica = opcoes.crescimentoFabrica === undefined || opcoes.crescimentoFabrica === null
    ? null
    : Number(opcoes.crescimentoFabrica);

  if (skus.length === 0) {
    const totalizadoresVazio = calcularTotalizadores({ fabrica: {}, lojas: {} }, crescimentoFabrica);
    return {
      success: true,
      anoBase,
      anoDestino,
      totalizadores: totalizadoresVazio,
      vendasItensPorAno: {},
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
      deParaAplicado: [],
    };
  }

  const contextoDePara = await montarContextoDeParaPermanentes(pool, skus, anoDestino);
  skus = contextoDePara.skus;
  const idsModelo = [...contextoDePara.idsHistorico].map(Number).filter(Number.isFinite);

  // 2. Vendas REAIS da empresa inteira (alimentam os cards e a coluna REAL da tela — tem
  //    de contar quem vendeu naquele mes, mesmo quem saiu de linha depois) e vendas
  //    HISTORICAS para o MODELO, filtradas por quem ERA permanente + em linha no MES DA
  //    VENDA (hist_dproduto), nao por quem esta em linha hoje. Medido: filtrar pela foto
  //    de hoje deixava de fora 5% a 14% da venda de cada mes fechado de 2026 — todo SKU
  //    que vendeu e ja saiu de linha depois. Ver buscarVendasHistoricasPermanentes.
  const vendas = await buscarVendasPorCanal(pool, anoBase);
  const vendasModelo = await buscarVendasHistoricasPermanentes(pool, anoBase);

  // 3. Totalizadores: o real para exibicao, o restrito para o modelo.
  const totalizadores = calcularTotalizadores(vendas, crescimentoFabrica);
  const totalizadoresBase = opcoes.completarMesesAbertos
    ? calcularTotalizadores(await completarMesesAbertosComProjecao(pool, anoBase, vendasModelo, idsModelo), crescimentoFabrica)
    : calcularTotalizadores(vendasModelo, crescimentoFabrica);

  // 4. Calcula médias usando venda real do semestre base
  const mediasBrutas = await calcularMediasVendas(pool, contextoDePara.idsHistorico, anoBase);
  const mediasComDePara = aplicarDeParaNasMedias(mediasBrutas, contextoDePara.fontesPorDestino);
  const skusSemVenda = skus.filter((sku) => {
    const id = String(sku.idproduto);
    if (contextoDePara.origensRemovidas.has(id)) return false;
    const media = mediasComDePara[id] || {};
    return (Number(media.total_6m) || 0) <= 0 && (Number(media.total_3m) || 0) <= 0;
  });
  const skusProjetaveis = skus.filter((sku) => {
    const id = String(sku.idproduto);
    if (contextoDePara.origensRemovidas.has(id)) return false;
    const media = mediasComDePara[id] || {};
    const camposPt = [sku.tamanho, sku.referencia, sku.produto, sku.apresentacao]
      .map((valor) => normalizePlanningText(valor));
    const temVenda = (Number(media.total_6m) || 0) > 0 || (Number(media.total_3m) || 0) > 0;
    const ehItemPt = camposPt.some((valor) => /^PT(?:\s|$)/.test(valor));
    return temVenda && !ehItemPt;
  });
  const medias = Object.fromEntries(
    skusProjetaveis.map((sku) => [String(sku.idproduto), mediasComDePara[String(sku.idproduto)]])
  );

  // 5. Calcula representatividades
  // Os SKUs atuais absorvem a participacao dos produtos que sairam de linha.
  // Por isso, a representatividade 6m/3m e normalizada dentro da tabela atual.
  const representatividades = calcularRepresentatividade(medias);

  // 6. Gera projeções
  const projecoes = gerarProjecoes(totalizadoresBase, representatividades);

  // 7. Monta resultado final
  const itens = skusProjetaveis.map((sku) => {
    const id = String(sku.idproduto);
    const rep = representatividades[id] || {};
    const proj = projecoes[id] || {};
    const fontesDePara = contextoDePara.fontesPorDestino.get(id) || [];

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
      projecoes: Object.fromEntries(MESES_SEMESTRE.map((mes) => [
        ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][mes - 1],
        proj[mes] || 0,
      ])),
      totalProjecao: MESES_SEMESTRE.reduce((acc, m) => acc + (proj[m] || 0), 0),
      deParaOrigem: fontesDePara.length > 0
        ? [...new Set(fontesDePara.map((fonte) => fonte.referenciaOrigem).filter(Boolean))].join(', ')
        : null,
    };
  });

  const vendasItensPorAno = await buscarVendasDosItensPorAno(
    pool, itens.map((item) => item.idproduto), anoBase
  );

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
    skusComDePara: itens.filter((i) => i.deParaOrigem).length,
    totalProjecao: itens.reduce((acc, i) => acc + i.totalProjecao, 0),
    totalPorMes: Object.fromEntries(MESES_SEMESTRE.map((mes) => [
      ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][mes - 1],
      itens.reduce((acc, i) => acc + Number(i.projecoes[['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][mes - 1]] || 0), 0),
    ])),
  };

  return {
    success: true,
    anoBase,
    anoDestino,
    vendas,
    totalizadores,
    totalizadoresBase,
    vendasItensPorAno,
    resumo,
    itens,
    itensSemVenda,
    deParaAplicado: contextoDePara.deParaAplicado,
  };
}

module.exports = {
  buscarVendasPorCanal,
  buscarVendasHistoricasPermanentes,
  solicitarRefreshMvDiario,
  calcularTotalizadores,
  buscarSkusPermanentes,
  calcularMediasVendas,
  calcularRepresentatividade,
  gerarProjecoes,
  gerarPreviewProjecoes,
  AJUSTES_FABRICA,
  MESES_SEMESTRE,
};
