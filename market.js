/*
 * ViewInvAI market runtime
 * ------------------------
 * Canonical quotes, market sessions, Trade Republic live feed, Nasdaq polling and FX.
 */

const MAX_TR_LIVE_SUBSCRIPTIONS=120;
const TR_LIVE_DIRECT='wss://api.traderepublic.com';

function trProxyUrl(){
 if(window.ViewInvAIRuntime&&typeof window.ViewInvAIRuntime.websocketUrl==='function'){
  return window.ViewInvAIRuntime.websocketUrl('/api/tr-live');
 }
 // Web frontend does not load native-runtime.js, so never fall back to the
 // static frontend host for WS upgrades. The TR feed terminates at the Worker.
 return 'wss://viewinvai.sonarlab.workers.dev/api/tr-live';
}

let trLive={ws:null,connected:false,connecting:false,seq:1,subByKey:new Map(),keyBySub:new Map(),payloadBySub:new Map(),wanted:new Set(),reconnectTimer:null,reconnectAttempt:0,observer:null,usingDirect:false,proxyFailures:0,lastDataAt:0};
let usLive={busy:false,lastFetchAt:0};
let fxLive={rate:null,updatedAt:0,busy:false};
let tvChartAvailability=new Map();

function eurUsd(){let r=N(fxLive.rate)??N(db.meta&&db.meta.eurUsd);return r&&r>0?r:null}
function priceCurrencies(s,p){
 p=N(p);if(p===null)return{usd:null,eur:null};
 let fx=eurUsd(),cur=String((s&&s.currency)||'USD').toUpperCase();
 if(cur==='EUR')return{eur:p,usd:fx?p*fx:null};
 return{usd:p,eur:fx?p/fx:null};
}
function trIsin(s){return String((s&&s.trIsin)||(s&&s.tradeRepublicVerified&&s&&s.isin)||'').trim()}
function trTradable(s){
 if(!s)return false;
 if(s.tradeRepublicTradable===true)return true;
 if(s.tradeRepublicTradable===false)return false;
 return !!(s.tradeRepublicVerified&&trIsin(s)&&String(s.trTicker||'').trim()&&s.trActive!==false);
}
function trLivePrice(s){return N(s&&s.trLivePrice)}
function trLivePre(s){return N(s&&s.trLivePre)}
function trLiveChange(s){
 let direct=N(s&&s.trLiveChangePct);
 if(direct!==null)return direct;
 let p=trLivePrice(s),pre=trLivePre(s);
 return p!==null&&pre>0?(p/pre-1)*100:null;
}
function trPriceValues(s,fallback){
 let live=trLivePrice(s),fx=eurUsd();
 if(live!==null)return{eur:live,usd:fx?live*fx:null,direct:true};
 // Never invent a Trade Republic/LSX price from another market. If the live
 // TR ticker has not arrived yet, show N/D until the exact LSX quote is received.
 return{eur:null,usd:null,direct:false};
}
function usLivePrice(s){return N(s&&s.usLivePrice)}
// BID/ASK shown in the live UI must come from the current Nasdaq quote.
// Do not fall back to the delayed screener snapshot because that can make
// the spread look current when it is not.
function usLiveBid(s){return N(s&&s.usLiveBid)}
function usLiveAsk(s){return N(s&&s.usLiveAsk)}
function usLiveChange(s){return N(s&&s.usLiveChangePct)}
function currentUsQuote(s,se=currentMarketSession(),now=Date.now()){
 const livePrice=usLivePrice(s),liveChange=usLiveChange(s),liveAt=quoteTimestampMs(s,false);
 if(livePrice!==null&&livePrice>0){
  const rawStatus=String(s&&s.usLiveMarketStatus||'').toLowerCase();
  let kind=rawStatus.includes('pre')?'premarket':rawStatus.includes('post')||rawStatus.includes('after')?'postmarket':rawStatus.includes('regular')||rawStatus.includes('open')?'regular':se;
  if(!['premarket','regular','postmarket'].includes(kind))kind=se==='previous'?'regular':se;
  return{
   price:livePrice,
   change:liveChange,
   kind,
   at:liveAt||N(s&&s.usLiveReceivedAt),
   source:String(s&&s.usLiveSource||'Nasdaq'),
   extended:kind==='premarket'||kind==='postmarket',
   realtime:s&&s.usLiveIsRealTime===true
  };
 }
 const regularPrice=N(s&&s.price),regularChange=N(s&&s.changePct),regularAt=parseMarketTimestamp(s&&s.priceTime||s&&s.updatedAt,'America/New_York');
 const explicit=kind=>{
  const price=N(s&&s[kind+'Price']);if(price===null||price<=0)return null;
  const at=sessionQuoteTimestamp(s&&s[kind+'Time'],now);
  let change=N(s&&s[kind+'ChangePct']);
  return{price,change,kind,at,source:kind==='premarket'?'EEUU · Premarket':'EEUU · Postmarket',extended:true,realtime:false};
 };
 if(se==='premarket'){
  const q=explicit('premarket');if(q)return q;
 }
 if(se==='postmarket'){
  const q=explicit('postmarket');if(q)return q;
 }
 if(se==='regular'&&regularPrice!==null)return{price:regularPrice,change:regularChange,kind:'regular',at:regularAt,source:'Snapshot EEUU',extended:false,realtime:false};
 if(se==='previous'){
  const candidates=[explicit('postmarket'),explicit('premarket')].filter(Boolean);
  const dated=candidates.filter(q=>q.at!==null);
  if(dated.length)return dated.sort((a,b)=>b.at-a.at)[0];
  if(candidates.length)return candidates[0];
 }
 if(regularPrice!==null)return{price:regularPrice,change:regularChange,kind:'regular',at:regularAt,source:'Snapshot EEUU',extended:false,realtime:false};
 return explicit('postmarket')||explicit('premarket')||{price:null,change:null,kind:null,at:null,source:'EEUU',extended:false,realtime:false};
}
function currentUsPrimaryHtml(s,se=currentMarketSession()){
 const q=currentUsQuote(s,se),price=N(q&&q.price),change=N(q&&q.change);
 const text=price===null?'—':quoteMoney(price,'\u0024',quotePrecision(s,false,price));
 const icon=q&&q.kind==='premarket'?'☀︎':q&&q.kind==='postmarket'?'☾︎':'';
 const iconClass=q&&q.kind==='premarket'?'session-icon-sun':q&&q.kind==='postmarket'?'session-icon-moon':'';
 return (icon?'<span class="session-icon '+iconClass+'" aria-hidden="true">'+icon+'</span>':'')+
  '<strong>'+E(text)+'</strong><b class="'+C(change)+'">'+PC(change)+'</b>';
}
function decimalPlaces(v,cap=6){
 v=N(v);if(v===null)return 0;
 let s=Math.abs(v).toFixed(cap).replace(/0+$/,'').replace(/\.$/,'');
 let p=s.indexOf('.');
 return p<0?0:s.length-p-1;
}
function quotePrecision(s,preferTr=false,fallback=null){
 let vals=preferTr
  ?[trLivePrice(s),N(s&&s.trLiveBid),N(s&&s.trLiveAsk),N(fallback)]
  :[usLivePrice(s),usLiveBid(s),usLiveAsk(s),N(fallback)];
 vals=vals.map(N).filter(v=>v!==null);
 if(!vals.length)return 2;
 let cap=vals.some(v=>Math.abs(v)<1)?6:4;
 return Math.min(cap,Math.max(2,...vals.map(v=>decimalPlaces(v,cap))));
}
function quoteMoney(v,symbol,decimals){
 v=N(v);if(v===null)return symbol+'—';
 decimals=Math.max(0,Math.min(6,Number(decimals)||0));
 return symbol+v.toLocaleString('es-ES',{minimumFractionDigits:decimals,maximumFractionDigits:decimals});
}
function quoteDirClass(dir){return dir==='up'?'quote-up':dir==='down'?'quote-down':''}
function setQuoteDirection(el,dir){
 if(!el)return;
 el.classList.remove('quote-up','quote-down');
 let cls=quoteDirClass(dir);if(cls)el.classList.add(cls);
}
function usPriceValues(s,fallback){
 let q=currentUsQuote(s,currentMarketSession()),usd=N(q&&q.price)??N(fallback),fx=eurUsd();
 return{usd,eur:usd!==null&&fx?usd/fx:null,direct:N(q&&q.price)!==null,kind:q&&q.kind||null,change:N(q&&q.change)};
}
function canonicalQuote(s,preferTr=false){
 let fx=eurUsd();
 if(preferTr&&trTradable(s)){
  let eur=trLivePrice(s);
  return{
   market:'tr',
   source:'Trade Republic / '+String(s&&s.trExchange||'LSX'),
   nativeCurrency:'EUR',
   price:eur,
   eur,
   usd:eur!==null&&fx?eur*fx:null,
   change:trLiveChange(s),
   updatedAt:quoteTimestampMs(s,true),
   fx,
   fxUpdatedAt:fxLive.updatedAt||parseMarketTimestamp(db.meta&&db.meta.updatedAt,'Europe/Madrid')||null,
   live:eur!==null
  };
 }
 let current=currentUsQuote(s,currentMarketSession()),usd=N(current&&current.price);
 return{
  market:'us',
  source:String(current&&current.source||'EEUU'),
  nativeCurrency:'USD',
  price:usd,
  usd,
  eur:usd!==null&&fx?usd/fx:null,
  change:N(current&&current.change),
  updatedAt:current&&current.at||quoteTimestampMs(s,false),
  session:current&&current.kind||null,
  fx,
  fxUpdatedAt:fxLive.updatedAt||parseMarketTimestamp(db.meta&&db.meta.updatedAt,'Europe/Madrid')||null,
  live:usd!==null
 };
}

