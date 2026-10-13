"""Ferramentas que o modelo usa para operar o Virtual Age.

As coordenadas trocadas com o modelo sao as da IMAGEM ENVIADA (1456 px de
largura), nao as da janela nativa (1936x1048). A imagem e reduzida aqui e a
regua e desenhada DEPOIS da reducao, entao o rotulo que o modelo le e o pixel
que ele ve. As funcoes de acao convertem para o pixel nativo usando ESCALA.
Assim o modelo nunca precisa fazer conta — e um erro de fator 1,33 a menos.
"""
import base64
import io
import time
from pathlib import Path

from PIL import Image, ImageDraw

from . import input as inp
from . import session
from .capture import capture, find_window, rect

RAIZ = Path(__file__).resolve().parents[1]
MEM = RAIZ / "memory"
SHOTS = RAIZ / "shots"
SHOTS.mkdir(exist_ok=True)

LARGURA_ENVIO = 1456   # px. Abaixo do limite de 1568 do modelo, entao a
                       # imagem chega sem redimensionamento extra do lado dele.
PASSO_GRADE = 100      # px da IMAGEM ENVIADA entre linhas da regua

# Fator imagem-enviada -> janela nativa, atualizado a cada ver_tela.
# Existe porque o modelo le posicoes na imagem que recebe; as ferramentas
# convertem para o pixel real da janela. Assim ha UM so sistema de
# coordenadas do ponto de vista do modelo.
ESCALA = 1.0


def _hwnd():
    h = find_window(session.TITLE)
    if h is None:
        raise RuntimeError("janela do Virtual Age nao encontrada. "
                           "Use garantir_sessao para abri-la.")
    return h


def _com_grade(img):
    """Desenha a regua. Rotulos em coordenada DA PROPRIA IMAGEM enviada."""
    g = img.convert("RGB").copy()
    d = ImageDraw.Draw(g, "RGBA")
    w, h = g.size
    for x in range(0, w, PASSO_GRADE):
        forte = x % 500 == 0
        d.line([(x, 0), (x, h)], fill=(255, 0, 0, 100 if forte else 45),
               width=2 if forte else 1)
        d.rectangle([x + 2, 2, x + 40, 16], fill=(255, 255, 255, 230))
        d.text((x + 4, 3), str(x), fill=(200, 0, 0))
    for y in range(0, h, PASSO_GRADE):
        forte = y % 500 == 0
        d.line([(0, y), (w, y)], fill=(255, 0, 0, 100 if forte else 45),
               width=2 if forte else 1)
        d.rectangle([2, y + 2, 40, y + 16], fill=(255, 255, 255, 230))
        d.text((4, y + 3), str(y), fill=(200, 0, 0))
    return g


def _para_envio(img, grade):
    """Reduz PRIMEIRO, desenha a grade DEPOIS: assim os rotulos coincidem com
    os pixels que o modelo realmente ve."""
    global ESCALA
    nativo_w = img.width
    if img.width > LARGURA_ENVIO:
        r = LARGURA_ENVIO / img.width
        img = img.resize((LARGURA_ENVIO, int(img.height * r)), Image.LANCZOS)
    ESCALA = nativo_w / img.width
    enviada = img.size
    if grade:
        img = _com_grade(img)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode(), enviada


def _img_block(b64):
    return {"type": "image", "data": b64, "mimeType": "image/png"}


def _txt(t):
    return {"type": "text", "text": t}


# ------------------------------------------------------------------ acoes

def ver_tela(grade=True, nota=""):
    """Captura a janela e devolve imagem + contexto."""
    h = _hwnd()
    img, metodo = capture(h, allow_foreground=False)
    estado, detalhe = session.estado_tela(h, img)
    r = rect(h)
    carimbo = time.strftime("%H:%M:%S")
    img.save(SHOTS / f"ag_{time.strftime('%H%M%S')}.png")
    b64, enviada = _para_envio(img, grade)
    cab = (f"[{carimbo}] imagem {enviada[0]}x{enviada[1]} (janela real "
           f"{r['w']}x{r['h']}) | estado={estado} ({detalhe}) | captura={metodo}"
           + (f"\nnota: {nota}" if nota else "")
           + "\nInforme as coordenadas DESTA imagem, como a regua vermelha "
             "as marca. As ferramentas convertem sozinhas para a janela real "
             "- nao faca conta nenhuma.")
    return {"content": [_txt(cab), _img_block(b64)]}


def _nativo(x, y):
    return int(round(x * ESCALA)), int(round(y * ESCALA))


def clicar(x, y, botao="left", duplo=False, esperar=0.8):
    h = _hwnd()
    nx, ny = _nativo(x, y)
    inp.click(h, nx, ny, button=botao, double=duplo)
    time.sleep(esperar)
    return f"cliquei em ({x},{y}) da imagem = ({nx},{ny}) da janela"


def digitar(texto, esperar=0.6):
    h = _hwnd()
    inp.type_text(h, texto)
    time.sleep(esperar)
    return f"digitei {texto!r}"


