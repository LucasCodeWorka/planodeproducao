'use client';

import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine, ResponsiveContainer } from 'recharts';
import Sidebar from '../components/Sidebar';
import { authHeaders } from '../lib/auth';
import { fetchNoCache, apiErrorMessage } from '../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Mesma paleta de status já usada no resto do app (recuperar-negativos, curvaClass),
// com o amber recalibrado para #f59e0b: validado com scripts/validate_palette.js do
// skill de dataviz — amber-600 (#d97706) e red-600 (#dc2626) ficam indistinguíveis
// mesmo para visão normal (ΔE 14.4, abaixo do piso de 15).
const COR_OK = '#059669';      // emerald-600
const COR_CRITICO = '#dc2626'; // red-600

type OfertaPorPeriodo = Record<string, number>;

type OpAberta = {
  nr_op: string;
  nr_ciclo: string;
  dt_preventrega: string | null;
  dt_inclusao: string | null;
  qt_aberta: number;
  vencida: boolean;
};

type PedidoAlocado = {
  cd_pedido: string;
  cd_produto: string;
  cd_cliente: string;
  cd_lote: string | null;
  qt_pendente: number;
  alocadoPorPeriodo: Record<string, number>;
  qtd_alocada: number;
  qtd_nao_atendida: number;
};

type SaldoPeriodo = {
  mes: number;
  plano: number;
  projecao: number;
  saldo: number;
  negativo: number;
};

type Causa = {
  categoria: string;
  detalhe: Record<string, unknown>;
};

type Produto = {
  idproduto: string;
  referencia: string;
  produto: string;
  cor: string;
  tamanho: string;
  status: string;
  continuidade: string;
} | null;

type Historia = {
  success: boolean;
  idproduto: string;
  produto: Produto;
  estoqueDisponivel: number;
  ofertaPorPeriodo: OfertaPorPeriodo;
  ops: { itens: OpAberta[]; totalAberto: number; totalVencido: number };
  pedidos: { total: number; pendentes: number; qtdPendenteTotal: number; itens: PedidoAlocado[] };
  saldoProjetado: Record<string, SaldoPeriodo>;
  causas: Record<string, Causa>;
  error?: string;
};

const PERIODOS_SALDO = ['MA', 'PX', 'UL', 'QT', 'QU', 'SX'] as const;

const CATEGORIA_LABEL: Record<string, string> = {
  OP_ATRASADA: 'Produção atrasada',
  PEDIDO_CONCENTRADO_SEM_LASTRO: 'Pedido concentrado',
  PLANO_INSUFICIENTE: 'Plano insuficiente',
};

function fmt(v: number | null | undefined) {
  return Number(v || 0).toLocaleString('pt-BR');
}

function fmtData(v: string | null) {
  if (!v) return '-';
  return new Date(v).toLocaleDateString('pt-BR');
}

