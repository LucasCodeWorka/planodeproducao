/**
 * Script para testar o módulo de planejamento de produção
 */

const { Pool } = require("pg");
const { buscarPlanejamentoProduto } = require("../src/services/producaoService");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function testarProducao() {
  try {
    console.log("=== TESTE DE PLANEJAMENTO DE PRODUÇÃO ===\n");

    // Buscar alguns produtos para teste
    console.log("1. Buscando produtos do catálogo...\n");

    const queryProdutos = `
      SELECT
        a.cd_produto AS idproduto,
        a.nm_produto AS apresentacao,
        f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar) AS referencia
      FROM vr_prd_prdgrade a
      WHERE a.cd_produto < 1000000
      ORDER BY a.cd_produto
      LIMIT 5
    `;

    const produtos = await pool.query(queryProdutos);

    console.log(`Encontrados ${produtos.rows.length} produtos para teste\n`);
    console.log("=".repeat(120));

    // Testar planejamento para cada produto
    for (const [index, produto] of produtos.rows.entries()) {
      console.log(`\n${index + 1}. PRODUTO: ${produto.apresentacao} (ID: ${produto.idproduto}) | REF: ${produto.referencia || 'N/A'}`);
      console.log("-".repeat(120));

      try {
        const planejamento = await buscarPlanejamentoProduto(pool, produto.idproduto, 1);

        if (!planejamento) {
          console.log("   ❌ Produto não encontrado no planejamento");
          continue;
        }

        // Informações do Produto
        console.log(`\n   📦 PRODUTO:`);
        console.log(`      • Apresentação: ${planejamento.produto.apresentacao}`);
        console.log(`      • Cor: ${planejamento.produto.cor || 'N/A'}`);
        console.log(`      • Tamanho: ${planejamento.produto.tamanho || 'N/A'}`);
        console.log(`      • Status: ${planejamento.produto.status || 'N/A'}`);
        console.log(`      • Família: ${planejamento.produto.idfamilia || 'N/A'}`);
        console.log(`      • Continuidade: ${planejamento.produto.continuidade || 'N/A'}`);

        // Estoques
        console.log(`\n   📊 ESTOQUES:`);
        console.log(`      • Estoque Atual: ${planejamento.estoques.estoque_atual.toFixed(2)}`);
        console.log(`      • Em Processo: ${planejamento.estoques.em_processo.toFixed(2)}`);
        console.log(`      • Estoque Disponível: ${planejamento.estoques.estoque_disponivel.toFixed(2)}`);
        console.log(`      • Estoque Mínimo: ${planejamento.estoques.estoque_minimo.toFixed(2)}`);

        // Demanda
        console.log(`\n   📈 DEMANDA:`);
        console.log(`      • Pedidos Pendentes: ${planejamento.demanda.pedidos_pendentes.toFixed(2)}`);
        console.log(`      • Média Vendas 6m: ${planejamento.demanda.media_vendas_6m.toFixed(2)}`);
        console.log(`      • Média Vendas 3m: ${planejamento.demanda.media_vendas_3m.toFixed(2)}`);

        // Planejamento
        console.log(`\n   🎯 PLANEJAMENTO:`);
        console.log(`      • Necessidade Total: ${planejamento.planejamento.necessidade_total.toFixed(2)}`);
        console.log(`      • Necessidade Produção: ${planejamento.planejamento.necessidade_producao.toFixed(2)}`);
        console.log(`      • Situação: ${planejamento.planejamento.situacao}`);
        console.log(`      • Prioridade: ${planejamento.planejamento.prioridade}`);

        // Cálculo Estoque Mínimo
        if (planejamento.calculo_estoque_minimo) {
          console.log(`\n   📐 CÁLCULO ESTOQUE MÍNIMO:`);
          console.log(`      • Regra Aplicada: ${planejamento.calculo_estoque_minimo.regraAplicada}`);
          console.log(`      • Descrição: ${planejamento.calculo_estoque_minimo.descricaoRegra}`);
          if (planejamento.calculo_estoque_minimo.variacaoPercentual !== null) {
            console.log(`      • Variação: ${planejamento.calculo_estoque_minimo.variacaoPercentual.toFixed(2)}%`);
          }
        } else {
          console.log(`\n   ⚠️  Sem histórico de vendas para calcular estoque mínimo`);
        }

        // Decisão de Produção
        console.log(`\n   💡 DECISÃO:`);
        if (planejamento.planejamento.situacao === 'PRODUZIR') {
          console.log(`      ⚠️  NECESSÁRIO PRODUZIR ${planejamento.planejamento.necessidade_producao.toFixed(2)} unidades`);
          console.log(`      🔴 PRIORIDADE: ${planejamento.planejamento.prioridade}`);
        } else {
          console.log(`      ✅ ESTOQUE ADEQUADO - Produção não necessária no momento`);
        }

      } catch (error) {
        console.log(`   ❌ Erro ao processar produto: ${error.message}`);
      }
    }

    console.log("\n" + "=".repeat(120));

    // Resumo de produtos que precisam produzir
    console.log("\n\n=== RESUMO - PRODUTOS QUE NECESSITAM PRODUÇÃO ===\n");

    const queryNecessidade = `
      SELECT
        a.cd_produto,
        a.nm_produto,
        f_dic_prd_nivel(a.cd_produto, 'CD'::bpchar) AS referencia
      FROM vr_prd_prdgrade a
      WHERE a.cd_produto < 1000000
      ORDER BY a.cd_produto
      LIMIT 20
    `;

    const produtosNecessidade = await pool.query(queryNecessidade);
    const produtosProduzir = [];

    for (const produto of produtosNecessidade.rows) {
      try {
        const planejamento = await buscarPlanejamentoProduto(pool, produto.cd_produto, 1);

        if (planejamento && planejamento.planejamento.situacao === 'PRODUZIR') {
          produtosProduzir.push({
            cd_produto: produto.cd_produto,
            nome: produto.nm_produto,
            referencia: produto.referencia,
            necessidade: planejamento.planejamento.necessidade_producao,
            prioridade: planejamento.planejamento.prioridade,
            estoque_atual: planejamento.estoques.estoque_atual,
            estoque_minimo: planejamento.estoques.estoque_minimo
          });
        }
      } catch (error) {
        // Ignorar erros
      }
    }

    if (produtosProduzir.length === 0) {
      console.log("✅ Nenhum produto necessita produção no momento");
    } else {
      console.log(`Encontrados ${produtosProduzir.length} produtos que necessitam produção:\n`);

      // Ordenar por prioridade
      const prioridadeOrdem = { ALTA: 1, MEDIA: 2, BAIXA: 3 };
      produtosProduzir.sort((a, b) => {
        const prioA = prioridadeOrdem[a.prioridade] || 999;
        const prioB = prioridadeOrdem[b.prioridade] || 999;
        return prioA - prioB;
      });

      console.log("Cód.   | Produto                    | Ref    | Prioridade | Produzir | Estoque | Est.Mín");
      console.log("-".repeat(100));

      produtosProduzir.forEach(p => {
        const prioIcon = p.prioridade === 'ALTA' ? '🔴' : p.prioridade === 'MEDIA' ? '🟡' : '🟢';

        console.log(
          `${String(p.cd_produto).padEnd(6)} | ` +
          `${(p.nome || 'N/A').substring(0, 25).padEnd(25)} | ` +
          `${(p.referencia || 'N/A').substring(0, 6).padEnd(6)} | ` +
          `${prioIcon} ${p.prioridade.padEnd(8)} | ` +
          `${String(Math.round(p.necessidade)).padStart(8)} | ` +
          `${String(Math.round(p.estoque_atual)).padStart(7)} | ` +
          `${String(Math.round(p.estoque_minimo)).padStart(7)}`
        );
      });
    }

    console.log("\n✅ Testes concluídos com sucesso!\n");

  } catch (error) {
    console.error("❌ Erro ao executar testes:", error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

testarProducao();
