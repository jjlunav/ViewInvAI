import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const source=fs.readFileSync(new URL("../goal-engine.js",import.meta.url),"utf8");
const context={console,Intl,Date,Math,Number,String,Array,Object,Set,Map,JSON};
context.globalThis=context;
vm.createContext(context);
vm.runInContext(source,context,{filename:"goal-engine.js"});
const G=context.ViewInvAIGoal;
assert.ok(G&&typeof G.plan==="function","Goal engine must load");

const base={
  key:"NASDAQ:TEST",ticker:"TEST",name:"Test Corp",score:92,quality:90,tier:"high",speculative:false,
  priceEur:10,askEur:10,atrPct:4,feeEur:1,relVolume:2,rsi:58,adx:24,technicalPrice:10,
  ema20:9.8,ema50:9.5,perfWeek:5,spreadPct:.5,avgVolume:1_000_000,extensionPct:2,nearHighPct:1,
  dayChangePct:2,catalystDays:2,catalystImpact:80
};
const input=candidates=>({
  config:{target:1500,deadline:"2026-11-30T23:59:59Z",startValue:1000,startDate:"2026-10-01",risk:"aggressive",maxPositions:5,allowSpec:true},
  positions:[],candidates,cashEur:1000,peakValueEur:1000,wasDefensive:false,nowMs:Date.parse("2026-10-06T12:00:00Z")
});

// A shorter deadline raises the mathematical hurdle, never the selected risk budget.
{
  const now=Date.parse('2026-01-01T00:00:00Z'),cfg={target:2000,startValue:1000,startDate:'2026-01-01'};
  const short=G.pace({...cfg,deadline:'2026-01-31T00:00:00Z'},1000,now);
  const long=G.pace({...cfg,deadline:'2026-12-27T00:00:00Z'},1000,now);
  assert.ok(Math.abs(short.requiredMonthlyPct-100)<1e-8);
  assert.ok(Math.abs(long.requiredMonthlyPct-(2**(1/12)-1)*100)<1e-8);
  assert.equal(short.requiredGrowthPct,100);assert.equal(short.remainingEur,1000);
  for(const startValue of [null,0])assert.equal(G.pace({...cfg,startValue,deadline:'2026-12-31'},1000,now).status,'unmeasured');
  assert.equal(G.pace({...cfg,startDate:'',deadline:'2026-12-31'},1000,now).status,'unmeasured');
  const empty=G.pace({...cfg,startValue:0,deadline:'2026-12-31'},0,now);
  assert.equal(empty.status,'unmeasured');assert.equal(empty.requiredMonthlyPct,null);
  const huge=G.pace({...cfg,target:1e100,deadline:'2026-01-01T00:00:00.001Z'},1,now);
  assert.equal(huge.requiredMonthlyPct,null,'An unrepresentable rate must not leak Infinity into the UI');
  assert.equal(G.pace({...cfg,deadline:'2026-01-31'},1000,0).status,'unmeasured','Epoch zero is a valid evaluation time');
}

// Reaching the goal retires pending entry ideas and proposes an editable higher milestone.
{
  const held={...base,key:'NASDAQ:HELD',ticker:'HELD',units:20,avgEur:10,priceEur:10,bidEur:10,holdingDays:1};
  const cfg={...input([]).config,target:150,startValue:100};
  const p=G.plan({...input([base]),config:cfg,positions:[held],committed:[{key:base.key,priceEur:10,ticketEur:100,at:'2026-10-06'}]});
  assert.equal(p.pace.status,'reached');assert.equal(p.nextTargetEur,250,'Base the next milestone on the current value, including any overshoot');
  assert.equal(p.whyNoBuy[0].code,'reached');assert.equal(p.commitments.length,0);
  assert.ok(p.consumedCommitments.some(x=>x.reason==='goal-reached'));
  assert.ok(!p.actions.some(x=>x.type==='BUY'||x.reason==='rotation'));
  assert.equal(p.waits.length,0);assert.equal(p.alternatives.length,0);
  const protectedPlan=G.plan({...input([base]),config:cfg,positions:[{...held,stopEur:11}]});
  assert.ok(protectedPlan.actions.some(x=>x.reason==='stop'),'Stops stay active after reaching the goal');
  assert.ok(!protectedPlan.actions.some(x=>x.type==='BUY'),'Stop proceeds do not reopen risk for a completed goal');
  const news=G.plan({...input([base]),config:cfg,positions:[{...held,aiVerdict:'contradice',aiNewsReason:'Verified adverse news'}]});
  assert.ok(news.actions.some(x=>x.reason==='news'),'Risk-reducing news exits remain available');
  const raised=G.plan({...input([base]),config:{...cfg,target:1000},positions:[held]});
  assert.ok(raised.actions.some(x=>x.type==='BUY'),'Accepting a larger goal allows entries again');
  assert.equal(raised.band.risk,p.band.risk);assert.equal(cfg.target,150,'The engine never saves or mutates the target');
  assert.equal(G.nextGoal(100000000,100000000),null,'Do not suggest an amount beyond the backend target limit');
}

