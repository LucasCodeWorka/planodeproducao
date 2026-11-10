'use client';

// LISTA x PRODUCAO
//
// Esta tela existe para responder uma pergunta so: o cadastro grupo x referencia descreve o
// que a fabrica faz? Ela nao calcula capacidade, nao entra em plano e nao muda nada. Poe o
// que a lista diz ao lado do que o ERP registrou e deixa a diferenca a vista.
//
// Por que importa: todo o resto do sistema RATEIA a carga de uma referencia entre os grupos
// em que ela esta cadastrada. Quando a lista aponta para quem nao costura aquilo, a carga
// vai junto — o grupo que de fato produz aparece vazio e o que nao produz aparece cheio.
// A lista responde "onde PODE ser feito"; o sistema le como "onde VAI ser feito".
//
// FORMA: o argumento primeiro, em texto, com um exemplo real a cada passo; a tabela crua
// no fim, fechada. Uma tabela de 250 linhas prova o ponto para quem ja acredita nele — e a
// conversa que esta tela precisa sustentar e com quem ainda nao acredita. Os exemplos sao
// ESCOLHIDOS DOS DADOS a cada carregamento, nunca escritos a mao: quando o cadastro melhorar,
// o texto tem que enfraquecer sozinho.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type GrupoProduziu = { grupo: string; pecas: number; naLista: boolean };

type Referencia = {
  referencia: string;
  pecasProduzidas: number;
  pecasPlano: number;
  dono: string | null;
  pecasDono: number;
  concentracaoDono: number | null;
  donoEstaNaLista: boolean | null;
  gruposNaLista: string[];
  gruposQueProduziram: GrupoProduziu[];
};

type Grupo = {
  grupo: string;
  ativo: boolean;
  vinculos: number;
  confirmados: number;
  fantasmas: number;
  refsProduzidas: number;
  pecasProduzidas: number;
  refsForaDaLista: number;
  pecasForaDaLista: number;
  planoForaDaLista: number;
};

type Resumo = {
  meses: number;
  vinculos: number;
  referenciasNaLista: number;
  gruposPorReferencia: number;
  vinculosConfirmados: number;
  vinculosFantasmas: number;
  pctFantasmas: number;
  referenciasProduzidas: number;
  concentracaoMediaDono: number | null;
  donoForaDaLista: number;
  planoTotal: number;
  distribuicaoPlano: Record<string, number>;
};

type Dados = { resumo: Resumo; grupos: Grupo[]; referencias: Referencia[] };

type Filtro = 'divergentes' | 'todas';

const num = (v: number) => (v || 0).toLocaleString('pt-BR');
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

const FAIXAS: Array<{ chave: string; rotulo: string }> = [
  { chave: '0', rotulo: 'nenhum grupo' },
  { chave: '1', rotulo: '1 grupo' },
  { chave: '2', rotulo: '2 grupos' },
  { chave: '3', rotulo: '3 grupos' },
  { chave: '4', rotulo: '4 grupos' },
  { chave: '5', rotulo: '5 grupos' },
  { chave: '6+', rotulo: '6 ou mais' },
];

