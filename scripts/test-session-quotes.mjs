import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const now=Date.parse('2026-09-29T20:00:00Z');
class Clock extends Date { static now(){return now} }
const context=vm.createContext({
 Date:Clock,console,
 N:value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?null:Number(value),
 C:value=>value===null||value===undefined?'':Number(value)<0?'negative':'positive',
 PC:value=>value===null||value===undefined?'—':String(value)+'%',
 snapshotPricePair:(_stock,price)=>String(price),
 window:{ViewInvAIMarketBoard:{},addEventListener(){},ViewInvAIRadarCoach:{}}
});
vm.runInContext(fs.readFileSync(path.join(root,'stock-list.js'),'utf8'),context,{filename:'stock-list.js'});

const pre=Date.parse('2026-09-29T13:20:00Z');
const post=Date.parse('2026-09-29T18:10:00Z');
const stock={
 price:10,
 premarketPrice:9.8,premarketChangePct:-2,premarketTime:pre/1000,
 postmarketPrice:10.4,postmarketChangePct:4,postmarketTime:post/1000
};
const select=(s,se)=>context.selectExtendedSessionQuote(s,se,now);

assert.equal(context.sessionQuoteTimestamp(pre/1000,now),pre);
assert.equal(context.sessionQuoteTimestamp(pre,now),pre);
assert.equal(context.sessionQuoteTimestamp('2026-09-29T15:20:00+02:00',now),pre);
for(const value of [null,undefined,'',0,-1,Infinity,NaN,'bad','2026-09-29',now+120000]){
 assert.equal(context.sessionQuoteTimestamp(value,now),null);
}
assert.equal(select(stock,'regular').kind,'postmarket');
assert.equal(select(stock,'previous').kind,'postmarket');
assert.equal(select(stock,'premarket').kind,'premarket');
assert.equal(select(stock,'postmarket').kind,'postmarket');
assert.equal(select({...stock,premarketPrice:null},'premarket'),null);
assert.equal(select({...stock,premarketTime:(pre-86400000)/1000},'premarket'),null);
assert.equal(select({...stock,postmarketTime:(post-86400000)/1000},'postmarket'),null);
assert.equal(context.usQuoteFromToday(null,now),true);
assert.equal(select({...stock,postmarketPrice:null},'postmarket'),null);
assert.equal(select({...stock,premarketTime:null},'regular'),null);
assert.equal(select({...stock,postmarketTime:pre/1000},'regular'),null);
assert.equal(select({...stock,postmarketTime:(now+3600000)/1000},'regular'),null);
assert.equal(select({premarketPrice:9.8},'regular').kind,'premarket');
assert.equal(select({premarketPrice:0,postmarketPrice:-1},'regular'),null);
assert.equal(context.extendedSessionDisplay(stock,'regular').kind,'postmarket');
assert.equal(context.extendedSessionDisplay(stock,'premarket').kind,'premarket');
console.log('Session quote chronology: OK');
