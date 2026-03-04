import { Planejamento } from "../types";

type RefGroup = {
  referencia: string;
  itens: Planejamento[];
  totais: Totais;
};

type ContGroup = {
  continuidade: string;
  referencias: RefGroup[];
  totais: Totais;
};

type Totais = {
  estoqueAtual: number;
  emProcesso: number;
  estoqueMinimo: number;
  pedidosPendentes: number;
  necessidadeProducao: number;
};

function formatNum(v: number) {
  return Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function somarTotais(base: Totais, item: Planejamento): Totais {
  return {
    estoqueAtual: base.estoqueAtual + (item.estoques.estoque_atual || 0),
    emProcesso: base.emProcesso + (item.estoques.em_processo || 0),
    estoqueMinimo: base.estoqueMinimo + (item.estoques.estoque_minimo || 0),
    pedidosPendentes: base.pedidosPendentes + (item.demanda.pedidos_pendentes || 0),
    necessidadeProducao: base.necessidadeProducao + (item.planejamento.necessidade_producao || 0),
  };
}

function zerarTotais(): Totais {
  return {
    estoqueAtual: 0,
    emProcesso: 0,
    estoqueMinimo: 0,
    pedidosPendentes: 0,
    necessidadeProducao: 0,
  };
}

function agrupar(dados: Planejamento[]): ContGroup[] {
  const contMap = new Map<string, Map<string, Planejamento[]>>();

  for (const item of dados) {
    const cont = (item.produto.continuidade || "SEM CONTINUIDADE").trim();
    const ref = (item.produto.referencia || "SEM REFERENCIA").trim();

    if (!contMap.has(cont)) contMap.set(cont, new Map<string, Planejamento[]>());
    const refMap = contMap.get(cont)!;
    if (!refMap.has(ref)) refMap.set(ref, []);
    refMap.get(ref)!.push(item);
  }

  return Array.from(contMap.entries())
    .map(([continuidade, refMap]) => {
      let totaisCont = zerarTotais();

      const referencias: RefGroup[] = Array.from(refMap.entries())
        .map(([referencia, itens]) => {
          const totaisRef = itens.reduce((acc, it) => somarTotais(acc, it), zerarTotais());
          totaisCont = {
            estoqueAtual: totaisCont.estoqueAtual + totaisRef.estoqueAtual,
            emProcesso: totaisCont.emProcesso + totaisRef.emProcesso,
            estoqueMinimo: totaisCont.estoqueMinimo + totaisRef.estoqueMinimo,
            pedidosPendentes: totaisCont.pedidosPendentes + totaisRef.pedidosPendentes,
            necessidadeProducao: totaisCont.necessidadeProducao + totaisRef.necessidadeProducao,
          };
          return {
            referencia,
            itens: itens.sort((a, b) =>
              `${a.produto.cor || ""}-${a.produto.tamanho || ""}`.localeCompare(
                `${b.produto.cor || ""}-${b.produto.tamanho || ""}`
              )
            ),
            totais: totaisRef,
          };
        })
        .sort((a, b) => a.referencia.localeCompare(b.referencia));

      return { continuidade, referencias, totais: totaisCont };
    })
    .sort((a, b) => a.continuidade.localeCompare(b.continuidade));
}

interface Props {
  dados: Planejamento[];
}

export default function MatrizPlanejamentoTable({ dados }: Props) {
  if (!dados.length) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-sm text-gray-600">
        Nenhum dado de planejamento encontrado.
      </div>
    );
  }

  const grupos = agrupar(dados);

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-3 py-2 text-left">Continu.</th>
            <th className="px-3 py-2 text-left">Ref.</th>
            <th className="px-3 py-2 text-left">Cor-Tam</th>
            <th className="px-3 py-2 text-right">Estoque</th>
            <th className="px-3 py-2 text-right">Em Proc.</th>
            <th className="px-3 py-2 text-right">Est. Min.</th>
            <th className="px-3 py-2 text-right">Pend.</th>
            <th className="px-3 py-2 text-right">Produzir</th>
          </tr>
        </thead>
        <tbody>
          {grupos.map((cont) => (
            <tr key={cont.continuidade}>
              <td colSpan={8} className="p-0">
                <details open className="border-t border-gray-200">
                  <summary className="list-none cursor-pointer px-3 py-2 bg-blue-50 font-semibold text-blue-900 flex justify-between">
                    <span>{cont.continuidade}</span>
                    <span>
                      Est: {formatNum(cont.totais.estoqueAtual)} | Min: {formatNum(cont.totais.estoqueMinimo)} | Prod: {formatNum(cont.totais.necessidadeProducao)}
                    </span>
                  </summary>

                  {cont.referencias.map((ref) => (
                    <details key={`${cont.continuidade}-${ref.referencia}`} className="border-t border-gray-100" open>
                      <summary className="list-none cursor-pointer px-3 py-2 bg-gray-50 font-medium text-gray-800 flex justify-between">
                        <span>{ref.referencia}</span>
                        <span>
                          Est: {formatNum(ref.totais.estoqueAtual)} | Min: {formatNum(ref.totais.estoqueMinimo)} | Prod: {formatNum(ref.totais.necessidadeProducao)}
                        </span>
                      </summary>

                      <table className="min-w-full">
                        <tbody>
                          {ref.itens.map((item, idx) => (
                            <tr key={`${item.produto.idproduto}-${idx}`} className="border-t border-gray-100 hover:bg-gray-50">
                              <td className="px-3 py-2 text-gray-500"> </td>
                              <td className="px-3 py-2 text-gray-500"> </td>
                              <td className="px-3 py-2">
                                {(item.produto.cor || "-").trim()}-{(item.produto.tamanho || "-").trim()}
                              </td>
                              <td className="px-3 py-2 text-right">{formatNum(item.estoques.estoque_atual)}</td>
                              <td className="px-3 py-2 text-right">{formatNum(item.estoques.em_processo)}</td>
                              <td className="px-3 py-2 text-right">{formatNum(item.estoques.estoque_minimo)}</td>
                              <td className="px-3 py-2 text-right">{formatNum(item.demanda.pedidos_pendentes)}</td>
                              <td className="px-3 py-2 text-right font-semibold">{formatNum(item.planejamento.necessidade_producao)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  ))}
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

