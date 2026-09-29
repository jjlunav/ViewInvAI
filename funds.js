/*
 * ViewInvAI funds & ETFs
 * ---------------------
 * Shared web/Android catalogue for index funds and ETFs.
 * Products are identified by ISIN; platform availability must be source-verified.
 */
(function(root){
 'use strict';

 const DATA='data/funds.json';
 const PERIODS=[
  ['1M','perf1M'],['3M','perf3M'],['6M','perf6M'],['YTD','perfYtd'],
  ['1A','perf1Y'],['3A','perf3Y'],['5A','perf5Y'],['10A','perf10Y'],['Hist.','perfSinceInception']
 ];
 const MOBILE_GROUPS=[
  {key:'returns',label:'Rentabilidad',columns:[['perfYtd','YTD'],['perf1Y','1A'],['perf3Y','3A']]},
  {key:'general',label:'Tipo',columns:[['type','Tipo'],['currency','Divisa']]},
  {key:'costs',label:'Costes',columns:[['ter','TER'],['trackingDifference','Tracking']]},
  {key:'market',label:'Mercado',columns:[['region','Región'],['index','Índice']]},
  {key:'operations',label:'Operativa',columns:[['distribution','Clase'],['platform','Plataforma']]},
  {key:'ratios',label:'Ratios',columns:[['volatility3Y','Vol. 3A'],['sharpe3Y','Sharpe'],['maxDrawdown','Drawdown']]},
  {key:'other',label:'Otros',columns:[['assetsUnderManagement','Patrimonio'],['freshness','Actualización']]}
 ];
 const state={products:[],meta:{},loaded:false,loading:false,query:'',platform:'all',type:'all',provider:'all',region:'all',distribution:'all',maxTer:null,sort:'perf1Y',sortDir:'desc',selectedIsin:null,mobileGroup:'returns'};
 const account={user:null,portfolios:[],positions:[],plans:[],selectedPortfolioId:null,loading:false};

 function q(s){return document.querySelector(s)}
 function nativeFundsView(){return document.documentElement.dataset.nativeApp==='1'}
 function compactFundsView(){return nativeFundsView()||!!(root.matchMedia&&root.matchMedia('(max-width:820px)').matches)}
 function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
 function num(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null}
 function pct(v){v=num(v);return v===null?'—':(v>=0?'+':'')+v.toLocaleString('es-ES',{maximumFractionDigits:2})+'%'}
 function money(v,c='EUR'){v=num(v);if(v===null)return'—';try{return v.toLocaleString('es-ES',{style:'currency',currency:c||'EUR',maximumFractionDigits:4})}catch(_){return v.toLocaleString('es-ES',{maximumFractionDigits:4})+' '+c}}
 function dateText(v){if(!v)return'—';let d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleDateString('es-ES'):'—'}
 function safeHttpsUrl(v){
  try{const u=new URL(String(v||''),location.href);return u.protocol==='https:'?u.href:''}catch(_){return''}
 }
 function ageText(v){
  if(!v)return'Sin fecha';
  let t=new Date(v).getTime();if(!Number.isFinite(t))return'Sin fecha';
  let age=Math.max(0,Date.now()-t);
  if(age<86400000)return'Actualizado hoy';
  let d=Math.max(1,Math.floor(age/86400000));
  return'Actualizado hace '+d+' '+(d===1?'día':'días');
 }
 function exactAgeText(v){
  if(!v)return'Sin hora';
  let t=typeof v==='number'?v:new Date(v).getTime();if(!Number.isFinite(t))return'Sin hora';
  let age=Math.max(0,Date.now()-t);
  if(age<5000)return'ahora';
  if(age<60000)return'hace '+Math.max(1,Math.floor(age/1000))+' s';
  if(age<3600000)return'hace '+Math.max(1,Math.floor(age/60000))+' min';
  if(age<86400000)return'hace '+Math.max(1,Math.floor(age/3600000))+' h';
  return'hace '+Math.max(1,Math.floor(age/86400000))+' d';
 }
 const fundLive={ws:null,connected:false,connecting:false,seq:1,subByIsin:new Map(),isinBySub:new Map(),payloadBySub:new Map(),wanted:new Set(),quotes:new Map(),observer:null,retry:null};
 function fundWsUrl(){
  if(root.ViewInvAIRuntime&&typeof root.ViewInvAIRuntime.websocketUrl==='function')return root.ViewInvAIRuntime.websocketUrl('/api/tr-live');
  return (location.protocol==='https:'?'wss://':'ws://')+location.host+'/api/tr-live';
 }
 function deltaDecode(s){try{return decodeURIComponent(String(s||'').replace(/\+/g,' '))}catch(_){return String(s||'')}}
 function applyDelta(prev,delta){
  prev=String(prev||'');let cursor=0,out='';
  for(const chunk of String(delta||'').split('\t')){
   if(!chunk)continue;const op=chunk[0],arg=chunk.slice(1);
   if(op==='+')out+=deltaDecode(arg);
   else if(op==='='){const n=Number(arg);if(!Number.isFinite(n)||n<0)throw Error('delta');out+=prev.slice(cursor,cursor+n);cursor+=n}
   else if(op==='-'){const n=Number(arg);if(!Number.isFinite(n)||n<0)throw Error('delta');cursor+=n}
   else throw Error('delta');
  }
  return out;
 }
 function liveQuote(isin){return fundLive.quotes.get(String(isin||'').toUpperCase())||null}
 function fundCurrentValue(p){const q=liveQuote(p.isin);return p.type==='etf'&&q&&num(q.price)!==null?num(q.price):num(p.nav)}
 function fundFreshness(p){
  const q=liveQuote(p.isin);
  if(p.type==='etf'&&q&&num(q.price)!==null){
   return {kind:'live',label:'En directo · '+exactAgeText(q.receivedAt),title:'Trade Republic / LSX · '+new Date(q.receivedAt).toLocaleString('es-ES')};
  }
  const at=p.valueDate||p.sourceUpdatedAt;
  if(p.type==='fund')return {kind:'nav',label:'VL oficial · '+ageText(at),title:'Valor liquidativo oficial · '+dateText(p.valueDate)};
  return {kind:'snapshot',label:'Último dato · '+ageText(at),title:'Último dato disponible · '+dateText(p.valueDate)};
 }
 function freshnessHtml(p){
  const x=fundFreshness(p);
  return '<span class="fund-freshness '+esc(x.kind)+'" title="'+esc(x.title)+'"><i></i>'+esc(x.label)+'</span>';
 }
 function subscribeFund(isin){
  isin=String(isin||'').toUpperCase();if(!/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin))return;
  fundLive.wanted.add(isin);connectFundsLive();sendFundSubscriptions();
 }
 function sendFundSubscriptions(){
  if(!fundLive.connected||!fundLive.ws||fundLive.ws.readyState!==WebSocket.OPEN)return;
  for(const isin of fundLive.wanted){
   if(fundLive.subByIsin.has(isin))continue;
   const sub=String(fundLive.seq++);
   fundLive.subByIsin.set(isin,sub);fundLive.isinBySub.set(sub,isin);
   try{fundLive.ws.send('sub '+sub+' '+JSON.stringify({type:'ticker',id:isin+'.LSX'}))}catch(_){}
  }
 }
 function connectFundsLive(){
  if(fundLive.connected||fundLive.connecting||typeof WebSocket==='undefined')return;
  fundLive.connecting=true;let ws;
  try{ws=new WebSocket(fundWsUrl())}catch(_){fundLive.connecting=false;return}
  fundLive.ws=ws;
  ws.onopen=()=>{try{ws.send('connect 30')}catch(_){}};
  ws.onmessage=e=>{
   const msg=String(e.data||'');
   if(msg.startsWith('connected')){fundLive.connected=true;fundLive.connecting=false;sendFundSubscriptions();return}
   const m=msg.match(/^(\d+)\s+([A-Z])(?:\s+([\s\S]+))?$/);if(!m)return;
   const sid=m[1],code=m[2],body=m[3]||'',isin=fundLive.isinBySub.get(sid);if(!isin)return;
   if(code==='C'||code==='E')return;
   try{
    let full=body;
    if(code==='A')fundLive.payloadBySub.set(sid,body);
    else if(code==='D'){full=applyDelta(fundLive.payloadBySub.get(sid)||'',body);fundLive.payloadBySub.set(sid,full)}
    else return;
    const payload=JSON.parse(full||'{}'),price=num(payload.last&&payload.last.price);
    if(price!==null){
     fundLive.quotes.set(isin,{price,bid:num(payload.bid&&payload.bid.price),ask:num(payload.ask&&payload.ask.price),receivedAt:Date.now()});
     refreshFundLiveDom(isin);
    }
   }catch(_){}
  };
  ws.onclose=()=>{fundLive.connected=false;fundLive.connecting=false;fundLive.ws=null;fundLive.subByIsin.clear();fundLive.isinBySub.clear();fundLive.payloadBySub.clear();clearTimeout(fundLive.retry);fundLive.retry=setTimeout(connectFundsLive,3000)};
  ws.onerror=()=>{};
 }
 function observeFundLive(rootNode=document){
  const nodes=rootNode.querySelectorAll('[data-fund-live-isin]');
  if(!('IntersectionObserver'in root)){nodes.forEach(n=>subscribeFund(n.dataset.fundLiveIsin));return}
  if(!fundLive.observer)fundLive.observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting)subscribeFund(entry.target.dataset.fundLiveIsin)}),{rootMargin:'250px 0px'});
  nodes.forEach(n=>fundLive.observer.observe(n));
 }
 function refreshFundLiveDom(isin=''){
  document.querySelectorAll('[data-fund-live-isin]').forEach(el=>{
   if(isin&&el.dataset.fundLiveIsin!==isin)return;
   const p=state.products.find(x=>x.isin===el.dataset.fundLiveIsin);if(!p)return;
   const value=el.querySelector('[data-fund-current-value]');if(value)value.textContent=money(fundCurrentValue(p),p.currency);
   const fresh=el.querySelector('.fund-freshness');if(fresh){const x=fundFreshness(p);fresh.className='fund-freshness '+x.kind;fresh.title=x.title;fresh.innerHTML='<i></i>'+esc(x.label)}
  });
  renderPortfolio();
 }
 function norm(p){
  const platforms=p&&p.platforms&&typeof p.platforms==='object'?p.platforms:{};
  return Object.assign({
   isin:'',name:'',type:'fund',provider:'',index:'',category:'',region:'',currency:'EUR',
   distribution:'',ter:null,nav:null,valueDate:null,sourceUpdatedAt:null,
   perf1M:null,perf3M:null,perf6M:null,perfYtd:null,perf1Y:null,perf3Y:null,perf5Y:null,perf10Y:null,perfSinceInception:null,
   volatility3Y:null,maxDrawdown:null,sharpe3Y:null,trackingDifference:null,assetsUnderManagement:null,
   platforms:{tradeRepublic:'unknown',myInvestor:'unknown'},sources:[]
  },p,{platforms:Object.assign({tradeRepublic:'unknown',myInvestor:'unknown'},platforms)});
 }
 function verified(v){return v===true||v==='verified'||v==='yes'}
 function rejected(v){return v===false||v==='no'||v==='unavailable'}
 function platformLabel(p){
  let rows=[];
  const tr=p.platforms.tradeRepublic,mi=p.platforms.myInvestor;
  rows.push('<span class="fund-platform '+(verified(tr)?'ok':rejected(tr)?'no':'pending')+'">TR '+(verified(tr)?'✓':rejected(tr)?'—':'?')+'</span>');
  rows.push('<span class="fund-platform '+(verified(mi)?'ok':rejected(mi)?'no':'pending')+'">MyInvestor '+(verified(mi)?'✓':rejected(mi)?'—':'?')+'</span>');
  return rows.join('');
 }
 function matchesPlatform(p){
  if(state.platform==='all')return true;
  if(state.platform==='tr')return verified(p.platforms.tradeRepublic);
  if(state.platform==='mi')return verified(p.platforms.myInvestor);
  if(state.platform==='both')return verified(p.platforms.tradeRepublic)&&verified(p.platforms.myInvestor);
  return true;
 }
 function platformSortValue(p){
  const tr=verified(p.platforms.tradeRepublic),mi=verified(p.platforms.myInvestor);
  return tr&&mi?3:tr?2:mi?1:0;
 }
 function freshnessSortValue(p){
  const live=liveQuote(p.isin);
  if(p.type==='etf'&&live&&Number.isFinite(live.receivedAt))return live.receivedAt;
  const t=new Date(p.valueDate||p.sourceUpdatedAt||'').getTime();
  return Number.isFinite(t)?t:null;
 }
 function fundSortValue(p,key){
  if(key==='name')return String(p.name||p.isin||'');
  if(key==='platform')return platformSortValue(p);
  if(key==='current')return fundCurrentValue(p);
  if(key==='freshness')return freshnessSortValue(p);
  if(key==='index'||key==='provider'||key==='distribution'||key==='region'||key==='currency'||key==='category')return String(p[key]||'');
  if(key==='type')return String(p.type||'');
  return num(p[key]);
 }
 function compareFundRows(a,b){
  const av=fundSortValue(a,state.sort),bv=fundSortValue(b,state.sort);
  if(av===null||av===undefined||av==='')return(bv===null||bv===undefined||bv==='')?String(a.name).localeCompare(String(b.name),'es'):1;
  if(bv===null||bv===undefined||bv==='')return-1;
  let cmp=typeof av==='string'||typeof bv==='string'
   ?String(av).localeCompare(String(bv),'es',{sensitivity:'base'})
   :(av<bv?-1:av>bv?1:0);
  if(state.sortDir==='desc')cmp*=-1;
  return cmp||String(a.name).localeCompare(String(b.name),'es',{sensitivity:'base'});
 }
 function setFundSort(key,dir=null){
  if(state.sort===key&&!dir)state.sortDir=state.sortDir==='asc'?'desc':'asc';
  else{
   state.sort=key;
   state.sortDir=dir||(key==='name'||key==='index'||key==='provider'||key==='distribution'||key==='region'||key==='currency'||key==='type'?'asc':'desc');
  }
  const select=q('#fundSort');
  if(select){
   const map={ter:'terAsc',maxDrawdown:'drawdown'};
   const value=map[state.sort]||state.sort;
   if([...select.options].some(o=>o.value===value))select.value=value;
  }
  render();
 }
 function applyFundSortSelect(value){
  if(value==='terAsc'){state.sort='ter';state.sortDir='asc'}
  else if(value==='drawdown'){state.sort='maxDrawdown';state.sortDir='desc'}
  else{state.sort=value;state.sortDir='desc'}
  render();
 }
 function filtered(){
  const needle=state.query.trim().toLowerCase();
  const rows=state.products.filter(p=>{
   if(state.type!=='all'&&p.type!==state.type)return false;
   if(!matchesPlatform(p))return false;
   if(state.provider!=='all'&&String(p.provider||'')!==state.provider)return false;
   if(state.region!=='all'&&String(p.region||'')!==state.region)return false;
   if(state.distribution!=='all'&&String(p.distribution||'')!==state.distribution)return false;
   if(state.maxTer!==null){const ter=num(p.ter);if(ter===null||ter>state.maxTer)return false}
   if(!needle)return true;
   return [p.name,p.isin,p.provider,p.index,p.category,p.region].some(v=>String(v||'').toLowerCase().includes(needle));
  });
  rows.sort(compareFundRows);
  return rows;
 }
 function perfStrip(p){
  return '<div class="fund-performance">'+PERIODS.map(([label,key])=>'<span><small>'+label+'</small><b class="'+((num(p[key])||0)>=0?'positive':'negative')+'">'+pct(p[key])+'</b></span>').join('')+'</div>';
 }
 function compactFacts(p){
  const facts=[
   ['Índice',p.index],['Gestora',p.provider],['TER',num(p.ter)===null?'—':num(p.ter).toLocaleString('es-ES',{maximumFractionDigits:3})+'%'],
   ['Clase',p.distribution],['Categoría',p.category],['Región',p.region]
  ];
  return '<div class="fund-facts">'+facts.map(([k,v])=>'<div><small>'+esc(k)+'</small><strong>'+esc(v||'—')+'</strong></div>').join('')+'</div>';
 }
 function detail(p){
  const risk=[
   ['Volatilidad 3A',pct(p.volatility3Y)],['Drawdown máx.',pct(p.maxDrawdown)],['Sharpe 3A',num(p.sharpe3Y)===null?'—':num(p.sharpe3Y).toLocaleString('es-ES',{maximumFractionDigits:2})],
   ['Tracking diff.',pct(p.trackingDifference)],['Patrimonio',num(p.assetsUnderManagement)===null?'—':money(p.assetsUnderManagement,p.currency)]
  ];
  const sources=(p.sources||[]).map(s=>{const url=safeHttpsUrl(s&&s.url);return url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.label||s.url||'Fuente')+'</a>':''}).filter(Boolean).join(' · ');
  return '<details class="fund-more"><summary>Más datos</summary>'+
   compactFacts(p)+
   '<div class="fund-risk-grid">'+risk.map(([k,v])=>'<div><small>'+esc(k)+'</small><strong>'+esc(v)+'</strong></div>').join('')+'</div>'+
   '<div class="fund-source-line"><span>'+esc(ageText(p.sourceUpdatedAt||p.valueDate))+'</span>'+(sources?'<span>·</span>'+sources:'')+'</div>'+
  '</details>';
 }
 const FUND_COLUMNS=[
  ['name','Fondo'],
  ['platform','Plataformas'],
  ['current','VL / Precio'],
  ['freshness','Actualización'],
  ['perf1M','1M'],['perf3M','3M'],['perf6M','6M'],['perfYtd','YTD'],
  ['perf1Y','1A'],['perf3Y','3A'],['perf5Y','5A'],['perf10Y','10A'],['perfSinceInception','Hist.'],
  ['ter','TER'],['index','Índice'],['provider','Gestora'],['distribution','Clase'],['region','Región']
 ];
 function sortHeader(key,label){
  const active=state.sort===key;
  const arrow=active?(state.sortDir==='asc'?'↑':'↓'):'↕';
  const aria=active?(state.sortDir==='asc'?'ascending':'descending'):'none';
  return '<th scope="col" aria-sort="'+aria+'" data-fund-column="'+esc(key)+'"><button type="button" class="fund-sort-button'+(active?' active':'')+'" data-fund-sort-col="'+esc(key)+'"><span>'+esc(label)+'</span><i aria-hidden="true">'+arrow+'</i></button></th>';
 }
 function performanceCell(p,key){
  const v=num(p[key]);
  return '<td class="fund-table-number '+(v===null?'muted':v>=0?'positive':'negative')+'">'+pct(v)+'</td>';
 }
 function fundTableRow(p){
  const current=fundCurrentValue(p);
  const liveAttr=p.type==='etf'&&verified(p.platforms.tradeRepublic)?' data-fund-live-isin="'+esc(p.isin)+'"':'';
  const kind=p.type==='etf'?'ETF':p.type==='etp'?'ETP / ETC':'FONDO INDEXADO';
  return '<tr class="fund-table-row" data-fund-isin="'+esc(p.isin)+'"'+liveAttr+'>'+
   '<td class="fund-table-fund"><div class="fund-table-fund-main"><span class="fund-kind">'+kind+'</span><strong>'+esc(p.name||p.isin)+'</strong><small>'+esc(p.isin)+'</small></div></td>'+
   '<td class="fund-table-platforms"><div class="fund-platforms">'+platformLabel(p)+'</div></td>'+
   '<td class="fund-table-value"><strong data-fund-current-value>'+money(current,p.currency)+'</strong></td>'+
   '<td class="fund-table-freshness">'+freshnessHtml(p)+'</td>'+
   PERIODS.map(([,key])=>performanceCell(p,key)).join('')+
   '<td class="fund-table-number">'+(num(p.ter)===null?'—':esc(num(p.ter).toLocaleString('es-ES',{maximumFractionDigits:3})+'%'))+'</td>'+
   '<td class="fund-table-text" title="'+esc(p.index||p.category||'')+'">'+esc(p.index||p.category||'—')+'</td>'+
   '<td class="fund-table-text" title="'+esc(p.provider||'')+'">'+esc(p.provider||'—')+'</td>'+
   '<td class="fund-table-text">'+esc(p.distribution||'—')+'</td>'+
   '<td class="fund-table-text">'+esc(p.region||'—')+'</td>'+
   '<td class="fund-table-actions"><button type="button" class="btn small ghost" data-fund-detail="'+esc(p.isin)+'">Ver ficha</button><button type="button" class="btn small" data-fund-position="'+esc(p.isin)+'">＋ Cartera</button></td>'+
  '</tr>';
 }
 function fundTable(rows){
  return '<div class="fund-table-scroll" role="region" aria-label="Comparador de fondos indexados y ETFs" tabindex="0">'+
   '<table class="fund-table"><thead><tr>'+FUND_COLUMNS.map(([key,label])=>sortHeader(key,label)).join('')+'<th scope="col" class="fund-actions-head">Acciones</th></tr></thead>'+
   '<tbody>'+rows.map(fundTableRow).join('')+'</tbody></table></div>'+
   '<div class="fund-table-swipe-hint">Desliza horizontalmente para ver todas las columnas · Pulsa una cabecera para ordenar</div>';
 }
 function mobileSortHead(key,label){
  const active=state.sort===key;
  return '<button type="button" class="fund-mobile-sort'+(active?' active':'')+'" data-fund-sort-col="'+esc(key)+'"><span>'+esc(label)+'</span>'+(active?'<i aria-hidden="true">'+(state.sortDir==='asc'?'↑':'↓')+'</i>':'')+'</button>';
 }
 function fundMobileGroup(){
  return MOBILE_GROUPS.find(g=>g.key===state.mobileGroup)||MOBILE_GROUPS[0];
 }
 function fundPlatformShort(p){
  const text=(label,value)=>label+' '+(verified(value)?'✓':rejected(value)?'—':'?');
  return text('TR',p.platforms.tradeRepublic)+' · '+text('MI',p.platforms.myInvestor);
 }
 function fundCompactMoney(v,currency){
  v=num(v);if(v===null)return'—';
  try{return v.toLocaleString('es-ES',{notation:'compact',maximumFractionDigits:1})+' '+String(currency||'EUR').toUpperCase()}
  catch(_){return money(v,currency)}
 }
 function fundMobileCellValue(p,key){
  if(key==='type')return{value:p.type==='etf'?'ETF':p.type==='etp'?'ETP / ETC':'Fondo indexado',tone:'text'};
  if(key==='currency')return{value:p.currency||'—',tone:'text'};
  if(key==='platform')return{value:fundPlatformShort(p),tone:'text'};
  if(key==='freshness')return{value:fundFreshness(p).label,tone:'text compact'};
  if(key==='assetsUnderManagement')return{value:fundCompactMoney(p.assetsUnderManagement,p.currency),tone:'text'};
  if(key==='ter'){
   const v=num(p.ter);return{value:v===null?'—':v.toLocaleString('es-ES',{maximumFractionDigits:3})+'%',tone:'number'};
  }
  if(key==='sharpe3Y'){
   const v=num(p.sharpe3Y);return{value:v===null?'—':v.toLocaleString('es-ES',{maximumFractionDigits:2}),tone:'number'};
  }
  if(['perfYtd','perf1Y','perf3Y','volatility3Y','maxDrawdown','trackingDifference'].includes(key)){
   const v=num(p[key]);return{value:pct(v),tone:v===null?'muted':v>=0?'positive':'negative'};
  }
  return{value:String(p[key]||'—'),tone:'text'};
 }
 function fundMobileTabs(){
  return '<nav class="fund-mobile-groups" aria-label="Datos a comparar">'+MOBILE_GROUPS.map(g=>
   '<button type="button" class="'+(g.key===state.mobileGroup?'active':'')+'" data-fund-mobile-group="'+esc(g.key)+'" aria-pressed="'+(g.key===state.mobileGroup?'true':'false')+'">'+esc(g.label)+'</button>'
  ).join('')+'</nav>';
 }
 function fundMobileRow(p,group){
  return root.ViewInvAICards.render({context:'funds',title:p.name||p.isin,isin:p.isin,
   openAttrs:' data-fund-detail="'+esc(p.isin)+'" role="button" tabindex="0"',
   cells:group.columns.map(([key,label])=>({...fundMobileCellValue(p,key),label}))});
 }
 function fundMobileList(rows){
  const group=fundMobileGroup(),cols=group.columns.length;
  return fundMobileTabs()+
   '<div class="fund-mobile-compare fund-mobile-cols-'+cols+'">'+
    root.ViewInvAICards.head(group.columns.map(([key,label])=>({html:mobileSortHead(key,label)})),{firstHtml:mobileSortHead('name','Nombre / ISIN')})+
    '<div class="fund-mobile-rows">'+rows.map(p=>fundMobileRow(p,group)).join('')+'</div>'+
   '</div>';
 }
 function fundSortLabel(key){
  const desktop=FUND_COLUMNS.find(([column])=>column===key);
  if(desktop)return desktop[1];
  for(const group of MOBILE_GROUPS){const column=group.columns.find(([column])=>column===key);if(column)return column[1]}
  return key;
 }
 function updateMobileFiltersState(){
  const toolbar=q('.fund-toolbar'),button=q('#fundMobileFiltersToggle');if(!toolbar||!button)return;
  const active=[state.platform!=='all',state.type!=='all',state.provider!=='all',state.region!=='all',state.distribution!=='all',state.maxTer!==null].filter(Boolean).length;
  button.textContent=active?'Filtros · '+active:'Filtros';
  button.classList.toggle('active',active>0);
 }
 function renderFundDetail(p){
  const risk=[
   ['Volatilidad 3A',pct(p.volatility3Y)],['Drawdown máx.',pct(p.maxDrawdown)],['Sharpe 3A',num(p.sharpe3Y)===null?'—':num(p.sharpe3Y).toLocaleString('es-ES',{maximumFractionDigits:2})],
   ['Tracking diff.',pct(p.trackingDifference)],['Patrimonio',num(p.assetsUnderManagement)===null?'—':money(p.assetsUnderManagement,p.currency)]
  ];
  const sources=(p.sources||[]).map(s=>{const url=safeHttpsUrl(s&&s.url);return url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.label||s.url||'Fuente')+'</a>':''}).filter(Boolean).join(' · ');
  return '<div class="fund-detail-sheet">'+
   '<div class="fund-detail-hero"><div><span class="fund-kind">'+(p.type==='fund'?'FONDO INDEXADO':p.type==='etf'?'ETF':'ETP / ETC')+'</span><h3>'+esc(p.name||p.isin)+'</h3><p>'+esc(p.isin)+'</p></div><div><strong>'+money(fundCurrentValue(p),p.currency)+'</strong>'+freshnessHtml(p)+'</div></div>'+
   platformLabel(p)+
   '<h4>Rentabilidad</h4>'+perfStrip(p)+
   '<h4>Datos del producto</h4>'+compactFacts(p)+
   '<h4>Riesgo y seguimiento</h4><div class="fund-risk-grid">'+risk.map(([k,v])=>'<div><small>'+esc(k)+'</small><strong>'+esc(v)+'</strong></div>').join('')+'</div>'+
   '<div class="fund-source-line"><span>'+esc(ageText(p.sourceUpdatedAt||p.valueDate))+'</span>'+(sources?'<span>·</span>'+sources:'')+'</div>'+
  '</div>';
 }

 let marketPopularity={at:0,items:[]};
 async function fetchMarketPopularity(force=false){
  if(!force&&marketPopularity.at&&Date.now()-marketPopularity.at<60*60000)return marketPopularity.items;
  try{
   const r=await fetch('/api/attention-ranking?kind=funds',{cache:'no-store'});if(!r.ok)throw Error(String(r.status));
   const data=await r.json();marketPopularity={at:Date.now(),items:Array.isArray(data.items)?data.items:[]};
  }catch(e){console.warn('Fund popularity ranking unavailable',e)}
  return marketPopularity.items;
 }
 function marketTopProducts(limit=10,ranking=[]){
  const eligible=state.products.filter(p=>p.type!=='etp'&&!/\b(?:2x|3x|leveraged|short)\b/i.test(String(p.name||'')));
  const fallback=eligible.slice().sort((a,b)=>{
   const aumA=num(a.assetsUnderManagement)??0,aumB=num(b.assetsUnderManagement)??0;
   const platformA=(verified(a.platforms&&a.platforms.tradeRepublic)?1:0)+(verified(a.platforms&&a.platforms.myInvestor)?1:0);
   const platformB=(verified(b.platforms&&b.platforms.tradeRepublic)?1:0)+(verified(b.platforms&&b.platforms.myInvestor)?1:0);
   return aumB-aumA||platformB-platformA||String(a.name||'').localeCompare(String(b.name||''),'es');
  });
  if(!ranking.length)return fallback.slice(0,limit);
  const byIsin=new Map(eligible.map(p=>[String(p.isin||'').toUpperCase(),p])),out=[],used=new Set();
  for(const item of ranking){
   const p=byIsin.get(String(item.isin||'').toUpperCase());if(!p||used.has(p.isin))continue;
   used.add(p.isin);out.push(p);if(out.length>=limit)return out;
  }
  for(const p of fallback){
   if(used.has(p.isin))continue;used.add(p.isin);out.push(p);if(out.length>=limit)break;
  }
  return out;
 }
 function marketTopRow(p,i){
  const value=fundCurrentValue(p),ret=num(p.perf1Y),tone=ret===null?'muted':ret>=0?'positive':'negative';
  const type=p.type==='fund'?'Fondo indexado':p.type==='etf'?'ETF':'ETP';
  return root.ViewInvAICards.render({context:'funds-market',title:p.name||p.isin,rank:'#'+(i+1),isin:p.isin,
   subtitle:[type,p.provider,p.indexName].filter(Boolean).join(' · '),
   openAttrs:' data-fund-detail="'+esc(p.isin)+'" role="button" tabindex="0"',
   cells:[{label:'Valor',value:money(value,p.currency),tone},{label:'1 año',value:pct(ret),tone}]});
 }
 async function renderMarketTop10(target,limit=10){
  const box=typeof target==='string'?q(target):target;if(!box)return;
  if(!state.loaded)await load(false);
  const ranking=await fetchMarketPopularity(false);
  const rows=marketTopProducts(limit,ranking);
  box.innerHTML=rows.length?'<div class="market-board-list fund-market-top">'+rows.map(marketTopRow).join('')+'</div>':'<div class="empty-state">Ranking de fondos y ETFs en actualización.</div>';
 }

 function render(){
  const box=q('#fundsApp');if(!box)return;
  if(state.loading){box.innerHTML='<div class="empty-state">Actualizando fondos y ETFs…</div>';return}
  const rows=filtered();
  const updated=state.meta&&state.meta.updatedAt?new Date(state.meta.updatedAt):null;
  const stamp=updated&&Number.isFinite(updated.getTime())?updated.toLocaleString('es-ES'):'sin actualización verificada';
  const productCount=q('#fundProductCount');if(productCount)productCount.textContent=rows.length.toLocaleString('es-ES')+' productos';
  const updatedAt=q('#fundUpdatedAt');if(updatedAt)updatedAt.textContent=stamp;
  const results=rows.length?(compactFundsView()?fundMobileList(rows):fundTable(rows)):
    '<div class="empty-state">No hay productos que coincidan con los filtros. Si el catálogo todavía está vacío, ejecuta la sincronización de fuentes verificadas.</div>';
  box.innerHTML=
   '<div class="funds-status"><strong>'+rows.length+' productos</strong><span>·</span><span>'+esc(stamp)+'</span><span>·</span><span>Orden: '+esc(fundSortLabel(state.sort))+' '+(state.sortDir==='asc'?'↑':'↓')+'</span></div>'+
   results;
  updateMobileFiltersState();
  requestAnimationFrame(()=>observeFundLive(box));
 }
 async function fetchFundCatalogue(url,cache){
  const r=await fetch(url,{cache});
  if(!r.ok)throw Error(String(r.status));
  const data=await r.json();
  const products=Array.isArray(data&&data.products)?data.products:[];
  if(!products.length)throw Error('Catálogo de fondos vacío');
  return data;
 }
 async function load(force=false){
  if(state.loading)return;
  if(state.loaded&&!force){render();return true}
  let ok=true;
  state.loading=true;render();
  try{
   let data;
   try{
    data=await fetchFundCatalogue(DATA+(force?'?v='+Date.now():''),force?'reload':'no-cache');
   }catch(remoteError){
    const native=!!(root.ViewInvAIRuntime&&root.ViewInvAIRuntime.isPackagedNative);
    if(!native)throw remoteError;
    console.warn('Remote funds catalogue invalid; using packaged snapshot',remoteError);
    data=await fetchFundCatalogue(DATA+'?local=1&v='+Date.now(),'no-store');
   }
   state.products=data.products.map(norm).filter(p=>p.isin);
   state.meta=data.meta||{};
   const fill=(sel,values,label)=>{const el=q(sel);if(!el)return;const current=el.value||'all';el.innerHTML='<option value="all">'+label+'</option>'+values.filter(Boolean).sort((a,b)=>a.localeCompare(b,'es')).map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');el.value=[...el.options].some(o=>o.value===current)?current:'all'};
   fill('#fundProvider',[...new Set(state.products.map(p=>p.provider))],'Todas las gestoras');
   fill('#fundRegion',[...new Set(state.products.map(p=>p.region))],'Todas las regiones');
   state.loaded=true;
  }catch(e){
   ok=false;
   console.warn('Funds catalogue loading failed',e);
   state.products=[];state.meta={};
  }finally{state.loading=false;render()}
  return ok;
 }

 function api(path,options={}){
  if(!root.ViewInvAIAuth||typeof root.ViewInvAIAuth.apiFetch!=='function')throw Error('La cuenta todavía no está disponible.');
  return root.ViewInvAIAuth.apiFetch(path,options);
 }
 function productForPosition(position){
  return state.products.find(p=>p.isin===position.isin)||norm({
   isin:position.isin,name:position.name,type:position.product_type,provider:position.provider,index:position.index_name,
   currency:position.currency,platforms:{tradeRepublic:'unknown',myInvestor:'unknown'}
  });
 }
 function selectedFundPortfolio(){
  return account.portfolios.find(p=>String(p.id)===String(account.selectedPortfolioId))||account.portfolios[0]||null;
 }
 function fundPositions(portfolioId){
  return account.positions.filter(p=>String(p.fund_portfolio_id)===String(portfolioId)&&Number(p.active)!==0);
 }
 function fundPositionCard(position){
  const p=productForPosition(position),units=num(position.units),avg=num(position.avg_price),current=fundCurrentValue(p);
  const value=units!==null&&current!==null?units*current:null;
  const invested=units!==null&&avg!==null?units*avg:null;
  const pnl=value!==null&&invested!==null?value-invested:null;
  const pnlPct=pnl!==null&&invested>0?pnl/invested*100:null;
  return root.ViewInvAICards.render({context:'fund-portfolio',title:p.name||position.name||p.isin,isin:p.isin,
   subtitle:(p.type==='etf'?'ETF':p.type==='etp'?'ETP / ETC':'Fondo')+' · '+(position.platform||'—'),
   openAttrs:' data-fund-detail="'+esc(p.isin)+'" role="button" tabindex="0"',
   cells:[{label:'Valor actual',value:money(value,position.currency||p.currency)},{label:'P&L',value:pnl===null?'—':money(pnl,position.currency||p.currency)+(pnlPct===null?'':' · '+pct(pnlPct)),tone:pnl===null?'muted':pnl>=0?'positive':'negative'}],
   detailsLabel:'Posición · datos del fondo',detailsHtml:freshnessHtml(p)+'<div class="asset-card-metrics"><span>Participaciones <b>'+esc(units===null?'—':units.toLocaleString('es-ES',{maximumFractionDigits:6}))+'</b></span><span>Media <b>'+money(avg,position.currency||p.currency)+'</b></span></div>'+compactFacts(p)+perfStrip(p),
   actionsHtml:'<button type="button" class="btn small" data-fund-transactions="'+esc(position.id)+'">Operaciones</button><button type="button" class="btn small ghost" data-fund-position-edit="'+esc(position.id)+'">Editar</button><button type="button" class="btn small ghost" data-fund-position-delete="'+esc(position.id)+'">Eliminar</button>'
  });
 }

 function fundPlans(portfolioId){return account.plans.filter(p=>String(p.fund_portfolio_id)===String(portfolioId)&&Number(p.enabled)!==0)}
 function planSummaryHtml(portfolioId){
  const plans=fundPlans(portfolioId);if(!plans.length)return'';
  return '<div class="fund-plan-strip">'+plans.slice(0,4).map(p=>'<span><b>'+esc(p.label||p.isin||'Aportación')+'</b> '+(num(p.amount)===null?'variable':money(p.amount,p.currency||'EUR'))+(p.day_of_month?' · día '+p.day_of_month:'')+'</span>').join('')+'</div>';
 }
 async function openFundPlanForm(position=null){
  const selected=selectedFundPortfolio();if(!selected)return;
  const product=position?productForPosition(position):null;
  openModal('Programación de aportaciones','<form id="fundPlanForm" class="portfolio-form">'+
   '<input type="hidden" name="positionId" value="'+esc(position&&position.id||'')+'"><input type="hidden" name="isin" value="'+esc(position&&position.isin||'')+'">'+
   '<label><span>Fondo / concepto</span><input name="label" maxlength="160" value="'+esc(product&&product.name||'Aportación periódica')+'" required></label>'+
   '<div class="portfolio-form-grid"><label><span>Tipo</span><select name="kind"><option value="monthly">Aportación periódica</option><option value="saveback">Saveback</option><option value="roundup">Round up</option><option value="variable">Variable / manual</option></select></label>'+
   '<label><span>Importe</span><input name="amount" type="number" min="0" step="0.01" placeholder="Ej. 50"></label></div>'+
   '<div class="portfolio-form-grid"><label><span>Día del mes</span><input name="day" type="number" min="1" max="31" placeholder="Ej. 5"></label><label><span>Divisa</span><input name="currency" value="'+esc(position&&position.currency||selected.base_currency||'EUR')+'"></label></div>'+
   '<label><span>Nota</span><input name="notes" maxlength="1000" placeholder="Ej. Trade Republic · 50 € cada mes"></label>'+
   '<button type="submit" class="btn">Guardar programación</button></form>');
 }
 async function openFundPortfolioHistory(portfolioId){
  openModal('Historial · fondos y ETFs','<div class="portfolio-loading compact"><span></span><p>Cargando operaciones…</p></div>');
  try{
   const r=await api('/api/fund-transactions?portfolioId='+encodeURIComponent(portfolioId));
   const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudo cargar el historial.');
   q('#fundModalBody').innerHTML='<div class="transaction-history">'+fundTransactionRowsHtml(data.transactions||[],'EUR')+'</div>';
  }catch(e){q('#fundModalBody').innerHTML='<div class="portfolio-empty-state compact">'+esc(e.message||'No se pudo cargar el historial.')+'</div>'}
 }
 function renderPortfolio(){
  const box=q('#fundPortfolioApp');if(!box)return;
  account.user=root.ViewInvAIAuth?.getUser?.()||account.user;
  if(!account.user){
   box.innerHTML='<div class="portfolio-empty-state"><h2>Cartera de fondos</h2><p>Inicia sesión con Google para sincronizar tus fondos y ETFs entre web y Android.</p><button type="button" class="btn" data-fund-login>Entrar con Google</button></div>';
   return;
  }
  if(account.loading){box.innerHTML='<div class="portfolio-loading"><span></span><p>Cargando fondos…</p></div>';return}
  const selected=selectedFundPortfolio();
  if(!selected){
   box.innerHTML='<div class="portfolio-empty-state"><h2>Tu cartera de fondos está vacía</h2><p>Al añadir el primer fondo se creará automáticamente una cartera “Fondos y ETFs”.</p><button type="button" class="btn" data-fund-new-portfolio>＋ Crear cartera</button></div>';
   return;
  }
  account.selectedPortfolioId=selected.id;
  const rows=fundPositions(selected.id);
  let total=0,invested=0,complete=true;
  for(const position of rows){
   const p=productForPosition(position),units=num(position.units),avg=num(position.avg_price),nav=fundCurrentValue(p);
   if(units===null||nav===null){complete=false;continue}
   total+=units*nav;
   if(avg!==null)invested+=units*avg;else complete=false;
  }
  const pnl=complete?total-invested:null,pnlPct=pnl!==null&&invested>0?pnl/invested*100:null;
  box.innerHTML=
   '<div class="fund-portfolio-toolbar portfolio-inline-tools"><div class="portfolio-tabs-track">'+account.portfolios.map(p=>'<button type="button" class="portfolio-tab'+(String(p.id)===String(selected.id)?' active':'')+'" data-fund-portfolio-select="'+esc(p.id)+'"><strong>'+esc(p.name)+'</strong><span>'+fundPositions(p.id).length+'</span></button>').join('')+'</div>'+
   '<button type="button" class="portfolio-icon-action" data-fund-new-portfolio title="Nueva cartera" aria-label="Nueva cartera">＋</button>'+
   '<button type="button" class="portfolio-icon-action" data-fund-portfolio-edit="'+esc(selected.id)+'" title="Editar cartera" aria-label="Editar cartera">✎</button>'+
   '<button type="button" class="portfolio-icon-action" data-fund-portfolio-history="'+esc(selected.id)+'" title="Historial" aria-label="Historial">◷</button>'+
   '<button type="button" class="portfolio-icon-action" data-fund-plan title="Programar aportación" aria-label="Programar aportación">▦</button>'+
   '</div>'+
   '<div class="portfolio-summary-bar">'+
    '<div><small>CARTERA</small><strong>'+esc(selected.name)+'</strong></div>'+
    '<div><small>VALOR ACTUAL</small><strong>'+(complete?money(total,selected.base_currency||'EUR'):'—')+'</strong></div>'+
    '<div><small>P&L</small><strong class="'+((pnl||0)>=0?'pnl-up':'pnl-down')+'">'+(pnl===null?'—':money(pnl,selected.base_currency||'EUR')+(pnlPct===null?'':' · '+pct(pnlPct)))+'</strong></div>'+
    '<div><small>POSICIONES</small><strong>'+rows.length+'</strong></div>'+
   '</div>'+planSummaryHtml(selected.id)+
   (rows.length?'<div class="fund-position-grid">'+rows.map(fundPositionCard).join('')+'</div>':'<div class="portfolio-empty-state compact">Todavía no hay fondos en esta cartera. Añádelos desde el menú Fondos y ETFs.</div>');
 }
 async function loadPortfolio(force=false){
  account.user=root.ViewInvAIAuth?.getUser?.()||null;
  if(!account.user){account.portfolios=[];account.positions=[];renderPortfolio();return}
  if(account.loading&&!force)return;
  account.loading=true;renderPortfolio();
  try{
   const [pr,ps,pl]=await Promise.all([api('/api/fund-portfolios'),api('/api/fund-positions'),api('/api/fund-plans')]);
   const pd=await pr.json().catch(()=>({})),sd=await ps.json().catch(()=>({})),ld=await pl.json().catch(()=>({}));
   if(!pr.ok)throw Error(pd.error||'No se pudieron cargar las carteras de fondos.');
   if(!ps.ok)throw Error(sd.error||'No se pudieron cargar las posiciones de fondos.');
   if(!pl.ok)throw Error(ld.error||'No se pudieron cargar los planes de aportación.');
   account.portfolios=pd.portfolios||[];account.positions=sd.positions||[];account.plans=ld.plans||[];
   if(!account.selectedPortfolioId&&account.portfolios.length)account.selectedPortfolioId=account.portfolios[0].id;
  }catch(e){console.warn('Fund portfolio loading failed',e)}
  finally{account.loading=false;renderPortfolio()}
 }
 async function ensureDefaultFundPortfolio(){
  if(account.portfolios.length)return account.portfolios[0];
  const r=await api('/api/fund-portfolios',{method:'POST',body:JSON.stringify({name:'Fondos y ETFs',platform:'',baseCurrency:'EUR'})});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudo crear la cartera de fondos.');
  account.portfolios=[data.portfolio];account.selectedPortfolioId=data.portfolio.id;return data.portfolio;
 }
 function ensureModal(){
  let backdrop=q('#fundModalBackdrop'),modal=q('#fundModal');
  if(backdrop&&modal)return modal;
  backdrop=document.createElement('div');backdrop.id='fundModalBackdrop';backdrop.className='portfolio-modal-backdrop';backdrop.setAttribute('aria-hidden','true');
  modal=document.createElement('section');modal.id='fundModal';modal.className='portfolio-modal';modal.setAttribute('aria-hidden','true');
  modal.innerHTML='<div class="portfolio-modal-card"><div class="portfolio-modal-head"><h2 id="fundModalTitle">Fondos</h2><button type="button" data-fund-modal-close aria-label="Cerrar">×</button></div><div id="fundModalBody"></div></div>';
  document.body.append(backdrop,modal);return modal;
 }
 function closeModal(){
  q('#fundModal')?.classList.remove('open');q('#fundModal')?.setAttribute('aria-hidden','true');
  q('#fundModalBackdrop')?.classList.remove('open');q('#fundModalBackdrop')?.setAttribute('aria-hidden','true');
  document.body.classList.remove('app-modal-open');
 }
 function openModal(title,html){
  const modal=ensureModal(),backdrop=q('#fundModalBackdrop');
  q('#fundModalTitle').textContent=title;q('#fundModalBody').innerHTML=html;
  modal.classList.add('open');modal.setAttribute('aria-hidden','false');backdrop.classList.add('open');backdrop.setAttribute('aria-hidden','false');document.body.classList.add('app-modal-open');
 }
 function platformOptions(product,current=''){
  let rows=[];
  if(verified(product.platforms.tradeRepublic))rows.push('Trade Republic');
  if(verified(product.platforms.myInvestor))rows.push('MyInvestor');
  if(current&&!rows.includes(current))rows.push(current);
  rows.push('Otra');
  return [...new Set(rows)].map(x=>'<option value="'+esc(x)+'"'+(x===current?' selected':'')+'>'+esc(x)+'</option>').join('');
 }
 async function openPositionForm(product,existing=null){
  account.user=root.ViewInvAIAuth?.getUser?.()||null;
  if(!account.user){root.ViewInvAIAuth?.signIn?.();return}
  if(!account.portfolios.length)await ensureDefaultFundPortfolio();
  const portfolio=selectedFundPortfolio()||account.portfolios[0];
  const currentPlatform=existing?.platform||(verified(product.platforms.myInvestor)&&!verified(product.platforms.tradeRepublic)?'MyInvestor':verified(product.platforms.tradeRepublic)?'Trade Republic':'Otra');
  openModal(existing?'Editar posición':'Añadir a cartera',
   '<form id="fundPositionForm" class="portfolio-form" data-position-id="'+esc(existing?.id||'')+'" data-isin="'+esc(product.isin)+'">'+
    '<div class="portfolio-form-grid"><label><span>Cartera</span><select name="fundPortfolioId">'+account.portfolios.map(p=>'<option value="'+esc(p.id)+'"'+(String(p.id)===String(existing?.fund_portfolio_id||portfolio.id)?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label>'+
    '<label><span>Plataforma</span><select name="platform">'+platformOptions(product,currentPlatform)+'</select></label></div>'+
    '<div class="portfolio-form-grid"><label><span>Participaciones</span><input name="units" type="number" inputmode="decimal" step="any" min="0" required value="'+esc(existing?.units??'')+'"></label>'+
    '<label><span>Precio / VL medio</span><input name="avgPrice" type="number" inputmode="decimal" step="any" min="0" value="'+esc(existing?.avg_price??'')+'"></label></div>'+
    '<div class="portfolio-form-grid"><label><span>Divisa</span><input name="currency" maxlength="3" value="'+esc(existing?.currency||product.currency||'EUR')+'"></label>'+
    '<label><span>Fecha inicial</span><input name="openedAt" type="date" value="'+esc((existing?.opened_at||'').slice(0,10))+'"></label></div>'+
    '<label><span>Notas</span><input name="notes" maxlength="1000" value="'+esc(existing?.notes||'')+'"></label>'+
    '<button type="submit" class="btn">'+(existing?'Guardar cambios':'Añadir posición')+'</button>'+
   '</form>');
 }
 async function savePosition(form){
  const product=state.products.find(p=>p.isin===form.dataset.isin)||productForPosition({isin:form.dataset.isin,name:''});
  const fd=new FormData(form),id=form.dataset.positionId;
  const payload={
   fundPortfolioId:String(fd.get('fundPortfolioId')||''),
   isin:product.isin,name:product.name,productType:product.type,provider:product.provider,indexName:product.index,
   platform:String(fd.get('platform')||''),units:num(fd.get('units')),avgPrice:num(fd.get('avgPrice')),
   currency:String(fd.get('currency')||product.currency||'EUR').toUpperCase(),openedAt:String(fd.get('openedAt')||''),notes:String(fd.get('notes')||'')
  };
  const r=await api(id?'/api/fund-positions/'+encodeURIComponent(id):'/api/fund-positions',{method:id?'PATCH':'POST',body:JSON.stringify(payload)});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudo guardar la posición.');
  closeModal();await loadPortfolio(true);
 }

 function fundTransactionRowsHtml(rows,currency){
  if(!rows||!rows.length)return '<div class="portfolio-empty-state compact">Todavía no hay operaciones registradas.</div>';
  return rows.map(tx=>{
   const buy=String(tx.side||'').toUpperCase()==='BUY';
   const when=tx.executed_at?new Date(tx.executed_at):null;
   const date=when&&Number.isFinite(when.getTime())?when.toLocaleString('es-ES',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
   const total=(num(tx.units)||0)*(num(tx.price)||0);
   return '<div class="transaction-row">'+
    '<span class="transaction-side '+(buy?'buy':'sell')+'">'+(buy?'COMPRA':'VENTA')+'</span>'+
    '<div class="transaction-main"><strong>'+esc((num(tx.units)||0).toLocaleString('es-ES',{maximumFractionDigits:6}))+' × '+money(tx.price,tx.currency||currency)+'</strong><small>'+esc(date)+(num(tx.fees)?' · comisión '+money(tx.fees,tx.currency||currency):'')+'</small></div>'+
    '<div class="transaction-total"><strong>'+money(total,tx.currency||currency)+'</strong><small>'+esc(tx.notes||'')+'</small></div>'+
    '<button type="button" class="transaction-delete" data-fund-transaction-delete="'+esc(tx.id)+'" aria-label="Eliminar operación">×</button>'+
   '</div>';
  }).join('');
 }
 async function openFundTransactions(positionId){
  const position=account.positions.find(p=>String(p.id)===String(positionId));
  if(!position)return;
  const product=productForPosition(position),currency=position.currency||product.currency||'EUR';
  openModal('Operaciones · '+(product.name||position.isin),'<div class="portfolio-loading compact"><span></span><p>Cargando operaciones…</p></div>');
  try{
   const r=await api('/api/fund-transactions?positionId='+encodeURIComponent(position.id));
   const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudieron cargar las operaciones.');
   const summary=data.summary||{};
   q('#fundModalBody').innerHTML=
    '<div class="transaction-ledger">'+
     '<div class="transaction-summary">'+
      '<div><small>POSICIÓN</small><strong>'+esc((num(summary.units)||0).toLocaleString('es-ES',{maximumFractionDigits:6}))+' uds.</strong></div>'+
      '<div><small>MEDIA</small><strong>'+money(summary.avgPrice,currency)+'</strong></div>'+
      '<div><small>P&L REALIZADO</small><strong class="'+((num(summary.realizedPnl)||0)>=0?'pnl-up':'pnl-down')+'">'+money(summary.realizedPnl,currency)+'</strong></div>'+
      '<div><small>COMISIONES</small><strong>'+money(summary.totalFees,currency)+'</strong></div>'+
     '</div>'+
     '<form id="fundTransactionForm" class="portfolio-form transaction-form" data-position-id="'+esc(position.id)+'">'+
      '<div class="portfolio-form-grid"><label><span>Tipo</span><select name="side"><option value="BUY">Compra / aportación</option><option value="SELL">Venta / reembolso</option></select></label>'+
      '<label><span>Participaciones</span><input name="units" type="number" inputmode="decimal" step="any" min="0.00000001" required></label></div>'+
      '<div class="portfolio-form-grid"><label><span>Precio / VL</span><input name="price" type="number" inputmode="decimal" step="any" min="0" required value="'+esc(num(product.nav)??'')+'"></label>'+
      '<label><span>Comisión</span><input name="fees" type="number" inputmode="decimal" step="any" min="0" value="0"></label></div>'+
      '<div class="portfolio-form-grid"><label><span>Divisa</span><input name="currency" value="'+esc(currency)+'" readonly></label>'+
      '<label><span>Fecha y hora</span><input name="executedAt" type="datetime-local" value="'+new Date().toISOString().slice(0,16)+'" required></label></div>'+
      '<label><span>Nota</span><input name="notes" maxlength="1000" placeholder="Opcional"></label>'+
      '<button type="submit" class="btn">Registrar operación</button>'+
     '</form>'+
     '<div class="transaction-history-head"><strong>Historial</strong><span>'+(data.transactions||[]).length+' operaciones</span></div>'+
     '<div class="transaction-history">'+fundTransactionRowsHtml(data.transactions||[],currency)+'</div>'+
    '</div>';
  }catch(e){q('#fundModalBody').innerHTML='<div class="portfolio-empty-state compact">'+esc(e.message||'No se pudieron cargar las operaciones.')+'</div>'}
 }
 async function saveFundTransaction(form){
  const position=account.positions.find(p=>String(p.id)===String(form.dataset.positionId));
  if(!position)throw Error('No se encuentra la posición.');
  const fd=new FormData(form),raw=String(fd.get('executedAt')||''),date=new Date(raw);
  const payload={
   positionId:position.id,side:String(fd.get('side')||'BUY'),units:num(fd.get('units')),price:num(fd.get('price')),
   fees:num(fd.get('fees'))||0,currency:String(fd.get('currency')||position.currency||'EUR'),
   executedAt:Number.isFinite(date.getTime())?date.toISOString():'',notes:String(fd.get('notes')||'')
  };
  const r=await api('/api/fund-transactions',{method:'POST',body:JSON.stringify(payload)});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudo guardar la operación.');
  await loadPortfolio(true);await openFundTransactions(position.id);
 }

 async function createFundPortfolio(){
  openModal('Nueva cartera de fondos','<form id="fundPortfolioForm" class="portfolio-form"><label><span>Nombre</span><input name="name" maxlength="80" required value="Fondos y ETFs"></label><label><span>Plataforma principal</span><select name="platform"><option value="">Mixta / varias</option><option>MyInvestor</option><option>Trade Republic</option><option>Otra</option></select></label><button type="submit" class="btn">Crear cartera</button></form>');
 }
 function bind(){
  q('#fundSearch')?.addEventListener('input',e=>{state.query=String(e.target.value||'');render()});
  q('#fundPlatform')?.addEventListener('change',e=>{state.platform=e.target.value;render()});
  q('#fundType')?.addEventListener('change',e=>{state.type=e.target.value;render()});
  q('#fundProvider')?.addEventListener('change',e=>{state.provider=e.target.value;render()});
  q('#fundRegion')?.addEventListener('change',e=>{state.region=e.target.value;render()});
  q('#fundDistribution')?.addEventListener('change',e=>{state.distribution=e.target.value;render()});
  q('#fundMaxTer')?.addEventListener('input',e=>{state.maxTer=num(e.target.value);render()});
  q('#fundSort')?.addEventListener('change',e=>applyFundSortSelect(e.target.value));
  q('#refreshFunds')?.addEventListener('click',()=>{
   const stamp=()=>String(state.meta&&state.meta.updatedAt||'');
   if(root.ViewInvAIRefreshFeedback)root.ViewInvAIRefreshFeedback.run(()=>load(true),stamp);
   else load(true);
  });
  document.addEventListener('click',async e=>{
   if(e.target.closest&&e.target.closest('[data-copy-isin]'))return;
   const mobileGroup=e.target.closest&&e.target.closest('[data-fund-mobile-group]');
   if(mobileGroup){
    state.mobileGroup=mobileGroup.dataset.fundMobileGroup||'general';
    render();
    return;
   }
   const sortButton=e.target.closest&&e.target.closest('[data-fund-sort-col]');
   if(sortButton){setFundSort(sortButton.dataset.fundSortCol);return}

   const asset=e.target.closest&&e.target.closest('[data-portfolio-asset]');
   if(asset){
    const mode=asset.dataset.portfolioAsset;
    document.querySelectorAll('[data-portfolio-asset]').forEach(b=>{
     const active=b.dataset.portfolioAsset===mode;
     b.classList.toggle('active',active);
     b.setAttribute('aria-selected',active?'true':'false');
     b.tabIndex=active?0:-1;
    });
    document.querySelectorAll('[data-portfolio-asset-panel]').forEach(p=>{
     const active=p.dataset.portfolioAssetPanel===mode;
     p.classList.toggle('is-hidden',!active);
     p.hidden=!active;
     p.setAttribute('aria-hidden',active?'false':'true');
    });
    if(mode==='funds'){
     root.ViewInvAIPortfolios?.setGoalVisible?.(false);
     loadPortfolio(false);
    }else root.ViewInvAIPortfolios?.render?.();
    return;
   }
   if(e.target.closest?.('[data-fund-login]')){root.ViewInvAIAuth?.signIn?.();return}
   const select=e.target.closest&&e.target.closest('[data-fund-portfolio-select]');
   if(select){account.selectedPortfolioId=select.dataset.fundPortfolioSelect;renderPortfolio();return}
   if(e.target.closest?.('[data-fund-new-portfolio]')){createFundPortfolio();return}
   const hist=e.target.closest&&e.target.closest('[data-fund-portfolio-history]');if(hist){await openFundPortfolioHistory(hist.dataset.fundPortfolioHistory);return}
   const plan=e.target.closest&&e.target.closest('[data-fund-plan]');if(plan){await openFundPlanForm();return}
   const editPortfolio=e.target.closest&&e.target.closest('[data-fund-portfolio-edit]');
   if(editPortfolio){const p=account.portfolios.find(x=>String(x.id)===String(editPortfolio.dataset.fundPortfolioEdit));if(p)openModal('Editar cartera de fondos','<form id="fundPortfolioEditForm" data-id="'+esc(p.id)+'" class="portfolio-form"><label><span>Nombre</span><input name="name" value="'+esc(p.name)+'" required></label><label><span>Plataforma</span><input name="platform" value="'+esc(p.platform||'')+'"></label><button class="btn" type="submit">Guardar</button></form>');return}
   if(e.target.closest?.('[data-fund-modal-close]')||e.target.id==='fundModalBackdrop'){closeModal();return}
   const detailButton=e.target.closest&&e.target.closest('[data-fund-detail]');
   if(detailButton){
    const p=state.products.find(x=>x.isin===detailButton.dataset.fundDetail);
    if(p){openModal('Ficha · '+(p.name||p.isin),renderFundDetail(p));requestAnimationFrame(()=>observeFundLive(q('#fundModal')))}
    return;
   }
   const add=e.target.closest&&e.target.closest('[data-fund-position]');
   if(add){
    const p=state.products.find(x=>x.isin===add.dataset.fundPosition);if(p)await openPositionForm(p);return;
   }
   const transactions=e.target.closest&&e.target.closest('[data-fund-transactions]');
   if(transactions){await openFundTransactions(transactions.dataset.fundTransactions);return}
   const deleteTx=e.target.closest&&e.target.closest('[data-fund-transaction-delete]');
   if(deleteTx){
    const txId=deleteTx.dataset.fundTransactionDelete;
    const positionId=q('#fundTransactionForm')?.dataset.positionId;
    const r=await api('/api/fund-transactions/'+encodeURIComponent(txId),{method:'DELETE'});
    if(r.ok){await loadPortfolio(true);if(positionId)await openFundTransactions(positionId)}
    return;
   }
   const edit=e.target.closest&&e.target.closest('[data-fund-position-edit]');
   if(edit){
    const position=account.positions.find(p=>String(p.id)===String(edit.dataset.fundPositionEdit));if(position)await openPositionForm(productForPosition(position),position);return;
   }
   const del=e.target.closest&&e.target.closest('[data-fund-position-delete]');
   if(del){
    const id=del.dataset.fundPositionDelete;
    const r=await api('/api/fund-positions/'+encodeURIComponent(id),{method:'DELETE'});if(r.ok)await loadPortfolio(true);return;
   }
  });
  q('.portfolio-asset-switch')?.addEventListener('keydown',e=>{
   if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;
   const tabs=[...document.querySelectorAll('[data-portfolio-asset]')],current=tabs.indexOf(document.activeElement);if(current<0)return;
   e.preventDefault();const next=e.key==='ArrowRight'?(current+1)%tabs.length:(current-1+tabs.length)%tabs.length;
   tabs[next]?.focus();tabs[next]?.click();
  });
  document.addEventListener('submit',async e=>{
   if(e.target.id==='fundPositionForm'){e.preventDefault();try{await savePosition(e.target)}catch(err){console.warn(err);q('#fundModalBody')?.insertAdjacentHTML('afterbegin','<div class="portfolio-render-warning">'+esc(err.message||'No se pudo guardar la posición.')+'</div>')}return}
   if(e.target.id==='fundTransactionForm'){e.preventDefault();try{await saveFundTransaction(e.target)}catch(err){console.warn(err);q('#fundModalBody')?.insertAdjacentHTML('afterbegin','<div class="portfolio-render-warning">'+esc(err.message||'No se pudo guardar la operación.')+'</div>')}return}
   if(e.target.id==='fundPlanForm'){
    e.preventDefault();const fd=new FormData(e.target),selected=selectedFundPortfolio();
    try{const r=await api('/api/fund-plans',{method:'POST',body:JSON.stringify({fundPortfolioId:selected.id,fundPositionId:String(fd.get('positionId')||''),isin:String(fd.get('isin')||''),label:String(fd.get('label')||''),kind:String(fd.get('kind')||'monthly'),amount:num(fd.get('amount')),dayOfMonth:num(fd.get('day')),currency:String(fd.get('currency')||'EUR'),notes:String(fd.get('notes')||'')})});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudo guardar la programación.');closeModal();await loadPortfolio(true)}catch(err){q('#fundModalBody')?.insertAdjacentHTML('afterbegin','<div class="portfolio-render-warning">'+esc(err.message)+'</div>')}return
   }
   if(e.target.id==='fundPortfolioEditForm'){
    e.preventDefault();const fd=new FormData(e.target),id=e.target.dataset.id;
    try{const r=await api('/api/fund-portfolios/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({name:String(fd.get('name')||''),platform:String(fd.get('platform')||'')})});if(!r.ok)throw Error('No se pudo editar la cartera.');closeModal();await loadPortfolio(true)}catch(err){q('#fundModalBody')?.insertAdjacentHTML('afterbegin','<div class="portfolio-render-warning">'+esc(err.message)+'</div>')}return
   }
   if(e.target.id==='fundPortfolioForm'){
    e.preventDefault();const fd=new FormData(e.target);
    try{
     const r=await api('/api/fund-portfolios',{method:'POST',body:JSON.stringify({name:String(fd.get('name')||''),platform:String(fd.get('platform')||''),baseCurrency:'EUR'})});
     const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudo crear la cartera.');
     closeModal();account.selectedPortfolioId=data.portfolio.id;await loadPortfolio(true);
    }catch(err){console.warn(err);q('#fundModalBody')?.insertAdjacentHTML('afterbegin','<div class="portfolio-render-warning">'+esc(err.message||'No se pudo crear la cartera.')+'</div>')}
   }
  });
  window.addEventListener('viewinvai:auth-changed',()=>loadPortfolio(true));
  window.addEventListener('viewinvai:account-ready',()=>loadPortfolio(true));
 }
 function init(){
  bind();
  if(root.matchMedia){
   const mq=root.matchMedia('(max-width:820px)');
   if(typeof mq.addEventListener==='function')mq.addEventListener('change',()=>{if(state.loaded)render()});
  }
  if(document.querySelector('#view-funds'))load(false);
  renderPortfolio();
 }

 root.ViewInvAIFunds={init,load,render,loadPortfolio,renderPortfolio,renderMarketTop10,getState:()=>state,getAccountState:()=>account,getByIsin:isin=>state.products.find(p=>p.isin===isin)||null,getCurrentValue:fundCurrentValue,getFreshness:fundFreshness};
})(window);
