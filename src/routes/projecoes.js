const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { aplicarReprojecaoMes, REPROJECAO_REGRAS_FIXAS } = require('../services/reprojecaoFechada');

const router = express.Router();

const DATA_DIR  = path.join(__dirname, '../../data');
const PROJ_FILE = path.join(DATA_DIR, 'projecoes.json');
const MATRIZ_FILE = path.join(DATA_DIR, 'matriz_cache.json');
const DE_PARA_FILE = path.join(DATA_DIR, 'de_para_referencias.json');

// ── Calcula períodos automaticamente ────────────────────────────────────────
/**
 * Retorna os períodos do plano de produção baseado na data atual.
 * Se estamos no último dia do mês, considera o próximo mês como MA.
 * Regras:
 * - MA (mês atual): próximo mês se último dia, senão mês atual
 * - PX (próximo): MA + 1 mês
 * - UL (último): MA + 2 meses
 * - QT (quarto): MA + 3 meses
 */
function calcularPeriodos() {
  const hoje = new Date();
  const mesAtualJs = hoje.getMonth(); // 0-11
  const ano = hoje.getFullYear();
  const diaAtual = hoje.getDate();

  // Último dia do mês atual
  const ultimoDia = new Date(ano, mesAtualJs + 1, 0).getDate();
  const eUltimoDia = diaAtual === ultimoDia;

  // Se é último dia, considera próximo mês como MA, senão usa o atual
  let ma = eUltimoDia ? mesAtualJs + 2 : mesAtualJs + 1; // +1 pois getMonth() retorna 0-11

  // Normaliza para 1-12
  if (ma > 12) ma -= 12;

  // Períodos sequenciais: MA, MA+1, MA+2, MA+3
  const px = ma + 1 > 12 ? ma + 1 - 12 : ma + 1;
  const ul = ma + 2 > 12 ? ma + 2 - 12 : ma + 2;
  const qt = ma + 3 > 12 ? ma + 3 - 12 : ma + 3;

  return { MA: ma, PX: px, UL: ul, QT: qt };
}

// ── autenticação (igual ao admin.js) ─────────────────────────────────────────
function auth(req, res, next) {
  const token    = (req.headers.authorization || '').replace('Bearer ', '').trim();
  const expected = (process.env.ADMIN_PASSWORD || '').trim();
  if (!expected) return res.status(500).json({ success: false, error: 'ADMIN_PASSWORD não configurado' });
  if (token !== expected) return res.status(401).json({ success: false, error: 'Não autorizado' });
  next();
}

// ── helpers ───────────────────────────────────────────────────────────────────
function lerProjecoes() {
  try {
    const raw = fs.readFileSync(PROJ_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { timestamp: null, data: {} };
  }
}

function salvarProjecoes(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROJ_FILE, JSON.stringify({ timestamp: Date.now(), data }, null, 2), 'utf-8');
}

function lerMatrizCache() {
  try {
    const raw = fs.readFileSync(MATRIZ_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.data) ? parsed.data : [];
  } catch {
    return [];
  }
}

function lerDeParaReferencias() {
  try {
    const raw = fs.readFileSync(DE_PARA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.data) ? parsed.data : [];
  } catch {
    return [];
  }
}