// Fee-inclusive quoted stop risk must fit the profile, even for whole-share fallback orders.
{
  let seen=0;
  for(const risk of Object.keys(G.RISK))for(const cash of [200,500,1000,2500])for(const price of [3,13,58,200])for(const fee of [0,.5,1])for(const allowFractions of [true,false]){
    const c={...base,priceEur:price,askEur:price,technicalPrice:price,ema20:price*.98,ema50:price*.95,feeEur:fee};
    const p=G.plan({...input([c]),config:{...input([]).config,risk,allowFractions},cashEur:cash,peakValueEur:cash});
    for(const a of p.actions.filter(x=>x.type==='BUY')){
      seen++;assert.ok(a.riskEur<=cash*G.RISK[risk].riskPerTradePct/100+.011,'Fees and whole shares cannot exceed the profile risk budget');
    }
  }
  assert.ok(seen>100,'Exercise feasible purchases across profiles and sizes');
  const short=G.plan({...input([base]),config:{...input([]).config,risk:'conservative',deadline:'2026-10-07',startDate:'2026-01-01',startValue:10000}});
  const long=G.plan({...input([base]),config:{...input([]).config,risk:'conservative',deadline:'2028-10-07',startDate:'2026-01-01',startValue:10000}});
  assert.equal(short.band.risk,long.band.risk);
  assert.equal(JSON.stringify(short.actions.filter(x=>x.type==='BUY').map(x=>x.units)),JSON.stringify(long.actions.filter(x=>x.type==='BUY').map(x=>x.units)),'Deadline pressure must not silently increase risk');
}

{
  const p=G.plan(input([base]));
  assert.equal(p.actions.filter(x=>x.type==="BUY").length,1,"clean setup should BUY NOW");
  assert.equal(p.actions.find(x=>x.type==="BUY").decision,"COMPRAR AHORA");
}
{
  const extended={...base,key:"NASDAQ:EXT",ticker:"EXT",technicalPrice:10.8,priceEur:10.8,askEur:10.8,ema20:10,extensionPct:8,dayChangePct:5,perfWeek:10,rsi:64};
  const p=G.plan(input([extended]));
  assert.equal(p.actions.filter(x=>x.type==="BUY").length,0,"extended setup must not market-buy");
  assert.equal(p.waits.length,1,"extended quality setup should remain visible");
  assert.equal(p.waits[0].decision,"COMPRA LÍMITE");
  assert.ok(p.waits[0].limitPriceEur<extended.askEur,"limit must be below current ask");
}
{
  const wide={...base,key:"NASDAQ:WIDE",ticker:"WIDE",spreadPct:7};
  const p=G.plan(input([wide]));
  assert.equal(p.actions.filter(x=>x.type==="BUY").length,0,"wide spread must block market buy");
  assert.equal(p.waits[0]?.decision,"ESPERAR","wide spread should wait, not set a blind limit");
}
{
  const blocked={...base,key:"NASDAQ:BLOCK",ticker:"BLOCK",aiScoutVerdict:"block"};
  const p=G.plan(input([blocked]));
  assert.equal(p.actions.filter(x=>x.type==="BUY").length,0,"AI block must never buy");
  assert.equal(p.waits.length,0,"AI block must not leak into wait shortlist");
}
{
  const rows=[0,1,2].map(i=>({...base,key:"NASDAQ:T"+i,ticker:"T"+i,score:94-i,quality:92-i,burstScore:undefined}));
  const p=G.plan(input(rows));
  assert.ok(p.actions.filter(x=>x.type==="BUY").length<=2,"Goal must recommend at most two new buys");
}
{
  const position={key:"NASDAQ:OLD",ticker:"OLD",name:"Old",units:10,avgEur:10,priceEur:10,bidEur:10,score:55,quality:80,
    tier:"watch",speculative:false,atrPct:2,feeEur:1,holdingDays:7,catalystDays:null,catalystImpact:0};
  const p=G.plan({...input([]),positions:[position],cashEur:100,peakValueEur:200});
  assert.ok(p.actions.some(x=>x.type==="SELL"&&(x.reason==="time-exit"||x.reason==="stagnation")),"stale flat position should release cash");
}

{
  const position={key:"NASDAQ:BAD",ticker:"BAD",name:"Bad",units:10,avgEur:10,priceEur:9.5,bidEur:9.5,score:70,quality:80,
    tier:"watch",speculative:false,atrPct:2,feeEur:1,holdingDays:3,catalystDays:null,catalystImpact:0,aiVerdict:"contradice",aiNewsReason:"anuncia una ampliación de capital"};
  const p=G.plan({...input([]),positions:[position],cashEur:100,peakValueEur:200});
  assert.ok(p.actions.some(x=>x.type==="SELL"&&x.reason==="news"),"invalidating news must propose exiting even at a loss");
}
{
  const weak={...base,relVolume:.5,rsi:30,dayChangePct:-1};const plain=G.candidateBurst(weak,"aggressive").score;
  const idea=G.candidateBurst({...weak,aiIdeaConfidence:80},"aggressive").score;
  assert.ok(idea>plain,"AI analyst idea with news must raise the early score");
}

// Sin compras: el plan explica el motivo (efectivo a cero, sin candidatas).
{
  const cfg={target:20000,deadline:"2027-06-01",startValue:10000,startDate:"2026-01-01",risk:"aggressive",maxPositions:5};
  let p=G.plan({config:cfg,positions:[],candidates:[{key:"X",ticker:"X",tier:"high",score:80,quality:80,askEur:10,priceEur:10}],cashEur:0,nowMs:Date.now()});
  assert.equal(p.whyNoBuy[0]&&p.whyNoBuy[0].code,"cash","no cash must be reported");
  p=G.plan({config:cfg,positions:[],candidates:[],cashEur:5000,nowMs:Date.now()});
  assert.equal(p.whyNoBuy[0]&&p.whyNoBuy[0].code,"nocands","no candidates must be reported");
}

