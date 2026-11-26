// Lote de troca de despesa nos itens de pedido de compra (CMPFM045), a partir da auditoria
// de despesas dos pedidos. Só entram itens com valor pendente cuja despesa CERTA já está no
// plano 500/CC 506 e que hoje apontam para outra despesa (DESPESA_DIFERENTE).
// Ordem: pedido a pedido, do maior valor pendente para o menor; dentro do pedido por grupo,
// cor e tamanho (o caminho que o bot percorre na grade). Somente leitura. Uso:
//   node scripts/preparar-lote-cmpfm045.mjs AUDITORIA.json [--excluir PEDIDO:PRODUTO,...]
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const [arq] = process.argv.slice(2);
if (!arq) throw new Error('Uso: node scripts/preparar-lote-cmpfm045.mjs AUDITORIA.json [--excluir PEDIDO:PRODUTO,...]');
const iExc = process.argv.indexOf('--excluir');
const excluir = new Set(iExc > 0 ? String(process.argv[iExc + 1] || '').split(',').filter(Boolean) : []);
const auditoria = JSON.parse(fs.readFileSync(arq, 'utf8'));
const alvo = auditoria.linhas.filter((l) => l.valor > 0.5 && l.situacao === 'DESPESA_DIFERENTE' && l.atual.length === 1 && !excluir.has(`${l.pedido}:${l.mp}`));

const pool = new pg.Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
  options: '-c default_transaction_read_only=on -c statement_timeout=120000', max: 1,
});
try {
  const rows = (await pool.query(`
    SELECT i.cd_empresa::int empresa, i.cd_pedido::text pedido, i.cd_produto::text mp, i.cd_ultnivel::text grupo,
           TRIM(g.cd_cor) cor, TRIM(g.ds_tamanho) tamanho
      FROM vr_cmp_pedidoi i JOIN vr_prd_prdgrade g ON g.cd_produto = i.cd_produto
     WHERE i.cd_produto::text = ANY($1) AND COALESCE(i.qt_pendente, 0) > 0`, [alvo.map((l) => l.mp)])).rows;
  const nav = new Map(rows.map((r) => [`${r.empresa}|${r.pedido}|${r.mp}`, r]));
  const pedidos = new Map();
  const semNavegacao = [];
  for (const l of alvo) {
    const n = nav.get(`${l.empresa}|${l.pedido}|${l.mp}`);
    if (!n) { semNavegacao.push(`${l.pedido}:${l.mp}`); continue; }
    const p = pedidos.get(l.pedido) || { empresa: l.empresa, pedido: l.pedido, valor: 0, itens: [] };
    p.valor += l.valor;
    p.itens.push({ produto: l.mp, grupo: n.grupo, cor: n.cor, tamanho: n.tamanho, descricao: l.descricao,
      despesaAtual: l.atual[0].despesa, despesaNova: l.esperada, nomeNova: l.nomeEsperada, valor: Math.round(l.valor * 100) / 100 });
    pedidos.set(l.pedido, p);
  }
  const ordem = [...pedidos.values()].sort((a, b) => b.valor - a.valor);
  for (const p of ordem) p.itens.sort((a, b) => a.grupo.localeCompare(b.grupo) || a.cor.localeCompare(b.cor, 'pt', { numeric: true }) || a.tamanho.localeCompare(b.tamanho, 'pt', { numeric: true }));
  const hoje = new Date().toISOString().slice(0, 10);
  const iSaida = process.argv.indexOf('--saida');
  const destino = iSaida > 0 ? process.argv[iSaida + 1] : `.agents/totvs_agent_minimo/data/lote-cmpfm045-${hoje}.json`;
  const itens = ordem.reduce((s, p) => s + p.itens.length, 0);
  fs.writeFileSync(destino, JSON.stringify({ fonte: arq, status: 'PREPARADO_NAO_LANCADO', pedidos: ordem.length, itens, semNavegacao, ordem }, null, 2) + '\n');
  console.log(JSON.stringify({ destino, pedidos: ordem.length, itens, valor: Math.round(ordem.reduce((s, p) => s + p.valor, 0)), semNavegacao: semNavegacao.length,
    primeiros: ordem.slice(0, 5).map((p) => `${p.pedido}: ${p.itens.length} itens, R$ ${Math.round(p.valor)}`) }, null, 2));
} finally { await pool.end(); }
