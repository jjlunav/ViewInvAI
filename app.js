const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DATA='data/market.json', DATA_VERSION='data/market-version.json', DATA_REFRESH_MS=60000, CUSTOM_FILTER_KEY='viewinvai:customFilter:v1', FAV_KEY='viewinvai:favorites:v1', LEADERS_PIN_KEY='viewinvai:leadersPinned:v1', UI_KEY='viewinvai:ui:v1', STOCK_VIEWS_KEY='viewinvai:stockViews:v1';
function migrateLegacyBrandStorage(){
 const pairs=[
  ['viewinvai:customFilter:v1','catalystpulse:customFilter:v1'],
  ['viewinvai:favorites:v1','catalystpulse:favorites:v1'],
  ['viewinvai:leadersPinned:v1','catalystpulse:leadersPinned:v1'],
  ['viewinvai:ui:v1','catalystpulse:ui:v1'],
  ['viewinvai:recommendation:v1','catalystpulse:recommendation:v1'],
  ['viewinvai:theme:v1','catalystpulse:theme:v1'],
  ['viewinvai:catalogColumns:tr:v1','catalystpulse:catalogColumns:tr:v1'],
  ['viewinvai:catalogColumns:us:v1','catalystpulse:catalogColumns:us:v1']
 ];
 try{
  for(let [next,legacy] of pairs){
   if(localStorage.getItem(next)!==null)continue;
   let value=localStorage.getItem(legacy);
   if(value!==null)localStorage.setItem(next,value);
  }
 }catch(_){}
}
migrateLegacyBrandStorage();
let db={stocks:[],events:[],meta:{}}, loading=false, lastDataStamp='';
let stockIndexByKey=new Map(),stockIndexByTickerExchange=new Map(),stockIndexByIsin=new Map(),eventIndexByRef=new Map();

