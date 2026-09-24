(function(){
 'use strict';

 const STORAGE_KEY='viewinvai:alerts:v2';
 const LEGACY_KEYS=['viewinvai:alerts:v1','catalystpulse:alerts:v1'];
 const MAX_HISTORY=60;
 const AUTO_HIDE_MS=6500;
 const ALERT_COOLDOWN_MS=6*60*60*1000;

 let centerTimer=null;
 let evaluating=false;
 let seeded=false;
 let state=readState();

 function q(s){return document.querySelector(s)}
 function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
 function nowIso(){return new Date().toISOString()}
 function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
 function fmt(v,d=0){let n=Number(v);return Number.isFinite(n)?n.toLocaleString('es-ES',{maximumFractionDigits:d}):'—'}

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
    base.history=raw.history.filter(x=>x&&x.kind==='recommendation').slice(0,MAX_HISTORY).map(x=>({
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
   state.history=state.history.slice(0,MAX_HISTORY);
   localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
  }catch(_){}
 }

 function formatTime(value){
  let d=new Date(value||Date.now());
  return isNaN(d)?'':d.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
 }

 function renderCenter(){
  let list=q('#notificationList'),badge=q('#notificationBadge'),status=q('#notificationStatus');
  if(!list||!badge||!status)return;
  badge.textContent=String(Math.min(99,state.unread||0));
  badge.classList.toggle('is-hidden',!(state.unread>0));
  status.textContent=state.unread>0?(state.unread+' sin leer'):(state.history.length?state.history.length+' guardados':'Sin avisos nuevos');
  list.innerHTML=state.history.length?state.history.map(item=>{
   let actionable=item.stockKey?' actionable" role="button" tabindex="0" data-alert-stock-key="'+esc(item.stockKey)+'" data-alert-prefer-tr="'+(item.preferTr?'1':'0'):'"';
   let name=item.name?'<div class="notification-stock-name">'+esc(item.name)+'</div>':'';
   let meta=[item.ticker,item.market,item.score?('convicción '+fmt(item.score,0)+'/100'):''].filter(Boolean).join(' · ');
   return '<article class="notification-item recommendation'+actionable+'>'+
    '<div class="notification-item-head"><strong>'+esc(item.title||'COMPRA')+'</strong><time>'+esc(formatTime(item.createdAt))+'</time></div>'+
    name+'<p>'+esc(item.message||'')+'</p><small>'+esc(meta)+(item.stockKey?' · Toca para abrir análisis':'')+'</small>'+
   '</article>';
  }).join(''):'<div class="notification-empty">No hay compras de alta convicción recientes.</div>';
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
  state.history.unshift(item);state.unread=(state.unread||0)+1;saveState();renderCenter();setCenterOpen(true,{auto:true});
 }

 function renderSettings(){
  let el=q('#autoAlertHighConviction');if(el)el.checked=state.enabled!==false;
 }

 function openAlertStock(el){
  let key=el&&el.dataset&&el.dataset.alertStockKey;if(!key)return;
  let preferTr=el.dataset.alertPreferTr==='1';
  if(window.ViewInvAI&&typeof window.ViewInvAI.openStockByKey==='function'){
   let opened=window.ViewInvAI.openStockByKey(key,'Aviso · compra de alta convicción',preferTr);
   if(opened){state.unread=0;saveState();renderCenter();setCenterOpen(false)}
  }
 }

 async function evaluate(){
  if(evaluating||!state.enabled)return;
  if(!window.ViewInvAI||typeof window.ViewInvAI.highConvictionRecommendation!=='function')return;
  evaluating=true;
  try{
   let results=await Promise.allSettled([
    window.ViewInvAI.highConvictionRecommendation('tr'),
    window.ViewInvAI.highConvictionRecommendation('us')
   ]);
   let candidates=results.filter(x=>x.status==='fulfilled'&&x.value&&x.value.eligible).map(x=>x.value);
   candidates.sort((a,b)=>(b.score||0)-(a.score||0)||(a.mode==='tr'?-1:1));
   let best=candidates[0]||null;
   if(!best){state.activeKey=null;saveState();seeded=true;return}

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
  }catch(e){console.warn('High-conviction alert warning',e)}
  finally{evaluating=false}
 }

 function initEvents(){
  q('#notificationBell')?.addEventListener('click',()=>setCenterOpen(!q('#notificationCenter')?.classList.contains('open')));
  q('#notificationClose')?.addEventListener('click',()=>setCenterOpen(false));
  q('#notificationClear')?.addEventListener('click',()=>{state.history=[];state.unread=0;saveState();renderCenter()});
  q('#autoAlertHighConviction')?.addEventListener('change',e=>{
   state.enabled=!!e.target.checked;state.activeKey=null;seeded=false;saveState();
   if(state.enabled)setTimeout(evaluate,100);
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
  renderCenter();renderSettings();initEvents();
  setTimeout(evaluate,1800);
  setInterval(()=>{if(!document.hidden)evaluate()},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)evaluate()});
 }

 window.AppAlerts={evaluate,renderSettings,pushNotice,setCenterOpen};
 init();
})();