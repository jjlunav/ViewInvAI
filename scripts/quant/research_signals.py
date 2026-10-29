#!/usr/bin/env python3
"""Investigación de señales de anticipación (semanas, no días) con ~10 años de históricos diarios.

Pregunta: ¿qué señales, medidas ANTES de que la acción se mueva, han batido al S&P 500 en las
20 y 60 sesiones siguientes? Las señales se definen de antemano (no se ajustan a los datos) y se
miden en dos periodos separados, 2017-2022 y 2023-hoy: una señal solo cuenta si funciona en los dos.

Método (sección cruzada, una fecha por semana):
- Cada semana se ordenan las acciones líquidas por cada señal. Se mide la correlación de rangos con
  la rentabilidad posterior frente al SPY (IC) y el exceso medio del 10 % con la señal más alta frente
  a la media de esa semana. Así no influye si el mercado subió o bajó en el periodo.
- Exceso del decil superior frente al SPY, neto de 25 y 100 puntos básicos de comisiones de ida y vuelta.
- También para el subconjunto que se puede comprar en Trade Republic (LSX).
- Señal combinada: media de los rangos de las señales que funcionaron en 2017-2022, medida solo en 2023-hoy.

Reutiliza la descarga, la caché y la corrección de splits del entrenador (train_quant.py).
Salida: data/signal-research.json (informe; no lo usa todavía la app).
Sesgo conocido: solo acciones que cotizan hoy (sesgo de supervivencia); se indica en el informe.
"""
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np

if __package__:
    from .train_quant import universe, fetch, fix_splits, features, log, CATALOG, ROOT, WORKERS
else:
    from train_quant import universe, fetch, fix_splits, features, log, CATALOG, ROOT, WORKERS

OUT = ROOT / "data" / "signal-research.json"
HORIZONS = (20, 60)
SPLIT = "2023-01-01"
MIN_TRADED = 1_000_000  # $/día de media (10 sesiones): solo acciones con liquidez real
MIN_PRICE = 1.0

# Señales: nombre → (descripción, mayor = mejor). Todas usan solo datos conocidos ese día.
SIGNALS = {
    "mom12_1": "Rentabilidad de 12 meses saltando el último mes (momento clásico)",
    "mom6_1": "Rentabilidad de 6 meses saltando el último mes",
    "near_high": "Cercanía al máximo de 52 semanas",
    "rel_strength_3m": "Fuerza relativa frente al S&P 500 en 3 meses",
    "squeeze": "Contracción de volatilidad: rango de 20 sesiones estrecho frente al de 120",
    "volume_dry": "Volumen que se seca: media de 10 sesiones baja frente a la de 60",
    "squeeze_near_high": "Contracción de volatilidad cerca de máximos (base antes de ruptura)",
    "gap_drift": "Hueco al alza con volumen en las últimas 20 sesiones que se mantiene (proxy de deriva tras resultados)",
    "reversal_1w": "Reversión: peor semana (control, efecto conocido a 1-4 semanas)",
    "low_vol": "Baja volatilidad (ATR % bajo)",
    "engine_today": "Lo que premia hoy el motor: subida del día con volumen (control)",
}


def lag(x, k):
    return np.concatenate([np.full(k, np.nan), x[:-k]]) if k > 0 else x


def rolling_mean(x, w):
    out = np.full(len(x), np.nan)
    if len(x) < w:
        return out
    cs = np.cumsum(np.nan_to_num(x))
    cnt = np.cumsum(np.isfinite(x))
    s = cs[w - 1:] - np.concatenate([[0], cs[:-w]])
    c = cnt[w - 1:] - np.concatenate([[0], cnt[:-w]])
    with np.errstate(all="ignore"):
        out[w - 1:] = np.where(c >= w * 0.8, s / c, np.nan)
    return out


