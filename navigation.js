/*
 * ViewInvAI navigation and history
 * --------------------------------
 * Owns view navigation, adaptive nav, browser history and native Android back.
 * Market data and rendering stay in app.js; native geometry stays in mobile-app.js.
 */

const NAV_ORDER=['today','home','news','recommendation','crash','future','portfolios','favorites','inbox','tax','catalog','catalogUS','funds','crypto','heatmap'];
const NAV_META={
 today:{icon:'',iconHtml:'<svg class="nav-symbol-svg nav-today" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-8.5Z"/></svg>',short:'Inicio',desc:'Tu día: carteras, IA, avisos y catalizadores'},
 home:{icon:'',iconHtml:'<svg class="nav-symbol-svg nav-candles" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3v18M3 8h4v7H3zM12 2v20M10 5h4v6h-4zM19 4v17M17 12h4v6h-4z"/></svg>',short:'Mercados',desc:'Mercados y movimientos'},
 recommendation:{icon:'✹',short:'Radar AI',desc:'Alta convicción, oportunidades y vigilancia'},
 crash:{icon:'⇣',short:'Caídas',desc:'Caídas bruscas: ¿rebote o trampa?'},
 portfolios:{icon:'',iconHtml:'<svg class="nav-symbol-svg nav-wallet" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H18a2 2 0 0 1 2 2v2h1v9a3 3 0 0 1-3 3H5a2 2 0 0 1-2-2V6.5Zm2.5-.5a.5.5 0 0 0 0 1H18V6H5.5ZM16 11v4h5v-4h-5Zm2 1.25h1.5v1.5H18v-1.5Z"/></svg>',short:'Carteras',desc:'Posiciones y seguimiento'},
 favorites:{icon:'★',short:'Favoritos',desc:'Acciones, fondos e índices guardados'},
 funds:{icon:'◇',short:'Fondos',desc:'Fondos indexados y ETFs'},
 crypto:{icon:'₿',short:'Cripto',desc:'Precio de consenso, Mi cripto y Radar cripto'},
 catalog:{icon:'▤',short:'TR',desc:'Universo Trade Republic'},
 heatmap:{icon:'▦',short:'Mapa',desc:'Mercado por sectores'},
 future:{icon:'✦',short:'Futuro',desc:'Catalizadores próximos'},
 calendar:{icon:'▣',short:'Calendario',desc:'Noticias y eventos'},
 catalogUS:{icon:'▥',short:'EEUU',desc:'Nasdaq, NYSE y AMEX'},
 news:{icon:'',iconHtml:'<svg class="nav-symbol-svg nav-news" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h11v14H6a1 1 0 0 1-1-1V5Z"/><path d="M16 9h3v9a1 1 0 0 1-1 1h-2"/><path d="M8 9h5M8 12h5M8 15h3"/></svg>',short:'Noticias',desc:'Tus valores, mercado, macro y cripto'},
 inbox:{icon:'',iconHtml:'<svg class="nav-symbol-svg nav-bell" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v3.6L4.4 15.4A1 1 0 0 0 5.3 17h13.4a1 1 0 0 0 .9-1.6L18 12.6V9a6 6 0 0 0-6-6Zm-2.2 15.5a2.3 2.3 0 0 0 4.4 0h-4.4Z"/></svg>',short:'Avisos',desc:'Historial de tus avisos, leídos y sin leer'},
 tax:{icon:'§',short:'Fiscal',desc:'IRPF: plusvalías FIFO, regla de 2 meses y 720'},
 settings:{icon:'⚙',short:'Configuración',desc:'Preferencias, avisos y dispositivo'},
 admin:{icon:'⚙',short:'Administración',desc:'Servicios, consumo y enlaces'}
};
// Bottom bar: Inicio · Radar AI · [⌃ Mercados, the centre arrow] · Carteras · Más.
// Mercados lives only in the centre arrow sheet; Más holds catalogues, the heatmap and settings.
const PRIMARY_MOBILE_VIEWS=['today','recommendation','portfolios'];
const MORE_VIEWS=['news','inbox','catalog','catalogUS','funds','crypto','heatmap','tax'];
const NAV_GROUPS={
 today:['today'],
 home:['home'],
 recommendation:['recommendation','crash','entry','future'],
 portfolios:['portfolios'],
 catalogs:['catalog','catalogUS','funds','crypto','heatmap'],
 inbox:['inbox'],
 tax:['tax'],
 settings:['settings'],
 admin:['admin']
};
// Nombres cortos: el selector de secciones reparte el ancho en partes iguales y debe caber entero.
const SECTION_LABELS={screener:'Screener IA',funds:'Fondos y ETFs',crypto:'Cripto',portfolios:'Carteras',tax:'Fiscal',home:'Mercado',news:'Noticias',favorites:'Favoritos',catalog:'LSX',catalogUS:'EEUU',funds:'Fondos',crypto:'Cripto',heatmap:'Mapa',recommendation:'Radar AI',crash:'Caídas',entry:'Entrada',future:'Futuro'};
const MOBILE_NAV_LABELS={today:'Inicio',recommendation:'Radar AI',portfolios:'Carteras'};
// Diseño D: Mercados agrupa la portada y los catálogos (LSX, EE. UU., fondos, cripto, mapa).
const isDesignD=()=>document.documentElement.dataset.design!=='classic';
// Estructura (2026-10): Hoy · Mercados (Mercado · Screener IA · Noticias) · Radar AI (Radar · Caídas · Futuro) ·
// Carteras (Carteras · Fiscal). El Screener IA reúne lo que antes eran cinco menús: catálogos LSX y EE. UU., fondos
// y ETFs, cripto y mapa de calor, con sus propias pestañas dentro. Avisos y Configuración, en la barra superior.
// El Screener IA reúne acciones (LSX y EE. UU.), fondos, ETFs y cripto: se elige con un único selector.
const SCREENER_VIEWS=['catalog','catalogUS','heatmap','funds','crypto'];
function lastScreenerView(){try{const v=localStorage.getItem('viewinvai:screener-last');return SCREENER_VIEWS.includes(v)?v:'catalog'}catch(_){return'catalog'}}
const D_NAV_GROUPS={today:['today'],home:['home','screener','news'],recommendation:['recommendation','crash','entry','future'],portfolios:['portfolios','tax'],inbox:['inbox'],settings:['settings'],admin:['admin']};
const D_MORE_VIEWS=['inbox','settings','admin'];
const navGroups=()=>isDesignD()?D_NAV_GROUPS:NAV_GROUPS;
function navGroupOf(v){if(isDesignD()&&(SCREENER_VIEWS.includes(v)||v==='screener'))return 'home';if(v==='favorites')return 'portfolios';for(const [g,views] of Object.entries(navGroups()))if(views.includes(v))return g;return 'home'}
const mobileSwitcherMq=window.matchMedia('(max-width:820px)');
if(mobileSwitcherMq.addEventListener)mobileSwitcherMq.addEventListener('change',()=>{try{renderSectionSwitcher()}catch(_){}});
function renderSectionSwitcher(){
 document.querySelectorAll('.section-switcher').forEach(el=>el.remove());
 const view=document.querySelector('.view.active');if(!view)return;
 // Escritorio (diseño ViewInvAI): el menú lateral ya lista cada sección, así que no se repiten en pestañas.
 // La app nativa nunca muestra el menú lateral (tampoco en tableta o en horizontal): ahí siguen las pestañas.
 if(isDesignD()&&!mobileSwitcherMq.matches&&document.documentElement.dataset.nativeApp!=='1'){if(window.ViewInvAIScreener&&window.ViewInvAIScreener.placePicker)window.ViewInvAIScreener.placePicker();return}
 // Caídas bruscas es ahora un perfil del Screener IA, no una pestaña aparte.
 const group=(navGroups()[navGroupOf(state.currentView)]||[]).filter(v=>v!=='entry'&&!(isDesignD()&&v==='crash'));
 if(group.length<2)return;
 const inScreener=isDesignD()&&SCREENER_VIEWS.includes(state.currentView);
 const nav=document.createElement('nav');
 nav.className='section-switcher';nav.setAttribute('aria-label','Secciones');
 const on=v=>v===state.currentView||(v==='screener'&&inScreener)||(v==='recommendation'&&state.currentView==='entry');
 nav.innerHTML=group.map(v=>'<button type="button" class="section-switch'+(on(v)?' active':'')+'" data-section-view="'+E(v)+'" title="'+E(v==='screener'?'Screener IA':(V[v]||v).replace(/^\d+\s*/,''))+'" aria-current="'+(on(v)?'page':'false')+'">'+E(SECTION_LABELS[v]||v)+'</button>').join('');
 const heading=view.querySelector(':scope>.page-heading');
 if(heading)heading.after(nav);else view.prepend(nav);

 const active=nav.querySelector('.active');
 if(active)requestAnimationFrame(()=>active.scrollIntoView({block:'nearest',inline:'center'}));
 if(window.ViewInvAIScreener&&window.ViewInvAIScreener.placePicker)window.ViewInvAIScreener.placePicker();
}

