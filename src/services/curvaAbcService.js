/**
 * Serviço para cálculo da Curva ABCD por referência
 *
 * Estratégia: começar pelas VENDAS (poucos registros) e só buscar
 * classificações dos produtos que tiveram venda.
 */

function filtrarProduto(produto) {
  const marca = String(produto.marca || '').trim().toUpperCase();
  const status = String(produto.status || '').trim().toUpperCase();
  const codSituacao = String(produto.cod_situacao || '').trim();
  const continuidade = String(produto.continuidade || '').trim().toUpperCase();
  const nmProduto = String(produto.nm_produto || '').toUpperCase();
  const tamanho = String(produto.ds_tamanho || '').trim().toUpperCase();
  const referencia = String(produto.referencia || '').trim().toUpperCase();

  if (marca !== 'LIEBE') return false;
  if (status !== 'EM LINHA') return false;
  if (codSituacao === '007') return false;
  if (continuidade === 'EDICAO LIMITADA') return false;
  if (nmProduto.includes('MEIA DE SEDA')) return false;
  if (tamanho === 'PT 99') return false;
  if (!referencia) return false;
  if (referencia.startsWith('PT')) return false;

  return true;
}

function calcularCurva(totalQty, rankQty, totalRefs) {
  if (totalQty >= 2500) return 'A';
  if (rankQty > totalRefs - 20) return 'D';
  if (rankQty > totalRefs - 50) return 'C';
  return 'B';
}

