// Seguridad en el dispositivo: almacén cifrado de secretos y bloqueo con huella o cara (APK).
// Se carga en <head> para tapar la app antes de pintar nada cuando el bloqueo está activo.
(function(){
 'use strict';
 const LOCK_KEY='viewinvai:applock',SEC_PREFIX='viewinvai:sec:',RELOCK_MS=30000;
 const cap=()=>window.Capacitor;
 const isNative=()=>{try{return !!(cap()&&cap().isNativePlatform&&cap().isNativePlatform())}catch(_){return false}};
 const bio=()=>{const c=cap();return c&&c.Plugins&&c.Plugins.NativeBiometric||null};
 const lockEnabled=()=>{try{return localStorage.getItem(LOCK_KEY)==='1'}catch(_){return false}};
 const setLockEnabled=on=>{try{on?localStorage.setItem(LOCK_KEY,'1'):localStorage.removeItem(LOCK_KEY)}catch(_){}};

 // ---------- Almacén de secretos ----------
 // APK: Android Keystore (plugin nativo). Web: AES-GCM con una clave no exportable guardada en IndexedDB;
 // en localStorage solo queda el texto cifrado, que no sirve fuera de este navegador.
 const SERVER='app.viewinvai.secure.';
 let keyPromise=null;
 function idb(){
  return new Promise((res,rej)=>{
   if(!window.indexedDB)return rej(Error('Sin IndexedDB'));
   const r=indexedDB.open('viewinvai-secure',1);
   r.onupgradeneeded=()=>r.result.createObjectStore('keys');
   r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||Error('IndexedDB'));
  });
 }
 function idbReq(db,mode,fn){return new Promise((res,rej)=>{const tx=db.transaction('keys',mode),r=fn(tx.objectStore('keys'));tx.oncomplete=()=>res(r&&r.result);tx.onerror=()=>rej(tx.error)})}
 function cryptoKey(){
  if(keyPromise)return keyPromise;
  keyPromise=(async()=>{
   if(!window.crypto||!crypto.subtle)throw Error('Sin WebCrypto');
   const db=await idb();
   let key=await idbReq(db,'readonly',s=>s.get('main'));
   if(!key){key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);await idbReq(db,'readwrite',s=>s.put(key,'main'))}
   return key;
  })();
  keyPromise.catch(()=>{keyPromise=null});
  return keyPromise;
 }
 const b64=buf=>btoa(String.fromCharCode(...new Uint8Array(buf)));
 const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
 async function webSet(name,value){
  const key=await cryptoKey(),iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value));
  localStorage.setItem(SEC_PREFIX+name,JSON.stringify({v:1,iv:b64(iv),ct:b64(ct)}));
 }
 async function webGet(name){
  let raw=null;try{raw=JSON.parse(localStorage.getItem(SEC_PREFIX+name)||'null')}catch(_){}
  if(!raw||!raw.iv||!raw.ct)return null;
  try{const key=await cryptoKey();return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(raw.iv)},key,unb64(raw.ct)))}
  catch(_){return null}
 }
 const nativeStore=()=>isNative()&&bio()&&typeof bio().setCredentials==='function';
 const Secure={
  async get(name){
   if(nativeStore()){try{const c=await bio().getCredentials({server:SERVER+name});return c&&c.password||null}catch(_){return null}}
   return webGet(name);
  },
  async set(name,value){
   if(!value)return Secure.remove(name);
   if(nativeStore()){await bio().setCredentials({server:SERVER+name,username:'viewinvai',password:String(value)});return true}
   await webSet(name,String(value));return true;
  },
  async remove(name){
   try{localStorage.removeItem(SEC_PREFIX+name)}catch(_){}
   if(nativeStore()){try{await bio().deleteCredentials({server:SERVER+name})}catch(_){}}
   return true;
  },
  where(){return nativeStore()?'el almacén cifrado de Android':'este navegador, cifrado'}
 };
 window.ViewInvAISecure=Secure;

 // ---------- Bloqueo de la app (solo APK) ----------
 let unlocking=false,settingUp=false,hiddenAt=0,overlay=null;
 if(isNative()&&lockEnabled())document.documentElement.classList.add('app-locked');
 function ensureOverlay(){
  if(overlay&&overlay.isConnected)return overlay;
  overlay=document.createElement('div');
  overlay.id='appLock';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','ViewInvAI bloqueada');
  overlay.innerHTML='<div class="app-lock-card"><img src="favicon.svg" alt="" width="64" height="64"><strong>ViewInvAI bloqueada</strong><span data-lock-msg>Usa tu huella o tu cara para entrar.</span><button type="button" class="btn" data-lock-unlock>Desbloquear</button></div>';
  overlay.addEventListener('click',e=>{if(e.target.closest('[data-lock-unlock]'))unlock()});
  document.body.appendChild(overlay);
  return overlay;
 }
 function lock(){
  if(!isNative()||!lockEnabled()||!bio())return;
  document.documentElement.classList.add('app-locked');
  if(document.body)ensureOverlay();
 }
 function release(){document.documentElement.classList.remove('app-locked');if(overlay)overlay.remove();overlay=null}
 async function unlock(){
  if(unlocking)return;
  const b=bio();
  if(!b){release();return}
  unlocking=true;
  const msg=ensureOverlay().querySelector('[data-lock-msg]');
  try{
   const av=await b.isAvailable({useFallback:true}).catch(()=>null);
   // Si el móvil ya no tiene ningún bloqueo configurado, no dejamos al usuario fuera.
   if(av&&!av.isAvailable&&av.deviceIsSecure===false){release();return}
   await b.verifyIdentity({reason:'Desbloquear ViewInvAI',title:'Desbloquear ViewInvAI',subtitle:'Tus carteras y datos de bróker',negativeButtonText:'Cancelar',useFallback:true,maxAttempts:5});
   release();
  }catch(_){if(msg)msg.textContent='No se ha podido verificar. Toca «Desbloquear» para intentarlo de nuevo.'}
  finally{unlocking=false}
 }
 // El diálogo de huella abre su propia actividad: esa pausa no cuenta como salir de la app.
 function onHide(){if(!lockEnabled()||!isNative()||unlocking||settingUp)return;hiddenAt=Date.now();lock()}
 function onShow(){
  if(unlocking||!lockEnabled()||!isNative()||!document.documentElement.classList.contains('app-locked'))return;
  if(hiddenAt&&Date.now()-hiddenAt<RELOCK_MS){release();return}
  unlock();
 }
 function bindLifecycle(){
  const c=cap(),app=c&&c.Plugins&&c.Plugins.App;
  if(app&&typeof app.addListener==='function')app.addListener('appStateChange',s=>{s&&s.isActive?onShow():onHide()});
  else document.addEventListener('visibilitychange',()=>document.hidden?onHide():onShow());
 }

 // ---------- Ajuste en Configuración ----------
 async function initSettings(){
  const card=document.getElementById('appLockSettingsCard'),toggle=document.getElementById('appLockEnabled'),status=document.getElementById('appLockStatus');
  if(!card||!toggle)return;
  const b=bio();
  if(!isNative()||!b){card.hidden=true;return}
  card.hidden=false;
  const paint=text=>{toggle.checked=lockEnabled();if(status)status.textContent=text||(lockEnabled()?'Activado':'Desactivado')};
  paint();
  toggle.addEventListener('change',async()=>{
   if(!toggle.checked){setLockEnabled(false);paint();return}
   toggle.disabled=true;settingUp=true;
   try{
    const av=await b.isAvailable({useFallback:true});
    if(!av||!av.isAvailable){setLockEnabled(false);paint('Configura una huella, cara o PIN en los ajustes del móvil');return}
    await b.verifyIdentity({reason:'Activar el bloqueo de ViewInvAI',title:'Activar bloqueo',negativeButtonText:'Cancelar',useFallback:true});
    setLockEnabled(true);paint();
   }catch(_){setLockEnabled(false);paint('No activado: verificación cancelada')}
   finally{toggle.disabled=false;setTimeout(()=>{settingUp=false},1500)}
  });
 }

 function start(){
  bindLifecycle();initSettings();
  if(document.documentElement.classList.contains('app-locked')){if(bio())unlock();else release()}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
