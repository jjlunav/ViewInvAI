/*
 * ViewInvAI stock lists
 * ---------------------
 * Shared stock cards plus Home and Entry Radar filtering, ranking and controls.
 */

function rankingWhy(s,next,se,q,pos,preferTr=false){
 if(state.preset==='emerging'){
  let e=emergingSignal(s,se);
  let reasons=['aceleración '+(e.acceleration>=0?'+':'')+F(e.acceleration,2)+' puntos en ~'+F(e.age,0)+' min'];
  if(e.burstPct>=0.1)reasons.push('volumen nuevo '+F(e.burstPct,2)+'% del volumen medio');
  if(e.rv>=1)reasons.push('volumen relativo '+F(e.rv,2)+'×');
  if(e.news)reasons.push('noticia reciente');
  return 'Puesto #'+pos+' por impulso naciente: '+reasons.join(' · ')+'. Variación actual '+PC(e.current)+'.';
 }
 let a=marketChange(s,se,preferTr),b=next?marketChange(next,se,preferTr):null;
 let basis=preferTr&&trMarketOpen()&&trLiveChange(s)!==null?'LSX en tiempo real':SN(se);
 return 'Puesto #'+pos+' por variación porcentual en '+basis+': '+PC(a)+(next?' frente a '+PC(b)+' de #'+(pos+1)+' '+E(next.ticker)+'.':'.')+' El orden se actualiza automáticamente con las cotizaciones.';
}
function why(s,se,preferTr=false){let b=[],c=marketChange(s,se,preferTr),r=RV(s,se);if(c!==null)b.push((preferTr&&trMarketOpen()&&trLiveChange(s)!==null?'LSX':SN(se))+' '+PC(c));if(r!==null)b.push('vol. relativo '+F(r,2)+'×');if(N(s.adx)!==null)b.push('ADX '+F(s.adx,1));if(N(s.rsi)!==null)b.push('RSI '+F(s.rsi,1));if(trend(s))b.push('tendencia compatible');return b.join(' · ')||'Cumple el criterio activo con los datos disponibles.'}
function entryChangeHtml(s,se,preferTr=false){
 let trLive=preferTr&&trMarketOpen()&&trLiveChange(s)!==null,v=marketChange(s,se,preferTr),usLive=!trLive&&se==='regular'&&usLiveChange(s)!==null;
 let attrs=trLive?' data-tr-live-change-key="'+E(stockKey(s))+'"':usLive?' data-us-live-change-key="'+E(stockKey(s))+'"':'';
 return '<span class="quote-change '+C(v)+'"'+attrs+'>'+PC(v)+'</span>';
}
function listInsightLabel(s,se,preferTr=false){
 let rv=RV(s,se),em=emergingSignal(s,se);
 if(em&&em.eligible)return 'IA · impulso naciente';
 if(recentNewsSignal(s,60))return 'IA · noticia reciente';
 if(rv!==null&&rv>=2)return 'IA · volumen inusual';
 if(trendState(s)===true&&marketChange(s,se,preferTr)!==null&&marketChange(s,se,preferTr)>0)return 'IA · tendencia favorable';
 return 'IA · seguimiento';
}
function listSessionQuote(s,se,preferTr=false){
 let price=null,change=null,label='',icon='';
 if(se==='premarket'&&N(s.premarketPrice)!==null){price=s.premarketPrice;change=s.premarketChangePct;label='PRE';icon='☀'}
 else if(se==='postmarket'&&N(s.postmarketPrice)!==null){price=s.postmarketPrice;change=s.postmarketChangePct;label='POST';icon='☾'}
 else if(N(s.premarketPrice)!==null){price=s.premarketPrice;change=s.premarketChangePct;label='PRE';icon='☀'}
 else if(N(s.postmarketPrice)!==null){price=s.postmarketPrice;change=s.postmarketChangePct;label='POST';icon='☾'}
 if(price===null)return '';
 return '<div class="stock-session-quote"><span class="session-icon">'+icon+'</span><small>'+label+'</small><strong>'+snapshotPricePair(s,price,preferTr)+'</strong><span class="'+C(change)+'">'+PC(change)+'</span></div>';
}
const STOCK_MOBILE_GROUPS=[
 {key:'general',label:'General',columns:[['price','Precio'],['change','Variación']]},
 {key:'volume',label:'Volumen',columns:[['volume','Volumen'],['relVolume','Vol. rel.']]},
 {key:'technical',label:'Técnico',columns:[['rsi','RSI'],['adx','ADX']]},
 {key:'trend',label:'Tend.',columns:[['ema20','EMA20'],['ema50','EMA50']]},
 {key:'returns',label:'Rentab.',columns:[['week','1 sem.'],['month','1 mes']]},
 {key:'market',label:'Mercado',columns:[['bid','BID'],['ask','ASK']]},
 {key:'other',label:'Otros',columns:[['exchange','Mercado'],['earnings','Resultados']]}
];
const stockMobileUi={entry:'general'};
function stockCompactListView(){return document.documentElement.dataset.nativeApp==='1'||!!(window.matchMedia&&window.matchMedia('(max-width:820px)').matches)}
function stockMobileGroup(scope='entry'){
 let key=stockMobileUi[scope]||'general';
 return STOCK_MOBILE_GROUPS.find(g=>g.key===key)||STOCK_MOBILE_GROUPS[0];
}
function stockMobileTabs(scope='entry'){
 let active=stockMobileGroup(scope).key;
 return '<nav class="stock-mobile-groups" aria-label="Datos de acciones">'+STOCK_MOBILE_GROUPS.map(g=>
  '<button type="button" class="'+(g.key===active?'active':'')+'" data-stock-mobile-scope="'+E(scope)+'" data-stock-mobile-group="'+E(g.key)+'" aria-pressed="'+(g.key===active?'true':'false')+'">'+E(g.label)+'</button>'
 ).join('')+'</nav>';
}
function stockMobileCell(s,key,se,preferTr=false){
 let v=null,text='—',tone='text';
 if(key==='price'){
  let q=verifiedDisplayQuote(s,preferTr,se),sym=q.nativeCurrency==='EUR'?'€':'\u0024';
  v=N(q.change);text=quoteMoney(q.price,sym,quotePrecision(s,q.nativeCurrency==='EUR',SP(s,se)));
  tone=N(q.price)===null?'muted':v===null?'text':v>=0?'positive':'negative';
  let source=q.fallback?'<small class="asset-quote-source">EEUU ref.</small>':'';
  return{value:text,tone,html:'<span class="asset-price-value">'+E(text)+'</span>'+source};
 }else if(key==='change'){
  let q=verifiedDisplayQuote(s,preferTr,se);v=N(q.change);
  text=PC(v);tone=v===null?'muted':v>=0?'positive':'negative';
 }else if(key==='volume'){
  text=compactVol(preferTr?SV(s,se):(N(s.usLiveVolume)??SV(s,se)));
 }else if(key==='relVolume'){
  v=RV(s,se);text=v===null?'—':F(v,2)+'×';
 }else if(key==='rsi'){
  v=N(s.rsi);text=v===null?'—':F(v,1);
 }else if(key==='adx'){
  v=N(s.adx);text=v===null?'—':F(v,1);
 }else if(key==='ema20'){
  v=N(s.ema20);text=v===null?'—':PR(v);
 }else if(key==='ema50'){
  v=N(s.ema50);text=v===null?'—':PR(v);
 }else if(key==='week'){
  v=N(s.perfWeek);text=PC(v);tone=v===null?'muted':v>=0?'positive':'negative';
 }else if(key==='month'){
  v=N(s.perfMonth);text=PC(v);tone=v===null?'muted':v>=0?'positive':'negative';
 }else if(key==='bid'){
  v=preferTr?N(s.trLiveBid):usLiveBid(s);text=quoteMoney(v,preferTr?'€':'\u0024',quotePrecision(s,preferTr));
 }else if(key==='ask'){
  v=preferTr?N(s.trLiveAsk):usLiveAsk(s);text=quoteMoney(v,preferTr?'€':'\u0024',quotePrecision(s,preferTr));
 }else if(key==='exchange'){
  text=preferTr?String(s.trExchange||'LSX'):String(s.exchange||'EEUU');
 }else if(key==='earnings'){
  text=s.earningsDate?DF(s.earningsDate):'—';
 }
 return{value:text,tone};
}
function stockMobileRow(s,i,se,preferTr=false,scope='entry'){
 return standardStockCard(s,i,{se,preferTr,context:scope,detailsHtml:''});
}
function stockMobileList(rows,se,preferTr=false,scope='entry'){
 return '<div class="stock-mobile-rows unified-asset-list">'+rows.map((s,i)=>stockMobileRow(s,i,se,preferTr,scope)).join('')+'</div>';
}

