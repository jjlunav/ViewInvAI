const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DATA='data/market.json', KEY='catalystpulse:filters:v3', FAV_KEY='catalystpulse:favorites:v1', LEADERS_PIN_KEY='catalystpulse:leadersPinned:v1', UI_KEY='catalystpulse:ui:v1';
let db={stocks:[],events:[],meta:{}}, loading=false, lastDataStamp='';
const TR_LIVE_DIRECT='wss://api.traderepublic.com';
function trProxyUrl(){return (location.protocol==='https:'?'wss://':'ws://')+location.host+'/api/tr-live'}
let trLive={ws:null,connected:false,connecting:false,seq:1,subByKey:new Map(),keyBySub:new Map(),wanted:new Set(),reconnectTimer:null,reconnectAttempt:0,observer:null,usingDirect:false,proxyFailures:0};
let uiRestoredScroll=false;
let favorites=readFavorites();
let state={entryMarket:'tr',session:'auto',preset:'intraday',profileKey:null,profileReason:'',currentView:'entry',savedScrollY:0};
const V={entry:'01 Potencial de entrada',future:'02 Potencial futuro',calendar:'03 Calendario y noticias',catalog:'04 Catálogo Trade Republic',catalogUS:'05 Catálogo EEUU'};
const P={
 short:{minChange:1,maxChange:0,minRelVolume:1.2,minAdx:18,minRsi:38,maxRsi:72,minVolume:0,trend:false,illiquid:true,sort:'score'},
 medium:{minChange:0,maxChange:0,minRelVolume:1,minAdx:15,minRsi:35,maxRsi:78,minVolume:0,trend:true,illiquid:true,sort:'score'},
 broad:{minChange:0,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:false,sort:'score'},
 intraday:{minChange:2,maxChange:0,minRelVolume:1.5,minAdx:20,minRsi:40,maxRsi:70,minVolume:0,trend:false,illiquid:true,sort:'score'},
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
 let x=priceCurrencies(s,fallback);
 return{eur:x.eur,usd:x.usd,direct:false};
}
function pricePairInner(s,p,preferTr=false){
 let d='\u0024';
 if(preferTr&&s&&s.tradeRepublicVerified){
  let x=trPriceValues(s,p);
  return '<strong>'+money(x.eur,'€')+'</strong><small>/ '+money(x.usd,d)+'</small>';
 }
 let x=priceCurrencies(s,p);
 return '<strong>'+money(x.usd,d)+'</strong><small>/ '+money(x.eur,'€')+'</small>';
}
function pricePair(s,p,preferTr=false){
 let liveAttrs=preferTr&&s&&s.tradeRepublicVerified?' data-tr-live-key="'+E(stockKey(s))+'"':'';
 let direct=preferTr&&trLivePrice(s)!==null;
 let source=preferTr
  ?(direct?'Cotización LSX en tiempo real recibida directamente de Trade Republic. El precio en $ es una conversión EUR/USD de referencia.':'Esperando cotización LSX en tiempo real; mientras tanto se muestra una conversión desde la cotización EEUU.')
  :'Precio EEUU en $; valor en € mostrado como referencia mediante EUR/USD.';
 return '<span class="price-pair'+(direct?' live-quote':'')+'"'+liveAttrs+' title="'+E(source)+'">'+pricePairInner(s,p,preferTr)+'</span>';
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
function bidAskInner(s){
 let bid=N(s&&s.trLiveBid),ask=N(s&&s.trLiveAsk);
 return '<span class="quote-side bid"><small>BID</small><strong>'+money(bid,'€')+'</strong></span><span class="quote-side ask"><small>ASK</small><strong>'+money(ask,'€')+'</strong></span>';
}
function bidAskHtml(s,preferTr=false){
 if(!preferTr||!s||!s.tradeRepublicVerified)return '';
 return '<span class="quote-spread" data-tr-spread-key="'+E(stockKey(s))+'" title="Bid y Ask en tiempo real de LSX">'+bidAskInner(s)+'</span>';
}
function flashQuote(el,dir){
 if(!el||!dir)return;
 el.classList.remove('quote-flash-up','quote-flash-down');
 void el.offsetWidth;
 el.classList.add(dir==='up'?'quote-flash-up':'quote-flash-down');
 setTimeout(()=>el.classList.remove('quote-flash-up','quote-flash-down'),1500);
}

function liveChangeHtml(s,fallback,preferTr=false){
 let value=preferTr&&s&&s.tradeRepublicVerified?(trLiveChange(s)??N(fallback)):N(fallback);
 let attrs=preferTr&&s&&s.tradeRepublicVerified?' data-tr-live-change-key="'+E(stockKey(s))+'"':'';
 return '<span class="'+C(value)+'"'+attrs+'>'+PC(value)+'</span>';
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
function SV(s,se=SES()){return se==='premarket'?N(s.premarketVolume):se==='postmarket'?N(s.postmarketVolume):N(s.volume)}
function RV(s,se=SES()){if(se==='premarket'||se==='postmarket')return null;return N(s.relVolume)??(N(s.volume)!==null&&N(s.avgVolume)>0?N(s.volume)/N(s.avgVolume):null)}
function trend(s){let p=N(s.price),a=N(s.ema20),b=N(s.ema50);return p===null||a===null||b===null||p>=a&&a>=b}
function scoreParts(s,se=SES()){
 let ch=SC(s,se)??0,rv=RV(s,se)??0,adx=N(s.adx)??0,rsi=N(s.rsi);
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
function trApplyTickerPayload(s,payload){
 if(!s||!payload)return;
 let last=N(payload.last&&payload.last.price);
 let bid=N(payload.bid&&payload.bid.price);
 let ask=N(payload.ask&&payload.ask.price);
 let pre=N(payload.pre&&payload.pre.price);
 let open=N(payload.open&&payload.open.price);
 let px=last??bid??ask,old=N(s.trLivePrice);
 if(px!==null){
  if(old!==null&&px!==old){s.trLiveDirection=px>old?'up':'down';s.trLiveDirectionAt=Date.now()}
  s.trLivePrice=px;
 }
 if(bid!==null)s.trLiveBid=bid;
 if(ask!==null)s.trLiveAsk=ask;
 if(pre!==null)s.trLivePre=pre;
 if(open!==null)s.trLiveOpen=open;
 if(px!==null&&pre>0)s.trLiveChangePct=(px/pre-1)*100;
 s.trLiveQuality=payload.qualityId||'';
 let times=[payload.last&&payload.last.time,payload.bid&&payload.bid.time,payload.ask&&payload.ask.time].map(N).filter(x=>x!==null);
 if(times.length)s.trLiveUpdatedAt=Math.max(...times);
 s.trLiveReceivedAt=Date.now();
}
function trSendSubscriptions(){
 if(!trLive.connected||!trLive.ws||trLive.ws.readyState!==WebSocket.OPEN)return;
 for(let key of trLive.wanted){
  if(trLive.subByKey.has(key))continue;
  let s=trStockByKey(key);if(!s)continue;
  let id=trIsin(s)+'.LSX',sub=String(trLive.seq++);
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
   trLive.connected=true;trLive.connecting=false;trLive.reconnectAttempt=0;trLive.proxyFailures=0;trLive.subByKey.clear();trLive.keyBySub.clear();trSendSubscriptions();return;
  }
  let m=msg.match(/^(\d+)\s+([A-Z])(?:\s+([\s\S]+))?$/);
  if(!m||!m[3])return;
  let key=trLive.keyBySub.get(m[1]);if(!key)return;
  let payload;try{payload=JSON.parse(m[3])}catch(_){return}
  let s=trStockByKey(key);if(s)trApplyTickerPayload(s,payload);
 };
 ws.onerror=()=>{};
 ws.onclose=()=>{
  trLive.connected=false;trLive.connecting=false;trLive.ws=null;trLive.subByKey.clear();trLive.keyBySub.clear();
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
  if(s.trLiveDirection&&Date.now()-(s.trLiveDirectionAt||0)<1900){
   let seen=Number(el.dataset.flashAt||0);
   if(seen!==(s.trLiveDirectionAt||0)){el.dataset.flashAt=String(s.trLiveDirectionAt||0);flashQuote(el,s.trLiveDirection)}
  }
 });
 document.querySelectorAll('[data-tr-spread-key]').forEach(el=>{let s=trStockByKey(el.dataset.trSpreadKey);if(s)el.innerHTML=bidAskInner(s)});
 document.querySelectorAll('[data-tr-bid-key]').forEach(el=>{let s=trStockByKey(el.dataset.trBidKey);if(s)el.textContent=money(s.trLiveBid,'€')});
 document.querySelectorAll('[data-tr-ask-key]').forEach(el=>{let s=trStockByKey(el.dataset.trAskKey);if(s)el.textContent=money(s.trLiveAsk,'€')});
 document.querySelectorAll('[data-tr-live-bid-key]').forEach(el=>{let s=trStockByKey(el.dataset.trLiveBidKey);if(s)el.textContent=money(s.trLiveBid,'€')});
 document.querySelectorAll('[data-tr-live-ask-key]').forEach(el=>{let s=trStockByKey(el.dataset.trLiveAskKey);if(s)el.textContent=money(s.trLiveAsk,'€')});
 document.querySelectorAll('[data-tr-live-change-key]').forEach(el=>{
  let s=trStockByKey(el.dataset.trLiveChangeKey);if(!s)return;
  let v=trLiveChange(s);if(v===null)return;
  el.textContent=PC(v);el.classList.toggle('positive',v>=0);el.classList.toggle('negative',v<0);
 });
 if(state.entryMarket==='tr'&&$('#entryUpdated'))$('#entryUpdated').textContent='LSX LIVE · '+new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
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
function stockOpenAttrs(s,reason=''){
 return ' data-stock-key="'+E(stockKey(s))+'"'+(reason?' data-stock-reason="'+E(reason)+'"':'')+' role="button" tabindex="0"';
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

function openStock(s,reason=''){
 if(!s)return;
 state.profileKey=stockKey(s);
 state.profileReason=reason||'';
 state.currentView=s.tradeRepublicVerified?'catalog':'catalogUS';
 saveUiState();
 show(state.currentView,true);
 requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'smooth'}));
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
 return '<div class="leader-item stock-open-row"'+stockOpenAttrs(s)+' title="#'+(i+1)+' · '+E(s.name||s.ticker)+'"><div class="leader-top"><div class="leader-symbol">'+favButton(s)+'<div class="ticker-stack">'+tickerDisplay(s,preferTr)+'</div></div>'+liveChangeHtml(s,ch,preferTr)+'</div><div class="leader-body"><div class="leader-price">'+pricePair(s,p,preferTr)+'</div><div class="leader-volume" title="Volumen actual / volumen medio diario">Vol '+compactVol(vol)+' / '+compactVol(avg)+'</div></div></div>';
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
  return '<div class="favorite-row stock-open-row"'+stockOpenAttrs(s)+'><button type="button" class="fav-star active mini" data-fav-key="'+E(key)+'" title="Quitar de favoritos" aria-label="Quitar de favoritos">★</button><div class="favorite-link" title="'+E(s.name||s.ticker)+'"><div class="favorite-main"><div class="ticker-stack">'+tickerDisplay(s,!!s.tradeRepublicVerified)+'</div>'+pricePair(s,p,!!s.tradeRepublicVerified)+'</div><div class="favorite-stats">'+liveChangeHtml(s,ch,!!s.tradeRepublicVerified)+'<small>Vol '+compactVol(v)+' / '+compactVol(avg)+'</small></div></div></div>';
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
function miniChart(s){
 let symbol=String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+(s.ticker||'')));
 return '<div class="mini-chart-block"><div class="mini-chart-title">Velas 1 min · sesión 24H/24x5 cuando está disponible · overnight + premarket + regular + postmarket</div><div class="mini-chart" data-symbol="'+E(symbol)+'"><div class="chart-placeholder">Cargando gráfico…</div></div></div>';
}
function profileWidget(kind,s){
 let symbol=String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+(s.ticker||'')));
 return '<div class="profile-tv-widget" data-widget-kind="'+E(kind)+'" data-symbol="'+E(symbol)+'"><div class="widget-placeholder">Cargando información…</div></div>';
}
function loadProfileWidget(el){
 if(!el||el.dataset.loaded==='1')return;
 let kind=el.dataset.widgetKind,symbol=el.dataset.symbol;
 if(!kind||!symbol)return;
 let src,cfg={width:'100%',height:'100%',colorTheme:'dark',isTransparent:true,symbol,locale:'es'};
 if(kind==='company')src='https://s3.tradingview.com/external-embedding/embed-widget-symbol-profile.js';
 else if(kind==='fundamentals'){src='https://s3.tradingview.com/external-embedding/embed-widget-financials.js';cfg.displayMode='adaptive';cfg.largeChartUrl=''}
 else if(kind==='news'){src='https://s3.tradingview.com/external-embedding/embed-widget-timeline.js';cfg.feedMode='symbol';cfg.displayMode='regular'}
 else return;
 el.dataset.loaded='1';
 el.innerHTML='<div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div></div>';
 let box=el.querySelector('.tradingview-widget-container'),script=document.createElement('script');
 script.type='text/javascript';script.async=true;script.src=src;script.textContent=JSON.stringify(cfg);
 box.appendChild(script);
}
function loadMiniChart(el){
 if(!el||el.dataset.loaded==='1')return;
 let symbol=el.dataset.symbol;if(!symbol)return;
 el.dataset.loaded='1';
 el.innerHTML='<div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div></div>';
 let box=el.querySelector('.tradingview-widget-container'),script=document.createElement('script');
 script.type='text/javascript';script.async=true;
 script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
 script.textContent=JSON.stringify({
  autosize:true,symbol,interval:'1',timezone:'America/New_York',theme:'dark',
  backgroundColor:'#000000',gridColor:'rgba(255,255,255,0.06)',style:'1',locale:'es',
  hide_side_toolbar:true,hide_top_toolbar:false,hide_legend:false,hide_volume:false,
  allow_symbol_change:false,save_image:false,withdateranges:true,
  extended_hours:true,session:'24h',details:false,hotlist:false,calendar:false,
  support_host:'https://www.tradingview.com'
 });
 box.appendChild(script);
}
function metric(label,main,sub,help,mainClass='',subClass=''){
 return '<div class="metric-help" title="'+E(help)+'"><small>'+E(label)+' <span class="info-dot">ⓘ</span></small><b class="'+E(mainClass)+'">'+main+'</b><span class="'+E(subClass)+'">'+sub+'</span></div>';
}
function rankingWhy(s,next,se,q,pos){
 if(q.sort==='afterhours'){
  let a=SC(s,'postmarket'),b=next?SC(next,'postmarket'):null;
  return 'Puesto #'+pos+' porque este criterio ordena exclusivamente por subida postmarket: '+PC(a)+(next?' frente a '+PC(b)+' de #'+(pos+1)+' '+E(next.ticker)+'.':'.');
 }
 if(q.sort==='change'){
  let a=SC(s,se),b=next?SC(next,se):null;
  return 'Puesto #'+pos+' porque “Explosión en la sesión” ordena por mayor variación en '+SN(se)+': '+PC(a)+(next?' frente a '+PC(b)+' de #'+(pos+1)+' '+E(next.ticker)+'.':'.');
 }
 let a=scoreParts(s,se),b=next?scoreParts(next,se):null;
 let names={movimiento:'movimiento',volumen:'volumen relativo',adx:'fuerza ADX',rsi:'zona RSI',precioEma:'precio sobre EMA20',tendenciaEma:'EMA20 sobre EMA50'};
 let components='movimiento '+F(a.movimiento,1)+' · volumen '+F(a.volumen,1)+' · ADX '+F(a.adx,1)+' · RSI '+F(a.rsi,1)+' · tendencia '+F(a.precioEma+a.tendenciaEma,1);
 if(!next)return 'Puesto #'+pos+' · score '+F(a.total,1)+'/100. Desglose: '+components+'.';
 let diffs=Object.keys(names).map(k=>({k,d:a[k]-b[k]})).filter(x=>x.d>0.15).sort((x,y)=>y.d-x.d).slice(0,3);
 let reason=diffs.length?diffs.map(x=>names[x.k]+' +'+F(x.d,1)+' pt').join(', '):'mejor score agregado';
 return 'Puesto #'+pos+' · score '+F(a.total,1)+'/100 frente a '+F(b.total,1)+'/100 de #'+(pos+1)+' '+E(next.ticker)+'. Ventaja principal: '+reason+'. Desglose: '+components+'.';
}
function why(s,se){let b=[],c=SC(s,se),r=RV(s,se);if(c!==null)b.push(SN(se)+' '+PC(c));if(r!==null)b.push('vol. relativo '+F(r,2)+'×');if(N(s.adx)!==null)b.push('ADX '+F(s.adx,1));if(N(s.rsi)!==null)b.push('RSI '+F(s.rsi,1));if(trend(s))b.push('tendencia compatible');return b.join(' · ')||'Cumple el criterio activo con los datos disponibles.'}
function card(s,i,se=SES(),dense=false,rankText='',preferTr=false){
 let ch=SC(s,se),p=SP(s,se),hint=rankText||why(s,se);
 return '<article class="stock-card '+(dense?'dense-card':'')+'"><div class="stock-main stock-open-row"'+stockOpenAttrs(s,hint)+' title="'+E(hint)+'"><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,preferTr)+'</div><span>'+E(s.name||'')+'</span></div></div><div class="stock-quick">'+bidAskHtml(s,preferTr)+pricePair(s,p,preferTr)+liveChangeHtml(s,ch,preferTr)+(s.tradeRepublicVerified?'<span class="pill ok">TR</span>':'')+'<span class="open-arrow">→</span></div></div></article>';
}
function market(s,m){let ex=String(s.exchange||'').toUpperCase();return m==='tr'?!!s.tradeRepublicVerified:m==='us'?['NASDAQ','NYSE','AMEX','NYSE ARCA','NYSEARCA'].includes(ex):true}
function fromUI(){return{minChange:+$('#minChange').value||0,maxChange:+$('#maxChange').value||0,minRelVolume:+$('#minRelVolume').value||0,minAdx:+$('#minAdx').value||0,minRsi:+$('#minRsi').value||0,maxRsi:+$('#maxRsi').value||100,minVolume:+$('#minVolume').value||0,trend:$('#requireTrend').checked,illiquid:$('#excludeIlliquid').checked,sort:state.filters.sort}}
function lockCriterion(id,locked=true){let input=$('#'+id),btn=$('.field-lock[data-target="'+id+'"]');if(!input||!btn)return;input.readOnly=locked;btn.classList.toggle('unlocked',!locked);btn.textContent=locked?'🔒':'🔓';btn.title=locked?'Desbloquear este parámetro':'Bloquear este parámetro';btn.setAttribute('aria-label',locked?'Desbloquear '+id:'Bloquear '+id)}
function lockAllCriteria(){['minChange','maxChange','minRelVolume','minAdx','minRsi','maxRsi','minVolume'].forEach(id=>lockCriterion(id,true))}
function toUI(x){['minChange','maxChange','minRelVolume','minAdx','minRsi','maxRsi','minVolume'].forEach(k=>$('#'+k).value=x[k]);$('#requireTrend').checked=!!x.trend;$('#excludeIlliquid').checked=!!x.illiquid}
function entry(){let q=state.filters,se=q.sort==='afterhours'?'postmarket':SES(),a=db.stocks.filter(s=>market(s,state.entryMarket)).filter(s=>{let c=SC(s,se);if(c===null||c<q.minChange)return false;if(q.maxChange>0&&c>q.maxChange)return false;let r=RV(s,se);if(q.minRelVolume>0&&r!==null&&r<q.minRelVolume)return false;if(q.minAdx>0&&N(s.adx)!==null&&s.adx<q.minAdx)return false;if(N(s.rsi)!==null&&(s.rsi<q.minRsi||s.rsi>q.maxRsi))return false;let v=SV(s,se);if(q.minVolume>0&&v!==null&&v<q.minVolume)return false;if(q.trend&&!trend(s))return false;if(q.illiquid&&v!==null&&v<10000)return false;return true});if(q.sort==='afterhours')a.sort((x,y)=>(SC(y,'postmarket')??-999)-(SC(x,'postmarket')??-999));else if(q.sort==='change')a.sort((x,y)=>(SC(y,se)??-999)-(SC(x,se)??-999));else a.sort((x,y)=>score(y,se)-score(x,se));return[a,se]}
function renderEntry(){let [a,se]=entry();$('#entrySessionText').textContent=(state.entryMarket==='tr'?'Trade Republic':'Resto EEUU')+' · '+SN(se);$('#entryCount').textContent=a.length+' candidatas';$('#entryUpdated').textContent=db.meta.updatedAt?'datos '+new Date(db.meta.updatedAt).toLocaleString('es-ES'):'sin actualización';$('#entryTag').textContent=state.filters.sort==='afterhours'?'SUBIDAS POSTMARKET':state.preset==='exploded'?'EXPLOSIÓN EN SESIÓN':se==='premarket'?'IMPULSO PREMARKET':'SEGUIMIENTO';$('#entryLead').textContent=state.filters.sort==='afterhours'?'Acciones ordenadas por mayor subida después del cierre regular de EEUU.':'Señales técnicas y movimientos de mercado, sin precio mínimo.';let shown=a.slice(0,150);$('#entryResults').innerHTML=shown.length?shown.map((s,i)=>card(s,i,se,false,rankingWhy(s,shown[i+1],se,state.filters,i+1),state.entryMarket==='tr')).join(''):'<div class="empty-state">No hay candidatas con este criterio y sesión.</div>'}
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

