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

let pushBackendConfigured=null;
async function refreshPushBackendStatus(){
 try{
  let response=await fetch('/api/backend/status',{cache:'no-store'});
  if(!response.ok)return;
  let data=await response.json();
  pushBackendConfigured=data&&data.push===true;
  renderPushSettingsStatus();
 }catch(_){}
}
function renderPushSettingsStatus(detail=null){
 let status=$('#pushNotificationStatus'),button=$('#enablePushNotifications');
 if(!status||!button)return;
 let auth=window.ViewInvAIAuth;
 if(!auth){
  status.textContent='Comprobando…';button.disabled=true;return;
 }
 if(!auth.isNative?.()){
  status.textContent='Solo APK Android';button.disabled=true;return;
 }
 if(!auth.hasNativeMessaging?.()){
  status.textContent='APK pendiente de actualizar';button.disabled=true;return;
 }
 if(detail&&detail.enabled===true){
  status.textContent=pushBackendConfigured===false?'Dispositivo activo · servidor pendiente':'Activo';
  status.classList.toggle('active',pushBackendConfigured!==false);
  status.classList.toggle('error',pushBackendConfigured===false);
  button.disabled=false;return;
 }
 status.classList.remove('active');
 if(detail&&detail.permission==='denied'){
  status.textContent='Permiso denegado';status.classList.add('error');button.disabled=false;return;
 }
 if(detail&&detail.error){
  status.textContent='No disponible';status.classList.add('error');button.disabled=false;return;
 }
 status.classList.remove('error');
 if(auth.getUser?.()&&pushBackendConfigured===false)status.textContent='Servidor push pendiente';
 else status.textContent=auth.getUser?.()?'Preparado para activar':'Inicia sesión';
 button.disabled=!auth.getUser?.();
}
async function retryPushRegistration(){
 let auth=window.ViewInvAIAuth;
 if(!auth?.ensurePushRegistration)return;
 let button=$('#enablePushNotifications');if(button){button.disabled=true;button.textContent='Activando…'}
 try{
  let ok=await auth.ensurePushRegistration();
  renderPushSettingsStatus({enabled:!!ok});
 }finally{
  if(button){button.textContent='Activar / reintentar';button.disabled=false}
 }
}

