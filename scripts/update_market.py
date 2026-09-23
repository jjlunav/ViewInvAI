#!/usr/bin/env python3
import json
import re
import time
import unicodedata
import datetime as dt
from difflib import SequenceMatcher
from pathlib import Path

import requests
import websocket
from pypdf import PdfReader

TV_URL = "https://scanner.tradingview.com/america/scan"
NEWS_URL = "https://news-headlines.tradingview.com/v2/headlines"
TR_WS_URL = "wss://api.traderepublic.com"
TR_URLS = [
    "https://assets.traderepublic.com/assets/files/ES/Instrument_Universe_ES_en.pdf",
    "https://assets.traderepublic.com/assets/files/DE/Instrument_Universe_DE_en.pdf",
]
OUT = Path("data/market.json")
TMP = Path("/tmp/tr_universe.pdf")
NEWS_SYMBOL_LIMIT = 60
NEWS_DAYS = 7
NEWS_PER_SYMBOL = 10
TR_METADATA_LIMIT = 2200
TR_METADATA_BATCH = 75

COLS = [
    "name","description","exchange","currency","close","change","volume",
    "average_volume_10d_calc","relative_volume_10d_calc",
    "premarket_close","premarket_change","premarket_volume","premarket_time",
    "postmarket_close","postmarket_change","postmarket_volume","postmarket_time",
    "RSI","ADX","EMA20","EMA50","Perf.W","Perf.1M",
    "earnings_release_next_date","earnings_release_next_calendar_date","earnings_release_next_time","earnings_release_next_trading_date_fq","update_mode","last_bar_update_time",
]
SUFFIX = {
    "inc","incorporated","corp","corporation","co","company","ltd","limited",
    "plc","ag","se","sa","nv","holdings","holding","group","spa","srl","llc",
    "lp","adr","ads","ordinary","shares","common","stock","class","the",
}
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Origin": "https://www.tradingview.com",
    "Referer": "https://www.tradingview.com/",
}

def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\([^)]*\)", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(x for x in s.split() if x not in SUFFIX).strip()

def tr_universe():
    source = None
    for url in TR_URLS:
        try:
            r = requests.get(url, headers=HEADERS, timeout=60)
            if r.ok and r.content[:4] == b"%PDF":
                TMP.write_bytes(r.content)
                source = url
                break
        except Exception:
            pass
    if not source:
        return {}, 0, None

    pat = re.compile(r"^([A-Z]{2}[A-Z0-9]{10})\s+(.+)$")
    rows = []
    for page in PdfReader(str(TMP)).pages:
        for line in (page.extract_text() or "").splitlines():
            m = pat.match(line.strip())
            if m:
                rows.append((m.group(1), m.group(2).strip()))

    idx = {}
    for isin, name in rows:
        k = norm(name)
        if k:
            idx.setdefault(k, []).append((isin, name))
    return idx, len(rows), source

def tr_match(name, idx):
    k = norm(name)
    if not k:
        return None
    exact = idx.get(k)
    if exact and len(exact) == 1:
        return exact[0][0]

    p = k[:18]
    if len(p) < 10:
        return None

    cand = []
    for key, vals in idx.items():
        if key.startswith(p) or k.startswith(key[:18]):
            for item in vals:
                cand.append((key, item))
            if len(cand) > 8:
                break

    scored = []
    for key, item in cand:
        ratio = SequenceMatcher(None, k, key).ratio()
        if ratio >= 0.93:
            scored.append((ratio, item))
    scored.sort(reverse=True, key=lambda x: x[0])

    if len(scored) == 1 or (len(scored) > 1 and scored[0][0] - scored[1][0] > 0.03):
        return scored[0][1][0]
    return None

