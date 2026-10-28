"""Ciclo de vida da sessao Virtual Age: abrir o cliente, logar, achar a janela."""
import os
import subprocess
import time
from pathlib import Path

import win32gui
from dotenv import load_dotenv

from . import input as inp
from .capture import capture, find_window

load_dotenv(Path.cwd() / ".env")
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

import numpy as np

CLIENT = os.getenv("VA_CLIENT")
HOST = os.getenv("VA_HOST")
USER = os.getenv("VA_USER")           # gateway GO-Global
PASS = os.getenv("VA_PASS")
APP_USER = os.getenv("VA_APP_USER")   # login do TOTVS Moda
APP_PASS = os.getenv("VA_APP_PASS")
EMPRESA = os.getenv("VA_EMPRESA", "1")
PRODUTO = os.getenv("VA_PRODUTO", "1")   # 1,2,3 da tela "Selecione o produto"
APP = os.getenv("VA_APP", "Virtual Age")
TITLE = os.getenv("VA_WINDOW_TITLE", "TOTVS Moda")

# Campo "Procurar..." do menu lateral, em coordenadas nativas da janela.
CAMPO_BUSCA = (220, 217)

# Cor do botao "Entrar" (teal do TOTVS). Serve para separar o passo 1 do
# passo 2 do login: no passo da empresa esse ponto e branco.
TEAL = (0, 158, 193)


def esta_aberta():
    return find_window(TITLE) is not None


def lancar(timeout=90):
    """Sobe o ua-client e espera a janela da sessao aparecer."""
    if not CLIENT or not Path(CLIENT).exists():
        raise RuntimeError(f"ua-client nao encontrado em {CLIENT!r} (veja .env)")
    cmd = [CLIENT, "-h", HOST, "-u", USER, "-p", PASS, "-c", "-a", APP]
    subprocess.Popen(cmd, close_fds=True)
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = find_window(TITLE)
        if h:
            # nao basta a janela existir: o estado precisa estabilizar, senao
            # uma leitura prematura faz o login ser pulado
            est, det = esperar_estado_estavel(h, timeout=45)
            return h
        time.sleep(1.5)
    raise TimeoutError(f"janela {TITLE!r} nao apareceu em {timeout}s")


def estado_tela(hwnd, img=None):
    """Em que tela a sessao esta. Devolve (estado, detalhe).

    Estados: "logado", "login_usuario", "login_empresa", "sem_janela",
             "desconhecido".

    Tres sinais que NAO funcionam, todos testados nesta instalacao:
      - titulo da janela: o Win32 devolve sempre "TOTVS Moda"; o
        "- 001 - LIEBE FABRICA" e desenhado dentro do bitmap;
      - brilho do menu lateral: um componente aberto cobre a faixa e da
        falso positivo de "login";
      - saturacao de cor / foto do login: a FOTO MUDA a cada sessao. Uma
        deu 85% de pixels coloridos, outra (loja, lavada) deu 24,7%.
      - cor do botao "Entrar": fica CINZA enquanto os campos estao vazios.

    O que funciona: a BARRA DE MENU do frame externo (logo abaixo do titulo).
    Ela nunca e coberta por janela interna e muda de conteudo conforme o
    estado: "Sistema" no login (texto estreito) contra "Opcoes | Menu Fiscal"
    ou "Arquivo | Ferramentas | Menu Fiscal | Ajuda" depois de logado
    (texto largo). Medido: 39 px de extensao no login contra 132-292 logado.

    Para separar os dois passos do login: a seta "voltar" no canto superior
    esquerdo so existe no passo da empresa.
    """
    if img is None:
        img, _ = capture(hwnd, allow_foreground=False)
    if img is None:
        return "sem_janela", "captura falhou"

    cinza = img.convert("L")
    w, h = cinza.size

    # A barra de menu do cliente tem altura fixa. Em janelas menores, a faixa
    # proporcional acima lia a barra de titulo e classificava o login como
    # "logado". O texto Sistema/Arquivo fica entre y=35 e y=50.
    menu = np.asarray(cinza.crop((10, 35, min(w, int(w * 0.45)), 50)), dtype=np.int16)
    cols = np.where((menu < 120).any(axis=0))[0]
    extensao = int(cols.max() - cols.min()) if len(cols) else 0

    if extensao >= 70:
        return "logado", f"menu={extensao}px"
    if extensao == 0:
        return "desconhecido", "barra de menu vazia (tela ainda pintando?)"

    # Dentro do fluxo de login, qual dos tres passos?
    # A tela de produto nao tem foto: a metade direita fica branca.
    dir_ = img.convert("HSV").crop((int(w * 0.55), int(h * 0.10),
                                    int(w * 0.97), int(h * 0.92)))
    sat = np.asarray(dir_, dtype=np.float32)[:, :, 1]
    colorido = float((sat > 60).mean() * 100)
    if colorido < 5:
        return "login_produto", f"menu={extensao}px coloridos={colorido:.1f}%"

    # A seta fica dentro da pagina, abaixo da barra de componentes. Usar
    # fracoes da altura capturava o texto LOGFM017 em janelas de 752 px.
    seta = np.asarray(cinza.crop((25, 95, 60, 120)), dtype=np.int16)
    marca = float((seta < 200).mean() * 100)
    passo = "login_empresa" if marca >= 3 else "login_usuario"
    return passo, f"menu={extensao}px seta={marca:.1f}% coloridos={colorido:.1f}%"


