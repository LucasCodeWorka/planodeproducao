// LABORATORIO DE CAPACIDADE
//
// Aba de investigacao, separada das telas de operacao. Aqui nada e decidido nem gravado:
// medimos, discutimos e registramos a conclusao em `docs/analise-capacidade/conclusoes.md`.
//
// Principio que guia o laboratorio (definido com o PCP em 17/11/2026):
//   - CAPACIDADE e fato: o que a fabrica demonstrou fazer, medido no ERP, sem olhar o plano.
//   - PLANO e necessidade: o que o negocio precisa fabricar, e em que periodo.
//   - O GAP entre os dois e o que se discute — nao se ajusta um para caber no outro.
//
// A unidade de comparacao e o MINUTO PADRAO. Peca nao serve: um sutia custa ~2,4x uma
// calca, e comparar em pecas esconde exatamente a troca de mix que queremos enxergar.

const express = require('express');
const fs = require('fs');
const path = require('path');
const { calcularPeriodosPlano, PERIODOS_PLANO } = require('../services/periodoPlanoService');
const { diasDisponiveisDaData } = require('../lib/diasUteis');
const capacidade = require('./capacidade');

const {
  auth,
  queryTempoBaseRows,
  resolveTempoLikePowerBi,
  familiaDoProduto,
  chaveDaLinha,
  lerSimulacoesDoLote,
  DEFAULT_REAL_GROUP_IDS,
  readGrupos,
  capacidadeMensal,
} = capacidade.helpers;

const router = express.Router();

const CONCLUSOES_PATH = path.join(__dirname, '../../docs/analise-capacidade/conclusoes.md');
const SEM_FAMILIA = 'FORA DA MATRIZ';

const cache = { chave: '', data: null, timestamp: 0 };
const TTL = 30 * 60 * 1000;

const mesIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * GET /api/analise-capacidade/especializacao?meses=6&lote_id=
 *
 * Analise 1 — PERFIL DE ESPECIALIZACAO EM MINUTOS.
 *
 * Responde: a fabrica, do jeito que esta montada hoje, entrega os minutos que o plano
 * pede de cada familia? Tres blocos, todos em minuto padrao:
 *
 *   1. Produzido: grupo de costura x familia x mes, nos meses FECHADOS.
 *      pecas finalizadas (vr_cdf_movopi, tp 51, sem estorno, so as celulas) x tempo padrao.
 *   2. Medido: minutos de `pcp_cache_eficiencia_dia` por celula e mes. Serve de prova do
 *      bloco 1 — se o minuto padrao calculado nao bater com o medido, a premissa de tempo
 *      esta errada e nada do resto vale.
 *   3. Plano: minutos por familia e periodo, mesma base e filtros das outras telas.
 *      O EM PROCESSO sai separado, sem periodo: ele e carga, mas dizer em que mes cai e
 *      uma premissa, e aqui nao queremos premissa escondida.
 *
 * O que esta analise NAO responde: se um grupo e capaz de costurar o que nunca costurou.
 * Historico e aptidao demonstrada, nao aptidao total.
 */