function normalizarTextoComparacao(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function cloneMeses(meses) {
  return Object.fromEntries(
    Object.entries(meses || {}).map(([mes, qtd]) => [String(mes), Number(qtd) || 0])
  );
}

async function buscarProdutosPorReferencias(pool, referencias) {
  const refs = [...new Set(
    (Array.isArray(referencias) ? referencias : [])
      .map((ref) => String(ref || '').trim())
      .filter(Boolean)
  )];

  if (!refs.length) return [];

  const result = await pool.query(`
    SELECT
      a.cd_produto::TEXT AS idproduto,
      f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar)::TEXT AS referencia,
      COALESCE(a.ds_cor, '')::TEXT AS cor,
      COALESCE(a.ds_tamanho, '')::TEXT AS tamanho
    FROM vr_prd_prdgrade a
    WHERE f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar)::TEXT = ANY($1::TEXT[])
    ORDER BY referencia, a.ds_cor, a.ds_tamanho, a.cd_produto
  `, [refs]);

  return result.rows.map((row) => ({
    idproduto: String(row.idproduto || '').trim(),
    referencia: String(row.referencia || '').trim(),
    cor: String(row.cor || '').trim(),
    tamanho: String(row.tamanho || '').trim(),
  }));
}

function escolherOrigemPorSku(produtosAntigos, produtoNovo, indiceNovo) {
  if (!Array.isArray(produtosAntigos) || !produtosAntigos.length) return null;

  const cor = normalizarTextoComparacao(produtoNovo?.cor);
  const tamanho = normalizarTextoComparacao(produtoNovo?.tamanho);

  const matchExato = produtosAntigos.find((item) =>
    normalizarTextoComparacao(item.cor) === cor &&
    normalizarTextoComparacao(item.tamanho) === tamanho
  );
  if (matchExato) return matchExato;

  const matchTamanho = produtosAntigos.find((item) =>
    normalizarTextoComparacao(item.tamanho) === tamanho
  );
  if (matchTamanho) return matchTamanho;

  const matchCor = produtosAntigos.find((item) =>
    normalizarTextoComparacao(item.cor) === cor
  );
  if (matchCor) return matchCor;

  return produtosAntigos[indiceNovo] || produtosAntigos[0] || null;
}

async function montarProjecoesEfetivas(pool) {
  const { data: projecoesOriginais, timestamp } = lerProjecoes();
  const dePara = lerDeParaReferencias();

  if (!pool || !dePara.length) {
    return { data: projecoesOriginais, timestamp, deParaAplicado: [] };
  }

  const referencias = [];
  for (const item of dePara) {
    const antiga = String(item?.ref_antiga || '').trim();
    const nova = String(item?.ref_nova || '').trim();
    if (antiga) referencias.push(antiga);
    if (nova) referencias.push(nova);
  }

  const produtos = await buscarProdutosPorReferencias(pool, referencias);
  const produtosPorReferencia = new Map();
  for (const produto of produtos) {
    if (!produtosPorReferencia.has(produto.referencia)) {
      produtosPorReferencia.set(produto.referencia, []);
    }
    produtosPorReferencia.get(produto.referencia).push(produto);
  }

  const efetivas = Object.fromEntries(
    Object.entries(projecoesOriginais || {}).map(([id, meses]) => [String(id), cloneMeses(meses)])
  );
  const deParaAplicado = [];

  for (const item of dePara) {
    const refAntiga = String(item?.ref_antiga || '').trim();
    const refNova = String(item?.ref_nova || '').trim();
    if (!refAntiga || !refNova) continue;

    const produtosAntigos = produtosPorReferencia.get(refAntiga) || [];
    const produtosNovos = produtosPorReferencia.get(refNova) || [];
    if (!produtosAntigos.length || !produtosNovos.length) continue;

    let aplicados = 0;
    for (let i = 0; i < produtosNovos.length; i += 1) {
      const produtoNovo = produtosNovos[i];
      const idNovo = String(produtoNovo.idproduto || '').trim();
      if (!idNovo || efetivas[idNovo]) continue;

      const origem = escolherOrigemPorSku(produtosAntigos, produtoNovo, i);
      const idAntigo = String(origem?.idproduto || '').trim();
      if (!idAntigo || !projecoesOriginais[idAntigo]) continue;

      efetivas[idNovo] = cloneMeses(projecoesOriginais[idAntigo]);
      aplicados += 1;
    }

    if (aplicados > 0) {
      deParaAplicado.push({
        ref_antiga: refAntiga,
        ref_nova: refNova,
        produtos_copiados: aplicados,
      });
    }
  }

  return { data: efetivas, timestamp, deParaAplicado };
}

async function montarMetaPorId(pool, ids) {
  const idsValidos = [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  )];

  const metaPorId = new Map();
  for (const item of lerMatrizCache()) {
    const id = String(item?.produto?.idproduto || '').trim();
    if (!id) continue;
    metaPorId.set(id, {
      referencia: item?.produto?.referencia || '',
      produto: item?.produto?.produto || item?.produto?.apresentacao || '',
      continuidade: item?.produto?.continuidade || 'SEM CONTINUIDADE',
    });
  }

  if (!pool || !idsValidos.length) return metaPorId;

  const idsFaltantes = idsValidos.filter((id) => !metaPorId.has(id));
  if (!idsFaltantes.length) return metaPorId;

  const result = await pool.query(`
    SELECT
      a.cd_produto::TEXT AS idproduto,
      COALESCE(f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar), '')::TEXT AS referencia,
      COALESCE(f_dic_prd_nivel(a.cd_produto, 'DS'::bpchar), a.nm_produto, '')::TEXT AS produto,
      COALESCE(f_dic_prd_classificacao(a.cd_produto, 'DS'::text, 802::bigint), 'SEM CONTINUIDADE')::TEXT AS continuidade
    FROM vr_prd_prdgrade a
    WHERE a.cd_produto::TEXT = ANY($1::TEXT[])
  `, [idsFaltantes]);

  for (const row of result.rows) {
    const id = String(row.idproduto || '').trim();
    if (!id) continue;
    metaPorId.set(id, {
      referencia: String(row.referencia || '').trim(),
      produto: String(row.produto || '').trim(),
      continuidade: String(row.continuidade || 'SEM CONTINUIDADE').trim(),
    });
  }

  return metaPorId;
}

