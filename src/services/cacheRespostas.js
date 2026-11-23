// CACHE DE RESPOSTAS — "serve o que tem e atualiza por trás" (23/11/2026, pedido do PCP).
//
// A Visão Geral 2 e a aba Capacidade x Plano dependem de rotas que, frias, levam de 10 a 70 s
// (min-peca-move 68 s, plano-por-mes-real 32 s, distribuição 29 s, plano-ano 17 s — medido em
// 23/11/2026). Cada rota tem um cache próprio de UMA entrada, que vence em 10-30 min: quem
// abre a tela depois disso espera a conta inteira de novo.
//
// Aqui, na frente das rotas lentas (só GET, só a lista abaixo):
//   - resposta guardada é servida NA HORA, mesmo velha;
//   - se passou de `fresco`, a tela recebe a guardada e o servidor refaz por trás (chamando a
//     própria API), para a próxima abertura já vir nova;
//   - um laço refaz por trás as respostas pedidas recentemente antes de envelhecerem, então
//     quem volta depois de uma hora não paga a conta fria;
//   - `refresh=true` (botão Atualizar) passa direto e grava a resposta nova;
//   - qualquer escrita (POST/PUT/PATCH/DELETE) em /api apaga tudo: depois de gravar, a tela
//     não pode mostrar o que era antes.
//
// Segurança: resposta gerada com o token só é servida para quem manda o token. Rota que
// respondeu 200 SEM token é pública e pode ser servida a qualquer um.
//
// Memória: limite em bytes (padrão 80 MB, `CACHE_RESPOSTAS_MB`); sai a menos usada.
// Nada vai para o banco: o cache vive no processo. Depois de um deploy, o aquecimento do
// boot (`aquecer`) refaz as rotas mais caras.

const http = require('http');

const MIN = 60 * 1000;
// Prefixos cobertos e quanto tempo a resposta conta como nova.
const ROTAS = [
  { prefixo: '/api/capacidade/distribuicao-sugerida', fresco: 15 * MIN },
  { prefixo: '/api/capacidade/min-peca-move', fresco: 60 * MIN },
  { prefixo: '/api/capacidade/min-peca-medido', fresco: 60 * MIN },
  { prefixo: '/api/capacidade/capacidade-mensal', fresco: 30 * MIN },
  { prefixo: '/api/capacidade/indice-mensal', fresco: 60 * MIN },
  { prefixo: '/api/capacidade/dias-resumo', fresco: 10 * MIN },
  { prefixo: '/api/capacidade/gap-mensal', fresco: 10 * MIN },
  { prefixo: '/api/capacidade/estoque-liebe', fresco: 30 * MIN },
  { prefixo: '/api/capacidade/tempos-por-grupo', fresco: 60 * MIN },
  { prefixo: '/api/capacidade/real', fresco: 15 * MIN },
  { prefixo: '/api/producao/plano-por-mes-real', fresco: 10 * MIN },
  { prefixo: '/api/analise-capacidade/plano-ano', fresco: 15 * MIN },
  { prefixo: '/api/analise-capacidade/finalizado', fresco: 30 * MIN },
  { prefixo: '/api/projecao-edicao-limitada', fresco: 30 * MIN },
  { prefixo: '/api/projecoes/por-mes', fresco: 30 * MIN },
  { prefixo: '/api/analises/projetado-vs-realizado', fresco: 30 * MIN },
];
// Respostas pedidas nas últimas horas continuam sendo refeitas por trás; depois disso param
// (não gasta banco com tela que ninguém abre).
const MANTER_VIVA = 8 * 60 * MIN;
const LIMITE_BYTES = (Number(process.env.CACHE_RESPOSTAS_MB) || 80) * 1024 * 1024;

const entradas = new Map(); // chave -> { corpo, em, usadoEm, bytes, publica, url, auth, fresco }
const refazendo = new Set();
let bytesTotal = 0;
let porta = 8000;

const tokenValido = (req) => {
  const esperado = String(process.env.ADMIN_PASSWORD || '').trim();
  const token = String(req.headers.authorization || '').replace('Bearer ', '').trim();
  return Boolean(esperado) && token === esperado;
};

function rotaDe(caminho) {
  return ROTAS.find((r) => caminho === r.prefixo || caminho.startsWith(`${r.prefixo}/`) || caminho.startsWith(`${r.prefixo}?`));
}

// Chave = caminho + parâmetros em ordem, sem o `refresh`.
function chaveDe(urlOriginal) {
  const u = new URL(urlOriginal, 'http://local');
  u.searchParams.delete('refresh');
  // `_ts` é o fura-cache do navegador (lib/api.ts, fetchNoCache): muda a cada pedido e não
  // muda a resposta. Com ele na chave, nenhum pedido acertaria o cache.
  u.searchParams.delete('_ts');
  u.searchParams.sort();
  const qs = u.searchParams.toString();
  return qs ? `${u.pathname}?${qs}` : u.pathname;
}

function remover(chave) {
  const e = entradas.get(chave);
  if (!e) return;
  bytesTotal -= e.bytes;
  entradas.delete(chave);
}

function guardar(chave, dados) {
  remover(chave);
  entradas.set(chave, dados);
  bytesTotal += dados.bytes;
  // Sai a menos usada até caber.
  if (bytesTotal > LIMITE_BYTES) {
    const ordem = [...entradas.entries()].sort((a, b) => a[1].usadoEm - b[1].usadoEm);
    for (const [k] of ordem) {
      if (bytesTotal <= LIMITE_BYTES) break;
      if (k !== chave) remover(k);
    }
  }
}

