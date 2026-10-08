/*
 * ViewInvAI stock profile
 * -----------------------
 * Stock detail rendering, profile actions, ViewInvAI AI and external ChatGPT handoff.
 */

function profileKpi(label,main,sub=''){
 return '<div class="profile-stat-row"><div><span>'+E(label)+'</span>'+(sub?'<small>'+sub+'</small>':'')+'</div><strong>'+main+'</strong></div>';
}
function profileIdentity(label,value,extra=''){
 return '<div class="profile-identity"><small>'+E(label)+'</small><strong>'+E(value||'—')+'</strong>'+(extra?'<span>'+E(extra)+'</span>':'')+'</div>';
}
function profileTabs(){
 return '<nav class="profile-tabs" aria-label="Secciones de la ficha" role="tablist">'+
  '<button type="button" class="active" role="tab" aria-selected="true" data-profile-tab="general">General</button>'+
  '<button type="button" role="tab" aria-selected="false" data-profile-tab="chart">Gráfico</button>'+
  '<button type="button" role="tab" aria-selected="false" data-profile-tab="news">Noticias</button>'+
  '<button type="button" role="tab" aria-selected="false" data-profile-tab="fundamental">Fundamental</button>'+
  '<button type="button" role="tab" aria-selected="false" data-profile-tab="technical">Técnico</button>'+
  '<button type="button" role="tab" aria-selected="false" class="profile-tab-ai" data-profile-tab="ai">✦ IA ViewInvAI</button>'+
 '</nav>';
}
function profileSessionStrip(s){
 const se=currentMarketSession(),data=usSessionDisplayData(s,se),key=stockKey(s),r=data.regular,x=data.extended;
 const regularVolume=se==='regular'?(N(s.usLiveVolume)??N(s.volume)):N(s.volume);
 let regular='<div class="profile-session-cell" data-profile-regular-session-key="'+E(key)+'"><span>EEUU · Regular</span><strong>'+snapshotPricePair(s,r.price,false)+'</strong><b class="'+C(r.pct)+'">'+PC(r.pct)+'</b><small>Variación de la sesión · Vol '+compactVol(regularVolume)+'</small></div>';
 const prePrice=se==='premarket'&&x?x.price:N(s.premarketPrice),prePct=se==='premarket'&&x?x.pct:N(s.premarketChangePct);
 const postPrice=se==='postmarket'&&x?x.price:N(s.postmarketPrice),postPct=se==='postmarket'&&x?x.pct:N(s.postmarketChangePct);
 let pre='<div class="profile-session-cell"><span>EEUU · Premarket</span><strong>'+snapshotPricePair(s,prePrice,false)+'</strong><b class="'+C(prePct)+'">'+PC(prePct)+'</b><small>Variación de la sesión · Vol '+compactVol(s.premarketVolume)+'</small></div>';
 let post='<div class="profile-session-cell"><span>EEUU · Postmarket</span><strong>'+snapshotPricePair(s,postPrice,false)+'</strong><b class="'+C(postPct)+'">'+PC(postPct)+'</b><small>Variación de la sesión · Vol '+compactVol(s.postmarketVolume)+'</small></div>';
 return '<div class="profile-session-strip">'+pre+regular+post+'</div>';
}
function profileAiPanel(s,mode='us'){
 let a=recommendationAnalysis(s,mode),score=N(a.score)??0,q=stockDataQuality(s,mode,false);
 let tone=score>=72?'high':score>=60?'watch':'wait';
 let label=q.score<55?'Datos insuficientes':score>=72?'Alta convicción':score>=60?'Vigilar':'Esperar';
 let qualityText='Datos '+q.score+'/100'+(q.missing&&q.missing.length?' · falta '+q.missing.slice(0,2).join(', '):' · cobertura suficiente');
 let pos=a.parts.filter(x=>x.delta>2).sort((x,y)=>y.delta-x.delta).slice(0,3);
 let neg=a.parts.filter(x=>x.delta<-2).sort((x,y)=>x.delta-y.delta).slice(0,3);
 let posHtml=pos.length?pos.map(x=>'<li><span>'+E(x.label)+'</span><b class="positive">+'+F(x.delta,1)+'</b></li>').join(''):'<li class="muted"><span>Sin ventaja dominante</span><b>—</b></li>';
 let negHtml=neg.length?neg.map(x=>'<li><span>'+E(x.label)+'</span><b class="negative">'+F(x.delta,1)+'</b></li>').join(''):'<li class="muted"><span>Sin riesgo dominante detectado</span><b>—</b></li>';
 let cat=a.catalyst&&a.catalyst.events&&a.catalyst.events.length?a.catalyst.events[0].e:null;
 return '<aside class="profile-ai-panel" id="profile-ai">'+
  '<div class="profile-ai-head"><div><small>VIEWINVAI IA</small><h3>Lectura multifactor</h3></div><div class="profile-ai-score '+tone+'"><strong>'+F(score,0)+'</strong><span>/100</span></div></div>'+
  '<div class="profile-data-quality '+E(q.level)+'"><strong>'+E(qualityText)+'</strong><span>'+E(window.ViewInvAIScore&&window.ViewInvAIScore.VERSION?'motor '+window.ViewInvAIScore.VERSION:'motor local')+'</span></div>'+
  '<div class="profile-ai-state '+tone+'"><b>'+label+'</b><span>'+E(recommendationNarrative(a))+'</span></div>'+
  '<div class="profile-ai-columns"><div><h4>A favor</h4><ul>'+posHtml+'</ul></div><div><h4>En contra</h4><ul>'+negHtml+'</ul></div></div>'+
  '<div class="profile-ai-catalyst"><small>Catalizador relevante</small><strong>'+E(cat?EL(cat):'Sin catalizador direccional fuerte')+'</strong><span>'+E(cat?(cat.title||cat.fact||''):'La IA sigue precio, volumen, tendencia, liquidez, técnicos, noticias y eventos.')+'</span></div>'+
  '<div class="profile-ai-live" data-ai-auto-key="'+E(stockKey(s))+'" data-ai-auto-prefer-tr="'+(mode==='tr'?'1':'0')+'"><span class="ai-live-dot"></span><span>IA avanzada preparada para analizar datos en vivo.</span></div>'+ 
  '<div class="profile-ai-actions">'+
   '<button type="button" class="btn profile-ai-chat" data-ai-chat-stock="'+E(stockKey(s))+'" data-ai-chat-prefer-tr="'+(mode==='tr'?'1':'0')+'">✦ Preguntar a ViewInvAI</button>'+
  '</div>'+
 '</aside>';
}
function profileCompanySummary(s){
 const explicit=String(s.businessSummary||s.companySummary||s.longBusinessSummary||"").trim();
 if(explicit)return explicit;
 const name=String(s.secName||s.name||s.ticker||"La compañía").trim(),exchange=String(s.exchange||"").trim();
 const sector=String((s.sector&&typeof window.ViewInvAISectorEs==="function"?window.ViewInvAISectorEs(s.sector):s.sector)||"").trim(),industry=String(s.industry||"").trim();
 const classification=industry&&sector?industry+" · "+sector:industry||sector;
 if(classification)return name+" es una compañía cotizada"+(exchange?" en "+exchange:"")+". Según la clasificación sectorial disponible, su actividad se encuadra en "+classification+".";
 return name+" es una compañía cotizada"+(exchange?" en "+exchange:"")+". No hay una descripción corporativa ampliada verificada en la fuente actual.";
}
function profileCompanyIdentityHtml(s,isTr){
 const isin=String((isTr?s.trIsin:null)||s.usIsin||s.isin||s.trIsin||"").trim()||"—";
 const ticker=String((isTr&&s.trTicker)||s.ticker||"").trim()||"—";
 const exchange=String(isTr?(s.trExchange||"LSX"):(s.exchange||"EEUU")).trim()||"—";
 const rows=[
  profileIdentity("Empresa",s.secName||s.name||"—"),
  profileIdentity("Ticker",ticker,exchange),
  profileIdentity("ISIN",isin),
  profileIdentity("WKN",s.trWkn||"—"),
  profileIdentity("Tipo",s.instrumentType||"Acción"),
  profileIdentity("Divisa",isTr?"EUR":(s.currency||"USD")),
  profileIdentity("Sector",s.sector?(typeof window.ViewInvAISectorEs==="function"?window.ViewInvAISectorEs(s.sector):s.sector):"—"),
  profileIdentity("Industria",s.industry||"—"),
  profileIdentity("CIK SEC",s.secCik||"—")
 ].join("");
 return '<section class="profile-section profile-company-overview" id="profile-company">'+
  '<div class="profile-section-head"><h3>Empresa</h3><span>Identificación y actividad</span></div>'+
  '<p class="profile-company-summary">'+E(profileCompanySummary(s))+'</p>'+
  '<div class="profile-company-grid">'+rows+'</div>'+
 '</section>';
}
function profileGeneralBusinessStats(s){
 const cur=E(s.fundamentalCurrency||s.currency||"USD");
 return [
  profileKpi("Capitalización",N(s.marketCap)===null?"—":compactVol(s.marketCap),cur),
  profileKpi("Valor empresa",N(s.enterpriseValue)===null?"—":compactVol(s.enterpriseValue),cur),
  profileKpi("Acciones en circulación",N(s.sharesOutstanding)===null?"—":compactVol(s.sharesOutstanding),""),
  profileKpi("Ingresos TTM",N(s.revenueTtm)===null?"—":compactVol(s.revenueTtm),cur),
  profileKpi("Resultado neto TTM",N(s.netIncomeTtm)===null?"—":compactVol(s.netIncomeTtm),cur),
  profileKpi("PER",N(s.peRatio)===null?"—":F(s.peRatio,2)+"×",""),
  profileKpi("P/B",N(s.priceBook)===null?"—":F(s.priceBook,2)+"×",""),
  profileKpi("Beta 1 año",N(s.beta1Y)===null?"—":F(s.beta1Y,2),"")
 ].join("");
}
function profileGeneralPrimaryStats(s,isTr,se){
 let low=N(s.usLiveDayLow)??N(s.dayLow),high=N(s.usLiveDayHigh)??N(s.dayHigh);
 let range=low!==null&&high!==null?PR(low)+' - '+PR(high):'—';
 const key=stockKey(s),tr=isTr?'1':'0';
 const rangeHtml=isTr
  ?'<span data-profile-tr-range-key="'+E(key)+'">Cargando…</span>'
  :'<span data-profile-live-range-key="'+E(key)+'">'+range+'</span>';
 const volume=N(s.usLiveVolume)??SV(s,se),avg=N(s.avgVolume),rel=volume!==null&&avg>0?volume/avg:RV(s,se);
 const volumeHtml=isTr
  ?'<span data-profile-tr-volume-key="'+E(key)+'">Cargando…</span>'
  :'<span data-profile-live-volume-key="'+E(key)+'">'+compactVol(volume)+'</span>';
 const relHtml=isTr
  ?'<span title="No se mezcla el volumen LSX con la media del mercado EEUU.">N/D</span>'
  :'<span data-profile-live-relvol-key="'+E(key)+'">'+(rel===null?'—':F(rel,2)+'×')+'</span>';
 const support='<span class="profile-live-level" data-profile-level="support" data-profile-level-key="'+E(key)+'" data-profile-level-tr="'+tr+'">Analizando…</span>';
 const resistance='<span class="profile-live-level" data-profile-level="resistance" data-profile-level-key="'+E(key)+'" data-profile-level-tr="'+tr+'">Analizando…</span>';
 return [
  profileKpi(isTr?'Rango LSX':'Rango día',rangeHtml,isTr?'Mínimo - máximo de la sesión LSX':'Mínimo - máximo'),
  profileKpi('Soporte',support,'Suelo técnico · gráfico reciente'),
  profileKpi('Resistencia',resistance,'Tope técnico · gráfico reciente'),
  profileKpi(isTr?'Volumen LSX':'Volumen actual',volumeHtml,isTr?'Agregado de la sesión LSX':'Media '+compactVol(s.avgVolume)),
  profileKpi(isTr?'Vol. relativo LSX':'Volumen relativo',relHtml,isTr?'No se calcula con una media de otro mercado':'Actividad frente a media'),
  profileKpi('Próximos resultados',s.earningsDate?DF(s.earningsDate):'—',s.earningsDate?(eventTime({date:s.earningsDate,timeCode:s.earningsTimeCode})||''):'Sin fecha cargada')
 ].join('');
}
function profileQuoteFreshness(q){
 const raw=q&&q.updatedAt;
 if(!raw)return 'Sin hora fiable';
 const t=typeof raw==='number'?raw:new Date(raw).getTime();
 if(!Number.isFinite(t))return 'Sin hora fiable';
 const age=Math.max(0,Date.now()-t),seconds=Math.round(age/1000);
 if(seconds<60)return 'hace '+seconds+' s';
 const minutes=Math.round(seconds/60);
 if(minutes<60)return 'hace '+minutes+' min';
 const hours=Math.round(minutes/60);
 return 'hace '+hours+' h';
}
function profileGeneralExtraStats(s,isTr,se){
 let currentPrice=quoteFreshnessDotHtml(s,isTr,'profile-kpi-price-freshness')+pricePair(s,SP(s,se),isTr),quote=canonicalQuote(s,isTr),exactTr=isTr?quote:null;
 let currentChange=isTr?'<span class="quote-change '+C(exactTr&&exactTr.change)+'">'+PC(exactTr&&exactTr.change)+'</span>':liveChangeHtml(s,SC(s,se),false);
 let source=String(quote&&quote.source|| (isTr?'Trade Republic / LSX':'EEUU')).trim()||'—';
 let freshness=quoteFreshnessInfo(s,isTr),quality=freshness.state==='live'?'Tiempo real':freshness.state==='delayed'||freshness.state==='closed'?'Diferido':'Sin actualizar';
 return [
  profileKpi(isTr?'Precio LSX':'Precio actual',currentPrice,currentChange),
  profileKpi('BID / ASK',bidAskHtml(s,isTr),isTr?'Trade Republic / LSX':'Feed EEUU'),
  profileKpi('Fuente cotización',E(source),E(quality)),
  profileKpi('Estado',quoteFreshnessHtml(s,isTr,'profile-stat-freshness'),freshness.updatedAt?E(new Date(freshness.updatedAt).toLocaleString('es-ES')):'Sin sello temporal'),
  profileKpi('Volumen promedio',compactVol(s.avgVolume),'10 sesiones')
 ].join('');
}
const profileTrSessionCache=new Map();
async function loadProfileTrSessionStats(s){
 const key=stockKey(s),cached=profileTrSessionCache.get(key);
 if(cached&&Date.now()-cached.at<45000)return cached.value;
 if(!trTradable(s)||!trIsin(s))throw Error('LSX no disponible');
 const response=await fetch('/api/tr-history?isin='+encodeURIComponent(trIsin(s))+'&exchange='+encodeURIComponent(s.trExchange||'LSX')+'&range=1d&resolution=60000',{cache:'no-store'});
 if(!response.ok)throw Error('TR '+response.status);
 const data=await response.json(),points=(Array.isArray(data&&data.points)?data.points:[]).filter(p=>N(p&&p.close)!==null);
 if(!points.length)throw Error('Histórico LSX vacío');
 const highs=points.map(p=>N(p.high)??N(p.close)).filter(v=>v!==null);
 const lows=points.map(p=>N(p.low)??N(p.close)).filter(v=>v!==null);
 const volumes=points.map(p=>N(p.volume)).filter(v=>v!==null&&v>=0);
 const value={
  high:highs.length?Math.max(...highs):null,
  low:lows.length?Math.min(...lows):null,
  volume:volumes.length?volumes.reduce((a,b)=>a+b,0):null,
  points:points.length
 };
 profileTrSessionCache.set(key,{at:Date.now(),value});
 return value;
}
async function hydrateProfileTrSessionStats(root,s){
 if(!root||!s||!trTradable(s))return;
 const range=root.querySelector('[data-profile-tr-range-key="'+CSS.escape(stockKey(s))+'"]');
 const volume=root.querySelector('[data-profile-tr-volume-key="'+CSS.escape(stockKey(s))+'"]');
 if(!range&&!volume)return;
 try{
  const stats=await loadProfileTrSessionStats(s);
  if(!root.isConnected)return;
  if(range)range.textContent=stats.low!==null&&stats.high!==null?PR(stats.low)+' - '+PR(stats.high):'N/D';
  if(volume)volume.textContent=stats.volume!==null?compactVol(stats.volume):'N/D';
 }catch(_){
  if(range)range.textContent='N/D';
  if(volume)volume.textContent='N/D';
 }
}

