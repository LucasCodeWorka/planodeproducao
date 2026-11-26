// Plano efetivo: a simulação só vale nos períodos dela e só onde não há lote lançado (25/11/2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { periodosLancados, entradaSimulada, planoEfetivo } = require('../src/lib/planoEfetivo.js');

const matriz = [{ plano: { ma: 10, px: 0, ul: 5 } }, { plano: { ma: 0, px: 0, ul: 0 } }];
test('períodos lançados = os que têm plano na matriz', () => {
  const l = periodosLancados(matriz);
  assert.ok(l.has('MA') && l.has('UL'));
  assert.ok(!l.has('PX') && !l.has('NV'));
});
test('simulação não sobrescreve período lançado nem período fora da lista dela', () => {
  const lancados = periodosLancados(matriz);
  const item = { plano: { ma: 10, px: 0, ul: 5, nv: 0, dz: 0 } };
  const sim = entradaSimulada({ ma: 99, px: 7, ul: 99, nv: 30, dz: 40 }, { lotePeriodos: ['nv', 'PX'] });
  const r = planoEfetivo(item, sim, lancados);
  assert.equal(r.plano.ma, 10);   // lançado: matriz
  assert.equal(r.plano.ul, 5);    // lançado: matriz
  assert.equal(r.plano.px, 7);    // sem lote e na lista: simulação
  assert.equal(r.plano.nv, 30);   // sem lote e na lista: simulação
  assert.equal(r.plano.dz, 0);    // fora da lista: matriz
  assert.deepEqual(r.simulados.sort(), ['NV', 'PX']);
});
test('sem lista de períodos, a simulação vale em todo período sem lote', () => {
  const r = planoEfetivo({ plano: { ma: 10 } }, entradaSimulada({ ma: 1, qz: 9 }, {}), periodosLancados(matriz));
  assert.equal(r.plano.ma, 10);
  assert.equal(r.plano.qz, 9);
});
test('sem simulação, é a matriz', () => {
  const item = { plano: { ma: 3 } };
  assert.equal(planoEfetivo(item, undefined, new Set()).plano, item.plano);
});
