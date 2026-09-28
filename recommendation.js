/*
 * ViewInvAI recommendations
 * -------------------------
 * Ideas IA state, scoring orchestration, chart confirmation and recommendation view.
 */

const RECO_KEY='viewinvai:recommendation:v1';
const RECO_COOLDOWN_MS=86400000;
let recommendationState=readRecommendationState();

function readRecommendationState(){
 let base={us:{key:null,selectedAt:0,armed:false},tr:{key:null,selectedAt:0,armed:false},sold:{us:{},tr:{}}};
 try{
  let raw=JSON.parse(localStorage.getItem(RECO_KEY)||'null');
  if(!raw||typeof raw!=='object')return base;
  for(let mode of ['us','tr']){
   if(raw[mode]&&typeof raw[mode]==='object')base[mode]=Object.assign(base[mode],raw[mode]);
   if(raw.sold&&raw.sold[mode]&&typeof raw.sold[mode]==='object')base.sold[mode]=raw.sold[mode];
  }
 }catch(_){}
 return base;
}
function saveRecommendationState(){
 try{
  let cutoff=Date.now()-7*86400000;
  for(let mode of ['us','tr'])for(let [key,ts] of Object.entries(recommendationState.sold[mode]||{}))if(Number(ts)<cutoff)delete recommendationState.sold[mode][key];
  localStorage.setItem(RECO_KEY,JSON.stringify(recommendationState));
 }catch(_){}
}
function recommendationBucket(mode){
 if(!recommendationState[mode]||typeof recommendationState[mode]!=='object')recommendationState[mode]={key:null,selectedAt:0,armed:false};
 return recommendationState[mode];
}
function recommendationSoldRecently(mode,key){
 let ts=Number(recommendationState.sold&&recommendationState.sold[mode]&&recommendationState.sold[mode][key]);
 return Number.isFinite(ts)&&Date.now()-ts<RECO_COOLDOWN_MS;
}
function recommendationEligible(s,mode){
 if(!s||!market(s,'us'))return false;
 if(mode==='tr'&&!trTradable(s))return false;
 let se=currentMarketSession();
 return SP(s,se)!==null||usLivePrice(s)!==null||(mode==='tr'&&trLivePrice(s)!==null);
}
function recommendationTechnicalLegacy(s,mode){
 let preferTr=mode==='tr',se=currentMarketSession(),score=50,factors=[];
 let add=(label,delta,note)=>{delta=Math.round(Number(delta||0)*10)/10;score+=delta;factors.push({label,delta,note})};
 let displayQuote=verifiedDisplayQuote(s,preferTr,se);
 let ch=N(displayQuote.change),rv=RV(s,se),adx=N(s.adx),rsi=N(s.rsi);
 let p=N(displayQuote.price),ema20=N(s.ema20),ema50=N(s.ema50),week=N(s.perfWeek),month=N(s.perfMonth),vol=SV(s,se),sp=spreadPct(s,preferTr);

 if(ch===null)add('Momentum',-5,'Variación actual no disponible');
 else if(ch<0)add('Momentum',Math.max(-18,ch*1.2),'Movimiento '+PC(ch));
 else if(ch<=12)add('Momentum',5+Math.min(9,ch*.75),'Impulso '+PC(ch)+' sin sobreextensión severa');
 else if(ch<=25)add('Momentum',Math.max(6,10-(ch-12)*.15),'Impulso fuerte '+PC(ch));
 else add('Momentum',Math.max(-12,8-(ch-25)*.45),'Subida '+PC(ch)+'; se penaliza perseguir extensiones extremas');

 if(rv===null)add('Volumen relativo',-2,'Sin volumen relativo comparable');
 else if(rv>=3)add('Volumen relativo',12,'Actividad '+F(rv,2)+'× la media');
 else if(rv>=1.5)add('Volumen relativo',8,'Actividad '+F(rv,2)+'× la media');
 else if(rv>=1)add('Volumen relativo',3,'Volumen en línea con la media');
 else if(rv<.5)add('Volumen relativo',-6,'Volumen débil '+F(rv,2)+'×');
 else add('Volumen relativo',-1,'Volumen por debajo de la media');

 if(adx===null)add('ADX',-1,'ADX no disponible');
 else if(adx>=30)add('ADX',7,'Tendencia fuerte · ADX '+F(adx,1));
 else if(adx>=20)add('ADX',4,'Tendencia utilizable · ADX '+F(adx,1));
 else if(adx<15)add('ADX',-4,'Tendencia poco definida · ADX '+F(adx,1));
 else add('ADX',0,'ADX '+F(adx,1));

 if(rsi===null)add('RSI',-1,'RSI no disponible');
 else if(rsi>=45&&rsi<=68)add('RSI',8,'Momentum sano · RSI '+F(rsi,1));
 else if((rsi>=38&&rsi<45)||(rsi>68&&rsi<=75))add('RSI',3,'RSI '+F(rsi,1));
 else if(rsi>82)add('RSI',-10,'Sobreextensión · RSI '+F(rsi,1));
 else if(rsi<30)add('RSI',-9,'Debilidad extrema · RSI '+F(rsi,1));
 else add('RSI',-2,'RSI '+F(rsi,1));

 if(p!==null&&ema20!==null&&ema50!==null){
  if(p>=ema20&&ema20>=ema50)add('Tendencia',12,'Precio > EMA20 > EMA50');
  else if(p>=ema20)add('Tendencia',4,'Precio sobre EMA20, estructura larga incompleta');
  else if(p<ema20&&ema20<ema50)add('Tendencia',-10,'Precio bajo EMA20 y EMA20 < EMA50');
  else add('Tendencia',-5,'Precio bajo EMA20');
 }else add('Tendencia',-2,'EMAs insuficientes');

 let perf=0,perfNote=[];
 if(week!==null){perf+=Math.max(-5,Math.min(5,week*.18));perfNote.push('1s '+PC(week))}
 if(month!==null){perf+=Math.max(-5,Math.min(5,month*.08));perfNote.push('1m '+PC(month))}
 add('Rendimiento',perf,perfNote.join(' · ')||'Sin histórico de rendimiento');

 if(vol!==null&&vol<10000)add('Liquidez',-14,'Volumen muy bajo · '+compactVol(vol));
 else if(vol!==null&&vol<50000)add('Liquidez',-7,'Volumen bajo · '+compactVol(vol));
 else if(vol!==null&&vol>=500000)add('Liquidez',4,'Volumen '+compactVol(vol));
 else if(vol!==null&&vol>=100000)add('Liquidez',2,'Volumen '+compactVol(vol));
 else add('Liquidez',0,vol===null?'Volumen no disponible':'Volumen '+compactVol(vol));

 if(sp!==null){
  if(sp>8)add('Spread',-16,'Spread '+F(sp,2)+'%');
  else if(sp>4)add('Spread',-7,'Spread amplio '+F(sp,2)+'%');
  else if(sp<=1.5)add('Spread',3,'Spread contenido '+F(sp,2)+'%');
  else add('Spread',0,'Spread '+F(sp,2)+'%');
 }

 let quality=[ch,rv,adx,rsi,p,ema20,ema50,vol].filter(v=>v!==null).length;
 if(quality<5)add('Calidad de datos',-8,'Faltan varias métricas clave');
 else if(quality>=7)add('Calidad de datos',2,'Cobertura técnica alta');

 return{score,parts:factors,se,change:ch,rv,adx,rsi,spread:sp};
}
function recommendationCatalystLegacy(s){
 let now=Date.now(),events=stockEvents(s),delta=0,relevant=[];
 let positive=/\b(approval|approved|authorization|clearance|contract|award|wins?|partnership|strategic agreement|beats?|raises? guidance|positive|topline|met (?:the )?(?:primary )?endpoint|acquisition|buyout|order|milestone payment)\b/i;
 let negative=/\b(offering|dilution|dilutive|reverse split|delist|bankrupt|chapter 11|misses?|lowers? guidance|cuts? guidance|clinical hold|failed|fails|investigation|subpoena|lawsuit|going concern|termination|withdraws?)\b/i;
 for(let e of events){
  let t=new Date(e.date).getTime();if(!Number.isFinite(t))continue;
  let isNews=e.eventKind==='news';
  if(isNews&&(t<now-72*3600000||t>now+2*3600000))continue;
  if(!isNews&&(t<now-6*3600000||t>now+14*86400000))continue;
  let text=((e.title||'')+' '+(e.fact||'')).toLowerCase(),impact=Math.max(0,Math.min(100,N(e.impactScore)??50)),d=0;
  let fdaKind=String(e.fdaStatusKind||'');
  if(fdaKind){
   if(fdaKind==='approved')d+=10+impact*.05;
   else if(fdaKind==='tentative_approval'||fdaKind==='approvable')d+=4+impact*.025;
   else if(['complete_response','not_approvable','withdrawn'].includes(fdaKind))d-=10+impact*.055;
  }else{
   if(positive.test(text))d+=6+impact*.05;
   if(negative.test(text))d-=7+impact*.06;
  }
  if(e.type==='financing')d-=6;
  if(e.type==='regulatory'&&!positive.test(text)&&!fdaKind)d-=3;
  if(/reverse split|delist|bankrupt|chapter 11/.test(text))d-=7;
  if(e.type==='medical'&&positive.test(text)&&!fdaKind)d+=4;
  if(!isNews&&d===0)d+=Math.min(2.5,impact/40);
  delta+=d;
  relevant.push({e,delta:d,impact,time:t});
 }
 relevant.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)||b.impact-a.impact||b.time-a.time);
 delta=Math.max(-18,Math.min(18,delta));
 return{delta:Math.round(delta*10)/10,events:relevant.slice(0,3)};
}
function recommendationEngineInput(s,mode='us',chartAvailable=false){
 let preferTr=mode==='tr',se=currentMarketSession();
 let quote=verifiedDisplayQuote(s,preferTr,se),snapshotAt=parseMarketTimestamp(db.meta&&db.meta.updatedAt);
 let quoteAt=preferTr?(N(s&&s.trLiveUpdatedAt)??N(s&&s.trLiveReceivedAt)):(N(s&&s.usLiveReceivedAt)??parseMarketTimestamp(s&&s.usLiveTimestamp,'America/New_York'));
 let now=Date.now();
 return {
  price:quote&&N(quote.price)!==null?N(quote.price):SP(s,se),
  change:quote&&N(quote.change)!==null?N(quote.change):marketChange(s,se,false),
  volume:SV(s,se),
  avgVolume:N(s&&s.avgVolume),
  relVolume:RV(s,se),
  rsi:N(s&&s.rsi),
  adx:N(s&&s.adx),
  ema20:N(s&&s.ema20),
  ema50:N(s&&s.ema50),
  perfWeek:N(s&&s.perfWeek),
  perfMonth:N(s&&s.perfMonth),
  spread:spreadPct(s,preferTr),
  bid:preferTr?N(s&&s.trLiveBid):usLiveBid(s),
  ask:preferTr?N(s&&s.trLiveAsk):usLiveAsk(s),
  quoteAgeMs:quoteAt?Math.max(0,now-quoteAt):null,
  snapshotAgeMs:snapshotAt?Math.max(0,now-snapshotAt):null,
  chartAvailable:chartAvailable===true
 };
}
function recommendationTechnical(s,mode){
 if(!window.ViewInvAIScore||typeof window.ViewInvAIScore.technical!=='function')return recommendationTechnicalLegacy(s,mode);
 let input=recommendationEngineInput(s,mode),r=window.ViewInvAIScore.technical(input),se=currentMarketSession();
 return {score:r.score,parts:r.factors,se,change:r.change,rv:r.relVolume,adx:r.adx,rsi:r.rsi,spread:r.spread};
}
function recommendationCatalyst(s){
 if(!window.ViewInvAIScore||typeof window.ViewInvAIScore.catalyst!=='function')return recommendationCatalystLegacy(s);
 let r=window.ViewInvAIScore.catalyst(stockEvents(s));
 return {delta:r.delta,events:(r.events||[]).map(x=>({e:x.event,delta:x.delta,impact:x.impact,time:x.time}))};
}
function stockDataQuality(s,mode='us',chartAvailable=false){
 if(!s)return{score:0,level:'low',missing:['acción']};
 if(window.ViewInvAIScore&&typeof window.ViewInvAIScore.quality==='function'){
  return window.ViewInvAIScore.quality(Object.assign(recommendationEngineInput(s,mode,chartAvailable),{eventsCount:stockEvents(s).length}));
 }
 let input=recommendationEngineInput(s,mode,chartAvailable);
 let vals=[input.price,input.change,input.volume,input.relVolume,input.rsi,input.adx,input.ema20,input.ema50,input.bid,input.ask];
 let count=vals.filter(v=>N(v)!==null).length,score=Math.round(count/vals.length*100);
 return {score,level:score>=85?'high':score>=70?'good':score>=55?'medium':'low',missing:[]};
}
function recommendationAnalysis(s,mode){
 let se=currentMarketSession(),events=stockEvents(s);
 if(window.ViewInvAIScore&&typeof window.ViewInvAIScore.analyze==='function'){
  let r=window.ViewInvAIScore.analyze(recommendationEngineInput(s,mode,false),events);
  let cat={
   delta:N(r.catalystDelta)??0,
   events:((r.catalyst&&r.catalyst.events)||[]).map(x=>({e:x.event,delta:x.delta,impact:x.impact,time:x.time}))
  };
  let parts=[...(r.factors||[])];
  parts.push({label:'Noticias / eventos',delta:cat.delta,note:cat.events.length?cat.events.map(x=>EL(x.e)).join(' · '):'Sin catalizador direccional fuerte en la ventana'});
  return{
   score:N(r.score)??0,
   baseScore:N(r.baseScore)??0,
   parts,
   catalyst:cat,
   quality:r.quality||stockDataQuality(s,mode,false),
   se,
   change:N(r.change),
   rv:N(r.relVolume),
   adx:N(r.adx),
   rsi:N(r.rsi),
   spread:N(r.spread),
   engineVersion:r.version||window.ViewInvAIScore.VERSION||''
  };
 }
 let a=recommendationTechnical(s,mode),cat=recommendationCatalyst(s);
 a.parts.push({label:'Noticias / eventos',delta:cat.delta,note:cat.events.length?cat.events.map(x=>EL(x.e)).join(' · '):'Sin catalizador direccional fuerte en la ventana'});
 a.catalyst=cat;
 a.score=Math.max(0,Math.min(100,Math.round((a.score+cat.delta)*10)/10));
 a.quality=stockDataQuality(s,mode,false);
 return a;
}

