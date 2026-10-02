"""Diagnóstico temporal: qué fuentes públicas listan los fondos de Trade Republic y MyInvestor.
No usa credenciales. Se borra cuando el actualizador use la fuente elegida."""
import io, json, re, time, urllib.request
from pypdf import PdfReader

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36", "Accept-Language": "es-ES,es;q=0.9"}
WANT = ["IE00BYWYCC39", "IE00BYX5MX67", "IE000ZYRH0Q7", "ES0119199018"]

def get(url, data=None, headers=None, timeout=40):
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.headers.get("content-type", ""), r.read()

def section(title):
    print("\n==== " + title, flush=True)

def try_(title, fn):
    section(title)
    try:
        fn()
    except Exception as e:
        print("ERROR", type(e).__name__, str(e)[:300])

def tr_pdf():
    for url in ["https://assets.traderepublic.com/assets/files/ES/Instrument_Universe_ES_es.pdf",
                "https://assets.traderepublic.com/assets/files/ES/Fund_Universe_ES_es.pdf",
                "https://assets.traderepublic.com/assets/files/ES/Funds_Universe_ES_es.pdf",
                "https://assets.traderepublic.com/assets/files/ES/Instrument_Universe_ES_en.pdf"]:
        try:
            st, ct, body = get(url)
        except Exception as e:
            print(url, "->", type(e).__name__, str(e)[:120]); continue
        print(url, "->", st, ct, len(body))
        if b"%PDF" not in body[:10]:
            continue
        reader = PdfReader(io.BytesIO(body))
        heads, isins, sec_counts, cur = [], 0, {}, "?"
        for page in reader.pages:
            text = page.extract_text() or ""
            for line in text.splitlines():
                m = re.search(r"UNIVERSO DE INVERSI[ÓO]N\s*-?\s*([A-Za-zÁÉÍÓÚáéíóúñ ]+)", line, re.I)
                if m:
                    cur = m.group(1).strip()[:40]
                    if cur not in heads: heads.append(cur)
                if re.match(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]\b", line.strip()):
                    sec_counts[cur] = sec_counts.get(cur, 0) + 1
        print("  pages", len(reader.pages), "sections", heads)
        print("  isins per section", sec_counts)
        alltext = "\n".join((p.extract_text() or "") for p in reader.pages)
        for w in WANT:
            i = alltext.find(w)
            print("  ", w, "found" if i >= 0 else "missing", alltext[i:i+90].replace("\n", " ") if i >= 0 else "")

def tr_ws():
    import asyncio, websockets
    async def run():
        async with websockets.connect("wss://api.traderepublic.com", origin="https://app.traderepublic.com", user_agent_header=UA["User-Agent"], open_timeout=15) as ws:
            await ws.send('connect 31 {"locale":"es","platformId":"webtrading","platformVersion":"chrome - 126.0.0","clientId":"app.traderepublic.com","clientVersion":"3.151.3"}')
            print("hello", (await asyncio.wait_for(ws.recv(), 10))[:60])
            subs = [
                ("instrument", {"type": "instrument", "id": "IE00BYWYCC39"}),
                ("search fund", {"type": "neonSearch", "data": {"q": "emerging", "page": 1, "pageSize": 5, "filter": [{"key": "type", "value": "fund"}]}}),
                ("search mutualFund", {"type": "neonSearch", "data": {"q": "emerging", "page": 1, "pageSize": 5, "filter": [{"key": "type", "value": "mutualFund"}]}}),
                ("search all", {"type": "neonSearch", "data": {"q": "IE00BYWYCC39", "page": 1, "pageSize": 5}}),
                ("history FND", {"type": "aggregateHistoryLight", "id": "IE00BYWYCC39.FND", "range": "1m", "resolution": 86400000}),
            ]
            for n, (label, payload) in enumerate(subs, start=1):
                await ws.send(f"sub {n} " + json.dumps(payload))
                try:
                    end = time.time() + 8
                    while time.time() < end:
                        msg = await asyncio.wait_for(ws.recv(), 8)
                        if msg.startswith(f"{n} "):
                            print(label, "->", msg[:600]); break
                except Exception as e:
                    print(label, "->", type(e).__name__)
                await ws.send(f"unsub {n}")
    asyncio.run(run())

