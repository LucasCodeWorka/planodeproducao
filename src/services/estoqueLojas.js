/**
 * Serviço para consulta e cálculo de estoque excedente nas lojas
 *
 * Identifica estoque que pode ser transferido das lojas para a fábrica
 * considerando a cobertura mínima que cada loja deve manter.
 */

const { calcularEstoqueMinimo } = require('./estoqueMinimo');

/**
 * Busca estoque atual de produtos em todas as lojas
 * Exclui empresas: 1 (fábrica), 100, 110 (depósitos)
 *
 * @param {Pool} pool - Pool de conexão PostgreSQL
 * @param {Object} options - Opções de filtro
 * @returns {Promise<Array>} Lista de estoques por loja/produto
 */
async function buscarEstoqueLojas(pool, options = {}) {
  const { cdProduto = null, cdEmpresa = null } = options;

  let query = `
    SELECT
      NOW() AS data,
      cd_empresa,
      cd_produto,
      f_dic_sld_prd_produto(cd_empresa::TEXT, '1'::TEXT, cd_produto, NULL::TIMESTAMP) AS estoque
    FROM vr_prd_prdinfo
    WHERE cd_empresa NOT IN (1, 100, 110)
      AND cd_produto < 1000000
      AND f_dic_sld_prd_produto(cd_empresa::TEXT, '1'::TEXT, cd_produto, NULL::TIMESTAMP) > 0
  `;

  const params = [];
  let idx = 1;

  if (cdProduto) {
    query += ` AND cd_produto = $${idx++}`;
    params.push(cdProduto);
  }
  if (cdEmpresa) {
    query += ` AND cd_empresa = $${idx++}`;
    params.push(cdEmpresa);
  }

  query += ` ORDER BY cd_empresa, cd_produto`;

  const result = await pool.query(query, params);
  return result.rows.map(r => ({
    cd_empresa: Number(r.cd_empresa),
    cd_produto: Number(r.cd_produto),
    estoque: parseFloat(r.estoque) || 0
  }));
}

/**
 * Busca vendas históricas das lojas para cálculo de estoque mínimo
 * Usa mesma lógica da fábrica: últimos 6 meses e últimos 3 meses
 *
 * @param {Pool} pool - Pool de conexão PostgreSQL
 * @param {Object} options - Opções de filtro
 * @returns {Promise<Array>} Lista de vendas agregadas por loja/produto
 */
async function buscarVendasLojas(pool, options = {}) {
  const { cdProduto = null } = options;

  // Calcula datas de início para 6 meses e 3 meses atrás
  const hoje = new Date();
  const inicio6m = new Date(hoje.getFullYear(), hoje.getMonth() - 6, 1);
  const inicio3m = new Date(hoje.getFullYear(), hoje.getMonth() - 3, 1);

  let query = `
    SELECT
      t.cd_empresa,
      i.cd_produto,
      SUM(
        CASE WHEN i.dt_transacao >= $1 THEN
          i.qt_solicitada * (CASE WHEN t.tp_modalidade = '3' THEN -1 ELSE 1 END)
        ELSE 0 END
      ) AS vendas_6m,
      SUM(
        CASE WHEN i.dt_transacao >= $2 THEN
          i.qt_solicitada * (CASE WHEN t.tp_modalidade = '3' THEN -1 ELSE 1 END)
        ELSE 0 END
      ) AS vendas_3m
    FROM vr_tra_transacao t
    JOIN vr_tra_transitem i ON (t.cd_empresa = i.cd_empresa AND t.nr_transacao = i.nr_transacao)
    WHERE t.cd_empresa NOT IN (1, 100, 110)
      AND t.cd_operacao NOT IN (140, 76, 25, 26, 27, 273, 44, 240, 241, 242, 243, 244, 245, 239, 238, 237, 236)
      AND i.dt_transacao >= $1
      AND i.cd_compvend <> 1
      AND t.tp_situacao <> 6
      AND t.tp_modalidade IN ('3', '4')
  `;

  const params = [inicio6m, inicio3m];
  let idx = 3;

  if (cdProduto) {
    query += ` AND i.cd_produto = $${idx++}`;
    params.push(cdProduto);
  }

  query += ` GROUP BY t.cd_empresa, i.cd_produto`;

  const result = await pool.query(query, params);

  return result.rows.map(r => {
    const vendas6m = Math.max(0, parseFloat(r.vendas_6m) || 0);
    const vendas3m = Math.max(0, parseFloat(r.vendas_3m) || 0);

    // Calcula média MENSAL (mesmo padrão da fábrica)
    const mediaSemestral = vendas6m / 6;
    const mediaTrimestral = vendas3m / 3;

    return {
      cd_empresa: Number(r.cd_empresa),
      cd_produto: Number(r.cd_produto),
      vendas_6m: vendas6m,
      vendas_3m: vendas3m,
      media_semestral: mediaSemestral,
      media_trimestral: mediaTrimestral
    };
  });
}

