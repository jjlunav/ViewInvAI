/* ViewInvAI · Screener IA
 * Perfiles predefinidos, búsqueda escrita convertida en filtros por la IA, filtros en chips, vistas de columnas
 * y la frase «por qué entra» de cada valor. Todo se calcula con los datos de la app (market.json): la IA solo
 * elige campos y umbrales de una lista cerrada (el servidor descarta lo demás).
 * Se monta encima de las tablas de acciones LSX (€) y EE. UU. ($) de catalog.js.
 */
(function(){
 'use strict';
 const KEY='viewinvai:screener:v1';
 const N=v=>{const n=Number(v);return v===null||v===undefined||v===''||!Number.isFinite(n)?null:n};
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=(v,d=1)=>N(v)===null?'—':Number(v).toLocaleString('es-ES',{minimumFractionDigits:d,maximumFractionDigits:d});
 const ratio=(a,b)=>N(a)!==null&&N(b)>0?(a/b-1)*100:null;
 // Campos: los mismos ids que acepta el servidor (backend.js · SCREENER_FIELDS). Precios, medias y máximos se
 // comparan en la divisa de la cotización de origen (todos en la misma), así que no hay mezcla de divisas.
 const F={
  changePct:{l:'Hoy',u:'%',g:s=>N(s.changePct)},
  perfWeek:{l:'1S',u:'%',g:s=>N(s.perfWeek)},
  perfMonth:{l:'1M',u:'%',g:s=>N(s.perfMonth)},
  perf3M:{l:'3M',u:'%',g:s=>N(s.perf3M)},
  perf6M:{l:'6M',u:'%',g:s=>N(s.perf6M)},
  perfYtd:{l:'Año',u:'%',g:s=>N(s.perfYtd)},
  rsi:{l:'RSI',u:'',d:0,g:s=>N(s.rsi)},
  adx:{l:'ADX',u:'',d:0,g:s=>N(s.adx)},
  relVolume:{l:'Vol. rel.',u:'×',g:s=>N(s.relVolume)},
  liquidity:{l:'Negociado/día',u:' M',g:s=>N(s.avgVolume)!==null&&N(s.price)!==null?s.avgVolume*s.price/1e6:null},
  marketCap:{l:'Cap.',u:' M',d:0,g:s=>N(s.marketCap)!==null?s.marketCap/1e6:null},
  peRatio:{l:'PER',u:'',g:s=>N(s.peRatio)},
  priceBook:{l:'P/VC',u:'',g:s=>N(s.priceBook)},
  dividendYield:{l:'Dividendo',u:'%',g:s=>N(s.dividendYield)},
  netIncome:{l:'Beneficio',u:' M',d:0,g:s=>N(s.netIncomeTtm)!==null?s.netIncomeTtm/1e6:null},
  revenue:{l:'Ingresos',u:' M',d:0,g:s=>N(s.revenueTtm)!==null?s.revenueTtm/1e6:null},
  beta:{l:'Beta',u:'',g:s=>N(s.beta1Y)},
  vsEma50:{l:'vs EMA50',u:'%',g:s=>ratio(N(s.price),N(s.ema50))},
  vsEma20:{l:'vs EMA20',u:'%',g:s=>ratio(N(s.price),N(s.ema20))},
  fromHigh:{l:'Desde máx. 52s',u:'%',g:s=>ratio(N(s.price),N(s.high52w))},
  fromLow:{l:'Desde mín. 52s',u:'%',g:s=>ratio(N(s.price),N(s.low52w))},
  earningsDays:{l:'Resultados en',u:' d',d:0,g:s=>{const t=N(s.earningsDate);return t===null?null:(t*1000-Date.now())/864e5}},
  atrPct:{l:'Volatilidad',u:'%',g:s=>N(s.atr)!==null&&N(s.price)>0?s.atr/s.price*100:null},
  // Caída brusca: la misma regla que usaba su antiguo apartado (score-engine · crashEligible) con la variación
  // que se ve en pantalla para ese mercado (LSX en vivo o la sesión de EE. UU.). Solo en el cliente.
  crash:{l:'Hoy',u:'%',mode:true,g:(s,mode)=>liveChange(s,mode)}
 };
 function liveChange(s,mode){
  try{return N(mode==='tr'?trLiveChange(s):marketChange(s,currentMarketSession(),false))}catch(_){return N(s.changePct)}
 }
 function crashHit(s,mode){
  const E=window.ViewInvAIScore;
  return!!(E&&typeof E.crashEligible==='function'&&E.crashEligible(liveChange(s,mode),s.perfMonth,s.marketCap));
 }
 const LIQ={f:'liquidity',op:'>',v:1};
 const PROFILES=[
  {id:'momentum',icon:'🚀',name:'Momentum con volumen',desc:'Tendencia alcista de 3 meses, por encima de su media de 50 sesiones y con más volumen del habitual.',conds:[{f:'perf3M',op:'>',v:20},{f:'vsEma50',op:'>',v:0},{f:'relVolume',op:'>',v:1.2},LIQ]},
  {id:'value',icon:'💎',name:'Valor tipo Graham',desc:'Baratas por beneficios y por libros, con beneficios positivos.',conds:[{f:'peRatio',op:'between',v:0.1,v2:15},{f:'priceBook',op:'between',v:0.01,v2:1.5},{f:'netIncome',op:'>',v:0},LIQ]},
  {id:'dividend',icon:'💶',name:'Dividendo sólido',desc:'Rentabilidad por dividendo alta, con beneficios y sin estar en caída libre.',conds:[{f:'dividendYield',op:'>',v:4},{f:'perf6M',op:'>',v:-10},{f:'netIncome',op:'>',v:0},LIQ]},
  {id:'rebound',icon:'🔄',name:'Rebote o trampa',desc:'Muy castigadas (RSI bajo) que hoy reaccionan con volumen. Pide a la IA que separe rebotes de trampas.',conds:[{f:'rsi',op:'<',v:35},{f:'changePct',op:'>',v:1.5},{f:'relVolume',op:'>',v:1.3},LIQ]},
  // Mismo umbral que el antiguo apartado «Caídas bruscas» (score-engine: CRASH_MIN −25 % y fuera las de menos de 20 M).
  {id:'crash',icon:'⇣',name:'Caídas bruscas',desc:'Caen un 25 % o más hoy de golpe (no las que ya venían hundiéndose): ¿sobrerreacción con rebote o motivo de fondo? Ábrelas para ver la causa.',conds:[{f:'crash',op:'is'}]},
  {id:'catalyst',icon:'📅',name:'Catalizador cerca',desc:'Resultados en las próximas dos semanas, con tendencia a favor y volumen.',conds:[{f:'earningsDays',op:'between',v:0,v2:14},{f:'perfMonth',op:'>',v:3},{f:'relVolume',op:'>',v:1},LIQ]},
  {id:'smallhot',icon:'⚡',name:'Pequeñas en ebullición',desc:'Pequeña capitalización con volumen inusual: más recorrido y más riesgo.',conds:[{f:'marketCap',op:'<',v:2000},{f:'relVolume',op:'>',v:2},{f:'changePct',op:'>',v:3}]},
  {id:'highs',icon:'🏔️',name:'Cerca de máximos',desc:'A menos de un 5 % de su máximo anual con tendencia fuerte (ADX).',conds:[{f:'fromHigh',op:'>',v:-5},{f:'adx',op:'>',v:25},{f:'perf6M',op:'>',v:10},LIQ]},
  {id:'quality',icon:'🛡️',name:'Grandes y estables',desc:'Gran capitalización, beneficios y baja volatilidad (beta < 1).',conds:[{f:'marketCap',op:'>',v:20000},{f:'netIncome',op:'>',v:0},{f:'beta',op:'<',v:1},LIQ]}
 ];
 const SUGGESTIONS=['Tecnológicas medianas que suben con volumen y no están sobrecompradas','Biotecnológicas pequeñas con resultados en 30 días','Baratas con beneficios y dividendo','Rebotes técnicos con volumen hoy','Cerca de mínimos anuales pero con beneficios'];
 // Vistas de columnas: lo esencial a la vista y el resto por temas (antes, 25 columnas con scroll lateral).
 const VIEWS={
  tr:{basic:['fav','tickerTr','name','priceEur','change','week','month','relVolume','why'],tech:['fav','tickerTr','name','priceEur','change','rsi','adx','ema20','ema50','why'],volume:['fav','tickerTr','name','priceEur','change','bid','ask','volume','avgVolume','relVolume'],fund:['fav','tickerTr','name','priceEur','change','mcap','pe','pb','divy','earnings'],ids:['fav','tickerTr','tickerUs','name','exchange','isin','wkn','feed']},
  us:{basic:['fav','ticker','name','priceUsd','change','week','month','relVolume','why'],tech:['fav','ticker','name','priceUsd','change','rsi','adx','ema20','ema50','why'],volume:['fav','ticker','name','priceUsd','change','bid','ask','volume','avgVolume','relVolume'],sessions:['fav','ticker','name','priceUsd','change','premarketPrice','premarketChange','premarketVolume','regularPrice','regularChange','postmarketPrice','postmarketChange','postmarketVolume'],fund:['fav','ticker','name','priceUsd','change','mcap','pe','pb','divy','earnings'],ids:['fav','ticker','name','exchange','tr','isin','feed','updated']}
 };
 const VIEW_LABELS={basic:'Resumen',tech:'Técnico',volume:'Volumen',sessions:'Sesiones',fund:'Fundamental',ids:'Identificación',all:'Todas'};
 let store=(()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')||{}}catch(_){return{}}})();
 const st=mode=>{store[mode]=store[mode]||{conds:[],profile:'',label:'',view:'basic',layout:'table'};return store[mode]};
 const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(store))}catch(_){}};
 const aiState={tr:{busy:false,msg:''},us:{busy:false,msg:''}};

 function test(s,c,mode){
  if(c.f==='sector')return Array.isArray(c.v)&&c.v.includes(String(s.sector||''));
  if(c.f==='crash')return crashHit(s,mode);
  const def=F[c.f];if(!def)return true;
  const v=def.g(s,mode);if(v===null)return false;
  return c.op==='>'?v>c.v:c.op==='<'?v<c.v:c.op==='between'?v>=c.v&&v<=c.v2:true;
 }
 const matchAll=(s,conds,mode)=>conds.every(c=>test(s,c,mode));
 function condLabel(c){
  if(c.f==='crash')return 'Caída brusca hoy (−25 % o más)';
  if(c.f==='sector'){const es=typeof window.ViewInvAISectorEs==='function'?window.ViewInvAISectorEs:x=>x;return 'Sector: '+c.v.map(es).join(', ')}
  const d=F[c.f];if(!d)return c.f;const n=v=>fmt(v,Math.abs(v)>=100||d.d===0?0:1)+d.u;
  return d.l+(c.op==='>'?' > '+n(c.v):c.op==='<'?' < '+n(c.v):' '+n(c.v)+' – '+n(c.v2));
 }
 // «Por qué entra»: los datos del propio valor en cada filtro activo, con avisos de sobrecompra o sobreventa.
 function why(mode,s){
  const conds=st(mode).conds;if(!conds.length)return'';
  const parts=[];
  for(const c of conds){
   if(c.f==='sector'||c.f==='liquidity')continue;
   const d=F[c.f],v=d&&d.g(s,mode);if(v===null||v===undefined)continue;
   const val=(d.u==='%'&&v>0&&/^(changePct|perf|vsEma|fromLow)/.test(c.f)?'+':'')+fmt(v,Math.abs(v)>=100||d.d===0?0:1)+d.u;
   parts.push(d.l+' '+val);
  }
  const r=N(s.rsi);
  if(r!==null&&!conds.some(c=>c.f==='rsi'))parts.push('RSI '+fmt(r,0)+(r>70?' (sobrecomprada)':r<30?' (sobrevendida)':''));
  return parts.slice(0,4).join(' · ');
 }
 function universe(mode){
  return (typeof db!=='undefined'?db.stocks:[]).filter(s=>mode==='tr'?trTradable(s):market(s,'us'));
 }
 let countCache={stamp:'',map:{}};
 function profileCount(mode,p){
  const stamp=String((typeof db!=='undefined'&&db.meta&&db.meta.updatedAt)||'')+':'+(typeof db!=='undefined'?db.stocks.length:0);
  if(countCache.stamp!==stamp)countCache={stamp,map:{}};
  const k=mode+':'+p.id;
  if(countCache.map[k]===undefined)countCache.map[k]=universe(mode).filter(s=>matchAll(s,p.conds,mode)).length;
  return countCache.map[k];
 }
 function columns(mode,list){
  if(!isD())return list.filter(c=>c.id!=='why');
  const s=st(mode),ids=s.view==='all'?null:(VIEWS[mode][s.view]||VIEWS[mode].basic);
  let out=ids?ids.map(id=>list.find(c=>c.id===id)).filter(Boolean):list.slice();
  // La frase «por qué entra» solo tiene sentido con filtros activos.
  if(!s.conds.length)out=out.filter(c=>c.id!=='why');
  return out;
 }
 // Destacados (móvil): los que más volumen relativo traen sin estar sobrecompradas (RSI ≤ 70). Regla fija y visible.
 // Parte de las filas que de verdad muestra la lista (búsqueda, sector y filtros de columna incluidos).
 const lastRows={};
 function highlights(mode){
  const rows=lastRows[mode]||universe(mode).filter(x=>matchAll(x,st(mode).conds,mode));
  const pick=rows.filter(x=>N(x.rsi)===null||x.rsi<=70).sort((a,b)=>(N(b.relVolume)||0)-(N(a.relVolume)||0)).slice(0,3);
  return{count:rows.length,pick};
 }
 // El Screener IA es del diseño ViewInvAI; en el clásico los catálogos siguen como antes (sin panel ni selector).
 const isD=()=>document.documentElement.dataset.design!=='classic';
 // La app nativa usa siempre la interfaz móvil (también en tableta u horizontal: allí no hay menú lateral).
 const isMobile=()=>document.documentElement.dataset.nativeApp==='1'||!!(window.matchMedia&&window.matchMedia('(max-width:820px)').matches);
 // Selector de activo: en escritorio, desplegable a la derecha del título; en móvil, botón bajo el título que abre
 // una hoja desde abajo (más cómoda con el pulgar). Cada clase en su divisa; fondos y ETFs sin distinguir plataforma.
 const ASSETS=[['catalog','Acciones LSX','€','Trade Republic · LS Exchange'],['catalogUS','Acciones EE. UU.','$','Nasdaq, NYSE y AMEX'],['funds:fund','Fondos de inversión','','Registrados para la venta en España'],['funds:exchange','ETFs y ETPs','','Cotizados en bolsas europeas'],['crypto','Cripto','€','Precio de consenso']];
 function assetKey(){
  const v=typeof state!=='undefined'?state.currentView:'catalog';
  if(v==='heatmap')return'catalogUS';
  if(v==='funds'){const t=window.ViewInvAIFunds&&window.ViewInvAIFunds.getState&&window.ViewInvAIFunds.getState().type;return t==='fund'?'funds:fund':t==='exchange'||t==='etf'||t==='etp'?'funds:exchange':'funds:all'}
  return v;
 }
 const SHORT={catalog:'Acciones LSX',catalogUS:'Acciones EE. UU.','funds:fund':'Fondos','funds:exchange':'ETFs','funds:all':'Fondos y ETFs',crypto:'Cripto'};
 function assetPicker(){
  const k=assetKey(),cur=ASSETS.find(a=>a[0]===k),label=isMobile()?SHORT[k]||'Screener':cur?cur[1]+(cur[2]?' · '+cur[2]:''):'Fondos y ETFs';
  return '<div class="scr-asset"><button type="button" class="scr-asset-btn" data-scr-asset-toggle aria-haspopup="listbox" aria-expanded="false" aria-label="Qué buscar: '+esc(label)+'"><span>'+esc(label)+'</span><i aria-hidden="true">▾</i></button></div>';
 }
 // Un único menú en <body> (dentro de la cabecera, la hoja inferior del móvil quedaba recortada).
 function assetMenu(){
  let m=document.getElementById('scrAssetMenu');
  if(!m){
   m=document.createElement('div');m.id='scrAssetMenu';m.className='scr-asset-menu';m.setAttribute('role','listbox');m.setAttribute('aria-label','Qué buscar');m.hidden=true;
   const bd=document.createElement('div');bd.id='scrAssetBackdrop';bd.className='scr-asset-backdrop';bd.hidden=true;
   document.body.append(bd,m);
  }
  const k=assetKey();
  m.innerHTML='<div class="scr-asset-head">¿Qué quieres buscar?</div>'+ASSETS.map(a=>'<button type="button" role="option" class="'+(a[0]===k?'on':'')+'" aria-selected="'+(a[0]===k)+'" data-scr-asset="'+a[0]+'"><b>'+esc(a[1])+(a[2]?' <i>'+a[2]+'</i>':'')+'</b><small>'+esc(a[3])+'</small></button>').join('');
  return m;
 }
 function closeAssetMenu(){const m=document.getElementById('scrAssetMenu'),bd=document.getElementById('scrAssetBackdrop');if(m)m.hidden=true;if(bd)bd.hidden=true;document.body.classList.remove('scr-asset-open');document.querySelectorAll('[data-scr-asset-toggle]').forEach(x=>x.setAttribute('aria-expanded','false'))}
 const marketSeg=()=>assetPicker();
 const layoutSeg=(mode,cur)=>'<div class="scr-seg" role="group" aria-label="Vista"><button type="button" class="'+(cur==='table'?'on':'')+'" data-scr-layout="table" data-mode="'+mode+'">▤ Tabla</button><button type="button" class="'+(cur==='cards'?'on':'')+'" data-scr-layout="cards" data-mode="'+mode+'">▦ Tarjetas</button>'+(mode==='us'?'<button type="button" class="'+(cur==='map'?'on':'')+'" data-scr-market="heatmap">◫ Mapa</button>':'')+'</div>';
 function chipsHtml(mode){
  const s=st(mode);
  return s.conds.map((c,i)=>'<span class="scr-chip">'+esc(condLabel(c))+'<button type="button" data-scr-remove="'+i+'" data-mode="'+mode+'" aria-label="Quitar filtro">✕</button></span>').join('');
 }
 const aiForm=(mode,ph,refine)=>{const a=aiState[mode];return '<form class="scr-ai-form" data-scr-ai="'+mode+'"'+(refine?' data-scr-refine="1"':'')+'><input class="input" name="q" maxlength="300" autocomplete="off" placeholder="'+esc(ph)+'"'+(a.busy?' disabled':'')+'><button type="submit" class="btn"'+(a.busy?' disabled':'')+'>'+(a.busy?'Pensando…':'✦ Buscar')+'</button></form>'};
 const profileChips=mode=>'<div class="scr-pchips">'+PROFILES.map(p=>'<button type="button" class="'+(st(mode).profile===p.id?'on':'')+'" data-scr-profile="'+p.id+'" data-mode="'+mode+'">'+p.icon+' '+esc(p.name)+' <em>'+profileCount(mode,p).toLocaleString('es-ES')+'</em></button>').join('')+'</div>';
 // Escritorio (estilo «pro compacto»): una sola barra con mercado, perfil, pregunta a la IA y vista; debajo, los filtros.
 function desktopHtml(mode){
  const s=st(mode),a=aiState[mode],n=s.conds.length?universe(mode).filter(x=>matchAll(x,s.conds,mode)).length:null;
  const opts='<option value="">Perfiles…</option>'+PROFILES.map(p=>'<option value="'+p.id+'"'+(s.profile===p.id?' selected':'')+'>'+p.icon+' '+esc(p.name)+' · '+profileCount(mode,p).toLocaleString('es-ES')+'</option>').join('');
  const views=Object.keys(VIEWS[mode]).concat('all').map(v=>'<button type="button" class="'+(s.view===v?'on':'')+'" data-scr-view="'+v+'" data-mode="'+mode+'">'+VIEW_LABELS[v]+'</button>').join('');
  return '<div class="scr-bar"><select class="select scr-profile-select" data-scr-profile-select="'+mode+'" aria-label="Perfil">'+opts+'</select>'+aiForm(mode,'✦ Pregunta a la IA qué buscas: «tecnológicas medianas que suben con volumen»…')+layoutSeg(mode,s.layout||'table')+'</div>'+
   '<div class="scr-active">'+(s.conds.length?'<b>'+esc(s.label||'Filtros')+'</b>'+chipsHtml(mode)+'<span class="scr-count">'+n.toLocaleString('es-ES')+' valores</span><button type="button" class="scr-clear" data-scr-clear="'+mode+'">Limpiar</button>':'<span class="scr-hint">Elige un perfil o escribe lo que buscas: la IA lo convierte en filtros que puedes tocar.</span>')+'</div>'+
   (a.msg?'<p class="scr-ai-msg">✦ '+esc(a.msg)+'</p>':'')+
   ((s.layout||'table')==='table'?'<div class="scr-views" role="tablist" aria-label="Columnas">'+views+'</div>':'');
 }
 // Móvil (estilo conversación): preguntas o tocas un perfil y la IA te resume lo encontrado y te destaca tres.
 function mobileHtml(mode){
  const s=st(mode),a=aiState[mode];
  let html='';
  if(!s.conds.length){
   html+='<div class="scr-hero"><b>¿Qué acciones buscas?</b>'+aiForm(mode,'Escríbelo con tus palabras…')+
    '<div class="scr-sugg">'+SUGGESTIONS.map(t=>'<button type="button" data-scr-suggest="'+esc(t)+'" data-mode="'+mode+'">'+esc(t)+'</button>').join('')+'</div>'+
    (a.msg?'<p class="scr-ai-msg">'+esc(a.msg)+'</p>':'')+'</div>'+profileChips(mode);
   return html;
  }
  const h=highlights(mode),open=x=>typeof stockOpenAttrs==='function'?stockOpenAttrs(x,'',mode==='tr'):'';
  const price=x=>{const col=(CATALOG_COLUMNS[mode]||[]).find(c=>c.id===(mode==='tr'?'priceEur':'priceUsd'));return col?col.cell(x,'regular'):''};
  html+='<div class="scr-q">'+esc(s.label||'Tu búsqueda')+'</div>'+
   '<div class="scr-answer"><b>✦ '+h.count.toLocaleString('es-ES')+' valores cumplen estos filtros</b><div class="scr-active">'+chipsHtml(mode)+'<button type="button" class="scr-clear" data-scr-clear="'+mode+'">Empezar de nuevo</button></div>'+
   (a.msg?'<p class="scr-ai-msg">'+esc(a.msg)+'</p>':'')+
   (h.pick.length?'<small>Destacados: más volumen relativo sin estar sobrecompradas (RSI ≤ 70)</small><div class="scr-top">'+h.pick.map(x=>'<button type="button" class="scr-topc stock-open-row"'+open(x)+'><b>'+esc(mode==='tr'?(x.trTicker||x.ticker):x.ticker)+'</b><span>'+price(x)+'</span><small>'+esc(why(mode,x))+'</small></button>').join('')+'</div>':'')+
   '</div>'+aiForm(mode,'Afinar: «solo tecnológicas», «más baratas»…',true)+profileChips(mode);
  return html;
 }
 function panelHtml(mode){return isMobile()?mobileHtml(mode):desktopHtml(mode)}
 // Tarjetas: lo esencial de cada valor, su rango de 52 semanas y por qué entra.
 function cardsHtml(mode,rows,se){
  const cols=CATALOG_COLUMNS[mode]||[],cell=(id,x)=>{const c=cols.find(k=>k.id===id);return c?c.cell(x,se):''};
  const pct=v=>N(v)===null?'—':'<span class="'+(v>=0?'positive':'negative')+'">'+(v>=0?'+':'')+fmt(v,1)+' %</span>';
  const range=x=>{const lo=N(x.low52w),hi=N(x.high52w),p=N(x.price);if(lo===null||hi===null||p===null||hi<=lo)return'';const k=Math.max(0,Math.min(100,(p-lo)/(hi-lo)*100));return '<div class="scr-range" title="Rango de 52 semanas"><span style="left:'+k.toFixed(0)+'%"></span></div>'};
  return '<div class="scr-cards">'+rows.map(x=>'<article class="scr-card stock-open-row"'+(typeof stockOpenAttrs==='function'?stockOpenAttrs(x,'',mode==='tr'):'')+'>'+
   '<header><b>'+esc(mode==='tr'?(x.trTicker||x.ticker):x.ticker)+'</b><small>'+esc(String(x.name||'').slice(0,34))+'</small><span class="scr-card-px">'+cell(mode==='tr'?'priceEur':'priceUsd',x)+cell('change',x)+'</span></header>'+
   '<div class="scr-kpis"><span>1M<b>'+pct(x.perfMonth)+'</b></span><span>3M<b>'+pct(x.perf3M)+'</b></span><span>Vol. rel.<b>'+(N(x.relVolume)===null?'—':fmt(x.relVolume,1)+'×')+'</b></span><span>RSI<b>'+(N(x.rsi)===null?'—':fmt(x.rsi,0))+'</b></span></div>'+
   range(x)+(st(mode).conds.length?'<p class="scr-why">✦ '+esc(why(mode,x))+'</p>':'')+'</article>').join('')+'</div>';
 }
 const layout=mode=>!isD()||isMobile()?'list':(st(mode).layout||'table');
 function renderPanel(mode){
  const browse=document.querySelector(mode==='tr'?'#catalogBrowse':'#catalogUSBrowse');if(!browse)return;
  let host=browse.querySelector(':scope>.scr-panel');
  if(!isD()){if(host)host.remove();return}
  if(!host){host=document.createElement('div');host.className='scr-panel';browse.prepend(host)}
  const active=document.activeElement,typing=active&&host.contains(active)&&active.name==='q',val=typing?active.value:'';
  host.innerHTML=panelHtml(mode);
  if(typing){const i=host.querySelector('input[name="q"]');if(i){i.value=val;i.focus()}}
 }
 const rerender=mode=>{if(typeof catalogResetLimit==='function')catalogResetLimit(mode);if(typeof renderCatalogTable==='function')renderCatalogTable(mode)};
 async function askAi(mode,q,refine){
  const A=window.ViewInvAIAuth,a=aiState[mode];
  if(!A||typeof A.apiFetch!=='function'||!(A.getUser&&A.getUser())){a.msg='Inicia sesión para buscar con la IA. Mientras, puedes usar los perfiles.';rerender(mode);return}
  a.busy=true;a.msg='';rerender(mode);
  try{
   const sectors=[...new Set(universe(mode).map(s=>String(s.sector||'')).filter(Boolean))].sort();
   const r=await A.apiFetch('/api/ai/screener',{method:'POST',body:JSON.stringify({q,market:mode,sectors,current:refine?st(mode).conds:[]})});
   const d=await r.json().catch(()=>({}));
   if(r.ok&&d.ok&&Array.isArray(d.conds)&&d.conds.length){
    const s=st(mode);
    // Afinar: lo nuevo sustituye al filtro del mismo campo y el resto de la búsqueda se conserva.
    if(refine&&s.conds.length){const f=new Set(d.conds.map(c=>c.f));s.conds=s.conds.filter(c=>!f.has(c.f)).concat(d.conds).slice(0,10)}
    else s.conds=d.conds;
    s.profile='';s.label=refine&&s.label?String(s.label+' · '+q).slice(0,90):(d.label||q);save();
    const n=universe(mode).filter(x=>matchAll(x,s.conds,mode)).length;
    a.msg=(d.note?d.note+' ':'')+'→ '+n.toLocaleString('es-ES')+' valores. Puedes quitar o cambiar cualquier filtro.';
   }else a.msg=d.reason||d.error||'No se ha podido interpretar la búsqueda.';
  }catch(_){a.msg='No se ha podido conectar con la IA. Prueba en un momento.'}
  finally{a.busy=false;rerender(mode)}
 }
 document.addEventListener('change',e=>{
  const sel=e.target.closest&&e.target.closest('[data-scr-profile-select]');if(!sel)return;
  const mode=sel.dataset.scrProfileSelect,s=st(mode),p=PROFILES.find(x=>x.id===sel.value);
  if(p){s.conds=p.conds.map(c=>({...c}));s.profile=p.id;s.label=p.name}else{s.conds=[];s.profile='';s.label=''}
  aiState[mode].msg='';save();rerender(mode);
 });
 document.addEventListener('submit',e=>{
  const f=e.target.closest&&e.target.closest('[data-scr-ai]');if(!f)return;
  e.preventDefault();const q=String(new FormData(f).get('q')||'').trim();if(q)askAi(f.dataset.scrAi,q,f.dataset.scrRefine==='1');
 });
 document.addEventListener('click',e=>{
  const tg=e.target.closest&&e.target.closest('[data-scr-asset-toggle]');
  if(tg){e.preventDefault();
   if(document.body.classList.contains('scr-asset-open')){closeAssetMenu();return}
   const m=assetMenu();m.hidden=false;tg.setAttribute('aria-expanded','true');document.body.classList.add('scr-asset-open');
   if(isMobile()){document.getElementById('scrAssetBackdrop').hidden=false;m.style.top='';m.style.left=''}
   else{const r=tg.getBoundingClientRect();m.style.top=(r.bottom+6)+'px';m.style.left=Math.max(8,Math.min(window.innerWidth-296,r.right-288))+'px'}
   return}
  const as=e.target.closest&&e.target.closest('[data-scr-asset]');
  if(as){e.preventDefault();closeAssetMenu();
   const [view,type]=as.dataset.scrAsset.split(':');
   if(view==='funds'&&window.ViewInvAIFunds&&window.ViewInvAIFunds.getState){window.ViewInvAIFunds.getState().type=type;const sel=document.querySelector('#fundType');if(sel)sel.value=type}
   if(typeof show==='function')show(view);
   if(view==='funds'&&window.ViewInvAIFunds&&window.ViewInvAIFunds.render)window.ViewInvAIFunds.render();
   return}
  if(document.body.classList.contains('scr-asset-open')&&!(e.target.closest&&e.target.closest('#scrAssetMenu')))closeAssetMenu();
  const mk=e.target.closest&&e.target.closest('[data-scr-market]');
  if(mk){e.preventDefault();if(typeof show==='function')show(mk.dataset.scrMarket);return}
  const t=e.target.closest&&e.target.closest('[data-scr-profile],[data-scr-remove],[data-scr-clear],[data-scr-view],[data-scr-suggest],[data-scr-layout]');if(!t)return;
  const mode=t.dataset.mode||t.dataset.scrClear,s=st(mode);
  if(t.dataset.scrProfile){
   const p=PROFILES.find(x=>x.id===t.dataset.scrProfile);if(!p)return;
   if(s.profile===p.id){s.conds=[];s.profile='';s.label=''}else{s.conds=p.conds.map(c=>({...c}));s.profile=p.id;s.label=p.name}
   aiState[mode].msg='';
  }else if(t.dataset.scrRemove!==undefined){s.conds.splice(Number(t.dataset.scrRemove),1);s.profile='';if(!s.conds.length)s.label=''}
  else if(t.dataset.scrClear){s.conds=[];s.profile='';s.label='';aiState[mode].msg=''}
  else if(t.dataset.scrView){s.view=t.dataset.scrView}
  else if(t.dataset.scrLayout){s.layout=t.dataset.scrLayout;if(typeof state!=='undefined'&&state.currentView==='heatmap'){save();show('catalogUS');return}}
  else if(t.dataset.scrSuggest){askAi(mode,t.dataset.scrSuggest);return}
  save();rerender(mode);
 });
 // Dónde va el selector, sin gastar una fila: en escritorio, a la derecha del título (el menú lateral ya lleva las
 // secciones); en móvil, el propio título de la barra superior se convierte en el selector.
 function placePicker(){
  if(typeof state==='undefined')return;
  document.querySelectorAll('.scr-asset').forEach(x=>x.remove());
  document.querySelectorAll('.page-heading.has-scr-picker').forEach(x=>x.classList.remove('has-scr-picker'));
  const v=state.currentView;
  if(!isD()){document.querySelectorAll('.scr-map-back').forEach(x=>x.remove());closeAssetMenu();return}
  if(!['catalog','catalogUS','heatmap','funds','crypto'].includes(v))return;
  const view=document.querySelector('#view-'+v);if(!view)return;
  const tmp=document.createElement('div');tmp.innerHTML=assetPicker();const picker=tmp.firstChild;
  if(isMobile()){
   const head=view.querySelector(':scope>.page-heading');if(!head)return;
   const h1=head.querySelector('h1');head.classList.add('has-scr-picker');
   if(h1)h1.after(picker);else head.prepend(picker);
  }else{
   // Escritorio: a la derecha del título (no hay fila de pestañas; el menú lateral ya lleva las secciones).
   const head=view.querySelector(':scope>.page-heading');
   if(head){picker.classList.add('scr-asset-inline');head.appendChild(picker)}
  }
  // Mapa de calor: volver a la tabla, en la misma fila que el selector (escritorio) o arriba (móvil).
  let back=view.querySelector(':scope>.scr-map-back');
  if(v==='heatmap'){if(!back){back=document.createElement('div');back.className='scr-map-back';(view.querySelector(':scope>.section-switcher')||view.querySelector(':scope>.page-heading'))?.after(back)}back.innerHTML=layoutSeg('us','map')}
  else if(back)back.remove();
 }
 window.addEventListener('viewinvai:view-changed',()=>{closeAssetMenu();setTimeout(placePicker,0)});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closeAssetMenu()});
 window.addEventListener('resize',()=>{clearTimeout(placePicker.t);placePicker.t=setTimeout(placePicker,200)});
 document.addEventListener('change',e=>{if(e.target&&e.target.id==='fundType')setTimeout(placePicker,0)});
 window.ViewInvAIScreener={placePicker,match:(mode,s)=>!isD()||matchAll(s,st(mode).conds,mode),setRows:(mode,rows)=>{lastRows[mode]=rows},columns,renderPanel,why,layout,cardsHtml,active:mode=>st(mode).conds.length>0,profiles:PROFILES,fields:F};
})();
