/* ViewInvAI · capa de presentación móvil.
 * - Al bajar por una lista, la cabecera se compacta y la barra inferior (con el botón ⌃)
 *   se oculta; al subir vuelven. Solo en pantallas ≤ 820 px.
 * No toca datos ni navegación: solo clases en <body>.
 */
(function(){
 'use strict';
 const mq=window.matchMedia('(max-width:820px)');
 let lastY=0,ticking=false,acc=0;
 function blocked(){
  const b=document.body;
  return b.classList.contains('mobile-more-open')||b.classList.contains('filter-sheet-open')||b.classList.contains('market-quick-open');
 }
 function apply(){
  ticking=false;
  const b=document.body,y=Math.max(0,window.scrollY||0);
  if(!mq.matches){b.classList.remove('chrome-hide','chrome-compact');lastY=y;return}
  b.classList.toggle('chrome-compact',y>36);
  const dy=y-lastY;lastY=y;
  if(blocked()||y<60){acc=0;b.classList.remove('chrome-hide');return}
  // Accumulate movement in one direction so small jitters do not flicker the bars.
  acc=(Math.sign(dy)===Math.sign(acc))?acc+dy:dy;
  if(acc>24)b.classList.add('chrome-hide');
  else if(acc<-18)b.classList.remove('chrome-hide');
 }
 function onScroll(){if(!ticking){ticking=true;requestAnimationFrame(apply)}}
 // The sticky heading bleeds to the view edges, so it needs that view's own padding.
 function syncHeadingInsets(){
  const v=document.querySelector('.view.active');if(!v)return;
  const cs=getComputedStyle(v);
  v.style.setProperty('--shell-x',(parseFloat(cs.paddingLeft)||0)+'px');
  v.style.setProperty('--shell-top',(parseFloat(cs.paddingTop)||0)+'px');
 }
 function reset(){acc=0;lastY=window.scrollY||0;document.body.classList.remove('chrome-hide');syncHeadingInsets();apply()}
 window.addEventListener('scroll',onScroll,{passive:true});
 window.addEventListener('resize',reset,{passive:true});
 window.addEventListener('viewinvai:view-changed',reset);
 if(mq.addEventListener)mq.addEventListener('change',reset);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',reset,{once:true});else reset();
 window.ViewInvAIShell=Object.assign(window.ViewInvAIShell||{},{resetChrome:reset,openSelectSheet:openPicker});

 /* Barra superior: la campana de avisos vive en el mismo grupo que buscar/ajustes/cuenta y un
  * único «?» abre la ayuda de la sección activa (en móvil se sigue usando el de cada cabecera). */
 function syncGlobalHelp(){
  const help=document.getElementById('globalHelpButton');if(!help)return;
  const src=document.querySelector('.view.active .page-heading [data-help-section]')||document.querySelector('.view.active [data-help-section]');
  help.hidden=!src;
  if(!src)return;
  // help.js trata cualquier .section-help con data-help como disparador y ancla el globo a él.
  help.dataset.helpSection=src.dataset.helpSection||'';
  if(src.dataset.help)help.dataset.help=src.dataset.help;
  if(src.dataset.helpTitle)help.dataset.helpTitle=src.dataset.helpTitle;
 }
 function mountTopActions(){
  // Orden real del DOM = orden visual (? · campana · buscar · ajustes · cuenta), también para el teclado.
  const area=document.getElementById('accountArea');
  if(area){
   const seq=[document.getElementById('globalHelpButton'),document.getElementById('notificationBell'),document.getElementById('globalSearchButton')].filter(Boolean);
   for(let i=0;i<seq.length;i++)if(area.children[i]!==seq[i])area.insertBefore(seq[i],area.children[i]||null);
   // search.js puede añadir la lupa más tarde: se reordena si cambia el grupo (idempotente).
   if(!area.__orderWatch&&window.MutationObserver){area.__orderWatch=new MutationObserver(()=>mountTopActions());area.__orderWatch.observe(area,{childList:true})}
  }
  syncGlobalHelp();
 }
 document.addEventListener('pointerdown',e=>{if(e.target.closest&&e.target.closest('#globalHelpButton'))syncGlobalHelp()},true);
 window.addEventListener('viewinvai:view-changed',()=>setTimeout(mountTopActions,0));
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountTopActions,{once:true});else mountTopActions();

 /* Desplegables propios en móvil.
  * El menú nativo de Android se cierra solo si la vista se repinta (p. ej. con una
  * cotización en vivo) y no sigue el tema. En pantallas táctiles ≤ 820 px cada <select>
  * abre una hoja de la app; el <select> real sigue existiendo y recibe input/change.
  */
 const coarse=window.matchMedia('(max-width:820px)');
 let picker=null,lastOpen=0;
 function enhanced(sel){
  return sel&&sel.tagName==='SELECT'&&coarse.matches&&!sel.multiple&&!sel.disabled&&sel.size<=1&&!sel.closest('[data-native-select]');
 }
 function labelFor(sel){
  if(sel.getAttribute('aria-label'))return sel.getAttribute('aria-label');
  if(sel.id){const l=document.querySelector('label[for="'+CSS.escape(sel.id)+'"]');if(l&&l.textContent.trim())return l.textContent.trim()}
  const wrap=sel.closest('label');
  if(wrap){const t=[...wrap.childNodes].filter(n=>n!==sel&&!(n.contains&&n.contains(sel))).map(n=>n.textContent).join(' ').trim();if(t)return t}
  return sel.title||'Elige una opción';
 }
 function resolve(ref){
  if(ref.el.isConnected)return ref.el;
  if(ref.id)return document.getElementById(ref.id);
  if(ref.name){const scope=ref.formId&&document.getElementById(ref.formId)||document;return scope.querySelector('select[name="'+CSS.escape(ref.name)+'"]')}
  return null;
 }
 function closePicker(){
  if(!picker)return;
  const p=picker;picker=null;
  p.root.classList.remove('open');document.body.classList.remove('select-sheet-open');
  setTimeout(()=>p.root.remove(),180);
  const el=resolve(p.ref);if(el&&typeof el.focus==='function')try{el.focus({preventScroll:true})}catch(_){}
 }
 function choose(value){
  if(!picker)return;
  const el=resolve(picker.ref);
  closePicker();
  if(!el||el.value===value)return;
  el.value=value;
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
 }
 function optionButton(o,current){
  const b=document.createElement('button');
  b.type='button';b.className='select-sheet-option'+(o.value===current?' selected':'');
  b.setAttribute('role','option');b.setAttribute('aria-selected',o.value===current?'true':'false');
  b.disabled=o.disabled;b.dataset.value=o.value;
  const span=document.createElement('span');span.textContent=o.textContent.trim();b.appendChild(span);
  return b;
 }
 function openPicker(sel){
  if(!sel||picker)return;
  lastOpen=Date.now();
  const root=document.createElement('div');
  root.className='select-sheet';
  root.innerHTML='<div class="select-sheet-backdrop" data-select-sheet-close></div><div class="select-sheet-panel" role="dialog" aria-modal="true"><div class="select-sheet-handle"></div><div class="select-sheet-head"><strong></strong><button type="button" class="select-sheet-close" data-select-sheet-close aria-label="Cerrar">×</button></div><div class="select-sheet-list" role="listbox"></div></div>';
  root.querySelector('.select-sheet-head strong').textContent=labelFor(sel);
  const list=root.querySelector('.select-sheet-list'),current=sel.value;
  [...sel.children].forEach(node=>{
   if(node.tagName==='OPTGROUP'){
    const h=document.createElement('div');h.className='select-sheet-group';h.textContent=node.label||'';list.appendChild(h);
    [...node.children].forEach(o=>{if(!o.hidden)list.appendChild(optionButton(o,current))});
   }else if(node.tagName==='OPTION'&&!node.hidden)list.appendChild(optionButton(node,current));
  });
  root.addEventListener('click',e=>{
   if(e.target.closest('[data-select-sheet-close]')){closePicker();return}
   const b=e.target.closest('.select-sheet-option');if(b&&!b.disabled)choose(b.dataset.value);
  });
  document.body.appendChild(root);
  picker={root,ref:{el:sel,id:sel.id,name:sel.name,formId:sel.form&&sel.form.id}};
  document.body.classList.add('select-sheet-open');
  requestAnimationFrame(()=>{
   root.classList.add('open');
   const on=list.querySelector('.selected');if(on)on.scrollIntoView({block:'center'});
  });
 }
 function intercept(e){
  const sel=e.target&&e.target.closest&&e.target.closest('select');
  if(!enhanced(sel))return;
  e.preventDefault();
  if(e.type==='touchend'||Date.now()-lastOpen>600)openPicker(sel);
 }
 // touchend + mousedown: Chrome/WebView open the native list on these, so cancelling
 // them is what keeps the system popup closed.
 document.addEventListener('touchend',intercept,{passive:false,capture:true});
 document.addEventListener('mousedown',intercept,{capture:true});
 document.addEventListener('click',e=>{const sel=e.target&&e.target.closest&&e.target.closest('select');if(enhanced(sel))e.preventDefault()},{capture:true});
 document.addEventListener('keydown',e=>{if(picker&&e.key==='Escape'){e.preventDefault();closePicker()}});
 window.addEventListener('viewinvai:view-changed',closePicker);
})();