/**
 * Calcula estoque excedente por produto em cada loja
 * Excedente = estoque atual - (estoque mínimo × cobertura mínima)
 *
 * @param {Pool} pool - Pool de conexão PostgreSQL
 * @param {Object} options - Opções
 * @param {number} options.coberturaMinima - Cobertura mínima que a loja deve manter (padrão: 1.0)
 * @returns {Promise<Array>} Lista com excedente de cada loja/produto
 */
async function calcularEstoqueExcedentePorLoja(pool, options = {}) {
  const {
    cdProduto = null,
    coberturaMinima = 1.0
  } = options;

  // Busca estoques e vendas em paralelo
  const [estoques, vendas] = await Promise.all([
    buscarEstoqueLojas(pool, { cdProduto }),
    buscarVendasLojas(pool, { cdProduto })
  ]);

  // Cria map de vendas por loja/produto
  const vendasMap = new Map();
  for (const v of vendas) {
    const key = `${v.cd_empresa}_${v.cd_produto}`;
    vendasMap.set(key, v);
  }

  const resultado = [];

  for (const est of estoques) {
    const key = `${est.cd_empresa}_${est.cd_produto}`;
    const venda = vendasMap.get(key);

    // Calcula estoque mínimo da loja usando mesma lógica da fábrica
    let estoqueMinimo = 0;
    let calculoMinimo = null;

    if (venda) {
      calculoMinimo = calcularEstoqueMinimo(
        venda.media_semestral,
        venda.media_trimestral
      );
      estoqueMinimo = calculoMinimo.estoqueMinimo || 0;
    }

    // Estoque necessário = mínimo × cobertura configurada
    const estoqueNecessario = estoqueMinimo * coberturaMinima;

    // Excedente = estoque atual - estoque necessário (nunca negativo)
    const excedente = Math.max(0, est.estoque - estoqueNecessario);

    // Cobertura atual = estoque / mínimo
    const coberturaAtual = estoqueMinimo > 0
      ? est.estoque / estoqueMinimo
      : null;

    resultado.push({
      cd_empresa: est.cd_empresa,
      cd_produto: est.cd_produto,
      estoque_loja: est.estoque,
      estoque_minimo_loja: estoqueMinimo,
      estoque_necessario: estoqueNecessario,
      excedente: excedente,
      media_vendas: venda?.media_trimestral || 0,
      cobertura_atual: coberturaAtual,
      calculo_minimo: calculoMinimo
    });
  }

  return resultado;
}

/**
 * Agrega estoque excedente de todas as lojas por produto
 * Retorna total disponível para uso na fábrica
 *
 * @param {Pool} pool - Pool de conexão PostgreSQL
 * @param {Object} options - Opções
 * @returns {Promise<Array>} Lista com excedente agregado por produto
 */
async function calcularExcedenteTotalPorProduto(pool, options = {}) {
  const {
    coberturaMinima = 1.0,
    cdProduto = null,
    incluirDetalhes = true
  } = options;

  const excedentes = await calcularEstoqueExcedentePorLoja(pool, {
    cdProduto,
    coberturaMinima
  });

  // Agrupa por produto
  const porProduto = new Map();

  for (const exc of excedentes) {
    if (!porProduto.has(exc.cd_produto)) {
      porProduto.set(exc.cd_produto, {
        cd_produto: exc.cd_produto,
        excedente_total: 0,
        estoque_total_lojas: 0,
        lojas_com_excedente: 0,
        detalhes_lojas: incluirDetalhes ? [] : null
      });
    }

    const p = porProduto.get(exc.cd_produto);
    p.excedente_total += exc.excedente;
    p.estoque_total_lojas += exc.estoque_loja;

    if (exc.excedente > 0) {
      p.lojas_com_excedente++;
      if (incluirDetalhes) {
        p.detalhes_lojas.push({
          cd_empresa: exc.cd_empresa,
          excedente: exc.excedente,
          estoque_loja: exc.estoque_loja,
          estoque_minimo: exc.estoque_minimo_loja,
          cobertura_atual: exc.cobertura_atual
        });
      }
    }
  }

  return Array.from(porProduto.values());
}

/**
 * Busca lista de empresas (lojas) disponíveis
 *
 * @param {Pool} pool - Pool de conexão PostgreSQL
 * @returns {Promise<Array>} Lista de lojas
 */
