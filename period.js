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

 // Botón: va en la cabecera de cada sección con cifras (Tus cuentas, Lo más seguido, Ideas de hoy…). Todos son el
 // mismo interruptor: al pulsar cualquiera cambian todos a la vez. El símbolo dice el modo (1D, 1S, 1M, Σ).
 const title=m=>LABEL[m]+' · pulsa para ver '+LABEL[MODES[(MODES.indexOf(m)+1)%MODES.length]].toLowerCase();
 function buttonHtml(){
  return '<button type="button" class="d-period" data-period-cycle data-period="'+mode+'" title="'+title(mode)+'" aria-label="Periodo de las variaciones: '+title(mode)+'"><b aria-hidden="true">'+SYM[mode]+'</b></button>';
 }
 function paint(){
  document.querySelectorAll('[data-period-cycle]').forEach(b=>{
   b.dataset.period=mode;const t=b.querySelector('b');if(t)t.textContent=SYM[mode];
   b.title=title(mode);b.setAttribute('aria-label','Periodo de las variaciones: '+title(mode));
  });
 }
 document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-period-cycle]');if(!b)return;e.preventDefault();e.stopPropagation();next()});
 if(mode==='week'||mode==='month')loadFx();
 // Botones escritos en el HTML (barras de los catálogos): se ponen en el modo guardado al cargar.
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',paint);else paint();
 window.ViewInvAIPeriod={get:()=>mode,set,next,symbol:m=>SYM[m||mode],label:m=>LABEL[m||mode],stockPct,amountFromPct,
  // Etiqueta corta para los chips de las listas: solo fuera de «hoy», para no recargar.
  tag:(m=mode)=>m==='day'?'':SYM[m],buttonHtml};
})();
