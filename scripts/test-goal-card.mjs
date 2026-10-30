// Tarjeta de idea del Objetivo: sencilla (quién, qué hacer y botones) con el detalle detrás de «ⓘ Por qué».
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../portfolio.js',import.meta.url),'utf8');
const slice=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0&&b>a,'slice '+from);return source.slice(a,b)};
const store={};
const context={console,Math,Number,String,Array,Object,Set,Map,JSON,RegExp,Date,
  num:v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null,
  formatNumber:(v,d=1)=>Number(v).toFixed(d).replace('.',','),formatMoney:v=>Number(v).toFixed(2).replace('.',',')+' €',
  esc:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
  state:{selectedPortfolioId:'pf1'},window:{},portfolioStockKey:s=>s.key,portfolioConvertAmount:v=>v,portfolioPriceToEur:v=>v,goalExecutionQuote:()=>({}),
  localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)}},
  document:{addEventListener:()=>{}}};
vm.createContext(context);
vm.runInContext(slice('function goalOperationUnits(','function goalTradeInstructionHtml('),context);
vm.runInContext(slice('function goalLinkedText(','// Ideas a 1-3 meses por momento'),context);
vm.runInContext(slice('function goalWaitTag(','function goalPlanHistorySnapshot('),context);
vm.runInContext(slice('const GOAL_IDEAS_KEY=','function goalTodayCommitments(')+slice('function goalTodayDiscarded(','\n}\n')+'\n}\n',context);
vm.runInContext(slice('function goalPendingOrders(','document.addEventListener("click"'),context);
vm.runInContext(slice('const goalOpenWhy=new Set()','document.addEventListener("toggle"'),context);
const cand={key:'TSE:7203',stock:{key:'TSE:7203',name:'Toyota Motor Corp.'},quote:{price:17.59,feeEur:1,currency:'EUR',executable:false,executionReason:'sin verificar'}};
const ctx={candidates:[cand],positions:[],preferTr:true,fx:.86,committed:[{key:'TSE:7203',reviewVerdict:'',cons:['resultados el 2026-11-05','comisión de ida y vuelta 4,3 % del importe']}],sleeves:{}};
const buy={type:'BUY',limitPriceEur:17.59,key:'TSE:7203',ticker:'TOM',name:'Toyota Motor Corp.',label:'TOM (Toyota Motor Corp.)',units:5,ticketEur:87.7,priceEur:17.54,riskEur:7.26,riskPct:6,stopPct:6,targetPct:6.4,burstScore:100,riskTier:'bajo',committed:true,
  text:'Comprar 5 × TOM (Toyota Motor Corp.) con orden límite a 17,59 € (≈ 87,70 €).',pros:['volumen acelera'],cons:['resultados el 2026-11-05','comisión de ida y vuelta 2,3 % del importe']};
