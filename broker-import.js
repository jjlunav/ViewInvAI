/* ViewInvAI · importar operaciones desde el bróker.
 * - Interactive Brokers: Flex Web Service (oficial, solo lectura). El token y el Query ID
 *   se guardan solo en este dispositivo; el Worker los usa en cada llamada y no los guarda.
 * - Trade Republic: no tiene API pública; se importa su exportación CSV de transacciones.
 * - Cualquier otro bróker: CSV con columnas reconocibles (fecha, tipo, ISIN, cantidad, precio…).
 * Cada operación lleva el identificador del bróker, así que reimportar no duplica nada.
 */
(function(){
 'use strict';
 const IBKR_KEY='viewinvai:ibkr-flex';
 const CHUNK=60;
 const P=()=>window.ViewInvAIPortfolios||{};
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=(v,d=2)=>Number.isFinite(+v)?Number(v).toLocaleString('es-ES',{maximumFractionDigits:d}):'—';
 let flow={source:'tr',rows:[],positions:[],unmatched:[],portfolioId:''};

 function readIbkr(){try{return JSON.parse(localStorage.getItem(IBKR_KEY)||'null')||null}catch(_){return null}}
 function writeIbkr(v){try{v?localStorage.setItem(IBKR_KEY,JSON.stringify(v)):localStorage.removeItem(IBKR_KEY)}catch(_){}}

 /* ---------- CSV ---------- */
 function parseCsv(text){
  text=String(text||'').replace(/^﻿/,'');
  const first=text.split(/\r?\n/).find(l=>l.trim())||'';
  const delim=[';',',','\t'].map(d=>[d,first.split(d).length]).sort((a,b)=>b[1]-a[1])[0][0];
  const rows=[];let row=[],cell='',q=false;
  for(let i=0;i<text.length;i++){
   const c=text[i];
   if(q){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else q=false}else cell+=c;continue}
   if(c==='"')q=true;
   else if(c===delim){row.push(cell);cell=''}
   else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);cell='';if(row.some(x=>x.trim()))rows.push(row);row=[]}
   else cell+=c;
  }
  row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
  return rows;
 }
 const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
 const COLS={
  date:['date','datum','fecha','time','timestamp','zeitpunkt','trade date','execution date','fecha de ejecucion','booking date','buchungsdatum','valuta'],
  side:['type','typ','tipo','side','transaction type','transaktion','art','buy sell','operacion','direction','action'],
  isin:['isin'],
  name:['name','instrument','title','wertpapier','description','nombre','asset','security','producto'],
  symbol:['symbol','ticker','simbolo'],
  qty:['shares','quantity','qty','anzahl','stuck','stueck','cantidad','titulos','units','participaciones','acciones','number of shares'],
  price:['price','kurs','precio','share price','price per share','precio por accion','execution price','unit price'],
  amount:['amount','betrag','importe','total','value','net amount','gross amount','valor'],
  fee:['fee','fees','gebuhr','gebuehr','gebuhren','comision','commission','kosten','costs','fremdkostenzuschlag'],
  currency:['currency','wahrung','waehrung','moneda','ccy'],
  tax:['tax','taxes','steuer','steuern','impuesto','impuestos','retencion','withholding tax','quellensteuer','tax amount'],
  id:['id','transaction id','reference','referenz','order id','execution id','referencia','uuid']
 };
 function mapHeader(header){
  const h=header.map(norm),out={};
  for(const [key,names] of Object.entries(COLS)){
   let idx=h.findIndex(x=>names.includes(x));
   if(idx<0)idx=h.findIndex(x=>names.some(n=>n.length>3&&x.includes(n)));
   if(idx>=0)out[key]=idx;
  }
  return out;
 }
 function num(v){
  let s=String(v??'').replace(/[^\d,.\-]/g,'');
  if(!s)return null;
  const lc=s.lastIndexOf(','),ld=s.lastIndexOf('.');
  if(lc>ld)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');
  const n=Number(s);return Number.isFinite(n)?n:null;
 }
 function dateIso(v){
  const s=String(v||'').trim();if(!s)return'';
  let m=s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m){const d=new Date(+m[3],+m[2]-1,+m[1],+(m[4]||12),+(m[5]||0),+(m[6]||0));return isNaN(d)?'':d.toISOString()}
  const d=new Date(s.replace(' ','T'));return isNaN(d)?'':d.toISOString();
 }
 function sideOf(v){
  const t=norm(v);
  if(/\b(dividend|dividends|dividende|dividenden|dividendo|dividendos|ausschuttung|distribution|distribucion)\b/.test(t))return'DIV';
  if(/\b(sell|verkauf|venta|vender|sale|sold)\b/.test(t))return'SELL';
  if(/\b(buy|kauf|compra|comprar|purchase|bought|sparplan|savings plan|plan de inversion|saveback|round up|redondeo)\b/.test(t))return'BUY';
  return'';
 }
 // Trade Republic's current export puts the ISIN in the «symbol» column.
 function idOf(isinCell,symbolCell){
  let isin=String(isinCell||'').trim().toUpperCase(),symbol=String(symbolCell||'').trim().toUpperCase();
  if(!isin&&/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(symbol)){isin=symbol;symbol=''}
  return{isin,symbol};
 }
 function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36)}
 function rowsFromCsv(text,source){
  const table=parseCsv(text);
  if(table.length<2)throw new Error('El archivo no tiene filas de datos.');
  // Some exports put a title line first: use the first line that maps the key columns.
  let hi=table.findIndex(r=>{const m=mapHeader(r);return m.qty!==undefined&&(m.isin!==undefined||m.symbol!==undefined)});
  if(hi<0)throw new Error('No encuentro las columnas de cantidad e ISIN/símbolo. Columnas leídas: '+table[0].join(', '));
  const map=mapHeader(table[hi]),out=[],skipped={},dividends=[];
  for(const r of table.slice(hi+1)){
   const get=k=>map[k]===undefined?'':r[map[k]];
   const side=sideOf(get('side'))||(num(get('qty'))<0?'SELL':num(get('qty'))>0&&map.side===undefined?'BUY':'');
   if(side==='DIV'){
    // «amount» is the cash booked (after tax), as for buys and sells; «tax» is the withholding.
    const paidAt=dateIso(get('date')),cash=Math.abs(num(get('amount'))||0),tax=Math.abs(num(get('tax'))||0);
    const {isin,symbol}=idOf(get('isin'),get('symbol'));
    if(!paidAt||!(cash+tax>0)||!(isin||symbol)){skipped['dividendo incompleto']=(skipped['dividendo incompleto']||0)+1;continue}
    const ext=String(get('id')||'').trim();
    dividends.push({externalId:source+'-div:'+(ext||hash([paidAt,isin||symbol,cash,tax].join('|'))),paidAt,isin,ticker:symbol,name:String(get('name')||'').trim(),
     currency:String(get('currency')||'').trim().toUpperCase()||(source==='tr'?'EUR':'USD'),gross:Math.round((cash+tax)*1e4)/1e4,withholding:tax,noTaxColumn:map.tax===undefined});
    continue;
   }
   if(!side){const t=String(get('side')||'otro').trim()||'otro';skipped[t]=(skipped[t]||0)+1;continue}
   const qty=Math.abs(num(get('qty'))||0);if(!qty)continue;
   let price=num(get('price'));const amount=num(get('amount')),fee=Math.abs(num(get('fee'))||0);
   if((price===null||price<=0)&&amount!==null)price=Math.max(0,(Math.abs(amount)-(side==='BUY'?fee:-fee)))/qty;
   if(price===null)continue;
   const executedAt=dateIso(get('date'));if(!executedAt)continue;
   const {isin,symbol}=idOf(get('isin'),get('symbol'));
   const ext=String(get('id')||'').trim();
   out.push({
    externalId:source+':'+(ext||hash([executedAt,isin||symbol,side,qty,price,amount].join('|'))),
    side,quantity:qty,price:Math.abs(price),fees:fee,currency:String(get('currency')||'').trim().toUpperCase()||(source==='tr'?'EUR':''),
    isin,symbol,name:String(get('name')||'').trim(),executedAt
   });
  }
  return{rows:out,skipped,dividends};
 }
 // Fill ticker/name from the catalogue so the preview and Fiscal read well.
 function enrichDividends(list){
  const {byIsin,bySymbol}=catalog();
  return (list||[]).map(d=>{const s=(d.isin&&byIsin.get(d.isin))||(d.ticker&&bySymbol.get(d.ticker))||null;return s?{...d,ticker:d.ticker||s.ticker||'',name:s.name||d.name||''}:d});
 }

 /* ---------- catálogo ---------- */
 const SUFFIX=new Set(['inc','incorporated','corp','corporation','co','company','ltd','limited','plc','ag','se','sa','nv','holdings','holding','group','spa','llc','lp','adr','ads','ordinary','shares','common','stock','class','the','a','registered','namens','aktie','aktien','reg']);
 const nameKey=v=>norm(String(v||'').replace(/\([^)]*\)/g,' ')).split(' ').filter(w=>w&&!SUFFIX.has(w)).join(' ');
 function catalog(){
  const all=window.ViewInvAI&&typeof window.ViewInvAI.getAllStocks==='function'?window.ViewInvAI.getAllStocks():[];
  const byIsin=new Map(),bySymbol=new Map(),byName=new Map();
  for(const s of all){
   for(const i of [s.isin,s.usIsin,s.trIsin])if(i&&!byIsin.has(String(i).toUpperCase()))byIsin.set(String(i).toUpperCase(),s);
   for(const t of [s.ticker,s.trTicker])if(t&&!bySymbol.has(String(t).toUpperCase()))bySymbol.set(String(t).toUpperCase(),s);
   const k=nameKey(s.name);if(k){if(!byName.has(k))byName.set(k,[]);byName.get(k).push(s)}
  }
  return{byIsin,bySymbol,byName};
 }
 // Last resort when the ISIN is not in the catalogue: same company name, and only
 // if it points to a single primary listing (largest market cap wins ties of share classes).
 function byCompanyName(byName,name){
  const list=byName.get(nameKey(name))||[];
  if(!list.length)return null;
  const sorted=list.slice().sort((a,b)=>(b.marketCap||0)-(a.marketCap||0));
  return sorted.length===1||/^[A-Z]{1,5}$/.test(sorted[0].ticker||'')?sorted[0]:null;
 }
 function matchRows(rows,source){
  const {byIsin,bySymbol,byName}=catalog(),matched=[],unmatched=[];
  const preferTr=source==='tr';
  for(const r of rows){
   const s=(r.isin&&byIsin.get(r.isin))||(r.symbol&&bySymbol.get(r.symbol))||(r.name&&byCompanyName(byName,r.name))||null;
   if(!s){unmatched.push(r);continue}
   const key=window.ViewInvAI.getStockKey(s);
   const currency=preferTr?'EUR':(r.currency||s.currency||'USD');
   const fees=r.feeCurrency&&r.feeCurrency!==currency?0:r.fees;
   matched.push({
    externalId:r.externalId,side:r.side,quantity:r.quantity,price:r.price,fees,currency,executedAt:r.executedAt,
    stockKey:key,preferTr,
    ticker:preferTr?(s.trTicker||s.ticker):(s.ticker||r.symbol),
    name:s.name||r.name||'',
    exchange:preferTr?(s.trExchange||'LSX'):(s.exchange||r.exchange||''),
    isin:preferTr?(s.trIsin||r.isin||s.isin||''):(s.isin||s.usIsin||r.isin||''),
    notes:'Importado de '+(source==='tr'?'Trade Republic':source==='ibkr'?'Interactive Brokers':'CSV')
   });
  }
  matched.sort((a,b)=>Date.parse(a.executedAt)-Date.parse(b.executedAt)||(a.side==='BUY'?-1:1));
  return{matched,unmatched};
 }

 /* ---------- UI ---------- */
 function portfolios(){return typeof P().getPortfolios==='function'?P().getPortfolios():[]}
 function guessPortfolio(source){
  const list=portfolios(),selected=typeof P().getSelectedPortfolioId==='function'?P().getSelectedPortfolioId():'';
  const want=source==='ibkr'?/interactive|ibkr/i:source==='tr'?/trade ?republic|\btr\b/i:null;
  const hit=want&&list.find(p=>want.test(p.broker||'')||want.test(p.name||''));
  return String((hit&&hit.id)||selected||(list[0]&&list[0].id)||'');
 }
 function sourceTabs(){
  const t=(k,l)=>'<button type="button" class="tab'+(flow.source===k?' active':'')+'" data-import-source="'+k+'">'+l+'</button>';
  return '<nav class="market-tabs compact-tabs broker-import-tabs">'+t('tr','Trade Republic')+t('ibkr','IBKR')+t('csv','Otro CSV')+'</nav>';
 }
 function portfolioSelect(){
  const list=portfolios();
  return '<label class="broker-import-field"><span>Cartera de destino</span><select data-import-portfolio>'+
   list.map(p=>'<option value="'+esc(p.id)+'"'+(String(p.id)===String(flow.portfolioId)?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label>';
 }
 function sourceBody(){
  if(flow.source==='ibkr'){
   const saved=readIbkr()||{};
   return '<p class="broker-import-help">Conexión oficial de solo lectura (<b>Flex Web Service</b>). En el portal de IBKR: <i>Rendimiento e informes → Flex Queries</i>, crea una <b>Activity Flex Query</b> en XML con las secciones <b>Trades</b>, <b>Open Positions</b> y <b>Cash Transactions</b> (dividendos y retenciones) (periodo: últimos 365 días) y apunta su <b>Query ID</b>. Después activa <i>Flex Web Service</i> y genera el <b>token</b>.</p>'+
    '<div class="broker-import-grid"><label class="broker-import-field"><span>Token Flex</span><input data-ibkr-token type="password" autocomplete="off" inputmode="numeric" value="'+esc(saved.token||'')+'" placeholder="Token de Flex Web Service"></label>'+
    '<label class="broker-import-field"><span>Query ID</span><input data-ibkr-query inputmode="numeric" value="'+esc(saved.queryId||'')+'" placeholder="123456"></label></div>'+
    portfolioSelect()+
    '<label class="broker-import-check"><input type="checkbox" data-ibkr-remember'+(saved.token?' checked':'')+'> Recordar en este dispositivo y sincronizar solo al abrir Carteras</label>'+
    '<button type="button" class="btn secondary broker-import-go" data-ibkr-fetch>Leer operaciones de IBKR</button>';
  }
  const tr=flow.source==='tr';
  return '<p class="broker-import-help">'+(tr
    ?'Trade Republic no ofrece API pública. Exporta tus <b>transacciones en CSV</b> desde Trade Republic (app o web) y súbelo aquí: se importan compras, ventas, planes de inversión y <b>dividendos con su retención</b> (para Fiscal); intereses e ingresos se ignoran.'
    :'Sube el CSV de tu bróker. Se reconocen columnas de fecha, tipo (compra/venta), ISIN o símbolo, cantidad, precio o importe, comisión y divisa, en español, inglés o alemán.')+'</p>'+
   portfolioSelect()+
   '<label class="broker-import-file"><input type="file" accept=".csv,text/csv,text/plain" data-import-file><span>Elegir archivo CSV</span></label>';
 }
 function render(){
  const open=P().openModal;if(typeof open!=='function')return;
  open('Importar operaciones','<div class="broker-import">'+sourceTabs()+sourceBody()+
   '<p class="broker-import-note">Si ya apuntaste a mano estas posiciones en la misma cartera, impórtalas en una cartera nueva para no contarlas dos veces. Reimportar el mismo archivo no duplica operaciones.</p>'+
   '<div data-import-status class="broker-import-status" aria-live="polite"></div></div>');
 }
 function status(html,error=false){const el=document.querySelector('[data-import-status]');if(el){el.innerHTML=html;el.classList.toggle('error',!!error)}}
 function previewHtml(){
  const {matched,unmatched}=flow,buys=matched.filter(r=>r.side==='BUY').length,sells=matched.length-buys;
  const list=matched.slice(-40).reverse().map(r=>'<li><span class="'+(r.side==='BUY'?'buy':'sell')+'">'+(r.side==='BUY'?'Compra':'Venta')+'</span><b>'+esc(r.ticker)+'</b><em>'+fmt(r.quantity,4)+' × '+fmt(r.price,4)+' '+esc(r.currency)+'</em><small>'+esc(new Date(r.executedAt).toLocaleDateString('es-ES'))+'</small></li>').join('');
  let warn='';
  if(flow.positions&&flow.positions.length){
   const net=new Map();matched.forEach(r=>{const k=r.isin||r.ticker;net.set(k,(net.get(k)||0)+(r.side==='BUY'?r.quantity:-r.quantity))});
   const gaps=flow.positions.filter(p=>Math.abs((net.get(p.isin)||net.get(p.symbol)||0)-p.quantity)>1e-6);
   if(gaps.length)warn='<p class="broker-import-warn">IBKR indica posiciones que el periodo del informe no explica del todo ('+gaps.slice(0,4).map(g=>esc(g.symbol)+' '+fmt(g.quantity,4)).join(', ')+'). Amplía el periodo de la Flex Query para traer las compras anteriores.</p>';
  }
  const divs=flow.dividends||[];
  let divHtml='';
  if(divs.length){
   const byCur={};divs.forEach(d=>{const c=byCur[d.currency]=byCur[d.currency]||{g:0,w:0};c.g+=d.gross;c.w+=d.withholding});
   divHtml='<p class="broker-import-help">Dividendos: <b>'+divs.length+'</b> cobros · '+Object.entries(byCur).map(([c,v])=>'bruto '+fmt(v.g)+' '+esc(c)+', retenido '+fmt(v.w)+' '+esc(c)).join(' · ')+'. Van a Fiscal (no cambian tus posiciones).'+
    (divs.some(d=>d.noTaxColumn)?' El archivo no trae columna de impuestos: revisa las retenciones en Fiscal.':'')+'</p>';
  }
  const total=matched.length+divs.length;
  return '<div class="broker-import-preview"><div class="broker-import-counts"><span><b>'+matched.length+'</b> operaciones</span><span class="buy">'+buys+' compras</span><span class="sell">'+sells+' ventas</span>'+(divs.length?'<span>'+divs.length+' dividendos</span>':'')+(unmatched.length?'<span class="warn">'+unmatched.length+' sin emparejar</span>':'')+'</div>'+divHtml+
   warn+(unmatched.length?'<p class="broker-import-warn">No están en el catálogo de ViewInvAI: '+esc([...new Set(unmatched.map(u=>u.symbol||u.isin||u.name))].slice(0,8).join(', '))+(unmatched.length>8?'…':'')+'.</p>':'')+
   '<ul class="broker-import-list">'+list+'</ul>'+
   '<label class="broker-import-check"><input type="checkbox" data-import-cash> Ajustar también el efectivo de la cartera</label>'+
   '<button type="button" class="btn secondary broker-import-go" data-import-commit'+(total?'':' disabled')+'>Importar '+(matched.length?matched.length+(matched.length===1?' operación':' operaciones'):'')+(matched.length&&divs.length?' y ':'')+(divs.length?divs.length+(divs.length===1?' dividendo':' dividendos'):'')+(total?'':'0 operaciones')+'</button></div>';
 }
 function showPreview(rows,source,extra=''){
  const {matched,unmatched}=matchRows(rows,source);
  flow.matched=matched;flow.unmatched=unmatched;flow.dividends=enrichDividends(flow.dividends);
  status(extra+previewHtml());
 }
 async function commit(button){
  const portfolioId=flow.portfolioId,rows=flow.matched||[],divs=flow.dividends||[];if(!portfolioId||!(rows.length||divs.length))return;
  const adjustCash=!!document.querySelector('[data-import-cash]')?.checked;
  const broker=flow.source==='ibkr'?'Interactive Brokers':flow.source==='tr'?'Trade Republic':'';
  let imported=0,skipped=0,errors=[];
  if(button){button.disabled=true}
  try{
   for(let i=0;i<rows.length;i+=CHUNK){
    if(button)button.textContent='Importando '+Math.min(i+CHUNK,rows.length)+'/'+rows.length+'…';
    const res=await window.ViewInvAIAuth.apiFetch('/api/transactions/import',{method:'POST',body:JSON.stringify({portfolioId,source:flow.source,broker,adjustCash,rows:rows.slice(i,i+CHUNK)})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'No se pudo importar.');
    imported+=data.imported||0;skipped+=data.skipped||0;errors=errors.concat(data.errors||[]);
   }
   let divImported=0,divSkipped=0;
   for(let i=0;i<divs.length;i+=200){
    if(button)button.textContent='Importando dividendos…';
    const res=await window.ViewInvAIAuth.apiFetch('/api/dividends/import',{method:'POST',body:JSON.stringify({portfolioId,source:flow.source,broker,rows:divs.slice(i,i+200)})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'No se pudieron importar los dividendos.');
    divImported+=data.imported||0;divSkipped+=data.skipped||0;errors=errors.concat(data.errors||[]);
   }
   status('<div class="broker-import-done"><strong>'+imported+(imported===1?' operación importada':' operaciones importadas')+(divs.length?' · '+divImported+' dividendos':'')+'</strong>'+(skipped||divSkipped?'<span>'+(skipped+divSkipped)+' ya estaban importados</span>':'')+
    (errors.length?'<p class="broker-import-warn">'+errors.length+' no se pudieron registrar: '+esc(errors.slice(0,5).map(e=>(e.ticker||'')+' · '+e.error).join(' | '))+'</p>':'')+'</div>',errors.length&&!imported);
   if(typeof P().reload==='function')await P().reload();
   if(window.ViewInvAITax)window.ViewInvAITax._invalidate();
   if(flow.source==='ibkr'){const saved=readIbkr();if(saved){saved.lastSyncAt=Date.now();saved.portfolioId=portfolioId;writeIbkr(saved)}}
  }catch(e){status(esc(e.message||'No se pudo importar.'),true);if(button){button.disabled=false;button.textContent='Reintentar importación'}}
 }
 async function fetchIbkr(creds){
  const res=await window.ViewInvAIAuth.apiFetch('/api/broker-sync/ibkr',{method:'POST',body:JSON.stringify({token:creds.token,queryId:creds.queryId})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||'IBKR no respondió.');
  return data;
 }

 document.addEventListener('click',async e=>{
  const t=e.target;
  const src=t.closest&&t.closest('[data-import-source]');
  if(src){flow={source:src.dataset.importSource,rows:[],positions:[],portfolioId:guessPortfolio(src.dataset.importSource)};render();return}
  if(t.closest&&t.closest('[data-import-commit]')){commit(t.closest('[data-import-commit]'));return}
  const go=t.closest&&t.closest('[data-ibkr-fetch]');
  if(go){
   const token=(document.querySelector('[data-ibkr-token]')?.value||'').trim(),queryId=(document.querySelector('[data-ibkr-query]')?.value||'').trim();
   if(!token||!queryId){status('Indica el token y el Query ID.',true);return}
   if(document.querySelector('[data-ibkr-remember]')?.checked)writeIbkr({...(readIbkr()||{}),token,queryId,portfolioId:flow.portfolioId});else writeIbkr(null);
   go.disabled=true;go.textContent='Consultando IBKR…';status('');
   try{const data=await fetchIbkr({token,queryId});flow.positions=data.positions||[];flow.dividends=data.dividends||[];showPreview(data.trades||[],'ibkr')}
   catch(err){status(esc(err.message),true)}
   finally{if(go.isConnected){go.disabled=false;go.textContent='Leer operaciones de IBKR'}}
  }
 });
 document.addEventListener('change',e=>{
  const t=e.target;
  if(t.matches&&t.matches('[data-import-portfolio]')){flow.portfolioId=t.value;return}
  if(t.matches&&t.matches('[data-import-file]')&&t.files&&t.files[0]){
   const file=t.files[0];
   if(file.size>5e6){status('El archivo es demasiado grande (máx. 5 MB).',true);return}
   file.text().then(text=>{
    const {rows,skipped,dividends}=rowsFromCsv(text,flow.source==='tr'?'tr':'csv');
    flow.dividends=dividends||[];
    const ign=Object.entries(skipped);
    showPreview(rows,flow.source,ign.length?'<p class="broker-import-help">Ignoradas (no son compras, ventas ni dividendos): '+esc(ign.slice(0,6).map(([k,v])=>k+' ×'+v).join(', '))+'</p>':'');
   }).catch(err=>status(esc(err.message||'No se pudo leer el archivo.'),true));
  }
 });

 // Sincronización silenciosa de IBKR al abrir Carteras (como mucho cada 6 h).
 async function autoSync(){
  const saved=readIbkr();
  if(!saved||!saved.token||!saved.queryId||!saved.portfolioId)return;
  if(Date.now()-(saved.lastSyncAt||0)<6*3600e3)return;
  if(!window.ViewInvAIAuth||typeof window.ViewInvAIAuth.getUser!=='function'||!window.ViewInvAIAuth.getUser())return;
  saved.lastSyncAt=Date.now();writeIbkr(saved);
  try{
   const data=await fetchIbkr(saved);
   const {matched}=matchRows(data.trades||[],'ibkr');
   let imported=0;
   const divs=enrichDividends(data.dividends||[]);
   if(divs.length){
    const res=await window.ViewInvAIAuth.apiFetch('/api/dividends/import',{method:'POST',body:JSON.stringify({portfolioId:saved.portfolioId,source:'ibkr',broker:'Interactive Brokers',rows:divs.slice(0,300)})});
    const out=await res.json().catch(()=>({}));if(res.ok&&out.imported&&window.ViewInvAITax)window.ViewInvAITax._invalidate();
   }
   if(!matched.length)return;
   for(let i=0;i<matched.length;i+=CHUNK){
    const res=await window.ViewInvAIAuth.apiFetch('/api/transactions/import',{method:'POST',body:JSON.stringify({portfolioId:saved.portfolioId,source:'ibkr',broker:'Interactive Brokers',rows:matched.slice(i,i+CHUNK)})});
    const out=await res.json().catch(()=>({}));if(!res.ok)return;imported+=out.imported||0;
   }
   if(imported){if(typeof P().reload==='function')await P().reload();if(typeof P().toast==='function')P().toast('IBKR: '+imported+' operaciones nuevas importadas')}
  }catch(_){}
 }
 window.addEventListener('viewinvai:view-changed',e=>{if(e&&e.detail&&e.detail.view==='portfolios')setTimeout(autoSync,1500)});

 window.ViewInvAIBrokerImport={
  open(source){flow={source:source||'tr',rows:[],positions:[],portfolioId:guessPortfolio(source||'tr')};render()},
  _parseCsv:rowsFromCsv,_match:matchRows
 };
})();
