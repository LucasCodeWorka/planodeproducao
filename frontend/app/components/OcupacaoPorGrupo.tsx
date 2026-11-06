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
  /** Como a carga encontra a celula hoje. */
  alocacao: 'cadastro' | 'mix';
  onAlocacao: (a: 'cadastro' | 'mix') => void;
  carregando?: boolean;
  /** Ocupacao acumulada do PLANO vinda da Capacidade x Venda, periodo a periodo.
   *
   *  As duas telas calculam coisas diferentes: la e PECAS (plano contra capacidade, os dois
   *  totais desenhados ao lado das faixas); aqui e MINUTOS por familia, com o tempo de cada
   *  SKU. Nenhuma das duas esta errada, mas o rodape promete que fecham — e sem um alvo
   *  comum elas nunca fecham: medido em 06/11/2026, 90% la contra 74% aqui.
   *
   *  Entao a quebra por familia mantem a PROPORCAO que ela mede, e o NIVEL vem de la: todas
   *  as celulas do periodo sao escaladas pelo mesmo fator. Quem aperta continua aparecendo
   *  apertado; o total passa a ser o mesmo numero da tabela de cima. */
  ocupacaoAlvo?: (number | null)[];
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

export default function OcupacaoPorGrupo({ dados, capacidadeDiariaTotal, temMedida, comSimulacao, alocacao, onAlocacao, carregando, ocupacaoAlvo }: Props) {
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [verOutros, setVerOutros] = useState(false);

  const periodos = dados[0]?.meses || [];

  // Linha de TOTAL. Ela existe para a tela nao virar uma segunda verdade sobre capacidade —
  // que e exatamente o problema que a planilha paralela cria. Tem que bater com a ocupacao
  // da Capacidade x Venda acima, mes a mes.
  const total = useMemo(() => periodos.map((_, i) => {
    const carga = dados.reduce((a, g) => a + Number(g.meses[i]?.cargaAcumMin || 0), 0);
    const semCelula = dados.reduce((a, g) => a + Number(g.meses[i]?.cargaSemCelulaMin || 0), 0);
    const dias = Number(dados[0]?.meses[i]?.diasDisponiveis || 0);
    const cap = capacidadeDiariaTotal * dias;
    const nec = capacidadeDiariaTotal > 0 ? carga / capacidadeDiariaTotal : 0;
    return { carga, semCelula, cap, ocupacao: cap > 0 ? carga / cap : null, gapDias: nec - dias };
  }), [dados, periodos, capacidadeDiariaTotal]);

  // FATOR DE ALINHAMENTO com a Capacidade x Venda.
  //
  // Um por periodo: a ocupacao de la dividida pela daqui. Multiplicando TODAS as celulas do
  // periodo por ele, a proporcao entre as familias — que e o que esta tabela existe para
  // mostrar — fica intacta, e o total passa a ser o mesmo numero da tabela de cima.
  //
  // Sem alvo, fica 1 e nada muda.
  const fator = useMemo(() => periodos.map((_, i) => {
    const alvo = ocupacaoAlvo?.[i];
    const aqui = total[i]?.ocupacao;
    if (alvo === null || alvo === undefined || !aqui || aqui <= 0) return 1;
    return alvo / aqui;
  }), [ocupacaoAlvo, total, periodos]);
  const ajustar = (v: number | null | undefined, i: number) =>
    v === null || v === undefined ? null : v * (fator[i] ?? 1);
  // O gap em dias segue a mesma escala: ele e (necessarios - disponiveis), e os necessarios
  // sao a ocupacao vezes os dias.
  const ajustarGap = (gap: number, i: number, dias: number) => (gap + dias) * (fator[i] ?? 1) - dias;

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

  if (!dados.length) return null;

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
                <div className={`text-sm font-bold ${vazio ? 'text-gray-300' : !ok ? 'text-gray-400' : corOcupacao(ajustar(m.ocupacao, i))}`}>
                  {vazio ? '—' : pct(ajustar(m.ocupacao, i))}
                  {!vazio && !ok && <span className="ml-0.5 align-top text-[9px] font-bold text-amber-500">!</span>}
                </div>
                <div className={`text-[10px] font-semibold ${vazio || !ok ? 'text-gray-300' : m.gapDias > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {vazio ? 'sem plano' : (() => {
                    const g = ajustarGap(m.gapDias, i, m.diasDisponiveis);
                    return `${g > 0 ? '+' : ''}${g.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}d`;
                  })()}
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
            A mesma ocupação acumulada da tabela acima, aberta por grupo. O total no rodapé tem que bater com ela.
            {alocacao === 'mix' ? ' Alocando pelo mix de produção do ERP.' : ' Alocando pelo cadastro de referências.'}
          </p>
        </div>
        {/* AS DUAS LEITURAS, lado a lado. Nenhuma e obviamente certa: o cadastro carrega
            erros e defasagem, o mix depende de quais referencias ja foram cadastradas para
            revelar o que cada celula faz. Medido em 03/11/2026 elas discordam em 886.188
            minutos — 19,3% da carga. Escolher uma no escuro seria pior que comparar. */}
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded border border-gray-300 text-xs">
            {([
              { id: 'cadastro' as const, rotulo: 'Por cadastro', dica: 'Pelo cadastro manual de referência → célula, com herança por tipo de produto para quem não está cadastrado. É a leitura que a Sugestão de Plano usa.' },
              { id: 'mix' as const, rotulo: 'Por mix', dica: 'Pela classificação 29 do ERP: o produto tem um mix de produção, e a carga vai para as células que comprovadamente produzem aquele mix. Reproduz o relatório de Locais × Mix do TOTVS a partir dos próprios dados.' },
            ]).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onAlocacao(opt.id)}
                disabled={carregando}
                title={opt.dica}
                className={`px-2.5 py-1 disabled:opacity-50 ${
                  alocacao === opt.id ? 'bg-indigo-600 font-semibold text-white' : 'bg-white hover:bg-gray-50'
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
                    <div className={`text-sm font-bold ${vazio ? 'text-gray-300' : corOcupacao(ajustar(t.ocupacao, i))}`}>
                      {vazio ? '—' : pct(ajustar(t.ocupacao, i))}
                    </div>
                    <div className={`text-[10px] font-semibold ${vazio ? 'text-gray-300' : t.gapDias > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {vazio ? 'sem plano' : (() => {
                        const dias = Number(dados[0]?.meses[i]?.diasDisponiveis || 0);
                        const g = ajustarGap(t.gapDias, i, dias);
                        return `${g > 0 ? '+' : ''}${g.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}d`;
                      })()}
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
