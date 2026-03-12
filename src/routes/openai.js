const express = require("express");

const router = express.Router();

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

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function calcularTermometro(params = {}, pesos = {}) {
  const variacaoJanPct = toNumber(params.variacaoJanPct, 0);
  const variacaoFevPct = toNumber(params.variacaoFevPct, 0);
  const variacaoMarPct = toNumber(params.variacaoMarPct, 0);
  const coberturaAtual = toNumber(params.coberturaAtual, 0);
  const coberturaAlvo = toNumber(params.coberturaAlvo, 1);
  const pecasNegativasAtual = Math.max(0, toNumber(params.pecasNegativasAtual, 0));
  const pecasNegativasMA = Math.max(0, toNumber(params.pecasNegativasMA, 0));
  const pecasNegativasPX = Math.max(0, toNumber(params.pecasNegativasPX, 0));
  const pecasNegativasUL = Math.max(0, toNumber(params.pecasNegativasUL, 0));
  const taxaJan = toNumber(params.taxaJan, 1);
  const taxaFev = toNumber(params.taxaFev, 1);
  const taxaMar = toNumber(params.taxaMar, 1);

  const w = {
    variacao: toNumber(pesos.variacao, 0.35),
    cobertura: toNumber(pesos.cobertura, 0.30),
    negativos: toNumber(pesos.negativos, 0.20),
    aderencia: toNumber(pesos.aderencia, 0.15),
  };
  const somaPesos = w.variacao + w.cobertura + w.negativos + w.aderencia || 1;
  w.variacao /= somaPesos;
  w.cobertura /= somaPesos;
  w.negativos /= somaPesos;
  w.aderencia /= somaPesos;

  // Score de variação: mede intensidade de mudança (alta ou queda) vs estabilidade.
  const mediaAbsVariacao = (Math.abs(variacaoJanPct) + Math.abs(variacaoFevPct) + Math.abs(variacaoMarPct)) / 3;
  const scoreVariacao = clamp((mediaAbsVariacao / 50) * 100, 0, 100);

  // Score de cobertura: quanto abaixo da meta.
  const gapCob = Math.max(0, coberturaAlvo - coberturaAtual);
  const scoreCobertura = clamp((gapCob / Math.max(0.1, coberturaAlvo)) * 100, 0, 100);

  // Score de negativos: peso no mês atual e trajetória até UL.
  const referenciaNegativos = Math.max(1, toNumber(params.referenciaNegativos, 50000));
  const mediaNegativos = (pecasNegativasAtual * 0.4) + (pecasNegativasMA * 0.25) + (pecasNegativasPX * 0.2) + (pecasNegativasUL * 0.15);
  const scoreNegativos = clamp((mediaNegativos / referenciaNegativos) * 100, 0, 100);

  // Score de aderência: distância da execução ideal (1.0).
  const mediaGapTaxa = (Math.abs(1 - taxaJan) + Math.abs(1 - taxaFev) + Math.abs(1 - taxaMar)) / 3;
  const scoreAderencia = clamp(mediaGapTaxa * 100, 0, 100);

  const score = clamp(
    (scoreVariacao * w.variacao) +
    (scoreCobertura * w.cobertura) +
    (scoreNegativos * w.negativos) +
    (scoreAderencia * w.aderencia),
    0,
    100
  );

  let nivel = "BAIXO";
  if (score >= 75) nivel = "CRITICO";
  else if (score >= 55) nivel = "ALTO";
  else if (score >= 35) nivel = "MODERADO";

  return {
    score: Number(score.toFixed(1)),
    nivel,
    componentes: {
      variacao: Number(scoreVariacao.toFixed(1)),
      cobertura: Number(scoreCobertura.toFixed(1)),
      negativos: Number(scoreNegativos.toFixed(1)),
      aderencia: Number(scoreAderencia.toFixed(1)),
    },
    pesos: w,
  };
}

