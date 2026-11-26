"""Move para PCP / CC 506 as despesas que caíram soltas na raiz do plano 500 (FCPFM043).

Noite de 25/11/2026: o vinculador aceitou "Sequência" vazia como pai e 118 despesas
foram incluídas na RAIZ do plano 500 (nível 1, sem pai, sem centro de custo).
Correção sem excluir nada (piloto 1624 em 26/11/2026, 08:04): no item da raiz,
  1. Centro custo = 506 + Tab  -> aviso "Alteração de centro de custo realizada com sucesso!"
  2. Sequência pai = 26081 + Tab -> aviso "Alteração de sequência pai realizada com sucesso!"
O TOTVS grava cada campo na hora. Depois disso o item aparece como filho de PCP.

Pré-requisito: FCPFM043 aberto com o plano 500 carregado.
Cada item: End na árvore (o último item é sempre uma despesa da raiz enquanto houver),
duplo clique, confere Sequência na lista, Nível 1, Sequência pai vazia; só então edita.
Para no primeiro sinal estranho (aviso laranja, OCR incerto, item fora da lista).
Uso: python scripts/mover_raiz_para_pcp506_fcpfm043.py [--limite N]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ / "scripts"))
from va_core import input as inp  # noqa: E402
from va_core.capture import capture, find_window  # noqa: E402
from va_core import session  # noqa: E402
from ocr_fcpfm017 import construir_modelo, ler_valor  # noqa: E402

LOTE = RAIZ / "data" / "lote-mover-raiz-pcp506-2026-11-26.json"
RESULTADO = RAIZ / "data" / "resultado-mover-raiz-pcp506-2026-11-26.jsonl"
CAPTURAS = RAIZ / "shots" / "mover_raiz_pcp506_20261126"
PAI, CC = 26081, 506
LINHA_FIM = (670, 617)       # último item visível depois do End
CAMPO_CC = (137, 245)
CAMPO_PAI = (137, 277)
FECHAR_AVISO = (1079, 331)


class Parar(RuntimeError):
    pass


def img(h):
    i, metodo = capture(h, allow_foreground=False)
    if i is None or i.size != (1382, 752):
        raise Parar(f"captura inválida: {metodo}")
    return i.convert("RGB")


def guardar(i, nome):
    CAPTURAS.mkdir(parents=True, exist_ok=True)
    caminho = CAPTURAS / f"{datetime.now():%H%M%S}_{nome}.png"
    i.save(caminho)
    return str(caminho)


def aviso(i) -> str | None:
    r, g, b = i.getpixel((300, 330))
    if b > 140 and g > 120 and r < 100:
        return "teal"
    if r > 200 and g > 100 and b < 100:
        return "laranja"
    return None


def ler(i, y, modelo, x0=104, x1=172) -> str:
    valor, dist = ler_valor(i, y, modelo, x0, x1)
    if any(d > 3 for d in dist):
        raise Parar(f"OCR incerto y={y}: {valor!r} {dist}")
    return valor.replace(".", "")


def esperar_aviso(h, segundos=20) -> str:
    fim = time.monotonic() + segundos
    while time.monotonic() < fim:
        a = aviso(img(h))
        if a:
            return a
        time.sleep(0.4)
    return ""


def fechar_aviso(h):
    for _ in range(10):
        inp.click(h, *FECHAR_AVISO)
        time.sleep(0.8)
        if not aviso(img(h)):
            return
    raise Parar("aviso não fechou")


def registrar(r):
    with RESULTADO.open("a", encoding="utf-8") as f:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")


def feitos() -> set[int]:
    if not RESULTADO.exists():
        return set()
    return {json.loads(l)["seq"] for l in RESULTADO.read_text(encoding="utf-8").splitlines()
            if l.strip() and json.loads(l)["status"] == "MOVIDO"}


def selecionar_ultimo(h, modelo):
    """End na árvore + duplo clique no último item; devolve a captura e os campos lidos."""
    inp.click(h, 700, 400)           # foco na árvore (sem duplo clique: não seleciona)
    time.sleep(0.5)
    inp.key(h, "end")
    time.sleep(2.0)
    inp.double_click(h, *LINHA_FIM)
    time.sleep(2.5)
    i = img(h)
    if aviso(i):
        raise Parar(f"aviso aberto antes de editar: {guardar(i, 'aviso_antes')}")
    return (i, int(ler(i, 198, modelo) or 0), int(ler(i, 230, modelo) or 0),
            ler(i, 198, modelo, 350, 416), ler(i, 246, modelo), ler(i, 278, modelo))


def mover_um(h, modelo, lista: dict[int, dict]) -> dict:
    i, seq, despesa, nivel, cc, pai = selecionar_ultimo(h, modelo)
    item = lista.get(seq)
    if item is None or item["despesa"] != despesa:
        raise Parar(f"último item não está na lista: seq={seq} despesa={despesa} ({guardar(i, 'fora_da_lista')})")
    if nivel != "1" or pai:
        raise Parar(f"seq {seq} não está na raiz: nível={nivel!r} pai={pai!r} ({guardar(i, 'nao_raiz')})")
    antes = guardar(i, f"{despesa}_antes")

    if cc != str(CC):
        if cc:
            raise Parar(f"seq {seq} tem CC {cc}, esperado vazio ou {CC}")
        inp.set_field(h, *CAMPO_CC, str(CC))
        inp.key(h, "tab")
        a = esperar_aviso(h)
        if a != "teal":
            raise Parar(f"CC de {despesa}: aviso {a or 'nenhum'} ({guardar(img(h), f'{despesa}_cc')})")
        fechar_aviso(h)
        time.sleep(1.5)
        # Fechar o aviso limpa o painel da esquerda (26/11/2026, 1621): selecionar de novo
        # e conferir que é o MESMO item, agora com CC 506 e ainda sem pai.
        i, seq2, desp2, nivel, cc, pai = selecionar_ultimo(h, modelo)
        if (seq2, desp2) != (seq, despesa) or cc != str(CC) or pai or nivel != "1":
            raise Parar(f"depois do CC: seq={seq2} desp={desp2} cc={cc!r} pai={pai!r} nível={nivel!r} "
                        f"({guardar(i, f'{despesa}_depois_cc')})")

    inp.set_field(h, *CAMPO_PAI, str(PAI))
    inp.key(h, "tab")
    a = esperar_aviso(h)
    if a != "teal":
        raise Parar(f"pai de {despesa}: aviso {a or 'nenhum'} ({guardar(img(h), f'{despesa}_pai')})")
    depois = guardar(img(h), f"{despesa}_pai_ok")
    fechar_aviso(h)
    time.sleep(2.5)                  # a árvore se redesenha
    return {"status": "MOVIDO", "seq": seq, "despesa": despesa, "antes": antes, "depois": depois,
            "momento": datetime.now().isoformat(timespec="seconds")}


def abrir_plano_500(h):
    """Abre o FCPFM043 do zero e carrega o plano 500 (o roteiro precisa da tela limpa:
    digitar num painel vazio prende o formulário em "Campo de preenchimento obrigatório")."""
    import subprocess
    r = subprocess.run([sys.executable, str(RAIZ / "main.py"), "abrir-fluxo", "FCPFM043"], cwd=RAIZ,
                       capture_output=True, text=True, timeout=300)
    time.sleep(8)
    inp.set_field(h, 136, 149, "500")
    inp.key(h, "tab")
    for _ in range(40):              # a árvore do plano 500 demora (550+ itens)
        time.sleep(1)
        i = img(h)
        escuros = sum(1 for x in range(480, 700) for y in range(148, 159) if sum(i.getpixel((x, y))) < 200)
        if escuros > 40:             # texto da primeira linha da árvore
            time.sleep(2)
            return
    raise Parar(f"plano 500 não carregou no FCPFM043: {r.stdout[-200:]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limite", type=int)
    args = ap.parse_args()
    h = find_window(session.TITLE)
    if h is None:
        raise SystemExit("TOTVS fechado")
    lote = json.loads(LOTE.read_text(encoding="utf-8"))
    ja = feitos()
    lista = {x["seq"]: x for x in lote["itens"] if x["seq"] not in ja}
    total = len(lista) if args.limite is None else min(args.limite, len(lista))
    print(f"lista {len(lote['itens'])}, já movidos {len(ja)}, nesta execução {total}", flush=True)
    modelo = construir_modelo(RAIZ / "shots")
    abrir_plano_500(h)
    for n in range(1, total + 1):
        try:
            r = mover_um(h, modelo, lista)
        except Parar as e:
            registrar({"status": "PAROU", "erro": str(e), "momento": datetime.now().isoformat(timespec="seconds")})
            print(f"PAREI: {e}", flush=True)
            raise SystemExit(1)
        registrar(r)
        lista.pop(r["seq"], None)
        print(f"[{n}/{total}] {r['despesa']} (seq {r['seq']}) -> PCP/506", flush=True)


if __name__ == "__main__":
    main()