/*
 * Quote used by compact lists.
 * If a verified LSX last price has not arrived yet, never fabricate an EUR/LSX
 * quote. Fall back to the verified US quote/snapshot and label it explicitly.
 * This keeps price and percentage on the same source while avoiding fake data.
 */
function verifiedDisplayQuote(s,preferTr=false,se=SES()){
 let exact=canonicalQuote(s,preferTr);
 if(N(exact&&exact.price)!==null){
  return Object.assign({},exact,{fallback:false,requestedMarket:preferTr?'tr':'us'});
 }
 if(preferTr){
  let us=canonicalQuote(s,false),price=N(us&&us.price);
  if(price===null)price=SP(s,se);
  if(price!==null){
   let fx=eurUsd(),change=N(us&&us.change);
   if(change===null)change=marketChange(s,se,false);
   return Object.assign({},us,{
    market:'us',
    requestedMarket:'tr',
    nativeCurrency:'USD',
    price,
    usd:price,
    eur:price!==null&&fx?price/fx:null,
    change,
    fallback:true,
    source:(us&&us.source?us.source:'Snapshot EEUU')+' · referencia; LSX sin cotización'
   });
  }
 }
 let price=N(exact&&exact.price);
 if(price===null)price=SP(s,se);
 if(price!==null){
  let fx=eurUsd(),change=N(exact&&exact.change);
  if(change===null)change=marketChange(s,se,false);
  return Object.assign({},exact,{
   price,usd:price,eur:price!==null&&fx?price/fx:null,change,
   fallback:!(exact&&exact.live),requestedMarket:'us'
  });
 }
 return Object.assign({},exact,{fallback:false,requestedMarket:preferTr?'tr':'us'});
}

