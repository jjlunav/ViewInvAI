// ----- Criptoactivos: precio de consenso de varias fuentes públicas e independientes -----
// Ningún organismo público publica precios de criptoactivos en tiempo real. La fiabilidad se
// consigue contrastando: mercados donde se negocian (Kraken, Bitstamp, Coinbase, Bit2Me) y
// agregadores que promedian decenas de mercados (CoinGecko, CoinPaprika). El precio que se
// muestra es la mediana; cada fuente se compara con ella y una desviación grande se señala.
// Cada fuente se pide una sola vez para todas las monedas (en lote) y se memoriza unos segundos.

export const CRYPTO_ASSETS = [
  // symbol, nombre, id CoinGecko, id CoinPaprika
  ["BTC","Bitcoin","bitcoin","btc-bitcoin"],
  ["ETH","Ethereum","ethereum","eth-ethereum"],
  ["USDT","Tether","tether","usdt-tether"],
  ["USDC","USD Coin","usd-coin","usdc-usd-coin"],
  ["XRP","XRP","ripple","xrp-xrp"],
  ["BNB","BNB","binancecoin","bnb-binance-coin"],
  ["SOL","Solana","solana","sol-solana"],
  ["ADA","Cardano","cardano","ada-cardano"],
  ["DOGE","Dogecoin","dogecoin","doge-dogecoin"],
  ["TRX","TRON","tron","trx-tron"],
  ["TON","Toncoin","the-open-network","ton-toncoin"],
  ["DOT","Polkadot","polkadot","dot-polkadot"],
  ["LINK","Chainlink","chainlink","link-chainlink"],
  ["AVAX","Avalanche","avalanche-2","avax-avalanche"],
  ["POL","Polygon (POL)","polygon-ecosystem-token","pol-polygon-ecosystem-token"],
  ["LTC","Litecoin","litecoin","ltc-litecoin"],
  ["BCH","Bitcoin Cash","bitcoin-cash","bch-bitcoin-cash"],
  ["XLM","Stellar","stellar","xlm-stellar"],
  ["ATOM","Cosmos","cosmos","atom-cosmos"],
  ["UNI","Uniswap","uniswap","uni-uniswap"],
  ["AAVE","Aave","aave","aave-new"],
  ["ALGO","Algorand","algorand","algo-algorand"],
  ["NEAR","NEAR Protocol","near","near-near-protocol"],
  ["ICP","Internet Computer","internet-computer","icp-internet-computer"],
  ["FIL","Filecoin","filecoin","fil-filecoin"],
  ["APT","Aptos","aptos","apt-aptos"],
  ["ARB","Arbitrum","arbitrum","arb-arbitrum"],
  ["OP","Optimism","optimism","op-optimism"],
  ["SUI","Sui","sui","sui-sui"],
  ["HBAR","Hedera","hedera-hashgraph","hbar-hedera-hashgraph"],
  ["ETC","Ethereum Classic","ethereum-classic","etc-ethereum-classic"],
  ["VET","VeChain","vechain","vet-vechain"],
  ["SHIB","Shiba Inu","shiba-inu","shib-shiba-inu"],
  ["PEPE","Pepe","pepe","pepe-pepe"],
  ["SAND","The Sandbox","the-sandbox","sand-the-sandbox"],
  ["MANA","Decentraland","decentraland","mana-decentraland"],
  ["AXS","Axie Infinity","axie-infinity","axs-axie-infinity"],
  ["CRV","Curve DAO","curve-dao-token","crv-curve-dao-token"],
  ["GRT","The Graph","the-graph","grt-the-graph"],
  ["INJ","Injective","injective-protocol","inj-injective-protocol"],
  ["RENDER","Render","render-token","render-render"],
  ["FET","Artificial Superintelligence Alliance","fetch-ai","fet-fetchai"],
  ["LDO","Lido DAO","lido-dao","ldo-lido-dao"],
  ["IMX","Immutable","immutable-x","imx-immutable-x"],
  ["XTZ","Tezos","tezos","xtz-tezos"],
  ["EGLD","MultiversX","elrond-erd-2","egld-elrond"],
  ["B2M","Bit2Me","bit2me","b2m-bit2me"],
  ["ZEC","Zcash","zcash","zec-zcash"],
  ["DASH","Dash","dash","dash-dash"],
  ["XMR","Monero","monero","xmr-monero"],
  ["KAS","Kaspa","kaspa","kas-kaspa"],
  ["TAO","Bittensor","bittensor","tao-bittensor"],
  ["ENA","Ethena","ethena","ena-ethena"],
  ["ONDO","Ondo","ondo-finance","ondo-ondo-finance"],
  ["BONK","Bonk","bonk","bonk-bonk"],
  ["WIF","dogwifhat","dogwifcoin","wif-dogwifcoin"],
  ["SEI","Sei","sei-network","sei-sei"],
  ["TIA","Celestia","celestia","tia-celestia"],
  ["JUP","Jupiter","jupiter-exchange-solana","jup-jupiter"],
  ["HYPE","Hyperliquid","hyperliquid","hype-hyperliquid"],
  ["XDC","XDC Network","xdce-crowd-sale","xdc-xdc-network"],
  ["QNT","Quant","quant-network","qnt-quant"],
  ["MKR","Maker","maker","mkr-maker"],
  ["COMP","Compound","compound-governance-token","comp-compoundd"],
  ["SNX","Synthetix","havven","snx-synthetix-network-token"],
  ["1INCH","1inch","1inch","1inch-1inch"],
  ["CHZ","Chiliz","chiliz","chz-chiliz"],
  ["ENJ","Enjin Coin","enjincoin","enj-enjin-coin"],
  ["BAT","Basic Attention Token","basic-attention-token","bat-basic-attention-token"],
  ["ZRX","0x","0x","zrx-0x"],
  ["FLOKI","Floki","floki","floki-floki-inu"],
  ["KSM","Kusama","kusama","ksm-kusama"],
  ["FLOW","Flow","flow","flow-flow"],
  ["MINA","Mina","mina-protocol","mina-mina-protocol"],
  ["GALA","Gala","gala","gala-gala"],
  ["APE","ApeCoin","apecoin","ape-apecoin"],
  ["STX","Stacks","blockstack","stx-blockstack"]
].map(([symbol,name,gecko,paprika])=>({symbol,name,gecko,paprika}));
// Lista conocida: nombre e identificadores de los agregadores. El catálogo real es más amplio:
// todas las monedas que cotizan en euros en Kraken, Bitstamp o Bit2Me (ver cryptoUniverse).
const BY_SYMBOL = new Map(CRYPTO_ASSETS.map(a=>[a.symbol,a]));
const NOT_CRYPTO = new Set(["EUR","USD","GBP","CHF","CAD","AUD","JPY","AED","NZD","SEK","NOK","DKK","PLN","CZK","HUF","TRY","MXN","BRL","ARS","HKD","SGD","ZAR","KRW","CNY","INR"]);
const SYMBOL_RE=/^[A-Z0-9]{2,10}$/;
const isCryptoSymbol=s=>SYMBOL_RE.test(s)&&!NOT_CRYPTO.has(s);
const krakenPairs=new Map();
// Kraken usa códigos históricos para algunas monedas.
const KRAKEN_ALIAS = { XBT:"BTC", XDG:"DOGE" };
const UA = { "User-Agent":"Mozilla/5.0 (compatible; ViewInvAI/1.0)", "Accept":"application/json" };
const SOURCE_TTL = 20000;
const memo = new Map();
const num = v => { if(v===null||v===undefined||v==="")return null; const n=Number(v); return Number.isFinite(n)?n:null; };

