// Script para carregar cadastro de MPs com necessidade total, agrupados por seqgrupo+cor.
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl:
    process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

function ultimaCompra(row) {
  const compras = (Array.isArray(row.finalizados_detalhe) ? row.finalizados_detalhe : [])
    .filter((item) => Number(item.quantidade || 0) > 0 && Number(item.valor || 0) > 0)
    .sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));
  const item = compras[0];
  if (!item) return 0;
  return Number(item.valor || 0) / Number(item.quantidade || 1);
}

function valorUnitario(row, priceOptionsByMp) {
  const fatorConv = Number(row.fator_conversao || 1);
  const ultima = ultimaCompra(row);
  if (ultima > 0) return fatorConv > 1 ? ultima / fatorConv : ultima;
  const preco = Number(priceOptionsByMp[String(row.idmateriaprima || "").trim()]?.[0]?.value || 0);
  if (preco > 0) return fatorConv > 1 ? preco / fatorConv : preco;
  return 0;
}

function necessidadeTotal(row) {
  const consumoTotal =
    Number(row.consumo_ma || 0) +
    Number(row.consumo_px || 0) +
    Number(row.consumo_ul || 0) +
    Number(row.consumo_qt || 0) +
    Number(row.consumo_qu || 0);
  const estoque = Number(row.estoquetotal || 0);
  const comprasAndamento = Number(row.entrada_andamento || 0);
  return Math.max(0, consumoTotal - estoque - comprasAndamento);
}