def ticker_rows(t, a, spy_days, spy_c, tradable):
    fix_splits(a)
    f = features(a)
    c, h, l, v, o = a["c"], a["h"], a["l"], a["v"], a["o"]
    n = len(c)
    days = np.asarray(a["d"])
    if n < 300:
        return None
    pos = np.clip(np.searchsorted(spy_days, days), 0, len(spy_days) - 1)
    same = spy_days[pos] == days
    with np.errstate(all="ignore"):
        rng = (h - l) / c * 100
        r20, r120 = rolling_mean(rng, 20), rolling_mean(rng, 120)
        v10, v60 = rolling_mean(v, 10), rolling_mean(v, 60)
        prev = lag(c, 1)
        gap = (o / prev - 1) * 100
        relv = f["relVolume"]
        # Último hueco al alza ≥ 4 % con volumen ≥ 2,5× en las 20 sesiones previas, si el precio sigue por
        # encima del cierre anterior al hueco (el mercado no lo ha devuelto).
        event = np.isfinite(gap) & (gap >= 4) & (relv >= 2.5) & (f["change"] >= 3)
        last_ev = np.maximum.accumulate(np.where(event, np.arange(n), -10**9))
        ev_idx = np.clip(last_ev, 0, n - 1)
        held = (np.arange(n) - last_ev >= 1) & (np.arange(n) - last_ev <= 20) & (c > prev[ev_idx])
        gap_drift = np.where(held, gap[ev_idx], 0.0)
        spy_at = np.where(same, spy_c[pos], np.nan)
        rs3 = (c / lag(c, 63) - 1) - (spy_at / lag(spy_at, 63) - 1)
        sig = {
            "mom12_1": lag(c, 21) / lag(c, 252) - 1,
            "mom6_1": lag(c, 21) / lag(c, 126) - 1,
            "near_high": f["fromHigh"],
            "rel_strength_3m": rs3,
            "squeeze": -(r20 / r120),
            "volume_dry": -(v10 / v60),
            "squeeze_near_high": np.where(f["fromHigh"] >= -10, -(r20 / r120), np.nan),
            "gap_drift": gap_drift,
            "reversal_1w": -f["perfWeek"],
            "low_vol": -f["atrPct"],
            "engine_today": np.clip(f["change"], -20, 20) * np.minimum(np.nan_to_num(relv), 5),
        }
    traded = f["price"] * f["avgVolume"]
    fv = f["featureValid"]
    # Validez hacia delante: sin saltos dudosos (posibles splits sin verificar) en la ventana.
    bad_ahead = np.concatenate([~fv[1:], [False]]).astype(np.int64)
    csb = np.concatenate([[0], np.cumsum(bad_ahead)])
    out = {"t": t, "tradable": tradable}
    idx = np.arange(n)
    for hz in HORIZONS:
        j = idx + hz
        ok = same & (j < n) & (pos + hz < len(spy_c))
        jj = np.minimum(j, n - 1)
        fwd = (c[jj] / c - 1) * 100
        spy_fwd = (spy_c[np.minimum(pos + hz, len(spy_c) - 1)] / spy_c[pos] - 1) * 100
        clean = (csb[np.minimum(idx + hz, n)] - csb[idx]) == 0
        ex = np.where(ok & clean, fwd - spy_fwd, np.nan)
        out["ex%d" % hz] = ex
    # Una observación por semana (la sesión cuyo índice del SPY es múltiplo de 5), con liquidez y precio.
    base = fv & same & (idx >= 260) & np.isfinite(traded) & (traded >= MIN_TRADED) & (c >= MIN_PRICE) & (pos % 5 == 0)
    k = np.where(base)[0]
    if not len(k):
        return None
    out["date"] = pos[k].astype(np.int32)
    for hz in HORIZONS:
        out["ex%d" % hz] = out["ex%d" % hz][k].astype(np.float32)
    for name, arr in sig.items():
        out[name] = np.asarray(arr, dtype=np.float64)[k].astype(np.float32)
    return out


def rank01(x):
    """Rango en [0,1] dentro de una fecha; NaN se queda en NaN."""
    out = np.full(len(x), np.nan)
    ok = np.isfinite(x)
    m = ok.sum()
    if m < 2:
        return out
    order = np.argsort(x[ok], kind="stable")
    r = np.empty(m)
    r[order] = np.arange(m) / (m - 1)
    out[ok] = r
    return out


def evaluate(score, ex, groups, mask, min_names=50):
    """IC medio semanal (Spearman), su t-estadístico y exceso del decil superior frente a la semana y al SPY.
    groups: tramos [inicio, fin) de filas de una misma fecha (filas ordenadas por fecha)."""
    ics, spreads, tops = [], [], []
    ok_all = mask & np.isfinite(score) & np.isfinite(ex)
    for a, b in groups:
        m = ok_all[a:b]
        if m.sum() < min_names:
            continue
        s, e = score[a:b][m], ex[a:b][m]
        rs, re = rank01(s), rank01(e)
        ics.append(np.corrcoef(rs, re)[0, 1])
        cut = np.quantile(s, 0.9)
        top = e[s >= cut]
        tops.append(float(np.mean(top)))
        spreads.append(float(np.mean(top) - np.mean(e)))
    if len(ics) < 20:
        return None
    ics = np.array(ics)
    tops, spreads = np.array(tops), np.array(spreads)
    return {
        "weeks": int(len(ics)),
        "ic": round(float(ics.mean()), 4),
        "icT": round(float(ics.mean() / (ics.std(ddof=1) / np.sqrt(len(ics)))), 2),
        "icPositiveWeeksPct": round(float((ics > 0).mean() * 100), 1),
        "topDecileVsWeekPct": round(float(spreads.mean()), 3),
        "topDecileVsSpyPct": round(float(tops.mean()), 3),
        "topDecileBeatSpyWeeksPct": round(float((tops > 0).mean() * 100), 1),
        "topDecileNet25bpsPct": round(float(tops.mean() - 0.25), 3),
        "topDecileNet100bpsPct": round(float(tops.mean() - 1.0), 3),
    }