function tickerRef(ticker,exchange='*'){
 let t=String(ticker||'').trim().toUpperCase(),ex=String(exchange||'*').trim().toUpperCase()||'*';
 return t?'t:'+ex+':'+t:'';
}
function isinRef(isin){
 let v=String(isin||'').trim().toUpperCase();
 return v?'i:'+v:'';
}
function pushIndex(map,key,value){
 if(!key)return;
 let rows=map.get(key);
 if(!rows){rows=[];map.set(key,rows)}
 rows.push(value);
}
function rebuildMarketIndexes(){
 stockIndexByKey=new Map();stockIndexByTickerExchange=new Map();stockIndexByIsin=new Map();eventIndexByRef=new Map();
 for(let stock of (db.stocks||[])){
  let key=stockKey(stock);if(key)stockIndexByKey.set(key,stock);
  for(let [ticker,exchange] of [[stock.ticker,stock.exchange],[stock.trTicker,stock.trExchange||'LSX']]){
   let exact=tickerRef(ticker,exchange),any=tickerRef(ticker,'*');
   if(exact&&!stockIndexByTickerExchange.has(exact))stockIndexByTickerExchange.set(exact,stock);
   if(any&&!stockIndexByTickerExchange.has(any))stockIndexByTickerExchange.set(any,stock);
  }
  for(let value of [stock.isin,stock.usIsin,stock.trIsin]){
   let ref=isinRef(value);if(ref&&!stockIndexByIsin.has(ref))stockIndexByIsin.set(ref,stock);
  }
 }
 for(let event of (db.events||[])){
  let refs=new Set();
  let ir=isinRef(event.isin);if(ir)refs.add(ir);
  let exact=tickerRef(event.ticker,event.exchange),any=tickerRef(event.ticker,'*');
  if(exact)refs.add(exact);if(any)refs.add(any);
  for(let ref of refs)pushIndex(eventIndexByRef,ref,event);
 }
}
function stockForEvent(event){
 if(!event)return null;
 let byIsin=stockIndexByIsin.get(isinRef(event.isin));if(byIsin)return byIsin;
 return stockIndexByTickerExchange.get(tickerRef(event.ticker,event.exchange))||
  stockIndexByTickerExchange.get(tickerRef(event.ticker,'*'))||null;
}
if('scrollRestoration' in history)history.scrollRestoration='manual';
let uiRestoredScroll=false;
let favorites=readFavorites();
let state={entryMarket:'tr',session:'auto',preset:'intraday',profileKey:null,profileReason:'',profileOriginView:null,profileOriginScroll:0,profilePreferTr:null,currentView:'home',savedScrollY:0};
const V={home:'01 Mercados',recommendation:'02 Pulso IA',entry:'03 Radar de entrada',alerts:'04 Avisos',future:'05 Potencial futuro',portfolios:'06 Carteras',catalog:'07 Catálogo Trade Republic',catalogUS:'08 Catálogo EEUU',funds:'09 Fondos y ETFs',heatmap:'10 Mapa de calor',settings:'11 Settings'};
const P={
 short:{minChange:1,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:true,sort:'score'},
 medium:{minChange:0,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:true,illiquid:true,sort:'score'},
 broad:{minChange:0,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:false,sort:'score'},
 intraday:{minChange:2,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:true,sort:'score'},
 exploded:{minChange:20,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:false,sort:'change'},
 postmarketExplosion:{minChange:0,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:false,sort:'change'},
 premarketExplosion:{minChange:0,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:false,sort:'change'},
 emerging:{minChange:0,maxChange:12,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:true,sort:'emerging'},
 strict:{minChange:1,maxChange:0,minRelVolume:1.3,minAdx:22,minRsi:42,maxRsi:68,minVolume:0,trend:true,illiquid:true,sort:'score'}
};
function currentRouteState(){
 try{
  let m=String(location.hash||'').match(/^#app\/([^/]+)(?:\/stock\/(.+))?$/);
  if(!m)return null;
  let view=decodeURIComponent(m[1]||'');
  if(view==='calendar')view='future';
  if(!V[view])return null;
  return {view,profileKey:m[2]?decodeURIComponent(m[2]):null};
 }catch(_){return null}
}
function restoreUiState(){
 try{
  let x=JSON.parse(localStorage.getItem(UI_KEY)||'{}');
  if(x&&x.view==='calendar')x.view='future';
  if(x&&V[x.view])state.currentView=x.view;
  if(x&&['tr','us'].includes(x.entryMarket))state.entryMarket=x.entryMarket;
  // Every fresh web/APK session starts from the canonical US market clock.
  // A manual Radar override remains valid only until the next app launch.
  state.session='auto';
  let restoredPreset=x&&x.preset==='afterhours'?'postmarketExplosion':x&&x.preset;
  if(restoredPreset&&(P[restoredPreset]||restoredPreset==='custom'))state.preset=restoredPreset;

  if(x&&x.filters&&typeof x.filters==='object'){
   let base=state.preset==='custom'?(savedCustomPreset()||preset('broad')):preset(state.preset);
   let numeric=['minChange','maxChange','minRelVolume','minAdx','minRsi','maxRsi','minVolume'];
   for(let k of numeric){let v=N(x.filters[k]);if(v!==null)base[k]=v}
   if(typeof x.filters.trend==='boolean')base.trend=x.filters.trend;
   if(typeof x.filters.illiquid==='boolean')base.illiquid=x.filters.illiquid;
   if(['score','change','emerging'].includes(x.filters.sort))base.sort=x.filters.sort;
   state.filters=base;
  }

  if(x&&x.profileKey)state.profileKey=x.profileKey;
  if(x&&x.profileReason)state.profileReason=x.profileReason;
  if(x&&V[x.profileOriginView])state.profileOriginView=x.profileOriginView;
  state.profileOriginScroll=N(x&&x.profileOriginScroll)??0;
  state.profilePreferTr=x&&x.profilePreferTr===true?true:x&&x.profilePreferTr===false?false:null;
  state.savedScrollY=N(x&&x.scrollY)??0;

  let route=currentRouteState();
  let hs=history.state&&history.state.__viewinvai===1?history.state:null;
  if(route){
   state.currentView=route.view;
   state.profileKey=route.profileKey||null;
   if(hs&&hs.view===route.view){
    state.profileReason=hs.profileReason||state.profileReason||'';
    state.profileOriginView=V[hs.profileOriginView]?hs.profileOriginView:state.profileOriginView;
    state.profileOriginScroll=N(hs.profileOriginScroll)??state.profileOriginScroll;
    state.profilePreferTr=hs.profilePreferTr===true?true:hs.profilePreferTr===false?false:state.profilePreferTr;
    state.savedScrollY=N(hs.scrollY)??state.savedScrollY;
   }
  }
 }catch(_){}

 document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id==='view-'+state.currentView));
 document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.view===state.currentView));

 let session=$('#sessionSelect');if(session)session.value=state.session;
 let presetSelect=$('#presetSelect');if(presetSelect)presetSelect.value=state.preset;
 let presetOpt=$('.preset-option[data-value="'+state.preset+'"]');
 if(presetOpt){
  let label=presetOpt.querySelector('span');
  if(label&&$('#presetLabel'))$('#presetLabel').textContent=label.textContent;
  document.querySelectorAll('.preset-option').forEach(el=>el.classList.toggle('active',el===presetOpt));
 }
 $$('[data-tab-group="entryMarket"] .tab').forEach(el=>el.classList.toggle('active',el.dataset.tab===state.entryMarket));

 let quick=$('#stockQuickDetail');
 if(state.profileKey){
  document.body.classList.add('stock-detail-open');
  if(quick)quick.classList.remove('is-hidden');
 }else{
  document.body.classList.remove('stock-detail-open');
  if(quick)quick.classList.add('is-hidden');
 }
}
function saveUiState(){
 try{
  localStorage.setItem(UI_KEY,JSON.stringify({
   view:state.currentView||'home',
   entryMarket:state.entryMarket,
   session:state.session,
   preset:state.preset,
   filters:state.filters,
   profileKey:state.profileKey||null,
   profileReason:state.profileReason||'',
   profileOriginView:state.profileOriginView||null,
   profileOriginScroll:Math.max(0,Math.round(state.profileOriginScroll||0)),
   profilePreferTr:state.profilePreferTr,
   scrollY:Math.max(0,Math.round(window.scrollY||0))
  }));
 }catch(_){}
}
let saveUiTimer=null;
function syncCurrentHistorySnapshot(){
 if(!appHistoryReady||appHistoryRestoring)return;
 try{
  let snap=appHistorySnapshot(appHistoryDepth());
  history.replaceState(snap,'',appHistoryUrl(snap));
 }catch(_){}
}
function queueUiSave(){
 clearTimeout(saveUiTimer);
 saveUiTimer=setTimeout(()=>{saveUiState();syncCurrentHistorySnapshot()},120);
}
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

