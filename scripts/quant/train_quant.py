#!/usr/bin/env python3
"""Modelo cuantitativo de ViewInvAI: pruebas retrospectivas con ~10 años de cotizaciones diarias.

1. Descarga el histórico diario (Nasdaq, gratuito) de los valores de EE. UU. del catálogo y del SPY.
   Corrige splits y contrasplits que el histórico no trae ajustados.
2. Calcula cada día los mismos factores que usa la app (variación, volumen relativo, RSI, ADX,
   EMAs, rendimiento semanal y mensual, liquidez, distancia a máximos y mínimos de 52 semanas).
3. Entrena un modelo aditivo por tramos (regresión logística sobre factores discretizados) que
   estima la probabilidad de batir al S&P 500 en las 5 sesiones siguientes. Validación fuera de
   muestra: se entrena hasta 2022 y se mide en 2023-hoy; después se reentrena con todo.
4. Compara, en el mismo periodo fuera de muestra, el modelo con el motor técnico actual.
5. Prueba retrospectiva de las caídas bruscas (≥ 25 % en un día sin venir de un desplome).

Salidas: data/quant-model.json (lo usa la app) y data/quant-backtest.json (informe).
Sesgo conocido: solo entran valores que cotizan hoy (los que quebraron no están), lo que
mejora algo los rebotes medidos; se indica en el informe.
"""
import json
import math
import os
import random
import subprocess  # nosec B404 - solo para lanzar el puntuador del motor (node) con argumentos fijos
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import requests

ROOT = Path(__file__).resolve().parents[2]
APP_URL = os.environ.get("APP_URL", "https://viewinvai.sonarlab.workers.dev").rstrip("/")
CACHE = Path(os.environ.get("QUANT_CACHE", ROOT / ".quant-cache"))
OUT_MODEL = ROOT / "data" / "quant-model.json"
OUT_REPORT = ROOT / "data" / "quant-backtest.json"
FROM = os.environ.get("QUANT_FROM", "2016-01-01")
MAX_TICKERS = int(os.environ.get("QUANT_MAX_TICKERS", "4500"))
WORKERS = int(os.environ.get("QUANT_WORKERS", "8"))
SPLIT_AT = os.environ.get("QUANT_SPLIT", "2023-01-01")
HORIZON = 5
US_EX = {"NASDAQ", "NYSE", "AMEX", "NYSE ARCA", "BATS"}
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
           "Accept": "application/json"}
random.seed(7)
np.random.seed(7)


def log(*a):
    print(*a, flush=True)


# ---------- 1. Datos ----------
def universe():
    r = requests.get(APP_URL + "/data/market.json", headers=HEADERS, timeout=180)
    r.raise_for_status()
    stocks = r.json().get("stocks") or []
    rows = []
    for s in stocks:
        if str(s.get("exchange") or "").upper() not in US_EX:
            continue
        t = str(s.get("ticker") or "").upper()
        cap = s.get("marketCap") or 0
        if not t or not t.replace(".", "").isalnum() or cap < 20e6:
            continue
        rows.append((t, float(cap)))
    rows.sort(key=lambda x: -x[1])
    return [t for t, _ in rows[:MAX_TICKERS]]


def num(x):
    try:
        return float(str(x).replace("$", "").replace(",", ""))
    except (TypeError, ValueError):
        return float("nan")


