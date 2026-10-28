import 'dotenv/config';
import pg from 'pg';

const esperado = [
  ['269', '904', 1470, 'SACO PP LISO P/ PICOTE 08X11X0,06 UNICA U', '26802'],
  ['299', '904', 1471, 'PROT.CONJ  PP 36X25 0,05 IMPRESSO NORMAL UNICA U', '26804'],
  ['301', '904', 1472, 'PROT.CONJ ESP  PP 40 X 27 0,05 C/OXI UNICA U', '26806'],
  ['319', '904', 1473, 'EMB 15X18+3X0,05 PP ADS IMPRES NORMAL UNICA U', '26808'],
  ['323', '904', 1474, 'EMB  18X37+3 X 0,05 PP  ADS IMPRES NORMA UNICA U', '26810'],
  ['325', '904', 1475, 'EMB  20X40+3 X 0,05 PP  ADS IMPRE NORMAL UNICA U', '26812'],
  ['4608', '904', 1476, 'EMBALAGEN SEM IMPRESSAO 28 X 40 3 X 0,05 UNICA U', '26814'],
  ['12203', '904', 1477, 'CONSUMO PINO DE NYLON  FIX PIN 20 MM UNICA U', '26816'],
];
const pool = new pg.Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
    ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true' }
    : undefined,
});
try {
  const { rows } = await pool.query(`
    SELECT a.seqgrupo, a.cor, a.iddespesa, a.status,
           f.ds_despesaitem, f.ds_original, f.pr_rateio, f.tp_custodespesa,
           f.tp_fixovariavel, f.tp_diretoindireto, f.tp_ccusto,
           f.in_padrao, f.in_bloqueada, p.sequencias
    FROM public.app_mp_despesa a
    LEFT JOIN public.vr_fcp_despesaitem f ON f.cd_despesaitem=a.iddespesa
    LEFT JOIN LATERAL (
      SELECT array_agg(nr_seqplanoctai::text ORDER BY nr_seqplanoctai) AS sequencias
      FROM public.vr_fcp_planoctai
      WHERE cd_planoctac=500 AND cd_ccusto=506 AND cd_despesaitem=a.iddespesa
    ) p ON true
    WHERE a.iddespesa=ANY($1::int[]) ORDER BY a.iddespesa`, [esperado.map((x) => x[2])]);
  const mapa = new Map(rows.map((row) => [row.iddespesa, row]));
  const resultado = esperado.map(([grupo, cor, codigo, descricao, sequencia]) => {
    const row = mapa.get(codigo);
    const camposOk = row?.ds_despesaitem?.trim() === descricao
      && row?.ds_original?.trim() === descricao
      && Number(row.pr_rateio) === 100 && row.in_padrao === 'T'
      && String(row.tp_custodespesa) === '2'
      && String(row.tp_fixovariavel) === '1'
      && String(row.tp_diretoindireto) === '3'
      && String(row.tp_ccusto) === '1' && row.in_bloqueada !== 'T';
    return { codigo,
      ponte: row?.seqgrupo === grupo && row.cor === cor && row.status === 'OK' ? 'OK' : 'FALHA',
      cadastro: row?.ds_despesaitem ? (camposOk ? 'OK' : 'CONFERIR') : 'AGUARDANDO',
      plano: row?.sequencias?.length
        ? row.sequencias.length === 1 && row.sequencias[0] === sequencia ? 'OK' : 'CONFERIR'
        : 'AGUARDANDO',
    };
  });
  console.table(resultado);
  for (const item of resultado.filter((x) => x.cadastro === 'CONFERIR')) {
    const row = mapa.get(item.codigo);
    console.log(`Cadastro ${item.codigo} para conferir:`, {
      descricao: row.ds_despesaitem,
      descricaoAuxiliar: row.ds_original,
      rateio: row.pr_rateio,
      padrao: row.in_padrao,
      custoDespesa: row.tp_custodespesa,
      fixoVariavel: row.tp_fixovariavel,
      diretoIndireto: row.tp_diretoindireto,
      tipoCusto: row.tp_ccusto,
      bloqueada: row.in_bloqueada,
    });
  }
  if (resultado.some((x) => x.ponte !== 'OK' || x.cadastro !== 'OK' || x.plano !== 'OK')) {
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
