"""Diagnóstico temporal: ¿publica MyInvestor en abierto (sitemap, páginas o documentos) la lista de
fondos que comercializa? Sin credenciales ni tokens. Se borra antes de fusionar."""
import gzip, re, urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36", "Accept-Language": "es-ES,es;q=0.9"}
ISIN = re.compile(rb"\b[A-Z]{2}[A-Z0-9]{9}[0-9]\b")

def get(url, timeout=40):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
        if body[:2] == b"\x1f\x8b":
            body = gzip.decompress(body)
        return r.status, r.headers.get("content-type", ""), body

def show(title, fn):
    print("\n==== " + title, flush=True)
    try:
        fn()
    except Exception as e:
        print("ERROR", type(e).__name__, str(e)[:300])

seen_maps = set(); fund_urls = []
def sitemap(url, depth=0):
    if url in seen_maps or depth > 3 or len(seen_maps) > 60:
        return
    seen_maps.add(url)
    st, ct, body = get(url)
    locs = re.findall(rb"<loc>\s*([^<\s]+)\s*</loc>", body)
    print("  " * depth + url, st, len(body), "locs:", len(locs))
    for l in locs:
        u = l.decode("utf-8", "replace")
        if u.endswith(".xml") or "sitemap" in u.lower():
            sitemap(u, depth + 1)
        elif re.search(r"fondo|fund|isin", u, re.I):
            fund_urls.append(u)

def robots():
    st, ct, body = get("https://myinvestor.es/robots.txt")
    print(body.decode("utf-8", "replace")[:1500])
    for m in re.findall(rb"(?i)sitemap:\s*(\S+)", body):
        sitemap(m.decode())

def guess_maps():
    for u in ["https://myinvestor.es/sitemap.xml", "https://myinvestor.es/sitemap_index.xml", "https://myinvestor.es/server-sitemap.xml",
              "https://myinvestor.es/sitemap-0.xml", "https://blog.myinvestor.es/sitemap.xml"]:
        try:
            sitemap(u)
        except Exception as e:
            print(u, "->", type(e).__name__, str(e)[:120])

def report():
    print("URLs de fondos en sitemaps:", len(fund_urls))
    for u in fund_urls[:25]:
        print("  ", u)
    isins = {m.group(0) for u in fund_urls for m in [re.search(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", u)] if m}
    print("ISIN en las URLs:", len(isins), sorted(isins)[:10])
    pats = {}
    for u in fund_urls:
        k = re.sub(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", "{ISIN}", re.sub(r"/[^/]+/?$", "/*", u))
        pats[k] = pats.get(k, 0) + 1
    for k, v in sorted(pats.items(), key=lambda x: -x[1])[:15]:
        print("  patrón", v, k)
    if fund_urls:
        u = fund_urls[len(fund_urls) // 2]
        st, ct, body = get(u)
        print("muestra", u, st, ct, len(body), "ISIN en página:", sorted({m.decode() for m in ISIN.findall(body)})[:8])

def landing_docs():
    for u in ["https://myinvestor.es/landings/fondos-indexados/", "https://myinvestor.es/landings/fondos-inversion/fondos-inversionv2/",
              "https://myinvestor.es/inversion/fondos-inversion/", "https://myinvestor.es/legal/informacion-mifid"]:
        try:
            st, ct, body = get(u)
        except Exception as e:
            print(u, "->", type(e).__name__, str(e)[:120]); continue
        docs = sorted({d.decode() for d in re.findall(rb"https?://[^\"' <>]+\.(?:pdf|xlsx?|csv)", body)})
        print(u, st, len(body), "ISIN:", len(set(ISIN.findall(body))), "docs:", len(docs))
        for d in docs[:15]:
            print("   ", d)

for t, f in [("robots.txt", robots), ("sitemaps probables", guess_maps), ("resumen sitemaps", report), ("documentos en landings", landing_docs)]:
    show(t, f)
