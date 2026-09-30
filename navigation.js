/*
 * ViewInvAI navigation and history
 * --------------------------------
 * Owns view navigation, adaptive nav, browser history and native Android back.
 * Market data and rendering stay in app.js; native geometry stays in mobile-app.js.
 */

const NAV_ORDER=['home','recommendation','alerts','future','portfolios','favorites','catalog','catalogUS','funds','heatmap','settings'];
const NAV_META={
 home:{icon:'',iconHtml:'<svg class="nav-symbol-svg nav-candles" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3v18M3 8h4v7H3zM12 2v20M10 5h4v6h-4zM19 4v17M17 12h4v6h-4z"/></svg>',short:'Mercados',desc:'Mercados y movimientos'},
 recommendation:{icon:'✹',short:'Radar AI',desc:'Alta convicción, oportunidades y vigilancia'},
 portfolios:{icon:'',iconHtml:'<svg class="nav-symbol-svg nav-wallet" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H18a2 2 0 0 1 2 2v2h1v9a3 3 0 0 1-3 3H5a2 2 0 0 1-2-2V6.5Zm2.5-.5a.5.5 0 0 0 0 1H18V6H5.5ZM16 11v4h5v-4h-5Zm2 1.25h1.5v1.5H18v-1.5Z"/></svg>',short:'Carteras',desc:'Posiciones y seguimiento'},
 favorites:{icon:'★',short:'Favoritos',desc:'Acciones, fondos e índices guardados'},
 funds:{icon:'◇',short:'Fondos',desc:'Fondos indexados y ETFs'},
 alerts:{icon:'●',short:'Avisos',desc:'Señales de alta convicción'},
 catalog:{icon:'▤',short:'TR',desc:'Universo Trade Republic'},
 heatmap:{icon:'▦',short:'Mapa',desc:'Mercado por sectores'},
 future:{icon:'✦',short:'Futuro',desc:'Catalizadores próximos'},
 calendar:{icon:'▣',short:'Calendario',desc:'Noticias y eventos'},
 catalogUS:{icon:'▥',short:'EEUU',desc:'Nasdaq, NYSE y AMEX'},
 settings:{icon:'⚙',short:'Configuración General',desc:'Preferencias, avisos y dispositivo'}
};
const PRIMARY_MOBILE_VIEWS=['home','portfolios','recommendation','favorites'];

