require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const ids = JSON.parse(fs.readFileSync('data/skus_usuario_novembro.json', 'utf8'));
const pedidosPlanilha = JSON.parse(fs.readFileSync('data/pedidos_usuario_novembro.json', 'utf8'));
const pool = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: String(process.env.DB_SSL).toLowerCase() === 'true' ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED).toLowerCase() === 'true' } : undefined, connectionTimeoutMillis: 20000 });
(async () => {
  const resposta = await fetch('http://127.0.0.1:8000/api/producao/vendas-mes-atual');
  if (!resposta.ok) throw new Error(`Curva de vendas indisponível: HTTP ${resposta.status}`);
  const curva = await resposta.json();
  const dia = 16;
  const decorrido = Number(curva.curvaMesAcumulada?.[dia]);
  if (!(decorrido > 0 && decorrido <= 1)) throw new Error('Curva medida de vendas indisponível para o dia 16.');
  const fator = 1 - decorrido;
  await pool.query('BEGIN READ ONLY');
  const cache = await pool.query("SELECT timestamp, data FROM app_cache WHERE key='matriz_planejamento'");
  if (!cache.rows.length) throw new Error('Matriz de planejamento não encontrada.');
  const obj = JSON.parse(cache.rows[0].data);
  const matriz = obj.data?.rows || obj.data?.data || obj.data;
  if (!Array.isArray(matriz)) throw new Error('Estrutura da matriz não reconhecida.');
  const porId = new Map(matriz.map((r) => [String(r?.produto?.idproduto || ''), r]));
  const p = await pool.query('SELECT idproduto::TEXT AS id, quantidade FROM app_projecoes WHERE ano = $1 AND mes = $2 AND idproduto::TEXT = ANY($3::TEXT[])', [2026, 11, ids]);
  const proj = new Map();
  for (const x of p.rows) {
    if (proj.has(x.id)) throw new Error(`Projeção duplicada para SKU ${x.id}.`);
    proj.set(x.id, x.quantidade === null ? null : Number(x.quantidade));
  }
  await pool.query('COMMIT');
  const linhas = ids.map(id => {
    const m = porId.get(id);
    const projecao = proj.has(id) ? proj.get(id) : null;
    const dadosValidos = m && m.estoques?.estoque_atual != null && m.estoques?.em_processo != null && m.demanda?.pedidos_pendentes != null && m.plano?.ma != null;
    return { sku: id, produto: m?.produto?.produto || '', referencia: m?.produto?.referencia || '', cor: m?.produto?.cor || '', tamanho: m?.produto?.tamanho || '', projecao, estoque: m?.estoques?.estoque_atual ?? null, processo: m?.estoques?.em_processo ?? null, pedidos: m?.demanda?.pedidos_pendentes ?? null, plano: m?.plano?.ma ?? null, minimo: m?.estoques?.estoque_minimo ?? null, pedidosPlanilha: pedidosPlanilha[id] ?? 0, encontrado: !!m, dadosValidos: !!dadosValidos };
  });
  const saida = { dataReferencia: '2026-11-16', matrizTimestamp: Number(cache.rows[0].timestamp), fator, curvaAmostra: curva.curvaMesesAmostra, linhas };
  fs.mkdirSync('outputs/novembro_skus', { recursive: true });
  fs.writeFileSync('outputs/novembro_skus/dados.json', JSON.stringify(saida));
  console.log(JSON.stringify({ total: linhas.length, encontrados: linhas.filter(x => x.encontrado).length, semMatriz: linhas.filter(x => !x.encontrado).length, comProjecao: linhas.filter(x => x.projecao !== null).length, faltamDados: linhas.filter(x => !x.dadosValidos).length, fator, curvaAmostra: curva.curvaMesesAmostra, atualizadoEm: new Date(Number(cache.rows[0].timestamp)).toISOString() }));
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
