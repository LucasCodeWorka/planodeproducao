import json
from collections import defaultdict
from pathlib import Path

p = Path('outputs/revisao_producao')
d = json.loads((p / 'auditoria_ajustes_completo.json').read_text(encoding='utf-8'))
r = json.loads((p / 'revisao.json').read_text(encoding='utf-8'))
sku_ref = {x['sku']: x['referencia'] for x in d['sku']}
grupos = set(map(str, [82,83,101,102,103,104,105,106,107,108,109,110,111,112,113,114,421,681,722,1241,1402,1422]))
mov, op = defaultdict(list), defaultdict(float)
for x in d['movimentos']:
    if x['local'] in grupos or (x['nome_local'] or '').upper().startswith('OFICINA'):
        mov[sku_ref[x['sku']]].append(x)
for x in d['ordens']:
    op[sku_ref[x['sku']]] += x['pecas_finalizadas']
for titulo, itens in [('ajustes', [x for x in r if x['revisao'].lower() == 'ajuste']), ('secundario', [x for x in r if 'falta o grupo secundário' in x['observacao'].lower()])]:
    refs = {x['referencia'] for x in itens}
    print(titulo, 'refs', len(refs), 'com movimento grupo', sum(bool(mov[x]) for x in refs), 'com finalizacao OP', sum(op[x] > 0 for x in refs), 'sem finalizacao OP', sum(op[x] <= 0 for x in refs))
    print('sem finalizacao OP:', ', '.join(sorted(x for x in refs if op[x] <= 0)))
