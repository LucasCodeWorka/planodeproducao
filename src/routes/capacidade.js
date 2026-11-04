const express = require("express");
const fs = require("fs");
const path = require("path");
const { calcularPeriodosPlano, PERIODOS_PLANO } = require("../services/periodoPlanoService");
const { diasDeFabricaRestantes, diasDisponiveisDoPeriodo } = require("../lib/diasUteis");

const router = express.Router();

const DATA_DIR = path.join(__dirname, "../../data");
const GRUPOS_FILE = path.join(DATA_DIR, "capacidade_grupos.json");
const GRUPO_REFS_FILE = path.join(DATA_DIR, "capacidade_grupo_refs.json");
const DIAS_FILE = path.join(DATA_DIR, "capacidade_dias.json");
const DEFAULT_REAL_GROUP_IDS = [82, 83, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 421, 681, 722, 1241, 1402, 1422];

// Grupos descontinuados em 2026-10-14 (commit "Desativa grupos de capacidade
// descontinuados"). Mantidos aqui so para o comparativo "cenario anterior";
// capacidade_grupos.json e a unica fonte da capacidade ATIVA.
// CELULAS QUE NAO RODAM MAIS. Ficam aqui, e nao apagadas do banco, por tres razoes: o
// `capacidadeDiariaTotalAnterior` precisa delas para mostrar o "antes"; a desativacao
// sobrevive a um "salvar" da tela de capacidade, que reescreve a tabela inteira; e voltar
// uma celula e apagar uma linha daqui, sem mexer em dado nenhum.
//
// MARCELO FREITAS e PAULO BRUNO entraram em 04/11/2026, informados pelo PCP: so Gledson e
// Iana seguem costurando. Juntas somavam 4.360 min/dia medidos — 7,9% da capacidade — e
// estavam infladas duas vezes: a media sai de `minutos / dias COM movimento`, e as duas
// tiveram movimento em 23 de ~63 dias da janela (contra 62-64 das celulas internas). Ou
// seja, o sistema pegava o ritmo dos dias em que elas ainda rodavam e o aplicava a todos os
// dias do horizonte.
const GRUPOS_DESATIVADOS = [
  { grupo: "08 - PROGRESSO SO BASICO", tipo: "", capacidade_diaria: 303603 },
  { grupo: "OFICINA - ATILA", tipo: "", capacidade_diaria: 701748 },
  { grupo: "OFICINA - MARCELO FREITAS", tipo: "", capacidade_diaria: 701705 },
  { grupo: "OFICINA - PAULO BRUNO", tipo: "", capacidade_diaria: 701748 },
  // Cadastrada e sem producao nenhuma em ago-out/2026 — zero minutos nos tres meses. Ja
  // somava zero na capacidade (a medicao manda), mas cadastrada ela recebia rateio de carga
  // na ocupacao por grupo: uma celula com carga e sem capacidade distorce a leitura.
  { grupo: "03 - EXCELENCIA SU BASICO", tipo: "", capacidade_diaria: 303603 },
];
const NOMES_DESATIVADOS = new Set(GRUPOS_DESATIVADOS.map((g) => g.grupo));

// CELULAS QUE PRODUZEM E NAO ESTAVAM NO CADASTRO.
//
// O contrario do caso acima, e mais perigoso: a celula roda, o ERP registra, e o sistema
// nao enxerga — entao a fabrica parece menor do que e. `08 - ESPERANCA CA BASICO` (cd 101)
// costurou nos TRES meses da janela, 21 dias em cada, 2.252 min/dia de media, e estava fora
// da capacidade por nao constar na tabela.
//
// Entra aqui, no fonte, pelo mesmo motivo das desativadas: sobrevive ao "salvar" da tela e
// ao disco efemero do Render. O `capacidade_diaria` abaixo e so fallback — havendo medicao
// do ERP, e ela que vale.
const GRUPOS_EXTRA = [
  { grupo: "08 - ESPERANCA CA BASICO", tipo: "", capacidade_diaria: 2252 },
];
const realCapacityCache = { data: null, timestamp: 0 };

// Cache para dias-resumo (evita recalcular a cada requisição)
const diasResumoCache = { data: null, timestamp: 0, comParada: false };
const DIAS_RESUMO_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
  const expected = (process.env.ADMIN_PASSWORD || "").trim();
  if (!expected) {
    return res.status(500).json({ success: false, error: "ADMIN_PASSWORD não configurado" });
  }
  if (token !== expected) {
    return res.status(401).json({ success: false, error: "Não autorizado" });
  }
  next();
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, payload) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf-8");
}

// ── capacidade diaria por grupo ─────────────────────────────────────────────
//
// Vive no BANCO (app_capacidade_grupos), pelo mesmo motivo que o mapeamento de referencias:
// o disco do Render e efemero e nao ha disco persistente declarado no render.yaml. Enquanto
// isto gravava so em arquivo, TODA capacidade cadastrada pela tela sumia no deploy seguinte
// e o painel voltava para a versao commitada do repositorio — foi o que o Fagner viu como
// "o painel perdeu as informacoes que subi". O arquivo continua como SEMENTE, para a
// primeira carga e para rodar local sem banco.

function normalizarGrupos(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      grupo: String(r.grupo || "").trim().toUpperCase(),
      tipo: String(r.tipo || "").trim().toUpperCase(),
      capacidade_diaria: Number(r.capacidade_diaria || 0),
    }))
    // Celula desativada sai aqui, no unico funil por onde todo mundo le os grupos — assim
    // nao ha caminho (banco, arquivo, cache) que a traga de volta por engano.
    .filter((r) => r.grupo && !NOMES_DESATIVADOS.has(r.grupo) && Number.isFinite(r.capacidade_diaria) && r.capacidade_diaria > 0)
    .sort((a, b) => a.grupo.localeCompare(b.grupo));
}

// Acrescenta as celulas do fonte que o cadastro nao tem, sem duplicar as que ja vieram.
// Fica junto de `normalizarGrupos` de proposito: os dois ajustes — tirar a desativada e pôr
// a que faltava — precisam valer em TODO caminho de leitura, nao so no do banco.
function comGruposExtra(linhas) {
  const vistos = new Set(linhas.map((g) => g.grupo));
  const faltantes = GRUPOS_EXTRA.filter((g) => !vistos.has(g.grupo));
  return faltantes.length ? normalizarGrupos([...linhas, ...faltantes]) : linhas;
}

function readGruposDoArquivo() {
  return comGruposExtra(normalizarGrupos(readJson(GRUPOS_FILE, { data: [] })?.data));
}

const gruposCache = { data: null, timestamp: 0 };
const GRUPOS_TTL_MS = 60 * 1000;

async function readGrupos(pool) {
  if (gruposCache.data && Date.now() - gruposCache.timestamp < GRUPOS_TTL_MS) {
    return gruposCache.data;
  }
  if (!pool) return readGruposDoArquivo();
  try {
    const r = await pool.query("SELECT grupo, tipo, capacidade_diaria FROM app_capacidade_grupos");
    const linhas = comGruposExtra(normalizarGrupos(r.rows));
    if (linhas.length === 0) {
      const doArquivo = readGruposDoArquivo();
      if (doArquivo.length > 0) await writeGrupos(pool, doArquivo);
      gruposCache.data = doArquivo;
      gruposCache.timestamp = Date.now();
      return doArquivo;
    }
    gruposCache.data = linhas;
    gruposCache.timestamp = Date.now();
    return linhas;
  } catch (err) {
    // Tabela ainda nao existe: e o estado normal ate o primeiro "salvar" da tela, e nao e
    // erro. De proposito NAO semeamos o banco a partir do arquivo aqui — o arquivo commitado
    // esta com codigo de referencia de produto no lugar de minutos (soma 7.671.414 contra
    // 55.433 medidos no ERP), e semear tornaria esse lixo permanente em vez de descartavel.
    // Ate alguem salvar a capacidade correta pela tela, segue valendo o arquivo, como antes.
    if (err.code !== "42P01") {
      console.error("[capacidade] grupos do banco falhou, usando arquivo:", err.message);
    }
    return readGruposDoArquivo();
  }
}

