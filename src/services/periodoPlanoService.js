// Rotulos posicionais do plano, na mesma ordem do ERP (`pcp_lotepv.cd_auxiliar`):
// MA = mes atual, PX = proximo, UL = o seguinte, e dali em diante pelo ordinal —
// QT quarto, QU quinto, SX sexto, ST setimo, OT oitavo, NV nono.
//
// ST ja existia no ERP com producao prevista para abr/2027 e estava fora desta lista, entao
// o sistema inteiro ignorava um periodo que a fabrica ja tinha. OT e NV foram acrescentados
// para o PCP conseguir emitir ate junho na mesma rodada, em vez de esperar a janela rolar.
const PERIODOS_PLANO = ['MA', 'PX', 'UL', 'QT', 'QU', 'SX', 'ST', 'OT', 'NV'];

/**
 * Períodos do plano de produção (MA/PX/UL/QT/QU/SX), a partir de uma data de referência
 * (padrão: agora).
 *
 * Fonte única — antes desta função existiam 5 cópias divergentes espalhadas pelo código
 * (capacidade.js x3, projecoes.js, analises.js, producaoService.js, producao.js), e nem
 * todas tinham a regra abaixo. Medido em 30/09/2026: elas discordavam sobre qual é o mês
 * corrente do plano (MA) NO MESMO DIA — capacidade.js dizia outubro, as outras diziam
 * setembro. Isso é o tipo de bug que não aparece em teste isolado, só quando duas telas
 * são comparadas lado a lado no dia exato em que o período vira.
 *
 * Regra (confirmada com o usuário): MA é o mês corrente, e vira para o mês seguinte no
 * ÚLTIMO DIA do mês corrente — não no dia 1 do mês novo. `new Date` normaliza mês e ano
 * sozinho (passar mês 12 já rola pro janeiro do ano seguinte), então não tem aritmética de
 * módulo pra errar.
 */
function calcularPeriodosPlano(referencia = new Date()) {
  const ano = referencia.getFullYear();
  const mesJs = referencia.getMonth(); // 0-11
  const ultimoDiaDoMes = new Date(ano, mesJs + 1, 0).getDate();
  const eUltimoDia = referencia.getDate() === ultimoDiaDoMes;
  const indiceBase = mesJs + (eUltimoDia ? 1 : 0);

  const datas = {};
  const meses = {};
  PERIODOS_PLANO.forEach((periodo, offset) => {
    const data = new Date(ano, indiceBase + offset, 1);
    datas[periodo] = data;
    meses[periodo] = data.getMonth() + 1; // 1-12, sem o ano
  });
  return { meses, datas };
}

module.exports = { calcularPeriodosPlano, PERIODOS_PLANO };