function regularQuoteCell(s){
 const price=N(s.price),ch=N(s.changePct);
 return{label:'Precio REG',value:price===null?'—':quoteMoney(price,'\u0024',quotePrecision(s,false,price)),tone:ch===null?'muted':C(ch)};
}
function regularChangeCell(s){
 const ch=N(s.changePct);return{label:'Variación',value:PC(ch),tone:ch===null?'muted':C(ch)};
}
function sessionCompactCell(s,se=currentMarketSession()){
 let label='REG',price=N(s.price),change=N(s.changePct);
 if(se==='premarket'){
  label='PRE';price=N(s.premarketPrice);change=N(s.premarketChangePct);
  if(change===null&&price!==null&&N(s.price)>0)change=(price/N(s.price)-1)*100;
 }else if(se==='postmarket'){
  label='POST';price=N(s.postmarketPrice);change=N(s.postmarketChangePct);
  if(change===null&&price!==null&&N(s.price)>0)change=(price/N(s.price)-1)*100;
 }else if(se==='regular'){
  price=usLivePrice(s)??N(s.price);change=usLiveChange(s)??N(s.changePct);
 }else{
  label='CIERRE';
 }
 const tone=change===null?'muted':C(change);
 const priceText=price===null?'—':quoteMoney(price,'\u0024',quotePrecision(s,false,price));
 return{label,value:priceText+' · '+PC(change),tone,
  html:'<span class="asset-session-price">'+E(priceText)+'</span><small class="asset-session-change '+tone+'">'+E(PC(change))+'</small>'};
}
function effectiveSessionChange(s,se=currentMarketSession()){
 if(se==='premarket'){
  let ch=N(s.premarketChangePct),p=N(s.premarketPrice),r=N(s.price);
  return ch!==null?ch:(p!==null&&r>0?(p/r-1)*100:null);
 }
 if(se==='postmarket'){
  let ch=N(s.postmarketChangePct),p=N(s.postmarketPrice),r=N(s.price);
  return ch!==null?ch:(p!==null&&r>0?(p/r-1)*100:null);
 }
 if(se==='regular')return usLiveChange(s)??N(s.changePct);
 return N(s.changePct);
}

