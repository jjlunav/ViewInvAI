const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const sunday=Date.parse('2026-09-27T15:40:00Z');
let clock=sunday;
class TestDate extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
const ctx={Date:TestDate,Intl,console,Map,WeakMap,Set,URL,CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail;}},
 setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,requestAnimationFrame:()=>1,
 location:{protocol:'https:',host:'test.invalid'},document:{hidden:false,documentElement:{dataset:{}},querySelectorAll:()=>[]},
 db:{meta:{updatedAt:'2026-09-27T14:00:00Z',eurUsd:1.1},stocks:[]},state:{session:'auto',preset:'broad',currentView:'home',entryMarket:'us'},
 N:v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null,
 E:v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),
 F:(v,n=2)=>v===null||v===undefined?'\u2014':Number(v).toLocaleString('es-ES',{minimumFractionDigits:n,maximumFractionDigits:n}),
 stockKey:s=>s.tvSymbol||s.ticker||'',stockByKey:key=>ctx.db.stocks.find(s=>s.tvSymbol===key),
 isinRef:()=>null,tickerRef:()=>null,eventIndexByRef:new Map(),stockEvents:()=>[],stockOpenAttrs:s=>' data-stock-key="'+s.tvSymbol+'"',favButton:()=>'<button class="fav-star">\u2606</button>',
 compactVol:v=>v??'\u2014',dispatchEvent:()=>{},matchMedia:()=>({matches:true})};
ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);
for(const file of ['market-session.js','market.js','stock-list.js','events.js','catalog.js','recommendation.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
const sample=()=>({tvSymbol:'NASDAQ:TEST',ticker:'TEST',name:'Example Instruments Inc.',exchange:'NASDAQ',price:100,changePct:-2,
 lastBarUpdateTime:Date.parse('2026-09-25T20:15:00-04:00')/1000,
 premarketPrice:101,premarketChangePct:1,premarketTime:Date.parse('2026-09-25T04:00:00-04:00')/1000,
 postmarketPrice:102,postmarketChangePct:2,postmarketTime:Date.parse('2026-09-25T16:00:00-04:00')/1000,
 trTicker:'TST',trExchange:'LSX',trIsin:'US0000000001',tradeRepublicTradable:true});
let passed=0;const check=(name,fn)=>{fn();passed++;console.log('PASS',name)};
const model=(s,time=clock)=>ctx.stockQuoteSessions(s,time);
check('Sunday chooses Friday POST, never older PRE',()=>{const m=model(sample());assert.equal(m.latest.session,'postmarket');assert.equal(m.latest.price,102);assert.equal(m.closed,true);assert.equal(m.extended.day,'2026-09-25')});
check('Monday before new PRE retains Friday POST',()=>{const m=model(sample(),Date.parse('2026-09-28T05:00:00-04:00'));assert.equal(m.latest.session,'postmarket');assert.equal(m.latest.day,'2026-09-25')});
check('Actual Monday PRE replaces Friday POST',()=>{let s=sample();s.premarketTime=Date.parse('2026-09-28T04:05:00-04:00');s.premarketPrice=103;const m=model(s,Date.parse('2026-09-28T05:00:00-04:00'));assert.equal(m.latest.session,'premarket');assert.equal(m.latest.price,103)});
check('Monday regular snapshot replaces same-day PRE',()=>{let s=sample();s.lastBarUpdateTime=Date.parse('2026-09-28T10:00:00-04:00');s.premarketTime=Date.parse('2026-09-28T04:05:00-04:00');assert.equal(model(s,Date.parse('2026-09-28T10:10:00-04:00')).latest.session,'regular')});
check('Later POST becomes latest after regular close',()=>{let s=sample();s.lastBarUpdateTime=Date.parse('2026-09-28T17:00:00-04:00');s.postmarketTime=Date.parse('2026-09-28T16:00:00-04:00');assert.equal(model(s,Date.parse('2026-09-28T17:10:00-04:00')).latest.session,'postmarket')});
check('Sunday download time does not refresh Friday trade',()=>{let s=sample();s.usLivePrice=100;s.usLiveTimestamp='Sep 25, 2026 4:00 PM ET';s.usLiveReceivedAt=clock;assert.equal(model(s).latest.price,102)});
check('Nasdaq extended secondary quote is retained',()=>{let s=sample();s.usLiveSecondary={price:104,changePct:4,timestamp:'Sep 25, 2026 7:59 PM ET',isRealTime:true};assert.equal(model(s).latest.price,104);assert.equal(model(s).regular.price,100)});
check('Future quote is not displayed',()=>{let s=sample();s.postmarketTime=Date.parse('2026-09-28T16:01:00-04:00');assert.equal(model(s).latest.session,'regular')});
check('Zero percentage is genuine, null stays null',()=>{let s=sample();s.postmarketChangePct=0;assert.equal(model(s).latest.change,0);s.postmarketChangePct=null;assert.equal(model(s).latest.change,null)});
check('Zero/negative prices are rejected',()=>{let s=sample();s.postmarketPrice=0;s.premarketPrice=-1;assert.equal(model(s).latest.price,100)});
check('No prices returns null instead of a fake zero',()=>{assert.equal(model({}).latest,null);assert.match(ctx.assetQuoteHtml({}),/Sin precio disponible/)});
check('Undated PRE is not declared more recent than dated POST',()=>{let s=sample();s.premarketTime=null;s.premarketPrice=500;assert.equal(model(s).latest.price,102)});
check('No artificial session order when all dates are unknown',()=>{let samples=[{price:100,session:'regular'},{price:110,session:'postmarket'}];let m=ctx.ViewInvAIMarketSession.selectUsQuoteSessions(samples,clock);assert.equal(m.latest.price,100);assert.equal(m.extended,null)});
check('Regular snapshot session date is not Sunday download date',()=>{let s=sample();delete s.lastBarUpdateTime;assert.equal(model(s).regular.day,'2026-09-25')});
check('Weekend POST timestamp is rejected',()=>{let s=sample();s.postmarketTime=Date.parse('2026-09-26T16:00:00-04:00');assert.equal(model(s).latest.session,'regular')});
check('Closing auction is REG, next minute is POST',()=>{assert.equal(ctx.ViewInvAIMarketSession.usQuoteSession(Date.parse('2026-09-25T16:00:00-04:00')),'regular');assert.equal(ctx.ViewInvAIMarketSession.usQuoteSession(Date.parse('2026-09-25T16:01:00-04:00')),'postmarket')});
check('2026 Thanksgiving holiday stays closed',()=>{assert.equal(ctx.ViewInvAIMarketSession.usSession(ctx.ViewInvAIMarketSession.zoneClock('America/New_York',new Date('2026-11-26T16:00:00Z'))),'previous')});
check('2026 Black Friday half-day closing auction',()=>{assert.equal(ctx.ViewInvAIMarketSession.usQuoteSession(Date.parse('2026-11-27T13:00:00-05:00')),'regular');assert.equal(ctx.ViewInvAIMarketSession.usQuoteSession(Date.parse('2026-11-27T13:01:00-05:00')),'postmarket')});
check('Summer and winter ET timestamps keep timezone',()=>{assert.equal(ctx.parseMarketTimestamp('Sep 25, 2026 4:00 PM ET'),Date.parse('2026-09-25T20:00:00Z'));assert.equal(ctx.parseMarketTimestamp('Jan 5, 2026 4:00 PM ET'),Date.parse('2026-01-05T21:00:00Z'))});
check('Midnight hour is zero, not twenty-four',()=>{assert.equal(ctx.ViewInvAIMarketSession.zoneClock('America/New_York',new Date('2026-09-28T04:00:00Z')).hour,'00')});
check('Repeated model reads reuse memoized result',()=>{let s=sample();assert.strictEqual(model(s),model(s))});
check('Changed quote invalidates model cache',()=>{let s=sample(),before=model(s);s.postmarketPrice=107;assert.notStrictEqual(model(s),before);assert.equal(model(s).latest.price,107)});
check('US snapshot is never claimed as LSX execution price',()=>{let s=sample();assert.equal(ctx.canonicalQuote(s,true).price,null);const html=ctx.assetQuoteHtml(s,true);assert.match(html,/EEUU; LSX sin dato/);assert.match(html,/\$100/);assert.match(html,/POST/)});
check('Real LSX quote stays EUR, US extended remains separate',()=>{let s=sample();s.trLivePrice=92;s.trLiveChangePct=1;s.trLiveLastAt=Date.parse('2026-09-25T22:00:00+02:00');const html=ctx.assetQuoteHtml(s,true);assert.match(html,/LSX/);assert.match(html,/\u20ac92/);assert.match(html,/POST/);assert.equal(ctx.canonicalQuote(s,true).price,92)});
check('Regular and extended prices and percentages have their own colors',()=>{let html=ctx.assetQuoteHtml(sample());assert.match(html,/class="negative"/);assert.match(html,/class="positive"/);assert.match(html,/asset-conversion/)});
check('Missing price response cannot redate the previous quote',()=>{let s=sample();s.usLivePrice=100;s.usLiveTimestamp='Sep 25, 2026 4:00 PM ET';ctx.usApplyQuote(s,{price:null,timestamp:'Sep 27, 2026 11:00 AM ET',changePct:0});assert.equal(s.usLiveTimestamp,'Sep 25, 2026 4:00 PM ET');assert.equal(model(s).latest.price,102)});
check('New price without change clears stale percentage',()=>{let s=sample();s.usLiveChangePct=80;ctx.usApplyQuote(s,{price:100,timestamp:'Sep 25, 2026 4:00 PM ET'});assert.equal(s.usLiveChangePct,null)});
check('General Radar uses the universal row and includes POST',()=>{const html=ctx.stockMobileRow(sample(),0,'previous',false,'entry');assert.match(html,/stock-card asset-row/);assert.match(html,/POST/);assert.doesNotMatch(html,/stock-mobile-identity/)});
check('Future and Radar share exact identity and quote template',()=>{let s=sample();ctx.db.stocks=[s];let future=ctx.eventMobileRow('future',s,{},0,'Resultados','29/09',1);let radar=ctx.stockMobileRow(s,0,'previous',true,'entry');assert.match(future,/stock-open-row asset-row-main/);assert.match(radar,/stock-open-row asset-row-main/);const get=x=>x.slice(x.indexOf('<div class="asset-row-identity">'),x.indexOf('<span class="asset-row-arrow"'));assert.equal(get(future),get(radar))});
check('Both mobile catalogues reuse the same row',()=>{for(const mode of ['us','tr'])assert.match(ctx.catalogMobileRow(mode,sample(),'previous'),/stock-card asset-row/)});
check('Later regular snapshot beats a stale morning quote',()=>{let s=sample();s.usLivePrice=90;s.usLiveTimestamp='Sep 25, 2026 10:00 AM ET';assert.equal(model(s).regular.price,100)});
check('Intraday trade newer than regular snapshot remains primary',()=>{let s=sample();s.lastBarUpdateTime=Date.parse('2026-09-25T10:00:00-04:00');s.usLivePrice=105;s.usLiveTimestamp='Sep 25, 2026 10:10 AM ET';assert.equal(model(s).regular.price,105)});
check('Three-decimal exact LSX quote is not rounded to two',()=>{let s=sample();s.trLivePrice=1.063;assert.match(ctx.assetQuoteHtml(s,true),/1,063/)});
check('Older extended session is not placed beneath a newer regular day',()=>{let s=sample();s.lastBarUpdateTime=Date.parse('2026-09-28T10:00:00-04:00');clock=Date.parse('2026-09-28T10:10:00-04:00');assert.doesNotMatch(ctx.assetQuoteHtml(s),/data-asset-session="postmarket"/);clock=sunday;});
check('Profile price and latest price agree on Sunday',()=>{let s=sample();assert.equal(ctx.usPriceValues(s,100).usd,102)});
check('Session snapshot never claims an exact last-trade time',()=>{assert.equal(ctx.quoteUpdatedLabel(sample(),false),'Snapshot 25/09')});
check('LSX does not label download time as trade time',()=>{let s=sample();s.trLivePrice=100;s.trLiveLastAt=Date.parse('2026-09-25T20:00:00Z');ctx.trApplyTickerPayload(s,{last:{price:101},bid:{price:100,time:clock}});assert.equal(ctx.quoteTimestampMs(s,true),null)});
check('Same LSX price without a new trade time keeps its known timestamp',()=>{let s=sample();s.trLivePrice=100;s.trLiveLastAt=Date.parse('2026-09-25T20:00:00Z');ctx.trApplyTickerPayload(s,{last:{price:100}});assert.equal(ctx.quoteTimestampMs(s,true),Date.parse('2026-09-25T20:00:00Z'))});
check('US catalogue sort value agrees with the latest session',()=>{ctx.__sample=sample();assert.equal(vm.runInContext("CATALOG_COLUMNS.us.find(c=>c.id==='priceUsd').value(__sample)",ctx),102);assert.equal(vm.runInContext("CATALOG_COLUMNS.us.find(c=>c.id==='change').value(__sample)",ctx),2)});
check('IA quote age uses the source time, never receipt time',()=>{let s=sample();s.usLiveSecondary={price:104,changePct:4,timestamp:'Sep 25, 2026 7:59 PM ET',isRealTime:true};s.usLiveReceivedAt=clock;let input=ctx.recommendationEngineInput(s,'us');assert.equal(input.quoteAgeMs,clock-Date.parse('2026-09-25T23:59:00Z'))});
check('Sunday without POST shows the later close, not stale same-day PRE',()=>{let s=sample();s.postmarketPrice=null;assert.equal(model(s).latest.session,'regular');assert.equal(model(s).extended,null);assert.doesNotMatch(ctx.assetQuoteHtml(s),/data-asset-session="premarket"/)});
console.log(JSON.stringify({passed,failed:0,referenceTime:new Date(clock).toISOString()}));
