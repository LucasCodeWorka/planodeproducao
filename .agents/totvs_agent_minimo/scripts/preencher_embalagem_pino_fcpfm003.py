"""Preenche uma linha NOVA do FCPFM003; não grava nem inclui.

Uso: com FCPFM003 aberto e F5 já pressionado, passe a MP e confira a captura
antes de gravar com F3. O código exibido é atribuído pelo TOTVS.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from va_core import input as inp
from va_core.capture import capture, find_window
from va_core.session import TITLE


DESCRICOES = {
    "5000127": "PROT.CONJ ESP  PP 40 X 27 0,05 C/OXI UNICA U",
    "5000138": "EMB 15X18+3X0,05 PP ADS IMPRES NORMAL UNICA U",
    "5000140": "EMB  18X37+3 X 0,05 PP  ADS IMPRES NORMA UNICA U",
    "5000141": "EMB  20X40+3 X 0,05 PP  ADS IMPRE NORMAL UNICA U",
    "5000681": "EMBALAGEN SEM IMPRESSAO 28 X 40 3 X 0,05 UNICA U",
    "5002671": "CONSUMO PINO DE NYLON  FIX PIN 20 MM UNICA U",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mp", choices=DESCRICOES)
    args = parser.parse_args()
    hwnd = find_window(TITLE)
    if hwnd is None:
        raise RuntimeError("TOTVS Moda não encontrado")

    descricao = DESCRICOES[args.mp]
    y = 486
    inp.set_field(hwnd, 130, y, descricao)
    inp.set_field(hwnd, 450, y, descricao)
    inp.set_field(hwnd, 260, y, "100,00000")
    inp.click(hwnd, 565, y)
    inp.click(hwnd, 565, y)
    inp.set_field(hwnd, 610, y, "Fixo")
    inp.click(hwnd, 750, y)
    inp.click(hwnd, 750, y)
    inp.click(hwnd, 710, 518)
    inp.click(hwnd, 834, y)
    inp.click(hwnd, 800, 531)
    inp.click(hwnd, 932, y)
    inp.click(hwnd, 884, 504)
    inp.click(hwnd, 65, 469)
    time.sleep(0.3)

    image, method = capture(hwnd, allow_foreground=False)
    if image is None:
        raise RuntimeError("Não foi possível capturar tela para conferência")
    destino = ROOT / "shots" / f"pre_cadastro_{args.mp}_20261019.png"
    image.save(destino)
    print(f"MP {args.mp}: {descricao}")
    print(f"Preenchimento pronto, NÃO GRAVADO; captura ({method}): {destino}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
