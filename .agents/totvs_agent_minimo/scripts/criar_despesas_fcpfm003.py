from __future__ import annotations

import argparse
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
MAIN = ROOT / "main.py"


PENDENCIAS = [
    ("1011", "1901", "ELAST. NILLO 25MM AMEIXA U"),
    ("1029", "300", "ELAST. PAJAU 14 MM PRETO U"),
    ("1068", "1697", "ELAST. DONNA 14MM NUDE U"),
    ("13097", "100", "BJ 7004 TQC CASCA BRANCO 50"),
    ("13308", "300", "ELASTICO TUSTI 10MM PRETO U"),
    ("14423", "904", "TAG LIEBE ONE UNICA U"),
    ("4855", "1901", "TEC DE MALHA PLUME ACABADO 158746001011 AMEIXA U"),
    ("615", "1902", "ABOTOADOR 60MM X 03 REGULAGEM - 8758483 MILKSHAKE U"),
]


def run_db_update(seqgrupo: str, cor: str, codigo: int) -> None:
    subprocess.run(
        [
            "node",
            "scripts\\inspect-orcamento-totvs.mjs",
            "marcar-despesa-ok",
            seqgrupo,
            cor,
            str(codigo),
        ],
        cwd=REPO,
        check=True,
    )


def totvs(*args: str) -> None:
    last_error: subprocess.CalledProcessError | None = None
    for attempt in range(3):
        try:
            subprocess.run(
                ["python", str(MAIN), *args],
                cwd=REPO,
                check=True,
            )
            return
        except subprocess.CalledProcessError as error:
            last_error = error
            time.sleep(0.8 + attempt * 0.8)
    raise last_error or RuntimeError("falha ao chamar CLI TOTVS")


def criar_uma(seqgrupo: str, cor: str, descricao: str, codigo: int) -> None:
    print(f"[{codigo}] criando {seqgrupo}/{cor} - {descricao}")

    totvs("ver-tela")
    totvs("clicar", "150", "96")
    totvs("preencher", "130", "486", descricao)
    totvs("preencher", "450", "486", descricao)
    totvs("preencher", "260", "486", "100,00000")

    # Padrao marcado, mesmas opcoes dos itens irmaos validados.
    totvs("clicar", "565", "486")

    totvs("preencher", "610", "486", "Fixo")

    totvs("clicar", "750", "486")
    totvs("clicar", "705", "516")

    totvs("clicar", "834", "486")
    totvs("clicar", "800", "531")

    totvs("clicar", "932", "486")
    totvs("clicar", "884", "504")

    totvs("ver-tela")
    totvs("tecla", "f3")
    time.sleep(1.2)
    totvs("ver-tela")

    run_db_update(seqgrupo, cor, codigo)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-code", type=int, required=True)
    parser.add_argument("--limit", type=int, default=len(PENDENCIAS))
    args = parser.parse_args()

    codigo = args.start_code
    for seqgrupo, cor, descricao in PENDENCIAS[: args.limit]:
        criar_uma(seqgrupo, cor, descricao, codigo)
        codigo += 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
