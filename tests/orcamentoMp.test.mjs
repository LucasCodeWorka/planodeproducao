// Regras do orçamento de MP (frontend/app/lib/orcamentoMp.ts) — a conta que a tela
// /orcamento-mp e o preparo do FCPFM017 usam. Rodar: npm test (node --test, Node >= 23).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularFolgaOrcamento,
  artigoSemCusto,
  ultimaCompra,
  valorUnitario,
  calcularOrcamentoMp,
  periodosAte,
} from '../frontend/app/lib/orcamentoMp.ts';

const perto = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);

// Fórmula do preparo do agente ANTES de 25/11/2026, congelada como referência: o módulo novo
// tem de dar o mesmo resultado em todo caso com fator de conversão >= 1 (todas as MPs de hoje).
function calcularAntigo(row, opcoes) {
  const n = (v) => Number(v || 0);
  const periodos = ['MA', 'PX', 'UL', 'QT', 'QU'];
  const compras = (row.finalizados_detalhe || []).filter((i) => n(i.quantidade) > 0 && n(i.valor) > 0)
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
  const ultima = compras[0] ? n(compras[0].valor) / n(compras[0].quantidade) : 0;
  const artigo = String(row.artigo || '').trim().toUpperCase();
  const semCusto = artigo === 'ALCA' || artigo === 'ALÇA';
  const preco = semCusto ? 0 : (ultima || n(opcoes[row.idmateriaprima]?.[0]?.value)) / (n(row.fator_conversao) || 1);
  const consumo = periodos.map((p) => n(row[`consumo_${p.toLowerCase()}`]));
  const comprasTotal = n(row.entrada_andamento);
  const estoque = n(row.estoquetotal);
  const necessidade = Math.max(0, consumo.reduce((a, b) => a + b, 0) - estoque - comprasTotal);
  const valorNecessidade = necessidade * preco;
  const folga = valorNecessidade <= 0 ? 0 : Math.max(valorNecessidade * 0.05, 250);
  let acum = 0; let anterior = 0; const porPeriodo = {};
  periodos.forEach((p, i) => {
    acum += consumo[i];
    const necAcum = Math.max(0, acum - estoque - comprasTotal);
    const valorInd = Math.max(0, necAcum - anterior) * preco;
    porPeriodo[p] = { comprado: n(row[`entrada_${p.toLowerCase()}`]) * preco, futuro: valorInd + (valorNecessidade > 0 ? valorInd / valorNecessidade * folga : 0) };
    anterior = necAcum;
  });
  return { preco, necessidade, valorFuturo: valorNecessidade + folga, valorComprado: comprasTotal * preco, porPeriodo };
}

const base = {
  idmateriaprima: '1001350', artigo: 'RENDA', estoquetotal: 100, entrada_andamento: 50,
  consumo_ma: 40, consumo_px: 60, consumo_ul: 80, consumo_qt: 90, consumo_qu: 100,
  entrada_ma: 30, entrada_px: 20, fator_conversao: 1, unidade_compra: 'MT',
  finalizados_detalhe: [
    { data: '2026-09-01', quantidade: 10, valor: 50 },   // 5,00
    { data: '2026-10-15', quantidade: 20, valor: 130 },  // 6,50 — a mais recente
    { data: '2026-11-01', quantidade: 0, valor: 99 },    // sem quantidade: ignorada
  ],
};

test('folga: 5% da necessidade, piso de R$ 250, zero sem necessidade', () => {
  assert.deepEqual(calcularFolgaOrcamento(0), { folga: 0, porPiso: false });
  assert.deepEqual(calcularFolgaOrcamento(-10), { folga: 0, porPiso: false });
  assert.deepEqual(calcularFolgaOrcamento(1000), { folga: 250, porPiso: true });
  assert.deepEqual(calcularFolgaOrcamento(5000), { folga: 250, porPiso: true }); // empate: piso
  assert.deepEqual(calcularFolgaOrcamento(10000), { folga: 500, porPiso: false });
});

test('alça sai do custo só com o nome exato', () => {
  assert.equal(artigoSemCusto('ALCA'), true);
  assert.equal(artigoSemCusto(' alça '), true);
  assert.equal(artigoSemCusto('ALCANTARA'), false);
  assert.equal(artigoSemCusto(null), false);
  const orc = calcularOrcamentoMp({ ...base, artigo: 'ALCA' }, {});
  assert.equal(orc.preco, 0);
  assert.equal(orc.fontePreco, 'ALCA_SEM_CUSTO');
  assert.equal(orc.valorOrcamentoTotal, 0);
  assert.ok(orc.necessidadeTotal > 0, 'a quantidade da alça continua valendo');
});

