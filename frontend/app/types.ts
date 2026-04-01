export interface Produto {
  cd_seqgrupo: string;
  idproduto: string;
  apresentacao: string;
  cor: string;
  tamanho: string;
  referencia: string;
  produto: string;
  status: string;
  idfamilia: string;
  continuidade: string;
  cod_situacao?: string;
  linha?: string;
  grupo?: string;
  marca: string;
  cd_empresa: number;
}

export interface Estoques {
  estoque_atual: number;
  em_processo: number;
  estoque_disponivel: number;
  estoque_minimo: number;
}

export interface Demanda {
  pedidos_pendentes: number;
  media_vendas_6m: number;
  media_vendas_3m: number;
}

export interface PlanejamentoInfo {
  necessidade_total: number;
  necessidade_producao: number;
  situacao: 'ESTOQUE_OK' | 'PRODUZIR';
  prioridade: 'ALTA' | 'MEDIA' | 'BAIXA';
}

export interface CalculoEstoqueMinimo {
  estoqueMinimo: number;
  mediaSemestral: number;
  mediaTrimestral: number;
  variacaoPercentual: number | null;
  regraAplicada: number;
  descricaoRegra: string;
}

export interface Plano {
  ma: number;  // mês atual (março)
  px: number;  // próximo mês (abril)
  ul: number;  // mês seguinte (maio)
  qt?: number; // quarto mês (junho)
}

export interface Planejamento {
  produto: Produto;
  estoques: Estoques;
  demanda: Demanda;
  plano: Plano;
  planejamento: PlanejamentoInfo;
  calculo_estoque_minimo: CalculoEstoqueMinimo | null;
}

/**
 * Projeção de venda por produto: chave = número do mês ("1"–"12").
 * Ex: { "1": 500, "2": 450, "3": 612, "4": 700, "5": 800 }
 */
export interface ProjecaoSku {
  [mes: string]: number;
}

export interface ProjecoesMap {
  [idproduto: string]: ProjecaoSku;
}

/** Mapeamento dos períodos do plano para número de mês */
export interface PeriodosPlano {
  MA: number;  // mês atual (ex: 3 para março)
  PX: number;  // próximo mês
  UL: number;  // último mês do plano
  QT?: number; // mês seguinte ao UL (opcional)
}

/** Excedente de estoque das lojas por produto */
export interface ExcedenteLoja {
  cd_produto: number;
  excedente_total: number;
  estoque_total_lojas: number;
  lojas_com_excedente: number;
  detalhes_lojas: Array<{
    cd_empresa: number;
    excedente: number;
    estoque_loja: number;
    cobertura_atual: number | null;
  }>;
}

export interface EstoqueLojaDisponivelDetalhe {
  loja_origem: number;
  cd_produto: number;
  referencia: string;
  cor: string;
  tamanho: string;
  produto?: string;
  qtd_sugerida: number;
}

export interface EstoqueLojaDisponivelAggregado {
  cd_produto: number;
  referencia: string;
  cor: string;
  tamanho: string;
  produto?: string;
  qtd_disponivel_total: number;
  lojas_origem_count: number;
  detalhes_lojas: Array<{
    loja_origem: number;
    qtd_sugerida: number;
  }>;
}
