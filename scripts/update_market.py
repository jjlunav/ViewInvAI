#!/usr/bin/env python3
import json
import os
import re
import time
import unicodedata
import datetime as dt
from difflib import SequenceMatcher
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path
from urllib.parse import urlencode

import requests
import websocket
from pypdf import PdfReader

TV_URL = "https://scanner.tradingview.com/america/scan"
TV_FOREX_URL = "https://scanner.tradingview.com/forex/scan"
TV_SEARCH_URL = "https://symbol-search.tradingview.com/symbol_search/v3/"
NEWS_URL = "https://news-headlines.tradingview.com/v2/headlines"
TR_WS_URL = "wss://api.traderepublic.com"
TR_URLS = [
    "https://assets.traderepublic.com/assets/files/ES/Instrument_Universe_ES_en.pdf",
    "https://assets.traderepublic.com/assets/files/DE/Instrument_Universe_DE_en.pdf",
]
OUT = Path("data/market.json")
VERSION_OUT = Path("data/market-version.json")
TR_PDF_MAX_BYTES = 50 * 1024 * 1024
TR_PDF_MAX_PAGES = 5000
NEWS_SYMBOL_LIMIT = 60
NEWS_DAYS = 7
NEWS_PER_SYMBOL = 10
TR_METADATA_LIMIT = 2200  # enough to complete unresolved TR/LSX symbols in one pass
TR_METADATA_BATCH = 75
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers_exchange.json"
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
SEC_USER_AGENT = os.environ.get("SEC_USER_AGENT", "").strip()
SEC_REFRESH_MINUTES = 30
SEC_SYMBOL_LIMIT = 30
CLINICALTRIALS_URL = "https://clinicaltrials.gov/api/v2/studies"
CLINICAL_REFRESH_HOURS = 6
CLINICAL_SYMBOL_LIMIT = 18
CLINICAL_STUDY_LIMIT = 60
CLINICAL_LOOKAHEAD_DAYS = 120

COLS = [
    "name","description","type","exchange","currency","sector","industry","market_cap_basic","close","change","high","low","bid","ask","volume",
    "average_volume_10d_calc","relative_volume_10d_calc",
    "premarket_close","premarket_change","premarket_volume","premarket_time",
    "postmarket_close","postmarket_change","postmarket_volume","postmarket_time",
    "RSI","ADX","EMA20","EMA50","Perf.W","Perf.1M","Perf.3M","Perf.6M","Perf.YTD","Perf.1Y",
    "price_earnings_ttm","earnings_per_share_diluted_ttm","dividends_yield_current","beta_1_year",
    "total_shares_outstanding","total_revenue","net_income_ttm","price_book_fq","enterprise_value_fq","fundamental_currency_code",
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
    pdf_bytes = None
    for url in TR_URLS:
        try:
            r = requests.get(url, headers=HEADERS, timeout=60)
            content = r.content if r.ok else b""
            if (
                content[:4] == b"%PDF"
                and 0 < len(content) <= TR_PDF_MAX_BYTES
            ):
                pdf_bytes = content
                source = url
                break
        except Exception:
            pass
    if not source or not pdf_bytes:
        return {}, 0, None

    pat = re.compile(r"^([A-Z]{2}[A-Z0-9]{10})\s+(.+)$")
    rows = []
    reader = PdfReader(BytesIO(pdf_bytes), strict=False)
    if len(reader.pages) > TR_PDF_MAX_PAGES:
        raise RuntimeError("Trade Republic universe PDF exceeds page safety limit")
    for page in reader.pages:
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
            "instrumentType": d.get("type") or "stock",
            "exchange": d.get("exchange") or ex,
            "currency": d.get("currency") or "USD",
            "sector": d.get("sector"),
            "industry": d.get("industry"),
            "marketCap": d.get("market_cap_basic"),
            "price": d.get("close"),
            "changePct": d.get("change"),
            "dayHigh": d.get("high"),
            "dayLow": d.get("low"),
            "usBid": d.get("bid"),
            "usAsk": d.get("ask"),
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
            "perf3M": d.get("Perf.3M"),
            "perf6M": d.get("Perf.6M"),
            "perfYtd": d.get("Perf.YTD"),
            "perf1Y": d.get("Perf.1Y"),
            "peRatio": d.get("price_earnings_ttm"),
            "epsDilutedTtm": d.get("earnings_per_share_diluted_ttm"),
            "dividendYield": d.get("dividends_yield_current"),
            "beta1Y": d.get("beta_1_year"),
            "sharesOutstanding": d.get("total_shares_outstanding"),
            "revenueTtm": d.get("total_revenue"),
            "netIncomeTtm": d.get("net_income_ttm"),
            "priceBook": d.get("price_book_fq"),
            "enterpriseValue": d.get("enterprise_value_fq"),
            "fundamentalCurrency": d.get("fundamental_currency_code"),
            "earningsDate": d.get("earnings_release_next_date") or d.get("earnings_release_next_calendar_date") or d.get("earnings_release_next_trading_date_fq"),
            "earningsCalendarDate": d.get("earnings_release_next_calendar_date"),
            "earningsTimeCode": d.get("earnings_release_next_time"),
            "updateMode": d.get("update_mode"),
            "lastBarUpdateTime": d.get("last_bar_update_time"),
        })
    return out, total



