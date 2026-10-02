/*
 * ViewInvAI stock charts
 * ----------------------
 * TradingView integration, Trade Republic history and native LSX chart rendering.
 */

function links(s){
 let raw=String(s.ticker||'').toUpperCase(),t=encodeURIComponent(raw),tv=encodeURIComponent(String(s.tvSymbol||((s.exchange||'NASDAQ')+':'+raw)).replace(':','-'));
 return '<div class="external-links"><span class="external-links-label">Contrastar / ampliar:</span>'+
  '<a target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="https://www.tradingview.com/symbols/'+tv+'/">TradingView ↗</a>'+
  '<a target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="https://www.investing.com/search/?q='+t+'">Investing ↗</a>'+
  '<a target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="https://www.nasdaq.com/market-activity/stocks/'+encodeURIComponent(raw.toLowerCase())+'">Nasdaq ↗</a>'+
  '<a target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="https://stockmarketwatch.com/stock/'+t+'">StockMarketWatch ↗</a>'+
  '<a target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="https://stocktwits.com/symbol/'+t+'">StockTwits ↗</a></div>';
}
function tradingViewChartSymbol(s,useTr=false){
 if(!s)return'';
 if(useTr)return String(s.trTvSymbol||'').trim().toUpperCase();
 return String(s.tvSymbol||(((s.exchange||'NASDAQ')+':'+(s.ticker||'')))).trim().toUpperCase();
}
function trTradingViewCandidate(s){
 if(!s||!trTradable(s))return'';
 return String(s.trTicker||'').trim().toUpperCase();
}
async function ensureTradingViewTrSymbol(s){
 let candidate=trTradingViewCandidate(s);
 if(!candidate){
  if(s){s.trTvSymbol='';s.trTvChecked=true}
  return'';
 }
 let isin=String(s.trIsin||s.isin||'').trim().toUpperCase();
 let key='LSX:'+candidate+'|'+isin;
 if(tvChartAvailability.has(key)){
  let cached=tvChartAvailability.get(key)||'';
  s.trTvSymbol=cached;s.trTvChecked=true;
  return cached;
 }
 try{
  let url='/api/tv-symbol?symbol='+encodeURIComponent(candidate)+(isin?'&isin='+encodeURIComponent(isin):'');
  let response=await fetch(url,{cache:'default'});
  if(!response.ok)throw Error(response.status);
  let data=await response.json();
  let symbol=data&&data.available?String(data.symbol||'').trim().toUpperCase():'';
  if(symbol&&!/^LSX:[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(symbol))symbol='';
  tvChartAvailability.set(key,symbol);
  s.trTvSymbol=symbol;s.trTvChecked=true;
  return symbol;
 }catch(_){
  s.trTvSymbol='';s.trTvChecked=false;
  return'';
 }
}
const trChartHistoryCache=new Map();
function trChartResolution(range){
 return range==='1d'?60000:range==='1w'?300000:range==='1m'?900000:range==='3m'?3600000:range==='6m'?7200000:range==='1y'?14400000:3600000;
}
async function loadTrChartHistory(s,range='1d',force=false){
 let isin=trIsin(s);if(!isin)throw Error('Sin ISIN de Trade Republic');
 let key=isin+':'+range,cached=trChartHistoryCache.get(key);
 if(!force&&cached&&Date.now()-cached.at<45000)return cached.data;
 let url='/api/tr-history?isin='+encodeURIComponent(isin)+'&exchange='+encodeURIComponent(s.trExchange||'LSX')+
  '&range='+encodeURIComponent(range)+'&resolution='+encodeURIComponent(trChartResolution(range));
 let controller=typeof AbortController==='function'?new AbortController():null;
 let timeout=controller?setTimeout(()=>controller.abort(),9000):null;
 let response;
 try{
  response=await fetch(url,{cache:'no-store',signal:controller?controller.signal:undefined});
 }catch(error){
  if(error&&error.name==='AbortError')throw Error('Tiempo de espera agotado para el histórico LSX');
  throw error;
 }finally{
  if(timeout)clearTimeout(timeout);
 }
 if(!response.ok)throw Error('TR '+response.status);
 let data=await response.json(),points=Array.isArray(data&&data.points)?data.points.filter(p=>N(p&&p.close)!==null):[];
 if(points.length<2)throw Error('Histórico LSX insuficiente');
 data.points=points;
 trChartHistoryCache.set(key,{at:Date.now(),data});
 return data;
}
function trChartTimeLabel(ts,range){
 let d=new Date(Number(ts));if(!Number.isFinite(d.getTime()))return'';
 if(range==='1d')return d.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
 return d.toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit'});
}
function renderTrNativeChart(el,s,data,range='1d'){
 let raw=Array.isArray(data&&data.points)?data.points:[],maxPoints=190;
 let step=Math.max(1,Math.ceil(raw.length/maxPoints));
 let pts=raw.filter((_,i)=>i%step===0||i===raw.length-1).map(p=>({
  time:Number(p.time),open:N(p.open),high:N(p.high),low:N(p.low),close:N(p.close),volume:N(p.volume)
 })).filter(p=>Number.isFinite(p.time)&&p.close!==null);
 if(pts.length<2)throw Error('Histórico LSX insuficiente');

 let W=1000,H=440,L=54,R=70,T=24,B=40,VH=70,G=14,priceBottom=H-B-VH-G,plotW=W-L-R;
 let lo=Math.min(...pts.map(p=>p.low??p.close)),hi=Math.max(...pts.map(p=>p.high??p.close));
 let pad=Math.max((hi-lo)*.06,Math.abs(hi)*.0015,.0001);lo-=pad;hi+=pad;
 let span=Math.max(hi-lo,.0001),y=v=>T+(hi-v)/span*(priceBottom-T),x=i=>L+plotW*i/(pts.length-1);
 let maxVol=Math.max(1,...pts.map(p=>p.volume||0)),cw=Math.max(2,Math.min(7,plotW/pts.length*.62));
 let grid='',axis='',candles='',volumes='',times='';
 for(let i=0;i<5;i++){
  let yy=T+(priceBottom-T)*i/4,val=hi-span*i/4;
  grid+='<line x1="'+L+'" y1="'+yy.toFixed(1)+'" x2="'+(W-R)+'" y2="'+yy.toFixed(1)+'" class="tr-native-grid"/>';
  axis+='<text x="'+(W-R+7)+'" y="'+(yy+3).toFixed(1)+'" class="tr-native-axis">'+E(F(val,val<10?3:2))+'</text>';
 }
 pts.forEach((p,i)=>{
  let xx=x(i),o=p.open??p.close,c=p.close,h=p.high??Math.max(o,c),l=p.low??Math.min(o,c),cls=c>=o?'up':'down';
  let yo=y(o),yc=y(c),yh=y(h),yl=y(l),top=Math.min(yo,yc),bodyH=Math.max(1,Math.abs(yc-yo));
  candles+='<line x1="'+xx.toFixed(1)+'" y1="'+yh.toFixed(1)+'" x2="'+xx.toFixed(1)+'" y2="'+yl.toFixed(1)+'" class="tr-native-wick '+cls+'"/>'+
   '<rect x="'+(xx-cw/2).toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+cw.toFixed(1)+'" height="'+bodyH.toFixed(1)+'" class="tr-native-candle '+cls+'"/>';
  let vh=(p.volume||0)/maxVol*VH;
  volumes+='<rect x="'+(xx-cw/2).toFixed(1)+'" y="'+(H-B-vh).toFixed(1)+'" width="'+cw.toFixed(1)+'" height="'+vh.toFixed(1)+'" class="tr-native-volume '+cls+'"/>';
 });
 for(let i=0;i<5;i++){
  let idx=Math.min(pts.length-1,Math.round((pts.length-1)*i/4)),xx=x(idx);
  times+='<text x="'+xx.toFixed(1)+'" y="'+(H-14)+'" text-anchor="'+(i===0?'start':i===4?'end':'middle')+'" class="tr-native-axis">'+E(trChartTimeLabel(pts[idx].time,range))+'</text>';
 }
 let first=pts[0].close,last=pts[pts.length-1].close,change=first?((last/first)-1)*100:null;
 let ranges=['1d','1w','1m','3m','6m','1y'].map(r=>'<button type="button" data-tr-chart-range="'+r+'" class="'+(r===range?'active':'')+'">'+r.toUpperCase()+'</button>').join('');
 el.dataset.chartMarket='tr';el.dataset.trRange=range;
 el.innerHTML='<div class="tr-native-chart">'+
  '<div class="tr-native-toolbar"><div><strong>'+E((s.trExchange||'LSX')+' · '+(s.trTicker||s.ticker||''))+'</strong><span>Trade Republic · histórico real</span></div><div class="tr-native-ranges">'+ranges+'</div></div>'+
  '<div class="tr-native-summary"><strong>'+E(F(last,last<10?3:2))+' €</strong><span class="'+C(change)+'">'+PC(change)+'</span><small>'+pts.length+' puntos</small></div>'+
  '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="Gráfico '+E(s.trTicker||s.ticker||'LSX')+'">'+grid+axis+volumes+candles+times+'</svg>'+
 '</div>';
}

function chartMarketName(s,useTr=false){
 if(useTr)return (s.trExchange||'LSX')+' · '+(s.trTicker||'TR');
 return (s.exchange||'EEUU')+' · '+(s.ticker||'');
}
function chartMarketControls(s,usAvailable,trAvailable,active){
 if(!(usAvailable&&trAvailable))return '';
 return '<div class="chart-market-switch" role="group" aria-label="Cambiar mercado del gráfico">'+
  '<button type="button" class="chart-market-toggle'+(active==='us'?' active':'')+'" data-chart-market="us">EEUU · '+E(s.ticker||'')+'</button>'+
  '<button type="button" class="chart-market-toggle'+(active==='tr'?' active':'')+'" data-chart-market="tr">LSX · '+E(s.trTicker||'TR')+'</button></div>';
}
function setChartMarketUi(block,s,usAvailable,trAvailable,active){
 if(!block||!s)return;
 let slot=block.querySelector('[data-chart-market-controls]');
 if(slot){
  slot.innerHTML=chartMarketControls(s,usAvailable,trAvailable,active);
  slot.hidden=!(usAvailable&&trAvailable);
 }
}
function chartRetryHtml(message){
 return '<div class="chart-placeholder chart-placeholder-error"><div><span>'+E(message||'No se pudo cargar el gráfico.')+'</span><button type="button" class="chart-retry" data-chart-retry="1">Reintentar</button></div></div>';
}
function miniChart(s,preferTr=false){
 return '<div class="mini-chart-block tv-chart-block" data-stock-key="'+E(stockKey(s))+'" data-chart-prefer-tr="'+(preferTr?'1':'0')+'">'+
  '<div class="chart-market-control-slot" data-chart-market-controls></div>'+
  '<div class="mini-chart tv-advanced-chart" data-stock-key="'+E(stockKey(s))+'" data-chart-market="us"><div class="chart-placeholder">Cargando gráfico…</div></div></div>';
}
function renderTradingViewChart(el,market){
 if(!el)return;
 let s=stockByKey(el.dataset.stockKey);if(!s)return;
 let canTr=!!tradingViewChartSymbol(s,true);
 let useTr=market==='tr'&&canTr;
 let symbol=tradingViewChartSymbol(s,useTr);
 if(!symbol){
  el.innerHTML='<div class="chart-placeholder">No hay símbolo de TradingView disponible para este mercado.</div>';
  return;
 }
 el.dataset.chartMarket=useTr?'tr':'us';
 const attempt=String((Number(el.dataset.chartAttempt)||0)+1);
 el.dataset.chartAttempt=attempt;
 el.innerHTML='';
 let wrap=document.createElement('div');wrap.className='tradingview-widget-container';
 let widget=document.createElement('div');widget.className='tradingview-widget-container__widget';
 wrap.appendChild(widget);
 let script=document.createElement('script');
 script.type='text/javascript';
 script.async=true;
 script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
 script.textContent=JSON.stringify({
  autosize:true,
  symbol,
  interval:'1',
  timezone:'Europe/Madrid',
  theme:currentTheme()==='light'?'light':'dark',
  style:'1',
  locale:'es',
  backgroundColor:currentTheme()==='light'?'#ffffff':'#05090c',
  gridColor:currentTheme()==='light'?'rgba(24,52,64,0.08)':'rgba(255,255,255,0.06)',
  hide_side_toolbar:false,
  hide_top_toolbar:false,
  hide_legend:false,
  allow_symbol_change:false,
  save_image:false,
  calendar:false,
  details:false,
  hotlist:false,
  withdateranges:true,
  extended_hours:true,
  support_host:'https://www.tradingview.com'
 });
 script.onerror=()=>{
  if(!el.isConnected||el.dataset.chartAttempt!==attempt)return;
  el.innerHTML=chartRetryHtml('TradingView no ha podido cargar.');
 };
 wrap.appendChild(script);
 el.appendChild(wrap);
 setTimeout(()=>{
  if(!el.isConnected||el.dataset.chartAttempt!==attempt)return;
  if(!el.querySelector('iframe')){
   el.innerHTML=chartRetryHtml('El gráfico está tardando demasiado en cargar.');
  }
 },9000);
}
async function loadMiniChart(el){
 if(!el||el.dataset.loaded==='1')return;
 el.dataset.loaded='1';

 let block=el.closest('.tv-chart-block'),s=stockByKey(el.dataset.stockKey);
 if(!block||!s)return;

 // Availability of the selector is structural: a verified TR instrument should
 // be selectable immediately. Historical data is fetched only when LSX is the
 // active market, so opening a US chart never waits on Trade Republic.
 let usAvailable=!!tradingViewChartSymbol(s,false)&&!intlListing(s);
 let trAvailable=!!(trTradable(s)&&trIsin(s));
 let preferTr=block.dataset.chartPreferTr==='1';
 let market=preferTr&&trAvailable?'tr':usAvailable?'us':trAvailable?'tr':'';

 setChartMarketUi(block,s,usAvailable,trAvailable,market);

 if(!market){
  el.innerHTML='<div class="chart-placeholder">No hay histórico LSX ni gráfico EEUU disponible para este valor.</div>';
  return;
 }

 if(market==='us'){
  renderTradingViewChart(el,'us');
  return;
 }

 el.dataset.chartMarket='tr';
 el.dataset.trRange='1d';
 el.innerHTML='<div class="chart-placeholder">Cargando histórico LSX…</div>';

 try{
  let data=await loadTrChartHistory(s,'1d');
  if(!el.isConnected||stockKey(s)!==el.dataset.stockKey)return;
  renderTrNativeChart(el,s,data,'1d');
  setChartMarketUi(block,s,usAvailable,true,'tr');
 }catch(error){
  if(usAvailable){
   renderTradingViewChart(el,'us');
   setChartMarketUi(block,s,usAvailable,trAvailable,'us');
   let note=document.createElement('div');
   note.className='chart-fallback-note';
   note.textContent='LSX sin histórico disponible · mostrando '+chartMarketName(s,false);
   block.appendChild(note);
  }else{
   el.innerHTML=chartRetryHtml(error&&error.message?error.message:'No hay histórico LSX disponible para este valor.');
  }
 }
}
async function switchMiniChartMarket(button){
 let block=button&&button.closest('.tv-chart-block');if(!block)return;
 let el=block.querySelector('.tv-advanced-chart'),s=stockByKey(block.dataset.stockKey);if(!el||!s)return;
 let market=button.dataset.chartMarket==='tr'?'tr':'us';
 block.querySelectorAll('.chart-fallback-note').forEach(n=>n.remove());
 if(market==='tr'){
  try{
   let data=await loadTrChartHistory(s,el.dataset.trRange||'1d');
   renderTrNativeChart(el,s,data,el.dataset.trRange||'1d');
  }catch(_){
   if(!tradingViewChartSymbol(s,false))return;
   market='us';renderTradingViewChart(el,'us');
   let note=document.createElement('div');note.className='chart-fallback-note';note.textContent='LSX no disponible · mostrando '+chartMarketName(s,false);block.appendChild(note);
  }
 }else{
  if(!tradingViewChartSymbol(s,false))return;
  renderTradingViewChart(el,'us');
 }
 block.querySelectorAll('.chart-market-toggle').forEach(b=>b.classList.toggle('active',b.dataset.chartMarket===market));
}
async function switchTrChartRange(button){
 let block=button&&button.closest('.tv-chart-block'),el=block&&block.querySelector('.tv-advanced-chart'),s=block&&stockByKey(block.dataset.stockKey);
 if(!el||!s)return;
 let range=String(button.dataset.trChartRange||'1d');
 try{
  button.disabled=true;
  let data=await loadTrChartHistory(s,range);
  renderTrNativeChart(el,s,data,range);
  setChartMarketUi(block,s,!!tradingViewChartSymbol(s,false),true,'tr');
 }catch(_){
  let note=block.querySelector('.chart-fallback-note');
  if(!note){note=document.createElement('div');note.className='chart-fallback-note';block.appendChild(note)}
  note.textContent='No hay histórico LSX disponible para '+range.toUpperCase()+'.';
 }finally{
  button.disabled=false;
 }
}


function retryMiniChart(button){
 let el=button&&button.closest&&button.closest('.tv-advanced-chart');
 if(!el)return;
 delete el.dataset.loaded;
 el.innerHTML='<div class="chart-placeholder">Reintentando gráfico…</div>';
 loadMiniChart(el);
}
