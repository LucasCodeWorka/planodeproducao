// Coleta de leitura: matriz atual, consumo, custo TOTVS e vinculos de despesa.
// Gera uma proposta local; nao grava no banco nem no ERP.
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { createRequire } from 'node:module';
import { calcularOrcamentoMp, PERIODOS_ORCAMENTO } from '../frontend/app/lib/orcamentoMp.ts';

const require = createRequire(import.meta.url);
const { calcularPeriodosPlano } = require('../src/services/periodoPlanoService');
const { initCache } = require('../src/cache/matrizCache');
const { buscarMatrizPlanejamentoRapida } = require('../src/services/producaoService');
const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
    ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true' }
    : undefined,
});

const periodos = [...PERIODOS_ORCAMENTO];
const hoje = new Date();
const mesesPlano = calcularPeriodosPlano(hoje).datas;
const numero = (v) => Number(v || 0);
const arredondar = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

async function requisitar(base, endpoint, options = {}, timeout = 600000) {
  const response = await fetch(`${base}${endpoint}`, { ...options, signal: AbortSignal.timeout(timeout) });
  const payload = await response.json();
  if (!response.ok || payload.success !== true) {
    throw new Error(`${endpoint}: HTTP ${response.status}: ${payload.error || payload.details || 'resposta invalida'}`);
  }
  return payload;
}

// A conta por MP e a mesma da tela /orcamento-mp (25/11/2026): uma copia so, em
// frontend/app/lib/orcamentoMp.ts. Antes este script tinha a dele, e ja divergia no fator de
// conversao. O formato de saida continua o mesmo que o resto da cadeia le.
function calcular(row, opcoes) {
  const orc = calcularOrcamentoMp(row, opcoes, 'QU');
  return {
    mp: String(row.idmateriaprima || '').trim(),
    descricao: row.nome_materiaprima || '',
    artigo: String(row.artigo || '').trim().toUpperCase(),
    preco: orc.preco,
    origemPreco: orc.fontePreco,
    necessidade: orc.necessidadeTotal,
    valorFuturo: orc.valorOrcamentoTotal,
    valorComprado: orc.valorComprasTotal,
    valorOrcamento: orc.valorComComprado,
    porPeriodo: orc.porPeriodo,
  };
}

const app = express();
app.use(express.json({ limit: '20mb' }));
app.set('pool', pool);
app.use('/api/producao', require('../src/routes/producao'));
app.use('/api/consumo-mp', require('../src/routes/consumoMp'));
app.use('/api/totvs-moda', require('../src/routes/totvsModa'));

await initCache(pool);

const server = await new Promise((resolve) => {
  const value = app.listen(0, '127.0.0.1', () => resolve(value));
});

