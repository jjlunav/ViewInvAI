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
