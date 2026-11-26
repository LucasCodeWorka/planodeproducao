// Pedidos de compra das MPs do orçamento: o item aponta para a despesa certa no plano 500/CC 506?
// Sem isso o TOTVS não soma o comprado contra o orçado (FCPFM017) e o controle fica cego.
// Somente leitura. Uso:
//   node scripts/auditar-despesas-pedidos-orcamento-mp.mjs PREPARO.json [LOTE_CRIACAO.json]
// Esperado por MP: app_mp_despesa (grupo+cor) -> despesa; a linha dela no plano 500/CC 506
// (vr_fcp_planoctai.nr_seqplanoctai). Para as criadas hoje e ainda sem app_mp_despesa, o nome
// exato do lote de criação. Real: vr_cmp_pedidoidesp (item), vr_cmp_pedidocdesp (capa) e o
// padrão do produto em vr_prd_prddesp (o que pedido NOVO herda).
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const [arqPreparo, arqCriacao] = process.argv.slice(2);
if (!arqPreparo) throw new Error('Uso: node scripts/auditar-despesas-pedidos-orcamento-mp.mjs PREPARO.json [LOTE_CRIACAO.json]');
const preparo = JSON.parse(fs.readFileSync(arqPreparo, 'utf8'));
const criacao = arqCriacao ? JSON.parse(fs.readFileSync(arqCriacao, 'utf8')) : { itens: [] };
const mps = preparo.linhas.filter((l) => l.valorOrcamento > 0);
const ids = mps.map((l) => String(l.mp));
const norm = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();

