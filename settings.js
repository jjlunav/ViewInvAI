/*
 * ViewInvAI settings
 * ------------------
 * Theme, device behavior, push status and account-synchronized analysis settings.
 */

const THEME_KEY='viewinvai:theme:v1';

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
 const native=window.ViewInvAIAuth?.isNative?.()===true||document.documentElement.dataset.nativeApp==='1';
 const card=$('#screenWakeSettingsCard');if(card)card.hidden=!native;
 if(!native)return;
 let toggle=$('#keepScreenAwake');if(toggle)toggle.checked=!!deviceSettings.keepScreenAwake;
 if(!deviceSettings.keepScreenAwake){setWakeLockStatus('Desactivado');return}
 if(!('wakeLock' in navigator)||!navigator.wakeLock||typeof navigator.wakeLock.request!=='function'){setWakeLockStatus('No compatible','error');return}
 if(screenWakeLock&&!screenWakeLock.released)setWakeLockStatus('Activo','active');
 else if(document.visibilityState!=='visible')setWakeLockStatus('En pausa');
 else setWakeLockStatus('Pendiente de activar');
}

let pushBackendConfigured=null,pushDeviceRegistered=null,backendSourceStatus=null,accountAnalysisSettings=null,analysisSettingsBusy=false;
function sourceStatusText(source,key){
 if(backendSourceStatus&&backendSourceStatus.error)return{label:'Sin conexión',mode:'error',title:'No se pudo consultar el estado del backend.'};
 if(!source)return{label:'Sin información',mode:'pending',title:'No hay datos de estado disponibles.'};
 if(source.configured===false){
  const required=String(source.requiredConfig||'').trim();
  return{label:'Sin configurar',mode:'pending',title:required?'Falta configuración: '+required:'La integración requiere configuración adicional.'};
 }
 if(key==='tradeRepublic'&&source.live===false){
  return{label:'Sin precios',mode:'error',title:'Trade Republic no devuelve cotizaciones'+(source.liveError?': '+source.liveError:'.')};
 }
 if(key==='fda'&&source.enhancedConfig===false){
  return{label:'Operativa',mode:'active',title:'Fuente pública operativa. La clave openFDA es opcional y solo amplía capacidad.'};
 }
 return{label:'Operativa',mode:'active',title:'Integración disponible y configurada.'};
}
function renderSourceSettingsStatus(){
 const sources=backendSourceStatus&&backendSourceStatus.sources||{};
 const native=window.ViewInvAIAuth?.isNative?.()===true;
 const pushRow=$('#sourceStatusPushRow');
 if(pushRow)pushRow.hidden=false;
 const rows={
  sourceStatusTradeRepublic:'tradeRepublic',
  sourceStatusNasdaq:'nasdaq',
  sourceStatusSec:'sec',
  sourceStatusClinical:'clinicalTrials',
  sourceStatusFda:'fda',
  sourceStatusPush:'push'
 };
 for(const [id,key] of Object.entries(rows)){
  const el=$('#'+id);if(!el)continue;
  const info=sourceStatusText(sources[key],key);
  el.textContent=info.label;
  el.title=info.title||'';
  el.classList.toggle('active',info.mode==='active');
  el.classList.toggle('pending',info.mode==='pending');
  el.classList.toggle('error',info.mode==='error');
 }
 const cadence=$('#sourceStatusCadence');
 if(cadence){
  const minutes=Number(backendSourceStatus&&backendSourceStatus.alertsCadenceMinutes);
  const updated=new Date(backendSourceStatus&&backendSourceStatus.updatedAt||0);
  const stamp=Number.isFinite(updated.getTime())&&updated.getTime()>0?updated.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'';
  cadence.textContent=(stamp?'Comprobado '+stamp:'')+(Number.isFinite(minutes)&&minutes>0?(stamp?' · ':'')+'barrido '+minutes+' min':'');
 }
}
async function refreshPushBackendStatus(){
 try{
  const response=await fetch('/api/backend/status',{cache:'no-store'});
  if(!response.ok)return;
  backendSourceStatus=await response.json();
  pushBackendConfigured=backendSourceStatus&&backendSourceStatus.push===true;
  // Trade Republic status comes from a real quote check, not from configuration alone.
  try{
   const tr=await fetch('/api/tr-health',{cache:'no-store'});
   const health=tr.ok?await tr.json():{ok:false,error:'HTTP '+tr.status};
   if(backendSourceStatus.sources&&backendSourceStatus.sources.tradeRepublic)Object.assign(backendSourceStatus.sources.tradeRepublic,{live:health.ok===true,liveError:health.error||''});
  }catch(_){if(backendSourceStatus.sources&&backendSourceStatus.sources.tradeRepublic)backendSourceStatus.sources.tradeRepublic.live=false}
 }catch(_){
  backendSourceStatus={error:true,sources:{},updatedAt:new Date().toISOString()};pushBackendConfigured=false;
 }
 renderPushSettingsStatus();
 renderSourceSettingsStatus();
 renderAnalysisSettings(accountAnalysisSettings);
}
async function refreshPushDeviceStatus(){
 const auth=window.ViewInvAIAuth;
 if(!auth?.getUser?.()){pushDeviceRegistered=null;renderPushSettingsStatus();return}
 const platform=auth.isNative?.()===true?'android':'web';
 try{
  const response=await auth.apiFetch('/api/devices');
  const data=await response.json().catch(()=>({}));
  pushDeviceRegistered=response.ok&&Array.isArray(data.devices)&&data.devices.some(device=>Number(device.enabled)!==0&&String(device.platform||'').toLowerCase()===platform);
 }catch(_){pushDeviceRegistered=false}
 renderPushSettingsStatus();
}
// Motivo legible del último fallo de registro push (en vez de un «No disponible» genérico).
let lastPushProblem='';
function pushProblemText(detail){
 if(!detail)return'';
 const android=String(detail.platform||'')==='android';
 if(android&&(detail.permission==='denied'||detail.permission==='prompt'||detail.permission==='prompt-with-rationale'))return'Las notificaciones de ViewInvAI están desactivadas en Android: actívalas en Ajustes del teléfono › Aplicaciones › ViewInvAI › Notificaciones y vuelve a probar.';
 if(detail.permission==='denied')return'Las notificaciones están bloqueadas para esta web: permítelas en el candado de la barra de direcciones y vuelve a probar.';
 if(detail.permission==='default')return'El navegador no ha concedido permiso para notificaciones.';
 const raw=String(detail.error||'');
 if(!raw)return'';
 if(/permission-blocked|permission.*denied|NotAllowedError/i.test(raw))return'Las notificaciones están bloqueadas para esta web: permítelas en el candado de la barra de direcciones y vuelve a probar.';
 if(/push service|AbortError|Registration failed|token-subscribe-failed|unsupported-browser/i.test(raw))return'Este navegador no ofrece servicio push (pasa en Brave, Opera o en modo privado). Prueba con Chrome, Edge o Firefox. Detalle: '+raw.slice(0,140);
 if(/service ?worker/i.test(raw))return'No se pudo activar el servicio de avisos del navegador. Detalle: '+raw.slice(0,140);
 return raw.slice(0,200);
}
function renderPushSettingsStatus(detail=null){
 if(detail&&detail.enabled===false)lastPushProblem=pushProblemText(detail);else if(detail&&detail.enabled===true)lastPushProblem='';
 const status=$('#pushNotificationStatus'),row=$('#pushDeviceStatusRow'),actions=$('#pushDeviceActionsRow'),label=$('#pushDeviceStatusLabel');
 if(!status)return;
 status.classList.remove('active','pending','error');
 const auth=window.ViewInvAIAuth;
 if(row)row.hidden=false;
 if(actions)actions.hidden=false;
 if(!auth){status.textContent='Comprobando…';return}
 const native=auth.isNative?.()===true;
 if(label)label.textContent=native?'Push en este dispositivo':'Notificaciones del navegador';
 if(!auth.getUser?.()){status.textContent='Inicia sesión';return}
 if(native&&!auth.hasNativeMessaging?.()){status.textContent='APK pendiente de actualizar';status.classList.add('pending');return}
 if(!native&&!auth.hasWebPush?.()){status.textContent='Navegador no compatible';status.classList.add('error');return}
 const permission=native?String(detail&&detail.permission||''):String(window.Notification&&Notification.permission||'default');
 if(detail&&detail.permission==='denied'||permission==='denied'){
  status.textContent='Permiso denegado';status.classList.add('error');return;
 }
 if(detail&&detail.error){
  status.textContent=pushProblemText(detail)||'No disponible';status.title=String(detail.error||'');status.classList.add('error');return;
 }
 if(detail&&detail.enabled===true){
  pushDeviceRegistered=true;
  status.textContent=pushBackendConfigured===false?'Registrado · servidor pendiente':'Activo en este dispositivo';
  status.classList.add(pushBackendConfigured===false?'pending':'active');
  return;
 }
 if(pushBackendConfigured===false){
  status.textContent=pushDeviceRegistered?'Registrado · servidor pendiente':'Servidor push sin configurar';
  status.classList.add('pending');
 }else if(pushDeviceRegistered===true){
  status.textContent='Activo en este dispositivo';status.classList.add('active');
 }else if(pushDeviceRegistered===false){
  status.textContent=permission==='granted'?'Permiso concedido · falta registrar':'Sin activar en este dispositivo';
  status.classList.add('pending');
 }else{
  status.textContent=permission==='granted'?'Preparado':'Sin activar en este dispositivo';
  status.classList.add('pending');
 }
}
async function retryPushRegistration(){
 const auth=window.ViewInvAIAuth;
 if(!auth?.ensurePushRegistration)return false;
 try{
  const enabled=!!(await auth.ensurePushRegistration(true));
  renderPushSettingsStatus({enabled});
  await refreshPushDeviceStatus();
  return enabled;
 }catch(error){
  renderPushSettingsStatus({enabled:false,error:String(error&&error.message||error)});
  return false;
 }
}
async function testPushNotification(){
 const auth=window.ViewInvAIAuth,button=$('#testPushNotification'),status=$('#pushNotificationStatus');
 if(!auth?.getUser?.()){if(status)status.textContent='Inicia sesión';return}
 if(pushBackendConfigured===false){if(status){status.textContent='Servidor push pendiente';status.classList.add('pending');status.classList.remove('error')}return}
 if(button){button.textContent='Enviando…'}
 try{
  if(!(await auth.ensurePushRegistration?.(true)))throw Error(lastPushProblem||'No se pudo registrar el dispositivo.');
  const response=await auth.apiFetch('/api/devices/test',{method:'POST',body:'{}'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'La prueba push ha fallado.');
  if(status){status.textContent='Prueba enviada';status.classList.add('active');status.classList.remove('error','pending')}
 }catch(error){
  if(status){status.textContent=error&&error.message?error.message:'La prueba push ha fallado.';status.classList.add('error');status.classList.remove('active','pending')}
 }finally{if(button){button.textContent='Enviar prueba'}}
}
// «Enviar ahora»: el resumen diario al momento, para ver cómo llega al móvil o al reloj.
async function sendDigestNow(){
 const auth=window.ViewInvAIAuth,button=$('#sendDigestNow'),status=$('#digestStatus');
 if(!auth?.apiFetch||!button)return;
 button.disabled=true;if(status){status.textContent='Preparando…';status.classList.remove('error')}
 try{
  const response=await auth.apiFetch('/api/devices/digest',{method:'POST',body:'{}'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'No se pudo enviar el resumen.');
  if(status)status.textContent=data.sent?'Enviado':'Guardado en Avisos (sin dispositivo activo)';
 }catch(error){if(status){status.textContent=error&&error.message||'No se pudo enviar el resumen.';status.classList.add('error')}}
 finally{button.disabled=false}
}
function renderAnalysisSettings(settings=null){
 accountAnalysisSettings=settings&&typeof settings==='object'?settings:null;
 const enabled=accountAnalysisSettings?Number(accountAnalysisSettings.notifications_enabled)===1:false;
 const newsEvents=accountAnalysisSettings?Number(accountAnalysisSettings.notify_news_events)===1:false;
 const catalystEve=accountAnalysisSettings?Number(accountAnalysisSettings.notify_catalyst_eve)===1:false;
 const radarHigh=accountAnalysisSettings?Number(accountAnalysisSettings.notify_radar_high)===1:false;
 const radarOpportunity=accountAnalysisSettings?Number(accountAnalysisSettings.notify_radar_opportunity)===1:false;
 const radarWatch=accountAnalysisSettings?Number(accountAnalysisSettings.notify_radar_watch)===1:false;
 const radar=radarHigh||radarOpportunity||radarWatch,pulseAi=false;
 const price=accountAnalysisSettings?Number(accountAnalysisSettings.notify_price)===1:false;
 const radarAi=radar;
 const portfolio=accountAnalysisSettings?Number(accountAnalysisSettings.notify_portfolio)===1:false;
 const portfolioGoal=accountAnalysisSettings?Number(accountAnalysisSettings.notify_portfolio_goal)===1:false;
 const dailyDigest=accountAnalysisSettings?Number(accountAnalysisSettings.daily_digest_enabled)!==0:false;
 const toggles={globalDailyDigest:dailyDigest,globalNotificationsEnabled:enabled,globalNotifyNewsEvents:newsEvents,globalNotifyCatalystEve:catalystEve,globalNotifyRadarHigh:radarHigh,globalNotifyRadarOpportunity:radarOpportunity,globalNotifyRadarWatch:radarWatch,globalNotifyPrice:price,globalNotifyPortfolio:portfolio,globalNotifyPortfolioGoal:portfolioGoal};
 for(const [id,checked] of Object.entries(toggles)){
  const el=$('#'+id);if(!el)continue;
  el.checked=checked;
  el.disabled=!accountAnalysisSettings||analysisSettingsBusy||(id!=='globalNotificationsEnabled'&&!enabled);
 }
 for(const [id,key,fallback] of [['digestMorningTime','digest_morning','08:00'],['digestEveningTime','digest_evening','22:00']]){
  const el=$('#'+id);if(!el)continue;
  if(document.activeElement!==el)el.value=accountAnalysisSettings?String(accountAnalysisSettings[key]??fallback):fallback;
  el.disabled=!accountAnalysisSettings||analysisSettingsBusy||!enabled||!dailyDigest;
 }
 const digestNow=$('#sendDigestNow');
 if(digestNow)digestNow.disabled=!accountAnalysisSettings||analysisSettingsBusy||!enabled;
 document.querySelectorAll('[data-notification-child-setting]').forEach(row=>row.classList.toggle('is-disabled',!enabled));
 const globalStatus=$('#globalNotificationSettingsStatus');
 if(globalStatus){
  globalStatus.classList.remove('active','pending','error');
  globalStatus.textContent=!accountAnalysisSettings?'Inicia sesión':analysisSettingsBusy?'Guardando…':enabled?'Activadas':'Desactivadas';
  if(accountAnalysisSettings&&enabled&&!analysisSettingsBusy)globalStatus.classList.add('active');
 }
 if(accountAnalysisSettings){
  window.ViewInvAINotificationSettings={enabled,newsEvents,catalystEve,radarAi,pulseAi,radar,radarHigh,radarOpportunity,radarWatch,price,portfolio,portfolioGoal};
  window.dispatchEvent(new CustomEvent('viewinvai:notification-settings',{detail:{enabled,newsEvents,catalystEve,radarAi,pulseAi,radar,radarHigh,radarOpportunity,radarWatch,price,portfolio,portfolioGoal}}));
 }else window.ViewInvAINotificationSettings=null;
 const test=$('#testPushNotification');
 if(test)test.disabled=!accountAnalysisSettings||!enabled||pushBackendConfigured===false||analysisSettingsBusy;
}
async function saveAnalysisSettings(){
 if(analysisSettingsBusy||!accountAnalysisSettings||!window.ViewInvAIAuth?.apiFetch)return;
 const body={
  notificationsEnabled:$('#globalNotificationsEnabled')?.checked===true,
  notifyNewsEvents:$('#globalNotifyNewsEvents')?.checked===true,
  notifyCatalystEve:$('#globalNotifyCatalystEve')?.checked===true,
  notifyRadarHigh:$('#globalNotifyRadarHigh')?.checked===true,
  notifyRadarOpportunity:$('#globalNotifyRadarOpportunity')?.checked===true,
  notifyRadarWatch:$('#globalNotifyRadarWatch')?.checked===true,
  notifyPrice:$('#globalNotifyPrice')?.checked===true,
  notifyPortfolio:$('#globalNotifyPortfolio')?.checked===true,
  notifyPortfolioGoal:$('#globalNotifyPortfolioGoal')?.checked===true,
  dailyDigest:$('#globalDailyDigest')?.checked===true,
  digestMorning:$('#digestMorningTime')?.value||'',
  digestEvening:$('#digestEveningTime')?.value||''
 };
 analysisSettingsBusy=true;renderAnalysisSettings(accountAnalysisSettings);
 try{
  const response=await window.ViewInvAIAuth.apiFetch('/api/settings',{method:'PATCH',body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'No se pudieron guardar las notificaciones.');
  accountAnalysisSettings=data.settings||accountAnalysisSettings;
 }catch(e){
  const status=$('#globalNotificationSettingsStatus');
  if(status){status.textContent=e&&e.message?e.message:'No se pudieron guardar';status.classList.add('error')}
 }finally{analysisSettingsBusy=false;renderAnalysisSettings(accountAnalysisSettings)}
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

function readTheme(){
 try{
  let saved=localStorage.getItem(THEME_KEY);
  if(saved==='light'||saved==='dark')return saved;
 }catch(_){}
 return 'dark';
}
function currentTheme(){return document.documentElement.dataset.theme==='light'?'light':'dark'}
function updateThemeButton(){
 let theme=currentTheme();
 document.querySelectorAll('[data-theme-setting]').forEach(button=>{
  let active=button.dataset.themeSetting===theme;
  button.classList.toggle('active',active);
  button.setAttribute('aria-pressed',active?'true':'false');
 });
}
function refreshVisibleChartThemes(){
 document.querySelectorAll('.tv-advanced-chart').forEach(el=>{
  if(!(el.dataset.loaded==='1'||el.querySelector('.tradingview-widget-container')||el.querySelector('.tr-native-chart')))return;
  let s=stockByKey(el.dataset.stockKey);
  if(el.dataset.chartMarket==='tr'&&el.dataset.trRange&&s){
   let range=el.dataset.trRange||'1d';
   loadTrChartHistory(s,range).then(data=>renderTrNativeChart(el,s,data,range)).catch(()=>{});
   return;
  }
  renderTradingViewChart(el,'us');
 });
}
function applyTheme(theme,rerenderCharts=true){
 let next=theme==='light'?'light':'dark',changed=document.documentElement.dataset.theme!==next;
 document.documentElement.dataset.theme=next;
 try{localStorage.setItem(THEME_KEY,next)}catch(_){}
 updateThemeButton();
 if(rerenderCharts)requestAnimationFrame(refreshVisibleChartThemes);
 if(changed)window.dispatchEvent(new CustomEvent('viewinvai:theme-changed',{detail:{theme:next}}));
}

const SETTINGS_SECTION_KEY='viewinvai:settings-section:v1';
function selectSettingsSection(name='general',persist=true){
 const allowed=['general','notifications','services','data','help'];
 const next=allowed.includes(name)?name:'general';
 document.querySelectorAll('[data-settings-section]').forEach(button=>{
  const active=button.dataset.settingsSection===next;
  button.classList.toggle('active',active);
  button.setAttribute('aria-current',active?'page':'false');
 });
 document.querySelectorAll('[data-settings-panel]').forEach(panel=>{
  const active=panel.dataset.settingsPanel===next;
  panel.classList.toggle('active',active);
  panel.hidden=!active;
 });
 if(persist){try{localStorage.setItem(SETTINGS_SECTION_KEY,next)}catch(_){}}
 requestAnimationFrame(()=>window.ViewInvAIShell?.resetChrome?.());
}
function initSettingsNavigation(){
 let initial='general';
 try{initial=localStorage.getItem(SETTINGS_SECTION_KEY)||'general'}catch(_){}
 selectSettingsSection(initial,false);
 document.querySelectorAll('[data-settings-section]').forEach(button=>button.addEventListener('click',()=>selectSettingsSection(button.dataset.settingsSection)));
 window.addEventListener('viewinvai:view-changed',e=>{
  if(e.detail&&e.detail.view==='settings')selectSettingsSection((()=>{try{return localStorage.getItem(SETTINGS_SECTION_KEY)||'general'}catch(_){return'general'}})(),false);
 });
}

function initSettings(){
 applyTheme(readTheme(),false);
 syncDeviceSettingsUi();
 syncScreenWakeLock();
 initSettingsNavigation();

 document.querySelectorAll('[data-theme-setting]').forEach(button=>button.addEventListener('click',()=>{
  applyTheme(button.dataset.themeSetting==='light'?'light':'dark',true);
 }));
 // Diseño de la interfaz (ViewInvAI o clásico). Cambia al momento; la barra inferior se vuelve a montar.
 const syncDesignButtons=()=>document.querySelectorAll('[data-design-setting]').forEach(b=>{const on=b.dataset.designSetting===(document.documentElement.dataset.design||'d');b.classList.toggle('active',on);b.setAttribute('aria-pressed',on?'true':'false')});
 syncDesignButtons();
 document.querySelectorAll('[data-design-setting]').forEach(button=>button.addEventListener('click',()=>{
  const design=button.dataset.designSetting==='classic'?'classic':'d';
  try{localStorage.setItem('viewinvai:design:v1',design)}catch(_){}
  document.documentElement.dataset.design=design;syncDesignButtons();
  if(typeof rebuildNavigation==='function')rebuildNavigation();
 }));

 $('#testPushNotification')?.addEventListener('click',testPushNotification);
 $('#globalNotificationsEnabled')?.addEventListener('change',async event=>{
  await saveAnalysisSettings();
  if(event.target.checked)await retryPushRegistration();
  renderPushSettingsStatus();
 });
 ['globalNotifyNewsEvents','globalNotifyCatalystEve','globalNotifyRadarHigh','globalNotifyRadarOpportunity','globalNotifyRadarWatch','globalNotifyPrice','globalNotifyPortfolio','globalNotifyPortfolioGoal','globalDailyDigest','digestMorningTime','digestEveningTime'].forEach(id=>$('#'+id)?.addEventListener('change',saveAnalysisSettings));
 $('#sendDigestNow')?.addEventListener('click',sendDigestNow);

 window.addEventListener('viewinvai:push-status',e=>renderPushSettingsStatus(e.detail||null));
 window.addEventListener('viewinvai:account-ready',e=>{
  syncDeviceSettingsUi();
  renderAnalysisSettings(e.detail&&e.detail.settings||null);
  renderPushSettingsStatus();
  refreshPushDeviceStatus();
 });
 window.addEventListener('viewinvai:auth-changed',e=>{
  if(!(e.detail&&e.detail.user)){renderAnalysisSettings(null);pushDeviceRegistered=null}
  renderPushSettingsStatus();
  if(e.detail&&e.detail.user)refreshPushDeviceStatus();
 });

 let keepScreenAwakeToggle=$('#keepScreenAwake');
 if(keepScreenAwakeToggle)keepScreenAwakeToggle.addEventListener('change',e=>{
  deviceSettings.keepScreenAwake=!!e.target.checked;
  saveDeviceSettings();
  syncScreenWakeLock();
 });

 renderAnalysisSettings(null);
 renderPushSettingsStatus();
 refreshPushBackendStatus();
 setTimeout(()=>{
  renderPushSettingsStatus();
  renderSourceSettingsStatus();
  refreshPushBackendStatus();
 },700);
}


/* Administración (solo la cuenta propietaria): pantalla integrada, con secciones como Configuración.
 * Inventario de servicios con enlaces, uso de hoy y del mes, prueba de conexión de cada clave y
 * consumo de Cloudflare. Las claves nunca se muestran. */
(function(){
 const auth=()=>window.ViewInvAIAuth;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=n=>Number(n||0).toLocaleString('es-ES');
 const SECTIONS=['summary','ai','search','market','infra','app','creds','docs'];
 const SECTION_KEY='viewinvai:admin-section:v1';
 let checked=false,isAdmin=false,loading=false,last=null;
 async function api(path){const a=auth();const r=await a.apiFetch(path);const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(d.error||('Error '+r.status)),{status:r.status});return d}
 async function detectAdmin(){
  const a=auth();
  if(checked||!a||typeof a.apiFetch!=='function'||(typeof a.getUser==='function'&&!a.getUser()))return;
  checked=true;
  try{await api('/api/admin?lite=1');isAdmin=true;const b=document.getElementById('accountAdmin');if(b)b.hidden=false;if(currentView()==='admin'){selectSection(savedSection(),false);load(false)}}catch(_){isAdmin=false;if(currentView()==='admin'){try{show('today')}catch(__){}}}
 }
 // Solo se sale de la pantalla cuando la sesión ya se ha resuelto (evento de Firebase) y no hay usuario.
 ['viewinvai:account-ready','viewinvai:auth-changed'].forEach(n=>window.addEventListener(n,()=>{checked=false;isAdmin=false;last=null;const b=document.getElementById('accountAdmin');if(b)b.hidden=true;
  setTimeout(()=>{const a=auth();if(a&&typeof a.getUser==='function'&&!a.getUser()&&currentView()==='admin'){try{show('today')}catch(_){}}detectAdmin()},300)}));
 setTimeout(detectAdmin,1500);
 function currentView(){try{return state.currentView}catch(_){return''}}
 function selectSection(name,persist=true){
  const next=SECTIONS.includes(name)?name:'summary';
  document.querySelectorAll('[data-admin-section]').forEach(b=>{const on=b.dataset.adminSection===next;b.classList.toggle('active',on);b.setAttribute('aria-current',on?'page':'false')});
  document.querySelectorAll('[data-admin-panel]').forEach(p=>{const on=p.dataset.adminPanel===next;p.classList.toggle('active',on);p.hidden=!on});
  if(next==='docs'){const el=document.querySelector('[data-admin-panel="docs"]');if(el&&!el.innerHTML.trim())el.innerHTML=docsHtml(last||{})}
  if(next==='creds')loadCreds();
  if(persist){try{localStorage.setItem(SECTION_KEY,next)}catch(_){}}
  requestAnimationFrame(()=>window.ViewInvAIShell?.resetChrome?.());
 }
 function savedSection(){try{return localStorage.getItem(SECTION_KEY)||'summary'}catch(_){return'summary'}}
 function bar(used,limit){if(!limit)return'';const pct=Math.min(100,Math.round(used/limit*100));return '<div class="admin-bar" title="'+pct+' %"><i data-pct="'+pct+'" class="'+(pct>=85?'hot':pct>=60?'warm':'')+'"></i></div>'}
 const heading=(kicker,title,text)=>'<div class="settings-section-heading"><span>'+esc(kicker)+'</span><h2>'+esc(title)+'</h2>'+(text?'<p>'+text+'</p>':'')+'</div>';
 const status=p=>!p.configured?'<b class="admin-st warn">⚠️ sin clave</b>':p.cooldownUntil?'<b class="admin-st warn">⏸ en pausa (cupo)</b>':p.test?(p.test.ok?'<b class="admin-st ok">✅ conectado</b>':'<b class="admin-st bad">❌ '+esc(p.test.detail||'error')+'</b>'):'<b class="admin-st">● con clave</b>';
 // «hoy 08:46», «ayer 21:10» o «3 oct 10:02»: así se ve si el error es anterior a un arreglo.
 function errWhen(iso){const d=new Date(iso);if(isNaN(d))return'';const t=d.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}),day=new Date();day.setHours(0,0,0,0);
  const diff=Math.round((day-new Date(d.getFullYear(),d.getMonth(),d.getDate()))/86400000);
  return diff===0?'hoy '+t:diff===1?'ayer '+t:d.toLocaleDateString('es-ES',{day:'numeric',month:'short'})+' '+t}
 function providerCard(p){
  const used=p.test&&p.test.used!=null?p.test.used:p.month.calls,limit=p.test&&p.test.limit!=null?p.test.limit:p.monthlyLimit;
  return '<article class="settings-card admin-card">'+cardHead(p.label,p.dashboard)+status(p)+
   '<small>Gratis: '+esc(p.free)+'</small>'+(p.unused?'<small class="admin-st warn">Clave guardada, pero la app aún no usa este servicio.</small>':'')+
   (()=>{const pr=p.profile||{},daily=pr.daily&&pr.daily<100000?pr.daily:null,err=p.today.calls?Math.round(p.today.errors/p.today.calls*100):0;
     return '<small>Hoy: '+fmt(p.today.calls)+' consultas'+(daily?' de ~'+fmt(daily)+' (cupo diario estimado)':'')+(p.today.errors?' · '+fmt(p.today.errors)+' fallos ('+err+' %)':'')+'</small>'+bar(p.today.calls,daily)+
      '<small>Este mes: '+fmt(used)+(limit?' de '+fmt(limit):'')+'</small>'+(limit?bar(used,limit):'')+
      (pr.decision!=null||pr.search!=null?'<small>Nota del repartidor: '+(pr.search!=null?'búsqueda '+pr.search:'decidir '+pr.decision+' · cribar '+pr.light)+'/100</small>':'')})()+
   (p.test&&p.test.ok&&p.test.detail&&p.test.detail!=='conectado'?'<small>'+esc(p.test.detail)+'</small>':'')+
   (p.month.lastError?'<small class="admin-err">Último error'+(p.month.lastErrorAt?' ('+esc(errWhen(p.month.lastErrorAt))+')':'')+': '+esc(p.month.lastError)+'</small>':'')+
   (p.secret?'<small>Secreto: <code>'+esc(p.secret)+'</code></small>':'')+'</article>';
 }
 function providerSection(d,kinds,kicker,title,text){
  const list=(d.providers||[]).filter(p=>kinds.includes(p.kind));
  const label=id=>((d.providers||[]).find(p=>p.id===id)||{}).label||id;
  const chain=(name,rows)=>rows&&rows.length?'<div class="admin-route"><span>'+esc(name)+'</span>'+rows.map((r,i)=>'<b>'+(i+1)+'. '+esc(label(r.id))+(r.score!=null?' <small>'+r.score+'</small>':' <small>reserva</small>')+'</b>').join('')+'</div>':'';
  const rt=d.routing||{};
  const routes=kinds.includes('IA')?chain('Para decidir (comprar, vender, ideas)',rt.decision)+chain('Para cribar candidatos',rt.light):kinds.includes('Búsqueda')?chain('Búsqueda web',rt.search):'';
  return heading(kicker,title,text)+routes+'<div class="admin-grid">'+(list.map(providerCard).join('')||'<p class="settings-note">Sin servicios.</p>')+'</div>';
 }
 const cardHead=(title,url)=>'<div class="admin-card-head"><strong>'+esc(title)+'</strong>'+(url?'<a class="admin-open" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Abrir panel ↗</a>':'')+'</div>';
 const card=(title,url,body,extra='')=>'<article class="settings-card admin-card'+extra+'">'+cardHead(title,url)+body+'</article>';
 const metric=(label,used,limit,fmtv=fmt)=>'<small>'+label+': '+fmtv(used)+(limit?' de '+fmtv(limit):'')+'</small>'+bar(used,limit);
 const err=t=>'<small class="admin-err">'+esc(t||'sin datos')+'</small>';
 const note=t=>'<small>'+t+'</small>';
 const STATUS_ES={scriptThrewException:'excepción en el código',exceededResources:'límite de CPU o memoria',clientDisconnected:'el cliente cerró la conexión',internalError:'error interno de Cloudflare',exceededMemory:'sin memoria',exceededCpu:'límite de CPU',responseStreamDisconnected:'respuesta cortada',loadSheddingAppError:'sobrecarga'};
 function infraHtml(d){
  const cf=d.cloudflare||{},w=cf.workers||{},dd=cf.d1||{},kv=cf.kv||{},t=d.turso||{},tu=t.usage||{},gh=d.github||{};
  const url=id=>((d.infra||[]).find(x=>x.id===id)||{}).url||'';
  const gb=b=>(b/1024**3).toLocaleString('es-ES',{maximumFractionDigits:2})+' GB';
  const cfMissing=d.usageLoading?note('Cargando consumo…'):d.usageError?err('No se pudo leer el consumo: '+d.usageError):note('Añade <code>CF_ANALYTICS_TOKEN</code> y <code>CF_ACCOUNT_ID</code> para ver el consumo.');
  const worker=!cf.configured?cfMissing:!w.ok?err(w.detail||cf.detail):
   metric('Peticiones hoy',w.requests,w.limit)+note(fmt(w.errors)+' errores ('+(w.requests?Math.round(w.errors/w.requests*1000)/10:0)+' %) · '+fmt(w.subrequests)+' llamadas a servicios externos')+
   ((w.errorsByStatus||[]).length?'<small>Motivo de los fallos: '+w.errorsByStatus.map(x=>esc(STATUS_ES[x.status]||x.status)+' '+fmt(x.count)).join(' · ')+'</small>':'');
  const d1=!cf.configured?cfMissing:!dd.ok?err(dd.detail):metric('Filas escritas hoy',dd.rowsWritten,dd.writeLimit)+metric('Filas leídas hoy',dd.rowsRead,dd.readLimit);
  const kvb=!cf.configured?cfMissing:!kv.ok?err(kv.detail):metric('Lecturas hoy',kv.reads,kv.readLimit)+metric('Escrituras hoy',kv.writes,kv.writeLimit)+metric('Borrados hoy',kv.deletes,kv.writeLimit)+metric('Listados hoy',kv.lists,kv.writeLimit);
  const turso=(t.active==='turso'?'<b class="admin-st ok">✅ en uso</b>':'<b class="admin-st warn">⚠️ no activa: las cachés van a D1</b>')+
   (d.usageLoading?note('Cargando consumo…'):d.usageError?err('No se pudo leer el consumo: '+d.usageError):!tu.configured?note('Añade <code>TURSO_API_TOKEN</code> (token de la plataforma Turso) para ver el consumo.'):!tu.ok?err(tu.detail):
    metric('Filas leídas este mes',tu.rowsRead,tu.readLimit)+metric('Filas escritas este mes',tu.rowsWritten,tu.writeLimit)+metric('Almacenamiento',tu.storageBytes,tu.storageLimit,gb));
  const actions=d.usageLoading?note('Cargando consumo…'):d.usageError?err('No se pudo leer el consumo: '+d.usageError):!gh.configured?note('Añade <code>GH_ANALYTICS_TOKEN</code> para ver los minutos del mes.'):!gh.ok?err(gh.detail):
   metric('Minutos este mes ('+esc(gh.minutesSource)+')',gh.minutes,gh.limit)+note(fmt(gh.runs)+(gh.more?'+':'')+' ejecuciones · '+fmt(gh.failed)+' fallidas')+
   ((gh.workflows||[]).length?'<small>'+gh.workflows.map(x=>esc(x.name)+': '+fmt(x.runs)+(x.failed?' ('+fmt(x.failed)+' ✗)':'')).join(' · ')+'</small>':'')+
   (gh.lastApk?'<small>Última APK: '+(gh.lastApk.conclusion==='success'?'✅':gh.lastApk.status!=='completed'?'⏳':'❌')+' '+esc(new Date(gh.lastApk.at).toLocaleString('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))+' · <a href="'+esc(gh.lastApk.url)+'" target="_blank" rel="noopener noreferrer">descargar ↗</a></small>':'');
  const info=id=>((d.infra||[]).find(x=>x.id===id)||{}).detail||'';
  return heading('INFRAESTRUCTURA','Consumo y paneles','Cloudflare se reinicia cada día a las 00:00 UTC; Turso y GitHub, cada mes.')+
   '<div class="admin-grid">'+
   card('Worker · web y servidor',url('worker'),worker)+
   card('D1 · base de datos personal',url('d1'),d1)+
   card('KV · estado rápido',url('kv'),kvb)+
   card('Turso · cachés de mercado',url('turso'),turso)+
   card('GitHub Actions · datos y APK',url('actions'),actions)+
   card('GitHub · código',url('github'),note(esc(info('github'))))+
   card('Firebase · acceso y avisos',url('firebase'),note('Proyecto '+esc(info('firebase')||'—')+'. Inicio de sesión con Google y notificaciones push.'))+
   card('Secretos de Cloudflare',url('secrets'),note('Donde se guardan todas las claves.'))+
   '</div>';
 }
 function appHtml(d,sources){
  const a=d.app||{},v=n=>d.usageLoading?'…':n===null||n===undefined?'—':fmt(n);
  const row=(label,val)=>'<div class="settings-status-row"><span>'+label+'</span><strong class="settings-status">'+val+'</strong></div>';
  return heading('DATOS DE LA APP','Uso interno','Solo recuentos: ningún dato personal sale de D1.')+
   (d.usageError?'<p class="settings-note admin-err">No se pudieron leer los recuentos: '+esc(d.usageError)+'</p>':a.error?'<p class="settings-note admin-err">No se pudieron leer los recuentos: '+esc(a.error)+'</p>':'')+
   '<div class="settings-stack"><article class="settings-card compact-settings-card"><div class="settings-card-head"><div><span class="settings-kicker">CUENTAS</span></div></div>'+
   row('Usuarios',v(a.users))+row('Dispositivos con avisos',v(a.devices))+'</article>'+
   '<article class="settings-card compact-settings-card"><div class="settings-card-head"><div><span class="settings-kicker">CARTERAS</span></div></div>'+
   row('Carteras de acciones',v(a.portfolios))+row('Posiciones de acciones',v(a.positions))+row('Carteras de fondos',v(a.fund_portfolios))+row('Posiciones de fondos',v(a.fund_positions))+
   row('Objetivos activos',v(a.portfolio_goals))+row('Decisiones «Decidir qué hacer»',v(a.position_decisions))+'</article></div>';
 }
 // Documentación de la infraestructura: qué hace cada plataforma, cómo fluyen los datos y
 // dónde está cada clave (nunca su valor). El estado en vivo solo existe para los secretos
 // del Worker; los de GitHub y Netlify no se pueden leer desde aquí.
 const DOC_LINKS={
  cfWorker:'https://dash.cloudflare.com/?to=/:account/workers/services/view/viewinvai/production/settings',
  cfTokens:'https://dash.cloudflare.com/profile/api-tokens',
  ghTokens:'https://github.com/settings/personal-access-tokens',
  ghOrgTokens:'https://github.com/organizations/viewinvai/settings/personal-access-token-requests',
  dataSecrets:'https://github.com/viewinvai/data/settings/secrets/actions',
  dataActions:'https://github.com/viewinvai/data/actions',
  appSecrets:'https://github.com/jjlunav/ViewInvAI/settings/secrets/actions',
  appActions:'https://github.com/jjlunav/ViewInvAI/actions',
  netlify:'https://app.netlify.com/projects/viewinvai-data',
  netlifyTokens:'https://app.netlify.com/user/applications#personal-access-tokens',
  firebase:'https://console.firebase.google.com/project/viewinvai/settings/serviceaccounts/adminsdk',
  turso:'https://app.turso.tech/'
 };
 const DOC_PLATFORMS=[
  ['Cloudflare','La web, la API y el cerebro: Worker «viewinvai» (web, API y tareas de cada minuto: análisis, avisos, Radar, Objetivo), D1 (datos personales: carteras, avisos, ajustes), KV (estado rápido), Workers AI (IA de reserva) y Workers Builds (publica la web en cada cambio de la rama main). Gratis: 100.000 peticiones/día y 10 ms de CPU por ejecución.','https://dash.cloudflare.com/'],
  ['GitHub · jjlunav/ViewInvAI','El código de la app (privado). Cada cambio en main se publica solo en Cloudflare. Compila la APK a mano (Actions › Build ViewInvAI Android APK). Los datos de mercado llegan aquí como commits del proceso de datos.','https://github.com/jjlunav/ViewInvAI'],
  ['GitHub · organización viewinvai (repo data)','Los procesos de datos (privado, con sus propios 2.000 minutos/mes): «Datos de mercado» (lo lanza el Worker según la sesión de Nueva York, más un respaldo diario a las 06:41 UTC), «Fondos y ETFs» (diario 04:17 UTC) y el despliegue de Netlify.','https://github.com/viewinvai/data'],
  ['Netlify · viewinvai-data','Cálculo pesado fuera del Worker. «market-live»: precios en vivo de ~6.100 valores de EE. UU. (TradingView). «market-server»: guarda el snapshot completo con precios en vivo y devuelve al Worker solo los valores que pide, con el Radar, los candidatos del Objetivo y «lo más comentado» ya calculados con el mismo backend.js. Protegido con MARKET_SERVER_KEY. Gratis: 300 créditos/mes; si se agotan, el Worker lo hace él mismo (más CPU, sin perder avisos).','https://app.netlify.com/projects/viewinvai-data'],
  ['Firebase · viewinvai','Inicio de sesión con Google (web y APK) y envío de notificaciones push al móvil y al reloj (Cloud Messaging).','https://console.firebase.google.com/project/viewinvai/overview'],
  ['Turso','Base de datos de cachés de mercado no personales (tipos de cambio, marcador del Radar, análisis compartidos). Si falla, se usa D1.','https://app.turso.tech/'],
  ['Proveedores de IA y búsqueda','Gemini, Groq, OpenRouter, Tavily, Serper… El repartidor elige el mejor libre en cada consulta. Estado, cupos y claves en las pestañas IA y Búsqueda web.',''],
  ['Fuentes de criptoactivos','Sin clave ni registro. Precio: mediana de Kraken, Bitstamp, Coinbase y Bit2Me (mercados) y CoinGecko (agregador); en la ficha también CoinPaprika. Se usa el punto medio entre compra y venta, y no entra un mercado con menos de 2.000 € negociados en 24 h. Una fuente que se separa más de un 1 % se señala y, si quedan 3 coherentes, sale de la mediana. CoinGecko limita a las IP de Cloudflare: su último dato se guarda 6 h en KV para capitalización y variaciones; CoinLore es el respaldo de esos datos.','']
 ];
 const DOC_FLOW=[
  ['Criptoactivos','App → Worker /api/crypto/quotes → las fuentes en lote (una petición por fuente, memorizada 20 s) → mediana y desviación de cada una. Mi cripto se guarda en D1 (crypto_positions); el resumen diario usa el mismo precio de consenso.'],
  ['Datos de mercado','Worker (cada minuto comprueba la hora) → avisa a GitHub viewinvai/data cada 30 min en sesión, 90 min en pre/post y 3 h el resto → «Datos de mercado» descarga las fuentes públicas y publica market.json en jjlunav/ViewInvAI → Cloudflare publica la web con los datos nuevos (≈2 min).'],
  ['Precios en vivo','App → Worker /api/market-live → Netlify market-live (TradingView) cada minuto en horario 04:00-20:00 NY y cada 15 min fuera. Si Netlify falla, el Worker consulta TradingView directamente.'],
  ['Avisos y análisis','Worker cada minuto → pide a Netlify market-server los valores de carteras y seguimiento + Radar y Objetivo ya calculados → decide → guarda en D1 → Firebase Cloud Messaging → móvil/reloj.'],
  ['Fondos y ETFs','«Fondos y ETFs» (viewinvai/data, diario) → funds.json en jjlunav/ViewInvAI → web.'],
  ['APK','Al abrir, la APK carga la versión publicada de la app (la misma que la web) y, sin conexión o si fallara, la copia que lleva dentro. Solo hace falta compilar otra APK para cambios nativos (icono, permisos, plugins): GitHub jjlunav/ViewInvAI › Actions › Build ViewInvAI Android APK › Run workflow (rama main) → artefacto ViewInvAI-Android-debug.']
 ];
 // [nombre, dónde, para qué, caducidad / cómo renovar, clave de estado en vivo]
 const DOC_KEYS=[
  ['Secretos del Worker (Cloudflare › Workers › viewinvai › Settings › Variables and Secrets, tipo Secret)',DOC_LINKS.cfWorker,[
   ['GITHUB_DISPATCH_TOKEN','Lanzar «Datos de mercado» en viewinvai/data.','Token fine-grained de GitHub (propietario: viewinvai, repo: data, permiso Actions: Read and write). Caduca el 21 oct 2027: en GitHub › Fine-grained tokens › Regenerate, y pegar el nuevo aquí. Comprobar en /api/market-dispatch-status («ok»).','GITHUB_DISPATCH_TOKEN',DOC_LINKS.ghTokens],
   ['MARKET_SERVER_KEY','Clave compartida con Netlify: solo el Worker puede usar market-server y market-live.','No caduca. Para cambiarla: mismo valor nuevo aquí y en el secreto MARKET_SERVER_KEY de viewinvai/data, y relanzar «Desplegar funciones en Netlify».','MARKET_SERVER_KEY',DOC_LINKS.dataSecrets],
   ['FCM_SERVICE_ACCOUNT_JSON','Enviar notificaciones push (cuenta de servicio de Firebase).','No caduca salvo que se revoque. Nueva: Firebase › Configuración › Cuentas de servicio › Generar nueva clave privada; pegar el JSON entero aquí.','FCM_SERVICE_ACCOUNT_JSON',DOC_LINKS.firebase],
   ['AI_KEYS_SECRET','Cifra las claves de IA que guarda cada usuario en la app.','No caduca. No cambiarla: si cambia, las claves de IA guardadas dejan de poder leerse y habría que volver a introducirlas.','AI_KEYS_SECRET',''],
   ['ADMIN_EMAILS','Correos con acceso a Administración.','No caduca.','ADMIN_EMAILS',''],
   ['CF_ACCOUNT_ID + CF_ANALYTICS_TOKEN','Leer el consumo de Cloudflare en Infraestructura.','Token de API de Cloudflare (Account Analytics: Read). Ver su caducidad en My Profile › API Tokens.','CF_ANALYTICS_TOKEN',DOC_LINKS.cfTokens],
   ['GH_ANALYTICS_TOKEN','Leer los minutos de Actions y el estado de la APK.','Token de GitHub de solo lectura. Ver su caducidad en GitHub › tokens.','GH_ANALYTICS_TOKEN',DOC_LINKS.ghTokens],
   ['TURSO_URL + TURSO_TOKEN','Base de datos de cachés (Turso).','Token de la base en Turso › Databases › Create token. Si falta, todo va a D1.','TURSO',DOC_LINKS.turso],
   ['TURSO_API_TOKEN + TURSO_ORG','Leer el consumo de Turso.','Token de plataforma en Turso › Settings › API Tokens.','TURSO_API_TOKEN',DOC_LINKS.turso],
   ['MARKET_PUBLISH_TOKEN','Permite al proceso de datos actualizar el catálogo en D1.','No caduca. Si se cambia, poner el mismo valor en el secreto MARKET_PUBLISH_TOKEN de viewinvai/data.','MARKET_PUBLISH_TOKEN',DOC_LINKS.dataSecrets],
   ['OPENFDA_API_KEY, FINNHUB_API_KEY y claves de IA/búsqueda','Fuentes de datos y proveedores de IA.','Cada una en su panel (enlaces en las pestañas IA y Búsqueda web, donde se ve si funciona).','OPENFDA_API_KEY','']
  ]],
  ['Secretos de GitHub · viewinvai/data (Settings › Secrets and variables › Actions)',DOC_LINKS.dataSecrets,[
   ['APP_REPO_TOKEN','Publicar market.json y funds.json en jjlunav/ViewInvAI y copiar el motor de cálculo a Netlify.','Token de GitHub con acceso a jjlunav/ViewInvAI (Contents: Read and write). Mira su fecha en GitHub › tokens; si caduca, los datos dejan de publicarse (los procesos fallan en «Publicar en la app»).','',DOC_LINKS.ghTokens],
   ['NETLIFY_AUTH_TOKEN','Desplegar las funciones en Netlify y configurar su clave.','Token personal de Netlify (User settings › Applications › Personal access tokens). Mira su caducidad allí.','',DOC_LINKS.netlifyTokens],
   ['MARKET_SERVER_KEY','El despliegue la copia a Netlify.','Igual que el secreto del Worker con el mismo nombre (deben coincidir).','',''],
   ['MARKET_PUBLISH_TOKEN (+ variable MARKET_PUBLISH_URL)','Sincronizar el catálogo con D1.','Igual que el secreto del Worker con el mismo nombre.','','']
  ]],
  ['Secretos de GitHub · jjlunav/ViewInvAI',DOC_LINKS.appSecrets,[
   ['ANDROID_DEBUG_KEYSTORE_BASE64','Firma de la APK. Mantiene la misma huella SHA-1 registrada en Firebase.','No caduca. No perderla: con otra firma la APK nueva no se instala encima de la anterior y el inicio de sesión con Google falla hasta registrar la nueva SHA-1 en Firebase.','',''],
   ['firebase/google-services.json (archivo del repo)','Configuración pública de Firebase para Android.','No es secreta ni caduca; se descarga de Firebase › Configuración del proyecto si cambia la app.','','']
  ]],
  ['Netlify · viewinvai-data (Project configuration › Environment variables)',DOC_LINKS.netlify,[
   ['MARKET_SERVER_KEY','Las funciones rechazan (403) cualquier petición sin ella.','La escribe el despliegue desde GitHub; no hace falta tocarla a mano. Visibilidad del proyecto: Public (la protección es la clave).','','']
  ]]
 ];
 const DOC_PROBLEMS=[
  ['Los datos no se actualizan','Mira /api/market-dispatch-status: «GitHub dispatch 401/403» = token GITHUB_DISPATCH_TOKEN caducado o sin permiso Actions. Si dice «ok», revisa las ejecuciones de «Datos de mercado» en viewinvai/data.'],
  ['Avisos que no llegan o Radar/«lo más comentado» parados','Netlify sin créditos o sin clave: el Worker vuelve a calcularlo él (más CPU). Revisa el proyecto en Netlify y que MARKET_SERVER_KEY coincida en Cloudflare y en GitHub viewinvai/data.'],
  ['Correo de Cloudflare por CPU','Alguna tarea volvió a leer el snapshot completo: suele ser Netlify caído o la clave cambiada en un solo sitio.'],
  ['Los procesos de datos fallan al publicar','APP_REPO_TOKEN caducado: crea uno nuevo con acceso a jjlunav/ViewInvAI y sustitúyelo en viewinvai/data.'],
  ['Sin minutos de GitHub Actions','Cada cuenta tiene 2.000 min/mes; los datos van con los de la organización viewinvai. Se reinician el día 1.']
 ];
 function docsHtml(d){
  const sec=(d&&d.secrets)||{};
  const live=k=>!k||!(k in sec)?'':sec[k]?'<b class="admin-st ok">✅ configurado</b>':'<b class="admin-st warn">⚠️ falta</b>';
  const link=(u,t='Abrir ↗')=>u?'<a class="admin-open" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+t+'</a>':'';
  const block=(title,body,open)=>'<details class="settings-card admin-doc"'+(open?' open':'')+'><summary><strong>'+esc(title)+'</strong></summary>'+body+'</details>';
  const flow='<ol class="admin-doc-flow">'+DOC_FLOW.map(([t,x])=>'<li><b>'+esc(t)+'</b><span>'+esc(x)+'</span></li>').join('')+'</ol>';
  const platforms='<div class="admin-doc-list">'+DOC_PLATFORMS.map(([t,x,u])=>'<div class="admin-doc-row"><div class="admin-card-head"><strong>'+esc(t)+'</strong>'+link(u,'Abrir panel ↗')+'</div><small>'+esc(x)+'</small></div>').join('')+'</div>';
  const keys=DOC_KEYS.map(([group,url,rows])=>'<h3 class="admin-doc-h">'+esc(group)+' '+link(url)+'</h3><div class="admin-doc-list">'+
   rows.map(([name,what,renew,k,u])=>'<div class="admin-doc-row"><div class="admin-card-head"><code>'+esc(name)+'</code>'+live(k)+'</div><small><b>Para qué:</b> '+esc(what)+'</small><small><b>Caducidad y cambio:</b> '+esc(renew)+'</small>'+(u?'<small>'+link(u,'Dónde renovarla ↗')+'</small>':'')+'</div>').join('')+'</div>').join('');
  const vars='<small>Variables no secretas (en <code>wrangler.jsonc</code>, se publican con el código): <code>MARKET_LIVE_URL</code>, <code>MARKET_SERVER_URL</code>, <code>MARKET_DISPATCH_MINUTES</code> (30), <code>FIREBASE_PROJECT_ID</code>, <code>AI_MODEL</code>, <code>SEC_USER_AGENT</code>. Reglas: las claves nunca van en el código ni en el chat, solo como secretos en Cloudflare, GitHub o Netlify.</small>';
  const problems='<div class="admin-doc-list">'+DOC_PROBLEMS.map(([t,x])=>'<div class="admin-doc-row"><strong>'+esc(t)+'</strong><small>'+esc(x)+'</small></div>').join('')+'</div>';
  return heading('DOCUMENTACIÓN','Infraestructura de ViewInvAI','Cómo funciona todo, qué hace cada plataforma y dónde está cada clave (nunca su valor). El estado ✅/⚠️ es en vivo para los secretos del Worker.')+
   '<div class="settings-stack">'+
   block('Cómo fluyen los datos',flow,true)+
   block('Plataformas y qué hace cada una',platforms,false)+
   block('Claves, tokens y secretos',keys+vars,false)+
   block('Si algo deja de funcionar',problems,false)+
   '</div>';
 }
 // Fuentes públicas (sin clave): el mismo estado que Configuración › Datos y servicios.
 let publicSources=null;
 async function loadPublicSources(){
  try{const r=await fetch('/api/backend/status',{cache:'no-store'});const d=r.ok?await r.json():{};
   let tr={ok:false};try{const t=await fetch('/api/tr-health',{cache:'no-store'});tr=t.ok?await t.json():{ok:false,error:'HTTP '+t.status}}catch(_){}
   publicSources={sources:d.sources||{},tr,at:d.updatedAt}}catch(_){publicSources={sources:{},tr:{ok:false}}}
  if(last){fill('market',marketHtml(last));document.querySelectorAll('#view-admin .admin-bar i[data-pct]').forEach(i=>{i.style.width=i.dataset.pct+'%'})}
 }
 function marketHtml(d){
  const src=(publicSources&&publicSources.sources)||{},tr=(publicSources&&publicSources.tr)||{};
  const st=(ok,txt)=>'<b class="admin-st '+(ok?'ok':'bad')+'">'+(ok?'✅ ':'❌ ')+esc(txt)+'</b>';
  const pub=[
   ['LS Exchange (vía Trade Republic)','tradeRepublic','https://www.ls-x.de/',tr.ok===true,tr.ok===true?'precios en vivo':(tr.error||'sin precios')],
   ['Nasdaq / EE. UU.','nasdaq','https://www.nasdaq.com/'],['SEC / EDGAR','sec','https://www.sec.gov/edgar/search/'],
   ['ClinicalTrials.gov','clinicalTrials','https://clinicaltrials.gov/'],['FDA / openFDA','fda','https://open.fda.gov/']
  ].map(([label,key,link,okOverride,txt])=>{const x=src[key];const ok=okOverride!==undefined?okOverride:!!x&&x.configured!==false&&!x.error;
   return card(label,link,!publicSources?note('Comprobando…'):okOverride===undefined&&!x?note('Sin datos de estado.'):st(ok,txt||(ok?'operativa':x.error||'sin configurar')))}).join('');
  return providerSection(d,['Datos de mercado','Datos macro','Sentimiento'],'DATOS DE MERCADO','Cotizaciones y datos','Con clave (Finnhub, FMP, FRED, FinBERT) y fuentes públicas sin clave (BCE y las de abajo).')+
   '<div class="admin-grid admin-grid-gap">'+pub+'</div>';
 }
 function fill(name,html){const el=document.querySelector('[data-admin-panel="'+name+'"]');if(el)el.innerHTML=html}
 function render(d){
  const ps=d.providers||[],ok=ps.filter(p=>p.test&&p.test.ok).length,noKey=ps.filter(p=>!p.configured).length,paused=ps.filter(p=>p.cooldownUntil).length,failed=ps.filter(p=>p.test&&!p.test.ok).length;
  const calls=ps.reduce((s,p)=>s+(p.today.calls||0),0);
  const sec=d.secrets||{},cf=d.cloudflare||{};
  const row=(label,val,cls='')=>'<div class="settings-status-row"><span>'+label+'</span><strong class="settings-status '+cls+'">'+val+'</strong></div>';
  fill('summary',heading('RESUMEN','Estado general',d.probedAt?'Última prueba de conexiones: '+esc(new Date(d.probedAt).toLocaleString('es-ES',{hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'}))+'.':'Pulsa «Probar conexiones» para comprobar cada clave.')+
   '<div class="settings-stack"><article class="settings-card compact-settings-card"><div class="settings-card-head"><div><span class="settings-kicker">SERVICIOS</span></div></div>'+
   row('Servicios externos',ps.length+' en total')+
   (d.probedAt?row('Conectados',ok+' de '+ps.length,ok===ps.length?'admin-st ok':''):'')+
   (failed?row('Con error',ps.filter(p=>p.test&&!p.test.ok).map(p=>esc(p.label)+(p.test.detail?' · '+esc(p.test.detail):'')).join('<br>'),'admin-st bad'):'')+
   (noKey?row('Sin clave',String(noKey),'admin-st warn'):'')+
   (paused?row('En pausa por cupo',String(paused),'admin-st warn'):'')+
   row('Consultas hoy a IA y búsqueda web',fmt(calls))+
   (()=>{const soon=typeof credsSoon==='function'?credsSoon():[];return soon.length?row('Caducan en 30 días o menos',soon.map(c=>esc(c.name)+' ('+(c.daysLeft<0?'caducado':c.daysLeft+' d')+')').join(', '),'admin-st bad'):''})()+
   row('Caché de mercado',d.turso&&d.turso.active==='turso'?'Turso (activa)':'D1 (Turso no activa)',d.turso&&d.turso.active==='turso'?'admin-st ok':'admin-st warn')+
   row('Cloudflare',d.usageLoading?'cargando…':!cf.configured?'sin secretos':cf.ok?'leyendo consumo':'error',d.usageLoading?'':!cf.configured?'admin-st warn':cf.ok?'admin-st ok':'admin-st bad')+
   '</article><article class="settings-card compact-settings-card"><div class="settings-card-head"><div><span class="settings-kicker">SECRETOS DE ADMINISTRACIÓN</span></div></div>'+
   Object.entries(sec).map(([k,v])=>row('<code>'+esc(k==='TURSO'?'TURSO_URL + TURSO_TOKEN':k)+'</code>',v?'configurado':'falta',v?'admin-st ok':'admin-st warn')).join('')+
   '</article></div>');
  fill('ai',providerSection(d,['IA'],'IA','Inteligencia artificial','Cada consulta elige la mejor IA para su tarea según su nota, sus fallos y su consumo de hoy, y reparte la carga entre las mejores. Si una falla o agota su cupo, pasa a la siguiente. Orden actual (puntuación):'));
  fill('search',providerSection(d,['Búsqueda','Lectura web'],'BÚSQUEDA WEB','Búsqueda y lectura web','Se reparten igual que la IA: calidad, fallos y consumo de hoy. Orden actual (puntuación):'));
  fill('market',marketHtml(d));if(!publicSources)loadPublicSources();
  fill('infra',infraHtml(d));
  fill('app',appHtml(d));
  fill('docs',docsHtml(d));
  document.querySelectorAll('#view-admin .admin-bar i[data-pct]').forEach(i=>{i.style.width=i.dataset.pct+'%'});
 }
 // El consumo (Cloudflare, Turso, GitHub y recuentos) llega aparte porque tarda más.
 let usage=null,usageLoading=false;
 const withTimeout=(promise,ms)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('el servidor tarda demasiado; pulsa «Actualizar»')),ms))]);
 async function loadUsage(){
  if(usageLoading)return;usageLoading=true;
  try{usage=await withTimeout(api('/api/admin?usage=1'),45000);if(last){last={...last,...usage,usageLoading:false,usageError:''};render(last)}}
  catch(e){usage=null;if(last){const {cloudflare,github,app,...rest}=last;last={...rest,turso:{active:(last.turso||{}).active},usageLoading:false,usageError:e.message||'error'};render(last)}}
  finally{usageLoading=false}
 }
 // Globo de progreso: dice en qué paso va y cuánto lleva; el contenido anterior no se borra mientras tanto.
 let progressTimer=0,progressStart=0;
 function progress(text,state='busy'){
  const box=document.getElementById('adminProgress');if(!box)return;
  // El texto del paso va en la región que leen los lectores de pantalla; los segundos, aparte y ocultos para ellos.
  const label=box.querySelector('.admin-progress-text'),time=box.querySelector('.admin-progress-time');clearInterval(progressTimer);clearTimeout(progressTimer);
  box.hidden=false;box.dataset.state=state;label.textContent=text;
  if(state==='busy'){
   if(!progressStart)progressStart=Date.now();
   const tick=()=>{time.textContent=' · '+Math.round((Date.now()-progressStart)/1000)+' s'};tick();progressTimer=setInterval(tick,1000);
  }else{
   time.textContent='';progressStart=0;
   if(state==='done')progressTimer=setTimeout(()=>{box.hidden=true},3500);
   else if(state==='warn')progressTimer=setTimeout(()=>{box.hidden=true},9000);
  }
  document.querySelectorAll('[data-admin-refresh],[data-admin-probe]').forEach(b=>{b.disabled=state==='busy';b.setAttribute('aria-busy',String(state==='busy'))});
 }
 function stamp(){const el=document.getElementById('adminUpdated');if(el)el.textContent='Actualizado a las '+new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}
 const sayToast=(msg,bad)=>{try{if(typeof toast==='function')toast(msg,!!bad)}catch(_){}};
 async function load(probe=false,manual=false){
  if(loading)return;loading=true;
  if(!last)SECTIONS.forEach(n=>fill(n,'<p class="settings-note">Cargando…</p>'));
  progress(probe?'Probando cada clave y servicio (puede tardar hasta un minuto)':'Leyendo el estado de los servicios');
  try{
   const core=await withTimeout(api('/api/admin'+(probe?'?probe=1':'')),probe?60000:20000);
   isAdmin=true;last={...core,...(usage||{}),usageLoading:!usage,usageError:''};render(last);
   progress('Leyendo el consumo de Cloudflare, Turso y GitHub');
   await loadUsage();
   stamp();
   const ps=last.providers||[],ok=ps.filter(p=>p.test&&p.test.ok).length,bad=ps.filter(p=>p.test&&!p.test.ok).length;
   // Fallos dentro del consumo (cada lector devuelve su propio error aunque la petición vaya bien).
   const cf=last.cloudflare||{},gh=last.github||{},app=last.app||{},tu=(last.turso||{}).usage||{};
   const usageFails=[last.usageError?'consumo':'',cf.configured&&cf.ok===false?'Cloudflare':'',gh.configured&&gh.ok===false?'GitHub':'',tu.configured&&tu.ok===false?'Turso':'',app.error||app.ok===false?'recuentos de la app':''].filter(Boolean);
   const when=last.probedAt?new Date(last.probedAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'';
   const msg=(probe?'Conexiones comprobadas'+(when?' a las '+when:'')+': '+ok+' de '+ps.length+' conectados'+(bad?' · con error: '+ps.filter(p=>p.test&&!p.test.ok).map(p=>p.label+(p.test.detail?' ('+p.test.detail+')':'')).join(', '):''):'Datos actualizados')+
    (usageFails.length?' · sin datos de '+usageFails.join(', '):'');
   const warn=!!bad||usageFails.length>0;
   progress((warn?'⚠ ':'✓ ')+msg,warn?'warn':'done');if(manual||probe)sayToast(msg,warn);
  }
  catch(e){
   if(e.status===403||e.status===401){isAdmin=false;progress('','done');try{show('today')}catch(_){}}
   else{
    progress('No se pudo '+(probe?'probar las conexiones':'actualizar')+': '+(e.message||'error'),'error');
    if(!last){selectSection('summary',false);fill('summary','<p class="settings-note admin-err">No se pudo cargar: '+esc(e.message)+'</p>')}
    if(manual||probe)sayToast('No se pudo '+(probe?'probar las conexiones':'actualizar')+'.',true);
   }
  }finally{loading=false}
 }
 // ----- Caducidades: tokens y claves con su fecha (nunca el valor), avisando con 30 días -----
 let creds=null,credsLoading=false;
 async function loadCreds(force=false){
  if(credsLoading||(creds&&!force)){if(creds)fill('creds',credsHtml());return}
  credsLoading=true;
  try{creds=(await api('/api/admin?credentials=1')).credentials||[];fill('creds',credsHtml());if(last)render(last)}
  catch(e){fill('creds','<p class="settings-note admin-err">No se pudieron leer las caducidades: '+esc(e.message)+'</p>')}
  finally{credsLoading=false}
 }
 const credTone=c=>c.daysLeft===null?'ok':c.daysLeft<0?'bad':c.daysLeft<=30?'bad':c.daysLeft<=90?'warn':'ok';
 const credText=c=>c.daysLeft===null?'Sin caducidad':c.daysLeft<0?'Caducado hace '+(-c.daysLeft)+' días':c.daysLeft===0?'Caduca hoy':'Caduca en '+c.daysLeft+' días · '+new Date(c.expires+'T12:00:00Z').toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'});
 function credsSoon(){return(creds||[]).filter(c=>c.daysLeft!==null&&c.daysLeft<=30)}
 function credsHtml(){
  const list=creds||[];
  const rows=list.map(c=>'<article class="settings-card admin-card admin-cred" data-cred="'+esc(c.name)+'">'+
   '<div class="admin-cred-head"><b>'+esc(c.name)+'</b><b class="admin-st '+credTone(c)+'">'+(credTone(c)==='ok'?'✅ ':'⚠️ ')+esc(credText(c))+'</b></div>'+
   '<small>'+esc(c.place||'')+(c.note?' · '+esc(c.note):'')+'</small>'+
   '<form class="admin-cred-form" data-cred-form="'+esc(c.name)+'"><label><span>Caduca el</span><input type="date" name="expires" value="'+esc(c.expires||'')+'"></label>'+
   '<label><span>Dónde</span><input type="text" name="place" maxlength="120" value="'+esc(c.place||'')+'"></label>'+
   '<label><span>Para qué</span><input type="text" name="note" maxlength="160" value="'+esc(c.note||'')+'"></label>'+
   '<div class="admin-cred-actions"><button type="submit" class="btn small">Guardar</button><button type="button" class="btn small ghost" data-cred-remove="'+esc(c.name)+'">Quitar</button></div></form></article>').join('');
  return heading('CADUCIDADES','Tokens y claves','Solo la fecha y para qué sirve cada una; los valores siguen guardados como secretos y nunca se muestran. Deja la fecha vacía si no caduca. Aviso con 30 días de antelación.')+
   '<div class="settings-stack">'+rows+
   '<article class="settings-card admin-card"><b>Añadir otra</b><form class="admin-cred-form" data-cred-form=""><label><span>Nombre</span><input type="text" name="name" maxlength="60" required placeholder="NOMBRE_DEL_SECRETO"></label>'+
   '<label><span>Caduca el</span><input type="date" name="expires"></label><label><span>Dónde</span><input type="text" name="place" maxlength="120" placeholder="GitHub, Cloudflare…"></label>'+
   '<label><span>Para qué</span><input type="text" name="note" maxlength="160"></label><div class="admin-cred-actions"><button type="submit" class="btn small">Añadir</button></div></form></article></div>';
 }
 async function saveCred(body){
  const a=auth();const r=await a.apiFetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'credential',...body})});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Error '+r.status);
  creds=d.credentials||creds;fill('creds',credsHtml());if(last)render(last);
 }
 document.addEventListener('submit',e=>{
  const f=e.target.closest&&e.target.closest('[data-cred-form]');if(!f)return;e.preventDefault();
  const fd=new FormData(f),name=f.dataset.credForm||String(fd.get('name')||'').trim();
  saveCred({name,expires:String(fd.get('expires')||''),place:String(fd.get('place')||''),note:String(fd.get('note')||'')}).then(()=>sayToast('Guardado: '+name)).catch(err=>sayToast(err.message,true));
 });
 document.addEventListener('click',e=>{
  const b=e.target.closest&&e.target.closest('[data-cred-remove]');if(!b)return;e.preventDefault();
  if(!confirm('¿Quitar «'+b.dataset.credRemove+'» de la lista? (No borra el secreto, solo el recordatorio)'))return;
  saveCred({name:b.dataset.credRemove,remove:true}).catch(err=>sayToast(err.message,true));
 });
 window.addEventListener('viewinvai:view-changed',e=>{if(e.detail&&e.detail.view==='admin'){selectSection(savedSection(),false);if(last)render(last);load(false);loadCreds(true)}});
 document.addEventListener('click',e=>{
  const t=e.target.closest?e.target:null;if(!t)return;
  if(t.closest('#accountAdmin')){const m=document.getElementById('accountMenu');if(m){m.classList.remove('open');m.setAttribute('aria-hidden','true')}return}
  const sec=t.closest('[data-admin-section]');if(sec){e.preventDefault();selectSection(sec.dataset.adminSection);return}
  if(t.closest('[data-admin-probe]')){e.preventDefault();publicSources=null;load(true,true);return}
  if(t.closest('[data-admin-refresh]')){e.preventDefault();publicSources=null;usage=null;load(false,true)}
 });
})();