def na_tela_de_login(hwnd):
    return estado_tela(hwnd)[0].startswith("login")


TEAL_BGR = (193, 158, 0)          # botao padrao TOTVS, em BGR
GAP_MODAL = 400                   # px minimos entre os dois botoes do aviso


def _botoes_teal(img):
    """Acha retangulos com a cor de botao do TOTVS. Devolve [(x,y,w,h)]."""
    import cv2
    bgr = np.asarray(img.convert("RGB"), dtype=np.uint8)[:, :, ::-1].copy()
    alvo = np.array(TEAL_BGR, dtype=np.int16)
    dist = np.abs(bgr.astype(np.int16) - alvo).sum(axis=2)
    mask = (dist < 90).astype(np.uint8)
    n, _, stats, cent = cv2.connectedComponentsWithStats(mask, 8)
    out = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if 60 <= w <= 320 and 20 <= h <= 55 and area > 0.5 * w * h:
            out.append((int(x), int(y), int(w), int(h)))
    return out


def achar_botao_nao_mostrar(img):
    """Devolve (x, y) do "Nao mostrar novamente" se a tela de avisos estiver
    aberta, senao None.

    Assinatura usada: o modal de avisos tem DOIS botoes teal na mesma linha de
    baixo, muito afastados ("Nao mostrar novamente" a esquerda, "Ler depois" a
    direita). Botoes de componente (ex.: "Lote..." e "Detalhe grupo..." do
    PRDFL035) tambem sao teal, mas ficam colados — por isso a exigencia de um
    vao grande evita clicar na tela errada.
    """
    botoes = _botoes_teal(img)
    if len(botoes) < 2:
        return None
    base = max(b[1] for b in botoes)
    linha = sorted([b for b in botoes if abs(b[1] - base) <= 15],
                   key=lambda b: b[0])
    if len(linha) < 2:
        return None
    if linha[-1][0] - linha[0][0] < GAP_MODAL:
        return None
    x, y, w, h = linha[0]
    return x + w // 2, y + h // 2


def esperar_estado_estavel(hwnd, timeout=60, repeticoes=3, intervalo=1.5):
    """Espera o estado da tela parar de mudar.

    Logo depois de abrir o cliente a janela ainda esta pintando e
    `estado_tela` pode devolver "logado" por um instante mesmo estando na
    tela de login — foi o que aconteceu e fez o login ser pulado. Exigir o
    mesmo estado N leituras seguidas elimina essa leitura prematura.
    """
    t0 = time.time()
    ultimo, seguidas = None, 0
    while time.time() - t0 < timeout:
        est, det = estado_tela(hwnd)
        if est == ultimo and est != "sem_janela":
            seguidas += 1
            if seguidas >= repeticoes:
                return est, det
        else:
            ultimo, seguidas = est, 1
        time.sleep(intervalo)
    return estado_tela(hwnd)


def esperar_pronto(hwnd, timeout=60):
    """Espera a tela do ERP terminar de PINTAR depois do login.

    O menu superior ja diz "logado" segundos antes de o conteudo aparecer:
    medido, a home ficou em branco por mais de 30 s com o titulo correto.
    Sinal de pronto: a faixa do menu lateral escuro (azul-marinho) existe.
    """
    t0 = time.time()
    while time.time() - t0 < timeout:
        img, _m = capture(hwnd, allow_foreground=False)
        if img is not None:
            g = img.convert("L")
            w, h = g.size
            faixa = np.asarray(g.crop((int(w * 0.03), int(h * 0.20),
                                       int(w * 0.18), int(h * 0.70))),
                               dtype=np.float32)
            if float(faixa.mean()) < 90:      # menu lateral pintado
                return True, f"pronto em {time.time()-t0:.0f}s"
        time.sleep(1.5)
    return False, f"nao pintou em {timeout}s"