// Cartera pequeña con efectivo: el dinero no se reserva para huecos que ninguna candidata va a llenar.
{
  // Volatilidad realista para un objetivo agresivo (ATR 4 %/día): con 2 % el recorrido previsto (≤ 1,5 × ATR × √5)
  // no compensa 2 € de comisiones en un ticket de 48 € y lo correcto es no comprar.
  const pricey={...base,key:"LSX:FJE",ticker:"FJE",priceEur:58,askEur:58,technicalPrice:58,ema20:56.8,ema50:55,atrPct:4,feeEur:.5};
  const p=G.plan({...input([pricey]),config:{...input([]).config,target:500,startValue:197},cashEur:197,peakValueEur:197});
  assert.equal(p.actions.filter(x=>x.type==="BUY").length,1,"small account must still buy one share it can afford");
}

// Capital limitado, fracciones y valores sin fracciones.
{
  const pricey={...base,key:"LSX:56S1",ticker:"56S1",priceEur:200,askEur:200,technicalPrice:200,ema20:196,ema50:190};
  const cfg={...input([]).config,target:1000,startValue:500};
  let p=G.plan({...input([pricey]),config:cfg,cashEur:450,peakValueEur:500,lockedValueEur:50});
  let buy=p.actions.find(x=>x.type==="BUY");
  assert.ok(buy&&buy.fractional&&buy.units>0&&buy.units<1,"expensive stock must be bought as a fraction");
  assert.ok(/fracci/.test(buy.text),"fractional buy must say so");
  p=G.plan({...input([{...pricey,noFractions:true}]),config:cfg,cashEur:450,peakValueEur:500,lockedValueEur:50});
  assert.equal(p.actions.filter(x=>x.type==="BUY").length,0,"stock without fractions cannot be bought below one share");
  p=G.plan({...input([pricey]),config:{...cfg,investCapEur:80},cashEur:450,peakValueEur:500,lockedValueEur:50});
  buy=p.actions.find(x=>x.type==="BUY");
  assert.ok(buy&&buy.ticketEur+1<=80.01,"capital cap must limit the ticket");
  p=G.plan({...input([pricey]),config:{...cfg,investCapPct:0},cashEur:450,peakValueEur:500,lockedValueEur:50});
  assert.equal(p.whyNoBuy[0]&&p.whyNoBuy[0].code,"cap","zero capital must be reported as the cap");
  // Lo apartado al guardar el límite se respeta aunque baje el efectivo (las compras gastan del capital permitido).
  p=G.plan({...input([pricey]),config:{...cfg,investCapEur:100,investReserveEur:150},cashEur:160,peakValueEur:250,lockedValueEur:90});
  assert.equal(p.reservedEur,150,"saved reserve must stay apart");
  assert.ok(p.investableEur<=10.01,"only cash above the reserve can be invested");
  // Valor sin fracciones y capital que no llega a una acción entera: el motivo es el límite.
  p=G.plan({...input([{...pricey,noFractions:true}]),config:{...cfg,investCapEur:80},cashEur:450,peakValueEur:500,lockedValueEur:50});
  assert.equal(p.whyNoBuy[0]&&p.whyNoBuy[0].code,"cap","whole-share candidate above the cap must report the cap");
}

// Mi cripto: cuenta en el progreso y el ritmo, pero no cambia las compras de acciones.
{
  const cfg={...input([]).config,target:2000,startValue:1000};
  const a=G.plan({...input([base]),config:cfg,cashEur:1000,peakValueEur:1000});
  const b=G.plan({...input([base]),config:cfg,cashEur:1000,peakValueEur:1000,extraValueEur:500});
  assert.ok(b.pace.progressPct>a.pace.progressPct,"crypto value must raise goal progress");
  assert.equal(b.extraValueEur,500);
  assert.equal(b.valueEur,a.valueEur,"crypto must not enter the stock portfolio value");
  const ticket=p=>p.actions.filter(x=>x.type==="BUY").map(x=>x.ticketEur).join(",");
  assert.equal(ticket(b),ticket(a),"crypto must not change stock buy sizes");
  assert.equal(b.defensive,a.defensive);
}

// Memoria del plan: con candidatas casi empatadas se mantiene la compra ya recomendada.
{
  const rows=[0,1,2].map(i=>({...base,key:"NASDAQ:S"+i,ticker:"S"+i,score:94-i,quality:92-i}));
  const buys=p=>p.actions.filter(x=>x.type==="BUY").map(x=>x.key);
  const fresh=G.plan(input(rows));
  assert.ok(!buys(fresh).includes("NASDAQ:S2"),"without memory the lowest-ranked tie is not bought");
  const kept=G.plan({...input(rows),stickyKeys:["NASDAQ:S2"]});
  assert.ok(buys(kept).includes("NASDAQ:S2"),"a recently recommended buy must survive a near tie");
  const strong={...base,key:"NASDAQ:NEW",ticker:"NEW",score:99,quality:95};
  const weak={...base,key:"NASDAQ:OLDBUY",ticker:"OLDBUY",score:55,quality:70,relVolume:.6,perfWeek:0,dayChangePct:0,catalystDays:null,catalystImpact:0};
  const swap=G.plan({...input([strong,weak]),stickyKeys:["NASDAQ:OLDBUY"]});
  assert.ok(buys(swap).includes("NASDAQ:NEW"),"a clearly better candidate still replaces the remembered one");
}

// IA con dudas: la idea no se compra; queda en ESPERAR.
{
  const p=G.plan(input([{...base,aiVerdict:"dudas"}]));
  assert.equal(p.actions.filter(x=>x.type==="BUY").length,0,"an idea the AI doubts must not be bought");
  assert.ok(p.waits.some(w=>w.key===base.key&&/dudas/.test(w.text)),"a doubted idea should stay visible as a wait");
}