function gerarEstrategiaBase(params = {}, termometro = {}) {
  const variacaoJanPct = toNumber(params.variacaoJanPct, 0);
  const variacaoFevPct = toNumber(params.variacaoFevPct, 0);
  const variacaoMarPct = toNumber(params.variacaoMarPct, 0);
  const taxaJan = toNumber(params.taxaJan, 1);
  const taxaFev = toNumber(params.taxaFev, 1);
  const taxaMar = toNumber(params.taxaMar, 1);
  const coberturaAtual = toNumber(params.coberturaAtual, 0);
  const coberturaAlvo = toNumber(params.coberturaAlvo, 1);
  const pecasNegativasAtual = Math.max(0, toNumber(params.pecasNegativasAtual, 0));
  const pctSkusAbaixo05 = toNumber(params.pctSkusAbaixo05, 0);
  const qtdVacasLeiteirasRisco = Math.max(0, toNumber(params.qtdVacasLeiteirasRisco, 0));
  const quickWinPecas = Math.max(0, toNumber(params.quickWinPecas, 0));
  const quickWinSkus = Math.max(0, toNumber(params.quickWinSkus, 0));

  const quedasSeguidas = variacaoJanPct < 0 && variacaoFevPct < 0 && variacaoMarPct < 0;
  const aderenciaBaixa = taxaJan <= 0.7 && taxaFev <= 0.7;
  const riscoRupturaElevado = pecasNegativasAtual > 0 || pctSkusAbaixo05 >= 20;
  const vacasLeiteirasEmRisco = qtdVacasLeiteirasRisco > 0;
  const precisaReduzir = quedasSeguidas && aderenciaBaixa;
  const precisaReforcar = riscoRupturaElevado || vacasLeiteirasEmRisco;

  const sinais = [
    {
      codigo: "RUPTURA_POR_VENDA",
      ativo: precisaReforcar,
      descricao: "Negativos e/ou baixa cobertura indicam risco de ruptura por aumento de venda.",
    },
    {
      codigo: "EXCESSO_SEM_VENDA",
      ativo: precisaReduzir,
      descricao: "Projeção e aderência em queda sugerem produção acima da necessidade de venda.",
    },
    {
      codigo: "VACAS_LEITEIRAS_RISCO",
      ativo: vacasLeiteirasEmRisco,
      descricao: "Itens de maior giro próximos da ruptura precisam reforço prioritário.",
    },
    {
      codigo: "MASSA_ABAIXO_05",
      ativo: pctSkusAbaixo05 > 0,
      descricao: "Parcela relevante de SKUs abaixo de 0.5x de cobertura.",
    },
  ];

  const filtrosSugeridos = [];

  if (quickWinPecas > 0) {
    filtrosSugeridos.push({
      objetivo: "RETIRAR",
      nome: "Quick win de retirada segura",
      criterios: {
        baseCobertura: "MA",
        coberturaMinimaFaixa: 2,
        taxaJanMax: 0.7,
        taxaFevMax: 0.7,
        coberturaAlvo: 1,
        coberturaMinimaUL: 0.8,
        potencialPecas: quickWinPecas,
        potencialSkus: quickWinSkus,
      },
      prioridade: "ALTA",
    });
  }

  if (precisaReduzir) {
    filtrosSugeridos.push({
      objetivo: "RETIRAR",
      nome: "Queda com baixa aderência",
      criterios: {
        taxaJanMax: 0.7,
        taxaFevMax: 0.7,
        tendenciaProjecao: "QUEDA",
        coberturaMinParaRetirada: Math.max(0.7, coberturaAlvo),
      },
      prioridade: "ALTA",
    });
  }

  if (precisaReforcar) {
    filtrosSugeridos.push({
      objetivo: "AUMENTAR",
      nome: "Risco de ruptura",
      criterios: {
        coberturaMax: 0.5,
        disponivelNegativo: true,
        focarTop30: true,
      },
      prioridade: "ALTA",
    });
  }

  if (vacasLeiteirasEmRisco) {
    filtrosSugeridos.push({
      objetivo: "AUMENTAR",
      nome: "Vacas leiteiras em risco",
      criterios: {
        grupo: "TOP30_REFERENCIAS",
        riscoRuptura: true,
        coberturaAlvo: Math.max(1.2, coberturaAlvo),
      },
      prioridade: "ALTA",
    });
  }

  if (!filtrosSugeridos.length) {
    filtrosSugeridos.push({
      objetivo: "MONITORAR",
      nome: "Ajuste fino",
      criterios: {
        scoreTermometro: termometro.score || 0,
        coberturaAtual,
        coberturaAlvo,
      },
      prioridade: "MEDIA",
    });
  }

  const planoAcaoInicial = [];
  if (quickWinPecas > 0) {
    planoAcaoInicial.push(`Aplicar quick win imediato: retirar ~${Math.round(quickWinPecas)} peças em ~${Math.round(quickWinSkus)} SKUs sem romper UL (>=0.8x).`);
  }
  if (precisaReduzir) planoAcaoInicial.push("Aplicar retirada gradual em MA/PX/UL para SKUs com queda + taxa Jan/Fev <= 70%.");
  if (precisaReforcar) planoAcaoInicial.push("Priorizar aumento nos negativos e coberturas <= 0.5x, começando por Top 30.");
  if (vacasLeiteirasEmRisco) planoAcaoInicial.push("Blindar vacas leiteiras com cobertura mínima de segurança acima dos demais.");
  if (!planoAcaoInicial.length) planoAcaoInicial.push("Manter plano e revisar semanalmente os sinais do termômetro.");

  return {
    sinais,
    filtrosSugeridos,
    planoAcaoInicial,
    leitura: {
      quedasSeguidas,
      aderenciaBaixa,
      riscoRupturaElevado,
      vacasLeiteirasEmRisco,
      taxaMar,
    },
  };
}