def clean_tv_text(value):
    return re.sub(r"</?em>", "", str(value or "")).strip()

def fetch_us_isin(stock):
    ticker = stock.get("ticker")
    exchange = stock.get("exchange")
    if not ticker or not exchange:
        return None
    params = {
        "text": ticker,
        "hl": 0,
        "exchange": exchange,
        "lang": "en",
        "search_type": stock.get("instrumentType") or "undefined",
        "domain": "production",
    }
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Origin": "https://www.tradingview.com",
    }
    try:
        r = requests.get(TV_SEARCH_URL, params=params, headers=headers, timeout=15)
        r.raise_for_status()
        items = (r.json() or {}).get("symbols") or []
        ex_norm = str(exchange).upper().replace(" ", "")
        for item in items:
            sym = clean_tv_text(item.get("symbol"))
            ex = clean_tv_text(item.get("exchange")).upper().replace(" ", "")
            if sym.upper() == str(ticker).upper() and ex == ex_norm and item.get("isin"):
                return str(item["isin"]).strip().upper()
        # A few feeds normalize NYSE ARCA differently. Exact ticker is still
        # required; use the first ISIN only when there is one unambiguous match.
        exact = [
            str(item.get("isin")).strip().upper()
            for item in items
            if clean_tv_text(item.get("symbol")).upper() == str(ticker).upper() and item.get("isin")
        ]
        exact = list(dict.fromkeys(exact))
        return exact[0] if len(exact) == 1 else None
    except Exception:
        return None

def verify_us_isins(stocks, previous):
    prev_by_symbol = {
        row.get("tvSymbol"): row
        for row in previous.get("stocks") or []
        if row.get("tvSymbol")
    }
    pending = []
    for stock in stocks:
        prev = prev_by_symbol.get(stock.get("tvSymbol")) or {}
        cached = prev.get("usIsin")
        if cached:
            stock["usIsin"] = cached
        elif stock.get("trIsin"):
            pending.append(stock)

    # Eight workers keeps the public search endpoint load modest while allowing
    # all TR candidates to be validated within the scheduled workflow.
    with ThreadPoolExecutor(max_workers=8) as pool:
        future_map = {pool.submit(fetch_us_isin, stock): stock for stock in pending}
        for future in as_completed(future_map):
            stock = future_map[future]
            try:
                us_isin = future.result()
            except Exception:
                us_isin = None
            if us_isin:
                stock["usIsin"] = us_isin

    same = different = unresolved = 0
    for stock in stocks:
        tr_isin = stock.get("trIsin")
        us_isin = stock.get("usIsin")
        if tr_isin and us_isin:
            if str(tr_isin).upper() == str(us_isin).upper():
                stock["instrumentLinkStatus"] = "same_isin"
                stock["isinLinkVerified"] = True
                stock["tradeRepublicVerified"] = True
                stock["isin"] = us_isin
                same += 1
            else:
                stock["instrumentLinkStatus"] = "different_isin"
                stock["isinLinkVerified"] = False
                stock["tradeRepublicVerified"] = False
                stock["isin"] = us_isin
                different += 1
        elif tr_isin:
            stock["instrumentLinkStatus"] = "unverified"
            stock["isinLinkVerified"] = False
            # The instrument exists in the TR universe, but its US cross-market identity
            # is unresolved. Keep it as a candidate, never as verified.
            stock["tradeRepublicVerified"] = False
            stock["isin"] = tr_isin
            unresolved += 1
        elif us_isin:
            stock["isin"] = us_isin
            stock["tradeRepublicVerified"] = False
        else:
            stock["tradeRepublicVerified"] = False
    return same, different, unresolved

