import "./score-engine.js";
import { createRemoteJWKSet, jwtVerify } from "jose";

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
  { cooldownDuration: 30000, cacheMaxAge: 3600000, timeoutDuration: 5000 }
);

const DEFAULT_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const MAX_BODY_BYTES = 32768;

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix = "") {
  return prefix + crypto.randomUUID();
}

function trimText(value, max = 240) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function booleanInt(value) {
  return value === true || value === 1 || value === "1" ? 1 : 0;
}

let fcmAccessCache = null;

function base64UrlBytes(bytes) {
  let binary = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlText(value) {
  return base64UrlBytes(new TextEncoder().encode(String(value)));
}

function fcmServiceAccount(env) {
  const raw = String(env.FCM_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

async function importGooglePrivateKey(pem) {
  const clean = String(pem || "")
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    bytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function fcmAccessToken(env) {
  const account = fcmServiceAccount(env);
  if (!account) return null;
  if (fcmAccessCache && fcmAccessCache.clientEmail === account.client_email && Date.now() < fcmAccessCache.expiresAt - 60000) {
    return { token: fcmAccessCache.token, projectId: account.project_id };
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64UrlText(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = header + "." + claim;
  const key = await importGooglePrivateKey(account.private_key);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = unsigned + "." + base64UrlBytes(signature);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!response.ok) throw new Error("FCM OAuth " + response.status);
  const data = await response.json();
  const token = String(data.access_token || "");
  if (!token) throw new Error("FCM OAuth returned no token");
  fcmAccessCache = {
    clientEmail: account.client_email,
    token,
    expiresAt: Date.now() + Math.max(300, Number(data.expires_in) || 3600) * 1000
  };
  return { token, projectId: account.project_id };
}

async function sendFcmToDevice(env, auth, device, alert, target) {
  const response = await fetch(
    "https://fcm.googleapis.com/v1/projects/" + encodeURIComponent(auth.projectId) + "/messages:send",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + auth.token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: {
          token: device.push_token,
          notification: {
            title: alert.title,
            body: alert.message
          },
          data: {
            alertId: alert.id,
            stockKey: String(target.stock_key || ""),
            ticker: String(target.ticker || ""),
            preferTr: Number(target.prefer_tr) === 1 ? "1" : "0",
            alertType: String(alert.alert_type || ""),
            severity: String(alert.severity || "")
          },
          android: {
            priority: alert.severity === "critical" || alert.severity === "high" ? "high" : "normal",
            notification: {
              channel_id: "viewinvai_market_alerts",
              sound: "default"
            }
          }
        }
      })
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = String(payload && payload.error && payload.error.status || "");
    const details = JSON.stringify(payload && payload.error || {});
    const invalid = status === "NOT_FOUND" || status === "INVALID_ARGUMENT" || /UNREGISTERED|registration-token-not-registered/i.test(details);
    if (invalid) {
      await env.DB.prepare("UPDATE devices SET enabled=0,updated_at=? WHERE id=?").bind(nowIso(), device.id).run();
    }
    throw new Error("FCM send " + response.status + (status ? " " + status : ""));
  }
  return true;
}

async function dispatchPushAlert(env, alert, target) {
  const auth = await fcmAccessToken(env);
  if (!auth || !env.DB) return { configured: false, sent: 0 };

  const rows = await env.DB.prepare(
    "SELECT id,push_token,platform FROM devices WHERE user_id=? AND enabled=1 ORDER BY last_seen_at DESC LIMIT 20"
  ).bind(target.user_id).all();
  const devices = rows.results || [];
  if (!devices.length) return { configured: true, sent: 0 };

  const settled = await Promise.allSettled(devices.map(device => sendFcmToDevice(env, auth, device, alert, target)));
  const sent = settled.filter(x => x.status === "fulfilled").length;
  if (sent > 0) {
    await env.DB.prepare("UPDATE alert_events SET pushed_at=? WHERE id=?").bind(nowIso(), alert.id).run();
  }
  for (const row of settled) {
    if (row.status === "rejected") console.warn("FCM device send failed", String(row.reason && row.reason.message || row.reason));
  }
  return { configured: true, sent };
}

function defaultJson(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function apiGuard(request) {
  const allowed = new Set(["GET", "POST", "PATCH", "DELETE"]);
  if (!allowed.has(request.method)) return { status: 405, error: "Method not allowed" };
  const url = new URL(request.url);
  const origin = String(request.headers.get("Origin") || "");
  const nativeOrigin = ["https://localhost","http://localhost","capacitor://localhost","ionic://localhost"].includes(origin.toLowerCase());
  if (origin && origin !== url.origin && !nativeOrigin) return { status: 403, error: "Forbidden" };
  const site = (request.headers.get("Sec-Fetch-Site") || "").toLowerCase();
  if (!nativeOrigin && site && !["same-origin", "none"].includes(site)) return { status: 403, error: "Forbidden" };
  if (["POST", "PATCH", "DELETE"].includes(request.method)) {
    const type = String(request.headers.get("Content-Type") || "").toLowerCase();
    if (request.method !== "DELETE" && type && !type.startsWith("application/json")) {
      return { status: 415, error: "Content-Type must be application/json" };
    }
  }
  return null;
}

async function readJson(request) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) throw new Error("Payload too large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("Payload too large");
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid JSON object");
  return parsed;
}

async function verifyFirebaseUser(request, env) {
  if (!env.DB) return { error: "D1 backend not configured", status: 503 };
  const projectId = String(env.FIREBASE_PROJECT_ID || "").trim();
  if (!projectId) return { error: "Firebase authentication not configured", status: 503 };

  const auth = String(request.headers.get("Authorization") || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return { error: "Authentication required", status: 401 };

  try {
    const { payload } = await jwtVerify(match[1], FIREBASE_JWKS, {
      algorithms: ["RS256"],
      issuer: "https://securetoken.google.com/" + projectId,
      audience: projectId,
      clockTolerance: 10
    });

    const userId = trimText(payload.sub, 128);
    const email = trimText(payload.email, 320).toLowerCase();
    if (!userId || !email || payload.email_verified !== true) {
      return { error: "Verified Google/Firebase account required", status: 401 };
    }

    const displayName = trimText(payload.name || payload.display_name || email.split("@")[0], 120);
    const avatarUrl = trimText(payload.picture, 600);
    const now = nowIso();

    await env.DB.prepare(
      "INSERT INTO users (id,email,display_name,avatar_url,auth_provider,created_at,updated_at) VALUES (?,?,?,?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,avatar_url=excluded.avatar_url,updated_at=excluded.updated_at"
    ).bind(userId, email, displayName, avatarUrl, "firebase-google", now, now).run();

    await env.DB.prepare(
      "INSERT INTO user_settings (user_id,created_at,updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO NOTHING"
    ).bind(userId, now, now).run();

    return {
      user: {
        id: userId,
        email,
        displayName,
        avatarUrl
      }
    };
  } catch (error) {
    console.warn("Firebase token verification failed", String(error && error.message || error));
    return { error: "Invalid or expired authentication token", status: 401 };
  }
}

async function onePortfolio(env, userId, portfolioId) {
  return env.DB.prepare(
    "SELECT id,user_id,name,broker,base_currency,sort_order,created_at,updated_at FROM portfolios WHERE id=? AND user_id=?"
  ).bind(portfolioId, userId).first();
}

function portfolioPayload(body) {
  return {
    name: trimText(body.name, 80),
    broker: trimText(body.broker, 80),
    baseCurrency: /^[A-Z]{3}$/.test(String(body.baseCurrency || "EUR").toUpperCase())
      ? String(body.baseCurrency || "EUR").toUpperCase()
      : "EUR",
    sortOrder: Math.max(-1000, Math.min(1000, Math.round(finiteNumber(body.sortOrder) || 0)))
  };
}

function positionPayload(body) {
  const stockKey = trimText(body.stockKey, 80).toUpperCase();
  const ticker = trimText(body.ticker, 20).toUpperCase();
  return {
    portfolioId: trimText(body.portfolioId, 80),
    stockKey,
    ticker,
    name: trimText(body.name, 160),
    exchange: trimText(body.exchange, 40).toUpperCase(),
    isin: trimText(body.isin, 24).toUpperCase(),
    preferTr: booleanInt(body.preferTr),
    quantity: finiteNumber(body.quantity),
    avgPrice: finiteNumber(body.avgPrice),
    currency: /^[A-Z]{3}$/.test(String(body.currency || "EUR").toUpperCase())
      ? String(body.currency || "EUR").toUpperCase()
      : "EUR",
    openedAt: trimText(body.openedAt, 40) || null,
    notes: trimText(body.notes, 1000)
  };
}

function transactionPayload(body) {
  const side = String(body.side || "").trim().toUpperCase();
  const currency = String(body.currency || "EUR").trim().toUpperCase();
  const quantity = finiteNumber(body.quantity);
  const price = finiteNumber(body.price);
  const fees = finiteNumber(body.fees);
  const executedRaw = trimText(body.executedAt, 40);
  const executedDate = executedRaw ? new Date(executedRaw) : new Date();
  return {
    portfolioId: trimText(body.portfolioId, 80),
    stockKey: trimText(body.stockKey, 80).toUpperCase(),
    ticker: trimText(body.ticker, 20).toUpperCase(),
    name: trimText(body.name, 160),
    exchange: trimText(body.exchange, 40).toUpperCase(),
    isin: trimText(body.isin, 24).toUpperCase(),
    preferTr: booleanInt(body.preferTr),
    side,
    quantity,
    price,
    fees: fees === null ? 0 : fees,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "EUR",
    executedAt: Number.isFinite(executedDate.getTime()) ? executedDate.toISOString() : "",
    notes: trimText(body.notes, 1000)
  };
}


function fundPortfolioPayload(body) {
  return {
    name: trimText(body.name, 80),
    platform: trimText(body.platform, 60),
    baseCurrency: /^[A-Z]{3}$/.test(String(body.baseCurrency || "EUR").toUpperCase())
      ? String(body.baseCurrency || "EUR").toUpperCase()
      : "EUR",
    sortOrder: Math.max(-1000, Math.min(1000, Math.round(finiteNumber(body.sortOrder) || 0)))
  };
}

function fundPositionPayload(body) {
  const isin = trimText(body.isin, 24).toUpperCase();
  const rawProductType = String(body.productType || "fund").toLowerCase();
  const productType = ["fund","etf","etp"].includes(rawProductType) ? rawProductType : "fund";
  const units = finiteNumber(body.units);
  const avgPrice = finiteNumber(body.avgPrice);
  return {
    fundPortfolioId: trimText(body.fundPortfolioId, 80),
    isin,
    name: trimText(body.name, 180),
    productType,
    provider: trimText(body.provider, 120),
    indexName: trimText(body.indexName, 160),
    platform: trimText(body.platform, 60),
    units,
    avgPrice,
    currency: /^[A-Z]{3}$/.test(String(body.currency || "EUR").toUpperCase())
      ? String(body.currency || "EUR").toUpperCase()
      : "EUR",
    openedAt: trimText(body.openedAt, 40) || null,
    notes: trimText(body.notes, 1000)
  };
}

let fundSchemaReady = false;
async function ensureFundSchema(env) {
  if (fundSchemaReady) return;
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS fund_portfolios (" +
      "id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT NOT NULL,platform TEXT NOT NULL DEFAULT '',base_currency TEXT NOT NULL DEFAULT 'EUR',sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL," +
      "FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_fund_portfolios_user ON fund_portfolios(user_id,sort_order,created_at)"),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS fund_positions (" +
      "id TEXT PRIMARY KEY,fund_portfolio_id TEXT NOT NULL,user_id TEXT NOT NULL,isin TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',product_type TEXT NOT NULL DEFAULT 'fund' CHECK(product_type IN ('fund','etf','etp')),provider TEXT NOT NULL DEFAULT '',index_name TEXT NOT NULL DEFAULT '',platform TEXT NOT NULL DEFAULT '',units REAL NOT NULL DEFAULT 0 CHECK(units>=0),avg_price REAL,currency TEXT NOT NULL DEFAULT 'EUR',opened_at TEXT,notes TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL," +
      "FOREIGN KEY(fund_portfolio_id) REFERENCES fund_portfolios(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
    ),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_positions_portfolio_isin ON fund_positions(fund_portfolio_id,isin)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_fund_positions_user_active ON fund_positions(user_id,active)"),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS fund_transactions (" +
      "id TEXT PRIMARY KEY,fund_portfolio_id TEXT NOT NULL,fund_position_id TEXT NOT NULL,user_id TEXT NOT NULL,isin TEXT NOT NULL,side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),units REAL NOT NULL CHECK(units>0),price REAL NOT NULL CHECK(price>=0),fees REAL NOT NULL DEFAULT 0 CHECK(fees>=0),currency TEXT NOT NULL DEFAULT 'EUR',executed_at TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL," +
      "FOREIGN KEY(fund_portfolio_id) REFERENCES fund_portfolios(id) ON DELETE CASCADE,FOREIGN KEY(fund_position_id) REFERENCES fund_positions(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_fund_transactions_user_date ON fund_transactions(user_id,executed_at DESC,created_at DESC)"),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS fund_contribution_plans (" +
      "id TEXT PRIMARY KEY,fund_portfolio_id TEXT NOT NULL,fund_position_id TEXT,user_id TEXT NOT NULL,isin TEXT NOT NULL DEFAULT '',label TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL DEFAULT 'monthly',amount REAL,currency TEXT NOT NULL DEFAULT 'EUR',day_of_month INTEGER,frequency TEXT NOT NULL DEFAULT 'monthly',enabled INTEGER NOT NULL DEFAULT 1,notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL," +
      "FOREIGN KEY(fund_portfolio_id) REFERENCES fund_portfolios(id) ON DELETE CASCADE,FOREIGN KEY(fund_position_id) REFERENCES fund_positions(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_fund_plans_user ON fund_contribution_plans(user_id,fund_portfolio_id,enabled)")
  ]);
  fundSchemaReady = true;
}

async function oneFundPortfolio(env, userId, id) {
  await ensureFundSchema(env);
  return env.DB.prepare(
    "SELECT id,user_id,name,platform,base_currency,sort_order,created_at,updated_at FROM fund_portfolios WHERE id=? AND user_id=?"
  ).bind(id, userId).first();
}

let transactionsSchemaReady = false;
async function ensureTransactionsSchema(env) {
  if (transactionsSchemaReady) return;
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS transactions (" +
      "id TEXT PRIMARY KEY,portfolio_id TEXT NOT NULL,user_id TEXT NOT NULL,stock_key TEXT NOT NULL,ticker TEXT NOT NULL,name TEXT NOT NULL DEFAULT '',exchange TEXT NOT NULL DEFAULT '',isin TEXT NOT NULL DEFAULT '',prefer_tr INTEGER NOT NULL DEFAULT 0," +
      "side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),quantity REAL NOT NULL CHECK(quantity>0),price REAL NOT NULL CHECK(price>=0),fees REAL NOT NULL DEFAULT 0 CHECK(fees>=0),currency TEXT NOT NULL DEFAULT 'EUR',executed_at TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',origin TEXT NOT NULL DEFAULT 'manual',created_at TEXT NOT NULL,updated_at TEXT NOT NULL," +
      "FOREIGN KEY(portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id,executed_at DESC,created_at DESC)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_transactions_portfolio_date ON transactions(portfolio_id,executed_at DESC,created_at DESC)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_transactions_stock ON transactions(user_id,portfolio_id,stock_key,executed_at,created_at)")
  ]);
  transactionsSchemaReady = true;
}

