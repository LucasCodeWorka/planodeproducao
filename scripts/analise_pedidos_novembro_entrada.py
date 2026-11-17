import csv
import json
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

origem = Path(r'C:\Users\ce_lu\Downloads\2026-11-16_140250_LIVRE_1a_sessao.csv')
totais = defaultdict(Decimal)
pedidos = set()
linhas = 0
with origem.open(encoding='utf-8-sig', newline='') as arquivo:
    leitor = csv.DictReader(arquivo, delimiter=';')
    for linha in leitor:
        sku = linha['cd_produto'].strip()
        quantidade = Decimal(linha['qt_pendente_hoje'].strip().replace('.', '').replace(',', '.') or '0')
        totais[sku] += quantidade
        pedidos.add((linha['cd_pedido'].strip(), sku))
        linhas += 1
Path('data/skus_usuario_novembro.json').write_text(json.dumps(sorted(totais, key=int)), encoding='utf-8')
Path('data/pedidos_usuario_novembro.json').write_text(json.dumps({k: float(v) for k, v in totais.items()}), encoding='utf-8')
Path('data/pedidos_ids_novembro.json').write_text(json.dumps(sorted({p for p, _ in pedidos}, key=int)), encoding='utf-8')
print(f'{linhas} linhas, {len(totais)} SKUs, {len(pedidos)} pares pedido/SKU; {sum(totais.values())} peças pendentes')
