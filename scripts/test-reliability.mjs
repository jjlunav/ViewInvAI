import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {isAdminUser,addMonths,calculatePortfolioTransactionSummary,createTransactionRecord,deleteTransactionRecord,createFundTransactionRecord,deleteFundTransactionRecord,handleBackendApi,handleBackup,prepareCoreSchema,getCoreSchemaStatus} from '../backend.js';
import {advanceCoreSchema,coreSchemaStatus} from '../core-schema.js';
import {financialRevision,financialBatch} from '../financial-store.js';
import {exportBackup,restoreBackup} from '../backup-store.js';

function d1(){
 const raw=new DatabaseSync(':memory:');
 const stmt=(sql,args=[])=>({bind:(...a)=>stmt(sql,a),first:async()=>raw.prepare(sql).get(...args)||null,all:async()=>({results:raw.prepare(sql).all(...args)}),run:async()=>{const r=raw.prepare(sql).run(...args);return{success:true,meta:{changes:Number(r.changes)}}},sql,args});
 const db={raw,prepare:sql=>stmt(sql),batch:async rows=>{
  raw.exec('BEGIN');try{const out=rows.map(({sql,args})=>{const q=raw.prepare(sql);if(q.columns().length)return{success:true,results:q.all(...args),meta:{changes:0}};const r=q.run(...args);return{success:true,results:[],meta:{changes:Number(r.changes)}}});raw.exec('COMMIT');return out}catch(e){raw.exec('ROLLBACK');throw e}
 }};
 raw.exec(fs.readFileSync(new URL('../migrations/0001_accounts_portfolios_ai.sql',import.meta.url),'utf8'));
 raw.prepare("INSERT INTO users(id,email,created_at,updated_at) VALUES('u','u@example.com','x','x'),('other','other@example.com','x','x')").run();
 raw.prepare("INSERT INTO user_settings(user_id,created_at,updated_at) VALUES('u','x','x'),('other','x','x')").run();
 return db;
}
const db=d1(),env={DB:db},user={id:'u',email:'u@example.com'};
assert.equal(await isAdminUser(env,user),false);
assert.equal(await isAdminUser({...env,ADMIN_EMAILS:' other@example.com , U@EXAMPLE.COM '},user),true);
assert.equal(await isAdminUser({...env,ADMIN_EMAILS:'other@example.com'},user),false);
assert.equal(addMonths('2026-12-31',2),'2027-02-28');
assert.equal(addMonths('2024-12-31',2),'2025-02-28');
assert.equal(addMonths('2024-03-31',-1),'2024-02-29');
const json=(body,status=200)=>({body,status});
const backup=await handleBackup(new Request('https://app/api/backup'),env,user,json);
assert.equal(backup.body.version,2);
// A stock portfolio and its cash account live in different tables.
db.raw.prepare("INSERT INTO portfolios(id,user_id,name,created_at,updated_at) VALUES('pf','u','Main','x','x')").run();
db.raw.prepare("INSERT INTO portfolio_market_settings(portfolio_id,user_id,market_scope,cash_balance,updated_at) VALUES('pf','u','auto',1000,'x')").run();
const trade=(extra={})=>({portfolioId:'pf',stockKey:'NASDAQ:AAA',ticker:'AAA',name:'AAA',exchange:'NASDAQ',isin:'US0000000001',preferTr:0,side:'BUY',quantity:10,price:10,fees:1,currency:'EUR',executedAt:'2026-02-01T10:00:00Z',notes:'',broker:'Broker',cashFxRate:null,positionId:'',...extra});
let r=await createTransactionRecord(env,user,trade(),{externalId:'manual:request1'});
assert.equal(r.status,201);assert.equal(r.body.position.quantity,10);
const pos=r.body.position.id,tx=r.body.transaction.id;
assert.equal(db.raw.prepare("SELECT cash_balance FROM portfolio_market_settings WHERE portfolio_id='pf'").get().cash_balance,899);
r=await createTransactionRecord(env,user,trade(),{externalId:'manual:request1'});
assert.equal(r.body.replayed,true);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM transactions').get().n,1);
// A backdated sell must fail before either its row or cash adjustment is written.
r=await createTransactionRecord(env,user,trade({positionId:pos,side:'SELL',quantity:5,executedAt:'2026-01-01T10:00:00Z'}));
assert.equal(r.status,400);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM transactions').get().n,1);
r=await createTransactionRecord(env,user,trade({positionId:pos,side:'SELL',quantity:5,executedAt:'2026-03-01T10:00:00Z'}));
assert.equal(r.status,201);
assert.equal((await deleteTransactionRecord(env,user,tx)).status,409);
assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM transactions').get().n,2);
await deleteTransactionRecord(env,user,r.body.transaction.id);
r=await deleteTransactionRecord(env,user,tx);
assert.equal(r.status,200);assert.equal(r.body.position.quantity,0);assert.equal(r.body.position.active,0);
assert.equal(db.raw.prepare("SELECT cash_balance FROM portfolio_market_settings WHERE portfolio_id='pf'").get().cash_balance,1000);
// A mid-batch failure rolls back the ledger AND cash AND position.
const originalBatch=db.batch;
db.batch=rows=>originalBatch([...rows,db.prepare('INSERT INTO nonexistent_table VALUES(1)')]);
await assert.rejects(()=>createTransactionRecord(env,user,trade()),/nonexistent_table/);
db.batch=originalBatch;
assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM transactions').get().n,0);
assert.equal(db.raw.prepare("SELECT cash_balance FROM portfolio_market_settings WHERE portfolio_id='pf'").get().cash_balance,1000);
// Optimistic concurrency protects state read before another request committed.
const revision=await financialRevision(db,'u');
await financialBatch(db,'u',revision,[db.prepare("UPDATE portfolio_market_settings SET cash_balance=cash_balance+5 WHERE portfolio_id='pf'")]);
await assert.rejects(()=>financialBatch(db,'u',revision,[db.prepare("UPDATE portfolio_market_settings SET cash_balance=0 WHERE portfolio_id='pf'")]),e=>e.status===409);
assert.equal(db.raw.prepare("SELECT cash_balance FROM portfolio_market_settings WHERE portfolio_id='pf'").get().cash_balance,1005);
const sum=calculatePortfolioTransactionSummary([{position_id:'p1',stock_key:'AAA',side:'BUY',quantity:1,price:10,currency:'EUR'},{position_id:'p2',stock_key:'AAA',side:'BUY',quantity:1,price:12,currency:'USD'}]);
assert.equal(sum.currencies.EUR.buyGross,10);assert.equal(sum.currencies.USD.buyGross,12);
// Complete backup, including cash, fund history/plans and crypto; restore twice.
db.raw.exec("INSERT INTO fund_portfolios(id,user_id,name,created_at,updated_at) VALUES('fp','u','Funds','x','x'); INSERT INTO fund_positions(id,fund_portfolio_id,user_id,isin,name,units,avg_price,created_at,updated_at) VALUES('fpos','fp','u','US0000000002','Fund',2,20,'x','x'); INSERT INTO fund_transactions(id,fund_portfolio_id,fund_position_id,user_id,isin,side,units,price,executed_at,created_at,updated_at) VALUES('ft','fp','fpos','u','US0000000002','BUY',2,20,'2026-01-01','x','x'); INSERT INTO fund_contribution_plans(id,fund_portfolio_id,fund_position_id,user_id,isin,label,amount,created_at,updated_at) VALUES('plan','fp','fpos','u','US0000000002','Monthly',50,'x','x');");
db.raw.exec("INSERT INTO crypto_positions(id,user_id,symbol,platform,units,avg_price_eur,notes,origin,created_at,updated_at) VALUES('coin','u','BTC','Test',0.1,50000,'','manual','x','x')");
db.raw.exec("INSERT INTO dividends(id,user_id,portfolio_id,paid_at,ticker,gross,created_at) VALUES('historic','u','deleted-portfolio','2026-01-01','OLD',10,'x')");
const b=await exportBackup(db,'u');assert.equal(b.portfolios[0].cash_balance,1005);assert.equal(b.fundTransactions.length,1);assert.equal(b.fundPlans.length,1);
const restored=await restoreBackup(db,'other',b);assert.ok(restored.restored>0);assert.equal(restored.detachedHistory,1);
const again=await restoreBackup(db,'other',b);assert.equal(again.restored,0);
const copy=await exportBackup(db,'other');assert.equal(copy.portfolios[0].cash_balance,1005);assert.equal(copy.fundPositions[0].units,2);assert.equal(copy.fundPlans[0].amount,50);assert.equal(copy.cryptoPositions[0].units,0.1);assert.equal(copy.dividends[0].gross,10);assert.equal(copy.dividends[0].portfolio_id,'');
// Fund history enforces the same date/order and delete constraints.
let f=await createFundTransactionRecord(env,user,{positionId:'fpos',side:'SELL',units:1,price:21,fees:0,currency:'EUR',executedAt:'2025-12-01'});
assert.equal(f.status,400);
f=await createFundTransactionRecord(env,user,{positionId:'fpos',side:'SELL',units:1,price:21,fees:0,currency:'EUR',executedAt:'2026-02-01'},'manual:fundrequest1');
assert.equal(f.status,201);assert.equal(f.body.position.units,1);
assert.equal((await deleteFundTransactionRecord(env,user,'ft')).status,409);
await deleteFundTransactionRecord(env,user,f.body.transaction.id);
assert.equal(db.raw.prepare("SELECT units FROM fund_positions WHERE id='fpos'").get().units,2);
// Two requests that read the same stock/cash state cannot both commit stale results.
await createTransactionRecord(env,user,trade());
const active=db.raw.prepare("SELECT id FROM positions WHERE user_id='u' AND active=1").get().id;
const requests=await Promise.allSettled([1,2].map(()=>createTransactionRecord(env,user,trade({positionId:active,side:'SELL',quantity:7,executedAt:'2026-04-01'}))));
assert.equal(requests.filter(r=>r.status==='fulfilled'&&r.value.status===201).length,1);
assert.equal(db.raw.prepare('SELECT quantity FROM positions WHERE id=?').get(active).quantity,3);
assert.equal(await isAdminUser({DB:{prepare(){throw new Error('Admin must never depend on registration order')}}},user),false);
// Failed exports must not silently masquerade as an empty backup.
const broken={...db,batch:async()=>{throw new Error('Database unavailable')}};
await assert.rejects(()=>exportBackup(broken,'u'),/Database unavailable/);
// Exercise the real API boundary with a locally signed Firebase-shaped token.
const {generateKeyPair,exportJWK,SignJWT}=await import('jose');
const {privateKey,publicKey}=await generateKeyPair('RS256');
const jwk=await exportJWK(publicKey);jwk.kid='local-test';jwk.alg='RS256';jwk.use='sig';
const token=await new SignJWT({email:user.email,email_verified:true,name:'Test'})
 .setProtectedHeader({alg:'RS256',kid:'local-test'}).setIssuer('https://securetoken.google.com/test-project').setAudience('test-project').setSubject(user.id).setIssuedAt().setExpirationTime('5m').sign(privateKey);
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{assert.equal(String(url),'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');return Response.json({keys:[jwk]})};
const authed={...env,FIREBASE_PROJECT_ID:'test-project'};
const request=(path,body,method='POST')=>new Request('https://app/api/'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body})});
let response=await handleBackendApi(request('transactions','{'),authed);
assert.equal(response.status,400);assert.equal((await response.json()).error,'Invalid JSON');
response=await handleBackendApi(request('transactions',JSON.stringify({notes:'é'.repeat(20000)})),authed);
assert.equal(response.status,413);
response=await handleBackendApi(request('admin?lite=1',undefined,'GET'),authed);assert.equal(response.status,403);
response=await handleBackendApi(request('admin?lite=1',undefined,'GET'),{...authed,ADMIN_EMAILS:'u@example.com'});assert.equal(response.status,200);
response=await handleBackendApi(request('positions',JSON.stringify({...trade({stockKey:'NASDAQ:NEW',ticker:'NEW'}),avgPrice:10,openedAt:'2026-02-01'})),authed);
assert.equal(response.status,201);assert.equal((await response.json()).position.quantity,10);
response=await handleBackendApi(request('fund-transactions/import',JSON.stringify({fundPortfolioId:'fp',source:'csv',replaceManual:true,rows:[
 {externalId:'fund-history-buy',isin:'US0000000002',side:'BUY',units:3,price:5,fees:0,currency:'EUR',executedAt:'2026-01-01'},
 {externalId:'fund-history-sell',isin:'US0000000002',side:'SELL',units:1,price:6,fees:0,currency:'EUR',executedAt:'2026-02-01'}]})),authed);
