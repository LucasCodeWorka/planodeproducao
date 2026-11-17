import csv
import json
from collections import Counter
from pathlib import Path

origem = Path(r'C:\Users\ce_lu\Downloads\2026-11-16_140250_LIVRE_1a_sessao.csv')
base = json.loads(Path('outputs/novembro_skus/dados.json').read_text(encoding='utf-8'))
fora = json.loads(Path('outputs/novembro_skus/fora_matriz.json').read_text(encoding='utf-8'))
erp = json.loads(Path('outputs/novembro_skus/pedidos_erp.json').read_text(encoding='utf-8'))
por_pedido = {(x['pedido'], x['sku']): x['pendente'] for x in erp}
por_sku = {x['sku']: x for x in base['linhas']}

def numero(v):
    return float(str(v).replace('.', '').replace(',', '.') or '0')

stats = Counter()
resumo = {}
for sku, x in por_sku.items():
    if not x['encontrado'] and sku in fora:
        x.update(fora[sku])
        x['dadosValidos'] = x['estoque'] is not None
    valor = x['projecao']
    x['restante'] = None if valor is None else valor * base['fator']
    if x['dadosValidos'] and x['restante'] is not None:
        x['saldoSemEntradas'] = x['estoque'] - x['pedidos'] - x['restante']
        x['saldoFinal'] = x['saldoSemEntradas'] + x['processo'] + x['plano']
    else:
        x['saldoSemEntradas'] = None
        x['saldoFinal'] = None
    x['cobertura'] = x['saldoFinal'] / valor if x['saldoFinal'] is not None and valor is not None and valor > 0 else None
    x['gapMinimo'] = x['saldoFinal'] - x['minimo'] if x['saldoFinal'] is not None and x['minimo'] is not None and x['minimo'] > 0 else None
    if not x['dadosValidos']:
        x['situacao'] = 'Sem dados de saldo'
    elif valor is None:
        x['situacao'] = 'Sem projeção de novembro'
    elif x['pedidosPlanilha'] > x['pedidos'] + 0.0001:
        x['situacao'] = 'Conferir pendente no painel'
    elif x['saldoFinal'] < 0:
        x['situacao'] = 'Saldo final negativo'
    elif x['gapMinimo'] is None:
        x['situacao'] = 'Sem estoque mínimo no painel'
    elif x['gapMinimo'] < 0:
        x['situacao'] = 'Abaixo do estoque mínimo'
    else:
        x['situacao'] = 'Acima do estoque mínimo'
    stats[x['situacao']] += 1
    resumo[sku] = x

cabecalhos = ['Projeção nov integral SKU', 'Projeção restante nov SKU', 'Estoque atual SKU', 'Em processo SKU', 'Plano MA SKU', 'Pendentes painel SKU', 'Pendente planilha total SKU', 'Saldo fim nov sem entradas SKU', 'Saldo fim nov com processo e plano SKU', 'Estoque mínimo SKU', 'Cobertura em meses SKU', 'Situação estoque mínimo SKU', 'Conferência pedido ERP', 'Fonte saldo']
linhas = []
with origem.open(encoding='utf-8-sig', newline='') as f:
    leitor = csv.DictReader(f, delimiter=';')
    originais = leitor.fieldnames
    for linha in leitor:
        sku = linha['cd_produto'].strip()
        x = resumo[sku]
        chave = (linha['cd_pedido'].strip(), sku)
        pendente = numero(linha['qt_pendente_hoje'])
        verificado = chave in por_pedido and abs(por_pedido[chave] - pendente) < 0.0001
        valores = [linha[c] for c in originais]
        for nome in ('qt_pendente_hoje', 'qt_fica_envia_agora', 'qt_vai_p_2a_sessao'):
            valores[originais.index(nome)] = numero(linha[nome])
        valores.extend([x['projecao'], x['restante'], x['estoque'], x['processo'], x['plano'], x['pedidos'], x['pedidosPlanilha'], x['saldoSemEntradas'], x['saldoFinal'], x['minimo'], x['cobertura'], x['situacao'], 'Confere' if verificado else 'Divergente ou ausente', 'Matriz 16/11 08:06' if x['encontrado'] else 'ERP ao vivo; fora da matriz'])
        linhas.append(valores)

resultado = {'headers': originais + cabecalhos, 'rows': linhas, 'fator': base['fator'], 'stats': dict(stats), 'skus': len(resumo), 'totalLinhas': len(linhas), 'semProjecao': sum(x['projecao'] is None for x in resumo.values()), 'totalRestante': sum(x['restante'] for x in resumo.values() if x['restante'] is not None), 'naoConferidos': sum(1 for x in linhas if x[-2] != 'Confere')}
Path('outputs/novembro_skus/preparado.json').write_text(json.dumps(resultado, ensure_ascii=False), encoding='utf-8')
print(json.dumps({k: v for k, v in resultado.items() if k not in ('rows', 'headers')}, ensure_ascii=False))
