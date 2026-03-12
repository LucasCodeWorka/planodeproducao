const REPROJECAO_REGRAS_FIXAS = [
  {
    faixa: '>=170%',
    minAtendido: 170,
    maxAtendido: Infinity,
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
    minAtendido: -Infinity,
    maxAtendido: 50,
    acao: 'QUEDA_FORTE',
    descricao: 'Aplicar reducao forte e sinalizar retirada de plano / segurar OP.',
  },
];

function clampNonNegative(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function getRegraReprojecao(percentualAtendido) {
  return (
    REPROJECAO_REGRAS_FIXAS.find(
      (regra) => percentualAtendido >= regra.minAtendido && percentualAtendido <= regra.maxAtendido
    ) || REPROJECAO_REGRAS_FIXAS[2]
  );
}

function aplicarReprojecaoMes(valorOriginal, percentualAtendido) {
  const original = Number(valorOriginal) || 0;
  const atend = Number(percentualAtendido) || 0;
  const corrigida = original * (atend / 100);
  const regra = getRegraReprojecao(atend);

  if (regra.acao === 'AUMENTO_CHEIO') {
    return { valor: clampNonNegative(corrigida), regra, valorCorrigido: corrigida };
  }
  if (regra.acao === 'MEDIA_ENTRE_ORIGINAL_E_CORRIGIDA') {
    return { valor: clampNonNegative((original + corrigida) / 2), regra, valorCorrigido: corrigida };
  }
  if (regra.acao === 'QUEDA_LEVE') {
    return { valor: clampNonNegative((original * 0.7) + (corrigida * 0.3)), regra, valorCorrigido: corrigida };
  }
  if (regra.acao === 'QUEDA_FORTE') {
    return {
      valor: clampNonNegative((original * 0.5) + (corrigida * 0.5)),
      regra,
      valorCorrigido: corrigida,
      sinalOperacional: 'RETIRAR_PLANO_SEGURAR_OP',
    };
  }
  return { valor: clampNonNegative(original), regra, valorCorrigido: corrigida };
}

module.exports = {
  REPROJECAO_REGRAS_FIXAS,
  getRegraReprojecao,
  aplicarReprojecaoMes,
};
