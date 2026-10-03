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

 // En localStorage solo quedan Query ID, cartera y fecha de sincronización; el token va al almacén cifrado.
 const SECURE=()=>window.ViewInvAISecure||null;
 function readIbkr(){try{return JSON.parse(localStorage.getItem(IBKR_KEY)||'null')||null}catch(_){return null}}
 function writeIbkr(v){try{if(v){const meta={...v};if(meta.hasToken)delete meta.token;localStorage.setItem(IBKR_KEY,JSON.stringify(meta))}else localStorage.removeItem(IBKR_KEY)}catch(_){}}
 async function ibkrToken(){
  const saved=readIbkr();if(!saved)return '';
  if(saved.token){ // versión anterior: token en texto plano → se mueve al almacén cifrado
   const legacy=String(saved.token);
   try{if(SECURE()){await SECURE().set('ibkr-token',legacy);writeIbkr({...saved,hasToken:true})}}catch(_){}
   return legacy;
  }
  if(!saved.hasToken||!SECURE())return '';
  return (await SECURE().get('ibkr-token'))||'';
 }
 async function rememberIbkr(token,meta){
  if(!SECURE())throw new Error('Este dispositivo no permite guardar el token cifrado.');
  if(token)await SECURE().set('ibkr-token',token);
  writeIbkr({...(readIbkr()||{}),...meta,hasToken:true});
 }
 async function forgetIbkr(){writeIbkr(null);try{if(SECURE())await SECURE().remove('ibkr-token')}catch(_){}}

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
  id:['id','transaction id','reference','referenz','order id','execution id','referencia','uuid'],
  desc:['description','beschreibung','descripcion','details']
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
  const map=mapHeader(table[hi]),out=[],skipped={},dividends=[],benefits=[];
  for(const r of table.slice(hi+1)){
   const get=k=>map[k]===undefined?'':r[map[k]];
   // Trade Republic: Saveback y Redondeo llegan como abono en efectivo (BENEFITS_SAVEBACK…) seguido
   // de la compra del mismo importe. El abono no es una operación: sirve para etiquetar esa compra.
   const rawKind=String(get('side')||'')+' '+String(map.desc!==undefined&&map.desc!==map.name?get('desc'):'');
   if(/benefit|saveback|spare|round ?up|redondeo/i.test(rawKind)&&!(Math.abs(num(get('qty'))||0)>0)){
    const amt=Math.abs(num(get('amount'))||0),d=dateIso(get('date'));
    if(amt>0&&d)benefits.push({date:d,amount:amt,kind:/spare|round ?up|redondeo/i.test(rawKind)?'roundup':'saveback'});
    continue;
   }
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
   const rawType=String(get('side')||'')+' '+String(map.desc!==undefined&&map.desc!==map.name?get('desc'):'');
   const benefit=/saveback/i.test(rawType)?'saveback':/spare|round ?up|redondeo/i.test(rawType)?'roundup':'';
   out.push({
    benefit,cash:amount!==null?Math.abs(amount):qty*Math.abs(price)+(side==='BUY'?fee:0),
    plan:!benefit&&/plan|sparplan|savings/i.test(rawType),
    externalId:source+':'+(ext||hash([executedAt,isin||symbol,side,qty,price,amount].join('|'))),
    side,quantity:qty,price:Math.abs(price),fees:fee,currency:String(get('currency')||'').trim().toUpperCase()||(source==='tr'?'EUR':''),
    isin,symbol,name:String(get('name')||'').trim(),executedAt
   });
  }
  tagBenefits(out,benefits);
  return{rows:out,skipped,dividends,benefits};
 }
 // Empareja cada abono de Saveback/Redondeo con la compra del mismo importe (ese día o hasta 7 después).
 function tagBenefits(rows,benefits){
  for(const b of benefits){
   const t0=Date.parse(b.date);let best=null,bestGap=Infinity;
   for(const r of rows){
    if(r.side!=='BUY'||r.benefit||Math.abs((r.cash||0)-b.amount)>0.011)continue;
    const gap=(Date.parse(r.executedAt)-t0)/864e5;
    if(gap<-1||gap>7)continue;
    if(Math.abs(gap)<bestGap){best=r;bestGap=Math.abs(gap)}
   }
   if(best){best.benefit=b.kind;best.plan=false}
  }
  guessBenefits(rows);
 }
 // Si el CSV no trae el abono (el Redondeo se cobra de tu saldo), se reconocen por su patrón:
 // Redondeo = compras pequeñas los días 2, 9, 16 y 23 (o el siguiente hábil) de importe variable;
 // Saveback = una compra pequeña de importe variable cada día 2 (o siguiente hábil), sin ser plan.
 function guessBenefits(rows){
  const byIsin=new Map();
  for(const r of rows){if(r.side!=='BUY'||r.benefit||r.plan||!r.isin||!(r.cash>0)||r.cash>35)continue;(byIsin.get(r.isin)||byIsin.set(r.isin,[]).get(r.isin)).push(r)}
  const day=r=>new Date(r.executedAt).getUTCDate();
  const nearSlot=(d,slots)=>slots.some(x=>d>=x&&d<=x+3);
  const varies=list=>{const a=list.map(r=>r.cash),m=a.reduce((x,y)=>x+y,0)/a.length;return m>0&&Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length)/m>0.15};
  for(const all of byIsin.values()){
   // Un importe que se repite (±2 %) es el plan en ese mismo fondo: se aparta antes de buscar el patrón.
   const rep=all.filter(r=>all.filter(x=>x!==r&&Math.abs(x.cash-r.cash)<=Math.max(x.cash,r.cash)*.02).length>=1&&r.cash>=5);
   const list=all.filter(r=>!rep.includes(r));
   if(list.length<3||!varies(list))continue;
   list.sort((a,b)=>Date.parse(a.executedAt)-Date.parse(b.executedAt));
   const gaps=[];for(let i=1;i<list.length;i++)gaps.push((Date.parse(list[i].executedAt)-Date.parse(list[i-1].executedAt))/864e5);
   const med=gaps.slice().sort((a,b)=>a-b)[gaps.length>>1];
   if(med>=5&&med<=10&&list.filter(r=>nearSlot(day(r),[2,9,16,23])).length>=list.length*.8)list.forEach(r=>{r.benefit='roundup';r.benefitGuess=true});
   else if(med>=26&&med<=35&&list.filter(r=>nearSlot(day(r),[2])).length>=list.length*.8)list.forEach(r=>{r.benefit='saveback';r.benefitGuess=true});
  }
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
 // Funds, ETFs and ETCs go to the fund portfolio: by the funds catalogue, or by name
 // for products the catalogue does not list (UCITS ETFs, physical gold ETCs…).
 function fundProduct(r){
  const F=window.ViewInvAIFunds;
  const p=r.isin&&F&&typeof F.getByIsin==='function'?F.getByIsin(r.isin):null;
  if(p)return{isin:p.isin,name:p.name||r.name,type:p.type==='etf'?'etf':p.type==='fund'?'fund':'etp',provider:p.provider||'',index:p.index||''};
  if(r.isin&&/\b(etf|etc|etp|ucits|fund|fonds|fondo|index|indice|msci|s&p|gold|oro|physical)\b/i.test(r.name||''))
   return{isin:r.isin,name:r.name,type:/\b(etc|etp|gold|oro|physical)\b/i.test(r.name)?'etp':/\b(etf|ucits)\b/i.test(r.name)?'etf':'fund',provider:'',index:''};
  return null;
 }
 // Reuse the key a value already has in the target portfolio (manual entry by ISIN, an
 // earlier import) so a later import never splits it in two positions.
 function existingKeys(portfolioId){
  const m=new Map();
  const rows=typeof P().getPositionsDetail==='function'?P().getPositionsDetail(portfolioId||null):[];
  rows.forEach(r=>{if(r.isin&&!m.has(r.isin))m.set(r.isin,r.stockKey)});
  return m;
 }
 function matchRows(rows,source){
  const {byIsin,bySymbol,byName}=catalog(),matched=[],unmatched=[],funds=[],uncatalogued=[];
  const preferTr=source==='tr';
  const keep=existingKeys(flow.portfolioId);
  for(const r of rows){
   const s=(r.isin&&byIsin.get(r.isin))||(r.symbol&&bySymbol.get(r.symbol))||(r.name&&byCompanyName(byName,r.name))||null;
   if(!s){
    const f=fundProduct(r);
    if(f){funds.push({externalId:r.externalId,isin:f.isin,name:f.name,productType:f.type,provider:f.provider,indexName:f.index,side:r.side,units:r.quantity,price:r.price,fees:r.fees,currency:r.currency||'EUR',executedAt:r.executedAt,plan:!!r.plan,benefit:r.benefit||'',benefitGuess:!!r.benefitGuess,cash:r.cash});continue}
    if(r.isin&&/^[A-Z]{2}[A-Z0-9]{10}$/.test(r.isin)){
     // Not in the ViewInvAI catalogue yet (European, Asian… shares): keep it under its
     // ISIN so it counts in the portfolio, Fiscal and the curve, and picks up live data
     // as soon as the catalogue lists it.
     const key=keep.get(r.isin)||r.isin;
     uncatalogued.push(r);
     matched.push({externalId:r.externalId,side:r.side,quantity:r.quantity,price:r.price,fees:r.fees,currency:preferTr?'EUR':(r.currency||'EUR'),executedAt:r.executedAt,
      stockKey:key,preferTr,ticker:(r.symbol||r.isin).slice(0,20),name:r.name||r.isin,exchange:preferTr?'LSX':(r.exchange||''),isin:r.isin,
      notes:'Importado de '+(source==='tr'?'Trade Republic':source==='ibkr'?'Interactive Brokers':'CSV')+' · fuera del catálogo'+(r.benefit==='saveback'?' · Saveback':r.benefit==='roundup'?' · Redondeo':'')});
     continue;
    }
    unmatched.push(r);continue;
   }
   const isinOf=(preferTr?(s.trIsin||r.isin||s.isin):(s.isin||s.usIsin||r.isin))||'';
   const key=keep.get(String(isinOf).toUpperCase())||window.ViewInvAI.getStockKey(s);
   const currency=preferTr?'EUR':(r.currency||s.currency||'USD');
   const fees=r.feeCurrency&&r.feeCurrency!==currency?0:r.fees;
   matched.push({
    externalId:r.externalId,side:r.side,quantity:r.quantity,price:r.price,fees,currency,executedAt:r.executedAt,
    stockKey:key,preferTr,
    ticker:preferTr?(s.trTicker||s.ticker):(s.ticker||r.symbol),
    name:s.name||r.name||'',
    exchange:preferTr?(s.trExchange||'LSX'):(s.exchange||r.exchange||''),
    isin:preferTr?(s.trIsin||r.isin||s.isin||''):(s.isin||s.usIsin||r.isin||''),
    notes:'Importado de '+(source==='tr'?'Trade Republic':source==='ibkr'?'Interactive Brokers':'CSV')+(r.benefit==='saveback'?' · Saveback':r.benefit==='roundup'?' · Redondeo':'')
   });
  }
  matched.sort((a,b)=>Date.parse(a.executedAt)-Date.parse(b.executedAt)||(a.side==='BUY'?-1:1));
  funds.sort((a,b)=>Date.parse(a.executedAt)-Date.parse(b.executedAt)||(a.side==='BUY'?-1:1));
  return{matched,unmatched,funds,uncatalogued};
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
    '<div class="broker-import-grid"><label class="broker-import-field"><span>Token Flex</span><input data-ibkr-token type="password" autocomplete="off" inputmode="numeric" value="" placeholder="'+(saved.hasToken||saved.token?'Guardado cifrado · escribe otro para cambiarlo':'Token de Flex Web Service')+'"></label>'+
    '<label class="broker-import-field"><span>Query ID</span><input data-ibkr-query inputmode="numeric" value="'+esc(saved.queryId||'')+'" placeholder="123456"></label></div>'+
    portfolioSelect()+
    '<label class="broker-import-check"><input type="checkbox" data-ibkr-remember'+(saved.hasToken||saved.token?' checked':'')+'> Recordar cifrado en este dispositivo y sincronizar solo al abrir Carteras</label>'+
    '<button type="button" class="btn secondary broker-import-go" data-ibkr-fetch>Leer operaciones de IBKR</button>';
  }
  const tr=flow.source==='tr';
  return '<p class="broker-import-help">'+(tr
    ?'Trade Republic no ofrece API pública. Exporta tus <b>transacciones en CSV</b> desde Trade Republic (app o web) y súbelo aquí: se importan compras, ventas, planes de inversión, Saveback, Redondeo y <b>dividendos con su retención</b> (para Fiscal); intereses e ingresos se ignoran.'
    :'Sube el CSV de tu bróker. Se reconocen columnas de fecha, tipo (compra/venta), ISIN o símbolo, cantidad, precio o importe, comisión y divisa, en español, inglés o alemán.')+'</p>'+
   portfolioSelect()+
   '<label class="broker-import-file"><input type="file" accept=".csv,text/csv,text/plain" data-import-file><span>Elegir archivo CSV</span></label>';
 }
 function render(){
  const open=P().openModal;if(typeof open!=='function')return;
  // The funds catalogue is needed to recognise funds and ETFs in the file.
  try{window.ViewInvAIFunds&&window.ViewInvAIFunds.load&&window.ViewInvAIFunds.load()}catch(_){}
  open('Importar operaciones','<div class="broker-import">'+sourceTabs()+sourceBody()+
   '<p class="broker-import-note">Las acciones van a la cartera elegida y los fondos, ETF y ETC (con tus planes de ahorro) a tu cartera de fondos. Lo que hubieras apuntado a mano de esos mismos valores se sustituye por el historial del bróker, y reimportar el mismo archivo no duplica nada.</p>'+
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
  const funds=flow.funds||[],fundIsins=new Set(funds.map(f=>f.isin)),planIsins=new Set(funds.filter(f=>f.plan).map(f=>f.isin));
  const outside=(flow.uncatalogued||[]).length;
  // Values of the import already in the portfolio, typed by hand (would be counted twice).
  const overlap=manualOverlap(matched,flow.portfolioId).names;
  const total=matched.length+divs.length+funds.length;
  return '<div class="broker-import-preview"><div class="broker-import-counts"><span><b>'+matched.length+'</b> operaciones</span><span class="buy">'+buys+' compras</span><span class="sell">'+sells+' ventas</span>'+(funds.length?'<span>'+funds.length+' de fondos/ETF</span>':'')+(divs.length?'<span>'+divs.length+' dividendos</span>':'')+(unmatched.length?'<span class="warn">'+unmatched.length+' sin emparejar</span>':'')+'</div>'+divHtml+
   (funds.length?'<p class="broker-import-help">Fondos, ETF y ETC: <b>'+fundIsins.size+'</b> '+(fundIsins.size===1?'producto':'productos')+' ('+esc([...new Set(funds.map(f=>f.name))].slice(0,4).join(', '))+(fundIsins.size>4?'…':'')+') a tu cartera de fondos'+(planIsins.size?'; '+(planIsins.size===1?'<b>1 plan de ahorro</b> marcado por el bróker':'<b>'+planIsins.size+' planes de ahorro</b> marcados por el bróker'):'')+'. Los planes, el Saveback y el Redondeo que el archivo no marque te los preguntaré durante la importación (y recordaré tu respuesta); el importe del plan es el de su última ejecución.</p>':'')+
   (outside?'<p class="broker-import-help">'+outside+(outside===1?' operación':' operaciones')+' de valores que ViewInvAI aún no cotiza (acciones europeas, asiáticas…): se guardan con su ISIN y tendrán precio en cuanto el catálogo los incluya.</p>':'')+
   (overlap.length?'<p class="broker-import-warn">'+overlap.length+(overlap.length===1?' valor ya está apuntado a mano':' valores ya están apuntados a mano')+' ('+esc(overlap.slice(0,5).join(', '))+(overlap.length>5?'…':'')+'): al importar te preguntaré qué mantener; lo recomendado es el historial del bróker.</p>':'')+
   warn+(unmatched.length?'<p class="broker-import-warn">No están en el catálogo de ViewInvAI: '+esc([...new Set(unmatched.map(u=>u.symbol||u.isin||u.name))].slice(0,8).join(', '))+(unmatched.length>8?'…':'')+'.</p>':'')+
   '<ul class="broker-import-list">'+list+'</ul>'+
   '<label class="broker-import-check"><input type="checkbox" data-import-cash> Ajustar también el efectivo de la cartera</label>'+
   '<p class="broker-import-help">La importación sigue en segundo plano: puedes cerrar esta ventana y seguir usando la app; el progreso aparece arriba.</p>'+
   '<button type="button" class="btn secondary broker-import-go" data-import-commit'+(total?'':' disabled')+'>Importar '+(total?[matched.length?matched.length+(matched.length===1?' operación':' operaciones'):'',funds.length?funds.length+' de fondos':'',divs.length?divs.length+(divs.length===1?' dividendo':' dividendos'):''].filter(Boolean).join(' · '):'0 operaciones')+'</button></div>';
 }
 function showPreview(rows,source,extra=''){
  const {matched,unmatched,funds,uncatalogued}=matchRows(rows,source);
  flow.matched=matched;flow.unmatched=unmatched;flow.funds=funds;flow.uncatalogued=uncatalogued;flow.dividends=enrichDividends(flow.dividends);
  const sb=rows.filter(r=>r.benefit==='saveback'),ru=rows.filter(r=>r.benefit==='roundup');
  const sum=a=>a.reduce((t,r)=>t+(r.cash||0),0).toLocaleString('es-ES',{style:'currency',currency:'EUR'});
  const benefitHtml=sb.length||ru.length?'<p class="broker-import-help">'+[sb.length?'<b>Saveback</b>: '+sb.length+(sb.length===1?' compra':' compras')+' ('+sum(sb)+')':'',ru.length?'<b>Redondeo</b>: '+ru.length+(ru.length===1?' compra':' compras')+' ('+sum(ru)+')':''].filter(Boolean).join(' · ')+'. Se importan como compras normales, marcadas, y no cuentan como plan de ahorro.</p>':'';
  status(extra+benefitHtml+previewHtml());
 }
 // Values of the import the portfolio already holds as manual entries (counted twice
 // if both were kept): manual buys, the initial position, manual adjustments.
 function manualOverlap(rows,portfolioId){
  const have=typeof P().getPositionsDetail==='function'?P().getPositionsDetail(portfolioId||null):[];
  const refs=new Set();rows.forEach(r=>{refs.add(r.stockKey);if(r.isin)refs.add(r.isin)});
  const hits=have.filter(h=>(refs.has(h.stockKey)||(h.isin&&refs.has(h.isin)))&&!/^(trade republic|interactive brokers)$/i.test(String(h.broker||'').trim()));
  const keys=new Set();hits.forEach(h=>{keys.add(h.stockKey);if(h.isin)keys.add(h.isin)});
  return{names:[...new Set(hits.map(h=>h.ticker||h.stockKey))],keys};
 }
 async function post(path,body){
  const res=await window.ViewInvAIAuth.apiFetch(path,{method:'POST',body:JSON.stringify(body)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||'El servidor no respondió ('+res.status+').');
  return data;
 }
 /* ---------- planes, Saveback y Redondeo: lo que no está claro se pregunta ----------
  * Un plan es una compra cada mes en torno al mismo día (o el siguiente hábil); su importe
  * puede cambiar cuando lo subes o bajas, así que el importe vigente es el de la última
  * ejecución. Saveback y Redondeo son compras pequeñas de importe variable. Si el CSV no lo
  * dice expresamente, se pregunta durante la importación y la respuesta se recuerda. */
 const CHOICES_KEY='viewinvai:import-fund-choices';
 function readChoices(){try{return JSON.parse(localStorage.getItem(CHOICES_KEY)||'{}')||{}}catch(_){return{}}}
 function saveChoice(k,v){const c=readChoices();c[k]=v;try{localStorage.setItem(CHOICES_KEY,JSON.stringify(c))}catch(_){}}
 const cashOf=f=>Number(f.cash)>0?Number(f.cash):(Number(f.units)||0)*(Number(f.price)||0)+(Number(f.fees)||0);
 const dom=f=>new Date(f.executedAt).getUTCDate();
 const monthIdx=f=>{const d=new Date(f.executedAt);return d.getUTCFullYear()*12+d.getUTCMonth()};
 const eur=v=>v.toLocaleString('es-ES',{style:'currency',currency:'EUR'});
 const shortDate=f=>new Date(f.executedAt).toLocaleDateString('es-ES',{day:'numeric',month:'short',timeZone:'UTC'});
 // La serie mensual más larga que llega hasta el final: una compra por mes, en una ventana de 5 días.
 function monthlySeries(buys){
  let best=null;
  for(const d0 of new Set(buys.map(dom))){
   const byMonth=new Map();
   for(const b of buys){const d=dom(b);if(d<d0||d>d0+4)continue;const m=monthIdx(b),cur=byMonth.get(m);if(!cur||cashOf(b)>cashOf(cur))byMonth.set(m,b)}
   const months=[...byMonth.keys()].sort((a,b)=>a-b);if(!months.length)continue;
   let run=[byMonth.get(months[months.length-1])];
   for(let i=months.length-2;i>=0&&months[i]===months[i+1]-1;i--)run.unshift(byMonth.get(months[i]));
   if(!best||run.length>best.list.length||(run.length===best.list.length&&cashOf(run[run.length-1])>cashOf(best.list[best.list.length-1])))best={list:run,day:d0};
  }
  return best;
 }
 function planFrom(isin,list,day,currency){
  const last=list[list.length-1];
  const gaps=[];for(let i=1;i<list.length;i++)gaps.push((Date.parse(list[i].executedAt)-Date.parse(list[i-1].executedAt))/864e5);
  const g=gaps.length?gaps.slice().sort((a,b)=>a-b)[gaps.length>>1]:30;
  return{isin,amount:Math.round(cashOf(last)*100)/100,currency:currency||last.currency||'EUR',dayOfMonth:day||dom(last),frequency:g<10?'weekly':g>70&&g<120?'quarterly':'monthly',count:list.length,lastAt:last.executedAt};
 }
 async function reviewFunds(funds,task){
  const plans=[],noPlans=[],choices=readChoices(),now=Date.now();
  const byIsin=new Map();
  for(const f of funds){if(f.side!=='BUY'||!f.isin)continue;(byIsin.get(f.isin)||byIsin.set(f.isin,[]).get(f.isin)).push(f)}
  // Compras pequeñas: Saveback, Redondeo o compras normales (se recuerda la respuesta).
  async function askSmall(isin,name,list,guess){
   const key='small:'+isin+':'+(guess||'none');let ans=choices[key];
   if(!ans){
    const total=list.reduce((t,f)=>t+cashOf(f),0),amounts=list.map(cashOf);
    const opts=[{id:'saveback',label:'Saveback'},{id:'roundup',label:'Redondeo'},{id:'buy',label:'Compras normales'}];
    if(guess)opts.sort((x,y)=>(y.id===guess)-(x.id===guess));
    ans=await task.ask('¿Qué son estas '+list.length+' compras pequeñas de '+name+'?',opts,
     {detail:'De '+eur(Math.min(...amounts))+' a '+eur(Math.max(...amounts))+' (total '+eur(total)+'), del '+shortDate(list[0])+' al '+shortDate(list[list.length-1])+'.'+(guess?' Por el patrón parecen '+(guess==='saveback'?'Saveback':'Redondeo')+'.':'')+' Saveback y Redondeo se suman aparte y no cuentan como plan.'});
    saveChoice(key,ans);
   }
   list.forEach(f=>{f.benefit=ans==='saveback'||ans==='roundup'?ans:'';f.benefitGuess=false});
  }
  for(const [isin,all] of byIsin){
   all.sort((a,b)=>Date.parse(a.executedAt)-Date.parse(b.executedAt));
   const name=all[all.length-1].name||isin;
   // 1. Lo que parece Saveback o Redondeo por su patrón (sin abono en el CSV) se confirma primero.
   for(const g of ['saveback','roundup']){
    const list=all.filter(f=>f.benefitGuess&&f.benefit===g&&!f.plan);
    if(list.length)await askSmall(isin,name,list,g);
   }
   // 2. Plan: el bróker lo marca, o se ve una compra cada mes el mismo día (importe libre).
   const flagged=all.filter(f=>f.plan&&!f.benefit);
   let planList=null,planDay=0;
   if(flagged.length){planList=flagged;planDay=(monthlySeries(flagged)||{}).day||dom(flagged[flagged.length-1])}
   else{
    const s=monthlySeries(all.filter(f=>!f.benefit));
    if(s&&s.list.length>=2&&now-Date.parse(s.list[s.list.length-1].executedAt)<62*864e5){
     const key='plan:'+isin+':'+s.day;let ans=choices[key];
     if(!ans){
      const hist=s.list.slice(-4).reverse().map(f=>eur(cashOf(f))+' ('+shortDate(f)+')').join(', ');
      ans=await task.ask('¿'+name+' tiene un plan de inversión de '+eur(cashOf(s.list[s.list.length-1]))+' al mes, en torno al día '+s.day+'?',
       [{id:'yes',label:'Sí, es un plan'},{id:'no',label:'No, son compras sueltas'}],
       {detail:'He visto una compra cada mes: '+hist+'. Si es un plan, cuenta el último importe y se actualiza solo cuando lo cambies.'});
      saveChoice(key,ans);
     }
     if(ans==='yes'){planList=s.list;planDay=s.day}else noPlans.push(isin);
    }
   }
   if(planList){
    planList.forEach(f=>{f.plan=true;f.benefit='';f.benefitGuess=false});
    if(now-Date.parse(planList[planList.length-1].executedAt)<62*864e5)plans.push(planFrom(isin,planList,planDay,all[0].currency));
   }
   // 3. Otras compras pequeñas sin explicar (al menos 2): se pregunta qué son.
   const rest=all.filter(f=>!f.plan&&!f.benefit&&cashOf(f)<=35);
   if(rest.length>=2)await askSmall(isin,name,rest,'');
  }
  if(plans.length)task.log(plans.map(p=>'Plan '+(byIsin.get(p.isin).slice(-1)[0].name||p.isin)+': '+eur(p.amount)+'/mes, día '+p.dayOfMonth).join(' · '));
  return{plans,noPlans};
 }
 // The import runs in the background (ViewInvAITasks): the window closes at once and
 // the floating task pill shows progress, errors and the duplicate question.
 async function commit(){
  const job={portfolioId:flow.portfolioId,source:flow.source,rows:(flow.matched||[]).slice(),divs:(flow.dividends||[]).slice(),funds:(flow.funds||[]).slice(),
   adjustCash:!!document.querySelector('[data-import-cash]')?.checked};
  if(!job.portfolioId||!(job.rows.length||job.divs.length||job.funds.length))return;
  if(typeof P().closeModal==='function')P().closeModal();
  const broker=job.source==='ibkr'?'Interactive Brokers':job.source==='tr'?'Trade Republic':'';
  const T=window.ViewInvAITasks;
  const task=T?T.start('Importar '+(broker||'CSV')):{progress(){},log(){},ask:async(t,o)=>o[0].id,done(){},fail(){}};
  const total=job.rows.length+job.funds.length+job.divs.length;let doneCount=0;
  const step=(n,label)=>{doneCount+=n;task.progress(Math.min(doneCount,total),total,label)};
  let imported=0,skipped=0,retired=0,fundImported=0,fundSkipped=0,plans=0,divImported=0,divSkipped=0,errors=0;
  const logErrors=list=>(list||[]).forEach(e=>{errors++;task.log((e.ticker||e.externalId||'')+' · '+e.error,'error')});
  try{
   // Imported data prevails by default; the user can keep the manual entries instead.
   let replaceManual=true;
   const overlap=manualOverlap(job.rows,job.portfolioId);
   if(overlap.names.length){
    const choice=await task.ask(overlap.names.length+(overlap.names.length===1?' valor ya estaba apuntado a mano':' valores ya estaban apuntados a mano')+'. ¿Qué mantengo?',
     [{id:'broker',label:'Lo importado del bróker'},{id:'manual',label:'Lo que apunté a mano'}],
     {detail:overlap.names.slice(0,8).join(', ')+(overlap.names.length>8?'…':''),remember:'import-duplicates'});
    if(choice==='manual'){
     replaceManual=false;
     const before=job.rows.length;
     job.rows=job.rows.filter(r=>!overlap.keys.has(r.stockKey)&&!(r.isin&&overlap.keys.has(r.isin)));
     step(before-job.rows.length,'Operaciones');
     task.log((before-job.rows.length)+' operaciones de esos valores no se importan: se mantiene lo apuntado a mano.');
    }
   }
   for(let i=0;i<job.rows.length;i+=CHUNK){
    const chunk=job.rows.slice(i,i+CHUNK);
    const data=await post('/api/transactions/import',{portfolioId:job.portfolioId,source:job.source,broker,adjustCash:job.adjustCash,replaceManual,rows:chunk});
    imported+=data.imported||0;skipped+=data.skipped||0;retired+=(data.retired&&data.retired.removed)||0;logErrors(data.errors);
    step(chunk.length,'Operaciones');
   }
   const review=job.funds.length?await reviewFunds(job.funds,task):{plans:[],noPlans:[]};
   for(let i=0;i<job.funds.length;i+=CHUNK){
    const chunk=job.funds.slice(i,i+CHUNK),last=i+CHUNK>=job.funds.length;
    const data=await post('/api/fund-transactions/import',{source:job.source,platform:broker,replaceManual,rows:chunk,plans:last?review.plans:undefined,noPlans:last?review.noPlans:undefined});
    fundImported+=data.imported||0;fundSkipped+=data.skipped||0;plans+=data.plans||0;logErrors(data.errors);
    step(chunk.length,'Fondos y ETF');
   }
   for(let i=0;i<job.divs.length;i+=200){
    const chunk=job.divs.slice(i,i+200);
    const data=await post('/api/dividends/import',{portfolioId:job.portfolioId,source:job.source,broker,rows:chunk});
    divImported+=data.imported||0;divSkipped+=data.skipped||0;logErrors(data.errors);
    step(chunk.length,'Dividendos');
   }
   const parts=[imported+(imported===1?' operación':' operaciones')];
   if(job.funds.length)parts.push(fundImported+' de fondos');
   if(job.divs.length)parts.push(divImported+' dividendos');
   if(skipped+fundSkipped+divSkipped)task.log((skipped+fundSkipped+divSkipped)+' ya estaban importados.');
   if(retired)task.log(retired+' apuntes manuales sustituidos por el historial del bróker.');
   if(plans)task.log(plans+(plans===1?' plan de ahorro creado':' planes de ahorro creados')+' en tu cartera de fondos.');
   task.done('Importación terminada: '+parts.join(' · ')+(errors?' · '+errors+' con error':''));
   if(typeof P().reload==='function')await P().reload();
   if(window.ViewInvAITax)window.ViewInvAITax._invalidate();
   if(job.funds.length&&window.ViewInvAIFunds&&typeof window.ViewInvAIFunds.loadPortfolio==='function'){try{await window.ViewInvAIFunds.loadPortfolio(true)}catch(_){}}
   if(job.source==='ibkr'){const saved=readIbkr();if(saved){saved.lastSyncAt=Date.now();saved.portfolioId=job.portfolioId;writeIbkr(saved)}}
  }catch(e){task.fail('Importación detenida: '+(e.message||'error')+(doneCount?' ('+doneCount+' de '+total+' procesadas; vuelve a importar el archivo para completar, no se duplica nada)':''))}
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
  if(t.closest&&t.closest('[data-import-commit]')){commit();return}
  const go=t.closest&&t.closest('[data-ibkr-fetch]');
  if(go){
   const typed=(document.querySelector('[data-ibkr-token]')?.value||'').trim(),queryId=(document.querySelector('[data-ibkr-query]')?.value||'').trim();
   const token=typed||await ibkrToken();
   if(!token||!queryId){status('Indica el token y el Query ID.',true);return}
   if(document.querySelector('[data-ibkr-remember]')?.checked){try{await rememberIbkr(typed,{queryId,portfolioId:flow.portfolioId})}catch(err){status(esc(err.message),true)}}else await forgetIbkr();
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
  if(!saved||!(saved.token||saved.hasToken)||!saved.queryId||!saved.portfolioId)return;
  if(Date.now()-(saved.lastSyncAt||0)<6*3600e3)return;
  if(!window.ViewInvAIAuth||typeof window.ViewInvAIAuth.getUser!=='function'||!window.ViewInvAIAuth.getUser())return;
  saved.lastSyncAt=Date.now();
  const token=await ibkrToken();if(!token)return;
  writeIbkr({...readIbkr(),lastSyncAt:saved.lastSyncAt});
  try{
   const data=await fetchIbkr({token,queryId:saved.queryId});
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
  _parseCsv:rowsFromCsv,_match:matchRows,_reviewFunds:reviewFunds
 };
})();