def myinvestor():
    st, ct, body = get("https://myinvestor.es/inversion/fondos-inversion/buscador/")
    html = body.decode("utf-8", "replace")
    print("buscador", st, ct, len(html))
    for m in sorted(set(re.findall(r"https?://[a-zA-Z0-9.\-]*myinvestor[a-zA-Z0-9.\-]*/[^\"' )<>]{0,120}", html)))[:40]:
        print("  url", m)
    for m in sorted(set(re.findall(r"(?:src|href)=\"([^\"]+\.js[^\"]*)\"", html)))[:25]:
        print("  js", m)
    for m in sorted(set(re.findall(r"[\"'](/[a-zA-Z0-9_\-/]*(?:api|rest|fondo|fund)[a-zA-Z0-9_\-/]*)[\"']", html)))[:40]:
        print("  path", m)
    print("  sample", re.sub(r"\s+", " ", html[:1500]))

def myinvestor_js():
    st, ct, body = get("https://myinvestor.es/inversion/fondos-inversion/buscador/")
    html = body.decode("utf-8", "replace")
    js = [u for u in set(re.findall(r"(?:src)=\"([^\"]+\.js[^\"]*)\"", html))]
    seen = 0
    for u in js[:30]:
        full = u if u.startswith("http") else "https://myinvestor.es" + (u if u.startswith("/") else "/" + u)
        try:
            _, _, b = get(full, timeout=20)
        except Exception as e:
            continue
        t = b.decode("utf-8", "replace")
        hits = sorted(set(re.findall(r"[\"'`](https?://[^\"'`]{0,40}(?:api|server|rest)[^\"'`]{0,120}|/(?:myinvestor-server|api|rest)[^\"'`]{0,120})[\"'`]", t)))
        hits = [h for h in hits if re.search(r"fond|fund|product|search|buscador|isin", h, re.I)] or hits[:5]
        if hits:
            seen += 1
            print(full[:120]); [print("   ", h) for h in hits[:20]]
    print("bundles with hits", seen)

def morningstar():
    url = ("https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security/screener?outputType=json&version=1&languageId=es-ES&currencyId=EUR"
           "&universeIds=FOESP%24%24ALL&securityDataPoints=SecId%7CName%7Cisin%7COngoingCharge%7CClosePrice%7CClosePriceDate%7CReturnM12"
           "&filters=ISIN%3AIN%3AIE00BYWYCC39%3AIE00BYX5MX67&page=1&pageSize=5")
    st, ct, body = get(url)
    print(st, ct, body[:800])
    url2 = ("https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security/screener?outputType=json&version=1&languageId=es-ES&currencyId=EUR"
            "&universeIds=FOESP%24%24ALL&securityDataPoints=SecId%7Cisin&page=1&pageSize=1")
    st, ct, body = get(url2)
    print("total universe:", body[:300])

def ft():
    st, ct, body = get("https://markets.ft.com/data/funds/tearsheet/summary?s=IE00BYWYCC39:EUR")
    html = body.decode("utf-8", "replace")
    m = re.search(r"Price \(EUR\)</span><span[^>]*>([^<]+)", html)
    oc = re.search(r"Ongoing charge</th><td[^>]*>([^<]+)", html)
    print(st, len(html), "price", m and m.group(1), "ongoing", oc and oc.group(1))


def tr_ws2():
    import asyncio, websockets
    async def run():
        async with websockets.connect("wss://api.traderepublic.com", origin="https://app.traderepublic.com", user_agent_header=UA["User-Agent"], open_timeout=15) as ws:
            await ws.send('connect 31 {"locale":"es","platformId":"webtrading","platformVersion":"chrome - 126.0.0","clientId":"app.traderepublic.com","clientVersion":"3.151.3"}')
            await asyncio.wait_for(ws.recv(), 10)
            subs = [("instrument full", {"type": "instrument", "id": "IE00BYWYCC39"})]
            for t in ["mutualFund", "mutual_fund", "MUTUAL_FUND", "fonds", "investmentFund", "mutualfund", "fund_mutual"]:
                subs.append(("q index t=" + t, {"type": "neonSearch", "data": {"q": "index", "page": 1, "pageSize": 3, "filter": [{"key": "type", "value": t}]}}))
            subs += [("q ishares emerging nofilter", {"type": "neonSearch", "data": {"q": "iShares Emerging Markets Index", "page": 1, "pageSize": 8}}),
                     ("q fidelity s&p nofilter", {"type": "neonSearch", "data": {"q": "Fidelity S&P 500", "page": 1, "pageSize": 8}}),
                     ("tags", {"type": "neonSearchTags", "data": {"q": ""}}),
                     ("suggested", {"type": "neonSearchSuggestedTags", "data": {"q": ""}}),
                     ("history VST", {"type": "aggregateHistoryLight", "id": "IE00BYWYCC39.VST", "range": "1m", "resolution": 86400000}),
                     ("ticker VST", {"type": "ticker", "id": "IE00BYWYCC39.VST"})]
            for n, (label, payload) in enumerate(subs, start=1):
                await ws.send(f"sub {n} " + json.dumps(payload))
                try:
                    end = time.time() + 8
                    while time.time() < end:
                        msg = await asyncio.wait_for(ws.recv(), 8)
                        if msg.startswith(f"{n} "):
                            body = msg[len(str(n)) + 3:]
                            if label.startswith("q ") or label.startswith("instrument"):
                                try:
                                    d = json.loads(body)
                                    if "results" in d:
                                        print(label, "count", d.get("resultCount"), [(r.get("isin"), r.get("instrumentType"), r.get("name")) for r in d["results"]])
                                    else:
                                        print(label, {k: (v if not isinstance(v, (dict, list)) else str(v)[:200]) for k, v in d.items() if k not in ("exchanges",)})
                                except Exception:
                                    print(label, "->", body[:400])
                            else:
                                print(label, "->", body[:700])
                            break
                except Exception as e:
                    print(label, "->", type(e).__name__)
                await ws.send(f"unsub {n}")
    asyncio.run(run())