async function writeGrupos(pool, data) {
  const linhas = normalizarGrupos(data);
  if (!pool) {
    writeJson(GRUPOS_FILE, { timestamp: Date.now(), total: linhas.length, data: linhas });
    return linhas;
  }
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`
      CREATE TABLE IF NOT EXISTS app_capacidade_grupos (
        grupo            TEXT PRIMARY KEY,
        tipo             TEXT NOT NULL DEFAULT '',
        capacidade_diaria NUMERIC NOT NULL,
        atualizado_em    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    // A tela manda a lista inteira: trocar o conteudo faz um grupo REMOVIDO sumir de fato.
    await c.query("DELETE FROM app_capacidade_grupos");
    for (const r of linhas) {
      await c.query(
        "INSERT INTO app_capacidade_grupos (grupo, tipo, capacidade_diaria) VALUES ($1, $2, $3) ON CONFLICT (grupo) DO UPDATE SET tipo = EXCLUDED.tipo, capacidade_diaria = EXCLUDED.capacidade_diaria, atualizado_em = NOW()",
        [r.grupo, r.tipo, r.capacidade_diaria]
      );
    }
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
  gruposCache.data = linhas;
  gruposCache.timestamp = Date.now();
  return linhas;
}

// ── mapeamento referencia -> grupo de capacidade ────────────────────────────
//
// Vive no BANCO (app_capacidade_grupo_refs). Antes era so o arquivo do repositorio, e o
// disco do Render e efemero: todo mapeamento feito pela tela sumia no deploy seguinte,
// voltando para a versao commitada (a ultima era de 11/06/2026). O arquivo continua
// existindo como SEMENTE — serve para a primeira carga e para rodar local sem banco.

const normalizarGrupoRefs = (rows) => rows
  .map((r) => ({
    grupo: String(r.grupo || "").trim().toUpperCase(),
    referencia: String(r.referencia || "").trim().toUpperCase(),
  }))
  .filter((r) => r.grupo && r.referencia)
  .sort((a, b) => (a.grupo + a.referencia).localeCompare(b.grupo + b.referencia));

function readGrupoRefsDoArquivo() {
  const parsed = readJson(GRUPO_REFS_FILE, { data: [] });
  return normalizarGrupoRefs(Array.isArray(parsed?.data) ? parsed.data : []);
}

// O mapeamento muda raramente e e lido em todo calculo de capacidade; sem cache seriam
// varias idas ao banco por request.
const grupoRefsCache = { data: null, timestamp: 0 };
const GRUPO_REFS_TTL_MS = 60 * 1000;

async function readGrupoRefs(pool) {
  if (grupoRefsCache.data && Date.now() - grupoRefsCache.timestamp < GRUPO_REFS_TTL_MS) {
    return grupoRefsCache.data;
  }
  if (!pool) return readGrupoRefsDoArquivo();
  try {
    const r = await pool.query("SELECT grupo, referencia FROM app_capacidade_grupo_refs");
    const linhas = normalizarGrupoRefs(r.rows);
    // Banco vazio (primeira subida): semeia com o arquivo para nao comecar sem nada.
    if (linhas.length === 0) {
      const doArquivo = readGrupoRefsDoArquivo();
      if (doArquivo.length > 0) await writeGrupoRefs(pool, doArquivo);
      grupoRefsCache.data = doArquivo;
      grupoRefsCache.timestamp = Date.now();
      return doArquivo;
    }
    grupoRefsCache.data = linhas;
    grupoRefsCache.timestamp = Date.now();
    return linhas;
  } catch (err) {
    // Banco fora do ar nao pode derrubar a tela de capacidade.
    console.error("[capacidade] grupo-refs do banco falhou, usando arquivo:", err.message);
    return readGrupoRefsDoArquivo();
  }
}

async function writeGrupoRefs(pool, data) {
  const linhas = normalizarGrupoRefs(data);
  if (!pool) {
    writeJson(GRUPO_REFS_FILE, { timestamp: Date.now(), total: linhas.length, data: linhas });
    return linhas;
  }
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`
      CREATE TABLE IF NOT EXISTS app_capacidade_grupo_refs (
        id            SERIAL PRIMARY KEY,
        grupo         TEXT NOT NULL,
        referencia    TEXT NOT NULL,
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (grupo, referencia)
      )
    `);
    // A tela sempre manda a lista inteira, entao o jeito honesto e trocar o conteudo —
    // assim uma referencia REMOVIDA no cadastro some mesmo.
    await c.query("DELETE FROM app_capacidade_grupo_refs");
    for (const r of linhas) {
      await c.query(
        "INSERT INTO app_capacidade_grupo_refs (grupo, referencia) VALUES ($1, $2) ON CONFLICT (grupo, referencia) DO NOTHING",
        [r.grupo, r.referencia]
      );
    }
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
  grupoRefsCache.data = linhas;
  grupoRefsCache.timestamp = Date.now();
  return linhas;
}

// Mesma lista do serviço de períodos: MA..NV. Estava congelada em cinco aqui, então o
// em-processo de SX em diante nunca era atribuído ao período certo.
const PERIODOS_LOTE = PERIODOS_PLANO;

/**
 * Em processo por REFERENCIA e por PERIODO do plano.
 *
 * A matriz so sabe o total em processo de cada SKU, sem dizer a que periodo ele pertence.
 * Por isso a carga de processo ia inteira para o MA, enquanto as PECAS ja eram
 * distribuidas — e os dois lados contavam populacoes diferentes.
 *
 * O periodo sai do MES DO LOTE (`ds_lotepv` comeca com "YYYY-MM"), nao do `cd_auxiliar`:
 * aquele rotulo e rolante e mistura meses (em out/2026 o balde MA carregava setembro).
 * Mes anterior ao corrente cai no MA, porque e trabalho atrasado sendo feito agora.
 */
// As duas rotas de capacidade pedem a mesma abertura no mesmo request da tela; sem cache
// a consulta roda duas vezes e o gap-mensal passava de 100s.
const processoPeriodoCache = { data: null, timestamp: 0 };
const PROCESSO_PERIODO_TTL_MS = 60 * 1000;

async function carregarProcessoPorRefPeriodo(pool, matrizRows, periodos, hoje = new Date()) {
  if (processoPeriodoCache.data && Date.now() - processoPeriodoCache.timestamp < PROCESSO_PERIODO_TTL_MS) {
    return processoPeriodoCache.data;
  }
  const mapa = new Map();
  if (!pool) return { mapa, ok: false };

  // mes (1-12) -> periodo do plano, pela propria tabela de periodos ja calculada
  const periodoDoMes = new Map();
  for (const p of PERIODOS_LOTE) {
    const mes = Number(periodos?.[p] || 0);
    if (mes) periodoDoMes.set(mes, p);
  }

  try {
    const result = await pool.query(`
      SELECT a.cd_produto::TEXT AS sku,
             SUBSTRING(TRIM(p.ds_lotepv) FROM 1 FOR 7) AS mes_lote,
             SUM(GREATEST(COALESCE(a.qt_real, 0) - COALESCE(a.qt_finalizada, 0), 0))::FLOAT AS processo
        FROM vr_pcp_loteplop a
        JOIN pcp_lotepv p ON p.nr_lote = a.nr_lote
       WHERE p.tp_situacao = 1
         AND TRIM(p.ds_lotepv) ~ '^[0-9]{4}-[0-9]{2}'
       GROUP BY 1, 2
      HAVING SUM(GREATEST(COALESCE(a.qt_real, 0) - COALESCE(a.qt_finalizada, 0), 0)) > 0
    `);

    // Mesma populacao do resto do calculo: marca, status e sem meia de seda.
    const itemPorSku = new Map();
    for (const item of matrizRows) {
      const marca = String(item?.produto?.marca || "").trim().toUpperCase();
      const status = String(item?.produto?.status || "").trim().toUpperCase();
      const descricao = String(item?.produto?.produto || "").trim().toUpperCase();
      if (marca !== "LIEBE") continue;
      if (!["EM LINHA", "NOVA COLECAO"].includes(status)) continue;
      if (descricao.includes("MEIA DE SEDA")) continue;
      const sku = String(item?.produto?.idproduto || "").trim();
      if (sku) itemPorSku.set(sku, item);
    }

    const anoHoje = hoje.getFullYear();
    const mesHoje = hoje.getMonth() + 1;
    for (const row of result.rows) {
      const item = itemPorSku.get(String(row.sku || "").trim());
      if (!item) continue;
      const qtd = Number(row.processo || 0);
      if (!qtd) continue;

      const [anoLote, mesLote] = String(row.mes_lote || "").split("-").map(Number);
      if (!anoLote || !mesLote) continue;
      // Lote de mes ja passado: o trabalho esta sendo feito AGORA, entao pesa no mes corrente.
      const atrasado = anoLote < anoHoje || (anoLote === anoHoje && mesLote < mesHoje);
      const periodo = atrasado ? "MA" : periodoDoMes.get(mesLote);
      if (!periodo) continue;

      for (const chave of [
        String(item?.produto?.referencia || "").trim().toUpperCase(),
        String(item?.produto?.cd_seqgrupo || "").trim().toUpperCase(),
      ]) {
        if (!chave) continue;
        const atual = mapa.get(chave) || { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 };
        atual[periodo] = (atual[periodo] || 0) + qtd;
        mapa.set(chave, atual);
      }
    }
    const saida = { mapa, ok: mapa.size > 0 };
    processoPeriodoCache.data = saida;
    processoPeriodoCache.timestamp = Date.now();
    return saida;
  } catch (err) {
    // Sem a abertura o calculo segue valendo, so volta ao comportamento antigo (tudo no
    // MA). Melhor um numero conservador do que a tela em branco.
    console.error("[capacidade] em processo por periodo falhou:", err.message);
    return { mapa, ok: false };
  }
}

function buildDefaultDias() {
  return {
    "1": 22, "2": 20, "3": 22, "4": 22, "5": 22, "6": 22,
    "7": 22, "8": 22, "9": 22, "10": 22, "11": 22, "12": 22,
  };
}

// ── dias uteis por mes ──────────────────────────────────────────────────────
// Mesma historia dos grupos: ia so para arquivo e voltava no deploy. Era por isso que o
// arquivo commitado dizia que outubro tinha 12 dias uteis no dia 27 — o valor certo que a
// operacao digitou tinha sido descartado no ultimo deploy.

function normalizarDias(src) {
  const base = src && typeof src === "object" ? src : {};
  const out = {};
  for (let mes = 1; mes <= 12; mes += 1) {
    const key = String(mes);
    const value = Number(base[key] || 0);
    out[key] = Number.isFinite(value) && value >= 0 ? value : 0;
  }
  return out;
}

function readDiasDoArquivo() {
  const parsed = readJson(DIAS_FILE, { data: buildDefaultDias() });
  return normalizarDias(parsed?.data && typeof parsed.data === "object" ? parsed.data : buildDefaultDias());
}

const diasCache = { data: null, timestamp: 0 };
const DIAS_TTL_MS = 60 * 1000;

async function readDias(pool) {
  if (diasCache.data && Date.now() - diasCache.timestamp < DIAS_TTL_MS) {
    return diasCache.data;
  }
  if (!pool) return readDiasDoArquivo();
  try {
    const r = await pool.query("SELECT mes, dias FROM app_capacidade_dias");
    if (r.rows.length === 0) {
      const doArquivo = readDiasDoArquivo();
      await writeDias(pool, doArquivo);
      diasCache.data = doArquivo;
      diasCache.timestamp = Date.now();
      return doArquivo;
    }
    const bruto = {};
    for (const row of r.rows) bruto[String(row.mes)] = Number(row.dias || 0);
    const linhas = normalizarDias(bruto);
    diasCache.data = linhas;
    diasCache.timestamp = Date.now();
    return linhas;
  } catch (err) {
    // 42P01 = tabela ainda nao criada; e o estado ate o primeiro salvar, nao e falha.
    if (err.code !== "42P01") {
      console.error("[capacidade] dias do banco falhou, usando arquivo:", err.message);
    }
    return readDiasDoArquivo();
  }
}

async function writeDias(pool, data) {
  const dias = normalizarDias(data);
  if (!pool) {
    writeJson(DIAS_FILE, { timestamp: Date.now(), data: dias });
    return dias;
  }
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`
      CREATE TABLE IF NOT EXISTS app_capacidade_dias (
        mes           INTEGER PRIMARY KEY,
        dias          INTEGER NOT NULL,
        atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    for (let mes = 1; mes <= 12; mes += 1) {
      await c.query(
        "INSERT INTO app_capacidade_dias (mes, dias) VALUES ($1, $2) ON CONFLICT (mes) DO UPDATE SET dias = EXCLUDED.dias, atualizado_em = NOW()",
        [mes, dias[String(mes)]]
      );
    }
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
  diasCache.data = dias;
  diasCache.timestamp = Date.now();
  return dias;
}

function parseNumericLikePowerBi(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function resolveTempoLikePowerBi(hrTempoRaw, hrTempoPadraoRaw) {
  const hrTempo = parseNumericLikePowerBi(hrTempoRaw);
  const hrTempoPadrao = parseNumericLikePowerBi(hrTempoPadraoRaw);
  // In the source model, zero behaves like an empty measured time and must
  // fall back to the standard time, otherwise several references stay far
  // below the benchmark load.
  if (hrTempo === null || hrTempo === 0) {
    return (hrTempoPadrao || 0) * 1440;
  }
  return hrTempo;
}

function parseListQuery(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => String(item || "").trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 2000);
}

async function queryTempoBaseRows(pool, filters = {}) {
  const params = [];
  const where = [];
  if (filters.idreferencia) {
    params.push(String(filters.idreferencia).trim().toUpperCase());
    where.push(`so.cd_seqgrupopa::TEXT = $${params.length}`);
  }
  if (filters.referencia) {
    params.push(String(filters.referencia).trim().toUpperCase());
    where.push(`COALESCE(refmap.referencia_padrao, '')::TEXT = $${params.length}`);
  }
  if (Array.isArray(filters.idreferencias) && filters.idreferencias.length) {
    params.push(filters.idreferencias);
    where.push(`so.cd_seqgrupopa::TEXT = ANY($${params.length}::text[])`);
  }
  if (Array.isArray(filters.referencias) && filters.referencias.length) {
    params.push(filters.referencias);
    where.push(`COALESCE(refmap.referencia_padrao, '')::TEXT = ANY($${params.length}::text[])`);
  }

  const sql = `
    WITH refmap AS (
      SELECT
        pg.cd_seqgrupo::TEXT AS idreferencia,
        MAX(COALESCE(f_dic_prd_nivel(pg.cd_produto, 'CD'::bpchar), ''))::TEXT AS referencia_padrao
      FROM public.vr_prd_prdgrade AS pg
      GROUP BY pg.cd_seqgrupo::TEXT
    )
    SELECT
      so.cd_seqgrupopa::TEXT AS idreferencia,
      COALESCE(refmap.referencia_padrao, '')::TEXT AS referencia_padrao,
      COALESCE(so.hr_tempo::TEXT, '') AS hr_tempo,
      COALESCE(op.hr_tempopadrao::TEXT, '') AS hr_tempopadrao,
      COALESCE(so.qt_operacao, 1)::FLOAT AS qt_operacao,
      UPPER(COALESCE(op.ds_tipooperacao, ''))::TEXT AS ds_tipooperacao,
      COALESCE(op.cd_tipooperacao::TEXT, '') AS cd_tipooperacao,
      COALESCE(so.cd_operacao::TEXT, '') AS cd_operacao,
      COALESCE(so.ds_operacao, '')::TEXT AS ds_operacao
    FROM public.vr_cdf_seqope AS so
    INNER JOIN public.vr_cdf_operac AS op ON so.cd_operacao = op.cd_operacao
    LEFT JOIN refmap ON refmap.idreferencia = so.cd_seqgrupopa::TEXT
    ${where.length ? `WHERE ${where.join(" OR ")}` : ""}
    ORDER BY so.cd_seqgrupopa::TEXT, op.cd_tipooperacao, so.cd_operacao
  `;

  return pool.query(sql, params);
}

async function queryRealCapacityReferences(pool) {
  if (realCapacityCache.data && Date.now() - realCapacityCache.timestamp < 5 * 60 * 1000) {
    return realCapacityCache.data;
  }

  const result = await pool.query(`
    WITH grupos_filtro (cd_local) AS (
      SELECT unnest($1::text[])
    ),
    cache_base AS (
      SELECT
        e.cd_grupo::text AS cd_grupo,
        DATE_TRUNC('month', e.dt_ref)::date AS mes,
        SUM(COALESCE(e.tempo_produzido_min, 0))::float AS minutos,
        COUNT(DISTINCT e.dt_ref) FILTER (WHERE COALESCE(e.tempo_produzido_min, 0) > 0)::int AS dias
      FROM pcp_cache_eficiencia_dia e
      JOIN grupos_filtro gf ON gf.cd_local = e.cd_grupo::text
      WHERE e.dt_ref >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '11 months')::date
        AND e.dt_ref < DATE_TRUNC('month', CURRENT_DATE)::date
      GROUP BY e.cd_grupo, DATE_TRUNC('month', e.dt_ref)
    ),
    movimentos_atual AS (
      SELECT
        m.cd_localorigem::text AS cd_grupo,
        m.dt_movimento::date AS dt_ref,
        m.cd_produto,
        COALESCE(m.qt_movimento, 0)::float AS qt_movimento
      FROM vr_cdf_movopi m
      JOIN grupos_filtro gf ON gf.cd_local = m.cd_localorigem::text
      WHERE m.tp_historicomov = 51
        AND m.in_estorno = 'F'
        AND m.dt_movimento::date >= DATE_TRUNC('month', CURRENT_DATE)::date
        AND m.dt_movimento::date < CURRENT_DATE
    ),
    tempo_padrao_atual AS (
      SELECT
        p.cd_produto,
        SUM(COALESCE(NULLIF(s.hr_tempo, 0), o.hr_tempopadrao * 1440))::float AS minutos
      FROM mv_prd_referencia_produto p
      JOIN vr_cdf_seqope s ON s.cd_seqgrupo = p.cd_seqgrupo
      JOIN vr_cdf_operac o ON o.cd_operacao = s.cd_operacao
      WHERE o.cd_tipooperacao IN (1, 3, 4)
        AND p.cd_produto IN (SELECT DISTINCT cd_produto FROM movimentos_atual)
      GROUP BY p.cd_produto
    ),
    atual_base AS (
      SELECT
        mv.cd_grupo,
        DATE_TRUNC('month', mv.dt_ref)::date AS mes,
        SUM(mv.qt_movimento * COALESCE(tp.minutos, 0))::float AS minutos,
        COUNT(DISTINCT mv.dt_ref) FILTER (WHERE mv.qt_movimento > 0)::int AS dias
      FROM movimentos_atual mv
      LEFT JOIN tempo_padrao_atual tp ON tp.cd_produto = mv.cd_produto
      GROUP BY mv.cd_grupo, DATE_TRUNC('month', mv.dt_ref)
    ),
    base AS (
      SELECT * FROM cache_base
      UNION ALL
      SELECT * FROM atual_base
    ),
    por_mes AS (
      SELECT cd_grupo, mes, SUM(minutos)::float AS minutos, SUM(dias)::int AS dias
      FROM base
      GROUP BY cd_grupo, mes
    ),
    ultimo AS (
      SELECT DISTINCT ON (cd_grupo)
        cd_grupo, minutos AS minutos_ultimo_mes, dias AS dias_ultimo_mes, mes AS ultimo_mes
      FROM por_mes
      ORDER BY cd_grupo, mes DESC
    )
    SELECT
      pm.cd_grupo,
      SUM(pm.minutos)::float AS minutos_12m,
      SUM(pm.dias)::int AS dias_12m,
      u.minutos_ultimo_mes,
      u.dias_ultimo_mes,
      u.ultimo_mes
    FROM por_mes pm
    JOIN ultimo u ON u.cd_grupo = pm.cd_grupo
    GROUP BY pm.cd_grupo, u.minutos_ultimo_mes, u.dias_ultimo_mes, u.ultimo_mes
  `, [DEFAULT_REAL_GROUP_IDS.map(String)]);

  const data = result.rows.map((row) => ({
    cdGrupo: String(row.cd_grupo || '').trim(),
    media12m: Number(row.minutos_12m || 0) / Math.max(1, Number(row.dias_12m || 0)),
    ultimoMes: Number(row.minutos_ultimo_mes || 0) / Math.max(1, Number(row.dias_ultimo_mes || 0)),
    ultimoMesData: row.ultimo_mes,
  }));
  realCapacityCache.data = data;
  realCapacityCache.timestamp = Date.now();
  return data;
}

router.get("/grupos", auth, async (req, res) => {
  const data = await readGrupos(req.app.get("pool"));
  return res.json({ success: true, total: data.length, data });
});

router.post("/grupos", auth, async (req, res) => {
  const rows = Array.isArray(req.body?.data) ? req.body.data : [];
  if (!rows.length) {
    return res.status(400).json({ success: false, error: "data é obrigatório" });
  }
  const map = new Map();
  for (const row of rows) {
    const grupo = String(row?.grupo || "").trim().toUpperCase();
    const tipo = String(row?.tipo || "").trim().toUpperCase();
    const capacidade_diaria = Number(row?.capacidade_diaria || 0);
    if (!grupo || !Number.isFinite(capacidade_diaria) || capacidade_diaria <= 0) continue;
    map.set(grupo, { grupo, tipo, capacidade_diaria });
  }
  const data = Array.from(map.values()).sort((a, b) => a.grupo.localeCompare(b.grupo));
  if (!data.length) {
    return res.status(400).json({ success: false, error: "Nenhum grupo válido para salvar" });
  }
  try {
    await writeGrupos(req.app.get("pool"), data);
  } catch (err) {
    console.error("[capacidade/grupos] gravacao falhou:", err.message);
    return res.status(500).json({ success: false, error: "Nao foi possivel salvar os grupos", details: err.message });
  }
  return res.status(201).json({ success: true, total: data.length, data });
});

router.get("/grupo-refs", auth, async (req, res) => {
  const data = await readGrupoRefs(req.app.get("pool"));
  return res.json({ success: true, total: data.length, data });
});

router.post("/grupo-refs", auth, async (req, res) => {
  const rows = Array.isArray(req.body?.data) ? req.body.data : [];
  if (!rows.length) {
    return res.status(400).json({ success: false, error: "data é obrigatório" });
  }
  const map = new Map();
  for (const row of rows) {
    const grupo = String(row?.grupo || "").trim().toUpperCase();
    const referencia = String(row?.referencia || row?.ref || "").trim().toUpperCase();
    if (!grupo || !referencia) continue;
    map.set(`${grupo}__${referencia}`, { grupo, referencia });
  }
  const data = Array.from(map.values()).sort((a, b) => (a.grupo + a.referencia).localeCompare(b.grupo + b.referencia));
  if (!data.length) {
    return res.status(400).json({ success: false, error: "Nenhum vínculo grupo/ref válido para salvar" });
  }
  try {
    await writeGrupoRefs(req.app.get("pool"), data);
  } catch (err) {
    console.error("[capacidade/grupo-refs] gravacao falhou:", err.message);
    return res.status(500).json({ success: false, error: "Nao foi possivel salvar o mapeamento", details: err.message });
  }
  return res.status(201).json({ success: true, total: data.length, data });
});

router.get("/dias", auth, async (req, res) => {
  return res.json({ success: true, data: await readDias(req.app.get("pool")) });
});

router.post("/dias", auth, async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const data = {};
  for (let mes = 1; mes <= 12; mes += 1) {
    const key = String(mes);
    const value = Number(body[key] || 0);
    data[key] = Number.isFinite(value) && value >= 0 ? value : 0;
  }
  try {
    await writeDias(req.app.get("pool"), data);
  } catch (err) {
    console.error("[capacidade/dias] gravacao falhou:", err.message);
    return res.status(500).json({ success: false, error: "Nao foi possivel salvar os dias", details: err.message });
  }
  return res.status(201).json({ success: true, data });
});

router.get("/tempos-ref", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const referenciaFiltro = String(req.query.idreferencia || req.query.referencia || "").trim().toUpperCase();
    const idreferencias = parseListQuery(req.query.idreferencias);
    const referencias = parseListQuery(req.query.referencias);
    const includeDiagnostico = req.query.diagnostico === "true";
    const result = await queryTempoBaseRows(pool, referenciaFiltro
      ? { idreferencia: referenciaFiltro }
      : { idreferencias, referencias });

    const map = new Map();
    const debugMap = includeDiagnostico ? new Map() : null;
    for (const row of result.rows || []) {
      const idreferencia = String(row.idreferencia || "").trim().toUpperCase();
      const referenciaPadrao = String(row.referencia_padrao || "").trim().toUpperCase();
      if (!idreferencia) continue;
      const base = resolveTempoLikePowerBi(row.hr_tempo, row.hr_tempopadrao);
      const total = Number.isFinite(base) ? base : 0;
      const atual = map.get(idreferencia) || { idreferencia, referencia_padrao: referenciaPadrao, tempo_segundos: 0 };
      atual.tempo_segundos += total;
      if (!atual.referencia_padrao && referenciaPadrao) atual.referencia_padrao = referenciaPadrao;
      map.set(idreferencia, atual);
      if (!debugMap) continue;
      if (!debugMap.has(idreferencia)) {
        debugMap.set(idreferencia, {
          idreferencia,
          referencia_padrao: referenciaPadrao,
          operacoes: 0,
          operacoes_com_tempo: 0,
          tipos_operacao: new Set(),
        });
      }
      const dbg = debugMap.get(idreferencia);
      if (!dbg.referencia_padrao && referenciaPadrao) dbg.referencia_padrao = referenciaPadrao;
      dbg.operacoes += 1;
      if (total > 0) dbg.operacoes_com_tempo += 1;
      if (row.ds_tipooperacao) dbg.tipos_operacao.add(String(row.ds_tipooperacao || '').trim().toUpperCase());
    }

    const data = Array.from(map.values())
      .sort((a, b) => a.idreferencia.localeCompare(b.idreferencia));

    const payload = { success: true, total: data.length, data };
    if (debugMap) {
      payload.diagnostico = Array.from(debugMap.values()).map((row) => ({
        idreferencia: row.idreferencia,
        referencia_padrao: row.referencia_padrao || '',
        operacoes: row.operacoes,
        operacoes_com_tempo: row.operacoes_com_tempo,
        tipos_operacao: Array.from(row.tipos_operacao).sort(),
      }));
    }

    return res.json(payload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar tempos por referência",
      details: error.message,
    });
  }
});