const quoteClockFormat=new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
const quoteZoneParts=new Map();
function zonedWallTimeToEpoch(y,mo,d,h,mi,se,tz='America/New_York'){
 let guess=Date.UTC(y,mo-1,d,h,mi,se||0),fmt=quoteZoneParts.get(tz);
 if(!fmt){
  fmt=new Intl.DateTimeFormat('en-US',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,hourCycle:'h23'});
  quoteZoneParts.set(tz,fmt);
 }
 const wanted=Date.UTC(y,mo-1,d,h,mi,se||0);
 for(let i=0;i<2;i++){
  let p=Object.fromEntries(fmt.formatToParts(new Date(guess)).map(x=>[x.type,x.value]));
  let got=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
  guess+=wanted-got;
 }
 return guess;
}
function parseMarketTimestamp(value,tz='America/New_York'){
 if(value===null||value===undefined||value==='')return null;
 if(typeof value==='number'){
  let n=value>0&&value<1e12?value*1000:value;
  return Number.isFinite(n)?n:null;
 }
 let raw=String(value).trim();
 if(/^\d+$/.test(raw)){
  let n=Number(raw);if(Number.isFinite(n))return n>0&&n<1e12?n*1000:n;
 }
 if(/(?:Z|[+-]\d{2}:?\d{2}|\bUTC\b|\bGMT\b)/i.test(raw)){
  let direct=Date.parse(raw);if(Number.isFinite(direct))return direct;
 }
 let m=raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})[^\d]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
 if(m){
  let h=+m[4];if(m[7]){if(h===12)h=0;if(m[7].toUpperCase()==='PM')h+=12}
  return zonedWallTimeToEpoch(+m[3],+m[1],+m[2],h,+m[5],+(m[6]||0),tz);
 }
 const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
 m=raw.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})[^\d]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
 if(m){
  let h=+m[4];if(m[7]){if(h===12)h=0;if(m[7].toUpperCase()==='PM')h+=12}
  return zonedWallTimeToEpoch(+m[3],months[m[1].slice(0,3).toLowerCase()],+m[2],h,+m[5],+(m[6]||0),tz);
 }
 let direct=Date.parse(raw);
 return Number.isFinite(direct)?direct:null;
}
function quoteTimestampMs(s,preferTr=false){
 if(preferTr&&trTradable(s)){
  return parseMarketTimestamp(s&&s.trLiveLastAt,'Europe/Berlin')||
   parseMarketTimestamp(s&&s.trLiveUpdatedAt,'Europe/Berlin')||
   parseMarketTimestamp(s&&s.trLiveReceivedAt,'Europe/Berlin')||null;
 }
 return parseMarketTimestamp(s&&s.usLiveTimestamp,'America/New_York')||
  parseMarketTimestamp(s&&s.usLiveReceivedAt,'Europe/Madrid')||
  parseMarketTimestamp(db.meta&&db.meta.updatedAt,'Europe/Madrid')||null;
}
function quoteUpdatedLabel(s,preferTr=false){
 let ms=quoteTimestampMs(s,preferTr);
 if(!ms)return 'ES --:--:--';
 let d=new Date(ms),today=new Date();
 let dateFmt=new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',day:'2-digit',month:'2-digit'});
 let sameDay=dateFmt.format(d)===dateFmt.format(today);
 return 'ES '+(sameDay?'':dateFmt.format(d)+' · ')+quoteClockFormat.format(d);
}
function quoteAgeText(ms){
 ms=N(ms);
 if(ms===null)return 'sin hora';
 let age=Math.max(0,Date.now()-ms);
 if(age<5000)return 'ahora';
 if(age<60000)return 'hace '+Math.max(1,Math.floor(age/1000))+' s';
 if(age<3600000)return 'hace '+Math.max(1,Math.floor(age/60000))+' min';
 if(age<86400000)return 'hace '+Math.max(1,Math.floor(age/3600000))+' h';
 return 'hace '+Math.max(1,Math.floor(age/86400000))+' d';
}
function declaredQuoteDelayMinutes(s){
 if(!s)return null;
 for(let key of ['delayMinutes','quoteDelayMinutes','usDelayMinutes','marketDelayMinutes']){
  let v=N(s[key]);if(v!==null&&v>0&&v<1440)return Math.round(v);
 }
 let raw=String(s.updateMode||s.usUpdateMode||s.quoteMode||'');
 let m=raw.match(/(\d{1,3})\s*(?:min|minute)/i);
 if(m){let v=Number(m[1]);if(Number.isFinite(v)&&v>0&&v<1440)return v}
 return null;
}
function quoteFreshnessInfo(s,preferTr=false){
 let ms=quoteTimestampMs(s,preferTr);
 let age=ms===null?null:Math.max(0,Date.now()-ms);
 let market=preferTr&&trTradable(s)?'tr':'us';
 let quote=canonicalQuote(s,market==='tr');
 let delay=market==='us'?declaredQuoteDelayMinutes(s):null;
 let direct=market==='tr'?trLivePrice(s)!==null:usLivePrice(s)!==null;
 let realTime=market==='tr'?direct:(direct&&s&&s.usLiveIsRealTime===true);
 let open=market==='tr'?trMarketOpen():auto()!=='previous';
 let source=quote&&quote.source||'';
 let state='stale',label='Sin actualizar';
 if(!ms){
  state='stale';label='Sin actualizar';
 }else if(!open){
  state=age!==null&&age>30*60*60*1000?'stale':'delayed';
  label=state==='stale'?'Sesión anterior':'Mercado cerrado';
 }else if(delay!==null){
  state='delayed';label='Con retraso';
 }else if(!realTime){
  state='delayed';label='Diferido';
 }else if(age!==null&&age<=120000){
  state='live';label='En directo';
 }else if(age!==null&&age<=15*60*1000){
  state='delayed';label='Con retraso';
 }else{
  state='stale';label='Sin actualizar';
 }
 let exact=ms?new Date(ms).toLocaleString('es-ES',{timeZone:'Europe/Madrid'}):'sin hora disponible';
 let title=(source?source+' · ':'')+exact+(delay!==null?' · retraso declarado '+delay+' min':'');
 return{state,label,title,updatedAt:ms,ageMs:age,delayMinutes:delay,source,live:state==='live'};
}
function quoteFreshnessHtml(s,preferTr=false,extraClass=''){
 if(!s)return '';
 let info=quoteFreshnessInfo(s,preferTr),key=stockKey(s);
 return '<span class="quote-freshness '+E(info.state)+(extraClass?' '+E(extraClass):'')+'" data-quote-freshness-key="'+E(key)+'" data-quote-freshness-tr="'+(preferTr?'1':'0')+'" title="'+E(info.title)+'"><i aria-hidden="true"></i><span>'+E(info.label)+'</span></span>';
}
function refreshQuoteFreshnessDom(root=document){
 if(!root||!root.querySelectorAll)return;
 root.querySelectorAll('[data-quote-freshness-key]').forEach(el=>{
  let s=stockByKey(el.dataset.quoteFreshnessKey);if(!s)return;
  let preferTr=el.dataset.quoteFreshnessTr==='1',info=quoteFreshnessInfo(s,preferTr);
  el.classList.remove('live','delayed','closed','stale','unknown');
  el.classList.add(info.state);
  let text=el.querySelector('span');if(text)text.textContent=info.label;else el.textContent=info.label;
  el.title=info.title;
 });
}
function pricePairInner(s,p,preferTr=false){
 let d='\u0024',dec=quotePrecision(s,preferTr,p),updated='<small class="quote-updated">'+quoteUpdatedLabel(s,preferTr)+'</small>';
 if(preferTr&&trTradable(s)){
  let x=trPriceValues(s,p);
  return '<strong>'+quoteMoney(x.eur,'€',dec)+'</strong><small>/ '+quoteMoney(x.usd,d,dec)+'</small>'+updated;
 }
 let x=usPriceValues(s,p);
 return '<strong>'+quoteMoney(x.usd,d,dec)+'</strong><small>'+quoteMoney(x.eur,'€',dec)+'</small>'+updated;
}
function pricePair(s,p,preferTr=false){
 let liveAttrs=preferTr&&trTradable(s)?' data-tr-live-key="'+E(stockKey(s))+'"':' data-us-live-key="'+E(stockKey(s))+'"';
 let direct=preferTr?(trLivePrice(s)!==null):(usLivePrice(s)!==null);
 let dir=preferTr?s&&s.trLiveDirection:s&&s.usLiveDirection,dirCls=quoteDirClass(dir);
 let source=preferTr
  ?(direct?'Cotización LSX recibida directamente del ticker de Trade Republic. El precio en $ es solo una conversión EUR/USD de referencia.':'Esperando la cotización exacta LSX de Trade Republic; no se sustituye por precios de otros mercados.')
  :(direct?'Cotización actual recibida desde Nasdaq.com; el valor en € es una conversión EUR/USD de referencia.':'Esperando cotización Nasdaq actual; se muestra temporalmente el último snapshot disponible.');
 return '<span class="price-pair'+(direct?' live-quote':'')+(dirCls?' '+dirCls:'')+'"'+liveAttrs+' title="'+E(source)+'">'+pricePairInner(s,p,preferTr)+'</span>';
}
function snapshotPricePair(s,p,preferTr=false){
 let x=priceCurrencies(s,p),d='\u0024';
 let primary=preferTr?money(x.eur,'€'):money(x.usd,d);
 let secondary=preferTr?money(x.usd,d):money(x.eur,'€');
 return '<span class="price-pair snapshot-price"><strong>'+primary+'</strong><small>/ '+secondary+'</small></span>';
}
function bidAskInner(s,preferTr=false){
 let bid=preferTr?N(s&&s.trLiveBid):usLiveBid(s),ask=preferTr?N(s&&s.trLiveAsk):usLiveAsk(s),sym=preferTr?'€':'\u0024';
 let dec=quotePrecision(s,preferTr);
 let bidDir=preferTr?s&&s.trLiveBidDirection:s&&s.usLiveBidDirection;
 let askDir=preferTr?s&&s.trLiveAskDirection:s&&s.usLiveAskDirection;
 let bc=quoteDirClass(bidDir),ac=quoteDirClass(askDir);
 return '<span class="quote-side bid'+(bc?' '+bc:'')+'"><small>BID</small><strong>'+quoteMoney(bid,sym,dec)+'</strong></span><span class="quote-side ask'+(ac?' '+ac:'')+'"><small>ASK</small><strong>'+quoteMoney(ask,sym,dec)+'</strong></span>';
}
function bidAskHtml(s,preferTr=false){
 if(!s)return '';
 if(preferTr&&trTradable(s)){
  return '<span class="quote-spread quote-spread-tr" data-tr-spread-key="'+E(stockKey(s))+'" title="BID = mejor precio comprador · ASK = mejor precio vendedor · ambos son distintos del último precio negociado">'+bidAskInner(s,true)+'</span>';
 }
 return '<span class="quote-spread quote-spread-us '+(s.usLiveIsRealTime?'realtime':'delayed')+'" data-us-spread-key="'+E(stockKey(s))+'" title="'+(s.usLiveIsRealTime?'Bid y Ask actuales recibidos desde Nasdaq.com':'Bid/Ask no marcado como tiempo real por Nasdaq; no se reutiliza el snapshot diferido')+'">'+bidAskInner(s,false)+'</span>';
}

