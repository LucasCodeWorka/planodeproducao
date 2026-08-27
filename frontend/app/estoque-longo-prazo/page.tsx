'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Boxes,
  Factory,
  Filter,
  LineChart as LineChartIcon,
  RefreshCcw,
  Search,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import Sidebar from '../components/Sidebar';
import { authHeaders, getToken } from '../lib/auth';
import { fetchNoCache } from '../lib/api';
import type { PeriodosPlano, Planejamento, ProjecoesMap } from '../types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MESES_PT = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const HORIZONTES = ['MA', 'PX', 'UL', 'QT', 'QU', 'SX'] as const;
type Horizonte = typeof HORIZONTES[number];
type AgruparPor = 'continuidade' | 'linha' | 'grupo' | 'referencia';
type StatusRisco = 'ruptura' | 'baixo' | 'ok' | 'excesso';

type CapacidadeGrupo = {
  grupo: string;
  saldoMA: number;
  saldoPX: number;
  saldoUL: number;
  saldoQT: number;
  saldoQU: number;
  saldoSX: number;
  atendimentoMA: number;
  atendimentoPX: number;
  atendimentoUL: number;
  atendimentoQT: number;
  atendimentoQU: number;
  atendimentoSX: number;
};

type MesCalc = {
  key: Horizonte;
  mes: number;
  label: string;
  projecao: number;
  plano: number;
  estoqueFinal: number;
  cobertura: number | null;
};

type ProdutoCalc = {
  idproduto: string;
  referencia: string;
  produto: string;
  continuidade: string;
  linha: string;
  grupo: string;
  estoqueAtual: number;
  pedidos: number;
  emProcesso: number;
  estoqueMinimo: number;
  meses: MesCalc[];
  menorEstoque: number;
  menorCobertura: number | null;
  status: StatusRisco;
};

type GrupoCalc = {
  chave: string;
  itens: number;
  estoqueAtual: number;
  pedidos: number;
  emProcesso: number;
  estoqueMinimo: number;
  meses: MesCalc[];
  menorEstoque: number;
  menorCobertura: number | null;
  rupturas: number;
  status: StatusRisco;
};