/**
 * GET /api/capacidade/tempos-por-grupo
 *
 * Tempo de costura MEDIDO, agregado por grupo de produto (SUTIA, CALCA, TOP, ...).
 *
 * Existe para um problema concreto: produto que a fabrica ainda nao faz nao tem tempo
 * cadastrado, e sem tempo nao da para dizer se ele cabe na capacidade. A saida que estava
 * em uso era digitar um minuto por peca no olho — e a dispersao medida aqui mostra por que
 * isso e frageil: CALCA da 5,48 min/peca e SUTIA da 10,78, o dobro. Errar o grupo erra a
 * resposta inteira.
 *
 * Com esta rota, em vez de inventar o minuto, aponta-se o produto novo para um grupo que a
 * fabrica JA produz e usa-se o tempo dele. Vira premissa rastreavel ("igual a um TOP, 8,61
 * min/peca medido em 7 referencias") em vez de um numero sem origem.
 *
 * O grupo sai da matriz de planejamento (`produto.grupo`) e o tempo da mesma resolucao que
 * todo o resto da tela de capacidade usa (`resolveTempoLikePowerBi`), para nao nascer uma
 * segunda verdade sobre tempo no sistema.
 */
router.get('/tempos-por-grupo', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    const { readCache } = require('../cache/matrizCache');

    const matrizCache = await readCache();
    const matrizRows = Array.isArray(matrizCache?.data?.rows) ? matrizCache.data.rows : [];

    // idreferencia -> grupo. Primeira ocorrencia vence: a referencia e a mesma peca em
    // varias cores e tamanhos, e todas compartilham grupo.
    const grupoPorIdRef = new Map();
    for (const item of matrizRows) {
      const idref = String(item?.produto?.cd_seqgrupo || '').trim().toUpperCase();
      if (!idref || grupoPorIdRef.has(idref)) continue;
      const grupo = String(item?.produto?.grupo || '').trim().toUpperCase();
      grupoPorIdRef.set(idref, grupo || '(SEM GRUPO)');
    }
    if (!grupoPorIdRef.size) {
      return res.json({ success: true, total: 0, data: [], aviso: 'Matriz vazia no cache.' });
    }

    const temposResult = await queryTempoBaseRows(pool, { idreferencias: [...grupoPorIdRef.keys()] });
    const tempoPorIdRef = new Map();
    for (const row of temposResult.rows || []) {
      const idref = String(row.idreferencia || '').trim().toUpperCase();
      if (!idref) continue;
      const base = resolveTempoLikePowerBi(row.hr_tempo, row.hr_tempopadrao);
      tempoPorIdRef.set(idref, (tempoPorIdRef.get(idref) || 0) + (Number.isFinite(base) ? base : 0));
    }

    const porGrupo = new Map();
    for (const [idref, tempo] of tempoPorIdRef) {
      // Referencia sem tempo nao entra na media: ela puxaria o grupo para baixo dizendo
      // "esta peca leva zero minuto", quando o que houve foi falta de cadastro.
      if (!(tempo > 0)) continue;
      const grupo = grupoPorIdRef.get(idref) || '(SEM GRUPO)';
      const acc = porGrupo.get(grupo) || { grupo, referencias: 0, soma: 0, tempos: [] };
      acc.referencias += 1;
      acc.soma += tempo;
      acc.tempos.push(tempo);
      porGrupo.set(grupo, acc);
    }

    const data = [...porGrupo.values()]
      .map((g) => {
        const ordenados = g.tempos.slice().sort((a, b) => a - b);
        return {
          grupo: g.grupo,
          referencias: g.referencias,
          min_peca_medio: Number((g.soma / g.referencias).toFixed(2)),
          min_peca_mediana: Number(ordenados[Math.floor(ordenados.length / 2)].toFixed(2)),
          min_peca_minimo: Number(ordenados[0].toFixed(2)),
          min_peca_maximo: Number(ordenados[ordenados.length - 1].toFixed(2)),
        };
      })
      .sort((a, b) => b.referencias - a.referencias);

    const totalRefs = data.reduce((acc, g) => acc + g.referencias, 0);
    const somaGeral = data.reduce((acc, g) => acc + g.min_peca_medio * g.referencias, 0);

    return res.json({
      success: true,
      total: data.length,
      referencias: totalRefs,
      min_peca_geral: totalRefs > 0 ? Number((somaGeral / totalRefs).toFixed(2)) : 0,
      data,
    });
  } catch (error) {
    console.error('[capacidade/tempos-por-grupo] Erro:', error);
    return res.status(500).json({ success: false, error: 'Erro ao agregar tempos por grupo', details: error.message });
  }
});

router.get("/tempo-debug", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const idreferencia = String(req.query.idreferencia || "").trim().toUpperCase();
    const referencia = String(req.query.referencia || "").trim().toUpperCase();
    if (!idreferencia && !referencia) {
      return res.status(400).json({ success: false, error: "Informe idreferencia ou referencia" });
    }

    const result = await queryTempoBaseRows(pool, { idreferencia, referencia });

    let total = 0;
    const data = (result.rows || []).map((row) => {
      const tempo_resolvido = resolveTempoLikePowerBi(row.hr_tempo, row.hr_tempopadrao);
      total += tempo_resolvido;
      return {
        idreferencia: String(row.idreferencia || "").trim().toUpperCase(),
        referencia_padrao: String(row.referencia_padrao || "").trim().toUpperCase(),
        cd_operacao: String(row.cd_operacao || "").trim(),
        ds_operacao: String(row.ds_operacao || "").trim(),
        cd_tipooperacao: String(row.cd_tipooperacao || "").trim(),
        ds_tipooperacao: String(row.ds_tipooperacao || "").trim().toUpperCase(),
        qt_operacao: Number(row.qt_operacao || 0),
        hr_tempo: String(row.hr_tempo || "").trim(),
        hr_tempopadrao: String(row.hr_tempopadrao || "").trim(),
        tempo_resolvido,
      };
    });

    return res.json({
      success: true,
      total: data.length,
      tempo_total: total,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao consultar depuração do tempo",
      details: error.message,
    });
  }
});

router.get("/config", auth, async (req, res) => {
  return res.json({
    success: true,
    data: {
      grupos: await readGrupos(req.app.get("pool")),
      grupo_refs: await readGrupoRefs(req.app.get("pool")),
      dias: await readDias(req.app.get("pool")),
    },
  });
});

// Minutos realmente produzidos por grupo. Meses fechados usam o cache diário;
// o mês atual usa os movimentos do ERP até ontem.
// ── GET /api/capacidade/min-peca-medido ─────────────────────────────────────────
// MINUTOS POR PECA QUE A FABRICA DE FATO GASTA.
//
// A capacidade em PECAS saia de `cargaDemanda / demanda` — o mix da projecao de cada mes.
// Isso fazia o teto da fabrica andar junto com a projecao: medido em 05/11/2026, a tela
// usava 7,13 min/peca em dez/26 e 5,86 no MESMO mes de 2027, e 5,60 em fev/27. A faixa que
// a fabrica realmente pratica e 6,38 a 6,68. Ou seja, a "capacidade" variava 27% por causa
// do que se planeja VENDER, e os dois extremos estavam fora de tudo que ela ja entregou.
//
// Aqui o numero e medido, pelas MESMAS duas fontes que ja sustentam o resto da conta:
//   minutos — `pcp_cache_eficiencia_dia`, a mesma do nivel de capacidade
//   pecas   — `vr_cdf_movopi` com tp_historicomov = 51, a mesma que a rota /real usa para
//             o mes corrente (ali o campo `pecas` existe; nos meses fechados vinha zerado)
//
// Janela: os meses FECHADOS mais recentes (3 por padrao), nas mesmas celulas de capacidade.
// Medido em 05/11/2026 sobre ago-out: 3.359.751 min / 512.422 pecas = 6,56 min/peca.
router.get("/min-peca-medido", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    if (!pool) return res.status(500).json({ success: false, error: "Pool de conexão não disponível" });
    const meses = Math.min(12, Math.max(1, Number(req.query.meses) || 3));
    const ids = DEFAULT_REAL_GROUP_IDS.map(String);
    const r = await pool.query(`
      WITH janela AS (
        SELECT DATE_TRUNC('month', CURRENT_DATE)::date AS fim,
               (DATE_TRUNC('month', CURRENT_DATE) - ($2::int || ' months')::interval)::date AS ini
      ),
      min_mes AS (
        SELECT DATE_TRUNC('month', e.dt_ref)::date AS mes,
               SUM(COALESCE(e.tempo_produzido_min, 0))::float AS minutos
          FROM pcp_cache_eficiencia_dia e, janela j
         WHERE e.cd_grupo::text = ANY($1::text[])
           AND e.dt_ref >= j.ini AND e.dt_ref < j.fim
         GROUP BY 1
      ),
      pc_mes AS (
        SELECT DATE_TRUNC('month', m.dt_movimento)::date AS mes,
               SUM(COALESCE(m.qt_movimento, 0))::float AS pecas
          FROM vr_cdf_movopi m, janela j
         WHERE m.tp_historicomov = 51 AND m.in_estorno = 'F'
           AND m.cd_localorigem::text = ANY($1::text[])
           AND m.dt_movimento >= j.ini AND m.dt_movimento < j.fim
         GROUP BY 1
      )
      SELECT mm.mes, mm.minutos, COALESCE(pm.pecas, 0)::float AS pecas
        FROM min_mes mm LEFT JOIN pc_mes pm USING (mes)
       ORDER BY mm.mes
    `, [ids, meses]);

    const porMes = r.rows.map((x) => ({
      mes: (x.mes instanceof Date ? x.mes.toISOString() : String(x.mes)).slice(0, 7),
      minutos: Number(x.minutos) || 0,
      pecas: Number(x.pecas) || 0,
      minPeca: Number(x.pecas) > 0 ? Number((Number(x.minutos) / Number(x.pecas)).toFixed(4)) : null,
    }));
    const minutos = porMes.reduce((s, x) => s + x.minutos, 0);
    const pecas = porMes.reduce((s, x) => s + x.pecas, 0);
    // Razao das SOMAS, nao media das razoes: o mes grande tem que pesar mais que o pequeno.
    const minPeca = pecas > 0 ? Number((minutos / pecas).toFixed(4)) : null;
    res.json({ success: true, minPeca, minutos, pecas, meses: porMes });
  } catch (err) {
    console.error("[capacidade] min-peca-medido:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/real", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const hoje = new Date();
    const inicioPadrao = new Date(hoje.getFullYear(), hoje.getMonth() - 11, 1).toISOString().slice(0, 10);
    const de = String(req.query.de || inicioPadrao).slice(0, 10);
    const ate = String(req.query.ate || hoje.toISOString().slice(0, 10)).slice(0, 10);
    const grupos = parseListQuery(req.query.grupos).filter((value) => /^\d+$/.test(value));
    const gruposIds = (grupos.length ? grupos : DEFAULT_REAL_GROUP_IDS.map(String));

    const result = await pool.query(`
      WITH grupos_filtro (cd_local) AS (
        SELECT unnest($3::text[])
      ),
      cache_base AS (
        SELECT
          e.cd_grupo::text AS cd_grupo,
          DATE_TRUNC('month', e.dt_ref)::date AS mes,
          SUM(COALESCE(e.tempo_produzido_min, 0))::float AS minutos,
          COUNT(DISTINCT e.dt_ref) FILTER (WHERE COALESCE(e.tempo_produzido_min, 0) > 0)::int AS dias_com_movimento,
          0::float AS pecas
        FROM pcp_cache_eficiencia_dia e
        JOIN grupos_filtro gf ON gf.cd_local = e.cd_grupo::text
        WHERE e.dt_ref >= $1::date
          AND e.dt_ref < $2::date
          AND e.dt_ref < DATE_TRUNC('month', CURRENT_DATE)::date
        GROUP BY e.cd_grupo, DATE_TRUNC('month', e.dt_ref)
      ),
      movimentos_atual AS (
        SELECT
          m.cd_localorigem::text AS cd_grupo,
          m.dt_movimento::date AS dt_ref,
          m.cd_produto,
          COALESCE(m.qt_movimento, 0)::float AS qt_movimento
        FROM vr_cdf_movopi m
        JOIN grupos_filtro gf ON gf.cd_local = m.cd_localorigem::text
        WHERE m.tp_historicomov = 51
          AND m.in_estorno = 'F'
          AND m.dt_movimento::date >= GREATEST($1::date, DATE_TRUNC('month', CURRENT_DATE)::date)
          AND m.dt_movimento::date < LEAST($2::date, CURRENT_DATE)
      ),
      tempo_padrao_atual AS (
        SELECT
          p.cd_produto,
          SUM(COALESCE(NULLIF(s.hr_tempo, 0), o.hr_tempopadrao * 1440))::float AS minutos
        FROM mv_prd_referencia_produto p
        JOIN vr_cdf_seqope s ON s.cd_seqgrupo = p.cd_seqgrupo
        JOIN vr_cdf_operac o ON o.cd_operacao = s.cd_operacao
        WHERE o.cd_tipooperacao IN (1, 3, 4)
          AND p.cd_produto IN (SELECT DISTINCT cd_produto FROM movimentos_atual)
        GROUP BY p.cd_produto
      ),
      atual_base AS (
        SELECT
          mv.cd_grupo,
          DATE_TRUNC('month', mv.dt_ref)::date AS mes,
          SUM(mv.qt_movimento * COALESCE(tp.minutos, 0))::float AS minutos,
          COUNT(DISTINCT mv.dt_ref) FILTER (WHERE mv.qt_movimento > 0)::int AS dias_com_movimento,
          SUM(mv.qt_movimento)::float AS pecas
        FROM movimentos_atual mv
        LEFT JOIN tempo_padrao_atual tp ON tp.cd_produto = mv.cd_produto
        GROUP BY mv.cd_grupo, DATE_TRUNC('month', mv.dt_ref)
      ),
      base AS (
        SELECT * FROM cache_base
        UNION ALL
        SELECT * FROM atual_base
      )
      SELECT
        COALESCE(l.ds_local, b.cd_grupo)::text AS grupo,
        b.cd_grupo,
        b.mes,
        ROUND(SUM(b.minutos)::numeric, 2)::float AS minutos_trabalhados,
        SUM(b.dias_com_movimento)::int AS dias_com_movimento,
        SUM(b.pecas)::float AS pecas
      FROM base b
      LEFT JOIN pcp_cache_locais l ON l.cd_local::text = b.cd_grupo
      GROUP BY l.ds_local, b.cd_grupo, b.mes
      ORDER BY b.mes, grupo
    `, [de, ate, gruposIds]);

    return res.json({
      success: true,
      de,
      ate,
      grupos: gruposIds,
      data: result.rows.map((row) => ({
        grupo: String(row.grupo || '').trim(),
        cdGrupo: String(row.cd_grupo || '').trim(),
        mes: row.mes,
        minutosTrabalhados: Number(row.minutos_trabalhados || 0),
        diasComMovimento: Number(row.dias_com_movimento || 0),
        pecas: Number(row.pecas || 0),
      })),
    });
  } catch (error) {
    console.error('[capacidade/real] Erro:', error);
    return res.status(500).json({ success: false, error: 'Erro ao consultar capacidade real', details: error.message });
  }
});

