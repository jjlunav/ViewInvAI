/* ViewInvAI · tareas en segundo plano (importaciones, sincronizaciones).
 * Una píldora flotante arriba aparece solo mientras hay tareas: progreso, avisos y
 * preguntas (p. ej. qué hacer con un valor duplicado). Al tocarla se abre el panel
 * con el detalle. Al terminar muestra el resultado unos segundos y desaparece.
 *
 *   const t = ViewInvAITasks.start('Importar Trade Republic');
 *   t.progress(40, 340, 'Operaciones');   t.log('CYTH: …', 'error');
 *   const choice = await t.ask('¿Qué mantengo?', [{id:'broker',label:'…'}], {remember:'key'});
 *   t.done('340 importadas');             t.fail('Sin conexión');
 */
(function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const tasks=[];let pill=null,panel=null,panelOpen=false,hideTimer=null,seq=0;
 // Decisiones pendientes (p. ej. «¿vendes en pérdidas o mantienes?»): persisten hasta que se contestan.
 let decisions=[];const busy=new Set();
 function ensureUi(){
  if(pill)return;
  pill=document.createElement('button');pill.type='button';pill.id='taskPill';pill.className='task-pill';pill.hidden=true;
  pill.setAttribute('aria-live','polite');pill.setAttribute('aria-controls','taskPanel');
  pill.addEventListener('click',()=>setPanel(!panelOpen));
  panel=document.createElement('section');panel.id='taskPanel';panel.className='task-panel';panel.hidden=true;panel.setAttribute('aria-label','Tareas en curso');
  panel.addEventListener('click',onPanelClick);
  document.body.append(pill,panel);
 }
 function active(){return tasks.filter(t=>t.state==='running'||t.state==='asking')}
 function setPanel(open){
  panelOpen=!!open&&(tasks.length>0||decisions.length>0);ensureUi();
  panel.hidden=!panelOpen;pill.setAttribute('aria-expanded',String(panelOpen));
  if(panelOpen)paintPanel();
 }
 function paintPill(){
  ensureUi();clearTimeout(hideTimer);
  const run=active(),asking=tasks.find(t=>t.state==='asking');
  if(run.length){
   const t=asking||run[0];
   const pct=t.total?Math.round(t.current/t.total*100):null;
   pill.hidden=false;pill.className='task-pill'+(asking?' asking':'');
   pill.innerHTML=(asking?'<i class="task-q" aria-hidden="true">?</i>':'<i class="task-spin" aria-hidden="true"></i>')+
    '<span>'+esc(asking?'Tienes una pregunta':t.label||t.title)+(asking||pct===null?'':' · '+pct+' %')+'</span>'+(run.length>1?'<b>'+run.length+'</b>':'')+
    (pct!==null&&!asking?'<em style="--p:'+pct+'%"></em>':'');
   pill.querySelector('em')?.style.setProperty('--p',pct+'%');
   return;
  }
  const last=tasks[tasks.length-1];
  if(!last){paintDecisionPill();return}
  pill.hidden=false;pill.className='task-pill '+(last.state==='failed'?'failed':'done');
  pill.innerHTML='<i aria-hidden="true">'+(last.state==='failed'?'!':'✓')+'</i><span>'+esc(last.summary||last.title)+'</span>';
  // Finished: stays a few seconds (longer with errors) unless the panel is open.
  hideTimer=setTimeout(()=>{if(panelOpen)return;tasks.splice(0,tasks.length,...active());paintDecisionPill()},last.errors?12000:6000);
 }
 function paintDecisionPill(){
  if(!decisions.length){pill.hidden=true;if(panelOpen&&!tasks.length)setPanel(false);return}
  pill.hidden=false;pill.className='task-pill asking decision';
  pill.innerHTML='<i class="task-q" aria-hidden="true">?</i><span>'+(decisions.length===1?esc(decisions[0].pill||'Tienes una decisión pendiente'):decisions.length+' decisiones pendientes')+'</span>';
 }
 function paintPanel(){
  if(!panelOpen||!panel)return;
  panel.innerHTML='<header><strong>'+(tasks.length?'Tareas':'Decisiones')+'</strong><button type="button" data-task-close aria-label="Cerrar">×</button></header>'+
   decisions.map(d=>'<article class="task-item decision-item is-asking'+(busy.has(d.id)?' is-busy':'')+'" data-decision="'+esc(d.id)+'"><div class="task-head"><b>'+esc(d.title)+'</b><span>'+esc(d.when||'Esperando tu decisión')+'</span></div>'+
    '<div class="task-question"><p>'+esc(d.text)+'</p>'+(d.detailHtml||'')+
    '<div class="task-options">'+d.options.map((o,i)=>'<button type="button" class="btn'+(i?' ghost':'')+'" data-decision-answer="'+esc(d.id)+'" data-choice="'+esc(o.id)+'"'+(busy.has(d.id)?' disabled':'')+'>'+esc(o.label)+'</button>').join('')+'</div>'+
    (d.error?'<p class="task-error">'+esc(d.error)+'</p>':'')+'</div></article>').join('')+
   tasks.slice().reverse().map(t=>{
    const pct=t.total?Math.round(t.current/t.total*100):null;
    const q=t.question;
    return '<article class="task-item is-'+t.state+'"><div class="task-head"><b>'+esc(t.title)+'</b><span>'+esc(t.state==='done'?'Terminado':t.state==='failed'?'Error':t.state==='asking'?'Esperando tu respuesta':(t.label||'En curso'))+'</span></div>'+
     (pct!==null&&t.state!=='done'?'<div class="task-bar"><i data-task-w="'+pct+'"></i></div><small>'+t.current+' de '+t.total+'</small>':'')+
     (t.summary?'<p class="task-summary">'+esc(t.summary)+'</p>':'')+
     (q?'<div class="task-question"><p>'+esc(q.text)+'</p>'+(q.detail?'<small>'+esc(q.detail)+'</small>':'')+
       '<div class="task-options">'+q.options.map((o,i)=>'<button type="button" class="btn'+(i?' ghost':'')+'" data-task-answer="'+t.id+'" data-choice="'+esc(o.id)+'">'+esc(o.label)+'</button>').join('')+'</div>'+
       (q.remember?'<label class="task-remember"><input type="checkbox" data-task-remember="'+t.id+'"> Recordar mi elección</label>':'')+'</div>':'')+
     (t.logs.length?'<ul class="task-log">'+t.logs.slice(-30).map(l=>'<li class="'+l.level+'">'+esc(l.text)+'</li>').join('')+'</ul>':'')+
    '</article>';
   }).join('');
  panel.querySelectorAll('[data-task-w]').forEach(el=>el.style.setProperty('width',el.dataset.taskW+'%'));
 }
 function onPanelClick(e){
  if(e.target.closest('[data-task-close]')){setPanel(false);paintPill();return}
  const da=e.target.closest('[data-decision-answer]');
  if(da){
   const d=decisions.find(x=>x.id===da.dataset.decisionAnswer);if(!d||busy.has(d.id))return;
   busy.add(d.id);d.error='';paint();
   Promise.resolve().then(()=>d.onAnswer(da.dataset.choice)).then(()=>{busy.delete(d.id);decisions=decisions.filter(x=>x!==d);if(!decisions.length&&!tasks.length)setPanel(false);paint()})
    .catch(err=>{busy.delete(d.id);d.error=err&&err.message||'No se pudo guardar';paint()});
   return;
  }
  const link=e.target.closest('[data-decision-open]');
  if(link){const d=decisions.find(x=>x.id===link.dataset.decisionOpen);if(d&&d.onOpen){setPanel(false);paintPill();d.onOpen()}return}
  const a=e.target.closest('[data-task-answer]');
  if(a){
   const t=tasks.find(x=>String(x.id)===a.dataset.taskAnswer);if(!t||!t.question)return;
   const q=t.question,remember=panel.querySelector('[data-task-remember="'+t.id+'"]')?.checked;
   if(remember&&q.remember){try{localStorage.setItem('viewinvai:task-choice:'+q.remember,a.dataset.choice)}catch(_){}}
   t.question=null;t.state='running';
   t.log('Elegido: '+(q.options.find(o=>o.id===a.dataset.choice)||{}).label,'info');
   q.resolve(a.dataset.choice);
   if(!tasks.some(x=>x.state==='asking'))setPanel(false);
   paint();
  }
 }
 function paint(){paintPill();paintPanel()}
 function start(title){
  ensureUi();
  const t={id:++seq,title,label:'',state:'running',current:0,total:0,logs:[],errors:0,summary:'',question:null,
   progress(current,total,label){t.current=current;t.total=total;if(label!==undefined)t.label=label;paint()},
   log(text,level='info'){t.logs.push({text:String(text),level});if(level==='error')t.errors++;paint()},
   ask(text,options,{detail='',remember=''}={}){
    if(remember){let saved=null;try{saved=localStorage.getItem('viewinvai:task-choice:'+remember)}catch(_){}
     if(saved&&options.some(o=>o.id===saved)){t.log(text+' → '+options.find(o=>o.id===saved).label+' (recordado)');return Promise.resolve(saved)}}
    return new Promise(resolve=>{t.question={text,detail,options,remember,resolve};t.state='asking';paint();
     if(window.ViewInvAIPortfolios&&typeof window.ViewInvAIPortfolios.toast==='function')window.ViewInvAIPortfolios.toast('La importación necesita tu respuesta: toca el aviso de arriba')});
   },
   done(summary){t.state='done';t.summary=summary||'Terminado';paint()},
   fail(message){t.state='failed';t.summary=message||'No se pudo terminar';t.errors++;paint()}
  };
  // Older finished tasks leave the list when a new one starts.
  for(let i=tasks.length-1;i>=0;i--)if(tasks[i].state==='done'||tasks[i].state==='failed')tasks.splice(i,1);
  tasks.push(t);paint();return t;
 }
 window.addEventListener('beforeunload',e=>{if(active().length){e.preventDefault();e.returnValue=''}});
 function setDecisions(list){decisions=Array.isArray(list)?list.slice():[];ensureUi();paint()}
 window.ViewInvAITasks={start,running:()=>active().length,open:()=>setPanel(true),setDecisions,decisions:()=>decisions.slice()};
})();
