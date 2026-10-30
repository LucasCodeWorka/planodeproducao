// Rotulos posicionais do plano, na mesma ordem do ERP (`pcp_lotepv.cd_auxiliar`):
// MA = mes atual, PX = proximo, UL = o seguinte, e dali pelo ordinal — QT quarto,
// QU quinto, SX sexto, ST setimo, OT oitavo, NV nono.
//
// Espelha `src/services/periodoPlanoService.js`, que e a fonte do backend. O frontend nao
// tinha equivalente: a lista estava escrita a mao em nove telas, cada uma parando num
// periodo diferente. Isso nao e detalhe de estilo — foi a causa de dois bugs caros:
//
//   1) ST ja existia no ERP com producao prevista para abr/2027 e o sistema inteiro
//      ignorava, porque as listas paravam em SX.
//   2) O lote ST-OT-NV gerou tres CSVs IDENTICOS para o Fagner importar. A tela de
//      Sugestoes e Aprovacoes montava as colunas a mao de `ma` ate `sx`, entao os tres
//      periodos que de fato diferiam (ST 87.490, OT 110.672, NV 87.941) nao tinham coluna
//      nenhuma, e o que sobrava era o mesmo bloco MA..SX nas tres simulacoes.
//
// Tela nova deve importar daqui. Tela que mostra DE PROPOSITO menos periodos (orcamento de
// MP so olha quatro, por exemplo) pode fatiar esta lista — o que nao pode e reescreve-la,
// porque ai ela deixa de acompanhar quando o horizonte cresce.
export const PERIODOS_PLANO = ['MA', 'PX', 'UL', 'QT', 'QU', 'SX', 'ST', 'OT', 'NV'] as const;

export type PeriodoPlano = typeof PERIODOS_PLANO[number];

/** Campo minusculo correspondente, como o plano chega da API (`plano.ma`, `plano.st`…). */
export type CampoPeriodo = Lowercase<PeriodoPlano>;

export const campoDoPeriodo = (p: PeriodoPlano) => p.toLowerCase() as CampoPeriodo;

export const ordemDoPeriodo = (p: PeriodoPlano) => PERIODOS_PLANO.indexOf(p);

/** Soma os nove periodos de um registro de plano, ignorando campo ausente. */
export function somaPeriodos(plano: Partial<Record<CampoPeriodo, number>> | null | undefined): number {
  if (!plano) return 0;
  return PERIODOS_PLANO.reduce((total, p) => total + Math.round(Number(plano[campoDoPeriodo(p)] || 0)), 0);
}
