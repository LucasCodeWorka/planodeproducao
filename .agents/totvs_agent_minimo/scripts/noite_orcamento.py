"""Roteiro da noite do orçamento de MP (25/11/2026): deixa o TOTVS "no ponto de bala".

Etapas (cada uma avisa no Telegram ao começar e terminar; falha manda o print):
  1. CMPFM045 — troca a despesa dos itens de pedido do lote da tarde (612 itens).
  2. Espera a sincronização das 149 despesas criadas e grava app_mp_despesa (conferidor).
  3. FCPFM043 — vincula as despesas novas ao plano 500/CC 506.
  4. Espera a sincronização dos vínculos.
  5. FCPFM017 — refaz o preparo e lança os valores nas células vazias.
  6. CMPFM045 — refaz a auditoria dos pedidos e troca o que dependia das despesas novas.
  7. Resumo final.
Etapa que falha não derruba as independentes. Troca de tela insegura (componente que não
fecha, aviso aberto) PARA tudo — melhor parar de madrugada do que gravar no lugar errado.
Uso: python scripts/noite_orcamento.py [--so-telas] [--desde N]
"""
from __future__ import annotations

import argparse
import ctypes
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
import continuar_orcamento_2026_10_16 as outubro  # noqa: E402
from avisar_telegram import avisar as _avisar  # noqa: E402
from main import _alerta_totvs_aberto  # noqa: E402
from va_core import input as inp  # noqa: E402
from va_core import session  # noqa: E402
from va_core.capture import capture, find_window  # noqa: E402

HOJE = "2026-11-25"
DATA = ROOT / "data"
NOITE = DATA / "noite-2026-11-25"
SHOTS = ROOT / "shots" / "noite_20261125"
LOG = NOITE / "log.txt"
TITULO = (34, 57, 130, 78)
TITULOS = {
    "CMPFM020": ROOT / "shots" / "titulo_cmpfm020.png",
    "FCPFM043": ROOT / "shots" / "ag_094257.png",
    "FCPFM017": ROOT / "shots" / "ag_140610.png",
}


class Parar(Exception):
    pass


try:  # o console do Windows (cp1252) quebrava ao imprimir acento/emoji (25/11/2026)
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
os.environ["PYTHONIOENCODING"] = "utf-8"


