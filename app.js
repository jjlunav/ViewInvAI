const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DATA='data/market.json', DATA_REFRESH_MS=30000, CATALOG_PAGE_SIZE=200, CATALOG_MOBILE_PAGE_SIZE=40, MAX_TR_LIVE_SUBSCRIPTIONS=120, CUSTOM_FILTER_KEY='viewinvai:customFilter:v1', FAV_KEY='viewinvai:favorites:v1', LEADERS_PIN_KEY='viewinvai:leadersPinned:v1', UI_KEY='viewinvai:ui:v1', RECO_KEY='viewinvai:recommendation:v1', THEME_KEY='viewinvai:theme:v1', NAV_USAGE_KEY='viewinvai:navigationUsage:v1', RECO_COOLDOWN_MS=86400000;
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
const TR_LIVE_DIRECT='wss://api.traderepublic.com';
if('scrollRestoration' in history)history.scrollRestoration='manual';
function trProxyUrl(){return (location.protocol==='https:'?'wss://':'ws://')+location.host+'/api/tr-live'}
let trLive={ws:null,connected:false,connecting:false,seq:1,subByKey:new Map(),keyBySub:new Map(),payloadBySub:new Map(),wanted:new Set(),reconnectTimer:null,reconnectAttempt:0,observer:null,usingDirect:false,proxyFailures:0,lastDataAt:0};
let usLive={busy:false,lastFetchAt:0};
let tvChartAvailability=new Map();
let uiRestoredScroll=false;
let favorites=readFavorites();
let state={entryMarket:'tr',session:'auto',preset:'intraday',profileKey:null,profileReason:'',profileOriginView:null,profileOriginScroll:0,profilePreferTr:null,currentView:'entry',savedScrollY:0};
let heatmapState={market:'tr',session:'auto',limit:250};
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

