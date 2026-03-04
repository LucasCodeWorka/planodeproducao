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

export interface Planejamento {
  produto: Produto;
  estoques: Estoques;
  demanda: Demanda;
  planejamento: PlanejamentoInfo;
  calculo_estoque_minimo: CalculoEstoqueMinimo | null;
}
