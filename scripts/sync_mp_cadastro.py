#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sincronizador incremental de app_mp_cadastro.

Regras:
- Calcula a necessidade atual a partir do cache do orcamento-mp.
- Insere em app_mp_cadastro apenas seqgrupo+cor novos.
- Nao altera linhas ja existentes em app_mp_cadastro.
- Se uma linha existente mudar necessidade/valor, registra em
  app_mp_cadastro_alteracoes para tratamento posterior.

Uso:
    python scripts/sync_mp_cadastro.py
    python scripts/sync_mp_cadastro.py --loop --interval 300
    python scripts/sync_mp_cadastro.py --dry-run
"""

import argparse
import os
import sys
import time
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


class Tee:
    def __init__(self, *streams):
        self.streams = streams

    def write(self, data):
        for stream in self.streams:
            stream.write(data)
            stream.flush()

    def flush(self):
        for stream in self.streams:
            stream.flush()


def setup_file_log():
    log_dir = ROOT / "logs"
    log_dir.mkdir(exist_ok=True)
    log_file = open(log_dir / "sync_mp_cadastro.log", "a", encoding="utf-8", buffering=1)
    sys.stdout = Tee(sys.stdout, log_file)
    sys.stderr = Tee(sys.stderr, log_file)


def dec(value, places="0.0001"):
    return Decimal(str(value or 0)).quantize(Decimal(places), rounding=ROUND_HALF_UP)


def money_dec(value):
    return dec(value, "0.01")


def connect_db():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=os.getenv("DB_PORT", "5432"),
        database=os.getenv("DB_NAME", "liebe"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", ""),
        sslmode="require" if os.getenv("DB_SSL") == "true" else "prefer",
    )


def ensure_tables(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS public.app_mp_cadastro (
              seqgrupo TEXT NOT NULL,
              cor TEXT NOT NULL,
              descricao TEXT,
              necessidade_total NUMERIC(14, 4) NOT NULL DEFAULT 0,
              valor_necessidade_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              PRIMARY KEY (seqgrupo, cor)
            )
            """
        )
        cur.execute(
            """
            ALTER TABLE public.app_mp_cadastro
              ADD COLUMN IF NOT EXISTS necessidade_total NUMERIC(14, 4) NOT NULL DEFAULT 0,
              ADD COLUMN IF NOT EXISTS valor_necessidade_total NUMERIC(14, 2) NOT NULL DEFAULT 0
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS public.app_mp_cadastro_alteracoes (
              id BIGSERIAL PRIMARY KEY,
              seqgrupo TEXT NOT NULL,
              cor TEXT NOT NULL,
              descricao TEXT,
              necessidade_total_original NUMERIC(14, 4) NOT NULL DEFAULT 0,
              valor_necessidade_total_original NUMERIC(14, 2) NOT NULL DEFAULT 0,
              necessidade_total_atual NUMERIC(14, 4) NOT NULL DEFAULT 0,
              valor_necessidade_total_atual NUMERIC(14, 2) NOT NULL DEFAULT 0,
              cadastro_updated_at TIMESTAMPTZ,
              detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              status TEXT NOT NULL DEFAULT 'PENDENTE',
              observacao TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS ux_app_mp_cadastro_alt_pendente
            ON public.app_mp_cadastro_alteracoes (
              seqgrupo,
              cor,
              necessidade_total_atual,
              valor_necessidade_total_atual
            )
            WHERE status = 'PENDENTE'
            """
        )
    conn.commit()


def ultima_compra(row):
    compras = row.get("finalizados_detalhe") or []
    validas = [
        item for item in compras
        if float(item.get("quantidade") or 0) > 0 and float(item.get("valor") or 0) > 0
    ]
    validas.sort(key=lambda item: str(item.get("data") or ""), reverse=True)
    if not validas:
        return Decimal("0")
    item = validas[0]
    return Decimal(str(item.get("valor") or 0)) / Decimal(str(item.get("quantidade") or 1))


def valor_unitario(row, price_options_by_mp):
    fator = Decimal(str(row.get("fator_conversao") or 1))
    ultima = ultima_compra(row)
    if ultima > 0:
        return ultima / fator if fator > 1 else ultima
    options = price_options_by_mp.get(str(row.get("idmateriaprima") or "").strip()) or []
    preco = Decimal(str((options[0] or {}).get("value") or 0)) if options else Decimal("0")
    if preco > 0:
        return preco / fator if fator > 1 else preco
    return Decimal("0")


def necessidade_total(row):
    consumo = sum(Decimal(str(row.get(f"consumo_{p}") or 0)) for p in ("ma", "px", "ul", "qt", "qu"))
    estoque = Decimal(str(row.get("estoquetotal") or 0))
    compras = Decimal(str(row.get("entrada_andamento") or 0))
    necessidade = consumo - estoque - compras
    return necessidade if necessidade > 0 else Decimal("0")