async function getJson(url, timeout=8000){
  const r = await fetch(url,{headers:UA,signal:AbortSignal.timeout(timeout),cf:{cacheTtl:15,cacheEverything:true}});
  if(!r.ok)throw new Error(url.split("/")[2]+" "+r.status);
  return r.json();
}
// Memoriza cada fuente SOURCE_TTL ms (una petición compartida por todas las visitas del isolate).
function cached(key,loader,ttl=SOURCE_TTL){
  const hit=memo.get(key);
  if(hit&&Date.now()-hit.at<ttl)return hit.pending;
  const pending=loader().catch(error=>{memo.delete(key);throw error});
  memo.set(key,{at:Date.now(),pending});
  return pending;
}

// Precio actual = punto medio entre la mejor compra y la mejor venta. La «última operación» puede
// ser de hace horas en pares con poco volumen; solo se usa si no hay horquilla razonable (<5 %).
function midPrice(bid,ask,last){
  if(bid>0&&ask>0&&ask>=bid&&(ask-bid)/bid<0.05)return(bid+ask)/2;
  return last>0?last:null;
}
// Un mercado con un volumen casi nulo en 24 h no forma un precio representativo: no entra.
const MIN_EUR_VOLUME_24H=2000;
function liquid(price,units24h){return units24h===null||price*units24h>=MIN_EUR_VOLUME_24H}
// Cada cargador devuelve Map(symbol -> {price, change24h?, open24h?}) en EUR.
const SOURCES = {
  kraken:{label:"Kraken",kind:"mercado",load:()=>cached("kraken",async()=>{
    const d=await getJson("https://api.kraken.com/0/public/Ticker");
    const out=new Map();
    for(const [pair,t] of Object.entries(d&&d.result||{})){
      const m=pair.match(/^(.+?)Z?EUR$/);if(!m)continue;
      let base=m[1];if(base.length===4&&/^X/.test(base))base=base.slice(1);
      base=KRAKEN_ALIAS[base]||base;
      if(!isCryptoSymbol(base)||out.has(base))continue;
      krakenPairs.set(base,pair);
      const price=midPrice(num(t&&t.b&&t.b[0]),num(t&&t.a&&t.a[0]),num(t&&t.c&&t.c[0]));
      if(price>0&&liquid(price,num(t&&t.v&&t.v[1])))out.set(base,{price,high24h:num(t&&t.h&&t.h[1]),low24h:num(t&&t.l&&t.l[1]),open24h:num(t&&t.o)});
    }
    return out;
  })},
  bitstamp:{label:"Bitstamp",kind:"mercado",load:()=>cached("bitstamp",async()=>{
    const d=await getJson("https://www.bitstamp.net/api/v2/ticker/");
    const out=new Map();
    for(const t of Array.isArray(d)?d:[]){
      const m=String(t&&t.pair||"").match(/^([A-Z0-9]+)\/EUR$/);if(!m||!isCryptoSymbol(m[1]))continue;
      const price=midPrice(num(t.bid),num(t.ask),num(t.last)),open=num(t.open_24);
      if(price>0&&liquid(price,num(t.volume)))out.set(m[1],{price,change24h:open>0?(price/open-1)*100:null,high24h:num(t.high),low24h:num(t.low)});
    }
    return out;
  })},
  coinbase:{label:"Coinbase",kind:"mercado",load:()=>cached("coinbase",async()=>{
    // Tipos de cambio de Coinbase: 1 EUR = rate monedas.
    const d=await getJson("https://api.coinbase.com/v2/exchange-rates?currency=EUR");
    const out=new Map();
    for(const [sym,rate] of Object.entries(d&&d.data&&d.data.rates||{})){
      // Coinbase mezcla monedas y divisas: solo cuenta lo que también cotiza en otro mercado
      // o está en la lista conocida (el filtro final se hace en cryptoUniverse).
      const r=num(rate);if(isCryptoSymbol(sym)&&r>0)out.set(sym,{price:1/r});
    }
    return out;
  })},
  bit2me:{label:"Bit2Me",kind:"mercado",load:()=>cached("bit2me",async()=>{
    const d=await getJson("https://gateway.bit2me.com/v2/trading/tickers");
    const out=new Map();
    for(const t of Array.isArray(d)?d:Array.isArray(d&&d.data)?d.data:[]){
      const m=String(t&&t.symbol||"").match(/^([A-Z0-9]+)\/EUR$/);if(!m||!isCryptoSymbol(m[1]))continue;
      const price=num(t.close??t.last??t.price),pct=num(t.percentage??t.change24h);
      if(price>0)out.set(m[1],{price,change24h:pct});
    }
    return out;
  })},
  coingecko:{label:"CoinGecko",kind:"agregador",load:env=>cached("coingecko",()=>geckoWithKv(env),GECKO_TTL)},
  coinlore:{label:"CoinLore",kind:"agregador",meta:true,load:()=>cached("coinlore",async()=>{
    // Agregador de respaldo para capitalización y variaciones (cotiza en USD: su precio no entra
    // en la mediana, solo sus porcentajes y su capitalización convertida con el precio en €).
    // Las 200 primeras por capitalización (dos páginas de 100).
    const pages=await Promise.allSettled([0,100].map(start=>getJson("https://api.coinlore.net/api/tickers/?start="+start+"&limit=100")));
    const rows=pages.flatMap(p=>p.status==="fulfilled"&&Array.isArray(p.value&&p.value.data)?p.value.data:[]);
    if(!rows.length)throw new Error("CoinLore sin datos");
    const out=new Map();
    for(const c of rows){
      const sym=String(c&&c.symbol||"").toUpperCase();if(!isCryptoSymbol(sym)||out.has(sym))continue;
      const usd=num(c.price_usd);if(!(usd>0))continue;
      out.set(sym,{name:String(c.name||"").slice(0,60),usd,change24h:num(c.percent_change_24h),change7d:num(c.percent_change_7d),marketCapUsd:num(c.market_cap_usd),volumeUsd:num(c.volume24),rank:num(c.rank)});
    }
    return out;
  },5*60000)}
};
const GECKO_TTL=5*60000,GECKO_KV="crypto:coingecko:v1";
// CoinGecko limita mucho a las IP compartidas de Cloudflare: su último dato válido se guarda en KV
// (6 h) y se usa mientras responda 429, para no perder capitalización, variaciones ni logos.
async function geckoWithKv(env){
  const kv=env&&env.HOT_STATE_KV;
  try{
    const map=await geckoFetch();
    if(kv&&map.size)try{await kv.put(GECKO_KV,JSON.stringify({at:Date.now(),rows:[...map.entries()]}),{expirationTtl:21600})}catch(_){}
    return map;
  }catch(error){
    if(kv)try{const saved=await kv.get(GECKO_KV,"json");if(saved&&Array.isArray(saved.rows)&&saved.rows.length){const m=new Map(saved.rows);m.stale=true;m.savedAt=saved.at;return m}}catch(_){}
    throw error;
  }
}
async function geckoFetch(){
    const ids=CRYPTO_ASSETS.map(a=>a.gecko).join(",");
    const d=await getJson("https://api.coingecko.com/api/v3/coins/markets?vs_currency=eur&ids="+encodeURIComponent(ids)+"&per_page=250&price_change_percentage=24h,7d,30d");
    const bySlug=new Map(CRYPTO_ASSETS.map(a=>[a.gecko,a.symbol])),out=new Map();
    for(const c of Array.isArray(d)?d:[]){
      const sym=bySlug.get(c&&c.id);const price=num(c&&c.current_price);if(!sym||!(price>0))continue;
      out.set(sym,{price,change24h:num(c.price_change_percentage_24h_in_currency??c.price_change_percentage_24h),
        change7d:num(c.price_change_percentage_7d_in_currency),change30d:num(c.price_change_percentage_30d_in_currency),
        marketCap:num(c.market_cap),volume24h:num(c.total_volume),rank:num(c.market_cap_rank),image:typeof c.image==="string"?c.image:"",
        high24h:num(c.high_24h),low24h:num(c.low_24h),ath:num(c.ath)});
    }
    return out;
}
// CoinPaprika (otro agregador) solo para una moneda concreta: su lista completa es muy grande.
async function paprikaOne(asset){
  if(!asset||!asset.paprika)return null;
  const d=await cached("paprika:"+asset.symbol,()=>getJson("https://api.coinpaprika.com/v1/tickers/"+encodeURIComponent(asset.paprika)+"?quotes=EUR"));
  const q=d&&d.quotes&&d.quotes.EUR;const price=num(q&&q.price);
  return price>0?{price,change24h:num(q.percent_change_24h)}:null;
}

