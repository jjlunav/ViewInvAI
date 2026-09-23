const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DATA='data/market.json', KEY='catalystpulse:filters:v3', FAV_KEY='catalystpulse:favorites:v1', LEADERS_PIN_KEY='catalystpulse:leadersPinned:v1';
let db={stocks:[],events:[],meta:{}}, loading=false, lastDataStamp='';
let favorites=readFavorites();
let state={entryMarket:'tr',radarMarket:'tr',session:'auto',radarSession:'all',radarDirection:'all',preset:'intraday',profileKey:null,profileReason:''};
const V={entry:'01 Potencial de entrada',future:'02 Potencial futuro',radar:'03 Radar de acciones',calendar:'04 Calendario y noticias',catalog:'05 Catálogo Trade Republic',catalogUS:'06 Catálogo EEUU'};
const P={
 short:{minChange:1,maxChange:0,minRelVolume:1.2,minAdx:18,minRsi:38,maxRsi:72,minVolume:0,trend:false,illiquid:true,sort:'score'},
 medium:{minChange:0,maxChange:0,minRelVolume:1,minAdx:15,minRsi:35,maxRsi:78,minVolume:0,trend:true,illiquid:true,sort:'score'},
 broad:{minChange:0,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:false,sort:'score'},
 intraday:{minChange:2,maxChange:0,minRelVolume:1.5,minAdx:20,minRsi:40,maxRsi:70,minVolume:0,trend:false,illiquid:true,sort:'score'},
 exploded:{minChange:20,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:false,sort:'change'},
 afterhours:{minChange:0,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:false,sort:'afterhours'},
 strict:{minChange:1,maxChange:0,minRelVolume:1.3,minAdx:22,minRsi:42,maxRsi:68,minVolume:0,trend:true,illiquid:true,sort:'score'}
};
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
function pricePair(s,p,preferTr=false){
 let x=priceCurrencies(s,p);
 let primary=preferTr?money(x.eur,'€'):money(x.usd,'
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
 show(s.tradeRepublicVerified?'catalog':'catalogUS',true);
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
 return '<div class="leader-item stock-open-row"'+stockOpenAttrs(s)+' title="#'+(i+1)+' · '+E(s.name||s.ticker)+'"><div class="leader-top"><div class="leader-symbol">'+favButton(s)+'<div class="ticker-stack">'+tickerDisplay(s,preferTr)+'</div></div><span class="'+C(ch)+'">'+PC(ch)+'</span></div><div class="leader-body"><div class="leader-price">'+pricePair(s,p,preferTr)+'</div><div class="leader-volume" title="Volumen actual / volumen medio diario">Vol '+compactVol(vol)+' / '+compactVol(avg)+'</div></div></div>';
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
  return '<div class="favorite-row stock-open-row"'+stockOpenAttrs(s)+'><button type="button" class="fav-star active mini" data-fav-key="'+E(key)+'" title="Quitar de favoritos" aria-label="Quitar de favoritos">★</button><div class="favorite-link" title="'+E(s.name||s.ticker)+'"><div class="favorite-main"><div class="ticker-stack">'+tickerDisplay(s,!!s.tradeRepublicVerified)+'</div>'+pricePair(s,p,!!s.tradeRepublicVerified)+'</div><div class="favorite-stats"><span class="'+C(ch)+'">'+PC(ch)+'</span><small>Vol '+compactVol(v)+' / '+compactVol(avg)+'</small></div></div></div>';
 }).join('');
}
function links(s){let t=encodeURIComponent(String(s.ticker||'').toUpperCase()),tv=encodeURIComponent(String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+(s.ticker||''))).replace(':','-'));return '<div class="external-links"><a target="_blank" rel="noopener" href="https://www.tradingview.com/symbols/'+tv+'/">TradingView ↗</a><a target="_blank" rel="noopener" href="https://www.investing.com/search/?q='+t+'">Investing.com ↗</a><a target="_blank" rel="noopener" href="https://stockmarketwatch.com/stock/'+t+'">StockMarketWatch ↗</a><a target="_blank" rel="noopener" href="https://stocktwits.com/symbol/'+t+'">StockTwits ↗</a></div>'}
function miniChart(s){
 let symbol=String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+(s.ticker||'')));
 return '<div class="mini-chart-block"><div class="mini-chart-title">Velas 1 min · volumen · PREMARKET + REGULAR + POSTMARKET · 04:00–20:00 NY</div><div class="mini-chart" data-symbol="'+E(symbol)+'"><div class="chart-placeholder">Cargando gráfico…</div></div></div>';
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
  hide_side_toolbar:true,hide_top_toolbar:true,hide_legend:false,hide_volume:false,
  allow_symbol_change:false,save_image:false,withdateranges:false,
  extended_hours:true,session:'extended',details:false,hotlist:false,calendar:false,
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
 return '<article class="stock-card '+(dense?'dense-card':'')+'"><div class="stock-main stock-open-row"'+stockOpenAttrs(s,hint)+' title="'+E(hint)+'"><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,preferTr)+'</div><span>'+E(s.name||'')+'</span></div></div><div class="stock-quick">'+pricePair(s,p,preferTr)+'<span class="'+C(ch)+'">'+PC(ch)+'</span>'+(s.tradeRepublicVerified?'<span class="pill ok">TR</span>':'')+'<span class="open-arrow">→</span></div></div></article>';
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

function catalogCard(s,i,mode){
 let se=currentMarketSession(),p=SP(s,se),ch=SC(s,se);
 let primary=mode==='tr'?(s.trTicker||'—'):s.ticker;
 let secondary=mode==='tr'
  ?(s.name+' · EEUU '+(s.exchange||'')+':'+(s.ticker||''))
  :(s.name+(s.tradeRepublicVerified?' · TR '+(s.trTicker||'ticker LSX pendiente'):''));
 let badge=mode==='tr'
  ?'<span class="pill ok">'+E(s.trExchange||'LSX')+'</span>'+(s.instrumentLinkStatus==='same_isin'?'<span class="pill isin-ok">ISIN ✓</span>':s.instrumentLinkStatus==='unverified'?'<span class="pill isin-pending">ISIN ?</span>':'')
  :(s.tradeRepublicVerified?'<span class="pill ok">TR</span>':'');
 let pending=mode==='tr'&&!s.trTicker?'<span class="catalog-pending">ticker LSX pendiente</span>':'';
 return '<article class="stock-card dense-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><strong>'+E(primary)+'</strong><span>'+E(secondary)+'</span></div></div><div class="stock-quick">'+pending+pricePair(s,p,mode==='tr')+'<span class="'+C(ch)+'">'+PC(ch)+'</span>'+badge+'<span class="open-arrow">→</span></div></div></article>';
}
function stockEvents(s){
 return (db.events||[]).filter(e=>{
  if(s.isin&&e.isin&&String(e.isin)===String(s.isin))return true;
  return e.ticker===s.ticker&&(!e.exchange||String(e.exchange)===String(s.exchange));
 });
}
function profileKpi(label,main,sub=''){
 return '<div class="profile-kpi"><small>'+E(label)+'</small><strong>'+main+'</strong>'+(sub?'<span>'+sub+'</span>':'')+'</div>';
}
function profileIdentity(label,value,extra=''){
 return '<div class="profile-identity"><small>'+E(label)+'</small><strong>'+E(value||'—')+'</strong>'+(extra?'<span>'+E(extra)+'</span>':'')+'</div>';
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
  ?'<div class="profile-relation"><span>Instrumento TR</span><strong>'+(s.trTicker?E((s.trExchange||'LSX')+':'+s.trTicker):'Ticker LSX aún no resuelto')+'</strong><span class="relation-arrow">↔</span><span>Cotización EEUU</span><strong>'+E(relatedUs)+'</strong>'+relationBadge+'</div>'
  :(s.tradeRepublicCandidate?'<div class="profile-relation"><span>Cotización EEUU</span><strong>'+E(relatedUs)+'</strong><span class="relation-arrow">↔</span><span>Trade Republic</span><strong>'+E((s.trExchange||'LSX')+':'+(s.trTicker||'pendiente'))+'</strong>'+relationBadge+'</div>':'');
 let trNote=isTr?'<div class="profile-data-note">El ticker principal es el de Trade Republic/LSX. El precio principal se muestra en € y, a continuación, en $. Mientras no dispongamos de una cotización LSX directa para ese instante, el € es una conversión de la cotización estadounidense '+E(relatedUs)+' usando EUR/USD; puede diferir ligeramente de la app de Trade Republic por mercado y spread.</div>':'';
 let context=state.profileReason?'<div class="profile-context"><strong>Por qué llegaste aquí:</strong> '+E(state.profileReason)+'</div>':'';
 let linkStatus=s.instrumentLinkStatus==='same_isin'
  ?'Misma acción · ISIN coincidente'
  :s.instrumentLinkStatus==='different_isin'
   ?'Instrumento distinto · ISIN diferente'
   :'Relación pendiente de verificar por ISIN';
 let identity=[
  profileIdentity('Ticker Trade Republic / LSX',s.trTicker||'Pendiente',s.trExchange||'LSX'),
  profileIdentity('Ticker EEUU',s.ticker||'—',s.exchange||''),
  profileIdentity('ISIN Trade Republic',s.trIsin||'—'),
  profileIdentity('ISIN cotización EEUU',s.usIsin||s.isin||'—'),
  profileIdentity('Relación entre mercados',linkStatus),
  profileIdentity('WKN',s.trWkn||'—'),
  profileIdentity('Nombre en TR / LSX',s.trNameAtExchange||s.name||'—'),
  profileIdentity('Divisa EEUU',s.currency||'USD')
 ].join('');
 let kpis=[
  profileKpi('Regular',pricePair(s,s.price,isTr),'<span class="'+C(s.changePct)+'">'+PC(s.changePct)+'</span> · Vol '+compactVol(s.volume)),
  profileKpi('Premarket',pricePair(s,s.premarketPrice,isTr),'<span class="'+C(s.premarketChangePct)+'">'+PC(s.premarketChangePct)+'</span> · Vol '+compactVol(s.premarketVolume)),
  profileKpi('Postmarket',pricePair(s,s.postmarketPrice,isTr),'<span class="'+C(s.postmarketChangePct)+'">'+PC(s.postmarketChangePct)+'</span> · Vol '+compactVol(s.postmarketVolume)),
  profileKpi('Volumen medio',compactVol(s.avgVolume),N(s.relVolume)!==null?F(s.relVolume,2)+'× relativo':'—'),
  profileKpi('RSI / ADX',F(s.rsi,1)+' / '+F(s.adx,1),'Momentum / fuerza tendencia'),
  profileKpi('EMA20 / EMA50',levelPair(s,s.ema20,isTr)+' · '+levelPair(s,s.ema50,isTr),'Estructura técnica'),
  profileKpi('1 semana',PC(s.perfWeek),'Rendimiento'),
  profileKpi('1 mes',PC(s.perfMonth),'Rendimiento'),
  profileKpi('Próximos resultados',s.earningsDate?DF(s.earningsDate):'—',s.earningsDate?(eventTime({date:s.earningsDate,timeCode:s.earningsTimeCode})||''):'')
 ].join('');
 let upHtml=upcoming.length?upcoming.map(eventItem).join(''):'<div class="profile-empty">No hay eventos futuros fechados cargados para este valor.</div>';
 let newsHtml=news.length?news.map(eventItem).join(''):'<div class="profile-empty">No hay noticias recientes cargadas para este valor.</div>';
 let updated=db.meta.updatedAt?new Date(db.meta.updatedAt).toLocaleString('es-ES'):'—';
 return '<div class="profile-toolbar"><button type="button" class="btn ghost profile-back" data-profile-back="'+E(view)+'">← Volver al catálogo</button><span>Datos actualizados '+E(updated)+'</span></div>'+
  '<div class="profile-hero"><div class="profile-title">'+favButton(s)+'<div><div class="profile-market">'+E(marketTitle)+'</div><h2>'+E(title)+'</h2><p>'+E(s.name||'')+'</p></div></div><div class="profile-live"><small>'+E(SN(se))+(isTr?' · TR/EEUU':' · EEUU')+'</small>'+pricePair(s,SP(s,se),isTr)+'<span class="'+C(SC(s,se))+'">'+PC(SC(s,se))+'</span></div></div>'+
  trRelation+trNote+context+
  '<section class="profile-section profile-chart-section"><div class="profile-section-head"><h3>Gráfico</h3><span>Premarket · Regular · Postmarket · 04:00–20:00 NY</span></div>'+miniChart(s)+'</section>'+
  '<section class="profile-section"><h3>Identificación y mercados</h3><div class="profile-identity-grid">'+identity+'</div></section>'+
  '<section class="profile-section"><h3>Mercado y técnicos</h3><div class="profile-kpi-grid">'+kpis+'</div></section>'+
  '<div class="profile-widget-grid"><section class="profile-section"><div class="profile-section-head"><h3>Empresa</h3><span>Perfil y sector</span></div>'+profileWidget('company',s)+'</section><section class="profile-section"><div class="profile-section-head"><h3>Fundamentales</h3><span>Datos financieros</span></div>'+profileWidget('fundamentals',s)+'</section></div>'+
  '<section class="profile-section"><div class="profile-section-head"><h3>Noticias en directo</h3><span>Feed del símbolo</span></div>'+profileWidget('news',s)+'</section>'+
  '<section class="profile-section"><div class="profile-section-head"><h3>Próximos eventos</h3><span>'+upcoming.length+' cargados</span></div><div class="event-list profile-events">'+upHtml+'</div></section>'+
  '<section class="profile-section"><div class="profile-section-head"><h3>Noticias y catalizadores</h3><span>'+news.length+' recientes</span></div><div class="event-list profile-events">'+newsHtml+'</div></section>'+
  '<section class="profile-section"><h3>Fuentes externas</h3>'+links(s)+'</section>';
}
function renderProfileView(view){
 let isTr=view==='catalog';
 let detail=$(isTr?'#catalogDetail':'#catalogUSDetail');
 let browse=$(isTr?'#catalogBrowse':'#catalogUSBrowse');
 if(!detail||!browse)return false;
 let s=state.profileKey?stockByKey(state.profileKey):null;
 let valid=s&&(isTr?!!s.tradeRepublicVerified:market(s,'us'));
 if(!valid){
  detail.classList.add('is-hidden');
  browse.classList.remove('is-hidden');
  return false;
 }
 browse.classList.add('is-hidden');
 detail.classList.remove('is-hidden');
 detail.innerHTML=profileHtml(s,view);
 requestAnimationFrame(()=>{
  detail.querySelectorAll('.mini-chart').forEach(loadMiniChart);
  detail.querySelectorAll('.profile-tv-widget').forEach(loadProfileWidget);
 });
 return true;
}
function renderCatalog(){
 if(renderProfileView('catalog'))return;
 let q=$('#catalogSearch').value.trim().toLowerCase();
 let all=db.stocks.filter(s=>s.tradeRepublicVerified);
 let rows=all.filter(s=>!q||((s.trTicker||'')+' '+s.ticker+' '+s.name+' '+(s.isin||'')+' '+(s.trNameAtExchange||'')).toLowerCase().includes(q)).sort((x,y)=>String(x.trTicker||x.ticker).localeCompare(String(y.trTicker||y.ticker)));
 $('#catalogCount').textContent=rows.length.toLocaleString('es-ES')+' cotizando · '+Number(db.meta.trTickerCount||0).toLocaleString('es-ES')+' ticker LSX resueltos · '+Number(db.meta.trOfficialCount||0).toLocaleString('es-ES')+' universo oficial';
 $('#catalogResults').innerHTML=rows.length?rows.slice(0,800).map((s,i)=>catalogCard(s,i,'tr')).join(''):'<div class="empty-state">No hay coincidencias verificadas cargadas.</div>';
}
function renderCatalogUS(){
 if(renderProfileView('catalogUS'))return;
 let q=$('#catalogUSSearch').value.trim().toLowerCase();
 let all=db.stocks.filter(s=>market(s,'us'));
 let rows=all.filter(s=>!q||(s.ticker+' '+s.name+' '+(s.isin||'')+' '+(s.trTicker||'')).toLowerCase().includes(q)).sort((x,y)=>String(x.ticker).localeCompare(String(y.ticker)));
 $('#catalogUSCount').textContent=rows.length.toLocaleString('es-ES')+' valores EEUU';
 $('#catalogUSResults').innerHTML=rows.length?rows.slice(0,1000).map((s,i)=>catalogCard(s,i,'us')).join(''):'<div class="empty-state">No hay coincidencias en el catálogo EEUU.</div>';
}
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
function renderRadar(){let q=$('#radarSearch').value.trim().toLowerCase(),rs=state.radarSession,se=rs==='all'?SES():rs,a=db.stocks.filter(s=>state.radarMarket==='all'||market(s,state.radarMarket)).filter(s=>!q||(s.ticker+' '+s.name+' '+(s.isin||'')).toLowerCase().includes(q));if(rs!=='all')a=a.filter(s=>SC(s,rs)!==null);if(state.radarDirection==='up')a=a.filter(s=>(SC(s,se)??0)>0);if(state.radarDirection==='down')a=a.filter(s=>(SC(s,se)??0)<0);a.sort((x,y)=>(SC(y,se)??-999)-(SC(x,se)??-999));let shown=a.slice(0,300);$('#radarResults').innerHTML=shown.length?shown.map((s,i)=>{let next=shown[i+1],txt='Radar ordenado por variación en '+SN(se)+': '+PC(SC(s,se))+(next?' frente a '+PC(SC(next,se))+' de #'+(i+2)+' '+E(next.ticker)+'.':'.');return card(s,i,se,true,txt,state.radarMarket==='tr'||(state.radarMarket==='all'&&!!s.tradeRepublicVerified))}).join(''):'<div class="empty-state">Sin valores con estos filtros.</div>'}
function renderCalendar(){
 let rows=[...(db.events||[])].sort((x,y)=>new Date(y.date)-new Date(x.date));
 $('#calendarResults').innerHTML=rows.length?rows.slice(0,400).map((e,i)=>{
  let s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  return '<article class="stock-card dense-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,!!s.tradeRepublicVerified)+'</div><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+DF(e.date)+'</b><span class="event-type">'+E(EL(e))+'</span><span class="open-arrow">→</span></div></div></article>';
 }).join(''):'<div class="empty-state">Sin eventos o noticias disponibles.</div>';
}

