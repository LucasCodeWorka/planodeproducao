// Script para gerar projecao de dezembro 2026 por representatividade
// Filtro: PERMANENTE e PERMANENTE COR NOVA + STATUS EM LINHA
// Regra: Se variacao > 30%, usa media 3 meses; senao usa media das representatividades
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

const META_DEZEMBRO = 98412; // Total esperado para dezembro
const LIMIAR_VARIACAO = 0.30; // 30%

async function main() {
  try {
    console.log("=== Gerar Projecao Dezembro 2026 por Representatividade ===\n");
    console.log(`Meta dezembro: ${META_DEZEMBRO.toLocaleString()} pecas`);
    console.log(`Limiar variacao: ${(LIMIAR_VARIACAO * 100).toFixed(0)}%`);
    console.log("Filtro: PERMANENTE e PERMANENTE COR NOVA + EM LINHA\n");

    // 1. Buscar vendas dezembro 2025 por SKU (apenas permanentes EM LINHA)
    console.log("1. Buscando vendas dezembro 2025 (permanentes EM LINHA)...");
    const vendasDez2025 = await pool.query(`
      WITH produtos_filtrados AS (
        SELECT cd_produto::TEXT AS idproduto
        FROM vr_prd_prdgrade
        WHERE UPPER(TRIM(COALESCE(f_dic_prd_classificacao(cd_produto, 'DS'::text, 802::bigint), '')))
              IN ('PERMANENTE', 'PERMANENTE COR NOVA')
          AND UPPER(TRIM(COALESCE(f_dic_prd_classificacao(cd_produto, 'DS'::text, 27::bigint), '')))
              = 'EM LINHA'
      )
      SELECT
        v.idproduto::TEXT AS idproduto,
        SUM(v.qt_liquida)::FLOAT AS quantidade
      FROM vr_vendas_qtd v
      INNER JOIN produtos_filtrados p ON p.idproduto = v.idproduto::TEXT
      WHERE EXTRACT(YEAR FROM v.data)::INT = 2025
        AND EXTRACT(MONTH FROM v.data)::INT = 12
      GROUP BY v.idproduto
      HAVING SUM(v.qt_liquida) > 0
    `);

    let totalDez2025 = 0;
    const mapDez2025 = new Map();
    for (const row of vendasDez2025.rows) {
      const qtd = Number(row.quantidade) || 0;
      totalDez2025 += qtd;
      mapDez2025.set(row.idproduto, qtd);
    }
    console.log(`   Encontrados ${mapDez2025.size} SKUs com ${totalDez2025.toLocaleString()} pecas\n`);

    // 2. Buscar media ultimos 3 meses fechados (mai/jun/jul 2026)
    console.log("2. Buscando media mai-jul 2026 (permanentes EM LINHA)...");
    const vendas3M = await pool.query(`
      WITH produtos_filtrados AS (
        SELECT cd_produto::TEXT AS idproduto
        FROM vr_prd_prdgrade
        WHERE UPPER(TRIM(COALESCE(f_dic_prd_classificacao(cd_produto, 'DS'::text, 802::bigint), '')))
              IN ('PERMANENTE', 'PERMANENTE COR NOVA')
          AND UPPER(TRIM(COALESCE(f_dic_prd_classificacao(cd_produto, 'DS'::text, 27::bigint), '')))
              = 'EM LINHA'
      )
      SELECT
        v.idproduto::TEXT AS idproduto,
        SUM(v.qt_liquida)::FLOAT / 3 AS media_mensal
      FROM vr_vendas_qtd v
      INNER JOIN produtos_filtrados p ON p.idproduto = v.idproduto::TEXT
      WHERE EXTRACT(YEAR FROM v.data)::INT = 2026
        AND EXTRACT(MONTH FROM v.data)::INT IN (5, 6, 7)
      GROUP BY v.idproduto
      HAVING SUM(v.qt_liquida) > 0
    `);

    let total3M = 0;
    const map3M = new Map();
    for (const row of vendas3M.rows) {
      const media = Number(row.media_mensal) || 0;
      total3M += media;
      map3M.set(row.idproduto, media);
    }
    console.log(`   Encontrados ${map3M.size} SKUs com media ${total3M.toLocaleString()} pecas/mes\n`);

    // 3. Calcular representatividade e aplicar regra
    console.log("3. Calculando projecao por representatividade...");
    const projecoes = [];
    let usouDez2025 = 0;
    let usouMedia3M = 0;
    let skusNovos = 0;
    let skusIgnorados = 0;

    // Usar APENAS SKUs que tem vendas nos ultimos 3 meses
    // SKUs que so existem em dez/2025 sao ignorados
    for (const [idproduto, media3M] of map3M.entries()) {
      const qtdDez2025 = mapDez2025.get(idproduto) || 0;

      // Calcular representatividades
      const repDez2025 = totalDez2025 > 0 ? qtdDez2025 / totalDez2025 : 0;
      const rep3M = total3M > 0 ? media3M / total3M : 0;

      let repFinal;
      let origem;

      if (qtdDez2025 === 0) {
        // SKU novo (nao existia em dez/2025) - usar media 3M
        repFinal = rep3M;
        origem = "NOVO_3M";
        skusNovos++;
      } else {
        // Calcular variacao
        const variacao = Math.abs(rep3M - repDez2025) / repDez2025;

        if (variacao > LIMIAR_VARIACAO) {
          // Variacao > 30% - usar media 3 meses
          repFinal = rep3M;
          origem = "MEDIA_3M";
          usouMedia3M++;
        } else {
          // Variacao <= 30% - usar media entre as duas representatividades
          repFinal = (repDez2025 + rep3M) / 2;
          origem = "MEDIA_REPS";
          usouDez2025++;
        }
      }

      // Calcular quantidade projetada
      const qtdProjetada = Math.round(META_DEZEMBRO * repFinal);

      if (qtdProjetada > 0) {
        projecoes.push({
          idproduto,
          mes: 12,
          ano: 2026,
          quantidade: qtdProjetada,
          repDez2025: (repDez2025 * 100).toFixed(4),
          rep3M: (rep3M * 100).toFixed(4),
          repFinal: (repFinal * 100).toFixed(4),
          origem,
        });
      }
    }

    // Contar SKUs ignorados (so em dez/2025, sem vendas recentes)
    for (const idproduto of mapDez2025.keys()) {
      if (!map3M.has(idproduto)) {
        skusIgnorados++;
      }
    }

    console.log(`   SKUs com projecao: ${projecoes.length}`);
    console.log(`   Usou dez/2025: ${usouDez2025}`);
    console.log(`   Usou media 3M (variacao > 30%): ${usouMedia3M}`);
    console.log(`   SKUs novos (so em 3M): ${skusNovos}`);
    console.log(`   SKUs ignorados (so em dez/2025): ${skusIgnorados}\n`);

    // 4. Verificar total
    const totalProjetado = projecoes.reduce((sum, p) => sum + p.quantidade, 0);
    console.log(`4. Total projetado: ${totalProjetado.toLocaleString()} pecas`);
    console.log(`   Meta: ${META_DEZEMBRO.toLocaleString()} pecas`);
    console.log(`   Diferenca: ${(totalProjetado - META_DEZEMBRO).toLocaleString()} pecas\n`);

    // 5. Salvar na tabela app_projecoes
    console.log("5. Salvando projecoes no banco...");

    // Deletar projecoes existentes de dez/2026
    await pool.query(`DELETE FROM app_projecoes WHERE mes = 12 AND ano = 2026`);

    // Inserir em lotes
    const batchSize = 500;
    let inserted = 0;
    for (let i = 0; i < projecoes.length; i += batchSize) {
      const batch = projecoes.slice(i, i + batchSize);
      const values = batch.map((_, idx) =>
        `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}, $${idx * 4 + 4}, 'PROJECAO_REP')`
      ).join(", ");
      const params = batch.flatMap(p => [p.idproduto, p.mes, p.ano, p.quantidade]);

      await pool.query(`
        INSERT INTO app_projecoes (idproduto, mes, ano, quantidade, origem)
        VALUES ${values}
        ON CONFLICT (idproduto, mes, ano)
        DO UPDATE SET quantidade = EXCLUDED.quantidade,
                      updated_at = CURRENT_TIMESTAMP,
                      origem = EXCLUDED.origem
      `, params);

      inserted += batch.length;
      console.log(`   Processados ${inserted}/${projecoes.length}...`);
    }

    console.log(`\n=== CONCLUIDO: ${inserted} projecoes salvas para dezembro 2026 ===`);

    // 6. Mostrar amostra
    console.log("\n6. Amostra (top 10 por quantidade):");
    const amostra = projecoes
      .sort((a, b) => b.quantidade - a.quantidade)
      .slice(0, 10);
    for (const p of amostra) {
      console.log(`   ${p.idproduto}: ${p.quantidade.toLocaleString()} | rep=${p.repFinal}% | origem=${p.origem}`);
    }

  } catch (err) {
    console.error("Erro:", err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

main();
