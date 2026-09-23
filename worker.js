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
    return env.ASSETS.fetch(request);
  }
};
