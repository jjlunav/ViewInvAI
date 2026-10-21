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
  ["B2M","Bit2Me","bit2me","b2m-bit2me"]
].map(([symbol,name,gecko,paprika])=>({symbol,name,gecko,paprika}));
const BY_SYMBOL = new Map(CRYPTO_ASSETS.map(a=>[a.symbol,a]));
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
function cached(key,loader){
  const hit=memo.get(key);
  if(hit&&Date.now()-hit.at<SOURCE_TTL)return hit.pending;
  const pending=loader().catch(error=>{memo.delete(key);throw error});
  memo.set(key,{at:Date.now(),pending});
  return pending;
}

// Cada cargador devuelve Map(symbol -> {price, change24h?, open24h?}) en EUR.
const SOURCES = {
  kraken:{label:"Kraken",kind:"mercado",load:()=>cached("kraken",async()=>{
    const d=await getJson("https://api.kraken.com/0/public/Ticker");
    const out=new Map();
    for(const [pair,t] of Object.entries(d&&d.result||{})){
      const m=pair.match(/^(.+?)Z?EUR$/);if(!m)continue;
      let base=m[1];if(base.length===4&&/^X/.test(base))base=base.slice(1);
      base=KRAKEN_ALIAS[base]||base;
      if(!BY_SYMBOL.has(base)||out.has(base))continue;
      const price=num(t&&t.c&&t.c[0]);if(price>0)out.set(base,{price});
    }
    return out;
  })},
  bitstamp:{label:"Bitstamp",kind:"mercado",load:()=>cached("bitstamp",async()=>{
    const d=await getJson("https://www.bitstamp.net/api/v2/ticker/");
    const out=new Map();
    for(const t of Array.isArray(d)?d:[]){
      const m=String(t&&t.pair||"").match(/^([A-Z0-9]+)\/EUR$/);if(!m||!BY_SYMBOL.has(m[1]))continue;
      const price=num(t.last),open=num(t.open_24);
      if(price>0)out.set(m[1],{price,change24h:open>0?(price/open-1)*100:null});
    }
    return out;
  })},
  coinbase:{label:"Coinbase",kind:"mercado",load:()=>cached("coinbase",async()=>{
    // Tipos de cambio de Coinbase: 1 EUR = rate monedas.
    const d=await getJson("https://api.coinbase.com/v2/exchange-rates?currency=EUR");
    const out=new Map();
    for(const [sym,rate] of Object.entries(d&&d.data&&d.data.rates||{})){
      const r=num(rate);if(BY_SYMBOL.has(sym)&&r>0)out.set(sym,{price:1/r});
    }
    return out;
  })},
  bit2me:{label:"Bit2Me",kind:"mercado",load:()=>cached("bit2me",async()=>{
    const d=await getJson("https://gateway.bit2me.com/v2/trading/tickers");
    const out=new Map();
    for(const t of Array.isArray(d)?d:Array.isArray(d&&d.data)?d.data:[]){
      const m=String(t&&t.symbol||"").match(/^([A-Z0-9]+)\/EUR$/);if(!m||!BY_SYMBOL.has(m[1]))continue;
      const price=num(t.close??t.last??t.price),pct=num(t.percentage??t.change24h);
      if(price>0)out.set(m[1],{price,change24h:pct});
    }
    return out;
  })},
  coingecko:{label:"CoinGecko",kind:"agregador",load:()=>cached("coingecko",async()=>{
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
  })}
};
// CoinPaprika (otro agregador) solo para una moneda concreta: su lista completa es muy grande.
async function paprikaOne(asset){
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
export async function cryptoQuotes(symbols,{detail=false}={}){
  const wanted=[...new Set((symbols&&symbols.length?symbols:CRYPTO_ASSETS.map(a=>a.symbol)).map(s=>String(s).toUpperCase()).filter(s=>BY_SYMBOL.has(s)))];
  const names=Object.keys(SOURCES);
  const settled=await Promise.allSettled(names.map(n=>SOURCES[n].load()));
  const health={};
  names.forEach((n,i)=>{health[n]={label:SOURCES[n].label,kind:SOURCES[n].kind,ok:settled[i].status==="fulfilled",count:settled[i].status==="fulfilled"?settled[i].value.size:0,error:settled[i].status==="rejected"?String(settled[i].reason&&settled[i].reason.message||settled[i].reason).slice(0,120):""}});
  const paprika=detail?await Promise.allSettled(wanted.map(s=>paprikaOne(BY_SYMBOL.get(s)))):[];
  if(detail)health.coinpaprika={label:"CoinPaprika",kind:"agregador",ok:paprika.some(p=>p.status==="fulfilled"&&p.value),count:paprika.filter(p=>p.status==="fulfilled"&&p.value).length,error:""};
  const quotes={};
  wanted.forEach((sym,idx)=>{
    const rows=[];let meta={};const changes=[];
    names.forEach((n,i)=>{
      if(settled[i].status!=="fulfilled")return;
      const v=settled[i].value.get(sym);if(!v)return;
      rows.push({source:SOURCES[n].label,kind:SOURCES[n].kind,price:v.price});
      if(v.change24h!==null&&v.change24h!==undefined)changes.push(v.change24h);
      if(n==="coingecko")meta=v;
    });
    if(detail&&paprika[idx]&&paprika[idx].status==="fulfilled"&&paprika[idx].value){
      const v=paprika[idx].value;rows.push({source:"CoinPaprika",kind:"agregador",price:v.price});
      if(v.change24h!==null)changes.push(v.change24h);
    }
    const asset=BY_SYMBOL.get(sym),c=consensus(sym,rows);
    quotes[sym]=Object.assign(c,{name:asset.name,change24h:changes.length?median(changes):null,
      change7d:meta.change7d??null,change30d:meta.change30d??null,marketCap:meta.marketCap??null,volume24h:meta.volume24h??null,
      rank:meta.rank??null,image:meta.image||"",high24h:meta.high24h??null,low24h:meta.low24h??null,ath:meta.ath??null});
  });
  return{updatedAt:new Date().toISOString(),currency:"EUR",divergenceThresholdPct:DIVERGENCE_PCT,sources:health,quotes};
}

// Histórico diario (CoinGecko) para el gráfico de la ficha.
export async function cryptoChart(symbol,days=30){
  const asset=BY_SYMBOL.get(String(symbol||"").toUpperCase());if(!asset)throw new Error("Moneda desconocida");
  const d=[7,30,90,365].includes(days)?days:30;
  const data=await cached("chart:"+asset.symbol+":"+d,()=>getJson("https://api.coingecko.com/api/v3/coins/"+encodeURIComponent(asset.gecko)+"/market_chart?vs_currency=eur&days="+d+(d>90?"&interval=daily":""),10000));
  const points=(Array.isArray(data&&data.prices)?data.prices:[]).map(p=>[Number(p[0]),Number(p[1])]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  return{symbol:asset.symbol,days:d,source:"CoinGecko",points};
}
export const CRYPTO_SYMBOLS = new Set(CRYPTO_ASSETS.map(a=>a.symbol));