function status(){}
function render(){renderMarketLeaders();renderFavorites();renderEntry();renderFuture();renderRadar();renderCalendar();renderCatalog();renderCatalogUS();status()}
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
  db={stocks:j.stocks,events:Array.isArray(j.events)?j.events:[],meta:j.meta||{}};
  render();
 }catch(e){
  console.error(e);
  if(!db.stocks.length)document.querySelectorAll('.stock-list').forEach(x=>x.innerHTML='<div class="empty-state">No se pudieron cargar los datos de mercado. Reintenta en unos instantes.</div>')
 }finally{
  loading=false
 }
}
function show(v,preserveProfile=false){if(!V[v])return;if(!preserveProfile){state.profileKey=null;state.profileReason='';}document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));$('#view-'+v).classList.add('active');document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));$('#sidebar').classList.remove('open');render()}
let lastLeaderSession=null;
function clock(){
 let now=new Date();
 document.querySelectorAll('.market-clock').forEach(x=>{
  let tz=x.dataset.tz,time=x.querySelector('time');
  if(!time||!tz)return;
  time.textContent=new Intl.DateTimeFormat('es-ES',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
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
$$('[data-tab-group="radarMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{state.radarMarket=b.dataset.tab;$$('[data-tab-group="radarMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));renderRadar()}));
['futureHorizon','futureType','futureTrOnly'].forEach(id=>$('#'+id).addEventListener('change',renderFuture));$('#radarSearch').addEventListener('input',renderRadar);
$('#radarSession').addEventListener('change',e=>{state.radarSession=e.target.value;renderRadar()});$('#radarDirection').addEventListener('change',e=>{state.radarDirection=e.target.value;renderRadar()});$('#catalogSearch').addEventListener('input',renderCatalog);$('#catalogUSSearch').addEventListener('input',renderCatalogUS);
['refreshEntry','refreshFuture','refreshRadar'].forEach(id=>$('#'+id).addEventListener('click',()=>load(true)));
toUI(state.filters);lockAllCriteria();initLeadersDock();clock();setInterval(clock,30000);setInterval(()=>load(false),1000);load(true););
 let secondary=preferTr?money(x.usd,'
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
 show(s.tradeRepublicVerified?'catalog':'catalogUS',true);
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
 return '<div class="leader-item stock-open-row"'+stockOpenAttrs(s)+' title="#'+(i+1)+' · '+E(s.name||s.ticker)+'"><div class="leader-top"><div class="leader-symbol">'+favButton(s)+'<div class="ticker-stack">'+tickerDisplay(s,preferTr)+'</div></div><span class="'+C(ch)+'">'+PC(ch)+'</span></div><div class="leader-body"><div class="leader-price">'+PR(p)+'</div><div class="leader-volume" title="Volumen actual / volumen medio diario">Vol '+compactVol(vol)+' / '+compactVol(avg)+'</div></div></div>';
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
  return '<div class="favorite-row stock-open-row"'+stockOpenAttrs(s)+'><button type="button" class="fav-star active mini" data-fav-key="'+E(key)+'" title="Quitar de favoritos" aria-label="Quitar de favoritos">★</button><div class="favorite-link" title="'+E(s.name||s.ticker)+'"><div class="favorite-main"><div class="ticker-stack">'+tickerDisplay(s,!!s.tradeRepublicVerified)+'</div><span>'+PR(p)+'</span></div><div class="favorite-stats"><span class="'+C(ch)+'">'+PC(ch)+'</span><small>Vol '+compactVol(v)+' / '+compactVol(avg)+'</small></div></div></div>';
 }).join('');
}
function links(s){let t=encodeURIComponent(String(s.ticker||'').toUpperCase()),tv=encodeURIComponent(String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+(s.ticker||''))).replace(':','-'));return '<div class="external-links"><a target="_blank" rel="noopener" href="https://www.tradingview.com/symbols/'+tv+'/">TradingView ↗</a><a target="_blank" rel="noopener" href="https://www.investing.com/search/?q='+t+'">Investing.com ↗</a><a target="_blank" rel="noopener" href="https://stockmarketwatch.com/stock/'+t+'">StockMarketWatch ↗</a><a target="_blank" rel="noopener" href="https://stocktwits.com/symbol/'+t+'">StockTwits ↗</a></div>'}
function miniChart(s){
 let symbol=String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+(s.ticker||'')));
 return '<div class="mini-chart-block"><div class="mini-chart-title">Velas 1 min · volumen · horario extendido 04:00–20:00 NY</div><div class="mini-chart" data-symbol="'+E(symbol)+'"><div class="chart-placeholder">Cargando gráfico…</div></div></div>';
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
  hide_side_toolbar:true,hide_top_toolbar:true,hide_legend:false,hide_volume:false,
  allow_symbol_change:false,save_image:false,withdateranges:false,
  extended_hours:true,session:'extended',details:false,hotlist:false,calendar:false,
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
 return '<article class="stock-card '+(dense?'dense-card':'')+'"><div class="stock-main stock-open-row"'+stockOpenAttrs(s,hint)+' title="'+E(hint)+'"><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,preferTr)+'</div><span>'+E(s.name||'')+'</span></div></div><div class="stock-quick"><b>'+PR(p)+'</b><span class="'+C(ch)+'">'+PC(ch)+'</span>'+(s.tradeRepublicVerified?'<span class="pill ok">TR</span>':'')+'<span class="open-arrow">→</span></div></div></article>';
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

