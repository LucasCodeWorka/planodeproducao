/**
 * Pedido por item: abre "pedidos pendentes" de agregado-por-produto (como hoje é
 * consumido em producaoService.buscarPedidosPendentes) para linha-por-pedido, com
 * cd_lote e cd_cliente preservados.
 *
 * Fase 0 do plano de unificação plano/disponibilidade/atendimento — ver
 * C:\Users\ce_lu\.claude\plans\uma-grande-dificuldade-da-toasty-bentley.md
 */

const TABLE_NAME = "app_pedido_item_snapshot";

async function ensurePedidoItemSnapshotTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id            TEXT PRIMARY KEY,
      capturado_em  BIGINT NOT NULL,
      cd_empresa    BIGINT NOT NULL,
      cd_pedido     BIGINT NOT NULL,
      cd_produto    BIGINT NOT NULL,
      payload       TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_produto
    ON ${TABLE_NAME} (cd_produto, capturado_em)
  `);
}

/**
 * Busca pedidos pendentes linha a linha (sem SUM/GROUP BY), preservando
 * cd_pedido, cd_cliente e cd_lote. Mesmo filtro usado hoje em
 * producaoService.buscarPedidosPendentes (cd_operacao<>44, tp_situacao<>6).
 *
 * `vr_ped_pedidoi` sem nenhum filtro de produto/pedido tem 7,3 milhões de linhas
 * (medido em 2026-11-13) — cdProduto ou cdPedido é obrigatório, não opcional, para
 * não tentar puxar a view inteira e estourar o pool de conexões do banco.
 *
 * @param {Object} pool
 * @param {Object} opts
 * @param {number} [opts.cdEmpresa=1]
 * @param {Array<number|string>} [opts.cdProduto]
 * @param {Array<number|string>} [opts.cdPedido]
 * @returns {Promise<Array>}
 */
async function buscarPedidosPorItem(pool, { cdEmpresa = 1, cdProduto, cdPedido } = {}) {
  const temProduto = Array.isArray(cdProduto) && cdProduto.length;
  const temPedido = Array.isArray(cdPedido) && cdPedido.length;
  if (!temProduto && !temPedido) {
    throw new Error("buscarPedidosPorItem exige cdProduto ou cdPedido (vr_ped_pedidoi tem 7,3M de linhas sem filtro)");
  }

  const params = [cdEmpresa];
  let filtros = "";
  if (temProduto) {
    params.push(cdProduto.map(String));
    filtros += ` AND p.cd_produto = ANY($${params.length}::BIGINT[])`;
  }
  if (temPedido) {
    params.push(cdPedido.map(String));
    filtros += ` AND p.cd_pedido = ANY($${params.length}::BIGINT[])`;
  }

  const result = await pool.query(
    `SELECT
       p.cd_empresa::BIGINT      AS cd_empresa,
       p.cd_pedido::BIGINT       AS cd_pedido,
       p.cd_produto::BIGINT      AS cd_produto,
       p.cd_cliente::BIGINT      AS cd_cliente,
       p.cd_representant::BIGINT AS cd_representant,
       TRIM(p.cd_lote)           AS cd_lote,
       p.dt_pedido               AS dt_pedido,
       p.dt_prevbaixa            AS dt_prevbaixa,
       p.dt_limbaixa             AS dt_limbaixa,
       p.qt_solicitada::FLOAT    AS qt_solicitada,
       p.qt_atendida::FLOAT      AS qt_atendida,
       p.qt_baixa::FLOAT         AS qt_baixa,
       p.qt_pendente::FLOAT      AS qt_pendente,
       p.tp_situacao::BIGINT     AS tp_situacao
     FROM vr_ped_pedidoi p
     WHERE p.cd_empresa = $1
       AND p.cd_operacao <> 44
       AND p.tp_situacao <> 6
       ${filtros}
     ORDER BY p.cd_produto, p.dt_pedido`,
    params
  );

  return result.rows;
}

/**
 * Persiste um snapshot dos itens de pedido (histórico para causa-raiz de negativo,
 * Fase 3). Append-only: cada chamada grava uma nova leva com capturado_em próprio,
 * nunca sobrescreve a anterior.
 *
 * @param {Object} pool
 * @param {Array} itens - resultado de buscarPedidosPorItem
 * @returns {Promise<{capturadoEm: number, total: number}>}
 */
async function salvarSnapshotPedidosItem(pool, itens) {
  await ensurePedidoItemSnapshotTable(pool);
  const capturadoEm = Date.now();
  if (!itens.length) return { capturadoEm, total: 0 };

  const flatValues = [];
  const rows = itens.map((item, idx) => {
    const id = `${capturadoEm}-${item.cd_empresa}-${item.cd_pedido}-${item.cd_produto}`;
    flatValues.push(id, capturadoEm, item.cd_empresa, item.cd_pedido, item.cd_produto, JSON.stringify(item));
    const base = idx * 6;
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
  });

  await pool.query(
    `INSERT INTO ${TABLE_NAME} (id, capturado_em, cd_empresa, cd_pedido, cd_produto, payload)
     VALUES ${rows.join(", ")}
     ON CONFLICT (id) DO NOTHING`,
    flatValues
  );

  return { capturadoEm, total: itens.length };
}

module.exports = {
  buscarPedidosPorItem,
  salvarSnapshotPedidosItem,
  ensurePedidoItemSnapshotTable,
};