router.get('/especializacao', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    if (!pool) return res.status(500).json({ success: false, error: 'Pool de conexão não disponível' });
    const meses = Math.min(12, Math.max(1, Number(req.query.meses) || 6));
    const loteId = String(req.query.lote_id || '').trim();
    const chave = `${meses}|${loteId}`;
    if (req.query.refresh !== 'true' && cache.data && cache.chave === chave && Date.now() - cache.timestamp < TTL) {
      return res.json({ ...cache.data, fromCache: true });
    }

    const hoje = new Date();
    const ids = DEFAULT_REAL_GROUP_IDS.map(String);
    const { readCache } = require('../cache/matrizCache');

    // ── Meses fechados da janela ────────────────────────────────────────────────
    const mesesJanela = [];
    for (let i = meses; i >= 1; i -= 1) mesesJanela.push(mesIso(new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)));

    const [producao, medido, locais, temposResult, matrizCache] = await Promise.all([
      pool.query(`
        SELECT TO_CHAR(DATE_TRUNC('month', m.dt_movimento), 'YYYY-MM') AS mes,
               m.cd_localorigem::text AS cd_local,
               UPPER(TRIM(COALESCE(f_dic_prd_nivel(m.cd_produto, 'CD'::bpchar), '')))::text AS referencia,
               SUM(COALESCE(m.qt_movimento, 0))::float AS pecas
          FROM vr_cdf_movopi m
         WHERE m.tp_historicomov = 51
           AND m.in_estorno = 'F'
           AND m.cd_localorigem::text = ANY($1::text[])
           AND m.dt_movimento >= DATE_TRUNC('month', CURRENT_DATE - ($2::int || ' months')::interval)::date
           AND m.dt_movimento <  DATE_TRUNC('month', CURRENT_DATE)::date
         GROUP BY 1, 2, 3`, [ids, meses]),
      pool.query(`
        SELECT TO_CHAR(DATE_TRUNC('month', e.dt_ref), 'YYYY-MM') AS mes,
               e.cd_grupo::text AS cd_local,
               SUM(COALESCE(e.tempo_produzido_min, 0))::float AS minutos,
               COUNT(DISTINCT e.dt_ref) FILTER (WHERE COALESCE(e.tempo_produzido_min, 0) > 0)::int AS dias
          FROM pcp_cache_eficiencia_dia e
         WHERE e.cd_grupo::text = ANY($1::text[])
           AND e.dt_ref >= DATE_TRUNC('month', CURRENT_DATE - ($2::int || ' months')::interval)::date
           AND e.dt_ref <  DATE_TRUNC('month', CURRENT_DATE)::date
         GROUP BY 1, 2`, [ids, meses]),
      pool.query(`SELECT cd_local::text AS cd_local, UPPER(TRIM(ds_local::text)) AS ds_local
                    FROM pcp_cache_locais WHERE cd_local::text = ANY($1::text[])`, [ids]),
      queryTempoBaseRows(pool, {}),
      readCache(),
    ]);

    // Dias da FABRICA com producao, por mes: um dia conta se qualquer celula produziu.
    const diasFabrica = await pool.query(`
      SELECT TO_CHAR(DATE_TRUNC('month', e.dt_ref), 'YYYY-MM') AS mes,
             COUNT(DISTINCT e.dt_ref)::int AS dias
        FROM pcp_cache_eficiencia_dia e
       WHERE e.cd_grupo::text = ANY($1::text[])
         AND COALESCE(e.tempo_produzido_min, 0) > 0
         AND e.dt_ref >= DATE_TRUNC('month', CURRENT_DATE - ($2::int || ' months')::interval)::date
         AND e.dt_ref <  DATE_TRUNC('month', CURRENT_DATE)::date
       GROUP BY 1`, [ids, meses]);
    const diasPorMes = Object.fromEntries(diasFabrica.rows.map((r) => [r.mes, Number(r.dias || 0)]));

    // Celula ATIVA = a que o cadastro de capacidade ainda considera (readGrupos descarta as
    // desativadas). O historico inclui celulas que ja fecharam, e a capacidade que elas
    // tinham NAO esta mais disponivel — misturar as duas superestima a fabrica de hoje.
    const ativas = new Set((await readGrupos(pool)).map((g) => String(g.grupo || '').trim().toUpperCase()));
    const nomeDoLocal = new Map(locais.rows.map((r) => [r.cd_local, r.ds_local]));
    const nomeCelula = (cd) => nomeDoLocal.get(cd) || cd;

    // ── Tempo padrao por referencia ─────────────────────────────────────────────
    // O tempo e somado por `cd_seqgrupo` (a sequencia de operacoes). Uma referencia pode
    // ter mais de uma sequencia; ficamos com a MAIOR, em vez de somar e dobrar o tempo.
    const tempoPorId = new Map();
    const refDoId = new Map();
    for (const row of temposResult.rows || []) {
      const id = String(row.idreferencia || '').trim().toUpperCase();
      if (!id) continue;
      const base = resolveTempoLikePowerBi(row.hr_tempo, row.hr_tempopadrao);
      tempoPorId.set(id, (tempoPorId.get(id) || 0) + (Number.isFinite(base) ? base : 0));
      const ref = String(row.referencia_padrao || '').trim().toUpperCase();
      if (ref) refDoId.set(id, ref);
    }
    const tempoPorRefPadrao = new Map();
    for (const [id, tempo] of tempoPorId) {
      const ref = refDoId.get(id);
      if (!ref) continue;
      if (tempo > (tempoPorRefPadrao.get(ref) || 0)) tempoPorRefPadrao.set(ref, tempo);
    }

    // ── Matriz: familia, tempo e plano ──────────────────────────────────────────
    const matrizRows = Array.isArray(matrizCache?.data?.rows) ? matrizCache.data.rows : [];
    const planosSimulados = new Map();
    if (loteId) {
      for (const s of await lerSimulacoesDoLote(pool, loteId)) {
        for (const p of s.parametros.planos) {
          const k = String(p?.chave || '').trim();
          if (k) planosSimulados.set(k, p);
        }
      }
    }

    const familiaPorRef = new Map();
    const tempoMatrizPorRef = new Map();
    for (const item of matrizRows) {
      const ref = String(item?.produto?.referencia || '').trim().toUpperCase();
      if (!ref || familiaPorRef.has(ref)) continue;
      familiaPorRef.set(ref, familiaDoProduto(item?.produto));
      const id = String(item?.produto?.cd_seqgrupo || '').trim().toUpperCase();
      const t = Number(tempoPorId.get(id) || 0);
      if (t > 0) tempoMatrizPorRef.set(ref, t);
    }
    // Mesmo tempo que as outras telas usam quando a referencia esta na matriz; o da
    // referencia padrao so cobre quem saiu dela.
    const tempoDaRef = (ref) => tempoMatrizPorRef.get(ref) || tempoPorRefPadrao.get(ref) || 0;

    const periodos = calcularPeriodosPlano(hoje);
    const zeroPeriodos = () => Object.fromEntries(PERIODOS_PLANO.map((p) => [p, { pecas: 0, minutos: 0 }]));
    const planoPorFamilia = new Map();
    const processoPorFamilia = new Map();
    const processoPorRef = new Map();
    let planoSemTempoPecas = 0;
    for (const item of matrizRows) {
      const produto = item?.produto || {};
      const marca = String(produto.marca || '').trim().toUpperCase();
      const status = String(produto.status || '').trim().toUpperCase();
      const descricao = String(produto.produto || '').trim().toUpperCase();
      if (marca !== 'LIEBE') continue;
      if (!['EM LINHA', 'NOVA COLECAO'].includes(status)) continue;
      if (descricao.includes('MEIA DE SEDA')) continue;
      const ref = String(produto.referencia || '').trim().toUpperCase();
      if (!ref) continue;
      const familia = familiaDoProduto(produto);
      const tempo = tempoDaRef(ref);
      const fonte = planosSimulados.get(chaveDaLinha(item)) || item?.plano || {};
      if (!planoPorFamilia.has(familia)) planoPorFamilia.set(familia, zeroPeriodos());
      const alvo = planoPorFamilia.get(familia);
      for (const per of PERIODOS_PLANO) {
        const pecas = Number(fonte[per.toLowerCase()] || 0);
        if (!pecas) continue;
        alvo[per].pecas += pecas;
        alvo[per].minutos += pecas * tempo;
        if (!(tempo > 0)) planoSemTempoPecas += pecas;
      }
      // Em processo e por SKU na matriz; somado por referencia uma vez so.
      processoPorRef.set(ref, { familia, pecas: (processoPorRef.get(ref)?.pecas || 0) + Number(item?.estoques?.em_processo || 0) });
    }
    for (const [ref, { familia, pecas }] of processoPorRef) {
      if (!(pecas > 0)) continue;
      const atual = processoPorFamilia.get(familia) || { pecas: 0, minutos: 0 };
      atual.pecas += pecas;
      atual.minutos += pecas * tempoDaRef(ref);
      processoPorFamilia.set(familia, atual);
    }

    // ── Producao realizada: celula x familia x mes ─────────────────────────────
    const celulas = new Map(); // nome -> { porMes: {mes: {pecas, minPadrao}}, porFamilia: {fam: {pecas, minutos}} }
    const familiasProd = new Map(); // fam -> { porMes: {mes: {pecas, minutos}} }
    let pecasSemTempo = 0;
    let pecasTotal = 0;
    const doCelula = (nome) => {
      if (!celulas.has(nome)) celulas.set(nome, { porMes: {}, porFamilia: {}, medido: {} });
      return celulas.get(nome);
    };
    for (const row of producao.rows) {
      const pecas = Number(row.pecas || 0);
      if (!(pecas > 0) || !row.referencia) continue;
      const familia = familiaPorRef.get(row.referencia) || SEM_FAMILIA;
      const tempo = tempoDaRef(row.referencia);
      const minutos = pecas * tempo;
      pecasTotal += pecas;
      if (!(tempo > 0)) pecasSemTempo += pecas;

      const c = doCelula(nomeCelula(row.cd_local));
      c.porMes[row.mes] = c.porMes[row.mes] || { pecas: 0, minPadrao: 0 };
      c.porMes[row.mes].pecas += pecas;
      c.porMes[row.mes].minPadrao += minutos;
      c.porFamilia[familia] = c.porFamilia[familia] || { pecas: 0, minutos: 0 };
      c.porFamilia[familia].pecas += pecas;
      c.porFamilia[familia].minutos += minutos;

      if (!familiasProd.has(familia)) familiasProd.set(familia, { porMes: {} });
      const f = familiasProd.get(familia);
      f.porMes[row.mes] = f.porMes[row.mes] || { pecas: 0, minutos: 0 };
      f.porMes[row.mes].pecas += pecas;
      f.porMes[row.mes].minutos += minutos;
    }
    for (const row of medido.rows) {
      const c = doCelula(nomeCelula(row.cd_local));
      c.medido[row.mes] = { minutos: Number(row.minutos || 0), dias: Number(row.dias || 0) };
    }

    // ── Montagem ────────────────────────────────────────────────────────────────
    const r1 = (v) => Math.round(Number(v || 0));
    const diasJanela = mesesJanela.reduce((s, m) => s + (diasPorMes[m] || 0), 0);

    const listaCelulas = [...celulas.entries()].map(([celula, c]) => {
      const minPadrao = Object.values(c.porMes).reduce((s, v) => s + v.minPadrao, 0);
      const pecas = Object.values(c.porMes).reduce((s, v) => s + v.pecas, 0);
      const minMedido = Object.values(c.medido).reduce((s, v) => s + v.minutos, 0);
      const diasMedido = Object.values(c.medido).reduce((s, v) => s + v.dias, 0);
      return {
        celula,
        ativa: ativas.has(celula),
        pecas: r1(pecas),
        minPadrao: r1(minPadrao),
        minMedido: r1(minMedido),
        // Minuto padrao calculado / minuto medido. Perto de 1 = a premissa de tempo bate.
        razaoPadraoMedido: minMedido > 0 ? Number((minPadrao / minMedido).toFixed(3)) : null,
        medidoPorDia: diasMedido > 0 ? r1(minMedido / diasMedido) : 0,
        porMes: mesesJanela.map((mes) => ({
          mes,
          pecas: r1(c.porMes[mes]?.pecas),
          minPadrao: r1(c.porMes[mes]?.minPadrao),
          minMedido: r1(c.medido[mes]?.minutos),
          dias: c.medido[mes]?.dias || 0,
        })),
        porFamilia: Object.entries(c.porFamilia)
          .map(([familia, v]) => ({ familia, pecas: r1(v.pecas), minutos: r1(v.minutos), fatia: minPadrao > 0 ? Number((v.minutos / minPadrao).toFixed(4)) : 0 }))
          .sort((a, b) => b.minutos - a.minutos),
      };
    }).sort((a, b) => b.minPadrao - a.minPadrao);

    const nomesFamilias = new Set([...familiasProd.keys(), ...planoPorFamilia.keys()]);
    const diasDosPeriodos = Object.fromEntries(PERIODOS_PLANO.map((p) => [p, diasDisponiveisDaData(periodos.datas[p], hoje, false)]));
    const familias = [...nomesFamilias].map((familia) => {
      const prod = familiasProd.get(familia)?.porMes || {};
      const plano = planoPorFamilia.get(familia) || zeroPeriodos();
      const minProd = mesesJanela.reduce((s, m) => s + (prod[m]?.minutos || 0), 0);
      const pecasProd = mesesJanela.reduce((s, m) => s + (prod[m]?.pecas || 0), 0);
      const processo = processoPorFamilia.get(familia) || { pecas: 0, minutos: 0 };
      return {
        familia,
        produzido: {
          pecas: r1(pecasProd),
          minutos: r1(minProd),
          minPorDia: diasJanela > 0 ? r1(minProd / diasJanela) : 0,
          minPorPeca: pecasProd > 0 ? Number((minProd / pecasProd).toFixed(2)) : null,
          porMes: mesesJanela.map((mes) => ({
            mes,
            pecas: r1(prod[mes]?.pecas),
            minutos: r1(prod[mes]?.minutos),
            minPorDia: diasPorMes[mes] ? r1((prod[mes]?.minutos || 0) / diasPorMes[mes]) : 0,
          })),
        },
        plano: PERIODOS_PLANO.map((per) => ({
          periodo: per,
          mes: periodos.datas[per] ? mesIso(periodos.datas[per]) : per,
          dias: diasDosPeriodos[per],
          pecas: r1(plano[per].pecas),
          minutos: r1(plano[per].minutos),
          minPorDia: diasDosPeriodos[per] > 0 ? r1(plano[per].minutos / diasDosPeriodos[per]) : 0,
        })),
        emProcesso: { pecas: r1(processo.pecas), minutos: r1(processo.minutos) },
      };
    }).sort((a, b) => (b.produzido.minutos + b.plano.reduce((s, p) => s + p.minutos, 0))
      - (a.produzido.minutos + a.plano.reduce((s, p) => s + p.minutos, 0)));

    const minPadraoTotal = listaCelulas.reduce((s, c) => s + c.minPadrao, 0);
    const minMedidoTotal = listaCelulas.reduce((s, c) => s + c.minMedido, 0);
    const payload = {
      success: true,
      geradoEm: new Date().toISOString(),
      meses: mesesJanela,
      diasPorMes,
      diasJanela,
      loteId: loteId || null,
      cobertura: {
        pecasProduzidas: r1(pecasTotal),
        pecasSemTempo: r1(pecasSemTempo),
        pecasForaDaMatriz: r1(familias.find((f) => f.familia === SEM_FAMILIA)?.produzido.pecas || 0),
        planoPecasSemTempo: r1(planoSemTempoPecas),
        minPadraoTotal: r1(minPadraoTotal),
        minMedidoTotal: r1(minMedidoTotal),
        razaoPadraoMedido: minMedidoTotal > 0 ? Number((minPadraoTotal / minMedidoTotal).toFixed(3)) : null,
      },
      celulas: listaCelulas,
      familias,
    };
    cache.chave = chave;
    cache.data = payload;
    cache.timestamp = Date.now();
    return res.json(payload);
  } catch (error) {
    console.error('[analise-capacidade/especializacao] Erro:', error);
    return res.status(500).json({ success: false, error: 'Erro ao medir especialização', details: error.message });
  }
});

/**
 * GET /api/analise-capacidade/finalizado?de=2026-01-01
 *
 * FATO 1 — o que a fabrica FINALIZOU, por grupo de costura, mes e referencia, em pecas.
 *
 * Fonte: `vr_cdf_movopi`, `tp_historicomov = 51` (baixa de peca acabada), sem estorno,
 * restrito aos locais que sao grupos de costura (`DEFAULT_REAL_GROUP_IDS`).
 *
 * Por que o filtro de locais: o mesmo movimento 51 aparece em todos os locais por onde a
 * OP passa — corte, almoxarifado, pre-expedicao. Medido em 17/11/2026, de jan/26 ate hoje:
 * grupos de costura 1.789.899 pecas, 01 - CORTE 1.789.663, PRE EXPEDICAO 1.789.627. Sem o
 * filtro a mesma peca seria contada varias vezes (~1,6 a 2 milhoes por mes).
 *
 * Inclui o mes corrente ate hoje. Nada de plano, tempo ou capacidade aqui: so o que saiu.
 */
const finalizadoCache = { chave: '', data: null, timestamp: 0 };

