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
   '<label class="notification-pref-row"><span><b>Noticias y eventos relevantes</b><small>Resultados, regulación, contratos, financiación y catalizadores verificados.</small></span><span class="settings-switch"><input type="checkbox" name="news" checked><span class="settings-switch-track" aria-hidden="true"><span></span></span></span></label>'+
   '<label class="notification-pref-row"><span><b>Entrada en Pulso IA</b><small>Aviso cuando la IA confirme una entrada de alta convicción.</small></span><span class="settings-switch"><input type="checkbox" name="pulse" checked><span class="settings-switch-track" aria-hidden="true"><span></span></span></span></label>'+
   '<label class="notification-pref-row"><span><b>Entrada en Radar</b><small>Aviso cuando pase los criterios de oportunidad del Radar.</small></span><span class="settings-switch"><input type="checkbox" name="radar"><span class="settings-switch-track" aria-hidden="true"><span></span></span></span></label>'+
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
  if(globalStatus)globalStatus.textContent=global&&global.enabled===false?'Notificaciones globales desactivadas: estas preferencias quedan guardadas para cuando vuelvas a activarlas.':'';

  get('news').checked=pref?Number(pref.news_enabled)===1:true;
  get('pulse').checked=pref?Number(pref.pulse_enabled)===1:true;
  get('radar').checked=pref?Number(pref.radar_enabled)===1:false;
  get('priceUp').checked=pref?Number(pref.price_up_enabled)===1:false;
  get('priceDown').checked=pref?Number(pref.price_down_enabled)===1:false;
  get('priceUpStep').value=pref&&pref.price_up_step||3;
  get('priceDownStep').value=pref&&pref.price_down_step||3;
 }
 async function load(){
  if(!current||!api()?.getUser?.()){fill(null);return}
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
  root.ViewInvAIFilterSheet?.open?.('#stockNotificationPanel','Notificaciones · '+(preferTr?(stock.trTicker||stock.ticker):(stock.ticker||stock.trTicker)||''));
 }
 async function save(e){
  e.preventDefault();if(!current)return;
  const f=ensureSource(),stock=current.stock,quote=(current.preferTr
   ?root.ViewInvAI?.getCanonicalQuote?.(stock,true)
   :root.ViewInvAI?.getDisplayQuote?.(stock,false))||{};
  const payload={
   stockKey:current.key,
   ticker:current.preferTr?(stock.trTicker||stock.ticker):(stock.ticker||stock.trTicker),
   name:stock.name||'',
   preferTr:current.preferTr,
   newsEnabled:f.elements.news.checked,
   pulseEnabled:f.elements.pulse.checked,
   radarEnabled:f.elements.radar.checked,
   priceUpEnabled:f.elements.priceUp.checked,
   priceDownEnabled:f.elements.priceDown.checked,
   priceUpStep:Number(f.elements.priceUpStep.value)||3,
   priceDownStep:Number(f.elements.priceDownStep.value)||3,
   anchorPrice:Number(quote.price)||null
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
   anchorPrice:null
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
