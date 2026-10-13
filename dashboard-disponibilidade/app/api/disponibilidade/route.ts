import { NextResponse } from 'next/server';
import pg from 'pg';
import dotenv from 'dotenv';

// O carregador do Next expande "$" no .env; a senha do banco deve ser lida
// literalmente, igual ao backend atual.
dotenv.config({ override: true });

export const dynamic = 'force-dynamic';

const pool = new pg.Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
});
let cache: { data: unknown[]; expiresAt: number } | null = null;

export async function GET() {
  try {
    if (cache && cache.expiresAt > Date.now()) return NextResponse.json({ data: cache.data, cache: true });
    const { rows } = await pool.query(`
      WITH produtos AS (
        SELECT DISTINCT codigoproduto FROM public.mv_geo3
      ), classificacoes AS (
        SELECT codigoproduto,
          COALESCE(f_dic_prd_classificacao(g.codigoproduto, 'DS', 20), '') AS marca,
          COALESCE(f_dic_prd_classificacao(g.codigoproduto, 'DS', 27), '') AS status,
          COALESCE(f_dic_prd_classificacao(g.codigoproduto, 'DS', 802), '') AS continuidade,
          COALESCE(f_dic_prd_classificacao(g.codigoproduto, 'DS', 23), '') AS linha,
          COALESCE(f_dic_prd_classificacao(codigoproduto, 'DS', 24), '') AS familia
        FROM produtos g
      )
      SELECT g.codigoproduto, g.cd_nivel, g.codtamanho, g.seqtamanho, g.nomecolecao,
        g.dataproduto, g.quantidade, g.quantidadeprontaentrega, g.codcorbase,
        g.nm_produto, g.nomecor, g.ean13, c.marca, c.status, c.continuidade, c.linha, c.familia
      FROM public.mv_geo3 g JOIN classificacoes c USING (codigoproduto)
    `);
    cache = { data: rows, expiresAt: Date.now() + 1000 * 60 * 60 };
    return NextResponse.json({ data: rows, atualizadoEm: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erro ao consultar mv_geo3' }, { status: 500 });
  }
}
