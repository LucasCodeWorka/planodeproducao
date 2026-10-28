r"""Prepara o FCRFP018 ate "Marcar todas", sem gerar a remessa.

Execute da raiz do projeto, com o TOTVS Moda fechado:
    python .agents\totvs_agent_minimo\scripts\preparar_remessa_fcrfp018.py

O login continua no agente existente e le as credenciais do .env. Este arquivo
nao contem senha nem qualquer acao para o botao "Gerar remessa".
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime
from pathlib import Path

import numpy as np
from dotenv import load_dotenv

AGENTE = Path(__file__).resolve().parents[1]
PROJETO = AGENTE.parents[1]
# O operador pode iniciar o script de dentro de .agents/totvs_agent_minimo;
# nesse caso Path.cwd() nao aponta para o .env da raiz do projeto.
load_dotenv(PROJETO / ".env")
sys.path.insert(0, str(AGENTE))

from core.va_bridge import VaBridge  # noqa: E402
from va_core import input as inp  # noqa: E402
from va_core import session  # noqa: E402
from va_core.capture import capture, find_window, rect  # noqa: E402


# Coordenadas validadas na janela TOTVS Moda de 1382 x 752 pixels.
TAMANHO_VALIDADO = (1382, 752)
CAMPO_CONTA = (140, 211)
MARCAR_TODAS = (991, 307)
CONTA = "16862"


def _capturar(hwnd, pasta: Path, etapa: str):
    imagem, metodo = capture(hwnd, allow_foreground=False)
    if imagem is None:
        raise RuntimeError(f"nao foi possivel capturar a tela em {etapa} ({metodo})")
    destino = pasta / f"{etapa}.png"
    imagem.save(destino)
    print(f"{etapa}: {destino}", flush=True)
    return imagem


def _validar_janela(hwnd) -> None:
    tamanho = (rect(hwnd)["w"], rect(hwnd)["h"])
    if tamanho != TAMANHO_VALIDADO:
        raise RuntimeError(
            f"janela {tamanho}, mas coordenadas validadas para {TAMANHO_VALIDADO}; "
            "ajuste o tamanho antes de executar novamente"
        )
    estado, detalhe = session.estado_tela(hwnd)
    if estado != "logado":
        raise RuntimeError(f"TOTVS nao esta na tela logada: {estado} ({detalhe})")


def _texto_escuro_na_grade(imagem) -> int:
    cinza = np.asarray(imagem.convert("L"))
    return int(np.count_nonzero(cinza[320:630, 25:975] < 110))


def _checkboxes_marcados(imagem) -> int:
    """Conta os 10 primeiros checks visiveis (a grade tem 16 px por linha)."""
    cinza = np.asarray(imagem.convert("L"))
    return sum(
        np.count_nonzero(cinza[y : y + 15, 984:998] < 150) >= 30
        for y in range(317, 317 + 10 * 16, 16)
    )


def _esperar_grade(hwnd, pasta: Path, timeout: float = 25):
    limite = time.monotonic() + timeout
    while time.monotonic() < limite:
        imagem, _ = capture(hwnd, allow_foreground=False)
        if imagem is not None and _texto_escuro_na_grade(imagem) > 8000:
            return _capturar(hwnd, pasta, "04_titulos_localizados")
        time.sleep(1)
    _capturar(hwnd, pasta, "04_busca_nao_confirmada")
    raise RuntimeError("a grade de titulos nao carregou; nada foi marcado")


def preparar() -> Path:
    # Em uma janela ja aberta nao sabemos qual componente/campo esta em foco.
    # Recusar evita repetir o fluxo e, sobretudo, desmarcar titulos existentes.
    if find_window(session.TITLE) is not None:
        raise RuntimeError(
            "TOTVS ja esta aberto. Feche a sessao antes de rodar este script "
            "do zero; nenhuma tecla foi enviada."
        )

    pasta = AGENTE / "shots" / f"fcrfp018_{datetime.now():%Y%m%d_%H%M%S}"
    pasta.mkdir(parents=True, exist_ok=False)
    ponte = VaBridge()

    print("Abrindo TOTVS e preparando o campo Procurar...", flush=True)
    print(ponte.login_ate_campo_componente(), flush=True)
    hwnd = find_window(session.TITLE)
    if hwnd is None:
        raise RuntimeError("janela do TOTVS nao encontrada apos a abertura")
    _validar_janela(hwnd)
    _capturar(hwnd, pasta, "01_pagina_inicial")

    print("Abrindo FCRFP018...", flush=True)
    print(ponte.abrir_componente("FCRFP018"), flush=True)
    _validar_janela(hwnd)
    imagem = _capturar(hwnd, pasta, "02_fcrfp018_aberto")
    if _texto_escuro_na_grade(imagem) > 200:
        raise RuntimeError("a grade nao esta vazia apos abrir o componente")

    inp.set_field(hwnd, *CAMPO_CONTA, CONTA)
    time.sleep(0.8)
    for tecla in ("tab", "tab", "down", "down", "enter", "tab", "tab"):
        inp.key(hwnd, tecla)
        time.sleep(0.7)
    _capturar(hwnd, pasta, "03_conta_e_sequencia")

    inp.key(hwnd, "alt+b")
    time.sleep(1.2)
    filtro = _capturar(hwnd, pasta, "03a_filtro_aberto")
    pontos_escuros = _texto_escuro_na_grade(filtro)
    if not 200 < pontos_escuros < 8000:
        raise RuntimeError("o filtro de busca nao foi confirmado; nada foi marcado")

    inp.key(hwnd, "alt+o")
    imagem = _esperar_grade(hwnd, pasta)
    if _checkboxes_marcados(imagem):
        raise RuntimeError("ja ha titulos marcados; nao vou alternar Marcar todas")

    inp.click(hwnd, *MARCAR_TODAS)
    time.sleep(1)
    imagem = _capturar(hwnd, pasta, "05_todas_marcadas")
    marcados_visiveis = _checkboxes_marcados(imagem)
    if marcados_visiveis != 10:
        raise RuntimeError(
            f"marcacao nao confirmada ({marcados_visiveis}/10 checks visiveis); "
            "confira a captura. Nenhuma remessa foi gerada."
        )

    print("Pronto: titulos marcados. Gerar remessa NAO foi acionado.", flush=True)
    return pasta


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true", help="mostra o fluxo sem tocar no TOTVS"
    )
    args = parser.parse_args()
    if args.dry_run:
        print(
            "TOTVS fechado -> abrir-sistema -> abrir FCRFP018 -> conta 16862 -> "
            "Tab, Tab, baixo, baixo, Enter, Tab, Tab -> Alt+B -> Alt+O -> "
            "Marcar todas -> PARAR (sem Gerar remessa)"
        )
        return 0
    try:
        preparar()
        return 0
    except Exception as erro:
        print(f"PAROU COM SEGURANCA: {erro}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
