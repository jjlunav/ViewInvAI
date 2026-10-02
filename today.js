/* ViewInvAI · «Mi día»: lo tuyo primero.
 * Carteras (valor, cambio del día, P&L neto), lo que la IA destaca hoy, tus avisos
 * recientes y los próximos catalizadores de tus posiciones y favoritos.
 * Solo lee datos ya cargados (snapshot, carteras, avisos, eventos): no hace peticiones.
 */
(function(){
 'use strict';
 const eur=v=>N(v)===null?'—':Number(v).toLocaleString('es-ES',{style:'currency',currency:'EUR',maximumFractionDigits:2});
 const signed=v=>N(v)===null?'—':(v>0?'+':'')+eur(v);
 const tone=v=>N(v)===null||Math.abs(v)<0.005?'':v>0?'positive':'negative';

 function portfoliosHtml(sum){
  if(!sum||!sum.signedIn){
   return '<section class="today-card today-portfolios today-signin"><div><small>TUS CARTERAS</small><strong>Inicia sesión para ver tus carteras aquí</strong><span>Valor, cambio del día y P&L neto de Trade Republic e IBKR de un vistazo.</span></div><button type="button" class="btn portfolio-google-login">Entrar con Google</button></section>';
  }
  if(sum.loading&&!sum.portfolios.length)return '<section class="today-card today-portfolios"><small>TUS CARTERAS</small><div class="today-loading">Cargando carteras…</div></section>';
  if(!sum.portfolios.length)return '<section class="today-card today-portfolios"><small>TUS CARTERAS</small><strong>Todavía no tienes carteras</strong><button type="button" class="btn" data-today-go="portfolios">Crear cartera</button></section>';
  const t=sum.total,incomplete=sum.portfolios.some(p=>!p.complete);
  const rows=sum.portfolios.map(p=>'<button type="button" class="today-portfolio-row" data-today-go="portfolios"><span>'+E(p.name)+' <em>'+p.count+'</em></span><b>'+eur(p.value)+'</b><i class="'+tone(p.day)+'">'+signed(p.day)+'</i></button>').join('');
  return '<section class="today-card today-portfolios">'+
   '<div class="today-total"><small>TUS CARTERAS · EUR</small><strong>'+eur(t.value)+'</strong>'+
    '<div class="today-total-chips"><span class="'+tone(t.day)+'">Hoy '+signed(t.day)+'</span><span class="'+tone(t.pnl)+'">P&L neto '+signed(t.pnl)+'</span></div>'+
   '</div>'+
   '<div class="today-portfolio-list">'+rows+'</div>'+
   (incomplete?'<p class="today-note">Alguna posición aún no tiene cotización; el total puede estar incompleto.</p>':'')+
  '</section>';
 }

 function aiPicksHtml(){
  let rows=[];
  try{
   rows=[...radarAiCandidateRows('tr'),...radarAiCandidateRows('us')].filter(r=>!r.speculative);
  }catch(e){rows=[]}
  const high=rows.filter(r=>r.tier==='high');
  const picks=(high.length?high:rows.filter(r=>r.tier==='opportunity')).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,3);
  const title=high.length?'Alta convicción hoy':'Lo que la IA vigila hoy';
  const body=picks.length?picks.map(radarAiCard).join(''):'<div class="today-empty">Sin señales destacadas ahora mismo. La IA prefiere esperar a forzar una entrada.</div>';
  return '<section class="today-card today-ai"><header><small>✦ IA</small><h2>'+title+'</h2><button type="button" class="today-link" data-today-go="recommendation">Radar AI ›</button></header><div class="today-list">'+body+'</div></section>';
 }

 function alertsHtml(){
  const rows=(window.AppAlerts&&typeof window.AppAlerts.getHistory==='function'?window.AppAlerts.getHistory():[])
   .filter(r=>Date.now()-new Date(r.createdAt||0).getTime()<36*3600e3).slice(0,3);
  if(!rows.length)return'';
  const item=r=>{
   const when=new Date(r.createdAt||Date.now()).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
   const open=r.stockKey?' data-open-stock="'+E(r.stockKey)+'" data-stock-prefer-tr="'+(r.preferTr?'1':'0')+'" role="button" tabindex="0"':'';
   return '<div class="today-alert"'+open+'><span>'+E(when)+'</span><div><strong>'+E(r.title||'Aviso')+'</strong><small>'+E(r.message||'')+'</small></div></div>';
  };
  return '<section class="today-card today-alerts"><header><small>AVISOS</small><h2>Últimas 36 horas</h2></header>'+rows.map(item).join('')+'</section>';
 }

 function catalystsHtml(sum){
  const keys=new Set((sum&&sum.stockKeys)||[]),now=Date.now(),limit=now+14*864e5;
  const upcoming=(db.events||[]).filter(e=>{const t=new Date(e.date).getTime();return t>=now-3600e3&&t<=limit});
  const mine=keys.size?upcoming.filter(e=>{const s=stockForEvent(e);return s&&keys.has(stockKey(s))}):[];
  const list=(mine.length?mine:upcoming.filter(e=>(N(e.impactScore)||0)>=60)).sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,5);
  const title=mine.length?'Catalizadores de lo tuyo':'Próximos catalizadores del mercado';
  if(!list.length)return'';
  const row=e=>{
   const s=stockForEvent(e);if(!s)return'';
   const ticker=s.ticker||s.trTicker||'',when=String(eventWhen(e)||'').replace('/'+new Date().getFullYear(),'');
   return '<div class="today-event" data-open-stock="'+E(stockKey(s))+'" role="button" tabindex="0"><b>'+E(ticker)+'</b><span class="future-chip">'+E(EL(e))+'</span><em>'+E(when)+'</em></div>';
  };
  return '<section class="today-card today-events"><header><small>CALENDARIO · 14 DÍAS</small><h2>'+title+'</h2><button type="button" class="today-link" data-today-go="future">Potencial futuro ›</button></header>'+list.map(row).join('')+'</section>';
 }

 function render(){
  const box=document.getElementById('todayResults');if(!box)return;
  const sum=window.ViewInvAIPortfolios&&typeof window.ViewInvAIPortfolios.getDaySummary==='function'?window.ViewInvAIPortfolios.getDaySummary():{signedIn:false};
  const date=document.getElementById('todayDate');
  if(date)date.textContent=new Date().toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'});
  box.innerHTML=portfoliosHtml(sum)+aiPicksHtml()+alertsHtml()+catalystsHtml(sum);
  requestAnimationFrame(()=>{if(typeof observeActiveTrLivePrices==='function')observeActiveTrLivePrices()});
 }

 document.addEventListener('click',e=>{
  const go=e.target.closest&&e.target.closest('[data-today-go]');
  if(go){e.preventDefault();if(typeof show==='function')show(go.dataset.todayGo)}
 });
 const refresh=()=>{if(typeof state!=='undefined'&&state.currentView==='today')render()};
 ['viewinvai:portfolio-membership-changed','viewinvai:account-ready','viewinvai:auth-changed'].forEach(n=>window.addEventListener(n,()=>setTimeout(refresh,50)));
 window.ViewInvAIToday={render};
})();
