(function(root){
  'use strict';

  function dateKey(year,month,day){
    return String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  }
  const clockFormatters=new Map();
  const clockCache=new Map();
  function zoneFormatter(timeZone){
    let f=clockFormatters.get(timeZone);
    if(!f){
      f=new Intl.DateTimeFormat('en-US',{
        timeZone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',
        hour:'2-digit',minute:'2-digit',hour12:false
      });
      clockFormatters.set(timeZone,f);
    }
    return f;
  }
  function zoneClock(timeZone,date=new Date()){
    const minute=Math.floor(date.getTime()/60000);
    const hit=clockCache.get(timeZone);
    if(hit&&hit.minute===minute)return hit.parts;
    const parts=Object.freeze(Object.fromEntries(zoneFormatter(timeZone).formatToParts(date).map(x=>[x.type,x.value])));
    clockCache.set(timeZone,{minute,parts});
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
  const usCalendarCache=new Map();
  function usMarketCalendar(parts){
    const memoKey=parts&&parts.year+"-"+parts.month+"-"+parts.day+"-"+parts.weekday;
    if(memoKey&&usCalendarCache.has(memoKey))return usCalendarCache.get(memoKey);
    const result=usMarketCalendarCompute(parts);
    if(memoKey)usCalendarCache.set(memoKey,result);
    return result;
  }
  function usMarketCalendarCompute(parts){
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
  const lsxCalendarCache=new Map();
  function lsxMarketCalendar(parts){
    if(!weekdayOpen(parts))return{open:false,closeMinute:0,reason:'fin de semana'};
    const y=+parts.year,m=+parts.month,d=+parts.day,key=dateKey(y,m,d);
    if(lsxCalendarCache.has(key))return lsxCalendarCache.get(key);
    const easter=easterSundayUtc(y);
    const goodFriday=new Date(easter.getTime()-2*86400000);
    const easterMonday=new Date(easter.getTime()+86400000);
    const closed=new Set([
      dateKey(y,1,1),
      dateKey(goodFriday.getUTCFullYear(),goodFriday.getUTCMonth()+1,goodFriday.getUTCDate()),
      dateKey(easterMonday.getUTCFullYear(),easterMonday.getUTCMonth()+1,easterMonday.getUTCDate()),
      dateKey(y,5,1),
      dateKey(y,12,24),dateKey(y,12,25),dateKey(y,12,26),dateKey(y,12,31)
    ]);
    let result;
    if(closed.has(key))result={open:false,closeMinute:0,reason:'festivo LSX'};
    else if(m===12&&d===30)result={open:true,closeMinute:840,reason:'cierre anticipado LSX'};
    else result={open:true,closeMinute:1380,reason:''};
    lsxCalendarCache.set(key,result);
    return result;
  }
  function lsxOpen(parts){
    const calendar=lsxMarketCalendar(parts);
    if(!calendar.open)return false;
    const minutes=+parts.hour*60 + +parts.minute;
    return minutes>=450&&minutes<calendar.closeMinute;
  }

  root.ViewInvAIMarketSession=Object.freeze({
    dateKey,zoneClock,weekdayOpen,usMarketCalendar,usSession,lsxMarketCalendar,lsxOpen
  });
})(globalThis);