function standardStockCard(s,i=0,opts={}){
 let se=opts.se||currentMarketSession(),preferTr=opts.preferTr===true,ticker=preferTr?(s.trTicker||s.ticker):(s.ticker||s.trTicker);
 let hint=opts.hint||why(s,se,preferTr),rank=opts.rankLabel!==undefined?opts.rankLabel:'#'+(i+1);
 let cells=[regularQuoteCell(s),regularChangeCell(s),sessionCompactCell(s,se)];
 let details=opts.detailsHtml;
 if(details===undefined){
  let rv=RV(s,se);
  details='<p>'+E(opts.insight||listInsightLabel(s,se,preferTr))+'</p>'+quoteFreshnessHtml(s,preferTr)+listSessionQuote(s,se,preferTr)+bidAskHtml(s,preferTr)+
   '<div class="asset-card-metrics"><span>Vol <b>'+compactVol(SV(s,se))+'</b></span><span>RV <b>'+(rv===null?'—':F(rv,2)+'×')+'</b></span><span>RSI <b>'+F(s.rsi,0)+'</b></span><span>ADX <b>'+F(s.adx,0)+'</b></span></div>'+(opts.contextHtml||'');
 }
 return window.ViewInvAICards.render({
  context:opts.context||state.currentView||'stock',title:s.name||ticker||'—',rank,
  isin:preferTr?(s.trIsin||s.isin||s.usIsin):(s.usIsin||s.isin||s.trIsin),
  subtitle:opts.subtitle||[ticker,preferTr?(s.trExchange||'LSX'):(s.exchange||'EEUU')].filter(Boolean).join(' · '),
  leadingHtml:favButton(s,preferTr),cells,
  openAttrs:opts.openAttrs!==undefined?opts.openAttrs:stockOpenAttrs(s,hint,preferTr),
  detailsHtml:details,detailsLabel:opts.detailsLabel,detailsClass:opts.detailsClass||'stock-card-details',
  metaHtml:opts.metaHtml||'',actionsHtml:opts.actionsHtml,className:opts.className
 });
}
function card(s,i,se=SES(),dense=false,rankText='',preferTr=false){
 return standardStockCard(s,i,{se,dense,preferTr,hint:rankText||why(s,se)});
}
function market(s,m){let ex=String(s.exchange||'').toUpperCase();return m==='tr'?trTradable(s):m==='us'?['NASDAQ','NYSE','AMEX','NYSE ARCA','NYSEARCA'].includes(ex):true}
function numInput(id,fallback,min=-Infinity,max=Infinity){let v=N($('#'+id).value);if(v===null)v=fallback;return Math.max(min,Math.min(max,v))}
function fromUI(){
 let minChange=numInput('minChange',0,-100,100000),maxChange=numInput('maxChange',0,0,100000);
 let minRsi=numInput('minRsi',0,0,100),maxRsi=numInput('maxRsi',100,0,100);
 if(maxChange>0&&maxChange<minChange)maxChange=minChange;
 if(maxRsi<minRsi)maxRsi=minRsi;
 return{minChange,maxChange,minRelVolume:numInput('minRelVolume',0,0,100000),minAdx:numInput('minAdx',0,0,100),
  minRsi,maxRsi,minVolume:numInput('minVolume',0,0,1e15),trend:$('#requireTrend').checked,
  illiquid:$('#excludeIlliquid').checked,sort:state.filters.sort};
}
function lockCriterion(id,locked=true){let input=$('#'+id),btn=$('.field-lock[data-target="'+id+'"]');if(!input||!btn)return;input.readOnly=locked;btn.classList.toggle('unlocked',!locked);btn.textContent=locked?'🔒':'🔓';btn.title=locked?'Desbloquear este parámetro':'Bloquear este parámetro';btn.setAttribute('aria-label',locked?'Desbloquear '+id:'Bloquear '+id)}
function lockAllCriteria(){['minChange','maxChange','minRelVolume','minAdx','minRsi','maxRsi','minVolume'].forEach(id=>lockCriterion(id,true))}
function toUI(x){['minChange','maxChange','minRelVolume','minAdx','minRsi','maxRsi','minVolume'].forEach(k=>$('#'+k).value=x[k]);$('#requireTrend').checked=!!x.trend;$('#excludeIlliquid').checked=!!x.illiquid}
function entryUniverseMatch(s){
 if(state.entryMarket==='tr')return trTradable(s);
 return market(s,'us')&&!trTradable(s);
}
function entrySessionForPreset(){
 // Presets alter thresholds/sorting, never the clock. All screens share the
 // same market session unless the user explicitly changes the session control.
 return state.session==='auto'?currentMarketSession():state.session;
}
function previousSessionChange(s,se){
 if(se==='premarket')return N(s.previousPremarketChangePct);
 if(se==='postmarket')return N(s.previousPostmarketChangePct);
 return N(s.previousChangePct);
}
function previousSessionVolume(s,se){
 if(se==='premarket')return N(s.previousPremarketVolume);
 if(se==='postmarket')return N(s.previousPostmarketVolume);
 return N(s.previousVolume);
}
function recentNewsSignal(s,minutes=45){
 let now=Date.now(),windowMs=minutes*60000;
 return stockEvents(s).some(e=>{
  if(e.eventKind!=='news')return false;
  let t=new Date(e.date).getTime();
  return Number.isFinite(t)&&t<=now+60000&&t>=now-windowMs;
 });
}
function emergingSignal(s,se){
 let current=FC(s,se),previous=previousSessionChange(s,se),age=N(s.momentumSnapshotMinutes);
 if(current===null||previous===null||age===null||age<1||age>20)return{eligible:false,score:-Infinity};
 let acceleration=current-previous;
 let volume=SV(s,se),previousVolume=previousSessionVolume(s,se),avg=N(s.avgVolume);
 let volumeAdded=volume!==null&&previousVolume!==null?Math.max(0,volume-previousVolume):0;
 let burstPct=avg&&avg>0?volumeAdded/avg*100:0;
 let rv=RV(s,se)??0;
 let news=recentNewsSignal(s,45);
 let supportingActivity=burstPct>=0.8||rv>=1.5||news;
 // This is deliberately an early detector, not a "most exploded" list:
 // it requires positive acceleration now and rejects already very extended moves.
 let eligible=current>0&&current<=12&&acceleration>=0.20&&supportingActivity;
 let score=acceleration*22+Math.min(24,burstPct*3)+Math.min(16,Math.max(0,rv-1)*8)+(news?20:0)+Math.max(0,12-current)*0.35;
 return{eligible,score,acceleration,burstPct,rv,news,age,current};
}
const entryOpportunityScores=new Map();
let entryCandidatePoolCount=0;
function entryOpportunityAnalysis(s,se,preferTr=false){
 const quote=verifiedDisplayQuote(s,preferTr,se);
 const input={
  price:N(quote&&quote.price),
  change:N(quote&&quote.change),
  volume:SV(s,se),
  avgVolume:N(s.avgVolume),
  relVolume:RV(s,se),
  rsi:N(s.rsi),
  adx:N(s.adx),
  ema20:N(s.ema20),
  ema50:N(s.ema50),
  perfWeek:N(s.perfWeek),
  perfMonth:N(s.perfMonth),
  spread:spreadPct(s,preferTr),
  bid:preferTr?N(s.trLiveBid):usLiveBid(s),
  ask:preferTr?N(s.trLiveAsk):usLiveAsk(s),
  eventsCount:stockEvents(s).length
 };
 let base=window.ViewInvAIScore&&typeof window.ViewInvAIScore.analyze==='function'
  ?window.ViewInvAIScore.analyze(input,stockEvents(s))
  :{score:50,quality:{score:50},catalystDelta:0};
 let emerging=emergingSignal(s,se);
 let trendBonus=trendState(s)===true?6:0;
 let accelerationBonus=emerging&&Number.isFinite(emerging.score)?Math.max(0,Math.min(12,emerging.score/8)):0;
 let quality=N(base.quality&&base.quality.score)??0;
 let riskPenalty=lowLiquidity(s,se,preferTr)?14:0;
 let score=Math.max(0,Math.min(100,(N(base.score)??50)+trendBonus+accelerationBonus-riskPenalty));
 return{score,base,quality,emerging,quote};
}
function entryOpportunityWhy(s,se,preferTr=false,pos=1){
 const a=entryOpportunityScores.get(stockKey(s));
 if(!a)return rankingWhy(s,null,se,state.filters,pos,preferTr);
 let reasons=[];
 if(a.emerging&&a.emerging.eligible)reasons.push('impulso naciente');
 if(trendState(s)===true)reasons.push('tendencia');
 let rv=RV(s,se);if(rv!==null&&rv>=1.2)reasons.push('volumen '+F(rv,2)+'×');
 if((N(a.base&&a.base.catalystDelta)??0)>0)reasons.push('catalizador');
 if(recentNewsSignal(s,90))reasons.push('noticia reciente');
 return '#'+pos+' · oportunidad '+F(a.score,0)+'/100'+(reasons.length?' · '+reasons.join(' · '):'');
}
function entry(){
 let q=state.filters,se=entrySessionForPreset(),preferTr=state.entryMarket==='tr',emerging=state.preset==='emerging';
 let pool=db.stocks.filter(entryUniverseMatch).filter(s=>{
  let displayQuote=verifiedDisplayQuote(s,preferTr,se);
  if(N(displayQuote&&displayQuote.price)===null)return false;
  let ch=N(displayQuote&&displayQuote.change);if(ch===null||ch<q.minChange)return false;if(q.maxChange>0&&ch>q.maxChange)return false;
  let rv=RV(s,se);if(q.minRelVolume>0&&(rv===null||rv<q.minRelVolume))return false;
  let adx=N(s.adx);if(q.minAdx>0&&(adx===null||adx<q.minAdx))return false;
  let rsi=N(s.rsi);if((q.minRsi>0||q.maxRsi<100)&&(rsi===null||rsi<q.minRsi||rsi>q.maxRsi))return false;
  let v=SV(s,se);if(q.minVolume>0&&(v===null||v<q.minVolume))return false;
  if(q.trend&&trendState(s)!==true)return false;
  if(q.illiquid&&lowLiquidity(s,se,preferTr))return false;
  if(emerging&&!emergingSignal(s,se).eligible)return false;
  return true;
 });
 entryCandidatePoolCount=pool.length;
 entryOpportunityScores.clear();
 let ranked=pool.map(s=>{
  let a=entryOpportunityAnalysis(s,se,preferTr);entryOpportunityScores.set(stockKey(s),a);return{s,a};
 }).filter(x=>x.a.quality>=45).sort((a,b)=>b.a.score-a.a.score||String(a.s.ticker||'').localeCompare(String(b.s.ticker||'')));
 let maxResults=state.preset==='exploded'||state.preset==='premarketExplosion'||state.preset==='postmarketExplosion'?10:15;
 return[ranked.slice(0,maxResults).map(x=>x.s),se];
}

