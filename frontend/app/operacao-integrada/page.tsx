'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Sidebar from '../components/Sidebar';
import { authHeaders } from '../lib/auth';
import { fetchNoCache, apiErrorMessage } from '../lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Paleta categórica escura validada (scripts/validate_palette.js do skill de
// dataviz, --mode dark, surface #1a1a19) — ordem preservada de propósito: a
// ordem É o mecanismo de segurança contra daltonismo, reordenar quebra isso.
const COR_CARTEIRA = '#3987e5';   // slot 1 blue
const COR_ESTOQUE = '#d95926';    // slot 2 orange
const COR_PRODUCAO = '#199e70';   // slot 3 aqua
const COR_PLANO_MA_PX = '#c98500'; // slot 4 yellow
const COR_UL = '#d55181';         // slot 5 magenta
const COR_FORA_HORIZONTE = '#008300'; // slot 6 green

type OfertaFonte = { cacheTimestamp: number; ageHours: number; fresh?: boolean } | null;

type Macro = {
  success: boolean;
  carteira: { pecasPendentes: number; skus: number; pedidos: number };
  oferta: {
    estoqueDisponivel: number;
    producaoEmAndamento: number;
    planoMaPx: number;
    planoUl: number;
    planoForaHorizonte: number;
    fonte: OfertaFonte;
  };
  disponibilidadeComercial: { pecas: number; skus: number; nota: string };
  limitacoes: { cacheMatrizIndisponivel: boolean; skusCarteiraSemDadoDeOferta: number; pecasCarteiraSemDadoDeOferta: number };
  atendimentoPrevisto: null;
  mvGeo3Atualizacao: { disponivel: boolean; atualizadoEm?: string; motivo?: string; fonte?: string };
  error?: string;
};

type Lote = {
  cdLote: string;
  semLote: boolean;
  formatoReconhecido: boolean | null;
  skus: number;
  pedidos: number;
  pecasPendentes: number;
  estoqueDisponivel: number;
  producaoEmAndamento: number;
  planoMaPx: number;
  planoUl: number;
  planoForaHorizonte: number;
  skusSemOferta: number;
};

type LotesResp = {
  success: boolean;
  lotes: Lote[];
  criterioOrdenacao: string;
  avisoPrioridade: string;
  error?: string;
};

type ItemPedido = { cdProduto: string; qtPendente: number; qtSolicitada: number; qtAtendida: number; dtPrevbaixa: string | null };
type Pedido = {
  cdPedido: string;
  cdCliente: string;
  cdLote: string;
  nrPrioridade: number | null;
  dtPedido: string | null;
  tpSituacao: number;
  itens: ItemPedido[];
};

function fmt(v: number | null | undefined) {
  return Number(v || 0).toLocaleString('pt-BR');
}

function fmtData(v: string | null | undefined) {
  if (!v) return '-';
  return new Date(v).toLocaleDateString('pt-BR');
}

function fmtHoras(v: number | null | undefined) {
  if (v === null || v === undefined) return '-';
  if (v < 1) return `${Math.round(v * 60)}min`;
  if (v < 48) return `${v.toFixed(1)}h`;
  return `${(v / 24).toFixed(1)}d`;
}

function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-sm shadow-lg shadow-black/20 ${className}`}
    >
      {children}
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'warning' | 'critical' | 'neutral' | 'info' }) {
  const classes: Record<string, string> = {
    warning: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
    critical: 'text-red-300 bg-red-500/10 border-red-500/30',
    neutral: 'text-slate-300 bg-white/5 border-white/10',
    info: 'text-sky-300 bg-sky-500/10 border-sky-500/30',
  };
  return <span className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-full border px-2 py-0.5 ${classes[tone]}`}>{children}</span>;
}

/** Barra horizontal única de uma fonte — comprimento relativo ao maior valor do grupo.
 * NÃO é uma barra empilhada/consumida: cada segmento é independente, oferta bruta. */
