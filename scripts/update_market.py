#!/usr/bin/env python3
import json, re, unicodedata, datetime as dt
from difflib import SequenceMatcher
from pathlib import Path
import requests
from pypdf import PdfReader

TV_URL="https://scanner.tradingview.com/america/scan"
TR_URLS=[
 "https://assets.traderepublic.com/assets/files/ES/Instrument_Universe_ES_en.pdf",
 "https://assets.traderepublic.com/assets/files/DE/Instrument_Universe_DE_en.pdf"
]
OUT=Path("data/market.json")
TMP=Path("/tmp/tr_universe.pdf")
COLS=["name","description","exchange","currency","close","change","volume","average_volume_10d_calc","relative_volume_10d_calc","premarket_close","premarket_change","premarket_volume","postmarket_close","postmarket_change","postmarket_volume","RSI","ADX","EMA20","EMA50","Perf.W","Perf.1M","earnings_release_next_trading_date_fq","update_mode","last_bar_update_time"]
SUFFIX={"inc","incorporated","corp","corporation","co","company","ltd","limited","plc","ag","se","sa","nv","holdings","holding","group","spa","srl","llc","lp","adr","ads","ordinary","shares","common","stock","class","the"}

def norm(s):
 s=unicodedata.normalize("NFKD",s or "").encode("ascii","ignore").decode().lower()
 s=re.sub(r"\([^)]*\)"," ",s); s=re.sub(r"[^a-z0-9]+"," ",s)
 return " ".join(x for x in s.split() if x not in SUFFIX).strip()

def tr_universe():
 headers={"User-Agent":"Mozilla/5.0"}
 source=None
 for url in TR_URLS:
  try:
   r=requests.get(url,headers=headers,timeout=60)
   if r.ok and r.content[:4]==b"%PDF":
    TMP.write_bytes(r.content); source=url; break
  except Exception:
   pass
 if not source: return {},0,None
 pat=re.compile(r"^([A-Z]{2}[A-Z0-9]{10})\s+(.+)$")
 rows=[]
 for page in PdfReader(str(TMP)).pages:
  for line in (page.extract_text() or "").splitlines():
   m=pat.match(line.strip())
   if m: rows.append((m.group(1),m.group(2).strip()))
 idx={}
 for isin,name in rows:
  k=norm(name)
  if k: idx.setdefault(k,[]).append((isin,name))
 return idx,len(rows),source

def tr_match(name,idx):
 k=norm(name)
 if not k:return None
 exact=idx.get(k)
 if exact and len(exact)==1:return exact[0][0]
 p=k[:18]
 if len(p)<10:return None
 cand=[]
 for key,vals in idx.items():
  if key.startswith(p) or k.startswith(key[:18]):
   for item in vals:cand.append((key,item))
   if len(cand)>8:break
 scored=[]
 for key,item in cand:
  r=SequenceMatcher(None,k,key).ratio()
  if r>=0.93:scored.append((r,item))
 scored.sort(reverse=True,key=lambda x:x[0])
 if len(scored)==1 or (len(scored)>1 and scored[0][0]-scored[1][0]>0.03):return scored[0][1][0]
 return None

def tv():
 payload={
  "filter":[{"left":"type","operation":"equal","right":"stock"},{"left":"is_primary","operation":"equal","right":True},{"left":"exchange","operation":"in_range","right":["NASDAQ","NYSE","AMEX"]}],
  "options":{"lang":"en"},"markets":["america"],
  "symbols":{"query":{"types":[]},"tickers":[]},"columns":COLS,
  "sort":{"sortBy":"volume","sortOrder":"desc"},"range":[0,10000]
 }
 headers={"User-Agent":"Mozilla/5.0","Content-Type":"application/json","Origin":"https://www.tradingview.com","Referer":"https://www.tradingview.com/"}
 r=requests.post(TV_URL,json=payload,headers=headers,timeout=90); r.raise_for_status()
 raw=r.json(); out=[]
 for row in raw.get("data") or []:
  d=dict(zip(COLS,row.get("d") or [])); sym=row.get("s","")
  ex,ticker=(sym.split(":",1)+[""])[:2] if ":" in sym else (d.get("exchange") or "",d.get("name") or sym)
  out.append({
   "tvSymbol":sym,"ticker":ticker,"name":d.get("description") or ticker,"exchange":d.get("exchange") or ex,"currency":d.get("currency") or "USD",
   "price":d.get("close"),"changePct":d.get("change"),"volume":d.get("volume"),"avgVolume":d.get("average_volume_10d_calc"),"relVolume":d.get("relative_volume_10d_calc"),
   "premarketPrice":d.get("premarket_close"),"premarketChangePct":d.get("premarket_change"),"premarketVolume":d.get("premarket_volume"),
   "postmarketPrice":d.get("postmarket_close"),"postmarketChangePct":d.get("postmarket_change"),"postmarketVolume":d.get("postmarket_volume"),
   "rsi":d.get("RSI"),"adx":d.get("ADX"),"ema20":d.get("EMA20"),"ema50":d.get("EMA50"),"perfWeek":d.get("Perf.W"),"perfMonth":d.get("Perf.1M"),
   "earningsDate":d.get("earnings_release_next_trading_date_fq"),"updateMode":d.get("update_mode"),"lastBarUpdateTime":d.get("last_bar_update_time")
  })
 return out,raw.get("totalCount")

def event_date(v):
 if v in (None,""):return None
 try:
  if isinstance(v,(int,float)):return dt.datetime.fromtimestamp(v,tz=dt.timezone.utc)
  d=dt.datetime.fromisoformat(str(v).replace("Z","+00:00"))
  return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)
 except Exception:return None

def main():
 previous={}
 if OUT.exists():
  try:previous=json.loads(OUT.read_text())
  except Exception:pass
 idx,tr_count,tr_source=tr_universe()
 try:stocks,total=tv()
 except Exception as e:
  if previous.get("stocks"):
   previous.setdefault("meta",{})["lastError"]=str(e)
   OUT.write_text(json.dumps(previous,ensure_ascii=False,separators=(",",":")))
  raise
 matched=0
 for s in stocks:
  isin=tr_match(s["name"],idx) if idx else None
  s["isin"]=isin; s["tradeRepublicVerified"]=bool(isin)
  if isin:matched+=1
  for key in list(s):
   if s[key] is None or s[key]=="": del s[key]
 now=dt.datetime.now(dt.timezone.utc); events=[]
 for s in stocks:
  d=event_date(s.get("earningsDate"))
  if d and now-dt.timedelta(days=1)<=d<=now+dt.timedelta(days=90):
   events.append({"ticker":s["ticker"],"name":s["name"],"exchange":s["exchange"],"date":d.isoformat(),"type":"earnings","tradeRepublicVerified":s["tradeRepublicVerified"],"fact":"Fecha de resultados indicada por el proveedor de mercado.","hypothesis":"Los resultados pueden aumentar la volatilidad; no implican una dirección concreta.","isin":s.get("isin")})
 obj={"meta":{"updatedAt":now.isoformat(),"source":"TradingView screener","totalProvider":total,"trOfficialCount":tr_count,"trMatchedCount":matched,"trUniverseSource":tr_source,"notes":"Datos públicos o diferidos según proveedor."},"stocks":stocks,"events":events}
 OUT.parent.mkdir(parents=True,exist_ok=True); OUT.write_text(json.dumps(obj,ensure_ascii=False,separators=(",",":")))
 print(len(stocks),"stocks;",matched,"TR matches;",len(events),"events")

if __name__=="__main__":main()
