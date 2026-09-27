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
  {id:'name',label:'Empresa',type:'text',value:s=>s.name||'',cell:s=>E(s.name||'—')},
  {id:'exchange',label:'Mercado',type:'text',value:s=>s.trExchange||'LSX',cell:s=>E(s.trExchange||'LSX')},
  {id:'priceEur',label:'Precio €',type:'number',value:(s,se)=>trPriceValues(s,SP(s,se)).eur,cell:(s,se)=>trPriceCell(s,'eur',se)},
  {id:'priceUsd',label:'Precio USD',type:'number',value:(s,se)=>trPriceValues(s,SP(s,se)).usd,cell:(s,se)=>trPriceCell(s,'usd',se)},
  {id:'change',label:'%',type:'number',value:(s,se)=>trLiveChange(s)??SC(s,se),cell:(s,se)=>liveChangeHtml(s,SC(s,se),true)},
  {id:'bid',label:'Bid €',type:'number',value:s=>N(s.trLiveBid),cell:s=>'<span class="table-live-number '+quoteDirClass(s.trLiveBidDirection)+'" data-tr-bid-key="'+E(stockKey(s))+'">'+quoteMoney(s.trLiveBid,'€',quotePrecision(s,true))+'</span>'},
  {id:'ask',label:'Ask €',type:'number',value:s=>N(s.trLiveAsk),cell:s=>'<span class="table-live-number '+quoteDirClass(s.trLiveAskDirection)+'" data-tr-ask-key="'+E(stockKey(s))+'">'+quoteMoney(s.trLiveAsk,'€',quotePrecision(s,true))+'</span>'},
  {id:'volume',label:'Vol. actual',type:'number',value:(s,se)=>SV(s,se),cell:(s,se)=>compactVol(SV(s,se))},
  {id:'avgVolume',label:'Vol. medio',type:'number',value:s=>N(s.avgVolume),cell:s=>compactVol(s.avgVolume)},
  {id:'relVolume',label:'Vol. rel.',type:'number',value:(s,se)=>RV(s,se),cell:(s,se)=>RV(s,se)===null?'—':F(RV(s,se),2)+'×'},
  {id:'premarketPrice',label:'Pre USD',type:'number',value:s=>N(s.premarketPrice),cell:s=>PR(s.premarketPrice)},
  {id:'premarketChange',label:'Pre %',type:'number',value:s=>N(s.premarketChangePct),cell:s=>PC(s.premarketChangePct)},
  {id:'premarketVolume',label:'Vol. pre',type:'number',value:s=>N(s.premarketVolume),cell:s=>compactVol(s.premarketVolume)},
  {id:'regularPrice',label:'Regular USD',type:'number',value:s=>N(s.price),cell:s=>PR(s.price)},
  {id:'regularChange',label:'Regular %',type:'number',value:s=>N(s.changePct),cell:s=>PC(s.changePct)},
  {id:'postmarketPrice',label:'Post USD',type:'number',value:s=>N(s.postmarketPrice),cell:s=>PR(s.postmarketPrice)},
  {id:'postmarketChange',label:'Post %',type:'number',value:s=>N(s.postmarketChangePct),cell:s=>PC(s.postmarketChangePct)},
  {id:'postmarketVolume',label:'Vol. post',type:'number',value:s=>N(s.postmarketVolume),cell:s=>compactVol(s.postmarketVolume)},
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
  {id:'name',label:'Empresa',type:'text',value:s=>s.name||'',cell:s=>E(s.name||'—')},
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
 {key:'market',label:'Mercado',tr:['bid','ask'],us:['bid','ask']},
 {key:'other',label:'Otros',tr:['exchange','earnings'],us:['exchange','earnings']}
];
const catalogState={tr:{sort:'tickerTr',dir:1,filters:{},order:null,limit:null,mobileGroup:'general'},us:{sort:'ticker',dir:1,filters:{},order:null,limit:null,mobileGroup:'general'}};
function catalogIsMobile(){return window.matchMedia&&window.matchMedia('(max-width:720px)').matches}
function catalogPageSize(){return catalogIsMobile()?CATALOG_MOBILE_PAGE_SIZE:CATALOG_PAGE_SIZE}
function catalogResetLimit(mode){if(catalogState[mode])catalogState[mode].limit=catalogPageSize()}
function catalogStorageKey(mode){return 'viewinvai:catalogColumns:'+mode+':v1'}
function catalogLoadOrder(mode){
 if(catalogState[mode].order)return catalogState[mode].order;
 let ids=CATALOG_COLUMNS[mode].map(c=>c.id),saved=[];
 try{saved=JSON.parse(localStorage.getItem(catalogStorageKey(mode))||'[]')}catch(_){}
 saved=Array.isArray(saved)?saved.filter(x=>ids.includes(x)):[];
 catalogState[mode].order=[...saved,...ids.filter(x=>!saved.includes(x))];
 return catalogState[mode].order;
}
function catalogSaveOrder(mode){try{localStorage.setItem(catalogStorageKey(mode),JSON.stringify(catalogState[mode].order||[]))}catch(_){}}
function catalogColumns(mode){let map=new Map(CATALOG_COLUMNS[mode].map(c=>[c.id,c]));return catalogLoadOrder(mode).map(id=>map.get(id)).filter(Boolean)}
function catalogSession(mode){let id=mode==='tr'?'#catalogSession':'#catalogUSSession',v=$(id)?.value||'auto';return v==='auto'?currentMarketSession():v}
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
  let preferTr=mode==='tr',q=canonicalQuote(s,preferTr),sym=colId==='priceEur'?'€':'\u0024';
  value=quoteMoney(colId==='priceEur'?q.eur:q.usd,sym,quotePrecision(s,preferTr,SP(s,se)));
 }else if(['change','week','month'].includes(colId)){
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
 let group=catalogMobileGroup(mode),ids=mode==='tr'?group.tr:group.us;
 let ticker=mode==='tr'?(s.trTicker||s.ticker||'—'):(s.ticker||'—');
 let isin=(mode==='tr'?(s.trIsin||s.isin):(s.usIsin||s.isin))||'—';
 return '<article class="catalog-mobile-line stock-open-row"'+stockOpenAttrs(s,'',mode==='tr')+'>'+
  '<div class="catalog-mobile-identity">'+favButton(s,mode==='tr')+'<span class="catalog-mobile-copy"><strong>'+E(s.name||ticker)+'</strong><button type="button" class="list-copy-isin" data-copy-isin="'+E(isin)+'">'+E(isin)+'</button><i>'+E(ticker)+'</i></span></div>'+
  ids.map(id=>{let cell=catalogMobileCell(mode,s,se,id);return '<span class="catalog-mobile-cell '+E(cell.tone)+'">'+E(cell.value)+'</span>'}).join('')+
  '<span class="catalog-mobile-open" aria-hidden="true">›</span>'+
 '</article>';
}
function catalogMobileList(mode,rows,se){
 let group=catalogMobileGroup(mode),ids=mode==='tr'?group.tr:group.us;
 return catalogMobileTabs(mode)+
  '<div class="catalog-mobile-compare">'+
   '<div class="catalog-mobile-head"><span>Valor / ISIN</span>'+ids.map(id=>'<span>'+E(CATALOG_COLUMNS[mode].find(c=>c.id===id)?.label||id)+'</span>').join('')+'<span></span></div>'+
   '<div class="catalog-mobile-rows">'+rows.map(s=>catalogMobileRow(mode,s,se)).join('')+'</div>'+
  '</div>';
}
function catalogMobileFilters(mode,cols){
 let st=catalogState[mode],active=catalogActiveFilterCount(mode);
 let inputs=cols.filter(c=>c.id!=='fav').map(c=>
  '<label><span>'+E(c.label)+'</span><input class="catalog-col-filter" inputmode="'+(c.type==='number'?'decimal':'text')+'" data-mode="'+mode+'" data-col="'+E(c.id)+'" value="'+E(st.filters[c.id]||'')+'" placeholder="'+(c.type==='number'?'>10 o 10..30':c.type==='date'?'24/09/2026':'Contiene…')+'"></label>'
 ).join('');
 let opts=cols.filter(c=>c.id!=='fav').map(c=>'<option value="'+E(c.id)+'" '+(st.sort===c.id?'selected':'')+'>'+E(c.label)+'</option>').join('');
 return '<div class="catalog-mobile-tools">'+
   '<div class="catalog-mobile-sort"><label><span>Ordenar</span><select class="select catalog-mobile-sort-select" data-mode="'+mode+'">'+opts+'</select></label><button type="button" class="btn ghost catalog-mobile-sort-dir" data-mode="'+mode+'" aria-label="Cambiar sentido">'+(st.dir>0?'↑':'↓')+'</button></div>'+
   '<details class="catalog-mobile-filters" '+(active?'open':'')+'><summary><span>Filtros por columna</span><b>'+active+(active===1?' activo':' activos')+'</b></summary><div class="catalog-mobile-filter-grid">'+inputs+'</div></details>'+
  '</div>';
}
function catalogTable(mode,rows,se){
 let cols=catalogColumns(mode),st=catalogState[mode],sortCol=cols.find(c=>c.id===st.sort)||cols[0],mobile=catalogIsMobile();
 rows=rows.filter(s=>cols.every(c=>catalogFilterMatch(c.value(s,se),st.filters[c.id],c.type)));
 rows.sort((x,y)=>{let av=catalogSortValue(sortCol.value(x,se),sortCol.type),bv=catalogSortValue(sortCol.value(y,se),sortCol.type);if(typeof av==='string')return av.localeCompare(bv)*st.dir;return ((av===bv)?0:(av>bv?1:-1))*st.dir});
 let step=catalogPageSize();
 if(!Number.isFinite(st.limit)||st.limit<step)st.limit=step;
 let total=rows.length,limit=st.limit,shown=rows.slice(0,limit);
 let more=shown.length<total?'<div class="catalog-more"><button type="button" class="btn ghost catalog-load-more" data-catalog-mode="'+mode+'">Cargar '+Math.min(step,total-shown.length).toLocaleString('es-ES')+' más</button><span>Mostrando '+shown.length.toLocaleString('es-ES')+' de '+total.toLocaleString('es-ES')+'</span></div>':'';
 if(mobile){
  return {html:catalogMobileFilters(mode,cols)+(shown.length?catalogMobileList(mode,shown,se):'<div class="empty-state">No hay valores con estos filtros.</div>')+more,count:total,shown:shown.length};
 }
 let head=cols.map(c=>'<th draggable="true" data-catalog-col="'+E(c.id)+'" data-mode="'+mode+'" data-help-title="'+E(c.label)+'" data-help="Haz clic para ordenar por '+E(c.label)+'. Vuelve a pulsar para invertir el orden. También puedes arrastrar la cabecera para mover esta columna." class="'+(st.sort===c.id?'sorted '+(st.dir>0?'asc':'desc'):'')+'"><span>'+E(c.label)+'</span><i></i></th>').join('');
 let filters=cols.map(c=>c.id==='fav'?'<th></th>':'<th><input class="catalog-col-filter" data-mode="'+mode+'" data-col="'+E(c.id)+'" data-help-title="Filtro · '+E(c.label)+'" data-help="Filtra '+E(c.label)+'. Números: &gt;10, &lt;5, 10..30, 250k, 2.5m. Texto: usa | para alternativas." value="'+E(st.filters[c.id]||'')+'" placeholder="'+(c.type==='number'?'>10 / 10..30':'Filtrar')+'"></th>').join('');
 let body=shown.map(s=>'<tr class="catalog-row stock-open-row"'+stockOpenAttrs(s,'',mode==='tr')+'>'+cols.map(c=>'<td data-col="'+E(c.id)+'">'+c.cell(s,se)+'</td>').join('')+'</tr>').join('');
 return {html:'<div class="catalog-table-wrap"><table class="catalog-table" data-mode="'+mode+'"><thead><tr>'+head+'</tr><tr class="catalog-filter-row">'+filters+'</tr></thead><tbody>'+body+'</tbody></table></div>'+more,count:total,shown:shown.length};
}
function renderCatalogTable(mode){
 let isTr=mode==='tr',search=$(isTr?'#catalogSearch':'#catalogUSSearch');if(!search)return;
 let q=search.value.trim().toLowerCase(),se=catalogSession(mode);
 let rows=db.stocks.filter(s=>isTr?trTradable(s):market(s,'us')).filter(s=>!q||(((s.trTicker||'')+' '+(s.ticker||'')+' '+(s.name||'')+' '+(s.isin||'')+' '+(s.trIsin||'')+' '+(s.usIsin||'')+' '+(s.exchange||'')).toLowerCase().includes(q)));
 let out=catalogTable(mode,rows,se),box=$(isTr?'#catalogResults':'#catalogUSResults');box.innerHTML=out.html;
 let count=$(isTr?'#catalogCount':'#catalogUSCount');count.textContent=out.count.toLocaleString('es-ES')+(isTr?' valores TR':' valores EEUU')+(out.shown<out.count?' · mostrando '+out.shown.toLocaleString('es-ES'):'');
 requestAnimationFrame(()=>{observeTrLivePrices(box);pollUsLive()});
}
function resetCatalogColumns(mode){
 catalogState[mode].order=CATALOG_COLUMNS[mode].map(c=>c.id);catalogState[mode].filters={};catalogState[mode].sort=mode==='tr'?'tickerTr':'ticker';catalogState[mode].dir=1;catalogResetLimit(mode);catalogSaveOrder(mode);renderCatalogTable(mode);
}
function renderCatalog(){renderCatalogTable('tr')}
function renderCatalogUS(){renderCatalogTable('us')}

