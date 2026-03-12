const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();

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

app.use(express.json({ limit: "10mb" }));
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

const {
  DB_HOST,
  DB_PORT,
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  API_PORT = 8000,
  API_HOST = "0.0.0.0"
} = process.env;

const pool = new Pool({
  host: DB_HOST,
  port: Number(DB_PORT),
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
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

// Rotas
app.use("/api/estoque-minimo", estoqueRoutes);
app.use("/api/vendas",         vendasRoutes);
app.use("/api/producao",       producaoRoutes);
app.use("/api/filtros",        filtrosRoutes);
app.use("/api/admin",          adminRoutes);
app.use("/api/projecoes",      projecoesRoutes);
app.use("/api/analises",       analisesRoutes);
app.use("/api/openai",         openaiRoutes);
app.use("/api/configuracoes",  configuracoesRoutes);
app.use("/api/consumo-mp",     consumoMpRoutes);
app.use("/api/capacidade",     capacidadeRoutes);

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

// Iniciar servidor
app.listen(Number(API_PORT), API_HOST, () => {
  console.log(`API ouvindo em http://${API_HOST}:${API_PORT}`);
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