function N(v){
 if(v===null||v===undefined)return null;
 if(typeof v==='string'&&!v.trim())return null;
 v=Number(v);return Number.isFinite(v)?v:null
}
function E(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function F(v,d=2){v=N(v);return v===null?'—':v.toLocaleString('es-ES',{maximumFractionDigits:d})}
function I(v){v=N(v);return v===null?'—':Math.round(v).toLocaleString('es-ES')}
function PR(v){v=N(v);return v===null?'—':v.toLocaleString('es-ES',{maximumFractionDigits:v<1?6:4})}
function money(v,symbol){
 v=N(v);if(v===null)return symbol+'—';
 return symbol+v.toLocaleString('es-ES',{maximumFractionDigits:v<1?6:4});
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
 let raw=String(key||'').trim().toUpperCase();
 if(!raw)return null;
 let direct=stockIndexByKey.get(raw);if(direct)return direct;
 if(raw.startsWith('I:'))return stockIndexByIsin.get(raw)||null;
 if(/^[A-Z]{2}[A-Z0-9]{10}$/.test(raw)){
  let byIsin=stockIndexByIsin.get(isinRef(raw));if(byIsin)return byIsin;
 }
 if(raw.startsWith('T:')){
  let parts=raw.split(':');
  if(parts.length>=3){
   let exchange=parts[1],ticker=parts.slice(2).join(':');
   let byTicker=stockIndexByTickerExchange.get(tickerRef(ticker,exchange))||stockIndexByTickerExchange.get(tickerRef(ticker,'*'));
   if(byTicker)return byTicker;
  }
 }
 let colon=raw.indexOf(':');
 if(colon>0){
  let exchange=raw.slice(0,colon),ticker=raw.slice(colon+1);
  let byTicker=stockIndexByTickerExchange.get(tickerRef(ticker,exchange))||stockIndexByTickerExchange.get(tickerRef(ticker,'*'));
  if(byTicker)return byTicker;
 }
 return stockIndexByTickerExchange.get(tickerRef(raw,'*'))||null;
}
let stockViews=readStockViews();
function readStockViews(){
 try{let x=JSON.parse(localStorage.getItem(STOCK_VIEWS_KEY)||'{}');return x&&typeof x==='object'?x:{}}catch(_){return{}}
}
function saveStockViews(){try{localStorage.setItem(STOCK_VIEWS_KEY,JSON.stringify(stockViews))}catch(_){}}
function recordStockView(key){
 key=String(key||'').toUpperCase();if(!key)return;
 const now=Date.now(),cutoff=now-7*86400000;
 let x=stockViews[key]||{count:0,last:0,times:[]};
 let times=Array.isArray(x.times)?x.times.map(Number).filter(t=>Number.isFinite(t)&&t>=cutoff):[];
 times.push(now);x.times=times.slice(-250);x.count=x.times.length;x.last=now;stockViews[key]=x;saveStockViews();
}
function stockViewCount(s){
 let x=stockViews[stockKey(s)]||{},cutoff=Date.now()-7*86400000;
 if(Array.isArray(x.times))return x.times.map(Number).filter(t=>Number.isFinite(t)&&t>=cutoff).length;
 let last=N(x.last)??0;return last>=cutoff?Math.min(1,Math.max(0,N(x.count)??0)):0;
}

function stockOpenAttrs(s,reason='',preferTr=null){
 let pref=preferTr===true?'1':preferTr===false?'0':'';
 return ' data-stock-key="'+E(stockKey(s))+'"'+(reason?' data-stock-reason="'+E(reason)+'"':'')+(pref?' data-stock-prefer-tr="'+pref+'"':'')+' role="button" tabindex="0"';
}
function tickerDisplay(s,preferTr=false){
 let us=String((s&&s.ticker)||'');
 let tr=String((s&&s.trTicker)||'');
 if(preferTr&&trTradable(s)){
  return '<strong>'+E(tr)+'</strong><small class="ticker-us-ref">EEUU '+E((s.exchange||'')+':'+us)+'</small>';
 }
 return '<strong>'+E(us)+'</strong>';
}

function inferProfilePreferTr(s){
 if(state.currentView==='catalog')return true;
 if(state.currentView==='catalogUS')return false;
 if(state.currentView==='entry')return state.entryMarket==='tr'&&trTradable(s);
 return false;
}
function openStock(s,reason='',preferTr=null){
 if(!s)return;
 recordStockView(stockKey(s));
 replaceCurrentAppHistory();
 state.profileKey=stockKey(s);
 state.profileReason=reason||'';
 state.profileOriginView=state.currentView;
 state.profileOriginScroll=Math.max(0,Math.round(window.scrollY||0));
 state.profilePreferTr=preferTr===true?true:preferTr===false?false:inferProfilePreferTr(s);
 saveUiState();renderQuickProfile();document.body.classList.add('stock-detail-open');
 let box=$('#stockQuickDetail');if(box)box.classList.remove('is-hidden');
 pushCurrentAppHistory();
 requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'smooth'}));
}
function closeQuickProfile(restoreScroll=true){
 if(appHistoryReady&&history.state&&history.state.__viewinvai===1&&history.state.profileKey){history.back();return}
 let y=state.profileOriginScroll||0;
 document.body.classList.remove('stock-detail-open');
 let box=$('#stockQuickDetail');if(box){box.classList.add('is-hidden');box.innerHTML=''}
 state.profileKey=null;state.profileReason='';state.profileOriginView=null;state.profileOriginScroll=0;state.profilePreferTr=null;
 saveUiState();
 if(restoreScroll)requestAnimationFrame(()=>window.scrollTo({top:y,behavior:'smooth'}));
}

