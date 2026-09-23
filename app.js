const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DATA='data/market.json', CUSTOM_FILTER_KEY='catalystpulse:customFilter:v1', FAV_KEY='catalystpulse:favorites:v1', LEADERS_PIN_KEY='catalystpulse:leadersPinned:v1', UI_KEY='catalystpulse:ui:v1';
let db={stocks:[],events:[],meta:{}}, loading=false, lastDataStamp='';
const TR_LIVE_DIRECT='wss://api.traderepublic.com';
function trProxyUrl(){return (location.protocol==='https:'?'wss://':'ws://')+location.host+'/api/tr-live'}
let trLive={ws:null,connected:false,connecting:false,seq:1,subByKey:new Map(),keyBySub:new Map(),payloadBySub:new Map(),wanted:new Set(),reconnectTimer:null,reconnectAttempt:0,observer:null,usingDirect:false,proxyFailures:0,lastDataAt:0};
let usLive={busy:false,lastFetchAt:0};
let uiRestoredScroll=false;
let favorites=readFavorites();
let state={entryMarket:'tr',session:'auto',preset:'intraday',profileKey:null,profileReason:'',profileOriginView:null,profileOriginScroll:0,profilePreferTr:null,currentView:'entry',savedScrollY:0};
const V={entry:'01 Potencial de entrada',future:'02 Potencial futuro',calendar:'03 Calendario y noticias',catalog:'04 Catálogo Trade Republic',catalogUS:'05 Catálogo EEUU'};
const P={
 short:{minChange:1,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:true,sort:'score'},
 medium:{minChange:0,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:true,illiquid:true,sort:'score'},
 broad:{minChange:0,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:false,sort:'score'},
 intraday:{minChange:2,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:true,sort:'score'},
 exploded:{minChange:20,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:false,sort:'change'},
 afterhours:{minChange:0,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:false,sort:'afterhours'},
 strict:{minChange:1,maxChange:0,minRelVolume:1.3,minAdx:22,minRsi:42,maxRsi:68,minVolume:0,trend:true,illiquid:true,sort:'score'}
};
function restoreUiState(){
 try{
  let x=JSON.parse(localStorage.getItem(UI_KEY)||'{}');
  if(x&&V[x.view])state.currentView=x.view;
  if(x&&x.profileKey)state.profileKey=x.profileKey;
  if(x&&x.profileReason)state.profileReason=x.profileReason;
  state.savedScrollY=N(x&&x.scrollY)??0;
 }catch(_){}
 document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id==='view-'+state.currentView));
 document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.view===state.currentView));
}
function saveUiState(){
 try{
  localStorage.setItem(UI_KEY,JSON.stringify({view:state.currentView||'entry',profileKey:state.profileKey||null,profileReason:state.profileReason||'',scrollY:Math.max(0,Math.round(window.scrollY||0))}));
 }catch(_){}
}
let saveUiTimer=null;
function queueUiSave(){clearTimeout(saveUiTimer);saveUiTimer=setTimeout(saveUiState,120)}
function preset(n){return Object.assign({},P[n]||P.intraday)}
function savedCustomPreset(){
 try{
  let x=JSON.parse(localStorage.getItem(CUSTOM_FILTER_KEY)||'null');
  if(!x||typeof x!=='object')return null;
  return Object.assign({},P.broad,x,{sort:x.sort||'score'});
 }catch(_){return null}
}
function saveCustomPreset(x){
 try{localStorage.setItem(CUSTOM_FILTER_KEY,JSON.stringify(x));return true}catch(_){return false}
}
state.filters=preset('intraday');

function N(v){v=Number(v);return Number.isFinite(v)?v:null}
function E(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function F(v,d=2){v=N(v);return v===null?'—':v.toLocaleString('es-ES',{maximumFractionDigits:d})}
function I(v){v=N(v);return v===null?'—':Math.round(v).toLocaleString('es-ES')}
function PR(v){v=N(v);return v===null?'—':v.toLocaleString('es-ES',{maximumFractionDigits:v<1?6:4})}
function money(v,symbol){
 v=N(v);if(v===null)return symbol+'—';
 return symbol+v.toLocaleString('es-ES',{maximumFractionDigits:v<1?6:4});
}
function eurUsd(){let r=N(db.meta&&db.meta.eurUsd);return r&&r>0?r:null}
function priceCurrencies(s,p){
 p=N(p);if(p===null)return{usd:null,eur:null};
 let fx=eurUsd(),cur=String((s&&s.currency)||'USD').toUpperCase();
 if(cur==='EUR')return{eur:p,usd:fx?p*fx:null};
 return{usd:p,eur:fx?p/fx:null};
}
function trIsin(s){return String((s&&s.trIsin)||(s&&s.tradeRepublicVerified&&s&&s.isin)||'').trim()}
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
 let usd=usLivePrice(s)??N(fallback),fx=eurUsd();
 return{usd,eur:usd!==null&&fx?usd/fx:null,direct:usLivePrice(s)!==null};
}

function pricePairInner(s,p,preferTr=false){
 let d='\u0024',dec=quotePrecision(s,preferTr,p);
 if(preferTr&&s&&s.tradeRepublicVerified){
  let x=trPriceValues(s,p);
  return '<strong>'+quoteMoney(x.eur,'€',dec)+'</strong><small>/ '+quoteMoney(x.usd,d,dec)+'</small>';
 }
 let x=usPriceValues(s,p);
 return '<strong>'+quoteMoney(x.usd,d,dec)+'</strong><small>'+quoteMoney(x.eur,'€',dec)+'</small>';
}
function pricePair(s,p,preferTr=false){
 let liveAttrs=preferTr&&s&&s.tradeRepublicVerified?' data-tr-live-key="'+E(stockKey(s))+'"':' data-us-live-key="'+E(stockKey(s))+'"';
 let direct=preferTr?(trLivePrice(s)!==null):(usLivePrice(s)!==null);
 let dir=preferTr?s&&s.trLiveDirection:s&&s.usLiveDirection,dirCls=quoteDirClass(dir);
 let source=preferTr
  ?(direct?'Cotización LSX recibida directamente del ticker de Trade Republic. El precio en $ es solo una conversión EUR/USD de referencia.':'Esperando la cotización exacta LSX de Trade Republic; no se sustituye por precios de otros mercados.')
  :(direct?'Cotización actual recibida desde Nasdaq.com; el valor en € es una conversión EUR/USD de referencia.':'Esperando cotización Nasdaq actual; se muestra temporalmente el último snapshot disponible.');
 return '<span class="price-pair'+(direct?' live-quote':'')+(dirCls?' '+dirCls:'')+'"'+liveAttrs+' title="'+E(source)+'">'+pricePairInner(s,p,preferTr)+'</span>';
}
function levelPair(s,p,preferTr=false){
 let d='\u0024';
 if(preferTr&&s&&s.tradeRepublicVerified){
  let x=trPriceValues(s,p);
  return money(x.eur,'€')+' / '+money(x.usd,d);
 }
 let x=priceCurrencies(s,p);
 return money(x.usd,d)+' / '+money(x.eur,'€');
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
 if(preferTr&&s.tradeRepublicVerified){
  return '<span class="quote-spread quote-spread-tr" data-tr-spread-key="'+E(stockKey(s))+'" title="BID = mejor precio comprador · ASK = mejor precio vendedor · ambos son distintos del último precio negociado">'+bidAskInner(s,true)+'</span>';
 }
 return '<span class="quote-spread quote-spread-us '+(s.usLiveIsRealTime?'realtime':'delayed')+'" data-us-spread-key="'+E(stockKey(s))+'" title="'+(s.usLiveIsRealTime?'Bid y Ask actuales recibidos desde Nasdaq.com':'Bid/Ask no marcado como tiempo real por Nasdaq; no se reutiliza el snapshot diferido')+'">'+bidAskInner(s,false)+'</span>';
}
function flashQuote(el,dir){setQuoteDirection(el,dir)}

function trPriceCell(s,which,se){
 let x=trPriceValues(s,SP(s,se)),value=which==='eur'?x.eur:x.usd,sym=which==='eur'?'€':'\u0024',dec=quotePrecision(s,true,SP(s,se));
 let cls=quoteDirClass(s&&s.trLiveDirection);
 return '<span class="table-price-cell'+(cls?' '+cls:'')+'" data-tr-price-'+which+'-key="'+E(stockKey(s))+'">'+quoteMoney(value,sym,dec)+'</span>';
}
function usPriceCell(s,which,se){
 let x=usPriceValues(s,SP(s,se)),value=which==='usd'?x.usd:x.eur,sym=which==='usd'?'\u0024':'€',dec=quotePrecision(s,false,SP(s,se));
 let cls=quoteDirClass(s&&s.usLiveDirection);
 return '<span class="table-price-cell'+(cls?' '+cls:'')+'" data-us-price-'+which+'-key="'+E(stockKey(s))+'">'+quoteMoney(value,sym,dec)+'</span>';
}
function liveChangeHtml(s,fallback,preferTr=false){
 let value=preferTr&&s&&s.tradeRepublicVerified?(trLiveChange(s)??N(fallback)):(usLiveChange(s)??N(fallback));
 let attrs=preferTr&&s&&s.tradeRepublicVerified
  ?' data-tr-live-change-key="'+E(stockKey(s))+'"'
  :' data-us-live-change-key="'+E(stockKey(s))+'"';
 return '<span class="quote-change '+C(value)+'"'+attrs+'>'+PC(value)+'</span>';
}

function PC(v){v=N(v);return v===null?'—':(v>=0?'+':'')+F(v,2)+'%'}
function C(v){v=N(v);return v===null?'':v>=0?'positive':'negative'}
function DF(v){if(v===null||v===undefined||v==='')return'—';let raw=v;if(typeof raw==='string'&&/^\d+$/.test(raw))raw=Number(raw);if(typeof raw==='number'&&raw>0&&raw<1e12)raw*=1000;let d=new Date(raw);return isNaN(d)?'—':d.toLocaleDateString('es-ES')}
function NY(){let a=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());return Object.fromEntries(a.map(x=>[x.type,x.value]))}
function auto(){let p=NY(),m=+p.hour*60 + +p.minute;if(m>=240&&m<570)return'premarket';if(m>=570&&m<960)return'regular';if(m>=960&&m<1200)return'postmarket';return'previous'}
function SES(){return state.session==='auto'?auto():state.session}
function SN(s){return({premarket:'Premarket',regular:'Sesión regular',postmarket:'Postmarket',previous:'Sesión anterior'})[s]||s}
function SP(s,se=SES()){return se==='premarket'?(N(s.premarketPrice)??N(s.price)):se==='postmarket'?(N(s.postmarketPrice)??N(s.price)):N(s.price)}
function SC(s,se=SES()){return se==='premarket'?N(s.premarketChangePct):se==='postmarket'?N(s.postmarketChangePct):N(s.changePct)}
function SV(s,se=SES()){return se==='premarket'?N(s.premarketVolume):se==='postmarket'?N(s.postmarketVolume):(N(s.usLiveVolume)??N(s.volume))}
function FC(s,se=SES()){
 // The entry screener and the percentage rendered in each row must use the same metric.
 // For the regular session prefer the current US quote; pre/post use their explicit session snapshots.
 return se==='regular'?(usLiveChange(s)??SC(s,se)):SC(s,se);
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
function scoreParts(s,se=SES()){
 let ch=FC(s,se)??0,rv=RV(s,se)??0,adx=N(s.adx)??0,rsi=N(s.rsi);
 let parts={
  movimiento:Math.max(-20,Math.min(35,ch*1.6)),
  volumen:Math.min(25,rv*7),
  adx:Math.min(18,adx*.55),
  rsi:rsi===null?0:(rsi>=45&&rsi<=72?12:rsi>72?5:3),
  precioEma:(N(s.price)!==null&&N(s.ema20)!==null&&s.price>s.ema20)?5:0,
  tendenciaEma:(N(s.ema20)!==null&&N(s.ema50)!==null&&s.ema20>s.ema50)?5:0
 };
 parts.total=Math.max(0,Math.min(100,Object.values(parts).reduce((a,b)=>a+b,0)));
 return parts;
}
function score(s,se=SES()){return scoreParts(s,se).total}


function trStockByKey(key){let s=stockByKey(key);return s&&s.tradeRepublicVerified&&trIsin(s)?s:null}
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
function ensureTrLiveKey(key){
 let s=trStockByKey(key);if(!s)return;
 trLive.wanted.add(key);connectTrLive();trSendSubscriptions();
}
function observeTrLivePrices(root=document){
 if(!('IntersectionObserver' in window)){
  root.querySelectorAll('[data-tr-live-key],[data-tr-live-change-key],[data-tr-subscribe-key]').forEach(el=>ensureTrLiveKey(el.dataset.trLiveKey||el.dataset.trLiveChangeKey||el.dataset.trSubscribeKey));
  return;
 }
 if(!trLive.observer)trLive.observer=new IntersectionObserver(entries=>{
  for(let entry of entries)if(entry.isIntersecting){
   let el=entry.target,key=el.dataset.trLiveKey||el.dataset.trLiveChangeKey||el.dataset.trSubscribeKey;
   if(key)ensureTrLiveKey(key);
  }
 },{rootMargin:'300px 0px'});
 root.querySelectorAll('[data-tr-live-key],[data-tr-live-change-key],[data-tr-subscribe-key]').forEach(el=>trLive.observer.observe(el));
}
function refreshTrLiveDom(){
 document.querySelectorAll('[data-tr-live-key]').forEach(el=>{
  let s=trStockByKey(el.dataset.trLiveKey);if(!s)return;
  let fallback=SP(s,currentMarketSession()),direct=trLivePrice(s)!==null;
  el.innerHTML=pricePairInner(s,fallback,true);
  el.classList.toggle('live-quote',direct);
  el.title=direct?'Cotización LSX en tiempo real · Trade Republic'+(s.trLiveQuality?' · '+s.trLiveQuality:''):'Esperando cotización LSX en tiempo real';
  setQuoteDirection(el,s.trLiveDirection);
 });
 document.querySelectorAll('[data-tr-spread-key]').forEach(el=>{let s=trStockByKey(el.dataset.trSpreadKey);if(s)el.innerHTML=bidAskInner(s,true)});
 document.querySelectorAll('[data-tr-bid-key]').forEach(el=>{let s=trStockByKey(el.dataset.trBidKey);if(!s)return;el.textContent=quoteMoney(s.trLiveBid,'€',quotePrecision(s,true));setQuoteDirection(el,s.trLiveBidDirection)});
 document.querySelectorAll('[data-tr-ask-key]').forEach(el=>{let s=trStockByKey(el.dataset.trAskKey);if(!s)return;el.textContent=quoteMoney(s.trLiveAsk,'€',quotePrecision(s,true));setQuoteDirection(el,s.trLiveAskDirection)});
 document.querySelectorAll('[data-tr-price-eur-key]').forEach(el=>{let s=trStockByKey(el.dataset.trPriceEurKey);if(!s)return;el.textContent=quoteMoney(trPriceValues(s,SP(s,currentMarketSession())).eur,'€',quotePrecision(s,true,SP(s,currentMarketSession())));setQuoteDirection(el,s.trLiveDirection)});
 document.querySelectorAll('[data-tr-price-usd-key]').forEach(el=>{let s=trStockByKey(el.dataset.trPriceUsdKey);if(!s)return;el.textContent=quoteMoney(trPriceValues(s,SP(s,currentMarketSession())).usd,'\u0024',quotePrecision(s,true,SP(s,currentMarketSession())));setQuoteDirection(el,s.trLiveDirection)});
 document.querySelectorAll('[data-tr-live-bid-key]').forEach(el=>{let s=trStockByKey(el.dataset.trLiveBidKey);if(!s)return;el.textContent=quoteMoney(s.trLiveBid,'€',quotePrecision(s,true));setQuoteDirection(el,s.trLiveBidDirection)});
 document.querySelectorAll('[data-tr-live-ask-key]').forEach(el=>{let s=trStockByKey(el.dataset.trLiveAskKey);if(!s)return;el.textContent=quoteMoney(s.trLiveAsk,'€',quotePrecision(s,true));setQuoteDirection(el,s.trLiveAskDirection)});
 document.querySelectorAll('[data-tr-live-change-key]').forEach(el=>{
  let s=trStockByKey(el.dataset.trLiveChangeKey);if(!s)return;
  let v=trLiveChange(s);if(v===null)return;
  el.textContent=PC(v);el.classList.toggle('positive',v>=0);el.classList.toggle('negative',v<0);
 });
 if(state.entryMarket==='tr'&&$('#entryUpdated'))$('#entryUpdated').textContent=trLive.lastDataAt?'LSX · último dato '+new Date(trLive.lastDataAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'LSX · esperando cotización';
}
function initTrLive(){
 connectTrLive();
 setInterval(refreshTrLiveDom,1000);
 let queued=false;
 let mo=new MutationObserver(()=>{
  if(queued)return;queued=true;
  requestAnimationFrame(()=>{queued=false;observeTrLivePrices(document)});
 });
 mo.observe(document.body,{childList:true,subtree:true});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)connectTrLive()});
}

