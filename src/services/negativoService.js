/**
 * Causa-raiz de negativo: porta para o backend o `calcularDisp` que hoje só
 * existe client-side em frontend/app/recuperar-negativos/page.tsx (linhas
 * ~199-214), e persiste o resultado — hoje aquela tela calcula tudo sob
 * demanda, sem rastro de quando um produto ficou negativo nem por quê.
 *
 * Simplificação assumida e documentada (não escondida): o fator de "quanto
 * falta do mês corrente ainda vai vender" aqui é só calendário
 * (dia restante / dias do mês). A tela `/` (page.tsx) registra, antes de
 * calcular, uma curva MEDIDA de venda diária (`definirFatorMesRestante`,
 * alimentada por `/api/producao/vendas-mes-atual`), que a tela
 * `/recuperar-negativos` NUNCA registra — ou seja, mesmo ao vivo, essa tela
 * só usa a curva medida se o usuário chegou nela clicando a partir da `/`
 * (o registro fica em memória do módulo JS do browser entre navegações
 * client-side) e usa o calendário puro se carregada direto. Este serviço
 * replica o comportamento de carregamento direto. Se o usuário quiser os dois
 * caminhos batendo sempre, o jeito correto é fazer `/recuperar-negativos`
 * também registrar a curva medida — não replicar a inconsistência aqui.
 *
 * Causa-raiz nesta primeira versão cobre só o que já estava pronto nas Fases
 * 0-2 (pedido por item, oferta por período) mais uma consulta leve de OP
 * atrasada. NÃO cobre ainda ESTOQUE_MINIMO_SUBESTIMADO (exigiria portar
 * curva ABC + cálculo de estoque mínimo com o mesmo rigor que este arquivo
 * já teve que ter para `calcularDisp` — ver estoqueMinimo.js e
 * curvaAbcService.js, fora do escopo desta rodada).
 *
 * Fase 3 do plano de unificação plano/disponibilidade/atendimento — ver
 * C:\Users\ce_lu\.claude\plans\uma-grande-dificuldade-da-toasty-bentley.md
 */

const { calcularPeriodosPlano } = require("./periodoPlanoService");
const { buscarPedidosPendentes } = require("./producaoService");
const { buscarOfertaPorPeriodo, BALDE_HOJE } = require("./alocacaoPedidosService");
const { buscarPedidosPorItem } = require("./pedidoItemService");

// Mesmo recorte de frontend/app/recuperar-negativos/page.tsx (const PERIODOS) —
// a tela de recuperação só olha 6 meses à frente, não os 14 da matriz completa.
const PERIODOS_NEGATIVO = ["MA", "PX", "UL", "QT", "QU", "SX"];

const TABLE_NAME = "app_negativo_causa";

/** Fração do mês corrente que ainda falta vender, só pelo calendário (ver nota acima). */
function fatorMesAtualRestanteCalendario(mes, refDate = new Date()) {
  const mesAtual = refDate.getMonth() + 1;
  if (mes !== mesAtual) return 1;
  const diasNoMes = new Date(refDate.getFullYear(), mesAtual, 0).getDate();
  const diaAtual = Math.min(refDate.getDate(), diasNoMes);
  return diasNoMes > 0 ? Math.max(0, Math.min(1, (diasNoMes - diaAtual) / diasNoMes)) : 0;
}

/**
 * Projeção de venda por mês para UM produto, direto de app_projecoes (ano
 * corrente e seguinte, ano maior sobrescreve — mesma regra de
 * projecoesService.lerProjecoesMultiplosAnos). Deliberadamente NÃO usa
 * routes/projecoes.js#montarProjecoesEfetivas: aquela função monta de-para
 * para o catálogo inteiro antes de filtrar, e medido em 2026-11-13 levou
 * mais de 60s para devolver o dado de um produto só. Essa troca significa que
 * projeção vinda só de de-para de referência (sem projeção própria) não
 * aparece aqui — caso raro, documentado, não escondido.
 */
async function buscarProjecaoProduto(pool, idproduto) {
  const anoAtual = new Date().getFullYear();
  const { rows } = await pool.query(
    `SELECT mes, ano, quantidade FROM app_projecoes
     WHERE idproduto = $1 AND ano = ANY($2::INTEGER[])
     ORDER BY ano ASC`,
    [String(idproduto), [anoAtual, anoAtual + 1]]
  );
  const proj = {};
  for (const row of rows) proj[String(row.mes)] = Number(row.quantidade); // ano maior sobrescreve, ORDER BY garante
  return proj;
}

/**
 * Saldo projetado período a período, igual a calcularDisp do frontend:
 * saldo = (estoque_disponivel - pedidos_pendentes); a cada período,
 * saldo += plano[periodo] - projecao_do_mes.
 */
async function calcularSaldoProjetado(pool, idproduto, cdEmpresa = 1) {
  const { meses } = calcularPeriodosPlano();
  const { ofertaPorPeriodo, estoqueDisponivel } = await buscarOfertaPorPeriodo(pool, idproduto, cdEmpresa);
  const pedidosPendentes = await buscarPedidosPendentes(pool, idproduto, cdEmpresa);
  const proj = await buscarProjecaoProduto(pool, idproduto);

  let saldo = estoqueDisponivel - pedidosPendentes;
  const porPeriodo = {};
  for (const periodo of PERIODOS_NEGATIVO) {
    const mes = meses[periodo];
    const projBruta = Number(proj[String(mes)] || 0);
    const projMes = periodo === "MA" ? projBruta * fatorMesAtualRestanteCalendario(mes) : projBruta;
    const plano = Number(ofertaPorPeriodo[periodo] || 0);
    saldo = saldo + plano - projMes;
    porPeriodo[periodo] = { mes, plano, projecao: projMes, saldo, negativo: Math.max(0, -saldo) };
  }
  return { porPeriodo, estoqueDisponivel, pedidosPendentes, ofertaHoje: ofertaPorPeriodo[BALDE_HOJE] };
}

