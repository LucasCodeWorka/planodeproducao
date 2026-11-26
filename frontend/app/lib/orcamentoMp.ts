// ORÇAMENTO DE MP — a conta, num lugar só (25/11/2026).
//
// Antes ela existia em três cópias: a tela `/orcamento-mp`, o preparo do agente para o
// FCPFM017 (`scripts/preparar-valores-fcpfm017.mjs`) e o `sync_mp_cadastro.py`. As cópias já
// tinham divergido (o script dividia o preço pelo fator de conversão sempre; a tela só com
// fator > 1). A tela e o preparo do agente importam daqui; o teste em
// `tests/orcamentoMp.test.mjs` prende as regras.
//
// Só sintaxe que o Node lê direto (tipos apagáveis): os scripts `.mjs` importam este `.ts`
// sem compilar. Nada de enum, namespace ou propriedade de parâmetro.

export const PERIODOS_ORCAMENTO = ['MA', 'PX', 'UL', 'QT', 'QU'] as const;
export type PeriodoOrcamento = typeof PERIODOS_ORCAMENTO[number];

export const FOLGA_ORCAMENTO_PERCENTUAL = 0.05;
export const FOLGA_ORCAMENTO_MINIMA = 250;

export type CompraMp = { quantidade?: number | null; valor?: number | null; data?: string | null };

export type LinhaMp = {
  idmateriaprima?: string | number | null;
  artigo?: string | null;
  estoquetotal?: number | null;
  entrada_andamento?: number | null;
  fator_conversao?: number | null;
  unidade_compra?: string | null;
  finalizados_detalhe?: CompraMp[] | null;
  [campo: string]: unknown;
};

export type OpcoesPreco = Record<string, ReadonlyArray<{ value?: number | null }> | undefined>;

export type FontePreco = 'ULTIMA_COMPRA' | 'CUSTO_TOTVS' | 'SEM_PRECO' | 'ALCA_SEM_CUSTO';

const num = (v: unknown) => Number(v || 0);

// Artigos cujo CUSTO não entra no orçamento: a alça é produzida na fábrica e o valor dela já
// está no elástico e nas demais MPs que a compõem. Comparação EXATA de propósito — um
// includes('ALCA') casaria "ALCANTARA" e apagaria dinheiro do orçamento sem ninguém ver.
const ARTIGOS_SEM_CUSTO = new Set(['ALCA', 'ALÇA']);
export function artigoSemCusto(artigo: string | null | undefined) {
  return ARTIGOS_SEM_CUSTO.has(String(artigo || '').trim().toUpperCase());
}

/** Preço unitário da última compra finalizada (valor ÷ quantidade), 0 se não houver. */
export function ultimaCompra(row: LinhaMp) {
  const compras = (Array.isArray(row.finalizados_detalhe) ? row.finalizados_detalhe : [])
    .filter((item) => num(item.quantidade) > 0 && num(item.valor) > 0)
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
  const item = compras[0];
  if (!item) return 0;
  return num(item.valor) / num(item.quantidade || 1);
}

/**
 * Preço da MP: última compra; sem ela, o custo TOTVS. Fator de conversão (milheiro = 1000)
 * só divide quando é MAIOR que 1 — a regra da tela, que é a conferida pelo PCP.
 */
export function valorUnitario(row: LinhaMp, precos: OpcoesPreco): { valor: number; origem: string; fonte: FontePreco } {
  const fatorConv = num(row.fator_conversao || 1);
  const unidCompra = String(row.unidade_compra || 'UND');
  const ultima = ultimaCompra(row);
  if (ultima > 0) {
    return fatorConv > 1
      ? { valor: ultima / fatorConv, origem: `Ultima compra (${unidCompra}/${fatorConv})`, fonte: 'ULTIMA_COMPRA' }
      : { valor: ultima, origem: 'Ultima compra', fonte: 'ULTIMA_COMPRA' };
  }
  const preco = num(precos[String(row.idmateriaprima || '').trim()]?.[0]?.value);
  if (preco > 0) {
    return fatorConv > 1
      ? { valor: preco / fatorConv, origem: `TOTVS (${unidCompra}/${fatorConv})`, fonte: 'CUSTO_TOTVS' }
      : { valor: preco, origem: 'Preco TOTVS', fonte: 'CUSTO_TOTVS' };
  }
  return { valor: 0, origem: 'Sem valor', fonte: 'SEM_PRECO' };
}

/** Preço que entra no orçamento: o unitário, zerado para a alça. */
export function precoOrcamento(row: LinhaMp, precos: OpcoesPreco): { valor: number; origem: string; fonte: FontePreco } {
  if (artigoSemCusto(row.artigo)) {
    return { valor: 0, origem: 'Alca: custo ja contado nas MPs que a compoem', fonte: 'ALCA_SEM_CUSTO' };
  }
  return valorUnitario(row, precos);
}