let accountAnalysisSettings=null,analysisSettingsBusy=false;
function clampSetting(value,min,max,fallback){
 let n=Math.round(Number(value));return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;
}
function renderAnalysisSettings(settings=null){
 accountAnalysisSettings=settings&&typeof settings==='object'?settings:null;
 const map={
  analysisPositionsMinutes:['analysis_positions_minutes',5,240,10],
  analysisWatchlistMinutes:['analysis_watchlist_minutes',10,1440,30],
  minBuyConfidence:['min_buy_confidence',60,99,85],
  minSellConfidence:['min_sell_confidence',60,99,80],
  notifyScoreChange:['notify_score_change',5,60,20]
 };
 for(const [id,[key,min,max,fallback]] of Object.entries(map)){
  let el=$('#'+id);if(!el)continue;
  let raw=accountAnalysisSettings&&accountAnalysisSettings[key];
  el.value=clampSetting(raw,min,max,fallback);
  el.disabled=!accountAnalysisSettings||analysisSettingsBusy;
 }
 const enabled=accountAnalysisSettings?Number(accountAnalysisSettings.notifications_enabled)!==0:true;
 const newsEvents=accountAnalysisSettings?Number(accountAnalysisSettings.notify_news_events)!==0:true;
 const pulseAi=accountAnalysisSettings?Number(accountAnalysisSettings.notify_pulse_ai)!==0:true;
 let masterToggle=$('#globalNotificationsEnabled'),newsToggle=$('#globalNotifyNewsEvents'),pulseToggle=$('#globalNotifyPulseAi');
 if(masterToggle){masterToggle.checked=enabled;masterToggle.disabled=!accountAnalysisSettings||analysisSettingsBusy}
 if(newsToggle){newsToggle.checked=newsEvents;newsToggle.disabled=!accountAnalysisSettings||analysisSettingsBusy||!enabled}
 if(pulseToggle){pulseToggle.checked=pulseAi;pulseToggle.disabled=!accountAnalysisSettings||analysisSettingsBusy||!enabled}
 document.querySelectorAll('[data-notification-child-setting]').forEach(row=>row.classList.toggle('is-disabled',!enabled));
 let globalStatus=$('#globalNotificationSettingsStatus');
 if(globalStatus)globalStatus.textContent=accountAnalysisSettings?(analysisSettingsBusy?'Guardando…':(enabled?'Notificaciones activadas.':'Notificaciones desactivadas.')):'Inicia sesión para cambiar estos avisos.';
 if(accountAnalysisSettings){
  window.ViewInvAINotificationSettings={enabled,newsEvents,pulseAi};
  window.dispatchEvent(new CustomEvent('viewinvai:notification-settings',{detail:{enabled,newsEvents,pulseAi}}));
 }else{
  window.ViewInvAINotificationSettings=null;
 }
 let button=$('#saveAnalysisSettings');if(button)button.disabled=!accountAnalysisSettings||analysisSettingsBusy;
 let status=$('#analysisSettingsStatus');if(status){
  status.textContent=accountAnalysisSettings?(analysisSettingsBusy?'Guardando…':'Sincronizado con tu cuenta.'):'Inicia sesión para sincronizar estos ajustes.';
 }
}
async function saveAnalysisSettings(){
 if(analysisSettingsBusy||!accountAnalysisSettings||!window.ViewInvAIAuth||typeof window.ViewInvAIAuth.apiFetch!=='function')return;
 let body={
  analysisPositionsMinutes:clampSetting($('#analysisPositionsMinutes')?.value,5,240,10),
  analysisWatchlistMinutes:clampSetting($('#analysisWatchlistMinutes')?.value,10,1440,30),
  minBuyConfidence:clampSetting($('#minBuyConfidence')?.value,60,99,85),
  minSellConfidence:clampSetting($('#minSellConfidence')?.value,60,99,80),
  notifyScoreChange:clampSetting($('#notifyScoreChange')?.value,5,60,20),
  notificationsEnabled:$('#globalNotificationsEnabled')?.checked!==false,
  notifyNewsEvents:$('#globalNotifyNewsEvents')?.checked!==false,
  notifyPulseAi:$('#globalNotifyPulseAi')?.checked!==false
 };
 analysisSettingsBusy=true;renderAnalysisSettings(accountAnalysisSettings);
 try{
  let response=await window.ViewInvAIAuth.apiFetch('/api/settings',{method:'PATCH',body:JSON.stringify(body)});
  let data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'No se pudieron guardar los ajustes.');
  accountAnalysisSettings=data.settings||accountAnalysisSettings;
  let status=$('#analysisSettingsStatus');if(status)status.textContent='Ajustes guardados.';
  let globalStatus=$('#globalNotificationSettingsStatus');if(globalStatus)globalStatus.textContent='Avisos globales actualizados.';
 }catch(e){
  let message=e&&e.message?e.message:'No se pudieron guardar los ajustes.';
  let status=$('#analysisSettingsStatus');if(status)status.textContent=message;
  let globalStatus=$('#globalNotificationSettingsStatus');if(globalStatus)globalStatus.textContent=message;
 }finally{
  analysisSettingsBusy=false;renderAnalysisSettings(accountAnalysisSettings);
 }
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

 $('#saveAnalysisSettings')?.addEventListener('click',saveAnalysisSettings);
 $('#enablePushNotifications')?.addEventListener('click',retryPushRegistration);
 ['globalNotificationsEnabled','globalNotifyNewsEvents','globalNotifyPulseAi'].forEach(id=>$('#'+id)?.addEventListener('change',saveAnalysisSettings));

 window.addEventListener('viewinvai:push-status',e=>renderPushSettingsStatus(e.detail||null));
 window.addEventListener('viewinvai:account-ready',e=>{
  renderAnalysisSettings(e.detail&&e.detail.settings||null);
  renderPushSettingsStatus();
 });
 window.addEventListener('viewinvai:auth-changed',e=>{
  if(!(e.detail&&e.detail.user))renderAnalysisSettings(null);
  renderPushSettingsStatus();
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
  refreshPushBackendStatus();
 },700);
}