function BarraFonte({ label, valor, max, cor, sufixo }: { label: string; valor: number; max: number; cor: string; sufixo?: string }) {
  const pct = max > 0 ? Math.max(2, (valor / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-32 shrink-0 text-xs text-slate-400">{label}</div>
      <div className="flex-1 h-7 rounded-md bg-white/5 overflow-hidden relative">
        <div
          className="h-full rounded-md transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%`, background: cor }}
        />
      </div>
      <div className="w-28 shrink-0 text-right text-sm font-semibold text-white tabular-nums">
        {fmt(valor)}{sufixo || ''}
      </div>
    </div>
  );
}

function StatTile({ label, value, tone = 'neutral', hint }: { label: string; value: string; tone?: 'neutral' | 'info' | 'warning' | 'critical'; hint?: string }) {
  const toneClasses: Record<string, string> = {
    neutral: 'text-white',
    info: 'text-sky-300',
    warning: 'text-amber-300',
    critical: 'text-red-300',
  };
  return (
    <GlassCard className="p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${toneClasses[tone]}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
    </GlassCard>
  );
}

function OperacaoIntegradaInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const nivel = (searchParams.get('nivel') || 'macro') as 'macro' | 'lotes' | 'pedidos';
  const loteSelecionado = searchParams.get('lote') || '';

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [macro, setMacro] = useState<Macro | null>(null);
  const [lotesResp, setLotesResp] = useState<LotesResp | null>(null);
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingLote, setLoadingLote] = useState(false);
  const [error, setError] = useState('');

  function navegar(params: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(params)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.push(`${pathname}?${next.toString()}`);
  }

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    setError('');
    Promise.all([
      fetchNoCache(`${API_URL}/api/producao/carteira/macro`, { headers: authHeaders() }).then((r) => r.json()),
      fetchNoCache(`${API_URL}/api/producao/carteira/lotes`, { headers: authHeaders() }).then((r) => r.json()),
    ])
      .then(([macroData, lotesData]) => {
        if (cancelado) return;
        if (!macroData.success) throw new Error(apiErrorMessage(macroData, 'Erro ao carregar visão macro'));
        if (!lotesData.success) throw new Error(apiErrorMessage(lotesData, 'Erro ao carregar lotes'));
        setMacro(macroData);
        setLotesResp(lotesData);
      })
      .catch((e) => !cancelado && setError(e instanceof Error ? e.message : 'Erro ao carregar dados'))
      .finally(() => !cancelado && setLoading(false));
    return () => { cancelado = true; };
  }, []);

  useEffect(() => {
    if (nivel !== 'pedidos' || !loteSelecionado) { setPedidos(null); return; }
    let cancelado = false;
    setLoadingLote(true);
    fetchNoCache(`${API_URL}/api/producao/carteira/lotes/${encodeURIComponent(loteSelecionado)}/pedidos`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (cancelado) return;
        if (!data.success) throw new Error(apiErrorMessage(data, 'Erro ao carregar pedidos do lote'));
        setPedidos(data.pedidos);
      })
      .catch((e) => !cancelado && setError(e instanceof Error ? e.message : 'Erro ao carregar pedidos'))
      .finally(() => !cancelado && setLoadingLote(false));
    return () => { cancelado = true; };
  }, [nivel, loteSelecionado]);

  const maxOferta = useMemo(() => {
    if (!macro) return 1;
    return Math.max(
      macro.carteira.pecasPendentes,
      macro.oferta.estoqueDisponivel,
      macro.oferta.producaoEmAndamento,
      macro.oferta.planoMaPx,
      macro.oferta.planoUl,
      macro.oferta.planoForaHorizonte,
      1
    );
  }, [macro]);

  const lotes = lotesResp?.lotes || [];
  const pedidoAbertoDoLote = useMemo(() => pedidos?.find((p) => p.cdPedido === searchParams.get('pedido')) || null, [pedidos, searchParams]);

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  return (
    <div className="flex min-h-screen bg-[#0b0b0d]">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 min-w-0 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="px-6 py-4 border-b border-white/10 bg-gradient-to-r from-[#121216] to-[#0b0b0d]">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h1 className="text-white font-bold tracking-wide text-lg">Operação Integrada</h1>
              <p className="text-slate-400 text-xs">Plano · Venda · Produção · Atendimento — a carteira de pedidos como demanda central</p>
            </div>
            <nav className="flex items-center gap-1 text-xs">
              {[
                { key: 'macro', label: 'Macro' },
                { key: 'lotes', label: 'Lotes' },
                ...(nivel === 'pedidos' ? [{ key: 'pedidos', label: `Lote ${loteSelecionado}` }] : []),
              ].map((item, i, arr) => (
                <span key={item.key} className="flex items-center gap-1">
                  <button
                    onClick={() => navegar(item.key === 'macro' ? { nivel: null, lote: null, pedido: null } : { nivel: 'lotes', lote: item.key === 'lotes' ? null : loteSelecionado, pedido: null })}
                    className={`px-2.5 py-1 rounded-md ${nivel === item.key ? 'bg-white/10 text-white font-semibold' : 'text-slate-400 hover:text-white'}`}
                  >
                    {item.label}
                  </button>
                  {i < arr.length - 1 && <span className="text-slate-600">/</span>}
                </span>
              ))}
            </nav>
          </div>
        </header>

        <main className="flex-1 min-w-0 px-6 py-5 space-y-4">
          {error && (
            <GlassCard className="p-3 border-red-500/30 bg-red-500/10">
              <span className="text-sm text-red-300">{error}</span>
            </GlassCard>
          )}

          {loading && (
            <GlassCard className="p-6 text-center text-sm text-slate-400">Carregando operação integrada...</GlassCard>
          )}

          {!loading && !error && nivel === 'macro' && macro && (
            <MacroView macro={macro} maxOferta={maxOferta} onVerLotes={() => navegar({ nivel: 'lotes' })} />
          )}

          {!loading && !error && nivel === 'lotes' && (
            <LotesView
              lotesResp={lotesResp}
              onAbrirLote={(cdLote) => navegar({ nivel: 'pedidos', lote: cdLote, pedido: null })}
            />
          )}

          {!loading && !error && nivel === 'pedidos' && (
            <PedidosView
              cdLote={loteSelecionado}
              pedidos={pedidos}
              loading={loadingLote}
              pedidoAberto={pedidoAbertoDoLote}
              onAbrirPedido={(cdPedido) => navegar({ pedido: cdPedido })}
              onFecharPedido={() => navegar({ pedido: null })}
              onVoltar={() => navegar({ nivel: 'lotes', lote: null, pedido: null })}
            />
          )}

          {!loading && !error && nivel !== 'macro' && !lotesResp && (
            <GlassCard className="p-6 text-center text-sm text-slate-400">Sem dados de lotes carregados.</GlassCard>
          )}
        </main>
      </div>
    </div>
  );
}

