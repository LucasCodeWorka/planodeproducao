"""Lança somente o lote PRONTA no FCPFM017, por competência.

O arquivo de entrada foi conciliado separadamente. Este script nunca cria
despesas nem altera valores preexistentes divergentes: para e pede revisão.
Cada par (ano, despesa) é reconsultado após gravar e só então registrado como
verificado. Use --limit no primeiro teste.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parents[1]
FONTE = RAIZ / "data" / "lote-pronto-fcpfm017-2026-10-15.json"
RESULTADO = RAIZ / "data" / "resultado-lote-fcpfm017-2026-10-15.jsonl"
CAPTURAS = RAIZ / "shots" / "lote_fcpfm017_20261015"

sys.path.insert(0, str(RAIZ))
from va_core import input as inp  # noqa: E402
from va_core import session  # noqa: E402
from va_core.capture import capture, find_window, rect  # noqa: E402
from ocr_fcpfm017 import construir_modelo, ler_valor  # noqa: E402


def tirar(hwnd) -> Image.Image:
    img, metodo = capture(hwnd, allow_foreground=False)
    if img is None or img.size != (1382, 752):
        raise RuntimeError(f"Captura ou resolução inesperada: {getattr(img, 'size', None)}; {metodo}")
    return img


def printar(img: Image.Image, nome: str) -> None:
    CAPTURAS.mkdir(parents=True, exist_ok=True)
    img.save(CAPTURAS / nome)


def modal_confirmacao(img: Image.Image) -> bool:
    r, g, b = img.convert("RGB").getpixel((633, 441))
    return r < 80 and g > 100 and b > 130


def consultar(hwnd, ano: int, despesa: int, modelos) -> Image.Image:
    inp.key(hwnd, "f4")
    # Pode haver aviso de consulta (quando a tela tem manutencao pendente) ou
    # a consulta pode carregar diretamente. Nos dois casos, so aceitar a tela
    # quando ano e codigo da despesa forem os esperados.
    prazo = time.monotonic() + 25
    correspondencia_desde = None
    while time.monotonic() < prazo:
        img = tirar(hwnd)
        if modal_confirmacao(img):
            correspondencia_desde = None
            # Um clique pode cair enquanto a janela ainda processa o F4.
            # So prossiga quando a captura mostrar que o aviso fechou.
            for _ in range(12):
                inp.click(hwnd, 633, 441)
                time.sleep(0.6)
                img = tirar(hwnd)
                if not modal_confirmacao(img):
                    break
            else:
                printar(img, "ERRO_aviso_consulta_nao_fechou.png")
                raise RuntimeError("Aviso de consulta nao fechou apos confirmacoes")
            continue
        try:
            ano_lido = ler(img, 246, modelos)
            codigo_lido = ler(img, 342, modelos, 20, 80)
            if ano_lido == str(ano) and codigo_lido == str(despesa):
                if correspondencia_desde is None:
                    correspondencia_desde = time.monotonic()
                # O aviso do TOTVS pode aparecer depois de a grade ja mostrar
                # o filtro novo. Aguarde estabilizar para nao clicar atras dele.
                if time.monotonic() - correspondencia_desde >= 1.5:
                    return img
            else:
                correspondencia_desde = None
        except RuntimeError:
            correspondencia_desde = None
        time.sleep(0.3)
    printar(img, f"ERRO_{ano}_{despesa}_consulta_nao_carregou.png")
    raise RuntimeError(f"Consulta nao carregou ano={ano}, despesa={despesa}")


def aguardar_linha(hwnd, ano: int, despesa: int, modelos, img: Image.Image) -> Image.Image:
    for _ in range(40):
        if modal_confirmacao(img):
            raise RuntimeError("Aviso de consulta ainda aberto apos confirmacao")
        ano_lido = ler(img, 246, modelos)
        codigo_lido = ler(img, 342, modelos, 20, 80)
        if ano_lido == str(ano) and codigo_lido == str(despesa):
            return img
        time.sleep(0.5)
        img = tirar(hwnd)
    printar(img, f"ERRO_{ano}_{despesa}_filtro.png")
    raise RuntimeError(f"Filtro não corresponde: ano={ano_lido!r} despesa={codigo_lido!r}")


def ler(img: Image.Image, y: int, modelos, x0=798, x1=884) -> str:
    valor, distancias = ler_valor(img, y, modelos, x0, x1)
    if any(distancia > 3 for distancia in distancias):
        raise RuntimeError(f"OCR incerto em {x0}:{x1}, y={y}: {valor!r}, {distancias}")
    return valor


def formatar_centavos(centavos: int) -> str:
    return f"{centavos // 100:,}".replace(",", ".") + f",{centavos % 100:02d}"


def configurar_filtro(hwnd, ano: int, despesa: int, modelos) -> None:
    for tentativa in range(1, 4):
        inp.set_field(hwnd, 136, 182, str(ano))
        inp.key(hwnd, "tab")
        inp.set_field(hwnd, 138, 246, str(despesa))
        inp.key(hwnd, "tab")
        inp.set_field(hwnd, 249, 246, str(despesa))
        inp.key(hwnd, "tab")
        time.sleep(0.5)
        img = tirar(hwnd)
        try:
            inferior = ler(img, 246, modelos, 110, 172).replace(".", "")
            superior = ler(img, 246, modelos, 222, 284).replace(".", "")
        except RuntimeError:
            if tentativa == 3:
                printar(img, f"ERRO_{ano}_{despesa}_ocr_filtro.png")
                raise
            time.sleep(0.4)
            continue
        if inferior == superior == str(despesa):
            return
        if tentativa == 3:
            printar(img, f"ERRO_{ano}_{despesa}_campos_filtro.png")
            raise RuntimeError(
                f"Filtro digitado incorretamente: {inferior!r} a {superior!r}, esperado {despesa}"
            )
        time.sleep(0.4)


def chaves_anteriores() -> set[tuple[int, int]]:
    chaves = set()
    if not RESULTADO.exists():
        return chaves
    for linha in RESULTADO.read_text(encoding="utf-8").splitlines():
        if not linha.strip():
            continue
        item = json.loads(linha)
        if item.get("status") in {"VERIFICADO", "JA_EXISTIA_CORRETO"}:
            chaves.add((int(item["ano"]), int(item["despesa"])))
    return chaves


def registrar(item: dict) -> None:
    with RESULTADO.open("a", encoding="utf-8") as arquivo:
        arquivo.write(json.dumps(item, ensure_ascii=False) + "\n")
        arquivo.flush()


def grupos_do_lote(ano: int | None, despesa: int | None):
    lote = json.loads(FONTE.read_text(encoding="utf-8"))
    entradas = lote.get("lancamentos", [])
    codigos = {item.get("despesa") for item in entradas}
    total = sum(item.get("valorCentavos", 0) for item in entradas)
    if (lote.get("status") != "PREPARADO_NAO_LANCADO"
            or lote.get("plano") != 500 or lote.get("centroCusto") != 506
            or lote.get("despesas") != len(codigos)
            or lote.get("entradas") != len(entradas)
            or lote.get("totalCentavos") != total):
        raise RuntimeError("Arquivo de lote inesperado")
    grupos = {}
    for item in entradas:
        if ano is not None and item["ano"] != ano:
            continue
        if despesa is not None and item["despesa"] != despesa:
            continue
        chave = (item["ano"], item["despesa"])
        grupos.setdefault(chave, {})[item["mes"]] = item["valorCentavos"]
    return sorted(grupos.items())


def executar(args):
    global FONTE, RESULTADO, CAPTURAS
    if args.fonte:
        FONTE = Path(args.fonte).resolve()
    if args.resultado:
        RESULTADO = Path(args.resultado).resolve()
    if args.capturas:
        CAPTURAS = Path(args.capturas).resolve()
    grupos = grupos_do_lote(args.ano, args.despesa)
    feitos = chaves_anteriores()
    pendentes = [(chave, meses) for chave, meses in grupos if chave not in feitos]
    if args.limit is not None:
        pendentes = pendentes[:args.limit]
    print(f"Lote {len(grupos)} pares ano/despesa; pendentes nesta execução {len(pendentes)}", flush=True)
    if args.dry_run or not pendentes:
        for chave, meses in pendentes:
            print(chave, {mes: formatar_centavos(valor) for mes, valor in meses.items()}, flush=True)
        return

    hwnd = find_window(session.TITLE)
    if hwnd is None:
        raise RuntimeError("TOTVS fechado")
    estado, detalhe = session.estado_tela(hwnd)
    if estado != "logado":
        raise RuntimeError(f"TOTVS não confirmado como logado: {estado} {detalhe}")
    tamanho = rect(hwnd)
    if (tamanho["w"], tamanho["h"]) != (1382, 752):
        raise RuntimeError(f"Janela mudou de tamanho: {tamanho}")
    modelos = construir_modelo(RAIZ / "shots")

    for indice, ((ano, despesa), meses) in enumerate(pendentes, 1):
        print(f"[{indice}/{len(pendentes)}] {ano}/{despesa}: {meses}", flush=True)
        configurar_filtro(hwnd, ano, despesa, modelos)
        img = aguardar_linha(hwnd, ano, despesa, modelos, consultar(hwnd, ano, despesa, modelos))

        inp.click(hwnd, 385, 342)
        time.sleep(0.2)
        img = tirar(hwnd)
        printar(img, f"{ano}_{despesa}_antes.png")
        faltantes = {}
        for mes, centavos in meses.items():
            lido = ler(img, 262 + (mes - 1) * 16, modelos)
            esperado = formatar_centavos(centavos)
            if lido == esperado:
                continue
            if lido not in {"", "0,00"}:
                raise RuntimeError(f"Valor preexistente diferente em {ano}/{despesa}/{mes}: {lido!r} != {esperado!r}")
            faltantes[mes] = centavos

        if faltantes:
            for mes, centavos in faltantes.items():
                esperado = formatar_centavos(centavos)
                for tentativa in range(1, 4):
                    inp.set_field(hwnd, 845, 262 + (mes - 1) * 16, esperado)
                    inp.key(hwnd, "tab")
                    time.sleep(0.5)
                    img = tirar(hwnd)
                    if modal_confirmacao(img):
                        printar(img, f"ERRO_{ano}_{despesa}_{mes}_aviso_na_digitacao.png")
                        raise RuntimeError(f"Aviso inesperado durante digitacao de {ano}/{despesa}/{mes}")
                    lido = ler(img, 262 + (mes - 1) * 16, modelos)
                    if lido == esperado:
                        break
                    if tentativa == 3:
                        printar(img, f"ERRO_{ano}_{despesa}_{mes}_digitacao.png")
                        raise RuntimeError(f"Valor nao entrou em {ano}/{despesa}/{mes}: {lido!r} != {esperado!r}")
            img = tirar(hwnd)
            for mes, centavos in meses.items():
                lido = ler(img, 262 + (mes - 1) * 16, modelos)
                esperado = formatar_centavos(centavos)
                if lido != esperado:
                    printar(img, f"ERRO_{ano}_{despesa}_antes_gravar.png")
                    raise RuntimeError(f"Valor digitado não confere em {ano}/{despesa}/{mes}: {lido!r} != {esperado!r}")
            inp.click(hwnd, 100, 96)
            time.sleep(0.5)

        img = aguardar_linha(hwnd, ano, despesa, modelos, consultar(hwnd, ano, despesa, modelos))
        inp.click(hwnd, 385, 342)
        time.sleep(0.2)
        img = tirar(hwnd)
        printar(img, f"{ano}_{despesa}_verificado.png")
        for mes, centavos in meses.items():
            lido = ler(img, 262 + (mes - 1) * 16, modelos)
            esperado = formatar_centavos(centavos)
            if lido != esperado:
                raise RuntimeError(f"Valor não persistiu em {ano}/{despesa}/{mes}: {lido!r} != {esperado!r}")
        status = "VERIFICADO" if faltantes else "JA_EXISTIA_CORRETO"
        registrar({"status": status, "ano": ano, "despesa": despesa,
                   "mesesCentavos": meses, "verificadoEm": datetime.now(timezone.utc).isoformat()})
        print(f"  {status}: {sum(meses.values()) / 100:.2f}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", "--ano", type=int, dest="ano", choices=[2026, 2027])
    parser.add_argument("--despesa", type=int)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--fonte", type=str, help="Lote JSON; padrao e o lote original de 197 despesas")
    parser.add_argument("--resultado", type=str, help="Arquivo JSONL de resultado")
    parser.add_argument("--capturas", type=str, help="Pasta das capturas de verificacao")
    executar(parser.parse_args())
