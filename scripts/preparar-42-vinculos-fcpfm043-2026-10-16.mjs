import "dotenv/config";
import fs from "node:fs";
import pg from "pg";

const origem = ".agents/totvs_agent_minimo/data/conciliacao-fcpfm017-2026-10-15.json";
const destino = ".agents/totvs_agent_minimo/data/lote-42-fcpfm043-2026-10-16.json";
const conciliacao = JSON.parse(fs.readFileSync(origem, "utf8"));
const candidatas = conciliacao.despesas.filter((item) => item.categoria === "FORA_PLANO");
if (candidatas.length !== 42 ||
    candidatas.reduce((total, item) => total + item.totalCentavos, 0) !== 7545659) {
  throw new Error("Conciliação histórica das 42 despesas mudou");
}

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD || "").replace(/^"|"$/g, ""),
  ssl: String(process.env.DB_SSL || "").toLowerCase() === "true"
    ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "").toLowerCase() === "true" }
    : undefined,
});

function filtroUnico(descricao, universo) {
  const texto = descricao.trim().toUpperCase();
  let melhor = null;
  for (const [minimo, maximo] of [[12, 40], [8, 11]]) {
    for (let tamanho = Math.min(minimo, texto.length); tamanho <= Math.min(maximo, texto.length); tamanho++) {
      for (let inicio = texto.length - tamanho; inicio >= 0; inicio--) {
        const trecho = texto.slice(inicio, inicio + tamanho).trim();
        // A digitação virtual do TOTVS pode converter pontuação ("/" virou "@").
        // Usar somente letras, números e espaços no filtro descritivo.
        if (trecho.length < 8 || /[^A-Z0-9 ]/.test(trecho)) continue;
        const achados = universo.filter((item) => item.includes(trecho));
        if (achados.length === 1) return { texto: trecho, resultados: 1 };
        if (achados.length && (!melhor || achados.length < melhor.resultados)) {
          melhor = { texto: trecho, resultados: achados.length };
        }
      }
    }
  }
  if (melhor && melhor.resultados <= 15) return melhor;
  throw new Error(`Nenhum filtro utilizável: ${descricao}; melhor=${JSON.stringify(melhor)}`);
}

try {
  const { rows: todas } = await pool.query(`
    SELECT cd_despesaitem::int AS codigo, ds_despesaitem AS descricao
    FROM public.vr_fcp_despesaitem
  `);
  const { rows: plano } = await pool.query(`
    SELECT cd_despesaitem::int AS codigo
    FROM public.vr_fcp_planoctai
    WHERE cd_planoctac = 500 AND cd_ccusto = 506 AND cd_despesaitem IS NOT NULL
  `);
  const porCodigo = new Map(todas.map((item) => [item.codigo, item.descricao.trim()]));
  const universo = todas.map((item) => item.descricao.trim().toUpperCase());
  const jaNoPlano = new Set(plano.map((item) => item.codigo));
  // 11681 foi vinculado e visto na árvore às 09:37, antes da sincronização.
  jaNoPlano.add(11681);

  const itens = candidatas.filter((item) => !jaNoPlano.has(item.despesa)).map((item) => {
    const descricao = porCodigo.get(item.despesa);
    if (!descricao || descricao !== item.descricao.trim()) {
      throw new Error(`Descrição divergente na despesa ${item.despesa}`);
    }
    return {
      codigo: item.despesa,
      descricao,
      filtro: filtroUnico(descricao, universo),
      totalCentavos: item.totalCentavos,
      mps: item.mps,
    };
  });
  if (itens.length !== 41) throw new Error(`Esperadas 41 pendentes após piloto; vieram ${itens.length}`);
  fs.writeFileSync(destino, JSON.stringify({
    fonte: origem,
    plano: 500,
    centroCusto: 506,
    pai: 26081,
    pilotoVinculado: 11681,
    despesas: itens.length,
    valorCentavos: itens.reduce((soma, item) => soma + item.totalCentavos, 0),
    itens,
  }, null, 2) + "\n", "utf8");
  console.table(itens.map((item) => ({ codigo: item.codigo, filtro: item.filtro.texto, resultados: item.filtro.resultados,
    valor: (item.totalCentavos / 100).toFixed(2) })));
  console.log({ destino, despesas: itens.length,
    valorCentavos: itens.reduce((soma, item) => soma + item.totalCentavos, 0) });
} finally {
  await pool.end();
}
