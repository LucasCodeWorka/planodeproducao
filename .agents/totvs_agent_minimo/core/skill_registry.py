from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path

from .paths import SKILLS


@dataclass(frozen=True)
class SkillInfo:
    name: str
    summary: str
    path: Path


class SkillRegistry:
    def __init__(self, root: Path):
        self.root = root

    @classmethod
    def default(cls) -> "SkillRegistry":
        return cls(SKILLS)

    def listar(self) -> list[SkillInfo]:
        items: list[SkillInfo] = []
        for manifest in sorted(self.root.glob("*/skill.json")):
            data = json.loads(manifest.read_text(encoding="utf-8"))
            items.append(
                SkillInfo(
                    name=data["name"],
                    summary=data.get("summary", ""),
                    path=manifest.parent / "SKILL.md",
                )
            )
        return items

    def ler(self, nome: str) -> str:
        safe_name = nome.strip().lower()
        path = self.root / safe_name / "SKILL.md"
        if not path.exists():
            existentes = ", ".join(item.name for item in self.listar())
            raise SystemExit(f"skill nao encontrada: {nome}. Existentes: {existentes}")
        return path.read_text(encoding="utf-8")

