(function(){
 'use strict';

 const STORAGE_KEY='catalystpulse:alerts:v1';
 const MAX_HISTORY=120;
 const AUTO_HIDE_MS=6500;

 let centerTimer=null;
 let seededAuto=false;
 let alertState=readState();

 function q(s){return document.querySelector(s)}
 function qa(s){return Array.from(document.querySelectorAll(s))}
 function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
 function num(v){let n=Number(v);return Number.isFinite(n)?n:null}
 function nowIso(){return new Date().toISOString()}
 function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8)}

 function readState(){
  const base={
   rules:[],
   auto:{recommendation:true,entry:true,future:true},
   history:[],
   unread:0,
   autoSeen:{},
   lastFired:{}
  };
  try{
   let raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
   if(!raw||typeof raw!=='object')return base;
   if(Array.isArray(raw.rules))base.rules=raw.rules;
   if(raw.auto&&typeof raw.auto==='object')base.auto=Object.assign(base.auto,raw.auto);
   if(Array.isArray(raw.history))base.history=raw.history.slice(0,MAX_HISTORY);
   if(Number.isFinite(Number(raw.unread)))base.unread=Math.max(0,Number(raw.unread));
   if(raw.autoSeen&&typeof raw.autoSeen==='object')base.autoSeen=raw.autoSeen;
   if(raw.lastFired&&typeof raw.lastFired==='object')base.lastFired=raw.lastFired;
  }catch(_){}
  return base;
 }
 function saveState(){
  try{
   alertState.history=alertState.history.slice(0,MAX_HISTORY);
   localStorage.setItem(STORAGE_KEY,JSON.stringify(alertState));
  }catch(_){}
 }

 function formatTime(value){
  let d=new Date(value||Date.now());
  return isNaN(d)?'':d.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
 }

 function renderCenter(){
  let list=q('#notificationList'),badge=q('#notificationBadge'),status=q('#notificationStatus');
  if(!list||!badge||!status)return;
  badge.textContent=String(Math.min(99,alertState.unread||0));
  badge.classList.toggle('is-hidden',!(alertState.unread>0));
  status.textContent=alertState.unread>0?(alertState.unread+' sin leer'):(alertState.history.length?alertState.history.length+' guardados':'Sin avisos nuevos');
  list.innerHTML=alertState.history.length?alertState.history.map(item=>{
   let ticker=item.ticker?'<small>'+esc(item.ticker)+(item.market?' · '+esc(item.market):'')+'</small>':'';
   return '<article class="notification-item '+esc(item.kind||'manual')+'">'+
    '<div class="notification-item-head"><strong>'+esc(item.title||'Aviso')+'</strong><time>'+esc(formatTime(item.createdAt))+'</time></div>'+
    '<p>'+esc(item.message||'')+'</p>'+ticker+
   '</article>';
  }).join(''):'<div class="notification-empty">Todavía no hay avisos.</div>';
 }

 function setCenterOpen(open,{auto=false}={}){
  let center=q('#notificationCenter'),bell=q('#notificationBell');
  if(!center||!bell)return;
  if(centerTimer){clearTimeout(centerTimer);centerTimer=null}
  center.classList.toggle('open',!!open);
  bell.setAttribute('aria-expanded',open?'true':'false');
  if(open&&!auto){
   alertState.unread=0;saveState();renderCenter();
  }
  if(open&&auto){
   centerTimer=setTimeout(()=>setCenterOpen(false),AUTO_HIDE_MS);
  }
 }

 function pushNotice({kind='manual',title='Aviso',message='',ticker='',market='',fingerprint=''},{autoOpen=true}={}){
  if(fingerprint&&alertState.history.some(x=>x.fingerprint===fingerprint&&Date.now()-new Date(x.createdAt).getTime()<15000))return;
  alertState.history.unshift({id:uid(),kind,title,message,ticker,market,fingerprint,createdAt:nowIso()});
  alertState.unread=(alertState.unread||0)+1;
  saveState();renderCenter();
  if(autoOpen)setCenterOpen(true,{auto:true});
 }

 function marketLabel(v){return v==='tr'?'Trade Republic':v==='us'?'EEUU':'Todos'}
 function sessionLabel(v){return v==='premarket'?'Premarket':v==='regular'?'Regular':v==='postmarket'?'Postmarket':'Automática'}

 function ruleSummary(rule){
  let parts=[marketLabel(rule.market),sessionLabel(rule.session)];
  if(rule.minChange>0)parts.push('≥ '+rule.minChange+'%');
  if(rule.maxChange>0)parts.push('≤ '+rule.maxChange+'%');
  if(rule.minRelVolume>0)parts.push('RV ≥ '+rule.minRelVolume+'×');
  if(rule.minVolume>0)parts.push('Vol ≥ '+Math.round(rule.minVolume).toLocaleString('es-ES'));
  if(rule.minAdx>0)parts.push('ADX ≥ '+rule.minAdx);
  if(rule.minRsi>0)parts.push('RSI ≥ '+rule.minRsi);
  if(rule.maxRsi<100)parts.push('RSI ≤ '+rule.maxRsi);
  if(rule.trend)parts.push('EMA20/50');
  if(rule.liquid)parts.push('liquidez');
  return parts.join(' · ');
 }

 function renderRules(){
  let box=q('#manualAlertList'),count=q('#manualAlertCount');
  if(!box||!count)return;
  count.textContent=alertState.rules.length+' aviso'+(alertState.rules.length===1?'':'s');
  box.innerHTML=alertState.rules.length?alertState.rules.map(rule=>
   '<article class="manual-alert-rule '+(rule.enabled===false?'is-disabled':'')+'" data-alert-rule="'+esc(rule.id)+'">'+
    '<div><h3>'+esc(rule.name||'Aviso manual')+'</h3><p>'+esc(ruleSummary(rule))+'</p></div>'+
    '<div class="manual-alert-actions">'+
      '<label class="alert-rule-toggle"><input type="checkbox" data-alert-toggle="'+esc(rule.id)+'" '+(rule.enabled===false?'':'checked')+'>Activo</label>'+
      '<button type="button" class="btn ghost" data-alert-delete="'+esc(rule.id)+'">Eliminar</button>'+
    '</div>'+
   '</article>'
  ).join(''):'<div class="empty-state">No tienes avisos manuales. Crea uno con los criterios de arriba.</div>';
 }

 function syncAutoUi(){
  let map={autoAlertRecommendation:'recommendation',autoAlertEntry:'entry',autoAlertFuture:'future'};
  for(let [id,key] of Object.entries(map)){let el=q('#'+id);if(el)el.checked=alertState.auto[key]!==false}
 }

 function renderSettings(){
  syncAutoUi();renderRules();
 }

 function readRuleForm(){
  return{
   id:uid(),
   name:(q('#alertName')?.value||'').trim()||'Aviso manual',
   market:q('#alertMarket')?.value||'tr',
   session:q('#alertSession')?.value||'auto',
   minChange:num(q('#alertMinChange')?.value)||0,
   maxChange:num(q('#alertMaxChange')?.value)||0,
   minRelVolume:num(q('#alertMinRelVolume')?.value)||0,
   minVolume:num(q('#alertMinVolume')?.value)||0,
   minAdx:num(q('#alertMinAdx')?.value)||0,
   minRsi:num(q('#alertMinRsi')?.value)||0,
   maxRsi:num(q('#alertMaxRsi')?.value),
   trend:!!q('#alertTrend')?.checked,
   liquid:!!q('#alertLiquid')?.checked,
   cooldown:Math.max(1,num(q('#alertCooldown')?.value)||15),
   enabled:true,
   active:[]
  };
 }

 function resetRuleForm(){
  let form=q('#manualAlertForm');if(form)form.reset();
  if(q('#alertMarket'))q('#alertMarket').value='tr';
  if(q('#alertSession'))q('#alertSession').value='auto';
  if(q('#alertMinChange'))q('#alertMinChange').value='0';
  if(q('#alertMaxChange'))q('#alertMaxChange').value='0';
  if(q('#alertMinRelVolume'))q('#alertMinRelVolume').value='0';
  if(q('#alertMinVolume'))q('#alertMinVolume').value='0';
  if(q('#alertMinAdx'))q('#alertMinAdx').value='0';
  if(q('#alertMinRsi'))q('#alertMinRsi').value='0';
  if(q('#alertMaxRsi'))q('#alertMaxRsi').value='100';
  if(q('#alertCooldown'))q('#alertCooldown').value='15';
 }

 function useCurrentEntryCriteria(){
  if(typeof state==='undefined')return;
  let f=window.state||null;
  // app.js keeps state as a global lexical binding, so direct access is available in this classic script.
  try{
   let current=globalThis.__unused;
  }catch(_){}
  try{
   if(q('#alertMarket'))q('#alertMarket').value=(typeof state!=='undefined'&&state.entryMarket)||'tr';
   if(q('#alertSession'))q('#alertSession').value=(typeof state!=='undefined'&&state.session)||'auto';
  }catch(_){}
 }

 function fillFromCurrentCriteria(){
  try{
   if(q('#alertMarket'))q('#alertMarket').value=state.entryMarket||'tr';
   if(q('#alertSession'))q('#alertSession').value=state.session||'auto';
   let f=state.filters||{};
   if(q('#alertMinChange'))q('#alertMinChange').value=f.minChange??0;
   if(q('#alertMaxChange'))q('#alertMaxChange').value=f.maxChange??0;
   if(q('#alertMinRelVolume'))q('#alertMinRelVolume').value=f.minRelVolume??0;
   if(q('#alertMinVolume'))q('#alertMinVolume').value=f.minVolume??0;
   if(q('#alertMinAdx'))q('#alertMinAdx').value=f.minAdx??0;
   if(q('#alertMinRsi'))q('#alertMinRsi').value=f.minRsi??0;
   if(q('#alertMaxRsi'))q('#alertMaxRsi').value=f.maxRsi??100;
   if(q('#alertTrend'))q('#alertTrend').checked=!!f.trend;
   if(q('#alertLiquid'))q('#alertLiquid').checked=!!f.illiquid;
   if(q('#alertName')&&!q('#alertName').value)q('#alertName').value='Criterio '+((q('#presetLabel')&&q('#presetLabel').textContent)||'actual');
  }catch(_){}
 }

 function resolveSession(rule){
  let se=rule.session||'auto';
  if(se==='auto'){
   try{se=currentMarketSession()}catch(_){se='regular'}
  }
  return se==='previous'?'postmarket':se;
 }

 function matchesRule(stock,rule){
  if(!stock)return false;
  if(rule.market==='tr'&&!trTradable(stock))return false;
  if(rule.market==='us'&&!market(stock,'us'))return false;
  if(rule.market==='all'&&!market(stock,'us'))return false;
  let se=resolveSession(rule),preferTr=rule.market==='tr';
  let ch=preferTr?(trLiveChange(stock)??FC(stock,se)):(usLiveChange(stock)??FC(stock,se));
  if(ch===null||ch<rule.minChange)return false;
  if(rule.maxChange>0&&ch>rule.maxChange)return false;
  let rv=RV(stock,se);if(rule.minRelVolume>0&&(rv===null||rv<rule.minRelVolume))return false;
  let vol=SV(stock,se);if(rule.minVolume>0&&(vol===null||vol<rule.minVolume))return false;
  let adx=num(stock.adx);if(rule.minAdx>0&&(adx===null||adx<rule.minAdx))return false;
  let rsi=num(stock.rsi),maxRsi=rule.maxRsi==null?100:rule.maxRsi;
  if((rule.minRsi>0||maxRsi<100)&&(rsi===null||rsi<rule.minRsi||rsi>maxRsi))return false;
  if(rule.trend&&trendState(stock)!==true)return false;
  if(rule.liquid&&lowLiquidity(stock,se,preferTr))return false;
  return true;
 }

 function ruleCandidateMessage(stock,rule){
  let se=resolveSession(rule),preferTr=rule.market==='tr';
  let ch=preferTr?(trLiveChange(stock)??FC(stock,se)):(usLiveChange(stock)??FC(stock,se));
  let rv=RV(stock,se),vol=SV(stock,se),rsi=num(stock.rsi),adx=num(stock.adx);
  let bits=[];
  if(ch!==null)bits.push((ch>=0?'+':'')+ch.toFixed(2)+'%');
  if(rv!==null)bits.push('RV '+rv.toFixed(2)+'×');
  if(vol!==null)bits.push('Vol '+Math.round(vol).toLocaleString('es-ES'));
  if(rsi!==null)bits.push('RSI '+rsi.toFixed(0));
  if(adx!==null)bits.push('ADX '+adx.toFixed(0));
  return bits.join(' · ');
 }

 function evaluateManual(){
  if(!db||!Array.isArray(db.stocks)||!db.stocks.length)return;
  let changed=false;
  for(let rule of alertState.rules){
   if(rule.enabled===false)continue;
   let previous=new Set(Array.isArray(rule.active)?rule.active:[]);
   let matches=db.stocks.filter(s=>matchesRule(s,rule));
   let se=resolveSession(rule);
   matches.sort((a,b)=>{
    let pa=rule.market==='tr'?(trLiveChange(a)??FC(a,se)):(usLiveChange(a)??FC(a,se));
    let pb=rule.market==='tr'?(trLiveChange(b)??FC(b,se)):(usLiveChange(b)??FC(b,se));
    return (pb??-Infinity)-(pa??-Infinity);
   });
   let current=new Set(matches.map(stockKey));
   let newMatches=matches.filter(s=>!previous.has(stockKey(s)));
   for(let s of newMatches.slice(0,3)){
    let key=rule.id+':'+stockKey(s),last=Number(alertState.lastFired[key]||0),cooldown=rule.cooldown*60000;
    if(last&&Date.now()-last<cooldown)continue;
    alertState.lastFired[key]=Date.now();
    pushNotice({
     kind:'manual',
     title:rule.name||'Aviso manual',
     message:ruleCandidateMessage(s,rule),
     ticker:(rule.market==='tr'&&s.trTicker)||s.ticker||'',
     market:marketLabel(rule.market),
     fingerprint:'manual:'+key+':'+Date.now()
    });
   }
   rule.active=Array.from(current).slice(0,500);
   changed=true;
  }
  if(changed)saveState();
 }

 function entryTopForMarket(mode){
  if(!db||!Array.isArray(db.stocks)||!db.stocks.length)return null;
  let qf=state.filters||{},se;
  try{se=entrySessionForPreset()}catch(_){se=currentMarketSession()}
  let rows=db.stocks.filter(s=>mode==='tr'?trTradable(s):market(s,'us')).filter(s=>{
   let ch=mode==='tr'?(trLiveChange(s)??FC(s,se)):(usLiveChange(s)??FC(s,se));
   if(ch===null||ch<(qf.minChange||0))return false;
   if((qf.maxChange||0)>0&&ch>qf.maxChange)return false;
   let rv=RV(s,se);if((qf.minRelVolume||0)>0&&(rv===null||rv<qf.minRelVolume))return false;
   let adx=num(s.adx);if((qf.minAdx||0)>0&&(adx===null||adx<qf.minAdx))return false;
   let rsi=num(s.rsi);
   if(((qf.minRsi||0)>0||(qf.maxRsi??100)<100)&&(rsi===null||rsi<(qf.minRsi||0)||rsi>(qf.maxRsi??100)))return false;
   let vol=SV(s,se);if((qf.minVolume||0)>0&&(vol===null||vol<qf.minVolume))return false;
   if(qf.trend&&trendState(s)!==true)return false;
   if(qf.illiquid&&lowLiquidity(s,se,mode==='tr'))return false;
   return true;
  });
  rows.sort((a,b)=>{
   let ca=mode==='tr'?(trLiveChange(a)??FC(a,se)):(usLiveChange(a)??FC(a,se));
   let cb=mode==='tr'?(trLiveChange(b)??FC(b,se)):(usLiveChange(b)??FC(b,se));
   return (cb??-Infinity)-(ca??-Infinity);
  });
  return rows[0]||null;
 }

 function futureTopForMarket(mode){
  if(!db||!Array.isArray(db.events)||!db.events.length)return null;
  let now=Date.now(),events=db.events.filter(e=>futureWindowEvent(e,14,now));
  let groups=groupFutureEvents(events);
  for(let g of groups){
   let e=g.first,s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange));
   if(!s)continue;
   if(mode==='tr'&&trTradable(s))return{s,e,count:g.items.length};
   if(mode==='us'&&market(s,'us'))return{s,e,count:g.items.length};
  }
  return null;
 }

 function maybeAuto(kind,key,payload,{force=false}={}){
  let old=alertState.autoSeen[kind];
  alertState.autoSeen[kind]=key||'';
  if(!key){saveState();return}
  if(!force&&!seededAuto&&old==null){saveState();return}
  if(force||old!==key)pushNotice(payload);
  saveState();
 }

 function evaluateAuto(forceKind=null){
  if(!db||!Array.isArray(db.stocks)||!db.stocks.length)return;

  if(alertState.auto.recommendation!==false){
   for(let mode of ['tr','us']){
    let s=pickRecommendation(mode);if(!s)continue;
    let a=recommendationAnalysis(s,mode),label=a.score>=72?'COMPRA':a.score>=60?'VIGILAR':'ESPERAR';
    let key=stockKey(s)+':'+label;
    maybeAuto('recommendation:'+mode,key,{
     kind:'recommendation',
     title:'Recomendación actual · '+(mode==='tr'?'TR':'EEUU'),
     message:label+' · convicción '+a.score.toFixed(1)+'/100',
     ticker:(mode==='tr'&&s.trTicker)||s.ticker||'',
     market:mode==='tr'?'Trade Republic':'EEUU',
     fingerprint:'auto:reco:'+mode+':'+key
    },{force:forceKind==='recommendation'});
   }
  }

  if(alertState.auto.entry!==false){
   for(let mode of ['tr','us']){
    let s=entryTopForMarket(mode);if(!s)continue;
    let se;try{se=entrySessionForPreset()}catch(_){se=currentMarketSession()}
    let ch=mode==='tr'?(trLiveChange(s)??FC(s,se)):(usLiveChange(s)??FC(s,se));
    let key=stockKey(s);
    maybeAuto('entry:'+mode,key,{
     kind:'entry',
     title:'Potencial de entrada · '+(mode==='tr'?'TR':'EEUU'),
     message:'Nueva candidata principal'+(ch!==null?' · '+(ch>=0?'+':'')+ch.toFixed(2)+'%':''),
     ticker:(mode==='tr'&&s.trTicker)||s.ticker||'',
     market:mode==='tr'?'Trade Republic':'EEUU',
     fingerprint:'auto:entry:'+mode+':'+key
    },{force:forceKind==='entry'});
   }
  }

  if(alertState.auto.future!==false){
   for(let mode of ['tr','us']){
    let hit=futureTopForMarket(mode);if(!hit)continue;
    let key=stockKey(hit.s)+':'+String(hit.e.date||'')+':'+String(hit.e.type||'');
    maybeAuto('future:'+mode,key,{
     kind:'future',
     title:'Potencial futuro · '+(mode==='tr'?'TR':'EEUU'),
     message:(hit.count>1?hit.count+' catalizadores · ':'')+(hit.e.title||hit.e.fact||'Catalizador próximo'),
     ticker:(mode==='tr'&&hit.s.trTicker)||hit.s.ticker||'',
     market:mode==='tr'?'Trade Republic':'EEUU',
     fingerprint:'auto:future:'+mode+':'+key
    },{force:forceKind==='future'});
   }
  }
  seededAuto=true;
 }

 function evaluate(){
  try{evaluateManual();evaluateAuto()}catch(e){console.warn('Alert evaluation warning',e)}
 }

 function initEvents(){
  let bell=q('#notificationBell'),close=q('#notificationClose'),clear=q('#notificationClear');
  if(bell)bell.addEventListener('click',()=>setCenterOpen(!q('#notificationCenter')?.classList.contains('open')));
  if(close)close.addEventListener('click',()=>setCenterOpen(false));
  if(clear)clear.addEventListener('click',()=>{alertState.history=[];alertState.unread=0;saveState();renderCenter()});

  let form=q('#manualAlertForm');
  if(form)form.addEventListener('submit',e=>{
   e.preventDefault();
   let rule=readRuleForm();
   if(rule.maxRsi==null)rule.maxRsi=100;
   alertState.rules.unshift(rule);saveState();renderRules();resetRuleForm();evaluateManual();
  });
  q('#alertUseCurrent')?.addEventListener('click',fillFromCurrentCriteria);
  q('#alertTest')?.addEventListener('click',()=>pushNotice({kind:'manual',title:'Aviso de prueba',message:'El centro flotante de avisos funciona correctamente.',ticker:'TEST',market:'Web',fingerprint:'test:'+Date.now()}));

  let autoMap={autoAlertRecommendation:'recommendation',autoAlertEntry:'entry',autoAlertFuture:'future'};
  for(let [id,key] of Object.entries(autoMap)){
   q('#'+id)?.addEventListener('change',e=>{
    alertState.auto[key]=!!e.target.checked;
    if(alertState.auto[key]){
     for(let seenKey of Object.keys(alertState.autoSeen))if(seenKey.startsWith(key+':'))delete alertState.autoSeen[seenKey];
     saveState();evaluateAuto(key);
    }else saveState();
   });
  }

  document.addEventListener('change',e=>{
   let t=e.target.closest&&e.target.closest('[data-alert-toggle]');if(!t)return;
   let rule=alertState.rules.find(r=>r.id===t.dataset.alertToggle);if(!rule)return;
   rule.enabled=!!t.checked;if(rule.enabled)rule.active=[];saveState();renderRules();if(rule.enabled)evaluateManual();
  });
  document.addEventListener('click',e=>{
   let b=e.target.closest&&e.target.closest('[data-alert-delete]');if(!b)return;
   alertState.rules=alertState.rules.filter(r=>r.id!==b.dataset.alertDelete);saveState();renderRules();
  });
 }

 function init(){
  renderCenter();renderSettings();initEvents();
  setInterval(()=>{if(!document.hidden)evaluate()},4000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)evaluate()});
  setTimeout(()=>{evaluate();seededAuto=true},1200);
 }

 window.AppAlerts={evaluate,renderSettings,pushNotice};
 init();
})();