def load_current_items(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT payload
            FROM public.app_orcamento_mp_cache
            WHERE cache_key = 'orcamento_mp_liebe'
            LIMIT 1
            """
        )
        row = cur.fetchone()
    if not row:
        raise RuntimeError("Cache app_orcamento_mp_cache/orcamento_mp_liebe nao encontrado")

    payload = row[0] or {}
    rows_base = payload.get("rowsBase") or []
    price_options = payload.get("priceOptionsByMp") or {}

    rows_needed = []
    for mp in rows_base:
        qtd = necessidade_total(mp)
        if qtd <= 0:
            continue
        valor = qtd * valor_unitario(mp, price_options)
        rows_needed.append((mp, qtd, valor))

    codigos = [str(mp.get("idmateriaprima") or "").strip() for mp, _, _ in rows_needed]
    codigos = [codigo for codigo in codigos if codigo]
    if not codigos:
        return {}

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              cd_produto::TEXT AS codigo,
              cd_seqgrupo::TEXT AS seqgrupo,
              TRIM(cd_cor) AS cor,
              nm_produto AS descricao
            FROM vr_prd_prdgrade
            WHERE cd_produto::TEXT = ANY(%s)
            """,
            (codigos,),
        )
        grade_rows = cur.fetchall()

    grade_by_codigo = {
        str(codigo).strip(): {
            "seqgrupo": str(seqgrupo or "").strip(),
            "cor": str(cor or "").strip(),
            "descricao": str(descricao or "").strip(),
        }
        for codigo, seqgrupo, cor, descricao in grade_rows
    }

    grouped = {}
    for mp, qtd, valor in rows_needed:
        grade = grade_by_codigo.get(str(mp.get("idmateriaprima") or "").strip())
        if not grade or not grade["seqgrupo"] or not grade["cor"]:
            continue
        key = (grade["seqgrupo"], grade["cor"])
        if key not in grouped:
            grouped[key] = {
                "seqgrupo": grade["seqgrupo"],
                "cor": grade["cor"],
                "descricao": grade["descricao"],
                "necessidade_total": Decimal("0"),
                "valor_necessidade_total": Decimal("0"),
            }
        grouped[key]["necessidade_total"] += qtd
        grouped[key]["valor_necessidade_total"] += valor

    for item in grouped.values():
        item["necessidade_total"] = dec(item["necessidade_total"])
        item["valor_necessidade_total"] = money_dec(item["valor_necessidade_total"])
    return grouped


def load_existing(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT seqgrupo, cor, descricao, necessidade_total, valor_necessidade_total, updated_at
            FROM public.app_mp_cadastro
            """
        )
        rows = cur.fetchall()
    return {
        (seqgrupo, cor): {
            "seqgrupo": seqgrupo,
            "cor": cor,
            "descricao": descricao,
            "necessidade_total": dec(necessidade_total),
            "valor_necessidade_total": money_dec(valor_necessidade_total),
            "updated_at": updated_at,
        }
        for seqgrupo, cor, descricao, necessidade_total, valor_necessidade_total, updated_at in rows
    }


def sync_once(conn, dry_run=False):
    ensure_tables(conn)
    current = load_current_items(conn)
    existing = load_existing(conn)

    new_items = [item for key, item in current.items() if key not in existing]
    changed_items = []
    for key, item in current.items():
        old = existing.get(key)
        if not old:
            continue
        if (
            item["necessidade_total"] != old["necessidade_total"]
            or item["valor_necessidade_total"] != old["valor_necessidade_total"]
        ):
            changed_items.append((old, item))

    print(f"[{datetime.now().isoformat(timespec='seconds')}] atuais={len(current)} novos={len(new_items)} alteracoes={len(changed_items)}")

    if dry_run:
        return {"current": len(current), "new": len(new_items), "changed": len(changed_items)}

    with conn.cursor() as cur:
        if new_items:
            execute_values(
                cur,
                """
                INSERT INTO public.app_mp_cadastro (
                  seqgrupo, cor, descricao, necessidade_total, valor_necessidade_total, updated_at
                ) VALUES %s
                ON CONFLICT (seqgrupo, cor) DO NOTHING
                """,
                [
                    (
                        item["seqgrupo"],
                        item["cor"],
                        item["descricao"],
                        item["necessidade_total"],
                        item["valor_necessidade_total"],
                    )
                    for item in new_items
                ],
            )

        if changed_items:
            execute_values(
                cur,
                """
                INSERT INTO public.app_mp_cadastro_alteracoes (
                  seqgrupo,
                  cor,
                  descricao,
                  necessidade_total_original,
                  valor_necessidade_total_original,
                  necessidade_total_atual,
                  valor_necessidade_total_atual,
                  cadastro_updated_at,
                  status,
                  observacao
                ) VALUES %s
                ON CONFLICT DO NOTHING
                """,
                [
                    (
                        new["seqgrupo"],
                        new["cor"],
                        new["descricao"],
                        old["necessidade_total"],
                        old["valor_necessidade_total"],
                        new["necessidade_total"],
                        new["valor_necessidade_total"],
                        old["updated_at"],
                        "PENDENTE",
                        "Mudanca registrada sem alterar app_mp_cadastro",
                    )
                    for old, new in changed_items
                ],
            )
    conn.commit()
    return {"current": len(current), "new": len(new_items), "changed": len(changed_items)}


def main():
    setup_file_log()
    parser = argparse.ArgumentParser()
    parser.add_argument("--loop", action="store_true", help="mantem rodando em loop")
    parser.add_argument("--interval", type=int, default=300, help="intervalo em segundos no modo loop")
    parser.add_argument("--dry-run", action="store_true", help="calcula sem gravar")
    args = parser.parse_args()

    while True:
      try:
          with connect_db() as conn:
              sync_once(conn, dry_run=args.dry_run)
      except KeyboardInterrupt:
          print("Encerrado pelo usuario.")
          return
      except Exception as exc:
          print(f"[ERRO] {exc}", file=sys.stderr)

      if not args.loop:
          return
      time.sleep(max(10, args.interval))


if __name__ == "__main__":
    main()
