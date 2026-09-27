/*
 * ViewInvAI compact mobile lists
 * ------------------------------
 * Shared presentation layer for large mobile stock/catalog lists.
 * Keeps identity fixed and swaps comparable metrics by horizontal tabs.
 */
(function(root){
 'use strict';

 const MAX_WIDTH=760;
 const STOCK_GROUPS=[
  {key:'general',label:'General',cells:[
   {label:'Precio',render:(s,se,tr)=>tr?trPriceCell(s,'eur',se):usPriceCell(s,'usd',se)},
   {label:'%',render:(s,se,tr)=>liveChangeHtml(s,SC(s,se),tr)}
  ]},
  {key:'returns',label:'Rentab.',cells:[
   {label:'1 sem.',render:s=>tonePct(s.perfWeek)},
   {label:'1 mes',render:s=>tonePct(s.perfMonth)}
  ]},
  {key:'sessions',label:'Sesiones',cells:[
   {label:'Pre',render:s=>tonePct(s.premarketChangePct)},
   {label:'Regular',render:s=>tonePct(s.changePct)},
   {label:'Post',render:s=>tonePct(s.postmarketChangePct)}
  ]},
  {key:'market',label:'Mercado',cells:[
   {label:'Bid',render:(s,se,tr)=>quoteCell(s,'bid',tr)},
   {label:'Ask',render:(s,se,tr)=>quoteCell(s,'ask',tr)},
   {label:'Vol.',render:(s,se,tr)=>compactVol(tr?SV(s,se):(N(s.usLiveVolume)??SV(s,se)))}
  ]},
  {key:'technical',label:'Técnicos',cells:[
   {label:'RV',render:(s,se)=>RV(s,se)===null?'—':F(RV(s,se),2)+'×'},
   {label:'RSI',render:s=>F(s.rsi,1)},
   {label:'ADX',render:s=>F(s.adx,1)}
  ]},
  {key:'trend',label:'Tendencia',cells:[
   {label:'EMA20',render:s=>PR(s.ema20)},
   {label:'EMA50',render:s=>PR(s.ema50)}
  ]},
  {key:'other',label:'Otros',cells:[
   {label:'IA',render:(s,se,tr,ctx)=>'<span class="compact-text-cell">'+E(ctx.insight||'Seguimiento')+'</span>'},
   {label:'Resultados',render:s=>s.earningsDate?DF(s.earningsDate):'—'},
   {label:'Fuente',render:(s,se,tr)=>'<span class="compact-text-cell">'+E(tr?(s.trLiveQuality||'LSX'):(s.usLiveIsRealTime?'Nasdaq RT':(s.updateMode||'—')))+'</span>'}
  ]}
 ];
 const CATALOG_GROUPS=[
  {key:'general',label:'General',tr:[['priceEur','Precio'],['change','%']],us:[['priceUsd','Precio'],['change','%']]},
  {key:'returns',label:'Rentab.',tr:[['week','1 sem.'],['month','1 mes']],us:[['week','1 sem.'],['month','1 mes']]},
  {key:'sessions',label:'Sesiones',tr:[['premarketChange','Pre'],['regularChange','Regular'],['postmarketChange','Post']],us:[['premarketChange','Pre'],['regularChange','Regular'],['postmarketChange','Post']]},
  {key:'market',label:'Mercado',tr:[['bid','Bid'],['ask','Ask'],['volume','Vol.']],us:[['bid','Bid'],['ask','Ask'],['volume','Vol.']]},
  {key:'technical',label:'Técnicos',tr:[['relVolume','RV'],['rsi','RSI'],['adx','ADX']],us:[['relVolume','RV'],['rsi','RSI'],['adx','ADX']]},
  {key:'trend',label:'Tendencia',tr:[['ema20','EMA20'],['ema50','EMA50']],us:[['ema20','EMA20'],['ema50','EMA50']]},
  {key:'other',label:'Otros',tr:[['earnings','Resultados'],['feed','Fuente']],us:[['earnings','Resultados'],['feed','Fuente'],['updated','Actualización']]}
 ];

 let activeStockGroup=readStoredGroup();
 let patched=false;
 let observer=null;
 let baseStockCard=null;
 let baseCatalogMobileCard=null;
 let baseCatalogMobileFilters=null;

 function compactView(){
  return document.documentElement.dataset.nativeApp==='1'||!!(root.matchMedia&&root.matchMedia('(max-width:'+MAX_WIDTH+'px)').matches);
 }
 function readStoredGroup(){
  try{
   const value=localStorage.getItem('viewinvai:compactStockGroup');
   return STOCK_GROUPS.some(g=>g.key===value)?value:'general';
  }catch(_){return'general'}
 }
 function storeGroup(value){try{localStorage.setItem('viewinvai:compactStockGroup',value)}catch(_){}}
 function tonePct(value){
  const n=N(value);return '<span class="'+C(n)+'">'+PC(n)+'</span>';
 }
 function quoteCell(s,side,preferTr){
  const key=stockKey(s),symbol=preferTr?'€':'$';
  const value=preferTr?N(side==='bid'?s.trLiveBid:s.trLiveAsk):(side==='bid'?usLiveBid(s):usLiveAsk(s));
  const dir=preferTr?(side==='bid'?s.trLiveBidDirection:s.trLiveAskDirection):(side==='bid'?s.usLiveBidDirection:s.usLiveAskDirection);
  const attr=preferTr?'data-tr-'+side+'-key':'data-us-'+side+'-key';
  return '<span class="table-live-number '+quoteDirClass(dir)+'" '+attr+'="'+E(key)+'">'+quoteMoney(value,symbol,quotePrecision(s,preferTr))+'</span>';
 }
 function stockIsin(s,preferTr){
  return String(preferTr?(s.trIsin||s.isin||s.usIsin||''):(s.usIsin||s.isin||s.trIsin||'')).trim();
 }
 function stockTicker(s,preferTr){return String(preferTr?(s.trTicker||s.ticker||''):(s.ticker||s.trTicker||'')).trim()}
 function stockExchange(s,preferTr){return String(preferTr?(s.trExchange||'LSX'):(s.exchange||'EEUU')).trim()}
 function stockGroup(){return STOCK_GROUPS.find(g=>g.key===activeStockGroup)||STOCK_GROUPS[0]}
 function stockMetricHtml(s,se,preferTr,ctx){
  return STOCK_GROUPS.map(group=>group.cells.map((cell,index)=>
   '<span class="compact-stock-metric" data-stock-list-group="'+group.key+'" data-compact-index="'+index+'">'+safeRender(()=>cell.render(s,se,preferTr,ctx))+'</span>'
  ).join('')).join('');
 }
 function safeRender(fn){try{const value=fn();return value===null||value===undefined||value===''?'—':String(value)}catch(_){return'—'}}
 function compactStandardStockCard(s,i=0,opts={}){
  if(!compactView())return baseStockCard(s,i,opts);
  const se=opts.se||SES(),preferTr=opts.preferTr===true;
  const ticker=stockTicker(s,preferTr),isin=stockIsin(s,preferTr),exchange=stockExchange(s,preferTr);
  const hint=opts.hint||why(s,se,preferTr),insight=opts.insight||listInsightLabel(s,se,preferTr);
  const attrs=opts.openAttrs!==undefined?String(opts.openAttrs||''):stockOpenAttrs(s,hint,preferTr);
  const rank=opts.rankLabel!==undefined?String(opts.rankLabel):'#'+(i+1);
  const info=hint?'<button type="button" class="compact-stock-info" data-compact-info="'+E(hint)+'" aria-label="Ver explicación">ⓘ</button>':'';
  const copy=isin?'<button type="button" class="compact-copy-isin" data-copy-isin="'+E(isin)+'" title="Copiar ISIN">'+E(isin)+'</button>':'<span class="compact-copy-isin disabled">Sin ISIN</span>';
  const meta=[rank,ticker,exchange].filter(Boolean).map(E).join(' · ');
  return '<article class="compact-stock-row stock-open-row '+(opts.className?E(opts.className):'')+'"'+attrs+' title="'+E(hint||'')+'">'+
   '<div class="compact-stock-id">'+favButton(s,preferTr)+'<div class="compact-stock-copy"><strong class="compact-stock-name">'+E(s.name||ticker||'—')+'</strong>'+copy+'<small>'+meta+' '+info+'</small></div></div>'+
   '<div class="compact-stock-values">'+stockMetricHtml(s,se,preferTr,{insight,hint,contextHtml:opts.contextHtml||''})+'</div>'+
   '<span class="compact-stock-arrow" aria-hidden="true">›</span>'+
  '</article>';
 }
 function stockTabsHtml(){
  return '<div class="compact-stock-list-toolbar">'+
   '<nav class="compact-stock-groups" aria-label="Datos de acciones">'+STOCK_GROUPS.map(g=>'<button type="button" data-stock-compact-group="'+g.key+'" aria-pressed="'+(g.key===activeStockGroup?'true':'false')+'" class="'+(g.key===activeStockGroup?'active':'')+'">'+E(g.label)+'</button>').join('')+'</nav>'+
   '<div class="compact-stock-head"><span>Acción / ISIN</span><div class="compact-stock-head-values"></div><span></span></div>'+
  '</div>';
 }
 function decorateStockLists(rootNode=document){
  if(!compactView())return;
  const rows=rootNode.querySelectorAll?rootNode.querySelectorAll('.compact-stock-row'):[];
  rows.forEach(row=>{
   const parent=row.parentElement;if(!parent)return;
   const exists=Array.from(parent.children).some(child=>child.classList&&child.classList.contains('compact-stock-list-toolbar'));
   if(!exists)parent.insertAdjacentHTML('afterbegin',stockTabsHtml());
  });
  decorateFundIsins(rootNode);
  applyStockGroup(activeStockGroup);
 }
 function applyStockGroup(key){
  if(!STOCK_GROUPS.some(g=>g.key===key))key='general';
  activeStockGroup=key;storeGroup(key);
  const group=stockGroup();
  document.querySelectorAll('.compact-stock-metric').forEach(cell=>{cell.hidden=cell.dataset.stockListGroup!==key});
  document.querySelectorAll('[data-stock-compact-group]').forEach(button=>{
   const on=button.dataset.stockCompactGroup===key;button.classList.toggle('active',on);button.setAttribute('aria-pressed',on?'true':'false');
  });
  document.querySelectorAll('.compact-stock-head-values').forEach(head=>{
   head.style.setProperty('--compact-cols',String(group.cells.length));
   head.innerHTML=group.cells.map(cell=>'<span>'+E(cell.label)+'</span>').join('');
  });
  document.querySelectorAll('.compact-stock-values').forEach(values=>values.style.setProperty('--compact-cols',String(group.cells.length)));
 }
 function decorateFundIsins(rootNode=document){
  if(!rootNode.querySelectorAll)return;
  rootNode.querySelectorAll('.fund-mobile-name small').forEach(el=>{
   el.classList.add('compact-copy-fund-isin');el.title='Copiar ISIN';el.setAttribute('role','button');el.setAttribute('tabindex','0');
  });
 }
 function catalogGroup(mode){
  const key=catalogState[mode].mobileGroup||'general';
  return CATALOG_GROUPS.find(g=>g.key===key)||CATALOG_GROUPS[0];
 }
 function catalogGroupColumns(mode){const group=catalogGroup(mode);return mode==='tr'?group.tr:group.us}
 function catalogColumn(mode,id){return CATALOG_COLUMNS[mode].find(c=>c.id===id)||null}
 function catalogIdentity(s,mode){
  const tr=mode==='tr',ticker=stockTicker(s,tr),isin=stockIsin(s,tr),exchange=stockExchange(s,tr);
  const copy=isin?'<button type="button" class="compact-copy-isin" data-copy-isin="'+E(isin)+'" title="Copiar ISIN">'+E(isin)+'</button>':'<span class="compact-copy-isin disabled">Sin ISIN</span>';
  return '<div class="compact-catalog-id">'+favButton(s,tr)+'<div><strong>'+E(s.name||ticker||'—')+'</strong>'+copy+'<small>'+E([ticker,exchange].filter(Boolean).join(' · '))+'</small></div></div>';
 }
 function compactCatalogMobileCard(mode,s,se){
  if(!compactView())return baseCatalogMobileCard(mode,s,se);
  const tr=mode==='tr',cols=catalogGroupColumns(mode);
  return '<article class="catalog-mobile-row stock-open-row" style="--compact-cols:'+cols.length+'"'+stockOpenAttrs(s,'',tr)+'>'+
   catalogIdentity(s,mode)+
   '<div class="compact-catalog-values">'+cols.map(([id])=>{const col=catalogColumn(mode,id);return '<span>'+safeRender(()=>col?col.cell(s,se):'—')+'</span>'}).join('')+'</div>'+
   '<span class="catalog-mobile-arrow">›</span>'+
  '</article>';
 }
 function catalogTabsHtml(mode){
  const current=catalogState[mode].mobileGroup||'general';
  return '<nav class="catalog-mobile-groups" aria-label="Datos del catálogo">'+CATALOG_GROUPS.map(g=>'<button type="button" data-catalog-mobile-group="'+g.key+'" data-mode="'+mode+'" aria-pressed="'+(g.key===current?'true':'false')+'" class="'+(g.key===current?'active':'')+'">'+E(g.label)+'</button>').join('')+'</nav>';
 }
 function compactCatalogMobileFilters(mode,cols){
  if(!compactView())return baseCatalogMobileFilters(mode,cols);
  if(!catalogState[mode].mobileGroup)catalogState[mode].mobileGroup='general';
  const groupCols=catalogGroupColumns(mode),head=groupCols.map(([,label])=>'<span>'+E(label)+'</span>').join('');
  return catalogTabsHtml(mode)+
   '<details class="compact-catalog-controls"><summary><span>Orden y filtros</span><b>'+catalogActiveFilterCount(mode)+' activos</b></summary>'+baseCatalogMobileFilters(mode,cols)+'</details>'+
   '<div class="compact-catalog-head" style="--compact-cols:'+groupCols.length+'"><span>Acción / ISIN</span><div>'+head+'</div><span></span></div>';
 }
 function copyText(value){
  value=String(value||'').trim();if(!value)return;
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(value).then(()=>showToast('ISIN copiado')).catch(()=>fallbackCopy(value));return}
  fallbackCopy(value);
 }
 function fallbackCopy(value){
  const area=document.createElement('textarea');area.value=value;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();
  try{document.execCommand('copy');showToast('ISIN copiado')}catch(_){showToast(value)}
  area.remove();
 }
 function showToast(text){
  let el=document.querySelector('.compact-list-toast');if(!el){el=document.createElement('div');el.className='compact-list-toast';document.body.appendChild(el)}
  el.textContent=text;el.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>el.classList.remove('show'),1300);
 }
 function showInfo(text){
  let el=document.querySelector('.compact-list-info');if(!el){el=document.createElement('div');el.className='compact-list-info';el.innerHTML='<div><button type="button" class="compact-list-info-close" aria-label="Cerrar">×</button><p></p></div>';document.body.appendChild(el)}
  el.querySelector('p').textContent=String(text||'');el.classList.add('show');
 }
 function onCaptureClick(e){
  const fundIsin=e.target.closest&&e.target.closest('.compact-copy-fund-isin');
  if(fundIsin){e.preventDefault();e.stopImmediatePropagation();copyText(fundIsin.textContent);return}
  const copy=e.target.closest&&e.target.closest('[data-copy-isin]');
  if(copy){e.preventDefault();e.stopImmediatePropagation();copyText(copy.dataset.copyIsin);return}
  const info=e.target.closest&&e.target.closest('[data-compact-info]');
  if(info){e.preventDefault();e.stopImmediatePropagation();showInfo(info.dataset.compactInfo);return}
  const close=e.target.closest&&e.target.closest('.compact-list-info-close');
  if(close){e.preventDefault();e.stopImmediatePropagation();close.closest('.compact-list-info')?.classList.remove('show')}
 }
 function onClick(e){
  const stockGroupButton=e.target.closest&&e.target.closest('[data-stock-compact-group]');
  if(stockGroupButton){e.preventDefault();e.stopPropagation();applyStockGroup(stockGroupButton.dataset.stockCompactGroup);return}
  const catalogGroupButton=e.target.closest&&e.target.closest('[data-catalog-mobile-group]');
  if(catalogGroupButton){
   e.preventDefault();e.stopPropagation();const mode=catalogGroupButton.dataset.mode,key=catalogGroupButton.dataset.catalogMobileGroup;
   if(catalogState[mode]&&CATALOG_GROUPS.some(g=>g.key===key)){catalogState[mode].mobileGroup=key;renderCatalogTable(mode)}
  }
 }
 function onKeydown(e){
  if((e.key==='Enter'||e.key===' ')&&e.target.classList&&e.target.classList.contains('compact-copy-fund-isin')){e.preventDefault();copyText(e.target.textContent)}
  if(e.key==='Escape')document.querySelector('.compact-list-info')?.classList.remove('show');
 }
 function injectStyles(){
  if(document.getElementById('viewinvaiCompactListsCss'))return;
  const style=document.createElement('style');style.id='viewinvaiCompactListsCss';style.textContent=`
@media (max-width:760px){
 .compact-stock-list-toolbar{grid-column:1/-1;width:100%;min-width:0;margin:0 0 2px}
 .compact-stock-groups,.catalog-mobile-groups{display:flex;gap:4px;overflow-x:auto;overscroll-behavior-inline:contain;scrollbar-width:none;padding:3px 1px 6px}
 .compact-stock-groups::-webkit-scrollbar,.catalog-mobile-groups::-webkit-scrollbar{display:none}
 .compact-stock-groups button,.catalog-mobile-groups button{flex:0 0 auto;border:0;border-bottom:2px solid transparent;background:transparent;color:inherit;opacity:.68;padding:7px 8px 6px;font:inherit;font-size:12px;white-space:nowrap}
 .compact-stock-groups button.active,.catalog-mobile-groups button.active{opacity:1;border-bottom-color:currentColor;font-weight:800}
 .compact-stock-head,.compact-catalog-head{display:grid;grid-template-columns:minmax(126px,1.15fr) minmax(0,1fr) 12px;gap:6px;align-items:end;padding:0 4px 5px;border-bottom:1px solid rgba(127,127,127,.25);font-size:10px;opacity:.62}
 .compact-stock-head-values,.compact-catalog-head>div{display:grid;grid-template-columns:repeat(var(--compact-cols,2),minmax(0,1fr));gap:5px;text-align:right}
 .compact-stock-row,.catalog-mobile-row{display:grid!important;grid-template-columns:minmax(126px,1.15fr) minmax(0,1fr) 12px!important;gap:6px!important;align-items:center!important;width:100%;min-width:0;margin:0!important;padding:8px 4px!important;border:0!important;border-bottom:1px solid rgba(127,127,127,.20)!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}
 .compact-stock-row:hover,.catalog-mobile-row:hover{background:rgba(127,127,127,.055)!important}
 .compact-stock-id,.compact-catalog-id{display:flex;align-items:flex-start;gap:5px;min-width:0}
 .compact-stock-id>.fav-star,.compact-catalog-id>.fav-star{flex:0 0 auto;margin-top:1px}
 .compact-stock-copy,.compact-catalog-id>div{display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-width:0}
 .compact-stock-name,.compact-catalog-id strong{display:-webkit-box;max-width:100%;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;font-size:12.5px;line-height:1.15;text-align:left}
 .compact-copy-isin{max-width:100%;overflow:hidden;text-overflow:ellipsis;border:0;background:transparent;color:inherit;opacity:.62;padding:0;font:inherit;font-size:9.5px;line-height:1.2;text-align:left;white-space:nowrap}
 button.compact-copy-isin{cursor:copy;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px}
 .compact-stock-copy small,.compact-catalog-id small{display:flex;align-items:center;gap:4px;max-width:100%;font-size:9px;opacity:.58;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .compact-stock-info{border:0;background:transparent;color:inherit;padding:0 1px;font:inherit;font-size:10px;opacity:.75}
 .compact-stock-values,.compact-catalog-values{display:grid;grid-template-columns:repeat(var(--compact-cols,2),minmax(0,1fr));gap:5px;align-items:center;min-width:0;text-align:right}
 .compact-stock-metric,.compact-catalog-values>span{min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:11px;font-weight:700;white-space:nowrap}
 .compact-stock-metric .price-pair,.compact-stock-metric .price-stack{justify-content:flex-end}
 .compact-stock-metric .price-pair>*:not(:first-child){display:none}
 .compact-text-cell{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:600}
 .compact-stock-arrow,.catalog-mobile-arrow{font-size:16px;opacity:.35;text-align:right}
 .catalog-mobile-card{display:none!important}
 .catalog-mobile-list{display:block!important}
 .compact-catalog-controls{margin:0 0 4px;border:0!important;background:transparent!important}
 .compact-catalog-controls>summary{display:flex;justify-content:space-between;align-items:center;padding:6px 2px;cursor:pointer;font-size:11px;opacity:.72;list-style:none}
 .compact-catalog-controls>summary::-webkit-details-marker{display:none}
 .compact-catalog-controls>summary b{font-size:10px;font-weight:700}
 .compact-catalog-controls .catalog-mobile-tools{margin:0 0 5px}
 .fund-mobile-name small.compact-copy-fund-isin{cursor:copy;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px}
}
html[data-native-app="1"] .compact-stock-list-toolbar,html[data-native-app="1"] .catalog-mobile-groups,html[data-native-app="1"] .compact-catalog-controls,html[data-native-app="1"] .compact-catalog-head{display:block}
html[data-native-app="1"] .compact-stock-head,html[data-native-app="1"] .compact-catalog-head{display:grid}
html[data-native-app="1"] .compact-stock-row,html[data-native-app="1"] .catalog-mobile-row{display:grid!important}
.compact-list-toast{position:fixed;left:50%;bottom:86px;z-index:10050;transform:translate(-50%,12px);opacity:0;pointer-events:none;padding:8px 12px;border-radius:999px;background:rgba(20,20,22,.94);color:#fff;font-size:12px;font-weight:700;transition:.18s ease}
.compact-list-toast.show{transform:translate(-50%,0);opacity:1}
.compact-list-info{position:fixed;inset:0;z-index:10040;display:none;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.32);padding:14px}
.compact-list-info.show{display:flex}
.compact-list-info>div{position:relative;width:min(560px,100%);max-height:45vh;overflow:auto;border-radius:16px;background:var(--panel,#17191f);color:var(--text,#f4f6fa);padding:18px 38px 18px 18px;box-shadow:0 12px 40px rgba(0,0,0,.35)}
.compact-list-info p{margin:0;line-height:1.45;font-size:13px}
.compact-list-info-close{position:absolute;right:10px;top:8px;border:0;background:transparent;color:inherit;font-size:24px;line-height:1}
`;
  document.head.appendChild(style);
 }
 function patchRenderers(){
  if(patched)return;patched=true;
  if(typeof root.standardStockCard==='function'){
   baseStockCard=root.standardStockCard;
   root.standardStockCard=compactStandardStockCard;
  }
  if(typeof root.catalogMobileCard==='function'){
   baseCatalogMobileCard=root.catalogMobileCard;
   root.catalogMobileCard=compactCatalogMobileCard;
  }
  if(typeof root.catalogMobileFilters==='function'){
   baseCatalogMobileFilters=root.catalogMobileFilters;
   root.catalogMobileFilters=compactCatalogMobileFilters;
  }
 }
 function startObserver(){
  if(observer)return;
  observer=new MutationObserver(records=>{
   if(!compactView())return;
   let needs=false;for(const record of records){if(record.addedNodes&&record.addedNodes.length){needs=true;break}}
   if(needs)requestAnimationFrame(()=>decorateStockLists(document));
  });
  observer.observe(document.body,{childList:true,subtree:true});
 }
 function init(){
  injectStyles();patchRenderers();
  document.addEventListener('click',onCaptureClick,true);
  document.addEventListener('click',onClick);
  document.addEventListener('keydown',onKeydown);
  startObserver();
  requestAnimationFrame(()=>decorateStockLists(document));
  root.addEventListener('resize',()=>requestAnimationFrame(()=>decorateStockLists(document)),{passive:true});
 }

 root.ViewInvAICompactLists={init,applyStockGroup,decorate:()=>decorateStockLists(document),groups:STOCK_GROUPS.map(g=>({key:g.key,label:g.label}))};
})(window);
