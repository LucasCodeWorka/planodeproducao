"""Retoma o orçamento de despesas com checkpoints e o agente TOTVS existente.

Uma execução abre e autentica o cliente quando necessário,
abre os componentes e continua de onde os arquivos de resultado pararam.
Não repete códigos confirmados; um resultado incerto exige conferência.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from va_core import input as inp
from va_core import session, tools
from va_core.capture import capture, find_window, rect

LOTE_VINCULOS = ROOT / "data" / "lote-42-fcpfm043-2026-10-16.json"
RESULTADO_VINCULOS = ROOT / "data" / "resultado-42-fcpfm043-2026-10-16.jsonl"
LOTE_VALORES = ROOT / "data" / "lote-42-fcpfm017-2026-10-16.json"
LOTE_PRONTO = ROOT / "data" / "lote-42-fcpfm017-pronto-2026-10-16.json"
RESULTADO_VALORES = ROOT / "data" / "resultado-42-fcpfm017-2026-10-16.jsonl"
CAPTURAS_VALORES = ROOT / "shots" / "lote_42_fcpfm017_20261016"
MODELOS_TITULO = {
    "FCPFM043": ROOT / "shots" / "ag_094257.png",
    "FCPFM017": ROOT / "shots" / "ag_140610.png",
}
TITULO = (34, 57, 100, 78)
PLANO_500 = (139, 143, 173, 157)
NUMERO_1 = (145, 159, 173, 174)


def ler_jsonl(caminho: Path):
    if not caminho.exists():
        return []
    return [json.loads(linha) for linha in caminho.read_text(encoding="utf-8").splitlines()
            if linha.strip()]


def conferir_lotes():
    vinculos = json.loads(LOTE_VINCULOS.read_text(encoding="utf-8"))
    valores = json.loads(LOTE_VALORES.read_text(encoding="utf-8"))
    ids_vinculos = {item["codigo"] for item in vinculos["itens"]}
    ids_valores = {item["despesa"] for item in valores["lancamentos"]}
    if (vinculos["plano"], vinculos["centroCusto"], vinculos["despesas"],
            vinculos["pilotoVinculado"]) != (500, 506, 41, 11681):
        raise RuntimeError("Lote de vínculo inesperado")
    if len(ids_vinculos) != 41 or 11681 in ids_vinculos:
        raise RuntimeError("Códigos repetidos ou piloto incluído no lote de vínculo")
    if (valores["status"] != "PREPARADO_AGUARDANDO_41_VINCULOS"
            or valores["despesas"] != 42 or valores["entradas"] != 78
            or valores["totalCentavos"] != 7545659
            or ids_valores != ids_vinculos | {11681}):
        raise RuntimeError("Lote de valores não corresponde aos 42 códigos")
    if sum(item["valorCentavos"] for item in valores["lancamentos"]) != 7545659:
        raise RuntimeError("Total de valores divergente")
    return vinculos, valores


def progresso_vinculos(codigos):
    ultimo = {}
    for item in ler_jsonl(RESULTADO_VINCULOS):
        codigo = int(item["codigo"])
        if codigo not in codigos:
            raise RuntimeError(f"Resultado contém código fora do lote: {codigo}")
        ultimo[codigo] = item["status"]
    incertos = [codigo for codigo, status in ultimo.items() if status != "CONFIRMADO"]
    if incertos:
        raise RuntimeError(f"Resultado incerto; conferir no ERP antes de repetir: {incertos}")
    return len(ultimo)


def progresso_valores():
    linhas = ler_jsonl(RESULTADO_VALORES)
    pares = [(item["ano"], item["despesa"]) for item in linhas
             if item["status"] in {"VERIFICADO", "JA_EXISTIA_CORRETO"}]
    if len(set(pares)) != len(pares):
        raise RuntimeError("Resultado de valores contém pares duplicados")
    return len(pares)


def estado():
    hwnd = find_window(session.TITLE)
    if hwnd is None:
        return None, "sem_janela"
    return hwnd, session.estado_tela(hwnd)[0]


def aguardar_sessao(timeout):
    hwnd, atual = estado()
    if atual != "logado":
        print("Abrindo TOTVS pelo agente existente.", flush=True)
        subprocess.run([sys.executable, str(ROOT / "main.py"), "abrir-sistema"], check=True)
    prazo = time.monotonic() + timeout
    ultimo = None
    while time.monotonic() < prazo:
        hwnd, atual = estado()
        if atual != ultimo:
            print(f"Sessão: {atual}", flush=True)
            ultimo = atual
        if atual == "logado":
            if titulo_atual(hwnd) not in MODELOS_TITULO:
                pronto, detalhe = session.esperar_pronto(hwnd, timeout=90)
                if not pronto:
                    raise RuntimeError(f"TOTVS logado, mas página inicial não pintou: {detalhe}")
            tamanho = rect(hwnd)
            if (tamanho["w"], tamanho["h"]) != (1382, 752):
                raise RuntimeError(f"Resolução inesperada: {tamanho}")
            return hwnd
        if atual == "sem_janela":
            raise RuntimeError("Janela do TOTVS fechou durante a espera")
        time.sleep(2)
    raise TimeoutError("Tempo esgotado aguardando login; nenhum orçamento foi lançado")


def titulo_atual(hwnd):
    img, metodo = capture(hwnd, allow_foreground=False)
    if img is None or img.size != (1382, 752):
        raise RuntimeError(f"Captura inválida: {metodo}, {getattr(img, 'size', None)}")
    atual = img.convert("RGB").crop(TITULO)
    for codigo, caminho in MODELOS_TITULO.items():
        modelo = Image.open(caminho).convert("RGB").crop(TITULO)
        diff = ImageChops.difference(atual, modelo)
        if sum(1 for pixel in diff.getdata() if max(pixel) > 20) <= 3:
            return codigo
    return None


def plano_500_visivel(hwnd):
    img, metodo = capture(hwnd, allow_foreground=False)
    if img is None or img.size != (1382, 752):
        raise RuntimeError(f"Captura inválida para plano: {metodo}")
    referencia = Image.open(ROOT / "shots" / "ag_163143.png").convert("RGB").crop(PLANO_500)
    diff = ImageChops.difference(img.convert("RGB").crop(PLANO_500), referencia)
    return sum(1 for pixel in diff.getdata() if max(pixel) > 20) <= 3


def garantir_plano_500(hwnd):
    if plano_500_visivel(hwnd):
        return
    inp.set_field(hwnd, 135, 149, "500")
    inp.key(hwnd, "tab")
    time.sleep(2.0)
    if not plano_500_visivel(hwnd):
        raise RuntimeError("Plano 500 não carregou no FCPFM043")


def orcamento_500_1_visivel(hwnd):
    img, metodo = capture(hwnd, allow_foreground=False)
    if img is None or img.size != (1382, 752):
        raise RuntimeError(f"Captura inválida para orçamento: {metodo}")
    atual = img.convert("RGB")
    referencia = Image.open(ROOT / "shots" / "ag_164724.png").convert("RGB")
    for caixa in (PLANO_500, NUMERO_1):
        diff = ImageChops.difference(atual.crop(caixa), referencia.crop(caixa))
        if sum(1 for pixel in diff.getdata() if max(pixel) > 20) > 3:
            return False
    return True


def garantir_orcamento_500_1(hwnd):
    if orcamento_500_1_visivel(hwnd):
        return
    for y, valor in ((149, "500"), (165, "1"), (182, "2026")):
        inp.set_field(hwnd, 135, y, valor)
        inp.key(hwnd, "tab")
        time.sleep(0.6)
    if not orcamento_500_1_visivel(hwnd):
        raise RuntimeError("Plano 500/número 1 não carregou no FCPFM017")


def abrir_componente(hwnd, codigo):
    visivel = titulo_atual(hwnd)
    if visivel == codigo:
        return
    if visivel is not None:
        inp.click(hwnd, 1007, 67)
        time.sleep(1.0)
        if titulo_atual(hwnd) is not None:
            raise RuntimeError(f"Componente {visivel} não fechou; parei sem abrir outro")
    # Se houver um componente não reconhecido, a busca não está necessariamente
    # disponível: a inspeção visual será necessária antes de prosseguir.
    elif not session.esperar_pronto(hwnd, timeout=5)[0]:
        raise RuntimeError("Tela inicial não reconhecida; não vou digitar na busca")
    tools.abrir_componente(codigo, espera=8.0)
    if titulo_atual(hwnd) != codigo:
        raise RuntimeError(f"Componente {codigo} não apareceu após a busca")


def preparar_valores_prontos(valores):
    pronto = {**valores, "status": "PREPARADO_NAO_LANCADO",
              "vinculosConfirmados": 41, "pilotoConfirmado": 11681}
    LOTE_PRONTO.write_text(json.dumps(pronto, ensure_ascii=False, indent=2) + "\n",
                           encoding="utf-8")


def executar(args):
    vinculos, valores = conferir_lotes()
    codigos = {item["codigo"] for item in vinculos["itens"]}
    concluidos = progresso_vinculos(codigos)
    print(f"Vínculos: {concluidos}/41; valores verificados: {progresso_valores()} pares", flush=True)
    if args.fase == "status":
        print(f"TOTVS: {estado()[1]}", flush=True)
        return
    if args.fase == "valores" and concluidos != 41:
        raise RuntimeError(f"Não vou iniciar valores: faltam {41 - concluidos} vínculos")

    hwnd = aguardar_sessao(args.esperar_login)
    if args.fase in {"vinculos", "completo"} and concluidos < 41:
        abrir_componente(hwnd, "FCPFM043")
        garantir_plano_500(hwnd)
        comando = [sys.executable, str(ROOT / "scripts" / "vincular_42_fcpfm043_2026_10_16.py")]
        if args.limite is not None:
            comando.extend(["--limite", str(args.limite)])
        subprocess.run(comando, check=True)
        concluidos = progresso_vinculos(codigos)
        print(f"Vínculos confirmados após execução: {concluidos}/41", flush=True)
        if args.fase == "vinculos" or concluidos < 41:
            return

    if args.fase in {"valores", "completo"}:
        if concluidos != 41:
            raise RuntimeError(f"Não vou lançar valores: faltam {41 - concluidos} vínculos")
        preparar_valores_prontos(valores)
        abrir_componente(hwnd, "FCPFM017")
        garantir_orcamento_500_1(hwnd)
        comando = [sys.executable, str(ROOT / "scripts" / "lancar_lote_fcpfm017.py"),
                   "--fonte", str(LOTE_PRONTO), "--resultado", str(RESULTADO_VALORES),
                   "--capturas", str(CAPTURAS_VALORES)]
        if args.limite is not None:
            comando.extend(["--limit", str(args.limite)])
        subprocess.run(comando, check=True)
        if args.limite is None:
            subprocess.run([sys.executable,
                            str(ROOT / "scripts" / "auditar_resultado_fcpfm017.py"),
                            "--lote", str(LOTE_PRONTO),
                            "--resultado", str(RESULTADO_VALORES)], check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fase", choices=["status", "vinculos", "valores", "completo"],
                        default="status")
    parser.add_argument("--limite", type=int, help="Teste limitado e retomável")
    parser.add_argument("--esperar-login", type=int, default=900,
                        help="Segundos para confirmar a sessão após abrir o TOTVS")
    opcoes = parser.parse_args()
    if opcoes.limite is not None and opcoes.limite < 1:
        parser.error("--limite precisa ser positivo")
    executar(opcoes)
