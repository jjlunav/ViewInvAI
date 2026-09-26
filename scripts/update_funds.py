#!/usr/bin/env python3
"""Build the shared ViewInvAI funds/ETF catalogue from verifiable sources.

Trade Republic ETFs are parsed from the official Spanish instrument-universe PDF.
MyInvestor availability is merged only from the repository's verified ISIN overlay.
Existing NAV/performance fields are preserved when the catalogue refreshes.
"""
from __future__ import annotations

import io
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import requests
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
                "type": "etf",
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


def main():
    previous = read_json(OUT, {"meta": {}, "products": []})
    myinvestor = read_json(MYINVESTOR, {"meta": {}, "products": []})
    response = requests.get(TR_PDF, timeout=45, headers={"User-Agent": "ViewInvAI/0.6.7"})
    response.raise_for_status()
    tr_products = parse_trade_republic_etfs(response.content)
    products = merge_existing(tr_products, previous, myinvestor)

    payload = {
        "meta": {
            "updatedAt": now_iso(),
            "sources": [
                {"label": "Trade Republic · Universo de inversión", "url": TR_PDF},
                {"label": "MyInvestor · disponibilidad verificada por ISIN", "url": "https://myinvestor.es/inversion/fondos-inversion/buscador/"}
            ],
            "tradeRepublicEtfCount": sum(1 for p in products if p.get("platforms", {}).get("tradeRepublic") == "verified"),
            "myInvestorVerifiedCount": sum(1 for p in products if p.get("platforms", {}).get("myInvestor") == "verified"),
            "notes": "ETFs de Trade Republic extraídos de su universo oficial. MyInvestor solo se marca disponible mediante overlay de ISIN verificado."
        },
        "products": products
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Funds snapshot: {len(products)} products")


if __name__ == "__main__":
    main()
