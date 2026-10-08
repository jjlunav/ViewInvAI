// Motor del Objetivo de la cartera: el mismo código en la app y en el servidor.
// Objetivo «rápido»: crecer lo antes posible asumiendo riesgo, pero sin locuras:
// · compra al momento si la acción supera el filtro (sin esperar al día siguiente);
// · recomienda 1 entrada principal y, como máximo, una segunda de calidad casi equivalente;
// · stop según la volatilidad de cada acción y stop que sube cuando gana (trailing);
// · no se vende en pérdidas para cambiar de acción salvo que la nueva prevea recuperar
//   esa pérdida y todas las comisiones con margen;
// · modo defensivo si la cartera cae un 15 % desde su máximo;
// · el ritmo hacia la fecha objetivo ajusta un poco la exigencia, sin salir del perfil.
(function(root){
  'use strict';

  const VERSION='2026.10.07-g5-spec-modes';
  const RISK={
    conservative:{label:'Bajo',minScore:74,minQuality:65,minBurst:78,maxWeight:30,riskPerTradePct:1,maxRoundTripFeePct:1,maxSpreadPct:2,maxExtensionPct:4,maxDayChangePct:6,maxWeekPerfPct:10,minTiming:78,stopK:2,rr:2.2,minHoldDays:2,stagnantDays:6,maxHoldDays:10},
    balanced:{label:'Medio',minScore:70,minQuality:60,minBurst:74,maxWeight:35,riskPerTradePct:1.5,maxRoundTripFeePct:1.5,maxSpreadPct:3,maxExtensionPct:5.5,maxDayChangePct:8,maxWeekPerfPct:15,minTiming:72,stopK:2.2,rr:2,minHoldDays:1.5,stagnantDays:5,maxHoldDays:8},
    aggressive:{label:'Alto',minScore:66,minQuality:55,minBurst:70,maxWeight:40,riskPerTradePct:2.5,maxRoundTripFeePct:2,maxSpreadPct:5,maxExtensionPct:7,maxDayChangePct:10,maxWeekPerfPct:20,minTiming:68,stopK:2.5,rr:1.8,minHoldDays:1,stagnantDays:4,maxHoldDays:6}
  };
  const STOP_MIN=6,STOP_MAX=12,ROTATION_MARGIN=1.25,DEFENSIVE_IN=15,DEFENSIVE_OUT=7.5;
  const SPEC_POLICY={
    0:{maxCount:0,maxWeight:0,maxTotalWeight:0,minBurstExtra:99,minQualityExtra:99,maxSpread:null,edgeOverNormal:99},
    1:{maxCount:1,maxWeight:10,maxTotalWeight:10,minBurstExtra:4,minQualityExtra:3,maxSpread:4,edgeOverNormal:2},
    2:{maxCount:2,maxWeight:10,maxTotalWeight:20,minBurstExtra:7,minQualityExtra:5,maxSpread:3,edgeOverNormal:3},
    3:{maxCount:10,maxWeight:12,maxTotalWeight:35,minBurstExtra:4,minQualityExtra:3,maxSpread:4,edgeOverNormal:0}
  };

  const n=v=>{if(v===null||v===undefined||v==='')return null;const x=Number(v);return Number.isFinite(x)?x:null};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const r2=v=>Math.round(v*100)/100;
  // Varios mercados reutilizan el mismo ticker (WOLF es Wolfspeed en NYSE y Meta Wolf en XETRA)
  // y en Trade Republic se opera con otro (Wolfspeed es CR6 en LSX). Los textos usan el ticker
  // del mercado donde se opera (marketTicker) y el nombre, y el pintado lo enlaza a la ficha.
  const label=c=>{const t=String(c.marketTicker||c.ticker||'');return t+(c.name&&String(c.name)!==t?' ('+c.name+')':'')};
  const money=v=>(Math.round(v*100)/100).toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
  const pct=v=>(v>0?'+':'')+(Math.round(v*10)/10).toLocaleString('es-ES')+' %';

  function band(risk){return RISK[risk]||RISK.aggressive}
  function specPolicy(cfg,maxPositions){
    const raw=n(cfg&&cfg.specMode),mode=clamp(Math.round(raw===null?(cfg&&cfg.allowSpec===false?0:1):raw),0,3);
    const base=SPEC_POLICY[mode]||SPEC_POLICY[1];
    return{...base,mode,maxCount:mode===3?maxPositions:Math.min(base.maxCount,maxPositions)};
  }

  // Stop inicial según volatilidad: k × ATR diario, entre −6 % y −12 %.
  function stopPctFor(atrPct,risk){
    const b=band(risk),a=n(atrPct);
    return clamp(a!==null&&a>0?a*b.stopK:8,STOP_MIN,STOP_MAX);
  }
  // Recorrido previsto de una entrada: stop × relación beneficio/riesgo, modulado por la puntuación.
  function targetPctFor(stopPct,score,risk){
    const s=n(score)??60,b=band(risk);
    const raw=stopPct*b.rr*clamp((s-50)/30,.6,1.3);
    // Horizonte de Objetivo: días, no meses. Evitamos objetivos absurdamente lejanos.
    return clamp(raw,risk==='aggressive'?5:4,risk==='aggressive'?18:risk==='balanced'?14:11);
  }

  // Filtro de entrada compartido por web y backend. Un candidato puede tener buen score
  // y aun así ser una mala compra AHORA por FOMO, spread o extensión.
  // Variación desde la apertura de HOY. En EE. UU. solo en sesión regular: en pre/post el
  // «open» que llega es el de la sesión anterior y la comparación no tendría sentido.
  function openFadePct(q){
    const p=n(q&&q.price),o=n(q&&q.open);
    if(p===null||!(o>0))return null;
    if(String(q.market||'')!=='tr'){
      const st=String(q.marketStatus||'').toLowerCase();
      if(/pre|post|after|closed/.test(st)||!/regular|open/.test(st))return null;
    }
    return (p/o-1)*100;
  }

  function candidateEntry(c,risk='aggressive'){
    const b=band(risk),limitReasons=[],waitReasons=[];let timing=100;
    const spread=n(c.spreadPct),extension=n(c.extensionPct),day=n(c.dayChangePct),week=n(c.perfWeek),
      nearHigh=n(c.nearHighPct),rsi=n(c.rsi),quality=n(c.quality),current=n(c.askEur)??n(c.priceEur);
    if(extension!==null&&extension>0)timing-=Math.min(34,extension*3.1);
    if(day!==null&&day>3)timing-=Math.min(24,(day-3)*2);
    if(week!==null&&week>8)timing-=Math.min(18,(week-8)*.8);
    if(nearHigh!==null&&nearHigh<.8&&day!==null&&day>4)timing-=10;
    if(spread===null){
      timing-=quality!==null&&quality>=80?4:10;
      if(quality===null||quality<80)waitReasons.push('spread sin verificar');
    }else{
      timing-=Math.min(18,spread*2);
      if(spread>b.maxSpreadPct)waitReasons.push('spread demasiado amplio');
    }
    // Un salto que se está devolviendo (precio muy por debajo de la apertura de hoy) no es una
    // entrada temprana aunque el cambio frente al cierre anterior siga en positivo.
    const fade=n(c.openFadePct);
    if(fade!==null&&fade<=-4){timing-=Math.min(30,Math.abs(fade)*2);waitReasons.push('devuelve la subida de la apertura ('+(Math.round(fade*10)/10).toLocaleString('es-ES')+' % desde la apertura)')}
    if(day!==null&&day<-.75){timing-=Math.min(18,Math.abs(day+.75)*3);waitReasons.push('momentum de entrada deteriorado')}
    if(extension!==null&&extension>b.maxExtensionPct)limitReasons.push('demasiado alejada de EMA20');
    if(day!==null&&day>b.maxDayChangePct)limitReasons.push('subida intradía demasiado extendida');
    if(week!==null&&week>b.maxWeekPerfPct)limitReasons.push('subida semanal demasiado extendida');
    if(nearHigh!==null&&nearHigh<.5&&day!==null&&day>6)limitReasons.push('riesgo de perseguir máximos');
    if(rsi!==null&&rsi>78)waitReasons.push('RSI sobrecalentado');
    timing=clamp(timing,0,100);
    if(timing<b.minTiming&&!waitReasons.length)limitReasons.push('punto de entrada débil');

    let discount=0;
    if(extension!==null)discount=Math.max(discount,Math.max(0,extension-b.maxExtensionPct)+.5);
    if(day!==null)discount=Math.max(discount,Math.max(0,day-b.maxDayChangePct)*.65+.5);
    if(week!==null)discount=Math.max(discount,Math.max(0,week-b.maxWeekPerfPct)*.25+.5);
    if(nearHigh!==null&&nearHigh<.5&&day!==null&&day>6)discount=Math.max(discount,1.5);
    if(timing<b.minTiming)discount=Math.max(discount,(b.minTiming-timing)*.12+.5);
    discount=clamp(discount,0,12);
    const limitPriceEur=current!==null&&current>0&&discount>0?r2(current*(1-discount/100)):null;
    const eligible=!waitReasons.length&&!limitReasons.length;
    const decision=eligible?'BUY_NOW':(!waitReasons.length&&limitReasons.length&&limitPriceEur!==null?'BUY_LIMIT':'WAIT');
    return{eligible,decision,timing:r2(timing),reasons:[...waitReasons,...limitReasons],waitReasons,limitReasons,
      limitPriceEur,limitDiscountPct:r2(discount)};
  }

  // Puntuación específica del Objetivo: busca el movimiento ANTES de que esté demasiado
  // extendido. No es una probabilidad; es un ranking de oportunidad temprana (0-100).
  function candidateBurst(c,risk='aggressive'){
    const entry=candidateEntry(c,risk);
    const b=band(risk),parts=[];let score=50;
    const add=(name,v)=>{score+=v;if(Math.abs(v)>=4)parts.push(name+(v>0?' +':' ')+Math.round(v))};
    const rv=n(c.relVolume),ch=n(c.dayChangePct),rsi=n(c.rsi),adx=n(c.adx),p=n(c.technicalPrice),
      e20=n(c.ema20),e50=n(c.ema50),week=n(c.perfWeek),spread=n(c.spreadPct),avgVolume=n(c.avgVolume),
      catalystImpact=n(c.catalystImpact),catalystDays=n(c.catalystDays),
      externalTiming=n(c.entryTiming),timing=externalTiming===null?entry.timing:Math.min(entry.timing,externalTiming),
      extension=n(c.extensionPct),nearHigh=n(c.nearHighPct),scout=n(c.aiScoutScore);
    if(rv!==null){if(rv>=1.5&&rv<=4)add('volumen acelera',14);else if(rv>4)add('volumen extremo',ch!==null&&ch<=6?10:4);else if(rv>=1.05)add('volumen despierta',6);else if(rv<.65)add('volumen débil',-10)}
    if(ch!==null){if(ch>=.25&&ch<=4)add('impulso temprano',11);else if(ch>4&&ch<=8)add('movimiento activo',6);else if(ch>10)add('demasiado extendida',-16);else if(ch<-.75)add('momentum negativo',-10)}
    if(rsi!==null){if(rsi>=48&&rsi<=65)add('RSI con margen',10);else if(rsi>=42&&rsi<48)add('RSI despertando',4);else if(rsi>74)add('RSI caliente',-13);else if(rsi<36)add('RSI débil',-8)}
    if(adx!==null){if(adx>=16&&adx<=30)add('tendencia naciente',9);else if(adx>30&&adx<=42)add('tendencia activa',5);else if(adx<12)add('sin tendencia',-5)}
    if(p!==null&&e20!==null&&e50!==null){if(p>=e20&&e20>=e50)add('estructura alcista',10);else if(p>=e20)add('sobre EMA20',4);else add('bajo EMA20',-9)}
    if(extension!==null){if(extension>=0&&extension<=4)add('entrada poco extendida',6);else if(extension>7)add('lejos de EMA20',-12)}
    if(nearHigh!==null&&ch!==null){if(nearHigh<=2&&ch<=5)add('presión de ruptura',6);else if(nearHigh<.5&&ch>6)add('persigue máximos',-8)}
    if(week!==null){if(week>=0&&week<=12)add('semana con margen',5);else if(week>20)add('semana sobreextendida',-10);else if(week<-6)add('semana débil',-7)}
    if(spread!==null){if(spread<=1)add('spread limpio',4);else if(spread>b.maxSpreadPct)add('spread caro',-18);else if(spread>3)add('spread amplio',-6)}
    const traded=p!==null&&avgVolume!==null?p*avgVolume:null;
    if(traded!==null){if(traded<200000)add('liquidez insuficiente',-20);else if(traded<1000000)add('liquidez baja',-9);else if(traded>=5000000)add('liquidez suficiente',3)}
    if(catalystImpact!==null&&catalystDays!==null&&catalystDays>=0&&catalystDays<=7){
      if(catalystImpact>=75)add('catalizador cercano fuerte',12);else if(catalystImpact>=55)add('catalizador cercano',7);
    }
    if(timing!==null)score=score*.72+timing*.28;
    const aiPhase=String(c.aiScoutPhase||'').toLowerCase();
    if(scout!==null)score=score*.72+clamp(scout,0,100)*.28;
    if(aiPhase==='early')add('IA detecta fase temprana',6);
    else if(aiPhase==='active')add('IA confirma movimiento',2);
    else if(aiPhase==='late'||aiPhase==='avoid')add('IA detecta entrada tardía',-28);
    score=clamp(score,0,100);
    const phase=(aiPhase==='late'||aiPhase==='avoid')?aiPhase:
      score>=80&&(ch===null||ch<=5)&&(rsi===null||rsi<=68)?'early':
      score>=b.minBurst&&(ch===null||ch<=10)?'active':
      ch!==null&&ch>10?'late':'watch';
    return{score:r2(score),phase,parts,entryTiming:timing,entryEligible:entry.eligible,entryDecision:entry.decision,
      entryReasons:entry.reasons,limitPriceEur:entry.limitPriceEur,limitDiscountPct:entry.limitDiscountPct};
  }
  // Stop vigente de una posición: el inicial y, si ya gana más que su stop, el que sube detrás
  // del máximo. Una vez gana el doble del stop, nunca baja de precio de entrada + comisiones.
  function positionStop(p,risk){
    const avg=n(p.avgEur),price=n(p.priceEur),units=n(p.units)||0;
    const stopPct=stopPctFor(p.atrPct,risk);
    if(avg===null||avg<=0)return{stopPct,stopEur:null,trailing:false};
    const peak=Math.max(n(p.peakEur)||0,price||0,avg);
    let stop=avg*(1-stopPct/100),trailing=false;
    if(peak>=avg*(1+stopPct/100)){
      stop=Math.max(stop,peak*(1-stopPct/100));trailing=true;
      if(peak>=avg*(1+2*stopPct/100)&&units>0){
        const breakeven=avg+((n(p.feeEur)||0)*2)/units;
        stop=Math.max(stop,breakeven);
      }
    }
    const stored=n(p.stopEur);
    if(stored!==null&&stored>stop)stop=stored; // un stop nunca baja
    return{stopPct,stopEur:stop,trailing,peakEur:peak};
  }

  // Ritmo hacia la fecha: crecimiento compuesto desde el inicio del objetivo.
  function pace(cfg,valueEur,nowMs){
    const target=n(cfg.target),value=n(valueEur),start=n(cfg.startValue)||value;
    const out={status:'nodate',progressPct:null,expectedEur:null,daysLeft:null,requiredMonthlyPct:null};
    if(target===null||value===null||!(target>0))return out;
    out.progressPct=start!==null&&target>start?clamp((value-start)/(target-start)*100,-100,200):value>=target?100:0;
    if(value>=target){out.status='reached';return out}
    const t0=Date.parse(cfg.startDate||''),t1=Date.parse(cfg.deadline||'');
    if(!Number.isFinite(t1))return out;
    const now=nowMs||Date.now(),daysLeft=Math.max(0,(t1-now)/86400000);
    out.daysLeft=Math.ceil(daysLeft);
    out.requiredMonthlyPct=daysLeft>0&&value>0?(Math.pow(target/value,30/daysLeft)-1)*100:null;
    if(daysLeft<=0){out.status='overdue';return out}
    if(Number.isFinite(t0)&&start>0&&t1>t0){
      const f=clamp((now-t0)/(t1-t0),0,1);
      out.expectedEur=start*Math.pow(target/start,f);
      out.status=value<out.expectedEur*.97?'behind':value>out.expectedEur*1.03?'ahead':'on';
    }else out.status='on';
    return out;
  }

  function feeOf(x,side){const f=n(side==='SELL'?x.sellFeeEur:x.buyFeeEur);return f===null?n(x.feeEur)||0:f}

  /* plan(input) → { actions, holds, pace, defensive, drawdownPct, notes, band }
   * input.config: {target, deadline, startValue, startDate, risk, maxPositions(3–5), specMode(0–3), allowSpec}
   * input.positions: [{key,ticker,name,units,avgEur,priceEur,bidEur,score,quality,tier,
   *                    speculative,atrPct,peakEur,stopEur,feeEur,aiVerdict}]
   * input.candidates: [{key,ticker,name,priceEur,askEur,score,quality,tier,speculative,
   *                     atrPct,feeEur,aiVerdict}]
   * input.cashEur, input.peakValueEur, input.wasDefensive, input.nowMs */
  function plan(input={}){
    const cfg=input.config||{},risk=RISK[cfg.risk]?cfg.risk:'aggressive',b=band(risk);
    const maxPositions=clamp(Math.round(n(cfg.maxPositions)||5),1,10),spec=specPolicy(cfg,maxPositions);
    const positions=(input.positions||[]).filter(p=>(n(p.units)||0)>0);
    const cash=Math.max(0,n(input.cashEur)||0);
    const valueEur=cash+positions.reduce((s,p)=>s+(n(p.units)||0)*(n(p.priceEur)||0),0);
    const peak=Math.max(n(input.peakValueEur)||0,valueEur);
    const drawdownPct=peak>0?(1-valueEur/peak)*100:0;
    const defensive=input.wasDefensive?drawdownPct>DEFENSIVE_OUT:drawdownPct>=DEFENSIVE_IN;
    const pc=pace(cfg,valueEur,input.nowMs);
    // Ir retrasado NO autoriza a comprar señales peores ni a sobredimensionar: eso aumenta
    // la probabilidad de alejarse aún más del objetivo. Solo reducimos algo el riesgo si vamos adelantados.
    const adj=pc.status==='ahead'?{score:2,size:.9}:{score:0,size:1};
    const minScore=b.minScore+adj.score,minQuality=b.minQuality;
    const actions=[],holds=[],notes=[],waits=[];
    let pool=cash;
    const remaining=[];

    // 1) Stops (siempre) y stops que suben.
    for(const p of positions){
      const st=positionStop(p,risk),price=n(p.bidEur)??n(p.priceEur),units=n(p.units)||0;
      const row={...p,stop:st};
      if(st.stopEur!==null&&price!==null&&price<=st.stopEur){
        const proceeds=units*price-feeOf(p,'SELL');
        pool+=Math.max(0,proceeds);
        actions.push({type:'SELL',reason:'stop',key:p.key,ticker:p.ticker,name:p.name,units,priceEur:price,stopEur:r2(st.stopEur),
          text:'Vender '+units+' × '+label(p)+': stop alcanzado ('+money(st.stopEur)+').'});
        continue;
      }
      const stored=n(p.stopEur);
      if(st.stopEur!==null&&st.trailing&&(stored===null||st.stopEur>stored*1.005)){
        actions.push({type:'RAISE_STOP',key:p.key,ticker:p.ticker,name:p.name,stopEur:r2(st.stopEur),fromEur:stored===null?null:r2(stored),
          text:'Subir el stop de '+label(p)+' a '+money(st.stopEur)+' para asegurar ganancia.'});
      }
      remaining.push(row);
    }

    // 2) Candidatas válidas (antes de decidir rotaciones).
    const held=new Set(remaining.map(p=>String(p.key))),specHeldCount=remaining.filter(p=>p.speculative).length;
    const mappedCands=(input.candidates||[]).filter(c=>{
      if(held.has(String(c.key)))return false;
      if(!['high','opportunity','watch','spec'].includes(c.tier)&&!c.speculative)return false;
      if(c.aiVerdict==='contradice'||c.aiScoutVerdict==='block')return false;
      if((n(c.score)??0)<50||(n(c.quality)??0)<minQuality)return false;
      if(c.speculative&&spec.maxCount<=0)return false;
      return (n(c.askEur)??n(c.priceEur))>0;
    }).map(c=>{
      const burst=candidateBurst(c,risk),stopPct=stopPctFor(c.atrPct,risk);
      return{...c,burstScore:burst.score,burstPhase:burst.phase,burstReasons:burst.parts,
        entryTiming:burst.entryTiming,entryEligible:burst.entryEligible,entryDecision:burst.entryDecision,entryReasons:burst.entryReasons,
        limitPriceEur:burst.limitPriceEur,limitDiscountPct:burst.limitDiscountPct,
        stopPct,targetPct:targetPctFor(stopPct,Math.max(n(c.score)||0,burst.score),risk)};
    });
    const bestNormalBurst=Math.max(-Infinity,...mappedCands.filter(c=>!c.speculative).map(c=>n(c.burstScore)??0));
    const rankedCands=mappedCands.filter(c=>{
      if((n(c.score)??0)<minScore&&c.burstScore<b.minBurst+8)return false;
      if(c.burstScore<b.minBurst-4||c.burstPhase==='avoid')return false;
      if(!c.speculative)return true;
      if(specHeldCount>=spec.maxCount)return false;
      if((n(c.quality)??0)<minQuality+spec.minQualityExtra)return false;
      if(c.burstScore<b.minBurst+spec.minBurstExtra)return false;
      if(spec.maxSpread!==null&&n(c.spreadPct)!==null&&n(c.spreadPct)>spec.maxSpread)return false;
      if(Number.isFinite(bestNormalBurst)&&c.burstScore<bestNormalBurst+spec.edgeOverNormal)return false;
      return true;
    }).sort((x,y)=>y.burstScore-x.burstScore||(n(y.score)||0)-(n(x.score)||0)||(n(y.quality)||0)-(n(x.quality)||0));
    // Objetivo no dispersa el capital entre muchas ideas: una principal y una segunda solo
    // cuando está realmente cerca de la primera. Las buenas ideas con mal precio se conservan
    // como ESPERAR / COMPRA LÍMITE en vez de desaparecer del plan.
    const shortlist=rankedCands.length>1&&rankedCands[1].burstScore>=rankedCands[0].burstScore-5
      ?rankedCands.slice(0,2):rankedCands.slice(0,1);
    // Sin cotización en vivo (p. ej. antes de la apertura o con el dato de la sesión anterior) no se
    // propone comprar ni cambiar: el movimiento real del día puede ser el contrario al que indica el dato.
    const stale=c=>c.quoteFresh===false;
    const cands=shortlist.filter(c=>c.entryEligible&&!stale(c)&&c.burstScore>=b.minBurst&&!['late','avoid'].includes(c.burstPhase));
    if(!defensive){
      for(const c of shortlist.filter(c=>!c.entryEligible||stale(c))){
        const isLimit=!stale(c)&&c.entryDecision==='BUY_LIMIT'&&n(c.limitPriceEur)!==null;
        waits.push({type:'WAIT',decision:isLimit?'COMPRA LÍMITE':'ESPERAR',key:c.key,ticker:c.ticker,name:c.name,
          limitPriceEur:isLimit?r2(c.limitPriceEur):null,currentPriceEur:r2(n(c.askEur)??n(c.priceEur)),
          burstScore:r2(c.burstScore),entryTiming:r2(c.entryTiming),reasons:c.entryReasons||[],
          text:isLimit
            ?'Esperar '+label(c)+': oportunidad válida, pero no comprar por encima de '+money(c.limitPriceEur)+'. La entrada actual está demasiado extendida.'
            :stale(c)?'Esperar '+label(c)+': no hay cotización en vivo; antes de comprar hay que ver cómo cotiza ahora.'
            :'Esperar '+label(c)+': '+((c.entryReasons||[]).join(', ')||'el punto de entrada no es suficientemente limpio')+'.'});
      }
    }

    // 3) Posiciones débiles: solo se sustituyen si compensa (pérdida + comisiones, con margen).
    const used=new Set();
    for(const p of remaining.slice()){
      const score=n(p.score)??50,holdingDays=n(p.holdingDays),priceNow=n(p.bidEur)??n(p.priceEur),avgNow=n(p.avgEur)??priceNow;
      const ret=avgNow>0&&priceNow!==null?(priceNow/avgNow-1)*100:null;
      const imminent=n(p.catalystDays)!==null&&n(p.catalystDays)>=0&&n(p.catalystDays)<=2&&(n(p.catalystImpact)||0)>=65;
      const stagnant=holdingDays!==null&&holdingDays>=b.stagnantDays&&ret!==null&&ret<1.5&&ret>-4&&score<65&&!imminent;
      const decaying=holdingDays!==null&&holdingDays>=2&&ret!==null&&ret<0&&score<=50&&!imminent;
      const expired=holdingDays!==null&&holdingDays>=b.maxHoldDays&&ret!==null&&ret<3&&score<72&&!imminent;
      const minHold=holdingDays!==null&&holdingDays<b.minHoldDays;
      const weak=score<=40||p.aiVerdict==='contradice'||stagnant||decaying||expired;
      if(!weak)continue;
      if(minHold&&p.aiVerdict!=='contradice'){
        holds.push({key:p.key,ticker:p.ticker,text:'Mantener '+label(p)+': entrada demasiado reciente para rotar sin que haya saltado el stop.'});continue;
      }
      const units=n(p.units)||0,price=priceNow??0,avg=avgNow??price;
      const proceeds=units*price-feeOf(p,'SELL');
      const loss=Math.max(0,(avg-price)*units);
      const alt=cands.find(c=>!used.has(c.key));
      if(loss<=0&&score<=35){
        // En ganancia y con la señal rota: se asegura el beneficio.
        pool+=Math.max(0,proceeds);remaining.splice(remaining.indexOf(p),1);
        actions.push({type:'SELL',reason:'weak-profit',key:p.key,ticker:p.ticker,name:p.name,units,priceEur:price,
          text:'Vender '+units+' × '+label(p)+': la señal se ha debilitado y está en ganancia; se asegura.'});
        continue;
      }
      // En modo defensivo no se rota (vender para no poder comprar sería solo consolidar la pérdida).
      if(defensive){holds.push({key:p.key,ticker:p.ticker,text:'Mantener '+label(p)+': modo defensivo, solo se vende por stop.'});continue}
      // Si la tesis corta ya ha caducado o lleva días estancada, no hace falta inventar otra
      // compra para justificar la salida. Con pérdida mínima (<=1 %) se libera liquidez.
      if(!alt&&(expired||stagnant)&&ret!==null&&ret>=-1){
        pool+=Math.max(0,proceeds);remaining.splice(remaining.indexOf(p),1);
        actions.push({type:'SELL',reason:expired?'time-exit':'stagnation',key:p.key,ticker:p.ticker,name:p.name,units,priceEur:price,
          text:'Vender '+units+' × '+label(p)+': '+(expired?'se agotó la ventana de la operación corta':'lleva demasiado tiempo sin avanzar')+'; se libera liquidez para la siguiente oportunidad.'});
        continue;
      }
      if(!alt){holds.push({key:p.key,ticker:p.ticker,text:'Mantener '+label(p)+': '+(expired?'ha agotado el tiempo objetivo de la operación':stagnant?'está estancada en horizonte corto':'señal débil')+', pero vender ahora consolidaría una pérdida sin una alternativa clara.'});continue}
      const fees=feeOf(p,'SELL')+feeOf(alt,'BUY')+feeOf(alt,'SELL');
      const expectedGain=Math.max(0,proceeds)*alt.targetPct/100;
      const needed=(loss+fees)*ROTATION_MARGIN;
      if(expectedGain>=needed){
        used.add(alt.key);pool+=Math.max(0,proceeds);remaining.splice(remaining.indexOf(p),1);
        actions.push({type:'SELL',reason:'rotation',key:p.key,ticker:p.ticker,name:p.name,units,priceEur:price,into:alt.marketTicker||alt.ticker,intoKey:alt.key,intoLabel:label(alt),
          expectedGainEur:r2(expectedGain),neededEur:r2(needed),
          text:'Vender '+units+' × '+label(p)+' para pasar a '+label(alt)+': '+(expired?'ha superado el tiempo máximo de una operación corta; ':stagnant?'no está respondiendo en el horizonte corto; ':'')+'la alternativa tiene score temprano '+Math.round(alt.burstScore||0)+'/100 y se prevé '+money(expectedGain)+' frente a '+money(loss)+' de pérdida + '+money(fees)+' de comisiones.'});
      }else{
        holds.push({key:p.key,ticker:p.ticker,altKey:alt.key,altLabel:label(alt),expectedGainEur:r2(expectedGain),neededEur:r2(needed),
          text:'Mantener '+label(p)+': cambiarla consolidaría '+money(loss)+' de pérdida y '+money(fees)+' de comisiones que la mejor alternativa ('+label(alt)+', '+pct(alt.targetPct)+' previsto) no compensa con margen.'});
      }
    }

    // 4) Compras con el efectivo disponible (no en modo defensivo).
    if(defensive){
      notes.push('Modo defensivo: la cartera está un '+(Math.round(drawdownPct*10)/10).toLocaleString('es-ES')+' % por debajo de su máximo. No se abren compras hasta que se recupere; los stops siguen activos.');
    }else{
      let slots=maxPositions-remaining.length;
      let specCount=remaining.filter(p=>p.speculative).length;
      let specExposure=remaining.filter(p=>p.speculative).reduce((sum,p)=>sum+(n(p.units)||0)*(n(p.priceEur)||0),0);
      for(const c of cands){
        if(slots<=0||pool<=0)break;
        if(c.speculative&&specCount>=spec.maxCount)continue;
        const ask=n(c.askEur)??n(c.priceEur),feeB=feeOf(c,'BUY'),feeS=feeOf(c,'SELL');
        const maxW=(c.speculative?spec.maxWeight:b.maxWeight)/100;
        const specCapacity=c.speculative?Math.max(0,valueEur*spec.maxTotalWeight/100-specExposure):Infinity;
        const share=Math.min(pool/slots*adj.size,valueEur*maxW,pool,specCapacity);
        // El riesgo de la operación (hasta el stop) no pasa del % de la cartera que marca el perfil.
        const riskCap=valueEur*b.riskPerTradePct/100/(c.stopPct/100);
        const budget=Math.min(share,riskCap)-feeB;
        const units=Math.floor(budget/ask);
        if(units<1){notes.push(label(c)+': no alcanza para una acción entera con el tamaño permitido.');continue}
        const ticket=units*ask;
        if((feeB+feeS)/ticket*100>b.maxRoundTripFeePct){notes.push(label(c)+': las comisiones pesarían demasiado para '+money(ticket)+'.');continue}
        pool-=ticket+feeB;slots--;
        if(c.speculative){specCount++;specExposure+=ticket}
        actions.push({type:'BUY',decision:'COMPRAR AHORA',key:c.key,ticker:c.ticker,name:c.name,units,priceEur:ask,ticketEur:r2(ticket),
          stopEur:r2(ask*(1-c.stopPct/100)),stopPct:r2(c.stopPct),targetPct:r2(c.targetPct),speculative:!!c.speculative,aiVerdict:c.aiVerdict||'',
          burstScore:r2(c.burstScore),burstPhase:c.burstPhase||'',burstReasons:c.burstReasons||[],aiScoutReason:c.aiScoutReason||'',
          text:'Comprar '+units+' × '+label(c)+' (≈ '+money(ticket)+') · oportunidad '+Math.round(c.burstScore||0)+'/100'+(c.burstPhase==='early'?' temprana':'')+' · stop '+money(ask*(1-c.stopPct/100))+' (−'+(Math.round(c.stopPct*10)/10).toLocaleString('es-ES')+' %).'});
      }
    }
    // Cada propuesta lleva la etiqueta (ticker del mercado + nombre) de la acción a la que se refiere.
    const labels=new Map([...positions,...(input.candidates||[])].map(x=>[String(x.key),label(x)]));
    for(const x of [...actions,...waits,...holds])x.label=labels.get(String(x.key))||label(x);
    const decisions=[
      ...actions.map(a=>({...a,decision:a.decision||(a.type==='SELL'?'VENDER':a.type==='RAISE_STOP'?'MANTENER / SUBIR STOP':a.type)})),
      ...waits,
      ...holds.map(h=>({...h,type:'HOLD',decision:'MANTENER'}))
    ];
    return{version:VERSION,actions,waits,holds,decisions,notes,pace:pc,defensive,drawdownPct:r2(Math.max(0,drawdownPct)),valueEur:r2(valueEur),peakValueEur:r2(peak),
      cashLeftEur:r2(Math.max(0,pool)),band:{risk,label:b.label,minScore,maxPositions,specMode:spec.mode,specMaxCount:spec.maxCount,specMaxWeight:spec.maxWeight,specMaxTotalWeight:spec.maxTotalWeight}};
  }

  root.ViewInvAIGoal=Object.freeze({VERSION,RISK,plan,pace,positionStop,stopPctFor,targetPctFor,candidateEntry,candidateBurst,openFadePct});
})(globalThis);
