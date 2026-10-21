/*
 * ViewInvAI · iconos de línea
 * ---------------------------
 * Un solo juego de iconos (trazo 1,75, 24×24, color del tema) para los botones de icono de
 * toda la app. Sustituye los símbolos y emojis (?, ↻, ⚙, 🔔, 💼, ✏️, ↺, 🗑) de los botones
 * que solo contienen ese símbolo, también los que se pintan después (fichas, listas).
 */
(root=>{
 'use strict';
 const P={
  help:'<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.4"/><path d="M12 16.8h.01"/>',
  settings:'<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  bell:'<path d="M6.5 15.5V11a5.5 5.5 0 0 1 11 0v4.5l1.5 2h-14z"/><path d="M10.2 19.5a2 2 0 0 0 3.6 0"/>',
  refresh:'<path d="M19.5 11A7.5 7.5 0 0 0 6 6.6L4.5 8"/><path d="M4.5 4v4h4"/><path d="M4.5 13A7.5 7.5 0 0 0 18 17.4l1.5-1.4"/><path d="M19.5 20v-4h-4"/>',
  reset:'<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>',
  wallet:'<rect x="3.5" y="7" width="17" height="12" rx="2.6"/><path d="M8.8 7V5.6c0-.9.7-1.6 1.6-1.6h3.2c.9 0 1.6.7 1.6 1.6V7"/><path d="M3.5 12.3h17"/>',
  edit:'<path d="M5 19h3.6L18.4 9.2a1.9 1.9 0 0 0 0-2.7l-.9-.9a1.9 1.9 0 0 0-2.7 0L5 15.4z"/><path d="m13.6 7.2 3.2 3.2"/>',
  trash:'<path d="M5 7h14"/><path d="M9.5 7V5.2c0-.7.5-1.2 1.2-1.2h2.6c.7 0 1.2.5 1.2 1.2V7"/><path d="M7 7l.8 11.2c.1.9.8 1.8 1.8 1.8h4.8c1 0 1.7-.9 1.8-1.8L17 7"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>'
 };
 const GLYPH={'?':'help','⚙':'settings','⚙️':'settings','🔔':'bell','↻':'refresh','↺':'reset','💼':'wallet','✏️':'edit','✏':'edit','🗑':'trash','🗑️':'trash'};
 function svg(name){return'<svg class="vi-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+(P[name]||'')+'</svg>'}
 // Solo botones cuyo contenido entero es el símbolo (o un <span> con él): nunca texto con icono.
 function upgrade(btn){
  if(btn.dataset.viIcon)return;
  const target=btn.children.length===1&&btn.firstElementChild.tagName==='SPAN'&&!btn.firstElementChild.children.length?btn.firstElementChild:btn.children.length?null:btn;
  if(!target)return;
  const name=GLYPH[String(target.textContent||'').trim()];if(!name)return;
  target.innerHTML=svg(name);btn.dataset.viIcon=name;btn.classList.add('vi-icon-button');
 }
 function scan(scope){
  (scope||document).querySelectorAll('button:not([data-vi-icon]),.notification-bell-icon').forEach(el=>{
   if(el.classList.contains('notification-bell-icon')){if(!el.dataset.viIcon&&GLYPH[el.textContent.trim()]){el.innerHTML=svg('bell');el.dataset.viIcon='bell'}return}
   upgrade(el);
  });
 }
 let queued=false;
 function queue(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;scan()})}
 function init(){
  scan();
  new MutationObserver(list=>{for(const m of list)if(m.addedNodes.length||m.type==='characterData'){queue();return}}).observe(document.body,{childList:true,subtree:true,characterData:true});
 }
 root.ViewInvAIIcons={svg,scan};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
