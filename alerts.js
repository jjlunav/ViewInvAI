(function(){
 'use strict';

 const STORAGE_KEY='viewinvai:alerts:v2';
 const LEGACY_KEYS=['viewinvai:alerts:v1','catalystpulse:alerts:v1'];
 const MAX_HISTORY=500;
 const HISTORY_DAYS=7;
 const HISTORY_WINDOW_MS=HISTORY_DAYS*24*60*60*1000;
 const RECENT_VISIBLE=8;
 const AUTO_HIDE_MS=6500;
 const ALERT_COOLDOWN_MS=6*60*60*1000;

 let centerTimer=null;
 let historyMode=false;
 let evaluating=false;
 let seeded=false;
 let lastScan={at:0,results:[],best:null,error:''};
 let state=readState();
 let globalNotifications={enabled:true,newsEvents:true,radarAi:true,pulseAi:true};

 function q(s){return document.querySelector(s)}
 function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
 function nowIso(){return new Date().toISOString()}
 function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
 function fmt(v,d=0){let n=Number(v);return Number.isFinite(n)?n.toLocaleString('es-ES',{maximumFractionDigits:d}):'—'}

 function alertCreatedAtMs(item){
  const ms=Date.parse(item&&item.createdAt||'');
  return Number.isFinite(ms)?ms:0;
 }
 function historyRows(){
  const cutoff=Date.now()-HISTORY_WINDOW_MS;
  return state.history.filter(item=>alertCreatedAtMs(item)>=cutoff).sort((a,b)=>alertCreatedAtMs(b)-alertCreatedAtMs(a));
 }

 function readState(){
  const base={enabled:true,history:[],unread:0,activeKey:null,lastFired:{}};
  try{
   let rawText=localStorage.getItem(STORAGE_KEY);
   if(rawText===null){
    for(const key of LEGACY_KEYS){rawText=localStorage.getItem(key);if(rawText!==null)break}
   }
   let raw=JSON.parse(rawText||'null');
   if(!raw||typeof raw!=='object')return base;
   if(typeof raw.enabled==='boolean')base.enabled=raw.enabled;
   else if(raw.auto&&typeof raw.auto.recommendation==='boolean')base.enabled=raw.auto.recommendation;
   if(Array.isArray(raw.history)){
    base.history=raw.history.filter(Boolean).slice(0,MAX_HISTORY).map(x=>({
     id:x.id||uid(),kind:'recommendation',title:x.title||'COMPRA',message:x.message||'',ticker:x.ticker||'',name:x.name||'',market:x.market||'',
     stockKey:x.stockKey||'',preferTr:x.preferTr===true,score:Number(x.score)||null,fingerprint:x.fingerprint||'',createdAt:x.createdAt||nowIso()
    }));
   }
   base.unread=Math.min(base.history.length,Math.max(0,Number(raw.unread)||0));
   if(typeof raw.activeKey==='string')base.activeKey=raw.activeKey;
   if(raw.lastFired&&typeof raw.lastFired==='object')base.lastFired=raw.lastFired;
  }catch(_){}
  return base;
 }
 function saveState(){
  try{
   const cutoff=Date.now()-HISTORY_WINDOW_MS;
   state.history=state.history.filter(item=>alertCreatedAtMs(item)>=cutoff).slice(0,MAX_HISTORY);
   state.unread=Math.min(state.unread||0,state.history.length);
   localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
  }catch(_){}
 }

 function formatTime(value){
  let d=new Date(value||Date.now());
  return isNaN(d)?'':d.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
 }

 function alertCompactCard(item,{details=false}={}){
  const stock=item&&item.stockKey&&window.ViewInvAI?.getStockByKey?.(item.stockKey);
  const signal=esc(item&&item.title||'COMPRA');
  const score=item&&item.score?fmt(item.score,0)+'/100':'—';
  const context='<div class="alert-card-context">'+
   '<span><small>SEÑAL</small><b>'+signal+'</b></span>'+
   '<span><small>SCORE</small><b>'+esc(score)+'</b></span>'+
   '<span><small>HORA</small><b>'+esc(formatTime(item&&item.createdAt))+'</b></span>'+
  '</div>';
  const openAttrs=item&&item.stockKey?' role="button" tabindex="0" data-alert-stock-key="'+esc(item.stockKey)+'" data-alert-prefer-tr="'+(item.preferTr?'1':'0')+'"':'';
  if(stock&&window.ViewInvAI?.renderStandardStockCard){
   return window.ViewInvAI.renderStandardStockCard(stock,{
    index:0,
    preferTr:item.preferTr===true,
    context:'alerts',
    rankLabel:'',
    leadingHtml:'',
    hint:'Aviso · '+String(item.title||'COMPRA'),
    openAttrs,
    cells:[{label:'',html:context}],
    detailsLabel:'Motivo del aviso',
    detailsHtml:details?'<p>'+esc(item.message||'')+'</p>'+(item.score?'<p>Convicción '+fmt(item.score,0)+'/100</p>':''):''
   });
  }
  return window.ViewInvAICards.render({
   context:'alerts',
   title:item&&item.name||item&&item.ticker||item&&item.title||'Aviso',
   subtitle:[item&&item.ticker,item&&item.market].filter(Boolean).join(' · '),
   openAttrs,
   quoteCell:{label:'Señal',value:item&&item.title||'COMPRA',tone:'buy'},
   contextCells:[{label:'',html:context}],
   detailsLabel:'Motivo del aviso',
   detailsHtml:details?'<p>'+esc(item&&item.message||'')+'</p>':''
  });
 }

 function renderCenter(){
  let list=q('#notificationList'),badge=q('#notificationBadge'),status=q('#notificationStatus'),historyButton=q('#notificationHistory');
  if(!list||!badge||!status)return;
  const rows=historyRows();
  const visible=historyMode?rows:rows.slice(0,RECENT_VISIBLE);
  badge.textContent=String(Math.min(99,state.unread||0));
  badge.classList.toggle('is-hidden',!(state.unread>0));
  if(historyMode){
   status.textContent='Últimos '+HISTORY_DAYS+' días · '+rows.length+' aviso'+(rows.length===1?'':'s');
  }else{
   status.textContent=state.unread>0?(state.unread+' sin leer'):(rows.length?rows.length+' guardado'+(rows.length===1?'':'s'):'Sin avisos nuevos');
  }
  if(historyButton){
   historyButton.textContent=historyMode?'Recientes':'Histórico';
   historyButton.setAttribute('aria-pressed',historyMode?'true':'false');
   historyButton.classList.toggle('active',historyMode);
  }
  list.innerHTML=visible.length?visible.map(item=>alertCompactCard(item,{details:true})).join(''):'<div class="notification-empty">'+(historyMode?'No hay avisos en los últimos 7 días.':'No hay avisos recientes.')+'</div>';
 }
 function setCenterOpen(open,{auto=false}={}){
  let center=q('#notificationCenter'),bell=q('#notificationBell');
  if(!center||!bell)return;
  if(centerTimer){clearTimeout(centerTimer);centerTimer=null}
  center.classList.toggle('open',!!open);
  bell.setAttribute('aria-expanded',open?'true':'false');
  if(open&&!auto){state.unread=0;saveState();renderCenter()}
  if(open&&auto)centerTimer=setTimeout(()=>setCenterOpen(false),AUTO_HIDE_MS);
 }

 function pushNotice(payload){
  let item=Object.assign({id:uid(),kind:'recommendation',createdAt:nowIso()},payload);
  let id=String(item.id||'');
  if(id){
   let existing=state.history.findIndex(row=>String(row&&row.id||'')===id);
   if(existing>=0){
    state.history[existing]=Object.assign({},state.history[existing],item);
    saveState();renderCenter();renderAlertPage();setCenterOpen(true,{auto:true});return state.history[existing];
   }
  }
  state.history.unshift(item);state.unread=(state.unread||0)+1;saveState();renderCenter();renderAlertPage();setCenterOpen(true,{auto:true});return item;
 }

 function gateLabel(key){
  return ({score:'score base',combined:'score combinado',chart:'gráfico intradía',trend:'tendencia',volume:'volumen',relVolume:'volumen relativo',adx:'ADX',rsi:'RSI',spread:'spread',momentum:'momentum',catalyst:'noticias/eventos',quality:'calidad de datos'})[key]||key;
 }
 function renderAlertPage(){
  let status=q('#alertPageStatus'),list=q('#alertPageList');if(!status||!list)return;
  if(!state.enabled){
   status.innerHTML='<strong>Avisos desactivados</strong><span>Actívalos para evaluar cambios de alta convicción de Radar AI.</span>';
  }else if(globalNotifications.enabled===false){
   status.innerHTML='<strong>Notificaciones globales desactivadas</strong><span>El interruptor maestro de Settings está apagado.</span>';
  }else if(globalNotifications.radarAi===false||globalNotifications.pulseAi===false){
   status.innerHTML='<strong>Radar AI global desactivado</strong><span>Puedes volver a activar estas notificaciones desde Configuración.</span>';
  }else if(evaluating){
   status.innerHTML='<strong>Analizando mercado…</strong><span>Contrastando gráfico, tendencia, volumen, RSI/ADX, liquidez, noticias y eventos.</span>';
  }else if(lastScan.error){
   status.innerHTML='<strong>No se pudo completar el último análisis</strong><span>'+esc(lastScan.error)+'</span>';
  }else if(lastScan.best){
   let best=lastScan.best,s=best.s||{},ticker=(best.mode==='tr'&&s.trTicker)||s.ticker||'—';
   let failed=Object.entries(best.gates||{}).filter(([,ok])=>!ok).map(([key])=>gateLabel(key));
   status.innerHTML=best.eligible
    ?'<strong>Señal válida · '+esc(ticker)+'</strong><span>Score '+fmt(best.score,1)+'/100 · cumple todos los criterios.</span>'
    :'<strong>Sin compra de alta convicción ahora</strong><span>Mejor candidata: '+esc(ticker)+' · '+fmt(best.score,1)+'/100. Falta: '+esc(failed.slice(0,5).join(', ')||'confirmación completa')+'.</span>';
  }else{
   status.innerHTML='<strong>Sin compra de alta convicción ahora</strong><span>No hay una candidata con datos suficientes que cumpla simultáneamente todos los criterios. Esto no se interpreta como señal de compra.</span>';
  }
  list.innerHTML=state.history.length?state.history.slice(0,20).map(item=>alertCompactCard(item)).join(''):'<div class="notification-empty alert-page-empty">Todavía no hay compras registradas. La pantalla seguirá mostrando el resultado del último análisis aunque no exista señal.</div>';
 }
 function renderSettings(){
  let el=q('#autoAlertHighConviction');if(el)el.checked=state.enabled!==false;
  renderAlertPage();
 }

 function openAlertStock(el){
  let key=el&&el.dataset&&el.dataset.alertStockKey;if(!key)return;
  let preferTr=el.dataset.alertPreferTr==='1';
  if(window.ViewInvAI&&typeof window.ViewInvAI.openStockByKey==='function'){
   let opened=window.ViewInvAI.openStockByKey(key,'Radar AI · alta convicción',preferTr);
   if(opened){state.unread=0;saveState();renderCenter();setCenterOpen(false)}
  }
 }

 async function evaluate(){
  const accountGlobal=window.ViewInvAINotificationSettings;
  if(accountGlobal&&typeof accountGlobal==='object')globalNotifications=Object.assign(globalNotifications,accountGlobal);
  if(evaluating||!state.enabled||globalNotifications.enabled===false||globalNotifications.radarAi===false||globalNotifications.pulseAi===false){renderAlertPage();return}
  if(!window.ViewInvAI||typeof window.ViewInvAI.highConvictionRecommendation!=='function'){renderAlertPage();return}
  evaluating=true;renderAlertPage();
  try{
   let results=await Promise.allSettled([
    window.ViewInvAI.highConvictionRecommendation('tr'),
    window.ViewInvAI.highConvictionRecommendation('us')
   ]);
   let all=results.filter(x=>x.status==='fulfilled'&&x.value).map(x=>x.value);
   all.sort((a,b)=>(b.score||0)-(a.score||0)||(a.mode==='tr'?-1:1));
   lastScan={at:Date.now(),results:all,best:all[0]||null,error:''};
   let candidates=all.filter(x=>x.eligible);
   let best=candidates[0]||null;
   if(!best){state.activeKey=null;saveState();seeded=true;renderAlertPage();return}

   let s=best.s,stock=typeof stockKey==='function'?stockKey(s):(s.tvSymbol||s.ticker||s.trTicker||''),key=best.mode+':'+stock;
   let previous=state.activeKey;state.activeKey=key;
   let last=Number(state.lastFired[key]||0);
   let shouldFire=seeded&&previous!==key&&(!last||Date.now()-last>=ALERT_COOLDOWN_MS);

   if(shouldFire){
    state.lastFired[key]=Date.now();
    let ticker=(best.mode==='tr'&&s.trTicker)||s.ticker||'—';
    let reason=(best.reasons||[]).slice(0,4).join(' · ');
    pushNotice({
     title:'COMPRA · '+ticker,
     message:reason||'Señal de compra con confirmación integral',
     ticker,
     name:s.name||'',
     market:best.mode==='tr'?'Trade Republic / LSX':'EEUU',
     stockKey:stock,
     preferTr:best.mode==='tr',
     score:best.score,
     fingerprint:'buy:'+key+':'+Math.floor(Date.now()/ALERT_COOLDOWN_MS)
    });
   }else saveState();
   seeded=true;
  }catch(e){
   console.warn('High-conviction alert warning',e);
   lastScan={at:Date.now(),results:[],best:null,error:e&&e.message?e.message:'Error de análisis'};
  }finally{evaluating=false;renderAlertPage()}
 }

 function initEvents(){
  q('#notificationBell')?.addEventListener('click',()=>setCenterOpen(!q('#notificationCenter')?.classList.contains('open')));
  q('#notificationClose')?.addEventListener('click',()=>setCenterOpen(false));
  q('#notificationHistory')?.addEventListener('click',()=>{historyMode=!historyMode;renderCenter()});
  q('#notificationClear')?.addEventListener('click',()=>{state.history=[];state.unread=0;historyMode=false;saveState();renderCenter();renderAlertPage()});
  q('#autoAlertHighConviction')?.addEventListener('change',e=>{
   state.enabled=!!e.target.checked;state.activeKey=null;seeded=false;saveState();renderAlertPage();
   if(state.enabled)setTimeout(evaluate,100);
  });
  window.addEventListener('viewinvai:push-received',e=>{
   const raw=e&&e.detail||{},notification=raw.notification||raw||{},data=notification.data||raw.data||{};
   const title=String(notification.title||data.title||'ViewInvAI');
   const message=String(notification.body||notification.message||data.body||'');
   const stockKey=String(data.stockKey||data.stock_key||'');
   const preferTr=String(data.preferTr||data.prefer_tr||'')==='1'||data.preferTr===true;
   pushNotice({
    id:String(data.alertId||data.alert_id||notification.id||uid()),
    kind:String(data.alertType||data.alert_type||'push'),
    severity:String(data.severity||'info'),
    title,
    message,
    ticker:String(data.ticker||''),
    stockKey,
    preferTr,
    market:preferTr?'TR / LSX':'EEUU',
    createdAt:nowIso()
   });
  });
  window.addEventListener('viewinvai:notification-settings',e=>{
   let detail=e&&e.detail||{};
   globalNotifications={
    enabled:detail.enabled!==false,
    newsEvents:detail.newsEvents!==false,
    radarAi:detail.radarAi!==false,
    pulseAi:detail.radarAi!==false
   };
   if(globalNotifications.enabled===false||globalNotifications.radarAi===false){
    state.activeKey=null;seeded=false;saveState();
   }
   renderAlertPage();
   if(globalNotifications.enabled!==false&&globalNotifications.radarAi!==false&&state.enabled)setTimeout(evaluate,100);
  });
  document.addEventListener('click',e=>{
   let item=e.target.closest&&e.target.closest('[data-alert-stock-key]');if(item)openAlertStock(item);
  });
  document.addEventListener('keydown',e=>{
   if(!['Enter',' '].includes(e.key))return;
   let item=e.target.closest&&e.target.closest('[data-alert-stock-key]');if(!item)return;
   e.preventDefault();openAlertStock(item);
  });
 }

 function init(){
  if(window.ViewInvAINotificationSettings&&typeof window.ViewInvAINotificationSettings==='object'){
   globalNotifications=Object.assign(globalNotifications,window.ViewInvAINotificationSettings);
  }
  renderCenter();renderSettings();initEvents();
  setTimeout(evaluate,1800);
  setInterval(()=>{if(!document.hidden)evaluate()},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)evaluate()});
 }

 window.AppAlerts={evaluate,renderSettings,renderAlertPage,pushNotice,setCenterOpen,getHistory:()=>historyRows().slice(),getHistoryDays:()=>HISTORY_DAYS};
 init();
})();