// ── GET /api/capacidade/matriz ─────────────────────────────────────────────────
// Endpoint otimizado que retorna a matriz de capacidade já calculada
// Faz todos os cálculos no backend para melhor performance
router.get("/matriz", auth, async (req, res) => {
  try {
    const pool = req.app.get("pool");
    const { readCache } = require('../cache/matrizCache');
    const projecoesService = require('../services/projecoesService');

    // 1. Carregar todas as configurações em paralelo
    const grupos = await readGrupos(req.app.get("pool"));
    const grupoRefs = await readGrupoRefs(pool);
    const dias = await readDias(req.app.get("pool"));
    const fonteCapacidade = ['planilha', 'ultimo_mes', 'media_12_meses'].includes(String(req.query.fonte_capacidade || '').toLowerCase())
      ? String(req.query.fonte_capacidade).toLowerCase()
      : 'planilha';
    const capacidadeReal = fonteCapacidade === 'planilha' ? [] : await queryRealCapacityReferences(pool);
    const locaisResult = capacidadeReal.length > 0
      ? await pool.query(`SELECT cd_local::text AS cd_local, ds_local::text AS ds_local FROM pcp_cache_locais WHERE cd_local::text = ANY($1::text[])`, [capacidadeReal.map((row) => row.cdGrupo)])
      : { rows: [] };
    const nomePorLocal = new Map(locaisResult.rows.map((row) => [String(row.cd_local).trim(), String(row.ds_local || '').trim().toUpperCase()]));
    const capacidadeRealPorGrupo = new Map();
    for (const row of capacidadeReal) {
      const valor = fonteCapacidade === 'ultimo_mes' ? row.ultimoMes : row.media12m;
      const nome = nomePorLocal.get(row.cdGrupo);
      if (nome && valor > 0) capacidadeRealPorGrupo.set(nome, valor);
    }

    // 2. Carregar tempos por referência
    const temposResult = await queryTempoBaseRows(pool, {});
    const tempoPorRef = new Map();
    for (const row of temposResult.rows || []) {
      const idreferencia = String(row.idreferencia || "").trim().toUpperCase();
      if (!idreferencia) continue;
      const base = resolveTempoLikePowerBi(row.hr_tempo, row.hr_tempopadrao);
      const total = Number.isFinite(base) ? base : 0;
      const atual = tempoPorRef.get(idreferencia) || 0;
      tempoPorRef.set(idreferencia, atual + total);
    }

    // 3. Carregar matriz da cache
    const matrizCache = await readCache();
    const matrizRows = Array.isArray(matrizCache?.data?.rows)
      ? matrizCache.data.rows
      : (Array.isArray(matrizCache?.data?.data) ? matrizCache.data.data : []);

    // 4. Carregar projeções
    const anoAtual = new Date().getFullYear();
    let projecoes = {};
    try {
      projecoes = await projecoesService.lerProjecoesMultiplosAnos(pool, [anoAtual, anoAtual + 1]);
    } catch { /* silencioso */ }

    // 5. Calcular períodos
    const periodos = calcularPeriodosPlano().meses;

    // 6. Criar mapa de planos por referência (agregado da matriz)
    const planoPorRefMap = new Map();
    const processoPorRefMap = new Map();
    const seqgrupoPorRefMap = new Map();

    for (const item of matrizRows) {
      const marca = String(item?.produto?.marca || '').trim().toUpperCase();
      const status = String(item?.produto?.status || '').trim().toUpperCase();
      const descricao = String(item?.produto?.produto || '').trim().toUpperCase();

      // Filtro de marca e status
      if (marca !== 'LIEBE') continue;
      if (!['EM LINHA', 'NOVA COLECAO'].includes(status)) continue;
      if (descricao.includes('MEIA DE SEDA')) continue;

      const refPadrao = String(item?.produto?.referencia || '').trim().toUpperCase();
      const refSistema = String(item?.produto?.cd_seqgrupo || '').trim().toUpperCase();
      const emProcesso = Number(item?.estoques?.em_processo || 0);
      const planoMA = Number(item?.plano?.ma || 0);
      const planoPX = Number(item?.plano?.px || 0);
      const planoUL = Number(item?.plano?.ul || 0);
      const planoQT = Number(item?.plano?.qt || 0);
      const planoQU = Number(item?.plano?.qu || 0);
      const planoSX = Number(item?.plano?.sx || 0);

      // Agregar por referência
      for (const chave of [refPadrao, refSistema]) {
        if (!chave) continue;
        const atual = planoPorRefMap.get(chave) || { ma: 0, px: 0, ul: 0, qt: 0, qu: 0, sx: 0 };
        atual.ma += planoMA;
        atual.px += planoPX;
        atual.ul += planoUL;
        atual.qt += planoQT;
        atual.qu += planoQU;
        atual.sx += planoSX;
        planoPorRefMap.set(chave, atual);

        const processoAtual = processoPorRefMap.get(chave) || 0;
        processoPorRefMap.set(chave, processoAtual + emProcesso);
      }

      // Mapear seqgrupo
      if (refPadrao && refSistema && !seqgrupoPorRefMap.has(refPadrao)) {
        seqgrupoPorRefMap.set(refPadrao, refSistema);
      }
    }

    // 7. Criar mapa de capacidade por grupo
    const capacidadePorGrupo = new Map();
    for (const g of grupos) {
      capacidadePorGrupo.set(g.grupo.toUpperCase(), g.capacidade_diaria);
    }

    // 8. Criar mapa de grupos por referência (para rateio)
    const gruposPorRef = new Map();
    for (const row of grupoRefs) {
      const ref = row.referencia.toUpperCase();
      const grupo = row.grupo.toUpperCase();
      const atual = gruposPorRef.get(ref) || [];
      if (!atual.includes(grupo)) atual.push(grupo);
      gruposPorRef.set(ref, atual);
    }

    // 9. Calcular detalhes por referência dentro de cada grupo
    const detalhesPorGrupo = new Map();

    for (const row of grupoRefs) {
      const referencia = row.referencia.toUpperCase();
      const grupo = row.grupo.toUpperCase();
      const idreferencia = seqgrupoPorRefMap.get(referencia) || '';
      const planoBase = planoPorRefMap.get(referencia) || { ma: 0, px: 0, ul: 0, qt: 0, qu: 0, sx: 0 };
      const tempo = tempoPorRef.get(idreferencia) || 0;
      const processoBase = processoPorRefMap.get(referencia) || 0;
      const gruposDaRef = gruposPorRef.get(referencia) || [];

      // Calcular rateio
      const capacidadeTotalRateio = gruposDaRef.reduce((acc, g) => acc + (capacidadePorGrupo.get(g) || 0), 0);
      const capacidadeGrupoAtual = capacidadePorGrupo.get(grupo) || 0;
      const rateio = gruposDaRef.length <= 1
        ? 1
        : (capacidadeTotalRateio > 0 ? (capacidadeGrupoAtual / capacidadeTotalRateio) : (1 / gruposDaRef.length));

      // Aplicar rateio aos planos
      const plano = {
        ma: planoBase.ma * rateio,
        px: planoBase.px * rateio,
        ul: planoBase.ul * rateio,
        qt: planoBase.qt * rateio,
        qu: planoBase.qu * rateio,
        sx: planoBase.sx * rateio,
      };
      const processoPecas = processoBase * rateio;
      const processoCarga = tempo * processoPecas;

      const detalhe = {
        referencia,
        idreferencia,
        rateio: Number((rateio * 100).toFixed(2)),
        tempo: Number(tempo.toFixed(2)),
        processoPecas: Math.round(processoPecas),
        processoCarga: Number(processoCarga.toFixed(2)),
        planoMA: Math.round(plano.ma),
        planoPX: Math.round(plano.px),
        planoUL: Math.round(plano.ul),
        planoQT: Math.round(plano.qt),
        planoQU: Math.round(plano.qu),
        planoSX: Math.round(plano.sx),
        cargaMA: Number((tempo * plano.ma).toFixed(2)),
        cargaPX: Number((tempo * plano.px).toFixed(2)),
        cargaUL: Number((tempo * plano.ul).toFixed(2)),
        cargaQT: Number((tempo * plano.qt).toFixed(2)),
        cargaQU: Number((tempo * plano.qu).toFixed(2)),
        cargaSX: Number((tempo * plano.sx).toFixed(2)),
        cargaTotal: Number((processoCarga + tempo * (plano.ma + plano.px + plano.ul + plano.qt + plano.qu + plano.sx)).toFixed(2)),
      };

      if (!detalhesPorGrupo.has(grupo)) detalhesPorGrupo.set(grupo, []);
      detalhesPorGrupo.get(grupo).push(detalhe);
    }

    // 10. Calcular análise por grupo
    const gruposAnalise = [];
    let totalGeral = {
      grupos: 0,
      refs: 0,
      refsComTempo: 0,
      capacidadeDiaria: 0,
      processoPecas: 0,
      processoCarga: 0,
      planoMA: 0, planoPX: 0, planoUL: 0, planoQT: 0, planoQU: 0, planoSX: 0,
      cargaMA: 0, cargaPX: 0, cargaUL: 0, cargaQT: 0, cargaQU: 0, cargaSX: 0,
      capacidadeMA: 0, capacidadePX: 0, capacidadeUL: 0, capacidadeQT: 0, capacidadeQU: 0, capacidadeSX: 0,
    };

    for (const g of grupos) {
      const grupo = g.grupo.toUpperCase();
      const refs = detalhesPorGrupo.get(grupo) || [];
      const capacidadeDiaria = capacidadeRealPorGrupo.get(grupo) || g.capacidade_diaria;

      // Capacidades por mês
      const capacidadeMA = capacidadeDiaria * (dias[String(periodos.MA)] || 0);
      const capacidadePX = capacidadeDiaria * (dias[String(periodos.PX)] || 0);
      const capacidadeUL = capacidadeDiaria * (dias[String(periodos.UL)] || 0);
      const capacidadeQT = capacidadeDiaria * (dias[String(periodos.QT)] || 0);
      const capacidadeQU = capacidadeDiaria * (dias[String(periodos.QU)] || 0);
      const capacidadeSX = capacidadeDiaria * (dias[String(periodos.SX)] || 0);

      // Somar referências
      const processoPecas = refs.reduce((acc, r) => acc + r.processoPecas, 0);
      const processoCarga = refs.reduce((acc, r) => acc + r.processoCarga, 0);
      const planoMA = refs.reduce((acc, r) => acc + r.planoMA, 0);
      const planoPX = refs.reduce((acc, r) => acc + r.planoPX, 0);
      const planoUL = refs.reduce((acc, r) => acc + r.planoUL, 0);
      const planoQT = refs.reduce((acc, r) => acc + r.planoQT, 0);
      const planoQU = refs.reduce((acc, r) => acc + r.planoQU, 0);
      const planoSX = refs.reduce((acc, r) => acc + r.planoSX, 0);
      const cargaMAPlano = refs.reduce((acc, r) => acc + r.cargaMA, 0);
      const cargaMA = cargaMAPlano + processoCarga; // Processo entra em MA
      const cargaPX = refs.reduce((acc, r) => acc + r.cargaPX, 0);
      const cargaUL = refs.reduce((acc, r) => acc + r.cargaUL, 0);
      const cargaQT = refs.reduce((acc, r) => acc + r.cargaQT, 0);
      const cargaQU = refs.reduce((acc, r) => acc + r.cargaQU, 0);
      const cargaSX = refs.reduce((acc, r) => acc + r.cargaSX, 0);
      const refsComTempo = refs.filter(r => r.tempo > 0).length;

      // Saldos
      const saldoMA = capacidadeMA - cargaMA;
      const saldoPX = capacidadePX - cargaPX;
      const saldoUL = capacidadeUL - cargaUL;
      const saldoQT = capacidadeQT - cargaQT;
      const saldoQU = capacidadeQU - cargaQU;
      const saldoSX = capacidadeSX - cargaSX;

      // Saldos acumulados
      const saldoAcumMA = saldoMA;
      const saldoAcumPX = saldoAcumMA + saldoPX;
      const saldoAcumUL = saldoAcumPX + saldoUL;
      const saldoAcumQT = saldoAcumUL + saldoQT;
      const saldoAcumQU = saldoAcumQT + saldoQU;
      const saldoAcumSX = saldoAcumQU + saldoSX;

      // Atendimento (%)
      const atendimentoMA = cargaMA > 0 ? Math.min(100, (capacidadeMA / cargaMA) * 100) : 100;
      const atendimentoPX = cargaPX > 0 ? Math.min(100, ((Math.max(0, saldoAcumMA) + capacidadePX) / cargaPX) * 100) : 100;
      const atendimentoUL = cargaUL > 0 ? Math.min(100, ((Math.max(0, saldoAcumPX) + capacidadeUL) / cargaUL) * 100) : 100;
      const atendimentoQT = cargaQT > 0 ? Math.min(100, ((Math.max(0, saldoAcumUL) + capacidadeQT) / cargaQT) * 100) : 100;
      const atendimentoQU = cargaQU > 0 ? Math.min(100, ((Math.max(0, saldoAcumQT) + capacidadeQU) / cargaQU) * 100) : 100;
      const atendimentoSX = cargaSX > 0 ? Math.min(100, ((Math.max(0, saldoAcumQU) + capacidadeSX) / cargaSX) * 100) : 100;

      // Dias necessários
      const diasNecMA = capacidadeDiaria > 0 ? cargaMA / capacidadeDiaria : 0;
      const diasNecPX = capacidadeDiaria > 0 ? cargaPX / capacidadeDiaria : 0;
      const diasNecUL = capacidadeDiaria > 0 ? cargaUL / capacidadeDiaria : 0;
      const diasNecQT = capacidadeDiaria > 0 ? cargaQT / capacidadeDiaria : 0;
      const diasNecQU = capacidadeDiaria > 0 ? cargaQU / capacidadeDiaria : 0;
      const diasNecSX = capacidadeDiaria > 0 ? cargaSX / capacidadeDiaria : 0;

      // Dias faltantes
      const diasFaltMA = Math.max(0, diasNecMA - (dias[String(periodos.MA)] || 0));
      const diasFaltPX = Math.max(0, diasNecPX - (dias[String(periodos.PX)] || 0) - Math.max(0, saldoAcumMA / Math.max(1, capacidadeDiaria)));
      const diasFaltUL = Math.max(0, diasNecUL - (dias[String(periodos.UL)] || 0) - Math.max(0, saldoAcumPX / Math.max(1, capacidadeDiaria)));
      const diasFaltQT = Math.max(0, diasNecQT - (dias[String(periodos.QT)] || 0) - Math.max(0, saldoAcumUL / Math.max(1, capacidadeDiaria)));
      const diasFaltQU = Math.max(0, diasNecQU - (dias[String(periodos.QU)] || 0) - Math.max(0, saldoAcumQT / Math.max(1, capacidadeDiaria)));
      const diasFaltSX = Math.max(0, diasNecSX - (dias[String(periodos.SX)] || 0) - Math.max(0, saldoAcumQU / Math.max(1, capacidadeDiaria)));

      const cargaTotal = cargaMA + cargaPX + cargaUL + cargaQT + cargaQU + cargaSX;
      const capacidadeTotal = capacidadeMA + capacidadePX + capacidadeUL + capacidadeQT + capacidadeQU + capacidadeSX;

      gruposAnalise.push({
        grupo,
        tipo: g.tipo || '-',
        capacidadeDiaria,
        refs: refs.length,
        refsComTempo,
        referencias: refs, // Incluir detalhes das referências
        processoPecas,
        processoCarga: Number(processoCarga.toFixed(2)),
        planoMA, planoPX, planoUL, planoQT, planoQU, planoSX,
        cargaMA: Number(cargaMA.toFixed(2)),
        cargaPX: Number(cargaPX.toFixed(2)),
        cargaUL: Number(cargaUL.toFixed(2)),
        cargaQT: Number(cargaQT.toFixed(2)),
        cargaQU: Number(cargaQU.toFixed(2)),
        cargaSX: Number(cargaSX.toFixed(2)),
        cargaTotal: Number(cargaTotal.toFixed(2)),
        capacidadeMA, capacidadePX, capacidadeUL, capacidadeQT, capacidadeQU, capacidadeSX,
        capacidadeTotal,
        saldoMA: Number(saldoMA.toFixed(2)),
        saldoPX: Number(saldoPX.toFixed(2)),
        saldoUL: Number(saldoUL.toFixed(2)),
        saldoQT: Number(saldoQT.toFixed(2)),
        saldoQU: Number(saldoQU.toFixed(2)),
        saldoSX: Number(saldoSX.toFixed(2)),
        saldoAcumMA: Number(saldoAcumMA.toFixed(2)),
        saldoAcumPX: Number(saldoAcumPX.toFixed(2)),
        saldoAcumUL: Number(saldoAcumUL.toFixed(2)),
        saldoAcumQT: Number(saldoAcumQT.toFixed(2)),
        saldoAcumQU: Number(saldoAcumQU.toFixed(2)),
        saldoAcumSX: Number(saldoAcumSX.toFixed(2)),
        atendimentoMA: Number(atendimentoMA.toFixed(1)),
        atendimentoPX: Number(atendimentoPX.toFixed(1)),
        atendimentoUL: Number(atendimentoUL.toFixed(1)),
        atendimentoQT: Number(atendimentoQT.toFixed(1)),
        atendimentoQU: Number(atendimentoQU.toFixed(1)),
        atendimentoSX: Number(atendimentoSX.toFixed(1)),
        diasNecMA: Number(diasNecMA.toFixed(2)),
        diasNecPX: Number(diasNecPX.toFixed(2)),
        diasNecUL: Number(diasNecUL.toFixed(2)),
        diasNecQT: Number(diasNecQT.toFixed(2)),
        diasNecQU: Number(diasNecQU.toFixed(2)),
        diasNecSX: Number(diasNecSX.toFixed(2)),
        diasFaltMA: Number(diasFaltMA.toFixed(2)),
        diasFaltPX: Number(diasFaltPX.toFixed(2)),
        diasFaltUL: Number(diasFaltUL.toFixed(2)),
        diasFaltQT: Number(diasFaltQT.toFixed(2)),
        diasFaltQU: Number(diasFaltQU.toFixed(2)),
        diasFaltSX: Number(diasFaltSX.toFixed(2)),
        estourado: saldoAcumMA < 0 || saldoAcumPX < 0 || saldoAcumUL < 0 || saldoAcumQT < 0 || saldoAcumQU < 0 || saldoAcumSX < 0,
      });

      // Atualizar totais
      totalGeral.grupos++;
      totalGeral.refs += refs.length;
      totalGeral.refsComTempo += refsComTempo;
      totalGeral.capacidadeDiaria += capacidadeDiaria;
      totalGeral.processoPecas += processoPecas;
      totalGeral.processoCarga += processoCarga;
      totalGeral.planoMA += planoMA;
      totalGeral.planoPX += planoPX;
      totalGeral.planoUL += planoUL;
      totalGeral.planoQT += planoQT;
      totalGeral.planoQU += planoQU;
      totalGeral.planoSX += planoSX;
      totalGeral.cargaMA += cargaMA;
      totalGeral.cargaPX += cargaPX;
      totalGeral.cargaUL += cargaUL;
      totalGeral.cargaQT += cargaQT;
      totalGeral.cargaQU += cargaQU;
      totalGeral.cargaSX += cargaSX;
      totalGeral.capacidadeMA += capacidadeMA;
      totalGeral.capacidadePX += capacidadePX;
      totalGeral.capacidadeUL += capacidadeUL;
      totalGeral.capacidadeQT += capacidadeQT;
      totalGeral.capacidadeQU += capacidadeQU;
      totalGeral.capacidadeSX += capacidadeSX;
    }

    // Ordenar por grupo
    gruposAnalise.sort((a, b) => a.grupo.localeCompare(b.grupo));

    // Arredondar totais
    totalGeral.processoCarga = Number(totalGeral.processoCarga.toFixed(2));
    totalGeral.cargaMA = Number(totalGeral.cargaMA.toFixed(2));
    totalGeral.cargaPX = Number(totalGeral.cargaPX.toFixed(2));
    totalGeral.cargaUL = Number(totalGeral.cargaUL.toFixed(2));
    totalGeral.cargaQT = Number(totalGeral.cargaQT.toFixed(2));
    totalGeral.cargaQU = Number(totalGeral.cargaQU.toFixed(2));
    totalGeral.cargaSX = Number(totalGeral.cargaSX.toFixed(2));

    return res.json({
      success: true,
      periodos,
      dias,
      fonteCapacidade,
      grupos: gruposAnalise,
      resumo: totalGeral,
    });
  } catch (error) {
    console.error('[capacidade/matriz] Erro:', error);
    return res.status(500).json({
      success: false,
      error: "Erro ao calcular matriz de capacidade",
      details: error.message,
    });
  }
});

