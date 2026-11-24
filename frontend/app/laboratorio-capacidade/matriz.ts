// MATRIZ DA PRODUÇÃO DO PLANO — a conta da tela, sem React.
//
// Extraída de ProducaoDistribuida.tsx (19/11/2026) sem mudar nenhuma regra: a tela só
// desenha o que sai daqui. Nada é recalculado em relação ao backend — são as mesmas
// minutos da Distribuição sugerida convertidos em peças pelo tempo de cada referência.
// Teste: scratchpad/matriz_teste (totais idênticos aos da tela antes do redesenho).
//
// Cada linha (família, grupo, referência, fábrica) tem, por mês, sobre as referências que
// são do grupo (1ª opção):
//   veio     = o que chegou atrasado do mês anterior (demanda reprimida)
//   plano    = o plano do mês
//   empurra  = o que vai para o mês seguinte
//   produzido = veio + plano − empurra (feito pelo próprio grupo ou por um alternativo)
//   adianta  = saldo produzido ADIANTADO no fim do mês (opção "puxar da frente", 23/11/2026):
//              peça de mês seguinte feita agora com capacidade que sobrou. Com ele,
//              produzido = veio + plano − empurra + adianta(mês) − adianta(mês anterior).

export const PERIODOS = ['MA', 'PX', 'UL', 'QT', 'QU', 'SX', 'ST', 'OT', 'NV', 'DZ', 'ON', 'DO', 'DT', 'QZ'];
export const MESES_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const FAMILIAS = ['Sutiã', 'Calcinha', 'Anatomic', 'Noite', 'Outros'];
export const ROTULO_MOVE = 'LIEBE MOVE (sem SKU · mix anatomic)';

export type Destino = { grupo: string; minutos: number };
export type Tentativa = {
  grupo: string;
  origem: string;
  solicitadoPecas: number;
  disponivelMin: number;
  alocadoMin: number;
  alocadoPecas: number;
  restantePecas: number;
  lotou: boolean;
};
export type PeriodoRef = {
  periodo: string;
  pecas: number;
  pedidoMin: number;
  herdadoMin?: number;
  alocadoMin: number;
  pendenteMin: number;
  herdadoPecas?: number;
  pendentePecas: number;
  /** Puxar da frente: minutos feitos neste mês para os seguintes, e o saldo adiantado no fim do mês. */
  antecipadoMin?: number;
  adiantadoMin?: number;
  usouAdiantadoMin?: number;
  destinos: Destino[];
  tentativas?: Tentativa[];
};
export type OpcaoRef = { ordem: string; grupo: string; origem: string; pecasHistorico?: number | null; pecasMix?: number | null };
export type RefDist = {
  referencia: string;
  tempoMin: number;
  mix: string;
  periodos: PeriodoRef[];
  pecas?: number;
  tempoFonte?: string;
  tempoRoteiroMin?: number;
  candidatas?: number;
  opcoes?: OpcaoRef[];
};
export type RefPreferencial = { referencia: string; pedidoMin: number; herdadoMin: number; remanejadoMin: number; pendenteMin: number; adiantadoMin?: number };
export type MesGrupo = {
  periodo: string;
  capacidadeMin: number;
  alocadoMin: number;
  extraMin?: number;
  /** Carga extra DIRECIONADA ao grupo (Liebe Move na LIDERANÇA), em minutos. */
  extraDirecionado?: { doMesMin: number; herdadoMin: number; coubeMin: number; pendenteMin: number } | null;
  /** As referências que têm este grupo como 1ª opção, com o que foi pedido, herdado,
   *  mandado a alternativos e deixado pendente no mês. */
  referenciasPreferenciais?: RefPreferencial[];
};
export type GrupoDist = { grupo: string; capacidadeDiaria: number; meses: MesGrupo[]; periodosCheios?: number };