export default function ListaVsProducaoPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dados, setDados] = useState<Dados | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [meses, setMeses] = useState(6);
  const [filtro, setFiltro] = useState<Filtro>('divergentes');
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);
  const [verNumeros, setVerNumeros] = useState(false);

  const carregar = useCallback(async (janela: number, refresh = false) => {
    setLoading(true);
    setErro(null);
    try {
      const url = `${API_URL}/api/capacidade/lista-vs-producao?meses=${janela}${refresh ? '&refresh=true' : ''}`;
      const resp = await fetchNoCache(url, { headers: authHeaders() }, 600000);
      const json = await resp.json();
      if (!json?.success) throw new Error(json?.error || 'Falha ao carregar');
      setDados({ resumo: json.resumo, grupos: json.grupos, referencias: json.referencias });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    carregar(meses);
  }, [carregar, meses, router]);

  const inativos = useMemo(
    () => new Set((dados?.grupos || []).filter((g) => !g.ativo).map((g) => g.grupo)),
    [dados]
  );

  // Os tres exemplos do texto, escolhidos dos dados.
  const exemplos = useMemo(() => {
    if (!dados) return null;
    const comProducao = dados.referencias.filter((r) => r.pecasProduzidas > 0);

    // 1. ESPALHAMENTO: muitos grupos na lista, um so produzindo. Desempata pelo plano,
    //    que e o que de fato vai ser repartido.
    const espalhada = [...comProducao]
      .filter((r) => r.gruposNaLista.length >= 3 && r.gruposQueProduziram.length === 1)
      .sort((a, b) => (b.pecasPlano - a.pecasPlano) || (b.gruposNaLista.length - a.gruposNaLista.length))[0] || null;

    // 2. DIVERGENCIA: quem mais produz nao esta na lista. A maior em pecas.
    const divergente = [...comProducao]
      .filter((r) => r.donoEstaNaLista === false)
      .sort((a, b) => b.pecasProduzidas - a.pecasProduzidas)[0] || null;

    // 3. LISTA MORTA: todos os grupos apontados ja pararam de costurar.
    const morta = [...comProducao]
      .filter((r) => r.gruposNaLista.length > 0 && r.gruposNaLista.every((g) => inativos.has(g)))
      .sort((a, b) => b.pecasPlano - a.pecasPlano)[0] || null;

    return { espalhada, divergente, morta };
  }, [dados, inativos]);

  const planoEspalhado = useMemo(() => {
    if (!dados) return { pecas: 0, pct: 0 };
    const d = dados.resumo.distribuicaoPlano;
    const pecas = ['3', '4', '5', '6+'].reduce((s, k) => s + (d[k] || 0), 0);
    return { pecas, pct: dados.resumo.planoTotal > 0 ? pecas / dados.resumo.planoTotal : 0 };
  }, [dados]);

  const planoDivergente = useMemo(
    () => dados?.referencias.filter((r) => r.donoEstaNaLista === false).reduce((s, r) => s + r.pecasPlano, 0) ?? 0,
    [dados]
  );

  // A PERGUNTA DO GESTOR: o vinculo que nunca rodou chegou a ser NECESSARIO?
  //
  // Um cadastro de capacidade existe justamente para o transbordo: quando o grupo que
  // normalmente faz a peca enche, outro assume. Entao vinculo parado nao e, sozinho, prova
  // de erro — pode ser reserva que nunca precisou ser acionada. A unica forma honesta de
  // julgar e separar os casos: a peca foi feita? transbordou? e se transbordou, foi para
  // onde a lista apontava?
  const necessidade = useMemo(() => {
    if (!dados) return null;
    const comProducao = dados.referencias.filter((r) => r.pecasProduzidas > 0);
    const produzidas = new Set(comProducao.map((r) => r.referencia));

    let semNecessidade = 0;   // ninguem fez a peca: o vinculo nao foi chamado
    let soODono = 0;          // fez so quem costuma fazer: reserva nao acionada
    let transbordouSemEle = 0; // transbordou de fato, mas para outro grupo
    for (const r of dados.referencias) {
      const fez = new Set(r.gruposQueProduziram.map((g) => g.grupo));
      for (const g of r.gruposNaLista) {
        if (fez.has(g)) continue;
        if (!produzidas.has(r.referencia)) semNecessidade += 1;
        else if (fez.size === 1) soODono += 1;
        else transbordouSemEle += 1;
      }
    }

    let refsUmGrupo = 0;
    let refsVariosGrupos = 0;
    let pecasDono = 0;
    let pecasTransbordo = 0;
    let transbordoNaLista = 0;
    let transbordoFora = 0;
    for (const r of comProducao) {
      if (r.gruposQueProduziram.length === 1) refsUmGrupo += 1;
      else refsVariosGrupos += 1;
      for (const g of r.gruposQueProduziram) {
        if (g.grupo === r.dono) { pecasDono += g.pecas; continue; }
        pecasTransbordo += g.pecas;
        if (g.naLista) transbordoNaLista += g.pecas;
        else transbordoFora += g.pecas;
      }
    }
    // SEM AUTORIZACAO: peca costurada num grupo que a lista nao previa para ela.
    //
    // Se a lista e a regra de onde cada referencia pode ser feita, isto e o descumprimento
    // dela, medido em pecas. Nao se mede intencao aqui — pode ser decisao de chao de fabrica
    // para cumprir prazo, pode ser cadastro que nao acompanhou o mix. O que o numero fecha e
    // a pergunta anterior: a lista NAO descreve onde a producao acontece.
    //
    // CUIDADO QUE CUSTOU UMA MEDICAO ERRADA: grupo DESATIVADO nao entra nesta conta.
    // A comparacao e "producao de 6 meses" contra "a lista de agora". Os vinculos das
    // oficinas que pararam foram apagados em 09/11/2026 — entao, sem este filtro, tudo que
    // elas costuraram enquanto estavam ativas aparece como "sem autorizacao", e elas lideram
    // o ranking. Era a lista de depois julgando quem foi removido. Aqui a conta e so entre
    // os grupos que ainda costuram, que sao os unicos sobre os quais ela diz alguma coisa.
    let pecasAutorizadas = 0;
    let pecasSemAutorizacao = 0;
    let paresSemAutorizacao = 0;
    let pecasDeGrupoParado = 0;
    const refsSemAutorizacao = new Set<string>();
    const porGrupoSemAutorizacao = new Map<string, number>();
    for (const r of comProducao) {
      for (const g of r.gruposQueProduziram) {
        if (inativos.has(g.grupo)) { pecasDeGrupoParado += g.pecas; continue; }
        if (g.naLista) { pecasAutorizadas += g.pecas; continue; }
        pecasSemAutorizacao += g.pecas;
        paresSemAutorizacao += 1;
        refsSemAutorizacao.add(r.referencia);
        porGrupoSemAutorizacao.set(g.grupo, (porGrupoSemAutorizacao.get(g.grupo) || 0) + g.pecas);
      }
    }
    const rankingSemAutorizacao = Array.from(porGrupoSemAutorizacao.entries())
      .map(([grupo, pecas]) => ({ grupo, pecas }))
      .sort((a, b) => b.pecas - a.pecas)
      .slice(0, 8);

    // QUANDO TRANSBORDA, A FABRICA CONCENTRA — NAO RATEIA.
    // O modelo divide a carga em partes iguais entre os grupos cadastrados. A fabrica faz o
    // oposto: mesmo quando a peca passa por mais de um grupo, um deles leva a maior parte.
    const concentracoesMulti = comProducao
      .filter((r) => r.gruposQueProduziram.length > 1)
      .map((r) => r.concentracaoDono || 0)
      .sort((a, b) => a - b);
    const mediana = concentracoesMulti.length
      ? concentracoesMulti[Math.floor(concentracoesMulti.length / 2)]
      : 0;
    const acima70 = concentracoesMulti.filter((c) => c >= 0.7).length;

    // ERRO DE ALOCACAO: a conta que junta os dois problemas.
    // Para cada referencia, onde o modelo POE a carga (fatia igual por grupo cadastrado)
    // contra onde a fabrica de fato a executou. A metade da soma das diferencas absolutas e
    // exatamente quanto de carga esta no grupo errado — nem mais nem menos.
    let erroAlocacao = 0;
    let producaoTotal = 0;
    const modeloPorGrupo = new Map<string, number>();
    const realPorGrupo = new Map<string, number>();
    const soma = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) || 0) + v);
    for (const r of comProducao) {
      producaoTotal += r.pecasProduzidas;
      const real = new Map(r.gruposQueProduziram.map((g) => [g.grupo, g.pecas]));
      for (const g of r.gruposQueProduziram) soma(realPorGrupo, g.grupo, g.pecas);
      if (r.gruposNaLista.length === 0) continue;
      const fatia = r.pecasProduzidas / r.gruposNaLista.length;
      for (const g of r.gruposNaLista) soma(modeloPorGrupo, g, fatia);
      const chaves = new Set([...r.gruposNaLista, ...r.gruposQueProduziram.map((g) => g.grupo)]);
      let dif = 0;
      chaves.forEach((g) => {
        const m = r.gruposNaLista.includes(g) ? fatia : 0;
        dif += Math.abs(m - (real.get(g) || 0));
      });
      erroAlocacao += dif / 2;
    }
    const nomesDosGrupos = new Set<string>();
    modeloPorGrupo.forEach((_, g) => nomesDosGrupos.add(g));
    realPorGrupo.forEach((_, g) => nomesDosGrupos.add(g));
    const desvioPorGrupo = Array.from(nomesDosGrupos)
      .map((grupo) => {
        const modelo = modeloPorGrupo.get(grupo) || 0;
        const real = realPorGrupo.get(grupo) || 0;
        return { grupo, modelo, real, desvio: modelo - real };
      })
      .sort((a, b) => Math.abs(b.desvio) - Math.abs(a.desvio));

    const totalPecas = pecasDono + pecasTransbordo;
    const fantasmas = semNecessidade + soODono + transbordouSemEle;
    return {
      fantasmas,
      semNecessidade,
      soODono,
      transbordouSemEle,
      refsUmGrupo,
      refsVariosGrupos,
      refsProduzidas: produzidas.size,
      pecasDono,
      pecasTransbordo,
      transbordoNaLista,
      transbordoFora,
      pctTransbordo: totalPecas > 0 ? pecasTransbordo / totalPecas : 0,
      acertoDoTransbordo: pecasTransbordo > 0 ? transbordoNaLista / pecasTransbordo : 0,
      pecasAutorizadas,
      pecasSemAutorizacao,
      pecasDeGrupoParado,
      paresSemAutorizacao,
      refsSemAutorizacao: refsSemAutorizacao.size,
      pctSemAutorizacao: (pecasAutorizadas + pecasSemAutorizacao) > 0
        ? pecasSemAutorizacao / (pecasAutorizadas + pecasSemAutorizacao) : 0,
      rankingSemAutorizacao,
      concentracaoMediana: mediana,
      refsMultiAcima70: acima70,
      refsMulti: concentracoesMulti.length,
      erroAlocacao,
      producaoTotal,
      pctErroAlocacao: producaoTotal > 0 ? erroAlocacao / producaoTotal : 0,
      desvioPorGrupo,
    };
  }, [dados]);

  const referenciasVisiveis = useMemo(() => {
    if (!dados) return [];
    const termo = busca.trim().toUpperCase();
    return dados.referencias.filter((r) => {
      if (filtro === 'divergentes' && r.donoEstaNaLista !== false) return false;
      if (termo && !r.referencia.includes(termo)
          && !(r.dono || '').includes(termo)
          && !r.gruposNaLista.some((g) => g.includes(termo))) return false;
      return true;
    });
  }, [dados, filtro, busca]);

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="min-h-screen bg-gray-100">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`${ml} transition-all duration-300 p-6`}>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-brand-dark">Lista × Produção</h1>
            <p className="mt-1 text-sm text-gray-500">
              O cadastro grupo × referência contra o que a fábrica registrou.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Janela</label>
            <select
              value={meses}
              onChange={(ev) => setMeses(Number(ev.target.value))}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
            >
              {[3, 6, 12].map((m) => (
                <option key={m} value={m}>{m} meses</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => carregar(meses, true)}
              className="rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
            >
              Recalcular
            </button>
          </div>
        </div>

        {loading && (
          <div className="rounded-lg bg-white p-8 text-center shadow">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-brand-primary border-t-transparent" />
            <p className="mt-4 text-gray-500">Comparando a lista com a produção…</p>
          </div>
        )}

        {erro && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{erro}</div>}

        {!loading && !erro && dados && exemplos && (
          <>
            {/* ───── TUDO EM TRÊS COLUNAS ─────
                 Coluna 1: o que medimos e o que checamos antes de acusar.
                 Coluna 2: os dois problemas. Coluna 3: os exemplos.
                 O resultado atravessa as colunas 2 e 3 no pé — era onde sobrava espaço em
                 branco, e é onde a conclusão fecha a leitura. Empilha em tela estreita. */}
            <div className="mb-6 grid gap-6 2xl:grid-cols-3 xl:grid-cols-2">

            {/* coluna 1 — o quadro amarelo cresce para igualar a altura do resto */}
            <div className="flex flex-col gap-6">
            <div className="rounded-lg bg-white p-6 shadow">
              <p className="text-lg leading-relaxed text-gray-800">
                Nos últimos <strong>{dados.resumo.meses} meses fechados</strong>, a fábrica costurou{' '}
                <strong>{num(dados.resumo.referenciasProduzidas)} referências</strong>. A lista que diz onde
                cada uma é feita tem <strong>{num(dados.resumo.vinculos)} vínculos</strong> — e{' '}
                <strong className="text-red-600">{pct(dados.resumo.pctFantasmas)} deles</strong> nunca
                aconteceram.
              </p>
              <p className="mt-3 leading-relaxed text-gray-600">
                O sistema divide a carga de cada referência entre todos os grupos cadastrados nela. Para
                isso funcionar, a fábrica teria que obedecer a lista e repartir o trabalho entre os grupos
                apontados. <strong>Ela faz nem uma coisa nem outra</strong> — e são dois problemas
                diferentes, com efeitos diferentes no painel.
              </p>
              <ol className="mt-4 space-y-3 text-gray-700">
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 self-start rounded bg-red-100 px-2 py-0.5 text-xs font-bold uppercase leading-5 tracking-wide text-red-700">
                    Problema 1
                  </span>
                  <span>
                    <strong>Costuram em grupo fora da lista.</strong> Essa produção consome capacidade que o
                    painel não enxerga, e deixa folga onde não deveria haver.
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 self-start rounded bg-red-100 px-2 py-0.5 text-xs font-bold uppercase leading-5 tracking-wide text-red-700">
                    Problema 2
                  </span>
                  <span>
                    <strong>Quando transborda, concentram num grupo só.</strong> Não usam o rateio que o
                    sistema pressupõe — e o sistema reparte em partes iguais.
                  </span>
                </li>
              </ol>

              {/* Os tres numeros da conversa, juntos. Quem sai da sala com um numero na
                  cabeca sai com o do meio — e os outros dois sustentam ele. */}
              {necessidade && (
                <div className="mt-6 grid grid-cols-3 gap-4 border-t border-gray-200 pt-5">
                  <div>
                    <div className="text-2xl font-semibold tabular-nums text-gray-800">
                      {pct(dados.resumo.pctFantasmas)}
                    </div>
                    <div className="mt-0.5 text-xs leading-snug text-gray-500">
                      dos vínculos da lista nunca rodaram
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold tabular-nums text-red-600">
                      {pct(necessidade.pctErroAlocacao)}
                    </div>
                    <div className="mt-0.5 text-xs leading-snug text-gray-500">
                      da carga é colocada no grupo errado
                    </div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold tabular-nums text-gray-800">
                      {pct(necessidade.pctSemAutorizacao)}
                    </div>
                    <div className="mt-0.5 text-xs leading-snug text-gray-500">
                      do que se costurou foi sem autorização
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ───── A OBJEÇÃO, PRIMEIRO ───── */}
            {necessidade && (
              <div className="flex-1 rounded-lg border border-amber-300 bg-amber-50/50 p-6 shadow">
                <div className="mb-2 flex items-baseline gap-3">
                  <span className="text-2xl font-light text-amber-400">?</span>
                  <h2 className="text-base font-semibold text-gray-800">
                    Antes de acusar: os vínculos parados chegaram a ser necessários?
                  </h2>
                </div>
                <p className="mb-4 leading-relaxed text-gray-700">
                  Um cadastro de capacidade existe justamente para o transbordo: quando o grupo que normalmente
                  faz a peça enche, outro assume. Então vínculo parado, sozinho, não prova nada — pode ser
                  reserva que nunca precisou ser chamada. Separando os casos antes de seguir:
                </p>

                <div className="mb-4 rounded border border-gray-200 bg-white p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Os {num(necessidade.fantasmas)} vínculos que nunca rodaram
                  </div>
                  <ul className="space-y-1.5 text-sm">
                    <LinhaFatia
                      rotulo="a referência não foi produzida por ninguém — o vínculo nem foi chamado"
                      valor={necessidade.semNecessidade}
                      total={necessidade.fantasmas}
                      tom="neutro"
                    />
                    <LinhaFatia
                      rotulo="foi produzida, mas só pelo grupo de sempre — a reserva não precisou entrar"
                      valor={necessidade.soODono}
                      total={necessidade.fantasmas}
                      tom="neutro"
                    />
                    <LinhaFatia
                      rotulo="transbordou de fato — e foi para outro grupo, não para este"
                      valor={necessidade.transbordouSemEle}
                      total={necessidade.fantasmas}
                      tom="ruim"
                    />
                  </ul>
                  <p className="mt-2 text-xs text-gray-500">
                    Ou seja: {pct((necessidade.semNecessidade + necessidade.soODono) / Math.max(1, necessidade.fantasmas))}{' '}
                    dos vínculos parados são defensáveis — ninguém precisou deles. O que não se defende são os{' '}
                    <strong>{num(necessidade.transbordouSemEle)}</strong> em que a peça transbordou e foi para
                    outro lugar.
                  </p>
                </div>

                <h3 className="mb-2 mt-6 border-t border-amber-200 pt-4 text-base font-semibold text-gray-800">
                  E a fábrica transborda mesmo. A lista não deveria prever isso?
                </h3>
                <p className="mb-3 leading-relaxed text-gray-700">
                  Deveria, e é por isso que ela existe. Transbordo não é exceção aqui: das{' '}
                  {num(necessidade.refsProduzidas)} referências produzidas,{' '}
                  <strong>{num(necessidade.refsVariosGrupos)}</strong> passaram por mais de um grupo
                  ({pct(necessidade.refsVariosGrupos / Math.max(1, necessidade.refsProduzidas))}), e{' '}
                  <strong>{num(necessidade.pecasTransbordo)} peças</strong> ({pct(necessidade.pctTransbordo)} de
                  tudo que se costurou) saíram fora do grupo de sempre. Manter grupos de reserva cadastrados
                  é a decisão certa.
                </p>
                <p className="mb-3 leading-relaxed text-gray-700">
                  A questão é outra: quando o transbordo acontece, ele vai para onde a lista apontava?
                </p>

                <div className="rounded border border-gray-200 bg-white p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Para onde foi o transbordo: {num(necessidade.pecasTransbordo)} peças
                  </div>
                  <div className="flex h-7 w-full overflow-hidden rounded">
                    <div
                      className="flex items-center justify-center bg-emerald-600 text-[11px] font-semibold text-white"
                      style={{ width: `${Math.max(6, necessidade.acertoDoTransbordo * 100)}%` }}
                    >
                      {pct(necessidade.acertoDoTransbordo)}
                    </div>
                    <div
                      className="flex items-center justify-center bg-red-500 text-[11px] font-semibold text-white"
                      style={{ width: `${Math.max(6, (1 - necessidade.acertoDoTransbordo) * 100)}%` }}
                    >
                      {pct(1 - necessidade.acertoDoTransbordo)}
                    </div>
                  </div>
                  <div className="mt-1.5 flex justify-between text-xs">
                    <span className="text-emerald-700">
                      {num(necessidade.transbordoNaLista)} para grupo que a lista previa
                    </span>
                    <span className="text-red-600">
                      {num(necessidade.transbordoFora)} para grupo fora da lista
                    </span>
                  </div>
                </div>

                <p className="mt-4 leading-relaxed text-gray-800">
                  <strong>Então a conclusão não é “a lista está errada”.</strong> A fábrica transborda, e a
                  lista está certa em existir. Só que ela acerta{' '}
                  <strong>{pct(necessidade.acertoDoTransbordo)}</strong> de para onde o transbordo vai —
                  e é sobre esse acerto que o sistema divide a carga. Os dois problemas abaixo saem daí.
                </p>
              </div>
            )}

            </div>

            <div className="grid items-start gap-6 xl:grid-cols-2 2xl:col-span-2">

            {/* coluna 2 — os dois problemas e o exemplo do primeiro */}
            <div className="space-y-6">
            {/* ───── SEM AUTORIZAÇÃO ───── */}
            {necessidade && (
              <Passo
                n={1}
                titulo="Costuram em grupo que a lista não autoriza"
                frase={
                  <>
                    Das {num(necessidade.pecasAutorizadas + necessidade.pecasSemAutorizacao)} peças
                    costuradas na janela pelos grupos que ainda rodam,{' '}
                    <strong className="text-red-600">{num(necessidade.pecasSemAutorizacao)}</strong>{' '}
                    ({pct(necessidade.pctSemAutorizacao)}) saíram de um grupo que a lista{' '}
                    <strong>não autorizava</strong> para aquela referência — em{' '}
                    {num(necessidade.paresSemAutorizacao)} combinações grupo + referência, envolvendo{' '}
                    {num(necessidade.refsSemAutorizacao)} referências. Se a lista é a regra, essa produção
                    fura a regra.
                  </>
                }
              >
                <div className="overflow-x-auto rounded border border-gray-200 bg-gray-50 p-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                        <th className="whitespace-nowrap px-2 py-1.5 text-left">grupo</th>
                        <th className="px-2 py-1.5 text-right">peças sem autorização</th>
                      </tr>
                    </thead>
                    <tbody>
                      {necessidade.rankingSemAutorizacao.map((g) => (
                        <tr key={g.grupo} className="border-b border-gray-100 last:border-0">
                          <td className="whitespace-nowrap px-2 py-1 text-gray-800">{g.grupo}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-red-700">{num(g.pecas)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-sm text-gray-700">
                  <strong>O efeito no painel:</strong> essas {num(necessidade.pecasSemAutorizacao)} peças
                  consumiram minutos reais de grupos que o sistema não creditou por elas. O grupo que
                  costurou aparece com capacidade livre que já foi gasta; o grupo que o sistema achava que
                  faria aparece carregado sem ter encostado na peça.
                </p>
                <p className="mt-2 text-sm text-gray-500">
                  Os dados mostram a magnitude, não a intenção. Pode ser decisão de chão de fábrica para
                  cumprir prazo, pode ser cadastro que não acompanhou a mudança de mix. O que eles não
                  permitem é dizer que a lista descreve a produção: em {pct(necessidade.pctSemAutorizacao)} do
                  volume, ela não descreve.
                </p>
                <p className="mt-2 text-sm text-gray-500">
                  Dois cuidados na leitura. Grupo cadastrado há pouco tempo aparece no topo por construção —
                  quase tudo que ele costurou é anterior ao cadastro dele. E as oficinas que pararam ficam
                  fora desta conta: elas estavam autorizadas enquanto rodaram, e os vínculos delas foram
                  removidos depois ({num(necessidade.pecasDeGrupoParado)} peças, que seriam contadas como
                  infração se a lista de hoje julgasse o passado delas).
                </p>
              </Passo>
            )}


            {/* ───── PROBLEMA 2: CONCENTRA, NÃO RATEIA ───── */}
            {necessidade && (
              <Passo
                n={2}
                titulo="Quando transborda, a fábrica concentra — não rateia"
                frase={
                  <>
                    O sistema divide a carga de uma referência em <strong>partes iguais</strong> entre os
                    grupos cadastrados nela. A fábrica faz o oposto: mesmo nas{' '}
                    {num(necessidade.refsMulti)} referências que passaram por mais de um grupo, o maior
                    deles leva <strong>{pct(necessidade.concentracaoMediana)}</strong> da produção
                    (mediana), e em <strong>{num(necessidade.refsMultiAcima70)}</strong> delas leva mais de
                    70%. Transbordo não é divisão — é uma sobra que um segundo grupo absorve.
                  </>
                }
              >
                <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Uma referência cadastrada em 5 grupos, produzida por 2
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="mb-1 text-xs text-gray-500">o que o sistema faz</div>
                      <div className="flex h-6 overflow-hidden rounded text-[10px] font-semibold text-white">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <div key={i} className="flex flex-1 items-center justify-center border-r border-white bg-gray-400 last:border-0">
                            20%
                          </div>
                        ))}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">cada grupo recebe um quinto</div>
                    </div>
                    <div>
                      <div className="mb-1 text-xs text-gray-500">o que a fábrica faz</div>
                      <div className="flex h-6 overflow-hidden rounded text-[10px] font-semibold text-white">
                        <div className="flex items-center justify-center bg-emerald-600" style={{ width: '85%' }}>85%</div>
                        <div className="flex items-center justify-center border-l border-white bg-emerald-400" style={{ width: '15%' }}>15%</div>
                      </div>
                      <div className="mt-1 text-xs text-gray-500">um grupo faz quase tudo; os outros três, nada</div>
                    </div>
                  </div>
                </div>
              </Passo>
            )}

            {/* ───── PASSO 3 ───── */}
            <Passo
              titulo="Em 35 referências, quem mais produz nem está na lista"
              frase={
                <>
                  Em <strong className="text-red-600">{num(dados.resumo.donoForaDaLista)} referências</strong> o
                  grupo que mais produz <strong>não está na lista</strong> — a carga vai inteira para outro
                  lugar. São <strong>{num(planoDivergente)} peças</strong> de plano.
                </>
              }
            >
              {exemplos.divergente && (
                <ExemploRef
                  r={exemplos.divergente}
                  inativos={inativos}
                  legenda={
                    <>
                      Quem mais costura é <strong>{exemplos.divergente.dono}</strong>, com{' '}
                      {num(exemplos.divergente.pecasDono)} peças ({pct(exemplos.divergente.concentracaoDono)} do
                      total) — e não aparece nos {exemplos.divergente.gruposNaLista.length} grupos cadastrados.
                    </>
                  }
                />
              )}
              {exemplos.morta && (
                <div className="mt-3">
                  <p className="mb-2 text-sm text-gray-600">
                    Pior ainda quando a lista aponta só para grupos que <strong>já pararam de costurar</strong>:
                  </p>
                  <ExemploRef
                    r={exemplos.morta}
                    inativos={inativos}
                    legenda={
                      <>
                        Os {exemplos.morta.gruposNaLista.length} grupos da lista estão todos desativados. As{' '}
                        {num(exemplos.morta.pecasProduzidas)} peças saíram de{' '}
                        <strong>{exemplos.morta.dono}</strong>, que não consta.
                      </>
                    }
                  />
                </div>
              )}
            </Passo>


            </div>

            {/* coluna 3 — o exemplo do segundo problema e o resultado, que desce até o pé */}
            <div className="space-y-6">
            {/* ───── PASSO 1 ───── */}
            <Passo
              titulo="E a lista espalha por mais grupos ainda"
              frase={
                <>
                  Cada referência está cadastrada em{' '}
                  <strong>{dados.resumo.gruposPorReferencia.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} grupos</strong>{' '}
                  em média, e a carga é dividida por todos eles. Mas quem de fato costura concentra{' '}
                  <strong>{pct(dados.resumo.concentracaoMediaDono)}</strong> da produção.{' '}
                  <strong>{num(planoEspalhado.pecas)} peças</strong> do plano
                  ({(planoEspalhado.pct * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%)
                  estão em referência cadastrada em três ou mais grupos.
                </>
              }
            >
              {exemplos.espalhada && (
                <ExemploRef
                  r={exemplos.espalhada}
                  inativos={inativos}
                  legenda={
                    <>
                      Cadastrada em <strong>{exemplos.espalhada.gruposNaLista.length} grupos</strong>, produzida
                      por <strong>um só</strong>. O sistema manda{' '}
                      {Math.round(exemplos.espalhada.pecasPlano / Math.max(1, exemplos.espalhada.gruposNaLista.length))
                        .toLocaleString('pt-BR')}{' '}
                      peças de plano para cada um dos {exemplos.espalhada.gruposNaLista.length}.
                    </>
                  }
                />
              )}
            </Passo>


            {/* ───── A CONTA DOS DOIS PROBLEMAS JUNTOS ───── */}
            {necessidade && (
              <details open className="group rounded-lg border-2 border-red-300 bg-white p-6 shadow">
                <summary className="-m-6 mb-0 cursor-pointer list-none p-6">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-base font-semibold text-gray-800">
                      O resultado dos dois problemas somados
                    </span>
                    <span className="shrink-0 text-xs text-gray-400 group-open:hidden">clique para abrir</span>
                    <span className="hidden shrink-0 text-xs text-gray-400 group-open:inline">clique para fechar</span>
                  </span>
                  <span className="mt-2 block text-3xl font-semibold tabular-nums text-red-600">
                    {pct(necessidade.pctErroAlocacao)}
                    <span className="ml-3 align-middle text-base font-normal text-gray-600">
                      da carga é colocada no grupo errado
                    </span>
                  </span>
                </summary>
                <div className="mt-5">
                <p className="mb-4 leading-relaxed text-gray-700">
                  Comparando, referência por referência, <strong>onde o sistema põe a carga</strong> com{' '}
                  <strong>onde a fábrica de fato costurou</strong>:{' '}
                  {num(Math.round(necessidade.erroAlocacao))} das{' '}
                  {num(necessidade.producaoTotal)} peças estão alocadas em um grupo que não as executou.
                  Não é estimativa — é a diferença medida entre as duas distribuições.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                        <th className="py-1.5 pr-2 text-left">grupo de costura</th>
                        <th className="whitespace-nowrap px-2 py-1.5 text-right">o sistema manda</th>
                        <th className="whitespace-nowrap px-2 py-1.5 text-right">a fábrica fez</th>
                        <th className="whitespace-nowrap px-2 py-1.5 text-right">diferença</th>
                        <th className="whitespace-nowrap py-1.5 pl-2 text-right">no painel</th>
                      </tr>
                    </thead>
                    <tbody>
                      {necessidade.desvioPorGrupo.slice(0, 10).map((g) => {
                        const inchado = g.desvio > 0;
                        const escala = Math.min(100, (Math.abs(g.desvio) / Math.max(1, Math.abs(necessidade.desvioPorGrupo[0].desvio))) * 100);
                        return (
                          <tr key={g.grupo} className="border-b border-gray-100">
                            <td className="py-2 pr-2 text-gray-800">
                              {g.grupo}
                              {/* A barra vive sob o nome do grupo: numa coluna estreita ela nao
                                  cabe ao lado sem empurrar a tabela para fora da tela. */}
                              <span className="mt-1 block h-1.5 w-full rounded bg-gray-100">
                                <span
                                  className={`block h-1.5 rounded ${inchado ? 'bg-amber-500' : 'bg-red-500'}`}
                                  style={{ width: `${escala}%` }}
                                />
                              </span>
                            </td>
                            <td className="px-2 py-2 text-right align-top tabular-nums text-gray-500">{num(Math.round(g.modelo))}</td>
                            <td className="px-2 py-2 text-right align-top tabular-nums text-gray-800">{num(Math.round(g.real))}</td>
                            <td className={`px-2 py-2 text-right align-top font-medium tabular-nums ${inchado ? 'text-amber-600' : 'text-red-600'}`}>
                              {g.desvio > 0 ? '+' : '−'}{num(Math.abs(Math.round(g.desvio)))}
                            </td>
                            <td className={`whitespace-nowrap py-2 pl-2 text-right align-top text-xs font-medium ${inchado ? 'text-amber-600' : 'text-red-600'}`}>
                              {inchado ? 'mais cheio' : 'mais vazio'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-sm text-gray-600">
                  É isso que o painel mostra hoje: grupo com folga que não tem, grupo lotado sem estar.
                  A média da fábrica continua certa — o que se perde é onde aperta.
                </p>
                </div>
              </details>
            )}
            </div>
            </div>

            </div>



            {/* ───── O QUE ISSO CAUSA ───── */}
            <div className="mb-6 rounded-lg border-l-4 border-brand-primary bg-white p-6 shadow">
              <h2 className="mb-2 text-base font-semibold text-gray-800">O que isso faz com a conta</h2>
              <p className="leading-relaxed text-gray-700">
                A ocupação de cada grupo sai da carga que ele recebe dividida pela capacidade dele. Quando a
                carga é repartida com quem não costura aquela peça, dois erros acontecem de uma vez: o grupo
                que realmente produz <strong>aparece com folga que não tem</strong>, e o que não produz{' '}
                <strong>aparece cheio sem estar</strong>. A média da fábrica continua certa — o que se perde é
                justamente o que a tela deveria mostrar: onde aperta.
              </p>
              <p className="mt-3 text-sm text-gray-500">
                A lista não precisa ser abandonada. Ela é a resposta certa para “quem consegue fazer”. Falta ao
                sistema uma segunda informação, que o ERP já tem: quem <em>está</em> fazendo.
              </p>
            </div>

            {/* ───── OS NÚMEROS ───── */}
            <button
              type="button"
              onClick={() => setVerNumeros((v) => !v)}
              className="mb-4 rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {verNumeros ? 'Esconder os números' : `Ver os números (${num(dados.referencias.length)} referências, ${num(dados.grupos.length)} grupos)`}
            </button>

            {verNumeros && (
              <>
                <div className="mb-6 rounded-lg bg-white p-4 shadow">
                  <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-600">
                    O plano, por quantos grupos a referência está cadastrada
                  </h2>
                  <p className="mb-3 text-xs text-gray-500">
                    Total de {num(dados.resumo.planoTotal)} peças no plano lançado.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                          <th className="px-3 py-2 text-left">cadastrada em…</th>
                          <th className="px-3 py-2 text-right">peças</th>
                          <th className="px-3 py-2 text-right">% do plano</th>
                          <th className="px-3 py-2 text-left">　</th>
                        </tr>
                      </thead>
                      <tbody>
                        {FAIXAS.map(({ chave, rotulo }) => {
                          const v = dados.resumo.distribuicaoPlano[chave] || 0;
                          const p = dados.resumo.planoTotal > 0 ? v / dados.resumo.planoTotal : 0;
                          return (
                            <tr key={chave} className="border-b border-gray-100">
                              <td className="px-3 py-1.5 text-gray-700">{rotulo}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{num(v)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">
                                {(p * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                              </td>
                              <td className="px-3 py-1.5">
                                <div className="h-2 rounded bg-gray-100">
                                  <div
                                    className={`h-2 rounded ${chave === '0' ? 'bg-amber-400' : 'bg-brand-primary'}`}
                                    style={{ width: `${Math.min(100, p * 100)}%` }}
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="mb-6 rounded-lg bg-white p-4 shadow">
                  <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-600">
                    Por grupo de costura
                  </h2>
                  <p className="mb-3 text-xs text-gray-500">
                    “Confirmado” é o vínculo que a produção comprova. “Fantasma” está na lista e nunca rodou.
                    “Fora da lista” é o contrário: o grupo produziu e não consta.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                          <th className="px-3 py-2 text-left">grupo</th>
                          <th className="px-3 py-2 text-right">vínculos</th>
                          <th className="px-3 py-2 text-right">confirmados</th>
                          <th className="px-3 py-2 text-right">fantasmas</th>
                          <th className="px-3 py-2 text-right">refs que produziu</th>
                          <th className="px-3 py-2 text-right">fora da lista</th>
                          <th className="px-3 py-2 text-right">peças fora da lista</th>
                          <th className="px-3 py-2 text-right">plano nelas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dados.grupos.map((g) => (
                          <tr key={g.grupo} className={`border-b border-gray-100 ${g.ativo ? '' : 'text-gray-400 line-through'}`}>
                            <td className="px-3 py-1.5">{g.grupo}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{num(g.vinculos)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{num(g.confirmados)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-red-600">{num(g.fantasmas)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{num(g.refsProduzidas)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-red-600">{num(g.refsForaDaLista)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{num(g.pecasForaDaLista)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums font-medium">{num(g.planoForaDaLista)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs text-gray-400">Riscado: grupo desativado, que não costura mais.</p>
                </div>

                <div className="rounded-lg bg-white p-4 shadow">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
                        Referência por referência
                      </h2>
                      <p className="text-xs text-gray-500">
                        Clique numa linha para ver quem a lista aponta e quem de fato produziu.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        value={busca}
                        onChange={(ev) => setBusca(ev.target.value)}
                        placeholder="referência ou grupo"
                        className="rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                      {(['divergentes', 'todas'] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setFiltro(f)}
                          className={`rounded border px-3 py-1 text-sm ${
                            filtro === f
                              ? 'border-brand-primary bg-brand-primary text-white'
                              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {f === 'divergentes' ? 'Só as divergentes' : 'Todas'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <p className="mb-3 text-xs text-gray-500">
                    Mostrando {num(referenciasVisiveis.length)} de {num(dados.referencias.length)} referências.
                  </p>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                          <th className="px-3 py-2 text-left">referência</th>
                          <th className="px-3 py-2 text-right">produziu</th>
                          <th className="px-3 py-2 text-right">plano</th>
                          <th className="px-3 py-2 text-left">quem mais produz</th>
                          <th className="px-3 py-2 text-right">concentração</th>
                          <th className="px-3 py-2 text-center">está na lista?</th>
                          <th className="px-3 py-2 text-right">grupos na lista</th>
                        </tr>
                      </thead>
                      <tbody>
                        {referenciasVisiveis.map((r) => (
                          <RefLinha
                            key={r.referencia}
                            r={r}
                            inativos={inativos}
                            aberta={aberta === r.referencia}
                            onToggle={() => setAberta(aberta === r.referencia ? null : r.referencia)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4 text-xs leading-relaxed text-gray-500">
              <p className="mb-1 font-semibold text-gray-600">De onde vêm os números</p>
              <p>
                Produção: <code>vr_cdf_movopi</code> com <code>tp_historicomov = 51</code> e{' '}
                <code>in_estorno = &apos;F&apos;</code>, restrita aos locais dos grupos de capacidade, nos meses
                fechados. Referência: <code>f_dic_prd_nivel(cd_produto, &apos;CD&apos;)</code>. Plano:{' '}
                <code>vr_pcp_lotepl2</code> × <code>pcp_lotepv</code> com <code>tp_situacao = 1</code>. Lista:{' '}
                <code>app_capacidade_grupo_refs</code>, editável na tela de Capacidade. Os exemplos acima são
                escolhidos dos dados a cada carregamento, não escritos à mão.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Passo({ n, titulo, frase, children }: {
  n?: number; titulo: string; frase: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg bg-white p-6 shadow ${n ? 'border-l-4 border-red-400' : ''}`}>
      <div className="mb-2 flex items-baseline gap-3">
        {n !== undefined && (
          <span className="shrink-0 rounded bg-red-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-red-700">
            Problema {n}
          </span>
        )}
        <h2 className="text-base font-semibold text-gray-800">{titulo}</h2>
      </div>
      <p className="mb-4 leading-relaxed text-gray-700">{frase}</p>
      {children}
    </div>
  );
}

function LinhaFatia({ rotulo, valor, total, tom }: {
  rotulo: string; valor: number; total: number; tom: 'neutro' | 'ruim';
}) {
  const p = total > 0 ? valor / total : 0;
  return (
    <li className="flex items-center gap-3">
      <span className={`w-12 shrink-0 text-right text-sm font-semibold tabular-nums ${tom === 'ruim' ? 'text-red-600' : 'text-gray-700'}`}>
        {num(valor)}
      </span>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-gray-400">
        {Math.round(p * 100)}%
      </span>
      <span className="h-2 w-20 shrink-0 rounded bg-gray-100">
        <span
          className={`block h-2 rounded ${tom === 'ruim' ? 'bg-red-500' : 'bg-gray-400'}`}
          style={{ width: `${Math.min(100, p * 100)}%` }}
        />
      </span>
      <span className="text-sm text-gray-700">{rotulo}</span>
    </li>
  );
}

function ExemploRef({ r, inativos, legenda }: {
  r: Referencia; inativos: Set<string>; legenda: React.ReactNode;
}) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="font-semibold tabular-nums text-gray-900">Referência {r.referencia}</span>
        <span className="text-xs text-gray-500">
          {num(r.pecasProduzidas)} peças produzidas · {num(r.pecasPlano)} no plano
        </span>
      </div>
      <p className="mb-3 text-sm text-gray-600">{legenda}</p>
      {/* Uma coluna por padrao: dentro de um cartao de coluna estreita, duas colunas
          espremem o nome do grupo e ele quebra em duas linhas. So abre em duas quando ha
          largura de verdade. */}
      <div className="grid gap-4 2xl:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            A lista diz que fazem
          </div>
          <ul className="space-y-0.5 text-sm">
            {r.gruposNaLista.length === 0 && <li className="text-amber-700">Nenhum grupo cadastrado.</li>}
            {r.gruposNaLista.map((g) => {
              const fez = r.gruposQueProduziram.find((x) => x.grupo === g);
              return (
                <li key={g} className="flex items-baseline justify-between gap-3">
                  <span className={`whitespace-nowrap ${fez ? 'text-gray-800' : 'text-gray-400'}`}>
                    {g}
                    {inativos.has(g) && (
                      <span className="ml-1 text-[10px] uppercase text-gray-400">(parado)</span>
                    )}
                  </span>
                  <span className={`shrink-0 tabular-nums ${fez ? 'text-emerald-700' : 'text-red-500'}`}>
                    {fez ? num(fez.pecas) : 'nunca produziu'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Quem de fato produziu
          </div>
          <ul className="space-y-0.5 text-sm">
            {r.gruposQueProduziram.length === 0 && <li className="text-gray-500">Sem produção na janela.</li>}
            {r.gruposQueProduziram.map((g) => (
              <li key={g.grupo} className="flex items-baseline justify-between gap-3">
                <span className="whitespace-nowrap text-gray-800">
                  {g.grupo}
                  {!g.naLista && (
                    <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                      fora da lista
                    </span>
                  )}
                </span>
                <span className="shrink-0 tabular-nums text-gray-700">{num(g.pecas)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function RefLinha({ r, inativos, aberta, onToggle }: {
  r: Referencia; inativos: Set<string>; aberta: boolean; onToggle: () => void;
}) {
  const divergente = r.donoEstaNaLista === false;
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-gray-100 hover:bg-gray-50 ${divergente ? 'bg-red-50/40' : ''}`}
      >
        <td className="px-3 py-1.5 font-medium tabular-nums">{r.referencia}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{num(r.pecasProduzidas)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{num(r.pecasPlano)}</td>
        <td className="px-3 py-1.5 text-gray-700">{r.dono || <span className="text-gray-400">não produziu</span>}</td>
        <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{pct(r.concentracaoDono)}</td>
        <td className="px-3 py-1.5 text-center">
          {r.donoEstaNaLista === null
            ? <span className="text-gray-400">—</span>
            : r.donoEstaNaLista
              ? <span className="text-emerald-700">sim</span>
              : <span className="font-semibold text-red-600">não</span>}
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums">{r.gruposNaLista.length}</td>
      </tr>
      {aberta && (
        <tr className="border-b border-gray-200 bg-gray-50">
          <td colSpan={7} className="px-3 py-3">
            <ExemploRef r={r} inativos={inativos} legenda={null} />
          </td>
        </tr>
      )}
    </>
  );
}
