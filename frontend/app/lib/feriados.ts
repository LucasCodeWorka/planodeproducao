// Feriados de Fortaleza/CE para a contagem de dias úteis.
//
// ONDE ISTO É USADO: só onde a Visão Geral cai na contagem CRUA de dias de semana — ou seja,
// nos meses em que o arquivo `capacidade_dias.json` não serve para o ano planejado (mês já
// fechado, que vira 0, e o mês em curso, que guarda só os dias restantes). Nos demais meses
// vale a config, que JÁ tem os feriados e a coletiva descontados pela operação. Aplicar esta
// lista por cima deles contaria o mesmo feriado duas vezes.
//
// Para editar: mexa em FIXOS. As datas móveis saem do cálculo da Páscoa, não precisam de
// manutenção ano a ano.

/** Domingo de Páscoa (Meeus/Jones/Butcher). Base de todas as datas móveis. */
function domingoDePascoa(ano: number): Date {
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

/** Feriados de data fixa: [dia, mês, nome]. Nacionais, do Ceará e de Fortaleza. */
const FIXOS: ReadonlyArray<readonly [number, number, string]> = [
  [1, 1, 'Confraternização Universal'],
  [25, 3, 'Data Magna do Ceará'],
  [21, 4, 'Tiradentes'],
  [1, 5, 'Dia do Trabalho'],
  // Padroeira de Fortaleza — feriado municipal.
  [15, 8, 'Nossa Senhora da Assunção'],
  [7, 9, 'Independência'],
  [12, 10, 'Nossa Senhora Aparecida'],
  [2, 11, 'Finados'],
  [15, 11, 'Proclamação da República'],
  // Nacional desde a Lei 14.759/2023.
  [20, 11, 'Consciência Negra'],
  [25, 12, 'Natal'],
];

/**
 * Datas móveis, em dias de distância do domingo de Páscoa.
 * Quarta-feira de Cinzas fica de fora de propósito: costuma ser meio expediente, não dia
 * cheio. Se a fábrica parar o dia todo, acrescente [-46, 'Quarta-feira de Cinzas'].
 */
const MOVEIS: ReadonlyArray<readonly [number, string]> = [
  [-48, 'Carnaval (segunda)'],
  [-47, 'Carnaval (terça)'],
  [-2, 'Sexta-feira Santa'],
  [60, 'Corpus Christi'],
];

export type Feriado = { data: Date; nome: string };

/** Todos os feriados do ano, fixos e móveis, em ordem. */
export function feriadosDoAno(ano: number): Feriado[] {
  const pascoa = domingoDePascoa(ano);
  const moveis = MOVEIS.map(([offset, nome]) => ({
    data: new Date(pascoa.getTime() + offset * 86400000),
    nome,
  }));
  const fixos = FIXOS.map(([dia, mes, nome]) => ({ data: new Date(Date.UTC(ano, mes - 1, dia)), nome }));
  return [...fixos, ...moveis].sort((a, b) => a.data.getTime() - b.data.getTime());
}

/** Quantos feriados do mês caem em dia de semana — os únicos que tiram dia útil. */
export function feriadosUteisNoMes(ano: number, mes: number): number {
  return feriadosDoAno(ano).filter((f) => {
    if (f.data.getUTCMonth() !== mes - 1) return false;
    const w = f.data.getUTCDay();
    return w >= 1 && w <= 5;
  }).length;
}

/**
 * Paradas programadas que nenhum calendário sabe: dias de fábrica fechada por decisão da
 * empresa. Hoje só a coletiva de fim de ano, medida na config de dias (dezembro vinha com
 * 18 contra 23 dias de semana). Em dias, por mês.
 */
export const PARADAS_PROGRAMADAS: Readonly<Record<number, number>> = { 12: 5 };

/** Dias de semana do mês já descontados os feriados que caem neles. */
export function diasUteisNoMes(ano: number, mes: number): number {
  let n = 0;
  const d = new Date(Date.UTC(ano, mes - 1, 1));
  while (d.getUTCMonth() === mes - 1) {
    const w = d.getUTCDay();
    if (w >= 1 && w <= 5) n += 1;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return Math.max(0, n - feriadosUteisNoMes(ano, mes));
}

/** Dias que a fábrica realmente tem no mês: dias úteis menos a parada programada. */
export function diasDeFabricaNoMes(ano: number, mes: number): number {
  return Math.max(0, diasUteisNoMes(ano, mes) - (PARADAS_PROGRAMADAS[mes] || 0));
}
