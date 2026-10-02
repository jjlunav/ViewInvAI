/* ViewInvAI · Fiscal (IRPF España).
 * Lee /api/tax-report: FIFO por ISIN entre todas tus cuentas, importes en EUR con el
 * tipo BCE del día, regla de los dos meses y posiciones a 31/12 para el modelo 720.
 * Añade, con los precios en vivo, qué posiciones en pérdidas no conviene vender aún.
 * Cálculo orientativo: no sustituye a los informes fiscales del bróker ni a un asesor.
 */
(function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const eur=(v,d=2)=>Number.isFinite(+v)&&v!==null?Number(v).toLocaleString('es-ES',{style:'currency',currency:'EUR',minimumFractionDigits:d,maximumFractionDigits:d}):'—';
 const signed=v=>Number.isFinite(+v)&&v!==null?(v>0?'+':'')+eur(v):'—';
 const tone=v=>!Number.isFinite(+v)||v===null||Math.abs(v)<0.005?'':v>0?'positive':'negative';
 const qty=v=>Number(v).toLocaleString('es-ES',{maximumFractionDigits:4});
 const day=d=>{const x=new Date(String(d).slice(0,10)+'T12:00:00Z');return isNaN(x)?'—':x.toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'})};
 const LIMIT_720=50000;
 const thisYear=new Date().getFullYear();
 let year=thisYear,cache={},loading=null;

 const P=()=>window.ViewInvAIPortfolios||{};
 const signedIn=()=>typeof P().isSignedIn==='function'&&P().isSignedIn();

 async function load(y,force=false){
  const hit=cache[y];
  if(!force&&hit&&Date.now()-hit.at<5*60e3)return hit.data;
  const res=await window.ViewInvAIAuth.apiFetch('/api/tax-report?year='+y);
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||'No se pudo calcular el informe fiscal.');
  cache[y]={at:Date.now(),data};
  return data;
 }

 function yearTabs(){
  return '<nav class="market-tabs compact-tabs tax-year-tabs" aria-label="Ejercicio">'+
   [thisYear,thisYear-1,thisYear-2].map(y=>'<button type="button" class="tab'+(y===year?' active':'')+'" data-tax-year="'+y+'" aria-pressed="'+(y===year)+'">'+y+'</button>').join('')+'</nav>';
 }

 function summaryHtml(r){
  const t=r.totals||{};
  return '<section class="tax-card tax-summary">'+
   '<small>RESULTADO '+r.year+(r.year===thisYear?' · HASTA HOY':'')+'</small>'+
   '<strong class="'+tone(t.netEur)+'">'+signed(t.netEur)+'</strong>'+
   '<div class="tax-chips">'+
    '<span class="positive">Ganancias '+eur(t.gainsEur)+'</span>'+
    '<span class="negative">Pérdidas '+eur(t.lossesEur)+'</span>'+
    (t.blockedLossEur?'<span class="warn" title="Pérdidas que no puedes compensar este año por recompra en dos meses">Diferidas '+eur(t.blockedLossEur)+'</span>':'')+
   '</div>'+
   '<p>'+t.sales+(t.sales===1?' venta':' ventas')+' · transmisión '+eur(t.proceedsEur,0)+' · adquisición '+eur(t.costEur,0)+'</p>'+
   '<p class="tax-hint">Va en la declaración como ganancias y pérdidas por transmisión de acciones admitidas a negociación. Se compensan con otras del ahorro; un saldo negativo se arrastra cuatro años.</p>'+
   (t.incomplete?'<p class="tax-warn">'+t.incomplete+' venta(s) sin coste completo: importa el historial de compras de ese valor.</p>':'')+
  '</section>';
 }

 // Positions now in loss with a purchase in the last two months: selling them today
 // would leave the loss deferred (art. 33.5.f LIRPF).
 function beforeSellHtml(){
  if(year!==thisYear||typeof P().getPositionsDetail!=='function')return'';
  const now=Date.now(),rows=P().getPositionsDetail().filter(p=>p.pnlEur!==null&&p.pnlEur<0&&p.lastBuyAt&&now-new Date(p.lastBuyAt).getTime()<61*864e5);
  if(!rows.length)return'';
  const item=p=>{
   const free=new Date(new Date(p.lastBuyAt).getTime()+61*864e5);
   return '<div class="tax-row" data-open-stock="'+esc(p.stockKey)+'" data-stock-prefer-tr="'+(p.preferTr?'1':'0')+'" role="button" tabindex="0"><div><b>'+esc(p.ticker)+'</b><small>'+esc(p.name)+'</small></div><div class="tax-row-num"><span class="negative">'+signed(p.pnlEur)+'</span><small>sin bloqueo desde '+esc(free.toLocaleDateString('es-ES',{day:'2-digit',month:'short'}))+'</small></div></div>';
  };
  return '<section class="tax-card tax-before-sell"><header><small>ANTES DE VENDER</small><h2>Regla de los dos meses</h2></header>'+
   '<p class="tax-hint">Compraste estos valores hace menos de dos meses y ahora van en pérdidas. Si los vendes antes de la fecha indicada, esa pérdida no se podrá compensar este año.</p>'+
   rows.map(item).join('')+'</section>';
 }

 function salesHtml(r){
  const sales=(r.sales||[]).slice().reverse();
  if(!sales.length)return '<section class="tax-card"><header><small>VENTAS</small><h2>Sin ventas en '+r.year+'</h2></header><p class="tax-hint">Cuando vendas (o importes ventas desde tu bróker) aparecerán aquí con su cálculo FIFO.</p></section>';
  const row=s=>{
   const blocked=s.blockedLossEur?'<em class="tax-badge">2 meses: '+eur(s.blockedLossEur)+' diferidos</em>':'';
   const lots=(s.lots||[]).map(l=>'<li><span>'+day(l.date)+'</span><span>'+qty(l.quantity)+' uds</span><span>'+eur(l.costEur)+'</span><span>'+esc(l.broker||'')+'</span></li>').join('');
   return '<details class="tax-sale"><summary>'+
     '<div class="tax-sale-main"><b>'+esc(s.ticker)+'</b><small>'+day(s.date)+' · '+qty(s.quantity)+' uds'+(s.broker?' · '+esc(s.broker):'')+'</small>'+blocked+'</div>'+
     '<div class="tax-row-num"><span class="'+tone(s.computableEur)+'">'+signed(s.computableEur)+'</span><small>'+eur(s.proceedsEur,0)+' − '+eur(s.costEur,0)+'</small></div>'+
    '</summary>'+
    '<div class="tax-sale-detail">'+
     '<p>Transmisión: '+qty(s.quantity)+' × '+Number(s.price).toLocaleString('es-ES',{maximumFractionDigits:4})+' '+esc(s.currency)+' − comisión '+Number(s.fees||0).toLocaleString('es-ES',{maximumFractionDigits:2})+' '+esc(s.currency)+(s.currency!=='EUR'&&s.fxRate?' · BCE 1 € = '+Number(s.fxRate).toLocaleString('es-ES',{maximumFractionDigits:4})+' '+esc(s.currency):'')+'</p>'+
     '<p>Lotes consumidos (FIFO):</p><ul class="tax-lots">'+lots+'</ul>'+
     (s.blockedQty?'<p class="tax-warn">'+qty(s.blockedQty)+' uds recompradas en ±2 meses: la parte proporcional de la pérdida se integrará cuando vendas esos títulos.</p>':'')+
    '</div></details>';
  };
  return '<section class="tax-card"><header><small>VENTAS '+r.year+'</small><h2>Detalle FIFO</h2><button type="button" class="today-link" data-tax-export>CSV ⇩</button></header>'+sales.map(row).join('')+'</section>';
 }

 function model720Html(r){
  const byBroker={};
  for(const h of r.holdings||[])for(const [b,v] of Object.entries(h.byBroker||{})){byBroker[b]=byBroker[b]||{cost:0,count:0};byBroker[b].cost+=v.costEur||0;byBroker[b].count++}
  // Current year: value at market with live prices when the position is known.
  let market=null;
  if(year===thisYear&&typeof P().getPositionsDetail==='function'){
   const live=P().getPositionsDetail();market={};
   for(const p of live){const b=p.broker||'Sin bróker';if(p.valueEur!==null)market[b]=(market[b]||0)+p.valueEur}
  }
  const brokers=Object.keys({...byBroker,...(market||{})});
  if(!brokers.length)return'';
  const total=brokers.reduce((a,b)=>a+((market&&market[b])??(byBroker[b]&&byBroker[b].cost)??0),0);
  const over=total>=LIMIT_720;
  const rows=brokers.map(b=>'<div class="tax-row"><div><b>'+esc(b)+'</b><small>'+((byBroker[b]&&byBroker[b].count)||0)+' valores</small></div><div class="tax-row-num"><span>'+eur(market&&market[b]!=null?market[b]:byBroker[b]&&byBroker[b].cost,0)+'</span><small>'+(market&&market[b]!=null?'a precio actual':'a coste')+'</small></div></div>').join('');
  return '<section class="tax-card tax-720"><header><small>MODELO 720 / 721 · '+(year===thisYear?'ESTIMACIÓN HOY':'A 31/12/'+year)+'</small><h2>'+(over?'Revisa si debes presentar el 720':'Por debajo del umbral')+'</h2></header>'+
   '<div class="tax-meter"><i class="'+(over?'over':'')+'" data-tax-meter="'+Math.min(100,total/LIMIT_720*100).toFixed(1)+'"></i></div>'+
   '<p class="tax-hint">'+eur(total,0)+' de '+eur(LIMIT_720,0)+'. El 720 obliga si los valores depositados en el extranjero (IBKR; Trade Republic custodia en Alemania) superan 50.000 € a 31 de diciembre; si ya lo presentaste, solo vuelve a ser obligatorio cuando el saldo varía más de 20.000 €.</p>'+
   rows+'</section>';
 }

 function notesHtml(r){
  const w=(r.warnings||[]).slice(0,6);
  return '<section class="tax-card tax-notes">'+
   (w.length?'<ul>'+w.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')+
   '<p class="tax-hint">Cálculo orientativo con tus operaciones registradas en ViewInvAI (FIFO por ISIN, comisiones incluidas, cambio oficial del BCE de cada fecha). Dividendos, intereses y retenciones no se incluyen. Contrástalo con el informe fiscal de tu bróker.</p></section>';
 }

 function exportCsv(r){
  const head=['Fecha','Valor','ISIN','Cantidad','Divisa','Precio','Comisión','Tipo BCE','Transmisión EUR','Adquisición EUR','Resultado EUR','Pérdida diferida EUR','Computable EUR','Bróker'];
  const n=v=>v===null||v===undefined?'':String(Math.round(Number(v)*100)/100).replace('.',',');
  const lines=[head.join(';')].concat((r.sales||[]).map(s=>[s.date,s.ticker,s.isin,String(s.quantity).replace('.',','),s.currency,String(s.price).replace('.',','),n(s.fees),s.fxRate?String(s.fxRate).replace('.',','):'1',n(s.proceedsEur),n(s.costEur),n(s.gainEur),n(s.blockedLossEur),n(s.computableEur),s.broker].map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';')));
  const blob=new Blob(['﻿'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='viewinvai-fiscal-'+r.year+'.csv';
  document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
 }

 function paintMeters(box){box.querySelectorAll('[data-tax-meter]').forEach(el=>el.style.setProperty('width',el.dataset.taxMeter+'%'))}

 async function render(force=false){
  const box=document.getElementById('taxResults');if(!box)return;
  if(!signedIn()){
   box.innerHTML=yearTabs()+'<section class="tax-card today-signin"><div><small>FISCAL</small><strong>Inicia sesión para calcular tu IRPF</strong><span>Plusvalías FIFO en euros, regla de los dos meses y control del modelo 720 con tus operaciones.</span></div><button type="button" class="btn portfolio-google-login">Entrar con Google</button></section>';
   return;
  }
  box.innerHTML=yearTabs()+'<section class="tax-card"><div class="today-loading">Calculando '+year+' con tus operaciones…</div></section>';
  const wanted=year;
  try{
   loading=load(wanted,force);const r=await loading;
   if(wanted!==year)return;
   box.innerHTML=yearTabs()+summaryHtml(r)+beforeSellHtml()+salesHtml(r)+model720Html(r)+notesHtml(r);
   paintMeters(box);
   box._report=r;
  }catch(e){
   box.innerHTML=yearTabs()+'<section class="tax-card"><p class="tax-warn">'+esc(e.message)+'</p><button type="button" class="btn" data-tax-retry>Reintentar</button></section>';
  }
 }

 document.addEventListener('click',e=>{
  const y=e.target.closest&&e.target.closest('[data-tax-year]');
  if(y){year=Number(y.dataset.taxYear)||thisYear;render();return}
  if(e.target.closest&&e.target.closest('[data-tax-retry]')){render(true);return}
  if(e.target.closest&&e.target.closest('[data-tax-export]')){const box=document.getElementById('taxResults');if(box&&box._report)exportCsv(box._report)}
 });
 const refresh=()=>{cache={};if(typeof state!=='undefined'&&state.currentView==='tax')render()};
 ['viewinvai:portfolio-membership-changed','viewinvai:auth-changed','viewinvai:account-ready'].forEach(n=>window.addEventListener(n,()=>setTimeout(refresh,80)));
 window.ViewInvAITax={render,_invalidate:()=>{cache={}}};
})();
