import 'dotenv/config';
import pg from 'pg';

// Códigos lidos na tela do FCPFM003 após inclusão/gravação em 19/10/2026.
const itens = [
  [5000110, 269, '904', 1470, 'SACO PP LISO P/ PICOTE 08X11X0,06 UNICA U'],
  [5000126, 299, '904', 1471, 'PROT.CONJ  PP 36X25 0,05 IMPRESSO NORMAL UNICA U'],
  [5000127, 301, '904', 1472, 'PROT.CONJ ESP  PP 40 X 27 0,05 C/OXI UNICA U'],
  [5000138, 319, '904', 1473, 'EMB 15X18+3X0,05 PP ADS IMPRES NORMAL UNICA U'],
  [5000140, 323, '904', 1474, 'EMB  18X37+3 X 0,05 PP  ADS IMPRES NORMA UNICA U'],
  [5000141, 325, '904', 1475, 'EMB  20X40+3 X 0,05 PP  ADS IMPRE NORMAL UNICA U'],
  [5000681, 4608, '904', 1476, 'EMBALAGEN SEM IMPRESSAO 28 X 40 3 X 0,05 UNICA U'],
  [5002671, 12203, '904', 1477, 'CONSUMO PINO DE NYLON  FIX PIN 20 MM UNICA U'],
];

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
    ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true' }
    : undefined,
});

const client = await pool.connect();
try {
  await client.query('BEGIN');
  for (const [mp, grupo, cor, despesa, nome] of itens) {
    const grade = (await client.query(`
      SELECT cd_seqgrupo::int AS grupo, TRIM(cd_cor) AS cor, nm_produto AS nome
      FROM public.vr_prd_prdgrade WHERE cd_produto = $1`, [mp])).rows;
    if (grade.length !== 1 || grade[0].grupo !== grupo || grade[0].cor !== cor || grade[0].nome !== nome) {
      throw new Error(`MP ${mp}: cadastro de grupo/cor/nome divergente do espelho`);
    }
    const { rows } = await client.query(`
      INSERT INTO public.app_mp_despesa
        (seqgrupo, cor, iddespesa, desc_mp, data_atualizacao, status, erro)
      VALUES ($1, $2, $3, $4, NOW(), 'OK',
        'Criado no FCPFM003 em 19/10/2026; espelho TOTVS sujeito a sincronizacao')
      ON CONFLICT (seqgrupo, cor) DO UPDATE
      SET iddespesa = EXCLUDED.iddespesa,
          desc_mp = EXCLUDED.desc_mp,
          data_atualizacao = NOW(), status = 'OK', erro = EXCLUDED.erro
      WHERE public.app_mp_despesa.iddespesa IS NULL
         OR public.app_mp_despesa.iddespesa = EXCLUDED.iddespesa
      RETURNING seqgrupo, cor, iddespesa, status
    `, [String(grupo), cor, despesa, nome]);
    if (rows.length !== 1) throw new Error(`Mapeamento conflitante para MP ${mp}`);
    console.log({ mp, ...rows[0] });
  }
  await client.query('COMMIT');
  console.log('Ponte MP→despesa atualizada: 8/8.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