function MacroView({ macro, maxOferta, onVerLotes }: { macro: Macro; maxOferta: number; onVerLotes: () => void }) {
  const fonte = macro.oferta.fonte;
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Carteira pendente" value={fmt(macro.carteira.pecasPendentes)} tone="info" hint={`${fmt(macro.carteira.skus)} SKUs · ${fmt(macro.carteira.pedidos)} pedidos`} />
        <StatTile label="Estoque disponível" value={fmt(macro.oferta.estoqueDisponivel)} hint="físico, bruto" />
        <StatTile label="Produção em andamento" value={fmt(macro.oferta.producaoEmAndamento)} hint="OPs abertas" />
        <StatTile
          label="Disponibilidade comercial (GEO)"
          value={fmt(macro.disponibilidadeComercial.pecas)}
          tone="info"
          hint={macro.mvGeo3Atualizacao.disponivel ? `mv_geo3 atualizada ${macro.mvGeo3Atualizacao.atualizadoEm}` : 'atualização desconhecida neste ambiente'}
        />
      </div>

      <GlassCard className="p-5">
        <div className="flex items-start justify-between flex-wrap gap-2 mb-4">
          <div>
            <div className="text-sm font-bold text-white">Macro da Demanda — Composição da Oferta</div>
            <div className="text-xs text-slate-400">Pedidos → Estoque → Produção → Plano MA/PX → UL → Fora do horizonte GEO</div>
          </div>
          <Badge tone="warning">Oferta bruta — alocação por SKU chega na Entrega 2</Badge>
        </div>
        <div className="space-y-3">
          <BarraFonte label="Carteira pendente" valor={macro.carteira.pecasPendentes} max={maxOferta} cor={COR_CARTEIRA} />
          <BarraFonte label="Estoque" valor={macro.oferta.estoqueDisponivel} max={maxOferta} cor={COR_ESTOQUE} />
          <BarraFonte label="Produção" valor={macro.oferta.producaoEmAndamento} max={maxOferta} cor={COR_PRODUCAO} />
          <BarraFonte label="Plano MA/PX" valor={macro.oferta.planoMaPx} max={maxOferta} cor={COR_PLANO_MA_PX} />
          <BarraFonte label="UL" valor={macro.oferta.planoUl} max={maxOferta} cor={COR_UL} />
          <BarraFonte label="Fora do horizonte" valor={macro.oferta.planoForaHorizonte} max={maxOferta} cor={COR_FORA_HORIZONTE} />
        </div>
        <p className="text-[11px] text-slate-500 mt-4 leading-relaxed">
          Cada barra é o total bruto daquela fonte entre os SKUs com pedido pendente — não uma alocação. Uma peça de estoque de um SKU não cobre a falta de outro;
          o confronto real SKU a SKU (quem atende o quê, respeitando a fila de lotes) é a Entrega 2.
          {fonte && <> Fonte do estoque/plano: cache da matriz oficial, atualizado há {fmtHoras(fonte.ageHours)}.</>}
        </p>
      </GlassCard>

      <div className="grid md:grid-cols-2 gap-3">
        <GlassCard className="p-4">
          <div className="text-sm font-bold text-white mb-2">Limitações desta leitura</div>
          <ul className="text-xs text-slate-400 space-y-1.5">
            <li>
              <Badge tone={macro.limitacoes.cacheMatrizIndisponivel ? 'critical' : 'neutral'}>
                {macro.limitacoes.cacheMatrizIndisponivel ? 'cache indisponível' : 'ok'}
              </Badge>{' '}
              cache da matriz oficial (estoque/plano)
            </li>
            <li>
              <Badge tone={macro.limitacoes.skusCarteiraSemDadoDeOferta > 0 ? 'warning' : 'neutral'}>
                {fmt(macro.limitacoes.skusCarteiraSemDadoDeOferta)} SKUs
              </Badge>{' '}
              da carteira ({fmt(macro.limitacoes.pecasCarteiraSemDadoDeOferta)} peças) sem dado de oferta — fora do catálogo filtrado pela matriz
            </li>
            <li>
              <Badge tone="info">{fmt(macro.disponibilidadeComercial.skus)} SKUs</Badge> com disponibilidade comercial (mv_geo3) — {macro.disponibilidadeComercial.nota}
            </li>
            <li><Badge tone="neutral">pendente</Badge> atendimento previsto / % cobertura — calculado na Entrega 2, nunca por divisão de totais</li>
          </ul>
        </GlassCard>
        <GlassCard className="p-4 flex flex-col justify-between">
          <div>
            <div className="text-sm font-bold text-white mb-2">Fila de atendimento por lote</div>
            <p className="text-xs text-slate-400">Carteira agrupada por lote comercial (ex: 26.11.2), ordenada cronologicamente. A prioridade oficial (nr_prioridade) ainda não foi validada.</p>
          </div>
          <button onClick={onVerLotes} className="mt-3 self-start px-3 py-1.5 rounded-md bg-sky-500/20 text-sky-300 text-xs font-semibold hover:bg-sky-500/30 transition-colors">
            Ver lotes →
          </button>
        </GlassCard>
      </div>
    </>
  );
}