def main():
    t0 = time.time()
    tickers = universe()
    tradable = {str(s.get("ticker") or "").upper() for s in CATALOG
                if s.get("tradeRepublicTradable") is True or (s.get("tradeRepublicVerified") and s.get("trTicker"))}
    log("Universo:", len(tickers), "· de ellos en Trade Republic:", len(tradable & set(tickers)))
    spy = fetch("SPY", "etf")
    if spy is None:
        raise SystemExit("Sin histórico del SPY")
    spy_days, spy_c = np.asarray(spy["d"]), spy["c"]
    with ThreadPoolExecutor(WORKERS) as ex:
        data = list(ex.map(fetch, tickers))
    rows = []
    for t, a in zip(tickers, data):
        if a is None:
            continue
        try:
            r = ticker_rows(t, a, spy_days, spy_c, t in tradable)
        except (ValueError, FloatingPointError, IndexError) as error:
            log("  descartado", t, error)
            continue
        if r:
            rows.append(r)
    log("Valores con datos:", len(rows), "·", round(time.time() - t0), "s")
    order = np.argsort(np.concatenate([r["date"] for r in rows]), kind="stable")
    cat = lambda key: np.concatenate([r[key] for r in rows])[order]
    dates = cat("date")
    trad = np.concatenate([np.full(len(r["date"]), r["tradable"]) for r in rows])[order]
    cuts = np.concatenate([[0], np.flatnonzero(np.diff(dates)) + 1, [len(dates)]])
    groups = list(zip(cuts[:-1], cuts[1:]))
    day_str = spy_days[dates]
    early, late = day_str < SPLIT, day_str >= SPLIT
    ex = {hz: cat("ex%d" % hz) for hz in HORIZONS}
    sig = {name: cat(name) for name in SIGNALS}
    # Rangos por fecha para la señal combinada.
    ranks = {name: np.full(len(dates), np.nan) for name in SIGNALS}
    for a, b in groups:
        for name in SIGNALS:
            ranks[name][a:b] = rank01(sig[name][a:b])

    report = {"generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "source": "Nasdaq (histórico diario, gratuito); mismas correcciones de splits que el modelo",
              "universe": len(rows), "observations": int(len(dates)),
              "periods": {"early": ["2017", "2022"], "late": [SPLIT[:4], "hoy"]},
              "filters": {"minTradedUsdPerDay": MIN_TRADED, "minPrice": MIN_PRICE, "sampling": "una fecha por semana"},
              "limitations": ["Solo acciones que cotizan hoy: sesgo de supervivencia",
                              "Comisiones fijas por operación (25 y 100 pb ida y vuelta); sin deslizamiento ni impuestos",
                              "Ventanas de 20 y 60 sesiones solapadas entre semanas: el t-estadístico es optimista",
                              "Rentabilidades pasadas; no garantizan nada"],
              "signals": {}}
    for name, label in SIGNALS.items():
        entry = {"label": label}
        for hz in HORIZONS:
            entry["h%d" % hz] = {
                "early": evaluate(sig[name], ex[hz], groups, early),
                "late": evaluate(sig[name], ex[hz], groups, late),
                "lateTradeRepublic": evaluate(sig[name], ex[hz], groups, late & trad, min_names=30),
            }
        report["signals"][name] = entry
        log(" ", name, json.dumps({hz: entry["h%d" % hz]["late"] and entry["h%d" % hz]["late"]["ic"] for hz in HORIZONS}))
    # Combinada: solo señales con IC positivo y t ≥ 2 en 2017-2022 (elección sin mirar 2023-hoy).
    report["combined"] = {}
    for hz in HORIZONS:
        chosen = [nme for nme in SIGNALS if nme not in ("engine_today",)
                  and (report["signals"][nme]["h%d" % hz]["early"] or {}).get("icT", 0) >= 2
                  and (report["signals"][nme]["h%d" % hz]["early"] or {}).get("ic", 0) > 0]
        if chosen:
            with np.errstate(all="ignore"):
                comb = np.nanmean(np.vstack([ranks[nme] for nme in chosen]), axis=0)
            report["combined"]["h%d" % hz] = {"signals": chosen,
                                              "late": evaluate(comb, ex[hz], groups, late),
                                              "lateTradeRepublic": evaluate(comb, ex[hz], groups, late & trad, min_names=30)}
        else:
            report["combined"]["h%d" % hz] = {"signals": [], "late": None, "lateTradeRepublic": None}
    report["seconds"] = round(time.time() - t0)
    OUT.write_text(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
    log("Informe:", OUT, "·", report["seconds"], "s")


if __name__ == "__main__":
    main()
