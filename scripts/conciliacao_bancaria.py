import argparse
import csv
import datetime as dt
import difflib
import itertools
import os
import re
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


VALUE_HEADERS = (
    'valor',
    'vlr',
    'amount',
    'montante',
    'liquido',
    'pagamento',
    'pago',
    'credito',
    'debito',
)
DATE_HEADERS = ('data', 'dt', 'emissao', 'movimento', 'lancamento', 'pagamento', 'baixa')
DESC_HEADERS = ('historico', 'descricao', 'desc', 'nome', 'favorecido', 'fornecedor', 'cliente', 'sacado')
DOC_HEADERS = ('doc', 'documento', 'titulo', 'numero', 'num', 'pedido', 'nf', 'nota')


@dataclass(frozen=True)
class Row:
    source: str
    index: int
    raw: dict
    amount_cents: int
    date: dt.date | None
    desc: str
    doc: str


@dataclass(frozen=True)
class Match:
    status: str
    side: str
    bank_rows: tuple[int, ...]
    system_rows: tuple[int, ...]
    bank_total: int
    system_total: int
    diff: int
    score: float
    note: str


def norm_text(value) -> str:
    text = '' if value is None else str(value)
    text = unicodedata.normalize('NFKD', text)
    text = ''.join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r'\s+', ' ', text).strip().lower()
    return text


def only_digits(value) -> str:
    return re.sub(r'\D+', '', '' if value is None else str(value))


def money_to_cents(value) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return int(round(float(value) * 100))

    text = str(value).strip()
    if not text:
        return None
    negative = '-' in text or (text.startswith('(') and text.endswith(')'))
    text = text.replace('R$', '').replace('r$', '').replace(' ', '')
    text = re.sub(r'[^0-9,.\-]', '', text)
    text = text.replace('-', '')
    if not text:
        return None

    if ',' in text and '.' in text:
        if text.rfind(',') > text.rfind('.'):
            text = text.replace('.', '').replace(',', '.')
        else:
            text = text.replace(',', '')
    elif ',' in text:
        text = text.replace('.', '').replace(',', '.')

    try:
        cents = int(round(float(text) * 100))
    except ValueError:
        return None
    return -cents if negative else cents


def cents_to_br(value: int) -> str:
    sign = '-' if value < 0 else ''
    value = abs(int(value))
    reais, cents = divmod(value, 100)
    inteiro = f'{reais:,}'.replace(',', '.')
    return f'{sign}{inteiro},{cents:02d}'


def parse_date(value) -> dt.date | None:
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    text = str(value).strip()
    if not text:
        return None

    text = text.split()[0]
    formats = ('%d/%m/%Y', '%d/%m/%y', '%Y-%m-%d', '%d-%m-%Y', '%d.%m.%Y')
    for fmt in formats:
        try:
            return dt.datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    return None


def sniff_dialect(path: Path, encoding: str):
    with path.open('r', encoding=encoding, newline='') as file:
        sample = file.read(8192)
    try:
        return csv.Sniffer().sniff(sample, delimiters=';,|\t,')
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ';'
        return dialect


def read_csv_rows(path: Path) -> list[dict]:
    last_error = None
    for encoding in ('utf-8-sig', 'cp1252', 'latin1'):
        try:
            dialect = sniff_dialect(path, encoding)
            with path.open('r', encoding=encoding, newline='') as file:
                return list(csv.DictReader(file, dialect=dialect))
        except UnicodeDecodeError as error:
            last_error = error
    raise RuntimeError(f'Nao consegui ler CSV {path}: {last_error}')


def read_xlsx_rows(path: Path) -> list[dict]:
    try:
        import openpyxl
    except ImportError as error:
        raise RuntimeError('Para ler XLSX, instale openpyxl ou salve o arquivo como CSV.') from error

    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.active
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [str(value or '').strip() for value in rows[0]]
    output = []
    for values in rows[1:]:
        row = {headers[i]: values[i] if i < len(values) else '' for i in range(len(headers)) if headers[i]}
        if any(value not in (None, '') for value in row.values()):
            output.append(row)
    return output


