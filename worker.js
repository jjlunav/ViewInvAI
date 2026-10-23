import { handleBackendApi, runScheduledPortfolioAnalysis, runDailyPortfolioDigest, runScheduledBrokerVerification, runRadarScoreboard, radarScoreboardSummary, stockAttentionRows, fundAttentionCandidates } from "./backend.js";
import { cryptoQuotes, cryptoChart, cryptoCatalog, alphaTokens, alphaChart } from "./crypto-server.js";


function parseMarketNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/[$€,%+\s]/g, "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}


const NASDAQ_HEADERS = {
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36",
  "Referer": "https://www.nasdaq.com/"
};

const NASDAQ_QUOTE_TTL_MS = 2500;
const NASDAQ_SUMMARY_TTL_MS = 15000;
const nasdaqQuoteCache = new Map();
const nasdaqQuoteInflight = new Map();
const nasdaqSummaryCache = new Map();

function nasdaqSummaryValue(summaryData, ...names) {
  const wanted = new Set(names.map(name => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "")));
  for (const [key, row] of Object.entries(summaryData || {})) {
    const normalized = String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!wanted.has(normalized)) continue;
    if (row && typeof row === "object" && "value" in row) return row.value;
    return row;
  }
  return null;
}

function parseNasdaqHighLow(value) {
  const text = String(value || "").trim();
  if (!text) return { high: null, low: null };
  const parts = text.split(/\s*[/|-]\s*/).map(parseMarketNumber).filter(v => v !== null);
  if (parts.length < 2) return { high: null, low: null };
  return { high: Math.max(parts[0], parts[1]), low: Math.min(parts[0], parts[1]) };
}

async function fetchNasdaqSummary(symbol) {
  const safe = safeStockSymbol(symbol);
  if (!safe) return null;
  const cached = nasdaqSummaryCache.get(safe);
  if (cached && Date.now() - cached.at < NASDAQ_SUMMARY_TTL_MS) return cached.value;
  try {
    const response = await fetch("https://api.nasdaq.com/api/quote/" + encodeURIComponent(safe) + "/summary?assetclass=stocks", {
      headers: NASDAQ_HEADERS,
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    if (!response.ok) throw new Error("Nasdaq summary " + response.status);
    const json = await response.json();
    const summary = json && json.data && json.data.summaryData || {};
    const highLow = parseNasdaqHighLow(nasdaqSummaryValue(summary, "TodayHighLow", "TodaysHighLow", "DayHighLow"));
    const value = {
      dayHigh: highLow.high,
      dayLow: highLow.low,
      open: parseMarketNumber(nasdaqSummaryValue(summary, "OpenPrice", "Open")),
      previousClose: parseMarketNumber(nasdaqSummaryValue(summary, "PreviousClose", "PrevClose")),
      volume: parseMarketNumber(nasdaqSummaryValue(summary, "ShareVolume", "Volume"))
    };
    nasdaqSummaryCache.set(safe, { at: Date.now(), value });
    return value;
  } catch (error) {
    console.warn("Nasdaq summary upstream error", safe, String(error && error.message || error));
    return cached ? cached.value : null;
  }
}

const RATE_BUCKETS = new Map();
function requestIdentity(request){
  return String(request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "anon").split(",")[0].trim().slice(0,80);
}
function requestActorKey(request){
  // The pre-authentication limiter must not trust claims from an unverified JWT.
  // Authentication-specific identity is resolved later by verifyFirebaseUser().
  return "ip:"+requestIdentity(request);
}
async function enforcedRateLimit(request,env,name,limit,windowMs,bindingName){
  const binding=bindingName&&env&&env[bindingName];
  if(binding&&typeof binding.limit==="function"){
    try{
      const result=await binding.limit({key:name+":"+requestActorKey(request)});
      if(result&&result.success===false){
        const retry=Math.max(1,Math.round(windowMs/1000));
        return jsonResponse({error:"Too many requests",retryAfter:retry},429,{"Retry-After":String(retry),"Cache-Control":"no-store"});
      }
      return null;
    }catch(error){
      console.warn("Distributed rate limit fallback",bindingName,String(error&&error.message||error));
    }
  }
  return rateLimit(request,name,limit,windowMs);
}

function rateLimit(request, bucket, max, windowMs=60000){
  const now=Date.now(),key=bucket+":"+requestIdentity(request);
  let row=RATE_BUCKETS.get(key);
  if(!row||now-row.startedAt>=windowMs)row={startedAt:now,count:0};
  row.count+=1;RATE_BUCKETS.set(key,row);
  if(RATE_BUCKETS.size>5000){
    for(const [k,v] of RATE_BUCKETS)if(!v||now-v.startedAt>windowMs*2)RATE_BUCKETS.delete(k);
  }
  if(row.count<=max)return null;
  const retry=Math.max(1,Math.ceil((windowMs-(now-row.startedAt))/1000));
  return jsonResponse({error:"Too many requests",retryAfter:retry},429,{"Retry-After":String(retry),"Cache-Control":"no-store"});
}

const TRUSTED_NATIVE_ORIGINS = new Set([
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  "ionic://localhost"
]);

const NATIVE_LIVE_SHELL_PATHS = new Set(["/", "/auth.js", "/portfolio.js"]);
function trustedNativeOrigin(request) {
  const origin = String(request.headers.get("Origin") || "").toLowerCase();
  return origin && TRUSTED_NATIVE_ORIGINS.has(origin) ? origin : "";
}

function nativeCorsResponse(request, response) {
  const origin = trustedNativeOrigin(request);
  if (!origin || !response) return response;
  const headers = new Headers(response.headers || {});
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Expose-Headers", "ETag,X-ViewInvAI-Market-Storage");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.append("Vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function nativePreflightResponse(request) {
  const origin = trustedNativeOrigin(request);
  if (!origin) return null;
  const requestedHeaders = String(request.headers.get("Access-Control-Request-Headers") || "authorization,content-type");
  const headers = applySecurityHeaders(new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": requestedHeaders,
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  }));
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  headers.set("Access-Control-Allow-Headers", requestedHeaders);
  headers.set("Access-Control-Max-Age", "600");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  return new Response(null, { status: 204, headers });
}

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' https://www.gstatic.com https://s3.tradingview.com; style-src 'self'; img-src 'self' data: https://*.googleusercontent.com https://*.tradingview.com https://s3.tradingview.com https://coin-images.coingecko.com https://assets.coingecko.com https://bin.bnbstatic.com; font-src 'self'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://accounts.google.com https://firebaseinstallations.googleapis.com https://fcmregistrations.googleapis.com https://fcm.googleapis.com https://firebase.googleapis.com wss://api.traderepublic.com https://*.tradingview.com wss://*.tradingview.com; frame-src https://accounts.google.com https://viewinvai.firebaseapp.com https://*.tradingview.com; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'self'; media-src 'none'; upgrade-insecure-requests",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Strict-Transport-Security": "max-age=31536000"
};

function applySecurityHeaders(headers) {
  const out = new Headers(headers || {});
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) out.set(name, value);
  out.delete("Access-Control-Allow-Origin");
  out.delete("Access-Control-Allow-Credentials");
  return out;
}

function secureResponse(response, pathname = "") {
  const headers = applySecurityHeaders(response.headers);
  // HTML/JS/CSS are always revalidated against the server so a deploy is picked
  // up immediately, but "no-cache" (not "no-store") lets the browser answer with
  // a cheap 304 when nothing changed instead of re-downloading ~1.2 MB of
  // scripts and styles on every visit. The APK packages these files locally.
  if (pathname === "/" || /\.(?:html|js|css)$/i.test(pathname)) {
    headers.set("Cache-Control", "no-cache");
    headers.delete("Pragma");
    headers.delete("Expires");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  const headers = applySecurityHeaders(new Headers(extraHeaders));
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), { status, headers });
}

function requestGuard(request, { websocket = false } = {}) {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: applySecurityHeaders() });
  const url = new URL(request.url);
  const origin = String(request.headers.get("Origin") || "");
  const nativeOrigin = trustedNativeOrigin(request);
  if (origin && origin !== url.origin && !nativeOrigin) return new Response("Forbidden", { status: 403, headers: applySecurityHeaders() });
  const site = (request.headers.get("Sec-Fetch-Site") || "").toLowerCase();
  if (!nativeOrigin && site && !["same-origin", "none"].includes(site)) {
    return new Response("Forbidden", { status: 403, headers: applySecurityHeaders() });
  }
  if (websocket && (request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426, headers: applySecurityHeaders() });
  }
  return null;
}

function safeStockSymbol(symbol) {
  const value = String(symbol || "").trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(value) ? value : "";
}

const TRADINGVIEW_SYMBOL_SEARCH_URL = "https://symbol-search.tradingview.com/symbol_search/v3/";

function cleanTradingViewText(value) {
  return String(value || "").replace(/<\/?em>/gi, "").trim();
}

async function fetchTradingViewLsxSymbol(symbol, isin = "") {
  const safe = safeStockSymbol(symbol);
  const safeIsin = /^[A-Z]{2}[A-Z0-9]{10}$/.test(String(isin || "").trim().toUpperCase())
    ? String(isin || "").trim().toUpperCase()
    : "";
  if (!safe) return { available: false, symbol: null };

  const url = new URL(TRADINGVIEW_SYMBOL_SEARCH_URL);
  url.searchParams.set("text", safe);
  url.searchParams.set("hl", "0");
  url.searchParams.set("exchange", "LSX");
  url.searchParams.set("lang", "en");
  url.searchParams.set("search_type", "undefined");
  url.searchParams.set("domain", "production");

  const response = await fetch(url.toString(), {
    headers: {
      "Accept": "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0",
      "Origin": "https://www.tradingview.com",
      "Referer": "https://www.tradingview.com/"
    },
    cf: { cacheTtl: 21600, cacheEverything: true }
  });
  if (!response.ok) throw new Error("TradingView symbol search " + response.status);

  const json = await response.json();
  const items = json && Array.isArray(json.symbols) ? json.symbols : [];
  const exactExchange = items.filter(item =>
    cleanTradingViewText(item && item.exchange).toUpperCase().replace(/\s+/g, "") === "LSX"
  );
  let match = exactExchange.find(item =>
    cleanTradingViewText(item && item.symbol).toUpperCase() === safe
  );
  if (!match && safeIsin) {
    match = exactExchange.find(item =>
      String(item && item.isin || "").trim().toUpperCase() === safeIsin
    );
  }
  if (!match) return { available: false, symbol: null };

  const tvTicker = safeStockSymbol(cleanTradingViewText(match.symbol));
  if (!tvTicker) return { available: false, symbol: null };
  return { available: true, symbol: "LSX:" + tvTicker };
}

async function tradingViewSymbolAvailability(request) {
  const url = new URL(request.url);
  const symbol = safeStockSymbol(url.searchParams.get("symbol"));
  const isin = String(url.searchParams.get("isin") || "").trim().toUpperCase();
  if (!symbol) return jsonResponse({ available: false, symbol: null, error: "No valid symbol" }, 400, { "Cache-Control": "no-store" });
  try {
    const result = await fetchTradingViewLsxSymbol(symbol, isin);
    return jsonResponse(
      { ...result, exchange: "LSX", checkedAt: new Date().toISOString() },
      200,
      { "Cache-Control": "public, max-age=21600" }
    );
  } catch (error) {
    console.warn("TradingView symbol lookup error", String(error && error.message || error));
    return jsonResponse({ available: false, symbol: null, error: "TradingView lookup unavailable" }, 502, { "Cache-Control": "no-store" });
  }
}

async function fetchNasdaqChart(symbol) {
  const safe = safeStockSymbol(symbol);
  if (!safe) return null;
  const response = await fetch(
    "https://api.nasdaq.com/api/quote/" + encodeURIComponent(safe) + "/chart?assetclass=stocks&charttype=rs",
    {
      headers: NASDAQ_HEADERS,
      cf: { cacheTtl: 0, cacheEverything: false }
    }
  );
  if (!response.ok) throw new Error("Nasdaq chart " + response.status);
  const json = await response.json();
  const data = json && json.data;
  const raw = data && Array.isArray(data.chart) ? data.chart.slice(-1500) : [];
  const points = raw.map(point => ({
    time: Number(point.x),
    price: parseMarketNumber(point.y != null ? point.y : point.z && (point.z.price || point.z.value)),
    volume: parseMarketNumber(point.w != null ? point.w : point.z && point.z.shares)
  })).filter(point => Number.isFinite(point.time) && point.price != null);
  return {
    symbol: (data && data.symbol) || safe,
    points,
    source: "Nasdaq chart API",
    fetchedAt: new Date().toISOString()
  };
}

function waitForWsMessage(ws, timeout = 8000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      try { ws.removeEventListener("message", onMessage); } catch (_) {}
      try { ws.removeEventListener("error", onError); } catch (_) {}
      try { ws.removeEventListener("close", onClose); } catch (_) {}
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onMessage = event => finish(resolve, String(event.data || ""));
    const onError = () => finish(reject, new Error("Trade Republic websocket error"));
    const onClose = () => finish(reject, new Error("Trade Republic websocket closed"));
    const timer = setTimeout(() => finish(reject, new Error("Trade Republic websocket timeout")), timeout);
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
  });
}

// Trade Republic has used two handshakes for its public feed. Try the last one that
// worked first, then the other, so a protocol change does not silently blank LSX prices.
const TR_CONNECT_MESSAGES = [
  "connect 30",
  "connect 31 " + JSON.stringify({ locale: "es", platformId: "webtrading", platformVersion: "chrome - 120.0.0", clientId: "app.traderepublic.com", clientVersion: "3.151.3" })
];
let trPreferredConnect = 0;

async function upgradeTradeRepublicSocket() {
  const response = await fetch("https://api.traderepublic.com", {
    headers: {
      "Upgrade": "websocket",
      "Origin": "https://app.traderepublic.com",
      "User-Agent": "Mozilla/5.0"
    }
  });
  const ws = response.webSocket;
  if (!ws) throw new Error("Trade Republic rejected WebSocket upgrade (HTTP " + response.status + ")");
  ws.accept({ allowHalfOpen: true });
  return ws;
}

async function openTradeRepublicSocket() {
  let lastError = null;
  for (let attempt = 0; attempt < TR_CONNECT_MESSAGES.length; attempt++) {
    const index = (trPreferredConnect + attempt) % TR_CONNECT_MESSAGES.length;
    let ws = null;
    try {
      ws = await upgradeTradeRepublicSocket();
      ws.send(TR_CONNECT_MESSAGES[index]);
      const hello = await waitForWsMessage(ws, 8000);
      if (hello.startsWith("connected")) {
        trPreferredConnect = index;
        return ws;
      }
      lastError = new Error("Trade Republic unexpected greeting: " + hello.slice(0, 80));
    } catch (error) {
      lastError = error;
    }
    try { if (ws) ws.close(1000, "retry handshake"); } catch (_) {}
  }
  throw lastError || new Error("Trade Republic handshake failed");
}

const TR_HEALTH_ISIN = "US0378331005";
let trHealthCache = null;

async function tradeRepublicHealthResponse() {
  if (!trHealthCache || Date.now() - trHealthCache.checkedAt > 60000) {
    const checkedAt = Date.now();
    try {
      const quote = await fetchTradeRepublicTicker(TR_HEALTH_ISIN, "LSX");
      trHealthCache = { ok: quote.price !== null || quote.bid !== null, isin: TR_HEALTH_ISIN, price: quote.price, bid: quote.bid, ask: quote.ask, quoteTime: quote.timestamp, handshake: TR_CONNECT_MESSAGES[trPreferredConnect].split(" ", 2).join(" "), checkedAt };
    } catch (error) {
      trHealthCache = { ok: false, isin: TR_HEALTH_ISIN, error: String(error && error.message || error).slice(0, 200), checkedAt };
    }
  }
  return jsonResponse(trHealthCache, 200, { "Cache-Control": "no-store" });
}

