(function(root){
  'use strict';

  const VERSION='2026.09.25-v1';

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
    else if(ch<=12)add('Momentum',5+Math.min(9,ch*.75),'Impulso '+ch.toFixed(2)+'% sin sobreextensión severa');
    else if(ch<=25)add('Momentum',Math.max(6,10-(ch-12)*.15),'Impulso fuerte '+ch.toFixed(2)+'%');
    else add('Momentum',Math.max(-12,8-(ch-25)*.45),'Subida '+ch.toFixed(2)+'%; se penaliza perseguir extensiones extremas');

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

    if(vol!==null&&vol<10000)add('Liquidez',-14,'Volumen muy bajo');
    else if(vol!==null&&vol<50000)add('Liquidez',-7,'Volumen bajo');
    else if(vol!==null&&vol>=500000)add('Liquidez',4,'Volumen alto');
    else if(vol!==null&&vol>=100000)add('Liquidez',2,'Volumen suficiente');
    else add('Liquidez',0,vol===null?'Volumen no disponible':'Volumen disponible');

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

  root.ViewInvAIScore=Object.freeze({
    VERSION,technical,catalyst,quality,analyze,watchSignal,positionSignal
  });
})(globalThis);
