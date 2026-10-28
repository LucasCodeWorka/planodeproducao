"""Diagnóstico local de leitura dos números mensais do FCPFM017."""
from __future__ import annotations

import sys
from pathlib import Path
from PIL import Image


def segmentos(arquivo: Path, centro_y: int):
    imagem = Image.open(arquivo).convert("RGB")
    x0, x1 = 798, 884
    y0, y1 = centro_y - 7, centro_y + 7
    pixels = imagem.load()
    colunas = []
    for x in range(x0, x1):
        total = sum(1 for y in range(y0, y1) if max(pixels[x, y]) < 130)
        colunas.append(total)
    ativos = []
    inicio = None
    for i, total in enumerate(colunas + [0]):
        if total and inicio is None:
            inicio = i
        if not total and inicio is not None:
            ativos.append((x0 + inicio, x0 + i - 1))
            inicio = None
    return ativos, colunas


def mascaras(imagem: Image.Image, centro_y: int, x0: int = 798, x1: int = 884):
    y0, y1 = centro_y - 7, centro_y + 7
    pixels = imagem.convert("RGB").load()
    colunas = [any(max(pixels[x, y]) < 130 for y in range(y0, y1)) for x in range(x0, x1)]
    faixas = []
    inicio = None
    for i, ativo in enumerate(colunas + [False]):
        if ativo and inicio is None:
            inicio = i
        if not ativo and inicio is not None:
            faixas.append((x0 + inicio, x0 + i))
            inicio = None
    return [tuple(tuple(max(pixels[x, y]) < 130 for x in range(a, b))
                  for y in range(y0, y1)) for a, b in faixas]


def distancia(a, b):
    largura_a, largura_b = len(a[0]), len(b[0])
    largura = max(largura_a, largura_b)
    erro = 0
    for y in range(14):
        for x in range(largura):
            pa = a[y][x] if x < largura_a else False
            pb = b[y][x] if x < largura_b else False
            erro += pa != pb
    return erro + 3 * abs(largura_a - largura_b)


AMOSTRAS = [
    ("ag_140610.png", 342, "39.402,65", 640, 709),
    ("ag_140610.png", 262, "39.361,21", 798, 884),
    ("ag_140610.png", 278, "41,44", 798, 884),
    ("ag_140502.png", 406, "282,41", 798, 884),
    ("ag_140502.png", 422, "15.542,19", 798, 884),
    ("ag_140502.png", 438, "7.528,43", 798, 884),
    ("ag_140112.png", 438, "82,68", 798, 884),
]


def construir_modelo(pasta: Path):
    modelos = []
    for nome, centro_y, valor, x0, x1 in AMOSTRAS:
        glifos = mascaras(Image.open(pasta / nome), centro_y, x0, x1)
        if len(glifos) != len(valor):
            raise ValueError(f"Segmentos incorretos em {nome} {centro_y}: {len(glifos)} != {len(valor)}")
        modelos.extend((letra, glifo, nome, centro_y) for letra, glifo in zip(valor, glifos))
    return modelos


def ler_valor(imagem: Image.Image, centro_y: int, modelos, x0: int = 798, x1: int = 884):
    resposta = ""
    confiancas = []
    for glifo in mascaras(imagem, centro_y, x0, x1):
        proximos = sorted(((distancia(glifo, modelo), letra) for letra, modelo, _, _ in modelos))
        if not proximos:
            raise ValueError("Sem modelos OCR")
        resposta += proximos[0][1]
        confiancas.append(proximos[0][0])
    return resposta, confiancas


if __name__ == "__main__":
    pasta = Path(__file__).resolve().parents[1] / "shots"
    modelos = construir_modelo(pasta)
    print("MODELOS", len(modelos))
    for nome, centro_y, esperado, x0, x1 in AMOSTRAS:
        lido, confiancas = ler_valor(Image.open(pasta / nome), centro_y, modelos, x0, x1)
        print("LEITURA", nome, centro_y, esperado, lido, confiancas)
    for nome, esperado in [("ag_140610.png", "11666"), ("ag_140532.png", "11666"), ("ag_140112.png", "11148")]:
        lido, confiancas = ler_valor(Image.open(pasta / nome), 342, modelos, 20, 80)
        print("CODIGO", nome, esperado, lido, confiancas)
    for nome, esperado in [("ag_140610.png", "2027"), ("ag_140502.png", "2026")]:
        lido, confiancas = ler_valor(Image.open(pasta / nome), 246, modelos, 798, 884)
        print("ANO", nome, esperado, lido, confiancas)
        lido, confiancas = ler_valor(Image.open(pasta / nome), 182, modelos, 103, 172)
        print("ANO_FORM", nome, esperado, lido, confiancas)
    from PIL import ImageChops
    def comparar_ano(a, b):
        x0, y0, x1, y1 = 827, 239, 856, 253
        primeira = Image.open(pasta / a).convert("RGB").crop((x0, y0, x1, y1))
        segunda = Image.open(pasta / b).convert("RGB").crop((x0, y0, x1, y1))
        return sum(1 for pixel in ImageChops.difference(primeira, segunda).getdata() if pixel != (0, 0, 0))
    print("ANO_DIFF", comparar_ano("ag_140610.png", "ag_140532.png"),
          comparar_ano("ag_140610.png", "ag_140502.png"))
    erros = []
    for letra, glifo, nome, centro_y in modelos:
        outros = [(l, g, n, y) for l, g, n, y in modelos if not (l == letra and g == glifo and n == nome and y == centro_y)]
        perto = sorted((distancia(glifo, g), l) for l, g, _, _ in outros)
        if perto[0][1] != letra:
            erros.append((letra, perto[0]))
    print("ERROS_LEAVE_ONE_OUT", erros)
    if len(sys.argv) >= 3:
        amostras = [(Path(sys.argv[1]), int(sys.argv[2]))]
    else:
        amostras = [
            (pasta / "ag_140610.png", 262),
            (pasta / "ag_140610.png", 278),
            (pasta / "ag_140502.png", 406),
            (pasta / "ag_140502.png", 422),
            (pasta / "ag_140502.png", 438),
            (pasta / "ag_140112.png", 438),
            (pasta / "ag_140610.png", 406),
        ]
    for arquivo, centro_y in amostras:
        partes, colunas = segmentos(arquivo, centro_y)
        print(arquivo.name, centro_y, partes)
        print("".join("#" if valor else " " for valor in colunas))
