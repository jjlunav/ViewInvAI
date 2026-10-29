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
  state:{selectedPortfolioId:'pf1'},window:{},portfolioStockKey:s=>s.key,portfolioConvertAmount:v=>v,goalExecutionQuote:()=>({}),
  localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)}},
  document:{addEventListener:()=>{}}};
vm.createContext(context);
vm.runInContext(slice('function goalOperationUnits(','function goalTradeInstructionHtml('),context);
vm.runInContext(slice('function goalLinkedText(','// Ideas a 1-3 meses por momento'),context);
vm.runInContext(slice('function goalWaitTag(','function goalPlanHistorySnapshot('),context);
vm.runInContext(slice('const GOAL_IDEAS_KEY=','function goalTodayCommitments(')+slice('function goalTodayDiscarded(','\n}\n')+'\n}\n',context);
vm.runInContext(slice('function goalDiscardedTodayHtml(','document.addEventListener("click"'),context);
vm.runInContext(slice('const goalOpenWhy=new Set()','document.addEventListener("toggle"'),context);
const cand={key:'TSE:7203',stock:{key:'TSE:7203',name:'Toyota Motor Corp.'},quote:{price:17.59,feeEur:1,currency:'EUR',executable:false,executionReason:'sin verificar'}};
const ctx={candidates:[cand],positions:[],preferTr:true,fx:.86,committed:[{key:'TSE:7203',reviewVerdict:'',cons:['resultados el 2026-11-05','comisión de ida y vuelta 4,3 % del importe']}],sleeves:{}};
const buy={type:'BUY',key:'TSE:7203',ticker:'TOM',name:'Toyota Motor Corp.',label:'TOM (Toyota Motor Corp.)',units:5,ticketEur:87.7,priceEur:17.54,riskEur:7.26,riskPct:6,stopPct:6,targetPct:6.4,burstScore:100,riskTier:'bajo',committed:true,
  text:'Comprar 5 × TOM (Toyota Motor Corp.) con orden límite a 17,59 € (≈ 87,70 €).',pros:['volumen acelera'],cons:['resultados el 2026-11-05','comisión de ida y vuelta 2,3 % del importe']};
const html=context.goalActionHtml(buy,ctx);
assert.ok(html.includes('Comprar 5 acciones · <b>87,70 €</b>'),'One short line says what to do');
assert.ok(html.includes('✓ Comprada')&&html.includes('data-register-goal-operation="BUY"'),'Bought button registers the order');
assert.ok(html.includes('data-goal-discard="TSE:7203"')&&!html.includes('data-goal-discard-confirm'),'Every buy can be discarded without a blocking dialog');
assert.ok(html.includes('data-goal-why=')&&/class="goal2-why-body" hidden/.test(html),'Details stay closed by default');
assert.ok(html.includes('2,3 % del importe')&&!html.includes('4,3 %'),'The fee comes from today\'s plan, not from the stored review');
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
if(process.env.CARD_HTML)fs.writeFileSync(process.env.CARD_HTML,html.replace('class="goal2-why-body"','class="goal2-why-body" data-x')+context.goalActionHtml({...buy,key:'NASDAQ:HAE',name:'Haemonetics',ticker:'HAE',units:1,ticketEur:62.1,riskTier:'medio',committed:false},{...ctx,committed:[]})+wait+d);
console.log('Goal card tests: OK');