function homeSession(){
 let se=currentMarketSession();return['premarket','regular','postmarket'].includes(se)?se:'regular';
}
function homeDailyChange(s){return effectiveSessionChange(s,homeSession())}
function homeUniverse(){
 return (db.stocks||[]).filter(s=>stockKey(s)&&(N(s.price)!==null||trTradable(s)));
}
function homeUserViewedStocks(limit=10){
 let universe=homeUniverse(),ranked=universe.filter(s=>stockViewCount(s)>0).sort((a,b)=>stockViewCount(b)-stockViewCount(a)||((stockViews[stockKey(b)]?.last||0)-(stockViews[stockKey(a)]?.last||0)));
 return ranked.slice(0,limit);
}
let attentionRankingRows=[],attentionRankingAt=0,attentionRankingLoading=false;
async function refreshAttentionRanking(force=false){
 if(attentionRankingLoading)return;
 if(!force&&attentionRankingAt&&Date.now()-attentionRankingAt<15*60000)return;
 attentionRankingLoading=true;
 try{
  let r=await fetch('/api/attention-ranking?kind=stocks',{cache:'no-store'});if(!r.ok)throw Error(String(r.status));
  let data=await r.json();attentionRankingRows=Array.isArray(data.items)?data.items:[];attentionRankingAt=Date.now();
  if(state.currentView==='home'&&marketBoardMode==='active')renderHome();
 }catch(e){console.warn('Precomputed stock attention ranking unavailable',e)}
 finally{attentionRankingLoading=false}
}
async function refreshSocialTrending(force=false){return refreshAttentionRanking(force)}
function homeActiveStocks(limit=10){
 const universe=homeUniverse(),byTicker=new Map(),byKey=new Map();
 for(const s of universe){
  byKey.set(stockKey(s),s);
  for(const t of [s.ticker,s.trTicker])if(t)byTicker.set(String(t).toUpperCase(),s);
 }
 const out=[],used=new Set();
 for(const row of attentionRankingRows){
  const key=String(row.stockKey||'').toUpperCase(),ticker=String(row.symbol||row.ticker||'').toUpperCase();
  const s=byKey.get(key)||byTicker.get(ticker);if(!s)continue;
  const k=stockKey(s);if(used.has(k))continue;used.add(k);out.push(s);if(out.length>=limit)break;
 }
 if(out.length<limit){
  const now=Date.now();
  const fallback=universe.filter(s=>!used.has(stockKey(s))).map(s=>{
   const news=stockEvents(s).filter(e=>e.eventKind==='news'&&now-new Date(e.date||0).getTime()<=48*3600000).length;
   return{s,score:news*25+(RV(s,homeSession())??0)*3};
  }).sort((a,b)=>b.score-a.score).map(x=>x.s);
  out.push(...fallback.slice(0,limit-out.length));
 }
 return out.slice(0,limit);
}
function homeMoveStocks(desc=true,limit=10){
 let se=homeSession();
 return homeUniverse().map(s=>({s,ch:effectiveSessionChange(s,se)}))
  .filter(x=>x.ch!==null&&(desc?x.ch>0:x.ch<0)).sort((a,b)=>desc?b.ch-a.ch:a.ch-b.ch).slice(0,limit).map(x=>x.s);
}
function homeStockRow(s,i,kind){
 let preferTr=trTradable(s),se=homeSession();
 let hint=kind==='views'?'Visto esta semana':(kind==='active'?'Atención y popularidad de mercado':kind==='gainers'?'Mayor subida de la sesión':'Mayor bajada de la sesión');
 let insight=kind==='views'?'Visto esta semana':kind==='active'?'Atención de mercado':kind==='gainers'?'Subida · '+SN(se):'Bajada · '+SN(se);
 let ticker=preferTr?(s.trTicker||s.ticker):(s.ticker||s.trTicker);
 let exchange=preferTr?(s.trExchange||'LSX'):(s.exchange||'EEUU');
 return standardStockCard(s,i,{
  se,preferTr,hint,context:'home',className:'home-investing-card',
  detailsHtml:'',subtitle:[ticker,exchange,insight].filter(Boolean).join(' · ')
 });
}
function homePanel(title,subtitle,stocks,kind,tone){
 return '<section class="home-market-panel '+tone+'"><header><div><h2>'+E(title)+'</h2><p>'+E(subtitle)+'</p></div><span>'+stocks.length+'</span></header>'+
  '<div class="home-stock-list">'+(stocks.length?stocks.map((s,i)=>homeStockRow(s,i,kind)).join(''):'<div class="home-empty">Sin datos disponibles todavía.</div>')+'</div></section>';
}
let marketBoardMode='active';
function marketBoardStocks(mode='active',limit=10){
 if(mode==='gainers')return homeMoveStocks(true,limit);
 if(mode==='losers')return homeMoveStocks(false,limit);
 return homeActiveStocks(limit);
}
function renderMarketQuickSheet(){
 let box=$('#marketQuickContent');if(!box)return;
 let views=homeUserViewedStocks(10);
 box.innerHTML='<section class="weekly-viewed-section">'+(views.length?views.map((s,i)=>homeStockRow(s,i,'views')).join(''):'<div class="empty-state compact">Todavía no has visitado activos esta semana.</div>')+'</section>';
}
async function renderIndicesTop10(box){
 box.innerHTML='<div class="empty-state compact">Actualizando índices…</div>';
 try{
  let [liveResp,rankResp]=await Promise.all([
   fetch('/api/indices-live',{cache:'no-store'}),
   fetch('/api/attention-ranking?kind=indices',{cache:'no-store'}).catch(()=>null)
  ]);
  if(!liveResp.ok)throw Error(String(liveResp.status));
  let data=await liveResp.json(),rows=Array.isArray(data.indices)?data.indices:[];
  if(rankResp&&rankResp.ok){
   let ranking=await rankResp.json(),order=new Map((ranking.items||[]).map((x,i)=>[String(x.symbol||'').toUpperCase(),i]));
   rows=rows.slice().sort((a,b)=>(order.get(String(a.symbol||'').toUpperCase())??999)-(order.get(String(b.symbol||'').toUpperCase())??999));
  }
  rows=rows.slice(0,10);
  box.innerHTML=rows.length?'<div class="market-board-list">'+rows.map((x,i)=>{
   let ch=N(x.change),tone=ch===null?'muted':C(ch);
   return window.ViewInvAICards.render({context:'indices',title:x.name||x.symbol||'Índice',rank:'#'+(i+1),subtitle:[x.symbol,x.exchange].filter(Boolean).join(' · '),
    cells:[{label:'Precio',value:PR(x.price),tone},{label:'Variación',value:PC(ch),tone}],className:'index-compact-card'});
  }).join('')+'</div>':'<div class="empty-state">Ranking de índices en actualización.</div>';
 }catch(e){box.innerHTML='<div class="empty-state">No se pudieron actualizar los índices ahora mismo.</div>'}
}
function renderHome(){
 let box=$('#homeGroups');if(!box)return;
 if(marketBoardMode==='funds'){
  box.innerHTML='<div class="empty-state compact">Cargando Top 10 de fondos y ETFs…</div>';
  window.ViewInvAIFunds?.renderMarketTop10?.(box,10);
 }else if(marketBoardMode==='indices'){
  renderIndicesTop10(box);
 }else{
  let rows=marketBoardStocks(marketBoardMode,10);
  box.innerHTML=rows.length
   ?'<div class="market-board-list">'+rows.map((s,i)=>homeStockRow(s,i,marketBoardMode==='gainers'?'gainers':marketBoardMode==='losers'?'losers':'active')).join('')+'</div>'
   :'<div class="empty-state">No hay datos de mercado disponibles.</div>';
 }
 let se=homeSession();
 if($('#homeSession'))$('#homeSession').textContent=SN(se)+' · Top 10';
 if($('#homeUpdated'))$('#homeUpdated').textContent=db.meta.updatedAt?'Datos '+new Date(db.meta.updatedAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'Actualizando…';
 renderMarketQuickSheet();
 if(marketBoardMode==='active')setTimeout(()=>refreshSocialTrending(false),0);
}

function renderEntry(){
 let [a,se]=entry();
 $('#entrySessionText').textContent=(state.entryMarket==='tr'?'Trade Republic':'Resto EEUU')+' · '+SN(se);
 $('#entryCount').textContent=a.length+' seleccionadas · '+entryCandidatePoolCount+' analizadas';
 $('#entryUpdated').textContent=db.meta.updatedAt?'datos '+new Date(db.meta.updatedAt).toLocaleString('es-ES'):'sin actualización';
 let shown=a;
 $('#entryResults').innerHTML=shown.length
  ?(stockCompactListView()
    ?stockMobileList(shown,se,state.entryMarket==='tr','entry')
    :shown.map((s,i)=>card(s,i,se,false,entryOpportunityWhy(s,se,state.entryMarket==='tr',i+1),state.entryMarket==='tr')).join(''))
  :'<div class="empty-state">No hay candidatas con este criterio y sesión. Prueba otro preset o abre Configurar criterio para ver los umbrales activos.</div>';
}

window.ViewInvAIMarketBoard={refreshSocialTrending,refreshAttentionRanking,renderMarketQuickSheet};

function initStockListInteractions(){
 document.addEventListener('click',e=>{
  let board=e.target.closest&&e.target.closest('[data-market-board]');
  if(!board)return;
  let mode=board.dataset.marketBoard;
  marketBoardMode=mode||'active';
  document.querySelectorAll('[data-market-board]').forEach(b=>b.classList.toggle('active',b===board));
  renderHome();
 });

 document.addEventListener('click',e=>{
  let tab=e.target.closest&&e.target.closest('[data-stock-mobile-group]');
  if(!tab)return;
  let scope=tab.dataset.stockMobileScope||'entry';
  stockMobileUi[scope]=tab.dataset.stockMobileGroup||'general';
  if(scope==='entry')renderEntry();
 });
 $('#sessionSelect').addEventListener('change',e=>{state.session=e.target.value;saveUiState();renderEntry();setTimeout(pollUsLive,0)});
 function setPreset(value){
  state.preset=value;$('#presetSelect').value=value;
  let opt=$('.preset-option[data-value="'+value+'"]');
  if(opt){$('#presetLabel').textContent=opt.querySelector('span').textContent;document.querySelectorAll('.preset-option').forEach(x=>x.classList.toggle('active',x===opt))}
  state.filters=value==='custom'?(savedCustomPreset()||Object.assign({},state.filters)):preset(value);
  if(state.preset==='postmarketExplosion'){state.session='postmarket';$('#sessionSelect').value='postmarket'}
  else if(state.preset==='premarketExplosion'){state.session='premarket';$('#sessionSelect').value='premarket'}
  else if(state.preset==='emerging'){state.session='auto';$('#sessionSelect').value='auto'}
  toUI(state.filters);lockAllCriteria();saveUiState();renderEntry();setTimeout(pollUsLive,0);
 }
 $('#presetSelect').addEventListener('change',e=>setPreset(e.target.value));
 $('#presetTrigger').addEventListener('click',e=>{e.stopPropagation();let open=$('#presetPicker').classList.toggle('open');$('#presetTrigger').setAttribute('aria-expanded',open?'true':'false')});
 $$('.preset-option').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();setPreset(b.dataset.value);$('#presetPicker').classList.remove('open');$('#presetTrigger').setAttribute('aria-expanded','false')}));
 document.addEventListener('click',e=>{if(!$('#presetPicker').contains(e.target)){$('#presetPicker').classList.remove('open');$('#presetTrigger').setAttribute('aria-expanded','false')}});
 $('#applyFilters').addEventListener('click',()=>{state.filters=fromUI();let l=$('#entryFilterLabel');if(l)l.textContent='Cambiar filtro';renderEntry();setTimeout(pollUsLive,0)});
 $('#resetFilters').addEventListener('click',()=>{
  state.filters=state.preset==='custom'?(savedCustomPreset()||preset('broad')):preset(state.preset);
  toUI(state.filters);lockAllCriteria();renderEntry();setTimeout(pollUsLive,0);
 });
 $('#saveCustomFilters').addEventListener('click',()=>{
  let q=fromUI();q.sort=state.filters.sort==='change'?'change':'score';
  if(saveCustomPreset(q)){
   state.filters=q;state.preset='custom';$('#presetSelect').value='custom';
   let opt=$('.preset-option[data-value="custom"]');
   if(opt){$('#presetLabel').textContent=opt.querySelector('span').textContent;document.querySelectorAll('.preset-option').forEach(x=>x.classList.toggle('active',x===opt))}
   renderEntry();setTimeout(pollUsLive,0);
  }
 });
 $('#toggleFilters')?.addEventListener('click',()=>window.ViewInvAIFilterSheet?.open?.('#entryFilterPanel','Filtro · Radar de entrada'));
 $$('.field-lock').forEach(btn=>btn.addEventListener('click',()=>{let id=btn.dataset.target,input=$('#'+id);lockCriterion(id,!input.readOnly);if(!input.readOnly){input.focus();input.select()}}));
 $$('[data-tab-group="entryMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{state.entryMarket=b.dataset.tab;$$('[data-tab-group="entryMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));saveUiState();renderEntry();setTimeout(pollUsLive,0)}));
}