const html=context.goalActionHtml(buy,ctx);
assert.ok(html.includes('Comprar 5 acciones · límite <b>17,59 €</b> · total máx. 87,95 €'),'One price on the card: the order limit, plus the most you would pay');
assert.ok(context.goalActionHtml({...buy,units:1,ticketEur:42.45,limitPriceEur:42.58},ctx).includes('Comprar 1 acción · límite <b>42,58 €</b></span>'),'With one share only the limit is shown');
const frac=context.goalActionHtml({...buy,fractional:true,units:4.987,committed:false},{...ctx,committed:[]});
assert.ok(frac.includes('(fracción) · límite <b>17,59 €</b> si tu bróker lo permite'));
const sell=context.goalActionHtml({type:'SELL',reason:'stop',key:'NASDAQ:SPRO',ticker:'SPRO',name:'Spero',units:0.4,text:'Vender'},{...ctx,positions:[]});
assert.ok(sell.includes('vender 0,4 acciones'),'Fractional sells are not rounded');
assert.ok(html.includes('✓ Comprada')&&html.includes('data-register-goal-operation="BUY"'),'Bought button registers the order');
assert.ok(html.includes('data-goal-discard="TSE:7203"')&&!html.includes('data-goal-discard-confirm'),'Every buy can be discarded without a blocking dialog');
assert.ok(html.includes('data-goal-why=')&&/class="goal2-why-body" hidden/.test(html),'Details stay closed by default');
assert.ok(html.includes('2,3 % del importe')&&!html.includes('4,3 %'),'The fee comes from today\'s plan, not from the stored review');
const wide=context.goalActionHtml(buy,{...ctx,candidates:[{...cand,quote:{...cand.quote,bid:42.10,ask:42.85}}]});
assert.ok(wide.includes('Horquilla 42,10 € – 42,85 €')&&wide.indexOf('goal2-spread-note')<wide.indexOf('goal2-why-body'),'A limit below the ask is flagged on the card itself');
assert.ok(!html.includes('goal2-spread-note'),'No warning when there is no book');
const liveCard=context.goalActionHtml(buy,{...ctx,candidates:[{...cand,quote:{...cand.quote,bid:42.10,ask:42.85,ageMs:8000,quoteFresh:true}}]});
assert.ok(liveCard.includes('En vivo · compra 42,85 € · venta 42,10 € · hace 8 s'),'Each buy card shows the live buy/sell price and its age');
assert.ok(html.indexOf('Cotización ejecutable sin verificar')>html.indexOf('goal2-why-body'),'The unverified-quote note moves into the details');
const wait=context.goalActionHtml({type:'WAIT',key:'TSE:8001',ticker:'IOC',name:'Itochu Corporation',committed:true,decision:'ESPERAR',text:'Esperar IOC: momentum de entrada deteriorado.',burstScore:100,entryTiming:93,riskTier:'bajo'},{...ctx,candidates:[]});
assert.ok(wait.includes('Esperar entrada')&&wait.includes('data-goal-discard="TSE:8001"'),'A fixed waiting idea can be discarded too');
assert.ok(!context.goalActionHtml({...buy,committed:false},ctx).includes('data-goal-discard-confirm'));
vm.runInContext('goalOpenWhy',context).add('BUY:TSE:7203');
assert.ok(!/class="goal2-why-body" hidden/.test(context.goalActionHtml(buy,ctx)),'An opened «Por qué» stays open across re-renders');
// Descartadas hoy: nombre guardado en el dispositivo y botón para volver a mostrarla.
const today=vm.runInContext('goalIdeaDay()',context);
store['viewinvai:goal-ideas:v2']=JSON.stringify({pf1:{day:today,discarded:['TSE:7203'],discardedInfo:{'TSE:7203':{ticker:'TOM',name:'Toyota Motor Corp.'}}}});
const d=context.goalDiscardedTodayHtml('pf1',{discarded_ideas:''},{candidates:[]});
assert.ok(d.includes('Descartadas hoy')&&d.includes('Toyota Motor Corp.')&&d.includes('data-goal-restore="TSE:7203"'));
assert.equal(context.goalDiscardedTodayHtml('pf1',{discarded_ideas:JSON.stringify({day:'2000-01-01',keys:['X']})},{candidates:[]}).includes('X'),false);
if(process.env.CARD_HTML)fs.writeFileSync(process.env.CARD_HTML,wide.replace('class="goal2-why-body"','class="goal2-why-body" data-x')+context.goalActionHtml({...buy,key:'NASDAQ:HAE',name:'Haemonetics',ticker:'HAE',units:1,ticketEur:62.1,riskTier:'medio',committed:false},{...ctx,committed:[]})+wait+d);
// «Orden puesta»: botón en las compras con límite y tarjeta que vigila el precio de compra en vivo.
assert.ok(html.includes('data-goal-place-order="TSE:7203"')&&html.includes('data-limit="17.59"')&&html.includes('data-units="5"'),'Buy cards offer «Orden puesta» with the order data');
context.stockByKey=k=>k==='TSE:9101'?{key:k,name:'Nippon Yusen'}:null;
context.goalExecutionQuote=()=>({ask:42.85,currency:'EUR'});
const order={key:'TSE:9101',ticker:'NYKA',name:'Nippon Yusen',units:1,limitEur:42.61,feeEur:1,sleeve:'alto',at:new Date(Date.now()-12*60000).toISOString()};
let card=context.goalPendingOrderHtml(order,{preferTr:true,fx:1});
assert.ok(card.includes('Orden puesta · 1 acción · límite <b>42,61 €</b>')&&card.includes('hace 12 min'),'Pending order shows what was ordered and when');
assert.ok(card.includes('Precio de compra ahora 42,85 €')&&card.includes('aún no se ejecuta'),'Live ask above the limit: not filled yet');
assert.ok(card.includes('✓ Ejecutada')&&card.includes('data-goal-price="42.61"')&&card.includes('data-goal-cancel-order="TSE:9101"'),'Executed registers at the limit; the order can be cancelled');
context.goalExecutionQuote=()=>({ask:42.5,currency:'EUR'});
card=context.goalPendingOrderHtml(order,{preferTr:true,fx:1});
assert.ok(card.includes('ya está en tu límite o por debajo: puede haberse ejecutado'),'Live ask at or below the limit: it may have filled');
assert.equal(Math.round(context.goalPendingOrderEur(order)*100)/100,43.61,'An order reserves units × limit + fee');
assert.equal(context.goalPendingOrders({pending_orders:JSON.stringify([{...order,at:new Date(Date.now()-8*86400e3).toISOString()}])}).length,0,'Orders older than 7 days expire');
if(process.env.CARD_ORDER){context.goalExecutionQuote=()=>({ask:42.85,currency:'EUR'});fs.writeFileSync(process.env.CARD_ORDER,'<div class="goal2-orders"><small class="goal2-orders-title">Órdenes puestas · 1</small>'+context.goalPendingOrderHtml(order,{preferTr:true,fx:1})+'</div>'+liveCard)}
console.log('Goal card tests: OK');