def read_rows(path: Path) -> list[dict]:
    suffix = path.suffix.lower()
    if suffix == '.csv' or suffix == '.txt':
        return read_csv_rows(path)
    if suffix in ('.xlsx', '.xlsm'):
        return read_xlsx_rows(path)
    raise RuntimeError(f'Formato nao suportado: {path.suffix}. Use CSV ou XLSX.')


def find_column(headers: Iterable[str], explicit: str | None, candidates: tuple[str, ...], role: str) -> str | None:
    headers = list(headers)
    if explicit:
        for header in headers:
            if norm_text(header) == norm_text(explicit):
                return header
        raise RuntimeError(f'Coluna {role} informada nao existe: {explicit}')

    scored = []
    for header in headers:
        normalized = norm_text(header)
        score = 0
        for candidate in candidates:
            if candidate in normalized:
                score += 10 if normalized == candidate else 5
        if 'saldo' in normalized and role == 'valor':
            score -= 8
        if score > 0:
            scored.append((score, header))
    scored.sort(reverse=True)
    return scored[0][1] if scored else None


def build_rows(
    source: str,
    raw_rows: list[dict],
    value_col: str | None,
    date_col: str | None,
    desc_col: str | None,
    doc_col: str | None,
    absolute_values: bool,
) -> tuple[list[Row], dict[str, str | None]]:
    headers = list(raw_rows[0].keys()) if raw_rows else []
    detected_value = find_column(headers, value_col, VALUE_HEADERS, 'valor')
    detected_date = find_column(headers, date_col, DATE_HEADERS, 'data')
    detected_desc = find_column(headers, desc_col, DESC_HEADERS, 'descricao')
    detected_doc = find_column(headers, doc_col, DOC_HEADERS, 'documento')

    if not detected_value:
        raise RuntimeError(f'Nao achei coluna de valor em {source}. Informe --{source}-valor.')

    rows = []
    for index, raw in enumerate(raw_rows, start=2):
        cents = money_to_cents(raw.get(detected_value))
        if cents is None or cents == 0:
            continue
        if absolute_values:
            cents = abs(cents)
        rows.append(Row(
            source=source,
            index=index,
            raw=raw,
            amount_cents=cents,
            date=parse_date(raw.get(detected_date)) if detected_date else None,
            desc=str(raw.get(detected_desc) or '') if detected_desc else '',
            doc=str(raw.get(detected_doc) or '') if detected_doc else '',
        ))

    detected = {
        'valor': detected_value,
        'data': detected_date,
        'descricao': detected_desc,
        'documento': detected_doc,
    }
    return rows, detected


def date_distance(a: Row, b: Row) -> int:
    if not a.date or not b.date:
        return 999
    return abs((a.date - b.date).days)


def text_score(a_rows: list[Row], b_rows: list[Row]) -> float:
    a_text = ' '.join(norm_text(row.desc) for row in a_rows if row.desc)
    b_text = ' '.join(norm_text(row.desc) for row in b_rows if row.desc)
    if not a_text or not b_text:
        return 0.0
    return difflib.SequenceMatcher(None, a_text, b_text).ratio()


def doc_score(a_rows: list[Row], b_rows: list[Row]) -> float:
    a_docs = {only_digits(row.doc) for row in a_rows if only_digits(row.doc)}
    b_docs = {only_digits(row.doc) for row in b_rows if only_digits(row.doc)}
    if not a_docs or not b_docs:
        return 0.0
    return 1.0 if a_docs & b_docs else 0.0


