/**
 * DE-PARA de referencias e de cor usado pelo plano.
 *
 * Fonte unica: data/de_para_referencias.json. Dois modos:
 *   REFERENCIA - ref_antiga != ref_nova; o SKU novo herda o antigo casando cor + tamanho.
 *   COR        - mesma referencia, muda so a cor (ex.: KISS ME LOVE -> MALAGUETA).
 *                Origem e destino sao filtrados por cor e o casamento e so por tamanho,
 *                porque a cor muda de proposito.
 *
 * `vigencia_inicio` ("YYYY-MM") liga o par a partir daquele mes; enquanto desligado o par
 * nao existe em lugar nenhum e a referencia antiga segue inteira no plano. Sem o campo o
 * par vale sempre, que e o comportamento dos pares cadastrados antes desta mudanca.
 */

const fs = require('fs');
const path = require('path');
const { isExcludedReference } = require('./planningExclusions');

const DE_PARA_FILE = path.join(__dirname, '..', '..', 'data', 'de_para_referencias.json');

function normalizeCompare(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim();
}

/**
 * Mes de referencia para avaliar a vigencia. DE_PARA_DATA_REF permite simular meses
 * futuros (ex.: DE_PARA_DATA_REF=2027-01) sem mexer no relogio da maquina.
 */