// Empate total: el resultado no depende del orden de entrada.
{
  const rows=["ZZZ","AAA","MMM"].map(t=>({...base,key:"NASDAQ:"+t,ticker:t}));
  const buys=p=>p.actions.filter(x=>x.type==="BUY").map(x=>x.key).join(",");
  assert.equal(buys(G.plan(input(rows))),buys(G.plan(input([...rows].reverse()))),"ties must resolve the same regardless of input order");
  const backed=rows.map(r=>r.ticker==="ZZZ"?{...r,aiVerdict:"respalda"}:r);
  assert.ok(buys(G.plan(input(backed))).includes("NASDAQ:ZZZ"),"on a tie the AI-backed idea goes first");
}

// Sin efectivo y todo en «mantener»: plan en pausa (sin candidatas ni IA); con efectivo o sin decisión, no.
{
  const held={key:"NASDAQ:H",ticker:"H",name:"H",units:3,avgEur:8,priceEur:7.5,bidEur:7.5,score:50,quality:70,atrPct:2,feeEur:1,hold:{mode:"recover",targetEur:8.02}};
  assert.equal(G.isIdle({config:{},cashEur:0,positions:[held]}),true);
  assert.equal(G.isIdle({config:{},cashEur:200,positions:[held]}),false,"cash to invest is not idle");
  assert.equal(G.isIdle({config:{investReserveEur:200},cashEur:200,positions:[held]}),true,"reserved cash is not investable");
  assert.equal(G.isIdle({config:{},cashEur:0,positions:[{...held,hold:{mode:"better"}}]}),false,"«cambio mejor» keeps looking");
  assert.equal(G.isIdle({config:{},cashEur:0,positions:[{...held,hold:null}]}),false,"a position without a decision can rotate");
  const p=G.plan({...input([]),positions:[held],cashEur:0});
  assert.equal(p.whyNoBuy[0]&&p.whyNoBuy[0].code,"idle");
}

// Idea fijada: se mantiene aunque aparezca otra mejor o empeore la entrada; se retira si el precio se aleja o la IA la contradice.
{
  const weak={...base,key:"NASDAQ:FIX",ticker:"FIX",score:60,quality:70,relVolume:.6,perfWeek:0,dayChangePct:0,catalystDays:null,catalystImpact:0};
  const strong={...base,key:"NASDAQ:NEW",ticker:"NEW",score:99,quality:95};
  const committed=[{key:"NASDAQ:FIX",priceEur:10,at:"2026-10-28T09:00:00Z"}];
  const buys=p=>p.actions.filter(x=>x.type==="BUY").map(x=>x.key);
  let p=G.plan({...input([strong,weak]),committed});
  assert.equal(buys(p)[0],"NASDAQ:FIX","a fixed idea is kept and goes first; a new one only uses the cash left");
  assert.equal(p.actions.find(x=>x.type==="BUY").committed,true);
  p=G.plan({...input([strong,{...weak,quoteFresh:false,aiVerdict:"dudas"}]),committed});
  assert.equal(buys(p)[0],"NASDAQ:FIX","a stale quote or a later doubt does not flip a fixed idea");
  p=G.plan({...input([strong,{...weak,askEur:10.5,priceEur:10.5}]),committed});
  assert.ok(!buys(p).includes("NASDAQ:FIX"),"a fixed idea is not chased after +5 %");
  assert.ok(p.waits.some(w=>w.key==="NASDAQ:FIX"&&w.decision==="COMPRA LÍMITE"),"a chased idea stays as a limit order");
  p=G.plan({...input([strong,{...weak,aiVerdict:"contradice"}]),committed:[{...committed[0],ticketEur:400}]});
  assert.ok(!buys(p).includes("NASDAQ:FIX")&&p.actions.some(a=>a.type==="CHANGE"&&a.key==="NASDAQ:FIX"),"an AI contradiction becomes a change of recommendation");
  assert.ok(p.commitments.some(c=>c.key==="NASDAQ:FIX"&&c.changed),"its cash stays reserved until discarded");
  p=G.plan({...input([strong,{...weak,aiVerdict:"contradice"}]),committed:[{...committed[0],ticketEur:400}],discarded:["NASDAQ:FIX"]});
  assert.ok(!p.actions.some(a=>a.type==="CHANGE")&&p.consumedCommitments.some(c=>c.key==="NASDAQ:FIX"&&c.reason==="discarded"),"discarding frees it");
  p=G.plan({...input([strong]),positions:[{key:"NASDAQ:FIX",ticker:"FIX",name:"Fix",units:5,avgEur:10,priceEur:10,bidEur:10,score:60,quality:70,atrPct:2,feeEur:1}],committed});
  assert.ok(buys(p).includes("NASDAQ:NEW"),"once the fixed idea is bought, new ideas can appear");
}