/** Folga do orçamento: 5% da necessidade, com piso de R$ 250 por MP. Sem necessidade, zero. */
export function calcularFolgaOrcamento(valorNecessidade: number) {
  const valor = num(valorNecessidade);
  if (valor <= 0) return { folga: 0, porPiso: false };
  const folgaPercentual = valor * FOLGA_ORCAMENTO_PERCENTUAL;
  const porPiso = FOLGA_ORCAMENTO_MINIMA >= folgaPercentual;
  return { folga: Math.max(folgaPercentual, FOLGA_ORCAMENTO_MINIMA), porPiso };
}

export function periodosAte(periodo: PeriodoOrcamento): PeriodoOrcamento[] {
  return PERIODOS_ORCAMENTO.slice(0, PERIODOS_ORCAMENTO.indexOf(periodo) + 1);
}

export function valorPeriodo(row: LinhaMp, prefixo: 'consumo' | 'entrada' | 'saldo', periodo: PeriodoOrcamento) {
  return num(row[`${prefixo}_${periodo.toLowerCase()}`]);
}

export function somaAte(row: LinhaMp, prefixo: 'consumo' | 'entrada', periodo: PeriodoOrcamento) {
  return periodosAte(periodo).reduce((acc, p) => acc + valorPeriodo(row, prefixo, p), 0);
}

export type OrcamentoMp = {
  preco: number;
  origemValor: string;
  fontePreco: FontePreco;
  consumoAte: number;
  comprasTotal: number;
  /** Peças/unidades que faltam: consumo até o período − estoque − compras em andamento. */
  necessidadeTotal: number;
  valorNecessidadeTotal: number;
  valorFolga: number;
  folgaPorPiso: boolean;
  /** Necessidade + folga: o "Orçamento" da tela e da exportação. */
  valorOrcamentoTotal: number;
  /** Compras em andamento valorizadas ao mesmo preço. */
  valorComprasTotal: number;
  /** Orçamento + comprado: o total por MP que vai para o FCPFM017 (decisão de 06/10/2026). */
  valorComComprado: number;
  /**
   * Por período: o comprado do período (entradas previstas) e o futuro (necessidade que
   * nasce no período + a fatia proporcional da folga). Soma do futuro = valorOrcamentoTotal.
   */
  porPeriodo: Record<string, { comprado: number; futuro: number }>;
};

export function calcularOrcamentoMp(row: LinhaMp, precos: OpcoesPreco, planoAte: PeriodoOrcamento = 'QU'): OrcamentoMp {
  const preco = precoOrcamento(row, precos);
  const periodos = periodosAte(planoAte);
  const estoque = num(row.estoquetotal);
  const comprasTotal = num(row.entrada_andamento);
  const consumoAte = somaAte(row, 'consumo', planoAte);
  const necessidadeTotal = Math.max(0, consumoAte - estoque - comprasTotal);
  const valorNecessidadeTotal = necessidadeTotal * preco.valor;
  const { folga, porPiso } = calcularFolgaOrcamento(valorNecessidadeTotal);
  const porPeriodo: Record<string, { comprado: number; futuro: number }> = {};
  let consumoAcumulado = 0;
  let necessidadeAnterior = 0;
  for (const p of periodos) {
    consumoAcumulado += valorPeriodo(row, 'consumo', p);
    const necessidadeAcumulada = Math.max(0, consumoAcumulado - estoque - comprasTotal);
    const valorIndividual = Math.max(0, necessidadeAcumulada - necessidadeAnterior) * preco.valor;
    const folgaIndividual = valorNecessidadeTotal > 0 ? (valorIndividual / valorNecessidadeTotal) * folga : 0;
    porPeriodo[p] = { comprado: valorPeriodo(row, 'entrada', p) * preco.valor, futuro: valorIndividual + folgaIndividual };
    necessidadeAnterior = necessidadeAcumulada;
  }
  const valorOrcamentoTotal = valorNecessidadeTotal + folga;
  const valorComprasTotal = comprasTotal * preco.valor;
  return {
    preco: preco.valor,
    origemValor: preco.origem,
    fontePreco: preco.fonte,
    consumoAte,
    comprasTotal,
    necessidadeTotal,
    valorNecessidadeTotal,
    valorFolga: folga,
    folgaPorPiso: porPiso,
    valorOrcamentoTotal,
    valorComprasTotal,
    valorComComprado: valorOrcamentoTotal + valorComprasTotal,
    porPeriodo,
  };
}