def candidate_score(bank_rows: list[Row], system_rows: list[Row], diff: int) -> float:
    total = max(sum(row.amount_cents for row in bank_rows), sum(row.amount_cents for row in system_rows), 1)
    diff_score = max(0.0, 1.0 - abs(diff) / total)
    distances = [date_distance(bank, sysrow) for bank in bank_rows for sysrow in system_rows]
    best_distance = min(distances) if distances else 999
    date_score = 0.0 if best_distance == 999 else max(0.0, 1.0 - best_distance / 10)
    return (diff_score * 0.55) + (date_score * 0.20) + (text_score(bank_rows, system_rows) * 0.15) + (doc_score(bank_rows, system_rows) * 0.10)


def same_date_window(base: Row, candidate: Row, days: int) -> bool:
    if not base.date or not candidate.date:
        return True
    return abs((base.date - candidate.date).days) <= days


def find_subset(
    target: int,
    candidates: list[Row],
    tolerance: int,
    max_size: int,
    max_results: int,
) -> list[tuple[Row, ...]]:
    candidates = [row for row in candidates if row.amount_cents <= target + tolerance]
    candidates = sorted(candidates, key=lambda row: row.amount_cents, reverse=True)
    results = []

    def dfs(start: int, picked: list[Row], total: int):
        if len(results) >= max_results:
            return
        diff = total - target
        if picked and abs(diff) <= tolerance:
            results.append(tuple(picked))
            return
        if len(picked) >= max_size or total > target + tolerance:
            return
        for pos in range(start, len(candidates)):
            row = candidates[pos]
            if total + row.amount_cents > target + tolerance:
                continue
            picked.append(row)
            dfs(pos + 1, picked, total + row.amount_cents)
            picked.pop()

    dfs(0, [], 0)
    return results


