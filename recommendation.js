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
 if(!s)return false;
 if(mode==='tr')return trTradable(s)&&trLivePrice(s)!==null;
 if(!market(s,'us'))return false;
 let se=currentMarketSession();
 return SP(s,se)!==null||usLivePrice(s)!==null;
}
function recommendationTechnicalLegacy(s,mode){
 let preferTr=mode==='tr',se=currentMarketSession(),score=50,factors=[];
 let add=(label,delta,note)=>{delta=Math.round(Number(delta||0)*10)/10;score+=delta;factors.push({label,delta,note})};
 let displayQuote=preferTr?canonicalQuote(s,true):verifiedDisplayQuote(s,false,se);
 let ch=N(displayQuote.change),rv=RV(s,se),adx=N(s.adx),rsi=N(s.rsi);
 // EMAs are sourced from the US underlying and are USD-denominated. When the
 // selected venue is LSX, compare them with the LSX quote converted to USD.
 let p=preferTr?N(displayQuote.usd):N(displayQuote.price),ema20=N(s.ema20),ema50=N(s.ema50),week=N(s.perfWeek),month=N(s.perfMonth),vol=SV(s,se),sp=spreadPct(s,preferTr);

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
 let quote=preferTr?canonicalQuote(s,true):verifiedDisplayQuote(s,false,se),snapshotAt=parseMarketTimestamp(db.meta&&db.meta.updatedAt);
 let quoteAt=preferTr?(N(s&&s.trLiveUpdatedAt)??N(s&&s.trLiveReceivedAt)):(N(s&&s.usLiveReceivedAt)??parseMarketTimestamp(s&&s.usLiveTimestamp,'America/New_York'));
 let now=Date.now();
 return {
  price:preferTr?N(quote&&quote.usd):(quote&&N(quote.price)!==null?N(quote.price):SP(s,se)),
  change:preferTr?N(quote&&quote.change):(quote&&N(quote.change)!==null?N(quote.change):marketChange(s,se,false)),
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
  const controller=typeof AbortController!=='undefined'?new AbortController():null;
  const timer=setTimeout(()=>{try{controller&&controller.abort()}catch(_){}},4500);
  let r;
  try{r=await fetch(url,{cache:'no-store',...(controller?{signal:controller.signal}:{})})}
  finally{clearTimeout(timer)}
  if(!r.ok)throw Error(String(r.status));
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

const pulseAiCache=new Map();
async function pulseAiValidate(result){
 if(!result||!result.s)return result;
 let cacheKey=result.mode+':'+stockKey(result.s)+':'+String(db.meta&&db.meta.updatedAt||'');
 let cached=pulseAiCache.get(cacheKey);if(cached&&Date.now()-cached.at<120000)return Object.assign({},result,cached.value);
 const auth=window.ViewInvAIAuth;
 if(!auth||!auth.getUser?.()||!auth.apiFetch)return result;
 try{
  const s=result.s,preferTr=result.mode==='tr',quote=canonicalQuote(s,preferTr),fresh=quoteFreshnessInfo(s,preferTr);
  if(fresh.state!=='live'||N(quote.price)===null)return Object.assign({},result,{eligible:false,reasons:[...(result.reasons||[]),'cotización no ejecutable en tiempo real']});
  const aiRequest=auth.apiFetch('/api/ai/chat',{method:'POST',body:JSON.stringify({
   stockKey:stockKey(s),ticker:s.ticker||s.trTicker||'',isin:preferTr?(s.trIsin||s.isin):(s.usIsin||s.isin),preferTr,
   question:'Radar AI: evalúa si existe una entrada de alta convicción AHORA. Considera tendencia, volumen, RSI/ADX, liquidez, riesgo de FOMO y noticias/eventos. Sé conservador y no fuerces una compra.',
   live:{price:N(quote.price),changePct:N(quote.change),source:quote.source||'',updatedAt:quote.updatedAt||null,bid:preferTr?N(s.trLiveBid):usLiveBid(s),ask:preferTr?N(s.trLiveAsk):usLiveAsk(s)}
  })});
  const response=await Promise.race([
   aiRequest,
   new Promise((_,reject)=>setTimeout(()=>reject(Error('Pulse AI timeout')),8000))
  ]);
  if(!response.ok)return result;
  const ai=await response.json(),aiSignal=String(ai.signal||'').toUpperCase(),confidence=N(ai.confidence)??0;
  const hardSafe=result.dataQuality&&result.dataQuality.score>=65&&result.gates.quoteFresh&&result.gates.book&&result.gates.volume&&result.gates.spread&&result.gates.catalyst&&result.gates.chart&&result.gates.trend&&result.gates.momentum;
  // A deterministic fallback (model unavailable) is not an AI validation.
  const eligible=hardSafe&&ai.fallback!==true&&aiSignal==='COMPRAR'&&confidence>=70&&result.score>=68;
  const value={eligible,ai,aiValidated:true,reasons:[...(result.reasons||[]),...(Array.isArray(ai.keyPoints)?ai.keyPoints.slice(0,2):[])]};
  pulseAiCache.set(cacheKey,{at:Date.now(),value});return Object.assign({},result,value);
 }catch(e){console.warn('Pulse AI validation failed',e);return result}
}

let recommendationRenderCache={html:'',updatedAt:0,snapshot:''};
let recommendationRenderPromise=null;
const highConvictionRuntimeCache=new Map();
async function highConvictionRecommendation(mode){
 let cacheKey=mode+':'+String(db.meta&&db.meta.updatedAt||'');
 let cached=highConvictionRuntimeCache.get(cacheKey);if(cached&&Date.now()-cached.at<120000)return cached.value;
 let candidates=db.stocks
  .filter(s=>recommendationEligible(s,mode)&&!recommendationSoldRecently(mode,stockKey(s)))
  .map(s=>({s,a:recommendationAnalysis(s,mode)}))
  .filter(x=>(x.a.quality&&N(x.a.quality.score)!==null?N(x.a.quality.score):0)>=50)
  .sort((a,b)=>b.a.score-a.a.score)
  .slice(0,8);
 const withCharts=await Promise.all(candidates.map(async row=>({row,chart:await recommendationChartAnalysis(row.s,mode)})));
 let ranked=withCharts.map(({row,chart})=>{
  let s=row.s,a=row.a,se=a.se,venueQuote=canonicalQuote(s,mode==='tr'),fresh=quoteFreshnessInfo(s,mode==='tr');
  let vol=mode==='tr'?SV(s,se):(N(s.usLiveVolume)??SV(s,se)),price=mode==='tr'?N(venueQuote.usd):N(venueQuote.price),ema20=N(s.ema20),ema50=N(s.ema50);
  let bid=mode==='tr'?N(s.trLiveBid):usLiveBid(s),ask=mode==='tr'?N(s.trLiveAsk):usLiveAsk(s);
  let bookOk=bid!==null&&ask!==null&&ask>=bid,quoteFresh=fresh.state==='live'&&N(venueQuote.price)!==null&&venueQuote.fallback!==true;
  let trendOk=price!==null&&ema20!==null&&ema50!==null&&price>=ema20&&ema20>=ema50;
  let severeNegative=(a.catalyst.events||[]).some(x=>N(x.delta)!==null&&x.delta<=-5);
  let dataQuality=stockDataQuality(s,mode,chart.available);
  let combined=Math.max(0,Math.min(100,Math.round((a.score+chart.delta)*10)/10));
  let gates={
   quoteFresh,book:bookOk,
   score:a.score>=68,combined:combined>=68,chart:chart.available?chart.confirmed:true,trend:trendOk,
   volume:vol!==null&&vol>=50000,relVolume:a.rv===null||a.rv>=1,adx:a.adx===null||a.adx>=18,
   rsi:a.rsi===null||(a.rsi>=38&&a.rsi<=78),spread:a.spread!==null&&a.spread<=4.5,
   momentum:a.change!==null&&a.change>=-.5&&a.change<=25,catalyst:a.catalyst.delta>=-3&&!severeNegative,
   quality:dataQuality.score>=60
  };
  let reasons=[];if(!quoteFresh)reasons.push('cotización no ejecutable');if(!bookOk)reasons.push('BID/ASK incompleto');if(chart.confirmed)reasons.push('gráfico confirmado');if(a.rv!==null)reasons.push('RV '+F(a.rv,2)+'×');if(a.adx!==null)reasons.push('ADX '+F(a.adx,0));if(a.rsi!==null)reasons.push('RSI '+F(a.rsi,0));
  return{s,mode,eligible:false,score:combined,baseScore:a.score,analysis:a,chart,gates,reasons,dataQuality};
 }).sort((a,b)=>b.score-a.score);
 let best=ranked[0]||null;
 if(best)best=await pulseAiValidate(best);
 if(best&&best.eligible){
  let bucket=recommendationBucket(mode);bucket.key=stockKey(best.s);bucket.selectedAt=Date.now();bucket.armed=true;saveRecommendationState();
 }
 highConvictionRuntimeCache.set(cacheKey,{at:Date.now(),value:best});
 return best;
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
 return '<nav class="reco-mobile-groups" aria-label="Datos de Radar AI">'+RECO_MOBILE_GROUPS.map(g=>
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
function recommendationMobileItem(mode,result){
 let isResult=!!(result&&result.s),s=isResult?result.s:result;
 return recommendationCard(mode,s||null,recommendationGroup(),isResult?result:null);
}
function recommendationMarketSection(mode,result){
 const isTr=mode==='tr';
 const title=isTr?'Trade Republic':'EEUU';
 const subtitle=isTr?'LSX · cotización y ejecución en EUR':'NASDAQ / NYSE / AMEX · cotización en USD';
 return '<section class="pulse-market-group pulse-market-'+mode+'">'+
  '<header class="pulse-market-head"><div><strong>'+title+'</strong><span>'+subtitle+'</span></div></header>'+
  '<div class="pulse-market-list unified-asset-list">'+recommendationMobileItem(mode,result)+'</div>'+
 '</section>';
}
function recommendationCompactList(usResult,trResult){
 return '<div class="pulse-list-shell">'+
  recommendationMobileTabs()+
  recommendationMarketSection('tr',trResult)+
  recommendationMarketSection('us',usResult)+
 '</div>';
}

function recommendationMobileList(usResult,trResult){
 return recommendationCompactList(usResult,trResult);
}

function radarAiCandidateRows(mode,advanced=null){
 const preferTr=mode==='tr',rows=[];let analyzed=0;
 for(const s of (db.stocks||[])){
  if(preferTr){
   if(!trTradable(s))continue;
  }else if(!market(s,'us'))continue;
  analyzed++;
  if(recommendationSoldRecently(mode,stockKey(s)))continue;
  const liveVenue=!preferTr||trLivePrice(s)!==null;
  const analysisMode=preferTr&&liveVenue?'tr':'us';
  const a=recommendationAnalysis(s,analysisMode);
  const q=stockDataQuality(s,analysisMode,false);
  let score=N(a.score)??0,quality=N(q&&q.score)??0;
  if(preferTr&&!liveVenue){score=Math.max(0,score-8);quality=Math.min(quality,55)}
  const shared=window.ViewInvAIScore&&typeof window.ViewInvAIScore.watchSignal==='function'
   ?window.ViewInvAIScore.watchSignal(score,quality)
   :(score>=72&&quality>=60?'BUY':score>=60?'WATCH':'WAIT');
  // Misma regla que el marcador y los avisos: filtro de entrada (precio, capitalización, liquidez en
  // dinero y sin dilución reciente) y niveles exigentes; lo que no pasa el filtro solo entra como
  // especulativo si la señal es muy fuerte.
  const rt=window.ViewInvAIScore&&typeof window.ViewInvAIScore.radarTier==='function'
   ?window.ViewInvAIScore.radarTier({score,quality,price:N(s.price),marketCap:N(s.marketCap),avgVolume:N(s.avgVolume),events:stockEvents(s),market:preferTr?'tr':'us'})
   :{tier:score>=72&&quality>=60?'opportunity':score>=62&&quality>=55?'watch':'',eligible:true,reasons:[]};
  if(!rt.tier)continue;
  let tier=rt.tier==='spec'?'opportunity':rt.tier;
  if(rt.eligible&&advanced&&advanced.eligible&&advanced.s&&stockKey(advanced.s)===stockKey(s))tier='high';
  const spec={speculative:rt.tier==='spec',reasons:rt.reasons};
  // Opinión de una IA externa (pegada o con clave, últimos 3 días): si contradice baja un nivel
  // (sin salir del Radar); si respalda, la acción queda marcada como reforzada.
  const ai=window.ViewInvAIContrast&&window.ViewInvAIContrast.tickerVerdict?window.ViewInvAIContrast.tickerVerdict(s.ticker||s.trTicker,stockKey(s)):null;
  if(ai&&ai.verdict==='contradice'&&!spec.speculative)tier=tier==='high'?'opportunity':'watch';
  rows.push({s,mode,preferTr,analysis:a,quality,score,tier,liveVenue,speculative:spec.speculative,specReasons:spec.reasons||[],ai,advanced:advanced&&advanced.s&&stockKey(advanced.s)===stockKey(s)?advanced:null});
 }
 const aiRank=r=>r.ai?(r.ai.verdict==='respalda'?4:r.ai.verdict==='contradice'?-4:0):0;
 rows.sort((a,b)=>(b.score+aiRank(b))-(a.score+aiRank(a))||b.quality-a.quality||String(a.s.ticker||'').localeCompare(String(b.s.ticker||'')));
 rows.analyzed=analyzed;
 return rows;
}
function radarAiCard(row){
 const s=row.s,preferTr=row.preferTr,a=row.analysis;
 const tierLabel=row.tier==='high'?'ALTA CONVICCIÓN':row.tier==='opportunity'?'OPORTUNIDAD':'VIGILANCIA';
 const venueNote=preferTr&&!row.liveVenue?' · LSX pendiente':'';
 const ticker=preferTr?(s.trTicker||s.ticker):(s.ticker||s.trTicker);
 // Compact card: the score is the chip beside the name (ring colour by tier) and data
 // quality joins the subtitle, so the Score/Datos row is no longer needed.
 return standardStockCard(s,0,{
  se:a.se||currentMarketSession(),preferTr,rankLabel:F(row.score,0),context:'recommendation',
  hint:'Radar AI · '+tierLabel+' · score '+F(row.score,0)+'/100'+(row.speculative?' · Especulativo: '+row.specReasons.join(', '):'')+(row.ai?' · IA externa: '+row.ai.verdict+(row.ai.reason?' ('+row.ai.reason+')':''):''),cells:[],
  className:'radar-ai-card radar-ai-card-'+(row.speculative?'spec':row.tier),
  cardAttrs:' data-radar-open-key="'+E(stockKey(s))+'" data-radar-open-tr="'+(preferTr?'1':'0')+'" role="button" tabindex="0"',
  subtitle:(row.speculative?'⚠ Especulativo · ':'')+[ticker,preferTr?'LSX':(s.exchange||'EEUU'),'Calidad '+F(row.quality,0)].filter(Boolean).join(' · ')+venueNote,
  openAttrs:stockOpenAttrs(s,'Radar AI',preferTr),
  metaHtml:row.ai&&window.ViewInvAIContrast?window.ViewInvAIContrast.badgeHtml(row.ai):'',
  detailsHtml:''
 });
}
// ----- Contraste opcional con las IA del usuario (Configuración › Integrar la IA) -----
// No cambia el cálculo: solo añade la opinión de las IA activas sobre la selección del día.
function radarAiContrastKey(mode){return mode+':'+new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Madrid'})}
function radarAiContrastPool(rows){return[...radarAiTierRows(rows,'high'),...radarAiTierRows(rows,'opportunity'),...radarAiTierRows(rows,'watch'),...radarAiTierRows(rows,'spec')]}
function radarAiContrastPrompt(rows,mode,selected=null){
 const isTr=mode==='tr',want=selected?new Set(selected):null;
 const pick=radarAiContrastPool(rows).filter(r=>!want||want.has(String(r.s.ticker||r.s.trTicker||'').toUpperCase()));
 const lines=pick.map(r=>{
  const s=r.s,ticker=s.ticker||s.trTicker,isin=s.trIsin||s.isin;
  const level=r.speculative?'especulativo':RADAR_TIER_LABEL[r.tier]||r.tier;
  const bits=[ticker+' ('+(s.name||'')+(s.exchange?', '+s.exchange:'')+(isin?', ISIN '+isin:'')+')','nivel '+level,'score '+F(r.score,0)+'/100','calidad de datos '+F(r.quality,0)+'/100'];
  if(N(s.price)!==null)bits.push('precio '+F(s.price,2)+' '+(s.currency||'USD'));
  if(N(s.perfWeek)!==null)bits.push('semana '+(s.perfWeek>0?'+':'')+F(s.perfWeek,1)+'%');
  if(N(s.perfMonth)!==null)bits.push('mes '+(s.perfMonth>0?'+':'')+F(s.perfMonth,1)+'%');
  if(s.sector)bits.push('sector '+s.sector);
  if(r.speculative&&r.specReasons.length)bits.push('avisos: '+r.specReasons.join(', '));
  return '- '+bits.join(' · ');
 });
 const C=window.ViewInvAIContrast;
 const context=pick.map(x=>C&&C.stockContext?C.stockContext(x.s,isTr,1):'').filter(Boolean).join('\n\n');
 return 'Selección de hoy del Radar AI de ViewInvAI para '+(isTr?'Trade Republic (acciones negociables en LSX, en euros)':'EEUU (NASDAQ/NYSE/AMEX)')+'.\n'+
  'El motor puntúa momentum, tendencia, volumen, RSI/ADX, liquidez, catalizadores y calidad de datos. Niveles: alta convicción > oportunidad > vigilancia; «especulativo» = señal fuerte pero sin pasar el filtro de entrada.\n'+
  'Contrasta prioritariamente con los datos actuales aportados por ViewInvAI. Si falta información reciente, dilo; no inventes noticias ni fechas.\n\n'+
  (lines.length?lines.join('\n'):'(sin valores seleccionados hoy)')+
  (context?'\n\nDATOS ACTUALES Y EVENTOS APORTADOS POR VIEWINVAI:\n'+context:'');
}
function radarAiContrastPanel(rows,mode){
 const C=window.ViewInvAIContrast;if(!C||!rows.length)return'';
 const seen=new Set(),choices=[];
 for(const r of radarAiContrastPool(rows)){
  const t=String(r.s.ticker||r.s.trTicker||'').toUpperCase();if(!t||seen.has(t))continue;seen.add(t);
  const group=r.speculative?'spec':r.tier;
  choices.push({ticker:t,group,label:r.speculative?'Especulativo':RADAR_TIER_LABEL[r.tier]||''});
 }
 return C.panelHtml({type:'radar',key:radarAiContrastKey(mode),title:'Radar '+(mode==='tr'?'Trade Republic':'EEUU')+' de hoy',choices,prompt:sel=>radarAiContrastPrompt(rows,mode,sel)});
}
window.addEventListener('viewinvai:ai-contrast',e=>{
 if(e.detail&&(e.detail.type==='radar'||e.detail.type==='stock'||e.detail.type==='all')&&document.querySelector('#recommendationResults .radar-ai-shell'))rerenderRadarAiList();
});
// ----- Marcador de aciertos (registro diario del servidor) -----
let radarScoreboard={at:0,data:null,loading:false},radarScoreboardOpen=false;
document.addEventListener('toggle',e=>{if(e.target&&e.target.matches&&e.target.matches('[data-radar-scoreboard]'))radarScoreboardOpen=e.target.open},true);
async function loadRadarScoreboard(){
 if(radarScoreboard.loading||(radarScoreboard.data&&Date.now()-radarScoreboard.at<10*60000))return;
 radarScoreboard.failed=false;
 radarScoreboard.loading=true;
 try{
  const r=await fetch('/api/radar-scoreboard',{cache:'no-store'});
  if(!r.ok)throw Error(r.status);
  radarScoreboard={at:Date.now(),data:await r.json(),loading:false,failed:false};
 }catch(_){radarScoreboard.failed=true;radarScoreboard.at=Date.now()}
 finally{
  radarScoreboard.loading=false;
  const box=document.querySelector('[data-radar-scoreboard]');if(box)box.outerHTML=radarScoreboardHtml();
 }
}
// ----- Modelo cuantitativo (entrenado cada semana con ~10 años de históricos, data/quant-model.json) -----
const quant={model:null,modelTr:null,report:null,loading:false,at:0};
function loadQuant(){
 if(quant.loading||(quant.at&&Date.now()-quant.at<6*3600e3))return;
 quant.loading=true;
 const get=u=>fetch(u,{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);
 Promise.all([get('/data/quant-model.json'),get('/data/quant-backtest.json'),get('/data/quant-model-tr.json')]).then(([m,r,t])=>{
  quant.model=m&&Array.isArray(m.features)?m:null;quant.modelTr=t&&Array.isArray(t.features)?t:null;quant.report=r||null;quant.at=Date.now();quant.loading=false;
  if(quant.model||quant.report)window.dispatchEvent(new CustomEvent('viewinvai:quant-ready'));
 });
}
// Valores de EE. UU.: modelo entrenado con sus históricos (frente al S&P 500). Resto de valores de
// Trade Republic: modelo entrenado con 5 años de LSX (frente a la mediana de LSX).
function quantFor(s){
 if(!s)return null;
 const us=/^(NASDAQ|NYSE|AMEX|NYSE ARCA|BATS)$/i.test(String(s.exchange||''));
 if(!us&&!(typeof trTradable==='function'&&trTradable(s)))return null;
 if(!quant.at){loadQuant();return null}
 const model=us?quant.model:quant.modelTr;if(!model)return null;
 try{const q=window.ViewInvAIScore.quantScore(model,s);return q?Object.assign(q,{market:us?'us':'tr',benchmark:us?'el S&P 500':'la mediana de LSX'}):null}catch(_){return null}
}
window.ViewInvAIQuant={load:loadQuant,scoreFor:quantFor,state:()=>quant};
window.addEventListener('viewinvai:quant-ready',()=>{
 try{
  if(document.body.classList.contains('stock-detail-open')){if(typeof renderQuickProfile==='function'&&state.profileKey)renderQuickProfile()}
  else if(['recommendation','crash'].includes(state.currentView))renderCurrentView();
 }catch(_){}
});
setTimeout(loadQuant,3000);
function quantCardHtml(){
 const r=quant.report&&quant.report.radar,m=quant.model;
 if(!r||!m){loadQuant();return''}
 const top=r.model.deciles[r.model.deciles.length-1],bot=r.model.deciles[0],etop=r.engine.deciles[r.engine.deciles.length-1];
 const better=r.engine.aucModelSameSample>r.engine.auc;
 const preview='Probado con '+Number(quant.report.universe||0).toLocaleString('es-ES')+' valores de '+r.period.train[0].slice(0,4)+' a hoy: el 10 % mejor valorado bate al S&P 500 el '+F(top.beatRate,0)+' % de las veces (media '+F(r.baseBeatRate,0)+' %).';
 const rows=(r.byChange||[]).map(b=>'<tr><th>'+E(b.bucket)+'</th><td>'+F(b.beatRate,0)+'%</td><td class="'+(b.medianExcess>0?'positive':b.medianExcess<0?'negative':'')+'">'+radarPct(b.medianExcess,2)+'</td><td><small>n='+Number(b.n).toLocaleString('es-ES')+'</small></td></tr>').join('');
 const html='<div class="d-reading quant-card">'+
  '<p>✦ '+E(m.target)+'. Se entrena hasta '+E(r.period.train[1].slice(0,4))+' y se mide en '+E(r.period.test[0].slice(0,4))+'–'+E(r.period.test[1].slice(0,7))+', con datos que no ha visto.</p>'+
  '<ul class="quant-facts"><li><b>Modelo</b> · su 10 % mejor bate el '+F(top.beatRate,0)+' % (mediana '+radarPct(top.medianExcess,2)+' frente al S&P); su 10 % peor, el '+F(bot.beatRate,0)+' % ('+radarPct(bot.medianExcess,2)+').</li>'+
  '<li><b>Motor actual</b> · su 10 % mejor bate el '+F(etop.beatRate,0)+' % ('+radarPct(etop.medianExcess,2)+').'+(etop.beatRate<r.baseBeatRate?' Peor que la media: por eso se ha recalibrado.':'')+'</li>'+
  '<li><b>Capacidad de ordenar</b> (AUC; 0,5 es azar): modelo '+F(r.engine.aucModelSameSample,3)+' · motor '+F(r.engine.auc,3)+'.</li></ul>'+
  '<p>✦ Lectura honesta: '+(Math.abs(r.engine.aucModelSameSample-0.5)<0.02?'con solo precio y volumen apenas hay ventaja a 5 sesiones; el modelo sirve para descartar lo que históricamente sale peor (perseguir subidas de más del 15 %, volatilidad extrema) más que para elegir ganadores. Por eso el Radar exige además catalizadores verificados.':better?'el modelo ordena mejor que el motor anterior.':'aún no mejora al motor.')+'</p>'+
  (rows?'<table class="quant-table"><thead><tr><th>Subida del día</th><th>Bate al S&P</th><th>Mediana 5 s</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>':'')+
  '<p class="radar-scoreboard-method">Fuente: '+E(quant.report.source||'')+'. Sin comisiones. Solo valores que cotizan hoy. Rentabilidades pasadas no garantizan resultados futuros.</p></div>';
 return '<section class="d-group quant-group"><header><h3>Modelo cuantitativo</h3><span>'+E(m.version||'')+'</span></header>'+(typeof window.ViewInvAIFold==='function'?window.ViewInvAIFold('quant-card','Probado con 10 años de datos',preview,html):html)+'</section>';
}
// Tasa histórica de rebote para una caída de este tamaño (pruebas retrospectivas).
function crashHistoryFor(ch){
 const c=quant.report&&quant.report.crash;if(!c||!c.bySeverity){loadQuant();return null}
 const key=ch>-40?'-25 a -40 %':ch>-60?'-40 a -60 %':'< -60 %',g=c.bySeverity[key];
 return g&&g['5d']?{key,...g['5d']}:null;
}
function shortName(n){return String(n||'').replace(/,?\s+(Inc|Corp|Corporation|Ltd|plc|S\.?A|N\.?V|AG|SE|Co|Holdings?|Group)\.?$/i,'').slice(0,40)}
function radarPct(v,d=1){return v===null||v===undefined||!Number.isFinite(+v)?'—':(v>0?'+':'')+F(v,d)+'%'}
function radarScoreboardHtml(){
 const d=radarScoreboard.data;
 if(!d)return '<details class="radar-scoreboard" data-radar-scoreboard><summary><span><small>HISTORIAL DEL RADAR AI</small><b>'+(radarScoreboard.failed?'Historial no disponible ahora mismo':'Cargando aciertos…')+'</b></span></summary></details>';
 const main=d.stats&&d.stats.opportunitySolid&&d.stats.opportunitySolid['5d'];
 let head;
 if(main&&main.n>0){
  head='<b>Oportunidades a 5 sesiones: '+F(main.hitRate,0)+'% suben</b><em class="'+(main.avgExcess>0?'positive':main.avgExcess<0?'negative':'')+'">'+radarPct(main.avgReturn)+' de media · '+radarPct(main.avgExcess)+' vs S&P 500</em>';
 }else{
  const since=d.since?new Date(d.since+'T12:00:00Z').toLocaleDateString('es-ES',{day:'numeric',month:'short'}):'hoy';
  head='<b>Acumulando historial desde '+E(since)+'</b><em>Primeras cifras: a 1 sesión al día siguiente, a 5 en una semana, a 20 en un mes.</em>';
 }
 const col=(st,h)=>{const x=st&&st[h];return x&&x.n?'<td><b>'+F(x.hitRate,0)+'%</b><span>'+radarPct(x.avgReturn)+'</span><i class="'+(x.avgExcess>0?'positive':x.avgExcess<0?'negative':'')+'">'+radarPct(x.avgExcess)+'</i><small>n='+x.n+'</small></td>':'<td class="empty">—</td>'};
 const row=(label,key)=>'<tr><th>'+label+'</th>'+['1d','5d','20d'].map(h=>col(d.stats&&d.stats[key],h)).join('')+'</tr>';
 const recent=(d.recent||[]).slice(0,10).map(r=>'<li data-open-stock="'+E(r.stockKey)+'" role="button" tabindex="0"><span>'+E(new Date(r.day+'T12:00:00Z').toLocaleDateString('es-ES',{day:'2-digit',month:'short'}))+'</span><b>'+E(r.ticker)+(r.speculative?' <em>esp.</em>':'')+'<small>'+E(shortName(r.name))+'</small></b><i class="'+((r.ret5d??r.ret1d)>0?'positive':(r.ret5d??r.ret1d)<0?'negative':'')+'">'+(r.ret5d!==null&&r.ret5d!==undefined?radarPct(r.ret5d)+' 5s':r.ret1d!==null&&r.ret1d!==undefined?radarPct(r.ret1d)+' 1s':'en curso')+'</i></li>').join('');
 return '<details class="radar-scoreboard" data-radar-scoreboard'+(radarScoreboardOpen?' open':'')+'><summary><span><small>HISTORIAL DEL RADAR AI · '+(d.days||0)+' SESIONES</small>'+head+'</span></summary>'+
  '<div class="radar-scoreboard-body">'+
   '<table><thead><tr><th></th><th>1 sesión</th><th>5 sesiones</th><th>20 sesiones</th></tr></thead><tbody>'+
    row('Oportunidades sólidas','opportunitySolid')+row('Todas las oportunidades','opportunity')+row('Primera señal (sin repetir)','opportunityFirst')+row('Puntuación ≥ 80','score80')+row('Entró subiendo ≥ 8 %','chasing')+row('Entró subiendo < 8 %','calm')+row('Modelo ≥ 55 %','quantHigh')+row('Modelo < 45 %','quantLow')+row('Negociables en TR','trTradable')+row('En vigilancia','watch')+
   '</tbody></table>'+
   '<p class="radar-scoreboard-legend"><b>%</b> que suben · rentabilidad media · <i>diferencia con el S&P 500</i> · n señales. «Sólidas» excluye las especulativas; «primera señal» cuenta cada valor una vez cada 10 días.</p>'+
   (main&&main.n>0&&main.avgExcess<0?'<p class="radar-scoreboard-legend">✦ Lectura honesta: con '+(d.days||0)+' sesiones las oportunidades aún no baten al S&P 500. Es poca muestra y muchas señales se repiten días seguidos; el historial guarda ya la subida, el volumen y el RSI de cada señal para corregir el motor cuando haya datos suficientes.</p>':'')+
   (recent?'<ul class="radar-scoreboard-recent">'+recent+'</ul>':'')+
   '<p class="radar-scoreboard-method">'+E(d.method||'')+' Rentabilidades pasadas no garantizan resultados futuros.</p>'+
  '</div></details>';
}

// Radar AI as one list per market, like Radar de entrada: tabs TR / EEUU, a tier filter
// with counts and every card tinted by tier (alta convicción · oportunidad · vigilancia).
const RADAR_TIER_LABEL={high:'Alta convicción',opportunity:'Oportunidades',watch:'En vigilancia',spec:'Especulativo'};
const RADAR_TIER_LIMIT={high:5,opportunity:12,watch:15,spec:10};
let radarAiMarket=(()=>{try{return localStorage.getItem('viewinvai:radar-market')==='us'?'us':'tr'}catch(_){return'tr'}})();
let radarAiTierFilter='all',radarAiLastAdvanced={};
// Cada nivel muestra solo sus mejores señales: el Radar es una selección, no un listado del mercado.
// Nivel con el que aparece una acción en el Radar AI (mismas reglas y límites que la lista), para
// que la ficha diga lo mismo que el Radar. Se recalcula como mucho cada minuto por mercado.
const radarTierMemo={};
function radarAiTierFor(s,preferTr){
 const mode=preferTr?'tr':'us',now=Date.now();
 let m=radarTierMemo[mode];
 if(!m||now-m.at>60000||m.count!==(db.stocks||[]).length){
  const rows=radarAiCandidateRows(mode,(typeof radarAiLastAdvanced!=='undefined'&&radarAiLastAdvanced&&radarAiLastAdvanced[mode])||null),map=new Map();
  ['high','opportunity','watch','spec'].forEach(t=>radarAiTierRows(rows,t).forEach(r=>{const k=stockKey(r.s);if(!map.has(k))map.set(k,t)}));
  m=radarTierMemo[mode]={at:now,count:(db.stocks||[]).length,map};
 }
 return m.map.get(stockKey(s))||'';
}
window.ViewInvAIRadarTier=radarAiTierFor;
function radarAiTierRows(rows,t){return(t==='spec'?rows.filter(x=>x.speculative):rows.filter(x=>x.tier===t&&!x.speculative)).slice(0,RADAR_TIER_LIMIT[t])}
function radarAiVisibleRows(rows){
 if(radarAiTierFilter!=='all')return radarAiTierRows(rows,radarAiTierFilter);
 return ['high','opportunity','watch'].flatMap(t=>radarAiTierRows(rows,t));
}
function radarAiShell(advanced=radarAiLastAdvanced){
 radarAiLastAdvanced=advanced||{};
 const mode=radarAiMarket,isTr=mode==='tr';
 const rows=radarAiCandidateRows(mode,radarAiLastAdvanced[mode]||null);
 const counts={};['high','opportunity','watch','spec'].forEach(t=>{counts[t]=radarAiTierRows(rows,t).length});
 const visible=radarAiVisibleRows(rows);
 // Contraste automático con noticias de hoy e IA externa de lo que el Radar enseña (en segundo plano).
 try{const pool=radarAiContrastPool(rows).slice(0,12).map(r=>({key:stockKey(r.s),ticker:String(r.s.ticker||r.s.trTicker||'').toUpperCase(),name:r.s.name||'',isin:r.s.isin||r.s.usIsin||r.s.trIsin||'',score:Math.round(r.score),tier:r.speculative?'spec':r.tier}));
  if(pool.length&&window.ViewInvAIContrast&&window.ViewInvAIContrast.autoCheck)setTimeout(()=>window.ViewInvAIContrast.autoCheck(mode,pool),400)}catch(_){}
 const tab=(m,label)=>'<button type="button" class="tab'+(m===mode?' active':'')+'" data-radar-market="'+m+'" aria-pressed="'+(m===mode)+'">'+label+'</button>';
 const chip=(t,label,n)=>'<button type="button" class="radar-tier-chip radar-tier-chip-'+t+(radarAiTierFilter===t?' active':'')+'" data-radar-tier="'+t+'" aria-pressed="'+(radarAiTierFilter===t)+'"><i aria-hidden="true"></i>'+label+'<b>'+n+'</b></button>';
 const list=visible.length?visible.map(radarAiCard).join(''):'<div class="radar-ai-empty">'+(radarAiTierFilter==='all'?'Sin señales ahora mismo en este mercado.':'Sin valores en «'+RADAR_TIER_LABEL[radarAiTierFilter]+'» ahora mismo.')+'</div>';
 if(!radarScoreboard.data&&!radarScoreboard.loading&&(!radarScoreboard.failed||Date.now()-radarScoreboard.at>60000))setTimeout(loadRadarScoreboard,50);
 if(document.documentElement.dataset.design==='d')return radarAiShellD(rows,mode,counts,visible);
 return '<div class="radar-ai-shell radar-list-shell radar-list-'+mode+'">'+radarScoreboardHtml()+
  '<nav class="market-tabs compact-tabs radar-market-tabs" aria-label="Mercado del Radar AI">'+tab('tr','Trade Republic')+tab('us','EEUU / NASDAQ')+'</nav>'+
  '<div class="radar-list-meta">'+(isTr?'Trade Republic / LSX · EUR':'NASDAQ / NYSE / AMEX · USD')+' · '+(rows.analyzed||rows.length)+' analizadas</div>'+
  '<div class="radar-tier-filter" role="group" aria-label="Filtrar por nivel">'+
   chip('high','Alta',counts.high)+chip('opportunity','Oportunidad',counts.opportunity)+chip('watch','Vigilancia',counts.watch)+chip('spec','Especulativo',counts.spec)+
  '</div>'+
  radarAiContrastPanel(rows,mode)+
  '<div class="radar-list unified-asset-list">'+list+'</div>'+
 '</div>';
}
// Diseño D: cada idea en una fila (anillo AI, plan en una línea, precio y cápsula) y un bloque
// «Cómo se eligen» arriba. Mismas filas, niveles, contraste e historial que el diseño clásico.
function radarAiRowD(row){
 const s=row.s,preferTr=row.preferTr,q=canonicalQuote(s,preferTr)||{},cur=preferTr?'EUR':(q.nativeCurrency||'USD');
 const price=N(preferTr?q.eur:(q.usd??q.price)),change=preferTr?N(q.change):marketChange(s,currentMarketSession(),false);
 const ticker=preferTr?(s.trTicker||s.ticker):(s.ticker||s.trTicker);
 const n=Math.max(0,Math.min(100,Math.round(N(row.score)||0)));
 const level=row.speculative?'especulativo':row.tier==='high'?'alta convicción':row.tier==='opportunity'?'oportunidad':'vigilancia';
 let plan='';
 try{const P=window.ViewInvAIPortfolios,g=P&&typeof P.getGoalPlanFor==='function'?P.getGoalPlanFor(s):null;
  if(g&&g.kind==='buy')plan='Comprar'+(N(g.stopEur)!==null?' · stop '+N(g.stopEur).toLocaleString('es-ES',{style:'currency',currency:'EUR'}):'');
  else if(g&&g.kind==='position')plan=g.action&&g.action.text?g.action.text:'En tu cartera';
  else if(g&&g.kind==='wait')plan=g.text||'Esperar mejor precio';
 }catch(_){}
 if(!plan&&row.ai&&row.ai.verdict)plan='IA externa: '+row.ai.verdict;
 if(!plan&&row.speculative&&row.specReasons&&row.specReasons.length)plan='⚠ '+row.specReasons[0];
 const name=String(s.name||ticker||'—').replace(/,?\s+(Inc|Corp|Corporation|Ltd|plc|S\.?A|N\.?V|AG|SE)\.?$/i,'');
 const chg=change===null?'':'<span class="d-chip '+(Math.abs(change)<0.005?'flat':change>0?'up':'down')+'">'+(change>0?'▲ ':change<0?'▼ ':'')+F(Math.abs(change),2)+' %</span>';
 return '<li class="d-row d-tier-'+(row.speculative?'spec':row.tier)+'"><button type="button" class="d-row-main" data-open-stock="'+E(stockKey(s))+'" data-stock-prefer-tr="'+(preferTr?'1':'0')+'">'+
  '<em class="ai-score d-ring" data-band="'+(n>=80?'high':n>=60?'mid':'low')+'" data-p="'+Math.round(n/5)*5+'" title="Puntuación AI '+n+'/100">'+n+'</em>'+
  '<span class="d-row-text"><b>'+E(name)+'</b><small>'+E(ticker)+(()=>{const q=quantFor(s);return q?' · <em class="quant-tag" title="'+(q.market==='tr'?'Probabilidad de batir a la mediana de LSX en 5 sesiones (modelo entrenado con 5 años de LSX)':'Probabilidad de batir al S&amp;P 500 en 5 sesiones (modelo entrenado con 10 años)')+'">modelo '+Math.round(q.prob*100)+' %</em>':''})()+E(' · '+[preferTr?'LSX':(s.exchange||'EE. UU.'),level].filter(Boolean).join(' · '))+'</small>'+(plan?'<i class="d-row-ai">✦ '+E(plan)+'</i>':'')+'</span>'+
  '<span class="d-row-num">'+(price===null?'<small>'+(preferTr?'precio LSX pendiente':'sin precio')+'</small>':'<b>'+E(price.toLocaleString('es-ES',{style:'currency',currency:cur,minimumFractionDigits:2,maximumFractionDigits:price<1?4:2}))+'</b>')+chg+'</span></button></li>';
}
function radarAiShellD(rows,mode,counts,visible){
 const isTr=mode==='tr',ideas=counts.high+counts.opportunity;
 const tab=(m,label)=>'<button type="button" class="tab'+(m===mode?' active':'')+'" data-radar-market="'+m+'" aria-pressed="'+(m===mode)+'">'+label+'</button>';
 const pill=(t,label,n)=>'<button type="button" class="'+(radarAiTierFilter===t?'active':'')+'" data-radar-tier="'+t+'" aria-pressed="'+(radarAiTierFilter===t)+'">'+label+' '+n+'</button>';
 const first=visible[0]&&(visible[0].s.ticker||visible[0].s.trTicker);
 const list=visible.length?'<ul class="d-list">'+visible.map(radarAiRowD).join('')+'</ul>':'<div class="radar-ai-empty">'+(radarAiTierFilter==='all'?'Sin señales ahora mismo en este mercado.':'Sin valores en «'+RADAR_TIER_LABEL[radarAiTierFilter]+'» ahora mismo.')+'</div>';
 return '<div class="radar-ai-shell radar-list-shell radar-list-'+mode+' d-radar">'+
  '<nav class="market-tabs compact-tabs radar-market-tabs" aria-label="Mercado del Radar AI">'+tab('tr','Trade Republic')+tab('us','EE. UU.')+'</nav>'+
  '<section class="d-pulse"><small>Radar AI · '+(isTr?'Trade Republic / LSX':'EE. UU.')+'</small><h2>'+(ideas?ideas+(ideas===1?' idea hoy':' ideas hoy'):counts.watch?counts.watch+' en vigilancia':'Sin ideas hoy')+'</h2>'+(ideas?'':'<p class="d-hero-note">Ninguna pasa hoy el filtro de entrada; estas son las que la IA vigila.</p>')+
   (()=>{const how='De '+(rows.analyzed||rows.length)+' valores analizados en '+(isTr?'Trade Republic / LSX':'EE. UU.')+', se quedan los que combinan tendencia, volumen, catalizadores y datos fiables. Cada idea se contrasta con noticias y con tu IA antes de enseñarse.';
    const html='<div class="d-reading"><p><span aria-hidden="true">✦</span> '+E(how)+'</p><div class="ai-chips">'+(first?'<button type="button" data-ai-ask-q="'+E('Explícame por qué '+first+' está en el Radar AI hoy y qué riesgo tiene.')+'">Explícame '+E(first)+'</button>':'')+'<button type="button" data-ai-ask-q="Compara las ideas del Radar AI de hoy con mi cartera: ¿alguna encaja?">Compáralas con mi cartera</button></div></div>';
    return typeof window.ViewInvAIFold==='function'?window.ViewInvAIFold('radar-how','Cómo se eligen',how,html):html})()+'</section>'+
  '<section class="d-group"><header><h3>Ideas de hoy</h3><span>'+(isTr?'EUR':'USD')+'</span></header>'+
   '<div class="d-pills" role="group" aria-label="Filtrar por nivel">'+pill('all','Todas',counts.high+counts.opportunity+counts.watch)+pill('high','Alta',counts.high)+pill('opportunity','Oportunidad',counts.opportunity)+pill('watch','Vigilancia',counts.watch)+pill('spec','Especulativo',counts.spec)+'</div>'+
   list+'</section>'+
  radarAnalystsShellD(visible)+
  radarAiContrastPanel(rows,mode)+radarScoreboardHtml()+quantCardHtml()+
 '</div>';
}
// ----- Caídas bruscas: ¿rebote o trampa? -----
// Valores que caen un 25 % o más HOY sin venir ya de un desplome (el mes previo no caía más de un
// 25 %). El motivo sale de los eventos del valor de los últimos días: si es de fondo (ensayo
// fallido, rechazo FDA, ampliación/dilución, previsiones recortadas, riesgo legal o contable) suele
// seguir bajando; si es de interpretación (rebaja de analista, resultados por debajo de lo
// esperado, venta del sector o del mercado) es más frecuente el rebote. No es una recomendación.
const CRASH=window.ViewInvAIScore;
let crashEventsIdx=null;
function crashEventsFor(s){
 const n=(db.events||[]).length;
 if(!crashEventsIdx||crashEventsIdx.n!==n){
  const m=new Map(),cut=Date.now()-4*864e5;
  for(const e of db.events||[]){const t=new Date(e.date).getTime();if(!(t>=cut))continue;const st=stockForEvent(e);if(!st)continue;const k=stockKey(st);if(!m.has(k))m.set(k,[]);m.get(k).push(e)}
  crashEventsIdx={n,m};
 }
 return crashEventsIdx.m.get(stockKey(s))||[];
}
// Lecturas de catalizadores hechas por dos IAs en el servidor (/api/catalysts); 5 minutos en memoria.
const catal={byKey:new Map(),asked:new Map(),loading:false};
function loadCatalysts(keys){
 const now=Date.now(),want=[...new Set(keys.filter(Boolean))].filter(k=>!(catal.asked.get(k)>now-5*60000)).slice(0,40);
 if(!want.length||catal.loading)return;
 want.forEach(k=>catal.asked.set(k,now));catal.loading=true;
 fetch('/api/catalysts?keys='+encodeURIComponent(want.join(',')),{cache:'no-store'}).then(r=>r.ok?r.json():{items:[]}).catch(()=>({items:[]})).then(d=>{
  catal.loading=false;let changed=false;
  for(const k of want){const list=(d.items||[]).filter(x=>x.stockKey===k);if(list.length||catal.byKey.has(k)){catal.byKey.set(k,list);changed=true}}
  if(changed)window.dispatchEvent(new CustomEvent('viewinvai:catalysts-ready'));
 });
}
function catalystsFor(s){const k=stockKey(s);if(!catal.byKey.has(k))loadCatalysts([k]);return catal.byKey.get(k)||[]}
window.ViewInvAICatalysts={forStock:catalystsFor,load:loadCatalysts};
window.addEventListener('viewinvai:catalysts-ready',()=>{
 try{
  if(document.body.classList.contains('stock-detail-open')){if(typeof renderQuickProfile==='function'&&state.profileKey)renderQuickProfile()}
  else if(state.currentView==='crash')renderCrashView();
 }catch(_){}
});
const CAT_TRAP=new Set(['ampliacion','legal','ensayo','fda','prevision','deuda']),CAT_OVER=new Set(['analista','resultados','sector']);
const CAT_LABEL={resultados:'Resultados',prevision:'Previsiones',fda:'FDA',ensayo:'Ensayo clínico',ampliacion:'Ampliación de capital',deuda:'Deuda',fusion:'Fusión / adquisición',contrato:'Contrato',analista:'Analistas',legal:'Legal / regulatorio',directivos:'Directivos',recompra:'Recompra',dividendo:'Dividendo',sector:'Sector / mercado',otro:'Otro'};
function crashCause(s){
 // Primero la lectura contrastada por dos IAs (si coinciden y es relevante); si no, las reglas por palabras.
 const cut=new Date(Date.now()-4*864e5).toISOString().slice(0,10);
 const reads=catalystsFor(s).filter(r=>r.agree&&r.material&&r.day>=cut).sort((a,b)=>a.direction-b.direction);
 const r=reads[0];
 if(r){
  const label=(CAT_LABEL[r.kind]||'Noticia')+' · 2 IAs coinciden';
  if(r.direction<0&&(CAT_TRAP.has(r.kind)||r.business))return{kind:'trap',label,title:r.summary||r.title,ai:true};
  if(r.direction<0&&CAT_OVER.has(r.kind))return{kind:'over',label,title:r.summary||r.title,ai:true};
  if(r.direction>0)return{kind:'news',label:label+': buena noticia, pero cae: el mercado esperaba más',title:r.summary||r.title,ai:true};
 }
 return CRASH.crashCause(crashEventsFor(s),EL);
}
function crashCandidates(mode){
 const isTr=mode==='tr',se=currentMarketSession(),out=[];
 for(const s of db.stocks||[]){
  if(!s||!stockKey(s))continue;
  if(isTr?!trTradable(s):!/^(NASDAQ|NYSE|AMEX|NYSE ARCA|BATS)$/i.test(String(s.exchange||'')))continue;
  const hit=CRASH.crashEligible(isTr?trLiveChange(s):marketChange(s,se,false),s.perfMonth,s.marketCap);
  if(hit)out.push({s,ch:hit.change,prior:hit.prior});
 }
 const top=out.sort((a,b)=>a.ch-b.ch).slice(0,8);
 loadCatalysts(top.map(x=>stockKey(x.s)));
 return top.map(x=>{
  const cause=crashCause(x.s);
  let valuation=null;try{const v=typeof profileValuation==='function'?profileValuation(x.s):null;valuation=v&&v.tone||null}catch(_){}
  return{...x,cause,score:CRASH.crashScore({kind:cause.kind,valuation,marketCap:x.s.marketCap,netIncome:x.s.netIncomeTtm,change:x.ch,rsi:x.s.rsi,prior:x.prior})};
 });
}
function crashVerdict(c){
 if(c.cause.ai)return{tone:c.cause.kind==='trap'?'down':c.cause.kind==='over'?'up':'flat',text:(c.cause.kind==='trap'?'Motivo de fondo':c.cause.kind==='over'?'Posible sobrerreacción':'Noticia')+' ('+c.cause.label+'): '+c.cause.title};
 if(c.cause.kind==='trap')return{tone:'down',text:'Motivo de fondo: '+c.cause.label+'. Suele seguir bajando.'};
 if(c.cause.kind==='over')return{tone:'up',text:'Posible sobrerreacción: '+c.cause.label+'.'};
 if(c.cause.kind==='news')return{tone:'flat',text:'Noticia: '+c.cause.label+(/esperaba más/.test(c.cause.label)?'.':'. Revisa si cambia el negocio.')};
 if(c.prior!==null&&c.prior>50)return{tone:'flat',text:'Corrige tras subir '+F(c.prior,0)+' % en un mes: no es una sobrerreacción clara.'};
 return{tone:'flat',text:'Sin motivo publicado todavía: vigilar antes de entrar.'};
}
function radarCrashRowD(c,isTr){
 const s=c.s,q=canonicalQuote(s,isTr)||{},cur=isTr?'EUR':(q.nativeCurrency||'USD'),price=N(isTr?q.eur:(q.usd??q.price));
 const ticker=isTr?(s.trTicker||s.ticker):(s.ticker||s.trTicker),v=crashVerdict(c);
 const name=String(s.name||ticker||'—').replace(/,?\s+(Inc|Corp|Corporation|Ltd|plc|S\.?A|N\.?V|AG|SE)\.?$/i,'');
 const n=c.score;
 return '<li class="d-row d-crash d-crash-'+c.cause.kind+'"><button type="button" class="d-row-main" data-open-stock="'+E(stockKey(s))+'" data-stock-prefer-tr="'+(isTr?'1':'0')+'" title="'+E(c.cause.title||v.text)+'">'+
  '<em class="ai-score d-ring" data-band="'+(n>=65?'high':n>=45?'mid':'low')+'" data-p="'+Math.round(n/5)*5+'" title="Probabilidad orientativa de rebote '+n+'/100">'+n+'</em>'+
  '<span class="d-row-text"><b>'+E(name)+'</b><small>'+E([ticker,isTr?'LSX':(s.exchange||'EE. UU.'),c.prior!==null?'mes previo '+(c.prior>=0?'+':'')+F(c.prior,0)+' %':''].filter(Boolean).join(' · '))+'</small><i class="d-row-ai is-'+v.tone+'">'+(c.cause.kind==='trap'?'⚠ ':'✦ ')+E(v.text)+'</i>'+(()=>{const h=crashHistoryFor(c.ch);return h?'<i class="d-row-hist">Históricamente, caídas de '+E(h.key)+': rebotan a 5 sesiones el '+F(h.reboundRate,0)+' % (mediana '+radarPct(h.median,1)+', n='+Number(h.n).toLocaleString('es-ES')+')</i>':''})()+'</span>'+
  '<span class="d-row-num"><b>'+(price===null?'—':E(price.toLocaleString('es-ES',{style:'currency',currency:cur,minimumFractionDigits:2,maximumFractionDigits:price<1?4:2})))+'</b><span class="d-chip down">▼ '+F(Math.abs(c.ch),1)+' %</span></span></button></li>';
}
// Pestaña «Caídas» del Radar: mismo mercado (TR / EE. UU.) que el Radar AI.
function renderCrashView(){
 const box=document.getElementById('crashResults');if(!box)return;
 const mode=radarAiMarket==='us'?'us':'tr';
 const tab=(m,label)=>'<button type="button" class="tab'+(m===mode?' active':'')+'" data-crash-market="'+m+'" aria-pressed="'+(m===mode)+'">'+label+'</button>';
 box.innerHTML='<div class="radar-ai-shell d-radar d-crash-view">'+
  '<nav class="market-tabs compact-tabs radar-market-tabs" aria-label="Mercado">'+tab('tr','Trade Republic')+tab('us','EE. UU.')+'</nav>'+
  radarCrashSectionD(mode)+'</div>';
 requestAnimationFrame(()=>{try{observeActiveTrLivePrices();pollUsLive()}catch(_){}});
}
document.addEventListener('click',e=>{
 const m=e.target.closest&&e.target.closest('[data-crash-market]');
 if(!m)return;
 radarAiMarket=m.dataset.crashMarket==='us'?'us':'tr';try{localStorage.setItem('viewinvai:radar-market',radarAiMarket)}catch(_){}
 renderCrashView();
});
function radarCrashSectionD(mode){
 const isTr=mode==='tr',list=crashCandidates(mode);
 const over=list.filter(c=>c.cause.kind==='over').length,trap=list.filter(c=>c.cause.kind==='trap').length;
 const how='Caen un 25 % o más hoy sin venir ya de un desplome. Busco el motivo en sus noticias de los últimos días: si es de fondo (ensayo fallido, rechazo FDA, ampliación de capital, previsiones recortadas, riesgo legal) lo normal es que siga bajando; si es de interpretación (rebaja de un analista, resultados algo peores de lo esperado, venta del sector) el rebote es más frecuente. El número es una probabilidad orientativa de rebote, no una recomendación: espera a que deje de caer y usa stop.';
 const F2=window.ViewInvAIFold;
 const head=(typeof F2==='function'?F2('radar-crash-how','Cómo se leen',how,'<div class="d-reading"><p>'+E(how)+'</p><div class="ai-chips">'+(list[0]?'<button type="button" data-ai-ask-q="'+E('¿La caída de hoy de '+(list[0].s.ticker||list[0].s.name)+' es una sobrerreacción o tiene motivo de fondo? Dime qué vigilar antes de plantear un rebote.')+'">¿Rebote o trampa en '+E(list[0].s.ticker||'')+'?</button>':'')+'</div></div>'):'');
 const rest=list.length-over-trap,summary=list.length?[over?over+(over===1?' posible rebote':' posibles rebotes'):'',trap?trap+' con motivo de fondo':'',rest?rest+' por aclarar':''].filter(Boolean).join(' · '):'Ningún valor cae hoy un 25 % o más sin venir ya de un desplome.';
 return '<section class="d-pulse d-crash-pulse"><small>Caídas bruscas · '+(isTr?'Trade Republic / LSX':'EE. UU.')+'</small><h2>'+(list.length?list.length+(list.length===1?' caída de golpe':' caídas de golpe'):'Hoy ninguna')+'</h2><p class="d-hero-note">'+E(summary)+'</p>'+(()=>{const c=quant.report&&quant.report.crash,a=c&&c.all&&c.all['5d'];if(!a){loadQuant();return''}return '<p class="d-hero-note quant-note">✦ En '+Number(c.n).toLocaleString('es-ES')+' caídas así desde '+E(String(c.period&&c.period[0]||'').slice(0,4))+', a 5 sesiones rebotó el '+F(a.reboundRate,0)+' % (mediana '+radarPct(a.median,1)+'; la mitad central entre '+radarPct(a.p25,0)+' y '+radarPct(a.p75,0)+').</p>'})()+head+'</section>'+
  (list.length?'<section class="d-group d-crash-group"><header><h3>¿Rebote o trampa?</h3><span>'+(isTr?'EUR':'USD')+'</span></header>'+
  '<ul class="d-list">'+list.map(c=>radarCrashRowD(c,isTr)).join('')+'</ul></section>':'')+crashScoreboardHtml();
}
// Historial de caídas bruscas: el servidor guarda cada día las que entran (a las 15:45 de Nueva
// York, con el motivo clasificado en ese momento) y mide su rebote 1, 5 y 20 sesiones después.
let crashBoard={at:0,data:null,loading:false,failed:false};
async function loadCrashScoreboard(){
 if(crashBoard.loading||(crashBoard.data&&Date.now()-crashBoard.at<10*60000))return;
 crashBoard.loading=true;crashBoard.failed=false;
 try{
  const r=await fetch('/api/crash-scoreboard',{cache:'no-store'});
  if(!r.ok)throw Error(r.status);
  crashBoard={at:Date.now(),data:await r.json(),loading:false,failed:false};
 }catch(_){crashBoard.failed=true;crashBoard.at=Date.now()}
 finally{
  crashBoard.loading=false;
  document.querySelectorAll('[data-crash-scoreboard]').forEach(box=>{box.outerHTML=crashScoreboardHtml()});
 }
}
const CRASH_KIND_LABEL={over:'Posible sobrerreacción',trap:'Motivo de fondo',news:'Con noticia',none:'Sin motivo publicado'};
function crashScoreboardHtml(){
 const d=crashBoard.data;
 if(!d&&!crashBoard.loading&&(!crashBoard.failed||Date.now()-crashBoard.at>60000))setTimeout(loadCrashScoreboard,50);
 if(!d)return '<details class="radar-scoreboard crash-scoreboard" data-crash-scoreboard><summary><span><small>HISTORIAL DE CAÍDAS BRUSCAS</small><b>'+(crashBoard.failed?'Historial no disponible ahora mismo':'Cargando rebotes…')+'</b></span></summary></details>';
 const st=d.stats||{},o5=st.over&&st.over['5d'],t5=st.trap&&st.trap['5d'],a5=st.all&&st.all['5d'];
 let head;
 if(a5&&a5.n>0){
  head='<b>A 5 sesiones rebotan el '+F(a5.hitRate,0)+'% ('+radarPct(a5.avgReturn)+' de media)</b><em>'+
   'Sobrerreacción '+(o5&&o5.n?F(o5.hitRate,0)+'%':'—')+' · motivo de fondo '+(t5&&t5.n?F(t5.hitRate,0)+'%':'—')+'</em>';
 }else{
  const since=d.since?new Date(d.since+'T12:00:00Z').toLocaleDateString('es-ES',{day:'numeric',month:'short'}):null;
  head='<b>'+(since?'Acumulando historial desde '+E(since)+' · '+(d.signals||0)+' caídas':'El historial empieza con la próxima caída')+'</b><em>Primeras cifras: a 1 sesión al día siguiente, a 5 en una semana, a 20 en un mes.</em>';
 }
 const col=(x)=>x&&x.n?'<td><b>'+F(x.hitRate,0)+'%</b><span>'+radarPct(x.avgReturn)+'</span><i class="'+(x.avgExcess>0?'positive':x.avgExcess<0?'negative':'')+'">'+radarPct(x.avgExcess)+'</i><small>n='+x.n+'</small></td>':'<td class="empty">—</td>';
 const row=(label,key)=>'<tr><th>'+label+'</th>'+['1d','5d','20d'].map(h=>col(st[key]&&st[key][h])).join('')+'</tr>';
 const recent=(d.recent||[]).slice(0,12).map(r=>{
  const ret=r.ret5d??r.ret1d,tag=r.ret5d!==null&&r.ret5d!==undefined?radarPct(r.ret5d)+' 5s':r.ret1d!==null&&r.ret1d!==undefined?radarPct(r.ret1d)+' 1s':'en curso';
  return '<li data-open-stock="'+E(r.stockKey)+'" role="button" tabindex="0" title="'+E((CRASH_KIND_LABEL[r.kind]||'')+(r.label?' · '+r.label:''))+'"><span>'+E(new Date(r.day+'T12:00:00Z').toLocaleDateString('es-ES',{day:'2-digit',month:'short'}))+'</span><b>'+E(r.ticker)+' <em class="crash-kind-'+E(r.kind)+'">'+E(radarPct(r.change,0))+'</em><small>'+E(shortName(r.name))+'</small></b><i class="'+(ret>0?'positive':ret<0?'negative':'')+'">'+tag+'</i></li>';
 }).join('');
 return '<details class="radar-scoreboard crash-scoreboard" data-crash-scoreboard><summary><span><small>HISTORIAL DE CAÍDAS BRUSCAS · '+(d.days||0)+' SESIONES</small>'+head+'</span></summary>'+
  '<div class="radar-scoreboard-body">'+
   '<table><thead><tr><th></th><th>1 sesión</th><th>5 sesiones</th><th>20 sesiones</th></tr></thead><tbody>'+
    row('Posible sobrerreacción','over')+row('Con noticia','news')+row('Sin motivo publicado','none')+row('Motivo de fondo','trap')+row('Rebote ≥ 65','high')+row('Negociables en TR','trTradable')+row('Todas','all')+
   '</tbody></table>'+
   '<p class="radar-scoreboard-legend"><b>%</b> que rebotan (suben desde el precio de la señal) · rentabilidad media · <i>diferencia con el S&P 500</i> · n caídas.</p>'+
   (recent?'<ul class="radar-scoreboard-recent">'+recent+'</ul>':'')+
   '<p class="radar-scoreboard-method">'+E(d.method||'')+' Rentabilidades pasadas no garantizan resultados futuros.</p>'+
  '</div></details>';
}
// «Lo que dicen los analistas»: consenso y precio objetivo (Nasdaq) de las primeras ideas de EE. UU.
const radarAnalystsCache=new Map();
function radarAnalystSymbols(visible){
 const out=[];for(const r of visible){const s=r.s;if(/^(NASDAQ|NYSE|AMEX|NYSE ARCA|BATS)$/i.test(String(s.exchange||''))&&s.ticker&&!out.some(x=>x.sym===String(s.ticker).toUpperCase()))out.push({sym:String(s.ticker).toUpperCase(),s,preferTr:r.preferTr});if(out.length>=5)break}
 return out;
}
function radarAnalystsShellD(visible){
 const list=radarAnalystSymbols(visible);if(!list.length)return'';
 setTimeout(()=>hydrateRadarAnalysts(list),60);
 return '<section class="d-group" data-radar-analysts><header><h3>Lo que dicen los analistas</h3><span>Nasdaq</span></header><ul class="d-list">'+list.map(x=>'<li class="d-row" data-radar-analyst="'+E(x.sym)+'">'+radarAnalystRow(x,radarAnalystsCache.get(x.sym))+'</li>').join('')+'</ul></section>';
}
function radarAnalystRow(x,d){
 const name=String(x.s.name||x.sym).replace(/,?\s+(Inc|Corp|Corporation|Ltd|plc|S\.?A|N\.?V|AG|SE)\.?$/i,'');
 let right='<small>Cargando…</small>';
 if(d&&d.empty)right='<small>Sin cobertura</small>';
 else if(d&&d.target){
  const price=N(x.s.price),up=price&&N(d.target.mean)?(d.target.mean/price-1)*100:null,lab={buy:'Comprar',hold:'Mantener',sell:'Vender'}[d.consensus]||'—';
  right='<b>'+(N(d.target.mean)===null?'—':E(d.target.mean.toLocaleString('es-ES',{style:'currency',currency:'USD'})))+'</b>'+(up===null?'':'<span class="d-chip '+(up>=0?'up':'down')+'">'+(up>=0?'▲ ':'▼ ')+F(Math.abs(up),1)+' %</span>');
  return '<button type="button" class="d-row-main d-row-noring" data-open-stock="'+E(stockKey(x.s))+'" data-stock-prefer-tr="'+(x.preferTr?'1':'0')+'"><span class="d-row-text"><b>'+E(name)+'</b><small>'+E(x.sym)+' · '+(d.analysts||0)+' analistas</small><i class="d-row-ai">✦ Consenso: '+E(lab)+'</i></span><span class="d-row-num">'+right+'</span></button>';
 }
 return '<div class="d-row-main d-row-noring"><span class="d-row-text"><b>'+E(name)+'</b><small>'+E(x.sym)+'</small></span><span class="d-row-num">'+right+'</span></div>';
}
async function hydrateRadarAnalysts(list){
 await Promise.all(list.map(async x=>{
  if(!radarAnalystsCache.has(x.sym)){try{const r=await fetch('/api/analysts?symbol='+encodeURIComponent(x.sym));const d=await r.json();radarAnalystsCache.set(x.sym,r.ok?d:{empty:true})}catch(_){radarAnalystsCache.set(x.sym,{empty:true})}}
  const li=document.querySelector('[data-radar-analyst="'+x.sym+'"]');if(li)li.innerHTML=radarAnalystRow(x,radarAnalystsCache.get(x.sym));
 }));
}
function rerenderRadarAiList(){
 const box=$('#recommendationResults');if(!box)return;
 box.innerHTML=radarAiShell();
 requestAnimationFrame(()=>{observeActiveTrLivePrices();pollUsLive()});
}
document.addEventListener('click',e=>{
 const card=e.target.closest&&e.target.closest('[data-radar-open-key]');
 if(card&&card.closest('#recommendationResults')){
  const control=e.target.closest&&e.target.closest('button,a,input,select,textarea,summary,label,[data-radar-market],[data-radar-tier],[data-reco-mobile-group]');
  if(!control){
   const s=stockByKey(card.dataset.radarOpenKey);
   if(s){
    e.preventDefault();
    e.stopPropagation();
    openStock(s,'Radar AI',card.dataset.radarOpenTr==='1');
    return;
   }
  }
 }
 const m=e.target.closest&&e.target.closest('[data-radar-market]');
 if(m){radarAiMarket=m.dataset.radarMarket==='us'?'us':'tr';try{localStorage.setItem('viewinvai:radar-market',radarAiMarket)}catch(_){}rerenderRadarAiList();return}
 const t=e.target.closest&&e.target.closest('[data-radar-tier]');
 if(t){radarAiTierFilter=t.dataset.radarTier===radarAiTierFilter?'all':t.dataset.radarTier;rerenderRadarAiList()}
});
document.addEventListener('keydown',e=>{
 if(!['Enter',' '].includes(e.key))return;
 const card=e.target.closest&&e.target.closest('[data-radar-open-key]');
 if(!card||!card.closest('#recommendationResults'))return;
 const s=stockByKey(card.dataset.radarOpenKey);
 if(!s)return;
 e.preventDefault();
 e.stopPropagation();
 openStock(s,'Radar AI',card.dataset.radarOpenTr==='1');
});

function recommendationLoadingSection(mode){
 const isTr=mode==='tr';
 const title=isTr?'Trade Republic':'EEUU';
 const subtitle=isTr?'LSX · analizando mercado y ejecución':'NASDAQ / NYSE / AMEX · analizando mercado';
 return '<section class="pulse-market-group pulse-market-'+mode+' pulse-market-loading">'+
  '<header class="pulse-market-head"><div><strong>'+title+'</strong><span>'+subtitle+'</span></div></header>'+
  '<div class="pulse-market-list unified-asset-list">'+
   '<div class="pulse-loading-row"><div><strong>Analizando oportunidades…</strong><span>Validando precio, momentum, liquidez, técnico y catalizadores.</span></div><i aria-hidden="true"></i></div>'+
  '</div>'+
 '</section>';
}
function recommendationLoadingShell(){
 return '<div class="pulse-list-shell pulse-list-loading">'+
  recommendationMobileTabs()+
  recommendationLoadingSection('tr')+
  recommendationLoadingSection('us')+
 '</div>';
}

function recommendationCard(mode,s,group=null,pulseResult=null){
 if(!s)return '<div class="empty-state pulse-empty"><strong>Sin entrada de alta convicción ahora mismo</strong><span>ViewInvAI no fuerza una compra si no se alinean gráfico, tendencia, volumen, RSI/ADX, liquidez, catalizadores y calidad de datos.</span></div>';
 let preferTr=mode==='tr',bucket=recommendationBucket(mode),a=recommendationAnalysis(s,mode),quality=stockDataQuality(s,mode,false),wasArmed=!!bucket.armed;
 let ai=pulseResult&&pulseResult.aiValidated&&pulseResult.ai?pulseResult.ai:null;
 let signal=ai?{key:pulseResult.eligible?'buy':'watch',label:String(ai.signal||'VIGILAR'),text:ai.summary||ai.answer||'Evaluación híbrida completada.'}:recommendationSignal(a.score,bucket,quality.score);
 if(bucket.armed!==wasArmed)saveRecommendationState();
 let factors=a.parts.map(x=>'<div class="reco-factor"><div><span>'+E(x.label)+'</span><small>'+E(x.note||'')+'</small></div><b class="'+(x.delta>0?'positive':x.delta<0?'negative':'')+'">'+(x.delta>0?'+':'')+F(x.delta,1)+'</b></div>').join('');
 let events=a.catalyst.events.length?a.catalyst.events.map(x=>'<div class="reco-event"><strong>'+E(EL(x.e))+'</strong><span data-i18n-content>'+E(x.e.title||x.e.fact||'Catalizador')+'</span><small>'+E(eventWhen(x.e))+'</small></div>').join(''):'<p>Sin noticia o evento direccional fuerte en las últimas 72 h / próximos 14 días.</p>';
 let sold=signal.key==='sell'?'<button type="button" class="btn small reco-sold" data-reco-sold="'+mode+'">✓ He vendido · buscar siguiente</button>':'';
 let aiSummary=ai?'<div class="pulse-ai-result"><strong>Motor híbrido IA + cuantitativo</strong><p>'+E(ai.summary||ai.answer||'Evaluación completada.')+'</p><small>Confianza IA '+F(ai.confidence,0)+'/100 · score cuantitativo '+F(pulseResult&&pulseResult.score,1)+'/100</small></div>':'';
 let details=aiSummary+'<strong>'+E(signal.text)+'</strong><p>'+E(recommendationNarrative(a))+'</p>'+quoteFreshnessHtml(s,preferTr)+
  '<details class="reco-disclosure"><summary>Factores del análisis</summary><div class="reco-factors">'+factors+'</div></details>'+
  '<details class="reco-disclosure"><summary>Noticias y eventos</summary><div class="reco-events">'+events+'</div></details>'+
  '<p>Datos '+quality.score+'/100 · '+(ai?'Síntesis IA contrastada con reglas cuantitativas y calidad de datos.':'Evaluación cuantitativa de respaldo; la IA se activa con sesión iniciada.')+'</p>';
 let cells=group?group.columns.map(([key,label])=>({...recommendationMobileCell(key,s,mode,a,signal,quality),label})):undefined;
 if(group)cells=group.columns.map(([key,label],i)=>['price','change'].includes(key)?{...stockMobileCell(s,key,a.se,preferTr),label}:cells[i]);
 return standardStockCard(s,0,{se:a.se,preferTr,rankLabel:'',context:'recommendation',hint:'Recomendación actual',cells,
  subtitle:(preferTr?'TR / LSX':'EEUU')+' · '+signal.label+' · '+F(pulseResult&&N(pulseResult.score)!==null?pulseResult.score:a.score,1)+'/100',
  detailsHtml:details,detailsLabel:'Tesis IA · factores · noticias',detailsClass:'reco-mobile-detail',actionsHtml:sold});
}
async function renderRecommendation(force=false){
 let box=$('#recommendationResults');if(!box)return;
 if(state.currentView==='recommendation')seedTradeRepublicMarketBoard(120);
 box.innerHTML=radarAiShell(force?{}:radarAiLastAdvanced);
 let stamp=$('#recommendationUpdated');
 if(stamp)stamp.textContent='Radar actualizado '+new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'})+' · validando alta convicción…';
 requestAnimationFrame(()=>{observeActiveTrLivePrices();pollUsLive()});
 if(recommendationRenderPromise&&!force)return recommendationRenderPromise;
 recommendationRenderPromise=(async()=>{
  const results=await Promise.race([
   Promise.all([highConvictionRecommendation('tr'),highConvictionRecommendation('us')]),
   new Promise(resolve=>setTimeout(()=>resolve([null,null]),12000))
  ]);
  const tr=results&&results[0],us=results&&results[1];
  if($('#recommendationResults'))$('#recommendationResults').innerHTML=radarAiShell({tr,us});
  if(stamp)stamp.textContent='Radar actualizado '+new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  requestAnimationFrame(()=>{observeActiveTrLivePrices();pollUsLive()});
 })().catch(error=>console.warn('Radar AI advanced validation failed',error)).finally(()=>{recommendationRenderPromise=null});
 return recommendationRenderPromise;
}
function warmRecommendationCache(){
 if(!db.stocks.length||document.hidden)return;
 // Do not build the full Radar while another view is active. The expensive
 // analysis is demand-driven when Radar AI is actually opened.
 if(state.currentView!=='recommendation')return;
 highConvictionRuntimeCache.clear();
 renderRecommendation(false).catch(()=>{});
}
window.addEventListener('viewinvai:account-ready',()=>setTimeout(warmRecommendationCache,700));

document.addEventListener('click',event=>{
 const register=event.target&&event.target.closest?event.target.closest('[data-radar-register]'):null;
 if(register){
  event.preventDefault();event.stopPropagation();
  const key=register.dataset.radarRegister,preferTr=register.dataset.radarPreferTr==='1',price=N(register.dataset.radarPrice);
  if(window.ViewInvAIPortfolios&&typeof window.ViewInvAIPortfolios.openAddPosition==='function'){
   window.ViewInvAIPortfolios.openAddPosition(key,preferTr,null,null,{price:price});
  }
  return;
 }
 const button=event.target&&event.target.closest?event.target.closest('[data-reco-mobile-group]'):null;
 if(!button)return;
 setRecommendationMobileGroup(button.dataset.recoMobileGroup||'general');
});

function markRecommendationSold(mode){
 if(!['us','tr'].includes(mode))return;
 let bucket=recommendationBucket(mode),key=bucket.key;if(!key)return;
 recommendationState.sold[mode][key]=Date.now();
 bucket.key=null;bucket.selectedAt=0;bucket.armed=false;
 saveRecommendationState();
 recommendationRenderCache={html:'',updatedAt:0,snapshot:''};
 highConvictionRuntimeCache.clear();
 renderRecommendation(true);
}

function pulseCoachAnalysis(stock,preferTr=false){
 const mode=preferTr?'tr':'us';if(!stock||!recommendationEligible(stock,mode))return null;
 const a=recommendationAnalysis(stock,mode),q=stockDataQuality(stock,mode,false),signal=window.ViewInvAIScore&&typeof window.ViewInvAIScore.positionSignal==='function'?window.ViewInvAIScore.positionSignal(a.score,q.score):(a.score<=35?'SELL':a.score<50?'REVIEW':'HOLD');
 return{stock,preferTr,mode,score:N(a.score)??0,quality:N(q.score)??0,signal,analysis:a};
}
function pulseCoachCandidates(limit=10,excluded=[],marketMode='us',minScore=55){
 const skip=new Set((excluded||[]).map(x=>String(x||'').toUpperCase())),preferTr=marketMode==='tr';
 let rows=(db.stocks||[]).map(stock=>{
  const key=stockKey(stock);if(!key||skip.has(String(key).toUpperCase()))return null;
  if(preferTr&&!trTradable(stock))return null;
  if(!preferTr&&!market(stock,'us'))return null;
  const useTr=preferTr&&trLivePrice(stock)!==null;
  const mode=useTr?'tr':'us',a=recommendationAnalysis(stock,mode),q=stockDataQuality(stock,mode,false);
  const signal=window.ViewInvAIScore&&typeof window.ViewInvAIScore.positionSignal==='function'?window.ViewInvAIScore.positionSignal(a.score,q.score):(a.score<=35?'SELL':a.score<50?'REVIEW':'HOLD');
  return{stock,preferTr,mode:preferTr?'tr':'us',score:N(a.score)??0,quality:N(q.score)??0,signal,analysis:a,provisionalVenue:preferTr&&!useTr};
 }).filter(Boolean).filter(row=>row.quality>=45&&row.score>=Math.max(0,N(minScore)??55)&&row.signal!=='SELL')
   .sort((a,b)=>b.score-a.score||b.quality-a.quality).slice(0,Math.max(1,Math.min(60,Number(limit)||10)));
 if(preferTr&&typeof ensureTrLiveKey==='function')rows.forEach(row=>ensureTrLiveKey(stockKey(row.stock)));
 return rows;
}
window.ViewInvAIPulseCoach={analyzeStock:pulseCoachAnalysis,rankCandidates:pulseCoachCandidates};