router.post("/test", auth, async (req, res) => {
  try {
    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      return res.status(400).json({ success: false, error: "OPENAI_API_KEY não configurada no .env" });
    }

    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) {
      return res.status(400).json({ success: false, error: "prompt é obrigatório" });
    }

    const model = String(req.body?.model || "gpt-4.1-mini");

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: prompt,
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({
        success: false,
        error: data?.error?.message || "Erro ao chamar OpenAI",
        details: data,
      });
    }

    const outputText =
      Array.isArray(data?.output)
        ? data.output
            .flatMap((item) => item.content || [])
            .filter((c) => c.type === "output_text")
            .map((c) => c.text || "")
            .join("")
        : "";

    return res.json({
      success: true,
      model: data?.model || model,
      output_text: outputText,
      raw: data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao processar requisição OpenAI",
      details: error.message,
    });
  }
});

router.post("/analyser", auth, async (req, res) => {
  try {
    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      return res.status(400).json({ success: false, error: "OPENAI_API_KEY não configurada no .env" });
    }

    const nomeCenario = String(req.body?.nomeCenario || "Cenário sem nome").trim();
    const parametros = req.body?.parametros || {};
    const pesos = req.body?.pesos || {};
    const model = String(req.body?.model || "gpt-4.1-mini");

    const termometro = calcularTermometro(parametros, pesos);
    const estrategiaBase = gerarEstrategiaBase(parametros, termometro);

    const prompt = [
      "Você é um analista de PCP (plano de produção).",
      "Responda APENAS em JSON válido com as chaves:",
      "{ resumoExecutivo: string, diagnostico: string[], acoesRecomendadas: string[], riscos: string[], oportunidades: string[], filtrosSugeridos: Array<{objetivo:string,nome:string,criterios:object,prioridade:string}>, planoAcaoInicial: string[] }",
      "Contexto do cenário:",
      JSON.stringify({ nomeCenario, parametros, termometro, estrategiaBase }),
      "Regras:",
      "- Objetivo: balancear plano para reduzir negativos sem criar sobra excessiva.",
      "- Considere queda/subida de projeção e aderência Jan/Fev/Mar.",
      "- Se score alto, priorize ações gradativas por mês.",
      "- Reflita os 4 eixos: ruptura por venda, produção sem necessidade, vacas leiteiras em risco e massa abaixo de 0.5x.",
      "- Entregar filtros objetivos que possam ser aplicados no laboratório.",
      "- Seja direto e acionável.",
    ].join("\n");

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: prompt,
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({
        success: false,
        error: data?.error?.message || "Erro ao chamar OpenAI",
        termometro,
        details: data,
      });
    }

    const outputText =
      Array.isArray(data?.output)
        ? data.output
            .flatMap((item) => item.content || [])
            .filter((c) => c.type === "output_text")
            .map((c) => c.text || "")
            .join("")
        : "";

    let analise = null;
    try {
      analise = JSON.parse(outputText);
    } catch {
      // fallback: tenta extrair bloco JSON
      const m = outputText.match(/\{[\s\S]*\}/);
      if (m) {
        try { analise = JSON.parse(m[0]); } catch { /* noop */ }
      }
    }

    return res.json({
      success: true,
      nomeCenario,
      termometro,
      estrategiaBase,
      analise,
      texto: outputText,
      model: data?.model || model,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao executar analyser",
      details: error.message,
    });
  }
});

