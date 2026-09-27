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
 {key:'trend',label:'Tendencia',columns:[['ema20','EMA20'],['ema50','EMA50']]},
 {key:'returns',label:'Rentabilidad',columns:[['week','1 sem.'],['month','1 mes']]},
 {key:'market',label:'Mercado',columns:[['bid','BID'],['ask','ASK']]},
 {key:'other',label:'Otros',columns:[['exchange','Mercado'],['earnings','Resultados']]}
];
const stockMobileUi={entry:'general'};
function stockCompactListView(){return document.documentElement.dataset.nativeApp==='1'||!!(window.matchMedia&&window.matchMedia('(max-width:760px)').matches)}
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
  let q=canonicalQuote(s,preferTr),sym=q.nativeCurrency==='EUR'?'€':'\u0024';
  text=quoteMoney(q.price,sym,quotePrecision(s,preferTr,SP(s,se)));
 }else if(key==='change'){
  v=marketChange(s,se,preferTr);text=PC(v);tone=v===null?'muted':v>=0?'positive':'negative';
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
 let group=stockMobileGroup(scope),ticker=preferTr?(s.trTicker||s.ticker):(s.ticker||s.trTicker),isin=s.trIsin||s.usIsin||s.isin||'—';
 let hint=why(s,se,preferTr);
 return '<article class="stock-mobile-line stock-open-row"'+stockOpenAttrs(s,hint,preferTr)+'>'+
  '<div class="stock-mobile-identity">'+favButton(s,preferTr)+'<span class="stock-mobile-copy"><strong><em>#'+(i+1)+'</em>'+E(s.name||ticker||'—')+'</strong><small>'+E(isin)+'</small><i>'+E(ticker||'—')+'</i></span></div>'+
  group.columns.map(([key])=>{let cell=stockMobileCell(s,key,se,preferTr);return '<span class="stock-mobile-cell '+E(cell.tone)+'">'+E(cell.value)+'</span>'}).join('')+
  '<span class="stock-mobile-open" aria-hidden="true">›</span>'+
 '</article>';
}
function stockMobileList(rows,se,preferTr=false,scope='entry'){
 let group=stockMobileGroup(scope);
 return stockMobileTabs(scope)+
  '<div class="stock-mobile-compare">'+
   '<div class="stock-mobile-head"><span>Valor / ISIN</span>'+group.columns.map(([,label])=>'<span>'+E(label)+'</span>').join('')+'<span></span></div>'+
   '<div class="stock-mobile-rows">'+rows.map((s,i)=>stockMobileRow(s,i,se,preferTr,scope)).join('')+'</div>'+
  '</div>';
}

