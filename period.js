/* ViewInvAI · periodo de las variaciones (un solo botón para toda la app).
 * Cada toque pasa por 1D (hoy) → 1S (semana) → 1M (mes) → Σ (desde la compra) y lo aplican a la vez
 * Mi día, Carteras y Mercados. «Desde la compra» solo existe donde hay posición; en el resto se ve la del día.
 * Las acciones de EE. UU. que se miran en LS Exchange (€) se pasan a € con el euro/dólar del BCE de esa
 * fecha: así la semana y el mes son los de tu precio en euros, no los del dólar.
 */
(function(){
 'use strict';
 const KEY='viewinvai:period',MODES=['day','week','month','since'];
 const SYM={day:'1D',week:'1S',month:'1M',since:'Σ'};
 const LABEL={day:'Hoy',week:'Esta semana',month:'Este mes',since:'Desde la compra'};
 // Variación de TradingView para cada periodo (en la divisa de la bolsa de origen).
 const PERF_FIELD={week:'perfWeek',month:'perfMonth',quarter:'perf3M',half:'perf6M',ytd:'perfYtd',year:'perf1Y'};
 const N=v=>{const n=Number(v);return v===null||v===undefined||v===''||!Number.isFinite(n)?null:n};
 let mode=(()=>{try{const v=localStorage.getItem(KEY);return MODES.includes(v)?v:'day'}catch(_){return'day'}})();
 let fx=null,fxAt=0,fxLoading=false;

 function apiUrl(path){
  try{if(window.ViewInvAIRuntime&&typeof window.ViewInvAIRuntime.url==='function')return window.ViewInvAIRuntime.url(path)}catch(_){}
  const native=!!(window.Capacitor&&typeof window.Capacitor.isNativePlatform==='function'&&window.Capacitor.isNativePlatform());
  return native?'https://viewinvai.sonarlab.workers.dev'+path:path;
 }
 async function loadFx(){
  if(fxLoading||Date.now()-fxAt<3*3600e3)return;
  fxLoading=true;
  try{const r=await fetch(apiUrl('/api/fx-history'));const d=await r.json();if(r.ok&&N(d.now)){fx=d;fxAt=Date.now();notify()}else fxAt=Date.now()-2.5*3600e3}
  catch(_){fxAt=Date.now()-2.5*3600e3}
  finally{fxLoading=false}
 }
 // Variación del periodo (en %) de una acción en el mercado en que la miras. dayPct: la del día ya calculada.
 // Devuelve null si no hay dato fiable (nunca se inventa: mejor «—» que una cifra mala).
 function stockPct(s,preferTr,dayPct,m=mode){
  if(m==='day'||m==='since')return N(dayPct);
  const field=PERF_FIELD[m];if(!field)return null;
  const raw=N(s&&s[field]);if(raw===null||raw<=-100||raw>1000)return null;   // >1.000 %: contrasplit o dato roto
  const listingCur=String(s&&s.currency||'USD').toUpperCase();
  if(!preferTr||listingCur==='EUR')return raw;
  if(listingCur!=='USD')return null;
  loadFx();
  const then=N(fx&&fx[m]),now=N(fx&&fx.now);
  if(!then||!now)return null;
  // Precio en € = precio en $ / (dólares por euro): (1+u) · (X_antes / X_ahora) − 1.
  return ((1+raw/100)*(then/now)-1)*100;
 }
 // Variación en dinero a partir del valor actual y la variación en % del periodo.
 const amountFromPct=(value,pct)=>N(value)!==null&&N(pct)!==null&&pct>-100?value-value/(1+pct/100):null;
 function notify(){window.dispatchEvent(new CustomEvent('viewinvai:period-changed',{detail:{mode}}))}
 function set(m){
  if(!MODES.includes(m))return;
  mode=m;try{localStorage.setItem(KEY,m)}catch(_){}
  paint();
  try{if(navigator.vibrate)navigator.vibrate(8)}catch(_){}
  if(m==='week'||m==='month')loadFx();
  notify();
 }
 const next=()=>set(MODES[(MODES.indexOf(mode)+1)%MODES.length]);

 // Botón: el símbolo dice el modo (1D, 1S, 1M, Σ) y el título lo explica.
 function paint(){
  const b=document.getElementById('periodButton');if(!b)return;
  b.dataset.period=mode;
  b.querySelector('b').textContent=SYM[mode];
  const t=LABEL[mode]+' · pulsa para cambiar a '+LABEL[MODES[(MODES.indexOf(mode)+1)%MODES.length]].toLowerCase();
  b.title=t;b.setAttribute('aria-label','Periodo de las variaciones: '+t);
 }
 function ensureButton(){
  const area=document.getElementById('accountArea');if(!area)return;
  let b=document.getElementById('periodButton');
  if(!b){
   b=document.createElement('button');b.type='button';b.id='periodButton';b.className='shell-icon-button period-button';
   b.innerHTML='<b aria-hidden="true"></b>';
   b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();next()});
  }
  // Se coloca una sola vez (delante de la campana si ya existe); no se recoloca después, porque la barra la
  // ordenan otros módulos y moverla en bucle bloqueaba la página.
  if(b.parentNode!==area){const bell=area.querySelector('.notification-bell,#notificationBell');area.insertBefore(b,bell&&bell.parentNode===area?bell:area.firstChild)}
  paint();
 }
 function start(){
  ensureButton();
  // Si la barra se vuelve a pintar y el botón desaparece, se repone (comprobación ligera, sin observar mutaciones).
  setInterval(()=>{if(!document.getElementById('periodButton'))ensureButton()},1500);
  if(mode==='week'||mode==='month')loadFx();
 }
 window.ViewInvAIPeriod={get:()=>mode,set,next,symbol:m=>SYM[m||mode],label:m=>LABEL[m||mode],stockPct,amountFromPct,
  // Etiqueta corta para los chips de las listas: solo fuera de «hoy», para no recargar.
  tag:(m=mode)=>m==='day'?'':SYM[m]};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
