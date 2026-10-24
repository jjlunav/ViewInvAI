// Historial de caídas bruscas: clasifica, guarda una vez al día y mide el rebote a 1/5/20 sesiones.
// Usa SQLite en memoria con la misma interfaz que D1 (prepare/bind/first/all/run/batch).
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { runRadarScoreboard, crashScoreboardSummary, crashSignalsForSnapshot, radarScoreboardSummary, runCatalystReader, catalystReadsFor } from "../backend.js";

function d1(){
  const db=new DatabaseSync(":memory:");
  const stmt=(sql,args=[])=>({
    bind:(...a)=>stmt(sql,a),
    first:async()=>db.prepare(sql).get(...args)??null,
    all:async()=>({results:db.prepare(sql).all(...args)}),
    run:async()=>db.prepare(sql).run(...args)
  });
  return{prepare:sql=>stmt(sql),batch:async list=>{const out=[];for(const s of list)out.push(await s.run());return out},raw:db};
}
const ev=(ticker,title,type="news",daysAgo=0)=>({ticker,title,type,date:new Date(Date.parse("2026-10-21T15:00:00Z")-daysAgo*864e5).toISOString()});
const stock=(ticker,changePct,price,extra={})=>({ticker,exchange:"NASDAQ",tvSymbol:"NASDAQ:"+ticker,name:ticker+" Inc",price,changePct,perfMonth:changePct,marketCap:5e8,...extra});
function snapshot(prices,changes){
  return{meta:{updatedAt:new Date().toISOString()},
    stocks:Object.keys(prices).map(t=>stock(t,changes[t]??0,prices[t],t==="CHIC"?{marketCap:5e6}:t==="SLID"?{perfMonth:-70}:t==="EURO"?{exchange:"XETR",tvSymbol:"XETR:EURO",tradeRepublicTradable:true}:t==="NOTR"?{exchange:"XETR",tvSymbol:"XETR:NOTR"}:{})),
    events:[ev("OVER","Analyst downgrade to Sell, lowers price target","analyst"),ev("TRAP","Company announces $50M registered direct offering","financing"),
      ev("NEWS","Phase 3 trial shows positive topline results","medical"),ev("OLD","Analyst downgrade","analyst",9)]};
}
// Día 1 (21 oct): cinco caídas válidas y tres que no entran (chicharro, ya venía cayendo, no negociable).
const day1={OVER:6,TRAP:3,NEWS:8,OLD:4,EURO:10,CHIC:1,SLID:2,NOTR:5,FLAT:20};
const ch1={OVER:-40,TRAP:-55,NEWS:-30,OLD:-26,EURO:-35,CHIC:-50,SLID:-40,NOTR:-45,FLAT:-3};
const rows=crashSignalsForSnapshot(snapshot(day1,ch1),Date.parse("2026-10-21T19:45:00Z"));
const by=Object.fromEntries(rows.map(r=>[r.ticker,r]));
assert.deepEqual(Object.keys(by).sort(),["EURO","NEWS","OLD","OVER","TRAP"]);
assert.equal(by.OVER.kind,"over");assert.equal(by.TRAP.kind,"trap");assert.equal(by.NEWS.kind,"news");
assert.match(by.NEWS.label,/esperaba más/);
assert.equal(by.OLD.kind,"none","un evento de hace 9 días no explica la caída de hoy");
assert.equal(by.EURO.tr_tradable,1);
assert.ok(by.OVER.score>by.NEWS.score&&by.NEWS.score>by.TRAP.score);
assert.equal(rows[0].ticker,"TRAP","ordenadas de la peor a la menos mala");

