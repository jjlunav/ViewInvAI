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
function profileSessionStrip(s,isTr=false){
 let prefix=isTr?'EEUU · ':'';
 // These three session fields come from the US exchange feed. Even on an LSX
 // profile they stay USD-native and EUR is only the current FX conversion.
 let regular='<div class="profile-session-cell"><span>'+prefix+'Regular</span><strong>'+snapshotPricePair(s,s.price,false)+'</strong><b class="'+C(s.changePct)+'">'+PC(s.changePct)+'</b><small>Vol '+compactVol(s.volume)+'</small></div>';
 let pre='<div class="profile-session-cell"><span>'+prefix+'Premarket</span><strong>'+snapshotPricePair(s,s.premarketPrice,false)+'</strong><b class="'+C(s.premarketChangePct)+'">'+PC(s.premarketChangePct)+'</b><small>Vol '+compactVol(s.premarketVolume)+'</small></div>';
 let post='<div class="profile-session-cell"><span>'+prefix+'Postmarket</span><strong>'+snapshotPricePair(s,s.postmarketPrice,false)+'</strong><b class="'+C(s.postmarketChangePct)+'">'+PC(s.postmarketChangePct)+'</b><small>Vol '+compactVol(s.postmarketVolume)+'</small></div>';
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
function profileGeneralStats(s,isTr,se){
 let range=N(s.dayLow)!==null&&N(s.dayHigh)!==null?PR(s.dayLow)+' - '+PR(s.dayHigh):'—';
 let currentPrice=pricePair(s,SP(s,se),isTr),currentChange=liveChangeHtml(s,SC(s,se),isTr);
 return [
  profileKpi(isTr?'Precio LSX':'Precio actual',currentPrice,currentChange),
  profileKpi('Rango día',range,'Mínimo - máximo'),
  profileKpi('BID / ASK',bidAskHtml(s,isTr),isTr?'Trade Republic / LSX':'Feed EEUU'),
  profileKpi('Volumen actual',compactVol(!isTr&&N(s.usLiveVolume)!==null?s.usLiveVolume:SV(s,se)),'Media '+compactVol(s.avgVolume)),
  profileKpi('Volumen promedio',compactVol(s.avgVolume),'10 sesiones'),
  profileKpi('Volumen relativo',RV(s,se)===null?'—':F(RV(s,se),2)+'×','Actividad frente a media'),
  profileKpi('Capitalización',N(s.marketCap)===null?'—':compactVol(s.marketCap),(s.fundamentalCurrency||'USD')),
  profileKpi('Próximos resultados',s.earningsDate?DF(s.earningsDate):'—',s.earningsDate?(eventTime({date:s.earningsDate,timeCode:s.earningsTimeCode})||''):'Sin fecha cargada')
 ].join('');
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
   '<div class="profile-ai-tab-actions"><button type="button" class="btn profile-chatgpt-open" data-chatgpt-stock="'+E(key)+'" data-chatgpt-prefer-tr="'+(isTr?'1':'0')+'">Preguntar a ChatGPT ↗</button></div>'+
   profileAiPanel(s,isTr?'tr':'us')+
  '</section>';
}
function profileDetailRoot(el){
 return el&&el.closest?el.closest('.stock-profile-page,.stock-profile'):null;
}
function activateProfileVisualAnalysis(root,s,preferTr=false){
 if(!root||!s)return;
 const loadKey=stockKey(s)+'|'+(preferTr===true?'tr':'us');
 if(root.dataset.visualAnalysisLoadedKey===loadKey)return;
 root.dataset.visualAnalysisLoadedKey=loadKey;
 requestAnimationFrame(()=>{
  root.querySelectorAll('[data-profile-visual-analysis] .mini-chart').forEach(el=>{
   delete el.dataset.loaded;
   loadMiniChart(el);
  });
  loadAiBrief(root,s,preferTr===true);
 });
}
function setProfileVisualExpanded(button,expanded,focusId=''){
 if(!button)return;
 let root=profileDetailRoot(button),panel=root&&root.querySelector('[data-profile-visual-analysis]');
 if(!root||!panel)return;
 expanded=!!expanded;
 panel.classList.toggle('is-collapsed',!expanded);
 button.setAttribute('aria-expanded',expanded?'true':'false');
 button.textContent=expanded?'▾ Ocultar gráfico y análisis IA':'▸ Mostrar gráfico y análisis IA';
 if(expanded){
  let s=stockByKey(button.dataset.profileVisualKey);
  let preferTr=button.dataset.profileVisualPreferTr==='1';
  if(s)activateProfileVisualAnalysis(root,s,preferTr);
  if(focusId)requestAnimationFrame(()=>root.querySelector('#'+CSS.escape(focusId))?.scrollIntoView({behavior:'smooth',block:'start'}));
 }
}

function profilePortfolioActionHtml(s,isTr=false){
 let key=stockKey(s),api=window.ViewInvAIPortfolios;
 let inPortfolio=!!(api&&typeof api.isInPortfolio==='function'&&api.isInPortfolio(key));
 let label=inPortfolio?'★ Gestionar cartera':'＋ Añadir a cartera';
 return '<button type="button" class="btn small profile-add-portfolio'+(inPortfolio?' is-managed':'')+'" data-add-portfolio-stock="'+E(key)+'" data-add-portfolio-prefer-tr="'+(isTr?'1':'0')+'">'+label+'</button>';
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
function profileHeroHtml(s,isTr=false,opts={}){
 let se=currentMarketSession();
 let title=isTr?(s.trTicker||s.ticker):s.ticker;
 let marketTitle=isTr?'Trade Republic / '+(s.trExchange||'LSX'):(s.exchange||'EEUU');
 let currentChange=liveChangeHtml(s,SC(s,se),isTr);
 let trFresh=isTr&&trMarketOpen()&&N(s.trLiveReceivedAt)!==null&&Date.now()-N(s.trLiveReceivedAt)<60000;
 let liveLabel=isTr?(trFresh?'LSX · EN DIRECTO':trMarketOpen()?'LSX · ÚLTIMO DATO':'LSX · MERCADO CERRADO'):'EEUU · '+(s.usLiveIsRealTime?'NASDAQ ACTUAL':'ÚLTIMO DATO');
 let back='';
 if(opts.backKind==='portfolio')back='<button type="button" class="profile-back-inline" data-portfolio-detail-close>← Atrás</button>';
 else if(opts.backKind==='profile')back='<button type="button" class="profile-back-inline" data-profile-back="'+E(opts.backView||state.currentView)+'">← Atrás</button>';
 else if(opts.backKind==='quick')back='<button type="button" class="profile-back-inline" data-stock-detail-back="1">← Atrás</button>';
 return '<header class="profile-hero investing-profile-header unified-stock-header">'+
   '<div class="unified-stock-header-inner">'+
    (back?'<div class="profile-back-cell">'+back+'</div>':'')+
    '<div class="profile-title">'+favButton(s,isTr)+'<div><div class="profile-market">'+E(marketTitle)+'</div><h2>'+E(title||'—')+'</h2><p>'+E(s.name||'')+'</p></div></div>'+
    '<div class="profile-live"><small>'+E(liveLabel)+'</small><div class="profile-live-main">'+pricePair(s,SP(s,se),isTr)+currentChange+'</div>'+bidAskHtml(s,isTr)+quoteFreshnessHtml(s,isTr,'profile-quote-freshness')+'</div>'+
    (opts.hideActions?'':'<div class="profile-primary-actions">'+
     profilePortfolioActionHtml(s,isTr)+
     '<button type="button" class="btn small profile-ai-open" data-ai-chat-stock="'+E(stockKey(s))+'" data-ai-chat-prefer-tr="'+(isTr?'1':'0')+'">✦ Preguntar IA</button>'+
    '</div>')+
   '</div>'+
  '</header>';
}
function nativeProfileChrome(){
 return document.documentElement.dataset.nativeApp==='1';
}
function profileStickyShellHtml(s,isTr=false,opts={}){
 const hero=profileHeroHtml(s,isTr,opts);
 return nativeProfileChrome()?'<div class="profile-sticky-shell">'+hero+profileTabs()+'</div>':hero;
}
function profileBodyTabsHtml(){
 return nativeProfileChrome()?'':profileTabs();
}
function quickProfileHtml(s,opts={}){
 let requested=opts.preferTr===true?true:opts.preferTr===false?false:state.profilePreferTr===true;
 let isTr=requested&&trTradable(s),se=currentMarketSession();
 let events=stockEvents(s),now=Date.now();
 let upcoming=events.filter(e=>e.eventKind!=='news'&&new Date(e.date).getTime()>=now-864e5).sort((x,y)=>new Date(x.date)-new Date(y.date)).slice(0,4);
 let news=events.filter(e=>e.eventKind==='news').sort((x,y)=>new Date(y.date)-new Date(x.date)).slice(0,6);
 let catalystHtml=upcoming.length?upcoming.map(eventItem).join(''):'<div class="profile-empty">No hay eventos próximos fechados cargados.</div>';
 let newsHtml=news.length?news.map(eventItem).join(''):'<div class="profile-empty">No hay noticias recientes cargadas.</div>';
 let backKind=opts.embedded?'portfolio':'quick';
 return profileStickyShellHtml(s,isTr,{backKind,hideActions:opts.embedded===true})+
  '<div class="unified-profile-body">'+
   profileBodyTabsHtml()+
   '<section class="profile-tab-panel active" data-profile-panel="general">'+profileSessionStrip(s,isTr)+
   '<section class="profile-section profile-stats-section" id="profile-general"><div class="profile-section-head"><h3>Estadísticas clave</h3><span>Datos de mercado</span></div><div class="profile-stat-list">'+profileGeneralStats(s,isTr,se)+'</div></section></section>'+
   profileVisualAnalysisHtml(s,isTr)+
   '<section class="profile-tab-panel" data-profile-panel="fundamental" hidden><section class="profile-section profile-stats-section" id="profile-fundamental"><div class="profile-section-head"><h3>Fundamental</h3><span>Valoración y negocio</span></div><div class="profile-stat-list">'+profileFundamentalStats(s)+'</div></section></section>'+
   '<section class="profile-tab-panel" data-profile-panel="technical" hidden><section class="profile-section profile-stats-section" id="profile-technical"><div class="profile-section-head"><h3>Técnico</h3><span>Indicadores cargados</span></div><div class="profile-stat-list">'+profileTechnicalStats(s)+'</div></section></section>'+
   '<section class="profile-tab-panel" data-profile-panel="news" hidden><section class="profile-section quick-events" id="profile-news"><div class="profile-section-head"><h3>Noticias y catalizadores</h3><span>'+news.length+' noticias · '+upcoming.length+' próximos</span></div><div class="profile-news-grid"><div><h4>Noticias recientes</h4><div class="event-list profile-events">'+newsHtml+'</div></div><div><h4>Próximos catalizadores</h4><div class="event-list profile-events">'+catalystHtml+'</div></div></div></section></section>'+
  '</div>';
}
function renderQuickProfile(){
 let box=$('#stockQuickDetail');if(!box)return;
 let s=state.profileKey?stockByKey(state.profileKey):null;
 if(!s){closeQuickProfile(false);return}
 delete box.dataset.visualAnalysisLoaded;
 delete box.dataset.visualAnalysisLoadedKey;
 box.innerHTML=quickProfileHtml(s);
 requestAnimationFrame(()=>{
  observeTrLivePrices(box);
  pollUsLive();
  window.ViewInvAINativeUI?.syncLayout?.();
 });
}
function renderEmbeddedStockDetail(container,key,reason='',preferTr=null){
 let s=stockByKey(key);if(!container||!s)return false;
 let useTr=preferTr===true&&trTradable(s);
 delete container.dataset.visualAnalysisLoaded;
 delete container.dataset.visualAnalysisLoadedKey;
 container.classList.add('stock-profile-page','embedded-stock-profile');
 container.innerHTML=quickProfileHtml(s,{embedded:true,reason,preferTr:useTr});
 requestAnimationFrame(()=>{observeTrLivePrices(container);pollUsLive()});
 return true;
}
function profileHtml(s,view){
 let isTr=view==='catalog',se=currentMarketSession();
 let title=isTr?(s.trTicker||'Ticker LSX pendiente'):s.ticker;
 let marketTitle=isTr?'Trade Republic / '+(s.trExchange||'LSX'):(s.exchange||'EEUU');
 let relatedUs=(s.exchange||'')+':'+(s.ticker||'');
 let events=stockEvents(s),now=Date.now();
 let upcoming=events.filter(e=>e.eventKind!=='news'&&new Date(e.date).getTime()>=now-864e5).sort((x,y)=>new Date(x.date)-new Date(y.date)).slice(0,20);
 let news=events.filter(e=>e.eventKind==='news').sort((x,y)=>new Date(y.date)-new Date(x.date)).slice(0,30);
 let relationBadge=s.instrumentLinkStatus==='same_isin'
  ?'<span class="relation-status ok">ISIN coincidente</span>'
  :s.instrumentLinkStatus==='different_isin'
   ?'<span class="relation-status warn">ISIN diferente</span>'
   :'<span class="relation-status pending">ISIN pendiente</span>';
 let trRelation=isTr
  ?'<div class="profile-relation"><span>Instrumento TR</span><strong>'+E((s.trExchange||'LSX')+':'+(s.trTicker||'pendiente'))+'</strong><span class="relation-arrow">↔</span><span>Cotización EEUU</span><strong>'+E(relatedUs)+'</strong>'+relationBadge+'</div>'
  :(s.tradeRepublicCandidate?'<div class="profile-relation"><span>Cotización EEUU</span><strong>'+E(relatedUs)+'</strong><span class="relation-arrow">↔</span><span>Trade Republic</span><strong>'+E((s.trExchange||'LSX')+':'+(s.trTicker||'pendiente'))+'</strong>'+relationBadge+'</div>':'');
 let trNote=isTr
  ?'<div class="profile-data-note">Precio principal, BID y ASK: LSX/Trade Republic en €. La referencia en USD se calcula con EUR/USD. Premarket, regular, postmarket y técnicos corresponden a '+E(relatedUs)+'.</div>'
  :'';
 let feedWarning=!isTr
  ?'<div class="profile-feed-warning '+(s.usLiveIsRealTime?'live':'')+'">'+(s.usLiveIsRealTime
    ?'Precio, BID y ASK actuales: Nasdaq.com. TradingView puede diferir ligeramente por proveedor.'
    :'El snapshot del screener EEUU está diferido ('+E(s.updateMode||'sin modo')+'). ViewInvAI intenta sustituir precio, BID y ASK por la cotización actual de Nasdaq.com para los valores visibles.')+'</div>'
  :'';
 let context=state.profileReason?'<div class="profile-context"><strong>Por qué llegaste aquí:</strong> '+E(state.profileReason)+'</div>':'';
 let identity=[
  profileIdentity('Ticker Trade Republic / LSX',s.trTicker||'—',s.trExchange||'LSX'),
  profileIdentity('Ticker EEUU',s.ticker||'—',s.exchange||''),
  profileIdentity('ISIN Trade Republic',s.trIsin||'—'),
  profileIdentity('ISIN EEUU',s.usIsin||s.isin||'—'),
  profileIdentity('WKN',s.trWkn||'—'),
  profileIdentity('Nombre en TR / LSX',s.trNameAtExchange||s.name||'—')
 ].join('');
 let currentChange=liveChangeHtml(s,SC(s,se),isTr);
 let liveLabel=isTr?'LSX · TIEMPO REAL':'EEUU · '+(s.usLiveIsRealTime?'NASDAQ ACTUAL':'ÚLTIMO DATO');
 let upHtml=upcoming.length?upcoming.map(eventItem).join(''):'<div class="profile-empty">No hay eventos futuros fechados cargados para este valor.</div>';
 let newsHtml=news.length?news.map(eventItem).join(''):'<div class="profile-empty">No hay noticias recientes cargadas para este valor.</div>';
 let updated=db.meta.updatedAt?new Date(db.meta.updatedAt).toLocaleString('es-ES'):'—';
 return profileStickyShellHtml(s,isTr,{backKind:'profile',backView:view})+
  '<div class="unified-profile-body">'+
   profileBodyTabsHtml()+
   '<section class="profile-tab-panel active" data-profile-panel="general">'+profileSessionStrip(s,isTr)+
   '<section class="profile-section profile-stats-section" id="profile-general"><div class="profile-section-head"><h3>Estadísticas clave</h3><span>Mercado y sesión</span></div><div class="profile-stat-list">'+profileGeneralStats(s,isTr,se)+'</div></section>'+
   '<section class="profile-section profile-stats-section" id="profile-fundamental"><div class="profile-section-head"><h3>Fundamental</h3><span>Valoración y negocio</span></div><div class="profile-stat-list">'+profileFundamentalStats(s)+'</div></section>'+
   '<section class="profile-section profile-stats-section" id="profile-technical"><div class="profile-section-head"><h3>Técnico</h3><span>Indicadores disponibles</span></div><div class="profile-stat-list">'+profileTechnicalStats(s)+'</div></section></section>'+
   '<section class="profile-tab-panel" data-profile-panel="general-extra"><section class="profile-section profile-identity-section"><div class="profile-section-head"><h3>Identificación y mercados</h3><span>Equivalencias del instrumento</span></div><div class="profile-identity-grid">'+identity+'</div></section></section>'+
   '<section class="profile-tab-panel" data-profile-panel="news" hidden><section class="profile-section" id="profile-news"><div class="profile-section-head"><h3>Noticias y catalizadores</h3><span>'+news.length+' noticias · '+upcoming.length+' próximos</span></div><div class="profile-news-grid"><div><h4>Noticias recientes</h4><div class="event-list profile-events">'+newsHtml+'</div></div><div><h4>Próximos eventos</h4><div class="event-list profile-events">'+upHtml+'</div></div></div></section>'+
   '<section class="profile-section profile-source-section"><div class="profile-section-head"><h3>Contraste y fuentes</h3><span>Origen de cada dato</span></div><div class="source-note">Precio TR: LSX/Trade Republic. Precio EEUU actual: Nasdaq.com cuando está disponible. Gráfico LSX: histórico Trade Republic dibujado por ViewInvAI; gráfico EEUU: TradingView. Noticias y eventos: fuentes enlazadas. ViewInvAI cruza estos datos con su motor multifactor de IA.</div>'+links(s)+'</section>'+
  '</div>';
}
function renderProfileView(view){
 let isTr=view==='catalog',detail=$(isTr?'#catalogDetail':'#catalogUSDetail'),browse=$(isTr?'#catalogBrowse':'#catalogUSBrowse');
 if(!detail||!browse)return false;
 let s=state.profileKey?stockByKey(state.profileKey):null;
 let valid=s&&(isTr?trTradable(s):market(s,'us'));
 if(!valid){detail.classList.add('is-hidden');browse.classList.remove('is-hidden');return false}
 browse.classList.add('is-hidden');detail.classList.remove('is-hidden');detail.classList.add('stock-profile-page');detail.innerHTML=profileHtml(s,view);
 requestAnimationFrame(()=>{observeTrLivePrices(detail);pollUsLive()});
 return true;
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