// Filtro antes de publicar: resultados, analistas, mercado y revisión del servidor.
{
  const buys=p=>p.actions.filter(x=>x.type==="BUY").map(x=>x.key).join();
  assert.equal(buys(G.plan(input([{...base,earningsDays:2,earningsDate:"2026-10-30"}]))),"","no new idea two days before earnings");
  assert.ok(G.plan(input([{...base,earningsDays:2}])).waits.some(w=>/resultados/.test(w.text)),"earnings wait explains why");
  assert.equal(buys(G.plan(input([{...base,analystConsensus:"sell"}]))),"","consensus sell blocks");
  assert.equal(buys(G.plan(input([{...base,downgradeDays:3}]))),"","recent downgrade blocks");
  const m=G.plan({...input([base]),market:{blocked:true,reason:"VIX en 34"}});
  assert.equal(buys(m),"","market stress blocks new ideas");
  assert.equal(m.whyNoBuy[0]&&m.whyNoBuy[0].code,"market");
  const r=G.plan({...input([base]),requireReview:true});
  assert.equal(buys(r),"","the app never publishes an unreviewed idea");
  assert.ok(r.waits.some(w=>w.decision==="EN REVISIÓN"),"unreviewed idea shows as under review");
  const ok=G.plan(input([{...base,earningsDays:20,analystConsensus:"buy",analystUpsidePct:20,epsBeats:4}]));
  const buy=ok.actions.find(x=>x.type==="BUY");
  assert.ok(buy&&buy.riskEur>0&&buy.pros.length,"a published idea carries its risk in € and its reasons");
  const half=G.plan(input([{...base,lossMaking:true,valuationTone:"high"}])).actions.find(x=>x.type==="BUY");
  if(half&&buy)assert.ok(half.ticketEur<buy.ticketEur,"expensive and loss-making halves the size");
}
// Estabilidad: el mismo escenario con ruido pequeño en los datos durante 30 «refrescos» publica siempre la misma idea.
{
  const rows=[0,1,2,3].map(i=>({...base,key:"NASDAQ:Z"+i,ticker:"Z"+i,score:94-i,quality:92-i}));
  let committed=[];const seen=new Set();
  for(let t=0;t<30;t++){
    const noisy=rows.map((r,i)=>({...r,relVolume:r.relVolume*(1+Math.sin(t+i)*.08),dayChangePct:r.dayChangePct+Math.cos(t*2+i)*.6,askEur:r.askEur*(1+Math.sin(t*3+i)*.004)}));
    const p=G.plan({...input(noisy),committed});
    const k=p.actions.filter(x=>x.type==="BUY").map(x=>x.key);
    for(const x of k)seen.add(x);
    if(!committed.length&&k.length)committed=p.actions.filter(x=>x.type==="BUY").map(x=>({key:x.key,priceEur:x.priceEur,at:"2026-10-28T09:00:00Z"}));
  }
  assert.ok(seen.size<=2,"noise must not rotate ideas ("+[...seen].join()+")");
}

// Órdenes límite: con importe para acciones enteras se proponen enteras con límite; fracción solo si no llega a una.
{
  const p=G.plan({...input([{...base,priceEur:20,askEur:20}]),cashEur:1000});
  const buy=p.actions.find(x=>x.type==="BUY");
  assert.ok(buy&&buy.orderType==="LIMIT"&&Number.isInteger(buy.units)&&buy.limitPriceEur>=20,"whole shares with a limit order when affordable");
  const q=G.plan({...input([{...base,priceEur:900,askEur:900}]),cashEur:1000});
  const f=q.actions.find(x=>x.type==="BUY");
  if(f)assert.ok(f.units<1&&f.limitPriceEur>=900,"a fraction only when one whole share does not fit, still with a limit price");
}

// Revisión de Codex: el límite se mantiene, una fase «avoid» no borra la idea y las fijadas se guardan siempre.
{
  const weak={...base,key:"NASDAQ:FIX",ticker:"FIX",score:60,quality:70};
  const strong={...base,key:"NASDAQ:NEW",ticker:"NEW",score:99,quality:95};
  const buys=p=>p.actions.filter(x=>x.type==="BUY").map(x=>x.key).join();
  let p=G.plan({...input([strong,{...weak,askEur:10.2,priceEur:10.2}]),committed:[{key:"NASDAQ:FIX",priceEur:10,at:"t",limited:true}]});
  assert.ok(!buys(p).includes("NASDAQ:FIX"),"after +3 % the limit holds until the price is back at the limit");
  assert.ok(p.commitments.some(c=>c.key==="NASDAQ:FIX"&&c.limited),"limit state is carried forward");
  p=G.plan({...input([strong,{...weak,askEur:10.05,priceEur:10.05}]),committed:[{key:"NASDAQ:FIX",priceEur:10,at:"t",limited:true}]});
  assert.ok(buys(p).startsWith("NASDAQ:FIX"),"back at the limit it can be bought again");
  p=G.plan({...input([strong,{...weak,aiScoutPhase:"avoid"}]),committed:[{key:"NASDAQ:FIX",priceEur:10,at:"t"}]});
  assert.ok(buys(p).startsWith("NASDAQ:FIX")&&p.commitments.some(c=>c.key==="NASDAQ:FIX"),"an avoid phase does not replace a fixed idea");
  p=G.plan({...input([strong,weak]),cashEur:0,committed:[{key:"NASDAQ:FIX",priceEur:10,at:"t"}]});
  assert.ok(p.commitments.some(c=>c.key==="NASDAQ:FIX"),"a fixed idea is kept even when no action is emitted");
  p=G.plan({...input([strong]),positions:[{key:"NASDAQ:FIX",ticker:"FIX",name:"Fix",units:5,avgEur:10,priceEur:10,bidEur:10,score:60,quality:70,atrPct:2,feeEur:1}],committed:[{key:"NASDAQ:FIX",priceEur:10,at:"t"}]});
  assert.ok(p.consumedCommitments.some(c=>c.key==="NASDAQ:FIX"&&c.reason==="bought"),"a bought idea is consumed");
}

