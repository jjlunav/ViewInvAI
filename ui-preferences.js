/*
 * ViewInvAI UI preferences
 * ------------------------
 * Device-local defaults with account-synchronized overrides for signed-in users.
 */
(function(root){
 'use strict';
 const PREFIX='viewinvai:uiPrefs:';
 const cache=new Map(),timers=new Map();

 function clone(value){
  try{return JSON.parse(JSON.stringify(value&&typeof value==='object'?value:{}))}catch(_){return{}}
 }
 function localKey(scope){return PREFIX+String(scope||'')}
 function readLocal(scope){
  try{const value=JSON.parse(localStorage.getItem(localKey(scope))||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch(_){return{}}
 }
 function writeLocal(scope,value){
  try{localStorage.setItem(localKey(scope),JSON.stringify(value||{}))}catch(_){}
 }
 function get(scope,fallback={}){
  if(cache.has(scope))return clone(cache.get(scope));
  const local=readLocal(scope),value=Object.keys(local).length?local:clone(fallback);
  cache.set(scope,value);return clone(value);
 }
 async function load(scope,fallback={}){
  const local=get(scope,fallback);
  const api=root.ViewInvAIAuth&&typeof root.ViewInvAIAuth.apiFetch==='function'?root.ViewInvAIAuth.apiFetch:null;
  const user=root.ViewInvAIAuth&&typeof root.ViewInvAIAuth.getUser==='function'?root.ViewInvAIAuth.getUser():null;
  if(!api||!user)return local;
  try{
   const response=await api('/api/ui-preferences?scope='+encodeURIComponent(scope));
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||'No se pudieron cargar preferencias');
   const remote=data.preferences&&typeof data.preferences==='object'&&!Array.isArray(data.preferences)?data.preferences:{};
   const value=Object.keys(remote).length?remote:local;
   cache.set(scope,value);writeLocal(scope,value);
   root.dispatchEvent(new CustomEvent('viewinvai:ui-preferences',{detail:{scope,preferences:clone(value)}}));
   return clone(value);
  }catch(error){
   console.warn('UI preferences load failed',scope,error);
   return local;
  }
 }
 function save(scope,preferences){
  const value=clone(preferences);cache.set(scope,value);writeLocal(scope,value);
  clearTimeout(timers.get(scope));
  timers.set(scope,setTimeout(async()=>{
   const api=root.ViewInvAIAuth&&typeof root.ViewInvAIAuth.apiFetch==='function'?root.ViewInvAIAuth.apiFetch:null;
   const user=root.ViewInvAIAuth&&typeof root.ViewInvAIAuth.getUser==='function'?root.ViewInvAIAuth.getUser():null;
   if(!api||!user)return;
   try{
    const response=await api('/api/ui-preferences',{method:'PUT',body:JSON.stringify({scope,preferences:value})});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error||'No se pudieron guardar preferencias')}
   }catch(error){console.warn('UI preferences save failed',scope,error)}
  },400));
  return value;
 }
 root.addEventListener('viewinvai:account-ready',event=>{
  if(!(event.detail&&event.detail.user))return;
  for(const scope of cache.keys())load(scope,cache.get(scope)).catch(()=>{});
 });
 root.ViewInvAIUiPreferences=Object.freeze({get,load,save});
})(window);
