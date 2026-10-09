// Regla de los dos meses (art. 33.5.f LIRPF): casos de referencia del cálculo fiscal.
import assert from 'node:assert/strict';
import {computeSpanishTax} from '../backend.js';
const fx=()=>({rate:1,date:'x'});
const tx=(d,side,q,p)=>({isin:'US0000000001',ticker:'ABC',side,quantity:q,price:p,fees:0,currency:'EUR',executed_at:d+'T10:00:00Z'});
const totals=rows=>computeSpanishTax(rows,fx,2026).totals;
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,a+' ≠ '+b);

// Recompra que sigue en cartera: la pérdida queda diferida.
let t=totals([tx('2026-03-01','BUY',10,100),tx('2026-03-10','SELL',10,80),tx('2026-03-15','BUY',10,80)]);
near(t.realEur,-200);near(t.netEur,0);near(t.pendingDeferredEur,-200);
// Al vender la recompra, la pérdida diferida se integra.
t=totals([tx('2026-03-01','BUY',10,100),tx('2026-03-10','SELL',10,80),tx('2026-03-15','BUY',10,80),tx('2026-04-20','SELL',10,80)]);
near(t.netEur,-200);near(t.pendingDeferredEur,0);
// Trading activo sin nada en cartera al final: todo computable.
const cycles=[];for(let i=0,d=1;i<5;i++,d+=3){cycles.push(tx('2026-05-'+String(d).padStart(2,'0'),'BUY',10,100),tx('2026-05-'+String(d+1).padStart(2,'0'),'SELL',10,90))}
t=totals(cycles);near(t.netEur,-500);near(t.pendingDeferredEur,0);
// Una recompra pequeña solo bloquea su número de títulos.
t=totals([tx('2026-06-01','BUY',20,100),tx('2026-06-05','SELL',10,90),tx('2026-06-06','SELL',10,90),tx('2026-06-10','BUY',5,90)]);
near(t.netEur,-150);near(t.pendingDeferredEur,-50);
// Sin recompra: nada diferido.
t=totals([tx('2026-01-01','BUY',10,100),tx('2026-01-10','SELL',10,80)]);
near(t.netEur,-200);near(t.blockedLossEur,0);
// Las ganancias nunca se difieren.
t=totals([tx('2026-02-01','BUY',10,100),tx('2026-02-10','SELL',10,120),tx('2026-02-12','BUY',10,120)]);
near(t.netEur,200);near(t.blockedLossEur,0);
console.log('Tax two-month rule tests: OK');
