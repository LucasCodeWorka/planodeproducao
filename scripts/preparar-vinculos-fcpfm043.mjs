// Lote do FCPFM043 (vincular despesas EXISTENTES ao plano 500 / CC 506) a partir da
// classificação de despesas do orçamento. Generaliza o preparo de 16/10/2026 (que era fixo
// nas 42 daquela conciliação). Somente leitura no banco. Uso:
//   node scripts/preparar-vinculos-fcpfm043.mjs CLASSIFICACAO.json [ACAO=VINCULAR_PLANO]
// Saída: .agents/totvs_agent_minimo/data/lote-fcpfm043-AAAA-MM-DD.json, no formato que o
// .agents/totvs_agent_minimo/scripts/vincular_42_fcpfm043_2026_10_16.py lê (--lote).
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const [arqClassificacao, acaoArg] = process.argv.slice(2);
const acao = acaoArg && !acaoArg.startsWith('--') ? acaoArg : 'VINCULAR_PLANO';
if (!arqClassificacao) throw new Error('Uso: node scripts/preparar-vinculos-fcpfm043.mjs CLASSIFICACAO.json [ACAO]');
const classificacao = JSON.parse(fs.readFileSync(arqClassificacao, 'utf8'));

// Mesmo critério de 16/10: o trecho mais curto da descrição (só letras, números e espaço —
// a digitação virtual do TOTVS já trocou "/" por "@") que acha a despesa sozinha na busca.
function filtroUnico(descricao, universo) {
  const texto = descricao.trim().toUpperCase();
  let melhor = null;
  for (const [minimo, maximo] of [[12, 40], [8, 11]]) {
    for (let tamanho = Math.min(minimo, texto.length); tamanho <= Math.min(maximo, texto.length); tamanho++) {
      for (let inicio = texto.length - tamanho; inicio >= 0; inicio--) {
        const trecho = texto.slice(inicio, inicio + tamanho).trim();
        if (trecho.length < 8 || /[^A-Z0-9 ]/.test(trecho)) continue;
        const achados = universo.filter((item) => item.includes(trecho));
        if (achados.length === 1) return { texto: trecho, resultados: 1 };
        if (achados.length && (!melhor || achados.length < melhor.resultados)) melhor = { texto: trecho, resultados: achados.length };
      }
    }
  }
  if (melhor && melhor.resultados <= 7) return melhor; // o vinculador recusa mais de 7 na grade
  return null;
}

const pool = new pg.Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
  options: '-c default_transaction_read_only=on -c statement_timeout=120000', max: 1,
});
try {
  const todas = (await pool.query(`SELECT cd_despesaitem::int AS codigo, ds_despesaitem AS descricao FROM public.vr_fcp_despesaitem`)).rows;
  const jaNoPlano = new Set((await pool.query(`SELECT cd_despesaitem::int AS codigo FROM public.vr_fcp_planoctai WHERE cd_planoctac = 500 AND cd_ccusto = 506 AND cd_despesaitem IS NOT NULL`)).rows.map((r) => r.codigo));
  const porCodigo = new Map(todas.map((x) => [x.codigo, String(x.descricao || '').trim()]));
  const universo = todas.map((x) => String(x.descricao || '').trim().toUpperCase());

  const porDespesa = new Map();
  for (const i of classificacao.itens.filter((x) => x.acao === acao && x.despesa)) {
    const g = porDespesa.get(i.despesa) || { totalCentavos: 0, mps: [] };
    g.totalCentavos += i.futuroCentavos + i.compradoCentavos; g.mps.push(i.mp);
    porDespesa.set(i.despesa, g);
  }
  const itens = []; const semFiltro = []; const jaVinculadas = [];
  for (const [codigo, g] of porDespesa) {
    if (jaNoPlano.has(codigo)) { jaVinculadas.push(codigo); continue; }
    const descricao = porCodigo.get(codigo);
    if (!descricao) throw new Error(`Despesa ${codigo} não existe no cadastro do ERP`);
    const filtro = filtroUnico(descricao, universo);
    if (!filtro) { semFiltro.push({ codigo, descricao }); continue; }
    itens.push({ codigo, descricao, filtro, totalCentavos: g.totalCentavos, mps: g.mps });
  }
  itens.sort((a, b) => a.filtro.resultados - b.filtro.resultados || b.totalCentavos - a.totalCentavos);
  const hoje = new Date().toISOString().slice(0, 10);
  const iSaida = process.argv.indexOf('--saida');
  const destino = iSaida > 0 ? process.argv[iSaida + 1] : `.agents/totvs_agent_minimo/data/lote-fcpfm043-${hoje}.json`;
  fs.writeFileSync(destino, JSON.stringify({
    fonte: arqClassificacao, plano: 500, centroCusto: 506, pai: 26081,
    despesas: itens.length, valorCentavos: itens.reduce((s, x) => s + x.totalCentavos, 0),
    semFiltro, jaVinculadas, itens,
  }, null, 2) + '\n', 'utf8');
  const porResultados = itens.reduce((a, x) => ((a[x.filtro.resultados] = (a[x.filtro.resultados] || 0) + 1), a), {});
  console.log(JSON.stringify({ destino, despesas: itens.length, porResultadosNaBusca: porResultados, semFiltro: semFiltro.length, jaVinculadas: jaVinculadas.length,
    exemplo: itens.slice(0, 3).map((x) => `${x.codigo} "${x.filtro.texto}" (${x.filtro.resultados}) ${x.descricao}`) }, null, 2));
} finally { await pool.end(); }