def reconcile(
    bank_rows: list[Row],
    system_rows: list[Row],
    date_window: int,
    tolerance_cents: int,
    max_combo: int,
    candidate_limit: int,
) -> list[Match]:
    matches: list[Match] = []
    used_bank: set[int] = set()
    used_system: set[int] = set()

    direct_candidates = []
    for bank in bank_rows:
        for sysrow in system_rows:
            diff = bank.amount_cents - sysrow.amount_cents
            if abs(diff) > tolerance_cents:
                continue
            if not same_date_window(bank, sysrow, date_window):
                continue
            score = candidate_score([bank], [sysrow], diff)
            direct_candidates.append((score, -date_distance(bank, sysrow), bank.index, sysrow.index, bank, sysrow, diff))

    direct_candidates.sort(reverse=True)
    for score, _date_rank, _bank_index, _sys_index, bank, sysrow, diff in direct_candidates:
        if bank.index in used_bank or sysrow.index in used_system:
            continue
        matches.append(Match(
            status='conciliado_exato_1x1' if diff == 0 else 'conciliado_com_diferenca_tolerada',
            side='1 banco x 1 sistema',
            bank_rows=(bank.index,),
            system_rows=(sysrow.index,),
            bank_total=bank.amount_cents,
            system_total=sysrow.amount_cents,
            diff=diff,
            score=score,
            note='Valor exato' if diff == 0 else 'Valor fecha dentro da tolerancia',
        ))
        used_bank.add(bank.index)
        used_system.add(sysrow.index)

    combo_candidates: list[tuple[float, Match]] = []
    remaining_bank = [row for row in bank_rows if row.index not in used_bank]
    remaining_system = [row for row in system_rows if row.index not in used_system]

    for bank in remaining_bank:
        pool = [row for row in remaining_system if same_date_window(bank, row, date_window)]
        pool = sorted(pool, key=lambda row: (date_distance(bank, row), -row.amount_cents))[:candidate_limit]
        for combo in find_subset(bank.amount_cents, pool, tolerance_cents, max_combo, 3):
            system_total = sum(row.amount_cents for row in combo)
            diff = bank.amount_cents - system_total
            score = candidate_score([bank], list(combo), diff)
            match = Match(
                status='conciliado_por_combinacao' if diff == 0 else 'conciliado_com_diferenca_tolerada',
                side=f'1 banco x {len(combo)} sistema',
                bank_rows=(bank.index,),
                system_rows=tuple(row.index for row in combo),
                bank_total=bank.amount_cents,
                system_total=system_total,
                diff=diff,
                score=score,
                note='Soma de linhas do sistema fecha o banco' if diff == 0 else 'Soma fecha dentro da tolerancia',
            )
            combo_candidates.append((score, match))

    for sysrow in remaining_system:
        pool = [row for row in remaining_bank if same_date_window(sysrow, row, date_window)]
        pool = sorted(pool, key=lambda row: (date_distance(row, sysrow), -row.amount_cents))[:candidate_limit]
        for combo in find_subset(sysrow.amount_cents, pool, tolerance_cents, max_combo, 3):
            bank_total = sum(row.amount_cents for row in combo)
            diff = bank_total - sysrow.amount_cents
            score = candidate_score(list(combo), [sysrow], diff)
            match = Match(
                status='conciliado_por_combinacao' if diff == 0 else 'conciliado_com_diferenca_tolerada',
                side=f'{len(combo)} banco x 1 sistema',
                bank_rows=tuple(row.index for row in combo),
                system_rows=(sysrow.index,),
                bank_total=bank_total,
                system_total=sysrow.amount_cents,
                diff=diff,
                score=score,
                note='Soma de linhas do banco fecha o sistema' if diff == 0 else 'Soma fecha dentro da tolerancia',
            )
            combo_candidates.append((score, match))

    combo_candidates.sort(key=lambda item: (item[0], -len(item[1].bank_rows), -len(item[1].system_rows)), reverse=True)
    for _score, match in combo_candidates:
        if any(index in used_bank for index in match.bank_rows):
            continue
        if any(index in used_system for index in match.system_rows):
            continue
        matches.append(match)
        used_bank.update(match.bank_rows)
        used_system.update(match.system_rows)

    for bank in bank_rows:
        if bank.index not in used_bank:
            matches.append(Match(
                status='sem_candidato_confirmado',
                side='banco_sem_match',
                bank_rows=(bank.index,),
                system_rows=(),
                bank_total=bank.amount_cents,
                system_total=0,
                diff=bank.amount_cents,
                score=0.0,
                note='Nao conciliado pelo motor',
            ))
    for sysrow in system_rows:
        if sysrow.index not in used_system:
            matches.append(Match(
                status='sem_candidato_confirmado',
                side='sistema_sem_match',
                bank_rows=(),
                system_rows=(sysrow.index,),
                bank_total=0,
                system_total=sysrow.amount_cents,
                diff=-sysrow.amount_cents,
                score=0.0,
                note='Nao conciliado pelo motor',
            ))
    return matches


def row_lookup(rows: list[Row]) -> dict[int, Row]:
    return {row.index: row for row in rows}


def join_indexes(indexes: Iterable[int]) -> str:
    return '+'.join(str(index) for index in indexes)


def join_values(indexes: Iterable[int], lookup: dict[int, Row], attr: str) -> str:
    values = []
    for index in indexes:
        value = getattr(lookup[index], attr)
        if isinstance(value, dt.date):
            value = value.isoformat()
        values.append(str(value or ''))
    return ' | '.join(values)


def write_csv_report(path: Path, matches: list[Match], bank_rows: list[Row], system_rows: list[Row]):
    bank_lookup = row_lookup(bank_rows)
    system_lookup = row_lookup(system_rows)
    with path.open('w', encoding='utf-8-sig', newline='') as file:
        writer = csv.DictWriter(file, fieldnames=[
            'status',
            'lado',
            'linhas_banco',
            'linhas_sistema',
            'total_banco',
            'total_sistema',
            'diferenca',
            'score',
            'datas_banco',
            'datas_sistema',
            'historico_banco',
            'historico_sistema',
            'documento_banco',
            'documento_sistema',
            'observacao',
        ], delimiter=';')
        writer.writeheader()
        for match in matches:
            writer.writerow({
                'status': match.status,
                'lado': match.side,
                'linhas_banco': join_indexes(match.bank_rows),
                'linhas_sistema': join_indexes(match.system_rows),
                'total_banco': cents_to_br(match.bank_total),
                'total_sistema': cents_to_br(match.system_total),
                'diferenca': cents_to_br(match.diff),
                'score': f'{match.score:.4f}'.replace('.', ','),
                'datas_banco': join_values(match.bank_rows, bank_lookup, 'date') if match.bank_rows else '',
                'datas_sistema': join_values(match.system_rows, system_lookup, 'date') if match.system_rows else '',
                'historico_banco': join_values(match.bank_rows, bank_lookup, 'desc') if match.bank_rows else '',
                'historico_sistema': join_values(match.system_rows, system_lookup, 'desc') if match.system_rows else '',
                'documento_banco': join_values(match.bank_rows, bank_lookup, 'doc') if match.bank_rows else '',
                'documento_sistema': join_values(match.system_rows, system_lookup, 'doc') if match.system_rows else '',
                'observacao': match.note,
            })


