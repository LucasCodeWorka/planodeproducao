import collections
import json
from pathlib import Path

base = Path('outputs/revisao_producao')
revisao = json.loads((base / 'revisao.json').read_text(encoding='utf-8'))
historico = json.loads((base / 'historico.json').read_text(encoding='utf-8'))
arquivo_grupos = json.loads(Path('data/capacidade_grupos.json').read_text(encoding='utf-8'))['data']
desativados = {'08 - PROGRESSO SO BASICO', 'OFICINA - ATILA', 'OFICINA - MARCELO FREITAS', 'OFICINA - PAULO BRUNO', '03 - EXCELENCIA SU BASICO', 'OFICINA - IANA'}
ativos = {x['grupo'].strip().upper() for x in arquivo_grupos if float(x.get('capacidade_diaria') or 0) > 0} - desativados
ativos.add('08 - ESPERANCA CA BASICO')
por_ref = collections.defaultdict(list)
for item in historico:
    if item['grupo'] in ativos:
        por_ref[item['referencia']].append(item)
contagem = collections.Counter()
divergencias = []
for item in revisao:
    if item['revisao'].strip().lower() != 'corretas':
        continue
    registros = sorted(por_ref[item['referencia']], key=lambda x: -x['pecas'])
    if not registros:
        contagem['sem histórico'] += 1
    elif item['grupos'] and item['grupos'][0] == registros[0]['grupo']:
        contagem['primeiro coincide'] += 1
    else:
        contagem['primeiro difere'] += 1
        divergencias.append({'referencia': item['referencia'], 'validado_grupo_a': item['grupos'][0] if item['grupos'] else None, 'historico_grupo': registros[0]['grupo'], 'pecas': registros[0]['pecas']})
print('Referências marcadas corretas:', dict(contagem))
print('Exemplos de divergência:', divergencias[:8])
(base / 'divergencias_aprovadas.json').write_text(json.dumps(divergencias, ensure_ascii=False, indent=2), encoding='utf-8')
