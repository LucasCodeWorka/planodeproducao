// Classificacao ATUAL do ERP (marca, status, continuidade) por SKU, em memoria.
//
// f_dic_prd_classificacao e cara: ~6 mil SKUs levam ~80s. Permanentes e edicao limitada
// classificam a mesma lista (quem vendeu no 2o semestre), e a Visao Geral dispara os dois
// juntos — sem cache compartilhado cada um pagava a conta inteira e a tela estourava o
// timeout do navegador. Pedidos simultaneos do mesmo SKU esperam a mesma consulta.

const TTL_MS = 4 * 60 * 60 * 1000;
const cache = new Map(); // id -> { marca, status, continuidade, em }
const emAndamento = new Map(); // id -> Promise<void>

const normErp = (expr) => `UPPER(TRIM(TRANSLATE(COALESCE(${expr}, ''), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')))`;

async function consultar(pool, ids) {
  const { rows } = await pool.query(`
    SELECT p.id AS idproduto,
           ${normErp("f_dic_prd_classificacao(p.id, 'DS'::text, 20::bigint)")} AS marca,
           ${normErp("f_dic_prd_classificacao(p.id, 'DS'::text, 27::bigint)")} AS status,
           ${normErp("f_dic_prd_classificacao(p.id, 'DS'::text, 802::bigint)")} AS continuidade
      FROM unnest($1::BIGINT[]) AS p(id)
  `, [ids]);
  const em = Date.now();
  for (const r of rows) {
    cache.set(Number(r.idproduto), { marca: r.marca, status: r.status, continuidade: r.continuidade, em });
  }
}

/** Devolve Map id -> { marca, status, continuidade }, ja normalizados (caixa e acento). */
async function classificarAtual(pool, ids) {
  const agora = Date.now();
  const unicos = [...new Set(ids.map(Number).filter(Number.isFinite))];
  const faltando = unicos.filter((id) => {
    const c = cache.get(id);
    return (!c || agora - c.em > TTL_MS) && !emAndamento.has(id);
  });
  if (faltando.length) {
    const promessa = consultar(pool, faltando).finally(() => {
      for (const id of faltando) emAndamento.delete(id);
    });
    for (const id of faltando) emAndamento.set(id, promessa);
  }
  await Promise.all([...new Set(unicos.map((id) => emAndamento.get(id)).filter(Boolean))]);
  const resultado = new Map();
  for (const id of unicos) {
    const c = cache.get(id);
    if (c) resultado.set(id, c);
  }
  return resultado;
}

/** Aquece o cache com quem vendeu a partir de `desde`. Erro aqui nao derruba a API. */
async function aquecer(pool, desde) {
  const t0 = Date.now();
  try {
    const { rows } = await pool.query(
      'SELECT DISTINCT idproduto::BIGINT AS idproduto FROM public.mv_vendas_qtd WHERE data >= $1::DATE',
      [desde],
    );
    await classificarAtual(pool, rows.map((r) => r.idproduto));
    console.log(`[classificacao-erp] cache aquecido: ${rows.length} SKUs em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.warn('[classificacao-erp] falha ao aquecer cache:', err.message);
  }
}

module.exports = { classificarAtual, aquecer };
