/* ViewInvAI · primera sincronización.
 * La primera vez que se abre la app (o tras instalar una versión nueva de la APK) se muestra
 * una pantalla de carga con barra de progreso mientras se descargan del servidor los catálogos
 * de acciones y fondos y se sincroniza la cuenta. Cuando todo está, la app aparece ya cargada.
 * Se carga en <head> para tapar la app antes de pintar nada.
 */
(function(){
 'use strict';
 const FLAG='viewinvai:first-sync-v1';
 let done=false;
 try{done=localStorage.getItem(FLAG)==='1'}catch(_){done=true}
 if(done||navigator.webdriver){window.ViewInvAISync={active:false,set(){},fail(){},finish(){}};return}

 document.documentElement.classList.add('first-sync');
 // Peso de cada fase en la barra (suma 100).
 const STAGES={connect:{w:5,label:'Conectando con el servidor…'},market:{w:62,label:'Descargando el catálogo de acciones…'},
  prepare:{w:8,label:'Preparando el catálogo…'},funds:{w:15,label:'Descargando fondos y ETF…'},account:{w:10,label:'Sincronizando tus carteras…'}};
 const progress={connect:0,market:0,prepare:0,funds:0,account:0};
 let shown=0,el=null,finished=false,failed=false,current='connect',bytesText='';
 const started=Date.now();

 function build(){
  if(el||!document.body)return;
  el=document.createElement('div');
  el.id='firstSync';el.setAttribute('role','status');el.setAttribute('aria-live','polite');
  el.innerHTML='<div class="first-sync-card">'+
   '<img class="first-sync-logo brand-logo-dark" src="favicon.svg" alt="" width="84" height="84">'+
   '<img class="first-sync-logo brand-logo-light" src="favicon-light.svg" alt="" width="84" height="84">'+
   '<strong>ViewInvAI</strong>'+
   '<span class="first-sync-title">Cargando datos…</span>'+
   '<div class="first-sync-bar" aria-hidden="true"><i></i></div>'+
   '<div class="first-sync-meta"><span data-sync-label>'+STAGES.connect.label+'</span><b data-sync-pct>0%</b></div>'+
   '<small data-sync-detail>Solo la primera vez: después la app abre al instante con los datos guardados.</small>'+
   '<button type="button" class="btn" data-sync-retry hidden>Reintentar</button>'+
  '</div>';
  el.addEventListener('click',e=>{if(e.target.closest('[data-sync-retry]'))location.reload()});
  document.body.appendChild(el);
  requestAnimationFrame(tick);
 }

 function target(){
  let t=0;for(const [k,s] of Object.entries(STAGES))t+=s.w*Math.max(0,Math.min(1,progress[k]));
  // Mientras una fase espera, la barra avanza despacio dentro de su tramo para no parecer parada.
  if(!finished&&!failed){
   const s=STAGES[current];
   if(s&&progress[current]<1){const creep=Math.min(0.85,(Date.now()-started)/45000);t=Math.max(t,t+s.w*Math.max(0,creep-progress[current])*0.35)}
  }
  return Math.min(finished?100:99,t);
 }
 function tick(){
  if(!el)return;
  const goal=target();
  shown+=Math.max(0.15,(goal-shown)*0.12);
  if(shown>goal)shown=goal;
  const bar=el.querySelector('.first-sync-bar i');if(bar)bar.style.setProperty('width',shown.toFixed(1)+'%');
  const pct=el.querySelector('[data-sync-pct]');if(pct)pct.textContent=Math.round(shown)+'%';
  if(finished&&shown>=99.9){close();return}
  requestAnimationFrame(tick);
 }
 function label(text){const n=el&&el.querySelector('[data-sync-label]');if(n&&!failed)n.textContent=text}

 function set(stage,fraction,info){
  if(!(stage in progress)||finished)return;
  progress[stage]=Math.max(progress[stage],Math.max(0,Math.min(1,Number(fraction)||0)));
  if(info&&info.bytes)bytesText=info.bytes;
  // Fase visible: la primera que no ha terminado.
  const next=Object.keys(STAGES).find(k=>progress[k]<1);
  if(next){current=next;label(STAGES[next].label+(next==='market'&&bytesText?' '+bytesText:''))}
  check();
 }
 function check(){
  if(finished)return;
  if(['connect','market','prepare','funds','account'].every(k=>progress[k]>=1))finish();
 }
 function finish(){
  if(finished)return;
  finished=true;
  label('¡Listo!');
  const t=el&&el.querySelector('.first-sync-title');if(t)t.textContent='Datos cargados';
  try{localStorage.setItem(FLAG,'1')}catch(_){}
  if(!el)close();
 }
 function close(){
  document.documentElement.classList.remove('first-sync');
  if(el){el.classList.add('closing');setTimeout(()=>{el&&el.remove();el=null},450)}
  window.ViewInvAISync.active=false;
  window.dispatchEvent(new CustomEvent('viewinvai:first-sync-done'));
 }
 function fail(message){
  if(finished)return;
  failed=true;
  if(!el)build();
  const n=el.querySelector('[data-sync-label]');if(n)n.textContent=message||'No se han podido descargar los datos.';
  const d=el.querySelector('[data-sync-detail]');if(d)d.textContent='La primera vez hace falta conexión a internet. Comprueba la conexión y vuelve a intentarlo.';
  const b=el.querySelector('[data-sync-retry]');if(b)b.hidden=false;
  el.classList.add('failed');
 }

 window.ViewInvAISync={active:true,set,fail,finish};

 // Cuenta: si hay sesión, se espera a que lleguen la cuenta y las carteras; si no, se salta.
 let accountTimer=setTimeout(()=>set('account',1),12000);
 window.addEventListener('viewinvai:auth-changed',e=>{
  const user=e&&e.detail&&e.detail.user;
  if(!user){set('account',1);return}
  set('account',0.3);
 });
 window.addEventListener('viewinvai:account-ready',()=>set('account',0.7));
 window.addEventListener('viewinvai:fund-portfolios-changed',()=>{if(progress.account>=0.3){clearTimeout(accountTimer);set('account',1)}});
 // Fondos: no bloquean más de 30 s; acciones: el error se muestra con «Reintentar».
 setTimeout(()=>set('funds',1),30000);
 // Salida de seguridad: si algo se queda colgado, la app aparece igualmente.
 setTimeout(()=>{if(!finished&&!failed)finish()},60000);

 if(document.body)build();else document.addEventListener('DOMContentLoaded',build,{once:true});
})();
