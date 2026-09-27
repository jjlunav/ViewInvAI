/*
 * ViewInvAI events
 * ----------------
 * Shared event/news normalization plus Future Potential and Calendar views.
 */

function ET(t){return({news:'Noticia relevante',medical:'Clínico / FDA',earnings:'Resultados',contract:'Contrato / acuerdo',corporate:'Operación corporativa',financing:'Financiación / dilución',analyst:'Analistas / rating',event:'Evento / conferencia',regulatory:'Regulatorio / legal',other:'Otro catalizador'})[t]||'Catalizador'}
function EL(e){let t=String(e.title||e.fact||'').toLowerCase();if(e.type==='earnings')return 'Resultados trimestrales';if(e.type==='medical'){let m=t.match(/phase\s*([123])/i);if(m)return 'Estudio clínico Fase '+m[1];if(/pdufa/.test(t))return 'PDUFA / FDA';if(/fda|approval|approved/.test(t))return 'Decisión FDA';if(/trial|clinical|study|endpoint|topline/.test(t))return 'Resultados clínicos';return 'Clínico / sanitario'}if(e.type==='financing'){if(/offering|registered direct|private placement/.test(t))return 'Oferta / ampliación';if(/warrant/.test(t))return 'Warrants';if(/convertible/.test(t))return 'Convertibles';return 'Financiación / dilución'}if(e.type==='contract')return /award|order|contract/.test(t)?'Contrato / adjudicación':'Acuerdo / alianza';if(e.type==='corporate'){if(/merger|acquisition|acquire|takeover|buyout/.test(t))return 'Fusión / adquisición';if(/reverse split/.test(t))return 'Reverse split';if(/stock split/.test(t))return 'Split';return 'Operación corporativa'}if(e.type==='analyst')return /upgrade/.test(t)?'Upgrade analista':/downgrade/.test(t)?'Downgrade analista':'Rating / precio objetivo';if(e.type==='regulatory')return 'Regulatorio / legal';if(e.type==='event')return 'Evento / conferencia';return ET(e.type)}
function safeExternalUrl(value){
 try{
  let u=new URL(String(value||''));
  return u.protocol==='https:'?u.href:'';
 }catch(_){return''}
}
function EU(e){let u=safeExternalUrl(e.url);return u?'<a class="event-link" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="'+E(u)+'">Abrir noticia / fuente ↗</a>':''}
function eventTime(e){
 let d=e&&e.date?new Date(e.date):null;
 if(d&&!isNaN(d)){
  let parts=new Intl.DateTimeFormat('es-ES',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(d);
  let p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  let utcH=d.getUTCHours(),utcM=d.getUTCMinutes(),utcS=d.getUTCSeconds();
  if(e.eventKind==='news'||utcH||utcM||utcS)return p.hour+':'+p.minute+' NY';
 }
 let code=N(e&&e.timeCode);
 if(code!==null&&code>60&&code<86400){
  let h=Math.floor(code/3600),m=Math.floor((code%3600)/60);
  if(h>=0&&h<24)return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+' NY';
 }
 return '';
}
function eventWhen(e){let t=eventTime(e);return DF(e.date)+(t?' · '+t:'')}
function eventSources(e){
 let src=Array.isArray(e.sources)&&e.sources.length?e.sources:(e.source?[{name:e.source,url:e.url}]:[]);
 if(!src.length)return '';
 let linksHtml=src.map(s=>{let name=E(s.name||'Fuente'),u=safeExternalUrl(s.url),kind=E(s.kind||'');return u?'<a target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"'+(kind?' title="'+kind+'"':'')+' href="'+E(u)+'">'+name+' ↗</a>':'<span'+(kind?' title="'+kind+'"':'')+'>'+name+'</span>'}).join('');
 return '<div class="event-sources"><span class="verification">'+E(e.verification||'Fuente validada')+'</span>'+linksHtml+'</div>';
}
function eventItem(e){
 let kind=e.eventKind==='news'?'Noticia':'Evento previsto',label=EL(e);
 return '<div class="event-item"><div class="event-item-head"><div><strong>'+E(label)+'</strong><span>'+E(kind)+'</span></div><time>'+E(eventWhen(e))+'</time></div><div class="event-title">'+E(e.title||e.fact||'Catalizador detectado')+'</div>'+(e.fact&&e.fact!==e.title?'<div class="event-context">'+E(e.fact)+'</div>':'')+'<div class="event-impact"><strong>Por qué importa:</strong> '+E(e.hypothesis||'Puede aumentar la volatilidad; no implica una dirección concreta.')+'</div>'+eventSources(e)+'</div>';
}
function futureWindowEvent(e,h,now){
 let d=new Date(e.date).getTime();
 if(!Number.isFinite(d))return false;
 let end=now+h*864e5;
 if(e.eventKind==='news'){
  let today=new Date();today.setHours(0,0,0,0);
  return d>=today.getTime()&&d<=now+3600e3;
 }
 return d>=now-3600e3&&d<=end;
}
function groupFutureEvents(events){
 let map=new Map();
 for(let e of events){
  let key=(e.exchange||'')+':'+(e.ticker||'');
  if(!map.has(key))map.set(key,[]);
  map.get(key).push(e);
 }
 return [...map.entries()].map(([key,items])=>{
  items.sort((a,b)=>new Date(a.date)-new Date(b.date)||((b.impactScore||0)-(a.impactScore||0)));
  return {key,items,first:items[0],maxImpact:Math.max(...items.map(x=>N(x.impactScore)||0))};
 }).sort((a,b)=>new Date(a.first.date)-new Date(b.first.date)||b.maxImpact-a.maxImpact);
}


function stockEvents(s){
 if(!s)return[];
 let refs=new Set();
 for(let value of [s.isin,s.usIsin,s.trIsin]){let ref=isinRef(value);if(ref)refs.add(ref)}
 let exact=tickerRef(s.ticker,s.exchange),any=tickerRef(s.ticker,'*');if(exact)refs.add(exact);if(any)refs.add(any);
 let out=[],seen=new Set();
 for(let ref of refs)for(let event of (eventIndexByRef.get(ref)||[])){
  if(seen.has(event))continue;seen.add(event);out.push(event);
 }
 return out;
}
const EVENT_MOBILE_GROUPS=[
 {key:'event',label:'Evento'},
 {key:'market',label:'Mercado'},
 {key:'technical',label:'Técnico'}
];
const eventMobileUi={future:'event',calendar:'event'};
function eventCompactListView(){return document.documentElement.dataset.nativeApp==='1'||!!(window.matchMedia&&window.matchMedia('(max-width:760px)').matches)}
function eventMobileTabs(scope){
 let active=eventMobileUi[scope]||'event';
 return '<nav class="event-mobile-groups" aria-label="Datos del evento">'+EVENT_MOBILE_GROUPS.map(g=>
  '<button type="button" class="'+(g.key===active?'active':'')+'" data-event-mobile-scope="'+E(scope)+'" data-event-mobile-group="'+E(g.key)+'">'+E(g.label)+'</button>'
 ).join('')+'</nav>';
}
function eventMobileRow(scope,s,event,index,label,when,count=1){
 let preferTr=trTradable(s),group=eventMobileUi[scope]||'event',isin=s.trIsin||s.usIsin||s.isin||'—',ticker=preferTr?(s.trTicker||s.ticker):(s.ticker||s.trTicker);
 let cols=[];
 if(group==='event'){
  cols=[label,when];
 }else if(group==='market'){
  let q=canonicalQuote(s,preferTr),sym=q.nativeCurrency==='EUR'?'€':'\u0024';
  cols=[quoteMoney(q.price,sym,quotePrecision(s,preferTr,SP(s,SES()))),PC(marketChange(s,SES(),preferTr))];
 }else{
  cols=[N(s.rsi)===null?'—':'RSI '+F(s.rsi,1),N(s.adx)===null?'—':'ADX '+F(s.adx,1)];
 }
 return '<article class="event-mobile-line stock-open-row"'+stockOpenAttrs(s,label+' · '+when,preferTr)+'>'+
  '<span class="event-mobile-copy"><strong><em>#'+(index+1)+'</em>'+E(s.name||ticker||'—')+'</strong><small>'+E(isin)+'</small><i>'+E(ticker||'—')+(count>1?' · '+count+' eventos':'')+'</i></span>'+
  '<span class="event-mobile-cell">'+E(cols[0])+'</span><span class="event-mobile-cell">'+E(cols[1])+'</span><span class="event-mobile-open">›</span>'+
 '</article>';
}
function eventMobileList(scope,rows){
 let group=eventMobileUi[scope]||'event';
 let heads=group==='event'?['Catalizador','Fecha']:group==='market'?['Precio','Variación']:['RSI','ADX'];
 return eventMobileTabs(scope)+'<div class="event-mobile-compare"><div class="event-mobile-head"><span>Valor / ISIN</span><span>'+heads[0]+'</span><span>'+heads[1]+'</span><span></span></div><div class="event-mobile-rows">'+rows.join('')+'</div></div>';
}

function renderFuture(){
 let h=+$('#futureHorizon').value,t=$('#futureType').value,tr=$('#futureTrOnly').checked,now=Date.now();
 let filtered=(db.events||[]).filter(e=>{
  if(!futureWindowEvent(e,h,now)||(t!=='all'&&e.type!==t))return false;
  if(!tr)return true;
  let s=stockForEvent(e);
  return trTradable(s);
 });
 let groups=groupFutureEvents(filtered);
 if(groups.length){
  let shown=groups.slice(0,180);
  $('#futureResults').innerHTML=eventCompactListView()
   ?eventMobileList('future',shown.map((g,i)=>{let e=g.first,s=stockForEvent(e)||e,count=g.items.length,label=count===1?EL(e):(count+' catalizadores'),when=eventWhen(e);return eventMobileRow('future',s,e,i,label,when,count)}))
   :shown.map((g,i)=>{let e=g.first,s=stockForEvent(e)||e;let count=g.items.length,label=count===1?EL(e):(count+' catalizadores'),when=eventWhen(e),preferTr=trTradable(s);let context='<strong>'+E(when)+'</strong><span>'+E(label)+'</span>'+(count>1?'<span>'+count+' eventos agrupados</span>':'');return standardStockCard(s,i,{se:SES(),preferTr,hint:label+' · '+when,insight:'IA · '+label,contextHtml:context,className:'future-stock-card'})}).join('');
 }else $('#futureResults').innerHTML='<div class="empty-state">No hay catalizadores desde ahora hasta '+h+' día'+(h===1?'':'s')+' vista con estos filtros.</div>';
}

function renderCalendar(){
 let rows=[...(db.events||[])].sort((x,y)=>new Date(y.date)-new Date(x.date));
 if(rows.length){
  let shown=rows.slice(0,400);
  $('#calendarResults').innerHTML=eventCompactListView()
   ?eventMobileList('calendar',shown.map((e,i)=>{let s=stockForEvent(e)||e,label=EL(e),when=DF(e.date);return eventMobileRow('calendar',s,e,i,label,when,1)}))
   :shown.map((e,i)=>{let s=stockForEvent(e)||e;let label=EL(e),when=DF(e.date),preferTr=trTradable(s);return standardStockCard(s,i,{se:SES(),preferTr,hint:label+' · '+when,insight:'IA · '+label,contextHtml:'<strong>'+E(when)+'</strong><span>'+E(label)+'</span>',className:'calendar-stock-card'})}).join('');
 }else $('#calendarResults').innerHTML='<div class="empty-state">Sin eventos o noticias disponibles.</div>';
}

function initEventViewInteractions(){
 document.addEventListener('click',e=>{
  let tab=e.target.closest&&e.target.closest('[data-event-mobile-group]');
  if(!tab)return;
  let scope=tab.dataset.eventMobileScope||'future';
  eventMobileUi[scope]=tab.dataset.eventMobileGroup||'event';
  if(scope==='future')renderFuture();else renderCalendar();
 });
 ['futureHorizon','futureType','futureTrOnly'].forEach(id=>{
  $('#'+id)?.addEventListener('change',renderFuture);
 });
}
