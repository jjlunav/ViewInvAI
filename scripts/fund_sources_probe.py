"""Diagnóstico temporal de fuentes públicas (sin credenciales). Se borra antes de fusionar."""
import asyncio, io, json, re, time, urllib.parse, urllib.request
from collections import Counter
from pypdf import PdfReader

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/126 Safari/537.36", "Accept-Language": "es-ES,es;q=0.9"}

def get(url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:  # nosec B310 - URLs https fijas
        return r.read()

def sec(t): print("\n==== " + t, flush=True)

def tr_pdf():
    body = get("https://assets.traderepublic.com/assets/files/ES/Instrument_Universe_ES_es.pdf")
    reader = PdfReader(io.BytesIO(body))
    print("pages", len(reader.pages))
    heads = Counter(); section = "?"; counts = Counter(); samples = {}
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        for line in text.splitlines():
            m = re.search(r"UNIVERSO DE INVERSI[ÓO]N\s*-?\s*([A-ZÁÉÍÓÚ ]+)", line.upper())
            if m:
                section = m.group(1).strip(); heads[section] += 1
            mm = re.match(r"^([A-Z]{2}[A-Z0-9]{9}[0-9])\s+(.+)$", line.strip())
            if mm:
                counts[section] += 1
                samples.setdefault(section, []).append(line.strip()[:90]) if len(samples.get(section, [])) < 4 else None
                if mm.group(1) in ("DE000BAY0017", "FR0000121014", "ES0148396007", "DE0007164600"):
                    print("FOUND", section, "page", i, line.strip()[:100])
        if i < 2: print("PAGE", i, text[:500].replace("\n", " | "))
    print("heads", heads); print("counts", counts)
    for k, v in samples.items(): print(k, v)
    prefixes = Counter()
    return counts

def tv():
    for market in ["germany", "france", "spain", "europe"]:
        payload = {"filter": [{"left": "name", "operation": "in_range", "right": ["BAYN", "MC", "ITX", "SAP"]}],
                   "markets": [market], "columns": ["name", "description", "isin", "exchange", "currency", "close", "change", "sector", "market_cap_basic", "is_primary", "type"],
                   "range": [0, 20]}
        try:
            d = json.loads(get(f"https://scanner.tradingview.com/{market}/scan", json.dumps(payload).encode(), {"Content-Type": "application/json"}))
            print(market, "total", d.get("totalCount"))
            for r in d.get("data", [])[:12]: print("  ", r.get("s"), r.get("d"))
        except Exception as e:
            print(market, "ERR", type(e).__name__, str(e)[:200])
    payload = {"filter": [{"left": "is_primary", "operation": "equal", "right": True}, {"left": "type", "operation": "equal", "right": "stock"}],
               "markets": ["europe"], "columns": ["name", "isin", "exchange"], "range": [0, 3]}
    try:
        d = json.loads(get("https://scanner.tradingview.com/europe/scan", json.dumps(payload).encode(), {"Content-Type": "application/json"}))
        print("europe primary stocks total", d.get("totalCount"), d.get("data", [])[:3])
    except Exception as e:
        print("europe ERR", e)

def ms():
    base = "https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security/screener"
    for t in ["cobas", "vanguard global stock", "myinvestor", "indexa", "ES0165242001", "fidelity msci emerging"]:
        q = {"page": "1", "pageSize": "6", "outputType": "json", "languageId": "es-ES", "currencyId": "EUR",
             "universeIds": "FOESP$$ALL", "securityDataPoints": "SecId|Name|isin|OngoingCharge|ClosePrice|CategoryName|BrandingCompanyName", "term": t}
        try:
            d = json.loads(get(base + "?" + urllib.parse.urlencode(q)))
            print(repr(t), "total", d.get("total"))
            for r in d.get("rows", []): print("   ", r.get("isin"), "|", r.get("Name"), "|", r.get("OngoingCharge"), "|", r.get("BrandingCompanyName"))
        except Exception as e:
            print(t, "ERR", type(e).__name__, str(e)[:200])

def trws():
    import websockets
    async def run():
        async with websockets.connect("wss://api.traderepublic.com", origin="https://app.traderepublic.com", user_agent_header=UA["User-Agent"], open_timeout=15) as ws:
            await ws.send('connect 31 {"locale":"es","platformId":"webtrading","platformVersion":"chrome - 126.0.0","clientId":"app.traderepublic.com","clientVersion":"3.151.3"}')
            await asyncio.wait_for(ws.recv(), 10)
            subs = [{"type": "instrument", "id": "DE000BAY0017"}, {"type": "ticker", "id": "DE000BAY0017.LSX"},
                    {"type": "ticker", "id": "FR0000121014.LSX"},
                    {"type": "neonSearch", "data": {"q": "bayer", "page": 1, "pageSize": 3, "filter": [{"key": "type", "value": "stock"}, {"key": "jurisdiction", "value": "ES"}]}}]
            for n, p in enumerate(subs, 1):
                await ws.send(f"sub {n} " + json.dumps(p))
                end = time.time() + 8
                try:
                    while time.time() < end:
                        msg = await asyncio.wait_for(ws.recv(), 8)
                        if msg.startswith(f"{n} "): print(p.get("type"), "->", msg[:700]); break
                except Exception as e: print(p.get("type"), "->", type(e).__name__)
                await ws.send(f"unsub {n}")
    asyncio.run(run())

for name, fn in [("TR PDF", tr_pdf), ("TradingView Europa", tv), ("Morningstar term", ms), ("TR websocket", trws)]:
    sec(name)
    try: fn()
    except Exception as e: print("ERROR", type(e).__name__, str(e)[:300])
