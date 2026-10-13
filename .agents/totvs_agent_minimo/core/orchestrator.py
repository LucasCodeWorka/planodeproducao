from __future__ import annotations

from .va_bridge import VaBridge


class TotvsOrchestrator:
    """Orquestra apenas o fluxo deterministico validado."""

    def __init__(self, bridge: VaBridge | None = None):
        self.bridge = bridge or VaBridge()

    def status(self) -> str:
        return self.bridge.status()

    def abrir_componente(self, codigo: str) -> str:
        passos = [
            "pressuposto: sistema ja aberto e cursor no campo de componente",
            self.bridge.abrir_componente(codigo),
            self.bridge.ver_tela_texto(f"Componente solicitado: {codigo}"),
        ]
        return "\n".join(passos)

    def login_ate_campo_componente(self) -> str:
        return self.bridge.login_ate_campo_componente()

    def abrir_fluxo(self, codigo: str) -> str:
        """Garante a sessao e abre o componente pela busca do menu."""
        return self.bridge.abrir_fluxo(codigo)