const recommendationChartCache=new Map();
function avgNumbers(values){
 let rows=values.map(N).filter(v=>v!==null);
 return rows.length?rows.reduce((a,b)=>a+b,0)/rows.length:null;
}
async function recommendationChartAnalysis(s,mode){
 let key=mode+':'+stockKey(s),cached=recommendationChartCache.get(key);
 if(cached&&Date.now()-cached.at<90000)return cached.value;
 let result={available:false,confirmed:false,delta:-6,points:0,note:'Histórico intradía no disponible'};
 try{
  let url='';
  if(mode==='tr'&&trTradable(s)&&trIsin(s)){
   url='/api/tr-history?isin='+encodeURIComponent(trIsin(s))+'&exchange='+encodeURIComponent(s.trExchange||'LSX')+'&range=1d&resolution=60000';
  }else if(s&&s.ticker){
   url='/api/us-chart?symbol='+encodeURIComponent(s.ticker);
  }
  if(!url)throw Error('no chart source');
  let r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error(String(r.status));
  let data=await r.json(),raw=Array.isArray(data&&data.points)?data.points:[];
  let pts=raw.map(p=>({close:N(p&&((p.close!==undefined)?p.close:p.price)),volume:N(p&&p.volume)})).filter(p=>p.close!==null);
  if(pts.length<35)throw Error('insufficient chart');
  pts=pts.slice(-180);
  let closes=pts.map(p=>p.close),last=closes[closes.length-1];
  let sma10=avgNumbers(closes.slice(-10)),sma30=avgNumbers(closes.slice(-30));
  let base20=closes[Math.max(0,closes.length-21)],ret20=base20>0?(last/base20-1)*100:null;
  let hi30=Math.max(...closes.slice(-30)),lo30=Math.min(...closes.slice(-30));
  let drawdown=hi30>0?(last/hi30-1)*100:null;
  let rangePos=hi30>lo30?(last-lo30)/(hi30-lo30):.5;
  let recentVol=avgNumbers(pts.slice(-8).map(p=>p.volume)),priorVol=avgNumbers(pts.slice(-28,-8).map(p=>p.volume));
  let volExpansion=recentVol!==null&&priorVol>0?recentVol/priorVol:null;
  let delta=0,notes=[];
  let trendUp=last>sma10&&sma10>sma30;
  if(trendUp){delta+=8;notes.push('precio > media corta > media larga')}else{delta-=8;notes.push('gráfico sin estructura alcista clara')}
  if(ret20!==null){
   if(ret20>=.4&&ret20<=8){delta+=5;notes.push('impulso intradía '+PC(ret20))}
   else if(ret20>8&&ret20<=15){delta+=2;notes.push('impulso fuerte '+PC(ret20))}
   else if(ret20<0){delta-=5;notes.push('impulso reciente negativo')}
   else if(ret20>20){delta-=7;notes.push('movimiento demasiado extendido')}
  }
  if(drawdown!==null){
   if(drawdown>=-4){delta+=3;notes.push('cerca de máximos recientes')}
   else if(drawdown<-10){delta-=4;notes.push('retroceso profundo desde máximos')}
  }
  if(rangePos>=.7)delta+=2;
  if(volExpansion!==null){
   if(volExpansion>=1.35){delta+=3;notes.push('volumen acelerando '+F(volExpansion,2)+'×')}
   else if(volExpansion<.7){delta-=2;notes.push('volumen intradía perdiendo fuerza')}
  }
  delta=Math.max(-18,Math.min(18,Math.round(delta*10)/10));
  let confirmed=trendUp&&ret20!==null&&ret20>.3&&ret20<=15&&drawdown!==null&&drawdown>=-8;
  result={available:true,confirmed,delta,points:pts.length,last,sma10,sma30,ret20,drawdown,volExpansion,note:notes.join(' · ')};
 }catch(_){}
 recommendationChartCache.set(key,{at:Date.now(),value:result});
 return result;
}
async function highConvictionRecommendation(mode){
 let s=pickRecommendation(mode);
 if(!s)return null;
 let a=recommendationAnalysis(s,mode),chart=await recommendationChartAnalysis(s,mode);
 let se=a.se,vol=SV(s,se),price=N(verifiedDisplayQuote(s,mode==='tr',se).price),ema20=N(s.ema20),ema50=N(s.ema50);
 let trendOk=price!==null&&ema20!==null&&ema50!==null&&price>=ema20&&ema20>=ema50;
 let severeNegative=(a.catalyst.events||[]).some(x=>N(x.delta)!==null&&x.delta<=-5);
 let dataQuality=stockDataQuality(s,mode,chart.available);
 let combined=Math.max(0,Math.min(100,Math.round((a.score+chart.delta)*10)/10));
 let gates={
  score:a.score>=82,
  combined:combined>=88,
  chart:chart.available&&chart.confirmed,
  trend:trendOk,
  volume:vol!==null&&vol>=75000,
  relVolume:a.rv!==null&&a.rv>=1.25,
  adx:a.adx!==null&&a.adx>=25,
  rsi:a.rsi!==null&&a.rsi>=42&&a.rsi<=72,
  spread:a.spread===null||a.spread<=3.5,
  momentum:a.change!==null&&a.change>=.5&&a.change<=20,
  catalyst:a.catalyst.delta>=-1.5&&!severeNegative,
  quality:dataQuality.score>=70
 };
 let eligible=Object.values(gates).every(Boolean);
 let reasons=[];
 if(chart.confirmed)reasons.push('gráfico confirmado');
 if(a.rv!==null)reasons.push('RV '+F(a.rv,2)+'×');
 if(a.adx!==null)reasons.push('ADX '+F(a.adx,0));
 if(a.rsi!==null)reasons.push('RSI '+F(a.rsi,0));
 if(a.catalyst.events&&a.catalyst.events.length)reasons.push('noticias/eventos revisados');
 return{s,mode,eligible,score:combined,baseScore:a.score,analysis:a,chart,gates,reasons,dataQuality};
}
function recommendationSignal(score,bucket,qualityScore=100){
 if(qualityScore<55)return{key:'wait',label:'ESPERAR',text:'Faltan datos suficientes para emitir una señal fuerte.'};
 if(bucket.armed&&score<=50)return{key:'sell',label:'VENTA',text:'La tesis ha perdido suficiente fuerza para activar salida.'};
 if(bucket.armed)return{key:'hold',label:'MANTENER',text:'La tesis sigue activa, pero sin nueva señal de compra.'};

 let shared=window.ViewInvAIScore&&typeof window.ViewInvAIScore.watchSignal==='function'
  ?window.ViewInvAIScore.watchSignal(score,qualityScore)
  :(score>=72?'BUY':score>=60?'WATCH':score<35?'AVOID':'WAIT');
 if(shared==='BUY'){bucket.armed=true;return{key:'buy',label:'COMPRA',text:'Convicción suficiente para entrada según el motor común de ViewInvAI.'}}
 if(shared==='WATCH')return{key:'watch',label:'VIGILAR',text:'La candidata es interesante, pero todavía no supera el umbral común de entrada.'};
 if(shared==='AVOID')return{key:'wait',label:'EVITAR',text:'El balance actual de señales no justifica una entrada.'};
 return{key:'wait',label:'ESPERAR',text:'No hay convicción suficiente para una entrada rigurosa en este momento.'};
}
function pickRecommendation(mode){
 let bucket=recommendationBucket(mode),current=bucket.key?stockByKey(bucket.key):null;
 if(current&&recommendationEligible(current,mode)&&!recommendationSoldRecently(mode,bucket.key))return current;
 bucket.key=null;bucket.armed=false;bucket.selectedAt=0;
 let candidates=db.stocks.filter(s=>recommendationEligible(s,mode)&&!recommendationSoldRecently(mode,stockKey(s)));
 if(!candidates.length){saveRecommendationState();return null}
 let shortlist=candidates.map(s=>({s,a:recommendationTechnical(s,mode)})).sort((x,y)=>y.a.score-x.a.score).slice(0,100);
 let ranked=shortlist.map(x=>({s:x.s,a:recommendationAnalysis(x.s,mode)})).sort((x,y)=>y.a.score-x.a.score);
 let chosen=ranked[0]&&ranked[0].s;
 if(chosen){bucket.key=stockKey(chosen);bucket.selectedAt=Date.now();bucket.armed=false}
 saveRecommendationState();
 return chosen||null;
}
function recommendationNarrative(a){
 let pos=a.parts.filter(x=>x.delta>2).sort((x,y)=>y.delta-x.delta).slice(0,3);
 let neg=a.parts.filter(x=>x.delta<-2).sort((x,y)=>x.delta-y.delta).slice(0,3);
 let out=[];
 if(pos.length)out.push('A favor: '+pos.map(x=>x.label+' ('+(x.delta>=0?'+':'')+F(x.delta,1)+')').join(', ')+'.');
 if(neg.length)out.push('En contra: '+neg.map(x=>x.label+' ('+F(x.delta,1)+')').join(', ')+'.');
 return out.join(' ')||'Las señales disponibles están equilibradas.';
}
const RECO_MOBILE_GROUPS=[
 {key:'general',label:'General',columns:[['price','Precio'],['change','Variación']]},
 {key:'ai',label:'IA',columns:[['signal','Señal'],['score','Score']]},
 {key:'technical',label:'Técnico',columns:[['rsi','RSI'],['adx','ADX']]},
 {key:'trend',label:'Tend.',columns:[['ema20','EMA20'],['ema50','EMA50']]},
 {key:'market',label:'Mercado',columns:[['bid','BID'],['ask','ASK']]},
 {key:'events',label:'Eventos',columns:[['events','Eventos'],['nextEvent','Próximo']]},
 {key:'data',label:'Datos',columns:[['quality','Calidad'],['relVolume','Vol. rel.']]}
];
let recommendationMobileGroup='general';
function recommendationCompactView(){
 return document.documentElement.dataset.nativeApp==='1'||!!(window.matchMedia&&window.matchMedia('(max-width:820px)').matches);
}
function recommendationGroup(){
 return RECO_MOBILE_GROUPS.find(g=>g.key===recommendationMobileGroup)||RECO_MOBILE_GROUPS[0];
}
function setRecommendationMobileGroup(key){
 if(!RECO_MOBILE_GROUPS.some(g=>g.key===key))key='general';
 recommendationMobileGroup=key;
 renderRecommendation();
}
function recommendationMobileTabs(){
 return '<nav class="reco-mobile-groups" aria-label="Datos de Ideas IA">'+RECO_MOBILE_GROUPS.map(g=>
  '<button type="button" class="'+(g.key===recommendationMobileGroup?'active':'')+'" data-reco-mobile-group="'+E(g.key)+'" aria-pressed="'+(g.key===recommendationMobileGroup?'true':'false')+'">'+E(g.label)+'</button>'
 ).join('')+'</nav>';
}
function recommendationNextEvent(a){
 let rows=(a&&a.catalyst&&Array.isArray(a.catalyst.events)?a.catalyst.events:[]).map(x=>x&&x.e).filter(Boolean);
 if(!rows.length)return null;
 rows.sort((x,y)=>{
  let ax=new Date(x.date||0).getTime(),ay=new Date(y.date||0).getTime();
  if(!Number.isFinite(ax))ax=Number.MAX_SAFE_INTEGER;
  if(!Number.isFinite(ay))ay=Number.MAX_SAFE_INTEGER;
  return ax-ay;
 });
 return rows[0]||null;
}
function recommendationMobileCell(key,s,mode,a,signal,quality){
 let preferTr=mode==='tr',value='—',tone='text',n=null;
 if(key==='price'){
  let q=canonicalQuote(s,preferTr),sym=q.nativeCurrency==='EUR'?'€':'\u0024';
  value=quoteMoney(q.price,sym,quotePrecision(s,preferTr,SP(s,a.se)));
 }else if(key==='change'){
  n=N(a.change);value=PC(n);tone=n===null?'muted':n>=0?'positive':'negative';
 }else if(key==='signal'){
  value=signal.label;tone='signal '+signal.key;
 }else if(key==='score'){
  value=F(a.score,1)+'/100';tone='score';
 }else if(key==='rsi'){
  n=N(s.rsi);value=n===null?'—':F(n,1);
 }else if(key==='adx'){
  n=N(s.adx);value=n===null?'—':F(n,1);
 }else if(key==='ema20'){
  n=N(s.ema20);value=n===null?'—':PR(n);
 }else if(key==='ema50'){
  n=N(s.ema50);value=n===null?'—':PR(n);
 }else if(key==='bid'){
  n=preferTr?N(s.trLiveBid):usLiveBid(s);value=quoteMoney(n,preferTr?'€':'\u0024',quotePrecision(s,preferTr));
 }else if(key==='ask'){
  n=preferTr?N(s.trLiveAsk):usLiveAsk(s);value=quoteMoney(n,preferTr?'€':'\u0024',quotePrecision(s,preferTr));
 }else if(key==='events'){
  value=String(a.catalyst&&a.catalyst.events?a.catalyst.events.length:0);
 }else if(key==='nextEvent'){
  let e=recommendationNextEvent(a);value=e?eventWhen(e):'—';
 }else if(key==='quality'){
  value=F(quality.score,0)+'/100';
 }else if(key==='relVolume'){
  n=RV(s,a.se);value=n===null?'—':F(n,2)+'×';
 }
 return{value,tone};
}
function recommendationMobileItem(mode,s){return recommendationCard(mode,s,recommendationGroup());}
function recommendationMobileList(us,tr){
 let group=recommendationGroup();
 return recommendationMobileTabs()+
  '<div class="reco-mobile-compare">'+
   window.ViewInvAICards.head(group.columns.map(([,label])=>label))+
   '<div class="reco-mobile-rows">'+recommendationMobileItem('us',us)+recommendationMobileItem('tr',tr)+'</div>'+
  '</div>';
}