def myinvestor_api():
    _, _, b = get("https://myinvestor.es/_next/static/chunks/pages/_app-cb2d24ba2fac8be1.js")
    t = b.decode("utf-8", "replace")
    for key in ["find-fondos", "funds/top"]:
        i = t.find(key)
        print("CTX", key, t[max(0, i - 700):i + 400].replace("\n", " "))
    hosts = sorted(set(re.findall(r"https://[a-z0-9.\-]*myinvestor[a-z0-9.\-]*", t)))
    print("hosts", hosts)
    for host in hosts + ["https://app.myinvestor.es", "https://myinvestor.es", "https://newapp.myinvestor.es"]:
        for method, data in [("GET", None), ("POST", json.dumps({"page": 0, "size": 5}).encode())]:
            url = host + "/myinvestor-server/rest/public/fondos/find-fondos"
            try:
                st, ct, body = get(url, data=data, headers={"Content-Type": "application/json", "Accept": "application/json"}, timeout=20)
                print(method, url, st, ct, body[:500])
            except Exception as e:
                print(method, url, type(e).__name__, str(e)[:150])


def tr_ws3():
    import asyncio, websockets
    async def run():
        async with websockets.connect("wss://api.traderepublic.com", origin="https://app.traderepublic.com", user_agent_header=UA["User-Agent"], open_timeout=15) as ws:
            await ws.send('connect 31 {"locale":"es","platformId":"webtrading","platformVersion":"chrome - 126.0.0","clientId":"app.traderepublic.com","clientVersion":"3.151.3"}')
            await asyncio.wait_for(ws.recv(), 10)
            variants = []
            for q in ["", "ishares", "index", "fidelity", "a"]:
                variants.append((f"mf+ES q={q!r}", {"type": "neonSearch", "data": {"q": q, "page": 1, "pageSize": 50, "filter": [{"key": "type", "value": "mutualFund"}, {"key": "jurisdiction", "value": "ES"}]}}))
            variants.append(("mf q=ishares no juris", {"type": "neonSearch", "data": {"q": "ishares", "page": 1, "pageSize": 5, "filter": [{"key": "type", "value": "mutualFund"}]}}))
            variants.append(("all+ES q=ishares emerging index", {"type": "neonSearch", "data": {"q": "iShares Emerging Markets Index", "page": 1, "pageSize": 10, "filter": [{"key": "jurisdiction", "value": "ES"}]}}))
            variants.append(("mf+ES page2", {"type": "neonSearch", "data": {"q": "", "page": 2, "pageSize": 50, "filter": [{"key": "type", "value": "mutualFund"}, {"key": "jurisdiction", "value": "ES"}]}}))
            variants.append(("instrument fidelity", {"type": "instrument", "id": "IE00BYX5MX67"}))
            for n, (label, payload) in enumerate(variants, start=1):
                await ws.send(f"sub {n} " + json.dumps(payload))
                try:
                    end = time.time() + 8
                    while time.time() < end:
                        msg = await asyncio.wait_for(ws.recv(), 8)
                        if msg.startswith(f"{n} "):
                            body = msg[len(str(n)) + 3:]
                            d = json.loads(body)
                            if "results" in d:
                                print(label, "count", d.get("resultCount"), "got", len(d["results"]), [(r.get("isin"), r.get("instrumentType"), r.get("name")) for r in d["results"][:6]])
                            elif label.startswith("instrument"):
                                print(label, d.get("typeId"), d.get("exchangeIds"), d.get("name"), d.get("issuerDisplayName"))
                            else:
                                print(label, body[:300])
                            break
                except Exception as e:
                    print(label, "->", type(e).__name__)
                await ws.send(f"unsub {n}")
    asyncio.run(run())

