"""CLI minima para o kit de agente TOTVS.

Uso:
    python totvs_agent_minimo/main.py status
    python totvs_agent_minimo/main.py abrir-sistema
    python totvs_agent_minimo/main.py abrir PRDFL035
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

from core.orchestrator import TotvsOrchestrator
from core.skill_registry import SkillRegistry


PENDENCIAS_DESPESA_FCPFM003 = [
    ("1011", "1901", "ELAST. NILLO 25MM AMEIXA U"),
    ("1029", "300", "ELAST. PAJAU 14 MM PRETO U"),
    ("1068", "1697", "ELAST. DONNA 14MM NUDE U"),
    ("13097", "100", "BJ 7004 TQC CASCA BRANCO 50"),
    ("13308", "300", "ELASTICO TUSTI 10MM PRETO U"),
    ("14423", "904", "TAG LIEBE ONE UNICA U"),
    ("4855", "1901", "TEC DE MALHA PLUME ACABADO 158746001011 AMEIXA U"),
    ("615", "1902", "ABOTOADOR 60MM X 03 REGULAGEM - 8758483 MILKSHAKE U"),
]


def _atualizar_app_mp_despesa(seqgrupo: str, cor: str, codigo: int) -> None:
    repo = Path(__file__).resolve().parents[2]
    subprocess.run(
        [
            "node",
            "scripts\\inspect-orcamento-totvs.mjs",
            "marcar-despesa-ok",
            seqgrupo,
            cor,
            str(codigo),
        ],
        cwd=repo,
        check=True,
    )


def _criar_despesa_fcpfm003(seqgrupo: str, cor: str, descricao: str, codigo: int) -> None:
    from va_core import input as inp
    from va_core import tools
    from va_core.capture import find_window
    from va_core import session

    hwnd = find_window(session.TITLE)
    if hwnd is None:
        raise RuntimeError("janela do TOTVS Moda nao encontrada")

    print(f"[{codigo}] criando {seqgrupo}/{cor} - {descricao}")
    tools.ver_tela(nota=f"antes de incluir {seqgrupo}/{cor}")
    tools.clicar(150, 96, esperar=1.0)
    tools.preencher(130, 486, descricao, esperar=0.5)
    tools.preencher(450, 486, descricao, esperar=0.5)
    tools.preencher(260, 486, "100,00000", esperar=0.4)
    tools.clicar(565, 486, esperar=0.25)
    tools.preencher(610, 486, "Fixo", esperar=0.25)
    tools.clicar(750, 486, esperar=0.25)
    tools.clicar(705, 516, esperar=0.25)
    tools.clicar(834, 486, esperar=0.25)
    tools.clicar(800, 531, esperar=0.25)
    tools.clicar(932, 486, esperar=0.25)
    tools.clicar(884, 504, esperar=0.25)
    tools.ver_tela(nota=f"antes de salvar {seqgrupo}/{cor}")
    inp.key(hwnd, "f3")
    time.sleep(1.2)
    tools.ver_tela(nota=f"apos salvar {seqgrupo}/{cor} codigo {codigo}")
    _atualizar_app_mp_despesa(seqgrupo, cor, codigo)


def _corrigir_despesas_fcpfm003_visiveis() -> None:
    from va_core import input as inp
    from va_core import tools
    from va_core.capture import find_window
    from va_core import session

    hwnd = find_window(session.TITLE)
    if hwnd is None:
        raise RuntimeError("janela do TOTVS Moda nao encontrada")

    # Linhas 1454..1461, visiveis no final da grade apos o lote.
    ys = [373, 389, 405, 421, 437, 453, 469, 485]
    for y in ys:
        tools.clicar(565, y, esperar=0.15)
        tools.clicar(750, y, esperar=0.15)
        tools.clicar(705, min(y + 30, 516), esperar=0.15)
    tools.ver_tela(nota="antes de salvar correcao padrao e custo/despesa")
    inp.key(hwnd, "f3")
    time.sleep(1.2)
    tools.ver_tela(nota="apos salvar correcao padrao e custo/despesa")


def _alerta_totvs_aberto(hwnd) -> bool:
    """Detecta os avisos teal ou laranja exibidos pelo TOTVS."""
    from va_core.capture import capture

    img, _ = capture(hwnd, allow_foreground=False)
    if img is None:
        return False
    r, g, b = img.convert("RGB").getpixel((300, 330))
    return (b > 140 and g > 120 and r < 100) or (r > 200 and g > 100 and b < 100)


def _selecionar_pcp_506(hwnd) -> None:
    """Seleciona o pai PCP/506 sem confundir a primeira despesa com o pai.

    Com a arvore expandida, o primeiro filho ocupa y=168 e o PCP fica em
    y=153. Com ela recolhida, o PCP ocupa y=168. A bolinha laranja do primeiro
    filho permite distinguir os dois estados antes do duplo clique.
    """
    from va_core import input as inp
    from va_core.capture import capture

    img, _ = capture(hwnd, allow_foreground=False)
    if img is None:
        raise RuntimeError("nao foi possivel ler a arvore do plano de contas")

    pixels = img.convert("RGB")
    tem_filho_visivel = any(
        (r > 160 and 55 < g < 180 and b < 90)
        for x in range(495, 510)
        for y in range(160, 177)
        for r, g, b in [pixels.getpixel((x, y))]
    )
    y_pcp = 153 if tem_filho_visivel else 168
    inp.double_click(hwnd, 590, y_pcp)
    time.sleep(1.2)


def _posicao_fcpfl020(hwnd) -> tuple[int, int]:
    """Encontra o canto da janela FCPFL020 pelo X do botao fechar.

    A janela e deslocavel e o TOTVS reaproveita sua ultima posicao. Os campos
    internos, porem, conservam os mesmos deslocamentos relativos ao canto.
    """
    from va_core.capture import capture

    img, _ = capture(hwnd, allow_foreground=False)
    if img is None:
        raise RuntimeError("nao foi possivel localizar a janela FCPFL020")
    rgb = img.convert("RGB")
    for cy in range(55, 700):
        for cx in range(560, 850):
            if all(
                rgb.getpixel((x, y)) == (0, 0, 0)
                for x, y in (
                    (cx - 4, cy - 4),
                    (cx + 4, cy - 4),
                    (cx, cy),
                    (cx - 4, cy + 4),
                    (cx + 4, cy + 4),
                )
            ):
                return cx - 550, cy - 11
    raise RuntimeError("botao fechar da janela FCPFL020 nao localizado")


def _vincular_lote_fcpfm043(
    limite: int | None = None,
    somente_sem_registro: bool = False,
) -> None:
    """Vincula despesas unicas do lote ao PCP/CC 506, sem interromper.

    O painel e detalhado por MP, mas o FCPFM043 trabalha por despesa. Portanto
    cada ``iddespesa`` deve ser processado uma unica vez. Quando solicitado,
    processa apenas os codigos que ainda nao possuem qualquer registro no
    arquivo de resultado anterior.
    """
    from va_core import input as inp
    from va_core.capture import find_window
    from va_core import session

    arquivo = Path(__file__).resolve().parent / "data" / "lote-fcpfl020-painel.json"
    lote = json.loads(arquivo.read_text(encoding="utf-8"))
    resultado = Path(__file__).resolve().parent / "data" / "resultado-lote-fcpfm043.json"
    feitos = json.loads(resultado.read_text(encoding="utf-8")) if resultado.exists() else []
    ids_com_registro = {item["iddespesa"] for item in feitos}
    encerrados = {
        item["iddespesa"]
        for item in feitos
        if item.get("status") in {"CONFIRMADO", "SEM_RESULTADO"}
    }
    ids_excluidos = ids_com_registro if somente_sem_registro else encerrados

    # O lote contem uma linha por MP: conservar somente a primeira ocorrencia
    # de cada despesa evita o erro "despesa ja cadastrada" em repeticoes.
    unicos: list[dict] = []
    vistos: set[int] = set()
    for item in lote:
        iddespesa = item["iddespesa"]
        if iddespesa in vistos or iddespesa in ids_excluidos:
            continue
        vistos.add(iddespesa)
        unicos.append(item)
    lote = unicos
    if limite is not None:
        lote = lote[:limite]

    hwnd = find_window(session.TITLE)
    if hwnd is None:
        raise RuntimeError("janela do TOTVS Moda nao encontrada")

    for indice, item in enumerate(lote, start=1):
        descricao = str(item["descricao"])
        print(f"[{indice}/{len(lote)}] {item['iddespesa']} - {descricao}", flush=True)

        # O pai muda de linha ao expandir os filhos; localiza-o antes de abrir.
        _selecionar_pcp_506(hwnd)
        inp.click(hwnd, 195, 653)
        time.sleep(1.5)
        popup_x, popup_y = _posicao_fcpfl020(hwnd)
        inp.set_field(hwnd, popup_x + 102, popup_y + 92, descricao)
        time.sleep(2.0)
        inp.key(hwnd, "f4")
        time.sleep(2.0)

        if _alerta_totvs_aberto(hwnd):
            inp.click(hwnd, 1078, 332)
            time.sleep(1.0)
            inp.click(hwnd, popup_x + 500, popup_y + 471)
            time.sleep(1.0)
            feitos.append({**item, "status": "SEM_RESULTADO"})
        else:
            inp.click(hwnd, popup_x + 527, popup_y + 334)
            time.sleep(0.8)
            inp.click(hwnd, popup_x + 373, popup_y + 471)
            time.sleep(2.0)
            if _alerta_totvs_aberto(hwnd):
                inp.click(hwnd, 1078, 332)
                time.sleep(1.0)
                feitos.append({**item, "status": "CONFIRMADO"})
            else:
                feitos.append({**item, "status": "SEM_CONFIRMACAO"})

        resultado.write_text(json.dumps(feitos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"lote finalizado: {len(feitos)} item(ns); resultado em {resultado}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="totvs-agent")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("status", help="Mostra o estado atual da sessao TOTVS.")
    sub.add_parser(
        "garantir-sessao",
        help="Testa o caminho auxiliar de abertura/login sem abrir componente.",
    )
    sub.add_parser(
        "abrir-sistema",
        help="Abre/loga o TOTVS e deixa no ponto de digitar componente.",
    )

    fluxo = sub.add_parser(
        "abrir-fluxo",
        help="Abre/loga o TOTVS, aguarda estabilizacao e abre o componente.",
    )
    fluxo.add_argument("codigo", help="Codigo do componente, ex.: FCPFM043.")

    abrir = sub.add_parser("abrir", help="Abre um componente pelo codigo.")
    abrir.add_argument("codigo", help="Codigo do componente, ex.: PRDFL035.")

    tecla = sub.add_parser("tecla", help="Envia uma tecla/combo para a janela TOTVS.")
    tecla.add_argument("combo", help="Ex.: tab, enter, f5, shift+tab.")

    sub.add_parser("ver-tela", help="Captura a tela atual do TOTVS.")
    sub.add_parser("listar-controles", help="Lista controles Win32 visiveis da janela TOTVS.")

    clicar = sub.add_parser("clicar", help="Clica em coordenadas da ultima captura.")
    clicar.add_argument("x", type=int)
    clicar.add_argument("y", type=int)

    duplo_clicar = sub.add_parser("duplo-clicar", help="Dá duplo clique em coordenadas da ultima captura.")
    duplo_clicar.add_argument("x", type=int)
    duplo_clicar.add_argument("y", type=int)

    preencher = sub.add_parser("preencher", help="Clica, limpa e digita texto.")
    preencher.add_argument("x", type=int)
    preencher.add_argument("y", type=int)
    preencher.add_argument("texto")

    rolar = sub.add_parser("rolar", help="Rola uma area da janela TOTVS.")
    rolar.add_argument("x", type=int)
    rolar.add_argument("y", type=int)
    rolar.add_argument("quantidade", type=int)

    criar = sub.add_parser("criar-despesas-fcpfm003", help="Cria pendencias de despesa no FCPFM003.")
    criar.add_argument("--start-code", type=int, required=True)
    criar.add_argument("--skip", type=int, default=0)
    criar.add_argument("--limit", type=int, default=len(PENDENCIAS_DESPESA_FCPFM003))

    sub.add_parser(
        "corrigir-despesas-fcpfm003",
        help="Corrige Padrao e Custo/Despesa nas linhas criadas visiveis.",
    )

    lote = sub.add_parser(
        "vincular-lote-fcpfm043",
        help="Vincula ao PCP/CC 506 as despesas exportadas do painel de orcamento.",
    )
    lote.add_argument("--limite", type=int, help="Limita a quantidade para teste controlado.")
    lote.add_argument(
        "--somente-sem-registro",
        action="store_true",
        help="Processa somente despesas sem qualquer registro no resultado anterior.",
    )

    sub.add_parser("skills", help="Lista as skills locais.")

    skill = sub.add_parser("skill", help="Mostra uma skill local.")
    skill.add_argument("nome", help="Nome da skill.")

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    orch = TotvsOrchestrator()
    registry = SkillRegistry.default()

    if args.cmd == "status":
        print(orch.status())
        return 0
    if args.cmd == "garantir-sessao":
        from va_core import session

        _janela, resultado = session.garantir_sessao()
        print(resultado)
        return 0
    if args.cmd == "abrir-sistema":
        print(orch.login_ate_campo_componente())
        return 0
    if args.cmd == "abrir-fluxo":
        print(orch.abrir_fluxo(args.codigo))
        return 0
    if args.cmd == "abrir":
        print(orch.abrir_componente(args.codigo))
        return 0
    if args.cmd == "tecla":
        from va_core import input as inp
        from va_core.capture import find_window
        from va_core import session

        hwnd = find_window(session.TITLE)
        if hwnd is None:
            raise RuntimeError("janela do TOTVS Moda nao encontrada")
        inp.key(hwnd, args.combo)
        print(f"tecla {args.combo!r} enviada")
        return 0
    if args.cmd == "ver-tela":
        from va_core import tools

        result = tools.ver_tela(nota="captura solicitada pelo CLI")
        textos = [bloco["text"] for bloco in result["content"] if bloco.get("type") == "text"]
        print("\n".join(textos))
        return 0
    if args.cmd == "listar-controles":
        import win32gui
        from va_core.capture import find_window
        from va_core import session

        hwnd = find_window(session.TITLE)
        if hwnd is None:
            raise RuntimeError("janela do TOTVS Moda nao encontrada")
        itens = []

        def coletar(filho, _):
            if win32gui.IsWindowVisible(filho):
                itens.append({
                    "classe": win32gui.GetClassName(filho),
                    "texto": win32gui.GetWindowText(filho),
                    "rect": win32gui.GetWindowRect(filho),
                })
            return True

        win32gui.EnumChildWindows(hwnd, coletar, None)
        print(json.dumps(itens, ensure_ascii=False, indent=2))
        return 0
    if args.cmd == "clicar":
        from va_core import tools

        print(tools.clicar(args.x, args.y))
        return 0
    if args.cmd == "duplo-clicar":
        from va_core import tools

        print(tools.clicar(args.x, args.y, duplo=True))
        return 0
    if args.cmd == "preencher":
        from va_core import tools

        print(tools.preencher(args.x, args.y, args.texto))
        return 0
    if args.cmd == "rolar":
        from va_core import tools

        print(tools.rolar(args.x, args.y, args.quantidade))
        return 0
    if args.cmd == "criar-despesas-fcpfm003":
        codigo = args.start_code
        pendencias = PENDENCIAS_DESPESA_FCPFM003[args.skip : args.skip + args.limit]
        for seqgrupo, cor, descricao in pendencias:
            _criar_despesa_fcpfm003(seqgrupo, cor, descricao, codigo)
            codigo += 1
        return 0
    if args.cmd == "corrigir-despesas-fcpfm003":
        _corrigir_despesas_fcpfm003_visiveis()
        return 0
    if args.cmd == "vincular-lote-fcpfm043":
        _vincular_lote_fcpfm043(args.limite, args.somente_sem_registro)
        return 0
    if args.cmd == "skills":
        for item in registry.listar():
            print(f"{item.name}: {item.summary}")
        return 0
    if args.cmd == "skill":
        print(registry.ler(args.nome))
        return 0

    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
