const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { aplicarReprojecaoMes, REPROJECAO_REGRAS_FIXAS } = require('../services/reprojecaoFechada');
const { isExcludedReference, isExcludedPlanningItem } = require('../services/planningExclusions');
const { readCache } = require('../cache/matrizCache');
const projecoesService = require('../services/projecoesService');

// Flag para usar banco de dados (true) ou JSON (false)
const USAR_BANCO = true;

const router = express.Router();

const DATA_DIR  = path.join(__dirname, '../../data');
const PROJ_FILE = path.join(DATA_DIR, 'projecoes.json');
const MATRIZ_FILE = path.join(DATA_DIR, 'matriz_cache.json');
const DE_PARA_FILE = path.join(DATA_DIR, 'de_para_referencias.json');
const MESES_TRANSICAO_NOVA_COLECAO = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

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

/**
 * Lê projeções do JSON (modo legado)
 */
function lerProjecoesJSON() {
  try {
    const raw = fs.readFileSync(PROJ_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { timestamp: null, data: {} };
  }
}

/**
 * Lê projeções - escolhe entre banco ou JSON baseado na flag USAR_BANCO
 * @param {Pool} pool - Pool de conexão (opcional se usar JSON)
 */
async function lerProjecoes(pool = null) {
  if (USAR_BANCO && pool) {
    try {
      const anoAtual = new Date().getFullYear();
      // Buscar ano atual e próximo para cobrir virada de ano
      const data = await projecoesService.lerProjecoesMultiplosAnos(pool, [anoAtual, anoAtual + 1]);
      const ultimaAtualizacao = await projecoesService.obterUltimaAtualizacao(pool);
      return {
        timestamp: ultimaAtualizacao ? new Date(ultimaAtualizacao).getTime() : Date.now(),
        data
      };
    } catch (error) {
      console.warn('[projecoes] Erro ao ler do banco, usando JSON:', error.message);
      return lerProjecoesJSON();
    }
  }
  return lerProjecoesJSON();
}

/**
 * Salva projeções no JSON (modo legado)
 */
function salvarProjecoesJSON(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROJ_FILE, JSON.stringify({ timestamp: Date.now(), data }, null, 2), 'utf-8');
}

/**
 * Salva projeções - escolhe entre banco ou JSON baseado na flag USAR_BANCO
 * @param {Pool} pool - Pool de conexão (opcional se usar JSON)
 * @param {Object} data - Dados no formato { idproduto: { mes: qtd, ... }, ... }
 * @param {number} ano - Ano das projeções
 */