const DIVERGENCE_PCT = 1.0;
function median(values){const v=values.slice().sort((a,b)=>a-b),m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2}
function consensus(symbol,rows){
  const valid=rows.filter(r=>r.price>0);
  if(!valid.length)return{symbol,price:null,status:"none",sources:rows};
  // Las monedas estables (USDT, USDC) cotizan ~0,86 € y varían muy poco: el mismo umbral sirve.
  const mid=median(valid.map(r=>r.price));
  for(const r of rows)r.deviationPct=r.price>0?(r.price/mid-1)*100:null;
  const maxDev=Math.max(...valid.map(r=>Math.abs(r.deviationPct)));
  const outliers=valid.filter(r=>Math.abs(r.deviationPct)>DIVERGENCE_PCT).map(r=>r.source);
  // Si hay valores atípicos y quedan al menos 3 fuentes coherentes, la mediana se recalcula sin ellos.
  let price=mid;
  const agreeing=valid.filter(r=>Math.abs(r.deviationPct)<=DIVERGENCE_PCT);
  if(outliers.length&&agreeing.length>=3)price=median(agreeing.map(r=>r.price));
  const status=valid.length<2?"single":outliers.length?"divergent":"ok";
  return{symbol,price,status,maxDeviationPct:maxDev,outliers,agreeing:agreeing.length,count:valid.length,sources:rows};
}