def dispensar_avisos(hwnd, max_ciclos=4):
    """Fecha as telas de aviso clicando em "Nao mostrar novamente"."""
    fechados = []
    for _ in range(max_ciclos):
        img, _m = capture(hwnd, allow_foreground=False)
        if img is None:
            break
        ponto = achar_botao_nao_mostrar(img)
        if ponto is None:
            break
        inp.click(hwnd, *ponto)
        fechados.append(ponto)
        time.sleep(1.5)
    return fechados


def _esperar_estado(hwnd, alvos, timeout, intervalo=2.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        est, det = estado_tela(hwnd)
        if est in alvos:
            return est, det
        time.sleep(intervalo)
    return estado_tela(hwnd)


def logar(hwnd, timeout=60):
    """Faz o login por teclado e confirma cada tela antes de prosseguir."""
    est, det = estado_tela(hwnd)
    passos = []

    if est == "logado":
        return "ja estava logado"
    if est == "desconhecido":
        raise RuntimeError(f"tela de login nao reconhecida ({det})")

    if est == "login_usuario":
        if not APP_USER or not APP_PASS:
            raise RuntimeError("VA_APP_USER/VA_APP_PASS nao encontrados no .env")
        # O formulario usa posicoes praticamente fixas dentro do cliente.
        # Fracoes da janela erravam o foco em 1382x752 e deixavam tudo vazio.
        inp.clear_field(hwnd, 350, 345)
        inp.type_text(hwnd, APP_USER)
        inp.key(hwnd, "tab")
        inp.type_text(hwnd, APP_PASS)
        inp.key(hwnd, "enter")
        passos.append("usuario/senha enviados")
        est, det = _esperar_estado(hwnd, ("login_empresa",), timeout)
        if est != "login_empresa":
            raise RuntimeError(f"empresa nao apareceu apos credenciais: {est} ({det})")

    if est == "login_empresa":
        inp.type_text(hwnd, EMPRESA)
        inp.key(hwnd, "enter")
        passos.append(f"empresa {EMPRESA} selecionada")
        est, det = _esperar_estado(hwnd, ("login_produto",), timeout)
        if est != "login_produto":
            raise RuntimeError(f"produto nao apareceu apos empresa: {est} ({det})")

    if est == "login_produto":
        if str(PRODUTO) != "1":
            raise RuntimeError(f"selecao automatica do produto {PRODUTO} nao validada")
        inp.key(hwnd, "enter")
        passos.append("produto padrao escolhido")
        est, det = _esperar_estado(hwnd, ("logado",), timeout)
        if est != "logado":
            raise RuntimeError(f"tela inicial nao apareceu: {est} ({det})")

    if est == "logado":
        ok, quando = esperar_pronto(hwnd)
        if not ok:
            raise RuntimeError(f"tela inicial nao ficou pronta ({quando})")
        passos.append(f"tela pintou ({quando})")
        avisos = dispensar_avisos(hwnd)
        if avisos:
            passos.append(f"{len(avisos)} tela(s) de aviso dispensada(s)")
        inp.click(hwnd, *CAMPO_BUSCA)
    else:
        raise RuntimeError(f"login nao confirmado: {est} ({det})")
    passos.append(f"estado final={est} ({det})")
    return "; ".join(passos)


def garantir_sessao():
    """Devolve (hwnd, o_que_foi_feito). Abre e loga se precisar."""
    h = find_window(TITLE)
    if h is None:
        h = lancar()
        return h, f"sessao iniciada; {logar(h)}"
    estado, _detalhe = estado_tela(h)
    if estado != "logado":
        return h, logar(h)
    avisos = dispensar_avisos(h)
    extra = f"; {len(avisos)} aviso(s) dispensado(s)" if avisos else ""
    return h, "sessao ja aberta e logada" + extra


if __name__ == "__main__":
    import io, sys
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    h = find_window(TITLE)
    if h is None:
        h, msg = garantir_sessao()
    else:
        est, detalhe = estado_tela(h)
        msg = f"estado detectado: {est} ({detalhe})"
    print(f"hwnd={h}  titulo Win32={win32gui.GetWindowText(h)!r} (sempre generico)")
    print(f"status: {msg}")
    img, how = capture(h, allow_foreground=False)
    img.save("shots/sessao.png")
    print(f"captura {img.size} via {how} -> shots/sessao.png")
