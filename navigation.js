/*
 * ViewInvAI navigation and history
 * --------------------------------
 * Owns view navigation, adaptive nav, browser history and native Android back.
 * Market data and rendering stay in app.js; native geometry stays in mobile-app.js.
 */

const NAV_ORDER=['home','portfolios','recommendation','entry','alerts','future','catalog','catalogUS','heatmap','calendar','settings'];
const NAV_META={
 home:{icon:'⌂',short:'Inicio'},
 entry:{icon:'◈',short:'Radar'},
 recommendation:{icon:'◎',short:'Ideas IA'},
 portfolios:{icon:'★',short:'Carteras'},
 alerts:{icon:'●',short:'Avisos'},
 catalog:{icon:'▤',short:'TR'},
 heatmap:{icon:'▦',short:'Mapa'},
 future:{icon:'✦',short:'Futuro'},
 calendar:{icon:'▣',short:'Calendario'},
 catalogUS:{icon:'▥',short:'EEUU'},
 settings:{icon:'⚙',short:'Ajustes'}
};
const PRIMARY_MOBILE_VIEWS=['home','portfolios','recommendation','entry'];

function navigationOrder(){return NAV_ORDER.filter(v=>NAV_META[v])}
function renderNavigation(){
 let order=navigationOrder(),side=$('#sidebar .nav');
 if(side){
  let nodes=new Map($$('#sidebar .nav .nav-item').map(el=>[el.dataset.view,el]));
  order.forEach(v=>{let el=nodes.get(v);if(el)side.appendChild(el)});
 }
 const direct=PRIMARY_MOBILE_VIEWS;
 const rest=order.filter(v=>!direct.includes(v));
 let bottom=$('#mobileBottomNav'),grid=$('#mobileMoreSheet .mobile-more-grid');
 if(bottom){
  bottom.innerHTML=direct.map(v=>'<button type="button" class="mobile-nav-item" data-mobile-view="'+E(v)+'"><span>'+E(NAV_META[v].icon)+'</span><small>'+E(NAV_META[v].short)+'</small></button>').join('')+
   '<button type="button" class="mobile-nav-item" data-mobile-more="1" aria-expanded="false"><span>•••</span><small>Más</small></button>';
 }
 if(grid){
  grid.innerHTML=rest.map(v=>'<button type="button" class="mobile-more-item" data-mobile-view="'+E(v)+'"><span>'+E(NAV_META[v].icon)+'</span><b>'+E(V[v].replace(/^\d+\s*/,''))+'</b></button>').join('');
 }
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
 let more=$('#mobileMoreSheet');if(more&&more.classList.contains('open')){closeMobileMore();return true}
 let notification=$('#notificationCenter');if(notification&&notification.classList.contains('open')){$('#notificationClose')?.click();return true}
 let help=$('#hoverHelpBanner');if(help&&help.classList.contains('visible')){hideHelpBanner();return true}
 let picker=$('#presetPicker');if(picker&&picker.classList.contains('open')){picker.classList.remove('open');$('#presetTrigger')?.setAttribute('aria-expanded','false');return true}
 return false;
}
function initNativeBackHandling(){
 let cap=window.Capacitor,app=cap&&cap.Plugins&&cap.Plugins.App;
 if(!app||typeof app.addListener!=='function')return;
 app.addListener('backButton',async()=>{
  if(closeTransientUiForBack())return;
  if(appHistoryDepth()>0){history.back();return}
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
 $('#sidebar').classList.remove('open');closeMobileMore();saveUiState();render();window.scrollTo({top:0,behavior:'auto'});
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
});
$('#mobileMoreClose')?.addEventListener('click',()=>toggleMobileMore(false));
$('#mobileMoreBackdrop')?.addEventListener('click',()=>toggleMobileMore(false));