test('preço: última compra válida mais recente, depois custo TOTVS, depois sem preço', () => {
  assert.equal(ultimaCompra(base), 6.5);
  assert.deepEqual(valorUnitario(base, { 1001350: [{ value: 9 }] }), { valor: 6.5, origem: 'Ultima compra', fonte: 'ULTIMA_COMPRA' });
  const semCompra = { ...base, finalizados_detalhe: [] };
  assert.equal(valorUnitario(semCompra, { 1001350: [{ value: 9 }] }).fonte, 'CUSTO_TOTVS');
  assert.equal(valorUnitario(semCompra, { 1001350: [{ value: 9 }] }).valor, 9);
  assert.deepEqual(valorUnitario(semCompra, {}), { valor: 0, origem: 'Sem valor', fonte: 'SEM_PRECO' });
});

test('fator de conversão divide só quando é maior que 1 (regra da tela)', () => {
  assert.equal(valorUnitario({ ...base, fator_conversao: 1000, unidade_compra: 'MIL' }, {}).valor, 0.0065);
  assert.equal(valorUnitario({ ...base, fator_conversao: 1000, unidade_compra: 'MIL' }, {}).origem, 'Ultima compra (MIL/1000)');
  // Fator < 1 não divide. O preparo antigo dividia — era a divergência; hoje nenhuma MP tem.
  assert.equal(valorUnitario({ ...base, fator_conversao: 0.5 }, {}).valor, 6.5);
  assert.equal(valorUnitario({ ...base, fator_conversao: 0 }, {}).valor, 6.5);
});

test('necessidade = consumo até o período − estoque − compras em andamento, nunca negativa', () => {
  const orc = calcularOrcamentoMp(base, {}, 'QU');
  assert.equal(orc.consumoAte, 370);
  assert.equal(orc.necessidadeTotal, 370 - 100 - 50);
  perto(orc.valorNecessidadeTotal, 220 * 6.5, 'valor');
  assert.equal(calcularOrcamentoMp(base, {}, 'MA').necessidadeTotal, 0);
  assert.equal(calcularOrcamentoMp(base, {}, 'UL').necessidadeTotal, 180 - 150);
  assert.deepEqual(periodosAte('UL'), ['MA', 'PX', 'UL']);
});

test('por período: o futuro nasce onde o estoque acaba e soma o orçamento', () => {
  const orc = calcularOrcamentoMp(base, {}, 'QU');
  perto(orc.porPeriodo.MA.futuro + orc.porPeriodo.PX.futuro, 0, 'até PX ainda tem estoque');
  assert.ok(orc.porPeriodo.UL.futuro > 0);
  const soma = Object.values(orc.porPeriodo).reduce((s, p) => s + p.futuro, 0);
  perto(soma, orc.valorOrcamentoTotal, 'soma dos períodos');
  perto(orc.porPeriodo.MA.comprado, 30 * 6.5, 'comprado do período');
  perto(orc.valorComComprado, orc.valorOrcamentoTotal + 50 * 6.5, 'orçamento + comprado');
});

test('paridade com o preparo antigo do agente (fator >= 1)', () => {
  const casos = [
    base,
    { ...base, fator_conversao: 1000, unidade_compra: 'MIL' },
    { ...base, finalizados_detalhe: [] },
    { ...base, artigo: 'ALÇA' },
    { ...base, estoquetotal: 10000 },
    { ...base, consumo_qu: 0, entrada_andamento: 0, estoquetotal: 0 },
  ];
  const precos = { 1001350: [{ value: 9 }] };
  for (const row of casos) {
    const novo = calcularOrcamentoMp(row, precos, 'QU');
    const antigo = calcularAntigo(row, precos);
    perto(novo.preco, antigo.preco, 'preço');
    perto(novo.necessidadeTotal, antigo.necessidade, 'necessidade');
    perto(novo.valorOrcamentoTotal, antigo.valorFuturo, 'futuro');
    perto(novo.valorComprasTotal, antigo.valorComprado, 'comprado');
    for (const p of ['MA', 'PX', 'UL', 'QT', 'QU']) {
      perto(novo.porPeriodo[p].futuro, antigo.porPeriodo[p].futuro, `futuro ${p}`);
      perto(novo.porPeriodo[p].comprado, antigo.porPeriodo[p].comprado, `comprado ${p}`);
    }
  }
});
