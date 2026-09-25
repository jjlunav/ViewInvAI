const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DATA='data/market.json', DATA_VERSION='data/market-version.json', DATA_REFRESH_MS=60000, MAX_TR_LIVE_SUBSCRIPTIONS=120, CUSTOM_FILTER_KEY='viewinvai:customFilter:v1', FAV_KEY='viewinvai:favorites:v1', LEADERS_PIN_KEY='viewinvai:leadersPinned:v1', UI_KEY='viewinvai:ui:v1', RECO_KEY='viewinvai:recommendation:v1', THEME_KEY='viewinvai:theme:v1', STOCK_VIEWS_KEY='viewinvai:stockViews:v1', RECO_COOLDOWN_MS=86400000;
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
let heatmapState={market:'tr',session:'auto',limit:250,sectorByMarket:{tr:null,us:null},selectedStockKey:null};
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
let recommendationState=readRecommendationState();

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
function toggleTheme(){applyTheme(currentTheme()==='light'?'dark':'light',true)}

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
 if(preferTr&&trTradable(s)){
  return '<span class="quote-spread quote-spread-tr" data-tr-spread-key="'+E(stockKey(s))+'" title="BID = mejor precio comprador · ASK = mejor precio vendedor · ambos son distintos del último precio negociado">'+bidAskInner(s,true)+'</span>';
 }
 return '<span class="quote-spread quote-spread-us '+(s.usLiveIsRealTime?'realtime':'delayed')+'" data-us-spread-key="'+E(stockKey(s))+'" title="'+(s.usLiveIsRealTime?'Bid y Ask actuales recibidos desde Nasdaq.com':'Bid/Ask no marcado como tiempo real por Nasdaq; no se reutiliza el snapshot diferido')+'">'+bidAskInner(s,false)+'</span>';
}
function flashQuote(el,dir){setQuoteDirection(el,dir)}

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

function viewLabel(v){return String(V[v]||'Vista').replace(/^\d+\s*/,'')}
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
function tvHref(s){
 let sym=encodeURIComponent(String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+(s.ticker||''))).replace(':','-'));
 return 'https://www.tradingview.com/symbols/'+sym+'/';
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
function metric(label,main,sub,help,mainClass='',subClass=''){
 return '<div class="metric-help" title="'+E(help)+'"><small>'+E(label)+' <span class="info-dot">ⓘ</span></small><b class="'+E(mainClass)+'">'+main+'</b><span class="'+E(subClass)+'">'+sub+'</span></div>';
}
function rankingWhy(s,next,se,q,pos,preferTr=false){
 if(state.preset==='emerging'){
  let e=emergingSignal(s,se);
  let reasons=['aceleración '+(e.acceleration>=0?'+':'')+F(e.acceleration,2)+' puntos en ~'+F(e.age,0)+' min'];
  if(e.burstPct>=0.1)reasons.push('volumen nuevo '+F(e.burstPct,2)+'% del volumen medio');
  if(e.rv>=1)reasons.push('volumen relativo '+F(e.rv,2)+'×');
  if(e.news)reasons.push('noticia reciente');
  return 'Puesto #'+pos+' por impulso naciente: '+reasons.join(' · ')+'. Variación actual '+PC(e.current)+'.';
 }
 let a=marketChange(s,se,preferTr),b=next?marketChange(next,se,preferTr):null;
 let basis=preferTr&&trMarketOpen()&&trLiveChange(s)!==null?'LSX en tiempo real':SN(se);
 return 'Puesto #'+pos+' por variación porcentual en '+basis+': '+PC(a)+(next?' frente a '+PC(b)+' de #'+(pos+1)+' '+E(next.ticker)+'.':'.')+' El orden se actualiza automáticamente con las cotizaciones.';
}
function why(s,se,preferTr=false){let b=[],c=marketChange(s,se,preferTr),r=RV(s,se);if(c!==null)b.push((preferTr&&trMarketOpen()&&trLiveChange(s)!==null?'LSX':SN(se))+' '+PC(c));if(r!==null)b.push('vol. relativo '+F(r,2)+'×');if(N(s.adx)!==null)b.push('ADX '+F(s.adx,1));if(N(s.rsi)!==null)b.push('RSI '+F(s.rsi,1));if(trend(s))b.push('tendencia compatible');return b.join(' · ')||'Cumple el criterio activo con los datos disponibles.'}
function entryChangeHtml(s,se,preferTr=false){
 let trLive=preferTr&&trMarketOpen()&&trLiveChange(s)!==null,v=marketChange(s,se,preferTr),usLive=!trLive&&se==='regular'&&usLiveChange(s)!==null;
 let attrs=trLive?' data-tr-live-change-key="'+E(stockKey(s))+'"':usLive?' data-us-live-change-key="'+E(stockKey(s))+'"':'';
 return '<span class="quote-change '+C(v)+'"'+attrs+'>'+PC(v)+'</span>';
}
function listInsightLabel(s,se,preferTr=false){
 let rv=RV(s,se),em=emergingSignal(s,se);
 if(em&&em.eligible)return 'IA · impulso naciente';
 if(recentNewsSignal(s,60))return 'IA · noticia reciente';
 if(rv!==null&&rv>=2)return 'IA · volumen inusual';
 if(trendState(s)===true&&marketChange(s,se,preferTr)!==null&&marketChange(s,se,preferTr)>0)return 'IA · tendencia favorable';
 return 'IA · seguimiento';
}
function listSessionQuote(s,se,preferTr=false){
 let price=null,change=null,label='',icon='';
 if(se==='premarket'&&N(s.premarketPrice)!==null){price=s.premarketPrice;change=s.premarketChangePct;label='PRE';icon='☀'}
 else if(se==='postmarket'&&N(s.postmarketPrice)!==null){price=s.postmarketPrice;change=s.postmarketChangePct;label='POST';icon='☾'}
 else if(N(s.premarketPrice)!==null){price=s.premarketPrice;change=s.premarketChangePct;label='PRE';icon='☀'}
 else if(N(s.postmarketPrice)!==null){price=s.postmarketPrice;change=s.postmarketChangePct;label='POST';icon='☾'}
 if(price===null)return '';
 return '<div class="stock-session-quote"><span class="session-icon">'+icon+'</span><small>'+label+'</small><strong>'+snapshotPricePair(s,price,preferTr)+'</strong><span class="'+C(change)+'">'+PC(change)+'</span></div>';
}
function standardStockCard(s,i=0,opts={}){
 let se=opts.se||SES(),dense=opts.dense===true,preferTr=opts.preferTr===true;
 let hint=opts.hint||why(s,se,preferTr),rv=RV(s,se),vol=SV(s,se),ticker=preferTr?(s.trTicker||s.ticker):s.ticker;
 let attrs=opts.openAttrs!==undefined?String(opts.openAttrs||''):stockOpenAttrs(s,hint,preferTr);
 let rank=opts.rankLabel!==undefined?String(opts.rankLabel):'#'+(i+1);
 let insight=opts.insight||listInsightLabel(s,se,preferTr);
 let context=opts.contextHtml?'<div class="stock-context-line">'+opts.contextHtml+'</div>':'';
 return '<article class="stock-card investing-stock-card '+(dense?'dense-card':'')+(opts.className?' '+E(opts.className):'')+'">'+
  '<div class="stock-open-row investing-stock-row"'+attrs+' title="'+E(hint)+'">'+
   '<div class="investing-stock-left">'+
    '<div class="investing-stock-name-row">'+favButton(s,preferTr)+'<div class="investing-stock-copy"><strong class="stock-name">'+E(s.name||ticker||'—')+'</strong>'+
     '<div class="investing-stock-meta"><span class="rank">'+E(rank)+'</span><span class="meta-clock">◷</span><span>'+E(ticker||'—')+'</span><span>·</span><span>'+E(preferTr?(s.trExchange||'LSX'):(s.exchange||'EEUU'))+'</span>'+(trTradable(s)?'<span class="pill ok">TR</span>':'')+'</div>'+
    '</div></div>'+
    '<div class="stock-ai-chip">'+E(insight)+'</div>'+
   '</div>'+
   '<div class="investing-stock-right"><div class="stock-list-price">'+pricePair(s,SP(s,se),preferTr)+'</div>'+entryChangeHtml(s,se,preferTr)+listSessionQuote(s,se,preferTr)+'</div>'+
   '<span class="open-arrow">›</span>'+
  '</div>'+
  '<div class="stock-market-line">'+bidAskHtml(s,preferTr)+'<div class="stock-list-metrics"><span>Vol <b>'+compactVol(vol)+'</b></span><span>RV <b>'+(rv===null?'—':F(rv,2)+'×')+'</b></span><span>RSI <b>'+F(s.rsi,0)+'</b></span><span>ADX <b>'+F(s.adx,0)+'</b></span></div></div>'+
  context+
 '</article>';
}
function card(s,i,se=SES(),dense=false,rankText='',preferTr=false){
 return standardStockCard(s,i,{se,dense,preferTr,hint:rankText||why(s,se)});
}
function market(s,m){let ex=String(s.exchange||'').toUpperCase();return m==='tr'?trTradable(s):m==='us'?['NASDAQ','NYSE','AMEX','NYSE ARCA','NYSEARCA'].includes(ex):true}
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
 if(state.entryMarket==='tr')return trTradable(s);
 // “Resto EEUU” means US-listed stocks that are not already in the verified TR set.
 return market(s,'us')&&!trTradable(s);
}
function entrySessionForPreset(){
 if(state.preset==='postmarketExplosion')return'postmarket';
 if(state.preset==='premarketExplosion')return'premarket';
 return SES();
}
function previousSessionChange(s,se){
 if(se==='premarket')return N(s.previousPremarketChangePct);
 if(se==='postmarket')return N(s.previousPostmarketChangePct);
 return N(s.previousChangePct);
}
function previousSessionVolume(s,se){
 if(se==='premarket')return N(s.previousPremarketVolume);
 if(se==='postmarket')return N(s.previousPostmarketVolume);
 return N(s.previousVolume);
}
function recentNewsSignal(s,minutes=45){
 let now=Date.now(),windowMs=minutes*60000;
 return stockEvents(s).some(e=>{
  if(e.eventKind!=='news')return false;
  let t=new Date(e.date).getTime();
  return Number.isFinite(t)&&t<=now+60000&&t>=now-windowMs;
 });
}
function emergingSignal(s,se){
 let current=FC(s,se),previous=previousSessionChange(s,se),age=N(s.momentumSnapshotMinutes);
 if(current===null||previous===null||age===null||age<1||age>20)return{eligible:false,score:-Infinity};
 let acceleration=current-previous;
 let volume=SV(s,se),previousVolume=previousSessionVolume(s,se),avg=N(s.avgVolume);
 let volumeAdded=volume!==null&&previousVolume!==null?Math.max(0,volume-previousVolume):0;
 let burstPct=avg&&avg>0?volumeAdded/avg*100:0;
 let rv=RV(s,se)??0;
 let news=recentNewsSignal(s,45);
 let supportingActivity=burstPct>=0.8||rv>=1.5||news;
 // This is deliberately an early detector, not a "most exploded" list:
 // it requires positive acceleration now and rejects already very extended moves.
 let eligible=current>0&&current<=12&&acceleration>=0.20&&supportingActivity;
 let score=acceleration*22+Math.min(24,burstPct*3)+Math.min(16,Math.max(0,rv-1)*8)+(news?20:0)+Math.max(0,12-current)*0.35;
 return{eligible,score,acceleration,burstPct,rv,news,age,current};
}
function entry(){
 let q=state.filters,se=entrySessionForPreset(),preferTr=state.entryMarket==='tr',emerging=state.preset==='emerging';
 let a=db.stocks.filter(entryUniverseMatch).filter(s=>{
  let ch=marketChange(s,se,preferTr);if(ch===null||ch<q.minChange)return false;if(q.maxChange>0&&ch>q.maxChange)return false;

  let rv=RV(s,se);if(q.minRelVolume>0&&(rv===null||rv<q.minRelVolume))return false;
  let adx=N(s.adx);if(q.minAdx>0&&(adx===null||adx<q.minAdx))return false;

  let rsi=N(s.rsi);
  if((q.minRsi>0||q.maxRsi<100)&&(rsi===null||rsi<q.minRsi||rsi>q.maxRsi))return false;

  let v=SV(s,se);if(q.minVolume>0&&(v===null||v<q.minVolume))return false;

  if(q.trend&&trendState(s)!==true)return false;
  if(q.illiquid&&lowLiquidity(s,se,preferTr))return false;
  if(emerging&&!emergingSignal(s,se).eligible)return false;
  return true;
 });
 a.sort((x,y)=>{
  if(emerging){
   let ax=emergingSignal(x,se),ay=emergingSignal(y,se);
   if(ay.score!==ax.score)return ay.score-ax.score;
  }
  let ax=marketChange(x,se,preferTr),by=marketChange(y,se,preferTr),av=ax===null?-Infinity:ax,bv=by===null?-Infinity:by;
  if(bv!==av)return bv-av;
  return String(x.ticker||'').localeCompare(String(y.ticker||''));
 });
 return[a,se];
}

