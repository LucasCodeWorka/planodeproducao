const REPROJECAO_REGRAS_FIXAS = [
  {
    faixa: '>= +70%',
    minAtendido: 170,
    maxAtendido: Infinity,
    acao: 'AUMENTO_CHEIO',
    descricao: 'Venda do mes fechado ficou 70% ou mais acima da projecao. A partir do mes seguinte, aumentar a projecao futura de forma balanceada com a projecao original.',
    exemplo: 'Ex: projecao jan 100 e venda jan 170 (+70%). Se fev projetado era 200, corrigida cheia = 340; ajuste balanceado = 70% de 200 + 30% de 340 = 242.',
  },
  {
    faixa: '+30% a +69,99%',
    minAtendido: 130,
    maxAtendido: 169.99,
    acao: 'MEDIA_ENTRE_ORIGINAL_E_CORRIGIDA',
    descricao: 'Venda ficou entre 30% e 69,99% acima da projecao. Manter o mes seguinte e aplicar, a partir do mes subsequente, a media entre a projecao original e a corrigida pela variacao.',
    exemplo: 'Ex: projecao jan 100 e venda jan 150 (+50%). Fev fica original. Se mar projetado era 220, corrigida = 330; novo mar = media entre 220 e 330 = 275.',
  },
  {
    faixa: '-30% a +29,99%',
    minAtendido: 70,
    maxAtendido: 129.99,
    acao: 'MANTER',
    descricao: 'Venda ficou dentro da faixa estavel, de 30% abaixo ate 29,99% acima do previsto. Manter a projecao.',
    exemplo: 'Ex: projecao jan 100 e venda jan 110 (+10%). Se fev projetado era 200 e mar 220, continuam 200 e 220.',
  },
  {
    faixa: '-49,99% a -30,01%',
    minAtendido: 50.01,
    maxAtendido: 69.99,
    acao: 'QUEDA_LEVE',
    descricao: 'Venda ficou de 30,01% a 49,99% abaixo da projecao. Manter o mes seguinte e aplicar, a partir do mes subsequente, reducao leve com peso maior para a projecao original.',
    exemplo: 'Ex: projecao jan 100 e venda jan 60 (-40%). Fev fica original. Se mar projetado era 220, corrigida = 132; novo mar = 70% de 220 + 30% de 132 = 194.',
  },
  {
    faixa: '<= -50%',
    minAtendido: -Infinity,
    maxAtendido: 50,
    acao: 'QUEDA_FORTE',
    descricao: 'Venda ficou 50% ou mais abaixo do previsto. Aplicar reducao forte e sinalizar retirada de plano ou segurar OP.',
    exemplo: 'Ex: projecao jan 100 e venda jan 50 (-50%). Se fev projetado era 200, corrigida = 100; novo fev = media forte entre 200 e 100 = 150, com alerta para segurar OP.',
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
