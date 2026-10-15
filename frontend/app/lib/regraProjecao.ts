// Regra de crescimento da fabrica na projecao — espelho de fatorFabricaMes no backend
// (src/services/projecaoPermanentesService.js). Padrao 0%; abril e maio +20% por causa do
// sinistro no ano base, em qualquer cenario: e correcao de base, nao crescimento.
export const AJUSTES_FABRICA_FIXOS: Readonly<Record<number, number>> = { 4: 1.2, 5: 1.2 };
export const CRESCIMENTO_FABRICA_PADRAO = 0;

export function fatorFabricaMes(mes: number, crescimento: number = CRESCIMENTO_FABRICA_PADRAO): number {
  return AJUSTES_FABRICA_FIXOS[mes] ?? 1 + crescimento;
}
