import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const now=Date.parse('2026-09-28T14:00:00Z');
class Clock extends Date { static now(){return now} }
let priceMarket=null;
const context=vm.createContext({Date:Clock,console,
 N:value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?null:Number(value),
 E:value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),
 C:value=>value===null?'neutral':value<0?'negative':'positive',
 PC:value=>value===null?'--':value+'%',
 snapshotPricePair:(_stock,price,preferTr)=>{priceMarket=preferTr;return String(price)}
});
// Load the production module, not a duplicated implementation of the selector.
vm.runInContext(fs.readFileSync(path.join(root,'stock-list.js'),'utf8'),context,{filename:'stock-list.js'});
let count=0;
function check(name,fn){fn();count++;console.log('PASS '+name)}
const pre=Date.parse('2026-09-25T13:20:00Z');
const post=Date.parse('2026-09-25T23:50:00Z');
const stock={premarketPrice:10,premarketChangePct:2,premarketTime:pre/1000,
 postmarketPrice:11,postmarketChangePct:3,postmarketTime:post/1000};
const select=(s,se)=>context.selectListSessionQuote(s,se,now);
check('seconds, milliseconds and offset ISO normalize equally',()=>{
 for(const value of [pre/1000,String(pre/1000),pre,'2026-09-25T15:20:00+02:00'])assert.equal(context.listSessionTimestamp(value,now),pre);
});
check('invalid, future and timezone-free dates are not trusted',()=>{
 for(const value of [null,undefined,'',true,false,0,-1,Infinity,NaN,'bad','2026-09-25','2026-09-25T13:20:00',now+120000])assert.equal(context.listSessionTimestamp(value,now),null);
});
check('weekend/general selects dated POST, not first PRE',()=>assert.equal(select(stock,'previous').session,'postmarket'));
check('regular summary also selects the newest known timestamp',()=>assert.equal(select(stock,'regular').session,'postmarket'));
check('Monday PRE supersedes Friday POST',()=>assert.equal(select({...stock,premarketTime:'2026-09-28T13:20:00Z'},'regular').session,'premarket'));
check('explicit PRE is respected even with newer POST',()=>assert.equal(select(stock,'premarket').session,'premarket'));
check('explicit POST is respected',()=>assert.equal(select(stock,'postmarket').session,'postmarket'));
check('missing requested PRE does not silently become POST',()=>assert.equal(select({...stock,premarketPrice:null},'premarket'),null));
check('missing requested POST does not silently become PRE',()=>assert.equal(select({...stock,postmarketPrice:null},'postmarket'),null));
check('missing timestamps do not invent chronology',()=>assert.equal(select({...stock,premarketTime:null},'regular'),null));
check('equal timestamps remain ambiguous',()=>assert.equal(select({...stock,postmarketTime:pre/1000},'previous'),null));
check('future timestamps do not rank as newest',()=>assert.equal(select({...stock,postmarketTime:(now+3600000)/1000},'previous'),null));
check('a single undated quote remains available',()=>assert.equal(select({postmarketPrice:11},'previous').at,null));
check('invalid and nonpositive prices are excluded',()=>{
 for(const value of [null,undefined,'',-2,0,NaN,Infinity,'bad'])assert.equal(select({...stock,premarketPrice:value},'previous').session,'postmarket');
 assert.equal(select({},'previous'),null);
});
check('LSX card does not reinterpret US PRE/POST as EUR',()=>{
 const html=context.listSessionQuote(stock,'postmarket',true);
 assert.equal(priceMarket,false);assert.match(html,/POST/);assert.match(html,/EEUU/);assert.match(html,/2026-09-25T23:50:00.000Z/);
});
check('unknown order points to retained session details',()=>assert.match(context.listSessionQuote({...stock,premarketTime:null},'regular'),/Consultar sesiones en ficha/));
check('an undated selected quote says so explicitly',()=>assert.match(context.listSessionQuote({premarketPrice:10},'premarket'),/Hora no disponible/));
check('PRE and POST retain distinct sun and moon icons',()=>{
 assert.match(context.listSessionQuote(stock,'premarket'),/\u2600/);assert.match(context.listSessionQuote(stock,'postmarket'),/\u263e/);
});
console.log(JSON.stringify({suite:'session-quotes',passed:count,failed:0}));
