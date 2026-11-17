const fs = require('fs');
const { carregarPares, parAtivoNoMes, selecionarDestinos, escolherDestinosParaOrigem } = require('../src/services/deParaReferencias');
const { isExcludedPlanningItem } = require('../src/services/planningExclusions');
const cadastro = JSON.parse(fs.readFileSync('outputs/novembro_skus/diagnostico_cadastro.json', 'utf8'));
const matriz = JSON.parse(fs.readFileSync('outputs/novembro_skus/matriz_destinos.json', 'utf8'));
const pares = carregarPares({dataRef:'2026-11'}).filter(p => [11,12,1,2,3,4].some(m => parAtivoNoMes(p,m,{dataRef:'2026-11'})));
const normalizar = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const porReferencia = new Map();
for (const m of matriz) {
  const ref = String(m.referencia || '').trim();
  if (!porReferencia.has(ref)) porReferencia.set(ref, []);
  porReferencia.get(ref).push(m);
}
const motivos = {};
const classificacao = {};
for (const c of cadastro.rows) {
  const partes = [];
  const marca = normalizar(c.marca);
  const status = normalizar(c.status);
  const continuidade = normalizar(c.continuidade);
  if (marca !== 'LIEBE') partes.push(`Marca ${c.marca || 'não cadastrada'} fora do filtro LIEBE`);
  if (!['EM LINHA', 'NOVA COLECAO'].includes(status)) partes.push(`Status ${c.status || 'não cadastrado'} fora do filtro EM LINHA/NOVA COLEÇÃO`);
  if (!continuidade) partes.push('Continuidade sem cadastro; pode haver herança no de-para');
  if (normalizar(c.tamanho) === 'PT 99') partes.push('Tamanho PT 99 excluído da matriz');
  if (normalizar(c.apresentacao).includes('MEIA DE SEDA')) partes.push('Produto meia de seda excluído da matriz');
  if (isExcludedPlanningItem({ referencia: c.referencia, apresentacao: c.apresentacao })) partes.push('Referência ou produto excluído das regras do planejamento');
  const compativeis = pares.filter(p => p.refAntiga === String(c.referencia || '').trim() && (p.modo !== 'COR' || normalizar(p.corAntiga) === normalizar(c.cor)));
  const origem = { idproduto: c.sku, cor: c.cor, tamanho: c.tamanho };
  for (const p of compativeis) {
    const destinos = selecionarDestinos(porReferencia.get(p.refNova) || [], p);
    const alvos = escolherDestinosParaOrigem(destinos, origem, p).filter(a => String(a.destino.idproduto) !== String(c.sku));
    if (alvos.length) partes.push(`De-para da referência ${p.refAntiga} para ${p.refNova}, com destino na matriz${p.vigenciaInicio ? ` (vigência ${p.vigenciaInicio})` : ''}; confirmar transferência`);
    else partes.push(`Referência possui de-para para ${p.refNova}, mas destino do SKU não confirmado`);
  }
  if (!partes.length) partes.push('Motivo não identificado: verificar atualização da matriz e regras de seleção');
  motivos[c.sku] = partes.join('; ');
  for (const parte of partes) {
    const k = parte.startsWith('Marca ') ? 'marca fora do filtro' : parte.startsWith('Status ') ? 'status fora do filtro' : parte.startsWith('De-para da ') ? 'de-para com destino' : parte.startsWith('Referência possui') ? 'de-para sem destino confirmado' : parte.startsWith('Motivo não') ? 'não identificado' : 'outro';
    classificacao[k] = (classificacao[k] || 0) + 1;
  }
}
fs.writeFileSync('outputs/novembro_skus/motivos.json', JSON.stringify(motivos, null, 2));
console.log(JSON.stringify({skus: Object.keys(motivos).length, causas: classificacao, exemplosNaoIdentificados: Object.keys(motivos).filter(k => motivos[k].startsWith('Motivo não')).slice(0,10)}, null, 2));