def tv():
    # Do not restrict to is_primary. US pre-market leaderboards also contain
    # ADRs / secondary US listings, and excluding them drops real movers.
    base_payload = {
        "filter": [
            {"left": "type", "operation": "in_range", "right": ["stock", "dr"]},
            {"left": "exchange", "operation": "in_range", "right": ["NASDAQ", "NYSE", "AMEX", "NYSE ARCA", "NYSEARCA"]},
        ],
        "options": {"lang": "en"},
        "markets": ["america"],
        "symbols": {"query": {"types": []}, "tickers": []},
        "columns": COLS,
        # Stable ordering makes pagination safer while prices are moving.
        "sort": {"sortBy": "name", "sortOrder": "asc"},
    }
    headers = dict(HEADERS)
    headers["Content-Type"] = "application/json"

    raw_rows = []
    total = None
    offset = 0
    page_size = 10000

    while True:
        payload = dict(base_payload)
        payload["range"] = [offset, offset + page_size]
        r = requests.post(TV_URL, json=payload, headers=headers, timeout=90)
        r.raise_for_status()
        raw = r.json()
        page = raw.get("data") or []
        if total is None:
            total = raw.get("totalCount")
        if not page:
            break
        raw_rows.extend(page)
        offset += len(page)
        if total is None or offset >= total:
            break

    out = []
    seen = set()

    for row in raw_rows:
        d = dict(zip(COLS, row.get("d") or []))
        sym = row.get("s", "")
        if not sym or sym in seen:
            continue
        seen.add(sym)
        if ":" in sym:
            ex, ticker = sym.split(":", 1)
        else:
            ex, ticker = d.get("exchange") or "", d.get("name") or sym

        out.append({
            "tvSymbol": sym,
            "ticker": ticker,
            "name": d.get("description") or ticker,
            "exchange": d.get("exchange") or ex,
            "currency": d.get("currency") or "USD",
            "price": d.get("close"),
            "changePct": d.get("change"),
            "volume": d.get("volume"),
            "avgVolume": d.get("average_volume_10d_calc"),
            "relVolume": d.get("relative_volume_10d_calc"),
            "premarketPrice": d.get("premarket_close"),
            "premarketChangePct": d.get("premarket_change"),
            "premarketVolume": d.get("premarket_volume"),
            "premarketTime": d.get("premarket_time"),
            "postmarketPrice": d.get("postmarket_close"),
            "postmarketChangePct": d.get("postmarket_change"),
            "postmarketVolume": d.get("postmarket_volume"),
            "postmarketTime": d.get("postmarket_time"),
            "rsi": d.get("RSI"),
            "adx": d.get("ADX"),
            "ema20": d.get("EMA20"),
            "ema50": d.get("EMA50"),
            "perfWeek": d.get("Perf.W"),
            "perfMonth": d.get("Perf.1M"),
            "earningsDate": d.get("earnings_release_next_date") or d.get("earnings_release_next_calendar_date") or d.get("earnings_release_next_trading_date_fq"),
            "earningsCalendarDate": d.get("earnings_release_next_calendar_date"),
            "earningsTimeCode": d.get("earnings_release_next_time"),
            "updateMode": d.get("update_mode"),
            "lastBarUpdateTime": d.get("last_bar_update_time"),
        })
    return out, total


def cached_tr_metadata(previous):
    cache = {}
    for row in previous.get("stocks") or []:
        isin = row.get("isin")
        ticker = row.get("trTicker")
        if not isin or not ticker:
            continue
        cache[isin] = {
            "trTicker": ticker,
            "trExchange": row.get("trExchange") or "LSX",
            "trNameAtExchange": row.get("trNameAtExchange"),
            "trWkn": row.get("trWkn"),
            "trActive": row.get("trActive"),
        }
    return cache

