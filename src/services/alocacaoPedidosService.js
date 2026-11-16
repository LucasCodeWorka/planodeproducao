/**
 * Motor de alocação por pedido (ATP): dado o que está disponível para um produto
 * (estoque+processo agora, depois os baldes MA/PX/UL... do plano) e a fila de
 * pedidos pendentes daquele produto, decide quem é atendido com o quê.
 *
 * Critério de ordenação por cd_lote (formato AA.MM.N, ex. "26.11.2"), do lote
 * mais antigo para o mais novo — é o critério que o usuário descreveu ("lote de
 * pedido") e não depende de confirmar a direção de nr_prioridade (ainda em
 * aberto no plano). Pedidos com cd_lote em formato não reconhecido (legado tipo
 * "9.3") vão para o fim da fila, não para o início — não presumir prioridade do
 * que não se consegue datar.
 *
 * Padrão de alocação gulosa com transbordo espelha src/routes/capacidade.js
 * (~linha 3511-3561): fila ordenada consumindo oferta finita período a período,
 * sobra explícita em vez de escondida numa média.
 *
 * Fase 2 do plano de unificação plano/disponibilidade/atendimento — ver
 * C:\Users\ce_lu\.claude\plans\uma-grande-dificuldade-da-toasty-bentley.md
 */

const { PERIODOS_PLANO } = require("./periodoPlanoService");

const TABLE_NAME = "app_alocacao_pedidos";
const BALDE_HOJE = "HOJE";

/**
 * Estoque atual + em processo para UM produto. Deliberadamente não usa
 * buscarPlanejamentoProduto (que também calcula médias de venda e estoque
 * mínimo, irrelevantes aqui e responsáveis por boa parte do tempo de resposta
 * medido — ~40s para um produto só, por causa das subconsultas de vendas).
 */
async function buscarEstoqueDisponivelProduto(pool, cdProduto, cdEmpresa = 1) {
  // Sequencial, não em paralelo: convenção já estabelecida em producaoService.js
  // (buscarAgendaEstoque) porque o banco vive perto do teto de conexões.
  const estoqueResult = await pool.query(
    `SELECT f_dic_sld_prd_produto($1::TEXT, '1'::TEXT, $2::BIGINT, NULL::TIMESTAMP WITHOUT TIME ZONE) AS estoque`,
    [String(cdEmpresa), cdProduto]
  );
  const processoResult = await pool.query(
    `SELECT COALESCE(SUM(COALESCE(aa.qt_real, 0)::DOUBLE PRECISION - COALESCE(aa.qt_finalizada, 0)::DOUBLE PRECISION), 0) AS qt_em_processo
     FROM vr_pcp_opi aa
     JOIN vr_pcp_opc bb ON aa.cd_empresa = bb.cd_empresa AND aa.nr_ciclo = bb.nr_ciclo AND aa.nr_op = bb.nr_op
     WHERE aa.cd_empresa = $1
       AND aa.cd_produto = $2
       AND COALESCE(bb.cd_categoria, 0)::BIGINT <> 15
       AND aa.tp_situacao = ANY(ARRAY[5, 10, 15, 20]::BIGINT[])`,
    [cdEmpresa, cdProduto]
  );

  const estoqueAtual = parseFloat(estoqueResult.rows[0]?.estoque) || 0;
  const emProcesso = parseFloat(processoResult.rows[0]?.qt_em_processo) || 0;
  return estoqueAtual + emProcesso;
}

/**
 * "26.11.2" -> 261102 (ordenável). Formatos não reconhecidos retornam null.
 */
function parseLote(cdLote) {
  const m = /^(\d{2})\.(\d{2})\.(\d+)$/.exec(String(cdLote || "").trim());
  if (!m) return null;
  const [, aa, mm, seq] = m;
  return Number(aa) * 10000 + Number(mm) * 100 + Number(seq);
}

/**
 * Lote mais antigo primeiro. Sem lote reconhecido vai para o fim (não é
 * "atraso zero", é "não sabemos").
 */
function ordenarPedidosPorLote(pedidos) {
  return [...pedidos].sort((a, b) => {
    const chaveA = parseLote(a.cd_lote);
    const chaveB = parseLote(b.cd_lote);
    if (chaveA === null && chaveB === null) return 0;
    if (chaveA === null) return 1;
    if (chaveB === null) return -1;
    return chaveA - chaveB;
  });
}

/**
 * Oferta por período para UM produto: HOJE (estoque+em processo) seguido dos
 * baldes do plano (MA, PX, UL...) na mesma ordem de PERIODOS_PLANO. Mesma
 * fórmula de "plano" já usada na matriz oficial (qt_lote - qt_gerouop, nunca
 * negativo) — ver producaoService.js linha ~574.
 */