def attach_sec_ciks(stocks, previous):
    """Attach SEC CIKs from the official ticker map when a declared user-agent is configured.

    SEC asks automated clients to identify themselves. If SEC_USER_AGENT is not
    configured, the updater simply preserves previously resolved CIKs and makes
    no SEC request.
    """
    prev_by_symbol = {
        row.get("tvSymbol"): row
        for row in previous.get("stocks") or []
        if row.get("tvSymbol")
    }
    for stock in stocks:
        prev = prev_by_symbol.get(stock.get("tvSymbol")) or {}
        if prev.get("secCik"):
            stock["secCik"] = str(prev["secCik"]).zfill(10)
        if prev.get("secName"):
            stock["secName"] = prev["secName"]

    if not SEC_USER_AGENT:
        return sum(1 for stock in stocks if stock.get("secCik")), False

    headers = {
        "User-Agent": SEC_USER_AGENT,
        "Accept-Encoding": "gzip, deflate",
        "Accept": "application/json",
    }
    try:
        response = requests.get(SEC_TICKERS_URL, headers=headers, timeout=25)
        response.raise_for_status()
        payload = response.json() or {}
        fields = payload.get("fields") or []
        data = payload.get("data") or []
        if not fields or not data:
            return sum(1 for stock in stocks if stock.get("secCik")), False
        idx = {name: i for i, name in enumerate(fields)}
        ticker_i = idx.get("ticker")
        cik_i = idx.get("cik")
        name_i = idx.get("name")
        if ticker_i is None or cik_i is None:
            return sum(1 for stock in stocks if stock.get("secCik")), False

        by_ticker = {}
        for row in data:
            try:
                ticker = str(row[ticker_i] or "").strip().upper()
                cik = str(int(row[cik_i])).zfill(10)
            except Exception:
                continue
            if not ticker:
                continue
            by_ticker.setdefault(ticker, []).append({
                "cik": cik,
                "name": str(row[name_i] or "").strip() if name_i is not None else "",
            })

        for stock in stocks:
            ticker = str(stock.get("ticker") or "").strip().upper()
            matches = by_ticker.get(ticker) or []
            if len(matches) == 1:
                stock["secCik"] = matches[0]["cik"]
                if matches[0]["name"]:
                    stock["secName"] = matches[0]["name"]
        return sum(1 for stock in stocks if stock.get("secCik")), True
    except Exception as exc:
        print("sec ticker map warning", str(exc))
        return sum(1 for stock in stocks if stock.get("secCik")), False


def sec_event_type(form, description=""):
    text = (str(form or "") + " " + str(description or "")).lower()
    if any(x in text for x in ("s-1", "s-3", "424b", "prospectus")):
        return "financing"
    if any(x in text for x in ("10-k", "10-q", "20-f", "40-f")):
        return "earnings"
    if "8-k" in text or "6-k" in text:
        return "corporate"
    return "regulatory"


def carry_previous_sec_events(previous, now):
    cutoff = now - dt.timedelta(days=NEWS_DAYS)
    rows = []
    for event in previous.get("events") or []:
        if event.get("sourceFamily") != "sec":
            continue
        when = event_date(event.get("date"))
        if when and cutoff <= when <= now + dt.timedelta(hours=1):
            rows.append(event)
    return rows


