#!/usr/bin/env python3
"""Build the shared ViewInvAI funds/ETF catalogue from verifiable sources.

Trade Republic ETFs are parsed from the official Spanish instrument-universe PDF and its
mutual funds come from the public search (no login). Morningstar adds fund TER/NAV.
MyInvestor availability is merged only from the repository's verified ISIN overlay.
Existing NAV/performance fields are preserved when the catalogue refreshes.
"""
from __future__ import annotations

import io
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import requests
import websocket
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "funds.json"
MYINVESTOR = ROOT / "data" / "myinvestor-funds.json"
TR_PDF = "https://assets.traderepublic.com/assets/files/ES/Instrument_Universe_ES_es.pdf"
ISIN_RE = re.compile(r"^([A-Z]{2}[A-Z0-9]{10})\s+(.+?)\s*$")
CURRENCY_RE = re.compile(r"\b(EUR|USD|GBP|CHF|JPY|SEK|NOK|DKK|CAD|AUD|CNY|HKD)\b", re.I)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def distribution_from_name(name: str) -> str:
    low = name.lower()
    if re.search(r"\b(acc|accumulating|acumulaci[oó]n)\b", low):
        return "Acumulación"
    if re.search(r"\b(dist|dis|distributing|distribuci[oó]n)\b", low):
        return "Distribución"
    return ""


def currency_from_name(name: str) -> str:
    match = CURRENCY_RE.search(name)
    return match.group(1).upper() if match else "EUR"


def exchange_product_type(name: str) -> str:
    low = name.lower()
    etp_markers = (
        " etp", " etn", " etc", "physical gold", "physical silver",
        "commodity", "commodities", "crude oil", "natural gas", "cocoa",
        "wheat", "corn ", "sugar", "platinum", "palladium", "nickel",
        "copper", "tin ", "lead ", " 2x ", " 3x ", "leveraged", " lev ",
        "short eur", "short usd", "short gbp", "short jpy", "short chf",
    )
    return "etp" if any(marker in " " + low for marker in etp_markers) else "etf"


def clean_name(text: str) -> str:
    text = re.sub(r"UNIVERSO DE INVERSI[ÓO]N.*$", "", text, flags=re.I).strip()
    return re.sub(r"\s+", " ", text).strip(" -")


def parse_trade_republic_etfs(pdf_bytes: bytes):
    reader = PdfReader(io.BytesIO(pdf_bytes))
    products = []
    in_etf = False
    current = None

    def flush():
        nonlocal current
        if not current:
            return
        name = clean_name(" ".join(current["parts"]))
        if name:
            products.append({
                "isin": current["isin"],
                "name": name,
                "type": exchange_product_type(name),
                "provider": "",
                "index": "",
                "category": "",
                "region": "",
                "currency": currency_from_name(name),
                "distribution": distribution_from_name(name),
                "ter": None,
                "nav": None,
                "valueDate": None,
                "sourceUpdatedAt": None,
                "perf1M": None,
                "perf3M": None,
                "perf6M": None,
                "perfYtd": None,
                "perf1Y": None,
                "perf3Y": None,
                "perf5Y": None,
                "perf10Y": None,
                "perfSinceInception": None,
                "volatility3Y": None,
                "maxDrawdown": None,
                "sharpe3Y": None,
                "trackingDifference": None,
                "assetsUnderManagement": None,
                "platforms": {
                    "tradeRepublic": "verified",
                    "myInvestor": "unknown"
                },
                "sources": [{
                    "label": "Trade Republic · Universo de inversión",
                    "url": TR_PDF
                }]
            })
        current = None

    for page in reader.pages:
        text = page.extract_text() or ""
        upper = text.upper()
        if not in_etf and re.search(r"UNIVERSO DE INVERSI[ÓO]N\s*-?\s*ETF", upper):
            in_etf = True
        if not in_etf:
            continue
        for raw in text.splitlines():
            line = clean_name(raw)
            if not line or line.upper() in {"ETF", "ISIN NOMBRE"} or set(line) <= {"_"}:
                continue
            match = ISIN_RE.match(line)
            if match:
                flush()
                current = {"isin": match.group(1), "parts": [match.group(2)]}
            elif current and not re.match(r"^[A-ZÁÉÍÓÚÜ Ñ-]{6,}$", line):
                current["parts"].append(line)
    flush()

    # De-duplicate exact share classes by ISIN.
    unique = {}
    for product in products:
        unique[product["isin"]] = product
    return list(unique.values())


