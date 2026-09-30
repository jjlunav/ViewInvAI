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
 let basis=preferTr&&trLiveChange(s)!==null?'LSX':SN(se);
 return 'Puesto #'+pos+' por variación porcentual en '+basis+': '+PC(a)+(next?' frente a '+PC(b)+' de #'+(pos+1)+' '+E(next.ticker)+'.':'.')+' El orden se actualiza automáticamente con las cotizaciones.';
}
function why(s,se,preferTr=false){let b=[],c=marketChange(s,se,preferTr),r=RV(s,se);if(c!==null)b.push((preferTr&&trLiveChange(s)!==null?'LSX':SN(se))+' '+PC(c));if(r!==null)b.push('vol. relativo '+F(r,2)+'×');if(N(s.adx)!==null)b.push('ADX '+F(s.adx,1));if(N(s.rsi)!==null)b.push('RSI '+F(s.rsi,1));if(trend(s))b.push('tendencia compatible');return b.join(' · ')||'Cumple el criterio activo con los datos disponibles.'}
function entryChangeHtml(s,se,preferTr=false){
 let trLive=preferTr&&trLiveChange(s)!==null,v=marketChange(s,se,preferTr),usLive=!preferTr&&se==='regular'&&usLiveChange(s)!==null;
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
 if(preferTr)return '';
 const ext=extendedSessionDisplay(s,se);
 if(ext.price===null)return '';
 return '<div class="stock-session-quote"><span class="session-icon '+ext.iconClass+'" aria-hidden="true">'+ext.icon+'</span><strong>'+snapshotPricePair(s,ext.price,false)+'</strong><span class="'+ext.tone+'">'+PC(ext.change)+'</span></div>';
}