async function fetchTradeRepublicTicker(isin, exchange = "LSX") {
  const safeIsin = String(isin || "").trim().toUpperCase();
  const safeExchange = "LSX";
  if (!/^[A-Z]{2}[A-Z0-9]{10}$/.test(safeIsin)) throw new Error("Invalid ISIN");
  const ws = await openTradeRepublicSocket();
  try {
    ws.send("sub 1 " + JSON.stringify({ type: "ticker", id: safeIsin + "." + safeExchange }));
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const raw = await waitForWsMessage(ws, Math.max(800, deadline - Date.now()));
      if (!raw.startsWith("1 ")) continue;
      const parts = raw.split(" ", 3), code = parts[1];
      const body = raw.slice(raw.indexOf(" ", raw.indexOf(" ") + 1) + 1);
      if (code === "E") throw new Error("Trade Republic ticker subscription rejected");
      if (code !== "A") continue;
      const data = JSON.parse(body || "{}");
      const last = parseMarketNumber(data && data.last && data.last.price);
      const bid = parseMarketNumber(data && data.bid && data.bid.price);
      const ask = parseMarketNumber(data && data.ask && data.ask.price);
      const pre = parseMarketNumber(data && data.pre && data.pre.price);
      const open = parseMarketNumber(data && data.open && data.open.price);
      const timestamp = Number(data && data.last && data.last.time) || Number(data && data.bid && data.bid.time) || Number(data && data.ask && data.ask.time) || Date.now();
      // Igual que LS-X y la app: cotización = medio entre venta (Geld) y compra (Brief); el cierre anterior del
      // feed es de venta y se lleva al medio con el diferencial actual.
      const spreadOk = bid !== null && ask !== null && bid > 0 && ask >= bid && (ask - bid) / bid < 0.25;
      const price = spreadOk ? Math.round((bid + ask) / 2 * 1e6) / 1e6 : last;
      const prevMid = pre > 0 ? (spreadOk ? pre + (ask - bid) / 2 : pre) : null;
      return {
        market: "tr",
        isin: safeIsin,
        exchange: safeExchange,
        price,
        last,
        bid,
        ask,
        open,
        previousClose: prevMid,
        changePct: price !== null && prevMid > 0 ? (price / prevMid - 1) * 100 : null,
        timestamp,
        isRealTime: true,
        source: "LS Exchange (vía Trade Republic)"
      };
    }
    throw new Error("Trade Republic ticker timeout");
  } finally {
    try { ws.send("unsub 1"); } catch (_) {}
    try { ws.close(1000, "done"); } catch (_) {}
  }
}

async function fetchTradeRepublicHistory(isin, exchange = "LSX", range = "1d", resolution = 60000) {
  const safeIsin = String(isin || "").trim().toUpperCase();
  const safeExchange = "LSX";
  if (!/^[A-Z]{2}[A-Z0-9]{10}$/.test(safeIsin)) throw new Error("Invalid ISIN");
  const allowedRanges = new Set(["1d","1w","1m","3m","6m","1y","5y","max"]);
  const safeRange = allowedRanges.has(range) ? range : "1d";
  const safeResolution = Math.max(60000, Math.min(86400000, Number(resolution) || 60000));
  const ws = await openTradeRepublicSocket();
  try {
    const payload = {
      type: "aggregateHistoryLight",
      id: safeIsin + "." + safeExchange,
      range: safeRange,
      resolution: safeResolution
    };
    ws.send("sub 1 " + JSON.stringify(payload));
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const raw = await waitForWsMessage(ws, Math.max(1000, deadline - Date.now()));
      if (!raw.startsWith("1 ")) continue;
      const parts = raw.split(" ", 3);
      const code = parts[1];
      const body = raw.slice(raw.indexOf(" ", raw.indexOf(" ") + 1) + 1);
      if (code === "E") throw new Error("Trade Republic history subscription rejected");
      if (code !== "A") continue;
      const data = JSON.parse(body || "{}");
      const aggregates = Array.isArray(data.aggregates) ? data.aggregates.slice(-5000) : [];
      return {
        isin: safeIsin,
        exchange: safeExchange,
        expectedClosingTime: Number(data.expectedClosingTime) || null,
        points: aggregates.map(point => ({
          time: Number(point.time),
          open: parseMarketNumber(point.open),
          high: parseMarketNumber(point.high),
          low: parseMarketNumber(point.low),
          close: parseMarketNumber(point.close),
          volume: parseMarketNumber(point.volume)
        })).filter(point => Number.isFinite(point.time) && point.close != null),
        source: "Trade Republic aggregateHistoryLight",
        fetchedAt: new Date().toISOString()
      };
    }
    throw new Error("Trade Republic history timeout");
  } finally {
    try { ws.send("unsub 1"); } catch (_) {}
    try { ws.close(1000, "done"); } catch (_) {}
  }
}