function catalogCard(s,i,mode){
 let se=currentMarketSession(),p=SP(s,se),ch=SC(s,se);
 let primary=mode==='tr'?(s.trTicker||'—'):s.ticker;
 let secondary=mode==='tr'
  ?(s.name+' · EEUU '+(s.exchange||'')+':'+(s.ticker||''))
  :(s.name+(s.tradeRepublicVerified?' · TR '+(s.trTicker||'ticker LSX pendiente'):''));
 let badge=mode==='tr'
  ?'<span class="pill ok">'+E(s.trExchange||'LSX')+'</span>'+(s.instrumentLinkStatus==='same_isin'?'<span class="pill isin-ok">ISIN ✓</span>':s.instrumentLinkStatus==='unverified'?'<span class="pill isin-pending">ISIN ?</span>':'')
  :(s.tradeRepublicVerified?'<span class="pill ok">TR</span>':'');
 let pending=mode==='tr'&&!s.trTicker?'<span class="catalog-pending">ticker LSX pendiente</span>':'';
 return '<article class="stock-card dense-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><strong>'+E(primary)+'</strong><span>'+E(secondary)+'</span></div></div><div class="stock-quick">'+pending+'<small class="catalog-price-source">EEUU</small><b>'+PR(p)+'</b><span class="'+C(ch)+'">'+PC(ch)+'</span>'+badge+'<span class="open-arrow">→</span></div></div></article>';
}
function stockEvents(s){
 return (db.events||[]).filter(e=>{
  if(s.isin&&e.isin&&String(e.isin)===String(s.isin))return true;
  return e.ticker===s.ticker&&(!e.exchange||String(e.exchange)===String(s.exchange));
 });
}
function profileKpi(label,main,sub=''){
 return '<div class="profile-kpi"><small>'+E(label)+'</small><strong>'+main+'</strong>'+(sub?'<span>'+sub+'</span>':'')+'</div>';
}
function profileIdentity(label,value,extra=''){
 return '<div class="profile-identity"><small>'+E(label)+'</small><strong>'+E(value||'—')+'</strong>'+(extra?'<span>'+E(extra)+'</span>':'')+'</div>';
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
  ?'<div class="profile-relation"><span>Instrumento TR</span><strong>'+(s.trTicker?E((s.trExchange||'LSX')+':'+s.trTicker):'Ticker LSX aún no resuelto')+'</strong><span class="relation-arrow">↔</span><span>Cotización EEUU</span><strong>'+E(relatedUs)+'</strong>'+relationBadge+'</div>'
  :(s.tradeRepublicCandidate?'<div class="profile-relation"><span>Cotización EEUU</span><strong>'+E(relatedUs)+'</strong><span class="relation-arrow">↔</span><span>Trade Republic</span><strong>'+E((s.trExchange||'LSX')+':'+(s.trTicker||'pendiente'))+'</strong>'+relationBadge+'</div>':'');
 let trNote=isTr?'<div class="profile-data-note">El ticker principal de esta ficha es el utilizado por Trade Republic/LSX. Los precios, técnicos, premarket y postmarket que se muestran debajo proceden de la cotización estadounidense relacionada '+E(relatedUs)+'.</div>':'';
 let context=state.profileReason?'<div class="profile-context"><strong>Por qué llegaste aquí:</strong> '+E(state.profileReason)+'</div>':'';
 let linkStatus=s.instrumentLinkStatus==='same_isin'
  ?'Misma acción · ISIN coincidente'
  :s.instrumentLinkStatus==='different_isin'
   ?'Instrumento distinto · ISIN diferente'
   :'Relación pendiente de verificar por ISIN';
 let identity=[
  profileIdentity('Ticker Trade Republic / LSX',s.trTicker||'Pendiente',s.trExchange||'LSX'),
  profileIdentity('Ticker EEUU',s.ticker||'—',s.exchange||''),
  profileIdentity('ISIN Trade Republic',s.trIsin||'—'),
  profileIdentity('ISIN cotización EEUU',s.usIsin||s.isin||'—'),
  profileIdentity('Relación entre mercados',linkStatus),
  profileIdentity('WKN',s.trWkn||'—'),
  profileIdentity('Nombre en TR / LSX',s.trNameAtExchange||s.name||'—'),
  profileIdentity('Divisa EEUU',s.currency||'USD')
 ].join('');
 let kpis=[
  profileKpi('Regular',PR(s.price),'<span class="'+C(s.changePct)+'">'+PC(s.changePct)+'</span> · Vol '+compactVol(s.volume)),
  profileKpi('Premarket',PR(s.premarketPrice),'<span class="'+C(s.premarketChangePct)+'">'+PC(s.premarketChangePct)+'</span> · Vol '+compactVol(s.premarketVolume)),
  profileKpi('Postmarket',PR(s.postmarketPrice),'<span class="'+C(s.postmarketChangePct)+'">'+PC(s.postmarketChangePct)+'</span> · Vol '+compactVol(s.postmarketVolume)),
  profileKpi('Volumen medio',compactVol(s.avgVolume),N(s.relVolume)!==null?F(s.relVolume,2)+'× relativo':'—'),
  profileKpi('RSI / ADX',F(s.rsi,1)+' / '+F(s.adx,1),'Momentum / fuerza tendencia'),
  profileKpi('EMA20 / EMA50',PR(s.ema20)+' / '+PR(s.ema50),'Estructura técnica'),
  profileKpi('1 semana',PC(s.perfWeek),'Rendimiento'),
  profileKpi('1 mes',PC(s.perfMonth),'Rendimiento'),
  profileKpi('Próximos resultados',s.earningsDate?DF(s.earningsDate):'—',s.earningsDate?(eventTime({date:s.earningsDate,timeCode:s.earningsTimeCode})||''):'')
 ].join('');
 let upHtml=upcoming.length?upcoming.map(eventItem).join(''):'<div class="profile-empty">No hay eventos futuros fechados cargados para este valor.</div>';
 let newsHtml=news.length?news.map(eventItem).join(''):'<div class="profile-empty">No hay noticias recientes cargadas para este valor.</div>';
 let updated=db.meta.updatedAt?new Date(db.meta.updatedAt).toLocaleString('es-ES'):'—';
 return '<div class="profile-toolbar"><button type="button" class="btn ghost profile-back" data-profile-back="'+E(view)+'">← Volver al catálogo</button><span>Datos actualizados '+E(updated)+'</span></div>'+
  '<div class="profile-hero"><div class="profile-title">'+favButton(s)+'<div><div class="profile-market">'+E(marketTitle)+'</div><h2>'+E(title)+'</h2><p>'+E(s.name||'')+'</p></div></div><div class="profile-live"><small>'+E(SN(se))+' · EEUU</small><strong>'+PR(SP(s,se))+'</strong><span class="'+C(SC(s,se))+'">'+PC(SC(s,se))+'</span></div></div>'+
  trRelation+trNote+context+
  '<section class="profile-section"><h3>Identificación y mercados</h3><div class="profile-identity-grid">'+identity+'</div></section>'+
  '<section class="profile-section"><h3>Mercado y técnicos</h3><div class="profile-kpi-grid">'+kpis+'</div></section>'+
  '<section class="profile-section profile-chart-section"><div class="profile-section-head"><h3>Gráfico</h3><span>Velas 1 minuto · horario extendido EEUU</span></div>'+miniChart(s)+'</section>'+
  '<div class="profile-widget-grid"><section class="profile-section"><div class="profile-section-head"><h3>Empresa</h3><span>Perfil y sector</span></div>'+profileWidget('company',s)+'</section><section class="profile-section"><div class="profile-section-head"><h3>Fundamentales</h3><span>Datos financieros</span></div>'+profileWidget('fundamentals',s)+'</section></div>'+
  '<section class="profile-section"><div class="profile-section-head"><h3>Noticias en directo</h3><span>Feed del símbolo</span></div>'+profileWidget('news',s)+'</section>'+
  '<section class="profile-section"><div class="profile-section-head"><h3>Próximos eventos</h3><span>'+upcoming.length+' cargados</span></div><div class="event-list profile-events">'+upHtml+'</div></section>'+
  '<section class="profile-section"><div class="profile-section-head"><h3>Noticias y catalizadores</h3><span>'+news.length+' recientes</span></div><div class="event-list profile-events">'+newsHtml+'</div></section>'+
  '<section class="profile-section"><h3>Fuentes externas</h3>'+links(s)+'</section>';
}
function renderProfileView(view){
 let isTr=view==='catalog';
 let detail=$(isTr?'#catalogDetail':'#catalogUSDetail');
 let browse=$(isTr?'#catalogBrowse':'#catalogUSBrowse');
 if(!detail||!browse)return false;
 let s=state.profileKey?stockByKey(state.profileKey):null;
 let valid=s&&(isTr?!!s.tradeRepublicVerified:market(s,'us'));
 if(!valid){
  detail.classList.add('is-hidden');
  browse.classList.remove('is-hidden');
  return false;
 }
 browse.classList.add('is-hidden');
 detail.classList.remove('is-hidden');
 detail.innerHTML=profileHtml(s,view);
 requestAnimationFrame(()=>{
  detail.querySelectorAll('.mini-chart').forEach(loadMiniChart);
  detail.querySelectorAll('.profile-tv-widget').forEach(loadProfileWidget);
 });
 return true;
}
function renderCatalog(){
 if(renderProfileView('catalog'))return;
 let q=$('#catalogSearch').value.trim().toLowerCase();
 let all=db.stocks.filter(s=>s.tradeRepublicVerified);
 let rows=all.filter(s=>!q||((s.trTicker||'')+' '+s.ticker+' '+s.name+' '+(s.isin||'')+' '+(s.trNameAtExchange||'')).toLowerCase().includes(q)).sort((x,y)=>String(x.trTicker||x.ticker).localeCompare(String(y.trTicker||y.ticker)));
 $('#catalogCount').textContent=rows.length.toLocaleString('es-ES')+' cotizando · '+Number(db.meta.trTickerCount||0).toLocaleString('es-ES')+' ticker LSX resueltos · '+Number(db.meta.trOfficialCount||0).toLocaleString('es-ES')+' universo oficial';
 $('#catalogResults').innerHTML=rows.length?rows.slice(0,800).map((s,i)=>catalogCard(s,i,'tr')).join(''):'<div class="empty-state">No hay coincidencias verificadas cargadas.</div>';
}
function renderCatalogUS(){
 if(renderProfileView('catalogUS'))return;
 let q=$('#catalogUSSearch').value.trim().toLowerCase();
 let all=db.stocks.filter(s=>market(s,'us'));
 let rows=all.filter(s=>!q||(s.ticker+' '+s.name+' '+(s.isin||'')+' '+(s.trTicker||'')).toLowerCase().includes(q)).sort((x,y)=>String(x.ticker).localeCompare(String(y.ticker)));
 $('#catalogUSCount').textContent=rows.length.toLocaleString('es-ES')+' valores EEUU';
 $('#catalogUSResults').innerHTML=rows.length?rows.slice(0,1000).map((s,i)=>catalogCard(s,i,'us')).join(''):'<div class="empty-state">No hay coincidencias en el catálogo EEUU.</div>';
}
function renderFuture(){
 let h=+$('#futureHorizon').value,t=$('#futureType').value,tr=$('#futureTrOnly').checked,now=Date.now();
 let filtered=(db.events||[]).filter(e=>futureWindowEvent(e,h,now)&&(t==='all'||e.type===t)&&(!tr||e.tradeRepublicVerified));
 let groups=groupFutureEvents(filtered);
 $('#futureResults').innerHTML=groups.length?groups.slice(0,180).map((g,i)=>{
  let e=g.first,s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  let count=g.items.length,label=count===1?EL(e):(count+' catalizadores'),when=eventWhen(e);
  return '<article class="stock-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,tr&&!!s.tradeRepublicVerified)+'</div><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+E(when)+'</b><span class="event-type">'+E(label)+'</span>'+(e.tradeRepublicVerified?'<span class="pill ok">TR</span>':'')+'<span class="open-arrow">→</span></div></div></article>';
 }).join(''):'<div class="empty-state">No hay catalizadores desde ahora hasta '+h+' día'+(h===1?'':'s')+' vista con estos filtros.</div>';
}
function renderRadar(){let q=$('#radarSearch').value.trim().toLowerCase(),rs=state.radarSession,se=rs==='all'?SES():rs,a=db.stocks.filter(s=>state.radarMarket==='all'||market(s,state.radarMarket)).filter(s=>!q||(s.ticker+' '+s.name+' '+(s.isin||'')).toLowerCase().includes(q));if(rs!=='all')a=a.filter(s=>SC(s,rs)!==null);if(state.radarDirection==='up')a=a.filter(s=>(SC(s,se)??0)>0);if(state.radarDirection==='down')a=a.filter(s=>(SC(s,se)??0)<0);a.sort((x,y)=>(SC(y,se)??-999)-(SC(x,se)??-999));let shown=a.slice(0,300);$('#radarResults').innerHTML=shown.length?shown.map((s,i)=>{let next=shown[i+1],txt='Radar ordenado por variación en '+SN(se)+': '+PC(SC(s,se))+(next?' frente a '+PC(SC(next,se))+' de #'+(i+2)+' '+E(next.ticker)+'.':'.');return card(s,i,se,true,txt,state.radarMarket==='tr')}).join(''):'<div class="empty-state">Sin valores con estos filtros.</div>'}
function renderCalendar(){
 let rows=[...(db.events||[])].sort((x,y)=>new Date(y.date)-new Date(x.date));
 $('#calendarResults').innerHTML=rows.length?rows.slice(0,400).map((e,i)=>{
  let s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  return '<article class="stock-card dense-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><strong>'+E(e.ticker)+'</strong><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+DF(e.date)+'</b><span class="event-type">'+E(EL(e))+'</span><span class="open-arrow">→</span></div></div></article>';
 }).join(''):'<div class="empty-state">Sin eventos o noticias disponibles.</div>';
}

