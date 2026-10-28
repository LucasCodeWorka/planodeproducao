"""Vincula despesas existentes ao PCP/506, conferindo o código no FCPFL020.

Usa o lote conferido contra o espelho SQL. O piloto 11681 já foi feito.
Interrompe em qualquer divergência visual e registra cada sucesso isoladamente.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from main import _alerta_totvs_aberto, _posicao_fcpfl020, _selecionar_pcp_506
from ocr_fcpfm017 import construir_modelo, ler_valor
from va_core import input as inp
from va_core.capture import capture, find_window
from va_core import session

LOTE = ROOT / "data" / "lote-42-fcpfm043-2026-10-16.json"
RESULTADO = ROOT / "data" / "resultado-42-fcpfm043-2026-10-16.jsonl"
CAPTURAS = ROOT / "shots" / "lote_42_fcpfm043_20261016"
REFERENCIA_SUCESSO = ROOT / "shots" / "ag_093708.png"
REFERENCIA_PAI = CAPTURAS / "163152_11683_pai_inconclusivo.png"
CAMPO_PAI = (139, 192, 172, 204)


def imagem(hwnd):
    img, metodo = capture(hwnd, allow_foreground=False)
    if img is None or img.size != (1382, 752):
        raise RuntimeError(f"captura inválida: {metodo}, {img.size if img else None}")
    return img


def guardar(img: Image.Image, codigo: int, etapa: str):
    CAPTURAS.mkdir(parents=True, exist_ok=True)
    caminho = CAPTURAS / f"{datetime.now():%H%M%S}_{codigo}_{etapa}.png"
    img.save(caminho)
    return str(caminho)


def codigo_linha(img, popup_x: int, popup_y: int, indice: int, modelo):
    y = popup_y + 334 + 16 * indice
    # Faixa interna da coluna Código, sem a borda esquerda nem a primeira
    # letra da descrição (ambas já apareceram em capturas anteriores).
    lido, distancias = ler_valor(img, y, modelo, popup_x + 17, popup_x + 63)
    if not lido:
        return None
    if any(d > 5 for d in distancias):
        raise RuntimeError(f"OCR incerto na linha {indice + 1}: {lido}, distâncias={distancias}")
    try:
        return int(lido.replace(".", ""))
    except ValueError as exc:
        raise RuntimeError(f"Código ilegível na linha {indice + 1}: {lido}") from exc


def alerta_sucesso(img):
    if not _alerta_totvs_aberto(hwnd):
        return False
    caixa = (380, 369, 712, 399)
    esperado = Image.open(REFERENCIA_SUCESSO).convert("RGB").crop(caixa)
    atual = img.convert("RGB").crop(caixa)
    diff = ImageChops.difference(esperado, atual)
    pixels_diferentes = sum(1 for p in diff.getdata() if max(p) > 25)
    return pixels_diferentes <= 30


def pai_selecionado(img):
    referencia = Image.open(REFERENCIA_PAI).convert("RGB").crop(CAMPO_PAI)
    atual = img.convert("RGB").crop(CAMPO_PAI)
    diff = ImageChops.difference(referencia, atual)
    return sum(1 for pixel in diff.getdata() if max(pixel) > 20) <= 5


def registrar(registro):
    with RESULTADO.open("a", encoding="utf-8") as arquivo:
        arquivo.write(json.dumps(registro, ensure_ascii=False) + "\n")
        arquivo.flush()


def executar(item, modelo):
    codigo = int(item["codigo"])
    filtro = item["filtro"]
    _selecionar_pcp_506(hwnd)
    antes = imagem(hwnd)
    if not pai_selecionado(antes):
        # Em algumas atualizações da árvore a primeira despesa ocupa y=169
        # antes de a cor do ícone estabilizar. Tentar o pai visível em y=153;
        # se não for ele, nenhum botão de gravação será acionado.
        inp.double_click(hwnd, 590, 153)
        time.sleep(1.0)
        antes = imagem(hwnd)
        if not pai_selecionado(antes):
            guardar(antes, codigo, "pai_inconclusivo")
            raise RuntimeError("Pai PCP/506 não selecionado visualmente")
    inp.click(hwnd, 195, 653)
    time.sleep(1.0)
    popup_x, popup_y = _posicao_fcpfl020(hwnd)
    if popup_x + 102 < 8:
        raise RuntimeError(f"Popup deslocado para fora da tela: {popup_x}, {popup_y}")
    inp.set_field(hwnd, popup_x + 102, popup_y + 92, filtro["texto"])
    time.sleep(0.6)
    inp.key(hwnd, "f4")
    time.sleep(1.5)
    if _alerta_totvs_aberto(hwnd):
        guardar(imagem(hwnd), codigo, "alerta_busca")
        raise RuntimeError("Filtro retornou alerta antes da seleção")
    busca = imagem(hwnd)
    caminho_busca = guardar(busca, codigo, "busca")
    if filtro["resultados"] > 7:
        raise RuntimeError(f"Filtro amplo demais para a grade visível: {filtro}")
    encontrados = [codigo_linha(busca, popup_x, popup_y, i, modelo)
                   for i in range(max(4, filtro["resultados"]))]
    encontrados = [x for x in encontrados if x is not None]
    if codigo not in encontrados or len(encontrados) != filtro["resultados"]:
        raise RuntimeError(f"Busca divergente: alvo={codigo}, encontrados={encontrados}, filtro={filtro}, imagem={caminho_busca}")
    linha = encontrados.index(codigo)
    inp.click(hwnd, popup_x + 527, popup_y + 334 + 16 * linha)
    time.sleep(0.35)
    # Se o processo cair logo após Confirmar, não repetir automaticamente a
    # gravação: o resultado no ERP pode ter sido efetivado sem retorno visual.
    registrar({"codigo": codigo, "status": "CONFIRMACAO_INICIADA",
               "busca": caminho_busca, "momento": datetime.now().isoformat()})
    inp.click(hwnd, popup_x + 373, popup_y + 471)
    time.sleep(1.4)
    depois = imagem(hwnd)
    caminho_depois = guardar(depois, codigo, "confirmacao")
    if not alerta_sucesso(depois):
        raise RuntimeError(f"Sem confirmação visual de sucesso: {caminho_depois}")
    inp.click(hwnd, 1079, 331)
    time.sleep(0.7)
    return {"codigo": codigo, "descricao": item["descricao"], "filtro": filtro,
            "status": "CONFIRMADO", "busca": caminho_busca,
            "confirmacao": caminho_depois, "momento": datetime.now().isoformat()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limite", type=int, default=None)
    parser.add_argument("--lote", type=Path, default=LOTE)
    parser.add_argument("--resultado", type=Path, default=RESULTADO)
    parser.add_argument("--capturas", type=Path, default=CAPTURAS)
    args = parser.parse_args()
    LOTE = args.lote
    RESULTADO = args.resultado
    CAPTURAS = args.capturas
    lote = json.loads(LOTE.read_text(encoding="utf-8"))
    feitos = []
    if RESULTADO.exists():
        feitos = [json.loads(s) for s in RESULTADO.read_text(encoding="utf-8").splitlines() if s.strip()]
    ultimo = {item["codigo"]: item["status"] for item in feitos}
    incertos = [codigo for codigo, status in ultimo.items() if status == "CONFIRMACAO_INICIADA"]
    if incertos:
        raise RuntimeError(f"Gravação anterior de resultado incerto; conferir no ERP antes de repetir: {incertos}")
    ids = {codigo for codigo, status in ultimo.items() if status == "CONFIRMADO"}
    pendentes = [item for item in lote["itens"] if item["codigo"] not in ids]
    if args.limite is not None:
        pendentes = pendentes[:args.limite]
    hwnd = find_window(session.TITLE)
    if hwnd is None:
        raise RuntimeError("TOTVS Moda não encontrado")
    modelo = construir_modelo(ROOT / "shots")
    for i, item in enumerate(pendentes, 1):
        print(f"[{i}/{len(pendentes)}] código {item['codigo']}, filtro {item['filtro']}", flush=True)
        registro = executar(item, modelo)
        registrar(registro)
        print(f"CONFIRMADO {item['codigo']}", flush=True)
    print(f"Concluídos nesta execução: {len(pendentes)}", flush=True)