def summarize(matches: list[Match]) -> dict[str, dict[str, int]]:
    summary: dict[str, dict[str, int]] = {}
    for match in matches:
        item = summary.setdefault(match.status, {'linhas': 0, 'valor_banco': 0, 'valor_sistema': 0})
        item['linhas'] += 1
        item['valor_banco'] += match.bank_total
        item['valor_sistema'] += match.system_total
    return summary


def write_md_report(path: Path, matches: list[Match], detected_bank: dict, detected_system: dict):
    summary = summarize(matches)
    ordered_statuses = [
        'conciliado_exato_1x1',
        'conciliado_por_combinacao',
        'conciliado_com_diferenca_tolerada',
        'sem_candidato_confirmado',
    ]
    with path.open('w', encoding='utf-8') as file:
        file.write('# Relatorio de conciliacao bancaria\n\n')
        file.write('## Colunas detectadas\n\n')
        file.write(f"- Banco: {detected_bank}\n")
        file.write(f"- Sistema: {detected_system}\n\n")
        file.write('## Resumo\n\n')
        file.write('| Status | Grupos | Total banco | Total sistema |\n')
        file.write('|---|---:|---:|---:|\n')
        for status in ordered_statuses:
            item = summary.get(status, {'linhas': 0, 'valor_banco': 0, 'valor_sistema': 0})
            file.write(
                f"| {status} | {item['linhas']} | R$ {cents_to_br(item['valor_banco'])} | "
                f"R$ {cents_to_br(item['valor_sistema'])} |\n"
            )
        file.write('\n## Observacao\n\n')
        file.write(
            'O status sem_candidato_confirmado nao significa impossivel conciliar. '
            'Significa apenas que o motor nao encontrou prova suficiente com os limites usados. '
            'Aumente --max-combo, --date-window ou --candidate-limit para uma busca mais agressiva.\n'
        )


def run_self_test():
    bank_rows = [
        Row('banco', 2, {}, 10000, dt.date(2026, 9, 18), 'PIX FORNECEDOR ABC', '100'),
        Row('banco', 3, {}, 7891, dt.date(2026, 9, 18), 'TARIFA', ''),
        Row('banco', 4, {}, 30000, dt.date(2026, 9, 18), 'PAGAMENTO LOTE XYZ', '200'),
    ]
    system_rows = [
        Row('sistema', 2, {}, 10000, dt.date(2026, 9, 18), 'Fornecedor ABC baixa', '100'),
        Row('sistema', 3, {}, 12000, dt.date(2026, 9, 18), 'XYZ titulo 1', '201'),
        Row('sistema', 4, {}, 18000, dt.date(2026, 9, 18), 'XYZ titulo 2', '202'),
        Row('sistema', 5, {}, 7891, dt.date(2026, 9, 19), 'Tarifa bancaria', ''),
    ]
    matches = reconcile(bank_rows, system_rows, date_window=3, tolerance_cents=0, max_combo=4, candidate_limit=20)
    exact = [match for match in matches if match.status == 'conciliado_exato_1x1']
    combo = [match for match in matches if match.status == 'conciliado_por_combinacao']
    if len(exact) != 2 or len(combo) != 1:
        raise AssertionError(f'Self-test falhou: exatos={len(exact)} combos={len(combo)}')
    print('Self-test OK: 2 exatos e 1 combinacao encontrados.')