const profileLevelsCache=new Map();
function profileLevelCluster(values,tolerancePct=1.2){
 const rows=values.map(N).filter(v=>v!==null&&v>0).sort((a,b)=>a-b),clusters=[];
 for(const value of rows){
  let best=clusters.find(group=>Math.abs(value-group.center)/group.center*100<=tolerancePct);
  if(best){best.values.push(value);best.center=best.values.reduce((a,b)=>a+b,0)/best.values.length}
  else clusters.push({center:value,values:[value]});
 }
 return clusters;
}
function profileSupportResistanceFromPoints(raw,current){
 let pts=(Array.isArray(raw)?raw:[]).map(p=>({close:N(p&&((p.close!==undefined)?p.close:p.price)),high:N(p&&p.high),low:N(p&&p.low)})).filter(p=>p.close!==null).slice(-180);
 if(pts.length<20)return null;
 let px=N(current)??pts[pts.length-1].close,lows=[],highs=[];
 for(let i=2;i<pts.length-2;i++){
  const lo=pts[i].low??pts[i].close,hi=pts[i].high??pts[i].close;
  const aroundLow=[pts[i-2],pts[i-1],pts[i+1],pts[i+2]].map(p=>p.low??p.close);
  const aroundHigh=[pts[i-2],pts[i-1],pts[i+1],pts[i+2]].map(p=>p.high??p.close);
  if(aroundLow.every(v=>lo<=v))lows.push(lo);
  if(aroundHigh.every(v=>hi>=v))highs.push(hi);
 }
 let supportGroups=profileLevelCluster(lows).filter(g=>g.center<px).sort((a,b)=>b.center-a.center||b.values.length-a.values.length);
 let resistanceGroups=profileLevelCluster(highs).filter(g=>g.center>px).sort((a,b)=>a.center-b.center||b.values.length-a.values.length);
 let spanHigh=Math.max(...pts.slice(-90).map(p=>p.high??p.close)),spanLow=Math.min(...pts.slice(-90).map(p=>p.low??p.close)),span=spanHigh-spanLow;
 let fibLevels=span>0?[spanLow+span*.236,spanLow+span*.382,spanLow+span*.5,spanLow+span*.618,spanLow+span*.786]:[];
 let support=supportGroups.find(g=>g.values.length>=2)?.center??supportGroups[0]?.center??Math.max(...fibLevels.filter(v=>v<px),spanLow);
 let resistance=resistanceGroups.find(g=>g.values.length>=2)?.center??resistanceGroups[0]?.center??Math.min(...fibLevels.filter(v=>v>px),spanHigh);
 if(!Number.isFinite(support))support=spanLow;
 if(!Number.isFinite(resistance))resistance=spanHigh;
 return{support,resistance,points:pts.length};
}
async function loadProfileSupportResistance(s,isTr=false){
 const key=(isTr?'tr:':'us:')+stockKey(s),cached=profileLevelsCache.get(key);
 if(cached&&Date.now()-cached.at<90000)return cached.value;
 let data=null;
 if(isTr&&trTradable(s)&&trIsin(s)){
  let response=await fetch('/api/tr-history?isin='+encodeURIComponent(trIsin(s))+'&exchange='+encodeURIComponent(s.trExchange||'LSX')+'&range=1m&resolution=900000',{cache:'no-store'});
  if(!response.ok)throw Error('TR '+response.status);data=await response.json();
 }else{
  let response=await fetch('/api/us-chart?symbol='+encodeURIComponent(s.ticker||''),{cache:'no-store'});
  if(!response.ok)throw Error('US '+response.status);data=await response.json();
 }
 let current=N(canonicalQuote(s,isTr).price),value=profileSupportResistanceFromPoints(data&&data.points,current);
 if(!value)throw Error('Histórico insuficiente');
 profileLevelsCache.set(key,{at:Date.now(),value});return value;
}
async function hydrateProfileSupportResistance(root,s,isTr=false){
 if(!root||!s)return;
 let nodes=[...root.querySelectorAll('[data-profile-level-key="'+CSS.escape(stockKey(s))+'"]')];if(!nodes.length)return;
 try{
  let levels=await loadProfileSupportResistance(s,isTr);
  if(!root.isConnected)return;
  let symbol=isTr?'€':'$';
  nodes.forEach(el=>{
   let value=el.dataset.profileLevel==='support'?levels.support:levels.resistance;
   el.textContent=quoteMoney(value,symbol,quotePrecision(s,isTr,value));
   el.classList.add('ready');
   el.title='Calculado con swings recientes y niveles de Fibonacci sobre '+levels.points+' puntos de gráfico.';
  });
 }catch(_){
  nodes.forEach(el=>{el.textContent='N/D';el.title='No hay histórico suficiente para calcular un nivel fiable.'});
 }
}
function profileFixedMarketSection(label,body,meta='',className=''){
 return '<section class="profile-section profile-stats-section profile-fixed-market '+E(className)+'">'+
  '<div class="profile-section-head"><h3>'+E(label)+'</h3>'+(meta?'<span>'+E(meta)+'</span>':'')+'</div>'+
  '<div class="profile-fixed-market-body">'+body+'</div></section>';
}
function profileFundamentalStats(s){
 let cur=E(s.fundamentalCurrency||'USD');
 return [
  profileKpi('PER',N(s.peRatio)===null?'—':F(s.peRatio,2)+'×','Precio / beneficio'),
  profileKpi('BPA diluido TTM',N(s.epsDilutedTtm)===null?'—':F(s.epsDilutedTtm,3),cur),
  profileKpi('Rentabilidad dividendo',N(s.dividendYield)===null?'—':F(s.dividendYield,2)+'%','Actual'),
  profileKpi('Beta 1 año',N(s.beta1Y)===null?'—':F(s.beta1Y,2),'Volatilidad relativa'),
  profileKpi('Acciones en circulación',N(s.sharesOutstanding)===null?'—':compactVol(s.sharesOutstanding),''),
  profileKpi('Valor empresa',N(s.enterpriseValue)===null?'—':compactVol(s.enterpriseValue),cur),
  profileKpi('Ingresos',N(s.revenueTtm)===null?'—':compactVol(s.revenueTtm),cur+' · TTM'),
  profileKpi('Ingresos netos',N(s.netIncomeTtm)===null?'—':compactVol(s.netIncomeTtm),cur+' · TTM'),
  profileKpi('Precio / valor libro',N(s.priceBook)===null?'—':F(s.priceBook,2)+'×','P/B')
 ].join('');
}
function profileTechnicalStats(s){
 return [
  profileKpi('RSI 14',F(s.rsi,1),'TradingView · 1D'),
  profileKpi('ADX 14',F(s.adx,1),'TradingView · 1D'),
  profileKpi('EMA 20',PR(s.ema20),'20 sesiones · 1D'),
  profileKpi('EMA 50',PR(s.ema50),'50 sesiones · 1D'),
  profileKpi('Tendencia',trendState(s)===true?'Favorable':trendState(s)===false?'Débil / bajista':'Sin dato','Precio + EMA · 1D'),
  profileKpi('Liquidez',lowLiquidity(s,SES(),false)?'Vigilar':'Normal','Volumen y spread de la sesión')
 ].join('');
}
function profilePerformanceStrip(s){
 let rows=[
  ['1 semana',s.perfWeek],
  ['1 mes',s.perfMonth],
  ['3 meses',s.perf3M],
  ['6 meses',s.perf6M],
  ['YTD',s.perfYtd],
  ['1 año',s.perf1Y]
 ];
 return '<div class="profile-performance-strip">'+rows.map(([label,value])=>'<div><span>'+E(label)+'</span><strong class="'+C(value)+'">'+PC(value)+'</strong></div>').join('')+'</div>';
}
function profileVisualAnalysisHtml(s,isTr=false){
 let key=stockKey(s);
 return '<section class="profile-tab-panel" data-profile-panel="chart" hidden>'+
   '<section class="profile-section profile-chart-section profile-chart-clean" id="profile-chart">'+miniChart(s,isTr)+profilePerformanceStrip(s)+'</section>'+
  '</section>'+
  '<section class="profile-tab-panel" data-profile-panel="ai" hidden>'+
   profileAskAiHtml(s,isTr)+
   profileAiPanel(s,isTr?'tr':'us')+
  '</section>';
}
// «Preguntar a AI»: un botón por IA (ChatGPT, Claude, Gemini) con la pregunta completa de la
// acción, y «Pegar respuesta» para que su veredicto refuerce o rebaje la acción en la app.
function profileAskAiHtml(s,isTr=false){
 let key=stockKey(s),C=window.ViewInvAIContrast;
 if(!C)return '<div class="profile-ai-tab-actions"><button type="button" class="btn profile-chatgpt-open" data-chatgpt-stock="'+E(key)+'" data-chatgpt-prefer-tr="'+(isTr?'1':'0')+'">Preguntar a ChatGPT ↗</button></div>';
 let ticker=String(s.ticker||s.trTicker||'').toUpperCase(),mode=isTr?'tr':'us';
 let a=null;try{a=recommendationAnalysis(s,mode)}catch(_){}
 let own=a&&N(a.score)!==null?'- Lectura de ViewInvAI: score '+F(a.score,0)+'/100'+(a.signal&&a.signal.label?' · '+a.signal.label:''):'';
 let manualPrompt=()=>buildExternalChatGptPrompt(s,isTr&&trTradable(s))+'\n\n'+
  (own?own+'\n':'')+
  'Al final, después de tu análisis, incluye SOLO un bloque JSON con tu veredicto sobre si comprar o mantener '+ticker+' tiene sentido ahora:\n'+
  '{"veredicto":"respalda|dudas|contradice","resumen":"una o dos frases","valores":[{"ticker":"'+ticker+'","veredicto":"respalda|dudas|contradice","motivo":"dato clave"}]}';
 const publicContext=C.stockContext?C.stockContext(s,isTr,4):'';
 let prompt='Acción: '+ticker+' ('+(s.name||'')+(s.exchange?', '+s.exchange:'')+'). '+(own?own.slice(2)+'. ':'')+
  'Contrasta usando prioritariamente los datos actuales aportados por ViewInvAI. Si falta información reciente, dilo y no inventes nada.'+
  (publicContext?'\n\nDATOS ACTUALES Y EVENTOS APORTADOS POR VIEWINVAI:\n'+publicContext:'');
 return C.panelHtml({type:'stock',key:key+'|'+mode,title:ticker,ticker,tickers:[ticker],inline:true,auto:false,prompt,manualPrompt});
}
function profileDetailRoot(el){
 return el&&el.closest?el.closest('.stock-profile-page,.stock-profile'):null;
}
function activateProfileTabData(root,s,preferTr=false,tab=''){
 if(!root||!s)return;
 const market=preferTr===true?'tr':'us';
 if(tab==='chart'){
  const loadKey=stockKey(s)+'|'+market;
  if(root.dataset.profileChartLoadedKey===loadKey)return;
  root.dataset.profileChartLoadedKey=loadKey;
  requestAnimationFrame(()=>{
   root.querySelectorAll('[data-profile-panel="chart"] .mini-chart').forEach(el=>{
    delete el.dataset.loaded;
    loadMiniChart(el);
   });
  });
  return;
 }
 if(tab==='ai'){
  const loadKey=stockKey(s)+'|'+market;
  if(root.dataset.profileAiLoadedKey===loadKey)return;
  root.dataset.profileAiLoadedKey=loadKey;
  requestAnimationFrame(()=>loadAiBrief(root,s,preferTr===true));
 }
}
function profilePortfolioActionHtml(s,isTr=false){
 let key=stockKey(s),api=window.ViewInvAIPortfolios;
 let inPortfolio=!!(api&&typeof api.isInPortfolio==='function'&&api.isInPortfolio(key,isTr));
 let title=inPortfolio?'Abrir operaciones de cartera':'Añadir a cartera';
 return '<button type="button" class="profile-add-portfolio profile-wallet-action'+(inPortfolio?' is-managed':'')+'" data-add-portfolio-stock="'+E(key)+'" data-add-portfolio-prefer-tr="'+(isTr?'1':'0')+'" title="'+E(title)+'" aria-label="'+E(title)+'"><span aria-hidden="true">💼</span></button>';
}
function profilePositionEditActionHtml(s,isTr=false){
 const key=stockKey(s),api=window.ViewInvAIPortfolios;
 const memberships=api&&typeof api.getPortfolioMemberships==='function'?api.getPortfolioMemberships(key,isTr):[];
 if(!memberships||!memberships.length)return'';
 return '<button type="button" class="btn small profile-edit-position" data-profile-edit-position="'+E(key)+'">✎ Posición</button>';
}
function refreshProfilePortfolioActions(s){
 if(!s)return;
 let key=stockKey(s);
 document.querySelectorAll('[data-add-portfolio-stock]').forEach(button=>{
  if(button.dataset.addPortfolioStock!==key)return;
  let isTr=button.dataset.addPortfolioPreferTr==='1';
  let template=document.createElement('template');
  template.innerHTML=profilePortfolioActionHtml(s,isTr).trim();
  let next=template.content.firstElementChild;
  if(next)button.replaceWith(next);
 });
}

