'use client';

import { useMemo, useState } from 'react';

// Ocupacao da fabrica aberta por GRUPO DE PRODUTO.
//
// A Capacidade x Venda, logo acima, diz se o plano cabe NO CONJUNTO. Nao diz onde aperta —
// e o conjunto esconde o que importa: medido em 30/10/2026, a fabrica inteira estava em 90%
// em janeiro enquanto SUTIA sozinho estava em 131% e CALCA em 73%. Era essa leitura que o
// PCP mantinha numa planilha a parte, refeita a cada ciclo.
//
// O eixo e o `produto.grupo` da matriz (CALCA, SUTIA, CAMISOLA...), a pedido do PCP. O mix
// de producao do ERP (classificacao 29) chegou a ser usado aqui e foi revertido — ele
// alinhava melhor com as celulas de capacidade, mas custava 14s de consulta por carga.
//
// A carga sai exata (`plano x tempo` por grupo). A capacidade e aproximada: ela e
// medida por CELULA de producao, e uma celula faz referencias de mais de um grupo, entao
// cada celula divide a sua capacidade entre os grupos na proporcao em que eles a carregam.
// Onde dois grupos dividem uma celula, os dois recebem a mesma ocupacao daquele pedaco.
// Isso esta dito na dica da tela de proposito: e aproximacao, e quem le precisa saber.

export type MesGrupo = {
  periodo: string;
  mes: number;
  pecas: number;
  pecasAcum: number;
  cargaMin: number;
  cargaAcumMin: number;
  cargaSemCelulaMin: number;
  capacidadeMin: number;
  diasNecessarios: number;
  diasDisponiveis: number;
  ocupacao: number | null;
  gapDias: number;
};

export type RefSemCelula = { referencia: string; produto: string; pecas: number; minutos: number };

/** Grupo de costura (celula de producao) que fabrica a familia. */
export type CelulaDaFamilia = {
  celula: string;
  capacidadeDiaria: number;
  cargaFamiliaMin: number;
  cargaCelulaMin: number;
  /** Quanto desta celula a familia aberta consome. */
  fatiaDaFamilia: number;
  /** Ocupacao da CELULA no horizonte, com TODAS as famílias dentro. */
  ocupacaoCelula: number | null;
  semCapacidade: boolean;
};

export type GrupoOcupacao = {
  grupo: string;
  capacidadeDiaria: number;
  fatiaCapacidade: number;
  pecasHorizonte: number;
  /** Família nomeada pelo PCP: aparece sempre, mesmo abaixo do corte de tamanho. */
  nomeada?: boolean;
  /** Fatia da carga do HORIZONTE sem célula de capacidade cadastrada. */
  fatiaSemCelula: number;
  /** As referências que faltam cadastrar, as maiores primeiro. É a lista de correção. */
  refsSemCelula: RefSemCelula[];
  /** Os grupos de costura que fabricam a família, os de maior carga primeiro. */
  celulas: CelulaDaFamilia[];
  /** Capacidade órfã realocada para esta família, só na tela. Ver FAMILIA_DA_CAPACIDADE_ORFA. */
  recebeuOrfa?: number;
  meses: MesGrupo[];
};

type Props = {
  dados: GrupoOcupacao[];
  capacidadeDiariaTotal: number;
  /** false = a medicao do ERP nao carregou e a capacidade caiu no cadastro, que esta
   *  corrompido. A quebra inteira fica sem sentido, entao a tela avisa em vez de exibir. */
  temMedida: boolean;
  /** Quando a leitura inclui uma simulacao salva, para o titulo dizer isso. */
  comSimulacao?: boolean;
  /** 'dias' = ocupacao acumulada, o padrao. 'meses' = a leitura da diretoria. */
  unidade: 'dias' | 'meses';
  onUnidade: (u: 'dias' | 'meses') => void;
  carregando?: boolean;
};

const MES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// Abaixo disto o grupo vai para "outros": dezesseis linhas abertas de uma vez repetiriam o
// problema dos nove cards. CALCA e SUTIA sozinhos sao 83% do plano.
const FATIA_MINIMA = 0.03;

function fmt(v: number) {
  return Math.round(v || 0).toLocaleString('pt-BR');
}

function pct(v: number | null) {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}