def fetch_tr_metadata(stocks, previous):
    """Resolve the exact symbolAtExchange used by Trade Republic/LSX.

    Public instrument metadata is requested by ISIN. Failures are non-fatal:
    market data still publishes and unresolved symbols can be filled on a later run.
    """
    cache = cached_tr_metadata(previous)
    candidates = []
    seen = set()
    for row in sorted(stocks, key=mover_score, reverse=True):
        isin = row.get("isin")
        if not isin or isin in seen or isin in cache:
            continue
        seen.add(isin)
        candidates.append(isin)
        if len(candidates) >= TR_METADATA_LIMIT:
            break

    if not candidates:
        return cache

    ws = None
    try:
        ws = websocket.create_connection(
            TR_WS_URL,
            timeout=12,
            origin="https://app.traderepublic.com",
            header=["User-Agent: Mozilla/5.0"],
        )
        ws.send("connect 30")
        hello = ws.recv()
        if not str(hello).startswith("connected"):
            raise RuntimeError(f"unexpected TR websocket greeting: {str(hello)[:80]}")

        sub_id = 1
        for start in range(0, len(candidates), TR_METADATA_BATCH):
            batch = candidates[start:start + TR_METADATA_BATCH]
            pending = {}
            for isin in batch:
                sid = str(sub_id)
                sub_id += 1
                pending[sid] = isin
                payload = json.dumps({"type": "instrument", "id": isin}, separators=(",", ":"))
                ws.send(f"sub {sid} {payload}")

            deadline = time.time() + 25
            while pending and time.time() < deadline:
                try:
                    msg = ws.recv()
                except websocket.WebSocketTimeoutException:
                    break
                parts = str(msg).split(" ", 2)
                if len(parts) < 2:
                    continue
                sid, kind = parts[0], parts[1]
                if sid not in pending:
                    continue
                isin = pending[sid]
                if kind == "A" and len(parts) == 3:
                    try:
                        data = json.loads(parts[2])
                    except Exception:
                        data = {}
                    exchanges = data.get("exchanges") or []
                    chosen = next((x for x in exchanges if x.get("slug") == "LSX" and x.get("active", True)), None)
                    if chosen is None:
                        chosen = next((x for x in exchanges if x.get("slug") == "LSX"), None)
                    if chosen and chosen.get("symbolAtExchange"):
                        cache[isin] = {
                            "trTicker": chosen.get("symbolAtExchange"),
                            "trExchange": chosen.get("slug") or "LSX",
                            "trNameAtExchange": chosen.get("nameAtExchange") or data.get("name"),
                            "trWkn": data.get("wkn"),
                            "trActive": bool(chosen.get("active", data.get("active", True))),
                        }
                    try:
                        ws.send(f"unsub {sid}")
                    except Exception:
                        pass
                    pending.pop(sid, None)
                elif kind in ("E", "C"):
                    pending.pop(sid, None)
            time.sleep(0.12)
    except Exception as exc:
        print("trade republic metadata warning", str(exc))
    finally:
        if ws is not None:
            try:
                ws.close()
            except Exception:
                pass
    return cache

def event_date(v):
    if v in (None, ""):
        return None
    try:
        if isinstance(v, (int, float)):
            return dt.datetime.fromtimestamp(v, tz=dt.timezone.utc)
        d = dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)
    except Exception:
        return None

def classify_news(title):
    t = (title or "").lower()
    groups = [
        ("medical", r"\b(fda|pdufa|clinical|trial|phase\s*[123]|topline|patient|endpoint|drug|therapy|vaccine|biotech|study|oncology|drug approval|fda approval)\b"),
        ("earnings", r"\b(earnings|quarter|quarterly|results|revenue|eps|guidance|outlook|profit|sales forecast)\b"),
        ("financing", r"\b(offering|dilution|dilutive|shelf|at-the-market|atm offering|convertible|warrants?|registered direct|private placement|notes offering|capital raise)\b"),
        ("contract", r"\b(contract|award|order|adjudication|partnership|partner|agreement|deal|tender|procurement|customer|license agreement)\b"),
        ("corporate", r"\b(merger|acquisition|acquire|takeover|buyout|spin-?off|divest|strategic alternatives|bankruptcy|chapter 11|reverse split|stock split|buyback)\b"),
        ("regulatory", r"\b(sec\b|lawsuit|litigation|investigation|regulator|antitrust|doj\b|ftc\b|subpoena|compliance|delisting|nasdaq notice|patent ruling)\b"),
        ("analyst", r"\b(analyst|upgrade|downgrade|price target|rating|initiates|reiterates|overweight|underweight|buy rating|sell rating)\b"),
        ("event", r"\b(conference|investor day|presentation|fireside|symposium|meeting|demo|launch event|expo|webcast)\b"),
    ]
    for category, pattern in groups:
        if re.search(pattern, t, re.I):
            return category
    return "news"

