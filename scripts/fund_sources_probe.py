"""Diagnóstico temporal (en seco): acciones europeas del universo de TR. Se borra antes de fusionar."""
import json, sys
sys.path.insert(0, "scripts")
import update_market as um

idx, count, src = um.tr_universe()
print("TR universe", count, src)
tr_isins = {isin for rows in idx.values() for isin, _ in rows}
prev = json.loads(um.OUT.read_text())
known = {str(s.get(k) or "").upper() for s in prev["stocks"] for k in ("isin", "trIsin", "usIsin") if s.get(k)}
eu = um.tv_europe(tr_isins, known)
print("EU stocks", len(eu))
for isin in ["DE000BAY0017", "FR0000121014", "ES0148396007", "DE0007164600", "IT0003132476", "NL0010273215"]:
    hit = [s for s in eu if s["isin"] == isin]
    print(isin, json.dumps(hit[0], ensure_ascii=False)[:400] if hit else "MISSING")
size = len(json.dumps(eu, separators=(",", ":")))
print("json bytes", size, "per stock", size // max(1, len(eu)))
from collections import Counter
print(Counter(s["exchange"] for s in eu))
left = len(tr_isins - known - {s["isin"] for s in eu})
print("TR ISINs still outside catalog (ETFs, other currencies, etc.)", left)
