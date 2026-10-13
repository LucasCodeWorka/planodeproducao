'use client';
import { useEffect, useMemo, useState } from 'react';

type Row = { codigoproduto:string; cd_nivel:string; codtamanho:string; nomecolecao:string; dataproduto:string; quantidade:number; quantidadeprontaentrega:number; codcorbase:string; nm_produto:string; nomecor:string; marca:string; status:string; continuidade:string; linha:string; familia:string };
const n = (v: unknown) => Number(v || 0);
const qty = (v: number) => v.toLocaleString('pt-BR');
const key = (v: unknown) => String(v || '').trim() || 'SEM CLASSIFICAÇÃO';

export default function Page() {
  const [rows, setRows] = useState<Row[]>([]); const [error, setError] = useState('');
  const [dias, setDias] = useState(60); const [texto, setTexto] = useState('');
  const [filters, setFilters] = useState<Record<string,string>>({ marca:'', status:'', continuidade:'', linha:'', familia:'', nomecor:'', codtamanho:'', nomecolecao:'' });
  useEffect(() => { fetch('/api/disponibilidade').then(r=>r.json()).then(p=>p.error?setError(p.error):setRows(p.data)).catch(e=>setError(e.message)); }, []);
  const dates = useMemo(()=>[...new Set(rows.map(r=>r.dataproduto?.slice(0,10)).filter(Boolean))].sort(),[rows]);
  const dataCorte = useMemo(()=>{ const d=new Date(); d.setDate(d.getDate()+dias); return d.toISOString().slice(0,10);},[dias]);
  const opts = (field:keyof Row) => [...new Set(rows.map(r=>key(r[field])).filter(Boolean))].sort();
  const filtered = useMemo(()=>rows.filter(r=>{
    // Analise de ruptura comercial: exibe apenas o que pode ser atendido
    // daqui a N dias ou mais — nao o que chega ate esse prazo.
    if (r.dataproduto?.slice(0,10)<dataCorte) return false;
    if (texto && !`${r.codigoproduto} ${r.cd_nivel} ${r.nm_produto} ${r.nomecor}`.toLowerCase().includes(texto.toLowerCase())) return false;
    return Object.entries(filters).every(([f,v])=>!v || key(r[f as keyof Row])===v);
  }),[rows,dataCorte,texto,filters]);
  const summary = useMemo(()=>({skus:filtered.length, referencias:new Set(filtered.map(r=>r.cd_nivel)).size, pronta:filtered.reduce((s,r)=>s+n(r.quantidadeprontaentrega),0), futuro:filtered.reduce((s,r)=>s+n(r.quantidade),0)}),[filtered]);
  const matriz = useMemo(()=>Object.values(filtered.reduce((a,r)=>{const k=r.cd_nivel||'SEM REFERÊNCIA';(a[k]??={ref:k,desc:r.nm_produto,rows:[]}).rows.push(r);return a},{} as Record<string,{ref:string;desc:string;rows:Row[]}>)),[filtered]);
  const bars = useMemo(()=>dates.map(data=>({data, valor:filtered.filter(r=>r.dataproduto?.slice(0,10)===data).reduce((s,r)=>s+n(r.quantidade),0)})),[dates,filtered]); const max=Math.max(1,...bars.map(x=>x.valor));
  return <main>
    <header><div><span className="eyebrow">ESTOQUE & DISPONIBILIDADE</span><h1>Disponibilidade de produtos</h1><p>Fonte: <b>mv_geo3</b> · pronta-entrega e estoque futuro por data de disponibilidade</p></div><div className="pill">{rows.length ? `${qty(rows.length)} SKUs carregados` : 'Carregando...'}</div></header>
    {error && <div className="error">{error}</div>}
    <section className="filters"><div className="filter-title">Produtos que só ficam disponíveis depois do prazo</div><label>Disponível a partir de <select value={dias} onChange={e=>setDias(Number(e.target.value))}><option value="0">Hoje / pronta-entrega</option><option value="30">30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option><option value="120">120 dias</option></select></label><label>Buscar SKU / produto<input value={texto} onChange={e=>setTexto(e.target.value)} placeholder="Código, nível, descrição ou cor" /></label>{(['marca','status','continuidade','linha','familia'] as const).map(f=><label key={f}>{f}<select value={filters[f]} onChange={e=>setFilters({...filters,[f]:e.target.value})}><option value="">Todas</option>{opts(f).map(v=><option key={v}>{v}</option>)}</select></label>)}<button onClick={()=>{setTexto('');setFilters({marca:'',status:'',continuidade:'',linha:'',familia:''});setDias(60)}}>Limpar</button></section>
    <section className="cards"><Card label="SKUs disponíveis" value={qty(summary.skus)} tone="blue"/><Card label="Referências" value={qty(summary.referencias)} tone="cyan"/><Card label="Pronta-entrega" value={qty(summary.pronta)} tone="green"/><Card label="Estoque futuro" value={qty(summary.futuro)} tone="purple"/></section>
    <section className="grid"><article><h2>Estoque que só chega depois do prazo</h2><p>Corte: {new Date(dataCorte+'T12:00:00').toLocaleDateString('pt-BR')}</p><div className="bars">{bars.map(b=><div className="bar" key={b.data}><div className="bar-value">{qty(b.valor)}</div><i style={{height:`${Math.max(4,b.valor/max*180)}px`}}></i><small>{new Date(b.data+'T12:00:00').toLocaleDateString('pt-BR',{month:'short',year:'2-digit'})}</small></div>)}</div></article><article><h2>Impacto comercial</h2><div className="insight"><b>{qty(summary.skus)}</b><span>SKUs só podem atender pedidos a partir de {dias} dias.</span></div><div className="insight"><b>{qty(summary.futuro)}</b><span>unidades estão fora da janela imediata de venda.</span></div><div className="insight"><b>{qty(summary.pronta)}</b><span>unidades desse recorte já constam como pronta-entrega.</span></div></article></section>
    <section className="table-wrap"><div className="table-head"><h2>Produtos disponíveis</h2><span>{qty(filtered.length)} linhas</span></div><table><thead><tr><th>Referência</th><th>Produto</th><th>Cor / tamanho</th><th>Classificações</th><th>Disponível em</th><th>Pronta-entrega</th><th>Estoque</th></tr></thead><tbody>{filtered.slice(0,300).map((r,i)=><tr key={`${r.cd_nivel}-${i}`}><td><b>{r.cd_nivel}</b></td><td><b>{r.codigoproduto}</b><span>{r.nm_produto}</span></td><td>{r.nomecor} · {r.codtamanho}</td><td><span className="tags">{[r.marca,r.status,r.continuidade,r.linha,r.familia].filter(Boolean).map(x=><em key={x}>{x}</em>)}</span></td><td>{String(r.dataproduto||'').slice(0,10) || '-'}</td><td>{qty(n(r.quantidadeprontaentrega))}</td><td><b>{qty(n(r.quantidade))}</b></td></tr>)}</tbody></table>{filtered.length>300&&<p className="limit">Exibindo as primeiras 300 linhas; os indicadores consideram todo o filtro.</p>}</section>
    <section className="table-wrap"><div className="table-head"><h2>Matriz por referência</h2><span>{qty(matriz.length)} referências</span></div><div className="matrix">{matriz.map(ref=>{const cores=Object.values(ref.rows.reduce((a,r)=>{(a[r.nomecor||'SEM COR']??=[]).push(r);return a},{} as Record<string,Row[]>));return <details key={ref.ref}><summary><b>{ref.ref}</b><span>{ref.desc}</span><strong>{qty(ref.rows.reduce((s,r)=>s+n(r.quantidade),0))} un.</strong></summary>{cores.map(cor=><details className="matrix-cor" key={cor[0].nomecor}><summary><b>{cor[0].nomecor||'SEM COR'}</b><span>{cor.length} tamanhos/SKUs</span></summary>{cor.map(r=><div className="matrix-sku" key={`${r.codigoproduto}-${r.codtamanho}`}><span>Tam. {r.codtamanho}</span><span>Cód. {r.codigoproduto}</span><span>{String(r.dataproduto||'').slice(0,10)||'-'}</span><b>{qty(n(r.quantidade))} un.</b></div>)}</details>)}</details>})}</div></section>
  </main>;
}
function Card({label,value,tone}:{label:string,value:string,tone:string}) { return <article className={`card ${tone}`}><span>{label}</span><b>{value}</b></article> }