function navigationOrder(){return NAV_ORDER.filter(v=>NAV_META[v])}
function navigationIconHtml(v){let m=NAV_META[v]||{};return m.iconHtml||E(m.icon||'')}
let navigationRendered=false;
function renderNavigation(){
 if(navigationRendered){syncMobileNavigation();return}
 let order=navigationOrder(),side=$('#sidebar .nav');
 if(side){
  let nodes=new Map($$('#sidebar .nav .nav-item').map(el=>[el.dataset.view,el]));
  order.forEach(v=>{let el=nodes.get(v);if(el)side.appendChild(el)});
 }
 const direct=PRIMARY_MOBILE_VIEWS;
 const rest=order.filter(v=>!direct.includes(v));
 let bottom=$('#mobileBottomNav'),grid=$('#mobileMoreSheet .mobile-more-grid');
 if(bottom){
  bottom.innerHTML=direct.map(v=>'<button type="button" class="mobile-nav-item" data-mobile-view="'+E(v)+'"><span>'+navigationIconHtml(v)+'</span><small>'+E(NAV_META[v].short)+'</small></button>').join('')+
   '<button type="button" class="mobile-nav-item" data-mobile-more="1" aria-expanded="false"><span>•••</span><small>Más</small></button>';
 }
 if(grid){
  grid.innerHTML=rest.map(v=>'<button type="button" class="mobile-more-item" data-mobile-view="'+E(v)+'"><span>'+navigationIconHtml(v)+'</span><b>'+E(V[v].replace(/^\d+\s*/,''))+'</b><small>'+E(NAV_META[v].desc||'')+'</small></button>').join('');
 }
 navigationRendered=true;
 syncMobileNavigation();
}
function syncMobileNavigation(){
 $$('.mobile-nav-item[data-mobile-view]').forEach(x=>x.classList.toggle('active',x.dataset.mobileView===state.currentView));
 let direct=$$('.mobile-nav-item[data-mobile-view]').map(x=>x.dataset.mobileView);
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

let appHistoryReady=false,appHistoryRestoring=false;
function appHistoryDepth(){let d=N(history.state&&history.state.__viewinvaiDepth);return d===null?0:Math.max(0,Math.round(d))}
function appHistorySnapshot(depth=appHistoryDepth()){
 return {__viewinvai:1,__viewinvaiDepth:depth,view:state.currentView||'home',profileKey:state.profileKey||null,profileReason:state.profileReason||'',profileOriginView:state.profileOriginView||null,profileOriginScroll:Math.max(0,Math.round(state.profileOriginScroll||0)),profilePreferTr:state.profilePreferTr,scrollY:Math.max(0,Math.round(window.scrollY||0))};
}
function appHistoryUrl(snap){return location.pathname+location.search+'#app/'+encodeURIComponent(snap.view||'home')+(snap.profileKey?'/stock/'+encodeURIComponent(snap.profileKey):'')}
function replaceCurrentAppHistory(){
 if(!appHistoryReady||appHistoryRestoring)return;
 let snap=appHistorySnapshot(appHistoryDepth());history.replaceState(snap,'',appHistoryUrl(snap));
}
function pushCurrentAppHistory(){
 if(!appHistoryReady||appHistoryRestoring)return;
 let cur=history.state,snap=appHistorySnapshot(appHistoryDepth()+1);
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
 renderNavigation();$('#sidebar')?.classList.remove('open');
 let box=$('#stockQuickDetail');
 if(state.profileKey){document.body.classList.add('stock-detail-open');if(box)box.classList.remove('is-hidden');if(db.stocks.length)renderQuickProfile()}
 else{document.body.classList.remove('stock-detail-open');if(box){box.classList.add('is-hidden');box.innerHTML=''}renderCurrentView()}
 window.dispatchEvent(new CustomEvent('viewinvai:view-changed',{detail:{view:state.currentView}}));
 saveUiState();
 let y=N(snap.scrollY)??0;requestAnimationFrame(()=>window.scrollTo(0,y));
 appHistoryRestoring=false;
}
function initAppHistory(){
 let current=appHistorySnapshot(0);
 let rootView=current.profileOriginView&&V[current.profileOriginView]?current.profileOriginView:current.view;
 let root=Object.assign({},current,{__viewinvaiDepth:0,view:rootView,profileKey:null,profileReason:'',profileOriginView:null,profileOriginScroll:0,profilePreferTr:null,scrollY:0});
 history.replaceState(root,'',appHistoryUrl(root));appHistoryReady=true;
 if(current.profileKey){
  current.__viewinvaiDepth=1;
  history.pushState(current,'',appHistoryUrl(current));
 }
 window.addEventListener('popstate',e=>{if(e.state&&e.state.__viewinvai===1)applyAppHistorySnapshot(e.state)});
}
let exitBackTimer=null,lastNativeBackAt=0;
function showExitBackBanner(){
 let el=$('#exitBackBanner');if(!el)return;
 if(exitBackTimer)clearTimeout(exitBackTimer);
 el.classList.add('visible');el.setAttribute('aria-hidden','false');
 exitBackTimer=setTimeout(()=>{el.classList.remove('visible');el.setAttribute('aria-hidden','true')},1050);
}
function closeTransientUiForBack(){
 let quick=$('#marketQuickSheet');if(quick&&quick.classList.contains('open')){toggleMarketQuick(false);return true}
 let more=$('#mobileMoreSheet');if(more&&more.classList.contains('open')){closeMobileMore();return true}
 let notification=$('#notificationCenter');if(notification&&notification.classList.contains('open')){$('#notificationClose')?.click();return true}
 let help=$('#hoverHelpBanner');if(help&&help.classList.contains('visible')){hideHelpBanner();return true}
 let picker=$('#presetPicker');if(picker&&picker.classList.contains('open')){picker.classList.remove('open');$('#presetTrigger')?.setAttribute('aria-expanded','false');return true}
 return false;
}
function returnFromProfileToOrigin(){
 const box=$('#stockQuickDetail');
 const pinnedView=box&&V[box.dataset.profileOriginView]?box.dataset.profileOriginView:null;
 const pinnedScroll=N(box&&box.dataset.profileOriginScroll);
 const target=pinnedView||(V[state.profileOriginView]?state.profileOriginView:(V[state.currentView]?state.currentView:'home'));
 const y=Math.max(0,pinnedScroll!==null?pinnedScroll:(N(state.profileOriginScroll)??0));
 const nextDepth=Math.max(0,appHistoryDepth()-1);
 document.body.classList.remove('stock-detail-open');
 if(box){
  box.classList.add('is-hidden');box.innerHTML='';
  delete box.dataset.profileTab;
  delete box.dataset.profileOriginView;
  delete box.dataset.profileOriginScroll;
 }
 state.profileKey=null;state.profileReason='';state.profilePreferTr=null;state.profileOriginView=null;state.profileOriginScroll=0;
 state.currentView=target;
 document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id==='view-'+target));
 document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===target));
 renderNavigation();renderCurrentView();saveUiState();
 window.dispatchEvent(new CustomEvent('viewinvai:view-changed',{detail:{view:target}}));
 requestAnimationFrame(()=>window.scrollTo({top:y,behavior:'auto'}));
 if(appHistoryReady&&!appHistoryRestoring){
  const snap=appHistorySnapshot(nextDepth);
  history.replaceState(snap,'',appHistoryUrl(snap));
 }
 return true;
}
function navigateBackOneStep(){
 if(state.profileKey||document.body.classList.contains('stock-detail-open'))return returnFromProfileToOrigin();
 if(closeTransientUiForBack())return true;
 if(appHistoryDepth()>0){history.back();return true}
 return false;
}

