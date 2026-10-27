const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

process.env.ADMIN_PASSWORD = "teste-local";
process.env.TOTVS_MODA_CLIENT_ID = "teste-local";
process.env.TOTVS_MODA_CLIENT_SECRET = "teste-local";

const originalFetch = global.fetch;
let costBatches = [];
let secondBatchFailure = "none";
let secondBatchAttempts = 0;

global.fetch = async (url, options) => {
  if (String(url).includes("/authorization/v2/token")) {
    return new Response(JSON.stringify({ access_token: "token-local", expires_in: 300 }), { status: 200 });
  }
  if (String(url).includes("/costs/search")) {
    const codes = JSON.parse(options.body).filter.productCodeList;
    costBatches.push(codes);
    if (Number(codes[0]) === 1000251) secondBatchAttempts++;
    if (Number(codes[0]) === 1000251 &&
        (secondBatchFailure === "always" ||
         (secondBatchFailure === "once" && secondBatchAttempts === 1))) {
      return new Response(JSON.stringify({ error: "falha simulada" }), { status: 502 });
    }
    return new Response(JSON.stringify(codes.map((productCode) => ({
      productCode,
      costs: [{ cost: 12.5, branchCode: 1, costCode: 2 }],
    }))), { status: 200 });
  }
  throw new Error(`URL inesperada: ${url}`);
};

async function request(server, productCodes) {
  const body = JSON.stringify({ productCodes });
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: server.address().port,
      path: "/api/totvs-moda/prices/mp",
      method: "POST",
      headers: {
        Authorization: "Bearer teste-local",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let response = "";
      res.on("data", (chunk) => { response += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(response) }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use("/api/totvs-moda", require("../src/routes/totvsModa"));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const codes = Array.from({ length: 501 }, (_, index) => String(1000001 + index));
    const ok = await request(server, codes);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.success, true);
    assert.equal(Object.keys(ok.body.data).length, 501);
    assert.equal(ok.body.rawCount, 501);
    assert.deepEqual(costBatches.map((batch) => batch.length), [250, 250, 1]);

    costBatches = [];
    secondBatchAttempts = 0;
    secondBatchFailure = "once";
    const recovered = await request(server, codes);
    assert.equal(recovered.status, 200);
    assert.equal(Object.keys(recovered.body.data).length, 501);
    assert.deepEqual(costBatches.map((batch) => batch.length), [250, 250, 250, 1]);

    costBatches = [];
    secondBatchAttempts = 0;
    secondBatchFailure = "always";
    const failed = await request(server, codes);
    assert.equal(failed.status, 502);
    assert.equal(failed.body.success, false);
    assert.deepEqual(costBatches.map((batch) => batch.length), [250, 250, 250, 250]);
    console.log("Precos em lotes: 501 codigos; 502 temporario recuperado; falha persistente nao gera resposta parcial.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = originalFetch;
  }
}

main().catch((error) => {
  global.fetch = originalFetch;
  console.error(error);
  process.exitCode = 1;
});
