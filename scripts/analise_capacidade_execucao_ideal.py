"""EXECUCAO IDEAL DE 2027 — Laboratorio de capacidade (P10 em docs/analise-capacidade/conclusoes.md).

Distribui o plano de 2027 entre os 16 grupos de costura FIXOS (grupo nao para), por custo
minimo: cada grupo fica na familia de casa, so troca para familia que ja demonstrou fazer,
antecipa so o necessario, atrasa so se nao houver jeito (penalidade alta), e o que sobra
vira capacidade LIVRE. Min-cost flow (caminhos sucessivos + Bellman-Ford), sem dependencias.

Entradas (fotos das rotas /api/analise-capacidade/finalizado e /especializacao):
  docs/analise-capacidade/dados/finalizado-2025-11_2026-10.json
  docs/analise-capacidade/dados/especializacao-plano.json
Saida:
  docs/analise-capacidade/execucao-ideal-2027.json  (lida pela aba Laboratorio de capacidade)

Uso: python scripts/analise_capacidade_execucao_ideal.py
"""
import json, collections, os, datetime
RAIZ=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','docs','analise-capacidade')
d=json.load(open(os.path.join(RAIZ,'dados','finalizado-2025-11_2026-10.json'),encoding='utf-8')); e=json.load(open(os.path.join(RAIZ,'dados','especializacao-plano.json'),encoding='utf-8'))
fech=[m for m in d['meses'] if m<'2026-11']
# ---- plano 2027 por familia (dobra das pequenas) ----
fold={'BODY':'NOITE','ROBE':'NOITE','CROPPED':'NOITE','CINTA':'SUTIA','MODELADOR':'SUTIA','SPARTILHO':'SUTIA','ACESSORIO':'SUTIA'}
FAM=['CALCA','SUTIA','NOITE','ANATOMIC']
plano={f:[0]*12 for f in FAM}; dias=[0]*12
for fam in e['familias']:
    k=fold.get(fam['familia'],fam['familia'])
    if k not in plano: continue
    for p in fam['plano']:
        if p['mes'].startswith('2027-'):
            i=int(p['mes'][5:])-1; plano[k][i]+=p['pecas']; dias[i]=p['dias']
# ---- grupos: casa, flexibilidade demonstrada (>=5%), producao mensal ----
cfg={
 '08 - CONQUISTA CA BASICO/FASHION':('CALCA',[]),
 '07 - DESAFIO CA FASHION':('CALCA',[]),
 'OFICINA - GLEDSON SOARES':('CALCA',[]),
 '06 - UNIAO CA LUXE':('CALCA',[]),
 '07 - EVOLUCAO CA FASHION':('CALCA',['SUTIA']),
 '08 - ESPERANCA CA BASICO':('CALCA',[]),
 '05 - MOTIVACAO SU BASICO':('SUTIA',[]),
 '08 - OBJETIVO SO BASICO':('SUTIA',['CALCA']),
 '04 - HARMONIA SU BASICO':('SUTIA',[]),
 '04 - PERSEVERANCA SU FASHION/BASICO':('SUTIA',[]),
 '05 - POSITIVO SU BASICO':('SUTIA',[]),
 '04 - SUPERACAO SU FASHION/BASICO':('SUTIA',[]),
 '03 - FELICIDADE SU LUXE':('SUTIA',['CALCA']),
 '09 - LIDERANCA ANATOMIC':('ANATOMIC',['SUTIA','CALCA']),
 '03 - ALEGRIA SU LUXE MODA':('NOITE',['SUTIA']),
 '03 - FUTURO SU LUXE':('NOITE',['SUTIA']),
}
cel={c['celula']:c for c in d['celulas']}
prod={}
for g in cfg:
    c=cel[g]
    if g=='08 - ESPERANCA CA BASICO':
        ms=[m for m in fech if m>='2026-06']
    else:
        ms=[m for m in fech if c['porMes'][m]>0]
    prod[g]=sum(c['porMes'][m] for m in ms)/len(ms)
rate={f:sum(prod[g] for g in cfg if cfg[g][0]==f)/sum(1 for g in cfg if cfg[g][0]==f) for f in FAM}
size={g:prod[g]/rate[cfg[g][0]] for g in cfg}
DMED=22.2
# ---- min cost flow (SSP + Bellman-Ford), unidades = 0,001 grupo-mes ----
U=1000
nodes={}; 
def nid(k):
    if k not in nodes: nodes[k]=len(nodes)
    return nodes[k]
G=collections.defaultdict(list)  # adj: [to, cap, cost, rev]
def add(a,b,cap,cost):
    a=nid(a); b=nid(b)
    G[a].append([b,cap,cost,len(G[b])]); G[b].append([a,0,-cost,len(G[a])-1])
SRC='S'; SNK='T'; INF=10**12
REWARD=-100000; SWITCH=40; HOLD=3; LATE=2000
for g,(home,flex) in cfg.items():
    for t in range(12):
        cap=int(round(size[g]*dias[t]/DMED*U))
        add(SRC,('g',g,t),cap,0)
        add(('g',g,t),'LIVRE',INF,0)
        for f in [home]+flex:
            for t2 in range(12):
                custo=(0 if f==home else SWITCH)+(HOLD*(t2-t) if t2>=t else LATE*(t-t2))
                add(('g',g,t),('d',f,t2),INF,custo)