function initNativeBackHandling(){
 let cap=window.Capacitor,app=cap&&cap.Plugins&&cap.Plugins.App;
 if(!app||typeof app.addListener!=='function')return;
 app.addListener('backButton',async()=>{
  if(navigateBackOneStep())return
  let now=Date.now();
  if(lastNativeBackAt&&now-lastNativeBackAt<=1600){
   lastNativeBackAt=0;
   if(exitBackTimer){clearTimeout(exitBackTimer);exitBackTimer=null}
   let el=$('#exitBackBanner');if(el){el.classList.remove('visible');el.setAttribute('aria-hidden','true')}
   if(typeof app.exitApp==='function')await app.exitApp();
   return;
  }
  lastNativeBackAt=now;showExitBackBanner();
 });
}
function show(v,preserveProfile=false,recordHistory=true){
 if(!V[v])return;
 if(recordHistory)replaceCurrentAppHistory();
 if(!preserveProfile){document.body.classList.remove('stock-detail-open');let q=$('#stockQuickDetail');if(q){q.classList.add('is-hidden');q.innerHTML=''}state.profileKey=null;state.profileReason='';state.profileOriginView=null;state.profileOriginScroll=0;state.profilePreferTr=null;}
 state.currentView=v;document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));$('#view-'+v).classList.add('active');
 document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));renderNavigation();
 $('#sidebar').classList.remove('open');closeMobileMore();saveUiState();
 if(document.body.classList.contains('stock-detail-open')&&state.profileKey)renderQuickProfile();else renderCurrentView();
 window.dispatchEvent(new CustomEvent('viewinvai:view-changed',{detail:{view:state.currentView}}));
 requestAnimationFrame(()=>observeActiveTrLivePrices());
 window.scrollTo({top:0,behavior:'auto'});
 if(recordHistory)pushCurrentAppHistory();
}

document.querySelectorAll('.nav-item').forEach(x=>x.addEventListener('click',()=>show(x.dataset.view)));
document.addEventListener('click',e=>{
 let mobileView=e.target.closest&&e.target.closest('[data-mobile-view]');
 if(mobileView&&(mobileView.classList.contains('mobile-nav-item')||mobileView.classList.contains('mobile-more-item'))){
  e.preventDefault();let v=mobileView.dataset.mobileView;if(v)show(v);return;
 }
 let mobileMore=e.target.closest&&e.target.closest('[data-mobile-more]');
 if(mobileMore){e.preventDefault();toggleMobileMore();return}
 let quick=e.target.closest&&e.target.closest('#marketQuickToggle');
 if(quick){e.preventDefault();toggleMarketQuick();return}
});
$('#mobileMoreClose')?.addEventListener('click',()=>toggleMobileMore(false));
$('#mobileMoreBackdrop')?.addEventListener('click',()=>toggleMobileMore(false));

function toggleMarketQuick(force){
 const sheet=$('#marketQuickSheet'),backdrop=$('#marketQuickBackdrop'),button=$('#marketQuickToggle'),nav=$('#mobileBottomNav');
 if(!sheet||!backdrop||!button)return;
 const open=typeof force==='boolean'?force:!sheet.classList.contains('open');
 sheet.classList.toggle('open',open);backdrop.classList.toggle('open',open);
 sheet.setAttribute('aria-hidden',open?'false':'true');backdrop.setAttribute('aria-hidden',open?'false':'true');
 button.setAttribute('aria-expanded',open?'true':'false');button.textContent=open?'⌄':'⌃';
 if(open){
  button.classList.add('inside-sheet');
  sheet.insertBefore(button,sheet.firstChild);
 }else{
  button.classList.remove('inside-sheet');
  if(nav&&nav.parentNode)nav.parentNode.insertBefore(button,nav);
 }
 document.body.classList.toggle('market-quick-open',open);
 if(open&&typeof renderMarketQuickSheet==='function')renderMarketQuickSheet();
}
$('#marketQuickBackdrop')?.addEventListener('click',()=>toggleMarketQuick(false));


window.ViewInvAINavigation=Object.assign(window.ViewInvAINavigation||{},{
 go:(view)=>show(view),
 back:()=>navigateBackOneStep(),
 show:(view)=>show(view)
});
