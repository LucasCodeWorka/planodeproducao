/**
 * Exemplos de uso da API de Estoque Mínimo
 *
 * Este arquivo contém exemplos práticos de como consumir a API
 * de cálculo de estoque mínimo.
 */

const API_BASE_URL = 'http://localhost:8000';

// ==========================================
// Exemplo 1: Calcular estoque mínimo único
// ==========================================
async function exemplo1_calculoUnico() {
  console.log('\n=== Exemplo 1: Cálculo Único ===');

  const dados = {
    mediaSemestral: 100,
    mediaTrimestral: 150
  };

  try {
    const response = await fetch(`${API_BASE_URL}/api/estoque-minimo/calcular`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(dados)
    });

    const resultado = await response.json();

    console.log('Resultado:', resultado);
    console.log(`Estoque Mínimo: ${resultado.data.estoqueMinimo}`);
    console.log(`Regra Aplicada: ${resultado.data.regraAplicada}`);
    console.log(`Descrição: ${resultado.data.descricaoRegra}`);
  } catch (error) {
    console.error('Erro:', error);
  }
}

// ==========================================
// Exemplo 2: Calcular múltiplos produtos
// ==========================================
async function exemplo2_calculoLote() {
  console.log('\n=== Exemplo 2: Cálculo em Lote ===');

  const dados = {
    produtos: [
      {
        id: 'PROD001',
        nome: 'Parafuso M10',
        mediaSemestral: 100,
        mediaTrimestral: 160
      },
      {
        id: 'PROD002',
        nome: 'Porca M10',
        mediaSemestral: 200,
        mediaTrimestral: 180
      },
      {
        id: 'PROD003',
        nome: 'Arruela M10',
        mediaTrimestral: 90 // Sem histórico semestral
      }
    ]
  };

  try {
    const response = await fetch(`${API_BASE_URL}/api/estoque-minimo/calcular-lote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(dados)
    });

    const resultado = await response.json();

    console.log(`Total processados: ${resultado.totalProcessados}`);

    resultado.data.forEach(produto => {
      console.log(`\n${produto.nome} (${produto.id}):`);
      console.log(`  Estoque Mínimo: ${produto.estoqueMinimo}`);
      console.log(`  Regra: ${produto.descricaoRegra}`);
    });
  } catch (error) {
    console.error('Erro:', error);
  }
}

// ==========================================
// Exemplo 3: Consultar vendas com estoque mínimo
// ==========================================
async function exemplo3_vendasComEstoque() {
  console.log('\n=== Exemplo 3: Vendas com Estoque Mínimo ===');

  try {
    const response = await fetch(`${API_BASE_URL}/api/vendas/com-estoque-minimo?limit=5`);
    const resultado = await response.json();

    console.log(`Total de produtos: ${resultado.total}`);

    resultado.data.forEach((produto, index) => {
      console.log(`\nProduto ${index + 1}:`);
      console.log(`  ID: ${produto.produto_id}`);
      console.log(`  Média Semestral: ${produto.media_semestral}`);
      console.log(`  Média Trimestral: ${produto.media_trimestral}`);
      console.log(`  Estoque Mínimo: ${produto.estoque_minimo}`);
      console.log(`  Regra: ${produto.descricao_regra}`);
    });
  } catch (error) {
    console.error('Erro:', error);
  }
}

// ==========================================
// Exemplo 4: Consultar estoque mínimo de um produto específico
// ==========================================
async function exemplo4_produtoEspecifico(produtoId) {
  console.log(`\n=== Exemplo 4: Produto Específico (${produtoId}) ===`);

  try {
    const response = await fetch(`${API_BASE_URL}/api/vendas/${produtoId}/estoque-minimo`);

    if (response.status === 404) {
      console.log('Produto não encontrado');
      return;
    }

    const resultado = await response.json();
    const produto = resultado.data;

    console.log('Produto:', produto.produto_id);
    console.log(`Média Semestral: ${produto.mediaSemestral}`);
    console.log(`Média Trimestral: ${produto.mediaTrimestral}`);
    console.log(`Estoque Mínimo: ${produto.estoqueMinimo}`);
    console.log(`Variação: ${produto.variacaoPercentual}%`);
    console.log(`Regra: ${produto.descricaoRegra}`);
  } catch (error) {
    console.error('Erro:', error);
  }
}

// ==========================================
// Exemplo 5: Teste de todas as regras
// ==========================================
async function exemplo5_testarTodasRegras() {
  console.log('\n=== Exemplo 5: Teste de Todas as Regras ===');

  const cenarios = [
    {
      nome: 'Regra 1 - Crescimento Acentuado (+50%)',
      mediaSemestral: 100,
      mediaTrimestral: 150,
      esperado: 150
    },
    {
      nome: 'Regra 1 - Queda Acentuada (-55%)',
      mediaSemestral: 100,
      mediaTrimestral: 45,
      esperado: 45
    },
    {
      nome: 'Regra 2 - Sem Histórico Semestral',
      mediaSemestral: null,
      mediaTrimestral: 80,
      esperado: 80
    },
    {
      nome: 'Regra 3 - Cenário Estável (+10%)',
      mediaSemestral: 100,
      mediaTrimestral: 110,
      esperado: 105
    }
  ];

  for (const cenario of cenarios) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/estoque-minimo/calcular`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mediaSemestral: cenario.mediaSemestral,
          mediaTrimestral: cenario.mediaTrimestral
        })
      });

      const resultado = await response.json();
      const calculado = resultado.data.estoqueMinimo;
      const ok = Math.abs(calculado - cenario.esperado) < 0.01 ? '✓' : '✗';

      console.log(`\n${ok} ${cenario.nome}`);
      console.log(`  Esperado: ${cenario.esperado} | Calculado: ${calculado}`);
      console.log(`  ${resultado.data.descricaoRegra}`);
    } catch (error) {
      console.error(`Erro em ${cenario.nome}:`, error);
    }
  }
}