/**
 * Converte qualquer representação de mês para número 1-12.
 * Aceita: número ("1"–"12"), abrev PT ("JAN"–"DEZ"), nome completo PT, MA/PX/UL/QT.
 * Retorna null se inválido.
 */
function parsearMes(raw) {
  const v = String(raw || '').trim().toUpperCase().replace(/[.\-\/]/, '');

  // Número direto (1–12)
  const n = parseInt(v, 10);
  if (!isNaN(n) && n >= 1 && n <= 12) return n;

  // Calcula períodos dinamicamente
  const periodos = calcularPeriodos();

  // Mapeamento por nome/abrev
  const nomes = {
    JAN: 1, JANEIRO: 1,
    FEV: 2, FEVEREIRO: 2,
    MAR: 3, MARCO: 3, MARÇO: 3,
    ABR: 4, ABRIL: 4,
    MAI: 5, MAIO: 5,
    JUN: 6, JUNHO: 6,
    JUL: 7, JULHO: 7,
    AGO: 8, AGOSTO: 8,
    SET: 9, SETEMBRO: 9,
    OUT: 10, OUTUBRO: 10,
    NOV: 11, NOVEMBRO: 11,
    DEZ: 12, DEZEMBRO: 12,
    // Períodos do plano (calculados dinamicamente)
    MA: periodos.MA,
    PX: periodos.PX,
    UL: periodos.UL,
    QT: periodos.QT,
  };

  return nomes[v] ?? null;
}

/**
 * Parseia CSV: idproduto,mes,qtd  (primeira linha = header).
 * mes aceita número 1-12 ou nome PT.
 * Retorna { registros, erros }.
 */
