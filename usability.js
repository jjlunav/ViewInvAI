/*
 * ViewInvAI usability
 * -------------------
 * - Vista «Sencilla» (por defecto) / «Experta»: html[data-detail]. En la sencilla se ocultan los datos
 *   que solo entiende un experto (ISIN, modelo cuantitativo, beta, sesiones fuera de hora, columnas
 *   técnicas del Screener…). Elementos marcados con .vi-expert se ocultan también.
 * - Glosario: una «i» junto a los términos financieros con su explicación en lenguaje llano
 *   (usa el globo de ayuda de help.js).
 * - Carruseles horizontales: difuminado por el lado en el que queda contenido.
 */
(function(root){
 'use strict';
 const KEY='viewinvai:detail:v1',SCOPE='detail';
 const html=document.documentElement;

 function read(){try{const v=localStorage.getItem(KEY);return v==='expert'?'expert':'simple'}catch(_){return'simple'}}
 function current(){return html.dataset.detail==='expert'?'expert':'simple'}
 function apply(mode,{save=true,render=true}={}){
  mode=mode==='expert'?'expert':'simple';
  const changed=current()!==mode;
  html.dataset.detail=mode;
  if(save){
   try{localStorage.setItem(KEY,mode)}catch(_){}
   try{root.ViewInvAIUiPreferences&&root.ViewInvAIUiPreferences.save(SCOPE,{mode})}catch(_){}
  }
  paintSwitches();
  // La pestaña Técnico se oculta en la vista sencilla: si estaba abierta, la ficha vuelve a General.
  if(mode==='simple')document.querySelectorAll('[data-profile-tab="technical"][aria-selected="true"]').forEach(t=>{
   const g=t.parentElement&&t.parentElement.querySelector('[data-profile-tab="general"]');if(g)g.click();
  });
  if(changed&&render){
   try{if(typeof root.renderCurrentView==='function')root.renderCurrentView()}catch(_){}
   root.dispatchEvent(new CustomEvent('viewinvai:detail-changed',{detail:{mode}}));
  }
 }
 if(!html.dataset.detail)html.dataset.detail=read();
 root.ViewInvAIDetail=Object.freeze({simple:()=>current()==='simple',get:current,set:mode=>apply(mode)});

 // ---------- Interruptor ----------
 function switchHtml(){
  const m=current(),b=(v,l)=>'<button type="button" data-vi-detail="'+v+'" aria-pressed="'+(m===v)+'">'+l+'</button>';
  return '<small>Vista</small><div class="vi-detail-seg" role="group" aria-label="Cantidad de datos">'+b('simple','Sencilla')+b('expert','Experta')+'</div>'+
   '<span>'+(m==='simple'?'Solo lo esencial. Cambia a Experta para ver datos técnicos.':'Todos los datos técnicos a la vista.')+'</span>';
 }
 function paintSwitches(){document.querySelectorAll('.vi-detail-switch').forEach(el=>{el.innerHTML=switchHtml()})}
 function mountSwitches(){
  // Solo el diseño D sabe ocultar datos: en el clásico el interruptor no haría nada.
  if(html.dataset.design!=='d'){document.querySelectorAll('.vi-detail-switch').forEach(el=>el.remove());return}
  const side=document.querySelector('#sidebar');
  if(side&&!side.querySelector('.vi-detail-switch')){
   const el=document.createElement('div');el.className='vi-detail-switch';el.innerHTML=switchHtml();
   const nav=side.querySelector('.nav');if(nav)nav.after(el);else side.appendChild(el);
  }
  const sheet=document.querySelector('#mobileMoreSheet');
  if(sheet&&!sheet.querySelector('.vi-detail-switch')){
   const el=document.createElement('div');el.className='vi-detail-switch';el.innerHTML=switchHtml();
   const head=sheet.querySelector('.mobile-more-head');if(head)head.after(el);else sheet.prepend(el);
  }
 }
 document.addEventListener('click',e=>{
  const b=e.target.closest&&e.target.closest('[data-vi-detail]');if(!b)return;
  e.preventDefault();apply(b.dataset.viDetail);
 });
 root.addEventListener('viewinvai:account-ready',()=>{
  try{root.ViewInvAIUiPreferences&&root.ViewInvAIUiPreferences.load(SCOPE,{mode:read()}).then(p=>{if(p&&(p.mode==='simple'||p.mode==='expert')&&p.mode!==current())apply(p.mode,{save:false})})}catch(_){}
 });

 // ---------- Glosario ----------
 const RADAR='Acciones que la IA ve interesantes hoy. El número del círculo es su puntuación de 0 a 100: cuanto más alta, más señales a favor (tendencia, volumen, noticias). «Oportunidad»: buena pinta. «Vigilancia»: empieza a moverse pero aún sin señal clara. «Especulativo»: mucho riesgo. No es una recomendación de compra: decides tú.';
 const CASH='Dinero sin invertir que tienes en la cuenta del bróker.';
 const G={
  'Patrimonio total':'Todo lo que tienes: lo invertido en acciones, fondos y cripto más el dinero en efectivo.',
  'Bolsa y fondos':'Lo que valen ahora tus acciones, fondos y ETFs (los ETF son fondos que cotizan como una acción).',
  'Efectivo':CASH,
  'Capital líquido':CASH+' Tócalo para cambiar la cantidad.',
  'Invertido':'Lo que pagaste por las posiciones que tienes ahora, comisiones incluidas.',
  'Desde la compra':'Cuánto has ganado o perdido en total: lo que ganan o pierden tus posiciones actuales más lo que ya ganaste o perdiste al vender.',
  'Rentabilidad':'Cuánto ha subido o bajado tu dinero invertido en el periodo, en %. No le afecta cuándo metiste o sacaste dinero, así se puede comparar con la bolsa en general.',
  'Riesgo y dividendos':'Concentración: si dependes demasiado de un solo valor. Dividendos: lo que cobrarías al año en pagos que hacen algunas empresas a sus accionistas.',
  'Ideas del Radar':RADAR,
  'Ideas de hoy':RADAR,
  'Movimientos fuertes':'Las acciones que más suben o bajan hoy. El número del círculo es la puntuación de la IA (0–100). «Máx. 52 s» y «Mín. 52 s»: en su precio más alto o más bajo del último año.',
  'Lo más seguido':'Los índices (la bolsa en conjunto: el S&P 500 son las 500 mayores empresas de EE. UU.) y los valores que más miras.',
  'Agenda':'Datos económicos que se publican hoy (empleo, inflación…) y pueden mover la bolsa. «ant.» es el dato anterior y «prev.» lo que se espera.',
  'Indicadores oficiales':'Datos de los bancos centrales: tipos de interés (lo que cuesta el dinero), inflación (cuánto suben los precios), paro y rentabilidad de los bonos del Estado.',
  'Acciones':'Tus partes de empresas. El círculo de cada una es la puntuación de la IA (0–100) y debajo verás qué te propone: mantener, vender o vigilar un nivel de precio (stop: si baja de ahí, conviene salir).',
  'Fondos':'Fondos de inversión y ETFs: cestas de muchas acciones o bonos gestionadas por otros. Diversifican el riesgo.',
  'Tus cuentas':'Cada bróker o cuenta donde tienes inversiones, con lo que vale hoy y cuánto ha cambiado.',
  'Favoritos':'Valores que sigues aunque no los tengas comprados. Añádelos con ☆.'
 };
 const SEL='h2,h3,h4,small,.insights-title,.d-stats small,.d-group>header>h3,.asset-card-label';
 function labelOf(el){
  let t='';for(const n of el.childNodes)if(n.nodeType===3)t+=n.textContent;
  return t.replace(/[✎·]/g,'').replace(/\s+/g,' ').trim();
 }
 function decorate(scope){
  (scope||document).querySelectorAll(SEL).forEach(el=>{
   if(el.querySelector(':scope>.vi-gloss')||el.closest('#hoverHelpBanner,.vi-detail-switch,.mobile-more-sheet'))return;
   const k=labelOf(el),text=G[k];if(!text)return;
   const i=document.createElement('span');
   i.className='section-help vi-gloss';i.setAttribute('role','button');i.tabIndex=0;
   i.setAttribute('aria-label','Qué es «'+k+'»');i.dataset.help=text;i.dataset.helpTitle=k;i.textContent='i';
   el.appendChild(i);
  });
 }
 // Teclado: Enter/Espacio abre la explicación como un clic.
 document.addEventListener('keydown',e=>{
  const t=e.target;if(!(t&&t.classList&&t.classList.contains('vi-gloss')))return;
  if(e.key==='Enter'||e.key===' '){e.preventDefault();t.click()}
 });

 // ---------- Carruseles ----------
 const SCROLLERS='.d-agenda,.scr-pchips,.d-pills';
 function edge(el){
  const more=el.scrollWidth-el.clientWidth-el.scrollLeft>4,less=el.scrollLeft>4;
  el.classList.toggle('vi-scroll-more',more);el.classList.toggle('vi-scroll-less',less);
 }
 function watchScrollers(scope){
  (scope||document).querySelectorAll(SCROLLERS).forEach(el=>{
   if(!el.__viScroll){el.__viScroll=1;el.addEventListener('scroll',()=>edge(el),{passive:true})}
   edge(el);
  });
 }

 // ---------- Arranque y repintados ----------
 let queued=false;
 function sweep(){queued=false;mountSwitches();decorate();watchScrollers()}
 // Las cotizaciones en vivo cambian el DOM sin parar: como mucho un repaso cada 300 ms.
 function queue(){if(queued)return;queued=true;setTimeout(sweep,300)}
 function start(){
  sweep();
  if(typeof MutationObserver==='function'){
   const main=document.querySelector('main')||document.body;
   new MutationObserver(queue).observe(main,{childList:true,subtree:true});
  }
  root.addEventListener('resize',queue);
  root.addEventListener('viewinvai:view-changed',queue);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(window);
