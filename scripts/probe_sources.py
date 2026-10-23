"""Comprueba fuentes gratuitas nuevas antes de usarlas en la app (no guarda nada).

52 semanas (escáner de TradingView), analistas (API pública de Nasdaq) y calendario económico
(ForexFactory y TradingView). Imprime estado, tamaño y una muestra de cada una.
"""
import json
import urllib.request
from datetime import datetime, timedelta, timezone

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"


def get(url, data=None, headers=None):
    h = {"User-Agent": UA, "Accept": "application/json, text/plain, */*"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None, headers=h)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001 - solo diagnóstico
        return getattr(e, "code", 0), str(e)


def show(name, status, body, n=900):
    print(f"\n=== {name}: HTTP {status} · {len(body)} bytes")
    print(body[:n])


cols = ["name", "close", "price_52_week_high", "price_52_week_low", "High.All", "Low.All"]
st, body = get("https://scanner.tradingview.com/america/scan", {
    "symbols": {"tickers": ["NASDAQ:AAPL", "NASDAQ:SPRO", "NYSE:KO"], "query": {"types": []}}, "columns": cols})
show("TradingView 52s (america)", st, body)
st, body = get("https://scanner.tradingview.com/germany/scan", {
    "symbols": {"tickers": ["XETR:SAP"], "query": {"types": []}}, "columns": cols})
show("TradingView 52s (germany)", st, body)

nasdaq = {"Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"}
for path in ("analyst/AAPL/targetprice", "analyst/AAPL/ratings", "analyst/SPRO/targetprice", "analyst/AAPL/earnings-forecast"):
    st, body = get("https://api.nasdaq.com/api/" + path, headers=nasdaq)
    show("Nasdaq " + path, st, body, 1200)

st, body = get("https://nfs.faireconomy.media/ff_calendar_thisweek.json")
show("ForexFactory semana", st, body, 700)

now = datetime.now(timezone.utc)
frm = now.strftime("%Y-%m-%dT00:00:00.000Z")
to = (now + timedelta(days=7)).strftime("%Y-%m-%dT00:00:00.000Z")
st, body = get(f"https://economic-calendar.tradingview.com/events?from={frm}&to={to}&countries=US,EU,ES,DE",
               headers={"Origin": "https://www.tradingview.com", "Referer": "https://www.tradingview.com/"})
show("TradingView calendario", st, body, 900)
