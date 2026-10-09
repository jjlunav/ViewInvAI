/* ViewInvAI · idioma de la aplicación.
 * - Idioma elegido en Configuración o, con «Traducir automáticamente», el del dispositivo.
 * - En español, solo se traducen los textos externos (noticias, fuentes) marcados con
 *   data-i18n-content que no estén ya en español.
 * - En cualquier otro idioma se traduce toda la interfaz al vuelo (textos, title, placeholder y
 *   aria-label), con la IA del servidor y caché común; aquí se guarda una caché local por idioma.
 * Nunca se envía lo que escribe el usuario: lo marcado con translate="no", nombres de carteras,
 * correos, tickers y nombres de empresa se quedan como están.
 */
(function(){
 'use strict';
 const LANGS={es:'Español',en:'English',fr:'Français',de:'Deutsch',it:'Italiano',pt:'Português',ca:'Català',nl:'Nederlands',pl:'Polski'};
 const K_LANG='viewinvai.lang',K_AUTO='viewinvai.langAuto',K_CACHE='viewinvai.i18n.';
 const get=k=>{try{return localStorage.getItem(k)}catch(_){return null}};
 const put=(k,v)=>{try{localStorage.setItem(k,v)}catch(_){}};
 function deviceLang(){
  const l=String((navigator.languages&&navigator.languages[0])||navigator.language||'es').toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(l)?l:'es';
 }
 const autoOn=()=>get(K_AUTO)!=='0';
 const chosen=()=>{const l=get(K_LANG);return l&&/^[a-z]{2,3}$/.test(l)?l:'es'};
 const lang=autoOn()?deviceLang():chosen();
 const mode=lang==='es'?'content':'ui';
 document.documentElement.lang=lang;

 const SKIP_TAGS=new Set(['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','INPUT','CODE','PRE','SVG','svg','CANVAS','IFRAME','TEMPLATE','KBD']);
 const NO='[translate="no"],.notranslate,[contenteditable="true"],[data-no-i18n]';
 // Nombres de empresa, tickers y símbolos: no se traducen (y así no se gasta en miles de valores).
 const NAMES='[class*="ticker"],[class*="symbol"],[class$="-name"],[class*="-name "],[class*="-name-"],.asset-card-copy>strong,.fund-table-fund-main>strong,.fund-remote-row strong,.fund-detail-hero h3,.ai-int-name';
 const ATTRS=['title','placeholder','aria-label'];
 const protectedText=new Set();

 // Detección rápida español / inglés para no traducir lo que ya está en el idioma de destino.
 const ES_RE=/\b(el|la|los|las|del|que|por|para|con|una|un|se|es|al|su|sus|más|como|tras|sobre)\b/gi;
 const EN_RE=/\b(the|of|and|to|for|on|with|is|by|at|from|as|its|be|are|this|that|after|over|will|has)\b/gi;
 function detect(s){
  if(/[ñ¿¡]|ción\b|ciones\b/i.test(s))return 'es';
  const e=(s.match(ES_RE)||[]).length,n=(s.match(EN_RE)||[]).length;
  return n>e?'en':e>n?'es':null;
 }
 function worth(core){
  if(!core||core.length>700)return false;
  if(!/\p{L}[\s\S]*\p{L}/u.test(core))return false;
  if(/^[A-Z0-9][A-Z0-9.\-:/]{0,15}$/.test(core))return false;   // ticker, ISIN o código sueltos
  if(/@|https?:\/\/|www\./i.test(core))return false;              // correos y enlaces
  for(const p of protectedText)if(core===p||(p.length>=4&&core.includes(p)))return false;
  const d=detect(core);
  return d!==lang;
 }
 // Los números se sacan como {0},{1}…: «6 noticias» y «7 noticias» comparten traducción.
 function template(core){const nums=[];const t=core.replace(/\d+(?:[.,: ']\d+)*/g,m=>{nums.push(m);return '{'+(nums.length-1)+'}'});return{t,nums}}
 const fill=(tr,nums)=>tr.replace(/\{(\d+)\}/g,(m,i)=>nums[+i]!==undefined?nums[+i]:m);

 // Caché local por idioma (las más recientes; tope para no llenar el almacenamiento).
 const cache=new Map();
 try{const o=JSON.parse(get(K_CACHE+lang)||'{}');for(const k of Object.keys(o))cache.set(k,o[k])}catch(_){}
 let saveTimer=0;
 function saveSoon(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{
  while(cache.size>6000)cache.delete(cache.keys().next().value);
  put(K_CACHE+lang,JSON.stringify(Object.fromEntries(cache)));
 },1500)}

 const recs=new WeakMap(),attrRecs=new WeakMap();
 const waiting=new Map(),failed=new Set(),inflight=new Set();
 let flushTimer=0,running=0,pausedUntil=0;

 function translated(v,cb){
  const m=v.match(/^(\s*)([\s\S]*?)(\s*)$/),core=m[2];
  if(!worth(core))return null;
  const {t,nums}=template(core);
  if(cache.has(t))return m[1]+fill(cache.get(t),nums)+m[3];
  if(!failed.has(t))cb(t);
  return null;
 }
 function want(t,target){
  if(!waiting.has(t))waiting.set(t,new Set());
  waiting.get(t).add(target);
  if(!flushTimer)flushTimer=setTimeout(flush,250);
 }
 function applyText(node){
  const v=node.nodeValue,r=recs.get(node);
  if(r&&r.out===v)return;
  const out=translated(v,t=>want(t,node));
  if(out!==null&&out!==v){recs.set(node,{out});node.nodeValue=out}
 }
 function applyAttrs(el){
  if(mode!=='ui')return;
  let r=attrRecs.get(el);
  for(const a of ATTRS){
   const v=el.getAttribute(a);if(!v)continue;
   if(r&&r[a]===v)continue;
   const out=translated(v,t=>want(t,el));
   if(out!==null&&out!==v){if(!r){r={};attrRecs.set(el,r)}r[a]=out;el.setAttribute(a,out)}
  }
 }
 function excluded(el){
  if(!el)return true;
  if(SKIP_TAGS.has(el.tagName))return true;
  if(el.closest(NO))return true;
  if(mode==='ui'&&el.closest(NAMES))return true;
  if(mode==='content'&&!el.closest('[data-i18n-content]'))return true;
  return false;
 }
 function walk(root){
  const tw=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{acceptNode(n){
   if(n.nodeType===3)return NodeFilter.FILTER_ACCEPT;
   if(SKIP_TAGS.has(n.tagName)||n.matches(NO)||(mode==='ui'&&n.matches(NAMES)))return NodeFilter.FILTER_REJECT;
   if(mode==='ui')applyAttrs(n);
   return NodeFilter.FILTER_SKIP;
  }});
  let n;while((n=tw.nextNode()))applyText(n);
 }
 function scan(node){
  if(!node)return;
  if(node.nodeType===3){if(!excluded(node.parentElement))applyText(node);return}
  if(node.nodeType!==1)return;
  if(mode==='content'){
   const own=node.closest('[data-i18n-content]');
   const roots=own?[own]:node.querySelectorAll('[data-i18n-content]');
   for(const r of roots)if(!excluded(r))walk(r);
   return;
  }
  if(excluded(node))return;
  applyAttrs(node);walk(node);
 }

 function apiUrl(path){
  try{if(window.ViewInvAIRuntime&&typeof window.ViewInvAIRuntime.url==='function')return window.ViewInvAIRuntime.url(path)}catch(_){}
  const native=!!(window.Capacitor&&typeof window.Capacitor.isNativePlatform==='function'&&window.Capacitor.isNativePlatform());
  return native?'https://viewinvai.sonarlab.workers.dev'+path:path;
 }
 async function flush(){
  flushTimer=0;
  if(Date.now()<pausedUntil){flushTimer=setTimeout(flush,pausedUntil-Date.now());return}
  if(running>=2)return;
  const batch=[...waiting.keys()].filter(t=>!inflight.has(t)).slice(0,60);
  if(!batch.length)return;
  batch.forEach(t=>inflight.add(t));running++;
  try{
   const r=await fetch(apiUrl('/api/translate'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:lang,t:batch})});
   if(r.status===429){pausedUntil=Date.now()+60000;return}
   const d=await r.json().catch(()=>({}));
   const out=Array.isArray(d.t)?d.t:[];
   batch.forEach((t,i)=>{
    const v=out[i];
    if(typeof v==='string'&&v)cache.set(t,v);else failed.add(t);
    const targets=waiting.get(t);waiting.delete(t);
    if(targets)for(const x of targets){if(!x.isConnected)continue;if(x.nodeType===3)applyText(x);else applyAttrs(x)}
   });
   saveSoon();
  }catch(_){batch.forEach(t=>{failed.add(t);waiting.delete(t)})}
  finally{batch.forEach(t=>inflight.delete(t));running--;if(waiting.size&&!flushTimer)flushTimer=setTimeout(flush,Date.now()<pausedUntil?pausedUntil-Date.now():120)}
 }

 function start(){
  scan(document.body);
  new MutationObserver(list=>{
   for(const m of list){
    if(m.type==='childList')m.addedNodes.forEach(scan);
    else if(m.type==='characterData'){const r=recs.get(m.target);if(!(r&&r.out===m.target.nodeValue))scan(m.target)}
    else if(m.type==='attributes'&&!excluded(m.target))applyAttrs(m.target);
   }
  }).observe(document.body,mode==='ui'?{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:ATTRS}:{childList:true,subtree:true,characterData:true});
 }

 // Tarjeta «Idioma» de Configuración.
 function languageName(code){
  if(LANGS[code])return LANGS[code];
  try{const n=new Intl.DisplayNames([code],{type:'language'}).of(code);if(n)return n.charAt(0).toUpperCase()+n.slice(1)}catch(_){}
  return code;
 }
 function bindSettings(){
  const sel=document.getElementById('appLanguage'),auto=document.getElementById('appLanguageAuto'),note=document.getElementById('appLanguageNote');
  if(!sel||!auto)return;
  const dev=deviceLang();
  const codes=Object.keys(LANGS);if(!codes.includes(dev))codes.push(dev);if(!codes.includes(chosen()))codes.push(chosen());
  sel.innerHTML=codes.map(c=>'<option value="'+c+'">'+languageName(c)+'</option>').join('');
  sel.value=autoOn()?dev:chosen();
  auto.checked=autoOn();sel.disabled=auto.checked;
  if(note)note.textContent=auto.checked?'Dispositivo: '+languageName(dev)+'.':'';
  sel.addEventListener('change',()=>{put(K_LANG,sel.value);location.reload()});
  auto.addEventListener('change',()=>{put(K_AUTO,auto.checked?'1':'0');if(!auto.checked&&!get(K_LANG))put(K_LANG,dev);location.reload()});
 }

 window.ViewInvAII18n={
  lang,mode,
  protect(list){for(const v of list||[]){const s=String(v||'').trim();if(s.length>=2)protectedText.add(s)}},
  languages:LANGS
 };
 const boot=()=>{bindSettings();start()};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