function status(){}
function render(){renderMarketLeaders();renderFavorites();renderEntry();renderFuture();renderRadar();renderCalendar();renderCatalog();renderCatalogUS();status()}
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
  db={stocks:j.stocks,events:Array.isArray(j.events)?j.events:[],meta:j.meta||{}};
  render();
 }catch(e){
  console.error(e);
  if(!db.stocks.length)document.querySelectorAll('.stock-list').forEach(x=>x.innerHTML='<div class="empty-state">No se pudieron cargar los datos de mercado. Reintenta en unos instantes.</div>')
 }finally{
  loading=false
 }
}
function show(v,preserveProfile=false){if(!V[v])return;if(!preserveProfile){state.profileKey=null;state.profileReason='';}document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));$('#view-'+v).classList.add('active');document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));$('#sidebar').classList.remove('open');render()}
let lastLeaderSession=null;
function clock(){
 let now=new Date();
 document.querySelectorAll('.market-clock').forEach(x=>{
  let tz=x.dataset.tz,time=x.querySelector('time');
  if(!time||!tz)return;
  time.textContent=new Intl.DateTimeFormat('es-ES',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
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
$$('[data-tab-group="radarMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{state.radarMarket=b.dataset.tab;$$('[data-tab-group="radarMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));renderRadar()}));
['futureHorizon','futureType','futureTrOnly'].forEach(id=>$('#'+id).addEventListener('change',renderFuture));$('#radarSearch').addEventListener('input',renderRadar);
$('#radarSession').addEventListener('change',e=>{state.radarSession=e.target.value;renderRadar()});$('#radarDirection').addEventListener('change',e=>{state.radarDirection=e.target.value;renderRadar()});$('#catalogSearch').addEventListener('input',renderCatalog);$('#catalogUSSearch').addEventListener('input',renderCatalogUS);
['refreshEntry','refreshFuture','refreshRadar'].forEach(id=>$('#'+id).addEventListener('click',()=>load(true)));
toUI(state.filters);lockAllCriteria();initLeadersDock();clock();setInterval(clock,30000);setInterval(()=>load(false),1000);load(true);):money(x.eur,'€');
 let source=preferTr?'Precio en € convertido desde la cotización EEUU mediante EUR/USD; la cotización LSX/TR puede diferir por mercado y spread.':'Precio EEUU en $; valor en € mostrado como referencia mediante EUR/USD.';
 return '<span class="price-pair" title="'+E(source)+'"><strong>'+primary+'</strong><small>/ '+secondary+'</small></span>';
}
function levelPair(s,p,preferTr=false){
 let x=priceCurrencies(s,p);
 let primary=preferTr?money(x.eur,'€'):money(x.usd,'
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
 show(s.tradeRepublicVerified?'catalog':'catalogUS',true);
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
 return '<div class="leader-item stock-open-row"'+stockOpenAttrs(s)+' title="#'+(i+1)+' · '+E(s.name||s.ticker)+'"><div class="leader-top"><div class="leader-symbol">'+favButton(s)+'<div class="ticker-stack">'+tickerDisplay(s,preferTr)+'</div></div><span class="'+C(ch)+'">'+PC(ch)+'</span></div><div class="leader-body"><div class="leader-price">'+PR(p)+'</div><div class="leader-volume" title="Volumen actual / volumen medio diario">Vol '+compactVol(vol)+' / '+compactVol(avg)+'</div></div></div>';
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
  return '<div class="favorite-row stock-open-row"'+stockOpenAttrs(s)+'><button type="button" class="fav-star active mini" data-fav-key="'+E(key)+'" title="Quitar de favoritos" aria-label="Quitar de favoritos">★</button><div class="favorite-link" title="'+E(s.name||s.ticker)+'"><div class="favorite-main"><div class="ticker-stack">'+tickerDisplay(s,!!s.tradeRepublicVerified)+'</div><span>'+PR(p)+'</span></div><div class="favorite-stats"><span class="'+C(ch)+'">'+PC(ch)+'</span><small>Vol '+compactVol(v)+' / '+compactVol(avg)+'</small></div></div></div>';
 }).join('');
}
function links(s){let t=encodeURIComponent(String(s.ticker||'').toUpperCase()),tv=encodeURIComponent(String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+(s.ticker||''))).replace(':','-'));return '<div class="external-links"><a target="_blank" rel="noopener" href="https://www.tradingview.com/symbols/'+tv+'/">TradingView ↗</a><a target="_blank" rel="noopener" href="https://www.investing.com/search/?q='+t+'">Investing.com ↗</a><a target="_blank" rel="noopener" href="https://stockmarketwatch.com/stock/'+t+'">StockMarketWatch ↗</a><a target="_blank" rel="noopener" href="https://stocktwits.com/symbol/'+t+'">StockTwits ↗</a></div>'}
function miniChart(s){
 let symbol=String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+(s.ticker||'')));
 return '<div class="mini-chart-block"><div class="mini-chart-title">Velas 1 min · volumen · horario extendido 04:00–20:00 NY</div><div class="mini-chart" data-symbol="'+E(symbol)+'"><div class="chart-placeholder">Cargando gráfico…</div></div></div>';
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
  hide_side_toolbar:true,hide_top_toolbar:true,hide_legend:false,hide_volume:false,
  allow_symbol_change:false,save_image:false,withdateranges:false,
  extended_hours:true,session:'extended',details:false,hotlist:false,calendar:false,
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
 return '<article class="stock-card '+(dense?'dense-card':'')+'"><div class="stock-main stock-open-row"'+stockOpenAttrs(s,hint)+' title="'+E(hint)+'"><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,preferTr)+'</div><span>'+E(s.name||'')+'</span></div></div><div class="stock-quick"><b>'+PR(p)+'</b><span class="'+C(ch)+'">'+PC(ch)+'</span>'+(s.tradeRepublicVerified?'<span class="pill ok">TR</span>':'')+'<span class="open-arrow">→</span></div></div></article>';
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