async function buscarOfertaPorPeriodo(pool, cdProduto, cdEmpresa = 1) {
  const estoqueDisponivel = await buscarEstoqueDisponivelProduto(pool, cdProduto, cdEmpresa);
  const planoResult = await pool.query(
    `SELECT p.cd_auxiliar,
            COALESCE(SUM(GREATEST(a.qt_lote - COALESCE(a.qt_gerouop, 0), 0)), 0)::FLOAT AS plano
     FROM vr_pcp_lotepl2 a
     LEFT JOIN pcp_lotepv p ON a.nr_lote = p.nr_lote
     WHERE p.tp_situacao = 1
       AND a.cd_produto = $1
       AND UPPER(TRIM(COALESCE(p.cd_auxiliar, ''))) = ANY($2::TEXT[])
     GROUP BY p.cd_auxiliar`,
    [cdProduto, PERIODOS_PLANO]
  );

  const porPeriodo = { [BALDE_HOJE]: estoqueDisponivel };
  for (const per of PERIODOS_PLANO) porPeriodo[per] = 0;
  for (const row of planoResult.rows) {
    const per = String(row.cd_auxiliar || "").trim().toUpperCase();
    if (per in porPeriodo) porPeriodo[per] = Number(row.plano || 0);
  }

  return { ofertaPorPeriodo: porPeriodo, estoqueDisponivel };
}

/**
 * Aloca pedidos (já no formato de pedidoItemService.buscarPedidosPorItem) contra
 * uma oferta finita por período, na ordem HOJE -> MA -> PX -> UL -> ...
 *
 * @param {Object} params
 * @param {Array} params.pedidos
 * @param {Object} params.ofertaPorPeriodo - { HOJE, MA, PX, UL, ... }
 * @param {string[]} [params.periodos] - ordem dos baldes a consumir
 */
function alocarPedidos({ pedidos, ofertaPorPeriodo, periodos = [BALDE_HOJE, ...PERIODOS_PLANO] }) {
  const ordenados = ordenarPedidosPorLote(pedidos);
  const saldoPorPeriodo = new Map(periodos.map((p) => [p, Math.max(0, Number(ofertaPorPeriodo[p] || 0))]));

  const itens = ordenados.map((pedido) => {
    let resta = Math.max(0, Number(pedido.qt_pendente || 0));
    const alocadoPorPeriodo = {};
    for (const per of periodos) {
      if (resta <= 0.0001) break;
      const disponivel = saldoPorPeriodo.get(per) || 0;
      if (disponivel <= 0) continue;
      const cabe = Math.min(resta, disponivel);
      saldoPorPeriodo.set(per, disponivel - cabe);
      alocadoPorPeriodo[per] = cabe;
      resta -= cabe;
    }
    const qtdAlocada = Object.values(alocadoPorPeriodo).reduce((a, b) => a + b, 0);
    return {
      cd_pedido: pedido.cd_pedido,
      cd_produto: pedido.cd_produto,
      cd_cliente: pedido.cd_cliente,
      cd_lote: pedido.cd_lote,
      qt_pendente: pedido.qt_pendente,
      alocadoPorPeriodo,
      qtd_alocada: qtdAlocada,
      qtd_nao_atendida: Math.max(0, resta),
    };
  });

  return {
    itens,
    saldoRestantePorPeriodo: Object.fromEntries(saldoPorPeriodo),
  };
}

async function ensureAlocacaoTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id            TEXT PRIMARY KEY,
      calculado_em  BIGINT NOT NULL,
      cd_empresa    BIGINT NOT NULL,
      cd_produto    BIGINT NOT NULL,
      cd_pedido     BIGINT NOT NULL,
      criterio      TEXT NOT NULL,
      payload       TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_produto
    ON ${TABLE_NAME} (cd_produto, calculado_em)
  `);
}

/**
 * Roda a alocação para um produto (busca oferta + pedidos de quem chamou, aloca,
 * e persiste a rodada em app_alocacao_pedidos para auditoria/Fase 4).
 */
async function alocarEPersistirProduto(pool, { cdProduto, cdEmpresa = 1, pedidos, criterio = "cd_lote" }) {
  const { ofertaPorPeriodo } = await buscarOfertaPorPeriodo(pool, cdProduto, cdEmpresa);
  const resultado = alocarPedidos({ pedidos, ofertaPorPeriodo });

  await ensureAlocacaoTable(pool);
  const calculadoEm = Date.now();
  if (resultado.itens.length) {
    const flatValues = [];
    const rows = resultado.itens.map((item, idx) => {
      const id = `${calculadoEm}-${cdEmpresa}-${cdProduto}-${item.cd_pedido}`;
      flatValues.push(id, calculadoEm, cdEmpresa, cdProduto, item.cd_pedido, criterio, JSON.stringify(item));
      const base = idx * 7;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });
    await pool.query(
      `INSERT INTO ${TABLE_NAME} (id, calculado_em, cd_empresa, cd_produto, cd_pedido, criterio, payload)
       VALUES ${rows.join(", ")}
       ON CONFLICT (id) DO NOTHING`,
      flatValues
    );
  }

  return { ...resultado, ofertaPorPeriodo, calculadoEm, criterio };
}

module.exports = {
  parseLote,
  ordenarPedidosPorLote,
  buscarOfertaPorPeriodo,
  alocarPedidos,
  alocarEPersistirProduto,
  ensureAlocacaoTable,
  BALDE_HOJE,
};