def fetch_sec_events(stocks, previous, now):
    previous_events = carry_previous_sec_events(previous, now)
    if not SEC_USER_AGENT:
        return previous_events, None, False

    prev_updated = event_date((previous.get("meta") or {}).get("secUpdatedAt"))
    if prev_updated and (now - prev_updated).total_seconds() < SEC_REFRESH_MINUTES * 60:
        return previous_events, prev_updated.isoformat(), False

    headers = {
        "User-Agent": SEC_USER_AGENT,
        "Accept-Encoding": "gzip, deflate",
        "Accept": "application/json",
    }
    chosen = [
        stock for stock in sorted(stocks, key=mover_score, reverse=True)
        if stock.get("secCik")
    ][:SEC_SYMBOL_LIMIT]
    if not chosen:
        return previous_events, now.isoformat(), True

    cutoff = now - dt.timedelta(days=NEWS_DAYS)
    out = []
    seen = set()

    def fetch_one(stock):
        cik = str(stock.get("secCik") or "").zfill(10)
        response = requests.get(SEC_SUBMISSIONS_URL.format(cik=cik), headers=headers, timeout=20)
        response.raise_for_status()
        payload = response.json() or {}
        recent = ((payload.get("filings") or {}).get("recent") or {})
        forms = recent.get("form") or []
        accessions = recent.get("accessionNumber") or []
        filing_dates = recent.get("filingDate") or []
        primary_docs = recent.get("primaryDocument") or []
        descriptions = recent.get("primaryDocDescription") or []
        rows = []
        count = min(len(forms), len(accessions), len(filing_dates))
        for i in range(count):
            form = str(forms[i] or "").strip().upper()
            if not (
                form in {"8-K", "8-K/A", "10-Q", "10-Q/A", "10-K", "10-K/A", "6-K", "6-K/A", "20-F", "40-F", "DEF 14A"}
                or form.startswith("S-1")
                or form.startswith("S-3")
                or form.startswith("424B")
            ):
                continue
            try:
                filed = dt.datetime.fromisoformat(str(filing_dates[i])).replace(tzinfo=dt.timezone.utc)
            except Exception:
                continue
            if filed < cutoff or filed > now + dt.timedelta(days=1):
                continue
            accession = str(accessions[i] or "")
            clean_accession = accession.replace("-", "")
            document = str(primary_docs[i] or "") if i < len(primary_docs) else ""
            description = str(descriptions[i] or "") if i < len(descriptions) else ""
            cik_int = str(int(cik))
            url = (
                f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{clean_accession}/{document}"
                if clean_accession and document else
                f"https://www.sec.gov/edgar/browse/?CIK={cik_int}"
            )
            event_type = sec_event_type(form, description)
            title = f"SEC {form}" + (f" · {description}" if description else "")
            rows.append({
                "id": f"sec:{cik}:{accession}",
                "eventKind": "news",
                "ticker": stock.get("ticker"),
                "name": stock.get("name"),
                "exchange": stock.get("exchange"),
                "date": filed.isoformat(),
                "type": event_type,
                "title": title[:240],
                "source": "SEC EDGAR",
                "sourceFamily": "sec",
                "url": url,
                "sources": [{
                    "name": "SEC EDGAR",
                    "url": url,
                    "tier": 3,
                    "kind": "fuente oficial / primaria",
                    "family": "official",
                    "independent": False,
                }],
                "sourceCount": 1,
                "independentSourceCount": 0,
                "corroborated": False,
                "verification": "Documento oficial SEC / EDGAR",
                "impactScore": 86 if event_type in {"financing", "earnings"} else 78,
                "tradeRepublicVerified": bool(stock.get("tradeRepublicVerified")),
                "tradeRepublicTradable": bool(stock.get("tradeRepublicTradable")),
                "fact": f"Presentación oficial {form} registrada en SEC/EDGAR.",
                "hypothesis": hypothesis_for(event_type),
                "isin": stock.get("isin"),
                "secCik": cik,
                "secForm": form,
                "accessionNumber": accession,
            })
        return rows

    with ThreadPoolExecutor(max_workers=4) as pool:
        future_map = {pool.submit(fetch_one, stock): stock for stock in chosen}
        for future in as_completed(future_map):
            try:
                rows = future.result()
            except Exception as exc:
                print("sec submissions warning", future_map[future].get("ticker"), str(exc))
                continue
            for event in rows:
                key = event.get("id")
                if key and key not in seen:
                    seen.add(key)
                    out.append(event)

    if not out and previous_events:
        out = previous_events
    return out, now.isoformat(), True


CLINICAL_GENERIC_TOKENS = {
    "and", "bio", "biotech", "biotechnology", "bioscience", "biosciences",
    "health", "medical", "medicine", "pharma", "pharmaceutical", "pharmaceuticals",
    "science", "sciences", "technology", "technologies", "therapeutic", "therapeutics",
}


def clinical_company_tokens(value):
    return [
        token for token in norm(value).split()
        if len(token) >= 4 and token not in CLINICAL_GENERIC_TOKENS
    ]


def clinical_company_query(value):
    tokens = clinical_company_tokens(value)
    return " ".join(tokens[:3]) or norm(value)


def clinical_sponsor_matches(company_name, sponsor_name):
    company = norm(company_name)
    sponsor = norm(sponsor_name)
    if not company or not sponsor:
        return False
    compact_company = company.replace(" ", "")
    compact_sponsor = sponsor.replace(" ", "")
    shorter = min(len(compact_company), len(compact_sponsor))
    if shorter >= 6 and (
        compact_company == compact_sponsor
        or compact_company.startswith(compact_sponsor)
        or compact_sponsor.startswith(compact_company)
    ):
        return True

    company_tokens = clinical_company_tokens(company_name)
    sponsor_tokens = clinical_company_tokens(sponsor_name)
    if not company_tokens or not sponsor_tokens:
        return False
    common = set(company_tokens) & set(sponsor_tokens)
    if any(len(token) >= 5 for token in common) and min(len(company_tokens), len(sponsor_tokens)) <= 2:
        return True
    union = set(company_tokens) | set(sponsor_tokens)
    if union and len(common) / len(union) >= 0.5:
        return True
    return SequenceMatcher(None, " ".join(company_tokens), " ".join(sponsor_tokens)).ratio() >= 0.82