function corOcupacao(v: number | null) {
  if (v === null) return 'text-gray-300';
  if (v > 1) return 'text-red-600';
  if (v >= 0.85) return 'text-emerald-600';
  return 'text-amber-600';
}

// Acima disto a ocupacao do grupo NAO e confiavel: a maior parte da carga esta em referencia
// sem celula de capacidade cadastrada, entao ela tem minutos de trabalho e quase nenhuma
// capacidade atribuida — e a divisao estoura.
//
// Nao sao gargalos, sao buracos de cadastro: carga sem celula tem minutos e nenhuma
// capacidade atribuida, e a divisao estoura. Pintar isso de vermelho junto com um gargalo
// de verdade faria a tela gritar nos lugares errados.
const LIMITE_SEM_CELULA = 0.3;

// Avaliado no HORIZONTE INTEIRO, nao mes a mes. Por periodo a fatia oscila com a
// acumulacao — SUTIA cruzava os 30% em dez e jan e voltava abaixo em fev, e a linha piscava
// entre cinza e colorido sem que nada tivesse mudado no cadastro. Confiabilidade e
// propriedade do CADASTRO do grupo.
function confiavel(g: GrupoOcupacao) {
  return Number(g.fatiaSemCelula || 0) <= LIMITE_SEM_CELULA;
}

// CAPACIDADE ORFA — a celula que tem medicao e nenhuma referencia cadastrada.
//
// `08 - ESPERANCA CA BASICO` produz de verdade (23.856 pecas em 60 dias, 100% CALCA) e nao
// tem uma unica referencia vinculada em `app_capacidade_grupo_refs`. Sem referencia ela nao
// carrega nada, entao nao entra em familia nenhuma: os 2.252 min/dia dela aparecem no total
// da fabrica (53.300) e somem na soma das familias (51.049).
//
// O PCP pediu para ve-la dentro de SUTIA — e simulacao de onde a capacidade faria falta,
// nao afirmacao sobre a fabrica. Por isso e SO VISUAL: nenhum dado e gravado, e a realocacao
// vive aqui, na renderizacao.
//
// ATENCAO ao ler: a Esperanca costura CALCA hoje. Mostra-la em SUTIA responde "e se ela
// passasse para la", nao "ela esta la". A tela diz isso na dica da linha.
const FAMILIA_DA_CAPACIDADE_ORFA = 'SUTIA';