function homeDailyChange(s){
 let preferTr=trTradable(s);
 return marketChange(s,currentMarketSession(),preferTr);
}
function homeUniverse(){
 return (db.stocks||[]).filter(s=>stockKey(s)&&(N(s.price)!==null||trTradable(s)));
}
function homePopularStocks(limit=5){
 let universe=homeUniverse(),ranked=universe.filter(s=>stockViewCount(s)>0).sort((a,b)=>stockViewCount(b)-stockViewCount(a)||((stockViews[stockKey(b)]?.last||0)-(stockViews[stockKey(a)]?.last||0)));
 let used=new Set(ranked.map(stockKey));
 if(ranked.length<limit){
  let fallback=universe.filter(s=>!used.has(stockKey(s))).sort((a,b)=>(SV(b,'regular')??N(b.avgVolume)??0)-(SV(a,'regular')??N(a.avgVolume)??0));
  ranked.push(...fallback.slice(0,limit-ranked.length));
 }
 return ranked.slice(0,limit);
}
function homeMoveStocks(desc=true,limit=5){
 return homeUniverse().map(s=>({s,ch:homeDailyChange(s)})).filter(x=>x.ch!==null).sort((a,b)=>desc?b.ch-a.ch:a.ch-b.ch).slice(0,limit).map(x=>x.s);
}
function homeStockRow(s,i,kind){
 let preferTr=trTradable(s),views=stockViewCount(s);
 let hint=kind==='views'?(views?views+' '+(views===1?'vista':'vistas'):'Más vista'):(kind==='gainers'?'Mejor rendimiento diario':'Peor rendimiento diario');
 let insight=kind==='views'?'IA · interés de usuarios':kind==='gainers'?'IA · momentum positivo':'IA · presión vendedora';
 return standardStockCard(s,i,{se:'regular',preferTr,hint,insight,className:'home-investing-card'});
}
function homePanel(title,subtitle,stocks,kind,tone){
 return '<section class="home-market-panel '+tone+'"><header><div><h2>'+E(title)+'</h2><p>'+E(subtitle)+'</p></div><span>'+stocks.length+'</span></header>'+
  '<div class="home-stock-list">'+(stocks.length?stocks.map((s,i)=>homeStockRow(s,i,kind)).join(''):'<div class="home-empty">Sin datos disponibles todavía.</div>')+'</div></section>';
}
function renderHome(){
 let box=$('#homeGroups');if(!box)return;
 let popular=homePopularStocks(5),gainers=homeMoveStocks(true,5),losers=homeMoveStocks(false,5);
 box.innerHTML=
  homePanel('Más vistas','Según las acciones que abres en este dispositivo',popular,'views','popular')+
  homePanel('Mejor rendimiento diario','Mayores subidas de la sesión regular',gainers,'gainers','positive-panel')+
  homePanel('Peor rendimiento diario','Mayores caídas de la sesión regular',losers,'losers','negative-panel');
 if($('#homeSession'))$('#homeSession').textContent='Sesión regular · '+homeUniverse().length+' acciones';
 if($('#homeUpdated'))$('#homeUpdated').textContent=db.meta.updatedAt?'Datos '+new Date(db.meta.updatedAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'Actualizando…';
}

function renderEntry(){
 let [a,se]=entry();
 $('#entrySessionText').textContent=(state.entryMarket==='tr'?'Trade Republic':'Resto EEUU')+' · '+SN(se);
 $('#entryCount').textContent=a.length+' candidatas';
 $('#entryUpdated').textContent=db.meta.updatedAt?'datos '+new Date(db.meta.updatedAt).toLocaleString('es-ES'):'sin actualización';
 let shown=a.slice(0,150);
 $('#entryResults').innerHTML=shown.length
  ?shown.map((s,i)=>card(s,i,se,false,rankingWhy(s,shown[i+1],se,state.filters,i+1,state.entryMarket==='tr'),state.entryMarket==='tr')).join('')
  :'<div class="empty-state">No hay candidatas con este criterio y sesión. Prueba otro preset o abre Configurar criterio para ver los umbrales activos.</div>';
}
function ET(t){return({news:'Noticia relevante',medical:'Clínico / FDA',earnings:'Resultados',contract:'Contrato / acuerdo',corporate:'Operación corporativa',financing:'Financiación / dilución',analyst:'Analistas / rating',event:'Evento / conferencia',regulatory:'Regulatorio / legal',other:'Otro catalizador'})[t]||'Catalizador'}
function EL(e){let t=String(e.title||e.fact||'').toLowerCase();if(e.type==='earnings')return 'Resultados trimestrales';if(e.type==='medical'){let m=t.match(/phase\s*([123])/i);if(m)return 'Estudio clínico Fase '+m[1];if(/pdufa/.test(t))return 'PDUFA / FDA';if(/fda|approval|approved/.test(t))return 'Decisión FDA';if(/trial|clinical|study|endpoint|topline/.test(t))return 'Resultados clínicos';return 'Clínico / sanitario'}if(e.type==='financing'){if(/offering|registered direct|private placement/.test(t))return 'Oferta / ampliación';if(/warrant/.test(t))return 'Warrants';if(/convertible/.test(t))return 'Convertibles';return 'Financiación / dilución'}if(e.type==='contract')return /award|order|contract/.test(t)?'Contrato / adjudicación':'Acuerdo / alianza';if(e.type==='corporate'){if(/merger|acquisition|acquire|takeover|buyout/.test(t))return 'Fusión / adquisición';if(/reverse split/.test(t))return 'Reverse split';if(/stock split/.test(t))return 'Split';return 'Operación corporativa'}if(e.type==='analyst')return /upgrade/.test(t)?'Upgrade analista':/downgrade/.test(t)?'Downgrade analista':'Rating / precio objetivo';if(e.type==='regulatory')return 'Regulatorio / legal';if(e.type==='event')return 'Evento / conferencia';return ET(e.type)}
function safeExternalUrl(value){
 try{
  let u=new URL(String(value||''));
  return u.protocol==='https:'?u.href:'';
 }catch(_){return''}
}
function EU(e){let u=safeExternalUrl(e.url);return u?'<a class="event-link" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="'+E(u)+'">Abrir noticia / fuente ↗</a>':''}
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
 let linksHtml=src.map(s=>{let name=E(s.name||'Fuente'),u=safeExternalUrl(s.url),kind=E(s.kind||'');return u?'<a target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"'+(kind?' title="'+kind+'"':'')+' href="'+E(u)+'">'+name+' ↗</a>':'<span'+(kind?' title="'+kind+'"':'')+'>'+name+'</span>'}).join('');
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
 if(!s)return[];
 let refs=new Set();
 for(let value of [s.isin,s.usIsin,s.trIsin]){let ref=isinRef(value);if(ref)refs.add(ref)}
 let exact=tickerRef(s.ticker,s.exchange),any=tickerRef(s.ticker,'*');if(exact)refs.add(exact);if(any)refs.add(any);
 let out=[],seen=new Set();
 for(let ref of refs)for(let event of (eventIndexByRef.get(ref)||[])){
  if(seen.has(event))continue;seen.add(event);out.push(event);
 }
 return out;
}
function renderFuture(){
 let h=+$('#futureHorizon').value,t=$('#futureType').value,tr=$('#futureTrOnly').checked,now=Date.now();
 let filtered=(db.events||[]).filter(e=>{
  if(!futureWindowEvent(e,h,now)||(t!=='all'&&e.type!==t))return false;
  if(!tr)return true;
  let s=stockForEvent(e);
  return trTradable(s);
 });
 let groups=groupFutureEvents(filtered);
 $('#futureResults').innerHTML=groups.length?groups.slice(0,180).map((g,i)=>{
  let e=g.first,s=stockForEvent(e)||e;
  let count=g.items.length,label=count===1?EL(e):(count+' catalizadores'),when=eventWhen(e),preferTr=trTradable(s);
  let context='<strong>'+E(when)+'</strong><span>'+E(label)+'</span>'+(count>1?'<span>'+count+' eventos agrupados</span>':'');
  return standardStockCard(s,i,{se:SES(),preferTr,hint:label+' · '+when,insight:'IA · '+label,contextHtml:context,className:'future-stock-card'});
 }).join(''):'<div class="empty-state">No hay catalizadores desde ahora hasta '+h+' día'+(h===1?'':'s')+' vista con estos filtros.</div>';
}