def impact_score(category, urgency, title):
    base = {
        "medical": 92, "financing": 88, "regulatory": 86, "corporate": 84,
        "contract": 80, "earnings": 78, "analyst": 60, "event": 56, "news": 48,
    }.get(category, 45)
    if urgency == 1:
        base += 8
    elif urgency == 2:
        base += 4
    title_l = (title or "").lower()
    if re.search(r"\b(halts?|bankruptcy|chapter 11|fda approves?|meets? primary endpoint|fails? primary endpoint|acquisition|merger|offering)\b", title_l):
        base += 5
    return min(base, 100)

def hypothesis_for(category):
    return {
        "medical": "Datos clínicos, decisiones FDA o avances sanitarios pueden provocar movimientos bruscos, especialmente en biotech. No determinan por sí solos la dirección.",
        "earnings": "Resultados y guidance pueden cambiar rápidamente las expectativas de valoración y volatilidad.",
        "financing": "Financiación, ofertas, convertibles o warrants pueden alterar caja, oferta de acciones y riesgo de dilución.",
        "contract": "Contratos, adjudicaciones o acuerdos pueden modificar expectativas de ingresos o crecimiento.",
        "corporate": "Operaciones corporativas, M&A, splits o reestructuraciones pueden alterar la valoración y la liquidez.",
        "regulatory": "Decisiones regulatorias, legales o de cotización pueden afectar de forma material a la acción.",
        "analyst": "Cambios de rating o precio objetivo pueden generar flujo y volatilidad, aunque no cambian por sí solos los fundamentales.",
        "event": "Presentaciones, conferencias y eventos pueden introducir información nueva o cambiar expectativas.",
        "news": "La noticia está vinculada al valor y puede afectar expectativas o volatilidad; requiere revisar el contenido y la fuente.",
    }.get(category, "Puede aumentar la volatilidad; no implica una dirección concreta.")


def source_tier(name):
    n = (name or "").strip().lower()
    primary = (
        "reuters","dow jones","businesswire","business wire","pr newswire",
        "globenewswire","accesswire","sec","securities and exchange",
        "fda","food and drug administration","nasdaq","nyse","investor relations"
    )
    reputable = (
        "tradingview","investing","benzinga","zacks","quartr","seeking alpha",
        "marketwatch","bloomberg","cnbc","yahoo finance","dpa-afx","dpa_afx",
        "mt newswires","tipranks","the fly"
    )
    if any(x in n for x in primary):
        return 3
    if any(x in n for x in reputable):
        return 2
    return 0

def source_kind(name):
    tier = source_tier(name)
    return "primaria / alta confianza" if tier >= 3 else "medio financiero reputado" if tier == 2 else "sin validar"