function mesReferencia(dataRef) {
  const bruto = String(dataRef || process.env.DE_PARA_DATA_REF || '').trim();
  if (/^\d{4}-\d{2}$/.test(bruto)) return bruto;
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

function mesProjetadoReferencia(mes, dataRef) {
  const mesNum = Number(mes);
  if (!Number.isFinite(mesNum) || mesNum < 1 || mesNum > 12) return null;

  const ref = mesReferencia(dataRef);
  const anoBase = Number(ref.slice(0, 4));
  const mesBase = Number(ref.slice(5, 7));
  const anoProjetado = mesNum >= mesBase ? anoBase : anoBase + 1;
  return `${anoProjetado}-${String(mesNum).padStart(2, '0')}`;
}

function parAtivoNoMes(par, mes, options = {}) {
  if (!par?.vigenciaInicio) return true;
  const mesProjetado = mesProjetadoReferencia(mes, options.dataRef);
  return Boolean(mesProjetado && par.vigenciaInicio <= mesProjetado);
}

function lerArquivo() {
  try {
    if (!fs.existsSync(DE_PARA_FILE)) return [];
    const json = JSON.parse(fs.readFileSync(DE_PARA_FILE, 'utf8'));
    return Array.isArray(json?.data) ? json.data : [];
  } catch (error) {
    console.warn('[de-para] erro ao ler arquivo de referencias:', error.message);
    return [];
  }
}

/** Ordem estavel para o casamento nao depender da ordem em que o banco devolveu as linhas. */
function ordenarSku(a, b) {
  const corA = normalizeCompare(a?.cor);
  const corB = normalizeCompare(b?.cor);
  if (corA !== corB) return corA < corB ? -1 : 1;
  const tamA = normalizeCompare(a?.tamanho);
  const tamB = normalizeCompare(b?.tamanho);
  if (tamA !== tamB) return tamA < tamB ? -1 : 1;
  return Number(a?.idproduto || 0) - Number(b?.idproduto || 0);
}

/**
 * Le e valida os pares do arquivo. Devolve todos, cada um com `ativo` ja resolvido
 * contra a vigencia — quem so quer os que valem agora usa carregarParesAtivos().
 */
function carregarPares(options = {}) {
  const mesAtual = mesReferencia(options.dataRef);
  const pares = [];

  for (const item of lerArquivo()) {
    const refAntiga = String(item?.ref_antiga || '').trim();
    const refNova = String(item?.ref_nova || '').trim();
    if (!refAntiga || !refNova) continue;
    if (isExcludedReference(refAntiga) || isExcludedReference(refNova)) continue;

    const corAntiga = normalizeCompare(item?.cor_antiga);
    const corNova = normalizeCompare(item?.cor_nova);
    const modo = corAntiga || corNova ? 'COR' : 'REFERENCIA';

    if (modo === 'COR' && (!corAntiga || !corNova || corAntiga === corNova)) {
      console.warn(`[de-para] par ${refAntiga}->${refNova} ignorado: modo COR exige cor_antiga e cor_nova preenchidas e diferentes`);
      continue;
    }

    // Mesma referencia so faz sentido quando a cor muda. Sem essa guarda o SKU casaria
    // consigo mesmo e seria removido da matriz como se fosse a linha antiga.
    if (modo === 'REFERENCIA' && refAntiga === refNova) {
      console.warn(`[de-para] par ${refAntiga} ignorado: ref_antiga igual a ref_nova sem troca de cor`);
      continue;
    }

    const vigenciaInicio = String(item?.vigencia_inicio || '').trim() || null;
    // "YYYY-MM" compara corretamente como string.
    const ativo = !vigenciaInicio || vigenciaInicio <= mesAtual;

    pares.push({
      refAntiga,
      refNova,
      corAntiga: corAntiga || null,
      corNova: corNova || null,
      modo,
      vigenciaInicio,
      ativo,
      grupo: String(item?.grupo || '').trim() || null,
      descricao: String(item?.descricao || '').trim(),
    });
  }

  return pares;
}

function carregarParesAtivos(options = {}) {
  return carregarPares(options).filter((par) => par.ativo);
}

/** Referencias que precisam ser buscadas no cadastro para resolver estes pares. */
function referenciasParaBuscar(pares) {
  const refs = new Set();
  for (const par of pares || []) {
    if (par?.refAntiga) refs.add(par.refAntiga);
    if (par?.refNova) refs.add(par.refNova);
  }
  return [...refs];
}

/** SKUs da referencia antiga que este par leva embora (no modo COR, so os da cor antiga). */
function selecionarOrigens(produtos, par) {
  const lista = Array.isArray(produtos) ? produtos.slice().sort(ordenarSku) : [];
  if (par?.modo !== 'COR') return lista;
  return lista.filter((p) => normalizeCompare(p?.cor) === par.corAntiga);
}

/** SKUs da referencia nova que podem receber (no modo COR, so os da cor nova). */
function selecionarDestinos(produtos, par) {
  const lista = Array.isArray(produtos) ? produtos.slice().sort(ordenarSku) : [];
  if (par?.modo !== 'COR') return lista;
  return lista.filter((p) => normalizeCompare(p?.cor) === par.corNova);
}

/**
 * Destinos de uma origem, com os pesos somando 1. Lista vazia quando nao ha equivalente:
 * o chamador entao deixa a linha antiga visivel em vez de funde-la num SKU sem relacao.
 * Nao existe fallback posicional — casar por posicao junta SKUs arbitrarios.
 */
function escolherDestinosParaOrigem(destinos, origem, par) {
  if (!Array.isArray(destinos) || !destinos.length) return [];

  const cor = normalizeCompare(origem?.cor);
  const tamanho = normalizeCompare(origem?.tamanho);

  const mesmoTamanho = destinos.filter((d) => normalizeCompare(d?.tamanho) === tamanho);
  if (!mesmoTamanho.length) return [];

  // No modo COR a cor muda de proposito, entao o tamanho ja identifica o equivalente.
  if (par?.modo === 'COR') return [{ destino: mesmoTamanho[0], peso: 1 }];

  const exato = mesmoTamanho.find((d) => normalizeCompare(d?.cor) === cor);
  if (exato) return [{ destino: exato, peso: 1 }];

  // A cor antiga nao existe na referencia nova. Rateia entre as cores novas do mesmo
  // tamanho: preserva a demanda da referencia inteira sem inflar uma cor so, que e o que
  // aconteceria ao despejar todas as cores que saem na primeira do destino.
  const peso = 1 / mesmoTamanho.length;
  return mesmoTamanho.map((destino) => ({ destino, peso }));
}

module.exports = {
  DE_PARA_FILE,
  normalizeCompare,
  mesReferencia,
  mesProjetadoReferencia,
  parAtivoNoMes,
  carregarPares,
  carregarParesAtivos,
  referenciasParaBuscar,
  selecionarOrigens,
  selecionarDestinos,
  escolherDestinosParaOrigem,
};
