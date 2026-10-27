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
  atrPct:{l:'Volatilidad',u:'%',g:s=>N(s.atr)!==null&&N(s.price)>0?s.atr/s.price*100:null}
 };
 const LIQ={f:'liquidity',op:'>',v:1};
 const PROFILES=[
  {id:'momentum',icon:'🚀',name:'Momentum con volumen',desc:'Tendencia alcista de 3 meses, por encima de su media de 50 sesiones y con más volumen del habitual.',conds:[{f:'perf3M',op:'>',v:20},{f:'vsEma50',op:'>',v:0},{f:'relVolume',op:'>',v:1.2},LIQ]},
  {id:'value',icon:'💎',name:'Valor tipo Graham',desc:'Baratas por beneficios y por libros, con beneficios positivos.',conds:[{f:'peRatio',op:'between',v:0.1,v2:15},{f:'priceBook',op:'between',v:0.01,v2:1.5},{f:'netIncome',op:'>',v:0},LIQ]},
  {id:'dividend',icon:'💶',name:'Dividendo sólido',desc:'Rentabilidad por dividendo alta, con beneficios y sin estar en caída libre.',conds:[{f:'dividendYield',op:'>',v:4},{f:'perf6M',op:'>',v:-10},{f:'netIncome',op:'>',v:0},LIQ]},
  {id:'rebound',icon:'🔄',name:'Rebote o trampa',desc:'Muy castigadas (RSI bajo) que hoy reaccionan con volumen. Pide a la IA que separe rebotes de trampas.',conds:[{f:'rsi',op:'<',v:35},{f:'changePct',op:'>',v:1.5},{f:'relVolume',op:'>',v:1.3},LIQ]},
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
 const st=mode=>{store[mode]=store[mode]||{conds:[],profile:'',label:'',view:'basic'};return store[mode]};
 const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(store))}catch(_){}};
 const aiState={tr:{busy:false,msg:''},us:{busy:false,msg:''}};

 function test(s,c){
  if(c.f==='sector')return Array.isArray(c.v)&&c.v.includes(String(s.sector||''));
  const def=F[c.f];if(!def)return true;
  const v=def.g(s);if(v===null)return false;
  return c.op==='>'?v>c.v:c.op==='<'?v<c.v:c.op==='between'?v>=c.v&&v<=c.v2:true;
 }
 const matchAll=(s,conds)=>conds.every(c=>test(s,c));
 function condLabel(c){
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
   const d=F[c.f],v=d&&d.g(s);if(v===null||v===undefined)continue;
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
  if(countCache.map[k]===undefined)countCache.map[k]=universe(mode).filter(s=>matchAll(s,p.conds)).length;
  return countCache.map[k];
 }
 function columns(mode,list){
  const s=st(mode),ids=s.view==='all'?null:(VIEWS[mode][s.view]||VIEWS[mode].basic);
  let out=ids?ids.map(id=>list.find(c=>c.id===id)).filter(Boolean):list.slice();
  // La frase «por qué entra» solo tiene sentido con filtros activos.
  if(!s.conds.length)out=out.filter(c=>c.id!=='why');
  return out;
 }
 function panelHtml(mode){
  const s=st(mode),a=aiState[mode];
  const cards=PROFILES.map(p=>{const n=profileCount(mode,p);return '<button type="button" class="scr-profile'+(s.profile===p.id?' on':'')+'" data-scr-profile="'+p.id+'" data-mode="'+mode+'"><span class="scr-ph"><i aria-hidden="true">'+p.icon+'</i><b>'+esc(p.name)+'</b><em>'+n.toLocaleString('es-ES')+'</em></span><small>'+esc(p.desc)+'</small></button>'}).join('');
  const chips=s.conds.map((c,i)=>'<span class="scr-chip">'+esc(condLabel(c))+'<button type="button" data-scr-remove="'+i+'" data-mode="'+mode+'" aria-label="Quitar filtro">✕</button></span>').join('');
  const views=Object.keys(VIEWS[mode]).concat('all').map(v=>'<button type="button" class="'+(s.view===v?'on':'')+'" data-scr-view="'+v+'" data-mode="'+mode+'">'+VIEW_LABELS[v]+'</button>').join('');
  return '<div class="scr-ai"><small>✦ DESCRIBE QUÉ BUSCAS</small>'+
   '<form class="scr-ai-form" data-scr-ai="'+mode+'"><input class="input" name="q" maxlength="300" autocomplete="off" placeholder="Ej.: tecnológicas medianas que suben con volumen y no están sobrecompradas"'+(a.busy?' disabled':'')+'><button type="submit" class="btn"'+(a.busy?' disabled':'')+'>'+(a.busy?'Pensando…':'Buscar')+'</button></form>'+
   '<div class="scr-sugg">'+SUGGESTIONS.map(t=>'<button type="button" data-scr-suggest="'+esc(t)+'" data-mode="'+mode+'">'+esc(t)+'</button>').join('')+'</div>'+
   (a.msg?'<p class="scr-ai-msg">'+esc(a.msg)+'</p>':'')+'</div>'+
   '<div class="scr-profiles" role="list">'+cards+'</div>'+
   (s.conds.length?'<div class="scr-active"><b>'+esc(s.label||'Filtros')+'</b>'+chips+'<button type="button" class="scr-clear" data-scr-clear="'+mode+'">Limpiar</button></div>':'')+
   '<div class="scr-views" role="tablist" aria-label="Columnas">'+views+'</div>';
 }
 function renderPanel(mode){
  const browse=document.querySelector(mode==='tr'?'#catalogBrowse':'#catalogUSBrowse');if(!browse)return;
  let host=browse.querySelector(':scope>.scr-panel');
  if(!host){host=document.createElement('div');host.className='scr-panel';browse.prepend(host)}
  const active=document.activeElement,typing=active&&host.contains(active)&&active.name==='q',val=typing?active.value:'';
  host.innerHTML=panelHtml(mode);
  if(typing){const i=host.querySelector('input[name="q"]');if(i){i.value=val;i.focus()}}
 }
 const rerender=mode=>{if(typeof catalogResetLimit==='function')catalogResetLimit(mode);if(typeof renderCatalogTable==='function')renderCatalogTable(mode)};
 async function askAi(mode,q){
  const A=window.ViewInvAIAuth,a=aiState[mode];
  if(!A||typeof A.apiFetch!=='function'||!(A.getUser&&A.getUser())){a.msg='Inicia sesión para buscar con la IA. Mientras, puedes usar los perfiles.';rerender(mode);return}
  a.busy=true;a.msg='';rerender(mode);
  try{
   const sectors=[...new Set(universe(mode).map(s=>String(s.sector||'')).filter(Boolean))].sort();
   const r=await A.apiFetch('/api/ai/screener',{method:'POST',body:JSON.stringify({q,market:mode,sectors})});
   const d=await r.json().catch(()=>({}));
   if(r.ok&&d.ok&&Array.isArray(d.conds)&&d.conds.length){
    const s=st(mode);s.conds=d.conds;s.profile='';s.label=d.label||q;save();
    const n=universe(mode).filter(x=>matchAll(x,d.conds)).length;
    a.msg=(d.note?d.note+' ':'')+'→ '+n.toLocaleString('es-ES')+' valores. Puedes quitar o cambiar cualquier filtro.';
   }else a.msg=d.reason||d.error||'No se ha podido interpretar la búsqueda.';
  }catch(_){a.msg='No se ha podido conectar con la IA. Prueba en un momento.'}
  finally{a.busy=false;rerender(mode)}
 }
 document.addEventListener('submit',e=>{
  const f=e.target.closest&&e.target.closest('[data-scr-ai]');if(!f)return;
  e.preventDefault();const q=String(new FormData(f).get('q')||'').trim();if(q)askAi(f.dataset.scrAi,q);
 });
 document.addEventListener('click',e=>{
  const t=e.target.closest&&e.target.closest('[data-scr-profile],[data-scr-remove],[data-scr-clear],[data-scr-view],[data-scr-suggest]');if(!t)return;
  const mode=t.dataset.mode||t.dataset.scrClear,s=st(mode);
  if(t.dataset.scrProfile){
   const p=PROFILES.find(x=>x.id===t.dataset.scrProfile);if(!p)return;
   if(s.profile===p.id){s.conds=[];s.profile='';s.label=''}else{s.conds=p.conds.map(c=>({...c}));s.profile=p.id;s.label=p.name}
   aiState[mode].msg='';
  }else if(t.dataset.scrRemove!==undefined){s.conds.splice(Number(t.dataset.scrRemove),1);s.profile='';if(!s.conds.length)s.label=''}
  else if(t.dataset.scrClear){s.conds=[];s.profile='';s.label='';aiState[mode].msg=''}
  else if(t.dataset.scrView){s.view=t.dataset.scrView}
  else if(t.dataset.scrSuggest){askAi(mode,t.dataset.scrSuggest);return}
  save();rerender(mode);
 });
 window.ViewInvAIScreener={match:(mode,s)=>matchAll(s,st(mode).conds),columns,renderPanel,why,active:mode=>st(mode).conds.length>0,profiles:PROFILES,fields:F};
})();
