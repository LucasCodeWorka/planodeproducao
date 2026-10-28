// Reproduz o rebuild de /api/admin/refresh no banco compartilhado.
// Uso operacional quando a credencial administrativa do Render nao esta disponivel localmente.
import 'dotenv/config';
import pg from 'pg';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { initCache, getCacheStatus, writeCache, writeCacheByKey } = require('../src/cache/matrizCache');
const { buscarMatrizPlanejamentoRapida, buscarExecucaoPlanoResumo } = require('../src/services/producaoService');
const { calcularCurvaAbcReferencias } = require('../src/services/curvaAbcService');
const pool = new pg.Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD || '').replace(/^"|"$/g, ''),
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
    ? { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() === 'true' }
    : undefined,
});

try {
  await initCache(pool);
  const antes = await getCacheStatus();
  console.log('cache_antes', JSON.stringify(antes));
  const inicio = Date.now();
  const marca = 'LIEBE';
  const status = 'EM LINHA,NOVA COLECAO';
  const data = await buscarMatrizPlanejamentoRapida(pool, { marca, status });
  if (!data.length) throw new Error('Matriz vazia; cache preservado');
  const execucaoPlanoResumo = await buscarExecucaoPlanoResumo(pool, { marca, status });
  await writeCache({ rows: data, execucaoPlanoResumo },
    { marca, status, schema: 'de_para_horizonte_v2', geradoPor: 'sincronizar-analise-orcamento-mp' });
  const abc = await calcularCurvaAbcReferencias(pool);
  await writeCacheByKey('curva_abc_referencias', abc,
    { marca: 'LIEBE', status: 'EM LINHA', geradoPor: 'sincronizar-analise-orcamento-mp' });
  const depois = await getCacheStatus();
  console.log('cache_depois', JSON.stringify({ ...depois, duracaoMs: Date.now() - inicio }));
  if (depois.count !== data.length || depois.timestamp <= antes.timestamp) process.exitCode = 1;
} finally {
  await pool.end();
}
