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
 * PARADAS DE FABRICA (ferias coletivas), por periodo declarado com datas.
 *
 * Datas, nao um numero de dias: "10 dias de ferias" nao quer dizer 10 dias de producao
 * perdidos. Fev/2027, de 05 a 14, sao 10 dias corridos que custam so 4 de fabrica — 06, 07,
 * 13 e 14 sao fim de semana e 08 e 09 ja sao Carnaval, feriado que a conta ja descontava.
 * Deixar alguem digitar "10" tiraria 6 dias que nunca existiram.
 *
 * Espelhado em `frontend/app/lib/feriados.ts`. Para acrescentar uma parada, ponha as datas
 * aqui e la — o resto se calcula.
 */
const PARADAS = [
  { nome: 'Férias coletivas', ano: 2027, inicio: [2, 5], fim: [2, 14] },
];

/** Dias de fabrica que uma parada tira do mes. So conta dia que seria trabalhado. */
function diasDeParadaNoMes(ano, mes) {
  const feriados = new Set(
    feriadosDoAno(ano).filter((f) => f.getUTCMonth() === mes - 1).map((f) => f.getUTCDate())
  );
  let n = 0;
  for (const p of PARADAS) {
    if (p.ano !== ano) continue;
    const [mi, di] = p.inicio;
    const [mf, df] = p.fim;
    const d = new Date(Date.UTC(ano, mi - 1, di));
    const fim = new Date(Date.UTC(ano, mf - 1, df));
    while (d <= fim) {
      const w = d.getUTCDay();
      if (d.getUTCMonth() === mes - 1 && w >= 1 && w <= 5 && !feriados.has(d.getUTCDate())) n += 1;
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }
  return n;
}

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

/**
 * Dias de fabrica do mes inteiro: o fixo da coletiva, ou os dias uteis do calendario.
 * `comParada` desconta as ferias declaradas em PARADAS — e cenario, entra so quando pedido.
 */
function diasDeFabricaNoMes(ano, mes, comParada = false) {
  const base = DIAS_FIXOS_POR_MES[mes] ?? diasUteisNoMes(ano, mes);
  return comParada ? Math.max(0, base - diasDeParadaNoMes(ano, mes)) : base;
}

/**
 * Em que ANO cai o mes de um periodo do plano. Os periodos andam para frente a partir do
 * mes corrente, entao um mes MENOR que o de hoje ja e do ano que vem (em outubro/2026, o
 * periodo QT = mes 1 e janeiro/2027).
 */
function anoDoPeriodo(mesPeriodo, hoje = new Date()) {
  const mesAtual = hoje.getMonth() + 1;
  return Number(mesPeriodo) < mesAtual ? hoje.getFullYear() + 1 : hoje.getFullYear();
}

/**
 * Dias disponiveis de um periodo do plano, do calendario.
 *
 * O mes em curso entra so com o que falta; os demais entram inteiros. Substitui o
 * `capacidade_dias.json` nessa funcao: aquele arquivo e mantido a mao e nao acompanha nem
 * o relogio (dizia 12 dias de outubro quando faltavam 7) nem o calendario (dizia 21 dias
 * em novembro/2026, que tem 19 — Finados cai na segunda e Consciencia Negra na sexta).
 */
function diasDisponiveisDoPeriodo(mesPeriodo, hoje = new Date(), comParada = false) {
  const mes = Number(mesPeriodo);
  if (!mes) return 0;
  const ano = anoDoPeriodo(mes, hoje);
  const ehMesCorrente = mes === hoje.getMonth() + 1 && ano === hoje.getFullYear();
  if (ehMesCorrente) {
    const rest = diasDeFabricaRestantes(ano, mes, hoje);
    return comParada ? Math.max(0, rest - diasDeParadaNoMes(ano, mes)) : rest;
  }
  return diasDeFabricaNoMes(ano, mes, comParada);
}

/**
 * Dias de fabrica de um periodo, pela DATA dele — nao pelo numero do mes.
 *
 * `diasDisponiveisDoPeriodo` recebe so o mes (1-12) e deduz o ano comparando com o mes
 * corrente. Isso bastava enquanto o horizonte tinha nove posicoes, mas com catorze o mesmo
 * mes aparece DUAS vezes: em 05/11/2026, MA e nov/26 e DT e nov/27. A deducao devolvia 2026
 * para os dois, e nov/27 vinha com os 17 dias que restam DESTE novembro em vez dos 19 do
 * mes inteiro. Quem tem a data certa e `calcularPeriodosPlano().datas`.
 */
function diasDisponiveisDaData(data, hoje = new Date(), comParada = false) {
  if (!(data instanceof Date) || Number.isNaN(data.getTime())) return 0;
  const ano = data.getFullYear();
  const mes = data.getMonth() + 1;
  const ehMesCorrente = mes === hoje.getMonth() + 1 && ano === hoje.getFullYear();
  if (ehMesCorrente) {
    const rest = diasDeFabricaRestantes(ano, mes, hoje);
    return comParada ? Math.max(0, rest - diasDeParadaNoMes(ano, mes)) : rest;
  }
  return diasDeFabricaNoMes(ano, mes, comParada);
}

module.exports = {
  PARADAS,
  diasDisponiveisDaData,
  diasDeParadaNoMes,
  feriadosDoAno,
  feriadosUteisNoMes,
  diasUteisNoMes,
  diasUteisRestantesNoMes,
  diasDeFabricaRestantes,
  diasDeFabricaNoMes,
  anoDoPeriodo,
  diasDisponiveisDoPeriodo,
  DIAS_FIXOS_POR_MES,
};
