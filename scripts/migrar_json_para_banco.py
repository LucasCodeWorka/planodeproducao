#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para migrar dados existentes de projecoes.json para PostgreSQL.

Uso:
    python migrar_json_para_banco.py
    python migrar_json_para_banco.py --dry-run
    python migrar_json_para_banco.py --ano 2026

Este script lê o arquivo data/projecoes.json e insere todos os dados no banco.
"""

import os
import sys
import json
import argparse
from datetime import datetime
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

# Carregar variáveis de ambiente do .env
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)


def conectar_banco():
    """Conecta ao PostgreSQL usando variáveis de ambiente."""
    return psycopg2.connect(
        host=os.getenv('DB_HOST', 'localhost'),
        port=os.getenv('DB_PORT', '5432'),
        database=os.getenv('DB_NAME', 'liebe'),
        user=os.getenv('DB_USER', 'postgres'),
        password=os.getenv('DB_PASSWORD', ''),
    )


def criar_tabelas(conn):
    """Cria as tabelas se não existirem."""
    sql_path = Path(__file__).parent.parent / 'src' / 'migrations' / '001_criar_tabela_projecoes.sql'

    if sql_path.exists():
        with open(sql_path, 'r', encoding='utf-8') as f:
            sql = f.read()

        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
        print("[OK] Tabelas criadas/verificadas com sucesso")
    else:
        print(f"[AVISO] Arquivo de migração não encontrado: {sql_path}")


def ler_projecoes_json():
    """Lê o arquivo projecoes.json."""
    json_path = Path(__file__).parent.parent / 'data' / 'projecoes.json'

    if not json_path.exists():
        print(f"[ERRO] Arquivo não encontrado: {json_path}")
        sys.exit(1)

    with open(json_path, 'r', encoding='utf-8') as f:
        dados = json.load(f)

    return dados


def converter_para_registros(dados, ano_padrao):
    """Converte dados do JSON para lista de registros."""
    registros = []

    # Estrutura: { "data": { "idproduto": { "mes": qtd, ... }, ... } }
    data = dados.get('data', dados)

    for idproduto, meses in data.items():
        if not isinstance(meses, dict):
            continue

        for mes_str, quantidade in meses.items():
            try:
                mes = int(mes_str)
                if not (1 <= mes <= 12):
                    continue

                qtd = int(float(quantidade))
                if qtd < 0:
                    continue

                registros.append({
                    'idproduto': str(idproduto),
                    'mes': mes,
                    'ano': ano_padrao,
                    'quantidade': qtd,
                })
            except (ValueError, TypeError):
                continue

    return registros


def inserir_registros(conn, registros, origem='MIGRACAO'):
    """Insere/atualiza registros no banco usando UPSERT."""
    if not registros:
        return 0

    sql = """
        INSERT INTO app_projecoes (idproduto, mes, ano, quantidade, origem)
        VALUES %s
        ON CONFLICT (idproduto, mes, ano)
        DO UPDATE SET
            quantidade = EXCLUDED.quantidade,
            updated_at = CURRENT_TIMESTAMP,
            origem = EXCLUDED.origem
    """

    valores = [
        (r['idproduto'], r['mes'], r['ano'], r['quantidade'], origem)
        for r in registros
    ]

    with conn.cursor() as cur:
        execute_values(cur, sql, valores)

    conn.commit()
    return len(valores)


def main():
    parser = argparse.ArgumentParser(description='Migrar projecoes.json para PostgreSQL')
    parser.add_argument('--ano', type=int, default=2026, help='Ano das projeções (padrão: 2026)')
    parser.add_argument('--dry-run', action='store_true', help='Simular sem inserir no banco')
    parser.add_argument('--criar-tabelas', action='store_true', default=True,
                        help='Criar tabelas antes de migrar (padrão: True)')

    args = parser.parse_args()

    print(f"\n{'='*60}")
    print("MIGRAÇÃO DE PROJECOES.JSON PARA POSTGRESQL")
    print(f"{'='*60}")
    print(f"Ano: {args.ano}")
    print(f"Modo: {'DRY-RUN (simulação)' if args.dry_run else 'PRODUÇÃO'}")
    print(f"{'='*60}\n")

    # Ler arquivo JSON
    print("[1/4] Lendo projecoes.json...")
    dados = ler_projecoes_json()

    timestamp = dados.get('timestamp')
    if timestamp:
        data_arquivo = datetime.fromtimestamp(timestamp / 1000)
        print(f"      Timestamp do arquivo: {data_arquivo}")

    # Converter para registros
    print("[2/4] Convertendo dados...")
    registros = converter_para_registros(dados, args.ano)
    print(f"      Registros encontrados: {len(registros)}")

    # Estatísticas
    produtos_unicos = len(set(r['idproduto'] for r in registros))
    meses_unicos = sorted(set(r['mes'] for r in registros))
    print(f"      Produtos únicos: {produtos_unicos}")
    print(f"      Meses: {meses_unicos}")

    if args.dry_run:
        print("\n[DRY-RUN] Simulação concluída. Nenhum dado foi inserido.")
        print(f"\nPrimeiros 10 registros:")
        for r in registros[:10]:
            print(f"  - Produto {r['idproduto']}: mês {r['mes']}/{r['ano']} = {r['quantidade']}")
        return

    # Conectar ao banco
    print("[3/4] Conectando ao PostgreSQL...")
    try:
        conn = conectar_banco()
        print("      Conectado com sucesso!")

        if args.criar_tabelas:
            criar_tabelas(conn)
    except Exception as e:
        print(f"[ERRO] Falha ao conectar: {e}")
        sys.exit(1)

    # Inserir registros
    print("[4/4] Inserindo registros no banco...")
    try:
        inseridos = inserir_registros(conn, registros, origem='MIGRACAO')
        print(f"      Registros inseridos/atualizados: {inseridos}")
    except Exception as e:
        print(f"[ERRO] Falha ao inserir: {e}")
        conn.rollback()
        sys.exit(1)

    # Verificar no banco
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM app_projecoes WHERE ano = %s", (args.ano,))
        total_no_banco = cur.fetchone()[0]
        print(f"\n      Total de registros no banco para {args.ano}: {total_no_banco}")

    conn.close()

    print(f"\n{'='*60}")
    print("MIGRAÇÃO CONCLUÍDA COM SUCESSO!")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
