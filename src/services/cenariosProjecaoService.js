/**
 * Cenários de projeção para simular no plano sem gravar em app_projecoes.
 *
 * O totalizador de cada cenário é uma decisão (vem de data/cenarios_projecao.json).
 * A distribuição por SKU usa a mesma regra da Projeção Permanentes: participação do
 * 1º semestre do ano corrente comparada com os últimos 3 meses fechados, limiar de
 * 50% para usar só a tendência, normalizada e distribuída por maior resto.
 */

const fs = require('fs');
const path = require('path');
const { readCache } = require('../cache/matrizCache');
const { isExcludedPlanningItem, normalizePlanningText } = require('./planningExclusions');

const ARQUIVO = path.join(__dirname, '..', '..', 'data', 'cenarios_projecao.json');
const TTL_MS = 30 * 60 * 1000;
const memo = new Map();

function lerConfig() {
  const raw = fs.readFileSync(ARQUIVO, 'utf8');
  return JSON.parse(raw);
}

function listarCenarios() {
  const config = lerConfig();
  return Object.entries(config.cenarios || {}).map(([id, c]) => ({
    id,
    nome: c.nome,
    detalhe: c.detalhe,
    ano: c.ano,
    meses: Object.keys(c.meses || {}).map(Number).sort((a, b) => a - b),
    totalizadores: c.meses,
  }));
}

/** SKUs permanentes atuais, com as médias que alimentam a representatividade. */
async function buscarSkusDoCenario(pool) {
  const cached = await readCache();
  const linhas = cached?.data?.rows || cached?.data || [];
  if (!Array.isArray(linhas) || linhas.length === 0) return [];

  return linhas
    .filter((item) => {
      const p = item?.produto || {};
      const continuidade = normalizePlanningText(p.continuidade);
      const status = normalizePlanningText(p.status);
      return normalizePlanningText(p.marca) === 'LIEBE'
        && (continuidade === 'PERMANENTE' || continuidade === 'PERMANENTE COR NOVA')
        && (status === 'EM LINHA' || status === 'NOVA COLECAO')
        && !isExcludedPlanningItem({ referencia: p.referencia, produto: p.produto, apresentacao: p.apresentacao });
    })
    .map((item) => ({
      id: String(item.produto.idproduto),
      referencia: String(item.produto.referencia || '').trim(),
      produto: String(item.produto.produto || '').trim(),
      apresentacao: String(item.produto.apresentacao || '').trim(),
      tamanho: String(item.produto.tamanho || '').trim(),
      total3m: (Number(item?.demanda?.media_vendas_3m) || 0) * 3,
    }));
}

/** Itens com tamanho/referência PT ficam fora da projeção, como na Projeção Permanentes. */
function ehItemPt(sku) {
  return [sku.tamanho, sku.referencia, sku.produto, sku.apresentacao]
    .map((valor) => normalizePlanningText(valor))
    .some((valor) => /^PT(?:\s|$)/.test(valor));
}

async function calcularRepresentatividade(pool, skus, ano) {
  const ids = skus.map((s) => Number(s.id)).filter(Number.isFinite);
  if (ids.length === 0) return new Map();

  const result = await pool.query(`
    SELECT idproduto::TEXT AS id, SUM(qt_liquida)::FLOAT AS total
      FROM public.mv_vendas_qtd
     WHERE idproduto = ANY($1::BIGINT[])
       AND data >= $2::DATE AND data < $3::DATE
     GROUP BY 1
  `, [ids, `${ano}-01-01`, `${ano}-07-01`]);
  const total6mPorId = new Map(result.rows.map((r) => [String(r.id), Number(r.total) || 0]));

  const projetaveis = skus.filter((s) => !ehItemPt(s) && ((total6mPorId.get(s.id) || 0) > 0 || s.total3m > 0));
  const soma6m = projetaveis.reduce((acc, s) => acc + (total6mPorId.get(s.id) || 0), 0) || 1;
  const soma3m = projetaveis.reduce((acc, s) => acc + s.total3m, 0) || 1;

  const reps = new Map();
  let somaRep = 0;
  for (const sku of projetaveis) {
    const rep6m = (total6mPorId.get(sku.id) || 0) / soma6m;
    const rep3m = sku.total3m / soma3m;
    const semHistorico = rep6m <= 0 && rep3m > 0;
    const variacao = semHistorico ? 1 : (rep6m <= 0 ? 0 : Math.abs(rep3m - rep6m) / rep6m);
    const rep = variacao > 0.5 ? rep3m : (rep6m + rep3m) / 2;
    reps.set(sku.id, rep);
    somaRep += rep;
  }
  for (const [id, rep] of reps) reps.set(id, rep / (somaRep || 1));
  return reps;
}

