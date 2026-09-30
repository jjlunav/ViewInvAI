/*
 * ViewInvAI catalog
 * -----------------
 * Trade Republic and US catalog columns, filters, sorting, paging and interactions.
 */

const CATALOG_PAGE_SIZE=200;
const CATALOG_MOBILE_PAGE_SIZE=40;

const CATALOG_COLUMNS={
 tr:[
  {id:'fav',label:'★',type:'html',value:s=>favorites.has(stockKey(s))?1:0,cell:s=>favButton(s)},
  {id:'tickerTr',label:'Ticker TR',type:'text',value:s=>s.trTicker||'',cell:s=>'<strong class="table-ticker">'+E(s.trTicker||'—')+'</strong>'},
  {id:'tickerUs',label:'Ticker EEUU',type:'text',value:s=>s.ticker||'',cell:s=>'<span class="table-us-ticker">'+E(s.ticker||'—')+'</span>'},
  {id:'name',label:'Empresa',type:'text',value:s=>s.name||'',cell:s=>'<span class="catalog-name-cell" title="'+E(s.name||'')+'">'+E(s.name||'—')+'</span>'},
  {id:'exchange',label:'Mercado',type:'text',value:s=>s.trExchange||'LSX',cell:s=>E(s.trExchange||'LSX')},
  {id:'priceEur',label:'Precio €',type:'number',value:(s,se)=>trPriceValues(s,SP(s,se)).eur,cell:(s,se)=>trPriceCell(s,'eur',se)},
  {id:'priceUsd',label:'Precio USD',type:'number',value:(s,se)=>trPriceValues(s,SP(s,se)).usd,cell:(s,se)=>trPriceCell(s,'usd',se)},
  {id:'change',label:'%',type:'number',value:s=>trLiveChange(s),cell:s=>liveChangeHtml(s,null,true)},
  {id:'bid',label:'Bid €',type:'number',value:s=>N(s.trLiveBid),cell:s=>'<span class="table-live-number '+quoteDirClass(s.trLiveBidDirection)+'" data-tr-bid-key="'+E(stockKey(s))+'">'+quoteMoney(s.trLiveBid,'€',quotePrecision(s,true))+'</span>'},
  {id:'ask',label:'Ask €',type:'number',value:s=>N(s.trLiveAsk),cell:s=>'<span class="table-live-number '+quoteDirClass(s.trLiveAskDirection)+'" data-tr-ask-key="'+E(stockKey(s))+'">'+quoteMoney(s.trLiveAsk,'€',quotePrecision(s,true))+'</span>'},
  {id:'volume',label:'Vol. EEUU',type:'number',value:(s,se)=>SV(s,se),cell:(s,se)=>compactVol(SV(s,se))},
  {id:'avgVolume',label:'Vol. medio EEUU',type:'number',value:s=>N(s.avgVolume),cell:s=>compactVol(s.avgVolume)},
  {id:'relVolume',label:'Vol. rel. EEUU',type:'number',value:(s,se)=>RV(s,se),cell:(s,se)=>RV(s,se)===null?'—':F(RV(s,se),2)+'×'},
  {id:'rsi',label:'RSI',type:'number',value:s=>N(s.rsi),cell:s=>F(s.rsi,1)},
  {id:'adx',label:'ADX',type:'number',value:s=>N(s.adx),cell:s=>F(s.adx,1)},
  {id:'ema20',label:'EMA20',type:'number',value:s=>N(s.ema20),cell:s=>PR(s.ema20)},
  {id:'ema50',label:'EMA50',type:'number',value:s=>N(s.ema50),cell:s=>PR(s.ema50)},
  {id:'week',label:'1 sem.',type:'number',value:s=>N(s.perfWeek),cell:s=>PC(s.perfWeek)},
  {id:'month',label:'1 mes',type:'number',value:s=>N(s.perfMonth),cell:s=>PC(s.perfMonth)},
  {id:'wkn',label:'WKN',type:'text',value:s=>s.trWkn||'',cell:s=>E(s.trWkn||'—')},
  {id:'isin',label:'ISIN',type:'text',value:s=>s.trIsin||s.isin||'',cell:s=>E(s.trIsin||s.isin||'—')},
  {id:'feed',label:'Feed',type:'text',value:s=>s.trLiveQuality||'LSX',cell:s=>E(s.trLiveQuality||'LSX')},
  {id:'earnings',label:'Resultados',type:'date',value:s=>s.earningsDate?new Date(s.earningsDate).getTime():null,cell:s=>s.earningsDate?DF(s.earningsDate):'—'}
 ],
 us:[
  {id:'fav',label:'★',type:'html',value:s=>favorites.has(stockKey(s))?1:0,cell:s=>favButton(s)},
  {id:'ticker',label:'Ticker',type:'text',value:s=>s.ticker||'',cell:s=>'<strong class="table-ticker">'+E(s.ticker||'—')+'</strong>'},
  {id:'name',label:'Empresa',type:'text',value:s=>s.name||'',cell:s=>'<span class="catalog-name-cell" title="'+E(s.name||'')+'">'+E(s.name||'—')+'</span>'},
  {id:'exchange',label:'Mercado',type:'text',value:s=>s.exchange||'',cell:s=>E(s.exchange||'—')},
  {id:'priceUsd',label:'Precio USD',type:'number',value:(s,se)=>usLivePrice(s)??SP(s,se),cell:(s,se)=>usPriceCell(s,'usd',se)},
  {id:'priceEur',label:'Precio €',type:'number',value:(s,se)=>usPriceValues(s,SP(s,se)).eur,cell:(s,se)=>usPriceCell(s,'eur',se)},
  {id:'change',label:'%',type:'number',value:(s,se)=>usLiveChange(s)??SC(s,se),cell:(s,se)=>liveChangeHtml(s,SC(s,se),false)},
  {id:'bid',label:'Bid USD',type:'number',value:s=>usLiveBid(s),cell:s=>'<span class="'+quoteDirClass(s.usLiveBidDirection)+'" data-us-bid-key="'+E(stockKey(s))+'">'+quoteMoney(usLiveBid(s),'\u0024',quotePrecision(s,false))+'</span>'},
  {id:'ask',label:'Ask USD',type:'number',value:s=>usLiveAsk(s),cell:s=>'<span class="'+quoteDirClass(s.usLiveAskDirection)+'" data-us-ask-key="'+E(stockKey(s))+'">'+quoteMoney(usLiveAsk(s),'\u0024',quotePrecision(s,false))+'</span>'},
  {id:'volume',label:'Vol. actual',type:'number',value:(s,se)=>N(s.usLiveVolume)??SV(s,se),cell:(s,se)=>compactVol(N(s.usLiveVolume)??SV(s,se))},
  {id:'avgVolume',label:'Vol. medio',type:'number',value:s=>N(s.avgVolume),cell:s=>compactVol(s.avgVolume)},
  {id:'relVolume',label:'Vol. rel.',type:'number',value:(s,se)=>RV(s,se),cell:(s,se)=>RV(s,se)===null?'—':F(RV(s,se),2)+'×'},
  {id:'premarketPrice',label:'Pre USD',type:'number',value:s=>N(s.premarketPrice),cell:s=>PR(s.premarketPrice)},
  {id:'premarketChange',label:'Pre %',type:'number',value:s=>N(s.premarketChangePct),cell:s=>'<span class="'+C(s.premarketChangePct)+'">'+PC(s.premarketChangePct)+'</span>'},
  {id:'premarketVolume',label:'Vol. pre',type:'number',value:s=>N(s.premarketVolume),cell:s=>compactVol(s.premarketVolume)},
  {id:'regularPrice',label:'Regular USD',type:'number',value:s=>N(s.price),cell:s=>PR(s.price)},
  {id:'regularChange',label:'Regular %',type:'number',value:s=>N(s.changePct),cell:s=>'<span class="'+C(s.changePct)+'">'+PC(s.changePct)+'</span>'},
  {id:'postmarketPrice',label:'Post USD',type:'number',value:s=>N(s.postmarketPrice),cell:s=>PR(s.postmarketPrice)},
  {id:'postmarketChange',label:'Post %',type:'number',value:s=>N(s.postmarketChangePct),cell:s=>'<span class="'+C(s.postmarketChangePct)+'">'+PC(s.postmarketChangePct)+'</span>'},
  {id:'postmarketVolume',label:'Vol. post',type:'number',value:s=>N(s.postmarketVolume),cell:s=>compactVol(s.postmarketVolume)},
  {id:'rsi',label:'RSI',type:'number',value:s=>N(s.rsi),cell:s=>F(s.rsi,1)},
  {id:'adx',label:'ADX',type:'number',value:s=>N(s.adx),cell:s=>F(s.adx,1)},
  {id:'ema20',label:'EMA20',type:'number',value:s=>N(s.ema20),cell:s=>PR(s.ema20)},
  {id:'ema50',label:'EMA50',type:'number',value:s=>N(s.ema50),cell:s=>PR(s.ema50)},
  {id:'week',label:'1 sem.',type:'number',value:s=>N(s.perfWeek),cell:s=>'<span class="'+C(s.perfWeek)+'">'+PC(s.perfWeek)+'</span>'},
  {id:'month',label:'1 mes',type:'number',value:s=>N(s.perfMonth),cell:s=>'<span class="'+C(s.perfMonth)+'">'+PC(s.perfMonth)+'</span>'},
  {id:'tr',label:'Trade Republic',type:'text',value:s=>trTradable(s)?'sí':'no',cell:s=>trTradable(s)?'<span class="pill ok">'+E(s.trTicker)+'</span>':'—'},
  {id:'isin',label:'ISIN',type:'text',value:s=>s.usIsin||s.isin||'',cell:s=>E(s.usIsin||s.isin||'—')},
  {id:'feed',label:'Feed',type:'text',value:s=>s.usLiveIsRealTime?'Nasdaq realtime':(s.updateMode||''),cell:s=>'<span class="'+(s.usLiveIsRealTime?'feed-live':'feed-delayed')+'">'+E(s.usLiveIsRealTime?'Nasdaq realtime':(s.updateMode||'—'))+'</span>'},
  {id:'updated',label:'Último dato',type:'text',value:s=>s.usLiveTimestamp||s.lastBarUpdateTime||'',cell:s=>E(s.usLiveTimestamp||'—')},
  {id:'earnings',label:'Resultados',type:'date',value:s=>s.earningsDate?new Date(s.earningsDate).getTime():null,cell:s=>s.earningsDate?DF(s.earningsDate):'—'}
 ]
};
const CATALOG_MOBILE_GROUPS=[
 {key:'general',label:'General',tr:['priceEur','change'],us:['priceUsd','change']},
 {key:'volume',label:'Volumen',tr:['volume','relVolume'],us:['volume','relVolume']},
 {key:'technical',label:'Técnico',tr:['rsi','adx'],us:['rsi','adx']},
 {key:'trend',label:'Tendencia',tr:['ema20','ema50'],us:['ema20','ema50']},
 {key:'returns',label:'Rentabilidad',tr:['week','month'],us:['week','month']},
 {key:'other',label:'Otros',tr:['exchange','earnings'],us:['exchange','earnings']}
];
const catalogState={
 tr:{sort:'tickerTr',dir:1,filters:{},sector:'all',industry:'all',order:null,widths:null,limit:null,mobileGroup:'general'},
 us:{sort:'ticker',dir:1,filters:{},sector:'all',industry:'all',order:null,widths:null,limit:null,mobileGroup:'general'}
};
const CATALOG_DEFAULT_WIDTHS={
 fav:42,tickerTr:92,tickerUs:92,ticker:92,name:320,exchange:90,priceEur:108,priceUsd:108,change:82,bid:92,ask:92,
 volume:105,avgVolume:118,relVolume:110,rsi:72,adx:72,ema20:92,ema50:92,week:82,month:82,wkn:96,isin:132,feed:118,
 earnings:104,premarketPrice:102,premarketChange:82,premarketVolume:100,regularPrice:108,regularChange:88,postmarketPrice:102,
 postmarketChange:82,postmarketVolume:100,tr:118,updated:132
};
function catalogPrefScope(mode){return 'catalog:'+mode}
function catalogDefaultWidths(mode){
 const out={};for(const c of CATALOG_COLUMNS[mode])out[c.id]=CATALOG_DEFAULT_WIDTHS[c.id]||110;return out;
}
function catalogApplyPreferences(mode,prefs){
 if(!catalogState[mode]||!prefs||typeof prefs!=='object')return;
 const ids=CATALOG_COLUMNS[mode].map(c=>c.id);
 if(Array.isArray(prefs.order)){
  const saved=prefs.order.filter(id=>ids.includes(id));
  catalogState[mode].order=[...saved,...ids.filter(id=>!saved.includes(id))];
 }
 const defaults=catalogDefaultWidths(mode),incoming=prefs.widths&&typeof prefs.widths==='object'?prefs.widths:{};
 catalogState[mode].widths={...defaults};
 for(const id of ids){
  const n=Number(incoming[id]);if(Number.isFinite(n))catalogState[mode].widths[id]=Math.max(42,Math.min(620,Math.round(n)));
 }
}
function catalogLayoutPreferences(mode){
 return{order:[...catalogLoadOrder(mode)],widths:{...catalogWidths(mode)}};
}
function catalogWidths(mode){
 if(catalogState[mode].widths)return catalogState[mode].widths;
 const prefs=window.ViewInvAIUiPreferences?.get?.(catalogPrefScope(mode),{})||{};
 catalogApplyPreferences(mode,prefs);
 if(!catalogState[mode].widths)catalogState[mode].widths=catalogDefaultWidths(mode);
 return catalogState[mode].widths;
}
function catalogIsMobile(){return window.matchMedia&&window.matchMedia('(max-width:820px)').matches}
function catalogPageSize(){return catalogIsMobile()?CATALOG_MOBILE_PAGE_SIZE:CATALOG_PAGE_SIZE}
function catalogResetLimit(mode){if(catalogState[mode])catalogState[mode].limit=catalogPageSize()}
function catalogStorageKey(mode){return 'viewinvai:catalogColumns:'+mode+':v1'}
function catalogLoadOrder(mode){
 if(catalogState[mode].order)return catalogState[mode].order;
 let ids=CATALOG_COLUMNS[mode].map(c=>c.id),saved=[];
 const prefs=window.ViewInvAIUiPreferences?.get?.(catalogPrefScope(mode),{})||{};
 if(Array.isArray(prefs.order))saved=prefs.order;
 else try{saved=JSON.parse(localStorage.getItem(catalogStorageKey(mode))||'[]')}catch(_){}
 saved=Array.isArray(saved)?saved.filter(x=>ids.includes(x)):[];
 catalogState[mode].order=[...saved,...ids.filter(x=>!saved.includes(x))];
 return catalogState[mode].order;
}
function catalogSaveLayout(mode){
 try{localStorage.setItem(catalogStorageKey(mode),JSON.stringify(catalogState[mode].order||[]))}catch(_){}
 window.ViewInvAIUiPreferences?.save?.(catalogPrefScope(mode),catalogLayoutPreferences(mode));
}
function catalogSaveOrder(mode){catalogSaveLayout(mode)}
function catalogColumns(mode){let map=new Map(CATALOG_COLUMNS[mode].map(c=>[c.id,c]));return catalogLoadOrder(mode).map(id=>map.get(id)).filter(Boolean)}
function catalogSession(mode){
 if(mode==='tr')return 'regular';
 let v=$('#catalogUSSession')?.value||'auto';
 return v==='auto'?currentMarketSession():v;
}
function catalogFilterNumber(raw){
 raw=String(raw||'').trim().toLowerCase().replace(/\s+/g,'');
 let m=raw.match(/^(-?\d+(?:[.,]\d+)?)([kmb])?%?$/i);
 if(!m)return null;
 let n=Number(m[1].replace(',','.'));if(!Number.isFinite(n))return null;
 let unit=(m[2]||'').toLowerCase();
 if(unit==='k')n*=1e3;else if(unit==='m')n*=1e6;else if(unit==='b')n*=1e9;
 return n;
}
function catalogFilterDate(raw){
 raw=String(raw||'').trim();
 let parts=raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
 let d=parts?new Date(+(parts[3].length===2?'20'+parts[3]:parts[3]),+parts[2]-1,+parts[1]):new Date(raw);
 if(isNaN(d))return null;
 return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
}
function catalogFilterMatch(value,filter,type){
 filter=String(filter||'').trim();if(!filter)return true;
 if(type==='number'){
  let n=N(value);if(n===null)return false;
  let compact=filter.replace(/\s+/g,'');
  if(/^(?:>|<|>=|<=|=|-)?$/.test(compact))return true;
  let range=compact.match(/^(.+?)\.\.(.+)$/);
  if(range){
   let a=catalogFilterNumber(range[1]),b=catalogFilterNumber(range[2]);
   if(a===null||b===null)return true;
   let lo=Math.min(a,b),hi=Math.max(a,b);return n>=lo&&n<=hi;
  }
  let m=compact.match(/^(>=|<=|>|<|=)?(.+)$/);if(!m)return true;
  let target=catalogFilterNumber(m[2]);if(target===null)return true;
  let op=m[1]||'=';
  if(op==='>')return n>target;if(op==='<')return n<target;if(op==='>=')return n>=target;if(op==='<=')return n<=target;return Math.abs(n-target)<1e-9;
 }
 if(type==='date'){
  let n=N(value);if(n===null)return false;
  let compact=filter.trim(),range=compact.match(/^(.+?)\.\.(.+)$/);
  let current=new Date(n),cur=new Date(current.getFullYear(),current.getMonth(),current.getDate()).getTime();
  if(range){
   let a=catalogFilterDate(range[1]),b=catalogFilterDate(range[2]);if(a===null||b===null)return true;
   return cur>=Math.min(a,b)&&cur<=Math.max(a,b);
  }
  let m=compact.match(/^\s*(>=|<=|>|<|=)?\s*(.*?)\s*$/),op=m&&m[1]||'=',target=catalogFilterDate(m&&m[2]);
  if(target===null)return true;
  if(op==='>')return cur>target;if(op==='<')return cur<target;if(op==='>=')return cur>=target;if(op==='<=')return cur<=target;return cur===target;
 }
 let hay=String(value??'').toLocaleLowerCase('es');
 let terms=filter.toLocaleLowerCase('es').split('|').map(x=>x.trim()).filter(Boolean);
 return terms.length?terms.some(term=>hay.includes(term)):true;
}
function catalogSortValue(v,type){if(v===null||v===undefined||v==='')return type==='text'?'':-Infinity;return type==='text'?String(v).toLowerCase():Number(v)}
function catalogActiveFilterCount(mode){return Object.values(catalogState[mode]?.filters||{}).filter(v=>String(v||'').trim()).length}
function catalogMobileGroup(mode){
 let key=catalogState[mode]?.mobileGroup||'general';
 return CATALOG_MOBILE_GROUPS.find(g=>g.key===key)||CATALOG_MOBILE_GROUPS[0];
}
function catalogMobileTabs(mode){
 let active=catalogMobileGroup(mode).key;
 return '<nav class="catalog-mobile-groups" aria-label="Datos del catálogo">'+CATALOG_MOBILE_GROUPS.map(g=>
  '<button type="button" class="'+(g.key===active?'active':'')+'" data-catalog-mobile-group="'+E(g.key)+'" data-catalog-mode="'+mode+'" aria-pressed="'+(g.key===active?'true':'false')+'">'+E(g.label)+'</button>'
 ).join('')+'</nav>';
}
function catalogMobileCell(mode,s,se,colId){
 let col=CATALOG_COLUMNS[mode].find(c=>c.id===colId);
 if(!col)return{label:colId,value:'—',tone:'text'};
 let raw=col.value(s,se),html=col.cell(s,se),value='';
 if(colId==='priceEur'||colId==='priceUsd'){
  let preferTr=mode==='tr',q=preferTr?canonicalQuote(s,true):verifiedDisplayQuote(s,false,se),n=N(q&&q.price),change=N(q&&q.change);
  let sym=q&&q.nativeCurrency==='EUR'?'€':'\u0024';
  value=quoteMoney(n,sym,quotePrecision(s,q&&q.nativeCurrency==='EUR',SP(s,se)));
  let tone=n===null?'muted':change===null?'text':change>=0?'positive':'negative';
  let source=q&&q.fallback?'<small class="asset-quote-source">EEUU ref.</small>':'';
  return{label:col.label,value,tone,html:'<span class="asset-price-value">'+E(value)+'</span>'+source};
 }else if(colId==='change'){
  let q=mode==='tr'?canonicalQuote(s,true):verifiedDisplayQuote(s,false,se),n=N(q&&q.change);value=PC(n);
  return{label:col.label,value,tone:n===null?'muted':n>=0?'positive':'negative'};
 }else if(['week','month'].includes(colId)){
  let n=N(raw);value=PC(n);return{label:col.label,value,tone:n===null?'muted':n>=0?'positive':'negative'};
 }else if(colId==='volume'||colId==='avgVolume'){
  value=compactVol(raw);
 }else if(colId==='relVolume'){
  value=N(raw)===null?'—':F(raw,2)+'×';
 }else if(colId==='rsi'||colId==='adx'){
  value=N(raw)===null?'—':F(raw,1);
 }else if(colId==='ema20'||colId==='ema50'){
  value=N(raw)===null?'—':PR(raw);
 }else if(colId==='bid'||colId==='ask'){
  let preferTr=mode==='tr',sym=preferTr?'€':'\u0024';
  value=quoteMoney(raw,sym,quotePrecision(s,preferTr));
 }else if(colId==='earnings'){
  value=raw?DF(raw):'—';
 }else{
  value=String(raw??'—');
 }
 return{label:col.label,value,tone:'text'};
}
function catalogMobileRow(mode,s,se){
 return standardStockCard(s,0,{se,preferTr:mode==='tr',context:'catalog',rankLabel:'',detailsHtml:''});
}
function catalogMobileList(mode,rows,se){
 return '<div class="catalog-mobile-rows unified-asset-list">'+rows.map(s=>catalogMobileRow(mode,s,se)).join('')+'</div>';
}