function profileNotificationActionHtml(s,isTr=false){
 return '<button type="button" class="profile-notification-bell" data-stock-notifications="'+E(stockKey(s))+'" data-stock-notifications-tr="'+(isTr?'1':'0')+'" title="Configurar notificaciones" aria-label="Configurar notificaciones para '+E(s.name||s.ticker||'este valor')+'">🔔</button>';
}

function profileHeroQuoteHtml(s,se=currentMarketSession(),isTr=false){
 if(isTr){
  const q=canonicalQuote(s,true),price=N(q.price),change=N(q.change),text=quoteMoney(price,'€',quotePrecision(s,true,price));
  return '<div class="profile-quote-stack profile-quote-stack-lsx"><div class="profile-quote-lsx">'+quoteFreshnessDotHtml(s,true,'profile-price-freshness')+'<strong>'+E(text)+'</strong><b class="'+C(change)+'">'+PC(change)+'</b></div></div>';
 }
 return '<div class="profile-quote-stack profile-quote-stack-us"><div class="profile-quote-current" data-us-current-hero-key="'+E(stockKey(s))+'">'+currentUsPrimaryHtml(s,se)+'</div></div>';
}
// Header strip: the AI verdict (taps through to the IA tab) and two key session figures,
// so the essentials are visible without switching tabs.
function profileAiStripHtml(s,isTr=false){
 let chip='';
 try{
  const mode=isTr?'tr':'us',a=recommendationAnalysis(s,mode),score=N(a.score),q=stockDataQuality(s,mode,false);
  if(score!==null){
   const tone=q.score<55?'wait':score>=72?'high':score>=60?'watch':'wait';
   const label=q.score<55?'Datos insuficientes':score>=72?'Alta convicción':score>=60?'Vigilar':'Esperar';
   chip='<button type="button" class="profile-ai-verdict '+tone+'" data-profile-tab="ai" aria-label="Ver lectura IA: '+E(label)+' '+F(score,0)+' de 100"><span>✦ IA</span><b>'+E(label)+'</b><em>'+F(score,0)+'</em></button>';
  }
 }catch(e){}
 const lo=N(s.dayLow),hi=N(s.dayHigh),vol=N(s.volume),avg=N(s.avgVolume);
 const facts=[];
 if(!isTr&&lo!==null&&hi!==null)facts.push('<span><small>Rango</small><b>'+F(lo,2)+' – '+F(hi,2)+'</b></span>');
 if(vol!==null&&avg)facts.push('<span><small>Vol.</small><b>'+F(vol/avg,2)+'×</b></span>');
 if(!chip&&!facts.length)return'';
 return '<div class="profile-ai-strip">'+chip+facts.join('')+'</div>';
}

