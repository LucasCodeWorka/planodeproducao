/**
 * Projecao de EDICAO LIMITADA.
 *
 * Por que um servico separado do de permanentes: la o SKU sobrevive de um ano para o outro,
 * entao a regra "mesmo mes do ano anterior" roda SKU a SKU. Aqui o SKU nao
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
 * A politica de canal e a mesma ja aprovada para permanentes: fabrica pela regra de fatorFabricaMes, lojas sem
 * acrescimo.
 */

// Status que contam como "estava em linha": os mesmos da matriz do plano. Ficam fora o
// "EM LINHA NAO COMPRAR MP" (decisao da operacao, 14/10/2026: nao entra na projecao), e as
// faixas de OPORTUNIDADE (queima de estoque) e LEVE DEFEITO: sao venda real, mas nao se
// produz para abastece-las, entao nao entram numa projecao que vira plano de producao.
const STATUS_EM_LINHA = ['EM LINHA', 'NOVA COLECAO'];

// Meses em que so conta EM LINHA, sem NOVA COLECAO (decisao da operacao, 14/10/2026). Mesma
// regra dos permanentes.
const MESES_SO_EM_LINHA = [1];

// Do mes 7 do ano CORRENTE em diante a classificacao e a atual, direto do ERP (a mesma do BI),
// como nos permanentes. Anos anteriores seguem com o status da epoca.
const MES_INICIO_CLASSIFICACAO_ATUAL = 7;

const { classificarAtual } = require('./classificacaoErpCache');

const CONTINUIDADE_EL = ['EDICAO LIMITADA', 'EDIÇÃO LIMITADA'];

const { fatorFabricaMes } = require('./projecaoPermanentesService');

const CRESCIMENTO_FABRICA_PADRAO = 0;

/**
 * Venda de edicao limitada por ano/mes e canal, com o recorte historico.
 * @returns {Promise<Map<string, {fabrica:number, lojas:number}>>} chave "ano-mes"
 */
async function venderPorMesHistorico(pool, { de, ate, marca = 'LIEBE', hoje = new Date() }) {
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
       AND (NOT (EXTRACT(MONTH FROM v.data)::INT = ANY($6::INT[])) OR UPPER(TRIM(COALESCE(h.status, ''))) = 'EM LINHA')
       AND v.data >= $1::DATE AND v.data < $2::DATE
     GROUP BY 1, 2
  `, [de, ate, String(marca).toUpperCase(), CONTINUIDADE_EL, STATUS_EM_LINHA, MESES_SO_EM_LINHA]);

  const mapa = new Map();
  for (const row of rows) {
    mapa.set(`${Number(row.ano)}-${Number(row.mes)}`, {
      fabrica: Number(row.fabrica) || 0,
      lojas: Number(row.lojas) || 0,
    });
  }

  // 2o semestre do ano corrente: classificacao ATUAL do ERP (a mesma do BI), sobrescrevendo o
  // recorte historico desses meses. A classificacao vem do cache compartilhado: misturada ao
  // join historico a consulta estourava 4 minutos.
  const anoCorrente = hoje.getFullYear();
  const inicioAtual = `${anoCorrente}-${String(MES_INICIO_CLASSIFICACAO_ATUAL).padStart(2, '0')}-01`;
  const deAtual = inicioAtual > de ? inicioAtual : de;
  const ateAtual = `${anoCorrente + 1}-01-01` < ate ? `${anoCorrente + 1}-01-01` : ate;
  if (deAtual < ateAtual) {
    const vendas = await pool.query(`
      SELECT v.idproduto::BIGINT AS idproduto, EXTRACT(MONTH FROM v.data)::INT AS mes,
             SUM(CASE WHEN v.idempresa = 1  THEN v.qt_liquida ELSE 0 END)::FLOAT AS fabrica,
             SUM(CASE WHEN v.idempresa <> 1 THEN v.qt_liquida ELSE 0 END)::FLOAT AS lojas
        FROM public.mv_vendas_qtd v
       WHERE v.data >= $1::DATE AND v.data < $2::DATE
       GROUP BY 1, 2
    `, [deAtual, ateAtual]);
    const classif = await classificarAtual(pool, vendas.rows.map((r) => r.idproduto));
    const ehEl = new Set([...classif.entries()]
      .filter(([, c]) => c.marca === String(marca).toUpperCase() && c.continuidade === 'EDICAO LIMITADA' && STATUS_EM_LINHA.includes(c.status))
      .map(([id]) => id));
    const meses = new Set(vendas.rows.map((r) => Number(r.mes)));
    for (const mes of meses) mapa.set(`${anoCorrente}-${mes}`, { fabrica: 0, lojas: 0 });
    for (const r of vendas.rows) {
      if (!ehEl.has(Number(r.idproduto))) continue;
      const atual = mapa.get(`${anoCorrente}-${Number(r.mes)}`);
      atual.fabrica += Number(r.fabrica) || 0;
      atual.lojas += Number(r.lojas) || 0;
    }
  }
  return mapa;
}

/**
 * Projeta edicao limitada para `anoDestino`, mes a mes.
 *
 * Para cada mes, procura o mesmo mes no ano base (anoDestino - 1). Se aquele mes ainda nao
 * fechou — o mes corrente e os seguintes, que so tem venda parcial — cai para o mesmo mes
 * do ano anterior a ele, que e uma estacao completa, e o ajuste de fabrica compoe pela
 * distancia em anos. Sem esse recuo, out/nov/dez do ano destino nasceriam
 * com a venda de um mes que ainda esta acontecendo.
 */
async function projetarEdicaoLimitada(pool, { anoDestino, marca = 'LIEBE', hoje = new Date(), crescimentoFabrica = null } = {}) {
  // Mesma regra dos permanentes (fatorFabricaMes): padrao 0%, abril e maio +20%; o cenario
  // troca a taxa dos outros meses. Compoe pela distancia em anos no recuo.
  const crescimento = crescimentoFabrica !== null ? Number(crescimentoFabrica) : null;
  const ajusteFabricaCenario = 1 + (crescimento ?? CRESCIMENTO_FABRICA_PADRAO);
  const destino = Number(anoDestino);
  if (!Number.isInteger(destino)) throw new Error('anoDestino invalido');

  const anoBase = destino - 1;
  // Dois anos de historico: o base e o anterior, que serve de recuo para os meses abertos.
  const vendas = await venderPorMesHistorico(pool, {
    de: `${anoBase - 1}-01-01`,
    ate: `${anoBase + 1}-01-01`,
    marca,
    hoje,
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
    const fator = Math.pow(fatorFabricaMes(mes, crescimento), distancia);
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
    ajusteFabricaAnual: ajusteFabricaCenario,
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