function favButton(s,preferTr=null){
 let key=stockKey(s),on=favorites.has(key);
 if(preferTr!==true&&preferTr!==false)preferTr=inferProfilePreferTr(s);
 let pref=preferTr===true?'1':'0';
 let title=on?'Gestionar carteras':'Añadir a una cartera';
 return '<button type="button" class="fav-star'+(on?' active':'')+'" data-fav-key="'+E(key)+'" data-fav-prefer-tr="'+pref+'" title="'+title+'" aria-label="'+title+'">'+(on?'★':'☆')+'</button>';
}
function toggleFavorite(key,preferTr=null){
 if(!key)return;
 if(window.ViewInvAIPortfolios&&typeof window.ViewInvAIPortfolios.openStarMenu==='function'){
  window.ViewInvAIPortfolios.openStarMenu(key,preferTr);
  return;
 }
 if(favorites.has(key))favorites.delete(key);else favorites.add(key);
 saveFavorites();
 $$('.fav-star').forEach(b=>{
  if(b.dataset.favKey!==key)return;
  let on=favorites.has(key);
  b.classList.toggle('active',on);
  b.textContent=on?'★':'☆';
  b.title=on?'Gestionar carteras':'Añadir a una cartera';
  b.setAttribute('aria-label',b.title);
 });
 renderFavorites();
}
function compactVol(v){
 v=N(v);if(v===null)return'—';
 let a=Math.abs(v);
 if(a>=1e9)return F(v/1e9,1)+'B';
 if(a>=1e6)return F(v/1e6,1)+'M';
 if(a>=1e3)return F(v/1e3,1)+'K';
 return I(v);
}
function topGainers(kind,se){
 const change=s=>kind==='tr'?trLiveChange(s):SC(s,se);
 return db.stocks
  .filter(s=>kind==='tr'?trTradable(s):market(s,'us'))
  .filter(s=>change(s)!==null&&change(s)>0)
  .sort((a,b)=>(change(b)??-999)-(change(a)??-999))
  .slice(0,10);
}
function leaderItem(s,se,i,preferTr=false){
 return standardStockCard(s,i,{
  se,preferTr,context:'home-leader',rankLabel:'#'+(i+1),className:'leader-item unified-leader-card',
  hint:'Mercados · top de subidas',detailsHtml:''
 });
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
 let se=currentMarketSession(),usLabel=sessionStageLabel(se)+' · TOP 10 SUBIDAS',trLabel='LSX · TOP 10 SUBIDAS';
 let us=$('#leadersUS'),tr=$('#leadersTR');
 if($('#leadersSessionUS'))$('#leadersSessionUS').textContent=usLabel;
 if($('#leadersSessionTR'))$('#leadersSessionTR').textContent=trLabel;
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
 let se=currentMarketSession(),stocks=[...favorites].map(stockByKey).filter(Boolean);
 count.textContent=stocks.length;
 if(!stocks.length){
  box.innerHTML='<div class="favorites-empty"><span aria-hidden="true">☆</span><p>Pulsa la estrella de cualquier acción para guardarla aquí.</p></div>';
  return;
 }
 box.innerHTML=stocks.map(s=>standardStockCard(s,0,{
  se,preferTr:false,context:'favorites',rankLabel:'',className:'favorite-row unified-favorite-card',
  hint:'Favoritos',detailsHtml:''
 })).join('');
}
function status(){}
function renderCurrentView(){
 if(state.currentView==='home')renderHome();
 else if(state.currentView==='entry')renderEntry();
 else if(state.currentView==='recommendation')renderRecommendation();
 else if(state.currentView==='portfolios'){if(window.ViewInvAIPortfolios)window.ViewInvAIPortfolios.render()}
 else if(state.currentView==='funds'){if(window.ViewInvAIFunds)window.ViewInvAIFunds.render()}
 else if(state.currentView==='heatmap')renderHeatmap();
 else if(state.currentView==='future')renderFuture();
 else if(state.currentView==='alerts'){if(window.AppAlerts)window.AppAlerts.renderSettings()}
 else if(state.currentView==='catalog')renderCatalog();
 else if(state.currentView==='catalogUS')renderCatalogUS();
 else if(state.currentView==='settings')syncDeviceSettingsUi();
}
function render(){
 renderMarketLeaders();
 renderFavorites();
 if(document.body.classList.contains('stock-detail-open')&&state.profileKey){
  let box=$('#stockQuickDetail');
  if(box&&!box.querySelector('.profile-hero'))renderQuickProfile();
 }else renderCurrentView();
 status();
 requestAnimationFrame(()=>observeActiveTrLivePrices());
}
async function load(force=false){
 if(loading)return;
 loading=true;
 try{
  if(!force&&db.stocks.length&&lastDataStamp){
   try{
    let vr=await fetch(DATA_VERSION,{cache:'no-cache'});
    if(vr.ok){
     let v=await vr.json(),stamp=String(v&&v.updatedAt||'');
     if(stamp&&stamp===lastDataStamp)return;
    }
   }catch(_){}
  }
  let url=force?DATA+'?v='+Date.now():DATA;
  let r,j;
  try{
   r=await fetch(url,{cache:force?'reload':'no-cache'});
   if(!r.ok)throw Error(String(r.status));
   j=await r.json();
   if(!Array.isArray(j.stocks))throw Error('formato');
  }catch(remoteError){
   const native=!!(window.ViewInvAIRuntime&&window.ViewInvAIRuntime.isPackagedNative);
   if(!native)throw remoteError;
   console.warn('Remote market snapshot unavailable; using packaged fallback',remoteError);
   r=await fetch(DATA+'?local=1&v='+Date.now(),{cache:'no-store'});
   if(!r.ok)throw Error('fallback '+r.status);
   j=await r.json();
   if(!Array.isArray(j.stocks))throw Error('fallback formato');
  }
  let stamp=String((j.meta&&j.meta.updatedAt)||'');
  if(!force&&stamp&&stamp===lastDataStamp)return;
  lastDataStamp=stamp;
  let previous=new Map((db.stocks||[]).map(s=>[stockKey(s),s]));
  for(let s of j.stocks){
   let old=previous.get(stockKey(s));if(!old)continue;
   ['trLivePrice','trLiveBid','trLiveAsk','trLivePre','trLiveOpen','trLiveChangePct','trLiveQuality','trLiveUpdatedAt','trLiveReceivedAt','trLiveLastAt','trLiveBidAt','trLiveAskAt','trLiveDirection','trLiveDirectionAt','trLiveBidDirection','trLiveAskDirection','usLivePrice','usLiveBid','usLiveAsk','usLiveBidSize','usLiveAskSize','usLiveVolume','usLiveChangePct','usLiveTimestamp','usLiveMarketStatus','usLiveIsRealTime','usLiveSource','usLiveReceivedAt','usLiveDirection','usLiveDirectionAt','usLiveBidDirection','usLiveAskDirection'].forEach(k=>{if(old[k]!==undefined)s[k]=old[k]});
  }
  db={stocks:j.stocks,events:Array.isArray(j.events)?j.events:[],meta:j.meta||{}};
  rebuildMarketIndexes();
  render();
  if(window.AppAlerts)window.AppAlerts.evaluate('snapshot');
  if(!uiRestoredScroll){
   uiRestoredScroll=true;
   let y=state.savedScrollY||0;
   requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo(0,y)));
   setTimeout(()=>window.scrollTo(0,y),250);
  }
 }catch(e){
  console.error(e);
  if(!db.stocks.length)document.querySelectorAll('.stock-list').forEach(x=>x.innerHTML='<div class="empty-state">No se pudieron cargar los datos de mercado. Reintenta en unos instantes.</div>')
  return {refreshFailed:true};
 }finally{
  loading=false
 }
}
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
  if(db.stocks.length){
   renderMarketLeaders();renderFavorites();
   if(!document.body.classList.contains('stock-detail-open')&&['home','portfolios','future','recommendation'].includes(state.currentView))renderCurrentView();
  }
 }
}