// Cotizaciones de consenso. detail=true añade CoinPaprika (una petición por moneda).
// env (opcional) da acceso a KV para guardar el último dato de CoinGecko.
// Universo: lo que cotiza en euros en al menos un mercado (Kraken, Bitstamp, Bit2Me) más la lista
// conocida. Coinbase solo suma precio a monedas de ese universo (sus tasas incluyen divisas).
const MARKET_SOURCES=["kraken","bitstamp","bit2me"];
function universeFrom(names,settled){
  const set=new Set(CRYPTO_ASSETS.map(a=>a.symbol));
  names.forEach((n,i)=>{if(MARKET_SOURCES.includes(n)&&settled[i].status==="fulfilled")for(const k of settled[i].value.keys())set.add(k)});
  return set;
}
function nameOf(sym,lore){const a=BY_SYMBOL.get(sym);return a?a.name:(lore&&lore.get(sym)&&lore.get(sym).name)||sym}
export async function cryptoCatalog(env=null){
  const names=Object.keys(SOURCES),settled=await Promise.allSettled(names.map(n=>SOURCES[n].load(env)));
  const lore=settled[names.indexOf("coinlore")].status==="fulfilled"?settled[names.indexOf("coinlore")].value:null;
  return[...universeFrom(names,settled)].sort().map(symbol=>({symbol,name:nameOf(symbol,lore)}));
}
export async function cryptoQuotes(symbols,{detail=false,env=null}={}){
  const names=Object.keys(SOURCES);
  const settled=await Promise.allSettled(names.map(n=>SOURCES[n].load(env)));
  const universe=universeFrom(names,settled);
  const wanted=[...new Set((symbols&&symbols.length?symbols:[...universe]).map(s=>String(s).toUpperCase()).filter(s=>universe.has(s)))];
  const value=n=>{const i=names.indexOf(n);return i>=0&&settled[i].status==="fulfilled"?settled[i].value:null};
  const health={};
  names.forEach((n,i)=>{
    const ok=settled[i].status==="fulfilled",v=ok?settled[i].value:null;
    health[n]={label:SOURCES[n].label,kind:SOURCES[n].kind,ok,count:v?v.size:0,
      stale:!!(v&&v.stale),savedAt:v&&v.savedAt?new Date(v.savedAt).toISOString():null,role:SOURCES[n].meta?"datos":"precio",
      error:ok?"":String(settled[i].reason&&settled[i].reason.message||settled[i].reason).slice(0,120)};
  });
  const paprika=detail?await Promise.allSettled(wanted.map(s=>paprikaOne(BY_SYMBOL.get(s)))):[];
  if(detail)health.coinpaprika={label:"CoinPaprika",kind:"agregador",role:"precio",ok:paprika.some(p=>p.status==="fulfilled"&&p.value),count:paprika.filter(p=>p.status==="fulfilled"&&p.value).length,error:""};
  const gecko=value("coingecko"),lore=value("coinlore");
  const quotes={};
  wanted.forEach((sym,idx)=>{
    const rows=[],changes=[];
    names.forEach((n,i)=>{
      if(SOURCES[n].meta||settled[i].status!=="fulfilled")return;
      const map=settled[i].value,v=map.get(sym);if(!v)return;
      // Un dato guardado (CoinGecko en 429) no es un precio actual: no entra en la mediana.
      if(!map.stale)rows.push({source:SOURCES[n].label,kind:SOURCES[n].kind,price:v.price});
      if(!map.stale&&v.change24h!==null&&v.change24h!==undefined)changes.push(v.change24h);
    });
    if(detail&&paprika[idx]&&paprika[idx].status==="fulfilled"&&paprika[idx].value){
      const v=paprika[idx].value;rows.push({source:"CoinPaprika",kind:"agregador",price:v.price});
      if(v.change24h!==null)changes.push(v.change24h);
    }
    const c=consensus(sym,rows),g=gecko&&gecko.get(sym)||{},l=lore&&lore.get(sym)||null;
    // Rango de 24 h de los mercados (Kraken, Bitstamp) si CoinGecko no lo da.
    const highs=[],lows=[];
    names.forEach((n,i)=>{if(SOURCES[n].meta||settled[i].status!=="fulfilled")return;const v=settled[i].value.get(sym);if(v&&v.high24h>0)highs.push(v.high24h);if(v&&v.low24h>0)lows.push(v.low24h)});
    if(!changes.length&&l&&l.change24h!==null)changes.push(l.change24h);
    // Capitalización y volumen en €: de CoinGecko; si no, los de CoinLore (USD) pasados a € con
    // la relación entre el precio de consenso y su precio en USD.
    const usdRatio=l&&c.price>0&&l.usd>0?c.price/l.usd:null;
    quotes[sym]=Object.assign(c,{name:nameOf(sym,lore),change24h:changes.length?median(changes):null,
      change7d:g.change7d??(l?l.change7d:null)??null,change30d:g.change30d??null,
      marketCap:g.marketCap??(usdRatio&&l.marketCapUsd?l.marketCapUsd*usdRatio:null),volume24h:g.volume24h??(usdRatio&&l.volumeUsd?l.volumeUsd*usdRatio:null),
      rank:g.rank??(l?l.rank:null)??null,image:g.image||"",high24h:g.high24h??(highs.length?median(highs):null),low24h:g.low24h??(lows.length?median(lows):null),ath:g.ath??null});
  });
  // En la ficha: variación a 7 y 30 días y máximo de 2 años con las velas diarias de Kraken.
  if(detail)await Promise.all(wanted.map(async sym=>{
    const q=quotes[sym];if(!q)return;
    try{
      const st=await krakenDailyStats(sym,env);if(!st)return;
      if(q.change7d===null&&st.close7>0&&q.price>0)q.change7d=(q.price/st.close7-1)*100;
      if(q.change30d===null&&st.close30>0&&q.price>0)q.change30d=(q.price/st.close30-1)*100;
      if(q.ath===null&&st.max>0){q.high2y=st.max;q.high2ySource="Kraken"}
    }catch(_){}
  }));
  return{updatedAt:new Date().toISOString(),currency:"EUR",divergenceThresholdPct:DIVERGENCE_PCT,sources:health,quotes};
}

