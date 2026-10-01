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
 window.ViewInvAIShell=Object.assign(window.ViewInvAIShell||{},{resetChrome:reset});
})();
