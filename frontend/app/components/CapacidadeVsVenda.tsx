'use client';

import { useState } from 'react';
import { History, Search, SlidersHorizontal, TrendingUp } from 'lucide-react';
import { DIAS_FIXOS_POR_MES } from '../lib/feriados';
import AnaliseProjecaoModal from './AnaliseProjecaoModal';

// Capacidade produtiva x projecao de venda, mes a mes, do plano REAL ate o projetado.
//
// Tres decisoes que explicam quase tudo aqui:
//
// 1) A linha do tempo comeca no mes corrente, nao em janeiro. Os meses de plano ja lancado
//    (out -> jan) entram como linha propria em vez de ficarem colapsados dentro do saldo
//    inicial. Sem isso a transicao do real para o projetado some da vista.
//
// 2) A ocupacao que manda e a ACUMULADA, igual a tela de Capacidade: o que nao cabe num mes
//    transborda para o seguinte. Outubro sozinho esta em 169%; janeiro sozinho da 78%, mas
//    carregando o atraso de outubro chega em 95% — e 95% e o numero que a fabrica sente.
//
// 3) Duas leituras de estoque de proposito: o FISICO (estoque + processo, sem abater pedido
//    pendente) e o DISPONIVEL (o mesmo menos a carteira pendente). A carteira nao e uma
//    divida fixa nem some: ela acompanha a venda, porque se vende e fatura o tempo todo no
//    ritmo da expedicao. Por isso ela entra como COBERTURA em dias, regulavel na tela.

export type MesCapacidadeVenda = {
  mes: string;
  /** Projeção dos PERMANENTES. O total da linha soma `demandaEl`. */
  demanda: number;
  /** Projeção de edição limitada, do histórico de coleções. */
  demandaEl?: number;
  /** Mês em curso: projeção do mês INTEIRO (permanentes + EL). A `demanda` acima é só o
   * que falta vender dele, então o primeiro ponto do gráfico desaba sem que a venda tenha
   * caído — este é o número que diz onde ele estaria com o mês cheio. */
  demandaMesCheia?: number;
  /** Mês em curso: venda REAL já faturada. Não é projeção — é o que saiu. Com a `demanda`
   * ao lado fecha o mês: realizado + falta = como ele vai terminar de fato. */
  vendaRealizada?: number;
  /** Mesma projeção aberta por canal. Edição limitada vem separada do histórico. */
  demandaFabrica?: number;
  demandaLojas?: number;
  demandaLojasPermanentes?: number;
  demandaLojasEdicaoLimitada?: number;
  /** Base de cálculo dos permanentes: quanto veio de projeção lançada e quanto do modelo. */
  baseLancada?: number;
  baseModelo?: number;
  /** Base de cálculo da edição limitada: venda do ano de origem, por canal, e o fator. */
  elBase?: { anoFonte: number; fonte: string; fatorFabrica: number; fabricaBase: number; lojasBase: number };
  /** Base dos permanentes: o mesmo mês do ano anterior, por canal. `projecao` quando o mês
   * de origem ainda não fechou e a base é a projeção gravada dele. */
  basePerm?: { ano: number; fabrica: number; lojas: number; fonte: 'venda' | 'projecao' };
  /** Fator aplicado na fábrica dos permanentes (1 = sem crescimento). */
  fatorFabrica?: number;
  /** true = mês do ano corrente: vale a projeção gravada, a base é só comparação. */
  projecaoGravada?: boolean;
  /** Peças que ainda ENTRAM no estoque: plano restante nos meses reais, simulado depois. */
  producao: number;
  /** Plano COMPLETO do mês: o que já virou OP mais o lote que falta (o `qt_lote` cheio).
   * Diferente de `producao`, que é só o restante — este é o plano como foi lançado.
   * Só existe nos meses de plano real (out a jan); nos projetados vem indefinido. */
  planoCompleto?: number;
  /** Dias de fábrica que o plano COMPLETO consome, no ritmo medido do próprio mês. */
  planoCompletoDias?: number;
  /** Dias do mês INTEIRO. Diferente de `diasDisponiveis`, que no mês em curso traz só o
   * que falta. O plano completo ocupou o mês todo, então é contra este que ele se mede. */
  diasDisponiveisMes?: number;
  /** Gap ACUMULADO em dias (necessários − disponíveis), vindo da mesma rota que alimenta
   * a Cobertura do Plano. Positivo = faltam dias. Só nos meses de plano real. */
  gapAcumPlano?: number;
  /** Ocupação acumulada da MESMA conta do `gapAcumPlano`: necessários ÷ disponíveis, os
   * dois acumulados. Vem pronta da rota, não é recalculada aqui, pra não divergir dela. */
  ocupAcumPlano?: number;
  /** As duas parcelas que originam o gap e a ocupação, para abrir no subnível: dias de
   * fábrica que a carga pede e dias que o calendário oferece, ambos acumulados. */
  necAcumPlano?: number;
  dispAcumPlano?: number;
  capacidadePecas: number;
  diasNecessarios: number;
  diasDisponiveis: number;
  /** Baixa de carteira pendente prevista para o mês, pela agenda do ERP. */
  pendenteBaixa?: number;
  /** Saldo de carteira que ainda restaria no fim do mês, se a agenda se cumprir. */
  pendenteSaldo?: number;
  /** Mês com plano real já lançado: entra como piso, o plano nunca é cortado abaixo dele. */
  travado?: boolean;
  /** Mês em curso: já está rodando, então nem o piso sobe — vale o plano como está. */
  mesCorrente?: boolean;
};

type Props = {
  meses: MesCapacidadeVenda[];
  /** Estoque físico (estoque + processo) na abertura do horizonte, sem abater pendentes. */
  aberturaEstoque: number;
  pedidosPendentes: number;
  /** Peças já em processo hoje; somadas apenas na exibição da produção do mês corrente. */
  emProcessoAtual: number;
  /** Referencia de estoque disponivel no fim do horizonte. So leitura: nao limita o plano. */
  metaEstoqueFinal?: number;
  /** Teto de ocupacao (0-1). Limita o plano nos dois modos de nivelamento. */
  limiteOcupacao?: number;
  /** true = `meses` já veio calculado com a capacidade do cenário anterior (grupos
   * descontinuados somados de volta). Só controla o rótulo do botão; quem decide qual
   * capacidade entra em `meses` é a página, não este componente. */
  cenarioCapacidadeAnterior?: boolean;
  onToggleCenarioCapacidadeAnterior?: () => void;
  capacidadeDiariaAtual?: number;
  capacidadeDiariaAnterior?: number;
  gruposDesativados?: string[];
  /** Crescimento da fabrica ao ano (0-1). A pagina recompoe a projecao; aqui so o seletor. */
  cenarioFabrica?: number;
  onCenarioFabrica?: (c: number) => void;
};

// Cobertura PADRAO da carteira, em dias de venda. O medido na carteira de hoje da ~40
// dias, mas ali tem atraso embutido; 25 e o prazo que a expedicao pratica, e e esse que
// vale como politica. O medido continua visivel na faixa de Ajustes, para conferencia.
const CARTEIRA_DIAS_PADRAO = 25;


// Referência operacional informada para out/26. O estoque consolidado já inclui
// carteira e plano; a venda restante vem agora da projeção atualizada da página.
const REFERENCIA_OUTUBRO_2026 = { disponivel: 192541 };

function fmt(v: number) {
  return Math.round(v || 0).toLocaleString('pt-BR');
}

function pct(v: number) {
  return `${Math.round(v * 100)}%`;
}

