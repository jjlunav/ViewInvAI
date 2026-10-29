// Huchas del Objetivo: el efectivo de cada hucha sale de lo asignado y de sus operaciones, nunca de un saldo aparte.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createTransactionRecord,deleteTransactionRecord,handleGoalSleeves,goalSleeveState,handleBackup} from '../backend.js';
import {exportBackup} from '../backup-store.js';

function d1(){
 const raw=new DatabaseSync(':memory:');
 const stmt=(sql,args=[])=>({bind:(...a)=>stmt(sql,a),first:async()=>raw.prepare(sql).get(...args)||null,all:async()=>({results:raw.prepare(sql).all(...args)}),run:async()=>{const r=raw.prepare(sql).run(...args);return{success:true,meta:{changes:Number(r.changes)}}},sql,args});
 const db={raw,prepare:sql=>stmt(sql),batch:async rows=>{
  raw.exec('BEGIN');try{const out=rows.map(({sql,args})=>{const q=raw.prepare(sql);if(q.columns().length)return{success:true,results:q.all(...args),meta:{changes:0}};const r=q.run(...args);return{success:true,results:[],meta:{changes:Number(r.changes)}}});raw.exec('COMMIT');return out}catch(e){raw.exec('ROLLBACK');throw e}
 }};
 raw.exec(fs.readFileSync(new URL('../migrations/0001_accounts_portfolios_ai.sql',import.meta.url),'utf8'));
 raw.prepare("INSERT INTO users(id,email,created_at,updated_at) VALUES('u','u@example.com','x','x')").run();
 return db;
}
const db=d1(),env={DB:db},user={id:'u',email:'u@example.com'},json=(body,status=200)=>({body,status});
// Prepara el esquema (como en producción, al primer uso).
await handleBackup(new Request('https://app/api/backup'),env,user,json);
db.raw.prepare("INSERT INTO portfolios(id,user_id,name,base_currency,created_at,updated_at) VALUES('pf','u','TR','EUR','x','x')").run();
db.raw.prepare("INSERT INTO portfolio_market_settings(portfolio_id,user_id,market_scope,cash_balance,updated_at) VALUES('pf','u','tr',1000,'x')").run();
const cash=()=>db.raw.prepare("SELECT cash_balance c FROM portfolio_market_settings WHERE portfolio_id='pf'").get().c;
const trade=(extra={})=>({portfolioId:'pf',stockKey:'XETRA:OLD',ticker:'OLD',name:'Old',exchange:'LSX',isin:'US0000000001',preferTr:1,side:'BUY',quantity:10,price:10,fees:1,currency:'EUR',executedAt:'2026-02-01T10:00:00Z',notes:'',broker:'Trade Republic',cashFxRate:null,positionId:'',sleeve:'',...extra});
// Una acción que ya tenías antes de las huchas.
let r=await createTransactionRecord(env,user,trade());
assert.equal(r.status,201);const old=r.body.position.id;assert.equal(cash(),899);
// Sin objetivo no hay huchas.
assert.equal((await handleGoalSleeves(env,user,json,'pf',{sleeves:{cash:{alto:1}}})).status,404);
db.raw.prepare("INSERT INTO portfolio_goals(portfolio_id,user_id,target_value_eur,created_at,updated_at) VALUES('pf','u',2000,'x','x')").run();
// No se puede repartir más que el efectivo.
assert.equal((await handleGoalSleeves(env,user,json,'pf',{sleeves:{cash:{alto:900,medio:0,bajo:0}}})).status,409);
assert.equal(await handleGoalSleeves(env,user,json,'pf',{sleeves:{cash:{alto:300,medio:200,bajo:399},strategies:{bajo:'index'},assign:[{positionId:old,sleeve:'bajo',valueEur:120}]}}),null);
const started=db.raw.prepare("SELECT sleeves_started_at s FROM portfolio_goals WHERE portfolio_id='pf'").get().s;
let S=await goalSleeveState(env,'u','pf',started);
assert.equal(S.sleeves.alto.cashEur,300);assert.equal(S.sleeves.medio.cashEur,200);assert.equal(S.sleeves.bajo.cashEur,399);
assert.equal(S.sleeves.bajo.baseEur,519,"lo que ya tenías se suma a su 100 % por su valor de hoy");
assert.equal(S.sleeves.bajo.strategy,'index');assert.equal(S.totalCashEur,899);
// Estrategia que no corresponde a la hucha: se rechaza.
assert.equal((await handleGoalSleeves(env,user,json,'pf',{sleeves:{strategies:{alto:'index'}}})).status,400);
const later=ms=>new Date(Date.now()+ms).toISOString();
// Compra con el dinero de la hucha alta y venta con ganancia: el importe vuelve a la hucha alta.
r=await createTransactionRecord(env,user,trade({stockKey:'XETRA:BIO',ticker:'BIO',isin:'US0000000002',quantity:5,price:20,executedAt:later(1000),sleeve:'alto'}));
assert.equal(r.status,201);const bio=r.body.position.id;
assert.equal(db.raw.prepare('SELECT sleeve FROM positions WHERE id=?').get(bio).sleeve,'alto');
S=await goalSleeveState(env,'u','pf',started);assert.equal(S.sleeves.alto.cashEur,199);assert.equal(cash(),798);assert.equal(S.totalCashEur,cash());
r=await createTransactionRecord(env,user,trade({stockKey:'XETRA:BIO',ticker:'BIO',isin:'US0000000002',positionId:bio,side:'SELL',quantity:5,price:24,executedAt:later(2000)}));
assert.equal(r.status,201);assert.equal(r.body.transaction.sleeve,'alto',"la venta va a la hucha de la posición");
S=await goalSleeveState(env,'u','pf',started);assert.equal(S.sleeves.alto.cashEur,318);assert.equal(S.sleeves.alto.baseEur,300);
assert.equal(Math.round((S.sleeves.alto.cashEur/S.sleeves.alto.baseEur-1)*10000)/100,6,"+18 € sobre 300 € = +6 %");
// Meter dinero en una hucha con ganancia no cambia su rentabilidad (participaciones a 1,06 €).
db.raw.prepare("UPDATE portfolio_market_settings SET cash_balance=cash_balance+100 WHERE portfolio_id='pf'").run();
assert.equal(await handleGoalSleeves(env,user,json,'pf',{sleeves:{cash:{alto:418},values:{alto:318}}}),null);
S=await goalSleeveState(env,'u','pf',started);
assert.equal(S.sleeves.alto.baseEur,400,"lo aportado sube");
assert.equal(Math.round((S.sleeves.alto.cashEur/S.sleeves.alto.units-1)*10000)/100,6,"la rentabilidad sigue en +6 %");
assert.equal(await handleGoalSleeves(env,user,json,'pf',{sleeves:{cash:{alto:318},values:{alto:418}}}),null);
db.raw.prepare("UPDATE portfolio_market_settings SET cash_balance=cash_balance-100 WHERE portfolio_id='pf'").run();
S=await goalSleeveState(env,'u','pf',started);
assert.equal(Math.round((S.sleeves.alto.cashEur/S.sleeves.alto.units-1)*10000)/100,6,"sacar dinero tampoco la cambia");
// Vender parte de la acción que ya tenías (hucha baja) y borrar esa venta: la hucha vuelve a como estaba.
r=await createTransactionRecord(env,user,trade({positionId:old,side:'SELL',quantity:5,price:12,executedAt:later(3000)}));
S=await goalSleeveState(env,'u','pf',started);assert.equal(S.sleeves.bajo.cashEur,458);
assert.equal((await deleteTransactionRecord(env,user,r.body.transaction.id)).status,200);
S=await goalSleeveState(env,'u','pf',started);assert.equal(S.sleeves.bajo.cashEur,399);assert.equal(S.totalCashEur,cash());
// Importación que fija el efectivo aparte (sin ajustar el saldo en cada operación): la hucha se ajusta con importe y comisión.
r=await createTransactionRecord(env,user,trade({stockKey:'XETRA:BIO',ticker:'BIO',isin:'US0000000002',quantity:1,price:20,executedAt:later(4000)}),{origin:'import:tr',adjustCash:false});
assert.equal(r.body.transaction.sleeve,'alto');
S=await goalSleeveState(env,'u','pf',started);assert.equal(S.sleeves.alto.cashEur,297);
// Aportación: subir el efectivo de una hucha sube su 100 % (no cuenta como ganancia).
db.raw.prepare("UPDATE portfolio_market_settings SET cash_balance=cash_balance+100 WHERE portfolio_id='pf'").run();
assert.equal(await handleGoalSleeves(env,user,json,'pf',{sleeves:{cash:{medio:300}}}),null);
S=await goalSleeveState(env,'u','pf',started);assert.equal(S.sleeves.medio.cashEur,300);assert.equal(S.sleeves.medio.baseEur,300);
// Cambiar una acción de hucha mueve su aportación, no la duplica.
assert.equal(await handleGoalSleeves(env,user,json,'pf',{sleeves:{assign:[{positionId:old,sleeve:'medio',valueEur:120}]}}),null);
S=await goalSleeveState(env,'u','pf',started);assert.equal(S.sleeves.bajo.baseEur,399);assert.equal(S.sleeves.medio.baseEur,420);
// Sin precio, una acción que ya tenías no entra en una hucha (después parecería ganancia gratis).
r=await createTransactionRecord(env,user,trade({stockKey:'XETRA:NOPX',ticker:'NOPX',isin:'US0000000009',quantity:2,price:5,executedAt:'2026-01-15T10:00:00Z'}));
const nopx=r.body.position.id;
assert.equal((await handleGoalSleeves(env,user,json,'pf',{sleeves:{assign:[{positionId:nopx,sleeve:'bajo',valueEur:null}]}})).status,409);
assert.equal(db.raw.prepare('SELECT sleeve FROM positions WHERE id=?').get(nopx).sleeve,'');
// Una compra antigua (de antes de las huchas) importada después sube lo aportado al mismo precio por acción.
S=await goalSleeveState(env,'u','pf',started);const medioBase=S.sleeves.medio.baseEur;
await createTransactionRecord(env,user,trade({positionId:old,quantity:10,price:9,executedAt:'2026-01-20T10:00:00Z'}),{origin:'import:tr',adjustCash:false});
S=await goalSleeveState(env,'u','pf',started);
assert.equal(S.sleeves.medio.baseEur,Math.round((medioBase+10*12)*100)/100,"10 acciones más a 12 € (120 € por 10 al asignarla)");
// Compra que el saldo no cubre: la hucha descuenta el importe completo, no solo lo que quedaba en la cartera.
db.raw.prepare("UPDATE portfolio_market_settings SET cash_balance=10 WHERE portfolio_id='pf'").run();
S=await goalSleeveState(env,'u','pf',started);const altoCash=S.sleeves.alto.cashEur;
await createTransactionRecord(env,user,trade({stockKey:'XETRA:BIO',ticker:'BIO',isin:'US0000000002',quantity:2,price:20,executedAt:later(5000)}));
S=await goalSleeveState(env,'u','pf',started);assert.equal(S.sleeves.alto.cashEur,Math.round((altoCash-41)*100)/100);
// Con un efectivo para el objetivo, las huchas no pueden pasar de esa cantidad (el resto queda fuera).
db.raw.prepare("UPDATE portfolio_market_settings SET cash_balance=500 WHERE portfolio_id='pf'").run();
db.raw.prepare("UPDATE portfolio_goals SET goal_cash_mode='amount',goal_cash_reserve_eur=300 WHERE portfolio_id='pf'").run();
let over=await handleGoalSleeves(env,user,json,'pf',{sleeves:{cash:{alto:100,medio:100,bajo:50}}});
assert.equal(over.status,409,"250 € no caben en los 200 € para el objetivo");
assert.match(over.body.error,/efectivo para el objetivo es 200/);
assert.equal(await handleGoalSleeves(env,user,json,'pf',{sleeves:{cash:{alto:60,medio:40,bajo:100}}}),null);
// La copia de seguridad incluye las huchas.
const b=await exportBackup(db,'u');assert.equal(b.goalSleeves.length,3);assert.ok(b.goalSleeveMoves.length>=4);
// Quitar las huchas no borra operaciones ni posiciones.
const txBefore=db.raw.prepare('SELECT COUNT(*) n FROM transactions').get().n;
assert.equal(await handleGoalSleeves(env,user,json,'pf',{sleeves:{disable:true}}),null);
assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM transactions').get().n,txBefore);
assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM positions WHERE sleeve<>''").get().n,0);
assert.equal(db.raw.prepare("SELECT sleeves_started_at s FROM portfolio_goals WHERE portfolio_id='pf'").get().s,null);
console.log('Goal sleeves tests: OK');