function initCatalogInteractions(){
 let catalogSearchTimer=null;
 $('#catalogSearch').addEventListener('input',()=>{catalogResetLimit('tr');clearTimeout(catalogSearchTimer);catalogSearchTimer=setTimeout(renderCatalog,220)});
 $('#catalogUSSearch').addEventListener('input',()=>{catalogResetLimit('us');clearTimeout(catalogSearchTimer);catalogSearchTimer=setTimeout(renderCatalogUS,220)});
 document.addEventListener('change',e=>{
  let sort=e.target.closest&&e.target.closest('.catalog-mobile-sort-select');if(!sort)return;
  let mode=sort.dataset.mode;if(!catalogState[mode])return;
  catalogState[mode].sort=sort.value;catalogResetLimit(mode);renderCatalogTable(mode);
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
  let mobileGroup=e.target.closest&&e.target.closest('[data-catalog-mobile-group]');
  if(mobileGroup){
   let mode=mobileGroup.dataset.catalogMode,key=mobileGroup.dataset.catalogMobileGroup;
   if(catalogState[mode]){catalogState[mode].mobileGroup=key||'general';renderCatalogTable(mode)}
   return;
  }
  let reset=e.target.closest&&e.target.closest('.catalog-reset-columns');
  if(reset){e.preventDefault();resetCatalogColumns(reset.dataset.catalogMode);return}
  let clear=e.target.closest&&e.target.closest('.catalog-clear-filters');
  if(clear){e.preventDefault();let mode=clear.dataset.catalogMode;if(catalogState[mode]){catalogState[mode].filters={};catalogResetLimit(mode);renderCatalogTable(mode)}return}
  let more=e.target.closest&&e.target.closest('.catalog-load-more');
  if(more){e.preventDefault();let mode=more.dataset.catalogMode;if(catalogState[mode]){catalogState[mode].limit=(catalogState[mode].limit||catalogPageSize())+catalogPageSize();renderCatalogTable(mode)}return}
  let sortDir=e.target.closest&&e.target.closest('.catalog-mobile-sort-dir');
  if(sortDir){e.preventDefault();let mode=sortDir.dataset.mode;if(catalogState[mode]){catalogState[mode].dir*=-1;catalogResetLimit(mode);renderCatalogTable(mode)}return}
  let th=e.target.closest&&e.target.closest('.catalog-table thead tr:first-child th[data-catalog-col]');
  if(!th)return;
  let mode=th.dataset.mode,id=th.dataset.catalogCol,st=catalogState[mode];if(!st)return;
  if(st.sort===id)st.dir*=-1;else{st.sort=id;st.dir=1}catalogResetLimit(mode);renderCatalogTable(mode);
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
  order.splice(from,1);order.splice(to,0,draggedCatalogCol.id);catalogState[mode].order=order;catalogSaveOrder(mode);renderCatalogTable(mode);
 });
}
