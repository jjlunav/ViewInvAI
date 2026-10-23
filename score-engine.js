(function(root){
  'use strict';

  const VERSION='2026.10.24-v3';

  function n(value){
    if(value===null||value===undefined||value==='')return null;
    const x=Number(value);
    return Number.isFinite(x)?x:null;
  }
  function clamp(value,min,max){
    return Math.max(min,Math.min(max,value));
  }
  function round1(value){
    return Math.round(Number(value||0)*10)/10;
  }

  function technical(input={}){
    let score=50;
    const factors=[];
    const add=(label,delta,note)=>{
      delta=round1(delta);
      score+=delta;
      factors.push({label,delta,note:String(note||'')});
    };

    const ch=n(input.change),rv=n(input.relVolume),adx=n(input.adx),rsi=n(input.rsi);
    const p=n(input.price),ema20=n(input.ema20),ema50=n(input.ema50);
    const week=n(input.perfWeek),month=n(input.perfMonth),vol=n(input.volume),sp=n(input.spread);

    if(ch===null)add('Momentum',-5,'Variación actual no disponible');
    else if(ch<0)add('Momentum',Math.max(-18,ch*1.2),'Movimiento '+ch.toFixed(2)+'%');
    // Calibrado con 10 años de históricos (2023-2026 fuera de muestra): a partir de un +8 % en el día,
    // batir al S&P 500 en 5 sesiones es menos probable (15-30 %: 43 % de las veces, mediana -1,9 %).
    else if(ch<=8)add('Momentum',5+Math.min(9,ch*.75),'Impulso '+ch.toFixed(2)+'% sin sobreextensión');
    else if(ch<=15)add('Momentum',11-(ch-8)*.7,'Impulso fuerte '+ch.toFixed(2)+'%: históricamente ya no suma');
    else if(ch<=30)add('Momentum',6-(ch-15)*.6,'Subida '+ch.toFixed(2)+'%: perseguirla bate al S&P solo el 43 % de las veces');
    else add('Momentum',Math.max(-12,-3-(ch-30)*.3),'Subida '+ch.toFixed(2)+'%: mediana histórica a 5 sesiones negativa');

    if(rv===null)add('Volumen relativo',-2,'Sin volumen relativo comparable');
    else if(rv>=3)add('Volumen relativo',12,'Actividad '+rv.toFixed(2)+'x la media');
    else if(rv>=1.5)add('Volumen relativo',8,'Actividad '+rv.toFixed(2)+'x la media');
    else if(rv>=1)add('Volumen relativo',3,'Volumen en línea con la media');
    else if(rv<.5)add('Volumen relativo',-6,'Volumen débil '+rv.toFixed(2)+'x');
    else add('Volumen relativo',-1,'Volumen por debajo de la media');

    if(adx===null)add('ADX',-1,'ADX no disponible');
    else if(adx>=30)add('ADX',7,'Tendencia fuerte · ADX '+adx.toFixed(1));
    else if(adx>=20)add('ADX',4,'Tendencia utilizable · ADX '+adx.toFixed(1));
    else if(adx<15)add('ADX',-4,'Tendencia poco definida · ADX '+adx.toFixed(1));
    else add('ADX',0,'ADX '+adx.toFixed(1));

    if(rsi===null)add('RSI',-1,'RSI no disponible');
    else if(rsi>=45&&rsi<=68)add('RSI',8,'Momentum sano · RSI '+rsi.toFixed(1));
    else if((rsi>=38&&rsi<45)||(rsi>68&&rsi<=75))add('RSI',3,'RSI '+rsi.toFixed(1));
    else if(rsi>82)add('RSI',-10,'Sobreextensión · RSI '+rsi.toFixed(1));
    else if(rsi<30)add('RSI',-9,'Debilidad extrema · RSI '+rsi.toFixed(1));
    else add('RSI',-2,'RSI '+rsi.toFixed(1));

    if(p!==null&&ema20!==null&&ema50!==null){
      if(p>=ema20&&ema20>=ema50)add('Tendencia',12,'Precio > EMA20 > EMA50');
      else if(p>=ema20)add('Tendencia',4,'Precio sobre EMA20, estructura larga incompleta');
      else if(p<ema20&&ema20<ema50)add('Tendencia',-10,'Precio bajo EMA20 y EMA20 < EMA50');
      else add('Tendencia',-5,'Precio bajo EMA20');
    }else add('Tendencia',-2,'EMAs insuficientes');

    let perf=0;
    const perfNote=[];
    if(week!==null){perf+=clamp(week*.18,-5,5);perfNote.push('1s '+week.toFixed(2)+'%')}
    if(month!==null){perf+=clamp(month*.08,-5,5);perfNote.push('1m '+month.toFixed(2)+'%')}
    add('Rendimiento',perf,perfNote.join(' · ')||'Sin histórico de rendimiento');

    // Liquidez en dinero negociado al día (acciones × precio), no en número de acciones:
    // un millón de acciones de 0,04 € son 40.000 € y no dan para entrar y salir con soltura.
    const avgVol=n(input.avgVolume),baseVol=avgVol!==null?avgVol:vol;
    const traded=p!==null&&baseVol!==null?p*baseVol:null,fmtM=v=>v>=1e6?(v/1e6).toFixed(1)+' M/día':Math.round(v/1e3)+' mil/día';
    if(traded!==null){
      if(traded<200000)add('Liquidez',-14,'Liquidez muy baja · '+fmtM(traded));
      else if(traded<1e6)add('Liquidez',-7,'Liquidez baja · '+fmtM(traded));
      else if(traded>=20e6)add('Liquidez',4,'Liquidez alta · '+fmtM(traded));
      else if(traded>=5e6)add('Liquidez',2,'Liquidez suficiente · '+fmtM(traded));
      else add('Liquidez',0,'Liquidez justa · '+fmtM(traded));
    }else if(vol!==null&&vol<10000)add('Liquidez',-14,'Volumen muy bajo');
    else if(vol!==null&&vol<50000)add('Liquidez',-7,'Volumen bajo');
    else add('Liquidez',0,vol===null?'Volumen no disponible':'Volumen disponible');

    // Subidas que ya se han producido: perseguirlas tiene peor relación riesgo/beneficio.
    if(month!==null&&month>40)add('Sobreextensión',-Math.min(14,4+(month-40)*.2),'Ya sube '+month.toFixed(0)+'% en un mes');
    else if(week!==null&&week>25)add('Sobreextensión',-Math.min(10,3+(week-25)*.25),'Ya sube '+week.toFixed(0)+'% en una semana');

    if(sp!==null){
      if(sp>8)add('Spread',-16,'Spread '+sp.toFixed(2)+'%');
      else if(sp>4)add('Spread',-7,'Spread amplio '+sp.toFixed(2)+'%');
      else if(sp<=1.5)add('Spread',3,'Spread contenido '+sp.toFixed(2)+'%');
      else add('Spread',0,'Spread '+sp.toFixed(2)+'%');
    }

    return {
      score:round1(clamp(score,0,100)),
      factors,
      change:ch,relVolume:rv,adx,rsi,spread:sp
    };
  }

  function catalyst(events=[],nowMs=Date.now()){
    let delta=0;
    const relevant=[];
    const positive=/\b(approval|approved|authorization|clearance|contract|award|wins?|partnership|strategic agreement|beats?|raises? guidance|positive|topline|met (?:the )?(?:primary )?endpoint|acquisition|buyout|order|milestone payment)\b/i;
    const negative=/\b(offering|dilution|dilutive|reverse split|delist|bankrupt|chapter 11|misses?|lowers? guidance|cuts? guidance|clinical hold|failed|fails|investigation|subpoena|lawsuit|going concern|termination|withdraws?)\b/i;

    for(const event of Array.isArray(events)?events:[]){
      const time=new Date(event&&event.date||0).getTime();
      if(!Number.isFinite(time))continue;
      const isNews=event&&event.eventKind==='news';
      if(isNews&&(time<nowMs-72*3600000||time>nowMs+2*3600000))continue;
      if(!isNews&&(time<nowMs-6*3600000||time>nowMs+14*86400000))continue;

      const text=String((event&&event.title||'')+' '+(event&&event.fact||'')).toLowerCase();
      const impact=clamp(n(event&&event.impactScore)??50,0,100);
      const fdaKind=String(event&&event.fdaStatusKind||'');
      let d=0;
      if(fdaKind){
        if(fdaKind==='approved')d+=10+impact*.05;
        else if(fdaKind==='tentative_approval'||fdaKind==='approvable')d+=4+impact*.025;
        else if(['complete_response','not_approvable','withdrawn'].includes(fdaKind))d-=10+impact*.055;
      }else{
        if(positive.test(text))d+=6+impact*.05;
        if(negative.test(text))d-=7+impact*.06;
      }
      if(event&&event.type==='financing')d-=6;
      if(event&&event.type==='regulatory'&&!positive.test(text)&&!fdaKind)d-=3;
      if(/reverse split|delist|bankrupt|chapter 11/.test(text))d-=7;
      if(event&&event.type==='medical'&&positive.test(text)&&!fdaKind)d+=4;
      if(!isNews&&d===0)d+=Math.min(2.5,impact/40);
      delta+=d;
      relevant.push({event,delta:round1(d),impact,time});
    }

    relevant.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)||b.impact-a.impact||b.time-a.time);
    return {delta:round1(clamp(delta,-18,18)),events:relevant.slice(0,3)};
  }

  function quality(input={}){
    let score=0;
    const missing=[];
    const present=(value,label,points)=>{
      if(n(value)!==null){score+=points;return true}
      missing.push(label);return false;
    };

    present(input.price,'precio',12);
    present(input.change,'variación',10);
    present(input.volume,'volumen',8);

    const avg=present(input.avgVolume,'volumen medio',5);
    const rv=present(input.relVolume,'volumen relativo',5);
    if(!avg&&!rv)missing.push('actividad comparable');

    present(input.rsi,'RSI',6);
    present(input.adx,'ADX',6);
    present(input.ema20,'EMA20',6);
    present(input.ema50,'EMA50',6);

    const bid=present(input.bid,'bid',5);
    const ask=present(input.ask,'ask',5);
    if(!(bid&&ask))missing.push('spread');

    const quoteAge=n(input.quoteAgeMs);
    if(quoteAge!==null){
      if(quoteAge<=15000)score+=12;
      else if(quoteAge<=60000)score+=10;
      else if(quoteAge<=300000)score+=6;
      else score+=2;
    }else if(n(input.price)!==null)score+=3;

    const snapshotAge=n(input.snapshotAgeMs);
    if(snapshotAge!==null){
      if(snapshotAge<=10*60000)score+=8;
      else if(snapshotAge<=30*60000)score+=6;
      else if(snapshotAge<=2*3600000)score+=3;
    }

    if(input.chartAvailable===true)score+=4;
    if((n(input.eventsCount)??0)>0)score+=2;

    return {
      score:Math.round(clamp(score,0,100)),
      level:score>=85?'high':score>=70?'good':score>=55?'medium':'low',
      missing:[...new Set(missing)].slice(0,6)
    };
  }

  function analyze(input={},events=[],nowMs=Date.now()){
    const tech=technical(input);
    const cat=catalyst(events,nowMs);
    const q=quality(Object.assign({},input,{eventsCount:Array.isArray(events)?events.length:0}));
    const score=round1(clamp(tech.score+cat.delta,0,100));
    return {
      version:VERSION,
      score,
      baseScore:tech.score,
      catalystDelta:cat.delta,
      factors:tech.factors,
      catalyst:cat,
      quality:q,
      change:tech.change,
      relVolume:tech.relVolume,
      adx:tech.adx,
      rsi:tech.rsi,
      spread:tech.spread
    };
  }

  // «Especulativo»: valores donde una señal de momentum es poco fiable o muy arriesgada.
  // Same rule on screen and on the server (Radar AI scoreboard).
  function speculative(input={}){
    const reasons=[];
    const price=n(input.price),cap=n(input.marketCap),avgVol=n(input.avgVolume);
    if(price!==null&&price<1)reasons.push('precio < 1 $');
    if(cap!==null&&cap<300e6)reasons.push('capitalización < 300 M$');
    if(price!==null&&avgVol!==null&&price*avgVol<2e6)reasons.push('liquidez < 2 M$/día');
    const nowMs=n(input.nowMs)??Date.now();
    for(const e of Array.isArray(input.events)?input.events:[]){
      const t=Date.parse(e&&e.date);
      if(!Number.isFinite(t)||nowMs-t>30*864e5||t-nowMs>864e5)continue;
      const text=String((e&&(e.title||e.fact))||'').toLowerCase();
      if(/reverse split|contrasplit/.test(text)){reasons.push('contrasplit reciente');break}
      if(e.type==='financing'||/offering|registered direct|private placement|ampliación/.test(text)){reasons.push('ampliación / dilución reciente');break}
    }
    return{speculative:reasons.length>0,reasons};
  }

  // Niveles del Radar AI (pantalla, marcador y avisos usan esta misma regla).
  // Filtro de entrada: precio ≥ 1, capitalización ≥ 300 M, ≥ 2 M/día negociados (1 M/día en Trade
  // Republic) y sin contrasplit ni ampliación reciente. Quien no lo pasa solo puede salir como
  // «especulativo» si su señal es muy fuerte.
  const RADAR_LEVELS={opportunity:{score:72,quality:60},watch:{score:62,quality:55},spec:{score:74,quality:55}};
  function radarTier(input={}){
    const score=n(input.score)??0,q=n(input.quality)??0;
    const price=n(input.price),cap=n(input.marketCap),avgVol=n(input.avgVolume);
    const minTraded=input.market==='tr'?1e6:2e6,traded=price!==null&&avgVol!==null?price*avgVol:null;
    const reasons=[];
    if(price!==null&&price<1)reasons.push('precio < 1');
    if(cap!==null&&cap<300e6)reasons.push('capitalización < 300 M');
    if(traded!==null&&traded<minTraded)reasons.push('liquidez < '+(minTraded/1e6)+' M/día');
    if(traded===null)reasons.push('sin datos de liquidez');
    const ev=speculative({events:input.events,nowMs:input.nowMs}).reasons;
    reasons.push(...ev);
    const eligible=reasons.length===0;
    let tier='';
    if(eligible){
      if(score>=RADAR_LEVELS.opportunity.score&&q>=RADAR_LEVELS.opportunity.quality)tier='opportunity';
      else if(score>=RADAR_LEVELS.watch.score&&q>=RADAR_LEVELS.watch.quality)tier='watch';
    }else if(score>=RADAR_LEVELS.spec.score&&q>=RADAR_LEVELS.spec.quality)tier='spec';
    return{tier,eligible,reasons};
  }

  function watchSignal(score,qualityScore){
    const s=n(score)??0,q=n(qualityScore)??0;
    if(q<55)return 'WAIT';
    if(s>=72)return 'BUY';
    if(s>=60)return 'WATCH';
    if(s<35)return 'AVOID';
    return 'WAIT';
  }

  function positionSignal(score,qualityScore){
    const s=n(score)??0,q=n(qualityScore)??0;
    if(q<50)return 'REVIEW';
    if(s<=35)return 'SELL';
    if(s<50)return 'REVIEW';
    return 'HOLD';
  }

  // ----- Caídas bruscas: ¿rebote o trampa? (mismas reglas en la pantalla y en el historial) -----
  // Un valor entra si cae un 25 % o más HOY sin venir ya de un desplome (el mes previo no caía más
  // de un 25 %). El motivo sale de sus eventos de los últimos días: de fondo («trap») o de
  // interpretación («over»). La puntuación es una probabilidad orientativa de rebote, no una orden.
  const CRASH_MIN=-25;
  const CRASH_TRAPS=[
    [/\bdid not (meet|achieve)\b|\bfail(s|ed|ure)?\b|\bmissed (its |the )?primary\b|\bdiscontinu|\bterminat(e|ed|es) (the )?(trial|study|program)\b|\bfutility\b/i,'Ensayo o programa fallido'],
    [/\bcomplete response letter\b|\bcrl\b|\brefus(e|al) to file\b|\bfda (rejects|declines)\b|\bnot approv/i,'Rechazo de la FDA'],
    [/\boffering\b|\bdilut|\bregistered direct\b|\bprivate placement\b|\bat-the-market\b|\batm\b|\bprospectus\b|\b424B\d\b|\bconvertible (notes|debentures|preferred)\b/i,'Ampliación de capital / dilución'],
    [/\bgoing concern\b|\bbankrupt|\bchapter 11\b|\binsolven|\bin default\b|\bdefaulted\b|\bdelist/i,'Riesgo de quiebra o exclusión'],
    [/\bfraud|\binvestigation\b|\bsubpoena|\brestat(e|es|ed|ement)\b|\bsec charges\b|\bclass action\b|\baccounting (irregularit|issue|error)/i,'Riesgo legal o contable'],
    [/(cuts?|lowers?|slashes?|withdraws?|suspends?) (its |full[- ]year |annual )?(guidance|outlook|forecast)|guidance cut|profit warning/i,'Previsiones recortadas'],
    [/reverse (stock )?split/i,'Contrasplit']
  ];
  const CRASH_OVERS=[
    [/\bdowngrade|\bcut to (sell|neutral|hold|underperform)\b|\blowers? (its )?price target\b/i,'Rebaja de un analista'],
    [/\bmiss(es|ed)? (estimates|expectations|consensus)\b|\bbelow (estimates|expectations|consensus)\b|\bdisappoint/i,'Resultados por debajo de lo esperado'],
    [/\bshort (seller|report)\b|\bhindenburg\b|\bmuddy waters\b/i,'Informe bajista (por contrastar)'],
    [/\bsector[- ]wide\b|\bpeers\b|\bsell-?off\b|\bmarket rout\b|\btariffs?\b|\binterest rates\b/i,'Venta del sector o del mercado']
  ];
  // ¿Entra hoy? change = variación de hoy (%), perfMonth = variación a un mes incluida la de hoy.
  function crashEligible(change,perfMonth,marketCap){
    const ch=n(change);if(ch===null||ch>CRASH_MIN||ch<-95)return null;
    const cap=n(marketCap);if(cap!==null&&cap<20e6)return null;          // fuera chicharros minúsculos
    const pm=n(perfMonth),prior=pm===null?null:((1+pm/100)/(1+ch/100)-1)*100;
    if(prior!==null&&prior<-25)return null;                               // ya venía desplomándose
    return{change:ch,prior};
  }
  function crashCause(events,label){
    const evs=Array.isArray(events)?events:[];
    const T=e=>String(e&&(e.title||e.fact)||'');
    const L=typeof label==='function'?label:(e=>String(e&&(e.label||e.type)||'Noticia'));
    for(const e of evs){const t=T(e);for(const [re,lb] of CRASH_TRAPS)if(re.test(t)||(lb.startsWith('Ampliación')&&e.type==='financing'))return{kind:'trap',label:lb,title:t}}
    for(const e of evs){const t=T(e);for(const [re,lb] of CRASH_OVERS)if(re.test(t)||(lb.startsWith('Rebaja')&&e.type==='analyst'))return{kind:'over',label:lb,title:t}}
    for(const e of evs){const t=T(e);if(/\b(positive|beats?|approv(al|ed)|record|raises?)\b/i.test(t))return{kind:'news',label:L(e)+' con buena noticia, pero cae: el mercado esperaba más',title:t}}
    if(evs.length){const e=evs[0];return{kind:'news',label:L(e),title:T(e)}}
    return{kind:'none',label:'Sin motivo publicado todavía',title:''};
  }
  function crashScore(input={}){
    const kind=input.kind;
    let score=50+(kind==='over'?22:kind==='trap'?-35:kind==='news'?0:-5);
    if(input.valuation==='high')score+=10;else if(input.valuation==='low')score-=5;
    const cap=n(input.marketCap),ni=n(input.netIncome),ch=n(input.change),rsi=n(input.rsi),prior=n(input.prior);
    if(cap!==null&&cap<300e6&&ni!==null&&ni<0)score-=10;                 // pequeña y con pérdidas
    if(ch!==null&&ch<-60)score-=5;
    // 2.692 caídas desde 2017: con RSI < 25 rebota el 50 % a 5 sesiones (+0,8 % sobre el S&P);
    // si venía de subir más de un 50 % en el mes, solo el 39 % (mediana -5,8 %).
    if(rsi!==null&&rsi<25)score+=8;
    if(prior!==null&&prior>50)score-=12;                                   // corrección tras una subida fuerte
    return Math.round(clamp(score,5,95));
  }

  // ----- Modelo cuantitativo entrenado con ~10 años de históricos (data/quant-model.json) -----
  // Aditivo por tramos: cada factor cae en un tramo y suma su peso; la suma pasa por la logística.
  // Devuelve la probabilidad de batir al S&P 500 en 5 sesiones y lo que aporta cada factor.
  const QUANT_LABELS={change:'Variación de hoy',relVolume:'Volumen relativo',rsi:'RSI',adx:'Fuerza de tendencia (ADX)',dist20:'Distancia a la EMA20',dist50:'Distancia a la EMA50',trend:'EMA20 frente a EMA50',perfWeek:'Rendimiento semanal',perfMonth:'Rendimiento mensual',traded:'Liquidez',fromHigh:'Distancia al máximo de 52 s',fromLow:'Distancia al mínimo de 52 s',atrPct:'Volatilidad (ATR)'};
  function quantFeatures(s={}){
    const p=n(s.price),e20=n(s.ema20),e50=n(s.ema50),rv=n(s.relVolume),av=n(s.avgVolume),hi=n(s.high52w),lo=n(s.low52w),atr=n(s.atr);
    const pct=(a,b)=>a!==null&&b!==null&&b>0?(a/b-1)*100:null;
    return{change:n(s.changePct!==undefined?s.changePct:s.change),relVolume:rv!==null&&rv>0?Math.log(Math.max(rv,.01)):null,rsi:n(s.rsi),adx:n(s.adx),
      dist20:pct(p,e20),dist50:pct(p,e50),trend:pct(e20,e50),perfWeek:n(s.perfWeek),perfMonth:n(s.perfMonth),
      traded:p!==null&&av!==null&&p*av>0?Math.log10(p*av):null,fromHigh:pct(p,hi),fromLow:pct(p,lo),atrPct:p&&atr!==null?atr/p*100:null};
  }
  function quantScore(model,s){
    if(!model||!Array.isArray(model.features))return null;
    const f=quantFeatures(s);let z=n(model.intercept)??0,used=0;const parts=[];
    for(const ft of model.features){
      const v=f[ft.name];if(v===null||v===undefined||!Number.isFinite(v))continue;
      let i=0;while(i<ft.edges.length&&v>=ft.edges[i])i++;
      const w=n(ft.weights[i])??0;z+=w;used++;parts.push({name:ft.name,label:QUANT_LABELS[ft.name]||ft.name,delta:w});
    }
    if(used<model.features.length-3)return null;           // faltan demasiados datos: no se estima
    const prob=1/(1+Math.exp(-z));
    parts.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));
    return{prob,base:n(model.baseRate),parts,used};
  }

  root.ViewInvAIScore=Object.freeze({
    VERSION,technical,catalyst,quality,analyze,watchSignal,positionSignal,speculative,radarTier,RADAR_LEVELS,
    CRASH_MIN,crashEligible,crashCause,crashScore,quantScore,quantFeatures
  });
})(globalThis);