assert.equal(response.status,200);const fundImport=await response.json();assert.equal(fundImport.imported,2);assert.equal(fundImport.errors.length,0);
assert.equal(db.raw.prepare("SELECT units FROM fund_positions WHERE id='fpos'").get().units,2);
assert.equal(db.raw.prepare("SELECT avg_price FROM fund_positions WHERE id='fpos'").get().avg_price,5);
const newPosition=db.raw.prepare("SELECT id FROM positions WHERE stock_key='NASDAQ:NEW' AND user_id='u'").get().id;
response=await handleBackendApi(request('positions/'+newPosition,JSON.stringify({quantity:12,avgPrice:11}),'PATCH'),authed);
assert.equal(response.status,200);assert.equal((await response.json()).position.quantity,12);
globalThis.fetch=originalFetch;
// A failed preparation step cannot mark readiness or skip the retry.
const prepDb=d1();let attempts=0;
const prepSteps=[['retry',async()=>{if(++attempts===1)throw new Error('injected failure')}],['second',async()=>{}]];
const priorWarn=console.warn;console.warn=()=>{};
assert.equal((await advanceCoreSchema({DB:prepDb},prepSteps)).completed,0);
console.warn=priorWarn;
assert.equal((await advanceCoreSchema({DB:prepDb},prepSteps)).completed,1);
assert.equal((await coreSchemaStatus(prepDb,prepSteps)).ready,false);
assert.equal((await advanceCoreSchema({DB:prepDb},prepSteps)).ready,true);
assert.equal(attempts,2);
// Changing preparation code invalidates the stored readiness marker.
assert.equal((await coreSchemaStatus(prepDb,[['changed',async()=>{}]])).ready,false);
// Background preparation proves core readiness before request-time DDL is bypassed.
for(let i=0;i<15;i++)await prepareCoreSchema(env);
assert.equal((await getCoreSchemaStatus(env)).ready,true);
const originalPrepare=db.prepare;let ddl=0;
db.prepare=sql=>{if(/^(?:CREATE|ALTER|DROP)\s/i.test(sql.trim()))ddl++;return originalPrepare(sql)};
const freshBackend=await import('../backend.js?fresh-isolate');
await freshBackend.handleBackup(new Request('https://app/api/backup'),env,user,json);
assert.equal(ddl,0,'Prepared core schema must not be rebuilt by a fresh request handler');
db.prepare=originalPrepare;
console.log('Reliability: admin allowlist, calendar, chronological ledger, atomic rollback, concurrency, idempotency, backup round trip: OK');