def main():
    parser = argparse.ArgumentParser(description='Motor auditavel de conciliacao bancaria por valores e combinacoes.')
    parser.add_argument('--banco', help='Arquivo CSV/XLSX do banco.')
    parser.add_argument('--sistema', help='Arquivo CSV/XLSX do sistema.')
    parser.add_argument('--out-dir', default='data/conciliacao_saida', help='Pasta de saida dos relatorios.')
    parser.add_argument('--banco-valor')
    parser.add_argument('--banco-data')
    parser.add_argument('--banco-descricao')
    parser.add_argument('--banco-documento')
    parser.add_argument('--sistema-valor')
    parser.add_argument('--sistema-data')
    parser.add_argument('--sistema-descricao')
    parser.add_argument('--sistema-documento')
    parser.add_argument('--date-window', type=int, default=3, help='Dias de tolerancia entre banco e sistema.')
    parser.add_argument('--tolerance', default='0,00', help='Diferenca aceita no fechamento. Ex: 0,01 ou 78,91.')
    parser.add_argument('--max-combo', type=int, default=6, help='Maximo de linhas em uma combinacao.')
    parser.add_argument('--candidate-limit', type=int, default=45, help='Maximo de candidatos por busca de combinacao.')
    parser.add_argument('--preserve-sign', action='store_true', help='Nao converter valores para absoluto.')
    parser.add_argument('--self-test', action='store_true', help='Roda teste interno rapido.')
    args = parser.parse_args()

    if args.self_test:
        run_self_test()
        return

    if not args.banco or not args.sistema:
        parser.error('Informe --banco e --sistema, ou use --self-test.')

    banco_path = Path(args.banco)
    sistema_path = Path(args.sistema)
    if not banco_path.exists():
        raise RuntimeError(f'Arquivo do banco nao existe: {banco_path}')
    if not sistema_path.exists():
        raise RuntimeError(f'Arquivo do sistema nao existe: {sistema_path}')

    absolute_values = not args.preserve_sign
    raw_bank = read_rows(banco_path)
    raw_system = read_rows(sistema_path)
    bank_rows, detected_bank = build_rows(
        'banco',
        raw_bank,
        args.banco_valor,
        args.banco_data,
        args.banco_descricao,
        args.banco_documento,
        absolute_values,
    )
    system_rows, detected_system = build_rows(
        'sistema',
        raw_system,
        args.sistema_valor,
        args.sistema_data,
        args.sistema_descricao,
        args.sistema_documento,
        absolute_values,
    )
    tolerance = abs(money_to_cents(args.tolerance) or 0)
    matches = reconcile(
        bank_rows,
        system_rows,
        date_window=args.date_window,
        tolerance_cents=tolerance,
        max_combo=args.max_combo,
        candidate_limit=args.candidate_limit,
    )

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / 'conciliacao_resultado.csv'
    md_path = out_dir / 'conciliacao_resumo.md'
    write_csv_report(csv_path, matches, bank_rows, system_rows)
    write_md_report(md_path, matches, detected_bank, detected_system)

    print(f'Banco: {len(bank_rows)} linhas validas | Sistema: {len(system_rows)} linhas validas')
    print(f'Colunas banco: {detected_bank}')
    print(f'Colunas sistema: {detected_system}')
    print(f'Relatorio CSV: {csv_path}')
    print(f'Resumo MD: {md_path}')
    for status, item in summarize(matches).items():
        print(f"{status}: {item['linhas']} grupos | banco R$ {cents_to_br(item['valor_banco'])} | sistema R$ {cents_to_br(item['valor_sistema'])}")


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Erro: {error}', file=sys.stderr)
        sys.exit(1)