function StatTile({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'info' | 'atencao' | 'critico' | 'neutro' }) {
  const classes: Record<string, string> = {
    ok: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    info: 'bg-blue-50 border-blue-200 text-blue-700',
    atencao: 'bg-amber-50 border-amber-200 text-amber-700',
    critico: 'bg-red-50 border-red-200 text-red-700',
    neutro: 'bg-white border-gray-200 text-gray-700',
  };
  return (
    <div className={`rounded-lg border p-3 ${classes[tone]}`}>
      <div className="text-xs opacity-80">{label}</div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}

function StatusPill({ qtdAlocada, qtdNaoAtendida }: { qtdAlocada: number; qtdNaoAtendida: number }) {
  if (qtdNaoAtendida <= 0) {
    return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">Atendido</span>;
  }
  if (qtdAlocada > 0) {
    return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">⚠ Parcial</span>;
  }
  return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">✕ Não atendido</span>;
}

export default function HistoriaProdutoPage() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [idInput, setIdInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [historia, setHistoria] = useState<Historia | null>(null);

  async function buscar(idproduto: string) {
    const id = idproduto.trim();
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetchNoCache(`${API_URL}/api/producao/historia-produto?idproduto=${encodeURIComponent(id)}`, { headers: authHeaders() });
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(apiErrorMessage(payload, 'Erro ao buscar história do produto'));
      }
      setHistoria(payload);
    } catch (e) {
      setHistoria(null);
      setError(e instanceof Error ? e.message : 'Erro ao buscar história do produto');
    } finally {
      setLoading(false);
    }
  }

  const chartData = useMemo(() => {
    if (!historia) return [];
    return PERIODOS_SALDO.map((periodo) => {
      const dados = historia.saldoProjetado[periodo];
      return {
        periodo,
        saldo: dados ? Number(dados.saldo.toFixed(0)) : 0,
        plano: dados?.plano || 0,
        projecao: dados ? Number(dados.projecao.toFixed(0)) : 0,
        negativo: dados?.negativo || 0,
        causa: historia.causas[periodo]?.categoria || null,
      };
    });
  }, [historia]);

  const pedidosOrdenados = useMemo(() => {
    if (!historia) return [];
    // Não atendidos primeiro (é o que importa olhar), depois por cd_lote (já vem
    // ordenado do backend, mas o filtro por status pode embaralhar a ordem visual).
    return [...historia.pedidos.itens].sort((a, b) => {
      if (a.qtd_nao_atendida !== b.qtd_nao_atendida) return b.qtd_nao_atendida - a.qtd_nao_atendida;
      return 0;
    });
  }, [historia]);

  const disponivel90d = historia
    ? ['HOJE', 'MA', 'PX', 'UL'].reduce((s, p) => s + Number(historia.ofertaPorPeriodo[p] || 0), 0)
    : 0;

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 min-w-0 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="bg-brand-primary shadow-sm px-6 py-3">
          <h1 className="text-white font-bold font-secondary tracking-wide text-base">HISTÓRIA DO PRODUTO</h1>
          <p className="text-white/70 text-xs">Do plano à fila de pedidos: o que tem, o que falta, e por quê</p>
        </header>

        <main className="flex-1 min-w-0 px-6 py-5 space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-600">Código do produto (SKU)</span>
              <input
                value={idInput}
                onChange={(e) => setIdInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') buscar(idInput); }}
                placeholder="ex: 32582"
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-48"
              />
            </label>
            <button
              type="button"
              onClick={() => buscar(idInput)}
              disabled={loading || !idInput.trim()}
              className="px-3 h-8 text-xs font-semibold text-white bg-brand-primary rounded disabled:opacity-50"
            >
              {loading ? 'Buscando...' : 'Buscar'}
            </button>
          </div>

          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>}
          {loading && <div className="bg-white rounded-lg border p-4 text-sm text-gray-500">Carregando...</div>}

          {historia && (
            <>
              <div className="bg-white rounded-lg border border-gray-200 p-3">
                <div className="text-sm font-bold text-gray-800">
                  {historia.produto?.referencia || historia.idproduto} — {historia.produto?.produto || 'Produto não encontrado no catálogo'}
                </div>
                <div className="text-xs text-gray-500">
                  {historia.produto ? `${historia.produto.cor} · ${historia.produto.tamanho} · ${historia.produto.status} · ${historia.produto.continuidade} · SKU ${historia.idproduto}` : `SKU ${historia.idproduto}`}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <StatTile label="Estoque + processo (hoje)" value={fmt(historia.estoqueDisponivel)} tone="info" />
                <StatTile label="Disponível em 90 dias" value={fmt(disponivel90d)} tone="info" />
                <StatTile
                  label="OPs abertas"
                  value={fmt(historia.ops.totalAberto)}
                  tone={historia.ops.totalVencido > 0 ? 'critico' : 'ok'}
                />
                <StatTile label="Pedidos na fila" value={fmt(historia.pedidos.pendentes)} tone="neutro" />
                <StatTile label="Peças pendentes" value={fmt(historia.pedidos.qtdPendenteTotal)} tone="neutro" />
                <StatTile
                  label="Períodos negativos"
                  value={fmt(Object.keys(historia.causas).length)}
                  tone={Object.keys(historia.causas).length > 0 ? 'critico' : 'ok'}
                />
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <div className="text-sm font-bold text-gray-800">Saldo projetado por período</div>
                    <div className="text-xs text-gray-500">Estoque + plano − projeção de venda, mês a mês (MA = mês atual)</div>
                  </div>
                  <div className="flex gap-3 text-[11px]">
                    <span className="inline-flex items-center gap-1 text-gray-600"><span className="w-2 h-2 rounded-full" style={{ background: COR_OK }} />Saldo ok</span>
                    <span className="inline-flex items-center gap-1 text-gray-600"><span className="w-2 h-2 rounded-full" style={{ background: COR_CRITICO }} />Negativo</span>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 10, right: 16, left: 8, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="periodo" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                    <ReferenceLine y={0} stroke="#9ca3af" />
                    <Tooltip
                      contentStyle={{ fontSize: 11, backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 }}
                      formatter={(value, name) => (name === 'saldo' ? [fmt(Number(value)), 'Saldo projetado'] : [fmt(Number(value)), name])}
                      labelFormatter={(label, payload) => {
                        const causa = payload?.[0]?.payload?.causa;
                        return causa ? `${label} — ${CATEGORIA_LABEL[causa] || causa}` : String(label);
                      }}
                    />
                    <Bar dataKey="saldo" radius={[4, 4, 4, 4]} maxBarSize={48}>
                      {chartData.map((row) => (
                        <Cell key={row.periodo} fill={row.saldo < 0 ? COR_CRITICO : COR_OK} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {Object.keys(historia.causas).length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
                  <div className="text-xs font-bold text-red-700">Causa provável do saldo negativo</div>
                  {Object.entries(historia.causas).map(([periodo, causa]) => (
                    <div key={periodo} className="text-xs text-red-700 flex flex-wrap items-baseline gap-1">
                      <span className="font-semibold">{periodo}:</span>
                      <span>{CATEGORIA_LABEL[causa.categoria] || causa.categoria}</span>
                      <span className="text-red-500">— {JSON.stringify(causa.detalhe)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="text-sm font-bold text-gray-800 mb-2">Produção em aberto (OPs)</div>
                {historia.ops.itens.length === 0 ? (
                  <div className="text-xs text-gray-500">Nenhuma OP aberta para este produto.</div>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500 border-b border-gray-200">
                        <th className="py-1 pr-2">OP</th>
                        <th className="py-1 pr-2">Incluída em</th>
                        <th className="py-1 pr-2">Prev. entrega</th>
                        <th className="py-1 pr-2 text-right">Qtd aberta</th>
                        <th className="py-1 pr-2">Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historia.ops.itens.map((op) => (
                        <tr key={`${op.nr_op}-${op.nr_ciclo}`} className="border-b border-gray-100">
                          <td className="py-1 pr-2 font-medium">{op.nr_op}</td>
                          <td className="py-1 pr-2 text-gray-600">{fmtData(op.dt_inclusao)}</td>
                          <td className="py-1 pr-2 text-gray-600">{fmtData(op.dt_preventrega)}</td>
                          <td className="py-1 pr-2 text-right">{fmt(op.qt_aberta)}</td>
                          <td className="py-1 pr-2">
                            {op.vencida
                              ? <span className="text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">Atrasada</span>
                              : <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">Em produção</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <div className="text-sm font-bold text-gray-800">Fila de pedidos, por lote</div>
                  <div className="text-xs text-gray-500">{fmt(pedidosOrdenados.length)} pedidos · ordenados por cd_lote (mais antigo primeiro), não atendidos no topo</div>
                </div>
                {pedidosOrdenados.length === 0 ? (
                  <div className="text-xs text-gray-500">Nenhum pedido pendente para este produto.</div>
                ) : (
                  <div className="overflow-auto max-h-[420px]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-white">
                        <tr className="text-left text-gray-500 border-b border-gray-200">
                          <th className="py-1 pr-2">Pedido</th>
                          <th className="py-1 pr-2">Cliente</th>
                          <th className="py-1 pr-2">Lote</th>
                          <th className="py-1 pr-2 text-right">Pendente</th>
                          <th className="py-1 pr-2 text-right">Alocado</th>
                          <th className="py-1 pr-2 text-right">Não atendido</th>
                          <th className="py-1 pr-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pedidosOrdenados.slice(0, 200).map((p) => (
                          <tr key={p.cd_pedido} className="border-b border-gray-100">
                            <td className="py-1 pr-2 font-medium">{p.cd_pedido}</td>
                            <td className="py-1 pr-2 text-gray-600">{p.cd_cliente}</td>
                            <td className="py-1 pr-2 text-gray-600">{p.cd_lote || <span className="text-gray-400">sem lote</span>}</td>
                            <td className="py-1 pr-2 text-right">{fmt(p.qt_pendente)}</td>
                            <td className="py-1 pr-2 text-right">{fmt(p.qtd_alocada)}</td>
                            <td className="py-1 pr-2 text-right">{p.qtd_nao_atendida > 0 ? fmt(p.qtd_nao_atendida) : '-'}</td>
                            <td className="py-1 pr-2"><StatusPill qtdAlocada={p.qtd_alocada} qtdNaoAtendida={p.qtd_nao_atendida} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {pedidosOrdenados.length > 200 && (
                      <p className="text-[11px] text-gray-400 pt-2">Exibindo os primeiros 200 de {fmt(pedidosOrdenados.length)} pedidos.</p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {!historia && !loading && !error && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700">
              Digite o código de um produto (SKU) para ver a história completa: estoque, produção, fila de pedidos e causa de eventual negativo.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