function fmt(n: number, digits = 0) {
  return Number(n || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function mesNorm(mes: number) {
  const m = Number(mes || 1);
  return ((m - 1) % 12) + 1;
}

function addMes(base: number, offset: number) {
  return mesNorm(Number(base || 1) + offset);
}

function statusPor(estoque: number, cobertura: number | null): StatusRisco {
  if (estoque < 0) return 'ruptura';
  if (cobertura !== null && cobertura < 0.8) return 'baixo';
  if (cobertura !== null && cobertura > 3) return 'excesso';
  return 'ok';
}

function statusClass(status: StatusRisco) {
  if (status === 'ruptura') return 'bg-red-100 text-red-700 border-red-200';
  if (status === 'baixo') return 'bg-amber-100 text-amber-700 border-amber-200';
  if (status === 'excesso') return 'bg-blue-100 text-blue-700 border-blue-200';
  return 'bg-emerald-100 text-emerald-700 border-emerald-200';
}

function statusLabel(status: StatusRisco) {
  if (status === 'ruptura') return 'Ruptura';
  if (status === 'baixo') return 'Baixo';
  if (status === 'excesso') return 'Excesso';
  return 'OK';
}

export default function EstoqueLongoPrazoPage() {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [dados, setDados] = useState<Planejamento[]>([]);
  const [projecoes, setProjecoes] = useState<ProjecoesMap>({});
  const [periodos, setPeriodos] = useState<PeriodosPlano>({
    MA: new Date().getMonth() + 1,
    PX: new Date().getMonth() + 2,
    UL: new Date().getMonth() + 3,
    QT: new Date().getMonth() + 4,
    QU: new Date().getMonth() + 5,
  });
  const [capacidade, setCapacidade] = useState<CapacidadeGrupo[]>([]);
  const [agruparPor, setAgruparPor] = useState<AgruparPor>('continuidade');
  const [filtro, setFiltro] = useState('');
  const [statusFiltro, setStatusFiltro] = useState<'todos' | StatusRisco>('todos');
  const [projecaoPct, setProjecaoPct] = useState(0);
  const [planoPct, setPlanoPct] = useState(0);

  const ml = sidebarCollapsed ? 'ml-20' : 'ml-64';

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregar() {
    setLoading(true);
    setErro(null);
    try {
      const params = new URLSearchParams({ limit: '5000', marca: 'LIEBE', status: 'EM LINHA' });
      const [resMatriz, resProj, resCap] = await Promise.all([
        fetchNoCache(`${API_URL}/api/producao/matriz?${params}`),
        fetchNoCache(`${API_URL}/api/projecoes`, { headers: authHeaders() }),
        fetchNoCache(`${API_URL}/api/capacidade/matriz`, { headers: authHeaders() }),
      ]);

      const dataMatriz = await resMatriz.json();
      const dataProj = await resProj.json();
      const dataCap = await resCap.json();

      if (!resMatriz.ok || !dataMatriz.success) throw new Error(dataMatriz.error || 'Erro ao carregar matriz');
      if (!resProj.ok || !dataProj.success) throw new Error(dataProj.error || 'Erro ao carregar projecoes');
      if (!resCap.ok || !dataCap.success) throw new Error(dataCap.error || 'Erro ao carregar capacidade');

      setDados(Array.isArray(dataMatriz.data) ? dataMatriz.data : []);
      setProjecoes(dataProj.data || {});
      setPeriodos(dataProj.periodos || dataCap.periodos || periodos);
      setCapacidade(Array.isArray(dataCap.grupos) ? dataCap.grupos : []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar estoque longo prazo');
    } finally {
      setLoading(false);
    }
  }

  const mesesPlano = useMemo(() => {
    const ma = mesNorm(periodos.MA);
    const fallback = {
      MA: ma,
      PX: periodos.PX || addMes(ma, 1),
      UL: periodos.UL || addMes(ma, 2),
      QT: periodos.QT || addMes(ma, 3),
      QU: periodos.QU || addMes(ma, 4),
      SX: addMes(ma, 5),
    };

    return HORIZONTES.map((key, index) => ({
      key,
      mes: mesNorm(Number(fallback[key] || addMes(ma, index))),
      label: MESES_PT[mesNorm(Number(fallback[key] || addMes(ma, index)))],
    }));
  }, [periodos]);

  const produtosCalculados = useMemo<ProdutoCalc[]>(() => {
    const fatorProj = 1 + projecaoPct / 100;
    const fatorPlano = 1 + planoPct / 100;

    return dados.map((item) => {
      const proj = projecoes[String(item.produto.idproduto)] || {};
      const planos: Record<Horizonte, number> = {
        MA: Number(item.plano?.ma || 0) * fatorPlano,
        PX: Number(item.plano?.px || 0) * fatorPlano,
        UL: Number(item.plano?.ul || 0) * fatorPlano,
        QT: Number(item.plano?.qt || 0) * fatorPlano,
        QU: Number(item.plano?.qu || 0) * fatorPlano,
        SX: Number(item.plano?.sx || 0) * fatorPlano,
      };
      let estoque = Number(item.estoques?.estoque_atual || 0)
        - Number(item.demanda?.pedidos_pendentes || 0)
        + Number(item.estoques?.em_processo || 0);
      const estoqueMinimo = Number(item.estoques?.estoque_minimo || 0);

      const meses = mesesPlano.map(({ key, mes, label }) => {
        const projecao = Number(proj[String(mes)] || 0) * fatorProj;
        const plano = Number(planos[key] || 0);
        estoque = estoque + plano - projecao;
        return {
          key,
          mes,
          label,
          projecao,
          plano,
          estoqueFinal: estoque,
          cobertura: estoqueMinimo > 0 ? estoque / estoqueMinimo : null,
        };
      });

      const menorEstoque = Math.min(...meses.map((m) => m.estoqueFinal));
      const coberturas = meses.map((m) => m.cobertura).filter((v): v is number => v !== null);
      const menorCobertura = coberturas.length ? Math.min(...coberturas) : null;
      const status = statusPor(menorEstoque, menorCobertura);

      return {
        idproduto: String(item.produto.idproduto || ''),
        referencia: String(item.produto.referencia || ''),
        produto: String(item.produto.produto || item.produto.apresentacao || ''),
        continuidade: String(item.produto.continuidade || 'SEM CONTINUIDADE'),
        linha: String(item.produto.linha || 'SEM LINHA'),
        grupo: String(item.produto.grupo || 'SEM GRUPO'),
        estoqueAtual: Number(item.estoques?.estoque_atual || 0),
        pedidos: Number(item.demanda?.pedidos_pendentes || 0),
        emProcesso: Number(item.estoques?.em_processo || 0),
        estoqueMinimo,
        meses,
        menorEstoque,
        menorCobertura,
        status,
      };
    });
  }, [dados, projecoes, mesesPlano, projecaoPct, planoPct]);

  const grupos = useMemo<GrupoCalc[]>(() => {
    const mapa = new Map<string, GrupoCalc>();

    const chaveDe = (item: ProdutoCalc) => {
      if (agruparPor === 'linha') return item.linha;
      if (agruparPor === 'grupo') return item.grupo;
      if (agruparPor === 'referencia') return item.referencia || 'SEM REFERENCIA';
      return item.continuidade;
    };

    for (const item of produtosCalculados) {
      const chave = chaveDe(item) || 'SEM CLASSIFICACAO';
      if (!mapa.has(chave)) {
        mapa.set(chave, {
          chave,
          itens: 0,
          estoqueAtual: 0,
          pedidos: 0,
          emProcesso: 0,
          estoqueMinimo: 0,
          meses: mesesPlano.map((m) => ({ ...m, projecao: 0, plano: 0, estoqueFinal: 0, cobertura: null })),
          menorEstoque: 0,
          menorCobertura: null,
          rupturas: 0,
          status: 'ok',
        });
      }
      const grupo = mapa.get(chave)!;
      grupo.itens += 1;
      grupo.estoqueAtual += item.estoqueAtual;
      grupo.pedidos += item.pedidos;
      grupo.emProcesso += item.emProcesso;
      grupo.estoqueMinimo += item.estoqueMinimo;
      if (item.status === 'ruptura') grupo.rupturas += 1;

      item.meses.forEach((mes, idx) => {
        grupo.meses[idx].projecao += mes.projecao;
        grupo.meses[idx].plano += mes.plano;
        grupo.meses[idx].estoqueFinal += mes.estoqueFinal;
      });
    }

    return Array.from(mapa.values())
      .map((grupo) => {
        const meses = grupo.meses.map((mes) => ({
          ...mes,
          cobertura: grupo.estoqueMinimo > 0 ? mes.estoqueFinal / grupo.estoqueMinimo : null,
        }));
        const menorEstoque = Math.min(...meses.map((m) => m.estoqueFinal));
        const coberturas = meses.map((m) => m.cobertura).filter((v): v is number => v !== null);
        const menorCobertura = coberturas.length ? Math.min(...coberturas) : null;
        return {
          ...grupo,
          meses,
          menorEstoque,
          menorCobertura,
          status: statusPor(menorEstoque, menorCobertura),
        };
      })
      .sort((a, b) => {
        const ordem = { ruptura: 0, baixo: 1, ok: 2, excesso: 3 };
        return ordem[a.status] - ordem[b.status] || a.menorEstoque - b.menorEstoque;
      });
  }, [produtosCalculados, mesesPlano, agruparPor]);

  const gruposFiltrados = useMemo(() => {
    const termo = filtro.trim().toUpperCase();
    return grupos.filter((grupo) => {
      if (statusFiltro !== 'todos' && grupo.status !== statusFiltro) return false;
      if (termo && !grupo.chave.toUpperCase().includes(termo)) return false;
      return true;
    });
  }, [grupos, filtro, statusFiltro]);

  const resumo = useMemo(() => {
    const meses = mesesPlano.map((m, idx) => {
      const total = produtosCalculados.reduce((acc, item) => {
        acc.projecao += item.meses[idx]?.projecao || 0;
        acc.plano += item.meses[idx]?.plano || 0;
        acc.estoqueFinal += item.meses[idx]?.estoqueFinal || 0;
        return acc;
      }, { projecao: 0, plano: 0, estoqueFinal: 0 });
      const estoqueMinimo = produtosCalculados.reduce((acc, item) => acc + item.estoqueMinimo, 0);
      return {
        ...m,
        ...total,
        cobertura: estoqueMinimo > 0 ? total.estoqueFinal / estoqueMinimo : null,
        rupturas: produtosCalculados.filter((item) => (item.meses[idx]?.estoqueFinal || 0) < 0).length,
      };
    });

    const riscoRuptura = produtosCalculados.filter((p) => p.status === 'ruptura').length;
    const riscoBaixo = produtosCalculados.filter((p) => p.status === 'baixo').length;
    const excesso = produtosCalculados.filter((p) => p.status === 'excesso').length;
    const estoqueAtual = produtosCalculados.reduce((acc, p) => acc + p.estoqueAtual, 0);
    const emProcesso = produtosCalculados.reduce((acc, p) => acc + p.emProcesso, 0);
    const pedidos = produtosCalculados.reduce((acc, p) => acc + p.pedidos, 0);
    const estoqueMinimo = produtosCalculados.reduce((acc, p) => acc + p.estoqueMinimo, 0);
    const menorMes = [...meses].sort((a, b) => a.estoqueFinal - b.estoqueFinal)[0];

    return { meses, riscoRuptura, riscoBaixo, excesso, estoqueAtual, emProcesso, pedidos, estoqueMinimo, menorMes };
  }, [produtosCalculados, mesesPlano]);

  const capacidadeChart = useMemo(() => {
    const totalPor = (campo: keyof CapacidadeGrupo) => capacidade.reduce((acc, g) => acc + Number(g[campo] || 0), 0);
    return mesesPlano.map((m) => {
      const sufixo = m.key;
      const saldo = totalPor(`saldo${sufixo}` as keyof CapacidadeGrupo);
      const atendimento = capacidade.length
        ? capacidade.reduce((acc, g) => acc + Number(g[`atendimento${sufixo}` as keyof CapacidadeGrupo] || 0), 0) / capacidade.length
        : 0;
      return { mes: m.label, saldo, atendimento };
    });
  }, [capacidade, mesesPlano]);

  const produtosRisco = useMemo(() => {
    return produtosCalculados
      .filter((p) => p.status === 'ruptura' || p.status === 'baixo')
      .sort((a, b) => a.menorEstoque - b.menorEstoque)
      .slice(0, 80);
  }, [produtosCalculados]);

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar onCollapse={setSidebarCollapsed} />
      <div className={`flex-1 ${ml} transition-all duration-300 flex flex-col min-h-screen`}>
        <header className="bg-brand-primary shadow-sm px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-white font-bold font-secondary tracking-wide text-base">ESTOQUE LONGO PRAZO</h1>
            <p className="text-white/75 text-xs">Plano mestre: estoque futuro, demanda, plano e capacidade</p>
          </div>
          <button
            onClick={carregar}
            className="inline-flex items-center gap-2 rounded border border-white/30 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
          >
            <RefreshCcw size={14} />
            Atualizar
          </button>
        </header>

        <main className="flex-1 px-6 py-5 space-y-4">
          {erro && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>}

          <section className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <KpiCard icon={<Boxes size={18} />} label="Estoque fisico" value={fmt(resumo.estoqueAtual)} />
            <KpiCard icon={<Factory size={18} />} label="Em processo" value={fmt(resumo.emProcesso)} />
            <KpiCard icon={<AlertTriangle size={18} />} label="Pedidos" value={fmt(resumo.pedidos)} />
            <KpiCard icon={<AlertTriangle size={18} />} label="SKUs em ruptura" value={fmt(resumo.riscoRuptura)} danger={resumo.riscoRuptura > 0} />
            <KpiCard icon={<LineChartIcon size={18} />} label={`Menor mes (${resumo.menorMes?.label || '-'})`} value={fmt(resumo.menorMes?.estoqueFinal || 0)} danger={(resumo.menorMes?.estoqueFinal || 0) < 0} />
          </section>

          <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-gray-900">
              <Filter size={16} />
              Parametros
            </div>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
              <label className="text-xs text-gray-600">
                Agrupar por
                <select value={agruparPor} onChange={(e) => setAgruparPor(e.target.value as AgruparPor)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5">
                  <option value="continuidade">Continuidade</option>
                  <option value="linha">Linha</option>
                  <option value="grupo">Grupo produto</option>
                  <option value="referencia">Referencia</option>
                </select>
              </label>
              <label className="text-xs text-gray-600">
                Status
                <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value as 'todos' | StatusRisco)} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5">
                  <option value="todos">Todos</option>
                  <option value="ruptura">Ruptura</option>
                  <option value="baixo">Baixo</option>
                  <option value="ok">OK</option>
                  <option value="excesso">Excesso</option>
                </select>
              </label>
              <label className="text-xs text-gray-600">
                Ajuste venda (%)
                <input value={projecaoPct} onChange={(e) => setProjecaoPct(Number(e.target.value || 0))} type="number" className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5" />
              </label>
              <label className="text-xs text-gray-600">
                Ajuste plano (%)
                <input value={planoPct} onChange={(e) => setPlanoPct(Number(e.target.value || 0))} type="number" className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5" />
              </label>
              <label className="text-xs text-gray-600 md:col-span-2">
                Buscar grupo/referencia
                <div className="relative mt-1">
                  <Search size={14} className="absolute left-2 top-2 text-gray-400" />
                  <input value={filtro} onChange={(e) => setFiltro(e.target.value)} className="w-full rounded border border-gray-300 pl-8 pr-2 py-1.5" placeholder="Digite para filtrar..." />
                </div>
              </label>
            </div>
            <div className="mt-3 text-xs text-gray-500">
              Horizonte: {mesesPlano.map((m) => `${m.key}=${m.label}`).join(' | ')}
            </div>
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="text-sm font-semibold text-gray-900 mb-3">Evolucao estoque x plano x venda</div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={resumo.meses}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="label" fontSize={12} />
                    <YAxis fontSize={12} tickFormatter={(v) => fmt(Number(v))} />
                    <Tooltip formatter={(value) => fmt(Number(value || 0))} />
                    <Area type="monotone" dataKey="estoqueFinal" name="Estoque final" stroke="#0f766e" fill="#ccfbf1" />
                    <Area type="monotone" dataKey="plano" name="Plano" stroke="#2563eb" fill="#dbeafe" />
                    <Area type="monotone" dataKey="projecao" name="Venda proj." stroke="#dc2626" fill="#fee2e2" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="text-sm font-semibold text-gray-900 mb-3">Saldo de capacidade</div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={capacidadeChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="mes" fontSize={12} />
                    <YAxis fontSize={12} tickFormatter={(v) => fmt(Number(v))} />
                    <Tooltip formatter={(value) => fmt(Number(value || 0))} />
                    <Bar dataKey="saldo" name="Saldo min." fill="#6366f1" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900">Resumo por {agruparPor}</div>
              <div className="text-xs text-gray-500">{loading ? 'Carregando...' : `${gruposFiltrados.length} grupos`}</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-3 py-2 text-left min-w-56">Grupo</th>
                    <th className="px-3 py-2 text-right">SKUs</th>
                    <th className="px-3 py-2 text-right">Estoque</th>
                    <th className="px-3 py-2 text-right">Minimo</th>
                    {mesesPlano.map((m) => (
                      <th key={m.key} className="px-3 py-2 text-right min-w-28">
                        {m.label}
                        <div className="text-[10px] font-normal text-gray-400">final/cob.</div>
                      </th>
                    ))}
                    <th className="px-3 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {gruposFiltrados.map((grupo) => (
                    <tr key={grupo.chave} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-semibold text-gray-800">{grupo.chave}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(grupo.itens)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(grupo.estoqueAtual)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(grupo.estoqueMinimo)}</td>
                      {grupo.meses.map((mes) => (
                        <td key={mes.key} className={`px-3 py-2 text-right font-mono ${mes.estoqueFinal < 0 ? 'text-red-700 font-semibold bg-red-50' : ''}`}>
                          <div>{fmt(mes.estoqueFinal)}</div>
                          <div className="text-[10px] text-gray-400">{mes.cobertura === null ? '-' : `${fmt(mes.cobertura, 1)}x`}</div>
                        </td>
                      ))}
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClass(grupo.status)}`}>
                          {statusLabel(grupo.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!loading && gruposFiltrados.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-4 py-8 text-center text-gray-400">
                        Nenhum grupo encontrado com os filtros atuais.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900">SKUs criticos</div>
              <div className="text-xs text-gray-500">{produtosRisco.length} principais riscos</div>
            </div>
            <div className="overflow-x-auto max-h-[520px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-3 py-2 text-left">Referencia</th>
                    <th className="px-3 py-2 text-left">Produto</th>
                    <th className="px-3 py-2 text-right">Estoque</th>
                    <th className="px-3 py-2 text-right">Pedidos</th>
                    <th className="px-3 py-2 text-right">Processo</th>
                    <th className="px-3 py-2 text-right">Menor saldo</th>
                    <th className="px-3 py-2 text-right">Menor cob.</th>
                    <th className="px-3 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {produtosRisco.map((item) => (
                    <tr key={item.idproduto} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-gray-800">{item.referencia}</td>
                      <td className="px-3 py-2 text-gray-700 max-w-md truncate" title={item.produto}>{item.produto}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(item.estoqueAtual)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(item.pedidos)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(item.emProcesso)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${item.menorEstoque < 0 ? 'text-red-700 font-semibold' : ''}`}>{fmt(item.menorEstoque)}</td>
                      <td className="px-3 py-2 text-right font-mono">{item.menorCobertura === null ? '-' : `${fmt(item.menorCobertura, 1)}x`}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusClass(item.status)}`}>
                          {statusLabel(item.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, danger = false }: { icon: React.ReactNode; label: string; value: string; danger?: boolean }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm border p-4 ${danger ? 'border-red-200' : 'border-gray-200'}`}>
      <div className="flex items-center justify-between">
        <div className={`h-9 w-9 rounded flex items-center justify-center ${danger ? 'bg-red-50 text-red-700' : 'bg-teal-50 text-teal-700'}`}>
          {icon}
        </div>
      </div>
      <div className="mt-3 text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold font-mono ${danger ? 'text-red-700' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}