function parsearCSV(texto) {
  const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (linhas.length < 2) throw new Error('CSV vazio ou sem dados');

  const sep    = linhas[0].includes(';') ? ';' : ',';
  const header = linhas[0].split(sep).map(h => h.trim().toLowerCase());

  // aceita variações de nome nas colunas
  const iId  = header.indexOf('idproduto') >= 0 ? header.indexOf('idproduto')  : header.indexOf('idprotudo');
  const iMes = header.indexOf('mes');
  const iQtd = header.indexOf('qtd')       >= 0 ? header.indexOf('qtd')        : header.indexOf('valor');

  if (iId < 0 || iMes < 0 || iQtd < 0) {
    throw new Error('CSV precisa ter colunas: idproduto (ou idprotudo), mes, qtd (ou valor)');
  }

  const registros = [];
  const erros     = [];

  for (let i = 1; i < linhas.length; i++) {
    const cols      = linhas[i].split(sep).map(c => c.trim());
    const idproduto = cols[iId];
    const mesRaw    = cols[iMes];
    const qtdRaw    = cols[iQtd];

    if (!idproduto) continue;

    const mes = parsearMes(mesRaw);
    if (!mes) { erros.push(`Linha ${i + 1}: mês inválido "${mesRaw}"`); continue; }

    const qtd = parseFloat(String(qtdRaw).replace(',', '.'));
    if (isNaN(qtd) || qtd < 0) { erros.push(`Linha ${i + 1}: qtd inválida "${qtdRaw}"`); continue; }

    registros.push({ idproduto: String(idproduto), mes, qtd });
  }

  if (erros.length > 0 && registros.length === 0) {
    throw new Error(`Nenhuma linha válida. Erros: ${erros.slice(0, 3).join('; ')}`);
  }

  return { registros, erros };
}

// ── GET /api/projecoes ────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    const { data, timestamp, deParaAplicado } = await montarProjecoesEfetivas(pool);

    // Informa os meses atuais do plano (MA/PX/UL/QT) para o frontend
    const periodos = calcularPeriodos();

    return res.json({
      success:   true,
      timestamp: timestamp ? new Date(timestamp).toLocaleString('pt-BR') : null,
      count:     Object.keys(data).length,
      periodos,
      deParaAplicado,
      data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Erro ao carregar projeções',
      details: error.message,
    });
  }
});

