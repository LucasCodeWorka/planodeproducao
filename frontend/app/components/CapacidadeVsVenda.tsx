'use client';

import { useState } from 'react';
import { SlidersHorizontal, TrendingUp } from 'lucide-react';

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
  /** Mesma projeção aberta por canal. Exato na edição limitada, rateado nos permanentes. */
  demandaFabrica?: number;
  demandaLojas?: number;
  /** Base de cálculo dos permanentes: quanto veio de projeção lançada e quanto do modelo. */
  baseLancada?: number;
  baseModelo?: number;
  /** Base de cálculo da edição limitada: venda do ano de origem, por canal, e o fator. */
  elBase?: { anoFonte: number; fonte: string; fatorFabrica: number; fabricaBase: number; lojasBase: number };
  /** Peças que ainda ENTRAM no estoque: plano restante nos meses reais, simulado depois. */
  producao: number;
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
};

// Cobertura PADRAO da carteira, em dias de venda. O medido na carteira de hoje da ~40
// dias, mas ali tem atraso embutido; 25 e o prazo que a expedicao pratica, e e esse que
// vale como politica. O medido continua visivel na faixa de Ajustes, para conferencia.
const CARTEIRA_DIAS_PADRAO = 25;


// Referência operacional informada para out/26. Já inclui estoque, carteira e plano;
// não se deve aplicar essas parcelas de novo. Substituir por fonte de dados quando
// essa posição consolidada estiver disponível no backend.
const REFERENCIA_OUTUBRO_2026 = { disponivel: 192541, vendaRestante: 131713 };

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
    ocupAcum: false,
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
      // O mes em curso fica como esta: faltam poucos dias e o que vai sair da costura e o
      // que ja esta na fila, nao a capacidade teorica do mes inteiro.
      if (m.mesCorrente) {
        necAcum += m.diasNecessarios;
        return m.producao;
      }
      const diasPeloMes = m.diasDisponiveis * tetoDoModo;
      const diasPeloAcumulado = limitarAcumulado
        ? Math.max(0, dispAcum * tetoDoModo - necAcum)
        : Infinity;
      const dias = Math.min(diasPeloMes, diasPeloAcumulado);
      const peloTeto = m.capacidadePecas * (dias / (m.diasDisponiveis || 1));
      // Mes com plano real ja lancado e PISO, nao teto: da para carregar a fabrica ate a
      // capacidade, nao da para cortar abaixo do que ja foi emitido.
      const q = m.travado ? Math.max(m.producao, peloTeto) : peloTeto;
      necAcum += m.travado && m.producao > 0
        ? m.diasNecessarios * (q / m.producao)
        : dias;
      return q;
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
    return {
      ...m,

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
      ? l.capacidadePecas - referenciaOutubro.vendaRestante
      : l.producao - demandaTotal(l);
  const disponivelTabela = linhas.reduce<number[]>((valores, l, i) => {
    const anterior = i === 0
      ? (referenciaOutubro?.disponivel ?? aberturaEstoque - carteiraProjetada[0])
      : valores[i - 1];
    valores.push(anterior + sobraTabela(l, i));
    return valores;
  }, []);
  const mesAtual = linhas[0];
  const disponivelLiquidoMesAtual = disponivelTabela[0];
  const desvioMeta = disponivelTabela[disponivelTabela.length - 1] - metaEstoqueFinal;
  const menorDisponivel = Math.min(...disponivelTabela);
  const primeiroProjetado = linhas.findIndex((l) => !l.travado);

  // As tres curvas sao os tres pilares: o que sai (venda), o que entra (capacidade) e o
  // saldo que resulta (disponivel). O disponivel pode ficar negativo, entao o eixo precisa
  // descer abaixo de zero — e so nesse caso a linha do zero aparece.
  const serie = (l: typeof linhas[number], i: number) => [
    i === 0 && referenciaOutubro ? referenciaOutubro.vendaRestante : demandaTotal(l),
    l.capacidadePecas,
    disponivelTabela[i],
  ];
  const valores = linhas.flatMap(serie);
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
  const faixaAltura = (H - T - B) / 3;
  const faixas = [0, 1, 2].map((indice) => {
    const serieAtual = linhas.map((l, i) => serie(l, i)[indice]);
    return { minimo: Math.min(...serieAtual), maximo: Math.max(...serieAtual), topo: T + indice * faixaAltura };
  });
  const ySerie = (indice: number, valor: number) => {
    if (modoGrafico === 'comparado') return y(valor);
    const faixa = faixas[indice];
    const proporcao = faixa.maximo === faixa.minimo ? 0.5 : (valor - faixa.minimo) / (faixa.maximo - faixa.minimo);
    return faixa.topo + 23 + (faixaAltura - 46) * (1 - proporcao);
  };
  const caminho = (indice: number) =>
    linhas.map((l, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${ySerie(indice, serie(l, i)[indice]).toFixed(1)}`).join(' ');

  return (
    <div className="bg-white border border-gray-200 rounded-lg mb-6 overflow-hidden">
      <div className="px-5 py-4 border-b flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-slate-600" />
          <div>
            <h2 className="font-semibold text-gray-900">Capacidade produtiva x projeção de venda</h2>
            <p className="text-xs text-gray-500">
              Do plano real ({linhas.filter((l) => l.travado).length} meses já lançados) até o projetado.
              {modo === 'atual'
                ? 'Plano como está hoje, sem nivelar.'
                : `Plano nivelado a ${pct(limiteOcupacao)} ${modo === 'acumulado' ? 'no acumulado' : 'no mês'}.`}
              {' '}Carteira pendente a <strong>{diasEfetivos} dias</strong> de venda
              {diasEfetivos !== diasMedidos ? ` (medido hoje: ${diasMedidos})` : ''}.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-gray-500">Disponível líquido · {mesAtual.mes}</div>
            <div className={`text-xl font-bold ${disponivelLiquidoMesAtual < 0 ? 'text-red-700' : 'text-amber-700'}`}>
              {fmt(disponivelLiquidoMesAtual)}
            </div>
          </div>
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
            Projeção de venda
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="w-6 border-t-2 border-dashed border-slate-400" aria-hidden="true" />
            Capacidade do mês em peças (já descontados 5% de faltas)
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="w-6 border-t-[3px] border-indigo-600" aria-hidden="true" />
            Disponível fim do mês
          </span>
        </div>
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
              <text x={L - 8} y={faixa.topo + 17} textAnchor="end" fontSize="11" fontWeight="600" fill={['#b45309', '#64748b', '#4f46e5'][indice]}>
                {['Venda', 'Capacidade', 'Disponível'][indice]}
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

          {modoGrafico === 'comparado' && <path
            d={`${caminho(1)} L ${x(linhas.length - 1).toFixed(1)} ${y(escalaPiso)} L ${x(0).toFixed(1)} ${y(escalaPiso)} Z`}
            fill="#f1f5f9"
          />}
          {modoGrafico === 'comparado' && escalaPiso < 0 && (
            <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#cbd5e1" strokeWidth="1.5" />
          )}
          <path d={caminho(1)} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="6 4" />
          <path d={caminho(0)} fill="none" stroke="#f59e0b" strokeWidth="2.5" />
          <path d={caminho(2)} fill="none" stroke="#4f46e5" strokeWidth="3.5" strokeLinejoin="round" />

          {linhas.map((l, i) => (
            <g key={l.mes}>
              {modoGrafico === 'isolado' ? serie(l, i).map((valor, indice) => (
                <g key={indice}>
                  <circle cx={x(i)} cy={ySerie(indice, valor)} r="4" fill="#fff" stroke={['#f59e0b', '#94a3b8', '#4f46e5'][indice]} strokeWidth="2">
                    <title>{`${l.mes} · ${['Venda', 'Capacidade', 'Disponível'][indice]}: ${fmt(valor)} peças`}</title>
                  </circle>
                  <text x={x(i)} y={ySerie(indice, valor) - 8} textAnchor="middle" fontSize="10" fontWeight="600" fill={['#b45309', '#64748b', '#4f46e5'][indice]} fontFamily="ui-monospace, monospace">
                    {fmt(valor)}
                  </text>
                </g>
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
                  rotulo: 'Projeção de venda',
                  forte: true,
                  expansivel: true,
                  celula: (l: typeof linhas[number]) => (
                    <span className="text-amber-700 font-semibold">
                      {fmt(l === mesAtual && referenciaOutubro ? referenciaOutubro.vendaRestante : demandaTotal(l))}
                    </span>
                  ),
                },
                {
                  id: 'venda-fabrica',
                  rotulo: 'fábrica',
                  pai: 'venda',
                  celula: (l: typeof linhas[number]) => (
                    <span className="text-amber-600">{fmt(l.demandaFabrica || 0)}</span>
                  ),
                },
                {
                  id: 'venda-lojas',
                  rotulo: 'lojas',
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
                  rotulo: 'modelo (fábrica +10%)',
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
                  expansivel: true,
                  celula: (l: typeof linhas[number]) => (
                    <span className={`font-semibold ${disponivelTabela[linhas.indexOf(l)] < 0 ? 'text-red-700' : 'text-gray-900'}`}>
                      {fmt(disponivelTabela[linhas.indexOf(l)])}
                    </span>
                  ),
                },
                {
                  id: 'disponivel-divida-fixa',
                  rotulo: 'se a carteira do mês fosse abatida',
                  pai: 'disponivel',
                  celula: (l: typeof linhas[number]) => (
                    <span className="text-gray-400">{fmt(l.estoque - l.carteira)}</span>
                  ),
                },
                {
                  id: 'info',
                  rotulo: 'Informativo',
                  expansivel: true,
                  celula: () => <span className="text-gray-300">·</span>,
                },
                {
                  id: 'producao',
                  rotulo: 'Produção planejada',
                  pai: 'info',
                  celula: (l: typeof linhas[number]) => (
                    <>
                      <span className="text-indigo-700 font-semibold">
                        {fmt(l.producao + (l.mesCorrente ? emProcessoAtual : 0))}
                      </span>
                      {l.mesCorrente && emProcessoAtual > 0 && (
                        <div className="text-[10px] font-normal text-gray-500">
                          {fmt(l.producao)} plano + {fmt(emProcessoAtual)} em processo
                        </div>
                      )}
                      {nivelar && Math.abs(l.producao - l.producaoAtual) >= 1 && (
                        <div className={`text-[10px] font-normal ${l.producao > l.producaoAtual ? 'text-emerald-600' : 'text-red-600'}`}>
                          {l.producao > l.producaoAtual ? '+' : ''}{fmt(l.producao - l.producaoAtual)}
                        </div>
                      )}
                    </>
                  ),
                },
                {
                  id: 'ocupAcum',
                  rotulo: 'Ocupação acumulada',
                  pai: 'info',
                  expansivel: true,
                  celula: (l: typeof linhas[number]) => (
                    <>
                      <span className={`font-bold ${l.ocupacaoAcum > 1 ? 'text-red-700' : l.ocupacaoAcum >= 0.85 ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {pct(l.ocupacaoAcum)}
                      </span>
                      <div
                        className="text-[10px] font-normal text-gray-400"
                        title="Gap ACUMULADO desde o primeiro mes do horizonte, nao do mes. Negativo = capacidade sobrando no conjunto."
                      >
                        {l.gapAcum > 0 ? '+' : ''}{l.gapAcum.toFixed(1).replace('.', ',')}d acum.
                      </div>
                    </>
                  ),
                },
                {
                  id: 'ocupMes',
                  rotulo: 'no mês isolado',
                  pai: 'ocupAcum',
                  celula: (l: typeof linhas[number]) => {
                    if (l.diasDisponiveis <= 0) return <span className="text-gray-500">—</span>;
                    // Sobra DO MES, nao acumulada: e o numero que cabe dentro do mes, e por
                    // isso o unico comparavel com os dias disponiveis dele.
                    const sobra = l.diasDisponiveis * (1 - l.ocupacao);
                    return (
                      <>
                        <span className={l.ocupacao > 1 ? 'text-red-700' : l.ocupacao > limiteOcupacao ? 'text-amber-700' : 'text-gray-500'}>
                          {pct(l.ocupacao)}
                        </span>
                        <div className="text-[10px] text-gray-400">
                          {sobra >= 0 ? 'sobra ' : 'falta '}
                          {Math.abs(sobra).toFixed(1).replace('.', ',')}d de {l.diasDisponiveis}
                        </div>
                      </>
                    );
                  },
                },
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
                return (
                  <tr key={linha.id} className={`border-t border-gray-100 ${idx % 2 === 1 ? 'bg-gray-50' : ''}`}>
                    <td
                      className={`sticky left-0 z-10 px-4 py-3 text-left whitespace-nowrap ${
                        idx % 2 === 1 ? 'bg-gray-50' : 'bg-white'
                      } ${'forte' in linha ? 'font-semibold text-gray-800' : 'text-gray-600'} ${
                        ehFilho ? `py-2 text-xs font-normal text-gray-500 ${nivel === 1 ? 'pl-9' : 'pl-16'}` : ''
                      }`}
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

      <div className="px-5 py-3 border-t text-xs text-gray-500">
        🔒 real = plano já lançado no sistema (períodos MA/PX/UL/QT). Entra como piso fixo: o
        nivelamento não sobe nem corta esses meses, só redistribui o que vem depois deles.
        A produção desses meses é o plano <strong>restante</strong> — o que já virou OP está em processo
        e portanto já contado no estoque.
        {' '}
        As duas ocupações saem de <strong>dias</strong>, a mesma conta do painel de Capacidade. Por isso
        o mês corrente pode produzir pouco e ocupar muito: a fábrica ainda tem de costurar o que
        está em processo, que já entrou no estoque mas não saiu da fila.
        {' '}
        <strong>Ocup. acumulada</strong> é a que manda — o que não cabe num mês transborda para o
        seguinte, e a ocupação do mês isolado ignora o atraso que vem de trás.
        Verde 85-100% (fábrica cheia), âmbar abaixo (ociosa), vermelho acima de 100% (estourado).
        A capacidade em peças varia por mês porque depende do mix: cada referência custa um tempo
        de costura diferente, então o mesmo minuto rende mais ou menos peça.
        {' '}
        <strong>Carteira pendente:</strong> sai <em>uma vez</em>, contra a posição de abertura — é uma dívida de hoje, não um valor que se repete todo mês. Por isso o disponível anda exatamente pela sobra, e a tabela fecha de cima para baixo. O tamanho dela ({fmt(pedidosPendentes)} peças hoje, {diasMedidos} dias de venda) sai da barra em Ajustes, hoje em {diasEfetivos} dias. Dentro de Informativo a linha mostra quanto de livro de pedidos estaríamos carregando em cada mês, como referência: ela não é abatida de novo.
        {' '}
A projeção abre de duas formas sobre o <em>mesmo</em> total: por <strong>canal</strong>
        (fábrica e lojas) e por <strong>continuidade</strong> (permanente e edição limitada) — não
        some uma com a outra. Na edição limitada o canal é medido no histórico; nos permanentes a
        projeção gravada vem sem canal, então ele é <strong>rateado</strong> pela participação do mesmo
        mês do ano base, já com o +10% aplicado na fábrica.
        {' '}
                <strong>Edição limitada</strong> entra porque a capacidade sempre a contou — os períodos do plano
        vêm da fábrica inteira, sem filtro de continuidade. A projeção dela vem do histórico de coleções
        (<code>hist_dproduto</code>), contando em cada mês os SKUs que estavam em linha <em>naquele</em> mês,
        com a mesma política dos permanentes: fábrica +10%, lojas sem acréscimo. Nos meses projetados
        a produção dela acompanha a própria venda — coleção é feita para vender na estação, não para
        estocar —, então ela ocupa a fábrica sem sobrar no estoque.
      </div>
    </div>
  );
}