// Ideas ligadas al efectivo del objetivo: lo reservado por una idea en espera no se gasta en otra.
{
  const a={...base,key:"NASDAQ:A",ticker:"A"},nb={...base,key:"NASDAQ:B",ticker:"B",score:99,quality:95};
  const buys=p=>p.actions.filter(x=>x.type==="BUY").map(x=>x.key);
  const free=G.plan({...input([nb]),cashEur:300}).actions.find(x=>x.type==="BUY");
  const held=G.plan({...input([{...a,askEur:12,priceEur:12},nb]),cashEur:300,committed:[{key:"NASDAQ:A",priceEur:10,at:"t",ticketEur:250}]});
  const b=held.actions.find(x=>x.type==="BUY"&&x.key==="NASDAQ:B");
  assert.ok(!buys(held).includes("NASDAQ:A"),"the fixed idea is waiting at its limit");
  assert.ok(!b||!free||b.ticketEur<free.ticketEur,"the new idea only uses cash not reserved by the waiting one");
}

// Recorrido previsto realista: nunca más de 1,5 × el movimiento típico de 5 sesiones (ATR × √5).
{
  const calm={...base,key:"NYSE:EAT",ticker:"EAT",atrPct:4.6};
  const p=G.plan(input([calm])),b=p.actions.find(x=>x.type==="BUY");
  assert.ok(b,"a calm stock with a clean setup can still be bought");
  assert.ok(b.targetPct<=4.6*Math.sqrt(5)*1.5+0.01,"target is capped by the typical 5-session move");
  assert.ok(Math.abs(b.moveRangePct-4.6*Math.sqrt(5))<0.02,"the typical 5-session move is reported");
}
// Resultados hoy de una idea fijada sin comprar: pasa a cambio de recomendación y no se propone comprar.
{
  const fixed={...base,key:"NYSE:EAT",ticker:"EAT",earningsDays:0,earningsDate:"2026-10-06"};
  const p=G.plan({...input([fixed]),committed:[{key:"NYSE:EAT",priceEur:10,at:"t",ticketEur:120}]});
  const ch=p.actions.find(x=>x.type==="CHANGE");
  assert.ok(ch&&/resultados hoy/.test(ch.reason),"earnings today turn a fixed idea into a recommendation change");
  assert.ok(!p.actions.some(x=>x.type==="BUY"&&x.key==="NYSE:EAT"),"no buy is proposed right before earnings");
  const fresh=G.plan(input([{...fixed,key:"NYSE:NEW",ticker:"NEW"}]));
  assert.ok(!fresh.actions.some(x=>x.type==="BUY"),"a new idea is not published right before earnings");
}

// Idea fijada sin cotización real ahora (solo el último precio): no se compra, se ve como espera fijada y aun así
// puede pasar a cambio de recomendación.
{
  const noQuote={...base,key:"NYSE:EAT",ticker:"EAT",priceFallback:true,quoteFresh:false};
  let p=G.plan({...input([noQuote]),committed:[{key:"NYSE:EAT",priceEur:10,at:"t",ticketEur:120}]});
  assert.ok(!p.actions.some(x=>x.type==="BUY"),"no buy with only the last known price");
  const w=p.waits.find(x=>x.key==="NYSE:EAT");
  assert.ok(w&&w.committed&&/no hay cotización en vivo/.test(w.text),"the fixed idea stays visible waiting for a quote");
  p=G.plan({...input([{...noQuote,earningsDays:0}]),committed:[{key:"NYSE:EAT",priceEur:10,at:"t",ticketEur:120}]});
  assert.ok(p.actions.some(x=>x.type==="CHANGE"&&x.key==="NYSE:EAT"),"earnings still turn it into a recommendation change");
  p=G.plan({...input([{...noQuote,priceEur:5,askEur:5}]),committed:[{key:"NYSE:EAT",priceEur:10,at:"t",ticketEur:120}]});
  assert.ok(!p.actions.some(x=>x.type==="CHANGE"),"a stale last price never triggers the stop-based change");
}

// Un cambio de recomendación ya mostrado hoy se mantiene aunque la revisión actual no traiga sus datos.
{
  const fx={...base,key:"NYSE:EAT",ticker:"EAT",priceFallback:true,quoteFresh:false};
  const p=G.plan({...input([fx]),committed:[{key:"NYSE:EAT",priceEur:10,at:"t",ticketEur:120,changed:"rebaja de analistas hace 2 días"}]});
  const ch=p.actions.find(x=>x.type==="CHANGE");
  assert.ok(ch&&/rebaja/.test(ch.reason),"a persisted change stays a change for the day");
  assert.ok(!p.waits.some(x=>x.key==="NYSE:EAT"),"it does not become an ordinary wait again");
}
// Modo defensivo: la idea fijada sigue visible como espera (no desaparece).
{
  const fx={...base,key:"NYSE:EAT",ticker:"EAT"};
  const p=G.plan({...input([fx]),committed:[{key:"NYSE:EAT",priceEur:10,at:"t",ticketEur:120}],peakValueEur:5000,wasDefensive:true});
  assert.equal(p.defensive,true,"fixture is in defensive mode");
  const w=p.waits.find(x=>x.key==="NYSE:EAT");
  assert.ok(w&&w.committed&&/modo defensivo/.test(w.text),"the fixed idea stays visible in defensive mode");
  assert.ok(!p.actions.some(x=>x.type==="BUY"),"no buy in defensive mode");
}

