/* ViewInvAI · «Pregunta a la IA» (rombo central del diseño D) y resumen AI de Mi día.
 * El servidor responde con el contexto de tus carteras (valores, variación, ganancia, objetivo y
 * avisos) y solo con esos datos. El resumen del día se guarda 3 h en el servidor.
 */
(function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const SPARK='<svg class="ai-spark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.6 6.9 6.9 2.6-6.9 2.6L12 21.5l-2.6-6.9L2.5 12l6.9-2.6z"/></svg>';
 const SUGGEST={
  today:['¿Qué hago hoy?','¿Por qué se mueve mi cartera?','¿Cómo va mi objetivo?'],
  portfolios:['¿Está muy concentrada mi cartera?','¿Qué posición debo vigilar?','¿Cómo va mi objetivo?'],
  recommendation:['¿Qué idea encaja con mi cartera?','¿Qué riesgo tienen estas ideas?','¿Cuánto debería invertir?'],
  home:['¿Qué mueve hoy el mercado?','¿Afecta a mi cartera?','¿Qué vigilo esta semana?'],
  crypto:['¿Cómo va mi cripto?','¿Pesa mucho la cripto en lo mío?','¿Qué riesgo tiene?']
 };
 const S={brief:null,briefLoading:false,briefError:'',briefAt:0,history:[],busy:false};
 function auth(){const A=window.ViewInvAIAuth;try{return A&&A.getUser&&A.getUser()?A:null}catch(_){return null}}
 async function post(body){
  const A=auth();if(!A)throw Error('Inicia sesión para preguntar a la IA con tus carteras.');
  const r=await A.apiFetch('/api/ai/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'La IA no está disponible ahora mismo.');return d;
 }
 const view=()=>{try{return typeof state!=='undefined'&&state.currentView||'today'}catch(_){return'today'}};

 // ---------- Resumen AI de Mi día ----------
 async function loadBrief(force=false){
  if(S.briefLoading||!auth())return;
  if(!force&&S.brief&&Date.now()-S.briefAt<10*60000)return;
  if(!force&&S.briefError&&Date.now()-S.briefAt<120000)return;
  S.briefLoading=true;S.briefError='';paintBrief();
  try{S.brief=await post({mode:'brief',force});S.briefAt=Date.now()}
  catch(error){S.briefError=error.message;S.briefAt=Date.now()}
  finally{S.briefLoading=false;paintBrief()}
 }
 // Desplegable cerrado para los textos de arriba de cada pantalla (diseño D): se ve el título y
 // la primera línea; al tocar se abre entero. Se recuerda abierto/cerrado por bloque.
 function foldOpen(key){try{return localStorage.getItem('viewinvai:fold:'+key)==='1'}catch(_){return false}}
 function fold(key,title,preview,bodyHtml,attrs=''){
  if(document.documentElement.dataset.design!=='d')return bodyHtml;
  return '<details class="d-fold" data-fold="'+esc(key)+'"'+(foldOpen(key)?' open':'')+attrs+'><summary><span class="d-fold-title">'+SPARK+'<span>'+esc(title)+'</span></span>'+
   '<span class="d-fold-preview">'+esc(preview||'')+'</span><i class="d-fold-chev" aria-hidden="true">▾</i></summary><div class="d-fold-body">'+bodyHtml+'</div></details>';
 }
 document.addEventListener('toggle',e=>{const d=e.target;if(d&&d.matches&&d.matches('details[data-fold]')){try{localStorage.setItem('viewinvai:fold:'+d.dataset.fold,d.open?'1':'0')}catch(_){}}},true);
 window.ViewInvAIFold=fold;
 function briefHtml(){
  if(!auth())return'';
  const b=S.brief;
  const when=b&&b.createdAt?new Date(b.createdAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'';
  const body=b?'<p>'+esc(b.summary)+'</p>':S.briefError?'<p class="ai-brief-muted">'+esc(S.briefError)+'</p>':'<p class="ai-brief-muted">Preparando tu resumen…</p>';
  const chips=(b&&b.followUps&&b.followUps.length?b.followUps:SUGGEST.today).map(q=>'<button type="button" data-ai-ask-q="'+esc(q)+'">'+esc(q)+'</button>').join('');
  const html='<section class="ai-brief"'+(document.documentElement.dataset.design==='d'?'':' id="aiBrief"')+' aria-live="polite"><div class="ai-brief-head">'+SPARK+'<span>Resumen AI'+(when?' · '+esc(when):'')+'</span>'+
   '<button type="button" class="ai-brief-refresh" data-ai-brief-refresh aria-label="Actualizar el resumen" title="Actualizar">↻</button></div>'+
   body+'<div class="ai-chips">'+chips+'</div>'+(b&&b.fallback?'<small class="ai-brief-muted">Sin IA ahora: son los datos calculados, sin interpretar.</small>':'')+'</section>';
  if(document.documentElement.dataset.design!=='d')return html;
  const preview=b?b.summary:S.briefError?S.briefError:'Preparando tu resumen…';
  return fold('brief','Resumen AI'+(when?' · '+when:''),preview,html,' id="aiBrief" aria-live="polite"');
 }
 function paintBrief(){const el=document.getElementById('aiBrief');if(el)el.outerHTML=briefHtml()}

 // ---------- Hoja «Pregunta a ViewInvAI» ----------
 function sheet(){
  let el=document.getElementById('aiAskSheet');if(el)return el;
  const bd=document.createElement('div');bd.id='aiAskBackdrop';bd.className='ai-ask-backdrop';
  el=document.createElement('section');el.id='aiAskSheet';el.className='ai-ask-sheet';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','Pregunta a ViewInvAI');el.setAttribute('aria-hidden','true');
  el.innerHTML='<div class="ai-ask-handle" aria-hidden="true"></div><header class="ai-ask-head"><span class="ai-ask-orb">'+SPARK+'</span><div><strong>Pregunta a ViewInvAI</strong><small>Responde con los datos de tus carteras</small></div><button type="button" data-ai-ask-close aria-label="Cerrar">×</button></header>'+
   '<div class="ai-ask-log" id="aiAskLog"></div>'+
   '<form class="ai-ask-form" id="aiAskForm"><input id="aiAskInput" type="text" autocomplete="off" maxlength="600" placeholder="Pregunta sobre tus inversiones…" aria-label="Tu pregunta"><button type="submit" aria-label="Enviar">'+SPARK+'</button></form>'+
   '<p class="ai-ask-note">Ideas para que decidas tú: no es asesoramiento financiero.</p>';
  document.body.append(bd,el);
  bd.addEventListener('click',()=>toggle(false));
  return el;
 }
 function paintLog(){
  const log=document.getElementById('aiAskLog');if(!log)return;
  const v=view(),sug=SUGGEST[v]||SUGGEST.today;
  if(!S.history.length){log.innerHTML='<div class="ai-ask-empty"><p>Pregúntame por tus carteras, tu objetivo o el mercado de hoy.</p><div class="ai-chips">'+sug.map(q=>'<button type="button" data-ai-ask-q="'+esc(q)+'">'+esc(q)+'</button>').join('')+'</div></div>';return}
  log.innerHTML=S.history.map(m=>m.role==='user'?'<div class="ai-msg user"><p>'+esc(m.content)+'</p></div>':
   '<div class="ai-msg ai">'+(m.error?'<p class="ai-brief-muted">'+esc(m.content)+'</p>':'<p>'+esc(m.content).replace(/\n/g,'<br>')+'</p>'+
    (m.keyPoints&&m.keyPoints.length?'<ul>'+m.keyPoints.map(k=>'<li>'+esc(k)+'</li>').join('')+'</ul>':'')+
    (m.followUps&&m.followUps.length?'<div class="ai-chips">'+m.followUps.map(q=>'<button type="button" data-ai-ask-q="'+esc(q)+'">'+esc(q)+'</button>').join('')+'</div>':'')+
    (m.model?'<small class="ai-msg-model">'+esc(m.model)+'</small>':''))+'</div>').join('')+(S.busy?'<div class="ai-msg ai pending"><p>Pensando con tus datos…</p></div>':'');
  log.scrollTop=log.scrollHeight;
 }
 function toggle(open){
  const el=sheet(),bd=document.getElementById('aiAskBackdrop');
  el.classList.toggle('open',open);bd.classList.toggle('open',open);el.setAttribute('aria-hidden',open?'false':'true');
  document.body.classList.toggle('ai-ask-open',open);
  if(open){paintLog();setTimeout(()=>{const i=document.getElementById('aiAskInput');if(i&&!('ontouchstart' in window))i.focus()},120)}
 }
 // Valores de los que trata la pregunta: los que nombra (o los de las preguntas anteriores) y la ficha
 // abierta. El servidor añade sus datos de mercado y sus noticias aunque no estén en cartera.
 function focusKeys(question){
  const keys=[];
  try{const N=window.ViewInvAINews;if(N&&N.mentionKeys){
   for(const k of N.mentionKeys(question))if(!keys.includes(k))keys.push(k);
   if(!keys.length)for(const m of S.history.filter(x=>x.role==='user').slice(-2).reverse())for(const k of N.mentionKeys(m.content))if(!keys.includes(k))keys.push(k);
  }}catch(_){}
  try{if(view()==='profile'&&state.profileKey&&!keys.includes(state.profileKey))keys.unshift(state.profileKey)}catch(_){}
  return keys.slice(0,4);
 }
 async function ask(question,opts={}){
  question=String(question||'').trim();if(!question||S.busy)return;
  toggle(true);
  const prior=S.history.filter(m=>!m.error).slice(-6).map(m=>({role:m.role==='user'?'user':'assistant',content:m.content}));
  S.history.push({role:'user',content:question});S.busy=true;paintLog();
  try{const d=await post({mode:'ask',question,history:prior,view:view(),focus:focusKeys(question),news:Array.isArray(opts.news)?opts.news.slice(0,6):undefined});S.history.push({role:'ai',content:d.answer||'Sin respuesta.',keyPoints:d.keyPoints,followUps:d.followUps,model:d.model})}
  catch(error){S.history.push({role:'ai',content:error.message,error:true})}
  finally{S.busy=false;paintLog()}
 }
 document.addEventListener('click',e=>{
  const t=e.target.closest&&e.target.closest('[data-ai-ask],[data-ai-ask-q],[data-ai-ask-close],[data-ai-brief-refresh]');if(!t)return;
  if(t.hasAttribute('data-ai-ask-close')){toggle(false);return}
  if(t.hasAttribute('data-ai-brief-refresh')){loadBrief(true);return}
  if(t.dataset.aiAskQ){e.preventDefault();ask(t.dataset.aiAskQ);return}
  e.preventDefault();toggle(!document.getElementById('aiAskSheet')?.classList.contains('open'));
 });
 document.addEventListener('submit',e=>{if(e.target&&e.target.id==='aiAskForm'){e.preventDefault();const i=document.getElementById('aiAskInput');const q=i.value;i.value='';ask(q)}});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.getElementById('aiAskSheet')?.classList.contains('open'))toggle(false)});
 window.addEventListener('viewinvai:view-changed',()=>{if(document.getElementById('aiAskSheet')?.classList.contains('open'))toggle(false)});
 window.ViewInvAIAsk={open:()=>toggle(true),ask,briefHtml,loadBrief};
})();