function catalogCard(s,i,mode){
 let se=currentMarketSession(),p=SP(s,se),ch=SC(s,se);
 let primary=mode==='tr'?(s.trTicker||'—'):s.ticker;
 let secondary=mode==='tr'
  ?(s.name+' · EEUU '+(s.exchange||'')+':'+(s.ticker||''))
  :(s.name+(s.tradeRepublicVerified?' · TR '+(s.trTicker||'ticker LSX pendiente'):''));
 let badge=mode==='tr'
  ?'<span class="pill ok">'+E(s.trExchange||'LSX')+'</span>'+(s.instrumentLinkStatus==='same_isin'?'<span class="pill isin-ok">ISIN ✓</span>':s.instrumentLinkStatus==='unverified'?'<span class="pill isin-pending">ISIN ?</span>':'')
  :(s.tradeRepublicVerified?'<span class="pill ok">TR</span>':'');
 let pending=mode==='tr'&&!s.trTicker?'<span class="catalog-pending">ticker LSX pendiente</span>':'';
 return '<article class="stock-card dense-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><strong>'+E(primary)+'</strong><span>'+E(secondary)+'</span></div></div><div class="stock-quick">'+pending+'<small class="catalog-price-source">EEUU</small><b>'+PR(p)+'</b><span class="'+C(ch)+'">'+PC(ch)+'</span>'+badge+'<span class="open-arrow">→</span></div></div></article>';
}
function stockEvents(s){
 return (db.events||[]).filter(e=>{
  if(s.isin&&e.isin&&String(e.isin)===String(s.isin))return true;
  return e.ticker===s.ticker&&(!e.exchange||String(e.exchange)===String(s.exchange));
 });
}
function profileKpi(label,main,sub=''){
 return '<div class="profile-kpi"><small>'+E(label)+'</small><strong>'+main+'</strong>'+(sub?'<span>'+sub+'</span>':'')+'</div>';
}
function profileIdentity(label,value,extra=''){
 return '<div class="profile-identity"><small>'+E(label)+'</small><strong>'+E(value||'—')+'</strong>'+(extra?'<span>'+E(extra)+'</span>':'')+'</div>';
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
  ?'<div class="profile-relation"><span>Instrumento TR</span><strong>'+(s.trTicker?E((s.trExchange||'LSX')+':'+s.trTicker):'Ticker LSX aún no resuelto')+'</strong><span class="relation-arrow">↔</span><span>Cotización EEUU</span><strong>'+E(relatedUs)+'</strong>'+relationBadge+'</div>'
  :(s.tradeRepublicCandidate?'<div class="profile-relation"><span>Cotización EEUU</span><strong>'+E(relatedUs)+'</strong><span class="relation-arrow">↔</span><span>Trade Republic</span><strong>'+E((s.trExchange||'LSX')+':'+(s.trTicker||'pendiente'))+'</strong>'+relationBadge+'</div>':'');
 let trNote=isTr?'<div class="profile-data-note">El ticker principal de esta ficha es el utilizado por Trade Republic/LSX. Los precios, técnicos, premarket y postmarket que se muestran debajo proceden de la cotización estadounidense relacionada '+E(relatedUs)+'.</div>':'';
 let context=state.profileReason?'<div class="profile-context"><strong>Por qué llegaste aquí:</strong> '+E(state.profileReason)+'</div>':'';
 let linkStatus=s.instrumentLinkStatus==='same_isin'
  ?'Misma acción · ISIN coincidente'
  :s.instrumentLinkStatus==='different_isin'
   ?'Instrumento distinto · ISIN diferente'
   :'Relación pendiente de verificar por ISIN';
 let identity=[
  profileIdentity('Ticker Trade Republic / LSX',s.trTicker||'Pendiente',s.trExchange||'LSX'),
  profileIdentity('Ticker EEUU',s.ticker||'—',s.exchange||''),
  profileIdentity('ISIN Trade Republic',s.trIsin||'—'),
  profileIdentity('ISIN cotización EEUU',s.usIsin||s.isin||'—'),
  profileIdentity('Relación entre mercados',linkStatus),
  profileIdentity('WKN',s.trWkn||'—'),
  profileIdentity('Nombre en TR / LSX',s.trNameAtExchange||s.name||'—'),
  profileIdentity('Divisa EEUU',s.currency||'USD')
 ].join('');
 let kpis=[
  profileKpi('Regular',PR(s.price),'<span class="'+C(s.changePct)+'">'+PC(s.changePct)+'</span> · Vol '+compactVol(s.volume)),
  profileKpi('Premarket',PR(s.premarketPrice),'<span class="'+C(s.premarketChangePct)+'">'+PC(s.premarketChangePct)+'</span> · Vol '+compactVol(s.premarketVolume)),
  profileKpi('Postmarket',PR(s.postmarketPrice),'<span class="'+C(s.postmarketChangePct)+'">'+PC(s.postmarketChangePct)+'</span> · Vol '+compactVol(s.postmarketVolume)),
  profileKpi('Volumen medio',compactVol(s.avgVolume),N(s.relVolume)!==null?F(s.relVolume,2)+'× relativo':'—'),
  profileKpi('RSI / ADX',F(s.rsi,1)+' / '+F(s.adx,1),'Momentum / fuerza tendencia'),
  profileKpi('EMA20 / EMA50',PR(s.ema20)+' / '+PR(s.ema50),'Estructura técnica'),
  profileKpi('1 semana',PC(s.perfWeek),'Rendimiento'),
  profileKpi('1 mes',PC(s.perfMonth),'Rendimiento'),
  profileKpi('Próximos resultados',s.earningsDate?DF(s.earningsDate):'—',s.earningsDate?(eventTime({date:s.earningsDate,timeCode:s.earningsTimeCode})||''):'')
 ].join('');
 let upHtml=upcoming.length?upcoming.map(eventItem).join(''):'<div class="profile-empty">No hay eventos futuros fechados cargados para este valor.</div>';
 let newsHtml=news.length?news.map(eventItem).join(''):'<div class="profile-empty">No hay noticias recientes cargadas para este valor.</div>';
 let updated=db.meta.updatedAt?new Date(db.meta.updatedAt).toLocaleString('es-ES'):'—';
 return '<div class="profile-toolbar"><button type="button" class="btn ghost profile-back" data-profile-back="'+E(view)+'">← Volver al catálogo</button><span>Datos actualizados '+E(updated)+'</span></div>'+
  '<div class="profile-hero"><div class="profile-title">'+favButton(s)+'<div><div class="profile-market">'+E(marketTitle)+'</div><h2>'+E(title)+'</h2><p>'+E(s.name||'')+'</p></div></div><div class="profile-live"><small>'+E(SN(se))+' · EEUU</small><strong>'+PR(SP(s,se))+'</strong><span class="'+C(SC(s,se))+'">'+PC(SC(s,se))+'</span></div></div>'+
  trRelation+trNote+context+
  '<section class="profile-section"><h3>Identificación y mercados</h3><div class="profile-identity-grid">'+identity+'</div></section>'+
  '<section class="profile-section"><h3>Mercado y técnicos</h3><div class="profile-kpi-grid">'+kpis+'</div></section>'+
  '<section class="profile-section profile-chart-section"><div class="profile-section-head"><h3>Gráfico</h3><span>Velas 1 minuto · horario extendido EEUU</span></div>'+miniChart(s)+'</section>'+
  '<div class="profile-widget-grid"><section class="profile-section"><div class="profile-section-head"><h3>Empresa</h3><span>Perfil y sector</span></div>'+profileWidget('company',s)+'</section><section class="profile-section"><div class="profile-section-head"><h3>Fundamentales</h3><span>Datos financieros</span></div>'+profileWidget('fundamentals',s)+'</section></div>'+
  '<section class="profile-section"><div class="profile-section-head"><h3>Noticias en directo</h3><span>Feed del símbolo</span></div>'+profileWidget('news',s)+'</section>'+
  '<section class="profile-section"><div class="profile-section-head"><h3>Próximos eventos</h3><span>'+upcoming.length+' cargados</span></div><div class="event-list profile-events">'+upHtml+'</div></section>'+
  '<section class="profile-section"><div class="profile-section-head"><h3>Noticias y catalizadores</h3><span>'+news.length+' recientes</span></div><div class="event-list profile-events">'+newsHtml+'</div></section>'+
  '<section class="profile-section"><h3>Fuentes externas</h3>'+links(s)+'</section>';
}
function renderProfileView(view){
 let isTr=view==='catalog';
 let detail=$(isTr?'#catalogDetail':'#catalogUSDetail');
 let browse=$(isTr?'#catalogBrowse':'#catalogUSBrowse');
 if(!detail||!browse)return false;
 let s=state.profileKey?stockByKey(state.profileKey):null;
 let valid=s&&(isTr?!!s.tradeRepublicVerified:market(s,'us'));
 if(!valid){
  detail.classList.add('is-hidden');
  browse.classList.remove('is-hidden');
  return false;
 }
 browse.classList.add('is-hidden');
 detail.classList.remove('is-hidden');
 detail.innerHTML=profileHtml(s,view);
 requestAnimationFrame(()=>{
  detail.querySelectorAll('.mini-chart').forEach(loadMiniChart);
  detail.querySelectorAll('.profile-tv-widget').forEach(loadProfileWidget);
 });
 return true;
}
function renderCatalog(){
 if(renderProfileView('catalog'))return;
 let q=$('#catalogSearch').value.trim().toLowerCase();
 let all=db.stocks.filter(s=>s.tradeRepublicVerified);
 let rows=all.filter(s=>!q||((s.trTicker||'')+' '+s.ticker+' '+s.name+' '+(s.isin||'')+' '+(s.trNameAtExchange||'')).toLowerCase().includes(q)).sort((x,y)=>String(x.trTicker||x.ticker).localeCompare(String(y.trTicker||y.ticker)));
 $('#catalogCount').textContent=rows.length.toLocaleString('es-ES')+' cotizando · '+Number(db.meta.trTickerCount||0).toLocaleString('es-ES')+' ticker LSX resueltos · '+Number(db.meta.trOfficialCount||0).toLocaleString('es-ES')+' universo oficial';
 $('#catalogResults').innerHTML=rows.length?rows.slice(0,800).map((s,i)=>catalogCard(s,i,'tr')).join(''):'<div class="empty-state">No hay coincidencias verificadas cargadas.</div>';
}
function renderCatalogUS(){
 if(renderProfileView('catalogUS'))return;
 let q=$('#catalogUSSearch').value.trim().toLowerCase();
 let all=db.stocks.filter(s=>market(s,'us'));
 let rows=all.filter(s=>!q||(s.ticker+' '+s.name+' '+(s.isin||'')+' '+(s.trTicker||'')).toLowerCase().includes(q)).sort((x,y)=>String(x.ticker).localeCompare(String(y.ticker)));
 $('#catalogUSCount').textContent=rows.length.toLocaleString('es-ES')+' valores EEUU';
 $('#catalogUSResults').innerHTML=rows.length?rows.slice(0,1000).map((s,i)=>catalogCard(s,i,'us')).join(''):'<div class="empty-state">No hay coincidencias en el catálogo EEUU.</div>';
}
function renderFuture(){
 let h=+$('#futureHorizon').value,t=$('#futureType').value,tr=$('#futureTrOnly').checked,now=Date.now();
 let filtered=(db.events||[]).filter(e=>futureWindowEvent(e,h,now)&&(t==='all'||e.type===t)&&(!tr||e.tradeRepublicVerified));
 let groups=groupFutureEvents(filtered);
 $('#futureResults').innerHTML=groups.length?groups.slice(0,180).map((g,i)=>{
  let e=g.first,s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  let count=g.items.length,label=count===1?EL(e):(count+' catalizadores'),when=eventWhen(e);
  return '<article class="stock-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,tr&&!!s.tradeRepublicVerified)+'</div><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+E(when)+'</b><span class="event-type">'+E(label)+'</span>'+(e.tradeRepublicVerified?'<span class="pill ok">TR</span>':'')+'<span class="open-arrow">→</span></div></div></article>';
 }).join(''):'<div class="empty-state">No hay catalizadores desde ahora hasta '+h+' día'+(h===1?'':'s')+' vista con estos filtros.</div>';
}
function renderRadar(){let q=$('#radarSearch').value.trim().toLowerCase(),rs=state.radarSession,se=rs==='all'?SES():rs,a=db.stocks.filter(s=>state.radarMarket==='all'||market(s,state.radarMarket)).filter(s=>!q||(s.ticker+' '+s.name+' '+(s.isin||'')).toLowerCase().includes(q));if(rs!=='all')a=a.filter(s=>SC(s,rs)!==null);if(state.radarDirection==='up')a=a.filter(s=>(SC(s,se)??0)>0);if(state.radarDirection==='down')a=a.filter(s=>(SC(s,se)??0)<0);a.sort((x,y)=>(SC(y,se)??-999)-(SC(x,se)??-999));let shown=a.slice(0,300);$('#radarResults').innerHTML=shown.length?shown.map((s,i)=>{let next=shown[i+1],txt='Radar ordenado por variación en '+SN(se)+': '+PC(SC(s,se))+(next?' frente a '+PC(SC(next,se))+' de #'+(i+2)+' '+E(next.ticker)+'.':'.');return card(s,i,se,true,txt,state.radarMarket==='tr')}).join(''):'<div class="empty-state">Sin valores con estos filtros.</div>'}
function renderCalendar(){
 let rows=[...(db.events||[])].sort((x,y)=>new Date(y.date)-new Date(x.date));
 $('#calendarResults').innerHTML=rows.length?rows.slice(0,400).map((e,i)=>{
  let s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  return '<article class="stock-card dense-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><strong>'+E(e.ticker)+'</strong><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+DF(e.date)+'</b><span class="event-type">'+E(EL(e))+'</span><span class="open-arrow">→</span></div></div></article>';
 }).join(''):'<div class="empty-state">Sin eventos o noticias disponibles.</div>';
}

function status(){}
function render(){renderMarketLeaders();renderFavorites();renderEntry();renderFuture();renderRadar();renderCalendar();renderCatalog();renderCatalogUS();status()}
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
  db={stocks:j.stocks,events:Array.isArray(j.events)?j.events:[],meta:j.meta||{}};
  render();
 }catch(e){
  console.error(e);
  if(!db.stocks.length)document.querySelectorAll('.stock-list').forEach(x=>x.innerHTML='<div class="empty-state">No se pudieron cargar los datos de mercado. Reintenta en unos instantes.</div>')
 }finally{
  loading=false
 }
}
function show(v,preserveProfile=false){if(!V[v])return;if(!preserveProfile){state.profileKey=null;state.profileReason='';}document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));$('#view-'+v).classList.add('active');document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));$('#sidebar').classList.remove('open');render()}
let lastLeaderSession=null;
function clock(){
 let now=new Date();
 document.querySelectorAll('.market-clock').forEach(x=>{
  let tz=x.dataset.tz,time=x.querySelector('time');
  if(!time||!tz)return;
  time.textContent=new Intl.DateTimeFormat('es-ES',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
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
$$('[data-tab-group="radarMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{state.radarMarket=b.dataset.tab;$$('[data-tab-group="radarMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));renderRadar()}));
['futureHorizon','futureType','futureTrOnly'].forEach(id=>$('#'+id).addEventListener('change',renderFuture));$('#radarSearch').addEventListener('input',renderRadar);
$('#radarSession').addEventListener('change',e=>{state.radarSession=e.target.value;renderRadar()});$('#radarDirection').addEventListener('change',e=>{state.radarDirection=e.target.value;renderRadar()});$('#catalogSearch').addEventListener('input',renderCatalog);$('#catalogUSSearch').addEventListener('input',renderCatalogUS);
['refreshEntry','refreshFuture','refreshRadar'].forEach(id=>$('#'+id).addEventListener('click',()=>load(true)));
toUI(state.filters);lockAllCriteria();initLeadersDock();clock();setInterval(clock,30000);setInterval(()=>load(false),1000);load(true););
 let secondary=preferTr?money(x.usd,'
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
 show(s.tradeRepublicVerified?'catalog':'catalogUS',true);
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
 return '<div class="leader-item stock-open-row"'+stockOpenAttrs(s)+' title="#'+(i+1)+' · '+E(s.name||s.ticker)+'"><div class="leader-top"><div class="leader-symbol">'+favButton(s)+'<div class="ticker-stack">'+tickerDisplay(s,preferTr)+'</div></div><span class="'+C(ch)+'">'+PC(ch)+'</span></div><div class="leader-body"><div class="leader-price">'+PR(p)+'</div><div class="leader-volume" title="Volumen actual / volumen medio diario">Vol '+compactVol(vol)+' / '+compactVol(avg)+'</div></div></div>';
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
  return '<div class="favorite-row stock-open-row"'+stockOpenAttrs(s)+'><button type="button" class="fav-star active mini" data-fav-key="'+E(key)+'" title="Quitar de favoritos" aria-label="Quitar de favoritos">★</button><div class="favorite-link" title="'+E(s.name||s.ticker)+'"><div class="favorite-main"><div class="ticker-stack">'+tickerDisplay(s,!!s.tradeRepublicVerified)+'</div><span>'+PR(p)+'</span></div><div class="favorite-stats"><span class="'+C(ch)+'">'+PC(ch)+'</span><small>Vol '+compactVol(v)+' / '+compactVol(avg)+'</small></div></div></div>';
 }).join('');
}
function links(s){let t=encodeURIComponent(String(s.ticker||'').toUpperCase()),tv=encodeURIComponent(String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+(s.ticker||''))).replace(':','-'));return '<div class="external-links"><a target="_blank" rel="noopener" href="https://www.tradingview.com/symbols/'+tv+'/">TradingView ↗</a><a target="_blank" rel="noopener" href="https://www.investing.com/search/?q='+t+'">Investing.com ↗</a><a target="_blank" rel="noopener" href="https://stockmarketwatch.com/stock/'+t+'">StockMarketWatch ↗</a><a target="_blank" rel="noopener" href="https://stocktwits.com/symbol/'+t+'">StockTwits ↗</a></div>'}
function miniChart(s){
 let symbol=String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+(s.ticker||'')));
 return '<div class="mini-chart-block"><div class="mini-chart-title">Velas 1 min · volumen · horario extendido 04:00–20:00 NY</div><div class="mini-chart" data-symbol="'+E(symbol)+'"><div class="chart-placeholder">Cargando gráfico…</div></div></div>';
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
  hide_side_toolbar:true,hide_top_toolbar:true,hide_legend:false,hide_volume:false,
  allow_symbol_change:false,save_image:false,withdateranges:false,
  extended_hours:true,session:'extended',details:false,hotlist:false,calendar:false,
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
 return '<article class="stock-card '+(dense?'dense-card':'')+'"><div class="stock-main stock-open-row"'+stockOpenAttrs(s,hint)+' title="'+E(hint)+'"><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,preferTr)+'</div><span>'+E(s.name||'')+'</span></div></div><div class="stock-quick"><b>'+PR(p)+'</b><span class="'+C(ch)+'">'+PC(ch)+'</span>'+(s.tradeRepublicVerified?'<span class="pill ok">TR</span>':'')+'<span class="open-arrow">→</span></div></div></article>';
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