export default function OcupacaoPorGrupo({ dados: dadosBrutos, capacidadeDiariaTotal, temMedida, comSimulacao, unidade, onUnidade, carregando }: Props) {
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [verOutros, setVerOutros] = useState(false);

  // A orfa e o que sobra: total da fabrica menos a soma das familias. Nao precisa a rota
  // dizer quem e — se a diferenca existe, e capacidade sem dono.
  const capacidadeOrfa = useMemo(() => {
    const somaFamilias = dadosBrutos.reduce((a, g) => a + Number(g.capacidadeDiaria || 0), 0);
    return Math.max(0, capacidadeDiariaTotal - somaFamilias);
  }, [dadosBrutos, capacidadeDiariaTotal]);

  const dados = useMemo(() => {
    if (!(capacidadeOrfa > 0)) return dadosBrutos;
    return dadosBrutos.map((g) => {
      if (g.grupo !== FAMILIA_DA_CAPACIDADE_ORFA) return g;
      const capNova = Number(g.capacidadeDiaria || 0) + capacidadeOrfa;
      return {
        ...g,
        capacidadeDiaria: capNova,
        fatiaCapacidade: capacidadeDiariaTotal > 0 ? capNova / capacidadeDiariaTotal : g.fatiaCapacidade,
        recebeuOrfa: capacidadeOrfa,
        // Ocupacao e gap recalculados com a capacidade nova — senao a linha mostraria mais
        // min/dia e o mesmo percentual, que e o pior dos dois mundos.
        celulas: [
          ...g.celulas,
          {
            celula: '08 - ESPERANCA CA BASICO  (realocada, só nesta tela)',
            capacidadeDiaria: capacidadeOrfa,
            cargaFamiliaMin: 0,
            cargaCelulaMin: 0,
            fatiaDaFamilia: 0,
            ocupacaoCelula: 0,
            semCapacidade: false,
          },
        ],
        meses: g.meses.map((m) => {
          const capMin = capNova * Number(m.diasDisponiveis || 0);
          const nec = capNova > 0 ? Number(m.cargaAcumMin || 0) / capNova : 0;
          return {
            ...m,
            capacidadeMin: capMin,
            diasNecessarios: nec,
            ocupacao: capMin > 0 ? Number(m.cargaAcumMin || 0) / capMin : null,
            gapDias: nec - Number(m.diasDisponiveis || 0),
          };
        }),
      };
    });
  }, [dadosBrutos, capacidadeOrfa, capacidadeDiariaTotal]);

  const periodos = dados[0]?.meses || [];

  // Linha de TOTAL. Ela existe para a tela nao virar uma segunda verdade sobre capacidade —
  // que e exatamente o problema que a planilha paralela cria. Tem que bater com a ocupacao
  // da Capacidade x Venda acima, mes a mes.
  const total = useMemo(() => periodos.map((_, i) => {
    const carga = dados.reduce((a, g) => a + Number(g.meses[i]?.cargaAcumMin || 0), 0);
    const semCelula = dados.reduce((a, g) => a + Number(g.meses[i]?.cargaSemCelulaMin || 0), 0);
    const dias = Number(dados[0]?.meses[i]?.diasDisponiveis || 0);
    // Capacidade ACUMULADA das famílias (com sazonalidade, a mesma do gráfico), não min/dia
    // fixo × dias: senão o total daqui contaria outra capacidade que a das linhas acima.
    const capFamilias = dados.reduce((a, g) => a + Number(g.meses[i]?.capacidadeMin || 0), 0);
    const cap = capFamilias > 0 ? capFamilias : capacidadeDiariaTotal * dias;
    const capDia = dias > 0 ? cap / dias : 0;
    const nec = capDia > 0 ? carga / capDia : 0;
    return { carga, semCelula, cap, ocupacao: cap > 0 ? carga / cap : null, gapDias: nec - dias };
  }), [dados, periodos, capacidadeDiariaTotal]);

  // FATOR DE ALINHAMENTO com a Capacidade x Venda.
  //
  // Um por periodo: a ocupacao de la dividida pela daqui. Multiplicando TODAS as celulas do
  // periodo por ele, a proporcao entre as familias — que e o que esta tabela existe para
  // mostrar — fica intacta, e o total passa a ser o mesmo numero da tabela de cima.
  //
  // Sem alvo, fica 1 e nada muda.
  // Desde 18/11/2026 não há mais fator: a tabela usa a MESMA capacidade do gráfico e a carga
  // pela lista referência → grupo, então o total fecha sozinho. O fator fica em 1 só para
  // não reescrever as contas que o usam.
  const fator = useMemo(() => periodos.map(() => 1), [periodos]);
  const ajustar = (v: number | null | undefined, i: number) =>
    v === null || v === undefined ? null : v * (fator[i] ?? 1);
  // O gap em dias segue a mesma escala: ele e (necessarios - disponiveis), e os necessarios
  // sao a ocupacao vezes os dias.
  const ajustarGap = (gap: number, i: number, dias: number) => (gap + dias) * (fator[i] ?? 1) - dias;

  // LEITURA EM MESES — o jeito que o PCP e a diretoria leem.
  //
  // O percentual da tela e ACUMULADO: carga somada contra dias somados. Quem decide nao
  // pensa assim. Olhando "+25 dias" em abril, o diretor le "isso e mais de um mes de
  // trabalho sobrando" — e no raciocinio dele a fabrica ja usa 100% do mes e ainda deve
  // mais um mes inteiro, o que daria 216%, nao 116%.
  //
  // Os dois estao certos sobre coisas diferentes, e nenhum pode substituir o outro: medido
  // em 12/11/2026, a conta em meses funciona nos primeiros periodos (fev/27 vira 275%) e
  // despenca nos ultimos, onde o gap acumulado de catorze meses dividido por UM mes da
  // -579% no SUTIA e -801% na CALCA. Por isso e um BOTAO, nao uma troca: cada leitura vale
  // na sua ponta, e quem olha escolhe.
  const diasDoMes = (i: number) => {
    const ate = Number(dados[0]?.meses[i]?.diasDisponiveis || 0);
    const antes = i > 0 ? Number(dados[0]?.meses[i - 1]?.diasDisponiveis || 0) : 0;
    return Math.max(1, ate - antes);
  };
  // 100% = o mes cheio. Cada mes de trabalho a mais soma 100.
  const ocupacaoEmMeses = (gap: number, i: number, dias: number) =>
    1 + ajustarGap(gap, i, dias) / diasDoMes(i);
  // O GAP CONTINUA EM DIAS nos dois modos. O PCP conferiu e os dias estao certos; so o
  // percentual e que nao fala a lingua de quem decide. Trocar a unidade da linha de baixo
  // junto tiraria da tela o numero que quem programa usa.
  const escreveGap = (gap: number, i: number, dias: number) => {
    const g = ajustarGap(gap, i, dias);
    return `${g > 0 ? '+' : ''}${g.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}d`;
  };

  // PERIODO SEM PLANO LANCADO.
  //
  // A ocupacao e ACUMULADA: carga somada desde o inicio contra dias somados. Num periodo
  // que ninguem planejou, a carga nao cresce e os dias crescem — entao o percentual CAI
  // sozinho, e a tela sugere alivio onde na verdade nao ha plano nenhum.
  //
  // Medido em 03/11/2026: OT (jun/27) fechava em 74% com 6.485.502 min de carga; NV
  // (jul/27) mostrava 65% com EXATAMENTE a mesma carga, so porque os dias passaram de 159
  // para 181. O grafico de cima nao caia nessa porque ele nao desenha ocupacao onde nao ha
  // plano; aqui a coluna existia e mentia.
  const semPlano = useMemo(
    () => periodos.map((_, i) => dados.reduce((a, g) => a + Number(g.meses[i]?.pecas || 0), 0) === 0),
    [dados, periodos],
  );


  // Familia NOMEADA pelo PCP nunca cai no "outros". ANATOMIC e 1,1% do plano e seria
  // recolhida pelo corte de 3% — que e justamente o oposto do que foi pedido.
  const visivel = (g: GrupoOcupacao) => g.nomeada || g.fatiaCapacidade >= FATIA_MINIMA;
  const principais = dados.filter(visivel);
  const outros = dados.filter((g) => !visivel(g));

  if (!dadosBrutos.length) return null;

  const linhaGrupo = (g: GrupoOcupacao) => {
    const aberto = abertos[g.grupo] === true;
    const ok = confiavel(g);
    return (
      <>
        <tr key={g.grupo} className="border-t border-gray-100 hover:bg-gray-50/60">
          <td className="sticky left-0 z-10 bg-white px-4 py-2.5 text-left whitespace-nowrap">
            <button
              type="button"
              onClick={() => setAbertos((a) => ({ ...a, [g.grupo]: !aberto }))}
              className="inline-flex items-center gap-1.5 font-semibold text-gray-800 hover:text-gray-900"
              title={`${fmt(g.capacidadeDiaria)} min/dia · ${pct(g.fatiaCapacidade)} da fábrica · ${fmt(g.pecasHorizonte)} peças no horizonte`}
            >
              <span className="inline-block w-2 text-[10px] text-gray-400">{aberto ? '▾' : '▸'}</span>
              {g.grupo}
            </button>
            <div className="pl-5 text-[10px] font-normal text-gray-400">
              {pct(g.fatiaCapacidade)} da fábrica · {fmt(g.capacidadeDiaria)} min/dia
            </div>
            {/* A realocacao tem que ser DITA, nao deduzida. A Esperanca costura calca hoje;
                mostra-la aqui responde "e se ela passasse para ca", nao "ela esta ca". */}
            {Number(g.recebeuOrfa || 0) > 0 && (
              <div
                className="pl-5 text-[10px] font-semibold text-amber-700"
                title="A célula 08 - ESPERANÇA tem capacidade medida no ERP e NENHUMA referência cadastrada, então não pertence a família nenhuma — os minutos dela apareciam no total da fábrica e sumiam na soma das famílias. Aqui ela está somada a esta família A PEDIDO DO PCP, só na tela: nenhum dado foi alterado. Atenção: ela costura CALÇA hoje (23.856 peças em 60 dias, 100%). Isto responde 'e se ela passasse para cá', não 'ela está aqui'."
              >
                inclui {fmt(g.recebeuOrfa || 0)} min/dia da Esperança — simulação visual, ela costura calça hoje
              </div>
            )}
          </td>
          {g.meses.map((m, i) => {
            const vazio = semPlano[i];
            return (
              <td
                key={m.periodo}
                className="px-3 py-2.5 text-center font-mono whitespace-nowrap"
                title={vazio
                  ? 'Nenhum plano lançado neste período. A ocupação cai sozinha porque a carga não cresce e os dias acumulam — não é folga, é mês sem plano.'
                  : ok ? undefined : `${pct(g.fatiaSemCelula)} da carga deste grupo não tem célula de capacidade cadastrada — há minutos de trabalho sem capacidade atribuída, então esta ocupação está inflada. Abra o grupo para ver quais referências cadastrar.`}
              >
                <div className={`text-sm font-bold ${vazio ? 'text-gray-300' : !ok ? 'text-gray-400' : corOcupacao(unidade === 'dias' ? ajustar(m.ocupacao, i) : ocupacaoEmMeses(m.gapDias, i, m.diasDisponiveis))}`}>
                  {vazio ? '—' : pct(unidade === 'dias' ? ajustar(m.ocupacao, i) : ocupacaoEmMeses(m.gapDias, i, m.diasDisponiveis))}
                  {!vazio && !ok && <span className="ml-0.5 align-top text-[9px] font-bold text-amber-500">!</span>}
                </div>
                <div className={`text-[10px] font-semibold ${vazio || !ok ? 'text-gray-300' : m.gapDias > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {vazio ? 'sem plano' : escreveGap(m.gapDias, i, m.diasDisponiveis)}
                </div>
              </td>
            );
          })}
        </tr>
        {/* GRUPOS DE COSTURA. Abrir a familia mostrava a conta e nao mostrava a FABRICA —
            e e na celula que se age, nao na familia inteira. A ocupacao de cada celula
            soma TODAS as familias que passam por ela, nao so a aberta: uma celula pode
            estar cheia por causa de outra familia, e esconder isso sugeriria folga onde
            nao ha. */}
        {aberto && g.celulas.length > 0 && (
          <tr key={`${g.grupo}-celulas`} className="border-t border-slate-100 bg-slate-50/70">
            <td className="sticky left-0 z-10 bg-slate-50/70 py-2 pl-10 pr-4 align-top text-left text-[11px] font-semibold text-slate-700 whitespace-nowrap">
              <span className="mr-1 text-slate-300">└</span>
              grupos de costura
              <div className="pl-4 font-normal text-slate-500">{g.celulas.length} células</div>
            </td>
            <td colSpan={g.meses.length} className="px-3 py-2">
              <table className="text-[11px]">
                <thead className="text-[10px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="pr-4 text-left font-semibold">célula</th>
                    <th className="px-2 text-right font-semibold">min/dia</th>
                    <th className="px-2 text-right font-semibold">carga da família</th>
                    <th className="px-2 text-right font-semibold">% da célula</th>
                    <th className="pl-2 text-right font-semibold">ocupação da célula</th>
                  </tr>
                </thead>
                <tbody>
                  {g.celulas.map((c) => (
                    <tr key={c.celula}>
                      <td className="pr-4 font-medium text-slate-700 whitespace-nowrap">{c.celula}</td>
                      <td className="px-2 text-right font-mono tabular-nums text-slate-500">
                        {c.semCapacidade ? '—' : fmt(c.capacidadeDiaria)}
                      </td>
                      <td className="px-2 text-right font-mono tabular-nums text-slate-700">{fmt(c.cargaFamiliaMin)}</td>
                      <td className="px-2 text-right font-mono tabular-nums text-slate-500">{pct(c.fatiaDaFamilia)}</td>
                      <td
                        className={`pl-2 text-right font-mono font-bold tabular-nums ${corOcupacao(c.ocupacaoCelula)}`}
                        title={`${pct(c.fatiaDaFamilia)} da carga desta célula vem de ${g.grupo}. A ocupação considera todas as famílias que passam por ela — ${fmt(c.cargaCelulaMin)} min no total.`}
                      >
                        {c.semCapacidade ? 'sem medição' : pct(c.ocupacaoCelula)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </td>
          </tr>
        )}
        {/* ONDE CORRIGIR. O aviso de carga sem celula sozinho nao resolvia nada: o PCP via
            que o numero nao era confiavel e nao tinha o que fazer com isso. Aqui estao as
            referencias que faltam cadastrar, as de maior carga primeiro — e a fila de
            trabalho, e some da tela conforme o cadastro acontece. */}
        {aberto && g.refsSemCelula.length > 0 && (
          <tr key={`${g.grupo}-corrigir`} className="border-t border-amber-100 bg-amber-50/60">
            <td className="sticky left-0 z-10 bg-amber-50/60 py-2 pl-10 pr-4 text-left text-[11px] font-semibold text-amber-800 whitespace-nowrap">
              <span className="mr-1 text-amber-300">└</span>
              sem célula — cadastrar
              <div className="pl-4 font-normal text-amber-700">{pct(g.fatiaSemCelula)} da carga do grupo</div>
            </td>
            <td colSpan={g.meses.length} className="px-3 py-2">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {g.refsSemCelula.map((r) => (
                  <span key={r.referencia} className="text-[11px] whitespace-nowrap" title={r.produto}>
                    <span className="font-mono font-bold text-amber-900">{r.referencia}</span>
                    <span className="ml-1 font-mono text-amber-700">{fmt(r.minutos)} min</span>
                    <span className="ml-1 text-gray-500">({fmt(r.pecas)} pç)</span>
                  </span>
                ))}
              </div>
              <div className="mt-1 text-[10px] text-amber-700">
                Cadastre estas referências numa célula em Capacidade · Grupos e referências. Enquanto elas não
                tiverem célula, a carga delas existe e a capacidade não — e a ocupação do grupo fica inflada.
              </div>
            </td>
          </tr>
        )}
        {aberto && ([
          { id: 'pecas', rotulo: 'peças do mês', valor: (m: MesGrupo) => fmt(m.pecas), cor: 'text-gray-600' },
          { id: 'carga', rotulo: 'carga acum. (min)', valor: (m: MesGrupo) => fmt(m.cargaAcumMin), cor: 'text-gray-600' },
          { id: 'cap', rotulo: 'capacidade acum. (min)', valor: (m: MesGrupo) => fmt(m.capacidadeMin), cor: 'text-gray-600' },
          {
            id: 'semcel',
            rotulo: 'carga sem célula (min)',
            // Carga que existe e nao tem celula de capacidade cadastrada. Quando e alta, a
            // ocupacao do grupo esta SUPERESTIMADA — ha carga sem capacidade atribuida.
            // Fica a vista em vez de diluida.
            valor: (m: MesGrupo) => (m.cargaSemCelulaMin > 0 ? fmt(m.cargaSemCelulaMin) : '—'),
            cor: 'text-amber-700',
          },
        ]).map((sub) => (
          <tr key={`${g.grupo}-${sub.id}`} className="border-t border-gray-50 bg-gray-50/40">
            <td className="sticky left-0 z-10 bg-gray-50/40 py-1.5 pl-10 pr-4 text-left text-[11px] text-gray-500 whitespace-nowrap">
              <span className="mr-1 text-gray-300">└</span>{sub.rotulo}
            </td>
            {g.meses.map((m) => (
              <td key={m.periodo} className={`px-3 py-1.5 text-center font-mono text-[11px] tabular-nums ${sub.cor}`}>
                {sub.valor(m)}
              </td>
            ))}
          </tr>
        ))}
      </>
    );
  };

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4">
        <div>
          <h2 className="font-semibold text-gray-900">
            Ocupação por grupo de produto{comSimulacao ? ' · com simulação' : ''}
          </h2>
          <p className="text-xs text-gray-500">
            Ocupação acumulada por família, pela <strong>lista referência → grupo</strong> (a mesma da Distribuição sugerida) e com a mesma
            capacidade do gráfico (nível × sazonalidade). Família = o perfil que cada grupo de costura mais faz; a Liebe Move entra na LIDERANÇA (anatomic).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded border border-gray-300 text-xs">
            {([
              { id: 'dias' as const, rotulo: 'Acumulado', dica: 'Ocupação acumulada: carga somada desde o início contra os dias somados. É a leitura que fecha com o gráfico de cima e com a Sugestão de Plano.' },
              { id: 'meses' as const, rotulo: 'Em meses', dica: 'A leitura da diretoria: 100% é o mês cheio, e cada mês de trabalho sobrando soma mais 100. Em abril, +25 dias de gap viram +1,2 mês, então a célula mostra 220% em vez de 116%. CUIDADO nos períodos do fim: o gap é acumulado de até catorze meses e, dividido por um mês só, chega a −579% — ali a leitura acumulada é a que vale.' },
            ]).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onUnidade(opt.id)}
                title={opt.dica}
                className={`px-2.5 py-1 ${
                  unidade === opt.id ? 'bg-indigo-600 font-semibold text-white' : 'bg-white hover:bg-gray-50'
                }`}
              >
                {opt.rotulo}
              </button>
            ))}
          </div>
          {carregando && <span className="text-[11px] text-gray-400">recalculando…</span>}
        </div>
        <span
          className="cursor-help text-[11px] text-gray-400 decoration-dotted underline-offset-4 [text-decoration-line:underline]"
          title="A carga é exata: plano × tempo de costura, somado por grupo de produto do ERP. A CAPACIDADE é aproximada — ela é medida por célula de produção, e uma célula faz referências de mais de um grupo, então cada célula divide a própria capacidade entre os grupos na proporção em que eles a carregam. Onde a coluna 'carga sem célula' é alta, a ocupação está inflada: há trabalho sem capacidade atribuída, e o número vem marcado com ! em cinza."
        >
          como a capacidade é atribuída
        </span>
      </div>

      {!temMedida && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900">
          A medição de capacidade do ERP não carregou. Os números abaixo caem no cadastro manual, que está
          com código de referência no lugar da capacidade — não use esta leitura até o Fagner salvar a configuração.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left">Grupo</th>
              {periodos.map((m) => (
                <th key={m.periodo} className="px-3 py-3 text-center whitespace-nowrap">
                  {MES_ABREV[(m.mes - 1 + 12) % 12]}
                  <div className="font-mono text-[9px] font-normal normal-case text-gray-400">{m.periodo}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {principais.map(linhaGrupo)}

            {outros.length > 0 && (
              <tr className="border-t border-gray-100">
                <td colSpan={periodos.length + 1} className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => setVerOutros((v) => !v)}
                    className="text-xs text-gray-500 hover:text-gray-800"
                  >
                    {verOutros ? '▾' : '▸'} outros {outros.length} grupos — menos de {pct(FATIA_MINIMA)} da fábrica cada
                  </button>
                </td>
              </tr>
            )}
            {verOutros && outros.map(linhaGrupo)}

            <tr className="border-t-2 border-gray-300 bg-gray-50">
              <td className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left font-bold text-gray-900">
                Total da fábrica
                <div className="text-[10px] font-normal text-gray-400">{fmt(capacidadeDiariaTotal)} min/dia</div>
              </td>
              {total.map((t, i) => {
                const vazio = semPlano[i];
                return (
                  <td
                    key={periodos[i]?.periodo || i}
                    className="px-3 py-3 text-center font-mono whitespace-nowrap"
                    title={vazio ? 'Nenhum plano lançado neste período — a queda é só o calendário andando.' : undefined}
                  >
                    <div className={`text-sm font-bold ${vazio ? 'text-gray-300' : corOcupacao(unidade === 'dias' ? ajustar(t.ocupacao, i) : ocupacaoEmMeses(t.gapDias, i, Number(dados[0]?.meses[i]?.diasDisponiveis || 0)))}`}>
                      {vazio ? '—' : pct(unidade === 'dias' ? ajustar(t.ocupacao, i) : ocupacaoEmMeses(t.gapDias, i, Number(dados[0]?.meses[i]?.diasDisponiveis || 0)))}
                    </div>
                    <div className={`text-[10px] font-semibold ${vazio ? 'text-gray-300' : t.gapDias > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {vazio ? 'sem plano' : escreveGap(t.gapDias, i, Number(dados[0]?.meses[i]?.diasDisponiveis || 0))}
                    </div>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