let refreshFeedbackTimer=null;
function refreshFeedbackElement(){
 let el=$('#refreshFeedbackBanner');
 if(el)return el;
 el=document.createElement('div');
 el.id='refreshFeedbackBanner';
 el.className='refresh-feedback-banner';
 el.setAttribute('role','status');
 el.setAttribute('aria-live','polite');
 document.body.appendChild(el);
 return el;
}
function showRefreshFeedback(message,tone='ok'){
 let el=refreshFeedbackElement();
 clearTimeout(refreshFeedbackTimer);
 el.textContent=message;
 el.dataset.tone=tone;
 el.classList.add('show');
 refreshFeedbackTimer=setTimeout(()=>el.classList.remove('show'),1900);
}
async function runRefreshFeedback(action,getStamp=null){
 const before=typeof getStamp==='function'?String(getStamp()||''):'';
 showRefreshFeedback('Actualizando…','loading');
 try{
  const result=await action();
  if(result===false||(result&&result.refreshFailed)){
   showRefreshFeedback('No se pudo actualizar','error');
   return result;
  }
  const after=typeof getStamp==='function'?String(getStamp()||''):'';
  const unchanged=!!(before&&after&&before===after);
  showRefreshFeedback(unchanged?'Ya estaba actualizado':'Actualizado',unchanged?'same':'ok');
  return result;
 }catch(error){
  console.warn('Manual refresh failed',error);
  showRefreshFeedback('No se pudo actualizar','error');
  return null;
 }
}
window.ViewInvAIRefreshFeedback={show:showRefreshFeedback,run:runRefreshFeedback};

$('#mobileMenu')?.addEventListener('click',()=>$('#sidebar')?.classList.toggle('open'));
['refreshHome','refreshEntry','refreshFuture','refreshRecommendation','refreshHeatmap'].forEach(id=>$('#'+id)?.addEventListener('click',()=>runRefreshFeedback(()=>load(true),()=>lastDataStamp)));