const pool = new pg.Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
  options: '-c default_transaction_read_only=on -c statement_timeout=180000', max: 1,
});
try {
  const q = async (sql, p) => (await pool.query(sql, p)).rows;
  const [grade, local, plano, nomes, itens, despItem, despCapa, padrao] = await Promise.all([
    q(`SELECT cd_produto::text mp, cd_seqgrupo::text grupo, TRIM(cd_cor) cor, nm_produto FROM vr_prd_prdgrade WHERE cd_produto::text = ANY($1)`, [ids]),
    q(`SELECT seqgrupo::text grupo, TRIM(cor) cor, iddespesa::int despesa FROM app_mp_despesa WHERE iddespesa IS NOT NULL`),
    q(`SELECT cd_despesaitem::int despesa, nr_seqplanoctai::int seq FROM vr_fcp_planoctai WHERE cd_planoctac = 500 AND cd_ccusto = 506 AND cd_despesaitem IS NOT NULL`),
    q(`SELECT cd_despesaitem::int despesa, ds_despesaitem nome FROM vr_fcp_despesaitem`),
    q(`SELECT cd_empresa::int empresa, cd_pedido::text pedido, cd_produto::text mp, cd_fornecedor::text fornecedor, tp_situacao::text situacao,
              dt_preventrega, qt_pendente::float qt, vl_pendente::float valor, cd_ccusto::text cc_item
         FROM vr_cmp_pedidoi WHERE cd_produto::text = ANY($1) AND COALESCE(qt_pendente, 0) > 0`, [ids]),
    q(`SELECT cd_empresa::int empresa, cd_pedido::text pedido, cd_produto::text mp, cd_despesaitem::int despesa, cd_ccusto::int cc, nr_seqctaplano::int seq, pr_rateio::float rateio
         FROM vr_cmp_pedidoidesp WHERE cd_produto::text = ANY($1)`, [ids]),
    q(`SELECT DISTINCT d.cd_empresa::int empresa, d.cd_pedido::text pedido, d.cd_despesaitem::int despesa, d.cd_ccusto::int cc, d.nr_seqctaplano::int seq
         FROM vr_cmp_pedidocdesp d JOIN vr_cmp_pedidoi i ON i.cd_empresa = d.cd_empresa AND i.cd_pedido = d.cd_pedido
        WHERE i.cd_produto::text = ANY($1) AND COALESCE(i.qt_pendente, 0) > 0`, [ids]),
    q(`SELECT cd_empresa::int empresa, cd_produto::text mp, cd_despesaitem::int despesa, cd_ccusto::int cc FROM vr_prd_prddesp WHERE cd_produto::text = ANY($1)`, [ids]),
  ]);
  const gradeMp = new Map(grade.map((g) => [g.mp, g]));
  const localGc = new Map(local.map((l) => [`${l.grupo}|${l.cor}`, l.despesa]));
  const seqPlano = new Map(plano.map((p) => [p.despesa, p.seq]));
  const porNome = new Map(); for (const n of nomes) { const k = norm(n.nome); if (!porNome.has(k)) porNome.set(k, []); porNome.get(k).push(n.despesa); }
  const nomeDesp = new Map(nomes.map((n) => [n.despesa, n.nome]));
  const criadaGc = new Map();
  for (const c of criacao.itens) { const achados = porNome.get(norm(c.descricao)) || []; if (achados.length === 1) criadaGc.set(`${c.seqgrupo}|${c.cor}`, achados[0]); }
  const agrupa = (rows, chave) => { const m = new Map(); for (const r of rows) { const k = chave(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
  const itemDesp = agrupa(despItem, (r) => `${r.empresa}|${r.pedido}|${r.mp}`);
  const capaDesp = agrupa(despCapa, (r) => `${r.empresa}|${r.pedido}`);
  const padraoMp = agrupa(padrao, (r) => r.mp);
  const esperadaDe = (mp) => { const g = gradeMp.get(mp); if (!g) return null; const k = `${g.grupo}|${g.cor}`; return localGc.get(k) ?? criadaGc.get(k) ?? null; };

  const linhas = itens.map((it) => {
    const esperada = esperadaDe(it.mp);
    const seq = esperada ? seqPlano.get(esperada) ?? null : null;
    const reais = itemDesp.get(`${it.empresa}|${it.pedido}|${it.mp}`) || [];
    const capa = capaDesp.get(`${it.empresa}|${it.pedido}`) || [];
    let situacao;
    if (!esperada) situacao = 'MP_SEM_DESPESA_ESPERADA';
    else if (!seq) situacao = 'DESPESA_ESPERADA_FORA_DO_PLANO';
    else if (!reais.length) situacao = capa.length ? 'SO_NA_CAPA' : 'SEM_DESPESA';
    else if (reais.length > 1) situacao = 'RATEADO';
    else if (reais[0].despesa !== esperada) situacao = 'DESPESA_DIFERENTE';
    else if (reais[0].cc !== 506) situacao = 'CC_DIFERENTE';
    else if (reais[0].seq !== seq) situacao = 'SEM_LINHA_DO_PLANO';
    else situacao = 'OK';
    return { ...it, descricao: gradeMp.get(it.mp)?.nm_produto || '', esperada, nomeEsperada: nomeDesp.get(esperada) || null, seqEsperada: seq,
      atual: reais.map((r) => ({ despesa: r.despesa, nome: nomeDesp.get(r.despesa) || null, cc: r.cc, seq: r.seq, rateio: r.rateio })),
      capa: capa.map((c) => ({ despesa: c.despesa, cc: c.cc, seq: c.seq })), situacao };
  });
  const produtos = mps.map((l) => {
    const esperada = esperadaDe(String(l.mp));
    const atuais = padraoMp.get(String(l.mp)) || [];
    const ok = esperada && atuais.length === 1 && atuais[0].despesa === esperada && atuais[0].cc === 506;
    return { mp: String(l.mp), esperada, atual: atuais.map((a) => `${a.despesa}/CC${a.cc}`), ok: Boolean(ok) };
  });
  const resumo = {};
  for (const l of linhas) {
    const r = resumo[l.situacao] || (resumo[l.situacao] = { itens: 0, pedidos: new Set(), mps: new Set(), valor: 0 });
    r.itens++; r.pedidos.add(`${l.empresa}|${l.pedido}`); r.mps.add(l.mp); r.valor += l.valor;
  }
  const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const hoje = new Date().toISOString().slice(0, 10);
  const iSaida = process.argv.indexOf('--saida');
  const arq = iSaida > 0 ? process.argv[iSaida + 1] : `.agents/totvs_agent_minimo/data/auditoria-despesas-pedidos-${hoje}.json`;
  fs.writeFileSync(arq, JSON.stringify({ calculadoEm: new Date().toISOString(), linhas, produtos }, null, 2) + '\n');
  console.log(JSON.stringify({
    arquivo: arq,
    itensPendentes: linhas.length, pedidos: new Set(linhas.map((l) => `${l.empresa}|${l.pedido}`)).size,
    porSituacao: Object.fromEntries(Object.entries(resumo).sort((a, b) => b[1].valor - a[1].valor).map(([k, v]) => [k, { itens: v.itens, pedidos: v.pedidos.size, mps: v.mps.size, valorPendente: brl(v.valor) }])),
    cadastroDoProduto: { mps: produtos.length, ok: produtos.filter((p) => p.ok).length, semPadrao: produtos.filter((p) => !p.atual.length).length, diferente: produtos.filter((p) => p.atual.length && !p.ok).length },
  }, null, 2));
} finally { await pool.end(); }
