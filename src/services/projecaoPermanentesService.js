/**
 * Serviço para geração de projeções automáticas para itens PERMANENTE e PERMANENTE COR NOVA
 * Regras:
 * 1. Totalizadores = Vendas Fábrica × ajuste + Vendas Lojas (ajuste: 10% normal, 20% abril/maio)
 * 2. Representatividade por SKU baseada em média 6m vs 3m (usa tendência se variação > 50%)
 * 3. Projeção = Totalizador × Representatividade
 */

const { readCache } = require('../cache/matrizCache');

// Ajustes de fábrica por mês (1 = janeiro, ..., 6 = junho)
const AJUSTES_FABRICA = {
  1: 1.10,  // Janeiro: +10%
  2: 1.10,  // Fevereiro: +10%
  3: 1.10,  // Março: +10%
  4: 1.20,  // Abril: +20%
  5: 1.20,  // Maio: +20%
  6: 1.10,  // Junho: +10%
};

const MESES_SEMESTRE = [1, 2, 3, 4, 5, 6]; // jan a jun

/**
 * Busca vendas por canal estimadas a partir do cache de planejamento
 * SUPER RÁPIDO: usa dados já carregados em memória
 * Multiplica média por 6 meses e distribui proporcionalmente
 * @param {Object} pool - Pool de conexão PostgreSQL (não usado)
 * @param {number} ano - Ano base (não usado, apenas para compatibilidade)
 * @returns {Promise<Object>} { fabrica: { 1: qtd, 2: qtd, ... }, lojas: { 1: qtd, 2: qtd, ... } }
 */