function catalogCard(s,i,mode){
 let se=currentMarketSession(),p=SP(s,se),ch=SC(s,se);
 let primary=mode==='tr'?(s.trTicker||'—'):s.ticker;
 let secondary=mode==='tr'
  ?(s.name+' · EEUU '+(s.exchange||'')+':'+(s.ticker||''))
  :(s.name+(s.tradeRepublicVerified?' · TR '+(s.trTicker||'ticker LSX pendiente'):''));
 let badge=mode==='tr'
  ?'<span class="pill ok">'+E(s.trExchange||'LSX')+'</span>'+(s.instrumentLinkStatus==='same_isin'?'<span class="pill isin-ok">ISIN ✓</span>':s.instrumentLinkStatus==='unverified'?'<span class="pill isin-pending">ISIN ?</span>':'')
  :(s.tradeRepublicVerified?'<span class="pill ok">TR</span>':'');
 let pending=mode==='tr'&&!s.trTicker?'<span class="catalog-pending">ticker LSX pendiente</span>':'';
 return '<article class="stock-card dense-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><strong>'+E(primary)+'</strong><span>'+E(secondary)+'</span></div></div><div class="stock-quick">'+pending+'<small class="catalog-price-source">EEUU</small><b>'+PR(p)+'</b><span class="'+C(ch)+'">'+PC(ch)+'</span>'+badge+'<span class="open-arrow">→</span></div></div></article>';
}
function stockEvents(s){
 return (db.events||[]).filter(e=>{
  if(s.isin&&e.isin&&String(e.isin)===String(s.isin))return true;
  return e.ticker===s.ticker&&(!e.exchange||String(e.exchange)===String(s.exchange));
 });
}
function profileKpi(label,main,sub=''){
 return '<div class="profile-kpi"><small>'+E(label)+'</small><strong>'+main+'</strong>'+(sub?'<span>'+sub+'</span>':'')+'</div>';
}
function profileIdentity(label,value,extra=''){
 return '<div class="profile-identity"><small>'+E(label)+'</small><strong>'+E(value||'—')+'</strong>'+(extra?'<span>'+E(extra)+'</span>':'')+'</div>';
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
  ?'<div class="profile-relation"><span>Instrumento TR</span><strong>'+(s.trTicker?E((s.trExchange||'LSX')+':'+s.trTicker):'Ticker LSX aún no resuelto')+'</strong><span class="relation-arrow">↔</span><span>Cotización EEUU</span><strong>'+E(relatedUs)+'</strong>'+relationBadge+'</div>'
  :(s.tradeRepublicCandidate?'<div class="profile-relation"><span>Cotización EEUU</span><strong>'+E(relatedUs)+'</strong><span class="relation-arrow">↔</span><span>Trade Republic</span><strong>'+E((s.trExchange||'LSX')+':'+(s.trTicker||'pendiente'))+'</strong>'+relationBadge+'</div>':'');
 let trNote=isTr?'<div class="profile-data-note">El ticker principal de esta ficha es el utilizado por Trade Republic/LSX. Los precios, técnicos, premarket y postmarket que se muestran debajo proceden de la cotización estadounidense relacionada '+E(relatedUs)+'.</div>':'';
 let context=state.profileReason?'<div class="profile-context"><strong>Por qué llegaste aquí:</strong> '+E(state.profileReason)+'</div>':'';
 let linkStatus=s.instrumentLinkStatus==='same_isin'
  ?'Misma acción · ISIN coincidente'
  :s.instrumentLinkStatus==='different_isin'
   ?'Instrumento distinto · ISIN diferente'
   :'Relación pendiente de verificar por ISIN';
 let identity=[
  profileIdentity('Ticker Trade Republic / LSX',s.trTicker||'Pendiente',s.trExchange||'LSX'),
  profileIdentity('Ticker EEUU',s.ticker||'—',s.exchange||''),
  profileIdentity('ISIN Trade Republic',s.trIsin||'—'),
  profileIdentity('ISIN cotización EEUU',s.usIsin||s.isin||'—'),
  profileIdentity('Relación entre mercados',linkStatus),
  profileIdentity('WKN',s.trWkn||'—'),
  profileIdentity('Nombre en TR / LSX',s.trNameAtExchange||s.name||'—'),
  profileIdentity('Divisa EEUU',s.currency||'USD')
 ].join('');
 let kpis=[
  profileKpi('Regular',PR(s.price),'<span class="'+C(s.changePct)+'">'+PC(s.changePct)+'</span> · Vol '+compactVol(s.volume)),
  profileKpi('Premarket',PR(s.premarketPrice),'<span class="'+C(s.premarketChangePct)+'">'+PC(s.premarketChangePct)+'</span> · Vol '+compactVol(s.premarketVolume)),
  profileKpi('Postmarket',PR(s.postmarketPrice),'<span class="'+C(s.postmarketChangePct)+'">'+PC(s.postmarketChangePct)+'</span> · Vol '+compactVol(s.postmarketVolume)),
  profileKpi('Volumen medio',compactVol(s.avgVolume),N(s.relVolume)!==null?F(s.relVolume,2)+'× relativo':'—'),
  profileKpi('RSI / ADX',F(s.rsi,1)+' / '+F(s.adx,1),'Momentum / fuerza tendencia'),
  profileKpi('EMA20 / EMA50',PR(s.ema20)+' / '+PR(s.ema50),'Estructura técnica'),
  profileKpi('1 semana',PC(s.perfWeek),'Rendimiento'),
  profileKpi('1 mes',PC(s.perfMonth),'Rendimiento'),
  profileKpi('Próximos resultados',s.earningsDate?DF(s.earningsDate):'—',s.earningsDate?(eventTime({date:s.earningsDate,timeCode:s.earningsTimeCode})||''):'')
 ].join('');
 let upHtml=upcoming.length?upcoming.map(eventItem).join(''):'<div class="profile-empty">No hay eventos futuros fechados cargados para este valor.</div>';
 let newsHtml=news.length?news.map(eventItem).join(''):'<div class="profile-empty">No hay noticias recientes cargadas para este valor.</div>';
 let updated=db.meta.updatedAt?new Date(db.meta.updatedAt).toLocaleString('es-ES'):'—';
 return '<div class="profile-toolbar"><button type="button" class="btn ghost profile-back" data-profile-back="'+E(view)+'">← Volver al catálogo</button><span>Datos actualizados '+E(updated)+'</span></div>'+
  '<div class="profile-hero"><div class="profile-title">'+favButton(s)+'<div><div class="profile-market">'+E(marketTitle)+'</div><h2>'+E(title)+'</h2><p>'+E(s.name||'')+'</p></div></div><div class="profile-live"><small>'+E(SN(se))+' · EEUU</small><strong>'+PR(SP(s,se))+'</strong><span class="'+C(SC(s,se))+'">'+PC(SC(s,se))+'</span></div></div>'+
  trRelation+trNote+context+
  '<section class="profile-section"><h3>Identificación y mercados</h3><div class="profile-identity-grid">'+identity+'</div></section>'+
  '<section class="profile-section"><h3>Mercado y técnicos</h3><div class="profile-kpi-grid">'+kpis+'</div></section>'+
  '<section class="profile-section profile-chart-section"><div class="profile-section-head"><h3>Gráfico</h3><span>Velas 1 minuto · horario extendido EEUU</span></div>'+miniChart(s)+'</section>'+
  '<div class="profile-widget-grid"><section class="profile-section"><div class="profile-section-head"><h3>Empresa</h3><span>Perfil y sector</span></div>'+profileWidget('company',s)+'</section><section class="profile-section"><div class="profile-section-head"><h3>Fundamentales</h3><span>Datos financieros</span></div>'+profileWidget('fundamentals',s)+'</section></div>'+
  '<section class="profile-section"><div class="profile-section-head"><h3>Noticias en directo</h3><span>Feed del símbolo</span></div>'+profileWidget('news',s)+'</section>'+
  '<section class="profile-section"><div class="profile-section-head"><h3>Próximos eventos</h3><span>'+upcoming.length+' cargados</span></div><div class="event-list profile-events">'+upHtml+'</div></section>'+
  '<section class="profile-section"><div class="profile-section-head"><h3>Noticias y catalizadores</h3><span>'+news.length+' recientes</span></div><div class="event-list profile-events">'+newsHtml+'</div></section>'+
  '<section class="profile-section"><h3>Fuentes externas</h3>'+links(s)+'</section>';
}
function renderProfileView(view){
 let isTr=view==='catalog';
 let detail=$(isTr?'#catalogDetail':'#catalogUSDetail');
 let browse=$(isTr?'#catalogBrowse':'#catalogUSBrowse');
 if(!detail||!browse)return false;
 let s=state.profileKey?stockByKey(state.profileKey):null;
 let valid=s&&(isTr?!!s.tradeRepublicVerified:market(s,'us'));
 if(!valid){
  detail.classList.add('is-hidden');
  browse.classList.remove('is-hidden');
  return false;
 }
 browse.classList.add('is-hidden');
 detail.classList.remove('is-hidden');
 detail.innerHTML=profileHtml(s,view);
 requestAnimationFrame(()=>{
  detail.querySelectorAll('.mini-chart').forEach(loadMiniChart);
  detail.querySelectorAll('.profile-tv-widget').forEach(loadProfileWidget);
 });
 return true;
}
function renderCatalog(){
 if(renderProfileView('catalog'))return;
 let q=$('#catalogSearch').value.trim().toLowerCase();
 let all=db.stocks.filter(s=>s.tradeRepublicVerified);
 let rows=all.filter(s=>!q||((s.trTicker||'')+' '+s.ticker+' '+s.name+' '+(s.isin||'')+' '+(s.trNameAtExchange||'')).toLowerCase().includes(q)).sort((x,y)=>String(x.trTicker||x.ticker).localeCompare(String(y.trTicker||y.ticker)));
 $('#catalogCount').textContent=rows.length.toLocaleString('es-ES')+' cotizando · '+Number(db.meta.trTickerCount||0).toLocaleString('es-ES')+' ticker LSX resueltos · '+Number(db.meta.trOfficialCount||0).toLocaleString('es-ES')+' universo oficial';
 $('#catalogResults').innerHTML=rows.length?rows.slice(0,800).map((s,i)=>catalogCard(s,i,'tr')).join(''):'<div class="empty-state">No hay coincidencias verificadas cargadas.</div>';
}
function renderCatalogUS(){
 if(renderProfileView('catalogUS'))return;
 let q=$('#catalogUSSearch').value.trim().toLowerCase();
 let all=db.stocks.filter(s=>market(s,'us'));
 let rows=all.filter(s=>!q||(s.ticker+' '+s.name+' '+(s.isin||'')+' '+(s.trTicker||'')).toLowerCase().includes(q)).sort((x,y)=>String(x.ticker).localeCompare(String(y.ticker)));
 $('#catalogUSCount').textContent=rows.length.toLocaleString('es-ES')+' valores EEUU';
 $('#catalogUSResults').innerHTML=rows.length?rows.slice(0,1000).map((s,i)=>catalogCard(s,i,'us')).join(''):'<div class="empty-state">No hay coincidencias en el catálogo EEUU.</div>';
}
function renderFuture(){
 let h=+$('#futureHorizon').value,t=$('#futureType').value,tr=$('#futureTrOnly').checked,now=Date.now();
 let filtered=(db.events||[]).filter(e=>futureWindowEvent(e,h,now)&&(t==='all'||e.type===t)&&(!tr||e.tradeRepublicVerified));
 let groups=groupFutureEvents(filtered);
 $('#futureResults').innerHTML=groups.length?groups.slice(0,180).map((g,i)=>{
  let e=g.first,s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  let count=g.items.length,label=count===1?EL(e):(count+' catalizadores'),when=eventWhen(e);
  return '<article class="stock-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,tr&&!!s.tradeRepublicVerified)+'</div><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+E(when)+'</b><span class="event-type">'+E(label)+'</span>'+(e.tradeRepublicVerified?'<span class="pill ok">TR</span>':'')+'<span class="open-arrow">→</span></div></div></article>';
 }).join(''):'<div class="empty-state">No hay catalizadores desde ahora hasta '+h+' día'+(h===1?'':'s')+' vista con estos filtros.</div>';
}
function renderRadar(){let q=$('#radarSearch').value.trim().toLowerCase(),rs=state.radarSession,se=rs==='all'?SES():rs,a=db.stocks.filter(s=>state.radarMarket==='all'||market(s,state.radarMarket)).filter(s=>!q||(s.ticker+' '+s.name+' '+(s.isin||'')).toLowerCase().includes(q));if(rs!=='all')a=a.filter(s=>SC(s,rs)!==null);if(state.radarDirection==='up')a=a.filter(s=>(SC(s,se)??0)>0);if(state.radarDirection==='down')a=a.filter(s=>(SC(s,se)??0)<0);a.sort((x,y)=>(SC(y,se)??-999)-(SC(x,se)??-999));let shown=a.slice(0,300);$('#radarResults').innerHTML=shown.length?shown.map((s,i)=>{let next=shown[i+1],txt='Radar ordenado por variación en '+SN(se)+': '+PC(SC(s,se))+(next?' frente a '+PC(SC(next,se))+' de #'+(i+2)+' '+E(next.ticker)+'.':'.');return card(s,i,se,true,txt,state.radarMarket==='tr')}).join(''):'<div class="empty-state">Sin valores con estos filtros.</div>'}
function renderCalendar(){
 let rows=[...(db.events||[])].sort((x,y)=>new Date(y.date)-new Date(x.date));
 $('#calendarResults').innerHTML=rows.length?rows.slice(0,400).map((e,i)=>{
  let s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  return '<article class="stock-card dense-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><strong>'+E(e.ticker)+'</strong><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+DF(e.date)+'</b><span class="event-type">'+E(EL(e))+'</span><span class="open-arrow">→</span></div></div></article>';
 }).join(''):'<div class="empty-state">Sin eventos o noticias disponibles.</div>';
}