// ── GET /api/projecoes/reprojecao-fechada ───────────────────────────────────
router.get('/reprojecao-fechada', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    const { data: projecoes, deParaAplicado } = await montarProjecoesEfetivas(pool);
    const ids = Object.keys(projecoes).map((v) => Number(v)).filter((n) => Number.isFinite(n));
    const agora = new Date();
    const mesAtual = agora.getMonth() + 1;
    const anoAtual = agora.getFullYear();
    const mesBase = mesAtual === 1 ? 12 : mesAtual - 1;
    const anoBase = mesAtual === 1 ? anoAtual - 1 : anoAtual;
    const periodos = calcularPeriodos();

    if (!ids.length) {
      return res.json({
        success: true,
        count: 0,
        base: { ano: anoBase, mes: mesBase },
        periodos,
        regras: REPROJECAO_REGRAS_FIXAS,
        deParaAplicado,
        sugestoes: [],
        resumo: { aumentoForte: 0, media: 0, manter: 0, quedaLeve: 0, quedaForte: 0 },
      });
    }

    const [vendasResult, metaPorId] = await Promise.all([
      pool.query(`
        SELECT
          v.idproduto::TEXT AS idproduto,
          SUM(v.qt_liquida)::FLOAT AS quantidade
        FROM vr_vendas_qtd v
        WHERE v.idproduto = ANY($1::BIGINT[])
          AND EXTRACT(YEAR FROM v.data)::INT = $2
          AND EXTRACT(MONTH FROM v.data)::INT = $3
        GROUP BY v.idproduto
      `, [ids, anoBase, mesBase]),
      montarMetaPorId(pool, ids.map(String)),
    ]);

    const vendasMap = new Map(vendasResult.rows.map((r) => [String(r.idproduto), Number(r.quantidade) || 0]));

    const resumo = { aumentoForte: 0, media: 0, manter: 0, quedaLeve: 0, quedaForte: 0 };
    const sugestoes = [];
    for (const [id, proj] of Object.entries(projecoes)) {
      const meta = metaPorId.get(id) || { referencia: '', produto: '', continuidade: 'SEM CONTINUIDADE' };
      const nomeProd = String(meta.produto || '').toUpperCase();
      if (nomeProd.includes('MEIA DE SEDA')) continue;

      const projBase = Number(proj[String(mesBase)] || 0);
      const vendaBase = Number(vendasMap.get(String(id)) || 0);
      const percentualAtendido = projBase > 0 ? (vendaBase / projBase) * 100 : 0;
      const ma = aplicarReprojecaoMes(Number(proj[String(periodos.MA)] || 0), percentualAtendido);
      const px = aplicarReprojecaoMes(Number(proj[String(periodos.PX)] || 0), percentualAtendido);
      const ul = aplicarReprojecaoMes(Number(proj[String(periodos.UL)] || 0), percentualAtendido);
      const qt = aplicarReprojecaoMes(Number(proj[String(periodos.QT)] || 0), percentualAtendido);

      if (ma.regra.acao === 'AUMENTO_CHEIO') resumo.aumentoForte += 1;
      else if (ma.regra.acao === 'MEDIA_ENTRE_ORIGINAL_E_CORRIGIDA') resumo.media += 1;
      else if (ma.regra.acao === 'MANTER') resumo.manter += 1;
      else if (ma.regra.acao === 'QUEDA_LEVE') resumo.quedaLeve += 1;
      else if (ma.regra.acao === 'QUEDA_FORTE') resumo.quedaForte += 1;

      sugestoes.push({
        idproduto: id,
        referencia: meta.referencia,
        produto: meta.produto,
        continuidade: meta.continuidade,
        base: {
          ano: anoBase,
          mes: mesBase,
          projecao: Math.round(projBase),
          venda: Math.round(vendaBase),
          percentualAtendido: Number(percentualAtendido.toFixed(1)),
        },
        regra: {
          faixa: ma.regra.faixa,
          acao: ma.regra.acao,
          descricao: ma.regra.descricao,
          sinalOperacional: ma.sinalOperacional || null,
        },
        original: {
          ma: Math.round(Number(proj[String(periodos.MA)] || 0)),
          px: Math.round(Number(proj[String(periodos.PX)] || 0)),
          ul: Math.round(Number(proj[String(periodos.UL)] || 0)),
          qt: Math.round(Number(proj[String(periodos.QT)] || 0)),
        },
        recalculada: {
          ma: ma.valor,
          px: px.valor,
          ul: ul.valor,
          qt: qt.valor,
        },
      });
    }

    sugestoes.sort((a, b) => Math.abs(b.base.percentualAtendido - 100) - Math.abs(a.base.percentualAtendido - 100));

    return res.json({
      success: true,
      count: sugestoes.length,
      base: { ano: anoBase, mes: mesBase },
      periodos,
      regras: REPROJECAO_REGRAS_FIXAS,
      deParaAplicado,
      resumo,
      sugestoes: sugestoes.slice(0, 3000),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Erro ao gerar reprojecao por mes fechado',
      details: error.message,
    });
  }
});