// ==========================================
// Exemplo 6: Processar planilha de produtos
// ==========================================
async function exemplo6_processarPlanilha() {
  console.log('\n=== Exemplo 6: Processar Planilha ===');

  // Simula dados de uma planilha importada
  const produtosPlanilha = [
    { codigo: 'A001', nome: 'Item A', m6: 120, m3: 150 },
    { codigo: 'A002', nome: 'Item B', m6: 200, m3: 100 },
    { codigo: 'A003', nome: 'Item C', m6: 80, m3: 85 },
    { codigo: 'A004', nome: 'Item D', m6: null, m3: 60 }
  ];

  // Converte para formato da API
  const dadosAPI = {
    produtos: produtosPlanilha.map(p => ({
      id: p.codigo,
      nome: p.nome,
      mediaSemestral: p.m6,
      mediaTrimestral: p.m3
    }))
  };

  try {
    const response = await fetch(`${API_BASE_URL}/api/estoque-minimo/calcular-lote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(dadosAPI)
    });

    const resultado = await response.json();

    // Gera relatório
    console.log('\nRelatório de Estoque Mínimo:');
    console.log('='.repeat(80));
    console.log('Código | Nome       | M6   | M3   | Est.Min | Regra | Var%');
    console.log('-'.repeat(80));

    resultado.data.forEach(p => {
      const var_txt = p.variacaoPercentual !== null
        ? p.variacaoPercentual.toFixed(1) + '%'
        : 'N/A';

      console.log(
        `${p.id.padEnd(6)} | ${p.nome.padEnd(10)} | ` +
        `${String(p.mediaSemestral || '-').padStart(4)} | ` +
        `${String(p.mediaTrimestral || '-').padStart(4)} | ` +
        `${String(Math.round(p.estoqueMinimo)).padStart(7)} | ` +
        `${p.regraAplicada}     | ${var_txt}`
      );
    });
  } catch (error) {
    console.error('Erro:', error);
  }
}

// ==========================================
// Executar exemplos
// ==========================================
async function executarExemplos() {
  console.log('Iniciando exemplos de uso da API de Estoque Mínimo...');

  // Verifica se a API está rodando
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    if (!response.ok) {
      console.error('API não está respondendo corretamente');
      return;
    }
  } catch (error) {
    console.error('Erro ao conectar com a API. Certifique-se de que está rodando na porta 8000');
    return;
  }

  // Executa os exemplos
  await exemplo1_calculoUnico();
  await exemplo2_calculoLote();
  // await exemplo3_vendasComEstoque(); // Requer dados no banco
  // await exemplo4_produtoEspecifico('PROD001'); // Requer dados no banco
  await exemplo5_testarTodasRegras();
  await exemplo6_processarPlanilha();

  console.log('\n✓ Exemplos concluídos!');
}

// Executar se for chamado diretamente
if (require.main === module) {
  executarExemplos().catch(console.error);
}

// Exportar funções para uso externo
module.exports = {
  exemplo1_calculoUnico,
  exemplo2_calculoLote,
  exemplo3_vendasComEstoque,
  exemplo4_produtoEspecifico,
  exemplo5_testarTodasRegras,
  exemplo6_processarPlanilha
};
