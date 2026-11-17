import json
from pathlib import Path

rows = json.loads(Path('outputs/revisao_producao/revisao.json').read_text(encoding='utf-8'))
revisadas = {r['referencia']: r['grupos'] for r in rows if r['revisao'].strip().lower() == 'corretas' and r['grupos']}
primeiro_explicito = {
    '121302': '07 - DESAFIO CA FASHION',
    '501004': '07 - EVOLUCAO CA FASHION',
    '301705': '08 - CONQUISTA CA BASICO/FASHION',
    '302000': '08 - CONQUISTA CA BASICO/FASHION',
    '501745': '07 - DESAFIO CA FASHION',
    '103006': '04 - HARMONIA SU BASICO',
    '103102': '04 - HARMONIA SU BASICO',
    '341001': '08 - OBJETIVO SO BASICO',
}
for ref, grupo in primeiro_explicito.items():
    linha = next((r for r in rows if r['referencia'] == ref), None)
    if not linha or 'primeiro' not in linha['observacao'].lower():
        raise ValueError(f'Indicação de primeiro grupo não encontrada para {ref}.')
    # A observação confirma só o primeiro grupo; os demais da linha estavam sob revisão.
    revisadas[ref] = [grupo]
saida = {'origem': 'Revisão de produção recebida em 16/11/2026; itens corretos e indicações explícitas de primeiro grupo; usar apenas quando não houver histórico próprio na janela consultada.', 'referencias': revisadas}
Path('data/revisao_pcp_preferencias.json').write_text(json.dumps(saida, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'{len(revisadas)} referências com opções revisadas.')
