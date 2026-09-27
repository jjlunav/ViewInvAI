(function(root){
  'use strict';

  function dateKey(year,month,day){
    return String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  }
  const zoneFormatters=new Map(),zoneClockCache=new Map();
  function zoneClock(timeZone,date=new Date()){
    const key=timeZone+'|'+Math.floor(date.getTime()/1000);
    const cached=zoneClockCache.get(key);if(cached)return cached;
    let formatter=zoneFormatters.get(timeZone);
    if(!formatter){formatter=new Intl.DateTimeFormat('en-US',{
      timeZone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',
      hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
    });zoneFormatters.set(timeZone,formatter)}
    const parts=Object.fromEntries(formatter.formatToParts(date).map(x=>[x.type,x.value]));
    if(parts.hour==='24')parts.hour='00';
    zoneClockCache.set(key,Object.freeze(parts));
    if(zoneClockCache.size>512)zoneClockCache.delete(zoneClockCache.keys().next().value);
    return parts;
  }
  function weekdayOpen(parts){
    return !!parts&&parts.weekday!=='Sat'&&parts.weekday!=='Sun';
  }
  function nthWeekdayOfMonth(year,month,weekday,n){
    const first=new Date(Date.UTC(year,month-1,1));
    const offset=(weekday-first.getUTCDay()+7)%7;
    return 1+offset+(n-1)*7;
  }
  function lastWeekdayOfMonth(year,month,weekday){
    const last=new Date(Date.UTC(year,month,0));
    const offset=(last.getUTCDay()-weekday+7)%7;
    return last.getUTCDate()-offset;
  }
  function observedFixedDate(year,month,day){
    const d=new Date(Date.UTC(year,month-1,day));
    const wd=d.getUTCDay();
    if(wd===6)d.setUTCDate(d.getUTCDate()-1);
    else if(wd===0)d.setUTCDate(d.getUTCDate()+1);
    return dateKey(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate());
  }
  function easterSundayUtc(year){
    const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4;
    const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
    const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4;
    const l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
    const month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;
    return new Date(Date.UTC(year,month-1,day));
  }
  function usMarketCalendar(parts){
    if(!weekdayOpen(parts))return{open:false,earlyClose:false,reason:'fin de semana'};
    const y=+parts.year,m=+parts.month,d=+parts.day,key=dateKey(y,m,d),closed=new Set();
    closed.add(observedFixedDate(y,1,1));
    closed.add(dateKey(y,1,nthWeekdayOfMonth(y,1,1,3)));
    closed.add(dateKey(y,2,nthWeekdayOfMonth(y,2,1,3)));
    const easter=easterSundayUtc(y),goodFriday=new Date(easter.getTime()-2*86400000);
    closed.add(dateKey(goodFriday.getUTCFullYear(),goodFriday.getUTCMonth()+1,goodFriday.getUTCDate()));
    closed.add(dateKey(y,5,lastWeekdayOfMonth(y,5,1)));
    closed.add(observedFixedDate(y,6,19));
    closed.add(observedFixedDate(y,7,4));
    closed.add(dateKey(y,9,nthWeekdayOfMonth(y,9,1,1)));
    const thanksgiving=nthWeekdayOfMonth(y,11,4,4);
    closed.add(dateKey(y,11,thanksgiving));
    closed.add(observedFixedDate(y,12,25));
    if(closed.has(key))return{open:false,earlyClose:false,reason:'festivo EEUU'};
    const early=(m===11&&d===thanksgiving+1)||(m===12&&d===24)||(m===7&&d===3);
    return{open:true,earlyClose:early,reason:early?'cierre anticipado':''};
  }
  function usSession(parts){
    const calendar=usMarketCalendar(parts);
    if(!calendar.open)return'previous';
    const minutes=+parts.hour*60 + +parts.minute;
    const regularEnd=calendar.earlyClose?780:960;
    const postEnd=calendar.earlyClose?1020:1200;
    if(minutes>=240&&minutes<570)return'premarket';
    if(minutes>=570&&minutes<regularEnd)return'regular';
    if(minutes>=regularEnd&&minutes<postEnd)return'postmarket';
    return'previous';
  }
  function lsxMarketCalendar(parts){
    if(!weekdayOpen(parts))return{open:false,closeMinute:0,reason:'fin de semana'};
    const y=+parts.year,key=dateKey(y,+parts.month,+parts.day);
    if(y===2026){
      const closed=new Set([
        '2026-01-01','2026-04-03','2026-04-06','2026-05-01',
        '2026-12-24','2026-12-25','2026-12-26','2026-12-31'
      ]);
      if(closed.has(key))return{open:false,closeMinute:0,reason:'festivo LSX'};
      if(key==='2026-12-30')return{open:true,closeMinute:840,reason:'cierre anticipado LSX'};
    }
    return{open:true,closeMinute:1380,reason:''};
  }
  function lsxOpen(parts){
    const calendar=lsxMarketCalendar(parts);
    if(!calendar.open)return false;
    const minutes=+parts.hour*60 + +parts.minute;
    return minutes>=450&&minutes<calendar.closeMinute;
  }

  // Snapshot pre/post timestamps identify a session bar, not necessarily the
  // last trade. Keep that precision instead of inventing an exact trade time.
  const SESSION_ORDER={premarket:0,regular:1,postmarket:2,unknown:3};
  function finiteNumber(value){
    if(value===null||value===undefined||value==='')return null;
    const n=Number(value);return Number.isFinite(n)?n:null;
  }
  function usQuoteSession(at){
    const p=zoneClock('America/New_York',new Date(at)),calendar=usMarketCalendar(p);
    if(!calendar.open)return'unknown';
    const seconds=(+p.hour*60 + +p.minute)*60 + +(p.second||0);
    const close=(calendar.earlyClose?780:960)*60;
    if(seconds>=240*60&&seconds<570*60)return'premarket';
    // The closing auction at exactly 16:00 (13:00 on half-days) is regular.
    if(seconds>=570*60&&seconds<=close)return'regular';
    if(seconds>close&&seconds<=(calendar.earlyClose?1020:1200)*60)return'postmarket';
    return'unknown';
  }
  function regularSnapshotDay(at){
    let p=zoneClock('America/New_York',new Date(at));
    if(usMarketCalendar(p).open&&(+p.hour*60 + +p.minute)>=570)
      return dateKey(+p.year,+p.month,+p.day);
    // Walk civil dates at midday to avoid local/UTC and DST boundary errors.
    let day=new Date(Date.UTC(+p.year,+p.month-1,+p.day,17));
    for(let i=0;i<14;i++){
      day.setUTCDate(day.getUTCDate()-1);
      p=zoneClock('America/New_York',day);
      if(usMarketCalendar(p).open)return dateKey(+p.year,+p.month,+p.day);
    }
    return null;
  }
  function selectUsQuoteSessions(samples,nowMs=Date.now()){
    const now=finiteNumber(nowMs);
    if(now===null)throw new TypeError('A valid reference time is required');
    const candidates=[];
    for(const input of Array.isArray(samples)?samples:[]){
      if(!input)continue;
      const price=finiteNumber(input.price),at=finiteNumber(input.at);
      if(price===null||price<=0||(at!==null&&(at<=0||at>now+60000)))continue;
      const precision=input.precision||'trade';
      const session=Object.hasOwn(SESSION_ORDER,input.session)?input.session:(at===null?'unknown':usQuoteSession(at));
      let day=null;
      if(at!==null){
        const p=zoneClock('America/New_York',new Date(at));
        if(precision==='snapshot'&&session==='regular')day=regularSnapshotDay(at);
        else{
          // Ignore impossible weekend/holiday extended-session timestamps.
          if(session!=='unknown'&&!usMarketCalendar(p).open)continue;
          day=dateKey(+p.year,+p.month,+p.day);
        }
      }
      candidates.push({...input,price,change:finiteNumber(input.change),at,session,precision,day});
    }
    const precisionRank={trade:2,session:1,snapshot:0};
    const compare=(a,b)=>{
      // Dated evidence beats an undated observation: download time is not trade time.
      if(a.day!==b.day)return String(a.day||'').localeCompare(String(b.day||''));
      if(a.session!==b.session)return SESSION_ORDER[a.session]-SESSION_ORDER[b.session];
      // A late regular snapshot must not lose to an old live quote from that
      // morning. Clamp its ordering time to the close; precision stays explicit.
      if(a.session==='regular'&&a.at&&b.at&&a.precision!==b.precision){
        const seconds=q=>{
          const p=zoneClock('America/New_York',new Date(q.at));
          const date=dateKey(+p.year,+p.month,+p.day);
          const close=(usMarketCalendar(p).earlyClose?780:960)*60;
          return q.precision==='snapshot'&&date!==q.day?close:Math.min(close,(+p.hour*60 + +p.minute)*60 + +p.second);
        };
        const difference=seconds(a)-seconds(b);if(difference)return difference;
      }
      const pa=precisionRank[a.precision]??0,pb=precisionRank[b.precision]??0;
      if(pa!==pb)return pa-pb;
      return (a.at||0)-(b.at||0);
    };
    candidates.sort(compare);
    const pick=fn=>candidates.filter(fn).at(-1)||null;
    const session=usSession(zoneClock('America/New_York',new Date(now)));
    const latest=pick(q=>q.day!==null)||pick(q=>q.session==='regular')||(candidates.length?{...candidates.at(-1),session:'unknown'}:null);
    // PRE/POST is shown only when it is the newest source-dated observation.
    // A Friday PRE must not sit below the later Friday close on Sunday.
    const extended=latest&&latest.day!==null&&(latest.session==='premarket'||latest.session==='postmarket')?latest:null;
    return {
      regular:pick(q=>q.session==='regular'),extended,latest,
      session,closed:session==='previous'
    };
  }

  root.ViewInvAIMarketSession=Object.freeze({
    dateKey,zoneClock,weekdayOpen,usMarketCalendar,usSession,lsxMarketCalendar,lsxOpen,
    usQuoteSession,selectUsQuoteSessions
  });
})(globalThis);
