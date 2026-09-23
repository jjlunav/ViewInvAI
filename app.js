const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DATA='data/market.json', KEY='entrypointtrade:filters:v3';
let db={stocks:[],events:[],meta:{}}, loading=false;
let state={entryMarket:'tr',radarMarket:'tr',session:'auto',radarSession:'all',radarDirection:'all',preset:'intraday'};
const V={entry:'01 Potencial de entrada',future:'02 Potencial futuro',radar:'03 Radar de acciones',calendar:'04 Calendario y noticias',catalog:'05 Catálogo Trade Republic'};
const P={
 short:{minChange:1,maxChange:0,minRelVolume:1.2,minAdx:18,minRsi:38,maxRsi:72,minVolume:0,trend:false,illiquid:true,sort:'score'},
 medium:{minChange:0,maxChange:0,minRelVolume:1,minAdx:15,minRsi:35,maxRsi:78,minVolume:0,trend:true,illiquid:true,sort:'score'},
 broad:{minChange:0,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:false,sort:'score'},
 intraday:{minChange:2,maxChange:0,minRelVolume:1.5,minAdx:20,minRsi:40,maxRsi:70,minVolume:0,trend:false,illiquid:true,sort:'score'},
 exploded:{minChange:20,maxChange:0,minRelVolume:1.5,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:true,sort:'change'},
 afterhours:{minChange:0,maxChange:0,minRelVolume:0,minAdx:0,minRsi:0,maxRsi:100,minVolume:0,trend:false,illiquid:false,sort:'afterhours'},
 strict:{minChange:1,maxChange:0,minRelVolume:1.3,minAdx:22,minRsi:42,maxRsi:68,minVolume:0,trend:true,illiquid:true,sort:'score'}
};
function preset(n){return Object.assign({},P[n]||P.intraday)}
state.filters=preset('intraday');

function N(v){v=Number(v);return Number.isFinite(v)?v:null}
function E(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function F(v,d=2){v=N(v);return v===null?'—':v.toLocaleString('es-ES',{maximumFractionDigits:d})}
function I(v){v=N(v);return v===null?'—':Math.round(v).toLocaleString('es-ES')}
function PR(v){v=N(v);return v===null?'—':v.toLocaleString('es-ES',{maximumFractionDigits:v<1?6:4})}
function PC(v){v=N(v);return v===null?'—':(v>=0?'+':'')+F(v,2)+'%'}
function C(v){v=N(v);return v===null?'':v>=0?'positive':'negative'}
function DF(v){if(v===null||v===undefined||v==='')return'—';let raw=v;if(typeof raw==='string'&&/^\d+$/.test(raw))raw=Number(raw);if(typeof raw==='number'&&raw>0&&raw<1e12)raw*=1000;let d=new Date(raw);return isNaN(d)?'—':d.toLocaleDateString('es-ES')}
function NY(){let a=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());return Object.fromEntries(a.map(x=>[x.type,x.value]))}
function auto(){let p=NY(),m=+p.hour*60 + +p.minute;if(m>=240&&m<570)return'premarket';if(m>=570&&m<960)return'regular';if(m>=960&&m<1200)return'postmarket';return'previous'}
function SES(){return state.session==='auto'?auto():state.session}
function SN(s){return({premarket:'Premarket',regular:'Sesión regular',postmarket:'Postmarket',previous:'Sesión anterior'})[s]||s}
function SP(s,se=SES()){return se==='premarket'?(N(s.premarketPrice)??N(s.price)):se==='postmarket'?(N(s.postmarketPrice)??N(s.price)):N(s.price)}
function SC(s,se=SES()){return se==='premarket'?N(s.premarketChangePct):se==='postmarket'?N(s.postmarketChangePct):N(s.changePct)}
function SV(s,se=SES()){return se==='premarket'?N(s.premarketVolume):se==='postmarket'?N(s.postmarketVolume):N(s.volume)}
function RV(s){return N(s.relVolume)??(N(s.volume)!==null&&N(s.avgVolume)>0?N(s.volume)/N(s.avgVolume):null)}
function trend(s){let p=N(s.price),a=N(s.ema20),b=N(s.ema50);return p===null||a===null||b===null||p>=a&&a>=b}
function score(s,se=SES()){let x=0,c=SC(s,se)??0,r=RV(s)??0,a=N(s.adx)??0,z=N(s.rsi);x+=Math.max(-20,Math.min(35,c*1.6))+Math.min(25,r*7)+Math.min(18,a*.55);if(z!==null)x+=z>=45&&z<=72?12:z>72?5:3;if(N(s.price)!==null&&N(s.ema20)!==null&&s.price>s.ema20)x+=5;if(N(s.ema20)!==null&&N(s.ema50)!==null&&s.ema20>s.ema50)x+=5;return Math.max(0,Math.min(100,x))}

