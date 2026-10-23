/* ViewInvAI · Desplegables que se quedan abiertos.
 * Todo <details> de la app (y cualquier bloque marcado con data-collapsible) sigue estas reglas:
 * 1. No se cierra solo: si una pantalla se repinta con datos nuevos, se vuelve a abrir el que tenías
 *    abierto (se reconoce por sus atributos y el texto de su cabecera, sin las cifras que cambian).
 * 2. La flecha / cabecera lo abre y lo cierra como siempre.
 * 3. Se pliega solo cuando te alejas de él: mientras alguna parte siga en pantalla no se toca, por
 *    largo que sea; se cierra cuando su borde queda más de un 30 % de pantalla fuera de la vista.
 */
(function(){
 'use strict';
 const AWAY=0.3;
 const opened=new Set(),closed=new Set();
 const clean=t=>String(t||'').replace(/[\d.,:%+\-−€$£¥·()×]+/g,' ').replace(/\s+/g,' ').trim().slice(0,60);
 function keyOf(d){
  const own=Object.entries(d.dataset||{}).filter(([k])=>k!=='autoClosed'&&k!=='collapseRestoring').map(([k,v])=>k+'='+v).join('&');
  // El valor al que pertenece: un antecesor que lo lleve o, si no, la tarjeta/fila que lo contiene
  // (en las tarjetas de valores el identificador va en la fila hermana del desplegable).
  const SEL='[data-position-id],[data-stock-key],[data-open-stock],[data-fund-isin],[data-isin],[data-portfolio-id],[data-copy-isin]';
  const card=d.closest('.asset-card,.d-row,li,article,tr');
  const host=d.closest(SEL)||(card&&(card.matches(SEL)?card:card.querySelector(SEL)));
  const hostKey=host?['positionId','stockKey','openStock','fundIsin','isin','portfolioId','copyIsin'].map(k=>host.dataset[k]).filter(Boolean)[0]||'':'';
  const view=d.closest('.view,[id]');
  const sum=d.querySelector(':scope>summary');
  return [(view&&view.id)||'',d.className||'',own,hostKey,clean(sum&&sum.textContent)].join('|');
 }
 // 1 + 2: recordar lo que abre o cierra la persona (no lo que cierra el propio código).
 document.addEventListener('toggle',e=>{
  const d=e.target;if(!d||d.tagName!=='DETAILS'||d.dataset.collapseRestoring==='1')return;
  const k=keyOf(d);
  if(d.open){opened.add(k);closed.delete(k)}
  else if(d.dataset.autoClosed==='1')opened.delete(k);
  else{opened.delete(k);closed.add(k)}
  delete d.dataset.autoClosed;
 },true);
 function restore(root){
  if(!opened.size&&!closed.size)return;
  const list=root.tagName==='DETAILS'?[root]:root.querySelectorAll?root.querySelectorAll('details'):[];
  for(const d of list){
   const k=keyOf(d);
   if(opened.has(k)&&!d.open){d.dataset.collapseRestoring='1';d.open=true;setTimeout(()=>{delete d.dataset.collapseRestoring},0)}
   else if(closed.has(k)&&d.open){d.dataset.collapseRestoring='1';d.open=false;setTimeout(()=>{delete d.dataset.collapseRestoring},0)}
  }
 }
 new MutationObserver(muts=>{
  if(!opened.size&&!closed.size)return;
  for(const m of muts)for(const n of m.addedNodes)if(n.nodeType===1)restore(n);
 }).observe(document.documentElement,{childList:true,subtree:true});
 // 3: plegar lo que ya ha quedado lejos (por arriba o por abajo).
 function far(el){
  const r=el.getBoundingClientRect();
  if(!r.width&&!r.height)return false;              // en una pantalla oculta: no se toca
  const vh=window.innerHeight||1,m=vh*AWAY;
  return r.bottom<-m||r.top>vh+m;
 }
 let ticking=false;
 function check(){
  ticking=false;
  for(const k of [...opened]){
   const els=[...document.querySelectorAll('details[open]')].filter(d=>keyOf(d)===k);
   if(!els.length)continue;
   if(els.every(far)){opened.delete(k);els.forEach(d=>{d.dataset.autoClosed='1';d.open=false})}
  }
  // Bloques propios (p. ej. filas de Carteras): avisan con un evento para plegarse.
  document.querySelectorAll('[data-collapsible].open').forEach(el=>{if(far(el))el.dispatchEvent(new CustomEvent('viewinvai:collapse-away',{bubbles:true}))});
 }
 window.addEventListener('scroll',()=>{if(!ticking&&(opened.size||document.querySelector('[data-collapsible].open'))){ticking=true;requestAnimationFrame(check)}},{passive:true});
 window.ViewInvAICollapse={isFar:far,keyOf,openKeys:()=>[...opened]};
})();
