/**
 * Script de teste para verificar o cálculo automático dos períodos
 */

function calcularPeriodos(dataSimulada = null) {
  const hoje = dataSimulada || new Date();
  const mesAtualJs = hoje.getMonth(); // 0-11
  const ano = hoje.getFullYear();
  const diaAtual = hoje.getDate();

  // Último dia do mês atual
  const ultimoDia = new Date(ano, mesAtualJs + 1, 0).getDate();
  const eUltimoDia = diaAtual === ultimoDia;

  // Se é último dia, considera próximo mês como MA, senão usa o atual
  let ma = eUltimoDia ? mesAtualJs + 2 : mesAtualJs + 1; // +1 pois getMonth() retorna 0-11

  // Normaliza para 1-12
  if (ma > 12) ma -= 12;

  // Períodos sequenciais: MA, MA+1, MA+2, MA+3
  const px = ma + 1 > 12 ? ma + 1 - 12 : ma + 1;
  const ul = ma + 2 > 12 ? ma + 2 - 12 : ma + 2;
  const qt = ma + 3 > 12 ? ma + 3 - 12 : ma + 3;

  return { MA: ma, PX: px, UL: ul, QT: qt, eUltimoDia };
}

const meses = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

console.log('=== TESTE DE CÁLCULO AUTOMÁTICO DE PERÍODOS ===\n');

// Teste 1: 31 de março (último dia)
const mar31 = new Date(2026, 2, 31); // mês 2 = março (0-indexed)
const p1 = calcularPeriodos(mar31);
console.log(`📅 31/03/2026 (último dia de março)`);
console.log(`   É último dia: ${p1.eUltimoDia ? 'SIM ✓' : 'NÃO'}`);
console.log(`   MA = ${p1.MA} (${meses[p1.MA - 1]})`);
console.log(`   PX = ${p1.PX} (${meses[p1.PX - 1]})`);
console.log(`   UL = ${p1.UL} (${meses[p1.UL - 1]})`);
console.log(`   QT = ${p1.QT} (${meses[p1.QT - 1]})`);
console.log('');

// Teste 2: 15 de março (meio do mês)
const mar15 = new Date(2026, 2, 15);
const p2 = calcularPeriodos(mar15);
console.log(`📅 15/03/2026 (meio de março)`);
console.log(`   É último dia: ${p2.eUltimoDia ? 'SIM' : 'NÃO ✓'}`);
console.log(`   MA = ${p2.MA} (${meses[p2.MA - 1]})`);
console.log(`   PX = ${p2.PX} (${meses[p2.PX - 1]})`);
console.log(`   UL = ${p2.UL} (${meses[p2.UL - 1]})`);
console.log(`   QT = ${p2.QT} (${meses[p2.QT - 1]})`);
console.log('');

// Teste 3: 1 de abril
const abr1 = new Date(2026, 3, 1);
const p3 = calcularPeriodos(abr1);
console.log(`📅 01/04/2026 (primeiro dia de abril)`);
console.log(`   É último dia: ${p3.eUltimoDia ? 'SIM' : 'NÃO ✓'}`);
console.log(`   MA = ${p3.MA} (${meses[p3.MA - 1]})`);
console.log(`   PX = ${p3.PX} (${meses[p3.PX - 1]})`);
console.log(`   UL = ${p3.UL} (${meses[p3.UL - 1]})`);
console.log(`   QT = ${p3.QT} (${meses[p3.QT - 1]})`);
console.log('');

// Teste 4: 30 de abril (último dia)
const abr30 = new Date(2026, 3, 30);
const p4 = calcularPeriodos(abr30);
console.log(`📅 30/04/2026 (último dia de abril)`);
console.log(`   É último dia: ${p4.eUltimoDia ? 'SIM ✓' : 'NÃO'}`);
console.log(`   MA = ${p4.MA} (${meses[p4.MA - 1]})`);
console.log(`   PX = ${p4.PX} (${meses[p4.PX - 1]})`);
console.log(`   UL = ${p4.UL} (${meses[p4.UL - 1]})`);
console.log(`   QT = ${p4.QT} (${meses[p4.QT - 1]})`);
console.log('');

// Teste 5: Data atual (real)
const p5 = calcularPeriodos();
const hoje = new Date();
console.log(`📅 HOJE: ${hoje.toLocaleDateString('pt-BR')}`);
console.log(`   É último dia: ${p5.eUltimoDia ? 'SIM ✓' : 'NÃO'}`);
console.log(`   MA = ${p5.MA} (${meses[p5.MA - 1]})`);
console.log(`   PX = ${p5.PX} (${meses[p5.PX - 1]})`);
console.log(`   UL = ${p5.UL} (${meses[p5.UL - 1]})`);
console.log(`   QT = ${p5.QT} (${meses[p5.QT - 1]})`);
console.log('');

console.log('=== LÓGICA ===');
console.log('• Se ÚLTIMO DIA do mês: MA = próximo mês');
console.log('• Senão: MA = mês atual');
console.log('• PX = MA + 1 mês');
console.log('• UL = MA + 2 meses');
console.log('• QT = MA + 3 meses');