export type DistribuicaoDados = {
  loteId: string | null;
  comFerias: boolean;
  capacidadeDiariaTotal: number;
  referencias: RefDist[];
  grupos: GrupoDist[];
  resumo: { atrasadoMin: number; naoCoubeMin: number; cargaExtraMin: number; periodosEstourados: number };
};

// `vira`: família para a qual o grupo foi convertido na simulação (a ESPERANÇA vira Sutiã).
export type FamiliaPorGrupo = Record<string, { familia: string; perfil: string | null; vira?: string | null }>;

export type Quadra = { veio: number[]; plano: number[]; empurra: number[]; adianta: number[] };
export const zeros = (n: number) => Array(n).fill(0) as number[];
export const quadraVazia = (n: number): Quadra => ({ veio: zeros(n), plano: zeros(n), empurra: zeros(n), adianta: zeros(n) });

// Produção de um mês com a reprimida em primeiro lugar, sobre os totais da linha.
export function producao(t: Quadra, i: number) {
  // O adiantado entra como produção do mês em que foi feito e sai do mês a que pertencia.
  const adiantou = (t.adianta?.[i] || 0) - (i > 0 ? t.adianta?.[i - 1] || 0 : 0);
  const feito = Math.max(0, t.veio[i] + t.plano[i] - t.empurra[i] + adiantou);
  const reprimida = Math.min(t.veio[i], feito);
  const plano = Math.max(0, feito - reprimida);
  return { feito, reprimida, plano, pctPlano: t.plano[i] > 0.5 ? plano / t.plano[i] : null };
}

// ATENDIMENTO do mês = produzido ÷ (veio + plano): quanto da fila do mês saiu. Indicador do
// modo compacto (19/11/2026) — só uma razão dos três números da linha, nenhum dado novo.
export function atendimento(t: Quadra, i: number): number | null {
  const fila = t.veio[i] + t.plano[i];
  return fila > 0.5 ? producao(t, i).feito / fila : null;
}

const somar = (q: Quadra, i: number, veio: number, plano: number, empurra: number, adianta = 0) => {
  q.veio[i] += veio;
  q.plano[i] += plano;
  q.empurra[i] += empurra;
  q.adianta[i] += adianta;
};

export type RefLinha = Quadra & { referencia: string };
export type Linha = Quadra & {
  chave: string;
  grupo: string;
  familia: string;
  costurado: number[];
  ocupacao: (number | null)[];
  refs: RefLinha[];
  papel: 'normal' | 'convertido' | 'largou';
  refsCosturadas: { referencia: string; pecas: number[] }[];
};
export type Bloco = Quadra & { familia: string; grupos: Linha[] };

