const express = require("express");
const cors = require("cors");
const compression = require("compression");
const cacheRespostas = require("./services/cacheRespostas");
const { Pool } = require("pg");
require("dotenv").config();

const { initCache }   = require("./cache/matrizCache");
const { aquecer: aquecerClassificacaoErp } = require("./services/classificacaoErpCache");
const estoqueRoutes   = require("./routes/estoque");
const vendasRoutes    = require("./routes/vendas");
const producaoRoutes  = require("./routes/producao");
const filtrosRoutes   = require("./routes/filtros");
const adminRoutes     = require("./routes/admin");
const projecoesRoutes = require("./routes/projecoes");
const analisesRoutes  = require("./routes/analises");
const openaiRoutes    = require("./routes/openai");
const configuracoesRoutes = require("./routes/configuracoes");
const consumoMpRoutes = require("./routes/consumoMp");
const capacidadeRoutes = require("./routes/capacidade");
const estoqueLojasRoutes = require("./routes/estoqueLojas");
const mlRoutes = require("./routes/ml");
const indicadoresOpRoutes = require("./routes/indicadores-op");
const totvsModaRoutes = require("./routes/totvsModa");
const excessoMpRoutes = require("./routes/excessoMp");
const relatorioOpMpRoutes = require("./routes/relatorioOpMp");
const projecaoPermanentesRoutes = require("./routes/projecao-permanentes");
const projecaoEdicaoLimitadaRoutes = require("./routes/projecao-edicao-limitada");
const analiseCapacidadeRoutes = require("./routes/analiseCapacidade");

const app = express();

// CORS - Permitir requisições do frontend
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (corsOrigin && origin === corsOrigin) return callback(null, true);
    if (/^http:\/\/localhost:\d+$/.test(origin)) return callback(null, true);
    if (/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) return callback(null, true);
    return callback(new Error("Origem nao permitida pelo CORS"));
  },
  credentials: true
}));

// GZIP: a distribuição tem 1,5 MB de JSON e a Visão Geral pede ~20 rotas; comprimido cai a
// uma fração e a tela no Render abre bem mais rápido.
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

const {
  DB_HOST,
  DB_PORT,
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  DB_SSL,
  DB_SSL_REJECT_UNAUTHORIZED,
  DB_CONNECTION_TIMEOUT_MS,
  DB_IDLE_TIMEOUT_MS,
  DB_QUERY_TIMEOUT_MS,
  PORT,
  API_PORT = 8000,
  API_HOST = "0.0.0.0"
} = process.env;

const useSsl = String(DB_SSL || '').trim().toLowerCase() === 'true';
const rejectUnauthorized = String(DB_SSL_REJECT_UNAUTHORIZED || '').trim().toLowerCase() === 'true';

const pool = new Pool({
  host: DB_HOST,
  port: Number(DB_PORT),
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: Number(DB_IDLE_TIMEOUT_MS) || 60000,
  connectionTimeoutMillis: Number(DB_CONNECTION_TIMEOUT_MS) || 60000,
  query_timeout: Number(DB_QUERY_TIMEOUT_MS) || 0,
  ssl: useSsl ? { rejectUnauthorized } : undefined,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

// Disponibilizar pool para as rotas
app.set("pool", pool);

// Health check
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    return res.status(200).json({
      ok: true,
      database: "connected",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      database: "disconnected",
      error: error.message
    });
  }
});

// Cache das rotas lentas da Visão Geral 2 e da Capacidade x Plano: serve o guardado na hora
// e refaz por trás (src/services/cacheRespostas.js).
app.use(cacheRespostas.middleware);
app.get("/api/cache-respostas", (req, res) => {
  const token = String(req.headers.authorization || "").replace("Bearer ", "").trim();
  if (!process.env.ADMIN_PASSWORD || token !== String(process.env.ADMIN_PASSWORD).trim()) return res.status(401).json({ success: false, error: "Não autorizado" });
  return res.json({ success: true, ...cacheRespostas.estado() });
});