// Otras opciones: informativas, ordenadas por puntuación y sin repetir lo que ya se propone.
{
  const a1={...base,key:"NASDAQ:A1",ticker:"A1",earningsDays:2},a2={...base,key:"NASDAQ:A2",ticker:"A2",score:80,quality:80,quoteFresh:false},a3={...base,key:"NASDAQ:A3",ticker:"A3"};
  const p=G.plan(input([a1,a2,a3]));
  const alts=p.alternatives||[];
  assert.ok(alts.length>=1&&alts.every(x=>x.status),"alternatives carry a status");
  for(let i=1;i<alts.length;i++)assert.ok(alts[i-1].burstScore>=alts[i].burstScore,"alternatives are ordered by score");
  const proposed=new Set(p.actions.map(x=>x.key));
  assert.ok(alts.every(x=>!proposed.has(x.key)),"alternatives never repeat a proposed buy");
}

// «Por qué no hay compras» solo culpa a la subida cuando todas las esperas visibles son de orden límite.
{
  const ext={...base,key:"NASDAQ:EXT2",ticker:"EXT2",technicalPrice:10.8,priceEur:10.8,askEur:10.8,ema20:10,extensionPct:8,dayChangePct:5,perfWeek:10,rsi:64};
  const old={...base,key:"NASDAQ:OLD",ticker:"OLD",quoteFresh:false};
  const p=G.plan(input([ext,old]));
  if(p.waits.some(w=>w.decision==='COMPRA LÍMITE')&&p.waits.some(w=>w.decision!=='COMPRA LÍMITE'))assert.ok(!p.whyNoBuy.some(w=>w.code==='limit'),"mixed reasons do not use the limit-only explanation");
}

// Etiquetas de riesgo, límite de exposición de alto riesgo y mezcla de riesgos.
{
  assert.equal(G.riskTier({atrPct:7,marketCap:5e9}),"alto","very volatile is high risk");
  assert.equal(G.riskTier({atrPct:3,marketCap:1e9,industry:"Biotechnology"}),"alto","small biotech is high risk");
  assert.equal(G.riskTier({atrPct:2,marketCap:5e10}),"bajo","calm large cap is low risk");
  assert.equal(G.riskTier({atrPct:4,marketCap:5e9}),"medio");
  const hi={...base,key:"NASDAQ:BIO",ticker:"BIO",marketCap:5e8,industry:"Biotechnology",score:95};
  const mid={...base,key:"NYSE:MID",ticker:"MID",marketCap:5e9,score:85,quality:85};
  let p=G.plan(input([hi,mid]));
  const buys=p.actions.filter(x=>x.type==="BUY");
  assert.ok(buys.some(b=>b.riskTier==="alto")&&buys.some(b=>b.riskTier!=="alto"),"one high-risk and one lower-risk idea are proposed together");
  const hiBuy=buys.find(b=>b.riskTier==="alto");
  assert.ok(hiBuy.ticketEur<=1000*0.30+0.01,"high-risk exposure stays within 30 % of the goal value");
  // Lo congelado de riesgo alto también cuenta: con 300 € congelados de riesgo alto y un 30 % de 1.000 € no cabe más.
  p=G.plan({...input([hi]),lockedHighRiskEur:300});
  assert.ok(!p.actions.some(x=>x.type==="BUY"&&x.riskTier==="alto"),"frozen high-risk holdings count toward the cap");
  p=G.plan({...input([hi]),config:{...input([]).config,highRiskPct:0}});
  assert.ok(!p.actions.some(x=>x.type==="BUY"),"with 0 % allowed for high risk no high-risk idea is bought");
}
// Tendencia 1-3 meses: momento de 6 meses sin el último, sin volatilidad extrema ni lejos de máximos.
{
  const st=[
    {key:"A",ticker:"A",price:50,perf6M:40,perfMonth:5,high52w:52,marketCap:2e9,atrPct:3,tradedUsd:5e6},
    {key:"B",ticker:"B",price:20,perf6M:80,perfMonth:2,high52w:21,marketCap:1e9,atrPct:12,tradedUsd:5e6},
    {key:"C",ticker:"C",price:10,perf6M:30,perfMonth:1,high52w:20,marketCap:1e9,atrPct:3,tradedUsd:5e6},
    {key:"D",ticker:"D",price:30,perf6M:20,perfMonth:0,high52w:31,marketCap:1e9,atrPct:3,tradedUsd:5e6},
    {key:"E",ticker:"E",price:30,perf6M:90,perfMonth:0,high52w:31,marketCap:1e8,atrPct:3,tradedUsd:5e6}
  ];
  const t=G.trendIdeas(st,{limit:5});
  assert.equal(t.map(x=>x.key).join(","),"A,D","ranked by 6-1 momentum; extreme volatility, far from high and tiny caps excluded");
  assert.ok(t[0].riskTier,"trend ideas carry a risk tier");
  const many=Array.from({length:8},(_,i)=>({key:"H"+i,ticker:"H"+i,price:20,perf6M:200-i,perfMonth:0,high52w:21,marketCap:5e8,industry:"Biotechnology",atrPct:5,tradedUsd:5e6}))
    .concat(Array.from({length:4},(_,i)=>({key:"M"+i,ticker:"M"+i,price:20,perf6M:50-i,perfMonth:0,high52w:21,marketCap:5e9,atrPct:3,tradedUsd:5e6})));
  const mixed=G.trendIdeas(many,{limit:5});
  assert.equal(mixed.filter(x=>x.riskTier==="alto").length,2,"at most 2 of 5 trend ideas are high risk when others exist");
}