def story_norm(title):
    s = unicodedata.normalize("NFKD", title or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(nasdaq|nyse|amex|stock|shares?|inc|corp|corporation|company|ltd|plc)\b", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    stop = {"the","a","an","and","or","to","of","for","in","on","as","with","at","by","from","is","are"}
    return " ".join(x for x in s.split() if x not in stop)

def same_story(a, b):
    if a.get("ticker") != b.get("ticker"):
        return False
    da = event_date(a.get("date"))
    db = event_date(b.get("date"))
    if da and db and abs((da - db).total_seconds()) > 3 * 86400:
        return False
    ta, tb = story_norm(a.get("title")), story_norm(b.get("title"))
    if not ta or not tb:
        return False
    ratio = SequenceMatcher(None, ta, tb).ratio()
    sa, sb = set(ta.split()), set(tb.split())
    overlap = len(sa & sb) / max(1, len(sa | sb))
    return ratio >= 0.70 or overlap >= 0.60

def cluster_news_events(events):
    """Merge copies of the same story while preserving independent source links."""
    clusters = []
    for e in sorted(events, key=lambda x: (x.get("ticker") or "", x.get("date") or "")):
        match = None
        for cl in clusters:
            if cl["ticker"] == e.get("ticker") and same_story(cl["items"][0], e):
                match = cl
                break
        if match is None:
            match = {"ticker": e.get("ticker"), "items": []}
            clusters.append(match)
        match["items"].append(e)

    out = []
    for cl in clusters:
        items = cl["items"]
        sources = []
        seen_sources = set()
        for item in items:
            name = item.get("source") or "Fuente"
            tier = source_tier(name)
            if tier < 2:
                continue
            url = item.get("url")
            key = (name.strip().lower(), url or "")
            if key in seen_sources:
                continue
            seen_sources.add(key)
            sources.append({"name": name, "url": url, "tier": tier, "kind": source_kind(name)})

        # Do not publish stories supported only by unvalidated/community feeds.
        if not sources:
            continue

        best = max(
            items,
            key=lambda x: (
                source_tier(x.get("source")),
                x.get("impactScore") or 0,
                len(x.get("title") or ""),
            ),
        ).copy()
        sources.sort(key=lambda s: (-s["tier"], s["name"].lower()))
        best["sources"] = sources
        best["sourceCount"] = len(sources)
        best["corroborated"] = len({s["name"].lower() for s in sources}) >= 2
        best["verification"] = (
            f"Contrastada en {best['sourceCount']} fuentes"
            if best["corroborated"]
            else f"Fuente validada: {sources[0]['name']}"
        )
        best["relatedHeadlines"] = len(items)
        best["impactScore"] = max((x.get("impactScore") or 0) for x in items)
        best["date"] = max((x.get("date") or "") for x in items)
        out.append(best)

    return out

def fetch_news(symbol=None):
    params = {"client": "web", "lang": "en"}
    if symbol:
        params["symbol"] = symbol
    try:
        r = requests.get(NEWS_URL, params=params, headers=HEADERS, timeout=25)
        r.raise_for_status()
        return (r.json() or {}).get("items") or []
    except Exception as exc:
        print("news warning", symbol or "global", str(exc))
        return []

def mover_score(s):
    changes = [
        abs(float(s.get("changePct") or 0)),
        abs(float(s.get("premarketChangePct") or 0)),
        abs(float(s.get("postmarketChangePct") or 0)),
    ]
    rel = min(float(s.get("relVolume") or 0), 10)
    return max(changes) + rel * 2

def build_news_events(stocks, now):
    by_symbol = {s.get("tvSymbol"): s for s in stocks if s.get("tvSymbol")}
    cutoff = now - dt.timedelta(days=NEWS_DAYS)
    seen = set()
    out = []

    def add_items(items, fallback_symbol=None, max_for_symbol=None):
        accepted = 0
        for item in items:
            published = event_date(item.get("published"))
            if not published or published < cutoff or published > now + dt.timedelta(hours=1):
                continue

            related = []
            for rs in item.get("relatedSymbols") or []:
                sym = rs.get("symbol") if isinstance(rs, dict) else None
                if sym in by_symbol:
                    related.append(sym)
            if fallback_symbol in by_symbol and fallback_symbol not in related:
                related.insert(0, fallback_symbol)
            if not related:
                continue

            category = classify_news(item.get("title"))
            urgency = item.get("urgency")
            url = item.get("link")
            if not url and item.get("storyPath"):
                url = "https://www.tradingview.com" + str(item["storyPath"])

            for sym in related[:4]:
                key = (str(item.get("id") or item.get("title")), sym)
                if key in seen:
                    continue
                seen.add(key)
                s = by_symbol[sym]
                out.append({
                    "id": str(item.get("id") or ""),
                    "eventKind": "news",
                    "ticker": s["ticker"],
                    "name": s["name"],
                    "exchange": s["exchange"],
                    "date": published.isoformat(),
                    "type": category,
                    "title": item.get("title") or "Noticia relacionada",
                    "source": item.get("source") or item.get("provider") or "TradingView News",
                    "url": url,
                    "urgency": urgency,
                    "impactScore": impact_score(category, urgency, item.get("title")),
                    "tradeRepublicVerified": bool(s.get("tradeRepublicVerified")),
                    "isin": s.get("isin"),
                    "fact": item.get("title") or "Noticia relacionada con el valor.",
                    "hypothesis": hypothesis_for(category),
                })
                accepted += 1
                if max_for_symbol and accepted >= max_for_symbol:
                    return

    add_items(fetch_news())

    candidates = sorted(stocks, key=mover_score, reverse=True)
    chosen = []
    seen_symbols = set()
    for s in candidates:
        sym = s.get("tvSymbol")
        if not sym or sym in seen_symbols:
            continue
        chosen.append(sym)
        seen_symbols.add(sym)
        if len(chosen) >= NEWS_SYMBOL_LIMIT:
            break

    for i, sym in enumerate(chosen, 1):
        add_items(fetch_news(sym), fallback_symbol=sym, max_for_symbol=NEWS_PER_SYMBOL)
        if i < len(chosen):
            time.sleep(0.35)

    return cluster_news_events(out)

def main():
    previous = {}
    if OUT.exists():
        try:
            previous = json.loads(OUT.read_text())
        except Exception:
            pass

    idx, tr_count, tr_source = tr_universe()

    try:
        stocks, total = tv()
    except Exception as exc:
        if previous.get("stocks"):
            previous.setdefault("meta", {})["lastError"] = str(exc)
            OUT.write_text(json.dumps(previous, ensure_ascii=False, separators=(",", ":")))
        raise

    matched = 0
    for s in stocks:
        isin = tr_match(s["name"], idx) if idx else None
        s["isin"] = isin
        s["tradeRepublicVerified"] = bool(isin)
        if isin:
            matched += 1

    tr_meta = fetch_tr_metadata(stocks, previous)
    tr_ticker_count = 0
    for s in stocks:
        meta = tr_meta.get(s.get("isin"))
        if meta:
            for key, value in meta.items():
                if value is not None and value != "":
                    s[key] = value
            if s.get("trTicker"):
                tr_ticker_count += 1
        for key in list(s):
            if s[key] is None or s[key] == "":
                del s[key]

    now = dt.datetime.now(dt.timezone.utc)
    events = []

    for s in stocks:
        d = event_date(s.get("earningsDate"))
        if d and now - dt.timedelta(days=1) <= d <= now + dt.timedelta(days=90):
            events.append({
                "eventKind": "scheduled",
                "ticker": s["ticker"],
                "name": s["name"],
                "exchange": s["exchange"],
                "date": d.isoformat(),
                "type": "earnings",
                "title": "Próxima publicación de resultados",
                "source": "TradingView",
                "sources": [{"name": "TradingView", "url": None, "tier": 2, "kind": "medio financiero reputado"}],
                "sourceCount": 1,
                "corroborated": False,
                "verification": "Calendario de mercado: TradingView",
                "timeCode": s.get("earningsTimeCode"),
                "impactScore": 76,
                "tradeRepublicVerified": s["tradeRepublicVerified"],
                "fact": "Fecha de resultados indicada por el proveedor de mercado.",
                "hypothesis": hypothesis_for("earnings"),
                "isin": s.get("isin"),
            })

    news_events = build_news_events(stocks, now)
    events.extend(news_events)

    events.sort(key=lambda e: (
        -(e.get("impactScore") or 0),
        e.get("date") or "",
        e.get("ticker") or "",
    ))

    obj = {
        "meta": {
            "updatedAt": now.isoformat(),
            "source": "TradingView screener + TradingView News",
            "totalProvider": total,
            "trOfficialCount": tr_count,
            "trMatchedCount": matched,
            "trTickerCount": tr_ticker_count,
            "trUniverseSource": tr_source,
            "newsCount": len(news_events),
            "notes": "Datos públicos o diferidos según proveedor. Las noticias se agrupan por hecho y solo se publican si proceden de una fuente financiera reputada o primaria. Las fuentes múltiples se conservan como contraste. ChatGPT no se usa como fuente primaria.",
        },
        "stocks": stocks,
        "events": events,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
    print(len(stocks), "stocks;", matched, "TR matches;", tr_ticker_count, "TR tickers;", len(events), "events;", len(news_events), "news")

if __name__ == "__main__":
    main()
