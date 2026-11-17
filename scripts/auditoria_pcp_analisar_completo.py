import collections
import json
from pathlib import Path

base = Path('outputs/revisao_producao')
d = json.loads((base / 'auditoria_historico_completo.json').read_text(encoding='utf-8'))
ref_sku = {x['sku']: x['referencia'] for x in d['sku']}
conhecidos = {str(x) for x in [82,83,101,102,103,104,105,106,107,108,109,110,111,112,113,114,421,681,722,1241,1402,1422]}
por_ref = collections.defaultdict(lambda: collections.defaultdict(lambda: {'pecas': 0, 'movimentos': 0, 'ops': 0, 'primeiro': None, 'ultimo': None}))
for x in d['movimentos']:
    ref = ref_sku.get(x['sku'])
    if not ref:
        continue
    nome = (x['nome_local'] or '').strip().upper()
    classe = 'grupo considerado' if x['local'] in conhecidos else 'outra oficina' if nome.startswith('OFICINA') else 'outro local'
    chave = (x['empresa'], x['local'], nome, classe)
    v = por_ref[ref][chave]
    v['pecas'] += x['pecas'] or 0
    v['movimentos'] += x['movimentos']
    v['ops'] += x['ops']
    p, u = str(x['primeiro'])[:10], str(x['ultimo'])[:10]
    v['primeiro'] = min(v['primeiro'] or p, p)
    v['ultimo'] = max(v['ultimo'] or u, u)
resultado = []
for ref in d['refs']:
    linhas = [{'empresa': k[0], 'local': k[1], 'grupo': k[2], 'classe': k[3], **v} for k, v in por_ref[ref].items()]
    linhas.sort(key=lambda x: -x['pecas'])
    resultado.append({'referencia': ref, 'linhas': linhas})
(base / 'auditoria_historico_completo_resumo.json').write_text(json.dumps(resultado, ensure_ascii=False, indent=2), encoding='utf-8')
print('Resumo nas 32 referências:')
print('com movimento tipo 51 em locais considerados:', sum(any(x['classe']=='grupo considerado' and x['pecas']>0 for x in r['linhas']) for r in resultado))
print('com movimento em outras oficinas:', sum(any(x['classe']=='outra oficina' and x['pecas']>0 for x in r['linhas']) for r in resultado))
print('com movimento em outros locais:', sum(any(x['classe']=='outro local' and x['pecas']>0 for x in r['linhas']) for r in resultado))
print('sem movimento em qualquer local:', sum(not r['linhas'] for r in resultado))
anteriores = {x['referencia'] for x in json.loads((base / 'historico_32_24meses.json').read_text(encoding='utf-8'))}
print('Fora dos 24 meses anteriores, com movimento em grupo ou oficina:')
for r in resultado:
    ocorrencias = [x for x in r['linhas'] if x['classe'] in ('grupo considerado', 'outra oficina') and x['pecas'] > 0]
    if r['referencia'] not in anteriores and ocorrencias:
        print(r['referencia'], [(x['grupo'], x['empresa'], round(x['pecas']), x['primeiro'], x['ultimo']) for x in ocorrencias])
print('Sem movimento nos grupos ou oficinas identificados:', [r['referencia'] for r in resultado if not any(x['classe'] in ('grupo considerado', 'outra oficina') and x['pecas'] > 0 for x in r['linhas'])])
print('Movimentos apenas em outros locais:', [(r['referencia'], [(x['grupo'] or 'sem local', round(x['pecas'])) for x in r['linhas'] if x['pecas'] > 0]) for r in resultado if r['linhas'] and not any(x['classe'] in ('grupo considerado', 'outra oficina') and x['pecas'] > 0 for x in r['linhas'])])
for r in resultado:
    if r['referencia'] in ['123606','503806','213001','411001']:
        print(r['referencia'], r['linhas'][:8])