def tecla(combo, esperar=0.8):
    h = _hwnd()
    inp.key(h, combo)
    time.sleep(esperar)
    return f"tecla {combo!r}"


def preencher(x, y, texto, esperar=0.8):
    """Clica no campo, limpa e digita. O combo mais usado em ERP."""
    h = _hwnd()
    nx, ny = _nativo(x, y)
    inp.set_field(h, nx, ny, texto)
    time.sleep(esperar)
    return f"campo ({x},{y}) da imagem = ({nx},{ny}) preenchido com {texto!r}"


def rolar(x, y, quantidade):
    h = _hwnd()
    nx, ny = _nativo(x, y)
    inp.scroll(h, nx, ny, quantidade)
    return f"rolei {quantidade} em ({x},{y})"


def esperar(segundos):
    segundos = max(0.1, min(float(segundos), 60))
    time.sleep(segundos)
    return f"esperei {segundos}s"


def abrir_componente(codigo, espera=6.0):
    """Abre um componente pela busca do menu lateral (ex.: PRDFL035)."""
    h = _hwnd()
    inp.clear_field(h, *session.CAMPO_BUSCA)
    inp.type_text(h, codigo)
    time.sleep(1.2)
    inp.key(h, "enter")
    time.sleep(espera)
    return f"pedi para abrir {codigo}; confira com ver_tela"


def dispensar_avisos():
    """Fecha telas de aviso clicando em "Nao mostrar novamente"."""
    h = _hwnd()
    pontos = session.dispensar_avisos(h)
    if not pontos:
        return "nenhuma tela de aviso aberta"
    return f"{len(pontos)} tela(s) de aviso dispensada(s) em {pontos}"


def garantir_sessao():
    h, msg = session.garantir_sessao()
    return f"hwnd={h}: {msg}"


DADOS = RAIZ.parent / "data" / "conciliacao"


def listar_coletas():
    """Coletas ja feitas pelo coletar.py, mais recentes primeiro."""
    if not DADOS.exists():
        return "(nenhuma coleta ainda; rode coletar.py)"
    linhas = []
    for man in sorted(DADOS.rglob("manifesto.json"), reverse=True):
        import json
        m = json.loads(man.read_text(encoding="utf-8"))
        g = m.get("grades", {})
        linhas.append(
            f"{man.parent.relative_to(DADOS).as_posix()} | "
            f"status={m.get('status')} | "
            + " | ".join(f"{k}={v.get('paginas_capturadas')}pag"
                         for k, v in g.items()))
    sep = chr(10)
    return sep.join(linhas) if linhas else "(nenhuma coleta encontrada)"


def ler_manifesto(coleta):
    """coleta = '2026-09-18/itau-105036'."""
    p = (DADOS / coleta / "manifesto.json").resolve()
    if DADOS.resolve() not in p.parents:
        return "caminho fora da pasta de coletas"
    if not p.exists():
        return f"nao existe: {coleta}/manifesto.json"
    return p.read_text(encoding="utf-8")


def ler_pagina(coleta, grade, pagina):
    """Devolve a imagem ja capturada de uma pagina da grade.

    E assim que o capturador transcreve sem navegar o ERP de novo: a coleta
    acontece uma vez, de forma deterministica; a leitura acontece em cima dos
    arquivos, quantas vezes for preciso.
    """
    arq = (DADOS / coleta / grade / f"p{int(pagina):02d}.png").resolve()
    if DADOS.resolve() not in arq.parents:
        return {"content": [_txt("caminho fora da pasta de coletas")]}
    if not arq.exists():
        return {"content": [_txt(f"nao existe: {arq.name} em {coleta}/{grade}")]}
    from PIL import Image as _I
    img = _I.open(arq)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return {"content": [
        _txt(f"{coleta} | grade {grade} | pagina {int(pagina):02d} | "
             f"{img.size[0]}x{img.size[1]} (ja ampliada 2x)"),
        _img_block(b64)]}


# ----------------------------------------------------------------- memoria

def memoria_listar():
    itens = sorted(p.relative_to(MEM).as_posix() for p in MEM.rglob("*.md"))
    return "\n".join(itens) if itens else "(memoria vazia)"


def memoria_ler(arquivo):
    p = (MEM / arquivo).resolve()
    if MEM.resolve() not in p.parents and p != MEM.resolve():
        return "caminho fora da pasta de memoria"
    if not p.exists():
        return f"nao existe: {arquivo}"
    return p.read_text(encoding="utf-8")


def memoria_escrever(arquivo, conteudo, anexar=False):
    """Grava o que o agente aprendeu. E assim que ele evolui entre sessoes."""
    p = (MEM / arquivo).resolve()
    if MEM.resolve() not in p.parents and p != MEM.resolve():
        return "caminho fora da pasta de memoria"
    p.parent.mkdir(parents=True, exist_ok=True)
    if anexar and p.exists():
        p.write_text(p.read_text(encoding="utf-8").rstrip() + "\n\n" + conteudo,
                     encoding="utf-8")
    else:
        p.write_text(conteudo, encoding="utf-8")
    return f"gravado em memory/{arquivo} ({len(conteudo)} caracteres)"