async function buscarVendasPorCanal(pool, ano) {
  console.log(`[projecao-permanentes] Estimando vendas por canal do cache...`);
  const t0 = Date.now();

  // Usa o cache matriz_planejamento que já está em memória
  const cached = await readCache();

  const vendas = {
    fabrica: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    lojas: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
  };

  if (!cached || !cached.data) {
    console.log(`[projecao-permanentes] Cache não disponível, retornando zeros`);
    return vendas;
  }

  const cacheData = cached.data.rows || cached.data;

  if (!Array.isArray(cacheData)) {
    console.log(`[projecao-permanentes] Cache inválido, retornando zeros`);
    return vendas;
  }

  // Filtra apenas produtos LIEBE e EM LINHA (os que entram no planejamento)
  const produtosFiltrados = cacheData.filter(item => {
    const produto = item?.produto || {};
    const marca = String(produto.marca || '').trim().toUpperCase();
    const status = String(produto.status || '').trim().toUpperCase();
    return marca === 'LIEBE' && status === 'EM LINHA';
  });

  // Soma total de vendas (média mensal × 6)
  // Usamos média_6m que já está calculada no cache
  let totalVendas6m = 0;
  for (const item of produtosFiltrados) {
    const demanda = item?.demanda || {};
    const media6m = Number(demanda.media_vendas_6m) || 0;
    totalVendas6m += media6m * 6; // média mensal × 6 meses = total semestre
  }

  // Distribui as vendas entre os meses (proporcionalmente - jan a jun)
  // Distribuição média por mês: 100% / 6 = ~16.67% cada
  // Usamos distribuição uniforme já que não temos dados por canal no cache
  // Estimamos 70% fábrica, 30% lojas (baseado em proporção típica)
  const pctFabrica = 0.70;
  const pctLojas = 0.30;
  const distribuicaoMeses = [0.15, 0.16, 0.17, 0.18, 0.17, 0.17]; // jan-jun (soma = 1.0)

  for (let mes = 1; mes <= 6; mes++) {
    const pctMes = distribuicaoMeses[mes - 1];
    const vendasMes = totalVendas6m * pctMes;
    vendas.fabrica[mes] = Math.round(vendasMes * pctFabrica);
    vendas.lojas[mes] = Math.round(vendasMes * pctLojas);
  }

  console.log(`[projecao-permanentes] Vendas estimadas: ${totalVendas6m.toFixed(0)} total em ${((Date.now()-t0)/1000).toFixed(3)}s`);

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
 * Busca SKUs com continuidade PERMANENTE ou PERMANENTE COR NOVA
 * OTIMIZADO: usa o cache matriz_planejamento já existente em memória
 * Isso é INSTANTÂNEO pois apenas filtra dados já carregados
 * @param {Object} pool - Pool de conexão PostgreSQL (não usado, mantido para compatibilidade)
 * @returns {Promise<Array>} Lista de SKUs com dados cadastrais
 */
async function buscarSkusPermanentes(pool) {
  console.log('[projecao-permanentes] Buscando SKUs permanentes do cache...');
  const t0 = Date.now();

  // Usa o cache matriz_planejamento que já está em memória
  const cached = await readCache();

  if (!cached || !cached.data) {
    console.log('[projecao-permanentes] Cache não disponível, retornando lista vazia');
    return [];
  }

  const cacheData = cached.data.rows || cached.data;

  if (!Array.isArray(cacheData)) {
    console.log('[projecao-permanentes] Cache inválido (não é array), retornando lista vazia');
    return [];
  }

  // Filtra em memória: PERMANENTE ou PERMANENTE COR NOVA, LIEBE, EM LINHA ou NOVA COLECAO
  // (mesmo critério de "elegível para planejamento" usado no restante do sistema)
  const skusFiltrados = cacheData.filter(item => {
    const produto = item?.produto || {};
    const continuidade = String(produto.continuidade || '').trim().toUpperCase();
    const marca = String(produto.marca || '').trim().toUpperCase();
    const status = String(produto.status || '').trim().toUpperCase();

    return (
      (continuidade === 'PERMANENTE' || continuidade === 'PERMANENTE COR NOVA') &&
      marca === 'LIEBE' &&
      (status === 'EM LINHA' || status === 'NOVA COLECAO')
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
      // Inclui dados de demanda do cache
      media_6m: Number(demanda.media_vendas_6m) || 0,
      media_3m: Number(demanda.media_vendas_3m) || 0,
    };
  });
}

/**
 * Calcula médias de vendas a partir dos dados já presentes nos SKUs (do cache)
 * OTIMIZADO: Não faz query no banco, usa dados do cache
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
 * Versão legada que consulta o banco (mantida para compatibilidade)
 * @deprecated Use calcularMediasVendasDoCache
 */
async function calcularMediasVendas(pool, idprodutos, anoBase) {
  if (!idprodutos || idprodutos.length === 0) {
    return {};
  }

  // Query para média 6 meses (jan-jun do ano base)
  const query6m = `
    SELECT
      v.idproduto::TEXT AS idproduto,
      COALESCE(AVG(v.qt_liquida), 0) AS media_6m,
      COALESCE(SUM(v.qt_liquida), 0) AS total_6m
    FROM vr_vendas_qtd v
    WHERE v.idproduto = ANY($1::BIGINT[])
      AND EXTRACT(YEAR FROM v.data) = $2
      AND EXTRACT(MONTH FROM v.data) BETWEEN 1 AND 6
    GROUP BY v.idproduto
  `;

  // Query para média últimos 3 meses
  const query3m = `
    SELECT
      v.idproduto::TEXT AS idproduto,
      COALESCE(AVG(v.qt_liquida), 0) AS media_3m,
      COALESCE(SUM(v.qt_liquida), 0) AS total_3m
    FROM vr_vendas_qtd v
    WHERE v.idproduto = ANY($1::BIGINT[])
      AND v.data >= CURRENT_DATE - INTERVAL '3 months'
    GROUP BY v.idproduto
  `;

  const ids = idprodutos.map((id) => Number(id));

  const [result6m, result3m] = await Promise.all([
    pool.query(query6m, [ids, anoBase]),
    pool.query(query3m, [ids]),
  ]);

  // Mapear resultados
  const medias = {};

  // Inicializa todos com zero
  for (const id of idprodutos) {
    medias[String(id)] = {
      media_6m: 0,
      total_6m: 0,
      media_3m: 0,
      total_3m: 0,
    };
  }

  // Preenche com dados de 6 meses
  for (const row of result6m.rows) {
    const id = String(row.idproduto);
    if (medias[id]) {
      medias[id].media_6m = Number(row.media_6m) || 0;
      medias[id].total_6m = Number(row.total_6m) || 0;
    }
  }

  // Preenche com dados de 3 meses
  for (const row of result3m.rows) {
    const id = String(row.idproduto);
    if (medias[id]) {
      medias[id].media_3m = Number(row.media_3m) || 0;
      medias[id].total_3m = Number(row.total_3m) || 0;
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
function calcularRepresentatividade(medias) {
  // Primeiro calcula totais globais
  let totalGeral6m = 0;
  let totalGeral3m = 0;

  for (const id of Object.keys(medias)) {
    totalGeral6m += Number(medias[id].total_6m) || 0;
    totalGeral3m += Number(medias[id].total_3m) || 0;
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
  const skus = await buscarSkusPermanentes(pool);

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
    };
  }

  // 4. Calcula médias usando dados do cache (instantâneo)
  const medias = calcularMediasVendasDoCache(skus);

  // 5. Calcula representatividades
  const representatividades = calcularRepresentatividade(medias);

  // 6. Gera projeções
  const projecoes = gerarProjecoes(totalizadores, representatividades);

  // 7. Monta resultado final
  const itens = skus.map((sku) => {
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