function tapeSession(){
 let se=auto();
 return se==='previous'?'regular':se;
}
function tapeSessionLabel(se){return se==='premarket'?'PREMARKET':se==='postmarket'?'POSTMARKET':'SESIÓN EEUU'}
function moverRank(s,se){
 let ch=SC(s,se),vol=SV(s,se),rel=RV(s);
 if(ch===null)return -1;
 let liquidity=vol===null?0:Math.min(8,Math.log10(Math.max(1,vol)));
 let relBoost=rel===null?0:Math.min(8,rel)*0.12;
 return Math.abs(ch)+liquidity*.16+relBoost;
}
function tapeItem(s,se){
 let ch=SC(s,se),p=SP(s,se),sym=encodeURIComponent(String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+(s.ticker||''))).replace(':','-'));
 return '<a class="market-tape-item" target="_blank" rel="noopener" href="https://www.tradingview.com/symbols/'+sym+'/" title="'+E(s.name||s.ticker)+'"><strong>'+E(s.ticker)+'</strong><span class="market-tape-price">'+PR(p)+'</span><span class="'+C(ch)+'">'+PC(ch)+'</span></a>';
}
function renderMarketTape(){
 let track=$('#marketTapeTrack'),label=$('.market-tape-label');
 if(!track||!label)return;
 let se=tapeSession();
 label.textContent='EEUU · '+tapeSessionLabel(se);
 let movers=db.stocks
  .filter(s=>SC(s,se)!==null&&Math.abs(SC(s,se))>=0.5)
  .filter(s=>{let v=SV(s,se);return v===null||v>=1000})
  .sort((a,b)=>moverRank(b,se)-moverRank(a,se))
  .slice(0,24);
 if(!movers.length){track.innerHTML='<span class="market-tape-loading">Sin movimientos disponibles</span>';return}
 let items=movers.map(s=>tapeItem(s,se)).join('');
 track.innerHTML='<div class="market-tape-set">'+items+'</div><div class="market-tape-set" aria-hidden="true">'+items+'</div>';
 track.style.setProperty('--tape-duration',Math.max(28,movers.length*2.2)+'s');
}
function links(s){let t=encodeURIComponent(String(s.ticker||'').toUpperCase()),tv=encodeURIComponent(String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+(s.ticker||''))).replace(':','-'));return '<div class="external-links"><a target="_blank" rel="noopener" href="https://www.tradingview.com/symbols/'+tv+'/">TradingView ↗</a><a target="_blank" rel="noopener" href="https://www.investing.com/search/?q='+t+'">Investing.com ↗</a><a target="_blank" rel="noopener" href="https://stockmarketwatch.com/stock/'+t+'">StockMarketWatch ↗</a><a target="_blank" rel="noopener" href="https://stocktwits.com/symbol/'+t+'">StockTwits ↗</a></div>'}
function miniChart(s){let symbol=String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+(s.ticker||'')));return '<div class="mini-chart-block"><div class="mini-chart-title">Gráfico · 1 mes</div><div class="mini-chart" data-symbol="'+E(symbol)+'"><div class="chart-placeholder">Cargando gráfico…</div></div></div>'}
function loadMiniChart(el){if(!el||el.dataset.loaded==='1')return;let symbol=el.dataset.symbol;if(!symbol)return;el.dataset.loaded='1';el.innerHTML='<div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div></div>';let box=el.querySelector('.tradingview-widget-container'),script=document.createElement('script');script.type='text/javascript';script.async=true;script.src='https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js';script.textContent=JSON.stringify({symbol,width:'100%',height:'100%',locale:'es',dateRange:'1M',colorTheme:'dark',isTransparent:true,autosize:true,largeChartUrl:'',chartOnly:true,noTimeScale:true});box.appendChild(script)}
function why(s,se){let b=[],c=SC(s,se),r=RV(s);if(c!==null)b.push(SN(se)+' '+PC(c));if(r!==null)b.push('vol. relativo '+F(r,2)+'×');if(N(s.adx)!==null)b.push('ADX '+F(s.adx,1));if(N(s.rsi)!==null)b.push('RSI '+F(s.rsi,1));if(trend(s))b.push('tendencia compatible');return b.join(' · ')||'Cumple el criterio activo con los datos disponibles.'}
function card(s,i,se=SES(),dense=false){let c=SC(s,se),p=SP(s,se),v=SV(s,se);return '<article class="stock-card '+(dense?'dense-card':'')+'"><details class="stock-details stock-disclosure"><summary class="stock-main stock-toggle"><div class="stock-id"><span class="rank">'+(i+1)+'</span><div><strong>'+E(s.ticker)+'</strong><span>'+E(s.name||'')+'</span></div></div><div class="stock-quick"><b>'+PR(p)+'</b><span class="'+C(c)+'">'+PC(c)+'</span>'+(s.tradeRepublicVerified?'<span class="pill ok">TR</span>':'')+'<span class="chevron">⌄</span></div></summary><div class="stock-detail-body"><div class="detail-grid"><div><small>Regular</small><b>'+PR(s.price)+'</b><span class="'+C(s.changePct)+'">'+PC(s.changePct)+'</span></div><div><small>Premarket</small><b>'+PR(s.premarketPrice)+'</b><span class="'+C(s.premarketChangePct)+'">'+PC(s.premarketChangePct)+'</span></div><div><small>Postmarket</small><b>'+PR(s.postmarketPrice)+'</b><span class="'+C(s.postmarketChangePct)+'">'+PC(s.postmarketChangePct)+'</span></div><div><small>Volumen</small><b>'+I(v)+'</b><span>'+F(RV(s),2)+'× rel.</span></div><div><small>RSI / ADX</small><b>'+F(s.rsi,1)+' / '+F(s.adx,1)+'</b><span>EMA20 '+PR(s.ema20)+'</span></div><div><small>1 sem / 1 mes</small><b>'+PC(s.perfWeek)+'</b><span>'+PC(s.perfMonth)+'</span></div></div><div class="why-line"><strong>Por qué aparece:</strong> '+E(why(s,se))+'</div><div class="meta-line">'+E(s.exchange||'')+' · '+E(s.currency||'USD')+(s.isin?' · ISIN '+E(s.isin):'')+(s.earningsDate?' · resultados '+DF(s.earningsDate):'')+'</div>'+miniChart(s)+links(s)+'</div></details></article>'}
function market(s,m){return m==='tr'?!!s.tradeRepublicVerified:m==='us'?['NASDAQ','NYSE','AMEX','NYSE ARCA'].includes(String(s.exchange||'').toUpperCase()):true}
function fromUI(){return{minChange:+$('#minChange').value||0,maxChange:+$('#maxChange').value||0,minRelVolume:+$('#minRelVolume').value||0,minAdx:+$('#minAdx').value||0,minRsi:+$('#minRsi').value||0,maxRsi:+$('#maxRsi').value||100,minVolume:+$('#minVolume').value||0,trend:$('#requireTrend').checked,illiquid:$('#excludeIlliquid').checked,sort:state.filters.sort}}
function lockCriterion(id,locked=true){let input=$('#'+id),btn=$('.field-lock[data-target="'+id+'"]');if(!input||!btn)return;input.readOnly=locked;btn.classList.toggle('unlocked',!locked);btn.textContent=locked?'🔒':'🔓';btn.title=locked?'Desbloquear este parámetro':'Bloquear este parámetro';btn.setAttribute('aria-label',locked?'Desbloquear '+id:'Bloquear '+id)}
function lockAllCriteria(){['minChange','maxChange','minRelVolume','minAdx','minRsi','maxRsi','minVolume'].forEach(id=>lockCriterion(id,true))}
function toUI(x){['minChange','maxChange','minRelVolume','minAdx','minRsi','maxRsi','minVolume'].forEach(k=>$('#'+k).value=x[k]);$('#requireTrend').checked=!!x.trend;$('#excludeIlliquid').checked=!!x.illiquid}
function entry(){let q=state.filters,se=q.sort==='afterhours'?'postmarket':SES(),a=db.stocks.filter(s=>market(s,state.entryMarket)).filter(s=>{let c=SC(s,se);if(c===null||c<q.minChange)return false;if(q.maxChange>0&&c>q.maxChange)return false;let r=RV(s);if(q.minRelVolume>0&&r!==null&&r<q.minRelVolume)return false;if(q.minAdx>0&&N(s.adx)!==null&&s.adx<q.minAdx)return false;if(N(s.rsi)!==null&&(s.rsi<q.minRsi||s.rsi>q.maxRsi))return false;let v=SV(s,se);if(q.minVolume>0&&v!==null&&v<q.minVolume)return false;if(q.trend&&!trend(s))return false;if(q.illiquid&&v!==null&&v<10000)return false;return true});if(q.sort==='afterhours')a.sort((x,y)=>(SC(y,'postmarket')??-999)-(SC(x,'postmarket')??-999));else if(q.sort==='change')a.sort((x,y)=>(SC(y,se)??-999)-(SC(x,se)??-999));else a.sort((x,y)=>score(y,se)-score(x,se));return[a,se]}
function renderEntry(){let [a,se]=entry();$('#entrySessionText').textContent=(state.entryMarket==='tr'?'Trade Republic':'Resto EEUU')+' · '+SN(se);$('#entryCount').textContent=a.length+' candidatas';$('#entryUpdated').textContent=db.meta.updatedAt?'datos '+new Date(db.meta.updatedAt).toLocaleString('es-ES'):'sin actualización';$('#entryTag').textContent=state.filters.sort==='afterhours'?'SUBIDAS POSTMARKET':state.preset==='exploded'?'EXPLOSIÓN EN SESIÓN':se==='premarket'?'IMPULSO PREMARKET':'SEGUIMIENTO';$('#entryLead').textContent=state.filters.sort==='afterhours'?'Acciones ordenadas por mayor subida después del cierre regular de EEUU.':'Señales técnicas y movimientos de mercado, sin precio mínimo.';$('#entryResults').innerHTML=a.length?a.slice(0,150).map((s,i)=>card(s,i,se)).join(''):'<div class="empty-state">No hay candidatas con este criterio y sesión.</div>'}
function ET(t){return({news:'Noticia relevante',medical:'Clínico / FDA',earnings:'Resultados',contract:'Contrato / acuerdo',corporate:'Operación corporativa',financing:'Financiación / dilución',analyst:'Analistas / rating',event:'Evento / conferencia',regulatory:'Regulatorio / legal',other:'Otro catalizador'})[t]||'Catalizador'}
function EL(e){let t=String(e.title||e.fact||'').toLowerCase();if(e.type==='earnings')return 'Resultados trimestrales';if(e.type==='medical'){let m=t.match(/phase\s*([123])/i);if(m)return 'Estudio clínico Fase '+m[1];if(/pdufa/.test(t))return 'PDUFA / FDA';if(/fda|approval|approved/.test(t))return 'Decisión FDA';if(/trial|clinical|study|endpoint|topline/.test(t))return 'Resultados clínicos';return 'Clínico / sanitario'}if(e.type==='financing'){if(/offering|registered direct|private placement/.test(t))return 'Oferta / ampliación';if(/warrant/.test(t))return 'Warrants';if(/convertible/.test(t))return 'Convertibles';return 'Financiación / dilución'}if(e.type==='contract')return /award|order|contract/.test(t)?'Contrato / adjudicación':'Acuerdo / alianza';if(e.type==='corporate'){if(/merger|acquisition|acquire|takeover|buyout/.test(t))return 'Fusión / adquisición';if(/reverse split/.test(t))return 'Reverse split';if(/stock split/.test(t))return 'Split';return 'Operación corporativa'}if(e.type==='analyst')return /upgrade/.test(t)?'Upgrade analista':/downgrade/.test(t)?'Downgrade analista':'Rating / precio objetivo';if(e.type==='regulatory')return 'Regulatorio / legal';if(e.type==='event')return 'Evento / conferencia';return ET(e.type)}
function EU(e){let u=String(e.url||'');return /^https?:\/\//i.test(u)?'<a class="event-link" target="_blank" rel="noopener" href="'+E(u)+'">Abrir noticia / fuente ↗</a>':''}
function eventTime(e){
 let d=e&&e.date?new Date(e.date):null;
 if(d&&!isNaN(d)){
  let parts=new Intl.DateTimeFormat('es-ES',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(d);
  let p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  let utcH=d.getUTCHours(),utcM=d.getUTCMinutes(),utcS=d.getUTCSeconds();
  if(e.eventKind==='news'||utcH||utcM||utcS)return p.hour+':'+p.minute+' NY';
 }
 let code=N(e&&e.timeCode);
 if(code!==null&&code>60&&code<86400){
  let h=Math.floor(code/3600),m=Math.floor((code%3600)/60);
  if(h>=0&&h<24)return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+' NY';
 }
 return '';
}
function eventWhen(e){let t=eventTime(e);return DF(e.date)+(t?' · '+t:'')}
function eventSources(e){
 let src=Array.isArray(e.sources)&&e.sources.length?e.sources:(e.source?[{name:e.source,url:e.url}]:[]);
 if(!src.length)return '';
 let linksHtml=src.map(s=>{let name=E(s.name||'Fuente'),u=String(s.url||'');return /^https?:\/\//i.test(u)?'<a target="_blank" rel="noopener" href="'+E(u)+'">'+name+' ↗</a>':'<span>'+name+'</span>'}).join('');
 return '<div class="event-sources"><span class="verification">'+E(e.verification||'Fuente validada')+'</span>'+linksHtml+'</div>';
}
function eventItem(e){
 let kind=e.eventKind==='news'?'Noticia':'Evento previsto',label=EL(e);
 return '<div class="event-item"><div class="event-item-head"><div><strong>'+E(label)+'</strong><span>'+E(kind)+'</span></div><time>'+E(eventWhen(e))+'</time></div><div class="event-title">'+E(e.title||e.fact||'Catalizador detectado')+'</div>'+(e.fact&&e.fact!==e.title?'<div class="event-context">'+E(e.fact)+'</div>':'')+'<div class="event-impact"><strong>Por qué importa:</strong> '+E(e.hypothesis||'Puede aumentar la volatilidad; no implica una dirección concreta.')+'</div>'+eventSources(e)+'</div>';
}
function futureWindowEvent(e,h,now){
 let d=new Date(e.date).getTime();
 if(!Number.isFinite(d))return false;
 let end=now+h*864e5;
 if(e.eventKind==='news'){
  let today=new Date();today.setHours(0,0,0,0);
  return d>=today.getTime()&&d<=now+3600e3;
 }
 return d>=now-3600e3&&d<=end;
}
function groupFutureEvents(events){
 let map=new Map();
 for(let e of events){
  let key=(e.exchange||'')+':'+(e.ticker||'');
  if(!map.has(key))map.set(key,[]);
  map.get(key).push(e);
 }
 return [...map.entries()].map(([key,items])=>{
  items.sort((a,b)=>new Date(a.date)-new Date(b.date)||((b.impactScore||0)-(a.impactScore||0)));
  return {key,items,first:items[0],maxImpact:Math.max(...items.map(x=>N(x.impactScore)||0))};
 }).sort((a,b)=>new Date(a.first.date)-new Date(b.first.date)||b.maxImpact-a.maxImpact);
}
function renderFuture(){
 let h=+$('#futureHorizon').value,t=$('#futureType').value,tr=$('#futureTrOnly').checked,now=Date.now();
 let filtered=(db.events||[]).filter(e=>futureWindowEvent(e,h,now)&&(t==='all'||e.type===t)&&(!tr||e.tradeRepublicVerified));
 let groups=groupFutureEvents(filtered);
 $('#futureResults').innerHTML=groups.length?groups.slice(0,180).map((g,i)=>{
  let e=g.first,s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;
  let count=g.items.length,label=count===1?EL(e):(count+' catalizadores');
  let when=eventWhen(e);
  return '<article class="stock-card"><details class="stock-details stock-disclosure"><summary class="stock-main stock-toggle"><div class="stock-id"><span class="rank">'+(i+1)+'</span><div><strong>'+E(e.ticker)+'</strong><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+E(when)+'</b><span class="event-type">'+E(label)+'</span>'+(e.tradeRepublicVerified?'<span class="pill ok">TR</span>':'')+'<span class="chevron">⌄</span></div></summary><div class="stock-detail-body"><div class="event-list">'+g.items.map(eventItem).join('')+'</div>'+miniChart(s)+links(s)+'</div></details></article>';
 }).join(''):'<div class="empty-state">No hay catalizadores desde ahora hasta '+h+' día'+(h===1?'':'s')+' vista con estos filtros.</div>';
}
function renderRadar(){let q=$('#radarSearch').value.trim().toLowerCase(),rs=state.radarSession,se=rs==='all'?SES():rs,a=db.stocks.filter(s=>state.radarMarket==='all'||market(s,state.radarMarket)).filter(s=>!q||(s.ticker+' '+s.name+' '+(s.isin||'')).toLowerCase().includes(q));if(rs!=='all')a=a.filter(s=>SC(s,rs)!==null);if(state.radarDirection==='up')a=a.filter(s=>(SC(s,se)??0)>0);if(state.radarDirection==='down')a=a.filter(s=>(SC(s,se)??0)<0);a.sort((x,y)=>(SC(y,se)??-999)-(SC(x,se)??-999));$('#radarResults').innerHTML=a.length?a.slice(0,300).map((s,i)=>card(s,i,se,true)).join(''):'<div class="empty-state">Sin valores con estos filtros.</div>'}
function renderCalendar(){let a=[...(db.events||[])].sort((x,y)=>new Date(y.date)-new Date(x.date));$('#calendarResults').innerHTML=a.length?a.slice(0,400).map((e,i)=>{let s=db.stocks.find(x=>x.ticker===e.ticker&&(!e.exchange||x.exchange===e.exchange))||e;return '<article class="stock-card dense-card"><details class="stock-details stock-disclosure"><summary class="stock-main stock-toggle"><div class="stock-id"><span class="rank">'+(i+1)+'</span><div><strong>'+E(e.ticker)+'</strong><span>'+E(e.name||'')+'</span></div></div><div class="stock-quick event-quick"><b>'+DF(e.date)+'</b><span class="event-type">'+E(EL(e))+'</span><span class="chevron">⌄</span></div></summary><div class="stock-detail-body"><div class="meta-line catalyst-meta">'+E(e.source||'')+'</div><div class="why-line">'+E(e.title||e.fact||'Catalizador')+'</div>'+miniChart(s)+EU(e)+links(s)+'</div></details></article>'}).join(''):'<div class="empty-state">Sin eventos o noticias disponibles.</div>'}
function renderCatalog(){let q=$('#catalogSearch').value.trim().toLowerCase(),a=db.stocks.filter(s=>s.tradeRepublicVerified).filter(s=>!q||(s.ticker+' '+s.name+' '+(s.isin||'')).toLowerCase().includes(q)).sort((x,y)=>String(x.ticker).localeCompare(String(y.ticker)));$('#catalogCount').textContent=a.length.toLocaleString('es-ES')+' cotizando · '+Number(db.meta.trOfficialCount||0).toLocaleString('es-ES')+' universo oficial';$('#catalogResults').innerHTML=a.length?a.slice(0,600).map((s,i)=>card(s,i,'regular',true)).join(''):'<div class="empty-state">No hay coincidencias verificadas cargadas.</div>'}
function status(){let age=db.meta.updatedAt?Math.round((Date.now()-new Date(db.meta.updatedAt))/60000):null;$('#providerState').textContent=db.stocks.length?'TradingView · '+(age??'—')+' min':'Sin datos';$('#providerState').classList.toggle('stale',age!==null&&age>30)}
function render(){renderMarketTape();renderEntry();renderFuture();renderRadar();renderCalendar();renderCatalog();status()}
async function load(force=false){if(loading)return;loading=true;$('#providerState').textContent='Actualizando…';try{let r=await fetch(DATA+'?v='+(force?Date.now():Math.floor(Date.now()/900000)),{cache:'no-store'});if(!r.ok)throw Error(r.status);let j=await r.json();if(!Array.isArray(j.stocks))throw Error('formato');db={stocks:j.stocks,events:Array.isArray(j.events)?j.events:[],meta:j.meta||{}};render()}catch(e){console.error(e);$('#providerState').textContent='Datos no disponibles';if(!db.stocks.length)$$('.stock-list').forEach(x=>x.innerHTML='<div class="empty-state">No se pudieron cargar los datos de mercado. Reintenta en unos instantes.</div>')}finally{loading=false}}
function show(v){if(!V[v])return;$$('.view').forEach(x=>x.classList.remove('active'));$('#view-'+v).classList.add('active');$$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===v));$('#breadcrumbView').textContent=V[v];$('#mobileView').value=v;$('#sidebar').classList.remove('open');render()}
function clock(){let p=NY();$('#nyTime').textContent=p.hour+':'+p.minute+' · Nueva York'}

$$('.nav-item').forEach(x=>x.addEventListener('click',()=>show(x.dataset.view)));
$('#mobileView').addEventListener('change',e=>show(e.target.value));$('#mobileMenu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
$('#sessionSelect').addEventListener('change',e=>{state.session=e.target.value;renderEntry()});
function setPreset(value){
 state.preset=value;
 $('#presetSelect').value=value;
 let opt=$('.preset-option[data-value="'+value+'"]');
 if(opt){$('#presetLabel').textContent=opt.querySelector('span').textContent;$$('.preset-option').forEach(x=>x.classList.toggle('active',x===opt))}
 state.filters=preset(state.preset);
 if(state.preset==='afterhours'){state.session='postmarket';$('#sessionSelect').value='postmarket'}
 toUI(state.filters);lockAllCriteria();renderEntry();
}
$('#presetSelect').addEventListener('change',e=>setPreset(e.target.value));
$('#presetTrigger').addEventListener('click',e=>{e.stopPropagation();let open=$('#presetPicker').classList.toggle('open');$('#presetTrigger').setAttribute('aria-expanded',open?'true':'false')});
$$('.preset-option').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();setPreset(b.dataset.value);$('#presetPicker').classList.remove('open');$('#presetTrigger').setAttribute('aria-expanded','false')}));
document.addEventListener('click',e=>{if(!$('#presetPicker').contains(e.target)){$('#presetPicker').classList.remove('open');$('#presetTrigger').setAttribute('aria-expanded','false')}});
$('#applyFilters').addEventListener('click',()=>{state.filters=fromUI();renderEntry()});$('#resetFilters').addEventListener('click',()=>{state.filters=preset(state.preset);toUI(state.filters);lockAllCriteria();renderEntry()});
$('#toggleFilters').addEventListener('click',()=>$('#filterDetails').open=!$('#filterDetails').open);
$('.field-lock').forEach(btn=>btn.addEventListener('click',()=>{let id=btn.dataset.target,input=$('#'+id);lockCriterion(id,!input.readOnly);if(!input.readOnly){input.focus();input.select()}}));
document.addEventListener('toggle',e=>{let d=e.target;if(d&&d.matches&&d.matches('details.stock-disclosure')&&d.open)d.querySelectorAll('.mini-chart').forEach(loadMiniChart)},true);
$$('[data-tab-group="entryMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{state.entryMarket=b.dataset.tab;$$('[data-tab-group="entryMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));renderEntry()}));
$$('[data-tab-group="radarMarket"] .tab').forEach(b=>b.addEventListener('click',()=>{state.radarMarket=b.dataset.tab;$$('[data-tab-group="radarMarket"] .tab').forEach(x=>x.classList.toggle('active',x===b));renderRadar()}));
['futureHorizon','futureType','futureTrOnly'].forEach(id=>$('#'+id).addEventListener('change',renderFuture));$('#radarSearch').addEventListener('input',renderRadar);
$('#radarSession').addEventListener('change',e=>{state.radarSession=e.target.value;renderRadar()});$('#radarDirection').addEventListener('change',e=>{state.radarDirection=e.target.value;renderRadar()});$('#catalogSearch').addEventListener('input',renderCatalog);
['refreshEntry','refreshFuture','refreshRadar'].forEach(id=>$('#'+id).addEventListener('click',()=>load(true)));
toUI(state.filters);lockAllCriteria();clock();setInterval(clock,30000);setInterval(()=>load(false),900000);load(true);