
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

function safeStockSymbol(symbol) {
  return String(symbol || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
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
  const raw = data && Array.isArray(data.chart) ? data.chart : [];
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
  const safeIsin = String(isin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const safeExchange = String(exchange || "LSX").toUpperCase().replace(/[^A-Z0-9]/g, "") || "LSX";
  if (!/^[A-Z0-9]{12}$/.test(safeIsin)) throw new Error("Invalid ISIN");
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
      const aggregates = Array.isArray(data.aggregates) ? data.aggregates : [];
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
  if (!symbol) return Response.json({ error: "No symbol" }, { status: 400 });
  try {
    const [chart, quote] = await Promise.all([fetchNasdaqChart(symbol), fetchNasdaqQuote(symbol)]);
    const points = chart && Array.isArray(chart.points) ? chart.points.slice(-1200) : [];
    if (quote && quote.price != null) {
      points.push({ time: Date.now(), price: quote.price, volume: quote.volume || null, live: true });
    }
    return Response.json(
      { symbol, points, quote, source: "Nasdaq", fetchedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (error) {
    return Response.json({ error: String(error && error.message || error) }, { status: 502 });
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
    return Response.json(result, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate", "Access-Control-Allow-Origin": "*" }
    });
  } catch (error) {
    return Response.json({ error: String(error && error.message || error) }, { status: 502 });
  }
}

async function fetchNasdaqQuote(symbol) {
  const safe = safeStockSymbol(symbol);
  if (!safe) return null;
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
  return {
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
}

async function nasdaqQuotes(request) {
  const url = new URL(request.url);
  const symbols = [...new Set((url.searchParams.get("symbols") || "")
    .split(",")
    .map(x => x.trim().toUpperCase())
    .filter(Boolean))].slice(0, 25);

  if (!symbols.length) {
    return Response.json({ quotes: [], error: "No symbols" }, { status: 400 });
  }

  const settled = await Promise.allSettled(symbols.map(fetchNasdaqQuote));
  const quotes = settled
    .map((result, i) => result.status === "fulfilled" && result.value ? result.value : { symbol: symbols[i], error: "unavailable" });

  return Response.json(
    { quotes, fetchedAt: new Date().toISOString(), source: "Nasdaq website quote API" },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate", "Access-Control-Allow-Origin": "*" } }
  );
}

async function proxyTradeRepublic(request) {
  if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

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

  browser.addEventListener("message", event => safeSend(upstream, event.data));
  upstream.addEventListener("message", event => safeSend(browser, event.data));

  browser.addEventListener("close", event => safeClose(upstream, event.code || 1000, "browser closed"));
  upstream.addEventListener("close", event => safeClose(browser, event.code || 1000, "upstream closed"));

  browser.addEventListener("error", () => safeClose(upstream, 1011, "browser error"));
  upstream.addEventListener("error", () => safeClose(browser, 1011, "upstream error"));

  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/tr-live") {
      return proxyTradeRepublic(request);
    }
    if (url.pathname === "/api/us-live") {
      return nasdaqQuotes(request);
    }
    if (url.pathname === "/api/us-chart") {
      return nasdaqChart(request);
    }
    if (url.pathname === "/api/tr-history") {
      return tradeRepublicHistory(request);
    }
    return env.ASSETS.fetch(request);
  }
};
