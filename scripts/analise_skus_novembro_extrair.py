import json
import re
from pathlib import Path

log = Path(r'C:\Users\ce_lu\.codex\sessions\2026\11\13\rollout-2026-11-13T15-30-52-01a1d62d-3adc-7653-be34-105aeac9cd2e.jsonl')
skus = set()
ativo = False
linhas = 0
for linha in log.open(encoding='utf-8'):
    registro = json.loads(linha)
    payload = registro.get('payload', {})
    if registro.get('type') != 'response_item' or payload.get('role') != 'user':
        continue
    texto = '\n'.join(c.get('text', '') for c in payload.get('content', []) if c.get('type') == 'input_text')
    if texto.startswith('4129\n6824\n6828'):
        ativo = True
    if not ativo:
        continue
    for valor in texto.splitlines():
        if re.fullmatch(r'\d{3,8}', valor.strip()):
            linhas += 1
            skus.add(valor.strip())

destino = Path('data/skus_usuario_novembro.json')
destino.write_text(json.dumps(sorted(skus, key=int), ensure_ascii=False), encoding='utf-8')
print(f'{linhas} códigos informados; {len(skus)} distintos; {linhas-len(skus)} repetições')
