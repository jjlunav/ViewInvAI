'use strict';
// Integrar la IA (opcional). Cada usuario conecta una, varias o todas sus IA (Gemini gratis,
// Claude u OpenAI con su clave) o pregunta a mano a ChatGPT/Claude/Gemini con su cuenta y pega la respuesta.
// La app contrasta siempre con sus IA gratuitas y noticias de hoy; las IA del usuario son una segunda opinión y solo
// contrastan ese resultado con información actual para reforzar o matizar la decisión.
(function(){
 const PROVIDERS=[
  {id:'gemini',name:'Gemini',company:'Google',badge:'Gratis',free:true,prefix:'AIza',
   blurb:'Recomendada para empezar: ViewInvAI detecta automáticamente los Flash estables disponibles en tu proyecto y usa primero el más nuevo; si falla, baja modelo por modelo.'},
  {id:'anthropic',name:'Claude',company:'Anthropic',badge:'Clave de pago',prefix:'sk-ant-',
   blurb:'Análisis muy cuidadoso con búsqueda web. Usa tu propia clave de API (prepago en la consola de Anthropic).'},
  {id:'openai',name:'ChatGPT (API)',company:'OpenAI',badge:'Clave de pago',prefix:'sk-',
   blurb:'Modelos de OpenAI con búsqueda web. Usa tu propia clave de API (prepago en la plataforma de OpenAI).'}
 ];
 const LABEL={gemini:'Gemini',anthropic:'Claude',openai:'ChatGPT',"chatgpt-web":'ChatGPT (tu cuenta)',"claude-web":'Claude (tu cuenta)',"gemini-web":'Gemini (tu cuenta)',"viewinvai-ai":'IA de ViewInvAI + búsqueda web'};
 const VERDICT={respalda:{icon:'✓',text:'Respalda',cls:'ok'},dudas:{icon:'⚠',text:'Tiene dudas',cls:'warn'},contradice:{icon:'✕',text:'Contradice',cls:'bad'},nota:{icon:'✎',text:'Opinión',cls:'note'}};
 const MANUALS={
  gemini:{title:'Cómo conseguir tu clave gratis de Gemini',steps:[
   'Abre <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> e inicia sesión con tu cuenta de Google.',
   'Si es la primera vez, acepta las condiciones de Google AI Studio.',
   'Pulsa <b>«Create API key»</b> (Crear clave de API). Si te pregunta por un proyecto, elige <b>crear uno nuevo</b>.',
   'Copia la clave que aparece (empieza por <code>AIza…</code>).',
   'Vuelve aquí, pégala en el campo de <b>Gemini</b> y pulsa <b>«Guardar y probar»</b>. Si es correcta, queda activa al momento.'],
   notes:['Gemini dispone de nivel gratuito y no requiere tarjeta. Los límites dependen del proyecto y del modelo.',
   'ViewInvAI consulta el catálogo de modelos de tu propia clave, usa los Flash estables del más nuevo al más antiguo y después los Flash-Lite. La lista se guarda unas horas en memoria, sin escribir en D1.',
   'La búsqueda web integrada no es necesaria: ViewInvAI aporta cotización, técnica y noticias/eventos conocidos. En el plan gratuito Google puede usar las consultas para mejorar sus productos; nunca se envían tus importes.']},
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
  subscription:{title:'Preguntar a AI con tu cuenta de ChatGPT, Claude o Gemini',steps:[
   'No necesitas ninguna clave. Busca el recuadro <b>«Preguntar a AI»</b> en la ficha de una acción, en el <b>Radar AI</b> o en el <b>Objetivo de la cartera</b>.',
   'En el Radar AI, elige primero las acciones sobre las que quieres preguntar.',
   'Pulsa el logo de la IA que uses (ChatGPT, Claude o Gemini). ViewInvAI copia la pregunta con los datos del análisis y abre la web de esa IA; en ChatGPT y Claude suele aparecer ya escrita.',
   'Si no aparece escrita, pégala (mantén pulsado › Pegar) y envíala. Si tu plan lo permite, activa la búsqueda web.',
   'Cuando responda, copia la respuesta completa (botón de copiar debajo de la respuesta).',
   'Vuelve a ViewInvAI, pulsa <b>«Pegar respuesta»</b>, pégala y pulsa <b>«Analizar respuesta»</b>.'],
   notes:['Es gratis: usa tu propia cuenta, también la gratuita. No es automático: lo haces tú cuando quieras una segunda opinión.',
   'Si la IA respalda una acción, aparece como «IA ✓ reforzada». Si la contradice, baja un nivel (por ejemplo de Oportunidad a Vigilancia) y en el Objetivo la compra pasa a observación. La opinión vale 3 días.',
   'La pregunta pide a la IA un pequeño bloque final con el veredicto para que ViewInvAI lo pueda leer.']}
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
 // Una fila compacta por IA (logo, nombre, estado); al tocarla se despliegan clave y opciones.
 const LOGO_OF={gemini:'gemini',anthropic:'claude',openai:'chatgpt'},openRows=new Set();
 function providerHtml(p){
  const c=config.providers[p.id];
  const status=c?(c.active?'<b class="ai-int-status on">Activa ····'+esc(c.last4)+'</b>':'<b class="ai-int-status off">En pausa ····'+esc(c.last4)+'</b>'):'<b class="ai-int-status">Sin configurar</b>';
  const model=c&&c.model||config.defaults[p.id]||'';
  return '<details class="ai-int-provider" data-ai-provider="'+p.id+'"'+(openRows.has(p.id)?' open':'')+'>'+
   '<summary class="ai-int-row"><span class="ai-int-logo" aria-hidden="true">'+logoSvg(LOGO_OF[p.id])+'</span>'+
    '<span class="ai-int-name"><strong>'+esc(p.name)+'</strong><span class="ai-int-badge'+(p.free?' free':'')+'">'+esc(p.badge)+'</span></span>'+status+'</summary>'+
   '<div class="ai-int-detail">'+
    '<p class="ai-int-blurb">'+esc(p.blurb)+'</p>'+
    (c?'<div class="settings-status-row ai-int-toggle-row"><span>Usar en el análisis automático</span><label class="settings-switch" aria-label="Usar '+esc(p.name)+'"><input type="checkbox" data-ai-toggle="'+p.id+'"'+(c.active?' checked':'')+'><span class="settings-switch-track" aria-hidden="true"><span></span></span></label></div>':'')+
    '<form class="ai-int-form" data-ai-key-form="'+p.id+'" autocomplete="off">'+
     '<input type="password" name="key" inputmode="text" autocomplete="off" spellcheck="false" placeholder="'+(c?'Pega una clave nueva para cambiarla':'Pega aquí tu clave ('+esc(p.prefix)+'…)')+'" aria-label="Clave de '+esc(p.name)+'">'+
     '<details class="ai-int-advanced"><summary>Opciones avanzadas</summary>'+
      (p.id==='gemini'
       ?'<p class="settings-note"><b>Modelo automático.</b> Se detectan los Flash estables disponibles y se prueban de más nuevo a más antiguo; después, Flash-Lite.</p>'
       :'<label><span>Modelo</span><input name="model" type="text" spellcheck="false" value="'+esc(model)+'" placeholder="'+esc(config.defaults[p.id]||'')+'"></label>')+
     '</details>'+
     '<div class="ai-int-actions"><button type="submit" class="btn small">Guardar y probar</button>'+
     '<button type="button" class="btn small ghost" data-ai-manual="'+p.id+'">Cómo conseguirla</button>'+
     (c?'<button type="button" class="btn small ghost danger" data-ai-remove="'+p.id+'">Quitar</button>':'')+'</div>'+
     '<div class="ai-int-msg" data-ai-msg aria-live="polite"></div>'+
    '</form></div></details>';
 }
 function renderSettings(){
  const box=document.getElementById('aiIntegrationBody');if(!box)return;
  if(!signedIn()){box.innerHTML='<p class="settings-note">Inicia sesión para conectar tus IA. Cada usuario usa sus propias claves.</p>';return}
  if(!config.loaded){box.innerHTML='<p class="settings-note">Cargando tus integraciones…</p>';return}
  const act=activeProviders();
  box.innerHTML=
   (config.serverReady?'':'<p class="ai-int-warning">El servidor aún no tiene activado el cifrado de claves. Hasta que el administrador lo active no se pueden guardar claves; «Preguntar a AI» con tu cuenta sí funciona.</p>')+
   '<div class="settings-status-row ai-int-summary"><span>IA activas</span><strong class="settings-status">'+(act.length?esc(act.map(id=>LABEL[id]).join(' + ')):'Ninguna')+'</strong></div>'+
   '<p class="settings-note ai-int-note">Con clave, cada IA activa contrasta sola el Radar AI y el Objetivo una vez al día. Las claves se guardan cifradas y a la IA solo van datos públicos, nunca tus importes.</p>'+
   '<div class="ai-int-list">'+PROVIDERS.map(providerHtml).join('')+
   '<div class="ai-int-provider ai-int-subscription"><div class="ai-int-row"><span class="ai-int-logo ai-int-logo-multi" aria-hidden="true">'+logoSvg('chatgpt')+'</span>'+
    '<span class="ai-int-name"><strong>Preguntar a AI</strong><span class="ai-int-badge free">Gratis · con tu cuenta</span></span>'+
    '<button type="button" class="btn small ghost" data-ai-manual="subscription">Cómo</button></div></div>'+
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

 // ---------- «Preguntar a AI» y contraste (ficha, Radar AI y Objetivo) ----------
 // Botón por IA con su logo: abre la web de esa IA con la pregunta preparada (gratis, con la
 // cuenta del usuario). Después se pega la respuesta y ViewInvAI la usa para reforzar (✓) o
 // rebajar (✕) cada acción. Las IA conectadas con clave contrastan además de forma automática.
 const ASK={
  chatgpt:{name:'ChatGPT',url:'https://chatgpt.com/',max:8000,svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>'},
  claude:{name:'Claude',url:'https://claude.ai/new',max:6000,svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#D97757" d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/></svg>'},
  gemini:{name:'Gemini',url:'https://gemini.google.com/app',max:0,svg:'<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="aiGeminiGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4285F4"/><stop offset=".55" stop-color="#9B72CB"/><stop offset="1" stop-color="#D96570"/></linearGradient></defs><path fill="url(#aiGeminiGrad)" d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"/></svg>'}
 };
 const sid=(type,key)=>type+'|'+key;
 // Cada logo lleva su propio id de degradado: con ids repetidos, el navegador usa el primero
 // de la página y, si está en una vista oculta, el logo de Gemini sale vacío.
 let gradN=0;
 function logoSvg(id){return ASK[id]?ASK[id].svg.replace(/aiGeminiGrad/g,'aiGemGrad'+(++gradN)):''}
 const P=(f,sel)=>typeof f==='function'?f(sel):String(f||'');
 let recent={loaded:false,loading:false,list:[]};
 function verdictChip(v){const x=VERDICT[v]||VERDICT.nota;return '<span class="ai-verdict ai-verdict-'+x.cls+'">'+x.icon+' '+esc(x.text)+'</span>'}
 function contrastHtml(c){
  const items=(c.items||[]).map(i=>'<li>'+verdictChip(i.verdict)+' <b>'+esc(i.ticker)+'</b>'+(i.reason?' · '+esc(i.reason):'')+'</li>').join('');
  const sources=(c.sources||[]).slice(0,6).map(s=>{let host='';try{host=new URL(s.url).hostname.replace(/^www\./,'')}catch(_){}return '<a href="'+esc(s.url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.title||host||'Fuente')+'</a>'}).join('');
  const when=c.createdAt?new Date(c.createdAt).toLocaleString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'';
  return '<div class="ai-contrast-result"><div class="ai-contrast-result-head"><strong>'+esc(providerLabel(c.provider))+(when?' <small>'+esc(when)+'</small>':'')+'</strong>'+verdictChip(c.verdict)+'</div>'+
   (c.summary?'<p>'+esc(c.summary)+'</p>':'')+(items?'<ul class="ai-contrast-items">'+items+'</ul>':'')+
   (sources?'<div class="ai-contrast-sources"><small>Fuentes:</small>'+sources+'</div>':'')+'</div>';
 }
 function providerLabel(id){
  if(LABEL[id])return LABEL[id];
  if(/^app-/.test(id)){const e=(engines.data&&engines.data.app||[]).find(x=>x.provider===id.slice(4));return 'IA de la app · '+(e?e.label:id.slice(4))}
  return id;
 }
 // ---------- Elegir IA y modelo a mano (sin gastar usos a lo tonto) ----------
 // Lista de IA disponibles con lo que les queda hoy. Se pide al abrir el selector y se guarda 5 min.
 let engines={at:0,loading:false,data:null};
 async function loadEngines(force){
  if(engines.loading||(!force&&engines.data&&Date.now()-engines.at<5*60000)||!signedIn())return;
  const cur=engines;cur.loading=true;cur.error='';
  // Si cambia la cuenta mientras se carga, la respuesta de la cuenta anterior se descarta.
  try{const d=await api('/api/ai/engines');if(engines!==cur)return;cur.data=d;cur.at=Date.now()}catch(e){if(engines!==cur)return;cur.error=e.message||'No se pudo cargar la lista de IA.'}
  cur.loading=false;refreshPanels();
 }
 function engineList(){const d=engines.data||{};return[...(d.own||[]),...(d.app||[])]}
 function engineLeft(e){
  const d=engines.data||{};
  if(e.id.startsWith('user:'))return d.ownLeft;
  return Math.min(d.appLeft??0,e.remaining==null?Infinity:e.remaining);
 }
 // Recomendada: la de mejor nota para decisiones entre las que aún tienen margen hoy (sin pausa).
 function recommendedEngine(){
  const app=(engines.data&&engines.data.app||[]).filter(e=>engineLeft(e)>0&&!e.paused);
  return app.sort((a,b)=>b.quality*Math.min(1,(b.remaining??1000)/50)-a.quality*Math.min(1,(a.remaining??1000)/50))[0]||null;
 }
 function enginePickerHtml(subject,st){
  if(!st.pickOpen)return '';
  if(!engines.data&&engines.error&&!engines.loading)return '<div class="ai-engine"><p class="ai-contrast-error">'+esc(engines.error)+'</p><button type="button" class="btn small ghost" data-ai-engine-retry>Reintentar</button></div>';
  if(!engines.data)return '<div class="ai-engine"><p class="ai-contrast-loading"><i class="ai-live-dot thinking" aria-hidden="true"></i> Cargando las IA disponibles…</p></div>';
  const d=engines.data,list=engineList(),rec=recommendedEngine(),why=deepReason(subject,st);
  // La primera vez se marca la búsqueda exhaustiva solo si la situación lo aconseja.
  if(st.deep===undefined)st.deep=!!why;
  // Sin elegir, o la elegida ya sin cupo: pasa a la recomendada.
  const cur=list.find(e=>e.id===st.engine);
  if(!cur||engineLeft(cur)<=0)st.engine=(rec||list.find(e=>engineLeft(e)>0)||list[0]||{}).id||'';
  const sel=list.find(e=>e.id===st.engine);
  if(sel&&st.model&&!(sel.models||[]).includes(st.model))st.model='';
  // Un solo desplegable: cada opción dice lo que le queda hoy; las agotadas o en pausa no se pueden elegir.
  const opt=e=>{const left=engineLeft(e),off=left<=0;
   const note=e.id.startsWith('user:')?'te quedan '+(d.ownLeft??0)+' hoy'+(e.active?'':' · desactivada'):e.paused?'fallos recientes, puede fallar':(e.remaining==null?'sin cupo fijo':'quedan ~'+e.remaining+' hoy');
   return '<option value="'+esc(e.id)+'"'+(e.id===st.engine?' selected':'')+(off?' disabled':'')+'>'+esc(e.label+(rec&&e.id===rec.id?' (recomendada)':'')+' · '+note)+'</option>'};
  const models=sel&&sel.models&&sel.models.length>1?'<label class="ai-engine-model"><span>Modelo</span><select data-ai-engine-model><option value="">Automático (el mejor disponible)</option>'+
   sel.models.map(m=>'<option value="'+esc(m)+'"'+(m===st.model?' selected':'')+'>'+esc(m)+'</option>').join('')+'</select></label>':'';
  const own=(d.own||[]),app=(d.app||[]);
  const left=sel?engineLeft(sel):0,isOwn=sel&&sel.id.startsWith('user:');
  const cost=sel?'Gasta 1 uso · te quedan '+(isOwn?d.ownLeft+' de '+d.ownLimit+' con tus claves':d.appLeft+' de '+d.appLimit+' con las IA de la app')+' hoy.':'';
  return '<div class="ai-engine" role="group" aria-label="Elegir IA">'+
   '<label class="ai-engine-model"><span>IA</span><select data-ai-engine-select>'+
   (own.length?'<optgroup label="Tus IA">'+own.map(opt).join('')+'</optgroup>':'')+
   (app.length?'<optgroup label="IA gratuitas de la app">'+app.map(opt).join('')+'</optgroup>':'')+'</select></label>'+
   models+
   '<label class="ai-engine-deep"><input type="checkbox" data-ai-engine-deep'+(st.deep?' checked':'')+'> <span><b>Búsqueda exhaustiva</b><small>Añade las noticias de esta semana de cada valor. Más lenta.'+(why?' <b class="ai-engine-why">Recomendada ahora: '+esc(why)+'.</b>':'')+'</small></span></label>'+
   '<p class="ai-engine-cost">'+esc(cost)+' Lo mismo en menos de 6 h no gasta.'+(sel&&sel.paused?' '+esc(sel.label)+' ha fallado hace poco: si vuelve a fallar no gasta uso.':'')+'</p>'+
   '<div class="ai-int-actions"><button type="button" class="btn small ai-engine-go" data-ai-engine-run'+(st.loading||!sel||left<=0?' disabled':'')+'>'+(left<=0?'Sin usos hoy':'Analizar con '+esc(sel?sel.label:'IA'))+'</button></div>'+
  '</div>';
 }
 // ¿Merece la pena gastar en búsqueda exhaustiva? Solo si la situación lo pide: alguna IA ya contradice o
 // duda, un valor se mueve mucho hoy, o el plan propone vender por stop o por noticia.
 function deepReason(subject,st){
  const bad=(st.list||[]).find(c=>c.verdict==='contradice'||c.verdict==='dudas'||(c.items||[]).some(i=>i.verdict==='contradice'));
  if(bad)return 'una IA ya '+(bad.verdict==='dudas'?'tiene dudas':'contradice')+' el análisis';
  const all=(window.ViewInvAI&&typeof window.ViewInvAI.getAllStocks==='function'&&window.ViewInvAI.getAllStocks())||[];
  const tickers=(subject.choices||[]).length?[...st.selected]:(subject.tickers||[]);
  for(const t of tickers.slice(0,10)){
   const u=String(t||'').toUpperCase(),x=all.find(v=>String(v.trTicker||'').toUpperCase()===u)||all.find(v=>String(v.ticker||'').toUpperCase()===u);
   const ch=x?Number(x.trLiveChangePct??x.usLiveChangePct??x.changePct):NaN;
   if(Number.isFinite(ch)&&Math.abs(ch)>=8)return u+' se mueve '+(ch>0?'+':'')+ch.toFixed(1).replace('.',',')+' % hoy';
  }
  const text=String(P(subject.prompt,null)||'');
  if(/stop alcanzado|stop de emergencia|vender .*(stop|noticia)|noticia que invalida/i.test(text))return 'el plan propone una venta por stop o por noticia';
  return '';
 }
 // Valores a buscar en la búsqueda exhaustiva: los elegidos (Radar) o los del plan/ficha, con nombre e ISIN.
 function deepTargets(subject,st){
  const tickers=(subject.choices||[]).length?[...st.selected]:(subject.tickers||[]);
  const all=(window.ViewInvAI&&typeof window.ViewInvAI.getAllStocks==='function'&&window.ViewInvAI.getAllStocks())||[];
  return tickers.slice(0,6).map(t=>{const u=String(t||'').toUpperCase(),s=all.find(x=>String(x.trTicker||'').toUpperCase()===u)||all.find(x=>String(x.ticker||'').toUpperCase()===u)||{};
   return{ticker:u,name:s.name||'',isin:s.trIsin||s.isin||'',usTicker:/^(NASDAQ|NYSE|AMEX|NYSE ARCA|BATS|OTC)/i.test(String(s.exchange||''))?String(s.ticker||''):''}});
 }
 async function runEngine(subject,force){
  const st=state(subject),sel=engineList().find(e=>e.id===st.engine);if(!sel||st.loading)return;
  const sel2=(subject.choices||[]).length?[...st.selected]:null;
  if(sel2&&!sel2.length){say('Elige primero las acciones que quieres analizar.',true);return}
  st.loading=true;st.errors=[];st.reusedAt=null;st.open=true;st.pickOpen=false;
  st.runLabel=sel.label+(st.model?' · '+st.model:'')+(st.deep?' · búsqueda exhaustiva':'');
  // Progreso: fases según el tipo de análisis y el tiempo que suele tardar.
  const tk=st.deep?deepTargets(subject,st).map(t=>t.ticker).filter(Boolean):[];
  st.run={start:Date.now(),est:st.deep?28000:12000,stages:[
   ...(st.deep?[{at:0,text:'Buscando noticias de esta semana'+(tk.length?' de '+tk.slice(0,4).join(', ')+(tk.length>4?'…':''):'')}]:[]),
   {at:st.deep?.35:0,text:'Analizando con '+sel.label+(st.model?' · '+st.model:'')},
   {at:.8,text:'Leyendo la respuesta y los veredictos'}]};
  refreshPanels();startProgressTicker();
  try{
   const d=await api('/api/ai/contrast',{method:'POST',body:JSON.stringify({subjectType:subject.type,subjectKey:subject.key,prompt:P(subject.prompt,sel2),
    engine:sel.id,model:st.model||'',deep:!!st.deep,targets:st.deep?deepTargets(subject,st):[],force:!!force})});
   st.list=latestPerProvider([...(d.contrasts||[]),...(st.list||[])]);st.errors=d.errors||[];
   if(d.reused)st.reusedAt=d.reusedAt;
   remember(d.contrasts);
   if(!d.reused)loadEngines(true);
  }catch(e){st.errors=[{provider:'',error:e.message}]}
  // La barra se completa y se ve terminada un momento antes de mostrar el resultado.
  if(st.run){
   st.run.done=true;
   const panel=document.querySelector('[data-ai-contrast-panel="'+CSS.escape(sid(subject.type,subject.key))+'"]');
   const el=panel&&panel.querySelector('[data-ai-progress]');
   if(el){const bar=el.querySelector('[data-ai-progress-bar]'),txt=el.querySelector('[data-ai-progress-stage]');
    if(bar)bar.style.width='100%';if(txt)txt.textContent=st.errors&&st.errors.length&&!(st.list||[]).length?'Sin respuesta':'Listo';
    await new Promise(r=>setTimeout(r,500))}
  }
  st.loading=false;refreshPanels();announce(subject);
 }
 // Tarjeta de progreso del análisis (la barra avanza con el tiempo estimado y se completa al terminar).
 function progressHtml(st){
  const r=st.run;if(!r)return '';
  // Solo la fase se anuncia a los lectores de pantalla; el contador y la barra cambian sin anunciarse.
  return '<div class="ai-progress" data-ai-progress><div class="ai-progress-head"><span class="ai-progress-orb" aria-hidden="true"></span>'+
   '<b data-ai-progress-stage role="status" aria-live="polite"></b><small data-ai-progress-time aria-hidden="true"></small></div><div class="ai-progress-track" aria-hidden="true"><i data-ai-progress-bar></i></div></div>';
 }
 let progressTimer=null;
 function tickProgress(){
  let any=false;
  document.querySelectorAll('[data-ai-progress]').forEach(el=>{
   const panel=el.closest('[data-ai-contrast-panel]'),st=panel&&results.get(panel.dataset.aiContrastPanel),r=st&&st.run;
   if(!r||r.done)return;any=true;
   const t=Date.now()-r.start,f=Math.min(1,t/r.est),pct=Math.min(94,95*(1-Math.exp(-2.2*t/r.est)));
   let stage=r.stages[0];for(const x of r.stages)if(f>=x.at)stage=x;
   const bar=el.querySelector('[data-ai-progress-bar]'),txt=el.querySelector('[data-ai-progress-stage]'),tm=el.querySelector('[data-ai-progress-time]');
   if(bar)bar.style.width=pct.toFixed(1)+'%';
   if(txt&&txt.textContent!==stage.text+'…')txt.textContent=stage.text+'…';
   if(tm)tm.textContent=Math.round(t/1000)+' s';
  });
  if(!any){clearInterval(progressTimer);progressTimer=null}
 }
 function startProgressTicker(){if(!progressTimer)progressTimer=setInterval(tickProgress,300);setTimeout(tickProgress,0)}
 function consensus(list){
  const auto=(list||[]).filter(c=>c.verdict!=='nota');if(!auto.length)return'';
  if(auto.some(c=>c.verdict==='contradice'))return 'contradice';
  if(auto.some(c=>c.verdict==='dudas'))return 'dudas';
  return 'respalda';
 }
 function state(subject){
  const id=sid(subject.type,subject.key);
  let st=results.get(id);
  if(!st){st={selected:new Set(),list:null};results.set(id,st)}
  if(!st.selected)st.selected=new Set();
  return st;
 }
 function pickerHtml(subject,st){
  const choices=subject.choices||[];if(!choices.length)return'';
  const valid=new Set(choices.map(c=>c.ticker));
  [...st.selected].forEach(t=>{if(!valid.has(t))st.selected.delete(t)});
  return '<div class="ai-pick"><div class="ai-pick-head"><b>Elige las acciones para preguntar</b><small>'+st.selected.size+' de '+choices.length+'</small>'+
   (st.selected.size?'<button type="button" class="link-btn" data-ai-pick-clear>Quitar todas</button>':'')+'</div>'+
   '<div class="ai-pick-list">'+choices.map(c=>{const on=st.selected.has(c.ticker),v=tickerVerdict(c.ticker);
    return '<button type="button" class="ai-pick-chip ai-pick-'+esc(c.group||'')+(on?' on':'')+'" data-ai-pick="'+esc(c.ticker)+'" aria-pressed="'+on+'"><b>'+esc(c.ticker)+'</b><small>'+esc(c.label||'')+(v?' · IA '+(VERDICT[v.verdict]||VERDICT.nota).icon:'')+'</small></button>'}).join('')+
   '</div></div>';
 }
 function askBoxHtml(subject,st){
  const needsPick=(subject.choices||[]).length>0&&!st.selected.size;
  const logos=Object.entries(ASK).map(([id,a])=>'<button type="button" class="ai-ask-logo ai-ask-'+id+'" data-ai-ask="'+id+'" title="Preguntar a '+a.name+'" aria-label="Preguntar a '+a.name+'"'+(needsPick?' disabled':'')+'>'+logoSvg(id)+'</button>').join('');
  const paste=st.manualOpen
   ?'<form class="ai-contrast-paste" data-ai-paste-form><textarea name="answer" rows="5" placeholder="Pega aquí la respuesta completa de la IA"></textarea>'+
     '<div class="ai-int-actions"><select name="source" aria-label="De qué IA es la respuesta">'+Object.entries(ASK).map(([id,a])=>'<option value="'+id+'"'+(st.lastAsk===id?' selected':'')+'>'+a.name+'</option>').join('')+'</select><button type="submit" class="btn small">Analizar respuesta</button></div></form>':'';
  return '<div class="ai-ask-box">'+pickerHtml(subject,st)+
   '<div class="ai-ask-row"><div class="ai-ask-label"><b>Preguntar a AI</b><small>'+(needsPick?'Elige primero una o varias acciones':'Gratis con tu cuenta · se abre fuera de la app')+'</small></div><div class="ai-ask-logos">'+logos+'</div></div>'+
   '<button type="button" class="btn small ghost ai-paste-btn" data-ai-paste-toggle'+(st.manualOpen?' aria-expanded="true"':'')+'>'+(st.manualOpen?'Cerrar':'Pegar respuesta')+'</button>'+paste+
  '</div>';
 }
 function panelInner(subject){
  const st=state(subject),act=activeProviders(),auto=subject.auto!==false;
  let body='';
  if(st.loading&&st.run&&!st.run.done){body+=progressHtml(st);setTimeout(startProgressTicker,0)}
  else if(st.loading)body+='<p class="ai-contrast-loading"><i class="ai-live-dot thinking" aria-hidden="true"></i> Contrastando con '+esc(act.map(id=>LABEL[id]).join(', ')||'IA')+'…</p>';
  if(!st.loading&&st.reusedAt)body+='<p class="ai-engine-reused">Mismo análisis que el de las '+esc(new Date(st.reusedAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}))+': se ha reutilizado sin gastar usos. <button type="button" class="link-btn" data-ai-engine-run data-force="1">Repetir igualmente</button></p>';
  (st.list||[]).forEach(c=>{body+=contrastHtml(c)});
  (st.errors||[]).forEach(e=>{body+='<p class="ai-contrast-error">'+(e.provider?'<b>'+esc(providerLabel(e.provider))+':</b> ':'')+esc(e.error)+'</p>'});
  const pickBtn=signedIn()?'<button type="button" class="btn small ghost ai-run-btn" data-ai-engine-toggle'+(st.loading?' disabled':'')+' aria-expanded="'+(st.pickOpen?'true':'false')+'">'+(st.pickOpen?'Cerrar selección de IA':'Elegir IA y modelo')+'</button>':'';
  const tools='<div class="ai-run-row">'+(act.length?'<button type="button" class="btn small ghost ai-run-btn" data-ai-contrast-run'+(st.loading?' disabled':'')+'>'+((st.list||[]).some(c=>!/-web$/.test(c.provider)&&c.provider!=='viewinvai-ai'&&!/^app-/.test(c.provider))?'Repetir con mis IA':(auto?'Contrastar ahora':'Contrastar con mis IA'))+'</button>':'')+pickBtn+'</div>'+
   enginePickerHtml(subject,st)+
   (act.length||subject.inline?'':'<p class="settings-note ai-setup-note">Para que tus IA lo contrasten solas, conéctalas en <button type="button" class="link-btn" data-ai-open-settings>Configuración › Integrar la IA</button>.</p>');
  const inner=askBoxHtml(subject,st)+body+tools+
   '<p class="ai-contrast-disclaimer">'+(subject.type==='stock'?'La respuesta pegada refuerza o rebaja esta acción en el Radar AI y en el Objetivo durante 3 días.':'Si la IA respalda una acción se marca como reforzada; si la contradice, baja un nivel. El cálculo de ViewInvAI no cambia; decide siempre tú.')+'</p>';
  if(subject.inline)return '<div class="ai-contrast-body">'+inner+'</div>';
  const cons=consensus(st.list);
  return '<summary><span><small>PREGUNTAR A AI · CONTRASTE</small><b>'+(cons?verdictChip(cons)+' ':'')+esc(subject.title)+'</b></span></summary><div class="ai-contrast-body">'+inner+'</div>';
 }
 function panelHtml(subject){
  if(!subject||!subject.type||!subject.key)return '';
  const id=sid(subject.type,subject.key),known=results.has(id);
  subjects.set(id,subject);
  const st=state(subject);
  if(signedIn()){
   if(!config.loaded)setTimeout(()=>loadConfig(false),0);
   else if(!known&&subject.auto!==false)setTimeout(()=>start(subject,false),0);
   else if(!known)setTimeout(()=>loadSaved(subject,st).then(refreshPanels),0);
   if(!recent.loaded)setTimeout(loadRecent,0);
  }
  if(subject.inline)return '<section class="ai-contrast-panel ai-contrast-inline" data-ai-contrast-panel="'+esc(id)+'">'+panelInner(subject)+'</section>';
  return '<details class="ai-contrast-panel" data-ai-contrast-panel="'+esc(id)+'"'+(st.open?' open':'')+'>'+panelInner(subject)+'</details>';
 }
 function refreshPanels(){
  document.querySelectorAll('[data-ai-contrast-panel]').forEach(el=>{
   const subject=subjects.get(el.dataset.aiContrastPanel);if(!subject)return;
   if(config.loaded&&!results.get(el.dataset.aiContrastPanel)?.started&&subject.auto!==false&&signedIn())setTimeout(()=>start(subject,false),0);
   const paste=el.querySelector('textarea[name=answer]'),draft=paste&&paste.value;
   el.innerHTML=panelInner(subject);
   const again=el.querySelector('textarea[name=answer]');if(again&&draft)again.value=draft;
  });
 }
 async function loadSaved(subject,st){
  if(st.savedLoaded||!signedIn())return;st.savedLoaded=true;
  try{const d=await api('/api/ai/contrast?type='+encodeURIComponent(subject.type)+'&key='+encodeURIComponent(subject.key));st.list=latestPerProvider([...(st.list||[]),...(d.contrasts||[])])}catch(_){}
 }
 function latestPerProvider(list){
  const seen=new Set(),out=[];
  for(const c of (list||[]).slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))){if(seen.has(c.provider))continue;seen.add(c.provider);out.push(c)}
  return out;
 }
 async function loadRecent(){
  if(recent.loading||!signedIn())return;
  recent.loading=true;
  try{const d=await api('/api/ai/contrast?recent=1');recent={loaded:true,loading:false,list:d.contrasts||[]}}
  catch(_){recent.loading=false;recent.loaded=true}
  announce({type:'all',key:''});
 }
 function remember(list){
  const ids=new Set(recent.list.map(c=>c.id));
  recent.list=[...(list||[]).filter(c=>c&&!ids.has(c.id)),...recent.list];
 }
 // Las IA con clave analizan solas una vez al día por mercado/cartera; el servidor reutiliza
 // el análisis del día si ya existe, así que abrir y cerrar pantallas no gasta cuota.
 async function start(subject,force){
  const st=state(subject);
  if(st.loading||(st.started&&!force))return;
  st.started=true;st.errors=[];st.runLabel='';st.reusedAt=null;st.run=null;
  if(!signedIn())return;
  await loadSaved(subject,st);
  if(!activeProviders().length||(subject.auto===false&&!force)){refreshPanels();return}
  st.loading=true;refreshPanels();
  try{
   const d=await api('/api/ai/contrast',{method:'POST',body:JSON.stringify({subjectType:subject.type,subjectKey:subject.key,prompt:P(subject.prompt,null),force:!!force})});
   st.list=latestPerProvider([...(d.contrasts||[]),...(st.list||[])]);st.errors=d.errors||[];
   remember(d.contrasts);
  }catch(e){st.errors=[{provider:'',error:e.message}]}
  st.loading=false;refreshPanels();announce(subject);
 }
 function announce(subject){window.dispatchEvent(new CustomEvent('viewinvai:ai-contrast',{detail:{type:subject.type,key:subject.key}}))}
 function askExternal(subject,which){
  const a=ASK[which];if(!a)return;
  const st=state(subject),sel=(subject.choices||[]).length?[...st.selected]:null;
  if(sel&&!sel.length){say('Elige primero las acciones que quieres preguntar.',true);return}
  const prompt=subject.manualPrompt?P(subject.manualPrompt,sel):SUBSCRIPTION_INSTRUCTIONS+P(subject.prompt,sel);
  const target=a.max&&prompt.length<a.max?a.url+'?q='+encodeURIComponent(prompt):a.url;
  let opened=null;
  // Se abre en el mismo clic (si no, el móvil lo trata como ventana emergente).
  try{opened=window.open(target,'_blank','noopener,noreferrer')}catch(_){}
  st.lastAsk=which;st.manualOpen=true;st.open=true;
  copy(prompt).then(ok=>{
   refreshPanels();
   say((opened?a.name+' abierto · ':'')+(ok?'pregunta copiada'+(target===a.url?' (pégala allí)':'')+'. Cuando responda, pulsa «Pegar respuesta».':'cuando responda, pulsa «Pegar respuesta».'));
  });
 }
 async function copy(text){
  try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);return true}}catch(_){}
  try{const ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');ta.className='ai-copy-buffer';document.body.appendChild(ta);ta.select();const ok=document.execCommand&&document.execCommand('copy');ta.remove();return !!ok}catch(_){return false}
 }
 async function savePaste(subject,form){
  const answer=String(form.elements.answer.value||'').trim(),source=form.elements.source.value;
  if(answer.length<20){say('Pega la respuesta completa de la IA.',true);return}
  if(!signedIn()){say('Inicia sesión para guardar la respuesta.',true);return}
  const btn=form.querySelector('[type=submit]');if(btn)btn.disabled=true;
  try{
   const d=await api('/api/ai/contrast/manual',{method:'POST',body:JSON.stringify({subjectType:subject.type,subjectKey:subject.key,answer,source,ticker:subject.ticker||''})});
   const st=state(subject);
   st.list=latestPerProvider([d.contrast,...(st.list||[])]);st.manualOpen=false;st.open=true;
   remember([d.contrast]);
   refreshPanels();announce(subject);
   const n=(d.contrast.items||[]).length;
   say(n?'Respuesta analizada: '+n+' '+(n===1?'acción':'acciones')+' con veredicto.':'Respuesta guardada'+(d.contrast.verdict!=='nota'?' · '+(VERDICT[d.contrast.verdict]||VERDICT.nota).text.toLowerCase():'')+'.');
  }catch(e){say(e.message,true);if(btn)btn.disabled=false}
 }
 // Opinión más reciente de cualquier IA sobre una acción (válida 3 días).
 // key: clave del instrumento (bolsa:ticker); el contraste automático solo se aplica con ella,
 // porque el mismo ticker puede ser de empresas distintas en otras bolsas.
 function tickerVerdict(ticker,key){
  const t=String(ticker||'').toUpperCase();if(!t)return null;
  const cutoff=Date.now()-3*86400000;
  for(const c of recent.list){
   if(new Date(c.createdAt||0).getTime()<cutoff)continue;
   for(const i of c.items||[])if(i.ticker===t&&VERDICT[i.verdict]&&i.verdict!=='nota')return{verdict:i.verdict,reason:i.reason||'',provider:c.provider,at:c.createdAt};
  }
  // Si no hay contraste tuyo, el automático del servidor (noticias de hoy + IA externa).
  const a=key?autoVerdicts.map.get(String(key).toUpperCase()):null;
  if(a&&autoFresh(a)&&VERDICT[a.verdict])return{verdict:a.verdict,reason:a.reason||'',provider:'viewinvai-ai',at:a.at};
  return null;
 }
 // Contraste automático del Radar: el servidor contrasta con noticias de hoy e IA externa las acciones
 // que muestra el Radar (caché común de 4 h). Se pide como mucho cada 10 min por mercado.
 const autoVerdicts={map:new Map(),last:{},busy:false,timer:{}};
 // Vigente 4 h desde que se generó en el servidor (no desde que llegó).
 function autoFresh(v){const t=new Date(v&&v.at||0).getTime();return Number.isFinite(t)&&Date.now()-t<4*3600000}
 async function autoCheck(mode,items,retry=0){
  const a=auth();if(!a||typeof a.getUser!=='function'||!a.getUser()||autoVerdicts.busy)return;
  const now=Date.now();if(!retry&&now-(autoVerdicts.last[mode]||0)<10*60000)return;
  const todo=(items||[]).filter(x=>x&&x.key&&x.ticker&&!autoFresh(autoVerdicts.map.get(String(x.key).toUpperCase()))).slice(0,12);
  if(!todo.length)return;
  autoVerdicts.busy=true;autoVerdicts.last[mode]=now;
  try{
   const d=await api('/api/radar-check',{method:'POST',body:JSON.stringify({mode,items:todo})});
   let changed=false;
   for(const [k,v] of Object.entries(d.verdicts||{})){autoVerdicts.map.set(String(k).toUpperCase(),v);changed=true}
   // Si quedaron pendientes, se reintenta en un minuto con las mismas acciones (hasta 3 veces seguidas).
   clearTimeout(autoVerdicts.timer[mode]);
   if(d.pending&&!d.limited&&retry<3)autoVerdicts.timer[mode]=setTimeout(()=>autoCheck(mode,items,retry+1),60000);
   if(changed)announce({type:'radar',key:mode});
  }catch(_){}finally{autoVerdicts.busy=false}
 }
 function verdictFor(type,key,ticker){const v=tickerVerdict(ticker);return v?v.verdict:null}
 function badgeHtml(v){
  const info=typeof v==='string'?{verdict:v,reason:''}:v;if(!info||!VERDICT[info.verdict])return'';
  const x=VERDICT[info.verdict],text=info.verdict==='respalda'?'reforzada':info.verdict==='contradice'?'rebajada':'dudas';
  return '<span class="ai-card-verdict ai-verdict-'+x.cls+'" title="'+esc((LABEL[info.provider]||'IA')+(info.reason?': '+info.reason:''))+'">IA '+x.icon+' '+text+'</span>';
 }
 function stockContext(stock,preferTr=false,maxEvents=3){
  if(!stock)return'';
  const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null},f=(v,d=2)=>n(v)===null?'—':n(v).toFixed(d);
  const ticker=String(stock.ticker||stock.trTicker||'').toUpperCase();
  const price=preferTr?(n(stock.trLivePrice)??n(stock.trPrice)??n(stock.price)):(n(stock.usLivePrice)??n(stock.price));
  const bid=preferTr?(n(stock.trLiveBid)??n(stock.bid)):(n(stock.usLiveBid)??n(stock.bid));
  const ask=preferTr?(n(stock.trLiveAsk)??n(stock.ask)):(n(stock.usLiveAsk)??n(stock.ask));
  const change=preferTr?(n(stock.trLiveChangePct)??n(stock.changePct)):(n(stock.usLiveChangePct)??n(stock.changePct));
  const volume=preferTr?(n(stock.volume)):(n(stock.usLiveVolume)??n(stock.volume));
  const timestamp=preferTr?(stock.trLiveUpdatedAt||stock.updatedAt||''):(stock.usLiveTimestamp||stock.updatedAt||'');
  const source=preferTr?(stock.trLiveSource||stock.source||'LSX'):(stock.usLiveSource||stock.source||'');
  const bits=[
    'precio '+f(price,4)+(preferTr?' EUR':' USD'),
    bid!==null||ask!==null?'BID/ASK '+f(bid,4)+' / '+f(ask,4):'',
    change!==null?'variación sesión '+(change>0?'+':'')+f(change,2)+'%':'',
    n(stock.relVolume)!==null?'volumen relativo '+f(stock.relVolume,2)+'x':'',
    volume!==null?'volumen '+Math.round(volume):'',
    n(stock.rsi)!==null?'RSI14 '+f(stock.rsi,1):'',
    n(stock.adx)!==null?'ADX14 '+f(stock.adx,1):'',
    n(stock.ema20)!==null?'EMA20 '+f(stock.ema20,4):'',
    n(stock.ema50)!==null?'EMA50 '+f(stock.ema50,4):'',
    n(stock.perfWeek)!==null?'semana '+(n(stock.perfWeek)>0?'+':'')+f(stock.perfWeek,2)+'%':'',
    n(stock.perfMonth)!==null?'mes '+(n(stock.perfMonth)>0?'+':'')+f(stock.perfMonth,2)+'%':''
  ].filter(Boolean);
  let events=[];
  try{events=typeof stockEvents==='function'?stockEvents(stock):[]}catch(_){events=[]}
  const now=Date.now(),usable=(events||[]).filter(e=>{
    const t=new Date(e&&e.date||0).getTime();
    return Number.isFinite(t)&&t>=now-14*86400000&&t<=now+45*86400000;
  }).sort((x,y)=>{
    const xn=x&&x.eventKind==='news'?0:1,yn=y&&y.eventKind==='news'?0:1;
    return xn-yn||Math.abs(new Date(x.date)-now)-Math.abs(new Date(y.date)-now)||(Number(y.impactScore)||0)-(Number(x.impactScore)||0);
  }).slice(0,Math.max(0,maxEvents));
  const ev=usable.map(e=>{
    const d=String(e.date||'').slice(0,10),kind=e.eventKind==='news'?'noticia':'evento';
    const title=String(e.title||e.fact||'').replace(/\s+/g,' ').trim().slice(0,220);
    const src=String(e.source||e.verification||'').replace(/\s+/g,' ').trim().slice(0,100);
    return '- '+d+' · '+kind+(e.official?' oficial':'')+' · '+title+(src?' · fuente '+src:'')+(n(e.impactScore)!==null?' · impacto '+Math.round(n(e.impactScore))+'/100':'');
  });
  return 'DATOS DE VIEWINVAI · '+ticker+'\n'+bits.join(' · ')+(timestamp?' · hora '+timestamp:'')+(source?' · fuente cotización '+source:'')+
    '\n'+(ev.length?'Noticias/eventos conocidos por ViewInvAI:\n'+ev.join('\n'):'Sin noticias/eventos verificados adicionales en el snapshot actual.');
 }

 document.addEventListener('submit',e=>{
  const f=e.target;
  if(f.matches&&f.matches('[data-ai-key-form]')){e.preventDefault();saveKey(f);return}
  if(f.matches&&f.matches('[data-ai-paste-form]')){
   e.preventDefault();const panel=f.closest('[data-ai-contrast-panel]');const subject=panel&&subjects.get(panel.dataset.aiContrastPanel);if(subject)savePaste(subject,f);
  }
 });
 document.addEventListener('change',e=>{const t=e.target.closest&&e.target.closest('[data-ai-toggle]');if(t)toggleProvider(t.dataset.aiToggle,t.checked)});
 document.addEventListener('toggle',e=>{
  const el=e.target;
  if(el.matches&&el.matches('[data-ai-provider]')){if(el.open)openRows.add(el.dataset.aiProvider);else openRows.delete(el.dataset.aiProvider);return}
  if(!el.matches||!el.matches('[data-ai-contrast-panel]'))return;
  const st=results.get(el.dataset.aiContrastPanel);if(st)st.open=el.open;
 },true);
 document.addEventListener('click',e=>{
  const t=e.target.closest&&e.target.closest('[data-ai-manual],[data-ai-manual-close],[data-ai-remove],[data-ai-contrast-run],[data-ai-ask],[data-ai-paste-toggle],[data-ai-open-settings],[data-ai-pick],[data-ai-pick-clear],[data-ai-engine-toggle],[data-ai-engine-run],[data-ai-engine-retry]');
  if(!t){if(e.target.matches&&e.target.matches('[data-ai-manual-backdrop]'))closeManual();return}
  if(t.closest('[data-ai-contrast-panel]')){e.stopPropagation();e.preventDefault()}
  if(t.hasAttribute('data-ai-manual')){openManual(t.dataset.aiManual);return}
  if(t.hasAttribute('data-ai-manual-close')){closeManual();return}
  if(t.hasAttribute('data-ai-remove')){removeKey(t.dataset.aiRemove);return}
  if(t.hasAttribute('data-ai-open-settings')){
   const nav=document.querySelector('[data-view="settings"]');if(nav)nav.click();
   setTimeout(()=>{const c=document.getElementById('aiIntegrationCard');if(c)c.scrollIntoView({behavior:'smooth',block:'start'})},120);return;
  }
  const panel=t.closest('[data-ai-contrast-panel]'),subject=panel&&subjects.get(panel.dataset.aiContrastPanel);if(!subject)return;
  const st=state(subject);
  if(t.hasAttribute('data-ai-contrast-run'))start(subject,true);
  else if(t.hasAttribute('data-ai-engine-toggle')){st.pickOpen=!st.pickOpen;st.open=true;st.reusedAt=null;if(st.pickOpen)loadEngines(false);refreshPanels()}
  else if(t.hasAttribute('data-ai-engine-run'))runEngine(subject,t.dataset.force==='1');
  else if(t.hasAttribute('data-ai-engine-retry')){engines.error='';loadEngines(true);refreshPanels()}
  else if(t.hasAttribute('data-ai-ask'))askExternal(subject,t.dataset.aiAsk);
  else if(t.hasAttribute('data-ai-paste-toggle')){st.manualOpen=!st.manualOpen;st.open=true;refreshPanels();if(st.manualOpen)setTimeout(()=>{const ta=document.querySelector('[data-ai-contrast-panel="'+CSS.escape(panel.dataset.aiContrastPanel)+'"] textarea[name=answer]');if(ta)ta.focus()},30)}
  else if(t.hasAttribute('data-ai-pick')){const k=t.dataset.aiPick;if(st.selected.has(k))st.selected.delete(k);else if(st.selected.size>=20)say('Máximo 20 acciones por pregunta.',true);else st.selected.add(k);refreshPanels()}
  else if(t.hasAttribute('data-ai-pick-clear')){st.selected.clear();refreshPanels()}
 },true);
 document.addEventListener('change',e=>{
  const t=e.target;if(!t||!t.closest)return;
  const panel=t.closest('[data-ai-contrast-panel]'),subject=panel&&subjects.get(panel.dataset.aiContrastPanel);if(!subject)return;
  const st=state(subject);
  if(t.matches('[data-ai-engine-select]')){st.engine=t.value;st.model='';st.reusedAt=null;refreshPanels()}
  else if(t.matches('[data-ai-engine-model]')){st.model=t.value;st.reusedAt=null;refreshPanels()}
  else if(t.matches('[data-ai-engine-deep]')){st.deep=t.checked;st.reusedAt=null;refreshPanels()}
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.querySelector('[data-ai-manual-backdrop]'))closeManual()});
 window.addEventListener('viewinvai:account-ready',()=>{engines={at:0,loading:false,data:null};config.loaded=false;results.clear();recent={loaded:false,loading:false,list:[]};loadConfig(true);loadRecent()});
 window.addEventListener('viewinvai:auth-changed',()=>{engines={at:0,loading:false,data:null};config={loaded:false,loading:false,serverReady:true,providers:{},defaults:{}};results.clear();recent={loaded:false,loading:false,list:[]};renderSettings();refreshPanels();announce({type:'all',key:''})});
 document.addEventListener('DOMContentLoaded',renderSettings);
 if(document.readyState!=='loading')renderSettings();

 window.ViewInvAIContrast={panelHtml,verdictFor,tickerVerdict,badgeHtml,stockContext,openManual,reload:()=>loadConfig(true),reloadRecent:()=>loadRecent(),autoCheck};
})();