def myinvestor_api2():
    base = "https://api.myinvestor.es/myinvestor-server/rest/public/fondos/find-fondos"
    from urllib.parse import urlencode
    for q in [{"isin": "IE00BYWYCC39", "ltvMode": "ORIGIN"}, {"isin": "IE00BYWYCC39"}, {"name": "ishares", "ltvMode": "ORIGIN"}, {"type": "TODOS", "ltvMode": "ORIGIN"},
              {"name": "a", "type": "TODOS", "ltvMode": "ORIGIN"}, {"name": "", "type": "TODOS", "ltvMode": "ORIGIN"}, {"type": "PENSIONES", "ltvMode": "ORIGIN"}]:
        url = base + "?" + urlencode(q)
        try:
            st, ct, body = get(url, headers={"Accept": "application/json", "Origin": "https://myinvestor.es", "Referer": "https://myinvestor.es/"}, timeout=30)
            txt = body.decode("utf-8", "replace")
            try:
                d = json.loads(txt)
                rows = d if isinstance(d, list) else (d.get("payload") or d.get("data") or d.get("content") or d)
                n = len(rows) if isinstance(rows, list) else "?"
                print(q, st, "len", len(txt), "rows", n, txt[:400])
                if isinstance(rows, list) and rows:
                    print("   keys", list(rows[0].keys())[:40] if isinstance(rows[0], dict) else rows[0])
            except Exception:
                print(q, st, ct, txt[:300])
        except Exception as e:
            print(q, type(e).__name__, str(e)[:200])
    for t in ["FONDOS_INDEXADOS", "indexed"]:
        try:
            st, ct, body = get("https://api.myinvestor.es/myinvestor-server/rest/public/funds/top/" + t, headers={"Accept": "application/json", "Origin": "https://myinvestor.es"}, timeout=20)
            print("top", t, st, body[:300])
        except Exception as e:
            print("top", t, type(e).__name__, str(e)[:120])


def myinvestor_api3():
    import urllib.error
    _, _, b = get("https://myinvestor.es/_next/static/chunks/pages/_app-cb2d24ba2fac8be1.js")
    t = b.decode("utf-8", "replace")
    for key in ["api.myinvestor.es", "sk=", "x-api", "apikey", "Authorization"]:
        for m in list(re.finditer(re.escape(key), t))[:3]:
            print("CTX", key, t[max(0, m.start() - 300):m.start() + 300].replace("\n", " "))
    _, _, b2 = get("https://myinvestor.es/_next/static/chunks/pages/inversion/fondos-inversion/buscador-82a8b9222a11d829.js")
    t2 = b2.decode("utf-8", "replace")
    for key in ["find-fondos", "ltvMode", "TODOS", "query:"]:
        for m in list(re.finditer(re.escape(key), t2))[:3]:
            print("BUSCADOR", key, t2[max(0, m.start() - 400):m.start() + 300].replace("\n", " "))
    base = "https://api.myinvestor.es/myinvestor-server/rest/public/fondos/find-fondos?type=TODOS&ltvMode=ORIGIN"
    try:
        get(base, headers={"Accept": "application/json", "Origin": "https://myinvestor.es"})
    except urllib.error.HTTPError as e:
        print("400 body:", e.read()[:600])


def updater_dry_run():
    import sys
    sys.path.insert(0, "scripts")
    import update_funds as u
    funds = u.tr_mutual_funds()
    print("total", len(funds), "sample", [(f["isin"], f["name"], f["provider"], f["region"]) for f in funds[:5]])
    want = {"IE00BYWYCC39", "IE00BYX5MX67"}
    print("user funds present:", [f["isin"] for f in funds if f["isin"] in want])
    subset = [f for f in funds if f["isin"] in want] + funds[:150]
    n = u.enrich_morningstar_funds(subset)
    print("morningstar enriched", n, "of", len(subset), "with ter", sum(1 for f in subset if f.get("ter") is not None))
    for f in subset[:4]:
        print("  ", f["isin"], f["name"], "TER", f.get("ter"), "NAV", f.get("nav"), f.get("valueDate"), "1Y", f.get("perf1Y"), "3Y", f.get("perf3Y"), f.get("category"))
    p, ok = u.enrich_one_tr_product(dict(subset[0]))
    print("TR VST history", ok, p.get("nav"), p.get("valueDate"), p.get("perf1Y"))

for title, fn in [("Actualizador (prueba en seco)", updater_dry_run), ("MyInvestor API 3", myinvestor_api3)]:
    try_(title, fn)