function LotesView({ lotesResp, onAbrirLote }: { lotesResp: LotesResp | null; onAbrirLote: (cdLote: string) => void }) {
  if (!lotesResp) return null;
  const lotes = lotesResp.lotes;
  return (
    <GlassCard className="overflow-hidden">
      <div className="p-4 border-b border-white/10 flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-sm font-bold text-white">Lotes comerciais</div>
          <div className="text-xs text-slate-400">{fmt(lotes.length)} lotes · ordenação: cronológica por cd_lote</div>
        </div>
        <Badge tone="warning">{lotesResp.avisoPrioridade}</Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 border-b border-white/10">
              <th className="py-2 px-3">Lote</th>
              <th className="py-2 px-3 text-right">Pedidos</th>
              <th className="py-2 px-3 text-right">SKUs</th>
              <th className="py-2 px-3 text-right">Peças pendentes</th>
              <th className="py-2 px-3 text-right">Estoque</th>
              <th className="py-2 px-3 text-right">Produção</th>
              <th className="py-2 px-3 text-right">Plano MA/PX</th>
              <th className="py-2 px-3 text-right">UL</th>
              <th className="py-2 px-3">Cobertura</th>
            </tr>
          </thead>
          <tbody>
            {lotes.map((l) => (
              <tr key={l.cdLote} className="border-b border-white/5 hover:bg-white/[0.03] cursor-pointer" onClick={() => onAbrirLote(l.cdLote)}>
                <td className="py-2 px-3 font-medium text-white">
                  {l.cdLote}
                  {l.semLote && <Badge tone="neutral">sem lote</Badge>}
                  {l.formatoReconhecido === false && <Badge tone="warning">formato antigo</Badge>}
                </td>
                <td className="py-2 px-3 text-right text-slate-300">{fmt(l.pedidos)}</td>
                <td className="py-2 px-3 text-right text-slate-300">{fmt(l.skus)}</td>
                <td className="py-2 px-3 text-right text-white font-semibold">{fmt(l.pecasPendentes)}</td>
                <td className="py-2 px-3 text-right text-slate-300">{fmt(l.estoqueDisponivel)}</td>
                <td className="py-2 px-3 text-right text-slate-300">{fmt(l.producaoEmAndamento)}</td>
                <td className="py-2 px-3 text-right text-slate-300">{fmt(l.planoMaPx)}</td>
                <td className="py-2 px-3 text-right text-slate-300">{fmt(l.planoUl)}</td>
                <td className="py-2 px-3"><Badge tone="neutral">pendente (Entrega 2)</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}

function PedidosView({
  cdLote, pedidos, loading, pedidoAberto, onAbrirPedido, onFecharPedido, onVoltar,
}: {
  cdLote: string;
  pedidos: Pedido[] | null;
  loading: boolean;
  pedidoAberto: Pedido | null;
  onAbrirPedido: (cdPedido: string) => void;
  onFecharPedido: () => void;
  onVoltar: () => void;
}) {
  return (
    <GlassCard className="overflow-hidden">
      <div className="p-4 border-b border-white/10 flex items-center justify-between flex-wrap gap-2">
        <div>
          <button onClick={onVoltar} className="text-xs text-slate-400 hover:text-white mb-1">← Lotes</button>
          <div className="text-sm font-bold text-white">Pedidos do lote {cdLote}</div>
          <div className="text-xs text-slate-400">{pedidos ? `${fmt(pedidos.length)} pedidos` : 'carregando...'}</div>
        </div>
      </div>

      {loading && <div className="p-6 text-center text-sm text-slate-400">Carregando pedidos...</div>}

      {!loading && pedidos && (
        <div className="overflow-x-auto max-h-[480px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#121216]">
              <tr className="text-left text-slate-500 border-b border-white/10">
                <th className="py-2 px-3">Pedido</th>
                <th className="py-2 px-3">Cliente</th>
                <th className="py-2 px-3">Data</th>
                <th className="py-2 px-3 text-right">Prioridade (ERP)</th>
                <th className="py-2 px-3 text-right">Itens</th>
                <th className="py-2 px-3 text-right">Peças pendentes</th>
              </tr>
            </thead>
            <tbody>
              {pedidos.slice(0, 300).map((p) => {
                const pecas = p.itens.reduce((s, i) => s + i.qtPendente, 0);
                return (
                  <tr key={p.cdPedido} className="border-b border-white/5 hover:bg-white/[0.03] cursor-pointer" onClick={() => onAbrirPedido(p.cdPedido)}>
                    <td className="py-2 px-3 font-medium text-white">{p.cdPedido}</td>
                    <td className="py-2 px-3 text-slate-300">{p.cdCliente}</td>
                    <td className="py-2 px-3 text-slate-300">{fmtData(p.dtPedido)}</td>
                    <td className="py-2 px-3 text-right text-slate-300">{p.nrPrioridade ?? '-'}</td>
                    <td className="py-2 px-3 text-right text-slate-300">{p.itens.length}</td>
                    <td className="py-2 px-3 text-right text-white font-semibold">{fmt(pecas)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pedidos.length > 300 && <p className="text-[11px] text-slate-500 p-3">Exibindo os primeiros 300 de {fmt(pedidos.length)} pedidos.</p>}
        </div>
      )}

      {pedidoAberto && (
        <div className="border-t border-white/10 p-4 bg-black/20">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-bold text-white">Itens do pedido {pedidoAberto.cdPedido}</div>
            <button onClick={onFecharPedido} className="text-xs text-slate-400 hover:text-white">fechar ✕</button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b border-white/10">
                <th className="py-1.5 px-2">SKU</th>
                <th className="py-1.5 px-2 text-right">Solicitado</th>
                <th className="py-1.5 px-2 text-right">Atendido (ERP)</th>
                <th className="py-1.5 px-2 text-right">Pendente</th>
                <th className="py-1.5 px-2">Prev. baixa</th>
              </tr>
            </thead>
            <tbody>
              {pedidoAberto.itens.map((it) => (
                <tr key={it.cdProduto} className="border-b border-white/5">
                  <td className="py-1.5 px-2 text-white">{it.cdProduto}</td>
                  <td className="py-1.5 px-2 text-right text-slate-300">{fmt(it.qtSolicitada)}</td>
                  <td className="py-1.5 px-2 text-right text-slate-300">{fmt(it.qtAtendida)}</td>
                  <td className="py-1.5 px-2 text-right text-white font-semibold">{fmt(it.qtPendente)}</td>
                  <td className="py-1.5 px-2 text-slate-300">{fmtData(it.dtPrevbaixa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GlassCard>
  );
}

export default function OperacaoIntegradaPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0b0b0d]" />}>
      <OperacaoIntegradaInner />
    </Suspense>
  );
}