// ── POST /api/projecoes/upload ────────────────────────────────────────────────
router.post('/upload', auth, (req, res) => {
  try {
    let csvTexto = '';

    if (typeof req.body === 'string') {
      csvTexto = req.body;
    } else if (req.body && typeof req.body.csv === 'string') {
      csvTexto = req.body.csv;
    } else {
      return res.status(400).json({ success: false, error: 'Envie o CSV como texto no body (text/plain)' });
    }

    const { registros, erros } = parsearCSV(csvTexto);

    // Merge: substitui por produto+mês, preserva outros meses
    const { data: existente } = lerProjecoes();
    for (const r of registros) {
      if (!existente[r.idproduto]) existente[r.idproduto] = {};
      existente[r.idproduto][String(r.mes)] = r.qtd;
    }

    salvarProjecoes(existente);

    // Contagem de meses importados por número
    const mesesImportados = [...new Set(registros.map(r => r.mes))].sort((a,b) => a-b);

    return res.json({
      success:    true,
      importados: registros.length,
      produtos:   new Set(registros.map(r => r.idproduto)).size,
      meses:      mesesImportados,
      avisos:     erros,
      total:      Object.keys(existente).length
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/projecoes ─────────────────────────────────────────────────────
router.delete('/', auth, (req, res) => {
  salvarProjecoes({});
  return res.json({ success: true, message: 'Projeções removidas' });
});

// ── POST /api/projecoes/reajustes ────────────────────────────────────────────
router.post('/reajustes', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    const ano = Number(req.body?.ano) || new Date().getFullYear();
    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1; // mês atual (1-12)
    const diasNoMes = new Date(hoje.getFullYear(), mesAtual, 0).getDate();
    const dia = Math.min(hoje.getDate(), diasNoMes);
    const fatorMesAtual = diasNoMes > 0 ? dia / diasNoMes : 1;

    const limiares = {
      alerta: Number(req.body?.limiares?.alerta ?? 30),
      amarelo: Number(req.body?.limiares?.amarelo ?? 20),
      baixo: Number(req.body?.limiares?.baixo ?? 10),
    };

    const politica = {
      curto: { permiteAumentar: false, maxReducaoPct: Number(req.body?.politica?.curto?.maxReducaoPct ?? 60), maxAumentoPct: 0 },
      medio: { permiteAumentar: true, maxReducaoPct: Number(req.body?.politica?.medio?.maxReducaoPct ?? 50), maxAumentoPct: Number(req.body?.politica?.medio?.maxAumentoPct ?? 25) },
      longo: { permiteAumentar: true, maxReducaoPct: Number(req.body?.politica?.longo?.maxReducaoPct ?? 70), maxAumentoPct: Number(req.body?.politica?.longo?.maxAumentoPct ?? 60) },
    };

    const { data: projecoes, deParaAplicado } = await montarProjecoesEfetivas(pool);
    const ids = Object.keys(projecoes).map((v) => Number(v)).filter((n) => Number.isFinite(n));
    const periodos = calcularPeriodos();
    if (!ids.length) {
      return res.json({ success: true, ano, count: 0, resumo: {}, sugestoes: [], periodos, deParaAplicado });
    }

    const result = await pool.query(`
      SELECT
        v.idproduto::TEXT AS idproduto,
        EXTRACT(MONTH FROM v.data)::INT AS mes,
        SUM(v.qt_liquida)::FLOAT AS quantidade
      FROM vr_vendas_qtd v
      WHERE v.idproduto = ANY($1::BIGINT[])
        AND EXTRACT(YEAR FROM v.data)::INT = $2
      GROUP BY v.idproduto, EXTRACT(MONTH FROM v.data)
    `, [ids, ano]);

    const vendas = {};
    for (const row of result.rows) {
      const id = String(row.idproduto);
      if (!vendas[id]) vendas[id] = {};
      vendas[id][String(row.mes)] = Number(row.quantidade) || 0;
    }

    const metaPorId = await montarMetaPorId(pool, Object.keys(projecoes));

    const sugestoes = [];
    const resumo = {
      alerta30: 0,
      amarelo20: 0,
      baixo10: 0,
      estavel: 0,
      curtoReduzir: 0,
      medioAumentar: 0,
      medioReduzir: 0,
      longoAumentar: 0,
      longoReduzir: 0,
    };

    const classificarFaixa = (absDev) => {
      if (absDev >= limiares.alerta) return 'ALERTA_30';
      if (absDev >= limiares.amarelo) return 'AMARELO_20';
      if (absDev >= limiares.baixo) return 'BAIXO_10';
      return 'ESTAVEL';
    };

    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

    for (const [id, proj] of Object.entries(projecoes)) {
      const meta = metaPorId.get(id) || { referencia: '', produto: '', continuidade: 'SEM CONTINUIDADE' };
      const nomeProd = String(meta.produto || '').toUpperCase();
      if (nomeProd.includes('MEIA DE SEDA')) continue;

      const pJan = Number(proj['1'] || 0);
      const pFev = Number(proj['2'] || 0);
      const pMar = Number(proj['3'] || 0);
      const vJan = Number(vendas[id]?.['1'] || 0);
      const vFev = Number(vendas[id]?.['2'] || 0);
      const vMar = Number(vendas[id]?.['3'] || 0);
      const pMarAteHoje = pMar * fatorMesAtual;

      const dJan = pJan > 0 ? ((vJan - pJan) / pJan) * 100 : 0;
      const dFev = pFev > 0 ? ((vFev - pFev) / pFev) * 100 : 0;
      const dMar = pMarAteHoje > 0 ? ((vMar - pMarAteHoje) / pMarAteHoje) * 100 : 0;
      const desvioMedio = (dJan + dFev + dMar) / 3;
      const faixa = classificarFaixa(Math.abs(desvioMedio));
      if (faixa === 'ALERTA_30') resumo.alerta30 += 1;
      else if (faixa === 'AMARELO_20') resumo.amarelo20 += 1;
      else if (faixa === 'BAIXO_10') resumo.baixo10 += 1;
      else resumo.estavel += 1;

      const pCurto = Number(proj[String(periodos.MA)] || 0);
      const pMedio = Number(proj[String(periodos.PX)] || 0);
      const pLongo = Number(proj[String(periodos.UL)] || 0);

      let adjCurtoPct = clamp(dMar, -politica.curto.maxReducaoPct, politica.curto.maxAumentoPct);
      if (!politica.curto.permiteAumentar && adjCurtoPct > 0) adjCurtoPct = 0;

      let adjMedioPct = clamp(desvioMedio * 0.8, -politica.medio.maxReducaoPct, politica.medio.maxAumentoPct);
      if (!politica.medio.permiteAumentar && adjMedioPct > 0) adjMedioPct = 0;

      let adjLongoPct = clamp(desvioMedio * 1.1, -politica.longo.maxReducaoPct, politica.longo.maxAumentoPct);
      if (!politica.longo.permiteAumentar && adjLongoPct > 0) adjLongoPct = 0;

      // força comportamento de risco/estabilidade
      if (Math.abs(desvioMedio) < limiares.baixo) {
        adjCurtoPct = 0;
        adjMedioPct = 0;
        adjLongoPct = 0;
      }

      const sCurto = Math.max(0, Math.round(pCurto * (1 + adjCurtoPct / 100)));
      const sMedio = Math.max(0, Math.round(pMedio * (1 + adjMedioPct / 100)));
      const sLongo = Math.max(0, Math.round(pLongo * (1 + adjLongoPct / 100)));

      if (adjCurtoPct < 0) resumo.curtoReduzir += 1;
      if (adjMedioPct < 0) resumo.medioReduzir += 1;
      if (adjMedioPct > 0) resumo.medioAumentar += 1;
      if (adjLongoPct < 0) resumo.longoReduzir += 1;
      if (adjLongoPct > 0) resumo.longoAumentar += 1;

      sugestoes.push({
        idproduto: id,
        referencia: meta.referencia,
        produto: meta.produto,
        continuidade: meta.continuidade,
        sinais: {
          desvioJanPct: Number(dJan.toFixed(1)),
          desvioFevPct: Number(dFev.toFixed(1)),
          desvioMarPct: Number(dMar.toFixed(1)),
          desvioMedioPct: Number(desvioMedio.toFixed(1)),
          faixa,
        },
        atual: { curto: pCurto, medio: pMedio, longo: pLongo },
        sugestao: {
          curto: { ajustePct: Number(adjCurtoPct.toFixed(1)), valor: sCurto, regra: politica.curto.permiteAumentar ? 'LIVRE' : 'SOMENTE_REDUZ' },
          medio: { ajustePct: Number(adjMedioPct.toFixed(1)), valor: sMedio },
          longo: { ajustePct: Number(adjLongoPct.toFixed(1)), valor: sLongo },
        },
      });
    }

    sugestoes.sort((a, b) => Math.abs(b.sinais.desvioMedioPct) - Math.abs(a.sinais.desvioMedioPct));

    return res.json({
      success: true,
      ano,
      periodos,
      limiares,
      politica,
      count: sugestoes.length,
      deParaAplicado,
      resumo,
      sugestoes: sugestoes.slice(0, 2000),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Erro ao gerar reajustes de projeção',
      details: error.message,
    });
  }
});

module.exports = router;