router.get('/finalizado', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    if (!pool) return res.status(500).json({ success: false, error: 'Pool de conexão não disponível' });
    // Padrao: janela MOVEL — os 12 meses fechados antes do mes corrente, mais o corrente.
    const hojeJanela = new Date();
    const inicioJanela = new Date(hojeJanela.getFullYear(), hojeJanela.getMonth() - 12, 1);
    const dePadrao = `${inicioJanela.getFullYear()}-${String(inicioJanela.getMonth() + 1).padStart(2, '0')}-01`;
    const deRaw = String(req.query.de || dePadrao).slice(0, 10);
    const de = /^\d{4}-\d{2}-\d{2}$/.test(deRaw) ? deRaw : dePadrao;
    if (req.query.refresh !== 'true' && finalizadoCache.data && finalizadoCache.chave === de
        && Date.now() - finalizadoCache.timestamp < 15 * 60 * 1000) {
      return res.json({ ...finalizadoCache.data, fromCache: true });
    }
    const ids = DEFAULT_REAL_GROUP_IDS.map(String);
    const { readCache } = require('../cache/matrizCache');

    const [mov, dias, diasCelula, locais, grupos, matrizCache] = await Promise.all([
      pool.query(`
        SELECT TO_CHAR(DATE_TRUNC('month', m.dt_movimento), 'YYYY-MM') AS mes,
               m.cd_localorigem::text AS cd_local,
               UPPER(TRIM(COALESCE(f_dic_prd_nivel(m.cd_produto, 'CD'::bpchar), '')))::text AS referencia,
               SUM(COALESCE(m.qt_movimento, 0))::float AS pecas
          FROM vr_cdf_movopi m
         WHERE m.tp_historicomov = 51
           AND m.in_estorno = 'F'
           AND m.cd_localorigem::text = ANY($1::text[])
           AND m.dt_movimento >= $2::date
         GROUP BY 1, 2, 3`, [ids, de]),
      pool.query(`
        SELECT TO_CHAR(DATE_TRUNC('month', m.dt_movimento), 'YYYY-MM') AS mes,
               COUNT(DISTINCT m.dt_movimento::date)::int AS dias,
               TO_CHAR(MAX(m.dt_movimento), 'YYYY-MM-DD') AS ultimo
          FROM vr_cdf_movopi m
         WHERE m.tp_historicomov = 51
           AND m.in_estorno = 'F'
           AND m.cd_localorigem::text = ANY($1::text[])
           AND m.dt_movimento >= $2::date
         GROUP BY 1`, [ids, de]),
      // Dias trabalhados de CADA grupo: dia em que ele finalizou ao menos uma peca. Grupo que
      // para alguns dias no mes (falta de carga, ferias da oficina) aparece aqui, e a media
      // da fabrica esconderia isso.
      pool.query(`
        SELECT TO_CHAR(DATE_TRUNC('month', m.dt_movimento), 'YYYY-MM') AS mes,
               m.cd_localorigem::text AS cd_local,
               COUNT(DISTINCT m.dt_movimento::date)::int AS dias
          FROM vr_cdf_movopi m
         WHERE m.tp_historicomov = 51
           AND m.in_estorno = 'F'
           AND m.cd_localorigem::text = ANY($1::text[])
           AND m.dt_movimento >= $2::date
           AND COALESCE(m.qt_movimento, 0) > 0
         GROUP BY 1, 2`, [ids, de]),
      pool.query(`SELECT cd_local::text AS cd_local, UPPER(TRIM(ds_local::text)) AS ds_local
                    FROM pcp_cache_locais WHERE cd_local::text = ANY($1::text[])`, [ids]),
      readGrupos(pool),
      readCache(),
    ]);

    const nomeDoLocal = new Map(locais.rows.map((r) => [r.cd_local, r.ds_local]));
    const ativas = new Set(grupos.map((g) => String(g.grupo || '').trim().toUpperCase()));

    // Descricao e familia vem da matriz; referencia que saiu dela fica sem, e isso aparece.
    const infoRef = new Map();
    const matrizRows = Array.isArray(matrizCache?.data?.rows) ? matrizCache.data.rows : [];
    for (const item of matrizRows) {
      const ref = String(item?.produto?.referencia || '').trim().toUpperCase();
      if (!ref || infoRef.has(ref)) continue;
      infoRef.set(ref, {
        descricao: String(item?.produto?.produto || '').trim(),
        familia: familiaDoProduto(item?.produto),
        status: String(item?.produto?.status || '').trim().toUpperCase(),
      });
    }

    const meses = [...new Set(dias.rows.map((r) => r.mes))].sort();
    const celulas = new Map();
    for (const row of mov.rows) {
      const pecas = Number(row.pecas || 0);
      if (!pecas) continue;
      const celula = nomeDoLocal.get(row.cd_local) || row.cd_local;
      if (!celulas.has(celula)) celulas.set(celula, { porMes: {}, refs: new Map() });
      const c = celulas.get(celula);
      c.porMes[row.mes] = (c.porMes[row.mes] || 0) + pecas;
      const ref = row.referencia || '(sem referência)';
      if (!c.refs.has(ref)) c.refs.set(ref, {});
      const r = c.refs.get(ref);
      r[row.mes] = (r[row.mes] || 0) + pecas;
    }

    const diasDaCelula = new Map();
    for (const row of diasCelula.rows) {
      const celula = nomeDoLocal.get(row.cd_local) || row.cd_local;
      if (!diasDaCelula.has(celula)) diasDaCelula.set(celula, {});
      diasDaCelula.get(celula)[row.mes] = Number(row.dias || 0);
    }

    const soma = (obj) => Object.values(obj).reduce((s, v) => s + v, 0);
    const lista = [...celulas.entries()].map(([celula, c]) => ({
      celula,
      ativa: ativas.has(celula),
      total: Math.round(soma(c.porMes)),
      porMes: Object.fromEntries(meses.map((m) => [m, Math.round(c.porMes[m] || 0)])),
      diasPorMes: Object.fromEntries(meses.map((m) => [m, diasDaCelula.get(celula)?.[m] || 0])),
      refs: [...c.refs.entries()].map(([referencia, porMes]) => ({
        referencia,
        descricao: infoRef.get(referencia)?.descricao || '',
        familia: infoRef.get(referencia)?.familia || 'FORA DA MATRIZ',
        status: infoRef.get(referencia)?.status || '',
        total: Math.round(soma(porMes)),
        porMes: Object.fromEntries(meses.map((m) => [m, Math.round(porMes[m] || 0)])),
      })).sort((a, b) => b.total - a.total),
    })).sort((a, b) => b.total - a.total);

    const payload = {
      success: true,
      de,
      geradoEm: new Date().toISOString(),
      meses,
      diasPorMes: Object.fromEntries(dias.rows.map((r) => [r.mes, Number(r.dias || 0)])),
      ultimoMovimento: dias.rows.map((r) => String(r.ultimo).slice(0, 10)).sort().pop() || null,
      totalPorMes: Object.fromEntries(meses.map((m) => [m, lista.reduce((s, c) => s + (c.porMes[m] || 0), 0)])),
      total: lista.reduce((s, c) => s + c.total, 0),
      celulas: lista,
    };
    finalizadoCache.chave = de;
    finalizadoCache.data = payload;
    finalizadoCache.timestamp = Date.now();
    return res.json(payload);
  } catch (error) {
    console.error('[analise-capacidade/finalizado] Erro:', error);
    return res.status(500).json({ success: false, error: 'Erro ao ler produção finalizada', details: error.message });
  }
});

/**
 * GET /api/analise-capacidade/plano-ano?ano=2027&lote_id=
 *
 * FATO 2 — o PLANO em pecas, por mes do calendario de um ano.
 *
 * E o plano da matriz (o que esta lancado), com o lote de simulacao MAIS RECENTE por cima
 * — o mesmo que a Visao Geral usa. Mesmos filtros de todas as telas de capacidade: LIEBE,
 * EM LINHA ou NOVA COLECAO, sem meia de seda. Conferido em 17/11/2026: fev a jun/27 batem
 * peca a peca com a linha de plano do grafico da Visao Geral.
 *
 * NAO entram Liebe Move, edicao limitada projetada nem o "plano previsto" dos meses sem
 * lote. Sao estimativas que a Visao Geral soma no navegador; aqui so o que e plano.
 */
// Cache de 15 min: ~15 s para ler a matriz e o lote, e a aba chama isto mais de uma vez.
const planoAnoCache = { chave: '', data: null, timestamp: 0 };

router.get('/plano-ano', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    if (!pool) return res.status(500).json({ success: false, error: 'Pool de conexão não disponível' });
    const hoje = new Date();
    const ano = Number(req.query.ano) || hoje.getFullYear() + 1;
    const chaveCache = `${ano}|${req.query.lote_id || ''}`;
    if (req.query.refresh !== 'true' && planoAnoCache.data && planoAnoCache.chave === chaveCache
        && Date.now() - planoAnoCache.timestamp < 15 * 60 * 1000) {
      return res.json({ ...planoAnoCache.data, fromCache: true });
    }
    const { readCache } = require('../cache/matrizCache');

    // Lote: o informado, ou o mais recente que tenha planos — mesma regra da Visao Geral.
    let loteId = String(req.query.lote_id || '').trim();
    let loteCriadoEm = null;
    if (!loteId) {
      try {
        const r = await pool.query(`
          SELECT parametros::jsonb ->> 'loteId' AS lote, created_at
            FROM app_simulacoes
           WHERE COALESCE(parametros::jsonb ->> 'loteId', '') <> ''
             AND jsonb_typeof(parametros::jsonb -> 'planos') = 'array'
           ORDER BY created_at DESC
           LIMIT 1`);
        loteId = String(r.rows[0]?.lote || '').trim();
        loteCriadoEm = r.rows[0]?.created_at ? Number(r.rows[0].created_at) : null;
      } catch (err) {
        if (err.code !== '42P01') console.error('[analise-capacidade/plano-ano] lote:', err.message);
      }
    }
    const planosSimulados = new Map();
    if (loteId) {
      for (const s of await lerSimulacoesDoLote(pool, loteId)) {
        for (const p of s.parametros.planos) {
          const k = String(p?.chave || '').trim();
          if (k) planosSimulados.set(k, p);
        }
      }
    }

    const periodos = calcularPeriodosPlano(hoje);
    const periodoDoMes = {}; // 'YYYY-MM' -> periodo
    for (const per of PERIODOS_PLANO) {
      const d = periodos.datas[per];
      if (d) periodoDoMes[mesIso(d)] = per;
    }

    const matrizCache = await readCache();
    const matrizRows = Array.isArray(matrizCache?.data?.rows) ? matrizCache.data.rows : [];
    const pecasPorPeriodo = Object.fromEntries(PERIODOS_PLANO.map((p) => [p, 0]));
    const doLotePorPeriodo = Object.fromEntries(PERIODOS_PLANO.map((p) => [p, 0]));
    for (const item of matrizRows) {
      const produto = item?.produto || {};
      if (String(produto.marca || '').trim().toUpperCase() !== 'LIEBE') continue;
      if (!['EM LINHA', 'NOVA COLECAO'].includes(String(produto.status || '').trim().toUpperCase())) continue;
      if (String(produto.produto || '').toUpperCase().includes('MEIA DE SEDA')) continue;
      const simulado = planosSimulados.get(chaveDaLinha(item));
      const fonte = simulado || item?.plano || {};
      for (const per of PERIODOS_PLANO) {
        const v = Number(fonte[per.toLowerCase()] || 0);
        pecasPorPeriodo[per] += v;
        if (simulado) doLotePorPeriodo[per] += v;
      }
    }

    const meses = [];
    for (let m = 1; m <= 12; m += 1) {
      const chave = `${ano}-${String(m).padStart(2, '0')}`;
      const per = periodoDoMes[chave] || null;
      meses.push({
        mes: chave,
        periodo: per,
        // Mes fora do horizonte de 14 periodos: sem plano, e nao zero.
        pecas: per ? Math.round(pecasPorPeriodo[per]) : null,
        doLote: per ? Math.round(doLotePorPeriodo[per]) : null,
      });
    }

    const payload = {
      success: true,
      ano,
      loteId: loteId || null,
      loteCriadoEm,
      total: meses.reduce((s, m) => s + (m.pecas || 0), 0),
      meses,
    };
    planoAnoCache.chave = chaveCache;
    planoAnoCache.data = payload;
    planoAnoCache.timestamp = Date.now();
    return res.json(payload);
  } catch (error) {
    console.error('[analise-capacidade/plano-ano] Erro:', error);
    return res.status(500).json({ success: false, error: 'Erro ao ler o plano', details: error.message });
  }
});