def merge_existing(products, previous, myinvestor):
    old = {str(x.get("isin", "")).upper(): x for x in previous.get("products", []) if x.get("isin")}
    mi = {str(x.get("isin", "")).upper(): x for x in myinvestor.get("products", []) if x.get("isin")}
    metric_keys = {
        "provider", "index", "category", "region", "currency", "distribution", "ter", "nav", "valueDate",
        "sourceUpdatedAt", "perf1M", "perf3M", "perf6M", "perfYtd", "perf1Y", "perf3Y", "perf5Y",
        "perf10Y", "perfSinceInception", "volatility3Y", "maxDrawdown", "sharpe3Y",
        "trackingDifference", "assetsUnderManagement"
    }
    merged = []
    seen = set()

    for product in products:
        isin = product["isin"].upper()
        seen.add(isin)
        prior = old.get(isin, {})
        for key in metric_keys:
            if prior.get(key) not in (None, ""):
                product[key] = prior[key]
        overlay = mi.get(isin)
        if overlay:
            product["platforms"]["myInvestor"] = "verified"
            for key in metric_keys | {"name", "type"}:
                if overlay.get(key) not in (None, ""):
                    product[key] = overlay[key]
            existing_sources = list(product.get("sources") or [])
            existing_sources.extend(list(overlay.get("sources") or []))
            product["sources"] = existing_sources
        merged.append(product)

    # MyInvestor-only funds/ETFs are allowed when exact ISIN availability was verified.
    for isin, overlay in mi.items():
        if isin in seen:
            continue
        row = dict(overlay)
        row.setdefault("type", "fund")
        row.setdefault("platforms", {})
        row["platforms"] = {
            "tradeRepublic": row["platforms"].get("tradeRepublic", "unknown"),
            "myInvestor": "verified"
        }
        row.setdefault("sources", [])
        merged.append(row)

    return sorted(merged, key=lambda x: (x.get("type") != "fund", x.get("name", ""), x.get("isin", "")))