function trPriceCell(s,which,se){
 let x=trPriceValues(s,SP(s,se)),value=which==='eur'?x.eur:x.usd,sym=which==='eur'?'€':'\u0024',dec=quotePrecision(s,true,SP(s,se));
 let cls=quoteDirClass(s&&s.trLiveDirection);
 return '<span class="table-price-wrap"><span class="table-price-cell'+(cls?' '+cls:'')+'" data-tr-price-'+which+'-key="'+E(stockKey(s))+'">'+quoteMoney(value,sym,dec)+'</span><small class="quote-updated table-quote-updated">'+quoteUpdatedLabel(s,true)+'</small></span>';
}
function usPriceCell(s,which,se){
 let x=usPriceValues(s,SP(s,se)),value=which==='usd'?x.usd:x.eur,sym=which==='usd'?'\u0024':'€',dec=quotePrecision(s,false,SP(s,se));
 let cls=quoteDirClass(s&&s.usLiveDirection);
 return '<span class="table-price-wrap"><span class="table-price-cell'+(cls?' '+cls:'')+'" data-us-price-'+which+'-key="'+E(stockKey(s))+'">'+quoteMoney(value,sym,dec)+'</span><small class="quote-updated table-quote-updated">'+quoteUpdatedLabel(s,false)+'</small></span>';
}
function liveChangeHtml(s,fallback,preferTr=false){
 let trExact=preferTr&&trTradable(s),value=trExact?trLiveChange(s):(usLiveChange(s)??N(fallback));
 let attrs=trExact?' data-tr-live-change-key="'+E(stockKey(s))+'"':' data-us-live-change-key="'+E(stockKey(s))+'"';
 return '<span class="quote-change '+C(value)+'"'+attrs+'>'+PC(value)+'</span>';
}

