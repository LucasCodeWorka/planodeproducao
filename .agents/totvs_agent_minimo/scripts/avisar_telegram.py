"""Manda aviso (texto e, se houver, print) para o Telegram do usuário pelo bot do Cheese.

Token e destino no .env da raiz do projeto (TELEGRAM_AVISO_TOKEN, TELEGRAM_AVISO_CHATS),
copiados do Cheese em 25/11/2026. O .env é ignorado pelo git; nada é impresso em log.
Uso:
    python avisar_telegram.py "mensagem" [caminho/do/print.png]
"""
from __future__ import annotations

import json
import sys
import urllib.request
import uuid
from pathlib import Path

ENV = Path(__file__).resolve().parents[3] / ".env"


def _env(chave: str) -> str:
    for linha in ENV.read_text(encoding="utf-8").splitlines():
        if linha.strip().startswith(f"{chave}="):
            return linha.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError(f"{chave} ausente no .env")


def _token() -> str:
    return _env("TELEGRAM_AVISO_TOKEN")


def _chats() -> list[int]:
    return [int(c) for c in _env("TELEGRAM_AVISO_CHATS").split(",") if c.strip()]


def _post(metodo: str, corpo: bytes, tipo: str) -> dict:
    req = urllib.request.Request(f"https://api.telegram.org/bot{_token()}/{metodo}", data=corpo,
                                 headers={"Content-Type": tipo})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def avisar(texto: str, foto: str | None = None) -> None:
    for chat in _chats():
        if foto and Path(foto).exists():
            fronteira = uuid.uuid4().hex
            partes = []
            for nome, valor in (("chat_id", str(chat)), ("caption", texto[:1000])):
                partes.append(f"--{fronteira}\r\nContent-Disposition: form-data; name=\"{nome}\"\r\n\r\n{valor}\r\n".encode("utf-8"))
            partes.append(f"--{fronteira}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"print.png\"\r\nContent-Type: image/png\r\n\r\n".encode("utf-8"))
            partes.append(Path(foto).read_bytes())
            partes.append(f"\r\n--{fronteira}--\r\n".encode("utf-8"))
            _post("sendPhoto", b"".join(partes), f"multipart/form-data; boundary={fronteira}")
            if len(texto) > 1000:
                _post("sendMessage", json.dumps({"chat_id": chat, "text": texto[:4000]}).encode(), "application/json")
        else:
            _post("sendMessage", json.dumps({"chat_id": chat, "text": texto[:4000]}).encode(), "application/json")


if __name__ == "__main__":
    avisar(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
