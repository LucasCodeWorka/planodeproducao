/**
 * Script para testar o cálculo de estoque mínimo com dados reais
 */

const { Pool } = require("pg");
const { calcularEstoqueMinimo } = require("../src/services/estoqueMinimo");
const { buscarProdutoComMedias, buscarEstatisticasProduto } = require("../src/services/vendasService");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function testarEstoqueMinimo() {
  try {
    console.log("=== TESTE DE CÁLCULO DE ESTOQUE MÍNIMO COM DADOS REAIS ===\n");

    // 1. Buscar alguns produtos para teste
    console.log("1. Buscando produtos com mais vendas...\n");

    const queryProdutos = `
      SELECT
        idproduto,
        idempresa,
        COUNT(*) as total_vendas,
        SUM(qt_liquida) as quantidade_total
      FROM vr_vendas_qtd
      GROUP BY idproduto, idempresa
      ORDER BY total_vendas DESC
      LIMIT 5
    `;

    const produtos = await pool.query(queryProdutos);

    console.log(`Encontrados ${produtos.rows.length} produtos para teste\n`);
    console.log("=".repeat(100));

    // 2. Calcular estoque mínimo para cada produto
    for (const [index, produto] of produtos.rows.entries()) {
      console.log(`\n${index + 1}. PRODUTO ID: ${produto.idproduto} | EMPRESA: ${produto.idempresa}`);
      console.log("-".repeat(100));

      // Buscar estatísticas detalhadas
      const stats = await buscarEstatisticasProduto(pool, produto.idproduto, produto.idempresa);

      if (!stats) {
        console.log("   ❌ Sem dados suficientes para calcular");
        continue;
      }

      console.log(`   📊 Histórico:`);
      console.log(`      • Total de vendas: ${stats.total_vendas} registros`);
      console.log(`      • Quantidade total: ${stats.quantidade_total.toFixed(2)} unidades`);
      console.log(`      • Primeira venda: ${stats.primeira_venda.toLocaleDateString('pt-BR')}`);
      console.log(`      • Última venda: ${stats.ultima_venda.toLocaleDateString('pt-BR')}`);

      console.log(`\n   📈 Últimos 6 meses:`);
      console.log(`      • Quantidade vendida: ${stats.ultimos_6_meses.quantidade_total.toFixed(2)}`);
      console.log(`      • Dias com vendas: ${stats.ultimos_6_meses.dias_com_vendas}`);
      console.log(`      • Média por dia: ${stats.ultimos_6_meses.media_por_dia.toFixed(2)}`);

      console.log(`\n   📈 Últimos 3 meses:`);
      console.log(`      • Quantidade vendida: ${stats.ultimos_3_meses.quantidade_total.toFixed(2)}`);
      console.log(`      • Dias com vendas: ${stats.ultimos_3_meses.dias_com_vendas}`);
      console.log(`      • Média por dia: ${stats.ultimos_3_meses.media_por_dia.toFixed(2)}`);

      // Calcular estoque mínimo
      const estoqueCalculo = calcularEstoqueMinimo(
        stats.ultimos_6_meses.media_por_dia,
        stats.ultimos_3_meses.media_por_dia
      );

      console.log(`\n   🎯 ESTOQUE MÍNIMO:`);
      console.log(`      • Valor calculado: ${estoqueCalculo.estoqueMinimo.toFixed(2)} unidades/dia`);
      if (estoqueCalculo.variacaoPercentual !== null) {
        console.log(`      • Variação: ${estoqueCalculo.variacaoPercentual.toFixed(2)}%`);
      }
      console.log(`      • Regra aplicada: ${estoqueCalculo.regraAplicada}`);
      console.log(`      • Descrição: ${estoqueCalculo.descricaoRegra}`);
    }

    console.log("\n" + "=".repeat(100));

    // 3. Teste de casos extremos
    console.log("\n\n=== TESTE DE CASOS EXTREMOS ===\n");

    const casosExtremos = [
      {
        nome: "Crescimento Acentuado",
        mediaSemestral: 10,
        mediaTrimestral: 20
      },
      {
        nome: "Queda Acentuada",
        mediaSemestral: 20,
        mediaTrimestral: 8
      },
      {
        nome: "Sem Histórico Semestral",
        mediaSemestral: 0,
        mediaTrimestral: 15
      },
      {
        nome: "Cenário Estável",
        mediaSemestral: 10,
        mediaTrimestral: 11
      }
    ];

    casosExtremos.forEach((caso, index) => {
      const resultado = calcularEstoqueMinimo(caso.mediaSemestral, caso.mediaTrimestral);

      console.log(`${index + 1}. ${caso.nome}`);
      console.log(`   Média 6 meses: ${caso.mediaSemestral}`);
      console.log(`   Média 3 meses: ${caso.mediaTrimestral}`);
      console.log(`   → Estoque Mínimo: ${resultado.estoqueMinimo.toFixed(2)}`);
      console.log(`   → ${resultado.descricaoRegra}\n`);
    });

    console.log("✅ Testes concluídos com sucesso!\n");

  } catch (error) {
    console.error("❌ Erro ao executar testes:", error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

testarEstoqueMinimo();