function PC(v){v=N(v);return v===null?'—':(v>=0?'+':'')+F(v,2)+'%'}
function C(v){v=N(v);return v===null?'':v>=0?'positive':'negative'}
function DF(v){if(v===null||v===undefined||v==='')return'—';let raw=v;if(typeof raw==='string'&&/^\d+$/.test(raw))raw=Number(raw);if(typeof raw==='number'&&raw>0&&raw<1e12)raw*=1000;let d=new Date(raw);return isNaN(d)?'—':d.toLocaleDateString('es-ES')}
const MARKET_SESSION=window.ViewInvAIMarketSession;
function zoneClock(timeZone){return MARKET_SESSION.zoneClock(timeZone)}
function NY(){return zoneClock('America/New_York')}
function BER(){return zoneClock('Europe/Berlin')}
function usMarketCalendar(p){return MARKET_SESSION.usMarketCalendar(p)}
function auto(){return MARKET_SESSION.usSession(NY())}
function lsxMarketCalendar(p){return MARKET_SESSION.lsxMarketCalendar(p)}
function trMarketOpen(){return MARKET_SESSION.lsxOpen(BER())}
function SES(){return state.session==='auto'?auto():state.session}
function SN(s){return({premarket:'Premarket',regular:'Sesión regular',postmarket:'Postmarket',previous:'Sesión anterior'})[s]||s}
function SP(s,se=SES()){return se==='premarket'?(N(s.premarketPrice)??N(s.price)):se==='postmarket'?(N(s.postmarketPrice)??N(s.price)):N(s.price)}
function SC(s,se=SES()){return se==='premarket'?N(s.premarketChangePct):se==='postmarket'?N(s.postmarketChangePct):N(s.changePct)}
function SV(s,se=SES()){return se==='premarket'?N(s.premarketVolume):se==='postmarket'?N(s.postmarketVolume):(N(s.usLiveVolume)??N(s.volume))}
function FC(s,se=SES()){
 // The entry screener and the percentage rendered in each row must use the same metric.
 // For the regular US session prefer the current quote; pre/post use their explicit snapshots.
 return se==='regular'?(usLiveChange(s)??SC(s,se)):SC(s,se);
}
function marketChange(s,se=SES(),preferTr=false){
 // Venue invariant: selecting LSX never substitutes a US pre/post move.
 if(preferTr&&trTradable(s))return trLiveChange(s);
 return FC(s,se);
}
function RV(s,se=SES()){
 // In regular trading prefer TradingView's own relative-volume field so the preset
 // keeps the same semantics as the screener that produced the universe.
 if(se==='regular'){
  let provider=N(s.relVolume);if(provider!==null)return provider;
  let v=SV(s,se),avg=N(s.avgVolume);
  return v!==null&&avg>0?v/avg:null;
 }
 // Extended hours do not expose the same provider metric; use session volume / daily average.
 let v=SV(s,se),avg=N(s.avgVolume);
 return v!==null&&avg>0?v/avg:null;
}
function trendState(s){
 let p=N(s.price),a=N(s.ema20),b=N(s.ema50);
 if(p===null||a===null||b===null)return null;
 return p>=a&&a>=b;
}
function trend(s){return trendState(s)===true}
function validQuoteNumber(v){v=N(v);return v!==null&&v>0?v:null}
function spreadPct(s,preferTr=false){
 let bid=validQuoteNumber(preferTr?s&&s.trLiveBid:usLiveBid(s)),ask=validQuoteNumber(preferTr?s&&s.trLiveAsk:usLiveAsk(s));
 if(bid===null||ask===null||ask<bid)return null;
 let mid=(bid+ask)/2;return mid>0?(ask-bid)/mid*100:null;
}
function lowLiquidity(s,se=SES(),preferTr=false){
 let v=SV(s,se),sp=spreadPct(s,preferTr);
 return (v!==null&&v<10000)||(sp!==null&&sp>8);
}
function trStockByKey(key){let s=stockByKey(key);return s&&trTradable(s)?s:null}
function trDecodeLiteral(s){
 try{return decodeURIComponent(String(s||'').replace(/\+/g,' '))}catch(_){return String(s||'')}
}
function trApplyDelta(prev,delta){
 prev=String(prev||'');let cursor=0,out='';
 for(let chunk of String(delta||'').split('\t')){
  if(!chunk)continue;
  let op=chunk[0],arg=chunk.slice(1);
  if(op==='+')out+=trDecodeLiteral(arg);
  else if(op==='='){
   let n=Number(arg);if(!Number.isFinite(n)||n<0)throw Error('Delta TR inválido');
   out+=prev.slice(cursor,cursor+n);cursor+=n;
  }else if(op==='-'){
   let n=Number(arg);if(!Number.isFinite(n)||n<0)throw Error('Delta TR inválido');
   cursor+=n;
  }else throw Error('Operación delta TR desconocida');
 }
 return out;
}
function trApplyTickerPayload(s,payload){
 if(!s||!payload)return;
 let last=N(payload.last&&payload.last.price);
 let bid=N(payload.bid&&payload.bid.price);
 let ask=N(payload.ask&&payload.ask.price);
 let pre=N(payload.pre&&payload.pre.price);
 let open=N(payload.open&&payload.open.price);
 let old=N(s.trLivePrice),oldBid=N(s.trLiveBid),oldAsk=N(s.trLiveAsk);

 // "last" is the Trade Republic/LSX last traded price. Bid and ask are
 // separate order-book quotes and must never be substituted for the last price.
 if(last!==null){
  if(old!==null&&last!==old){s.trLiveDirection=last>old?'up':'down';s.trLiveDirectionAt=Date.now()}
  s.trLivePrice=last;
  s.trLiveLastAt=N(payload.last&&payload.last.time)??Date.now();
 }
 if(bid!==null){
  if(oldBid!==null&&bid!==oldBid)s.trLiveBidDirection=bid>oldBid?'up':'down';
  s.trLiveBid=bid;s.trLiveBidAt=N(payload.bid&&payload.bid.time)??Date.now();
 }
 if(ask!==null){
  if(oldAsk!==null&&ask!==oldAsk)s.trLiveAskDirection=ask>oldAsk?'up':'down';
  s.trLiveAsk=ask;s.trLiveAskAt=N(payload.ask&&payload.ask.time)??Date.now();
 }
 if(pre!==null)s.trLivePre=pre;
 if(open!==null)s.trLiveOpen=open;
 if(N(s.trLivePrice)!==null&&N(s.trLivePre)>0)s.trLiveChangePct=(N(s.trLivePrice)/N(s.trLivePre)-1)*100;
 s.trLiveQuality=payload.qualityId||s.trLiveQuality||'';
 let times=[s.trLiveLastAt,s.trLiveBidAt,s.trLiveAskAt].map(N).filter(x=>x!==null);
 if(times.length)s.trLiveUpdatedAt=Math.max(...times);
 s.trLiveReceivedAt=Date.now();
 trLive.lastDataAt=s.trLiveReceivedAt;
 scheduleEntryAutoSort();
 window.dispatchEvent(new CustomEvent('viewinvai:quote-updated',{detail:{key:stockKey(s),market:'tr',updatedAt:s.trLiveUpdatedAt||s.trLiveReceivedAt}}));
}
function trSendSubscriptions(){
 if(!trLive.connected||!trLive.ws||trLive.ws.readyState!==WebSocket.OPEN)return;
 for(let key of trLive.wanted){
  if(trLive.subByKey.has(key))continue;
  let s=trStockByKey(key);if(!s)continue;
  let id=trIsin(s)+'.'+String(s.trExchange||'LSX'),sub=String(trLive.seq++);
  trLive.subByKey.set(key,sub);trLive.keyBySub.set(sub,key);
  trLive.ws.send('sub '+sub+' '+JSON.stringify({type:'ticker',id}));
 }
}
function trScheduleReconnect(){
 if(trLive.reconnectTimer)return;
 let wait=Math.min(30000,1000*Math.pow(2,Math.min(trLive.reconnectAttempt++,5)));
 trLive.reconnectTimer=setTimeout(()=>{trLive.reconnectTimer=null;connectTrLive()},wait);
}
function connectTrLive(){
 if(trLive.connected||trLive.connecting)return;
 if(typeof WebSocket==='undefined')return;
 trLive.connecting=true;
 let ws,url=trLive.usingDirect?TR_LIVE_DIRECT:trProxyUrl();
 try{ws=new WebSocket(url)}catch(_){trLive.connecting=false;trScheduleReconnect();return}
 trLive.ws=ws;
 ws.onopen=()=>{try{ws.send('connect 30')}catch(_){}};
 ws.onmessage=e=>{
  let msg=String(e.data||'');
  if(msg==='connected'||msg.startsWith('connected')){
   trLive.connected=true;trLive.connecting=false;trLive.reconnectAttempt=0;trLive.proxyFailures=0;trLive.subByKey.clear();trLive.keyBySub.clear();trLive.payloadBySub.clear();trSendSubscriptions();return;
  }
  let m=msg.match(/^(\d+)\s+([A-Z])(?:\s+([\s\S]+))?$/);
  if(!m)return;
  let sid=m[1],code=m[2],body=m[3]||'',key=trLive.keyBySub.get(sid);if(!key)return;
  if(code==='C'||code==='E'){
   trLive.payloadBySub.delete(sid);trLive.keyBySub.delete(sid);trLive.subByKey.delete(key);
   if(code==='C')setTimeout(trSendSubscriptions,250);
   return;
  }
  let full=body;
  try{
   if(code==='A')trLive.payloadBySub.set(sid,body);
   else if(code==='D'){
    full=trApplyDelta(trLive.payloadBySub.get(sid)||'',body);
    trLive.payloadBySub.set(sid,full);
   }else return;
   let payload=JSON.parse(full),s=trStockByKey(key);
   if(s)trApplyTickerPayload(s,payload);
  }catch(e){console.warn('TR live delta warning',e)}

 };
 ws.onerror=()=>{};
 ws.onclose=()=>{
  trLive.connected=false;trLive.connecting=false;trLive.ws=null;trLive.subByKey.clear();trLive.keyBySub.clear();trLive.payloadBySub.clear();
  if(!trLive.usingDirect&&++trLive.proxyFailures>=2)trLive.usingDirect=true;
  trScheduleReconnect();
 };
}
function dropTrLiveKey(key){
 key=String(key||'');if(!key)return;
 trLive.wanted.delete(key);
 let sub=trLive.subByKey.get(key);
 if(sub&&trLive.connected&&trLive.ws&&trLive.ws.readyState===WebSocket.OPEN){
  try{trLive.ws.send('unsub '+sub)}catch(_){}
 }
 if(sub){trLive.keyBySub.delete(sub);trLive.payloadBySub.delete(sub)}
 trLive.subByKey.delete(key);
}
function ensureTrLiveKey(key){
 let s=trStockByKey(key);if(!s)return;
 if(trLive.wanted.has(key)){
  trLive.wanted.delete(key);
  trLive.wanted.add(key);
 }else{
  while(trLive.wanted.size>=MAX_TR_LIVE_SUBSCRIPTIONS){
   let oldest=trLive.wanted.values().next().value;
   if(!oldest)break;
   dropTrLiveKey(oldest);
  }
  trLive.wanted.add(key);
 }
 connectTrLive();trSendSubscriptions();
}
function observeTrLivePrices(root=document){
 if(!('IntersectionObserver' in window)){
  root.querySelectorAll('[data-compact-quote-key][data-compact-quote-tr="1"],[data-tr-live-key],[data-tr-live-change-key],[data-tr-subscribe-key]').forEach(el=>ensureTrLiveKey(el.dataset.compactQuoteKey||el.dataset.trLiveKey||el.dataset.trLiveChangeKey||el.dataset.trSubscribeKey));
  return;
 }
 if(!trLive.observer)trLive.observer=new IntersectionObserver(entries=>{
  for(let entry of entries)if(entry.isIntersecting){
   let el=entry.target,key=el.dataset.compactQuoteKey||el.dataset.trLiveKey||el.dataset.trLiveChangeKey||el.dataset.trSubscribeKey;
   if(key)ensureTrLiveKey(key);
  }
 },{rootMargin:'300px 0px'});
 root.querySelectorAll('[data-compact-quote-key][data-compact-quote-tr="1"],[data-tr-live-key],[data-tr-live-change-key],[data-tr-subscribe-key]').forEach(el=>trLive.observer.observe(el));
}
function refreshTrLiveDom(){
 visibleLiveNodes('[data-tr-live-key]').forEach(el=>{
  let s=trStockByKey(el.dataset.trLiveKey);if(!s)return;
  let fallback=SP(s,currentMarketSession()),direct=trLivePrice(s)!==null;
  setHtmlIfChanged(el,pricePairInner(s,fallback,true));
  el.classList.toggle('live-quote',direct);
  el.title=direct?'Cotización LSX en tiempo real · Trade Republic'+(s.trLiveQuality?' · '+s.trLiveQuality:''):'Esperando cotización LSX en tiempo real';
  setQuoteDirection(el,s.trLiveDirection);
 });
 visibleLiveNodes('[data-tr-spread-key]').forEach(el=>{let s=trStockByKey(el.dataset.trSpreadKey);if(s)setHtmlIfChanged(el,bidAskInner(s,true))});
 visibleLiveNodes('[data-tr-bid-key]').forEach(el=>{let s=trStockByKey(el.dataset.trBidKey);if(!s)return;el.textContent=quoteMoney(s.trLiveBid,'€',quotePrecision(s,true));setQuoteDirection(el,s.trLiveBidDirection)});
 visibleLiveNodes('[data-tr-ask-key]').forEach(el=>{let s=trStockByKey(el.dataset.trAskKey);if(!s)return;el.textContent=quoteMoney(s.trLiveAsk,'€',quotePrecision(s,true));setQuoteDirection(el,s.trLiveAskDirection)});
 visibleLiveNodes('[data-tr-price-eur-key]').forEach(el=>{let s=trStockByKey(el.dataset.trPriceEurKey);if(!s)return;el.textContent=quoteMoney(trPriceValues(s,SP(s,currentMarketSession())).eur,'€',quotePrecision(s,true,SP(s,currentMarketSession())));setQuoteDirection(el,s.trLiveDirection);let t=el.parentElement&&el.parentElement.querySelector('.table-quote-updated');if(t)t.textContent=quoteUpdatedLabel(s,true)});
 visibleLiveNodes('[data-tr-price-usd-key]').forEach(el=>{let s=trStockByKey(el.dataset.trPriceUsdKey);if(!s)return;el.textContent=quoteMoney(trPriceValues(s,SP(s,currentMarketSession())).usd,'\u0024',quotePrecision(s,true,SP(s,currentMarketSession())));setQuoteDirection(el,s.trLiveDirection);let t=el.parentElement&&el.parentElement.querySelector('.table-quote-updated');if(t)t.textContent=quoteUpdatedLabel(s,true)});
 visibleLiveNodes('[data-tr-live-bid-key]').forEach(el=>{let s=trStockByKey(el.dataset.trLiveBidKey);if(!s)return;el.textContent=quoteMoney(s.trLiveBid,'€',quotePrecision(s,true));setQuoteDirection(el,s.trLiveBidDirection)});
 visibleLiveNodes('[data-tr-live-ask-key]').forEach(el=>{let s=trStockByKey(el.dataset.trLiveAskKey);if(!s)return;el.textContent=quoteMoney(s.trLiveAsk,'€',quotePrecision(s,true));setQuoteDirection(el,s.trLiveAskDirection)});
 visibleLiveNodes('[data-tr-live-change-key]').forEach(el=>{
  let s=trStockByKey(el.dataset.trLiveChangeKey);if(!s)return;
  let v=trLiveChange(s);if(v===null)return;
  el.textContent=PC(v);el.classList.toggle('positive',v>=0);el.classList.toggle('negative',v<0);
 });
 refreshCompactQuoteCards();
 if(state.entryMarket==='tr'&&$('#entryUpdated'))$('#entryUpdated').textContent=trLive.lastDataAt?'LSX · último dato '+new Date(trLive.lastDataAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'LSX · esperando cotización';
}
function initTrLive(){
 connectTrLive();
 setInterval(()=>{if(!document.hidden)refreshTrLiveDom()},1800);
 setInterval(pruneTrLiveSubscriptions,15000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){connectTrLive();requestAnimationFrame(()=>observeActiveTrLivePrices());pruneTrLiveSubscriptions()}});
}

