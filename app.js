const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DATA='data/market.json', DATA_VERSION='data/market-version.json', DATA_REFRESH_MS=60000, MAX_TR_LIVE_SUBSCRIPTIONS=120, CUSTOM_FILTER_KEY='viewinvai:customFilter:v1', FAV_KEY='viewinvai:favorites:v1', LEADERS_PIN_KEY='viewinvai:leadersPinned:v1', UI_KEY='viewinvai:ui:v1', THEME_KEY='viewinvai:theme:v1', STOCK_VIEWS_KEY='viewinvai:stockViews:v1';
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
  let exact=tickerRef(stock.ticker,stock.exchange),any=tickerRef(stock.ticker,'*');
  if(exact&&!stockIndexByTickerExchange.has(exact))stockIndexByTickerExchange.set(exact,stock);
  if(any&&!stockIndexByTickerExchange.has(any))stockIndexByTickerExchange.set(any,stock);
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
const TR_LIVE_DIRECT='wss://api.traderepublic.com';
if('scrollRestoration' in history)history.scrollRestoration='manual';
function trProxyUrl(){return (location.protocol==='https:'?'wss://':'ws://')+location.host+'/api/tr-live'}
let trLive={ws:null,connected:false,connecting:false,seq:1,subByKey:new Map(),keyBySub:new Map(),payloadBySub:new Map(),wanted:new Set(),reconnectTimer:null,reconnectAttempt:0,observer:null,usingDirect:false,proxyFailures:0,lastDataAt:0};
let usLive={busy:false,lastFetchAt:0};
let fxLive={rate:null,updatedAt:0,busy:false};
let tvChartAvailability=new Map();
let uiRestoredScroll=false;
let favorites=readFavorites();
let state={entryMarket:'tr',session:'auto',preset:'intraday',profileKey:null,profileReason:'',profileOriginView:null,profileOriginScroll:0,profilePreferTr:null,currentView:'home',savedScrollY:0};
const SETTINGS_KEY='viewinvai:settings:v1';
let deviceSettings=readDeviceSettings(),screenWakeLock=null,wakeLockBusy=false;
function readDeviceSettings(){
 let base={keepScreenAwake:false};
 try{
  let raw=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'null');
  if(raw&&typeof raw==='object'&&typeof raw.keepScreenAwake==='boolean')base.keepScreenAwake=raw.keepScreenAwake;
 }catch(_){}
 return base;
}
function saveDeviceSettings(){try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(deviceSettings))}catch(_){}}
function setWakeLockStatus(text,mode=''){
 let el=$('#keepScreenAwakeStatus');if(!el)return;
 el.textContent=text;el.classList.toggle('active',mode==='active');el.classList.toggle('error',mode==='error');
}
function syncDeviceSettingsUi(){
 let toggle=$('#keepScreenAwake');if(toggle)toggle.checked=!!deviceSettings.keepScreenAwake;
 if(!deviceSettings.keepScreenAwake){setWakeLockStatus('Desactivado');return}
 if(!('wakeLock' in navigator)||!navigator.wakeLock||typeof navigator.wakeLock.request!=='function'){setWakeLockStatus('No compatible','error');return}
 if(screenWakeLock&&!screenWakeLock.released)setWakeLockStatus('Activo','active');
 else if(document.visibilityState!=='visible')setWakeLockStatus('En pausa');
 else setWakeLockStatus('Pendiente de activar');
}