// Capacidade diaria REAL por grupo, medida no ERP: minutos trabalhados / dias com movimento.
// O `capacidade_diaria` do arquivo de config esta em outra escala (soma 8,6 milhoes contra
// ~58 mil medidos) e so serve de fallback quando nao ha medicao no periodo. A tela de
// Capacidade ja decide assim; este helper existe para o backend nao divergir dela.
// fonte 'ultimo_mes' (padrao da tela) usa so o ultimo mes fechado; 'media' usa todo o periodo.
async function consultarCapacidadeRealPorGrupo(pool, de, ate, fonte = 'ultimo_mes') {
  const real = await pool.query(`
    WITH grupos_filtro (cd_local) AS (SELECT unnest($3::text[])),
    cache_base AS (
      SELECT e.cd_grupo::text AS cd_grupo,
             DATE_TRUNC('month', e.dt_ref)::date AS mes,
             SUM(COALESCE(e.tempo_produzido_min, 0))::float AS minutos,
             COUNT(DISTINCT e.dt_ref) FILTER (WHERE COALESCE(e.tempo_produzido_min, 0) > 0)::int AS dias_com_movimento
        FROM pcp_cache_eficiencia_dia e
        JOIN grupos_filtro gf ON gf.cd_local = e.cd_grupo::text
       WHERE e.dt_ref >= $1::date AND e.dt_ref < $2::date
         AND e.dt_ref < DATE_TRUNC('month', CURRENT_DATE)::date
       GROUP BY e.cd_grupo, DATE_TRUNC('month', e.dt_ref)
    )
    SELECT COALESCE(l.ds_local, b.cd_grupo)::text AS grupo,
           b.mes,
           SUM(b.minutos)::float AS minutos,
           SUM(b.dias_com_movimento)::int AS dias_com_movimento
      FROM cache_base b
      LEFT JOIN pcp_cache_locais l ON l.cd_local::text = b.cd_grupo
     GROUP BY l.ds_local, b.cd_grupo, b.mes
  `, [de, ate, DEFAULT_REAL_GROUP_IDS.map(String)]);

  const linhas = real.rows || [];
  const ultimoMes = linhas
    .map((row) => String(row.mes || '').slice(0, 10))
    .sort()
    .pop() || '';
  const consideradas = fonte === 'ultimo_mes'
    ? linhas.filter((row) => String(row.mes || '').slice(0, 10) === ultimoMes)
    : linhas;

  const acumulado = new Map();
  for (const row of consideradas) {
    const nome = String(row.grupo || '').trim().toUpperCase();
    if (!nome) continue;
    const atual = acumulado.get(nome) || { minutos: 0, dias: 0 };
    atual.minutos += Number(row.minutos || 0);
    atual.dias += Number(row.dias_com_movimento || 0);
    acumulado.set(nome, atual);
  }

  const mapa = new Map();
  acumulado.forEach((valores, nome) => {
    const media = valores.dias > 0 ? valores.minutos / valores.dias : 0;
    if (media > 0) mapa.set(nome, media);
  });
  return { porGrupo: mapa, ultimoMes };
}

// Soma a capacidade diaria dos grupos configurados, preferindo a medida real.
function somarCapacidadeDiaria(grupos, capacidadeRealPorGrupo) {
  const temMedicao = capacidadeRealPorGrupo.size > 0;
  let total = 0;
  for (const g of grupos) {
    const nome = String(g?.grupo || '').trim().toUpperCase();
    total += temMedicao
      ? Number(capacidadeRealPorGrupo.get(nome) || 0)
      : Number(g?.capacidade_diaria || 0);
  }
  return total;
}

// ── GET /api/capacidade/dias-resumo ─────────────────────────────────────────────
// Endpoint otimizado com cache de 5 minutos (sem autenticacao para uso no dashboard)
router.get("/dias-resumo", async (req, res) => {
  try {
    // Verificar cache (válido por 5 minutos)
    const forceRefresh = req.query.refresh === 'true';
    // PARADA DE FABRICA como CENARIO: `?ferias=1` desconta as ferias coletivas declaradas
    // em PARADAS dos dias disponiveis. O cache e por cenario — sem a chave, ligar o botao
    // devolvia a resposta sem ferias que ja estava guardada.
    const comParada = req.query.ferias === '1' || req.query.ferias === 'true';
    if (!forceRefresh && diasResumoCache.data && diasResumoCache.comParada === comParada
        && (Date.now() - diasResumoCache.timestamp) < DIAS_RESUMO_CACHE_TTL) {
      return res.json({ ...diasResumoCache.data, fromCache: true });
    }

    const pool = req.app.get("pool");
    const { readCache } = require('../cache/matrizCache');

    // 1. Carregar configurações
    const grupos = await readGrupos(req.app.get("pool"));
    const grupoRefs = await readGrupoRefs(pool);
    const dias = await readDias(req.app.get("pool"));

    // 2. Carregar tempos por referência
    const temposResult = await queryTempoBaseRows(pool, {});
    const tempoPorRef = new Map();
    for (const row of temposResult.rows || []) {
      const idreferencia = String(row.idreferencia || "").trim().toUpperCase();
      if (!idreferencia) continue;
      const base = resolveTempoLikePowerBi(row.hr_tempo, row.hr_tempopadrao);
      const total = Number.isFinite(base) ? base : 0;
      const atual = tempoPorRef.get(idreferencia) || 0;
      tempoPorRef.set(idreferencia, atual + total);
    }

    // 3. Carregar matriz da cache
    const matrizCache = await readCache();
    const matrizRows = Array.isArray(matrizCache?.data?.rows)
      ? matrizCache.data.rows
      : (Array.isArray(matrizCache?.data?.data) ? matrizCache.data.data : []);

    // 4. Calcular períodos
    const periodos = calcularPeriodosPlano().meses;

    // 5. Criar mapa de planos por referência (agregado da matriz)
    const planoPorRefMap = new Map();
    const processoPorRefMap = new Map();
    const seqgrupoPorRefMap = new Map();

    for (const item of matrizRows) {
      const marca = String(item?.produto?.marca || '').trim().toUpperCase();
      const status = String(item?.produto?.status || '').trim().toUpperCase();
      const descricao = String(item?.produto?.produto || '').trim().toUpperCase();

      if (marca !== 'LIEBE') continue;
      if (!['EM LINHA', 'NOVA COLECAO'].includes(status)) continue;
      if (descricao.includes('MEIA DE SEDA')) continue;

      const refPadrao = String(item?.produto?.referencia || '').trim().toUpperCase();
      const refSistema = String(item?.produto?.cd_seqgrupo || '').trim().toUpperCase();
      const emProcesso = Number(item?.estoques?.em_processo || 0);
      const planoMA = Number(item?.plano?.ma || 0);
      const planoPX = Number(item?.plano?.px || 0);
      const planoUL = Number(item?.plano?.ul || 0);
      const planoQT = Number(item?.plano?.qt || 0);
      const planoQU = Number(item?.plano?.qu || 0);

      for (const chave of [refPadrao, refSistema]) {
        if (!chave) continue;
        const atual = planoPorRefMap.get(chave) || { ma: 0, px: 0, ul: 0, qt: 0, qu: 0 };
        atual.ma += planoMA;
        atual.px += planoPX;
        atual.ul += planoUL;
        atual.qt += planoQT;
        atual.qu += planoQU;
        planoPorRefMap.set(chave, atual);

        const processoAtual = processoPorRefMap.get(chave) || 0;
        processoPorRefMap.set(chave, processoAtual + emProcesso);
      }

      if (refPadrao && refSistema && !seqgrupoPorRefMap.has(refPadrao)) {
        seqgrupoPorRefMap.set(refPadrao, refSistema);
      }
    }

    // 5b. Em processo POR PERIODO, pelo mes do lote. Sem isto a carga de processo ia
    // inteira para o MA enquanto as PECAS ja eram distribuidas, e os dois lados contavam
    // coisas diferentes: novembro ganhava pecas sem os minutos delas.
    const { mapa: processoPorRefPeriodo, ok: processoPorPeriodoOk } =
      await carregarProcessoPorRefPeriodo(pool, matrizRows, periodos);

    // 6. Criar mapa de capacidade por grupo
    const capacidadePorGrupo = new Map();
    for (const g of grupos) {
      capacidadePorGrupo.set(g.grupo.toUpperCase(), g.capacidade_diaria);
    }

    // 7. Criar mapa de grupos por referência
    const gruposPorRef = new Map();
    for (const row of grupoRefs) {
      const ref = row.referencia.toUpperCase();
      const grupo = row.grupo.toUpperCase();
      const atual = gruposPorRef.get(ref) || [];
      if (!atual.includes(grupo)) atual.push(grupo);
      gruposPorRef.set(ref, atual);
    }

    // 8. Calcular cargas totais
    // `processo` guarda o total (para o resumo) e `processoPorPeriodo` a abertura que vai
    // para os dias. Sem a abertura, tudo cai no MA, como era antes.
    let cargaTotal = {
      processo: 0,
      processoPorPeriodo: { MA: 0, PX: 0, UL: 0, QT: 0, QU: 0 },
      MA: 0, PX: 0, UL: 0, QT: 0, QU: 0,
    };
    const somarProcesso = (referencia, tempo, totalDaRef) => {
      cargaTotal.processo += tempo * totalDaRef;
      const abertura = processoPorPeriodoOk ? processoPorRefPeriodo.get(referencia) : null;
      if (!abertura) {
        cargaTotal.processoPorPeriodo.MA += tempo * totalDaRef;
        return;
      }
      for (const p of PERIODOS_LOTE) cargaTotal.processoPorPeriodo[p] += tempo * (abertura[p] || 0);
    };

    // Mesma janela padrao da tela de Capacidade (2 meses atras, dia 1 -> hoje), para o
    // "ultimo mes fechado" ser o mesmo dos dois lados.
    const hojeCap = new Date();
    const deCap = new Date(hojeCap.getFullYear(), hojeCap.getMonth() - 2, 1).toISOString().slice(0, 10);
    const ateCap = hojeCap.toISOString().slice(0, 10);
    const { porGrupo: capacidadeRealGrupos } = await consultarCapacidadeRealPorGrupo(pool, deCap, ateCap, 'ultimo_mes');
    const capacidadeDiariaTotal = somarCapacidadeDiaria(grupos, capacidadeRealGrupos);
    // Cenario anterior: os grupos descontinuados de volta na soma. O nivel/sazonalidade
    // correspondente sai do indice-mensal com ?cenario=anterior.
    const capacidadeDiariaTotalAnterior = somarCapacidadeDiaria([...grupos, ...GRUPOS_DESATIVADOS], capacidadeRealGrupos);

    for (const row of grupoRefs) {
      const referencia = row.referencia.toUpperCase();
      const idreferencia = seqgrupoPorRefMap.get(referencia) || '';
      const planoBase = planoPorRefMap.get(referencia) || { ma: 0, px: 0, ul: 0, qt: 0, qu: 0 };
      const tempo = tempoPorRef.get(idreferencia) || 0;
      const processoBase = processoPorRefMap.get(referencia) || 0;
      const gruposDaRef = gruposPorRef.get(referencia) || [];

      // Calcular rateio
      const capacidadeTotalRateio = gruposDaRef.reduce((acc, g) => acc + (capacidadePorGrupo.get(g) || 0), 0);
      const rateio = gruposDaRef.length <= 1 ? 1 : (capacidadeTotalRateio > 0 ? 1 : (1 / gruposDaRef.length));
      // Para evitar duplicação, só contar uma vez (quando é o primeiro grupo)
      const primeiroGrupo = gruposDaRef[0] === row.grupo.toUpperCase();
      if (!primeiroGrupo) continue;

      somarProcesso(referencia, tempo, processoBase);
      cargaTotal.MA += tempo * planoBase.ma;
      cargaTotal.PX += tempo * planoBase.px;
      cargaTotal.UL += tempo * planoBase.ul;
      cargaTotal.QT += tempo * planoBase.qt;
      cargaTotal.QU += tempo * planoBase.qu;
    }

    // Referencias sem grupo de capacidade mapeado tambem ocupam fabrica. A tela de Capacidade
    // soma elas (bloco "nao mapeadas"); sem isso o acumulado sai ~16 dias curto.
    const refsMapeadas = new Set(grupoRefs.map((row) => String(row.referencia || '').toUpperCase()));
    const refsComCarga = new Set([...planoPorRefMap.keys(), ...processoPorRefMap.keys()]);
    for (const referencia of refsComCarga) {
      if (refsMapeadas.has(referencia)) continue;
      const idreferencia = seqgrupoPorRefMap.get(referencia) || '';
      const tempo = tempoPorRef.get(idreferencia) || 0;
      if (!tempo) continue;
      const planoBase = planoPorRefMap.get(referencia) || { ma: 0, px: 0, ul: 0, qt: 0, qu: 0 };
      somarProcesso(referencia, tempo, processoPorRefMap.get(referencia) || 0);
      cargaTotal.MA += tempo * planoBase.ma;
      cargaTotal.PX += tempo * planoBase.px;
      cargaTotal.UL += tempo * planoBase.ul;
      cargaTotal.QT += tempo * planoBase.qt;
      cargaTotal.QU += tempo * planoBase.qu;
    }

    // 9. Calcular dias necessários e acumulados, dada uma capacidade diária total.
    // Reaproveitada para o cenario atual e para o cenario anterior (grupos descontinuados
    // de volta), que dividem a MESMA carga por uma capacidade diferente.
    function calcularDias(capacidadeDiaria) {
      // Cada periodo leva a carga do SEU em-processo, nao o MA levando a de todos.
      const proc = cargaTotal.processoPorPeriodo;
      const diasNecessarios = {
        MA: capacidadeDiaria > 0 ? (proc.MA + cargaTotal.MA) / capacidadeDiaria : 0,
        PX: capacidadeDiaria > 0 ? (proc.PX + cargaTotal.PX) / capacidadeDiaria : 0,
        UL: capacidadeDiaria > 0 ? (proc.UL + cargaTotal.UL) / capacidadeDiaria : 0,
        QT: capacidadeDiaria > 0 ? (proc.QT + cargaTotal.QT) / capacidadeDiaria : 0,
        QU: capacidadeDiaria > 0 ? (proc.QU + cargaTotal.QU) / capacidadeDiaria : 0,
      };
      const diasAcumulado = {
        MA: diasNecessarios.MA,
        PX: diasNecessarios.MA + diasNecessarios.PX,
        UL: diasNecessarios.MA + diasNecessarios.PX + diasNecessarios.UL,
        QT: diasNecessarios.MA + diasNecessarios.PX + diasNecessarios.UL + diasNecessarios.QT,
        QU: diasNecessarios.MA + diasNecessarios.PX + diasNecessarios.UL + diasNecessarios.QT + diasNecessarios.QU,
      };
      return { diasNecessarios, diasAcumulado };
    }

    const { diasNecessarios, diasAcumulado } = calcularDias(capacidadeDiariaTotal);
    const { diasNecessarios: diasNecessariosAnterior, diasAcumulado: diasAcumuladoAnterior } =
      calcularDias(capacidadeDiariaTotalAnterior);

    // 11. Calcular dias disponíveis por período
    //
    // MA é o mês em CURSO: "dias que ainda faltam", um número que muda todo dia. Ele não
    // pode sair de `capacidade_dias.json`, que é mantido à mão e envelhece dentro do mês —
    // em 22/10/2026 o arquivo dizia 12 quando faltavam 7, e isso inflava o denominador da
    // ocupação: outubro aparecia em 157% quando o real era 270%, e o acumulado até janeiro
    // em 84,4% quando era 90,8%. Os demais períodos são meses inteiros e seguem na config,
    // que é onde a operação cadastra coletiva e paradas.
    const hojeDias = new Date();
    const maCalculado = diasDisponiveisDoPeriodo(periodos.MA, hojeDias, comParada);
    const maConfig = Number(dias[String(periodos.MA)] || 0);
    const diasDisponiveis = {
      MA: maCalculado,
      PX: diasDisponiveisDoPeriodo(periodos.PX, hojeDias, comParada),
      UL: diasDisponiveisDoPeriodo(periodos.UL, hojeDias, comParada),
      QT: diasDisponiveisDoPeriodo(periodos.QT, hojeDias, comParada),
      QU: diasDisponiveisDoPeriodo(periodos.QU, hojeDias, comParada),
    };

    // Preparar resposta e salvar no cache
    const responseData = {
      success: true,
      capacidadeDiaria: capacidadeDiariaTotal,
      diasNecessarios: {
        MA: Number(diasNecessarios.MA.toFixed(1)),
        PX: Number(diasNecessarios.PX.toFixed(1)),
        UL: Number(diasNecessarios.UL.toFixed(1)),
        QT: Number(diasNecessarios.QT.toFixed(1)),
        QU: Number(diasNecessarios.QU.toFixed(1)),
      },
      diasAcumulado: {
        MA: Number(diasAcumulado.MA.toFixed(1)),
        PX: Number(diasAcumulado.PX.toFixed(1)),
        UL: Number(diasAcumulado.UL.toFixed(1)),
        QT: Number(diasAcumulado.QT.toFixed(1)),
        QU: Number(diasAcumulado.QU.toFixed(1)),
      },
      diasDisponiveis,
      // De onde saiu o MA, para quem for conferir: o calendario manda, mas o que estava
      // cadastrado continua visivel. Divergencia grande aqui e sinal de config esquecida.
      diasMesCorrente: { mes: Number(periodos.MA), calculado: maCalculado, configurado: maConfig },
      periodos,
      // Cenario anterior: capacidade com os grupos descontinuados (Progresso, Oficina
      // Atila) somados de volta, para comparar com o atual na Visao Geral 2.
      capacidadeDiariaAnterior: capacidadeDiariaTotalAnterior,
      diasNecessariosAnterior: {
        MA: Number(diasNecessariosAnterior.MA.toFixed(1)),
        PX: Number(diasNecessariosAnterior.PX.toFixed(1)),
        UL: Number(diasNecessariosAnterior.UL.toFixed(1)),
        QT: Number(diasNecessariosAnterior.QT.toFixed(1)),
        QU: Number(diasNecessariosAnterior.QU.toFixed(1)),
      },
      diasAcumuladoAnterior: {
        MA: Number(diasAcumuladoAnterior.MA.toFixed(1)),
        PX: Number(diasAcumuladoAnterior.PX.toFixed(1)),
        UL: Number(diasAcumuladoAnterior.UL.toFixed(1)),
        QT: Number(diasAcumuladoAnterior.QT.toFixed(1)),
        QU: Number(diasAcumuladoAnterior.QU.toFixed(1)),
      },
      gruposDesativados: GRUPOS_DESATIVADOS.map((g) => g.grupo),
    };

    // Salvar no cache
    diasResumoCache.data = responseData;
    diasResumoCache.comParada = comParada;
    diasResumoCache.timestamp = Date.now();

    return res.json(responseData);
  } catch (error) {
    console.error('[capacidade/dias-resumo] Erro:', error);
    return res.status(500).json({
      success: false,
      error: "Erro ao calcular dias resumo",
      details: error.message,
    });
  }
});

