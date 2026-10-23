#!/usr/bin/env node
// Confere os numeros de hoje contra um baseline gravado em data/baselines/.
//
// Para que serve: os numeros da Cobertura do Plano e da Capacidade x Venda foram conferidos
// a mao e aprovados. Se um deles mudar sem que a mudanca tenha sido pedida, e regressao —
// e sem um ponto de comparacao isso passa despercebido por semanas.
//
// ATENCAO ao ler o resultado: o plano e VIVO. O plano restante e o realizado de venda mudam
// o dia inteiro porque as pessoas estao trabalhando nele. O que NAO deveria mudar sozinho e
// a forma das contas: a curva do mes, a capacidade diaria, o plano por mes do lote nos meses
// ja fechados. Diferenca grande nesses e sinal de problema; diferenca pequena no restante e
// so o dia passando.
//
// Uso:  node scripts/conferir-baseline.mjs [arquivo-do-baseline] [url-da-api]

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'data/baselines';
const arquivo = process.argv[2]
  || join(DIR, readdirSync(DIR).filter((f) => f.endsWith('.json')).sort().pop());
const API = process.argv[3] || process.env.API_URL || 'http://localhost:8000';

const base = JSON.parse(readFileSync(arquivo, 'utf8'));
console.log(`baseline: ${arquivo}  (capturado em ${base.capturadoEm}, commit ${String(base.commit).slice(0, 7)})`);
console.log(`api:      ${API}\n`);

// Senha da API: do ambiente, ou lida do .env — o script e para rodar a mao, sem ritual.
const senhaDoEnv = () => {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  try {
    const linha = readFileSync('.env', 'utf8').split(String.fromCharCode(10)).find((l) => l.startsWith('ADMIN_PASSWORD='));
    return linha ? linha.slice('ADMIN_PASSWORD='.length).trim() : '';
  } catch { return ''; }
};
const senha = senhaDoEnv();
const buscar = async (rota) => {
  const r = await fetch(`${API}${rota}`, senha ? { headers: { Authorization: `Bearer ${senha}` } } : undefined);
  if (!r.ok) throw new Error(`${rota} -> HTTP ${r.status}`);
  return r.json();
};

const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : String(v));
let mudancas = 0;
const comparar = (rotulo, antes, agora, tolerancia = 0) => {
  const a = Number(antes), b = Number(agora);
  const difere = Number.isFinite(a) && Number.isFinite(b)
    ? Math.abs(b - a) > tolerancia
    : String(antes) !== String(agora);
  if (!difere) return;
  mudancas += 1;
  const delta = Number.isFinite(a) && Number.isFinite(b) ? `  (${b > a ? '+' : ''}${fmt(b - a)})` : '';
  console.log(`  ${rotulo.padEnd(34)} ${fmt(antes).padStart(12)} -> ${fmt(agora).padStart(12)}${delta}`);
};

const [gap, plano, venda] = await Promise.all([
  buscar('/api/capacidade/gap-mensal'),
  buscar('/api/producao/plano-por-mes-real'),
  buscar('/api/producao/vendas-mes-atual'),
]);

console.log('COBERTURA DO PLANO (dias) — tolerancia 0,05d');
for (const m of gap.meses || []) {
  const b = base.coberturaPlano?.[m.periodo];
  if (!b) continue;
  comparar(`${m.periodo} dias necessarios`, b.diasNecessarios, m.diasNecessarios, 0.05);
  comparar(`${m.periodo} dias disponiveis`, b.diasDisponiveis, m.diasDisponiveis, 0);
  comparar(`${m.periodo} gap`, b.gap, m.gap, 0.05);
}
comparar('capacidade diaria total', base.capacidadeDiariaTotal, gap.capacidadeDiariaTotal, 1);

console.log('\nPLANO POR MES DO LOTE (pecas) — tolerancia 1');
for (const [mes, v] of Object.entries(plano.data || {})) {
  const b = base.planoPorMesDoLote?.[mes];
  if (!b) { console.log(`  ${mes.padEnd(34)} ${'(novo)'.padStart(12)} -> ${fmt(Math.round(v.qtdLote))}`); mudancas += 1; continue; }
  comparar(`${mes} qt lote`, b.qtdLote, Math.round(v.qtdLote), 1);
  comparar(`${mes} ja virou OP`, b.qtdGerouOp, Math.round(v.qtdGerouOp), 1);
}

console.log('\nCURVA DO MES — nao deveria mudar sozinha');
comparar('fracao esperada', base.vendaMesCorrente?.fracaoVendaEsperada, venda.fracaoVendaEsperada, 0.005);
comparar('meses na amostra', base.vendaMesCorrente?.curvaMesesAmostra, venda.curvaMesesAmostra, 0);
comparar('dias no mes', base.vendaMesCorrente?.diasNoMes, venda.diasNoMes, 0);

console.log(mudancas === 0
  ? '\nTudo igual ao baseline.'
  : `\n${mudancas} valor(es) diferentes. Veja o aviso no topo deste arquivo antes de concluir que e bug.`);