def fetch(ticker, assetclass="stocks"):
    """Histórico diario de Nasdaq: fecha, apertura, máximo, mínimo, cierre y volumen (ascendente)."""
    path = CACHE / (ticker.replace("/", "_") + ".npz")
    today = date.today().isoformat()
    if path.exists():
        z = np.load(path)
        if str(z["fetched"]) == today:
            return {k: z[k] for k in ("d", "o", "h", "l", "c", "v")}
    url = ("https://api.nasdaq.com/api/quote/" + ticker + "/historical?assetclass=" + assetclass +
           "&fromdate=" + FROM + "&todate=" + today + "&limit=9999")
    for attempt in range(4):
        try:
            r = requests.get(url, headers=HEADERS, timeout=40)
            if r.status_code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            if r.status_code != 200:
                return None
            data = (r.json() or {}).get("data") or {}
            rows = ((data.get("tradesTable") or {}).get("rows")) or []
            if len(rows) < 120:
                return None
            rows = rows[::-1]
            d = np.array([datetime.strptime(x["date"], "%m/%d/%Y").strftime("%Y-%m-%d") for x in rows])
            arr = {"d": d}
            for k, f in (("o", "open"), ("h", "high"), ("l", "low"), ("c", "close"), ("v", "volume")):
                arr[k] = np.array([num(x.get(f)) for x in rows], dtype=np.float64)
            CACHE.mkdir(parents=True, exist_ok=True)
            np.savez_compressed(path, fetched=today, **arr)
            return arr
        except (requests.RequestException, ValueError, KeyError):
            time.sleep(2 * (attempt + 1))
    return None


def fix_splits(a):
    """Ajusta splits/contrasplits: un salto de cierre a cierre de casi exactamente 1/k o k
    (k = 2…50) con la apertura ya en el nivel nuevo se trata como split y se reescala lo anterior."""
    c, o = a["c"], a["o"]
    factors = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50]
    n = len(c)
    adj = np.ones(n)
    splits = 0
    for i in range(1, n):
        if not (c[i - 1] > 0 and c[i] > 0 and o[i] > 0):
            continue
        r = c[i] / c[i - 1]
        ro = o[i] / c[i - 1]
        for k in factors:
            for target in (1.0 / k, float(k)):
                if abs(r / target - 1) < 0.06 and abs(ro / target - 1) < 0.06:
                    adj[:i] *= target
                    splits += 1
                    break
            else:
                continue
            break
    if splits:
        for k in ("o", "h", "l", "c"):
            a[k] = a[k] * adj
        a["v"] = a["v"] / adj
    return splits


# ---------- 2. Factores ----------
def ema(x, span):
    out = np.full_like(x, np.nan)
    k = 2.0 / (span + 1)
    m = np.nan
    for i, v in enumerate(x):
        if np.isnan(v):
            out[i] = m
            continue
        m = v if np.isnan(m) else m + k * (v - m)
        out[i] = m
    return out


def wilder(x, n):
    out = np.full_like(x, np.nan)
    if len(x) <= n:
        return out
    s = np.nanmean(x[1:n + 1])
    out[n] = s
    for i in range(n + 1, len(x)):
        s = (s * (n - 1) + x[i]) / n
        out[i] = s
    return out


def features(a):
    c, h, l, v = a["c"], a["h"], a["l"], a["v"]
    n = len(c)
    prev = np.roll(c, 1)
    prev[0] = np.nan
    ch = (c / prev - 1) * 100
    d = np.diff(c, prepend=np.nan)
    rs = wilder(np.where(d > 0, d, 0.0), 14) / wilder(np.where(d < 0, -d, 0.0), 14)
    rsi = 100 - 100 / (1 + rs)
    tr = np.maximum.reduce([h - l, np.abs(h - prev), np.abs(l - prev)])
    up = np.diff(h, prepend=np.nan)
    dn = -np.diff(l, prepend=np.nan)
    pdm = np.where((up > dn) & (up > 0), up, 0.0)
    ndm = np.where((dn > up) & (dn > 0), dn, 0.0)
    atr = wilder(tr, 14)
    pdi = 100 * wilder(pdm, 14) / atr
    ndi = 100 * wilder(ndm, 14) / atr
    dx = 100 * np.abs(pdi - ndi) / (pdi + ndi)
    adx = wilder(np.nan_to_num(dx, nan=0.0), 14)
    e20, e50 = ema(c, 20), ema(c, 50)
    csum = np.cumsum(np.nan_to_num(v))
    avg10 = np.full(n, np.nan)
    avg10[11:] = (csum[10:-1] - csum[:-11]) / 10  # media de las 10 sesiones anteriores
    relv = v / avg10
    shift = lambda k: np.concatenate([np.full(k, np.nan), c[:-k]])
    week = (c / shift(5) - 1) * 100
    month = (c / shift(21) - 1) * 100
    pad = np.concatenate([np.full(251, np.nan), c])
    win = np.lib.stride_tricks.sliding_window_view(pad, 252)
    with np.errstate(all="ignore"):
        hi = np.nanmax(win, axis=1)
        lo = np.nanmin(win, axis=1)
    fwd = lambda k: np.concatenate([c[k:] / c[:-k] - 1, np.full(k, np.nan)]) * 100
    return {
        "change": ch, "relVolume": relv, "rsi": rsi, "adx": adx, "price": c, "ema20": e20, "ema50": e50,
        "perfWeek": week, "perfMonth": month, "avgVolume": avg10, "atrPct": atr / c * 100,
        "fromHigh": (c / hi - 1) * 100, "fromLow": (c / lo - 1) * 100,
        "fwd1": fwd(1), "fwd5": fwd(5), "fwd20": fwd(20),
    }