try {
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log('Buscando matriz atual no banco...');
  const matrizSemCache = process.argv.includes('--matriz-fresca');
  const matriz = matrizSemCache
    ? await buscarMatrizPlanejamentoRapida(pool, {
        limit: 5000, offset: 0, cdEmpresa: 1,
        marca: 'LIEBE', status: 'EM LINHA,NOVA COLECAO', referencias: [],
      })
    : (await requisitar(base,
        '/api/producao/matriz?limit=5000&marca=LIEBE&status=EM%20LINHA%2CNOVA%20COLECAO&prefer_cache=true',
        {}, 600000)).data || [];
  const planos = matriz.map((item) => ({
    idproduto: String(item.produto?.idproduto || ''),
    idreferencia: String(item.produto?.cd_seqgrupo || ''),
    ma: numero(item.plano?.ma), px: numero(item.plano?.px),
    ul: numero(item.plano?.ul), qt: numero(item.plano?.qt), qu: numero(item.plano?.qu),
  })).filter((p) => p.idproduto && p.ma + p.px + p.ul + p.qt + p.qu > 0);
  console.log(`Matriz: ${matriz.length} SKUs, ${planos.length} com plano.`);

  console.log('Calculando consumo atual de MP...');
  const analise = await requisitar(base, '/api/consumo-mp/analise?no_cache=true', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planos, multinivel: true }),
  });
  const mps = analise.data || [];
  console.log(`Consumo: ${mps.length} MPs.`);

  if (!process.env.ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD ausente para consulta de custo');
  console.log('Consultando custo TOTVS em lotes de 500...');
  const precos = await requisitar(base, '/api/totvs-moda/prices/mp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ADMIN_PASSWORD}` },
    body: JSON.stringify({ productCodes: mps.map((row) => String(row.idmateriaprima || '')) }),
  });

  const calculadas = mps.map((row) => calcular(row, precos.data || {}));
  const ids = calculadas.filter((row) => row.valorOrcamento > 0).map((row) => row.mp);
  const grade = (await pool.query(`
    SELECT cd_produto::text AS mp, cd_seqgrupo::text AS grupo, TRIM(cd_cor) AS cor
    FROM public.vr_prd_prdgrade WHERE cd_produto::text=ANY($1::text[])
  `, [ids])).rows;
  const grupoPorMp = new Map(grade.map((row) => [row.mp, row]));
  const despesas = (await pool.query(`
    SELECT seqgrupo::text AS grupo, TRIM(cor) AS cor, iddespesa::int AS despesa, status
    FROM public.app_mp_despesa WHERE iddespesa IS NOT NULL
  `)).rows;
  const despesaPorChave = new Map(despesas.map((row) => [`${row.grupo}::${row.cor}`, row]));
  const noPlano = new Set((await pool.query(`
    SELECT DISTINCT cd_despesaitem::int AS despesa FROM public.vr_fcp_planoctai
    WHERE cd_planoctac=500 AND cd_ccusto=506 AND cd_despesaitem IS NOT NULL
  `)).rows.map((row) => row.despesa));
  const linhas = calculadas.filter((row) => row.valorOrcamento > 0).map((row) => {
    const gradeMp = grupoPorMp.get(row.mp);
    const vinculo = gradeMp && despesaPorChave.get(`${gradeMp.grupo}::${gradeMp.cor}`);
    return {
      ...row,
      grupo: gradeMp?.grupo || null,
      cor: gradeMp?.cor || null,
      despesa: vinculo?.despesa || null,
      statusDespesa: vinculo?.status || null,
      noPlano500Cc506: vinculo ? noPlano.has(vinculo.despesa) : false,
    };
  });
  const resumo = {
    criadoEm: new Date().toISOString(),
    periodos: Object.fromEntries(periodos.map((p) => [p, mesesPlano[p].toISOString().slice(0, 7)])),
    skus: matriz.length,
    mps: mps.length,
    mpsComValor: linhas.length,
    valorFuturo: arredondar(linhas.reduce((s, row) => s + row.valorFuturo, 0)),
    valorComprado: arredondar(linhas.reduce((s, row) => s + row.valorComprado, 0)),
    semDespesa: linhas.filter((row) => !row.despesa).length,
    comDespesaForaPlano: linhas.filter((row) => row.despesa && !row.noPlano500Cc506).length,
    semPrecoComNecessidade: calculadas.filter((row) => row.necessidade > 0 && row.origemPreco === 'SEM_PRECO').length,
  };
  const semPrecoComNecessidade = calculadas
    .filter((row) => row.necessidade > 0 && row.origemPreco === 'SEM_PRECO');
  const destino = path.resolve(process.argv[2] || process.env.ORCAMENTO_PREPARO_SAIDA
    || '.agents/totvs_agent_minimo/data/preparo-fcpfm017-atual.json');
  fs.writeFileSync(destino, JSON.stringify({ resumo, linhas, semPrecoComNecessidade }, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ resumo, arquivo: destino }, null, 2));
  console.log('SEM_DESPESA', linhas.filter((row) => !row.despesa).map((row) => ({ mp: row.mp, valor: arredondar(row.valorOrcamento) })));
  console.log('FORA_PLANO_TOP_30', linhas.filter((row) => row.despesa && !row.noPlano500Cc506)
    .sort((a, b) => b.valorOrcamento - a.valorOrcamento).slice(0, 30)
    .map((row) => ({ mp: row.mp, despesa: row.despesa, valor: arredondar(row.valorOrcamento) })));
} finally {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
}