const STOCK_MOBILE_GROUPS=[
 {key:'general',label:'General',columns:[['price','Precio'],['change','Variación']]},
 {key:'volume',label:'Volumen',columns:[['volume','Volumen'],['relVolume','Vol. rel.']]},
 {key:'technical',label:'Técnico',columns:[['rsi','RSI'],['adx','ADX']]},
 {key:'trend',label:'Tend.',columns:[['ema20','EMA20'],['ema50','EMA50']]},
 {key:'returns',label:'Rentab.',columns:[['week','1 sem.'],['month','1 mes']]},
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
  let q=preferTr?canonicalQuote(s,true):verifiedDisplayQuote(s,false,se),sym=q.nativeCurrency==='EUR'?'€':'\u0024';
  v=N(q.change);text=quoteMoney(q.price,sym,quotePrecision(s,q.nativeCurrency==='EUR',SP(s,se)));
  tone=N(q.price)===null?'muted':v===null?'text':v>=0?'positive':'negative';
  let source=q.fallback?'<small class="asset-quote-source">EEUU ref.</small>':'';
  return{value:text,tone,html:'<span class="asset-price-value">'+E(text)+'</span>'+source};
 }else if(key==='change'){
  let q=preferTr?canonicalQuote(s,true):verifiedDisplayQuote(s,false,se);v=N(q.change);
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

function sessionQuoteTimestamp(value,now=Date.now()){
 if(value===null||value===undefined||value==='')return null;
 let timestamp=null;
 if(typeof value==='number'||(typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value.trim()))){
  const number=Number(value);timestamp=number<1e12?number*1000:number;
 }else if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)){
  timestamp=Date.parse(value);
 }
 return Number.isFinite(timestamp)&&timestamp>0&&timestamp<=now+60000?timestamp:null;
}
function selectExtendedSessionQuote(s,se=currentMarketSession(),now=Date.now()){
 const quotes=['premarket','postmarket'].map(kind=>({
  kind,price:N(s[kind+'Price']),change:N(s[kind+'ChangePct']),at:sessionQuoteTimestamp(s[kind+'Time'],now)
 })).filter(q=>q.price!==null&&q.price>0);
 if(se==='premarket'||se==='postmarket')return quotes.find(q=>q.kind===se)||null;
 if(quotes.length<2)return quotes[0]||null;
 if(quotes.some(q=>q.at===null)||quotes[0].at===quotes[1].at)return null;
 return quotes.reduce((latest,q)=>q.at>latest.at?q:latest);
}
function extendedSessionDisplay(s,se=currentMarketSession()){
 const quote=selectExtendedSessionQuote(s,se),regular=N(s.price);
 if(!quote)return{icon:'',iconClass:'',price:null,regular,delta:null,change:null,tone:'muted',kind:null,at:null};
 const usePost=quote.kind==='postmarket',icon=usePost?'☾︎':'☀︎',iconClass=usePost?'session-icon-moon':'session-icon-sun';
 const price=quote.price,delta=price!==null&&regular!==null?price-regular:null;
 const change=price!==null&&regular>0?(price/regular-1)*100:null;
 return{icon,iconClass,price,regular,delta,change,tone:change===null?'muted':C(change),kind:quote.kind,at:quote.at};
}
function regularQuoteCell(s,se=currentMarketSession(),preferTr=false){
 if(preferTr&&trTradable(s)){
  const q=canonicalQuote(s,true),price=N(q.price),change=N(q.change),text=quoteMoney(price,'€',quotePrecision(s,true,price));
  return{label:'Precio LSX',value:text,tone:change===null?'muted':C(change),html:'<span class="asset-regular-price asset-venue-price" data-tr-live-key="'+E(stockKey(s))+'">'+pricePairInner(s,price,true)+'</span>'};
 }
 const q=currentUsQuote(s,se),price=N(q&&q.price),change=N(q&&q.change);
 const text=price===null?'—':quoteMoney(price,'\u0024',quotePrecision(s,false,price));
 const label=q&&q.kind==='premarket'?'Premarket':q&&q.kind==='postmarket'?'Postmarket':'Precio actual';
 return{label,value:text,tone:change===null?'muted':C(change),
  html:'<span class="asset-regular-price">'+E(text)+'</span>'};
}
function regularChangeCell(s,se=currentMarketSession(),preferTr=false){
 if(preferTr&&trTradable(s)){
  const change=N(canonicalQuote(s,true).change);
  return{label:'Variación',value:PC(change),tone:change===null?'muted':C(change),html:'<span class="asset-regular-change asset-venue-change '+C(change)+'" data-tr-live-change-key="'+E(stockKey(s))+'">'+E(PC(change))+'</span>'};
 }
 const q=currentUsQuote(s,se),change=N(q&&q.change);
 return{label:'Variación',value:PC(change),tone:change===null?'muted':C(change),
  html:'<span class="asset-regular-change">'+E(PC(change))+'</span>'};
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
 let cells=[regularQuoteCell(s,se,preferTr),regularChangeCell(s,se,preferTr)];
 let details=opts.detailsHtml;
 // Compact lists stay compact: tapping the row opens the shared full stock profile.
 // A caller may still opt into details explicitly for a specialized non-navigation use.
 if(details===undefined)details='';
 return window.ViewInvAICards.render({
  context:opts.context||state.currentView||'stock',title:s.name||ticker||'—',rank,
  isin:preferTr?(s.trIsin||s.isin||s.usIsin):(s.usIsin||s.isin||s.trIsin),
  subtitle:opts.subtitle||[ticker,preferTr?(s.trExchange||'LSX'):(s.exchange||'EEUU')].filter(Boolean).join(' · '),
  leadingHtml:opts.leadingHtml!==undefined?opts.leadingHtml:favButton(s,preferTr),cells,
  openAttrs:opts.openAttrs!==undefined?opts.openAttrs:stockOpenAttrs(s,hint,preferTr),
  detailsHtml:details,detailsLabel:opts.detailsLabel,detailsClass:opts.detailsClass||'stock-card-details',
  metaHtml:opts.metaHtml||'',actionsHtml:opts.actionsHtml,className:opts.className,
  openLabel:opts.openLabel||'',openActionAttrs:opts.openActionAttrs||''
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
 return market(s,'us');
}
function entrySessionForPreset(){
 if(state.entryMarket==='tr')return 'regular';
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
 const quote=preferTr?canonicalQuote(s,true):verifiedDisplayQuote(s,false,se);
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
  let displayQuote=preferTr?canonicalQuote(s,true):verifiedDisplayQuote(s,false,se);
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
function homeUniverse(source='us'){
 const rows=(db.stocks||[]).filter(s=>stockKey(s));
 if(source==='tr')return rows.filter(s=>trTradable(s));
 return rows.filter(s=>market(s,'us')&&(N(s.price)!==null||usLivePrice(s)!==null));
}
function homeUserViewedStocks(limit=10){
 let universe=homeUniverse('us'),ranked=universe.filter(s=>stockViewCount(s)>0).sort((a,b)=>stockViewCount(b)-stockViewCount(a)||((stockViews[stockKey(b)]?.last||0)-(stockViews[stockKey(a)]?.last||0)));
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
function homeActiveStocks(limit=10,source='us'){
 const universe=homeUniverse(source),byTicker=new Map(),byKey=new Map();
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
function seedTradeRepublicMarketBoard(limit=100){
 if(typeof ensureTrLiveKey!=='function')return;
 homeActiveStocks(limit,'tr').forEach(s=>ensureTrLiveKey(stockKey(s)));
}
function homeMoveStocks(desc=true,limit=10,source='us'){
 let se=homeSession();
 if(source==='tr')seedTradeRepublicMarketBoard(Math.min(100,Math.max(50,limit*8)));
 return homeUniverse(source).map(s=>({s,ch:source==='tr'?trLiveChange(s):effectiveSessionChange(s,se)}))
  .filter(x=>x.ch!==null&&(desc?x.ch>0:x.ch<0)).sort((a,b)=>desc?b.ch-a.ch:a.ch-b.ch).slice(0,limit).map(x=>x.s);
}
function homeStockRow(s,i,kind,source='us'){
 let preferTr=source==='tr',se=homeSession();
 let hint=kind==='views'?'Visto esta semana':(kind==='active'?'Atención y popularidad de mercado':kind==='gainers'?'Mayor subida de la sesión':'Mayor bajada de la sesión');
 let ticker=preferTr?(s.trTicker||s.ticker):(s.ticker||s.trTicker);
 let exchange=preferTr?(s.trExchange||'LSX'):(s.exchange||'EEUU');
 return standardStockCard(s,i,{
  se,preferTr,hint,context:'home',className:'home-investing-card',
  detailsHtml:'',subtitle:[ticker,exchange].filter(Boolean).join(' · ')
 });
}
function homePanel(title,subtitle,stocks,kind,tone){
 return '<section class="home-market-panel '+tone+'"><header><div><h2>'+E(title)+'</h2><p>'+E(subtitle)+'</p></div><span>'+stocks.length+'</span></header>'+
  '<div class="home-stock-list">'+(stocks.length?stocks.map((s,i)=>homeStockRow(s,i,kind)).join(''):'<div class="home-empty">Sin datos disponibles todavía.</div>')+'</div></section>';
}
let marketBoardMode='active';
const marketBoardSourceByMode={active:'us',gainers:'us',losers:'us',funds:'tr',indices:'global'};
function marketBoardSourceOptions(mode=marketBoardMode){
 if(mode==='funds')return[{key:'tr',label:'Trade Republic'},{key:'mi',label:'MyInvestor'}];
 if(mode==='indices')return[{key:'global',label:'Mercado global'}];
 return[{key:'us',label:'EEUU'},{key:'tr',label:'Trade Republic / LSX'}];
}
function currentMarketBoardSource(){
 const options=marketBoardSourceOptions(),allowed=new Set(options.map(x=>x.key));
 let value=marketBoardSourceByMode[marketBoardMode]||options[0]?.key||'us';
 if(!allowed.has(value))value=options[0]?.key||'us';
 marketBoardSourceByMode[marketBoardMode]=value;
 return value;
}
function renderMarketBoardSourceTabs(){
 const nav=$('#marketBoardSourceTabs');if(!nav)return;
 const source=currentMarketBoardSource(),options=marketBoardSourceOptions();
 nav.innerHTML=options.map(item=>
  '<button type="button" class="tab '+(item.key===source?'active':'')+'" data-market-board-source="'+E(item.key)+'" aria-pressed="'+(item.key===source?'true':'false')+'">'+E(item.label)+'</button>'
 ).join('');
 nav.dataset.mode=marketBoardMode;
}
function marketBoardStocks(mode='active',limit=10,source=currentMarketBoardSource()){
 if(mode==='gainers')return homeMoveStocks(true,limit,source);
 if(mode==='losers')return homeMoveStocks(false,limit,source);
 return homeActiveStocks(limit,source);
}
function renderMarketQuickSheet(){
 let box=$('#marketQuickContent');if(!box)return;
 let views=homeUserViewedStocks(10);
 box.innerHTML='<section class="weekly-viewed-section">'+(views.length?views.map((s,i)=>homeStockRow(s,i,'views')).join(''):'<div class="empty-state compact">Todavía no has visitado activos esta semana.</div>')+'</section>';
}
function renderMarketBoardStatus(updatedAt=null){
 const source=currentMarketBoardSource(),se=homeSession();
 let label=SN(se)+' · EEUU · Top 10';
 if(marketBoardMode==='funds')label=(source==='mi'?'MyInvestor':'Trade Republic')+' · Top 10';
 else if(marketBoardMode==='indices')label='Mercado global · Top 10';
 else if(source==='tr')label='Trade Republic / LSX · Top 10';
 if($('#homeSession'))$('#homeSession').textContent=label;
 const at=updatedAt||(
  marketBoardMode==='funds'&&window.ViewInvAIFunds?.getState?.().meta?.updatedAt
   ?window.ViewInvAIFunds.getState().meta.updatedAt
   :db.meta.updatedAt
 );
 if($('#homeUpdated'))$('#homeUpdated').textContent=at?'Datos '+new Date(at).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'Actualizando…';
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
  renderMarketBoardStatus(data.updatedAt||null);
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
 renderMarketBoardSourceTabs();
 const source=currentMarketBoardSource();
 if(marketBoardMode==='funds'){
  box.innerHTML='<div class="empty-state compact">Cargando Top 10 de fondos y ETFs…</div>';
  window.ViewInvAIFunds?.renderMarketTop10?.(box,10,source);
 }else if(marketBoardMode==='indices'){
  renderIndicesTop10(box);
 }else{
  let rows=marketBoardStocks(marketBoardMode,10,source);
  if(source==='tr')rows.forEach(s=>{if(typeof ensureTrLiveKey==='function')ensureTrLiveKey(stockKey(s))});
  const waitingTr=source==='tr'&&['gainers','losers'].includes(marketBoardMode)&&!rows.length;
  box.innerHTML=rows.length
   ?'<div class="market-board-list">'+rows.map((s,i)=>homeStockRow(s,i,marketBoardMode==='gainers'?'gainers':marketBoardMode==='losers'?'losers':'active',source)).join('')+'</div>'
   :'<div class="empty-state">'+(waitingTr?'Recopilando cotizaciones Trade Republic / LSX en directo…':'No hay datos de mercado disponibles.')+'</div>';
 }
 renderMarketBoardStatus();
 renderMarketQuickSheet();
 if(marketBoardMode==='active')setTimeout(()=>refreshSocialTrending(false),0);
}

const radarLiveContextAt=new Map();
let radarLiveContextBusy=false,radarRerenderTimer=null;
async function refreshRadarLiveContext(stocks){
 if(radarLiveContextBusy||state.currentView!=='entry'||!window.ViewInvAI?.mergeLiveEvents)return;
 const now=Date.now(),targets=(Array.isArray(stocks)?stocks:[]).slice(0,5).filter(stock=>{
  const key=stockKey(stock),last=radarLiveContextAt.get(key)||0;
  return key&&now-last>=120000;
 });
 if(!targets.length)return;
 radarLiveContextBusy=true;
 try{
  let added=0;
  for(const stock of targets){
   const key=stockKey(stock);radarLiveContextAt.set(key,now);
   const ticker=String(stock.ticker||stock.trTicker||'').trim(),exchange=String(stock.exchange||'').trim();
   if(!ticker)continue;
   try{
    const response=await fetch('/api/stock-events-live?ticker='+encodeURIComponent(ticker)+'&exchange='+encodeURIComponent(exchange),{cache:'no-store'});
    if(!response.ok)continue;
    const data=await response.json();
    added+=window.ViewInvAI.mergeLiveEvents(data.events||[])||0;
   }catch(error){console.warn('Radar live context unavailable',ticker,error)}
  }
  if(added&&state.currentView==='entry'){
   clearTimeout(radarRerenderTimer);
   radarRerenderTimer=setTimeout(()=>renderEntry(),120);
  }
 }finally{radarLiveContextBusy=false}
}

function syncEntryVenueControls(){
 const isTr=state.entryMarket==='tr',session=$('#sessionSelect');
 if(session)session.classList.toggle('is-hidden',isTr);
 document.querySelectorAll('.preset-option[data-value="premarketExplosion"],.preset-option[data-value="postmarketExplosion"]').forEach(el=>{el.hidden=isTr});
 const native=$('#presetSelect');if(native)Array.from(native.options).forEach(o=>{if(o.value==='premarketExplosion'||o.value==='postmarketExplosion')o.disabled=isTr});
}
function renderEntry(){
 syncEntryVenueControls();
 let [a,se]=entry();
 $('#entrySessionText').textContent=state.entryMarket==='tr'?'Trade Republic / LSX · sesión única':('EEUU · '+SN(se));
 $('#entryCount').textContent=a.length+' seleccionadas · '+entryCandidatePoolCount+' analizadas';
 $('#entryUpdated').textContent=db.meta.updatedAt?'datos '+new Date(db.meta.updatedAt).toLocaleString('es-ES'):'sin actualización';
 let shown=a;
 $('#entryResults').innerHTML=shown.length
  ?(stockCompactListView()
    ?stockMobileList(shown,se,state.entryMarket==='tr','entry')
    :shown.map((s,i)=>card(s,i,se,false,entryOpportunityWhy(s,se,state.entryMarket==='tr',i+1),state.entryMarket==='tr')).join(''))
  :'<div class="empty-state">No hay candidatas con este criterio y sesión. Prueba otro preset o abre Configurar criterio para ver los umbrales activos.</div>';
 if(shown.length)setTimeout(()=>refreshRadarLiveContext(shown),0);
}

window.ViewInvAIMarketBoard={refreshSocialTrending,refreshAttentionRanking,renderMarketQuickSheet};


let homeTrBoardRerenderTimer=null;
window.addEventListener('viewinvai:quote-updated',event=>{
 if(!event||!event.detail)return;
 if(state.currentView==='entry'){
  clearTimeout(radarRerenderTimer);
  radarRerenderTimer=setTimeout(()=>renderEntry(),280);
  return;
 }
 if(event.detail.market!=='tr')return;
 if(state.currentView!=='home'||currentMarketBoardSource()!=='tr')return;
 if(!['gainers','losers'].includes(marketBoardMode))return;
 clearTimeout(homeTrBoardRerenderTimer);
 homeTrBoardRerenderTimer=setTimeout(()=>renderHome(),350);
});

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
  let source=e.target.closest&&e.target.closest('[data-market-board-source]');
  if(!source)return;
  marketBoardSourceByMode[marketBoardMode]=source.dataset.marketBoardSource||currentMarketBoardSource();
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
  // A preset changes screening thresholds only. It must never silently
  // switch the market clock and make Radar disagree with Mercados.
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
 $$('[data-tab-group="entryMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{
  state.entryMarket=b.dataset.tab;
  if(state.entryMarket==='tr'&&(state.preset==='premarketExplosion'||state.preset==='postmarketExplosion'))setPreset('intraday');
  $$('[data-tab-group="entryMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));
  syncEntryVenueControls();saveUiState();renderEntry();setTimeout(pollUsLive,0);
 }));
}

function radarCoachCandidates(limit=10,excluded=[],marketMode='us'){
 const skip=new Set((excluded||[]).map(x=>String(x||'').toUpperCase())),preferTr=marketMode==='tr',se=preferTr?'regular':currentMarketSession();
 let rows=(db.stocks||[]).map(stock=>{
   const key=stockKey(stock);if(!key||skip.has(String(key).toUpperCase())||!market(stock,preferTr?'tr':'us'))return null;
   const useTr=preferTr&&trLivePrice(stock)!==null,a=entryOpportunityAnalysis(stock,se,useTr);
   return{stock,preferTr,score:N(a&&a.score)??0,quality:N(a&&a.quality)??0,analysis:a,provisionalVenue:preferTr&&!useTr}
  }).filter(Boolean).filter(row=>row.quality>=42&&row.score>=55)
   .sort((a,b)=>b.score-a.score||b.quality-a.quality).slice(0,Math.max(1,Math.min(25,Number(limit)||10)));
 if(preferTr&&typeof ensureTrLiveKey==='function')rows.forEach(row=>ensureTrLiveKey(stockKey(row.stock)));
 return rows;
}
window.ViewInvAIRadarCoach={rankCandidates:radarCoachCandidates};
