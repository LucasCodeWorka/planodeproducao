'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type DadosMapa = {
  grupos: Array<{ grupo: string }>;
  referencias: Array<{ referencia: string; grupos: Array<{ grupo: string; fatia: number }> }>;
};
type Ligacao = { de: string; para: string; quantidade: number };
type Linha = Ligacao & { x1: number; y1: number; x2: number; y2: number };

export default function MapaGruposCostura({ dados }: { dados: DadosMapa }) {
  const [referencia, setReferencia] = useState('');
  const [grupoFocado, setGrupoFocado] = useState('');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const area = useRef<HTMLDivElement>(null);
  const cartoes = useRef(new Map<string, HTMLDivElement>());
  const busca = referencia.trim().toUpperCase();
  const { grupos, ligacoes } = useMemo(() => {
    const porGrupo = new Map(dados.grupos.map((g) => [g.grupo, [] as Array<{ referencia: string; posicao: number; fatia: number }> ]));
    const porPar = new Map<string, Ligacao>();
    for (const r of dados.referencias) {
      r.grupos.forEach((g, posicao) => porGrupo.get(g.grupo)?.push({ referencia: r.referencia, posicao, fatia: g.fatia }));
      if (busca && !r.referencia.toUpperCase().includes(busca)) continue;
      for (let i = 0; i < r.grupos.length; i += 1) for (let j = i + 1; j < r.grupos.length; j += 1) {
        const [de, para] = [r.grupos[i].grupo, r.grupos[j].grupo].sort();
        if (grupoFocado && grupoFocado !== de && grupoFocado !== para) continue;
        const chave = JSON.stringify([de, para]);
        const atual = porPar.get(chave) || { de, para, quantidade: 0 };
        atual.quantidade += 1;
        porPar.set(chave, atual);
      }
    }
    return {
      grupos: [...porGrupo.entries()].map(([nome, refs]) => ({ nome, refs: refs.sort((a, b) => a.posicao - b.posicao || a.referencia.localeCompare(b.referencia)) })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
      ligacoes: [...porPar.values()],
    };
  }, [dados, busca, grupoFocado]);

  useEffect(() => {
    const container = area.current;
    if (!container) return;
    let frame = 0;
    const medir = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const base = container.getBoundingClientRect();
        const novas = ligacoes.flatMap((ligacao) => {
          const a = cartoes.current.get(ligacao.de)?.getBoundingClientRect();
          const b = cartoes.current.get(ligacao.para)?.getBoundingClientRect();
          if (!a || !b) return [];
          const ax = a.left + a.width / 2 - base.left;
          const ay = a.top + a.height / 2 - base.top;
          const bx = b.left + b.width / 2 - base.left;
          const by = b.top + b.height / 2 - base.top;
          if (Math.abs(ax - bx) > Math.abs(ay - by)) {
            return [{ ...ligacao, x1: ax + (bx > ax ? a.width / 2 : -a.width / 2), y1: ay, x2: bx + (bx > ax ? -b.width / 2 : b.width / 2), y2: by }];
          }
          return [{ ...ligacao, x1: ax, y1: ay + (by > ay ? a.height / 2 : -a.height / 2), x2: bx, y2: by + (by > ay ? -b.height / 2 : b.height / 2) }];
        });
        setLinhas(novas);
      });
    };
    const observador = new ResizeObserver(medir);
    observador.observe(container);
    cartoes.current.forEach((cartao) => observador.observe(cartao));
    window.addEventListener('resize', medir);
    medir();
    return () => { cancelAnimationFrame(frame); observador.disconnect(); window.removeEventListener('resize', medir); };
  }, [grupos, ligacoes]);

  return <section className="mt-6 rounded-xl border border-indigo-200 bg-white p-5 shadow-sm" aria-labelledby="mapa-grupos-titulo">
    <h2 id="mapa-grupos-titulo" className="text-lg font-semibold text-slate-900">Mapa de relacionamentos entre grupos</h2>
    <p className="mt-1 text-sm text-slate-600">Cada quadro mostra todas as referências que este grupo recebeu na simulação. Uma linha liga dois grupos quando ambos receberam a mesma referência. Clique em uma referência ou em um grupo para destacar suas ligações.</p>
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">Destacar referência
        <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Ex.: 123606" className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-900" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">Destacar grupo
        <select value={grupoFocado} onChange={(e) => setGrupoFocado(e.target.value)} className="max-w-[360px] rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"><option value="">Todos os grupos</option>{grupos.map((g) => <option key={g.nome} value={g.nome}>{g.nome}</option>)}</select>
      </label>
      {(busca || grupoFocado) && <button type="button" onClick={() => { setReferencia(''); setGrupoFocado(''); }} className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700">Limpar destaque</button>}
      <span className="pb-2 text-xs text-slate-500">{grupos.length} grupos · {ligacoes.length} ligações entre grupos</span>
    </div>
    <p className="mt-3 text-xs text-slate-500">A indica o grupo que recebeu mais minutos daquela referência no horizonte; B, C e D receberam menos. A linha mostra distribuição simulada, não confirma que o grupo esteja aprovado para produzir a referência. Referências sem alocação não aparecem.</p>
    <div className="mt-4 max-h-[75vh] overflow-auto rounded-lg border border-slate-200 bg-slate-50">
      <div ref={area} className="relative grid min-w-[900px] grid-cols-3 items-start gap-x-16 gap-y-16 p-8">
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">{linhas.map((l) => <g key={JSON.stringify([l.de, l.para])}><line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={busca || grupoFocado ? '#4f46e5' : '#94a3b8'} strokeOpacity={busca || grupoFocado ? 0.85 : 0.5} strokeWidth={busca || grupoFocado ? 2.5 : 1.5} /><circle cx={(l.x1 + l.x2) / 2} cy={(l.y1 + l.y2) / 2} r="11" fill="white" stroke="#a5b4fc" /><text x={(l.x1 + l.x2) / 2} y={(l.y1 + l.y2) / 2 + 3} textAnchor="middle" fontSize="9" fill="#3730a3">{l.quantidade}</text></g>)}</svg>
        {grupos.map((g) => <div key={g.nome} ref={(elemento) => { if (elemento) cartoes.current.set(g.nome, elemento); else cartoes.current.delete(g.nome); }} className={`relative z-10 overflow-hidden rounded-lg border-2 bg-white shadow-sm ${grupoFocado === g.nome ? 'border-indigo-600 ring-2 ring-indigo-200' : 'border-slate-300'}`}>
          <button type="button" onClick={() => setGrupoFocado(grupoFocado === g.nome ? '' : g.nome)} aria-pressed={grupoFocado === g.nome} className="w-full bg-indigo-50 px-3 py-3 text-left hover:bg-indigo-100"><span className="block text-sm font-bold text-indigo-950">{g.nome}</span><span className="text-xs text-indigo-700">{g.refs.length} referências · clique para destacar</span></button>
          <div className="flex flex-wrap gap-1.5 p-3">{g.refs.length ? g.refs.map((r) => <button key={r.referencia} type="button" onClick={() => setReferencia(busca === r.referencia.toUpperCase() ? '' : r.referencia)} title={`Grupo ${String.fromCharCode(65 + r.posicao)} · ${Math.round(r.fatia * 100)}% da referência no horizonte`} className={`rounded border px-2 py-1 text-xs font-medium ${busca && r.referencia.toUpperCase().includes(busca) ? 'border-amber-500 bg-amber-100 text-amber-950' : r.posicao === 0 ? 'border-indigo-200 bg-indigo-50 text-indigo-900' : 'border-slate-200 bg-white text-slate-700'}`}>
            {r.referencia} <span className="text-[10px] opacity-70">{String.fromCharCode(65 + r.posicao)}</span>
          </button>) : <span className="text-xs text-slate-400">Nenhuma referência alocada.</span>}</div>
        </div>)}
      </div>
    </div>
  </section>;
}