function usStockByKey(key){let s=stockByKey(key);return s&&market(s,'us')?s:null}
function usVisibleKeys(){
 let nodes=[...document.querySelectorAll('[data-us-live-key],[data-us-spread-key],[data-us-live-change-key],[data-us-price-usd-key],[data-us-price-eur-key],[data-us-bid-key],[data-us-ask-key]')];
 let h=window.innerHeight||900,seen=new Set(),out=[];
 for(let el of nodes){
  let r=el.getBoundingClientRect();
  if(r.bottom<-400||r.top>h+400)continue;
  let key=el.dataset.usLiveKey||el.dataset.usSpreadKey||el.dataset.usLiveChangeKey||el.dataset.usPriceUsdKey||el.dataset.usPriceEurKey||el.dataset.usBidKey||el.dataset.usAskKey;
  if(!key||seen.has(key))continue;
  let s=usStockByKey(key);if(!s)continue;
  seen.add(key);out.push(s);
  if(out.length>=25)break;
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
}
function refreshUsLiveDom(){
 document.querySelectorAll('[data-us-live-key]').forEach(el=>{
  let s=usStockByKey(el.dataset.usLiveKey);if(!s)return;
  el.innerHTML=pricePairInner(s,SP(s,currentMarketSession()),false);
  el.classList.toggle('live-quote',usLivePrice(s)!==null);
  el.title=s.usLiveIsRealTime?'Cotización Nasdaq actual':'Último dato Nasdaq disponible';
  setQuoteDirection(el,s.usLiveDirection);
 });
 document.querySelectorAll('[data-us-spread-key]').forEach(el=>{let s=usStockByKey(el.dataset.usSpreadKey);if(s){el.innerHTML=bidAskInner(s,false);el.classList.toggle('realtime',!!s.usLiveIsRealTime);el.classList.toggle('delayed',!s.usLiveIsRealTime)}});
 document.querySelectorAll('[data-us-bid-key]').forEach(el=>{let s=usStockByKey(el.dataset.usBidKey);if(!s)return;el.textContent=quoteMoney(usLiveBid(s),'\u0024',quotePrecision(s,false));setQuoteDirection(el,s.usLiveBidDirection)});
 document.querySelectorAll('[data-us-ask-key]').forEach(el=>{let s=usStockByKey(el.dataset.usAskKey);if(!s)return;el.textContent=quoteMoney(usLiveAsk(s),'\u0024',quotePrecision(s,false));setQuoteDirection(el,s.usLiveAskDirection)});
 document.querySelectorAll('[data-us-price-usd-key]').forEach(el=>{let s=usStockByKey(el.dataset.usPriceUsdKey);if(!s)return;el.textContent=quoteMoney(usPriceValues(s,SP(s,currentMarketSession())).usd,'\u0024',quotePrecision(s,false,SP(s,currentMarketSession())));setQuoteDirection(el,s.usLiveDirection)});
 document.querySelectorAll('[data-us-price-eur-key]').forEach(el=>{let s=usStockByKey(el.dataset.usPriceEurKey);if(!s)return;el.textContent=quoteMoney(usPriceValues(s,SP(s,currentMarketSession())).eur,'€',quotePrecision(s,false,SP(s,currentMarketSession())));setQuoteDirection(el,s.usLiveDirection)});
 document.querySelectorAll('[data-us-live-change-key]').forEach(el=>{let s=usStockByKey(el.dataset.usLiveChangeKey);if(!s)return;let v=usLiveChange(s);if(v===null)return;el.textContent=PC(v);el.classList.toggle('positive',v>=0);el.classList.toggle('negative',v<0)});
 if(state.entryMarket!=='tr'&&$('#entryUpdated')&&usLive.lastFetchAt){
  $('#entryUpdated').textContent='NASDAQ LIVE · '+new Date(usLive.lastFetchAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
 }
}
async function pollUsLive(){
 if(usLive.busy||document.hidden)return;
 let stocks=usVisibleKeys();if(!stocks.length)return;
 usLive.busy=true;
 try{
  let symbols=stocks.map(s=>s.ticker).filter(Boolean).join(',');
  let r=await fetch('/api/us-live?symbols='+encodeURIComponent(symbols),{cache:'no-store'});
  if(!r.ok)throw Error(r.status);
  let j=await r.json(),by=new Map(stocks.map(s=>[String(s.ticker||'').toUpperCase(),s]));
  for(let q of (j.quotes||[])){let s=by.get(String(q.symbol||'').toUpperCase());if(s)usApplyQuote(s,q)}
  usLive.lastFetchAt=Date.now();
  scheduleEntryAutoSort(0);
  refreshUsLiveDom();
 }catch(e){console.warn('US live quote warning',e)}
 finally{usLive.busy=false}
}
let entryAutoSortTimer=null;
function entryDomOrder(){
 return [...document.querySelectorAll('#entryResults .stock-card')].map(card=>{
  let row=card.querySelector('[data-stock-key]');
  return row&&row.dataset.stockKey||'';
 }).filter(Boolean).join('|');
}
function scheduleEntryAutoSort(delay=120){
 if(state.currentView!=='entry'||document.hidden||document.body.classList.contains('stock-detail-open'))return;
 clearTimeout(entryAutoSortTimer);
 entryAutoSortTimer=setTimeout(()=>{
  entryAutoSortTimer=null;
  let [a]=entry(),next=a.slice(0,150).map(stockKey).join('|');
  if(next!==entryDomOrder())renderEntry();
 },Math.max(0,delay));
}
function initUsLive(){
 setInterval(refreshUsLiveDom,1000);
 setInterval(pollUsLive,3000);
 setTimeout(pollUsLive,700);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){pollUsLive();scheduleEntryAutoSort(0)}});
}
function readFavorites(){
 try{
  let raw=JSON.parse(localStorage.getItem(FAV_KEY)||'[]');
  return new Set(Array.isArray(raw)?raw:[]);
 }catch(_){return new Set()}
}
function saveFavorites(){
 try{localStorage.setItem(FAV_KEY,JSON.stringify([...favorites]))}catch(_){}
}
function stockKey(s){
 return String((s&&s.tvSymbol)||(((s&&s.exchange)||'')+':'+((s&&s.ticker)||''))).toUpperCase();
}
function stockByKey(key){
 key=String(key||'').toUpperCase();
 return db.stocks.find(s=>stockKey(s)===key)||null;
}
function stockOpenAttrs(s,reason='',preferTr=null){
 let pref=preferTr===true?'1':preferTr===false?'0':'';
 return ' data-stock-key="'+E(stockKey(s))+'"'+(reason?' data-stock-reason="'+E(reason)+'"':'')+(pref?' data-stock-prefer-tr="'+pref+'"':'')+' role="button" tabindex="0"';
}
function tickerDisplay(s,preferTr=false){
 let us=String((s&&s.ticker)||'');
 let tr=String((s&&s.trTicker)||'');
 if(preferTr&&s&&s.tradeRepublicVerified){
  if(tr)return '<strong>'+E(tr)+'</strong><small class="ticker-us-ref">EEUU '+E((s.exchange||'')+':'+us)+'</small>';
  return '<strong>'+E(us)+'</strong><small class="ticker-us-ref pending">TR pendiente · EEUU '+E((s.exchange||'')+':'+us)+'</small>';
 }
 return '<strong>'+E(us)+'</strong>';
}

function viewLabel(v){return String(V[v]||'Vista').replace(/^\d+\s*/,'')}
function inferProfilePreferTr(s){
 if(state.currentView==='catalog')return true;
 if(state.currentView==='catalogUS')return false;
 if(state.currentView==='entry')return state.entryMarket==='tr'&&!!s.tradeRepublicVerified;
 return !!s.tradeRepublicVerified;
}
function openStock(s,reason='',preferTr=null){
 if(!s)return;
 state.profileKey=stockKey(s);
 state.profileReason=reason||'';
 state.profileOriginView=state.currentView;
 state.profileOriginScroll=Math.max(0,Math.round(window.scrollY||0));
 state.profilePreferTr=preferTr===true?true:preferTr===false?false:inferProfilePreferTr(s);
 saveUiState();
 renderQuickProfile();
 document.body.classList.add('stock-detail-open');
 let box=$('#stockQuickDetail');if(box)box.classList.remove('is-hidden');
 requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'smooth'}));
}
function closeQuickProfile(restoreScroll=true){
 let y=state.profileOriginScroll||0;
 document.body.classList.remove('stock-detail-open');
 let box=$('#stockQuickDetail');if(box){box.classList.add('is-hidden');box.innerHTML=''}
 state.profileKey=null;state.profileReason='';state.profileOriginView=null;state.profileOriginScroll=0;state.profilePreferTr=null;
 saveUiState();
 if(restoreScroll)requestAnimationFrame(()=>window.scrollTo({top:y,behavior:'smooth'}));
}

