"""Cria no FCPFM003 as despesas de um lote preparado (uma por grupo+cor da MP).

Lote: scripts/preparar-criacao-despesas-fcpfm003.mjs (status PREPARADO_NAO_CRIADO).
Sequência de tela a mesma validada em 26/10/2026 (criar_despesas_fcpfm003.py), com travas:

- só roda com o FCPFM003 na tela (título conferido contra a captura de referência);
- guarda captura antes de incluir, antes de gravar e depois de gravar;
- registra INICIADO antes do F3 e GRAVADO depois: uma rodada nova recusa repetir item com
  resultado incerto (não duplica despesa);
- para em qualquer aviso do TOTVS.

NÃO presume o código gerado (o criador antigo presumia uma sequência e gravava isso em
app_mp_despesa). O código e os campos (Padrão, Custo/Despesa, Fixo, Administrativo, rateio)
são conferidos depois da sincronização, por nome exato, em
scripts/conferir-criacao-despesas-fcpfm003.mjs — só ele grava app_mp_despesa.
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
from main import _alerta_totvs_aberto  # noqa: E402
from va_core import input as inp  # noqa: E402
from va_core import session, tools  # noqa: E402
from va_core.capture import capture, find_window, rect  # noqa: E402

TITULO = (34, 57, 100, 78)
REFERENCIA_TITULO = ROOT / "shots" / "titulo_fcpfm003.png"
# Linha nova certa (1478, corrigida em 25/11/2026): Padrão marcado e Custo/Despesa = Despesa.
# No piloto as duas células ficaram erradas — o mesmo defeito de outubro — porque o clique
# no combo chegava antes de a lista abrir. Antes do F3 a linha nova é comparada com esta.
REFERENCIA_LINHA = ROOT / "shots" / "ref_linha_fcpfm003_ok.png"
CELULA_PADRAO = (556, 479, 576, 494)
CELULA_CUSTO = (678, 479, 742, 494)


def imagem(hwnd) -> Image.Image:
    img, metodo = capture(hwnd, allow_foreground=False)
    if img is None or img.size != (1382, 752):
        raise RuntimeError(f"captura inválida: {metodo}, {getattr(img, 'size', None)}")
    return img


def guardar(pasta: Path, img: Image.Image, chave: str, etapa: str) -> str:
    pasta.mkdir(parents=True, exist_ok=True)
    caminho = pasta / f"{datetime.now():%H%M%S}_{chave}_{etapa}.png"
    img.save(caminho)
    return str(caminho)


def e_fcpfm003(img: Image.Image) -> bool:
    if not REFERENCIA_TITULO.exists():
        raise RuntimeError(f"Referência de título ausente: {REFERENCIA_TITULO}")
    # Compara só o TEXTO do título (pixels escuros): o fundo da barra clareia quando a janela
    # perde o foco e derrubava a comparação por cor (25/11/2026).
    def texto(im):
        return [1 if sum(px) / 3 < 110 else 0 for px in im.convert("RGB").crop(TITULO).getdata()]
    ref = texto(Image.open(REFERENCIA_TITULO))
    atual = texto(img)
    return sum(1 for x, y in zip(ref, atual) if x != y) <= 3


def celula_ok(img: Image.Image, caixa) -> bool:
    ref = Image.open(REFERENCIA_LINHA).convert("RGB").crop(caixa)
    diff = ImageChops.difference(img.convert("RGB").crop(caixa), ref)
    return sum(1 for p in diff.getdata() if max(p) > 30) <= 6


def escolher_despesa(hwnd) -> None:
    tools.clicar(750, 486, esperar=0.9)   # abre a lista do Custo/Despesa
    tools.clicar(705, 516, esperar=0.6)   #   -> Despesa (Custo 501, Despesa 516, "..." 531)


def registrar(resultado: Path, registro: dict) -> None:
    with resultado.open("a", encoding="utf-8") as arq:
        arq.write(json.dumps(registro, ensure_ascii=False) + "\n")
        arq.flush()


def criar(hwnd, item: dict, pasta: Path, resultado: Path) -> dict:
    chave = f"{item['seqgrupo']}_{item['cor']}"
    descricao = item["descricao"]
    antes = imagem(hwnd)
    if not e_fcpfm003(antes):
        guardar(pasta, antes, chave, "fora_do_fcpfm003")
        raise RuntimeError("A tela não é o FCPFM003; parei antes de incluir")
    if _alerta_totvs_aberto(hwnd):
        guardar(pasta, antes, chave, "alerta_antes")
        raise RuntimeError("Aviso do TOTVS aberto antes de incluir")

    tools.clicar(150, 96, esperar=1.0)                 # + incluir
    tools.preencher(130, 486, descricao, esperar=0.5)  # Despesa item *
    tools.preencher(450, 486, descricao, esperar=0.5)  # Descrição auxiliar
    tools.preencher(260, 486, "100,00000", esperar=0.4)  # % Rateio
    tools.clicar(565, 486, esperar=0.5)                # Padrão
    tools.preencher(610, 486, "Fixo", esperar=0.4)     # Fixo/Variável
    escolher_despesa(hwnd)                             # Custo/Despesa -> Despesa
    tools.clicar(834, 486, esperar=0.9)                # Direto/Indireto
    tools.clicar(800, 531, esperar=0.6)                #   -> Administrativo
    tools.clicar(932, 486, esperar=0.9)                # Tipo de custo
    tools.clicar(884, 504, esperar=0.6)                #   -> Administrativo

    # O combo só confirma o valor quando o foco sai dele (1621, 25/11/2026: lido como vazio
    # antes do clique fora, certo depois). Tirar o foco antes de conferir.
    tools.clicar(450, 486, esperar=0.6)
    # Confere Padrão e Custo/Despesa contra a linha certa; acerta até duas vezes.
    for tentativa in range(3):
        pre = imagem(hwnd)
        padrao, custo = celula_ok(pre, CELULA_PADRAO), celula_ok(pre, CELULA_CUSTO)
        if padrao and custo:
            break
        if tentativa == 2:
            caminho = guardar(pasta, pre, chave, "linha_divergente")
            raise RuntimeError(f"Linha nova fora do padrão (Padrão={padrao}, Custo/Despesa={custo}); não gravei: {caminho}")
        if not padrao:
            tools.clicar(565, 486, esperar=0.5)
        if not custo:
            escolher_despesa(hwnd)
        # Tira o foco do combo clicando numa célula de texto (Esc poderia cancelar a inclusão).
        tools.clicar(450, 486, esperar=0.5)

    caminho_pre = guardar(pasta, pre, chave, "antes_gravar")
    if _alerta_totvs_aberto(hwnd):
        raise RuntimeError(f"Aviso do TOTVS durante o preenchimento: {caminho_pre}")
    registrar(resultado, {"seqgrupo": item["seqgrupo"], "cor": item["cor"], "descricao": descricao,
                          "status": "INICIADO", "antesGravar": caminho_pre, "momento": datetime.now().isoformat()})
    inp.key(hwnd, "f3")
    time.sleep(1.5)
    depois = imagem(hwnd)
    caminho_depois = guardar(pasta, depois, chave, "depois_gravar")
    if _alerta_totvs_aberto(hwnd):
        raise RuntimeError(f"Aviso do TOTVS ao gravar {descricao}: {caminho_depois}")
    return {"seqgrupo": item["seqgrupo"], "cor": item["cor"], "descricao": descricao, "status": "GRAVADO",
            "antesGravar": caminho_pre, "depoisGravar": caminho_depois, "momento": datetime.now().isoformat()}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lote", type=Path, required=True)
    parser.add_argument("--resultado", type=Path, required=True)
    parser.add_argument("--capturas", type=Path, required=True)
    parser.add_argument("--limite", type=int)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    lote = json.loads(args.lote.read_text(encoding="utf-8"))
    if lote.get("status") != "PREPARADO_NAO_CRIADO" or lote.get("despesas") != len(lote.get("itens", [])):
        raise RuntimeError("Arquivo de lote inesperado")
    feitos = []
    if args.resultado.exists():
        feitos = [json.loads(s) for s in args.resultado.read_text(encoding="utf-8").splitlines() if s.strip()]
    ultimo = {}
    for r in feitos:
        ultimo[(r["seqgrupo"], r["cor"])] = r["status"]
    incertos = [k for k, s in ultimo.items() if s == "INICIADO"]
    if incertos:
        raise RuntimeError(f"Gravação de resultado incerto; conferir no ERP antes de repetir: {incertos}")
    pendentes = [i for i in lote["itens"] if ultimo.get((i["seqgrupo"], i["cor"])) != "GRAVADO"]
    if args.limite is not None:
        pendentes = pendentes[:args.limite]
    print(f"Lote {len(lote['itens'])} despesas; pendentes nesta execução {len(pendentes)}", flush=True)
    if args.dry_run:
        for i in pendentes:
            print(f"  {i['seqgrupo']}/{i['cor']}: {i['descricao']}", flush=True)
        return 0

    hwnd = find_window(session.TITLE)
    if hwnd is None:
        raise RuntimeError("TOTVS fechado")
    tamanho = rect(hwnd)
    if (tamanho["w"], tamanho["h"]) != (1382, 752):
        raise RuntimeError(f"Janela com tamanho inesperado: {tamanho}")
    for n, item in enumerate(pendentes, 1):
        print(f"[{n}/{len(pendentes)}] {item['seqgrupo']}/{item['cor']} {item['descricao']}", flush=True)
        registro = criar(hwnd, item, args.capturas, args.resultado)
        registrar(args.resultado, registro)
        print("  GRAVADO", flush=True)
    print(f"Concluídos nesta execução: {len(pendentes)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
