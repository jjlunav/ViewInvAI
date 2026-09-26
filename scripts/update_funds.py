#!/usr/bin/env python3
"""Build the shared ViewInvAI funds/ETF catalogue from verifiable sources.

Trade Republic ETFs are parsed from the official Spanish instrument-universe PDF.
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


def tr_history(isin: str):
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
            "id": isin + ".LSX",
            "range": "max",
            "resolution": 86400000,
        }
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
        points = tr_history(product["isin"])
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
            "label": "Trade Republic · histórico LSX",
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
        if p.get("type") in {"etf","etp"} and p.get("platforms", {}).get("tradeRepublic") == "verified"
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


def main():
    previous = read_json(OUT, {"meta": {}, "products": []})
    myinvestor = read_json(MYINVESTOR, {"meta": {}, "products": []})
    response = requests.get(TR_PDF, timeout=45, headers={"User-Agent": "ViewInvAI/0.6.7"})
    response.raise_for_status()
    tr_products = parse_trade_republic_etfs(response.content)
    products = merge_existing(tr_products, previous, myinvestor)
    products, history_count = enrich_trade_republic_history(products)

    payload = {
        "meta": {
            "updatedAt": now_iso(),
            "sources": [
                {"label": "Trade Republic · Universo de inversión", "url": TR_PDF},
                {"label": "MyInvestor · disponibilidad verificada por ISIN", "url": "https://myinvestor.es/inversion/fondos-inversion/buscador/"}
            ],
            "tradeRepublicEtfCount": sum(1 for p in products if p.get("platforms", {}).get("tradeRepublic") == "verified"),
            "myInvestorVerifiedCount": sum(1 for p in products if p.get("platforms", {}).get("myInvestor") == "verified"),
            "tradeRepublicHistoryCount": history_count,
            "notes": "ETFs de Trade Republic extraídos de su universo oficial. MyInvestor solo se marca disponible mediante overlay de ISIN verificado."
        },
        "products": products
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Funds snapshot: {len(products)} products")


if __name__ == "__main__":
    main()