// Daily closes for the portfolio performance curve. Trade Republic (LSX, EUR) when the
// instrument has an ISIN; Nasdaq historical (USD) as the fallback for US tickers.
async function fetchNasdaqHistorical(symbol, fromDay) {
  const safe = safeStockSymbol(symbol);
  if (!safe) return null;
  for (const assetClass of ["stocks", "etf"]) {
    const url = "https://api.nasdaq.com/api/quote/" + encodeURIComponent(safe) + "/historical?assetclass=" + assetClass +
      "&fromdate=" + encodeURIComponent(fromDay) + "&todate=" + new Date().toISOString().slice(0, 10) + "&limit=9999";
    const response = await fetch(url, { headers: NASDAQ_HEADERS, cf: { cacheTtl: 0, cacheEverything: false } });
    if (!response.ok) continue;
    const json = await response.json().catch(() => null);
    const rows = json && json.data && json.data.tradesTable && Array.isArray(json.data.tradesTable.rows) ? json.data.tradesTable.rows : [];
    const out = [];
    for (const row of rows) {
      const m = String(row && row.date || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      const close = parseMarketNumber(row && row.close);
      if (m && close != null && close > 0) out.push({ date: m[3] + "-" + m[1] + "-" + m[2], close });
    }
    if (out.length) return { currency: "USD", source: "nasdaq", rows: out.sort((a, b) => a.date < b.date ? -1 : 1) };
  }
  return null;
}
async function loadDailyHistoryForBackend(inst, range, fromDay) {
  if (inst && inst.isin) {
    try {
      const tr = await fetchTradeRepublicHistory(inst.isin, "LSX", range, 86400000);
      const rows = (tr && tr.points || []).map(p => ({ date: new Date(p.time).toISOString().slice(0, 10), close: p.close })).filter(r => r.close > 0);
      if (rows.length) return { currency: "EUR", source: "tr", rows };
    } catch (error) {
      console.warn("TR daily history unavailable", inst.isin, String(error && error.message || error));
    }
  }
  if (inst && inst.ticker && !inst.benchmark) return fetchNasdaqHistorical(inst.ticker, fromDay);
  return null;
}

async function nasdaqChart(request) {
  const url = new URL(request.url);
  const symbol = safeStockSymbol(url.searchParams.get("symbol"));
  if (!symbol) return jsonResponse({ error: "No valid symbol" }, 400, { "Cache-Control": "no-store" });
  try {
    const [chart, quote] = await Promise.all([fetchNasdaqChart(symbol), fetchNasdaqQuote(symbol)]);
    const points = chart && Array.isArray(chart.points) ? chart.points.slice(-1200) : [];
    if (quote && quote.price != null) {
      points.push({ time: Date.now(), price: quote.price, volume: quote.volume || null, live: true });
    }
    return jsonResponse(
      { symbol, points, quote, source: "Nasdaq", fetchedAt: new Date().toISOString() },
      200,
      { "Cache-Control": "no-store, no-cache, must-revalidate" }
    );
  } catch (error) {
    console.warn("Nasdaq chart upstream error", String(error && error.message || error));
    return jsonResponse({ error: "Upstream market data unavailable" }, 502, { "Cache-Control": "no-store" });
  }
}

async function tradeRepublicHistory(request) {
  const url = new URL(request.url);
  const isin = String(url.searchParams.get("isin") || "");
  const exchange = String(url.searchParams.get("exchange") || "LSX");
  const range = String(url.searchParams.get("range") || "1d");
  const resolution = Number(url.searchParams.get("resolution") || 60000);
  try {
    const result = await fetchTradeRepublicHistory(isin, exchange, range, resolution);
    return jsonResponse(result, 200, { "Cache-Control": "no-store, no-cache, must-revalidate" });
  } catch (error) {
    console.warn("Trade Republic history upstream error", String(error && error.message || error));
    return jsonResponse({ error: "Upstream market data unavailable" }, 502, { "Cache-Control": "no-store" });
  }
}

async function fetchNasdaqQuote(symbol) {
  const safe = safeStockSymbol(symbol);
  if (!safe) return null;

  const cached = nasdaqQuoteCache.get(safe);
  if (cached && Date.now() - cached.at < NASDAQ_QUOTE_TTL_MS) return cached.value;
  if (nasdaqQuoteInflight.has(safe)) return nasdaqQuoteInflight.get(safe);

  const promise = (async () => {
    const response = await fetch("https://api.nasdaq.com/api/quote/" + encodeURIComponent(safe) + "/info?assetclass=stocks", {
      headers: NASDAQ_HEADERS,
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    if (!response.ok) throw new Error("Nasdaq " + response.status);
    const json = await response.json();
    const data = json && json.data;
    if (!data) return null;
    const primary = data.primaryData || {};
    const secondary = data.secondaryData || null;
    const summary = await fetchNasdaqSummary(safe);
    const value = {
      symbol: data.symbol || safe,
      exchange: data.exchange || null,
      marketStatus: data.marketStatus || null,
      price: parseMarketNumber(primary.lastSalePrice),
      change: parseMarketNumber(primary.netChange),
      changePct: parseMarketNumber(primary.percentageChange),
      bid: parseMarketNumber(primary.bidPrice),
      ask: parseMarketNumber(primary.askPrice),
      bidSize: parseMarketNumber(primary.bidSize),
      askSize: parseMarketNumber(primary.askSize),
      volume: parseMarketNumber(primary.volume) ?? parseMarketNumber(summary && summary.volume),
      dayHigh: parseMarketNumber(summary && summary.dayHigh),
      dayLow: parseMarketNumber(summary && summary.dayLow),
      open: parseMarketNumber(summary && summary.open),
      previousClose: parseMarketNumber(summary && summary.previousClose),
      timestamp: primary.lastTradeTimestamp || null,
      isRealTime: primary.isRealTime === true,
      secondary: secondary ? {
        price: parseMarketNumber(secondary.lastSalePrice),
        change: parseMarketNumber(secondary.netChange),
        changePct: parseMarketNumber(secondary.percentageChange),
        bid: parseMarketNumber(secondary.bidPrice),
        ask: parseMarketNumber(secondary.askPrice),
        volume: parseMarketNumber(secondary.volume),
        timestamp: secondary.lastTradeTimestamp || null,
        isRealTime: secondary.isRealTime === true
      } : null,
      source: "Nasdaq"
    };
    nasdaqQuoteCache.set(safe, { at: Date.now(), value });
    if (nasdaqQuoteCache.size > 500) {
      const cutoff = Date.now() - 60000;
      for (const [key, row] of nasdaqQuoteCache) if (!row || row.at < cutoff) nasdaqQuoteCache.delete(key);
    }
    return value;
  })();

  nasdaqQuoteInflight.set(safe, promise);
  try { return await promise; }
  finally { nasdaqQuoteInflight.delete(safe); }
}

// Buscador de fondos: universo público de Morningstar España (fondos registrados para la venta en
// España, donde están los que ofrece MyInvestor). Solo lectura, sin credenciales, con caché de 12 h.
const MS_FUND_SCREENER = "https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security/screener";
async function fundSearch(request, ctx) {
  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").replace(/[^\p{L}\p{N} &.,'()\/-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (q.length < 3) return jsonResponse({ results: [], error: "Escribe al menos 3 caracteres" }, 400, { "Cache-Control": "no-store" });
  const cacheKey = new Request("https://cache.viewinvai.local/fund-search?q=" + encodeURIComponent(q.toLowerCase()));
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) { const hit = await cache.match(cacheKey); if (hit) return hit; }
  const isin = /^[A-Za-z]{2}[A-Za-z0-9]{9}[0-9]$/.test(q) ? q.toUpperCase() : "";
  const params = new URLSearchParams({ outputType: "json", version: "1", languageId: "es-ES", currencyId: "EUR", universeIds: "FOESP$$ALL",
    securityDataPoints: "SecId|Name|isin|OngoingCharge|ClosePrice|ClosePriceDate|ReturnM12|ReturnM36|ReturnM60|CategoryName|BrandingCompanyName",
    page: "1", pageSize: "30" });
  if (isin) params.set("filters", "ISIN:IN:" + isin); else params.set("term", q);
  let rows = [];
  try {
    const res = await fetch(MS_FUND_SCREENER + "?" + params.toString(), { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 ViewInvAI" }, signal: AbortSignal.timeout(9000) });
    if (!res.ok) throw new Error("Morningstar " + res.status);
    const data = await res.json();
    rows = (data && data.rows || []).map(r => ({
      isin: String(r.isin || "").toUpperCase(), name: String(r.Name || "").slice(0, 160),
      provider: String(r.BrandingCompanyName || "").slice(0, 80), category: String(r.CategoryName || "").slice(0, 80),
      ter: Number.isFinite(Number(r.OngoingCharge)) && r.OngoingCharge !== null ? Number(r.OngoingCharge) : null,
      nav: Number.isFinite(Number(r.ClosePrice)) && r.ClosePrice !== null ? Number(r.ClosePrice) : null,
      navDate: String(r.ClosePriceDate || "").slice(0, 20) || null,
      perf1Y: Number.isFinite(Number(r.ReturnM12)) && r.ReturnM12 !== null ? Number(r.ReturnM12) : null,
      perf3Y: Number.isFinite(Number(r.ReturnM36)) && r.ReturnM36 !== null ? Number(r.ReturnM36) : null,
      perf5Y: Number.isFinite(Number(r.ReturnM60)) && r.ReturnM60 !== null ? Number(r.ReturnM60) : null
    })).filter(r => /^[A-Z]{2}[A-Z0-9]{10}$/.test(r.isin));
  } catch (error) {
    return jsonResponse({ results: [], error: "El buscador de Morningstar no responde ahora" }, 502, { "Cache-Control": "no-store" });
  }
  const response = jsonResponse({ results: rows, source: "Morningstar · fondos registrados en España", fetchedAt: new Date().toISOString() }, 200, { "Cache-Control": "public, max-age=43200" });
  if (cache && ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function nasdaqQuotes(request) {
  const url = new URL(request.url);
  const rawSymbols = url.searchParams.get("symbols") || "";
  if (rawSymbols.length > 400) {
    return jsonResponse({ quotes: [], error: "Query too large" }, 400, { "Cache-Control": "no-store" });
  }
  const symbols = [...new Set(rawSymbols
    .split(",")
    .map(safeStockSymbol)
    .filter(Boolean))].slice(0, 25);

  if (!symbols.length) {
    return jsonResponse({ quotes: [], error: "No valid symbols" }, 400, { "Cache-Control": "no-store" });
  }

  const settled = await Promise.allSettled(symbols.map(fetchNasdaqQuote));
  const quotes = settled
    .map((result, i) => result.status === "fulfilled" && result.value ? result.value : { symbol: symbols[i], error: "unavailable" });

  return jsonResponse(
    { quotes, fetchedAt: new Date().toISOString(), source: "Nasdaq website quote API" },
    200,
    { "Cache-Control": "no-store, no-cache, must-revalidate" }
  );
}


async function liveEurUsd() {
  const response = await fetch("https://scanner.tradingview.com/forex/scan", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0"
    },
    body: JSON.stringify({
      symbols: { tickers: ["FX_IDC:EURUSD"], query: { types: [] } },
      columns: ["close"]
    }),
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  if (!response.ok) throw new Error("TradingView FX " + response.status);
  const payload = await response.json();
  const rows = payload && Array.isArray(payload.data) ? payload.data : [];
  const rate = rows.length && Array.isArray(rows[0].d) ? Number(rows[0].d[0]) : NaN;
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Invalid EUR/USD");
  return jsonResponse({
    pair: "EURUSD",
    rate,
    source: "TradingView FX_IDC:EURUSD",
    updatedAt: new Date().toISOString()
  }, 200, { "Cache-Control": "no-store, no-cache, must-revalidate" });
}

function validTrClientMessage(data, state) {
  if (typeof data !== "string" || data.length > 512) return false;
  if (data === "connect 30") {
    if (state.connected) return false;
    state.connected = true;
    return true;
  }
  let m = data.match(/^unsub\s+(\d{1,7})$/);
  if (m) {
    state.subscriptions.delete(m[1]);
    return true;
  }
  m = data.match(/^sub\s+(\d{1,7})\s+(.+)$/);
  if (!m) return false;
  if (state.subscriptions.size >= 1000 && !state.subscriptions.has(m[1])) return false;
  let payload;
  try { payload = JSON.parse(m[2]); } catch (_) { return false; }
  if (!payload || payload.type !== "ticker" || typeof payload.id !== "string") return false;
  if (!/^[A-Z0-9]{12}\.LSX$/.test(payload.id)) return false;
  state.subscriptions.add(m[1]);
  return true;
}

async function proxyTradeRepublic(request) {
  const guard = requestGuard(request, { websocket: true });
  if (guard) return guard;

  const pair = new WebSocketPair();
  const [client, browser] = Object.values(pair);
  browser.accept({ allowHalfOpen: true });

  let upstream;
  try {
    // The Worker negotiates the upstream handshake; the browser's "connect" is answered locally.
    upstream = await openTradeRepublicSocket();
  } catch (error) {
    browser.close(1011, "Upstream unavailable");
    return new Response(null, { status: 101, webSocket: client });
  }

  const safeSend = (ws, data) => {
    try {
      if (ws.readyState === 1) ws.send(data);
    } catch (_) {}
  };
  const safeClose = (ws, code = 1000, reason = "") => {
    try {
      if (ws.readyState === 0 || ws.readyState === 1) ws.close(code, reason);
    } catch (_) {}
  };

  const clientState = { connected: false, subscriptions: new Set() };
  browser.addEventListener("message", event => {
    if (!validTrClientMessage(event.data, clientState)) {
      safeClose(browser, 1008, "Policy violation");
      safeClose(upstream, 1008, "Policy violation");
      return;
    }
    if (event.data === "connect 30") {
      safeSend(browser, "connected");
      return;
    }
    safeSend(upstream, event.data);
  });
  upstream.addEventListener("message", event => {
    if (typeof event.data === "string" && event.data.length <= 262144) safeSend(browser, event.data);
  });

  browser.addEventListener("close", event => safeClose(upstream, event.code || 1000, "browser closed"));
  upstream.addEventListener("close", event => safeClose(browser, event.code || 1000, "upstream closed"));

  browser.addEventListener("error", () => safeClose(upstream, 1011, "browser error"));
  upstream.addEventListener("error", () => safeClose(browser, 1011, "upstream error"));

  return new Response(null, { status: 101, webSocket: client });
}

function safeSecretEqual(actual, expected) {
  actual = String(actual || "");
  expected = String(expected || "");
  if (!actual || !expected || actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}


const MARKET_CATALOG_GENERATION = "identity-v1";
const MARKET_CATALOG_BATCH_SIZE = 25;
const MARKET_CATALOG_STATEMENT_BATCH_SIZE = 50;

function catalogVenueId(exchange) {
  const value = String(exchange || "").trim().toUpperCase().replace(/[\s_-]+/g, "");
  if (value === "NASDAQ") return "venue:nasdaq";
  if (value === "NYSE") return "venue:nyse";
  if (value === "AMEX") return "venue:amex";
  if (value === "NYSEARCA") return "venue:nyse-arca";
  return "";
}

function catalogText(value, maxLength = 240) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function catalogIsin(value) {
  const isin = String(value || "").trim().toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{10}$/.test(isin) ? isin : "";
}

function catalogRows(result) {
  return result && Array.isArray(result.results) ? result.results : [];
}

async function runCatalogStatements(env, statements) {
  for (let offset = 0; offset < statements.length; offset += MARKET_CATALOG_STATEMENT_BATCH_SIZE) {
    await env.DB.batch(statements.slice(offset, offset + MARKET_CATALOG_STATEMENT_BATCH_SIZE));
  }
}

async function syncMarketCatalogChunk(env, inputRows, generation) {
  const rows = (Array.isArray(inputRows) ? inputRows : []).map(stock => {
    const ticker = safeStockSymbol(stock && stock.ticker);
    const tvSymbol = catalogText(stock && stock.tvSymbol, 96).toUpperCase();
    const venueId = catalogVenueId(stock && stock.exchange);
    const usIsin = catalogIsin(stock && stock.usIsin);
    const trIsin = catalogIsin(stock && stock.trIsin);
    const trTicker = safeStockSymbol(stock && stock.trTicker);
    const tradeRepublicVerified = Boolean(
      stock && stock.tradeRepublicVerified === true &&
      stock.tradeRepublicTradable === true &&
      trIsin &&
      trTicker
    );
    return {
      raw: stock || {},
      ticker,
      tvSymbol,
      venueId,
      usIsin,
      trIsin,
      trTicker,
      tradeRepublicVerified
    };
  }).filter(row => row.ticker && row.tvSymbol && row.venueId);

  if (!rows.length) return { rows: 0, statements: 0, tradeRepublicProducts: 0, conflicts: 0 };

  const tvSymbols = [...new Set(rows.map(row => row.tvSymbol))];
  const isins = [...new Set(rows.map(row => row.usIsin).filter(Boolean))];
  const listingTickers = [...new Set(rows.flatMap(row => [row.ticker, row.trTicker]).filter(Boolean))];

  const tvMap = new Map();
  if (tvSymbols.length) {
    const placeholders = tvSymbols.map(() => "?").join(",");
    const result = await env.DB.prepare(
      "SELECT external_id,instrument_id,listing_id FROM provider_mappings " +
      "WHERE source_id='source:tradingview' AND entity_type='listing' AND external_id IN (" + placeholders + ")"
    ).bind(...tvSymbols).all();
    for (const item of catalogRows(result)) tvMap.set(String(item.external_id || "").toUpperCase(), item);
  }

  const isinMap = new Map();
  if (isins.length) {
    const placeholders = isins.map(() => "?").join(",");
    const result = await env.DB.prepare(
      "SELECT value,instrument_id FROM instrument_identifiers WHERE scheme='ISIN' AND value IN (" + placeholders + ")"
    ).bind(...isins).all();
    for (const item of catalogRows(result)) isinMap.set(String(item.value || "").toUpperCase(), String(item.instrument_id || ""));
  }

  const listingMap = new Map();
  if (listingTickers.length) {
    const placeholders = listingTickers.map(() => "?").join(",");
    const result = await env.DB.prepare(
      "SELECT id,instrument_id,venue_id,ticker FROM listings " +
      "WHERE venue_id IN ('venue:nasdaq','venue:nyse','venue:amex','venue:nyse-arca','venue:lsx') " +
      "AND ticker IN (" + placeholders + ")"
    ).bind(...listingTickers).all();
    for (const item of catalogRows(result)) {
      listingMap.set(String(item.venue_id || "") + "|" + String(item.ticker || "").toUpperCase(), item);
    }
  }

  const statements = [];
  let tradeRepublicProducts = 0;
  let conflicts = 0;

  for (const row of rows) {
    const stock = row.raw;
    const existingTv = tvMap.get(row.tvSymbol);
    const usKey = row.venueId + "|" + row.ticker;
    const existingUsListing = listingMap.get(usKey);

    let instrumentId =
      (existingTv && String(existingTv.instrument_id || "")) ||
      (existingUsListing && String(existingUsListing.instrument_id || "")) ||
      (row.usIsin && isinMap.get(row.usIsin)) ||
      "";
    if (!instrumentId) instrumentId = "instrument:" + crypto.randomUUID();
    if (row.usIsin && !isinMap.has(row.usIsin)) isinMap.set(row.usIsin, instrumentId);

    const usListingId =
      (existingTv && String(existingTv.listing_id || "")) ||
      (existingUsListing && String(existingUsListing.id || "")) ||
      ("listing:" + crypto.randomUUID());

    const assetType = catalogText(stock.instrumentType || "stock", 32).toLowerCase() || "stock";
    const name = catalogText(stock.name || row.ticker, 240) || row.ticker;
    const currency = catalogText(stock.currency || "USD", 12).toUpperCase() || "USD";

    statements.push(env.DB.prepare(
      "INSERT INTO instruments " +
      "(id,asset_type,name,short_name,sector,industry,country_code,base_currency,active,created_at,updated_at) " +
      "VALUES (?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) " +
      "ON CONFLICT(id) DO UPDATE SET asset_type=excluded.asset_type,name=excluded.name,short_name=excluded.short_name," +
      "sector=excluded.sector,industry=excluded.industry,country_code=excluded.country_code,base_currency=excluded.base_currency," +
      "active=1,updated_at=CURRENT_TIMESTAMP"
    ).bind(
      instrumentId,
      assetType,
      name,
      row.ticker,
      catalogText(stock.sector, 160),
      catalogText(stock.industry, 160),
      "US",
      currency
    ));

    if (row.usIsin) {
      statements.push(env.DB.prepare(
        "INSERT INTO instrument_identifiers (id,instrument_id,scheme,value,is_primary,created_at) " +
        "VALUES (?,?,?,?,1,CURRENT_TIMESTAMP) " +
        "ON CONFLICT(scheme,value) DO UPDATE SET instrument_id=excluded.instrument_id,is_primary=1"
      ).bind("identifier:isin:" + row.usIsin, instrumentId, "ISIN", row.usIsin));
    }

    statements.push(env.DB.prepare(
      "INSERT INTO listings (id,instrument_id,venue_id,ticker,currency,is_primary,active,created_at,updated_at) " +
      "VALUES (?,?,?,?,?,1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) " +
      "ON CONFLICT(venue_id,ticker) DO UPDATE SET instrument_id=excluded.instrument_id,currency=excluded.currency," +
      "is_primary=1,active=1,updated_at=CURRENT_TIMESTAMP"
    ).bind(usListingId, instrumentId, row.venueId, row.ticker, currency));

    statements.push(env.DB.prepare(
      "INSERT INTO provider_mappings " +
      "(id,source_id,entity_type,instrument_id,listing_id,external_id,external_symbol,metadata_json,active,created_at,updated_at) " +
      "VALUES (?,'source:tradingview','listing',?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) " +
      "ON CONFLICT(source_id,entity_type,external_id) DO UPDATE SET instrument_id=excluded.instrument_id," +
      "listing_id=excluded.listing_id,external_symbol=excluded.external_symbol,metadata_json=excluded.metadata_json," +
      "active=1,updated_at=CURRENT_TIMESTAMP"
    ).bind(
      "provider-map:tradingview:" + row.tvSymbol,
      instrumentId,
      usListingId,
      row.tvSymbol,
      row.ticker,
      JSON.stringify({ generation })
    ));

    listingMap.set(usKey, { id: usListingId, instrument_id: instrumentId, venue_id: row.venueId, ticker: row.ticker });
    tvMap.set(row.tvSymbol, { external_id: row.tvSymbol, instrument_id: instrumentId, listing_id: usListingId });

    if (!row.tradeRepublicVerified) {
      if (row.trIsin) {
        statements.push(env.DB.prepare(
          "UPDATE broker_products SET tradable=0,verified=0,updated_at=CURRENT_TIMESTAMP " +
          "WHERE broker_id='broker:trade-republic' AND external_id=?"
        ).bind(row.trIsin));
        statements.push(env.DB.prepare(
          "UPDATE broker_listings SET tradable=0,verified=0,updated_at=CURRENT_TIMESTAMP " +
          "WHERE broker_id='broker:trade-republic' AND external_id=?"
        ).bind(row.trIsin));
        statements.push(env.DB.prepare(
          "UPDATE provider_mappings SET active=0,updated_at=CURRENT_TIMESTAMP " +
          "WHERE source_id='source:trade-republic' AND entity_type='listing' AND external_id=?"
        ).bind(row.trIsin + ":LSX"));
      }
      continue;
    }

    const trKey = "venue:lsx|" + row.trTicker;
    const existingTrListing = listingMap.get(trKey);
    if (existingTrListing && String(existingTrListing.instrument_id || "") !== instrumentId) {
      conflicts += 1;
      console.warn("Catalog sync skipped conflicting LSX listing", row.trTicker, row.trIsin);
      continue;
    }

    const trListingId = existingTrListing && String(existingTrListing.id || "")
      ? String(existingTrListing.id)
      : "listing:" + crypto.randomUUID();
    const trMetadata = JSON.stringify({
      generation,
      isin: row.trIsin,
      wkn: catalogText(stock.trWkn, 32),
      nameAtExchange: catalogText(stock.trNameAtExchange, 240)
    });

    statements.push(env.DB.prepare(
      "UPDATE broker_products SET tradable=0,verified=0,updated_at=CURRENT_TIMESTAMP " +
      "WHERE broker_id='broker:trade-republic' AND external_id=? AND (listing_id IS NULL OR listing_id<>?)"
    ).bind(row.trIsin, trListingId));
    statements.push(env.DB.prepare(
      "UPDATE broker_listings SET tradable=0,verified=0,updated_at=CURRENT_TIMESTAMP " +
      "WHERE broker_id='broker:trade-republic' AND external_id=? AND listing_id<>?"
    ).bind(row.trIsin, trListingId));

    statements.push(env.DB.prepare(
      "INSERT INTO listings (id,instrument_id,venue_id,ticker,currency,is_primary,active,created_at,updated_at) " +
      "VALUES (?,?,'venue:lsx',?,'EUR',0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) " +
      "ON CONFLICT(venue_id,ticker) DO UPDATE SET instrument_id=excluded.instrument_id,currency='EUR'," +
      "active=1,updated_at=CURRENT_TIMESTAMP"
    ).bind(trListingId, instrumentId, row.trTicker));

    statements.push(env.DB.prepare(
      "INSERT INTO provider_mappings " +
      "(id,source_id,entity_type,instrument_id,listing_id,external_id,external_symbol,metadata_json,active,created_at,updated_at) " +
      "VALUES (?,'source:trade-republic','listing',?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) " +
      "ON CONFLICT(source_id,entity_type,external_id) DO UPDATE SET instrument_id=excluded.instrument_id," +
      "listing_id=excluded.listing_id,external_symbol=excluded.external_symbol,metadata_json=excluded.metadata_json," +
      "active=1,updated_at=CURRENT_TIMESTAMP"
    ).bind(
      "provider-map:trade-republic:" + row.trIsin + ":lsx",
      instrumentId,
      trListingId,
      row.trIsin + ":LSX",
      row.trTicker,
      trMetadata
    ));

    const brokerListingId = "broker-listing:trade-republic:" + trListingId;
    statements.push(env.DB.prepare(
      "INSERT INTO broker_listings " +
      "(id,broker_id,listing_id,tradable,verified,external_id,metadata_json,verified_at,created_at,updated_at) " +
      "VALUES (?,'broker:trade-republic',?,1,1,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) " +
      "ON CONFLICT(broker_id,listing_id) DO UPDATE SET tradable=1,verified=1,external_id=excluded.external_id," +
      "metadata_json=excluded.metadata_json,verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP"
    ).bind(brokerListingId, trListingId, row.trIsin, trMetadata));

    statements.push(env.DB.prepare(
      "INSERT INTO broker_products " +
      "(id,broker_id,instrument_id,listing_id,product_code,external_id,product_mode,currency,tradable,verified,metadata_json,verified_at,created_at,updated_at) " +
      "VALUES (?,'broker:trade-republic',?,?,?,?,'exchange','EUR',1,1,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) " +
      "ON CONFLICT(broker_id,listing_id) WHERE listing_id IS NOT NULL DO UPDATE SET instrument_id=excluded.instrument_id," +
      "product_code=excluded.product_code,external_id=excluded.external_id,product_mode='exchange',currency='EUR'," +
      "tradable=1,verified=1,metadata_json=excluded.metadata_json,verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP"
    ).bind(
      "broker-product:trade-republic:" + trListingId,
      instrumentId,
      trListingId,
      row.trTicker,
      row.trIsin,
      trMetadata
    ));

    listingMap.set(trKey, { id: trListingId, instrument_id: instrumentId, venue_id: "venue:lsx", ticker: row.trTicker });
    tradeRepublicProducts += 1;
  }

  await runCatalogStatements(env, statements);
  return { rows: rows.length, statements: statements.length, tradeRepublicProducts, conflicts };
}

async function syncMarketCatalogToD1(env, payload) {
  if (!env.DB) throw new Error("D1 backend not configured");
  if (!payload || payload.generation !== MARKET_CATALOG_GENERATION || !Array.isArray(payload.stocks)) {
    throw new Error("Invalid market catalog payload");
  }
  if (payload.stocks.length > 250) throw new Error("Market catalog chunk too large");

  const total = { rows: 0, statements: 0, tradeRepublicProducts: 0, conflicts: 0 };
  for (let offset = 0; offset < payload.stocks.length; offset += MARKET_CATALOG_BATCH_SIZE) {
    const result = await syncMarketCatalogChunk(
      env,
      payload.stocks.slice(offset, offset + MARKET_CATALOG_BATCH_SIZE),
      payload.generation
    );
    total.rows += result.rows;
    total.statements += result.statements;
    total.tradeRepublicProducts += result.tradeRepublicProducts;
    total.conflicts += result.conflicts;
  }
  return total;
}

async function publishMarketToR2(request, env) {
  if (!String(env.MARKET_PUBLISH_TOKEN || "").trim()) {
    return jsonResponse({ error: "Market publishing is not configured" }, 503, { "Cache-Control": "no-store" });
  }
  if (request.method !== "PUT" && request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, { "Cache-Control": "no-store" });
  }
  const auth = String(request.headers.get("Authorization") || "");
  const expected = "Bearer " + String(env.MARKET_PUBLISH_TOKEN || "").trim();
  if (!safeSecretEqual(auth, expected)) {
    return jsonResponse({ error: "Unauthorized" }, 401, { "Cache-Control": "no-store" });
  }

  const url = new URL(request.url);
  const kind = String(url.searchParams.get("kind") || "");
  const key = kind === "snapshot" ? "data/market.json" :
    kind === "version" ? "data/market-version.json" :
    kind === "funds" ? "data/funds.json" : "";
  if (!key && kind !== "catalog") {
    return jsonResponse({ error: "Invalid market asset kind" }, 400, { "Cache-Control": "no-store" });
  }

  const announced = Number(request.headers.get("Content-Length") || 0);
  const maxBytes = kind === "snapshot" ? 24 * 1024 * 1024 :
    kind === "funds" ? 12 * 1024 * 1024 :
    kind === "catalog" ? 2 * 1024 * 1024 :
    64 * 1024;
  if (announced > maxBytes) return jsonResponse({ error: "Payload too large" }, 413, { "Cache-Control": "no-store" });

  const body = await request.arrayBuffer();
  if (!body.byteLength || body.byteLength > maxBytes) {
    return jsonResponse({ error: "Invalid payload size" }, body.byteLength > maxBytes ? 413 : 400, { "Cache-Control": "no-store" });
  }

  let parsed;
  try { parsed = JSON.parse(new TextDecoder().decode(body)); }
  catch (_) { return jsonResponse({ error: "Invalid JSON" }, 400, { "Cache-Control": "no-store" }); }

  if (kind === "snapshot" && (!parsed || !Array.isArray(parsed.stocks) || !parsed.meta || !parsed.meta.updatedAt)) {
    return jsonResponse({ error: "Invalid market snapshot" }, 400, { "Cache-Control": "no-store" });
  }
  if (kind === "funds" && (!parsed || !Array.isArray(parsed.products) || !parsed.meta || !parsed.meta.updatedAt)) {
    return jsonResponse({ error: "Invalid funds snapshot" }, 400, { "Cache-Control": "no-store" });
  }
  if (kind === "version" && (!parsed || !parsed.updatedAt)) {
    return jsonResponse({ error: "Invalid market version" }, 400, { "Cache-Control": "no-store" });
  }
  if (kind === "catalog") {
    if (!parsed || parsed.generation !== MARKET_CATALOG_GENERATION || !Array.isArray(parsed.stocks) || !parsed.updatedAt) {
      return jsonResponse({ error: "Invalid market catalog" }, 400, { "Cache-Control": "no-store" });
    }
    try {
      const synced = await syncMarketCatalogToD1(env, parsed);
      return jsonResponse({
        ok: true,
        kind: "catalog",
        generation: parsed.generation,
        updatedAt: parsed.updatedAt,
        ...synced
      }, 200, { "Cache-Control": "no-store" });
    } catch (error) {
      console.error("Market catalog D1 sync failed", String(error && error.stack || error));
      return jsonResponse({ error: "Market catalog sync failed" }, 500, { "Cache-Control": "no-store" });
    }
  }

  if (!env.MARKET_DATA_BUCKET) {
    return jsonResponse({ error: "Market storage is not configured" }, 503, { "Cache-Control": "no-store" });
  }

  await env.MARKET_DATA_BUCKET.put(key, body, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { updatedAt: String(parsed.updatedAt || parsed.meta && parsed.meta.updatedAt || "") }
  });
  return jsonResponse({
    ok: true,
    key,
    bytes: body.byteLength,
    updatedAt: String(parsed.updatedAt || parsed.meta && parsed.meta.updatedAt || "")
  }, 200, { "Cache-Control": "no-store" });
}

async function r2MarketAssetResponse(env, pathname) {
  if (!env || !env.MARKET_DATA_BUCKET) return null;
  const allowed = new Set(["/data/market.json", "/data/market-version.json", "/data/funds.json"]);
  if (!allowed.has(pathname)) return null;
  try {
    const key = pathname.replace(/^\//, "");
    const object = await env.MARKET_DATA_BUCKET.get(key);
    if (!object) return null;
    let responseBody = object.body;
    if (pathname.endsWith("funds.json")) {
      const raw = await object.arrayBuffer();
      let parsed = null;
      try { parsed = JSON.parse(new TextDecoder().decode(raw)); } catch (_) {}
      if (!parsed || !Array.isArray(parsed.products) || parsed.products.length < 10 || !parsed.meta || !parsed.meta.updatedAt) {
        console.warn("Ignoring invalid R2 funds snapshot; falling back to deployed asset");
        return null;
      }
      responseBody = raw;
    }
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    if (object.httpEtag) headers.set("ETag", object.httpEtag);
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.set("Cache-Control", pathname.endsWith("market-version.json")
      ? "public, max-age=30, must-revalidate"
      : pathname.endsWith("funds.json")
        ? "public, max-age=900, must-revalidate"
        : "public, max-age=60, must-revalidate");
    headers.set("X-ViewInvAI-Market-Storage", "r2");
    return secureResponse(new Response(responseBody, { status: 200, headers }), pathname);
  } catch (error) {
    console.warn("R2 market asset fallback", String(error && error.message || error));
    return null;
  }
}

// Market server (Netlify, MARKET_SERVER_URL): holds the full snapshot with the live overlay
// and returns only what each task needs: the requested stocks with their events, and the
// universe scans (Radar, Objetivo discovery, «lo más comentado») already computed. Parsing
// the 19 MB snapshot here costs ~100 ms of CPU, ten times the Workers Free limit.
// need = {targets:[{stock_key,ticker}], exact, universe:["radar","goal:us","goal:tr","attention"],
//         universeStocks, prices:[stock keys]}. Without `need` (or if the server fails) the
// full snapshot is loaded here as before, so nothing is lost.
const MARKET_SERVER_MEMO_MS=45000;
const marketServerMemo=new Map();
function marketServerBody(need){
  const targets=[];const seen=new Set();
  for(const t of Array.isArray(need.targets)?need.targets:[]){
    const stock_key=String(t&&t.stock_key||"").toUpperCase().slice(0,120),ticker=String(t&&t.ticker||"").toUpperCase().slice(0,24);
    const k=stock_key+"|"+ticker;if((!stock_key&&!ticker)||seen.has(k))continue;seen.add(k);targets.push({stock_key,ticker});
  }
  return{targets:targets.slice(0,400),exact:!!need.exact,universe:(Array.isArray(need.universe)?need.universe:[]).map(String).sort(),
    universeStocks:!!need.universeStocks,prices:[...new Set((Array.isArray(need.prices)?need.prices:[]).map(k=>String(k).toUpperCase()))].sort().slice(0,5000),
    funds:[...new Set((Array.isArray(need.funds)?need.funds:[]).map(k=>String(k).toUpperCase()).filter(k=>/^[A-Z]{2}[A-Z0-9]{10}$/.test(k)))].sort().slice(0,200)};
}
// Stocks (with their events) received in the last 45 s, so the tasks of one cron minute
// ask the server once for the same stocks instead of once per task or per target.
const marketServerStocks={key:new Map(),ticker:new Map()};
function rememberServerStocks(data){
  const at=Date.now(),byTicker=new Map();
  for(const e of data.events||[]){const t=String(e&&e.ticker||"").toUpperCase();if(!t)continue;if(!byTicker.has(t))byTicker.set(t,[]);byTicker.get(t).push(e)}
  for(const s of data.stocks||[]){
    const entry={at,stock:s,events:byTicker.get(String(s.ticker||"").toUpperCase())||[],meta:data.meta};
    marketServerStocks.key.set(String(s.tvSymbol||((s.exchange||"")+":"+(s.ticker||""))).toUpperCase(),entry);
  }
  if(marketServerStocks.key.size>3000)for(const [k,v] of marketServerStocks.key)if(at-v.at>MARKET_SERVER_MEMO_MS)marketServerStocks.key.delete(k);
}
function cachedServerSnapshot(req){
  if(req.universe.length||req.prices.length||req.funds.length||!req.targets.length)return null;
  const stocks=[],events=[],seen=new Set();let meta=null;
  for(const t of req.targets){
    const hit=t.stock_key&&marketServerStocks.key.get(t.stock_key);
    if(!hit||Date.now()-hit.at>=MARKET_SERVER_MEMO_MS)return null;
    const k=t.stock_key;if(seen.has(k))continue;seen.add(k);
    stocks.push(hit.stock);for(const e of hit.events)events.push(e);meta=hit.meta;
  }
  return{meta,stocks,events,universe:{},partial:true};
}
async function marketServerSnapshot(env,need){
  const req=marketServerBody(need);
  const cached=cachedServerSnapshot(req);
  if(cached)return cached;
  const body=JSON.stringify(req);
  let hit=marketServerMemo.get(body);
  if(!hit||Date.now()-hit.at>=MARKET_SERVER_MEMO_MS){
    hit={at:Date.now(),pending:fetchMarketServer(env,body)};
    marketServerMemo.set(body,hit);
    if(marketServerMemo.size>60)for(const [k,v] of marketServerMemo)if(Date.now()-v.at>MARKET_SERVER_MEMO_MS)marketServerMemo.delete(k);
  }
  try{
    // Each caller gets its own copy: tasks add stocks to their snapshot (mergeSnapshotInto).
    const data=await hit.pending;
    return Object.assign({},data,{stocks:data.stocks.slice(),events:Array.isArray(data.events)?data.events.slice():[]});
  }catch(error){marketServerMemo.delete(body);throw error}
}
async function fetchMarketServer(env,body){
  const headers={"Content-Type":"application/json","Accept":"application/json"};
  if(env.MARKET_SERVER_KEY)headers["X-ViewInvAI-Key"]=env.MARKET_SERVER_KEY;
  const r=await fetch(env.MARKET_SERVER_URL,{method:"POST",headers,body,signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw new Error("Market server "+r.status);
  const data=await r.json();
  if(!data||!Array.isArray(data.stocks))throw new Error("Market server: respuesta no válida");
  rememberServerStocks(data);
  return Object.assign(data,{partial:true});
}
async function loadMarketSnapshotForBackend(env, need = null) {
  if (need && env.MARKET_SERVER_URL) {
    try { return await marketServerSnapshot(env, need); }
    catch (error) { console.warn("Market server unavailable, loading the full snapshot", String(error && error.message || error)); }
  }
  let response = await r2MarketAssetResponse(env, "/data/market.json");
  if (!response) response = await env.ASSETS.fetch(new Request("https://viewinvai.local/data/market.json"));
  if (!response.ok) throw new Error("Market snapshot unavailable");
  const data = await response.json();
  if (!data || !Array.isArray(data.stocks)) throw new Error("Invalid market snapshot");
  // Alerts and Radar on the server use live price/volume, not the 30-min photo.
  try { overlayMarketLive(data, await marketLivePayload(env)); }
  catch (error) { console.warn("Market live overlay unavailable", String(error && error.message || error)); }
  return data;
}

async function loadQuoteForBackend(stock,target){
  // Acciones de TR que no cotizan en EE. UU.: no están en Nasdaq.
  if((target&&Number(target.prefer_tr)===1)||(stock&&stock.region==="intl")){
    const isin=String((target&&target.isin)||(stock&&stock.trIsin)||(stock&&stock.isin)||"").trim().toUpperCase();
    if(!/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin))return null;
    return fetchTradeRepublicTicker(isin,"LSX");
  }
  const ticker=safeStockSymbol(stock&&stock.ticker||target&&target.ticker||"");
  if(!ticker)return null;
  const quote=await fetchNasdaqQuote(ticker);
  return quote?Object.assign({market:"us",source:quote.source||"Nasdaq"},quote):null;
}

async function loadChartForBackend(stock, target) {
  const preferTr = (target && Number(target.prefer_tr) === 1) || (stock && stock.region === "intl");
  const isin = String((target && target.isin) || (stock && stock.trIsin) || (stock && stock.isin) || "").trim().toUpperCase();
  if (preferTr && /^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) {
    return fetchTradeRepublicHistory(isin, "LSX", "1d", 60000);
  }
  const ticker = safeStockSymbol(stock && stock.ticker);
  if (!ticker) throw new Error("No valid chart ticker");
  return fetchNasdaqChart(ticker);
}

const backendNewsCache = new Map();
function backendNewsImpact(title){
  const text=String(title||"").toLowerCase();
  if(/bankrupt|chapter 11|fraud|investigation|sec charges|delist|clinical hold|complete response|recall/.test(text))return 90;
  if(/earnings|guidance|acquisition|merger|fda|approval|contract|offering|financing|dividend|buyback|ceo|cfo/.test(text))return 78;
  if(/results|partnership|launch|trial|patent|regulatory|forecast|outlook/.test(text))return 68;
  return 60;
}
function backendNewsType(title){
  const text=String(title||"").toLowerCase();
  if(/earnings|revenue|eps|guidance|results/.test(text))return "earnings";
  if(/offering|financing|debt|capital raise|convertible/.test(text))return "financing";
  if(/fda|regulat|sec |lawsuit|investigation|patent/.test(text))return "regulatory";
  if(/acquisition|merger|contract|partnership|launch/.test(text))return "corporate";
  return "news";
}
async function loadNewsForBackend(stock,target){
  const ticker=String(stock&&stock.ticker||target&&target.ticker||"").trim().toUpperCase();
  const symbol=String(stock&&stock.tvSymbol||((stock&&stock.exchange||target&&target.exchange||"")+":"+ticker)).trim().toUpperCase();
  if(!ticker||!symbol)return[];
  const cacheKey=symbol,now=Date.now(),cached=backendNewsCache.get(cacheKey);
  if(cached&&now-cached.at<60*1000)return cached.rows;
  try{
    const url=new URL("https://news-headlines.tradingview.com/v2/headlines");
    url.searchParams.set("client","web");
    url.searchParams.set("lang","en");
    url.searchParams.set("symbol",symbol);
    const response=await fetch(url.toString(),{headers:{
      "Accept":"application/json, text/plain, */*",
      "User-Agent":"Mozilla/5.0",
      "Referer":"https://www.tradingview.com/"
    }});
    if(!response.ok)throw new Error("TradingView news "+response.status);
    const payload=await response.json();
    const rows=(Array.isArray(payload&&payload.items)?payload.items:[]).slice(0,12).map(item=>{
      const rawPublished=item&&item.published;
      const numericPublished=typeof rawPublished==="number"?rawPublished:Number.NaN;
      const published=new Date(Number.isFinite(numericPublished)&&numericPublished>0&&numericPublished<1e12?numericPublished*1000:(rawPublished||0));
      if(!Number.isFinite(published.getTime())||published.getTime()<=0)return null;
      const title=String(item&&item.title||"").trim();
      if(!title)return null;
      let link=String(item&&item.link||"").trim();
      if(!link&&item&&item.storyPath)link="https://www.tradingview.com"+String(item.storyPath);
      const provider=String(item&&item.provider&&item.provider.name||item&&item.source||"TradingView Headlines").trim();
      return{
        id:String(item&&item.id||("tvnews:"+ticker+":"+published.getTime()+":"+title.slice(0,48))),
        eventKind:"news",
        type:backendNewsType(title),
        ticker,
        name:String(stock&&stock.name||target&&target.name||""),
        exchange:String(stock&&stock.exchange||target&&target.exchange||""),
        date:published.toISOString(),
        title,
        fact:title,
        impact:"",
        impactScore:backendNewsImpact(title),
        verification:"Titular de TradingView del valor seguido",
        source:provider||"TradingView Headlines",
        sourceCount:1,
        independentSourceCount:0,
        corroborated:false,
        url:link
      };
    }).filter(Boolean);
    backendNewsCache.set(cacheKey,{at:now,rows});
    if(backendNewsCache.size>500){
      for(const [key,value] of backendNewsCache)if(!value||now-value.at>20*60*1000)backendNewsCache.delete(key);
    }
    return rows;
  }catch(error){
    console.warn("Followed-stock news unavailable",symbol,String(error&&error.message||error));
    return cached&&cached.rows||[];
  }
}

const backendOfficialEventCache = new Map();
function secImpactForForm(form){
  const f=String(form||"").toUpperCase();
  if(["8-K","6-K","10-Q","10-K","S-1","S-3","424B5","424B3"].includes(f))return 88;
  if(/^SC 13[DG]/.test(f)||f==="4")return 72;
  return 68;
}
function secTypeForForm(form,description){
  const f=String(form||"").toUpperCase(),d=String(description||"").toLowerCase();
  if(f==="10-Q"||f==="10-K"||/earnings|results/.test(d))return "earnings";
  if(/^S-|^424B/.test(f)||/offering|financing|securities/.test(d))return "financing";
  return "regulatory";
}
async function loadOfficialEventsForBackend(stock,target,env){
  const events=[],now=Date.now(),ticker=String(stock&&stock.ticker||target&&target.ticker||"").trim().toUpperCase();
  const cikDigits=String(stock&&stock.secCik||target&&target.secCik||"").replace(/\D/g,"");
  if(!ticker||!cikDigits)return events;
  const userAgent=String(env&&env.SEC_USER_AGENT||"ViewInvAI/1.0 (https://viewinvai.firebaseapp.com)").trim();
  const cik=cikDigits.padStart(10,"0").slice(-10),cacheKey="sec:"+cik,cached=backendOfficialEventCache.get(cacheKey);
  if(cached&&now-cached.at<60*1000)return cached.rows;
  try{
    const response=await fetch("https://data.sec.gov/submissions/CIK"+cik+".json",{headers:{
      "Accept":"application/json",
      "Accept-Encoding":"gzip, deflate",
      "User-Agent":userAgent
    }});
    if(!response.ok)throw new Error("SEC "+response.status);
    const payload=await response.json(),recent=payload&&payload.filings&&payload.filings.recent||{};
    const forms=Array.isArray(recent.form)?recent.form:[],dates=Array.isArray(recent.filingDate)?recent.filingDate:[],
      accessions=Array.isArray(recent.accessionNumber)?recent.accessionNumber:[],primaryDocs=Array.isArray(recent.primaryDocument)?recent.primaryDocument:[],
      descriptions=Array.isArray(recent.primaryDocDescription)?recent.primaryDocDescription:[];
    const acceptedForms=/^(8-K|6-K|10-Q|10-K|S-1|S-3|424B3|424B5|SC 13D|SC 13G|4)$/;
    for(let i=0;i<Math.min(forms.length,80);i++){
      const form=String(forms[i]||"").toUpperCase();
      if(!acceptedForms.test(form))continue;
      const filed=new Date(String(dates[i]||"")+"T12:00:00Z");
      if(!Number.isFinite(filed.getTime())||now-filed.getTime()>8*86400000||filed.getTime()>now+86400000)continue;
      const accession=String(accessions[i]||"").trim(),doc=String(primaryDocs[i]||"").trim(),description=String(descriptions[i]||"").trim();
      const accessionCompact=accession.replace(/-/g,"");
      const cikPlain=String(Number(cik));
      const url=accessionCompact&&doc?"https://www.sec.gov/Archives/edgar/data/"+cikPlain+"/"+accessionCompact+"/"+encodeURIComponent(doc):"https://www.sec.gov/edgar/browse/?CIK="+cikPlain;
      const title="SEC "+form+(description?" · "+description:"");
      events.push({
        id:"sec:"+cik+":"+accession,
        eventKind:"news",
        type:secTypeForForm(form,description),
        ticker,
        name:String(stock&&stock.name||target&&target.name||payload&&payload.name||""),
        exchange:String(stock&&stock.exchange||target&&target.exchange||""),
        date:filed.toISOString(),
        title:title.slice(0,240),
        fact:"Presentación oficial "+form+" registrada en SEC/EDGAR.",
        impact:"",
        impactScore:secImpactForForm(form),
        verification:"Documento oficial SEC / EDGAR",
        source:"SEC EDGAR",
        sourceFamily:"sec",
        official:true,
        sourceCount:1,
        independentSourceCount:0,
        corroborated:false,
        url
      });
    }
    backendOfficialEventCache.set(cacheKey,{at:now,rows:events});
    if(backendOfficialEventCache.size>500){
      for(const [key,value] of backendOfficialEventCache)if(!value||now-value.at>60*60*1000)backendOfficialEventCache.delete(key);
    }
    return events;
  }catch(error){
    console.warn("Followed-stock official events unavailable",ticker,String(error&&error.message||error));
    return cached&&cached.rows||[];
  }
}


function normalizedCompanyTokens(value){
  const generic=new Set(["inc","incorporated","corp","corporation","co","company","ltd","limited","plc","holdings","holding","group","sa","ag","nv","se","and","the","bio","biotech","biotechnology","pharma","pharmaceutical","pharmaceuticals","therapeutics","therapeutic","medical","health","sciences","science"]);
  return String(value||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim().split(/\s+/).filter(token=>token.length>1&&!generic.has(token));
}
function clinicalSponsorMatches(company,sponsor){
  const left=normalizedCompanyTokens(company),right=new Set(normalizedCompanyTokens(sponsor));
  if(!left.length||!right.size)return false;
  const matches=left.filter(token=>right.has(token)).length;
  return matches>=Math.min(2,left.length)||left.some(token=>token.length>=6&&right.has(token));
}
function clinicalCompanyQuery(name){
  return normalizedCompanyTokens(name).slice(0,3).join(" ");
}
function clinicalDate(value){
  const raw=String(value||"").trim();
  if(!/^\d{4}-\d{2}(-\d{2})?$/.test(raw))return null;
  const normalized=raw.length===7?raw+"-01":raw;
  const parsed=new Date(normalized+"T12:00:00Z");
  return Number.isFinite(parsed.getTime())?parsed:null;
}
function clinicalPhase(phases){
  const list=(Array.isArray(phases)?phases:[]).map(x=>String(x||"").toUpperCase());
  if(list.includes("PHASE3"))return{label:"Fase 3",impact:68};
  if(list.includes("PHASE2"))return{label:"Fase 2",impact:58};
  if(list.includes("PHASE1")||list.includes("EARLY_PHASE1"))return{label:"Fase 1",impact:46};
  if(list.includes("PHASE4"))return{label:"Fase 4",impact:50};
  return{label:"Ensayo clínico",impact:42};
}
async function loadClinicalEventsForBackend(stock,target){
  const sector=String(stock&&stock.sector||"")+" "+String(stock&&stock.industry||"");
  if(!/health|biotech|biolog|pharma|therapeut|medical/i.test(sector))return[];
  const company=String(stock&&stock.name||target&&target.name||"").trim(),query=clinicalCompanyQuery(company);
  if(!query)return[];
  const now=Date.now(),cacheKey="clinical:"+query.toLowerCase(),cached=backendOfficialEventCache.get(cacheKey);
  if(cached&&now-cached.at<6*60*60*1000)return cached.rows;
  try{
    const url=new URL("https://clinicaltrials.gov/api/v2/studies");
    url.searchParams.set("query.lead",query);
    url.searchParams.set("filter.overallStatus","RECRUITING|NOT_YET_RECRUITING|ACTIVE_NOT_RECRUITING|ENROLLING_BY_INVITATION");
    url.searchParams.set("pageSize","40");
    url.searchParams.set("format","json");
    const response=await fetch(url.toString(),{headers:{"Accept":"application/json","User-Agent":"ViewInvAI/0.6.18"}});
    if(!response.ok)throw new Error("ClinicalTrials.gov "+response.status);
    const payload=await response.json(),rows=[];
    const start=now-86400000,end=now+120*86400000;
    for(const study of Array.isArray(payload&&payload.studies)?payload.studies:[]){
      const protocol=study&&study.protocolSection||{},identification=protocol.identificationModule||{},sponsors=protocol.sponsorCollaboratorsModule||{},
        lead=sponsors.leadSponsor||{},leadName=String(lead.name||"").trim(),leadClass=String(lead.class||"").toUpperCase();
      if(leadClass&&leadClass!=="INDUSTRY")continue;
      if(!clinicalSponsorMatches(company,leadName))continue;
      const status=protocol.statusModule||{},primary=status.primaryCompletionDateStruct||{},completion=status.completionDateStruct||{},
        dateStruct=primary.date?primary:completion,when=clinicalDate(dateStruct.date);
      if(!when||when.getTime()<start||when.getTime()>end)continue;
      const nct=String(identification.nctId||"").trim();
      if(!nct)continue;
      const phase=clinicalPhase(protocol.designModule&&protocol.designModule.phases||[]),dateKind=primary.date?"finalización primaria":"finalización del estudio",
        estimated=String(dateStruct.type||"").toUpperCase()==="ESTIMATED",brief=String(identification.briefTitle||"").trim(),
        ticker=String(stock&&stock.ticker||target&&target.ticker||"").trim().toUpperCase(),eventUrl="https://clinicaltrials.gov/study/"+encodeURIComponent(nct);
      rows.push({
        id:"clinicaltrials:"+nct+":"+dateKind.replace(/\s+/g,"-"),
        eventKind:"scheduled",
        type:"medical",
        ticker,
        name:company,
        exchange:String(stock&&stock.exchange||target&&target.exchange||""),
        date:when.toISOString(),
        title:"ClinicalTrials.gov · "+dateKind+" · "+phase.label,
        fact:leadName+" figura como lead sponsor. ClinicalTrials.gov marca "+when.toISOString().slice(0,10)+" como fecha "+(estimated?"estimada":"registrada")+" de "+dateKind+(brief?" para "+brief+".":"."),
        impact:"La fecha puede aumentar la atención sobre el programa, pero no anticipa el resultado del estudio.",
        impactScore:phase.impact,
        verification:"Registro oficial ClinicalTrials.gov · lead sponsor validado",
        source:"ClinicalTrials.gov",
        sourceFamily:"clinicaltrials",
        official:true,
        sourceCount:1,
        independentSourceCount:0,
        corroborated:false,
        url:eventUrl
      });
    }
    backendOfficialEventCache.set(cacheKey,{at:now,rows});
    return rows;
  }catch(error){
    console.warn("Followed-stock clinical events unavailable",company,String(error&&error.message||error));
    return cached&&cached.rows||[];
  }
}

function fdaStatusInfo(code){
  const map={
    AP:{label:"Aprobación",kind:"approved",impact:92},
    TA:{label:"Aprobación tentativa",kind:"tentative_approval",impact:76},
    CR:{label:"Complete Response",kind:"complete_response",impact:90},
    NA:{label:"No aprobable",kind:"not_approvable",impact:90},
    WD:{label:"Retirada",kind:"withdrawn",impact:82},
    AE:{label:"Aprobable",kind:"approvable",impact:70}
  };
  return map[String(code||"").toUpperCase()]||{label:"Actualización regulatoria",kind:"regulatory_update",impact:64};
}
function fdaSubmissionDate(value){
  const raw=String(value||"").trim();
  if(/^\d{8}$/.test(raw))return new Date(raw.slice(0,4)+"-"+raw.slice(4,6)+"-"+raw.slice(6,8)+"T12:00:00Z");
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return new Date(raw+"T12:00:00Z");
  return null;
}
async function loadFdaEventsForBackend(stock,target,env){
  const sector=String(stock&&stock.sector||"")+" "+String(stock&&stock.industry||"");
  if(!/health|biotech|biolog|pharma|therapeut|medical/i.test(sector))return[];
  const company=String(stock&&stock.name||target&&target.name||"").trim(),query=clinicalCompanyQuery(company);
  if(!query)return[];
  const now=Date.now(),cacheKey="fda:"+query.toLowerCase(),cached=backendOfficialEventCache.get(cacheKey);
  if(cached&&now-cached.at<6*60*60*1000)return cached.rows;
  try{
    const url=new URL("https://api.fda.gov/drug/drugsfda.json");
    url.searchParams.set("search",'sponsor_name:"'+query.replace(/"/g,"")+'"');
    url.searchParams.set("limit","30");
    const apiKey=String(env&&env.OPENFDA_API_KEY||"").trim();
    if(apiKey)url.searchParams.set("api_key",apiKey);
    const response=await fetch(url.toString(),{headers:{"Accept":"application/json","User-Agent":"ViewInvAI/0.6.18 market-research"}});
    if(response.status===404){backendOfficialEventCache.set(cacheKey,{at:now,rows:[]});return[]}
    if(!response.ok)throw new Error("openFDA "+response.status);
    const payload=await response.json(),rows=[],cutoff=now-8*86400000;
    for(const application of Array.isArray(payload&&payload.results)?payload.results:[]){
      const sponsor=String(application&&application.sponsor_name||"").trim();
      if(!clinicalSponsorMatches(company,sponsor))continue;
      const applicationNumber=String(application&&application.application_number||"").trim(),digits=applicationNumber.replace(/\D/g,"");
      const eventUrl=digits?"https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo="+encodeURIComponent(digits):"https://www.accessdata.fda.gov/scripts/cder/daf/";
      const productNames=[];
      for(const product of Array.isArray(application&&application.products)?application.products:[]){
        const name=String(product&&product.brand_name||"").trim();
        if(name&&!productNames.includes(name))productNames.push(name);
      }
      const productLabel=productNames.slice(0,3).join(", ");
      for(const submission of Array.isArray(application&&application.submissions)?application.submissions:[]){
        const when=fdaSubmissionDate(submission&&submission.submission_status_date);
        if(!when||!Number.isFinite(when.getTime())||when.getTime()<cutoff||when.getTime()>now+86400000)continue;
        const code=String(submission&&submission.submission_status||"").trim().toUpperCase(),status=fdaStatusInfo(code),
          submissionType=String(submission&&submission.submission_type||"").trim().toUpperCase(),
          submissionNumber=String(submission&&submission.submission_number||"").trim(),
          detail=String(submission&&submission.submission_class_code_description||submission&&submission.submission_public_notes||"").trim(),
          ticker=String(stock&&stock.ticker||target&&target.ticker||"").trim().toUpperCase();
        let title="FDA · "+status.label+(productLabel?" · "+productLabel:"");
        let fact=sponsor+" figura como sponsor oficial en Drugs@FDA. La submission "+((submissionType||submissionNumber)?submissionType+submissionNumber:"registrada")+" recibió estado "+(code||"sin código")+" ("+status.label+") el "+when.toISOString().slice(0,10)+".";
        if(detail)fact+=" "+detail.slice(0,320);
        rows.push({
          id:"fda:"+applicationNumber+":"+submissionType+":"+submissionNumber+":"+when.toISOString().slice(0,10),
          eventKind:"news",
          type:"medical",
          ticker,
          name:company,
          exchange:String(stock&&stock.exchange||target&&target.exchange||""),
          date:when.toISOString(),
          title:title.slice(0,240),
          fact:fact.slice(0,800),
          impact:"Una decisión regulatoria de FDA puede alterar materialmente expectativas y volatilidad; el registro no predice la reacción bursátil.",
          impactScore:status.impact,
          verification:"Registro oficial FDA / Drugs@FDA · sponsor validado",
          source:"FDA / Drugs@FDA",
          sourceFamily:"fda",
          official:true,
          sourceCount:1,
          independentSourceCount:0,
          corroborated:false,
          url:eventUrl
        });
      }
    }
    backendOfficialEventCache.set(cacheKey,{at:now,rows});
    return rows;
  }catch(error){
    console.warn("Followed-stock FDA events unavailable",company,String(error&&error.message||error));
    return cached&&cached.rows||[];
  }
}

async function loadAllOfficialEventsForBackend(stock,target,env){
  const [sec,clinical,fda]=await Promise.all([
    loadOfficialEventsForBackend(stock,target,env),
    loadClinicalEventsForBackend(stock,target),
    loadFdaEventsForBackend(stock,target,env)
  ]);
  return [...sec,...clinical,...fda];
}



async function stockEventsLiveResponse(env,request){
  const url=new URL(request.url),ticker=safeStockSymbol(url.searchParams.get("ticker")||""),exchange=String(url.searchParams.get("exchange")||"").trim().toUpperCase();
  if(!ticker)return jsonResponse({error:"ticker is required"},400,{"Cache-Control":"no-store"});
  const snapshot=await loadMarketSnapshotForBackend(env,{targets:[{ticker}]});
  const stock=(snapshot.stocks||[]).find(row=>{
    const rowTicker=String(row&&row.ticker||"").trim().toUpperCase(),trTicker=String(row&&row.trTicker||"").trim().toUpperCase(),rowExchange=String(row&&row.exchange||"").trim().toUpperCase();
    if(ticker!==rowTicker&&ticker!==trTicker)return false;
    return !exchange||!rowExchange||exchange===rowExchange||exchange==="LSX";
  });
  if(!stock)return jsonResponse({error:"Stock not found"},404,{"Cache-Control":"no-store"});
  const target={ticker:stock.ticker||ticker,exchange:stock.exchange||exchange,isin:stock.isin||stock.usIsin||stock.trIsin||"",secCik:stock.secCik||""};
  const [official,news]=await Promise.all([
    loadAllOfficialEventsForBackend(stock,target,env),
    loadNewsForBackend(stock,target)
  ]);
  const merged=[],seen=new Set();
  for(const event of [...official,...news]){
    const key=String(event&&event.id||"")||[event&&event.eventKind,event&&event.title,event&&event.date].join("|");
    if(!event||seen.has(key))continue;
    seen.add(key);merged.push(event);
  }
  merged.sort((a,b)=>new Date(b&&b.date||0)-new Date(a&&a.date||0));
  return jsonResponse({events:merged.slice(0,24),ticker:stock.ticker||ticker,updatedAt:new Date().toISOString()},200,{"Cache-Control":"private, max-age=30"});
}

let publicMarketCache={social:{at:0,value:null},indices:{at:0,value:null}};
async function socialTrendingResponse(){
  const cached=publicMarketCache.social;
  if(cached.value&&Date.now()-cached.at<300000)return jsonResponse(cached.value,200,{"Cache-Control":"public, max-age=120"});
  try{
    const r=await fetch("https://api.stocktwits.com/api/2/trending/symbols.json",{headers:{"User-Agent":"ViewInvAI/1.0","Accept":"application/json"}});
    if(!r.ok)throw Error("Stocktwits "+r.status);
    const data=await r.json(),raw=Array.isArray(data&&data.symbols)?data.symbols:[];
    const symbols=raw.slice(0,30).map((x,i)=>({
      symbol:String(x&&x.symbol||x&&x.symbol_obj&&x.symbol_obj.symbol||"").toUpperCase(),
      rank:i+1,
      title:String(x&&x.title||x&&x.symbol_obj&&x.symbol_obj.title||"")
    })).filter(x=>x.symbol);
    const payload={symbols,source:"Stocktwits trending",updatedAt:new Date().toISOString()};
    publicMarketCache.social={at:Date.now(),value:payload};
    return jsonResponse(payload,200,{"Cache-Control":"public, max-age=120"});
  }catch(error){
    return jsonResponse({symbols:[],source:"unavailable",updatedAt:new Date().toISOString()},200,{"Cache-Control":"public, max-age=60"});
  }
}
async function indicesLiveResponse(){
  const cached=publicMarketCache.indices;
  if(cached.value&&Date.now()-cached.at<60000)return jsonResponse(cached.value,200,{"Cache-Control":"public, max-age=30"});
  const tickers=["SP:SPX","NASDAQ:NDX","DJ:DJI","NASDAQ:IXIC","TVC:RUT","TVC:VIX","XETR:DAX","TVC:CAC40","TVC:UKX","TVC:NI225"];
  try{
    const r=await fetch("https://scanner.tradingview.com/global/scan",{
      method:"POST",
      headers:{"Content-Type":"application/json","User-Agent":"Mozilla/5.0"},
      body:JSON.stringify({symbols:{tickers,query:{types:[]}},columns:["name","description","close","change","currency","exchange"]})
    });
    if(!r.ok)throw Error("TradingView "+r.status);
    const data=await r.json();
    const indices=(Array.isArray(data&&data.data)?data.data:[]).map(row=>{
      const d=row.d||[],s=String(row.s||"");
      return{
        symbol:d[0]||s.split(":").pop(),
        name:d[1]||d[0]||s,
        price:Number.isFinite(Number(d[2]))?Number(d[2]):null,
        change:Number.isFinite(Number(d[3]))?Number(d[3]):null,
        currency:d[4]||"",
        exchange:d[5]||s.split(":")[0]||""
      };
    }).filter(x=>x.symbol);
    const payload={indices,source:"TradingView",updatedAt:new Date().toISOString()};
    publicMarketCache.indices={at:Date.now(),value:payload};
    return jsonResponse(payload,200,{"Cache-Control":"public, max-age=30"});
  }catch(error){
    return jsonResponse({indices:[],source:"unavailable",updatedAt:new Date().toISOString()},200,{"Cache-Control":"public, max-age=30"});
  }
}


// ----- Mercado en vivo para todo el universo -----
// One TradingView scan per minute (shared by every user through the Cache API) with
// the fast-moving fields of all ~6.100 US stocks. The app overlays it on the 30-min
// snapshot, so lists, rankings, Radar and catalogues use live price/volume; the
// scheduled backend uses the same overlay for alerts.
const DIGEST_CRON="*/5 * * * *";
const MARKET_LIVE_FIELDS=["price","changePct","dayHigh","dayLow","volume","relVolume","avgVolume","premarketPrice","premarketChangePct","premarketVolume","premarketTime","postmarketPrice","postmarketChangePct","postmarketVolume","postmarketTime"];
const MARKET_LIVE_COLUMNS=["close","change","high","low","volume","relative_volume_10d_calc","average_volume_10d_calc","premarket_close","premarket_change","premarket_volume","premarket_time","postmarket_close","postmarket_change","postmarket_volume","postmarket_time"];
const MARKET_LIVE_TTL=55000;
function marketLiveRound(field,value){
  const n=Number(value);
  if(value===null||value===undefined||!Number.isFinite(n))return null;
  if(/Volume$|Time$/.test(field))return Math.round(n);
  if(/ChangePct$|changePct|relVolume/.test(field))return Math.round(n*1000)/1000;
  return Number(n.toPrecision(7));
}
async function fetchMarketLiveFromSource(){
  const body={
    filter:[
      {left:"type",operation:"in_range",right:["stock","dr"]},
      {left:"exchange",operation:"in_range",right:["NASDAQ","NYSE","AMEX","NYSE ARCA","NYSEARCA"]}
    ],
    options:{lang:"en"},markets:["america"],symbols:{query:{types:[]},tickers:[]},
    columns:MARKET_LIVE_COLUMNS,sort:{sortBy:"name",sortOrder:"asc"},range:[0,10000]
  };
  const r=await fetch("https://scanner.tradingview.com/america/scan",{method:"POST",headers:{"Content-Type":"application/json","User-Agent":"Mozilla/5.0","Origin":"https://www.tradingview.com"},body:JSON.stringify(body)});
  if(!r.ok)throw new Error("TradingView "+r.status);
  const data=await r.json();
  const rows=[];
  for(const row of Array.isArray(data&&data.data)?data.data:[]){
    const sym=String(row&&row.s||"");if(!sym)continue;
    const d=Array.isArray(row.d)?row.d:[];
    rows.push([sym,...MARKET_LIVE_FIELDS.map((f,i)=>marketLiveRound(f,d[i]))]);
  }
  if(rows.length<1000)throw new Error("TradingView devolvió "+rows.length+" filas");
  return{fields:MARKET_LIVE_FIELDS,rows,updatedAt:new Date().toISOString(),source:"TradingView"};
}
// The payload is kept as text: /api/market-live returns those bytes untouched and only the
// scheduled backend parses it (lazily, once per isolate and minute). If MARKET_LIVE_URL is
// set (Netlify function), the TradingView scan and compaction run there instead of here.
let marketLiveText={at:0,text:null,pending:null};
// Outside 04:00-20:00 New York on weekdays prices barely move: refresh every 15 min.
function marketLiveTtl(ms=Date.now()){
  const p=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date(ms)).map(x=>[x.type,x.value]));
  const minuteOfDay=(Number(p.hour)%24)*60+Number(p.minute);
  return !["Sat","Sun"].includes(p.weekday)&&minuteOfDay>=240&&minuteOfDay<1200?MARKET_LIVE_TTL:15*60000;
}
async function fetchMarketLiveText(env){
  const url=env&&env.MARKET_LIVE_URL;
  if(url){
    try{
      const headers={"Accept":"application/json"};
      if(env.MARKET_SERVER_KEY)headers["X-ViewInvAI-Key"]=env.MARKET_SERVER_KEY;
      const r=await fetch(url,{headers});
      const at=Date.parse(r.headers.get("X-Updated-At")||"");
      if(r.ok&&Number.isFinite(at))return{at,text:await r.text()};
      console.warn("Market live remote",r.status);
    }catch(error){console.warn("Market live remote failed",String(error&&error.message||error))}
  }
  const value=await fetchMarketLiveFromSource();
  return{at:Date.parse(value.updatedAt),text:JSON.stringify(value)};
}
async function marketLiveRaw(env){
  const ttl=marketLiveTtl();
  if(marketLiveText.text&&Date.now()-marketLiveText.at<ttl)return marketLiveText;
  if(marketLiveText.pending)return marketLiveText.pending;
  marketLiveText.pending=(async()=>{
    const cacheKey=new Request("https://viewinvai.internal/market-live/v2");
    try{
      const cache=caches.default,hit=await cache.match(cacheKey);
      if(hit){
        const at=Date.parse(hit.headers.get("X-Updated-At")||"");
        if(Number.isFinite(at)&&Date.now()-at<ttl){
          marketLiveText={at,text:await hit.text(),pending:null};
          return marketLiveText;
        }
      }
      const fresh=await fetchMarketLiveText(env);
      await cache.put(cacheKey,new Response(fresh.text,{headers:{"Content-Type":"application/json","Cache-Control":"max-age="+Math.ceil(ttl/1000+5),"X-Updated-At":new Date(fresh.at).toISOString()}}));
      marketLiveText={...fresh,pending:null};
      return marketLiveText;
    }catch(error){
      marketLiveText.pending=null;
      if(marketLiveText.text)return marketLiveText;
      throw error;
    }
  })();
  return marketLiveText.pending;
}
let marketLiveMemo={at:0,value:null};
async function marketLivePayload(env){
  const raw=await marketLiveRaw(env);
  if(marketLiveMemo.value&&marketLiveMemo.at===raw.at)return marketLiveMemo.value;
  marketLiveMemo={at:raw.at,value:JSON.parse(raw.text)};
  return marketLiveMemo.value;
}
function overlayMarketLive(snapshot,live){
  if(!snapshot||!Array.isArray(snapshot.stocks)||!live||!Array.isArray(live.rows))return snapshot;
  const by=new Map(snapshot.stocks.map(s=>[String(s.tvSymbol||((s.exchange||"")+":"+(s.ticker||""))),s]));
  const fields=live.fields||MARKET_LIVE_FIELDS;
  for(const row of live.rows){
    const s=by.get(row[0]);if(!s)continue;
    fields.forEach((f,i)=>{const v=row[i+1];if(v!==null&&v!==undefined)s[f]=v});
  }
  snapshot.meta=Object.assign({},snapshot.meta||{},{liveUpdatedAt:live.updatedAt});
  return snapshot;
}
let radarScoreboardMemo={at:0,value:null};
// v2 y con caducidad: la clave anterior se guardaba sin fecha de caducidad y el marcador se
// quedaba congelado en el primer resumen calculado.
const RADAR_SCOREBOARD_KV_KEY="radar:scoreboard:summary:v2";
async function radarScoreboardResponse(env){
  try{
    if(!radarScoreboardMemo.value||Date.now()-radarScoreboardMemo.at>10*60000){
      let value=null;
      if(env.HOT_STATE_KV){
        try{value=await env.HOT_STATE_KV.get(RADAR_SCOREBOARD_KV_KEY,"json")}
        catch(error){console.warn("Radar scoreboard KV read fallback",String(error&&error.message||error))}
      }
      if(!value){
        value=await radarScoreboardSummary(env);
        if(env.HOT_STATE_KV){
          try{await env.HOT_STATE_KV.put(RADAR_SCOREBOARD_KV_KEY,JSON.stringify(value),{expirationTtl:1800})}
          catch(error){console.warn("Radar scoreboard KV warm failed",String(error&&error.message||error))}
        }
      }
      radarScoreboardMemo={at:Date.now(),value};
    }
    return jsonResponse(radarScoreboardMemo.value,200,{"Cache-Control":"public, max-age=300"});
  }catch(error){
    console.warn("Radar scoreboard unavailable",String(error&&error.message||error));
    return jsonResponse({error:"Marcador no disponible"},503,{"Cache-Control":"no-store"});
  }
}
async function marketLiveResponse(env){
  try{
    const raw=await marketLiveRaw(env);
    const headers=applySecurityHeaders(new Headers({"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=20"}));
    return new Response(raw.text,{status:200,headers});
  }catch(error){
    return jsonResponse({error:"Mercado en vivo no disponible",fields:MARKET_LIVE_FIELDS,rows:[],updatedAt:null},503,{"Cache-Control":"no-store"});
  }
}

let attentionSchemaReady=false;
async function ensureAttentionSchema(env){
  if(attentionSchemaReady)return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS public_attention_rankings ("+
    "kind TEXT PRIMARY KEY,payload_json TEXT NOT NULL,updated_at TEXT NOT NULL)"
  ).run();
  attentionSchemaReady=true;
}
async function loadFundsSnapshotForRanking(env){
  let response=await r2MarketAssetResponse(env,"/data/funds.json");
  if(!response)response=await env.ASSETS.fetch(new Request("https://viewinvai.local/data/funds.json"));
  if(!response.ok)throw new Error("Funds snapshot unavailable");
  const data=await response.json();
  return data&&Array.isArray(data.products)?data:{products:[],meta:{}};
}
const ATTENTION_KV_PREFIX="attention:";
const ATTENTION_R2_PREFIX="state/attention/";
async function readAttentionRanking(env,kind){
  if(env.HOT_STATE_KV){
    try{
      const payload=await env.HOT_STATE_KV.get(ATTENTION_KV_PREFIX+kind,"json");
      if(payload&&typeof payload==="object")return payload;
    }catch(error){console.warn("Attention KV read fallback",kind,String(error&&error.message||error))}
  }
  const key=ATTENTION_R2_PREFIX+kind+".json";
  if(env.MARKET_DATA_BUCKET){
    try{
      const object=await env.MARKET_DATA_BUCKET.get(key);
      if(object){
        const payload=JSON.parse(await object.text());
        if(payload&&typeof payload==="object")return payload;
      }
    }catch(error){console.warn("Attention R2 read fallback",kind,String(error&&error.message||error))}
  }
  await ensureAttentionSchema(env);
  const row=await env.DB.prepare("SELECT payload_json,updated_at FROM public_attention_rankings WHERE kind=?").bind(kind).first();
  if(!row)return null;
  try{
    const payload=JSON.parse(row.payload_json||"{}");
    payload.updatedAt=payload.updatedAt||row.updated_at;
    return payload;
  }catch(_){return null}
}
async function writeAttentionRanking(env,kind,payload){
  const now=new Date().toISOString(),value={...payload,kind,updatedAt:now},json=JSON.stringify(value);
  if(env.HOT_STATE_KV){
    try{
      await env.HOT_STATE_KV.put(ATTENTION_KV_PREFIX+kind,json);
      return value;
    }catch(error){console.warn("Attention KV write fallback",kind,String(error&&error.message||error))}
  }
  if(env.MARKET_DATA_BUCKET){
    try{
      await env.MARKET_DATA_BUCKET.put(ATTENTION_R2_PREFIX+kind+".json",json,{
        httpMetadata:{contentType:"application/json; charset=utf-8"},
        customMetadata:{updatedAt:now,kind}
      });
      return value;
    }catch(error){console.warn("Attention R2 write fallback",kind,String(error&&error.message||error))}
  }
  await ensureAttentionSchema(env);
  await env.DB.prepare(
    "INSERT INTO public_attention_rankings (kind,payload_json,updated_at) VALUES (?,?,?) "+
    "ON CONFLICT(kind) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at"
  ).bind(kind,json,now).run();
  return value;
}
function textNewsCount(xml){
  const m=String(xml||"").match(/<item\b/gi);
  return m?m.length:0;
}
async function googleNewsCount(query){
  try{
    const url="https://news.google.com/rss/search?q="+encodeURIComponent(query+" when:1d")+"&hl=en-US&gl=US&ceid=US:en";
    const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 ViewInvAI/1.0"}});
    if(!r.ok)return 0;
    return Math.min(100,textNewsCount(await r.text()));
  }catch(_){return 0}
}
async function fetchStocktwitsTrend(){
  try{
    const r=await fetch("https://api.stocktwits.com/api/2/trending/symbols.json",{headers:{"User-Agent":"ViewInvAI/1.0","Accept":"application/json"}});
    if(!r.ok)return[];
    const data=await r.json(),raw=Array.isArray(data&&data.symbols)?data.symbols:[];
    return raw.map((x,i)=>({symbol:String(x&&x.symbol||x&&x.symbol_obj&&x.symbol_obj.symbol||"").toUpperCase(),rank:i+1})).filter(x=>x.symbol);
  }catch(_){return[]}
}
async function fetchYahooTrending(){
  try{
    const r=await fetch("https://query1.finance.yahoo.com/v1/finance/trending/US?count=40",{headers:{"User-Agent":"Mozilla/5.0 ViewInvAI/1.0","Accept":"application/json"}});
    if(!r.ok)return[];
    const data=await r.json(),quotes=data&&data.finance&&data.finance.result&&data.finance.result[0]&&data.finance.result[0].quotes;
    return (Array.isArray(quotes)?quotes:[]).map((x,i)=>({symbol:String(x&&x.symbol||"").toUpperCase(),rank:i+1})).filter(x=>x.symbol);
  }catch(_){return[]}
}
async function buildStockAttentionRanking(env){
  const snapshot=await loadMarketSnapshotForBackend(env,{universe:["attention"]});
  let items=snapshot.universe&&Array.isArray(snapshot.universe.attention)?snapshot.universe.attention:null;
  if(!items){
    const [st,yh]=await Promise.all([fetchStocktwitsTrend(),fetchYahooTrending()]);
    items=stockAttentionRows(snapshot,st,yh);
  }
  return writeAttentionRanking(env,"stocks",{items,sources:["Stocktwits Trending","Yahoo Finance Trending","ViewInvAI verified news","TradingView market activity"]});
}
async function buildFundAttentionRanking(env){
  // The market server ranks the 4,9 MB funds file; locally only as a fallback.
  let candidates=null;
  if(env.MARKET_SERVER_URL){
    try{const snap=await loadMarketSnapshotForBackend(env,{universe:["funds"]});candidates=snap.universe&&Array.isArray(snap.universe.funds)?snap.universe.funds:null}
    catch(_){candidates=null}
  }
  if(!candidates)candidates=fundAttentionCandidates(await loadFundsSnapshotForRanking(env));
  const counts=await Promise.all(candidates.map(x=>googleNewsCount('"'+String(x.p.name||"").slice(0,90)+'" ETF fund')));
  const rows=candidates.map((x,i)=>({isin:String(x.p.isin||"").toUpperCase(),name:x.p.name||x.p.isin,
    score:Math.round((x.base+Math.min(30,counts[i]*1.5))*100)/100,signals:{news24h:counts[i],aum:Number(x.p.assetsUnderManagement)||null}}))
    .sort((a,b)=>b.score-a.score).slice(0,10);
  return writeAttentionRanking(env,"funds",{items:rows,sources:["Google News RSS","Fund AUM","Trade Republic availability","MyInvestor availability"]});
}
const INDEX_ATTENTION=[
 ["SPX","S&P 500"],["NDX","Nasdaq 100"],["DJI","Dow Jones"],["IXIC","Nasdaq Composite"],["RUT","Russell 2000"],
 ["VIX","VIX"],["DAX","DAX"],["CAC40","CAC 40"],["UKX","FTSE 100"],["NI225","Nikkei 225"]
];
async function buildIndexAttentionRanking(env){
  const counts=await Promise.all(INDEX_ATTENTION.map(x=>googleNewsCount('"'+x[1]+'" index market')));
  const rows=INDEX_ATTENTION.map((x,i)=>({symbol:x[0],name:x[1],score:counts[i],signals:{news24h:counts[i]}}))
    .sort((a,b)=>b.score-a.score).slice(0,10);
  return writeAttentionRanking(env,"indices",{items:rows,sources:["Google News RSS"]});
}
async function refreshAttentionRankings(env,{force=false}={}){
  const now=Date.now();
  const stock=await readAttentionRanking(env,"stocks"),funds=await readAttentionRanking(env,"funds"),indices=await readAttentionRanking(env,"indices");
  const age=x=>x&&x.updatedAt?now-new Date(x.updatedAt).getTime():Infinity;
  const jobs=[];
  if(force||age(stock)>30*60000)jobs.push(buildStockAttentionRanking(env));
  if(force||age(funds)>24*3600000)jobs.push(buildFundAttentionRanking(env));
  if(force||age(indices)>12*3600000)jobs.push(buildIndexAttentionRanking(env));
  return Promise.allSettled(jobs);
}
async function attentionRankingResponse(env,request){
  const url=new URL(request.url),kind=String(url.searchParams.get("kind")||"stocks").toLowerCase();
  if(!["stocks","funds","indices"].includes(kind))return jsonResponse({error:"Invalid ranking kind"},400);
  const payload=await readAttentionRanking(env,kind);
  // The app never performs the ranking work on open. Rankings are generated by
  // the scheduled backend job and this endpoint only serves the latest snapshot.
  if(!payload)return jsonResponse({kind,items:[],pending:true,updatedAt:null},200,{"Cache-Control":"public, max-age=60"});
  return jsonResponse(payload,200,{"Cache-Control":kind==="stocks"?"public, max-age=300":"public, max-age=1800"});
}

// ----- Contraste de precios de acciones con fuentes independientes -----
// EE. UU.: precio de la sesión regular en Nasdaq y Yahoo Finance (la app añade TradingView).
// LSX: el precio lo forma LS Exchange (Trade Republic solo lo transmite) y, como referencia, el de la misma acción en euros en
// otras bolsas alemanas (Xetra, Fráncfort, Stuttgart) vía Yahoo. Nunca se convierte desde USD.
const YAHOO_HEADERS={"User-Agent":"Mozilla/5.0 (compatible; ViewInvAI/1.0)","Accept":"application/json"};
const priceCheckMemo=new Map();
function memoPriceCheck(key,ttl,loader){
  const hit=priceCheckMemo.get(key);
  if(hit&&Date.now()-hit.at<ttl)return hit.pending;
  const pending=loader().catch(error=>{priceCheckMemo.delete(key);throw error});
  priceCheckMemo.set(key,{at:Date.now(),pending});
  if(priceCheckMemo.size>400)for(const [k,v] of priceCheckMemo)if(Date.now()-v.at>ttl*4)priceCheckMemo.delete(k);
  return pending;
}
async function yahooRegular(symbol){
  return memoPriceCheck("y:"+symbol,30000,async()=>{
    const r=await fetch("https://query1.finance.yahoo.com/v8/finance/chart/"+encodeURIComponent(symbol)+"?interval=1d&range=5d",{headers:YAHOO_HEADERS,signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw new Error("Yahoo "+r.status);
    const m=(await r.json())?.chart?.result?.[0]?.meta||{};
    const price=parseMarketNumber(m.regularMarketPrice);
    if(!(price>0))throw new Error("Yahoo sin precio");
    return{price,currency:String(m.currency||"").toUpperCase(),exchange:String(m.fullExchangeName||m.exchangeName||""),time:Number(m.regularMarketTime)?new Date(Number(m.regularMarketTime)*1000).toISOString():null,state:String(m.marketState||"")};
  });
}
// Bolsas alemanas en euros que publica Yahoo (Xetra, Fráncfort, Stuttgart, Múnich, Berlín, Düsseldorf).
const YAHOO_DE_RANK={".DE":1,".F":2,".SG":3,".MU":4,".BE":5,".DU":6};
async function yahooSearchSymbols(q){
  const r=await fetch("https://query2.finance.yahoo.com/v1/finance/search?q="+encodeURIComponent(q)+"&quotesCount=20&newsCount=0&enableFuzzyQuery=false",{headers:YAHOO_HEADERS,signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw new Error("Yahoo search "+r.status);
  return ((await r.json())?.quotes||[]).map(x=>String(x&&x.symbol||"")).filter(Boolean);
}
async function yahooEuropeanListings(isin,name=""){
  return memoPriceCheck("ys:"+isin,6*3600000,async()=>{
    // Por ISIN y, si Yahoo no devuelve bolsas alemanas, por nombre de la empresa.
    let all=await yahooSearchSymbols(isin);
    const german=list=>list.filter(sym=>Object.keys(YAHOO_DE_RANK).some(sfx=>sym.endsWith(sfx)));
    if(!german(all).length&&name)all=all.concat(await yahooSearchSymbols(name).catch(()=>[]));
    const picked=[...new Set(german(all))].sort((a,b)=>YAHOO_DE_RANK[a.slice(a.lastIndexOf("."))]-YAHOO_DE_RANK[b.slice(b.lastIndexOf("."))]).slice(0,2);
    return{picked,seen:[...new Set(all)].slice(0,12)};
  });
}
async function stockPriceCheck(request){
  const url=new URL(request.url),market=url.searchParams.get("market")==="tr"?"tr":"us";
  const rows=[];
  if(market==="us"){
    const ticker=safeStockSymbol(url.searchParams.get("ticker")||"");
    if(!ticker)return jsonResponse({error:"Ticker no válido"},400);
    const [nasdaq,yahoo]=await Promise.allSettled([fetchNasdaqQuote(ticker),yahooRegular(ticker.replace(/\./g,"-"))]);
    if(nasdaq.status==="fulfilled"&&nasdaq.value){
      const q=nasdaq.value,extended=/pre|after|post/i.test(String(q.marketStatus||""));
      // En pre/posmercado el precio principal de Nasdaq es el de esa sesión: se usa el cierre regular.
      const price=extended&&q.secondary&&q.secondary.price>0?q.secondary.price:q.price;
      if(price>0)rows.push({source:"Nasdaq",venue:"Nasdaq / NYSE",price,currency:"USD",note:extended?"cierre regular":""});
    }
    if(yahoo.status==="fulfilled"&&yahoo.value.currency==="USD")rows.push({source:"Yahoo Finance",venue:yahoo.value.exchange,price:yahoo.value.price,currency:"USD",time:yahoo.value.time});
    return jsonResponse({market,ticker,rows,errors:[nasdaq,yahoo].filter(x=>x.status==="rejected").map(x=>String(x.reason&&x.reason.message||x.reason).slice(0,80)),checkedAt:new Date().toISOString()},200,{"Cache-Control":"no-store"});
  }
  const isin=String(url.searchParams.get("isin")||"").trim().toUpperCase();
  if(!/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin))return jsonResponse({error:"ISIN no válido"},400);
  const name=String(url.searchParams.get("name")||"").replace(/[^\p{L}\p{N} .&-]/gu,"").trim().slice(0,60);
  const [lsx,listings]=await Promise.allSettled([fetchTradeRepublicTicker(isin,"LSX"),yahooEuropeanListings(isin,name)]);
  if(lsx.status==="fulfilled"&&lsx.value&&lsx.value.price>0)rows.push({source:"LS Exchange (LSX)",venue:"precio de la bolsa, recibido vía Trade Republic",price:lsx.value.price,currency:"EUR",primary:true});
  const syms=listings.status==="fulfilled"?listings.value.picked:[];
  const venues=await Promise.allSettled(syms.map(sym=>yahooRegular(sym)));
  venues.forEach((v,i)=>{if(v.status==="fulfilled"&&v.value.currency==="EUR")rows.push({source:"Yahoo Finance",venue:v.value.exchange||syms[i],price:v.value.price,currency:"EUR",time:v.value.time,reference:true})});
  return jsonResponse({market,isin,rows,searched:listings.status==="fulfilled"?listings.value.seen:[],errors:[lsx,listings,...venues].filter(x=>x.status==="rejected").map(x=>String(x.reason&&x.reason.message||x.reason).slice(0,80)),checkedAt:new Date().toISOString()},200,{"Cache-Control":"no-store"});
}

// Every root routed by handleBackendApi (backend.js). Keep both lists in sync: a root
// missing here falls through to the static assets and answers 404.
const BACKEND_API_ROOTS = new Set([
  "me", "portfolios", "brokers", "positions", "transactions", "broker-sync", "tax-report", "dividends", "backup",
  "fund-portfolios", "fund-positions", "fund-transactions", "fund-plans", "fund-catalog-extra", "watchlist",
  "analysis", "ai", "alerts", "position-decisions", "event-insight", "admin", "goal-ideas", "radar-check", "translate", "notification-preferences", "portfolio-goal",
  "portfolio-goal-history", "portfolio-performance", "settings", "ui-preferences", "devices", "crypto-positions"
]);
function isBackendApiPath(pathname) {
  if (pathname === "/api/backend/status") return true;
  const parts = String(pathname || "").split("/");
  return parts[1] === "api" && BACKEND_API_ROOTS.has(parts[2] || "");
}

// Los datos de mercado se generan en el repositorio privado viewinvai/data (minutos de Actions propios).
const MARKET_WORKFLOW_URL="https://api.github.com/repos/viewinvai/data/actions/workflows/market.yml/dispatches";
// Session-aware schedule (New York time, so daylight saving is handled):
//   regular session 09:30-16:00 ET  -> every `base` minutes (MARKET_DISPATCH_MINUTES)
//   pre/post-market 04:00-09:30 and 16:00-20:00 ET -> every max(30, 3×base)
//   nights and weekends -> every 3 h
// With base=10 that is ~55 runs per weekday; with base=30 (private repo, 2000 Actions
// minutes/month) ~22, which leaves room for CI and APK builds.
function shouldDispatchMarketUpdate(ms,base=10){
  const step=[5,10,15,20,30,60].includes(base)?base:10;
  const p=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date(ms)).map(x=>[x.type,x.value]));
  const minuteOfDay=(Number(p.hour)%24)*60+Number(p.minute),weekday=!["Sat","Sun"].includes(p.weekday);
  const sinceMidnight=Math.floor(ms/60000);
  const every=n=>sinceMidnight%n===2;
  if(weekday&&minuteOfDay>=570&&minuteOfDay<960)return every(step);
  if(weekday&&minuteOfDay>=240&&minuteOfDay<1200)return every(Math.max(30,step*3));
  return every(180);
}
async function dispatchMarketUpdate(env){
  const res=await fetch(MARKET_WORKFLOW_URL,{method:"POST",signal:AbortSignal.timeout(8000),headers:{
    "Authorization":"Bearer "+env.GITHUB_DISPATCH_TOKEN,"Accept":"application/vnd.github+json",
    "X-GitHub-Api-Version":"2022-11-28","User-Agent":"ViewInvAI-worker","Content-Type":"application/json"
  },body:JSON.stringify({ref:"main"})});
  if(!res.ok&&res.status!==204)throw new Error("GitHub dispatch "+res.status);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // La página principal y los dos módulos (auth.js, portfolio.js) pasan por el Worker
    // (run_worker_first) solo para que la APK (origen https://localhost) pueda cargarlos desde
    // aquí: fetch y <script type="module"> exigen CORS. Sin ese origen se sirven tal cual.
    // Las fuentes del diseño se piden en modo CORS: la APK (origen https://localhost) las necesita con permiso.
    if ((NATIVE_LIVE_SHELL_PATHS.has(url.pathname) || url.pathname.startsWith("/fonts/")) && request.method === "GET") {
      const page = await env.ASSETS.fetch(request);
      return trustedNativeOrigin(request) ? nativeCorsResponse(request, page) : page;
    }

    if (request.method === "OPTIONS") {
      const preflight = nativePreflightResponse(request);
      if (preflight) return preflight;
    }

    if (url.pathname === "/api/internal/market-publish") {
      return publishMarketToR2(request, env);
    }

    let limited=null;
    if(url.pathname==="/api/ai/chat"||url.pathname==="/api/ai/ask")limited=await enforcedRateLimit(request,env,"ai-chat",20,60000,"AI_RATE_LIMITER");
    else if(url.pathname==="/api/event-insight")limited=await enforcedRateLimit(request,env,"event-insight",20,60000,"AI_RATE_LIMITER");
    else if(url.pathname==="/api/goal-ideas")limited=await enforcedRateLimit(request,env,"goal-ideas",10,60000,"AI_RATE_LIMITER");
    else if(url.pathname==="/api/radar-check")limited=await enforcedRateLimit(request,env,"radar-check",10,60000,"AI_RATE_LIMITER");
    else if(url.pathname==="/api/ai/contrast"&&request.method==="POST")limited=await enforcedRateLimit(request,env,"ai-contrast",10,60000,"AI_RATE_LIMITER");
    else if(url.pathname==="/api/translate")limited=await enforcedRateLimit(request,env,"translate",20,60000,"AI_RATE_LIMITER");
    else if(url.pathname==="/api/us-live")limited=await enforcedRateLimit(request,env,"us-live",90,60000,"MARKET_RATE_LIMITER");
    else if(url.pathname==="/api/price-check")limited=await enforcedRateLimit(request,env,"price-check",40,60000,"MARKET_RATE_LIMITER");
    else if(url.pathname.startsWith("/api/crypto/"))limited=await enforcedRateLimit(request,env,"crypto",90,60000,"MARKET_RATE_LIMITER");
    else if(url.pathname==="/api/radar-scoreboard")limited=await enforcedRateLimit(request,env,"radar-scoreboard",20,60000,"MARKET_RATE_LIMITER");
    else if(url.pathname==="/api/market-live")limited=await enforcedRateLimit(request,env,"market-live",12,60000,"MARKET_RATE_LIMITER");
    else if(url.pathname==="/api/us-chart"||url.pathname==="/api/tr-history")limited=await enforcedRateLimit(request,env,"chart",60,60000,"MARKET_RATE_LIMITER");
    else if(url.pathname==="/api/fund-search")limited=await enforcedRateLimit(request,env,"fund-search",30,60000,"MARKET_RATE_LIMITER");
    else if(url.pathname==="/api/fx-live")limited=await enforcedRateLimit(request,env,"fx",60,60000,"MARKET_RATE_LIMITER");
    else if(url.pathname==="/api/tr-health")limited=await enforcedRateLimit(request,env,"tr-health",20,60000,"MARKET_RATE_LIMITER");
    else if(url.pathname==="/api/tr-live")limited=await enforcedRateLimit(request,env,"tr-live",30,60000,"MARKET_RATE_LIMITER");
    else if(url.pathname==="/api/stock-events-live")limited=await enforcedRateLimit(request,env,"stock-events-live",60,60000,"MARKET_RATE_LIMITER");
    else if(isBackendApiPath(url.pathname))limited=await enforcedRateLimit(request,env,"backend",180,60000,"API_RATE_LIMITER");
    if(limited)return nativeCorsResponse(request, limited);

    if (isBackendApiPath(url.pathname)) {
      return nativeCorsResponse(request, await handleBackendApi(request, env, {
        jsonResponse,
        loadMarketSnapshot: loadMarketSnapshotForBackend,
        loadChart: loadChartForBackend,
        loadQuote: loadQuoteForBackend,
        loadNews: loadNewsForBackend,
        loadOfficialEvents: (stock,target) => loadAllOfficialEventsForBackend(stock,target,env),
        loadDailyHistory: loadDailyHistoryForBackend,
        loadCryptoQuotes: symbols => cryptoQuotes(symbols, { env })
      }));
    }
    if (url.pathname === "/api/attention-ranking") {
      const guard = requestGuard(request); if (guard) return guard;
      return nativeCorsResponse(request, await attentionRankingResponse(env,request));
    }
    if (url.pathname === "/api/social-trending") {
      const guard = requestGuard(request); if (guard) return guard;
      return nativeCorsResponse(request, await socialTrendingResponse());
    }
    if (url.pathname === "/api/radar-scoreboard") {
      const guard = requestGuard(request); if (guard) return guard;
      return nativeCorsResponse(request, await radarScoreboardResponse(env));
    }
    if (url.pathname === "/api/market-dispatch-status") {
      const guard = requestGuard(request); if (guard) return guard;
      let last = null;
      try { last = env.HOT_STATE_KV ? await env.HOT_STATE_KV.get("market:dispatch:last", "json") : null; } catch {}
      return jsonResponse({ configured: !!env.GITHUB_DISPATCH_TOKEN, last }, 200, { "Cache-Control": "no-store" });
    }
    if (url.pathname === "/api/market-live") {
      const guard = requestGuard(request); if (guard) return guard;
      return nativeCorsResponse(request, await marketLiveResponse(env));
    }
    if (url.pathname === "/api/indices-live") {
      const guard = requestGuard(request); if (guard) return guard;
      return nativeCorsResponse(request, await indicesLiveResponse());
    }
    if (url.pathname === "/api/tr-live") {
      return proxyTradeRepublic(request);
    }
    if (url.pathname === "/api/tr-health") {
      const guard = requestGuard(request); if (guard) return guard;
      return nativeCorsResponse(request, await tradeRepublicHealthResponse());
    }
    if (url.pathname === "/api/price-check") {
      const guard = requestGuard(request); if (guard) return guard;
      try { return nativeCorsResponse(request, await stockPriceCheck(request)); }
      catch (error) { return nativeCorsResponse(request, jsonResponse({ error: "Contraste no disponible" }, 502, { "Cache-Control": "no-store" })); }
    }
    if (url.pathname === "/api/crypto/catalog") {
      const guard = requestGuard(request); if (guard) return guard;
      try { return nativeCorsResponse(request, jsonResponse({ assets: await cryptoCatalog(env) }, 200, { "Cache-Control": "public, max-age=900" })); }
      catch (error) { return nativeCorsResponse(request, jsonResponse({ error: "Catálogo cripto no disponible" }, 502, { "Cache-Control": "no-store" })); }
    }
    if (url.pathname === "/api/crypto/quotes") {
      const guard = requestGuard(request); if (guard) return guard;
      const symbols = String(url.searchParams.get("symbols") || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 80);
      try { return nativeCorsResponse(request, jsonResponse(await cryptoQuotes(symbols, { env, detail: url.searchParams.get("detail") === "1" && symbols.length <= 3 }), 200, { "Cache-Control": "no-store" })); }
      catch (error) { return nativeCorsResponse(request, jsonResponse({ error: "Cotizaciones cripto no disponibles" }, 502, { "Cache-Control": "no-store" })); }
    }
    if (url.pathname === "/api/crypto/chart") {
      const guard = requestGuard(request); if (guard) return guard;
      try { return nativeCorsResponse(request, jsonResponse(await cryptoChart(url.searchParams.get("symbol"), Number(url.searchParams.get("days")) || 30, env), 200, { "Cache-Control": "public, max-age=300" })); }
      catch (error) { return nativeCorsResponse(request, jsonResponse({ error: "Gráfico no disponible" }, 502, { "Cache-Control": "no-store" })); }
    }
    // Binance Alpha: solo consulta (Binance no opera con residentes en España desde julio de 2026).
    if (url.pathname === "/api/crypto/alpha") {
      const guard = requestGuard(request); if (guard) return guard;
      const ids = String(url.searchParams.get("ids") || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 3);
      try { return nativeCorsResponse(request, jsonResponse(await alphaTokens({ env, ids: ids.length ? ids : null }), 200, { "Cache-Control": "no-store" })); }
      catch (error) { return nativeCorsResponse(request, jsonResponse({ error: "Binance Alpha no disponible: " + String(error && error.message || error).slice(0, 80) }, 502, { "Cache-Control": "no-store" })); }
    }
    if (url.pathname === "/api/crypto/alpha/chart") {
      const guard = requestGuard(request); if (guard) return guard;
      try { return nativeCorsResponse(request, jsonResponse(await alphaChart(url.searchParams.get("id"), Number(url.searchParams.get("days")) || 7, env), 200, { "Cache-Control": "public, max-age=300" })); }
      catch (error) { return nativeCorsResponse(request, jsonResponse({ error: "Gráfico no disponible: " + String(error && error.message || error).slice(0, 80) }, 502, { "Cache-Control": "no-store" })); }
    }
    if (url.pathname === "/api/us-live") {
      const guard = requestGuard(request); if (guard) return guard;
      return nativeCorsResponse(request, await nasdaqQuotes(request));
    }
    if (url.pathname === "/api/stock-events-live") {
      const guard = requestGuard(request); if (guard) return guard;
      try { return nativeCorsResponse(request, await stockEventsLiveResponse(env,request)); }
      catch (error) {
        console.warn("Live stock events upstream error", String(error && error.message || error));
        return nativeCorsResponse(request, jsonResponse({ error: "Live stock events unavailable" }, 502, { "Cache-Control": "no-store" }));
      }
    }
    if (url.pathname === "/api/fund-search") {
      const guard = requestGuard(request); if (guard) return guard;
      return nativeCorsResponse(request, await fundSearch(request, ctx));
    }
    if (url.pathname === "/api/fx-live") {
      const guard = requestGuard(request); if (guard) return guard;
      try { return nativeCorsResponse(request, await liveEurUsd()); }
      catch (error) {
        console.warn("FX live upstream error", String(error && error.message || error));
        return nativeCorsResponse(request, jsonResponse({ error: "FX unavailable" }, 502, { "Cache-Control": "no-store" }));
      }
    }
    if (url.pathname === "/api/us-chart") {
      const guard = requestGuard(request); if (guard) return guard;
      return nativeCorsResponse(request, await nasdaqChart(request));
    }
    if (url.pathname === "/api/tr-history") {
      const guard = requestGuard(request); if (guard) return guard;
      return nativeCorsResponse(request, await tradeRepublicHistory(request));
    }
    if (url.pathname === "/api/tv-symbol") {
      const guard = requestGuard(request); if (guard) return guard;
      return nativeCorsResponse(request, await tradingViewSymbolAvailability(request));
    }
    if (url.pathname === "/data/market.json" || url.pathname === "/data/market-version.json" || url.pathname === "/data/funds.json") {
      const r2 = await r2MarketAssetResponse(env, url.pathname);
      if (r2) return nativeCorsResponse(request, r2);
    }
    return nativeCorsResponse(request, secureResponse(await env.ASSETS.fetch(request), url.pathname));
  },

  async scheduled(controller, env, ctx) {
    // Resumen diario de carteras y objetivos (08:00 y 22:00 en España por defecto): su propia
    // ejecución cada 5 min, con su propio margen de CPU y de peticiones.
    if(controller&&controller.cron===DIGEST_CRON){
      ctx.waitUntil(runDailyPortfolioDigest(env,{loadMarketSnapshot:loadMarketSnapshotForBackend,loadQuote:loadQuoteForBackend,loadCryptoQuotes:symbols=>cryptoQuotes(symbols,{env})},Number(controller.scheduledTime)||Date.now())
        .catch(error=>console.error("Daily digest task failed",String(error&&error.stack||error))));
      return;
    }
    // GitHub throttles its own «*/5» schedule to every 3-5 h. When a token is configured
    // (secret GITHUB_DISPATCH_TOKEN, fine-grained, Actions: read & write on this repo),
    // the Worker triggers the market-data workflow itself, following the US session
    // (see shouldDispatchMarketUpdate; MARKET_DISPATCH_MINUTES in wrangler.jsonc).
    const dispatchAt=Number(controller&&controller.scheduledTime)||Date.now();
    // Awaited before the heavy tasks: if they hit the CPU limit the whole invocation is
    // cancelled, and a request still pending in waitUntil would never reach GitHub.
    if(env.GITHUB_DISPATCH_TOKEN&&shouldDispatchMarketUpdate(dispatchAt,Number(env.MARKET_DISPATCH_MINUTES)||10)){
      let status="ok";
      try{await dispatchMarketUpdate(env)}
      catch(error){status=String(error&&error.message||error);console.warn("Market update dispatch failed",status)}
      if(env.HOT_STATE_KV)ctx.waitUntil(env.HOT_STATE_KV.put("market:dispatch:last",JSON.stringify({at:new Date().toISOString(),status})).catch(()=>{}));
    }
    const scheduledAt=Number(controller&&controller.scheduledTime)||Date.now();
    const minute=new Date(scheduledAt).getUTCMinutes();
    const tasks=[
      runScheduledPortfolioAnalysis(env, {
        jsonResponse,
        loadMarketSnapshot: loadMarketSnapshotForBackend,
        loadChart: loadChartForBackend,
        loadQuote: loadQuoteForBackend,
        loadNews: loadNewsForBackend,
        loadOfficialEvents: (stock,target) => loadAllOfficialEventsForBackend(stock,target,env),
        loadCryptoQuotes: symbols => cryptoQuotes(symbols, { env })
      })
    ];
    if(minute%5===0)tasks.push(refreshAttentionRankings(env));
    // Tras la foto diaria del Radar, el resumen guardado se recalcula en la siguiente consulta.
    tasks.push(runRadarScoreboard(env,{loadMarketSnapshot:loadMarketSnapshotForBackend},scheduledAt).then(async r=>{
      if(r&&r.day&&env.HOT_STATE_KV){try{await env.HOT_STATE_KV.delete(RADAR_SCOREBOARD_KV_KEY)}catch(_){}}
      return r;
    }));
    if(minute===17)tasks.push(runScheduledBrokerVerification(env,{limit:2}));

    ctx.waitUntil(Promise.allSettled(tasks).then(results=>{
      for(const result of results)if(result.status==="rejected")console.error("Scheduled task failed",String(result.reason&&result.reason.stack||result.reason));
    }));
  }
};