const V={entry:'01 Potencial de entrada',recommendation:'02 Recomendación actual',heatmap:'03 Mapa de calor',future:'04 Potencial futuro',alerts:'05 Avisos',calendar:'06 Calendario y noticias',catalog:'07 Catálogo Trade Republic',catalogUS:'08 Catálogo EEUU',settings:'09 Settings'};
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
   view:state.currentView||'entry',
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
 let b=$('#themeToggle');if(!b)return;
 let light=currentTheme()==='light';
 b.setAttribute('aria-label',light?'Cambiar a tema oscuro':'Cambiar a tema claro');
 b.setAttribute('title',light?'Cambiar a tema oscuro':'Cambiar a tema claro');
 let icon=b.querySelector('.theme-toggle-icon'),label=b.querySelector('.theme-toggle-label');
 if(icon)icon.textContent=light?'☾':'☀';
 if(label)label.textContent=light?'Oscuro':'Claro';
}
function refreshVisibleChartThemes(){
 document.querySelectorAll('.tv-advanced-chart').forEach(el=>{
  if(el.dataset.loaded==='1'||el.querySelector('.tradingview-widget-container')){
   renderTradingViewChart(el,el.dataset.chartMarket||'us');
  }
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
function eurUsd(){let r=N(db.meta&&db.meta.eurUsd);return r&&r>0?r:null}
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

function pricePairInner(s,p,preferTr=false){
 let d='\u0024',dec=quotePrecision(s,preferTr,p);
 if(preferTr&&trTradable(s)){
  let x=trPriceValues(s,p);
  return '<strong>'+quoteMoney(x.eur,'€',dec)+'</strong><small>/ '+quoteMoney(x.usd,d,dec)+'</small>';
 }
 let x=usPriceValues(s,p);
 return '<strong>'+quoteMoney(x.usd,d,dec)+'</strong><small>'+quoteMoney(x.eur,'€',dec)+'</small>';
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
 return '<span class="table-price-cell'+(cls?' '+cls:'')+'" data-tr-price-'+which+'-key="'+E(stockKey(s))+'">'+quoteMoney(value,sym,dec)+'</span>';
}
function usPriceCell(s,which,se){
 let x=usPriceValues(s,SP(s,se)),value=which==='usd'?x.usd:x.eur,sym=which==='usd'?'\u0024':'€',dec=quotePrecision(s,false,SP(s,se));
 let cls=quoteDirClass(s&&s.usLiveDirection);
 return '<span class="table-price-cell'+(cls?' '+cls:'')+'" data-us-price-'+which+'-key="'+E(stockKey(s))+'">'+quoteMoney(value,sym,dec)+'</span>';
}
function liveChangeHtml(s,fallback,preferTr=false){
 let value=preferTr&&trTradable(s)?(trLiveChange(s)??N(fallback)):(usLiveChange(s)??N(fallback));
 let attrs=preferTr&&trTradable(s)
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
 visibleLiveNodes('[data-tr-price-eur-key]').forEach(el=>{let s=trStockByKey(el.dataset.trPriceEurKey);if(!s)return;el.textContent=quoteMoney(trPriceValues(s,SP(s,currentMarketSession())).eur,'€',quotePrecision(s,true,SP(s,currentMarketSession())));setQuoteDirection(el,s.trLiveDirection)});
 visibleLiveNodes('[data-tr-price-usd-key]').forEach(el=>{let s=trStockByKey(el.dataset.trPriceUsdKey);if(!s)return;el.textContent=quoteMoney(trPriceValues(s,SP(s,currentMarketSession())).usd,'\u0024',quotePrecision(s,true,SP(s,currentMarketSession())));setQuoteDirection(el,s.trLiveDirection)});
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
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){connectTrLive();requestAnimationFrame(()=>observeActiveTrLivePrices())}});
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
 visibleLiveNodes('[data-us-price-usd-key]').forEach(el=>{let s=usStockByKey(el.dataset.usPriceUsdKey);if(!s)return;el.textContent=quoteMoney(usPriceValues(s,SP(s,currentMarketSession())).usd,'\u0024',quotePrecision(s,false,SP(s,currentMarketSession())));setQuoteDirection(el,s.usLiveDirection)});
 visibleLiveNodes('[data-us-price-eur-key]').forEach(el=>{let s=usStockByKey(el.dataset.usPriceEurKey);if(!s)return;el.textContent=quoteMoney(usPriceValues(s,SP(s,currentMarketSession())).eur,'€',quotePrecision(s,false,SP(s,currentMarketSession())));setQuoteDirection(el,s.usLiveDirection)});
 visibleLiveNodes('[data-us-live-change-key]').forEach(el=>{let s=usStockByKey(el.dataset.usLiveChangeKey);if(!s)return;let v=usLiveChange(s);if(v===null)return;el.textContent=PC(v);el.classList.toggle('positive',v>=0);el.classList.toggle('negative',v<0)});
 if(state.entryMarket!=='tr'&&$('#entryUpdated')&&usLive.lastFetchAt){
  $('#entryUpdated').textContent='NASDAQ LIVE · '+new Date(usLive.lastFetchAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
 }
}
let liveViewRefreshTimer=null;
function scheduleLiveViewRefresh(delay=180){
 if(liveViewRefreshTimer||document.hidden||document.body.classList.contains('stock-detail-open'))return;
 if(!['heatmap','recommendation'].includes(state.currentView))return;
 liveViewRefreshTimer=setTimeout(()=>{
  liveViewRefreshTimer=null;
  if(state.currentView==='heatmap')renderHeatmap();
  else if(state.currentView==='recommendation')renderRecommendation();
 },Math.max(100,delay));
}
async function pollUsLive(){
 if(usLive.busy||document.hidden)return;
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
 return db.stocks.find(s=>stockKey(s)===key)||null;
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

function viewLabel(v){return String(V[v]||'Vista').replace(/^\d+\s*/,'')}
function inferProfilePreferTr(s){
 if(state.currentView==='catalog')return true;
 if(state.currentView==='catalogUS')return false;
 if(state.currentView==='entry')return state.entryMarket==='tr'&&trTradable(s);
 return trTradable(s);
}
function openStock(s,reason='',preferTr=null){
 if(!s)return;
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
 let se=currentMarketSession(),stocks=[...favorites].map(k=>db.stocks.find(s=>stockKey(s)===k)).filter(Boolean);
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
function links(s){
 let raw=String(s.ticker||'').toUpperCase(),t=encodeURIComponent(raw),tv=encodeURIComponent(String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+raw)).replace(':','-'));
 return '<div class="external-links"><span class="external-links-label">Contrastar / ampliar:</span>'+
  '<a target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="https://www.tradingview.com/symbols/'+tv+'/">TradingView ↗</a>'+
  '<a target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="https://www.investing.com/search/?q='+t+'">Investing ↗</a>'+
  '<a target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="https://www.nasdaq.com/market-activity/stocks/'+encodeURIComponent(raw.toLowerCase())+'">Nasdaq ↗</a>'+
  '<a target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="https://stockmarketwatch.com/stock/'+t+'">StockMarketWatch ↗</a>'+
  '<a target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="https://stocktwits.com/symbol/'+t+'">StockTwits ↗</a></div>';
}
function tradingViewChartSymbol(s,useTr=false){
 if(!s)return'';
 if(useTr)return String(s.trTvSymbol||'').trim().toUpperCase();
 return String(s.tvSymbol||(((s.exchange||'NASDAQ')+':'+(s.ticker||'')))).trim().toUpperCase();
}
function trTradingViewCandidate(s){
 if(!s||!trTradable(s))return'';
 return String(s.trTicker||'').trim().toUpperCase();
}
async function ensureTradingViewTrSymbol(s){
 let candidate=trTradingViewCandidate(s);
 if(!candidate){
  if(s){s.trTvSymbol='';s.trTvChecked=true}
  return'';
 }
 let isin=String(s.trIsin||s.isin||'').trim().toUpperCase();
 let key='LSX:'+candidate+'|'+isin;
 if(tvChartAvailability.has(key)){
  let cached=tvChartAvailability.get(key)||'';
  s.trTvSymbol=cached;s.trTvChecked=true;
  return cached;
 }
 try{
  let url='/api/tv-symbol?symbol='+encodeURIComponent(candidate)+(isin?'&isin='+encodeURIComponent(isin):'');
  let response=await fetch(url,{cache:'default'});
  if(!response.ok)throw Error(response.status);
  let data=await response.json();
  let symbol=data&&data.available?String(data.symbol||'').trim().toUpperCase():'';
  if(symbol&&!/^LSX:[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(symbol))symbol='';
  tvChartAvailability.set(key,symbol);
  s.trTvSymbol=symbol;s.trTvChecked=true;
  return symbol;
 }catch(_){
  s.trTvSymbol='';s.trTvChecked=false;
  return'';
 }
}
function chartMarketName(s,useTr=false){
 if(useTr)return (s.trExchange||'LSX')+' · '+(s.trTicker||'TR');
 return (s.exchange||'EEUU')+' · '+(s.ticker||'');
}
function chartMarketControls(s,usAvailable,trAvailable,active){
 if(usAvailable&&trAvailable){
  return '<div class="chart-market-switch" role="group" aria-label="Cambiar mercado del gráfico">'+
   '<button type="button" class="chart-market-toggle'+(active==='us'?' active':'')+'" data-chart-market="us">EEUU · '+E(s.ticker||'')+'</button>'+
   '<button type="button" class="chart-market-toggle'+(active==='tr'?' active':'')+'" data-chart-market="tr">LSX · '+E(s.trTicker||'TR')+'</button></div>';
 }
 if(trAvailable)return '<div class="chart-market-single">LSX · '+E(s.trTicker||'TR')+'</div>';
 if(usAvailable)return '<div class="chart-market-single">EEUU · '+E(s.ticker||'')+'</div>';
 return '<div class="chart-market-single">Sin mercado disponible</div>';
}
function setChartMarketUi(block,s,usAvailable,trAvailable,active,preferTr=false){
 if(!block||!s)return;
 let current=block.querySelector('.chart-market-switch,.chart-market-single');
 if(current)current.outerHTML=chartMarketControls(s,usAvailable,trAvailable,active);
 let caption=block.querySelector('.chart-market-caption');
 if(!caption)return;
 if(!active){
  caption.textContent='TradingView no ofrece un gráfico disponible para este valor.';
  return;
 }
 if(preferTr&&!trAvailable&&usAvailable){
  caption.innerHTML='La opción LSX no está disponible o no ha podido verificarse en TradingView. Mostrando únicamente <b>'+E(chartMarketName(s,false))+'</b>.';
  return;
 }
 if(usAvailable&&trAvailable){
  caption.innerHTML='Mostrando <b>'+E(chartMarketName(s,active==='tr'))+'</b>. Ambos mercados están disponibles en TradingView; puedes alternar entre ellos.';
  return;
 }
 caption.innerHTML='Mostrando <b>'+E(chartMarketName(s,active==='tr'))+'</b>. Es el único mercado disponible en TradingView para este valor.';
}
function miniChart(s,preferTr=false){
 let checkTr=!!trTradingViewCandidate(s);
 let controls=checkTr
  ?'<div class="chart-market-single chart-market-checking">Comprobando mercados de TradingView…</div>'
  :'<div class="chart-market-single">EEUU · '+E(s&&s.ticker||'')+'</div>';
 let caption=checkTr
  ?'Comprobando qué mercados están realmente disponibles en TradingView…'
  :'Mostrando <b>'+E(chartMarketName(s,false))+'</b>.';
 return '<div class="mini-chart-block tv-chart-block" data-stock-key="'+E(stockKey(s))+'" data-chart-prefer-tr="'+(preferTr?'1':'0')+'">'+
  '<div class="mini-chart-title"><div><strong>TradingView · velas 1 min</strong><span>Horario extendido cuando TradingView lo ofrece para ese mercado.</span></div>'+controls+'</div>'+
  '<div class="chart-market-caption">'+caption+'</div>'+
  '<div class="mini-chart tv-advanced-chart" data-stock-key="'+E(stockKey(s))+'" data-chart-market="us"><div class="chart-placeholder">'+(checkTr?'Comprobando disponibilidad en TradingView…':'Cargando TradingView…')+'</div></div></div>';
}
function renderTradingViewChart(el,market){
 if(!el)return;
 let s=stockByKey(el.dataset.stockKey);if(!s)return;
 let canTr=!!tradingViewChartSymbol(s,true);
 let useTr=market==='tr'&&canTr;
 let symbol=tradingViewChartSymbol(s,useTr);
 if(!symbol){
  el.innerHTML='<div class="chart-placeholder">No hay símbolo de TradingView disponible para este mercado.</div>';
  return;
 }
 el.dataset.chartMarket=useTr?'tr':'us';
 el.innerHTML='';
 let wrap=document.createElement('div');wrap.className='tradingview-widget-container';
 let widget=document.createElement('div');widget.className='tradingview-widget-container__widget';
 wrap.appendChild(widget);
 let script=document.createElement('script');
 script.type='text/javascript';
 script.async=true;
 script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
 script.textContent=JSON.stringify({
  autosize:true,
  symbol,
  interval:'1',
  timezone:useTr?'Europe/Berlin':'America/New_York',
  theme:currentTheme()==='light'?'light':'dark',
  style:'1',
  locale:'es',
  backgroundColor:currentTheme()==='light'?'#ffffff':'#05090c',
  gridColor:currentTheme()==='light'?'rgba(24,52,64,0.08)':'rgba(255,255,255,0.06)',
  hide_side_toolbar:false,
  hide_top_toolbar:false,
  hide_legend:false,
  allow_symbol_change:false,
  save_image:false,
  calendar:false,
  details:false,
  hotlist:false,
  withdateranges:true,
  extended_hours:true,
  support_host:'https://www.tradingview.com'
 });
 wrap.appendChild(script);
 el.appendChild(wrap);
}
async function loadMiniChart(el){
 if(!el||el.dataset.loaded==='1')return;
 el.dataset.loaded='1';
 let block=el.closest('.tv-chart-block'),s=stockByKey(el.dataset.stockKey);
 if(!block||!s)return;
 let usAvailable=!!tradingViewChartSymbol(s,false);
 let trAvailable=false;
 if(trTradingViewCandidate(s))trAvailable=!!(await ensureTradingViewTrSymbol(s));
 let preferTr=block.dataset.chartPreferTr==='1';
 let market=preferTr&&trAvailable?'tr':usAvailable?'us':trAvailable?'tr':'';
 setChartMarketUi(block,s,usAvailable,trAvailable,market,preferTr);
 if(!market){
  el.innerHTML='<div class="chart-placeholder">TradingView no ofrece un gráfico disponible para este valor.</div>';
  return;
 }
 renderTradingViewChart(el,market);
}
function switchMiniChartMarket(button){
 let block=button&&button.closest('.tv-chart-block');if(!block)return;
 let el=block.querySelector('.tv-advanced-chart'),s=stockByKey(block.dataset.stockKey);if(!el||!s)return;
 let market=button.dataset.chartMarket==='tr'?'tr':'us';
 if(market==='tr'&&!tradingViewChartSymbol(s,true))return;
 if(market==='us'&&!tradingViewChartSymbol(s,false))return;
 block.querySelectorAll('.chart-market-toggle').forEach(b=>b.classList.toggle('active',b===button));
 let caption=block.querySelector('.chart-market-caption');
 if(caption)caption.innerHTML='Mostrando <b>'+E(chartMarketName(s,market==='tr'))+'</b>. Cambio de gráfico únicamente; la cotización superior permanece en el mercado de la ficha.';
 renderTradingViewChart(el,market);
}

function metric(label,main,sub,help,mainClass='',subClass=''){
 return '<div class="metric-help" title="'+E(help)+'"><small>'+E(label)+' <span class="info-dot">ⓘ</span></small><b class="'+E(mainClass)+'">'+main+'</b><span class="'+E(subClass)+'">'+sub+'</span></div>';
}
function rankingWhy(s,next,se,q,pos){
 if(state.preset==='emerging'){
  let e=emergingSignal(s,se);
  let reasons=['aceleración '+(e.acceleration>=0?'+':'')+F(e.acceleration,2)+' puntos en ~'+F(e.age,0)+' min'];
  if(e.burstPct>=0.1)reasons.push('volumen nuevo '+F(e.burstPct,2)+'% del volumen medio');
  if(e.rv>=1)reasons.push('volumen relativo '+F(e.rv,2)+'×');
  if(e.news)reasons.push('noticia reciente');
  return 'Puesto #'+pos+' por impulso naciente: '+reasons.join(' · ')+'. Variación actual '+PC(e.current)+'.';
 }
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
 return '<article class="stock-card '+(dense?'dense-card':'')+'"><div class="stock-main stock-open-row"'+stockOpenAttrs(s,hint,preferTr)+' title="'+E(hint)+'"><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,preferTr)+'</div><span class="stock-name">'+E(s.name||'')+'</span></div></div><div class="stock-quick">'+bidAskHtml(s,preferTr)+pricePair(s,p,preferTr)+entryChangeHtml(s,se)+(trTradable(s)?'<span class="pill ok">TR</span>':'')+'<span class="open-arrow">→</span></div></div></article>';
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
  let ch=FC(s,se);if(ch===null||ch<q.minChange)return false;if(q.maxChange>0&&ch>q.maxChange)return false;

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
  let ax=FC(x,se),by=FC(y,se),av=ax===null?-Infinity:ax,bv=by===null?-Infinity:by;
  if(bv!==av)return bv-av;
  return String(x.ticker||'').localeCompare(String(y.ticker||''));
 });
 return[a,se];
}
function renderEntry(){
 let [a,se]=entry();
 $('#entrySessionText').textContent=(state.entryMarket==='tr'?'Trade Republic':'Resto EEUU')+' · '+SN(se);
 $('#entryCount').textContent=a.length+' candidatas';
 $('#entryUpdated').textContent=db.meta.updatedAt?'datos '+new Date(db.meta.updatedAt).toLocaleString('es-ES'):'sin actualización';
 let shown=a.slice(0,150);
 $('#entryResults').innerHTML=shown.length
  ?shown.map((s,i)=>card(s,i,se,false,rankingWhy(s,shown[i+1],se,state.filters,i+1),state.entryMarket==='tr')).join('')
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
 let linksHtml=src.map(s=>{let name=E(s.name||'Fuente'),u=safeExternalUrl(s.url);return u?'<a target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="'+E(u)+'">'+name+' ↗</a>':'<span>'+name+'</span>'}).join('');
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
 let isTr=state.profilePreferTr===true&&trTradable(s),se=currentMarketSession();
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
  '<section class="profile-section profile-chart-section"><div class="profile-section-head"><h3>Gráfico</h3><span>TradingView · velas 1 min · mercado sincronizado con la ficha</span></div>'+miniChart(s,isTr)+'</section>'+
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
    ?'Precio, BID y ASK actuales: Nasdaq.com. El gráfico TradingView se abre por defecto en el mismo valor de EEUU; puede haber pequeñas diferencias entre proveedores.'
    :'El snapshot del screener EEUU está diferido ('+E(s.updateMode||'sin modo')+'). ViewInvAI intenta sustituir precio, BID y ASK por la cotización actual de Nasdaq.com para los valores visibles. Para igualdad exacta entre cabecera y gráfico ambos deben usar el mismo feed SIP.')+'</div>'
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
  '<section class="profile-section"><div class="profile-section-head"><h3>Contraste y fuentes</h3><span>Verificación externa del mismo valor</span></div><div class="source-note">Precio TR: LSX/Trade Republic. Precio EEUU actual: Nasdaq.com cuando está disponible. El gráfico TradingView arranca en el mismo mercado que la ficha y, si el valor cotiza en ambos, permite alternar EEUU/LSX sin cambiar la cotización superior. Noticias y eventos: sus fuentes enlazadas.</div>'+links(s)+'</section>';
}
function renderProfileView(view){
 let isTr=view==='catalog',detail=$(isTr?'#catalogDetail':'#catalogUSDetail'),browse=$(isTr?'#catalogBrowse':'#catalogUSBrowse');
 if(!detail||!browse)return false;
 let s=state.profileKey?stockByKey(state.profileKey):null;
 let valid=s&&(isTr?trTradable(s):market(s,'us'));
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
  {id:'tr',label:'Trade Republic',type:'text',value:s=>trTradable(s)?'sí':'no',cell:s=>trTradable(s)?'<span class="pill ok">'+E(s.trTicker)+'</span>':'—'},
  {id:'isin',label:'ISIN',type:'text',value:s=>s.usIsin||s.isin||'',cell:s=>E(s.usIsin||s.isin||'—')},
  {id:'feed',label:'Feed',type:'text',value:s=>s.usLiveIsRealTime?'Nasdaq realtime':(s.updateMode||''),cell:s=>'<span class="'+(s.usLiveIsRealTime?'feed-live':'feed-delayed')+'">'+E(s.usLiveIsRealTime?'Nasdaq realtime':(s.updateMode||'—'))+'</span>'},
  {id:'updated',label:'Último dato',type:'text',value:s=>s.usLiveTimestamp||s.lastBarUpdateTime||'',cell:s=>E(s.usLiveTimestamp||'—')},
  {id:'earnings',label:'Resultados',type:'date',value:s=>s.earningsDate?new Date(s.earningsDate).getTime():null,cell:s=>s.earningsDate?DF(s.earningsDate):'—'}
 ]
};
const catalogState={tr:{sort:'tickerTr',dir:1,filters:{},order:null,limit:null},us:{sort:'ticker',dir:1,filters:{},order:null,limit:null}};
function catalogIsMobile(){return window.matchMedia&&window.matchMedia('(max-width:720px)').matches}
function catalogPageSize(){return catalogIsMobile()?CATALOG_MOBILE_PAGE_SIZE:CATALOG_PAGE_SIZE}
function catalogResetLimit(mode){if(catalogState[mode])catalogState[mode].limit=catalogPageSize()}
function catalogStorageKey(mode){return 'viewinvai:catalogColumns:'+mode+':v1'}
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
function catalogFilterNumber(raw){
 raw=String(raw||'').trim().toLowerCase().replace(/\s+/g,'');
 let m=raw.match(/^(-?\d+(?:[.,]\d+)?)([kmb])?%?$/i);
 if(!m)return null;
 let n=Number(m[1].replace(',','.'));if(!Number.isFinite(n))return null;
 let unit=(m[2]||'').toLowerCase();
 if(unit==='k')n*=1e3;else if(unit==='m')n*=1e6;else if(unit==='b')n*=1e9;
 return n;
}
function catalogFilterDate(raw){
 raw=String(raw||'').trim();
 let parts=raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
 let d=parts?new Date(+(parts[3].length===2?'20'+parts[3]:parts[3]),+parts[2]-1,+parts[1]):new Date(raw);
 if(isNaN(d))return null;
 return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
}
function catalogFilterMatch(value,filter,type){
 filter=String(filter||'').trim();if(!filter)return true;
 if(type==='number'){
  let n=N(value);if(n===null)return false;
  let compact=filter.replace(/\s+/g,'');
  if(/^(?:>|<|>=|<=|=|-)?$/.test(compact))return true;
  let range=compact.match(/^(.+?)\.\.(.+)$/);
  if(range){
   let a=catalogFilterNumber(range[1]),b=catalogFilterNumber(range[2]);
   if(a===null||b===null)return true;
   let lo=Math.min(a,b),hi=Math.max(a,b);return n>=lo&&n<=hi;
  }
  let m=compact.match(/^(>=|<=|>|<|=)?(.+)$/);if(!m)return true;
  let target=catalogFilterNumber(m[2]);if(target===null)return true;
  let op=m[1]||'=';
  if(op==='>')return n>target;if(op==='<')return n<target;if(op==='>=')return n>=target;if(op==='<=')return n<=target;return Math.abs(n-target)<1e-9;
 }
 if(type==='date'){
  let n=N(value);if(n===null)return false;
  let compact=filter.trim(),range=compact.match(/^(.+?)\.\.(.+)$/);
  let current=new Date(n),cur=new Date(current.getFullYear(),current.getMonth(),current.getDate()).getTime();
  if(range){
   let a=catalogFilterDate(range[1]),b=catalogFilterDate(range[2]);if(a===null||b===null)return true;
   return cur>=Math.min(a,b)&&cur<=Math.max(a,b);
  }
  let m=compact.match(/^\s*(>=|<=|>|<|=)?\s*(.*?)\s*$/),op=m&&m[1]||'=',target=catalogFilterDate(m&&m[2]);
  if(target===null)return true;
  if(op==='>')return cur>target;if(op==='<')return cur<target;if(op==='>=')return cur>=target;if(op==='<=')return cur<=target;return cur===target;
 }
 let hay=String(value??'').toLocaleLowerCase('es');
 let terms=filter.toLocaleLowerCase('es').split('|').map(x=>x.trim()).filter(Boolean);
 return terms.length?terms.some(term=>hay.includes(term)):true;
}
function catalogSortValue(v,type){if(v===null||v===undefined||v==='')return type==='text'?'':-Infinity;return type==='text'?String(v).toLowerCase():Number(v)}
function catalogActiveFilterCount(mode){return Object.values(catalogState[mode]?.filters||{}).filter(v=>String(v||'').trim()).length}
function catalogMobileCard(mode,s,se){
 let isTr=mode==='tr',preferTr=isTr;
 let change=isTr?(trLiveChange(s)??SC(s,se)):(usLiveChange(s)??SC(s,se));
 let volume=isTr?SV(s,se):(N(s.usLiveVolume)??SV(s,se)),rv=RV(s,se);
 let meta=isTr?E((s.trExchange||'LSX')+(s.ticker?' · EEUU '+s.ticker:'')):E(s.exchange||'EEUU');
 return '<article class="catalog-mobile-card stock-open-row"'+stockOpenAttrs(s,'',preferTr)+'>'+
  '<div class="catalog-mobile-card-head">'+favButton(s)+'<div class="catalog-mobile-id"><strong>'+E(isTr?(s.trTicker||s.ticker||'—'):(s.ticker||'—'))+'</strong><span>'+E(s.name||'')+'</span><small>'+meta+'</small></div><span class="catalog-mobile-arrow">›</span></div>'+
  '<div class="catalog-mobile-quote"><div>'+pricePair(s,SP(s,se),preferTr)+'</div>'+liveChangeHtml(s,change,preferTr)+'</div>'+
  '<div class="catalog-mobile-spread">'+bidAskHtml(s,preferTr)+'</div>'+
  '<div class="catalog-mobile-metrics">'+
   '<div><small>Volumen</small><strong>'+compactVol(volume)+'</strong></div>'+
   '<div><small>Vol. rel.</small><strong>'+(rv===null?'—':F(rv,2)+'×')+'</strong></div>'+
   '<div><small>RSI</small><strong>'+F(s.rsi,1)+'</strong></div>'+
   '<div><small>ADX</small><strong>'+F(s.adx,1)+'</strong></div>'+
  '</div>'+
 '</article>';
}
function catalogMobileFilters(mode,cols){
 let st=catalogState[mode],active=catalogActiveFilterCount(mode);
 let inputs=cols.filter(c=>c.id!=='fav').map(c=>
  '<label><span>'+E(c.label)+'</span><input class="catalog-col-filter" inputmode="'+(c.type==='number'?'decimal':'text')+'" data-mode="'+mode+'" data-col="'+E(c.id)+'" value="'+E(st.filters[c.id]||'')+'" placeholder="'+(c.type==='number'?'>10 o 10..30':c.type==='date'?'24/09/2026':'Contiene…')+'"></label>'
 ).join('');
 let opts=cols.filter(c=>c.id!=='fav').map(c=>'<option value="'+E(c.id)+'" '+(st.sort===c.id?'selected':'')+'>'+E(c.label)+'</option>').join('');
 return '<div class="catalog-mobile-tools">'+
   '<div class="catalog-mobile-sort"><label><span>Ordenar</span><select class="select catalog-mobile-sort-select" data-mode="'+mode+'">'+opts+'</select></label><button type="button" class="btn ghost catalog-mobile-sort-dir" data-mode="'+mode+'" aria-label="Cambiar sentido">'+(st.dir>0?'↑':'↓')+'</button></div>'+
   '<details class="catalog-mobile-filters" '+(active?'open':'')+'><summary><span>Filtros por columna</span><b>'+active+(active===1?' activo':' activos')+'</b></summary><div class="catalog-mobile-filter-grid">'+inputs+'</div></details>'+
  '</div>';
}
function catalogTable(mode,rows,se){
 let cols=catalogColumns(mode),st=catalogState[mode],sortCol=cols.find(c=>c.id===st.sort)||cols[0],mobile=catalogIsMobile();
 rows=rows.filter(s=>cols.every(c=>catalogFilterMatch(c.value(s,se),st.filters[c.id],c.type)));
 rows.sort((x,y)=>{let av=catalogSortValue(sortCol.value(x,se),sortCol.type),bv=catalogSortValue(sortCol.value(y,se),sortCol.type);if(typeof av==='string')return av.localeCompare(bv)*st.dir;return ((av===bv)?0:(av>bv?1:-1))*st.dir});
 let step=catalogPageSize();
 if(!Number.isFinite(st.limit)||st.limit<step)st.limit=step;
 let total=rows.length,limit=st.limit,shown=rows.slice(0,limit);
 let more=shown.length<total?'<div class="catalog-more"><button type="button" class="btn ghost catalog-load-more" data-catalog-mode="'+mode+'">Cargar '+Math.min(step,total-shown.length).toLocaleString('es-ES')+' más</button><span>Mostrando '+shown.length.toLocaleString('es-ES')+' de '+total.toLocaleString('es-ES')+'</span></div>':'';
 if(mobile){
  let cards=shown.map(s=>catalogMobileCard(mode,s,se)).join('');
  return {html:catalogMobileFilters(mode,cols)+'<div class="catalog-mobile-list">'+(cards||'<div class="empty-state">No hay valores con estos filtros.</div>')+'</div>'+more,count:total,shown:shown.length};
 }
 let head=cols.map(c=>'<th draggable="true" data-catalog-col="'+E(c.id)+'" data-mode="'+mode+'" data-help-title="'+E(c.label)+'" data-help="Haz clic para ordenar por '+E(c.label)+'. Vuelve a pulsar para invertir el orden. También puedes arrastrar la cabecera para mover esta columna." class="'+(st.sort===c.id?'sorted '+(st.dir>0?'asc':'desc'):'')+'"><span>'+E(c.label)+'</span><i></i></th>').join('');
 let filters=cols.map(c=>c.id==='fav'?'<th></th>':'<th><input class="catalog-col-filter" data-mode="'+mode+'" data-col="'+E(c.id)+'" data-help-title="Filtro · '+E(c.label)+'" data-help="Filtra '+E(c.label)+'. Números: &gt;10, &lt;5, 10..30, 250k, 2.5m. Texto: usa | para alternativas." value="'+E(st.filters[c.id]||'')+'" placeholder="'+(c.type==='number'?'>10 / 10..30':'Filtrar')+'"></th>').join('');
 let body=shown.map(s=>'<tr class="catalog-row stock-open-row"'+stockOpenAttrs(s,'',mode==='tr')+'>'+cols.map(c=>'<td data-col="'+E(c.id)+'">'+c.cell(s,se)+'</td>').join('')+'</tr>').join('');
 return {html:'<div class="catalog-table-wrap"><table class="catalog-table" data-mode="'+mode+'"><thead><tr>'+head+'</tr><tr class="catalog-filter-row">'+filters+'</tr></thead><tbody>'+body+'</tbody></table></div>'+more,count:total,shown:shown.length};
}
function renderCatalogTable(mode){
 let isTr=mode==='tr',search=$(isTr?'#catalogSearch':'#catalogUSSearch');if(!search)return;
 let q=search.value.trim().toLowerCase(),se=catalogSession(mode);
 let rows=db.stocks.filter(s=>isTr?trTradable(s):market(s,'us')).filter(s=>!q||(((s.trTicker||'')+' '+(s.ticker||'')+' '+(s.name||'')+' '+(s.isin||'')+' '+(s.trIsin||'')+' '+(s.usIsin||'')+' '+(s.exchange||'')).toLowerCase().includes(q)));
 let out=catalogTable(mode,rows,se),box=$(isTr?'#catalogResults':'#catalogUSResults');box.innerHTML=out.html;
 let count=$(isTr?'#catalogCount':'#catalogUSCount');count.textContent=out.count.toLocaleString('es-ES')+(isTr?' valores TR':' valores EEUU')+(out.shown<out.count?' · mostrando '+out.shown.toLocaleString('es-ES'):'');
 requestAnimationFrame(()=>{observeTrLivePrices(box);pollUsLive()});
}
function resetCatalogColumns(mode){
 catalogState[mode].order=CATALOG_COLUMNS[mode].map(c=>c.id);catalogState[mode].filters={};catalogState[mode].sort=mode==='tr'?'tickerTr':'ticker';catalogState[mode].dir=1;catalogResetLimit(mode);catalogSaveOrder(mode);renderCatalogTable(mode);
}
function renderCatalog(){renderCatalogTable('tr')}
function renderCatalogUS(){renderCatalogTable('us')}
function renderFuture(){
 let h=+$('#futureHorizon').value,t=$('#futureType').value,tr=$('#futureTrOnly').checked,now=Date.now();
 let filtered=(db.events||[]).filter(e=>{
  if(!futureWindowEvent(e,h,now)||(t!=='all'&&e.type!==t))return false;
  if(!tr)return true;
  let s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange));
  return trTradable(s);
 });
 let groups=groupFutureEvents(filtered);
 $('#futureResults').innerHTML=groups.length?groups.slice(0,180).map((g,i)=>{
  let e=g.first,s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  let count=g.items.length,label=count===1?EL(e):(count+' catalizadores'),when=eventWhen(e);
  return '<article class="stock-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s,label+' · '+when,trTradable(s))+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,!!s.tradeRepublicVerified)+'</div><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+E(when)+'</b><span class="event-type">'+E(label)+'</span>'+(trTradable(s)?'<span class="pill ok">TR</span>':'')+'<span class="open-arrow">→</span></div></div></article>';
 }).join(''):'<div class="empty-state">No hay catalizadores desde ahora hasta '+h+' día'+(h===1?'':'s')+' vista con estos filtros.</div>';
}