const CATALOG_LAYOUT_KEY='catalystpulse:catalog-layout:v2';
let catalogUi={
 tr:{sort:{key:'ticker',dir:'asc'},filters:{},order:null},
 us:{sort:{key:'ticker',dir:'asc'},filters:{},order:null}
};
function catalogLoadLayout(){
 try{
  let saved=JSON.parse(localStorage.getItem(CATALOG_LAYOUT_KEY)||'{}');
  for(let mode of ['tr','us']){
   if(Array.isArray(saved[mode+'Order']))catalogUi[mode].order=saved[mode+'Order'];
   if(saved[mode+'Sort']&&saved[mode+'Sort'].key)catalogUi[mode].sort=saved[mode+'Sort'];
  }
 }catch(_){}
}
function catalogSaveLayout(){
 try{
  localStorage.setItem(CATALOG_LAYOUT_KEY,JSON.stringify({
   trOrder:catalogUi.tr.order,usOrder:catalogUi.us.order,
   trSort:catalogUi.tr.sort,usSort:catalogUi.us.sort
  }));
 }catch(_){}
}
function catalogPriceValue(s,mode){
 if(mode==='tr'){
  let live=trLivePrice(s);if(live!==null)return live;
  return priceCurrencies(s,SP(s,currentMarketSession())).eur;
 }
 return SP(s,currentMarketSession());
}
function catalogChangeValue(s,mode){
 return mode==='tr'?(trLiveChange(s)??SC(s,currentMarketSession())):SC(s,currentMarketSession());
}
function catalogLiveCell(s,kind){
 if(kind==='bid')return '<span class="catalog-live-number" data-tr-live-bid-key="'+E(stockKey(s))+'">'+money(s.trLiveBid,'€')+'</span>';
 if(kind==='ask')return '<span class="catalog-live-number" data-tr-live-ask-key="'+E(stockKey(s))+'">'+money(s.trLiveAsk,'€')+'</span>';
 return '—';
}
function catalogColumns(mode){
 let tr=mode==='tr';
 return [
  {key:'fav',label:'★',type:'text',value:s=>favorites.has(stockKey(s))?'1':'0',html:s=>favButton(s),filter:false,sort:false},
  {key:'ticker',label:tr?'Ticker TR':'Ticker EEUU',type:'text',value:s=>tr?(s.trTicker||''):s.ticker,html:s=>'<div class="catalog-ticker">'+tickerDisplay(s,tr)+'</div>'},
  ...(tr?[{key:'usTicker',label:'Ticker EEUU',type:'text',value:s=>s.ticker,html:s=>'<strong>'+E(s.ticker||'—')+'</strong><small>'+E(s.exchange||'')+'</small>'}]:[]),
  {key:'name',label:'Empresa',type:'text',value:s=>s.name||'',html:s=>'<span class="catalog-company">'+E(s.name||'—')+'</span>'},
  {key:'exchange',label:'Mercado',type:'text',value:s=>tr?(s.trExchange||'LSX'):(s.exchange||''),html:s=>E(tr?(s.trExchange||'LSX'):(s.exchange||'—'))},
  {key:'price',label:tr?'Precio € / $':'Precio $ / €',type:'number',value:s=>catalogPriceValue(s,mode),html:s=>pricePair(s,SP(s,currentMarketSession()),tr)},
  ...(tr?[
   {key:'bid',label:'BID €',type:'number',value:s=>s.trLiveBid,html:s=>catalogLiveCell(s,'bid')},
   {key:'ask',label:'ASK €',type:'number',value:s=>s.trLiveAsk,html:s=>catalogLiveCell(s,'ask')}
  ]:[]),
  {key:'change',label:'% sesión',type:'number',value:s=>catalogChangeValue(s,mode),html:s=>liveChangeHtml(s,catalogChangeValue(s,mode),tr)},
  {key:'volume',label:'Vol. actual',type:'number',value:s=>SV(s,currentMarketSession()),html:s=>I(SV(s,currentMarketSession()))},
  {key:'avgVolume',label:'Vol. medio',type:'number',value:s=>s.avgVolume,html:s=>I(s.avgVolume)},
  {key:'relVolume',label:'Vol. rel.',type:'number',value:s=>RV(s,currentMarketSession()),html:s=>RV(s,currentMarketSession())===null?'—':F(RV(s,currentMarketSession()),2)+'×'},
  {key:'regularPrice',label:'Regular',type:'number',value:s=>s.price,html:s=>snapshotPricePair(s,s.price,tr)},
  {key:'regularChange',label:'% regular',type:'number',value:s=>s.changePct,html:s=>'<span class="'+C(s.changePct)+'">'+PC(s.changePct)+'</span>'},
  {key:'premarketPrice',label:'Premarket',type:'number',value:s=>s.premarketPrice,html:s=>snapshotPricePair(s,s.premarketPrice,tr)},
  {key:'premarketChange',label:'% pre',type:'number',value:s=>s.premarketChangePct,html:s=>'<span class="'+C(s.premarketChangePct)+'">'+PC(s.premarketChangePct)+'</span>'},
  {key:'premarketVolume',label:'Vol. pre',type:'number',value:s=>s.premarketVolume,html:s=>I(s.premarketVolume)},
  {key:'postmarketPrice',label:'Postmarket',type:'number',value:s=>s.postmarketPrice,html:s=>snapshotPricePair(s,s.postmarketPrice,tr)},
  {key:'postmarketChange',label:'% post',type:'number',value:s=>s.postmarketChangePct,html:s=>'<span class="'+C(s.postmarketChangePct)+'">'+PC(s.postmarketChangePct)+'</span>'},
  {key:'postmarketVolume',label:'Vol. post',type:'number',value:s=>s.postmarketVolume,html:s=>I(s.postmarketVolume)},
  {key:'rsi',label:'RSI',type:'number',value:s=>s.rsi,html:s=>F(s.rsi,1)},
  {key:'adx',label:'ADX',type:'number',value:s=>s.adx,html:s=>F(s.adx,1)},
  {key:'ema20',label:'EMA20',type:'number',value:s=>s.ema20,html:s=>PR(s.ema20)},
  {key:'ema50',label:'EMA50',type:'number',value:s=>s.ema50,html:s=>PR(s.ema50)},
  {key:'week',label:'1 semana',type:'number',value:s=>s.perfWeek,html:s=>'<span class="'+C(s.perfWeek)+'">'+PC(s.perfWeek)+'</span>'},
  {key:'month',label:'1 mes',type:'number',value:s=>s.perfMonth,html:s=>'<span class="'+C(s.perfMonth)+'">'+PC(s.perfMonth)+'</span>'},
  {key:'earnings',label:'Resultados',type:'date',value:s=>s.earningsDate?new Date(s.earningsDate).getTime():null,html:s=>s.earningsDate?DF(s.earningsDate):'—'},
  {key:'isin',label:'ISIN',type:'text',value:s=>tr?(s.trIsin||s.isin||''):(s.usIsin||s.isin||''),html:s=>'<span class="catalog-code">'+E(tr?(s.trIsin||s.isin||'—'):(s.usIsin||s.isin||'—'))+'</span>'},
  ...(tr?[{key:'wkn',label:'WKN',type:'text',value:s=>s.trWkn||'',html:s=>'<span class="catalog-code">'+E(s.trWkn||'—')+'</span>'}]:[]),
  {key:'type',label:'Tipo',type:'text',value:s=>s.instrumentType||'',html:s=>E(s.instrumentType||'—')},
  {key:'feed',label:'Feed',type:'text',value:s=>tr?(s.trLiveQuality||'LSX'):(s.updateMode||''),html:s=>'<span class="catalog-feed">'+E(tr?(s.trLiveQuality||'LSX'):(s.updateMode||'—'))+'</span>'},
  {key:'updated',label:'Último dato',type:'date',value:s=>N(s.trLiveUpdatedAt)||N(s.lastBarUpdateTime),html:s=>{let x=N(s.trLiveUpdatedAt)||N(s.lastBarUpdateTime);if(x===null)return'—';if(x<1e12)x*=1000;return new Date(x).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}}
 ];
}
function catalogOrderedColumns(mode){
 let defs=catalogColumns(mode),keys=defs.map(x=>x.key),saved=catalogUi[mode].order;
 if(!Array.isArray(saved))return defs;
 let valid=saved.filter(k=>keys.includes(k)),missing=keys.filter(k=>!valid.includes(k));
 let order=[...valid,...missing];catalogUi[mode].order=order;
 let by=new Map(defs.map(x=>[x.key,x]));return order.map(k=>by.get(k)).filter(Boolean);
}
function catalogSearchBlob(s,mode){
 return [mode==='tr'?s.trTicker:'',s.ticker,s.name,s.exchange,s.trExchange,s.isin,s.trIsin,s.usIsin,s.trWkn,s.instrumentType,s.updateMode,s.trNameAtExchange].filter(Boolean).join(' ').toLowerCase();
}
function catalogMatchFilter(value,query,type){
 query=String(query||'').trim();if(!query)return true;
 if(type==='number'){
  let v=N(value);if(v===null)return false;
  let q=query.replace(',','.').replace(/\s+/g,'');
  let range=q.match(/^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/);
  if(range)return v>=Number(range[1])&&v<=Number(range[2]);
  let cmp=q.match(/^(>=|<=|>|<|=)?(-?\d+(?:\.\d+)?)$/);
  if(cmp){
   let n=Number(cmp[2]),op=cmp[1]||'=';
   return op==='>'?v>n:op==='<'?v<n:op==='>='?v>=n:op==='<='?v<=n:Math.abs(v-n)<1e-9;
  }
 }
 if(type==='date'){
  let v=N(value);if(v===null)return false;if(v<1e12)v*=1000;
  return new Date(v).toLocaleDateString('es-ES').toLowerCase().includes(query.toLowerCase());
 }
 return String(value??'').toLowerCase().includes(query.toLowerCase());
}
function catalogSortRows(rows,mode,defs){
 let sort=catalogUi[mode].sort,col=defs.find(x=>x.key===sort.key);
 if(!col||col.sort===false)return rows;
 let dir=sort.dir==='desc'?-1:1;
 return rows.sort((a,b)=>{
  let av=col.value(a),bv=col.value(b);
  if(col.type==='number'||col.type==='date'){
   let an=N(av),bn=N(bv);
   if(an===null&&bn===null)return 0;if(an===null)return 1;if(bn===null)return-1;return(an-bn)*dir;
  }
  return String(av??'').localeCompare(String(bv??''),'es',{numeric:true,sensitivity:'base'})*dir;
 });
}
function catalogFilterRows(rows,mode,defs,globalQuery){
 let filters=catalogUi[mode].filters||{};
 return rows.filter(s=>{
  if(globalQuery&&!catalogSearchBlob(s,mode).includes(globalQuery))return false;
  for(let col of defs){
   let q=filters[col.key];if(!q||col.filter===false)continue;
   if(!catalogMatchFilter(col.value(s),q,col.type))return false;
  }
  return true;
 });
}
function catalogFilterPlaceholder(col){return col.type==='number'?'>20 / 10..30':'filtrar'}
function catalogTableHtml(rows,mode){
 let defs=catalogOrderedColumns(mode),sort=catalogUi[mode].sort,filters=catalogUi[mode].filters||{},tr=mode==='tr';
 let head=defs.map(col=>{
  let arrow=sort.key===col.key?(sort.dir==='asc'?'▲':'▼'):'';
  let button=col.sort===false?'<span>'+E(col.label)+'</span>':'<button type="button" class="catalog-sort-btn" data-catalog-sort="'+E(col.key)+'" data-catalog-mode="'+mode+'">'+E(col.label)+' <b>'+arrow+'</b></button>';
  return '<th draggable="true" data-catalog-col="'+E(col.key)+'" data-catalog-mode="'+mode+'"><span class="col-drag" title="Arrastrar columna">⋮⋮</span>'+button+'</th>';
 }).join('');
 let filterRow=defs.map(col=>'<th>'+(col.filter===false?'':'<input class="catalog-col-filter" data-catalog-filter="'+E(col.key)+'" data-catalog-mode="'+mode+'" value="'+E(filters[col.key]||'')+'" placeholder="'+E(catalogFilterPlaceholder(col))+'">')+'</th>').join('');
 let body=rows.map(s=>{
  let subscribe=tr?' data-tr-subscribe-key="'+E(stockKey(s))+'"':'';
  let cells=defs.map(col=>'<td data-col="'+E(col.key)+'">'+col.html(s)+'</td>').join('');
  return '<tr class="catalog-row stock-open-row" data-stock-key="'+E(stockKey(s))+'" role="button" tabindex="0"'+subscribe+'>'+cells+'</tr>';
 }).join('');
 return '<div class="catalog-sheet-scroll"><table class="catalog-sheet"><thead><tr>'+head+'</tr><tr class="catalog-filter-row">'+filterRow+'</tr></thead><tbody>'+body+'</tbody></table></div>';
}
function renderCatalogMode(mode){
 let isTr=mode==='tr',view=isTr?'catalog':'catalogUS';
 if(renderProfileView(view))return;
 let input=$(isTr?'#catalogSearch':'#catalogUSSearch'),globalQuery=String(input&&input.value||'').trim().toLowerCase();
 let all=db.stocks.filter(s=>isTr?s.tradeRepublicVerified:market(s,'us'));
 let defs=catalogColumns(mode);
 let rows=catalogFilterRows(all,mode,defs,globalQuery);
 catalogSortRows(rows,mode,defs);
 let count=$(isTr?'#catalogCount':'#catalogUSCount');
 if(count)count.textContent=rows.length.toLocaleString('es-ES')+' / '+all.length.toLocaleString('es-ES')+(isTr?' valores TR':' valores EEUU');
 let box=$(isTr?'#catalogResults':'#catalogUSResults');
 if(box)box.innerHTML=rows.length?catalogTableHtml(rows,mode):'<div class="empty-state">No hay valores que cumplan los filtros.</div>';
 requestAnimationFrame(()=>observeTrLivePrices(box||document));
}

