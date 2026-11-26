"""Troca a despesa dos itens de pedido de compra (CMPFM045), pedido a pedido.

Lote: scripts/preparar-lote-cmpfm045.mjs (status PREPARADO_NAO_LANCADO, ordem por valor).
Caminho validado nos pilotos de 25/11/2026 (pedidos 19156 e 19608):
  CMPFM020 (limpa, número, Tab) -> Item... -> CMPFM021 (linha do grupo; na grade, linha da cor
  e célula do tamanho) -> Rateio despesa... -> CMPFM045 (troca o código, Confirmar grava).

Travas (nada é chutado):
- título de cada tela conferido pelo texto;
- grupo e cor achados pelo CÓDIGO lido na tela; o tamanho é achado clicando as células da
  linha até o campo Produto mostrar exatamente o produto do lote;
- no CMPFM045: pedido e produto do cabeçalho conferidos, uma única linha de rateio, e a
  despesa atual tem de ser a do lote (se já for a nova, marca JA_CORRETO; se for outra,
  pula com DIVERGENTE);
- depois de digitar, confere o código novo ANTES de confirmar; depois de confirmar, reabre
  e confere que gravou;
- registra INICIADO antes do Confirmar: rodada nova recusa repetir item de resultado incerto.
Item que não se acha na tela é anotado e o pedido segue; erro de tela fora do esperado para.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
from main import _alerta_totvs_aberto  # noqa: E402
from ocr_fcpfm017 import construir_modelo, ler_valor  # noqa: E402
from va_core import input as inp  # noqa: E402
from va_core import session  # noqa: E402
from va_core.capture import capture, find_window, rect  # noqa: E402

TITULO = (34, 57, 130, 78)
REF = {c: ROOT / "shots" / f"titulo_{c.lower()}.png" for c in ("CMPFM020", "CMPFM021", "CMPFM045")}
GRUPO_YS = [214, 230, 246, 262, 278]
COR_YS = [374, 390, 406, 422, 438, 454]
COL_XS = [358 + 77 * k for k in range(9)]

MODELO = None
PASTA = None
RESULTADO = None


class ItemPulado(Exception):
    pass


def imagem(hwnd) -> Image.Image:
    img, metodo = capture(hwnd, allow_foreground=False)
    if img is None or img.size != (1382, 752):
        raise RuntimeError(f"captura inválida: {metodo}, {getattr(img, 'size', None)}")
    return img


def texto(img):
    return [1 if sum(px) / 3 < 110 else 0 for px in img.convert("RGB").crop(TITULO).getdata()]


def tela(hwnd, codigo: str, img=None) -> bool:
    img = img or imagem(hwnd)
    ref = texto(Image.open(REF[codigo]))
    return sum(1 for a, b in zip(ref, texto(img)) if a != b) <= 3


def esperar_tela(hwnd, codigo: str, segundos: float = 8.0) -> Image.Image:
    fim = time.monotonic() + segundos
    while time.monotonic() < fim:
        img = imagem(hwnd)
        if tela(hwnd, codigo, img):
            return img
        time.sleep(0.5)
    raise RuntimeError(f"{codigo} não apareceu")


def ler(img, y, x0, x1) -> str:
    valor, dist = ler_valor(img, y, MODELO, x0, x1)
    if any(d > 3 for d in dist):
        return "?"
    return valor.replace(".", "")


def guardar(img, nome) -> str:
    PASTA.mkdir(parents=True, exist_ok=True)
    caminho = PASTA / f"{datetime.now():%H%M%S}_{nome}.png"
    img.save(caminho)
    return str(caminho)


def registrar(reg: dict) -> None:
    with RESULTADO.open("a", encoding="utf-8") as arq:
        arq.write(json.dumps(reg, ensure_ascii=False) + "\n")
        arq.flush()


def abrir_pedido(hwnd, pedido: str) -> None:
    img = imagem(hwnd)
    if tela(hwnd, "CMPFM021", img):
        inp.click(hwnd, 1007, 67)
        time.sleep(2.0)
        img = imagem(hwnd)
    if not tela(hwnd, "CMPFM020", img):
        raise RuntimeError("Fora do CMPFM020/CMPFM021; parei")
    if _alerta_totvs_aberto(hwnd):
        raise RuntimeError("Aviso aberto no CMPFM020")
    inp.click(hwnd, 25, 96)          # limpa a tela
    time.sleep(2.0)
    inp.set_field(hwnd, 150, 149, pedido)
    inp.key(hwnd, "tab")
    time.sleep(3.0)
    if _alerta_totvs_aberto(hwnd):
        guardar(imagem(hwnd), f"{pedido}_alerta_pedido")
        raise ItemPulado("aviso ao carregar o pedido")
    inp.click(hwnd, 75, 637)         # Item...
    time.sleep(3.0)
    img = esperar_tela(hwnd, "CMPFM021")
    if ler(img, 150, 118, 186) != pedido:
        guardar(img, f"{pedido}_pedido_errado")
        raise RuntimeError(f"CMPFM021 não mostra o pedido {pedido}")


def selecionar_grupo(hwnd, grupo: str) -> None:
    # A célula do código vem selecionada (texto invertido, ilegível): clicar na descrição antes.
    inp.click(hwnd, 420, GRUPO_YS[0])
    time.sleep(1.2)
    img = imagem(hwnd)
    for y in GRUPO_YS:
        if ler(img, y, 62, 140) == grupo:
            inp.click(hwnd, 420, y)
            time.sleep(1.5)
            return
    raise ItemPulado(f"grupo {grupo} não visível")


def cores_visiveis(hwnd) -> list[str]:
    img = imagem(hwnd)
    return [ler(img, y, 34, 100) for y in COR_YS]


def achar_cor(hwnd, cor: str) -> int:
    # Espera a grade carregar: logo depois de abrir o pedido ou trocar de grupo ela vem vazia
    # e duas leituras em branco pareciam "fim da grade" (25/11/2026, noite).
    for _ in range(16):
        if any(c and c != "?" for c in cores_visiveis(hwnd)):
            break
        time.sleep(0.5)
    # A linha com o FOCO das setas fica com o código ilegível. Para ler, clica no NOME de
    # outra linha (o código continua legível) e só então lê as seis.
    def ler_com_foco_em(y_foco: int) -> list[str]:
        inp.click(hwnd, 180, y_foco)
        time.sleep(0.5)
        return cores_visiveis(hwnd)
    # SOBE ATÉ O TOPO antes de procurar: a grade fica onde o item anterior a deixou, e a
    # busca só descia (19509, noite). Para quando a lista visível não muda mais.
    inp.click(hwnd, 180, COR_YS[0])
    time.sleep(0.4)
    anterior = None
    for _ in range(40):
        for _ in range(6):
            inp.key(hwnd, "up")
            time.sleep(0.08)
        time.sleep(0.5)
        atual = cores_visiveis(hwnd)
        if atual == anterior:
            break
        anterior = atual
    # Desce lendo: foco na última linha, uma seta para baixo, foco de volta na primeira.
    vistos = []
    for passo in range(80):
        cores = ler_com_foco_em(COR_YS[0] if passo else COR_YS[-1])
        for y, c in zip(COR_YS, cores):
            if c == cor:
                return y
        if vistos and cores == vistos[-1]:
            break                    # fim da grade
        vistos.append(cores)
        inp.click(hwnd, 180, COR_YS[-1])
        time.sleep(0.3)
        inp.key(hwnd, "down")
        time.sleep(0.5)
    raise ItemPulado(f"cor {cor} não encontrada na grade")


def achar_produto(hwnd, y: int, produto: str) -> None:
    for x in COL_XS:
        inp.click(hwnd, x, y)
        for _ in range(4):
            time.sleep(0.6)
            if ler(imagem(hwnd), 534, 97, 172) == produto:
                return
    raise ItemPulado(f"produto {produto} não encontrado na linha da cor")


def trocar(hwnd, pedido: str, item: dict) -> dict:
    produto, nova, atual = item["produto"], str(item["despesaNova"]), str(item["despesaAtual"])
    base = {"pedido": pedido, "produto": produto, "despesaAtual": atual, "despesaNova": nova}
    inp.click(hwnd, 455, 637)        # Rateio despesa...
    time.sleep(1.5)
    img = esperar_tela(hwnd, "CMPFM045")
    for _ in range(16):              # o título aparece antes do conteúdo
        if ler(img, 166, 90, 158) == pedido and ler(img, 182, 90, 158) == produto:
            break
        time.sleep(0.5)
        img = imagem(hwnd)
    if ler(img, 166, 90, 158) != pedido or ler(img, 182, 90, 158) != produto:
        guardar(img, f"{pedido}_{produto}_cabecalho")
        inp.click(hwnd, 956, 669); time.sleep(1.5)
        raise ItemPulado("cabeçalho do CMPFM045 não confere")
    inp.click(hwnd, 560, 262)        # tira a seleção da célula da despesa para ler
    time.sleep(0.6)
    img = imagem(hwnd)
    lido, linha2 = ler(img, 262, 92, 157), ler(img, 278, 92, 157)
    antes = guardar(img, f"{pedido}_{produto}_antes")
    if linha2:
        inp.click(hwnd, 956, 669); time.sleep(1.5)
        return {**base, "status": "RATEADO", "antes": antes}
    if lido == nova:
        inp.click(hwnd, 956, 669); time.sleep(1.5)
        return {**base, "status": "JA_CORRETO", "antes": antes}
    if lido != atual:
        inp.click(hwnd, 956, 669); time.sleep(1.5)
        return {**base, "status": "DIVERGENTE", "lido": lido, "antes": antes}
    inp.set_field(hwnd, 125, 262, nova)
    inp.key(hwnd, "tab")
    time.sleep(1.8)
    img = imagem(hwnd)
    if ler(img, 262, 92, 157) != nova or _alerta_totvs_aberto(hwnd):
        guardar(img, f"{pedido}_{produto}_digitado_errado")
        inp.click(hwnd, 956, 669); time.sleep(1.5)
        raise ItemPulado("código digitado não confere; cancelei")
    registrar({**base, "status": "INICIADO", "momento": datetime.now().isoformat()})
    inp.click(hwnd, 821, 669)        # Confirmar (grava)
    time.sleep(2.5)
    if _alerta_totvs_aberto(hwnd):
        caminho = guardar(imagem(hwnd), f"{pedido}_{produto}_alerta_confirmar")
        raise RuntimeError(f"Aviso ao confirmar: {caminho}")
    esperar_tela(hwnd, "CMPFM021")
    inp.click(hwnd, 455, 637)        # reabre e confere
    time.sleep(1.5)
    img = esperar_tela(hwnd, "CMPFM045")
    for _ in range(16):
        if ler(img, 182, 90, 158) == produto:
            break
        time.sleep(0.5)
        img = imagem(hwnd)
    inp.click(hwnd, 560, 262)
    time.sleep(0.6)
    img = imagem(hwnd)
    depois = guardar(img, f"{pedido}_{produto}_depois")
    gravado = ler(img, 262, 92, 157)
    inp.click(hwnd, 956, 669)
    time.sleep(1.5)
    if gravado != nova:
        raise RuntimeError(f"Não persistiu {pedido}/{produto}: lido {gravado}, esperado {nova}; {depois}")
    return {**base, "status": "CONFIRMADO", "antes": antes, "depois": depois, "momento": datetime.now().isoformat()}


def main() -> int:
    global MODELO, PASTA, RESULTADO
    parser = argparse.ArgumentParser()
    parser.add_argument("--lote", type=Path, required=True)
    parser.add_argument("--resultado", type=Path, required=True)
    parser.add_argument("--capturas", type=Path, required=True)
    parser.add_argument("--pedidos", type=int, help="limita a quantidade de pedidos desta rodada")
    parser.add_argument("--pedido", type=str, help="roda só este pedido")
    args = parser.parse_args()
    PASTA, RESULTADO = args.capturas, args.resultado
    lote = json.loads(args.lote.read_text(encoding="utf-8"))
    if lote.get("status") != "PREPARADO_NAO_LANCADO":
        raise RuntimeError("Arquivo de lote inesperado")
    ultimo = {}
    if RESULTADO.exists():
        for s in RESULTADO.read_text(encoding="utf-8").splitlines():
            if s.strip():
                r = json.loads(s)
                ultimo[(r["pedido"], r["produto"])] = r["status"]
    incertos = [k for k, v in ultimo.items() if v == "INICIADO"]
    if incertos:
        raise RuntimeError(f"Resultado incerto; conferir no ERP antes de repetir: {incertos}")
    finais = {"CONFIRMADO", "JA_CORRETO", "RATEADO", "DIVERGENTE"}
    pedidos = [p for p in lote["ordem"] if not args.pedido or p["pedido"] == args.pedido]
    pedidos = [p for p in pedidos if any(ultimo.get((p["pedido"], i["produto"])) not in finais for i in p["itens"])]
    if args.pedidos:
        pedidos = pedidos[:args.pedidos]
    print(f"Pedidos nesta rodada: {len(pedidos)}", flush=True)

    hwnd = find_window(session.TITLE)
    if hwnd is None:
        raise RuntimeError("TOTVS fechado")
    if (rect(hwnd)["w"], rect(hwnd)["h"]) != (1382, 752):
        raise RuntimeError("Janela com tamanho inesperado")
    MODELO = construir_modelo(ROOT / "shots")
    for n, ped in enumerate(pedidos, 1):
        pedido = ped["pedido"]
        pendentes = [i for i in ped["itens"] if ultimo.get((pedido, i["produto"])) not in finais]
        print(f"[{n}/{len(pedidos)}] pedido {pedido}: {len(pendentes)} itens", flush=True)
        try:
            abrir_pedido(hwnd, pedido)
        except ItemPulado as e:
            for i in pendentes:
                registrar({"pedido": pedido, "produto": i["produto"], "status": "PULADO", "motivo": str(e)})
            print(f"  PULADO pedido: {e}", flush=True)
            continue
        grupo_atual = None
        for item in pendentes:
            try:
                if item["grupo"] != grupo_atual:
                    selecionar_grupo(hwnd, item["grupo"])
                    grupo_atual = item["grupo"]
                y = achar_cor(hwnd, item["cor"])
                achar_produto(hwnd, y, item["produto"])
                reg = trocar(hwnd, pedido, item)
            except ItemPulado as e:
                reg = {"pedido": pedido, "produto": item["produto"], "status": "PULADO", "motivo": str(e)}
                grupo_atual = None
            registrar(reg)
            print(f"  {item['produto']} {reg['status']}", flush=True)
    print("Fim da rodada", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