// Calendário: o período MA é o mês corrente; os seguintes andam um mês cada (mesma regra do backend).
export function calendario(hoje = new Date()) {
  const anoAlvo = hoje.getFullYear() + 1;
  const datas = PERIODOS.map((_, i) => new Date(hoje.getFullYear(), hoje.getMonth() + i, 1));
  const meses = datas.map((d) => `${MESES_PT[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`);
  const chaves = datas.map((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  // Só jan–dez do ano que vem (pedido do PCP). Nov–dez do ano corrente continuam na conta
  // — o atraso deles entra em janeiro —, só não viram coluna.
  const cols = chaves.map((c, i) => (c.startsWith(String(anoAlvo)) ? i : -1)).filter((i) => i >= 0);
  return { anoAlvo, meses, chaves, cols };
}

export function montarMatriz(dados: DistribuicaoDados, familias: FamiliaPorGrupo, minPecaMove: number, cols: number[]) {
  const n = PERIODOS.length;
  const tempoRef = new Map(dados.referencias.map((r) => [r.referencia, Number(r.tempoMin || 0)]));
  const pc = (min: number, ref: string) => {
    const t = tempoRef.get(ref) || 0;
    return t > 0 ? Number(min || 0) / t : 0;
  };

  // Fábrica, pelas referências: plano por SKU, o que coube e o que ficou pendente.
  const planoSku = zeros(n);
  const alocado = zeros(n);
  const pendente = zeros(n);
  const fabrica = quadraVazia(n);
  const costurado = new Map<string, number[]>(); // peças que de fato passaram por cada grupo
  const costuradoPorRef = new Map<string, Map<string, number[]>>(); // grupo → ref → peças
  for (const r of dados.referencias) {
    const t = Number(r.tempoMin || 0);
    for (const p of r.periodos || []) {
      const i = PERIODOS.indexOf(p.periodo);
      if (i < 0) continue;
      planoSku[i] += Number(p.pecas || 0);
      pendente[i] += Number(p.pendentePecas || 0);
      if (t > 0) somar(fabrica, i, Number(p.herdadoMin || 0) / t, Number(p.pedidoMin || 0) / t, Number(p.pendenteMin || 0) / t, Number(p.adiantadoMin || 0) / t);
      for (const d of p.destinos || []) {
        const v = t > 0 ? Number(d.minutos || 0) / t : 0;
        alocado[i] += v;
        if (!costurado.has(d.grupo)) costurado.set(d.grupo, zeros(n));
        costurado.get(d.grupo)![i] += v;
        if (!costuradoPorRef.has(d.grupo)) costuradoPorRef.set(d.grupo, new Map());
        const porRefG = costuradoPorRef.get(d.grupo)!;
        if (!porRefG.has(r.referencia)) porRefG.set(r.referencia, zeros(n));
        porRefG.get(r.referencia)![i] += v;
      }
    }
  }

  // Grupo, pelas referências que são DELE.
  const linhas: Linha[] = dados.grupos.flatMap((g) => {
    const t = quadraVazia(n);
    const porRef = new Map<string, Quadra>();
    const ocupacao: (number | null)[] = Array(n).fill(null);
    for (const m of g.meses || []) {
      const i = PERIODOS.indexOf(m.periodo);
      if (i < 0) continue;
      ocupacao[i] = m.capacidadeMin > 0 ? (Number(m.alocadoMin || 0) + Number(m.extraMin || 0)) / m.capacidadeMin : null;
      for (const r of m.referenciasPreferenciais || []) {
        const veio = pc(r.herdadoMin, r.referencia);
        const plano = pc(r.pedidoMin, r.referencia);
        const emp = pc(r.pendenteMin, r.referencia);
        const adi = pc(r.adiantadoMin || 0, r.referencia);
        somar(t, i, veio, plano, emp, adi);
        if (!porRef.has(r.referencia)) porRef.set(r.referencia, quadraVazia(n));
        somar(porRef.get(r.referencia)!, i, veio, plano, emp, adi);
      }
      // LIEBE MOVE: não tem SKU, mas tem dono (o grupo do anatomic). Entra como uma linha
      // própria do grupo, em peças pelo min/peça dela, para aparecer na conta dele.
      const dir = m.extraDirecionado;
      if (dir && minPecaMove > 0 && (dir.doMesMin > 0 || dir.herdadoMin > 0)) {
        const veio = dir.herdadoMin / minPecaMove;
        const plano = dir.doMesMin / minPecaMove;
        const emp = dir.pendenteMin / minPecaMove;
        somar(t, i, veio, plano, emp);
        if (!porRef.has(ROTULO_MOVE)) porRef.set(ROTULO_MOVE, quadraVazia(n));
        somar(porRef.get(ROTULO_MOVE)!, i, veio, plano, emp);
      }
    }
    const familia = familias[g.grupo]?.familia || 'Outros';
    const vira = familias[g.grupo]?.vira || null;
    const base: Linha = {
      chave: g.grupo,
      grupo: g.grupo,
      familia,
      ...t,
      costurado: costurado.get(g.grupo) || zeros(n),
      ocupacao,
      refs: Array.from(porRef.entries()).map(([referencia, x]) => ({ referencia, ...x })),
      papel: 'normal',
      refsCosturadas: [],
    };
    const costuraDeOutros = () => Array.from((costuradoPorRef.get(g.grupo) || new Map<string, number[]>()).entries())
      .map(([referencia, pecas]) => ({ referencia, pecas }));
    // Grupo SEM referência própria que costura as de outros (a ESPERANÇA no sutiã básico desde
    // o ERP, 24/11/2026: entra logo depois da POSITIVO e não é grupo A de nada). A linha mostra
    // o que ele costura, como a do grupo convertido, mas sem "virou" nem "largou".
    if ((!vira || vira === familia) && porRef.size === 0 && (costurado.get(g.grupo) || []).some((v) => v >= 0.5)) {
      return [{ ...base, ...quadraVazia(n), refs: [], papel: 'convertido' as const, refsCosturadas: costuraDeOutros() }];
    }
    if (!vira || vira === familia) return [base];
    // CONVERSÃO (a ESPERANÇA vira sutiã em dez/26): duas linhas.
    // Na família nova, o que ela COSTURA (de referências cujo grupo A é outro — já contadas no
    // produzido do grupo A delas, por isso não somam no total do bloco), com a ocupação dela.
    // Na família antiga, as referências que eram dela e ela largou: a demanda continua lá.
    return [
      {
        ...base,
        familia: vira,
        ...quadraVazia(n),
        refs: [],
        papel: 'convertido' as const,
        refsCosturadas: costuraDeOutros(),
      },
      { ...base, chave: `${g.grupo}|largou`, ocupacao: Array(n).fill(null) as (number | null)[], costurado: zeros(n), papel: 'largou' as const },
    ];
  });
  // Referências sem grupo candidato ficam pendentes sem passar por grupo nenhum.
  const empGrupos = Array.from({ length: n }, (_, i) => linhas.reduce((s, l) => s + l.empurra[i], 0));
  const semGrupo = pendente.map((v, i) => Math.max(0, v - empGrupos[i]));

  // Blocos por família, com os totais SEMPRE do conjunto inteiro (filtro da tela não mexe).
  const somaCols = (a: number[]) => cols.reduce((x, i) => x + (a[i] || 0), 0);
  // A linha do grupo convertido não tem plano próprio: ordena pelo que ele costura.
  const peso = (l: Linha) => (l.papel === 'convertido' ? somaCols(l.costurado) : somaCols(l.plano));
  const linhasOrdenadas = [...linhas].sort((a, b) => peso(b) - peso(a));
  const blocos: Bloco[] = FAMILIAS.map((familia) => {
    const gs = linhasOrdenadas.filter((l) => l.familia === familia && (l.papel === 'largou' ? somaCols(l.plano) : somaCols(l.plano) + somaCols(l.costurado)) >= 0.5);
    const soma = (k: keyof Quadra) => Array.from({ length: n }, (_, i) => gs.reduce((s, g) => s + g[k][i], 0));
    return { familia, grupos: gs, veio: soma('veio'), plano: soma('plano'), empurra: soma('empurra'), adianta: soma('adianta') };
  }).filter((b) => b.grupos.length > 0);

  // Referências sem grupo candidato: a quadra delas, pelas próprias minutos (para o filtro).
  const semCandidato: RefLinha[] = dados.referencias
    .filter((r) => (r.candidatas ?? (r.opcoes?.length || 0)) === 0 && Number(r.tempoMin || 0) > 0)
    .map((r) => {
      const q = quadraVazia(n);
      const t = Number(r.tempoMin);
      for (const p of r.periodos || []) {
        const i = PERIODOS.indexOf(p.periodo);
        if (i >= 0) somar(q, i, Number(p.herdadoMin || 0) / t, Number(p.pedidoMin || 0) / t, Number(p.pendenteMin || 0) / t, Number(p.adiantadoMin || 0) / t);
      }
      return { referencia: r.referencia, ...q };
    });

  return { linhas, blocos, planoSku, pendente, semGrupo, fabrica, costuradoPorRef, semCandidato };
}

export type Matriz = ReturnType<typeof montarMatriz>;