# Factores del modelo (en la app salen del snapshot con los mismos nombres).
MODEL_FEATURES = ["change", "relVolume", "rsi", "adx", "dist20", "dist50", "trend", "perfWeek",
                  "perfMonth", "traded", "fromHigh", "fromLow", "atrPct"]


def model_row(f, i):
    p, e20, e50 = f["price"][i], f["ema20"][i], f["ema50"][i]
    return [f["change"][i], math.log(max(f["relVolume"][i], 0.01)), f["rsi"][i], f["adx"][i],
            (p / e20 - 1) * 100, (p / e50 - 1) * 100, (e20 / e50 - 1) * 100, f["perfWeek"][i],
            f["perfMonth"][i], math.log10(max(p * f["avgVolume"][i], 1.0)), f["fromHigh"][i],
            f["fromLow"][i], f["atrPct"][i]]


# ---------- 3. Modelo aditivo por tramos ----------
def fit_bins(X, nb=8):
    edges = []
    for j in range(X.shape[1]):
        q = np.unique(np.nanquantile(X[:, j], np.linspace(0, 1, nb + 1)[1:-1]))
        edges.append(q)
    return edges


def to_bins(X, edges):
    return np.stack([np.searchsorted(e, X[:, j], side="right") for j, e in enumerate(edges)], axis=1)


def train_logit(B, y, edges, l2=2.0, iters=400, lr=0.5):
    """Regresión logística sobre factores discretizados (cada tramo, un peso). Descenso con Adam."""
    n, m = B.shape
    sizes = [len(e) + 1 for e in edges]
    W = [np.zeros(s) for s in sizes]
    b = math.log(max(y.mean(), 1e-6) / max(1 - y.mean(), 1e-6))
    mW = [np.zeros(s) for s in sizes]
    vW = [np.zeros(s) for s in sizes]
    mb = vb = 0.0
    for t in range(1, iters + 1):
        z = b + sum(W[j][B[:, j]] for j in range(m))
        p = 1 / (1 + np.exp(-z))
        r = p - y
        gb = r.mean()
        mb = 0.9 * mb + 0.1 * gb
        vb = 0.999 * vb + 0.001 * gb * gb
        b -= lr * 0.05 * (mb / (1 - 0.9 ** t)) / (math.sqrt(vb / (1 - 0.999 ** t)) + 1e-8)
        for j in range(m):
            g = np.bincount(B[:, j], weights=r, minlength=sizes[j]) / n + l2 * W[j] / n
            mW[j] = 0.9 * mW[j] + 0.1 * g
            vW[j] = 0.999 * vW[j] + 0.001 * g * g
            W[j] -= lr * 0.05 * (mW[j] / (1 - 0.9 ** t)) / (np.sqrt(vW[j] / (1 - 0.999 ** t)) + 1e-8)
    return b, W


def predict(B, b, W):
    z = b + sum(W[j][B[:, j]] for j in range(B.shape[1]))
    return 1 / (1 + np.exp(-z))