export default function CapacidadeVsVenda({
  meses,
  aberturaEstoque,
  pedidosPendentes,
  emProcessoAtual,
  metaEstoqueFinal = 100000,
  limiteOcupacao = 0.9,
  cenarioCapacidadeAnterior = false,
  onToggleCenarioCapacidadeAnterior,
  capacidadeDiariaAtual,
  capacidadeDiariaAnterior,
  gruposDesativados = [],
  cenarioFabrica,
  onCenarioFabrica,
}: Props) {
  // Tres leituras, nao duas: o plano como esta, o nivelado com teto no MES e o nivelado com
  // teto no ACUMULADO. Os dois nivelamentos respondem a perguntas diferentes — "nenhum mes
  // passa de 90%" e "a fabrica no conjunto nao passa de 90%" — e com os meses reais ja em
  // 95% eles dao planos bem distintos, entao os dois ficam disponiveis no botao.
  const [modo, setModo] = useState<'capacidade' | 'atual' | 'mes' | 'acumulado'>('capacidade');
  const nivelar = modo !== 'atual';
  // Teto de ocupacao efetivo do modo. "capacidade" roda a fabrica cheia: o que ela aguenta
  // e o que entra no estoque, que e a leitura dos tres pilares.
  const tetoDoModo = modo === 'capacidade' ? 1 : limiteOcupacao;
  // Niveis abertos na tabela. Ausente = aberto; so o `false` explicito fecha, para um nivel
  // novo nascer visivel sem precisar vir cadastrado aqui. O comparativo da divida fixa
  // nasce fechado: e referencia de conferencia, nao leitura do dia a dia.
  // Tudo nasce RECOLHIDO. A tabela abre nas sete linhas de topo, que e a leitura de
  // decisao; os niveis sao para auditar de onde veio o numero, e quem precisa deles abre na
  // seta. Ausente = aberto, entao todo pai expansivel precisa estar listado aqui.
  const [abertos, setAbertos] = useState<Record<string, boolean>>({
    venda: false,
    'venda-perm': false,
    'venda-el': false,
    plano: false,
    pendente: false,
    disponivel: false,
    info: false,
  });
  // Cobertura da carteira, em DIAS de venda — e assim que a operacao pensa o prazo de
  // expedicao. Abre no padrao da casa, nao no medido: o medido e o retrato de hoje, que
  // inclui atraso, e nao a politica.
  const [diasCarteira, setDiasCarteira] = useState<number>(CARTEIRA_DIAS_PADRAO);
  // A faixa de ajustes nasce fechada: o relatorio abre na leitura, nao na configuracao.
  const [mostrarAjustes, setMostrarAjustes] = useState(false);
  const [analiseAberta, setAnaliseAberta] = useState(false);
  // Abre em 'isolado' (cada faixa com sua escala), a leitura pedida pela operacao. A
  // altura entre faixas nao compara quantidades — a legenda do botao avisa isso.
  const [modoGrafico, setModoGrafico] = useState<'isolado' | 'comparado'>('isolado');

  if (!meses.length) return null;

  // Trajetoria de estoque fisico para uma serie de producao qualquer. Sempre recalculada
  // aqui, nunca recebida pronta: assim o plano real, o simulado e o nivelado caminham todos
  // da mesma abertura e ficam comparaveis.
  // A demanda do mes e a soma das duas continuidades. Elas aparecem separadas na tabela,
  // mas o estoque nao distingue: quem sai, sai.
  const demandaTotal = (m: MesCapacidadeVenda) => m.demanda + Number(m.demandaEl || 0);
  const trajetoria = (producoes: number[]) => {
    let saldo = aberturaEstoque;
    return producoes.map((p, i) => {
      saldo += p - demandaTotal(meses[i]);
      return saldo;
    });
  };

  // Nivelamento: mes com plano real fica como esta — ja foi lancado no sistema, nao se
  // nivela nem se corta. Os demais sobem ate o teto de ocupacao. Produzir cedo e o ponto: o
  // estoque sobe no miolo do ano e sustenta os meses em que a venda passa da capacidade.
  //
  // Pecas por dia do mes: o mix de costura dele. Com isto da para ir e voltar entre pecas e
  // dias, que e a moeda em que o teto e escrito. Mes sem plano cai no mix da capacidade.
  const pecasPorDia = (m: MesCapacidadeVenda) => {
    if (m.diasNecessarios > 0 && m.producao > 0) return m.producao / m.diasNecessarios;
    return m.diasDisponiveis > 0 ? m.capacidadePecas / m.diasDisponiveis : 0;
  };
  // CARTEIRA PENDENTE PROJETADA.
  //
  // A agenda do ERP so enxerga pedido JA colocado, entao ela se esgota poucos meses a
  // frente. Ler isso como "a carteira acaba" seria dizer que a fabrica para de receber
  // pedido — e nao e o que acontece: vende-se e fatura-se o tempo todo, no ritmo da
  // expedicao. Sempre existe um livro de pedidos em aberto.
  //
  // Entao a carteira vira uma COBERTURA: quantos meses de venda futura ela representa. O
  // tamanho sai da carteira de hoje — ela e o retrato real do que a operacao carrega — e
  // daí acompanha a curva de venda. Em mes de pico o livro incha, em mes fraco encolhe.
  // Usa a media dos 3 meses seguintes porque e nesse prazo que a agenda do ERP distribui as
  // entregas de hoje; so o mes seguinte deixaria a linha pulando a cada vale da projecao.
  const mediaProximos = (i: number) => {
    const janela = meses.slice(i + 1, i + 4);
    const base = janela.length ? janela : [meses[i]];
    return base.reduce((s, m) => s + demandaTotal(m), 0) / base.length;
  };
  // O tamanho sai da carteira de hoje, mas e so o ponto de partida: quem conhece o prazo
  // real de expedicao e a operacao, entao a cobertura e editavel na tela.
  const baseCarteira = mediaProximos(0);
  const diasMedidos = baseCarteira > 0 ? Math.round((pedidosPendentes / baseCarteira) * 30) : 0;
  const diasEfetivos = diasCarteira;
  const coberturaCarteira = diasEfetivos / 30;
  const carteiraProjetada = meses.map((_, i) => coberturaCarteira * mediaProximos(i));

  const producaoAtual = meses.map((m) => m.producao);
  const totalAtual = producaoAtual.reduce((s, p) => s + p, 0);
  const estoqueAtual = trajetoria(producaoAtual);

  // Todo mes livre roda NO TETO. A meta de estoque final e so referencia na leitura, nao
  // trava a distribuicao: segurar os ultimos meses para cair exatamente nos 100 mil deixava
  // dezembro ocioso de proposito, e terminar com um pouco mais de estoque nao e problema.
  //
  // Com `limitarAcumulado`, alem de nenhum mes passar de 90% dos proprios dias, a SOMA de
  // dias necessarios nao pode passar de 90% da soma de dias disponiveis ate ali. Como os
  // meses reais ja entregam o acumulado em 95%, nesse modo os primeiros meses projetados
  // entram abaixo dos 90% deles proprios para puxar a media de volta — e o preco e estoque
  // disponivel menor no fim.
  const nivelarCom = (limitarAcumulado: boolean) => {
    let necAcum = 0;
    let dispAcum = 0;
    return meses.map((m) => {
      dispAcum += m.diasDisponiveis;
      const diasPeloMes = m.diasDisponiveis * tetoDoModo;
      const diasPeloAcumulado = limitarAcumulado
        ? Math.max(0, dispAcum * tetoDoModo - necAcum)
        : Infinity;
      const dias = Math.min(diasPeloMes, diasPeloAcumulado);
      const peloTeto = m.capacidadePecas * (dias / (m.diasDisponiveis || 1));

      // Mes em curso: ja esta rodando, entao nem o teto o levanta — o que vai sair dele e
      // o plano que esta na rua.
      if (m.mesCorrente) {
        necAcum += m.diasNecessarios;
        return m.producao;
      }
      // Demais meses do plano lancado: o plano e PISO, nao teto. A fabrica puxa trabalho
      // para frente quando sobra capacidade, e faz isso de verdade — em out/2026 ja havia
      // 53 mil pecas do lote de NOVEMBRO em processo. Fixar no plano fazia o disponivel
      // despencar num mes que na pratica nao despenca: novembro mostrava -69 mil de sobra
      // com 134 mil de capacidade ociosa ao lado.
      if (m.travado) {
        if (peloTeto <= m.producao) {
          necAcum += m.diasNecessarios;
          return m.producao;
        }
        // Produzindo acima do plano, os dias sobem na mesma proporcao.
        necAcum += m.diasNecessarios * (m.producao > 0 ? peloTeto / m.producao : 1);
        return peloTeto;
      }
      necAcum += dias;
      return peloTeto;
    });
  };
  const planoNivelado = nivelarCom(modo === 'acumulado');
  const estoqueNivelado = trajetoria(planoNivelado);
  const totalNivelado = planoNivelado.reduce((s, p) => s + p, 0);

  // As duas ocupacoes saem de DIAS, nao de pecas — e a mesma conta do painel de Capacidade,
  // entao os numeros batem com aquela tela. Em peca nao daria: nos meses reais a carga
  // inclui o que ja esta em processo (120 mil pecas so em outubro), que a fabrica ainda tem
  // de costurar mas que nao entra de novo no estoque. Por isso outubro aparece produzindo
  // 40 mil e ocupando 169% ao mesmo tempo.
  let necVista = 0;
  let dispVista = 0;
  // Acumulado do PLANO COMPLETO (o lote cheio, com o que ja virou OP). Só corre enquanto
  // houver plano lançado — de fevereiro em diante não existe plano, só projeção, então a
  // linha para em janeiro em vez de fingir continuidade.
  let planoDiasAcum = 0;
  let planoDispAcum = 0;
  const linhas = meses.map((m, i) => {
    const producao = nivelar ? planoNivelado[i] : m.producao;
    const estoque = nivelar ? estoqueNivelado[i] : estoqueAtual[i];
    // Dias a partir das pecas, pelo mix do mes: assim a linha exibida e exatamente a conta
    // que o teto usou, inclusive num mes cujo plano atual e zero.
    // Num mes real a carga ja inclui o em-processo, entao os dias nao saem das pecas que
    // entram no estoque: escalam junto com o quanto o plano subiu. Num mes projetado saem
    // do mix do proprio mes.
    const ppd = pecasPorDia(m);
    const diasNovos = m.travado
      ? m.diasNecessarios * (m.producao > 0 ? producao / m.producao : 1)
      : (ppd > 0 ? producao / ppd : 0);
    necVista += diasNovos;
    dispVista += m.diasDisponiveis;
    const temPlano = Number(m.planoCompleto || 0) > 0;
    if (temPlano) {
      planoDiasAcum += Number(m.planoCompletoDias || 0);
      // Mês INTEIRO: o plano completo de outubro ocupou outubro todo, não só os dias que
      // ainda faltam. Medir contra o restante daria 585% e não diria nada.
      planoDispAcum += Number(m.diasDisponiveisMes || m.diasDisponiveis || 0);
    }
    return {
      ...m,
      planoDiasAcum: temPlano ? planoDiasAcum : null,
      planoDispAcum: temPlano ? planoDispAcum : null,

      producao,
      estoque,
      producaoAtual: m.producao,
      carteira: carteiraProjetada[i],
      // A carteira sai UMA vez, contra a posicao de abertura. Abater o saldo de cada mes
      // fazia o disponivel nao andar pela sobra: ele levava junto a variacao da propria
      // carteira, e a tabela deixava de fechar de cima para baixo. O livro de pedidos
      // projetado continua na linha de informativo, como referencia.
      disponivel: estoque - carteiraProjetada[0],
      ocupacao: m.diasDisponiveis > 0 ? diasNovos / m.diasDisponiveis : 0,
      ocupacaoAcum: dispVista > 0 ? necVista / dispVista : 0,
      gapAcum: necVista - dispVista,
    };
  });

  const ultimo = linhas[linhas.length - 1];
  const referenciaOutubro = linhas[0]?.mes === 'out/26' ? REFERENCIA_OUTUBRO_2026 : null;
  // Outubro parte do disponível consolidado informado, que JÁ abate carteira e plano.
  // A única diferença a aplicar é o que falta vender além da capacidade restante.
  // Os meses seguintes caminham a partir desse fechamento, sem reaplicar outubro.
  const sobraTabela = (l: typeof linhas[number], i: number) =>
    i === 0 && referenciaOutubro
      ? l.capacidadePecas - demandaTotal(l)
      : l.producao - demandaTotal(l);
  const disponivelTabela = linhas.reduce<number[]>((valores, l, i) => {
    const anterior = i === 0
      ? (referenciaOutubro?.disponivel ?? aberturaEstoque - carteiraProjetada[0])
      : valores[i - 1];
    valores.push(anterior + sobraTabela(l, i));
    return valores;
  }, []);
  // DISPONIVEL PELO PLANO.
  //
  // A linha `Disponível fim do mês` responde "e se a fabrica rodar cheia": nos meses livres
  // ela produz ate o teto, e o plano lancado entra so como piso. So que o plano REAL e bem
  // menor que a capacidade — novembro tem 134.835 de capacidade contra 60.390 de plano — e
  // esse buraco so se fecha se a fabrica puxar trabalho para frente. Esta linha mostra o
  // outro lado: o disponivel se sair exatamente o que esta lancado, nada alem.
  //
  // Mesma base e mesma demanda da linha de cima; a UNICA troca e capacidade -> plano.
  // Assim a diferenca entre as duas linhas e exatamente o quanto se depende de puxar.
  //
  // So o plano RESTANTE entra: o que ja virou OP esta em processo e ja esta contado no
  // estoque de abertura. No mes em curso soma-se o em-processo, que e o que ainda vai
  // pingar. Para em janeiro — de fevereiro em diante nao existe plano, so projecao.
  const disponivelPlano = linhas.reduce<(number | null)[]>((valores, l, i) => {
    if (!l.planoCompleto) {
      valores.push(null);
      return valores;
    }
    const anterior = i === 0
      ? (referenciaOutubro?.disponivel ?? aberturaEstoque - carteiraProjetada[0])
      : (valores[i - 1] ?? disponivelTabela[i - 1]);
    const entra = l.producaoAtual + (l.mesCorrente ? emProcessoAtual : 0);
    valores.push(anterior + entra - demandaTotal(l));
    return valores;
  }, []);
  const desvioMeta = disponivelTabela[disponivelTabela.length - 1] - metaEstoqueFinal;
  const menorDisponivel = Math.min(...disponivelTabela);
  const primeiroProjetado = linhas.findIndex((l) => !l.travado);

  // As tres curvas sao os tres pilares: o que sai (venda), o que entra (capacidade) e o
  // saldo que resulta (disponivel). O disponivel pode ficar negativo, entao o eixo precisa
  // descer abaixo de zero — e so nesse caso a linha do zero aparece.
  // O plano completo vale `null` de fevereiro em diante — ali nao existe plano lancado, so
  // projecao — e tudo que consome a serie precisa pular esses pontos, em vez de desenhar
  // uma queda para zero que nao aconteceu.
  // A ordem aqui e a ordem das FAIXAS, de cima para baixo. O plano fica entre a venda e a
  // capacidade de proposito: a leitura e "quanto vai sair, quanto esta lancado, quanto a
  // fabrica aguenta" — o plano e a ponte entre os dois, e ler isso exige os tres juntos.
  const SERIE_NOMES = ['Venda', 'Plano', 'Capacidade', 'Disponível'];
  const SERIE_COR = ['#f59e0b', '#7c3aed', '#94a3b8', '#4f46e5'];
  const SERIE_COR_TEXTO = ['#b45309', '#6d28d9', '#64748b', '#4f46e5'];
  const serie = (l: typeof linhas[number], i: number): (number | null)[] => [
    demandaTotal(l),
    l.planoCompleto ? Number(l.planoCompleto) : null,
    l.capacidadePecas,
    disponivelTabela[i],
  ];
  // Pelo NOME, nao pelo numero: os `caminho(1)`, `caminho(3)` espalhados pelo SVG ja
  // apontavam para a serie errada so de reordenar a lista acima.
  const iVenda = SERIE_NOMES.indexOf('Venda');
  const iPlano = SERIE_NOMES.indexOf('Plano');
  const iCapacidade = SERIE_NOMES.indexOf('Capacidade');
  const iDisponivel = SERIE_NOMES.indexOf('Disponível');
  const valores = linhas.flatMap(serie).filter((v): v is number => v !== null);
  const teto = Math.max(...valores, 1);
  const piso = Math.min(...valores, 0);
  // O SVG escala por largura, entao TUDO aqui e relativo a W: um texto de 12 unidades num
  // viewBox de 880 renderiza enorme numa tela larga. Alargar o viewBox para 1200 e achatar
  // a altura encolhe a fonte e deita o grafico de uma vez so, sem mexer em cada tamanho.
  // O T maior abre espaco para o rotulo da capacidade acima da linha tracejada.
  const L = 80;
  const R = 20;
  const T = 28;
  const B = 32;
  const W = 1200;
  const H = modoGrafico === 'isolado' ? 400 : 280;
  // Escala arredondada para cima, para a linha de topo cair num numero redondo.
  const passo = Math.pow(10, Math.floor(Math.log10(Math.max(teto, -piso)))) / 2;
  const escalaTopo = Math.ceil(teto / passo) * passo;
  const escalaPiso = Math.floor(piso / passo) * passo;
  const amplitude = escalaTopo - escalaPiso || 1;
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((f) => escalaPiso + amplitude * f);
  const x = (i: number) => L + ((W - L - R) * i) / Math.max(1, linhas.length - 1);
  const y = (v: number) => T + (H - T - B) * (1 - (v - escalaPiso) / amplitude);
  const faixaAltura = (H - T - B) / 4;
  // Referencias do mes em curso: so existem no mes corrente e so na faixa da Venda.
  // Venda ja realizada no mes em curso, e como o mes vai FECHAR (realizado + o que falta).
  // O fechamento e o numero a comparar com a projecao cheia: e a mesma pergunta, uma pelo
  // modelo e outra pelo ritmo medido.
  const vendaRealRef = linhas[0]?.mesCorrente && Number(linhas[0].vendaRealizada || 0) > 0
    ? Number(linhas[0].vendaRealizada)
    : null;
  const fechamentoRef = vendaRealRef !== null ? vendaRealRef + demandaTotal(linhas[0]) : null;
  // Projecao do mes CHEIO: onde o primeiro ponto estaria se o mes nao estivesse pela
  // metade. Sem ela a curva parece desabar em out/26 sem que a venda tenha caido. Precisa
  // de um segundo mes para ter para onde apontar, e so vale a pena quando o cheio e mesmo
  // maior que o restante — no comeco do mes os dois praticamente coincidem.
  const mesCheioRef = linhas.length > 1 && linhas[0]?.mesCorrente
    && Number(linhas[0].demandaMesCheia || 0) > demandaTotal(linhas[0]) * 1.02
    ? Number(linhas[0].demandaMesCheia)
    : null;
  const faixas = [0, 1, 2, 3].map((indice) => {
    const serieAtual = linhas
      .map((l, i) => serie(l, i)[indice])
      .filter((v): v is number => v !== null);
    // O vendido e o fechamento NAO entram na escala: vivem no rodape, em altura fixa.
    // O mes cheio entra, porque ele e desenhado na curva — fora da escala, cairia fora do
    // quadro sempre que passasse do pico da venda projetada.
    if (indice === iVenda && mesCheioRef !== null) serieAtual.push(mesCheioRef);
    return {
      minimo: serieAtual.length ? Math.min(...serieAtual) : 0,
      maximo: serieAtual.length ? Math.max(...serieAtual) : 1,
      topo: T + indice * faixaAltura,
    };
  });
  const ySerie = (indice: number, valor: number) => {
    if (modoGrafico === 'comparado') return y(valor);
    const faixa = faixas[indice];
    const proporcao = faixa.maximo === faixa.minimo ? 0.5 : (valor - faixa.minimo) / (faixa.maximo - faixa.minimo);
    return faixa.topo + 23 + (faixaAltura - 46) * (1 - proporcao);
  };
  // `M` a cada retomada: assim uma serie que so existe em parte do horizonte desenha o
  // trecho que tem e para, em vez de despencar ate o eixo.
  const caminho = (indice: number) => {
    let novoTraco = true;
    return linhas
      .map((l, i) => {
        const v = serie(l, i)[indice];
        if (v === null) { novoTraco = true; return ''; }
        const comando = novoTraco ? 'M' : 'L';
        novoTraco = false;
        return `${comando} ${x(i).toFixed(1)} ${ySerie(indice, v).toFixed(1)}`;
      })
      .filter(Boolean)
      .join(' ');
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg mb-6 overflow-hidden">
      <div className="px-5 py-4 border-b flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-slate-600" />
          <div>
            <h2 className="font-semibold text-gray-900">Capacidade produtiva x projeção de venda</h2>
            {/* Subtitulo oculto a pedido; para reexibir, descomente.
            <p className="text-xs text-gray-500">
              Do plano real ({linhas.filter((l) => l.travado).length} meses já lançados) até o projetado.
              {modo === 'atual'
                ? 'Plano como está hoje, sem nivelar.'
                : `Plano nivelado a ${pct(limiteOcupacao)} ${modo === 'acumulado' ? 'no acumulado' : 'no mês'}.`}
              {' '}Carteira pendente a <strong>{diasEfetivos} dias</strong> de venda
              {diasEfetivos !== diasMedidos ? ` (medido hoje: ${diasMedidos})` : ''}.
            </p>
            */}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAnaliseAberta(true)}
            title="De onde sai a projeção de cada mês"
            className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-50"
          >
            <Search size={14} />
            Analisar projeção
          </button>
          {onCenarioFabrica && cenarioFabrica !== undefined && (
            <div className="flex shrink-0 items-center gap-1.5 rounded border border-gray-200 bg-gray-50 px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Cenário fábrica</span>
              {([0, 0.05, 0.10] as const).map((c, i) => (
                <button
                  key={c}
                  onClick={() => onCenarioFabrica(c)}
                  title={`${c === 0 ? 'Padrão: ' : ''}fábrica +${Math.round(c * 100)}% sobre o mesmo mês do ano anterior. Abril e maio ficam sempre em +20% (sinistro).`}
                  className={`rounded px-2 py-1 text-xs font-semibold transition ${cenarioFabrica === c ? 'bg-slate-800 text-white' : 'text-gray-600 hover:bg-gray-200'}`}
                >
                  {i + 1} · {Math.round(c * 100)}%
                </button>
              ))}
            </div>
          )}
          {onToggleCenarioCapacidadeAnterior && (
            <button
              onClick={onToggleCenarioCapacidadeAnterior}
              title={
                gruposDesativados.length
                  ? `Compara com a capacidade de antes de desativar: ${gruposDesativados.join(', ')}`
                  : 'Compara com a capacidade de antes dos grupos descontinuados'
              }
              className={`inline-flex items-center gap-1.5 rounded border px-3 py-2 text-xs font-semibold transition-colors ${
                cenarioCapacidadeAnterior
                  ? 'border-amber-300 bg-amber-50 text-amber-800'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <History size={14} />
              {cenarioCapacidadeAnterior ? 'Capacidade anterior' : 'Capacidade atual'}
              {Number(capacidadeDiariaAtual) > 0 && Number(capacidadeDiariaAnterior) > 0 && (
                <span className="font-normal text-[11px] opacity-75">
                  ({fmt(cenarioCapacidadeAnterior ? capacidadeDiariaAnterior! : capacidadeDiariaAtual!)}/dia)
                </span>
              )}
            </button>
          )}
          <button
            onClick={() => setMostrarAjustes((v) => !v)}
            title="Ajustes do relatório: leitura do plano e cobertura da carteira"
            className={`inline-flex items-center gap-1.5 rounded border px-3 py-2 text-xs font-semibold transition-colors ${
              mostrarAjustes
                ? 'border-rose-300 bg-rose-50 text-rose-800'
                : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            <SlidersHorizontal size={14} />
            Ajustes
          </button>
        </div>
      </div>

      {/* Cobertura da carteira. Em dias porque e o prazo que a operacao enxerga; o medido
          na carteira de hoje fica ao lado, como ancora. */}
      {mostrarAjustes && (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-rose-50/60 px-5 py-2 text-xs text-rose-900">
        <span className="font-semibold">Carteira pendente</span>
        <label className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={60}
            step={1}
            value={diasEfetivos}
            onChange={(e) => setDiasCarteira(Number(e.target.value))}
            className="h-1 w-40 accent-rose-600"
          />
          <strong className="w-16 tabular-nums">{diasEfetivos} dias</strong>
          <span className="text-rose-700">de venda em aberto</span>
        </label>
        <span className="text-rose-700">
          hoje: <strong>{fmt(pedidosPendentes)}</strong> peças = <strong>{diasMedidos} dias</strong>
        </span>
        <span className="text-rose-700">
          no fim do horizonte: <strong>{fmt(carteiraProjetada[carteiraProjetada.length - 1])}</strong> peças
        </span>
        {diasCarteira !== CARTEIRA_DIAS_PADRAO && (
          <button
            onClick={() => setDiasCarteira(CARTEIRA_DIAS_PADRAO)}
            className="rounded border border-rose-300 px-2 py-0.5 hover:bg-rose-100"
          >
            voltar ao padrão ({CARTEIRA_DIAS_PADRAO}d)
          </button>
        )}
        <span className="ml-auto flex items-center gap-2">
          <span className="font-semibold text-gray-600">Leitura do plano</span>
            <div className="inline-flex rounded border border-gray-300 overflow-hidden">
              {([
                { id: 'capacidade', rotulo: 'Capacidade cheia', dica: 'Produzimos tudo o que a fábrica aguenta: a capacidade do mês é o que entra no estoque' },
              { id: 'atual', rotulo: 'Plano atual', dica: 'O plano como está hoje, sem nivelar' },
                { id: 'mes', rotulo: `${pct(limiteOcupacao)} no mês`, dica: `Nenhum mês passa de ${pct(limiteOcupacao)} dos próprios dias` },
                { id: 'acumulado', rotulo: `${pct(limiteOcupacao)} acumulado`, dica: `A fábrica no conjunto não passa de ${pct(limiteOcupacao)}: os meses reais já entregam 95%, então os projetados entram abaixo para puxar a média` },
              ] as const).map((op) => (
                <button
                  key={op.id}
                  onClick={() => setModo(op.id)}
                  title={op.dica}
                  className={`px-2.5 py-1 text-xs font-semibold border-r last:border-r-0 border-gray-300 transition-colors ${
                    modo === op.id
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {op.rotulo}
                </button>
              ))}
            </div>
        </span>
      </div>
      )}

      {nivelar && (
        <div className="px-5 py-2 bg-indigo-50 border-b border-indigo-200 text-xs text-indigo-900 flex flex-wrap gap-x-6 gap-y-1">
          <span>
            Produção no horizonte: <strong>{fmt(totalAtual)}</strong> → <strong>{fmt(totalNivelado)}</strong>
            {' '}({totalNivelado >= totalAtual ? '+' : ''}{fmt(totalNivelado - totalAtual)})
          </span>
          <span>
            Ocupação acumulada ao fim: <strong>{pct(ultimo.ocupacaoAcum)}</strong>
            {' '}· teto {modo === 'acumulado' ? 'no acumulado' : 'no mês'}
          </span>
          <span className={menorDisponivel < 0 ? 'text-red-700 font-semibold' : ''}>
            Menor disponível do horizonte: <strong>{fmt(menorDisponivel)}</strong>
          </span>
          <span className={desvioMeta >= 0 ? 'text-emerald-800' : 'text-amber-800'}>
            Disponível ao fim: <strong>{fmt(disponivelTabela[disponivelTabela.length - 1])}</strong>
            {' '}({desvioMeta >= 0 ? '+' : ''}{fmt(desvioMeta)} vs. meta)
          </span>
        </div>
      )}

      <div className="px-5 py-4 border-b">
        <div aria-label="Legenda do gráfico" className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
          <span className="font-semibold text-gray-800">Legenda</span>
          <span className="inline-flex items-center gap-2">
            <span className="w-6 border-t-[3px] border-amber-500" aria-hidden="true" />
            Projeção de venda (Em linha)
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="w-6 border-t-2 border-dashed border-slate-400" aria-hidden="true" />
            Capacidade do mês em peças (já descontados 3% de faltas)
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="w-6 border-t-[3px] border-indigo-600" aria-hidden="true" />
            Disponível fim do mês
          </span>
        </div>
        <p className="mb-3 text-xs text-gray-600">
          <span className="font-semibold text-gray-800">Regra da projeção:</span> venda do mesmo mês do ano anterior.
          Fábrica sem acréscimo no cenário 1 (padrão), +5% no cenário 2 e +10% no cenário 3; <strong>abril e maio +20%</strong> em
          todos os cenários (sinistro). Lojas sem acréscimo.
        </p>
        <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-gray-600">
          <div className="inline-flex overflow-hidden rounded border border-gray-300" aria-label="Visualização do gráfico">
            <button type="button" onClick={() => setModoGrafico('isolado')} aria-pressed={modoGrafico === 'isolado'} className={`px-3 py-1.5 ${modoGrafico === 'isolado' ? 'bg-indigo-600 text-white' : 'bg-white hover:bg-gray-50'}`}>
              Comportamento separado
            </button>
            <button type="button" onClick={() => setModoGrafico('comparado')} aria-pressed={modoGrafico === 'comparado'} className={`border-l border-gray-300 px-3 py-1.5 ${modoGrafico === 'comparado' ? 'bg-indigo-600 text-white' : 'bg-white hover:bg-gray-50'}`}>
              Valores na mesma escala
            </button>
          </div>
          {modoGrafico === 'isolado' && <span>Cada faixa usa sua própria escala; altura entre faixas não compara quantidades.</span>}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={modoGrafico === 'isolado' ? 'Tendência separada de venda, capacidade e disponível por mês' : 'Venda, capacidade e disponível na mesma escala por mês'}>
          {modoGrafico === 'comparado' && marcas.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#e5e7eb" strokeWidth="1" />
              <text x={L - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="#9ca3af" fontFamily="ui-monospace, monospace">
                {fmt(v)}
              </text>
            </g>
          ))}
          {modoGrafico === 'isolado' && faixas.map((faixa, indice) => (
            <g key={indice}>
              <rect x={L} y={faixa.topo} width={W - L - R} height={faixaAltura} fill={indice % 2 ? '#f8fafc' : '#ffffff'} />
              <line x1={L} x2={W - R} y1={faixa.topo + faixaAltura} y2={faixa.topo + faixaAltura} stroke="#e5e7eb" />
              <text x={L - 8} y={faixa.topo + 17} textAnchor="end" fontSize="11" fontWeight="600" fill={SERIE_COR_TEXTO[indice]}>
                {SERIE_NOMES[indice]}
              </text>
            </g>
          ))}
          {linhas.map((l, i) => (
            <line key={`g-${l.mes}`} x1={x(i)} x2={x(i)} y1={T} y2={H - B} stroke="#f3f4f6" strokeWidth="1" />
          ))}
          {/* Onde o plano real acaba e a projecao comeca. */}
          {primeiroProjetado > 0 && (
            <g>
              <line
                x1={(x(primeiroProjetado - 1) + x(primeiroProjetado)) / 2}
                x2={(x(primeiroProjetado - 1) + x(primeiroProjetado)) / 2}
                y1={T}
                y2={H - B}
                stroke="#f59e0b"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
              <text
                x={(x(primeiroProjetado - 1) + x(primeiroProjetado)) / 2 + 5}
                y={T + 11}
                fontSize="10"
                fill="#b45309"
              >
                projetado →
              </text>
            </g>
          )}

          {/* Area cinza sob a CAPACIDADE, no modo comparado: e o tamanho da fabrica, o
              fundo contra o qual as outras linhas se leem. */}
          {modoGrafico === 'comparado' && <path
            d={`${caminho(iCapacidade)} L ${x(linhas.length - 1).toFixed(1)} ${y(escalaPiso)} L ${x(0).toFixed(1)} ${y(escalaPiso)} Z`}
            fill="#f1f5f9"
          />}
          {modoGrafico === 'comparado' && escalaPiso < 0 && (
            <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#cbd5e1" strokeWidth="1.5" />
          )}
          {/* Ordem de DESENHO, nao de faixa: a capacidade vai por baixo (tracejada, de
              fundo) e o plano por cima, para nao sumir sob o disponivel no modo comparado. */}
          <path d={caminho(iCapacidade)} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="6 4" />
          <path d={caminho(iVenda)} fill="none" stroke="#f59e0b" strokeWidth="2.5" />
          <path d={caminho(iDisponivel)} fill="none" stroke="#4f46e5" strokeWidth="3.5" strokeLinejoin="round" />
          <path d={caminho(iPlano)} fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeDasharray="2 3" />

          {/* MES CHEIO: o circulo vazado marca onde o primeiro ponto estaria com o mes
              inteiro, e o tracejado liga ele ao ponto real embaixo e ao mes seguinte — a
              curva que a venda teria se outubro ja tivesse fechado. Sem rotulo de proposito:
              o numero esta na legenda do rodape, e escrever de novo aqui foi o que encheu
              este canto de texto sobreposto. */}
          {modoGrafico === 'isolado' && mesCheioRef !== null && (
            <g opacity="0.5">
              <line
                x1={x(0)} x2={x(0)}
                y1={ySerie(iVenda, mesCheioRef)} y2={ySerie(iVenda, demandaTotal(linhas[0]))}
                stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3 3"
              />
              <line
                x1={x(0)} x2={x(1)}
                y1={ySerie(iVenda, mesCheioRef)} y2={ySerie(iVenda, demandaTotal(linhas[1]))}
                stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3 3"
              />
              <circle cx={x(0)} cy={ySerie(iVenda, mesCheioRef)} r="3.5" fill="#fff" stroke="#f59e0b" strokeWidth="1.5">
                <title>{`${linhas[0].mes} · projeção do mês cheio: ${fmt(mesCheioRef)} peças. A curva mostra ${fmt(demandaTotal(linhas[0]))}, que é só o que ainda falta vender.`}</title>
              </circle>
            </g>
          )}

          {/* MES EM CURSO, no rodape da faixa de Venda.
              Separada da curva laranja de proposito: as duas nao precisam conversar. A
              curva responde "quanto ainda falta vender"; esta legenda responde "como o mes
              esta indo". Misturar as duas na mesma escala foi o que empilhou quatro
              rotulos num espaco de 55px e deixou tudo ilegivel.
              O lugar e o respiro de 23px que `ySerie` ja reserva embaixo de cada faixa —
              nenhuma curva desce ate ali, entao nada colide. */}
          {modoGrafico === 'isolado' && vendaRealRef !== null && faixas[iVenda] && (() => {
            const yBase = faixas[iVenda].topo + faixaAltura - 7;
            const cheio = Number(linhas[0]?.demandaMesCheia || 0);
            const dif = cheio > 0 && fechamentoRef !== null ? fechamentoRef / cheio - 1 : null;
            return (
              <g>
                <line x1={L + 4} x2={L + 20} y1={yBase - 3} y2={yBase - 3} stroke="#111827" strokeWidth="2.5" />
                <text x={L + 26} y={yBase} fontSize="9.5" fill="#374151" fontFamily="ui-monospace, monospace">
                  <tspan fontWeight="700" fill="#111827">{fmt(vendaRealRef)}</tspan>
                  <tspan> vendidos em {linhas[0].mes} · fecha em </tspan>
                  <tspan fontWeight="700" fill="#111827">{fmt(fechamentoRef ?? 0)}</tspan>
                  {cheio > 0 && <tspan> · projetado {fmt(cheio)}</tspan>}
                  {dif !== null && (
                    <tspan fontWeight="700" fill={dif < 0 ? '#dc2626' : '#059669'}>
                      {` (${dif > 0 ? '+' : ''}${(dif * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)`}
                    </tspan>
                  )}
                </text>
              </g>
            );
          })()}

          {linhas.map((l, i) => (
            <g key={l.mes}>
              {modoGrafico === 'isolado' ? serie(l, i).map((valor, indice) => (
                valor === null ? null : (
                <g key={indice}>
                  <circle cx={x(i)} cy={ySerie(indice, valor)} r="4" fill="#fff" stroke={SERIE_COR[indice]} strokeWidth="2">
                    <title>{`${l.mes} · ${SERIE_NOMES[indice]}: ${fmt(valor)} peças`}</title>
                  </circle>
                  {/* O primeiro ponto escreve para a DIREITA do marcador. Centralizado, um
                      numero de 6 digitos passa da borda e vira "72.602" no lugar de
                      "202.602"; ancorado em x(0)-10 ele cobria o marcador e encostava no
                      rotulo da faixa ("Plano142.782"). x(0) e exatamente a margem L, entao
                      nao ha espaco a esquerda — o lugar livre e depois do ponto. */}
                  <text x={i === 0 ? x(i) + 8 : x(i)} y={ySerie(indice, valor) - 8} textAnchor={i === 0 ? 'start' : 'middle'} fontSize="10" fontWeight="600" fill={SERIE_COR_TEXTO[indice]} fontFamily="ui-monospace, monospace">
                    {fmt(valor)}
                  </text>
                </g>)
              )) : (
                <>
                  <text x={x(i)} y={Math.max(T - 6, y(l.capacidadePecas) - 7)} textAnchor="middle" fontSize="9.5" fill="#94a3b8" fontFamily="ui-monospace, monospace">
                    {fmt(l.capacidadePecas)}
                  </text>
                  <circle cx={x(i)} cy={y(disponivelTabela[i])} r="3.5" fill="#fff" stroke="#4f46e5" strokeWidth="2" />
                  <text x={x(i)} y={Math.min(y(disponivelTabela[i]) + 14, H - B - 3)} textAnchor="middle" fontSize="10" fontWeight="600" fill="#4f46e5" fontFamily="ui-monospace, monospace">
                    {fmt(disponivelTabela[i])}
                  </text>
                </>
              )}
              <text x={x(i)} y={H - 10} textAnchor="middle" fontSize="11" fill="#6b7280">{l.mes}</text>
            </g>
          ))}
        </svg>
      </div>

      {/* Transposta: mes vira coluna e indicador vira linha, no mesmo formato da Visao
          Geral. Com 15 meses a leitura horizontal e a que importa — da para seguir uma
          linha (a ocupacao, o disponivel) do plano real ate o fim do projetado. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 text-xs uppercase">
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-gray-700 w-52 min-w-[13rem]">
                Indicador
              </th>
              {linhas.map((l, i) => (
                <th
                  key={l.mes}
                  className={`px-3 py-3 text-center font-bold whitespace-nowrap ${
                    l.travado ? 'text-gray-500' : 'text-gray-700'
                  } ${i === primeiroProjetado && primeiroProjetado > 0 ? 'border-l-2 border-l-amber-400 border-dashed' : ''}`}
                  title={l.travado ? 'Plano real já lançado no sistema' : 'Projetado por esta tela'}
                >
                  {l.mes}
                  {l.travado && <div className="text-[9px] font-normal text-gray-400 normal-case">🔒 real</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const defs = [
                {
                  id: 'venda',
                  rotulo: 'Projeção de venda (Em linha)',
                  forte: true,
                  expansivel: true,
                  celula: (l: typeof linhas[number]) => (
                    <span className="text-amber-700 font-semibold">
                      {fmt(demandaTotal(l))}
                    </span>
                  ),
                },
                {
                  id: 'venda-real',
                  rotulo: 'já vendido (real)',
                  pai: 'venda',
                  dica: 'Venda REAL já faturada no mês em curso — não é projeção, é o que saiu do estoque. A linha de cima mostra só o que ainda FALTA vender, por isso o primeiro mês parece baixo.',
                  celula: (l: typeof linhas[number]) => {
                    const v = l.vendaRealizada;
                    if (!v) return <span className="text-gray-300">—</span>;
                    return <span className="font-semibold tabular-nums text-gray-900">{fmt(v)}</span>;
                  },
                },
                {
                  id: 'venda-fecha',
                  rotulo: 'fecha o mês em',
                  pai: 'venda',
                  dica: 'Como o mês termina de verdade: o já vendido mais o que ainda falta, no ritmo medido. Comparar com a projeção cheia logo abaixo diz se o mês está vendendo acima ou abaixo do projetado.',
                  celula: (l: typeof linhas[number]) => {
                    if (!l.vendaRealizada) return <span className="text-gray-300">—</span>;
                    const fecha = Number(l.vendaRealizada) + demandaTotal(l);
                    const cheio = Number(l.demandaMesCheia || 0);
                    const dif = cheio > 0 ? fecha / cheio - 1 : 0;
                    return (
                      <>
                        <span className="font-semibold tabular-nums text-gray-900">{fmt(fecha)}</span>
                        {cheio > 0 && (
                          <div className={`text-[10px] font-semibold ${dif < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                            {dif > 0 ? '+' : ''}{(dif * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs projeção
                          </div>
                        )}
                      </>
                    );
                  },
                },
                {
                  id: 'venda-cheia',
                  rotulo: 'projeção do mês cheio',
                  pai: 'venda',
                  dica: 'O que o modelo projetava para o mês INTEIRO, antes de cortar pelos dias que já passaram. É o número contra o qual o fechamento se compara.',
                  celula: (l: typeof linhas[number]) => {
                    const v = l.demandaMesCheia;
                    if (!v) return <span className="text-gray-300">—</span>;
                    return <span className="tabular-nums text-amber-700">{fmt(v)}</span>;
                  },
                },
                {
                  id: 'venda-fabrica',
                  rotulo: 'fábrica (Em linha)',
                  pai: 'venda',
                  celula: (l: typeof linhas[number]) => (
                    <span className="text-amber-600">{fmt(l.demandaFabrica || 0)}</span>
                  ),
                },
                {
                  id: 'venda-lojas',
                  rotulo: 'lojas (Em linha)',
                  pai: 'venda',
                  celula: (l: typeof linhas[number]) => (
                    <span className="text-amber-600">{fmt(l.demandaLojas || 0)}</span>
                  ),
                },
                {
                  id: 'venda-perm',
                  rotulo: 'permanente',
                  pai: 'venda',
                  expansivel: true,
                  celula: (l: typeof linhas[number]) => <span className="text-amber-600">{fmt(l.demanda)}</span>,
                },
                {
                  id: 'venda-perm-lancada',
                  rotulo: 'projeção lançada no sistema',
                  pai: 'venda-perm',
                  celula: (l: typeof linhas[number]) => (
                    <span className="text-gray-500">{l.baseLancada ? fmt(l.baseLancada) : '—'}</span>
                  ),
                },
                {
                  id: 'venda-perm-modelo',
                  rotulo: 'modelo (regra de crescimento)',
                  pai: 'venda-perm',
                  celula: (l: typeof linhas[number]) => (
                    <span className="text-gray-500">{l.baseModelo ? fmt(l.baseModelo) : '—'}</span>
                  ),
                },
                {
                  id: 'venda-el',
                  rotulo: 'edição limitada',
                  pai: 'venda',
                  expansivel: true,
                  celula: (l: typeof linhas[number]) => <span className="text-amber-600">{fmt(l.demandaEl || 0)}</span>,
                },
                {
                  id: 'venda-el-base',
                  rotulo: 'base: venda da coleção',
                  pai: 'venda-el',
                  celula: (l: typeof linhas[number]) =>
                    l.elBase ? (
                      <>
                        <span className="text-gray-500">{fmt(l.elBase.fabricaBase + l.elBase.lojasBase)}</span>
                        <div className="text-[10px] text-gray-400">
                          em {l.elBase.anoFonte}
                          {l.elBase.fonte.includes('recuo') ? ' (recuo)' : ''}
                        </div>
                      </>
                    ) : (
                      <span className="text-gray-400">projeção gravada</span>
                    ),
                },
                {
                  id: 'venda-el-canal',
                  rotulo: 'fábrica × fator + lojas',
                  pai: 'venda-el',
                  celula: (l: typeof linhas[number]) =>
                    l.elBase ? (
                      <span className="text-gray-500">
                        {fmt(l.elBase.fabricaBase)}×{String(l.elBase.fatorFabrica).replace('.', ',')}
                        {' + '}{fmt(l.elBase.lojasBase)}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    ),
                },
                {
                  id: 'capacidade',
                  rotulo: 'Capacidade',
                  forte: true,
                  celula: (l: typeof linhas[number]) => <span className="text-gray-600">{fmt(l.capacidadePecas)}</span>,
                },
                {
                  id: 'plano',
                  rotulo: 'Plano (completo)',
                  forte: true,
                  expansivel: true,
                  dica: 'Plano como foi lançado: o que já virou OP mais o lote que falta, pelo mês do próprio lote. Embaixo, a ocupação ACUMULADA e o gap em dias — os mesmos números da Cobertura do Plano na tela principal, vindos da mesma conta: dias necessários somados desde o primeiro mês contra os dias de fábrica somados. 207% em outubro é a carga que resta contra os dias que restam; janeiro em 92% é o conjunto, já carregando o atraso de outubro. Só existe até janeiro: de fevereiro em diante não há plano, só projeção.',
                  celula: (l: typeof linhas[number]) => {
                    if (!l.planoCompleto) return <span className="text-gray-300">—</span>;
                    // Abaixo do numero, o GAP ACUMULADO em dias — o mesmo +6,45d / -5,09d
                    // que a Cobertura do Plano mostra na tela principal, e vindo da mesma
                    // rota (`/api/capacidade/gap-mensal`) de proposito: calcular por aqui
                    // daria um numero proximo mas diferente, e a tela voltaria a "nao
                    // bater". Tentamos antes mostrar os dias do plano do mes ("20,7d de
                    // 21d"), mas aquilo falava do mes INTEIRO enquanto a ocupacao ao lado
                    // fala do que FALTA — duas perguntas na mesma celula. Os campos
                    // (`planoCompletoDias`, `planoDiasAcum`, `planoDispAcum`) seguem
                    // calculados, so nao sao exibidos.
                    const gap = l.gapAcumPlano;
                    const ocup = l.ocupAcumPlano;
                    return (
                      <>
                        <span className="font-semibold text-violet-700">{fmt(l.planoCompleto)}</span>
                        {gap !== undefined && gap !== null && (
                          <div
                            title="Ocupação e gap ACUMULADOS desde o primeiro mês: dias necessários contra dias de fábrica. Acima de 100% a carga não cabe e transborda para o mês seguinte. Mesmos números da Cobertura do Plano."
                            className="font-mono text-[10px] font-bold tabular-nums"
                          >
                            {ocup !== undefined && ocup !== null && (
                              <span className={ocup > 1 ? 'text-red-600' : ocup >= 0.85 ? 'text-emerald-600' : 'text-amber-600'}>
                                {pct(ocup)}
                              </span>
                            )}
                            {ocup !== undefined && ocup !== null && <span className="text-gray-300"> · </span>}
                            <span className={gap > 0 ? 'text-red-600' : 'text-emerald-600'}>
                              {gap > 0 ? '+' : ''}{gap.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}d
                            </span>
                          </div>
                        )}
                      </>
                    );
                  },
                },
                {
                  id: 'planoResto',
                  rotulo: 'restante (ainda sem OP)',
                  pai: 'plano',
                  dica: 'A parte do plano que ainda nao virou OP — e o que de fato ainda vai ENTRAR no estoque, e por isso o numero que a linha Producao usa. O resto do plano ja esta em processo e ja esta contado no estoque. Em percentual: quanto do plano do mes ainda esta por lancar.',
                  celula: (l: typeof linhas[number]) => {
                    if (!l.planoCompleto) return <span className="text-gray-300">—</span>;
                    const resto = l.producaoAtual;
                    const fatia = l.planoCompleto > 0 ? resto / l.planoCompleto : 0;
                    return (
                      <>
                        <span className="tabular-nums text-violet-600">{fmt(resto)}</span>
                        <div className="text-[10px] text-gray-400">{pct(fatia)} do plano</div>
                      </>
                    );
                  },
                },
                {
                  id: 'planoNec',
                  rotulo: 'dias necessários (acum.)',
                  pai: 'plano',
                  dica: 'Dias de fábrica que a carga acumulada pede, desde o primeiro mês do horizonte. Sai do tempo de processo da carga dividido pela capacidade diária da fábrica.',
                  celula: (l: typeof linhas[number]) => {
                    const v = l.necAcumPlano;
                    if (v === undefined || v === null) return <span className="text-gray-300">—</span>;
                    return (
                      <span className="tabular-nums text-gray-600">
                        {v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}d
                      </span>
                    );
                  },
                },
                {
                  id: 'planoDisp',
                  rotulo: 'dias de fábrica (acum.)',
                  pai: 'plano',
                  dica: 'Dias que o calendário oferece, acumulados. O mês em curso entra só com o que FALTA dele (outubro/26 entra com 6, não com 21) — é por isso que o primeiro mês aparece tão carregado.',
                  celula: (l: typeof linhas[number]) => {
                    const v = l.dispAcumPlano;
                    if (v === undefined || v === null) return <span className="text-gray-300">—</span>;
                    return (
                      <span className="tabular-nums text-gray-600">
                        {v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}d
                      </span>
                    );
                  },
                },
                {
                  id: 'sobra',
                  rotulo: 'Sobra do mês (entra − sai)',
                  forte: true,
                  celula: (l: typeof linhas[number]) => {
                    const d = sobraTabela(l, linhas.indexOf(l));
                    return (
                      <span className={d >= 0 ? 'text-emerald-700' : 'text-red-700'}>
                        {d >= 0 ? '+' : '−'}{fmt(Math.abs(d))}
                      </span>
                    );
                  },
                },
                {
                  id: 'disponivel',
                  rotulo: 'Disponível fim do mês',
                  forte: true,
                  celula: (l: typeof linhas[number]) => (
                    <span className={`font-semibold ${disponivelTabela[linhas.indexOf(l)] < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                      {fmt(disponivelTabela[linhas.indexOf(l)])}
                    </span>
                  ),
                },
                {
                  id: 'info',
                  rotulo: 'Informativo',
                  expansivel: true,
                  celula: () => <span className="text-gray-300">·</span>,
                },
                // A Producao planejada saia aqui (o nivelado do mes, com o recorte
                // "24.655 plano + 120.077 em processo" no mes corrente). Saiu a pedido: a
                // leitura de quanto o plano entrega agora esta na linha do Plano e no
                // Disponível só com o plano, sem precisar de uma terceira versao do mesmo
                // numero. `producao` e `producaoAtual` seguem no calculo — o nivelamento,
                // o grafico e o disponivel dependem deles.
                {
                  id: 'dispPlano',
                  rotulo: 'Disponível só com o plano',
                  pai: 'info',
                  dica: 'O Disponível de cima assume a fábrica rodando CHEIA — nos meses livres ela produz até o teto, e o plano entra só como piso. Esta linha assume o contrário: sai exatamente o que está lançado, nada é puxado para frente. Mesma base e mesma venda; a única troca é capacidade por plano, então a diferença entre as duas linhas é o quanto se depende de puxar trabalho. Só vai até janeiro, que é até onde existe plano.',
                  celula: (l: typeof linhas[number]) => {
                    const v = disponivelPlano[linhas.indexOf(l)];
                    if (v === null || v === undefined) return <span className="text-gray-300">—</span>;
                    const delta = v - disponivelTabela[linhas.indexOf(l)];
                    return (
                      <>
                        <span className={`font-semibold ${v < 0 ? 'text-red-700' : 'text-violet-700'}`}>{fmt(v)}</span>
                        {Math.abs(delta) >= 1 && (
                          <div className="text-[10px] font-normal text-gray-400">
                            {delta > 0 ? '+' : '−'}{fmt(Math.abs(delta))} vs capacidade
                          </div>
                        )}
                      </>
                    );
                  },
                },
                // A Ocupacao acumulada saia aqui (222% / +7,3d acum. em outubro) e discordava
                // da propria linha do Plano logo acima (207% / +6,45d): uma vinha da conta
                // interna deste componente, a outra da rota que alimenta a Cobertura do
                // Plano. Dois numeros para a mesma pergunta na mesma tela. Fica so o do
                // Plano, que e o que bate com a tela principal. Os campos `ocupacaoAcum`,
                // `gapAcum` e `ocupacao` seguem calculados — o nivelamento e a faixa de
                // resumo usam eles.
                {
                  id: 'fisico',
                  rotulo: 'Estoque (s/ abater pedidos)',
                  pai: 'info',
                  celula: (l: typeof linhas[number]) => <span className="text-slate-700">{fmt(l.estoque)}</span>,
                },
                {
                  id: 'pendente',
                  rotulo: 'Carteira pendente',
                  pai: 'info',
                  expansivel: true,
                  celula: (l: typeof linhas[number]) => (
                    <span className="text-rose-700">−{fmt(l.carteira)}</span>
                  ),
                },
                {
                  id: 'pendente-firme',
                  rotulo: 'firme hoje (pedido já colocado)',
                  pai: 'pendente',
                  celula: (l: typeof linhas[number]) => (
                    <span className="text-gray-500">
                      {Number(l.pendenteSaldo) > 0 ? fmt(l.pendenteSaldo || 0) : '—'}
                    </span>
                  ),
                },
                {
                  id: 'pendente-baixa',
                  rotulo: 'entregue no mês (agenda do ERP)',
                  pai: 'pendente',
                  celula: (l: typeof linhas[number]) => (
                    <span className="text-gray-500">{l.pendenteBaixa ? fmt(l.pendenteBaixa) : '—'}</span>
                  ),
                },
              ] as const;
              // Parentesco derivado da propria lista: evita manter um mapa em paralelo que
              // sai de sincronia na primeira linha nova.
              const paiDe: Record<string, string> = {};
              defs.forEach((d) => { if ('pai' in d) paiDe[d.id] = d.pai; });
              return defs
              // Visibilidade em CADEIA: um neto so aparece se o pai e o avo estiverem abertos.
              // O zebrado usa a posicao VISIVEL, senao abrir um nivel trocaria a cor de todas
              // as linhas de baixo.
              .filter((linha) => {
                let pai = 'pai' in linha ? (linha.pai as string) : null;
                while (pai) {
                  if (abertos[pai] === false) return false;
                  pai = paiDe[pai] || null;
                }
                return true;
              })
              .map((linha, idx) => {
                // Profundidade pela cadeia de pais, para o recuo acompanhar o nivel.
                let nivel = 0;
                let ancestral: string | null = 'pai' in linha ? linha.pai : null;
                while (ancestral) {
                  nivel += 1;
                  ancestral = paiDe[ancestral] || null;
                }
                const ehFilho = nivel > 0;
                const expansivel = 'expansivel' in linha;
                const aberto = expansivel ? abertos[linha.id] !== false : false;
                // A `dica` das linhas estava sendo escrita e nunca exibida — a explicacao
                // do Plano (completo) existia no codigo e nao chegava na tela. Vai no
                // rotulo, com `cursor-help` para o tracejado avisar que tem texto ali.
                const dica = 'dica' in linha ? (linha.dica as string) : undefined;
                return (
                  <tr key={linha.id} className={`border-t border-gray-100 ${idx % 2 === 1 ? 'bg-gray-50' : ''}`}>
                    <td
                      title={dica}
                      className={`sticky left-0 z-10 px-4 py-3 text-left whitespace-nowrap ${
                        idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'
                      } ${'forte' in linha ? 'font-semibold text-gray-800' : 'text-gray-600'} ${
                        ehFilho ? `py-2 text-xs font-normal text-gray-500 ${nivel === 1 ? 'pl-9' : 'pl-16'}` : ''
                      } ${dica ? 'cursor-help decoration-dotted underline-offset-4 [text-decoration-line:underline]' : ''}`}
                    >
                      {expansivel ? (
                        <button
                          onClick={() => setAbertos((a) => ({ ...a, [linha.id]: a[linha.id] === false }))}
                          className="inline-flex items-center gap-1 hover:text-gray-900"
                          title={aberto ? 'Recolher níveis' : 'Abrir níveis'}
                        >
                          <span className="inline-block w-2 text-[10px] text-gray-400">{aberto ? '▾' : '▸'}</span>
                          {linha.rotulo}
                        </button>
                      ) : (
                        <>
                          {ehFilho && <span className="mr-1 text-gray-300">└</span>}
                          {linha.rotulo}
                        </>
                      )}
                    </td>
                    {linhas.map((l, i) => (
                      <td
                        key={l.mes}
                        className={`px-3 text-center font-mono whitespace-nowrap ${
                          ehFilho ? 'py-2 text-xs' : 'py-3'
                        } ${
                          i === primeiroProjetado && primeiroProjetado > 0 ? 'border-l-2 border-l-amber-400 border-dashed' : ''
                        }`}
                      >
                        {linha.celula(l)}
                      </td>
                    ))}
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>
      </div>
      {analiseAberta && <AnaliseProjecaoModal meses={linhas} onClose={() => setAnaliseAberta(false)} />}
      <div className="px-5 py-3 border-t text-xs text-gray-500">
        Férias coletivas consideradas em 2026 e 2027: <strong>{DIAS_FIXOS_POR_MES[12]} dias</strong> em dezembro e <strong>{DIAS_FIXOS_POR_MES[1]} dias</strong> em janeiro.
      </div>
    </div>
  );
}
