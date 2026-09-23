
function parseMarketNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/[$€,%+\s]/g, "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function fetchNasdaqQuote(symbol) {
  const safe = String(symbol || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
  if (!safe) return null;
  const response = await fetch("https://api.nasdaq.com/api/quote/" + encodeURIComponent(safe) + "/info?assetclass=stocks", {
    headers: {
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36",
      "Referer": "https://www.nasdaq.com/"
    },
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
    return env.ASSETS.fetch(request);
  }
};