def epoch_ms(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return int(value * 1000 if 0 < value < 1_000_000_000_000 else value)


def tr_history(isin: str, venue: str = "LSX"):
    ws = websocket.create_connection(
        "wss://api.traderepublic.com",
        origin="https://app.traderepublic.com",
        header=["User-Agent: Mozilla/5.0"],
        timeout=12,
    )
    try:
        ws.send("connect 30")
        hello = str(ws.recv() or "")
        if not hello.startswith("connected"):
            raise RuntimeError("unexpected Trade Republic greeting")
        payload = {
            "type": "aggregateHistoryLight",
            "id": isin + "." + venue,
            "range": "max",
        }
        # Trade Republic no responde si se envía «resolution» (cada rango trae su intervalo; «max» es semanal).
        ws.send("sub 1 " + json.dumps(payload, separators=(",", ":")))
        deadline = time.time() + 12
        while time.time() < deadline:
            raw = str(ws.recv() or "")
            if not raw.startswith("1 "):
                continue
            match = re.match(r"^1\s+([A-Z])(?:\s+([\s\S]+))?$", raw)
            if not match:
                continue
            code, body = match.group(1), match.group(2) or ""
            if code == "E":
                raise RuntimeError("history rejected")
            if code != "A":
                continue
            data = json.loads(body or "{}")
            rows = []
            for point in data.get("aggregates") or []:
                stamp = epoch_ms(point.get("time"))
                try:
                    close = float(point.get("close"))
                except (TypeError, ValueError):
                    continue
                if stamp and close > 0:
                    rows.append((stamp, close))
            rows.sort()
            return rows[-5000:]
        raise TimeoutError("Trade Republic history timeout")
    finally:
        try:
            ws.send("unsub 1")
        except Exception:
            pass
        try:
            ws.close()
        except Exception:
            pass


def return_for_days(points, days: int):
    if len(points) < 2:
        return None
    end_t, end_p = points[-1]
    cutoff = end_t - days * 86400000
    candidates = [row for row in points if row[0] <= cutoff]
    if not candidates:
        return None
    start_t, start_p = candidates[-1]
    # Require enough history to avoid presenting a partial period as the full period.
    if end_t - start_t < days * 86400000 * 0.90 or start_p <= 0:
        return None
    return round((end_p / start_p - 1) * 100, 6)


def enrich_one_tr_product(product):
    try:
        points = tr_history(product["isin"], "VST" if product.get("type") == "fund" else "LSX")
        if len(points) < 2:
            return product, False
        last_t, last_p = points[-1]
        first_t, first_p = points[0]
        product.update({
            "nav": last_p,
            "valueDate": datetime.fromtimestamp(last_t / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
            "sourceUpdatedAt": now_iso(),
            "perf1M": return_for_days(points, 30),
            "perf3M": return_for_days(points, 91),
            "perf6M": return_for_days(points, 182),
            "perfYtd": None,
            "perf1Y": return_for_days(points, 365),
            "perf3Y": return_for_days(points, 365 * 3),
            "perf5Y": return_for_days(points, 365 * 5),
            "perf10Y": return_for_days(points, 365 * 10),
            "perfSinceInception": round((last_p / first_p - 1) * 100, 6) if first_p > 0 else None,
        })
        year = datetime.fromtimestamp(last_t / 1000, tz=timezone.utc).year
        ytd = [row for row in points if datetime.fromtimestamp(row[0] / 1000, tz=timezone.utc).year < year]
        if ytd and ytd[-1][1] > 0:
            product["perfYtd"] = round((last_p / ytd[-1][1] - 1) * 100, 6)
        product.setdefault("sources", []).append({
            "label": "Trade Republic · histórico " + ("VST (valor liquidativo)" if product.get("type") == "fund" else "LSX"),
            "url": "https://traderepublic.com/es-es"
        })
        return product, True
    except Exception as exc:
        print(f"History unavailable {product.get('isin')}: {exc}")
        return product, False


def enrich_trade_republic_history(products):
    if os.environ.get("VIEWINVAI_FUNDS_HISTORY", "1").lower() in {"0", "false", "no"}:
        return products, 0
    candidates = [
        p for p in products
        if p.get("type") in {"etf","etp","fund"} and p.get("platforms", {}).get("tradeRepublic") == "verified"
    ]
    workers = max(1, min(8, int(os.environ.get("VIEWINVAI_FUNDS_WORKERS", "5"))))
    enriched = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(enrich_one_tr_product, p): p for p in candidates}
        for future in as_completed(futures):
            product, ok = future.result()
            if ok:
                enriched += 1
    return products, enriched


TV_SCAN = "https://scanner.tradingview.com/global/scan"
TV_FUND_COLUMNS = ["isin", "expense_ratio", "index_tracked", "aum", "issuer", "dividend_treatment"]


TR_WS = "wss://api.traderepublic.com"
TR_CONNECT = 'connect 31 {"locale":"es","platformId":"webtrading","platformVersion":"chrome - 126.0.0","clientId":"app.traderepublic.com","clientVersion":"3.151.3"}'


def tr_mutual_funds(page_size=50, max_pages=80):
    """Fondos de inversión que Trade Republic ofrece en España, desde su buscador público
    (neonSearch, tipo mutualFund, jurisdicción ES). No requiere sesión ni credenciales.
    Su universo PDF solo lista acciones y ETF."""
    ws = websocket.create_connection(TR_WS, origin="https://app.traderepublic.com",
                                     header=["User-Agent: Mozilla/5.0"], timeout=15)
    out, total, sub = {}, None, 0
    try:
        ws.send(TR_CONNECT)
        if not str(ws.recv() or "").startswith("connected"):
            raise RuntimeError("unexpected Trade Republic greeting")
        for page in range(1, max_pages + 1):
            sub += 1
            payload = {"type": "neonSearch", "data": {"q": "", "page": page, "pageSize": page_size,
                       "filter": [{"key": "type", "value": "mutualFund"}, {"key": "jurisdiction", "value": "ES"}]}}
            ws.send(f"sub {sub} " + json.dumps(payload, separators=(",", ":")))
            data, deadline = None, time.time() + 15
            while time.time() < deadline:
                raw = str(ws.recv() or "")
                m = re.match(rf"^{sub}\s+([A-Z])(?:\s+([\s\S]+))?$", raw)
                if not m:
                    continue
                if m.group(1) == "E":
                    raise RuntimeError("search rejected")
                if m.group(1) == "A":
                    data = json.loads(m.group(2) or "{}")
                    break
            try:
                ws.send(f"unsub {sub}")
            except Exception:
                pass
            if data is None:
                raise TimeoutError("Trade Republic search timeout")
            total = data.get("resultCount", total)
            rows = data.get("results") or []
            for r in rows:
                isin = str(r.get("isin") or "").upper()
                if not re.match(r"^[A-Z]{2}[A-Z0-9]{10}$", isin) or r.get("instrumentType") != "mutualFund":
                    continue
                tags = r.get("tags") or []
                issuer = next((t.get("name") for t in tags if t.get("type") == "issuer"), "") or r.get("subtitle") or ""
                region = next((t.get("name") for t in tags if t.get("type") == "region"), "")
                name = clean_name(r.get("name") or isin)
                out[isin] = {
                    "isin": isin, "name": name, "type": "fund", "provider": str(issuer)[:80], "index": "",
                    "category": "", "region": str(region)[:80], "currency": currency_from_name(name),
                    "distribution": distribution_from_name(name), "ter": None, "nav": None, "valueDate": None,
                    "sourceUpdatedAt": None, "perf1M": None, "perf3M": None, "perf6M": None, "perfYtd": None,
                    "perf1Y": None, "perf3Y": None, "perf5Y": None, "perf10Y": None, "perfSinceInception": None,
                    "volatility3Y": None, "maxDrawdown": None, "sharpe3Y": None, "trackingDifference": None,
                    "assetsUnderManagement": None,
                    "platforms": {"tradeRepublic": "verified", "myInvestor": "unknown"},
                    "sources": [{"label": "Trade Republic · buscador de fondos (España)", "url": "https://traderepublic.com/es-es"}]
                }
            if len(rows) < page_size or (total is not None and len(out) >= total):
                break
    finally:
        try:
            ws.close()
        except Exception:
            pass
    print(f"Trade Republic mutual funds: {len(out)} of {total}")
    return list(out.values())


MS_SCREENER = "https://lt.morningstar.com/api/rest.svc/klr5zyak8x/security/screener"


def enrich_morningstar_funds(products, chunk=80):
    """TER (gastos corrientes), valor liquidativo y rentabilidades de los fondos de inversión,
    desde el screener público de Morningstar (universo de fondos registrados en España)."""
    targets = {p["isin"]: p for p in products if p.get("type") == "fund" and p.get("isin")}
    isins, enriched = list(targets), 0
    for i in range(0, len(isins), chunk):
        part = isins[i:i + chunk]
        params = {"outputType": "json", "version": "1", "languageId": "es-ES", "currencyId": "EUR",
                  "universeIds": "FOESP$$ALL", "page": "1", "pageSize": str(len(part) * 2),
                  "securityDataPoints": "SecId|Name|isin|OngoingCharge|ClosePrice|ClosePriceDate|ReturnM12|ReturnM36|ReturnM60|CategoryName",
                  "filters": "ISIN:IN:" + ":".join(part)}
        try:
            r = requests.get(MS_SCREENER, params=params, timeout=40, headers={"User-Agent": "Mozilla/5.0 ViewInvAI"})
            r.raise_for_status()
            rows = (r.json() or {}).get("rows") or []
        except Exception as exc:
            print("Morningstar chunk failed:", exc)
            continue
        for row in rows:
            p = targets.get(str(row.get("isin") or "").upper())
            if not p:
                continue
            ter = row.get("OngoingCharge")
            if isinstance(ter, (int, float)) and 0 <= ter < 5:
                p["ter"] = round(float(ter), 3)
            if p.get("nav") is None and isinstance(row.get("ClosePrice"), (int, float)):
                p["nav"] = row["ClosePrice"]
                p["valueDate"] = row.get("ClosePriceDate")
            if p.get("perf1Y") is None and isinstance(row.get("ReturnM12"), (int, float)):
                p["perf1Y"] = round(float(row["ReturnM12"]), 4)
            # Morningstar da 3 y 5 años anualizados; el catálogo guarda la rentabilidad acumulada.
            for key, years, field in (("ReturnM36", 3, "perf3Y"), ("ReturnM60", 5, "perf5Y")):
                v = row.get(key)
                if p.get(field) is None and isinstance(v, (int, float)) and v > -100:
                    p[field] = round(((1 + v / 100) ** years - 1) * 100, 4)
            if row.get("CategoryName") and not p.get("category"):
                p["category"] = str(row["CategoryName"])[:120]
            enriched += 1
    print("Morningstar fund data:", enriched)
    return enriched


def enrich_tradingview_fund_meta(products, chunk=150):
    """TER, tracked index, issuer and assets from the TradingView scanner, by ISIN.
    The Trade Republic universe lists names only; without the TER the app cannot
    compare costs or find cheaper twins of the same index."""
    by_isin = {p["isin"]: p for p in products if p.get("isin")}
    isins = list(by_isin)
    found = {}
    for i in range(0, len(isins), chunk):
        part = isins[i:i + chunk]
        body = {"filter": [{"left": "isin", "operation": "in_range", "right": part}],
                "columns": TV_FUND_COLUMNS, "range": [0, len(part) * 30]}
        try:
            r = requests.post(TV_SCAN, json=body, timeout=40, headers={"User-Agent": "ViewInvAI/0.6.7"})
            r.raise_for_status()
            rows = (r.json() or {}).get("data") or []
        except Exception as exc:
            print("TradingView fund meta chunk failed:", exc)
            continue
        for row in rows:
            d = dict(zip(TV_FUND_COLUMNS, row.get("d") or []))
            isin = str(d.get("isin") or "").upper()
            if isin not in by_isin:
                continue
            cur = found.setdefault(isin, {})
            for key, value in d.items():
                if value not in (None, "") and cur.get(key) in (None, ""):
                    cur[key] = value
    enriched = 0
    for isin, meta in found.items():
        p = by_isin[isin]
        ter = meta.get("expense_ratio")
        if isinstance(ter, (int, float)) and 0 <= ter < 5:
            p["ter"] = round(float(ter), 3)
        if meta.get("index_tracked") and not p.get("index"):
            p["index"] = str(meta["index_tracked"])[:120]
        if meta.get("issuer") and not p.get("provider"):
            p["provider"] = str(meta["issuer"]).replace(", Inc.", "").replace(" Inc.", "")[:80]
        aum = meta.get("aum")
        if isinstance(aum, (int, float)) and aum > 0:
            p["assetsUnderManagement"] = round(float(aum))
        if not p.get("distribution") and meta.get("dividend_treatment"):
            p["distribution"] = "Acumulación" if str(meta["dividend_treatment"]).lower().startswith("capital") else "Distribución"
        enriched += 1
    return enriched


def main():
    previous = read_json(OUT, {"meta": {}, "products": []})
    myinvestor = read_json(MYINVESTOR, {"meta": {}, "products": []})
    response = requests.get(TR_PDF, timeout=45, headers={"User-Agent": "ViewInvAI/0.6.7"})
    response.raise_for_status()
    tr_products = parse_trade_republic_etfs(response.content)
    try:
        tr_funds = tr_mutual_funds()
    except Exception as exc:
        # Sin el buscador se conservan los fondos de la última actualización.
        print("Trade Republic mutual funds unavailable:", exc)
        tr_funds = [p for p in previous.get("products", []) if p.get("type") == "fund" and p.get("platforms", {}).get("tradeRepublic") == "verified"]
    seen = {p["isin"] for p in tr_products}
    tr_products += [p for p in tr_funds if p["isin"] not in seen]
    products = merge_existing(tr_products, previous, myinvestor)
    products, history_count = enrich_trade_republic_history(products)
    meta_count = enrich_tradingview_fund_meta(products)
    print("TradingView fund meta:", meta_count)
    ms_count = enrich_morningstar_funds(products)

    payload = {
        "meta": {
            "updatedAt": now_iso(),
            "sources": [
                {"label": "Trade Republic · Universo de inversión", "url": TR_PDF},
                {"label": "Trade Republic · buscador de fondos de inversión (España)", "url": "https://traderepublic.com/es-es"},
                {"label": "Morningstar · gastos corrientes y valor liquidativo de fondos", "url": "https://www.morningstar.es/"},
                {"label": "MyInvestor · disponibilidad verificada por ISIN", "url": "https://myinvestor.es/inversion/fondos-inversion/buscador/"}
            ],
            "tradeRepublicEtfCount": sum(1 for p in products if p.get("platforms", {}).get("tradeRepublic") == "verified"),
            "myInvestorVerifiedCount": sum(1 for p in products if p.get("platforms", {}).get("myInvestor") == "verified"),
            "tradeRepublicHistoryCount": history_count,
            "tradingViewMetaCount": meta_count,
            "tradeRepublicMutualFundCount": sum(1 for p in products if p.get("type") == "fund" and p.get("platforms", {}).get("tradeRepublic") == "verified"),
            "morningstarFundCount": ms_count,
            "notes": "ETF de Trade Republic de su universo oficial y fondos de inversión de su buscador público para España. MyInvestor solo se marca disponible mediante overlay de ISIN verificado."
        },
        "products": products
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Funds snapshot: {len(products)} products")


if __name__ == "__main__":
    main()
