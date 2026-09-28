/* Shared overlay sheet for filters and compact mobile controls. */
(function(root){
 'use strict';
 let active=null,rootEl=null,bodyEl=null,titleEl=null,placeholder=null,source=null;
 function ensure(){
  if(rootEl)return rootEl;
  rootEl=document.createElement('div');
  rootEl.id='sharedFilterSheet';
  rootEl.className='shared-filter-sheet';
  rootEl.setAttribute('aria-hidden','true');
  rootEl.innerHTML=
   '<div class="shared-filter-backdrop" data-filter-sheet-close></div>'+
   '<section class="shared-filter-panel" role="dialog" aria-modal="true" aria-labelledby="sharedFilterTitle">'+
    '<div class="shared-filter-handle" aria-hidden="true"></div>'+
    '<header><strong id="sharedFilterTitle">Filtros</strong><button type="button" data-filter-sheet-close aria-label="Cerrar">×</button></header>'+
    '<div class="shared-filter-body"></div>'+
   '</section>';
  document.body.appendChild(rootEl);
  bodyEl=rootEl.querySelector('.shared-filter-body');
  titleEl=rootEl.querySelector('#sharedFilterTitle');
  rootEl.addEventListener('click',e=>{
   if(e.target.closest('[data-filter-sheet-close]'))close();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active)close()});
  return rootEl;
 }
 function open(selector,title='Filtros'){
  ensure();
  let el=typeof selector==='string'?document.querySelector(selector):selector;
  if(!el)return false;
  if(active)close();
  source=el;active=selector||el;placeholder=document.createComment('filter-sheet-placeholder');
  el.parentNode.insertBefore(placeholder,el);
  bodyEl.appendChild(el);
  el.classList.add('in-filter-sheet');
  if(el.tagName==='DETAILS')el.open=true;
  titleEl.textContent=title;
  rootEl.classList.add('open');rootEl.setAttribute('aria-hidden','false');
  document.body.classList.add('filter-sheet-open');
  requestAnimationFrame(()=>rootEl.querySelector('.shared-filter-panel')?.focus?.());
  return true;
 }
 function close(){
  if(!active)return;
  if(source&&placeholder&&placeholder.parentNode)placeholder.parentNode.insertBefore(source,placeholder);
  if(placeholder&&placeholder.parentNode)placeholder.remove();
  if(source)source.classList.remove('in-filter-sheet');
  rootEl?.classList.remove('open');rootEl?.setAttribute('aria-hidden','true');
  document.body.classList.remove('filter-sheet-open');
  active=null;source=null;placeholder=null;
 }
 function init(){
  ensure();
  document.addEventListener('click',e=>{
   const opener=e.target.closest&&e.target.closest('[data-filter-sheet-target]');
   if(opener){
    e.preventDefault();
    open(opener.dataset.filterSheetTarget,opener.dataset.filterSheetTitle||opener.title||'Filtros');
    return;
   }
   if(active&&e.target.closest&&e.target.closest('[data-filter-sheet-apply]')){
    setTimeout(close,0);
   }
  });
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
 root.ViewInvAIFilterSheet=Object.freeze({open,close});
})(window);