function status(){}
function render(){renderMarketLeaders();renderFavorites();renderEntry();renderFuture();renderRadar();renderCalendar();renderCatalog();renderCatalogUS();status()}
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
  db={stocks:j.stocks,events:Array.isArray(j.events)?j.events:[],meta:j.meta||{}};
  render();
 }catch(e){
  console.error(e);
  if(!db.stocks.length)document.querySelectorAll('.stock-list').forEach(x=>x.innerHTML='<div class="empty-state">No se pudieron cargar los datos de mercado. Reintenta en unos instantes.</div>')
 }finally{
  loading=false
 }
}
function show(v,preserveProfile=false){if(!V[v])return;if(!preserveProfile){state.profileKey=null;state.profileReason='';}document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));$('#view-'+v).classList.add('active');document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));$('#sidebar').classList.remove('open');render()}
let lastLeaderSession=null;
function clock(){
 let now=new Date();
 document.querySelectorAll('.market-clock').forEach(x=>{
  let tz=x.dataset.tz,time=x.querySelector('time');
  if(!time||!tz)return;
  time.textContent=new Intl.DateTimeFormat('es-ES',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
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
$$('[data-tab-group="radarMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{state.radarMarket=b.dataset.tab;$$('[data-tab-group="radarMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));renderRadar()}));
['futureHorizon','futureType','futureTrOnly'].forEach(id=>$('#'+id).addEventListener('change',renderFuture));$('#radarSearch').addEventListener('input',renderRadar);
$('#radarSession').addEventListener('change',e=>{state.radarSession=e.target.value;renderRadar()});$('#radarDirection').addEventListener('change',e=>{state.radarDirection=e.target.value;renderRadar()});$('#catalogSearch').addEventListener('input',renderCatalog);$('#catalogUSSearch').addEventListener('input',renderCatalogUS);
['refreshEntry','refreshFuture','refreshRadar'].forEach(id=>$('#'+id).addEventListener('click',()=>load(true)));
toUI(state.filters);lockAllCriteria();initLeadersDock();clock();setInterval(clock,30000);setInterval(()=>load(false),1000);load(true);):money(x.eur,'€');
 return primary+' / '+secondary;
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
 show(s.tradeRepublicVerified?'catalog':'catalogUS',true);
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
 return '<div class="leader-item stock-open-row"'+stockOpenAttrs(s)+' title="#'+(i+1)+' · '+E(s.name||s.ticker)+'"><div class="leader-top"><div class="leader-symbol">'+favButton(s)+'<div class="ticker-stack">'+tickerDisplay(s,preferTr)+'</div></div><span class="'+C(ch)+'">'+PC(ch)+'</span></div><div class="leader-body"><div class="leader-price">'+PR(p)+'</div><div class="leader-volume" title="Volumen actual / volumen medio diario">Vol '+compactVol(vol)+' / '+compactVol(avg)+'</div></div></div>';
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
  return '<div class="favorite-row stock-open-row"'+stockOpenAttrs(s)+'><button type="button" class="fav-star active mini" data-fav-key="'+E(key)+'" title="Quitar de favoritos" aria-label="Quitar de favoritos">★</button><div class="favorite-link" title="'+E(s.name||s.ticker)+'"><div class="favorite-main"><div class="ticker-stack">'+tickerDisplay(s,!!s.tradeRepublicVerified)+'</div><span>'+PR(p)+'</span></div><div class="favorite-stats"><span class="'+C(ch)+'">'+PC(ch)+'</span><small>Vol '+compactVol(v)+' / '+compactVol(avg)+'</small></div></div></div>';
 }).join('');
}
function links(s){let t=encodeURIComponent(String(s.ticker||'').toUpperCase()),tv=encodeURIComponent(String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+(s.ticker||''))).replace(':','-'));return '<div class="external-links"><a target="_blank" rel="noopener" href="https://www.tradingview.com/symbols/'+tv+'/">TradingView ↗</a><a target="_blank" rel="noopener" href="https://www.investing.com/search/?q='+t+'">Investing.com ↗</a><a target="_blank" rel="noopener" href="https://stockmarketwatch.com/stock/'+t+'">StockMarketWatch ↗</a><a target="_blank" rel="noopener" href="https://stocktwits.com/symbol/'+t+'">StockTwits ↗</a></div>'}
function miniChart(s){
 let symbol=String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+(s.ticker||'')));
 return '<div class="mini-chart-block"><div class="mini-chart-title">Velas 1 min · volumen · horario extendido 04:00–20:00 NY</div><div class="mini-chart" data-symbol="'+E(symbol)+'"><div class="chart-placeholder">Cargando gráfico…</div></div></div>';
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
  hide_side_toolbar:true,hide_top_toolbar:true,hide_legend:false,hide_volume:false,
  allow_symbol_change:false,save_image:false,withdateranges:false,
  extended_hours:true,session:'extended',details:false,hotlist:false,calendar:false,
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
 return '<article class="stock-card '+(dense?'dense-card':'')+'"><div class="stock-main stock-open-row"'+stockOpenAttrs(s,hint)+' title="'+E(hint)+'"><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,preferTr)+'</div><span>'+E(s.name||'')+'</span></div></div><div class="stock-quick"><b>'+PR(p)+'</b><span class="'+C(ch)+'">'+PC(ch)+'</span>'+(s.tradeRepublicVerified?'<span class="pill ok">TR</span>':'')+'<span class="open-arrow">→</span></div></div></article>';
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

