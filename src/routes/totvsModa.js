const express = require("express");

const router = express.Router();

let tokenCache = {
  token: "",
  expiresAt: 0,
};

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
  const expected = (process.env.ADMIN_PASSWORD || "").trim();
  if (!expected || token !== expected) {
    return res.status(401).json({ success: false, error: "Nao autorizado" });
  }
  return next();
}

function cleanBaseUrl() {
  return String(process.env.TOTVS_MODA_BASE_URL || "https://www30.bhan.com.br:9443").replace(/\/+$/, "");
}

function missingConfig() {
  const required = ["TOTVS_MODA_CLIENT_ID", "TOTVS_MODA_CLIENT_SECRET"];
  const grantType = String(process.env.TOTVS_MODA_GRANT_TYPE || "client_credentials").trim();
  if (grantType === "password") {
    required.push("TOTVS_MODA_USERNAME", "TOTVS_MODA_PASSWORD");
  }
  return required.filter((key) => !String(process.env[key] || "").trim());
}

async function getTotvsToken() {
  const missing = missingConfig();
  if (missing.length) {
    throw new Error(`Configure ${missing.join(", ")} no .env para consultar a TOTVS.`);
  }

  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 30000) {
    return tokenCache.token;
  }

  const params = new URLSearchParams();
  const grantType = String(process.env.TOTVS_MODA_GRANT_TYPE || "client_credentials").trim();
  params.set("grant_type", grantType);
  params.set("client_id", String(process.env.TOTVS_MODA_CLIENT_ID || "").trim());
  params.set("client_secret", String(process.env.TOTVS_MODA_CLIENT_SECRET || "").trim());
  if (grantType === "password") {
    params.set("username", String(process.env.TOTVS_MODA_USERNAME || "").trim());
    params.set("password", String(process.env.TOTVS_MODA_PASSWORD || "").trim());
  }

  const response = await fetch(`${cleanBaseUrl()}/api/totvsmoda/authorization/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_err) {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(`TOTVS token ${response.status}: ${payload.error_description || payload.error || text || "falha na autenticacao"}`);
  }

  const accessToken = payload.access_token || payload.accessToken || payload.token;
  if (!accessToken) throw new Error("TOTVS nao retornou access_token.");

  const expiresIn = Number(payload.expires_in || payload.expiresIn || 300);
  tokenCache = {
    token: accessToken,
    expiresAt: now + Math.max(60, expiresIn - 30) * 1000,
  };
  return tokenCache.token;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return value.items || value.data || value.result || value.results || value.content || value.records || [];
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function productCodeOf(row) {
  return String(
    row.productCode ??
    row.productcode ??
    row.code ??
    row.idProduct ??
    row.idproduto ??
    row.idProduto ??
    ""
  ).trim();
}

function flattenPriceOptions(payload) {
  const rows = asArray(payload);
  const optionsByProduct = new Map();

  for (const row of rows) {
    const productCode = productCodeOf(row);
    if (!productCode) continue;
    const rawPrices = asArray(row.prices || row.priceList || row.productPrices || row);
    const priceRows = rawPrices.length ? rawPrices : [row];

    for (const priceRow of priceRows) {
      const price = numberOrNull(priceRow.price ?? priceRow.value ?? priceRow.originalPrice ?? priceRow.originalprice);
      const promotionalPrice = numberOrNull(priceRow.promotionalPrice ?? priceRow.promotionalprice ?? priceRow.promoPrice);
      const value = promotionalPrice && promotionalPrice > 0 ? promotionalPrice : price;
      if (value === null) continue;

      const option = {
        id: [
          priceRow.branchCode ?? priceRow.branchcode ?? "",
          priceRow.priceCode ?? priceRow.pricecode ?? priceRow.code ?? "",
          priceRow.isPromotionalPrice ? "promo" : "price",
          value,
        ].join(":"),
        branchCode: numberOrNull(priceRow.branchCode ?? priceRow.branchcode),
        priceCode: numberOrNull(priceRow.priceCode ?? priceRow.pricecode ?? priceRow.code),
        description: String(priceRow.description ?? priceRow.name ?? priceRow.priceName ?? "").trim(),
        price,
        promotionalPrice,
        value,
      };

      const current = optionsByProduct.get(productCode) || [];
      current.push(option);
      optionsByProduct.set(productCode, current);
    }
  }

  const normalized = {};
  for (const [productCode, options] of optionsByProduct.entries()) {
    const unique = new Map();
    for (const option of options) unique.set(option.id, option);
    normalized[productCode] = Array.from(unique.values()).sort((a, b) => {
      if ((a.branchCode || 0) !== (b.branchCode || 0)) return (a.branchCode || 0) - (b.branchCode || 0);
      if ((a.priceCode || 0) !== (b.priceCode || 0)) return (a.priceCode || 0) - (b.priceCode || 0);
      return a.value - b.value;
    });
  }
  return normalized;
}

function flattenCostOptions(payload) {
  const rows = asArray(payload);
  const optionsByProduct = new Map();

  for (const row of rows) {
    const productCode = productCodeOf(row);
    if (!productCode) continue;
    const costRows = asArray(row.costs || row.costList || row.productCosts || row);

    for (const costRow of costRows) {
      const value = numberOrNull(costRow.cost ?? costRow.value);
      if (value === null) continue;

      const option = {
        id: [
          costRow.branchCode ?? costRow.branchcode ?? "",
          costRow.costCode ?? costRow.costcode ?? costRow.code ?? "",
          "cost",
          value,
        ].join(":"),
        branchCode: numberOrNull(costRow.branchCode ?? costRow.branchcode),
        priceCode: numberOrNull(costRow.costCode ?? costRow.costcode ?? costRow.code),
        description: String(costRow.costName ?? costRow.description ?? costRow.name ?? "").trim(),
        price: value,
        promotionalPrice: null,
        value,
      };

      const current = optionsByProduct.get(productCode) || [];
      current.push(option);
      optionsByProduct.set(productCode, current);
    }
  }

  const normalized = {};
  for (const [productCode, options] of optionsByProduct.entries()) {
    const unique = new Map();
    for (const option of options) unique.set(option.id, option);
    normalized[productCode] = Array.from(unique.values()).sort((a, b) => {
      if ((a.branchCode || 0) !== (b.branchCode || 0)) return (a.branchCode || 0) - (b.branchCode || 0);
      if ((a.priceCode || 0) !== (b.priceCode || 0)) return (a.priceCode || 0) - (b.priceCode || 0);
      return a.value - b.value;
    });
  }
  return normalized;
}

function buildPricesBody(productCodes) {
  const template = String(process.env.TOTVS_MODA_PRICES_BODY_JSON || "").trim();
  if (template) {
    return JSON.parse(template.replaceAll("{{PRODUCT_CODES}}", JSON.stringify(productCodes)));
  }

  const branchCodes = String(process.env.TOTVS_MODA_PRICE_BRANCH_CODES || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
  const priceCodes = String(process.env.TOTVS_MODA_PRICE_CODES || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);

  const branchCode = branchCodes[0] || Number(process.env.TOTVS_MODA_PRICE_BRANCH_CODE || 1);

  const body = {
    filter: {
      productCodeList: productCodes.map(Number).filter(Number.isFinite),
    },
    pagesize: Math.min(Number(process.env.TOTVS_MODA_PRICES_PAGE_SIZE) || 500, 500),
    page: 1,
    option: {
      prices: [
        {
          branchCode,
          priceCodeList: priceCodes.length ? priceCodes : [Number(process.env.TOTVS_MODA_PRICE_CODE || 1)],
          isPromotionalPrice: true,
        },
      ],
    },
  };

  if (process.env.TOTVS_MODA_PRICE_START_DATE && process.env.TOTVS_MODA_PRICE_END_DATE) {
    body.filter.change = {
      startDate: String(process.env.TOTVS_MODA_PRICE_START_DATE),
      endDate: String(process.env.TOTVS_MODA_PRICE_END_DATE),
      inPrice: true,
      inPromotionalPrice: true,
      branchPriceCodeList: branchCodes.length ? branchCodes : [branchCode],
      priceCodeList: priceCodes.length ? priceCodes : [Number(process.env.TOTVS_MODA_PRICE_CODE || 1)],
    };
  }

  return body;
}

function buildCostsBody(productCodes) {
  const template = String(process.env.TOTVS_MODA_COSTS_BODY_JSON || "").trim();
  if (template) {
    return JSON.parse(template.replaceAll("{{PRODUCT_CODES}}", JSON.stringify(productCodes)));
  }

  const branchCodes = String(process.env.TOTVS_MODA_COST_BRANCH_CODES || process.env.TOTVS_MODA_PRICE_BRANCH_CODES || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
  const costCodes = String(process.env.TOTVS_MODA_COST_CODES || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
  const branchCode = branchCodes[0] || Number(process.env.TOTVS_MODA_COST_BRANCH_CODE || process.env.TOTVS_MODA_PRICE_BRANCH_CODE || 1);

  return {
    filter: {
      productCodeList: productCodes.map(Number).filter(Number.isFinite),
    },
    pageSize: Math.min(Number(process.env.TOTVS_MODA_COSTS_PAGE_SIZE) || 500, 1000),
    page: 1,
    option: {
      costs: [
        {
          branchCode,
          costCodeList: costCodes.length ? costCodes : [Number(process.env.TOTVS_MODA_COST_CODE || 2)],
        },
      ],
    },
  };
}

function formatTotvsError(payload, fallback) {
  if (typeof payload === "string") return payload || fallback;
  if (Array.isArray(payload)) {
    return payload
      .map((item) => item.message || item.detailedMessage || item.error || JSON.stringify(item))
      .filter(Boolean)
      .join(" | ") || fallback;
  }
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.notifications)) return formatTotvsError(payload.notifications, fallback);
    if (Array.isArray(payload.errors)) return formatTotvsError(payload.errors, fallback);
    return payload.message || payload.error || JSON.stringify(payload);
  }
  return fallback;
}

router.post("/prices/mp", requireAdmin, async (req, res) => {
  try {
    const productCodes = Array.from(new Set((Array.isArray(req.body?.productCodes) ? req.body.productCodes : [])
      .map((code) => String(code || "").trim())
      .filter(Boolean))).slice(0, 500);
    if (!productCodes.length) {
      return res.status(400).json({ success: false, error: "Informe productCodes." });
    }

    const accessToken = await getTotvsToken();
    const costsBody = buildCostsBody(productCodes);
    console.log("[TOTVS] Buscando custos para", productCodes.length, "MPs. Body:", JSON.stringify(costsBody, null, 2));

    const response = await fetch(`${cleanBaseUrl()}/api/totvsmoda/product/v2/costs/search`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(costsBody),
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (_err) {
      payload = {};
    }

    console.log("[TOTVS] Resposta costs:", response.status, "- items:", asArray(payload).length);
    if (asArray(payload).length > 0) {
      console.log("[TOTVS] Exemplo primeiro item:", JSON.stringify(asArray(payload)[0], null, 2));
    }

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: `TOTVS costs ${response.status}: ${formatTotvsError(payload, text || "falha na consulta")}`,
      });
    }

    const flattened = flattenCostOptions(payload);
    console.log("[TOTVS] Custos processados:", Object.keys(flattened).length, "MPs com custo");

    return res.json({
      success: true,
      data: flattened,
      rawCount: asArray(payload).length,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/purchase-orders", requireAdmin, async (req, res) => {
  try {
    const order = req.body;
    console.log("[TOTVS] Enviando pedido de compra:", JSON.stringify(order, null, 2));
    if (!order || typeof order !== "object") {
      return res.status(400).json({ success: false, error: "Informe o pedido de compra." });
    }
    if (!Number(order.branchCode) || !Number(order.operationCode) || !Number(order.paymentConditionCode)) {
      return res.status(400).json({ success: false, error: "Pedido sem empresa, operacao ou condicao de pagamento." });
    }
    if (!Number(order.supplierCode) && !String(order.supplierCpfCnpj || "").trim()) {
      return res.status(400).json({ success: false, error: "Pedido sem fornecedor." });
    }
    if (!Array.isArray(order.items) || order.items.length === 0) {
      return res.status(400).json({ success: false, error: "Pedido sem itens." });
    }
    const invalidValueItem = order.items.find((item) => Number(item.value || 0) <= 0);
    if (invalidValueItem) {
      return res.status(400).json({
        success: false,
        error: `Pedido com item sem valor/custo TOTVS: produto ${invalidValueItem.productCode}. Consulte o custo antes de enviar.`,
      });
    }
    if (Number(order.totalAmountOrder || 0) <= 0) {
      return res.status(400).json({ success: false, error: "Pedido com valor total zerado. Consulte o custo das MPs antes de enviar." });
    }

    const accessToken = await getTotvsToken();
    const response = await fetch(`${cleanBaseUrl()}/api/totvsmoda/purchase-order/v2/orders`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(order),
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (_err) {
      payload = text;
    }

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: `TOTVS purchase-order ${response.status}: ${formatTotvsError(payload, "falha no envio")}`,
        data: payload,
      });
    }

    return res.json({ success: true, data: payload });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/purchase-orders/cancel", requireAdmin, async (req, res) => {
  try {
    const branchCode = Number(req.body?.branchCode || 0);
    const orderCode = Number(req.body?.orderCode || 0);
    if (!branchCode || !orderCode) {
      return res.status(400).json({ success: false, error: "Informe branchCode e orderCode." });
    }

    const accessToken = await getTotvsToken();
    const response = await fetch(`${cleanBaseUrl()}/api/totvsmoda/purchase-order/v2/orders/cancel`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ branchCode, orderCode }),
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (_err) {
      payload = text;
    }

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: `TOTVS cancel ${response.status}: ${typeof payload === "string" ? payload : payload.message || payload.error || JSON.stringify(payload)}`,
        data: payload,
      });
    }

    return res.json({ success: true, data: payload });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
