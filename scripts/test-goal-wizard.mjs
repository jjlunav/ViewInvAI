import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../portfolio.js',import.meta.url),'utf8');
const engine=fs.readFileSync(new URL('../goal-engine.js',import.meta.url),'utf8');
const now=Date.parse('2026-10-29T23:59:59Z');
class Clock extends Date {static now(){return now}}
const original={target_value_eur:1000,risk_profile:'conservative',max_positions:4,allow_spec:0,invest_cap_eur:100,invest_cap_pct:null,invest_reserve_eur:100,allow_fractions:0,target_date:'2026-11-28'};
const element={hidden:true,innerHTML:''},handlers={};let requests=0,saved,refreshed=0;const bodies=[];
const context={Date:Clock,console,Math,Number,String,Array,Object,Set,Map,JSON,
 num:v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null,
 formatNumber:(v,d=1)=>Number(v).toFixed(d),formatMoney:v=>Number(v).toFixed(2)+' EUR',esc:v=>String(v).replaceAll('<','&lt;'),
 state:{goals:{},goal:original},selectedPortfolioGoal:()=>original,
 portfolioGoalMetrics:()=>({portfolio:{id:'p',name:'Test'},investedValue:1200,cashEur:200}),
 goalCryptoValueEur:()=>null,goalIncludesCrypto:()=>false,goalNoFractionSet:()=>new Set(),
 paintGoalWizard:()=>{},goalWizardCapChanged:()=>false,goalWizardUsable:()=>100,goalWizardMsg:e=>{throw new Error(e)},
 toast:()=>{},renderGoalApp:()=>refreshed++,
 api:async(path,init)=>{requests++;assert.equal(path,'/api/portfolio-goal');assert.equal(init.method,'PATCH');saved=JSON.parse(init.body);bodies.push(saved);return{ok:true,json:async()=>({goal:{...original,target_value_eur:saved.targetValueEur??original.target_value_eur}})}},
 portfolioCoachPositionRows:()=>[{p:{id:'pos1',ticker:'SPRO',sleeve:''},stock:{name:'Spero'},qty:10,unitEur:2}],positionFrozenQty:()=>0,loadAll:async()=>{},
 document:{getElementById:()=>element,querySelector:()=>null,body:{classList:{add:()=>{},remove:()=>{}}},addEventListener:(name,fn)=>handlers[name]=fn},window:{}};
vm.createContext(context);vm.runInContext(engine,context);context.window.ViewInvAIGoal=context.ViewInvAIGoal;
// Execute the actual wizard and save functions without starting the whole application.
vm.runInContext(source.slice(source.indexOf('// ----- Huchas del Objetivo'),source.indexOf('function goalSleeveOperationNote(')),context);
vm.runInContext(source.slice(source.indexOf('function goalSleeveOptions('),source.indexOf('// Repartir el efectivo entre las huchas')),context);
vm.runInContext(source.slice(source.indexOf('let goalWizard=null;'),source.indexOf('function goalWizardChoice(')),context);
vm.runInContext(source.slice(source.indexOf('function goalWizardDemandHtml('),source.indexOf('function goalWizardStepHtml(')),context);
vm.runInContext(source.slice(source.indexOf('function goalRenewalHtml('),source.indexOf('function goalPaceHtml(')),context);
assert.ok(context.goalRenewalHtml({pace:{status:'reached'},nextTargetEur:1500}).includes('data-goal-extend'));
assert.ok(context.goalRenewalHtml({pace:{status:'reached'},nextTargetEur:null}).includes('Revisar objetivo'));
assert.equal(context.goalRenewalHtml({pace:{status:'on'},nextTargetEur:null}),'');
const start=source.indexOf('async function saveGoalWizard('),click=source.indexOf('document.addEventListener("click",event=>{',start),input=source.indexOf('document.addEventListener("input",event=>{',click);
vm.runInContext(source.slice(start,click),context);vm.runInContext(source.slice(click,input),context);
const openButton={hasAttribute:name=>name==='data-goal-extend'};
handlers.click({preventDefault:()=>{},target:{closest:selector=>selector==='[data-goal-wizard]'?openButton:null}});
let wizard=vm.runInContext('goalWizard',context);
assert.equal(wizard.v.target,1500,'Offer a larger goal based on the current 1200, not the old target');
assert.equal(wizard.v.date,'','A completed goal requires reviewing a fresh deadline');
assert.equal(wizard.v.risk,'conservative');assert.equal(wizard.v.capEur,100);assert.equal(wizard.v.specMode,0);assert.equal(wizard.v.fractions,0);
assert.equal(requests,0,'Opening a proposal must not save a new target or change the profile');assert.equal(original.target_value_eur,1000);
const short=context.goalWizardDemandHtml({target:1500,date:'2026-11-28',risk:'conservative'},1000);
assert.ok(short.includes('50.0 % cada 30 días'));assert.ok(short.includes('Perfil Bajo'));assert.ok(short.includes('1.0 % de la cartera'));
assert.ok(short.includes('no aumenta automáticamente el riesgo'));assert.ok(short.includes('no una previsión'));
const long=context.goalWizardDemandHtml({target:1500,date:'2027-10-24',risk:'conservative'},1000);
assert.ok(!long.includes('50.0 % cada 30 días'));assert.ok(long.includes('1.0 % de la cartera'),'More time changes the hurdle, not the chosen risk budget');
assert.ok(!context.goalWizardDemandHtml({target:1500,date:'2026-11-28',risk:'aggressive'},0).includes('Infinity'));
wizard.v.date='2026-11-28';await context.saveGoalWizard();
assert.equal(requests,1);assert.equal(saved.targetValueEur,1500);assert.equal(saved.riskProfile,'conservative');assert.equal(saved.investCapEur,100);
assert.equal(saved.monthlyContributionEur,0);assert.equal(refreshed,1);assert.equal(element.hidden,true);
assert.equal(saved.investCapEur,100,'An existing goal keeps its capital limit unless the user picks sleeves');
// Huchas: el asistente guarda el objetivo sin límite de capital aparte y después el reparto, la estrategia y las acciones.
handlers.click({preventDefault:()=>{},target:{closest:selector=>selector==='[data-goal-wizard]'?{hasAttribute:()=>false}:null}});
wizard=vm.runInContext('goalWizard',context);
assert.equal(wizard.v.sleevesOn,0,'An existing goal without sleeves starts as a single plan');
assert.equal(wizard.posList[0].sleeve,'alto','Held positions default to the high-risk sleeve (bought by the short plan)');
wizard.v.sleevesOn=1;wizard.v.sl={alto:60,medio:40,bajo:100};wizard.v.strat.bajo='index';
await context.saveGoalWizard();
const goalBody=bodies[bodies.length-2],sleeveBody=bodies[bodies.length-1];
assert.equal(goalBody.investCapEur,null);assert.equal(goalBody.investReserveEur,null);
assert.deepEqual(sleeveBody.sleeves.cash,{alto:60,medio:40,bajo:100});assert.equal(sleeveBody.sleeves.strategies.bajo,'index');
assert.deepEqual(sleeveBody.sleeves.assign,[{positionId:'pos1',sleeve:'alto',valueEur:20}]);
console.log('Goal wizard: editable renewal, explicit save, deadline demand and preserved risk: OK');