async function main() {
  try {
    console.log("=== Carga de MPs para app_mp_cadastro (necessidadeTotal > 0) ===\n");

    // 1. Dropar tabela antiga e criar nova estrutura
    console.log("1. Recriando tabela app_mp_cadastro...");
    await pool.query(`DROP TABLE IF EXISTS public.app_mp_cadastro`);
    await pool.query(`
      CREATE TABLE public.app_mp_cadastro (
        seqgrupo TEXT NOT NULL,
        cor TEXT NOT NULL,
        descricao TEXT,
        necessidade_total NUMERIC(14, 4) NOT NULL DEFAULT 0,
        valor_necessidade_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (seqgrupo, cor)
      )
    `);
    console.log("   Tabela pronta.\n");

    // 2. Ler dados do cache do orcamento-mp
    console.log("2. Lendo cache do orcamento-mp...");
    const cacheResult = await pool.query(`
      SELECT payload FROM public.app_orcamento_mp_cache
      WHERE cache_key = 'orcamento_mp_liebe'
      LIMIT 1
    `);

    if (cacheResult.rows.length === 0) {
      console.log("   ERRO: Cache nao encontrado!");
      return;
    }

    const payload = cacheResult.rows[0].payload;
    const rowsBase = payload.rowsBase || [];
    const priceOptionsByMp = payload.priceOptionsByMp || {};
    console.log(`   Encontrados ${rowsBase.length} MPs no cache.\n`);

    if (rowsBase.length === 0) {
      console.log("   Nenhum MP para carregar.");
      return;
    }

    const rowsComNecessidade = rowsBase
      .map((mp) => {
        const necessidade = necessidadeTotal(mp);
        const valor = necessidade * valorUnitario(mp, priceOptionsByMp);
        return { ...mp, necessidade_total: necessidade, valor_necessidade_total: valor };
      })
      .filter((mp) => mp.necessidade_total > 0);
    console.log(`   MPs com necessidadeTotal > 0: ${rowsComNecessidade.length}.\n`);

    // 3. Buscar cd_seqgrupo e cd_cor da tabela vr_prd_prdgrade
    console.log("3. Buscando seqgrupo e cor de vr_prd_prdgrade...");
    const codigos = rowsComNecessidade.map(mp => String(mp.idmateriaprima || "")).filter(Boolean);
    const gradeResult = await pool.query(`
      SELECT
        cd_produto::TEXT AS codigo,
        cd_seqgrupo::TEXT AS seqgrupo,
        TRIM(cd_cor) AS cd_cor,
        nm_produto AS descricao
      FROM vr_prd_prdgrade
      WHERE cd_produto::TEXT = ANY($1)
    `, [codigos]);
    const gradeByCodigo = new Map(gradeResult.rows.map((row) => [String(row.codigo || "").trim(), row]));

    // Criar mapa de combinacoes unicas seqgrupo+cor.
    const uniqueMap = new Map();
    for (const mp of rowsComNecessidade) {
      const grade = gradeByCodigo.get(String(mp.idmateriaprima || "").trim());
      if (!grade) continue;
      const seqgrupo = String(grade.seqgrupo || "").trim();
      const cor = String(grade.cd_cor || "").trim();
      if (!seqgrupo || !cor) continue;

      const chave = `${seqgrupo}_${cor}`;
      if (!uniqueMap.has(chave)) {
        uniqueMap.set(chave, {
          seqgrupo,
          cor,
          descricao: String(grade.descricao || "").trim(),
          necessidade_total: 0,
          valor_necessidade_total: 0,
        });
      }
      const item = uniqueMap.get(chave);
      item.necessidade_total += Number(mp.necessidade_total || 0);
      item.valor_necessidade_total += Number(mp.valor_necessidade_total || 0);
    }
    console.log(`   Encontradas ${uniqueMap.size} combinacoes unicas seqgrupo+cor.\n`);

    // 4. Inserir combinacoes unicas
    console.log("4. Inserindo combinacoes na tabela...");
    const items = Array.from(uniqueMap.values())
      .sort((a, b) => {
        const seqCompare = Number(a.seqgrupo) - Number(b.seqgrupo);
        if (seqCompare) return seqCompare;
        return String(a.cor).localeCompare(String(b.cor), "pt-BR", { numeric: true });
      });
    const batchSize = 500;
    let inserted = 0;

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const values = batch.map((_, idx) => `($${idx * 5 + 1}, $${idx * 5 + 2}, $${idx * 5 + 3}, $${idx * 5 + 4}, $${idx * 5 + 5}, NOW())`).join(", ");
      const params = batch.flatMap(item => [
        item.seqgrupo,
        item.cor,
        item.descricao,
        item.necessidade_total,
        item.valor_necessidade_total
      ]);

      await pool.query(`
        INSERT INTO public.app_mp_cadastro (seqgrupo, cor, descricao, necessidade_total, valor_necessidade_total, updated_at)
        VALUES ${values}
        ON CONFLICT (seqgrupo, cor) DO NOTHING
      `, params);

      inserted += batch.length;
      console.log(`   Processados ${inserted}/${items.length}...`);
    }

    console.log(`\n=== CONCLUIDO: ${inserted} registros salvos ===`);

    // 5. Mostrar amostra
    console.log("\n5. Amostra dos dados:");
    const sample = await pool.query(`
      SELECT seqgrupo, cor, descricao, necessidade_total, valor_necessidade_total, updated_at FROM public.app_mp_cadastro
      ORDER BY seqgrupo::INTEGER, cor
      LIMIT 10
    `);
    sample.rows.forEach(r => {
      console.log(`   seqgrupo=${r.seqgrupo} | cor=${r.cor} | nec=${Number(r.necessidade_total).toFixed(2)} | valor=${Number(r.valor_necessidade_total).toFixed(2)} | ${r.descricao?.substring(0, 40) || '-'}`);
    });

    // 6. Mostrar totais
    const totais = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(DISTINCT seqgrupo) as seqgrupos,
             COUNT(DISTINCT cor) as cores,
             SUM(necessidade_total) as necessidade_total,
             SUM(valor_necessidade_total) as valor_necessidade_total
      FROM public.app_mp_cadastro
    `);
    console.log(`\n6. Totais:`);
    console.log(`   ${totais.rows[0].total} registros | ${totais.rows[0].seqgrupos} seqgrupos | ${totais.rows[0].cores} cores`);
    console.log(`   Necessidade total: ${Number(totais.rows[0].necessidade_total || 0).toFixed(2)} | Valor: ${Number(totais.rows[0].valor_necessidade_total || 0).toFixed(2)}`);

  } catch (err) {
    console.error("Erro:", err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

main();
