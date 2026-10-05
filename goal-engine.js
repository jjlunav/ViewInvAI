// Motor del Objetivo de la cartera: el mismo código en la app y en el servidor.
// Objetivo «rápido»: crecer lo antes posible asumiendo riesgo, pero sin locuras:
// · compra al momento si la acción supera el filtro (sin esperar al día siguiente);
// · de 3 a 5 acciones; como mucho una especulativa y pequeña;
// · stop según la volatilidad de cada acción y stop que sube cuando gana (trailing);
// · no se vende en pérdidas para cambiar de acción salvo que la nueva prevea recuperar
//   esa pérdida y todas las comisiones con margen;
// · modo defensivo si la cartera cae un 15 % desde su máximo;
// · el ritmo hacia la fecha objetivo ajusta un poco la exigencia, sin salir del perfil.
(function(root){
  'use strict';

  const VERSION='2026.10.05-g1';
  const RISK={
    conservative:{label:'Bajo',minScore:74,minQuality:65,maxWeight:30,riskPerTradePct:1,maxRoundTripFeePct:1,stopK:2,rr:2.2},
    balanced:{label:'Medio',minScore:70,minQuality:60,maxWeight:35,riskPerTradePct:1.5,maxRoundTripFeePct:1.5,stopK:2.2,rr:2},
    aggressive:{label:'Alto',minScore:66,minQuality:55,maxWeight:40,riskPerTradePct:2.5,maxRoundTripFeePct:2,stopK:2.5,rr:1.8}
  };
  const STOP_MIN=6,STOP_MAX=12,ROTATION_MARGIN=1.25,DEFENSIVE_IN=15,DEFENSIVE_OUT=7.5,SPEC_MAX_WEIGHT=10;

  const n=v=>{if(v===null||v===undefined||v==='')return null;const x=Number(v);return Number.isFinite(x)?x:null};
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const r2=v=>Math.round(v*100)/100;
  const money=v=>(Math.round(v*100)/100).toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
  const pct=v=>(v>0?'+':'')+(Math.round(v*10)/10).toLocaleString('es-ES')+' %';

  function band(risk){return RISK[risk]||RISK.aggressive}

  // Stop inicial según volatilidad: k × ATR diario, entre −6 % y −12 %.
  function stopPctFor(atrPct,risk){
    const b=band(risk),a=n(atrPct);
    return clamp(a!==null&&a>0?a*b.stopK:8,STOP_MIN,STOP_MAX);
  }
  // Recorrido previsto de una entrada: stop × relación beneficio/riesgo, modulado por la puntuación.
  function targetPctFor(stopPct,score,risk){
    const s=n(score)??60;
    return stopPct*band(risk).rr*clamp((s-50)/30,.6,1.3);
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
   * input.config: {target, deadline, startValue, startDate, risk, maxPositions(3–5), allowSpec}
   * input.positions: [{key,ticker,name,units,avgEur,priceEur,bidEur,score,quality,tier,
   *                    speculative,atrPct,peakEur,stopEur,feeEur,aiVerdict}]
   * input.candidates: [{key,ticker,name,priceEur,askEur,score,quality,tier,speculative,
   *                     atrPct,feeEur,aiVerdict}]
   * input.cashEur, input.peakValueEur, input.wasDefensive, input.nowMs */
  function plan(input={}){
    const cfg=input.config||{},risk=RISK[cfg.risk]?cfg.risk:'aggressive',b=band(risk);
    const maxPositions=clamp(Math.round(n(cfg.maxPositions)||5),1,10);
    const positions=(input.positions||[]).filter(p=>(n(p.units)||0)>0);
    const cash=Math.max(0,n(input.cashEur)||0);
    const valueEur=cash+positions.reduce((s,p)=>s+(n(p.units)||0)*(n(p.priceEur)||0),0);
    const peak=Math.max(n(input.peakValueEur)||0,valueEur);
    const drawdownPct=peak>0?(1-valueEur/peak)*100:0;
    const defensive=input.wasDefensive?drawdownPct>DEFENSIVE_OUT:drawdownPct>=DEFENSIVE_IN;
    const pc=pace(cfg,valueEur,input.nowMs);
    // Con retraso se exige un poco menos y se invierte algo más; adelantado, al revés.
    const adj=pc.status==='behind'?{score:-3,size:1.15}:pc.status==='ahead'?{score:3,size:.9}:{score:0,size:1};
    const minScore=b.minScore+adj.score,minQuality=b.minQuality;
    const actions=[],holds=[],notes=[];
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
          text:'Vender '+units+' × '+p.ticker+': stop alcanzado ('+money(st.stopEur)+').'});
        continue;
      }
      const stored=n(p.stopEur);
      if(st.stopEur!==null&&st.trailing&&(stored===null||st.stopEur>stored*1.005)){
        actions.push({type:'RAISE_STOP',key:p.key,ticker:p.ticker,name:p.name,stopEur:r2(st.stopEur),fromEur:stored===null?null:r2(stored),
          text:'Subir el stop de '+p.ticker+' a '+money(st.stopEur)+' para asegurar ganancia.'});
      }
      remaining.push(row);
    }

    // 2) Candidatas válidas (antes de decidir rotaciones).
    const held=new Set(remaining.map(p=>String(p.key)));
    const specHeld=remaining.some(p=>p.speculative);
    const cands=(input.candidates||[]).filter(c=>{
      if(held.has(String(c.key)))return false;
      if(!['high','opportunity','spec'].includes(c.tier)&&!c.speculative)return false;
      if(c.aiVerdict==='contradice')return false;
      if((n(c.score)??0)<minScore||(n(c.quality)??0)<minQuality)return false;
      if(c.speculative&&(cfg.allowSpec===false||specHeld))return false;
      return (n(c.askEur)??n(c.priceEur))>0;
    }).map(c=>{
      const stopPct=stopPctFor(c.atrPct,risk);
      return{...c,stopPct,targetPct:targetPctFor(stopPct,c.score,risk)};
    }).sort((x,y)=>y.targetPct-x.targetPct||(n(y.score)||0)-(n(x.score)||0));

    // 3) Posiciones débiles: solo se sustituyen si compensa (pérdida + comisiones, con margen).
    const used=new Set();
    for(const p of remaining.slice()){
      const score=n(p.score)??50,weak=score<=40||p.aiVerdict==='contradice';
      if(!weak)continue;
      const units=n(p.units)||0,price=n(p.bidEur)??n(p.priceEur)??0,avg=n(p.avgEur)??price;
      const proceeds=units*price-feeOf(p,'SELL');
      const loss=Math.max(0,(avg-price)*units);
      const alt=cands.find(c=>!used.has(c.key));
      if(loss<=0&&score<=35){
        // En ganancia y con la señal rota: se asegura el beneficio.
        pool+=Math.max(0,proceeds);remaining.splice(remaining.indexOf(p),1);
        actions.push({type:'SELL',reason:'weak-profit',key:p.key,ticker:p.ticker,name:p.name,units,priceEur:price,
          text:'Vender '+units+' × '+p.ticker+': la señal se ha debilitado y está en ganancia; se asegura.'});
        continue;
      }
      // En modo defensivo no se rota (vender para no poder comprar sería solo consolidar la pérdida).
      if(defensive){holds.push({key:p.key,ticker:p.ticker,text:'Mantener '+p.ticker+': modo defensivo, solo se vende por stop.'});continue}
      if(!alt){holds.push({key:p.key,ticker:p.ticker,text:'Mantener '+p.ticker+': señal débil, pero no hay una alternativa mejor que lo compense.'});continue}
      const fees=feeOf(p,'SELL')+feeOf(alt,'BUY')+feeOf(alt,'SELL');
      const expectedGain=Math.max(0,proceeds)*alt.targetPct/100;
      const needed=(loss+fees)*ROTATION_MARGIN;
      if(expectedGain>=needed){
        used.add(alt.key);pool+=Math.max(0,proceeds);remaining.splice(remaining.indexOf(p),1);
        actions.push({type:'SELL',reason:'rotation',key:p.key,ticker:p.ticker,name:p.name,units,priceEur:price,into:alt.ticker,
          expectedGainEur:r2(expectedGain),neededEur:r2(needed),
          text:'Vender '+units+' × '+p.ticker+' para pasar a '+alt.ticker+': se prevé '+money(expectedGain)+' frente a '+money(loss)+' de pérdida + '+money(fees)+' de comisiones.'});
      }else{
        holds.push({key:p.key,ticker:p.ticker,expectedGainEur:r2(expectedGain),neededEur:r2(needed),
          text:'Mantener '+p.ticker+': cambiarla consolidaría '+money(loss)+' de pérdida y '+money(fees)+' de comisiones que la mejor alternativa ('+alt.ticker+', '+pct(alt.targetPct)+' previsto) no compensa con margen.'});
      }
    }

    // 4) Compras con el efectivo disponible (no en modo defensivo).
    if(defensive){
      notes.push('Modo defensivo: la cartera está un '+(Math.round(drawdownPct*10)/10).toLocaleString('es-ES')+' % por debajo de su máximo. No se abren compras hasta que se recupere; los stops siguen activos.');
    }else{
      let slots=maxPositions-remaining.length;
      for(const c of cands){
        if(slots<=0||pool<=0)break;
        const ask=n(c.askEur)??n(c.priceEur),feeB=feeOf(c,'BUY'),feeS=feeOf(c,'SELL');
        const maxW=(c.speculative?SPEC_MAX_WEIGHT:b.maxWeight)/100;
        const share=Math.min(pool/slots*adj.size,valueEur*maxW,pool);
        // El riesgo de la operación (hasta el stop) no pasa del % de la cartera que marca el perfil.
        const riskCap=valueEur*b.riskPerTradePct/100/(c.stopPct/100);
        const budget=Math.min(share,riskCap)-feeB;
        const units=Math.floor(budget/ask);
        if(units<1){notes.push(c.ticker+': no alcanza para una acción entera con el tamaño permitido.');continue}
        const ticket=units*ask;
        if((feeB+feeS)/ticket*100>b.maxRoundTripFeePct){notes.push(c.ticker+': las comisiones pesarían demasiado para '+money(ticket)+'.');continue}
        pool-=ticket+feeB;slots--;
        actions.push({type:'BUY',key:c.key,ticker:c.ticker,name:c.name,units,priceEur:ask,ticketEur:r2(ticket),
          stopEur:r2(ask*(1-c.stopPct/100)),stopPct:r2(c.stopPct),targetPct:r2(c.targetPct),speculative:!!c.speculative,aiVerdict:c.aiVerdict||'',
          text:'Comprar '+units+' × '+c.ticker+' (≈ '+money(ticket)+') con stop en '+money(ask*(1-c.stopPct/100))+' (−'+(Math.round(c.stopPct*10)/10).toLocaleString('es-ES')+' %).'});
      }
    }
    return{version:VERSION,actions,holds,notes,pace:pc,defensive,drawdownPct:r2(Math.max(0,drawdownPct)),valueEur:r2(valueEur),peakValueEur:r2(peak),
      cashLeftEur:r2(Math.max(0,pool)),band:{risk,label:b.label,minScore,maxPositions}};
  }

  root.ViewInvAIGoal=Object.freeze({VERSION,RISK,plan,pace,positionStop,stopPctFor,targetPctFor});
})(globalThis);
