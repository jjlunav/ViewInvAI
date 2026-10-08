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
 const toggles={globalNotificationsEnabled:enabled,globalNotifyNewsEvents:newsEvents,globalNotifyCatalystEve:catalystEve,globalNotifyRadarHigh:radarHigh,globalNotifyRadarOpportunity:radarOpportunity,globalNotifyRadarWatch:radarWatch,globalNotifyPrice:price,globalNotifyPortfolio:portfolio,globalNotifyPortfolioGoal:portfolioGoal};
 for(const [id,checked] of Object.entries(toggles)){
  const el=$('#'+id);if(!el)continue;
  el.checked=checked;
  el.disabled=!accountAnalysisSettings||analysisSettingsBusy||(id!=='globalNotificationsEnabled'&&!enabled);
 }
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
  notifyPortfolioGoal:$('#globalNotifyPortfolioGoal')?.checked===true
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

 $('#testPushNotification')?.addEventListener('click',testPushNotification);
 $('#globalNotificationsEnabled')?.addEventListener('change',async event=>{
  await saveAnalysisSettings();
  if(event.target.checked)await retryPushRegistration();
  renderPushSettingsStatus();
 });
 ['globalNotifyNewsEvents','globalNotifyCatalystEve','globalNotifyRadarHigh','globalNotifyRadarOpportunity','globalNotifyRadarWatch','globalNotifyPrice','globalNotifyPortfolio','globalNotifyPortfolioGoal'].forEach(id=>$('#'+id)?.addEventListener('change',saveAnalysisSettings));

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
 const SECTIONS=['summary','ai','search','market','infra','app'];
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
  if(persist){try{localStorage.setItem(SECTION_KEY,next)}catch(_){}}
  requestAnimationFrame(()=>window.ViewInvAIShell?.resetChrome?.());
 }
 function savedSection(){try{return localStorage.getItem(SECTION_KEY)||'summary'}catch(_){return'summary'}}
 function bar(used,limit){if(!limit)return'';const pct=Math.min(100,Math.round(used/limit*100));return '<div class="admin-bar" title="'+pct+' %"><i data-pct="'+pct+'" class="'+(pct>=85?'hot':pct>=60?'warm':'')+'"></i></div>'}
 const heading=(kicker,title,text)=>'<div class="settings-section-heading"><span>'+esc(kicker)+'</span><h2>'+esc(title)+'</h2>'+(text?'<p>'+text+'</p>':'')+'</div>';
 const status=p=>!p.configured?'<b class="admin-st warn">⚠️ sin clave</b>':p.cooldownUntil?'<b class="admin-st warn">⏸ en pausa (cupo)</b>':p.test?(p.test.ok?'<b class="admin-st ok">✅ conectado</b>':'<b class="admin-st bad">❌ '+esc(p.test.detail||'error')+'</b>'):'<b class="admin-st">● con clave</b>';
 function providerCard(p){
  const used=p.test&&p.test.used!=null?p.test.used:p.month.calls,limit=p.test&&p.test.limit!=null?p.test.limit:p.monthlyLimit;
  return '<article class="settings-card admin-card">'+cardHead(p.label,p.dashboard)+status(p)+
   '<small>Gratis: '+esc(p.free)+'</small>'+(p.unused?'<small class="admin-st warn">Clave guardada, pero la app aún no usa este servicio.</small>':'')+
   '<small>Hoy: '+fmt(p.today.calls)+' llamadas'+(p.today.errors?' · '+fmt(p.today.errors)+' errores':'')+' · Mes: '+fmt(used)+(limit?' de '+fmt(limit):'')+'</small>'+bar(used,limit)+
   (p.test&&p.test.ok&&p.test.detail&&p.test.detail!=='conectado'?'<small>'+esc(p.test.detail)+'</small>':'')+
   (p.month.lastError?'<small class="admin-err">Último error: '+esc(p.month.lastError)+'</small>':'')+
   (p.secret?'<small>Secreto: <code>'+esc(p.secret)+'</code></small>':'')+'</article>';
 }
 function providerSection(d,kinds,kicker,title,text){
  const list=(d.providers||[]).filter(p=>kinds.includes(p.kind));
  return heading(kicker,title,text)+'<div class="admin-grid">'+(list.map(providerCard).join('')||'<p class="settings-note">Sin servicios.</p>')+'</div>';
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
  const cfMissing=note('Añade <code>CF_ANALYTICS_TOKEN</code> y <code>CF_ACCOUNT_ID</code> para ver el consumo.');
  const worker=!cf.configured?cfMissing:!w.ok?err(w.detail||cf.detail):
   metric('Peticiones hoy',w.requests,w.limit)+note(fmt(w.errors)+' errores ('+(w.requests?Math.round(w.errors/w.requests*1000)/10:0)+' %) · '+fmt(w.subrequests)+' llamadas a servicios externos')+
   ((w.errorsByStatus||[]).length?'<small>Motivo de los fallos: '+w.errorsByStatus.map(x=>esc(STATUS_ES[x.status]||x.status)+' '+fmt(x.count)).join(' · ')+'</small>':'');
  const d1=!cf.configured?cfMissing:!dd.ok?err(dd.detail):metric('Filas escritas hoy',dd.rowsWritten,dd.writeLimit)+metric('Filas leídas hoy',dd.rowsRead,dd.readLimit);
  const kvb=!cf.configured?cfMissing:!kv.ok?err(kv.detail):metric('Lecturas hoy',kv.reads,kv.readLimit)+metric('Escrituras hoy',kv.writes,kv.writeLimit)+metric('Borrados hoy',kv.deletes,kv.writeLimit)+metric('Listados hoy',kv.lists,kv.writeLimit);
  const turso=(t.active==='turso'?'<b class="admin-st ok">✅ en uso</b>':'<b class="admin-st warn">⚠️ no activa: las cachés van a D1</b>')+
   (!tu.configured?note('Añade <code>TURSO_API_TOKEN</code> (token de la plataforma Turso) para ver el consumo.'):!tu.ok?err(tu.detail):
    metric('Filas leídas este mes',tu.rowsRead,tu.readLimit)+metric('Filas escritas este mes',tu.rowsWritten,tu.writeLimit)+metric('Almacenamiento',tu.storageBytes,tu.storageLimit,gb));
  const actions=!gh.configured?note('Añade <code>GH_ANALYTICS_TOKEN</code> para ver los minutos del mes.'):!gh.ok?err(gh.detail):
   metric('Minutos este mes ('+esc(gh.minutesSource)+')',gh.minutes,gh.limit)+note(fmt(gh.runs)+' ejecuciones · '+fmt(gh.failed)+' fallidas')+
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
  const a=d.app||{},v=n=>n===null||n===undefined?'—':fmt(n);
  const row=(label,val)=>'<div class="settings-status-row"><span>'+label+'</span><strong class="settings-status">'+val+'</strong></div>';
  return heading('DATOS DE LA APP','Uso interno','Solo recuentos: ningún dato personal sale de D1.')+
   '<div class="settings-stack"><article class="settings-card compact-settings-card"><div class="settings-card-head"><div><span class="settings-kicker">CUENTAS</span></div></div>'+
   row('Usuarios',v(a.users))+row('Dispositivos con avisos',v(a.devices))+'</article>'+
   '<article class="settings-card compact-settings-card"><div class="settings-card-head"><div><span class="settings-kicker">CARTERAS</span></div></div>'+
   row('Carteras de acciones',v(a.portfolios))+row('Posiciones de acciones',v(a.positions))+row('Carteras de fondos',v(a.fund_portfolios))+row('Posiciones de fondos',v(a.fund_positions))+
   row('Objetivos activos',v(a.portfolio_goals))+row('Decisiones «Decidir qué hacer»',v(a.position_decisions))+'</article></div>';
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
   ['Trade Republic / LSX','tradeRepublic','https://www.ls-x.de/',tr.ok===true,tr.ok===true?'precios en vivo':(tr.error||'sin precios')],
   ['Nasdaq / EE. UU.','nasdaq','https://www.nasdaq.com/'],['SEC / EDGAR','sec','https://www.sec.gov/edgar/search/'],
   ['ClinicalTrials.gov','clinicalTrials','https://clinicaltrials.gov/'],['FDA / openFDA','fda','https://open.fda.gov/']
  ].map(([label,key,link,okOverride,txt])=>{const x=src[key];const ok=okOverride!==undefined?okOverride:!!x&&x.configured!==false&&!x.error;
   return card(label,link,!publicSources?note('Comprobando…'):okOverride===undefined&&!x?note('Sin datos de estado.'):st(ok,txt||(ok?'operativa':x.error||'sin configurar')))}).join('');
  return providerSection(d,['Datos de mercado'],'DATOS DE MERCADO','Cotizaciones y datos','Con clave (Finnhub) y fuentes públicas sin clave.')+
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
   (failed?row('Con error',String(failed),'admin-st bad'):'')+
   (noKey?row('Sin clave',String(noKey),'admin-st warn'):'')+
   (paused?row('En pausa por cupo',String(paused),'admin-st warn'):'')+
   row('Consultas hoy a IA y búsqueda web <small>(análisis de eventos)</small>',fmt(calls))+
   row('Caché de mercado',d.turso&&d.turso.active==='turso'?'Turso (activa)':'D1 (Turso no activa)',d.turso&&d.turso.active==='turso'?'admin-st ok':'admin-st warn')+
   row('Cloudflare',!cf.configured?'sin secretos':cf.ok?'leyendo consumo':'error',!cf.configured?'admin-st warn':cf.ok?'admin-st ok':'admin-st bad')+
   '</article><article class="settings-card compact-settings-card"><div class="settings-card-head"><div><span class="settings-kicker">SECRETOS DE ADMINISTRACIÓN</span></div></div>'+
   Object.entries(sec).map(([k,v])=>row('<code>'+esc(k==='TURSO'?'TURSO_URL + TURSO_TOKEN':k)+'</code>',v?'configurado':'falta',v?'admin-st ok':'admin-st warn')).join('')+
   '</article></div>');
  fill('ai',providerSection(d,['IA'],'IA','Inteligencia artificial','Se prueban por orden: Gemini → Groq → OpenRouter → Cohere → SambaNova → Cerebras → Workers AI. Si uno no tiene clave o agota su cupo, pasa al siguiente.'));
  fill('search',providerSection(d,['Búsqueda','Lectura web'],'BÚSQUEDA WEB','Búsqueda y lectura web','Orden: Tavily → Exa → LangSearch → Jina.'));
  fill('market',marketHtml(d));if(!publicSources)loadPublicSources();
  fill('infra',infraHtml(d));
  fill('app',appHtml(d));
  document.querySelectorAll('#view-admin .admin-bar i[data-pct]').forEach(i=>{i.style.width=i.dataset.pct+'%'});
 }
 async function load(probe=false){
  if(loading)return;loading=true;
  if(probe||!last)fill('summary','<p class="settings-note">'+(probe?'Probando cada servicio…':'Cargando…')+'</p>');
  try{last=await api('/api/admin'+(probe?'?probe=1':''));isAdmin=true;render(last)}
  catch(e){
   if(e.status===403||e.status===401){isAdmin=false;try{show('today')}catch(_){}}
   else{selectSection('summary',false);fill('summary','<p class="settings-note admin-err">No se pudo cargar: '+esc(e.message)+'</p>')}
  }finally{loading=false}
 }
 window.addEventListener('viewinvai:view-changed',e=>{if(e.detail&&e.detail.view==='admin'){selectSection(savedSection(),false);if(last)render(last);load(false)}});
 document.addEventListener('click',e=>{
  const t=e.target.closest?e.target:null;if(!t)return;
  if(t.closest('#accountAdmin')){const m=document.getElementById('accountMenu');if(m){m.classList.remove('open');m.setAttribute('aria-hidden','true')}return}
  const sec=t.closest('[data-admin-section]');if(sec){e.preventDefault();selectSection(sec.dataset.adminSection);return}
  if(t.closest('[data-admin-probe]')){e.preventDefault();publicSources=null;load(true);return}
  if(t.closest('[data-admin-refresh]')){e.preventDefault();publicSources=null;load(false)}
 });
})();