function favButton(s){
 let key=stockKey(s),on=favorites.has(key);
 return '<button type="button" class="fav-star'+(on?' active':'')+'" data-fav-key="'+E(key)+'" title="'+(on?'Quitar de favoritas':'Añadir a favoritas')+'" aria-label="'+(on?'Quitar de favoritas':'Añadir a favoritas')+'">'+(on?'★':'☆')+'</button>';
}
function toggleFavorite(key){
 if(!key)return;
 if(favorites.has(key))favorites.delete(key);else favorites.add(key);
 saveFavorites();
 $$('.fav-star').forEach(b=>{
  if(b.dataset.favKey!==key)return;
  let on=favorites.has(key);
  b.classList.toggle('active',on);
  b.textContent=on?'★':'☆';
  b.title=on?'Quitar de favoritas':'Añadir a favoritas';
  b.setAttribute('aria-label',b.title);
 });
 renderFavorites();
}
function currentMarketSession(){
 let se=auto();
 return se==='previous'?'postmarket':se;
}
function sessionStageLabel(se){
 return se==='premarket'?'PREMARKET':se==='postmarket'?'POSTMARKET':'REGULAR';
}
function compactVol(v){
 v=N(v);if(v===null)return'—';
 let a=Math.abs(v);
 if(a>=1e9)return F(v/1e9,1)+'B';
 if(a>=1e6)return F(v/1e6,1)+'M';
 if(a>=1e3)return F(v/1e3,1)+'K';
 return I(v);
}
function tvHref(s){
 let sym=encodeURIComponent(String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+(s.ticker||''))).replace(':','-'));
 return 'https://www.tradingview.com/symbols/'+sym+'/';
}
function topGainers(kind,se){
 return db.stocks
  .filter(s=>kind==='tr'?!!s.tradeRepublicVerified:market(s,'us'))
  .filter(s=>SC(s,se)!==null&&SC(s,se)>0)
  .sort((a,b)=>(SC(b,se)??-999)-(SC(a,se)??-999))
  .slice(0,10);
}
function leaderItem(s,se,i,preferTr=false){
 let ch=SC(s,se),p=SP(s,se),vol=SV(s,se),avg=N(s.avgVolume);
 return '<div class="leader-item stock-open-row"'+stockOpenAttrs(s,'',preferTr)+' title="#'+(i+1)+' · '+E(s.name||s.ticker)+'"><div class="leader-top"><div class="leader-symbol">'+favButton(s)+'<div class="ticker-stack">'+tickerDisplay(s,preferTr)+'</div></div>'+liveChangeHtml(s,ch,preferTr)+'</div><div class="leader-body">'+bidAskHtml(s,preferTr)+'<div class="leader-price">'+pricePair(s,p,preferTr)+'</div><div class="leader-volume" title="Volumen actual / volumen medio diario">Vol '+compactVol(vol)+' / '+compactVol(avg)+'</div></div></div>';
}
function leadersPinned(){
 try{return localStorage.getItem(LEADERS_PIN_KEY)==='1'}catch(_){return false}
}
let leadersHideTimer=null;
function setLeadersPinned(on){
 try{localStorage.setItem(LEADERS_PIN_KEY,on?'1':'0')}catch(_){}
 document.body.classList.toggle('leaders-pinned',on);
 if(on)document.body.classList.add('leaders-open');
 else document.body.classList.remove('leaders-open');
 let b=$('#leadersPin');
 if(b){
  b.classList.toggle('active',on);
  b.setAttribute('aria-pressed',on?'true':'false');
  b.title=on?'Quitar barra fija':'Dejar esta barra fija';
 }
}
function showLeadersDock(){
 clearTimeout(leadersHideTimer);
 document.body.classList.add('leaders-open');
}
function hideLeadersDockSoon(){
 if(document.body.classList.contains('leaders-pinned'))return;
 clearTimeout(leadersHideTimer);
 leadersHideTimer=setTimeout(()=>document.body.classList.remove('leaders-open'),420);
}
function initLeadersDock(){
 let dock=$('#marketLeaders'),hot=$('#leadersHotzone'),pin=$('#leadersPin');
 if(!dock||!hot||!pin)return;
 setLeadersPinned(leadersPinned());
 hot.addEventListener('mouseenter',showLeadersDock);
 dock.addEventListener('mouseenter',showLeadersDock);
 dock.addEventListener('mouseleave',hideLeadersDockSoon);
 hot.addEventListener('click',showLeadersDock);
 dock.addEventListener('focusin',showLeadersDock);
 dock.addEventListener('focusout',hideLeadersDockSoon);
 pin.addEventListener('click',e=>{
  e.stopPropagation();
  setLeadersPinned(!document.body.classList.contains('leaders-pinned'));
 });
 document.addEventListener('mousemove',e=>{
  if(document.body.classList.contains('leaders-pinned'))return;
  if(window.innerHeight-e.clientY<=12)showLeadersDock();
 });
}
function renderMarketLeaders(){
 let se=currentMarketSession(),label=sessionStageLabel(se)+' · TOP 10 SUBIDAS';
 let us=$('#leadersUS'),tr=$('#leadersTR');
 if($('#leadersSessionUS'))$('#leadersSessionUS').textContent=label;
 if($('#leadersSessionTR'))$('#leadersSessionTR').textContent=label;
 if(us){
  let a=topGainers('us',se);
  us.innerHTML=a.length?a.map((s,i)=>leaderItem(s,se,i,false)).join(''):'<span class="leader-loading">Sin subidas disponibles</span>';
 }
 if(tr){
  let a=topGainers('tr',se);
  tr.innerHTML=a.length?a.map((s,i)=>leaderItem(s,se,i,true)).join(''):'<span class="leader-loading">Sin subidas disponibles</span>';
 }
}
function renderFavorites(){
 let box=$('#favoritesList'),count=$('#favoritesCount');
 if(!box||!count)return;
 let se=currentMarketSession(),stocks=[...favorites].map(k=>db.stocks.find(s=>stockKey(s)===k)).filter(Boolean);
 count.textContent=stocks.length;
 if(!stocks.length){
  box.innerHTML='<div class="favorites-empty"><span aria-hidden="true">☆</span><p>Pulsa la estrella de cualquier acción para guardarla aquí.</p></div>';
  return;
 }
 box.innerHTML=stocks.map(s=>{
  let ch=SC(s,se),p=SP(s,se),v=SV(s,se),avg=N(s.avgVolume),key=stockKey(s);
  return '<div class="favorite-row stock-open-row"'+stockOpenAttrs(s,'',!!s.tradeRepublicVerified)+'><button type="button" class="fav-star active mini" data-fav-key="'+E(key)+'" title="Quitar de favoritos" aria-label="Quitar de favoritos">★</button><div class="favorite-link" title="'+E(s.name||s.ticker)+'"><div class="favorite-main"><div class="ticker-stack">'+tickerDisplay(s,!!s.tradeRepublicVerified)+'</div>'+pricePair(s,p,!!s.tradeRepublicVerified)+'</div>'+bidAskHtml(s,!!s.tradeRepublicVerified)+'<div class="favorite-stats">'+liveChangeHtml(s,ch,!!s.tradeRepublicVerified)+'<small>Vol '+compactVol(v)+' / '+compactVol(avg)+'</small></div></div></div>';
 }).join('');
}
function links(s){
 let raw=String(s.ticker||'').toUpperCase(),t=encodeURIComponent(raw),tv=encodeURIComponent(String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+raw)).replace(':','-'));
 return '<div class="external-links"><span class="external-links-label">Contrastar / ampliar:</span>'+
  '<a target="_blank" rel="noopener" href="https://www.tradingview.com/symbols/'+tv+'/">TradingView ↗</a>'+
  '<a target="_blank" rel="noopener" href="https://www.investing.com/search/?q='+t+'">Investing ↗</a>'+
  '<a target="_blank" rel="noopener" href="https://www.nasdaq.com/market-activity/stocks/'+encodeURIComponent(raw.toLowerCase())+'">Nasdaq ↗</a>'+
  '<a target="_blank" rel="noopener" href="https://stockmarketwatch.com/stock/'+t+'">StockMarketWatch ↗</a>'+
  '<a target="_blank" rel="noopener" href="https://stocktwits.com/symbol/'+t+'">StockTwits ↗</a></div>';
}
let liveChartTimer=null;
function miniChart(s,preferTr=false){
 let useTr=preferTr&&s&&s.tradeRepublicVerified;
 let source=useTr?'Trade Republic / '+(s.trExchange||'LSX'):'Nasdaq';
 return '<div class="mini-chart-block live-chart-block"><div class="mini-chart-title"><span>Intradiario · 1 min · mismo feed que el precio mostrado</span><span class="live-chart-source">'+E(source)+'</span></div><div class="mini-chart live-market-chart" data-stock-key="'+E(stockKey(s))+'" data-prefer-tr="'+(useTr?'1':'0')+'"><div class="chart-placeholder">Cargando histórico intradía…</div></div></div>';
}
function chartNumber(v){v=Number(v);return Number.isFinite(v)?v:null}
function chartQuote(s,preferTr){
 if(!s)return null;
 if(preferTr){
  let price=trLivePrice(s),time=N(s.trLiveLastAt)??N(s.trLiveReceivedAt);
  if(price===null)return null;
  return{price,time:time||Date.now(),receivedAt:N(s.trLiveReceivedAt)||Date.now(),label:'TR / '+(s.trExchange||'LSX'),realtime:true};
 }
 let price=usLivePrice(s),time=N(s.usLiveReceivedAt);
 if(price===null)return null;
 return{price,time:time||Date.now(),receivedAt:N(s.usLiveReceivedAt)||Date.now(),label:'Nasdaq',realtime:!!s.usLiveIsRealTime};
}
function chartFormatPrice(v,preferTr){
 v=chartNumber(v);if(v===null)return '—';
 return (preferTr?'€':'$')+v.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:v<1?6:v<10?4:2});
}
function chartFormatTime(ms){
 let d=new Date(ms);
 if(!Number.isFinite(d.getTime()))return '—';
 return new Intl.DateTimeFormat('es-ES',{hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
}
function chartCleanPoints(points){
 let out=[],lastTime=null;
 for(let p of (points||[])){
  let time=chartNumber(p.time),price=chartNumber(p.price??p.close);
  if(time===null||price===null||price<=0)continue;
  if(time<1e12)time*=1000;
  if(lastTime===time&&out.length){out[out.length-1]={time,price};continue}
  out.push({time,price});lastTime=time;
 }
 out.sort((a,b)=>a.time-b.time);
 return out.slice(-900);
}
function chartSvgText(x,y,value,cls,anchor='start'){
 return '<text x="'+x+'" y="'+y+'" class="'+cls+'" text-anchor="'+anchor+'">'+E(value)+'</text>';
}
function drawLiveChart(el){
 if(!el||!el._chartReady)return;
 let s=stockByKey(el._chartKey),preferTr=!!el._chartPreferTr;
 let points=(el._chartPoints||[]).slice(),q=chartQuote(s,preferTr);
 if(q){
  let last=points[points.length-1];
  if(!last||q.time>last.time)points.push({time:q.time,price:q.price,live:true});
  else if(last)points[points.length-1]={time:last.time,price:q.price,live:true};
 }
 points=chartCleanPoints(points);
 let status=el.querySelector('.live-chart-status'),svg=el.querySelector('svg');
 if(!svg||!status)return;
 let now=Date.now(),age=q?Math.max(0,now-(q.receivedAt||q.time||now)):null;
 if(q){
  let freshness=age<10000?'EN DIRECTO':age<60000?'ACTUALIZANDO':'DATO ANTIGUO';
  status.innerHTML='<span><b>'+E(q.label)+'</b> · '+E(freshness)+'</span><span>'+E(chartFormatPrice(q.price,preferTr))+' · '+E(chartFormatTime(q.time))+(age!==null?' · hace '+Math.max(0,Math.round(age/1000))+' s':'')+'</span>';
  status.classList.toggle('stale',age>=60000);
 }else{
  status.innerHTML='<span><b>'+(preferTr?'Trade Republic':'Nasdaq')+'</b> · esperando cotización actual</span>';
  status.classList.add('stale');
 }
 if(points.length<2){
  svg.innerHTML=chartSvgText(500,170,'Esperando suficientes datos para dibujar el gráfico','chart-empty','middle');
  return;
 }
 let rect=svg.getBoundingClientRect(),w=Math.max(300,Math.round(rect.width||1000)),h=Math.max(190,Math.round(rect.height||340));
 svg.setAttribute('viewBox','0 0 '+w+' '+h);
 let compact=w<560,left=compact?48:66,right=compact?68:88,top=18,bottom=34,plotW=w-left-right,plotH=h-top-bottom;
 let prices=points.map(p=>p.price),min=Math.min(...prices),max=Math.max(...prices);
 let span=max-min,pad=span>0?span*.08:Math.max(Math.abs(max)*.005,.01);min-=pad;max+=pad;span=max-min||1;
 let minT=points[0].time,maxT=points[points.length-1].time;if(maxT<=minT)maxT=minT+60000;
 let X=t=>left+(t-minT)/(maxT-minT)*plotW,Y=p=>top+(max-p)/span*plotH;
 let grid='',labels='';
 for(let i=0;i<5;i++){
  let f=i/4,y=top+f*plotH,val=max-f*span;
  grid+='<line x1="'+left+'" y1="'+y.toFixed(1)+'" x2="'+(w-right)+'" y2="'+y.toFixed(1)+'" class="chart-grid-line"/>';
  labels+=chartSvgText(w-right+8,y+4,chartFormatPrice(val,preferTr),'chart-axis-label');
 }
 for(let i=0;i<5;i++){
  let f=i/4,x=left+f*plotW,t=minT+f*(maxT-minT);
  grid+='<line x1="'+x.toFixed(1)+'" y1="'+top+'" x2="'+x.toFixed(1)+'" y2="'+(h-bottom)+'" class="chart-grid-line vertical"/>';
  labels+=chartSvgText(x,h-10,chartFormatTime(t),'chart-axis-label','middle');
 }
 let path=points.map((p,i)=>(i?'L':'M')+X(p.time).toFixed(2)+' '+Y(p.price).toFixed(2)).join(' ');
 let first=points[0].price,last=points[points.length-1].price,up=last>=first;
 let area=path+' L '+X(points[points.length-1].time).toFixed(2)+' '+(h-bottom)+' L '+X(points[0].time).toFixed(2)+' '+(h-bottom)+' Z';
 let lastX=X(points[points.length-1].time),lastY=Y(last);
 let hi=Math.max(...prices),lo=Math.min(...prices);
 svg.innerHTML=
  '<defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" class="chart-fill-start"/><stop offset="100%" class="chart-fill-end"/></linearGradient></defs>'+
  grid+
  '<path d="'+area+'" class="chart-area"/>'+
  '<path d="'+path+'" class="chart-line '+(up?'up':'down')+'"/>'+
  '<line x1="'+left+'" y1="'+lastY.toFixed(2)+'" x2="'+(w-right)+'" y2="'+lastY.toFixed(2)+'" class="chart-last-line"/>'+
  '<circle cx="'+lastX.toFixed(2)+'" cy="'+lastY.toFixed(2)+'" r="5" class="chart-live-dot '+(up?'up':'down')+'"/>'+
  labels+
  chartSvgText(left,14,'Máx '+chartFormatPrice(hi,preferTr)+' · Mín '+chartFormatPrice(lo,preferTr),'chart-range-label');
}
async function loadMiniChart(el){
 if(!el||el.dataset.loaded==='1')return;
 let key=el.dataset.stockKey,s=stockByKey(key);if(!s)return;
 let preferTr=el.dataset.preferTr==='1'&&!!s.tradeRepublicVerified;
 el.dataset.loaded='1';el._chartKey=key;el._chartPreferTr=preferTr;
 el.innerHTML='<div class="live-chart-status"><span>Cargando histórico…</span></div><svg class="live-chart-svg" preserveAspectRatio="none" role="img" aria-label="Gráfico intradía en tiempo real"></svg>';
 try{
  let url=preferTr
   ?'/api/tr-history?isin='+encodeURIComponent(trIsin(s))+'&exchange='+encodeURIComponent(s.trExchange||'LSX')+'&range=1d&resolution=60000'
   :'/api/us-chart?symbol='+encodeURIComponent(s.ticker||'');
  let r=await fetch(url,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
  if(!r.ok)throw Error('HTTP '+r.status);
  let j=await r.json();
  if(j.error)throw Error(j.error);
  el._chartPoints=chartCleanPoints(j.points||[]);
  el._chartSource=j.source||'';
 }catch(err){
  console.warn('live chart history warning',err);
  el._chartPoints=[];
  let st=el.querySelector('.live-chart-status');if(st)st.innerHTML='<span>Histórico no disponible; mostrando cotización actual en directo</span>';
 }
 el._chartReady=true;
 drawLiveChart(el);
 if(!liveChartTimer)liveChartTimer=setInterval(refreshLiveCharts,1000);
}
function refreshLiveCharts(){
 document.querySelectorAll('.live-market-chart[data-loaded="1"]').forEach(el=>{
  if(!el.isConnected||el.offsetParent===null)return;
  drawLiveChart(el);
 });
}
function metric(label,main,sub,help,mainClass='',subClass=''){
 return '<div class="metric-help" title="'+E(help)+'"><small>'+E(label)+' <span class="info-dot">ⓘ</span></small><b class="'+E(mainClass)+'">'+main+'</b><span class="'+E(subClass)+'">'+sub+'</span></div>';
}
function rankingWhy(s,next,se,q,pos){
 let a=FC(s,se),b=next?FC(next,se):null;
 return 'Puesto #'+pos+' por variación porcentual en '+SN(se)+': '+PC(a)+(next?' frente a '+PC(b)+' de #'+(pos+1)+' '+E(next.ticker)+'.':'.')+' El orden se actualiza automáticamente con las cotizaciones.';
}
function why(s,se){let b=[],c=FC(s,se),r=RV(s,se);if(c!==null)b.push(SN(se)+' '+PC(c));if(r!==null)b.push('vol. relativo '+F(r,2)+'×');if(N(s.adx)!==null)b.push('ADX '+F(s.adx,1));if(N(s.rsi)!==null)b.push('RSI '+F(s.rsi,1));if(trend(s))b.push('tendencia compatible');return b.join(' · ')||'Cumple el criterio activo con los datos disponibles.'}
function entryChangeHtml(s,se){
 let v=FC(s,se),live=se==='regular'&&usLiveChange(s)!==null;
 return '<span class="quote-change '+C(v)+'"'+(live?' data-us-live-change-key="'+E(stockKey(s))+'"':'')+'>'+PC(v)+'</span>';
}
function card(s,i,se=SES(),dense=false,rankText='',preferTr=false){
 let ch=FC(s,se),p=SP(s,se),hint=rankText||why(s,se);
 return '<article class="stock-card '+(dense?'dense-card':'')+'"><div class="stock-main stock-open-row"'+stockOpenAttrs(s,hint,preferTr)+' title="'+E(hint)+'"><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,preferTr)+'</div><span class="stock-name">'+E(s.name||'')+'</span></div></div><div class="stock-quick">'+bidAskHtml(s,preferTr)+pricePair(s,p,preferTr)+entryChangeHtml(s,se)+(s.tradeRepublicVerified?'<span class="pill ok">TR</span>':'')+'<span class="open-arrow">→</span></div></div></article>';
}
function market(s,m){let ex=String(s.exchange||'').toUpperCase();return m==='tr'?!!s.tradeRepublicVerified:m==='us'?['NASDAQ','NYSE','AMEX','NYSE ARCA','NYSEARCA'].includes(ex):true}
function numInput(id,fallback,min=-Infinity,max=Infinity){let v=N($('#'+id).value);if(v===null)v=fallback;return Math.max(min,Math.min(max,v))}
function fromUI(){
 let minChange=numInput('minChange',0,-100,100000),maxChange=numInput('maxChange',0,0,100000);
 let minRsi=numInput('minRsi',0,0,100),maxRsi=numInput('maxRsi',100,0,100);
 if(maxChange>0&&maxChange<minChange)maxChange=minChange;
 if(maxRsi<minRsi)maxRsi=minRsi;
 return{minChange,maxChange,minRelVolume:numInput('minRelVolume',0,0,100000),minAdx:numInput('minAdx',0,0,100),
  minRsi,maxRsi,minVolume:numInput('minVolume',0,0,1e15),trend:$('#requireTrend').checked,
  illiquid:$('#excludeIlliquid').checked,sort:state.filters.sort};
}
function lockCriterion(id,locked=true){let input=$('#'+id),btn=$('.field-lock[data-target="'+id+'"]');if(!input||!btn)return;input.readOnly=locked;btn.classList.toggle('unlocked',!locked);btn.textContent=locked?'🔒':'🔓';btn.title=locked?'Desbloquear este parámetro':'Bloquear este parámetro';btn.setAttribute('aria-label',locked?'Desbloquear '+id:'Bloquear '+id)}
function lockAllCriteria(){['minChange','maxChange','minRelVolume','minAdx','minRsi','maxRsi','minVolume'].forEach(id=>lockCriterion(id,true))}
function toUI(x){['minChange','maxChange','minRelVolume','minAdx','minRsi','maxRsi','minVolume'].forEach(k=>$('#'+k).value=x[k]);$('#requireTrend').checked=!!x.trend;$('#excludeIlliquid').checked=!!x.illiquid}
function entryUniverseMatch(s){
 if(state.entryMarket==='tr')return !!s.tradeRepublicVerified;
 // “Resto EEUU” means US-listed stocks that are not already in the verified TR set.
 return market(s,'us')&&!s.tradeRepublicVerified;
}
function entry(){
 let q=state.filters,se=q.sort==='afterhours'?'postmarket':SES(),preferTr=state.entryMarket==='tr';
 let a=db.stocks.filter(entryUniverseMatch).filter(s=>{
  let ch=FC(s,se);if(ch===null||ch<q.minChange)return false;if(q.maxChange>0&&ch>q.maxChange)return false;

  let rv=RV(s,se);if(q.minRelVolume>0&&(rv===null||rv<q.minRelVolume))return false;
  let adx=N(s.adx);if(q.minAdx>0&&(adx===null||adx<q.minAdx))return false;

  let rsi=N(s.rsi);
  if((q.minRsi>0||q.maxRsi<100)&&(rsi===null||rsi<q.minRsi||rsi>q.maxRsi))return false;

  let v=SV(s,se);if(q.minVolume>0&&(v===null||v<q.minVolume))return false;

  if(q.trend&&trendState(s)!==true)return false;
  if(q.illiquid&&lowLiquidity(s,se,preferTr))return false;
  return true;
 });
 // Potencial de entrada is always ranked by the percentage currently shown
 // in the selected session. Technical criteria decide eligibility, never rank.
 a.sort((x,y)=>{
  let ax=FC(x,se),by=FC(y,se),av=ax===null?-Infinity:ax,bv=by===null?-Infinity:by;
  if(bv!==av)return bv-av;
  return String(x.ticker||'').localeCompare(String(y.ticker||''));
 });
 return[a,se];
}
function renderEntry(){let [a,se]=entry();$('#entrySessionText').textContent=(state.entryMarket==='tr'?'Trade Republic':'Resto EEUU')+' · '+SN(se);$('#entryCount').textContent=a.length+' candidatas';$('#entryUpdated').textContent=db.meta.updatedAt?'datos '+new Date(db.meta.updatedAt).toLocaleString('es-ES'):'sin actualización';$('#entryTag').textContent=state.filters.sort==='afterhours'?'SUBIDAS POSTMARKET':state.filters.sort==='change'?'EXPLOSIÓN EN SESIÓN':se==='premarket'?'IMPULSO PREMARKET':'SEGUIMIENTO';$('#entryLead').textContent=state.filters.sort==='afterhours'
 ?'Orden automático por mayor variación porcentual en postmarket; la posición cambia al actualizarse las cotizaciones.'
 :'Orden automático por mayor variación porcentual de '+SN(se).toLowerCase()+'. Los filtros deciden qué acciones aparecen; el porcentaje decide siempre su posición.';let shown=a.slice(0,150);$('#entryResults').innerHTML=shown.length?shown.map((s,i)=>card(s,i,se,false,rankingWhy(s,shown[i+1],se,state.filters,i+1),state.entryMarket==='tr')).join(''):'<div class="empty-state">No hay candidatas con este criterio y sesión. Prueba otro preset o abre Configurar criterio para ver los umbrales activos.</div>'}
function ET(t){return({news:'Noticia relevante',medical:'Clínico / FDA',earnings:'Resultados',contract:'Contrato / acuerdo',corporate:'Operación corporativa',financing:'Financiación / dilución',analyst:'Analistas / rating',event:'Evento / conferencia',regulatory:'Regulatorio / legal',other:'Otro catalizador'})[t]||'Catalizador'}
function EL(e){let t=String(e.title||e.fact||'').toLowerCase();if(e.type==='earnings')return 'Resultados trimestrales';if(e.type==='medical'){let m=t.match(/phase\s*([123])/i);if(m)return 'Estudio clínico Fase '+m[1];if(/pdufa/.test(t))return 'PDUFA / FDA';if(/fda|approval|approved/.test(t))return 'Decisión FDA';if(/trial|clinical|study|endpoint|topline/.test(t))return 'Resultados clínicos';return 'Clínico / sanitario'}if(e.type==='financing'){if(/offering|registered direct|private placement/.test(t))return 'Oferta / ampliación';if(/warrant/.test(t))return 'Warrants';if(/convertible/.test(t))return 'Convertibles';return 'Financiación / dilución'}if(e.type==='contract')return /award|order|contract/.test(t)?'Contrato / adjudicación':'Acuerdo / alianza';if(e.type==='corporate'){if(/merger|acquisition|acquire|takeover|buyout/.test(t))return 'Fusión / adquisición';if(/reverse split/.test(t))return 'Reverse split';if(/stock split/.test(t))return 'Split';return 'Operación corporativa'}if(e.type==='analyst')return /upgrade/.test(t)?'Upgrade analista':/downgrade/.test(t)?'Downgrade analista':'Rating / precio objetivo';if(e.type==='regulatory')return 'Regulatorio / legal';if(e.type==='event')return 'Evento / conferencia';return ET(e.type)}
function EU(e){let u=String(e.url||'');return /^https?:\/\//i.test(u)?'<a class="event-link" target="_blank" rel="noopener" href="'+E(u)+'">Abrir noticia / fuente ↗</a>':''}
function eventTime(e){
 let d=e&&e.date?new Date(e.date):null;
 if(d&&!isNaN(d)){
  let parts=new Intl.DateTimeFormat('es-ES',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(d);
  let p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  let utcH=d.getUTCHours(),utcM=d.getUTCMinutes(),utcS=d.getUTCSeconds();
  if(e.eventKind==='news'||utcH||utcM||utcS)return p.hour+':'+p.minute+' NY';
 }
 let code=N(e&&e.timeCode);
 if(code!==null&&code>60&&code<86400){
  let h=Math.floor(code/3600),m=Math.floor((code%3600)/60);
  if(h>=0&&h<24)return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+' NY';
 }
 return '';
}
function eventWhen(e){let t=eventTime(e);return DF(e.date)+(t?' · '+t:'')}
function eventSources(e){
 let src=Array.isArray(e.sources)&&e.sources.length?e.sources:(e.source?[{name:e.source,url:e.url}]:[]);
 if(!src.length)return '';
 let linksHtml=src.map(s=>{let name=E(s.name||'Fuente'),u=String(s.url||'');return /^https?:\/\//i.test(u)?'<a target="_blank" rel="noopener" href="'+E(u)+'">'+name+' ↗</a>':'<span>'+name+'</span>'}).join('');
 return '<div class="event-sources"><span class="verification">'+E(e.verification||'Fuente validada')+'</span>'+linksHtml+'</div>';
}
function eventItem(e){
 let kind=e.eventKind==='news'?'Noticia':'Evento previsto',label=EL(e);
 return '<div class="event-item"><div class="event-item-head"><div><strong>'+E(label)+'</strong><span>'+E(kind)+'</span></div><time>'+E(eventWhen(e))+'</time></div><div class="event-title">'+E(e.title||e.fact||'Catalizador detectado')+'</div>'+(e.fact&&e.fact!==e.title?'<div class="event-context">'+E(e.fact)+'</div>':'')+'<div class="event-impact"><strong>Por qué importa:</strong> '+E(e.hypothesis||'Puede aumentar la volatilidad; no implica una dirección concreta.')+'</div>'+eventSources(e)+'</div>';
}
function futureWindowEvent(e,h,now){
 let d=new Date(e.date).getTime();
 if(!Number.isFinite(d))return false;
 let end=now+h*864e5;
 if(e.eventKind==='news'){
  let today=new Date();today.setHours(0,0,0,0);
  return d>=today.getTime()&&d<=now+3600e3;
 }
 return d>=now-3600e3&&d<=end;
}
function groupFutureEvents(events){
 let map=new Map();
 for(let e of events){
  let key=(e.exchange||'')+':'+(e.ticker||'');
  if(!map.has(key))map.set(key,[]);
  map.get(key).push(e);
 }
 return [...map.entries()].map(([key,items])=>{
  items.sort((a,b)=>new Date(a.date)-new Date(b.date)||((b.impactScore||0)-(a.impactScore||0)));
  return {key,items,first:items[0],maxImpact:Math.max(...items.map(x=>N(x.impactScore)||0))};
 }).sort((a,b)=>new Date(a.first.date)-new Date(b.first.date)||b.maxImpact-a.maxImpact);
}


function stockEvents(s){
 return (db.events||[]).filter(e=>{
  if(s.isin&&e.isin&&String(e.isin)===String(s.isin))return true;
  if(s.trIsin&&e.isin&&String(e.isin)===String(s.trIsin))return true;
  return e.ticker===s.ticker&&(!e.exchange||String(e.exchange)===String(s.exchange));
 });
}
function profileKpi(label,main,sub=''){
 return '<div class="profile-kpi"><small>'+E(label)+'</small><strong>'+main+'</strong>'+(sub?'<span>'+sub+'</span>':'')+'</div>';
}
function profileIdentity(label,value,extra=''){
 return '<div class="profile-identity"><small>'+E(label)+'</small><strong>'+E(value||'—')+'</strong>'+(extra?'<span>'+E(extra)+'</span>':'')+'</div>';
}
function quickProfileHtml(s){
 let isTr=state.profilePreferTr===true&&!!s.tradeRepublicVerified,se=currentMarketSession();
 let title=isTr?(s.trTicker||s.ticker):s.ticker;
 let marketTitle=isTr?'Trade Republic / '+(s.trExchange||'LSX'):(s.exchange||'EEUU');
 let origin=state.profileOriginView||state.currentView,back='← Volver a '+viewLabel(origin);
 let currentPrice=pricePair(s,SP(s,se),isTr),currentChange=liveChangeHtml(s,SC(s,se),isTr);
 let liveLabel=isTr?'LSX · TIEMPO REAL':'EEUU · '+(s.usLiveIsRealTime?'NASDAQ ACTUAL':'ÚLTIMO DATO');
 let events=stockEvents(s),now=Date.now();
 let upcoming=events.filter(e=>e.eventKind!=='news'&&new Date(e.date).getTime()>=now-864e5).sort((x,y)=>new Date(x.date)-new Date(y.date)).slice(0,4);
 let news=events.filter(e=>e.eventKind==='news').sort((x,y)=>new Date(y.date)-new Date(x.date)).slice(0,4);
 let context=state.profileReason?'<div class="profile-context"><strong>Motivo de aparición:</strong> '+E(state.profileReason)+'</div>':'';
 let kpis=[
  profileKpi(isTr?'Precio LSX':'Precio EEUU',currentPrice,currentChange),
  profileKpi('BID / ASK',bidAskHtml(s,isTr),isTr?'Trade Republic / LSX':'Feed EEUU'),
  profileKpi('Volumen',compactVol(!isTr&&N(s.usLiveVolume)!==null?s.usLiveVolume:SV(s,se)),'Media '+compactVol(s.avgVolume)),
  profileKpi('Vol. relativo',RV(s,se)===null?'—':F(RV(s,se),2)+'×','Actividad frente a media'),
  profileKpi('RSI / ADX',F(s.rsi,1)+' / '+F(s.adx,1),'Momentum / fuerza'),
  profileKpi('EMA20 / EMA50',PR(s.ema20)+' / '+PR(s.ema50),'Estructura técnica'),
  profileKpi('1 semana / 1 mes',PC(s.perfWeek)+' / '+PC(s.perfMonth),'Rendimiento'),
  profileKpi('Resultados',s.earningsDate?DF(s.earningsDate):'—',s.earningsDate?(eventTime({date:s.earningsDate,timeCode:s.earningsTimeCode})||''):'Sin fecha cargada')
 ].join('');
 let catalystHtml=upcoming.length?upcoming.map(eventItem).join(''):'<div class="profile-empty">No hay eventos próximos fechados cargados.</div>';
 let newsHtml=news.length?news.map(eventItem).join(''):'<div class="profile-empty">No hay noticias recientes cargadas.</div>';
 let relation=isTr?'<div class="profile-data-note">Precio, BID y ASK: Trade Republic / '+E(s.trExchange||'LSX')+'. El gráfico y los técnicos usan la referencia de '+E((s.exchange||'EEUU')+':'+(s.ticker||''))+'.</div>':'';
 return '<div class="profile-toolbar"><button type="button" class="btn ghost quick-profile-back" data-stock-detail-back="1">'+E(back)+'</button><span>Vista rápida · '+E(viewLabel(origin))+'</span></div>'+
  '<div class="profile-hero"><div class="profile-title">'+favButton(s)+'<div><div class="profile-market">'+E(marketTitle)+'</div><h2>'+E(title||'—')+'</h2><p>'+E(s.name||'')+'</p></div></div><div class="profile-live"><small>'+E(liveLabel)+'</small>'+bidAskHtml(s,isTr)+pricePair(s,SP(s,se),isTr)+currentChange+'</div></div>'+
  relation+context+
  '<section class="profile-section profile-chart-section"><div class="profile-section-head"><h3>Gráfico</h3><span>1 minuto · mismo feed que el precio mostrado</span></div>'+miniChart(s,isTr)+'</section>'+
  '<section class="profile-section"><div class="profile-section-head"><h3>Resumen</h3><span>Datos esenciales</span></div><div class="profile-kpi-grid quick-kpi-grid">'+kpis+'</div></section>'+
  '<section class="profile-section quick-events"><div class="profile-section-head"><h3>Próximos catalizadores</h3><span>'+upcoming.length+'</span></div><div class="event-list profile-events">'+catalystHtml+'</div></section>'+
  '<section class="profile-section quick-events"><div class="profile-section-head"><h3>Noticias recientes</h3><span>'+news.length+'</span></div><div class="event-list profile-events">'+newsHtml+'</div></section>';
}
function renderQuickProfile(){
 let box=$('#stockQuickDetail');if(!box)return;
 let s=state.profileKey?stockByKey(state.profileKey):null;
 if(!s){closeQuickProfile(false);return}
 box.innerHTML=quickProfileHtml(s);
 requestAnimationFrame(()=>{box.querySelectorAll('.mini-chart').forEach(loadMiniChart);observeTrLivePrices(box);pollUsLive()});
}
function profileHtml(s,view){
 let isTr=view==='catalog',se=currentMarketSession();
 let title=isTr?(s.trTicker||'Ticker LSX pendiente'):s.ticker;
 let marketTitle=isTr?'Trade Republic / '+(s.trExchange||'LSX'):(s.exchange||'EEUU');
 let relatedUs=(s.exchange||'')+':'+(s.ticker||'');
 let events=stockEvents(s),now=Date.now();
 let upcoming=events.filter(e=>e.eventKind!=='news'&&new Date(e.date).getTime()>=now-864e5).sort((x,y)=>new Date(x.date)-new Date(y.date)).slice(0,20);
 let news=events.filter(e=>e.eventKind==='news').sort((x,y)=>new Date(y.date)-new Date(x.date)).slice(0,30);
 let relationBadge=s.instrumentLinkStatus==='same_isin'
  ?'<span class="relation-status ok">ISIN coincidente</span>'
  :s.instrumentLinkStatus==='different_isin'
   ?'<span class="relation-status warn">ISIN diferente</span>'
   :'<span class="relation-status pending">ISIN pendiente</span>';
 let trRelation=isTr
  ?'<div class="profile-relation"><span>Instrumento TR</span><strong>'+E((s.trExchange||'LSX')+':'+(s.trTicker||'pendiente'))+'</strong><span class="relation-arrow">↔</span><span>Cotización EEUU</span><strong>'+E(relatedUs)+'</strong>'+relationBadge+'</div>'
  :(s.tradeRepublicCandidate?'<div class="profile-relation"><span>Cotización EEUU</span><strong>'+E(relatedUs)+'</strong><span class="relation-arrow">↔</span><span>Trade Republic</span><strong>'+E((s.trExchange||'LSX')+':'+(s.trTicker||'pendiente'))+'</strong>'+relationBadge+'</div>':'');
 let trNote=isTr
  ?'<div class="profile-data-note">Precio principal, BID y ASK: LSX/Trade Republic en €. La referencia en USD se calcula con EUR/USD. Premarket, regular, postmarket y técnicos corresponden a '+E(relatedUs)+'.</div>'
  :'';
 let feedWarning=!isTr
  ?'<div class="profile-feed-warning '+(s.usLiveIsRealTime?'live':'')+'">'+(s.usLiveIsRealTime
    ?'Precio, BID, ASK y gráfico intradía usan datos de Nasdaq.com. El último punto del gráfico se actualiza con la misma cotización actual mostrada en la ficha.'
    :'El snapshot del screener EEUU está diferido ('+E(s.updateMode||'sin modo')+'). CatalystPulse intenta sustituir precio, BID y ASK por la cotización actual de Nasdaq.com para los valores visibles. Para igualdad exacta entre cabecera y gráfico ambos deben usar el mismo feed SIP.')+'</div>'
  :'';
 let context=state.profileReason?'<div class="profile-context"><strong>Por qué llegaste aquí:</strong> '+E(state.profileReason)+'</div>':'';
 let identity=[
  profileIdentity('Ticker Trade Republic / LSX',s.trTicker||'—',s.trExchange||'LSX'),
  profileIdentity('Ticker EEUU',s.ticker||'—',s.exchange||''),
  profileIdentity('ISIN Trade Republic',s.trIsin||'—'),
  profileIdentity('ISIN EEUU',s.usIsin||s.isin||'—'),
  profileIdentity('WKN',s.trWkn||'—'),
  profileIdentity('Nombre en TR / LSX',s.trNameAtExchange||s.name||'—')
 ].join('');
 let currentPrice=pricePair(s,SP(s,se),isTr),currentChange=liveChangeHtml(s,SC(s,se),isTr);
 let liveLabel=isTr?'LSX · TIEMPO REAL':'EEUU · '+(s.usLiveIsRealTime?'NASDAQ ACTUAL':'ÚLTIMO DATO');
 let kpis=[
  profileKpi(isTr?'LSX actual':'EEUU actual',currentPrice,currentChange),
  profileKpi('BID / ASK',bidAskHtml(s,isTr),isTr?'LSX':'Nasdaq / feed disponible'),
  profileKpi('Volumen actual',compactVol(!isTr&&N(s.usLiveVolume)!==null?s.usLiveVolume:SV(s,se)),'Vol. medio '+compactVol(s.avgVolume)),
  profileKpi('Premarket',snapshotPricePair(s,s.premarketPrice,isTr),'<span class="'+C(s.premarketChangePct)+'">'+PC(s.premarketChangePct)+'</span> · Vol '+compactVol(s.premarketVolume)),
  profileKpi('Regular',snapshotPricePair(s,s.price,isTr),'<span class="'+C(s.changePct)+'">'+PC(s.changePct)+'</span> · Vol '+compactVol(s.volume)),
  profileKpi('Postmarket',snapshotPricePair(s,s.postmarketPrice,isTr),'<span class="'+C(s.postmarketChangePct)+'">'+PC(s.postmarketChangePct)+'</span> · Vol '+compactVol(s.postmarketVolume)),
  profileKpi('RSI / ADX',F(s.rsi,1)+' / '+F(s.adx,1),'Momentum / fuerza de tendencia'),
  profileKpi('EMA20 / EMA50',PR(s.ema20)+' / '+PR(s.ema50),'Estructura técnica'),
  profileKpi('1 semana / 1 mes',PC(s.perfWeek)+' / '+PC(s.perfMonth),'Rendimiento'),
  profileKpi('Próximos resultados',s.earningsDate?DF(s.earningsDate):'—',s.earningsDate?(eventTime({date:s.earningsDate,timeCode:s.earningsTimeCode})||''):'')
 ].join('');
 let upHtml=upcoming.length?upcoming.map(eventItem).join(''):'<div class="profile-empty">No hay eventos futuros fechados cargados para este valor.</div>';
 let newsHtml=news.length?news.map(eventItem).join(''):'<div class="profile-empty">No hay noticias recientes cargadas para este valor.</div>';
 let updated=db.meta.updatedAt?new Date(db.meta.updatedAt).toLocaleString('es-ES'):'—';
 return '<div class="profile-toolbar"><button type="button" class="btn ghost profile-back" data-profile-back="'+E(view)+'">← Volver al catálogo</button><span>Snapshot base '+E(updated)+'</span></div>'+
  '<div class="profile-hero"><div class="profile-title">'+favButton(s)+'<div><div class="profile-market">'+E(marketTitle)+'</div><h2>'+E(title)+'</h2><p>'+E(s.name||'')+'</p></div></div><div class="profile-live"><small>'+E(liveLabel)+'</small>'+bidAskHtml(s,isTr)+pricePair(s,SP(s,se),isTr)+currentChange+'</div></div>'+
  trRelation+trNote+feedWarning+context+
  '<section class="profile-section profile-chart-section"><div class="profile-section-head"><h3>Gráfico</h3><span>1 minuto · mismo feed que el precio mostrado</span></div>'+miniChart(s,isTr)+'</section>'+
  '<section class="profile-section"><h3>Identificación y mercados</h3><div class="profile-identity-grid">'+identity+'</div></section>'+
  '<section class="profile-section"><h3>Mercado y técnicos</h3><div class="profile-kpi-grid">'+kpis+'</div></section>'+
  '<section class="profile-section"><div class="profile-section-head"><h3>Próximos eventos</h3><span>'+upcoming.length+' cargados</span></div><div class="event-list profile-events">'+upHtml+'</div></section>'+
  '<section class="profile-section"><div class="profile-section-head"><h3>Noticias y catalizadores</h3><span>'+news.length+' recientes</span></div><div class="event-list profile-events">'+newsHtml+'</div></section>'+
  '<section class="profile-section"><div class="profile-section-head"><h3>Contraste y fuentes</h3><span>Verificación externa del mismo valor</span></div><div class="source-note">Precio TR: LSX/Trade Republic. Precio EEUU actual: Nasdaq.com cuando está disponible. Gráfico: mismo feed de mercado que la cotización mostrada (Trade Republic/LSX o Nasdaq). Noticias y eventos: sus fuentes enlazadas.</div>'+links(s)+'</section>';
}
function renderProfileView(view){
 let isTr=view==='catalog',detail=$(isTr?'#catalogDetail':'#catalogUSDetail'),browse=$(isTr?'#catalogBrowse':'#catalogUSBrowse');
 if(!detail||!browse)return false;
 let s=state.profileKey?stockByKey(state.profileKey):null;
 let valid=s&&(isTr?!!s.tradeRepublicVerified:market(s,'us'));
 if(!valid){detail.classList.add('is-hidden');browse.classList.remove('is-hidden');return false}
 browse.classList.add('is-hidden');detail.classList.remove('is-hidden');detail.innerHTML=profileHtml(s,view);
 requestAnimationFrame(()=>{detail.querySelectorAll('.mini-chart').forEach(loadMiniChart);observeTrLivePrices(detail);pollUsLive()});
 return true;
}
const CATALOG_COLUMNS={
 tr:[
  {id:'fav',label:'★',type:'html',value:s=>favorites.has(stockKey(s))?1:0,cell:s=>favButton(s)},
  {id:'tickerTr',label:'Ticker TR',type:'text',value:s=>s.trTicker||'',cell:s=>'<strong class="table-ticker">'+E(s.trTicker||'—')+'</strong>'},
  {id:'tickerUs',label:'Ticker EEUU',type:'text',value:s=>s.ticker||'',cell:s=>'<span class="table-us-ticker">'+E(s.ticker||'—')+'</span>'},
  {id:'name',label:'Empresa',type:'text',value:s=>s.name||'',cell:s=>E(s.name||'—')},
  {id:'exchange',label:'Mercado',type:'text',value:s=>s.trExchange||'LSX',cell:s=>E(s.trExchange||'LSX')},
  {id:'priceEur',label:'Precio €',type:'number',value:(s,se)=>trPriceValues(s,SP(s,se)).eur,cell:(s,se)=>trPriceCell(s,'eur',se)},
  {id:'priceUsd',label:'Precio USD',type:'number',value:(s,se)=>trPriceValues(s,SP(s,se)).usd,cell:(s,se)=>trPriceCell(s,'usd',se)},
  {id:'change',label:'%',type:'number',value:(s,se)=>trLiveChange(s)??SC(s,se),cell:(s,se)=>liveChangeHtml(s,SC(s,se),true)},
  {id:'bid',label:'Bid €',type:'number',value:s=>N(s.trLiveBid),cell:s=>'<span class="table-live-number '+quoteDirClass(s.trLiveBidDirection)+'" data-tr-bid-key="'+E(stockKey(s))+'">'+quoteMoney(s.trLiveBid,'€',quotePrecision(s,true))+'</span>'},
  {id:'ask',label:'Ask €',type:'number',value:s=>N(s.trLiveAsk),cell:s=>'<span class="table-live-number '+quoteDirClass(s.trLiveAskDirection)+'" data-tr-ask-key="'+E(stockKey(s))+'">'+quoteMoney(s.trLiveAsk,'€',quotePrecision(s,true))+'</span>'},
  {id:'volume',label:'Vol. actual',type:'number',value:(s,se)=>SV(s,se),cell:(s,se)=>compactVol(SV(s,se))},
  {id:'avgVolume',label:'Vol. medio',type:'number',value:s=>N(s.avgVolume),cell:s=>compactVol(s.avgVolume)},
  {id:'relVolume',label:'Vol. rel.',type:'number',value:(s,se)=>RV(s,se),cell:(s,se)=>RV(s,se)===null?'—':F(RV(s,se),2)+'×'},
  {id:'premarketPrice',label:'Pre USD',type:'number',value:s=>N(s.premarketPrice),cell:s=>PR(s.premarketPrice)},
  {id:'premarketChange',label:'Pre %',type:'number',value:s=>N(s.premarketChangePct),cell:s=>PC(s.premarketChangePct)},
  {id:'premarketVolume',label:'Vol. pre',type:'number',value:s=>N(s.premarketVolume),cell:s=>compactVol(s.premarketVolume)},
  {id:'regularPrice',label:'Regular USD',type:'number',value:s=>N(s.price),cell:s=>PR(s.price)},
  {id:'regularChange',label:'Regular %',type:'number',value:s=>N(s.changePct),cell:s=>PC(s.changePct)},
  {id:'postmarketPrice',label:'Post USD',type:'number',value:s=>N(s.postmarketPrice),cell:s=>PR(s.postmarketPrice)},
  {id:'postmarketChange',label:'Post %',type:'number',value:s=>N(s.postmarketChangePct),cell:s=>PC(s.postmarketChangePct)},
  {id:'postmarketVolume',label:'Vol. post',type:'number',value:s=>N(s.postmarketVolume),cell:s=>compactVol(s.postmarketVolume)},
  {id:'rsi',label:'RSI',type:'number',value:s=>N(s.rsi),cell:s=>F(s.rsi,1)},
  {id:'adx',label:'ADX',type:'number',value:s=>N(s.adx),cell:s=>F(s.adx,1)},
  {id:'ema20',label:'EMA20',type:'number',value:s=>N(s.ema20),cell:s=>PR(s.ema20)},
  {id:'ema50',label:'EMA50',type:'number',value:s=>N(s.ema50),cell:s=>PR(s.ema50)},
  {id:'week',label:'1 sem.',type:'number',value:s=>N(s.perfWeek),cell:s=>PC(s.perfWeek)},
  {id:'month',label:'1 mes',type:'number',value:s=>N(s.perfMonth),cell:s=>PC(s.perfMonth)},
  {id:'wkn',label:'WKN',type:'text',value:s=>s.trWkn||'',cell:s=>E(s.trWkn||'—')},
  {id:'isin',label:'ISIN',type:'text',value:s=>s.trIsin||s.isin||'',cell:s=>E(s.trIsin||s.isin||'—')},
  {id:'feed',label:'Feed',type:'text',value:s=>s.trLiveQuality||'LSX',cell:s=>E(s.trLiveQuality||'LSX')},
  {id:'earnings',label:'Resultados',type:'date',value:s=>s.earningsDate?new Date(s.earningsDate).getTime():null,cell:s=>s.earningsDate?DF(s.earningsDate):'—'}
 ],
 us:[
  {id:'fav',label:'★',type:'html',value:s=>favorites.has(stockKey(s))?1:0,cell:s=>favButton(s)},
  {id:'ticker',label:'Ticker',type:'text',value:s=>s.ticker||'',cell:s=>'<strong class="table-ticker">'+E(s.ticker||'—')+'</strong>'},
  {id:'name',label:'Empresa',type:'text',value:s=>s.name||'',cell:s=>E(s.name||'—')},
  {id:'exchange',label:'Mercado',type:'text',value:s=>s.exchange||'',cell:s=>E(s.exchange||'—')},
  {id:'priceUsd',label:'Precio USD',type:'number',value:(s,se)=>usLivePrice(s)??SP(s,se),cell:(s,se)=>usPriceCell(s,'usd',se)},
  {id:'priceEur',label:'Precio €',type:'number',value:(s,se)=>usPriceValues(s,SP(s,se)).eur,cell:(s,se)=>usPriceCell(s,'eur',se)},
  {id:'change',label:'%',type:'number',value:(s,se)=>usLiveChange(s)??SC(s,se),cell:(s,se)=>liveChangeHtml(s,SC(s,se),false)},
  {id:'bid',label:'Bid USD',type:'number',value:s=>usLiveBid(s),cell:s=>'<span class="'+quoteDirClass(s.usLiveBidDirection)+'" data-us-bid-key="'+E(stockKey(s))+'">'+quoteMoney(usLiveBid(s),'\u0024',quotePrecision(s,false))+'</span>'},
  {id:'ask',label:'Ask USD',type:'number',value:s=>usLiveAsk(s),cell:s=>'<span class="'+quoteDirClass(s.usLiveAskDirection)+'" data-us-ask-key="'+E(stockKey(s))+'">'+quoteMoney(usLiveAsk(s),'\u0024',quotePrecision(s,false))+'</span>'},
  {id:'volume',label:'Vol. actual',type:'number',value:(s,se)=>N(s.usLiveVolume)??SV(s,se),cell:(s,se)=>compactVol(N(s.usLiveVolume)??SV(s,se))},
  {id:'avgVolume',label:'Vol. medio',type:'number',value:s=>N(s.avgVolume),cell:s=>compactVol(s.avgVolume)},
  {id:'relVolume',label:'Vol. rel.',type:'number',value:(s,se)=>RV(s,se),cell:(s,se)=>RV(s,se)===null?'—':F(RV(s,se),2)+'×'},
  {id:'premarketPrice',label:'Pre USD',type:'number',value:s=>N(s.premarketPrice),cell:s=>PR(s.premarketPrice)},
  {id:'premarketChange',label:'Pre %',type:'number',value:s=>N(s.premarketChangePct),cell:s=>'<span class="'+C(s.premarketChangePct)+'">'+PC(s.premarketChangePct)+'</span>'},
  {id:'premarketVolume',label:'Vol. pre',type:'number',value:s=>N(s.premarketVolume),cell:s=>compactVol(s.premarketVolume)},
  {id:'regularPrice',label:'Regular USD',type:'number',value:s=>N(s.price),cell:s=>PR(s.price)},
  {id:'regularChange',label:'Regular %',type:'number',value:s=>N(s.changePct),cell:s=>'<span class="'+C(s.changePct)+'">'+PC(s.changePct)+'</span>'},
  {id:'postmarketPrice',label:'Post USD',type:'number',value:s=>N(s.postmarketPrice),cell:s=>PR(s.postmarketPrice)},
  {id:'postmarketChange',label:'Post %',type:'number',value:s=>N(s.postmarketChangePct),cell:s=>'<span class="'+C(s.postmarketChangePct)+'">'+PC(s.postmarketChangePct)+'</span>'},
  {id:'postmarketVolume',label:'Vol. post',type:'number',value:s=>N(s.postmarketVolume),cell:s=>compactVol(s.postmarketVolume)},
  {id:'rsi',label:'RSI',type:'number',value:s=>N(s.rsi),cell:s=>F(s.rsi,1)},
  {id:'adx',label:'ADX',type:'number',value:s=>N(s.adx),cell:s=>F(s.adx,1)},
  {id:'ema20',label:'EMA20',type:'number',value:s=>N(s.ema20),cell:s=>PR(s.ema20)},
  {id:'ema50',label:'EMA50',type:'number',value:s=>N(s.ema50),cell:s=>PR(s.ema50)},
  {id:'week',label:'1 sem.',type:'number',value:s=>N(s.perfWeek),cell:s=>'<span class="'+C(s.perfWeek)+'">'+PC(s.perfWeek)+'</span>'},
  {id:'month',label:'1 mes',type:'number',value:s=>N(s.perfMonth),cell:s=>'<span class="'+C(s.perfMonth)+'">'+PC(s.perfMonth)+'</span>'},
  {id:'tr',label:'Trade Republic',type:'text',value:s=>s.tradeRepublicVerified?'sí':'no',cell:s=>s.tradeRepublicVerified?'<span class="pill ok">'+E(s.trTicker||'TR')+'</span>':'—'},
  {id:'isin',label:'ISIN',type:'text',value:s=>s.usIsin||s.isin||'',cell:s=>E(s.usIsin||s.isin||'—')},
  {id:'feed',label:'Feed',type:'text',value:s=>s.usLiveIsRealTime?'Nasdaq realtime':(s.updateMode||''),cell:s=>'<span class="'+(s.usLiveIsRealTime?'feed-live':'feed-delayed')+'">'+E(s.usLiveIsRealTime?'Nasdaq realtime':(s.updateMode||'—'))+'</span>'},
  {id:'updated',label:'Último dato',type:'text',value:s=>s.usLiveTimestamp||s.lastBarUpdateTime||'',cell:s=>E(s.usLiveTimestamp||'—')},
  {id:'earnings',label:'Resultados',type:'date',value:s=>s.earningsDate?new Date(s.earningsDate).getTime():null,cell:s=>s.earningsDate?DF(s.earningsDate):'—'}
 ]
};
const catalogState={tr:{sort:'tickerTr',dir:1,filters:{},order:null},us:{sort:'ticker',dir:1,filters:{},order:null}};
function catalogStorageKey(mode){return 'catalystpulse:catalogColumns:'+mode+':v1'}
function catalogLoadOrder(mode){
 if(catalogState[mode].order)return catalogState[mode].order;
 let ids=CATALOG_COLUMNS[mode].map(c=>c.id),saved=[];
 try{saved=JSON.parse(localStorage.getItem(catalogStorageKey(mode))||'[]')}catch(_){}
 saved=Array.isArray(saved)?saved.filter(x=>ids.includes(x)):[];
 catalogState[mode].order=[...saved,...ids.filter(x=>!saved.includes(x))];
 return catalogState[mode].order;
}
function catalogSaveOrder(mode){try{localStorage.setItem(catalogStorageKey(mode),JSON.stringify(catalogState[mode].order||[]))}catch(_){}}
function catalogColumns(mode){let map=new Map(CATALOG_COLUMNS[mode].map(c=>[c.id,c]));return catalogLoadOrder(mode).map(id=>map.get(id)).filter(Boolean)}
function catalogSession(mode){let id=mode==='tr'?'#catalogSession':'#catalogUSSession',v=$(id)?.value||'auto';return v==='auto'?currentMarketSession():v}
function catalogFilterMatch(value,filter,type){
 filter=String(filter||'').trim();if(!filter)return true;
 if(type==='number'){
  let n=N(value);if(n===null)return false;
  let m=filter.match(/^\s*(>=|<=|>|<|=)?\s*(-?\d+(?:[.,]\d+)?)\s*$/);
  if(!m)return false;
  let target=Number(m[2].replace(',','.')),op=m[1]||'=';
  if(op==='>')return n>target;if(op==='<')return n<target;if(op==='>=')return n>=target;if(op==='<=')return n<=target;return n===target;
 }
 if(type==='date'){
  let n=N(value);if(n===null)return false;
  let raw=filter.replace(/^\s*(>=|<=|>|<|=)\s*/,'').trim(),op=(filter.match(/^\s*(>=|<=|>|<|=)/)||[])[1]||'=';
  let parts=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/),d=parts?new Date(+parts[3],+parts[2]-1,+parts[1]):new Date(raw);
  if(isNaN(d))return false;
  let target=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime(),day=864e5,current=new Date(n),cur=new Date(current.getFullYear(),current.getMonth(),current.getDate()).getTime();
  if(op==='>')return cur>target;if(op==='<')return cur<target;if(op==='>=')return cur>=target;if(op==='<=')return cur<=target;return cur>=target&&cur<target+day;
 }
 return String(value??'').toLowerCase().includes(filter.toLowerCase());
}
function catalogSortValue(v,type){if(v===null||v===undefined||v==='')return type==='text'?'':-Infinity;return type==='text'?String(v).toLowerCase():Number(v)}
function catalogTable(mode,rows,se){
 let cols=catalogColumns(mode),st=catalogState[mode],sortCol=cols.find(c=>c.id===st.sort)||cols[0];
 rows=rows.filter(s=>cols.every(c=>catalogFilterMatch(c.value(s,se),st.filters[c.id],c.type)));
 rows.sort((x,y)=>{let av=catalogSortValue(sortCol.value(x,se),sortCol.type),bv=catalogSortValue(sortCol.value(y,se),sortCol.type);if(typeof av==='string')return av.localeCompare(bv)*st.dir;return ((av===bv)?0:(av>bv?1:-1))*st.dir});
 let head=cols.map(c=>'<th draggable="true" data-catalog-col="'+E(c.id)+'" data-mode="'+mode+'" class="'+(st.sort===c.id?'sorted '+(st.dir>0?'asc':'desc'):'')+'"><span>'+E(c.label)+'</span><i></i></th>').join('');
 let filters=cols.map(c=>c.id==='fav'?'<th></th>':'<th><input class="catalog-col-filter" data-mode="'+mode+'" data-col="'+E(c.id)+'" value="'+E(st.filters[c.id]||'')+'" placeholder="'+(c.type==='number'?'> 10':'Filtrar')+'"></th>').join('');
 let body=rows.map(s=>'<tr class="catalog-row stock-open-row"'+stockOpenAttrs(s,'',mode==='tr')+'>'+cols.map(c=>'<td data-col="'+E(c.id)+'">'+c.cell(s,se)+'</td>').join('')+'</tr>').join('');
 return {html:'<table class="catalog-table" data-mode="'+mode+'"><thead><tr>'+head+'</tr><tr class="catalog-filter-row">'+filters+'</tr></thead><tbody>'+body+'</tbody></table>',count:rows.length};
}
function renderCatalogTable(mode){
 let isTr=mode==='tr',search=$(isTr?'#catalogSearch':'#catalogUSSearch');if(!search)return;
 let q=search.value.trim().toLowerCase(),se=catalogSession(mode);
 let rows=db.stocks.filter(s=>isTr?!!s.tradeRepublicVerified:market(s,'us')).filter(s=>!q||(((s.trTicker||'')+' '+(s.ticker||'')+' '+(s.name||'')+' '+(s.isin||'')+' '+(s.trIsin||'')+' '+(s.usIsin||'')+' '+(s.exchange||'')).toLowerCase().includes(q)));
 let out=catalogTable(mode,rows,se),box=$(isTr?'#catalogResults':'#catalogUSResults');box.innerHTML=out.html;
 let count=$(isTr?'#catalogCount':'#catalogUSCount');count.textContent=out.count.toLocaleString('es-ES')+(isTr?' valores TR':' valores EEUU');
 requestAnimationFrame(()=>{observeTrLivePrices(box);pollUsLive()});
}
function resetCatalogColumns(mode){
 catalogState[mode].order=CATALOG_COLUMNS[mode].map(c=>c.id);catalogState[mode].filters={};catalogState[mode].sort=mode==='tr'?'tickerTr':'ticker';catalogState[mode].dir=1;catalogSaveOrder(mode);renderCatalogTable(mode);
}
function renderCatalog(){renderCatalogTable('tr')}
function renderCatalogUS(){renderCatalogTable('us')}
function renderFuture(){
 let h=+$('#futureHorizon').value,t=$('#futureType').value,tr=$('#futureTrOnly').checked,now=Date.now();
 let filtered=(db.events||[]).filter(e=>futureWindowEvent(e,h,now)&&(t==='all'||e.type===t)&&(!tr||e.tradeRepublicVerified));
 let groups=groupFutureEvents(filtered);
 $('#futureResults').innerHTML=groups.length?groups.slice(0,180).map((g,i)=>{
  let e=g.first,s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  let count=g.items.length,label=count===1?EL(e):(count+' catalizadores'),when=eventWhen(e);
  return '<article class="stock-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s,label+' · '+when,!!s.tradeRepublicVerified)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,!!s.tradeRepublicVerified)+'</div><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+E(when)+'</b><span class="event-type">'+E(label)+'</span>'+(e.tradeRepublicVerified?'<span class="pill ok">TR</span>':'')+'<span class="open-arrow">→</span></div></div></article>';
 }).join(''):'<div class="empty-state">No hay catalizadores desde ahora hasta '+h+' día'+(h===1?'':'s')+' vista con estos filtros.</div>';
}

function renderCalendar(){
 let rows=[...(db.events||[])].sort((x,y)=>new Date(y.date)-new Date(x.date));
 $('#calendarResults').innerHTML=rows.length?rows.slice(0,400).map((e,i)=>{
  let s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  return '<article class="stock-card dense-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s,EL(e)+' · '+DF(e.date),!!s.tradeRepublicVerified)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,!!s.tradeRepublicVerified)+'</div><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+DF(e.date)+'</b><span class="event-type">'+E(EL(e))+'</span><span class="open-arrow">→</span></div></div></article>';
 }).join(''):'<div class="empty-state">Sin eventos o noticias disponibles.</div>';
}

function status(){}
function render(){renderMarketLeaders();renderFavorites();renderEntry();renderFuture();renderCalendar();if(state.currentView==='catalog')renderCatalog();if(state.currentView==='catalogUS')renderCatalogUS();if(document.body.classList.contains('stock-detail-open')&&state.profileKey)renderQuickProfile();status();requestAnimationFrame(()=>observeTrLivePrices(document))}
async function load(force=false){
 if(loading)return;
 loading=true;
 try{
  let r=await fetch(DATA+'?v='+Date.now(),{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
  if(!r.ok)throw Error(r.status);
  let j=await r.json();
  if(!Array.isArray(j.stocks))throw Error('formato');
  let stamp=String((j.meta&&j.meta.updatedAt)||'');
  if(!force&&stamp&&stamp===lastDataStamp)return;
  lastDataStamp=stamp;
  let previous=new Map((db.stocks||[]).map(s=>[stockKey(s),s]));
  for(let s of j.stocks){
   let old=previous.get(stockKey(s));if(!old)continue;
   ['trLivePrice','trLiveBid','trLiveAsk','trLivePre','trLiveOpen','trLiveChangePct','trLiveQuality','trLiveUpdatedAt','trLiveReceivedAt','trLiveLastAt','trLiveBidAt','trLiveAskAt','trLiveDirection','trLiveDirectionAt','trLiveBidDirection','trLiveAskDirection','usLivePrice','usLiveBid','usLiveAsk','usLiveBidSize','usLiveAskSize','usLiveVolume','usLiveChangePct','usLiveTimestamp','usLiveMarketStatus','usLiveIsRealTime','usLiveSource','usLiveReceivedAt','usLiveDirection','usLiveDirectionAt','usLiveBidDirection','usLiveAskDirection'].forEach(k=>{if(old[k]!==undefined)s[k]=old[k]});
  }
  db={stocks:j.stocks,events:Array.isArray(j.events)?j.events:[],meta:j.meta||{}};
  render();
  if(!uiRestoredScroll){uiRestoredScroll=true;requestAnimationFrame(()=>window.scrollTo(0,state.savedScrollY||0))}
 }catch(e){
  console.error(e);
  if(!db.stocks.length)document.querySelectorAll('.stock-list').forEach(x=>x.innerHTML='<div class="empty-state">No se pudieron cargar los datos de mercado. Reintenta en unos instantes.</div>')
 }finally{
  loading=false
 }
}
function show(v,preserveProfile=false){if(!V[v])return;if(!preserveProfile){document.body.classList.remove('stock-detail-open');let q=$('#stockQuickDetail');if(q){q.classList.add('is-hidden');q.innerHTML=''}state.profileKey=null;state.profileReason='';state.profileOriginView=null;state.profileOriginScroll=0;state.profilePreferTr=null;}state.currentView=v;document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));$('#view-'+v).classList.add('active');document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));$('#sidebar').classList.remove('open');saveUiState();render()}
let lastLeaderSession=null;
function clock(){
 let now=new Date();
 document.querySelectorAll('.market-clock').forEach(x=>{
  let tz=x.dataset.tz,time=x.querySelector('time');
  if(!time||!tz)return;
  time.textContent=new Intl.DateTimeFormat('es-ES',{timeZone:tz,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now);
 });
 let se=currentMarketSession();
 if(se!==lastLeaderSession){
  lastLeaderSession=se;
  if(db.stocks.length){renderMarketLeaders();renderFavorites()}
 }
}

document.querySelectorAll('.nav-item').forEach(x=>x.addEventListener('click',()=>show(x.dataset.view)));
$('#mobileMenu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
document.addEventListener('click',e=>{
 let b=e.target.closest&&e.target.closest('.fav-star');
 if(b){e.preventDefault();e.stopPropagation();toggleFavorite(b.dataset.favKey);return}
 let quickBack=e.target.closest&&e.target.closest('[data-stock-detail-back]');
 if(quickBack){e.preventDefault();e.stopPropagation();closeQuickProfile(true);return}
 let back=e.target.closest&&e.target.closest('[data-profile-back]');
 if(back){e.preventDefault();e.stopPropagation();closeQuickProfile(true);return}
 let row=e.target.closest&&e.target.closest('[data-stock-key]');
 if(row){
  if(e.target.closest&&e.target.closest('.external-links,.event-sources,.event-link,.catalog-col-filter'))return;
  e.preventDefault();e.stopPropagation();let s=stockByKey(row.dataset.stockKey),pref=row.dataset.stockPreferTr;if(s)openStock(s,row.dataset.stockReason||'',pref==='1'?true:pref==='0'?false:null);
 }
});
document.addEventListener('keydown',e=>{
 let row=e.target.closest&&e.target.closest('[data-stock-key]');
 if(!row||!['Enter',' '].includes(e.key)||e.target.closest('.fav-star,.catalog-col-filter'))return;
 e.preventDefault();let s=stockByKey(row.dataset.stockKey),pref=row.dataset.stockPreferTr;if(s)openStock(s,row.dataset.stockReason||'',pref==='1'?true:pref==='0'?false:null);
});
$('#sessionSelect').addEventListener('change',e=>{state.session=e.target.value;renderEntry();setTimeout(pollUsLive,0)});
function setPreset(value){
 state.preset=value;$('#presetSelect').value=value;
 let opt=$('.preset-option[data-value="'+value+'"]');
 if(opt){$('#presetLabel').textContent=opt.querySelector('span').textContent;document.querySelectorAll('.preset-option').forEach(x=>x.classList.toggle('active',x===opt))}
 state.filters=value==='custom'?(savedCustomPreset()||Object.assign({},state.filters)):preset(value);
 if(state.preset==='afterhours'){state.session='postmarket';$('#sessionSelect').value='postmarket'}
 toUI(state.filters);lockAllCriteria();renderEntry();setTimeout(pollUsLive,0);
}
$('#presetSelect').addEventListener('change',e=>setPreset(e.target.value));
$('#presetTrigger').addEventListener('click',e=>{e.stopPropagation();let open=$('#presetPicker').classList.toggle('open');$('#presetTrigger').setAttribute('aria-expanded',open?'true':'false')});
$$('.preset-option').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();setPreset(b.dataset.value);$('#presetPicker').classList.remove('open');$('#presetTrigger').setAttribute('aria-expanded','false')}));
document.addEventListener('click',e=>{if(!$('#presetPicker').contains(e.target)){$('#presetPicker').classList.remove('open');$('#presetTrigger').setAttribute('aria-expanded','false')}});
$('#applyFilters').addEventListener('click',()=>{state.filters=fromUI();renderEntry();setTimeout(pollUsLive,0)});
$('#resetFilters').addEventListener('click',()=>{
 state.filters=state.preset==='custom'?(savedCustomPreset()||preset('broad')):preset(state.preset);
 toUI(state.filters);lockAllCriteria();renderEntry();setTimeout(pollUsLive,0);
});
$('#saveCustomFilters').addEventListener('click',()=>{
 let q=fromUI();q.sort=state.filters.sort==='afterhours'||state.filters.sort==='change'?state.filters.sort:'score';
 if(saveCustomPreset(q)){
  state.filters=q;state.preset='custom';$('#presetSelect').value='custom';
  let opt=$('.preset-option[data-value="custom"]');
  if(opt){$('#presetLabel').textContent=opt.querySelector('span').textContent;document.querySelectorAll('.preset-option').forEach(x=>x.classList.toggle('active',x===opt))}
  renderEntry();setTimeout(pollUsLive,0);
 }
});
$('#toggleFilters').addEventListener('click',()=>$('#filterDetails').open=!$('#filterDetails').open);
$$('.field-lock').forEach(btn=>btn.addEventListener('click',()=>{let id=btn.dataset.target,input=$('#'+id);lockCriterion(id,!input.readOnly);if(!input.readOnly){input.focus();input.select()}}));
$$('[data-tab-group="entryMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{state.entryMarket=b.dataset.tab;$$('[data-tab-group="entryMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));renderEntry();setTimeout(pollUsLive,0)}));
['futureHorizon','futureType','futureTrOnly'].forEach(id=>$('#'+id).addEventListener('change',renderFuture));
let catalogSearchTimer=null;
$('#catalogSearch').addEventListener('input',()=>{clearTimeout(catalogSearchTimer);catalogSearchTimer=setTimeout(renderCatalog,160)});
$('#catalogUSSearch').addEventListener('input',()=>{clearTimeout(catalogSearchTimer);catalogSearchTimer=setTimeout(renderCatalogUS,160)});
['refreshEntry','refreshFuture'].forEach(id=>$('#'+id).addEventListener('click',()=>load(true)));

let catalogFilterTimer=null;
document.addEventListener('input',e=>{
 let f=e.target.closest&&e.target.closest('.catalog-col-filter');if(!f)return;
 let mode=f.dataset.mode,col=f.dataset.col;if(!catalogState[mode]||!col)return;
 catalogState[mode].filters[col]=f.value;clearTimeout(catalogFilterTimer);
 catalogFilterTimer=setTimeout(()=>{
  renderCatalogTable(mode);
  let next=document.querySelector('.catalog-col-filter[data-mode="'+mode+'"][data-col="'+col+'"]');
  if(next){next.focus();next.setSelectionRange(next.value.length,next.value.length)}
 },160);
});
document.addEventListener('click',e=>{
 let reset=e.target.closest&&e.target.closest('.catalog-reset-columns');
 if(reset){e.preventDefault();resetCatalogColumns(reset.dataset.catalogMode);return}
 let clear=e.target.closest&&e.target.closest('.catalog-clear-filters');
 if(clear){e.preventDefault();let mode=clear.dataset.catalogMode;if(catalogState[mode]){catalogState[mode].filters={};renderCatalogTable(mode)}return}
 let th=e.target.closest&&e.target.closest('.catalog-table thead tr:first-child th[data-catalog-col]');
 if(!th)return;
 let mode=th.dataset.mode,id=th.dataset.catalogCol,st=catalogState[mode];if(!st)return;
 if(st.sort===id)st.dir*=-1;else{st.sort=id;st.dir=1}renderCatalogTable(mode);
});
let draggedCatalogCol=null;
document.addEventListener('dragstart',e=>{
 let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(!th)return;
 draggedCatalogCol={mode:th.dataset.mode,id:th.dataset.catalogCol};th.classList.add('dragging');
 if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',th.dataset.catalogCol)}
});
document.addEventListener('dragend',()=>{document.querySelectorAll('.catalog-table th.dragging,.catalog-table th.drag-over').forEach(x=>x.classList.remove('dragging','drag-over'));draggedCatalogCol=null});
document.addEventListener('dragover',e=>{let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(!th||!draggedCatalogCol||th.dataset.mode!==draggedCatalogCol.mode)return;e.preventDefault();th.classList.add('drag-over')});
document.addEventListener('dragleave',e=>{let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(th)th.classList.remove('drag-over')});
document.addEventListener('drop',e=>{
 let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(!th||!draggedCatalogCol||th.dataset.mode!==draggedCatalogCol.mode)return;e.preventDefault();
 let mode=draggedCatalogCol.mode,order=[...catalogLoadOrder(mode)],from=order.indexOf(draggedCatalogCol.id),to=order.indexOf(th.dataset.catalogCol);
 if(from<0||to<0||from===to)return;
 order.splice(from,1);order.splice(to,0,draggedCatalogCol.id);catalogState[mode].order=order;catalogSaveOrder(mode);renderCatalogTable(mode);
});

restoreUiState();
toUI(state.filters);
lockAllCriteria();
initLeadersDock();
initTrLive();
initUsLive();
clock();
window.addEventListener('scroll',queueUiSave,{passive:true});
window.addEventListener('beforeunload',saveUiState);
setInterval(clock,1000);
setInterval(()=>load(false),15000);
load(true);
,quotePrecision(s,false))+'</span>'},
  {id:'ask',label:'Ask USD',type:'number',value:s=>usLiveAsk(s),cell:s=>'<span class="'+quoteDirClass(s.usLiveAskDirection)+'" data-us-ask-key="'+E(stockKey(s))+'">'+quoteMoney(usLiveAsk(s),'
  {id:'volume',label:'Vol. actual',type:'number',value:(s,se)=>N(s.usLiveVolume)??SV(s,se),cell:(s,se)=>compactVol(N(s.usLiveVolume)??SV(s,se))},
  {id:'avgVolume',label:'Vol. medio',type:'number',value:s=>N(s.avgVolume),cell:s=>compactVol(s.avgVolume)},
  {id:'relVolume',label:'Vol. rel.',type:'number',value:(s,se)=>RV(s,se),cell:(s,se)=>RV(s,se)===null?'—':F(RV(s,se),2)+'×'},
  {id:'premarketPrice',label:'Pre USD',type:'number',value:s=>N(s.premarketPrice),cell:s=>PR(s.premarketPrice)},
  {id:'premarketChange',label:'Pre %',type:'number',value:s=>N(s.premarketChangePct),cell:s=>'<span class="'+C(s.premarketChangePct)+'">'+PC(s.premarketChangePct)+'</span>'},
  {id:'premarketVolume',label:'Vol. pre',type:'number',value:s=>N(s.premarketVolume),cell:s=>compactVol(s.premarketVolume)},
  {id:'regularPrice',label:'Regular USD',type:'number',value:s=>N(s.price),cell:s=>PR(s.price)},
  {id:'regularChange',label:'Regular %',type:'number',value:s=>N(s.changePct),cell:s=>'<span class="'+C(s.changePct)+'">'+PC(s.changePct)+'</span>'},
  {id:'postmarketPrice',label:'Post USD',type:'number',value:s=>N(s.postmarketPrice),cell:s=>PR(s.postmarketPrice)},
  {id:'postmarketChange',label:'Post %',type:'number',value:s=>N(s.postmarketChangePct),cell:s=>'<span class="'+C(s.postmarketChangePct)+'">'+PC(s.postmarketChangePct)+'</span>'},
  {id:'postmarketVolume',label:'Vol. post',type:'number',value:s=>N(s.postmarketVolume),cell:s=>compactVol(s.postmarketVolume)},
  {id:'rsi',label:'RSI',type:'number',value:s=>N(s.rsi),cell:s=>F(s.rsi,1)},
  {id:'adx',label:'ADX',type:'number',value:s=>N(s.adx),cell:s=>F(s.adx,1)},
  {id:'ema20',label:'EMA20',type:'number',value:s=>N(s.ema20),cell:s=>PR(s.ema20)},
  {id:'ema50',label:'EMA50',type:'number',value:s=>N(s.ema50),cell:s=>PR(s.ema50)},
  {id:'week',label:'1 sem.',type:'number',value:s=>N(s.perfWeek),cell:s=>'<span class="'+C(s.perfWeek)+'">'+PC(s.perfWeek)+'</span>'},
  {id:'month',label:'1 mes',type:'number',value:s=>N(s.perfMonth),cell:s=>'<span class="'+C(s.perfMonth)+'">'+PC(s.perfMonth)+'</span>'},
  {id:'tr',label:'Trade Republic',type:'text',value:s=>s.tradeRepublicVerified?'sí':'no',cell:s=>s.tradeRepublicVerified?'<span class="pill ok">'+E(s.trTicker||'TR')+'</span>':'—'},
  {id:'isin',label:'ISIN',type:'text',value:s=>s.usIsin||s.isin||'',cell:s=>E(s.usIsin||s.isin||'—')},
  {id:'feed',label:'Feed',type:'text',value:s=>s.usLiveIsRealTime?'Nasdaq realtime':(s.updateMode||''),cell:s=>'<span class="'+(s.usLiveIsRealTime?'feed-live':'feed-delayed')+'">'+E(s.usLiveIsRealTime?'Nasdaq realtime':(s.updateMode||'—'))+'</span>'},
  {id:'updated',label:'Último dato',type:'text',value:s=>s.usLiveTimestamp||s.lastBarUpdateTime||'',cell:s=>E(s.usLiveTimestamp||'—')},
  {id:'earnings',label:'Resultados',type:'date',value:s=>s.earningsDate?new Date(s.earningsDate).getTime():null,cell:s=>s.earningsDate?DF(s.earningsDate):'—'}
 ]
};
const catalogState={tr:{sort:'tickerTr',dir:1,filters:{},order:null},us:{sort:'ticker',dir:1,filters:{},order:null}};
function catalogStorageKey(mode){return 'catalystpulse:catalogColumns:'+mode+':v1'}
function catalogLoadOrder(mode){
 if(catalogState[mode].order)return catalogState[mode].order;
 let ids=CATALOG_COLUMNS[mode].map(c=>c.id),saved=[];
 try{saved=JSON.parse(localStorage.getItem(catalogStorageKey(mode))||'[]')}catch(_){}
 saved=Array.isArray(saved)?saved.filter(x=>ids.includes(x)):[];
 catalogState[mode].order=[...saved,...ids.filter(x=>!saved.includes(x))];
 return catalogState[mode].order;
}
function catalogSaveOrder(mode){try{localStorage.setItem(catalogStorageKey(mode),JSON.stringify(catalogState[mode].order||[]))}catch(_){}}
function catalogColumns(mode){let map=new Map(CATALOG_COLUMNS[mode].map(c=>[c.id,c]));return catalogLoadOrder(mode).map(id=>map.get(id)).filter(Boolean)}
function catalogSession(mode){let id=mode==='tr'?'#catalogSession':'#catalogUSSession',v=$(id)?.value||'auto';return v==='auto'?currentMarketSession():v}
function catalogFilterMatch(value,filter,type){
 filter=String(filter||'').trim();if(!filter)return true;
 if(type==='number'){
  let n=N(value);if(n===null)return false;
  let m=filter.match(/^\s*(>=|<=|>|<|=)?\s*(-?\d+(?:[.,]\d+)?)\s*$/);
  if(!m)return false;
  let target=Number(m[2].replace(',','.')),op=m[1]||'=';
  if(op==='>')return n>target;if(op==='<')return n<target;if(op==='>=')return n>=target;if(op==='<=')return n<=target;return n===target;
 }
 if(type==='date'){
  let n=N(value);if(n===null)return false;
  let raw=filter.replace(/^\s*(>=|<=|>|<|=)\s*/,'').trim(),op=(filter.match(/^\s*(>=|<=|>|<|=)/)||[])[1]||'=';
  let parts=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/),d=parts?new Date(+parts[3],+parts[2]-1,+parts[1]):new Date(raw);
  if(isNaN(d))return false;
  let target=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime(),day=864e5,current=new Date(n),cur=new Date(current.getFullYear(),current.getMonth(),current.getDate()).getTime();
  if(op==='>')return cur>target;if(op==='<')return cur<target;if(op==='>=')return cur>=target;if(op==='<=')return cur<=target;return cur>=target&&cur<target+day;
 }
 return String(value??'').toLowerCase().includes(filter.toLowerCase());
}
function catalogSortValue(v,type){if(v===null||v===undefined||v==='')return type==='text'?'':-Infinity;return type==='text'?String(v).toLowerCase():Number(v)}
function catalogTable(mode,rows,se){
 let cols=catalogColumns(mode),st=catalogState[mode],sortCol=cols.find(c=>c.id===st.sort)||cols[0];
 rows=rows.filter(s=>cols.every(c=>catalogFilterMatch(c.value(s,se),st.filters[c.id],c.type)));
 rows.sort((x,y)=>{let av=catalogSortValue(sortCol.value(x,se),sortCol.type),bv=catalogSortValue(sortCol.value(y,se),sortCol.type);if(typeof av==='string')return av.localeCompare(bv)*st.dir;return ((av===bv)?0:(av>bv?1:-1))*st.dir});
 let head=cols.map(c=>'<th draggable="true" data-catalog-col="'+E(c.id)+'" data-mode="'+mode+'" class="'+(st.sort===c.id?'sorted '+(st.dir>0?'asc':'desc'):'')+'"><span>'+E(c.label)+'</span><i></i></th>').join('');
 let filters=cols.map(c=>c.id==='fav'?'<th></th>':'<th><input class="catalog-col-filter" data-mode="'+mode+'" data-col="'+E(c.id)+'" value="'+E(st.filters[c.id]||'')+'" placeholder="'+(c.type==='number'?'> 10':'Filtrar')+'"></th>').join('');
 let body=rows.map(s=>'<tr class="catalog-row stock-open-row"'+stockOpenAttrs(s,'',mode==='tr')+'>'+cols.map(c=>'<td data-col="'+E(c.id)+'">'+c.cell(s,se)+'</td>').join('')+'</tr>').join('');
 return {html:'<table class="catalog-table" data-mode="'+mode+'"><thead><tr>'+head+'</tr><tr class="catalog-filter-row">'+filters+'</tr></thead><tbody>'+body+'</tbody></table>',count:rows.length};
}
function renderCatalogTable(mode){
 let isTr=mode==='tr',search=$(isTr?'#catalogSearch':'#catalogUSSearch');if(!search)return;
 let q=search.value.trim().toLowerCase(),se=catalogSession(mode);
 let rows=db.stocks.filter(s=>isTr?!!s.tradeRepublicVerified:market(s,'us')).filter(s=>!q||(((s.trTicker||'')+' '+(s.ticker||'')+' '+(s.name||'')+' '+(s.isin||'')+' '+(s.trIsin||'')+' '+(s.usIsin||'')+' '+(s.exchange||'')).toLowerCase().includes(q)));
 let out=catalogTable(mode,rows,se),box=$(isTr?'#catalogResults':'#catalogUSResults');box.innerHTML=out.html;
 let count=$(isTr?'#catalogCount':'#catalogUSCount');count.textContent=out.count.toLocaleString('es-ES')+(isTr?' valores TR':' valores EEUU');
 requestAnimationFrame(()=>{observeTrLivePrices(box);pollUsLive()});
}
function resetCatalogColumns(mode){
 catalogState[mode].order=CATALOG_COLUMNS[mode].map(c=>c.id);catalogState[mode].filters={};catalogState[mode].sort=mode==='tr'?'tickerTr':'ticker';catalogState[mode].dir=1;catalogSaveOrder(mode);renderCatalogTable(mode);
}
function renderCatalog(){renderCatalogTable('tr')}
function renderCatalogUS(){renderCatalogTable('us')}
function renderFuture(){
 let h=+$('#futureHorizon').value,t=$('#futureType').value,tr=$('#futureTrOnly').checked,now=Date.now();
 let filtered=(db.events||[]).filter(e=>futureWindowEvent(e,h,now)&&(t==='all'||e.type===t)&&(!tr||e.tradeRepublicVerified));
 let groups=groupFutureEvents(filtered);
 $('#futureResults').innerHTML=groups.length?groups.slice(0,180).map((g,i)=>{
  let e=g.first,s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  let count=g.items.length,label=count===1?EL(e):(count+' catalizadores'),when=eventWhen(e);
  return '<article class="stock-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s,label+' · '+when,!!s.tradeRepublicVerified)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,!!s.tradeRepublicVerified)+'</div><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+E(when)+'</b><span class="event-type">'+E(label)+'</span>'+(e.tradeRepublicVerified?'<span class="pill ok">TR</span>':'')+'<span class="open-arrow">→</span></div></div></article>';
 }).join(''):'<div class="empty-state">No hay catalizadores desde ahora hasta '+h+' día'+(h===1?'':'s')+' vista con estos filtros.</div>';
}

function renderCalendar(){
 let rows=[...(db.events||[])].sort((x,y)=>new Date(y.date)-new Date(x.date));
 $('#calendarResults').innerHTML=rows.length?rows.slice(0,400).map((e,i)=>{
  let s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  return '<article class="stock-card dense-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s,EL(e)+' · '+DF(e.date),!!s.tradeRepublicVerified)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,!!s.tradeRepublicVerified)+'</div><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+DF(e.date)+'</b><span class="event-type">'+E(EL(e))+'</span><span class="open-arrow">→</span></div></div></article>';
 }).join(''):'<div class="empty-state">Sin eventos o noticias disponibles.</div>';
}

function status(){}
function render(){renderMarketLeaders();renderFavorites();renderEntry();renderFuture();renderCalendar();if(state.currentView==='catalog')renderCatalog();if(state.currentView==='catalogUS')renderCatalogUS();if(document.body.classList.contains('stock-detail-open')&&state.profileKey)renderQuickProfile();status();requestAnimationFrame(()=>observeTrLivePrices(document))}
async function load(force=false){
 if(loading)return;
 loading=true;
 try{
  let r=await fetch(DATA+'?v='+Date.now(),{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
  if(!r.ok)throw Error(r.status);
  let j=await r.json();
  if(!Array.isArray(j.stocks))throw Error('formato');
  let stamp=String((j.meta&&j.meta.updatedAt)||'');
  if(!force&&stamp&&stamp===lastDataStamp)return;
  lastDataStamp=stamp;
  let previous=new Map((db.stocks||[]).map(s=>[stockKey(s),s]));
  for(let s of j.stocks){
   let old=previous.get(stockKey(s));if(!old)continue;
   ['trLivePrice','trLiveBid','trLiveAsk','trLivePre','trLiveOpen','trLiveChangePct','trLiveQuality','trLiveUpdatedAt','trLiveReceivedAt','trLiveLastAt','trLiveBidAt','trLiveAskAt','trLiveDirection','trLiveDirectionAt','trLiveBidDirection','trLiveAskDirection','usLivePrice','usLiveBid','usLiveAsk','usLiveBidSize','usLiveAskSize','usLiveVolume','usLiveChangePct','usLiveTimestamp','usLiveMarketStatus','usLiveIsRealTime','usLiveSource','usLiveReceivedAt','usLiveDirection','usLiveDirectionAt','usLiveBidDirection','usLiveAskDirection'].forEach(k=>{if(old[k]!==undefined)s[k]=old[k]});
  }
  db={stocks:j.stocks,events:Array.isArray(j.events)?j.events:[],meta:j.meta||{}};
  render();
  if(!uiRestoredScroll){uiRestoredScroll=true;requestAnimationFrame(()=>window.scrollTo(0,state.savedScrollY||0))}
 }catch(e){
  console.error(e);
  if(!db.stocks.length)document.querySelectorAll('.stock-list').forEach(x=>x.innerHTML='<div class="empty-state">No se pudieron cargar los datos de mercado. Reintenta en unos instantes.</div>')
 }finally{
  loading=false
 }
}
function show(v,preserveProfile=false){if(!V[v])return;if(!preserveProfile){document.body.classList.remove('stock-detail-open');let q=$('#stockQuickDetail');if(q){q.classList.add('is-hidden');q.innerHTML=''}state.profileKey=null;state.profileReason='';state.profileOriginView=null;state.profileOriginScroll=0;state.profilePreferTr=null;}state.currentView=v;document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));$('#view-'+v).classList.add('active');document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));$('#sidebar').classList.remove('open');saveUiState();render()}
let lastLeaderSession=null;
function clock(){
 let now=new Date();
 document.querySelectorAll('.market-clock').forEach(x=>{
  let tz=x.dataset.tz,time=x.querySelector('time');
  if(!time||!tz)return;
  time.textContent=new Intl.DateTimeFormat('es-ES',{timeZone:tz,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now);
 });
 let se=currentMarketSession();
 if(se!==lastLeaderSession){
  lastLeaderSession=se;
  if(db.stocks.length){renderMarketLeaders();renderFavorites()}
 }
}

document.querySelectorAll('.nav-item').forEach(x=>x.addEventListener('click',()=>show(x.dataset.view)));
$('#mobileMenu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
document.addEventListener('click',e=>{
 let b=e.target.closest&&e.target.closest('.fav-star');
 if(b){e.preventDefault();e.stopPropagation();toggleFavorite(b.dataset.favKey);return}
 let quickBack=e.target.closest&&e.target.closest('[data-stock-detail-back]');
 if(quickBack){e.preventDefault();e.stopPropagation();closeQuickProfile(true);return}
 let back=e.target.closest&&e.target.closest('[data-profile-back]');
 if(back){e.preventDefault();e.stopPropagation();closeQuickProfile(true);return}
 let row=e.target.closest&&e.target.closest('[data-stock-key]');
 if(row){
  if(e.target.closest&&e.target.closest('.external-links,.event-sources,.event-link,.catalog-col-filter'))return;
  e.preventDefault();e.stopPropagation();let s=stockByKey(row.dataset.stockKey),pref=row.dataset.stockPreferTr;if(s)openStock(s,row.dataset.stockReason||'',pref==='1'?true:pref==='0'?false:null);
 }
});
document.addEventListener('keydown',e=>{
 let row=e.target.closest&&e.target.closest('[data-stock-key]');
 if(!row||!['Enter',' '].includes(e.key)||e.target.closest('.fav-star,.catalog-col-filter'))return;
 e.preventDefault();let s=stockByKey(row.dataset.stockKey),pref=row.dataset.stockPreferTr;if(s)openStock(s,row.dataset.stockReason||'',pref==='1'?true:pref==='0'?false:null);
});
$('#sessionSelect').addEventListener('change',e=>{state.session=e.target.value;renderEntry();setTimeout(pollUsLive,0)});
function setPreset(value){
 state.preset=value;$('#presetSelect').value=value;
 let opt=$('.preset-option[data-value="'+value+'"]');
 if(opt){$('#presetLabel').textContent=opt.querySelector('span').textContent;document.querySelectorAll('.preset-option').forEach(x=>x.classList.toggle('active',x===opt))}
 state.filters=value==='custom'?(savedCustomPreset()||Object.assign({},state.filters)):preset(value);
 if(state.preset==='afterhours'){state.session='postmarket';$('#sessionSelect').value='postmarket'}
 toUI(state.filters);lockAllCriteria();renderEntry();setTimeout(pollUsLive,0);
}
$('#presetSelect').addEventListener('change',e=>setPreset(e.target.value));
$('#presetTrigger').addEventListener('click',e=>{e.stopPropagation();let open=$('#presetPicker').classList.toggle('open');$('#presetTrigger').setAttribute('aria-expanded',open?'true':'false')});
$$('.preset-option').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();setPreset(b.dataset.value);$('#presetPicker').classList.remove('open');$('#presetTrigger').setAttribute('aria-expanded','false')}));
document.addEventListener('click',e=>{if(!$('#presetPicker').contains(e.target)){$('#presetPicker').classList.remove('open');$('#presetTrigger').setAttribute('aria-expanded','false')}});
$('#applyFilters').addEventListener('click',()=>{state.filters=fromUI();renderEntry();setTimeout(pollUsLive,0)});
$('#resetFilters').addEventListener('click',()=>{
 state.filters=state.preset==='custom'?(savedCustomPreset()||preset('broad')):preset(state.preset);
 toUI(state.filters);lockAllCriteria();renderEntry();setTimeout(pollUsLive,0);
});
$('#saveCustomFilters').addEventListener('click',()=>{
 let q=fromUI();q.sort=state.filters.sort==='afterhours'||state.filters.sort==='change'?state.filters.sort:'score';
 if(saveCustomPreset(q)){
  state.filters=q;state.preset='custom';$('#presetSelect').value='custom';
  let opt=$('.preset-option[data-value="custom"]');
  if(opt){$('#presetLabel').textContent=opt.querySelector('span').textContent;document.querySelectorAll('.preset-option').forEach(x=>x.classList.toggle('active',x===opt))}
  renderEntry();setTimeout(pollUsLive,0);
 }
});
$('#toggleFilters').addEventListener('click',()=>$('#filterDetails').open=!$('#filterDetails').open);
$$('.field-lock').forEach(btn=>btn.addEventListener('click',()=>{let id=btn.dataset.target,input=$('#'+id);lockCriterion(id,!input.readOnly);if(!input.readOnly){input.focus();input.select()}}));
$$('[data-tab-group="entryMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{state.entryMarket=b.dataset.tab;$$('[data-tab-group="entryMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));renderEntry();setTimeout(pollUsLive,0)}));
['futureHorizon','futureType','futureTrOnly'].forEach(id=>$('#'+id).addEventListener('change',renderFuture));
let catalogSearchTimer=null;
$('#catalogSearch').addEventListener('input',()=>{clearTimeout(catalogSearchTimer);catalogSearchTimer=setTimeout(renderCatalog,160)});
$('#catalogUSSearch').addEventListener('input',()=>{clearTimeout(catalogSearchTimer);catalogSearchTimer=setTimeout(renderCatalogUS,160)});
['refreshEntry','refreshFuture'].forEach(id=>$('#'+id).addEventListener('click',()=>load(true)));

let catalogFilterTimer=null;
document.addEventListener('input',e=>{
 let f=e.target.closest&&e.target.closest('.catalog-col-filter');if(!f)return;
 let mode=f.dataset.mode,col=f.dataset.col;if(!catalogState[mode]||!col)return;
 catalogState[mode].filters[col]=f.value;clearTimeout(catalogFilterTimer);
 catalogFilterTimer=setTimeout(()=>{
  renderCatalogTable(mode);
  let next=document.querySelector('.catalog-col-filter[data-mode="'+mode+'"][data-col="'+col+'"]');
  if(next){next.focus();next.setSelectionRange(next.value.length,next.value.length)}
 },160);
});
document.addEventListener('click',e=>{
 let reset=e.target.closest&&e.target.closest('.catalog-reset-columns');
 if(reset){e.preventDefault();resetCatalogColumns(reset.dataset.catalogMode);return}
 let clear=e.target.closest&&e.target.closest('.catalog-clear-filters');
 if(clear){e.preventDefault();let mode=clear.dataset.catalogMode;if(catalogState[mode]){catalogState[mode].filters={};renderCatalogTable(mode)}return}
 let th=e.target.closest&&e.target.closest('.catalog-table thead tr:first-child th[data-catalog-col]');
 if(!th)return;
 let mode=th.dataset.mode,id=th.dataset.catalogCol,st=catalogState[mode];if(!st)return;
 if(st.sort===id)st.dir*=-1;else{st.sort=id;st.dir=1}renderCatalogTable(mode);
});
let draggedCatalogCol=null;
document.addEventListener('dragstart',e=>{
 let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(!th)return;
 draggedCatalogCol={mode:th.dataset.mode,id:th.dataset.catalogCol};th.classList.add('dragging');
 if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',th.dataset.catalogCol)}
});
document.addEventListener('dragend',()=>{document.querySelectorAll('.catalog-table th.dragging,.catalog-table th.drag-over').forEach(x=>x.classList.remove('dragging','drag-over'));draggedCatalogCol=null});
document.addEventListener('dragover',e=>{let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(!th||!draggedCatalogCol||th.dataset.mode!==draggedCatalogCol.mode)return;e.preventDefault();th.classList.add('drag-over')});
document.addEventListener('dragleave',e=>{let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(th)th.classList.remove('drag-over')});
document.addEventListener('drop',e=>{
 let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(!th||!draggedCatalogCol||th.dataset.mode!==draggedCatalogCol.mode)return;e.preventDefault();
 let mode=draggedCatalogCol.mode,order=[...catalogLoadOrder(mode)],from=order.indexOf(draggedCatalogCol.id),to=order.indexOf(th.dataset.catalogCol);
 if(from<0||to<0||from===to)return;
 order.splice(from,1);order.splice(to,0,draggedCatalogCol.id);catalogState[mode].order=order;catalogSaveOrder(mode);renderCatalogTable(mode);
});

restoreUiState();
toUI(state.filters);
lockAllCriteria();
initLeadersDock();
initTrLive();
initUsLive();
clock();
window.addEventListener('scroll',queueUiSave,{passive:true});
window.addEventListener('beforeunload',saveUiState);
setInterval(clock,1000);
setInterval(()=>load(false),15000);
load(true);
,quotePrecision(s,false))+'</span>'},
  {id:'volume',label:'Vol. actual',type:'number',value:(s,se)=>N(s.usLiveVolume)??SV(s,se),cell:(s,se)=>compactVol(N(s.usLiveVolume)??SV(s,se))},
  {id:'avgVolume',label:'Vol. medio',type:'number',value:s=>N(s.avgVolume),cell:s=>compactVol(s.avgVolume)},
  {id:'relVolume',label:'Vol. rel.',type:'number',value:(s,se)=>RV(s,se),cell:(s,se)=>RV(s,se)===null?'—':F(RV(s,se),2)+'×'},
  {id:'premarketPrice',label:'Pre USD',type:'number',value:s=>N(s.premarketPrice),cell:s=>PR(s.premarketPrice)},
  {id:'premarketChange',label:'Pre %',type:'number',value:s=>N(s.premarketChangePct),cell:s=>'<span class="'+C(s.premarketChangePct)+'">'+PC(s.premarketChangePct)+'</span>'},
  {id:'premarketVolume',label:'Vol. pre',type:'number',value:s=>N(s.premarketVolume),cell:s=>compactVol(s.premarketVolume)},
  {id:'regularPrice',label:'Regular USD',type:'number',value:s=>N(s.price),cell:s=>PR(s.price)},
  {id:'regularChange',label:'Regular %',type:'number',value:s=>N(s.changePct),cell:s=>'<span class="'+C(s.changePct)+'">'+PC(s.changePct)+'</span>'},
  {id:'postmarketPrice',label:'Post USD',type:'number',value:s=>N(s.postmarketPrice),cell:s=>PR(s.postmarketPrice)},
  {id:'postmarketChange',label:'Post %',type:'number',value:s=>N(s.postmarketChangePct),cell:s=>'<span class="'+C(s.postmarketChangePct)+'">'+PC(s.postmarketChangePct)+'</span>'},
  {id:'postmarketVolume',label:'Vol. post',type:'number',value:s=>N(s.postmarketVolume),cell:s=>compactVol(s.postmarketVolume)},
  {id:'rsi',label:'RSI',type:'number',value:s=>N(s.rsi),cell:s=>F(s.rsi,1)},
  {id:'adx',label:'ADX',type:'number',value:s=>N(s.adx),cell:s=>F(s.adx,1)},
  {id:'ema20',label:'EMA20',type:'number',value:s=>N(s.ema20),cell:s=>PR(s.ema20)},
  {id:'ema50',label:'EMA50',type:'number',value:s=>N(s.ema50),cell:s=>PR(s.ema50)},
  {id:'week',label:'1 sem.',type:'number',value:s=>N(s.perfWeek),cell:s=>'<span class="'+C(s.perfWeek)+'">'+PC(s.perfWeek)+'</span>'},
  {id:'month',label:'1 mes',type:'number',value:s=>N(s.perfMonth),cell:s=>'<span class="'+C(s.perfMonth)+'">'+PC(s.perfMonth)+'</span>'},
  {id:'tr',label:'Trade Republic',type:'text',value:s=>s.tradeRepublicVerified?'sí':'no',cell:s=>s.tradeRepublicVerified?'<span class="pill ok">'+E(s.trTicker||'TR')+'</span>':'—'},
  {id:'isin',label:'ISIN',type:'text',value:s=>s.usIsin||s.isin||'',cell:s=>E(s.usIsin||s.isin||'—')},
  {id:'feed',label:'Feed',type:'text',value:s=>s.usLiveIsRealTime?'Nasdaq realtime':(s.updateMode||''),cell:s=>'<span class="'+(s.usLiveIsRealTime?'feed-live':'feed-delayed')+'">'+E(s.usLiveIsRealTime?'Nasdaq realtime':(s.updateMode||'—'))+'</span>'},
  {id:'updated',label:'Último dato',type:'text',value:s=>s.usLiveTimestamp||s.lastBarUpdateTime||'',cell:s=>E(s.usLiveTimestamp||'—')},
  {id:'earnings',label:'Resultados',type:'date',value:s=>s.earningsDate?new Date(s.earningsDate).getTime():null,cell:s=>s.earningsDate?DF(s.earningsDate):'—'}
 ]
};
const catalogState={tr:{sort:'tickerTr',dir:1,filters:{},order:null},us:{sort:'ticker',dir:1,filters:{},order:null}};
function catalogStorageKey(mode){return 'catalystpulse:catalogColumns:'+mode+':v1'}
function catalogLoadOrder(mode){
 if(catalogState[mode].order)return catalogState[mode].order;
 let ids=CATALOG_COLUMNS[mode].map(c=>c.id),saved=[];
 try{saved=JSON.parse(localStorage.getItem(catalogStorageKey(mode))||'[]')}catch(_){}
 saved=Array.isArray(saved)?saved.filter(x=>ids.includes(x)):[];
 catalogState[mode].order=[...saved,...ids.filter(x=>!saved.includes(x))];
 return catalogState[mode].order;
}
function catalogSaveOrder(mode){try{localStorage.setItem(catalogStorageKey(mode),JSON.stringify(catalogState[mode].order||[]))}catch(_){}}
function catalogColumns(mode){let map=new Map(CATALOG_COLUMNS[mode].map(c=>[c.id,c]));return catalogLoadOrder(mode).map(id=>map.get(id)).filter(Boolean)}
function catalogSession(mode){let id=mode==='tr'?'#catalogSession':'#catalogUSSession',v=$(id)?.value||'auto';return v==='auto'?currentMarketSession():v}
function catalogFilterMatch(value,filter,type){
 filter=String(filter||'').trim();if(!filter)return true;
 if(type==='number'){
  let n=N(value);if(n===null)return false;
  let m=filter.match(/^\s*(>=|<=|>|<|=)?\s*(-?\d+(?:[.,]\d+)?)\s*$/);
  if(!m)return false;
  let target=Number(m[2].replace(',','.')),op=m[1]||'=';
  if(op==='>')return n>target;if(op==='<')return n<target;if(op==='>=')return n>=target;if(op==='<=')return n<=target;return n===target;
 }
 if(type==='date'){
  let n=N(value);if(n===null)return false;
  let raw=filter.replace(/^\s*(>=|<=|>|<|=)\s*/,'').trim(),op=(filter.match(/^\s*(>=|<=|>|<|=)/)||[])[1]||'=';
  let parts=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/),d=parts?new Date(+parts[3],+parts[2]-1,+parts[1]):new Date(raw);
  if(isNaN(d))return false;
  let target=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime(),day=864e5,current=new Date(n),cur=new Date(current.getFullYear(),current.getMonth(),current.getDate()).getTime();
  if(op==='>')return cur>target;if(op==='<')return cur<target;if(op==='>=')return cur>=target;if(op==='<=')return cur<=target;return cur>=target&&cur<target+day;
 }
 return String(value??'').toLowerCase().includes(filter.toLowerCase());
}
function catalogSortValue(v,type){if(v===null||v===undefined||v==='')return type==='text'?'':-Infinity;return type==='text'?String(v).toLowerCase():Number(v)}
function catalogTable(mode,rows,se){
 let cols=catalogColumns(mode),st=catalogState[mode],sortCol=cols.find(c=>c.id===st.sort)||cols[0];
 rows=rows.filter(s=>cols.every(c=>catalogFilterMatch(c.value(s,se),st.filters[c.id],c.type)));
 rows.sort((x,y)=>{let av=catalogSortValue(sortCol.value(x,se),sortCol.type),bv=catalogSortValue(sortCol.value(y,se),sortCol.type);if(typeof av==='string')return av.localeCompare(bv)*st.dir;return ((av===bv)?0:(av>bv?1:-1))*st.dir});
 let head=cols.map(c=>'<th draggable="true" data-catalog-col="'+E(c.id)+'" data-mode="'+mode+'" class="'+(st.sort===c.id?'sorted '+(st.dir>0?'asc':'desc'):'')+'"><span>'+E(c.label)+'</span><i></i></th>').join('');
 let filters=cols.map(c=>c.id==='fav'?'<th></th>':'<th><input class="catalog-col-filter" data-mode="'+mode+'" data-col="'+E(c.id)+'" value="'+E(st.filters[c.id]||'')+'" placeholder="'+(c.type==='number'?'> 10':'Filtrar')+'"></th>').join('');
 let body=rows.map(s=>'<tr class="catalog-row stock-open-row"'+stockOpenAttrs(s,'',mode==='tr')+'>'+cols.map(c=>'<td data-col="'+E(c.id)+'">'+c.cell(s,se)+'</td>').join('')+'</tr>').join('');
 return {html:'<table class="catalog-table" data-mode="'+mode+'"><thead><tr>'+head+'</tr><tr class="catalog-filter-row">'+filters+'</tr></thead><tbody>'+body+'</tbody></table>',count:rows.length};
}
function renderCatalogTable(mode){
 let isTr=mode==='tr',search=$(isTr?'#catalogSearch':'#catalogUSSearch');if(!search)return;
 let q=search.value.trim().toLowerCase(),se=catalogSession(mode);
 let rows=db.stocks.filter(s=>isTr?!!s.tradeRepublicVerified:market(s,'us')).filter(s=>!q||(((s.trTicker||'')+' '+(s.ticker||'')+' '+(s.name||'')+' '+(s.isin||'')+' '+(s.trIsin||'')+' '+(s.usIsin||'')+' '+(s.exchange||'')).toLowerCase().includes(q)));
 let out=catalogTable(mode,rows,se),box=$(isTr?'#catalogResults':'#catalogUSResults');box.innerHTML=out.html;
 let count=$(isTr?'#catalogCount':'#catalogUSCount');count.textContent=out.count.toLocaleString('es-ES')+(isTr?' valores TR':' valores EEUU');
 requestAnimationFrame(()=>{observeTrLivePrices(box);pollUsLive()});
}
function resetCatalogColumns(mode){
 catalogState[mode].order=CATALOG_COLUMNS[mode].map(c=>c.id);catalogState[mode].filters={};catalogState[mode].sort=mode==='tr'?'tickerTr':'ticker';catalogState[mode].dir=1;catalogSaveOrder(mode);renderCatalogTable(mode);
}
function renderCatalog(){renderCatalogTable('tr')}
function renderCatalogUS(){renderCatalogTable('us')}
function renderFuture(){
 let h=+$('#futureHorizon').value,t=$('#futureType').value,tr=$('#futureTrOnly').checked,now=Date.now();
 let filtered=(db.events||[]).filter(e=>futureWindowEvent(e,h,now)&&(t==='all'||e.type===t)&&(!tr||e.tradeRepublicVerified));
 let groups=groupFutureEvents(filtered);
 $('#futureResults').innerHTML=groups.length?groups.slice(0,180).map((g,i)=>{
  let e=g.first,s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  let count=g.items.length,label=count===1?EL(e):(count+' catalizadores'),when=eventWhen(e);
  return '<article class="stock-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s,label+' · '+when,!!s.tradeRepublicVerified)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,!!s.tradeRepublicVerified)+'</div><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+E(when)+'</b><span class="event-type">'+E(label)+'</span>'+(e.tradeRepublicVerified?'<span class="pill ok">TR</span>':'')+'<span class="open-arrow">→</span></div></div></article>';
 }).join(''):'<div class="empty-state">No hay catalizadores desde ahora hasta '+h+' día'+(h===1?'':'s')+' vista con estos filtros.</div>';
}

