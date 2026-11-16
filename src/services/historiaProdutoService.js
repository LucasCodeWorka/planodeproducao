/**
 * História do produto: junta num só lugar o que as Fases 0-3 já calculam
 * separadamente — plano (oferta por período), produção (OPs abertas e sua
 * data prevista), pedidos na fila (por item, com lote) e saldo/causa de
 * negativo — para uma linha do tempo por SKU.
 *
 * Fase 4 do plano de unificação plano/disponibilidade/atendimento — ver
 * C:\Users\ce_lu\.claude\plans\uma-grande-dificuldade-da-toasty-bentley.md
 */

const { buscarOfertaPorPeriodo, alocarPedidos, BALDE_HOJE } = require("./alocacaoPedidosService");
const { buscarPedidosPorItem } = require("./pedidoItemService");
const { calcularSaldoProjetado, classificarCausa, PERIODOS_NEGATIVO } = require("./negativoService");

/**
 * OPs abertas deste produto, com data prevista de entrega — o elo
 * "plano -> produção" que a linha do tempo precisa. Vencida = data prevista
 * já passou o mês corrente e ainda tem quantidade em aberto.
 */
async function buscarOpsAbertasProduto(pool, cdProduto, cdEmpresa = 1) {
  const { rows } = await pool.query(
    `SELECT aa.nr_op::TEXT AS nr_op, aa.nr_ciclo::TEXT AS nr_ciclo,
            bb.dt_preventrega, bb.dt_inclusao,
            GREATEST(COALESCE(aa.qt_real, 0) - COALESCE(aa.qt_finalizada, 0), 0)::FLOAT AS qt_aberta
     FROM vr_pcp_opi aa
     JOIN vr_pcp_opc bb ON aa.cd_empresa = bb.cd_empresa AND aa.nr_ciclo = bb.nr_ciclo AND aa.nr_op = bb.nr_op
     WHERE aa.cd_empresa = $1
       AND aa.cd_produto = $2
       AND COALESCE(bb.cd_categoria, 0)::BIGINT <> 15
       AND aa.tp_situacao = ANY(ARRAY[5, 10, 15, 20]::BIGINT[])
       AND (COALESCE(aa.qt_real, 0) - COALESCE(aa.qt_finalizada, 0)) > 0
     ORDER BY bb.dt_preventrega NULLS LAST`,
    [cdEmpresa, cdProduto]
  );
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  return rows.map((row) => ({
    ...row,
    vencida: row.dt_preventrega ? new Date(row.dt_preventrega) < inicioMes : false,
  }));
}

/**
 * Monta a história completa de um SKU: oferta por período, OPs abertas,
 * pedidos na fila (alocados ou não, por cd_lote) e saldo/causa de negativo.
 * Só leitura — não persiste nada aqui (a persistência de alocação e causa já
 * acontece nos próprios endpoints de Fase 2/3, se chamados).
 */
async function buscarHistoriaProduto(pool, idproduto, cdEmpresa = 1) {
  const { ofertaPorPeriodo, estoqueDisponivel } = await buscarOfertaPorPeriodo(pool, idproduto, cdEmpresa);
  const ops = await buscarOpsAbertasProduto(pool, idproduto, cdEmpresa);
  const pedidos = await buscarPedidosPorItem(pool, { cdEmpresa, cdProduto: [idproduto] });
  const pendentes = pedidos.filter((p) => Number(p.qt_pendente || 0) > 0);
  const alocacao = alocarPedidos({ pedidos: pendentes, ofertaPorPeriodo });

  const { porPeriodo } = await calcularSaldoProjetado(pool, idproduto, cdEmpresa);
  const causas = {};
  for (const periodo of PERIODOS_NEGATIVO) {
    const dadosPeriodo = porPeriodo[periodo];
    if (dadosPeriodo?.negativo > 0) {
      causas[periodo] = await classificarCausa(pool, idproduto, cdEmpresa, periodo, dadosPeriodo);
    }
  }

  return {
    estoqueDisponivel,
    ofertaPorPeriodo,
    ops: {
      itens: ops,
      totalAberto: ops.reduce((s, o) => s + o.qt_aberta, 0),
      totalVencido: ops.filter((o) => o.vencida).reduce((s, o) => s + o.qt_aberta, 0),
    },
    pedidos: {
      total: pedidos.length,
      pendentes: pendentes.length,
      qtdPendenteTotal: pendentes.reduce((s, p) => s + Number(p.qt_pendente || 0), 0),
      itens: alocacao.itens,
    },
    saldoProjetado: porPeriodo,
    causas,
  };
}

module.exports = { buscarHistoriaProduto, buscarOpsAbertasProduto };
