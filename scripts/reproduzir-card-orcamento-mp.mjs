// Reproduz o card Orcamento MP a partir do cache persistido da pagina.
// Somente leitura; util para identificar periodo e idade dos dados exibidos.
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const preparo = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : null;
const precoCompleto = new Map((preparo?.linhas || []).map((row) => [row.mp, row.preco]));

const pool = new pg.Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
    ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true' }
    : undefined,
});
try {
  const { rows } = await pool.query(`
    SELECT updated_at, payload FROM public.app_orcamento_mp_cache
    WHERE cache_key='orcamento_mp_liebe'
  `);
  if (rows.length !== 1) throw new Error('Cache do Orcamento MP ausente ou duplicado');
  const { updated_at, payload } = rows[0];
  const base = payload.rowsBase || [];
  const precos = payload.priceOptionsByMp || {};
  const periodos = ['MA', 'PX', 'UL', 'QT', 'QU'];
  const finalizados = (row) => (Array.isArray(row.finalizados_detalhe) ? row.finalizados_detalhe : [])
    .filter((item) => Number(item.quantidade || 0) > 0 && Number(item.valor || 0) > 0)
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
  const valorUnitario = (row, completarPreco) => {
    if (['ALCA', 'ALÇA'].includes(String(row.artigo || '').trim().toUpperCase())) return 0;
    const mp = String(row.idmateriaprima || '').trim();
    if (completarPreco && precoCompleto.has(mp)) return precoCompleto.get(mp);
    const ultima = finalizados(row)[0];
    const preco = ultima
      ? Number(ultima.valor) / Number(ultima.quantidade)
      : Number(precos[mp]?.[0]?.value || 0);
    const fator = Number(row.fator_conversao || 1);
    return fator > 1 ? preco / fator : preco;
  };
  const calcular = (completarPreco) => periodos.map((periodo, indice) => {
    const ate = periodos.slice(0, indice + 1);
    let comprado = 0;
    let necessidade = 0;
    let folga = 0;
    let mpsSemPreco = 0;
    for (const row of base) {
      const preco = valorUnitario(row, completarPreco);
      const compradoQtd = Number(row.entrada_andamento || 0);
      const consumo = ate.reduce((soma, p) => soma + Number(row[`consumo_${p.toLowerCase()}`] || 0), 0);
      const necessidadeQtd = Math.max(0, consumo - Number(row.estoquetotal || 0) - compradoQtd);
      const valor = necessidadeQtd * preco;
      comprado += compradoQtd * preco;
      necessidade += valor;
      if (valor > 0) folga += Math.max(valor * 0.05, 250);
      if (necessidadeQtd > 0 && preco <= 0) mpsSemPreco++;
    }
    return { periodo, comprado, necessidade, folga, orcamentoMP: comprado + necessidade + folga,
      mpsSemPreco };
  });
  console.log(JSON.stringify({ updated_at, criadoEm: payload.createdAt, version: payload.version,
    linhas: base.length, opcoesPrecoCache: Object.keys(precos).length,
    resultadosCache: calcular(false), resultadosComPrecosCompletos: preparo ? calcular(true) : null }, null, 2));
} finally {
  await pool.end();
}
