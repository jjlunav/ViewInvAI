/* Per-asset push notification preferences. Uses the shared bottom-sheet component. */
(function(root){
 'use strict';
 let current=null,source=null,statusTimer=null;
 const q=s=>document.querySelector(s);
 function ensureSource(){
  if(source)return source;
  source=document.createElement('form');source.id='stockNotificationPanel';source.className='filter-sheet-source stock-notification-source';
  source.innerHTML=
   '<div class="notification-pref-intro"><strong id="stockNotificationName">Notificaciones</strong><span>Elige qué avisos push quieres recibir para este activo.</span><small id="stockNotificationGlobalStatus"></small></div>'+
   '<label class="notification-pref-row"><span><b>Noticias y eventos</b></span><span class="settings-switch"><input type="checkbox" name="news"><span class="settings-switch-track" aria-hidden="true"><span></span></span></span></label>'+
   '<label class="notification-pref-row"><span><b>Radar AI</b><small>Cambios de nivel de este valor en Radar AI. Los niveles que avisan (alta convicción, oportunidades, vigilancia) se eligen en Configuración.</small></span><span class="settings-switch"><input type="checkbox" name="radarAi"><span class="settings-switch-track" aria-hidden="true"><span></span></span></span></label>'+
   '<div class="notification-level-card"><div class="notification-level-head"><b>Niveles de precio</b><small id="stockNotificationNow"></small></div>'+
    '<div class="notification-level-grid">'+
     '<label><span>Avisar si sube a</span><span class="notification-level-input"><input name="priceAbove" type="number" inputmode="decimal" min="0" step="any" placeholder="—"><em data-level-cur>$</em></span></label>'+
     '<label><span>Avisar si baja a</span><span class="notification-level-input"><input name="priceBelow" type="number" inputmode="decimal" min="0" step="any" placeholder="—"><em data-level-cur>$</em></span></label>'+
    '</div><small class="notification-level-note">Un solo aviso por nivel; después se borra. Déjalo vacío para no usarlo.</small></div>'+
   '<div class="notification-price-grid">'+
    '<div class="notification-price-card"><label class="notification-price-switch"><span><b>Subida por tramos</b><small>Activar avisos</small></span><span class="settings-switch"><input type="checkbox" name="priceUp"><span class="settings-switch-track" aria-hidden="true"><span></span></span></span></label><label class="notification-price-step"><input name="priceUpStep" type="number" min="0.5" max="50" step="0.5" value="3"><small>% por aviso</small></label></div>'+
    '<div class="notification-price-card"><label class="notification-price-switch"><span><b>Bajada por tramos</b><small>Activar avisos</small></span><span class="settings-switch"><input type="checkbox" name="priceDown"><span class="settings-switch-track" aria-hidden="true"><span></span></span></span></label><label class="notification-price-step"><input name="priceDownStep" type="number" min="0.5" max="50" step="0.5" value="3"><small>% por aviso</small></label></div>'+
   '</div>'+
   '<p class="notification-pref-note">Los tramos se miden desde el precio al activar el aviso. Si eliges 3%, recibirás un nuevo aviso al cruzar 3%, 6%, 9%… en cada dirección.</p>'+
   '<div class="notification-pref-actions"><button type="button" class="btn ghost" data-notification-disable>Desactivar todas</button><button type="submit" class="btn" data-filter-sheet-apply>Guardar</button></div>'+
   '<div class="notification-pref-status" aria-live="polite"></div>';
  document.body.appendChild(source);
  source.addEventListener('submit',save);
  source.addEventListener('click',e=>{if(e.target.closest('[data-notification-disable]'))disableAll()});
  return source;
 }
 function setStatus(text,error=false){
  let el=source&&source.querySelector('.notification-pref-status');if(!el)return;
  el.textContent=text||'';el.classList.toggle('error',!!error);clearTimeout(statusTimer);
  if(text)statusTimer=setTimeout(()=>{el.textContent=''},3500);
 }
 function api(){return root.ViewInvAIAuth}
 function stockFor(key){return root.ViewInvAI&&root.ViewInvAI.getStockByKey?root.ViewInvAI.getStockByKey(key):null}
 function fill(pref){
  const f=ensureSource(),get=n=>f.elements[n];
  const global=root.ViewInvAINotificationSettings;
  const globalStatus=f.querySelector('#stockNotificationGlobalStatus');
  if(globalStatus)globalStatus.textContent=global&&global.enabled===false?'Notificaciones generales de tu cuenta desactivadas: estas preferencias personales quedarán guardadas para cuando vuelvas a activarlas.':'';

  get('news').checked=pref?Number(pref.news_enabled)===1:false;
  // Pulso IA was merged into Radar AI: either old switch keeps this one on.
  get('radarAi').checked=pref?(Number(pref.radar_enabled)===1||Number(pref.pulse_enabled)===1):false;
  get('priceUp').checked=pref?Number(pref.price_up_enabled)===1:false;
  get('priceDown').checked=pref?Number(pref.price_down_enabled)===1:false;
  get('priceUpStep').value=pref&&pref.price_up_step||3;
  get('priceDownStep').value=pref&&pref.price_down_step||3;
  const lv=v=>{const n=Number(v);return v!==null&&v!==undefined&&v!==''&&Number.isFinite(n)&&n>0?String(n):''};
  get('priceAbove').value=lv(pref&&pref.price_above);
  get('priceBelow').value=lv(pref&&pref.price_below);
 }
 function quoteFor(){
  if(!current)return{};
  return (current.preferTr
   ?root.ViewInvAI?.getCanonicalQuote?.(current.stock,true)
   :root.ViewInvAI?.getDisplayQuote?.(current.stock,false))||{};
 }
 function fmtLevel(v){const n=Number(v);return Number.isFinite(n)?n.toLocaleString('es-ES',{maximumFractionDigits:n<10?4:2}):'—'}
 function paintLevelContext(){
  const f=ensureSource(),cur=current&&current.preferTr?'€':'$',price=Number(quoteFor().price);
  f.querySelectorAll('[data-level-cur]').forEach(el=>{el.textContent=cur});
  const now=f.querySelector('#stockNotificationNow');
  if(now)now.textContent=Number.isFinite(price)&&price>0?'Ahora '+fmtLevel(price)+' '+cur+(current.preferTr?' · LSX':''):'';
 }
 function levelValue(input){const n=Number(String(input.value||'').replace(',','.'));return input.value!==''&&Number.isFinite(n)&&n>0?n:null}
 async function load(){
  if(!current||!api()?.getUser?.()){fill(null);return}
  // No saved row for this user + asset means all switches OFF.
  try{
   const r=await api().apiFetch('/api/notification-preferences?stockKey='+encodeURIComponent(current.key)+'&preferTr='+(current.preferTr?'1':'0'));
   const d=await r.json().catch(()=>({}));fill(d.preferences&&d.preferences[0]||null);
  }catch(_){fill(null)}
 }
 async function open(button){
  const key=button.dataset.stockNotifications,preferTr=button.dataset.stockNotificationsTr==='1',stock=stockFor(key);
  if(!key||!stock)return;
  if(!api()?.getUser?.()){
   await api()?.signIn?.();
   if(!api()?.getUser?.())return;
  }
  current={key,preferTr,stock};
  ensureSource();
  q('#stockNotificationName').textContent='🔔 '+(stock.name||stock.ticker||'Activo');
  await load();
  paintLevelContext();
  root.ViewInvAIFilterSheet?.open?.('#stockNotificationPanel','Notificaciones · '+(preferTr?(stock.trTicker||stock.ticker):(stock.ticker||stock.trTicker)||''));
 }
 async function save(e){
  e.preventDefault();if(!current)return;
  const f=ensureSource(),stock=current.stock,quote=quoteFor();
  const above=levelValue(f.elements.priceAbove),below=levelValue(f.elements.priceBelow),now=Number(quote.price);
  if(above!==null&&below!==null&&below>=above){setStatus('El nivel de bajada debe ser menor que el de subida.',true);return}
  if(above!==null&&Number.isFinite(now)&&now>0&&above<=now){setStatus('El nivel de subida ya está por debajo del precio actual ('+fmtLevel(now)+').',true);return}
  if(below!==null&&Number.isFinite(now)&&now>0&&below>=now){setStatus('El nivel de bajada ya está por encima del precio actual ('+fmtLevel(now)+').',true);return}
  const payload={
   stockKey:current.key,
   ticker:current.preferTr?(stock.trTicker||stock.ticker):(stock.ticker||stock.trTicker),
   name:stock.name||'',
   preferTr:current.preferTr,
   newsEnabled:f.elements.news.checked,
   pulseEnabled:f.elements.radarAi.checked,
   radarEnabled:f.elements.radarAi.checked,
   priceUpEnabled:f.elements.priceUp.checked,
   priceDownEnabled:f.elements.priceDown.checked,
   priceUpStep:Number(f.elements.priceUpStep.value)||3,
   priceDownStep:Number(f.elements.priceDownStep.value)||3,
   anchorPrice:Number(quote.price)||null,
   priceAbove:above,
   priceBelow:below
  };
  try{
   await api().ensurePushRegistration?.(true);
   const r=await api().apiFetch('/api/notification-preferences',{method:'POST',body:JSON.stringify(payload)});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(d.error||'No se pudieron guardar los avisos.');
   setStatus('Notificaciones guardadas');
   setTimeout(()=>root.ViewInvAIFilterSheet?.close?.(),450);
  }catch(err){setStatus(err.message||'No se pudieron guardar los avisos.',true)}
 }
 async function disableAll(){
  if(!current)return;
  const f=ensureSource(),stock=current.stock;
  const payload={
   stockKey:current.key,
   ticker:current.preferTr?(stock.trTicker||stock.ticker):(stock.ticker||stock.trTicker),
   name:stock.name||'',
   preferTr:current.preferTr,
   newsEnabled:false,
   pulseEnabled:false,
   radarEnabled:false,
   priceUpEnabled:false,
   priceDownEnabled:false,
   priceUpStep:Number(f.elements.priceUpStep.value)||3,
   priceDownStep:Number(f.elements.priceDownStep.value)||3,
   anchorPrice:null,
   priceAbove:null,
   priceBelow:null
  };
  try{
   const r=await api().apiFetch('/api/notification-preferences',{method:'POST',body:JSON.stringify(payload)});
   const d=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(d.error||'No se pudieron desactivar.');
   fill(d.preference||{news_enabled:0,pulse_enabled:0,radar_enabled:0,price_up_enabled:0,price_down_enabled:0,price_up_step:payload.priceUpStep,price_down_step:payload.priceDownStep});
   setStatus('Notificaciones desactivadas');
  }catch(err){setStatus(err.message||'No se pudieron desactivar.',true)}
 }
 document.addEventListener('click',e=>{
  const b=e.target.closest&&e.target.closest('[data-stock-notifications]');
  if(b){e.preventDefault();e.stopPropagation();open(b)}
 });
 root.ViewInvAIStockNotifications={open};
})(window);
