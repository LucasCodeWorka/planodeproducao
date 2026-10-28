"""Ponte pequena para o nucleo local validado do TOTVS.

Esta camada existe para que projetos novos dependam de uma interface estavel.
"""
from __future__ import annotations

import time
from va_core import input as inp
from va_core import session
from va_core import tools
from va_core.capture import find_window


class VaBridge:
    def status(self) -> str:
        hwnd = find_window(session.TITLE)
        if hwnd is None:
            return "sem_janela: TOTVS Moda nao esta aberto"
        estado, detalhe = session.estado_tela(hwnd)
        return f"{estado}: {detalhe}"

    def abrir_componente(self, codigo: str) -> str:
        hwnd = find_window(session.TITLE)
        if hwnd is None:
            raise RuntimeError("janela do TOTVS Moda nao encontrada")

        estado, detalhe = session.estado_tela(hwnd)
        if estado != "logado":
            raise RuntimeError(
                "estado da tela nao confirmado como logado antes de abrir "
                f"componente (estado={estado}; {detalhe}); rode abrir-sistema "
                "e confirme antes de tentar novamente"
            )

        inp.type_text(hwnd, codigo.upper(), delay=0.15)
        time.sleep(0.5)
        inp.key(hwnd, "tab")
        time.sleep(6.0)
        return f"componente {codigo.upper()} digitado; Tab enviado"

    def abrir_fluxo(self, codigo: str) -> str:
        """Garante login confirmado e abre o componente pelo fluxo validado."""
        hwnd = find_window(session.TITLE)
        if hwnd is None or session.estado_tela(hwnd)[0] != "logado":
            sessao = self.login_ate_campo_componente()
        else:
            inp.clear_field(hwnd, *session.CAMPO_BUSCA)
            sessao = "sessao ja aberta e logada; campo de componente limpo"
        resultado = self.abrir_componente(codigo.upper())
        return f"{sessao}; {resultado}"

    def login_ate_campo_componente(self) -> str:
        """Fluxo deterministico informado pelo usuario.

        Sequencia:
        abrir janela, esperar 7s, usuario, Tab, senha, Enter, empresa,
        Enter, Enter, 6x Tab.
        """
        import win32gui

        hwnd = find_window(session.TITLE)
        passos: list[str] = []
        if hwnd is None:
            hwnd = session.lancar()
            passos.append("janela aberta")
        else:
            passos.append("janela ja estava aberta")

        estado, detalhe = session.esperar_estado_estavel(hwnd, timeout=20)
        if estado == "logado":
            inp.click(hwnd, *session.CAMPO_BUSCA)
            return "; ".join(passos + [
                f"estado confirmado: logado ({detalhe})",
                "campo de componente focado",
            ])

        usuario = session.APP_USER
        senha = session.APP_PASS
        empresa = session.EMPRESA or "1"
        if not usuario or not senha:
            raise RuntimeError("VA_APP_USER/VA_APP_PASS nao encontrados no .env")

        time.sleep(14)
        if not win32gui.IsWindow(hwnd):
            hwnd = find_window(session.TITLE)
            if hwnd is None:
                raise RuntimeError("janela do TOTVS Moda sumiu antes do login")
        estado, detalhe = session.estado_tela(hwnd)
        if estado != "login_usuario":
            raise RuntimeError(
                f"esperava tela de usuario antes do login; estado={estado} ({detalhe})"
            )
        # O painel de login mantem o campo em x=133..570/y=330..375 mesmo
        # quando a janela muda de 1382x752 para 768x525. Sem este clique,
        # o teclado pode ficar fora do campo e o login segue vazio.
        inp.clear_field(hwnd, 350, 345)
        inp.type_text(hwnd, usuario)
        inp.key(hwnd, "tab")
        inp.type_text(hwnd, senha)
        inp.key(hwnd, "enter")
        estado, detalhe = session._esperar_estado(hwnd, ("login_empresa",), timeout=45)
        if estado != "login_empresa":
            raise RuntimeError(
                f"tela de empresa nao apareceu apos o login; estado={estado} ({detalhe})"
            )
        if not win32gui.IsWindow(hwnd):
            hwnd = find_window(session.TITLE)
            if hwnd is None:
                raise RuntimeError("janela do TOTVS Moda sumiu apos credenciais")
        inp.type_text(hwnd, empresa)
        inp.key(hwnd, "enter")
        estado, detalhe = session._esperar_estado(hwnd, ("login_produto",), timeout=45)
        if estado != "login_produto":
            raise RuntimeError(
                f"tela de produto nao apareceu apos a empresa; estado={estado} ({detalhe})"
            )
        if not win32gui.IsWindow(hwnd):
            hwnd = find_window(session.TITLE)
            if hwnd is None:
                raise RuntimeError("janela do TOTVS Moda sumiu apos empresa")
        if str(session.PRODUTO) != "1":
            raise RuntimeError(
                f"selecao automatica do produto {session.PRODUTO} nao validada"
            )
        inp.key(hwnd, "enter")
        estado, detalhe = session._esperar_estado(hwnd, ("logado",), timeout=60)
        if estado != "logado":
            raise RuntimeError(
                f"tela inicial nao apareceu apos o produto; estado={estado} ({detalhe})"
            )
        time.sleep(16.0)
        for _ in range(6):
            if not win32gui.IsWindow(hwnd):
                hwnd = find_window(session.TITLE)
                if hwnd is None:
                    raise RuntimeError("janela do TOTVS Moda sumiu antes dos tabs")
            inp.key(hwnd, "tab")
            time.sleep(0.12)

        passos.append("login por teclado executado")
        passos.append("6 tabs enviados")

        if not win32gui.IsWindow(hwnd):
            hwnd = find_window(session.TITLE)
            if hwnd is None:
                raise RuntimeError("janela do TOTVS Moda sumiu apos os tabs")
        estado, detalhe = session.esperar_estado_estavel(hwnd, timeout=20)
        if estado != "logado":
            raise RuntimeError(
                "; ".join(passos)
                + f" -> estado nao confirmado como logado (estado={estado}; "
                f"{detalhe}); pare e verifique a tela manualmente"
            )
        inp.click(hwnd, *session.CAMPO_BUSCA)
        passos.append(f"estado confirmado: logado ({detalhe})")
        passos.append("campo de componente focado")
        return "; ".join(passos)

    def ver_tela_texto(self, nota: str = "") -> str:
        result = tools.ver_tela(nota=nota)
        textos = [
            bloco["text"]
            for bloco in result["content"]
            if bloco.get("type") == "text"
        ]
        return "\n".join(textos)