def log(msg: str) -> None:
    NOITE.mkdir(parents=True, exist_ok=True)
    linha = f"[{datetime.now():%H:%M:%S}] {msg}"
    print(linha, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(linha + "\n")


def avisar(msg: str, foto: str | None = None) -> None:
    log(f"AVISO: {msg}")
    try:
        _avisar(f"🌙 Orçamento — {msg}", foto)
    except Exception as e:  # aviso não pode derrubar o roteiro
        log(f"falha ao avisar no Telegram: {e}")


def hwnd():
    h = find_window(session.TITLE)
    if h is None:
        raise Parar("TOTVS fechado")
    return h


def print_tela(nome: str) -> str | None:
    try:
        img, _ = capture(hwnd(), allow_foreground=False)
        SHOTS.mkdir(parents=True, exist_ok=True)
        caminho = SHOTS / f"{datetime.now():%H%M%S}_{nome}.png"
        img.save(caminho)
        return str(caminho)
    except Exception:
        return None


def texto(img):
    return [1 if sum(px) / 3 < 110 else 0 for px in img.convert("RGB").crop(TITULO).getdata()]


def tela_e(codigo: str) -> bool:
    img, _ = capture(hwnd(), allow_foreground=False)
    ref = texto(Image.open(TITULOS[codigo]))
    return sum(1 for a, b in zip(ref, texto(img)) if a != b) <= 3


def na_inicial() -> bool:
    img, _ = capture(hwnd(), allow_foreground=False)
    r, g, b = img.convert("RGB").getpixel((100, 300))
    return r + g + b < 250          # barra lateral escura da tela inicial


def ir_para(codigo: str) -> None:
    if find_window(session.TITLE) is None:
        # TOTVS fechado: o abrir-fluxo abre o sistema, faz o login e abre o componente
        # (validado com a aplicação fechada em 26/10/2026).
        log(f"TOTVS fechado; abrindo o sistema para ir a {codigo}")
        r = subprocess.run(["python", str(ROOT / "main.py"), "abrir-fluxo", codigo], cwd=REPO,
                           capture_output=True, text=True, timeout=400)
        time.sleep(8)
        if find_window(session.TITLE) is None or not tela_e(codigo):
            raise Parar(f"Não consegui abrir o TOTVS em {codigo}: {r.stdout.strip()[-200:]} {r.stderr.strip()[-200:]}")
        log(f"tela {codigo} aberta (sistema aberto pelo roteiro)")
        return
    h = hwnd()
    for _ in range(3):
        if na_inicial():
            break
        if _alerta_totvs_aberto(h):
            raise Parar(f"Aviso aberto antes de ir para {codigo}")
        inp.click(h, 1007, 67)       # fecha o componente da frente
        # Fechar o FCPFM043 mostra "Validando a estrutura do Plano de conta. Aguarde..." por
        # vários segundos (25/11/2026: passou dos 7,5s e o roteiro parou à toa).
        for _ in range(30):
            time.sleep(1)
            if na_inicial():
                break
    if not na_inicial():
        raise Parar(f"Não consegui voltar à tela inicial para abrir {codigo} (pendência ou pergunta aberta)")
    r = subprocess.run(["python", str(ROOT / "main.py"), "abrir-fluxo", codigo], cwd=REPO,
                       capture_output=True, text=True, timeout=300)
    time.sleep(6)
    if not tela_e(codigo):
        raise Parar(f"{codigo} não abriu: {r.stdout.strip()[-200:]} {r.stderr.strip()[-200:]}")
    log(f"tela {codigo} aberta")


def rodar(nome: str, cmd: list[str], timeout: int = 6 * 3600) -> tuple[int, str]:
    log(f"{nome}: {' '.join(cmd)}")
    r = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace")
    saida = (r.stdout + "\n" + r.stderr).strip()
    with (NOITE / f"{nome}.txt").open("a", encoding="utf-8") as f:
        f.write(saida + "\n")
    log(f"{nome}: saída {r.returncode}")
    return r.returncode, saida


def contar(arquivo: Path, chave) -> dict:
    if not arquivo.exists():
        return {}
    ultimo = {}
    for s in arquivo.read_text(encoding="utf-8").splitlines():
        if s.strip():
            r = json.loads(s)
            ultimo[chave(r)] = r.get("status")
    out = {}
    for v in ultimo.values():
        out[v] = out.get(v, 0) + 1
    return out


def etapa_cmpfm045(lote: Path, resultado: Path, rotulo: str) -> None:
    ir_para("CMPFM020")
    cod, saida = rodar(f"cmpfm045_{rotulo}", ["python", str(ROOT / "scripts" / "trocar_despesa_itens_cmpfm045.py"),
                       "--lote", str(lote), "--resultado", str(resultado), "--capturas", str(SHOTS / f"cmpfm045_{rotulo}")])
    resumo = contar(resultado, lambda r: (r["pedido"], r["produto"]))
    if cod != 0:
        avisar(f"CMPFM045 ({rotulo}) parou: {saida[-300:]}\nAté aqui: {resumo}", print_tela(f"cmpfm045_{rotulo}_parou"))
    else:
        avisar(f"CMPFM045 ({rotulo}) concluído: {resumo}")


def esperar(nome: str, cond, max_horas: float = 3.0, intervalo: int = 300) -> bool:
    fim = time.time() + max_horas * 3600
    while time.time() < fim:
        if cond():
            log(f"{nome}: pronto")
            return True
        log(f"{nome}: aguardando")
        time.sleep(intervalo)
    return False


def conferidor(gravar: bool) -> dict:
    cmd = ["node", "scripts/conferir-criacao-despesas-fcpfm003.mjs",
           str(DATA / f"lote-criacao-fcpfm003-{HOJE}.json"), str(DATA / f"resultado-criacao-fcpfm003-{HOJE}.jsonl")]
    if gravar:
        cmd.append("--gravar")
    _, saida = rodar("conferidor", cmd, timeout=600)
    i = saida.find("{\n")
    try:
        return json.loads(saida[i:saida.rindex("}") + 1])
    except Exception:
        return {}


def vinculos_sincronizados(lote: Path) -> bool:
    itens = json.loads(lote.read_text(encoding="utf-8")).get("itens", [])
    codigos = ",".join(str(i["codigo"]) for i in itens)
    if not codigos:
        return True
    _, saida = rodar("espera_vinculos", ["node", "-e",
        "require('dotenv').config();const {Pool}=require('pg');const p=new Pool({host:process.env.DB_HOST,port:+process.env.DB_PORT,"
        "database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,max:1,options:'-c default_transaction_read_only=on'});"
        f"p.query('SELECT count(DISTINCT cd_despesaitem) n FROM vr_fcp_planoctai WHERE cd_planoctac=500 AND cd_ccusto=506 AND cd_despesaitem IN ({codigos})')"
        ".then(r=>{console.log('N='+r.rows[0].n);p.end()})"], timeout=120)
    try:
        return int(saida.split("N=")[1].split()[0]) >= len(itens)
    except Exception:
        return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--so-telas", action="store_true", help="só testa as trocas de tela")
    ap.add_argument("--desde", type=int, default=1, help="começa nesta etapa")
    ap.add_argument("--sem-pedidos", action="store_true",
                    help="pula as etapas do CMPFM045 (25/11: o Confirmar não grava e a troca vale para o grupo inteiro)")
    args = ap.parse_args()
    NOITE.mkdir(parents=True, exist_ok=True)
    # Mantém o PC acordado enquanto este processo roda (sem mexer na configuração de energia).
    ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001 | 0x00000002)
    if args.so_telas:
        for c in ("FCPFM043", "FCPFM017", "CMPFM020"):
            ir_para(c)
        log("teste de telas ok")
        return 0
    avisar(f"começando o roteiro da noite (etapa {args.desde}).")
    falhas: list[str] = []
    try:
        if args.desde <= 1 and not args.sem_pedidos:
            etapa_cmpfm045(DATA / f"lote-cmpfm045-{HOJE}.json", DATA / f"resultado-cmpfm045-{HOJE}.jsonl", "tarde")
        if args.desde <= 2:
            ok = esperar("sincronizacao_despesas", lambda: conferidor(False).get("ok", 0) >= 148, 3.0)
            r = conferidor(True)
            avisar(f"despesas criadas: {r.get('ok', 0)} de 149 conferidas (RENDA ZG05914 CHOCOLATE U não foi criada; fica para amanhã) e ligadas em app_mp_despesa"
                   + ("" if ok else " (nem todas sincronizaram em 3h)") + f". Fora do padrão: {r.get('foraDoPerfil')}, duplicadas: {r.get('duplicado')}")
        lote043 = NOITE / "lote-fcpfm043.json"
        if args.desde <= 3:
            rodar("preparar_vinculos", ["node", "scripts/preparar-vinculos-fcpfm043.mjs",
                  str(DATA / f"classificacao-criadas-fcpfm003-{HOJE}.json"), "--saida", str(lote043)], timeout=600)
            ir_para("FCPFM043")
            outubro.garantir_plano_500(hwnd())
            cod, saida = rodar("fcpfm043", ["python", str(ROOT / "scripts" / "vincular_42_fcpfm043_2026_10_16.py"),
                               "--lote", str(lote043), "--resultado", str(NOITE / "resultado-fcpfm043.jsonl"),
                               "--capturas", str(SHOTS / "fcpfm043")])
            res = contar(NOITE / "resultado-fcpfm043.jsonl", lambda r: r["codigo"])
            avisar(("FCPFM043 parou: " + saida[-300:] if cod else "FCPFM043 concluído") + f"\nResultado: {res}",
                   print_tela("fcpfm043_parou") if cod else None)
        if args.desde <= 4 and lote043.exists():
            ok = esperar("sincronizacao_vinculos", lambda: vinculos_sincronizados(lote043), 3.0)
            avisar("vínculos sincronizados" if ok else "vínculos ainda não sincronizaram em 3h; sigo com o que houver")
        if args.desde <= 5:
            prep, conf = NOITE / "preparo.json", NOITE / "conferencia.json"
            rodar("preparo", ["node", "scripts/preparar-valores-fcpfm017.mjs", str(prep)], timeout=1800)
            rodar("conferencia", ["node", "scripts/conferir-orcamento-necessidade-atual.mjs", str(prep), str(conf)], timeout=600)
            _vinculadas = ",".join(str(x) for x in (DATA / f"resultado-fcpfm043-{HOJE}.jsonl", NOITE / "resultado-fcpfm043.jsonl") if x.exists())
            # Sem --vinculadas: o aviso de sucesso do FCPFM043 não prova o LUGAR do vínculo
            # (25/11/2026: 118 "confirmados" caíram na raiz do plano 500, sem CC). Só vale o espelho.
            cod, saida = rodar("montar_lote_017", ["node", "scripts/montar-lote-fcpfm017.mjs", str(prep), str(conf), str(NOITE)],
                               timeout=600)
            # O montador nomeia pelo dia em UTC (às 21h já é o dia seguinte): pega o lote mais
            # recente da pasta, nunca o arquivo de relatório (25/11/2026).
            candidatos = [x for x in NOITE.glob("lote-fcpfm017-*.json") if not x.name.endswith("-relatorio.json")]
            lote017 = max(candidatos, key=lambda x: x.stat().st_mtime)
            n = json.loads(lote017.read_text(encoding="utf-8")).get("entradas", 0)
            if n:
                ir_para("FCPFM017")
                outubro.garantir_orcamento_500_1(hwnd())
                # O lançador retoma de onde parou (pula o que já está VERIFICADO no resultado);
                # com o TOTVS lento à noite, uma parada isolada não deve encerrar a etapa.
                for tentativa in range(1, 4):
                    cod, saida = rodar("fcpfm017", ["python", str(ROOT / "scripts" / "lancar_lote_fcpfm017.py"),
                                       "--fonte", str(lote017), "--resultado", str(NOITE / "resultado-fcpfm017.jsonl"),
                                       "--capturas", str(SHOTS / "fcpfm017")])
                    if not cod:
                        break
                    if tentativa < 3:
                        log(f"FCPFM017 parou (tentativa {tentativa}); retomando: {saida[-160:]}")
                        time.sleep(5)
                res = contar(NOITE / "resultado-fcpfm017.jsonl", lambda r: (r["ano"], r["despesa"]))
                if cod:
                    falhas.append("FCPFM017")
                avisar(("FCPFM017 parou: " + saida[-300:] if cod else f"FCPFM017 concluído ({n} valores)") + f"\nResultado: {res}",
                       print_tela("fcpfm017_parou") if cod else None)
            else:
                avisar("FCPFM017: nenhuma célula vazia para lançar")
        if args.desde <= 6 and not args.sem_pedidos:
            aud, lote2 = NOITE / "auditoria-pedidos.json", NOITE / "lote-cmpfm045.json"
            rodar("auditoria_pedidos", ["node", "scripts/auditar-despesas-pedidos-orcamento-mp.mjs", str(NOITE / "preparo.json"),
                  str(DATA / f"lote-criacao-fcpfm003-{HOJE}.json"), "--saida", str(aud)], timeout=900)
            rodar("lote_cmpfm045_noite", ["node", "scripts/preparar-lote-cmpfm045.mjs", str(aud), "--saida", str(lote2)], timeout=600)
            etapa_cmpfm045(lote2, NOITE / "resultado-cmpfm045.jsonl", "noite")
        resumo = {
            "CMPFM045 tarde": contar(DATA / f"resultado-cmpfm045-{HOJE}.jsonl", lambda r: (r["pedido"], r["produto"])),
            "FCPFM043": contar(NOITE / "resultado-fcpfm043.jsonl", lambda r: r["codigo"]),
            "FCPFM017": contar(NOITE / "resultado-fcpfm017.jsonl", lambda r: (r["ano"], r["despesa"])),
            "CMPFM045 noite": contar(NOITE / "resultado-cmpfm045.jsonl", lambda r: (r["pedido"], r["produto"])),
        }
        avisar(("roteiro concluído ✅" if not falhas else f"roteiro terminou COM FALHA em {', '.join(falhas)} ⚠️") + "\n" +json.dumps(resumo, ensure_ascii=False, indent=1), print_tela("fim"))
    except Parar as e:
        avisar(f"PAREI por segurança: {e}", print_tela("parei"))
        return 1
    except Exception as e:
        avisar(f"ERRO inesperado: {type(e).__name__}: {e}", print_tela("erro"))
        raise
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
