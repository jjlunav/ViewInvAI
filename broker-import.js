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
  const map=mapHeader(table[hi]),out=[],skipped={},dividends=[],benefits=[],cards=[];
  // Trade Republic exporta todos los movimientos de la cuenta (ingresos, tarjeta, intereses,
  // compras, ventas…): su suma es el efectivo. Si la cifra de la fila ya es el precio × acciones,
  // la comisión y el impuesto van aparte y se descuentan.
  const ledger={eur:0,rows:0,first:'',last:''};
  for(const r of table.slice(hi+1)){
   const get=k=>map[k]===undefined?'':r[map[k]];
   if(source==='tr'&&map.amount!==undefined){
    const a=num(get('amount')),cur=String(get('currency')||'EUR').trim().toUpperCase()||'EUR',d=dateIso(get('date'));
    if(a!==null&&cur==='EUR'){
     const q=Math.abs(num(get('qty'))||0),pr=Math.abs(num(get('price'))||0),gross=q*pr,extra=Math.abs(num(get('fee'))||0)+Math.abs(num(get('tax'))||0);
     ledger.eur+=a-(extra&&gross>0&&Math.abs(Math.abs(a)-gross)<=Math.max(0.02,gross*0.001)?extra:0);
     ledger.rows++;
     if(d){if(!ledger.first||d<ledger.first)ledger.first=d;if(!ledger.last||d>ledger.last)ledger.last=d}
    }
   }
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
   if(!side){
    const t=String(get('side')||'otro').trim()||'otro';skipped[t]=(skipped[t]||0)+1;
    // Pagos con tarjeta: de ellos salen el Redondeo (céntimos hasta el euro) y el Saveback (1 %).
    if(/card[_ ]?transaction|card payment|kartenzahlung|pago con tarjeta/i.test(rawKind)){const a=num(get('amount')),d=dateIso(get('date'));if(a!==null&&a<0&&d)cards.push({date:d,spend:Math.abs(a)})}
    continue;
   }
   const qty=Math.abs(num(get('qty'))||0);if(!qty)continue;
   let price=num(get('price'));const amount=num(get('amount')),fee=Math.abs(num(get('fee'))||0);
   if((price===null||price<=0)&&amount!==null)price=Math.max(0,(Math.abs(amount)-(side==='BUY'?fee:-fee)))/qty;
   if(price===null)continue;
   const executedAt=dateIso(get('date'));if(!executedAt)continue;
   const {isin,symbol}=idOf(get('isin'),get('symbol'));
   const ext=String(get('id')||'').trim();
   // Tipo + descripción, sin el nombre del valor (si no, «Planet Labs» parece un «plan»).
   const instName=String(get('name')||'').trim();
   let descTxt=String(map.desc!==undefined&&map.desc!==map.name?get('desc'):'');
   if(instName)descTxt=descTxt.split(instName).join(' ');
   const rawType=String(get('side')||'')+' '+descTxt;
   const cashAbs=amount!==null?Math.abs(amount):qty*Math.abs(price);
   // Saveback y Redondeo de Trade Republic no pasan de unos 15 € por compra.
   const benefit=cashAbs>16?'':/\bsaveback\b/i.test(rawType)?'saveback':/\bspare|\bround ?up\b|\bredondeo\b/i.test(rawType)?'roundup':'';
   out.push({
    benefit,cash:amount!==null?Math.abs(amount):qty*Math.abs(price)+(side==='BUY'?fee:0),
    plan:!benefit&&/\b(?:savings ?plan|sparplan|plan de inversi[oó]n|plan de ahorro|plan execution|plan)\b/i.test(rawType),
    externalId:source+':'+(ext||hash([executedAt,isin||symbol,side,qty,price,amount].join('|'))),
    side,quantity:qty,price:Math.abs(price),fees:fee,currency:String(get('currency')||'').trim().toUpperCase()||(source==='tr'?'EUR':''),
    isin,symbol,name:String(get('name')||'').trim(),executedAt
   });
  }
  tagBenefits(out,benefits);
  cardBenefits(out,cards);
  ledger.eur=Math.round(ledger.eur*100)/100;
  return{rows:out,skipped,dividends,benefits,cards,ledger:source==='tr'&&ledger.rows?ledger:null};
 }
 /* Saveback y Redondeo calculados con los pagos con tarjeta del propio CSV (Trade Republic):
  * · Saveback: el 1 % de lo gastado con tarjeta en un mes (tope 15 €), invertido hacia el día 2
  *   del mes siguiente. Se busca la compra de esos días que cuadra con ese importe.
  * · Redondeo: cada pago se redondea al euro siguiente (con multiplicador ×1…×10). Las compras
  *   semanales pequeñas de un mismo fondo cuyo total cuadra con esos redondeos son el Redondeo.
  * Lo que cuadra queda marcado como seguro y no se pregunta. */
 function cardBenefits(rows,cards){
  if(!cards||cards.length<5)return;
  const buys=rows.filter(r=>r.side==='BUY'&&!(r.benefit&&!r.benefitGuess)&&(r.cash||0)>0&&(r.cash||0)<=31);
  const t=d=>Date.parse(d),dayOf=d=>new Date(d).getUTCDate();
  // Saveback por meses.
  const spendByMonth=new Map();
  for(const c of cards){const d=new Date(c.date),k=d.getUTCFullYear()*12+d.getUTCMonth();spendByMonth.set(k,(spendByMonth.get(k)||0)+c.spend)}
  for(const [k,spend] of spendByMonth){
   const expected=Math.min(15,Math.round(spend)/100);if(!(expected>=0.1))continue;
   const y=Math.floor((k+1)/12),m=(k+1)%12;
   let best=null,bestErr=Infinity;
   for(const r of buys){
    if(r.benefit&&!r.benefitGuess)continue;
    const d=new Date(r.executedAt);if(d.getUTCFullYear()!==y||d.getUTCMonth()!==m||d.getUTCDate()>8)continue;
    const err=Math.abs(r.cash-expected);
    // A igualdad, mejor una cantidad con céntimos: una redonda del mismo día suele ser un plan.
    const score=err+(Math.abs(r.cash-Math.round(r.cash))<0.005?0.03:0);
    if(err<=Math.max(0.06,expected*0.04)&&score<bestErr){best=r;bestErr=score}
   }
   if(best){best.benefit='saveback';best.benefitGuess=false;best.plan=false;best.benefitSrc='card'}
  }
  // Redondeo por fondo: total de compras pequeñas semanales frente al total de redondeos del periodo.
  const ru=c=>{const f=Math.ceil(c.spend-1e-9)-c.spend;return f>1e-9?f:0};
  const byIsin=new Map();
  for(const r of buys){if(r.benefit&&!r.benefitGuess)continue;(byIsin.get(r.isin||r.symbol)||byIsin.set(r.isin||r.symbol,[]).get(r.isin||r.symbol)).push(r)}
  for(const list of byIsin.values()){
   if(list.length<3)continue;
   list.sort((a,b)=>t(a.executedAt)-t(b.executedAt));
   const gaps=[];for(let i=1;i<list.length;i++)gaps.push((t(list[i].executedAt)-t(list[i-1].executedAt))/864e5);
   const g=gaps.slice().sort((a,b)=>a-b)[gaps.length>>1];
   if(!(g>=5&&g<=10))continue;
   const from=t(list[0].executedAt)-8*864e5,to=t(list[list.length-1].executedAt);
   const total=list.reduce((s,r)=>s+r.cash,0),rounds=cards.filter(c=>t(c.date)>from&&t(c.date)<=to).reduce((s,c)=>s+ru(c),0);
   if(!(rounds>0))continue;
   const k=Math.round(total/rounds);
   if(k>=1&&k<=10&&Math.abs(total-k*rounds)<=Math.max(1,total*0.12))list.forEach(r=>{r.benefit='roundup';r.benefitGuess=false;r.plan=false;r.benefitSrc='card'});
  }
 }
 // Empareja cada abono de Saveback/Redondeo con la compra del mismo importe (ese día o hasta 7 después).
 function tagBenefits(rows,benefits){
  for(const b of benefits){
   const t0=Date.parse(b.date);let best=null,bestGap=Infinity;
   for(const r of rows){
    if(r.side!=='BUY'||r.benefit||b.amount>16||Math.abs((r.cash||0)-b.amount)>0.011)continue;
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
    if(f){funds.push({externalId:r.externalId,isin:f.isin,name:f.name,productType:f.type,provider:f.provider,indexName:f.index,side:r.side,units:r.quantity,price:r.price,fees:r.fees,currency:r.currency||'EUR',executedAt:r.executedAt,plan:!!r.plan,benefit:r.benefit||'',benefitGuess:!!r.benefitGuess,benefitSrc:r.benefitSrc||'',cash:r.cash});continue}
    if(r.isin&&/^[A-Z]{2}[A-Z0-9]{10}$/.test(r.isin)){
     // Not in the ViewInvAI catalogue yet (European, Asian… shares): keep it under its
     // ISIN so it counts in the portfolio, Fiscal and the curve, and picks up live data
     // as soon as the catalogue lists it.
     const key=keep.get(r.isin)||r.isin;
     uncatalogued.push(r);
     matched.push({externalId:r.externalId,side:r.side,quantity:r.quantity,price:r.price,fees:r.fees,currency:preferTr?'EUR':(r.currency||'EUR'),executedAt:r.executedAt,
      plan:!!r.plan,benefit:r.benefit||'',benefitGuess:!!r.benefitGuess,benefitSrc:r.benefitSrc||'',cash:r.cash,baseNotes:'Importado de '+(source==='tr'?'Trade Republic':source==='ibkr'?'Interactive Brokers':'CSV')+' · fuera del catálogo',
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
    plan:!!r.plan,benefit:r.benefit||'',benefitGuess:!!r.benefitGuess,benefitSrc:r.benefitSrc||'',cash:r.cash,baseNotes:'Importado de '+(source==='tr'?'Trade Republic':source==='ibkr'?'Interactive Brokers':'CSV'),
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
   (funds.length?'<p class="broker-import-help">Fondos, ETF y ETC: <b>'+fundIsins.size+'</b> '+(fundIsins.size===1?'producto':'productos')+' ('+esc([...new Set(funds.map(f=>f.name))].slice(0,4).join(', '))+(fundIsins.size>4?'…':'')+') a tu cartera de fondos'+'.</p>':'')+
   (outside?'<p class="broker-import-help">'+outside+(outside===1?' operación':' operaciones')+' de valores que ViewInvAI aún no cotiza (acciones europeas, asiáticas…): se guardan con su ISIN y tendrán precio en cuanto el catálogo los incluya.</p>':'')+
   (overlap.length?'<p class="broker-import-warn">'+overlap.length+(overlap.length===1?' valor ya está apuntado a mano':' valores ya están apuntados a mano')+' ('+esc(overlap.slice(0,5).join(', '))+(overlap.length>5?'…':'')+'): al importar te preguntaré qué mantener; lo recomendado es el historial del bróker.</p>':'')+
   warn+(unmatched.length?'<p class="broker-import-warn">No están en el catálogo de ViewInvAI: '+esc([...new Set(unmatched.map(u=>u.symbol||u.isin||u.name))].slice(0,8).join(', '))+(unmatched.length>8?'…':'')+'.</p>':'')+
   (list?'<details class="import-wizard-ops"><summary>Ver las últimas operaciones ('+Math.min(40,matched.length)+')</summary><ul class="broker-import-list">'+list+'</ul></details>':'')+'</div>';
 }
 /* ---------- asistente a pantalla completa: analizar → preguntas una a una → resumen ----------
  * Al elegir el archivo se cierra la ventana de importar y aparece «Analizando tu archivo» con su
  * barra. Después, si hay dudas, una pregunta por pantalla (Atrás / Siguiente) y al final un
  * resumen con «Finalizar e importar». La importación sigue en segundo plano como antes. */
 const KIND_DESC={
  plan:'Una compra automática cada cierto tiempo (DCA). Se crea el plan en tu cartera de fondos con su importe actual.',
  saveback:'El 1 % de tus pagos con tarjeta que Trade Republic invierte por ti. Se suma aparte y no cuenta como plan.',
  roundup:'El redondeo de tus pagos con tarjeta que se invierte. Se suma aparte y no cuenta como plan.',
  buy:'Compras que hiciste tú cuando quisiste. No se crea ningún plan.'
 };
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 let wiz=null,wizEl=null;
 function brokerName(){return flow.source==='ibkr'?'Interactive Brokers':flow.source==='tr'?'Trade Republic':'CSV'}
 function wizardEl(){
  if(wizEl&&wizEl.isConnected)return wizEl;
  wizEl=document.createElement('div');
  wizEl.id='importWizard';wizEl.className='import-wizard';wizEl.hidden=true;
  wizEl.setAttribute('role','dialog');wizEl.setAttribute('aria-modal','true');wizEl.setAttribute('aria-labelledby','importWizardTitle');
  wizEl.innerHTML='<div class="import-wizard-card"><header class="import-wizard-head"><div><small data-wiz-kicker></small><b id="importWizardTitle" tabindex="-1" data-wiz-title></b></div>'+
   '<button type="button" class="import-wizard-x" data-wiz-close aria-label="Cerrar">×</button></header>'+
   '<div class="import-wizard-bar" aria-hidden="true"><i></i></div><div class="import-wizard-body" data-wiz-body></div><div class="import-wizard-foot" data-wiz-foot></div></div>';
  wizEl.addEventListener('click',onWizardClick);
  wizEl.addEventListener('input',e=>{const t=e.target;if(t.matches('[data-plan-amount]')){onPlanInput(t);return}if(t.matches('[data-wiz-amount]')){const g=currentGroup(),v=Number(String(t.value).replace(',','.'));if(g&&v>0)g.amount=Math.round(v*100)/100}});
  wizEl.addEventListener('change',e=>{const t=e.target;
   if(t.matches('[data-plan-freq],[data-plan-on]')){onPlanInput(t);return}
   if(t.matches('[data-wiz-freq]')){const g=currentGroup();if(g){g.frequency=t.value;g.active=isActive(g);paintStep()}}
   if(t.matches('[data-wiz-cash]'))flow.adjustCash=t.checked;
   if(t.matches('[data-wiz-cash-value]')){const v=Number(String(t.value).replace(',','.'));flow.cashSet=t.value!==''&&v>=0?Math.round(v*100)/100:null;if(flow.cashSet!==null)flow.adjustCash=true;const c=wizEl.querySelector('[data-wiz-cash]');if(c)c.checked=flow.adjustCash}
  });
  document.body.appendChild(wizEl);
  return wizEl;
 }
 function wizardShow(){wizardEl().hidden=false;document.documentElement.classList.add('import-wizard-open')}
 function wizardClose(){if(wizEl)wizEl.hidden=true;document.documentElement.classList.remove('import-wizard-open');wiz=null}
 function paint({kicker,title,pct,body,foot}){
  const el=wizardEl();
  el.querySelector('[data-wiz-kicker]').textContent=kicker||'';
  const t=el.querySelector('[data-wiz-title]');t.textContent=title||'';
  el.querySelector('.import-wizard-bar i').style.setProperty('width',Math.max(0,Math.min(100,pct||0))+'%');
  const b=el.querySelector('[data-wiz-body]');b.innerHTML=body||'';b.scrollTop=0;
  el.querySelector('[data-wiz-foot]').innerHTML=foot||'';
 }
 function paintAnalyze(pct,label){
  paint({kicker:'Importar '+brokerName(),title:'Analizando tu archivo',pct,
   body:'<div class="import-wizard-analyze"><img class="brand-logo-dark" src="favicon.svg" alt="" width="72" height="72"><img class="brand-logo-light" src="favicon-light.svg" alt="" width="72" height="72">'+
    '<p>'+esc(label)+'</p><b>'+Math.round(pct)+' %</b><small>Leo tus operaciones, reconozco cada valor y busco tus planes automáticos, el Saveback y el Redondeo.</small></div>'});
 }
 // Lee y analiza (load devuelve las filas ya extraídas del archivo o de IBKR).
 async function runAnalysis(load){
  if(typeof P().closeModal==='function')P().closeModal();
  wiz={mode:'analyze'};wizardShow();
  try{
   paintAnalyze(6,'Leyendo el archivo…');await pause(250);
   const data=await load();
   paintAnalyze(30,'Reconociendo '+data.rows.length+(data.rows.length===1?' operación…':' operaciones…'));await pause(350);
   const m=matchRows(data.rows,flow.source);
   flow.matched=m.matched;flow.unmatched=m.unmatched;flow.funds=m.funds;flow.uncatalogued=m.uncatalogued;
   flow.dividends=enrichDividends(flow.dividends);flow.extra=data.extra||'';flow.adjustCash=true;
   flow.cashSet=flow.cashLedger&&flow.cashLedger.eur>=0?flow.cashLedger.eur:null;
   paintAnalyze(65,'Buscando planes, Saveback y Redondeo…');await pause(350);
   flow.planCands=buildPlanCandidates(m.matched,m.funds);
   paintAnalyze(100,'Análisis terminado');await pause(300);
   // Primero los planes (los defines tú, con lo detectado ya rellenado); después las dudas y el resumen.
   wiz={mode:'steps',steps:['plans','summary'],i:0,questions:0};
   paintStep();
  }catch(err){
   paint({kicker:'Importar '+brokerName(),title:'No se pudo analizar',pct:0,
    body:'<div class="import-wizard-analyze failed"><p>'+esc(err&&err.message||'No se pudo leer el archivo.')+'</p><small>Comprueba que es la exportación de transacciones en CSV y vuelve a intentarlo.</small></div>',
    foot:'<button type="button" class="btn ghost" data-wiz-close>✕ Cerrar</button><button type="button" class="btn secondary" data-wiz-retry>Elegir otro archivo</button>'});
  }
 }
 function currentGroup(){
  if(!wiz||wiz.mode!=='steps')return null;
  const id=wiz.steps[wiz.i];return((flow.review&&flow.review.groups)||[]).find(g=>g.id===id)||null;
 }
 function paintStep(){
  if(!wiz||wiz.mode!=='steps')return;
  if(wiz.steps[wiz.i]==='plans'){paintPlans();return}
  if(wiz.steps[wiz.i]==='summary'){paintSummary();return}
  const g=currentGroup();if(!g)return;
  const n=wiz.questions,first=g.rows[0],last=g.rows[g.rows.length-1],amounts=g.rows.map(cashOf),total=amounts.reduce((t,v)=>t+v,0);
  const recent=g.rows.slice(-6).reverse().map(r=>'<li><span>'+esc(shortDate(r))+'</span><b>'+eur(cashOf(r),g.currency)+'</b></li>').join('');
  const plan=g.answered&&g.kind==='plan'?'<div class="import-wizard-plan">'+
   '<label><span>Importe actual</span><input type="number" inputmode="decimal" min="0" step="0.01" data-wiz-amount value="'+g.amount+'"></label>'+
   '<label><span>Periodicidad</span><select data-wiz-freq>'+Object.entries(FREQ_LABEL).map(([k,l])=>'<option value="'+k+'"'+(g.frequency===k?' selected':'')+'>'+l+'</option>').join('')+'</select></label>'+
   '<p>'+(g.active?'<em class="ok">Plan activo</em> · última compra el '+esc(shortDate(last)):'<em class="off">Plan terminado</em> · última compra el '+esc(shortDate(last))+'. No se crea el plan; solo se etiquetan sus compras.')+
   (g.isFund?'':' Es una acción: sus compras se etiquetan como plan (los planes de ViewInvAI viven en Fondos).')+'</p></div>':'';
  const opts=['plan','saveback','roundup','buy'].map(k=>{
   const on=g.answered&&g.kind===k;
   return '<button type="button" class="import-wizard-opt'+(on?' on':'')+'" role="radio" aria-checked="'+on+'" data-wiz-opt="'+k+'"><span><b>'+KIND_LABEL[k]+'</b>'+(g.suggested===k?'<em>Sugerido</em>':'')+'</span><small>'+KIND_DESC[k]+'</small></button>'+(k==='plan'?plan:'');
  }).join('');
  paint({kicker:'Pregunta '+wiz.i+' de '+n,title:'Tus aportaciones',pct:wiz.i/(n+1)*100,
   body:'<div class="import-wizard-q"><h3>'+esc(g.name)+'</h3>'+
    '<p class="import-wizard-meta">'+g.rows.length+(g.rows.length===1?' compra':' compras')+' · '+esc(shortDate(first))+(g.rows.length>1?' → '+esc(shortDate(last)):'')+(g.kind==='saveback'||g.kind==='roundup'||g.suggested==='saveback'||g.suggested==='roundup'?'':' · total '+eur(total,g.currency))+'</p>'+
    '<p class="import-wizard-why">'+esc(g.why)+'</p>'+
    '<ul class="import-wizard-recent" aria-label="Últimas compras">'+recent+'</ul>'+
    '<p class="import-wizard-ask">¿Qué son estas compras?</p><div class="import-wizard-opts" role="radiogroup" aria-label="Tipo de aportación">'+opts+'</div>'+plan+'</div>',
   foot:'<button type="button" class="btn ghost" data-wiz-back>‹ Atrás</button>'+
    '<button type="button" class="btn secondary" data-wiz-next'+(g.answered?'':' disabled')+'>'+(wiz.i===n?'Ver resumen':'Siguiente')+'</button>'});
 }
 function paintSummary(){
  // Todo lo detectado se puede cambiar; las compras sueltas seguras van plegadas para no llenar la pantalla.
  const all=(flow.review&&flow.review.groups)||[];
  const isLoose=g=>g.kind==='buy'&&g.suggested==='buy'&&g.confidence==='sure';
  const groups=all.filter(g=>!isLoose(g)),loose=all.filter(isLoose);
  const label=g=>KIND_LABEL[g.kind]+(g.kind==='plan'?(g.active?' · '+eur(g.amount,g.currency)+' '+(FREQ_LABEL[g.frequency]||'').toLowerCase():' · terminado'):'');
  const item=g=>'<li><button type="button" class="import-wizard-edit" data-wiz-edit="'+g.id+'" aria-label="Cambiar '+esc(g.name)+'"><span>'+esc(g.name)+'</span><b class="k-'+g.kind+'">'+esc(label(g))+'</b><i aria-hidden="true">Cambiar</i></button></li>';
  const contrib=all.length?'<section class="import-wizard-sum"><h4>Cómo he clasificado tus compras</h4><p class="broker-import-help">Toca cualquiera para cambiarlo si me he equivocado.</p>'+
   (groups.length?'<ul>'+groups.map(item).join('')+'</ul>':'')+
   (loose.length?'<details class="import-wizard-loose"><summary>Compras sueltas · '+loose.length+(loose.length===1?' valor':' valores')+'</summary><ul>'+loose.map(item).join('')+'</ul></details>':'')+'</section>':'';
  const total=(flow.matched||[]).length+(flow.funds||[]).length+(flow.dividends||[]).length;
  const n=wiz.questions;
  paint({kicker:'Resumen',title:total?'Todo listo para importar':'No hay nada que importar',pct:100,
   body:'<div class="import-wizard-summary">'+previewHtml()+contrib+
    (flow.extra?'<details class="import-wizard-ignored"><summary>Movimientos que no se importan</summary>'+flow.extra+'</details>':'')+
    cashHtml()+
    '<p class="broker-import-help">La importación sigue en segundo plano: puedes seguir usando la app y el progreso aparece arriba. Reimportar el mismo archivo no duplica nada.</p></div>',
   foot:'<button type="button" class="btn ghost" data-wiz-back>‹ Atrás</button>'+
    '<button type="button" class="btn secondary" data-wiz-finish'+(total?'':' disabled')+'>Finalizar e importar</button>'});
 }
 // Trade Republic: el efectivo se pone con el saldo que sale del CSV (editable). Otros: se ajusta con cada operación nueva.
 function cashHtml(){
  const L=flow.cashLedger,on=flow.adjustCash?' checked':'';
  if(!L)return '<label class="broker-import-check"><input type="checkbox" data-wiz-cash'+on+'> Ajustar también el efectivo de la cartera con cada operación nueva</label>';
  const since=L.first?new Date(L.first).toLocaleDateString('es-ES'):'';
  if(L.eur<0)return '<label class="broker-import-check"><input type="checkbox" data-wiz-cash'+on+'> Poner el efectivo de la cartera en</label>'+
   '<label class="import-wizard-cash"><input type="number" inputmode="decimal" min="0" step="0.01" data-wiz-cash-value value="'+(flow.cashSet??'')+'" placeholder="Saldo en Trade Republic"> €</label>'+
   '<p class="broker-import-warn">Con los movimientos del archivo (desde el '+esc(since)+') el saldo sale negativo: la exportación no empieza en la apertura de la cuenta. Escribe el efectivo que ves en Trade Republic o exporta el historial completo.</p>';
  return '<label class="broker-import-check"><input type="checkbox" data-wiz-cash'+on+'> Poner el efectivo de la cartera en</label>'+
   '<label class="import-wizard-cash"><input type="number" inputmode="decimal" min="0" step="0.01" data-wiz-cash-value value="'+(flow.cashSet??'')+'"> €</label>'+
   '<p class="broker-import-help">Saldo calculado con '+L.rows+' movimientos del archivo (ingresos, tarjeta, intereses, compras y ventas) desde el '+esc(since)+'. Si no coincide con el efectivo de Trade Republic (la exportación no empieza en la apertura de la cuenta), corrígelo aquí.</p>';
 }
 function paintPlans(){
  const c=flow.planCands||[];
  const insts=[...instrumentsOf(flow.matched||[],flow.funds||[]).values()].filter(i=>!c.some(x=>x.key===i.key)).sort((a,b)=>String(a.name).localeCompare(String(b.name),'es'));
  const card=(p,i)=>'<article class="import-plan-card'+(p.on?' on':'')+'"><label class="import-plan-toggle"><input type="checkbox" data-plan-on="'+i+'"'+(p.on?' checked':'')+'><span><b>'+esc(p.name)+'</b><small>'+esc(p.seen||'')+(p.isFund?'':' · acción')+'</small></span></label>'+
   (p.on?'<div class="import-wizard-plan"><label><span>Cantidad actual</span><input type="number" inputmode="decimal" min="0" step="0.01" data-plan-amount="'+i+'" value="'+p.amount+'"></label>'+
    '<label><span>Periodicidad</span><select data-plan-freq="'+i+'">'+Object.entries(FREQ_LABEL).map(([k,l])=>'<option value="'+k+'"'+(p.frequency===k?' selected':'')+'>'+l+'</option>').join('')+'</select></label></div>':'')+
   (p.manual?'<button type="button" class="import-plan-remove" data-plan-remove="'+i+'">✕ Quitar</button>':'')+'</article>';
  paint({kicker:'Paso 1 · Planes automáticos',title:'¿Tienes planes automáticos?',pct:6,
   body:'<div class="import-wizard-q"><p class="import-wizard-why">Si compras de forma programada (DCA) un fondo, ETF o acción, márcalo con su cantidad actual. Así separo el plan del Saveback y del Redondeo aunque vayan al mismo destino.</p>'+
    (c.length?'<p class="import-wizard-ask">Esto parece un plan</p>'+c.map(card).join(''):'<p class="import-wizard-meta">No he visto compras periódicas de cantidad redonda. Si tienes un plan, añádelo abajo.</p>')+
    (insts.length?'<div class="import-plan-add"><label><span>Añadir otro plan</span><select data-plan-add-key><option value="">Elige el fondo, ETF o acción…</option>'+insts.map(i=>'<option value="'+esc(i.key)+'">'+esc(i.name)+'</option>').join('')+'</select></label><button type="button" class="btn ghost" data-plan-add>＋ Añadir</button></div>':'')+
    '</div>',
   foot:'<button type="button" class="btn ghost" data-wiz-close>✕ Cancelar</button><button type="button" class="btn secondary" data-plans-next>Siguiente</button>'});
 }
 // Con los planes decididos se clasifica el resto y se preparan las preguntas.
 function plansNext(){
  const plans=(flow.planCands||[]).filter(p=>p.on&&p.amount>0);
  flow.definedPlans=plans;
  flow.review=buildReview(flow.matched||[],flow.funds||[],plans);
  const q=flow.review.groups.filter(g=>g.confidence==='unsure'||g.confidence==='likely').map(g=>g.id);
  wiz={mode:'steps',steps:['plans',...q,'summary'],i:1,questions:q.length};
  paintStep();focusTitle();
 }
 function onPlanInput(t){
  const c=flow.planCands||[];
  if(t.dataset.planAmount!==undefined){const p=c[+t.dataset.planAmount],v=Number(String(t.value).replace(',','.'));if(p&&v>0)p.amount=Math.round(v*100)/100;return true}
  if(t.dataset.planFreq!==undefined){const p=c[+t.dataset.planFreq];if(p)p.frequency=t.value;return true}
  if(t.dataset.planOn!==undefined){const p=c[+t.dataset.planOn];if(p){p.on=t.checked;paintPlans()}return true}
  return false;
 }
 function onWizardClick(e){
  const t=e.target;
  if(t.closest('[data-wiz-close]')){wizardClose();return}
  if(t.closest('[data-wiz-retry]')){const src=flow.source;wizardClose();flow={source:src,rows:[],positions:[],portfolioId:flow.portfolioId||guessPortfolio(src)};render();return}
  if(t.closest('[data-plans-next]')){plansNext();return}
  const rm=t.closest('[data-plan-remove]');
  if(rm){(flow.planCands||[]).splice(+rm.dataset.planRemove,1);paintPlans();return}
  if(t.closest('[data-plan-add]')){
   const key=wizEl.querySelector('[data-plan-add-key]')?.value;if(!key)return;
   const inst=instrumentsOf(flow.matched||[],flow.funds||[]).get(key);if(!inst)return;
   const last=inst.rows[inst.rows.length-1];
   (flow.planCands=flow.planCands||[]).push({key,name:inst.name,isFund:inst.isFund,currency:inst.currency,frequency:'monthly',day:dom(last),amount:Math.round(cashOf(last)*100)/100,count:0,on:true,manual:true,seen:'Añadido por ti'});
   paintPlans();return;
  }
  const o=t.closest('[data-wiz-opt]');
  if(o){const g=currentGroup();if(g){g.kind=o.dataset.wizOpt;g.answered=true;if(g.confidence==='unsure')g.confidence='likely';const top=wizEl.querySelector('[data-wiz-body]').scrollTop;paintStep();wizEl.querySelector('[data-wiz-body]').scrollTop=top}return}
  if(t.closest('[data-wiz-back]')&&wiz&&wiz.i>0){wiz.i--;paintStep();focusTitle();return}
  if(t.closest('[data-wiz-next]')&&wiz){const g=currentGroup();if(g&&!g.answered)return;wiz.i=Math.min(wiz.steps.length-1,wiz.i+1);paintStep();focusTitle();return}
  const ed=t.closest('[data-wiz-edit]');
  if(ed&&wiz){
   const id=ed.dataset.wizEdit,eg=((flow.review&&flow.review.groups)||[]).find(g=>g.id===id);
   if(eg&&eg.fromPlan){wiz.i=0;paintStep();focusTitle();return}
   let at=wiz.steps.indexOf(id);
   if(at<0){at=wiz.steps.length-1;wiz.steps.splice(at,0,id);wiz.questions++}
   wiz.i=at;paintStep();focusTitle();return;
  }
  if(t.closest('[data-wiz-finish]')){wizardClose();commit();return}
 }
 function focusTitle(){const t=wizEl&&wizEl.querySelector('[data-wiz-title]');if(t)try{t.focus({preventScroll:true})}catch(_){}}
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
 /* ---------- revisión de aportaciones: planes, Saveback, Redondeo y compras sueltas ----------
  * Antes de importar se agrupan las compras de cada valor y se clasifican:
  *  · Plan automático (DCA): una compra cada semana, cada dos semanas, cada mes o cada
  *    trimestre, en torno al mismo día. El importe es libre (lo puedes subir o bajar): cuenta
  *    el de la última ejecución.
  *  · Saveback / Redondeo (Trade Republic): compras pequeñas de importe variable.
  *  · Compras sueltas: el resto.
  * Lo que el bróker marca (plan, abono de Saveback o Redondeo) es seguro; lo que se deduce
  * por el patrón se enseña para revisar, y lo dudoso se pregunta. Las respuestas se recuerdan
  * para la próxima importación. */
 const CHOICES_KEY='viewinvai:import-review-v2';
 const KIND_LABEL={plan:'Plan automático',saveback:'Saveback',roundup:'Redondeo',buy:'Compras sueltas'};
 const KIND_SHORT={plan:'Plan',saveback:'Saveback',roundup:'Redondeo',buy:'Sueltas'};
 const FREQ_LABEL={weekly:'Semanal',biweekly:'Cada 2 semanas',twice:'2 veces al mes',monthly:'Mensual',quarterly:'Trimestral'};
 const PERIOD_DAYS={weekly:7,biweekly:14,twice:15.2,monthly:30.4,quarterly:91.3};
 function readChoices(){try{return JSON.parse(localStorage.getItem(CHOICES_KEY)||'{}')||{}}catch(_){return{}}}
 function saveChoices(map){const c=readChoices();Object.assign(c,map);try{localStorage.setItem(CHOICES_KEY,JSON.stringify(c))}catch(_){}}
 const cashOf=f=>Number(f.cash)>0?Number(f.cash):(Number(f.units??f.quantity)||0)*(Number(f.price)||0)+(Number(f.fees)||0);
 const tOf=f=>Date.parse(f.executedAt);
 const dom=f=>new Date(f.executedAt).getUTCDate();
 const monthIdx=f=>{const d=new Date(f.executedAt);return d.getUTCFullYear()*12+d.getUTCMonth()};
 const eur=(v,c='EUR')=>Number(v||0).toLocaleString('es-ES',{style:'currency',currency:/^[A-Z]{3}$/.test(c)?c:'EUR'});
 const shortDate=f=>new Date(typeof f==='string'?f:f.executedAt).toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'2-digit',timeZone:'UTC'});
 const median=a=>{const b=a.slice().sort((x,y)=>x-y),m=b.length>>1;return b.length?(b.length%2?b[m]:(b[m-1]+b[m])/2):0};
 const cv=a=>{const m=a.reduce((x,y)=>x+y,0)/a.length;return m>0?Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length)/m:0};
 // Importe «escalonado» (5, 5, 5, 10, 10): un plan al que se le cambió la cuota.
 const stepwise=a=>{const r=a.map(v=>Math.round(v*100));let changes=0;for(let i=1;i<r.length;i++)if(r[i]!==r[i-1])changes++;return changes<=Math.max(1,Math.floor(a.length/3))};
 // La serie mensual más larga que llega a la compra más reciente posible: una por mes, ventana de 5 días.
 function monthlySeries(rows){
  let best=null;
  for(const d0 of new Set(rows.map(dom))){
   const byMonth=new Map();
   for(const b of rows){const d=dom(b);if(d<d0||d>d0+4)continue;const m=monthIdx(b),cur=byMonth.get(m);if(!cur||cashOf(b)>cashOf(cur))byMonth.set(m,b)}
   const months=[...byMonth.keys()].sort((x,y)=>x-y);if(!months.length)continue;
   let run=[byMonth.get(months[months.length-1])];
   for(let i=months.length-2;i>=0&&months[i]===months[i+1]-1;i--)run.unshift(byMonth.get(months[i]));
   const score=run.length*1000+tOf(run[run.length-1])/864e5;
   if(!best||score>best.score)best={list:run,day:d0,frequency:'monthly',score};
  }
  return best;
 }
 // Cadena hacia atrás de compras separadas por el periodo (semanal, quincenal, trimestral).
 function chainSeries(rows,frequency,lo,hi,min){
  let best=null;
  for(let start=rows.length-1;start>=0;start--){
   const run=[rows[start]];let cur=rows[start];
   for(let i=start-1;i>=0;i--){const g=(tOf(cur)-tOf(rows[i]))/864e5;if(g<lo)continue;if(g>hi)break;run.unshift(rows[i]);cur=rows[i]}
   if(run.length>=min&&(!best||run.length>best.list.length))best={list:run,frequency,day:dom(run[run.length-1])};
   if(best&&best.list.length>=rows.length-1)break;
  }
  return best;
 }
 function findSeries(rows){
  const cands=[];
  const m=monthlySeries(rows);
  if(m&&m.list.length>=2){
   // Dos veces al mes (p. ej. días 2 y 16): otra serie mensual con unas dos semanas de diferencia.
   const rest=rows.filter(r=>!m.list.includes(r)),m2=monthlySeries(rest);
   const sep=m2?Math.abs(m2.day-m.day):0;
   if(m2&&m2.list.length>=2&&sep>=11&&sep<=18&&Math.abs(cashOf(m2.list[m2.list.length-1])-cashOf(m.list[m.list.length-1]))<=Math.max(1,cashOf(m.list[m.list.length-1])*.25))
    cands.push({list:[...m.list,...m2.list].sort((a,b)=>tOf(a)-tOf(b)),frequency:'twice',day:Math.min(m.day,m2.day),days:[m.day,m2.day].sort((a,b)=>a-b),weight:2});
   cands.push({...m,weight:1});
  }
  const w=chainSeries(rows,'weekly',5,9,4);if(w)cands.push({...w,weight:.5});
  const b=chainSeries(rows,'biweekly',12,16,3);if(b)cands.push({...b,weight:.9});
  const q=chainSeries(rows,'quarterly',80,100,2);if(q)cands.push({...q,weight:1.5});
  // La que explica más dinero, con preferencia por la que llega más cerca de hoy.
  cands.forEach(c=>{c.score=c.list.reduce((t,r)=>t+cashOf(r),0)*c.weight+tOf(c.list[c.list.length-1])/864e5/1000});
  return cands.sort((x,y)=>y.score-x.score)[0]||null;
 }
 function isActive(g,now=Date.now()){return now-tOf(g.rows[g.rows.length-1])<=(PERIOD_DAYS[g.frequency]||30.4)*1.6*864e5+6*864e5}
 function planAmount(g){
  if(g.frequency==='twice'){const last=g.rows.slice(-2);return last.reduce((t,r)=>t+cashOf(r),0)/Math.max(1,last.length)}
  return cashOf(g.rows[g.rows.length-1]);
 }
 function makeGroup(inst,rows,kind,confidence,why,extra={}){
  rows=rows.slice().sort((a,b)=>tOf(a)-tOf(b));
  const g={id:'',key:inst.key,name:inst.name,isFund:inst.isFund,currency:inst.currency,rows,kind,suggested:kind,confidence,why,answered:confidence!=='unsure',frequency:'monthly',day:dom(rows[rows.length-1]),...extra};
  // Firma para recordar la respuesta: un plan por su periodicidad y día; lo demás, por valor y tipo.
  g.sig=kind==='plan'?[g.key,'plan',g.frequency,g.frequency==='weekly'||g.frequency==='biweekly'?'':g.day].join('|'):[g.key,kind,confidence==='sure'?'sure':''].join('|');
  g.amount=Math.round(planAmount(g)*100)/100;
  g.active=isActive(g);
  return g;
 }
 // Compras de cada valor del archivo (acciones y fondos).
 function instrumentsOf(matched,funds){
  const insts=new Map();
  const add=(r,isFund)=>{
   if(r.side!=='BUY')return;
   const key=isFund?r.isin:(r.isin||r.stockKey);if(!key)return;
   if(!insts.has(key))insts.set(key,{key,name:r.name||r.ticker||key,isFund,currency:r.currency||'EUR',rows:[]});
   insts.get(key).rows.push(r);
  };
  matched.forEach(r=>add(r,false));funds.forEach(r=>add(r,true));
  for(const i of insts.values())i.rows.sort((a,b)=>tOf(a)-tOf(b));
  return insts;
 }
 const sureBenefit=r=>(r.benefit==='saveback'||r.benefit==='roundup')&&!r.benefitGuess;
 const roundCash=r=>{const c=cashOf(r);return c>=5&&Math.abs(c-Math.round(c))<0.005};
 const PLANS_KEY='viewinvai:import-plans-v1';
 function readPlanPrefs(){try{return JSON.parse(localStorage.getItem(PLANS_KEY)||'{}')||{}}catch(_){return{}}}
 function savePlanPrefs(list){const o={};list.forEach(p=>{o[p.key]={on:!!p.on,amount:p.amount,frequency:p.frequency}});try{localStorage.setItem(PLANS_KEY,JSON.stringify(Object.assign(readPlanPrefs(),o)))}catch(_){}}
 // Paso 1: posibles planes automáticos (DCA). Un plan compra una cantidad redonda (5 €, 50 €…) cada
 // cierto tiempo; el Saveback y el Redondeo son importes con céntimos que cambian cada vez, aunque el
 // bróker los ejecute igual que un plan y vayan al mismo fondo.
 function buildPlanCandidates(matched,funds){
  const out=[],prefs=readPlanPrefs();
  for(const inst of instrumentsOf(matched,funds).values()){
   const round=inst.rows.filter(r=>!sureBenefit(r)&&roundCash(r));
   if(round.length<2)continue;
   const s=findSeries(round);
   if(!s||s.list.length<2)continue;
   const flagged=s.list.filter(r=>r.plan).length;
   if(!inst.isFund&&s.list.length<4&&!flagged)continue;
   const last=s.list[s.list.length-1],pref=prefs[inst.key];
   const active=Date.now()-tOf(last)<=(PERIOD_DAYS[s.frequency]||30.4)*1.6*864e5+6*864e5;
   out.push({key:inst.key,name:inst.name,isFund:inst.isFund,currency:inst.currency,frequency:pref&&pref.frequency||s.frequency,day:s.day,
    amount:pref&&pref.amount||Math.round(cashOf(last)*100)/100,count:s.list.length,lastAt:last.executedAt,active,
    on:pref?!!pref.on:(active&&(flagged>0||(inst.isFund&&s.list.length>=3))),
    seen:eur(cashOf(last),inst.currency)+' '+(FREQ_LABEL[s.frequency]||'').toLowerCase()+(s.frequency==='monthly'?' hacia el día '+s.day:'')+' · '+s.list.length+' veces, la última el '+shortDate(last)});
  }
  // Planes guardados de otras importaciones que esta vez no se ven en el archivo.
  for(const [key,p] of Object.entries(prefs)){
   if(!p||!p.on||out.some(c=>c.key===key))continue;
   const inst=instrumentsOf(matched,funds).get(key);if(!inst)continue;
   out.push({key,name:inst.name,isFund:inst.isFund,currency:inst.currency,frequency:p.frequency||'monthly',day:dom(inst.rows[inst.rows.length-1]),amount:p.amount,count:0,on:true,manual:true,seen:'Definido por ti en otra importación'});
  }
  return out;
 }
 // Una ejecución del plan por periodo: la compra más parecida a la cuota (admite que la cambies).
 function periodKey(r,freq){
  const d=new Date(r.executedAt),y=d.getUTCFullYear(),m=d.getUTCMonth();
  if(freq==='weekly')return Math.floor((tOf(r)/864e5+3)/7);
  if(freq==='biweekly')return Math.floor((tOf(r)/864e5+3)/14);
  if(freq==='twice')return y*24+m*2+(d.getUTCDate()>15?1:0);
  if(freq==='quarterly')return y*4+Math.floor(m/3);
  return y*12+m;
 }
 function planRowsFor(rows,plan){
  const byPeriod=new Map();
  for(const r of rows){
   if(sureBenefit(r))continue;
   const c=cashOf(r);
   if(!(roundCash(r)||r.plan))continue;
   if(c<plan.amount*0.4||c>plan.amount*2.5)continue;
   const k=periodKey(r,plan.frequency),cur=byPeriod.get(k);
   if(!cur||Math.abs(c-plan.amount)<Math.abs(cashOf(cur)-plan.amount))byPeriod.set(k,r);
  }
  return [...byPeriod.values()];
 }
 // Paso 2: con los planes ya definidos, el resto se clasifica: abono de Saveback/Redondeo en el CSV
 // (seguro), compras pequeñas por su ritmo (preguntando) y lo demás, compras sueltas.
 function buildReview(matched,funds,plans=[]){
  const groups=[],choices=readChoices();
  for(const inst of instrumentsOf(matched,funds).values()){
   const rows=inst.rows;let rest=rows.slice();
   const plan=plans.find(p=>p.on&&p.key===inst.key&&p.amount>0);
   if(plan){
    const list=planRowsFor(rows,plan);
    if(list.length){
     const g=makeGroup(inst,list,'plan','sure','Tu plan de '+eur(plan.amount,inst.currency)+' '+(FREQ_LABEL[plan.frequency]||'').toLowerCase()+'.',{frequency:plan.frequency,day:plan.day||dom(list[list.length-1])});
     g.amount=plan.amount;g.fromPlan=true;groups.push(g);
     rest=rest.filter(r=>!list.includes(r));
    }
   }
   for(const k of ['saveback','roundup']){
    const list=rest.filter(r=>r.benefit===k&&!r.benefitGuess);
    if(list.length){groups.push(makeGroup(inst,list,k,'sure',list.every(r=>r.benefitSrc==='card')?'Cuadra con tus pagos con tarjeta del archivo ('+(k==='saveback'?'1 % de lo gastado cada mes':'redondeo de cada pago')+').':'El archivo trae el abono de '+KIND_LABEL[k]+' de cada compra.'));rest=rest.filter(r=>!list.includes(r))}
   }
   // Compras pequeñas sin explicar: Saveback (mensual, hacia el día 2) o Redondeo (semanal).
   const small=rest.filter(r=>cashOf(r)<=35);
   let guess=['roundup','saveback'].find(k=>small.filter(r=>r.benefit===k).length>=small.length/2)||'buy';
   if(guess==='buy'&&small.length>=2){
    const gaps=[];for(let i=1;i<small.length;i++)gaps.push((tOf(small[i])-tOf(small[i-1]))/864e5);
    const g=median(gaps),amts=small.map(cashOf);
    if(median(amts)<=16){if(g>=5&&g<=10)guess='roundup';else if(g>=25&&g<=36&&small.filter(r=>dom(r)<=6).length>=small.length*.7)guess='saveback'}
   }
   if(small.length>=3||(small.length>=2&&guess!=='buy')){
    const amounts=small.map(cashOf);
    groups.push(makeGroup(inst,small,guess,'unsure',small.length+' compras pequeñas de importe variable ('+eur(Math.min(...amounts))+' a '+eur(Math.max(...amounts))+').'+(guess!=='buy'?' Por las fechas parecen '+KIND_LABEL[guess]+'.':'')));
    rest=rest.filter(r=>!small.includes(r));
   }
   if(rest.length)groups.push(makeGroup(inst,rest,'buy','sure','Compras puntuales.'));
  }
  // Un mismo valor y tipo en un solo grupo (p. ej. Redondeo detectado en dos tandas).
  for(let i=groups.length-1;i>=0;i--){
   const g=groups[i],j=groups.findIndex((h,k)=>k<i&&h.key===g.key&&h.kind===g.kind&&g.kind!=='plan'&&h.confidence===g.confidence);
   if(j>=0){const h=groups[j];h.rows=h.rows.concat(g.rows).sort((x,y)=>tOf(x)-tOf(y));h.amount=Math.round(planAmount(h)*100)/100;groups.splice(i,1)}
  }
  groups.forEach((g,i)=>{
   g.id='g'+i;
   const saved=choices[g.sig];
   if(saved&&g.confidence!=='sure'&&saved.kind!=='plan'){g.kind=saved.kind;g.answered=true;g.confidence='remembered'}
  });
  return{groups};
 }
 function pendingQuestions(){return((flow.review&&flow.review.groups)||[]).filter(g=>!g.answered).length}
 // Aplica la revisión a las filas antes de enviarlas y devuelve los planes a crear o actualizar.
 function applyReview(){
  const plans=[],noPlans=[],remember={};
  for(const g of (flow.review&&flow.review.groups)||[]){
   for(const r of g.rows){
    r.plan=g.kind==='plan';r.benefit=g.kind==='saveback'||g.kind==='roundup'?g.kind:'';r.benefitGuess=false;
    if(r.baseNotes!==undefined)r.notes=r.baseNotes+(r.benefit==='saveback'?' · Saveback':r.benefit==='roundup'?' · Redondeo':r.plan?' · Plan automático':'');
   }
   if(g.confidence!=='sure')remember[g.sig]={kind:g.kind,frequency:g.kind==='plan'?g.frequency:undefined};
   if(!g.isFund)continue;
   if(g.kind==='plan'&&g.active&&g.amount>0){
    const freq=g.frequency==='twice'||g.frequency==='biweekly'?'monthly':g.frequency;
    // «2 veces al mes» y «cada 2 semanas» se guardan como un plan mensual con la suma del mes.
    const amount=g.frequency==='twice'?g.amount*2:g.frequency==='biweekly'?g.amount*26/12:g.amount;
    plans.push({isin:g.key,amount:Math.round(amount*100)/100,currency:g.currency||'EUR',dayOfMonth:g.day,frequency:freq,count:g.rows.length,lastAt:g.rows[g.rows.length-1].executedAt,
     note:g.frequency==='twice'?'2 veces al mes ('+eur(g.amount)+' cada vez)':g.frequency==='biweekly'?'Cada 2 semanas ('+eur(g.amount)+' cada vez)':''});
   }else if(g.suggested==='plan'&&g.kind!=='plan')noPlans.push(g.key);
  }
  // Planes que definiste sin compras en este archivo (p. ej. uno recién creado) y los que desmarcaste.
  for(const p of flow.planCands||[]){
   if(!p.isFund)continue;
   if(p.on&&p.amount>0&&!plans.some(x=>x.isin===p.key)){
    const freq=p.frequency==='twice'||p.frequency==='biweekly'?'monthly':p.frequency;
    plans.push({isin:p.key,amount:Math.round((p.frequency==='twice'?p.amount*2:p.frequency==='biweekly'?p.amount*26/12:p.amount)*100)/100,currency:p.currency||'EUR',dayOfMonth:p.day||new Date().getDate(),frequency:freq,count:p.count||1,lastAt:p.lastAt||new Date().toISOString(),note:''});
   }else if(!p.on)noPlans.push(p.key);
  }
  savePlanPrefs(flow.planCands||[]);
  saveChoices(remember);
  return{plans,noPlans:[...new Set(noPlans)].filter(k=>!plans.some(p=>p.isin===k))};
 }
 // The import runs in the background (ViewInvAITasks): the window closes at once and
 // the floating task pill shows progress, errors and the duplicate question.
 async function commit(){
  if(pendingQuestions())return;
  const review=applyReview();
  const job={portfolioId:flow.portfolioId,source:flow.source,rows:(flow.matched||[]).slice(),divs:(flow.dividends||[]).slice(),funds:(flow.funds||[]).slice(),
   adjustCash:!!flow.adjustCash&&!flow.cashLedger,setCash:flow.adjustCash&&flow.cashLedger&&flow.cashSet!=null?flow.cashSet:null};
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
   if(job.setCash!==null){
    const res=await window.ViewInvAIAuth.apiFetch('/api/portfolios/'+encodeURIComponent(job.portfolioId),{method:'PATCH',body:JSON.stringify({cashBalance:job.setCash})});
    if(res.ok)task.log('Efectivo de la cartera: '+eur(job.setCash,'EUR')+'.');else{errors++;task.log('No se pudo poner el efectivo de la cartera.','error')}
   }
   const parts=[imported+(imported===1?' operación':' operaciones')];
   if(job.funds.length)parts.push(fundImported+' de fondos');
   if(job.divs.length)parts.push(divImported+' dividendos');
   if(skipped+fundSkipped+divSkipped)task.log((skipped+fundSkipped+divSkipped)+' ya estaban importados.');
   if(retired)task.log(retired+' apuntes manuales sustituidos por el historial del bróker.');
   if(plans)task.log(plans+(plans===1?' plan de ahorro creado':' planes de ahorro creados')+' en tu cartera de fondos.');
   if(review.plans.length)task.log('Planes: '+review.plans.map(p=>(job.funds.find(f=>f.isin===p.isin)||{}).name+' '+eur(p.amount)+(p.frequency==='weekly'?'/semana':p.frequency==='quarterly'?'/trimestre':'/mes')).join(' · '));
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
   try{const data=await fetchIbkr({token,queryId});flow.positions=data.positions||[];flow.cashLedger=null;flow.dividends=data.dividends||[];runAnalysis(async()=>({rows:data.trades||[]}))}
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
   runAnalysis(async()=>{
    const text=await file.text();
    const {rows,skipped,dividends,ledger}=rowsFromCsv(text,flow.source==='tr'?'tr':'csv');
    flow.dividends=dividends||[];flow.cashLedger=ledger||null;
    const ign=Object.entries(skipped);
    return{rows,extra:ign.length?'<p class="broker-import-help">No son compras, ventas ni dividendos: '+esc(ign.slice(0,8).map(([k,v])=>k+' ×'+v).join(', '))+'</p>':''};
   });
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
  _parseCsv:rowsFromCsv,_match:matchRows,_review:buildReview,_applyReview:applyReview,_setFlow:f=>{flow=Object.assign(flow,f)}
 };
})();
