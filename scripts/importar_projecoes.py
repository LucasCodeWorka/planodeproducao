#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para importar projeções em lote de arquivos CSV para PostgreSQL.

Uso:
    python importar_projecoes.py --pasta ./meus_csvs --ano 2026
    python importar_projecoes.py --pasta ./meus_csvs --ano 2026 --dry-run
    python importar_projecoes.py --arquivo projecao.csv --ano 2026

Formato CSV esperado:
    idproduto,mes,qtd
    4023,1,87
    4024,JANEIRO,130
    4025,JAN,122
"""

import os
import sys
import argparse
import glob
from datetime import datetime
from pathlib import Path

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

# Carregar variáveis de ambiente do .env
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)

# Mapeamento de nomes de mês para número
MESES_MAP = {
    # Números
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6,
    '7': 7, '8': 8, '9': 9, '10': 10, '11': 11, '12': 12,
    # Abreviações
    'JAN': 1, 'FEV': 2, 'MAR': 3, 'ABR': 4, 'MAI': 5, 'JUN': 6,
    'JUL': 7, 'AGO': 8, 'SET': 9, 'OUT': 10, 'NOV': 11, 'DEZ': 12,
    # Nomes completos
    'JANEIRO': 1, 'FEVEREIRO': 2, 'MARÇO': 3, 'MARCO': 3, 'ABRIL': 4,
    'MAIO': 5, 'JUNHO': 6, 'JULHO': 7, 'AGOSTO': 8, 'SETEMBRO': 9,
    'OUTUBRO': 10, 'NOVEMBRO': 11, 'DEZEMBRO': 12,
}


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


def parsear_mes(valor):
    """Converte valor de mês para número 1-12."""
    if pd.isna(valor):
        return None

    valor_str = str(valor).strip().upper()

    # Tentar como número direto
    try:
        num = int(float(valor_str))
        if 1 <= num <= 12:
            return num
    except ValueError:
        pass

    # Tentar como nome/abreviação
    return MESES_MAP.get(valor_str)


def ler_csv(arquivo):
    """Lê um arquivo CSV e retorna DataFrame normalizado."""
    # Tentar diferentes separadores
    for sep in [';', ',', '\t']:
        try:
            df = pd.read_csv(arquivo, sep=sep, dtype=str, encoding='utf-8')
            if len(df.columns) >= 3:
                break
        except Exception:
            continue
    else:
        # Fallback
        df = pd.read_csv(arquivo, dtype=str, encoding='utf-8')

    # Normalizar nomes de colunas
    df.columns = [col.strip().lower() for col in df.columns]

    # Mapear variações de nomes de colunas
    col_map = {
        'idprotudo': 'idproduto',
        'id_produto': 'idproduto',
        'produto': 'idproduto',
        'cd_produto': 'idproduto',
        'valor': 'qtd',
        'quantidade': 'qtd',
        'qty': 'qtd',
    }
    df.rename(columns=col_map, inplace=True)

    # Verificar colunas obrigatórias
    colunas_necessarias = ['idproduto', 'mes', 'qtd']
    for col in colunas_necessarias:
        if col not in df.columns:
            raise ValueError(f"Coluna obrigatória '{col}' não encontrada. Colunas: {list(df.columns)}")

    return df[colunas_necessarias]


def processar_csv(arquivo, ano):
    """Processa um arquivo CSV e retorna lista de registros."""
    df = ler_csv(arquivo)
    registros = []
    erros = []

    for idx, row in df.iterrows():
        linha = idx + 2  # +2 por causa do header e índice 0

        idproduto = str(row['idproduto']).strip()
        if not idproduto or idproduto.lower() == 'nan':
            erros.append(f"Linha {linha}: idproduto vazio")
            continue

        mes = parsear_mes(row['mes'])
        if mes is None:
            erros.append(f"Linha {linha}: mês inválido '{row['mes']}'")
            continue

        try:
            qtd_str = str(row['qtd']).replace(',', '.').strip()
            qtd = int(float(qtd_str))
            if qtd < 0:
                erros.append(f"Linha {linha}: quantidade negativa {qtd}")
                continue
        except (ValueError, TypeError):
            erros.append(f"Linha {linha}: quantidade inválida '{row['qtd']}'")
            continue

        registros.append({
            'idproduto': idproduto,
            'mes': mes,
            'ano': ano,
            'quantidade': qtd,
        })

    return registros, erros


def inserir_registros(conn, registros, origem='PYTHON'):
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
    parser = argparse.ArgumentParser(description='Importar projeções de CSV para PostgreSQL')
    parser.add_argument('--pasta', type=str, help='Pasta contendo arquivos CSV')
    parser.add_argument('--arquivo', type=str, help='Arquivo CSV único')
    parser.add_argument('--ano', type=int, required=True, help='Ano das projeções (ex: 2026)')
    parser.add_argument('--dry-run', action='store_true', help='Simular sem inserir no banco')
    parser.add_argument('--criar-tabelas', action='store_true', help='Criar tabelas antes de importar')

    args = parser.parse_args()

    if not args.pasta and not args.arquivo:
        parser.error("Informe --pasta ou --arquivo")

    # Coletar arquivos CSV
    arquivos = []
    if args.arquivo:
        arquivos.append(args.arquivo)
    if args.pasta:
        arquivos.extend(glob.glob(os.path.join(args.pasta, '*.csv')))
        arquivos.extend(glob.glob(os.path.join(args.pasta, '*.CSV')))

    if not arquivos:
        print("[ERRO] Nenhum arquivo CSV encontrado")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"IMPORTAÇÃO DE PROJEÇÕES - ANO {args.ano}")
    print(f"{'='*60}")
    print(f"Arquivos encontrados: {len(arquivos)}")
    print(f"Modo: {'DRY-RUN (simulação)' if args.dry_run else 'PRODUÇÃO'}")
    print(f"{'='*60}\n")

    # Conectar ao banco
    if not args.dry_run:
        try:
            conn = conectar_banco()
            print("[OK] Conectado ao PostgreSQL")

            if args.criar_tabelas:
                criar_tabelas(conn)
        except Exception as e:
            print(f"[ERRO] Falha ao conectar: {e}")
            sys.exit(1)
    else:
        conn = None

    # Processar cada arquivo
    total_registros = 0
    total_erros = 0
    total_inseridos = 0

    for arquivo in arquivos:
        nome = os.path.basename(arquivo)
        print(f"\n[PROCESSANDO] {nome}")

        try:
            registros, erros = processar_csv(arquivo, args.ano)
            total_registros += len(registros)
            total_erros += len(erros)

            print(f"  - Registros válidos: {len(registros)}")
            if erros:
                print(f"  - Erros: {len(erros)}")
                for erro in erros[:5]:  # Mostrar apenas os 5 primeiros
                    print(f"    ! {erro}")
                if len(erros) > 5:
                    print(f"    ... e mais {len(erros) - 5} erros")

            if not args.dry_run and registros:
                inseridos = inserir_registros(conn, registros, origem='PYTHON')
                total_inseridos += inseridos
                print(f"  - Inseridos/atualizados: {inseridos}")

        except Exception as e:
            print(f"  [ERRO] {e}")
            total_erros += 1

    # Resumo final
    print(f"\n{'='*60}")
    print("RESUMO DA IMPORTAÇÃO")
    print(f"{'='*60}")
    print(f"Arquivos processados: {len(arquivos)}")
    print(f"Total de registros: {total_registros}")
    print(f"Total de erros: {total_erros}")
    if not args.dry_run:
        print(f"Registros inseridos/atualizados: {total_inseridos}")
    print(f"{'='*60}\n")

    if conn:
        conn.close()


if __name__ == '__main__':
    main()