function recommendationCard(mode,s,group=null){
 if(!s)return '<div class="empty-state">No hay una candidata con datos suficientes para este mercado.</div>';
 let preferTr=mode==='tr',bucket=recommendationBucket(mode),a=recommendationAnalysis(s,mode),quality=stockDataQuality(s,mode,false),wasArmed=!!bucket.armed,signal=recommendationSignal(a.score,bucket,quality.score);
 if(bucket.armed!==wasArmed)saveRecommendationState();
 let factors=a.parts.map(x=>'<div class="reco-factor"><div><span>'+E(x.label)+'</span><small>'+E(x.note||'')+'</small></div><b class="'+(x.delta>0?'positive':x.delta<0?'negative':'')+'">'+(x.delta>0?'+':'')+F(x.delta,1)+'</b></div>').join('');
 let events=a.catalyst.events.length?a.catalyst.events.map(x=>'<div class="reco-event"><strong>'+E(EL(x.e))+'</strong><span>'+E(x.e.title||x.e.fact||'Catalizador')+'</span><small>'+E(eventWhen(x.e))+'</small></div>').join(''):'<p>Sin noticia o evento direccional fuerte en las últimas 72 h / próximos 14 días.</p>';
 let sold=signal.key==='sell'?'<button type="button" class="btn small reco-sold" data-reco-sold="'+mode+'">He vendido · buscar siguiente</button>':'';
 let details='<strong>'+E(signal.text)+'</strong><p>'+E(recommendationNarrative(a))+'</p>'+quoteFreshnessHtml(s,preferTr)+bidAskHtml(s,preferTr)+
  '<details class="reco-disclosure"><summary>Factores del análisis</summary><div class="reco-factors">'+factors+'</div></details>'+
  '<details class="reco-disclosure"><summary>Noticias y eventos</summary><div class="reco-events">'+events+'</div></details>'+
  '<p>Datos '+quality.score+'/100 · Convicción heurística, no probabilidad estadística.</p>';
 let cells=group?group.columns.map(([key,label])=>({...recommendationMobileCell(key,s,mode,a,signal,quality),label})):undefined;
 if(group)cells=group.columns.map(([key,label],i)=>['price','change'].includes(key)?{...stockMobileCell(s,key,a.se,preferTr),label}:cells[i]);
 return standardStockCard(s,0,{se:a.se,preferTr,rankLabel:'',context:'recommendation',hint:'Recomendación actual',cells,
  subtitle:(preferTr?'TR / LSX':'EEUU')+' · '+signal.label+' · '+F(a.score,1)+'/100',
  detailsHtml:details,detailsLabel:'Tesis IA · factores · noticias',detailsClass:'reco-mobile-detail',actionsHtml:sold});
}
function renderRecommendation(){
 let box=$('#recommendationResults');if(!box)return;
 let us=pickRecommendation('us'),tr=pickRecommendation('tr');
 box.innerHTML=recommendationCompactView()?recommendationMobileList(us,tr):(recommendationCard('us',us)+recommendationCard('tr',tr));
 let stamp=$('#recommendationUpdated');
 if(stamp)stamp.textContent='Recalculado '+new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'})+(db.meta.updatedAt?' · snapshot '+new Date(db.meta.updatedAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'');
 requestAnimationFrame(()=>{observeActiveTrLivePrices();pollUsLive()});
}
function markRecommendationSold(mode){
 if(!['us','tr'].includes(mode))return;
 let bucket=recommendationBucket(mode),key=bucket.key;if(!key)return;
 recommendationState.sold[mode][key]=Date.now();
 bucket.key=null;bucket.selectedAt=0;bucket.armed=false;
 saveRecommendationState();
 renderRecommendation();
}