function standardStockCard(s,i=0,opts={}){
 let se=opts.se||SES(),dense=opts.dense===true,preferTr=opts.preferTr===true;
 let hint=opts.hint||why(s,se,preferTr),rv=RV(s,se),vol=SV(s,se),ticker=preferTr?(s.trTicker||s.ticker):s.ticker;
 let attrs=opts.openAttrs!==undefined?String(opts.openAttrs||''):stockOpenAttrs(s,hint,preferTr);
 let rank=opts.rankLabel!==undefined?String(opts.rankLabel):'#'+(i+1);
 let insight=opts.insight||listInsightLabel(s,se,preferTr);
 let context=opts.contextHtml?'<div class="stock-context-line">'+opts.contextHtml+'</div>':'';
 return '<article class="stock-card investing-stock-card '+(dense?'dense-card':'')+(opts.className?' '+E(opts.className):'')+'">'+
  '<div class="stock-open-row investing-stock-row"'+attrs+' title="'+E(hint)+'">'+
   '<div class="investing-stock-left">'+
    '<div class="investing-stock-name-row">'+favButton(s,preferTr)+'<div class="investing-stock-copy"><strong class="stock-name">'+E(s.name||ticker||'—')+'</strong>'+
     '<div class="investing-stock-meta"><span class="rank">'+E(rank)+'</span><span class="meta-clock">◷</span><span>'+E(ticker||'—')+'</span><span>·</span><span>'+E(preferTr?(s.trExchange||'LSX'):(s.exchange||'EEUU'))+'</span>'+(trTradable(s)?'<span class="pill ok">TR</span>':'')+'</div>'+
    '</div></div>'+
    '<div class="stock-ai-chip">'+E(insight)+'</div>'+
   '</div>'+
   '<div class="investing-stock-right"><div class="stock-list-price">'+pricePair(s,SP(s,se),preferTr)+quoteFreshnessHtml(s,preferTr,'stock-card-freshness')+'</div>'+entryChangeHtml(s,se,preferTr)+listSessionQuote(s,se,preferTr)+'</div>'+
   '<span class="open-arrow">›</span>'+
  '</div>'+
  '<details class="stock-card-details"><summary><span>Más datos</span><i aria-hidden="true">＋</i></summary><div class="stock-market-line">'+bidAskHtml(s,preferTr)+'<div class="stock-list-metrics"><span>Vol <b>'+compactVol(vol)+'</b></span><span>RV <b>'+(rv===null?'—':F(rv,2)+'×')+'</b></span><span>RSI <b>'+F(s.rsi,0)+'</b></span><span>ADX <b>'+F(s.adx,0)+'</b></span></div></div></details>'+
  context+
 '</article>';
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
 if(state.preset==='postmarketExplosion')return'postmarket';
 if(state.preset==='premarketExplosion')return'premarket';
 return SES();
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
function entry(){
 let q=state.filters,se=entrySessionForPreset(),preferTr=state.entryMarket==='tr',emerging=state.preset==='emerging';
 let a=db.stocks.filter(entryUniverseMatch).filter(s=>{
  let ch=marketChange(s,se,preferTr);if(ch===null||ch<q.minChange)return false;if(q.maxChange>0&&ch>q.maxChange)return false;

  let rv=RV(s,se);if(q.minRelVolume>0&&(rv===null||rv<q.minRelVolume))return false;
  let adx=N(s.adx);if(q.minAdx>0&&(adx===null||adx<q.minAdx))return false;

  let rsi=N(s.rsi);
  if((q.minRsi>0||q.maxRsi<100)&&(rsi===null||rsi<q.minRsi||rsi>q.maxRsi))return false;

  let v=SV(s,se);if(q.minVolume>0&&(v===null||v<q.minVolume))return false;

  if(q.trend&&trendState(s)!==true)return false;
  if(q.illiquid&&lowLiquidity(s,se,preferTr))return false;
  if(emerging&&!emergingSignal(s,se).eligible)return false;
  return true;
 });
 a.sort((x,y)=>{
  if(emerging){
   let ax=emergingSignal(x,se),ay=emergingSignal(y,se);
   if(ay.score!==ax.score)return ay.score-ax.score;
  }
  let ax=marketChange(x,se,preferTr),by=marketChange(y,se,preferTr),av=ax===null?-Infinity:ax,bv=by===null?-Infinity:by;
  if(bv!==av)return bv-av;
  return String(x.ticker||'').localeCompare(String(y.ticker||''));
 });
 return[a,se];
}

function homeDailyChange(s){
 let preferTr=trTradable(s);
 return marketChange(s,currentMarketSession(),preferTr);
}
function homeUniverse(){
 return (db.stocks||[]).filter(s=>stockKey(s)&&(N(s.price)!==null||trTradable(s)));
}
function homePopularStocks(limit=5){
 let universe=homeUniverse(),ranked=universe.filter(s=>stockViewCount(s)>0).sort((a,b)=>stockViewCount(b)-stockViewCount(a)||((stockViews[stockKey(b)]?.last||0)-(stockViews[stockKey(a)]?.last||0)));
 let used=new Set(ranked.map(stockKey));
 if(ranked.length<limit){
  let fallback=universe.filter(s=>!used.has(stockKey(s))).sort((a,b)=>(SV(b,'regular')??N(b.avgVolume)??0)-(SV(a,'regular')??N(a.avgVolume)??0));
  ranked.push(...fallback.slice(0,limit-ranked.length));
 }
 return ranked.slice(0,limit);
}
function homeMoveStocks(desc=true,limit=5){
 return homeUniverse().map(s=>({s,ch:homeDailyChange(s)})).filter(x=>x.ch!==null).sort((a,b)=>desc?b.ch-a.ch:a.ch-b.ch).slice(0,limit).map(x=>x.s);
}
function homeStockRow(s,i,kind){
 let preferTr=trTradable(s),views=stockViewCount(s);
 let hint=kind==='views'?(views?views+' '+(views===1?'vista':'vistas'):'Más vista'):(kind==='gainers'?'Mejor rendimiento diario':'Peor rendimiento diario');
 let insight=kind==='views'?'IA · interés de usuarios':kind==='gainers'?'IA · momentum positivo':'IA · presión vendedora';
 return standardStockCard(s,i,{se:'regular',preferTr,hint,insight,className:'home-investing-card'});
}
function homePanel(title,subtitle,stocks,kind,tone){
 return '<section class="home-market-panel '+tone+'"><header><div><h2>'+E(title)+'</h2><p>'+E(subtitle)+'</p></div><span>'+stocks.length+'</span></header>'+
  '<div class="home-stock-list">'+(stocks.length?stocks.map((s,i)=>homeStockRow(s,i,kind)).join(''):'<div class="home-empty">Sin datos disponibles todavía.</div>')+'</div></section>';
}
function renderHome(){
 let box=$('#homeGroups');if(!box)return;
 let popular=homePopularStocks(5),gainers=homeMoveStocks(true,5),losers=homeMoveStocks(false,5);
 box.innerHTML=
  homePanel('Más vistas','Según las acciones que abres en este dispositivo',popular,'views','popular')+
  homePanel('Mejor rendimiento diario','Mayores subidas de la sesión regular',gainers,'gainers','positive-panel')+
  homePanel('Peor rendimiento diario','Mayores caídas de la sesión regular',losers,'losers','negative-panel');
 if($('#homeSession'))$('#homeSession').textContent='Sesión regular · '+homeUniverse().length+' acciones';
 if($('#homeUpdated'))$('#homeUpdated').textContent=db.meta.updatedAt?'Datos '+new Date(db.meta.updatedAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'Actualizando…';
}

function renderEntry(){
 let [a,se]=entry();
 $('#entrySessionText').textContent=(state.entryMarket==='tr'?'Trade Republic':'Resto EEUU')+' · '+SN(se);
 $('#entryCount').textContent=a.length+' candidatas';
 $('#entryUpdated').textContent=db.meta.updatedAt?'datos '+new Date(db.meta.updatedAt).toLocaleString('es-ES'):'sin actualización';
 let shown=a.slice(0,150);
 $('#entryResults').innerHTML=shown.length
  ?(stockCompactListView()
    ?stockMobileList(shown,se,state.entryMarket==='tr','entry')
    :shown.map((s,i)=>card(s,i,se,false,rankingWhy(s,shown[i+1],se,state.filters,i+1,state.entryMarket==='tr'),state.entryMarket==='tr')).join(''))
  :'<div class="empty-state">No hay candidatas con este criterio y sesión. Prueba otro preset o abre Configurar criterio para ver los umbrales activos.</div>';
}

function initStockListInteractions(){
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
 $('#applyFilters').addEventListener('click',()=>{state.filters=fromUI();renderEntry();setTimeout(pollUsLive,0)});
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
 $('#toggleFilters').addEventListener('click',()=>$('#filterDetails').open=!$('#filterDetails').open);
 $$('.field-lock').forEach(btn=>btn.addEventListener('click',()=>{let id=btn.dataset.target,input=$('#'+id);lockCriterion(id,!input.readOnly);if(!input.readOnly){input.focus();input.select()}}));
 $$('[data-tab-group="entryMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{state.entryMarket=b.dataset.tab;$$('[data-tab-group="entryMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));saveUiState();renderEntry();setTimeout(pollUsLive,0)}));
}