// Rotas
app.use("/api/estoque-minimo", estoqueRoutes);
app.use("/api/vendas",         vendasRoutes);
app.use("/api/producao",       producaoRoutes);
app.use("/api/filtros",        filtrosRoutes);
app.use("/api/admin",          adminRoutes);
app.use("/api/projecoes",      projecoesRoutes);
app.use("/api/analises",       analisesRoutes);
app.use("/api/simulacoes",     analisesRoutes);
app.use("/api/openai",         openaiRoutes);
app.use("/api/configuracoes",  configuracoesRoutes);
app.use("/api/consumo-mp",     consumoMpRoutes);
app.use("/api/capacidade",     capacidadeRoutes);
app.use("/api/estoque-lojas",  estoqueLojasRoutes);
app.use("/api/ml",             mlRoutes);
app.use("/api/indicadores-op", indicadoresOpRoutes);
app.use("/api/totvs-moda",     totvsModaRoutes);
app.use("/api/excesso-mp",     excessoMpRoutes);
app.use("/api/relatorio-op-mp", relatorioOpMpRoutes);
app.use("/api/projecao-permanentes", projecaoPermanentesRoutes);
app.use("/api/projecao-edicao-limitada", projecaoEdicaoLimitadaRoutes);
app.use("/api/analise-capacidade", analiseCapacidadeRoutes);

// Rota legada mantida para compatibilidade
app.get("/api/vr-vendas-qtd", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const query = `
      SELECT *
      FROM vr_vendas_qtd
      LIMIT $1 OFFSET $2
    `;

    const result = await pool.query(query, [limit, offset]);
    return res.status(200).json({
      total: result.rowCount,
      limit,
      offset,
      data: result.rows
    });
  } catch (error) {
    return res.status(500).json({
      message: "Erro ao consultar a view vr_vendas_qtd",
      error: error.message
    });
  }
});

// 404 handler
app.use((_req, res) => {
  return res.status(404).json({ message: "Rota nao encontrada" });
});

const listenPort = Number(PORT || API_PORT || 8000);

