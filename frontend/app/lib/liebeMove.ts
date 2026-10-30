// Previsao de venda da LIEBE MOVE — marca nova da Liebe, estudo recebido em 29/10/2026.
//
// Por que vive num arquivo e nao no banco: a Move AINDA NAO TEM PLANO. Ela nao esta na
// matriz de planejamento (o `gap-mensal` filtra `marca = 'LIEBE'`, e a Move e outra marca),
// nao tem lote no ERP e nao tem tempo de costura cadastrado. O pedido do PCP foi explicito:
// "ainda nao vamos emitir esse plano... queremos saber se vai ter como produzir com essa
// nossa capacidade". Ou seja: e uma SIMULACAO de carga por cima do plano que ja existe, e
// enquanto for simulacao o numero vem daqui, nao do ERP.
//
// Quando a Move entrar na matriz com referencia, grupo de capacidade e tempo proprio, esta
// tabela sai e a carga dela passa a vir pelo mesmo caminho de todo o resto.

export type FamiliaMove = {
  familia: string;
  /** Estoque de abertura previsto no estudo (0,5 mes de venda). Nao entra na carga. */
  estoqueMeioMes: number;
  /** Pecas por mes, JAN..DEZ. */
  meses: number[];
  /** Edicao limitada: a familia para de vender no meio do ano, e por isso zera. */
  observacao?: string;
};

export const ANO_MOVE = 2027;

// Numeros exatamente como vieram do estudo. Os 12 totais mensais conferem com a soma das
// quatro familias, e o ano fecha em 50.055 pecas.
export const FAMILIAS_MOVE: FamiliaMove[] = [
  {
    familia: 'TECIDO RISE - BÁSICO',
    estoqueMeioMes: 1032,
    meses: [2025, 2025, 2713, 2120, 1908, 1530, 2264, 3041, 3211, 2822, 2098, 1407],
  },
  {
    familia: 'OUTRO TECIDO',
    estoqueMeioMes: 451,
    meses: [869, 869, 1161, 909, 825, 661, 967, 1307, 1382, 1209, 899, 600],
  },
  {
    familia: 'TECIDO GLOW POWER',
    estoqueMeioMes: 376,
    meses: [732, 732, 974, 758, 680, 558, 804, 1088, 1150, 1007, 749, 501],
  },
  {
    familia: 'STUDIO',
    estoqueMeioMes: 126,
    meses: [361, 285, 475, 379, 0, 0, 0, 0, 0, 0, 0, 0],
    observacao: 'Edição limitada: multimarcas até abril, lojas até maio. Zera de maio em diante.',
  },
];

/** Pecas previstas num mes (1-12) do ano do estudo. Fora dele, zero. */
export function pecasMove(ano: number, mes: number): number {
  if (ano !== ANO_MOVE || mes < 1 || mes > 12) return 0;
  return FAMILIAS_MOVE.reduce((total, f) => total + (f.meses[mes - 1] || 0), 0);
}

/** Abertura por familia num mes, para o detalhe na tela. */
export function moveDoMesPorFamilia(ano: number, mes: number): { familia: string; pecas: number }[] {
  if (ano !== ANO_MOVE || mes < 1 || mes > 12) return [];
  return FAMILIAS_MOVE.map((f) => ({ familia: f.familia, pecas: f.meses[mes - 1] || 0 }));
}

export const TOTAL_ANO_MOVE = FAMILIAS_MOVE.reduce(
  (total, f) => total + f.meses.reduce((a, b) => a + b, 0),
  0,
);

// ── TEMPO DE COSTURA ────────────────────────────────────────────────────────────────────
//
// A Move nao tem tempo medido: ela ainda nao foi produzida. A primeira versao desta tela
// pedia um unico "min/peca" digitado no olho, e isso e frageil por um motivo medido: entre
// os grupos que a fabrica JA produz o tempo vai de 3,50 (SEM COSTURA) a 17,31 (CROPPED), e
// CALCA (5,48) contra SUTIA (10,78) ja e o dobro. Um numero so, chutado, decide sozinho se
// a Move cabe ou nao — e nao tem como conferir de onde ele veio.
//
// Entao em vez de inventar o minuto, cada familia da Move aponta para um GRUPO de produto
// que a fabrica ja faz, e herda o tempo MEDIDO dele (rota
// `/api/capacidade/tempos-por-grupo`). A premissa deixa de ser um numero solto e passa a ser
// uma frase conferivel: "o RISE BASICO leva o mesmo que um TOP, 8,61 min/peca medidos em 7
// referencias". Errar continua possivel, mas agora da para discutir o erro.

// Vale a MEDIA das referencias que a fabrica ja produz, servida por
// `/api/capacidade/tempos-por-grupo`. O numero abaixo e so o encosto para enquanto a rota
// nao respondeu — o valor bom vem medido, nao daqui.
//
// Chegamos nisto depois de duas tentativas piores: um minuto digitado na tela (que ninguem
// conseguia conferir) e um mapeamento familia -> grupo de produto (preciso, mas dispensado
// pelo PCP, e com razao). Medido, a faixa inteira de incerteza — de CALCA a 5,48 ate SUTIA
// a 10,78 min/peca — move o custo anual da Move de 4,8 para 9,4 dias de fabrica no ano
// inteiro de 2027. O veredito e o mesmo nas duas pontas, entao refinar a premissa nao
// mudaria decisao nenhuma.
export const MIN_PECA_MOVE_PADRAO = 8.96;
