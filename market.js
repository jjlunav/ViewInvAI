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

let trLive={ws:null,connected:false,connecting:false,seq:1,subByKey:new Map(),keyBySub:new Map(),payloadBySub:new Map(),wanted:new Set(),pinned:new Map(),reconnectTimer:null,reconnectAttempt:0,observer:null,usingDirect:false,proxyFailures:0,lastDataAt:0};
const TR_CLOSE_CACHE_KEY='viewinvai:trCloseQuotes:v1';
let trCloseQuotes=(()=>{
 try{
  const raw=JSON.parse(localStorage.getItem(TR_CLOSE_CACHE_KEY)||'{}');
  return raw&&typeof raw==='object'?raw:{};
 }catch(_){return{}}
})();
function saveTrCloseQuotes(){
 try{localStorage.setItem(TR_CLOSE_CACHE_KEY,JSON.stringify(trCloseQuotes))}catch(_){}
}
function trClosedQuote(s){
 if(!s)return null;
 const row=trCloseQuotes[stockKey(s)];
 if(!row||N(row.price)===null)return null;
 // Con LSX abierta, el último precio de LSX guardado sirve de provisional mientras llega el
 // feed en vivo (p. ej. al volver a la app); la ficha lo marca como retrasado o de la jornada
 // anterior según su hora. Nunca se usa un precio de EE. UU. convertido.
 return row;
}
function rememberTrCloseQuote(s){
 const price=N(s&&s.trLivePrice);if(!s||price===null)return;
 trCloseQuotes[stockKey(s)]={
  price,
  pre:N(s.trLivePre),
  change:N(s.trLiveChangePct),
  updatedAt:N(s.trLiveUpdatedAt)||N(s.trLiveLastAt)||Date.now()
 };
 const keys=Object.keys(trCloseQuotes);
 if(keys.length>3500){
  keys.sort((a,b)=>(N(trCloseQuotes[b]&&trCloseQuotes[b].updatedAt)||0)-(N(trCloseQuotes[a]&&trCloseQuotes[a].updatedAt)||0));
  trCloseQuotes=Object.fromEntries(keys.slice(0,3000).map(k=>[k,trCloseQuotes[k]]));
 }
 saveTrCloseQuotes();
}
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
// Acciones del universo de Trade Republic que no cotizan en EE. UU. (Xetra, París, Madrid, Londres…):
// su precio es el de TR en euros.
function intlListing(s){return !!s&&s.region==='intl'}
function trTradable(s){
 if(!s)return false;
 // Sin ticker de LS Exchange no hay cotización en Trade Republic (LUS1, SWC, ALNRG… no responden en LSX):
 // no se ofrecen como «de Trade Republic» con el precio vacío.
 if(intlListing(s))return !!(trIsin(s)&&String(s.trTicker||'').trim()&&s.trActive!==false);
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
 if(p!==null&&pre>0)return(p/pre-1)*100;
 const closed=trClosedQuote(s);
 if(closed){
  const cached=N(closed.change),cp=N(closed.price),cpre=N(closed.pre);
  return cached!==null?cached:(cp!==null&&cpre>0?(cp/cpre-1)*100:null);
 }
 return null;
}
function trPriceValues(s,fallback){
 let live=trLivePrice(s),fx=eurUsd();
 if(live!==null)return{eur:live,usd:fx?live*fx:null,direct:true,closed:false};
 const closed=trClosedQuote(s),price=N(closed&&closed.price);
 if(price!==null)return{eur:price,usd:fx?price*fx:null,direct:false,closed:true};
 // Never invent a Trade Republic/LSX price from another market.
 return{eur:null,usd:null,direct:false,closed:false};
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
  // Nasdaq pasa a «Pre-Market» a las 4:00 de Nueva York, pero hasta la primera operación de la preapertura su
  // precio sigue siendo la última del posmercado de ayer: por la hora del dato se ve que es del posmercado.
  const tradeAt=parseMarketTimestamp(s&&s.usLiveTimestamp,'America/New_York');
  if(kind==='premarket'&&tradeAt&&typeof usQuoteFromToday==='function'&&!usQuoteFromToday(tradeAt,now))kind='postmarket';
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
  // During a live pre/post session only that day's quote counts; yesterday's must not pose as current.
  if(kind===se&&!usQuoteFromToday(at,now))return null;
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
const usSessionBaselineCache=new Map();
const US_DAY_FORMATTER=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const usDayMemo={minute:-1,day:''};
function usSessionCacheKey(s,kind,at=Date.now()){
 const minute=Math.floor(at/60000);
 if(usDayMemo.minute!==minute){usDayMemo.minute=minute;usDayMemo.day=US_DAY_FORMATTER.format(new Date(at))}
 return stockKey(s)+'|'+kind+'|'+usDayMemo.day;
}
function usRememberSessionBaseline(s,kind,price,at=Date.now()){
 price=N(price);if(!s||price===null||price<=0||!['premarket','regular','postmarket'].includes(kind))return null;
 const key=usSessionCacheKey(s,kind,at);
 if(!usSessionBaselineCache.has(key))usSessionBaselineCache.set(key,price);
 return N(usSessionBaselineCache.get(key));
}
function usSessionDisplayData(s,se=currentMarketSession()){
 const q=currentUsQuote(s,se),kind=q&&q.kind;
 const current=N(q&&q.price);
 const liveRegular=kind==='regular'&&current!==null?current:null;
 const regularPrice=liveRegular??N(s&&s.usRegularFrozenPrice)??N(s&&s.price);
 // Variación del día = frente al cierre anterior, la cifra oficial de la cotización (Nasdaq en
 // vivo; fuera de sesión, la del cierre regular). No se usa la apertura ni el «PreviousClose» del
 // resumen de Nasdaq tras el cierre, que a veces ya es el de hoy y dejaba la cabecera en +0 %.
 const officialPct=liveRegular!==null?(N(s&&s.usLiveChangePct)??N(s&&s.changePct)):N(s&&s.changePct);
 let regularBase=regularPrice!==null&&officialPct!==null&&officialPct>-99.999?regularPrice/(1+officialPct/100):null;
 if(regularBase===null)regularBase=N(s&&s.previousClose)??N(s&&s.usLivePreviousClose)??N(s&&s.usLiveOpen);
 if(regularBase===null&&kind==='regular'&&liveRegular!==null)regularBase=usRememberSessionBaseline(s,'regular',liveRegular,N(q&&q.at)||Date.now());
 const regularAbs=regularPrice!==null&&regularBase!==null?regularPrice-regularBase:null;
 const regularPct=regularPrice!==null&&regularBase!==null&&regularBase>0?(regularPrice/regularBase-1)*100:N(s&&s.changePct);

 let extended=null;
 // En la preapertura sin operaciones todavía, lo último es el posmercado de ayer: se enseña como tal.
 if(((se==='premarket'||se==='postmarket')&&kind===se||se==='premarket'&&kind==='postmarket')&&current!==null){
  // Base de la preapertura y del posmercado: el último cierre regular, el mismo precio que enseña la cabecera.
  // Nasdaq, en las primeras horas de la preapertura (desde las 4:00 de Nueva York), aún calcula su porcentaje con
  // el cierre de la sesión anterior a la última: salía «+9,13 %» con el precio por debajo del cierre de ayer.
  let base=regularPrice!==null&&regularPrice>0?regularPrice:null;
  const explicitPct=N(q&&q.change)??N(s&&s[se+'ChangePct']);
  if(base===null&&explicitPct!==null&&explicitPct>-99.999){
   base=current/(1+explicitPct/100);
  }
  if(base===null||!Number.isFinite(base)||base<=0)base=usRememberSessionBaseline(s,se,current,N(q&&q.at)||Date.now());
  const abs=base!==null?current-base:null;
  const pct=base!==null&&base>0?(current/base-1)*100:null;
  extended={kind,label:kind==='premarket'?'Preapertura':se==='premarket'?'Después del cierre de ayer':'Posmercado',price:current,base,abs,pct,at:N(q&&q.at)||null};
 }
 return{regular:{price:regularPrice,base:regularBase,abs:regularAbs,pct:regularPct},extended};
}
function currentUsPrimaryHtml(s,se=currentMarketSession()){
 const data=usSessionDisplayData(s,se),r=data.regular,dec=quotePrecision(s,false,r.price);
 let html='<div class="profile-us-regular">'+quoteFreshnessDotHtml(s,false,'profile-price-freshness')+'<strong>'+E(r.price===null?'—':quoteMoney(r.price,'\u0024',dec))+'</strong>'+(se!=='regular'&&r.price!==null&&Math.abs(N(r.pct)||0)<1e-9?
  // Antes de la apertura la variación del día está a cero («+0 %»): se dice que es el cierre anterior.
  '<span class="flat">cierre anterior</span>':'<span class="'+C(r.pct)+'">'+E(compactSignedMoney(r.abs,'\u0024',dec))+' <b>('+PC(r.pct)+')</b></span>')+'</div>';
 if(data.extended){
  const x=data.extended,icon=x.kind==='premarket'?'☀︎':'☾︎',iconClass=x.kind==='premarket'?'session-icon-sun':'session-icon-moon',xdec=quotePrecision(s,false,x.price);
  html+='<div class="profile-us-extended '+C(x.pct)+'"><span class="session-icon '+iconClass+'" aria-hidden="true">'+icon+'</span><small>'+E(x.label)+'</small><strong>'+E(quoteMoney(x.price,'\u0024',xdec))+'</strong><span>'+E(compactSignedMoney(x.abs,'\u0024',xdec))+' <b>('+PC(x.pct)+')</b></span></div>';
 }
 return html;
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
 // En EE. UU. las acciones de 1 $ o más cotizan en céntimos: 2 decimales (como cualquier bróker). Los
 // decimales de más del BID/ASK o de la preapertura (1,3795) solo añadían ruido. Por debajo de 1 $, hasta 4.
 if(!preferTr)return vals.some(v=>Math.abs(v)<1)?Math.min(4,Math.max(2,...vals.map(v=>decimalPlaces(v,4)))):2;
 let cap=vals.some(v=>Math.abs(v)<1)?6:4;
 return Math.min(cap,Math.max(2,...vals.map(v=>decimalPlaces(v,cap))));
}
// Rango del día en EE. UU. con los mismos decimales en los dos extremos (antes «8,39 - 8,648»).
function usRangeText(lo,hi){const d=Math.min(lo,hi)<1?4:2,f=v=>N(v).toLocaleString('es-ES',{minimumFractionDigits:d,maximumFractionDigits:d});return f(lo)+' - '+f(hi)}
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
 if(intlListing(s))preferTr=true;
 if(preferTr&&trTradable(s)){
  const direct=trLivePrice(s),closed=direct===null?trClosedQuote(s):null;
  // Europeas: si aún no hay precio de TR, el último cierre de su bolsa (ya en euros).
  const snap=direct===null&&!closed&&intlListing(s)?{price:N(s.price),change:N(s.changePct),updatedAt:N(s.lastBarUpdateTime)?N(s.lastBarUpdateTime)*1000:null}:null;
  const eur=direct??N(closed&&closed.price)??N(snap&&snap.price);
  return{
   market:'tr',
   source:direct!==null?'LS Exchange (vía Trade Republic)':snap?'Último cierre · '+String(s.exchange||'bolsa europea'):'Último cierre · LS Exchange (vía Trade Republic)',
   nativeCurrency:'EUR',
   price:eur,
   eur,
   usd:eur!==null&&fx?eur*fx:null,
   change:trLiveChange(s)??N(snap&&snap.change),
   updatedAt:direct!==null?quoteTimestampMs(s,true):(N(closed&&closed.updatedAt)||N(snap&&snap.updatedAt)||null),
   fx,
   fxUpdatedAt:fxLive.updatedAt||parseMarketTimestamp(db.meta&&db.meta.updatedAt,'Europe/Madrid')||null,
   live:direct!==null,
   realTime:direct!==null&&trMarketOpen(),
   fallback:false,
   frozen:direct===null&&eur!==null
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
  live:usd!==null&&!!(current&&current.source)&&!/^Snapshot\b/i.test(String(current.source||'')),
  realTime:current&&current.realtime===true,
  fallback:!current||!current.source||/^Snapshot\b/i.test(String(current.source||''))
 };
}

/*
 * Quote used by compact lists.
 * If a verified LSX last price has not arrived yet, never fabricate an EUR/LSX
 * quote. Fall back to the verified US quote/snapshot and label it explicitly.
 * This keeps price and percentage on the same source while avoiding fake data.
 */
function verifiedDisplayQuote(s,preferTr=false,se=SES()){
 if(intlListing(s))preferTr=true;
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
  return parseMarketTimestamp(s&&s.trLiveMidAt,'Europe/Berlin')||
   parseMarketTimestamp(s&&s.trLiveLastAt,'Europe/Berlin')||
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
 // LSX solo envía cambios: un valor con poca negociación puede tener la misma compra y venta
 // durante mucho rato. Si está suscrito y la conexión en directo sigue recibiendo datos, esa
 // cotización es la vigente ahora mismo aunque su hora sea antigua.
 let unchangedSince=false;
 if(market==='tr'&&open&&direct&&state!=='live'&&trLive.connected&&trLive.subByKey.has(stockKey(s))&&Date.now()-(trLive.lastMessageAt||0)<90000){
  state='live';label='En directo';unchangedSince=true;
 }
 let exact=ms?new Date(ms).toLocaleString('es-ES',{timeZone:'Europe/Madrid'}):'sin hora disponible';
 let title=(source?source+' · ':'')+(unchangedSince?'en directo, sin cambios desde '+exact:exact)+(delay!==null?' · retraso declarado '+delay+' min':'');
 return{state,label,title,updatedAt:ms,ageMs:age,delayMinutes:delay,source,live:state==='live'};
}
function quoteFreshnessDotState(info){
 const raw=String(info&&info.state||'unknown');
 if(raw==='live')return'live';
 if(raw==='delayed'||raw==='closed')return'delayed';
 return'stale';
}
function quoteFreshnessDotHtml(s,preferTr=false,extraClass=''){
 if(!s)return'';
 const info=quoteFreshnessInfo(s,preferTr),tone=quoteFreshnessDotState(info),key=stockKey(s);
 const label=info&&info.label?info.label:(tone==='live'?'Tiempo real':tone==='delayed'?'Con retraso':'Sin actualizar');
 return '<span class="quote-freshness-dot '+E(tone)+(extraClass?' '+E(extraClass):'')+'" data-quote-freshness-key="'+E(key)+'" data-quote-freshness-tr="'+(preferTr?'1':'0')+'" data-quote-freshness-dot="1" data-status-label="'+E(label)+'" title="'+E(info.title||label)+'" aria-label="'+E(label)+'" tabindex="0"><i aria-hidden="true"></i></span>';
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
  if(el.dataset.quoteFreshnessDot==='1'){
   const tone=quoteFreshnessDotState(info),label=info&&info.label?info.label:(tone==='live'?'Tiempo real':tone==='delayed'?'Con retraso':'Sin actualizar');
   el.classList.remove('live','delayed','closed','stale','unknown');
   el.classList.add(tone);
   el.dataset.statusLabel=label;
   el.setAttribute('aria-label',label);
   el.title=info.title||label;
   return;
  }
  el.classList.remove('live','delayed','closed','stale','unknown');
  el.classList.add(info.state);
  let text=el.querySelector('span');if(text)text.textContent=info.label;
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
 return '<span class="table-price-wrap"><span class="table-price-inline">'+quoteFreshnessDotHtml(s,true,'table-price-freshness')+'<span class="table-price-cell'+(cls?' '+cls:'')+'" data-tr-price-'+which+'-key="'+E(stockKey(s))+'">'+quoteMoney(value,sym,dec)+'</span></span><small class="quote-updated table-quote-updated">'+quoteUpdatedLabel(s,true)+'</small></span>';
}
function usPriceCell(s,which,se){
 let x=usPriceValues(s,SP(s,se)),value=which==='usd'?x.usd:x.eur,sym=which==='usd'?'\u0024':'€',dec=quotePrecision(s,false,SP(s,se));
 let cls=quoteDirClass(s&&s.usLiveDirection);
 return '<span class="table-price-wrap"><span class="table-price-inline">'+quoteFreshnessDotHtml(s,false,'table-price-freshness')+'<span class="table-price-cell'+(cls?' '+cls:'')+'" data-us-price-'+which+'-key="'+E(stockKey(s))+'">'+quoteMoney(value,sym,dec)+'</span></span><small class="quote-updated table-quote-updated">'+quoteUpdatedLabel(s,false)+'</small></span>';
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

 // "last" del feed de TR/LSX es en la práctica el precio de venta (Geld). LS-X publica como cotización el precio
 // medio entre Geld y Brief, así que el precio que se muestra es ese medio; venta y compra siguen aparte y el
 // Objetivo usa la compra para comprar y la venta para vender y para los stops.
 if(last!==null){
  s.trLiveLast=last;
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
 if(pre!==null)s.trLivePreRaw=pre;
 if(open!==null)s.trLiveOpen=open;
 {
  const b=N(s.trLiveBid),a=N(s.trLiveAsk),l=N(s.trLiveLast);
  const spreadOk=b!==null&&a!==null&&b>0&&a>=b&&(a-b)/b<.25;
  const price=spreadOk?Math.round((b+a)/2*1e6)/1e6:l;
  // El cierre anterior del feed es de venta: se lleva al medio con el diferencial actual, como hace LS-X.
  // trLivePre queda en esa misma base para que variación absoluta y porcentaje cuadren.
  const prevBase=N(s.trLivePreRaw),prevMid=prevBase>0?(spreadOk?prevBase+(a-b)/2:prevBase):null;
  if(prevMid>0)s.trLivePre=Math.round(prevMid*1e6)/1e6;
  // La hora del precio medio es la del lado más antiguo: solo es reciente si venta y compra lo son.
  s.trLiveMidAt=spreadOk?Math.min(N(s.trLiveBidAt)||0,N(s.trLiveAskAt)||0)||null:null;
  if(price!==null){
   if(old!==null&&price!==old){s.trLiveDirection=price>old?'up':'down';s.trLiveDirectionAt=Date.now()}
   s.trLivePrice=price;
   if(prevMid>0)s.trLiveChangePct=(price/prevMid-1)*100;
  }
 }
 s.trLiveQuality=payload.qualityId||s.trLiveQuality||'';
 if(N(s.trLivePrice)!==null)rememberTrCloseQuote(s);
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
 // Con la app a la vista no se espera más de 5 s entre reintentos; en segundo plano, hasta 30 s.
 let wait=Math.min(document.hidden?30000:5000,1000*Math.pow(2,Math.min(trLive.reconnectAttempt++,5)));
 trLive.reconnectTimer=setTimeout(()=>{trLive.reconnectTimer=null;connectTrLive()},wait);
}
function trWakeLive(){
 trLive.reconnectAttempt=0;
 if(trLive.reconnectTimer){clearTimeout(trLive.reconnectTimer);trLive.reconnectTimer=null}
 if(!trCheckSilentSocket(20000))connectTrLive();
}
function trCheckSilentSocket(limit=60000){
 if(!trLive.connected||!trLive.ws||!trLive.wanted.size||!trMarketOpen())return false;
 if(Date.now()-(trLive.lastMessageAt||0)<limit)return false;
 // Un socket muerto puede tardar minutos en avisar de su cierre: se suelta y se abre otro ya.
 const old=trLive.ws;old.onclose=null;old.onmessage=null;old.onerror=null;
 try{old.close()}catch(_){}
 trLive.ws=null;trLive.connected=false;trLive.connecting=false;trLive.subByKey.clear();trLive.keyBySub.clear();trLive.payloadBySub.clear();
 connectTrLive();
 return true;
}
function connectTrLive(){
 if(trLive.connected||trLive.connecting)return;
 if(typeof WebSocket==='undefined')return;
 trLive.connecting=true;
 let ws,url=trLive.usingDirect?TR_LIVE_DIRECT:trProxyUrl(),opened=false;
 try{ws=new WebSocket(url)}catch(_){trLive.connecting=false;trScheduleReconnect();return}
 trLive.ws=ws;
 ws.onopen=()=>{try{ws.send('connect 30')}catch(_){}};
 ws.onmessage=e=>{
  trLive.lastMessageAt=Date.now();
  let msg=String(e.data||'');
  if(msg==='connected'||msg.startsWith('connected')){
   opened=true;
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
  // Closures are routine on phones (sleep, network change, background). The direct
  // Trade Republic socket is only a one-off fallback: browsers and the APK cannot send
  // TR's expected Origin, so always return to the Worker bridge afterwards.
  if(trLive.usingDirect)trLive.usingDirect=false;
  else if(!opened&&++trLive.proxyFailures>=2){trLive.usingDirect=true;trLive.proxyFailures=0}
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
// Cotizaciones de LSX que un módulo necesita aunque no estén en pantalla (p. ej. las candidatas del Objetivo,
// que se evalúan sin pintarse). Cada ámbito sustituye su lista; no se podan mientras sigan fijadas.
function trPinnedKeys(){let out=new Set(),now=Date.now();for(let [scope,p] of trLive.pinned){if(now-p.at>180000){trLive.pinned.delete(scope);continue}for(let k of p.keys)out.add(k)}return out}
function pinTrLiveKeys(scope,keys){
 scope=String(scope||'');if(!scope)return;
 let next=new Set((Array.isArray(keys)?keys:[]).map(String).filter(k=>k&&trStockByKey(k)).slice(0,60));
 // Caduca a los 3 minutos si el módulo deja de renovarla (p. ej. al salir del Objetivo).
 trLive.pinned.set(scope,{at:Date.now(),keys:next});
 for(let key of next)if(!trLive.wanted.has(key))ensureTrLiveKey(key);
}
// Hay cotización ejecutable de LSX para la acción: suscrita en el socket abierto y con un dato recibido en esta
// conexión, con LSX abierto. Una línea sin operaciones mantiene su horquilla aunque el último cruce sea antiguo.
function trLiveFresh(key){
 let sub=trLive.subByKey.get(String(key||''));
 return !!(sub&&trLive.connected&&trLive.payloadBySub.has(sub)&&trMarketOpen());
}
function ensureTrLiveKey(key){
 let s=trStockByKey(key);if(!s)return;
 if(trLive.wanted.has(key)){
  trLive.wanted.delete(key);
  trLive.wanted.add(key);
 }else{
  while(trLive.wanted.size>=MAX_TR_LIVE_SUBSCRIPTIONS){
   // Se libera la suscripción más antigua que no esté fijada (las candidatas del Objetivo se conservan).
   let pinned=trPinnedKeys(),oldest=[...trLive.wanted].find(k=>!pinned.has(k))||trLive.wanted.values().next().value;
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
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){trWakeLive();requestAnimationFrame(()=>observeActiveTrLivePrices());pruneTrLiveSubscriptions()}});
 // Al volver a la app (o si el socket se queda mudo) Android puede dejar una conexión muerta
 // que el navegador aún da por abierta: se cierra y se abre otra en vez de esperar.
 setInterval(()=>{if(!document.hidden)trCheckSilentSocket()},10000);
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
 // The Markets view also performs a rotating LSX scan. Do not prune those
 // subscriptions just because the ranking is still empty and has no visible
 // quote nodes yet.
 if(state.currentView==='home'&&typeof currentMarketBoardSource==='function'&&currentMarketBoardSource()==='tr')return;
 const selector='[data-compact-quote-key][data-compact-quote-tr="1"],[data-tr-live-key],[data-tr-live-change-key],[data-tr-subscribe-key],[data-tr-spread-key],[data-tr-price-eur-key],[data-tr-price-usd-key]';
 let keep=trPinnedKeys(),h=window.innerHeight||900;
 for(let root of activeLiveRoots())for(let el of root.querySelectorAll(selector)){
  let r=el.getBoundingClientRect();if(r.bottom<-700||r.top>h+700)continue;
  let key=el.dataset.compactQuoteKey||el.dataset.compactQuoteKey||el.dataset.trLiveKey||el.dataset.trLiveChangeKey||el.dataset.trSubscribeKey||el.dataset.trSpreadKey||el.dataset.trPriceEurKey||el.dataset.trPriceUsdKey;
  if(key)keep.add(key);
 }
 for(let key of [...trLive.wanted])if(!keep.has(key))dropTrLiveKey(key);
}
function usStockByKey(key){let s=stockByKey(key);return s&&market(s,'us')?s:null}
function usVisibleKeys(){
 let nodes=liveNodes('[data-compact-quote-key][data-compact-quote-tr="0"],[data-us-poll-key],[data-us-current-hero-key],[data-us-live-key],[data-us-spread-key],[data-us-live-change-key],[data-us-price-usd-key],[data-us-price-eur-key],[data-us-bid-key],[data-us-ask-key],[data-us-heat-key]');
 let h=window.innerHeight||900,seen=new Set(),out=[];
 for(let el of nodes){
  let r=el.getBoundingClientRect();
  if(r.bottom<-400||r.top>h+400)continue;
  let key=(el.dataset.compactQuoteTr==='1'?el.dataset.usPollKey:el.dataset.compactQuoteKey)||el.dataset.usCurrentHeroKey||el.dataset.usLiveKey||el.dataset.usSpreadKey||el.dataset.usLiveChangeKey||el.dataset.usPriceUsdKey||el.dataset.usPriceEurKey||el.dataset.usBidKey||el.dataset.usAskKey||el.dataset.usHeatKey;
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
 if(N(q.dayHigh??q.high)!==null)s.usLiveDayHigh=N(q.dayHigh??q.high);
 if(N(q.dayLow??q.low)!==null)s.usLiveDayLow=N(q.dayLow??q.low);
 if(N(q.open)!==null)s.usLiveOpen=N(q.open);
 if(N(q.previousClose??q.prevClose)!==null)s.usLivePreviousClose=N(q.previousClose??q.prevClose);
 if(N(q.changePct)!==null)s.usLiveChangePct=N(q.changePct);
 s.usLiveTimestamp=q.timestamp||'';
 s.usLiveMarketStatus=q.marketStatus||'';
 {
  const raw=String(s.usLiveMarketStatus||'').toLowerCase();
  const kind=raw.includes('pre')?'premarket':raw.includes('post')||raw.includes('after')?'postmarket':raw.includes('regular')||raw.includes('open')?'regular':currentMarketSession();
  if(px!==null){
   usRememberSessionBaseline(s,kind,px,quoteTimestampMs(s,false)||Date.now());
   if(kind==='regular'){
    s.usRegularFrozenPrice=px;
    s.usRegularFrozenAt=quoteTimestampMs(s,false)||Date.now();
   }
  }
 }
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
 visibleLiveNodes('[data-profile-regular-session-key]').forEach(el=>{
  let s=usStockByKey(el.dataset.profileRegularSessionKey);if(!s)return;
  let se=currentMarketSession(),live=se==='regular'&&N(s.usLivePrice)!==null,r=usSessionDisplayData(s,se).regular;
  let price=r.price,change=r.pct;
  let volume=live?(N(s.usLiveVolume)??N(s.volume)):N(s.volume);
  // Solo los hijos directos: el precio lleva dentro su propio <small> (el importe en €) y,
  // con querySelector a secas, la nota lo pisaba y el precio lo volvía a pintar (parpadeo).
  let label=el.querySelector(':scope>span'),strong=el.querySelector(':scope>strong'),tone=el.querySelector(':scope>b'),note=el.querySelector(':scope>small');
  if(label){const t=live?'EEUU · Regular · actual':'EEUU · Regular · cierre';if(label.textContent!==t)label.textContent=t}
  if(strong)setHtmlIfChanged(strong,snapshotPricePair(s,price,false));
  if(tone){const t=PC(change),c=C(change);if(tone.textContent!==t)tone.textContent=t;if(tone.className!==c)tone.className=c}
  if(note){const t=(live?'Nasdaq en vivo':'Último cierre regular')+' · Vol '+compactVol(volume);if(note.textContent!==t)note.textContent=t}
 });
 visibleLiveNodes('[data-profile-live-range-key]').forEach(el=>{
  let s=usStockByKey(el.dataset.profileLiveRangeKey);if(!s)return;
  let lo=N(s.usLiveDayLow)??N(s.dayLow),hi=N(s.usLiveDayHigh)??N(s.dayHigh);
  el.textContent=lo!==null&&hi!==null?usRangeText(lo,hi):'—';
 });
 visibleLiveNodes('[data-profile-live-volume-key]').forEach(el=>{
  let s=usStockByKey(el.dataset.profileLiveVolumeKey);if(!s)return;
  el.textContent=compactVol(N(s.usLiveVolume)??SV(s,currentMarketSession()));
 });
 visibleLiveNodes('[data-profile-live-relvol-key]').forEach(el=>{
  let s=usStockByKey(el.dataset.profileLiveRelvolKey);if(!s)return;
  let v=N(s.usLiveVolume)??SV(s,currentMarketSession()),avg=N(s.avgVolume),rel=v!==null&&avg>0?v/avg:RV(s,currentMarketSession());
  el.textContent=rel===null?'—':F(rel,2)+'×';
 });
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
 let minGap=document.body.classList.contains('stock-detail-open')?900:2200;
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
// Live overlay for the whole US universe (/api/market-live, one shared scan per minute).
// The 30-min snapshot keeps the slow data (ISIN, events, fundamentals); price, change,
// volume, relative volume, range and pre/post-market come from here, so lists,
// rankings, Radar and catalogues are computed with live data.
const marketLive={busy:false,lastAt:0,payload:null,timer:null};
function applyMarketLive(payload){
 if(!payload||!Array.isArray(payload.rows)||!Array.isArray(payload.fields))return 0;
 const updated=Date.parse(payload.updatedAt||'')||Date.now();
 const snapshotAt=Date.parse((db.meta&&db.meta.updatedAt)||'')||0;
 if(updated<snapshotAt)return 0;
 let n=0;
 for(const row of payload.rows){
  const s=stockByKey(row[0]);if(!s)continue;
  payload.fields.forEach((f,i)=>{const v=row[i+1];if(v!==null&&v!==undefined)s[f]=v});
  n++;
 }
 if(db.meta)db.meta.liveUpdatedAt=payload.updatedAt;
 return n;
}
// «● En vivo» while the live overlay is under 3 minutes old during a session;
// otherwise the time of the last update (with the date when it is not today).
function dataFreshness(at=null){
 const live=Date.parse((db.meta&&db.meta.liveUpdatedAt)||'')||0;
 const snap=Date.parse((db.meta&&db.meta.updatedAt)||'')||0;
 const se=currentMarketSession();
 if(!at&&live&&Date.now()-live<180000&&se!=='previous')return{live:true,text:'En vivo'};
 const t=at?(typeof at==='number'?at:Date.parse(at)):Math.max(live,snap);
 if(!t)return{live:false,text:'Actualizando…'};
 const d=new Date(t),today=new Date().toDateString()===d.toDateString();
 return{live:false,text:'Actualizado '+(today?'':d.toLocaleDateString('es-ES',{day:'numeric',month:'short'})+' ')+d.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})};
}
function paintFreshness(el,at=null){
 if(!el)return;
 const f=dataFreshness(at);
 el.textContent=(f.live?'● ':'')+f.text;
 el.classList.toggle('is-live',f.live);
}
function reapplyMarketLive(){if(marketLive.payload)applyMarketLive(marketLive.payload)}
function marketLiveInterval(){
 const se=currentMarketSession();
 return se==='regular'?60000:se==='premarket'||se==='postmarket'?90000:600000;
}
async function pollMarketLive(force=false){
 if(marketLive.busy||document.hidden)return;
 if(!force&&Date.now()-marketLive.lastAt<marketLiveInterval()-1000)return;
 marketLive.busy=true;
 try{
  const r=await fetch('/api/market-live',{cache:'no-store'});
  if(!r.ok)throw Error(r.status);
  const payload=await r.json();
  marketLive.lastAt=Date.now();
  if(applyMarketLive(payload)){
   marketLive.payload=payload;
   window.dispatchEvent(new CustomEvent('viewinvai:market-live',{detail:{updatedAt:payload.updatedAt}}));
   scheduleEntryAutoSort(0);
   refreshUsLiveDom();
   scheduleLiveViewRefresh(300);
  }
 }catch(e){console.warn('Market live warning',e)}
 finally{marketLive.busy=false}
}

function initUsLive(){
 setInterval(refreshUsLiveDom,1800);
 setInterval(()=>refreshQuoteFreshnessDom(document),3000);
 setInterval(pollUsLive,1200);
 setTimeout(pollUsLive,700);
 setInterval(()=>pollMarketLive(false),15000);
 setTimeout(()=>pollMarketLive(true),1500);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){pollUsLive();pollMarketLive(false);scheduleEntryAutoSort(0)}});
}

function currentMarketSession(){
 return auto();
}
function sessionStageLabel(se){
 return se==='premarket'?'PREMARKET':se==='postmarket'?'POSTMARKET':se==='previous'?'ÚLTIMA SESIÓN':'REGULAR';
}
