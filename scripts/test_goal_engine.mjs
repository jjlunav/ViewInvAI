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
  priceEur:10,askEur:10,atrPct:2,feeEur:1,relVolume:2,rsi:58,adx:24,technicalPrice:10,
  ema20:9.8,ema50:9.5,perfWeek:5,spreadPct:.5,avgVolume:1_000_000,extensionPct:2,nearHighPct:1,
  dayChangePct:2,catalystDays:2,catalystImpact:80
};
const input=candidates=>({
  config:{target:1500,deadline:"2026-11-30T23:59:59Z",startValue:1000,startDate:"2026-10-01",risk:"aggressive",maxPositions:5,allowSpec:true},
  positions:[],candidates,cashEur:1000,peakValueEur:1000,wasDefensive:false,nowMs:Date.parse("2026-10-06T12:00:00Z")
});

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
  const pricey={...base,key:"LSX:FJE",ticker:"FJE",priceEur:58,askEur:58,technicalPrice:58,ema20:56.8,ema50:55};
  const p=G.plan({...input([pricey]),config:{...input([]).config,target:500,startValue:197},cashEur:197,peakValueEur:197});
  assert.equal(p.actions.filter(x=>x.type==="BUY").length,1,"small account must still buy one share it can afford");
}

console.log("Goal engine tests: OK");
