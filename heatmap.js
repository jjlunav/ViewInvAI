/*
 * ViewInvAI heatmap
 * -----------------
 * Heatmap state, sector rendering, hover card and user interactions.
 */

let heatmapState={market:'tr',session:'auto',limit:250,sectorByMarket:{tr:null,us:null},selectedStockKey:null};

function syncHeatmapVenueControls(){
 const tr=heatmapState.market==='tr',control=$('#heatmapSession');
 if(control)control.classList.toggle('is-hidden',tr);
}
function heatmapSession(){
 if(heatmapState.market==='tr')return 'regular';
 let se=heatmapState.session==='auto'?auto():heatmapState.session;
 return se==='previous'?'postmarket':se;
}
function heatmapUniverse(){
 return db.stocks.filter(s=>heatmapState.market==='tr'?trTradable(s):market(s,'us'));
}
function heatmapWeight(s){
 let cap=N(s.marketCap);
 if(cap!==null&&cap>0)return cap;
 let avg=N(s.avgVolume),p=N(s.price);
 return avg!==null&&p!==null&&avg>0&&p>0?avg*p:1;
}
function heatmapChange(s,se){return marketChange(s,se,heatmapState.market==='tr')}
function heatmapChangeClass(v){
 v=N(v);if(v===null)return'heat-na';
 if(v<=-5)return'heat-loss-strong';
 if(v<=-2)return'heat-loss';
 if(v<-.5)return'heat-loss-soft';
 if(v<=.5)return'heat-flat';
 if(v<2)return'heat-gain-soft';
 if(v<5)return'heat-gain';
 return'heat-gain-strong';
}
function heatmapTileSize(s,maxWeight){
 let w=heatmapWeight(s),r=maxWeight>0?w/maxWeight:0;
 if(r>=.32)return'heat-xl';
 if(r>=.12)return'heat-lg';
 if(r>=.04)return'heat-md';
 return'heat-sm';
}
function heatmapSectorAverage(stocks,se){
 let num=0,den=0,fallback=0,count=0;
 for(let s of stocks){
  let ch=heatmapChange(s,se);if(ch===null)continue;
  let cap=N(s.marketCap);
  if(cap!==null&&cap>0){num+=ch*cap;den+=cap}
  fallback+=ch;count++;
 }
 return den>0?num/den:(count?fallback/count:null);
}
function heatmapSectorSpan(weight,maxWeight){
 let r=maxWeight>0?weight/maxWeight:0;
 if(r>=.70)return 12;
 if(r>=.42)return 9;
 if(r>=.24)return 7;
 if(r>=.12)return 6;
 return 4;
}
function heatmapTile(s,se,maxWeight){
 let ch=heatmapChange(s,se),preferTr=heatmapState.market==='tr',ticker=preferTr&&trTradable(s)?s.trTicker:s.ticker,key=stockKey(s);
 let cap=N(s.marketCap),capText=cap!==null?compactMoney(cap):'Cap. no disponible';
 let quote=canonicalQuote(s,preferTr),price=quote.price!==null?quoteMoney(quote.price,preferTr?'€':'\u0024',quotePrecision(s,preferTr,quote.price)):'—';
 let reason='Mapa de calor · '+(preferTr?'LSX':SN(se))+' · '+PC(ch)+' · '+String(s.sector||'Sin sector');
 let selected=heatmapState.selectedStockKey===key?' selected':'';
 return '<button type="button" class="heat-stock '+heatmapChangeClass(ch)+' '+heatmapTileSize(s,maxWeight)+selected+'"'+stockOpenAttrs(s,reason,preferTr)+' data-heat-select="'+E(key)+'" data-heat-ticker="'+E(ticker||'—')+'" data-heat-name="'+E(s.name||'')+'" data-heat-price="'+E(price)+'" data-heat-change="'+E(PC(ch))+'" data-us-heat-key="'+E(key)+'" aria-label="'+E((ticker||'Acción')+' '+price+' '+PC(ch)+' '+(s.name||''))+'">'+
  '<strong>'+E(ticker||'—')+'</strong>'+
  '<span>'+PC(ch)+'</span>'+
  '<small>'+E(price)+'</small>'+
  '</button>';
}
function compactMoney(v){
 v=N(v);if(v===null)return'—';
 let a=Math.abs(v),prefix='USD ';
 if(a>=1e12)return prefix+F(v/1e12,1)+'T';
 if(a>=1e9)return prefix+F(v/1e9,1)+'B';
 if(a>=1e6)return prefix+F(v/1e6,1)+'M';
 return prefix+I(v);
}
function renderHeatmap(){
 let box=$('#heatmapResults'),tabs=$('#heatmapSectorTabs');if(!box)return;
 syncHeatmapVenueControls();
 let se=heatmapSession(),limit=Math.max(25,Math.min(500,N(heatmapState.limit)||250));
 let universe=heatmapUniverse().filter(s=>heatmapChange(s,se)!==null);
 universe.sort((a,b)=>heatmapWeight(b)-heatmapWeight(a));
 let selected=universe.slice(0,limit),groups=new Map();
 for(let s of selected){
  let sector=String(s.sector||'Sin sector').trim()||'Sin sector';
  if(!groups.has(sector))groups.set(sector,[]);
  groups.get(sector).push(s);
 }
 let sectors=[...groups.entries()].map(([name,stocks])=>({
  name,stocks,
  weight:stocks.reduce((sum,s)=>sum+heatmapWeight(s),0),
  avg:heatmapSectorAverage(stocks,se)
 })).sort((a,b)=>b.weight-a.weight);

 let remembered=heatmapState.sectorByMarket&&heatmapState.sectorByMarket[heatmapState.market];
 let active=sectors.find(x=>x.name===remembered)||sectors[0]||null;
 if(active){
  heatmapState.sectorByMarket[heatmapState.market]=active.name;
  if(tabs)tabs.innerHTML=sectors.map(sec=>
   '<button type="button" class="heatmap-sector-tab'+(sec.name===active.name?' active':'')+'" data-heatmap-sector-tab="'+E(sec.name)+'">'+
    '<strong>'+E(sec.name)+'</strong><span>'+sec.stocks.length+'</span><b class="'+C(sec.avg)+'">'+PC(sec.avg)+'</b>'+
   '</button>'
  ).join('');
  let maxStock=Math.max(1,...active.stocks.map(heatmapWeight));
  let cols=Math.max(2,Math.min(8,Math.ceil(Math.sqrt(Math.max(1,active.stocks.length)*1.55))));
  let rows=Math.max(1,Math.ceil(active.stocks.length/cols));
  box.innerHTML='<section class="heat-sector heat-sector-single '+heatmapChangeClass(active.avg)+'" style="--heat-cols:'+cols+';--heat-rows:'+rows+'">'+
   '<div class="heat-sector-head"><div><strong>'+E(active.name)+'</strong><small>'+active.stocks.length+' acciones · '+(heatmapState.market==='tr'?'Trade Republic / LSX':'EEUU')+'</small></div><b class="'+C(active.avg)+'">'+PC(active.avg)+'</b></div>'+
   '<div class="heat-sector-grid">'+active.stocks.map(s=>heatmapTile(s,se,maxStock)).join('')+'</div>'+
  '</section><div id="heatmapHoverCard" class="heatmap-hover-card" aria-hidden="true"></div>';
 }else{
  if(tabs)tabs.innerHTML='';
  box.innerHTML='<div class="empty-state">No hay datos suficientes para construir el mapa de calor en esta sesión.</div>';
 }
 let marketLabel=heatmapState.market==='tr'?'Trade Republic / LSX':'EEUU';
 let ses=$('#heatmapSessionText');if(ses)ses.textContent=heatmapState.market==='tr'
  ?marketLabel+' · sesión única'+(active?' · '+active.name:'')
  :marketLabel+' · '+SN(se)+(active?' · '+active.name:'');
 let count=$('#heatmapCount');if(count)count.textContent=(active?active.stocks.length:0)+' visibles · '+selected.length+' analizadas';
 let upd=$('#heatmapUpdated');
 if(upd){
  if(heatmapState.market==='tr')upd.textContent=trMarketOpen()?'LSX · mercado abierto':'LSX · mercado cerrado';
  else if(se==='regular'&&usLive.lastFetchAt)upd.textContent='NASDAQ LIVE · '+new Date(usLive.lastFetchAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  else upd.textContent=db.meta.updatedAt?'snapshot '+new Date(db.meta.updatedAt).toLocaleString('es-ES'):'sin actualización';
 }
}

function heatmapHoverCardFor(el){
 let card=$('#heatmapHoverCard');if(!card||!el)return;
 card.innerHTML='<strong>'+E(el.dataset.heatTicker||'—')+'</strong><span>'+E(el.dataset.heatName||'')+'</span><b>'+E(el.dataset.heatPrice||'—')+'</b><em>'+E(el.dataset.heatChange||'—')+'</em>';
 let r=el.getBoundingClientRect(),board=$('#heatmapResults')?.getBoundingClientRect();
 if(board){
  card.style.left=Math.max(6,Math.min(board.width-190,r.left-board.left+r.width/2-90))+'px';
  card.style.top=Math.max(6,r.top-board.top-64)+'px';
 }
 card.classList.add('show');card.setAttribute('aria-hidden','false');
}
function heatmapHideHover(){
 let card=$('#heatmapHoverCard');if(card){card.classList.remove('show');card.setAttribute('aria-hidden','true')}
}

function initHeatmapInteractions(){
 const results=$('#heatmapResults');
 results?.addEventListener('mouseover',e=>{
  let el=e.target.closest?.('[data-heat-select]');
  if(el)heatmapHoverCardFor(el);
 });
 results?.addEventListener('mouseout',e=>{
  if(e.target.closest?.('[data-heat-select]'))heatmapHideHover();
 });
 results?.addEventListener('dblclick',e=>{
  let el=e.target.closest?.('[data-heat-select]');
  if(!el)return;
  e.preventDefault();e.stopPropagation();
  let stock=stockByKey(el.dataset.heatSelect);
  if(stock)openStock(stock,'Mapa de calor',heatmapState.market==='tr');
 });

 document.addEventListener('click',e=>{
  let sectorTab=e.target.closest&&e.target.closest('[data-heatmap-sector-tab]');
   if(sectorTab){
    e.preventDefault();e.stopPropagation();
    heatmapState.sectorByMarket[heatmapState.market]=sectorTab.dataset.heatmapSectorTab||null;
    heatmapState.selectedStockKey=null;
    renderHeatmap();return;
   }
   let sectorButton=e.target.closest&&e.target.closest('[data-heat-sector-select]');
   if(sectorButton){
    e.preventDefault();e.stopPropagation();
    let name=sectorButton.dataset.heatSectorSelect;
    heatmapState.sectorByMarket[heatmapState.market]=name||null;
    heatmapState.selectedStockKey=null;
    renderHeatmap();return;
   }
   let heatTile=e.target.closest&&e.target.closest('[data-heat-select]');
   if(heatTile){
    e.preventDefault();e.stopPropagation();
    heatmapState.selectedStockKey=heatTile.dataset.heatSelect||null;
    $$('#heatmapResults .heat-stock').forEach(x=>x.classList.toggle('selected',x.dataset.heatSelect===heatmapState.selectedStockKey));
    heatmapHoverCardFor(heatTile);
    return;
   }
 },true);

 $$('[data-tab-group="heatmapMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{
  heatmapState.market=b.dataset.tab==='us'?'us':'tr';
  $('[data-tab-group="heatmapMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));
  syncHeatmapVenueControls();renderHeatmap();
 }));
 $('#heatmapSession').addEventListener('change',e=>{heatmapState.session=e.target.value;renderHeatmap()});
 $('#heatmapLimit').addEventListener('change',e=>{heatmapState.limit=N(e.target.value)||250;renderHeatmap()});
}