function navigationOrder(){return NAV_ORDER.filter(v=>NAV_META[v])}
function navigationIconHtml(v){let m=NAV_META[v]||{};return m.iconHtml||E(m.icon||'')}
let navigationRendered=false,classicSideHtml=null;
function renderNavigation(){
 if(navigationRendered){syncMobileNavigation();return}
 let order=navigationOrder(),side=$('#sidebar .nav');
 // El menú agrupado sustituye al original: se guarda para poder volver al diseño clásico sin recargar.
 if(side&&classicSideHtml===null)classicSideHtml=side.innerHTML;
 if(side&&isDesignD()){
  // Menú lateral agrupado igual que la barra del móvil: cada grupo con sus secciones.
  const it=(v,label,icon,extra='')=>'<button class="nav-item'+extra+'" data-view="'+E(v)+'"><span>'+(icon||navigationIconHtml(v))+'</span>'+E(label)+'</button>';
  const h=t=>'<div class="nav-group-h">'+E(t)+'</div>';
  side.innerHTML=it('today','Hoy')+
   h('Mercados')+it('home','Mercado')+it('screener','Screener IA','⧩',' nav-screener')+it('news','Noticias')+
   h('Ideas IA')+it('recommendation','Radar AI','✹',' ai-nav-item')+it('future','Potencial futuro','✦')+
   h('Tu dinero')+it('portfolios','Carteras')+it('favorites','Favoritos','★')+it('tax','Fiscal (IRPF)','§');
 }else if(side){
  if(classicSideHtml!==null&&!side.querySelector('.nav-item[data-view="catalog"]'))side.innerHTML=classicSideHtml;
  let nodes=new Map($$('#sidebar .nav .nav-item').map(el=>[el.dataset.view,el]));
  order.forEach(v=>{let el=nodes.get(v);if(el)side.appendChild(el)});
 }
 const designD=isDesignD();
 const rest=(designD?D_MORE_VIEWS:MORE_VIEWS).filter(v=>NAV_META[v]);
 let bottom=$('#mobileBottomNav'),grid=$('#mobileMoreSheet .mobile-more-grid');
 if(bottom){
  const item=v=>'<button type="button" class="mobile-nav-item'+(v==='recommendation'?' ai-pulse-nav':'')+'" data-mobile-view="'+E(v)+'"><span>'+navigationIconHtml(v)+'</span><small>'+E(MOBILE_NAV_LABELS[v]||NAV_META[v].short)+'</small></button>';
  // Diseño D: Hoy · Mercados · ◆ Pregunta · Radar · Carteras. «Más» pasa a la barra superior.
  const itemD=(v,label)=>'<button type="button" class="mobile-nav-item" data-mobile-view="'+E(v)+'"><span>'+navigationIconHtml(v)+'</span><small>'+E(label)+'</small></button>';
  if(designD)bottom.innerHTML=itemD('today','Hoy')+itemD('home','Mercados')+
   '<button type="button" class="mobile-nav-ask" data-ai-ask="1" aria-label="Pregunta a la IA" aria-haspopup="dialog" aria-controls="aiAskSheet"><span class="orb"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.6 6.9 6.9 2.6-6.9 2.6L12 21.5l-2.6-6.9L2.5 12l6.9-2.6z"/></svg></span><span>Pregunta</span></button>'+
   itemD('recommendation','Radar')+itemD('portfolios','Carteras');
  else bottom.innerHTML=item('today')+item('recommendation')+
   '<button type="button" class="mobile-nav-bump" data-market-bump="1" aria-label="Abrir Mercados" title="Mercados" aria-haspopup="dialog" aria-controls="marketQuickSheet" aria-expanded="false"><span class="mobile-nav-bump-cap" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 14.5 12 8.5l6 6"/></svg></span></button>'+
   item('portfolios')+
   '<button type="button" class="mobile-nav-item" data-mobile-more="1" aria-expanded="false" aria-controls="mobileMoreSheet"><span>•••</span><small>Más</small></button>';
 }
 // «Más» en la barra superior (solo diseño D).
 const area=$('#accountArea');let moreTop=$('#designMoreButton');
 if(designD&&area&&!moreTop){moreTop=document.createElement('button');moreTop.type='button';moreTop.id='designMoreButton';moreTop.className='shell-icon-button design-more-button';moreTop.dataset.mobileMore='1';moreTop.setAttribute('aria-label','Más secciones');moreTop.setAttribute('aria-controls','mobileMoreSheet');moreTop.setAttribute('aria-expanded','false');moreTop.title='Más';moreTop.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/></svg>';area.insertBefore(moreTop,area.firstChild)}
 if(!designD&&moreTop)moreTop.remove();
 if(grid&&designD){
  // Diseño D: «Más» por secciones (tu cuenta, herramientas AI, explorar y gestión).
  const tile=(v,extra='',label='')=>NAV_META[v]?'<button type="button" class="mobile-more-item" data-mobile-view="'+E(v)+'"'+extra+'><span>'+navigationIconHtml(v)+'</span><b>'+E(label||V[v].replace(/^\d+\s*/,''))+'</b><small>'+E(NAV_META[v].desc||'')+'</small></button>':'';
  const head=t=>'<h4 class="d-more-h">'+E(t)+'</h4>';
  let user=null;try{user=window.ViewInvAIAuth&&window.ViewInvAIAuth.getUser&&window.ViewInvAIAuth.getUser()}catch(_){}
  const name=String(user&&(user.displayName||user.email)||'Invitado');
  grid.innerHTML='<div class="d-more-account"><span class="d-more-avatar" aria-hidden="true">'+E(name.charAt(0).toUpperCase())+'</span><span><b>'+E(user?name:'Tu cuenta')+'</b><small>'+(user?'Sesión iniciada · datos sincronizados':'Inicia sesión para guardar tus carteras')+'</small></span>'+
    '<button type="button" class="d-more-gear" data-mobile-view="settings" aria-label="Configuración">'+navigationIconHtml('settings')+'</button></div>'+
   '<div class="d-more-screen" id="dMoreScreen"></div>'+
   head('Herramientas AI')+
   '<button type="button" class="mobile-more-item d-more-ai" data-ai-ask="1"><span aria-hidden="true">✦</span><b>Pregunta a la IA</b><small>Sobre tus carteras y el mercado</small></button>'+
   '<button type="button" class="mobile-more-item" data-mobile-view="portfolios" data-portfolio-asset="goal"><span aria-hidden="true">◎</span><b>Objetivo</b><small>Plan de la IA para tu meta</small></button>'+
   tile('future')+
   head('Explorar')+'<button type="button" class="mobile-more-item" data-mobile-view="screener"><span aria-hidden="true">⧩</span><b>Screener IA</b><small>Acciones, fondos, ETFs y cripto</small></button>'+tile('news')+tile('favorites')+
   head('Gestión')+
   '<button type="button" class="mobile-more-item" data-broker-import><span aria-hidden="true">⇅</span><b>Importar extracto</b><small>Trade Republic, IBKR o CSV</small></button>'+
   tile('tax','','Fiscal (IRPF)')+tile('inbox','','Avisos')+tile('settings');
 }else if(grid){
  grid.innerHTML=rest.map(v=>'<button type="button" class="mobile-more-item" data-mobile-view="'+E(v)+'"><span>'+navigationIconHtml(v)+'</span><b>'+E(V[v].replace(/^\d+\s*/,''))+'</b><small>'+E(NAV_META[v].desc||'')+'</small></button>').join('');
 }
 navigationRendered=true;
 syncMobileNavigation();
}
function rebuildNavigation(){navigationRendered=false;renderNavigation()}
function syncMobileNavigation(){
 const group=navGroupOf(state.currentView);
 if(isDesignD()){const cur=state.currentView;$$('#sidebar .nav-item').forEach(x=>{const v=x.dataset.view,on=v===cur||(v==='screener'&&SCREENER_VIEWS.includes(cur))||(v==='recommendation'&&cur==='entry')||(v==='screener'&&cur==='crash');x.classList.toggle('active',on);x.setAttribute('aria-current',on?'page':'false')})}
 $$('.mobile-nav-item[data-mobile-view]').forEach(x=>{const on=x.dataset.mobileView===group;x.classList.toggle('active',on);x.setAttribute('aria-current',on?'page':'false')});
 const bump=$('.mobile-nav-bump');if(bump)bump.classList.toggle('active',state.currentView==='home');
 const more=$('[data-mobile-more]');if(more)more.classList.toggle('active',(isDesignD()?D_MORE_VIEWS:MORE_VIEWS).includes(state.currentView));
 renderSectionSwitcher();
}
function closeMobileMore(){
 let sheet=$('#mobileMoreSheet'),backdrop=$('#mobileMoreBackdrop'),button=$('[data-mobile-more]');
 if(sheet){sheet.classList.remove('open');sheet.setAttribute('aria-hidden','true')}
 if(backdrop){backdrop.classList.remove('open');backdrop.setAttribute('aria-hidden','true')}
 if(button)button.setAttribute('aria-expanded','false');
 document.body.classList.remove('mobile-more-open');
}
// Diseño D: los controles de la pantalla actual (actualizar, ayuda y formato de lista) viven en «Más»,
// así la barra superior tiene siempre los mismos cuatro botones y el título cabe entero.
function paintMoreScreen(){
 const box=$('#dMoreScreen');if(!box)return;
 const view=$('.view.active'),refresh=view&&view.querySelector('.heading-actions .icon-btn'),help=view&&view.querySelector('.section-help');
 const lv=$('#listViewSwitch'),mode=document.documentElement.dataset.listView||'compact';
 const title=(SECTION_LABELS[state.currentView]||(V[state.currentView]||'').replace(/^\d+\s*/,''));
 const btn=(attr,icon,label)=>'<button type="button" '+attr+'><span aria-hidden="true">'+icon+'</span>'+E(label)+'</button>';
 const items=[refresh?btn('data-d-screen="refresh"','↻','Actualizar'):'',help?btn('data-d-screen="help"','?','Ayuda'):''].join('');
 const formats=lv&&!lv.hidden?'<div class="d-more-format" role="group" aria-label="Formato de las listas">'+[['compact','Compacta'],['detailed','Detallada'],['grid','Cuadrícula']].map(([m,l])=>'<button type="button" data-list-view-set="'+m+'" class="'+(m===mode?'active':'')+'" aria-pressed="'+(m===mode)+'">'+l+'</button>').join('')+'</div>':'';
 box.innerHTML=items||formats?'<h4 class="d-more-h">'+E(title||'Esta pantalla')+'</h4><div class="d-more-screen-row">'+items+'</div>'+formats:'';
}
document.addEventListener('click',e=>{
 if(e.target.closest&&e.target.closest('#dMoreScreen [data-list-view-set]')){setTimeout(paintMoreScreen,0);return}
 const b=e.target.closest&&e.target.closest('[data-d-screen]');if(!b)return;
 const view=$('.view.active');toggleMobileMore(false);
 const target=b.dataset.dScreen==='refresh'?view&&view.querySelector('.heading-actions .icon-btn'):view&&view.querySelector('.section-help');
 if(target)target.click();
});
function toggleMobileMore(force){
 let sheet=$('#mobileMoreSheet'),backdrop=$('#mobileMoreBackdrop'),button=$('[data-mobile-more]');if(!sheet||!backdrop||!button)return;
 let open=typeof force==='boolean'?force:!sheet.classList.contains('open');
 if(open)paintMoreScreen();
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
 if(window.ViewInvAISearch&&window.ViewInvAISearch.isOpen()){window.ViewInvAISearch.close();return true}
 let quick=$('#marketQuickSheet');if(quick&&quick.classList.contains('open')){toggleMarketQuick(false);return true}
 // «Atrás» cierra primero el lector de noticias y la hoja Pregunta si están abiertos.
 if(window.ViewInvAINews&&window.ViewInvAINews.isReaderOpen&&window.ViewInvAINews.isReaderOpen()){window.ViewInvAINews.closeReader();return true}
 {const ask=document.querySelector('#aiAskSheet.open');if(ask){const c=ask.querySelector('[data-ai-ask-close]');if(c){c.click();return true}}}
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
 if(v==='alerts')v='home';
 if(v==='screener')v=lastScreenerView();
 // Favoritos vive ahora como pestaña de Carteras.
 if(v==='favorites'){v='portfolios';setTimeout(()=>window.ViewInvAIFunds?.setPortfolioAssetMode?.('favorites',false),0)}
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

document.addEventListener('click',e=>{const x=e.target.closest&&e.target.closest('#sidebar .nav-item');if(x&&x.dataset.view){e.preventDefault();show(x.dataset.view)}});
document.addEventListener('click',e=>{
 const shellView=e.target.closest&&e.target.closest('[data-shell-view]');
 if(shellView){e.preventDefault();const v=shellView.dataset.shellView;if(v)show(v);return}

 let mobileView=e.target.closest&&e.target.closest('[data-mobile-view]');
 if(mobileView&&(mobileView.classList.contains('mobile-nav-item')||mobileView.classList.contains('mobile-more-item')||mobileView.classList.contains('d-more-gear'))){
  e.preventDefault();let v=mobileView.dataset.mobileView;
  if(v&&mobileView.classList.contains('mobile-nav-item')){
   const group=navGroups()[v]||[v];
   if(navGroupOf(state.currentView)===v&&!document.body.classList.contains('stock-detail-open')){v=group[0]}
   else{try{const last=localStorage.getItem('viewinvai:nav-last:'+v);if(last&&navGroupOf(last)===v)v=last}catch(_){}}
  }
  if(v)show(v);return;
 }
 let bump=e.target.closest&&e.target.closest('[data-market-bump]');
 if(bump){e.preventDefault();toggleMobileMore(false);toggleMarketQuick();return}
 let mobileMore=e.target.closest&&e.target.closest('[data-mobile-more]');
 if(mobileMore){e.preventDefault();toggleMarketQuick(false);toggleMobileMore();return}
});
document.addEventListener('click',e=>{
 const sw=e.target.closest&&e.target.closest('[data-section-view]');
 if(sw){e.preventDefault();show(sw.dataset.sectionView)}
});
window.addEventListener('viewinvai:view-changed',()=>{try{localStorage.setItem('viewinvai:nav-last:'+navGroupOf(state.currentView),state.currentView);if(SCREENER_VIEWS.includes(state.currentView))localStorage.setItem('viewinvai:screener-last',state.currentView)}catch(_){}});
$('#mobileMoreClose')?.addEventListener('click',()=>toggleMobileMore(false));
$('#mobileMoreBackdrop')?.addEventListener('click',()=>toggleMobileMore(false));

function toggleMarketQuick(force){
 const sheet=$('#marketQuickSheet'),backdrop=$('#marketQuickBackdrop'),bump=$('.mobile-nav-bump');
 if(!sheet||!backdrop)return;
 const open=typeof force==='boolean'?force:!sheet.classList.contains('open');
 sheet.classList.toggle('open',open);backdrop.classList.toggle('open',open);
 sheet.setAttribute('aria-hidden',open?'false':'true');backdrop.setAttribute('aria-hidden',open?'false':'true');
 if(bump)bump.setAttribute('aria-expanded',open?'true':'false');
 document.body.classList.toggle('market-quick-open',open);
 if(open){document.body.classList.remove('chrome-hide');renderMarketSheet()}
 else restoreMarketBoard();
}
/* The full Mercados board (tabs Más activos/Subidas/…, EEUU/TR, list) lives in #view-home.
   While the sheet shows its «Mercado» tab, those same nodes are moved into the sheet, so
   every existing handler and live update keeps working; they go back when the sheet closes. */
const MARKET_BOARD_PARTS=['#view-home .market-board-tabs','#marketBoardSourceTabs','#homeGroups','#view-home .market-status-line'];
let marketBoardSlots=null;
function adoptMarketBoard(){
 const host=$('#marketSheetBoard');if(!host||marketBoardSlots)return;
 marketBoardSlots=[];
 MARKET_BOARD_PARTS.forEach(sel=>{const el=$(sel);if(!el)return;const mark=document.createComment('market-board-slot');el.before(mark);marketBoardSlots.push([mark,el]);host.appendChild(el)});
}
function restoreMarketBoard(){
 if(!marketBoardSlots)return;
 marketBoardSlots.forEach(([mark,el])=>{if(mark.parentNode){mark.before(el);mark.remove()}});
 marketBoardSlots=null;
}
/* Hoja de Mercados: situación (sesiones, amplitud y extremos del día) y accesos a cada sección. */
let marketSheetTab='situation';
function marketSheetRow(s,preferTr,change){
 const ticker=preferTr?(s.trTicker||s.ticker):(s.ticker||s.trTicker);
 return '<div class="market-sheet-row" data-open-stock="'+E(stockKey(s))+'" data-stock-prefer-tr="'+(preferTr?'1':'0')+'" role="button" tabindex="0"><b>'+E(ticker||'—')+'</b><span>'+E(s.name||'')+'</span><em class="'+(change>=0?'positive':'negative')+'">'+(change>0?'+':'')+F(change,2)+'%</em></div>';
}
function marketSheetBreadth(label,values){
 const up=values.filter(v=>v>0).length,down=values.filter(v=>v<0).length,total=up+down;
 if(total<10)return'';
 const pct=Math.round(up/total*100);
 return '<div class="market-sheet-breadth"><div><span>'+E(label)+'</span><b>'+up+' suben · '+down+' bajan</b></div><i data-up="'+pct+'"><s></s></i></div>';
}
function renderMarketSheet(){
 const status=$('#marketSheetStatus'),body=$('#marketSheetBody'),viewed=$('#marketQuickContent');
 if(!status||!body)return;
 const se=currentMarketSession(),ms=window.ViewInvAIMarketSession;
 let lsx=null;try{lsx=ms&&ms.lsxOpen(ms.zoneClock('Europe/Berlin'))}catch(_){}
 const usOpen=se==='regular',usExt=se==='premarket'||se==='postmarket';
 status.innerHTML='<span class="'+(usOpen?'is-open':usExt?'is-ext':'is-closed')+'"><i></i>EEUU · '+E(SN(se))+'</span>'+
  (lsx===null?'':'<span class="'+(lsx?'is-open':'is-closed')+'"><i></i>LSX · '+(lsx?'Abierto':'Cerrado')+'</span>')+
  (()=>{const f=typeof dataFreshness==='function'?dataFreshness():null;return f?'<span class="'+(f.live?'is-live':'is-muted')+'">'+(f.live?'<i></i>':'')+E(f.text)+'</span>':''})();
 $$('#marketQuickSheet [role="tab"][data-market-sheet-tab]').forEach(b=>{const on=b.dataset.marketSheetTab===marketSheetTab;b.classList.toggle('active',on);b.setAttribute('aria-selected',on?'true':'false')});
 const board=$('#marketSheetBoard');
 if(marketSheetTab==='market'){
  body.hidden=true;if(board)board.hidden=false;
  adoptMarketBoard();
  if(typeof renderHome==='function')renderHome();
  requestAnimationFrame(()=>window.ViewInvAI?.observeLiveQuotes?.(board||document));
  return;
 }
 body.hidden=false;if(board)board.hidden=true;restoreMarketBoard();
 if(marketSheetTab==='viewed'){
  if(typeof renderMarketQuickSheet==='function')renderMarketQuickSheet();
  body.innerHTML='<h3 class="market-sheet-title">Más visitados esta semana</h3>'+(viewed?viewed.innerHTML:'');
  requestAnimationFrame(()=>window.ViewInvAI?.observeLiveQuotes?.(body));
  return;
 }
 const us=(db.stocks||[]).filter(s=>market(s,'us')),tr=(db.stocks||[]).filter(s=>trTradable(s));
 // Outside regular hours few stocks carry an extended-session change, so use the day's result.
 const usLive=se==='regular',usCh=us.map(s=>[s,usLive?SC(s,se):N(s.changePct)]).filter(x=>x[1]!==null);
 const trCh=tr.map(s=>[s,trLiveChange(s)]).filter(x=>x[1]!==null);
 const up=usCh.slice().sort((a,b)=>b[1]-a[1]).slice(0,3),down=usCh.slice().sort((a,b)=>a[1]-b[1]).slice(0,3);
 const trUp=trCh.slice().sort((a,b)=>b[1]-a[1]).slice(0,3);
 const list=(title,rows,preferTr)=>rows.length?'<section class="market-sheet-list"><h3 class="market-sheet-title">'+title+'</h3>'+rows.map(([s,c])=>marketSheetRow(s,preferTr,c)).join('')+'</section>':'';
 body.innerHTML=marketSheetBreadth(usLive?'EEUU · Sesión regular':'EEUU · última sesión',usCh.map(x=>x[1]))+marketSheetBreadth('Trade Republic · LSX',trCh.map(x=>x[1]))+
  list('Más suben · EEUU',up,false)+list('Más bajan · EEUU',down,false)+list('Más suben · LSX',trUp,true)+
  '<button type="button" class="btn secondary market-sheet-more" data-market-sheet-tab="market">Ver todo el mercado</button>';
 // CSP (style-src 'self') blocks inline style attributes; set the bar width through CSSOM.
 body.querySelectorAll('.market-sheet-breadth i[data-up]').forEach(i=>i.style.setProperty('--up',i.dataset.up+'%'));
}
document.addEventListener('click',e=>{
 const sheet=e.target.closest&&e.target.closest('#marketQuickSheet');if(!sheet)return;
 const tab=e.target.closest('[data-market-sheet-tab]');
 if(tab){e.preventDefault();marketSheetTab=tab.dataset.marketSheetTab;renderMarketSheet();return}
 const go=e.target.closest('[data-market-sheet-view]');
 if(go){e.preventDefault();toggleMarketQuick(false);show(go.dataset.marketSheetView);return}
 if(e.target.closest('[data-market-sheet-close]')){toggleMarketQuick(false);return}
 if(e.target.closest('[data-open-stock]'))setTimeout(()=>toggleMarketQuick(false),0);
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('market-quick-open'))toggleMarketQuick(false)});
// Keep the open sheet live: re-render the visible tab at most every 2 s while quotes arrive.
let marketSheetRefreshTimer=null;
window.addEventListener('viewinvai:quote-updated',()=>{
 if(!document.body.classList.contains('market-quick-open')||marketSheetRefreshTimer)return;
 marketSheetRefreshTimer=setTimeout(()=>{marketSheetRefreshTimer=null;if(document.body.classList.contains('market-quick-open')&&marketSheetTab!=='viewed')renderMarketSheet()},2000);
});
$('#marketQuickBackdrop')?.addEventListener('click',()=>toggleMarketQuick(false));


window.ViewInvAINavigation=Object.assign(window.ViewInvAINavigation||{},{
 go:(view)=>show(view),
 back:()=>navigateBackOneStep(),
 show:(view)=>show(view)
});
// Diseño D: las acciones del menú «Más» que no cambian de vista también lo cierran.
document.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('#mobileMoreSheet [data-ai-ask],#mobileMoreSheet [data-broker-import]'))setTimeout(closeMobileMore,0)});
window.addEventListener('viewinvai:auth-changed',()=>{if(isDesignD())setTimeout(rebuildNavigation,50)});

