/**
 * Projecao de EDICAO LIMITADA.
 *
 * Por que um servico separado do de permanentes: la o SKU sobrevive de um ano para o outro,
 * entao a regra "mesmo mes do ano anterior +10% na fabrica" roda SKU a SKU. Aqui o SKU nao
 * sobrevive — quem sobrevive e a colecao. Medido em 09/10/2026: dos SKUs de edicao limitada,
 * 1.321 estavam em linha em janeiro/2026, ~620 em agosto, e hoje sao 623. Projetar com a
 * fotografia de hoje cortaria janeiro pela metade.
 *
 * Por isso a base vem da `hist_dproduto`, que e uma dimensao historica (SCD-2: dt_inicio,
 * dt_fim, atual). O join com a venda e pela JANELA DE VALIDADE, nunca por `atual`: assim
 * cada mes conta os SKUs que eram edicao limitada e estavam em linha NAQUELE mes.
 *
 * O modelo e agregado, nao por SKU, e isso e deliberado. Como as colecoes se revezam
 * (INVERNO N vende no 1o semestre de N, VERAO N/N+1 no 2o semestre de N — conferido contra
 * a venda real), o total de um mes do ano base ja contem a colecao certa daquele mes. Somar
 * por mes e deslocar 12 meses reproduz o rodizio sozinho, sem depender de um mapa de nomes
 * de colecao — que ja se provou fragil: "VERAO 27" existe mas e orfa (2.063 pecas, 26 SKUs),
 * quem vendeu o verao de 2026 foi "VERAO 26/27".
 *
 * A politica de canal e a mesma ja aprovada para permanentes: fabrica +10%, lojas sem
 * acrescimo.
 */

// Status que contam como "estava em linha". A matriz da tela usa so os dois primeiros;
// aqui entra tambem o "NAO COMPRAR MP", que continua sendo linha ativa — o que ele proibe
// e a compra de materia-prima, nao a venda. Fora da lista ficam as faixas de OPORTUNIDADE
// (queima de estoque) e LEVE DEFEITO: sao venda real, mas nao se produz para abastece-las,
// entao nao entram numa projecao que vira plano de producao.
const STATUS_EM_LINHA = ['EM LINHA', 'NOVA COLECAO', 'EM LINHA NAO COMPRAR MP'];

const CONTINUIDADE_EL = ['EDICAO LIMITADA', 'EDIÇÃO LIMITADA'];

const AJUSTE_FABRICA_ANUAL = 1.10;

/**
 * Venda de edicao limitada por ano/mes e canal, com o recorte historico.
 * @returns {Promise<Map<string, {fabrica:number, lojas:number}>>} chave "ano-mes"
 */
async function venderPorMesHistorico(pool, { de, ate, marca = 'LIEBE' }) {
  const { rows } = await pool.query(`
    SELECT EXTRACT(YEAR FROM v.data)::INT  AS ano,
           EXTRACT(MONTH FROM v.data)::INT AS mes,
           SUM(CASE WHEN v.idempresa = 1  THEN v.qt_liquida ELSE 0 END)::FLOAT AS fabrica,
           SUM(CASE WHEN v.idempresa <> 1 THEN v.qt_liquida ELSE 0 END)::FLOAT AS lojas
      FROM public.mv_vendas_qtd v
      JOIN public.hist_dproduto h
        ON h.cd_produto = v.idproduto
       AND h.dt_inicio <= v.data
       AND (h.dt_fim IS NULL OR h.dt_fim >= v.data)
     WHERE UPPER(TRIM(COALESCE(h.marca, ''))) = $3
       AND UPPER(TRIM(COALESCE(h.continuidade, ''))) = ANY($4::TEXT[])
       AND UPPER(TRIM(COALESCE(h.status, '')))       = ANY($5::TEXT[])
       AND v.data >= $1::DATE AND v.data < $2::DATE
     GROUP BY 1, 2
  `, [de, ate, String(marca).toUpperCase(), CONTINUIDADE_EL, STATUS_EM_LINHA]);

  const mapa = new Map();
  for (const row of rows) {
    mapa.set(`${Number(row.ano)}-${Number(row.mes)}`, {
      fabrica: Number(row.fabrica) || 0,
      lojas: Number(row.lojas) || 0,
    });
  }
  return mapa;
}

/**
 * Projeta edicao limitada para `anoDestino`, mes a mes.
 *
 * Para cada mes, procura o mesmo mes no ano base (anoDestino - 1). Se aquele mes ainda nao
 * fechou — o mes corrente e os seguintes, que so tem venda parcial — cai para o mesmo mes
 * do ano anterior a ele, que e uma estacao completa, e o ajuste de fabrica compoe pela
 * distancia em anos (1,10 por ano). Sem esse recuo, out/nov/dez do ano destino nasceriam
 * com a venda de um mes que ainda esta acontecendo.
 */
async function projetarEdicaoLimitada(pool, { anoDestino, marca = 'LIEBE', hoje = new Date() } = {}) {
  const destino = Number(anoDestino);
  if (!Number.isInteger(destino)) throw new Error('anoDestino invalido');

  const anoBase = destino - 1;
  // Dois anos de historico: o base e o anterior, que serve de recuo para os meses abertos.
  const vendas = await venderPorMesHistorico(pool, {
    de: `${anoBase - 1}-01-01`,
    ate: `${anoBase + 1}-01-01`,
    marca,
  });

  // Um mes do ano base so esta fechado se ja passou. No ano corrente isso corta no mes de
  // hoje; se o ano base ja acabou, todos os doze estao fechados.
  const mesCorrente = hoje.getFullYear() === anoBase ? hoje.getMonth() + 1 : 13;

  const porMes = [];
  for (let mes = 1; mes <= 12; mes += 1) {
    const fechado = mes < mesCorrente;
    const anoFonte = fechado ? anoBase : anoBase - 1;
    const base = vendas.get(`${anoFonte}-${mes}`) || { fabrica: 0, lojas: 0 };
    const distancia = destino - anoFonte;
    const fator = Math.pow(AJUSTE_FABRICA_ANUAL, distancia);
    const fabrica = Math.round(base.fabrica * fator);
    const lojas = Math.round(base.lojas);
    porMes.push({
      mes,
      anoFonte,
      fonte: fechado ? 'ano base fechado' : 'ano base ainda aberto: recuo de um ano',
      fatorFabrica: Number(fator.toFixed(4)),
      fabricaBase: Math.round(base.fabrica),
      lojasBase: Math.round(base.lojas),
      fabrica,
      lojas,
      quantidade: fabrica + lojas,
    });
  }

  const data = Object.fromEntries(porMes.map((m) => [String(m.mes), m.quantidade]));
  const total = porMes.reduce((soma, m) => soma + m.quantidade, 0);

  return {
    anoDestino: destino,
    anoBase,
    marca: String(marca).toUpperCase(),
    statusConsiderados: STATUS_EM_LINHA,
    ajusteFabricaAnual: AJUSTE_FABRICA_ANUAL,
    total,
    data,
    porMes,
  };
}

module.exports = {
  projetarEdicaoLimitada,
  venderPorMesHistorico,
  STATUS_EM_LINHA,
  CONTINUIDADE_EL,
};
