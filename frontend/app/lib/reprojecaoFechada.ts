export type RegraReprojecaoRow = {
  faixa: string;
  minAtendido: number;
  maxAtendido: number;
  acao: string;
  descricao: string;
};

export const REPROJECAO_REGRAS_FIXAS: RegraReprojecaoRow[] = [
  {
    faixa: '>=170%',
    minAtendido: 170,
    maxAtendido: Number.POSITIVE_INFINITY,
    acao: 'AUMENTO_CHEIO',
    descricao: 'Aplicar a variacao cheia observada no ultimo mes fechado sobre a projecao futura.',
  },
  {
    faixa: '130% a 169,99%',
    minAtendido: 130,
    maxAtendido: 169.99,
    acao: 'MEDIA_ENTRE_ORIGINAL_E_CORRIGIDA',
    descricao: 'Usar a media entre a projecao original e a projecao corrigida pela variacao observada.',
  },
  {
    faixa: '70% a 129,99%',
    minAtendido: 70,
    maxAtendido: 129.99,
    acao: 'MANTER',
    descricao: 'Manter a projecao sem ajuste.',
  },
  {
    faixa: '50,01% a 69,99%',
    minAtendido: 50.01,
    maxAtendido: 69.99,
    acao: 'QUEDA_LEVE',
    descricao: 'Aplicar reducao leve com peso maior para a projecao original.',
  },
  {
    faixa: '<=50%',
    minAtendido: Number.NEGATIVE_INFINITY,
    maxAtendido: 50,
    acao: 'QUEDA_FORTE',
    descricao: 'Aplicar reducao forte e sinalizar retirada de plano / segurar OP.',
  },
];