async function transactionRows(env, userId, portfolioId, stockKey) {
  await ensureTransactionsSchema(env);
  const rows = await env.DB.prepare(
    "SELECT * FROM transactions WHERE user_id=? AND portfolio_id=? AND stock_key=? ORDER BY executed_at ASC,created_at ASC,id ASC"
  ).bind(userId, portfolioId, stockKey).all();
  return rows.results || [];
}

export function calculateTransactionLedger(rows) {
  let quantity = 0;
  let costBasis = 0;
  let firstBuyAt = null;
  let currency = null;
  const realizedByCurrency = {};
  const feesByCurrency = {};

  const addAmount = (bucket, key, value) => {
    key = String(key || "EUR").toUpperCase();
    bucket[key] = (bucket[key] || 0) + value;
  };

  for (const row of rows || []) {
    const side = String(row.side || "").toUpperCase();
    const origin = String(row.origin || "");
    const qty = finiteNumber(row.quantity);
    const price = finiteNumber(row.price);
    const fees = Math.max(0, finiteNumber(row.fees) || 0);
    const rowCurrency = String(row.currency || currency || "EUR").toUpperCase();
    if (!qty || qty <= 0 || price === null || price < 0) continue;
    if (!currency) currency = rowCurrency;

    if (origin === "position-adjustment") {
      if (!firstBuyAt) firstBuyAt = row.executed_at || row.created_at || null;
      quantity = qty;
      costBasis = qty * price;
      currency = rowCurrency;
      addAmount(feesByCurrency, rowCurrency, fees);
      continue;
    }

    if (side === "BUY") {
      if (quantity > 1e-8 && currency !== rowCurrency) {
        throw new Error("Transaction currency differs from current position");
      }
      if (quantity <= 1e-8) currency = rowCurrency;
      if (!firstBuyAt) firstBuyAt = row.executed_at || row.created_at || null;
      quantity += qty;
      costBasis += qty * price + fees;
      addAmount(feesByCurrency, rowCurrency, fees);
      continue;
    }
    if (side === "SELL") {
      if (qty > quantity + 1e-8) throw new Error("Sell quantity exceeds current position");
      if (currency !== rowCurrency) throw new Error("Transaction currency differs from current position");
      const avg = quantity > 1e-8 ? costBasis / quantity : 0;
      const realized = qty * price - fees - qty * avg;
      addAmount(realizedByCurrency, rowCurrency, realized);
      addAmount(feesByCurrency, rowCurrency, fees);
      quantity -= qty;
      costBasis -= qty * avg;
      if (quantity <= 1e-8) {
        quantity = 0;
        costBasis = 0;
      }
    }
  }

  const realizedCurrencies = Object.keys(realizedByCurrency);
  const feeCurrencies = Object.keys(feesByCurrency);
  const realizedPnl = realizedCurrencies.length <= 1
    ? realizedCurrencies.reduce((sum, key) => sum + realizedByCurrency[key], 0)
    : null;
  const totalFees = feeCurrencies.length <= 1
    ? feeCurrencies.reduce((sum, key) => sum + feesByCurrency[key], 0)
    : null;

  return {
    quantity,
    avgPrice: quantity > 1e-8 ? costBasis / quantity : null,
    invested: costBasis,
    realizedPnl,
    realizedByCurrency,
    totalFees,
    feesByCurrency,
    currency: currency || "EUR",
    firstBuyAt
  };
}

export function calculatePortfolioTransactionSummary(rows) {
  const sorted = [...(rows || [])].sort((a,b) =>
    String(a.executed_at || "").localeCompare(String(b.executed_at || "")) ||
    String(a.created_at || "").localeCompare(String(b.created_at || "")) ||
    String(a.id || "").localeCompare(String(b.id || ""))
  );
  const groups = new Map();
  const currencies = {};
  let buys = 0, sells = 0, adjustments = 0;

  for (const row of sorted) {
    const side = String(row.side || "").toUpperCase();
    const origin = String(row.origin || "");
    const currency = String(row.currency || "EUR").toUpperCase();
    const qty = finiteNumber(row.quantity);
    const price = finiteNumber(row.price);
    const fees = Math.max(0, finiteNumber(row.fees) || 0);
    if (!currencies[currency]) currencies[currency] = { buyGross: 0, sellGross: 0, fees: 0, realizedPnl: 0 };
    if (qty !== null && qty > 0 && price !== null && price >= 0) {
      if (origin === "position-adjustment") adjustments++;
      else if (side === "BUY") { currencies[currency].buyGross += qty * price; buys++; }
      else if (side === "SELL") { currencies[currency].sellGross += qty * price; sells++; }
      currencies[currency].fees += fees;
    }
    const key = String(row.stock_key || row.ticker || "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  for (const groupRows of groups.values()) {
    const ledger = calculateTransactionLedger(groupRows);
    const realized = ledger.realizedByCurrency && typeof ledger.realizedByCurrency === "object"
      ? ledger.realizedByCurrency
      : (ledger.realizedPnl === null || ledger.realizedPnl === undefined ? {} : { [String(ledger.currency || "EUR").toUpperCase()]: ledger.realizedPnl });
    for (const [currency, amount] of Object.entries(realized)) {
      const key = String(currency || "EUR").toUpperCase();
      if (!currencies[key]) currencies[key] = { buyGross: 0, sellGross: 0, fees: 0, realizedPnl: 0 };
      currencies[key].realizedPnl += finiteNumber(amount) || 0;
    }
  }

  for (const value of Object.values(currencies)) {
    for (const key of ["buyGross","sellGross","fees","realizedPnl"]) {
      value[key] = Math.round((value[key] + Number.EPSILON) * 1000000) / 1000000;
    }
  }
  return { total: sorted.length, buys, sells, adjustments, stocks: groups.size, currencies };
}

async function ensureOpeningTransaction(env, userId, position) {
  if (!position || finiteNumber(position.quantity) === null || finiteNumber(position.quantity) <= 0 || finiteNumber(position.avg_price) === null) return;
  await ensureTransactionsSchema(env);
  const existing = await env.DB.prepare(
    "SELECT id FROM transactions WHERE user_id=? AND portfolio_id=? AND stock_key=? LIMIT 1"
  ).bind(userId, position.portfolio_id, position.stock_key).first();
  if (existing) return;

  const now = nowIso();
  const executed = trimText(position.opened_at, 40);
  const d = executed ? new Date(executed) : new Date(now);
  const executedAt = Number.isFinite(d.getTime()) ? d.toISOString() : now;
  await env.DB.prepare(
    "INSERT INTO transactions (id,portfolio_id,user_id,stock_key,ticker,name,exchange,isin,prefer_tr,side,quantity,price,fees,currency,executed_at,notes,origin,created_at,updated_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,'BUY',?,?,0,?,?,?,'position-seed',?,?)"
  ).bind(
    uid("tx_"), position.portfolio_id, userId, position.stock_key, position.ticker, position.name || "",
    position.exchange || "", position.isin || "", booleanInt(position.prefer_tr),
    finiteNumber(position.quantity), finiteNumber(position.avg_price), String(position.currency || "EUR").toUpperCase(),
    executedAt, "Posición inicial importada", now, now
  ).run();
}

async function appendPositionAdjustment(env, userId, position, data) {
  if (!position || data.quantity === null || data.quantity <= 0 || data.avgPrice === null || data.avgPrice < 0) return false;
  await ensureTransactionsSchema(env);
  await ensureOpeningTransaction(env, userId, position);
  const rows = await transactionRows(env, userId, position.portfolio_id, position.stock_key);
  const ledger = calculateTransactionLedger(rows);
  const targetCurrency = String(data.currency || position.currency || ledger.currency || "EUR").toUpperCase();
  const changed =
    Math.abs((ledger.quantity || 0) - data.quantity) > 1e-8 ||
    ledger.avgPrice === null ||
    Math.abs((ledger.avgPrice || 0) - data.avgPrice) > 1e-8 ||
    String(ledger.currency || targetCurrency).toUpperCase() !== targetCurrency;
  if (!changed) return false;

  const now = nowIso();
  await env.DB.prepare(
    "INSERT INTO transactions (id,portfolio_id,user_id,stock_key,ticker,name,exchange,isin,prefer_tr,side,quantity,price,fees,currency,executed_at,notes,origin,created_at,updated_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,'BUY',?,?,0,?,?,?,'position-adjustment',?,?)"
  ).bind(
    uid("tx_"), position.portfolio_id, userId, position.stock_key,
    data.ticker || position.ticker || "", data.name || position.name || "",
    data.exchange || position.exchange || "", data.isin || position.isin || "",
    data.preferTr, data.quantity, data.avgPrice, targetCurrency, now,
    "Ajuste manual desde Gestionar cartera", now, now
  ).run();
  return true;
}

async function recalculatePositionFromTransactions(env, userId, portfolioId, stockKey) {
  const rows = await transactionRows(env, userId, portfolioId, stockKey);
  if (!rows.length) return null;
  const ledger = calculateTransactionLedger(rows);
  const first = rows[0];
  const now = nowIso();
  const existing = await env.DB.prepare(
    "SELECT * FROM positions WHERE user_id=? AND portfolio_id=? AND stock_key=?"
  ).bind(userId, portfolioId, stockKey).first();
  const positionId = existing && existing.id ? existing.id : uid("pos_");
  await env.DB.prepare(
    "INSERT INTO positions (id,portfolio_id,user_id,stock_key,ticker,name,exchange,isin,prefer_tr,quantity,avg_price,currency,opened_at,notes,active,created_at,updated_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?) " +
    "ON CONFLICT(portfolio_id,stock_key) DO UPDATE SET ticker=excluded.ticker,name=excluded.name,exchange=excluded.exchange,isin=excluded.isin,prefer_tr=excluded.prefer_tr,quantity=excluded.quantity,avg_price=excluded.avg_price,currency=excluded.currency,opened_at=excluded.opened_at,active=excluded.active,updated_at=excluded.updated_at"
  ).bind(
    positionId, portfolioId, userId, stockKey,
    existing && existing.ticker || first.ticker || "",
    existing && existing.name || first.name || "",
    existing && existing.exchange || first.exchange || "",
    existing && existing.isin || first.isin || "",
    existing ? booleanInt(existing.prefer_tr) : booleanInt(first.prefer_tr),
    ledger.quantity, ledger.avgPrice, ledger.currency,
    existing && existing.opened_at || ledger.firstBuyAt,
    existing && existing.notes || "",
    ledger.quantity > 1e-8 ? 1 : 0,
    existing && existing.created_at || now, now
  ).run();
  return {
    position: await env.DB.prepare("SELECT * FROM positions WHERE id=? AND user_id=?").bind(positionId, userId).first(),
    ledger
  };
}

function watchPayload(body) {
  return {
    stockKey: trimText(body.stockKey, 80).toUpperCase(),
    ticker: trimText(body.ticker, 20).toUpperCase(),
    name: trimText(body.name, 160),
    exchange: trimText(body.exchange, 40).toUpperCase(),
    isin: trimText(body.isin, 24).toUpperCase(),
    preferTr: booleanInt(body.preferTr),
    notes: trimText(body.notes, 1000)
  };
}

async function handleMe(request, env, user, json) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const settings = await env.DB.prepare(
    "SELECT analysis_positions_minutes,analysis_watchlist_minutes,min_buy_confidence,min_sell_confidence,notify_score_change FROM user_settings WHERE user_id=?"
  ).bind(user.id).first();
  return json({ user, settings: settings || null }, 200, { "Cache-Control": "no-store" });
}