// ── GET /api/capacidade/gap-mensal ─────────────────────────────────────────────
// Gap de dias ACUMULADO por mês, na mesma regra da tela de Capacidade:
//   dias necessários = (processo + cargas até o mês) / capacidade diária total
//   gap              = dias necessários − dias produtivos acumulados
// Rota própria de propósito: não altera /matriz, que outras telas consomem.
const gapMensalCache = { chave: '', data: null, timestamp: 0 };
const GAP_CACHE_TTL = 5 * 60 * 1000;

// Simulacoes APROVADAS que carregam o plano por SKU, para sobrepor ao plano da matriz.
//
// Vinha de `data/analises_plano.json`, que parou em marco/2026: as simulacoes migraram para
// `app_simulacoes` no Postgres e o disco do Render e efemero. Na pratica
// `gap-mensal?aplicar_aprovadas=true` nao aplicava mais nada — lia um arquivo congelado.
// O arquivo segue como fallback para rodar local sem banco.
function aprovadasComPlano(lista) {
  return (Array.isArray(lista) ? lista : [])
    .filter((a) => a?.parametros?.statusAprovacao === 'APROVADA' && Array.isArray(a?.parametros?.planos));
}

function lerAprovadasDoArquivo() {
  const parsed = readJson(path.join(DATA_DIR, 'analises_plano.json'), { data: [] });
  return aprovadasComPlano(Array.isArray(parsed) ? parsed : parsed?.data);
}

async function lerAprovadas(pool) {
  if (!pool) return lerAprovadasDoArquivo();
  try {
    const r = await pool.query(
      `SELECT created_at, parametros
         FROM app_simulacoes
        WHERE UPPER(COALESCE(parametros::jsonb ->> 'statusAprovacao', 'PENDENTE')) = 'APROVADA'
        ORDER BY created_at`
    );
    const lista = r.rows.map((row) => {
      let parametros = {};
      try { parametros = row.parametros ? JSON.parse(row.parametros) : {}; } catch { parametros = {}; }
      return { createdAt: Number(row.created_at || 0), parametros };
    });
    return aprovadasComPlano(lista);
  } catch (err) {
    // 42P01 = tabela ainda nao criada; nada aprovado e um estado valido, nao uma falha.
    if (err.code !== '42P01') {
      console.error('[capacidade] aprovadas do banco falharam, usando arquivo:', err.message);
    }
    return lerAprovadasDoArquivo();
  }
}