def auc(score, y):
    order = np.argsort(score)
    ranks = np.empty(len(score))
    ranks[order] = np.arange(1, len(score) + 1)
    pos = y == 1
    npos, nneg = pos.sum(), (~pos).sum()
    if not npos or not nneg:
        return None
    return float((ranks[pos].sum() - npos * (npos + 1) / 2) / (npos * nneg))


def deciles(score, excess, k=10):
    order = np.argsort(score)
    out = []
    for i, idx in enumerate(np.array_split(order, k)):
        e = excess[idx]
        out.append({"decile": i + 1, "n": int(len(idx)), "scoreAvg": round(float(np.mean(score[idx])), 3),
                    "beatRate": round(float((e > 0).mean() * 100), 1), "avgExcess": round(float(np.mean(e)), 2),
                    "medianExcess": round(float(np.median(e)), 2)})
    return out


def bucket_stats(values, excess, cuts, labels):
    out = []
    for lo, hi, lab in zip(cuts[:-1], cuts[1:], labels):
        m = (values >= lo) & (values < hi)
        if m.sum() >= 30:
            e = excess[m]
            out.append({"bucket": lab, "n": int(m.sum()), "beatRate": round(float((e > 0).mean() * 100), 1),
                        "avgExcess": round(float(e.mean()), 2), "medianExcess": round(float(np.median(e)), 2)})
    return out


def engine_scores(rows):
    """Puntúa con el motor técnico actual de la app (node + score-engine.js)."""
    payload = "\n".join(json.dumps(r) for r in rows) + "\n"
    res = subprocess.run(["node", str(ROOT / "scripts" / "quant" / "engine_scores.mjs")],  # nosec B603 B607
                         input=payload, capture_output=True, text=True, check=True, timeout=1800)
    return np.array([float(x) for x in res.stdout.split()])


# ---------- 4. Caídas bruscas ----------
def crash_stats(ev, key):
    if len(ev) < 10:
        return None
    out = {"n": len(ev)}
    for h in (1, 5, 20):
        r = np.array([e["r%d" % h] for e in ev if not math.isnan(e["r%d" % h])])
        x = np.array([e["x%d" % h] for e in ev if not math.isnan(e["x%d" % h])])
        if len(r):
            out["%dd" % h] = {"n": int(len(r)), "reboundRate": round(float((r > 0).mean() * 100), 1),
                              "avgReturn": round(float(r.mean()), 2), "median": round(float(np.median(r)), 2),
                              "avgExcess": round(float(x.mean()), 2) if len(x) else None,
                              "p25": round(float(np.percentile(r, 25)), 1), "p75": round(float(np.percentile(r, 75)), 1)}
    return out