/**
 * GET /api/analise-capacidade/por-mix?de=&ano=2027&lote_id=
 *
 * O EIXO QUE O PCP USA PARA PENSAR A FABRICA: o mix de producao do ERP (classificacao 29 —
 * CA BASICO, SO LUXE, SO LINHA NOITE, CA ANATOMIC...). Os proprios nomes dos grupos de
 * costura seguem esse eixo ("08 - CONQUISTA CA BASICO/FASHION").
 *
 *   finalizado: pecas por grupo de costura x mix x mes (mesma fonte da matriz do historico),
 *               classificadas pelo mix do PROPRIO SKU movimentado — inclusive o que ja saiu
 *               da matriz, que antes aparecia como "fora da matriz".
 *   plano:      pecas por mix x mes do ano pedido (matriz + lote mais recente).
 */
router.get('/por-mix', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    if (!pool) return res.status(500).json({ success: false, error: 'Pool de conexão não disponível' });
    const hoje = new Date();
    const inicioJanela = new Date(hoje.getFullYear(), hoje.getMonth() - 12, 1);
    const dePadrao = `${inicioJanela.getFullYear()}-${String(inicioJanela.getMonth() + 1).padStart(2, '0')}-01`;
    const deRaw = String(req.query.de || dePadrao).slice(0, 10);
    const de = /^\d{4}-\d{2}-\d{2}$/.test(deRaw) ? deRaw : dePadrao;
    const ano = Number(req.query.ano) || hoje.getFullYear() + 1;
    const ids = DEFAULT_REAL_GROUP_IDS.map(String);
    const { readCache } = require('../cache/matrizCache');

    const [mov, locais, grupos, mixRows, matrizCache] = await Promise.all([
      pool.query(`
        SELECT TO_CHAR(DATE_TRUNC('month', m.dt_movimento), 'YYYY-MM') AS mes,
               m.cd_localorigem::text AS cd_local,
               COALESCE(NULLIF(UPPER(TRIM(c.ds_classificacao)), ''), 'SEM MIX') AS mix,
               SUM(COALESCE(m.qt_movimento, 0))::float AS pecas
          FROM vr_cdf_movopi m
          LEFT JOIN public.vr_prd_produtoclas c
                 ON c.cd_produto = m.cd_produto AND c.cd_tipoclas::int = 29
         WHERE m.tp_historicomov = 51
           AND m.in_estorno = 'F'
           AND m.cd_localorigem::text = ANY($1::text[])
           AND m.dt_movimento >= $2::date
           AND m.dt_movimento < DATE_TRUNC('month', CURRENT_DATE)::date
         GROUP BY 1, 2, 3`, [ids, de]),
      pool.query(`SELECT cd_local::text AS cd_local, UPPER(TRIM(ds_local::text)) AS ds_local
                    FROM pcp_cache_locais WHERE cd_local::text = ANY($1::text[])`, [ids]),
      readGrupos(pool),
      pool.query(`SELECT cd_produto::TEXT AS id, UPPER(TRIM(ds_classificacao)) AS mix
                    FROM public.vr_prd_produtoclas
                   WHERE cd_tipoclas::int = 29 AND COALESCE(ds_classificacao, '') <> ''`),
      readCache(),
    ]);
    const nomeDoLocal = new Map(locais.rows.map((r) => [r.cd_local, r.ds_local]));
    const ativas = new Set(grupos.map((g) => String(g.grupo || '').trim().toUpperCase()));
    const mixPorSku = new Map(mixRows.rows.map((r) => [String(r.id), String(r.mix)]));

    // ── Finalizado ──
    const meses = [...new Set(mov.rows.map((r) => r.mes))].sort();
    const porCelula = new Map();
    for (const r of mov.rows) {
      const celula = nomeDoLocal.get(r.cd_local) || r.cd_local;
      if (!porCelula.has(celula)) porCelula.set(celula, {});
      const c = porCelula.get(celula);
      c[r.mix] = c[r.mix] || {};
      c[r.mix][r.mes] = (c[r.mix][r.mes] || 0) + Number(r.pecas || 0);
    }
    const celulas = [...porCelula.entries()].map(([celula, porMix]) => ({
      celula,
      ativa: ativas.has(celula),
      mixes: Object.entries(porMix).map(([mix, porMes]) => ({
        mix,
        total: Math.round(Object.values(porMes).reduce((a, b) => a + b, 0)),
        porMes: Object.fromEntries(meses.map((m) => [m, Math.round(porMes[m] || 0)])),
      })).sort((a, b) => b.total - a.total),
    }));

    // ── Plano do ano, por mix ──
    let loteId = String(req.query.lote_id || '').trim();
    if (!loteId) {
      try {
        const r = await pool.query(`
          SELECT parametros::jsonb ->> 'loteId' AS lote FROM app_simulacoes
           WHERE COALESCE(parametros::jsonb ->> 'loteId', '') <> ''
             AND jsonb_typeof(parametros::jsonb -> 'planos') = 'array'
           ORDER BY created_at DESC LIMIT 1`);
        loteId = String(r.rows[0]?.lote || '').trim();
      } catch (err) {
        if (err.code !== '42P01') console.error('[analise-capacidade/por-mix] lote:', err.message);
      }
    }
    const planosSimulados = new Map();
    if (loteId) {
      for (const s of await lerSimulacoesDoLote(pool, loteId)) {
        for (const p of s.parametros.planos) {
          const k = String(p?.chave || '').trim();
          if (k) planosSimulados.set(k, p);
        }
      }
    }
    const periodos = calcularPeriodosPlano(hoje);
    const mesesAno = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`);
    const periodoDoMes = {};
    for (const per of PERIODOS_PLANO) if (periodos.datas[per]) periodoDoMes[mesIso(periodos.datas[per])] = per;
    const planoPorMix = {};
    const matrizRows = Array.isArray(matrizCache?.data?.rows) ? matrizCache.data.rows : [];
    for (const item of matrizRows) {
      const produto = item?.produto || {};
      if (String(produto.marca || '').trim().toUpperCase() !== 'LIEBE') continue;
      if (!['EM LINHA', 'NOVA COLECAO'].includes(String(produto.status || '').trim().toUpperCase())) continue;
      if (String(produto.produto || '').toUpperCase().includes('MEIA DE SEDA')) continue;
      const mix = mixPorSku.get(String(produto.idproduto || '')) || 'SEM MIX';
      const fonte = planosSimulados.get(chaveDaLinha(item)) || item?.plano || {};
      for (const mes of mesesAno) {
        const per = periodoDoMes[mes];
        if (!per) continue;
        const v = Number(fonte[per.toLowerCase()] || 0);
        if (!v) continue;
        planoPorMix[mix] = planoPorMix[mix] || {};
        planoPorMix[mix][mes] = (planoPorMix[mix][mes] || 0) + v;
      }
    }
    const plano = Object.entries(planoPorMix).map(([mix, porMes]) => ({
      mix,
      total: Math.round(Object.values(porMes).reduce((a, b) => a + b, 0)),
      porMes: Object.fromEntries(mesesAno.map((m) => [m, Math.round(porMes[m] || 0)])),
    })).sort((a, b) => b.total - a.total);

    return res.json({ success: true, de, meses, ano, mesesAno, loteId: loteId || null, celulas, plano });
  } catch (error) {
    console.error('[analise-capacidade/por-mix] Erro:', error);
    return res.status(500).json({ success: false, error: 'Erro ao abrir por mix', details: error.message });
  }
});

/**
 * GET /api/analise-capacidade/setup-mix?ano=2027&lote_id=
 *
 * TABELAS 2 E 3 DO PCP, em MINUTOS e por MIX de producao (classificacao 29).
 *
 *   Imaginario (tabela 2): quantos grupos de tamanho MEDIO o plano do ano pede em cada mix,
 *     mes a mes. Grupo medio = media do min/dia medido dos grupos ativos. Nao olha quem
 *     existe hoje — e a fabrica que atenderia o plano.
 *   Real (tabela 3): quantos grupos medios a fabrica de hoje dedica a cada mix, pelo que
 *     cada grupo ATIVO de fato costurou (fatia em minuto padrao) x a capacidade medida dele.
 *   Saldo = real - imaginario. Negativo = falta grupo daquele mix.
 *
 * Plano: so os SKUs que estao de fato no plano emitido (matriz + lote mais recente), com o
 * tempo de cada um — orientacao do PCP em 17/11/2026. Sem edicao limitada projetada nem
 * Liebe Move: de abr/27 em diante luxo quase nao tem plano, e isso aparece como sobra.
 */
const setupMixCache = { chave: '', data: null, timestamp: 0 };

router.get('/setup-mix', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    if (!pool) return res.status(500).json({ success: false, error: 'Pool de conexão não disponível' });
    const hoje = new Date();
    const ano = Number(req.query.ano) || hoje.getFullYear() + 1;
    const chaveCache = `v2|${ano}|${req.query.lote_id || ''}`;
    if (req.query.refresh !== 'true' && setupMixCache.data && setupMixCache.chave === chaveCache
        && Date.now() - setupMixCache.timestamp < 15 * 60 * 1000) {
      return res.json({ ...setupMixCache.data, fromCache: true });
    }
    const inicioJanela = new Date(hoje.getFullYear(), hoje.getMonth() - 12, 1);
    const de = `${inicioJanela.getFullYear()}-${String(inicioJanela.getMonth() + 1).padStart(2, '0')}-01`;
    const ids = DEFAULT_REAL_GROUP_IDS.map(String);
    const { readCache } = require('../cache/matrizCache');

    const [mov, medido, locais, grupos, mixRows, temposResult, matrizCache] = await Promise.all([
      pool.query(`
        SELECT m.cd_localorigem::text AS cd_local,
               UPPER(TRIM(COALESCE(f_dic_prd_nivel(m.cd_produto, 'CD'::bpchar), '')))::text AS referencia,
               COALESCE(NULLIF(UPPER(TRIM(c.ds_classificacao)), ''), 'SEM MIX') AS mix,
               SUM(COALESCE(m.qt_movimento, 0))::float AS pecas
          FROM vr_cdf_movopi m
          LEFT JOIN public.vr_prd_produtoclas c
                 ON c.cd_produto = m.cd_produto AND c.cd_tipoclas::int = 29
         WHERE m.tp_historicomov = 51
           AND m.in_estorno = 'F'
           AND m.cd_localorigem::text = ANY($1::text[])
           AND m.dt_movimento >= $2::date
           AND m.dt_movimento < DATE_TRUNC('month', CURRENT_DATE)::date
         GROUP BY 1, 2, 3`, [ids, de]),
      pool.query(`
        SELECT e.cd_grupo::text AS cd_local,
               SUM(COALESCE(e.tempo_produzido_min, 0))::float AS minutos,
               COUNT(DISTINCT e.dt_ref) FILTER (WHERE COALESCE(e.tempo_produzido_min, 0) > 0)::int AS dias
          FROM pcp_cache_eficiencia_dia e
         WHERE e.cd_grupo::text = ANY($1::text[])
           AND e.dt_ref >= $2::date
           AND e.dt_ref < DATE_TRUNC('month', CURRENT_DATE)::date
         GROUP BY 1`, [ids, de]),
      pool.query(`SELECT cd_local::text AS cd_local, UPPER(TRIM(ds_local::text)) AS ds_local
                    FROM pcp_cache_locais WHERE cd_local::text = ANY($1::text[])`, [ids]),
      readGrupos(pool),
      pool.query(`SELECT cd_produto::TEXT AS id, UPPER(TRIM(ds_classificacao)) AS mix
                    FROM public.vr_prd_produtoclas
                   WHERE cd_tipoclas::int = 29 AND COALESCE(ds_classificacao, '') <> ''`),
      queryTempoBaseRows(pool, {}),
      readCache(),
    ]);
    const nomeDoLocal = new Map(locais.rows.map((r) => [r.cd_local, r.ds_local]));
    const ativas = new Set(grupos.map((g) => String(g.grupo || '').trim().toUpperCase()));
    // ANATOMIC e um PERFIL so (regra do PCP, 17/11/2026): sutia e calcinha anatomic sao a
    // mesma linha e o mesmo grupo de costura (LIDERANCA). Fundidos aqui, no plano e no real.
    const perfilDoMix = (mix) => (String(mix || '').includes('ANATOMIC') ? 'ANATOMIC' : String(mix || 'SEM MIX'));
    const mixPorSku = new Map(mixRows.rows.map((r) => [String(r.id), perfilDoMix(r.mix)]));

    // Tempo: o da matriz (cd_seqgrupo) quando a referencia esta nela; senao o da referencia
    // padrao — mesma regra da Analise 1. Maior sequencia, sem somar sequencias diferentes.
    const tempoPorId = new Map();
    const refDoId = new Map();
    for (const row of temposResult.rows || []) {
      const id = String(row.idreferencia || '').trim().toUpperCase();
      if (!id) continue;
      const base = resolveTempoLikePowerBi(row.hr_tempo, row.hr_tempopadrao);
      tempoPorId.set(id, (tempoPorId.get(id) || 0) + (Number.isFinite(base) ? base : 0));
      const ref = String(row.referencia_padrao || '').trim().toUpperCase();
      if (ref) refDoId.set(id, ref);
    }
    const tempoPorRefPadrao = new Map();
    for (const [id, t] of tempoPorId) {
      const ref = refDoId.get(id);
      if (ref && t > (tempoPorRefPadrao.get(ref) || 0)) tempoPorRefPadrao.set(ref, t);
    }
    const matrizRows = Array.isArray(matrizCache?.data?.rows) ? matrizCache.data.rows : [];
    const tempoMatriz = new Map();
    for (const item of matrizRows) {
      const ref = String(item?.produto?.referencia || '').trim().toUpperCase();
      if (!ref || tempoMatriz.has(ref)) continue;
      const t = Number(tempoPorId.get(String(item?.produto?.cd_seqgrupo || '').trim().toUpperCase()) || 0);
      if (t > 0) tempoMatriz.set(ref, t);
    }
    const tempoDaRef = (ref) => tempoMatriz.get(ref) || tempoPorRefPadrao.get(ref) || 0;

    // ── REAL: capacidade medida de cada grupo ativo, repartida pelo mix que ele costurou ──
    const capCelula = new Map();
    for (const r of medido.rows) {
      const celula = nomeDoLocal.get(r.cd_local) || r.cd_local;
      if (!ativas.has(celula)) continue;
      capCelula.set(celula, Number(r.dias) > 0 ? Number(r.minutos) / Number(r.dias) : 0);
    }
    const minPorCelulaMix = new Map();
    let pecasSemTempo = 0;
    let pecasTotal = 0;
    for (const r of mov.rows) {
      const celula = nomeDoLocal.get(r.cd_local) || r.cd_local;
      if (!ativas.has(celula)) continue;
      const pecas = Number(r.pecas || 0);
      const t = tempoDaRef(r.referencia);
      pecasTotal += pecas;
      if (!(t > 0)) { pecasSemTempo += pecas; continue; }
      if (!minPorCelulaMix.has(celula)) minPorCelulaMix.set(celula, new Map());
      const m = minPorCelulaMix.get(celula);
      const mixR = perfilDoMix(r.mix);
      m.set(mixR, (m.get(mixR) || 0) + pecas * t);
    }
    const celulasAtivas = [...capCelula.keys()];
    const grupoMedio = celulasAtivas.reduce((s, c) => s + capCelula.get(c), 0) / Math.max(1, celulasAtivas.length);
    const capRealPorMix = new Map();
    // CONFIGURACAO: cada grupo conta INTEIRO no perfil principal dele (o mix que mais
    // costurou). O que ele faz fora disso e ocupacao de sobra, nao vocacao — a LIDERANCA
    // costura sutia basico quando o anatomic nao enche, e nem por isso deixa de ser o grupo
    // do anatomic (regra do PCP, 17/11/2026).
    const capInteiraPorMix = new Map();
    const gruposPorMix = new Map();
    const quemFaz = new Map();
    const gruposDetalhe = celulasAtivas.map((celula) => {
      const m = minPorCelulaMix.get(celula) || new Map();
      const tot = [...m.values()].reduce((a, b) => a + b, 0);
      const fatias = [...m.entries()].map(([mix, v]) => ({ mix, fatia: tot > 0 ? v / tot : 0 })).sort((a, b) => b.fatia - a.fatia);
      const principal = fatias[0]?.mix;
      if (principal) {
        capInteiraPorMix.set(principal, (capInteiraPorMix.get(principal) || 0) + capCelula.get(celula));
        if (!gruposPorMix.has(principal)) gruposPorMix.set(principal, []);
        gruposPorMix.get(principal).push({ celula, tamanho: Number((capCelula.get(celula) / grupoMedio).toFixed(2)), fatia: Number(fatias[0].fatia.toFixed(3)) });
      }
      for (const f of fatias) {
        capRealPorMix.set(f.mix, (capRealPorMix.get(f.mix) || 0) + capCelula.get(celula) * f.fatia);
        if (f.fatia >= 0.15) {
          if (!quemFaz.has(f.mix)) quemFaz.set(f.mix, []);
          quemFaz.get(f.mix).push({ celula, fatia: Number(f.fatia.toFixed(3)) });
        }
      }
      return {
        celula,
        minDia: Math.round(capCelula.get(celula)),
        tamanho: Number((capCelula.get(celula) / grupoMedio).toFixed(2)),
        perfilPrincipal: principal || null,
        fatias: fatias.filter((f) => f.fatia >= 0.03).map((f) => ({ mix: f.mix, fatia: Number(f.fatia.toFixed(3)) })),
      };
    }).sort((a, b) => b.minDia - a.minDia);

    // ── IMAGINARIO: plano do ano em minutos, por mix e mes ──
    let loteId = String(req.query.lote_id || '').trim();
    if (!loteId) {
      try {
        const r = await pool.query(`
          SELECT parametros::jsonb ->> 'loteId' AS lote FROM app_simulacoes
           WHERE COALESCE(parametros::jsonb ->> 'loteId', '') <> ''
             AND jsonb_typeof(parametros::jsonb -> 'planos') = 'array'
           ORDER BY created_at DESC LIMIT 1`);
        loteId = String(r.rows[0]?.lote || '').trim();
      } catch (err) {
        if (err.code !== '42P01') console.error('[analise-capacidade/setup-mix] lote:', err.message);
      }
    }
    const planosSimulados = new Map();
    if (loteId) {
      for (const s of await lerSimulacoesDoLote(pool, loteId)) {
        for (const p of s.parametros.planos) {
          const k = String(p?.chave || '').trim();
          if (k) planosSimulados.set(k, p);
        }
      }
    }
    const periodos = calcularPeriodosPlano(hoje);
    const mesesAno = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`);
    const periodoDoMes = {};
    for (const per of PERIODOS_PLANO) if (periodos.datas[per]) periodoDoMes[mesIso(periodos.datas[per])] = per;
    const dias = mesesAno.map((m) => {
      const per = periodoDoMes[m];
      return per ? diasDisponiveisDaData(periodos.datas[per], hoje, false) : 0;
    });
    const planoMin = new Map();
    const planoPecas = new Map();
    let planoPecasSemTempo = 0;
    for (const item of matrizRows) {
      const produto = item?.produto || {};
      if (String(produto.marca || '').trim().toUpperCase() !== 'LIEBE') continue;
      if (!['EM LINHA', 'NOVA COLECAO'].includes(String(produto.status || '').trim().toUpperCase())) continue;
      if (String(produto.produto || '').toUpperCase().includes('MEIA DE SEDA')) continue;
      const mix = mixPorSku.get(String(produto.idproduto || '')) || 'SEM MIX';
      const ref = String(produto.referencia || '').trim().toUpperCase();
      const t = tempoDaRef(ref);
      const fonte = planosSimulados.get(chaveDaLinha(item)) || item?.plano || {};
      mesesAno.forEach((mes, i) => {
        const per = periodoDoMes[mes];
        if (!per) return;
        const v = Number(fonte[per.toLowerCase()] || 0);
        if (!v) return;
        if (!planoMin.has(mix)) { planoMin.set(mix, Array(12).fill(0)); planoPecas.set(mix, Array(12).fill(0)); }
        planoMin.get(mix)[i] += v * t;
        planoPecas.get(mix)[i] += v;
        if (!(t > 0)) planoPecasSemTempo += v;
      });
    }

    const capMesGrupoMedio = dias.map((d) => grupoMedio * d);
    const somaDias = dias.reduce((a, b) => a + b, 0);
    const mixes = [...new Set([...planoMin.keys(), ...capRealPorMix.keys(), ...capInteiraPorMix.keys()])].map((mix) => {
      const pm = planoMin.get(mix) || Array(12).fill(0);
      const gruposMes = pm.map((v, i) => (capMesGrupoMedio[i] > 0 ? v / capMesGrupoMedio[i] : 0));
      const mediaAno = somaDias > 0 ? pm.reduce((a, b) => a + b, 0) / (grupoMedio * somaDias) : 0;
      const tri = (dias[0] + dias[1] + dias[2]) > 0 ? (pm[0] + pm[1] + pm[2]) / (grupoMedio * (dias[0] + dias[1] + dias[2])) : 0;
      // NIVELADO: numero FIXO de grupos desde janeiro que nunca fica devendo no acumulado.
      let acumPlano = 0;
      let acumCap = 0;
      let nivelado = 0;
      pm.forEach((v, i) => {
        acumPlano += v;
        acumCap += capMesGrupoMedio[i];
        if (acumCap > 0) nivelado = Math.max(nivelado, acumPlano / acumCap);
      });
      // `real` = configuracao (grupos inteiros no perfil principal), em grupos medios.
      // `realHistorico` = fatia do que de fato costurou — fica como referencia.
      const real = (capInteiraPorMix.get(mix) || 0) / grupoMedio;
      const realHistorico = (capRealPorMix.get(mix) || 0) / grupoMedio;
      const r2 = (v) => Number(v.toFixed(2));
      return {
        mix,
        planoPecas: (planoPecas.get(mix) || Array(12).fill(0)).map(Math.round),
        planoMin: pm.map(Math.round),
        gruposMes: gruposMes.map(r2),
        mediaAno: r2(mediaAno),
        primeiroTri: r2(tri),
        pico: r2(Math.max(0, ...gruposMes)),
        nivelado: r2(nivelado),
        real: r2(real),
        realHistorico: r2(realHistorico),
        grupos: (gruposPorMix.get(mix) || []).sort((a, b) => b.tamanho - a.tamanho),
        saldoNivelado: r2(real - nivelado),
        saldoMedia: r2(real - mediaAno),
        quemFaz: (quemFaz.get(mix) || []).sort((a, b) => b.fatia - a.fatia),
      };
    }).sort((a, b) => b.real + b.mediaAno - (a.real + a.mediaAno));

    const payload = {
      success: true,
      ano,
      loteId: loteId || null,
      janelaReal: { de, ate: mesIso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)) },
      grupoMedioMinDia: Math.round(grupoMedio),
      gruposAtivos: celulasAtivas.length,
      mesesAno,
      dias,
      cobertura: {
        pecasFinalizadas: Math.round(pecasTotal),
        pecasFinalizadasSemTempo: Math.round(pecasSemTempo),
        planoPecasSemTempo: Math.round(planoPecasSemTempo),
      },
      mixes,
      grupos: gruposDetalhe,
    };
    setupMixCache.chave = chaveCache;
    setupMixCache.data = payload;
    setupMixCache.timestamp = Date.now();
    return res.json(payload);
  } catch (error) {
    console.error('[analise-capacidade/setup-mix] Erro:', error);
    return res.status(500).json({ success: false, error: 'Erro ao montar o setup por mix', details: error.message });
  }
});