let pushBackendConfigured=null;
async function refreshPushBackendStatus(){
 try{
  let response=await fetch('/api/backend/status',{cache:'no-store'});
  if(!response.ok)return;
  let data=await response.json();
  pushBackendConfigured=data&&data.push===true;
  renderPushSettingsStatus();
 }catch(_){}
}
function renderPushSettingsStatus(detail=null){
 let status=$('#pushNotificationStatus'),button=$('#enablePushNotifications');
 if(!status||!button)return;
 let auth=window.ViewInvAIAuth;
 if(!auth){
  status.textContent='Comprobando…';button.disabled=true;return;
 }
 if(!auth.isNative?.()){
  status.textContent='Solo APK Android';button.disabled=true;return;
 }
 if(!auth.hasNativeMessaging?.()){
  status.textContent='APK pendiente de actualizar';button.disabled=true;return;
 }
 if(detail&&detail.enabled===true){
  status.textContent=pushBackendConfigured===false?'Dispositivo activo · servidor pendiente':'Activo';
  status.classList.toggle('active',pushBackendConfigured!==false);
  status.classList.toggle('error',pushBackendConfigured===false);
  button.disabled=false;return;
 }
 status.classList.remove('active');
 if(detail&&detail.permission==='denied'){
  status.textContent='Permiso denegado';status.classList.add('error');button.disabled=false;return;
 }
 if(detail&&detail.error){
  status.textContent='No disponible';status.classList.add('error');button.disabled=false;return;
 }
 status.classList.remove('error');
 if(auth.getUser?.()&&pushBackendConfigured===false)status.textContent='Servidor push pendiente';
 else status.textContent=auth.getUser?.()?'Preparado para activar':'Inicia sesión';
 button.disabled=!auth.getUser?.();
}
async function retryPushRegistration(){
 let auth=window.ViewInvAIAuth;
 if(!auth?.ensurePushRegistration)return;
 let button=$('#enablePushNotifications');if(button){button.disabled=true;button.textContent='Activando…'}
 try{
  let ok=await auth.ensurePushRegistration();
  renderPushSettingsStatus({enabled:!!ok});
 }finally{
  if(button){button.textContent='Activar / reintentar';button.disabled=false}
 }
}

let accountAnalysisSettings=null,analysisSettingsBusy=false;
function clampSetting(value,min,max,fallback){
 let n=Math.round(Number(value));return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;
}
function renderAnalysisSettings(settings=null){
 accountAnalysisSettings=settings&&typeof settings==='object'?settings:null;
 const map={
  analysisPositionsMinutes:['analysis_positions_minutes',5,240,10],
  analysisWatchlistMinutes:['analysis_watchlist_minutes',10,1440,30],
  minBuyConfidence:['min_buy_confidence',60,99,85],
  minSellConfidence:['min_sell_confidence',60,99,80],
  notifyScoreChange:['notify_score_change',5,60,20]
 };
 for(const [id,[key,min,max,fallback]] of Object.entries(map)){
  let el=$('#'+id);if(!el)continue;
  let raw=accountAnalysisSettings&&accountAnalysisSettings[key];
  el.value=clampSetting(raw,min,max,fallback);
  el.disabled=!accountAnalysisSettings||analysisSettingsBusy;
 }
 let button=$('#saveAnalysisSettings');if(button)button.disabled=!accountAnalysisSettings||analysisSettingsBusy;
 let status=$('#analysisSettingsStatus');if(status){
  status.textContent=accountAnalysisSettings?(analysisSettingsBusy?'Guardando…':'Sincronizado con tu cuenta.'):'Inicia sesión para sincronizar estos ajustes.';
 }
}
async function saveAnalysisSettings(){
 if(analysisSettingsBusy||!accountAnalysisSettings||!window.ViewInvAIAuth||typeof window.ViewInvAIAuth.apiFetch!=='function')return;
 analysisSettingsBusy=true;renderAnalysisSettings(accountAnalysisSettings);
 try{
  let body={
   analysisPositionsMinutes:clampSetting($('#analysisPositionsMinutes')?.value,5,240,10),
   analysisWatchlistMinutes:clampSetting($('#analysisWatchlistMinutes')?.value,10,1440,30),
   minBuyConfidence:clampSetting($('#minBuyConfidence')?.value,60,99,85),
   minSellConfidence:clampSetting($('#minSellConfidence')?.value,60,99,80),
   notifyScoreChange:clampSetting($('#notifyScoreChange')?.value,5,60,20)
  };
  let response=await window.ViewInvAIAuth.apiFetch('/api/settings',{method:'PATCH',body:JSON.stringify(body)});
  let data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'No se pudieron guardar los ajustes.');
  accountAnalysisSettings=data.settings||accountAnalysisSettings;
  let status=$('#analysisSettingsStatus');if(status)status.textContent='Ajustes guardados.';
 }catch(e){
  let status=$('#analysisSettingsStatus');if(status)status.textContent=e&&e.message?e.message:'No se pudieron guardar los ajustes.';
 }finally{
  analysisSettingsBusy=false;renderAnalysisSettings(accountAnalysisSettings);
 }
}
async function acquireScreenWakeLock(){
 if(wakeLockBusy||!deviceSettings.keepScreenAwake||document.visibilityState!=='visible')return;
 if(screenWakeLock&&!screenWakeLock.released){syncDeviceSettingsUi();return}
 if(!('wakeLock' in navigator)||!navigator.wakeLock||typeof navigator.wakeLock.request!=='function'){syncDeviceSettingsUi();return}
 wakeLockBusy=true;
 try{
  screenWakeLock=await navigator.wakeLock.request('screen');
  screenWakeLock.addEventListener('release',()=>{screenWakeLock=null;syncDeviceSettingsUi()},{once:true});
  setWakeLockStatus('Activo','active');
 }catch(e){
  console.warn('Screen wake lock warning',e);
  screenWakeLock=null;setWakeLockStatus('No se pudo activar','error');
 }finally{wakeLockBusy=false}
}
async function releaseScreenWakeLock(){
 let lock=screenWakeLock;screenWakeLock=null;
 if(lock&&!lock.released){try{await lock.release()}catch(_){}}
 syncDeviceSettingsUi();
}
function syncScreenWakeLock(){
 syncDeviceSettingsUi();
 if(deviceSettings.keepScreenAwake&&document.visibilityState==='visible')acquireScreenWakeLock();
 else releaseScreenWakeLock();
}

