'use strict';
// Integrar la IA (opcional). Cada usuario conecta una, varias o todas sus IA (Gemini gratis,
// Claude u OpenAI con su clave) o usa su suscripción de ChatGPT/Claude pegando la respuesta.
// La app sigue calculando el Radar AI y el Objetivo como siempre; las IA activas solo
// contrastan ese resultado con información actual para reforzar o matizar la decisión.
(function(){
 const PROVIDERS=[
  {id:'gemini',name:'Gemini',company:'Google',badge:'Gratis',free:true,prefix:'AIza',
   blurb:'Recomendada para empezar: gratis con tu cuenta de Google y con búsqueda en Google para contrastar con noticias actuales.'},
  {id:'anthropic',name:'Claude',company:'Anthropic',badge:'Clave de pago',prefix:'sk-ant-',
   blurb:'Análisis muy cuidadoso con búsqueda web. Usa tu propia clave de API (prepago en la consola de Anthropic).'},
  {id:'openai',name:'ChatGPT (API)',company:'OpenAI',badge:'Clave de pago',prefix:'sk-',
   blurb:'Modelos de OpenAI con búsqueda web. Usa tu propia clave de API (prepago en la plataforma de OpenAI).'}
 ];
 const LABEL={gemini:'Gemini',anthropic:'Claude',openai:'ChatGPT',"chatgpt-web":'ChatGPT (suscripción)',"claude-web":'Claude (suscripción)'};
 const VERDICT={respalda:{icon:'✓',text:'Respalda',cls:'ok'},dudas:{icon:'⚠',text:'Tiene dudas',cls:'warn'},contradice:{icon:'✕',text:'Contradice',cls:'bad'},nota:{icon:'✎',text:'Opinión',cls:'note'}};
 const MANUALS={
  gemini:{title:'Cómo conseguir tu clave gratis de Gemini',steps:[
   'Abre <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> e inicia sesión con tu cuenta de Google.',
   'Si es la primera vez, acepta las condiciones de Google AI Studio.',
   'Pulsa <b>«Create API key»</b> (Crear clave de API). Si te pregunta por un proyecto, elige <b>crear uno nuevo</b>.',
   'Copia la clave que aparece (empieza por <code>AIza…</code>).',
   'Vuelve aquí, pégala en el campo de <b>Gemini</b> y pulsa <b>«Guardar y probar»</b>. Si es correcta, queda activa al momento.'],
   notes:['Es gratis y no pide tarjeta. El plan gratuito tiene un límite diario de consultas de sobra para el uso de ViewInvAI.',
   'En el plan gratuito Google puede usar las consultas para mejorar sus productos. ViewInvAI solo envía datos públicos de las acciones (tickers, puntuaciones, precios), nunca tus importes.',
   'Si algún día ves «límite superado», espera al día siguiente: el contador se reinicia.']},
  anthropic:{title:'Cómo conseguir tu clave de Claude (Anthropic)',steps:[
   'Abre <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a> y crea una cuenta o inicia sesión. <b>Ojo:</b> la suscripción Pro/Max de claude.ai no incluye la API; es una cuenta aparte.',
   'Ve a <b>Billing</b> (Facturación) y añade saldo de prepago (con 5 $ hay para mucho tiempo).',
   'Ve a <b>API keys</b> y pulsa <b>«Create key»</b>. Ponle de nombre «ViewInvAI».',
   'Copia la clave (empieza por <code>sk-ant-…</code>). Solo se muestra una vez.',
   'Vuelve aquí, pégala en el campo de <b>Claude</b> y pulsa <b>«Guardar y probar»</b>.'],
   notes:['Coste orientativo: entre 0,10 y 0,20 $ por análisis (incluye búsquedas web). Las IA activas analizan una vez al día cada mercado del Radar y cada objetivo, salvo que pulses «Repetir».',
   'Puedes fijar un límite de gasto mensual en la consola de Anthropic, en <b>Limits</b>.',
   'En «Opciones avanzadas» puedes indicar un modelo más barato, por ejemplo <code>claude-sonnet-5-5</code>.']},
  openai:{title:'Cómo conseguir tu clave de OpenAI (ChatGPT API)',steps:[
   'Abre <a href="https://platform.openai.com" target="_blank" rel="noopener">platform.openai.com</a> e inicia sesión. <b>Ojo:</b> ChatGPT Plus no incluye la API; es una cuenta aparte.',
   'Ve a <b>Settings › Billing</b> y añade saldo de prepago.',
   'Ve a <b>API keys</b> y pulsa <b>«Create new secret key»</b>. Ponle de nombre «ViewInvAI».',
   'Copia la clave (empieza por <code>sk-…</code>). Solo se muestra una vez.',
   'Vuelve aquí, pégala en el campo de <b>ChatGPT (API)</b> y pulsa <b>«Guardar y probar»</b>.'],
   notes:['Coste orientativo: unos céntimos por análisis con el modelo por defecto, más las búsquedas web.',
   'Puedes fijar un límite de gasto en <b>Settings › Limits</b> de la plataforma de OpenAI.']},
  subscription:{title:'Contrastar con tu suscripción de ChatGPT o Claude',steps:[
   'No necesitas ninguna clave. En el <b>Radar AI</b> o en el <b>Objetivo</b>, abre el recuadro <b>«Contraste con IA»</b>.',
   'Pulsa <b>«Preguntar a ChatGPT»</b> o <b>«Preguntar a Claude»</b>. ViewInvAI copia la consulta con los datos del análisis y abre la web de la IA.',
   'Si no aparece ya escrita, pégala (mantén pulsado › Pegar) y envíala. Si tu plan lo permite, activa la búsqueda web.',
   'Cuando responda, copia la respuesta completa (botón de copiar debajo de la respuesta).',
   'Vuelve a ViewInvAI, pégala en <b>«Pega aquí la respuesta»</b> y pulsa <b>«Guardar opinión»</b>. Se mostrará junto al análisis con su veredicto.'],
   notes:['Este modo no es automático: lo haces tú cuando quieras una segunda opinión.',
   'La consulta pide a la IA un pequeño bloque final con el veredicto para que ViewInvAI lo pueda leer.']}
 };
 const SUBSCRIPTION_INSTRUCTIONS=
  'Eres un analista financiero independiente. ViewInvAI, una app de análisis de bolsa, ha generado estas propuestas con su motor interno. '+
  'Contrástalas con información actual y verificable (noticias, resultados, guías, rebajas de rating, dilución, litigios, sector); busca en la web si puedes. '+
  'No inventes datos: si no encuentras información, dilo. Responde en español.\n'+
  'Al final incluye SOLO un bloque JSON con esta forma:\n'+
  '{"veredicto":"respalda|dudas|contradice","resumen":"una o dos frases","valores":[{"ticker":"XXX","veredicto":"respalda|dudas|contradice","motivo":"dato clave"}]}\n\n';

 const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const say=(msg,bad)=>{try{if(typeof toast==='function')toast(msg,!!bad)}catch(_){}};
 const auth=()=>window.ViewInvAIAuth;
 const signedIn=()=>{try{return !!(auth()&&auth().getUser&&auth().getUser())}catch(_){return false}};
 let config={loaded:false,loading:false,serverReady:true,providers:{},defaults:{}};
 const subjects=new Map(),results=new Map();

 async function api(path,options){
  const r=await auth().apiFetch(path,options||{});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error(d.error||'No se pudo completar la operación.'),{data:d,status:r.status});
  return d;
 }
 const activeProviders=()=>PROVIDERS.filter(p=>config.providers[p.id]&&config.providers[p.id].active).map(p=>p.id);

 async function loadConfig(force){
  if(!signedIn()||config.loading||(config.loaded&&!force))return;
  config.loading=true;
  try{const d=await api('/api/ai/keys');config={loaded:true,loading:false,serverReady:d.serverReady!==false,providers:d.providers||{},defaults:d.defaults||{}}}
  catch(_){config.loading=false}
  renderSettings();refreshPanels();
 }

 // ---------- Configuración › Integrar la IA ----------
 function providerHtml(p){
  const c=config.providers[p.id];
  const status=c?(c.active?'<b class="ai-int-status on">Activa · ····'+esc(c.last4)+'</b>':'<b class="ai-int-status off">En pausa · ····'+esc(c.last4)+'</b>'):'<b class="ai-int-status">Sin configurar</b>';
  const model=c&&c.model||config.defaults[p.id]||'';
  return '<div class="ai-int-provider" data-ai-provider="'+p.id+'">'+
   '<div class="ai-int-provider-head"><div><strong>'+esc(p.name)+'</strong><small>'+esc(p.company)+' · <span class="ai-int-badge'+(p.free?' free':'')+'">'+esc(p.badge)+'</span></small></div>'+
   (c?'<label class="settings-switch" aria-label="Usar '+esc(p.name)+'"><input type="checkbox" data-ai-toggle="'+p.id+'"'+(c.active?' checked':'')+'><span class="settings-switch-track" aria-hidden="true"><span></span></span></label>':'')+'</div>'+
   '<p class="ai-int-blurb">'+esc(p.blurb)+'</p>'+
   '<div class="settings-status-row"><span>Estado</span>'+status+'</div>'+
   '<form class="ai-int-form" data-ai-key-form="'+p.id+'" autocomplete="off">'+
    '<input type="password" name="key" inputmode="text" autocomplete="off" spellcheck="false" placeholder="'+(c?'Pega una clave nueva para cambiarla':'Pega aquí tu clave ('+esc(p.prefix)+'…)')+'" aria-label="Clave de '+esc(p.name)+'">'+
    '<details class="ai-int-advanced"><summary>Opciones avanzadas</summary><label><span>Modelo</span><input name="model" type="text" spellcheck="false" value="'+esc(model)+'" placeholder="'+esc(config.defaults[p.id]||'')+'"></label></details>'+
    '<div class="ai-int-actions"><button type="submit" class="btn small">Guardar y probar</button>'+
    '<button type="button" class="btn small ghost" data-ai-manual="'+p.id+'">Cómo conseguir la clave</button>'+
    (c?'<button type="button" class="btn small ghost danger" data-ai-remove="'+p.id+'">Quitar</button>':'')+'</div>'+
    '<div class="ai-int-msg" data-ai-msg aria-live="polite"></div>'+
   '</form></div>';
 }
 function renderSettings(){
  const box=document.getElementById('aiIntegrationBody');if(!box)return;
  if(!signedIn()){box.innerHTML='<p class="settings-note">Inicia sesión para conectar tus IA. Cada usuario usa sus propias claves.</p>';return}
  if(!config.loaded){box.innerHTML='<p class="settings-note">Cargando tus integraciones…</p>';return}
  const act=activeProviders();
  box.innerHTML=
   (config.serverReady?'':'<p class="ai-int-warning">El servidor aún no tiene activado el cifrado de claves. Hasta que el administrador lo active no se pueden guardar claves; el modo «suscripción» sí funciona.</p>')+
   '<div class="settings-status-row ai-int-summary"><span>IA activas</span><strong class="settings-status">'+(act.length?esc(act.map(id=>LABEL[id]).join(' + ')):'Ninguna')+'</strong></div>'+
   '<p class="settings-note">Pon una, varias o todas: cada IA activa analiza por su cuenta el Radar AI y el Objetivo (una vez al día por mercado o cartera) y verás su opinión junto al análisis de ViewInvAI. Las claves se guardan cifradas en tu cuenta y nunca se muestran; a la IA solo se envían datos públicos de las acciones, nunca tus importes.</p>'+
   '<div class="ai-int-list">'+PROVIDERS.map(providerHtml).join('')+
   '<div class="ai-int-provider ai-int-subscription"><div class="ai-int-provider-head"><div><strong>ChatGPT o Claude con tu suscripción</strong><small>Sin clave · <span class="ai-int-badge free">Manual</span></small></div></div>'+
    '<p class="ai-int-blurb">Si pagas ChatGPT Plus o Claude Pro, ViewInvAI te prepara la consulta, la abres en su web y pegas la respuesta en el recuadro «Contraste con IA» del Radar o del Objetivo.</p>'+
    '<div class="ai-int-actions"><button type="button" class="btn small ghost" data-ai-manual="subscription">Cómo hacerlo</button></div></div>'+
   '</div>';
 }
 function setMsg(form,text,bad){const m=form&&form.querySelector('[data-ai-msg]');if(m){m.textContent=text||'';m.classList.toggle('bad',!!bad)}}
 async function saveKey(form){
  const provider=form.dataset.aiKeyForm,key=String(form.elements.key.value||'').trim(),model=String(form.elements.model&&form.elements.model.value||'').trim();
  const c=config.providers[provider];
  if(!key&&c&&model&&model!==c.model){
   setMsg(form,'Guardando…');
   try{await api('/api/ai/keys/'+provider,{method:'PATCH',body:JSON.stringify({enabled:c.active,model})});await loadConfig(true);say('Modelo actualizado.')}
   catch(e){setMsg(form,e.message,true)}
   return;
  }
  if(!key){setMsg(form,'Pega primero la clave.',true);return}
  const btn=form.querySelector('[type=submit]');if(btn)btn.disabled=true;
  setMsg(form,'Probando la clave…');
  try{
   await api('/api/ai/keys',{method:'POST',body:JSON.stringify({provider,key,model})});
   form.elements.key.value='';
   results.clear();
   await loadConfig(true);
   say(LABEL[provider]+' conectada y activa.');
  }catch(e){setMsg(form,e.message,true)}
  finally{if(btn)btn.disabled=false}
 }
 async function removeKey(provider){
  if(!window.confirm('¿Quitar la clave de '+LABEL[provider]+'? Se borrará de tu cuenta.'))return;
  try{await api('/api/ai/keys/'+provider,{method:'DELETE'});await loadConfig(true);say('Clave de '+LABEL[provider]+' eliminada.')}
  catch(e){say(e.message,true)}
 }
 async function toggleProvider(provider,enabled){
  try{await api('/api/ai/keys/'+provider,{method:'PATCH',body:JSON.stringify({enabled})});await loadConfig(true)}
  catch(e){say(e.message,true);renderSettings()}
 }

 // ---------- Manuales ----------
 function openManual(id){
  const m=MANUALS[id];if(!m)return;
  closeManual();
  const wrap=document.createElement('div');
  wrap.className='ai-manual-backdrop';wrap.setAttribute('data-ai-manual-backdrop','');
  wrap.innerHTML='<div class="ai-manual" role="dialog" aria-modal="true" aria-labelledby="aiManualTitle">'+
   '<div class="ai-manual-head"><h2 id="aiManualTitle">'+esc(m.title)+'</h2><button type="button" class="btn icon-btn" data-ai-manual-close aria-label="Cerrar">✕</button></div>'+
   '<ol class="ai-manual-steps">'+m.steps.map(s=>'<li>'+s+'</li>').join('')+'</ol>'+
   (m.notes&&m.notes.length?'<ul class="ai-manual-notes">'+m.notes.map(n=>'<li>'+n+'</li>').join('')+'</ul>':'')+
   '<div class="ai-manual-foot"><button type="button" class="btn" data-ai-manual-close>Entendido</button></div></div>';
  document.body.appendChild(wrap);
  document.body.classList.add('ai-manual-open');
  const close=wrap.querySelector('[data-ai-manual-close]');if(close)close.focus();
 }
 function closeManual(){document.querySelectorAll('[data-ai-manual-backdrop]').forEach(x=>x.remove());document.body.classList.remove('ai-manual-open')}

 // ---------- Recuadro «Contraste con IA» (Radar AI y Objetivo) ----------
 const sid=(type,key)=>type+'|'+key;
 function verdictChip(v){const x=VERDICT[v]||VERDICT.nota;return '<span class="ai-verdict ai-verdict-'+x.cls+'">'+x.icon+' '+esc(x.text)+'</span>'}
 function contrastHtml(c){
  const items=(c.items||[]).map(i=>'<li>'+verdictChip(i.verdict)+' <b>'+esc(i.ticker)+'</b>'+(i.reason?' · '+esc(i.reason):'')+'</li>').join('');
  const sources=(c.sources||[]).slice(0,6).map(s=>{let host='';try{host=new URL(s.url).hostname.replace(/^www\./,'')}catch(_){}return '<a href="'+esc(s.url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.title||host||'Fuente')+'</a>'}).join('');
  return '<div class="ai-contrast-result"><div class="ai-contrast-result-head"><strong>'+esc(LABEL[c.provider]||c.provider)+'</strong>'+verdictChip(c.verdict)+'</div>'+
   (c.summary?'<p>'+esc(c.summary)+'</p>':'')+(items?'<ul class="ai-contrast-items">'+items+'</ul>':'')+
   (sources?'<div class="ai-contrast-sources"><small>Fuentes:</small>'+sources+'</div>':'')+'</div>';
 }
 function consensus(list){
  const auto=list.filter(c=>c.verdict!=='nota');if(!auto.length)return'';
  const n=v=>auto.filter(c=>c.verdict===v).length;
  if(n('contradice'))return 'contradice';
  if(n('dudas'))return 'dudas';
  return 'respalda';
 }
 function panelInner(subject){
  const st=results.get(sid(subject.type,subject.key))||{};
  const act=activeProviders();
  let body='';
  if(st.loading)body+='<p class="ai-contrast-loading"><i class="ai-live-dot thinking" aria-hidden="true"></i> Contrastando con '+esc(act.map(id=>LABEL[id]).join(', ')||'IA')+'…</p>';
  (st.list||[]).forEach(c=>{body+=contrastHtml(c)});
  (st.errors||[]).forEach(e=>{body+='<p class="ai-contrast-error">'+(e.provider?'<b>'+esc(LABEL[e.provider]||e.provider)+':</b> ':'')+esc(e.error)+'</p>'});
  if(!st.loading&&!(st.list||[]).length&&!(st.errors||[]).length)
   body+=act.length?'<p class="settings-note">Aún sin contraste para este resultado.</p>':'<p class="settings-note">Conecta una o varias IA en <button type="button" class="link-btn" data-ai-open-settings>Configuración › Integrar la IA</button> para que contrasten automáticamente este resultado. También puedes usar tu suscripción de ChatGPT o Claude aquí abajo.</p>';
  const manual=st.manualOpen
   ?'<form class="ai-contrast-paste" data-ai-paste-form><textarea name="answer" rows="5" placeholder="Pega aquí la respuesta completa de ChatGPT o Claude"></textarea>'+
     '<div class="ai-int-actions"><select name="source" aria-label="De qué IA es la respuesta"><option value="chatgpt">ChatGPT</option><option value="claude">Claude</option></select><button type="submit" class="btn small">Guardar opinión</button></div></form>':'';
  return '<summary><span><small>CONTRASTE CON IA · OPCIONAL</small><b>'+(consensus(st.list||[])?verdictChip(consensus(st.list||[]))+' ':'')+esc(subject.title)+'</b></span></summary>'+
   '<div class="ai-contrast-body">'+body+
    '<div class="ai-int-actions ai-contrast-tools">'+
     (act.length?'<button type="button" class="btn small ghost" data-ai-contrast-run'+(st.loading?' disabled':'')+'>'+((st.list||[]).length?'Repetir con IA':'Contrastar ahora')+'</button>':'')+
     '<button type="button" class="btn small ghost" data-ai-ask="chatgpt">Preguntar a ChatGPT</button>'+
     '<button type="button" class="btn small ghost" data-ai-ask="claude">Preguntar a Claude</button>'+
     '<button type="button" class="btn small ghost" data-ai-paste-toggle>'+(st.manualOpen?'Cerrar':'Pega aquí la respuesta')+'</button>'+
    '</div>'+manual+
    '<p class="ai-contrast-disclaimer">Opinión externa para contrastar; no cambia el cálculo de ViewInvAI. Decide siempre tú.</p>'+
   '</div>';
 }
 function panelHtml(subject){
  if(!subject||!subject.type||!subject.key)return '';
  subjects.set(sid(subject.type,subject.key),subject);
  const st=results.get(sid(subject.type,subject.key));
  if(signedIn()){
   if(!config.loaded)setTimeout(()=>loadConfig(false),0);
   else if(!st)setTimeout(()=>start(subject,false),0);
  }
  const open=st&&st.open;
  return '<details class="ai-contrast-panel" data-ai-contrast-panel="'+esc(sid(subject.type,subject.key))+'"'+(open?' open':'')+'>'+panelInner(subject)+'</details>';
 }
 function refreshPanels(){
  document.querySelectorAll('[data-ai-contrast-panel]').forEach(el=>{
   const subject=subjects.get(el.dataset.aiContrastPanel);if(!subject)return;
   const st=results.get(el.dataset.aiContrastPanel);
   if(config.loaded&&!st)setTimeout(()=>start(subject,false),0);
   const paste=el.querySelector('textarea[name=answer]'),draft=paste&&paste.value;
   el.innerHTML=panelInner(subject);
   const again=el.querySelector('textarea[name=answer]');if(again&&draft)again.value=draft;
  });
 }
 async function loadSaved(subject,st){
  try{const d=await api('/api/ai/contrast?type='+encodeURIComponent(subject.type)+'&key='+encodeURIComponent(subject.key));st.list=latestPerProvider(d.contrasts||[])}catch(_){}
 }
 function latestPerProvider(list){
  const seen=new Set(),out=[];
  for(const c of list){if(seen.has(c.provider))continue;seen.add(c.provider);out.push(c)}
  return out;
 }
 // Las IA activas analizan solas una vez al día por mercado/cartera; el servidor reutiliza
 // el análisis del día si ya existe, así que abrir y cerrar pantallas no gasta cuota.
 async function start(subject,force){
  const id=sid(subject.type,subject.key);
  const prev=results.get(id)||{};
  if(prev.loading)return;
  const st={...prev,loading:false,errors:[]};results.set(id,st);
  if(!signedIn())return;
  if(!activeProviders().length){await loadSaved(subject,st);refreshPanels();announce(subject);return}
  st.loading=true;refreshPanels();
  try{
   const d=await api('/api/ai/contrast',{method:'POST',body:JSON.stringify({subjectType:subject.type,subjectKey:subject.key,prompt:subject.prompt,force:!!force})});
   const manual=(st.list||[]).filter(c=>/-web$/.test(c.provider));
   st.list=latestPerProvider([...(d.contrasts||[]),...manual]);st.errors=d.errors||[];
  }catch(e){st.errors=[{provider:'',error:e.message}]}
  st.loading=false;refreshPanels();announce(subject);
 }
 function announce(subject){window.dispatchEvent(new CustomEvent('viewinvai:ai-contrast',{detail:{type:subject.type,key:subject.key}}))}
 function askExternal(subject,which){
  const prompt=SUBSCRIPTION_INSTRUCTIONS+subject.prompt;
  const base=which==='claude'?'https://claude.ai/new':'https://chatgpt.com/';
  const target=prompt.length<6000?base+'?q='+encodeURIComponent(prompt):base;
  let opened=null;
  try{opened=window.open(target,'_blank','noopener,noreferrer')}catch(_){}
  copy(prompt).then(ok=>{
   const st=results.get(sid(subject.type,subject.key))||{};st.manualOpen=true;st.open=true;results.set(sid(subject.type,subject.key),st);refreshPanels();
   say((opened?(which==='claude'?'Claude':'ChatGPT')+' abierto · ':'')+(ok?'consulta copiada. Cuando responda, pega aquí la respuesta.':'pega la respuesta aquí cuando responda.'));
  });
 }
 async function copy(text){
  try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);return true}}catch(_){}
  try{const ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');ta.className='ai-copy-buffer';document.body.appendChild(ta);ta.select();const ok=document.execCommand&&document.execCommand('copy');ta.remove();return !!ok}catch(_){return false}
 }
 async function savePaste(subject,form){
  const answer=String(form.elements.answer.value||'').trim(),source=form.elements.source.value;
  if(answer.length<20){say('Pega la respuesta completa de la IA.',true);return}
  if(!signedIn()){say('Inicia sesión para guardar la opinión.',true);return}
  try{
   const d=await api('/api/ai/contrast/manual',{method:'POST',body:JSON.stringify({subjectType:subject.type,subjectKey:subject.key,answer,source})});
   const id=sid(subject.type,subject.key),st=results.get(id)||{};
   st.list=latestPerProvider([d.contrast,...(st.list||[])]);st.manualOpen=false;st.open=true;results.set(id,st);
   refreshPanels();announce(subject);say('Opinión guardada.');
  }catch(e){say(e.message,true)}
 }
 // Veredicto por ticker para marcar las tarjetas (peor caso entre las IA que lo nombran).
 function verdictFor(type,key,ticker){
  const st=results.get(sid(type,key));if(!st||!st.list)return null;
  const t=String(ticker||'').toUpperCase(),rank={respalda:1,dudas:2,contradice:3};let best=null;
  for(const c of st.list)for(const i of c.items||[])if(i.ticker===t&&rank[i.verdict]&&(!best||rank[i.verdict]>rank[best]))best=i.verdict;
  return best;
 }
 function badgeHtml(v){const x=VERDICT[v];return x?'<span class="ai-card-verdict ai-verdict-'+x.cls+'" title="IA: '+esc(x.text)+'">IA '+x.icon+'</span>':''}

 document.addEventListener('submit',e=>{
  const f=e.target;
  if(f.matches&&f.matches('[data-ai-key-form]')){e.preventDefault();saveKey(f);return}
  if(f.matches&&f.matches('[data-ai-paste-form]')){
   e.preventDefault();const panel=f.closest('[data-ai-contrast-panel]');const subject=panel&&subjects.get(panel.dataset.aiContrastPanel);if(subject)savePaste(subject,f);
  }
 });
 document.addEventListener('change',e=>{const t=e.target.closest&&e.target.closest('[data-ai-toggle]');if(t)toggleProvider(t.dataset.aiToggle,t.checked)});
 document.addEventListener('toggle',e=>{
  const el=e.target;if(!el.matches||!el.matches('[data-ai-contrast-panel]'))return;
  const st=results.get(el.dataset.aiContrastPanel);if(st)st.open=el.open;
 },true);
 document.addEventListener('click',e=>{
  const t=e.target.closest&&e.target.closest('[data-ai-manual],[data-ai-manual-close],[data-ai-remove],[data-ai-contrast-run],[data-ai-ask],[data-ai-paste-toggle],[data-ai-open-settings]');
  if(!t){if(e.target.matches&&e.target.matches('[data-ai-manual-backdrop]'))closeManual();return}
  if(t.closest('[data-ai-contrast-panel]'))e.stopPropagation();
  if(t.hasAttribute('data-ai-manual')){openManual(t.dataset.aiManual);return}
  if(t.hasAttribute('data-ai-manual-close')){closeManual();return}
  if(t.hasAttribute('data-ai-remove')){removeKey(t.dataset.aiRemove);return}
  if(t.hasAttribute('data-ai-open-settings')){
   const nav=document.querySelector('[data-view="settings"]');if(nav)nav.click();
   setTimeout(()=>{const c=document.getElementById('aiIntegrationCard');if(c)c.scrollIntoView({behavior:'smooth',block:'start'})},120);return;
  }
  const panel=t.closest('[data-ai-contrast-panel]'),subject=panel&&subjects.get(panel.dataset.aiContrastPanel);if(!subject)return;
  if(t.hasAttribute('data-ai-contrast-run'))start(subject,true);
  else if(t.hasAttribute('data-ai-ask'))askExternal(subject,t.dataset.aiAsk);
  else if(t.hasAttribute('data-ai-paste-toggle')){const st=results.get(sid(subject.type,subject.key))||{};st.manualOpen=!st.manualOpen;st.open=true;results.set(sid(subject.type,subject.key),st);refreshPanels()}
 },true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.querySelector('[data-ai-manual-backdrop]'))closeManual()});
 window.addEventListener('viewinvai:account-ready',()=>{config.loaded=false;results.clear();loadConfig(true)});
 window.addEventListener('viewinvai:auth-changed',()=>{config={loaded:false,loading:false,serverReady:true,providers:{},defaults:{}};results.clear();renderSettings();refreshPanels()});
 document.addEventListener('DOMContentLoaded',renderSettings);
 if(document.readyState!=='loading')renderSettings();

 window.ViewInvAIContrast={panelHtml,verdictFor,badgeHtml,openManual,reload:()=>loadConfig(true)};
})();