// «¿Por qué se mueve hoy?»: une en una frase lo que ya sabemos del valor (noticias de
// las últimas 24 h, resultados, volumen relativo y el movimiento de su sector).
let profileSectorCache={stamp:'',map:new Map()};
function profileSectorMoves(){
 const stamp=String((db.meta&&db.meta.updatedAt)||'')+':'+(db.stocks||[]).length;
 if(profileSectorCache.stamp===stamp)return profileSectorCache.map;
 const groups=new Map();
 for(const x of db.stocks||[]){
  const c=N(x.changePct),cap=N(x.marketCap);
  if(c===null||Math.abs(c)>40||!x.sector||(cap!==null&&cap<3e8))continue;
  if(!groups.has(x.sector))groups.set(x.sector,[]);
  groups.get(x.sector).push(c);
 }
 const map=new Map();
 for(const [k,v] of groups){if(v.length<8)continue;v.sort((a,b)=>a-b);map.set(k,{median:v[Math.floor(v.length/2)],n:v.length})}
 profileSectorCache={stamp,map};return map;
}
function profileWhyMovingHtml(s,isTr=false){
 const chg=isTr?(N(s.trLiveChangePct)??N(s.changePct)):N(s.changePct);
 if(chg===null||Math.abs(chg)<1.5)return'';
 const up=chg>0,reasons=[];
 const now=Date.now();
 let events=[];try{events=stockEvents(s)||[]}catch(_){}
 // Prefer news that name the company itself (some feeds attach market round-ups to every ticker).
 const nameWord=String(s.name||'').split(/[\s,.]+/).find(w=>w.length>=4)||'',ticker=String(s.ticker||'');
 const own=e=>{const t=String(e.title||''),low=t.toLowerCase(),w=nameWord.toLowerCase();const at=Math.min(...[w?low.indexOf(w):-1,ticker?t.search(new RegExp('\\b'+ticker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b')):-1].filter(i=>i>=0).concat([999]));return at<=12?2:at<999?1:0};
 const news=events.filter(e=>{const t=new Date(e.date).getTime();return e.eventKind==='news'&&now-t<72*3600e3&&now-t>-3600e3}).sort((a,b)=>(own(b)-own(a))||(new Date(b.date)-new Date(a.date)));
 const ago=e=>{const h=Math.max(0,(now-new Date(e.date).getTime())/3600e3);return h<1?'hace minutos':h<24?'hace '+Math.round(h)+' h':'hace '+Math.round(h/24)+' d'};
 const earnings=events.find(e=>e.type==='earnings'&&Math.abs(new Date(e.date).getTime()-now)<36*3600e3);
 if(earnings)reasons.push({k:'Resultados',t:'Publica o acaba de publicar resultados'});
 if(news[0])reasons.push({k:EL(news[0]),t:String(news[0].title||news[0].fact||'').slice(0,140)+' · '+ago(news[0])});
 const rel=N(s.relVolume)??(N(s.volume)&&N(s.avgVolume)?N(s.volume)/N(s.avgVolume):null);
 if(rel!==null&&rel>=2)reasons.push({k:'Volumen',t:'×'+F(rel,1)+' sobre su media: el movimiento tiene participación'});
 else if(rel!==null&&rel<0.8)reasons.push({k:'Volumen',t:'Por debajo de su media (×'+F(rel,1)+'): movimiento poco respaldado'});
 const sec=s.sector&&profileSectorMoves().get(s.sector),secName=typeof window.ViewInvAISectorEs==='function'?window.ViewInvAISectorEs(s.sector):s.sector;
 if(sec){
  if(Math.abs(sec.median)>=1&&Math.sign(sec.median)===Math.sign(chg))reasons.push({k:'Sector',t:secName+' '+(sec.median>0?'sube':'cae')+' un '+F(Math.abs(sec.median),1)+'% hoy: parte es arrastre sectorial'});
  else reasons.push({k:'Sector',t:'Movimiento propio: '+secName+' '+(Math.abs(sec.median)<0.5?'apenas varía':'va '+(sec.median>0?'al alza':'a la baja')+' ('+(sec.median>0?'+':'')+F(sec.median,1)+'%)')});
 }
 const cause=earnings?'por sus resultados':news[0]?'tras una noticia':rel!==null&&rel>=2?'con volumen alto':sec&&Math.abs(sec.median)>=1&&Math.sign(sec.median)===Math.sign(chg)?'junto a su sector':'sin noticia clara';
 const head=(up?'Sube':'Cae')+' un '+F(Math.abs(chg),1)+'% '+cause;
 return '<details class="profile-why"><summary><span class="profile-why-icon '+(up?'up':'down')+'">'+(up?'▲':'▼')+'</span><span><small>¿POR QUÉ SE MUEVE HOY?</small><b>'+E(head)+'</b></span></summary>'+
  '<ul>'+reasons.map(r=>'<li><em>'+E(r.k)+'</em><span>'+E(r.t)+'</span></li>').join('')+'</ul>'+
  (news.length?'':'<p>Sin noticias registradas en los últimos 3 días: puede responder a flujos, rumores o al mercado. Pregunta a la IA en la pestaña ✦ IA para un análisis más amplio.</p>')+
 '</details>';
}

// «Plan de operación»: entrada, stop por volatilidad (1,5 × ATR de 14 días), objetivo con la
// relación beneficio/riesgo del nivel elegido y tamaño según tu cartera. Mismos límites que
// Objetivo IA (riesgo por operación, peso máximo por valor y stop máximo).
const PLAN_BANDS={
 conservative:{label:'Bajo',risk:.5,maxPos:8,maxStop:5,rr:2.2},
 balanced:{label:'Medio',risk:1,maxPos:15,maxStop:6,rr:2},
 aggressive:{label:'Alto',risk:2,maxPos:25,maxStop:7,rr:1.8}
};
function planRiskKey(){try{const v=localStorage.getItem('viewinvai:plan-risk');return PLAN_BANDS[v]?v:'balanced'}catch(_){return'balanced'}}
// Si la acción está en el plan del Objetivo de la cartera seleccionada (mismo mercado), la ficha
// muestra ese plan (stop y objetivo de «Hoy toca») en lugar del plan orientativo por ATR.
function profileGoalPlanHtml(g){
 const px=v=>{const n=N(v);if(n===null)return'—';const d=Math.abs(n)<10?3:2;return n.toLocaleString('es-ES',{minimumFractionDigits:d,maximumFractionDigits:d})+' €'},pct=v=>F(Math.abs(N(v)||0),1)+'%';
 let head='',grid='',note='';
 if(g.kind==='buy'){
  head='Comprar '+F(g.units,0)+' acciones · Stop '+px(g.stopEur)+' (−'+pct(g.stopPct)+')'+(N(g.targetEur)!==null?' · Objetivo '+px(g.targetEur)+' (+'+pct(g.targetPct)+')':'');
  grid='<div><small>ENTRADA</small><b>'+px(g.entryEur)+'</b><span>precio de compra</span></div><div><small>STOP</small><b class="negative">'+px(g.stopEur)+'</b><span>−'+pct(g.stopPct)+'</span></div><div><small>OBJETIVO</small><b class="positive">'+px(g.targetEur)+'</b><span>+'+pct(g.targetPct)+'</span></div>';
 }else if(g.kind==='wait'){
  head=N(g.limitPriceEur)!==null?'Esperar · no comprar por encima de '+px(g.limitPriceEur):'Esperar · el punto de entrada aún no es limpio';
  note='<p class="plan-note">'+E(g.text||'')+'</p>';
 }else{
  head=g.action&&g.action.type==='SELL'?'Vender: stop alcanzado o salida del plan':'En cartera · Stop '+px(g.stopEur)+(N(g.stopDistPct)!==null?' (−'+pct(g.stopDistPct)+' del precio)':'');
  grid='<div><small>PRECIO</small><b>'+px(g.priceEur)+'</b><span>venta en BID</span></div><div><small>STOP</small><b class="negative">'+px(g.stopEur)+'</b><span>'+(g.trailing?'dinámico, sube con el precio':'fijo desde la compra')+'</span></div>';
  if(g.action)note='<p class="plan-note">'+E(g.action.text)+'</p>';
 }
 return '<details class="profile-plan" data-profile-plan data-plan-source="goal"><summary><span><small>PLAN DEL OBJETIVO · '+E(String(g.portfolioName||'').toUpperCase())+'</small><b>'+E(head)+'</b></span></summary>'+
  '<div class="plan-body">'+(grid?'<div class="plan-grid">'+grid+'</div>':'')+note+
  '<p class="plan-note">Es el mismo plan que «Hoy toca» en el Objetivo de esta cartera (importes en €).</p></div></details>';
}
function profileTradePlanHtml(s,isTr=false){
 const goalPlan=window.ViewInvAIPortfolios&&typeof window.ViewInvAIPortfolios.getGoalPlanFor==='function'?window.ViewInvAIPortfolios.getGoalPlanFor(s):null;
 if(goalPlan&&goalPlan.preferTr===!!isTr)return profileGoalPlanHtml(goalPlan);
 const usPrice=N(s.price),atr=N(s.atr);
 let atrPct=atr!==null&&usPrice>0?atr/usPrice*100:null,atrSource='ATR 14 días';
 // Without a real 14-day ATR there is no plan: the day range on a +60% day gives absurd stops.
 const entry=isTr?(N(s.trLiveAsk)??N(s.trLivePrice)):(N(s.usLiveAsk)??N(s.usLivePrice)??N(s.price));
 if(entry===null||!(entry>0)||atrPct===null||!(atrPct>0))return'';
 window.__planCtx={key:stockKey(s),isTr};
 const cur=isTr?'EUR':'USD',sym=isTr?'€':'$',key=planRiskKey(),band=PLAN_BANDS[key];
 const fx=typeof eurUsd==='function'?eurUsd():null;
 const stopPct=Math.max(1.5,1.5*atrPct),tooWide=stopPct>band.maxStop;
 const stop=entry*(1-stopPct/100),target=entry*(1+band.rr*stopPct/100);
 const sum=window.ViewInvAIPortfolios&&typeof window.ViewInvAIPortfolios.getDaySummary==='function'?window.ViewInvAIPortfolios.getDaySummary():null;
 const capitalEur=sum&&sum.signedIn&&sum.total&&sum.total.value>0?sum.total.value:null;
 const capital=capitalEur===null?null:(cur==='EUR'?capitalEur:(fx?capitalEur*fx:null));
 let spec={speculative:false,reasons:[]};
 try{if(window.ViewInvAIScore&&window.ViewInvAIScore.speculative)spec=window.ViewInvAIScore.speculative({price:usPrice,marketCap:N(s.marketCap),avgVolume:N(s.avgVolume),events:stockEvents(s)})}catch(_){}
 let sizing='';
 if(capital!==null){
  let riskMoney=capital*band.risk/100;if(spec.speculative)riskMoney/=2;
  const perShare=entry-stop;
  let shares=perShare>0?riskMoney/perShare:0;
  const maxShares=capital*band.maxPos/100/entry;shares=Math.min(shares,maxShares);
  const whole=Math.floor(shares),amount=(whole>=1?whole:shares)*entry;
  sizing='<div class="plan-size"><small>TAMAÑO</small><b>'+(whole>=1?whole+' acciones':'≈ '+F(shares,2)+' acciones (fraccionadas)')+'</b><span>≈ '+F(amount,0)+' '+sym+' · arriesgas '+F(Math.min(riskMoney,shares*perShare),0)+' '+sym+' ('+F(band.risk*(spec.speculative?.5:1),2)+'% de tu cartera)</span></div>';
 }else sizing='<div class="plan-size"><small>TAMAÑO</small><b>Inicia sesión y añade tu cartera</b><span>El tamaño se calcula con el '+F(band.risk,1)+'% de tu cartera como riesgo máximo.</span></div>';
 const chips=Object.entries(PLAN_BANDS).map(([k,b])=>'<button type="button" class="plan-risk'+(k===key?' active':'')+'" data-plan-risk="'+k+'" aria-pressed="'+(k===key)+'">'+b.label+'</button>').join('');
 const px=v=>F(v,v<10?3:2)+' '+sym;
 return '<details class="profile-plan"'+(window.__planOpen?' open':'')+' data-profile-plan><summary><span><small>PLAN DE OPERACIÓN · ORIENTATIVO</small><b>Stop '+px(stop)+' (−'+F(stopPct,1)+'%) · Objetivo '+px(target)+' (+'+F(band.rr*stopPct,1)+'%)</b></span></summary>'+
  '<div class="plan-body">'+
   '<div class="plan-risk-row" role="group" aria-label="Nivel de riesgo">'+chips+'</div>'+
   (spec.speculative?'<p class="plan-warn">⚠ Especulativo ('+E(spec.reasons.join(', '))+'): el tamaño se reduce a la mitad.</p>':'')+
   (tooWide?'<p class="plan-warn">La volatilidad pide un stop del '+F(stopPct,1)+'%, por encima del '+band.maxStop+'% de tu nivel «'+band.label+'». Si entras, que sea con menos tamaño o espera un punto de entrada más estrecho.</p>':'')+
   '<div class="plan-grid">'+
    '<div><small>ENTRADA</small><b>'+px(entry)+'</b><span>'+(isTr?'ask LSX':'precio actual')+'</span></div>'+
    '<div><small>STOP</small><b class="negative">'+px(stop)+'</b><span>1,5 × '+E(atrSource)+'</span></div>'+
    '<div><small>OBJETIVO</small><b class="positive">'+px(target)+'</b><span>'+F(band.rr,1)+' × el riesgo</span></div>'+
   '</div>'+sizing+
   '<p class="plan-note">Cálculo orientativo con los límites de tu nivel de riesgo (máx. '+band.maxPos+'% de la cartera por valor). No es una recomendación personalizada; ajusta el stop a soportes y a tu horizonte.</p>'+
  '</div></details>';
}
document.addEventListener('click',e=>{
 const b=e.target.closest&&e.target.closest('[data-plan-risk]');if(!b)return;
 try{localStorage.setItem('viewinvai:plan-risk',b.dataset.planRisk)}catch(_){}
 const d=b.closest('[data-profile-plan]');window.__planOpen=true;
 const ctx=window.__planCtx,s=ctx&&stockByKey(ctx.key);
 if(d&&s){const isTr=ctx.isTr;const wrap=document.createElement('div');wrap.innerHTML=profileTradePlanHtml(s,isTr);const next=wrap.firstElementChild;if(next)d.replaceWith(next)}
});
document.addEventListener('toggle',e=>{if(e.target&&e.target.matches&&e.target.matches('[data-profile-plan]'))window.__planOpen=e.target.open},true);
function profileHeroHtml(s,isTr=false,opts={}){
 let se=currentMarketSession();
 let ticker=isTr?(s.trTicker||s.ticker):s.ticker;
 let marketTitle=isTr?'Trade Republic / '+(s.trExchange||'LSX'):(s.exchange||'EEUU');
 let company=String(s.name||s.secName||ticker||'—').trim();
 let back='';
 if(opts.backKind==='portfolio')back='<button type="button" class="profile-back-inline" data-portfolio-detail-close>← Atrás</button>';
 else if(opts.backKind==='profile')back='<button type="button" class="profile-back-inline" data-profile-back="'+E(opts.backView||state.currentView)+'">← Atrás</button>';
 else if(opts.backKind==='quick')back='<button type="button" class="profile-back-inline" data-stock-detail-back="1">← Atrás</button>';
 return '<header class="profile-hero investing-profile-header unified-stock-header">'+
   '<div class="unified-stock-header-inner">'+
    (back?'<div class="profile-back-cell">'+back+'</div>':'')+
    '<div class="profile-title">'+favButton(s,isTr)+'<div><div class="profile-market">'+E(marketTitle)+'</div><h2 class="profile-company-name">'+E(company)+'</h2><p class="profile-ticker-line">'+E(ticker||'—')+'</p></div></div>'+
    '<div class="profile-live"><small>'+(isTr?'LSX · cotización actual':'EEUU · cotización actual')+'</small><div class="profile-live-main">'+profileHeroQuoteHtml(s,se,isTr)+'</div></div>'+
    (opts.hideActions?'':'<div class="profile-primary-actions">'+profilePortfolioActionHtml(s,isTr)+profilePositionEditActionHtml(s,isTr)+profileNotificationActionHtml(s,isTr)+'</div>')+
    profileAiStripHtml(s,isTr)+profileWhyMovingHtml(s,isTr)+profileTradePlanHtml(s,isTr)+
   '</div>'+
  '</header>';
}

function nativeProfileChrome(){
 return document.documentElement.dataset.nativeApp==='1';
}
function profileStickyShellHtml(s,isTr=false,opts={}){
 const hero=profileHeroHtml(s,isTr,opts);
 return '<div class="profile-sticky-shell">'+hero+profileTabs()+'</div>';
}
function profileBodyTabsHtml(){
 return '';
}
const profileLiveEventCache=new Map();
function profileNewsPanelHtml(s){
 let events=stockEvents(s),now=Date.now();
 let upcoming=events.filter(e=>e.eventKind!=='news'&&new Date(e.date).getTime()>=now-864e5).sort((x,y)=>new Date(x.date)-new Date(y.date)).slice(0,4);
 let news=events.filter(e=>e.eventKind==='news').sort((x,y)=>new Date(y.date)-new Date(x.date)).slice(0,6);
 let catalystHtml=upcoming.length?upcoming.map(eventItem).join(''):'<div class="profile-empty">No hay eventos próximos fechados cargados.</div>';
 let newsHtml=news.length?news.map(eventItem).join(''):'<div class="profile-empty">No hay noticias recientes cargadas.</div>';
 return '<section class="profile-section quick-events" id="profile-news"><div class="profile-section-head"><h3>Noticias y catalizadores</h3><span>'+news.length+' noticias · '+upcoming.length+' próximos</span></div><div class="profile-news-grid"><div><h4>Noticias recientes</h4><div class="event-list profile-events">'+newsHtml+'</div></div><div><h4>Próximos catalizadores</h4><div class="event-list profile-events">'+catalystHtml+'</div></div></div></section>';
}
async function refreshProfileLiveEvents(s){
 if(!s)return;
 const key=stockKey(s),last=profileLiveEventCache.get(key)||0,now=Date.now();
 if(now-last<120000)return;
 profileLiveEventCache.set(key,now);
 const ticker=String(s.ticker||s.trTicker||'').trim(),exchange=String(s.exchange||'').trim();
 if(!ticker)return;
 try{
  const response=await fetch('/api/stock-events-live?ticker='+encodeURIComponent(ticker)+'&exchange='+encodeURIComponent(exchange),{cache:'no-store'});
  if(!response.ok)throw Error('HTTP '+response.status);
  const data=await response.json();
  window.ViewInvAI?.mergeLiveEvents?.(data.events||[]);
  if(state.profileKey!==key)return;
  const panel=document.querySelector('.profile-tab-panel[data-profile-panel="news"] #profile-news');
  if(panel)panel.outerHTML=profileNewsPanelHtml(s);
 }catch(error){
  console.warn('Live profile events unavailable',error);
 }
}
function quickProfileHtml(s,opts={}){
 let requested=opts.preferTr===true?true:opts.preferTr===false?false:state.profilePreferTr===true;
 let isTr=(requested||intlListing(s))&&trTradable(s),se=currentMarketSession();
 return profileStickyShellHtml(s,isTr,{backKind:'quick'})+
  '<div class="unified-profile-body">'+
   profileBodyTabsHtml()+
   '<section class="profile-tab-panel active" data-profile-panel="general">'+
   profileCompanyIdentityHtml(s,isTr)+
   '<section class="profile-section profile-stats-section profile-primary-stats" id="profile-general"><div class="profile-section-head"><h3>Resumen de mercado</h3><span>Lo esencial primero</span></div><div class="profile-stat-list">'+profileGeneralPrimaryStats(s,isTr,se)+'</div></section>'+
   (isTr?'':profileFixedMarketSection('Sesiones de mercado',profileSessionStrip(s),'Premarket · Regular · Postmarket · solo EEUU','profile-market-sessions'))+
   profileFixedMarketSection('Más datos de mercado','<div class="profile-stat-list">'+profileGeneralExtraStats(s,isTr,se)+'</div>','Precio, spread, volumen medio y capitalización','profile-market-extra')+
   profileFixedMarketSection('Datos de empresa','<div class="profile-stat-list">'+profileGeneralBusinessStats(s)+'</div>','Magnitudes fundamentales disponibles','profile-business-extra')+
   '</section>'+
   profileVisualAnalysisHtml(s,isTr)+
   '<section class="profile-tab-panel" data-profile-panel="fundamental" hidden><section class="profile-section profile-stats-section" id="profile-fundamental"><div class="profile-section-head"><h3>Fundamental</h3><span>Valoración y negocio</span></div><div class="profile-stat-list">'+profileFundamentalStats(s)+'</div></section></section>'+
   '<section class="profile-tab-panel" data-profile-panel="technical" hidden><section class="profile-section profile-stats-section" id="profile-technical"><div class="profile-section-head"><h3>Técnico</h3><span>Indicadores cargados</span></div><div class="profile-stat-list">'+profileTechnicalStats(s)+'</div></section></section>'+
   '<section class="profile-tab-panel" data-profile-panel="news" hidden>'+profileNewsPanelHtml(s)+'</section>'+
  '</div>';
}
function renderQuickProfile(){
 let box=$('#stockQuickDetail');if(!box)return;
 let s=state.profileKey?stockByKey(state.profileKey):null;
 if(!s){closeQuickProfile(false);return}
 delete box.dataset.profileChartLoadedKey;
 delete box.dataset.profileAiLoadedKey;
 box.innerHTML=quickProfileHtml(s);
 requestAnimationFrame(()=>{
  observeTrLivePrices(box);
  pollUsLive();
  refreshProfileLiveEvents(s);
  hydrateProfileSupportResistance(box,s,state.profilePreferTr===true);
  if(state.profilePreferTr===true)hydrateProfileTrSessionStats(box,s);
  window.ViewInvAINativeUI?.syncLayout?.();
 });
}
const aiBriefCache=new Map();
let aiChatState={key:null,preferTr:false,history:[],busy:false};

function aiLivePayload(s,preferTr){
 let q=canonicalQuote(s,preferTr);
 return {
  market:q.market,source:q.source,nativeCurrency:q.nativeCurrency,
  price:q.price,eur:q.eur,usd:q.usd,changePct:q.change,
  quoteUpdatedAt:q.updatedAt?new Date(q.updatedAt).toISOString():null,
  eurUsd:q.fx,fxUpdatedAt:q.fxUpdatedAt?new Date(q.fxUpdatedAt).toISOString():null,
  bid:preferTr?N(s&&s.trLiveBid):usLiveBid(s),
  ask:preferTr?N(s&&s.trLiveAsk):usLiveAsk(s)
 };
}
async function aiApiAsk(s,preferTr,question,history=[]){
 if(!window.ViewInvAIAuth||typeof window.ViewInvAIAuth.apiFetch!=='function')throw Error('Inicia sesión para usar la IA avanzada.');
 let user=window.ViewInvAIAuth.getUser&&window.ViewInvAIAuth.getUser();
 if(!user)throw Error('Inicia sesión con Google para usar la IA avanzada.');
 let response=await window.ViewInvAIAuth.apiFetch('/api/ai/chat',{
  method:'POST',
  body:JSON.stringify({
   stockKey:stockKey(s),ticker:s.ticker||'',preferTr:!!preferTr,
   question:String(question||'').slice(0,1200),
   history:(history||[]).slice(-6),
   live:aiLivePayload(s,preferTr)
  })
 });
 let data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'No se pudo consultar la IA.');
 return data;
}
function aiChatAdd(role,html){
 let box=$('#aiChatMessages');if(!box)return;
 let div=document.createElement('div');div.className='ai-chat-message '+role;div.innerHTML=html;box.appendChild(div);box.scrollTop=box.scrollHeight;
}
function aiReplyHtml(data){
 let badges=[];
 if(data.signal)badges.push('<span>'+E(data.signal)+'</span>');
 if(N(data.confidence)!==null)badges.push('<span>'+Math.round(N(data.confidence))+'% confianza</span>');
 if(data.momentum)badges.push('<span>Momentum '+E(data.momentum)+'</span>');
 if(data.fomoRisk)badges.push('<span>FOMO '+E(data.fomoRisk)+'</span>');
 return '<div class="ai-chat-badges">'+badges.join('')+'</div><p>'+E(data.answer||data.summary||'Sin respuesta disponible.').replace(/\n/g,'<br>')+'</p>'+
  (Array.isArray(data.keyPoints)&&data.keyPoints.length?'<ul>'+data.keyPoints.slice(0,5).map(x=>'<li>'+E(x)+'</li>').join('')+'</ul>':'');
}
async function askAiChat(question){
 question=String(question||'').trim();if(!question||aiChatState.busy)return;
 let s=stockByKey(aiChatState.key);if(!s)return;
 aiChatState.busy=true;
 aiChatAdd('user','<p>'+E(question)+'</p>');
 aiChatState.history.push({role:'user',content:question});
 let input=$('#aiChatInput'),send=$('#aiChatSend');
 if(input){input.value='';input.disabled=true}if(send){send.disabled=true;send.textContent='Analizando…'}
 let pending=document.createElement('div');pending.className='ai-chat-message assistant pending';pending.textContent='ViewInvAI está cruzando precio, momentum, técnicos, noticias y catalizadores…';$('#aiChatMessages')?.appendChild(pending);
 try{
  let data=await aiApiAsk(s,aiChatState.preferTr,question,aiChatState.history);
  pending.remove();aiChatAdd('assistant',aiReplyHtml(data));
  aiChatState.history.push({role:'assistant',content:String(data.answer||data.summary||'').slice(0,1800)});
 }catch(e){pending.remove();aiChatAdd('assistant error','<p>'+E(e.message||'No se pudo consultar la IA.')+'</p>')}
 finally{aiChatState.busy=false;if(input){input.disabled=false;input.focus()}if(send){send.disabled=false;send.textContent='Enviar'}}
}
function buildExternalChatGptPrompt(s,preferTr=false){
 let q=canonicalQuote(s,preferTr);
 let events=stockEvents(s)
  .sort((x,y)=>new Date(y.date||0)-new Date(x.date||0))
  .slice(0,8)
  .map(e=>'- '+String(e.date||'').slice(0,10)+' · '+String(e.title||e.fact||'').slice(0,220))
  .join('\n');
 let bid=preferTr?N(s.trLiveBid):usLiveBid(s),ask=preferTr?N(s.trLiveAsk):usLiveAsk(s);
 let market=preferTr?'Trade Republic / '+(s.trExchange||'LSX'):(s.exchange||'EEUU');
 let usSymbol=String((s.exchange||'')+':'+(s.ticker||''));
 let selectedTicker=String(preferTr?(s.trTicker||s.ticker):(s.ticker||'—'));
 let isin=String((preferTr?(s.trIsin||s.isin):(s.usIsin||s.isin))||'—');
 let nowIso=new Date().toISOString();
 let lines=[
  'Quiero un análisis MUY completo, actualizado y contrastado de esta acción y de la empresa. Responde en español. Investiga activamente en la web y no te limites a los datos de referencia que incluyo abajo.',
  '',
  'IDENTIFICACIÓN',
  '- Empresa: '+String(s.name||'—'),
  '- Ticker seleccionado: '+selectedTicker,
  '- Mercado seleccionado: '+market,
  '- Símbolo EEUU: '+usSymbol,
  '- ISIN: '+isin,
  '- Momento de la consulta: '+nowIso,
  '',
  'REFERENCIA INICIAL DE MERCADO (úsala solo como punto de partida y contrástala con datos actuales)',
  '- Precio: '+String(q.price??'—')+' '+String(q.nativeCurrency||''),
  '- Variación: '+String(q.change??'—')+'%',
  '- BID / ASK: '+String(bid??'—')+' / '+String(ask??'—'),
  '- Volumen: '+String(SV(s,currentMarketSession())??s.volume??'—'),
  '- Volumen relativo: '+String(RV(s,currentMarketSession())??'—')+'x',
  '- RSI 14 1D: '+String(s.rsi??'—'),
  '- ADX 14 1D: '+String(s.adx??'—'),
  '- EMA20 1D: '+String(s.ema20??'—'),
  '- EMA50 1D: '+String(s.ema50??'—'),
  '',
  'EVENTOS/NOTICIAS YA DETECTADOS PARA QUE LOS CONTRASTES',
  events||'- Ninguno cargado como referencia.',
  '',
  'HAZ ESTA INVESTIGACIÓN:',
  '1. Cotización actual: precio y hora exacta del dato, cierre anterior, premarket/regular/postmarket si aplica, y cotización LSX/Trade Republic si existe. Distingue datos en tiempo real, diferidos y de sesiones distintas. Incluye BID/ASK, spread, volumen, volumen relativo, liquidez, gaps, pausas o halts si existen.',
  '2. Explica qué está moviendo HOY la cotización. Separa claramente hechos confirmados, hipótesis razonables y rumores. Si no hay catalizador claro, dilo.',
  '3. Revisa noticias de las últimas 24–72 horas y también los últimos 7 días. Prioriza fuentes primarias: web de la empresa/Investor Relations, comunicados oficiales, SEC/EDGAR, reguladores, FDA/ClinicalTrials si aplica y bolsas oficiales. Después contrasta con Reuters, Bloomberg, CNBC, MarketWatch, Barron\'s u otras fuentes financieras reputadas.',
  '4. Revisa filings y estructura de capital: 8-K, 10-Q, 10-K, 6-K, 20-F, S-1, S-3, 424B, ATM, offerings, warrants, convertibles, deuda, ampliaciones, splits/reverse splits, recompras, cambios de acciones en circulación, float, insider transactions y cualquier riesgo de dilución.',
  '5. Analiza negocio y fundamentales: qué hace la empresa, segmentos, clientes, competencia, ingresos, crecimiento, márgenes, EBITDA/beneficio, cash, cash burn/runway, deuda, guidance, valoración, market cap y enterprise value. Señala deterioros o mejoras relevantes.',
  '6. Analiza técnico y microestructura: tendencia en 1D y, si hay datos fiables, 1H/15m; soportes/resistencias, VWAP, medias, RSI, ADX, ATR/volatilidad, máximos/mínimos recientes, volumen por precio, short interest, days-to-cover, borrow fee, disponibilidad de acciones para corto y opciones/IV/flujo si aportan información real.',
  '7. Busca sentimiento y conversación: Stocktwits, Reddit, X/Twitter, Seeking Alpha y otros foros o páginas bursátiles relevantes. Resume el consenso, cambios de sentimiento, temas repetidos y actividad anómala. Trata las redes como opinión/sentimiento, nunca como hecho confirmado.',
  '8. Revisa próximos catalizadores con fecha y hora cuando sea posible: resultados, guidance, conferencias, investor days, FDA/PDUFA, ensayos clínicos, contratos, adjudicaciones, lanzamientos, votaciones societarias, vencimientos, desbloqueos, financiación, litigios, decisiones regulatorias o cualquier evento que pueda mover la acción.',
  '9. Evalúa contexto sectorial, macroeconómico y geopolítico SOLO si afecta materialmente a esta empresa: tipos de interés, inflación, divisas, materias primas, regulación, aranceles, conflictos, elecciones o decisiones gubernamentales relevantes, cadena de suministro y movimientos de competidores.',
  '10. Comprueba consenso de analistas, cambios recientes de precio objetivo/rating y estimaciones, pero distingue claramente opinión de analistas de hechos.',
  '',
  'FORMATO DE LA RESPUESTA:',
  '- Empieza con una foto actual muy breve: precio/sesión, movimiento, volumen y catalizador principal.',
  '- Después: hechos confirmados; noticias/catalizadores; técnico; fundamentales; capital/dilución; sentimiento; macro/sector; riesgos.',
  '- Incluye enlaces y fecha/hora de las fuentes principales. No cuentes copias del mismo comunicado como confirmaciones independientes.',
  '- Señala cualquier dato contradictorio entre fuentes y cuál consideras más fiable.',
  '- Cierra con tres escenarios: alcista, neutral y bajista, indicando qué tendría que ocurrir para validar o invalidar cada uno.',
  '- Termina con una conclusión clara del estado ACTUAL de la empresa y de la cotización, y qué vigilar en las próximas horas, 1–2 días y próximas semanas.',
  '- No inventes precios, noticias, fechas ni rumores. Si un dato no puede verificarse, indícalo expresamente.'
 ];
 return lines.join('\n');
}
async function copyTextForExternalChat(text){
 try{
  if(navigator.clipboard&&window.isSecureContext){
   await navigator.clipboard.writeText(text);
   return true;
  }
 }catch(_){}
 try{
  let ta=document.createElement('textarea');
  ta.value=text;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.opacity='0';ta.style.pointerEvents='none';
  document.body.appendChild(ta);ta.select();ta.setSelectionRange(0,ta.value.length);
  let ok=document.execCommand&&document.execCommand('copy');
  ta.remove();
  return !!ok;
 }catch(_){return false}
}
async function openExternalChatGpt(key,preferTr=false){
 let s=stockByKey(key);if(!s)return;
 let prompt=buildExternalChatGptPrompt(s,preferTr===true&&trTradable(s));
 let target='https://chatgpt.com/?q='+encodeURIComponent(prompt);
 let opened=null;
 // Open synchronously while the click still owns the user gesture. Waiting on
 // the clipboard first can make mobile WebViews treat the new tab as a popup.
 try{opened=window.open(target,'_blank','noopener,noreferrer')}catch(_){}
 let copied=await copyTextForExternalChat(prompt);
 if(opened){
  toast(copied?'ChatGPT abierto con el prompt preparado · también está copiado.':'ChatGPT abierto con el prompt preparado.');
  return;
 }
 try{
  window.location.href=target;
 }catch(_){
  if(copied)toast('No se pudo abrir ChatGPT · prompt copiado.',true);
  else toast('No se pudo abrir ChatGPT.',true);
 }
}

function openAiChat(key,preferTr=false){
 let s=stockByKey(key);if(!s)return;
 if(!window.ViewInvAIAuth?.getUser?.()){window.ViewInvAIAuth?.signIn?.();return}
 aiChatState={key:stockKey(s),preferTr:preferTr===true&&trTradable(s),history:[],busy:false};
 let panel=$('#aiChatPanel'),backdrop=$('#aiChatBackdrop');
 if(!panel||!backdrop)return;
 let ticker=aiChatState.preferTr?(s.trTicker||s.ticker):s.ticker;
 $('#aiChatTitle').textContent='ViewInvAI · '+String(ticker||'');
 $('#aiChatSubtitle').textContent=s.name||'';
 $('#aiChatMessages').innerHTML='';
 aiChatAdd('assistant','<p>Estoy conectado a los datos de esta acción. Puedes preguntarme por entrada, momentum, FOMO, tendencia, noticias, resultados, riesgos o catalizadores.</p>');
 panel.classList.add('open');panel.setAttribute('aria-hidden','false');backdrop.classList.add('open');backdrop.setAttribute('aria-hidden','false');document.body.classList.add('ai-chat-open');
 setTimeout(()=>$('#aiChatInput')?.focus(),30);
}
function closeAiChat(){
 $('#aiChatPanel')?.classList.remove('open');$('#aiChatPanel')?.setAttribute('aria-hidden','true');
 $('#aiChatBackdrop')?.classList.remove('open');$('#aiChatBackdrop')?.setAttribute('aria-hidden','true');
 document.body.classList.remove('ai-chat-open');
}
async function loadAiBrief(root,s,preferTr=false){
 let slot=root&&root.querySelector('[data-ai-auto-key="'+CSS.escape(stockKey(s))+'"]');if(!slot)return;
 if(!window.ViewInvAIAuth?.getUser?.()){slot.innerHTML='<span class="ai-live-dot"></span><span>Inicia sesión para activar el análisis IA automático.</span>';return}
 let cacheKey=stockKey(s)+'|'+(preferTr?'tr':'us'),cached=aiBriefCache.get(cacheKey);
 if(cached&&Date.now()-cached.at<120000){slot.innerHTML=cached.html;return}
 slot.innerHTML='<span class="ai-live-dot thinking"></span><span>IA analizando mercado, tendencia y catalizadores…</span>';
 try{
  let data=await aiApiAsk(s,preferTr,'Genera una lectura rápida y accionable del estado actual: momentum, tendencia, riesgo FOMO, noticia/catalizador principal y qué confirmación faltaría antes de tomar una decisión.',[]);
  let html='<span class="ai-live-dot active"></span><span><b>'+E(data.signal||'LECTURA IA')+(N(data.confidence)!==null?' · '+Math.round(N(data.confidence))+'%':'')+'</b> · '+E(data.summary||data.answer||'Análisis completado.')+'</span>';
  aiBriefCache.set(cacheKey,{at:Date.now(),html});slot.innerHTML=html;
 }catch(e){slot.innerHTML='<span class="ai-live-dot"></span><span>IA avanzada no disponible ahora.</span>'}
}