async function buscarLojas(pool) {
  const query = `
    SELECT
      e.cd_empresa AS idempresa,
      e.nm_grupoempresa AS empresa,
      f_dic_pes_classificacao2(e.cd_pessoa, 'DS'::text, 1000::bigint) AS suplojas,
      f_dic_pes_classificacao2(e.cd_pessoa, 'DS'::text, 400::bigint) AS area,
      "END".nm_municipio AS cidade,
      "END".ds_siglaest AS estado
    FROM vr_ger_empresa e
    JOIN vr_pes_endereco "END" ON (e.cd_pessoa = "END".cd_pessoa)
    WHERE ((e.cd_empresa < 50 AND e.cd_empresa <> 1 AND "END".cd_tipoendereco = 1)
           OR e.cd_empresa IN (100, 110, 120))
    ORDER BY e.cd_empresa
  `;

  const result = await pool.query(query);
  return result.rows.map(r => ({
    id: Number(r.idempresa),
    cd_empresa: Number(r.idempresa),
    nome: r.empresa,
    nm_grupoempresa: r.empresa,
    suplojas: r.suplojas,
    area: r.area,
    cidade: r.cidade,
    estado: r.estado
  }));
}

async function buscarEstoqueDisponivelTransferencia(pool, options = {}) {
  const {
    lojaDestino = 1,
    cdProduto = null,
    lojaOrigem = null,
  } = options;

  const params = [Number(lojaDestino), 'COBERTURA_MIX_FAMILIA'];
  const filtros = [`a.loja_destino = $1`, `a.cenario = $2`];

  if (cdProduto !== null) {
    params.push(Number(cdProduto));
    filtros.push(`a.cd_produto = $${params.length}`);
  }

  if (lojaOrigem !== null) {
    params.push(Number(lojaOrigem));
    filtros.push(`a.loja_origem = $${params.length}`);
  }

  const query = `
    SELECT
      a.loja_origem::BIGINT AS loja_origem,
      a.cd_produto::BIGINT AS cd_produto,
      MAX(f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar)) AS referencia,
      MAX(p.ds_cor) AS cor,
      MAX(p.ds_tamanho) AS tamanho,
      MAX(f_dic_prd_nivel(a.cd_produto, 'DS'::bpchar)) AS produto,
      SUM(COALESCE(a.qtd_sugerida, 0))::FLOAT AS qtd_sugerida
    FROM cenario_transferencia_fabrica a
    LEFT JOIN vr_prd_prdgrade p
      ON p.cd_produto = a.cd_produto
    WHERE ${filtros.join(' AND ')}
    GROUP BY a.loja_origem, a.cd_produto
    HAVING SUM(COALESCE(a.qtd_sugerida, 0)) > 0
    ORDER BY a.cd_produto, a.loja_origem
  `;

  const result = await pool.query(query, params);
  return result.rows.map((r) => ({
    loja_origem: Number(r.loja_origem),
    cd_produto: Number(r.cd_produto),
    referencia: String(r.referencia || ''),
    cor: String(r.cor || ''),
    tamanho: String(r.tamanho || ''),
    produto: String(r.produto || ''),
    qtd_sugerida: Math.round(Number(r.qtd_sugerida || 0)),
  }));
}

async function buscarEstoqueDisponivelAgregadoPorProduto(pool, options = {}) {
  const {
    lojaDestino = 1,
    cdProduto = null,
    incluirDetalhes = true,
  } = options;

  const itens = await buscarEstoqueDisponivelTransferencia(pool, {
    lojaDestino,
    cdProduto,
  });

  const porProduto = new Map();
  for (const item of itens) {
    if (!porProduto.has(item.cd_produto)) {
      porProduto.set(item.cd_produto, {
        cd_produto: item.cd_produto,
        referencia: item.referencia,
        cor: item.cor,
        tamanho: item.tamanho,
        produto: item.produto,
        qtd_disponivel_total: 0,
        lojas_origem_count: 0,
        detalhes_lojas: incluirDetalhes ? [] : [],
      });
    }

    const atual = porProduto.get(item.cd_produto);
    atual.qtd_disponivel_total += Number(item.qtd_sugerida || 0);
    atual.lojas_origem_count += 1;
    if (incluirDetalhes) {
      atual.detalhes_lojas.push({
        loja_origem: item.loja_origem,
        qtd_sugerida: Math.round(Number(item.qtd_sugerida || 0)),
      });
    }
  }

  return Array.from(porProduto.values()).map((item) => ({
    ...item,
    qtd_disponivel_total: Math.round(Number(item.qtd_disponivel_total || 0)),
  }));
}

module.exports = {
  buscarEstoqueLojas,
  buscarVendasLojas,
  calcularEstoqueExcedentePorLoja,
  calcularExcedenteTotalPorProduto,
  buscarLojas,
  buscarEstoqueDisponivelTransferencia,
  buscarEstoqueDisponivelAgregadoPorProduto,
};