async function ensureAnalisesIndexes() {
  try {
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_snapshot_lotes_data_snapshot ON snapshot_lotes (data_snapshot)`);
  } catch (error) {
    console.warn('[startup] Nao foi possivel criar indice de snapshots:', error.message);
  }
}

// Iniciar servidor após inicializar o cache no banco
ensureAnalisesIndexes().then(() => initCache(pool)).then(() => {
  app.listen(listenPort, API_HOST, () => {
  console.log(`API ouvindo em http://${API_HOST}:${listenPort}`);
  // Classificacao atual do ERP de quem vendeu no 2o semestre: cara (~80s), entao aquece em
  // segundo plano para a primeira abertura da Visao Geral nao estourar o timeout.
  aquecerClassificacaoErp(pool, `${new Date().getFullYear()}-07-01`);
  // Rotas mais caras da Visão Geral 2 e da Capacidade x Plano, com as mesmas URLs das telas:
  // a primeira abertura depois de um deploy não paga a conta fria (~2 min de banco).
  cacheRespostas.iniciar(listenPort);
  setTimeout(() => {
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const ini = new Date(ano, hoje.getMonth() - 12, 1);
    const de = `${ini.getFullYear()}-${String(ini.getMonth() + 1).padStart(2, "0")}-01`;
    const esperanca = new URLSearchParams({ meses: "6", coringa: "08 - ESPERANCA SO BASICO>05 - POSITIVO SU BASICO", coringa_desde: "JA", reforco: "08 - ESPERANCA SO BASICO>1.6667@JA" });
    cacheRespostas.aquecer([
      "/api/capacidade/min-peca-move",
      "/api/capacidade/min-peca-medido",
      "/api/producao/plano-por-mes-real",
      `/api/analise-capacidade/plano-ano?ano=${ano + 1}`,
      `/api/projecao-edicao-limitada?anoDestino=${ano + 1}&detalhe=1&crescimentoFabrica=0`,
      `/api/projecao-edicao-limitada?anoDestino=${ano}&detalhe=1&crescimentoFabrica=0`,
      "/api/capacidade/capacidade-mensal",
      "/api/capacidade/indice-mensal",
      "/api/capacidade/dias-resumo",
      "/api/capacidade/gap-mensal",
      "/api/capacidade/tempos-por-grupo",
      `/api/analise-capacidade/finalizado?de=${de}`,
      `/api/analises/projetado-vs-realizado?ano=${ano}`,
      // Só para encher as leituras de base da distribuição (servem a qualquer cenário).
      `/api/capacidade/distribuicao-sugerida?${esperanca}`,
      "/api/capacidade/estoque-liebe",
    ]).catch((e) => console.warn("[cache-respostas] aquecimento falhou:", e.message));
  }, 5000);
  console.log(`\nEndpoints disponiveis:`);
  console.log(`\n  Sistema:`);
  console.log(`    GET  /health`);
  console.log(`\n  Vendas:`);
  console.log(`    GET  /api/vendas`);
  console.log(`    GET  /api/vendas/produtos`);
  console.log(`    GET  /api/vendas/produtos/com-estoque-minimo`);
  console.log(`    GET  /api/vendas/produtos/:idProduto/estoque-minimo`);
  console.log(`    GET  /api/vendas/produtos/:idProduto/estatisticas`);
  console.log(`\n  Estoque Minimo:`);
  console.log(`    POST /api/estoque-minimo/calcular`);
  console.log(`    POST /api/estoque-minimo/calcular-lote`);
  console.log(`\n  Producao:`);
  console.log(`    GET  /api/producao/estoque`);
  console.log(`    GET  /api/producao/em-processo`);
  console.log(`    GET  /api/producao/pedidos-pendentes/:cdProduto`);
  console.log(`    GET  /api/producao/catalogo`);
  console.log(`    GET  /api/producao/planejamento`);
  console.log(`    GET  /api/producao/planejamento/:cdProduto`);
  console.log(`\n  Filtros:`);
  console.log(`    GET  /api/filtros/status`);
  console.log(`    GET  /api/filtros/familias`);
  console.log(`    GET  /api/filtros/continuidade`);
  console.log(`\n  Analises:`);
  console.log(`    GET    /api/analises`);
  console.log(`    POST   /api/analises`);
  console.log(`    DELETE /api/analises/:id`);
  console.log(`\n  Simulacoes:`);
  console.log(`    GET    /api/simulacoes`);
  console.log(`    POST   /api/simulacoes`);
  console.log(`    PUT    /api/simulacoes/:id`);
  console.log(`    DELETE /api/simulacoes/:id`);
  console.log(`\n  OpenAI:`);
  console.log(`    POST   /api/openai/test`);
  console.log(`    POST   /api/openai/analyser`);
  console.log(`    POST   /api/openai/diagnostico`);
  console.log(`\n  Configuracoes:`);
  console.log(`    GET    /api/configuracoes/corte-minimos`);
  console.log(`    POST   /api/configuracoes/corte-minimos`);
  console.log(`    GET    /api/configuracoes/sugestao-plano`);
  console.log(`    POST   /api/configuracoes/sugestao-plano`);
  console.log(`\n  Consumo MP:`);
  console.log(`    GET    /api/consumo-mp/estrutura`);
  console.log(`    GET    /api/consumo-mp/estoque`);
  console.log(`    POST   /api/consumo-mp/analise`);
  console.log(`    GET    /api/excesso-mp`);
  console.log(`\n  TOTVS Moda:`);
  console.log(`    POST   /api/totvs-moda/prices/mp`);
  console.log(`    POST   /api/totvs-moda/purchase-orders`);
  console.log(`    POST   /api/totvs-moda/purchase-orders/cancel`);
  console.log(`\n  Capacidade:`);
  console.log(`    GET    /api/capacidade/config`);
  console.log(`    GET    /api/capacidade/grupos`);
  console.log(`    POST   /api/capacidade/grupos`);
  console.log(`    GET    /api/capacidade/grupo-refs`);
  console.log(`    POST   /api/capacidade/grupo-refs`);
  console.log(`    GET    /api/capacidade/dias`);
  console.log(`    POST   /api/capacidade/dias`);
  console.log(`    GET    /api/capacidade/tempos-ref`);
  console.log(`\n  Legado:`);
  console.log(`    GET  /api/vr-vendas-qtd`);
  });
}).catch((err) => {
  console.error('[startup] Falha ao inicializar cache:', err.message);
  process.exit(1);
});