async function salvarProjecoes(pool, data, ano = null) {
  // Sempre salvar no JSON como backup
  salvarProjecoesJSON(data);

  if (USAR_BANCO && pool) {
    const anoProjecao = ano || new Date().getFullYear();
    const registros = [];

    for (const [idproduto, meses] of Object.entries(data)) {
      if (!meses || typeof meses !== 'object') continue;

      for (const [mes, quantidade] of Object.entries(meses)) {
        const mesNum = Number(mes);
        const qtdNum = Number(quantidade);

        if (mesNum >= 1 && mesNum <= 12 && !isNaN(qtdNum) && qtdNum >= 0) {
          registros.push({
            idproduto: String(idproduto),
            mes: mesNum,
            ano: anoProjecao,
            quantidade: Math.round(qtdNum)
          });
        }
      }
    }

    if (registros.length > 0) {
      try {
        await projecoesService.ensureTabelas(pool);
        await projecoesService.importarRegistrosEmLotes(pool, registros, 'API');
        console.log(`[projecoes] ${registros.length} registros salvos no banco`);
      } catch (error) {
        console.error('[projecoes] Erro ao salvar no banco:', error.message);
      }
    }
  }
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

async function lerMatrizCacheCompleta(pool) {
  if (pool) {
    try {
      const cached = await readCache();
      const rows = cached?.data?.rows;
      if (Array.isArray(rows) && rows.length) return rows;
      const data = cached?.data?.data;
      if (Array.isArray(data) && data.length) return data;
    } catch (error) {
      console.warn('[projecoes] Erro ao ler cache da matriz:', error.message);
    }
  }

  const local = lerMatrizCache();
  if (Array.isArray(local) && local.length) return local;
  return [];
}

function lerDeParaReferencias() {
  try {
    const raw = fs.readFileSync(DE_PARA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.data)
      ? parsed.data.filter((item) => {
          const refAntiga = String(item?.ref_antiga || '').trim();
          const refNova = String(item?.ref_nova || '').trim();
          return !isExcludedReference(refAntiga) && !isExcludedReference(refNova);
        })
      : [];
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
      COALESCE(f_dic_prd_nivel(a.cd_produto, 'DS'::bpchar), a.nm_produto, '')::TEXT AS produto,
      COALESCE(a.ds_cor, '')::TEXT AS cor,
      COALESCE(a.ds_tamanho, '')::TEXT AS tamanho
    FROM vr_prd_prdgrade a
    WHERE f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar)::TEXT = ANY($1::TEXT[])
    ORDER BY referencia, a.ds_cor, a.ds_tamanho, a.cd_produto
  `, [refs]);

  return result.rows.map((row) => ({
    idproduto: String(row.idproduto || '').trim(),
    referencia: String(row.referencia || '').trim(),
    produto: String(row.produto || '').trim(),
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

function transferirProjecaoNovaColecao(projecaoAntiga, projecaoNova) {
  const origem = cloneMeses(projecaoAntiga);
  const destino = cloneMeses(projecaoNova);

  let mesesTransferidos = 0;
  let conflitosDestino = 0;
  let houveTransferencia = false;

  for (const mes of MESES_TRANSICAO_NOVA_COLECAO) {
    const valorOrigem = Number(origem[mes] || 0);
    const valorDestinoAnterior = Number(destino[mes] || 0);

    if (valorDestinoAnterior !== 0 && valorOrigem !== 0 && valorDestinoAnterior !== valorOrigem) {
      conflitosDestino += 1;
    }

    if (valorOrigem !== 0 || valorDestinoAnterior !== 0) {
      destino[mes] = valorOrigem;
      origem[mes] = 0;
      mesesTransferidos += 1;
      houveTransferencia = true;
    }
  }

  return {
    origem,
    destino,
    mesesTransferidos,
    conflitosDestino,
    houveTransferencia,
  };
}

async function montarProjecoesEfetivas(pool) {
  const { data: projecoesOriginais, timestamp } = await lerProjecoes(pool);
  const dePara = lerDeParaReferencias();

  if (!pool) {
    return { data: projecoesOriginais, timestamp, deParaAplicado: [] };
  }

  const referencias = [];
  for (const item of dePara) {
    const antiga = String(item?.ref_antiga || '').trim();
    const nova = String(item?.ref_nova || '').trim();
    if (antiga) referencias.push(antiga);
    if (nova) referencias.push(nova);
  }

  const produtos = referencias.length ? await buscarProdutosPorReferencias(pool, referencias) : [];
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
    const diagnostico = {
      ref_antiga: refAntiga,
      ref_nova: refNova,
      descricao_arquivo: String(item?.descricao || '').trim(),
      produtos_antigos: produtosAntigos.length,
      produtos_novos: produtosNovos.length,
      produtos_transferidos: 0,
      produtos_sem_origem: 0,
      antigos_sem_destino: 0,
      conflitos_destino: 0,
      meses_transferidos: 0,
      observacoes: [],
    };

    if (!produtosAntigos.length) {
      diagnostico.observacoes.push('Referencia antiga sem SKU encontrado no cadastro');
      deParaAplicado.push(diagnostico);
      continue;
    }

    if (!produtosNovos.length) {
      diagnostico.observacoes.push('Referencia nova sem SKU encontrado no cadastro');
      deParaAplicado.push(diagnostico);
      continue;
    }

    if (produtosAntigos.length !== produtosNovos.length) {
      diagnostico.observacoes.push(`Quantidade de SKUs divergente: antiga=${produtosAntigos.length}, nova=${produtosNovos.length}`);
    }

    const origensUsadas = new Set();
    for (let i = 0; i < produtosNovos.length; i += 1) {
      const produtoNovo = produtosNovos[i];
      const idNovo = String(produtoNovo.idproduto || '').trim();
      if (!idNovo) continue;

      const candidatos = produtosAntigos.filter((produto) => !origensUsadas.has(String(produto.idproduto || '').trim()));
      const origem = escolherOrigemPorSku(candidatos, produtoNovo, i);
      const idAntigo = String(origem?.idproduto || '').trim();
      if (!idAntigo) {
        diagnostico.produtos_sem_origem += 1;
        continue;
      }

      origensUsadas.add(idAntigo);

      const projecaoAntiga = efetivas[idAntigo] || projecoesOriginais[idAntigo];
      const projecaoNova = efetivas[idNovo] || projecoesOriginais[idNovo];
      if (!projecaoAntiga && !projecaoNova) continue;

      const transferencia = transferirProjecaoNovaColecao(projecaoAntiga, projecaoNova);
      efetivas[idAntigo] = transferencia.origem;
      efetivas[idNovo] = transferencia.destino;

      if (!transferencia.houveTransferencia) continue;

      diagnostico.produtos_transferidos += 1;
      diagnostico.meses_transferidos += transferencia.mesesTransferidos;
      diagnostico.conflitos_destino += transferencia.conflitosDestino;
    }

    diagnostico.antigos_sem_destino = produtosAntigos.filter((produto) => !origensUsadas.has(String(produto.idproduto || '').trim())).length;

    if (diagnostico.antigos_sem_destino > 0) {
      diagnostico.observacoes.push(`${diagnostico.antigos_sem_destino} SKU(s) da referencia antiga ficaram sem destino 1:1`);
    }

    if (diagnostico.produtos_sem_origem > 0) {
      diagnostico.observacoes.push(`${diagnostico.produtos_sem_origem} SKU(s) novos ficaram sem origem correspondente`);
    }

    if (diagnostico.conflitos_destino > 0) {
      diagnostico.observacoes.push(`${diagnostico.conflitos_destino} mes(es) do destino foram sobrescritos na transicao`);
    }

    deParaAplicado.push(diagnostico);
  }

  const dataFiltrada = await filtrarProjecoesExcluidas(pool, efetivas);
  return { data: dataFiltrada, timestamp, deParaAplicado };
}

async function filtrarProjecoesExcluidas(pool, projecoesBase) {
  const projecoes = Object.fromEntries(
    Object.entries(projecoesBase || {}).map(([id, meses]) => [String(id), cloneMeses(meses)])
  );

  const ids = Object.keys(projecoes);
  if (!pool || !ids.length) return projecoes;

  const metaPorId = await montarMetaPorId(pool, ids);
  for (const id of ids) {
    const meta = metaPorId.get(id) || {};
    if (isExcludedPlanningItem({
      referencia: meta.referencia,
      produto: meta.produto,
    })) {
      delete projecoes[id];
    }
  }

  return projecoes;
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

async function montarContextoMatrizPorId(pool, ids) {
  const idsValidos = new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );
  const contexto = new Map();
  if (!idsValidos.size) return contexto;

  const rows = await lerMatrizCacheCompleta(pool);
  for (const item of rows) {
    const id = String(item?.produto?.idproduto || '').trim();
    if (!id || !idsValidos.has(id)) continue;
    contexto.set(id, {
      estoque_atual: Number(item?.estoques?.estoque_atual || 0),
      em_processo: Number(item?.estoques?.em_processo || 0),
      pedidos_pendentes: Number(item?.demanda?.pedidos_pendentes || 0),
      plano_ma: Number(item?.plano?.ma || 0),
      plano_px: Number(item?.plano?.px || 0),
      plano_ul: Number(item?.plano?.ul || 0),
      plano_qt: Number(item?.plano?.qt || 0),
      estoque_minimo: Number(item?.estoques?.estoque_minimo || 0),
    });
  }

  return contexto;
}

function calcularFatorProjecaoMA(periodos, hoje = new Date()) {
  const mesAtual = hoje.getMonth() + 1;
  if (Number(periodos?.MA || 0) !== mesAtual) return 1;
  const anoAtual = hoje.getFullYear();
  const diasNoMesAtual = new Date(anoAtual, mesAtual, 0).getDate();
  const diaAtual = Math.min(hoje.getDate(), diasNoMesAtual);
  return Math.max(0, (diasNoMesAtual - diaAtual) / diasNoMesAtual);
}

function calcularDisponibilidadeReprojecao(contexto, periodos, projecoesMes, fatorProjecaoMA) {
  const dispBase = Number(contexto?.estoque_atual || 0) - Number(contexto?.pedidos_pendentes || 0);
  const dispMA = dispBase
    + Number(contexto?.em_processo || 0)
    + Number(contexto?.plano_ma || 0)
    - (Number(projecoesMes?.ma || 0) * fatorProjecaoMA);
  const dispPX = dispMA + Number(contexto?.plano_px || 0) - Number(projecoesMes?.px || 0);
  const dispUL = dispPX + Number(contexto?.plano_ul || 0) - Number(projecoesMes?.ul || 0);
  const dispQT = dispUL + Number(contexto?.plano_qt || 0) - Number(projecoesMes?.qt || 0);
  return { dispMA, dispPX, dispUL, dispQT };
}

function aplicarTravaNegativoReprojecao(originais, recalculadas, contexto, periodos) {
  if (!contexto) {
    return {
      ...recalculadas,
      travaNegativoAplicada: false,
      fatorTravaNegativo: 1,
    };
  }

  const fatorProjecaoMA = calcularFatorProjecaoMA(periodos);
  const dispOriginal = calcularDisponibilidadeReprojecao(contexto, periodos, originais, fatorProjecaoMA);
  const deltaMA = (Number(recalculadas.ma || 0) - Number(originais.ma || 0)) * fatorProjecaoMA;
  const deltaPX = deltaMA + (Number(recalculadas.px || 0) - Number(originais.px || 0));
  const deltaUL = deltaPX + (Number(recalculadas.ul || 0) - Number(originais.ul || 0));
  const deltaQT = deltaUL + (Number(recalculadas.qt || 0) - Number(originais.qt || 0));

  let lambda = 1;
  if (deltaMA > 0) lambda = Math.min(lambda, dispOriginal.dispMA / deltaMA);
  if (deltaPX > 0) lambda = Math.min(lambda, dispOriginal.dispPX / deltaPX);
  if (deltaUL > 0) lambda = Math.min(lambda, dispOriginal.dispUL / deltaUL);
  if (deltaQT > 0) lambda = Math.min(lambda, dispOriginal.dispQT / deltaQT);
  lambda = Math.max(0, Math.min(1, lambda));

  const ajustada = {
    ma: Math.max(0, Math.round(Number(originais.ma || 0) + (Number(recalculadas.ma || 0) - Number(originais.ma || 0)) * lambda)),
    px: Math.max(0, Math.round(Number(originais.px || 0) + (Number(recalculadas.px || 0) - Number(originais.px || 0)) * lambda)),
    ul: Math.max(0, Math.round(Number(originais.ul || 0) + (Number(recalculadas.ul || 0) - Number(originais.ul || 0)) * lambda)),
    qt: Math.max(0, Math.round(Number(originais.qt || 0) + (Number(recalculadas.qt || 0) - Number(originais.qt || 0)) * lambda)),
    travaNegativoAplicada: lambda < 0.999,
    fatorTravaNegativo: Number(lambda.toFixed(3)),
  };

  return ajustada;
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

// ── GET /api/projecoes/de-para ────────────────────────────────────────────────
// Retorna as referências do de-para (apenas antigas para exclusão da tabela)
router.get('/de-para', auth, async (req, res) => {
  try {
    const dePara = lerDeParaReferencias();
    const referenciasAntigas = new Set();

    for (const item of dePara) {
      const refAntiga = String(item?.ref_antiga || '').trim();
      if (refAntiga) referenciasAntigas.add(refAntiga);
    }

    return res.json({
      success: true,
      count: referenciasAntigas.size,
      referencias: Array.from(referenciasAntigas).sort(),
      detalhes: dePara.map(item => ({
        ref_antiga: String(item?.ref_antiga || '').trim(),
        ref_nova: String(item?.ref_nova || '').trim(),
        descricao: item?.descricao || ''
      }))
    });
  } catch (err) {
    console.error('[projecoes/de-para] Erro:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

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
    const contextoMatrizPorId = await montarContextoMatrizPorId(pool, ids.map(String));

    const vendasMap = new Map(vendasResult.rows.map((r) => [String(r.idproduto), Number(r.quantidade) || 0]));

    const resumo = { aumentoForte: 0, media: 0, manter: 0, quedaLeve: 0, quedaForte: 0 };
    const sugestoes = [];
    for (const [id, proj] of Object.entries(projecoes)) {
      const meta = metaPorId.get(id) || { referencia: '', produto: '', continuidade: 'SEM CONTINUIDADE' };
      const nomeProd = String(meta.produto || '').toUpperCase();
      if (nomeProd.includes('MEIA DE SEDA') || isExcludedPlanningItem({ referencia: meta.referencia, produto: meta.produto })) continue;

      const projBase = Number(proj[String(mesBase)] || 0);
      const vendaBase = Number(vendasMap.get(String(id)) || 0);
      const percentualAtendido = projBase > 0 ? (vendaBase / projBase) * 100 : 0;
      const variacaoPercentual = percentualAtendido - 100;
      const originalMeses = {
        ma: Number(proj[String(periodos.MA)] || 0),
        px: Number(proj[String(periodos.PX)] || 0),
        ul: Number(proj[String(periodos.UL)] || 0),
        qt: Number(proj[String(periodos.QT)] || 0),
      };
      const ma = aplicarReprojecaoMes(originalMeses.ma, percentualAtendido);
      const px = aplicarReprojecaoMes(originalMeses.px, percentualAtendido);
      const ul = aplicarReprojecaoMes(originalMeses.ul, percentualAtendido);
      const qt = aplicarReprojecaoMes(originalMeses.qt, percentualAtendido);

      const usaPonderadaComTrava = ma.regra.acao === 'AUMENTO_CHEIO';
      const usaMediaNoMesSubsequente = ma.regra.acao === 'MEDIA_ENTRE_ORIGINAL_E_CORRIGIDA';
      const usaQuedaLeveNoMesSubsequente = ma.regra.acao === 'QUEDA_LEVE';
      const recalculadaPonderada = {
        ma: Math.round((originalMeses.ma * 0.7) + (Number(ma.valorCorrigido || 0) * 0.3)),
        px: Math.round((originalMeses.px * 0.7) + (Number(px.valorCorrigido || 0) * 0.3)),
        ul: Math.round((originalMeses.ul * 0.7) + (Number(ul.valorCorrigido || 0) * 0.3)),
        qt: Math.round((originalMeses.qt * 0.7) + (Number(qt.valorCorrigido || 0) * 0.3)),
      };
      const recalculadaBase = usaPonderadaComTrava
        ? recalculadaPonderada
        : (usaMediaNoMesSubsequente || usaQuedaLeveNoMesSubsequente)
          ? { ma: originalMeses.ma, px: px.valor, ul: ul.valor, qt: qt.valor }
          : { ma: ma.valor, px: px.valor, ul: ul.valor, qt: qt.valor };
      const recalculadaFinal = usaPonderadaComTrava
        ? aplicarTravaNegativoReprojecao(
            originalMeses,
            recalculadaBase,
            contextoMatrizPorId.get(String(id)),
            periodos
          )
        : {
            ...recalculadaBase,
            travaNegativoAplicada: false,
            fatorTravaNegativo: 1,
          };

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
          variacaoPercentual: Number(variacaoPercentual.toFixed(1)),
        },
        regra: {
          faixa: ma.regra.faixa,
          acao: usaPonderadaComTrava ? 'PONDERADA_70_30_COM_TRAVA_NEGATIVO' : ma.regra.acao,
          descricao: usaPonderadaComTrava
            ? 'A partir do mes seguinte, usar 70% da projecao original + 30% da projecao corrigida pela variacao e reduzir o aumento se algum periodo ficar negativo.'
            : ma.regra.descricao,
          sinalOperacional: ma.sinalOperacional || null,
        },
        original: {
          ma: Math.round(originalMeses.ma),
          px: Math.round(originalMeses.px),
          ul: Math.round(originalMeses.ul),
          qt: Math.round(originalMeses.qt),
        },
        recalculada: {
          ma: recalculadaFinal.ma,
          px: recalculadaFinal.px,
          ul: recalculadaFinal.ul,
          qt: recalculadaFinal.qt,
        },
        travaNegativo: {
          aplicada: Boolean(recalculadaFinal.travaNegativoAplicada),
          fator: Number(recalculadaFinal.fatorTravaNegativo || 1),
        },
      });
    }

    sugestoes.sort((a, b) => Math.abs(b.base.variacaoPercentual) - Math.abs(a.base.variacaoPercentual));

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
router.post('/upload', auth, async (req, res) => {
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
    const pool = req.app.get('pool');
    const anoAtual = new Date().getFullYear();

    // Merge: substitui por produto+mês, preserva outros meses
    const { data: existente } = await lerProjecoes(pool);
    for (const r of registros) {
      if (!existente[r.idproduto]) existente[r.idproduto] = {};
      existente[r.idproduto][String(r.mes)] = r.qtd;
    }

    const saneado = await filtrarProjecoesExcluidas(pool, existente);

    // Salvar no banco e JSON
    await salvarProjecoes(pool, saneado, anoAtual);

    // Contagem de meses importados por número
    const mesesImportados = [...new Set(registros.map(r => r.mes))].sort((a,b) => a-b);

    return res.json({
      success:    true,
      importados: registros.length,
      produtos:   new Set(registros.map(r => r.idproduto)).size,
      meses:      mesesImportados,
      avisos:     erros,
      total:      Object.keys(saneado).length,
      banco:      USAR_BANCO ? 'PostgreSQL' : 'JSON'
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/projecoes ─────────────────────────────────────────────────────
router.delete('/', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    const ano = Number(req.query.ano) || new Date().getFullYear();

    // Limpar JSON
    salvarProjecoesJSON({});

    // Limpar banco se estiver usando
    if (USAR_BANCO && pool) {
      const deletados = await projecoesService.deletarProjecoesAno(pool, ano);
      return res.json({ success: true, message: `Projeções de ${ano} removidas`, deletados });
    }

    return res.json({ success: true, message: 'Projeções removidas' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
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
      if (nomeProd.includes('MEIA DE SEDA') || isExcludedPlanningItem({ referencia: meta.referencia, produto: meta.produto })) continue;

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

// ── GET /api/projecoes/sem-projecao ────────────────────────────────────────────
// Analisa itens com vendas nos últimos 3 meses mas sem projeção configurada
router.get('/sem-projecao', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    const periodos = calcularPeriodos();
    const anoAtual = new Date().getFullYear();
    const anoAnterior = anoAtual - 1;

    // 1. Buscar todas as projeções atuais
    const { data: projecoes } = await montarProjecoesEfetivas(pool);
    const idsComProjecao = new Set(Object.keys(projecoes));

    // 2. Buscar itens da matriz com vendas nos últimos 3 meses
    const rows = await lerMatrizCacheCompleta(pool);

    // 3. Coletar IDs dos produtos sem projeção para buscar vendas históricas
    const idsSemProjecao = [];
    const itensPreliminar = [];

    for (const item of rows) {
      const idproduto = String(item?.produto?.idproduto || '').trim();
      if (!idproduto) continue;

      // Verificar se tem projeção
      const temProjecao = idsComProjecao.has(idproduto);
      if (temProjecao) {
        const proj = projecoes[idproduto] || {};
        const projMA = Number(proj[String(periodos.MA)] || 0);
        const projPX = Number(proj[String(periodos.PX)] || 0);
        const projUL = Number(proj[String(periodos.UL)] || 0);
        const projQT = Number(proj[String(periodos.QT)] || 0);
        if (projMA > 0 || projPX > 0 || projUL > 0 || projQT > 0) continue;
      }

      const mediaVendas3m = Number(item?.demanda?.media_vendas_3m || 0);
      const mediaVendas6m = Number(item?.demanda?.media_vendas_6m || 0);
      const pedidosPendentes = Number(item?.demanda?.pedidos_pendentes || 0);
      const temVendas = mediaVendas3m > 0 || mediaVendas6m > 0 || pedidosPendentes > 0;

      if (!temVendas) continue;

      idsSemProjecao.push(Number(idproduto));
      itensPreliminar.push({ idproduto, item, mediaVendas3m, mediaVendas6m, pedidosPendentes });
    }

    // 4. Calcular proporção GERAL do plano (de todos os produtos com projeção)
    // Somar o total de projeções por mês de todos os produtos
    let totalPlanoMA = 0;
    let totalPlanoPX = 0;
    let totalPlanoUL = 0;
    let totalPlanoQT = 0;

    for (const [, proj] of Object.entries(projecoes)) {
      totalPlanoMA += Number(proj[String(periodos.MA)] || 0);
      totalPlanoPX += Number(proj[String(periodos.PX)] || 0);
      totalPlanoUL += Number(proj[String(periodos.UL)] || 0);
      totalPlanoQT += Number(proj[String(periodos.QT)] || 0);
    }

    const totalPlanoGeral = totalPlanoMA + totalPlanoPX + totalPlanoUL + totalPlanoQT;

    // Calcular proporção de cada mês
    let propMA = 0.25, propPX = 0.25, propUL = 0.25, propQT = 0.25; // default: distribuição uniforme
    if (totalPlanoGeral > 0) {
      propMA = totalPlanoMA / totalPlanoGeral;
      propPX = totalPlanoPX / totalPlanoGeral;
      propUL = totalPlanoUL / totalPlanoGeral;
      propQT = totalPlanoQT / totalPlanoGeral;
    }

    // 5. Montar resultado final com projeções por mês baseadas na proporção GERAL do plano
    const itensSemProjecao = [];
    const resumo = {
      totalAnalisados: rows.length,
      comProjecao: rows.length - itensPreliminar.length,
      semProjecao: itensPreliminar.length,
      semProjecaoComVendas: itensPreliminar.length,
      porCurva: { A: 0, B: 0, C: 0, D: 0, SEM: 0 },
      porContinuidade: {},
      porLinha: {},
      // Informações sobre a proporção usada
      proporcaoPlano: {
        totalMA: Math.round(totalPlanoMA),
        totalPX: Math.round(totalPlanoPX),
        totalUL: Math.round(totalPlanoUL),
        totalQT: Math.round(totalPlanoQT),
        totalGeral: Math.round(totalPlanoGeral),
        propMA: Number((propMA * 100).toFixed(1)),
        propPX: Number((propPX * 100).toFixed(1)),
        propUL: Number((propUL * 100).toFixed(1)),
        propQT: Number((propQT * 100).toFixed(1)),
      },
    };

    for (const { idproduto, item, mediaVendas3m, mediaVendas6m, pedidosPendentes } of itensPreliminar) {
      const curva = String(item?.produto?.curva || 'SEM').toUpperCase();
      if (curva === 'A') resumo.porCurva.A++;
      else if (curva === 'B') resumo.porCurva.B++;
      else if (curva === 'C') resumo.porCurva.C++;
      else if (curva === 'D') resumo.porCurva.D++;
      else resumo.porCurva.SEM++;

      const continuidade = String(item?.produto?.continuidade || 'SEM CONTINUIDADE').trim();
      resumo.porContinuidade[continuidade] = (resumo.porContinuidade[continuidade] || 0) + 1;

      const linha = String(item?.produto?.linha || 'SEM LINHA').trim();
      resumo.porLinha[linha] = (resumo.porLinha[linha] || 0) + 1;

      // Calcular projeção base (média maior entre 3m e 6m)
      const projecaoBase = Math.max(mediaVendas3m, mediaVendas6m);

      // Calcular projeção por mês baseada na proporção GERAL do plano
      // Total projetado = média * 4 meses, distribuído conforme proporção do plano
      const totalProjetado = projecaoBase * 4;
      const projMA = Math.round(totalProjetado * propMA);
      const projPX = Math.round(totalProjetado * propPX);
      const projUL = Math.round(totalProjetado * propUL);
      const projQT = Math.round(totalProjetado * propQT);

      itensSemProjecao.push({
        idproduto,
        referencia: String(item?.produto?.referencia || '').trim(),
        produto: String(item?.produto?.produto || '').trim(),
        cor: String(item?.produto?.cor || '').trim(),
        tamanho: String(item?.produto?.tamanho || '').trim(),
        curva,
        continuidade,
        linha: String(item?.produto?.linha || '').trim(),
        status: String(item?.produto?.status || '').trim(),
        vendas: {
          media_3m: Math.round(mediaVendas3m),
          media_6m: Math.round(mediaVendas6m),
          pedidos_pendentes: Math.round(pedidosPendentes),
          teve_venda_12m: item?.criterios?.teve_venda_12m === true,
        },
        estoque: {
          atual: Math.round(Number(item?.estoques?.estoque_atual || 0)),
          em_processo: Math.round(Number(item?.estoques?.em_processo || 0)),
          disponivel: Math.round(Number(item?.estoques?.estoque_disponivel || 0)),
          minimo: Math.round(Number(item?.estoques?.estoque_minimo || 0)),
        },
        projecao_sugerida: Math.round(projecaoBase),
        // Projeções por mês baseadas na proporção GERAL do plano
        projecao_ma: projMA,
        projecao_px: projPX,
        projecao_ul: projUL,
        projecao_qt: projQT,
        impacto: curva === 'A' ? 'ALTO' : curva === 'B' ? 'MEDIO' : 'BAIXO',
      });
    }

    // Ordenar por impacto (curva A primeiro, depois por média de vendas)
    itensSemProjecao.sort((a, b) => {
      const ordemCurva = { A: 1, B: 2, C: 3, D: 4, SEM: 5 };
      const curvaA = ordemCurva[a.curva] || 5;
      const curvaB = ordemCurva[b.curva] || 5;
      if (curvaA !== curvaB) return curvaA - curvaB;
      return b.vendas.media_3m - a.vendas.media_3m;
    });

    return res.json({
      success: true,
      periodos,
      ano: anoAtual,
      resumo,
      count: itensSemProjecao.length,
      itens: itensSemProjecao.slice(0, 5000),
    });
  } catch (error) {
    console.error('[projecoes/sem-projecao] Erro:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro ao analisar itens sem projeção',
      details: error.message,
    });
  }
});

// ── GET /api/projecoes/stats ──────────────────────────────────────────────────
router.get('/stats', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    const ano = Number(req.query.ano) || new Date().getFullYear();

    if (USAR_BANCO && pool) {
      await projecoesService.ensureTabelas(pool);
      const stats = await projecoesService.obterEstatisticas(pool, ano);
      const statsGeral = await projecoesService.obterEstatisticas(pool);

      return res.json({
        success: true,
        modo: 'PostgreSQL',
        ano,
        estatisticas: stats,
        porAno: statsGeral
      });
    }

    // Modo JSON
    const { data, timestamp } = lerProjecoesJSON();
    const produtos = Object.keys(data).length;
    const meses = new Set();
    let totalQuantidade = 0;

    for (const mesesProd of Object.values(data)) {
      for (const [mes, qtd] of Object.entries(mesesProd)) {
        meses.add(Number(mes));
        totalQuantidade += Number(qtd) || 0;
      }
    }

    return res.json({
      success: true,
      modo: 'JSON',
      timestamp: timestamp ? new Date(timestamp).toLocaleString('pt-BR') : null,
      estatisticas: {
        produtos,
        registros: produtos * meses.size,
        meses: [...meses].sort((a, b) => a - b),
        total_quantidade: totalQuantidade
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/projecoes/migrar-json ───────────────────────────────────────────
router.post('/migrar-json', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    const ano = Number(req.body?.ano) || new Date().getFullYear();

    if (!pool) {
      return res.status(500).json({ success: false, error: 'Pool de conexão não disponível' });
    }

    // Garantir que tabelas existem
    await projecoesService.ensureTabelas(pool);

    // Ler JSON atual
    const { data, timestamp } = lerProjecoesJSON();

    if (!data || Object.keys(data).length === 0) {
      return res.json({ success: true, message: 'Nenhum dado no JSON para migrar', importados: 0 });
    }

    // Converter para registros
    const registros = [];
    for (const [idproduto, meses] of Object.entries(data)) {
      if (!meses || typeof meses !== 'object') continue;

      for (const [mes, quantidade] of Object.entries(meses)) {
        const mesNum = Number(mes);
        const qtdNum = Number(quantidade);

        if (mesNum >= 1 && mesNum <= 12 && !isNaN(qtdNum) && qtdNum >= 0) {
          registros.push({
            idproduto: String(idproduto),
            mes: mesNum,
            ano,
            quantidade: Math.round(qtdNum)
          });
        }
      }
    }

    // Importar para o banco
    const importados = await projecoesService.importarRegistrosEmLotes(pool, registros, 'MIGRACAO');

    return res.json({
      success: true,
      message: `Migração concluída: ${importados} registros importados para ${ano}`,
      importados,
      produtos: new Set(registros.map(r => r.idproduto)).size,
      timestampOriginal: timestamp ? new Date(timestamp).toLocaleString('pt-BR') : null
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