add('LIVRE',SNK,INF,0)
for f in FAM:
    for t in range(12):
        add(('d',f,t),SNK,int(round(plano[f][t]/rate[f]*U)),REWARD)
N=len(nodes); s=nodes[SRC]; tN=nodes[SNK]
def bf():
    dist=[INF]*N; inq=[False]*N; pv=[None]*N; dist[s]=0
    from collections import deque
    q=deque([s]); inq[s]=True
    while q:
        u=q.popleft(); inq[u]=False
        for i,(v,cap,cost,rv) in enumerate(G[u]):
            if cap>0 and dist[u]+cost<dist[v]:
                dist[v]=dist[u]+cost; pv[v]=(u,i)
                if not inq[v]: q.append(v); inq[v]=True
    return dist,pv
while True:
    dist,pv=bf()
    if dist[tN]>=INF: break
    f=INF; v=tN
    while v!=s:
        u,i=pv[v]; f=min(f,G[u][i][1]); v=u
    v=tN
    while v!=s:
        u,i=pv[v]; G[u][i][1]-=f; rv=G[u][i][3]; G[v][rv][1]+=f; v=u
inv={v:k for k,v in nodes.items()}
# ---- leitura ----
alloc=collections.defaultdict(float)   # (g,t,f) -> grupo-mes  (f inclui LIVRE)
atraso=collections.defaultdict(float)
for u,edges in G.items():
    ku=inv[u]
    if not (isinstance(ku,tuple) and ku[0]=='g'): continue
    for (v,cap,cost,rv) in edges:
        kv=inv[v]; back=G[v][rv][1]
        if back<=0: continue
        if kv=='LIVRE': alloc[(ku[1],ku[2],'LIVRE')]+=back/U
        elif isinstance(kv,tuple) and kv[0]=='d':
            alloc[(ku[1],ku[2],kv[1])]+=back/U
            if kv[2]<ku[2]: atraso[(kv[1],kv[2],ku[2])]+=back/U
MESES=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']
grupos=[]
for g,(home,flex) in cfg.items():
    meses=[]
    for t in range(12):
        partes=[{'familia':f,'grupoMes':round(v,3),'pecas':round(v*rate[f]) if f!='LIVRE' else None}
                for (gg,tt,f),v in alloc.items() if gg==g and tt==t and v>0.005]
        tot=sum(p['grupoMes'] for p in partes) or 1
        for p in partes: p['fatia']=round(p['grupoMes']/tot,3)
        meses.append(sorted(partes,key=lambda p:-p['fatia']))
    grupos.append({'grupo':g,'casa':home,'podeFazer':flex,'pecasMes':round(prod[g]),'tamanho':round(size[g],2),'meses':meses})
familias=[]
for f in FAM:
    pr=[sum(v*rate[f] for (g,t,ff),v in alloc.items() if ff==f and t==i) for i in range(12)]
    cum=0; saldo=[]
    for i in range(12): cum+=pr[i]-plano[f][i]; saldo.append(round(cum))
    familias.append({'familia':f,'ritmoGrupo':round(rate[f]),'plano':plano[f],'producao':[round(x) for x in pr],'saldoAcumulado':saldo})
livre=[round(sum(v for (g,t,f),v in alloc.items() if f=='LIVRE' and t==i),2) for i in range(12)]
out={'geradoEm':datetime.datetime.now().isoformat(timespec='minutes'),'ano':2027,'meses':MESES,'diasPorMes':dias,
     'premissas':['16 grupos fixos: grupo nao para e nao se dimensiona mes a mes.',
                  'Cada grupo fica na familia de casa; so troca para familia que ja fez (>=5% da producao nov/25-out/26).',
                  'Ritmo de cada grupo = media mensal dele em nov/25-out/26 (ESPERANCA so jun-out), ajustado aos dias de 2027.',
                  'Ao trocar de familia, o grupo assume o ritmo medio da familia nova, proporcional ao tamanho dele.',
                  'Plano = matriz + lote mais recente, em pecas. Sem Move, edicao limitada projetada ou previsto.',
                  'Body, robe e cropped somados em NOITE; cinta, modelador, spartilho e acessorio em SUTIA.',
                  'Comeca jan/27 sem estoque antecipado; atraso permitido com penalidade alta.'],
     'grupos':grupos,'familias':familias,'livre':livre,
     'atraso':[{'familia':f,'mesDoPlano':MESES[t2],'produzidoEm':MESES[t],'pecas':round(v*rate[f])} for (f,t2,t),v in atraso.items()]}
json.dump(out,open(os.path.join(RAIZ,'execucao-ideal-2027.json'),'w',encoding='utf-8'),ensure_ascii=False,indent=1)
print('ok', sum(livre), [x['pecas'] for x in out['atraso']])