function renderCalendar(){
 let rows=[...(db.events||[])].sort((x,y)=>new Date(y.date)-new Date(x.date));
 $('#calendarResults').innerHTML=rows.length?rows.slice(0,400).map((e,i)=>{
  let s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  return '<article class="stock-card dense-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s,EL(e)+' · '+DF(e.date),trTradable(s))+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,!!s.tradeRepublicVerified)+'</div><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+DF(e.date)+'</b><span class="event-type">'+E(EL(e))+'</span><span class="open-arrow">→</span></div></div></article>';
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
function recommendationTechnical(s,mode){
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
function recommendationCatalyst(s){
 let now=Date.now(),events=stockEvents(s),delta=0,relevant=[];
 let positive=/\b(approval|approved|authorization|clearance|contract|award|wins?|partnership|strategic agreement|beats?|raises? guidance|positive|topline|met (?:the )?(?:primary )?endpoint|acquisition|buyout|order|milestone payment)\b/i;
 let negative=/\b(offering|dilution|dilutive|reverse split|delist|bankrupt|chapter 11|misses?|lowers? guidance|cuts? guidance|clinical hold|failed|fails|investigation|subpoena|lawsuit|going concern|termination|withdraws?)\b/i;
 for(let e of events){
  let t=new Date(e.date).getTime();if(!Number.isFinite(t))continue;
  let isNews=e.eventKind==='news';
  if(isNews&&(t<now-72*3600000||t>now+2*3600000))continue;
  if(!isNews&&(t<now-6*3600000||t>now+14*86400000))continue;
  let text=((e.title||'')+' '+(e.fact||'')).toLowerCase(),impact=Math.max(0,Math.min(100,N(e.impactScore)??50)),d=0;
  if(positive.test(text))d+=6+impact*.05;
  if(negative.test(text))d-=7+impact*.06;
  if(e.type==='financing')d-=6;
  if(e.type==='regulatory'&&!positive.test(text))d-=3;
  if(/reverse split|delist|bankrupt|chapter 11/.test(text))d-=7;
  if(e.type==='medical'&&positive.test(text))d+=4;
  if(!isNews&&d===0)d+=Math.min(2.5,impact/40);
  delta+=d;
  relevant.push({e,delta:d,impact,time:t});
 }
 relevant.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)||b.impact-a.impact||b.time-a.time);
 delta=Math.max(-18,Math.min(18,delta));
 return{delta:Math.round(delta*10)/10,events:relevant.slice(0,3)};
}
function recommendationAnalysis(s,mode){
 let a=recommendationTechnical(s,mode),cat=recommendationCatalyst(s);
 a.parts.push({label:'Noticias / eventos',delta:cat.delta,note:cat.events.length?cat.events.map(x=>EL(x.e)).join(' · '):'Sin catalizador direccional fuerte en la ventana'});
 a.catalyst=cat;
 a.score=Math.max(0,Math.min(100,Math.round((a.score+cat.delta)*10)/10));
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
 let quality=[a.change,a.rv,a.adx,a.rsi,price,ema20,ema50,vol].filter(v=>N(v)!==null).length;
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
  quality:quality>=7
 };
 let eligible=Object.values(gates).every(Boolean);
 let reasons=[];
 if(chart.confirmed)reasons.push('gráfico confirmado');
 if(a.rv!==null)reasons.push('RV '+F(a.rv,2)+'×');
 if(a.adx!==null)reasons.push('ADX '+F(a.adx,0));
 if(a.rsi!==null)reasons.push('RSI '+F(a.rsi,0));
 if(a.catalyst.events&&a.catalyst.events.length)reasons.push('noticias/eventos revisados');
 return{s,mode,eligible,score:combined,baseScore:a.score,analysis:a,chart,gates,reasons};
}
function recommendationSignal(score,bucket){
 if(score>=72){bucket.armed=true;return{key:'buy',label:'COMPRA',text:'Convicción suficiente para entrada según el motor actual.'}}
 if(bucket.armed&&score<=50)return{key:'sell',label:'VENTA',text:'La tesis ha perdido suficiente fuerza para activar salida.'};
 if(bucket.armed)return{key:'hold',label:'MANTENER',text:'La tesis sigue activa, pero sin nueva señal de compra.'};
 if(score>=60)return{key:'watch',label:'VIGILAR',text:'Es la mejor candidata del universo, pero aún no supera el umbral de compra.'};
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
 let preferTr=mode==='tr',bucket=recommendationBucket(mode),a=recommendationAnalysis(s,mode),wasArmed=!!bucket.armed,signal=recommendationSignal(a.score,bucket);
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
  '<div class="reco-foot">Convicción heurística, no probabilidad estadística. Sin precio mínimo. La señal se recalcula con cotización, tendencia, volumen, RSI, ADX, rendimiento, liquidez, noticias y eventos disponibles.</div>'+
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
function heatmapChange(s,se){return FC(s,se)}
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
 let ch=heatmapChange(s,se),preferTr=heatmapState.market==='tr',ticker=preferTr&&trTradable(s)?s.trTicker:s.ticker;
 let cap=N(s.marketCap),capText=cap!==null?compactMoney(cap):'Cap. no disponible';
 let reason='Mapa de calor · '+SN(se)+' · '+PC(ch)+' · '+String(s.sector||'Sin sector');
 return '<button type="button" class="heat-stock '+heatmapChangeClass(ch)+' '+heatmapTileSize(s,maxWeight)+'"'+stockOpenAttrs(s,reason,preferTr)+' data-us-heat-key="'+E(stockKey(s))+'" aria-label="'+E((ticker||'Acción')+' '+PC(ch)+' '+(s.name||''))+'">'+
  '<strong>'+E(ticker||'—')+'</strong>'+
  '<span>'+PC(ch)+'</span>'+
  '<small>'+E(capText)+'</small>'+
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
 let box=$('#heatmapResults');if(!box)return;
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
  name,
  stocks,
  weight:stocks.reduce((sum,s)=>sum+heatmapWeight(s),0),
  avg:heatmapSectorAverage(stocks,se)
 })).sort((a,b)=>b.weight-a.weight);
 let maxSector=sectors.length?sectors[0].weight:1;
 box.innerHTML=sectors.length?sectors.map(sec=>{
  let maxStock=Math.max(1,...sec.stocks.map(heatmapWeight));
  let span=heatmapSectorSpan(sec.weight,maxSector);
  return '<section class="heat-sector '+heatmapChangeClass(sec.avg)+'" style="--sector-span:'+span+'">'+
   '<div class="heat-sector-head"><div><strong>'+E(sec.name)+'</strong><small>'+sec.stocks.length+' acciones</small></div><b class="'+C(sec.avg)+'">'+PC(sec.avg)+'</b></div>'+
   '<div class="heat-sector-grid">'+sec.stocks.map(s=>heatmapTile(s,se,maxStock)).join('')+'</div>'+
   '</section>';
 }).join(''):'<div class="empty-state">No hay datos suficientes para construir el mapa de calor en esta sesión.</div>';
 let marketLabel=heatmapState.market==='tr'?'Trade Republic':'EEUU';
 let ses=$('#heatmapSessionText');if(ses)ses.textContent=marketLabel+' · '+SN(se);
 let count=$('#heatmapCount');if(count)count.textContent=selected.length+' de '+universe.length+' acciones';
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
  entry:{title:'Potencial de entrada',text:'Escanea acciones que cumplen el criterio seleccionado. Puedes cambiar sesión, mercado y filtros técnicos. La lista se recalcula con los datos disponibles y no aplica ningún precio mínimo.'},
  recommendation:{title:'Recomendación actual',text:'Selecciona una candidata de EEUU y otra de Trade Republic mediante un análisis multifactor de momentum, volumen, tendencia, RSI, ADX, liquidez y catalizadores. La señal es orientativa y se recalcula continuamente.'},
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
 document.addEventListener('click',e=>{
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
 if(state.currentView==='entry')renderEntry();
 else if(state.currentView==='recommendation')renderRecommendation();
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
let appHistoryReady=false,appHistoryRestoring=false,appHistoryRoot=null;
function syncMobileNavigation(){
 $$('.mobile-nav-item[data-mobile-view]').forEach(x=>x.classList.toggle('active',x.dataset.mobileView===state.currentView));
 let direct=['entry','recommendation','alerts','catalog'];
 let more=$('.mobile-nav-item[data-mobile-more]');
 if(more)more.classList.toggle('active',!direct.includes(state.currentView));
}
function closeMobileMore(){
 let sheet=$('#mobileMoreSheet'),backdrop=$('#mobileMoreBackdrop'),button=$('.mobile-nav-item[data-mobile-more]');
 if(sheet){sheet.classList.remove('open');sheet.setAttribute('aria-hidden','true')}
 if(backdrop){backdrop.classList.remove('open');backdrop.setAttribute('aria-hidden','true')}
 if(button)button.setAttribute('aria-expanded','false');
 document.body.classList.remove('mobile-more-open');
}
function toggleMobileMore(force){
 let sheet=$('#mobileMoreSheet'),backdrop=$('#mobileMoreBackdrop'),button=$('.mobile-nav-item[data-mobile-more]');if(!sheet||!backdrop||!button)return;
 let open=typeof force==='boolean'?force:!sheet.classList.contains('open');
 sheet.classList.toggle('open',open);backdrop.classList.toggle('open',open);button.setAttribute('aria-expanded',open?'true':'false');
 sheet.setAttribute('aria-hidden',open?'false':'true');backdrop.setAttribute('aria-hidden',open?'false':'true');
 document.body.classList.toggle('mobile-more-open',open);
}
function appHistorySnapshot(){
 return {__viewinvai:1,view:state.currentView||'entry',profileKey:state.profileKey||null,profileReason:state.profileReason||'',profileOriginView:state.profileOriginView||null,profileOriginScroll:Math.max(0,Math.round(state.profileOriginScroll||0)),profilePreferTr:state.profilePreferTr,scrollY:Math.max(0,Math.round(window.scrollY||0))};
}
function appHistoryUrl(snap){return location.pathname+location.search+'#app/'+encodeURIComponent(snap.view||'entry')+(snap.profileKey?'/stock/'+encodeURIComponent(snap.profileKey):'')}
function replaceCurrentAppHistory(){
 if(!appHistoryReady||appHistoryRestoring)return;
 let snap=appHistorySnapshot();history.replaceState(snap,'',appHistoryUrl(snap));
}
function pushCurrentAppHistory(){
 if(!appHistoryReady||appHistoryRestoring)return;
 let snap=appHistorySnapshot(),cur=history.state;
 if(cur&&cur.__viewinvai===1&&cur.view===snap.view&&cur.profileKey===snap.profileKey)return;
 history.pushState(snap,'',appHistoryUrl(snap));
}
function applyAppHistorySnapshot(snap){
 if(!snap||snap.__viewinvai!==1||!V[snap.view])return;
 appHistoryRestoring=true;closeMobileMore();
 state.currentView=snap.view;
 state.profileKey=snap.profileKey||null;state.profileReason=snap.profileReason||'';
 state.profileOriginView=V[snap.profileOriginView]?snap.profileOriginView:null;
 state.profileOriginScroll=N(snap.profileOriginScroll)??0;
 state.profilePreferTr=snap.profilePreferTr===true?true:snap.profilePreferTr===false?false:null;
 document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id==='view-'+state.currentView));
 document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===state.currentView));
 syncMobileNavigation();$('#sidebar')?.classList.remove('open');
 let box=$('#stockQuickDetail');
 if(state.profileKey){document.body.classList.add('stock-detail-open');if(box)box.classList.remove('is-hidden');if(db.stocks.length)renderQuickProfile()}
 else{document.body.classList.remove('stock-detail-open');if(box){box.classList.add('is-hidden');box.innerHTML=''}renderCurrentView()}
 saveUiState();
 let y=N(snap.scrollY)??0;requestAnimationFrame(()=>window.scrollTo(0,y));
 appHistoryRestoring=false;
}
function initAppHistory(){
 let current=appHistorySnapshot(),root=Object.assign({},current,{profileKey:null,profileReason:'',profileOriginView:null,profileOriginScroll:0,profilePreferTr:null,scrollY:0,root:true});
 appHistoryRoot=root;
 history.replaceState(root,'',appHistoryUrl(root));
 if(current.profileKey)history.pushState(current,'',appHistoryUrl(current));
 else history.pushState(Object.assign({},root,{root:false,guard:true}),'',appHistoryUrl(root));
 appHistoryReady=true;
 window.addEventListener('popstate',e=>{
  closeMobileMore();
  let snap=e.state;
  if(!snap||snap.__viewinvai!==1){
   history.pushState(Object.assign({},appHistoryRoot,{root:false,guard:true}),'',appHistoryUrl(appHistoryRoot));
   applyAppHistorySnapshot(appHistoryRoot);return;
  }
  applyAppHistorySnapshot(snap);
  if(snap.root){
   setTimeout(()=>history.pushState(Object.assign({},appHistoryRoot,{root:false,guard:true}),'',appHistoryUrl(appHistoryRoot)),0);
  }
 });
}
function show(v,preserveProfile=false,recordHistory=true){
 if(!V[v])return;
 if(recordHistory)replaceCurrentAppHistory();
 if(!preserveProfile){document.body.classList.remove('stock-detail-open');let q=$('#stockQuickDetail');if(q){q.classList.add('is-hidden');q.innerHTML=''}state.profileKey=null;state.profileReason='';state.profileOriginView=null;state.profileOriginScroll=0;state.profilePreferTr=null;}
 state.currentView=v;document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));$('#view-'+v).classList.add('active');
 document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));syncMobileNavigation();
 $('#sidebar').classList.remove('open');closeMobileMore();saveUiState();render();window.scrollTo({top:0,behavior:'auto'});
 if(recordHistory)pushCurrentAppHistory();
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

