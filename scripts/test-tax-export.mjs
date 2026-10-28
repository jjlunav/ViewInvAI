import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
let blob,clickHandler,refreshes=0;const alerts=[];
const context={Blob,Date,console,setTimeout:fn=>fn(),confirm:()=>true,alert:msg=>alerts.push(msg),
 window:{addEventListener:()=>{},ViewInvAIAuth:{apiFetch:async()=>({ok:false,json:async()=>({error:'Denied'})})}},
 document:{addEventListener:(name,fn)=>{if(name==='click')clickHandler=fn},getElementById:()=>{refreshes++;return null},body:{appendChild:()=>{}},createElement:()=>({click:()=>{},remove:()=>{}})},
 URL:{createObjectURL:value=>{blob=value;return 'blob:test'},revokeObjectURL:()=>{}}};
const source=fs.readFileSync(new URL('../tax.js',import.meta.url),'utf8');
// Expose the real exporter only within this isolated test context.
vm.runInNewContext(source.replace('window.ViewInvAITax={render,','window.ViewInvAITax={exportCsv,render,'),context);
const tax=context.window.ViewInvAITax;
for(const text of ['=1+1','+SUM(1,1)','-1+1','@SUM(1,1)','  =1+1','\t=1+1','\r=1+1','＝1+1','＋1+1','－1+1','＠SUM(1,1)']){
 tax.exportCsv({year:2026,sales:[{date:'2026-01-01',ticker:text,isin:'ISIN',quantity:2,currency:'EUR',price:10,fees:1,proceedsEur:20,costEur:30,gainEur:-10,computableEur:-10,broker:'Broker "quoted"; text'}],dividends:{items:[{date:'2026-01-01',name:text,currency:'EUR',grossEur:10,netEur:8}]}});
 const csv=await blob.text();
 assert.ok(csv.includes('"\'\t'+text.replace(/"/g,'""')+'"'),'Imported text must receive a literal prefix');
 assert.equal(csv.split('"\'\t'+text.replace(/"/g,'""')+'"').length-1,2,'Sales and dividends both escape text');
 assert.ok(csv.includes('"-10"'),'Negative numeric amounts must remain numeric');
 assert.ok(csv.includes('"Broker ""quoted""; text"'),'Quotes and separators stay inside one field');
}
const del={disabled:false,dataset:{taxDivDel:'dividend/1'}};
clickHandler({target:{closest:selector=>selector==='[data-tax-div-del]'?del:null}});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(del.disabled,false);assert.deepEqual(alerts,['Denied']);assert.equal(refreshes,0,'Rejected deletion must not refresh as success');
context.window.ViewInvAIAuth.apiFetch=async()=>{throw new Error('Offline')};
clickHandler({target:{closest:selector=>selector==='[data-tax-div-del]'?del:null}});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(del.disabled,false);assert.equal(alerts.at(-1),'Offline');
context.window.ViewInvAIAuth.apiFetch=async()=>({ok:true});
clickHandler({target:{closest:selector=>selector==='[data-tax-div-del]'?del:null}});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(refreshes,1,'Successful deletion refreshes the report');
assert.equal(alerts.length,2);
console.log('Fiscal CSV: literal imported text, numeric losses, rejected deletes: OK');
