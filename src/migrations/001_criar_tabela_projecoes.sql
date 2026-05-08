-- Migration: Criar tabelas de projeções
-- Data: 2026-05-08
-- Descrição: Migra projeções de JSON para PostgreSQL

-- Tabela principal de projeções
CREATE TABLE IF NOT EXISTS app_projecoes (
    id SERIAL PRIMARY KEY,
    idproduto TEXT NOT NULL,
    mes INTEGER NOT NULL CHECK (mes >= 1 AND mes <= 12),
    ano INTEGER NOT NULL CHECK (ano >= 2020 AND ano <= 2100),
    quantidade INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    origem TEXT DEFAULT 'IMPORT',
    UNIQUE(idproduto, mes, ano)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_projecoes_produto ON app_projecoes(idproduto);
CREATE INDEX IF NOT EXISTS idx_projecoes_periodo ON app_projecoes(ano, mes);
CREATE INDEX IF NOT EXISTS idx_projecoes_ano ON app_projecoes(ano);

-- Tabela de histórico para auditoria (opcional)
CREATE TABLE IF NOT EXISTS app_projecoes_historico (
    id SERIAL PRIMARY KEY,
    idproduto TEXT NOT NULL,
    mes INTEGER NOT NULL,
    ano INTEGER NOT NULL,
    quantidade_anterior INTEGER,
    quantidade_nova INTEGER,
    alterado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    origem TEXT,
    usuario TEXT
);

CREATE INDEX IF NOT EXISTS idx_projecoes_hist_produto ON app_projecoes_historico(idproduto);
CREATE INDEX IF NOT EXISTS idx_projecoes_hist_data ON app_projecoes_historico(alterado_em);

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_projecoes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para updated_at
DROP TRIGGER IF EXISTS trigger_projecoes_updated_at ON app_projecoes;
CREATE TRIGGER trigger_projecoes_updated_at
    BEFORE UPDATE ON app_projecoes
    FOR EACH ROW
    EXECUTE FUNCTION update_projecoes_updated_at();

-- Comentários nas tabelas
COMMENT ON TABLE app_projecoes IS 'Projeções de demanda por produto/mês/ano';
COMMENT ON COLUMN app_projecoes.idproduto IS 'ID do produto (cd_produto)';
COMMENT ON COLUMN app_projecoes.mes IS 'Mês da projeção (1-12)';
COMMENT ON COLUMN app_projecoes.ano IS 'Ano da projeção';
COMMENT ON COLUMN app_projecoes.quantidade IS 'Quantidade projetada em unidades';
COMMENT ON COLUMN app_projecoes.origem IS 'Origem do registro: IMPORT, API, PYTHON, MIGRACAO';