function catalogCard(s,i,mode){
 let se=currentMarketSession(),p=SP(s,se),ch=SC(s,se);
 let primary=mode==='tr'?(s.trTicker||'—'):s.ticker;
 let secondary=mode==='tr'
  ?(s.name+' · EEUU '+(s.exchange||'')+':'+(s.ticker||''))
  :(s.name+(s.tradeRepublicVerified?' · TR '+(s.trTicker||'ticker LSX pendiente'):''));
 let badge=mode==='tr'
  ?'<span class="pill ok">'+E(s.trExchange||'LSX')+'</span>'+(s.instrumentLinkStatus==='same_isin'?'<span class="pill isin-ok">ISIN ✓</span>':s.instrumentLinkStatus==='unverified'?'<span class="pill isin-pending">ISIN ?</span>':'')
  :(s.tradeRepublicVerified?'<span class="pill ok">TR</span>':'');
 let pending=mode==='tr'&&!s.trTicker?'<span class="catalog-pending">ticker LSX pendiente</span>':'';
 return '<article class="stock-card dense-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><strong>'+E(primary)+'</strong><span>'+E(secondary)+'</span></div></div><div class="stock-quick">'+pending+'<small class="catalog-price-source">EEUU</small><b>'+PR(p)+'</b><span class="'+C(ch)+'">'+PC(ch)+'</span>'+badge+'<span class="open-arrow">→</span></div></div></article>';
}
function stockEvents(s){
 return (db.events||[]).filter(e=>{
  if(s.isin&&e.isin&&String(e.isin)===String(s.isin))return true;
  return e.ticker===s.ticker&&(!e.exchange||String(e.exchange)===String(s.exchange));
 });
}
function profileKpi(label,main,sub=''){
 return '<div class="profile-kpi"><small>'+E(label)+'</small><strong>'+main+'</strong>'+(sub?'<span>'+sub+'</span>':'')+'</div>';
}
function profileIdentity(label,value,extra=''){
 return '<div class="profile-identity"><small>'+E(label)+'</small><strong>'+E(value||'—')+'</strong>'+(extra?'<span>'+E(extra)+'</span>':'')+'</div>';
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
  ?'<div class="profile-relation"><span>Instrumento TR</span><strong>'+(s.trTicker?E((s.trExchange||'LSX')+':'+s.trTicker):'Ticker LSX aún no resuelto')+'</strong><span class="relation-arrow">↔</span><span>Cotización EEUU</span><strong>'+E(relatedUs)+'</strong>'+relationBadge+'</div>'
  :(s.tradeRepublicCandidate?'<div class="profile-relation"><span>Cotización EEUU</span><strong>'+E(relatedUs)+'</strong><span class="relation-arrow">↔</span><span>Trade Republic</span><strong>'+E((s.trExchange||'LSX')+':'+(s.trTicker||'pendiente'))+'</strong>'+relationBadge+'</div>':'');
 let trNote=isTr?'<div class="profile-data-note">El ticker principal de esta ficha es el utilizado por Trade Republic/LSX. Los precios, técnicos, premarket y postmarket que se muestran debajo proceden de la cotización estadounidense relacionada '+E(relatedUs)+'.</div>':'';
 let context=state.profileReason?'<div class="profile-context"><strong>Por qué llegaste aquí:</strong> '+E(state.profileReason)+'</div>':'';
 let linkStatus=s.instrumentLinkStatus==='same_isin'
  ?'Misma acción · ISIN coincidente'
  :s.instrumentLinkStatus==='different_isin'
   ?'Instrumento distinto · ISIN diferente'
   :'Relación pendiente de verificar por ISIN';
 let identity=[
  profileIdentity('Ticker Trade Republic / LSX',s.trTicker||'Pendiente',s.trExchange||'LSX'),
  profileIdentity('Ticker EEUU',s.ticker||'—',s.exchange||''),
  profileIdentity('ISIN Trade Republic',s.trIsin||'—'),
  profileIdentity('ISIN cotización EEUU',s.usIsin||s.isin||'—'),
  profileIdentity('Relación entre mercados',linkStatus),
  profileIdentity('WKN',s.trWkn||'—'),
  profileIdentity('Nombre en TR / LSX',s.trNameAtExchange||s.name||'—'),
  profileIdentity('Divisa EEUU',s.currency||'USD')
 ].join('');
 let kpis=[
  profileKpi('Regular',PR(s.price),'<span class="'+C(s.changePct)+'">'+PC(s.changePct)+'</span> · Vol '+compactVol(s.volume)),
  profileKpi('Premarket',PR(s.premarketPrice),'<span class="'+C(s.premarketChangePct)+'">'+PC(s.premarketChangePct)+'</span> · Vol '+compactVol(s.premarketVolume)),
  profileKpi('Postmarket',PR(s.postmarketPrice),'<span class="'+C(s.postmarketChangePct)+'">'+PC(s.postmarketChangePct)+'</span> · Vol '+compactVol(s.postmarketVolume)),
  profileKpi('Volumen medio',compactVol(s.avgVolume),N(s.relVolume)!==null?F(s.relVolume,2)+'× relativo':'—'),
  profileKpi('RSI / ADX',F(s.rsi,1)+' / '+F(s.adx,1),'Momentum / fuerza tendencia'),
  profileKpi('EMA20 / EMA50',PR(s.ema20)+' / '+PR(s.ema50),'Estructura técnica'),
  profileKpi('1 semana',PC(s.perfWeek),'Rendimiento'),
  profileKpi('1 mes',PC(s.perfMonth),'Rendimiento'),
  profileKpi('Próximos resultados',s.earningsDate?DF(s.earningsDate):'—',s.earningsDate?(eventTime({date:s.earningsDate,timeCode:s.earningsTimeCode})||''):'')
 ].join('');
 let upHtml=upcoming.length?upcoming.map(eventItem).join(''):'<div class="profile-empty">No hay eventos futuros fechados cargados para este valor.</div>';
 let newsHtml=news.length?news.map(eventItem).join(''):'<div class="profile-empty">No hay noticias recientes cargadas para este valor.</div>';
 let updated=db.meta.updatedAt?new Date(db.meta.updatedAt).toLocaleString('es-ES'):'—';
 return '<div class="profile-toolbar"><button type="button" class="btn ghost profile-back" data-profile-back="'+E(view)+'">← Volver al catálogo</button><span>Datos actualizados '+E(updated)+'</span></div>'+
  '<div class="profile-hero"><div class="profile-title">'+favButton(s)+'<div><div class="profile-market">'+E(marketTitle)+'</div><h2>'+E(title)+'</h2><p>'+E(s.name||'')+'</p></div></div><div class="profile-live"><small>'+E(SN(se))+' · EEUU</small><strong>'+PR(SP(s,se))+'</strong><span class="'+C(SC(s,se))+'">'+PC(SC(s,se))+'</span></div></div>'+
  trRelation+trNote+context+
  '<section class="profile-section"><h3>Identificación y mercados</h3><div class="profile-identity-grid">'+identity+'</div></section>'+
  '<section class="profile-section"><h3>Mercado y técnicos</h3><div class="profile-kpi-grid">'+kpis+'</div></section>'+
  '<section class="profile-section profile-chart-section"><div class="profile-section-head"><h3>Gráfico</h3><span>Velas 1 minuto · horario extendido EEUU</span></div>'+miniChart(s)+'</section>'+
  '<div class="profile-widget-grid"><section class="profile-section"><div class="profile-section-head"><h3>Empresa</h3><span>Perfil y sector</span></div>'+profileWidget('company',s)+'</section><section class="profile-section"><div class="profile-section-head"><h3>Fundamentales</h3><span>Datos financieros</span></div>'+profileWidget('fundamentals',s)+'</section></div>'+
  '<section class="profile-section"><div class="profile-section-head"><h3>Noticias en directo</h3><span>Feed del símbolo</span></div>'+profileWidget('news',s)+'</section>'+
  '<section class="profile-section"><div class="profile-section-head"><h3>Próximos eventos</h3><span>'+upcoming.length+' cargados</span></div><div class="event-list profile-events">'+upHtml+'</div></section>'+
  '<section class="profile-section"><div class="profile-section-head"><h3>Noticias y catalizadores</h3><span>'+news.length+' recientes</span></div><div class="event-list profile-events">'+newsHtml+'</div></section>'+
  '<section class="profile-section"><h3>Fuentes externas</h3>'+links(s)+'</section>';
}
function renderProfileView(view){
 let isTr=view==='catalog';
 let detail=$(isTr?'#catalogDetail':'#catalogUSDetail');
 let browse=$(isTr?'#catalogBrowse':'#catalogUSBrowse');
 if(!detail||!browse)return false;
 let s=state.profileKey?stockByKey(state.profileKey):null;
 let valid=s&&(isTr?!!s.tradeRepublicVerified:market(s,'us'));
 if(!valid){
  detail.classList.add('is-hidden');
  browse.classList.remove('is-hidden');
  return false;
 }
 browse.classList.add('is-hidden');
 detail.classList.remove('is-hidden');
 detail.innerHTML=profileHtml(s,view);
 requestAnimationFrame(()=>{
  detail.querySelectorAll('.mini-chart').forEach(loadMiniChart);
  detail.querySelectorAll('.profile-tv-widget').forEach(loadProfileWidget);
 });
 return true;
}
function renderCatalog(){
 if(renderProfileView('catalog'))return;
 let q=$('#catalogSearch').value.trim().toLowerCase();
 let all=db.stocks.filter(s=>s.tradeRepublicVerified);
 let rows=all.filter(s=>!q||((s.trTicker||'')+' '+s.ticker+' '+s.name+' '+(s.isin||'')+' '+(s.trNameAtExchange||'')).toLowerCase().includes(q)).sort((x,y)=>String(x.trTicker||x.ticker).localeCompare(String(y.trTicker||y.ticker)));
 $('#catalogCount').textContent=rows.length.toLocaleString('es-ES')+' cotizando · '+Number(db.meta.trTickerCount||0).toLocaleString('es-ES')+' ticker LSX resueltos · '+Number(db.meta.trOfficialCount||0).toLocaleString('es-ES')+' universo oficial';
 $('#catalogResults').innerHTML=rows.length?rows.slice(0,800).map((s,i)=>catalogCard(s,i,'tr')).join(''):'<div class="empty-state">No hay coincidencias verificadas cargadas.</div>';
}
function renderCatalogUS(){
 if(renderProfileView('catalogUS'))return;
 let q=$('#catalogUSSearch').value.trim().toLowerCase();
 let all=db.stocks.filter(s=>market(s,'us'));
 let rows=all.filter(s=>!q||(s.ticker+' '+s.name+' '+(s.isin||'')+' '+(s.trTicker||'')).toLowerCase().includes(q)).sort((x,y)=>String(x.ticker).localeCompare(String(y.ticker)));
 $('#catalogUSCount').textContent=rows.length.toLocaleString('es-ES')+' valores EEUU';
 $('#catalogUSResults').innerHTML=rows.length?rows.slice(0,1000).map((s,i)=>catalogCard(s,i,'us')).join(''):'<div class="empty-state">No hay coincidencias en el catálogo EEUU.</div>';
}
function renderFuture(){
 let h=+$('#futureHorizon').value,t=$('#futureType').value,tr=$('#futureTrOnly').checked,now=Date.now();
 let filtered=(db.events||[]).filter(e=>futureWindowEvent(e,h,now)&&(t==='all'||e.type===t)&&(!tr||e.tradeRepublicVerified));
 let groups=groupFutureEvents(filtered);
 $('#futureResults').innerHTML=groups.length?groups.slice(0,180).map((g,i)=>{
  let e=g.first,s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  let count=g.items.length,label=count===1?EL(e):(count+' catalizadores'),when=eventWhen(e);
  return '<article class="stock-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><div class="ticker-stack">'+tickerDisplay(s,tr&&!!s.tradeRepublicVerified)+'</div><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+E(when)+'</b><span class="event-type">'+E(label)+'</span>'+(e.tradeRepublicVerified?'<span class="pill ok">TR</span>':'')+'<span class="open-arrow">→</span></div></div></article>';
 }).join(''):'<div class="empty-state">No hay catalizadores desde ahora hasta '+h+' día'+(h===1?'':'s')+' vista con estos filtros.</div>';
}
function renderRadar(){let q=$('#radarSearch').value.trim().toLowerCase(),rs=state.radarSession,se=rs==='all'?SES():rs,a=db.stocks.filter(s=>state.radarMarket==='all'||market(s,state.radarMarket)).filter(s=>!q||(s.ticker+' '+s.name+' '+(s.isin||'')).toLowerCase().includes(q));if(rs!=='all')a=a.filter(s=>SC(s,rs)!==null);if(state.radarDirection==='up')a=a.filter(s=>(SC(s,se)??0)>0);if(state.radarDirection==='down')a=a.filter(s=>(SC(s,se)??0)<0);a.sort((x,y)=>(SC(y,se)??-999)-(SC(x,se)??-999));let shown=a.slice(0,300);$('#radarResults').innerHTML=shown.length?shown.map((s,i)=>{let next=shown[i+1],txt='Radar ordenado por variación en '+SN(se)+': '+PC(SC(s,se))+(next?' frente a '+PC(SC(next,se))+' de #'+(i+2)+' '+E(next.ticker)+'.':'.');return card(s,i,se,true,txt,state.radarMarket==='tr')}).join(''):'<div class="empty-state">Sin valores con estos filtros.</div>'}
function renderCalendar(){
 let rows=[...(db.events||[])].sort((x,y)=>new Date(y.date)-new Date(x.date));
 $('#calendarResults').innerHTML=rows.length?rows.slice(0,400).map((e,i)=>{
  let s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  return '<article class="stock-card dense-card"><div class="stock-main stock-open-row"'+stockOpenAttrs(s)+'><div class="stock-id"><span class="rank">'+(i+1)+'</span>'+favButton(s)+'<div><strong>'+E(e.ticker)+'</strong><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+DF(e.date)+'</b><span class="event-type">'+E(EL(e))+'</span><span class="open-arrow">→</span></div></div></article>';
 }).join(''):'<div class="empty-state">Sin eventos o noticias disponibles.</div>';
}

function status(){}
function render(){renderMarketLeaders();renderFavorites();renderEntry();renderFuture();renderRadar();renderCalendar();renderCatalog();renderCatalogUS();status()}
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
  db={stocks:j.stocks,events:Array.isArray(j.events)?j.events:[],meta:j.meta||{}};
  render();
 }catch(e){
  console.error(e);
  if(!db.stocks.length)document.querySelectorAll('.stock-list').forEach(x=>x.innerHTML='<div class="empty-state">No se pudieron cargar los datos de mercado. Reintenta en unos instantes.</div>')
 }finally{
  loading=false
 }
}
function show(v,preserveProfile=false){if(!V[v])return;if(!preserveProfile){state.profileKey=null;state.profileReason='';}document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));$('#view-'+v).classList.add('active');document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));$('#sidebar').classList.remove('open');render()}
let lastLeaderSession=null;
function clock(){
 let now=new Date();
 document.querySelectorAll('.market-clock').forEach(x=>{
  let tz=x.dataset.tz,time=x.querySelector('time');
  if(!time||!tz)return;
  time.textContent=new Intl.DateTimeFormat('es-ES',{timeZone:tz,hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
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
$$('[data-tab-group="radarMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{state.radarMarket=b.dataset.tab;$$('[data-tab-group="radarMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));renderRadar()}));
['futureHorizon','futureType','futureTrOnly'].forEach(id=>$('#'+id).addEventListener('change',renderFuture));$('#radarSearch').addEventListener('input',renderRadar);
$('#radarSession').addEventListener('change',e=>{state.radarSession=e.target.value;renderRadar()});$('#radarDirection').addEventListener('change',e=>{state.radarDirection=e.target.value;renderRadar()});$('#catalogSearch').addEventListener('input',renderCatalog);$('#catalogUSSearch').addEventListener('input',renderCatalogUS);
['refreshEntry','refreshFuture','refreshRadar'].forEach(id=>$('#'+id).addEventListener('click',()=>load(true)));
toUI(state.filters);lockAllCriteria();initLeadersDock();clock();setInterval(clock,30000);setInterval(()=>load(false),1000);load(true);