async function handlePortfolios(request, env, user, json, parts) {
  const id = parts[1] || "";
  if (request.method === "GET" && !id) {
    const rows = await env.DB.prepare(
      "SELECT p.*, (SELECT COUNT(*) FROM positions x WHERE x.portfolio_id=p.id AND x.active=1) AS position_count " +
      "FROM portfolios p WHERE p.user_id=? ORDER BY p.sort_order ASC,p.created_at ASC"
    ).bind(user.id).all();
    return json({ portfolios: rows.results || [] });
  }

  if (request.method === "POST" && !id) {
    const body = await readJson(request);
    const data = portfolioPayload(body);
    if (!data.name) return json({ error: "Portfolio name is required" }, 400);
    const idNew = uid("pf_");
    const now = nowIso();
    await env.DB.prepare(
      "INSERT INTO portfolios (id,user_id,name,broker,base_currency,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(idNew, user.id, data.name, data.broker, data.baseCurrency, data.sortOrder, now, now).run();
    return json({ portfolio: await onePortfolio(env, user.id, idNew) }, 201);
  }

  if (!id) return json({ error: "Portfolio id required" }, 400);
  const existing = await onePortfolio(env, user.id, id);
  if (!existing) return json({ error: "Portfolio not found" }, 404);

  if (request.method === "PATCH") {
    const body = await readJson(request);
    const data = portfolioPayload({
      name: body.name !== undefined ? body.name : existing.name,
      broker: body.broker !== undefined ? body.broker : existing.broker,
      baseCurrency: body.baseCurrency !== undefined ? body.baseCurrency : existing.base_currency,
      sortOrder: body.sortOrder !== undefined ? body.sortOrder : existing.sort_order
    });
    if (!data.name) return json({ error: "Portfolio name is required" }, 400);
    await env.DB.prepare(
      "UPDATE portfolios SET name=?,broker=?,base_currency=?,sort_order=?,updated_at=? WHERE id=? AND user_id=?"
    ).bind(data.name, data.broker, data.baseCurrency, data.sortOrder, nowIso(), id, user.id).run();
    return json({ portfolio: await onePortfolio(env, user.id, id) });
  }

  if (request.method === "DELETE") {
    await ensureTransactionsSchema(env);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM transactions WHERE portfolio_id=? AND user_id=?").bind(id, user.id),
      env.DB.prepare("DELETE FROM positions WHERE portfolio_id=? AND user_id=?").bind(id, user.id),
      env.DB.prepare("DELETE FROM portfolios WHERE id=? AND user_id=?").bind(id, user.id)
    ]);
    return json({ deleted: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function handlePositions(request, env, user, json, parts, url) {
  const id = parts[1] || "";
  if (request.method === "GET" && !id) {
    const portfolioId = trimText(url.searchParams.get("portfolioId"), 80);
    let stmt = portfolioId
      ? env.DB.prepare("SELECT * FROM positions WHERE user_id=? AND portfolio_id=? AND active=1 ORDER BY created_at DESC").bind(user.id, portfolioId)
      : env.DB.prepare("SELECT * FROM positions WHERE user_id=? AND active=1 ORDER BY created_at DESC").bind(user.id);
    const rows = await stmt.all();
    return json({ positions: rows.results || [] });
  }

  if (request.method === "POST" && !id) {
    const body = await readJson(request);
    const data = positionPayload(body);
    if (!data.portfolioId || !data.stockKey || !data.ticker) {
      return json({ error: "portfolioId, stockKey and ticker are required" }, 400);
    }
    if (!(await onePortfolio(env, user.id, data.portfolioId))) return json({ error: "Portfolio not found" }, 404);
    const existing = await env.DB.prepare(
      "SELECT * FROM positions WHERE user_id=? AND portfolio_id=? AND stock_key=?"
    ).bind(user.id, data.portfolioId, data.stockKey).first();
    if (existing) await ensureOpeningTransaction(env, user.id, existing);
    const idNew = existing && existing.id ? existing.id : uid("pos_");
    const now = nowIso();
    await env.DB.prepare(
      "INSERT INTO positions (id,portfolio_id,user_id,stock_key,ticker,name,exchange,isin,prefer_tr,quantity,avg_price,currency,opened_at,notes,active,created_at,updated_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?) " +
      "ON CONFLICT(portfolio_id,stock_key) DO UPDATE SET ticker=excluded.ticker,name=excluded.name,exchange=excluded.exchange,isin=excluded.isin,prefer_tr=excluded.prefer_tr,quantity=excluded.quantity,avg_price=excluded.avg_price,currency=excluded.currency,opened_at=excluded.opened_at,notes=excluded.notes,active=1,updated_at=excluded.updated_at"
    ).bind(
      idNew, data.portfolioId, user.id, data.stockKey, data.ticker, data.name, data.exchange, data.isin,
      data.preferTr, data.quantity, data.avgPrice, data.currency, data.openedAt, data.notes, now, now
    ).run();
    let row = await env.DB.prepare("SELECT * FROM positions WHERE id=? AND user_id=?").bind(idNew, user.id).first();
    if (existing) {
      const adjusted = await appendPositionAdjustment(env, user.id, existing, data);
      if (adjusted) {
        const recalculated = await recalculatePositionFromTransactions(env, user.id, data.portfolioId, data.stockKey);
        row = recalculated && recalculated.position || row;
      }
    } else {
      await ensureOpeningTransaction(env, user.id, row);
    }
    return json({ position: row }, existing ? 200 : 201);
  }

  if (!id) return json({ error: "Position id required" }, 400);
  const existing = await env.DB.prepare("SELECT * FROM positions WHERE id=? AND user_id=?").bind(id, user.id).first();
  if (!existing) return json({ error: "Position not found" }, 404);

  if (request.method === "PATCH") {
    const body = await readJson(request);
    const portfolioId = trimText(body.portfolioId !== undefined ? body.portfolioId : existing.portfolio_id, 80);
    if (!(await onePortfolio(env, user.id, portfolioId))) return json({ error: "Portfolio not found" }, 404);
    const data = positionPayload({
      portfolioId,
      stockKey: existing.stock_key,
      ticker: body.ticker !== undefined ? body.ticker : existing.ticker,
      name: body.name !== undefined ? body.name : existing.name,
      exchange: body.exchange !== undefined ? body.exchange : existing.exchange,
      isin: body.isin !== undefined ? body.isin : existing.isin,
      preferTr: body.preferTr !== undefined ? body.preferTr : existing.prefer_tr,
      quantity: body.quantity !== undefined ? body.quantity : existing.quantity,
      avgPrice: body.avgPrice !== undefined ? body.avgPrice : existing.avg_price,
      currency: body.currency !== undefined ? body.currency : existing.currency,
      openedAt: body.openedAt !== undefined ? body.openedAt : existing.opened_at,
      notes: body.notes !== undefined ? body.notes : existing.notes
    });
    await env.DB.prepare(
      "UPDATE positions SET portfolio_id=?,ticker=?,name=?,exchange=?,isin=?,prefer_tr=?,quantity=?,avg_price=?,currency=?,opened_at=?,notes=?,updated_at=? WHERE id=? AND user_id=?"
    ).bind(
      data.portfolioId, data.ticker, data.name, data.exchange, data.isin, data.preferTr, data.quantity,
      data.avgPrice, data.currency, data.openedAt, data.notes, nowIso(), id, user.id
    ).run();
    return json({ position: await env.DB.prepare("SELECT * FROM positions WHERE id=? AND user_id=?").bind(id, user.id).first() });
  }

  if (request.method === "DELETE") {
    await env.DB.prepare("UPDATE positions SET active=0,updated_at=? WHERE id=? AND user_id=?").bind(nowIso(), id, user.id).run();
    return json({ deleted: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function handleTransactions(request, env, user, json, parts, url) {
  await ensureTransactionsSchema(env);
  const id = parts[1] || "";

  if (request.method === "GET" && !id) {
    const portfolioId = trimText(url.searchParams.get("portfolioId"), 80);
    const stockKey = trimText(url.searchParams.get("stockKey"), 80).toUpperCase();
    const limit = Math.max(1, Math.min(500, Math.round(finiteNumber(url.searchParams.get("limit")) || 200)));

    let rows;
    if (portfolioId && stockKey) {
      rows = await env.DB.prepare(
        "SELECT * FROM transactions WHERE user_id=? AND portfolio_id=? AND stock_key=? ORDER BY executed_at DESC,created_at DESC LIMIT ?"
      ).bind(user.id, portfolioId, stockKey, limit).all();
    } else if (portfolioId) {
      rows = await env.DB.prepare(
        "SELECT * FROM transactions WHERE user_id=? AND portfolio_id=? ORDER BY executed_at DESC,created_at DESC LIMIT ?"
      ).bind(user.id, portfolioId, limit).all();
    } else {
      rows = await env.DB.prepare(
        "SELECT * FROM transactions WHERE user_id=? ORDER BY executed_at DESC,created_at DESC LIMIT ?"
      ).bind(user.id, limit).all();
    }

    let summary = null, portfolioSummary = null;
    if (portfolioId && stockKey) {
      const ascending = await transactionRows(env, user.id, portfolioId, stockKey);
      summary = calculateTransactionLedger(ascending);
    } else if (portfolioId) {
      const all = await env.DB.prepare(
        "SELECT * FROM transactions WHERE user_id=? AND portfolio_id=? ORDER BY executed_at ASC,created_at ASC"
      ).bind(user.id, portfolioId).all();
      portfolioSummary = calculatePortfolioTransactionSummary(all.results || []);
    }
    return json({ transactions: rows.results || [], summary, portfolioSummary });
  }

  if (request.method === "POST" && !id) {
    const body = await readJson(request);
    const data = transactionPayload(body);
    if (!data.portfolioId || !data.stockKey || !data.ticker) return json({ error: "portfolioId, stockKey and ticker are required" }, 400);
    if (!["BUY","SELL"].includes(data.side)) return json({ error: "side must be BUY or SELL" }, 400);
    if (data.quantity === null || data.quantity <= 0) return json({ error: "quantity must be greater than zero" }, 400);
    if (data.price === null || data.price < 0) return json({ error: "price must be zero or greater" }, 400);
    if (data.fees < 0) return json({ error: "fees cannot be negative" }, 400);
    if (!data.executedAt) return json({ error: "executedAt is invalid" }, 400);
    if (!(await onePortfolio(env, user.id, data.portfolioId))) return json({ error: "Portfolio not found" }, 404);

    const position = await env.DB.prepare(
      "SELECT * FROM positions WHERE user_id=? AND portfolio_id=? AND stock_key=?"
    ).bind(user.id, data.portfolioId, data.stockKey).first();
    if (position) {
      await ensureOpeningTransaction(env, user.id, position);
      const positionCurrency = String(position.currency || data.currency).toUpperCase();
      if (positionCurrency !== data.currency) return json({ error: "Transaction currency must match the position currency" }, 400);
    }

    const beforeRows = await transactionRows(env, user.id, data.portfolioId, data.stockKey);
    const before = calculateTransactionLedger(beforeRows);
    if (data.side === "SELL" && data.quantity > before.quantity + 1e-8) {
      return json({ error: "Sell quantity exceeds current position" }, 400);
    }

    const txId = uid("tx_");
    const now = nowIso();
    await env.DB.prepare(
      "INSERT INTO transactions (id,portfolio_id,user_id,stock_key,ticker,name,exchange,isin,prefer_tr,side,quantity,price,fees,currency,executed_at,notes,origin,created_at,updated_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'manual',?,?)"
    ).bind(
      txId, data.portfolioId, user.id, data.stockKey, data.ticker, data.name, data.exchange, data.isin, data.preferTr,
      data.side, data.quantity, data.price, data.fees, data.currency, data.executedAt, data.notes, now, now
    ).run();

    const recalculated = await recalculatePositionFromTransactions(env, user.id, data.portfolioId, data.stockKey);
    const transaction = await env.DB.prepare("SELECT * FROM transactions WHERE id=? AND user_id=?").bind(txId, user.id).first();
    return json({ transaction, position: recalculated && recalculated.position, summary: recalculated && recalculated.ledger }, 201);
  }

  if (!id) return json({ error: "Transaction id required" }, 400);
  const existing = await env.DB.prepare("SELECT * FROM transactions WHERE id=? AND user_id=?").bind(id, user.id).first();
  if (!existing) return json({ error: "Transaction not found" }, 404);

  if (request.method === "DELETE") {
    if (String(existing.origin || "") === "position-seed") {
      return json({ error: "The initial imported transaction cannot be deleted directly" }, 409);
    }
    await env.DB.prepare("DELETE FROM transactions WHERE id=? AND user_id=?").bind(id, user.id).run();
    const recalculated = await recalculatePositionFromTransactions(env, user.id, existing.portfolio_id, existing.stock_key);
    return json({ deleted: true, position: recalculated && recalculated.position, summary: recalculated && recalculated.ledger });
  }

  return json({ error: "Method not allowed" }, 405);
}


async function handleFundPlans(request, env, user, json, parts, url) {
  await ensureFundSchema(env);
  const id=parts[1]||"";
  if(request.method==="GET"&&!id){
    const portfolioId=trimText(url.searchParams.get("portfolioId"),80);
    const stmt=portfolioId
      ? env.DB.prepare("SELECT * FROM fund_contribution_plans WHERE user_id=? AND fund_portfolio_id=? ORDER BY enabled DESC,day_of_month ASC,created_at ASC").bind(user.id,portfolioId)
      : env.DB.prepare("SELECT * FROM fund_contribution_plans WHERE user_id=? ORDER BY enabled DESC,created_at ASC").bind(user.id);
    const rows=await stmt.all();return json({plans:rows.results||[]});
  }
  if(request.method==="POST"&&!id){
    const body=await readJson(request);
    const portfolioId=trimText(body.fundPortfolioId,80);
    if(!portfolioId||!(await oneFundPortfolio(env,user.id,portfolioId)))return json({error:"Fund portfolio not found"},404);
    const amount=finiteNumber(body.amount),day=Math.round(finiteNumber(body.dayOfMonth)||0);
    if(amount!==null&&amount<0)return json({error:"amount cannot be negative"},400);
    if(day<0||day>31)return json({error:"dayOfMonth must be between 1 and 31"},400);
    const now=nowIso(),idNew=uid("fplan_");
    await env.DB.prepare(
      "INSERT INTO fund_contribution_plans (id,fund_portfolio_id,fund_position_id,user_id,isin,label,kind,amount,currency,day_of_month,frequency,enabled,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(idNew,portfolioId,trimText(body.fundPositionId,80)||null,user.id,trimText(body.isin,24).toUpperCase(),trimText(body.label,160),trimText(body.kind,30)||"monthly",amount,String(body.currency||"EUR").toUpperCase(),day||null,trimText(body.frequency,30)||"monthly",body.enabled===false?0:1,trimText(body.notes,1000),now,now).run();
    return json({plan:await env.DB.prepare("SELECT * FROM fund_contribution_plans WHERE id=? AND user_id=?").bind(idNew,user.id).first()},201);
  }
  if(!id)return json({error:"Fund plan id required"},400);
  const existing=await env.DB.prepare("SELECT * FROM fund_contribution_plans WHERE id=? AND user_id=?").bind(id,user.id).first();
  if(!existing)return json({error:"Fund plan not found"},404);
  if(request.method==="PATCH"){
    const body=await readJson(request);
    const amount=body.amount!==undefined?finiteNumber(body.amount):finiteNumber(existing.amount);
    const day=body.dayOfMonth!==undefined?Math.round(finiteNumber(body.dayOfMonth)||0):Number(existing.day_of_month||0);
    if(amount!==null&&amount<0)return json({error:"amount cannot be negative"},400);
    if(day<0||day>31)return json({error:"dayOfMonth must be between 1 and 31"},400);
    await env.DB.prepare("UPDATE fund_contribution_plans SET label=?,kind=?,amount=?,currency=?,day_of_month=?,frequency=?,enabled=?,notes=?,updated_at=? WHERE id=? AND user_id=?")
      .bind(body.label!==undefined?trimText(body.label,160):existing.label,body.kind!==undefined?trimText(body.kind,30):existing.kind,amount,body.currency!==undefined?String(body.currency||"EUR").toUpperCase():existing.currency,day||null,body.frequency!==undefined?trimText(body.frequency,30):existing.frequency,body.enabled!==undefined?(body.enabled?1:0):existing.enabled,body.notes!==undefined?trimText(body.notes,1000):existing.notes,nowIso(),id,user.id).run();
    return json({plan:await env.DB.prepare("SELECT * FROM fund_contribution_plans WHERE id=? AND user_id=?").bind(id,user.id).first()});
  }
  if(request.method==="DELETE"){
    await env.DB.prepare("DELETE FROM fund_contribution_plans WHERE id=? AND user_id=?").bind(id,user.id).run();
    return json({deleted:true});
  }
  return json({error:"Method not allowed"},405);
}

async function handleFundPortfolios(request, env, user, json, parts) {
  await ensureFundSchema(env);
  const id = parts[1] || "";
  if (request.method === "GET" && !id) {
    const rows = await env.DB.prepare(
      "SELECT p.*, (SELECT COUNT(*) FROM fund_positions x WHERE x.fund_portfolio_id=p.id AND x.active=1) AS position_count " +
      "FROM fund_portfolios p WHERE p.user_id=? ORDER BY p.sort_order ASC,p.created_at ASC"
    ).bind(user.id).all();
    return json({ portfolios: rows.results || [] });
  }
  if (request.method === "POST" && !id) {
    const body = await readJson(request);
    const data = fundPortfolioPayload(body);
    if (!data.name) return json({ error: "Fund portfolio name is required" }, 400);
    const idNew = uid("fpf_"), now = nowIso();
    await env.DB.prepare(
      "INSERT INTO fund_portfolios (id,user_id,name,platform,base_currency,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(idNew,user.id,data.name,data.platform,data.baseCurrency,data.sortOrder,now,now).run();
    return json({ portfolio: await oneFundPortfolio(env,user.id,idNew) },201);
  }
  if (!id) return json({ error: "Fund portfolio id required" },400);
  const existing = await oneFundPortfolio(env,user.id,id);
  if (!existing) return json({ error: "Fund portfolio not found" },404);
  if (request.method === "PATCH") {
    const body = await readJson(request);
    const data = fundPortfolioPayload({
      name: body.name !== undefined ? body.name : existing.name,
      platform: body.platform !== undefined ? body.platform : existing.platform,
      baseCurrency: body.baseCurrency !== undefined ? body.baseCurrency : existing.base_currency,
      sortOrder: body.sortOrder !== undefined ? body.sortOrder : existing.sort_order
    });
    if (!data.name) return json({ error: "Fund portfolio name is required" },400);
    await env.DB.prepare(
      "UPDATE fund_portfolios SET name=?,platform=?,base_currency=?,sort_order=?,updated_at=? WHERE id=? AND user_id=?"
    ).bind(data.name,data.platform,data.baseCurrency,data.sortOrder,nowIso(),id,user.id).run();
    return json({ portfolio: await oneFundPortfolio(env,user.id,id) });
  }
  if (request.method === "DELETE") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM fund_transactions WHERE fund_portfolio_id=? AND user_id=?").bind(id,user.id),
      env.DB.prepare("DELETE FROM fund_positions WHERE fund_portfolio_id=? AND user_id=?").bind(id,user.id),
      env.DB.prepare("DELETE FROM fund_portfolios WHERE id=? AND user_id=?").bind(id,user.id)
    ]);
    return json({ deleted:true });
  }
  return json({ error:"Method not allowed" },405);
}

async function handleFundPositions(request, env, user, json, parts, url) {
  await ensureFundSchema(env);
  const id = parts[1] || "";
  if (request.method === "GET" && !id) {
    const portfolioId = trimText(url.searchParams.get("portfolioId"),80);
    const stmt = portfolioId
      ? env.DB.prepare("SELECT * FROM fund_positions WHERE user_id=? AND fund_portfolio_id=? AND active=1 ORDER BY created_at DESC").bind(user.id,portfolioId)
      : env.DB.prepare("SELECT * FROM fund_positions WHERE user_id=? AND active=1 ORDER BY created_at DESC").bind(user.id);
    const rows = await stmt.all();
    return json({ positions: rows.results || [] });
  }
  if (request.method === "POST" && !id) {
    const body = await readJson(request);
    const data = fundPositionPayload(body);
    if (!data.fundPortfolioId || !/^[A-Z]{2}[A-Z0-9]{10}$/.test(data.isin)) {
      return json({ error:"fundPortfolioId and valid ISIN are required" },400);
    }
    if (data.units === null || data.units < 0) return json({ error:"units must be zero or greater" },400);
    if (data.avgPrice !== null && data.avgPrice < 0) return json({ error:"avgPrice cannot be negative" },400);
    if (!(await oneFundPortfolio(env,user.id,data.fundPortfolioId))) return json({ error:"Fund portfolio not found" },404);
    const existing = await env.DB.prepare(
      "SELECT id FROM fund_positions WHERE user_id=? AND fund_portfolio_id=? AND isin=?"
    ).bind(user.id,data.fundPortfolioId,data.isin).first();
    const idNew = existing && existing.id ? existing.id : uid("fpos_"), now = nowIso();
    await env.DB.prepare(
      "INSERT INTO fund_positions (id,fund_portfolio_id,user_id,isin,name,product_type,provider,index_name,platform,units,avg_price,currency,opened_at,notes,active,created_at,updated_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?) " +
      "ON CONFLICT(fund_portfolio_id,isin) DO UPDATE SET name=excluded.name,product_type=excluded.product_type,provider=excluded.provider,index_name=excluded.index_name,platform=excluded.platform,units=excluded.units,avg_price=excluded.avg_price,currency=excluded.currency,opened_at=excluded.opened_at,notes=excluded.notes,active=1,updated_at=excluded.updated_at"
    ).bind(idNew,data.fundPortfolioId,user.id,data.isin,data.name,data.productType,data.provider,data.indexName,data.platform,data.units,data.avgPrice,data.currency,data.openedAt,data.notes,now,now).run();
    return json({ position: await env.DB.prepare("SELECT * FROM fund_positions WHERE id=? AND user_id=?").bind(idNew,user.id).first() },existing?200:201);
  }
  if (!id) return json({ error:"Fund position id required" },400);
  const existing = await env.DB.prepare("SELECT * FROM fund_positions WHERE id=? AND user_id=?").bind(id,user.id).first();
  if (!existing) return json({ error:"Fund position not found" },404);
  if (request.method === "PATCH") {
    const body = await readJson(request);
    const data = fundPositionPayload({
      fundPortfolioId: body.fundPortfolioId !== undefined ? body.fundPortfolioId : existing.fund_portfolio_id,
      isin: existing.isin,
      name: body.name !== undefined ? body.name : existing.name,
      productType: body.productType !== undefined ? body.productType : existing.product_type,
      provider: body.provider !== undefined ? body.provider : existing.provider,
      indexName: body.indexName !== undefined ? body.indexName : existing.index_name,
      platform: body.platform !== undefined ? body.platform : existing.platform,
      units: body.units !== undefined ? body.units : existing.units,
      avgPrice: body.avgPrice !== undefined ? body.avgPrice : existing.avg_price,
      currency: body.currency !== undefined ? body.currency : existing.currency,
      openedAt: body.openedAt !== undefined ? body.openedAt : existing.opened_at,
      notes: body.notes !== undefined ? body.notes : existing.notes
    });
    if (data.units === null || data.units < 0) return json({ error:"units must be zero or greater" },400);
    if (!(await oneFundPortfolio(env,user.id,data.fundPortfolioId))) return json({ error:"Fund portfolio not found" },404);
    await env.DB.prepare(
      "UPDATE fund_positions SET fund_portfolio_id=?,name=?,product_type=?,provider=?,index_name=?,platform=?,units=?,avg_price=?,currency=?,opened_at=?,notes=?,updated_at=? WHERE id=? AND user_id=?"
    ).bind(data.fundPortfolioId,data.name,data.productType,data.provider,data.indexName,data.platform,data.units,data.avgPrice,data.currency,data.openedAt,data.notes,nowIso(),id,user.id).run();
    return json({ position: await env.DB.prepare("SELECT * FROM fund_positions WHERE id=? AND user_id=?").bind(id,user.id).first() });
  }
  if (request.method === "DELETE") {
    await env.DB.prepare("UPDATE fund_positions SET active=0,updated_at=? WHERE id=? AND user_id=?").bind(nowIso(),id,user.id).run();
    return json({ deleted:true });
  }
  return json({ error:"Method not allowed" },405);
}


export function calculateFundLedger(rows) {
  let units=0,costBasis=0,realized=0,currency="EUR",firstBuyAt=null,totalFees=0;
  for(const row of rows||[]){
    const side=String(row.side||"").toUpperCase();
    const qty=finiteNumber(row.units),price=finiteNumber(row.price),fees=Math.max(0,finiteNumber(row.fees)||0);
    const cur=String(row.currency||currency||"EUR").toUpperCase();
    if(qty===null||qty<=0||price===null||price<0)continue;
    if(units>1e-8&&cur!==currency)throw new Error("Fund transaction currency differs from current position");
    if(units<=1e-8)currency=cur;
    totalFees+=fees;
    if(side==="BUY"){
      if(!firstBuyAt)firstBuyAt=row.executed_at||row.created_at||null;
      units+=qty;
      costBasis+=qty*price+fees;
    }else if(side==="SELL"){
      if(qty>units+1e-8)throw new Error("Sell units exceed current fund position");
      const avg=units>1e-8?costBasis/units:0;
      realized+=qty*price-fees-qty*avg;
      units-=qty;
      costBasis-=qty*avg;
      if(units<=1e-8){units=0;costBasis=0}
    }
  }
  return {units,avgPrice:units>1e-8?costBasis/units:null,invested:costBasis,realizedPnl:realized,totalFees,currency,firstBuyAt};
}

async function fundTransactionRows(env,userId,positionId){
  await ensureFundSchema(env);
  const rows=await env.DB.prepare(
    "SELECT * FROM fund_transactions WHERE user_id=? AND fund_position_id=? ORDER BY executed_at ASC,created_at ASC,id ASC"
  ).bind(userId,positionId).all();
  return rows.results||[];
}

async function ensureFundOpeningTransaction(env,userId,position){
  if(!position)return;
  const existing=await env.DB.prepare("SELECT id FROM fund_transactions WHERE user_id=? AND fund_position_id=? LIMIT 1").bind(userId,position.id).first();
  if(existing)return;
  const units=finiteNumber(position.units),avg=finiteNumber(position.avg_price);
  if(units===null||units<=0||avg===null||avg<0)return;
  const now=nowIso(),executed=position.opened_at||position.created_at||now;
  await env.DB.prepare(
    "INSERT INTO fund_transactions (id,fund_portfolio_id,fund_position_id,user_id,isin,side,units,price,fees,currency,executed_at,notes,created_at,updated_at) VALUES (?,?,?,?,?,'BUY',?,?,?,?,?,?,?,?)"
  ).bind(uid("ftx_seed_"),position.fund_portfolio_id,position.id,userId,position.isin,units,avg,0,String(position.currency||"EUR").toUpperCase(),executed,"Saldo inicial importado",now,now).run();
}

async function recalculateFundPosition(env,userId,positionId){
  const existing=await env.DB.prepare("SELECT * FROM fund_positions WHERE id=? AND user_id=?").bind(positionId,userId).first();
  if(!existing)return null;
  const ledger=calculateFundLedger(await fundTransactionRows(env,userId,positionId));
  await env.DB.prepare(
    "UPDATE fund_positions SET units=?,avg_price=?,currency=?,opened_at=?,active=?,updated_at=? WHERE id=? AND user_id=?"
  ).bind(ledger.units,ledger.avgPrice,ledger.currency,ledger.firstBuyAt,ledger.units>1e-8?1:0,nowIso(),positionId,userId).run();
  return {position:await env.DB.prepare("SELECT * FROM fund_positions WHERE id=? AND user_id=?").bind(positionId,userId).first(),ledger};
}

async function handleFundTransactions(request,env,user,json,parts,url){
  await ensureFundSchema(env);
  const id=parts[1]||"";
  if(request.method==="GET"&&!id){
    const positionId=trimText(url.searchParams.get("positionId"),80);
    const portfolioId=trimText(url.searchParams.get("portfolioId"),80);
    let rows;
    if(positionId){
      rows=await env.DB.prepare("SELECT * FROM fund_transactions WHERE user_id=? AND fund_position_id=? ORDER BY executed_at DESC,created_at DESC").bind(user.id,positionId).all();
      return json({transactions:rows.results||[],summary:calculateFundLedger(await fundTransactionRows(env,user.id,positionId))});
    }
    if(portfolioId){
      rows=await env.DB.prepare("SELECT * FROM fund_transactions WHERE user_id=? AND fund_portfolio_id=? ORDER BY executed_at DESC,created_at DESC").bind(user.id,portfolioId).all();
    }else{
      rows=await env.DB.prepare("SELECT * FROM fund_transactions WHERE user_id=? ORDER BY executed_at DESC,created_at DESC LIMIT 500").bind(user.id).all();
    }
    return json({transactions:rows.results||[]});
  }
  if(request.method==="POST"&&!id){
    const body=await readJson(request);
    const positionId=trimText(body.positionId,80);
    const side=String(body.side||"").toUpperCase();
    const units=finiteNumber(body.units),price=finiteNumber(body.price),fees=Math.max(0,finiteNumber(body.fees)||0);
    const currency=/^[A-Z]{3}$/.test(String(body.currency||"EUR").toUpperCase())?String(body.currency||"EUR").toUpperCase():"EUR";
    const dateRaw=trimText(body.executedAt,40),date=dateRaw?new Date(dateRaw):new Date();
    if(!["BUY","SELL"].includes(side))return json({error:"side must be BUY or SELL"},400);
    if(units===null||units<=0)return json({error:"units must be greater than zero"},400);
    if(price===null||price<0)return json({error:"price must be zero or greater"},400);
    if(!Number.isFinite(date.getTime()))return json({error:"executedAt is invalid"},400);
    const position=await env.DB.prepare("SELECT * FROM fund_positions WHERE id=? AND user_id=?").bind(positionId,user.id).first();
    if(!position)return json({error:"Fund position not found"},404);
    await ensureFundOpeningTransaction(env,user.id,position);
    const before=calculateFundLedger(await fundTransactionRows(env,user.id,positionId));
    if(side==="SELL"&&units>before.units+1e-8)return json({error:"Sell units exceed current fund position"},400);
    if(before.units>1e-8&&before.currency!==currency)return json({error:"Transaction currency must match the fund position"},400);
    const txId=uid("ftx_"),now=nowIso();
    await env.DB.prepare(
      "INSERT INTO fund_transactions (id,fund_portfolio_id,fund_position_id,user_id,isin,side,units,price,fees,currency,executed_at,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(txId,position.fund_portfolio_id,position.id,user.id,position.isin,side,units,price,fees,currency,date.toISOString(),trimText(body.notes,1000),now,now).run();
    const recalculated=await recalculateFundPosition(env,user.id,position.id);
    return json({transaction:await env.DB.prepare("SELECT * FROM fund_transactions WHERE id=? AND user_id=?").bind(txId,user.id).first(),position:recalculated&&recalculated.position,summary:recalculated&&recalculated.ledger},201);
  }
  if(!id)return json({error:"Fund transaction id required"},400);
  const existing=await env.DB.prepare("SELECT * FROM fund_transactions WHERE id=? AND user_id=?").bind(id,user.id).first();
  if(!existing)return json({error:"Fund transaction not found"},404);
  if(request.method==="DELETE"){
    await env.DB.prepare("DELETE FROM fund_transactions WHERE id=? AND user_id=?").bind(id,user.id).run();
    const recalculated=await recalculateFundPosition(env,user.id,existing.fund_position_id);
    return json({deleted:true,position:recalculated&&recalculated.position,summary:recalculated&&recalculated.ledger});
  }
  return json({error:"Method not allowed"},405);
}

async function handleWatchlist(request, env, user, json, parts) {
  const id = parts[1] || "";
  if (request.method === "GET" && !id) {
    const rows = await env.DB.prepare("SELECT * FROM watchlist WHERE user_id=? ORDER BY created_at DESC").bind(user.id).all();
    return json({ watchlist: rows.results || [] });
  }

  if (request.method === "POST" && !id) {
    const body = await readJson(request);
    const data = watchPayload(body);
    if (!data.stockKey || !data.ticker) return json({ error: "stockKey and ticker are required" }, 400);
    const existing = await env.DB.prepare("SELECT id FROM watchlist WHERE user_id=? AND stock_key=?").bind(user.id, data.stockKey).first();
    const idNew = existing && existing.id ? existing.id : uid("wl_");
    const now = nowIso();
    await env.DB.prepare(
      "INSERT INTO watchlist (id,user_id,stock_key,ticker,name,exchange,isin,prefer_tr,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) " +
      "ON CONFLICT(user_id,stock_key) DO UPDATE SET ticker=excluded.ticker,name=excluded.name,exchange=excluded.exchange,isin=excluded.isin,prefer_tr=excluded.prefer_tr,notes=excluded.notes,updated_at=excluded.updated_at"
    ).bind(idNew, user.id, data.stockKey, data.ticker, data.name, data.exchange, data.isin, data.preferTr, data.notes, now, now).run();
    return json({ item: await env.DB.prepare("SELECT * FROM watchlist WHERE id=? AND user_id=?").bind(idNew, user.id).first() }, existing ? 200 : 201);
  }

  if (!id) return json({ error: "Watchlist id required" }, 400);
  const existing = await env.DB.prepare("SELECT * FROM watchlist WHERE id=? AND user_id=?").bind(id, user.id).first();
  if (!existing) return json({ error: "Watchlist item not found" }, 404);

  if (request.method === "PATCH") {
    const body = await readJson(request);
    const data = watchPayload({
      stockKey: existing.stock_key,
      ticker: body.ticker !== undefined ? body.ticker : existing.ticker,
      name: body.name !== undefined ? body.name : existing.name,
      exchange: body.exchange !== undefined ? body.exchange : existing.exchange,
      isin: body.isin !== undefined ? body.isin : existing.isin,
      preferTr: body.preferTr !== undefined ? body.preferTr : existing.prefer_tr,
      notes: body.notes !== undefined ? body.notes : existing.notes
    });
    await env.DB.prepare(
      "UPDATE watchlist SET ticker=?,name=?,exchange=?,isin=?,prefer_tr=?,notes=?,updated_at=? WHERE id=? AND user_id=?"
    ).bind(data.ticker, data.name, data.exchange, data.isin, data.preferTr, data.notes, nowIso(), id, user.id).run();
    return json({ item: await env.DB.prepare("SELECT * FROM watchlist WHERE id=? AND user_id=?").bind(id, user.id).first() });
  }

  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM watchlist WHERE id=? AND user_id=?").bind(id, user.id).run();
    return json({ deleted: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function handleAnalysisList(request, env, user, json, url) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const stockKey = trimText(url.searchParams.get("stockKey"), 80).toUpperCase();
  const limit = Math.max(1, Math.min(100, Math.round(finiteNumber(url.searchParams.get("limit")) || 30)));
  const rows = stockKey
    ? await env.DB.prepare("SELECT * FROM analysis_snapshots WHERE user_id=? AND stock_key=? ORDER BY created_at DESC LIMIT ?").bind(user.id, stockKey, limit).all()
    : await env.DB.prepare("SELECT * FROM analysis_snapshots WHERE user_id=? ORDER BY created_at DESC LIMIT ?").bind(user.id, limit).all();
  return json({ analysis: rows.results || [] });
}

async function handleAlerts(request, env, user, json, parts) {
  const action = parts[1] || "";
  if (request.method === "GET" && !action) {
    const rows = await env.DB.prepare(
      "SELECT * FROM alert_events WHERE user_id=? ORDER BY created_at DESC LIMIT 100"
    ).bind(user.id).all();
    return json({ alerts: rows.results || [] });
  }

  if (request.method === "POST" && action === "read") {
    const body = await readJson(request);
    const ids = Array.isArray(body.ids) ? body.ids.map(x => trimText(x, 80)).filter(Boolean).slice(0, 100) : [];
    if (!ids.length) return json({ updated: 0 });
    const stamp = nowIso();
    await env.DB.batch(ids.map(id => env.DB.prepare("UPDATE alert_events SET read_at=? WHERE id=? AND user_id=?").bind(stamp, id, user.id)));
    return json({ updated: ids.length });
  }

  return json({ error: "Method not allowed" }, 405);
}

function findStock(snapshot, target) {
  const stocks = snapshot && Array.isArray(snapshot.stocks) ? snapshot.stocks : [];
  const wanted = String(target.stock_key || "").toUpperCase();
  if (wanted) {
    const exact = stocks.find(s => String(s.tvSymbol || ((s.exchange || "") + ":" + (s.ticker || ""))).toUpperCase() === wanted);
    if (exact) return exact;
  }
  const ticker = String(target.ticker || "").toUpperCase();
  return stocks.find(s => String(s.ticker || "").toUpperCase() === ticker) || null;
}

function recentEvents(snapshot, stock, limit = 12) {
  const ticker = String(stock && stock.ticker || "").toUpperCase();
  const events = snapshot && Array.isArray(snapshot.events) ? snapshot.events : [];
  return events.filter(e => String(e.ticker || "").toUpperCase() === ticker)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, limit)
    .map(e => ({
      id: trimText(e.id || "", 160),
      date: e.date || null,
      eventKind: e.eventKind || (e.type === "news" ? "news" : "event"),
      type: e.type || e.eventKind || "event",
      title: trimText(e.title || e.fact || "", 240),
      fact: trimText(e.fact || e.title || "", 300),
      impact: trimText(e.hypothesis || e.impact || e.context || "", 260),
      impactScore: finiteNumber(e.impactScore),
      verification: trimText(e.verification || "", 180),
      sourceCount: finiteNumber(e.sourceCount),
      independentSourceCount: finiteNumber(e.independentSourceCount),
      corroborated: e.corroborated === true,
      source: trimText(e.source || "", 120),
      url: trimText(e.url || e.sourceUrl || "", 500)
    }));
}

function average(values) {
  const a = values.map(finiteNumber).filter(v => v !== null);
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
}

function chartFeatures(chart) {
  const raw = chart && Array.isArray(chart.points) ? chart.points : [];
  const points = raw.map(p => ({
    price: finiteNumber(p.close !== undefined ? p.close : p.price),
    volume: finiteNumber(p.volume)
  })).filter(p => p.price !== null).slice(-240);
  if (points.length < 20) return { available: false, points: points.length };

  const closes = points.map(p => p.price);
  const last = closes[closes.length - 1];
  const sma10 = average(closes.slice(-10));
  const sma30 = average(closes.slice(-30));
  const base20 = closes[Math.max(0, closes.length - 21)];
  const return20 = base20 > 0 ? (last / base20 - 1) * 100 : null;
  const hi30 = Math.max(...closes.slice(-30));
  const lo30 = Math.min(...closes.slice(-30));
  const drawdown30 = hi30 > 0 ? (last / hi30 - 1) * 100 : null;
  const rangePosition = hi30 > lo30 ? (last - lo30) / (hi30 - lo30) : 0.5;
  const recentVol = average(points.slice(-8).map(p => p.volume));
  const priorVol = average(points.slice(-28, -8).map(p => p.volume));
  const volumeExpansion = recentVol !== null && priorVol > 0 ? recentVol / priorVol : null;

  return {
    available: true,
    points: points.length,
    last,
    sma10,
    sma30,
    trendUp: last > sma10 && sma10 > sma30,
    return20,
    drawdown30,
    rangePosition,
    volumeExpansion
  };
}

function deterministicAssessment(target, stock, chart, events) {
  const engine = globalThis.ViewInvAIScore;
  const preferTr = Number(target.prefer_tr) === 1;
  const price = preferTr && chart && chart.available ? finiteNumber(chart.last) : finiteNumber(stock.price);
  const change = preferTr && chart && chart.available
    ? finiteNumber(chart.return20)
    : finiteNumber(stock.usLiveChangePct ?? stock.changePct ?? stock.premarketChangePct);
  const bid = preferTr ? finiteNumber(stock.trLiveBid ?? stock.usBid) : finiteNumber(stock.usLiveBid ?? stock.usBid);
  const ask = preferTr ? finiteNumber(stock.trLiveAsk ?? stock.usAsk) : finiteNumber(stock.usLiveAsk ?? stock.usAsk);
  const spread = bid !== null && ask !== null && ask >= bid && (ask + bid) > 0
    ? (ask - bid) / ((ask + bid) / 2) * 100
    : null;

  const input = {
    price,
    change,
    volume: finiteNumber(stock.usLiveVolume ?? stock.volume),
    avgVolume: finiteNumber(stock.avgVolume),
    relVolume: finiteNumber(stock.relVolume),
    rsi: finiteNumber(stock.rsi),
    adx: finiteNumber(stock.adx),
    ema20: finiteNumber(stock.ema20),
    ema50: finiteNumber(stock.ema50),
    perfWeek: finiteNumber(stock.perfWeek),
    perfMonth: finiteNumber(stock.perfMonth),
    spread,
    bid,
    ask,
    chartAvailable: !!(chart && chart.available)
  };

  if (!engine || typeof engine.analyze !== "function") {
    return {
      signal: target.subject_type === "position" ? "REVIEW" : "WATCH",
      confidence: 50,
      score: 50,
      quality: 0,
      horizon: "1-2d",
      thesis: "El motor compartido de puntuación no está disponible temporalmente.",
      riskSummary: "No se emite una señal fuerte sin el motor determinista.",
      reasons: [],
      catalysts: events.slice(0, 4).map(e => e.title).filter(Boolean),
      engine: "score-engine-unavailable",
      model: ""
    };
  }

  const assessment = engine.analyze(input, events);
  const quality = assessment.quality && finiteNumber(assessment.quality.score) !== null ? assessment.quality.score : 0;
  const isPosition = target.subject_type === "position";
  const rawSignal = isPosition
    ? engine.positionSignal(assessment.score, quality)
    : engine.watchSignal(assessment.score, quality);
  const signal = isPosition ? rawSignal : (rawSignal === "WAIT" ? "WATCH" : rawSignal);
  const distance = Math.abs(assessment.score - 50);
  const confidence = Math.max(50, Math.min(95, Math.round(48 + distance * 0.65 + quality * 0.18)));
  const positive = (assessment.factors || []).filter(x => finiteNumber(x.delta) > 2).sort((a,b)=>b.delta-a.delta);
  const negative = (assessment.factors || []).filter(x => finiteNumber(x.delta) < -2).sort((a,b)=>a.delta-b.delta);
  const reasons = [...positive.slice(0, 3), ...negative.slice(0, 2)]
    .slice(0, 4)
    .map(x => x.label + (x.note ? " · " + x.note : ""));

  return {
    signal,
    confidence,
    score: assessment.score,
    quality,
    horizon: "1-2d",
    thesis: isPosition
      ? (signal === "SELL"
          ? "El score común de ViewInvAI se ha deteriorado hasta zona de salida."
          : signal === "REVIEW"
            ? "La posición requiere revisión porque la convicción o la calidad de los datos no son suficientes."
            : "La posición mantiene una lectura compatible con seguimiento.")
      : (signal === "BUY"
          ? "El score común de ViewInvAI supera el umbral de entrada con calidad de datos suficiente."
          : signal === "AVOID"
            ? "La combinación actual de momentum, tendencia, liquidez y catalizadores es desfavorable."
            : "Todavía no existe confirmación suficiente para una entrada fuerte."),
    riskSummary: negative.length
      ? "Principales riesgos: " + negative.slice(0, 2).map(x => x.label).join(", ") + "."
      : "Persisten riesgos de volatilidad y cambios rápidos de momentum.",
    reasons,
    catalysts: (assessment.catalyst && assessment.catalyst.events || []).slice(0, 4).map(x => x.event && x.event.title).filter(Boolean),
    engine: "viewinvai-score/" + (engine.VERSION || "unknown"),
    model: ""
  };
}

function extractAiJson(result) {
  let text = "";
  if (typeof result === "string") text = result;
  else if (result && typeof result.response === "string") text = result.response;
  else if (result && typeof result.result === "string") text = result.result;
  else if (result && result.response && typeof result.response.response === "string") text = result.response.response;
  if (!text) return null;
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(text.slice(first, last + 1)); } catch (_) { return null; }
}

async function aiAssessment(env, target, stock, chart, events, fallback) {
  if (!env.AI || typeof env.AI.run !== "function") return fallback;
  const model = trimText(env.AI_MODEL || DEFAULT_AI_MODEL, 120) || DEFAULT_AI_MODEL;

  const prompt = [
    "You are ViewInvAI, a risk-aware market monitoring assistant.",
    "Use ONLY the supplied structured data. Do not invent facts or news.",
    "Distinguish source verification from market interpretation. An issuer-distributed release is not independent corroboration.",
    "The user may own the stock (position) or only follow it (watchlist).",
    "The deterministicReference is a quantitative baseline, not an instruction. Independently assess whether the supplied evidence supports it.",
    "Use the model for contextual synthesis across price action, liquidity, trend, catalysts, sector exposure and recent verified news.",
    "Do not invent breaking facts, geopolitical events, sentiment or social activity that are absent from the supplied structured data.",
    "For a position, signal must be HOLD, REVIEW, or SELL. For watchlist, signal must be BUY, WATCH, or AVOID.",
    "Return JSON only with keys: signal, confidence, scoreAdjustment, horizon, thesis, riskSummary, reasons (max 4 strings), catalysts (max 4 strings). scoreAdjustment must be between -12 and 12.",
    "",
    JSON.stringify({
      subject: {
        type: target.subject_type,
        quantity: finiteNumber(target.quantity),
        avgPrice: finiteNumber(target.avg_price),
        currency: target.currency || null
      },
      stock: {
        stockKey: target.stock_key,
        ticker: Number(target.prefer_tr) === 1 ? (stock.trTicker || stock.ticker) : stock.ticker,
        name: stock.name,
        exchange: Number(target.prefer_tr) === 1 ? (stock.trExchange || "LSX") : stock.exchange,
        market: Number(target.prefer_tr) === 1 ? "Trade Republic / LSX" : "EEUU",
        currency: Number(target.prefer_tr) === 1 ? "EUR" : "USD",
        price: Number(target.prefer_tr) === 1 && chart && chart.available ? chart.last : stock.price,
        changePct: Number(target.prefer_tr) === 1 && chart && chart.available ? chart.return20 : (stock.usLiveChangePct ?? stock.changePct ?? stock.premarketChangePct),
        relVolume: stock.relVolume,
        volume: stock.usLiveVolume ?? stock.volume,
        avgVolume: stock.avgVolume,
        rsi: stock.rsi,
        adx: stock.adx,
        ema20: stock.ema20,
        ema50: stock.ema50,
        marketCap: stock.marketCap
      },
      chart,
      recentEvents: events,
      deterministicReference: {
        score: fallback.score,
        signal: fallback.signal,
        confidence: fallback.confidence
      }
    })
  ].join("\n");

  try {
    const result = await env.AI.run(model, {
      prompt,
      max_tokens: 520,
      temperature: 0.1
    });
    const parsed = extractAiJson(result);
    if (!parsed) return fallback;

    const isPosition = target.subject_type === "position";
    const allowed = new Set(isPosition ? ["HOLD","REVIEW","SELL"] : ["BUY","WATCH","AVOID"]);
    let candidate = String(parsed.signal || fallback.signal || "").toUpperCase();
    if (!allowed.has(candidate)) candidate = fallback.signal;
    const adjustment = Math.max(-12, Math.min(12, finiteNumber(parsed.scoreAdjustment) ?? 0));
    const score = Math.max(0, Math.min(100, Math.round((fallback.score + adjustment) * 10) / 10));
    const quality = finiteNumber(fallback.quality) ?? 0;
    if (quality < 55) candidate = isPosition ? "REVIEW" : "WATCH";
    if (!isPosition && candidate === "BUY" && score < 60) candidate = "WATCH";
    if (isPosition && candidate === "SELL" && score > 55) candidate = "REVIEW";
    const aiConfidence = Math.max(0, Math.min(100, finiteNumber(parsed.confidence) ?? fallback.confidence));
    const confidence = Math.round(Math.max(45, Math.min(96, fallback.confidence * 0.45 + aiConfidence * 0.55)));
    return {
      signal: candidate,
      confidence,
      score,
      horizon: trimText(parsed.horizon || fallback.horizon || "1-2d", 24) || "1-2d",
      thesis: trimText(parsed.thesis || fallback.thesis, 500),
      riskSummary: trimText(parsed.riskSummary || fallback.riskSummary, 500),
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(x => trimText(x, 180)).filter(Boolean).slice(0, 4) : fallback.reasons,
      catalysts: Array.isArray(parsed.catalysts) ? parsed.catalysts.map(x => trimText(x, 180)).filter(Boolean).slice(0, 4) : fallback.catalysts,
      engine: "viewinvai-hybrid/" + (globalThis.ViewInvAIScore && globalThis.ViewInvAIScore.VERSION || "unknown") + "+workers-ai",
      model
    };
  } catch (error) {
    console.warn("Workers AI analysis failed", String(error && error.message || error));
    return fallback;
  }
}

async function analysisSettingsForUser(env, userId) {
  const row = await env.DB.prepare(
    "SELECT analysis_positions_minutes,analysis_watchlist_minutes,min_buy_confidence,min_sell_confidence,notify_score_change FROM user_settings WHERE user_id=?"
  ).bind(userId).first();
  return {
    positionsMinutes: Math.max(5, Math.min(240, Math.round(finiteNumber(row && row.analysis_positions_minutes) ?? 10))),
    watchlistMinutes: Math.max(10, Math.min(1440, Math.round(finiteNumber(row && row.analysis_watchlist_minutes) ?? 30))),
    minBuyConfidence: Math.max(60, Math.min(99, Math.round(finiteNumber(row && row.min_buy_confidence) ?? 85))),
    minSellConfidence: Math.max(60, Math.min(99, Math.round(finiteNumber(row && row.min_sell_confidence) ?? 80))),
    notifyScoreChange: Math.max(5, Math.min(60, Math.round(finiteNumber(row && row.notify_score_change) ?? 20)))
  };
}

async function maybeCreateNewsAlerts(env, target, stock, events, snapshotId) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const candidates = (events || [])
    .filter(event => {
      const when = new Date(event && event.date || 0).getTime();
      const impact = finiteNumber(event && event.impactScore) ?? 0;
      return event && event.eventKind === "news" && Number.isFinite(when) && when >= cutoff && impact >= 60;
    })
    .sort((a,b) => (finiteNumber(b.impactScore) ?? 0) - (finiteNumber(a.impactScore) ?? 0) || new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, 3);

  const created = [];
  for (const event of candidates) {
    const message = trimText(event.title || event.fact || "Noticia relacionada con el valor.", 500);
    if (!message) continue;
    const duplicate = await env.DB.prepare(
      "SELECT id FROM alert_events WHERE user_id=? AND stock_key=? AND alert_type='stock-news' AND message=? LIMIT 1"
    ).bind(target.user_id, target.stock_key, message).first();
    if (duplicate) continue;

    const impact = finiteNumber(event.impactScore) ?? 0;
    const severity = impact >= 85 ? "high" : impact >= 70 ? "warning" : "info";
    const id = uid("al_");
    const source = trimText(event.source || event.verification || "", 120);
    const title = "Noticia · " + target.ticker;
    const body = source ? message + " · " + source : message;
    const now = nowIso();

    await env.DB.prepare(
      "INSERT INTO alert_events (id,user_id,stock_key,ticker,name,alert_type,severity,title,message,snapshot_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      id, target.user_id, target.stock_key, target.ticker, stock.name || target.name || "",
      "stock-news", severity, title, body, snapshotId || null, now
    ).run();

    const alert = { id, alert_type: "stock-news", severity, title, message: body };
    try { await dispatchPushAlert(env, alert, target); }
    catch (error) { console.warn("News push dispatch failed", String(error && error.message || error)); }
    created.push(id);
  }
  return created;
}

async function maybeCreateAlert(env, target, stock, current, previous) {
  const previousCompatible = previous && String(previous.engine || "").startsWith("viewinvai-score/");
  const previousScore = previousCompatible ? finiteNumber(previous.score) : null;
  const delta = previousScore === null ? 0 : current.score - previousScore;
  const settings = await analysisSettingsForUser(env, target.user_id);
  let should = false;
  let type = "analysis-change";
  let severity = "info";

  if (target.subject_type === "position") {
    if (current.signal === "SELL" && current.confidence >= settings.minSellConfidence && (!previous || previous.signal !== "SELL")) {
      should = true; type = "position-sell"; severity = "critical";
    } else if (current.signal === "REVIEW" && current.confidence >= Math.max(60, settings.minSellConfidence - 2) && (!previous || previous.signal === "HOLD")) {
      should = true; type = "position-review"; severity = "warning";
    } else if (previousScore !== null && delta <= -settings.notifyScoreChange) {
      should = true; type = "position-deterioration"; severity = "warning";
    }
  } else {
    if (current.signal === "BUY" && current.confidence >= settings.minBuyConfidence && (!previous || previous.signal !== "BUY")) {
      should = true; type = "watchlist-buy"; severity = "high";
    } else if (previousScore !== null && delta >= settings.notifyScoreChange && current.score > 20) {
      should = true; type = "watchlist-improving"; severity = "info";
    }
  }

  if (!should) return null;

  const id = uid("al_");
  const now = nowIso();
  const title = target.subject_type === "position"
    ? (current.signal === "SELL" ? "Revisar salida · " : "Cambio en cartera · ") + target.ticker
    : (current.signal === "BUY" ? "Compra de alta convicción · " : "Mejora relevante · ") + target.ticker;
  const message = current.thesis || current.riskSummary || "Cambio relevante detectado en el análisis.";

  await env.DB.prepare(
    "INSERT INTO alert_events (id,user_id,stock_key,ticker,name,alert_type,severity,title,message,snapshot_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(
    id, target.user_id, target.stock_key, target.ticker, stock.name || target.name || "",
    type, severity, title, message, current.snapshotId, now
  ).run();

  const alert = { id, alert_type: type, severity, title, message };
  try { await dispatchPushAlert(env, alert, target); }
  catch (error) { console.warn("Push alert dispatch failed", String(error && error.message || error)); }
  return id;
}

async function analyzeTarget(env, target, services) {
  const snapshot = await services.loadMarketSnapshot(env);
  const stock = findStock(snapshot, target);
  if (!stock) throw new Error("Stock not found in market snapshot: " + target.stock_key);

  let chartRaw = null;
  try { chartRaw = await services.loadChart(stock, target); } catch (error) {
    console.warn("Chart analysis unavailable", String(error && error.message || error));
  }
  const chart = chartFeatures(chartRaw);
  const events = recentEvents(snapshot, stock);
  const fallback = deterministicAssessment(target, stock, chart, events);
  const current = await aiAssessment(env, target, stock, chart, events, fallback);

  const previous = await env.DB.prepare(
    "SELECT signal,confidence,score,engine,created_at FROM analysis_snapshots WHERE user_id=? AND subject_type=? AND subject_id=? ORDER BY created_at DESC LIMIT 1"
  ).bind(target.user_id, target.subject_type, target.subject_id).first();

  const snapshotId = uid("an_");
  const now = nowIso();
  current.snapshotId = snapshotId;

  await env.DB.prepare(
    "INSERT INTO analysis_snapshots (id,user_id,subject_type,subject_id,stock_key,ticker,signal,confidence,score,previous_score,horizon,thesis,risk_summary,reasons_json,catalysts_json,technical_json,market_json,ai_model,engine,data_timestamp,created_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(
    snapshotId, target.user_id, target.subject_type, target.subject_id, target.stock_key, target.ticker,
    current.signal, current.confidence, current.score, previous ? previous.score : null, current.horizon,
    current.thesis, current.riskSummary, JSON.stringify(current.reasons || []), JSON.stringify(current.catalysts || []),
    JSON.stringify(chart || {}), JSON.stringify({
      market: Number(target.prefer_tr) === 1 ? "Trade Republic / LSX" : "EEUU",
      currency: Number(target.prefer_tr) === 1 ? "EUR" : "USD",
      price: Number(target.prefer_tr) === 1 && chart && chart.available ? chart.last : (stock.price ?? null),
      changePct: Number(target.prefer_tr) === 1 && chart && chart.available ? chart.return20 : (stock.usLiveChangePct ?? stock.changePct ?? stock.premarketChangePct ?? null),
      relVolume: stock.relVolume ?? null,
      volume: stock.usLiveVolume ?? stock.volume ?? null,
      rsi: stock.rsi ?? null,
      adx: stock.adx ?? null,
      ema20: stock.ema20 ?? null,
      ema50: stock.ema50 ?? null
    }), current.model || "", current.engine || "", snapshot && snapshot.meta && snapshot.meta.updatedAt || null, now
  ).run();

  const table = target.subject_type === "position" ? "positions" : "watchlist";
  await env.DB.prepare(
    "UPDATE " + table + " SET last_analysis_at=?,last_signal=?,last_confidence=?,last_score=?,last_snapshot_id=?,updated_at=? WHERE id=? AND user_id=?"
  ).bind(now, current.signal, current.confidence, current.score, snapshotId, now, target.subject_id, target.user_id).run();

  await maybeCreateAlert(env, target, stock, current, previous);
  await maybeCreateNewsAlerts(env, target, stock, events, snapshotId);

  return {
    id: snapshotId,
    stockKey: target.stock_key,
    ticker: target.ticker,
    name: stock.name || target.name || "",
    subjectType: target.subject_type,
    subjectId: target.subject_id,
    signal: current.signal,
    confidence: current.confidence,
    score: current.score,
    previousScore: previous ? previous.score : null,
    horizon: current.horizon,
    thesis: current.thesis,
    riskSummary: current.riskSummary,
    reasons: current.reasons || [],
    catalysts: current.catalysts || [],
    engine: current.engine,
    model: current.model,
    createdAt: now
  };
}

async function subjectForUser(env, userId, subjectType, subjectId) {
  if (subjectType === "position") {
    return env.DB.prepare(
      "SELECT 'position' AS subject_type,id AS subject_id,user_id,stock_key,ticker,name,exchange,isin,prefer_tr,quantity,avg_price,currency,last_analysis_at FROM positions WHERE id=? AND user_id=? AND active=1"
    ).bind(subjectId, userId).first();
  }
  if (subjectType === "watchlist") {
    return env.DB.prepare(
      "SELECT 'watchlist' AS subject_type,id AS subject_id,user_id,stock_key,ticker,name,exchange,isin,prefer_tr,NULL AS quantity,NULL AS avg_price,'EUR' AS currency,last_analysis_at FROM watchlist WHERE id=? AND user_id=?"
    ).bind(subjectId, userId).first();
  }
  return null;
}

async function handleSettings(request, env, user, json) {
  const existing = await env.DB.prepare(
    "SELECT analysis_positions_minutes,analysis_watchlist_minutes,min_buy_confidence,min_sell_confidence,notify_score_change FROM user_settings WHERE user_id=?"
  ).bind(user.id).first();

  if (request.method === "GET") return json({ settings: existing || null });
  if (request.method !== "PATCH") return json({ error: "Method not allowed" }, 405);

  const body = await readJson(request);
  const next = {
    positions: Math.max(5, Math.min(240, Math.round(finiteNumber(body.analysisPositionsMinutes) ?? finiteNumber(existing && existing.analysis_positions_minutes) ?? 10))),
    watchlist: Math.max(10, Math.min(1440, Math.round(finiteNumber(body.analysisWatchlistMinutes) ?? finiteNumber(existing && existing.analysis_watchlist_minutes) ?? 30))),
    buy: Math.max(60, Math.min(99, Math.round(finiteNumber(body.minBuyConfidence) ?? finiteNumber(existing && existing.min_buy_confidence) ?? 85))),
    sell: Math.max(60, Math.min(99, Math.round(finiteNumber(body.minSellConfidence) ?? finiteNumber(existing && existing.min_sell_confidence) ?? 80))),
    change: Math.max(5, Math.min(60, Math.round(finiteNumber(body.notifyScoreChange) ?? finiteNumber(existing && existing.notify_score_change) ?? 20)))
  };
  const now = nowIso();
  await env.DB.prepare(
    "INSERT INTO user_settings (user_id,analysis_positions_minutes,analysis_watchlist_minutes,min_buy_confidence,min_sell_confidence,notify_score_change,created_at,updated_at) " +
    "VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET analysis_positions_minutes=excluded.analysis_positions_minutes,analysis_watchlist_minutes=excluded.analysis_watchlist_minutes,min_buy_confidence=excluded.min_buy_confidence,min_sell_confidence=excluded.min_sell_confidence,notify_score_change=excluded.notify_score_change,updated_at=excluded.updated_at"
  ).bind(user.id, next.positions, next.watchlist, next.buy, next.sell, next.change, now, now).run();
  return json({ settings: await env.DB.prepare(
    "SELECT analysis_positions_minutes,analysis_watchlist_minutes,min_buy_confidence,min_sell_confidence,notify_score_change FROM user_settings WHERE user_id=?"
  ).bind(user.id).first() });
}

async function handleDevices(request, env, user, json, parts) {
  const id = parts[1] || "";
  if (request.method === "GET" && !id) {
    const rows = await env.DB.prepare(
      "SELECT id,platform,app_version,enabled,last_seen_at,created_at,updated_at FROM devices WHERE user_id=? ORDER BY last_seen_at DESC"
    ).bind(user.id).all();
    return json({ devices: rows.results || [] });
  }

  if (request.method === "POST" && !id) {
    const body = await readJson(request);
    const token = trimText(body.pushToken, 2048);
    const platform = trimText(body.platform || "android", 32).toLowerCase();
    const appVersion = trimText(body.appVersion, 40);
    if (!token) return json({ error: "pushToken is required" }, 400);
    const existing = await env.DB.prepare("SELECT id FROM devices WHERE push_token=?").bind(token).first();
    const deviceId = existing && existing.id ? existing.id : uid("dev_");
    const now = nowIso();
    await env.DB.prepare(
      "INSERT INTO devices (id,user_id,platform,push_token,app_version,enabled,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?,?) " +
      "ON CONFLICT(push_token) DO UPDATE SET user_id=excluded.user_id,platform=excluded.platform,app_version=excluded.app_version,enabled=1,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at"
    ).bind(deviceId, user.id, platform, token, appVersion, now, now, now).run();
    return json({ device: { id: deviceId, platform, appVersion, enabled: true, lastSeenAt: now } }, existing ? 200 : 201);
  }

  if (!id) return json({ error: "Device id required" }, 400);
  if (request.method === "DELETE") {
    await env.DB.prepare("UPDATE devices SET enabled=0,updated_at=? WHERE id=? AND user_id=?").bind(nowIso(), id, user.id).run();
    return json({ deleted: true });
  }
  return json({ error: "Method not allowed" }, 405);
}

async function handleManualAnalysis(request, env, user, json, services) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await readJson(request);
  const subjectType = trimText(body.subjectType, 20);
  const subjectId = trimText(body.subjectId, 80);
  const target = await subjectForUser(env, user.id, subjectType, subjectId);
  if (!target) return json({ error: "Tracked asset not found" }, 404);

  if (target.last_analysis_at) {
    const age = Date.now() - new Date(target.last_analysis_at).getTime();
    if (Number.isFinite(age) && age < 120000) {
      const latest = await env.DB.prepare(
        "SELECT * FROM analysis_snapshots WHERE user_id=? AND subject_type=? AND subject_id=? ORDER BY created_at DESC LIMIT 1"
      ).bind(user.id, subjectType, subjectId).first();
      return json({ analysis: latest, reused: true });
    }
  }

  try {
    const result = await analyzeTarget(env, target, services);
    return json({ analysis: result, reused: false });
  } catch (error) {
    console.warn("Manual analysis failed", String(error && error.message || error));
    return json({ error: "Analysis temporarily unavailable" }, 503);
  }
}


async function handleAiChat(request, env, user, json, services) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.AI || typeof env.AI.run !== "function") return json({ error: "AI temporarily unavailable" }, 503);

  const body = await readJson(request);
  const stockKey = trimText(body.stockKey, 120);
  const ticker = trimText(body.ticker, 24).toUpperCase();
  const preferTr = body.preferTr === true;
  const question = trimText(body.question, 1200);
  const history = Array.isArray(body.history) ? body.history.slice(-6).map(item => ({
    role: item && item.role === "assistant" ? "assistant" : "user",
    content: trimText(item && item.content, 1600)
  })).filter(x => x.content) : [];
  const live = body.live && typeof body.live === "object" && !Array.isArray(body.live) ? body.live : {};
  if (!stockKey && !ticker) return json({ error: "Stock is required" }, 400);
  if (!question) return json({ error: "Question is required" }, 400);

  const snapshot = await services.loadMarketSnapshot(env);
  const target = {
    stock_key: stockKey,
    ticker,
    prefer_tr: preferTr ? 1 : 0,
    isin: trimText(body.isin, 32)
  };
  const stock = findStock(snapshot, target);
  if (!stock) return json({ error: "Stock not found" }, 404);

  let chartRaw = null;
  try { chartRaw = await services.loadChart(stock, target); } catch (error) {
    console.warn("AI chat chart unavailable", String(error && error.message || error));
  }
  const chart = chartFeatures(chartRaw);
  const events = recentEvents(snapshot, stock, 16);
  const fallbackTarget = { subject_type: "watchlist", ...target };
  const deterministic = deterministicAssessment(fallbackTarget, stock, chart, events);

  const livePrice = finiteNumber(live.price);
  const liveEur = finiteNumber(live.eur);
  const liveUsd = finiteNumber(live.usd);
  const liveChange = finiteNumber(live.changePct);
  const fx = finiteNumber(live.eurUsd);
  const model = trimText(env.AI_MODEL || DEFAULT_AI_MODEL, 120) || DEFAULT_AI_MODEL;

  const prompt = [
    "Eres ViewInvAI, un asistente de análisis bursátil integrado en una app de inversión.",
    "Responde SIEMPRE en español claro y concreto.",
    "Usa SOLO los datos estructurados suministrados. No inventes noticias, precios, fechas ni eventos.",
    "Distingue entre hechos del feed, cálculos derivados y valoración analítica.",
    "El precio principal debe corresponder al mercado elegido: si preferTr=true, LSX/Trade Republic en EUR; si es false, mercado EEUU en USD.",
    "La segunda divisa es únicamente una conversión con EUR/USD y no un segundo precio independiente.",
    "Evalúa momentum, tendencia, riesgo de FOMO, liquidez, técnicos, noticias/eventos y riesgos.",
    "No presentes una recomendación como certeza. Si faltan datos, dilo y baja la confianza.",
    "Devuelve JSON únicamente con las claves: answer, summary, signal, confidence, momentum, fomoRisk, trend, keyPoints.",
    "signal debe ser una de: COMPRAR, VIGILAR, ESPERAR, EVITAR.",
    "momentum, fomoRisk y trend deben ser textos cortos.",
    "",
    JSON.stringify({
      userQuestion: question,
      conversation: history,
      selectedMarket: preferTr ? "Trade Republic / LSX" : "EEUU",
      liveQuote: {
        source: trimText(live.source, 120),
        nativeCurrency: trimText(live.nativeCurrency, 8),
        price: livePrice,
        eur: liveEur,
        usd: liveUsd,
        changePct: liveChange,
        quoteUpdatedAt: trimText(live.quoteUpdatedAt, 80),
        eurUsd: fx,
        fxUpdatedAt: trimText(live.fxUpdatedAt, 80),
        bid: finiteNumber(live.bid),
        ask: finiteNumber(live.ask)
      },
      stock: {
        ticker: stock.ticker,
        name: stock.name,
        exchange: stock.exchange,
        trTicker: stock.trTicker || null,
        trExchange: stock.trExchange || null,
        isin: stock.isin || stock.trIsin || null,
        volume: stock.usLiveVolume ?? stock.volume ?? null,
        avgVolume: stock.avgVolume ?? null,
        relVolume: stock.relVolume ?? null,
        rsi: stock.rsi ?? null,
        adx: stock.adx ?? null,
        ema20: stock.ema20 ?? null,
        ema50: stock.ema50 ?? null,
        marketCap: stock.marketCap ?? null,
        earningsDate: stock.earningsDate || null
      },
      chart,
      recentEvents: events,
      deterministicReference: {
        signal: deterministic.signal,
        score: deterministic.score,
        reasons: deterministic.reasons
      },
      snapshotUpdatedAt: snapshot && snapshot.meta && snapshot.meta.updatedAt || null
    })
  ].join("\n");

  try {
    const result = await env.AI.run(model, { prompt, max_tokens: 900, temperature: 0.12 });
    const parsed = extractAiJson(result);
    if (!parsed) throw new Error("AI response is not valid JSON");
    const allowed = new Set(["COMPRAR","VIGILAR","ESPERAR","EVITAR"]);
    const signal = String(parsed.signal || "VIGILAR").toUpperCase();
    return json({
      answer: trimText(parsed.answer || parsed.summary || "", 4000),
      summary: trimText(parsed.summary || parsed.answer || "", 900),
      signal: allowed.has(signal) ? signal : "VIGILAR",
      confidence: Math.max(0, Math.min(100, Math.round(finiteNumber(parsed.confidence) ?? 55))),
      momentum: trimText(parsed.momentum || "Sin clasificación", 80),
      fomoRisk: trimText(parsed.fomoRisk || "No determinado", 80),
      trend: trimText(parsed.trend || "No determinada", 80),
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map(x => trimText(x, 240)).filter(Boolean).slice(0, 6) : [],
      model,
      dataTimestamp: snapshot && snapshot.meta && snapshot.meta.updatedAt || null
    });
  } catch (error) {
    console.warn("AI chat failed", String(error && error.message || error));
    const signalMap = deterministic.score >= 45 ? "COMPRAR" : deterministic.score < -20 ? "EVITAR" : deterministic.score >= 15 ? "VIGILAR" : "ESPERAR";
    return json({
      answer: deterministic.thesis + " " + deterministic.riskSummary,
      summary: deterministic.thesis,
      signal: signalMap,
      confidence: deterministic.confidence,
      momentum: chart && chart.available ? (chart.trendUp ? "Positivo" : "Débil / mixto") : "Datos insuficientes",
      fomoRisk: finiteNumber(stock.rsi) !== null && finiteNumber(stock.rsi) > 75 ? "Elevado" : "Moderado",
      trend: chart && chart.available ? (chart.trendUp ? "Alcista" : "No confirmada") : "Sin datos suficientes",
      keyPoints: deterministic.reasons || [],
      model: "",
      dataTimestamp: snapshot && snapshot.meta && snapshot.meta.updatedAt || null,
      fallback: true
    });
  }
}

export async function handleBackendApi(request, env, services = {}) {
  const json = services.jsonResponse || defaultJson;
  const guard = apiGuard(request);
  if (guard) return json({ error: guard.error }, guard.status);

  const url = new URL(request.url);
  if (url.pathname === "/api/backend/status") {
    return json({
      d1: !!env.DB,
      ai: !!env.AI,
      firebase: !!String(env.FIREBASE_PROJECT_ID || "").trim(),
      push: !!fcmServiceAccount(env),
      model: String(env.AI_MODEL || DEFAULT_AI_MODEL)
    });
  }

  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return json({ error: auth.error }, auth.status || 401);
  const user = auth.user;
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // remove leading "api"
  const root = parts[0] || "";

  try {
    if (root === "me") return handleMe(request, env, user, json);
    if (root === "portfolios") return handlePortfolios(request, env, user, json, parts);
    if (root === "positions") return handlePositions(request, env, user, json, parts, url);
    if (root === "transactions") return handleTransactions(request, env, user, json, parts, url);
    if (root === "fund-portfolios") return handleFundPortfolios(request, env, user, json, parts);
    if (root === "fund-positions") return handleFundPositions(request, env, user, json, parts, url);
    if (root === "fund-transactions") return handleFundTransactions(request, env, user, json, parts, url);
    if (root === "fund-plans") return handleFundPlans(request, env, user, json, parts, url);
    if (root === "watchlist") return handleWatchlist(request, env, user, json, parts);
    if (root === "analysis" && parts[1] === "run") return handleManualAnalysis(request, env, user, json, services);
    if (root === "analysis") return handleAnalysisList(request, env, user, json, url);
    if (root === "ai" && parts[1] === "chat") return handleAiChat(request, env, user, json, services);
    if (root === "alerts") return handleAlerts(request, env, user, json, parts);
    if (root === "settings") return handleSettings(request, env, user, json);
    if (root === "devices") return handleDevices(request, env, user, json, parts);
    return json({ error: "Unknown backend endpoint" }, 404);
  } catch (error) {
    console.error("Backend API error", String(error && error.stack || error));
    if (String(error && error.message || "").includes("Payload too large")) return json({ error: "Payload too large" }, 413);
    if (error instanceof SyntaxError) return json({ error: "Invalid JSON" }, 400);
    return json({ error: "Backend request failed" }, 500);
  }
}

async function cleanupOldBackendData(env) {
  if (!env.DB) return;
  const now = Date.now();
  const analysisCutoff = new Date(now - 90 * 86400000).toISOString();
  const alertsCutoff = new Date(now - 180 * 86400000).toISOString();
  const devicesCutoff = new Date(now - 90 * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM analysis_snapshots WHERE created_at<?").bind(analysisCutoff),
    env.DB.prepare("DELETE FROM alert_events WHERE read_at IS NOT NULL AND created_at<?").bind(alertsCutoff),
    env.DB.prepare("DELETE FROM devices WHERE enabled=0 AND updated_at<?").bind(devicesCutoff)
  ]);
}

export async function runScheduledPortfolioAnalysis(env, services = {}) {
  if (!env.DB || !services.loadMarketSnapshot || !services.loadChart) {
    return { skipped: true, reason: "backend-not-configured" };
  }

  const nowDate = new Date();
  if (nowDate.getUTCHours() === 3 && nowDate.getUTCMinutes() < 5) {
    try { await cleanupOldBackendData(env); }
    catch (error) { console.warn("Backend retention cleanup failed", String(error && error.message || error)); }
  }

  const [positionRows, watchRows] = await Promise.all([
    env.DB.prepare(
      "SELECT 'position' AS subject_type,p.id AS subject_id,p.user_id,p.stock_key,p.ticker,p.name,p.exchange,p.isin,p.prefer_tr,p.quantity,p.avg_price,p.currency,p.last_analysis_at," +
      "COALESCE(s.analysis_positions_minutes,10) AS analysis_interval_minutes " +
      "FROM positions p LEFT JOIN user_settings s ON s.user_id=p.user_id WHERE p.active=1 " +
      "ORDER BY COALESCE(p.last_analysis_at,'') ASC LIMIT 40"
    ).all(),
    env.DB.prepare(
      "SELECT 'watchlist' AS subject_type,w.id AS subject_id,w.user_id,w.stock_key,w.ticker,w.name,w.exchange,w.isin,w.prefer_tr,NULL AS quantity,NULL AS avg_price,'EUR' AS currency,w.last_analysis_at," +
      "COALESCE(s.analysis_watchlist_minutes,30) AS analysis_interval_minutes " +
      "FROM watchlist w LEFT JOIN user_settings s ON s.user_id=w.user_id " +
      "ORDER BY COALESCE(w.last_analysis_at,'') ASC LIMIT 40"
    ).all()
  ]);

  const nowMs = Date.now();
  const due = row => {
    if (!row.last_analysis_at) return true;
    const last = new Date(row.last_analysis_at).getTime();
    const minutes = Math.max(row.subject_type === "position" ? 5 : 10, finiteNumber(row.analysis_interval_minutes) ?? (row.subject_type === "position" ? 10 : 30));
    return !Number.isFinite(last) || nowMs - last >= minutes * 60000;
  };
  const positions = (positionRows.results || []).filter(due);
  const watchlist = (watchRows.results || []).filter(due);
  const queue = [...positions, ...watchlist]
    .sort((a,b) => String(a.last_analysis_at || "").localeCompare(String(b.last_analysis_at || "")))
    .slice(0, 8);
  const results = [];

  for (const target of queue) {
    try {
      const analysis = await analyzeTarget(env, target, services);
      results.push({ ok: true, subjectId: target.subject_id, signal: analysis.signal, confidence: analysis.confidence });
    } catch (error) {
      console.warn("Scheduled analysis target failed", target.subject_id, String(error && error.message || error));
      results.push({ ok: false, subjectId: target.subject_id });
    }
  }

  return { processed: results.length, results };
}
