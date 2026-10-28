import "dotenv/config";
import pg from "pg";

// Codigos conferidos na tela do FCPFM003 apos gravacao em 16/10/2026.
const itens = [
  ["615", "2379", 1462, "ABOTOADOR 60MM X 03 REGULAGEM - 8758483 MAUVE U"],
  ["805", "1901", 1463, "BJ 213.385 EXT CONFORT TAM 50 AMEIXA U"],
  ["14378", "1902", 1464, "ELAST JERI 11MM MILKSHAKE U"],
  ["14378", "300", 1465, "ELAST JERI 11MM PRETO U"],
  ["12843", "300", 1466, "ELASTICO CERRUTI 11MM PRETO U"],
  ["13951", "300", 1467, "RENDA JL312214 PRETO U"],
  ["3329", "300", 1468, "ELAST MANACA BRILHOSO 17MM PRETO U"],
  ["10979", "1847", 1469, "AVIAMENTO LINHA MISTA 2.500 METROS (CA02) CONHAQUE U"],
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

const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const [seqgrupo, cor, iddespesa, descMp] of itens) {
    const { rows } = await client.query(`
      INSERT INTO public.app_mp_despesa
        (seqgrupo, cor, iddespesa, desc_mp, data_atualizacao, status, erro)
      VALUES ($1, $2, $3, $4, NOW(), 'OK',
        'Criado no FCPFM003 em 16/10/2026; validar espelho vr_fcp_despesaitem apos sincronizacao')
      ON CONFLICT (seqgrupo, cor) DO UPDATE
      SET iddespesa = EXCLUDED.iddespesa,
          desc_mp = EXCLUDED.desc_mp,
          data_atualizacao = NOW(),
          status = 'OK',
          erro = EXCLUDED.erro
      WHERE public.app_mp_despesa.iddespesa IS NULL
         OR public.app_mp_despesa.iddespesa = EXCLUDED.iddespesa
      RETURNING seqgrupo, cor, iddespesa, desc_mp, status
    `, [seqgrupo, cor, iddespesa, descMp]);
    if (rows.length !== 1) {
      throw new Error(`Mapeamento conflitante para ${seqgrupo}/${cor}`);
    }
    console.log(rows[0]);
  }
  await client.query("COMMIT");
  console.log("Ponte local atualizada: 8/8.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
