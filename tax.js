/* ViewInvAI · Fiscal (IRPF España).
 * Lee /api/tax-report: FIFO por ISIN entre todas tus cuentas, importes en EUR con el
 * tipo BCE del día, regla de los dos meses y posiciones a 31/12 para el modelo 720.
 * Añade, con los precios en vivo, qué posiciones en pérdidas no conviene vender aún, los
 * dividendos con la deducción por doble imposición y una estimación de la cuota del ahorro.
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
  // El año siempre es el pedido, aunque el servidor no lo devuelva.
  if(data&&typeof data==='object'&&!data.year)data.year=y;
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
    (t.pendingDeferredEur?'<span class="warn" title="Pérdidas por recompra en dos meses cuyos títulos recomprados sigues teniendo: se integrarán cuando los vendas">Diferidas pendientes '+eur(t.pendingDeferredEur)+'</span>':'')+
   '</div>'+
   '<p>'+t.sales+(t.sales===1?' venta':' ventas')+' · transmisión '+eur(t.proceedsEur,0)+' · adquisición '+eur(t.costEur,0)+(t.realEur!=null?' · resultado real '+signed(t.realEur):'')+'</p>'+
   (t.blockedLossEur?'<p class="tax-hint">Regla de los dos meses: '+eur(t.blockedLossEur)+' de pérdidas se aplazaron por recomprar en ±2 meses'+(t.releasedLossEur?' y '+eur(t.releasedLossEur)+' se han integrado al vender después esos títulos recomprados':'')+'.'+(t.pendingDeferredEur?' Siguen pendientes '+eur(t.pendingDeferredEur)+' porque aún tienes esos títulos.':' No queda nada pendiente.')+'</p>':'')+
   '<p class="tax-hint">Va en la declaración como ganancias y pérdidas por transmisión de acciones admitidas a negociación. Se compensan con otras del ahorro; un saldo negativo se arrastra cuatro años.</p>'+
   (t.incomplete?'<p class="tax-warn">'+t.incomplete+' venta(s) sin coste completo: importa el historial de compras de ese valor.</p>':'')+
  '</section>';
 }

 // Positions now in loss with a purchase in the last two months: selling them today
 // would leave the loss deferred (art. 33.5.f LIRPF).
 // De dónde salen los datos y qué puede estar mal: duplicados y precios fuera de rango.
 function auditHtml(r){
  const a=r.audit;if(!a)return'';
  const origins=Object.entries(a.byOrigin||{}).sort((x,y)=>(y[1].buys+y[1].sells)-(x[1].buys+x[1].sells));
  const dups=a.duplicates||[],outs=a.outliers||[];
  const num=v=>Number(v).toLocaleString('es-ES',{maximumFractionDigits:4});
  const delBtn=id=>'<button type="button" class="tax-div-del" data-tax-tx-del="'+esc(id)+'" title="Borrar esta operación" aria-label="Borrar esta operación">✕</button>';
  return '<section class="tax-card tax-audit"><header><small>REVISIÓN DE TUS DATOS</small><h2>'+(dups.length||outs.length?'⚠️ Hay operaciones que revisar':'✅ Sin problemas detectados')+'</h2></header>'+
   '<p class="tax-hint">Todo se calcula con las operaciones guardadas en tu cuenta ('+a.total+' en '+r.year+'): importadas de tu bróker, añadidas a mano o registradas desde el Objetivo. Si el resultado no cuadra con tu bróker, revisa aquí.</p>'+
   '<ul class="tax-audit-origins">'+origins.map(([k,v])=>'<li><b>'+esc(k)+'</b><span>'+v.buys+' compras · '+v.sells+' ventas</span></li>').join('')+'</ul>'+
   (dups.length?'<h3>Posibles duplicados ('+dups.length+')</h3><p class="tax-hint">Misma acción, sentido, cantidad y precio el mismo día. Si es la misma operación guardada dos veces, borra la sobrante.</p>'+
     dups.map(d=>'<div class="tax-audit-item"><div><b>'+esc(d.ticker||d.name)+'</b> · '+(d.side==='SELL'?'venta':'compra')+' '+num(d.quantity)+' × '+num(d.price)+' '+esc(d.currency)+' · '+day(d.date)+'</div><ul>'+
      d.items.map(i=>'<li><span>'+esc(i.origin)+(i.broker?' · '+esc(i.broker):'')+'</span>'+delBtn(i.id)+'</li>').join('')+'</ul></div>').join(''):'')+
   (outs.length?'<h3>Precios fuera de rango ('+outs.length+')</h3><p class="tax-hint">El precio es más de 4 veces mayor o menor que el habitual de esa acción: suele ser un error de unidades o de divisa.</p>'+
     outs.map(o=>'<div class="tax-audit-item"><div><b>'+esc(o.ticker)+'</b> · '+(o.side==='SELL'?'venta':'compra')+' '+num(o.quantity)+' × '+num(o.price)+' '+esc(o.currency)+' (habitual '+num(o.median)+') · '+day(o.date)+' · '+esc(o.origin)+'</div>'+delBtn(o.id)+'</div>').join(''):'')+
  '</section>';
 }

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
   const blocked=(s.blockedLossEur?'<em class="tax-badge">2 meses: '+eur(s.blockedLossEur)+' diferidos</em>':'')+(s.releasedLossEur?'<em class="tax-badge">integra '+eur(s.releasedLossEur)+' diferidos</em>':'');
   const lots=(s.lots||[]).map(l=>'<li><span>'+day(l.date)+'</span><span>'+qty(l.quantity)+' uds</span><span>'+eur(l.costEur)+'</span><span>'+esc(l.broker||'')+'</span></li>').join('');
   return '<details class="tax-sale"><summary>'+
     '<div class="tax-sale-main"><b>'+esc(s.ticker)+'</b><small>'+day(s.date)+' · '+qty(s.quantity)+' uds'+(s.broker?' · '+esc(s.broker):'')+'</small>'+blocked+'</div>'+
     '<div class="tax-row-num"><span class="'+tone(s.computableEur)+'">'+signed(s.computableEur)+'</span><small>'+eur(s.proceedsEur,0)+' − '+eur(s.costEur,0)+'</small></div>'+
    '</summary>'+
    '<div class="tax-sale-detail">'+
     '<p>Transmisión: '+qty(s.quantity)+' × '+Number(s.price).toLocaleString('es-ES',{maximumFractionDigits:4})+' '+esc(s.currency)+' − comisión '+Number(s.fees||0).toLocaleString('es-ES',{maximumFractionDigits:2})+' '+esc(s.currency)+(s.currency!=='EUR'&&s.fxRate?' · BCE 1 € = '+Number(s.fxRate).toLocaleString('es-ES',{maximumFractionDigits:4})+' '+esc(s.currency):'')+'</p>'+
     '<p>Lotes consumidos (FIFO):</p><ul class="tax-lots">'+lots+'</ul>'+
     (s.blockedQty?'<p class="tax-warn">'+qty(s.blockedQty)+' uds recompradas en ±2 meses: la parte proporcional de la pérdida se integrará cuando vendas esos títulos.</p>':'')+
     (s.releasedLossEur?'<p class="tax-hint">En esta venta se transmiten títulos recomprados: se integran '+eur(s.releasedLossEur)+' de pérdidas que estaban diferidas.</p>':'')+
     (s.carriedLossEur?'<p class="tax-warn">'+eur(s.carriedLossEur)+' de pérdidas diferidas siguen aplazadas: volviste a comprar este valor en ±2 meses de esta venta.</p>':'')+
    '</div></details>';
  };
  return '<section class="tax-card"><header><small>VENTAS '+r.year+'</small><h2>Detalle FIFO</h2><button type="button" class="today-link" data-tax-export>CSV ⇩</button></header>'+sales.map(row).join('')+'</section>';
 }

 const COUNTRY={US:'EEUU',DE:'Alemania',FR:'Francia',NL:'Países Bajos',CH:'Suiza',CA:'Canadá',IT:'Italia',BE:'Bélgica',GB:'Reino Unido',IE:'Irlanda',ES:'España',DK:'Dinamarca',SE:'Suecia',NO:'Noruega',FI:'Finlandia',JP:'Japón',AU:'Australia',PT:'Portugal',LU:'Luxemburgo',AT:'Austria'};
 function dividendsHtml(r){
  const d=r.dividends||{totals:{}},t=d.totals||{};
  const form='<details class="tax-div-add"><summary>＋ Añadir dividendo a mano</summary>'+
   '<form data-tax-div-form class="tax-div-form">'+
    '<label><span>Fecha de cobro</span><input type="date" name="paidAt" required max="'+new Date().toISOString().slice(0,10)+'"></label>'+
    '<label><span>Valor (ticker o nombre)</span><input name="ticker" required maxlength="60" placeholder="AAPL"></label>'+
    '<label><span>ISIN</span><input name="isin" maxlength="12" placeholder="US0378331005" autocapitalize="characters"></label>'+
    '<label><span>Divisa</span><select name="currency">'+['EUR','USD','GBP','CHF','CAD','DKK','SEK','NOK','JPY'].map(c=>'<option>'+c+'</option>').join('')+'</select></label>'+
    '<label><span>Importe bruto</span><input type="number" name="gross" step="any" min="0.0001" required inputmode="decimal"></label>'+
    '<label><span>Retención en origen</span><input type="number" name="withholding" step="any" min="0" value="0" inputmode="decimal"></label>'+
    '<button type="submit" class="btn">Guardar dividendo</button><p class="tax-hint" data-tax-div-status></p>'+
   '</form></details>';
  if(!t.count)return '<section class="tax-card tax-dividends"><header><small>DIVIDENDOS '+r.year+'</small><h2>Sin dividendos registrados</h2></header><p class="tax-hint">Impórtalos con ⇩ en Carteras (CSV de Trade Republic o IBKR con «Cash Transactions») o añádelos aquí. Calculamos la retención deducible por doble imposición.</p>'+form+'</section>';
  const countries=(d.byCountry||[]).map(c=>{
   const name=COUNTRY[c.country]||c.country;
   const note=c.excessEur>0.005?'<small class="tax-warn-inline">'+eur(c.excessEur)+' retenidos por encima del '+Math.round(c.cap*100)+' % del convenio: no se deducen en España'+(c.country==='US'?' (firma el W-8BEN en tu bróker)':'; se reclaman en '+esc(name))+'.</small>':'';
   return '<div class="tax-row"><div><b>'+esc(name)+'</b><small>bruto '+eur(c.grossEur)+(c.withholdingEur?' · retenido '+eur(c.withholdingEur):'')+'</small>'+note+'</div><div class="tax-row-num"><span>'+eur(c.deductibleEur)+'</span><small>deducible</small></div></div>';
  }).join('');
  const items=(d.items||[]).map(x=>'<li><span>'+day(x.date)+'</span><b>'+esc(x.ticker||x.name||x.isin)+'</b><em>'+eur(x.grossEur)+'</em><small>'+(x.withholdingEur?'−'+eur(x.withholdingEur)+' origen':'')+(x.withholdingEsEur?' −'+eur(x.withholdingEsEur)+' España':'')+(x.currency!=='EUR'?' · '+esc(x.currency):'')+'</small><button type="button" class="tax-div-del" data-tax-div-del="'+esc(x.id)+'" aria-label="Borrar dividendo">✕</button></li>').join('');
  return '<section class="tax-card tax-dividends"><header><small>DIVIDENDOS '+r.year+'</small><h2>'+eur(t.grossEur)+' brutos</h2></header>'+
   '<div class="tax-chips"><span>'+t.count+' cobros</span>'+(t.withholdingEur?'<span class="warn">Retenido fuera '+eur(t.withholdingEur)+'</span>':'')+(t.deductibleEur?'<span class="positive">Deducible '+eur(t.deductibleEur)+'</span>':'')+(t.withholdingEsEur?'<span>Retención España '+eur(t.withholdingEsEur)+'</span>':'')+'</div>'+
   '<div class="tax-boxes"><div><small>Casilla 0029</small><b>'+eur(t.grossEur)+'</b><span>Dividendos: ingresos íntegros</span></div><div><small>Casilla 0588</small><b>'+eur(t.deductibleEur)+'</b><span>Deducción doble imposición internacional</span></div>'+(t.withholdingEsEur?'<div><small>Retenciones</small><b>'+eur(t.withholdingEsEur)+'</b><span>Practicadas en España</span></div>':'')+'</div>'+
   countries+
   '<details class="tax-div-list"><summary>Ver los '+t.count+' cobros</summary><ul>'+items+'</ul></details>'+form+'</section>';
 }

 // Rough savings-base tax for the year with the 2025+ brackets (19-30 %).
 function savingsHtml(r){
  const sv=r.savings;if(!sv)return'';
  const t=r.totals||{},dv=(r.dividends&&r.dividends.totals)||{};
  if(!t.sales&&!dv.count)return'';
  const due=sv.dueEur;
  return '<section class="tax-card tax-savings"><header><small>CUOTA ESTIMADA DEL AHORRO · '+r.year+'</small><h2 class="'+(due>0?'negative':due<0?'positive':'')+'">'+(due<0?'A devolver '+eur(-due):'A pagar '+eur(Math.max(0,due)))+'</h2></header>'+
   '<div class="tax-calc">'+
    '<div><span>Base del ahorro</span><b>'+eur(sv.baseEur)+'</b></div>'+
    '<div><span>Cuota (19 % – 30 %)</span><b>'+eur(sv.taxEur)+'</b></div>'+
    (sv.deductionEur?'<div><span>− Doble imposición internacional</span><b>'+eur(sv.deductionEur)+'</b></div>':'')+
    (sv.withheldEsEur?'<div><span>− Retenciones en España</span><b>'+eur(sv.withheldEsEur)+'</b></div>':'')+
   '</div>'+
   (sv.lossCarryEur<0?'<p class="tax-hint">Quedan '+eur(-sv.lossCarryEur)+' de pérdidas para compensar en los cuatro años siguientes.</p>':'')+
   '<p class="tax-hint">Solo con las ventas y dividendos registrados aquí. Las pérdidas compensan hasta el 25 % de los dividendos y al revés. No incluye intereses, fondos ni saldos de años anteriores.</p></section>';
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
   '<p class="tax-hint">Cálculo orientativo con tus operaciones y dividendos registrados en ViewInvAI (FIFO por ISIN, comisiones incluidas, cambio oficial del BCE de cada fecha; deducción por doble imposición limitada al tipo del convenio, en general el 15 %). Los intereses no se incluyen. Las casillas son las de Renta Web de los últimos ejercicios: compruébalas al presentar. Contrástalo con el informe fiscal de tu bróker.</p></section>';
 }

 function exportCsv(r){
  const head=['Fecha','Valor','ISIN','Cantidad','Divisa','Precio','Comisión','Tipo BCE','Transmisión EUR','Adquisición EUR','Resultado EUR','Pérdida diferida EUR','Diferida integrada EUR','Computable EUR','Bróker'];
  const n=v=>v===null||v===undefined?'':String(Math.round(Number(v)*100)/100).replace('.',',');
  const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const lines=[head.join(';')].concat((r.sales||[]).map(s=>[s.date,s.ticker,s.isin,String(s.quantity).replace('.',','),s.currency,String(s.price).replace('.',','),n(s.fees),s.fxRate?String(s.fxRate).replace('.',','):'1',n(s.proceedsEur),n(s.costEur),n(s.gainEur),n(s.blockedLossEur),n(s.releasedLossEur),n(s.computableEur),s.broker].map(q).join(';')));
  const divs=(r.dividends&&r.dividends.items)||[];
  if(divs.length){
   lines.push('','Dividendos','Fecha;Valor;ISIN;País;Divisa;Tipo BCE;Bruto EUR;Retención origen EUR;Deducible EUR;Retención España EUR;Neto EUR');
   divs.forEach(x=>lines.push([x.date,x.ticker||x.name,x.isin,x.country,x.currency,x.fxRate?String(x.fxRate).replace('.',','):'1',n(x.grossEur),n(x.withholdingEur),n(x.deductibleEur),n(x.withholdingEsEur),n(x.netEur)].map(q).join(';')));
  }
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
   box.innerHTML=yearTabs()+auditHtml(r)+summaryHtml(r)+dividendsHtml(r)+savingsHtml(r)+beforeSellHtml()+salesHtml(r)+model720Html(r)+notesHtml(r);
   paintMeters(box);
   box._report=r;
  }catch(e){
   box.innerHTML=yearTabs()+'<section class="tax-card"><p class="tax-warn">'+esc(e.message)+'</p><button type="button" class="btn" data-tax-retry>↻ Reintentar</button></section>';
  }
 }

 document.addEventListener('click',e=>{
  const y=e.target.closest&&e.target.closest('[data-tax-year]');
  if(y){year=Number(y.dataset.taxYear)||thisYear;render();return}
  if(e.target.closest&&e.target.closest('[data-tax-retry]')){render(true);return}
  if(e.target.closest&&e.target.closest('[data-tax-export]')){const box=document.getElementById('taxResults');if(box&&box._report)exportCsv(box._report);return}
  const txDel=e.target.closest&&e.target.closest('[data-tax-tx-del]');
  if(txDel){
   if(!confirm('¿Borrar esta operación? Se recalculará la posición y el informe.'))return;
   txDel.disabled=true;
   window.ViewInvAIAuth.apiFetch('/api/transactions/'+encodeURIComponent(txDel.dataset.taxTxDel),{method:'DELETE'})
    .then(async res=>{if(!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d.error||'No se pudo borrar.')}cache={};window.dispatchEvent(new CustomEvent('viewinvai:portfolio-membership-changed'));render(true)})
    .catch(err=>{alert(err.message);txDel.disabled=false});
   return;
  }
  const del=e.target.closest&&e.target.closest('[data-tax-div-del]');
  if(del){
   if(!confirm('¿Borrar este dividendo?'))return;
   del.disabled=true;
   window.ViewInvAIAuth.apiFetch('/api/dividends/'+encodeURIComponent(del.dataset.taxDivDel),{method:'DELETE'}).then(()=>{cache={};render(true)}).catch(()=>{del.disabled=false});
  }
 });
 document.addEventListener('submit',async e=>{
  const f=e.target.closest&&e.target.closest('[data-tax-div-form]');if(!f)return;
  e.preventDefault();
  const st=f.querySelector('[data-tax-div-status]'),fd=new FormData(f),btn=f.querySelector('button[type=submit]');
  const v=String(fd.get('ticker')||'').trim();
  const body={paidAt:fd.get('paidAt')+'T12:00:00Z',ticker:/^[A-Za-z.\-]{1,8}$/.test(v)?v.toUpperCase():'',name:/^[A-Za-z.\-]{1,8}$/.test(v)?'':v,isin:String(fd.get('isin')||'').trim().toUpperCase(),currency:fd.get('currency'),gross:Number(String(fd.get('gross')).replace(',','.')),withholding:Number(String(fd.get('withholding')||0).replace(',','.'))||0};
  btn.disabled=true;if(st)st.textContent='Guardando…';
  try{
   const res=await window.ViewInvAIAuth.apiFetch('/api/dividends',{method:'POST',body:JSON.stringify(body)});
   const data=await res.json().catch(()=>({}));
   if(!res.ok)throw new Error(data.error||'No se pudo guardar.');
   const y=Number(String(fd.get('paidAt')).slice(0,4));if(y)year=y;
   cache={};render(true);
  }catch(err){if(st)st.textContent=err.message;btn.disabled=false}
 });
 const refresh=()=>{cache={};if(typeof state!=='undefined'&&state.currentView==='tax')render()};
 ['viewinvai:portfolio-membership-changed','viewinvai:auth-changed','viewinvai:account-ready'].forEach(n=>window.addEventListener(n,()=>setTimeout(refresh,80)));
 window.ViewInvAITax={render,_invalidate:()=>{cache={}}};
})();