const V={home:'00 Inicio',entry:'01 Radar de entrada',recommendation:'02 Ideas IA',portfolios:'03 Carteras',alerts:'04 Avisos',heatmap:'05 Mapa de calor',future:'06 Potencial futuro',calendar:'07 Calendario y noticias',catalog:'08 Catálogo Trade Republic',catalogUS:'09 Catálogo EEUU',settings:'10 Settings'};
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
  if(!V[view])return null;
  return {view,profileKey:m[2]?decodeURIComponent(m[2]):null};
 }catch(_){return null}
}
function restoreUiState(){
 try{
  let x=JSON.parse(localStorage.getItem(UI_KEY)||'{}');
  if(x&&V[x.view])state.currentView=x.view;
  if(x&&['tr','us'].includes(x.entryMarket))state.entryMarket=x.entryMarket;
  if(x&&['auto','premarket','regular','postmarket','previous'].includes(x.session))state.session=x.session;
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

function readTheme(){
 try{
  let saved=localStorage.getItem(THEME_KEY);
  if(saved==='light'||saved==='dark')return saved;
 }catch(_){}
 return 'dark';
}
function currentTheme(){return document.documentElement.dataset.theme==='light'?'light':'dark'}
function updateThemeButton(){
 let theme=currentTheme();
 document.querySelectorAll('[data-theme-setting]').forEach(button=>{
  let active=button.dataset.themeSetting===theme;
  button.classList.toggle('active',active);
  button.setAttribute('aria-pressed',active?'true':'false');
 });
}
function refreshVisibleChartThemes(){
 document.querySelectorAll('.tv-advanced-chart').forEach(el=>{
  if(!(el.dataset.loaded==='1'||el.querySelector('.tradingview-widget-container')||el.querySelector('.tr-native-chart')))return;
  let s=stockByKey(el.dataset.stockKey);
  if(el.dataset.chartMarket==='tr'&&el.dataset.trRange&&s){
   let range=el.dataset.trRange||'1d';
   loadTrChartHistory(s,range).then(data=>renderTrNativeChart(el,s,data,range)).catch(()=>{});
   return;
  }
  renderTradingViewChart(el,'us');
 });
}
function applyTheme(theme,rerenderCharts=true){
 let next=theme==='light'?'light':'dark';
 document.documentElement.dataset.theme=next;
 try{localStorage.setItem(THEME_KEY,next)}catch(_){}
 updateThemeButton();
 if(rerenderCharts)requestAnimationFrame(refreshVisibleChartThemes);
}

function N(v){v=Number(v);return Number.isFinite(v)?v:null}
function E(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function F(v,d=2){v=N(v);return v===null?'—':v.toLocaleString('es-ES',{maximumFractionDigits:d})}
function I(v){v=N(v);return v===null?'—':Math.round(v).toLocaleString('es-ES')}
function PR(v){v=N(v);return v===null?'—':v.toLocaleString('es-ES',{maximumFractionDigits:v<1?6:4})}
function money(v,symbol){
 v=N(v);if(v===null)return symbol+'—';
 return symbol+v.toLocaleString('es-ES',{maximumFractionDigits:v<1?6:4});
}
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
 let usd=usLivePrice(s)??N(s&&s.price);
 return{
  market:'us',
  source:usLivePrice(s)!==null?String(s&&s.usLiveSource||'Nasdaq'):'Snapshot EEUU',
  nativeCurrency:'USD',
  price:usd,
  usd,
  eur:usd!==null&&fx?usd/fx:null,
  change:usLiveChange(s)??N(s&&s.changePct),
  updatedAt:quoteTimestampMs(s,false),
  fx,
  fxUpdatedAt:fxLive.updatedAt||parseMarketTimestamp(db.meta&&db.meta.updatedAt,'Europe/Madrid')||null,
  live:usLivePrice(s)!==null
 };
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
 return ms?'ES '+quoteClockFormat.format(new Date(ms)):'ES --:--:--';
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
 let trActive=preferTr&&trTradable(s)&&trMarketOpen(),value=trActive?(trLiveChange(s)??N(fallback)):(preferTr?marketChange(s,currentMarketSession(),true):(usLiveChange(s)??N(fallback)));
 let attrs=trActive
  ?' data-tr-live-change-key="'+E(stockKey(s))+'"'
  :(!preferTr?' data-us-live-change-key="'+E(stockKey(s))+'"':'');
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
 // LSX has its own live move while its exchange is open. Outside LSX hours,
 // fall back to the selected US session instead of presenting a stale German move as current.
 if(preferTr&&trMarketOpen()){
  let live=trLiveChange(s);if(live!==null)return live;
 }
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
 if(state.entryMarket==='tr'&&$('#entryUpdated'))$('#entryUpdated').textContent=trLive.lastDataAt?'LSX · último dato '+new Date(trLive.lastDataAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'LSX · esperando cotización';
}
function initTrLive(){
 connectTrLive();
 setInterval(()=>{if(!document.hidden)refreshTrLiveDom()},1000);
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
 const selector='[data-tr-live-key],[data-tr-live-change-key],[data-tr-subscribe-key],[data-tr-spread-key],[data-tr-price-eur-key],[data-tr-price-usd-key]';
 let keep=new Set(),h=window.innerHeight||900;
 for(let root of activeLiveRoots())for(let el of root.querySelectorAll(selector)){
  let r=el.getBoundingClientRect();if(r.bottom<-700||r.top>h+700)continue;
  let key=el.dataset.trLiveKey||el.dataset.trLiveChangeKey||el.dataset.trSubscribeKey||el.dataset.trSpreadKey||el.dataset.trPriceEurKey||el.dataset.trPriceUsdKey;
  if(key)keep.add(key);
 }
 for(let key of [...trLive.wanted])if(!keep.has(key))dropTrLiveKey(key);
}
function usStockByKey(key){let s=stockByKey(key);return s&&market(s,'us')?s:null}
function usVisibleKeys(){
 let nodes=liveNodes('[data-us-live-key],[data-us-spread-key],[data-us-live-change-key],[data-us-price-usd-key],[data-us-price-eur-key],[data-us-bid-key],[data-us-ask-key],[data-us-heat-key]');
 let h=window.innerHeight||900,seen=new Set(),out=[];
 for(let el of nodes){
  let r=el.getBoundingClientRect();
  if(r.bottom<-400||r.top>h+400)continue;
  let key=el.dataset.usLiveKey||el.dataset.usSpreadKey||el.dataset.usLiveChangeKey||el.dataset.usPriceUsdKey||el.dataset.usPriceEurKey||el.dataset.usBidKey||el.dataset.usAskKey||el.dataset.usHeatKey;
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
}
function refreshUsLiveDom(){
 visibleLiveNodes('[data-us-live-key]').forEach(el=>{
  let s=usStockByKey(el.dataset.usLiveKey);if(!s)return;
  setHtmlIfChanged(el,pricePairInner(s,SP(s,currentMarketSession()),false));
  el.classList.toggle('live-quote',usLivePrice(s)!==null);
  el.title=s.usLiveIsRealTime?'Cotización Nasdaq actual':'Último dato Nasdaq disponible';
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
let liveViewRefreshTimer=null;
function scheduleLiveViewRefresh(delay=180){
 if(liveViewRefreshTimer||document.hidden||document.body.classList.contains('stock-detail-open'))return;
 if(!['home','heatmap','recommendation'].includes(state.currentView))return;
 liveViewRefreshTimer=setTimeout(()=>{
  liveViewRefreshTimer=null;
  if(state.currentView==='home')renderHome();
  else if(state.currentView==='heatmap')renderHeatmap();
  else if(state.currentView==='recommendation')renderRecommendation();
 },Math.max(100,delay));
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
 return [...document.querySelectorAll('#entryResults .stock-card')].map(card=>{
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
 return stockIndexByKey.get(key)||null;
}
let stockViews=readStockViews();
function readStockViews(){
 try{let x=JSON.parse(localStorage.getItem(STOCK_VIEWS_KEY)||'{}');return x&&typeof x==='object'?x:{}}catch(_){return{}}
}
function saveStockViews(){try{localStorage.setItem(STOCK_VIEWS_KEY,JSON.stringify(stockViews))}catch(_){}}
function recordStockView(key){
 key=String(key||'').toUpperCase();if(!key)return;
 let x=stockViews[key]||{count:0,last:0};x.count=(N(x.count)??0)+1;x.last=Date.now();stockViews[key]=x;saveStockViews();
}
function stockViewCount(s){let x=stockViews[stockKey(s)]||{};return Math.max(0,N(x.count)??0)}

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
 return trTradable(s);
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
function currentMarketSession(){
 return auto();
}
function sessionStageLabel(se){
 return se==='premarket'?'PREMARKET':se==='postmarket'?'POSTMARKET':se==='previous'?'ÚLTIMA SESIÓN':'REGULAR';
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
 return db.stocks
  .filter(s=>kind==='tr'?trTradable(s):market(s,'us'))
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
 let se=currentMarketSession(),stocks=[...favorites].map(stockByKey).filter(Boolean);
 count.textContent=stocks.length;
 if(!stocks.length){
  box.innerHTML='<div class="favorites-empty"><span aria-hidden="true">☆</span><p>Pulsa la estrella de cualquier acción para guardarla aquí.</p></div>';
  return;
 }
 box.innerHTML=stocks.map(s=>{
  let ch=SC(s,se),p=SP(s,se),v=SV(s,se),avg=N(s.avgVolume),key=stockKey(s);
  let preferTr=trTradable(s);
  return '<div class="favorite-row stock-open-row"'+stockOpenAttrs(s,'',preferTr)+'><button type="button" class="fav-star active mini" data-fav-key="'+E(key)+'" title="Quitar de favoritos" aria-label="Quitar de favoritos">★</button><div class="favorite-link" title="'+E(s.name||s.ticker)+'"><div class="favorite-main"><div class="ticker-stack">'+tickerDisplay(s,preferTr)+'</div>'+pricePair(s,p,preferTr)+'</div>'+bidAskHtml(s,preferTr)+'<div class="favorite-stats">'+liveChangeHtml(s,ch,preferTr)+'<small>Vol '+compactVol(v)+' / '+compactVol(avg)+'</small></div></div></div>';
 }).join('');
}
function status(){}
function renderCurrentView(){
 if(state.currentView==='home')renderHome();
 else if(state.currentView==='entry')renderEntry();
 else if(state.currentView==='recommendation')renderRecommendation();
 else if(state.currentView==='portfolios'){if(window.ViewInvAIPortfolios)window.ViewInvAIPortfolios.render()}
 else if(state.currentView==='heatmap')renderHeatmap();
 else if(state.currentView==='future')renderFuture();
 else if(state.currentView==='alerts'){if(window.AppAlerts)window.AppAlerts.renderSettings()}
 else if(state.currentView==='calendar')renderCalendar();
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
  let r=await fetch(url,{cache:force?'reload':'no-cache'});
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
  if(db.stocks.length){renderMarketLeaders();renderFavorites()}
 }
}


let keepScreenAwakeToggle=$('#keepScreenAwake');
if(keepScreenAwakeToggle)keepScreenAwakeToggle.addEventListener('change',e=>{
 deviceSettings.keepScreenAwake=!!e.target.checked;
 saveDeviceSettings();
 syncScreenWakeLock();
});
$('#mobileMenu')?.addEventListener('click',()=>$('#sidebar')?.classList.toggle('open'));
['refreshHome','refreshEntry','refreshFuture','refreshRecommendation','refreshHeatmap'].forEach(id=>$('#'+id).addEventListener('click',()=>load(true)));
