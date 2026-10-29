import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import worker from '../worker.js';
import {CORE_SCHEMA_CRON} from '../core-schema.js';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const env={ASSETS:{fetch:async()=>new Response(html,{headers:{'Content-Type':'text/html'}})}};
const response=await worker.fetch(new Request('https://app/'),env,{});
assert.equal(response.status,200);
const csp=response.headers.get('Content-Security-Policy');
assert.ok(csp?.includes("default-src 'self'"));
assert.equal(response.headers.get('X-Frame-Options'),'DENY');
assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
assert.equal(response.headers.get('Cache-Control'),'no-cache');
for(const [,source] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)){
 const hash=createHash('sha256').update(source).digest('base64');
 assert.ok(csp.includes("'sha256-"+hash+"'"),'Root inline bootstrap must remain executable under CSP');
}
assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"));
const native=await worker.fetch(new Request('https://app/',{headers:{Origin:'https://localhost'}}),env,{});
assert.equal(native.headers.get('Access-Control-Allow-Origin'),'https://localhost');
assert.ok(native.headers.has('Content-Security-Policy'));
const options=await worker.fetch(new Request('https://app/api/transactions',{method:'OPTIONS',headers:{Origin:'https://localhost','Access-Control-Request-Headers':'authorization,content-type,idempotency-key'}}),env,{});
assert.equal(options.status,204);assert.ok(options.headers.get('Access-Control-Allow-Headers').includes('idempotency-key'));
// The configured distributed limit must match each market route's threshold.
const config=JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8').replace(/^\s*\/\/.*$/gm,''));
assert.equal(config.keep_vars,true,"Dashboard variables, including ADMIN_EMAILS, must survive deployments");
for(const [name,limit] of [['MARKET_RATE_LIMITER',90],...([12,20,30,40,60].map(n=>['MARKET_RATE_LIMITER_'+n,n])),['AI_RATE_LIMITER_10',10]])assert.equal(config.ratelimits.find(r=>r.name===name)?.simple.limit,limit);
// Cloudflare uses Quartz weekday bounds (1..7), unlike Unix cron (0..6).
assert.ok(config.triggers.crons.includes(CORE_SCHEMA_CRON),'Dedicated schema handler must match a configured trigger');
assert.equal(new Set(config.triggers.crons).size,config.triggers.crons.length);
for(const expression of config.triggers.crons){
 const fields=expression.trim().split(/\s+/),bounds=[[0,59],[0,23],[1,31],[1,12],[1,7]];
 assert.equal(fields.length,5,'Cloudflare cron requires five fields');
 fields.forEach((field,i)=>{
  for(const part of field.split(',')){
   const match=/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
   assert.ok(match,'Update validation explicitly when using named/advanced cron syntax');
   const [lo,hi]=bounds[i];
   if(match[1]!=='*'){
    const values=match[1].split('-').map(Number);
    for(const value of values)assert.ok(value>=lo&&value<=hi,`Cron field ${i+1} out of Cloudflare bounds: ${expression}`);
    if(values.length===2)assert.ok(values[0]<=values[1]);
   }
   if(match[2])assert.ok(Number(match[2])>=1&&Number(match[2])<=hi-lo+1);
  }
 });
}
console.log('Worker security headers, CSP bootstrap, native CORS and rate limits: OK');