// Huchas: el plan de ideas cortas solo gasta el efectivo de la hucha de riesgo alto y sin el límite fijo del 30 %.
{
  const hi={...base,key:"NASDAQ:HI",ticker:"HI",atrPct:7,marketCap:2e8};
  let p=G.plan({...input([hi]),sleeves:{alto:{cashEur:120}}});
  const buy=p.actions.find(a=>a.type==="BUY");
  assert.ok(buy,"sleeve mode buys from the high-risk sleeve");
  assert.ok(buy.ticketEur+1<=120+1e-6,"ticket plus fee fits the high sleeve cash");
  p=G.plan({...input([hi]),sleeves:{alto:{cashEur:0}}});
  assert.ok(!p.actions.some(a=>a.type==="BUY"),"no buys when the high sleeve is empty");
  assert.equal(p.whyNoBuy[0].code,"sleeve","explains that the high sleeve has no cash");
  p=G.plan({...input([hi]),sleeves:{alto:{cashEur:900}},config:{...input([]).config,highRiskPct:0}});
  assert.ok(p.actions.some(a=>a.type==="BUY"),"the fixed high-risk cap does not apply with sleeves");
}
// Calidad (hucha baja): grandes, rentables, PER razonable, poca volatilidad; orden por rentabilidad del beneficio + margen.
{
  const st=[
    {key:"Q1",ticker:"Q1",price:100,marketCap:5e10,revenueTtm:1e10,netIncomeTtm:2e9,enterpriseValue:4e10,peRatio:20,atrPct:1.5,high52w:110,perf6M:5},
    {key:"Q2",ticker:"Q2",price:100,marketCap:5e10,revenueTtm:1e10,netIncomeTtm:1e9,enterpriseValue:5e10,peRatio:30,atrPct:1.5,high52w:105,perf6M:5},
    {key:"LOSS",ticker:"LOSS",price:100,marketCap:5e10,revenueTtm:1e10,netIncomeTtm:-1e9,enterpriseValue:5e10,atrPct:1.5,high52w:105},
    {key:"SMALL",ticker:"SMALL",price:100,marketCap:5e9,revenueTtm:1e9,netIncomeTtm:3e8,enterpriseValue:4e9,peRatio:15,atrPct:1.5,high52w:105},
    {key:"PRICY",ticker:"PRICY",price:100,marketCap:5e10,revenueTtm:1e10,netIncomeTtm:1e9,enterpriseValue:5e10,peRatio:60,atrPct:1.5,high52w:105},
    {key:"FALL",ticker:"FALL",price:60,marketCap:5e10,revenueTtm:1e10,netIncomeTtm:2e9,enterpriseValue:4e10,peRatio:12,atrPct:1.5,high52w:100,perf6M:-30}
  ];
  const q=G.qualityIdeas(st,{limit:5});
  assert.equal(q.map(x=>x.key).join(","),"Q1,Q2","quality keeps large, profitable, fairly priced, steady stocks");
  assert.equal(q[0].netMarginPct,20);
  assert.equal(q[0].earningsYieldPct,5);
  assert.equal(G.INDEX_ETFS.length,2);
  const withRoic=G.qualityIdeas([
    {...st[0],key:"R1",roicPct:30,debtToEquity:.5,freeCashFlow:1e9},
    {...st[0],key:"R2",roicPct:5},
    {...st[0],key:"R3",debtToEquity:3},
    {...st[0],key:"R4",freeCashFlow:-1},
    {...st[1],key:"R5",roicPct:12}
  ]);
  assert.equal(withRoic.map(x=>x.key).join(","),"R1,R5","ROIC below 10 %, high debt or negative free cash flow are excluded");
  assert.equal(withRoic[0].returnBasis,"roic");
}
// Tamaño por hucha: reparte el efectivo libre con un mínimo por compra; fracciones o acciones enteras.
{
  const ideas=[{key:"A",ticker:"A",priceEur:40},{key:"B",ticker:"B",priceEur:250},{key:"C",ticker:"C",priceEur:10}];
  let z=G.sleeveSizing(ideas,{cashEur:200,minTicketEur:90,slots:3,allowFractions:false});
  assert.equal(z.count,2,"200 € with a 90 € minimum (+1 € fee) gives two buys");
  assert.equal(z.ideas[0].units,2,"whole shares that fit 99 €");
  assert.equal(z.ideas[1].fits,false,"a 250 € share does not fit a 99 € ticket without fractions");
  z=G.sleeveSizing(ideas,{cashEur:200,minTicketEur:90,slots:3,allowFractions:true});
  assert.ok(z.ideas[1].fractional&&z.ideas[1].fits,"fractions allow the expensive share");
  z=G.sleeveSizing(ideas,{cashEur:50,minTicketEur:90,slots:3});
  assert.equal(z.count,0);assert.equal(z.reason,"cash");
  // Acciones enteras que no caben: se descartan y el efectivo se reparte entre las que sí.
  z=G.sleeveSizing([{key:"X",ticker:"X",priceEur:250},{key:"Y",ticker:"Y",priceEur:250}],{cashEur:200,minTicketEur:90,slots:3,allowFractions:false});
  assert.equal(z.count,0,"two 250 € shares do not fit 200 € without fractions");assert.equal(z.reason,"price");
  z=G.sleeveSizing([{key:"X",ticker:"X",priceEur:150},{key:"C",ticker:"C",priceEur:10}],{cashEur:200,minTicketEur:90,slots:3,allowFractions:false});
  assert.equal(z.count,1);assert.equal(z.ideas[1].units,19,"the viable idea gets the whole 199 €, not half");
}

console.log("Goal engine tests: OK");
