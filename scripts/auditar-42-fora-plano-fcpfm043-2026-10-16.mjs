import "dotenv/config";
import fs from "node:fs";
import pg from "pg";

const conciliacao = JSON.parse(fs.readFileSync(
  ".agents/totvs_agent_minimo/data/conciliacao-fcpfm017-2026-10-15.json", "utf8"));
const itens = conciliacao.despesas.filter((item) => item.categoria === "FORA_PLANO");
if (itens.length !== 42 || itens.reduce((soma, item) => soma + item.totalCentavos, 0) !== 7545659) {
  throw new Error("Lista histórica das 42 despesas mudou");
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
try {
  const { rows } = await pool.query(`
    SELECT f.cd_despesaitem::int AS codigo, f.ds_despesaitem AS descricao,
           f.pr_rateio AS rateio, f.in_bloqueada AS bloqueada,
           array_remove(array_agg(p.nr_seqplanoctai::text ORDER BY p.nr_seqplanoctai), NULL) AS sequencias
    FROM public.vr_fcp_despesaitem f
    LEFT JOIN public.vr_fcp_planoctai p
      ON p.cd_despesaitem = f.cd_despesaitem
     AND p.cd_planoctac = 500 AND p.cd_ccusto = 506
    WHERE f.cd_despesaitem = ANY($1::integer[])
    GROUP BY f.cd_despesaitem, f.ds_despesaitem, f.pr_rateio, f.in_bloqueada
  `, [itens.map((item) => item.despesa)]);
  const porCodigo = new Map(rows.map((row) => [row.codigo, row]));
  const resultado = itens.map((item) => {
    const row = porCodigo.get(item.despesa);
    return {
      codigo: item.despesa,
      valor: (item.totalCentavos / 100).toFixed(2),
      cadastro: row && row.descricao?.trim() === item.descricao?.trim() ? "OK" : "CONFERIR",
      plano: row?.sequencias?.length === 1 ? row.sequencias[0]
        : row?.sequencias?.length ? "CONFERIR" : "FALTA",
      descricao: item.descricao,
    };
  });
  console.table(resultado);
  console.log("Resumo", {
    cadastradas: resultado.filter((row) => row.cadastro === "OK").length,
    faltamVinculo: resultado.filter((row) => row.plano === "FALTA").length,
    jaVinculadas: resultado.filter((row) => row.plano !== "FALTA" && row.plano !== "CONFERIR").length,
    multiplosVinculos: resultado.filter((row) => row.plano === "CONFERIR").length,
    valorCentavos: itens.reduce((soma, item) => soma + item.totalCentavos, 0),
  });
  if (resultado.some((row) => row.cadastro !== "OK" || row.plano === "FALTA" || row.plano === "CONFERIR")) process.exitCode = 1;
} finally {
  await pool.end();
}