function renderCalendar(){
 let rows=[...(db.events||[])].sort((x,y)=>new Date(y.date)-new Date(x.date));
 $('#calendarResults').innerHTML=rows.length?rows.slice(0,400).map((e,i)=>{
  let s=stockForEvent(e)||e;
  let label=EL(e),when=DF(e.date),preferTr=trTradable(s);
  return standardStockCard(s,i,{se:SES(),preferTr,hint:label+' · '+when,insight:'IA · '+label,contextHtml:'<strong>'+E(when)+'</strong><span>'+E(label)+'</span>',className:'calendar-stock-card'});
 }).join(''):'<div class="empty-state">Sin eventos o noticias disponibles.</div>';
}

function readRecommendationState(){
 let base={us:{key:null,selectedAt:0,armed:false},tr:{key:null,selectedAt:0,armed:false},sold:{us:{},tr:{}}};
 try{
  let raw=JSON.parse(localStorage.getItem(RECO_KEY)||'null');
  if(!raw||typeof raw!=='object')return base;
  for(let mode of ['us','tr']){
   if(raw[mode]&&typeof raw[mode]==='object')base[mode]=Object.assign(base[mode],raw[mode]);
   if(raw.sold&&raw.sold[mode]&&typeof raw.sold[mode]==='object')base.sold[mode]=raw.sold[mode];
  }
 }catch(_){}
 return base;
}
function saveRecommendationState(){
 try{
  let cutoff=Date.now()-7*86400000;
  for(let mode of ['us','tr'])for(let [key,ts] of Object.entries(recommendationState.sold[mode]||{}))if(Number(ts)<cutoff)delete recommendationState.sold[mode][key];
  localStorage.setItem(RECO_KEY,JSON.stringify(recommendationState));
 }catch(_){}
}
function recommendationBucket(mode){
 if(!recommendationState[mode]||typeof recommendationState[mode]!=='object')recommendationState[mode]={key:null,selectedAt:0,armed:false};
 return recommendationState[mode];
}
function recommendationSoldRecently(mode,key){
 let ts=Number(recommendationState.sold&&recommendationState.sold[mode]&&recommendationState.sold[mode][key]);
 return Number.isFinite(ts)&&Date.now()-ts<RECO_COOLDOWN_MS;
}
function recommendationEligible(s,mode){
 if(!s||!market(s,'us'))return false;
 if(mode==='tr'&&!trTradable(s))return false;
 let se=currentMarketSession();
 return SP(s,se)!==null||usLivePrice(s)!==null||(mode==='tr'&&trLivePrice(s)!==null);
}
function recommendationTechnicalLegacy(s,mode){
 let preferTr=mode==='tr',se=currentMarketSession(),score=50,factors=[];
 let add=(label,delta,note)=>{delta=Math.round(Number(delta||0)*10)/10;score+=delta;factors.push({label,delta,note})};
 let ch=preferTr?(trLiveChange(s)??FC(s,se)):FC(s,se),rv=RV(s,se),adx=N(s.adx),rsi=N(s.rsi);
 let p=N(s.price),ema20=N(s.ema20),ema50=N(s.ema50),week=N(s.perfWeek),month=N(s.perfMonth),vol=SV(s,se),sp=spreadPct(s,preferTr);

 if(ch===null)add('Momentum',-5,'Variación actual no disponible');
 else if(ch<0)add('Momentum',Math.max(-18,ch*1.2),'Movimiento '+PC(ch));
 else if(ch<=12)add('Momentum',5+Math.min(9,ch*.75),'Impulso '+PC(ch)+' sin sobreextensión severa');
 else if(ch<=25)add('Momentum',Math.max(6,10-(ch-12)*.15),'Impulso fuerte '+PC(ch));
 else add('Momentum',Math.max(-12,8-(ch-25)*.45),'Subida '+PC(ch)+'; se penaliza perseguir extensiones extremas');

 if(rv===null)add('Volumen relativo',-2,'Sin volumen relativo comparable');
 else if(rv>=3)add('Volumen relativo',12,'Actividad '+F(rv,2)+'× la media');
 else if(rv>=1.5)add('Volumen relativo',8,'Actividad '+F(rv,2)+'× la media');
 else if(rv>=1)add('Volumen relativo',3,'Volumen en línea con la media');
 else if(rv<.5)add('Volumen relativo',-6,'Volumen débil '+F(rv,2)+'×');
 else add('Volumen relativo',-1,'Volumen por debajo de la media');

 if(adx===null)add('ADX',-1,'ADX no disponible');
 else if(adx>=30)add('ADX',7,'Tendencia fuerte · ADX '+F(adx,1));
 else if(adx>=20)add('ADX',4,'Tendencia utilizable · ADX '+F(adx,1));
 else if(adx<15)add('ADX',-4,'Tendencia poco definida · ADX '+F(adx,1));
 else add('ADX',0,'ADX '+F(adx,1));

 if(rsi===null)add('RSI',-1,'RSI no disponible');
 else if(rsi>=45&&rsi<=68)add('RSI',8,'Momentum sano · RSI '+F(rsi,1));
 else if((rsi>=38&&rsi<45)||(rsi>68&&rsi<=75))add('RSI',3,'RSI '+F(rsi,1));
 else if(rsi>82)add('RSI',-10,'Sobreextensión · RSI '+F(rsi,1));
 else if(rsi<30)add('RSI',-9,'Debilidad extrema · RSI '+F(rsi,1));
 else add('RSI',-2,'RSI '+F(rsi,1));

 if(p!==null&&ema20!==null&&ema50!==null){
  if(p>=ema20&&ema20>=ema50)add('Tendencia',12,'Precio > EMA20 > EMA50');
  else if(p>=ema20)add('Tendencia',4,'Precio sobre EMA20, estructura larga incompleta');
  else if(p<ema20&&ema20<ema50)add('Tendencia',-10,'Precio bajo EMA20 y EMA20 < EMA50');
  else add('Tendencia',-5,'Precio bajo EMA20');
 }else add('Tendencia',-2,'EMAs insuficientes');

 let perf=0,perfNote=[];
 if(week!==null){perf+=Math.max(-5,Math.min(5,week*.18));perfNote.push('1s '+PC(week))}
 if(month!==null){perf+=Math.max(-5,Math.min(5,month*.08));perfNote.push('1m '+PC(month))}
 add('Rendimiento',perf,perfNote.join(' · ')||'Sin histórico de rendimiento');

 if(vol!==null&&vol<10000)add('Liquidez',-14,'Volumen muy bajo · '+compactVol(vol));
 else if(vol!==null&&vol<50000)add('Liquidez',-7,'Volumen bajo · '+compactVol(vol));
 else if(vol!==null&&vol>=500000)add('Liquidez',4,'Volumen '+compactVol(vol));
 else if(vol!==null&&vol>=100000)add('Liquidez',2,'Volumen '+compactVol(vol));
 else add('Liquidez',0,vol===null?'Volumen no disponible':'Volumen '+compactVol(vol));

 if(sp!==null){
  if(sp>8)add('Spread',-16,'Spread '+F(sp,2)+'%');
  else if(sp>4)add('Spread',-7,'Spread amplio '+F(sp,2)+'%');
  else if(sp<=1.5)add('Spread',3,'Spread contenido '+F(sp,2)+'%');
  else add('Spread',0,'Spread '+F(sp,2)+'%');
 }

 let quality=[ch,rv,adx,rsi,p,ema20,ema50,vol].filter(v=>v!==null).length;
 if(quality<5)add('Calidad de datos',-8,'Faltan varias métricas clave');
 else if(quality>=7)add('Calidad de datos',2,'Cobertura técnica alta');

 return{score,parts:factors,se,change:ch,rv,adx,rsi,spread:sp};
}
function recommendationCatalystLegacy(s){
 let now=Date.now(),events=stockEvents(s),delta=0,relevant=[];
 let positive=/\b(approval|approved|authorization|clearance|contract|award|wins?|partnership|strategic agreement|beats?|raises? guidance|positive|topline|met (?:the )?(?:primary )?endpoint|acquisition|buyout|order|milestone payment)\b/i;
 let negative=/\b(offering|dilution|dilutive|reverse split|delist|bankrupt|chapter 11|misses?|lowers? guidance|cuts? guidance|clinical hold|failed|fails|investigation|subpoena|lawsuit|going concern|termination|withdraws?)\b/i;
 for(let e of events){
  let t=new Date(e.date).getTime();if(!Number.isFinite(t))continue;
  let isNews=e.eventKind==='news';
  if(isNews&&(t<now-72*3600000||t>now+2*3600000))continue;
  if(!isNews&&(t<now-6*3600000||t>now+14*86400000))continue;
  let text=((e.title||'')+' '+(e.fact||'')).toLowerCase(),impact=Math.max(0,Math.min(100,N(e.impactScore)??50)),d=0;
  let fdaKind=String(e.fdaStatusKind||'');
  if(fdaKind){
   if(fdaKind==='approved')d+=10+impact*.05;
   else if(fdaKind==='tentative_approval'||fdaKind==='approvable')d+=4+impact*.025;
   else if(['complete_response','not_approvable','withdrawn'].includes(fdaKind))d-=10+impact*.055;
  }else{
   if(positive.test(text))d+=6+impact*.05;
   if(negative.test(text))d-=7+impact*.06;
  }
  if(e.type==='financing')d-=6;
  if(e.type==='regulatory'&&!positive.test(text)&&!fdaKind)d-=3;
  if(/reverse split|delist|bankrupt|chapter 11/.test(text))d-=7;
  if(e.type==='medical'&&positive.test(text)&&!fdaKind)d+=4;
  if(!isNews&&d===0)d+=Math.min(2.5,impact/40);
  delta+=d;
  relevant.push({e,delta:d,impact,time:t});
 }
 relevant.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)||b.impact-a.impact||b.time-a.time);
 delta=Math.max(-18,Math.min(18,delta));
 return{delta:Math.round(delta*10)/10,events:relevant.slice(0,3)};
}
function recommendationEngineInput(s,mode='us',chartAvailable=false){
 let preferTr=mode==='tr',se=currentMarketSession();
 let quote=canonicalQuote(s,preferTr),snapshotAt=parseMarketTimestamp(db.meta&&db.meta.updatedAt);
 let quoteAt=preferTr?(N(s&&s.trLiveUpdatedAt)??N(s&&s.trLiveReceivedAt)):(N(s&&s.usLiveReceivedAt)??parseMarketTimestamp(s&&s.usLiveTimestamp,'America/New_York'));
 let now=Date.now();
 return {
  price:quote&&N(quote.price)!==null?N(quote.price):SP(s,se),
  change:marketChange(s,se,preferTr),
  volume:SV(s,se),
  avgVolume:N(s&&s.avgVolume),
  relVolume:RV(s,se),
  rsi:N(s&&s.rsi),
  adx:N(s&&s.adx),
  ema20:N(s&&s.ema20),
  ema50:N(s&&s.ema50),
  perfWeek:N(s&&s.perfWeek),
  perfMonth:N(s&&s.perfMonth),
  spread:spreadPct(s,preferTr),
  bid:preferTr?N(s&&s.trLiveBid):usLiveBid(s),
  ask:preferTr?N(s&&s.trLiveAsk):usLiveAsk(s),
  quoteAgeMs:quoteAt?Math.max(0,now-quoteAt):null,
  snapshotAgeMs:snapshotAt?Math.max(0,now-snapshotAt):null,
  chartAvailable:chartAvailable===true
 };
}
function recommendationTechnical(s,mode){
 if(!window.ViewInvAIScore||typeof window.ViewInvAIScore.technical!=='function')return recommendationTechnicalLegacy(s,mode);
 let input=recommendationEngineInput(s,mode),r=window.ViewInvAIScore.technical(input),se=currentMarketSession();
 return {score:r.score,parts:r.factors,se,change:r.change,rv:r.relVolume,adx:r.adx,rsi:r.rsi,spread:r.spread};
}
function recommendationCatalyst(s){
 if(!window.ViewInvAIScore||typeof window.ViewInvAIScore.catalyst!=='function')return recommendationCatalystLegacy(s);
 let r=window.ViewInvAIScore.catalyst(stockEvents(s));
 return {delta:r.delta,events:(r.events||[]).map(x=>({e:x.event,delta:x.delta,impact:x.impact,time:x.time}))};
}
function stockDataQuality(s,mode='us',chartAvailable=false){
 if(!s)return{score:0,level:'low',missing:['acción']};
 if(window.ViewInvAIScore&&typeof window.ViewInvAIScore.quality==='function'){
  return window.ViewInvAIScore.quality(Object.assign(recommendationEngineInput(s,mode,chartAvailable),{eventsCount:stockEvents(s).length}));
 }
 let input=recommendationEngineInput(s,mode,chartAvailable);
 let vals=[input.price,input.change,input.volume,input.relVolume,input.rsi,input.adx,input.ema20,input.ema50,input.bid,input.ask];
 let count=vals.filter(v=>N(v)!==null).length,score=Math.round(count/vals.length*100);
 return {score,level:score>=85?'high':score>=70?'good':score>=55?'medium':'low',missing:[]};
}
function recommendationAnalysis(s,mode){
 let se=currentMarketSession(),events=stockEvents(s);
 if(window.ViewInvAIScore&&typeof window.ViewInvAIScore.analyze==='function'){
  let r=window.ViewInvAIScore.analyze(recommendationEngineInput(s,mode,false),events);
  let cat={
   delta:N(r.catalystDelta)??0,
   events:((r.catalyst&&r.catalyst.events)||[]).map(x=>({e:x.event,delta:x.delta,impact:x.impact,time:x.time}))
  };
  let parts=[...(r.factors||[])];
  parts.push({label:'Noticias / eventos',delta:cat.delta,note:cat.events.length?cat.events.map(x=>EL(x.e)).join(' · '):'Sin catalizador direccional fuerte en la ventana'});
  return{
   score:N(r.score)??0,
   baseScore:N(r.baseScore)??0,
   parts,
   catalyst:cat,
   quality:r.quality||stockDataQuality(s,mode,false),
   se,
   change:N(r.change),
   rv:N(r.relVolume),
   adx:N(r.adx),
   rsi:N(r.rsi),
   spread:N(r.spread),
   engineVersion:r.version||window.ViewInvAIScore.VERSION||''
  };
 }
 let a=recommendationTechnical(s,mode),cat=recommendationCatalyst(s);
 a.parts.push({label:'Noticias / eventos',delta:cat.delta,note:cat.events.length?cat.events.map(x=>EL(x.e)).join(' · '):'Sin catalizador direccional fuerte en la ventana'});
 a.catalyst=cat;
 a.score=Math.max(0,Math.min(100,Math.round((a.score+cat.delta)*10)/10));
 a.quality=stockDataQuality(s,mode,false);
 return a;
}

