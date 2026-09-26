import { handleBackendApi, runScheduledPortfolioAnalysis } from "./backend.js";


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
const nasdaqQuoteCache = new Map();
const nasdaqQuoteInflight = new Map();

const RATE_BUCKETS = new Map();
function requestIdentity(request){
  return String(request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "anon").split(",")[0].trim().slice(0,80);
}
function requestActorKey(request){
  const auth=String(request.headers.get("Authorization")||"");
  const token=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(token){
    try{
      const payload=token.split(".")[1]||"";
      const normalized=payload.replace(/-/g,"+").replace(/_/g,"/");
      const padded=normalized+"=".repeat((4-normalized.length%4)%4);
      const parsed=JSON.parse(atob(padded));
      if(parsed&&parsed.sub)return"user:"+String(parsed.sub).slice(0,128);
    }catch(_){}
  }
  return"ip:"+requestIdentity(request);
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
  return new Response(null, { status: 204, headers });
}

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' https://www.gstatic.com https://s3.tradingview.com; style-src 'self'; img-src 'self' data: https://*.googleusercontent.com https://*.tradingview.com https://s3.tradingview.com; font-src 'self'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://accounts.google.com wss://api.traderepublic.com https://*.tradingview.com wss://*.tradingview.com; frame-src https://accounts.google.com https://viewinvai.firebaseapp.com https://*.tradingview.com; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'none'; media-src 'none'; upgrade-insecure-requests",
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
  // The APK is a remote-shell WebView. Do not let it keep stale HTML/JS/CSS
  // between deploys, otherwise it can continue running an old UI after a fix.
  if (pathname === "/" || /\.(?:html|js|css)$/i.test(pathname)) {
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");
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

async function openTradeRepublicSocket() {
  const response = await fetch("https://api.traderepublic.com", {
    headers: {
      "Upgrade": "websocket",
      "Origin": "https://app.traderepublic.com",
      "User-Agent": "Mozilla/5.0"
    }
  });
  const ws = response.webSocket;
  if (!ws) throw new Error("Trade Republic rejected WebSocket upgrade");
  ws.accept({ allowHalfOpen: true });
  ws.send("connect 30");
  const hello = await waitForWsMessage(ws, 8000);
  if (!hello.startsWith("connected")) {
    try { ws.close(1000, "invalid greeting"); } catch (_) {}
    throw new Error("Trade Republic unexpected greeting");
  }
  return ws;
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
      volume: parseMarketNumber(primary.volume),
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
    const response = await fetch("https://api.traderepublic.com", {
      headers: {
        "Upgrade": "websocket",
        "Origin": "https://app.traderepublic.com",
        "User-Agent": "Mozilla/5.0"
      }
    });
    upstream = response.webSocket;
    if (!upstream) throw new Error("Trade Republic rejected WebSocket upgrade");
    upstream.accept({ allowHalfOpen: true });
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

async function publishMarketToR2(request, env) {
  if (!env.MARKET_DATA_BUCKET || !String(env.MARKET_PUBLISH_TOKEN || "").trim()) {
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
  if (!key) return jsonResponse({ error: "Invalid market asset kind" }, 400, { "Cache-Control": "no-store" });

  const announced = Number(request.headers.get("Content-Length") || 0);
  const maxBytes = kind === "snapshot" ? 24 * 1024 * 1024 : kind === "funds" ? 12 * 1024 * 1024 : 64 * 1024;
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
    return secureResponse(new Response(object.body, { status: 200, headers }), pathname);
  } catch (error) {
    console.warn("R2 market asset fallback", String(error && error.message || error));
    return null;
  }
}

async function loadMarketSnapshotForBackend(env) {
  let response = await r2MarketAssetResponse(env, "/data/market.json");
  if (!response) response = await env.ASSETS.fetch(new Request("https://viewinvai.local/data/market.json"));
  if (!response.ok) throw new Error("Market snapshot unavailable");
  const data = await response.json();
  if (!data || !Array.isArray(data.stocks)) throw new Error("Invalid market snapshot");
  return data;
}

async function loadChartForBackend(stock, target) {
  const preferTr = target && Number(target.prefer_tr) === 1;
  const isin = String((target && target.isin) || (stock && stock.trIsin) || (stock && stock.isin) || "").trim().toUpperCase();
  if (preferTr && /^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) {
    return fetchTradeRepublicHistory(isin, "LSX", "1d", 60000);
  }
  const ticker = safeStockSymbol(stock && stock.ticker);
  if (!ticker) throw new Error("No valid chart ticker");
  return fetchNasdaqChart(ticker);
}

function isBackendApiPath(pathname) {
  return pathname === "/api/backend/status" ||
    pathname === "/api/me" ||
    pathname === "/api/portfolios" || pathname.startsWith("/api/portfolios/") ||
    pathname === "/api/positions" || pathname.startsWith("/api/positions/") ||
    pathname === "/api/transactions" || pathname.startsWith("/api/transactions/") ||
    pathname === "/api/watchlist" || pathname.startsWith("/api/watchlist/") ||
    pathname === "/api/analysis" || pathname.startsWith("/api/analysis/") ||
    pathname === "/api/ai" || pathname.startsWith("/api/ai/") ||
    pathname === "/api/alerts" || pathname.startsWith("/api/alerts/") ||
    pathname === "/api/settings" ||
    pathname === "/api/devices" || pathname.startsWith("/api/devices/");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      const preflight = nativePreflightResponse(request);
      if (preflight) return preflight;
    }

    if (url.pathname === "/api/internal/market-publish") {
      return publishMarketToR2(request, env);
    }

    let limited=null;
    if(url.pathname==="/api/ai/chat")limited=await enforcedRateLimit(request,env,"ai-chat",20,60000,"AI_RATE_LIMITER");
    else if(url.pathname==="/api/us-live")limited=await enforcedRateLimit(request,env,"us-live",90,60000,"MARKET_RATE_LIMITER");
    else if(url.pathname==="/api/us-chart"||url.pathname==="/api/tr-history")limited=await enforcedRateLimit(request,env,"chart",60,60000,"MARKET_RATE_LIMITER");
    else if(url.pathname==="/api/fx-live")limited=await enforcedRateLimit(request,env,"fx",60,60000,"MARKET_RATE_LIMITER");
    else if(url.pathname==="/api/tr-live")limited=await enforcedRateLimit(request,env,"tr-live",30,60000,"MARKET_RATE_LIMITER");
    else if(isBackendApiPath(url.pathname))limited=await enforcedRateLimit(request,env,"backend",180,60000,"API_RATE_LIMITER");
    if(limited)return nativeCorsResponse(request, limited);

    if (isBackendApiPath(url.pathname)) {
      return nativeCorsResponse(request, await handleBackendApi(request, env, {
        jsonResponse,
        loadMarketSnapshot: loadMarketSnapshotForBackend,
        loadChart: loadChartForBackend
      }));
    }
    if (url.pathname === "/api/tr-live") {
      return proxyTradeRepublic(request);
    }
    if (url.pathname === "/api/us-live") {
      const guard = requestGuard(request); if (guard) return guard;
      return nativeCorsResponse(request, await nasdaqQuotes(request));
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
    ctx.waitUntil(
      runScheduledPortfolioAnalysis(env, {
        jsonResponse,
        loadMarketSnapshot: loadMarketSnapshotForBackend,
        loadChart: loadChartForBackend
      }).catch(error => console.error("Scheduled portfolio analysis failed", String(error && error.stack || error)))
    );
  }
};