/**
 * GET /api/analise-capacidade/plano-por-grupo?ano=2027&lote_id=
 *
 * A MESMA MATRIZ DO FINALIZADO, AGORA COM O PLANO (pedido do PCP, 17/11/2026).
 *
 * Cada referencia do plano emitido (matriz + lote) vai para os grupos que de fato a
 * produziram nos ultimos 12 meses fechados, na mesma proporcao em que produziram —
 * o RELACIONAMENTO, nao a etiqueta de mix do ERP (que classifica errado parte da linha da
 * LIDERANCA, ver P14). Referencia sem historico em grupo ativo vai para o grupo ativo que
 * mais produziu o mix dela; sem isso, fica em "sem grupo".
 *
 * "Precisa" = pecas do plano do grupo no mes / quanto aquele grupo entrega num mes
 * (media mensal dele nos meses em que trabalhou de verdade, ajustada aos dias do mes de
 * 2027). 3,0 = o mes pede tres grupos iguais a ele. Tudo em PECAS, como a tabela 1.
 */
const planoPorGrupoCache = { chave: '', data: null, timestamp: 0 };

async function calcularPlanoPorGrupo(pool, query = {}) {
  const req = { query };
  {
    const hoje = new Date();
    const ano = Number(req.query.ano) || hoje.getFullYear() + 1;
    const chaveCache = `v3|${ano}|${req.query.lote_id || ''}`;
    if (req.query.refresh !== 'true' && planoPorGrupoCache.data && planoPorGrupoCache.chave === chaveCache
        && Date.now() - planoPorGrupoCache.timestamp < 15 * 60 * 1000) {
      return { ...planoPorGrupoCache.data, fromCache: true };
    }
    const inicioJanela = new Date(hoje.getFullYear(), hoje.getMonth() - 12, 1);
    const de = `${inicioJanela.getFullYear()}-${String(inicioJanela.getMonth() + 1).padStart(2, '0')}-01`;
    const ids = DEFAULT_REAL_GROUP_IDS.map(String);
    const { readCache } = require('../cache/matrizCache');

    const [mov, diasCel, locais, grupos, mixRows, matrizCache] = await Promise.all([
      pool.query(`
        SELECT TO_CHAR(DATE_TRUNC('month', m.dt_movimento), 'YYYY-MM') AS mes,
               m.cd_localorigem::text AS cd_local,
               UPPER(TRIM(COALESCE(f_dic_prd_nivel(m.cd_produto, 'CD'::bpchar), '')))::text AS referencia,
               MAX(COALESCE(NULLIF(UPPER(TRIM(c.ds_classificacao)), ''), 'SEM MIX')) AS mix,
               SUM(COALESCE(m.qt_movimento, 0))::float AS pecas
          FROM vr_cdf_movopi m
          LEFT JOIN public.vr_prd_produtoclas c
                 ON c.cd_produto = m.cd_produto AND c.cd_tipoclas::int = 29
         WHERE m.tp_historicomov = 51
           AND m.in_estorno = 'F'
           AND m.cd_localorigem::text = ANY($1::text[])
           AND m.dt_movimento >= $2::date
           AND m.dt_movimento < DATE_TRUNC('month', CURRENT_DATE)::date
         GROUP BY 1, 2, 3`, [ids, de]),
      pool.query(`
        SELECT TO_CHAR(DATE_TRUNC('month', m.dt_movimento), 'YYYY-MM') AS mes,
               m.cd_localorigem::text AS cd_local,
               COUNT(DISTINCT m.dt_movimento::date)::int AS dias
          FROM vr_cdf_movopi m
         WHERE m.tp_historicomov = 51 AND m.in_estorno = 'F'
           AND m.cd_localorigem::text = ANY($1::text[])
           AND m.dt_movimento >= $2::date
           AND m.dt_movimento < DATE_TRUNC('month', CURRENT_DATE)::date
           AND COALESCE(m.qt_movimento, 0) > 0
         GROUP BY 1, 2`, [ids, de]),
      pool.query(`SELECT cd_local::text AS cd_local, UPPER(TRIM(ds_local::text)) AS ds_local
                    FROM pcp_cache_locais WHERE cd_local::text = ANY($1::text[])`, [ids]),
      readGrupos(pool),
      pool.query(`SELECT cd_produto::TEXT AS id, UPPER(TRIM(ds_classificacao)) AS mix
                    FROM public.vr_prd_produtoclas
                   WHERE cd_tipoclas::int = 29 AND COALESCE(ds_classificacao, '') <> ''`),
      readCache(),
    ]);
    const nomeDoLocal = new Map(locais.rows.map((r) => [r.cd_local, r.ds_local]));
    const ativas = new Set(grupos.map((g) => String(g.grupo || '').trim().toUpperCase()));
    const mixPorSku = new Map(mixRows.rows.map((r) => [String(r.id), String(r.mix)]));

    // ── Historico: quem fez cada referencia, e quanto cada grupo entrega por mes ──
    const porRef = new Map();        // ref -> Map(grupo -> pecas)
    const pecasMixGrupo = new Map(); // mix -> Map(grupo -> pecas)
    const pecasGrupoMes = new Map(); // grupo -> Map(mes -> pecas)
    for (const r of mov.rows) {
      const g = nomeDoLocal.get(r.cd_local) || r.cd_local;
      if (!ativas.has(g)) continue;
      const p = Number(r.pecas || 0);
      if (!(p > 0)) continue;
      if (!porRef.has(r.referencia)) porRef.set(r.referencia, new Map());
      porRef.get(r.referencia).set(g, (porRef.get(r.referencia).get(g) || 0) + p);
      if (!pecasMixGrupo.has(r.mix)) pecasMixGrupo.set(r.mix, new Map());
      pecasMixGrupo.get(r.mix).set(g, (pecasMixGrupo.get(r.mix).get(g) || 0) + p);
      if (!pecasGrupoMes.has(g)) pecasGrupoMes.set(g, new Map());
      pecasGrupoMes.get(g).set(r.mes, (pecasGrupoMes.get(g).get(r.mes) || 0) + p);
    }
    const diasGrupoMes = new Map();
    for (const r of diasCel.rows) {
      const g = nomeDoLocal.get(r.cd_local) || r.cd_local;
      if (!diasGrupoMes.has(g)) diasGrupoMes.set(g, new Map());
      diasGrupoMes.get(g).set(r.mes, Number(r.dias || 0));
    }
    // Entrega mensal de cada grupo: media dos meses em que ele trabalhou de verdade (15+ dias
    // com finalizacao). Mes de partida ou de parada pela metade puxaria a media para baixo —
    // a ESPERANCA comecou em mai/26 com 9 dias.
    const DIAS_MES_CHEIO = 15;
    const entregaMes = new Map();
    const diasMedios = new Map();
    for (const g of ativas) {
      const pm = pecasGrupoMes.get(g) || new Map();
      const dm = diasGrupoMes.get(g) || new Map();
      let meses = [...pm.keys()].filter((m) => (dm.get(m) || 0) >= DIAS_MES_CHEIO);
      // Oficina entrega em lote (GLEDSON: 8 a 16 dias por mes) — nenhum mes passa no corte,
      // entao vale a media de todos os meses em que ela entregou.
      if (meses.length < 3) meses = [...pm.keys()];
      if (!meses.length) continue;
      entregaMes.set(g, meses.reduce((s, m) => s + (pm.get(m) || 0), 0) / meses.length);
      diasMedios.set(g, meses.reduce((s, m) => s + (dm.get(m) || 0), 0) / meses.length);
    }

    // ── Plano do ano por referencia ──
    let loteId = String(req.query.lote_id || '').trim();
    if (!loteId) {
      try {
        const r = await pool.query(`
          SELECT parametros::jsonb ->> 'loteId' AS lote FROM app_simulacoes
           WHERE COALESCE(parametros::jsonb ->> 'loteId', '') <> ''
             AND jsonb_typeof(parametros::jsonb -> 'planos') = 'array'
           ORDER BY created_at DESC LIMIT 1`);
        loteId = String(r.rows[0]?.lote || '').trim();
      } catch (err) {
        if (err.code !== '42P01') console.error('[analise-capacidade/plano-por-grupo] lote:', err.message);
      }
    }
    const planosSimulados = new Map();
    if (loteId) {
      for (const s of await lerSimulacoesDoLote(pool, loteId)) {
        for (const p of s.parametros.planos) {
          const k = String(p?.chave || '').trim();
          if (k) planosSimulados.set(k, p);
        }
      }
    }
    const periodos = calcularPeriodosPlano(hoje);
    const mesesAno = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`);
    const periodoDoMes = {};
    for (const per of PERIODOS_PLANO) if (periodos.datas[per]) periodoDoMes[mesIso(periodos.datas[per])] = per;
    const dias = mesesAno.map((m) => (periodoDoMes[m] ? diasDisponiveisDaData(periodos.datas[periodoDoMes[m]], hoje, false) : 0));

    const planoRef = new Map(); // ref -> { descricao, mix, plano[12] }
    const matrizRows = Array.isArray(matrizCache?.data?.rows) ? matrizCache.data.rows : [];
    for (const item of matrizRows) {
      const produto = item?.produto || {};
      if (String(produto.marca || '').trim().toUpperCase() !== 'LIEBE') continue;
      if (!['EM LINHA', 'NOVA COLECAO'].includes(String(produto.status || '').trim().toUpperCase())) continue;
      if (String(produto.produto || '').toUpperCase().includes('MEIA DE SEDA')) continue;
      const ref = String(produto.referencia || '').trim().toUpperCase();
      if (!ref) continue;
      const fonte = planosSimulados.get(chaveDaLinha(item)) || item?.plano || {};
      if (!planoRef.has(ref)) {
        planoRef.set(ref, {
          descricao: String(produto.produto || '').trim(),
          mix: mixPorSku.get(String(produto.idproduto || '')) || 'SEM MIX',
          plano: Array(12).fill(0),
        });
      }
      const alvo = planoRef.get(ref);
      mesesAno.forEach((mes, i) => {
        const per = periodoDoMes[mes];
        if (per) alvo.plano[i] += Number(fonte[per.toLowerCase()] || 0);
      });
    }

    // ── Distribuicao do plano pelos grupos ──
    const SEM_GRUPO = 'SEM GRUPO';
    const linhas = new Map(); // grupo -> { plano[12], refs: [] }
    const doGrupo = (g) => {
      if (!linhas.has(g)) linhas.set(g, { plano: Array(12).fill(0), refs: [] });
      return linhas.get(g);
    };
    for (const [ref, info] of planoRef) {
      if (!info.plano.some((v) => v > 0)) continue;
      let destino = porRef.get(ref);
      let origem = 'historico';
      if (!destino || !destino.size) {
        const porMix = pecasMixGrupo.get(info.mix);
        if (porMix && porMix.size) {
          const [g] = [...porMix.entries()].sort((a, b) => b[1] - a[1])[0];
          destino = new Map([[g, 1]]);
          origem = 'mix';
        } else {
          destino = new Map([[SEM_GRUPO, 1]]);
          origem = 'sem';
        }
      }
      const total = [...destino.values()].reduce((a, b) => a + b, 0);
      for (const [g, v] of destino) {
        const fatia = v / total;
        const linha = doGrupo(g);
        const plano = info.plano.map((x) => x * fatia);
        plano.forEach((x, i) => { linha.plano[i] += x; });
        linha.refs.push({
          referencia: ref,
          descricao: info.descricao,
          mix: info.mix,
          origem,
          fatia: Number(fatia.toFixed(3)),
          plano: plano.map(Math.round),
          total: Math.round(plano.reduce((a, b) => a + b, 0)),
        });
      }
    }

    // PERFIL de cada grupo: o mix que ele mais costurou, com anatomic como perfil proprio
    // (sutia + calcinha anatomic, regra do PCP). A FAMILIA agrupa como o PCP pensa:
    // sutia, calcinha (inclui sem costura), anatomic, noite.
    const perfilBase = (mix) => (String(mix).includes('ANATOMIC') ? 'ANATOMIC' : String(mix));
    const familiaDoPerfil = (mix) => {
      const m = String(mix || '').toUpperCase();
      if (m.includes('ANATOMIC')) return 'Anatomic';
      if (m.includes('NOITE')) return 'Noite';
      if (m.startsWith('SO ')) return 'Sutiã';
      if (m.startsWith('CA ') || m.startsWith('SC ')) return 'Calcinha';
      return 'Outros';
    };
    const perfilDoGrupo = new Map();
    {
      const porGrupo = new Map();
      for (const [mix, mapa] of pecasMixGrupo) {
        const pb = perfilBase(mix);
        for (const [g, v] of mapa) {
          if (!porGrupo.has(g)) porGrupo.set(g, new Map());
          porGrupo.get(g).set(pb, (porGrupo.get(g).get(pb) || 0) + v);
        }
      }
      for (const [g, m] of porGrupo) {
        const tot = [...m.values()].reduce((a, b) => a + b, 0);
        const [mix, v] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
        perfilDoGrupo.set(g, { mix, fatia: tot > 0 ? v / tot : 0 });
      }
    }

    const DIAS_REF = 22; // mes "cheio" de referencia para ajustar a entrega aos dias de 2027
    // SAZONALIDADE da capacidade unica (18/11/2026): a entrega de cada grupo sobe e desce no
    // ano como a da fabrica, com o mesmo indice que o grafico da Visao Geral usa.
    const capUnica = await capacidadeMensal(pool, {});
    const idxPorMes = new Map(capUnica.periodos.map((p) => [p.mes, Number(p.indice || 1)]));
    const idxMes = mesesAno.map((m) => idxPorMes.get(m) || 1);
    const lista = [...linhas.entries()].map(([grupo, l]) => {
      const entrega = entregaMes.get(grupo) || 0;
      const capMes = dias.map((d, i) => entrega * (d / DIAS_REF) * idxMes[i]);
      const precisa = l.plano.map((v, i) => (capMes[i] > 0 ? Number((v / capMes[i]).toFixed(2)) : null));
      const totalPlano = l.plano.reduce((a, b) => a + b, 0);
      const totalCap = capMes.reduce((a, b) => a + b, 0);
      const perfil = perfilDoGrupo.get(grupo);
      return {
        grupo,
        ativa: grupo !== SEM_GRUPO,
        perfil: perfil?.mix || null,
        perfilFatia: perfil ? Number(perfil.fatia.toFixed(3)) : null,
        familia: perfil ? familiaDoPerfil(perfil.mix) : 'Outros',
        entregaMes: Math.round(entrega),
        diasMes: Number((diasMedios.get(grupo) || 0).toFixed(1)),
        plano: l.plano.map(Math.round),
        capacidade: capMes.map(Math.round),
        precisa,
        totalPlano: Math.round(totalPlano),
        precisaAno: totalCap > 0 ? Number((totalPlano / totalCap).toFixed(2)) : null,
        refs: l.refs.sort((a, b) => b.total - a.total),
      };
    }).sort((a, b) => (a.ativa === b.ativa ? b.totalPlano - a.totalPlano : a.ativa ? -1 : 1));

    const payload = {
      success: true,
      ano,
      loteId: loteId || null,
      janela: { de, ate: mesIso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)) },
      mesesAno,
      dias,
      totalPlano: lista.reduce((s, g) => s + g.totalPlano, 0),
      grupos: lista,
    };
    planoPorGrupoCache.chave = chaveCache;
    planoPorGrupoCache.data = payload;
    planoPorGrupoCache.timestamp = Date.now();
    return payload;
  }
}

router.get('/plano-por-grupo', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    if (!pool) return res.status(500).json({ success: false, error: 'Pool de conexão não disponível' });
    return res.json(await calcularPlanoPorGrupo(pool, req.query));
  } catch (error) {
    console.error('[analise-capacidade/plano-por-grupo] Erro:', error);
    return res.status(500).json({ success: false, error: 'Erro ao distribuir o plano pelos grupos', details: error.message });
  }
});

/**
 * GET /api/analise-capacidade/setup-ideal?ano=2027
 *
 * EXECUCAO IDEAL — "se eu pudesse montar a fabrica do zero, sem viajar" (PCP, 17/11/2026).
 *
 * Esquece os grupos de hoje e pergunta: por PERFIL, quantos grupos o plano do ano pede?
 *   - Perfil de cada referencia = perfil do grupo que hoje mais a produz (relacionamento).
 *   - Ritmo de um grupo do perfil = media da entrega mensal dos grupos daquele perfil hoje,
 *     ajustada aos dias de cada mes. Ritmo demonstrado, nao meta.
 *   - Grupo nao para: o numero e FIXO no ano. "Nivelado" = menor numero fixo que, a partir
 *     de janeiro e sem estoque de 2026, nunca fica devendo no acumulado.
 *
 * Os perfis se juntam em BLOCOS — quem pode cobrir quem na pratica — e cada bloco recebe
 * uma PROPOSTA de grupos inteiros. A proposta e decisao, nao conta: fica declarada aqui,
 * com o motivo, e a tela mostra mes a mes onde ela folga e onde fica devendo.
 */
const BLOCOS_SETUP = [
  {
    bloco: 'Sutiã básico',
    perfis: ['SO BASICO PRODUCAO'],
    proposta: 5,
    motivo: 'Pede 4,6 fixos e tem pico de 6,3 em julho: com 5, a folga de abr–jun constrói o estoque de julho.',
  },
  {
    bloco: 'Calcinha (básico, fashion, sem costura)',
    perfis: ['CA BASICO PRODUCAO', 'CA FASHION PRODUCAO', 'SC BASICO PRODUCAO'],
    proposta: 6,
    motivo: 'Pede 5,4 fixos; 6 dá margem para mar e ago–set.',
  },
  {
    bloco: 'Anatomic',
    perfis: ['ANATOMIC'],
    proposta: 1,
    motivo: 'Pede 1,1 fixo: justo em jan e set, mas é grupo especializado e não vale dividir.',
  },
  {
    bloco: 'Diferenciado flexível (sutiã fashion e luxe, calcinha luxe, noite)',
    perfis: ['SO FASHION PRODUCAO', 'SO LUXE PRODUCAO', 'CA LUXE PRODUCAO', 'SO LINHA NOITE PRODUCAO'],
    proposta: 4,
    motivo: 'Média de 2,9 no ano, mas jan pede 7,4 (lote de edição limitada). Um bloco que faz fashion, luxe e noite absorve isso melhor que especialistas parados; o plano de abr–dez não tem edição limitada, e no último ano a fábrica fez luxo o ano todo.',
  },
];

router.get('/setup-ideal', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    if (!pool) return res.status(500).json({ success: false, error: 'Pool de conexão não disponível' });
    const base = await calcularPlanoPorGrupo(pool, req.query);
    const { dias, mesesAno } = base;
    const DIAS_REF = 22;

    // Perfil de cada referencia: o do grupo que mais a produz.
    const principal = new Map(); // ref -> { grupo, fatia }
    const planoRef = new Map();
    const descRef = new Map();
    for (const g of base.grupos) {
      for (const r of g.refs) {
        const atual = principal.get(r.referencia);
        if (!atual || r.fatia > atual.fatia) principal.set(r.referencia, { grupo: g.grupo, fatia: r.fatia });
        const pr = planoRef.get(r.referencia) || Array(12).fill(0);
        r.plano.forEach((v, i) => { pr[i] += v; });
        planoRef.set(r.referencia, pr);
        if (!descRef.has(r.referencia)) descRef.set(r.referencia, r.descricao);
      }
    }
    const perfilDoGrupo = new Map(base.grupos.map((g) => [g.grupo, g.perfil || 'SEM PERFIL']));
    const perfis = new Map(); // perfil -> { plano[12], refs[], grupos[] }
    for (const [ref, pl] of planoRef) {
      const perfil = perfilDoGrupo.get(principal.get(ref).grupo) || 'SEM PERFIL';
      if (!perfis.has(perfil)) perfis.set(perfil, { plano: Array(12).fill(0), refs: [], gruposHoje: [] });
      const p = perfis.get(perfil);
      pl.forEach((v, i) => { p.plano[i] += v; });
      p.refs.push({ referencia: ref, descricao: descRef.get(ref) || '', plano: pl.map(Math.round), total: Math.round(pl.reduce((a, b) => a + b, 0)) });
    }
    for (const g of base.grupos) {
      const p = perfis.get(g.perfil);
      if (p) p.gruposHoje.push({ grupo: g.grupo, entregaMes: g.entregaMes });
    }

    const nivelado = (gruposMes) => {
      let acum = 0;
      let acumDias = 0;
      let n = 0;
      gruposMes.forEach((v, i) => {
        acum += v * dias[i];
        acumDias += dias[i];
        if (acumDias > 0) n = Math.max(n, acum / acumDias);
      });
      return n;
    };
    const media = (gruposMes) => {
      const d = dias.reduce((a, b) => a + b, 0);
      return d > 0 ? gruposMes.reduce((s, v, i) => s + v * dias[i], 0) / d : 0;
    };
    const r2 = (v) => Number(v.toFixed(2));

    const listaPerfis = [...perfis.entries()].map(([perfil, p]) => {
      const ritmo = p.gruposHoje.length
        ? p.gruposHoje.reduce((s, g) => s + g.entregaMes, 0) / p.gruposHoje.length
        : 0;
      const gruposMes = p.plano.map((v, i) => (ritmo > 0 && dias[i] > 0 ? v / (ritmo * dias[i] / DIAS_REF) : 0));
      return {
        perfil,
        ritmo: Math.round(ritmo),
        gruposHoje: p.gruposHoje.sort((a, b) => b.entregaMes - a.entregaMes),
        plano: p.plano.map(Math.round),
        totalPlano: Math.round(p.plano.reduce((a, b) => a + b, 0)),
        gruposMes: gruposMes.map(r2),
        media: r2(media(gruposMes)),
        nivelado: r2(nivelado(gruposMes)),
        pico: r2(Math.max(0, ...gruposMes)),
        refs: p.refs.sort((a, b) => b.total - a.total),
      };
    }).sort((a, b) => b.totalPlano - a.totalPlano);

    const porPerfil = new Map(listaPerfis.map((p) => [p.perfil, p]));
    const usados = new Set();
    const blocos = BLOCOS_SETUP.map((b) => {
      const itens = b.perfis.map((pf) => porPerfil.get(pf)).filter(Boolean);
      itens.forEach((p) => usados.add(p.perfil));
      const gruposMes = mesesAno.map((_, i) => itens.reduce((s, p) => s + p.gruposMes[i], 0));
      const saldoMes = gruposMes.map((v) => r2(b.proposta - v));
      // Saldo ACUMULADO em grupos-mes: o que sobra num mes vira estoque para o seguinte.
      let acum = 0;
      const saldoAcum = gruposMes.map((v, i) => {
        acum += (b.proposta - v) * dias[i] / DIAS_REF;
        return r2(acum);
      });
      return {
        bloco: b.bloco,
        perfis: itens.map((p) => p.perfil),
        proposta: b.proposta,
        motivo: b.motivo,
        hoje: itens.reduce((s, p) => s + p.gruposHoje.length, 0),
        plano: mesesAno.map((_, i) => itens.reduce((s, p) => s + p.plano[i], 0)),
        totalPlano: itens.reduce((s, p) => s + p.totalPlano, 0),
        gruposMes: gruposMes.map(r2),
        media: r2(media(gruposMes)),
        nivelado: r2(nivelado(gruposMes)),
        saldoMes,
        saldoAcum,
      };
    });
    const foraDeBloco = listaPerfis.filter((p) => !usados.has(p.perfil)).map((p) => p.perfil);

    return res.json({
      success: true,
      ano: base.ano,
      loteId: base.loteId,
      janela: base.janela,
      mesesAno,
      dias,
      totalPlano: base.totalPlano,
      gruposHoje: base.grupos.filter((g) => g.ativa).length,
      perfis: listaPerfis,
      blocos,
      foraDeBloco,
    });
  } catch (error) {
    console.error('[analise-capacidade/setup-ideal] Erro:', error);
    return res.status(500).json({ success: false, error: 'Erro ao montar o setup ideal', details: error.message });
  }
});

/**
 * GET /api/analise-capacidade/execucao-ideal
 *
 * Foto da EXECUCAO IDEAL DE 2027 (P10), gerada por
 * `scripts/analise_capacidade_execucao_ideal.py` e versionada em
 * `docs/analise-capacidade/execucao-ideal-2027.json`. E foto de proposito: e um rascunho em
 * discussao com o PCP, e cada versao precisa ficar no historico do git.
 */
router.get('/execucao-ideal', auth, (_req, res) => {
  try {
    const arquivo = path.join(__dirname, '../../docs/analise-capacidade/execucao-ideal-2027.json');
    if (!fs.existsSync(arquivo)) return res.json({ success: true, data: null });
    return res.json({ success: true, data: JSON.parse(fs.readFileSync(arquivo, 'utf8')) });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Erro ao ler a execução ideal', details: error.message });
  }
});

/**
 * GET /api/analise-capacidade/conclusoes
 *
 * O registro das conclusoes vive no REPOSITORIO, nao no banco nem em `data/`: o disco do
 * Render e efemero, e escrever no banco pede aprovacao. Versionado no git, cada conclusao
 * tem data, autor e historico de mudanca — que e o que uma investigacao precisa.
 */
router.get('/conclusoes', auth, (_req, res) => {
  try {
    const texto = fs.existsSync(CONCLUSOES_PATH) ? fs.readFileSync(CONCLUSOES_PATH, 'utf8') : '';
    const stat = fs.existsSync(CONCLUSOES_PATH) ? fs.statSync(CONCLUSOES_PATH) : null;
    return res.json({ success: true, texto, atualizadoEm: stat ? stat.mtime.toISOString() : null });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Erro ao ler conclusões', details: error.message });
  }
});

module.exports = router;
