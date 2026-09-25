import fs from 'fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

let password = process.env.DB_PASSWORD || '';
if (password.charCodeAt(0) === 34 && password.charCodeAt(password.length - 1) === 34) {
  password = password.slice(1, -1);
}

const dePara = JSON.parse(fs.readFileSync('data/de_para_referencias.json', 'utf8')).data || [];
const refsKissMe = [
  ...new Set(
    dePara
      .filter((row) => String(row.grupo || '').trim().toUpperCase() === 'KISS ME MALAGUETA')
      .map((row) => String(row.ref_antiga || '').trim())
      .filter(Boolean)
  ),
];

const anos = process.argv.slice(2).map(Number).filter(Number.isFinite);
const anosFiltro = anos.length ? anos : [2026, 2027];

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password,
});

try {
  const sql = `
    SELECT
      p.ano,
      p.quantidade::INT AS jan,
      a.cd_produto::TEXT AS idproduto,
      COALESCE(f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar), '')::TEXT AS referencia,
      COALESCE(f_dic_prd_nivel(a.cd_produto, 'DS'::bpchar), a.nm_produto, '')::TEXT AS produto,
      COALESCE(a.ds_cor, '')::TEXT AS cor,
      COALESCE(a.ds_tamanho, '')::TEXT AS tamanho,
      COALESCE(f_dic_prd_classificacao(a.cd_produto, 'DS'::TEXT, 802::BIGINT), '')::TEXT AS continuidade
    FROM app_projecoes p
    JOIN vr_prd_prdgrade a ON a.cd_produto::TEXT = p.idproduto
    WHERE p.mes = 1
      AND p.ano = ANY($1::INT[])
      AND UPPER(TRIM(COALESCE(a.ds_cor, ''))) = 'LOVE'
      AND (
        COALESCE(f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar), '')::TEXT = ANY($2::TEXT[])
        OR UPPER(COALESCE(f_dic_prd_nivel(a.cd_produto, 'DS'::bpchar), a.nm_produto, '')) LIKE '%KISS ME%'
      )
    ORDER BY p.ano, referencia, produto, tamanho, idproduto
  `;

  const result = await pool.query(sql, [anosFiltro, refsKissMe]);
  const destinos = await pool.query(`
    SELECT
      a.cd_produto::TEXT AS idproduto,
      COALESCE(f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar), '')::TEXT AS referencia,
      COALESCE(f_dic_prd_nivel(a.cd_produto, 'DS'::bpchar), a.nm_produto, '')::TEXT AS produto,
      COALESCE(a.ds_cor, '')::TEXT AS cor,
      COALESCE(a.ds_tamanho, '')::TEXT AS tamanho
    FROM vr_prd_prdgrade a
    WHERE COALESCE(f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar), '')::TEXT = ANY($1::TEXT[])
      AND UPPER(TRIM(COALESCE(a.ds_cor, ''))) = 'MALAGUETA'
    ORDER BY referencia, produto, tamanho, idproduto
  `, [refsKissMe]);

  const totaisAno = {};
  const totaisReferencia = new Map();
  const totaisProduto = new Map();
  const destinoPorRefTamanho = new Map();
  const efetivoMalagueta = new Map();
  const semDestinoMalagueta = [];

  for (const row of destinos.rows) {
    destinoPorRefTamanho.set(`${row.referencia}|${String(row.tamanho || '').trim().toUpperCase()}`, row);
  }

  const parPorRef = new Map(
    dePara
      .filter((row) => String(row.grupo || '').trim().toUpperCase() === 'KISS ME MALAGUETA')
      .map((row) => [String(row.ref_antiga || '').trim(), row])
  );

  for (const row of result.rows) {
    totaisAno[row.ano] = (totaisAno[row.ano] || 0) + row.jan;

    const refKey = `${row.ano}|${row.referencia}|${row.produto}`;
    const ref = totaisReferencia.get(refKey) || {
      ano: row.ano,
      referencia: row.referencia,
      produto: row.produto,
      skus: 0,
      totalJan: 0,
    };
    ref.skus += 1;
    ref.totalJan += row.jan;
    totaisReferencia.set(refKey, ref);

    const prodKey = `${row.ano}|${row.produto}`;
    const prod = totaisProduto.get(prodKey) || {
      ano: row.ano,
      produto: row.produto,
      skus: 0,
      totalJan: 0,
    };
    prod.skus += 1;
    prod.totalJan += row.jan;
    totaisProduto.set(prodKey, prod);

    const par = parPorRef.get(row.referencia);
    const vigencia = String(par?.vigencia_inicio || '').trim();
    if (vigencia && `${row.ano}-01` < vigencia) continue;

    const destino = destinoPorRefTamanho.get(`${row.referencia}|${String(row.tamanho || '').trim().toUpperCase()}`);
    if (!destino) {
      semDestinoMalagueta.push(row);
      continue;
    }

    const destinoKey = `${row.ano}|${destino.idproduto}`;
    const atual = efetivoMalagueta.get(destinoKey) || {
      ano: row.ano,
      idproduto: destino.idproduto,
      referencia: destino.referencia,
      produto: destino.produto,
      cor: destino.cor,
      tamanho: destino.tamanho,
      jan: 0,
      origens: [],
    };
    atual.jan += row.jan;
    atual.origens.push(row.idproduto);
    efetivoMalagueta.set(destinoKey, atual);
  }

  const destinosAgrupados = new Map();
  for (const row of destinos.rows) {
    const key = `${row.referencia}|${row.produto}|${row.cor}`;
    const atual = destinosAgrupados.get(key) || {
      referencia: row.referencia,
      produto: row.produto,
      cor: row.cor,
      skus: 0,
    };
    atual.skus += 1;
    destinosAgrupados.set(key, atual);
  }

  console.log(JSON.stringify({
    criterio: {
      mes: 'janeiro',
      anos: anosFiltro,
      cor: 'LOVE',
      referenciasKissMe: refsKissMe,
      observacao: 'Cor filtrada por igualdade exata LOVE; LOVELY nao entra.',
    },
    totalSkus: result.rowCount,
    totaisAno,
    totaisReferencia: [...totaisReferencia.values()].sort((a, b) =>
      a.ano - b.ano || a.referencia.localeCompare(b.referencia) || a.produto.localeCompare(b.produto)
    ),
    totaisProduto: [...totaisProduto.values()].sort((a, b) =>
      a.ano - b.ano || b.totalJan - a.totalJan || a.produto.localeCompare(b.produto)
    ),
    destinosMalaguetaCadastrados: [...destinosAgrupados.values()],
    projecaoEfetivaMalaguetaJaneiro: {
      totalJan: [...efetivoMalagueta.values()].reduce((acc, row) => acc + row.jan, 0),
      skusDestino: efetivoMalagueta.size,
      semDestino: semDestinoMalagueta,
      itens: [...efetivoMalagueta.values()].sort((a, b) =>
        a.ano - b.ano || a.referencia.localeCompare(b.referencia) || a.tamanho.localeCompare(b.tamanho)
      ),
    },
    itens: result.rows,
  }, null, 2));
} finally {
  await pool.end();
}
