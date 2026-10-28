import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import worker from '../worker.js';
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
console.log('Worker security headers, CSP bootstrap, native CORS and rate limits: OK');