def clinical_exact_date(value):
    text = str(value or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return None
    try:
        return dt.datetime.fromisoformat(text).replace(tzinfo=dt.timezone.utc)
    except Exception:
        return None


def clinical_candidate(stock):
    text = " ".join(str(stock.get(key) or "") for key in ("sector", "industry", "name")).lower()
    return any(term in text for term in (
        "biotechnology", "biotech", "biopharma", "biopharmaceutical",
        "pharmaceutical", "therapeutics",
    ))


def carry_previous_clinical_events(previous, now):
    start = now - dt.timedelta(days=1)
    end = now + dt.timedelta(days=CLINICAL_LOOKAHEAD_DAYS)
    rows = []
    for event in previous.get("events") or []:
        if event.get("sourceFamily") != "clinicaltrials":
            continue
        when = event_date(event.get("date"))
        if when and start <= when <= end:
            rows.append(event)
    return rows


def fetch_clinical_events(stocks, previous, now):
    previous_events = carry_previous_clinical_events(previous, now)
    prev_updated = event_date((previous.get("meta") or {}).get("clinicalUpdatedAt"))
    if prev_updated and (now - prev_updated).total_seconds() < CLINICAL_REFRESH_HOURS * 3600:
        return previous_events, prev_updated.isoformat(), False

    candidates = [stock for stock in stocks if clinical_candidate(stock)]
    candidates.sort(
        key=lambda stock: (
            1 if stock.get("tradeRepublicTradable") else 0,
            mover_score(stock),
        ),
        reverse=True,
    )
    chosen = candidates[:CLINICAL_SYMBOL_LIMIT]
    if not chosen:
        return previous_events, now.isoformat(), True

    start = now - dt.timedelta(days=1)
    end = now + dt.timedelta(days=CLINICAL_LOOKAHEAD_DAYS)
    headers = {
        "User-Agent": "ViewInvAI/0.4 market-research",
        "Accept": "application/json",
    }

    def phase_label(phases):
        phases = [str(value or "").upper() for value in (phases or [])]
        if "PHASE3" in phases:
            return "Fase 3", 68
        if "PHASE2" in phases:
            return "Fase 2", 58
        if "PHASE1" in phases or "EARLY_PHASE1" in phases:
            return "Fase 1", 46
        if "PHASE4" in phases:
            return "Fase 4", 50
        return "Ensayo clínico", 42

    def fetch_one(stock):
        query = clinical_company_query(stock.get("name"))
        if not query:
            return []
        response = requests.get(
            CLINICALTRIALS_URL,
            params={
                "query.lead": query,
                "filter.overallStatus": "RECRUITING|NOT_YET_RECRUITING|ACTIVE_NOT_RECRUITING|ENROLLING_BY_INVITATION",
                "pageSize": CLINICAL_STUDY_LIMIT,
                "format": "json",
            },
            headers=headers,
            timeout=25,
        )
        response.raise_for_status()
        payload = response.json() or {}
        rows = []
        for study in payload.get("studies") or []:
            protocol = (study or {}).get("protocolSection") or {}
            identification = protocol.get("identificationModule") or {}
            sponsor_module = protocol.get("sponsorCollaboratorsModule") or {}
            lead = sponsor_module.get("leadSponsor") or {}
            lead_name = str(lead.get("name") or "").strip()
            lead_class = str(lead.get("class") or "").strip().upper()
            if lead_class and lead_class != "INDUSTRY":
                continue
            if not clinical_sponsor_matches(stock.get("name"), lead_name):
                continue

            status_module = protocol.get("statusModule") or {}
            primary = status_module.get("primaryCompletionDateStruct") or {}
            completion = status_module.get("completionDateStruct") or {}
            date_struct = primary if primary.get("date") else completion
            when = clinical_exact_date(date_struct.get("date"))
            if not when or when < start or when > end:
                continue

            nct = str(identification.get("nctId") or "").strip()
            if not nct:
                continue
            design = protocol.get("designModule") or {}
            phase, impact = phase_label(design.get("phases") or [])
            overall_status = str(status_module.get("overallStatus") or "").replace("_", " ").title()
            date_type = str(date_struct.get("type") or "").upper()
            estimated = date_type == "ESTIMATED"
            date_kind = "finalización primaria" if primary.get("date") else "finalización del estudio"
            brief_title = str(identification.get("briefTitle") or "").strip()
            url = f"https://clinicaltrials.gov/study/{nct}"
            date_word = "estimada" if estimated else "registrada"
            title = f"ClinicalTrials.gov · {date_kind} · {phase}"
            fact = (
                f"{lead_name} figura como lead sponsor. ClinicalTrials.gov marca el "
                f"{when.date().isoformat()} como fecha {date_word} de {date_kind}"
                + (f" para {brief_title}." if brief_title else ".")
            )
            rows.append({
                "id": f"clinicaltrials:{nct}:{date_kind.replace(' ', '-')}",
                "eventKind": "scheduled",
                "ticker": stock.get("ticker"),
                "name": stock.get("name"),
                "exchange": stock.get("exchange"),
                "date": when.isoformat(),
                "datePrecision": "day",
                "type": "medical",
                "title": title[:240],
                "source": "ClinicalTrials.gov",
                "sourceFamily": "clinicaltrials",
                "url": url,
                "sources": [{
                    "name": "ClinicalTrials.gov",
                    "url": url,
                    "tier": 3,
                    "kind": "registro oficial / fuente primaria",
                    "family": "official",
                    "independent": False,
                }],
                "sourceCount": 1,
                "independentSourceCount": 0,
                "corroborated": False,
                "verification": "Registro oficial ClinicalTrials.gov · lead sponsor validado",
                "impactScore": impact,
                "tradeRepublicVerified": bool(stock.get("tradeRepublicVerified")),
                "tradeRepublicTradable": bool(stock.get("tradeRepublicTradable")),
                "fact": fact[:700],
                "hypothesis": "La finalización del estudio puede aumentar la atención sobre el programa, pero no equivale a una fecha garantizada de publicación de resultados ni anticipa su dirección.",
                "isin": stock.get("isin"),
                "clinicalNct": nct,
                "clinicalPhase": phase,
                "clinicalStatus": overall_status,
                "clinicalLeadSponsor": lead_name,
                "clinicalDateType": date_type or None,
            })
        return rows

    out = []
    seen = set()
    failed_tickers = set()
    success_count = 0
    with ThreadPoolExecutor(max_workers=6) as pool:
        future_map = {pool.submit(fetch_one, stock): stock for stock in chosen}
        for future in as_completed(future_map):
            stock = future_map[future]
            try:
                rows = future.result()
                success_count += 1
            except Exception as exc:
                ticker = stock.get("ticker")
                failed_tickers.add(ticker)
                print("clinicaltrials warning", ticker, str(exc))
                continue
            for event in rows:
                key = event.get("id")
                if key and key not in seen:
                    seen.add(key)
                    out.append(event)

    if success_count == 0:
        return previous_events, (prev_updated.isoformat() if prev_updated else None), False

    for event in previous_events:
        if event.get("ticker") in failed_tickers and event.get("id") not in seen:
            seen.add(event.get("id"))
            out.append(event)
    return out, now.isoformat(), True


def cached_tr_metadata(previous):
    cache = {}
    for row in previous.get("stocks") or []:
        isin = row.get("trIsin") or row.get("isin")
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
        isin = row.get("trIsin")
        if not row.get("tradeRepublicVerified") or not isin or isin in seen or isin in cache:
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

def fetch_eur_usd(previous):
    """Latest EUR/USD reference used only for secondary currency display."""
    payload = {
        "symbols": {"tickers": ["FX_IDC:EURUSD"], "query": {"types": []}},
        "columns": ["close"],
    }
    headers = dict(HEADERS)
    headers["Content-Type"] = "application/json"
    try:
        r = requests.post(TV_FOREX_URL, json=payload, headers=headers, timeout=20)
        r.raise_for_status()
        rows = (r.json() or {}).get("data") or []
        if rows and rows[0].get("d"):
            rate = float(rows[0]["d"][0])
            if rate > 0:
                return rate, "TradingView FX_IDC:EURUSD"
    except Exception as exc:
        print("fx warning", str(exc))
    prev = (previous.get("meta") or {}).get("eurUsd")
    try:
        prev = float(prev)
        if prev > 0:
            return prev, (previous.get("meta") or {}).get("eurUsdSource") or "previous snapshot"
    except Exception:
        pass
    return None, None

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


def source_profile(name):
    n = (name or "").strip().lower()
    official = (
        "sec","securities and exchange","fda","food and drug administration",
        "nasdaq","nyse","investor relations"
    )
    issuer_wire = (
        "businesswire","business wire","pr newswire","globenewswire","accesswire"
    )
    independent = (
        "reuters","dow jones","bloomberg","cnbc","marketwatch","dpa-afx","dpa_afx",
        "mt newswires","the fly"
    )
    reputable = (
        "tradingview","investing","benzinga","zacks","quartr","seeking alpha",
        "yahoo finance","tipranks"
    )
    if any(x in n for x in official):
        return {"tier": 3, "kind": "fuente oficial / primaria", "family": "official", "independent": False}
    if any(x in n for x in issuer_wire):
        return {"tier": 3, "kind": "comunicado distribuido por el emisor", "family": "issuer-wire", "independent": False}
    if any(x in n for x in independent):
        return {"tier": 3, "kind": "medio financiero independiente", "family": "independent", "independent": True}
    if any(x in n for x in reputable):
        return {"tier": 2, "kind": "medio financiero reputado", "family": "reputable", "independent": True}
    return {"tier": 0, "kind": "sin validar", "family": "unknown", "independent": False}

def source_tier(name):
    return source_profile(name)["tier"]

def source_kind(name):
    return source_profile(name)["kind"]

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
            profile = source_profile(name)
            sources.append({
                "name": name,
                "url": url,
                "tier": tier,
                "kind": profile["kind"],
                "family": profile["family"],
                "independent": profile["independent"],
            })

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
        independent_names = {s["name"].lower() for s in sources if s.get("independent")}
        has_official = any(s.get("family") == "official" for s in sources)
        has_issuer_wire = any(s.get("family") == "issuer-wire" for s in sources)
        independent_confirmation = len(independent_names) >= 2 or (has_official and len(independent_names) >= 1)
        best["corroborated"] = independent_confirmation
        best["independentSourceCount"] = len(independent_names)
        best["verification"] = (
            f"Contrastada con {len(independent_names)} fuentes independientes"
            if len(independent_names) >= 2
            else "Fuente oficial + contraste independiente"
            if has_official and len(independent_names) >= 1
            else "Comunicado del emisor; sin confirmación independiente"
            if has_issuer_wire
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
                    "tradeRepublicTradable": bool(s.get("tradeRepublicTradable")),
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

def attach_previous_snapshot(stocks, previous, now):
    """Attach the immediately previous market snapshot for short-term acceleration detection.

    The scheduled workflow normally runs every five minutes. Only a recent snapshot is
    accepted so session resets or stale workflow runs cannot create false momentum.
    """
    prev_time = event_date((previous.get("meta") or {}).get("updatedAt"))
    if not prev_time:
        return None
    age_minutes = (now - prev_time).total_seconds() / 60.0
    if age_minutes < 1 or age_minutes > 20:
        return None

    prev_by_symbol = {
        row.get("tvSymbol"): row
        for row in previous.get("stocks") or []
        if row.get("tvSymbol")
    }
    fields = [
        ("changePct", "previousChangePct"),
        ("premarketChangePct", "previousPremarketChangePct"),
        ("postmarketChangePct", "previousPostmarketChangePct"),
        ("volume", "previousVolume"),
        ("premarketVolume", "previousPremarketVolume"),
        ("postmarketVolume", "previousPostmarketVolume"),
    ]
    attached = 0
    for stock in stocks:
        prev = prev_by_symbol.get(stock.get("tvSymbol"))
        if not prev:
            continue
        copied = False
        for source, target in fields:
            value = prev.get(source)
            if value is not None and value != "":
                stock[target] = value
                copied = True
        if copied:
            stock["momentumSnapshotMinutes"] = round(age_minutes, 2)
            attached += 1
    return attached

def main():
    previous = {}
    if OUT.exists():
        try:
            previous = json.loads(OUT.read_text())
        except Exception:
            pass

    now = dt.datetime.now(dt.timezone.utc)
    idx, tr_count, tr_source = tr_universe()
    eur_usd, eur_usd_source = fetch_eur_usd(previous)

    try:
        stocks, total = tv()
    except Exception as exc:
        if previous.get("stocks"):
            previous.setdefault("meta", {})["lastError"] = str(exc)
            OUT.write_text(json.dumps(previous, ensure_ascii=False, separators=(",", ":")))
        raise

    attach_previous_snapshot(stocks, previous, now)

    matched = 0
    for s in stocks:
        isin = tr_match(s["name"], idx) if idx else None
        s["trIsin"] = isin
        s["tradeRepublicCandidate"] = bool(isin)
        if isin:
            matched += 1

    same_isin, different_isin, unresolved_isin = verify_us_isins(stocks, previous)
    sec_cik_count, sec_map_refreshed = attach_sec_ciks(stocks, previous)

    tr_meta = fetch_tr_metadata(stocks, previous)
    tr_ticker_count = 0
    tr_tradable_count = 0
    for s in stocks:
        meta = tr_meta.get(s.get("trIsin"))
        if meta:
            for key, value in meta.items():
                if value is not None and value != "":
                    s[key] = value
            if s.get("trTicker"):
                tr_ticker_count += 1

        # Only expose a value in Trade Republic surfaces after the exact LSX
        # instrument metadata has resolved to an active exchange symbol.
        s["tradeRepublicTradable"] = bool(
            s.get("tradeRepublicVerified")
            and s.get("trIsin")
            and s.get("trTicker")
            and s.get("trActive", True) is not False
        )
        if s["tradeRepublicTradable"]:
            tr_tradable_count += 1

        for key in list(s):
            if s[key] is None or s[key] == "":
                del s[key]

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
                "tradeRepublicTradable": bool(s.get("tradeRepublicTradable")),
                "fact": "Fecha de resultados indicada por el proveedor de mercado.",
                "hypothesis": hypothesis_for("earnings"),
                "isin": s.get("isin"),
            })

    news_events = build_news_events(stocks, now)
    events.extend(news_events)

    sec_events, sec_updated_at, sec_refreshed = fetch_sec_events(stocks, previous, now)
    events.extend(sec_events)

    clinical_events, clinical_updated_at, clinical_refreshed = fetch_clinical_events(stocks, previous, now)
    events.extend(clinical_events)

    events.sort(key=lambda e: (
        -(e.get("impactScore") or 0),
        e.get("date") or "",
        e.get("ticker") or "",
    ))

    obj = {
        "meta": {
            "updatedAt": now.isoformat(),
            "source": "TradingView screener + TradingView News",
            "eurUsd": eur_usd,
            "eurUsdSource": eur_usd_source,
            "totalProvider": total,
            "trOfficialCount": tr_count,
            "trMatchedCount": matched,
            "trTickerCount": tr_ticker_count,
            "trTradableCount": tr_tradable_count,
            "sameIsinCount": same_isin,
            "differentIsinCount": different_isin,
            "unresolvedIsinCount": unresolved_isin,
            "trUniverseSource": tr_source,
            "newsCount": len(news_events),
            "secCikCount": sec_cik_count,
            "secEventCount": len(sec_events),
            "secUpdatedAt": sec_updated_at,
            "secEnabled": bool(SEC_USER_AGENT),
            "secMapRefreshed": sec_map_refreshed,
            "secRefreshed": sec_refreshed,
            "clinicalEventCount": len(clinical_events),
            "clinicalUpdatedAt": clinical_updated_at,
            "clinicalRefreshed": clinical_refreshed,
            "notes": "Datos públicos o diferidos según proveedor. Las noticias se agrupan por hecho y solo se publican si proceden de una fuente financiera reputada o primaria. SEC/EDGAR se consulta directamente cuando SEC_USER_AGENT está configurado. ClinicalTrials.gov se consulta directamente para ensayos con lead sponsor validado y solo se publican fechas con día exacto; una fecha de finalización de estudio no se presenta como fecha garantizada de resultados. Las fuentes múltiples se conservan como contraste. ChatGPT no se usa como fuente primaria.",
        },
        "stocks": stocks,
        "events": events,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
    VERSION_OUT.write_text(json.dumps({
        "updatedAt": obj["meta"]["updatedAt"],
        "stocks": len(stocks),
        "events": len(events),
    }, ensure_ascii=False, separators=(",", ":")))

    # Diagnostic summary for the frontend "Impulso intradía" preset.
    tr_rows = [s for s in stocks if s.get("tradeRepublicTradable")]
    stages = [("TR", tr_rows)]
    stages.append(("change>=2", [s for s in stages[-1][1] if s.get("changePct") is not None and float(s.get("changePct")) >= 2]))
    stages.append(("relvol>=1.5-or-missing", [s for s in stages[-1][1] if s.get("relVolume") is None or float(s.get("relVolume")) >= 1.5]))
    stages.append(("adx>=20-or-missing", [s for s in stages[-1][1] if s.get("adx") is None or float(s.get("adx")) >= 20]))
    stages.append(("rsi40-70-or-missing", [s for s in stages[-1][1] if s.get("rsi") is None or 40 <= float(s.get("rsi")) <= 70]))
    stages.append(("volume>=10000-or-missing", [s for s in stages[-1][1] if s.get("volume") is None or float(s.get("volume")) >= 10000]))
    print("ENTRY FILTER DIAGNOSTICS:", " | ".join(f"{name}={len(rows)}" for name, rows in stages))
    sample = stages[-1][1][:12]
    print("ENTRY FILTER SAMPLE:", [(s.get("ticker"), s.get("changePct"), s.get("relVolume"), s.get("adx"), s.get("rsi"), s.get("volume")) for s in sample])
    print(len(stocks), "stocks;", matched, "TR candidates;", same_isin, "same ISIN;", different_isin, "different ISIN;", unresolved_isin, "unresolved ISIN;", tr_ticker_count, "TR tickers;", tr_tradable_count, "TR tradable;", len(events), "events;", len(news_events), "news;", len(clinical_events), "clinical")
    print("CLINICAL EVENT SAMPLE:", [
        (e.get("ticker"), e.get("clinicalLeadSponsor"), e.get("clinicalNct"), e.get("date"), e.get("clinicalPhase"), e.get("clinicalDateType"))
        for e in clinical_events[:12]
    ])

if __name__ == "__main__":
    main()
