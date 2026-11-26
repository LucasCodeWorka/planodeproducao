// O roteador /api/producao exige login nas gravações e em todo o orçamento de MP (25/11/2026).
// Sobe o roteador num express local, sem banco: o portão responde antes de qualquer consulta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const express = require('express');

process.env.ADMIN_PASSWORD = 'senha-de-teste';
const router = require('../src/routes/producao.js');

async function subir() {
  const app = express();
  app.use(express.json());
  // Banco falso que recusa tudo: com o token, a rota passa do portão e cai aqui (500).
  const recusa = async () => { throw new Error('sem banco no teste'); };
  app.set('pool', { query: recusa, connect: recusa });
  app.use('/api/producao', router);
  const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/producao`;
  return { base, fechar: () => new Promise((ok) => server.close(ok)) };
}

test('gravações e orçamento sem token: 401; com token: passa do portão', async () => {
  const { base, fechar } = await subir();
  try {
    const casos = [
      ['POST', '/orcamento-mp-cache'],
      ['DELETE', '/orcamento-mp-cache'],
      ['POST', '/orcamento-mp-exportacao'],
      ['DELETE', '/orcamento-mp-snapshot/1'],
      ['PATCH', '/orcamento-mp-despesas/1'],
      ['POST', '/mp-cadastro'],
      ['GET', '/orcamento-mp-cache'],
      ['GET', '/orcamento-mp-snapshots'],
    ];
    for (const [method, rota] of casos) {
      const sem = await fetch(base + rota, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
      assert.equal(sem.status, 401, `${method} ${rota} sem token`);
      const errado = await fetch(base + rota, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer outra' }, body: method === 'GET' ? undefined : '{}' });
      assert.equal(errado.status, 401, `${method} ${rota} com token errado`);
      const com = await fetch(base + rota, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer senha-de-teste' }, body: method === 'GET' ? undefined : '{}' });
      assert.notEqual(com.status, 401, `${method} ${rota} com token`);
    }
  } finally { await fechar(); }
});

test('leitura do plano continua aberta (o portão não barra)', async () => {
  const { base, fechar } = await subir();
  try {
    const r = await fetch(`${base}/locais`);
    assert.notEqual(r.status, 401);
  } finally { await fechar(); }
});