router.post("/diagnostico", auth, async (req, res) => {
  try {
    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      return res.status(400).json({ success: false, error: "OPENAI_API_KEY não configurada no .env" });
    }

    const model = String(req.body?.model || "gpt-4.1-mini");
    const nomeCenario = String(req.body?.nomeCenario || "Diagnóstico PCP").trim();
    const contexto = req.body?.contexto || {};
    const parametros = req.body?.parametros || {};
    const pesos = req.body?.pesos || {};
    const focoUsuario = String(req.body?.foco || "").trim();

    const termometro = calcularTermometro(parametros, pesos);
    const estrategiaBase = gerarEstrategiaBase(parametros, termometro);

    const prompt = [
      "Atue como GESTOR SÊNIOR de PCP e Supply Chain, com visão executiva e operacional.",
      "Responda APENAS em JSON válido com as chaves:",
      "{ resumoExecutivo: string, diagnosticoCurtoPrazo: string[], diagnosticoMedioPrazo: string[], diagnosticoLongoPrazo: string[], riscosCriticos: string[], oportunidades: string[], planoAcao90Dias: string[], filtrosRecomendados: Array<{objetivo:string,nome:string,prioridade:string,criterios:object}> }",
      "Contexto consolidado:",
      JSON.stringify({ nomeCenario, focoUsuario, parametros, termometro, estrategiaBase, contexto }),
      "Regras obrigatórias:",
      "- Curto prazo: NÃO sugerir aumento de plano em cima da hora; apenas reduzir/ajustar conservador.",
      "- Médio prazo: aceitar aumentos seletivos por risco/ruptura e aderência de venda.",
      "- Longo prazo: aceitar correções estruturais e radicais se necessário.",
      "- Levar em conta alertas de 30% (vermelho), 20% (amarelo), 10% (baixo risco).",
      "- Priorizar vacas leiteiras (top30) e proteção de ruptura.",
      "- Ser objetivo, acionável e em linguagem de gestão.",
    ].join("\n");

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: prompt,
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({
        success: false,
        error: data?.error?.message || "Erro ao chamar OpenAI",
        details: data,
      });
    }

    const outputText =
      Array.isArray(data?.output)
        ? data.output
            .flatMap((item) => item.content || [])
            .filter((c) => c.type === "output_text")
            .map((c) => c.text || "")
            .join("")
        : "";

    let diagnostico = null;
    try {
      diagnostico = JSON.parse(outputText);
    } catch {
      const m = outputText.match(/\{[\s\S]*\}/);
      if (m) {
        try { diagnostico = JSON.parse(m[0]); } catch { /* noop */ }
      }
    }

    return res.json({
      success: true,
      nomeCenario,
      termometro,
      estrategiaBase,
      diagnostico,
      texto: outputText,
      model: data?.model || model,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "Erro ao executar diagnóstico",
      details: error.message,
    });
  }
});

module.exports = router;