function catalogFilterOptions(mode,key){
 let rows=db.stocks.filter(s=>mode==='tr'?trTradable(s):market(s,'us'));
 return [...new Set(rows.map(s=>String(s&&s[key]||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es')).slice(0,250);
}
function renderCatalogFilterPanel(mode,cols){
 let st=catalogState[mode],host=$(mode==='tr'?'#catalogFilterPanelTr':'#catalogFilterPanelUs');if(!host)return;
 let inputs=cols.filter(c=>c.id!=='fav').map(c=>
  '<label><span>'+E(c.label)+'</span><input class="catalog-col-filter input" inputmode="'+(c.type==='number'?'decimal':'text')+'" data-mode="'+mode+'" data-col="'+E(c.id)+'" value="'+E(st.filters[c.id]||'')+'" placeholder="'+(c.type==='number'?'>10 · 10..30':c.type==='date'?'24/09/2026':'Contiene…')+'"></label>'
 ).join('');
 let sectorOpts='<option value="all">Todos</option>'+catalogFilterOptions(mode,'sector').map(v=>'<option '+(st.sector===v?'selected':'')+'>'+E(v)+'</option>').join('');
 let industryOpts='<option value="all">Todas</option>'+catalogFilterOptions(mode,'industry').map(v=>'<option '+(st.industry===v?'selected':'')+'>'+E(v)+'</option>').join('');
 let sortOpts=cols.filter(c=>c.id!=='fav').map(c=>'<option value="'+E(c.id)+'" '+(st.sort===c.id?'selected':'')+'>'+E(c.label)+'</option>').join('');
 host.innerHTML=
  '<div class="catalog-filter-primary">'+
   '<label><span>Sector</span><select class="select catalog-sector-filter" data-mode="'+mode+'">'+sectorOpts+'</select></label>'+
   '<label><span>Industria / tipo</span><select class="select catalog-industry-filter" data-mode="'+mode+'">'+industryOpts+'</select></label>'+
   '<label><span>Ordenar por</span><select class="select catalog-mobile-sort-select" data-mode="'+mode+'">'+sortOpts+'</select></label>'+
  '</div>'+
  '<details class="catalog-column-filters"><summary>Filtros avanzados por dato</summary><div class="catalog-mobile-filter-grid">'+inputs+'</div></details>'+
  '<div class="filter-actions"><button type="button" class="btn ghost catalog-reset-filter" data-catalog-mode="'+mode+'">Rehacer filtro</button><button type="button" class="btn secondary" data-filter-sheet-apply>Aplicar filtro</button></div>';
}

function catalogColumnUniqueValues(mode,col,se){
 const rows=db.stocks.filter(s=>mode==='tr'?trTradable(s):market(s,'us'));
 const seen=new Set(),out=[];
 for(const s of rows){
  const raw=col.value(s,se);
  const label=col.type==='number'
   ?(N(raw)===null?'':String(raw))
   :col.type==='date'?(raw?DF(raw):''):String(raw??'').trim();
  if(!label||seen.has(label))continue;
  seen.add(label);out.push(label);
  if(out.length>=40)break;
 }
 return out;
}
function ensureCatalogColumnFilterMenu(){
 let menu=document.querySelector('#catalogColumnFilterMenu');
 if(menu)return menu;
 menu=document.createElement('div');
 menu.id='catalogColumnFilterMenu';
 menu.className='column-filter-popover';
 menu.hidden=true;
 document.body.appendChild(menu);
 return menu;
}
function closeCatalogColumnFilterMenu(){
 const menu=document.querySelector('#catalogColumnFilterMenu');
 if(menu)menu.hidden=true;
}
function openCatalogColumnFilterMenu(button){
 const mode=button.dataset.mode,id=button.dataset.catalogFilterColumn,st=catalogState[mode];
 if(!st)return;
 const col=CATALOG_COLUMNS[mode].find(x=>x.id===id);if(!col)return;
 const menu=ensureCatalogColumnFilterMenu(),se=catalogSession(mode),current=String(st.filters[id]||'');
 const values=col.type==='html'?[]:catalogColumnUniqueValues(mode,col,se);
 menu.dataset.mode=mode;menu.dataset.col=id;
 menu.innerHTML=
  '<div class="column-filter-head"><strong>Filtrar · '+E(col.label)+'</strong><button type="button" data-column-filter-close aria-label="Cerrar">×</button></div>'+
  '<div class="column-filter-sort">'+
   '<button type="button" data-catalog-filter-sort="asc">↑ Ascendente</button>'+
   '<button type="button" data-catalog-filter-sort="desc">↓ Descendente</button>'+
  '</div>'+
  (col.id==='fav'?'':'<label class="column-filter-input"><span>'+(col.type==='number'?'Condición numérica':col.type==='date'?'Fecha / rango':'Texto contiene')+'</span><input class="input" data-catalog-filter-input value="'+E(current)+'" placeholder="'+(col.type==='number'?'>10 · 10..30':col.type==='date'?'01/10/2026 · 01/10/2026..31/10/2026':'Escribe para filtrar…')+'"></label>')+
  (values.length?'<div class="column-filter-values"><small>Valores frecuentes</small><div>'+values.slice(0,18).map(v=>'<button type="button" data-catalog-filter-value="'+E(v)+'" title="'+E(v)+'">'+E(v)+'</button>').join('')+'</div></div>':'')+
  '<div class="column-filter-actions"><button type="button" class="btn ghost" data-catalog-filter-clear>Limpiar</button><button type="button" class="btn secondary" data-catalog-filter-apply>Aplicar</button></div>';
 const rect=button.getBoundingClientRect(),width=Math.min(340,window.innerWidth-20);
 let left=Math.min(window.innerWidth-width-10,Math.max(10,rect.left-120));
 let top=Math.min(window.innerHeight-320,rect.bottom+6);if(top<10)top=10;
 menu.style.width=width+'px';menu.style.left=left+'px';menu.style.top=top+'px';menu.hidden=false;
 setTimeout(()=>menu.querySelector('[data-catalog-filter-input]')?.focus(),0);
}
function catalogTable(mode,rows,se){
 let cols=catalogColumns(mode),st=catalogState[mode],sortCol=cols.find(c=>c.id===st.sort)||cols[0],mobile=catalogIsMobile();
 rows=rows.filter(s=>cols.every(c=>catalogFilterMatch(c.value(s,se),st.filters[c.id],c.type)));
 rows.sort((x,y)=>{let av=catalogSortValue(sortCol.value(x,se),sortCol.type),bv=catalogSortValue(sortCol.value(y,se),sortCol.type);if(typeof av==='string')return av.localeCompare(bv)*st.dir;return ((av===bv)?0:(av>bv?1:-1))*st.dir});
 let step=catalogPageSize();
 if(!Number.isFinite(st.limit)||st.limit<step)st.limit=step;
 let total=rows.length,limit=st.limit,shown=rows.slice(0,limit);
 let moreButton=shown.length<total?'<button type="button" class="btn ghost catalog-load-more" data-catalog-mode="'+mode+'">Cargar '+Math.min(step,total-shown.length).toLocaleString('es-ES')+' más</button>':'';
 let footer='<div class="catalog-table-footer"><span><strong>'+total.toLocaleString('es-ES')+'</strong> valores · mostrando <strong>'+shown.length.toLocaleString('es-ES')+'</strong></span>'+moreButton+'</div>';
 if(mobile){
  return {html:(shown.length?catalogMobileList(mode,shown,se):'<div class="empty-state">No hay valores con estos filtros.</div>')+footer,count:total,shown:shown.length};
 }
 let widths=catalogWidths(mode);
 let colgroup='<colgroup>'+cols.map(c=>'<col data-catalog-col-width="'+E(c.id)+'" style="width:'+Math.round(widths[c.id]||110)+'px">').join('')+'</colgroup>';
 let head=cols.map(col=>{
  const activeFilter=String(st.filters[col.id]||'').trim()!=='';
  return '<th draggable="true" data-catalog-col="'+E(col.id)+'" data-mode="'+mode+'" data-help-title="'+E(col.label)+'" data-help="Haz clic para ordenar; arrastra para mover la columna; usa el borde derecho para cambiar su ancho." class="'+(st.sort===col.id?'sorted '+(st.dir>0?'asc':'desc'):'')+'">'+
   '<div class="catalog-th-content"><span>'+E(col.label)+'</span><i></i><button type="button" class="catalog-header-filter '+(activeFilter?'active':'')+'" data-catalog-filter-column="'+E(col.id)+'" data-mode="'+mode+'" aria-label="Filtrar '+E(col.label)+'" title="Filtrar '+E(col.label)+'"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z"/></svg></button></div>'+
   '<button type="button" class="catalog-column-resizer" data-catalog-resize="'+E(col.id)+'" data-mode="'+mode+'" aria-label="Cambiar ancho de '+E(col.label)+'" title="Arrastra para cambiar el ancho"></button></th>';
 }).join('');
 let body=shown.map(s=>'<tr class="catalog-row stock-open-row"'+stockOpenAttrs(s,'',mode==='tr')+'>'+cols.map(col=>'<td data-col="'+E(col.id)+'">'+col.cell(s,se)+'</td>').join('')+'</tr>').join('');
 return {html:'<div class="catalog-table-wrap"><table class="catalog-table catalog-resizable-table" data-mode="'+mode+'">'+colgroup+'<thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table></div>'+footer,count:total,shown:shown.length};
}
function renderCatalogTable(mode){
 let isTr=mode==='tr',search=$(isTr?'#catalogSearch':'#catalogUSSearch');if(!search)return;
 let q=search.value.trim().toLowerCase(),se=catalogSession(mode);
 let st=catalogState[mode];
 let rows=db.stocks.filter(s=>isTr?trTradable(s):market(s,'us')).filter(s=>!q||(((s.trTicker||'')+' '+(s.ticker||'')+' '+(s.name||'')+' '+(s.isin||'')+' '+(s.trIsin||'')+' '+(s.usIsin||'')+' '+(s.exchange||'')+' '+(s.sector||'')+' '+(s.industry||'')).toLowerCase().includes(q))).filter(s=>(st.sector==='all'||String(s.sector||'')===st.sector)&&(st.industry==='all'||String(s.industry||'')===st.industry));
 let out=catalogTable(mode,rows,se),box=$(isTr?'#catalogResults':'#catalogUSResults');box.innerHTML=out.html;renderCatalogFilterPanel(mode,catalogColumns(mode));
 let count=$(isTr?'#catalogCount':'#catalogUSCount');if(count)count.textContent=out.count.toLocaleString('es-ES')+(isTr?' valores TR':' valores EEUU')+(out.shown<out.count?' · mostrando '+out.shown.toLocaleString('es-ES'):'');
 requestAnimationFrame(()=>{observeTrLivePrices(box);pollUsLive()});
}
function resetCatalogColumns(mode){
 catalogState[mode].order=CATALOG_COLUMNS[mode].map(c=>c.id);catalogState[mode].widths=catalogDefaultWidths(mode);catalogState[mode].filters={};catalogState[mode].sector='all';catalogState[mode].industry='all';catalogState[mode].sort=mode==='tr'?'tickerTr':'ticker';catalogState[mode].dir=1;catalogResetLimit(mode);catalogSaveLayout(mode);renderCatalogTable(mode);
}
function renderCatalog(){renderCatalogTable('tr')}
function renderCatalogUS(){renderCatalogTable('us')}

function initCatalogInteractions(){
 let catalogSearchTimer=null;
 $('#catalogSearch').addEventListener('input',()=>{catalogResetLimit('tr');clearTimeout(catalogSearchTimer);catalogSearchTimer=setTimeout(renderCatalog,220)});
 $('#catalogUSSearch').addEventListener('input',()=>{catalogResetLimit('us');clearTimeout(catalogSearchTimer);catalogSearchTimer=setTimeout(renderCatalogUS,220)});
 document.addEventListener('change',e=>{
  let sort=e.target.closest&&e.target.closest('.catalog-mobile-sort-select');
  if(sort){let mode=sort.dataset.mode;if(catalogState[mode]){catalogState[mode].sort=sort.value;catalogResetLimit(mode);renderCatalogTable(mode)}return}
  let sector=e.target.closest&&e.target.closest('.catalog-sector-filter');
  if(sector){let mode=sector.dataset.mode;if(catalogState[mode]){catalogState[mode].sector=sector.value;catalogResetLimit(mode);renderCatalogTable(mode)}return}
  let industry=e.target.closest&&e.target.closest('.catalog-industry-filter');
  if(industry){let mode=industry.dataset.mode;if(catalogState[mode]){catalogState[mode].industry=industry.value;catalogResetLimit(mode);renderCatalogTable(mode)}return}
 });
 
 let catalogFilterTimer=null;
 document.addEventListener('input',e=>{
  let f=e.target.closest&&e.target.closest('.catalog-col-filter');if(!f)return;
  let mode=f.dataset.mode,col=f.dataset.col;if(!catalogState[mode]||!col)return;
  catalogState[mode].filters[col]=f.value;catalogResetLimit(mode);clearTimeout(catalogFilterTimer);
  catalogFilterTimer=setTimeout(()=>{
   renderCatalogTable(mode);
   let next=document.querySelector('.catalog-col-filter[data-mode="'+mode+'"][data-col="'+col+'"]');
   if(next){next.focus();next.setSelectionRange(next.value.length,next.value.length)}
  },160);
 });
 document.addEventListener('click',e=>{
  const filterButton=e.target.closest&&e.target.closest('[data-catalog-filter-column]');
  if(filterButton){e.preventDefault();e.stopPropagation();openCatalogColumnFilterMenu(filterButton);return}
  const filterMenu=e.target.closest&&e.target.closest('#catalogColumnFilterMenu');
  if(filterMenu){
   const mode=filterMenu.dataset.mode,col=filterMenu.dataset.col,st=catalogState[mode];
   if(e.target.closest('[data-column-filter-close]')){closeCatalogColumnFilterMenu();return}
   const sort=e.target.closest('[data-catalog-filter-sort]');
   if(sort&&st){st.sort=col;st.dir=sort.dataset.catalogFilterSort==='desc'?-1:1;catalogResetLimit(mode);closeCatalogColumnFilterMenu();renderCatalogTable(mode);return}
   const value=e.target.closest('[data-catalog-filter-value]');
   if(value){const input=filterMenu.querySelector('[data-catalog-filter-input]');if(input)input.value=value.dataset.catalogFilterValue||'';return}
   if(e.target.closest('[data-catalog-filter-clear]')&&st){st.filters[col]='';catalogResetLimit(mode);closeCatalogColumnFilterMenu();renderCatalogTable(mode);return}
   if(e.target.closest('[data-catalog-filter-apply]')&&st){const input=filterMenu.querySelector('[data-catalog-filter-input]');st.filters[col]=input?input.value:'';catalogResetLimit(mode);closeCatalogColumnFilterMenu();renderCatalogTable(mode);return}
   return;
  }
  if(!e.target.closest('.column-filter-popover'))closeCatalogColumnFilterMenu();
  let mobileGroup=e.target.closest&&e.target.closest('[data-catalog-mobile-group]');
  if(mobileGroup){
   let mode=mobileGroup.dataset.catalogMode,key=mobileGroup.dataset.catalogMobileGroup;
   if(catalogState[mode]){catalogState[mode].mobileGroup=key||'general';renderCatalogTable(mode)}
   return;
  }
  let reset=e.target.closest&&e.target.closest('.catalog-reset-columns,.catalog-clear-filters,.catalog-reset-filter');
  if(reset){e.preventDefault();resetCatalogColumns(reset.dataset.catalogMode);return}
  let more=e.target.closest&&e.target.closest('.catalog-load-more');
  if(more){e.preventDefault();let mode=more.dataset.catalogMode;if(catalogState[mode]){catalogState[mode].limit=(catalogState[mode].limit||catalogPageSize())+catalogPageSize();renderCatalogTable(mode)}return}
  let sortDir=e.target.closest&&e.target.closest('.catalog-mobile-sort-dir');
  if(sortDir){e.preventDefault();let mode=sortDir.dataset.mode;if(catalogState[mode]){catalogState[mode].dir*=-1;catalogResetLimit(mode);renderCatalogTable(mode)}return}
  if(e.target.closest&&e.target.closest('.catalog-column-resizer,.catalog-header-filter'))return;
  let th=e.target.closest&&e.target.closest('.catalog-table thead tr:first-child th[data-catalog-col]');
  if(!th)return;
  let mode=th.dataset.mode,id=th.dataset.catalogCol,st=catalogState[mode];if(!st)return;
  if(st.sort===id)st.dir*=-1;else{st.sort=id;st.dir=1}catalogResetLimit(mode);renderCatalogTable(mode);
 });
 document.addEventListener('keydown',e=>{
  if(e.key!=='Enter')return;
  const input=e.target.closest&&e.target.closest('#catalogColumnFilterMenu [data-catalog-filter-input]');if(!input)return;
  const menu=input.closest('#catalogColumnFilterMenu'),mode=menu.dataset.mode,col=menu.dataset.col,st=catalogState[mode];if(!st)return;
  st.filters[col]=input.value;catalogResetLimit(mode);closeCatalogColumnFilterMenu();renderCatalogTable(mode);
 });
  let draggedCatalogCol=null;
 document.addEventListener('dragstart',e=>{
  let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(!th)return;
  draggedCatalogCol={mode:th.dataset.mode,id:th.dataset.catalogCol};th.classList.add('dragging');
  if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',th.dataset.catalogCol)}
 });
 document.addEventListener('dragend',()=>{document.querySelectorAll('.catalog-table th.dragging,.catalog-table th.drag-over').forEach(x=>x.classList.remove('dragging','drag-over'));draggedCatalogCol=null});
 document.addEventListener('dragover',e=>{let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(!th||!draggedCatalogCol||th.dataset.mode!==draggedCatalogCol.mode)return;e.preventDefault();th.classList.add('drag-over')});
 document.addEventListener('dragleave',e=>{let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(th)th.classList.remove('drag-over')});
 document.addEventListener('drop',e=>{
  let th=e.target.closest&&e.target.closest('th[data-catalog-col]');if(!th||!draggedCatalogCol||th.dataset.mode!==draggedCatalogCol.mode)return;e.preventDefault();
  let mode=draggedCatalogCol.mode,order=[...catalogLoadOrder(mode)],from=order.indexOf(draggedCatalogCol.id),to=order.indexOf(th.dataset.catalogCol);
  if(from<0||to<0||from===to)return;
  order.splice(from,1);order.splice(to,0,draggedCatalogCol.id);catalogState[mode].order=order;catalogSaveLayout(mode);renderCatalogTable(mode);
 });
 let catalogResize=null;
 document.addEventListener('pointerdown',e=>{
  const handle=e.target.closest&&e.target.closest('.catalog-column-resizer');if(!handle)return;
  e.preventDefault();e.stopPropagation();
  const mode=handle.dataset.mode,id=handle.dataset.catalogResize,th=handle.closest('th');if(!catalogState[mode]||!id||!th)return;
  catalogResize={mode,id,startX:e.clientX,startWidth:th.getBoundingClientRect().width};
  handle.setPointerCapture?.(e.pointerId);
  document.body.classList.add('column-resizing');
 });
 document.addEventListener('pointermove',e=>{
  if(!catalogResize)return;
  const {mode,id,startX,startWidth}=catalogResize,next=Math.max(42,Math.min(620,Math.round(startWidth+e.clientX-startX)));
  catalogWidths(mode)[id]=next;
  const table=document.querySelector('.catalog-table[data-mode="'+mode+'"]'),col=table&&table.querySelector('col[data-catalog-col-width="'+id+'"]');
  if(col)col.style.width=next+'px';
 });
 document.addEventListener('pointerup',()=>{
  if(!catalogResize)return;
  const mode=catalogResize.mode;catalogResize=null;document.body.classList.remove('column-resizing');catalogSaveLayout(mode);
 });
 ['tr','us'].forEach(mode=>{
  const current=catalogLayoutPreferences(mode);
  window.ViewInvAIUiPreferences?.load?.(catalogPrefScope(mode),current).then(prefs=>{
   catalogApplyPreferences(mode,prefs);
   if((mode==='tr'&&state.currentView==='catalog')||(mode==='us'&&state.currentView==='catalogUS'))renderCatalogTable(mode);
  }).catch(()=>{});
 });
 window.addEventListener('viewinvai:ui-preferences',event=>{
  const scope=String(event.detail&&event.detail.scope||'');
  const mode=scope==='catalog:tr'?'tr':scope==='catalog:us'?'us':'';
  if(!mode)return;catalogApplyPreferences(mode,event.detail.preferences||{});
  if((mode==='tr'&&state.currentView==='catalog')||(mode==='us'&&state.currentView==='catalogUS'))renderCatalogTable(mode);
 });
}