/** Distribui o totalizador pelos SKUs por maior resto, para a soma bater exatamente. */
function distribuir(totalizador, reps) {
  const calculos = [...reps.entries()].map(([id, rep]) => {
    const bruto = totalizador * rep;
    const base = Math.floor(bruto);
    return { id, base, sobra: bruto - base };
  });
  let restante = totalizador - calculos.reduce((acc, c) => acc + c.base, 0);
  calculos.sort((a, b) => b.sobra - a.sobra);

  const valores = new Map();
  for (const item of calculos) {
    const extra = restante > 0 ? 1 : 0;
    valores.set(item.id, item.base + extra);
    restante -= extra;
  }
  return valores;
}

/**
 * Gera a projeção de um cenário.
 * @returns {Promise<{ meses: number[], ano: number, porSku: Object, idsCobertos: string[] }>}
 */
async function gerarCenario(pool, cenarioId) {
  const emMemoria = memo.get(cenarioId);
  if (emMemoria && (Date.now() - emMemoria.at) < TTL_MS) return emMemoria.data;

  const config = lerConfig();
  const cenario = config.cenarios?.[cenarioId];
  if (!cenario) throw new Error(`Cenário desconhecido: ${cenarioId}`);

  const skus = await buscarSkusDoCenario(pool);
  if (skus.length === 0) throw new Error('Cache da matriz indisponível para montar o cenário');

  const reps = await calcularRepresentatividade(pool, skus, cenario.ano);
  const meses = Object.keys(cenario.meses).map(Number).sort((a, b) => a - b);

  // Todo SKU permanente entra no resultado: quem não é projetável fica zerado no período,
  // senão o valor antigo gravado continuaria valendo e inflaria o plano.
  const porSku = {};
  for (const sku of skus) porSku[sku.id] = Object.fromEntries(meses.map((mes) => [String(mes), 0]));

  for (const mes of meses) {
    const valores = distribuir(Number(cenario.meses[String(mes)]) || 0, reps);
    for (const [id, valor] of valores) porSku[id][String(mes)] = valor;
  }

  const data = {
    id: cenarioId,
    nome: cenario.nome,
    detalhe: cenario.detalhe,
    ano: cenario.ano,
    meses,
    totalizadores: cenario.meses,
    skusProjetaveis: reps.size,
    skusCobertos: skus.length,
    porSku,
  };
  memo.set(cenarioId, { at: Date.now(), data });
  return data;
}

/**
 * Aplica o cenário sobre as projeções efetivas, substituindo só os meses do cenário.
 *
 * modo 'reducao' (padrão): troca apenas onde o cenário é menor. Serve para o meio do ano,
 *   quando dá para cortar plano mas não dá para aumentar (matéria-prima já comprada).
 * modo 'aumento': troca apenas onde o cenário é maior.
 * modo 'completo': troca sempre.
 *
 * @returns {{ data: Object, resumo: Object }}
 */
function aplicarCenario(projecoes, cenario, modo = 'reducao') {
  const modoValido = ['reducao', 'aumento', 'completo'].includes(modo) ? modo : 'reducao';
  const resultado = { ...projecoes };
  const resumo = {
    modo: modoValido,
    skusAlterados: 0,
    pecasReduzidas: 0,
    pecasAumentadas: 0,
    // o que o cenário pediria no modo completo, para mostrar o que ficou de fora
    skusComReducao: 0,
    pecasDeReducao: 0,
    skusComAumento: 0,
    pecasDeAumento: 0,
  };

  for (const [id, meses] of Object.entries(cenario.porSku)) {
    const base = { ...(resultado[id] || {}) };
    let alterou = false;
    let temReducao = false;
    let temAumento = false;

    for (const [mes, valorCenario] of Object.entries(meses)) {
      const atual = Number(base[mes] || 0);
      const novo = Number(valorCenario || 0);

      if (novo < atual) { temReducao = true; resumo.pecasDeReducao += atual - novo; }
      else if (novo > atual) { temAumento = true; resumo.pecasDeAumento += novo - atual; }

      let final = atual;
      if (modoValido === 'completo') final = novo;
      else if (modoValido === 'aumento') final = Math.max(atual, novo);
      else final = Math.min(atual, novo);

      if (final !== atual) {
        if (final < atual) resumo.pecasReduzidas += atual - final;
        else resumo.pecasAumentadas += final - atual;
        base[mes] = final;
        alterou = true;
      }
    }

    if (temReducao) resumo.skusComReducao += 1;
    if (temAumento) resumo.skusComAumento += 1;
    if (alterou) {
      resumo.skusAlterados += 1;
      resultado[id] = base;
    }
  }

  for (const chave of ['pecasReduzidas', 'pecasAumentadas', 'pecasDeReducao', 'pecasDeAumento']) {
    resumo[chave] = Math.round(resumo[chave]);
  }

  return { data: resultado, resumo };
}

function limparCache() {
  memo.clear();
}

module.exports = { listarCenarios, gerarCenario, aplicarCenario, limparCache };