async function calcularCurvaAbcReferencias(pool) {
  const t0 = Date.now();
  console.log('[curva-abc] Fase 1 — buscando vendas dos últimos 90 dias...');

  // Fase 1: buscar APENAS vendas (poucos registros) + IDs dos produtos que venderam
  const [rVendasQtd, rVendasValor] = await Promise.all([
    pool.query(`
      SELECT
        v.idproduto,
        f_dic_prd_nivel(v.idproduto, 'CD'::bpchar) AS referencia,
        SUM(v.qt_liquida) AS total_qty,
        COUNT(DISTINCT DATE(v.data)) AS dias_com_vendas
      FROM vr_vendas_qtd v
      WHERE v.data >= CURRENT_DATE - INTERVAL '90 days'
        AND v.idempresa = 1
        AND v.idproduto < 1000000
      GROUP BY v.idproduto, f_dic_prd_nivel(v.idproduto, 'CD'::bpchar)
    `),
    pool.query(`
      SELECT
        f_dic_prd_nivel(v.idproduto, 'CD'::bpchar) AS referencia,
        SUM(v.valor) AS total_valor
      FROM vr_vendas_valor v
      WHERE v.data >= CURRENT_DATE - INTERVAL '90 days'
        AND v.idempresa = 1
        AND v.idproduto < 1000000
      GROUP BY f_dic_prd_nivel(v.idproduto, 'CD'::bpchar)
    `)
  ]);

  // Pegar IDs únicos dos produtos que tiveram venda
  const idsSet = new Set(rVendasQtd.rows.map(r => Number(r.idproduto)));
  const ids = Array.from(idsSet);

  console.log(`[curva-abc] Fase 1 concluída em ${((Date.now() - t0) / 1000).toFixed(1)}s — ${ids.length} produtos com venda`);

  if (ids.length === 0) {
    return {
      success: true,
      totalReferencias: 0,
      resumo: { curvaA: 0, curvaB: 0, curvaC: 0, curvaD: 0 },
      porReferencia: {},
      detalhes: { curvaA: [], curvaB: [], curvaC: [], curvaD: [] }
    };
  }

  // Fase 2: buscar classificações APENAS dos produtos que venderam
  const t1 = Date.now();
  console.log(`[curva-abc] Fase 2 — ${ids.length} IDs, 5 consultas paralelas`);

  const [rProdutos, rMarca, rStatus, rSituacao, rContinuidade] = await Promise.all([
    pool.query(
      `SELECT cd_produto::BIGINT AS id, nm_produto, ds_tamanho
       FROM vr_prd_prdgrade WHERE cd_produto = ANY($1)`,
      [ids]
    ),
    pool.query(
      `SELECT cd_produto::BIGINT AS id, f_dic_prd_classificacao(cd_produto, 'DS'::text, 20::bigint) AS marca
       FROM vr_prd_prdgrade WHERE cd_produto = ANY($1)`,
      [ids]
    ),
    pool.query(
      `SELECT cd_produto::BIGINT AS id, f_dic_prd_classificacao(cd_produto, 'DS'::text, 27::bigint) AS status
       FROM vr_prd_prdgrade WHERE cd_produto = ANY($1)`,
      [ids]
    ),
    pool.query(
      `SELECT cd_produto::BIGINT AS id, f_dic_prd_classificacao(cd_produto, 'CD'::text, 124::bigint) AS cod_situacao
       FROM vr_prd_prdgrade WHERE cd_produto = ANY($1)`,
      [ids]
    ),
    pool.query(
      `SELECT cd_produto::BIGINT AS id, f_dic_prd_classificacao(cd_produto, 'DS'::text, 802::bigint) AS continuidade
       FROM vr_prd_prdgrade WHERE cd_produto = ANY($1)`,
      [ids]
    )
  ]);

  console.log(`[curva-abc] Fase 2 concluída em ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  // Criar maps
  const produtosMap = new Map(rProdutos.rows.map(r => [Number(r.id), r]));
  const marcaMap = new Map(rMarca.rows.map(r => [Number(r.id), r.marca]));
  const statusMap = new Map(rStatus.rows.map(r => [Number(r.id), r.status]));
  const situacaoMap = new Map(rSituacao.rows.map(r => [Number(r.id), r.cod_situacao]));
  const continuMap = new Map(rContinuidade.rows.map(r => [Number(r.id), r.continuidade]));

  // Mapear vendas por referência
  const vendasValorMap = new Map();
  for (const v of rVendasValor.rows) {
    const ref = String(v.referencia || '').trim().toUpperCase();
    if (ref) vendasValorMap.set(ref, Number(v.total_valor) || 0);
  }

  // Processar e filtrar
  console.log('[curva-abc] Processando filtros no JavaScript...');
  const t2 = Date.now();

  // Agrupar vendas por referência, filtrando produtos inválidos
  const refData = new Map(); // ref -> { totalQty, diasComVendas, qtdSkus }

  for (const v of rVendasQtd.rows) {
    const id = Number(v.idproduto);
    const ref = String(v.referencia || '').trim().toUpperCase();
    if (!ref) continue;

    const prod = produtosMap.get(id);
    const produto = {
      nm_produto: prod?.nm_produto || '',
      ds_tamanho: prod?.ds_tamanho || '',
      referencia: ref,
      marca: marcaMap.get(id),
      status: statusMap.get(id),
      cod_situacao: situacaoMap.get(id),
      continuidade: continuMap.get(id)
    };

    if (!filtrarProduto(produto)) continue;

    if (!refData.has(ref)) {
      refData.set(ref, { totalQty: 0, diasComVendas: 0, skus: new Set() });
    }

    const data = refData.get(ref);
    data.totalQty += Number(v.total_qty) || 0;
    data.diasComVendas = Math.max(data.diasComVendas, Number(v.dias_com_vendas) || 0);
    data.skus.add(id);
  }

  console.log(`[curva-abc] ${refData.size} referências válidas após filtros`);

  // Montar lista para ranking
  const combinado = [];
  for (const [ref, data] of refData) {
    combinado.push({
      referencia: ref,
      totalQty: data.totalQty,
      totalValor: vendasValorMap.get(ref) || 0,
      diasComVendas: data.diasComVendas,
      qtdSkus: data.skus.size
    });
  }

  // Ordenar e calcular curva
  combinado.sort((a, b) => b.totalQty - a.totalQty);
  const totalRefs = combinado.length;

  const curvaA = [];
  const curvaB = [];
  const curvaC = [];
  const curvaD = [];
  const porReferencia = {};

  for (let i = 0; i < combinado.length; i++) {
    const item = combinado[i];
    const rankQty = i + 1;
    const curva = calcularCurva(item.totalQty, rankQty, totalRefs);

    const resultado = {
      referencia: item.referencia,
      totalQtd: item.totalQty,
      totalValor: item.totalValor,
      diasComVendas: item.diasComVendas,
      qtdSkus: item.qtdSkus,
      mediaQtdPorSku: item.qtdSkus > 0 ? item.totalQty / item.qtdSkus : 0,
      rankQtd: rankQty,
      rankValor: 0,
      curva,
      top30Qtd: false,
      top30Valor: false
    };

    porReferencia[item.referencia] = curva;

    if (curva === 'A') curvaA.push(resultado);
    else if (curva === 'C') curvaC.push(resultado);
    else if (curva === 'D') curvaD.push(resultado);
    else curvaB.push(resultado);
  }

  // Rank por valor
  const ordenadoPorValor = [...combinado].sort((a, b) => b.totalValor - a.totalValor);
  const rankValorMap = new Map();
  ordenadoPorValor.forEach((item, idx) => rankValorMap.set(item.referencia, idx + 1));

  [curvaA, curvaB, curvaC, curvaD].forEach(lista => {
    lista.forEach(item => {
      item.rankValor = rankValorMap.get(item.referencia) || 0;
    });
  });

  console.log(`[curva-abc] Processamento JS concluído em ${Date.now() - t2}ms`);
  console.log(`[curva-abc] Total: ${((Date.now() - t0) / 1000).toFixed(1)}s — ${totalRefs} referências`);

  return {
    success: true,
    totalReferencias: totalRefs,
    resumo: {
      curvaA: curvaA.length,
      curvaB: curvaB.length,
      curvaC: curvaC.length,
      curvaD: curvaD.length
    },
    porReferencia,
    detalhes: {
      curvaA,
      curvaB,
      curvaC,
      curvaD
    }
  };
}

module.exports = {
  calcularCurvaAbcReferencias
};
