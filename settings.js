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
 let toggle=$('#keepScreenAwake');if(toggle)toggle.checked=!!deviceSettings.keepScreenAwake;
 if(!deviceSettings.keepScreenAwake){setWakeLockStatus('Desactivado');return}
 if(!('wakeLock' in navigator)||!navigator.wakeLock||typeof navigator.wakeLock.request!=='function'){setWakeLockStatus('No compatible','error');return}
 if(screenWakeLock&&!screenWakeLock.released)setWakeLockStatus('Activo','active');
 else if(document.visibilityState!=='visible')setWakeLockStatus('En pausa');
 else setWakeLockStatus('Pendiente de activar');
}

let pushBackendConfigured=null,pushDeviceRegistered=null,backendSourceStatus=null,accountAnalysisSettings=null,analysisSettingsBusy=false;
function sourceStatusText(source,key){
 if(!source)return{label:'Sin información',mode:'pending'};
 if(source.configured===false)return{label:'Pendiente',mode:'pending'};
 if(key==='fda'&&source.enhancedConfig===false)return{label:'Integrada',mode:'active'};
 return{label:'Integrada',mode:'active'};
}
function renderSourceSettingsStatus(){
 const sources=backendSourceStatus&&backendSourceStatus.sources||{};
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
  el.classList.toggle('active',info.mode==='active');
  el.classList.toggle('pending',info.mode==='pending');
  el.classList.remove('error');
 }
 const cadence=$('#sourceStatusCadence');
 if(cadence){
  const minutes=Number(backendSourceStatus&&backendSourceStatus.alertsCadenceMinutes);
  cadence.textContent=Number.isFinite(minutes)&&minutes>0?'Barrido · '+minutes+' min':'';
 }
}
async function refreshPushBackendStatus(){
 try{
  const response=await fetch('/api/backend/status',{cache:'no-store'});
  if(!response.ok)return;
  backendSourceStatus=await response.json();
  pushBackendConfigured=backendSourceStatus&&backendSourceStatus.push===true;
 }catch(_){
  backendSourceStatus=null;pushBackendConfigured=false;
 }
 renderPushSettingsStatus();
 renderSourceSettingsStatus();
 renderAnalysisSettings(accountAnalysisSettings);
}
async function refreshPushDeviceStatus(){
 const auth=window.ViewInvAIAuth;
 if(!auth?.getUser?.()||!auth?.isNative?.()){pushDeviceRegistered=null;return}
 try{
  const response=await auth.apiFetch('/api/devices');
  const data=await response.json().catch(()=>({}));
  pushDeviceRegistered=response.ok&&Array.isArray(data.devices)&&data.devices.some(device=>Number(device.enabled)!==0);
 }catch(_){pushDeviceRegistered=false}
 renderPushSettingsStatus();
}
function renderPushSettingsStatus(detail=null){
 const status=$('#pushNotificationStatus');
 if(!status)return;
 status.classList.remove('active','pending','error');
 const auth=window.ViewInvAIAuth;
 if(!auth){status.textContent='Comprobando…';return}
 if(!auth.getUser?.()){status.textContent='Inicia sesión';return}
 if(!auth.isNative?.()){status.textContent='Avisos en la cuenta · push no necesario en web';status.classList.add('active');return}
 if(!auth.hasNativeMessaging?.()){status.textContent='APK pendiente de actualizar';status.classList.add('pending');return}
 if(detail&&detail.permission==='denied'){status.textContent='Permiso denegado';status.classList.add('error');return}
 if(detail&&detail.error){status.textContent='No disponible';status.classList.add('error');return}
 if(detail&&detail.enabled===true){
  pushDeviceRegistered=true;
  status.textContent=pushBackendConfigured===false?'Dispositivo registrado · servidor pendiente':'Activo · dispositivo registrado';
  status.classList.add(pushBackendConfigured===false?'pending':'active');
  return;
 }
 if(auth.getUser?.()&&pushBackendConfigured===false){status.textContent=pushDeviceRegistered?'Dispositivo registrado · servidor pendiente':'Servidor pendiente · dispositivo sin verificar';status.classList.add('pending')}
 else if(auth.getUser?.()&&pushDeviceRegistered===true){status.textContent='Activo · dispositivo registrado';status.classList.add('active')}
 else if(auth.getUser?.()&&pushDeviceRegistered===false){status.textContent='Dispositivo no registrado';status.classList.add('pending')}
 else status.textContent=auth.getUser?.()?'Preparado':'Inicia sesión';
}
async function retryPushRegistration(){
 const auth=window.ViewInvAIAuth;
 if(!auth?.ensurePushRegistration)return;
 const button=$('#enablePushNotifications');if(button){button.textContent='Activando…'}
 try{
  const enabled=!!(await auth.ensurePushRegistration());
  renderPushSettingsStatus({enabled});
  await refreshPushDeviceStatus();
 }finally{if(button){button.textContent='Activar / reintentar';button.disabled=false}}
}
async function testPushNotification(){
 const auth=window.ViewInvAIAuth,button=$('#testPushNotification'),status=$('#pushNotificationStatus');
 if(!auth?.getUser?.()){if(status)status.textContent='Inicia sesión';return}
 if(pushBackendConfigured===false){if(status){status.textContent='Servidor push pendiente';status.classList.add('pending');status.classList.remove('error')}return}
 if(button){button.textContent='Enviando…'}
 try{
  if(!(await auth.ensurePushRegistration?.(true)))throw Error('No se pudo registrar el dispositivo.');
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
 const pulseAi=accountAnalysisSettings?Number(accountAnalysisSettings.notify_pulse_ai)===1:false;
 const radar=accountAnalysisSettings?Number(accountAnalysisSettings.notify_radar)===1:false;
 const portfolio=accountAnalysisSettings?Number(accountAnalysisSettings.notify_portfolio)===1:false;
 const portfolioGoal=accountAnalysisSettings?Number(accountAnalysisSettings.notify_portfolio_goal)===1:false;
 const toggles={globalNotificationsEnabled:enabled,globalNotifyNewsEvents:newsEvents,globalNotifyPulseAi:pulseAi,globalNotifyRadar:radar,globalNotifyPortfolio:portfolio,globalNotifyPortfolioGoal:portfolioGoal};
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
  window.ViewInvAINotificationSettings={enabled,newsEvents,pulseAi,radar,portfolio,portfolioGoal};
  window.dispatchEvent(new CustomEvent('viewinvai:notification-settings',{detail:{enabled,newsEvents,pulseAi,radar,portfolio,portfolioGoal}}));
 }else window.ViewInvAINotificationSettings=null;
 const test=$('#testPushNotification');
 if(test)test.disabled=!accountAnalysisSettings||!enabled||pushBackendConfigured===false||analysisSettingsBusy;
}
async function saveAnalysisSettings(){
 if(analysisSettingsBusy||!accountAnalysisSettings||!window.ViewInvAIAuth?.apiFetch)return;
 const body={
  notificationsEnabled:$('#globalNotificationsEnabled')?.checked===true,
  notifyNewsEvents:$('#globalNotifyNewsEvents')?.checked===true,
  notifyPulseAi:$('#globalNotifyPulseAi')?.checked===true,
  notifyRadar:$('#globalNotifyRadar')?.checked===true,
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

function initSettings(){
 applyTheme(readTheme(),false);
 syncDeviceSettingsUi();
 syncScreenWakeLock();

 document.querySelectorAll('[data-theme-setting]').forEach(button=>button.addEventListener('click',()=>{
  applyTheme(button.dataset.themeSetting==='light'?'light':'dark',true);
 }));

 $('#testPushNotification')?.addEventListener('click',testPushNotification);
 $('#globalNotificationsEnabled')?.addEventListener('change',async event=>{
  await saveAnalysisSettings();
  if(event.target.checked&&window.ViewInvAIAuth?.isNative?.())await retryPushRegistration();
  renderPushSettingsStatus();
 });
 ['globalNotifyNewsEvents','globalNotifyPulseAi','globalNotifyRadar','globalNotifyPortfolio','globalNotifyPortfolioGoal'].forEach(id=>$('#'+id)?.addEventListener('change',saveAnalysisSettings));

 window.addEventListener('viewinvai:push-status',e=>renderPushSettingsStatus(e.detail||null));
 window.addEventListener('viewinvai:account-ready',e=>{
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
