import json
import sys
from urllib.request import Request, urlopen


API = 'http://localhost:8000'


def request_json(url, method='GET', body=None, timeout=300):
    data = None if body is None else json.dumps(body).encode('utf-8')
    headers = {'Content-Type': 'application/json'} if data else {}
    request = Request(url, data=data, headers=headers, method=method)
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode('utf-8'))


def fmt(value, decimals=0):
    text = f'{value:,.{decimals}f}'
    return text.replace(',', 'X').replace('.', ',').replace('X', '.')


def main():
    matriz = request_json(
        f'{API}/api/producao/matriz?limit=5000&marca=LIEBE&status=EM%20LINHA&prefer_cache=true'
    )
    rows = matriz.get('data', [])
    ids = list(dict.fromkeys(str(row.get('produto', {}).get('idproduto')) for row in rows))
    ids = [value for value in ids if value and value != 'None']
    if not ids:
        raise RuntimeError('A matriz nao retornou SKUs.')

    historico = request_json(
        f'{API}/api/producao/estoque-minimo-fechamentos?marca=LIEBE&status=EM%20LINHA',
        method='POST',
        body={'ids': ids},
        timeout=300,
    )
    fechamentos = historico.get('fechamentos', [])
    dados = historico.get('data', [])
    totais = []
    for index, fechamento in enumerate(fechamentos):
        minimo = sum(float(row.get('fechamentos', [{}])[index].get('minimo') or 0) for row in dados)
        media_tri = sum(float(row.get('fechamentos', [{}])[index].get('mediaTri') or 0) for row in dados)
        totais.append({'label': fechamento.get('label'), 'ano': fechamento.get('ano'), 'minimo': minimo, 'media_tri': media_tri})

    print(f'SKUs na matriz: {len(ids)}')
    print(f'SKUs com historico: {len(dados)}')
    for total in totais:
        print(f"{total['label']}/{total['ano']}: estoque minimo {fmt(total['minimo'])} | media trimestral {fmt(total['media_tri'])}")

    if len(totais) >= 3 and totais[0]['minimo']:
        variacao_12 = (totais[1]['minimo'] - totais[0]['minimo']) / totais[0]['minimo'] * 100
        variacao_23 = (totais[2]['minimo'] - totais[1]['minimo']) / totais[1]['minimo'] * 100 if totais[1]['minimo'] else 0
        acumulada = (totais[2]['minimo'] - totais[0]['minimo']) / totais[0]['minimo'] * 100
        delta = totais[2]['minimo'] - totais[0]['minimo']
        print()
        print(f"Junho -> Julho: {fmt(totais[1]['minimo'] - totais[0]['minimo'])} ({fmt(variacao_12, 2)}%)")
        print(f"Julho -> Agosto: {fmt(totais[2]['minimo'] - totais[1]['minimo'])} ({fmt(variacao_23, 2)}%)")
        print(f"Junho -> Agosto: {fmt(delta)} ({fmt(acumulada, 2)}%)")
        print()
        print('Texto para o email:')
        print(
            f"Na revisao dos fechamentos, o estoque minimo total saiu de {fmt(totais[0]['minimo'])} pecas em junho "
            f"para {fmt(totais[1]['minimo'])} em julho e {fmt(totais[2]['minimo'])} em agosto. "
            f"A variacao acumulada de junho para agosto foi de {fmt(delta)} pecas ({fmt(acumulada, 2)}%). "
            'Essa variacao representa a atualizacao do estoque minimo pela media de vendas, e nao uma reducao direta do plano. '
            'O fechamento de agosto passou a influenciar a media trimestral e pode ter elevado o estoque minimo, reduzindo visualmente a cobertura do plano de setembro.'
        )


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Erro: {error}', file=sys.stderr)
        sys.exit(1)
