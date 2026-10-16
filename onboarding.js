/* ViewInvAI · primeros pasos: tres pantallas la primera vez que se abre la app.
 * Se puede volver a ver desde Configuración («Ver la introducción»). */
(function(){
 'use strict';
 const KEY='viewinvai:onboarded:v1';
 const STEPS=[
  {icon:'✹',title:'Radar AI te dice qué mirar hoy',text:'Analiza miles de acciones de EEUU y de Trade Republic con precio y volumen en vivo, noticias y catalizadores. Las clasifica en Alta convicción, Oportunidad y Vigilancia, separa las especulativas y te propone entrada, stop y tamaño. Su historial de aciertos frente al S&P 500 es público en la propia vista.'},
  {icon:'▣',title:'Tus carteras, sin apuntar a mano',text:'Importa tus operaciones de Trade Republic (CSV) o IBKR con ⇩ en Carteras: acciones, fondos, planes de ahorro y dividendos. Verás tu rentabilidad real frente al MSCI World y el S&P 500, el riesgo de concentración y en Fiscal el IRPF ya calculado.'},
  {icon:'🔔',title:'Que te avise la app, no al revés',text:'Activa la campana 🔔 de cualquier valor para recibir noticias, cambios en Radar AI o un precio exacto. Todo lo que te llega queda en Avisos. Con la lupa de arriba encuentras cualquier acción, fondo o ETF por nombre, ticker o ISIN.'}
 ];
 let step=0,box=null;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function seen(){try{return localStorage.getItem(KEY)==='1'}catch(_){return true}}
 function markSeen(){try{localStorage.setItem(KEY,'1')}catch(_){}}
 function paint(){
  const s=STEPS[step],last=step===STEPS.length-1;
  box.innerHTML='<div class="onb-card" role="dialog" aria-modal="true" aria-labelledby="onbTitle">'+
   '<button type="button" class="onb-skip" data-onb-skip>Saltar</button>'+
   '<div class="onb-icon" aria-hidden="true">'+s.icon+'</div>'+
   '<h2 id="onbTitle">'+esc(s.title)+'</h2><p>'+esc(s.text)+'</p>'+
   '<div class="onb-dots" aria-label="Paso '+(step+1)+' de '+STEPS.length+'">'+STEPS.map((_,i)=>'<i class="'+(i===step?'on':'')+'"></i>').join('')+'</div>'+
   '<div class="onb-actions">'+(step?'<button type="button" class="btn ghost" data-onb-prev>‹ Atrás</button>':'<span></span>')+
   '<button type="button" class="btn" data-onb-next>'+(last?'Empezar':'Siguiente')+'</button></div></div>';
  box.querySelector('[data-onb-next]').focus({preventScroll:true});
 }
 function close(){markSeen();if(box){box.remove();box=null}document.body.classList.remove('onb-open')}
 function open(){
  step=0;if(box)box.remove();
  box=document.createElement('div');box.className='onb-overlay';document.body.appendChild(box);document.body.classList.add('onb-open');
  box.addEventListener('click',e=>{
   if(e.target.closest('[data-onb-skip]'))return close();
   if(e.target.closest('[data-onb-prev]')){step=Math.max(0,step-1);return paint()}
   if(e.target.closest('[data-onb-next]')){if(step>=STEPS.length-1)return close();step++;return paint()}
  });
  box.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  paint();
 }
 document.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('[data-onboarding-open]')){e.preventDefault();open()}});
 // First run only, once the app has painted its first view (never in automated tests).
 const maybeOpen=()=>setTimeout(()=>{if(!seen()&&!document.body.classList.contains('stock-detail-open'))open()},1200);
 // Tras la primera sincronización (pantalla de carga), no encima de ella.
 if(!seen()&&!navigator.webdriver)window.addEventListener('load',()=>{const S=window.ViewInvAISync;if(S&&S.active)window.addEventListener('viewinvai:first-sync-done',maybeOpen,{once:true});else maybeOpen()});
 window.ViewInvAIOnboarding={open};
})();
