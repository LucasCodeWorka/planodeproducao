// Quanto da projecao do MES EM CURSO ainda esta pela frente.
//
// A conta ingenua e proporcao de calendario: dia 23 de 31, logo faltam 8/31 = 25,8% do
// mes, logo faltam 25,8% da projecao. So que o mes NAO vende parelho — ele carrega a
// venda para o fim. Medido em 21 meses de venda diaria (`/api/producao/vendas-mes-atual`,
// campo `curvaMesAcumulada`), ao fim do dia 23 costumam ter saido 68,0% da venda do mes,
// nao os 74,2% que o calendario sugere. O fator certo e 32,0%, nao 25,8% — uma diferenca
// de 24% no que ainda vai vender, que some direto do disponivel.
//
// O padrao se repete em 19 dos 21 meses, entao nao e ruido: e o formato do mes.
//
// COMO A CURVA CHEGA AQUI. `projecaoMesPlanejamento` e chamada dentro do render, em varios
// pontos da matriz, e nao pode ser assincrona. Em vez de passar o fator por parametro em
// cada chamada — onde um ponto esquecido divergiria em silencio — a tela que tem o dado
// registra o fator uma vez com `definirFatorMesRestante`, antes do setState que dispara o
// re-render. Sem registro, tudo segue no calendario puro de antes.
let fatorRestanteRegistrado: number | null = null;

/**
 * Registra o fator medido do mes em curso (0-1). `null` volta ao calendario.
 * Chame ANTES do setState que vai re-renderizar, para o render ja sair com o valor novo.
 */
export function definirFatorMesRestante(fator: number | null) {
  fatorRestanteRegistrado = fator !== null && fator >= 0 && fator <= 1 ? fator : null;
}

/** O fator em vigor, para a tela poder mostrar de onde veio o numero. */
export function fatorMesRestanteRegistrado() {
  return fatorRestanteRegistrado;
}

/** Fracao do mes ja decorrida, so pelo calendario. */
export function fatorMesAtualDecorrido(refDate = new Date()) {
  if (fatorRestanteRegistrado !== null) return 1 - fatorRestanteRegistrado;
  const mesAtual = refDate.getMonth() + 1;
  const diasNoMes = new Date(refDate.getFullYear(), mesAtual, 0).getDate();
  const diaAtual = Math.min(refDate.getDate(), diasNoMes);
  return diasNoMes > 0 ? Math.max(0, Math.min(1, diaAtual / diasNoMes)) : 1;
}

/** Fracao do mes que ainda falta. Com fator registrado, e a curva medida. */
export function fatorMesAtualRestante(refDate = new Date()) {
  if (fatorRestanteRegistrado !== null) return fatorRestanteRegistrado;
  const mesAtual = refDate.getMonth() + 1;
  const diasNoMes = new Date(refDate.getFullYear(), mesAtual, 0).getDate();
  const diaAtual = Math.min(refDate.getDate(), diasNoMes);
  return diasNoMes > 0 ? Math.max(0, Math.min(1, (diasNoMes - diaAtual) / diasNoMes)) : 0;
}

export function projecaoMesPlanejamento(valor: number, mes: number, refDate = new Date()) {
  const v = Number(valor || 0);
  const mesAtual = refDate.getMonth() + 1;
  if (mes === mesAtual) return v * fatorMesAtualRestante(refDate);
  return v;
}

export function projecaoMesDecorrida(valor: number, mes: number, refDate = new Date()) {
  const v = Number(valor || 0);
  const mesAtual = refDate.getMonth() + 1;
  if (mes === mesAtual) return v * fatorMesAtualDecorrido(refDate);
  return v;
}
