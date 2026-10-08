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
 const SECTIONS=['summary','ai','search','market','cloudflare','infra'];
 const SECTION_KEY='viewinvai:admin-section:v1';
 let checked=false,isAdmin=false,loading=false,last=null;
 async function api(path){const a=auth();const r=await a.apiFetch(path);const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(d.error||('Error '+r.status)),{status:r.status});return d}
 async function detectAdmin(){
  const a=auth();
  if(a&&typeof a.getUser==='function'&&!a.getUser()&&currentView()==='admin'){try{show('today')}catch(_){}}
  if(checked||!a||typeof a.apiFetch!=='function'||(typeof a.getUser==='function'&&!a.getUser()))return;
  checked=true;
  try{last=await api('/api/admin');isAdmin=true;const b=document.getElementById('accountAdmin');if(b)b.hidden=false;if(currentView()==='admin'){selectSection(savedSection(),false);render(last)}}catch(_){isAdmin=false;if(currentView()==='admin'){try{show('today')}catch(__){}}}
 }
 ['viewinvai:account-ready','viewinvai:auth-changed'].forEach(n=>window.addEventListener(n,()=>{checked=false;isAdmin=false;last=null;const b=document.getElementById('accountAdmin');if(b)b.hidden=true;setTimeout(detectAdmin,300)}));
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
  return '<article class="settings-card admin-card"><div class="admin-card-head"><strong>'+esc(p.label)+'</strong>'+status(p)+'</div>'+
   '<small>Gratis: '+esc(p.free)+'</small>'+
   '<small>Hoy: '+fmt(p.today.calls)+' llamadas'+(p.today.errors?' · '+fmt(p.today.errors)+' errores':'')+' · Mes: '+fmt(used)+(limit?' de '+fmt(limit):'')+'</small>'+bar(used,limit)+
   (p.test&&p.test.ok&&p.test.detail&&p.test.detail!=='conectado'?'<small>'+esc(p.test.detail)+'</small>':'')+
   (p.month.lastError?'<small class="admin-err">Último error: '+esc(p.month.lastError)+'</small>':'')+
   (p.secret?'<small>Secreto: <code>'+esc(p.secret)+'</code></small>':'')+
   '<a href="'+esc(p.dashboard)+'" target="_blank" rel="noopener noreferrer">Abrir panel ↗</a></article>';
 }
 function providerSection(d,kinds,kicker,title,text){
  const list=(d.providers||[]).filter(p=>kinds.includes(p.kind));
  return heading(kicker,title,text)+'<div class="admin-grid">'+(list.map(providerCard).join('')||'<p class="settings-note">Sin servicios.</p>')+'</div>';
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
   row('Consultas hoy',fmt(calls))+
   row('Caché de mercado',d.turso&&d.turso.active==='turso'?'Turso (activa)':'D1 (Turso no activa)',d.turso&&d.turso.active==='turso'?'admin-st ok':'admin-st warn')+
   row('Cloudflare',!cf.configured?'sin secretos':cf.ok?'leyendo consumo':'error',!cf.configured?'admin-st warn':cf.ok?'admin-st ok':'admin-st bad')+
   '</article><article class="settings-card compact-settings-card"><div class="settings-card-head"><div><span class="settings-kicker">SECRETOS DE ADMINISTRACIÓN</span></div></div>'+
   Object.entries(sec).map(([k,v])=>row('<code>'+esc(k==='TURSO'?'TURSO_URL + TURSO_TOKEN':k)+'</code>',v?'configurado':'falta',v?'admin-st ok':'admin-st warn')).join('')+
   '</article></div>');
  fill('ai',providerSection(d,['IA'],'IA','Inteligencia artificial','Se prueban por orden: Gemini → Groq → OpenRouter → Workers AI. Si uno agota su cupo, pasa al siguiente.'));
  fill('search',providerSection(d,['Búsqueda','Lectura web'],'BÚSQUEDA WEB','Búsqueda y lectura web','Orden: Tavily → Exa → LangSearch → Jina.'));
  fill('market',providerSection(d,['Datos de mercado'],'DATOS DE MERCADO','Cotizaciones y datos',''));
  const w=cf.workers||{},dd=cf.d1||{};
  fill('cloudflare',heading('CLOUDFLARE','Consumo de hoy','Límites del plan gratuito. Se reinicia cada día a las 00:00 UTC.')+
   (!cf.configured?'<p class="settings-note">Añade los secretos <code>CF_ANALYTICS_TOKEN</code> y <code>CF_ACCOUNT_ID</code> para ver el consumo.</p>'
   :cf.detail&&!w.ok&&!dd.ok?'<p class="settings-note admin-err">No se pudo leer el consumo: '+esc(cf.detail)+'</p>'
   :'<div class="admin-grid"><article class="settings-card admin-card"><strong>Worker (web y servidor)</strong>'+(w.ok?'<small>'+fmt(w.requests)+' peticiones de '+fmt(w.limit)+' al día · '+fmt(w.errors)+' errores</small>'+bar(w.requests,w.limit):'<small class="admin-err">'+esc(w.detail||'sin datos')+'</small>')+'</article>'+
    '<article class="settings-card admin-card"><strong>D1 (base de datos personal)</strong>'+(dd.ok?'<small>Filas escritas: '+fmt(dd.rowsWritten)+' de '+fmt(dd.writeLimit)+'</small>'+bar(dd.rowsWritten,dd.writeLimit)+'<small>Filas leídas: '+fmt(dd.rowsRead)+' de '+fmt(dd.readLimit)+'</small>'+bar(dd.rowsRead,dd.readLimit):'<small class="admin-err">'+esc(dd.detail||'sin datos')+'</small>')+'</article></div>'));
  fill('infra',heading('INFRAESTRUCTURA','Dónde está cada cosa','Enlaces directos a cada panel.')+
   '<div class="settings-stack"><article class="settings-card compact-settings-card"><div class="settings-card-head"><div><span class="settings-kicker">PANELES</span></div></div>'+(d.infra||[]).map(x=>'<div class="settings-status-row"><span><a href="'+esc(x.url)+'" target="_blank" rel="noopener noreferrer">'+esc(x.label)+' ↗</a></span><strong class="settings-status">'+esc(x.detail||'')+'</strong></div>').join('')+'</article></div>');
  document.querySelectorAll('#view-admin .admin-bar i[data-pct]').forEach(i=>{i.style.width=i.dataset.pct+'%'});
 }
 async function load(probe=false){
  if(loading)return;loading=true;
  if(probe||!last)fill('summary','<p class="settings-note">'+(probe?'Probando cada servicio…':'Cargando…')+'</p>');
  try{last=await api('/api/admin'+(probe?'?probe=1':''));isAdmin=true;render(last)}
  catch(e){
   if(e.status===403||e.status===401){isAdmin=false;try{show('today')}catch(_){}}
   else fill('summary','<p class="settings-note admin-err">'+esc(e.message)+'</p>');
  }finally{loading=false}
 }
 window.addEventListener('viewinvai:view-changed',e=>{if(e.detail&&e.detail.view==='admin'){selectSection(savedSection(),false);if(last)render(last);load(false)}});
 document.addEventListener('click',e=>{
  const t=e.target.closest?e.target:null;if(!t)return;
  if(t.closest('#accountAdmin')){const m=document.getElementById('accountMenu');if(m){m.classList.remove('open');m.setAttribute('aria-hidden','true')}return}
  const sec=t.closest('[data-admin-section]');if(sec){e.preventDefault();selectSection(sec.dataset.adminSection);return}
  if(t.closest('[data-admin-probe]')){e.preventDefault();load(true);return}
  if(t.closest('[data-admin-refresh]')){e.preventDefault();load(false)}
 });
})();
