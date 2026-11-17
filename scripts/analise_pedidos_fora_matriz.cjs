require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const dados = JSON.parse(fs.readFileSync('outputs/novembro_skus/dados.json', 'utf8'));
const ids = dados.linhas.filter(x => !x.encontrado).map(x => x.sku);
const pool = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: String(process.env.DB_SSL).toLowerCase() === 'true' ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED).toLowerCase() === 'true' } : undefined, connectionTimeoutMillis: 20000 });
(async () => {
  const estoque = await pool.query(`SELECT cd_produto::text AS id,
    f_dic_sld_prd_produto('1'::TEXT,'1'::TEXT,cd_produto,NULL::TIMESTAMP WITHOUT TIME ZONE)::float AS estoque,
    f_prd_saldo_produto(1::BIGINT,7::BIGINT,cd_produto,NULL::TIMESTAMP WITHOUT TIME ZONE)::float AS adicional
    FROM vr_prd_prdgrade WHERE cd_produto = ANY($1::BIGINT[])`, [ids]);
  console.log('Saldos encontrados:', estoque.rows.length);
  const processo = await pool.query(`SELECT aa.cd_produto::text AS id, SUM(COALESCE(aa.qt_real,0)::float - COALESCE(aa.qt_finalizada,0)::float)::float AS quantidade FROM vr_pcp_opi aa JOIN vr_pcp_opc bb ON aa.cd_empresa=bb.cd_empresa AND aa.nr_ciclo=bb.nr_ciclo AND aa.nr_op=bb.nr_op WHERE aa.cd_empresa=1 AND COALESCE(bb.cd_categoria,0)::BIGINT<>15 AND aa.tp_situacao=ANY(ARRAY[5,10,15,20]::BIGINT[]) AND aa.cd_produto=ANY($1::BIGINT[]) GROUP BY aa.cd_produto`, [ids]);
  const pedidos = await pool.query(`SELECT cd_produto::text AS id, SUM(qt_pendente)::float AS quantidade FROM vr_ped_pedidoi WHERE cd_empresa=1 AND cd_operacao<>44 AND tp_situacao<>6 AND cd_produto=ANY($1::BIGINT[]) GROUP BY cd_produto`, [ids]);
  const plano = await pool.query(`SELECT a.cd_produto::text AS id, SUM(GREATEST(a.qt_lote-COALESCE(a.qt_gerouop,0),0))::float AS quantidade FROM vr_pcp_lotepl2 a JOIN pcp_lotepv p ON a.nr_lote=p.nr_lote WHERE p.tp_situacao=1 AND UPPER(TRIM(COALESCE(p.cd_auxiliar,'')))='MA' AND a.cd_produto=ANY($1::BIGINT[]) GROUP BY a.cd_produto`, [ids]);
  const m = (linhas) => new Map(linhas.map(x => [x.id, Number(x.quantidade || 0)]));
  const procMap=m(processo.rows), pedMap=m(pedidos.rows), planoMap=m(plano.rows);
  const atualizados = Object.fromEntries(estoque.rows.map(x => [x.id, { estoque: x.estoque === null ? null : Number(x.estoque), processo: procMap.get(x.id) || 0, pedidos: (pedMap.get(x.id) || 0) + Number(x.adicional || 0), plano: planoMap.get(x.id) || 0 }]));
  fs.writeFileSync('outputs/novembro_skus/fora_matriz.json', JSON.stringify(atualizados));
  console.log('SKUs fora da matriz consultados:', Object.keys(atualizados).length);
})().catch(e => { console.error(e.message); process.exitCode=1; }).finally(() => pool.end());
