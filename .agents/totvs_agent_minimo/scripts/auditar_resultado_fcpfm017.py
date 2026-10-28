"""Confere o registro reconsultado do FCPFM017 contra o lote conciliado."""
from __future__ import annotations

import json
import argparse
from collections import defaultdict
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1] / "data"
LOTE = RAIZ / "lote-pronto-fcpfm017-2026-10-15.json"
RESULTADO = RAIZ / "resultado-lote-fcpfm017-2026-10-15.jsonl"


def main(lote_path: Path = LOTE, resultado_path: Path = RESULTADO) -> None:
    lote = json.loads(lote_path.read_text(encoding="utf-8"))
    esperado = {}
    for item in lote["lancamentos"]:
        chave = (item["ano"], item["despesa"], item["mes"])
        if chave in esperado:
            raise RuntimeError(f"Competencia duplicada no lote: {chave}")
        esperado[chave] = item["valorCentavos"]

    visto = {}
    pares = set()
    status = defaultdict(int)
    for numero, linha in enumerate(resultado_path.read_text(encoding="utf-8").splitlines(), 1):
        if not linha.strip():
            continue
        item = json.loads(linha)
        par = (item["ano"], item["despesa"])
        if par in pares:
            raise RuntimeError(f"Par duplicado no resultado, linha {numero}: {par}")
        pares.add(par)
        if item["status"] not in {"VERIFICADO", "JA_EXISTIA_CORRETO"}:
            raise RuntimeError(f"Status nao confirmado na linha {numero}: {item['status']}")
        status[item["status"]] += 1
        for mes, centavos in item["mesesCentavos"].items():
            chave = (item["ano"], item["despesa"], int(mes))
            if chave in visto:
                raise RuntimeError(f"Competencia duplicada no resultado: {chave}")
            visto[chave] = centavos

    faltantes = sorted(esperado.keys() - visto.keys())
    extras = sorted(visto.keys() - esperado.keys())
    diferentes = [(chave, esperado[chave], visto[chave]) for chave in esperado.keys() & visto.keys()
                   if esperado[chave] != visto[chave]]
    if faltantes or extras or diferentes:
        raise RuntimeError(f"Auditoria falhou: faltantes={faltantes[:8]}, extras={extras[:8]}, diferentes={diferentes[:8]}")
    pares_esperados = {(ano, despesa) for ano, despesa, _ in esperado}
    if len(pares) != len(pares_esperados) or len(visto) != lote["entradas"]:
        raise RuntimeError(f"Contagem inesperada: {len(pares)} pares, {len(visto)} entradas")
    if sum(visto.values()) != lote["totalCentavos"]:
        raise RuntimeError("Soma de centavos nao fecha")

    mensal = defaultdict(int)
    anual = defaultdict(int)
    for (ano, despesa, mes), centavos in visto.items():
        mensal[f"{ano}-{mes:02d}"] += centavos
        anual[ano] += centavos
    if dict(mensal) != lote["totaisPorCompetencia"]:
        raise RuntimeError(f"Totais por competencia diferentes: {dict(mensal)}")

    print(f"OK: {len(pares)} pares ano/despesa, {len(visto)} entradas, {lote['despesas']} despesas")
    print(f"Status: {dict(status)}")
    for ano in sorted(anual):
        print(f"{ano}: {anual[ano] / 100:.2f}")
    for competencia in sorted(mensal):
        print(f"{competencia}: {mensal[competencia] / 100:.2f}")
    print(f"TOTAL: {sum(visto.values()) / 100:.2f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--lote", type=Path, default=LOTE)
    parser.add_argument("--resultado", type=Path, default=RESULTADO)
    args = parser.parse_args()
    main(args.lote, args.resultado)