// Simulacoes de um LOTE especifico, aprovadas ou nao.
//
// O `aplicar_aprovadas` so enxerga o que ja passou pela aprovacao, e o PCP precisa ver o
// efeito do lote ANTES disso — e justamente a conferencia que decide se aprova. Como as
// simulacoes de um lote guardam o plano completo dos nove periodos por SKU, basta a mais
// recente: as outras sao a mesma foto, mudando so qual periodo cada uma assume como alvo.
async function lerSimulacoesDoLote(pool, loteId) {
  const alvo = String(loteId || '').trim();
  if (!pool || !alvo) return [];
  try {
    const r = await pool.query(
      `SELECT created_at, parametros
         FROM app_simulacoes
        WHERE parametros::jsonb ->> 'loteId' = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [alvo]
    );
    return r.rows.map((row) => {
      let parametros = {};
      try { parametros = row.parametros ? JSON.parse(row.parametros) : {}; } catch { parametros = {}; }
      return { createdAt: Number(row.created_at || 0), parametros };
    }).filter((a) => Array.isArray(a?.parametros?.planos));
  } catch (err) {
    if (err.code !== '42P01') console.error('[capacidade] lote do banco falhou:', err.message);
    return [];
  }
}

// mesma chave usada pela tela ao casar simulação com a linha da matriz
function chaveDaLinha(item) {
  const id = Number(item?.produto?.idproduto);
  if (Number.isFinite(id)) return `ID-${id}`;
  return `REF-${item?.produto?.referencia || ''}-${item?.produto?.cor || ''}-${item?.produto?.tamanho || ''}`;
}

router.get('/gap-mensal', auth, async (req, res) => {
  try {
    const hoje = new Date();
    // últimos 3 meses FECHADOS: do 1º dia de 3 meses atrás até o 1º dia do mês corrente
    const dePadrao = new Date(hoje.getFullYear(), hoje.getMonth() - 3, 1).toISOString().slice(0, 10);
    const atePadrao = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
    const de = String(req.query.de || dePadrao).slice(0, 10);
    const ate = String(req.query.ate || atePadrao).slice(0, 10);
    // padrão false: é assim que a tela de Capacidade calcula o gap que serve de referência
    const aplicarAprovadas = String(req.query.aplicar_aprovadas ?? 'false') === 'true';
    // Lote de simulacao a sobrepor, aprovado ou nao. Entra na chave do cache para a tela
    // com e sem simulacao nao se contaminarem.
    const loteId = String(req.query.lote_id || '').trim();
    const chaveCache = `${de}|${ate}|${aplicarAprovadas}|${loteId}`;

    if (gapMensalCache.data && gapMensalCache.chave === chaveCache && (Date.now() - gapMensalCache.timestamp) < GAP_CACHE_TTL) {
      return res.json({ ...gapMensalCache.data, fromCache: true });
    }

    const pool = req.app.get('pool');
    const { readCache } = require('../cache/matrizCache');

    const grupos = await readGrupos(req.app.get("pool"));
    const grupoRefs = await readGrupoRefs(pool);
    const dias = await readDias(req.app.get("pool"));
    const nomesGrupos = new Set(grupos.map((g) => g.grupo));

    // capacidade diária real por grupo no período (minutos ÷ dias com movimento)
    const { porGrupo: capacidadeRealPorGrupo } = await consultarCapacidadeRealPorGrupo(pool, de, ate, 'media');

    // tempos de costura por referência
    const temposResult = await queryTempoBaseRows(pool, {});
    const tempoPorRef = new Map();
    for (const row of temposResult.rows || []) {
      const idreferencia = String(row.idreferencia || '').trim().toUpperCase();
      if (!idreferencia) continue;
      const base = resolveTempoLikePowerBi(row.hr_tempo, row.hr_tempopadrao);
      tempoPorRef.set(idreferencia, (tempoPorRef.get(idreferencia) || 0) + (Number.isFinite(base) ? base : 0));
    }

    // plano da matriz, com a simulação aprovada por cima quando pedido
    const planosAprovados = new Map();
    if (aplicarAprovadas) {
      const aprovadas = await lerAprovadas(pool);
      for (const a of aprovadas.sort((x, y) => Number(x.createdAt || 0) - Number(y.createdAt || 0))) {
        for (const p of a.parametros.planos) {
          const k = String(p?.chave || '').trim();
          if (k) planosAprovados.set(k, p);
        }
      }
    }
    // O lote entra DEPOIS das aprovadas: e a foto mais recente e deve prevalecer.
    if (loteId) {
      for (const a of await lerSimulacoesDoLote(pool, loteId)) {
        for (const p of a.parametros.planos) {
          const k = String(p?.chave || '').trim();
          if (k) planosAprovados.set(k, p);
        }
      }
    }

    const matrizCache = await readCache();
    const matrizRows = Array.isArray(matrizCache?.data?.rows) ? matrizCache.data.rows : [];
    const planoPorRef = new Map();
    const processoPorRef = new Map();
    const seqgrupoPorRef = new Map();

    for (const item of matrizRows) {
      const marca = String(item?.produto?.marca || '').trim().toUpperCase();
      const status = String(item?.produto?.status || '').trim().toUpperCase();
      const descricao = String(item?.produto?.produto || '').trim().toUpperCase();
      if (marca !== 'LIEBE') continue;
      if (!['EM LINHA', 'NOVA COLECAO'].includes(status)) continue;
      if (descricao.includes('MEIA DE SEDA')) continue;

      const aprovado = planosAprovados.get(chaveDaLinha(item));
      const fonte = aprovado || item?.plano || {};
      const plano = Object.fromEntries(PERIODOS_PLANO.map((per) => {
        const campo = per.toLowerCase();
        return [campo, Number(fonte[campo] || 0)];
      }));

      const refPadrao = String(item?.produto?.referencia || '').trim().toUpperCase();
      const refSistema = String(item?.produto?.cd_seqgrupo || '').trim().toUpperCase();
      const emProcesso = Number(item?.estoques?.em_processo || 0);

      for (const chave of [refPadrao, refSistema]) {
        if (!chave) continue;
        const atual = planoPorRef.get(chave) || Object.fromEntries(PERIODOS_PLANO.map((per) => [per.toLowerCase(), 0]));
        for (const per of PERIODOS_PLANO) { const campo = per.toLowerCase(); atual[campo] += plano[campo]; }
        planoPorRef.set(chave, atual);
        processoPorRef.set(chave, (processoPorRef.get(chave) || 0) + emProcesso);
      }
      if (refPadrao && refSistema && !seqgrupoPorRef.has(refPadrao)) seqgrupoPorRef.set(refPadrao, refSistema);
    }

    const capacidadeConfigPorGrupo = new Map(grupos.map((g) => [g.grupo, Number(g.capacidade_diaria || 0)]));
    const gruposPorRef = new Map();
    for (const row of grupoRefs) {
      if (!nomesGrupos.has(row.grupo)) continue;
      const atual = gruposPorRef.get(row.referencia) || [];
      if (!atual.includes(row.grupo)) atual.push(row.grupo);
      gruposPorRef.set(row.referencia, atual);
    }

    const periodos = calcularPeriodosPlano(hoje).meses;

    // Em processo aberto por periodo, pelo mes do lote. Sem isto a carga de processo ia
    // inteira para o inicio do horizonte (ver `tempoAcumulado` abaixo), e outubro
    // carregava sozinho os minutos de novembro: 4,9 dias de diferenca contra o
    // dias-resumo, que ja distribuia.
    const { mapa: processoPorRefPeriodo, ok: processoPorPeriodoOk } =
      await carregarProcessoPorRefPeriodo(pool, matrizRows, periodos, hoje);

    // carga por mês, com rateio quando a referência pertence a mais de um grupo
    // Um acumulador por periodo de PERIODOS_PLANO (ma..nv), em vez da lista escrita a mao:
    // era assim que ST ficava de fora da carga mesmo tendo plano lancado no ERP.
    const carga = Object.fromEntries(PERIODOS_PLANO.map((p) => [p.toLowerCase(), 0]));
    const cargaProcesso = Object.fromEntries(PERIODOS_PLANO.map((p) => [p, 0]));
    let processoCarga = 0;
    const somarProcessoGap = (referencia, tempo, totalDaRef, rateio) => {
      const total = tempo * totalDaRef * rateio;
      processoCarga += total;
      const abertura = processoPorPeriodoOk ? processoPorRefPeriodo.get(referencia) : null;
      if (!abertura) { cargaProcesso.MA += total; return; }
      for (const p of PERIODOS_LOTE) cargaProcesso[p] += tempo * (abertura[p] || 0) * rateio;
    };
    for (const row of grupoRefs) {
      if (!nomesGrupos.has(row.grupo)) continue;
      const idreferencia = seqgrupoPorRef.get(row.referencia) || '';
      const tempo = Number(tempoPorRef.get(idreferencia) || 0);
      if (!tempo) continue;
      const base = planoPorRef.get(row.referencia) || { ma: 0, px: 0, ul: 0, qt: 0, qu: 0, sx: 0 };
      const gruposDaRef = gruposPorRef.get(row.referencia) || [];
      const totalRateio = gruposDaRef.reduce((acc, g) => acc + (capacidadeConfigPorGrupo.get(g) || 0), 0);
      const rateio = gruposDaRef.length <= 1
        ? 1
        : (totalRateio > 0 ? ((capacidadeConfigPorGrupo.get(row.grupo) || 0) / totalRateio) : (1 / gruposDaRef.length));

      for (const p of PERIODOS_PLANO) carga[p.toLowerCase()] += tempo * Number(base[p.toLowerCase()] || 0) * rateio;
      somarProcessoGap(row.referencia, tempo, Number(processoPorRef.get(row.referencia) || 0), rateio);
    }

    // Referencia sem grupo de capacidade TAMBEM ocupa a fabrica. O laco acima so percorre
    // `grupoRefs`, entao tudo que nao esta mapeado sumia da conta: em 22/10/2026 eram 60
    // referencias, 100.707 pecas, 16,9 dias de trabalho — 22% do total. Era a maior parte
    // da "folga" que esta tela prometia (janeiro aparecia com 30 dias sobrando quando
    // sobravam 4). O dias-resumo ja fazia isso; aqui faltava.
    const refsComGrupo = new Set(grupoRefs.map((row) => String(row.referencia || '').toUpperCase()));
    const refsComCarga = new Set([...planoPorRef.keys(), ...processoPorRef.keys()]);
    for (const referencia of refsComCarga) {
      if (refsComGrupo.has(referencia)) continue;
      const idreferencia = seqgrupoPorRef.get(referencia) || '';
      const tempo = Number(tempoPorRef.get(idreferencia) || 0);
      if (!tempo) continue;
      const base = planoPorRef.get(referencia) || {};
      for (const p of PERIODOS_PLANO) carga[p.toLowerCase()] += tempo * Number(base[p.toLowerCase()] || 0);
      somarProcessoGap(referencia, tempo, Number(processoPorRef.get(referencia) || 0), 1);
    }

    // Igual à tela: havendo medição real, grupo sem medição vale zero (não cai na planilha)
    const capacidadeDiariaTotal = grupos.reduce((total, g) => total + (capacidadeRealPorGrupo.size > 0
      ? (capacidadeRealPorGrupo.get(g.grupo) || 0)
      : Number(g.capacidade_diaria || 0)), 0);


    // Cada periodo leva a carga do SEU em-processo, em vez de tudo cair no inicio.
    let tempoAcumulado = 0;
    let diasAcumulados = 0;
    const meses = [];
    for (const chave of PERIODOS_PLANO) {
      tempoAcumulado += carga[chave.toLowerCase()] + (cargaProcesso[chave] || 0);
      // Dias do calendario, nao da config: o mes em curso entra so com o que falta, e os
      // feriados de cada mes sao descontados no ano certo.
      diasAcumulados += diasDisponiveisDoPeriodo(periodos[chave], hoje);
      const diasNecessarios = capacidadeDiariaTotal > 0 ? tempoAcumulado / capacidadeDiariaTotal : 0;
      meses.push({
        periodo: chave,
        mes: periodos[chave],
        tempoAcumulado: Number(tempoAcumulado.toFixed(1)),
        diasNecessarios: Number(diasNecessarios.toFixed(2)),
        diasDisponiveis: diasAcumulados,
        gap: Number((diasNecessarios - diasAcumulados).toFixed(2)),
      });
    }

    const payload = {
      success: true,
      de,
      ate,
      aplicarAprovadas,
      capacidadeDiariaTotal: Number(capacidadeDiariaTotal.toFixed(2)),
      processoCarga: Number(processoCarga.toFixed(1)),
      periodos,
      meses,
    };
    gapMensalCache.chave = chaveCache;
    gapMensalCache.data = payload;
    gapMensalCache.timestamp = Date.now();
    return res.json(payload);
  } catch (error) {
    console.error('[capacidade/gap-mensal] Erro:', error);
    return res.status(500).json({ success: false, error: 'Erro ao calcular gap mensal', details: error.message });
  }
});

// Cache proprio, mesma vida do gap-mensal: a consulta de tempos e a leitura da matriz sao
// as partes caras e sao exatamente as mesmas.
let ocupGrupoCache = { chave: null, data: null, timestamp: 0 };

// Mix de producao no ERP: `prd_classificacao`, `cd_tipoclas = 29`.
const MIX_PRODUCAO_TIPOCLAS = 29;

// AGRUPAMENTO DOS GRUPOS DE PRODUTO EM FAMILIAS DE PRODUCAO.
//
// Definido pelo Fagner em 03/11/2026, olhando a planilha de analise de capacidade que ele
// mantem: sem costura e short entram em CALCA, top entra em SUTIA, camisola e short doll
// formam NOITE. E como a fabrica pensa a alocacao, e nao como o ERP classifica o produto.
//
// Grupo que nao esta aqui permanece com o proprio nome, de proposito: BODY, CINTA, ROBE,
// MACAQUINHO e os outros nao foram citados, e enfia-los num "outros" esconderia carga que
// hoje da para ver. Quando o PCP decidir onde eles entram, e so acrescentar a linha.
const FAMILIA_POR_GRUPO_PRODUTO = {
  'CALCA': 'CALCA',
  'SEM COSTURA': 'CALCA',
  'SHORT': 'CALCA',
  'SUTIA': 'SUTIA',
  'TOP': 'SUTIA',
  'CAMISOLA': 'NOITE',
  'SHORT DOLL': 'NOITE',
};

// ANATOMIC nao e grupo de produto, e LINHA (`produto.linha`) — ela atravessa calca, sutia,
// short, body e macaquinho. As proprias celulas de capacidade refletem isso: ha "CA
// ANATOMIC" e "SO ANATOMIC", e a celula "09 - LIDERANCA ANATOMIC" e dedicada a ela.
//
// Por isso a linha tem PRECEDENCIA sobre o grupo: um short anatomic nao e short comum, e a
// fabrica o trata separado. Medido em 03/11/2026: 31 SKUs, 9.120 pecas (1,1% do plano),
// distribuidas entre SHORT 3.390, BODY 1.950, CALCA 1.770, MACAQUINHO 1.350 e SUTIA 660 —
// que sao exatamente as pecas que saem dessas familias quando ANATOMIC vira linha propria.
const LINHAS_COM_FAMILIA_PROPRIA = new Set(['ANATOMIC']);

const familiaDoProduto = (produto) => {
  const linha = String(produto?.linha || '').trim().toUpperCase();
  if (LINHAS_COM_FAMILIA_PROPRIA.has(linha)) return linha;
  const g = String(produto?.grupo || '').trim().toUpperCase();
  return FAMILIA_POR_GRUPO_PRODUTO[g] || g || 'SEM GRUPO';
};

// Familias que o PCP nomeou. Aparecem sempre, mesmo pequenas: ANATOMIC e 1,1% do plano e
// cairia no "outros" pelo corte de 3%, que e justamente o oposto do pedido.
const FAMILIAS_NOMEADAS = new Set([...Object.values(FAMILIA_POR_GRUPO_PRODUTO), ...LINHAS_COM_FAMILIA_PROPRIA]);

/**
 * GET /api/capacidade/ocupacao-por-grupo-produto
 *
 * A Capacidade x Venda diz se o plano cabe NO CONJUNTO da fabrica. Nao diz ONDE aperta.
 * Esta rota abre a mesma conta por grupo de produto (CALCA, SUTIA, CAMISOLA...), que e a
 * leitura que o PCP mantinha numa planilha a parte.
 *
 * O PONTO DIFICIL: carga e por PRODUTO, capacidade e por CELULA.
 *
 * A carga sai exata — `plano x tempo` somado por `produto.grupo`, cobrindo 100% do plano.
 * A capacidade nao: ela e medida por celula de producao, e uma celula faz referencias de
 * mais de um grupo. Entao cada celula distribui a capacidade dela entre os grupos na mesma
 * proporcao em que eles a carregam:
 *
 *   fatia(grupo, celula) = carga do grupo naquela celula / carga total da celula
 *   capacidadeDiaria(grupo) = SOMA_celulas  capacidadeDiaria(celula) x fatia(grupo, celula)
 *
 * A fatia usa o horizonte ACUMULADO, nao periodo a periodo: um mes em que a celula nao tem
 * carga produziria uma divisao sem sentido.
 *
 * E auto-consistente (a soma por grupo devolve a capacidade da fabrica) e preserva o sinal
 * que interessa: celula sobrecarregada puxa para cima a ocupacao de quem a usa.
 *
 * O QUE NAO FAZER, e por que: ratear a capacidade TOTAL pela carga de cada grupo daria a
 * mesma ocupacao para todos, por construcao, e a tela nao diria nada.
 *
 * REFERENCIA SEM CELULA (13,4% do plano medido em 30/10/2026) tem carga e nao tem
 * capacidade. Ela entra na carga do grupo e sai tambem em `cargaSemCelulaMin`, em vez de
 * ser diluida: quando essa coluna e alta, a ocupacao do grupo esta superestimada, e quem
 * le precisa enxergar isso em vez de receber um numero limpo e errado.
 */
router.get('/ocupacao-por-grupo-produto', auth, async (req, res) => {
  try {
    const hoje = new Date();
    const dePadrao = new Date(hoje.getFullYear(), hoje.getMonth() - 3, 1).toISOString().slice(0, 10);
    const atePadrao = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
    const de = String(req.query.de || dePadrao).slice(0, 10);
    const ate = String(req.query.ate || atePadrao).slice(0, 10);
    const aplicarAprovadas = String(req.query.aplicar_aprovadas ?? 'false') === 'true';
    const loteId = String(req.query.lote_id || '').trim();
    // COMO A CARGA ENCONTRA A CELULA. Duas leituras, de proposito:
    //
    //   cadastro (padrao) — pelo `app_capacidade_grupo_refs`, o cadastro manual de
    //     referencia -> celula, com heranca por tipo de produto para quem nao esta la.
    //   mix — pela classificacao 29 do ERP (mix de producao): o produto tem um mix, e a
    //     carga vai para as celulas que comprovadamente produzem aquele mix.
    //
    // Nenhuma das duas e obviamente certa. O cadastro carrega erros de digitacao e
    // defasagem; o mix depende de quais referencias ja foram cadastradas para revelar o
    // que cada celula faz. Medido em 03/11/2026, elas discordam em 886.188 minutos — 19,3%
    // da carga esta hoje numa celula que, pelo mix, nao deveria fazer aquele produto. Por
    // isso as duas ficam disponiveis lado a lado, em vez de uma ser escolhida no escuro.
    const alocacao = String(req.query.alocacao || 'cadastro').trim().toLowerCase() === 'mix' ? 'mix' : 'cadastro';
    const chaveCache = `${de}|${ate}|${aplicarAprovadas}|${loteId}|${alocacao}`;

    if (ocupGrupoCache.data && ocupGrupoCache.chave === chaveCache && (Date.now() - ocupGrupoCache.timestamp) < GAP_CACHE_TTL) {
      return res.json({ ...ocupGrupoCache.data, fromCache: true });
    }

    const pool = req.app.get('pool');
    const { readCache } = require('../cache/matrizCache');

    const grupos = await readGrupos(pool);
    const grupoRefs = await readGrupoRefs(pool);
    const nomesGrupos = new Set(grupos.map((g) => g.grupo));
    const { porGrupo: capacidadeRealPorGrupo } = await consultarCapacidadeRealPorGrupo(pool, de, ate, 'media');

    // Capacidade diaria efetiva de cada celula. Igual a tela: havendo medicao real, celula
    // sem medicao vale ZERO — nao cai no numero do arquivo, que esta corrompido.
    const temMedida = capacidadeRealPorGrupo.size > 0;
    const capDiariaCelula = new Map(grupos.map((g) => [
      g.grupo,
      temMedida ? Number(capacidadeRealPorGrupo.get(g.grupo) || 0) : Number(g.capacidade_diaria || 0),
    ]));
    const capacidadeDiariaTotal = [...capDiariaCelula.values()].reduce((a, b) => a + b, 0);

    const temposResult = await queryTempoBaseRows(pool, {});
    const tempoPorRef = new Map();
    for (const row of temposResult.rows || []) {
      const idreferencia = String(row.idreferencia || '').trim().toUpperCase();
      if (!idreferencia) continue;
      const base = resolveTempoLikePowerBi(row.hr_tempo, row.hr_tempopadrao);
      tempoPorRef.set(idreferencia, (tempoPorRef.get(idreferencia) || 0) + (Number.isFinite(base) ? base : 0));
    }

    // Simulacao por cima do plano, exatamente como o gap-mensal faz, para a quebra reagir
    // ao lote junto com o total em vez de contar outra historia.
    const planosAprovados = new Map();
    if (aplicarAprovadas) {
      const aprovadas = await lerAprovadas(pool);
      for (const a of aprovadas.sort((x, y) => Number(x.createdAt || 0) - Number(y.createdAt || 0))) {
        for (const p of a.parametros.planos) {
          const k = String(p?.chave || '').trim();
          if (k) planosAprovados.set(k, p);
        }
      }
    }
    if (loteId) {
      for (const a of await lerSimulacoesDoLote(pool, loteId)) {
        for (const p of a.parametros.planos) {
          const k = String(p?.chave || '').trim();
          if (k) planosAprovados.set(k, p);
        }
      }
    }

    const matrizCache = await readCache();
    const matrizRows = Array.isArray(matrizCache?.data?.rows) ? matrizCache.data.rows : [];

    // Celulas de cada referencia, e o rateio entre elas pela capacidade — mesmo criterio do
    // gap-mensal, para as duas telas dividirem a carga do mesmo jeito.
    const celulasPorRef = new Map();
    for (const row of grupoRefs) {
      if (!nomesGrupos.has(row.grupo)) continue;
      const ref = String(row.referencia || '').trim().toUpperCase();
      if (!ref) continue;
      const atual = celulasPorRef.get(ref) || [];
      if (!atual.includes(row.grupo)) atual.push(row.grupo);
      celulasPorRef.set(ref, atual);
    }

    // ── HERANCA DE CELULA POR TIPO DE PRODUTO ────────────────────────────────────────
    //
    // Mesma regra que a Sugestao de Plano ja aplica (`gruposDaReferencia`, em
    // frontend/app/sugestao-plano/page.tsx). Sem ela, referencia nao cadastrada ficava com
    // carga e NENHUMA capacidade, e a ocupacao do grupo inflava — as duas maiores sem
    // celula aqui, 123606 e 123019, sao as mesmas que o motor do plano ja herdava ha
    // tempos. Duas telas respondendo diferente sobre a mesma referencia e pior do que
    // qualquer uma das duas respostas.
    //
    // A heranca e pelo `grupo` do produto (SUTIA, CALCA, CAMISOLA...), que e o que de fato
    // determina onde a peca pode ser costurada — os proprios nomes das celulas trazem isso
    // (SU, CA, SO). Entram so as celulas DOMINANTES do tipo, com pelo menos metade da
    // frequencia da mais comum: senao um SUTIA herdaria toda celula que ja costurou algum
    // sutia alguma vez, inclusive excecao.
    const tipoPorRef = new Map();
    for (const item of matrizRows) {
      const ref = String(item?.produto?.referencia || '').trim().toUpperCase();
      const tipo = String(item?.produto?.grupo || '').trim().toUpperCase();
      if (ref && tipo && !tipoPorRef.has(ref)) tipoPorRef.set(ref, tipo);
    }
    const contagemPorTipo = new Map();
    for (const [ref, celulas] of celulasPorRef) {
      const tipo = tipoPorRef.get(ref);
      if (!tipo) continue;
      const cont = contagemPorTipo.get(tipo) || new Map();
      for (const c of celulas) cont.set(c, (cont.get(c) || 0) + 1);
      contagemPorTipo.set(tipo, cont);
    }
    const dominantesPorTipo = new Map();
    for (const [tipo, cont] of contagemPorTipo) {
      let maior = 0;
      for (const n of cont.values()) if (n > maior) maior = n;
      if (!(maior > 0)) continue;
      const dominantes = [];
      for (const [c, n] of cont) if (n >= maior * 0.5) dominantes.push(c);
      dominantesPorTipo.set(tipo, dominantes);
    }
    // Quem herdou, para a tela poder dizer que a capacidade veio de palpite e nao de
    // cadastro. Herdado e melhor que nada, mas nao e a mesma coisa que cadastrado.
    const refsHerdaram = new Set();
    const celulasPorCadastro = (ref) => {
      const proprio = celulasPorRef.get(ref);
      if (proprio && proprio.length) return proprio;
      const herdado = dominantesPorTipo.get(tipoPorRef.get(ref));
      if (herdado && herdado.length) {
        refsHerdaram.add(ref);
        return herdado;
      }
      return [];
    };

    // ── ALOCACAO PELO MIX DE PRODUCAO (classificacao 29) ────────────────────────────
    //
    // O ERP classifica cada produto num mix (CA BASICO, SO LUXE, SC BASICO, SO ANATOMIC...).
    // Cruzando isso com as referencias ja cadastradas em cada celula, o proprio sistema diz
    // o que cada celula faz — e o resultado reproduz o relatorio "Locais de estoque e mix
    // de classificacao" do TOTVS sem precisar dele: a CONQUISTA aparece fazendo SC BASICO e
    // a ALEGRIA fazendo SO LINHA NOITE, que e o que o relatorio diz, apesar dos nomes delas
    // sugerirem outra coisa.
    //
    // A leitura vem de `vr_prd_produtoclas` e nao de `f_dic_prd_classificacao`: a view e
    // uma tabela indexada, a funcao e chamada por linha.
    let mixPorRef = new Map();
    let celulasPorMix = new Map();
    if (alocacao === 'mix') {
      const r = await pool.query(
        `SELECT cd_produto::TEXT AS id, UPPER(TRIM(ds_classificacao)) AS mix
           FROM public.vr_prd_produtoclas
          WHERE cd_tipoclas::int = $1 AND COALESCE(ds_classificacao, '') <> ''`,
        [MIX_PRODUCAO_TIPOCLAS]
      );
      const mixPorProduto = new Map(r.rows.map((x) => [String(x.id), String(x.mix)]));
      for (const item of matrizRows) {
        const ref = String(item?.produto?.referencia || '').trim().toUpperCase();
        const mix = mixPorProduto.get(String(item?.produto?.idproduto || ''));
        if (ref && mix && !mixPorRef.has(ref)) mixPorRef.set(ref, mix);
      }
      // Celula -> mixes que ela comprovadamente produz, pelas referencias cadastradas nela.
      for (const [ref, celulas] of celulasPorRef) {
        const mix = mixPorRef.get(ref);
        if (!mix) continue;
        for (const celula of celulas) {
          const atual = celulasPorMix.get(mix) || new Set();
          atual.add(celula);
          celulasPorMix.set(mix, atual);
        }
      }
    }

    const celulasDaRef = (ref) => {
      if (alocacao !== 'mix') return celulasPorCadastro(ref);
      const mix = mixPorRef.get(ref);
      const porMix = mix ? celulasPorMix.get(mix) : null;
      if (porMix && porMix.size) return [...porMix];
      // Sem mix, ou mix que nenhuma celula cadastrada produz: cai no cadastro, para a carga
      // nao desaparecer da conta so porque a classificacao falta.
      return celulasPorCadastro(ref);
    };

    // EM PROCESSO tambem ocupa a fabrica, e por isso entra no `tempoAcumulado` do
    // gap-mensal. Sem ele aqui a quebra por grupo ficava 771.409 minutos abaixo do total —
    // medido — e as duas telas nunca reconciliariam.
    //
    // Indexado por REFERENCIA, nao por SKU: o mapa de abertura e por referencia, e varios
    // SKUs dividem a mesma. Somar por SKU contaria o processo tantas vezes quantas forem as
    // cores e tamanhos daquela referencia.
    const { mapa: processoPorRefPeriodo, ok: processoPorPeriodoOk } =
      await carregarProcessoPorRefPeriodo(pool, matrizRows, calcularPeriodosPlano(hoje).meses, hoje);
    const processoPorRef = new Map();
    const grupoDaRef = new Map();
    const tempoDaRef = new Map();
    for (const item of matrizRows) {
      const marca = String(item?.produto?.marca || '').trim().toUpperCase();
      const status = String(item?.produto?.status || '').trim().toUpperCase();
      const descricao = String(item?.produto?.produto || '').trim().toUpperCase();
      if (marca !== 'LIEBE') continue;
      if (!['EM LINHA', 'NOVA COLECAO'].includes(status)) continue;
      if (descricao.includes('MEIA DE SEDA')) continue;
      const ref = String(item?.produto?.referencia || '').trim().toUpperCase();
      if (!ref) continue;
      processoPorRef.set(ref, (processoPorRef.get(ref) || 0) + Number(item?.estoques?.em_processo || 0));
      if (!grupoDaRef.has(ref)) {
        grupoDaRef.set(ref, familiaDoProduto(item?.produto));
        tempoDaRef.set(ref, Number(tempoPorRef.get(String(item?.produto?.cd_seqgrupo || '').trim().toUpperCase()) || 0));
      }
    }

    const zerado = () => Object.fromEntries(PERIODOS_PLANO.map((p) => [p, 0]));
    const porGrupoProduto = new Map(); // grupo -> { pecas, carga, cargaSemCelula } por periodo
    const cargaCelulaGrupo = new Map(); // celula -> Map(grupo -> carga do horizonte)

    const doGrupo = (nome) => {
      if (!porGrupoProduto.has(nome)) {
        porGrupoProduto.set(nome, { pecas: zerado(), carga: zerado(), cargaSemCelula: zerado() });
      }
      return porGrupoProduto.get(nome);
    };

    // QUEM esta sem celula, nao so QUANTO. A tela marcava o grupo como pouco confiavel e
    // parava ai — o PCP via o aviso e nao tinha o que fazer com ele. Com a referencia
    // nomeada, o aviso vira uma lista de cadastro para o Fagner.
    const semCelulaPorRef = new Map(); // `grupo|referencia` -> { ..., minutos }
    const anotarSemCelula = (grupoProduto, referencia, descricao, pecas, minutos) => {
      if (!referencia || !(minutos > 0)) return;
      const k = `${grupoProduto}|${referencia}`;
      const atual = semCelulaPorRef.get(k) || { grupo: grupoProduto, referencia, produto: descricao, pecas: 0, minutos: 0 };
      atual.pecas += pecas;
      atual.minutos += minutos;
      if (!atual.produto && descricao) atual.produto = descricao;
      semCelulaPorRef.set(k, atual);
    };

    for (const item of matrizRows) {
      const marca = String(item?.produto?.marca || '').trim().toUpperCase();
      const status = String(item?.produto?.status || '').trim().toUpperCase();
      const descricao = String(item?.produto?.produto || '').trim().toUpperCase();
      if (marca !== 'LIEBE') continue;
      if (!['EM LINHA', 'NOVA COLECAO'].includes(status)) continue;
      if (descricao.includes('MEIA DE SEDA')) continue;

      const grupoProduto = familiaDoProduto(item?.produto);
      const refPadrao = String(item?.produto?.referencia || '').trim().toUpperCase();
      const idreferencia = String(item?.produto?.cd_seqgrupo || '').trim().toUpperCase();
      const tempo = Number(tempoPorRef.get(idreferencia) || 0);

      const aprovado = planosAprovados.get(chaveDaLinha(item));
      const fonte = aprovado || item?.plano || {};

      const alvo = doGrupo(grupoProduto);
      const celulas = celulasDaRef(refPadrao);
      const totalRateio = celulas.reduce((acc, c) => acc + Math.max(0, Number(capDiariaCelula.get(c) || 0)), 0);

      for (const per of PERIODOS_PLANO) {
        const pecas = Number(fonte[per.toLowerCase()] || 0);
        if (!pecas) continue;
        alvo.pecas[per] += pecas;
        const cargaMin = pecas * tempo;
        if (!cargaMin) continue;
        alvo.carga[per] += cargaMin;
        if (!celulas.length) {
          alvo.cargaSemCelula[per] += cargaMin;
          anotarSemCelula(grupoProduto, refPadrao, descricao, pecas, cargaMin);
          continue;
        }
        for (const celula of celulas) {
          const fatia = celulas.length === 1
            ? 1
            : (totalRateio > 0 ? Math.max(0, Number(capDiariaCelula.get(celula) || 0)) / totalRateio : 1 / celulas.length);
          const mapa = cargaCelulaGrupo.get(celula) || new Map();
          mapa.set(grupoProduto, (mapa.get(grupoProduto) || 0) + cargaMin * fatia);
          cargaCelulaGrupo.set(celula, mapa);
        }
      }
    }

    // Carga do EM PROCESSO, pela mesma estrada: abertura por periodo quando o ERP tem a
    // data, tudo em MA quando nao tem — identico ao gap-mensal, para os totais fecharem.
    for (const [ref, pecasProcesso] of processoPorRef) {
      if (!(pecasProcesso > 0)) continue;
      const tempo = Number(tempoDaRef.get(ref) || 0);
      if (!tempo) continue;
      const grupoProduto = grupoDaRef.get(ref) || 'SEM GRUPO';
      const alvo = doGrupo(grupoProduto);
      const celulas = celulasDaRef(ref);
      const totalRateio = celulas.reduce((acc, c) => acc + Math.max(0, Number(capDiariaCelula.get(c) || 0)), 0);
      const abertura = processoPorPeriodoOk ? processoPorRefPeriodo.get(ref) : null;

      for (const per of PERIODOS_PLANO) {
        const pecas = abertura ? Number(abertura[per] || 0) : (per === 'MA' ? pecasProcesso : 0);
        if (!pecas) continue;
        const cargaMin = pecas * tempo;
        alvo.carga[per] += cargaMin;
        if (!celulas.length) {
          alvo.cargaSemCelula[per] += cargaMin;
          continue;
        }
        for (const celula of celulas) {
          const fatia = celulas.length === 1
            ? 1
            : (totalRateio > 0 ? Math.max(0, Number(capDiariaCelula.get(celula) || 0)) / totalRateio : 1 / celulas.length);
          const mapa = cargaCelulaGrupo.get(celula) || new Map();
          mapa.set(grupoProduto, (mapa.get(grupoProduto) || 0) + cargaMin * fatia);
          cargaCelulaGrupo.set(celula, mapa);
        }
      }
    }

    // Capacidade diaria de cada grupo de produto, pela fatia que ele ocupa em cada celula.
    const capDiariaGrupo = new Map();
    for (const [celula, mapa] of cargaCelulaGrupo) {
      const capCelula = Math.max(0, Number(capDiariaCelula.get(celula) || 0));
      if (!capCelula) continue;
      const totalCelula = [...mapa.values()].reduce((a, b) => a + b, 0);
      if (!(totalCelula > 0)) continue;
      for (const [grupoProduto, cargaDoGrupo] of mapa) {
        capDiariaGrupo.set(grupoProduto, (capDiariaGrupo.get(grupoProduto) || 0) + capCelula * (cargaDoGrupo / totalCelula));
      }
    }

    const periodos = calcularPeriodosPlano(hoje).meses;
    const diasPorPeriodo = {};
    let diasAcum = 0;
    for (const per of PERIODOS_PLANO) {
      diasAcum += diasDisponiveisDoPeriodo(periodos[per], hoje);
      diasPorPeriodo[per] = diasAcum;
    }

    // GRUPOS DE COSTURA de cada familia.
    //
    // Abrir a familia mostrava a conta (pecas, carga, capacidade) e nao mostrava a FABRICA.
    // O que o PCP quer ver ao abrir SUTIA e QUAIS celulas costuram sutia e qual delas esta
    // estourada — porque e nela que se age, nao na familia inteira.
    //
    // A ocupacao aqui e da CELULA, somando todas as familias que passam por ela, nao so a
    // que esta aberta: uma celula pode estar cheia por causa de outra familia, e esconder
    // isso faria a tela sugerir folga onde nao ha.
    const diasHorizonte = diasPorPeriodo[PERIODOS_PLANO[PERIODOS_PLANO.length - 1]] || 0;
    const cargaTotalDaCelula = new Map();
    for (const [celula, mapa] of cargaCelulaGrupo) {
      cargaTotalDaCelula.set(celula, [...mapa.values()].reduce((a, b) => a + b, 0));
    }
    const celulasDaFamilia = (familia) => {
      const saida = [];
      for (const [celula, mapa] of cargaCelulaGrupo) {
        const cargaFamilia = Number(mapa.get(familia) || 0);
        if (!(cargaFamilia > 0)) continue;
        const cargaCelula = Number(cargaTotalDaCelula.get(celula) || 0);
        const capCelula = Math.max(0, Number(capDiariaCelula.get(celula) || 0));
        const capHorizonte = capCelula * diasHorizonte;
        saida.push({
          celula,
          capacidadeDiaria: Number(capCelula.toFixed(2)),
          cargaFamiliaMin: Math.round(cargaFamilia),
          cargaCelulaMin: Math.round(cargaCelula),
          // Quanto desta celula e consumido pela familia aberta.
          fatiaDaFamilia: cargaCelula > 0 ? Number((cargaFamilia / cargaCelula).toFixed(4)) : 0,
          // Ocupacao da CELULA no horizonte, com todas as familias dentro.
          ocupacaoCelula: capHorizonte > 0 ? Number((cargaCelula / capHorizonte).toFixed(4)) : null,
          // Capacidade medida zero = celula desativada ou sem medicao no periodo.
          semCapacidade: !(capCelula > 0),
        });
      }
      return saida.sort((a, b) => b.cargaFamiliaMin - a.cargaFamiliaMin);
    };

    const dados = [...porGrupoProduto.entries()]
      .map(([grupo, v]) => {
        const capDiaria = Number(capDiariaGrupo.get(grupo) || 0);
        let cargaAcum = 0;
        let semCelulaAcum = 0;
        let pecasAcum = 0;
        const meses = PERIODOS_PLANO.map((per) => {
          cargaAcum += v.carga[per];
          semCelulaAcum += v.cargaSemCelula[per];
          pecasAcum += v.pecas[per];
          const capacidadeMin = capDiaria * diasPorPeriodo[per];
          const diasNecessarios = capDiaria > 0 ? cargaAcum / capDiaria : 0;
          return {
            periodo: per,
            mes: periodos[per],
            pecas: Math.round(v.pecas[per]),
            pecasAcum: Math.round(pecasAcum),
            cargaMin: Number(v.carga[per].toFixed(1)),
            cargaAcumMin: Number(cargaAcum.toFixed(1)),
            cargaSemCelulaMin: Number(semCelulaAcum.toFixed(1)),
            capacidadeMin: Number(capacidadeMin.toFixed(1)),
            diasNecessarios: Number(diasNecessarios.toFixed(2)),
            diasDisponiveis: diasPorPeriodo[per],
            // Ocupacao e gap ACUMULADOS, como no resto do sistema: o que nao cabe num mes
            // transborda para o seguinte.
            ocupacao: capacidadeMin > 0 ? Number((cargaAcum / capacidadeMin).toFixed(4)) : null,
            gapDias: Number((diasNecessarios - diasPorPeriodo[per]).toFixed(2)),
          };
        });
        // Fatia sem celula do HORIZONTE INTEIRO, nao de cada periodo. Por periodo ela
        // oscila (SUTIA cruzava os 30% em dez e jan e voltava em fev), e o grupo piscava
        // entre cinza e colorido ao longo da linha. Confiabilidade e propriedade do
        // CADASTRO do grupo, nao do mes.
        const fatiaSemCelula = cargaAcum > 0 ? Number((semCelulaAcum / cargaAcum).toFixed(4)) : 0;
        return {
          grupo,
          capacidadeDiaria: Number(capDiaria.toFixed(2)),
          // Fatia do grupo na fabrica, para a tela saber o que vale a pena abrir.
          fatiaCapacidade: capacidadeDiariaTotal > 0 ? Number((capDiaria / capacidadeDiariaTotal).toFixed(4)) : 0,
          pecasHorizonte: Math.round(pecasAcum),
          // Nomeada pelo PCP: a tela mostra sempre, sem passar pelo corte de tamanho.
          nomeada: FAMILIAS_NOMEADAS.has(grupo),
          celulas: celulasDaFamilia(grupo),
          fatiaSemCelula,
          refsSemCelula: [...semCelulaPorRef.values()]
            .filter((x) => x.grupo === grupo)
            .sort((a, b) => b.minutos - a.minutos)
            .slice(0, 12)
            .map((x) => ({
              referencia: x.referencia,
              produto: x.produto,
              pecas: Math.round(x.pecas),
              minutos: Math.round(x.minutos),
            })),
          meses,
        };
      })
      .sort((a, b) => b.pecasHorizonte - a.pecasHorizonte);

    const payload = {
      success: true,
      de,
      ate,
      aplicarAprovadas,
      loteId: loteId || null,
      alocacao,
      temMedida,
      capacidadeDiariaTotal: Number(capacidadeDiariaTotal.toFixed(2)),
      periodos,
      dados,
    };
    ocupGrupoCache.chave = chaveCache;
    ocupGrupoCache.data = payload;
    ocupGrupoCache.timestamp = Date.now();
    return res.json(payload);
  } catch (error) {
    console.error('[capacidade/ocupacao-por-grupo-produto] Erro:', error);
    return res.status(500).json({ success: false, error: 'Erro ao calcular ocupacao por grupo de produto', details: error.message });
  }
});

/**
 * GET /api/capacidade/indice-mensal
 *
 * Perfil sazonal da produtividade diaria, por mes do calendario. A capacidade que o
 * dias-resumo entrega e de UM mes so (o ultimo fechado) e vale para o horizonte inteiro;
 * este indice diz o quanto cada mes historicamente rende acima ou abaixo da media.
 *
 * Duas decisoes que explicam o numero:
 *
 * 1) E por dia TRABALHADO, nao por dia util do calendario. O modelo da tela ja multiplica
 *    pela quantidade de dias disponiveis (sem feriado, sem coletiva), entao um indice por
 *    dia util contaria o efeito do calendario duas vezes — dezembro cairia para 0,665 so
 *    por causa da coletiva que ja foi descontada nos dias.
 *
 * 2) E DESTENDENCIADO: cada mes e dividido pela media do proprio ano antes de entrar. A
 *    fabrica ficou ~5% mais produtiva de 2025 para 2026, e out/nov/dez so tem observacao
 *    de 2025 — sem isso eles herdariam a produtividade antiga e apareceriam piores por
 *    falta de dado, nao por sazonalidade.
 *
 * Cuidado conhecido: dias_com_movimento conta sabado, que rende menos que um dia cheio.
 * Mes com mais sabado trabalhado puxa a media para baixo sem que a fabrica tenha piorado,
 * entao parte da amplitude de 14% e esse efeito, nao estacao.
 */
router.get('/indice-mensal', auth, async (req, res) => {
  try {
    const pool = req.app.get('pool');
    if (!pool) return res.status(500).json({ success: false, error: 'Pool de conexao nao disponivel' });

    const desde = String(req.query.desde || '2025-07-01');
    // cenario=anterior reproduz a conta de antes da desativacao: todos os locais do ERP,
    // sem filtrar pelos nomes ativos (inclui Progresso e Oficina Atila).
    const anterior = req.query.cenario === 'anterior';
    const gruposAtivos = anterior ? null : (await readGrupos(req.app.get("pool"))).map((grupo) => grupo.grupo);
    const { rows } = await pool.query(`
      SELECT to_char(DATE_TRUNC('month', e.dt_ref),'YYYY-MM') AS competencia,
             EXTRACT(YEAR FROM e.dt_ref)::INT AS ano,
             EXTRACT(MONTH FROM e.dt_ref)::INT AS mes,
             SUM(COALESCE(e.tempo_produzido_min, 0))::FLOAT AS minutos,
             COUNT(DISTINCT e.dt_ref)::INT AS dias
        FROM pcp_cache_eficiencia_dia e
        LEFT JOIN pcp_cache_locais l ON l.cd_local::text = e.cd_grupo::text
       WHERE e.cd_grupo::text = ANY($2::text[])
         AND ($3::text[] IS NULL OR UPPER(TRIM(l.ds_local)) = ANY($3::text[]))
         AND e.dt_ref >= $1::date AND e.dt_ref < DATE_TRUNC('month', CURRENT_DATE)::date
         AND EXTRACT(ISODOW FROM e.dt_ref) BETWEEN 1 AND 5
         AND COALESCE(e.tempo_produzido_min, 0) > 0
       GROUP BY 1, 2, 3
       ORDER BY 1
    `, [desde, DEFAULT_REAL_GROUP_IDS.map(String), gruposAtivos]);

    const obs = rows
      .map((r) => ({ competencia: r.competencia, ano: Number(r.ano), mes: Number(r.mes),
                     minutos: Number(r.minutos), dias: Number(r.dias),
                     porDia: Number(r.dias) > 0 ? Number(r.minutos) / Number(r.dias) : 0 }))
      .filter((o) => o.porDia > 0);
    if (!obs.length) return res.json({ success: true, desde, nivel: 0, data: {} });

    const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;
    const mediaDoAno = new Map();
    for (const o of obs) {
      const a = mediaDoAno.get(o.ano) || { soma: 0, n: 0 };
      a.soma += o.porDia; a.n += 1;
      mediaDoAno.set(o.ano, a);
    }
    const baseDoAno = (ano) => { const a = mediaDoAno.get(ano); return a && a.n ? a.soma / a.n : 1; };

    const data = {};
    const detalhe = [];
    for (let mes = 1; mes <= 12; mes += 1) {
      const doMes = obs.filter((o) => o.mes === mes);
      const indice = doMes.length ? media(doMes.map((o) => o.porDia / baseDoAno(o.ano))) : 1;
      data[String(mes)] = Number(indice.toFixed(4));
      detalhe.push({ mes, indice: Number(indice.toFixed(4)), observacoes: doMes.length,
                     competencias: doMes.map((o) => o.competencia) });
    }

    // Nivel: media dos tres ultimos meses fechados, na mesma formula.
    const ultimos = obs.slice(-3);
    const nivel = Math.round(media(ultimos.map((o) => o.porDia)));

    res.json({
      success: true,
      desde,
      nivel,
      nivelBase: ultimos.map((o) => o.competencia),
      base: 'minutos produzidos somados, divididos pelos dias em que a fabrica rodou (seg-sex)',
      data,
      ...(req.query.detalhe === '1' ? { detalhe, serie: obs } : {}),
    });
  } catch (err) {
    console.error('[capacidade/indice-mensal] Erro:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