/**
 * Classifica a causa provável de um período negativo. Ordem de checagem
 * importa: OP atrasada e pedido concentrado são explicações mais específicas
 * que o fallback genérico.
 */
async function classificarCausa(pool, idproduto, cdEmpresa, periodo, dadosPeriodo) {
  const opAtrasadaResult = await pool.query(
    `SELECT COALESCE(SUM(GREATEST(COALESCE(aa.qt_real,0) - COALESCE(aa.qt_finalizada,0), 0)), 0)::FLOAT AS qtd_vencida
     FROM vr_pcp_opi aa
     JOIN vr_pcp_opc bb ON aa.cd_empresa = bb.cd_empresa AND aa.nr_ciclo = bb.nr_ciclo AND aa.nr_op = bb.nr_op
     WHERE aa.cd_empresa = $1
       AND aa.cd_produto = $2
       AND COALESCE(bb.cd_categoria, 0)::BIGINT <> 15
       AND aa.tp_situacao = ANY(ARRAY[5,10,15,20]::BIGINT[])
       AND bb.dt_preventrega < DATE_TRUNC('month', CURRENT_DATE)`,
    [cdEmpresa, idproduto]
  );
  const qtdVencida = Number(opAtrasadaResult.rows[0]?.qtd_vencida || 0);
  if (qtdVencida > 0) {
    return { categoria: "OP_ATRASADA", detalhe: { qtd_vencida: qtdVencida } };
  }

  const pedidos = await buscarPedidosPorItem(pool, { cdEmpresa, cdProduto: [idproduto] });
  const totalPendente = pedidos.reduce((s, p) => s + Number(p.qt_pendente || 0), 0);
  if (totalPendente > 0) {
    const maior = pedidos.reduce((max, p) => (Number(p.qt_pendente || 0) > Number(max?.qt_pendente || 0) ? p : max), null);
    const fatia = maior ? Number(maior.qt_pendente || 0) / totalPendente : 0;
    if (fatia >= 0.5) {
      return {
        categoria: "PEDIDO_CONCENTRADO_SEM_LASTRO",
        detalhe: { cd_pedido: maior.cd_pedido, cd_cliente: maior.cd_cliente, qt_pendente: maior.qt_pendente, fatia_do_total: Number(fatia.toFixed(3)) },
      };
    }
  }

  return {
    categoria: "PLANO_INSUFICIENTE",
    detalhe: { plano_do_periodo: dadosPeriodo.plano, projecao_do_periodo: dadosPeriodo.projecao },
  };
}

async function ensureNegativoCausaTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id            TEXT PRIMARY KEY,
      calculado_em  BIGINT NOT NULL,
      cd_empresa    BIGINT NOT NULL,
      cd_produto    BIGINT NOT NULL,
      periodo       TEXT NOT NULL,
      saldo         FLOAT NOT NULL,
      negativo      FLOAT NOT NULL,
      categoria     TEXT NOT NULL,
      detalhe       TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_produto
    ON ${TABLE_NAME} (cd_produto, calculado_em)
  `);
}

/**
 * Roda o cálculo completo para um produto: saldo projetado, detecta períodos
 * negativos, classifica causa e persiste. Sempre persiste (mesmo sem
 * negativo), para dar histórico de "desde quando" também no caso OK.
 */
async function calcularEPersistirNegativo(pool, idproduto, cdEmpresa = 1) {
  const { porPeriodo, estoqueDisponivel, pedidosPendentes, ofertaHoje } = await calcularSaldoProjetado(pool, idproduto, cdEmpresa);

  const causas = {};
  for (const periodo of PERIODOS_NEGATIVO) {
    const dadosPeriodo = porPeriodo[periodo];
    if (dadosPeriodo.negativo > 0) {
      causas[periodo] = await classificarCausa(pool, idproduto, cdEmpresa, periodo, dadosPeriodo);
    }
  }

  await ensureNegativoCausaTable(pool);
  const calculadoEm = Date.now();
  const periodosComDado = PERIODOS_NEGATIVO.filter((p) => porPeriodo[p]);
  if (periodosComDado.length) {
    const flatValues = [];
    const rows = periodosComDado.map((periodo, idx) => {
      const dadosPeriodo = porPeriodo[periodo];
      const causa = causas[periodo] || { categoria: "SEM_NEGATIVO", detalhe: {} };
      const id = `${calculadoEm}-${cdEmpresa}-${idproduto}-${periodo}`;
      flatValues.push(
        id, calculadoEm, cdEmpresa, idproduto, periodo,
        dadosPeriodo.saldo, dadosPeriodo.negativo, causa.categoria, JSON.stringify(causa.detalhe)
      );
      const base = idx * 9;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
    });
    await pool.query(
      `INSERT INTO ${TABLE_NAME} (id, calculado_em, cd_empresa, cd_produto, periodo, saldo, negativo, categoria, detalhe)
       VALUES ${rows.join(", ")}
       ON CONFLICT (id) DO NOTHING`,
      flatValues
    );
  }

  return { porPeriodo, causas, estoqueDisponivel, pedidosPendentes, ofertaHoje, calculadoEm };
}

module.exports = {
  calcularSaldoProjetado,
  calcularEPersistirNegativo,
  classificarCausa,
  ensureNegativoCausaTable,
  PERIODOS_NEGATIVO,
};