const CATALOG_COLUMNS={
 tr:[
  {id:'fav',label:'★',type:'html',value:s=>favorites.has(stockKey(s))?1:0,cell:s=>favButton(s)},
  {id:'tickerTr',label:'Ticker TR',type:'text',value:s=>s.trTicker||'',cell:s=>'<strong class="table-ticker">'+E(s.trTicker||'—')+'</strong>'},
  {id:'tickerUs',label:'Ticker EEUU',type:'text',value:s=>s.ticker||'',cell:s=>'<span class="table-us-ticker">'+E(s.ticker||'—')+'</span>'},
  {id:'name',label:'Empresa',type:'text',value:s=>s.name||'',cell:s=>E(s.name||'—')},
  {id:'exchange',label:'Mercado',type:'text',value:s=>s.exchange||'',cell:s=>E(s.exchange||'—')},
  {id:'price',label:'Precio € / $',type:'number',value:(s,se)=>trLivePrice(s)??SP(s,se),cell:(s,se)=>pricePair(s,SP(s,se),true)},
  {id:'change',label:'%',type:'number',value:(s,se)=>trLiveChange(s)??SC(s,se),cell:(s,se)=>liveChangeHtml(s,SC(s,se),true)},
  {id:'bid',label:'Bid',type:'number',value:s=>N(s.trLiveBid),cell:s=>'<span class="table-live-number" data-tr-bid-key="'+E(stockKey(s))+'">'+money(s.trLiveBid,'€')+'</span>'},
  {id:'ask',label:'Ask',type:'number',value:s=>N(s.trLiveAsk),cell:s=>'<span class="table-live-number" data-tr-ask-key="'+E(stockKey(s))+'">'+money(s.trLiveAsk,'€')+'</span>'},
  {id:'volume',label:'Vol. actual',type:'number',value:(s,se)=>SV(s,se),cell:(s,se)=>compactVol(SV(s,se))},
  {id:'avgVolume',label:'Vol. medio',type:'number',value:s=>N(s.avgVolume),cell:s=>compactVol(s.avgVolume)},
  {id:'relVolume',label:'Vol. rel.',type:'number',value:(s,se)=>RV(s,se),cell:(s,se)=>RV(s,se)===null?'—':F(RV(s,se),2)+'×'},
  {id:'premarketPrice',label:'Pre $',type:'number',value:s=>N(s.premarketPrice),cell:s=>PR(s.premarketPrice)},
  {id:'premarketChange',label:'Pre %',type:'number',value:s=>N(s.premarketChangePct),cell:s=>PC(s.premarketChangePct)},
  {id:'regularPrice',label:'Regular $',type:'number',value:s=>N(s.price),cell:s=>PR(s.price)},
  {id:'regularChange',label:'Regular %',type:'number',value:s=>N(s.changePct),cell:s=>PC(s.changePct)},
  {id:'postmarketPrice',label:'Post $',type:'number',value:s=>N(s.postmarketPrice),cell:s=>PR(s.postmarketPrice)},
  {id:'postmarketChange',label:'Post %',type:'number',value:s=>N(s.postmarketChangePct),cell:s=>PC(s.postmarketChangePct)},
  {id:'rsi',label:'RSI',type:'number',value:s=>N(s.rsi),cell:s=>F(s.rsi,1)},
  {id:'adx',label:'ADX',type:'number',value:s=>N(s.adx),cell:s=>F(s.adx,1)},
  {id:'ema20',label:'EMA20',type:'number',value:s=>N(s.ema20),cell:s=>PR(s.ema20)},
  {id:'ema50',label:'EMA50',type:'number',value:s=>N(s.ema50),cell:s=>PR(s.ema50)},
  {id:'week',label:'1 sem.',type:'number',value:s=>N(s.perfWeek),cell:s=>PC(s.perfWeek)},
  {id:'month',label:'1 mes',type:'number',value:s=>N(s.perfMonth),cell:s=>PC(s.perfMonth)},
  {id:'isin',label:'ISIN',type:'text',value:s=>s.trIsin||s.isin||'',cell:s=>E(s.trIsin||s.isin||'—')},
  {id:'earnings',label:'Resultados',type:'date',value:s=>s.earningsDate?new Date(s.earningsDate).getTime():null,cell:s=>s.earningsDate?DF(s.earningsDate):'—'}
 ],
 us:[
  {id:'fav',label:'★',type:'html',value:s=>favorites.has(stockKey(s))?1:0,cell:s=>favButton(s)},
  {id:'ticker',label:'Ticker',type:'text',value:s=>s.ticker||'',cell:s=>'<strong class="table-ticker">'+E(s.ticker||'—')+'</strong>'},
  {id:'name',label:'Empresa',type:'text',value:s=>s.name||'',cell:s=>E(s.name||'—')},
  {id:'exchange',label:'Mercado',type:'text',value:s=>s.exchange||'',cell:s=>E(s.exchange||'—')},
  {id:'price',label:'Precio $ / €',type:'number',value:(s,se)=>SP(s,se),cell:(s,se)=>pricePair(s,SP(s,se),false)},
  {id:'change',label:'%',type:'number',value:(s,se)=>SC(s,se),cell:(s,se)=>'<span class="'+C(SC(s,se))+'">'+PC(SC(s,se))+'</span>'},
  {id:'volume',label:'Vol. actual',type:'number',value:(s,se)=>SV(s,se),cell:(s,se)=>compactVol(SV(s,se))},
  {id:'avgVolume',label:'Vol. medio',type:'number',value:s=>N(s.avgVolume),cell:s=>compactVol(s.avgVolume)},
  {id:'relVolume',label:'Vol. rel.',type:'number',value:(s,se)=>RV(s,se),cell:(s,se)=>RV(s,se)===null?'—':F(RV(s,se),2)+'×'},
  {id:'premarketPrice',label:'Pre $',type:'number',value:s=>N(s.premarketPrice),cell:s=>PR(s.premarketPrice)},
  {id:'premarketChange',label:'Pre %',type:'number',value:s=>N(s.premarketChangePct),cell:s=>'<span class="'+C(s.premarketChangePct)+'">'+PC(s.premarketChangePct)+'</span>'},
  {id:'regularPrice',label:'Regular $',type:'number',value:s=>N(s.price),cell:s=>PR(s.price)},
  {id:'regularChange',label:'Regular %',type:'number',value:s=>N(s.changePct),cell:s=>'<span class="'+C(s.changePct)+'">'+PC(s.changePct)+'</span>'},
  {id:'postmarketPrice',label:'Post $',type:'number',value:s=>N(s.postmarketPrice),cell:s=>PR(s.postmarketPrice)},
  {id:'postmarketChange',label:'Post %',type:'number',value:s=>N(s.postmarketChangePct),cell:s=>'<span class="'+C(s.postmarketChangePct)+'">'+PC(s.postmarketChangePct)+'</span>'},
  {id:'rsi',label:'RSI',type:'number',value:s=>N(s.rsi),cell:s=>F(s.rsi,1)},
  {id:'adx',label:'ADX',type:'number',value:s=>N(s.adx),cell:s=>F(s.adx,1)},
  {id:'ema20',label:'EMA20',type:'number',value:s=>N(s.ema20),cell:s=>PR(s.ema20)},
  {id:'ema50',label:'EMA50',type:'number',value:s=>N(s.ema50),cell:s=>PR(s.ema50)},
  {id:'week',label:'1 sem.',type:'number',value:s=>N(s.perfWeek),cell:s=>'<span class="'+C(s.perfWeek)+'">'+PC(s.perfWeek)+'</span>'},
  {id:'month',label:'1 mes',type:'number',value:s=>N(s.perfMonth),cell:s=>'<span class="'+C(s.perfMonth)+'">'+PC(s.perfMonth)+'</span>'},
  {id:'tr',label:'Trade Republic',type:'text',value:s=>s.tradeRepublicVerified?'sí':'no',cell:s=>s.tradeRepublicVerified?'<span class="pill ok">'+E(s.trTicker||'TR')+'</span>':'—'},
  {id:'isin',label:'ISIN',type:'text',value:s=>s.usIsin||s.isin||'',cell:s=>E(s.usIsin||s.isin||'—')},
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
 if(type==='number'||type==='date'){
  let n=N(value);if(n===null)return false;
  let m=filter.match(/^\s*(>=|<=|>|<|=)?\s*(-?\d+(?:[.,]\d+)?)\s*$/);
  if(m){let target=Number(m[2].replace(',','.')),op=m[1]||'=';if(op==='>')return n>target;if(op==='<')return n<target;if(op==='>=')return n>=target;if(op==='<=')return n<=target;return n===target}
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
 let body=rows.map(s=>'<tr class="catalog-row stock-open-row"'+stockOpenAttrs(s)+'>'+cols.map(c=>'<td data-col="'+E(c.id)+'">'+c.cell(s,se)+'</td>').join('')+'</tr>').join('');
 return {html:'<table class="catalog-table" data-mode="'+mode+'"><thead><tr>'+head+'</tr><tr class="catalog-filter-row">'+filters+'</tr></thead><tbody>'+body+'</tbody></table>',count:rows.length};
}
function renderCatalogTable(mode){
 let isTr=mode==='tr',search=$(isTr?'#catalogSearch':'#catalogUSSearch');if(!search)return;
 let q=search.value.trim().toLowerCase(),se=catalogSession(mode);
 let rows=db.stocks.filter(s=>isTr?!!s.tradeRepublicVerified:market(s,'us')).filter(s=>!q||(((s.trTicker||'')+' '+(s.ticker||'')+' '+(s.name||'')+' '+(s.isin||'')+' '+(s.trIsin||'')+' '+(s.usIsin||'')+' '+(s.exchange||'')).toLowerCase().includes(q)));
 let out=catalogTable(mode,rows,se),box=$(isTr?'#catalogResults':'#catalogUSResults');box.innerHTML=out.html;
 let count=$(isTr?'#catalogCount':'#catalogUSCount');count.textContent=out.count.toLocaleString('es-ES')+(isTr?' valores TR':' valores EEUU');
 requestAnimationFrame(()=>observeTrLivePrices(box));
}
function resetCatalogColumns(mode){
 catalogState[mode].order=CATALOG_COLUMNS[mode].map(c=>c.id);catalogState[mode].filters={};catalogState[mode].sort=mode==='tr'?'tickerTr':'ticker';catalogState[mode].dir=1;catalogSaveOrder(mode);renderCatalogTable(mode);
}
function renderCatalog(){if(renderProfileView('catalog'))return;renderCatalogTable('tr')}
function renderCatalogUS(){if(renderProfileView('catalogUS'))return;renderCatalogTable('us')}
function renderFuture(){
 let h=+$('#futureHorizon').value,t=$('#futureType').value,tr=$('#futureTrOnly').checked,now=Date.now();
 let filtered=(db.events||[]).filter(e=>futureWindowEvent(e,h,now)&&(t==='all'||e.type===t)&&(!tr||e.tradeRepublicVerified));
 let groups=groupFutureEvents(filtered);
 $('#futureResults').innerHTML=groups.length?groups.slice(0,180).map((g,i)=>{
  let e=g.first,s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  let count=g.items.length,label=count===1?EL(e):(count+' catalizadores'),when=eventWhen(e);
  return '<article class="stock-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,!!s.tradeRepublicVerified)+'</div><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+E(when)+'</b><span class="event-type">'+E(label)+'</span>'+(e.tradeRepublicVerified?'<span class="pill ok">TR</span>':'')+'<span class="open-arrow">→</span></div></div></article>';
 }).join(''):'<div class="empty-state">No hay catalizadores desde ahora hasta '+h+' día'+(h===1?'':'s')+' vista con estos filtros.</div>';
}

function renderCalendar(){
 let rows=[...(db.events||[])].sort((x,y)=>new Date(y.date)-new Date(x.date));
 $('#calendarResults').innerHTML=rows.length?rows.slice(0,400).map((e,i)=>{
  let s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  return '<article class="stock-card dense-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,!!s.tradeRepublicVerified)+'</div><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+DF(e.date)+'</b><span class="event-type">'+E(EL(e))+'</span><span class="open-arrow">→</span></div></div></article>';
 }).join(''):'<div class="empty-state">Sin eventos o noticias disponibles.</div>';
}

function status(){}
function render(){renderMarketLeaders();renderFavorites();renderEntry();renderFuture();renderCalendar();if(state.currentView==='catalog')renderCatalog();if(state.currentView==='catalogUS')renderCatalogUS();status();requestAnimationFrame(()=>observeTrLivePrices(document))}
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
   ['trLivePrice','trLiveBid','trLiveAsk','trLivePre','trLiveOpen','trLiveChangePct','trLiveQuality','trLiveUpdatedAt','trLiveReceivedAt','trLiveDirection','trLiveDirectionAt'].forEach(k=>{if(old[k]!==undefined)s[k]=old[k]});
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
function show(v,preserveProfile=false){if(!V[v])return;if(!preserveProfile){state.profileKey=null;state.profileReason='';}state.currentView=v;document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));$('#view-'+v).classList.add('active');document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));$('#sidebar').classList.remove('open');saveUiState();render()}
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
 if(b){
  e.preventDefault();e.stopPropagation();
  toggleFavorite(b.dataset.favKey);
  return;
 }
 let back=e.target.closest&&e.target.closest('[data-profile-back]');
 if(back){
  e.preventDefault();e.stopPropagation();
  state.profileKey=null;
   state.profileReason='';
   saveUiState();
   render();
   requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'smooth'}));
  return;
 }
 let row=e.target.closest&&e.target.closest('[data-stock-key]');
 if(row){
  if(e.target.closest&&e.target.closest('.external-links,.event-sources,.event-link'))return;
  e.preventDefault();e.stopPropagation();
  let s=stockByKey(row.dataset.stockKey);
  if(s)openStock(s,row.dataset.stockReason||'');
 }
});
document.addEventListener('keydown',e=>{
 let row=e.target.closest&&e.target.closest('[data-stock-key]');
 if(!row||!['Enter',' '].includes(e.key))return;
 if(e.target.closest&&e.target.closest('.fav-star'))return;
 e.preventDefault();
 let s=stockByKey(row.dataset.stockKey);
 if(s)openStock(s,row.dataset.stockReason||'');
});
$('#sessionSelect').addEventListener('change',e=>{state.session=e.target.value;renderEntry()});
function setPreset(value){
 state.preset=value;
 $('#presetSelect').value=value;
 let opt=$('.preset-option[data-value="'+value+'"]');
 if(opt){$('#presetLabel').textContent=opt.querySelector('span').textContent;$$('.preset-option').forEach(x=>x.classList.toggle('active',x===opt))}
 state.filters=preset(state.preset);
 if(state.preset==='afterhours'){state.session='postmarket';$('#sessionSelect').value='postmarket'}
 toUI(state.filters);lockAllCriteria();renderEntry();
}
$('#presetSelect').addEventListener('change',e=>setPreset(e.target.value));
$('#presetTrigger').addEventListener('click',e=>{e.stopPropagation();let open=$('#presetPicker').classList.toggle('open');$('#presetTrigger').setAttribute('aria-expanded',open?'true':'false')});
$$('.preset-option').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();setPreset(b.dataset.value);$('#presetPicker').classList.remove('open');$('#presetTrigger').setAttribute('aria-expanded','false')}));
document.addEventListener('click',e=>{if(!$('#presetPicker').contains(e.target)){$('#presetPicker').classList.remove('open');$('#presetTrigger').setAttribute('aria-expanded','false')}});
$('#applyFilters').addEventListener('click',()=>{state.filters=fromUI();renderEntry()});$('#resetFilters').addEventListener('click',()=>{state.filters=preset(state.preset);toUI(state.filters);lockAllCriteria();renderEntry()});
$('#toggleFilters').addEventListener('click',()=>$('#filterDetails').open=!$('#filterDetails').open);
$$('.field-lock').forEach(btn=>btn.addEventListener('click',()=>{let id=btn.dataset.target,input=$('#'+id);lockCriterion(id,!input.readOnly);if(!input.readOnly){input.focus();input.select()}}));
document.addEventListener('toggle',e=>{let d=e.target;if(d&&d.matches&&d.matches('details.stock-disclosure')&&d.open)d.querySelectorAll('.mini-chart').forEach(loadMiniChart)},true);
$$('[data-tab-group="entryMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{state.entryMarket=b.dataset.tab;$$('[data-tab-group="entryMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));renderEntry()}));
['futureHorizon','futureType','futureTrOnly'].forEach(id=>$('#'+id).addEventListener('change',renderFuture));let catalogSearchTimer=null;$('#catalogSearch').addEventListener('input',()=>{clearTimeout(catalogSearchTimer);catalogSearchTimer=setTimeout(renderCatalog,160)});$('#catalogUSSearch').addEventListener('input',()=>{clearTimeout(catalogSearchTimer);catalogSearchTimer=setTimeout(renderCatalogUS,160)});
['refreshEntry','refreshFuture'].forEach(id=>$('#'+id).addEventListener('click',()=>load(true)));
catalogLoadLayout();let catalogFilterTimer=null,catalogDrag=null;
document.addEventListener('click',e=>{
 let sort=e.target.closest&&e.target.closest('[data-catalog-sort]');
 if(sort){
  e.preventDefault();e.stopPropagation();
  let mode=sort.dataset.catalogMode,key=sort.dataset.catalogSort,cur=catalogUi[mode].sort;
  catalogUi[mode].sort={key,dir:cur.key===key&&cur.dir==='asc'?'desc':'asc'};
  catalogSaveLayout();renderCatalogMode(mode);return;
 }
 let reset=e.target.closest&&e.target.closest('.catalog-reset-columns');
 if(reset){e.preventDefault();catalogResetColumns(reset.dataset.catalogMode);return}
 let clear=e.target.closest&&e.target.closest('.catalog-clear-filters');
 if(clear){e.preventDefault();catalogClearFilters(clear.dataset.catalogMode);return}
});
document.addEventListener('input',e=>{
 let input=e.target.closest&&e.target.closest('.catalog-col-filter');if(!input)return;
 let mode=input.dataset.catalogMode,key=input.dataset.catalogFilter;
 catalogUi[mode].filters[key]=input.value;
 clearTimeout(catalogFilterTimer);
 catalogFilterTimer=setTimeout(()=>renderCatalogMode(mode),180);
});
document.addEventListener('dragstart',e=>{
 let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(!th)return;
 catalogDrag={mode:th.dataset.catalogMode,key:th.dataset.catalogCol};th.classList.add('dragging');
 if(e.dataTransfer)e.dataTransfer.effectAllowed='move';
});
document.addEventListener('dragend',e=>{let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(th)th.classList.remove('dragging');catalogDrag=null});
document.addEventListener('dragover',e=>{
 let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(!th||!catalogDrag||catalogDrag.mode!==th.dataset.catalogMode)return;
 e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move';
});
document.addEventListener('drop',e=>{
 let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(!th||!catalogDrag||catalogDrag.mode!==th.dataset.catalogMode)return;
 e.preventDefault();catalogMoveColumn(catalogDrag.mode,catalogDrag.key,th.dataset.catalogCol);catalogDrag=null;
});

document.addEventListener('input',e=>{
 let f=e.target.closest&&e.target.closest('.catalog-col-filter');if(!f)return;
 catalogState[f.dataset.mode].filters[f.dataset.col]=f.value;renderCatalogTable(f.dataset.mode);
 let next=document.querySelector('.catalog-col-filter[data-mode="'+f.dataset.mode+'"][data-col="'+f.dataset.col+'"]');if(next){next.focus();next.setSelectionRange(next.value.length,next.value.length)}
});
document.addEventListener('click',e=>{
 let reset=e.target.closest&&e.target.closest('.catalog-reset-columns');if(reset){resetCatalogColumns(reset.dataset.catalogMode);return}
 let th=e.target.closest&&e.target.closest('.catalog-table thead tr:first-child th[data-catalog-col]');if(!th)return;
 let mode=th.dataset.mode,id=th.dataset.catalogCol,st=catalogState[mode];if(st.sort===id)st.dir*=-1;else{st.sort=id;st.dir=1}renderCatalogTable(mode);
});
let draggedCatalogCol=null;
document.addEventListener('dragstart',e=>{
 let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(!th)return;
 draggedCatalogCol={mode:th.dataset.mode,id:th.dataset.catalogCol};th.classList.add('dragging');if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',th.dataset.catalogCol)}
});
document.addEventListener('dragend',()=>{document.querySelectorAll('.catalog-table th.dragging,.catalog-table th.drag-over').forEach(x=>x.classList.remove('dragging','drag-over'));draggedCatalogCol=null});
document.addEventListener('dragover',e=>{let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(!th||!draggedCatalogCol||th.dataset.mode!==draggedCatalogCol.mode)return;e.preventDefault();th.classList.add('drag-over')});
document.addEventListener('dragleave',e=>{let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(th)th.classList.remove('drag-over')});
document.addEventListener('drop',e=>{
 let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(!th||!draggedCatalogCol||th.dataset.mode!==draggedCatalogCol.mode)return;e.preventDefault();
 let mode=draggedCatalogCol.mode,order=[...catalogLoadOrder(mode)],from=order.indexOf(draggedCatalogCol.id),to=order.indexOf(th.dataset.catalogCol);if(from<0||to<0||from===to)return;
 order.splice(from,1);order.splice(to,0,draggedCatalogCol.id);catalogState[mode].order=order;catalogSaveOrder(mode);renderCatalogTable(mode);
});
restoreUiState();toUI(state.filters);lockAllCriteria();initLeadersDock();initTrLive();clock();window.addEventListener('scroll',queueUiSave,{passive:true});window.addEventListener('beforeunload',saveUiState);setInterval(clock,1000);setInterval(()=>load(false),15000);load(true);