const env={DB:d1()};
let current=snapshot(day1,ch1),spy=500;
const services={loadMarketSnapshot:async()=>current,loadBenchmark:async()=>spy};
// 15:45 de Nueva York = 19:45 UTC en octubre (horario de verano).
const at=day=>Date.parse(day+"T19:46:00Z");
let r=await runRadarScoreboard(env,services,at("2026-10-21"));
assert.equal(r.crashes,5);
r=await runRadarScoreboard(env,services,at("2026-10-21"));
assert.equal(r.skipped,"already-marked","una sola foto al día");
// Día 2: OVER rebota +50 %, TRAP baja otro 33 %; SPY +1 %.
current=snapshot({OVER:9,TRAP:2,NEWS:8,OLD:4,EURO:11,FLAT:20},{});spy=505;
r=await runRadarScoreboard(env,services,at("2026-10-22"));
assert.equal(r.crashes,0);
const one=env.DB.raw.prepare("SELECT ticker,ret_1d,bench_1d,ret_5d FROM crash_signals ORDER BY ticker").all();
const m=Object.fromEntries(one.map(x=>[x.ticker,x]));
assert.equal(m.OVER.ret_1d,50);assert.equal(m.TRAP.ret_1d,-33.333);assert.equal(m.NEWS.ret_1d,0);assert.equal(m.OVER.bench_1d,1);
assert.equal(m.OVER.ret_5d,null,"a 5 sesiones aún no");
// Las sesiones 2-5 (el 24 y el 25 son fin de semana) cuentan para el horizonte de 5.
for(const [day,px] of [["2026-10-23",12],["2026-10-26",12],["2026-10-27",13],["2026-10-28",15]]){current=snapshot({OVER:px,TRAP:1.5,NEWS:9,OLD:4,EURO:12},{});await runRadarScoreboard(env,services,at(day))}
const sum=await crashScoreboardSummary(env);
assert.equal(sum.signals,5);
assert.equal(sum.stats.over["1d"].n,1);assert.equal(sum.stats.over["1d"].hitRate,100);
assert.equal(sum.stats.over["5d"].avgReturn,150,"OVER: de 6 a 15 en 5 sesiones");
assert.equal(sum.stats.trap["5d"].avgReturn,-50);
assert.equal(sum.stats.all["5d"].n,5);
assert.equal(sum.recent.find(x=>x.ticker==="OVER").kind,"over");
// El Radar AI sigue igual: su marca diaria se guarda junto a la de las caídas.
assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM radar_bench").get().n,6);
// El resumen del Radar AI con los factores nuevos (columnas añadidas con ALTER) sigue funcionando.
const radar=await radarScoreboardSummary(env);
for(const k of ["opportunityFirst","score80","chasing","calm","opportunity","watch"])assert.ok(radar.stats[k]&&radar.stats[k]["1d"],"grupo "+k);
const cols=env.DB.raw.prepare("PRAGMA table_info(radar_signals)").all().map(c=>c.name);
for(const c of ["change_pct","rel_volume","rsi","perf_week"])assert.ok(cols.includes(c),"columna "+c);
// Lector de catalizadores: sin IA configurada no lee nada (ni rompe), y las lecturas guardadas se devuelven por valor.
env.DB.raw.prepare("CREATE TABLE IF NOT EXISTS positions (stock_key TEXT, active INTEGER)").run();
const cr=await runCatalystReader(env,{loadMarketSnapshot:async()=>({...snapshot(day1,ch1),universe:{crash:[{stock_key:"NASDAQ:TRAP"}],radar:[]}})},Date.parse("2026-10-21T20:00:00Z"));
assert.equal(cr.read,0);
env.DB.raw.prepare("INSERT INTO catalyst_reads (key,stock_key,ticker,day,title,kind,direction,material,business,summary,agree,providers,created_at) VALUES ('k1','NASDAQ:TRAP','TRAP',?,'Offering','ampliacion',-2,1,0,'Ampliación de capital',1,'a+b','x')").run(new Date().toISOString().slice(0,10));
const reads=await catalystReadsFor(env,["NASDAQ:TRAP","bad key"]);
assert.equal(reads.length,1);assert.equal(reads[0].agree,true);assert.equal(reads[0].kind,"ampliacion");
console.log("crash scoreboard ok:",JSON.stringify(sum.stats.over["5d"]));