// Refaz uma resposta chamando a própria API, com o cabeçalho que manda gravar.
function refazer(chave) {
  const e = entradas.get(chave);
  if (!e || refazendo.has(chave)) return Promise.resolve();
  refazendo.add(chave);
  return new Promise((ok) => {
    const req = http.request({
      host: '127.0.0.1', port: porta, path: e.url, method: 'GET',
      headers: { ...(e.auth ? { authorization: e.auth } : {}), 'x-cache-refazer': '1' },
      timeout: 10 * MIN,
    }, (res) => { res.resume(); res.on('end', ok); res.on('error', ok); });
    req.on('error', ok);
    req.on('timeout', () => { req.destroy(); ok(); });
    req.end();
  }).finally(() => refazendo.delete(chave));
}

// Embrulha res.json para guardar o que a rota responder (só sucesso).
function capturar(req, res, chave, rota, publica) {
  const original = res.json.bind(res);
  res.json = (corpo) => {
    if (res.statusCode < 400 && corpo && corpo.success !== false) {
      try {
        const texto = JSON.stringify(corpo);
        const anterior = entradas.get(chave);
        guardar(chave, {
          corpo: texto,
          em: Date.now(),
          usadoEm: anterior ? anterior.usadoEm : Date.now(),
          bytes: Buffer.byteLength(texto),
          publica,
          url: chave, // caminho + parâmetros, sem o refresh: serve para refazer
          auth: publica ? '' : String(req.headers.authorization || ''),
          fresco: rota.fresco,
        });
      } catch { /* resposta que não serializa: só não guarda */ }
    }
    return original(corpo);
  };
}

// POSTs que só LEEM (calculam e devolvem) ou gravam coisa que estas rotas não leem: não
// apagam o cache. Todo o resto apaga — na dúvida, apagar é o seguro.
const POST_SO_LEITURA = /\/(calcular|calcular-lote|analise|analyser|diagnostico|check-produto|check-risco-lote|test|login|projecao-vs-venda|cenarios)(\/|$)|\/orcamento-mp-|\/prices\/mp/;

function middleware(req, res, next) {
  // Escrita apaga tudo: o que vier depois tem de refletir o que foi gravado.
  if (req.method !== 'GET') {
    if (req.path.startsWith('/api/') && entradas.size && !POST_SO_LEITURA.test(req.path)) {
      res.on('finish', () => { if (res.statusCode < 400) { entradas.clear(); bytesTotal = 0; } });
    }
    return next();
  }
  const rota = rotaDe(req.path);
  if (!rota) return next();
  const chave = chaveDe(req.originalUrl);
  const comToken = tokenValido(req);
  // Refação por trás (ou botão Atualizar): vai à rota e grava.
  if (req.headers['x-cache-refazer'] === '1' || req.query.refresh === 'true') {
    capturar(req, res, chave, rota, !comToken);
    return next();
  }
  const e = entradas.get(chave);
  if (e && (e.publica || comToken)) {
    e.usadoEm = Date.now();
    const idade = Date.now() - e.em;
    res.set('X-Cache', idade < e.fresco ? 'HIT' : 'STALE');
    res.set('X-Cache-Idade', String(Math.round(idade / 1000)));
    res.type('application/json').send(e.corpo);
    if (idade >= e.fresco) refazer(chave);
    return undefined;
  }
  capturar(req, res, chave, rota, !comToken);
  return next();
}

// Mantém vivo o que foi pedido nas últimas horas: refaz um pouco antes de envelhecer.
// UMA POR VEZ: o banco é dividido com o ERP e outros sistemas e já recusou conexão
// ("remaining connection slots") — refazer tudo junto seria pedir para cair.
let aquecendo = false;
async function manterQuente() {
  if (aquecendo) return;
  aquecendo = true;
  try {
    const agora = Date.now();
    const vencendo = [...entradas.entries()]
      .filter(([, e]) => agora - e.usadoEm <= MANTER_VIVA && agora - e.em >= e.fresco * 0.8)
      .map(([chave]) => chave);
    for (const chave of vencendo) await refazer(chave);
  } finally {
    aquecendo = false;
  }
}

// Boot: pede as rotas mais caras (com as mesmas URLs das telas) para a primeira abertura
// depois de um deploy não pagar a conta fria. Em série, para não afogar o banco.
async function aquecer(urls) {
  const auth = `Bearer ${String(process.env.ADMIN_PASSWORD || '').trim()}`;
  const t0 = Date.now();
  for (const url of urls) {
    await new Promise((ok) => {
      const req = http.request({ host: '127.0.0.1', port: porta, path: url, method: 'GET', headers: { authorization: auth }, timeout: 10 * MIN },
        (res) => { res.resume(); res.on('end', ok); res.on('error', ok); });
      req.on('error', ok);
      req.on('timeout', () => { req.destroy(); ok(); });
      req.end();
    });
  }
  console.log(`[cache-respostas] aquecido: ${urls.length} rotas em ${((Date.now() - t0) / 1000).toFixed(0)}s, ${(bytesTotal / 1048576).toFixed(1)} MB`);
}

function iniciar(portaApi) {
  porta = portaApi;
  setInterval(manterQuente, 2 * MIN).unref();
}

function estado() {
  return {
    entradas: entradas.size,
    mb: Number((bytesTotal / 1048576).toFixed(1)),
    itens: [...entradas.entries()].map(([chave, e]) => ({ chave: chave.slice(0, 140), idadeSeg: Math.round((Date.now() - e.em) / 1000), kb: Math.round(e.bytes / 1024), publica: e.publica })),
  };
}

module.exports = { middleware, iniciar, aquecer, estado, chaveDe };
