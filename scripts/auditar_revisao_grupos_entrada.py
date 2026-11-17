import csv
import json
from pathlib import Path

origem = next(Path(r'C:\Users\ce_lu\Downloads').glob('*1(referencias-grupos-producao (2)).csv'))
with origem.open(encoding='utf-8-sig', newline='') as arquivo:
    linhas = list(csv.reader(arquivo))[3:]
dados = []
for r in linhas:
    if len(r) < 9 or not r[1].strip():
        continue
    dados.append({'referencia': r[1].strip(), 'observacao': r[0].strip(), 'grupos': [x.strip() for x in r[2:6] if x.strip()], 'revisao': r[8].strip(), 'produzido_informado': r[6].strip(), 'lancamento': r[7].strip()})
Path('outputs/revisao_producao').mkdir(parents=True, exist_ok=True)
Path('outputs/revisao_producao/revisao.json').write_text(json.dumps(dados, ensure_ascii=False), encoding='utf-8')
print(f'{len(dados)} referências revisadas; {sum(r["revisao"].lower() == "ajuste" for r in dados)} com ajuste; {sum("falta o grupo secundário" in r["observacao"].lower() for r in dados)} com observação de grupo secundário')
