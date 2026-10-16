/* ViewInvAI · decisiones ante avisos que piden actuar (solo compra o venta).
 * Cuando el análisis recomienda vender una posición, el aviso queda en el globo flotante como
 * pregunta: mantener (no vender en pérdidas), vender o decidir más tarde. Una señal de compra
 * del Radar en un favorito pregunta: voy a comprar, no compro o más tarde. El resto de avisos
 * (noticias, eventos, niveles, cambios de score) siguen solo en la bandeja de Avisos.
 * Cada pregunta incluye un plan de recuperación: subida necesaria, efecto de promediar y
 * compensación fiscal si se vendiera. Con «mantener» el backend deja de insistir en vender
 * y avisa al recuperar el precio de compra, si conviene promediar o si cae mucho más.
 */
(function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const num=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
 const fmt=(v,d=2)=>Number(v).toLocaleString('es-ES',{minimumFractionDigits:d,maximumFractionDigits:d});
 const money=(v,c)=>{try{return Number(v).toLocaleString('es-ES',{style:'currency',currency:c||'EUR',minimumFractionDigits:2,maximumFractionDigits:2})}catch(_){return fmt(v)+' '+c}};
 const signed=v=>(v>0?'+':'')+fmt(v,1)+' %';
 let state={pending:[],decisions:[],positions:[]},loadedAt=0,loading=null,taxNet=null,taxYear=0;
 const answered=new Set(); // avisos ya contestados en esta sesión (por si una recarga llega antes que el servidor)

 const auth=()=>window.ViewInvAIAuth;
 const signedIn=()=>!!(auth()&&typeof auth().getUser==='function'&&auth().getUser());
 function api(path,opt){return auth().apiFetch(path,opt)}

 // Precio actual en la divisa de la posición (y su equivalente en EUR para la parte fiscal).
 function priceFor(pos){
  const stock=typeof window.stockByKey==='function'?window.stockByKey(pos.stock_key):null;
  if(!stock||!window.ViewInvAI||typeof window.ViewInvAI.getCanonicalQuote!=='function')return{price:null,eurRate:null};
  const q=window.ViewInvAI.getCanonicalQuote(stock,Number(pos.prefer_tr)===1)||{};
  const cur=String(pos.currency||'').toUpperCase();
  const price=cur==='EUR'?num(q.eur)??(String(q.nativeCurrency||'').toUpperCase()==='EUR'?num(q.price):null)
   :cur==='USD'?num(q.usd)??(String(q.nativeCurrency||'').toUpperCase()==='USD'?num(q.price):null):null;
  const eur=num(q.eur);
  return{price,eurRate:price&&eur?eur/price:cur==='EUR'?1:null};
 }

 function planHtml(pos,kind){
  const qty=num(pos.quantity),avg=num(pos.avg_price),cur=pos.currency||'EUR';
  const {price,eurRate}=priceFor(pos);
  if(qty===null||avg===null||avg<=0||price===null)return'<small>No hay precio actual para calcular el plan de recuperación.</small>';
  const pct=(price/avg-1)*100,pnl=(price-avg)*qty;
  const rows=[];
  rows.push('<li><b>Situación</b><span>'+money(price,cur)+' frente a tu media de '+money(avg,cur)+' · <em class="'+(pnl>=0?'pos':'neg')+'">'+signed(pct)+' ('+money(pnl,cur)+')</em></span></li>');
  if(pct<0){
   const need=(avg/price-1)*100;
   rows.push('<li><b>Para recuperar</b><span>Hace falta una subida del <em>'+signed(need)+'</em> hasta '+money(avg,cur)+'.</span></li>');
   // Promediar: comprar la mitad o lo mismo que ya tienes al precio actual.
   const half=Math.max(1,Math.round(qty/2)),avgHalf=(avg*qty+price*half)/(qty+half),avgSame=(avg+price)/2;
   rows.push('<li><b>Si promedias</b><span>Comprando '+fmt(half,0)+' más (≈ '+money(half*price,cur)+') tu media baja a '+money(avgHalf,cur)+' y bastaría '+signed((avgHalf/price-1)*100)+'. Duplicando la posición: '+money(avgSame,cur)+' ('+signed((avgSame/price-1)*100)+'). Solo tiene sentido si la tesis sigue viva: aumenta tu exposición.</span></li>');
   const lossEur=eurRate?Math.abs(pnl)*eurRate:null;
   if(lossEur){
    let fiscal='Si vendieras, la pérdida (≈ '+money(lossEur,'EUR')+') compensa ganancias del año en el IRPF';
    if(taxNet!==null&&taxNet>0){const off=Math.min(lossEur,taxNet);fiscal+=': este año llevas '+money(taxNet,'EUR')+' de ganancias, así que ahorrarías ≈ '+money(off*0.19,'EUR')+' de impuestos'}
    else fiscal+=' (y las de los 4 años siguientes)';
    rows.push('<li><b>Si vendes</b><span>'+fiscal+'. Ojo: si recompras el mismo valor en los 2 meses siguientes no puedes aplicar la pérdida todavía.</span></li>');
   }
  }else{
   rows.push('<li><b>Sin pérdidas</b><span>Ya estás por encima de tu precio medio: puedes vender sin perder o mantener para buscar más subida.</span></li>');
  }
  return '<ul class="decision-plan">'+rows.join('')+'</ul>';
 }

 const ALERT_LABEL={'position-sell':'El análisis sugiere vender','position-recovered':'Ha recuperado tu precio de compra','radar-ai':'Señal de compra del Radar AI'};
 // Señal de compra en un favorito: compraré / no compro / más tarde.
 function buyItemFor(row){
  const {alert,watch:w}=row;
  const stock=typeof window.stockByKey==='function'?window.stockByKey(w.stock_key):null;
  const preferTr=Number(w.prefer_tr)===1;
  const q=stock&&window.ViewInvAI&&typeof window.ViewInvAI.getCanonicalQuote==='function'?window.ViewInvAI.getCanonicalQuote(stock,preferTr)||{}:{};
  const price=num(q.price),cur=q.nativeCurrency||(preferTr?'EUR':'USD');
  const when=new Date(alert.created_at);
  const rows=[];
  if(price!==null)rows.push('<li><b>Precio ahora</b><span>'+money(price,cur)+(num(q.change)!==null?' · <em class="'+(q.change>=0?'pos':'neg')+'">'+signed(num(q.change))+' hoy</em>':'')+'</span></li>');
  if(num(w.last_score)!==null)rows.push('<li><b>Score</b><span>'+Math.round(w.last_score)+'/100'+(num(w.last_confidence)!==null?' · confianza '+Math.round(w.last_confidence)+' %':'')+'</span></li>');
  rows.push('<li><b>Antes de comprar</b><span>En la ficha tienes el plan de operación: entrada, stop y objetivo, y el tamaño según tu riesgo.</span></li>');
  return{
   id:'pd:'+w.id,
   pill:'¿Comprar? · '+(w.ticker||alert.ticker),
   title:(w.ticker||alert.ticker)+(w.name?' · '+w.name:''),
   when:Number.isFinite(when.getTime())?when.toLocaleDateString('es-ES',{day:'numeric',month:'short'})+' '+when.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'',
   text:ALERT_LABEL['radar-ai']+(alert.message?': '+alert.message:''),
   detailHtml:'<ul class="decision-plan">'+rows.join('')+'</ul><small class="decision-note">Si dices que no, no repetiré esta señal en 14 días. Si vas a comprar, registra la operación o impórtala después y la seguiré en Carteras. <button type="button" class="decision-link" data-decision-open="pd:'+esc(w.id)+'">Ver ficha y plan</button></small>',
   options:[{id:'buy',label:'Voy a comprar'},{id:'skip',label:'No compro'},{id:'later',label:'Decidir en 3 días'}],
   onOpen:()=>{if(stock&&typeof window.openStock==='function')window.openStock(stock,'decision',preferTr)},
   onAnswer:async choice=>{
    const res=await api('/api/position-decisions',{method:'POST',body:JSON.stringify({watchId:w.id,alertId:alert.id,decision:choice,price})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'No se pudo guardar la decisión.');
    answered.add(alert.id);state.pending=state.pending.filter(p=>p.alert.id!==alert.id);
    const msg=choice==='buy'?'Anotado: cuando compres '+(w.ticker||'')+', regístralo o impórtalo':choice==='skip'?'No repetiré la señal de '+(w.ticker||'')+' en 14 días':'Te lo vuelvo a preguntar en 3 días';
    if(window.ViewInvAIPortfolios&&typeof window.ViewInvAIPortfolios.toast==='function')window.ViewInvAIPortfolios.toast(msg);
    if(choice==='buy'&&stock&&typeof window.openStock==='function')window.openStock(stock,'decision',preferTr);
   }
  };
 }
 function itemFor(row){
  const {alert,position:pos}=row;
  const recovered=alert.alert_type==='position-recovered';
  const {price}=priceFor(pos);
  const avg=num(pos.avg_price);
  const inLoss=price!==null&&avg!==null&&price<avg;
  const options=recovered
   ?[{id:'sell',label:'Vender sin pérdidas'},{id:'hold',label:'Seguir manteniendo'}]
   :[{id:'hold',label:inLoss?'Mantener · no vender en pérdidas':'Mantener'},{id:'sell',label:'Vender'},{id:'later',label:'Decidir en 7 días'}];
  const when=new Date(alert.created_at);
  return{
   id:'pd:'+pos.id,
   pill:(recovered?'Recuperada · ':'¿Vender? · ')+(pos.ticker||alert.ticker),
   title:(pos.ticker||alert.ticker)+(pos.portfolio_name?' · '+pos.portfolio_name:''),
   when:Number.isFinite(when.getTime())?when.toLocaleDateString('es-ES',{day:'numeric',month:'short'})+' '+when.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'',
   text:(ALERT_LABEL[alert.alert_type]||alert.title||'Aviso de cartera')+(alert.message?': '+alert.message:''),
   detailHtml:planHtml(pos,alert.alert_type)+
    '<small class="decision-note">'+(recovered?'Si sigues manteniendo, te avisaré si vuelve a caer con fuerza.':'Con «Mantener» dejo de insistir en vender esta posición y te aviso cuando recupere tu precio de compra, si mejora lo bastante para promediar o si cae otro 15 %.')+
    ' <button type="button" class="decision-link" data-decision-open="pd:'+esc(pos.id)+'">▤ Ver ficha</button></small>',
   options,
   onOpen:()=>{const s=typeof window.stockByKey==='function'?window.stockByKey(pos.stock_key):null;if(s&&typeof window.openStock==='function')window.openStock(s,'decision',Number(pos.prefer_tr)===1)},
   onAnswer:async choice=>{
    const res=await api('/api/position-decisions',{method:'POST',body:JSON.stringify({positionId:pos.id,alertId:alert.id,decision:choice,price,days:7})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'No se pudo guardar la decisión.');
    state.decisions=state.decisions.filter(d=>d.position_id!==pos.id).concat(data.decision?[data.decision]:[]);
    answered.add(alert.id);state.pending=state.pending.filter(p=>p.alert.id!==alert.id);
    if(choice==='hold'&&!state.positions.some(p=>p.id===pos.id))state.positions.push(pos);
    window.dispatchEvent(new CustomEvent('viewinvai:decisions-changed'));
    const msg=choice==='hold'?'Mantienes '+(pos.ticker||'')+': vigilaré su recuperación':choice==='sell'?'Anotado: no repetiré el aviso de '+(pos.ticker||''):'Te lo vuelvo a preguntar en 7 días';
    if(window.ViewInvAIPortfolios&&typeof window.ViewInvAIPortfolios.toast==='function')window.ViewInvAIPortfolios.toast(msg);
   }
  };
 }

 function publish(){
  if(!window.ViewInvAITasks||typeof window.ViewInvAITasks.setDecisions!=='function')return;
  window.ViewInvAITasks.setDecisions(signedIn()?state.pending.filter(row=>!answered.has(row.alert.id)).map(row=>row.kind==='buy'?buyItemFor(row):itemFor(row)):[]);
 }
 async function loadTax(){
  const y=new Date().getFullYear();if(taxYear===y)return;
  try{const r=await api('/api/tax-report?year='+y);const d=await r.json().catch(()=>({}));if(r.ok){taxNet=num(d.totals&&d.totals.netEur);taxYear=y}}catch(_){}
 }
 async function load(force=false){
  if(!signedIn()){state={pending:[],decisions:[],positions:[]};publish();return}
  if(loading)return loading;
  if(!force&&Date.now()-loadedAt<5*60e3)return;
  loading=(async()=>{
   try{
    const r=await api('/api/position-decisions');const d=await r.json().catch(()=>({}));
    if(!r.ok)return;
    state={pending:d.pending||[],decisions:d.decisions||[],positions:d.positions||[]};loadedAt=Date.now();
    if(state.pending.some(p=>p.alert.alert_type==='position-sell'))await loadTax();
    publish();window.dispatchEvent(new CustomEvent('viewinvai:decisions-changed'));
   }catch(_){}
   finally{loading=null}
  })();
  return loading;
 }
 // Decisión vigente de una posición (para mostrarla en su tarjeta de Carteras).
 function forPosition(id){
  const d=state.decisions.find(x=>x.position_id===id);
  if(!d)return null;
  if(d.decision!=='hold'){const until=new Date(d.review_at||0).getTime();if(!(until>Date.now()))return null}
  return d;
 }
 async function clear(positionId){
  const r=await api('/api/position-decisions/'+encodeURIComponent(positionId),{method:'DELETE'});
  if(!r.ok)throw new Error('No se pudo quitar la decisión.');
  state.decisions=state.decisions.filter(d=>d.position_id!==positionId);
  window.dispatchEvent(new CustomEvent('viewinvai:decisions-changed'));
 }
 document.addEventListener('click',async e=>{
  const b=e.target.closest&&e.target.closest('[data-decision-clear]');if(!b)return;
  e.preventDefault();e.stopPropagation();
  if(!confirm('¿Quitar «mantener»? Volverás a recibir avisos de venta normales para esta posición.'))return;
  try{await clear(b.dataset.decisionClear)}catch(err){alert(err.message)}
 },true);
 ['viewinvai:auth-changed','viewinvai:account-ready'].forEach(n=>window.addEventListener(n,()=>{loadedAt=0;taxYear=0;setTimeout(()=>load(true),600)}));
 // Al volver a la app (p. ej. tras tocar la notificación push) se revisa si hay preguntas nuevas.
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)load(true)});
 window.addEventListener('viewinvai:push-received',()=>load(true));
 setInterval(()=>{if(!document.hidden)load()},10*60e3);
 window.ViewInvAIDecisions={load,forPosition,clear,_state:()=>state};
 if(signedIn())setTimeout(()=>load(true),800);
})();