def main():
    t0 = time.time()
    tickers = universe()
    log("Universo:", len(tickers), "valores de EE. UU.")
    spy = fetch("SPY", "etf")
    if spy is None:
        sys.exit("Sin histórico del SPY")
    spy_idx = {d: i for i, d in enumerate(spy["d"])}
    spy_c = spy["c"]

    def spy_fwd(day, k):
        i = spy_idx.get(day)
        if i is None or i + k >= len(spy_c):
            return float("nan")
        return (spy_c[i + k] / spy_c[i] - 1) * 100

    with ThreadPoolExecutor(WORKERS) as ex:
        data = list(ex.map(fetch, tickers))
    got = [(t, a) for t, a in zip(tickers, data) if a is not None]
    log("Históricos descargados:", len(got), "en", round(time.time() - t0), "s")

    X, Y, EX, D, ENG, CH = [], [], [], [], [], []
    crashes = []
    splits_total = 0
    for t, a in got:
        splits_total += fix_splits(a)
        f = features(a)
        n = len(a["c"])
        for i in range(60, n - 1):
            ch = f["change"][i]
            p = f["price"][i]
            traded = p * f["avgVolume"][i] if not math.isnan(f["avgVolume"][i]) else float("nan")
            if math.isnan(ch) or math.isnan(traded) or traded < 200000 or p < 0.5:
                continue
            day = str(a["d"][i])
            # Caídas bruscas: el día entero, sin muestreo.
            if -95 <= ch <= -25:
                prior = ((1 + f["perfMonth"][i] / 100) / (1 + ch / 100) - 1) * 100 if not math.isnan(f["perfMonth"][i]) else float("nan")
                if math.isnan(prior) or prior > -25:
                    ev = {"day": day, "t": t, "ch": ch, "prior": prior, "rsi": f["rsi"][i], "traded": traded}
                    for h in (1, 5, 20):
                        r = f["fwd%d" % h][i]
                        ev["r%d" % h] = r
                        ev["x%d" % h] = r - spy_fwd(day, h) if not math.isnan(r) else float("nan")
                    crashes.append(ev)
            fwd = f["fwd5"][i]
            if math.isnan(fwd) or i + HORIZON >= n:
                continue
            # Muestra: todos los días con movimiento (≥ 2 % o ≤ -8 %) y 1 de cada 6 del resto.
            if not (ch >= 2 or ch <= -8) and random.random() > 1 / 6:
                continue
            row = model_row(f, i)
            if any(math.isnan(x) or math.isinf(x) for x in row):
                continue
            sx = spy_fwd(day, HORIZON)
            if math.isnan(sx):
                continue
            X.append(row)
            EX.append(fwd - sx)
            D.append(day)
            CH.append(ch)
            ENG.append({"price": p, "change": ch, "relVolume": f["relVolume"][i], "rsi": f["rsi"][i], "adx": f["adx"][i],
                        "ema20": f["ema20"][i], "ema50": f["ema50"][i], "perfWeek": f["perfWeek"][i],
                        "perfMonth": f["perfMonth"][i], "avgVolume": f["avgVolume"][i]})
    X = np.array(X, dtype=np.float64)
    EX = np.array(EX)
    Y = (EX > 0).astype(np.float64)
    D = np.array(D)
    CH = np.array(CH)
    log("Filas:", len(X), "· caídas bruscas:", len(crashes), "· splits corregidos:", splits_total)

    train = D < SPLIT_AT
    test = ~train
    edges = fit_bins(X[train])
    Btr, Bte = to_bins(X[train], edges), to_bins(X[test], edges)
    b, W = train_logit(Btr, Y[train], edges)
    p_test = predict(Bte, b, W)
    auc_model = auc(p_test, Y[test])
    # Motor actual en el mismo periodo fuera de muestra (muestra de 300.000 filas como máximo).
    te_idx = np.where(test)[0]
    sample = np.random.choice(te_idx, size=min(len(te_idx), 300000), replace=False)
    eng = engine_scores([ENG[i] for i in sample])
    ex_s, y_s = EX[sample], Y[sample]
    p_s = predict(to_bins(X[sample], edges), b, W)
    report_radar = {
        "period": {"train": [min(D[train].tolist()), max(D[train].tolist())], "test": [min(D[test].tolist()), max(D[test].tolist())]},
        "rows": {"train": int(train.sum()), "test": int(test.sum())},
        "baseBeatRate": round(float(Y[test].mean() * 100), 1),
        "model": {"auc": round(auc_model, 4), "deciles": deciles(p_test, EX[test])},
        "engine": {"auc": round(auc(eng, y_s), 4), "deciles": deciles(eng, ex_s), "aucModelSameSample": round(auc(p_s, y_s), 4)},
        "byChange": bucket_stats(CH[test], EX[test], [-100, -8, 0, 2, 5, 8, 15, 30, 1000],
                                 ["< -8 %", "-8 a 0 %", "0 a 2 %", "2 a 5 %", "5 a 8 %", "8 a 15 %", "15 a 30 %", "> 30 %"]),
        "byRsi": bucket_stats(X[test][:, 2], EX[test], [0, 30, 45, 68, 75, 82, 101],
                              ["< 30", "30-45", "45-68", "68-75", "75-82", "> 82"]),
        "byRelVolume": bucket_stats(np.exp(X[test][:, 1]), EX[test], [0, 0.5, 1, 1.5, 3, 1e9],
                                    ["< 0,5×", "0,5-1×", "1-1,5×", "1,5-3×", "> 3×"]),
    }
    log("AUC modelo:", report_radar["model"]["auc"], "· AUC motor actual:", report_radar["engine"]["auc"])

    # Modelo final con todos los datos (la validación de arriba es la que vale para juzgarlo).
    edges_all = fit_bins(X)
    b_all, W_all = train_logit(to_bins(X, edges_all), Y, edges_all)
    model = {
        "version": datetime.now(timezone.utc).strftime("%Y.%m.%d"),
        "trainedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "target": "Probabilidad de batir al S&P 500 (SPY) en las 5 sesiones siguientes",
        "horizon": HORIZON, "intercept": round(b_all, 5),
        "baseRate": round(float(Y.mean()), 4),
        "features": [{"name": nme, "edges": [round(float(e), 5) for e in edges_all[j]],
                      "weights": [round(float(w), 5) for w in W_all[j]]} for j, nme in enumerate(MODEL_FEATURES)],
        "validation": {"auc": report_radar["model"]["auc"], "engineAuc": report_radar["engine"]["auc"],
                       "test": report_radar["period"]["test"], "topDecile": report_radar["model"]["deciles"][-1],
                       "bottomDecile": report_radar["model"]["deciles"][0], "baseBeatRate": report_radar["baseBeatRate"]},
        "universe": len(got), "rows": int(len(X)),
    }

    # Caídas bruscas: tasas base históricas por tipo de caída.
    def sel(fn):
        return [e for e in crashes if fn(e)]
    report_crash = {
        "n": len(crashes), "period": [min(e["day"] for e in crashes), max(e["day"] for e in crashes)] if crashes else None,
        "all": crash_stats(crashes, "all"),
        "bySeverity": {lab: crash_stats(sel(fn), lab) for lab, fn in (
            ("-25 a -40 %", lambda e: e["ch"] > -40), ("-40 a -60 %", lambda e: -60 < e["ch"] <= -40), ("< -60 %", lambda e: e["ch"] <= -60))},
        "byPrior": {lab: crash_stats(sel(fn), lab) for lab, fn in (
            ("venía subiendo > 50 %", lambda e: not math.isnan(e["prior"]) and e["prior"] > 50),
            ("venía plano (-25 a 50 %)", lambda e: not math.isnan(e["prior"]) and e["prior"] <= 50))},
        "bySize": {lab: crash_stats(sel(fn), lab) for lab, fn in (
            ("liquidez < 1 M$/día", lambda e: e["traded"] < 1e6), ("1-10 M$/día", lambda e: 1e6 <= e["traded"] < 1e7),
            ("> 10 M$/día", lambda e: e["traded"] >= 1e7))},
        "byRsi": {lab: crash_stats(sel(fn), lab) for lab, fn in (
            ("RSI < 25", lambda e: not math.isnan(e["rsi"]) and e["rsi"] < 25), ("RSI ≥ 25", lambda e: not math.isnan(e["rsi"]) and e["rsi"] >= 25))},
        "note": "Solo valores que cotizan hoy: los que quebraron después no están, así que los rebotes reales son algo peores que estos.",
    }
    report = {"generatedAt": model["trainedAt"], "source": "Nasdaq (histórico diario, gratuito), " + FROM + " a hoy",
              "universe": len(got), "splitsFixed": splits_total, "radar": report_radar, "crash": report_crash,
              "seconds": round(time.time() - t0)}
    OUT_MODEL.parent.mkdir(parents=True, exist_ok=True)
    OUT_MODEL.write_text(json.dumps(model, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    OUT_REPORT.write_text(json.dumps(report, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log("Listo en", round(time.time() - t0), "s ·", OUT_MODEL, OUT_REPORT)
    log(json.dumps({"radar": {k: report_radar[k] for k in ("baseBeatRate", "byChange")}, "crash_all": report_crash["all"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
