const test = require('node:test');
const assert = require('node:assert/strict');
const { montarOpcoesCostura } = require('./preferenciasCostura');

test('ordena histórico próprio por quantidade e mantém opções sem alocação', () => {
  const historico = new Map([['Grupo B', 80], ['Grupo A', 120]]);
  const opcoes = montarOpcoesCostura(historico, new Map([['Grupo C', 1000]]), new Map([['Grupo A', 1], ['Grupo B', 1], ['Grupo C', 1]]));
  assert.deepEqual(opcoes.map((x) => [x.grupo, x.origem]), [['Grupo A', 'historico'], ['Grupo B', 'historico'], ['Grupo C', 'mix']]);
  assert.equal(opcoes[0].pecasHistorico, 120);
});

test('evidencia histórico sem capacidade e não duplica grupo inferido pelo mix', () => {
  const opcoes = montarOpcoesCostura(new Map([['A', 100], ['B', 50]]), new Map([['A', 900], ['C', 400], ['D', 100]]), new Map([['B', 1], ['C', 1]]));
  assert.deepEqual(opcoes.map((x) => x.grupo), ['A', 'B', 'C']);
  assert.equal(opcoes[0].capacidadeDisponivel, false);
  assert.deepEqual(opcoes.filter((x) => x.capacidadeDisponivel).map((x) => x.grupo), ['B', 'C']);
});

test('sem histórico, identifica as opções como mix sem atribuir produção à referência', () => {
  const opcoes = montarOpcoesCostura(null, new Map([['A', 400], ['B', 800]]), new Map([['A', 1], ['B', 1]]));
  assert.deepEqual(opcoes.map((x) => [x.grupo, x.origem]), [['B', 'mix'], ['A', 'mix']]);
  assert.equal(opcoes[0].pecasHistorico, undefined);
});

test('sem histórico próprio, mantém a revisão do PCP à frente do mix', () => {
  const opcoes = montarOpcoesCostura(null, new Map([['Mix', 900], ['PCP', 200]]), new Map([['PCP', 1], ['Mix', 1]]), ['PCP']);
  assert.deepEqual(opcoes.map((x) => [x.grupo, x.origem]), [['PCP', 'revisao'], ['Mix', 'mix']]);
});

test('histórico próprio prevalece sobre revisão e não é confundido com o mix', () => {
  const opcoes = montarOpcoesCostura(new Map([['Histórico', 200]]), new Map([['PCP', 1000]]), new Map([['Histórico', 1], ['PCP', 1]]), ['PCP']);
  assert.deepEqual(opcoes.map((x) => [x.grupo, x.origem]), [['Histórico', 'historico'], ['PCP', 'mix']]);
});