function activeLiveRoots(){
 if(document.body.classList.contains('stock-detail-open')){
  let q=$('#stockQuickDetail');return q?[q]:[];
 }
 let roots=[],view=document.querySelector('.view.active'),leaders=$('#marketLeaders');
 if(view)roots.push(view);
 if(leaders)roots.push(leaders);
 return roots;
}
function liveNodes(selector){
 let out=[],seen=new Set();
 for(let root of activeLiveRoots()){
  for(let el of root.querySelectorAll(selector)){
   if(seen.has(el))continue;seen.add(el);out.push(el);
  }
 }
 return out;
}
function visibleLiveNodes(selector,margin=500){
 let h=window.innerHeight||900;
 return liveNodes(selector).filter(el=>{
  let r=el.getBoundingClientRect();
  return r.bottom>=-margin&&r.top<=h+margin;
 });
}
function setHtmlIfChanged(el,html){if(el&&el.innerHTML!==html)el.innerHTML=html}
function observeActiveTrLivePrices(){
 for(let root of activeLiveRoots())observeTrLivePrices(root);
}
function pruneTrLiveSubscriptions(){
 if(document.hidden||!trLive.wanted.size)return;
 // Radar de entrada necesita mantener temporalmente el universo LSX aunque todavía no haya filas visibles.
 // Si se podan estas suscripciones antes de recibir precio, el filtro entra en un bloqueo circular.
 if(state.currentView==='entry'&&state.entryMarket==='tr')return;
 const selector='[data-compact-quote-key][data-compact-quote-tr="1"],[data-tr-live-key],[data-tr-live-change-key],[data-tr-subscribe-key],[data-tr-spread-key],[data-tr-price-eur-key],[data-tr-price-usd-key]';
 let keep=new Set(),h=window.innerHeight||900;
 for(let root of activeLiveRoots())for(let el of root.querySelectorAll(selector)){
  let r=el.getBoundingClientRect();if(r.bottom<-700||r.top>h+700)continue;
  let key=el.dataset.compactQuoteKey||el.dataset.compactQuoteKey||el.dataset.trLiveKey||el.dataset.trLiveChangeKey||el.dataset.trSubscribeKey||el.dataset.trSpreadKey||el.dataset.trPriceEurKey||el.dataset.trPriceUsdKey;
  if(key)keep.add(key);
 }
 for(let key of [...trLive.wanted])if(!keep.has(key))dropTrLiveKey(key);
}
function usStockByKey(key){let s=stockByKey(key);return s&&market(s,'us')?s:null}
function usVisibleKeys(){
 let nodes=liveNodes('[data-compact-quote-key][data-compact-quote-tr="0"],[data-us-current-hero-key],[data-us-live-key],[data-us-spread-key],[data-us-live-change-key],[data-us-price-usd-key],[data-us-price-eur-key],[data-us-bid-key],[data-us-ask-key],[data-us-heat-key]');
 let h=window.innerHeight||900,seen=new Set(),out=[];
 for(let el of nodes){
  let r=el.getBoundingClientRect();
  if(r.bottom<-400||r.top>h+400)continue;
  let key=el.dataset.compactQuoteKey||el.dataset.usCurrentHeroKey||el.dataset.usLiveKey||el.dataset.usSpreadKey||el.dataset.usLiveChangeKey||el.dataset.usPriceUsdKey||el.dataset.usPriceEurKey||el.dataset.usBidKey||el.dataset.usAskKey||el.dataset.usHeatKey;
  if(!key||seen.has(key))continue;
  let s=usStockByKey(key);if(!s)continue;
  seen.add(key);out.push(s);
  if(out.length>=50)break;
 }
 return out;
}
function usApplyQuote(s,q){
 if(!s||!q||q.error)return;
 let old=N(s.usLivePrice),oldBid=N(s.usLiveBid),oldAsk=N(s.usLiveAsk),px=N(q.price),bid=N(q.bid),ask=N(q.ask);
 if(px!==null){
  if(old!==null&&px!==old){s.usLiveDirection=px>old?'up':'down';s.usLiveDirectionAt=Date.now()}
  s.usLivePrice=px;
 }
 if(bid!==null){
  if(oldBid!==null&&bid!==oldBid)s.usLiveBidDirection=bid>oldBid?'up':'down';
  s.usLiveBid=bid;
 }else s.usLiveBid=null;
 if(ask!==null){
  if(oldAsk!==null&&ask!==oldAsk)s.usLiveAskDirection=ask>oldAsk?'up':'down';
  s.usLiveAsk=ask;
 }else s.usLiveAsk=null;
 if(N(q.bidSize)!==null)s.usLiveBidSize=N(q.bidSize);
 if(N(q.askSize)!==null)s.usLiveAskSize=N(q.askSize);
 if(N(q.volume)!==null)s.usLiveVolume=N(q.volume);
 if(N(q.changePct)!==null)s.usLiveChangePct=N(q.changePct);
 s.usLiveTimestamp=q.timestamp||'';
 s.usLiveMarketStatus=q.marketStatus||'';
 s.usLiveIsRealTime=q.isRealTime===true;
 s.usLiveSource=q.source||'Nasdaq';
 s.usLiveReceivedAt=Date.now();
 window.dispatchEvent(new CustomEvent('viewinvai:quote-updated',{detail:{key:stockKey(s),market:'us',updatedAt:quoteTimestampMs(s,false)||s.usLiveReceivedAt}}));
}
function refreshCompactQuoteCards(){
 visibleLiveNodes('[data-compact-quote-key]').forEach(el=>{
  const s=stockByKey(el.dataset.compactQuoteKey);
  if(!s||typeof compactInvestingQuoteHtml!=='function')return;
  const preferTr=el.dataset.compactQuoteTr==='1';
  const wrap=document.createElement('div');wrap.innerHTML=compactInvestingQuoteHtml(s,preferTr);
  const next=wrap.firstElementChild;
  if(next&&el.innerHTML!==next.innerHTML)el.innerHTML=next.innerHTML;
 });
}
function refreshUsLiveDom(){
 refreshCompactQuoteCards();
 visibleLiveNodes('[data-us-current-hero-key]').forEach(el=>{
  let s=usStockByKey(el.dataset.usCurrentHeroKey);if(!s)return;
  setHtmlIfChanged(el,currentUsPrimaryHtml(s,currentMarketSession()));
 });
 visibleLiveNodes('[data-us-live-key]').forEach(el=>{
  let s=usStockByKey(el.dataset.usLiveKey);if(!s)return;
  const q=currentUsQuote(s,currentMarketSession());
  setHtmlIfChanged(el,pricePairInner(s,N(q&&q.price),false));
  el.classList.toggle('live-quote',N(q&&q.price)!==null);
  el.title=q&&q.kind==='premarket'?'Cotización actual · premarket':q&&q.kind==='postmarket'?'Cotización actual · postmarket':s.usLiveIsRealTime?'Cotización Nasdaq actual':'Último dato Nasdaq disponible';
  setQuoteDirection(el,s.usLiveDirection);
 });
 visibleLiveNodes('[data-us-spread-key]').forEach(el=>{let s=usStockByKey(el.dataset.usSpreadKey);if(s){setHtmlIfChanged(el,bidAskInner(s,false));el.classList.toggle('realtime',!!s.usLiveIsRealTime);el.classList.toggle('delayed',!s.usLiveIsRealTime)}});
 visibleLiveNodes('[data-us-bid-key]').forEach(el=>{let s=usStockByKey(el.dataset.usBidKey);if(!s)return;el.textContent=quoteMoney(usLiveBid(s),'\u0024',quotePrecision(s,false));setQuoteDirection(el,s.usLiveBidDirection)});
 visibleLiveNodes('[data-us-ask-key]').forEach(el=>{let s=usStockByKey(el.dataset.usAskKey);if(!s)return;el.textContent=quoteMoney(usLiveAsk(s),'\u0024',quotePrecision(s,false));setQuoteDirection(el,s.usLiveAskDirection)});
 visibleLiveNodes('[data-us-price-usd-key]').forEach(el=>{let s=usStockByKey(el.dataset.usPriceUsdKey);if(!s)return;el.textContent=quoteMoney(usPriceValues(s,SP(s,currentMarketSession())).usd,'\u0024',quotePrecision(s,false,SP(s,currentMarketSession())));setQuoteDirection(el,s.usLiveDirection);let t=el.parentElement&&el.parentElement.querySelector('.table-quote-updated');if(t)t.textContent=quoteUpdatedLabel(s,false)});
 visibleLiveNodes('[data-us-price-eur-key]').forEach(el=>{let s=usStockByKey(el.dataset.usPriceEurKey);if(!s)return;el.textContent=quoteMoney(usPriceValues(s,SP(s,currentMarketSession())).eur,'€',quotePrecision(s,false,SP(s,currentMarketSession())));setQuoteDirection(el,s.usLiveDirection);let t=el.parentElement&&el.parentElement.querySelector('.table-quote-updated');if(t)t.textContent=quoteUpdatedLabel(s,false)});
 visibleLiveNodes('[data-us-live-change-key]').forEach(el=>{let s=usStockByKey(el.dataset.usLiveChangeKey);if(!s)return;let v=usLiveChange(s);if(v===null)return;el.textContent=PC(v);el.classList.toggle('positive',v>=0);el.classList.toggle('negative',v<0)});
 if(state.entryMarket!=='tr'&&$('#entryUpdated')&&usLive.lastFetchAt){
  $('#entryUpdated').textContent='NASDAQ LIVE · '+new Date(usLive.lastFetchAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
 }
}
let liveViewRefreshTimer=null,liveViewLastRecommendationAt=0;
function scheduleLiveViewRefresh(delay=180){
 if(liveViewRefreshTimer||document.hidden||document.body.classList.contains('stock-detail-open'))return;
 if(!['home','heatmap','recommendation'].includes(state.currentView))return;
 if(state.currentView==='recommendation'&&Date.now()-liveViewLastRecommendationAt<8000)return;
 liveViewRefreshTimer=setTimeout(()=>{
  liveViewRefreshTimer=null;
  if(state.currentView==='home')renderHome();
  else if(state.currentView==='heatmap')renderHeatmap();
  else if(state.currentView==='recommendation'){
   liveViewLastRecommendationAt=Date.now();
   renderRecommendation();
  }
 },Math.max(state.currentView==='recommendation'?900:100,delay));
}
async function pollUsLive(){
 if(usLive.busy||document.hidden)return;
 let minGap=document.body.classList.contains('stock-detail-open')?2500:5000;
 if(usLive.lastFetchAt&&Date.now()-usLive.lastFetchAt<minGap)return;
 let stocks=usVisibleKeys();if(!stocks.length)return;
 usLive.busy=true;
 try{
  let by=new Map(stocks.map(s=>[String(s.ticker||'').toUpperCase(),s]));
  let batches=[];
  for(let i=0;i<stocks.length;i+=25)batches.push(stocks.slice(i,i+25));
  let settled=await Promise.allSettled(batches.map(async batch=>{
   let symbols=batch.map(s=>s.ticker).filter(Boolean).join(',');
   let r=await fetch('/api/us-live?symbols='+encodeURIComponent(symbols),{cache:'no-store'});
   if(!r.ok)throw Error(r.status);
   return r.json();
  }));
  let received=false;
  for(let result of settled){
   if(result.status!=='fulfilled')continue;
   for(let q of (result.value&&result.value.quotes||[])){
    let s=by.get(String(q.symbol||'').toUpperCase());
    if(s){usApplyQuote(s,q);received=true}
   }
  }
  if(received)usLive.lastFetchAt=Date.now();
  scheduleEntryAutoSort(0);
  refreshUsLiveDom();
  scheduleLiveViewRefresh(120);
 }catch(e){console.warn('US live quote warning',e)}
 finally{usLive.busy=false}
}
async function pollFxLive(){
 if(fxLive.busy||document.hidden)return;
 fxLive.busy=true;
 try{
  let r=await fetch('/api/fx-live',{cache:'no-store'});
  if(!r.ok)throw Error(r.status);
  let data=await r.json(),rate=N(data&&data.rate);
  if(rate&&rate>0){
   let changed=N(fxLive.rate)!==rate;
   fxLive.rate=rate;
   fxLive.updatedAt=parseMarketTimestamp(data.updatedAt,'Europe/Madrid')||Date.now();
   if(db.meta){db.meta.eurUsd=rate;db.meta.eurUsdSource=data.source||'TradingView FX live';}
   if(changed){
    refreshTrLiveDom();
    refreshUsLiveDom();
    window.dispatchEvent(new CustomEvent('viewinvai:fx-updated',{detail:{rate,updatedAt:fxLive.updatedAt}}));
   }
  }
 }catch(e){console.warn('FX live warning',e)}
 finally{fxLive.busy=false}
}
let entryAutoSortTimer=null;
function entryDomOrder(){
 return [...document.querySelectorAll('#entryResults .asset-card')].map(card=>{
  let row=card.querySelector('[data-stock-key]');
  return row&&row.dataset.stockKey||'';
 }).filter(Boolean).join('|');
}
function scheduleEntryAutoSort(delay=650){
 if(state.currentView!=='entry'||document.hidden||document.body.classList.contains('stock-detail-open'))return;
 if(entryAutoSortTimer)return;
 entryAutoSortTimer=setTimeout(()=>{
  entryAutoSortTimer=null;
  let [a]=entry(),next=a.slice(0,150).map(stockKey).join('|');
  if(next!==entryDomOrder())renderEntry();
 },Math.max(250,delay));
}
function initUsLive(){
 setInterval(refreshUsLiveDom,1800);
 setInterval(()=>refreshQuoteFreshnessDom(document),3000);
 setInterval(pollUsLive,5000);
 setTimeout(pollUsLive,700);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){pollUsLive();scheduleEntryAutoSort(0)}});
}

function currentMarketSession(){
 return auto();
}
function sessionStageLabel(se){
 return se==='premarket'?'PREMARKET':se==='postmarket'?'POSTMARKET':se==='previous'?'ÚLTIMA SESIÓN':'REGULAR';
}
