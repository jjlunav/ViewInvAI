/*
 * ViewInvAI events
 * ----------------
 * Shared event/news normalization plus one fused Future Potential view.
 */
function ET(t){return({news:'Noticia relevante',medical:'Clínico / FDA',earnings:'Resultados',contract:'Contrato / acuerdo',corporate:'Operación corporativa',financing:'Financiación / dilución',analyst:'Analistas / rating',event:'Evento / conferencia',regulatory:'Regulatorio / legal',other:'Otro catalizador'})[t]||'Catalizador'}
function EL(e){let t=String(e.title||e.fact||'').toLowerCase();if(e.type==='earnings')return 'Resultados trimestrales';if(e.type==='medical'){let m=t.match(/phase\s*([123])/i);if(m)return 'Estudio clínico Fase '+m[1];if(/pdufa/.test(t))return 'PDUFA / FDA';if(/fda|approval|approved/.test(t))return 'Decisión FDA';if(/trial|clinical|study|endpoint|topline/.test(t))return 'Resultados clínicos';return 'Clínico / sanitario'}if(e.type==='financing'){if(/offering|registered direct|private placement/.test(t))return 'Oferta / ampliación';if(/warrant/.test(t))return 'Warrants';if(/convertible/.test(t))return 'Convertibles';return 'Financiación / dilución'}if(e.type==='contract')return /award|order|contract/.test(t)?'Contrato / adjudicación':'Acuerdo / alianza';if(e.type==='corporate'){if(/merger|acquisition|acquire|takeover|buyout/.test(t))return 'Fusión / adquisición';if(/reverse split/.test(t))return 'Reverse split';if(/stock split/.test(t))return 'Split';return 'Operación corporativa'}if(e.type==='analyst')return /upgrade/.test(t)?'Upgrade analista':/downgrade/.test(t)?'Downgrade analista':'Rating / precio objetivo';if(e.type==='regulatory')return 'Regulatorio / legal';if(e.type==='event')return 'Evento / conferencia';return ET(e.type)}
function safeExternalUrl(value){try{let u=new URL(String(value||''));return u.protocol==='https:'?u.href:''}catch(_){return''}}
// Horas en hora de España (el usuario es de aquí); los datos llegan en hora de Nueva York.
const ES_CLOCK=new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit',hour12:false});
function eventTime(e){
 let d=e&&e.date?new Date(e.date):null;
 if(d&&!isNaN(d)){
  let utcH=d.getUTCHours(),utcM=d.getUTCMinutes(),utcS=d.getUTCSeconds();
  if(e.eventKind==='news'||utcH||utcM||utcS)return ES_CLOCK.format(d)+' h';
 }
 let code=N(e&&e.timeCode);
 if(code!==null&&code>60&&code<86400){
  let h=Math.floor(code/3600),m=Math.floor((code%3600)/60);
  if(h>=0&&h<24){
   try{
    if(d&&!isNaN(d)&&typeof zonedWallTimeToEpoch==='function'){
     let at=zonedWallTimeToEpoch(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate(),h,m,0,'America/New_York');
     if(Number.isFinite(at))return ES_CLOCK.format(new Date(at))+' h';
    }
   }catch(_){}
   return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+' h NY';
  }
 }
 return '';
}
function eventWhen(e){
 if(e&&e.datePrecision==='month'){let d=new Date(e.date);if(!isNaN(d))return '≈ '+d.toLocaleDateString('es-ES',{month:'short',year:'numeric',timeZone:'UTC'})+' (estimada)'}
 let t=eventTime(e);return DF(e.date)+(t?' · '+t:'');
}
function eventSources(e){
 let src=Array.isArray(e.sources)&&e.sources.length?e.sources:(e.source?[{name:e.source,url:e.url}]:[]);
 if(!src.length)return '';
 return '<div class="event-sources">'+src.map(s=>{let name=E(s.name||'Fuente'),u=safeExternalUrl(s.url);return u?'<a target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="'+E(u)+'">'+name+' ↗</a>':'<span>'+name+'</span>'}).join('')+'</div>';
}
function eventItem(e){
 let kind=e.eventKind==='news'?'Noticia':'Evento previsto',label=EL(e),official=e.official===true||['sec','fda','clinicaltrials'].includes(String(e.sourceFamily||'').toLowerCase())||/oficial|official|sec \/ edgar|clinicaltrials|fda/i.test(String(e.verification||''));
 let verification=e.verification?'<div class="event-verification '+(official?'official':'')+'"><strong>'+(official?'Fuente oficial verificada':'Verificación')+':</strong> <span data-i18n-content>'+E(e.verification)+'</span></div>':'';
 return '<div class="event-item'+(official?' official-source':'')+'"><div class="event-item-head"><div><strong>'+E(label)+'</strong><span>'+E(kind)+(official?' · OFICIAL':'')+'</span></div><time>'+E(eventWhen(e))+'</time></div><div class="event-title" data-i18n-content>'+E(e.title||e.fact||'Catalizador detectado')+'</div>'+(e.fact&&e.fact!==e.title?'<div class="event-context" data-i18n-content>'+E(e.fact)+'</div>':'')+'<div class="event-impact"><strong>Por qué importa:</strong> <span data-i18n-content>'+E(e.hypothesis||e.impact||(e.type==='earnings'?'Resultados y guidance pueden cambiar rápidamente las expectativas de valoración y volatilidad.':'Puede aumentar la volatilidad; no implica una dirección concreta.'))+'</span></div>'+verification+eventSources(e)+'</div>';
}
function stockEvents(s){
 if(!s)return[];
 let refs=new Set();
 for(let value of [s.isin,s.usIsin,s.trIsin]){let ref=isinRef(value);if(ref)refs.add(ref)}
 let exact=tickerRef(s.ticker,s.exchange),any=tickerRef(s.ticker,'*');if(exact)refs.add(exact);if(any)refs.add(any);
 let out=[],seen=new Set();
 for(let ref of refs)for(let event of (eventIndexByRef.get(ref)||[])){if(seen.has(event))continue;seen.add(event);out.push(event)}
 return out;
}
function futureSectorForEvent(e){let s=stockForEvent(e);return String((s&&s.sector)||(s&&s.industry)||'Sin sector').trim()||'Sin sector'}
function syncFutureSectorOptions(){
 let select=document.querySelector('#futureSector');if(!select)return;
 let current=select.value||'all';
 let values=[...new Set((db.events||[]).map(futureSectorForEvent).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
 select.innerHTML='<option value="all">Todos los sectores</option>'+values.map(v=>'<option value="'+E(v)+'">'+E(v)+'</option>').join('');
 if(values.includes(current))select.value=current;else select.value='all';
}
function futureWindowEvent(e,h,now,from,to){
 let time=new Date(e.date||0).getTime();if(!Number.isFinite(time))return false;
 if(from!==null&&time<from)return false;if(to!==null&&time>to)return false;
 if(from!==null||to!==null)return true;
 if(e.eventKind==='news')return time>=now-24*3600e3&&time<=now+3600e3;
 return time>=now-3600e3&&time<=now+h*864e5;
}
function groupFutureEvents(events){
 let map=new Map();
 for(let e of events){let key=(e.exchange||'')+':'+(e.ticker||'');if(!map.has(key))map.set(key,[]);map.get(key).push(e)}
 return [...map.entries()].map(([key,items])=>{
  items.sort((a,b)=>new Date(a.date)-new Date(b.date)||((b.impactScore||0)-(a.impactScore||0)));
  const future=items.filter(e=>new Date(e.date).getTime()>=Date.now()-3600e3);
  const first=future[0]||items.slice().sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
  return{key,items,first,maxImpact:Math.max(...items.map(x=>N(x.impactScore)||0))};
 }).sort((a,b)=>{
  const af=new Date(a.first.date).getTime(),bf=new Date(b.first.date).getTime();
  const an=af>=Date.now()-3600e3,bn=bf>=Date.now()-3600e3;
  if(an!==bn)return an?-1:1;
  return an?af-bf:bf-af||b.maxImpact-a.maxImpact;
 });
}
function futureRow(group,index,trOnly){
 let e=group.first,s=stockForEvent(e)||e,preferTr=trOnly&&trTradable(s),label=EL(e),when=eventWhen(e);
 let details=group.items.map(eventItem).join('');
 // One compact line: catalyst chip + date (+N when the stock has more events).
 let shortWhen=String(when||'').replace('/'+new Date().getFullYear(),'');
 let context='<div class="future-card-context future-chip-line">'+
  '<span class="future-chip" title="'+E(e.title||e.fact||label)+'">'+E(label)+'</span>'+
  '<span class="future-when">'+E(shortWhen)+'</span>'+
  (group.items.length>1?'<span class="future-more">+'+(group.items.length-1)+'</span>':'')+
 '</div>';
 return standardStockCard(s,index,{
  se:currentMarketSession(),
  preferTr,
  context:'future',
  rankLabel:'#'+(index+1),
  hint:label+' · '+when,
  cells:[{label:'',html:context}],
  detailsLabel:'Detalle del catalizador',
  detailsHtml:details
 });
}
function renderFuture(){
 const horizon=+document.querySelector('#futureHorizon')?.value||14,type=document.querySelector('#futureType')?.value||'all',sector=document.querySelector('#futureSector')?.value||'all',trOnly=!!document.querySelector('#futureTrOnly')?.checked,now=Date.now();
 const fromValue=document.querySelector('#futureDateFrom')?.value||'',toValue=document.querySelector('#futureDateTo')?.value||'';
 const activeFilters=(type!=='all')+(sector!=='all')+!!fromValue+!!toValue+!trOnly,badge=document.querySelector('#futureFilterCount');
 if(badge){badge.hidden=!activeFilters;badge.textContent=activeFilters?String(activeFilters):'';}
 const from=fromValue?new Date(fromValue+'T00:00:00').getTime():null,to=toValue?new Date(toValue+'T23:59:59').getTime():null;
 syncFutureSectorOptions();
 let filtered=(db.events||[]).filter(e=>{
  if(!futureWindowEvent(e,horizon,now,from,to))return false;
  if(type!=='all'&&e.type!==type)return false;
  if(sector!=='all'&&futureSectorForEvent(e)!==sector)return false;
  let s=stockForEvent(e);if(!s)return false;
  if(trOnly){
   if(!trTradable(s))return false;
   if(typeof ensureTrLiveKey==='function')ensureTrLiveKey(stockKey(s));
  }
  return true;
 });
 let groups=groupFutureEvents(filtered).slice(0,180),box=document.querySelector('#futureResults');
 if(!box)return;
 box.innerHTML=groups.length?groups.map((g,i)=>futureRow(g,i,trOnly)).join(''):'<div class="empty-state">No hay catalizadores o noticias que cumplan estos filtros.</div>';
 requestAnimationFrame(()=>observeTrLivePrices(box));
}
function initEventViewInteractions(){
 ['futureHorizon','futureType','futureSector','futureDateFrom','futureDateTo','futureTrOnly'].forEach(id=>document.querySelector('#'+id)?.addEventListener('change',renderFuture));
 document.querySelector('#futureResetFilters')?.addEventListener('click',()=>{
  const horizon=document.querySelector('#futureHorizon'),type=document.querySelector('#futureType'),sector=document.querySelector('#futureSector'),from=document.querySelector('#futureDateFrom'),to=document.querySelector('#futureDateTo'),tr=document.querySelector('#futureTrOnly');
  if(horizon)horizon.value='14';if(type)type.value='all';if(sector)sector.value='all';if(from)from.value='';if(to)to.value='';if(tr)tr.checked=true;renderFuture();
 });
}


/*
 * Compatibility surface for the old Calendar renderer.
 * Calendar is intentionally fused into Potencial futuro; these helpers keep
 * old mobile/smoke/history callers routed to the single fused data model.
 */
const EVENT_MOBILE_GROUPS=[
 {key:'event',label:'Evento'},
 {key:'market',label:'Mercado'},
 {key:'technical',label:'Técnico'}
];
const eventMobileUi={future:'event',calendar:'event'};
function eventCompactListView(){return document.documentElement.dataset.nativeApp==='1'||!!(window.matchMedia&&window.matchMedia('(max-width:820px)').matches)}
function eventMobileTabs(scope){
 let active=eventMobileUi[scope]||'event';
 return '<nav class="event-mobile-groups" aria-label="Datos del evento">'+EVENT_MOBILE_GROUPS.map(g=>
  '<button type="button" class="'+(g.key===active?'active':'')+'" data-event-mobile-scope="'+E(scope)+'" data-event-mobile-group="'+E(g.key)+'">'+E(g.label)+'</button>'
 ).join('')+'</nav>';
}
function eventMobileRow(scope,s,event,index,label,when,count=1,preferTr=false){
 let meta='<div class="asset-event-meta"><strong>'+E(label)+'</strong><span>'+E(when)+'</span>'+(count>1?'<em>'+count+' eventos</em>':'')+'</div>';
 return standardStockCard(s,index,{se:currentMarketSession(),preferTr,context:scope,hint:label+' · '+when,detailsHtml:'',metaHtml:meta});
}
function eventMobileList(scope,rows){
 return '<div class="event-mobile-rows unified-asset-list">'+(Array.isArray(rows)?rows.join(''):'')+'</div>';
}
function renderCalendar(){return renderFuture()}

