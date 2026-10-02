/*
 * ViewInvAI funds & ETFs
 * ---------------------
 * Shared web/Android catalogue for index funds and ETFs.
 * Products are identified by ISIN; platform availability must be source-verified.
 */
(function(root){
 'use strict';

 const DATA='data/funds.json';
 const PERIODS=[
  ['1M','perf1M'],['3M','perf3M'],['6M','perf6M'],['YTD','perfYtd'],
  ['1A','perf1Y'],['3A','perf3Y'],['5A','perf5Y'],['10A','perf10Y'],['Hist.','perfSinceInception']
 ];
 const MOBILE_GROUPS=[
  {key:'returns',label:'Rentabilidad',columns:[['perfYtd','YTD'],['perf1Y','1A'],['perf3Y','3A']]},
  {key:'general',label:'Tipo',columns:[['type','Tipo'],['currency','Divisa']]},
  {key:'costs',label:'Costes',columns:[['ter','TER'],['trackingDifference','Tracking']]},
  {key:'market',label:'Mercado',columns:[['region','Región'],['index','Índice']]},
  {key:'operations',label:'Operativa',columns:[['distribution','Clase'],['platform','Plataforma']]},
  {key:'ratios',label:'Ratios',columns:[['volatility3Y','Vol. 3A'],['sharpe3Y','Sharpe'],['maxDrawdown','Drawdown']]},
  {key:'other',label:'Otros',columns:[['assetsUnderManagement','Patrimonio'],['freshness','Actualización']]}
 ];
 const state={products:[],meta:{},loaded:false,loading:false,query:'',platform:'all',type:'all',provider:'all',region:'all',distribution:'all',maxTer:null,sort:'perf1Y',sortDir:'desc',selectedIsin:null,mobileGroup:'returns',columnOrder:null,columnWidths:null,columnFilters:{},limit:0,limitSignature:''};
 const FUND_FAVORITES_KEY='viewinvai:fundFavorites:v1';
 const favoriteIsins=new Set((()=>{try{const x=JSON.parse(localStorage.getItem(FUND_FAVORITES_KEY)||'[]');return Array.isArray(x)?x:[]}catch(_){return[]}})());
 function saveFundFavorites(){try{localStorage.setItem(FUND_FAVORITES_KEY,JSON.stringify([...favoriteIsins]))}catch(_){}}
 function fundFavoriteButton(p){const on=favoriteIsins.has(p.isin);return '<button type="button" class="fund-favorite-star '+(on?'active':'')+'" data-fund-favorite="'+esc(p.isin)+'" aria-label="'+(on?'Quitar de favoritos':'Añadir a favoritos')+'" title="'+(on?'Quitar de favoritos':'Añadir a favoritos')+'">'+(on?'★':'☆')+'</button>'}
 function toggleFundFavorite(isin){if(favoriteIsins.has(isin))favoriteIsins.delete(isin);else favoriteIsins.add(isin);saveFundFavorites();render();if(typeof renderFavoritesDashboard==='function')renderFavoritesDashboard();}
 const account={user:null,portfolios:[],positions:[],plans:[],selectedPortfolioId:null,loading:false};
 const PORTFOLIO_ASSET_UI_KEY='viewinvai:portfolioAssetMode:v1';
 function savedPortfolioAssetMode(){
  try{
   const mode=String(localStorage.getItem(PORTFOLIO_ASSET_UI_KEY)||'stocks');
   return mode==='funds'||mode==='goal'||mode==='favorites'?mode:'stocks';
  }catch(_){return 'stocks'}
 }
 function savePortfolioAssetMode(mode){
  try{localStorage.setItem(PORTFOLIO_ASSET_UI_KEY,mode)}catch(_){}
 }

 function q(s){return document.querySelector(s)}
 function setPortfolioAssetMode(mode,loadFunds=true){
  mode=mode==='funds'?'funds':mode==='goal'?'goal':mode==='favorites'?'favorites':'stocks';
  savePortfolioAssetMode(mode);
  const view=q('#view-portfolios'),stockPanel=q('#portfolioApp'),fundPanel=q('#fundPortfolioApp'),goalPanel=q('#portfolioGoalApp'),favPanel=q('#portfolioFavoritesApp');
  if(view)view.dataset.portfolioAssetMode=mode;
  document.querySelectorAll('[data-portfolio-asset]').forEach(b=>{
   const active=b.dataset.portfolioAsset===mode;
   b.classList.toggle('active',active);
   b.setAttribute('aria-selected',active?'true':'false');
   b.tabIndex=active?0:-1;
  });
  const show=(panel,active)=>{
   if(!panel)return;
   panel.classList.toggle('is-hidden',!active);
   panel.hidden=!active;
   panel.inert=!active;
   panel.setAttribute('aria-hidden',active?'false':'true');
   panel.style.setProperty('display',active?'block':'none','important');
  };
  show(stockPanel,mode==='stocks');
  show(fundPanel,mode==='funds');
  show(goalPanel,mode==='goal');
  show(favPanel,mode==='favorites');
  if(mode==='funds'){
   root.ViewInvAIPortfolios?.setGoalVisible?.(false);
   if(loadFunds)loadPortfolio(false);
  }else if(mode==='goal'){
   root.ViewInvAIPortfolios?.setGoalVisible?.(true);
  }else if(mode==='favorites'){
   root.ViewInvAIPortfolios?.setGoalVisible?.(false);
   if(typeof root.renderFavoritesDashboard==='function')root.renderFavoritesDashboard();
  }else{
   root.ViewInvAIPortfolios?.setGoalVisible?.(false);
   root.ViewInvAIPortfolios?.render?.();
  }
  return mode;
 }
 function nativeFundsView(){return document.documentElement.dataset.nativeApp==='1'}
 function compactFundsView(){return nativeFundsView()||!!(root.matchMedia&&root.matchMedia('(max-width:820px)').matches)}
 function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
 function num(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null}
 function pct(v){v=num(v);return v===null?'—':(v>=0?'+':'')+v.toLocaleString('es-ES',{maximumFractionDigits:2})+'%'}
 function money(v,c='EUR'){v=num(v);if(v===null)return'—';try{return v.toLocaleString('es-ES',{style:'currency',currency:c||'EUR',maximumFractionDigits:4})}catch(_){return v.toLocaleString('es-ES',{maximumFractionDigits:4})+' '+c}}
 function amount(v,c='EUR'){v=num(v);if(v===null)return'—';try{return v.toLocaleString('es-ES',{style:'currency',currency:c||'EUR',minimumFractionDigits:2,maximumFractionDigits:2})}catch(_){return v.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+c}}
 function dateText(v){if(!v)return'—';let d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleDateString('es-ES'):'—'}
 function safeHttpsUrl(v){
  try{const u=new URL(String(v||''),location.href);return u.protocol==='https:'?u.href:''}catch(_){return''}
 }
 function ageText(v){
  if(!v)return'Sin fecha';
  let t=new Date(v).getTime();if(!Number.isFinite(t))return'Sin fecha';
  let age=Math.max(0,Date.now()-t);
  if(age<86400000)return'Actualizado hoy';
  let d=Math.max(1,Math.floor(age/86400000));
  return'Actualizado hace '+d+' '+(d===1?'día':'días');
 }
 function exactAgeText(v){
  if(!v)return'Sin hora';
  let t=typeof v==='number'?v:new Date(v).getTime();if(!Number.isFinite(t))return'Sin hora';
  let age=Math.max(0,Date.now()-t);
  if(age<5000)return'ahora';
  if(age<60000)return'hace '+Math.max(1,Math.floor(age/1000))+' s';
  if(age<3600000)return'hace '+Math.max(1,Math.floor(age/60000))+' min';
  if(age<86400000)return'hace '+Math.max(1,Math.floor(age/3600000))+' h';
  return'hace '+Math.max(1,Math.floor(age/86400000))+' d';
 }
 const fundLive={ws:null,connected:false,connecting:false,seq:1,subByIsin:new Map(),isinBySub:new Map(),payloadBySub:new Map(),wanted:new Set(),quotes:new Map(),observer:null,retry:null};
 function fundWsUrl(){
  if(root.ViewInvAIRuntime&&typeof root.ViewInvAIRuntime.websocketUrl==='function')return root.ViewInvAIRuntime.websocketUrl('/api/tr-live');
  return (location.protocol==='https:'?'wss://':'ws://')+location.host+'/api/tr-live';
 }
 function deltaDecode(s){try{return decodeURIComponent(String(s||'').replace(/\+/g,' '))}catch(_){return String(s||'')}}
 function applyDelta(prev,delta){
  prev=String(prev||'');let cursor=0,out='';
  for(const chunk of String(delta||'').split('\t')){
   if(!chunk)continue;const op=chunk[0],arg=chunk.slice(1);
   if(op==='+')out+=deltaDecode(arg);
   else if(op==='='){const n=Number(arg);if(!Number.isFinite(n)||n<0)throw Error('delta');out+=prev.slice(cursor,cursor+n);cursor+=n}
   else if(op==='-'){const n=Number(arg);if(!Number.isFinite(n)||n<0)throw Error('delta');cursor+=n}
   else throw Error('delta');
  }
  return out;
 }
 function liveQuote(isin){return fundLive.quotes.get(String(isin||'').toUpperCase())||null}
 // ETF y ETC cotizan en LSX; los fondos de inversión de Trade Republic publican su valor liquidativo en «VST».
 function fundCurrentValue(p){const q=liveQuote(p.isin);return (p.type==='etf'||p.type==='fund')&&q&&num(q.price)!==null?num(q.price):num(p.nav)}
 function liveVenue(isin){const p=state.products.find(x=>x.isin===isin);return p&&p.type==='fund'?'VST':'LSX'}
 function fundFreshness(p){
  const q=liveQuote(p.isin);
  if(p.type==='etf'&&q&&num(q.price)!==null){
   return {kind:'live',label:'En directo · '+exactAgeText(q.receivedAt),title:'Trade Republic / LSX · '+new Date(q.receivedAt).toLocaleString('es-ES')};
  }
  const at=p.valueDate||p.sourceUpdatedAt;
  if(p.type==='fund')return {kind:'nav',label:'VL oficial · '+ageText(at),title:'Valor liquidativo oficial · '+dateText(p.valueDate)};
  return {kind:'snapshot',label:'Último dato · '+ageText(at),title:'Último dato disponible · '+dateText(p.valueDate)};
 }
 function fundFreshnessDotState(p){
  const x=fundFreshness(p);
  if(x.kind==='live')return'live';
  const at=p&&((p.valueDate)||(p.sourceUpdatedAt)),t=at?new Date(at).getTime():NaN;
  if(!Number.isFinite(t))return'stale';
  return Date.now()-t>96*60*60*1000?'stale':'delayed';
 }
 function fundFreshnessDotHtml(p){
  const x=fundFreshness(p),tone=fundFreshnessDotState(p);
  return '<span class="quote-freshness-dot '+tone+' fund-price-freshness" data-fund-freshness-dot-isin="'+esc(p.isin)+'" data-status-label="'+esc(x.label)+'" title="'+esc(x.title)+'" aria-label="'+esc(x.label)+'" tabindex="0"><i aria-hidden="true"></i></span>';
 }
 function freshnessTextHtml(p){
  const x=fundFreshness(p);
  return '<span class="fund-freshness fund-freshness-text '+esc(x.kind)+'" title="'+esc(x.title)+'">'+esc(x.label)+'</span>';
 }
 function freshnessHtml(p){
  const x=fundFreshness(p);
  return '<span class="fund-freshness '+esc(x.kind)+'" title="'+esc(x.title)+'"><i></i>'+esc(x.label)+'</span>';
 }
 function fundPriceInlineHtml(p,value=fundCurrentValue(p)){
  return '<span class="fund-price-inline" data-fund-current-value>'+fundFreshnessDotHtml(p)+'<span class="fund-current-price-text">'+money(value,p.currency)+'</span></span>';
 }
 function subscribeFund(isin){
  isin=String(isin||'').toUpperCase();if(!/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin))return;
  fundLive.wanted.add(isin);connectFundsLive();sendFundSubscriptions();
 }
 function sendFundSubscriptions(){
  if(!fundLive.connected||!fundLive.ws||fundLive.ws.readyState!==WebSocket.OPEN)return;
  for(const isin of fundLive.wanted){
   if(fundLive.subByIsin.has(isin))continue;
   const sub=String(fundLive.seq++);
   fundLive.subByIsin.set(isin,sub);fundLive.isinBySub.set(sub,isin);
   try{fundLive.ws.send('sub '+sub+' '+JSON.stringify({type:'ticker',id:isin+'.'+liveVenue(isin)}))}catch(_){}
  }
 }
 function connectFundsLive(){
  if(fundLive.connected||fundLive.connecting||typeof WebSocket==='undefined')return;
  fundLive.connecting=true;let ws;
  try{ws=new WebSocket(fundWsUrl())}catch(_){fundLive.connecting=false;return}
  fundLive.ws=ws;
  ws.onopen=()=>{try{ws.send('connect 30')}catch(_){}};
  ws.onmessage=e=>{
   const msg=String(e.data||'');
   if(msg.startsWith('connected')){fundLive.connected=true;fundLive.connecting=false;sendFundSubscriptions();return}
   const m=msg.match(/^(\d+)\s+([A-Z])(?:\s+([\s\S]+))?$/);if(!m)return;
   const sid=m[1],code=m[2],body=m[3]||'',isin=fundLive.isinBySub.get(sid);if(!isin)return;
   if(code==='C'||code==='E')return;
   try{
    let full=body;
    if(code==='A')fundLive.payloadBySub.set(sid,body);
    else if(code==='D'){full=applyDelta(fundLive.payloadBySub.get(sid)||'',body);fundLive.payloadBySub.set(sid,full)}
    else return;
    const payload=JSON.parse(full||'{}'),price=num(payload.last&&payload.last.price);
    if(price!==null){
     fundLive.quotes.set(isin,{price,bid:num(payload.bid&&payload.bid.price),ask:num(payload.ask&&payload.ask.price),prev:num(payload.pre&&payload.pre.price),receivedAt:Date.now()});
     refreshFundLiveDom(isin);
     root.dispatchEvent&&root.dispatchEvent(new CustomEvent('viewinvai:tr-isin-quote',{detail:{isin}}));
    }
   }catch(_){}
  };
  ws.onclose=()=>{fundLive.connected=false;fundLive.connecting=false;fundLive.ws=null;fundLive.subByIsin.clear();fundLive.isinBySub.clear();fundLive.payloadBySub.clear();clearTimeout(fundLive.retry);fundLive.retry=setTimeout(connectFundsLive,3000)};
  ws.onerror=()=>{};
 }
 function observeFundLive(rootNode=document){
  const nodes=rootNode.querySelectorAll('[data-fund-live-isin]');
  if(!('IntersectionObserver'in root)){nodes.forEach(n=>subscribeFund(n.dataset.fundLiveIsin));return}
  if(!fundLive.observer)fundLive.observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting)subscribeFund(entry.target.dataset.fundLiveIsin)}),{rootMargin:'250px 0px'});
  nodes.forEach(n=>fundLive.observer.observe(n));
 }
 function refreshFundLiveDom(isin=''){
  document.querySelectorAll('[data-fund-live-isin]').forEach(el=>{
   if(isin&&el.dataset.fundLiveIsin!==isin)return;
   const p=state.products.find(x=>x.isin===el.dataset.fundLiveIsin);if(!p)return;
   const value=el.querySelector('[data-fund-current-value] .fund-current-price-text');if(value)value.textContent=money(fundCurrentValue(p),p.currency);
   const dot=el.querySelector('[data-fund-freshness-dot-isin]');if(dot){const x=fundFreshness(p),tone=fundFreshnessDotState(p);dot.classList.remove('live','delayed','stale');dot.classList.add(tone);dot.dataset.statusLabel=x.label;dot.title=x.title;dot.setAttribute('aria-label',x.label)}
   const fresh=el.querySelector('.fund-freshness');if(fresh){const x=fundFreshness(p);fresh.className='fund-freshness fund-freshness-text '+x.kind;fresh.title=x.title;fresh.textContent=x.label}
  });
  renderPortfolio();
 }
 // Fondos que el catálogo público no lista (p. ej. fondos de inversión de Trade Republic) pero que
 // han aparecido en importaciones: se añaden con la plataforma donde se vieron.
 let learned=[];
 async function mergeLearned(force=false){
  try{
   const A=root.ViewInvAIAuth;if(!A||typeof A.getUser!=='function'||!A.getUser())return;
   if(force||!learned.length){const r=await A.apiFetch('/api/fund-catalog-extra');const d=await r.json().catch(()=>({}));if(!r.ok)return;learned=d.products||[]}
   let added=0;
   for(const x of learned){
    const isin=String(x.isin||'').toUpperCase();if(!isin)continue;
    const plat={tradeRepublic:Number(x.tr_seen)?'verified':'unknown',myInvestor:Number(x.mi_seen)?'verified':'unknown'};
    const have=state.products.find(p=>p.isin===isin);
    if(have){
     if(plat.tradeRepublic==='verified'&&!verified(have.platforms.tradeRepublic))have.platforms.tradeRepublic='verified';
     if(plat.myInvestor==='verified'&&!verified(have.platforms.myInvestor))have.platforms.myInvestor='verified';
     if(have.ter==null&&num(x.ter)!==null)have.ter=num(x.ter);
     if(have.nav==null&&num(x.nav)!==null){have.nav=num(x.nav);have.valueDate=x.nav_date||have.valueDate}
     if(have.perf1Y==null&&num(x.ret_1y)!==null)have.perf1Y=num(x.ret_1y);
     continue;
    }
    state.products.push(norm({isin,name:x.name||x.ms_name||isin,type:x.type||'fund',provider:x.provider||'',index:x.index_name||'',currency:x.currency||'EUR',
     ter:num(x.ter),perf1Y:num(x.ret_1y),nav:num(x.nav)??num(x.last_price),valueDate:x.nav_date||x.last_price_at||null,platforms:plat,learned:true,
     sources:[{label:'Visto en importaciones de '+[plat.tradeRepublic==='verified'?'Trade Republic':'',plat.myInvestor==='verified'?'MyInvestor':''].filter(Boolean).join(' y '),url:''}]}));
    added++;
   }
   if(added||force)render();
  }catch(_){}
 }
 root.addEventListener&&root.addEventListener('viewinvai:auth-changed',()=>{learned=[];if(state.loaded)mergeLearned(true)});
 // Fondos que no están en el catálogo: buscador del universo público de Morningstar España
 // (fondos registrados para la venta en España, entre ellos los de MyInvestor).
 const remote={q:'',rows:[],loading:false,error:'',timer:null,seq:0};
 function remoteSearch(){
  clearTimeout(remote.timer);
  const query=state.query.trim();
  if(query.length<3){remote.q='';remote.rows=[];remote.error='';remote.loading=false;return}
  remote.timer=setTimeout(async()=>{
   const seq=++remote.seq;remote.loading=true;remote.error='';render();
   try{
    const r=await fetch('/api/fund-search?q='+encodeURIComponent(query));
    const d=await r.json().catch(()=>({}));
    if(seq!==remote.seq)return;
    if(!r.ok)throw Error(d.error||'Buscador no disponible');
    remote.q=query;remote.rows=(d.results||[]).filter(x=>x&&x.isin);
   }catch(e){if(seq===remote.seq){remote.rows=[];remote.error=String(e.message||e)}}
   finally{if(seq===remote.seq){remote.loading=false;render()}}
  },450);
 }
 function adoptRemote(isin){
  const have=state.products.find(x=>x.isin===isin);if(have)return have;
  const x=remote.rows.find(r=>r.isin===isin);if(!x)return null;
  const p=norm({isin:x.isin,name:x.name,type:'fund',provider:x.provider||'',category:x.category||'',currency:'EUR',ter:num(x.ter),nav:num(x.nav),valueDate:x.navDate||null,
   perf1Y:num(x.perf1Y),perf3Y:num(x.perf3Y),perf5Y:num(x.perf5Y),platforms:{tradeRepublic:'unknown',myInvestor:'unknown'},remote:true,
   sources:[{label:'Morningstar · fondo registrado en España',url:'https://www.morningstar.es/'}]});
  state.products.push(p);return p;
 }
 function remoteFundsHtml(){
  if(state.query.trim().length<3)return'';
  if(remote.loading&&!remote.rows.length)return '<section class="fund-remote"><h3>Más fondos registrados en España</h3><div class="empty-state">Buscando en Morningstar…</div></section>';
  if(remote.error)return '<section class="fund-remote"><h3>Más fondos registrados en España</h3><div class="empty-state">'+esc(remote.error)+'</div></section>';
  const known=new Set(state.products.filter(p=>!p.remote).map(p=>p.isin)),rows=remote.rows.filter(r=>!known.has(r.isin));
  if(!rows.length)return'';
  return '<section class="fund-remote"><h3>Más fondos registrados en España · '+rows.length+'</h3><p class="fund-note">Universo de Morningstar España: incluye los fondos que vende MyInvestor. Comprueba en tu bróker que el fondo está disponible antes de invertir.</p>'+
   '<div class="fund-remote-list">'+rows.map(r=>'<article class="fund-remote-row"><div><strong>'+esc(r.name)+'</strong><small>'+esc([r.isin,r.provider,r.category].filter(Boolean).join(' · '))+'</small></div>'+
    '<span>TER <b>'+(num(r.ter)===null?'—':pct(num(r.ter)).replace('+',''))+'</b></span><span>1 año <b class="'+((num(r.perf1Y)||0)>=0?'positive':'negative')+'">'+pct(r.perf1Y)+'</b></span>'+
    '<div class="fund-remote-actions"><button type="button" class="btn small ghost" data-fund-detail="'+esc(r.isin)+'">Ficha</button><button type="button" class="btn small" data-fund-position="'+esc(r.isin)+'">＋ Cartera</button></div></article>').join('')+'</div></section>';
 }
 function norm(p){
  const platforms=p&&p.platforms&&typeof p.platforms==='object'?p.platforms:{};
  return Object.assign({
   isin:'',name:'',type:'fund',provider:'',index:'',category:'',region:'',currency:'EUR',
   distribution:'',ter:null,nav:null,valueDate:null,sourceUpdatedAt:null,
   perf1M:null,perf3M:null,perf6M:null,perfYtd:null,perf1Y:null,perf3Y:null,perf5Y:null,perf10Y:null,perfSinceInception:null,
   volatility3Y:null,maxDrawdown:null,sharpe3Y:null,trackingDifference:null,assetsUnderManagement:null,
   platforms:{tradeRepublic:'unknown',myInvestor:'unknown'},sources:[]
  },p,{platforms:Object.assign({tradeRepublic:'unknown',myInvestor:'unknown'},platforms)});
 }
 function verified(v){return v===true||v==='verified'||v==='yes'}
 function rejected(v){return v===false||v==='no'||v==='unavailable'}
 function platformLabel(p){
  let rows=[];
  const tr=p.platforms.tradeRepublic,mi=p.platforms.myInvestor;
  rows.push('<span class="fund-platform '+(verified(tr)?'ok':rejected(tr)?'no':'pending')+'">TR '+(verified(tr)?'✓':rejected(tr)?'—':'?')+'</span>');
  rows.push('<span class="fund-platform '+(verified(mi)?'ok':rejected(mi)?'no':'pending')+'">MyInvestor '+(verified(mi)?'✓':rejected(mi)?'—':'?')+'</span>');
  return rows.join('');
 }
 function matchesPlatform(p){
  if(state.platform==='all')return true;
  if(state.platform==='tr')return verified(p.platforms.tradeRepublic);
  if(state.platform==='mi')return verified(p.platforms.myInvestor);
  if(state.platform==='both')return verified(p.platforms.tradeRepublic)&&verified(p.platforms.myInvestor);
  return true;
 }
 function platformSortValue(p){
  const tr=verified(p.platforms.tradeRepublic),mi=verified(p.platforms.myInvestor);
  return tr&&mi?3:tr?2:mi?1:0;
 }
 function freshnessSortValue(p){
  const live=liveQuote(p.isin);
  if(p.type==='etf'&&live&&Number.isFinite(live.receivedAt))return live.receivedAt;
  const t=new Date(p.valueDate||p.sourceUpdatedAt||'').getTime();
  return Number.isFinite(t)?t:null;
 }
 function fundSortValue(p,key){
  if(key==='name')return String(p.name||p.isin||'');
  if(key==='platform')return platformSortValue(p);
  if(key==='current')return fundCurrentValue(p);
  if(key==='freshness')return freshnessSortValue(p);
  if(key==='index'||key==='provider'||key==='distribution'||key==='region'||key==='currency'||key==='category')return String(p[key]||'');
  if(key==='type')return String(p.type||'');
  return num(p[key]);
 }
 function compareFundRows(a,b){
  const av=fundSortValue(a,state.sort),bv=fundSortValue(b,state.sort);
  if(av===null||av===undefined||av==='')return(bv===null||bv===undefined||bv==='')?String(a.name).localeCompare(String(b.name),'es'):1;
  if(bv===null||bv===undefined||bv==='')return-1;
  let cmp=typeof av==='string'||typeof bv==='string'
   ?String(av).localeCompare(String(bv),'es',{sensitivity:'base'})
   :(av<bv?-1:av>bv?1:0);
  if(state.sortDir==='desc')cmp*=-1;
  return cmp||String(a.name).localeCompare(String(b.name),'es',{sensitivity:'base'});
 }
 function setFundSort(key,dir=null){
  if(state.sort===key&&!dir)state.sortDir=state.sortDir==='asc'?'desc':'asc';
  else{
   state.sort=key;
   state.sortDir=dir||(key==='name'||key==='index'||key==='provider'||key==='distribution'||key==='region'||key==='currency'||key==='type'?'asc':'desc');
  }
  const select=q('#fundSort');
  if(select){
   const map={ter:'terAsc',maxDrawdown:'drawdown'};
   const value=map[state.sort]||state.sort;
   if([...select.options].some(o=>o.value===value))select.value=value;
  }
  render();
 }
 function applyFundSortSelect(value){
  if(value==='terAsc'){state.sort='ter';state.sortDir='asc'}
  else if(value==='drawdown'){state.sort='maxDrawdown';state.sortDir='desc'}
  else{state.sort=value;state.sortDir='desc'}
  render();
 }
 function fundColumnRaw(p,key){
  if(key==='name')return [p.name,p.isin].filter(Boolean).join(' ');
  if(key==='platform')return [verified(p.platforms&&p.platforms.tradeRepublic)?'Trade Republic':'',verified(p.platforms&&p.platforms.myInvestor)?'MyInvestor':''].filter(Boolean).join(' ');
  if(key==='current')return fundCurrentValue(p);
  if(key==='freshness')return fundFreshness(p).label;
  if(key==='ter')return num(p.ter);
  if(key==='index')return p.index||p.category||'';
  if(key==='provider')return p.provider||'';
  if(key==='distribution')return p.distribution||'';
  if(key==='region')return p.region||'';
  return num(p[key])!==null?num(p[key]):p[key]||'';
 }
 function fundColumnType(key){
  if(['current','ter','perf1M','perf3M','perf6M','perfYtd','perf1Y','perf3Y','perf5Y','perf10Y','perfSinceInception'].includes(key))return'number';
  return'text';
 }
 function fundFilterNumber(raw){
  raw=String(raw||'').trim().toLowerCase().replace(/\s+/g,'');
  const m=raw.match(/^(-?\d+(?:[.,]\d+)?)([kmb])?%?$/i);if(!m)return null;
  let n=Number(m[1].replace(',','.'));if(!Number.isFinite(n))return null;
  if(m[2]==='k')n*=1e3;else if(m[2]==='m')n*=1e6;else if(m[2]==='b')n*=1e9;
  return n;
 }
 function fundColumnFilterMatch(value,filter,type){
  filter=String(filter||'').trim();if(!filter)return true;
  if(type==='number'){
   const n=num(value);if(n===null)return false;
   const range=filter.replace(/\s+/g,'').match(/^(.+?)\.\.(.+)$/);
   if(range){const a=fundFilterNumber(range[1]),b=fundFilterNumber(range[2]);if(a===null||b===null)return true;return n>=Math.min(a,b)&&n<=Math.max(a,b)}
   const m=filter.replace(/\s+/g,'').match(/^(>=|<=|>|<|=)?(.+)$/);if(!m)return true;
   const target=fundFilterNumber(m[2]);if(target===null)return true;const op=m[1]||'=';
   if(op==='>')return n>target;if(op==='<')return n<target;if(op==='>=')return n>=target;if(op==='<=')return n<=target;return Math.abs(n-target)<1e-9;
  }
  const hay=String(value??'').toLocaleLowerCase('es');
  const terms=filter.toLocaleLowerCase('es').split('|').map(x=>x.trim()).filter(Boolean);
  return !terms.length||terms.some(term=>hay.includes(term));
 }
 function filtered(){
  const needle=state.query.trim().toLowerCase();
  const rows=state.products.filter(p=>{
   if(state.type!=='all'&&p.type!==state.type)return false;
   if(!matchesPlatform(p))return false;
   if(state.provider!=='all'&&String(p.provider||'')!==state.provider)return false;
   if(state.region!=='all'&&String(p.region||'')!==state.region)return false;
   if(state.distribution!=='all'&&String(p.distribution||'')!==state.distribution)return false;
   if(state.maxTer!==null){const ter=num(p.ter);if(ter===null||ter>state.maxTer)return false}
   for(const [key,filter] of Object.entries(state.columnFilters||{})){
    if(!fundColumnFilterMatch(fundColumnRaw(p,key),filter,fundColumnType(key)))return false;
   }
   if(!needle)return true;
   return [p.name,p.isin,p.provider,p.index,p.category,p.region].some(v=>String(v||'').toLowerCase().includes(needle));
  });
  rows.sort(compareFundRows);
  return rows;
 }
 function perfStrip(p){
  return '<div class="fund-performance">'+PERIODS.map(([label,key])=>'<span><small>'+label+'</small><b class="'+((num(p[key])||0)>=0?'positive':'negative')+'">'+pct(p[key])+'</b></span>').join('')+'</div>';
 }
 function compactFacts(p){
  const facts=[
   ['Índice',p.index],['Gestora',p.provider],['TER',num(p.ter)===null?'—':num(p.ter).toLocaleString('es-ES',{maximumFractionDigits:3})+'%'],
   ['Clase',p.distribution],['Categoría',p.category],['Región',p.region]
  ];
  return '<div class="fund-facts">'+facts.map(([k,v])=>'<div><small>'+esc(k)+'</small><strong>'+esc(v||'—')+'</strong></div>').join('')+'</div>';
 }
 function detail(p){
  const risk=[
   ['Volatilidad 3A',pct(p.volatility3Y)],['Drawdown máx.',pct(p.maxDrawdown)],['Sharpe 3A',num(p.sharpe3Y)===null?'—':num(p.sharpe3Y).toLocaleString('es-ES',{maximumFractionDigits:2})],
   ['Tracking diff.',pct(p.trackingDifference)],['Patrimonio',num(p.assetsUnderManagement)===null?'—':money(p.assetsUnderManagement,p.currency)]
  ];
  const sources=(p.sources||[]).map(s=>{const url=safeHttpsUrl(s&&s.url);return url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.label||s.url||'Fuente')+'</a>':''}).filter(Boolean).join(' · ');
  return '<details class="fund-more"><summary>Más datos</summary>'+
   compactFacts(p)+
   '<div class="fund-risk-grid">'+risk.map(([k,v])=>'<div><small>'+esc(k)+'</small><strong>'+esc(v)+'</strong></div>').join('')+'</div>'+
   '<div class="fund-source-line"><span>'+esc(ageText(p.sourceUpdatedAt||p.valueDate))+'</span>'+(sources?'<span>·</span>'+sources:'')+'</div>'+
  '</details>';
 }
 const FUND_COLUMNS=[
  ['name','Producto'],
  ['platform','Plataformas'],
  ['current','VL / Precio'],
  ['freshness','Actualización'],
  ['perf1M','1M'],['perf3M','3M'],['perf6M','6M'],['perfYtd','YTD'],
  ['perf1Y','1A'],['perf3Y','3A'],['perf5Y','5A'],['perf10Y','10A'],['perfSinceInception','Hist.'],
  ['ter','TER'],['index','Índice'],['provider','Gestora'],['distribution','Clase'],['region','Región'],['actions','Acciones']
 ];
 const FUND_PREF_SCOPE='catalog:funds';
 const FUND_DEFAULT_WIDTHS={name:340,platform:170,current:118,freshness:130,perf1M:76,perf3M:76,perf6M:76,perfYtd:76,perf1Y:76,perf3Y:76,perf5Y:76,perf10Y:76,perfSinceInception:82,ter:74,index:210,provider:150,distribution:120,region:120,actions:164};
 function fundDefaultOrder(){return FUND_COLUMNS.map(([key])=>key)}
 function fundDefaultWidths(){return Object.fromEntries(FUND_COLUMNS.map(([key])=>[key,FUND_DEFAULT_WIDTHS[key]||110]))}
 function applyFundLayout(prefs){
  const ids=fundDefaultOrder(),input=prefs&&typeof prefs==='object'?prefs:{};
  const saved=Array.isArray(input.order)?input.order.filter(id=>ids.includes(id)):[];
  state.columnOrder=[...saved,...ids.filter(id=>!saved.includes(id))];
  state.columnWidths=fundDefaultWidths();
  const widths=input.widths&&typeof input.widths==='object'?input.widths:{};
  for(const id of ids){const n=Number(widths[id]);if(Number.isFinite(n))state.columnWidths[id]=Math.max(48,Math.min(720,Math.round(n)))}
 }
 function fundLayout(){
  if(!state.columnOrder||!state.columnWidths)applyFundLayout(root.ViewInvAIUiPreferences?.get?.(FUND_PREF_SCOPE,{})||{});
  return{order:[...state.columnOrder],widths:{...state.columnWidths}};
 }
 function fundColumns(){
  const map=new Map(FUND_COLUMNS),layout=fundLayout();
  return layout.order.map(key=>[key,map.get(key)]).filter(([,label])=>label);
 }
 function saveFundLayout(){root.ViewInvAIUiPreferences?.save?.(FUND_PREF_SCOPE,fundLayout())}
 function sortHeader(key,label){
  const active=state.sort===key,filtered=String(state.columnFilters&&state.columnFilters[key]||'').trim()!=='';
  const arrow=active?(state.sortDir==='asc'?'↑':'↓'):'↕';
  const aria=active?(state.sortDir==='asc'?'ascending':'descending'):'none';
  if(key==='actions')return '<th scope="col" draggable="true" data-fund-column="actions"><div class="fund-th-content"><span>Acciones</span></div><button type="button" class="fund-column-resizer" data-fund-resize="actions" aria-label="Cambiar ancho de Acciones" title="Arrastra para cambiar el ancho"></button></th>';
  return '<th scope="col" aria-sort="'+aria+'" draggable="true" data-fund-column="'+esc(key)+'">'+
   '<div class="fund-th-content"><button type="button" class="fund-sort-button'+(active?' active':'')+'" data-fund-sort-col="'+esc(key)+'"><span>'+esc(label)+'</span><i aria-hidden="true">'+arrow+'</i></button>'+
   '<button type="button" class="fund-header-filter '+(filtered?'active':'')+'" data-fund-filter-column="'+esc(key)+'" aria-label="Filtrar '+esc(label)+'" title="Filtrar '+esc(label)+'"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z"/></svg></button></div>'+
   '<button type="button" class="fund-column-resizer" data-fund-resize="'+esc(key)+'" aria-label="Cambiar ancho de '+esc(label)+'" title="Arrastra para cambiar el ancho"></button></th>';
 }
 function performanceCell(p,key){
  const v=num(p[key]);
  return '<td class="fund-table-number '+(v===null?'muted':v>=0?'positive':'negative')+'">'+pct(v)+'</td>';
 }
 function fundColumnCell(p,key){
  const current=fundCurrentValue(p),kind=p.type==='etf'?'ETF':p.type==='etp'?'ETP / ETC':'FONDO INDEXADO';
  if(key==='name')return '<td class="fund-table-fund"><div class="fund-table-fund-main"><span class="fund-kind">'+kind+'</span><strong title="'+esc(p.name||p.isin)+'">'+esc(p.name||p.isin)+'</strong><small>'+esc(p.isin)+'</small></div></td>';
  if(key==='platform')return '<td class="fund-table-platforms"><div class="fund-platforms">'+platformLabel(p)+'</div></td>';
  if(key==='current')return '<td class="fund-table-value"><strong>'+fundPriceInlineHtml(p,current)+'</strong></td>';
  if(key==='freshness')return '<td class="fund-table-freshness">'+freshnessTextHtml(p)+'</td>';
  if(PERIODS.some(([,period])=>period===key))return performanceCell(p,key);
  if(key==='ter')return '<td class="fund-table-number">'+(num(p.ter)===null?'—':esc(num(p.ter).toLocaleString('es-ES',{maximumFractionDigits:3})+'%'))+'</td>';
  if(key==='index')return '<td class="fund-table-text" title="'+esc(p.index||p.category||'')+'">'+esc(p.index||p.category||'—')+'</td>';
  if(key==='provider')return '<td class="fund-table-text" title="'+esc(p.provider||'')+'">'+esc(p.provider||'—')+'</td>';
  if(key==='distribution')return '<td class="fund-table-text">'+esc(p.distribution||'—')+'</td>';
  if(key==='region')return '<td class="fund-table-text">'+esc(p.region||'—')+'</td>';
  if(key==='actions')return '<td class="fund-table-actions">'+fundFavoriteButton(p)+'<button type="button" class="btn small ghost" data-fund-detail="'+esc(p.isin)+'">Ver ficha</button><button type="button" class="btn small" data-fund-position="'+esc(p.isin)+'">＋ Cartera</button></td>';
  return '<td>—</td>';
 }
 function fundTableRow(p,columns){
  const liveAttr=(p.type==='etf'||p.type==='fund')&&verified(p.platforms.tradeRepublic)?' data-fund-live-isin="'+esc(p.isin)+'"':'';
  return '<tr class="fund-table-row" data-fund-isin="'+esc(p.isin)+'"'+liveAttr+'>'+columns.map(([key])=>fundColumnCell(p,key)).join('')+'</tr>';
 }
 function fundFilterValues(key){
  const out=[],seen=new Set();
  for(const p of state.products){
   const value=fundColumnRaw(p,key),label=String(value??'').trim();
   if(!label||seen.has(label))continue;seen.add(label);out.push(label);if(out.length>=40)break;
  }
  return out;
 }
 function ensureFundFilterMenu(){
  let menu=document.querySelector('#fundColumnFilterMenu');if(menu)return menu;
  menu=document.createElement('div');menu.id='fundColumnFilterMenu';menu.className='column-filter-popover';menu.hidden=true;document.body.appendChild(menu);return menu;
 }
 function closeFundFilterMenu(){const menu=document.querySelector('#fundColumnFilterMenu');if(menu)menu.hidden=true}
 function openFundFilterMenu(button){
  const key=button.dataset.fundFilterColumn;if(key==='actions')return;
  const label=(FUND_COLUMNS.find(([id])=>id===key)||[key,key])[1],type=fundColumnType(key),menu=ensureFundFilterMenu();
  const current=String(state.columnFilters&&state.columnFilters[key]||''),rect=button.getBoundingClientRect(),width=Math.min(340,innerWidth-20);
  menu.dataset.key=key;
  menu.innerHTML='<div class="column-filter-head"><strong>Filtrar · '+esc(label)+'</strong><button type="button" data-column-filter-close aria-label="Cerrar">×</button></div>'+
   '<div class="column-filter-compact-row">'+
    '<input class="input" data-fund-filter-input value="'+esc(current)+'" placeholder="'+(type==='number'?'>1 · 1..5':'Escribe para filtrar…')+'">'+
    '<button type="button" class="column-sort-mini" data-fund-filter-sort="asc" aria-label="Orden ascendente" title="Orden ascendente">↑</button>'+
    '<button type="button" class="column-sort-mini" data-fund-filter-sort="desc" aria-label="Orden descendente" title="Orden descendente">↓</button>'+
   '</div>';
  menu.style.width=width+'px';menu.style.left=Math.min(innerWidth-width-10,Math.max(10,rect.left-120))+'px';menu.style.top=Math.max(10,Math.min(innerHeight-320,rect.bottom+6))+'px';menu.hidden=false;
  setTimeout(()=>menu.querySelector('[data-fund-filter-input]')?.focus(),0);
 }

 const FUND_PAGE_DESKTOP=150,FUND_PAGE_COMPACT=40;
 function fundPageSize(){return compactFundsView()?FUND_PAGE_COMPACT:FUND_PAGE_DESKTOP}
 function fundListSignature(){
  return [state.query,state.platform,state.type,state.provider,state.region,state.distribution,state.maxTer,state.sort,state.sortDir,JSON.stringify(state.columnFilters||{}),compactFundsView()?'c':'d'].join('|');
 }
 function fundVisibleRows(rows){
  const signature=fundListSignature();
  if(signature!==state.limitSignature||!state.limit){state.limitSignature=signature;state.limit=fundPageSize()}
  return rows.length>state.limit?rows.slice(0,state.limit):rows;
 }
 function fundMoreButton(shown,total){
  if(shown>=total)return'';
  const next=Math.min(fundPageSize(),total-shown);
  return '<div class="catalog-more fund-more"><button type="button" class="btn secondary" data-fund-more="1">Mostrar '+next.toLocaleString('es-ES')+' más</button></div>';
 }
 function fundTable(rows){
  const visible=fundVisibleRows(rows);
  const columns=fundColumns(),layout=fundLayout();
  const colgroup='<colgroup>'+columns.map(([key])=>'<col data-fund-col-width="'+esc(key)+'" style="width:'+Math.round(layout.widths[key]||110)+'px">').join('')+'</colgroup>';
  return '<div class="fund-table-scroll" role="region" aria-label="Comparador de fondos indexados y ETFs" tabindex="0">'+
   '<table class="fund-table fund-resizable-table">'+colgroup+'<thead><tr>'+columns.map(([key,label])=>sortHeader(key,label)).join('')+'</tr></thead>'+
   '<tbody>'+visible.map(p=>fundTableRow(p,columns)).join('')+'</tbody></table></div>'+
   fundMoreButton(visible.length,rows.length)+
   '<div class="fund-table-footer"><span><strong>'+visible.length.toLocaleString('es-ES')+'</strong> mostrados de <strong>'+rows.length.toLocaleString('es-ES')+'</strong> productos</span><span>Arrastra columnas · ajusta ancho · filtros por cabecera</span></div>';
 }
 function mobileSortHead(key,label){
  const active=state.sort===key;
  return '<button type="button" class="fund-mobile-sort'+(active?' active':'')+'" data-fund-sort-col="'+esc(key)+'"><span>'+esc(label)+'</span>'+(active?'<i aria-hidden="true">'+(state.sortDir==='asc'?'↑':'↓')+'</i>':'')+'</button>';
 }
 function fundMobileGroup(){
  return MOBILE_GROUPS.find(g=>g.key===state.mobileGroup)||MOBILE_GROUPS[0];
 }
 function fundPlatformShort(p){
  const text=(label,value)=>label+' '+(verified(value)?'✓':rejected(value)?'—':'?');
  return text('TR',p.platforms.tradeRepublic)+' · '+text('MI',p.platforms.myInvestor);
 }
 function fundCompactMoney(v,currency){
  v=num(v);if(v===null)return'—';
  try{return v.toLocaleString('es-ES',{notation:'compact',maximumFractionDigits:1})+' '+String(currency||'EUR').toUpperCase()}
  catch(_){return money(v,currency)}
 }
 function fundMobileCellValue(p,key){
  if(key==='type')return{value:p.type==='etf'?'ETF':p.type==='etp'?'ETP / ETC':'Fondo indexado',tone:'text'};
  if(key==='currency')return{value:p.currency||'—',tone:'text'};
  if(key==='platform')return{value:fundPlatformShort(p),tone:'text'};
  if(key==='freshness')return{value:fundFreshness(p).label,tone:'text compact'};
  if(key==='assetsUnderManagement')return{value:fundCompactMoney(p.assetsUnderManagement,p.currency),tone:'text'};
  if(key==='ter'){
   const v=num(p.ter);return{value:v===null?'—':v.toLocaleString('es-ES',{maximumFractionDigits:3})+'%',tone:'number'};
  }
  if(key==='sharpe3Y'){
   const v=num(p.sharpe3Y);return{value:v===null?'—':v.toLocaleString('es-ES',{maximumFractionDigits:2}),tone:'number'};
  }
  if(['perfYtd','perf1Y','perf3Y','volatility3Y','maxDrawdown','trackingDifference'].includes(key)){
   const v=num(p[key]);return{value:pct(v),tone:v===null?'muted':v>=0?'positive':'negative'};
  }
  return{value:String(p[key]||'—'),tone:'text'};
 }
 function fundMobileTabs(){
  return '<nav class="fund-mobile-groups" aria-label="Datos a comparar">'+MOBILE_GROUPS.map(g=>
   '<button type="button" class="'+(g.key===state.mobileGroup?'active':'')+'" data-fund-mobile-group="'+esc(g.key)+'" aria-pressed="'+(g.key===state.mobileGroup?'true':'false')+'">'+esc(g.label)+'</button>'
  ).join('')+'</nav>';
 }
 function fundMobileRow(p,group){
  return root.ViewInvAICards.render({context:'funds',title:p.name||p.isin,isin:p.isin,leadingHtml:fundFavoriteButton(p),
   openAttrs:' data-fund-detail="'+esc(p.isin)+'" role="button" tabindex="0"',
   cells:group.columns.map(([key,label])=>({...fundMobileCellValue(p,key),label}))});
 }
 function fundMobileList(rows){
  const visible=fundVisibleRows(rows);
  const group=fundMobileGroup(),cols=group.columns.length;
  return fundMobileTabs()+
   '<div class="fund-mobile-compare fund-mobile-cols-'+cols+'">'+
    root.ViewInvAICards.head(group.columns.map(([key,label])=>({html:mobileSortHead(key,label)})),{firstHtml:mobileSortHead('name','Nombre / ISIN')})+
    '<div class="fund-mobile-rows">'+visible.map(p=>fundMobileRow(p,group)).join('')+'</div>'+
   '</div>'+
   fundMoreButton(visible.length,rows.length)+
   '<div class="fund-table-footer"><span><strong>'+visible.length.toLocaleString('es-ES')+'</strong> mostrados de <strong>'+rows.length.toLocaleString('es-ES')+'</strong> productos</span></div>';
 }
 function fundSortLabel(key){
  const desktop=FUND_COLUMNS.find(([column])=>column===key);
  if(desktop)return desktop[1];
  for(const group of MOBILE_GROUPS){const column=group.columns.find(([column])=>column===key);if(column)return column[1]}
  return key;
 }
 function updateMobileFiltersState(){
  const toolbar=q('.fund-toolbar'),button=q('#fundMobileFiltersToggle');if(!toolbar||!button)return;
  const active=[state.platform!=='all',state.type!=='all',state.provider!=='all',state.region!=='all',state.distribution!=='all',state.maxTer!==null].filter(Boolean).length;
  button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z"/></svg>'+(active?'<span class="fund-filter-count" aria-hidden="true">'+active+'</span>':'');
  button.classList.toggle('active',active>0);
  button.setAttribute('aria-label',active?'Abrir filtros generales · '+active+' activo'+(active===1?'':'s'):'Abrir filtros generales');
  button.title=active?'Filtros generales · '+active+' activo'+(active===1?'':'s'):'Filtros generales';
 }
 function renderFundDetail(p){
  const risk=[
   ['Volatilidad 3A',pct(p.volatility3Y)],['Drawdown máx.',pct(p.maxDrawdown)],['Sharpe 3A',num(p.sharpe3Y)===null?'—':num(p.sharpe3Y).toLocaleString('es-ES',{maximumFractionDigits:2})],
   ['Tracking diff.',pct(p.trackingDifference)],['Patrimonio',num(p.assetsUnderManagement)===null?'—':money(p.assetsUnderManagement,p.currency)]
  ];
  const sources=(p.sources||[]).map(s=>{const url=safeHttpsUrl(s&&s.url);return url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.label||s.url||'Fuente')+'</a>':''}).filter(Boolean).join(' · ');
  return '<div class="fund-detail-sheet">'+
   '<div class="fund-detail-hero"><div><span class="fund-kind">'+(p.type==='fund'?'FONDO INDEXADO':p.type==='etf'?'ETF':'ETP / ETC')+'</span><h3>'+esc(p.name||p.isin)+'</h3><p>'+esc(p.isin)+'</p></div><div><strong>'+fundPriceInlineHtml(p)+'</strong>'+freshnessTextHtml(p)+'</div></div>'+
   platformLabel(p)+
   '<h4>Rentabilidad</h4>'+perfStrip(p)+
   '<h4>Datos del producto</h4>'+compactFacts(p)+
   '<h4>Riesgo y seguimiento</h4><div class="fund-risk-grid">'+risk.map(([k,v])=>'<div><small>'+esc(k)+'</small><strong>'+esc(v)+'</strong></div>').join('')+'</div>'+
   '<div class="fund-source-line"><span>'+esc(ageText(p.sourceUpdatedAt||p.valueDate))+'</span>'+(sources?'<span>·</span>'+sources:'')+'</div>'+
  '</div>';
 }

 let marketPopularity={at:0,items:[]};
 async function fetchMarketPopularity(force=false){
  if(!force&&marketPopularity.at&&Date.now()-marketPopularity.at<60*60000)return marketPopularity.items;
  try{
   const r=await fetch('/api/attention-ranking?kind=funds',{cache:'no-store'});if(!r.ok)throw Error(String(r.status));
   const data=await r.json();marketPopularity={at:Date.now(),items:Array.isArray(data.items)?data.items:[]};
  }catch(e){console.warn('Fund popularity ranking unavailable',e)}
  return marketPopularity.items;
 }
 function marketTopProducts(limit=10,ranking=[],platform='all'){
  const eligible=state.products.filter(p=>{
   if(p.type==='etp'||/\b(?:2x|3x|leveraged|short)\b/i.test(String(p.name||'')))return false;
   if(platform==='tr')return verified(p.platforms&&p.platforms.tradeRepublic);
   if(platform==='mi')return verified(p.platforms&&p.platforms.myInvestor);
   return true;
  });
  const fallback=eligible.slice().sort((a,b)=>{
   const aumA=num(a.assetsUnderManagement)??0,aumB=num(b.assetsUnderManagement)??0;
   const platformA=(verified(a.platforms&&a.platforms.tradeRepublic)?1:0)+(verified(a.platforms&&a.platforms.myInvestor)?1:0);
   const platformB=(verified(b.platforms&&b.platforms.tradeRepublic)?1:0)+(verified(b.platforms&&b.platforms.myInvestor)?1:0);
   return aumB-aumA||platformB-platformA||String(a.name||'').localeCompare(String(b.name||''),'es');
  });
  if(!ranking.length)return fallback.slice(0,limit);
  const byIsin=new Map(eligible.map(p=>[String(p.isin||'').toUpperCase(),p])),out=[],used=new Set();
  for(const item of ranking){
   const p=byIsin.get(String(item.isin||'').toUpperCase());if(!p||used.has(p.isin))continue;
   used.add(p.isin);out.push(p);if(out.length>=limit)return out;
  }
  for(const p of fallback){
   if(used.has(p.isin))continue;used.add(p.isin);out.push(p);if(out.length>=limit)break;
  }
  return out;
 }
 function marketTopRow(p,i){
  const value=fundCurrentValue(p),ret=num(p.perf1Y),tone=ret===null?'muted':ret>=0?'positive':'negative';
  const type=p.type==='fund'?'Fondo indexado':p.type==='etf'?'ETF':'ETP';
  return root.ViewInvAICards.render({context:'funds-market',title:p.name||p.isin,rank:'#'+(i+1),isin:p.isin,
   subtitle:[type,p.provider,p.indexName].filter(Boolean).join(' · '),
   openAttrs:' data-fund-detail="'+esc(p.isin)+'" role="button" tabindex="0"',
   cells:[{label:'Valor',value:'',tone,html:fundFreshnessDotHtml(p)+'<span>'+money(value,p.currency)+'</span>'},{label:'1 año',value:pct(ret),tone}]});
 }
 async function renderMarketTop10(target,limit=10,platform='all'){
  const box=typeof target==='string'?q(target):target;if(!box)return;
  if(!state.loaded)await load(false);
  const ranking=await fetchMarketPopularity(false);
  const rows=marketTopProducts(limit,ranking,platform);
  box.innerHTML=rows.length?'<div class="market-board-list fund-market-top">'+rows.map(marketTopRow).join('')+'</div>':'<div class="empty-state">No hay fondos o ETFs verificados para esta plataforma.</div>';
  const updated=q('#homeUpdated'),at=state.meta&&state.meta.updatedAt;
  if(updated)updated.textContent=at?'Datos '+new Date(at).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'Actualizando…';
 }

 function render(){
  const box=q('#fundsApp');if(!box)return;
  if(state.loading){box.innerHTML='<div class="empty-state">Actualizando fondos y ETFs…</div>';return}
  if(!state.loading&&!document.querySelector('#view-funds.active')){state.renderDirty=true;return}
  state.renderDirty=false;
  const rows=filtered();
  const updated=state.meta&&state.meta.updatedAt?new Date(state.meta.updatedAt):null;
  const stamp=updated&&Number.isFinite(updated.getTime())?updated.toLocaleString('es-ES'):'sin actualización verificada';
  const productCount=q('#fundProductCount');if(productCount)productCount.textContent=rows.length.toLocaleString('es-ES')+' productos';
  const updatedAt=q('#fundUpdatedAt');if(updatedAt)updatedAt.textContent=stamp;
  const results=rows.length?(compactFundsView()?fundMobileList(rows):fundTable(rows)):
    '<div class="empty-state">No hay productos que coincidan con los filtros. Si el catálogo todavía está vacío, ejecuta la sincronización de fuentes verificadas.</div>';
  box.innerHTML=
   '<div class="funds-status"><strong>'+rows.length+' productos</strong><span>·</span><span>'+esc(stamp)+'</span><span>·</span><span>Orden: '+esc(fundSortLabel(state.sort))+' '+(state.sortDir==='asc'?'↑':'↓')+'</span></div>'+
   results+remoteFundsHtml();
  updateMobileFiltersState();
  requestAnimationFrame(()=>observeFundLive(box));
 }
 async function fetchFundCatalogue(url,cache){
  const RT=root.ViewInvAIRuntime,native=!!(RT&&RT.isPackagedNative);
  let r;
  if(url===null){r=native?await RT.loadOffline('funds'):null;if(!r)throw Error('Sin conexión y sin catálogo guardado todavía')}
  else{r=await fetch(url,{cache});if(!r.ok)throw Error(String(r.status))}
  const copy=url!==null&&native?r.clone():null;
  const data=await r.json();
  const products=Array.isArray(data&&data.products)?data.products:[];
  if(!products.length)throw Error('Catálogo de fondos vacío');
  if(copy)RT.saveOffline('funds',copy);
  return data;
 }
 async function load(force=false){
  if(state.loading)return;
  if(state.loaded&&!force){render();return true}
  let ok=true;
  state.loading=true;render();
  try{
   let data;
   try{
    data=await fetchFundCatalogue(DATA+(force?'?v='+Date.now():''),force?'reload':'no-cache');
   }catch(remoteError){
    const native=!!(root.ViewInvAIRuntime&&root.ViewInvAIRuntime.isPackagedNative);
    if(!native)throw remoteError;
    console.warn('Remote funds catalogue unavailable; using last downloaded copy',remoteError);
    data=await fetchFundCatalogue(null,'no-store');
   }
   state.products=data.products.map(norm).filter(p=>p.isin);
   state.meta=data.meta||{};
   const fill=(sel,values,label)=>{const el=q(sel);if(!el)return;const current=el.value||'all';el.innerHTML='<option value="all">'+label+'</option>'+values.filter(Boolean).sort((a,b)=>a.localeCompare(b,'es')).map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');el.value=[...el.options].some(o=>o.value===current)?current:'all'};
   fill('#fundProvider',[...new Set(state.products.map(p=>p.provider))],'Todas las gestoras');
   fill('#fundRegion',[...new Set(state.products.map(p=>p.region))],'Todas las regiones');
   state.loaded=true;
   mergeLearned();
  }catch(e){
   ok=false;
   console.warn('Funds catalogue loading failed',e);
   state.products=[];state.meta={};
  }finally{state.loading=false;render()}
  return ok;
 }

 function api(path,options={}){
  if(!root.ViewInvAIAuth||typeof root.ViewInvAIAuth.apiFetch!=='function')throw Error('La cuenta todavía no está disponible.');
  return root.ViewInvAIAuth.apiFetch(path,options);
 }
 function productForPosition(position){
  return state.products.find(p=>p.isin===position.isin)||norm({
   isin:position.isin,name:position.name,type:position.product_type,provider:position.provider,index:position.index_name,
   currency:position.currency,platforms:{tradeRepublic:'unknown',myInvestor:'unknown'}
  });
 }
 function selectedFundPortfolio(){
  return account.portfolios.find(p=>String(p.id)===String(account.selectedPortfolioId))||account.portfolios[0]||null;
 }
 function fundPositions(portfolioId){
  return account.positions.filter(p=>String(p.fund_portfolio_id)===String(portfolioId)&&Number(p.active)!==0);
 }
 // Precio para valorar una posición: cotización/NAV del catálogo; si el fondo no lo tiene,
 // el precio de la última operación importada (p. ej. la última ejecución del plan).
 function positionValuation(position,p=productForPosition(position)){
  const units=num(position.units),avg=num(position.avg_price);
  let price=fundCurrentValue(p),source='market',at=null;
  if(price===null&&num(position.last_price)!==null){price=num(position.last_price);source='last';at=position.last_price_at||null}
  const value=units!==null&&price!==null?units*price:null;
  const invested=units!==null&&avg!==null?units*avg:null;
  const pnl=value!==null&&invested!==null?value-invested:null;
  return{units,avg,price,source,at,value,invested,pnl,pnlPct:pnl!==null&&invested>0?pnl/invested*100:null};
 }
 function shortDate(v){const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleDateString('es-ES',{day:'numeric',month:'short'}):''}
 function benefitBreakdown(position){
  const rows=(account.benefits||[]).filter(b=>b.isin===position.isin&&String(b.fund_portfolio_id)===String(position.fund_portfolio_id));
  if(!rows.length)return'';
  return '<div class="asset-card-metrics">'+rows.map(b=>'<span>'+(b.kind==='Saveback'?'Saveback':'Redondeo')+' <b>'+amount(b.total)+'</b> ('+esc(String(num(b.units)!==null?num(b.units).toLocaleString('es-ES',{maximumFractionDigits:4}):'—'))+' part.)</span>').join('')+'</div>';
 }
 function fundPositionCard(position){
  const p=productForPosition(position),v=positionValuation(position,p),cur=position.currency||p.currency;
  const kind=p.type==='etf'?'ETF':p.type==='etp'?'ETP / ETC':'Fondo';
  const valueHtml=v.value===null
   ?'<span class="fund-value-missing">Sin precio</span>'
   :(v.source==='last'?'':fundFreshnessDotHtml(p))+'<span>'+amount(v.value,cur)+'</span>'+(v.source==='last'?'<small class="fund-value-source">precio del '+esc(shortDate(v.at)||'última compra')+'</small>':'');
  const live=(p.type==='etf'||p.type==='fund')&&(verified(p.platforms.tradeRepublic)||/trade\s*republic/i.test(position.platform||''));
  const valueCell=live?'<span data-fund-live-isin="'+esc(p.isin)+'">'+valueHtml+'</span>':valueHtml;
  return root.ViewInvAICards.render({context:'fund-portfolio',className:'portfolio-position-card fund-position-card',title:p.name||position.name||p.isin,isin:p.isin,
   subtitle:kind+' · '+(position.platform||'—'),
   openAttrs:' data-fund-detail="'+esc(p.isin)+'" role="button" tabindex="0"',
   cells:[{label:'Valor actual',value:'',html:valueCell},{label:'P&L',value:v.pnl===null?'—':amount(v.pnl,cur)+(v.pnlPct===null?'':' · '+pct(v.pnlPct)),tone:v.pnl===null?'muted':v.pnl>=0?'positive':'negative'}],
   detailsLabel:'Posición · datos del fondo',detailsHtml:freshnessHtml(p)+'<div class="asset-card-metrics"><span>Participaciones <b>'+esc(v.units===null?'—':v.units.toLocaleString('es-ES',{maximumFractionDigits:6}))+'</b></span><span>Precio medio <b>'+money(v.avg,cur)+'</b></span>'+(v.price!==null?'<span>'+(v.source==='last'?'Último precio ('+esc(shortDate(v.at))+')':'Precio actual')+' <b>'+money(v.price,cur)+'</b></span>':'')+'</div>'+benefitBreakdown(position)+(v.source==='last'?'<p class="fund-note">Este fondo no tiene valor liquidativo en el catálogo: se valora con el precio de tu última operación importada.</p>':'')+compactFacts(p)+perfStrip(p),
   actionsHtml:'<button type="button" class="btn small" data-fund-transactions="'+esc(position.id)+'">Operaciones</button><button type="button" class="btn small ghost" data-fund-position-edit="'+esc(position.id)+'">Editar</button><button type="button" class="btn small ghost" data-fund-position-delete="'+esc(position.id)+'">Eliminar</button>'
  });
 }

 // Totales por cartera de fondos en EUR, para «Mi día»: el mismo valor que enseñan sus tarjetas.
 function portfolioTotals(){
  return account.portfolios.map(pf=>{
   let value=0,day=0,pnl=0,complete=true;const list=fundPositions(pf.id);
   for(const position of list){
    const p=productForPosition(position),v=positionValuation(position,p),cur=String(position.currency||p.currency||'EUR').toUpperCase();
    if(v.value===null||cur!=='EUR'){complete=false;continue}
    value+=v.value;if(v.pnl!==null)pnl+=v.pnl;
    const q=v.source==='market'?liveQuote(p.isin):null,prev=num(q&&q.prev);
    if(prev!==null&&prev>0&&v.units!==null&&num(q.price)!==null)day+=v.units*(num(q.price)-prev);
   }
   return{id:pf.id,name:pf.name,value,day,pnl,count:list.length,complete};
  });
 }
 function fundPlans(portfolioId){return account.plans.filter(p=>String(p.fund_portfolio_id)===String(portfolioId)&&Number(p.enabled)!==0)}
 // Saveback / Redondeo de los últimos 90 días en esta cartera, como aportación mensual media.
 // Saveback y Redondeo: suma de lo aportado a cada fondo (no son importes fijos). «monthly» solo
 // alimenta el simulador: lo aportado este año entre los meses transcurridos.
 function fundBenefits(portfolioId){
  const months=Math.max(1,new Date().getMonth()+new Date().getDate()/31);
  return (account.benefits||[]).filter(b=>String(b.fund_portfolio_id)===String(portfolioId)).map(b=>({...b,monthly:(num(b.year_total)||0)/months}));
 }
 function benefitValueNow(b){
  const prod=b.isin?state.products.find(x=>x.isin===b.isin):null;
  const pos=account.positions.find(p=>p.isin===b.isin&&String(p.fund_portfolio_id)===String(b.fund_portfolio_id));
  const price=prod?fundCurrentValue(prod):null,fallback=pos?num(pos.last_price):null,u=num(b.units);
  const px=price??fallback;return u!==null&&px!==null?u*px:null;
 }
 function planSummaryHtml(portfolioId){
  const plans=fundPlans(portfolioId),benefits=fundBenefits(portfolioId);if(!plans.length&&!benefits.length)return'';
  const freqLabel={weekly:'/sem',monthly:'/mes',quarterly:'/trim',annual:'/año',manual:''};
  const total=plans.filter(p=>String(p.status||'active')!=='paused'&&p.frequency==='monthly').reduce((a,p)=>a+(num(p.amount)||0),0);
  return '<section class="fund-plan-list" aria-label="Planes de aportación"><header><small>'+(plans.length?'PLANES DE APORTACIÓN':'APORTACIONES')+'</small>'+(total?'<b>'+amount(total)+'/mes</b>':'')+'</header>'+plans.slice(0,6).map(p=>{
   const prod=p.isin?state.products.find(x=>x.isin===p.isin):null;
   const name=prod&&prod.name||String(p.label||p.isin||'Aportación').replace(/^Plan [^·]+·\s*/,'');
   const paused=String(p.status||'active')==='paused';
   return '<div class="fund-plan-row'+(paused?' paused':'')+'"><span>'+esc(name)+'</span><b>'+(num(p.amount)===null?'variable':amount(p.amount,p.currency||'EUR')+esc(freqLabel[p.frequency]??''))+'</b><small>'+(paused?'En pausa':p.next_contribution_at?'Próx. '+esc(shortDate(p.next_contribution_at)):'')+'</small></div>';
  }).join('')+(benefits.length?'<div class="fund-benefits"><small>SAVEBACK Y REDONDEO</small>'+benefits.map(b=>{
   const prod=b.isin?state.products.find(x=>x.isin===b.isin):null,save=b.kind==='Saveback';
   const now=benefitValueNow(b),n=num(b.n)||0;
   return '<div class="fund-benefit-row"><div><span><em class="fund-benefit-tag'+(save?'':' roundup')+'">'+(save?'Saveback':'Redondeo')+'</em> '+esc(prod&&prod.name||b.name||b.isin)+'</span>'+
    '<small>'+n+(n===1?' compra':' compras')+(num(b.year_total)?' · este año '+amount(b.year_total):'')+(b.first_at?' · desde '+esc(new Date(b.first_at).toLocaleDateString('es-ES',{month:'short',year:'numeric'})):'')+'</small></div>'+
    '<div class="fund-benefit-sum"><b>'+amount(b.total)+'</b>'+(now!==null?'<small>hoy '+amount(now)+'</small>':'')+'</div></div>';
  }).join('')+'<p class="fund-note">Saveback es un premio de Trade Republic (1 % de tus pagos con tarjeta) y el Redondeo sale de tu saldo. Se suman tal cual se invirtieron; el total depende del periodo que cubra el CSV importado.</p></div>':'')+'</section>';
 }
 // ----- Costes, solapamiento y simulador de aportaciones (cartera de fondos) -----
 // Index family from the tracked index (TradingView) or the name.
 function indexFamily(p){
  const t=String((p&&p.index)||'')+' '+String((p&&p.name)||'');
  if(/nasdaq[- ]?100/i.test(t))return'ndx';
  if(/s&p ?500/i.test(t))return'spx';
  if(/msci usa|total us|us total market|crsp us/i.test(t))return'usa';
  if(/acwi|all[- ]world|global all cap|all country/i.test(t))return'acwi';
  if(/msci world|developed world|ftse developed(?! europe)|core world/i.test(t))return'world';
  if(/emerging|\bem\b/i.test(t))return'em';
  if(/euro ?stoxx ?50/i.test(t))return'es50';
  if(/msci emu|eurozone/i.test(t))return'emu';
  if(/msci europe|stoxx europe 600|developed europe|europe 600/i.test(t))return'europe';
  if(/japan|topix|nikkei/i.test(t))return'japan';
  if(/gold|lbma|\boro\b/i.test(t))return'gold';
  if(/ibex/i.test(t))return'ibex';
  return null;
 }
 const eur=(v,d=0)=>Number(v).toLocaleString('es-ES',{style:'currency',currency:'EUR',minimumFractionDigits:d,maximumFractionDigits:d});
 const terText=v=>Number(v).toLocaleString('es-ES',{maximumFractionDigits:2})+' %';
 // Approximate weight overlap between index families (share of holdings in common).
 const OVERLAP={'spx|usa':.9,'ndx|spx':.45,'ndx|usa':.45,'spx|world':.65,'acwi|spx':.6,'usa|world':.7,'acwi|usa':.62,'ndx|world':.3,'acwi|ndx':.28,'acwi|world':.88,'acwi|em':.1,'europe|world':.15,'acwi|europe':.13,'emu|europe':.5,'emu|es50':.6,'es50|europe':.35,'emu|world':.08,'japan|world':.06,'acwi|japan':.05};
 function overlapOf(a,b){if(!a||!b)return 0;if(a===b)return 1;return OVERLAP[[a,b].sort().join('|')]||0}
 const normIndex=v=>String(v||'').toLowerCase().replace(/\(.*?\)/g,' ').replace(/\b(index|net|total return|tr|usd|eur|ntr)\b/g,' ').replace(/[^a-z0-9&]+/g,' ').trim();
 // Clave del índice: el que declara el producto o, en fondos de inversión sin ese dato, su familia por nombre.
 const twinKey=x=>{const k=normIndex(x.index);if(k&&k!=='no underlying')return k;const f=x.type==='fund'?indexFamily(x):null;return f?'family:'+f:''};
 function cheaperTwin(p,platform){
  const key=twinKey(p),ter=num(p.ter);
  if(!key||ter===null)return null;
  const hedged=/hedged/i.test(p.name||'');
  const wantTr=/trade republic/i.test(platform||''),wantMi=/myinvestor/i.test(platform||'');
  let best=null;
  for(const c of state.products){
   if(c.isin===p.isin||twinKey(c)!==key)continue;
   // Un fondo de inversión solo se compara con fondos: entre ellos el traspaso no tributa; pasar a un ETF exige vender.
   if(p.type==='fund'&&c.type!=='fund')continue;
   const t=num(c.ter);if(t===null||t>ter-0.04)continue;
   if(/hedged/i.test(c.name||'')!==hedged)continue;
   if(p.distribution&&c.distribution&&p.distribution!==c.distribution)continue;
   if(wantTr&&!verified(c.platforms.tradeRepublic))continue;
   if(wantMi&&!verified(c.platforms.myInvestor))continue;
   if(!best||t<num(best.ter)||(t===num(best.ter)&&(num(c.assetsUnderManagement)||0)>(num(best.assetsUnderManagement)||0)))best=c;
  }
  return best;
 }
 function dcaPrefs(){try{return JSON.parse(localStorage.getItem('viewinvai:dca')||'{}')||{}}catch(_){return{}}}
 function fundInsightsHtml(portfolioId,rows){
  const items=rows.map(pos=>{const p=productForPosition(pos),v=positionValuation(pos,p);return{pos,p,value:v.value??v.invested,family:indexFamily(p)}}).filter(x=>x.value>0);
  if(!items.length)return'';
  const total=items.reduce((a,x)=>a+x.value,0);
  const known=items.filter(x=>num(x.p.ter)!==null),knownValue=known.reduce((a,x)=>a+x.value,0);
  const ter=knownValue>0?known.reduce((a,x)=>a+x.value*num(x.p.ter),0)/knownValue:null;
  const yearly=ter===null?null:total*ter/100;
  const twins=items.map(x=>({x,c:cheaperTwin(x.p,x.pos.platform)})).filter(t=>t.c);
  const saving=twins.reduce((a,t)=>a+t.x.value*(num(t.x.p.ter)-num(t.c.ter))/100,0);
  const pairs=[];
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){const o=overlapOf(items[i].family,items[j].family);if(o>=.25)pairs.push({a:items[i],b:items[j],o})}
  pairs.sort((x,y)=>y.o-x.o);
  // Simulator defaults: active plans per month, weighted 3-year return net of fees.
  const plans=fundPlans(portfolioId).filter(p=>String(p.status||'active')!=='paused'&&p.frequency!=='manual'&&num(p.amount)>0);
  const perMonth=plans.reduce((a,p)=>a+num(p.amount)*(p.frequency==='weekly'?52/12:p.frequency==='quarterly'?1/3:p.frequency==='annual'?1/12:1),0)+fundBenefits(portfolioId).reduce((a,b)=>a+b.monthly,0);
  let ret=null;{let w=0,acc=0;items.forEach(x=>{const p3=num(x.p.perf3Y);if(p3!==null&&p3>-90){acc+=x.value*(Math.pow(1+p3/100,1/3)-1);w+=x.value}});if(w>0)ret=acc/w*100}
  const prefs=dcaPrefs();
  const monthly=num(prefs.monthly)??Math.round(perMonth||100),years=num(prefs.years)??20,expected=num(prefs.ret)??Math.max(2,Math.min(8,ret===null?7:Math.round(ret*10)/10));
  let open=false;try{open=localStorage.getItem('viewinvai:fund-insights-open')==='1'}catch(_){}
  const cur='EUR';
  return '<details class="portfolio-insights fund-insights" data-fund-insights'+(open?' open':'')+'>'+
   '<summary><span class="insights-title">Costes, solapamiento y simulador</span><span class="insights-chips">'+
    (ter!==null?'<b>TER '+ter.toLocaleString('es-ES',{maximumFractionDigits:2})+' %</b>':'')+(yearly!==null?'<b>'+eur(yearly,yearly<100?2:0)+'/año</b>':'')+
    (saving>=1?'<b class="warn">Ahorro posible '+eur(saving,saving<100?2:0)+'/año</b>':'')+(pairs.length?'<b class="warn">Solapamiento</b>':'')+'</span></summary>'+
   '<div class="insights-body">'+
    '<div class="insights-scenario"><small>COSTES</small><strong>'+(ter===null?'Sin TER conocido':'Pagas ≈ '+eur(yearly,yearly<100?2:0)+' al año')+'</strong><b>'+(ter===null?'—':ter.toLocaleString('es-ES',{maximumFractionDigits:2})+' %')+'</b>'+
     '<span>TER medio ponderado por valor'+(known.length<items.length?' ('+(items.length-known.length)+' sin dato)':'')+'. En 20 años, cada 0,1 % de comisión cuesta ≈ 2 % del capital final.</span></div>'+
    (twins.length?'<div class="insights-group"><small>MISMO ÍNDICE, MÁS BARATO</small>'+twins.map(t=>'<div class="fund-twin" data-fund-detail="'+esc(t.c.isin)+'" role="button" tabindex="0"><div><b>'+esc(t.x.p.name)+'</b><span>'+terText(t.x.p.ter)+' → <em>'+esc(t.c.name)+(t.c.provider?' · '+esc(t.c.provider):'')+'</em> '+terText(t.c.ter)+'</span></div><strong>−'+eur(t.x.value*(num(t.x.p.ter)-num(t.c.ter))/100,2)+'/año</strong></div>').join('')+'<span class="fund-note">Misma réplica del índice, misma política de dividendos y disponible en tu plataforma. En fondos de inversión se propone solo otro fondo: el traspaso entre fondos no tributa. Pasar de un ETF a otro exige vender.</span></div>':'')+
    (pairs.length?'<div class="insights-group"><small>SOLAPAMIENTO</small>'+pairs.slice(0,4).map(x=>'<div class="fund-overlap"><span>'+esc(x.a.p.name)+' <i>+</i> '+esc(x.b.p.name)+'</span><b>≈ '+Math.round(x.o*100)+' %</b><i class="fund-overlap-bar"><em data-w="'+Math.round(x.o*100)+'"></em></i></div>').join('')+'<span class="fund-note">Cada pareja comparte buena parte de las mismas empresas: diversificas menos de lo que parece. Cifra aproximada según el índice que replican.</span></div>':'')+
    '<div class="insights-group fund-dca" data-fund-dca data-initial="'+total.toFixed(2)+'" data-ter="'+(ter||0)+'"><small>SIMULADOR DE APORTACIONES</small>'+
     '<div class="fund-dca-inputs"><label><span>Al mes</span><input type="number" min="0" step="10" inputmode="decimal" data-dca="monthly" value="'+monthly+'"></label>'+
     '<label><span>Años</span><input type="number" min="1" max="50" step="1" inputmode="numeric" data-dca="years" value="'+years+'"></label>'+
     '<label><span>% anual</span><input type="number" min="-5" max="20" step="0.5" inputmode="decimal" data-dca="ret" value="'+expected+'"></label></div>'+
     '<div data-dca-out>'+dcaResultHtml(total,monthly,years,expected,ter||0)+'</div>'+
     '<span class="fund-note">Parte del valor actual de la cartera'+(perMonth?' y de tus planes ('+eur(perMonth)+'/mes)':'')+'. Rentabilidad '+(ret===null?'supuesta':'basada en los últimos 3 años (máx. 8 %)')+', menos el TER. No es una previsión.</span></div>'+
   '</div></details>';
 }
 function dcaSeries(initial,monthly,years,ret,ter){
  const r=Math.pow(1+(ret-ter)/100,1/12)-1,pts=[];let v=initial,c=initial;
  pts.push({y:0,v,c});
  for(let m=1;m<=years*12;m++){v=v*(1+r)+monthly;c+=monthly;if(m%12===0)pts.push({y:m/12,v,c})}
  return pts;
 }
 function dcaResultHtml(initial,monthly,years,ret,ter){
  years=Math.max(1,Math.min(50,Math.round(years||0)));monthly=Math.max(0,monthly||0);
  const pts=dcaSeries(initial,monthly,years,ret,ter),last=pts[pts.length-1],max=Math.max(...pts.map(p=>Math.max(p.v,p.c)),1);
  const W=320,H=110,x=y=>y/years*W,yv=v=>H-v/max*H;
  const line=k=>pts.map((p,i)=>(i?'L':'M')+x(p.y).toFixed(1)+' '+yv(p[k]).toFixed(1)).join('');
  return '<svg class="fund-dca-chart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="Evolución simulada"><path class="dca-area" d="'+line('v')+'L'+W+' '+H+'L0 '+H+'Z"/><path class="dca-v" d="'+line('v')+'"/><path class="dca-c" d="'+line('c')+'"/></svg>'+
   '<div class="fund-dca-stats"><div><small>En '+years+' años</small><b>'+eur(last.v)+'</b></div><div><small>Aportado</small><b>'+eur(last.c)+'</b></div><div><small>Ganancia</small><b class="'+(last.v>=last.c?'pnl-up':'pnl-down')+'">'+eur(last.v-last.c)+'</b></div></div>';
 }
 document.addEventListener('input',e=>{
  const inp=e.target.closest&&e.target.closest('[data-dca]');if(!inp)return;
  const box=inp.closest('[data-fund-dca]');if(!box)return;
  const val=k=>num(box.querySelector('[data-dca="'+k+'"]').value);
  const prefs={monthly:val('monthly')??0,years:val('years')??20,ret:val('ret')??7};
  try{localStorage.setItem('viewinvai:dca',JSON.stringify(prefs))}catch(_){}
  box.querySelector('[data-dca-out]').innerHTML=dcaResultHtml(num(box.dataset.initial)||0,prefs.monthly,prefs.years,prefs.ret,num(box.dataset.ter)||0);
 });
 document.addEventListener('toggle',e=>{if(e.target&&e.target.matches&&e.target.matches('[data-fund-insights]')){try{localStorage.setItem('viewinvai:fund-insights-open',e.target.open?'1':'0')}catch(_){}}},true);
 async function openFundPlanForm(position=null){
  const selected=selectedFundPortfolio();if(!selected)return;
  const product=position?productForPosition(position):null;
  openModal('Programación de aportaciones','<form id="fundPlanForm" class="portfolio-form">'+
   '<input type="hidden" name="positionId" value="'+esc(position&&position.id||'')+'"><input type="hidden" name="isin" value="'+esc(position&&position.isin||'')+'">'+
   '<label><span>Fondo / concepto</span><input name="label" maxlength="160" value="'+esc(product&&product.name||'Aportación periódica')+'" required></label>'+
   '<div class="portfolio-form-grid"><label><span>Tipo</span><select name="kind"><option value="monthly">Aportación periódica</option><option value="saveback">Saveback</option><option value="roundup">Round up</option><option value="variable">Variable / manual</option></select></label>'+
   '<label><span>Importe</span><input name="amount" type="number" min="0" step="0.01" placeholder="Ej. 50"></label></div>'+
   '<div class="portfolio-form-grid"><label><span>Periodicidad</span><select name="frequency"><option value="weekly">Semanal</option><option value="monthly" selected>Mensual</option><option value="quarterly">Trimestral</option><option value="annual">Anual</option><option value="manual">Manual / variable</option></select></label>'+
   '<label><span>Fecha de inicio</span><input name="startDate" type="date" value="'+new Date().toISOString().slice(0,10)+'"></label></div>'+
   '<div class="portfolio-form-grid"><label><span>Día del mes</span><input name="day" type="number" min="1" max="31" placeholder="Ej. 5"></label><label><span>Divisa</span><input name="currency" value="'+esc(position&&position.currency||selected.base_currency||'EUR')+'"></label></div>'+
   '<div class="portfolio-form-grid"><label><span>Estado</span><select name="status"><option value="active">Activa</option><option value="paused">Pausada</option></select></label><label><span>Nota</span><input name="notes" maxlength="1000" placeholder="Ej. Trade Republic · 50 € cada mes"></label></div>'+
   '<p class="settings-note">La programación no modifica participaciones automáticamente. Solo una operación ejecutada y registrada actualiza unidades, precio medio e historial.</p>'+
   '<button type="submit" class="btn">Guardar programación</button></form>');
 }
 async function openFundPortfolioHistory(portfolioId){
  openModal('Historial · fondos y ETFs','<div class="portfolio-loading compact"><span></span><p>Cargando operaciones…</p></div>');
  try{
   const r=await api('/api/fund-transactions?portfolioId='+encodeURIComponent(portfolioId));
   const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudo cargar el historial.');
   q('#fundModalBody').innerHTML='<div class="transaction-history">'+fundTransactionRowsHtml(data.transactions||[],'EUR')+'</div>';
  }catch(e){q('#fundModalBody').innerHTML='<div class="portfolio-empty-state compact">'+esc(e.message||'No se pudo cargar el historial.')+'</div>'}
 }
 function renderPortfolio(){
  const box=q('#fundPortfolioApp');if(!box)return;
  const view=q('#view-portfolios');
  if(view&&view.dataset.portfolioAssetMode==='funds'){
   const stocks=q('#portfolioApp');
   if(stocks){stocks.hidden=true;stocks.inert=true;stocks.setAttribute('aria-hidden','true');stocks.style.setProperty('display','none','important')}
   box.hidden=false;box.inert=false;box.setAttribute('aria-hidden','false');box.style.setProperty('display','block','important');
  }
  account.user=root.ViewInvAIAuth?.getUser?.()||account.user;
  if(!account.user){
   box.innerHTML='<div class="portfolio-empty-state"><h2>Cartera de fondos</h2><p>Inicia sesión con Google para sincronizar tus fondos y ETFs entre web y Android.</p><button type="button" class="btn" data-fund-login>Entrar con Google</button></div>';
   return;
  }
  if(account.loading){box.innerHTML='<div class="portfolio-loading"><span></span><p>Cargando fondos…</p></div>';return}
  const selected=selectedFundPortfolio();
  if(!selected){
   box.innerHTML='<div class="portfolio-empty-state"><h2>Tu cartera de fondos está vacía</h2><p>Al añadir el primer fondo se creará automáticamente una cartera “Fondos y ETFs”.</p><button type="button" class="btn" data-fund-new-portfolio>＋ Crear cartera</button></div>';
   return;
  }
  account.selectedPortfolioId=selected.id;
  const rows=fundPositions(selected.id);
  let total=0,complete=true;
  let missing=0,pnlTotal=0,pnlBase=0,pnlCount=0,approx=false;
  for(const position of rows){
   const v=positionValuation(position);
   if(v.value===null){complete=false;missing++;continue}
   total+=v.value;if(v.source==='last')approx=true;
   if(v.pnl!==null){pnlTotal+=v.pnl;pnlBase+=v.invested;pnlCount++}
  }
  const pnl=pnlCount?pnlTotal:null,pnlPct=pnl!==null&&pnlBase>0?pnl/pnlBase*100:null,base=selected.base_currency||'EUR';
  box.innerHTML=
   '<div class="fund-portfolio-toolbar portfolio-inline-tools"><div class="portfolio-tabs-track">'+account.portfolios.map(p=>'<button type="button" class="portfolio-tab'+(String(p.id)===String(selected.id)?' active':'')+'" data-fund-portfolio-select="'+esc(p.id)+'"><strong>'+esc(p.name)+'</strong><span>'+fundPositions(p.id).length+'</span></button>').join('')+'</div>'+
   '<button type="button" class="portfolio-icon-action" data-fund-new-portfolio title="Nueva cartera" aria-label="Nueva cartera">＋</button>'+
   '<button type="button" class="portfolio-icon-action" data-fund-portfolio-edit="'+esc(selected.id)+'" title="Editar cartera" aria-label="Editar cartera">✎</button>'+
   '<button type="button" class="portfolio-icon-action" data-fund-portfolio-history="'+esc(selected.id)+'" title="Historial" aria-label="Historial">◷</button>'+
   '<button type="button" class="portfolio-icon-action" data-fund-plan title="Programar aportación" aria-label="Programar aportación">▦</button>'+
   '</div>'+
   '<div class="portfolio-summary-bar">'+
    '<div><small>CARTERA</small><strong>'+esc(selected.name)+'</strong></div>'+
    '<div><small>VALOR ACTUAL</small><strong>'+(rows.length&&missing<rows.length?(approx||!complete?'≈ ':'')+amount(total,base):'—')+'</strong>'+(missing?'<em class="fund-summary-note">'+missing+' sin precio</em>':'')+'</div>'+
    '<div><small>P&L</small><strong class="'+(pnl===null?'':(pnl>=0?'pnl-up':'pnl-down'))+'">'+(pnl===null?'—':amount(pnl,base)+(pnlPct===null?'':' · '+pct(pnlPct)))+'</strong></div>'+
    '<div><small>POSICIONES</small><strong>'+rows.length+'</strong></div>'+
   '</div>'+planSummaryHtml(selected.id)+fundInsightsHtml(selected.id,rows)+
   (rows.length?'<div class="fund-position-grid">'+rows.map(fundPositionCard).join('')+'</div>':'<div class="portfolio-empty-state compact">Todavía no hay fondos en esta cartera. Añádelos desde el menú Fondos y ETFs.</div>');
  box.querySelectorAll('.fund-overlap-bar em[data-w]').forEach(el=>el.style.setProperty('width',el.dataset.w+'%'));
  requestAnimationFrame(()=>observeFundLive(box));
 }
 async function loadPortfolio(force=false){
  account.user=root.ViewInvAIAuth?.getUser?.()||null;
  if(!account.user){account.portfolios=[];account.positions=[];renderPortfolio();return}
  if(account.loading&&!force)return;
  account.loading=true;renderPortfolio();
  try{
   const [pr,ps,pl]=await Promise.all([api('/api/fund-portfolios'),api('/api/fund-positions'),api('/api/fund-plans')]);
   const pd=await pr.json().catch(()=>({})),sd=await ps.json().catch(()=>({})),ld=await pl.json().catch(()=>({}));
   if(!pr.ok)throw Error(pd.error||'No se pudieron cargar las carteras de fondos.');
   if(!ps.ok)throw Error(sd.error||'No se pudieron cargar las posiciones de fondos.');
   if(!pl.ok)throw Error(ld.error||'No se pudieron cargar los planes de aportación.');
   account.portfolios=pd.portfolios||[];account.positions=sd.positions||[];account.plans=ld.plans||[];account.benefits=ld.benefits||[];
   if(!account.selectedPortfolioId&&account.portfolios.length)account.selectedPortfolioId=account.portfolios[0].id;
  }catch(e){console.warn('Fund portfolio loading failed',e)}
  finally{account.loading=false;renderPortfolio();try{root.dispatchEvent(new CustomEvent('viewinvai:fund-portfolios-changed'))}catch(_){}}
 }
 async function ensureDefaultFundPortfolio(){
  if(account.portfolios.length)return account.portfolios[0];
  const r=await api('/api/fund-portfolios',{method:'POST',body:JSON.stringify({name:'Fondos y ETFs',platform:'',baseCurrency:'EUR'})});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudo crear la cartera de fondos.');
  account.portfolios=[data.portfolio];account.selectedPortfolioId=data.portfolio.id;return data.portfolio;
 }
 function ensureModal(){
  let backdrop=q('#fundModalBackdrop'),modal=q('#fundModal');
  if(backdrop&&modal)return modal;
  // Same sheet as the stock portfolio modal (#portfolioModal): app-modal styles.
  backdrop=document.createElement('div');backdrop.id='fundModalBackdrop';backdrop.className='app-modal-backdrop';backdrop.setAttribute('aria-hidden','true');
  modal=document.createElement('section');modal.id='fundModal';modal.className='app-modal';modal.setAttribute('aria-hidden','true');modal.setAttribute('aria-label','Fondos');
  modal.innerHTML='<div class="app-modal-head"><strong id="fundModalTitle">Fondos</strong><button type="button" data-fund-modal-close aria-label="Cerrar">×</button></div><div id="fundModalBody" class="app-modal-body"></div>';
  document.body.append(backdrop,modal);return modal;
 }
 function closeModal(){
  q('#fundModal')?.classList.remove('open');q('#fundModal')?.setAttribute('aria-hidden','true');
  q('#fundModalBackdrop')?.classList.remove('open');q('#fundModalBackdrop')?.setAttribute('aria-hidden','true');
  document.body.classList.remove('app-modal-open');
 }
 function openModal(title,html){
  const modal=ensureModal(),backdrop=q('#fundModalBackdrop');
  q('#fundModalTitle').textContent=title;q('#fundModalBody').innerHTML=html;
  modal.classList.add('open');modal.setAttribute('aria-hidden','false');backdrop.classList.add('open');backdrop.setAttribute('aria-hidden','false');document.body.classList.add('app-modal-open');
 }
 function platformOptions(product,current=''){
  let rows=[];
  if(verified(product.platforms.tradeRepublic))rows.push('Trade Republic');
  if(verified(product.platforms.myInvestor))rows.push('MyInvestor');
  if(current&&!rows.includes(current))rows.push(current);
  rows.push('Otra');
  return [...new Set(rows)].map(x=>'<option value="'+esc(x)+'"'+(x===current?' selected':'')+'>'+esc(x)+'</option>').join('');
 }
 async function openPositionForm(product,existing=null){
  account.user=root.ViewInvAIAuth?.getUser?.()||null;
  if(!account.user){root.ViewInvAIAuth?.signIn?.();return}
  if(!account.portfolios.length)await ensureDefaultFundPortfolio();
  const portfolio=selectedFundPortfolio()||account.portfolios[0];
  const currentPlatform=existing?.platform||(verified(product.platforms.myInvestor)&&!verified(product.platforms.tradeRepublic)?'MyInvestor':verified(product.platforms.tradeRepublic)?'Trade Republic':'Otra');
  openModal(existing?'Editar posición':'Añadir a cartera',
   '<form id="fundPositionForm" class="portfolio-form" data-position-id="'+esc(existing?.id||'')+'" data-isin="'+esc(product.isin)+'">'+
    '<div class="portfolio-form-grid"><label><span>Cartera</span><select name="fundPortfolioId">'+account.portfolios.map(p=>'<option value="'+esc(p.id)+'"'+(String(p.id)===String(existing?.fund_portfolio_id||portfolio.id)?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label>'+
    '<label><span>Plataforma</span><select name="platform">'+platformOptions(product,currentPlatform)+'</select></label></div>'+
    '<div class="portfolio-form-grid"><label><span>Participaciones</span><input name="units" type="number" inputmode="decimal" step="any" min="0" required value="'+esc(existing?.units??'')+'"></label>'+
    '<label><span>Precio / VL medio</span><input name="avgPrice" type="number" inputmode="decimal" step="any" min="0" value="'+esc(existing?.avg_price??'')+'"></label></div>'+
    '<div class="portfolio-form-grid"><label><span>Divisa</span><input name="currency" maxlength="3" value="'+esc(existing?.currency||product.currency||'EUR')+'"></label>'+
    '<label><span>Fecha inicial</span><input name="openedAt" type="date" value="'+esc((existing?.opened_at||'').slice(0,10))+'"></label></div>'+
    '<label><span>Notas</span><input name="notes" maxlength="1000" value="'+esc(existing?.notes||'')+'"></label>'+
    '<button type="submit" class="btn">'+(existing?'Guardar cambios':'Añadir posición')+'</button>'+
   '</form>');
 }
 async function savePosition(form){
  const product=state.products.find(p=>p.isin===form.dataset.isin)||productForPosition({isin:form.dataset.isin,name:''});
  const fd=new FormData(form),id=form.dataset.positionId;
  const payload={
   fundPortfolioId:String(fd.get('fundPortfolioId')||''),
   isin:product.isin,name:product.name,productType:product.type,provider:product.provider,indexName:product.index,
   platform:String(fd.get('platform')||''),units:num(fd.get('units')),avgPrice:num(fd.get('avgPrice')),
   currency:String(fd.get('currency')||product.currency||'EUR').toUpperCase(),openedAt:String(fd.get('openedAt')||''),notes:String(fd.get('notes')||'')
  };
  const r=await api(id?'/api/fund-positions/'+encodeURIComponent(id):'/api/fund-positions',{method:id?'PATCH':'POST',body:JSON.stringify(payload)});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudo guardar la posición.');
  closeModal();await loadPortfolio(true);
 }

 function fundTransactionRowsHtml(rows,currency){
  if(!rows||!rows.length)return '<div class="portfolio-empty-state compact">Todavía no hay operaciones registradas.</div>';
  return rows.map(tx=>{
   const buy=String(tx.side||'').toUpperCase()==='BUY';
   const when=tx.executed_at?new Date(tx.executed_at):null;
   const date=when&&Number.isFinite(when.getTime())?when.toLocaleString('es-ES',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
   const total=(num(tx.units)||0)*(num(tx.price)||0);
   return '<div class="transaction-row">'+
    '<span class="transaction-side '+(buy?'buy':'sell')+'">'+(buy?'COMPRA':'VENTA')+'</span>'+
    '<div class="transaction-main"><strong>'+esc((num(tx.units)||0).toLocaleString('es-ES',{maximumFractionDigits:6}))+' × '+money(tx.price,tx.currency||currency)+'</strong><small>'+esc(date)+(num(tx.fees)?' · comisión '+money(tx.fees,tx.currency||currency):'')+'</small></div>'+
    '<div class="transaction-total"><strong>'+money(total,tx.currency||currency)+'</strong><small>'+esc(tx.notes||'')+'</small></div>'+
    '<button type="button" class="transaction-delete" data-fund-transaction-delete="'+esc(tx.id)+'" aria-label="Eliminar operación">×</button>'+
   '</div>';
  }).join('');
 }
 async function openFundTransactions(positionId){
  const position=account.positions.find(p=>String(p.id)===String(positionId));
  if(!position)return;
  const product=productForPosition(position),currency=position.currency||product.currency||'EUR';
  openModal('Operaciones · '+(product.name||position.isin),'<div class="portfolio-loading compact"><span></span><p>Cargando operaciones…</p></div>');
  try{
   const r=await api('/api/fund-transactions?positionId='+encodeURIComponent(position.id));
   const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudieron cargar las operaciones.');
   const summary=data.summary||{};
   q('#fundModalBody').innerHTML=
    '<div class="transaction-ledger">'+
     '<div class="transaction-summary">'+
      '<div><small>POSICIÓN</small><strong>'+esc((num(summary.units)||0).toLocaleString('es-ES',{maximumFractionDigits:6}))+' uds.</strong></div>'+
      '<div><small>MEDIA</small><strong>'+money(summary.avgPrice,currency)+'</strong></div>'+
      '<div><small>P&L REALIZADO</small><strong class="'+((num(summary.realizedPnl)||0)>=0?'pnl-up':'pnl-down')+'">'+money(summary.realizedPnl,currency)+'</strong></div>'+
      '<div><small>COMISIONES</small><strong>'+money(summary.totalFees,currency)+'</strong></div>'+
     '</div>'+
     '<form id="fundTransactionForm" class="portfolio-form transaction-form" data-position-id="'+esc(position.id)+'">'+
      '<div class="portfolio-form-grid"><label><span>Tipo</span><select name="side"><option value="BUY">Compra / aportación</option><option value="SELL">Venta / reembolso</option></select></label>'+
      '<label><span>Participaciones</span><input name="units" type="number" inputmode="decimal" step="any" min="0.00000001" required></label></div>'+
      '<div class="portfolio-form-grid"><label><span>Precio / VL</span><input name="price" type="number" inputmode="decimal" step="any" min="0" required value="'+esc(num(product.nav)??'')+'"></label>'+
      '<label><span>Comisión</span><input name="fees" type="number" inputmode="decimal" step="any" min="0" value="0"></label></div>'+
      '<div class="portfolio-form-grid"><label><span>Divisa</span><input name="currency" value="'+esc(currency)+'" readonly></label>'+
      '<label><span>Fecha y hora</span><input name="executedAt" type="datetime-local" value="'+new Date().toISOString().slice(0,16)+'" required></label></div>'+
      '<label><span>Nota</span><input name="notes" maxlength="1000" placeholder="Opcional"></label>'+
      '<button type="submit" class="btn">Registrar operación</button>'+
     '</form>'+
     '<div class="transaction-history-head"><strong>Historial</strong><span>'+(data.transactions||[]).length+' operaciones</span></div>'+
     '<div class="transaction-history">'+fundTransactionRowsHtml(data.transactions||[],currency)+'</div>'+
    '</div>';
  }catch(e){q('#fundModalBody').innerHTML='<div class="portfolio-empty-state compact">'+esc(e.message||'No se pudieron cargar las operaciones.')+'</div>'}
 }
 async function saveFundTransaction(form){
  const position=account.positions.find(p=>String(p.id)===String(form.dataset.positionId));
  if(!position)throw Error('No se encuentra la posición.');
  const fd=new FormData(form),raw=String(fd.get('executedAt')||''),date=new Date(raw);
  const payload={
   positionId:position.id,side:String(fd.get('side')||'BUY'),units:num(fd.get('units')),price:num(fd.get('price')),
   fees:num(fd.get('fees'))||0,currency:String(fd.get('currency')||position.currency||'EUR'),
   executedAt:Number.isFinite(date.getTime())?date.toISOString():'',notes:String(fd.get('notes')||'')
  };
  const r=await api('/api/fund-transactions',{method:'POST',body:JSON.stringify(payload)});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudo guardar la operación.');
  await loadPortfolio(true);await openFundTransactions(position.id);
 }

 async function createFundPortfolio(){
  openModal('Nueva cartera de fondos','<form id="fundPortfolioForm" class="portfolio-form"><label><span>Nombre</span><input name="name" maxlength="80" required value="Fondos y ETFs"></label><label><span>Plataforma principal</span><select name="platform"><option value="">Mixta / varias</option><option>MyInvestor</option><option>Trade Republic</option><option>Otra</option></select></label><button type="submit" class="btn">Crear cartera</button></form>');
 }
 function bind(){
  q('#fundSearch')?.addEventListener('input',e=>{state.query=String(e.target.value||'');render();remoteSearch()});
  q('#fundPlatform')?.addEventListener('change',e=>{state.platform=e.target.value;render()});
  q('#fundType')?.addEventListener('change',e=>{state.type=e.target.value;render()});
  q('#fundProvider')?.addEventListener('change',e=>{state.provider=e.target.value;render()});
  q('#fundRegion')?.addEventListener('change',e=>{state.region=e.target.value;render()});
  q('#fundDistribution')?.addEventListener('change',e=>{state.distribution=e.target.value;render()});
  q('#fundMaxTer')?.addEventListener('input',e=>{state.maxTer=num(e.target.value);render()});
  q('#fundSort')?.addEventListener('change',e=>applyFundSortSelect(e.target.value));
  q('#refreshFunds')?.addEventListener('click',()=>{
   const stamp=()=>String(state.meta&&state.meta.updatedAt||'');
   if(root.ViewInvAIRefreshFeedback)root.ViewInvAIRefreshFeedback.run(()=>load(true),stamp);
   else load(true);
  });
  document.addEventListener('click',async e=>{
   const fundFilterButton=e.target.closest&&e.target.closest('[data-fund-filter-column]');
   if(fundFilterButton){e.preventDefault();e.stopPropagation();openFundFilterMenu(fundFilterButton);return}
   const filterMenu=e.target.closest&&e.target.closest('#fundColumnFilterMenu');
   if(filterMenu){
    const key=filterMenu.dataset.key;
    if(e.target.closest('[data-column-filter-close]')){closeFundFilterMenu();return}
    const sort=e.target.closest('[data-fund-filter-sort]');if(sort){setFundSort(key,sort.dataset.fundFilterSort);closeFundFilterMenu();return}
    return;
   }
   if(!e.target.closest('.column-filter-popover'))closeFundFilterMenu();
   if(e.target.closest&&e.target.closest('[data-copy-isin]'))return;
   const fundFav=e.target.closest&&e.target.closest('[data-fund-favorite]');if(fundFav){e.preventDefault();e.stopPropagation();toggleFundFavorite(fundFav.dataset.fundFavorite);return;}
   const mobileGroup=e.target.closest&&e.target.closest('[data-fund-mobile-group]');
   if(mobileGroup){
    state.mobileGroup=mobileGroup.dataset.fundMobileGroup||'general';
    render();
    return;
   }
   const moreButton=e.target.closest&&e.target.closest('[data-fund-more]');
   if(moreButton){e.preventDefault();state.limit=(state.limit||fundPageSize())+fundPageSize();render();return}
   const sortButton=e.target.closest&&e.target.closest('[data-fund-sort-col]');
   if(sortButton){setFundSort(sortButton.dataset.fundSortCol);return}
   if(e.target.closest&&e.target.closest('#fundResetColumns')){
    applyFundLayout({order:fundDefaultOrder(),widths:fundDefaultWidths()});state.columnFilters={};saveFundLayout();render();return;
   }

   const asset=e.target.closest&&e.target.closest('[data-portfolio-asset]');
   if(asset){setPortfolioAssetMode(asset.dataset.portfolioAsset,true);return}
   if(e.target.closest?.('[data-fund-login]')){root.ViewInvAIAuth?.signIn?.();return}
   const select=e.target.closest&&e.target.closest('[data-fund-portfolio-select]');
   if(select){account.selectedPortfolioId=select.dataset.fundPortfolioSelect;renderPortfolio();return}
   if(e.target.closest?.('[data-fund-new-portfolio]')){createFundPortfolio();return}
   const hist=e.target.closest&&e.target.closest('[data-fund-portfolio-history]');if(hist){await openFundPortfolioHistory(hist.dataset.fundPortfolioHistory);return}
   const plan=e.target.closest&&e.target.closest('[data-fund-plan]');if(plan){await openFundPlanForm();return}
   const editPortfolio=e.target.closest&&e.target.closest('[data-fund-portfolio-edit]');
   if(editPortfolio){const p=account.portfolios.find(x=>String(x.id)===String(editPortfolio.dataset.fundPortfolioEdit));if(p)openModal('Editar cartera de fondos','<form id="fundPortfolioEditForm" data-id="'+esc(p.id)+'" class="portfolio-form"><label><span>Nombre</span><input name="name" value="'+esc(p.name)+'" required></label><label><span>Plataforma</span><input name="platform" value="'+esc(p.platform||'')+'"></label><button class="btn" type="submit">Guardar</button></form>');return}
   if(e.target.closest?.('[data-fund-modal-close]')||e.target.id==='fundModalBackdrop'){closeModal();return}
   const detailButton=e.target.closest&&e.target.closest('[data-fund-detail]');
   if(detailButton){
    const p=state.products.find(x=>x.isin===detailButton.dataset.fundDetail)||adoptRemote(detailButton.dataset.fundDetail);
    if(p){openModal('Ficha · '+(p.name||p.isin),renderFundDetail(p));requestAnimationFrame(()=>observeFundLive(q('#fundModal')))}
    return;
   }
   const add=e.target.closest&&e.target.closest('[data-fund-position]');
   if(add){
    const p=state.products.find(x=>x.isin===add.dataset.fundPosition)||adoptRemote(add.dataset.fundPosition);if(p)await openPositionForm(p);return;
   }
   const transactions=e.target.closest&&e.target.closest('[data-fund-transactions]');
   if(transactions){await openFundTransactions(transactions.dataset.fundTransactions);return}
   const deleteTx=e.target.closest&&e.target.closest('[data-fund-transaction-delete]');
   if(deleteTx){
    const txId=deleteTx.dataset.fundTransactionDelete;
    const positionId=q('#fundTransactionForm')?.dataset.positionId;
    const r=await api('/api/fund-transactions/'+encodeURIComponent(txId),{method:'DELETE'});
    if(r.ok){await loadPortfolio(true);if(positionId)await openFundTransactions(positionId)}
    return;
   }
   const edit=e.target.closest&&e.target.closest('[data-fund-position-edit]');
   if(edit){
    const position=account.positions.find(p=>String(p.id)===String(edit.dataset.fundPositionEdit));if(position)await openPositionForm(productForPosition(position),position);return;
   }
   const del=e.target.closest&&e.target.closest('[data-fund-position-delete]');
   if(del){
    const id=del.dataset.fundPositionDelete;
    const r=await api('/api/fund-positions/'+encodeURIComponent(id),{method:'DELETE'});if(r.ok)await loadPortfolio(true);return;
   }
  });
  document.addEventListener('keydown',e=>{
   if(e.key!=='Enter')return;
   const input=e.target.closest&&e.target.closest('#fundColumnFilterMenu [data-fund-filter-input]');if(!input)return;
   const menu=input.closest('#fundColumnFilterMenu'),key=menu.dataset.key;if(!key)return;
   state.columnFilters[key]=input.value;closeFundFilterMenu();render();
  });
    let draggedFundColumn=null,fundResize=null;
  document.addEventListener('dragstart',e=>{
   const th=e.target.closest&&e.target.closest('.fund-table th[data-fund-column]');if(!th||e.target.closest('.fund-column-resizer,.fund-header-filter'))return;
   draggedFundColumn=th.dataset.fundColumn;th.classList.add('dragging');
   if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',draggedFundColumn)}
  });
  document.addEventListener('dragend',()=>{document.querySelectorAll('.fund-table th.dragging,.fund-table th.drag-over').forEach(x=>x.classList.remove('dragging','drag-over'));draggedFundColumn=null});
  document.addEventListener('dragover',e=>{const th=e.target.closest&&e.target.closest('.fund-table th[data-fund-column]');if(!th||!draggedFundColumn)return;e.preventDefault();th.classList.add('drag-over')});
  document.addEventListener('dragleave',e=>{e.target.closest&&e.target.closest('.fund-table th[data-fund-column]')?.classList.remove('drag-over')});
  document.addEventListener('drop',e=>{
   const th=e.target.closest&&e.target.closest('.fund-table th[data-fund-column]');if(!th||!draggedFundColumn)return;e.preventDefault();
   const order=[...fundLayout().order],from=order.indexOf(draggedFundColumn),to=order.indexOf(th.dataset.fundColumn);if(from<0||to<0||from===to)return;
   order.splice(from,1);order.splice(to,0,draggedFundColumn);state.columnOrder=order;saveFundLayout();render();
  });
  document.addEventListener('pointerdown',e=>{
   const handle=e.target.closest&&e.target.closest('.fund-column-resizer');if(!handle)return;
   e.preventDefault();e.stopPropagation();const key=handle.dataset.fundResize,th=handle.closest('th');if(!key||!th)return;
   fundResize={key,startX:e.clientX,startWidth:th.getBoundingClientRect().width};handle.setPointerCapture?.(e.pointerId);document.body.classList.add('column-resizing');
  });
  document.addEventListener('pointermove',e=>{
   if(!fundResize)return;const next=Math.max(48,Math.min(720,Math.round(fundResize.startWidth+e.clientX-fundResize.startX)));
   fundLayout();state.columnWidths[fundResize.key]=next;const col=document.querySelector('.fund-table col[data-fund-col-width="'+fundResize.key+'"]');if(col)col.style.width=next+'px';
  });
  document.addEventListener('pointerup',()=>{if(!fundResize)return;fundResize=null;document.body.classList.remove('column-resizing');saveFundLayout()});
  root.ViewInvAIUiPreferences?.load?.(FUND_PREF_SCOPE,fundLayout()).then(prefs=>{applyFundLayout(prefs);if(state.loaded)render()}).catch(()=>{});
  root.addEventListener('viewinvai:ui-preferences',event=>{if(event.detail&&event.detail.scope===FUND_PREF_SCOPE){applyFundLayout(event.detail.preferences||{});if(state.loaded)render()}});

  q('.portfolio-asset-switch')?.addEventListener('keydown',e=>{
   if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;
   const tabs=[...document.querySelectorAll('[data-portfolio-asset]')],current=tabs.indexOf(document.activeElement);if(current<0)return;
   e.preventDefault();const next=e.key==='ArrowRight'?(current+1)%tabs.length:(current-1+tabs.length)%tabs.length;
   tabs[next]?.focus();tabs[next]?.click();
  });
  document.addEventListener('submit',async e=>{
   if(e.target.id==='fundPositionForm'){e.preventDefault();try{await savePosition(e.target)}catch(err){console.warn(err);q('#fundModalBody')?.insertAdjacentHTML('afterbegin','<div class="portfolio-render-warning">'+esc(err.message||'No se pudo guardar la posición.')+'</div>')}return}
   if(e.target.id==='fundTransactionForm'){e.preventDefault();try{await saveFundTransaction(e.target)}catch(err){console.warn(err);q('#fundModalBody')?.insertAdjacentHTML('afterbegin','<div class="portfolio-render-warning">'+esc(err.message||'No se pudo guardar la operación.')+'</div>')}return}
   if(e.target.id==='fundPlanForm'){
    e.preventDefault();const fd=new FormData(e.target),selected=selectedFundPortfolio();
    try{const r=await api('/api/fund-plans',{method:'POST',body:JSON.stringify({fundPortfolioId:selected.id,fundPositionId:String(fd.get('positionId')||''),isin:String(fd.get('isin')||''),label:String(fd.get('label')||''),kind:String(fd.get('kind')||'monthly'),amount:num(fd.get('amount')),dayOfMonth:num(fd.get('day')),currency:String(fd.get('currency')||'EUR'),frequency:String(fd.get('frequency')||'monthly'),startDate:String(fd.get('startDate')||''),status:String(fd.get('status')||'active'),enabled:String(fd.get('status')||'active')!=='paused',notes:String(fd.get('notes')||'')})});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudo guardar la programación.');closeModal();await loadPortfolio(true)}catch(err){q('#fundModalBody')?.insertAdjacentHTML('afterbegin','<div class="portfolio-render-warning">'+esc(err.message)+'</div>')}return
   }
   if(e.target.id==='fundPortfolioEditForm'){
    e.preventDefault();const fd=new FormData(e.target),id=e.target.dataset.id;
    try{const r=await api('/api/fund-portfolios/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({name:String(fd.get('name')||''),platform:String(fd.get('platform')||'')})});if(!r.ok)throw Error('No se pudo editar la cartera.');closeModal();await loadPortfolio(true)}catch(err){q('#fundModalBody')?.insertAdjacentHTML('afterbegin','<div class="portfolio-render-warning">'+esc(err.message)+'</div>')}return
   }
   if(e.target.id==='fundPortfolioForm'){
    e.preventDefault();const fd=new FormData(e.target);
    try{
     const r=await api('/api/fund-portfolios',{method:'POST',body:JSON.stringify({name:String(fd.get('name')||''),platform:String(fd.get('platform')||''),baseCurrency:'EUR'})});
     const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudo crear la cartera.');
     closeModal();account.selectedPortfolioId=data.portfolio.id;await loadPortfolio(true);
    }catch(err){console.warn(err);q('#fundModalBody')?.insertAdjacentHTML('afterbegin','<div class="portfolio-render-warning">'+esc(err.message||'No se pudo crear la cartera.')+'</div>')}
   }
  });
  window.addEventListener('viewinvai:auth-changed',()=>loadPortfolio(true));
  window.addEventListener('viewinvai:account-ready',()=>loadPortfolio(true));
 }
 function init(){
  bind();
  setPortfolioAssetMode(savedPortfolioAssetMode(),false);
  if(root.matchMedia){
   const mq=root.matchMedia('(max-width:820px)');
   if(typeof mq.addEventListener==='function')mq.addEventListener('change',()=>{if(state.loaded)render()});
  }
  if(document.querySelector('#view-funds'))load(false);
  renderPortfolio();
 }

 root.ViewInvAIFunds={subscribeIsin:subscribeFund,getLiveQuote:liveQuote,init,load,render,loadPortfolio,renderPortfolio,renderMarketTop10,setPortfolioAssetMode,getState:()=>state,getAccountState:()=>account,getByIsin:isin=>state.products.find(p=>p.isin===isin)||null,getCurrentValue:fundCurrentValue,getPortfolioTotals:portfolioTotals,getFreshness:fundFreshness,getFavoriteProducts:()=>state.products.filter(p=>favoriteIsins.has(p.isin))};
})(window);