async function krakenDailyStats(sym,env){
  if(!krakenPairs.size)try{await SOURCES.kraken.load(env)}catch(_){}
  const pair=krakenPairs.get(sym);if(!pair)return null;
  const data=await cached("kchart:"+pair+":1440",()=>getJson("https://api.kraken.com/0/public/OHLC?pair="+encodeURIComponent(pair)+"&interval=1440",10000),5*60000);
  const rows=data&&data.result?Object.entries(data.result).find(([k])=>k!=="last"):null;
  const days=(rows?rows[1]:[]).map(r=>({t:Number(r[0])*1000,c:Number(r[4]),h:Number(r[2])})).filter(d=>d.c>0);
  if(days.length<2)return null;
  const at=ms=>{const target=Date.now()-ms;let best=null;for(const d of days)if(d.t<=target)best=d;return best?best.c:null};
  return{close7:at(7*86400000),close30:at(30*86400000),max:Math.max(...days.map(d=>d.h))};
}
// Gráfico de la ficha: velas de Kraken (un mercado real, sin los límites de CoinGecko) y, si la
// moneda no cotiza en Kraken, el histórico de CoinGecko.
export async function cryptoChart(symbol,days=30,env=null){
  const sym=String(symbol||"").toUpperCase();if(!isCryptoSymbol(sym))throw new Error("Moneda desconocida");
  const d=[7,30,90,365].includes(days)?days:30;
  if(!krakenPairs.size)try{await SOURCES.kraken.load(env)}catch(_){}
  const pair=krakenPairs.get(sym);
  if(pair){
    const interval=d<=7?60:d<=30?240:1440;
    const data=await cached("kchart:"+pair+":"+interval,()=>getJson("https://api.kraken.com/0/public/OHLC?pair="+encodeURIComponent(pair)+"&interval="+interval,10000),5*60000);
    const rows=data&&data.result?Object.entries(data.result).find(([k])=>k!=="last"):null;
    const since=Date.now()-d*86400000;
    const points=(rows?rows[1]:[]).map(r=>[Number(r[0])*1000,Number(r[4])]).filter(p=>p[0]>=since&&p[1]>0);
    if(points.length>1)return{symbol:sym,days:d,source:"Kraken",points};
  }
  const asset=BY_SYMBOL.get(sym);if(!asset)throw new Error("Sin histórico");
  const data=await cached("chart:"+sym+":"+d,()=>getJson("https://api.coingecko.com/api/v3/coins/"+encodeURIComponent(asset.gecko)+"/market_chart?vs_currency=eur&days="+d+(d>90?"&interval=daily":""),10000),5*60000);
  const points=(Array.isArray(data&&data.prices)?data.prices:[]).map(p=>[Number(p[0]),Number(p[1])]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  return{symbol:sym,days:d,source:"CoinGecko",points};
}


// ---------- Binance Alpha (solo consulta) ----------
// Tokens en cadena que Binance destaca antes de listarlos. Desde julio de 2026 Binance no puede
// vender a residentes en España (sin licencia MiCA): aquí solo se consultan como radar temprano y se
// indica si la moneda se puede comprar en euros en un exchange autorizado del catálogo.
// Precio: el de Binance Alpha (USD) contrastado con el par de más liquidez en DexScreener y, en la
// con GeckoTerminal. Todo se pasa a € con el precio de USDT en los mercados en euros.
const ALPHA_LIST_URL="https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list";
const ALPHA_KV="crypto:alpha:v1";
const ALPHA_DIVERGENCE_PCT=2.0,ALPHA_MIN_DEX_LIQ_USD=20000,ALPHA_CONTRAST_TOP=60;
const DEX_CHAIN={"56":"bsc","CT_501":"solana","1":"ethereum","8453":"base","42161":"arbitrum","137":"polygon","43114":"avalanche","10":"optimism","204":"opbnb","59144":"linea","5000":"mantle","146":"sonic","80094":"berachain","324":"zksync"};
const GT_NETWORK={bsc:"bsc",solana:"solana",ethereum:"eth",base:"base",arbitrum:"arbitrum",polygon:"polygon_pos",avalanche:"avax",optimism:"optimism",opbnb:"opbnb",linea:"linea",mantle:"mantle",sonic:"sonic",berachain:"berachain",zksync:"zksync"};
const ALPHA_ID_RE=/^ALPHA_\d{1,6}$/;
const addrKey=(chain,addr)=>chain+":"+String(addr||"").toLowerCase();
function safeIcon(u){
  const s=String(u||"");
  if(/^https:\/\/[a-z0-9.-]*bnbstatic\.com\//i.test(s))return s.slice(0,300);
  if(/^\/images\//.test(s))return"https://bin.bnbstatic.com"+s.slice(0,280);
  return"";
}
// € por cada dólar: precio de USDT (o USDC) en los mercados en euros.
async function eurPerUsd(env){
  const vals=[];
  for(const n of ["kraken","bitstamp","bit2me","coinbase"]){
    try{const m=await SOURCES[n].load(env);const v=m.get("USDT")||m.get("USDC");if(v&&v.price>0.5&&v.price<1.5)vals.push(v.price)}catch(_){}
  }
  return vals.length?median(vals):null;
}
async function alphaListRaw(env){
  const kv=env&&env.HOT_STATE_KV;
  try{
    const d=await cached("alpha:list",()=>getJson(ALPHA_LIST_URL,10000),60000);
    const rows=Array.isArray(d&&d.data)?d.data:Array.isArray(d)?d:[];
    if(!rows.length)throw new Error("Binance Alpha sin datos");
    if(kv)try{await kv.put(ALPHA_KV,JSON.stringify({at:Date.now(),rows}),{expirationTtl:21600})}catch(_){}
    return{rows,stale:false,savedAt:null};
  }catch(error){
    if(kv)try{const s=await kv.get(ALPHA_KV,"json");if(s&&Array.isArray(s.rows)&&s.rows.length)return{rows:s.rows,stale:true,savedAt:s.at}}catch(_){}
    throw error;
  }
}
// DexScreener: hasta 30 contratos por cadena y petición. Se queda con el par de más liquidez.
async function dexPrices(tokens,health){
  const out=new Map(),byChain=new Map();
  for(const t of tokens){if(!t.dexChain||!t.contract)continue;if(!byChain.has(t.dexChain))byChain.set(t.dexChain,[]);byChain.get(t.dexChain).push(t.contract)}
  const jobs=[];
  for(const [chain,addrs] of byChain)for(let i=0;i<addrs.length;i+=30){
    const part=addrs.slice(i,i+30);
    jobs.push(cached("dex:"+chain+":"+part.join(","),()=>getJson("https://api.dexscreener.com/tokens/v1/"+chain+"/"+part.map(encodeURIComponent).join(","),10000),60000)
      .then(pairs=>{for(const p of Array.isArray(pairs)?pairs:[]){
        const base=p&&p.baseToken,liq=num(p&&p.liquidity&&p.liquidity.usd),price=num(p&&p.priceUsd);
        if(!base||!(price>0)||!(liq>=ALPHA_MIN_DEX_LIQ_USD))continue;
        const k=addrKey(chain,base.address),old=out.get(k);
        if(!old||liq>old.liquidityUsd)out.set(k,{priceUsd:price,liquidityUsd:liq,volumeUsd:num(p.volume&&p.volume.h24),dex:String(p.dexId||"").slice(0,30),pair:String(p.pairAddress||"").slice(0,120),url:/^https:\/\/dexscreener\.com\//.test(p.url||"")?p.url:""});
      }
      if(health)health.ok++;}).catch(e=>{if(health){health.failed++;health.error=String(e&&e.message||e).slice(0,120)}}));
  }
  await Promise.all(jobs);
  return out;
}
// GeckoTerminal en lote: hasta 30 contratos por red y petición.
async function geckoTerminalBatch(tokens,health){
  const out=new Map(),byNet=new Map();
  for(const t of tokens){const net=GT_NETWORK[t.dexChain];if(!net||!t.contract)continue;if(!byNet.has(net))byNet.set(net,{chain:t.dexChain,addrs:[]});byNet.get(net).addrs.push(t.contract)}
  const jobs=[];
  for(const [net,{chain,addrs}] of byNet)for(let i=0;i<addrs.length;i+=30){
    const part=addrs.slice(i,i+30);
    jobs.push(cached("gtb:"+net+":"+part.join(","),()=>getJson("https://api.geckoterminal.com/api/v2/simple/networks/"+net+"/token_price/"+part.map(encodeURIComponent).join(","),10000),60000)
      .then(d=>{const prices=d&&d.data&&d.data.attributes&&d.data.attributes.token_prices||{};
        for(const [k,v] of Object.entries(prices)){const p=num(v);if(p>0)out.set(addrKey(chain,k),p)}
        if(health)health.ok++;})
      .catch(e=>{if(health){health.failed++;health.error=String(e&&e.message||e).slice(0,120)}}));
  }
  await Promise.all(jobs);
  return out;
}
function alphaContrast(rows){
  const c=consensus("ALPHA",rows.map(r=>({source:r.source,kind:r.kind,price:r.price})));
  // Con dos fuentes la mediana es el punto medio: se mantiene la referencia de Binance Alpha y
  // se avisa si la otra se separa más de ALPHA_DIVERGENCE_PCT.
  const ref=rows[0]&&rows[0].price;
  const dev=rows.slice(1).map(r=>Math.abs(r.price/ref-1)*100);
  const maxDev=dev.length?Math.max(...dev):null;
  return{price:rows.length>=3?c.price:ref,count:rows.length,maxDeviationPct:maxDev,
    status:rows.length<2?"single":maxDev<=ALPHA_DIVERGENCE_PCT?"ok":"divergent",
    sources:rows.map(r=>Object.assign({},r,{deviationPct:ref>0?(r.price/ref-1)*100:null}))};
}
// opts.ids: ficha (contraste con las tres fuentes); si no, las ALPHA_CONTRAST_TOP de más volumen.
export async function alphaTokens({env=null,ids=null,euroSymbols=null}={}){
  const [{rows,stale,savedAt},fx]=await Promise.all([alphaListRaw(env),eurPerUsd(env)]);
  if(!(fx>0))throw new Error("Sin tipo de cambio USD/EUR");
  let euro=euroSymbols;
  if(!euro){try{euro=new Set((await cryptoCatalog(env)).map(a=>a.symbol))}catch(_){euro=new Set()}}
  const wanted=ids&&ids.length?new Set(ids.filter(i=>ALPHA_ID_RE.test(i))):null;
  let tokens=rows.filter(r=>r&&!r.offline&&ALPHA_ID_RE.test(String(r.alphaId||""))&&num(r.price)>0).map(r=>{
    const chainId=String(r.chainId||""),sym=String(r.symbol||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,16);
    const usd=k=>{const v=num(r[k]);return v===null?null:v*fx};
    return{id:String(r.alphaId),symbol:sym,name:String(r.name||sym).slice(0,60),chain:String(r.chainName||DEX_CHAIN[chainId]||chainId).slice(0,30),chainId,dexChain:DEX_CHAIN[chainId]||"",
      contract:String(r.contractAddress||"").slice(0,80),icon:safeIcon(r.iconUrl),priceUsd:num(r.price),change24h:num(r.percentChange24h),
      volume24h:usd("volume24h"),marketCap:usd("marketCap"),fdv:usd("fdv"),liquidity:usd("liquidity"),high24h:usd("priceHigh24h"),low24h:usd("priceLow24h"),
      holders:num(r.holders),trades24h:num(r.count24h),listingTime:num(r.listingTime),
      // ¿Se puede comprar en € en un exchange autorizado del catálogo (Kraken, Bitstamp, Bit2Me, Coinbase)?
      euroMarket:!!(sym&&euro.has(sym))};
  });
  if(wanted)tokens=tokens.filter(t=>wanted.has(t.id));
  tokens.sort((a,b)=>(b.volume24h||0)-(a.volume24h||0));
  const contrastSet=wanted?tokens:tokens.slice(0,ALPHA_CONTRAST_TOP);
  const health={dexscreener:{label:"DexScreener",ok:0,failed:0,error:""},geckoterminal:{label:"GeckoTerminal",ok:0,failed:0,error:""}};
  const [dex,gtMap]=await Promise.all([dexPrices(contrastSet,health.dexscreener),geckoTerminalBatch(contrastSet,health.geckoterminal)]);
  const contrasted=new Set(contrastSet.map(t=>t.id));
  tokens.forEach(t=>{
    const rowsP=[{source:"Binance Alpha",kind:"agregador",price:t.priceUsd*fx}];
    if(contrasted.has(t.id)){
      const d=dex.get(addrKey(t.dexChain,t.contract));
      if(d){rowsP.push({source:"DexScreener",kind:"mercado",price:d.priceUsd*fx,liquidity:d.liquidityUsd*fx,dex:d.dex});t.dexUrl=d.url;t.pool=d.pair}
      const g=gtMap.get(addrKey(t.dexChain,t.contract));
      if(g)rowsP.push({source:"GeckoTerminal",kind:"agregador",price:g*fx});
    }
    Object.assign(t,alphaContrast(rowsP),{contrasted:contrasted.has(t.id)});
    if(!contrasted.has(t.id))t.status="unchecked";
  });
  return{updatedAt:new Date().toISOString(),currency:"EUR",eurPerUsd:fx,stale,savedAt:savedAt?new Date(savedAt).toISOString():null,
    divergenceThresholdPct:ALPHA_DIVERGENCE_PCT,sources:health,count:tokens.length,tokens};
}
// Gráfico: velas del pool de más liquidez (GeckoTerminal), pasadas a € con el cambio actual.
export async function alphaChart(id,days=7,env=null){
  if(!ALPHA_ID_RE.test(String(id||"")))throw new Error("Token desconocido");
  const d=[1,7,30,90].includes(days)?days:7;
  const data=await alphaTokens({env,ids:[id],euroSymbols:new Set()});
  const t=data.tokens[0];if(!t||!t.pool)throw new Error("Sin pool con liquidez");
  const net=GT_NETWORK[t.dexChain];if(!net)throw new Error("Cadena sin histórico");
  const [tf,agg,limit]=d<=1?["minute",15,96]:d<=7?["hour",1,168]:d<=30?["hour",4,180]:["day",1,90];
  const o=await cached("gtohlcv:"+net+":"+t.pool+":"+tf+agg,()=>getJson("https://api.geckoterminal.com/api/v2/networks/"+net+"/pools/"+encodeURIComponent(t.pool)+"/ohlcv/"+tf+"?aggregate="+agg+"&limit="+limit+"&currency=usd",10000),5*60000);
  const list=o&&o.data&&o.data.attributes&&Array.isArray(o.data.attributes.ohlcv_list)?o.data.attributes.ohlcv_list:[];
  const points=list.map(r=>[Number(r[0])*1000,Number(r[4])*data.eurPerUsd]).filter(p=>p[0]>0&&p[1]>0).sort((a,b)=>a[0]-b[0]);
  return{id,days:d,source:"GeckoTerminal",points};
}
