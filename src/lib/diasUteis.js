// Dias uteis e feriados, do lado do backend.
//
// Espelha `frontend/app/lib/feriados.ts` — se mexer em feriado ou nos dias fixos de
// coletiva, mexa nos dois. O frontend usa isto para os meses PROJETADOS; aqui vale para o
// mes CORRENTE, cujo "dias que faltam" nao pode sair de `capacidade_dias.json` (o arquivo
// e mantido a mao e envelhece dentro do mes: em 22/10/2026 ele dizia 12 quando faltavam 7).

/** Domingo de Pascoa (Meeus/Jones/Butcher). Base das datas moveis. */
function domingoDePascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

// Nacionais, do Ceara e de Fortaleza. [dia, mes]
const FIXOS = [
  [1, 1], [25, 3], [21, 4], [1, 5], [15, 8], [7, 9],
  [12, 10], [2, 11], [15, 11], [20, 11], [25, 12],
];

// Distancia em dias do domingo de Pascoa.
const MOVEIS = [-48, -47, -2, 60];

/** Feriados do ano, como timestamps UTC de meia-noite. */
function feriadosDoAno(ano) {
  const pascoa = domingoDePascoa(ano);
  const moveis = MOVEIS.map((offset) => new Date(pascoa.getTime() + offset * 86400000));
  const fixos = FIXOS.map(([dia, mes]) => new Date(Date.UTC(ano, mes - 1, dia)));
  return [...fixos, ...moveis];
}

/** Quantos feriados do mes caem em dia de semana — os unicos que tiram dia util. */
function feriadosUteisNoMes(ano, mes) {
  return feriadosDoAno(ano).filter((f) => {
    if (f.getUTCMonth() !== mes - 1) return false;
    const w = f.getUTCDay();
    return w >= 1 && w <= 5;
  }).length;
}

/** Dias de semana do mes, ja descontados os feriados que caem neles. */
function diasUteisNoMes(ano, mes) {
  let n = 0;
  const d = new Date(Date.UTC(ano, mes - 1, 1));
  while (d.getUTCMonth() === mes - 1) {
    const w = d.getUTCDay();
    if (w >= 1 && w <= 5) n += 1;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return Math.max(0, n - feriadosUteisNoMes(ano, mes));
}

/** Dias uteis que ainda restam no mes, contando HOJE como disponivel. */
function diasUteisRestantesNoMes(ano, mes, hoje = new Date()) {
  const feriados = new Set(
    feriadosDoAno(ano)
      .filter((f) => f.getUTCMonth() === mes - 1)
      .map((f) => f.getUTCDate())
  );
  let n = 0;
  const d = new Date(Date.UTC(ano, mes - 1, hoje.getDate()));
  while (d.getUTCMonth() === mes - 1) {
    const w = d.getUTCDay();
    if (w >= 1 && w <= 5 && !feriados.has(d.getUTCDate())) n += 1;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
}

/**
 * Meses com dias de fabrica FIXOS, que o calendario nao sabe calcular: a coletiva de fim
 * de ano. Mesmos numeros de `DIAS_FIXOS_POR_MES` no frontend.
 */
const DIAS_FIXOS_POR_MES = { 12: 18, 1: 20 };

/**
 * Dias de fabrica que ainda restam no mes corrente.
 *
 * Nao e so contar dia de semana: dezembro e janeiro tem coletiva, e o total do mes ja vem
 * reduzido. Entao o que resta e a MESMA proporcao do calendario aplicada ao total de
 * fabrica — em 22/10/2026, outubro tem 21 uteis no total e 7 pela frente, entao restam
 * 21 x 7/21 = 7; se fosse dezembro (18 de fabrica para 22 uteis), 10 uteis pela frente
 * dariam 18 x 10/22 = 8.
 */
function diasDeFabricaRestantes(ano, mes, hoje = new Date()) {
  const totalCalendario = diasUteisNoMes(ano, mes);
  if (totalCalendario <= 0) return 0;
  const totalFabrica = DIAS_FIXOS_POR_MES[mes] ?? totalCalendario;
  const restantesCalendario = diasUteisRestantesNoMes(ano, mes, hoje);
  return Math.round((totalFabrica * restantesCalendario) / totalCalendario);
}

module.exports = {
  feriadosDoAno,
  feriadosUteisNoMes,
  diasUteisNoMes,
  diasUteisRestantesNoMes,
  diasDeFabricaRestantes,
  DIAS_FIXOS_POR_MES,
};