function renderCalendar(){
 let rows=[...(db.events||[])].sort((x,y)=>new Date(y.date)-new Date(x.date));
 $('#calendarResults').innerHTML=rows.length?rows.slice(0,400).map((e,i)=>{
  let s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  return '<article class="stock-card dense-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s,EL(e)+' · '+DF(e.date),!!s.tradeRepublicVerified)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,!!s.tradeRepublicVerified)+'</div><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+DF(e.date)+'</b><span class="event-type">'+E(EL(e))+'</span><span class="open-arrow">→</span></div></div></article>';
 }).join(''):'<div class="empty-state">Sin eventos o noticias disponibles.</div>';
}

function status(){}
function render(){renderMarketLeaders();renderFavorites();renderEntry();renderFuture();renderCalendar();if(state.currentView==='catalog')renderCatalog();if(state.currentView==='catalogUS')renderCatalogUS();if(document.body.classList.contains('stock-detail-open')&&state.profileKey)renderQuickProfile();status();requestAnimationFrame(()=>observeTrLivePrices(document))}
async function load(force=false){
 if(loading)return;
 loading=true;
 try{
  let r=await fetch(DATA+'?v='+Date.now(),{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
  if(!r.ok)throw Error(r.status);
  let j=await r.json();
  if(!Array.isArray(j.stocks))throw Error('formato');
  let stamp=String((j.meta&&j.meta.updatedAt)||'');
  if(!force&&stamp&&stamp===lastDataStamp)return;
  lastDataStamp=stamp;
  let previous=new Map((db.stocks||[]).map(s=>[stockKey(s),s]));
  for(let s of j.stocks){
   let old=previous.get(stockKey(s));if(!old)continue;
   ['trLivePrice','trLiveBid','trLiveAsk','trLivePre','trLiveOpen','trLiveChangePct','trLiveQuality','trLiveUpdatedAt','trLiveReceivedAt','trLiveLastAt','trLiveBidAt','trLiveAskAt','trLiveDirection','trLiveDirectionAt','trLiveBidDirection','trLiveAskDirection','usLivePrice','usLiveBid','usLiveAsk','usLiveBidSize','usLiveAskSize','usLiveVolume','usLiveChangePct','usLiveTimestamp','usLiveMarketStatus','usLiveIsRealTime','usLiveSource','usLiveReceivedAt','usLiveDirection','usLiveDirectionAt','usLiveBidDirection','usLiveAskDirection'].forEach(k=>{if(old[k]!==undefined)s[k]=old[k]});
  }
  db={stocks:j.stocks,events:Array.isArray(j.events)?j.events:[],meta:j.meta||{}};
  render();
  if(!uiRestoredScroll){uiRestoredScroll=true;requestAnimationFrame(()=>window.scrollTo(0,state.savedScrollY||0))}
 }catch(e){
  console.error(e);
  if(!db.stocks.length)document.querySelectorAll('.stock-list').forEach(x=>x.innerHTML='<div class="empty-state">No se pudieron cargar los datos de mercado. Reintenta en unos instantes.</div>')
 }finally{
  loading=false
 }
}
function show(v,preserveProfile=false){if(!V[v])return;if(!preserveProfile){document.body.classList.remove('stock-detail-open');let q=$('#stockQuickDetail');if(q){q.classList.add('is-hidden');q.innerHTML=''}state.profileKey=null;state.profileReason='';state.profileOriginView=null;state.profileOriginScroll=0;state.profilePreferTr=null;}state.currentView=v;document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));$('#view-'+v).classList.add('active');document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));$('#sidebar').classList.remove('open');saveUiState();render()}
let lastLeaderSession=null;
function clock(){
 let now=new Date();
 document.querySelectorAll('.market-clock').forEach(x=>{
  let tz=x.dataset.tz,time=x.querySelector('time');
  if(!time||!tz)return;
  time.textContent=new Intl.DateTimeFormat('es-ES',{timeZone:tz,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now);
 });
 let se=currentMarketSession();
 if(se!==lastLeaderSession){
  lastLeaderSession=se;
  if(db.stocks.length){renderMarketLeaders();renderFavorites()}
 }
}

document.querySelectorAll('.nav-item').forEach(x=>x.addEventListener('click',()=>show(x.dataset.view)));
$('#mobileMenu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
document.addEventListener('click',e=>{
 let b=e.target.closest&&e.target.closest('.fav-star');
 if(b){e.preventDefault();e.stopPropagation();toggleFavorite(b.dataset.favKey);return}
 let quickBack=e.target.closest&&e.target.closest('[data-stock-detail-back]');
 if(quickBack){e.preventDefault();e.stopPropagation();closeQuickProfile(true);return}
 let back=e.target.closest&&e.target.closest('[data-profile-back]');
 if(back){e.preventDefault();e.stopPropagation();closeQuickProfile(true);return}
 let row=e.target.closest&&e.target.closest('[data-stock-key]');
 if(row){
  if(e.target.closest&&e.target.closest('.external-links,.event-sources,.event-link,.catalog-col-filter'))return;
  e.preventDefault();e.stopPropagation();let s=stockByKey(row.dataset.stockKey),pref=row.dataset.stockPreferTr;if(s)openStock(s,row.dataset.stockReason||'',pref==='1'?true:pref==='0'?false:null);
 }
});
document.addEventListener('keydown',e=>{
 let row=e.target.closest&&e.target.closest('[data-stock-key]');
 if(!row||!['Enter',' '].includes(e.key)||e.target.closest('.fav-star,.catalog-col-filter'))return;
 e.preventDefault();let s=stockByKey(row.dataset.stockKey),pref=row.dataset.stockPreferTr;if(s)openStock(s,row.dataset.stockReason||'',pref==='1'?true:pref==='0'?false:null);
});
$('#sessionSelect').addEventListener('change',e=>{state.session=e.target.value;renderEntry();setTimeout(pollUsLive,0)});
function setPreset(value){
 state.preset=value;$('#presetSelect').value=value;
 let opt=$('.preset-option[data-value="'+value+'"]');
 if(opt){$('#presetLabel').textContent=opt.querySelector('span').textContent;document.querySelectorAll('.preset-option').forEach(x=>x.classList.toggle('active',x===opt))}
 state.filters=value==='custom'?(savedCustomPreset()||Object.assign({},state.filters)):preset(value);
 if(state.preset==='afterhours'){state.session='postmarket';$('#sessionSelect').value='postmarket'}
 toUI(state.filters);lockAllCriteria();renderEntry();setTimeout(pollUsLive,0);
}
$('#presetSelect').addEventListener('change',e=>setPreset(e.target.value));
$('#presetTrigger').addEventListener('click',e=>{e.stopPropagation();let open=$('#presetPicker').classList.toggle('open');$('#presetTrigger').setAttribute('aria-expanded',open?'true':'false')});
$$('.preset-option').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();setPreset(b.dataset.value);$('#presetPicker').classList.remove('open');$('#presetTrigger').setAttribute('aria-expanded','false')}));
document.addEventListener('click',e=>{if(!$('#presetPicker').contains(e.target)){$('#presetPicker').classList.remove('open');$('#presetTrigger').setAttribute('aria-expanded','false')}});
$('#applyFilters').addEventListener('click',()=>{state.filters=fromUI();renderEntry();setTimeout(pollUsLive,0)});
$('#resetFilters').addEventListener('click',()=>{
 state.filters=state.preset==='custom'?(savedCustomPreset()||preset('broad')):preset(state.preset);
 toUI(state.filters);lockAllCriteria();renderEntry();setTimeout(pollUsLive,0);
});
$('#saveCustomFilters').addEventListener('click',()=>{
 let q=fromUI();q.sort=state.filters.sort==='afterhours'||state.filters.sort==='change'?state.filters.sort:'score';
 if(saveCustomPreset(q)){
  state.filters=q;state.preset='custom';$('#presetSelect').value='custom';
  let opt=$('.preset-option[data-value="custom"]');
  if(opt){$('#presetLabel').textContent=opt.querySelector('span').textContent;document.querySelectorAll('.preset-option').forEach(x=>x.classList.toggle('active',x===opt))}
  renderEntry();setTimeout(pollUsLive,0);
 }
});
$('#toggleFilters').addEventListener('click',()=>$('#filterDetails').open=!$('#filterDetails').open);
$$('.field-lock').forEach(btn=>btn.addEventListener('click',()=>{let id=btn.dataset.target,input=$('#'+id);lockCriterion(id,!input.readOnly);if(!input.readOnly){input.focus();input.select()}}));
$$('[data-tab-group="entryMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{state.entryMarket=b.dataset.tab;$$('[data-tab-group="entryMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));renderEntry();setTimeout(pollUsLive,0)}));
['futureHorizon','futureType','futureTrOnly'].forEach(id=>$('#'+id).addEventListener('change',renderFuture));
let catalogSearchTimer=null;
$('#catalogSearch').addEventListener('input',()=>{clearTimeout(catalogSearchTimer);catalogSearchTimer=setTimeout(renderCatalog,160)});
$('#catalogUSSearch').addEventListener('input',()=>{clearTimeout(catalogSearchTimer);catalogSearchTimer=setTimeout(renderCatalogUS,160)});
['refreshEntry','refreshFuture'].forEach(id=>$('#'+id).addEventListener('click',()=>load(true)));

let catalogFilterTimer=null;
document.addEventListener('input',e=>{
 let f=e.target.closest&&e.target.closest('.catalog-col-filter');if(!f)return;
 let mode=f.dataset.mode,col=f.dataset.col;if(!catalogState[mode]||!col)return;
 catalogState[mode].filters[col]=f.value;clearTimeout(catalogFilterTimer);
 catalogFilterTimer=setTimeout(()=>{
  renderCatalogTable(mode);
  let next=document.querySelector('.catalog-col-filter[data-mode="'+mode+'"][data-col="'+col+'"]');
  if(next){next.focus();next.setSelectionRange(next.value.length,next.value.length)}
 },160);
});
document.addEventListener('click',e=>{
 let reset=e.target.closest&&e.target.closest('.catalog-reset-columns');
 if(reset){e.preventDefault();resetCatalogColumns(reset.dataset.catalogMode);return}
 let clear=e.target.closest&&e.target.closest('.catalog-clear-filters');
 if(clear){e.preventDefault();let mode=clear.dataset.catalogMode;if(catalogState[mode]){catalogState[mode].filters={};renderCatalogTable(mode)}return}
 let th=e.target.closest&&e.target.closest('.catalog-table thead tr:first-child th[data-catalog-col]');
 if(!th)return;
 let mode=th.dataset.mode,id=th.dataset.catalogCol,st=catalogState[mode];if(!st)return;
 if(st.sort===id)st.dir*=-1;else{st.sort=id;st.dir=1}renderCatalogTable(mode);
});
let draggedCatalogCol=null;
document.addEventListener('dragstart',e=>{
 let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(!th)return;
 draggedCatalogCol={mode:th.dataset.mode,id:th.dataset.catalogCol};th.classList.add('dragging');
 if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',th.dataset.catalogCol)}
});
document.addEventListener('dragend',()=>{document.querySelectorAll('.catalog-table th.dragging,.catalog-table th.drag-over').forEach(x=>x.classList.remove('dragging','drag-over'));draggedCatalogCol=null});
document.addEventListener('dragover',e=>{let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(!th||!draggedCatalogCol||th.dataset.mode!==draggedCatalogCol.mode)return;e.preventDefault();th.classList.add('drag-over')});
document.addEventListener('dragleave',e=>{let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(th)th.classList.remove('drag-over')});
document.addEventListener('drop',e=>{
 let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(!th||!draggedCatalogCol||th.dataset.mode!==draggedCatalogCol.mode)return;e.preventDefault();
 let mode=draggedCatalogCol.mode,order=[...catalogLoadOrder(mode)],from=order.indexOf(draggedCatalogCol.id),to=order.indexOf(th.dataset.catalogCol);
 if(from<0||to<0||from===to)return;
 order.splice(from,1);order.splice(to,0,draggedCatalogCol.id);catalogState[mode].order=order;catalogSaveOrder(mode);renderCatalogTable(mode);
});

restoreUiState();
toUI(state.filters);
lockAllCriteria();
initLeadersDock();
initTrLive();
initUsLive();
clock();
window.addEventListener('scroll',queueUiSave,{passive:true});
window.addEventListener('beforeunload',saveUiState);
setInterval(clock,1000);
setInterval(()=>load(false),15000);
load(true);
