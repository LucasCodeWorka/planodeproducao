import "dotenv/config";
import pg from "pg";

const esperado = [
  ["615", "2379", 1462, "ABOTOADOR 60MM X 03 REGULAGEM - 8758483 MAUVE U", "26702"],
  ["805", "1901", 1463, "BJ 213.385 EXT CONFORT TAM 50 AMEIXA U", "26704"],
  ["14378", "1902", 1464, "ELAST JERI 11MM MILKSHAKE U", "26706"],
  ["14378", "300", 1465, "ELAST JERI 11MM PRETO U", "26708"],
  ["12843", "300", 1466, "ELASTICO CERRUTI 11MM PRETO U", "26710"],
  ["13951", "300", 1467, "RENDA JL312214 PRETO U", "26712"],
  ["3329", "300", 1468, "ELAST MANACA BRILHOSO 17MM PRETO U", "26714"],
  ["10979", "1847", 1469, "LINHA MISTA 2.500 METROS (CA02) CONHAQUE U", "26716"],
];

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
    SELECT a.seqgrupo, a.cor, a.iddespesa, a.desc_mp, a.status,
           f.ds_despesaitem, f.ds_original, f.pr_rateio,
           f.tp_custodespesa, f.tp_fixovariavel, f.tp_diretoindireto,
           f.tp_ccusto, f.in_padrao, f.in_bloqueada,
           p.sequencias
    FROM public.app_mp_despesa a
    LEFT JOIN public.vr_fcp_despesaitem f
      ON f.cd_despesaitem = a.iddespesa
    LEFT JOIN LATERAL (
      SELECT array_agg(nr_seqplanoctai::text ORDER BY nr_seqplanoctai) AS sequencias
      FROM public.vr_fcp_planoctai
      WHERE cd_planoctac = 500 AND cd_ccusto = 506
        AND cd_despesaitem = a.iddespesa
    ) p ON true
    WHERE a.iddespesa = ANY($1::integer[])
    ORDER BY a.iddespesa
  `, [esperado.map((item) => item[2])]);
  const porCodigo = new Map(rows.map((row) => [row.iddespesa, row]));
  const resultado = esperado.map(([grupo, cor, codigo, descricao, sequencia]) => {
    const row = porCodigo.get(codigo);
    const sincronizado = Boolean(row?.ds_despesaitem);
    const camposOk = sincronizado &&
      row.ds_despesaitem.trim() === descricao &&
      Number(row.pr_rateio) === 100 &&
      row.in_padrao === "T" &&
      String(row.tp_custodespesa) === "2" &&
      String(row.tp_fixovariavel) === "1" &&
      String(row.tp_diretoindireto) === "3" &&
      String(row.tp_ccusto) === "1" &&
      row.in_bloqueada !== "T";
    return {
      grupo,
      cor,
      codigo,
      ponte: row && row.seqgrupo === grupo && row.cor === cor && row.status === "OK" ? "OK" : "FALHA",
      espelho: sincronizado ? (camposOk ? "OK" : "CONFERIR") : "AGUARDANDO",
      plano: row?.sequencias?.length ?
        (row.sequencias.length === 1 && row.sequencias[0] === sequencia ? "OK" : "CONFERIR") : "AGUARDANDO",
      descricao: row?.ds_despesaitem || null,
      rateio: row?.pr_rateio ?? null,
      padrao: row?.in_padrao ?? null,
      tipo: row?.tp_custodespesa ?? null,
    };
  });
  console.table(resultado);
  if (resultado.some((item) => item.ponte !== "OK" || item.espelho === "CONFERIR" || item.plano === "CONFERIR")) process.exitCode = 1;
} finally {
  await pool.end();
}
