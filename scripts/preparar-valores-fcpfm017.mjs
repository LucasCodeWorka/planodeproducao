// Coleta de leitura: matriz atual, consumo, custo TOTVS e vinculos de despesa.
// Gera uma proposta local; nao grava no banco nem no ERP.
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { createRequire } from 'node:module';

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

const periodos = ['MA', 'PX', 'UL', 'QT', 'QU'];
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

function ultimaCompra(row) {
  const compras = (Array.isArray(row.finalizados_detalhe) ? row.finalizados_detalhe : [])
    .filter((item) => numero(item.quantidade) > 0 && numero(item.valor) > 0)
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
  return compras[0] ? numero(compras[0].valor) / numero(compras[0].quantidade) : 0;
}

function calcular(row, opcoes) {
  const id = String(row.idmateriaprima || '').trim();
  const artigo = String(row.artigo || '').trim().toUpperCase();
  const semCusto = artigo === 'ALCA' || artigo === 'ALÇA';
  const ultima = ultimaCompra(row);
  const custoTotvs = numero(opcoes[id]?.[0]?.value);
  const fator = numero(row.fator_conversao) || 1;
  const preco = semCusto ? 0 : (ultima || custoTotvs) / fator;
  const consumo = periodos.map((p) => numero(row[`consumo_${p.toLowerCase()}`]));
  const compras = periodos.map((p) => numero(row[`entrada_${p.toLowerCase()}`]));
  const comprasTotal = numero(row.entrada_andamento);
  const estoque = numero(row.estoquetotal);
  const necessidade = Math.max(0, consumo.reduce((a, b) => a + b, 0) - estoque - comprasTotal);
  const valorNecessidade = necessidade * preco;
  const folga = valorNecessidade <= 0 ? 0 : Math.max(valorNecessidade * 0.05, 250);
  const valorFuturo = valorNecessidade + folga;
  const valorComprado = comprasTotal * preco;
  let consumoAcumulado = 0;
  let necessidadeAnterior = 0;
  const porPeriodo = {};
  for (let i = 0; i < periodos.length; i++) {
    consumoAcumulado += consumo[i];
    const necessidadeAcumulada = Math.max(0, consumoAcumulado - estoque - comprasTotal);
    const necessidadeIndividual = Math.max(0, necessidadeAcumulada - necessidadeAnterior);
    const valorIndividual = necessidadeIndividual * preco;
    const folgaIndividual = valorNecessidade > 0 ? valorIndividual / valorNecessidade * folga : 0;
    porPeriodo[periodos[i]] = {
      comprado: compras[i] * preco,
      futuro: valorIndividual + folgaIndividual,
    };
    necessidadeAnterior = necessidadeAcumulada;
  }
  return {
    mp: id,
    descricao: row.nome_materiaprima || '',
    artigo,
    preco,
    origemPreco: semCusto ? 'ALCA_SEM_CUSTO' : ultima > 0 ? 'ULTIMA_COMPRA' : custoTotvs > 0 ? 'CUSTO_TOTVS' : 'SEM_PRECO',
    necessidade,
    valorFuturo,
    valorComprado,
    valorOrcamento: valorFuturo + valorComprado,
    porPeriodo,
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