const recommendationChartCache=new Map();
function avgNumbers(values){
 let rows=values.map(N).filter(v=>v!==null);
 return rows.length?rows.reduce((a,b)=>a+b,0)/rows.length:null;
}
async function recommendationChartAnalysis(s,mode){
 let key=mode+':'+stockKey(s),cached=recommendationChartCache.get(key);
 if(cached&&Date.now()-cached.at<90000)return cached.value;
 let result={available:false,confirmed:false,delta:-6,points:0,note:'Histórico intradía no disponible'};
 try{
  let url='';
  if(mode==='tr'&&trTradable(s)&&trIsin(s)){
   url='/api/tr-history?isin='+encodeURIComponent(trIsin(s))+'&exchange='+encodeURIComponent(s.trExchange||'LSX')+'&range=1d&resolution=60000';
  }else if(s&&s.ticker){
   url='/api/us-chart?symbol='+encodeURIComponent(s.ticker);
  }
  if(!url)throw Error('no chart source');
  let r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error(String(r.status));
  let data=await r.json(),raw=Array.isArray(data&&data.points)?data.points:[];
  let pts=raw.map(p=>({close:N(p&&((p.close!==undefined)?p.close:p.price)),volume:N(p&&p.volume)})).filter(p=>p.close!==null);
  if(pts.length<35)throw Error('insufficient chart');
  pts=pts.slice(-180);
  let closes=pts.map(p=>p.close),last=closes[closes.length-1];
  let sma10=avgNumbers(closes.slice(-10)),sma30=avgNumbers(closes.slice(-30));
  let base20=closes[Math.max(0,closes.length-21)],ret20=base20>0?(last/base20-1)*100:null;
  let hi30=Math.max(...closes.slice(-30)),lo30=Math.min(...closes.slice(-30));
  let drawdown=hi30>0?(last/hi30-1)*100:null;
  let rangePos=hi30>lo30?(last-lo30)/(hi30-lo30):.5;
  let recentVol=avgNumbers(pts.slice(-8).map(p=>p.volume)),priorVol=avgNumbers(pts.slice(-28,-8).map(p=>p.volume));
  let volExpansion=recentVol!==null&&priorVol>0?recentVol/priorVol:null;
  let delta=0,notes=[];
  let trendUp=last>sma10&&sma10>sma30;
  if(trendUp){delta+=8;notes.push('precio > media corta > media larga')}else{delta-=8;notes.push('gráfico sin estructura alcista clara')}
  if(ret20!==null){
   if(ret20>=.4&&ret20<=8){delta+=5;notes.push('impulso intradía '+PC(ret20))}
   else if(ret20>8&&ret20<=15){delta+=2;notes.push('impulso fuerte '+PC(ret20))}
   else if(ret20<0){delta-=5;notes.push('impulso reciente negativo')}
   else if(ret20>20){delta-=7;notes.push('movimiento demasiado extendido')}
  }
  if(drawdown!==null){
   if(drawdown>=-4){delta+=3;notes.push('cerca de máximos recientes')}
   else if(drawdown<-10){delta-=4;notes.push('retroceso profundo desde máximos')}
  }
  if(rangePos>=.7)delta+=2;
  if(volExpansion!==null){
   if(volExpansion>=1.35){delta+=3;notes.push('volumen acelerando '+F(volExpansion,2)+'×')}
   else if(volExpansion<.7){delta-=2;notes.push('volumen intradía perdiendo fuerza')}
  }
  delta=Math.max(-18,Math.min(18,Math.round(delta*10)/10));
  let confirmed=trendUp&&ret20!==null&&ret20>.3&&ret20<=15&&drawdown!==null&&drawdown>=-8;
  result={available:true,confirmed,delta,points:pts.length,last,sma10,sma30,ret20,drawdown,volExpansion,note:notes.join(' · ')};
 }catch(_){}
 recommendationChartCache.set(key,{at:Date.now(),value:result});
 return result;
}
async function highConvictionRecommendation(mode){
 let s=pickRecommendation(mode);
 if(!s)return null;
 let a=recommendationAnalysis(s,mode),chart=await recommendationChartAnalysis(s,mode);
 let se=a.se,vol=SV(s,se),price=N(s.price),ema20=N(s.ema20),ema50=N(s.ema50);
 let trendOk=price!==null&&ema20!==null&&ema50!==null&&price>=ema20&&ema20>=ema50;
 let severeNegative=(a.catalyst.events||[]).some(x=>N(x.delta)!==null&&x.delta<=-5);
 let dataQuality=stockDataQuality(s,mode,chart.available);
 let combined=Math.max(0,Math.min(100,Math.round((a.score+chart.delta)*10)/10));
 let gates={
  score:a.score>=82,
  combined:combined>=88,
  chart:chart.available&&chart.confirmed,
  trend:trendOk,
  volume:vol!==null&&vol>=75000,
  relVolume:a.rv!==null&&a.rv>=1.25,
  adx:a.adx!==null&&a.adx>=25,
  rsi:a.rsi!==null&&a.rsi>=42&&a.rsi<=72,
  spread:a.spread===null||a.spread<=3.5,
  momentum:a.change!==null&&a.change>=.5&&a.change<=20,
  catalyst:a.catalyst.delta>=-1.5&&!severeNegative,
  quality:dataQuality.score>=70
 };
 let eligible=Object.values(gates).every(Boolean);
 let reasons=[];
 if(chart.confirmed)reasons.push('gráfico confirmado');
 if(a.rv!==null)reasons.push('RV '+F(a.rv,2)+'×');
 if(a.adx!==null)reasons.push('ADX '+F(a.adx,0));
 if(a.rsi!==null)reasons.push('RSI '+F(a.rsi,0));
 if(a.catalyst.events&&a.catalyst.events.length)reasons.push('noticias/eventos revisados');
 return{s,mode,eligible,score:combined,baseScore:a.score,analysis:a,chart,gates,reasons,dataQuality};
}
function recommendationSignal(score,bucket,qualityScore=100){
 if(qualityScore<55)return{key:'wait',label:'ESPERAR',text:'Faltan datos suficientes para emitir una señal fuerte.'};
 if(bucket.armed&&score<=50)return{key:'sell',label:'VENTA',text:'La tesis ha perdido suficiente fuerza para activar salida.'};
 if(bucket.armed)return{key:'hold',label:'MANTENER',text:'La tesis sigue activa, pero sin nueva señal de compra.'};

 let shared=window.ViewInvAIScore&&typeof window.ViewInvAIScore.watchSignal==='function'
  ?window.ViewInvAIScore.watchSignal(score,qualityScore)
  :(score>=72?'BUY':score>=60?'WATCH':score<35?'AVOID':'WAIT');
 if(shared==='BUY'){bucket.armed=true;return{key:'buy',label:'COMPRA',text:'Convicción suficiente para entrada según el motor común de ViewInvAI.'}}
 if(shared==='WATCH')return{key:'watch',label:'VIGILAR',text:'La candidata es interesante, pero todavía no supera el umbral común de entrada.'};
 if(shared==='AVOID')return{key:'wait',label:'EVITAR',text:'El balance actual de señales no justifica una entrada.'};
 return{key:'wait',label:'ESPERAR',text:'No hay convicción suficiente para una entrada rigurosa en este momento.'};
}
function pickRecommendation(mode){
 let bucket=recommendationBucket(mode),current=bucket.key?stockByKey(bucket.key):null;
 if(current&&recommendationEligible(current,mode)&&!recommendationSoldRecently(mode,bucket.key))return current;
 bucket.key=null;bucket.armed=false;bucket.selectedAt=0;
 let candidates=db.stocks.filter(s=>recommendationEligible(s,mode)&&!recommendationSoldRecently(mode,stockKey(s)));
 if(!candidates.length){saveRecommendationState();return null}
 let shortlist=candidates.map(s=>({s,a:recommendationTechnical(s,mode)})).sort((x,y)=>y.a.score-x.a.score).slice(0,100);
 let ranked=shortlist.map(x=>({s:x.s,a:recommendationAnalysis(x.s,mode)})).sort((x,y)=>y.a.score-x.a.score);
 let chosen=ranked[0]&&ranked[0].s;
 if(chosen){bucket.key=stockKey(chosen);bucket.selectedAt=Date.now();bucket.armed=false}
 saveRecommendationState();
 return chosen||null;
}
function recommendationNarrative(a){
 let pos=a.parts.filter(x=>x.delta>2).sort((x,y)=>y.delta-x.delta).slice(0,3);
 let neg=a.parts.filter(x=>x.delta<-2).sort((x,y)=>x.delta-y.delta).slice(0,3);
 let out=[];
 if(pos.length)out.push('A favor: '+pos.map(x=>x.label+' ('+(x.delta>=0?'+':'')+F(x.delta,1)+')').join(', ')+'.');
 if(neg.length)out.push('En contra: '+neg.map(x=>x.label+' ('+F(x.delta,1)+')').join(', ')+'.');
 return out.join(' ')||'Las señales disponibles están equilibradas.';
}
function recommendationCard(mode,s){
 if(!s)return '<article class="recommendation-card empty-state">No hay una candidata con datos suficientes para este mercado.</article>';
 let preferTr=mode==='tr',bucket=recommendationBucket(mode),a=recommendationAnalysis(s,mode),quality=stockDataQuality(s,mode,false),wasArmed=!!bucket.armed,signal=recommendationSignal(a.score,bucket,quality.score);
 if(bucket.armed!==wasArmed)saveRecommendationState();
 let se=a.se,ticker=preferTr?s.trTicker:s.ticker,marketName=preferTr?'TRADE REPUBLIC / LSX':'MERCADO EEUU';
 let factors=a.parts.map(x=>'<div class="reco-factor"><div><span>'+E(x.label)+'</span><small>'+E(x.note||'')+'</small></div><b class="'+(x.delta>0?'positive':x.delta<0?'negative':'')+'">'+(x.delta>0?'+':'')+F(x.delta,1)+'</b></div>').join('');
 let events=a.catalyst.events.length?a.catalyst.events.map(x=>'<div class="reco-event"><strong>'+E(EL(x.e))+'</strong><span>'+E(x.e.title||x.e.fact||'Catalizador')+'</span><small>'+E(eventWhen(x.e))+'</small></div>').join(''):'<div class="reco-event muted">Sin noticia o evento direccional fuerte en las últimas 72 h / próximos 14 días.</div>';
 let sold=signal.key==='sell'?'<button type="button" class="btn reco-sold" data-reco-sold="'+mode+'">He vendido · buscar siguiente</button>':'<span class="reco-exit-wait">El botón de salida aparecerá cuando la señal pase a VENTA.</span>';
 return '<article class="recommendation-card" data-reco-mode="'+mode+'">'+
  '<div class="reco-card-head"><div><small>'+E(marketName)+'</small><div class="reco-title">'+favButton(s)+'<strong>'+E(ticker||'—')+'</strong><span>'+E(s.name||'')+'</span></div></div><div class="reco-signal '+signal.key+'"><b>'+E(signal.label)+'</b><span>'+F(a.score,1)+'/100</span></div></div>'+
  '<div class="reco-live">'+bidAskHtml(s,preferTr)+pricePair(s,SP(s,se),preferTr)+liveChangeHtml(s,a.change,preferTr)+'</div>'+
  '<div class="reco-thesis"><strong>'+E(signal.text)+'</strong><p>'+E(recommendationNarrative(a))+'</p></div>'+
  '<div class="reco-factors">'+factors+'</div>'+
  '<div class="reco-events"><h4>Noticias y eventos incorporados al análisis</h4>'+events+'</div>'+
  '<div class="reco-actions"><button type="button" class="btn secondary reco-open" data-reco-open="'+E(stockKey(s))+'" data-reco-prefer-tr="'+(preferTr?'1':'0')+'">Abrir ficha y gráfico</button>'+sold+'</div>'+
  '<div class="reco-foot">Datos '+quality.score+'/100 · '+(window.ViewInvAIScore&&window.ViewInvAIScore.VERSION?E(window.ViewInvAIScore.VERSION)+' · ':'')+'Convicción heurística, no probabilidad estadística. La señal se recalcula con cotización, tendencia, volumen, RSI, ADX, rendimiento, liquidez, noticias y eventos disponibles.</div>'+
  '</article>';
}
function renderRecommendation(){
 let box=$('#recommendationResults');if(!box)return;
 let us=pickRecommendation('us'),tr=pickRecommendation('tr');
 box.innerHTML=recommendationCard('us',us)+recommendationCard('tr',tr);
 let stamp=$('#recommendationUpdated');
 if(stamp)stamp.textContent='Recalculado '+new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'})+(db.meta.updatedAt?' · snapshot '+new Date(db.meta.updatedAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'');
 requestAnimationFrame(()=>{observeActiveTrLivePrices();pollUsLive()});
}
function heatmapSession(){
 let se=heatmapState.session==='auto'?auto():heatmapState.session;
 return se==='previous'?'postmarket':se;
}
function heatmapUniverse(){
 return db.stocks.filter(s=>heatmapState.market==='tr'?trTradable(s):market(s,'us'));
}
function heatmapWeight(s){
 let cap=N(s.marketCap);
 if(cap!==null&&cap>0)return cap;
 let avg=N(s.avgVolume),p=N(s.price);
 return avg!==null&&p!==null&&avg>0&&p>0?avg*p:1;
}
function heatmapChange(s,se){return marketChange(s,se,heatmapState.market==='tr')}
function heatmapChangeClass(v){
 v=N(v);if(v===null)return'heat-na';
 if(v<=-5)return'heat-loss-strong';
 if(v<=-2)return'heat-loss';
 if(v<-.5)return'heat-loss-soft';
 if(v<=.5)return'heat-flat';
 if(v<2)return'heat-gain-soft';
 if(v<5)return'heat-gain';
 return'heat-gain-strong';
}
function heatmapTileSize(s,maxWeight){
 let w=heatmapWeight(s),r=maxWeight>0?w/maxWeight:0;
 if(r>=.32)return'heat-xl';
 if(r>=.12)return'heat-lg';
 if(r>=.04)return'heat-md';
 return'heat-sm';
}
function heatmapSectorAverage(stocks,se){
 let num=0,den=0,fallback=0,count=0;
 for(let s of stocks){
  let ch=heatmapChange(s,se);if(ch===null)continue;
  let cap=N(s.marketCap);
  if(cap!==null&&cap>0){num+=ch*cap;den+=cap}
  fallback+=ch;count++;
 }
 return den>0?num/den:(count?fallback/count:null);
}
function heatmapSectorSpan(weight,maxWeight){
 let r=maxWeight>0?weight/maxWeight:0;
 if(r>=.70)return 12;
 if(r>=.42)return 9;
 if(r>=.24)return 7;
 if(r>=.12)return 6;
 return 4;
}
function heatmapTile(s,se,maxWeight){
 let ch=heatmapChange(s,se),preferTr=heatmapState.market==='tr',ticker=preferTr&&trTradable(s)?s.trTicker:s.ticker,key=stockKey(s);
 let cap=N(s.marketCap),capText=cap!==null?compactMoney(cap):'Cap. no disponible';
 let quote=canonicalQuote(s,preferTr),price=quote.price!==null?quoteMoney(quote.price,preferTr?'€':'\u0024',quotePrecision(s,preferTr,quote.price)):'—';
 let reason='Mapa de calor · '+SN(se)+' · '+PC(ch)+' · '+String(s.sector||'Sin sector');
 let selected=heatmapState.selectedStockKey===key?' selected':'';
 return '<button type="button" class="heat-stock '+heatmapChangeClass(ch)+' '+heatmapTileSize(s,maxWeight)+selected+'"'+stockOpenAttrs(s,reason,preferTr)+' data-heat-select="'+E(key)+'" data-heat-ticker="'+E(ticker||'—')+'" data-heat-name="'+E(s.name||'')+'" data-heat-price="'+E(price)+'" data-heat-change="'+E(PC(ch))+'" data-us-heat-key="'+E(key)+'" aria-label="'+E((ticker||'Acción')+' '+price+' '+PC(ch)+' '+(s.name||''))+'">'+
  '<strong>'+E(ticker||'—')+'</strong>'+
  '<span>'+PC(ch)+'</span>'+
  '<small>'+E(price)+'</small>'+
  '</button>';
}
function compactMoney(v){
 v=N(v);if(v===null)return'—';
 let a=Math.abs(v),prefix='USD ';
 if(a>=1e12)return prefix+F(v/1e12,1)+'T';
 if(a>=1e9)return prefix+F(v/1e9,1)+'B';
 if(a>=1e6)return prefix+F(v/1e6,1)+'M';
 return prefix+I(v);
}
function renderHeatmap(){
 let box=$('#heatmapResults'),tabs=$('#heatmapSectorTabs');if(!box)return;
 let se=heatmapSession(),limit=Math.max(25,Math.min(500,N(heatmapState.limit)||250));
 let universe=heatmapUniverse().filter(s=>heatmapChange(s,se)!==null);
 universe.sort((a,b)=>heatmapWeight(b)-heatmapWeight(a));
 let selected=universe.slice(0,limit),groups=new Map();
 for(let s of selected){
  let sector=String(s.sector||'Sin sector').trim()||'Sin sector';
  if(!groups.has(sector))groups.set(sector,[]);
  groups.get(sector).push(s);
 }
 let sectors=[...groups.entries()].map(([name,stocks])=>({
  name,stocks,
  weight:stocks.reduce((sum,s)=>sum+heatmapWeight(s),0),
  avg:heatmapSectorAverage(stocks,se)
 })).sort((a,b)=>b.weight-a.weight);

 let remembered=heatmapState.sectorByMarket&&heatmapState.sectorByMarket[heatmapState.market];
 let active=sectors.find(x=>x.name===remembered)||sectors[0]||null;
 if(active){
  heatmapState.sectorByMarket[heatmapState.market]=active.name;
  if(tabs)tabs.innerHTML=sectors.map(sec=>
   '<button type="button" class="heatmap-sector-tab'+(sec.name===active.name?' active':'')+'" data-heatmap-sector-tab="'+E(sec.name)+'">'+
    '<strong>'+E(sec.name)+'</strong><span>'+sec.stocks.length+'</span><b class="'+C(sec.avg)+'">'+PC(sec.avg)+'</b>'+
   '</button>'
  ).join('');
  let maxStock=Math.max(1,...active.stocks.map(heatmapWeight));
  let cols=Math.max(2,Math.min(8,Math.ceil(Math.sqrt(Math.max(1,active.stocks.length)*1.55))));
  let rows=Math.max(1,Math.ceil(active.stocks.length/cols));
  box.innerHTML='<section class="heat-sector heat-sector-single '+heatmapChangeClass(active.avg)+'" style="--heat-cols:'+cols+';--heat-rows:'+rows+'">'+
   '<div class="heat-sector-head"><div><strong>'+E(active.name)+'</strong><small>'+active.stocks.length+' acciones · '+(heatmapState.market==='tr'?'Trade Republic / LSX':'EEUU')+'</small></div><b class="'+C(active.avg)+'">'+PC(active.avg)+'</b></div>'+
   '<div class="heat-sector-grid">'+active.stocks.map(s=>heatmapTile(s,se,maxStock)).join('')+'</div>'+
  '</section><div id="heatmapHoverCard" class="heatmap-hover-card" aria-hidden="true"></div>';
 }else{
  if(tabs)tabs.innerHTML='';
  box.innerHTML='<div class="empty-state">No hay datos suficientes para construir el mapa de calor en esta sesión.</div>';
 }
 let marketLabel=heatmapState.market==='tr'?'Trade Republic':'EEUU';
 let ses=$('#heatmapSessionText');if(ses)ses.textContent=marketLabel+' · '+SN(se)+(active?' · '+active.name:'');
 let count=$('#heatmapCount');if(count)count.textContent=(active?active.stocks.length:0)+' visibles · '+selected.length+' analizadas';
 let upd=$('#heatmapUpdated');
 if(upd){
  if(se==='regular'&&usLive.lastFetchAt)upd.textContent='NASDAQ LIVE · '+new Date(usLive.lastFetchAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  else upd.textContent=db.meta.updatedAt?'snapshot '+new Date(db.meta.updatedAt).toLocaleString('es-ES'):'sin actualización';
 }
}
function markRecommendationSold(mode){
 if(!['us','tr'].includes(mode))return;
 let bucket=recommendationBucket(mode),key=bucket.key;if(!key)return;
 recommendationState.sold[mode][key]=Date.now();
 bucket.key=null;bucket.selectedAt=0;bucket.armed=false;
 saveRecommendationState();
 renderRecommendation();
}

function presetHelpText(value){
 const help={
  short:'Pensado para operaciones de pocos días. Busca acciones que ya muestran movimiento suficiente y que mantienen una liquidez razonable, pero sin exigir una tendencia técnica perfecta. Sirve para localizar movimientos que podrían tener continuidad durante las próximas 1–5 sesiones.',
  medium:'Busca movimientos más sostenidos que un simple pico intradía. Da prioridad a acciones cuya estructura técnica mantiene una tendencia ordenada y suficiente liquidez, pensando en recorridos de varias semanas y no en perseguir una explosión puntual.',
  broad:'Abre el abanico al máximo y aplica muy pocas restricciones. Es útil para explorar el mercado y no perder candidatos, a cambio de mostrar más ruido y valores de peor calidad. El listado se ordena por los que más están subiendo en la sesión elegida.',
  intraday:'Busca acciones que están ganando fuerza durante la sesión actual. Exige que ya exista movimiento positivo y evita los valores con liquidez demasiado pobre. Es un filtro de impulso en curso, no una predicción previa al movimiento.',
  exploded:'Busca acciones que ya han realizado una subida muy fuerte en la sesión seleccionada. Está pensado para localizar explosiones que ya se han producido, no para anticiparlas.',
  postmarketExplosion:'Fuerza el análisis al Postmarket y muestra primero las acciones que más están subiendo después del cierre regular de EEUU. No exige una subida mínima artificial: ordena el mercado por la variación real de Postmarket.',
  premarketExplosion:'Fuerza el análisis al Premarket y muestra primero las acciones que más están subiendo antes de la apertura regular de EEUU. No exige una subida mínima artificial: ordena el mercado por la variación real de Premarket.',
  emerging:'Busca un movimiento que esté empezando ahora, no uno que ya haya explotado. Compara el último snapshot con el anterior y exige aceleración positiva reciente; además necesita una señal de actividad que la respalde, como entrada rápida de volumen, volumen relativo elevado o una noticia recién publicada. Descarta movimientos ya demasiado extendidos. Es un detector temprano de aceleración, no una garantía de subida.',
  strict:'Busca señales con más confirmación técnica y menos ruido. Exige tendencia ordenada, fuerza de tendencia, volumen relativo y una zona de RSI razonable, además de evitar mala liquidez. Suele devolver menos acciones, pero con más condiciones técnicas cumplidas.',
  custom:'Carga exactamente el criterio personalizado que guardaste en este navegador. Sirve para reutilizar tus propios umbrales sin modificar ninguno de los filtros predefinidos.'
 };
 return help[value]||'Selecciona este criterio para aplicar su lógica al mercado y ordenar las candidatas que la cumplen.';
}
function helpTextFor(el){
 if(!el)return null;
 if(el.dataset.help)return{title:el.dataset.helpTitle||'Qué hace',text:el.dataset.help};
 let key=el.dataset.helpKey||'',num=id=>N($('#'+id)?.value);
 if(key==='preset')return{title:el.textContent.trim(),text:presetHelpText(el.dataset.value)};
 if(key==='session')return{title:'Sesión usada por los filtros',text:'Selecciona qué tramo de EEUU alimenta variación y volumen: Premarket 04:00–09:30, Regular 09:30–16:00 y Postmarket 16:00–20:00, hora de Nueva York. Automática cambia según la hora. En la pestaña TR, técnicos y variación de sesión proceden del valor EEUU vinculado; precio, BID y ASK son LSX.'};
 if(key==='presetTrigger')return{title:'Criterio preconfigurado',text:'Elige el tipo de búsqueda que quieres hacer. Al pasar por cada opción verás una explicación clara de qué intenta localizar, para qué horizonte sirve y cómo se comporta, sin limitarse a repetir sus valores internos.'};
 if(key==='apply')return{title:'Aplicar filtros',text:'Lee los valores actuales de Configurar criterio y vuelve a calcular el listado. Un candado sólo impide editar un campo: no desactiva ese filtro.'};
 if(key==='filters')return{title:'Configurar criterio',text:'Abre los umbrales que deciden qué acciones pueden aparecer: variación, volumen relativo, volumen mínimo, ADX, RSI, tendencia EMA y liquidez.'};
 if(key==='marketTr')return{title:'Trade Republic',text:'Muestra sólo instrumentos cuya negociación en Trade Republic/LSX está confirmada: ISIN TR conocido, ticker LSX resuelto y mercado activo. Los candidatos sin confirmación quedan en EEUU.'};
 if(key==='marketUs')return{title:'Resto EEUU',text:'Muestra acciones de Nasdaq/NYSE/AMEX/NYSE Arca que no están confirmadas como negociables en Trade Republic/LSX. Aquí quedan también los candidatos TR aún sin ticker LSX resuelto.'};
 if(key==='minChange'){let v=num('minChange')??0;return{title:'Variación mínima',text:'Sólo aparecen acciones con variación ≥ '+F(v,1)+'% en la sesión elegida. Regular prioriza la variación actual Nasdaq; Pre/Post usan la de ese tramo. En TR se evalúa la referencia EEUU vinculada.'}}
 if(key==='maxChange'){let v=num('maxChange')??0;return{title:'Variación máxima',text:v>0?'Excluye acciones con variación superior a '+F(v,1)+'% para evitar movimientos ya demasiado extendidos.':'Vale 0, por tanto está desactivado: no hay límite superior de variación.'}}
 if(key==='minRelVolume'){let v=num('minRelVolume')??0;return{title:'Volumen relativo mínimo',text:v>0?'Exige ≥ '+F(v,2)+'× el volumen medio. 1,50× significa un 50% más actividad que la referencia. Si falta el dato, la acción se excluye mientras este filtro esté activo.':'Vale 0, por tanto no se exige volumen relativo mínimo.'}}
 if(key==='minVolume'){let v=num('minVolume')??0;return{title:'Volumen mínimo',text:v>0?'Exige al menos '+I(v)+' títulos negociados en la sesión seleccionada. Si falta el dato, la acción no supera este filtro.':'Vale 0, por tanto no se exige un número mínimo de títulos.'}}
 if(key==='minAdx'){let v=num('minAdx')??0;return{title:'ADX mínimo',text:v>0?'Exige ADX ≥ '+F(v,0)+'. ADX mide fuerza de tendencia, no dirección. Si falta ADX, la acción se excluye.':'Vale 0, por tanto no se exige fuerza mínima de tendencia por ADX.'}}
 if(key==='minRsi'){let v=num('minRsi')??0;return{title:'RSI mínimo',text:'Exige RSI ≥ '+F(v,0)+'. El RSI va de 0 a 100 y este límite evita momentum inferior al umbral. Se combina con el RSI máximo.'}}
 if(key==='maxRsi'){let v=num('maxRsi')??100;return{title:'RSI máximo',text:'Exige RSI ≤ '+F(v,0)+'. Permite evitar acciones sobreextendidas. Si el rango está restringido y falta RSI, la acción se excluye.'}}
 if(key==='trend')return{title:'Exigir tendencia EMA20/EMA50',text:'Sólo pasan acciones con precio ≥ EMA20 ≥ EMA50. Si falta precio, EMA20 o EMA50, la acción no supera este criterio.'};
 if(key==='illiquid')return{title:'Excluir liquidez baja',text:'Descarta valores con menos de 10.000 títulos en la sesión o spread BID/ASK >8% cuando hay spread. En TR el spread se toma de LSX; en EEUU, de Nasdaq.'};
 if(key==='lock')return{title:'Candado del parámetro',text:'Bloquea o desbloquea únicamente la edición del número. El criterio sigue activo aunque el candado esté cerrado.'};
 if(key==='reset')return{title:'Restablecer',text:'Recupera exactamente los valores originales del preset seleccionado y vuelve a bloquear los campos numéricos.'};
 if(key==='saveCustom')return{title:'Guardar personalizado',text:'Guarda en este navegador los valores actuales como “Personalizado guardado”. No modifica los presets originales.'};
 if(key==='futureHorizon')return{title:'Horizonte del catalizador',text:'Limita los eventos previstos a los próximos N días. Las noticias recientes del día pueden acompañar el análisis aunque no sean eventos futuros.'};
 if(key==='futureType')return{title:'Tipo de catalizador',text:'Restringe a resultados, clínico/FDA, contratos, operaciones corporativas, financiación/dilución, analistas, eventos o regulatorio/legal.'};
 if(key==='futureTrOnly')return{title:'Sólo Trade Republic',text:'Sólo deja eventos de acciones confirmadas como negociables y activas en Trade Republic/LSX. No incluye candidatos pendientes.'};
 if(key==='catalogSearchTr')return{title:'Buscar en Catálogo TR',text:'Busca por ticker LSX, ticker EEUU relacionado, empresa, ISIN, WKN o mercado dentro de los instrumentos confirmados como negociables en Trade Republic.'};
 if(key==='catalogSearchUs')return{title:'Buscar en Catálogo EEUU',text:'Busca por ticker, empresa, ISIN, mercado y demás campos del universo EEUU cargado.'};
 if(key==='catalogReset')return{title:'Restablecer columnas',text:'Devuelve las columnas a su orden original, borra filtros de columna y restablece el orden inicial.'};
 if(key==='catalogClear')return{title:'Limpiar filtros de columnas',text:'Borra todos los filtros de la segunda fila sin cambiar el orden de las columnas.'};
 if(key==='refresh')return{title:'Actualizar datos',text:'Solicita de nuevo el snapshot de mercado y recalcula la vista con los datos disponibles más recientes.'};
 return null;
}
let activeHelpTarget=null,helpDismissTimer=null;
function positionHelpBanner(target){
 let banner=$('#hoverHelpBanner');if(!banner||!target)return;
 let r=target.getBoundingClientRect(),pad=10,w=Math.min(520,Math.max(280,window.innerWidth-24));
 banner.style.width=w+'px';
 banner.style.left=Math.max(12,Math.min(r.left,window.innerWidth-w-12))+'px';
 banner.style.top='0px';
 let h=banner.offsetHeight||80,below=r.bottom+pad,above=r.top-h-pad;
 banner.style.top=(below+h<window.innerHeight?below:Math.max(12,above))+'px';
}
function showHelpBanner(target){
 let info=helpTextFor(target),banner=$('#hoverHelpBanner');if(!info||!banner)return;
 if(helpDismissTimer)clearTimeout(helpDismissTimer);
 activeHelpTarget=target;$('#hoverHelpTitle').textContent=info.title;$('#hoverHelpText').textContent=info.text;
 banner.classList.add('visible');banner.setAttribute('aria-hidden','false');requestAnimationFrame(()=>positionHelpBanner(target));
 helpDismissTimer=setTimeout(()=>hideHelpBanner(),12000);
}
function hideHelpBanner(){
 if(helpDismissTimer){clearTimeout(helpDismissTimer);helpDismissTimer=null}
 let banner=$('#hoverHelpBanner');if(!banner)return;
 banner.classList.remove('visible');banner.setAttribute('aria-hidden','true');activeHelpTarget=null;
}
function initHelpSystem(){
 const mark=(selector,key)=>{let el=$(selector);if(el)el.dataset.helpKey=key},markAll=(selector,key)=>$$(selector).forEach(el=>el.dataset.helpKey=key);
 const sectionHelp={
  entry:{title:'Radar de entrada',text:'Escanea acciones que cumplen el criterio seleccionado. Puedes cambiar sesión, mercado y filtros técnicos. La lista se recalcula con los datos disponibles y no aplica ningún precio mínimo.'},
  recommendation:{title:'Ideas IA',text:'Selecciona oportunidades mediante análisis multifactor de momentum, volumen, tendencia, RSI, ADX, liquidez y catalizadores.'},
  portfolios:{title:'Carteras',text:'Organiza posiciones por bróker. Cada posición y cada favorito sincronizado puede analizarse de forma recurrente para detectar mantenimiento, revisión o posible salida.'},
  heatmap:{title:'Mapa de calor',text:'Agrupa visualmente el mercado por sectores. El tamaño representa capitalización cuando está disponible y el color muestra la variación de la sesión elegida.'},
  future:{title:'Potencial futuro',text:'Busca noticias y eventos próximos que pueden aumentar la volatilidad antes de que ocurra el movimiento: resultados, FDA, contratos, financiación, operaciones corporativas y otros catalizadores.'},
  alerts:{title:'Avisos',text:'Solo avisa cuando una recomendación alcanza un nivel de convicción alto. Exige confirmación de gráfico, tendencia, volumen, RSI/ADX, liquidez y ausencia de señales negativas relevantes en noticias o eventos.'},
  calendar:{title:'Calendario y noticias',text:'Ordena cronológicamente noticias y eventos corporativos, clínicos, regulatorios y de resultados asociados al universo de acciones cargado.'},
  catalog:{title:'Catálogo Trade Republic',text:'Tabla de instrumentos cuya negociación en Trade Republic/LSX está confirmada. Permite buscar, ordenar, filtrar y reorganizar columnas.'},
  catalogUS:{title:'Catálogo EEUU',text:'Tabla del universo estadounidense cargado, con búsqueda, ordenación, filtros por columna y acceso a la ficha detallada de cada acción.'},
  settings:{title:'Settings',text:'Preferencias de la aplicación y del dispositivo. Por ahora permite mantener la pantalla del móvil activa mientras ViewInvAI está abierta; más adelante incorporará cuenta, sincronización, notificaciones y otras opciones.'}
 };
 $$('.section-help').forEach(el=>{let x=sectionHelp[el.dataset.helpSection];if(x){el.dataset.help=x.text;el.dataset.helpTitle=x.title}});
 $$('.criterion-field').forEach(field=>{let input=field.querySelector('input');if(input)field.dataset.helpKey=input.id});
 let trendLabel=$('#requireTrend')?.closest('.filter-toggle');if(trendLabel)trendLabel.dataset.helpKey='trend';
 let liqLabel=$('#excludeIlliquid')?.closest('.filter-toggle');if(liqLabel)liqLabel.dataset.helpKey='illiquid';
 markAll('.field-lock','lock');
 // El panel detallado sólo se abre mediante un icono de ayuda. Nunca por hover, focus o al cargar la página.
 $$('[data-help],[data-help-key]').forEach(el=>{
  if(el.hasAttribute('title')){
   if(!el.hasAttribute('aria-label'))el.setAttribute('aria-label',el.getAttribute('title')||'Ayuda');
   el.removeAttribute('title');
  }
 });
 function heatmapHoverCardFor(el){
 let card=$('#heatmapHoverCard');if(!card||!el)return;
 card.innerHTML='<strong>'+E(el.dataset.heatTicker||'—')+'</strong><span>'+E(el.dataset.heatName||'')+'</span><b>'+E(el.dataset.heatPrice||'—')+'</b><em>'+E(el.dataset.heatChange||'—')+'</em>';
 let r=el.getBoundingClientRect(),board=$('#heatmapResults')?.getBoundingClientRect();
 if(board){
  card.style.left=Math.max(6,Math.min(board.width-190,r.left-board.left+r.width/2-90))+'px';
  card.style.top=Math.max(6,r.top-board.top-64)+'px';
 }
 card.classList.add('show');card.setAttribute('aria-hidden','false');
}
function heatmapHideHover(){
 let card=$('#heatmapHoverCard');if(card){card.classList.remove('show');card.setAttribute('aria-hidden','true')}
}
$('#heatmapResults')?.addEventListener('mouseover',e=>{let el=e.target.closest?.('[data-heat-select]');if(el)heatmapHoverCardFor(el)});
$('#heatmapResults')?.addEventListener('mouseout',e=>{if(e.target.closest?.('[data-heat-select]'))heatmapHideHover()});
$('#heatmapResults')?.addEventListener('dblclick',e=>{
 let el=e.target.closest?.('[data-heat-select]');if(!el)return;
 e.preventDefault();e.stopPropagation();
 let stock=stockByKey(el.dataset.heatSelect);if(stock)openStock(stock,'Mapa de calor',heatmapState.market==='tr');
});

document.addEventListener('click',e=>{
 let sectorTab=e.target.closest&&e.target.closest('[data-heatmap-sector-tab]');
 if(sectorTab){
  e.preventDefault();e.stopPropagation();
  heatmapState.sectorByMarket[heatmapState.market]=sectorTab.dataset.heatmapSectorTab||null;
  heatmapState.selectedStockKey=null;
  renderHeatmap();return;
 }
 let sectorButton=e.target.closest&&e.target.closest('[data-heat-sector-select]');
 if(sectorButton){
  e.preventDefault();e.stopPropagation();
  let name=sectorButton.dataset.heatSectorSelect;
  heatmapState.sectorByMarket[heatmapState.market]=name||null;
  heatmapState.selectedStockKey=null;
  renderHeatmap();return;
 }
 let heatTile=e.target.closest&&e.target.closest('[data-heat-select]');
 if(heatTile){
  e.preventDefault();e.stopPropagation();
  heatmapState.selectedStockKey=heatTile.dataset.heatSelect||null;
  $$('#heatmapResults .heat-stock').forEach(x=>x.classList.toggle('selected',x.dataset.heatSelect===heatmapState.selectedStockKey));
  heatmapHoverCardFor(heatTile);
  return;
 }
  let trigger=e.target.closest&&e.target.closest('.section-help,.param-info');
  if(trigger){
   let target=trigger.matches('.section-help')?trigger:trigger.closest('[data-help],[data-help-key]');
   if(target){
    e.preventDefault();e.stopPropagation();
    if(activeHelpTarget===target)hideHelpBanner();else{hideHelpBanner();showHelpBanner(target)}
    return;
   }
  }
  if(activeHelpTarget&&!e.target.closest('#hoverHelpBanner'))hideHelpBanner();
 },true);
 window.addEventListener('scroll',()=>{if(activeHelpTarget)hideHelpBanner()},{passive:true});
 window.addEventListener('resize',()=>{if(activeHelpTarget)positionHelpBanner(activeHelpTarget)});
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
$('#sessionSelect').addEventListener('change',e=>{state.session=e.target.value;saveUiState();renderEntry();setTimeout(pollUsLive,0)});
function setPreset(value){
 state.preset=value;$('#presetSelect').value=value;
 let opt=$('.preset-option[data-value="'+value+'"]');
 if(opt){$('#presetLabel').textContent=opt.querySelector('span').textContent;document.querySelectorAll('.preset-option').forEach(x=>x.classList.toggle('active',x===opt))}
 state.filters=value==='custom'?(savedCustomPreset()||Object.assign({},state.filters)):preset(value);
 if(state.preset==='postmarketExplosion'){state.session='postmarket';$('#sessionSelect').value='postmarket'}
 else if(state.preset==='premarketExplosion'){state.session='premarket';$('#sessionSelect').value='premarket'}
 else if(state.preset==='emerging'){state.session='auto';$('#sessionSelect').value='auto'}
 toUI(state.filters);lockAllCriteria();saveUiState();renderEntry();setTimeout(pollUsLive,0);
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
 let q=fromUI();q.sort=state.filters.sort==='change'?'change':'score';
 if(saveCustomPreset(q)){
  state.filters=q;state.preset='custom';$('#presetSelect').value='custom';
  let opt=$('.preset-option[data-value="custom"]');
  if(opt){$('#presetLabel').textContent=opt.querySelector('span').textContent;document.querySelectorAll('.preset-option').forEach(x=>x.classList.toggle('active',x===opt))}
  renderEntry();setTimeout(pollUsLive,0);
 }
});
$('#toggleFilters').addEventListener('click',()=>$('#filterDetails').open=!$('#filterDetails').open);
$$('.field-lock').forEach(btn=>btn.addEventListener('click',()=>{let id=btn.dataset.target,input=$('#'+id);lockCriterion(id,!input.readOnly);if(!input.readOnly){input.focus();input.select()}}));
$$('[data-tab-group="entryMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{state.entryMarket=b.dataset.tab;$$('[data-tab-group="entryMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));saveUiState();renderEntry();setTimeout(pollUsLive,0)}));
['futureHorizon','futureType','futureTrOnly'].forEach(id=>$('#'+id).addEventListener('change',renderFuture));
$$('[data-tab-group="heatmapMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{
 heatmapState.market=b.dataset.tab==='us'?'us':'tr';
 $$('[data-tab-group="heatmapMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));
 renderHeatmap();
}));
$('#heatmapSession').addEventListener('change',e=>{heatmapState.session=e.target.value;renderHeatmap()});
$('#heatmapLimit').addEventListener('change',e=>{heatmapState.limit=N(e.target.value)||250;renderHeatmap()});

['refreshHome','refreshEntry','refreshFuture','refreshRecommendation','refreshHeatmap'].forEach(id=>$('#'+id).addEventListener('click',()=>load(true)));
