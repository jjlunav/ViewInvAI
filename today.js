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

 // Hay sesión pero Carteras aún no la ha recogido (la APK recupera la sesión a su ritmo):
 // «Cargando…» y otro intento en breve, nunca «Inicia sesión» con la sesión ya iniciada.
 let authRetry=null,authRetries=0;
 function sessionPending(){
  const A=window.ViewInvAIAuth;let user=null;try{user=A&&typeof A.getUser==='function'?A.getUser():null}catch(_){}
  if(!user)return false;
  if(!authRetry&&authRetries<20){authRetries++;authRetry=setTimeout(()=>{authRetry=null;refresh()},1500)}
  return true;
 }
 function portfoliosHtml(sum){
  if((!sum||!sum.signedIn)&&sessionPending())return '<section class="today-card today-portfolios"><small>TUS CARTERAS</small><div class="today-loading">Cargando carteras…</div></section>';
  if(!sum||!sum.signedIn){
   return '<section class="today-card today-portfolios today-signin"><div><small>TUS CARTERAS</small><strong>Inicia sesión para ver tus carteras aquí</strong><span>Valor, cambio del día y P&L neto de Trade Republic e IBKR de un vistazo.</span></div><button type="button" class="btn portfolio-google-login">Entrar con Google</button></section>';
  }
  if(sum.loading&&!sum.portfolios.length)return '<section class="today-card today-portfolios"><small>TUS CARTERAS</small><div class="today-loading">Cargando carteras…</div></section>';
  if(!sum.portfolios.length)return '<section class="today-card today-portfolios"><small>TUS CARTERAS</small><strong>Todavía no tienes carteras</strong><button type="button" class="btn" data-today-go="portfolios">Crear cartera</button></section>';
  const t=sum.total,incomplete=sum.portfolios.some(p=>!p.complete);
  const rows=sum.portfolios.map(p=>'<button type="button" class="today-portfolio-row" data-today-go="'+(p.kind==='crypto'?'crypto':'portfolios')+'"'+(p.kind==='funds'?' data-today-funds="1"':'')+'><span>'+E(p.name)+(p.kind==='funds'?' · Fondos':'')+' <em>'+p.count+'</em></span><b>'+eur(p.value)+'</b><i class="'+tone(p.day)+'">'+signed(p.day)+'</i></button>').join('');
  return '<section class="today-card today-portfolios">'+
   '<div class="today-total"><small>TUS CARTERAS · EUR</small><strong>'+eur(t.value)+'</strong>'+
    '<div class="today-total-chips"><span class="'+tone(t.day)+'">Hoy '+signed(t.day)+'</span><span class="'+tone(t.pnl)+'">P&L neto '+signed(t.pnl)+'</span>'+(t.cash>0?'<span title="Efectivo disponible, aparte del valor de las carteras">Efectivo '+eur(t.cash)+'</span>':'')+'</div>'+
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
  // Server push alerts (Avisos) first; the local detector history fills in when signed out.
  const inbox=window.ViewInvAIInbox&&typeof window.ViewInvAIInbox.recent==='function'?window.ViewInvAIInbox.recent(20):[];
  const server=inbox.map(r=>({title:r.title,message:r.message,createdAt:r.created_at,stockKey:r.stock_key,preferTr:false,unread:!r.read_at}));
  const local=(window.AppAlerts&&typeof window.AppAlerts.getHistory==='function'?window.AppAlerts.getHistory():[]);
  const rows=(server.length?server:local).filter(r=>Date.now()-new Date(r.createdAt||0).getTime()<36*3600e3).slice(0,3);
  const unread=window.ViewInvAIInbox&&typeof window.ViewInvAIInbox.unread==='function'?window.ViewInvAIInbox.unread():0;
  if(!rows.length&&!unread)return'';
  const item=r=>{
   const when=new Date(r.createdAt||Date.now()).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
   const open=r.stockKey?' data-open-stock="'+E(r.stockKey)+'" data-stock-prefer-tr="'+(r.preferTr?'1':'0')+'" role="button" tabindex="0"':'';
   return '<div class="today-alert'+(r.unread?' unread':'')+'"'+open+'><span>'+E(when)+'</span><div><strong>'+E(r.title||'Aviso')+'</strong><small>'+E(r.message||'')+'</small></div></div>';
  };
  return '<section class="today-card today-alerts"><header><small>AVISOS</small><h2>'+(unread?unread+' sin leer':'Últimas 36 horas')+'</h2><button type="button" class="today-link" data-today-go="inbox">Ver todos ›</button></header>'+rows.map(item).join('')+'</section>';
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

 // ----- Diseño D: saludo, patrimonio con el resumen AI dentro, cuentas, ideas, avisos y agenda -----
 const money=(v,c='EUR')=>N(v)===null?'—':Number(v).toLocaleString('es-ES',{style:'currency',currency:c||'EUR',minimumFractionDigits:2,maximumFractionDigits:2});
 function chip(v,{pct=false,suffix=''}={}){
  if(N(v)===null)return'';
  const cls=Math.abs(v)<0.005?'flat':v>0?'up':'down',arrow=cls==='up'?'▲ ':cls==='down'?'▼ ':'';
  return '<span class="d-chip '+cls+'">'+arrow+(pct?Math.abs(v).toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' %':money(Math.abs(v)))+(suffix?' '+E(suffix):'')+'</span>';
 }
 function ring(score){
  const n=Math.max(0,Math.min(100,Math.round(N(score)??0)));
  return '<em class="ai-score d-ring" data-band="'+(n>=80?'high':n>=60?'mid':'low')+'" data-p="'+Math.round(n/5)*5+'">'+n+'</em>';
 }
 function wealthHtmlD(sum,A){
  if(!sum||!sum.signedIn||!sum.portfolios.length)return portfoliosHtml(sum);
  const t=sum.total,by=k=>sum.portfolios.filter(p=>k.includes(p.kind)).reduce((a,p)=>a+(N(p.value)||0),0);
  const market=by(['stocks','funds']),crypto=by(['crypto']),cash=N(t.cash)||0,total=market+crypto+cash;
  const base=(N(t.value)||0)-(N(t.day)||0),dayPct=base>0?(N(t.day)||0)/base*100:null;
  const incomplete=sum.portfolios.some(p=>!p.complete);
  const tile=(label,value,go,funds)=>'<button type="button" data-today-go="'+go+'"'+(funds?' data-today-funds="1"':'')+'><small>'+label+'</small><b>'+money(value)+'</b></button>';
  return '<section class="d-wealth"><small>Patrimonio total</small>'+
   '<div class="d-wealth-total"><strong>'+money(total)+'</strong>'+chip(dayPct,{pct:true,suffix:'hoy'})+'</div>'+
   '<p class="d-wealth-sub">Hoy '+(N(t.day)>=0?'+':'−')+money(Math.abs(N(t.day)||0))+' · desde la compra '+(N(t.pnl)>=0?'+':'−')+money(Math.abs(N(t.pnl)||0))+'</p>'+
   '<div class="d-tiles">'+tile('Bolsa y fondos',market,'portfolios')+tile('Cripto',crypto,'crypto')+tile('Efectivo',cash,'portfolios')+'</div>'+
   (incomplete?'<p class="d-wealth-sub">Alguna posición aún no tiene cotización: el total puede estar incompleto.</p>':'')+
   (A?A.briefHtml():'')+
  '</section>'+
  '<section class="d-group"><header><h3>Tus cuentas</h3><button type="button" class="d-more-link" data-today-go="portfolios" aria-label="Abrir Carteras">›</button></header><ul class="d-list">'+
   sum.portfolios.map(p=>'<li class="d-row"><button type="button" class="d-row-main d-row-simple" data-today-go="'+(p.kind==='crypto'?'crypto':'portfolios')+'"'+(p.kind==='funds'?' data-today-funds="1"':'')+'><span class="d-row-text"><b>'+E(p.name)+'</b><small>'+(p.kind==='funds'?'Fondos y ETF':p.kind==='crypto'?'Cripto':'Acciones')+' · '+p.count+(p.count===1?' posición':' posiciones')+'</small></span><span class="d-row-num"><b>'+money(p.value)+'</b>'+(Math.abs(N(p.day)||0)>=0.005?chip(p.day):'')+'</span></button></li>').join('')+
  '</ul></section>';
 }
 function ideasHtmlD(){
  let rows=[];try{rows=[...radarAiCandidateRows('tr'),...radarAiCandidateRows('us')].filter(r=>!r.speculative)}catch(_){rows=[]}
  const high=rows.filter(r=>r.tier==='high');
  const picks=(high.length?high:rows.filter(r=>r.tier==='opportunity')).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,4);
  const body=picks.length?picks.map(r=>{
   const s=r.s,q=typeof canonicalQuote==='function'?canonicalQuote(s,r.preferTr)||{}:{},cur=r.preferTr?'EUR':(q.nativeCurrency||'USD');
   const price=N(r.preferTr?q.eur:(q.usd??q.price)),ticker=r.preferTr?(s.trTicker||s.ticker):(s.ticker||s.trTicker);
   const rv=typeof RV==='function'?N(RV(s,currentMarketSession())):null;
   const sub=[ticker,r.tier==='high'?'alta convicción':'oportunidad',rv!==null&&rv>=0.1?'vol. ×'+rv.toLocaleString('es-ES',{minimumFractionDigits:1,maximumFractionDigits:1}):''].filter(Boolean).join(' · ');
   const ai=r.ai&&r.ai.verdict?'IA externa: '+r.ai.verdict:'';
   return '<li class="d-row"><button type="button" class="d-row-main" data-open-stock="'+E(stockKey(s))+'" data-stock-prefer-tr="'+(r.preferTr?'1':'0')+'">'+ring(r.score)+
    '<span class="d-row-text"><b>'+E(s.name||ticker)+'</b><small>'+E(sub)+'</small>'+(ai?'<i class="d-row-ai">✦ '+E(ai)+'</i>':'')+'</span>'+
    '<span class="d-row-num"><b>'+money(price,cur)+'</b>'+chip(N(q.change),{pct:true})+'</span></button></li>';
  }).join(''):'<li class="d-row d-row-empty">Sin señales destacadas ahora mismo. La IA prefiere esperar a forzar una entrada.</li>';
  return '<section class="d-group"><header><h3>Ideas del Radar</h3><button type="button" class="d-more-link" data-today-go="recommendation" aria-label="Abrir Radar AI">›</button></header><ul class="d-list">'+body+'</ul></section>';
 }
 function alertsHtmlD(){
  const inbox=window.ViewInvAIInbox&&typeof window.ViewInvAIInbox.recent==='function'?window.ViewInvAIInbox.recent(20):[];
  const server=inbox.map(r=>({title:r.title,message:r.message,createdAt:r.created_at,stockKey:r.stock_key,unread:!r.read_at}));
  const local=(window.AppAlerts&&typeof window.AppAlerts.getHistory==='function'?window.AppAlerts.getHistory():[]);
  const rows=(server.length?server:local).filter(r=>Date.now()-new Date(r.createdAt||0).getTime()<36*3600e3).slice(0,3);
  const unread=window.ViewInvAIInbox&&typeof window.ViewInvAIInbox.unread==='function'?window.ViewInvAIInbox.unread():0;
  if(!rows.length&&!unread)return'';
  return '<section class="d-group"><header><h3>Avisos'+(unread?' · '+unread+' sin leer':'')+'</h3><button type="button" class="d-more-link" data-today-go="inbox" aria-label="Abrir Avisos">›</button></header><ul class="d-list">'+rows.map(r=>{
   const when=new Date(r.createdAt||Date.now()).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
   const open=r.stockKey?' data-open-stock="'+E(r.stockKey)+'" data-stock-prefer-tr="0"':' data-today-go="inbox"';
   return '<li class="d-row'+(r.unread?' unread':'')+'"><button type="button" class="d-row-main d-row-simple"'+open+'><span class="d-row-text"><b>'+E(r.title||'Aviso')+'</b><small>'+E(r.message||'')+'</small></span><span class="d-row-num"><small>'+E(when)+'</small></span></button></li>';
  }).join('')+'</ul></section>';
 }
 // Calendario económico (ForexFactory / TradingView vía /api/econ-calendar): impacto alto, próximos 3 días.
 const macro={at:0,events:[],loading:false};
 async function loadMacro(){
  if(macro.loading||Date.now()-macro.at<30*60000)return;
  macro.loading=true;
  try{const r=await fetch('/api/econ-calendar');const d=await r.json();if(r.ok&&Array.isArray(d.events)){macro.events=d.events;macro.at=Date.now();refresh()}}
  catch(_){macro.at=Date.now()-25*60000}
  finally{macro.loading=false}
 }
 function macroCards(){
  loadMacro();
  const now=Date.now(),until=now+3*864e5;
  return macro.events.filter(e=>{const t=Date.parse(e.time);return e.impact==='high'&&t>=now-3600e3&&t<=until}).slice(0,6);
 }
 function macroWhen(iso){
  const d=new Date(iso),today=new Date(),k=x=>x.toDateString(),tm=new Date(today.getTime()+864e5);
  const day=k(d)===k(today)?'Hoy':k(d)===k(tm)?'Mañana':d.toLocaleDateString('es-ES',{weekday:'short',day:'numeric'});
  return day+' · '+d.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
 }
 function agendaHtmlD(sum){
  const keys=new Set((sum&&sum.stockKeys)||[]),now=Date.now(),limit=now+14*864e5;
  const upcoming=(db.events||[]).filter(e=>{const t=new Date(e.date).getTime();return t>=now-3600e3&&t<=limit});
  const mine=keys.size?upcoming.filter(e=>{const s=stockForEvent(e);return s&&keys.has(stockKey(s))}):[];
  const list=(mine.length?mine:upcoming.filter(e=>(N(e.impactScore)||0)>=60)).sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,8);
  const macroList=macroCards();
  if(!list.length&&!macroList.length)return'';
  const card=e=>{
   const s=stockForEvent(e);if(!s)return'';
   const ticker=s.ticker||s.trTicker||'',when=String(eventWhen(e)||'').replace('/'+new Date().getFullYear(),'');
   return '<button type="button" class="d-agenda-card" data-open-stock="'+E(stockKey(s))+'"><small>'+E(when)+'</small><b>'+E(EL(e))+'</b><span>'+E(ticker)+(keys.has(stockKey(s))?' · en tu cartera':'')+'</span></button>';
  };
  const macroCard=e=>'<div class="d-agenda-card is-macro"><small>'+E(macroWhen(e.time))+'</small><b data-i18n-content>'+E(e.title)+'</b><span>'+E(e.country)+(e.forecast?' · prev. '+E(e.forecast):'')+(e.previous?' · ant. '+E(e.previous):'')+'</span></div>';
  // Macro y catalizadores juntos, por fecha.
  const all=[...list.map(e=>({t:new Date(e.date).getTime(),html:card(e)})),...macroList.map(e=>({t:Date.parse(e.time),html:macroCard(e)}))].sort((a,b)=>a.t-b.t);
  return '<section class="d-group"><header><h3>Agenda</h3><button type="button" class="d-more-link" data-today-go="future" aria-label="Abrir Potencial futuro">›</button></header><div class="d-agenda">'+all.map(x=>x.html).join('')+'</div></section>';
 }
 function render(){
  const box=document.getElementById('todayResults');if(!box)return;
  const sum=window.ViewInvAIPortfolios&&typeof window.ViewInvAIPortfolios.getDaySummary==='function'?window.ViewInvAIPortfolios.getDaySummary():{signedIn:false};
  const date=document.getElementById('todayDate');
  if(date)date.textContent=new Date().toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'});
  // Diseño D: resumen AI del día justo debajo del total (lo prepara el servidor con tus carteras).
  const A=document.documentElement.dataset.design!=='classic'&&window.ViewInvAIAsk;
  if(document.documentElement.dataset.design==='d'){
   box.classList.add('d-today');
   const N2=window.ViewInvAINews;
   box.innerHTML=wealthHtmlD(sum,A&&sum&&sum.signedIn?A:null)+ideasHtmlD()+(N2?N2.miniHtml():'')+alertsHtmlD()+agendaHtmlD(sum);
  }else{
   box.classList.remove('d-today');
   box.innerHTML=portfoliosHtml(sum)+(A&&sum&&sum.signedIn?A.briefHtml():'')+aiPicksHtml()+alertsHtml()+catalystsHtml(sum);
  }
  if(A&&sum&&sum.signedIn)A.loadBrief();
  requestAnimationFrame(()=>{if(typeof observeActiveTrLivePrices==='function')observeActiveTrLivePrices()});
 }

 document.addEventListener('click',e=>{
  const go=e.target.closest&&e.target.closest('[data-today-go]');
  if(go){e.preventDefault();if(typeof show==='function')show(go.dataset.todayGo);const F=window.ViewInvAIFunds;if(go.dataset.todayFunds&&F&&typeof F.setPortfolioAssetMode==='function')F.setPortfolioAssetMode('funds')}
 });
 function refresh(){if(typeof state!=='undefined'&&state.currentView==='today')render()}
 ['viewinvai:portfolio-membership-changed','viewinvai:portfolios-loaded','viewinvai:account-ready','viewinvai:auth-changed','viewinvai:inbox-updated'].forEach(n=>window.addEventListener(n,()=>setTimeout(refresh,50)));
 window.addEventListener('viewinvai:fund-portfolios-changed',()=>setTimeout(refresh,50));
 window.addEventListener('viewinvai:news-updated',e=>{if(e.detail&&e.detail.cat==='mine')setTimeout(refresh,50)});
 window.addEventListener('viewinvai:crypto-totals',()=>setTimeout(refresh,50));
 window.addEventListener('viewinvai:crypto-quotes',()=>{if(!quoteTimer)quoteTimer=setTimeout(()=>{quoteTimer=null;refresh()},2000)});
 // Cotizaciones por ISIN (fondos y acciones fuera del catálogo): repintar como mucho cada 2 s.
 let quoteTimer=null;
 window.addEventListener('viewinvai:tr-isin-quote',()=>{if(!quoteTimer)quoteTimer=setTimeout(()=>{quoteTimer=null;refresh()},2000)});
 window.ViewInvAIToday={render};
})();