document.querySelectorAll('.nav-item').forEach(x=>x.addEventListener('click',()=>show(x.dataset.view)));
$$('[data-mobile-view]').forEach(x=>x.addEventListener('click',()=>{let v=x.dataset.mobileView;if(v)show(v)}));
$('.mobile-nav-item[data-mobile-more]')?.addEventListener('click',()=>toggleMobileMore());
$('#mobileMoreClose')?.addEventListener('click',()=>toggleMobileMore(false));
$('#mobileMoreBackdrop')?.addEventListener('click',()=>toggleMobileMore(false));
let keepScreenAwakeToggle=$('#keepScreenAwake');
if(keepScreenAwakeToggle)keepScreenAwakeToggle.addEventListener('change',e=>{
 deviceSettings.keepScreenAwake=!!e.target.checked;
 saveDeviceSettings();
 syncScreenWakeLock();
});
$('#mobileMenu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
document.addEventListener('click',e=>{
 let chartToggle=e.target.closest&&e.target.closest('.chart-market-toggle');
 if(chartToggle){e.preventDefault();e.stopPropagation();switchMiniChartMarket(chartToggle);return}
 let recoSold=e.target.closest&&e.target.closest('[data-reco-sold]');
 if(recoSold){e.preventDefault();e.stopPropagation();markRecommendationSold(recoSold.dataset.recoSold);return}
 let recoOpen=e.target.closest&&e.target.closest('[data-reco-open]');
 if(recoOpen){e.preventDefault();e.stopPropagation();let s=stockByKey(recoOpen.dataset.recoOpen);if(s)openStock(s,'Recomendación actual',recoOpen.dataset.recoPreferTr==='1');return}
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

let catalogSearchTimer=null;
$('#catalogSearch').addEventListener('input',()=>{catalogResetLimit('tr');clearTimeout(catalogSearchTimer);catalogSearchTimer=setTimeout(renderCatalog,220)});
$('#catalogUSSearch').addEventListener('input',()=>{catalogResetLimit('us');clearTimeout(catalogSearchTimer);catalogSearchTimer=setTimeout(renderCatalogUS,220)});
document.addEventListener('change',e=>{
 let sort=e.target.closest&&e.target.closest('.catalog-mobile-sort-select');if(!sort)return;
 let mode=sort.dataset.mode;if(!catalogState[mode])return;
 catalogState[mode].sort=sort.value;catalogResetLimit(mode);renderCatalogTable(mode);
});
['refreshEntry','refreshFuture','refreshRecommendation','refreshHeatmap'].forEach(id=>$('#'+id).addEventListener('click',()=>load(true)));

let catalogFilterTimer=null;
document.addEventListener('input',e=>{
 let f=e.target.closest&&e.target.closest('.catalog-col-filter');if(!f)return;
 let mode=f.dataset.mode,col=f.dataset.col;if(!catalogState[mode]||!col)return;
 catalogState[mode].filters[col]=f.value;catalogResetLimit(mode);clearTimeout(catalogFilterTimer);
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
 if(clear){e.preventDefault();let mode=clear.dataset.catalogMode;if(catalogState[mode]){catalogState[mode].filters={};catalogResetLimit(mode);renderCatalogTable(mode)}return}
 let more=e.target.closest&&e.target.closest('.catalog-load-more');
 if(more){e.preventDefault();let mode=more.dataset.catalogMode;if(catalogState[mode]){catalogState[mode].limit=(catalogState[mode].limit||catalogPageSize())+catalogPageSize();renderCatalogTable(mode)}return}
 let sortDir=e.target.closest&&e.target.closest('.catalog-mobile-sort-dir');
 if(sortDir){e.preventDefault();let mode=sortDir.dataset.mode;if(catalogState[mode]){catalogState[mode].dir*=-1;catalogResetLimit(mode);renderCatalogTable(mode)}return}
 let th=e.target.closest&&e.target.closest('.catalog-table thead tr:first-child th[data-catalog-col]');
 if(!th)return;
 let mode=th.dataset.mode,id=th.dataset.catalogCol,st=catalogState[mode];if(!st)return;
 if(st.sort===id)st.dir*=-1;else{st.sort=id;st.dir=1}catalogResetLimit(mode);renderCatalogTable(mode);
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

applyTheme(readTheme(),false);
restoreUiState();
syncMobileNavigation();
initAppHistory();
syncDeviceSettingsUi();
syncScreenWakeLock();
toUI(state.filters);
initHelpSystem();
let themeButton=$('#themeToggle');if(themeButton)themeButton.addEventListener('click',toggleTheme);
lockAllCriteria();
initLeadersDock();
initTrLive();
initUsLive();
clock();
window.addEventListener('scroll',queueUiSave,{passive:true});
let lastCatalogMobile=catalogIsMobile();
window.addEventListener('resize',()=>{
 let next=catalogIsMobile();
 if(next!==lastCatalogMobile){lastCatalogMobile=next;if(['catalog','catalogUS'].includes(state.currentView)){catalogResetLimit(state.currentView==='catalog'?'tr':'us');renderCurrentView()}}
},{passive:true});
window.addEventListener('pagehide',()=>{saveUiState();releaseScreenWakeLock()});
window.addEventListener('beforeunload',saveUiState);
document.addEventListener('visibilitychange',()=>{
 if(document.hidden){saveUiState();releaseScreenWakeLock()}
 else{syncScreenWakeLock();load(false);pollUsLive();scheduleLiveViewRefresh(0)}
});
setInterval(clock,1000);
setInterval(()=>{if(state.currentView==='recommendation'&&!document.body.classList.contains('stock-detail-open'))renderRecommendation()},5000);
setInterval(()=>load(false),DATA_REFRESH_MS);
load(true);
