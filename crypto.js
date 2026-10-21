/*
 * ViewInvAI · Criptoactivos
 * -------------------------
 * Mercado (precio de consenso de varias fuentes públicas), Mi cripto (posiciones en D1,
 * importación de Bit2Me) y Radar cripto (señales con reglas a la vista).
 * El precio es la mediana de las fuentes; si alguna se separa más del umbral se avisa.
 */
(root=>{
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const num=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
 const q=s=>document.querySelector(s);
 const state={assets:[],quotes:{},sources:{},threshold:1,updatedAt:null,loading:false,error:'',tab:'market',search:'',positions:[],positionsLoaded:false,timer:null,detail:null,chartDays:30};

 // ---------- Formato ----------
 function eur(v,opts={}){
  v=num(v);if(v===null)return'—';
  const a=Math.abs(v),d=opts.decimals??(a>=1000?2:a>=1?2:a>=0.01?4:a>=0.0001?6:8);
  return v.toLocaleString('es-ES',{minimumFractionDigits:Math.min(d,2),maximumFractionDigits:d,useGrouping:true})+' €';
 }
 function compact(v){
  v=num(v);if(v===null)return'—';const a=Math.abs(v);
  return a>=1e12?(v/1e12).toLocaleString('es-ES',{maximumFractionDigits:2})+' B€':a>=1e9?(v/1e9).toLocaleString('es-ES',{maximumFractionDigits:1})+' mil M€':a>=1e6?(v/1e6).toLocaleString('es-ES',{maximumFractionDigits:1})+' M€':eur(v,{decimals:0});
 }
 function pct(v){v=num(v);return v===null?'—':(v>=0?'+':'')+v.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' %'}
 const tone=v=>{v=num(v);return v===null?'':v>=0?'positive':'negative'};
 function units(v){v=num(v);return v===null?'—':v.toLocaleString('es-ES',{maximumFractionDigits:8})}
 function ageText(iso){const t=Date.parse(iso||'');if(!Number.isFinite(t))return'';const s=Math.max(0,Math.round((Date.now()-t)/1000));return s<60?'hace '+s+' s':s<3600?'hace '+Math.round(s/60)+' min':'hace '+Math.round(s/3600)+' h'}

 // ---------- Datos ----------
 async function fetchJson(url){const r=await fetch(url,{cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||('HTTP '+r.status));return d}
 async function loadCatalog(){
  if(state.assets.length)return;
  const d=await fetchJson('/api/crypto/catalog');state.assets=Array.isArray(d.assets)?d.assets:[];
 }
 async function loadQuotes(){
  if(state.loading)return;state.loading=true;
  try{
   await loadCatalog();
   const d=await fetchJson('/api/crypto/quotes');
   state.quotes=d.quotes||{};state.sources=d.sources||{};state.threshold=num(d.divergenceThresholdPct)||1;state.updatedAt=d.updatedAt||new Date().toISOString();state.error='';
   root.dispatchEvent(new CustomEvent('viewinvai:crypto-quotes',{detail:{quotes:state.quotes,updatedAt:state.updatedAt}}));
  }catch(error){state.error=error&&error.message||'Sin conexión con las fuentes'}
  finally{state.loading=false;render()}
 }
 function auth(){return root.ViewInvAIAuth&&root.ViewInvAIAuth.getUser&&root.ViewInvAIAuth.getUser()?root.ViewInvAIAuth:null}
 async function api(path,options={}){
  const a=auth();if(!a)throw Error('Inicia sesión para guardar tus criptoactivos.');
  const r=await a.apiFetch(path,Object.assign({headers:{'Content-Type':'application/json'}},options));
  const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'No se pudo completar la operación.');return d;
 }
 async function loadPositions(force=false){
  if(!auth()){state.positions=[];state.positionsLoaded=false;return}
  if(state.positionsLoaded&&!force)return;
  try{const d=await api('/api/crypto-positions',{method:'GET'});state.positions=d.positions||[];state.positionsLoaded=true;publishTotals()}
  catch(error){console.warn('Crypto positions',error)}
  render();
 }

 // ---------- Cálculos ----------
 function valuation(p){
  const qt=state.quotes[p.symbol],price=num(qt&&qt.price),u=num(p.units)||0,avg=num(p.avg_price_eur);
  const value=price!==null?u*price:null,invested=avg!==null?u*avg:null,pnl=value!==null&&invested!==null?value-invested:null;
  const chg=num(qt&&qt.change24h),day=value!==null&&chg!==null&&chg>-100?value-value/(1+chg/100):null;
  return{price,value,invested,pnl,pnlPct:pnl!==null&&invested>0?pnl/invested*100:null,day,quote:qt||null};
 }
 // Totales para Mi día (mismo valor que la pestaña Mi cripto).
 function totals(){
  let value=0,day=0,pnl=0,invested=0,complete=true;const held=state.positions.filter(p=>num(p.units)>0);
  for(const p of held){const v=valuation(p);if(v.value===null){complete=false;continue}value+=v.value;if(v.day!==null)day+=v.day;if(v.pnl!==null){pnl+=v.pnl;invested+=v.invested}}
  return{value,day,pnl,invested,count:held.length,complete,updatedAt:state.updatedAt};
 }
 function publishTotals(){root.dispatchEvent(new CustomEvent('viewinvai:crypto-totals',{detail:totals()}))}

 // Radar cripto: reglas sencillas y a la vista (no es una recomendación).
 function radarSignals(qt){
  const out=[],c24=num(qt.change24h),c7=num(qt.change7d),c30=num(qt.change30d),vol=num(qt.volume24h),cap=num(qt.marketCap);
  const turnover=vol!==null&&cap>0?vol/cap*100:null;
  if(c7!==null&&c30!==null&&c24!==null&&c7>5&&c30>0&&c24>0)out.push({k:'trend',label:'Tendencia alcista',score:2,tone:'positive',why:'+'+c7.toFixed(1)+' % en 7 días, positiva en 30 días y hoy'});
  if(c7!==null&&c30!==null&&c7<-5&&c30<0)out.push({k:'down',label:'Tendencia bajista',score:-2,tone:'negative',why:c7.toFixed(1)+' % en 7 días y negativa en 30'});
  if(c24!==null&&c24>=10)out.push({k:'hot',label:'Subida brusca',score:0,tone:'warn',why:'+'+c24.toFixed(1)+' % en 24 h: riesgo de recogida de beneficios'});
  if(c24!==null&&c24<=-8)out.push({k:'drop',label:'Caída fuerte',score:-1,tone:'negative',why:c24.toFixed(1)+' % en 24 h'});
  if(turnover!==null&&turnover>=25)out.push({k:'vol',label:'Volumen anómalo',score:1,tone:'warn',why:'Negociado el '+turnover.toFixed(0)+' % de su capitalización en 24 h'});
  if(c30!==null&&c7!==null&&c30<-15&&c7>3)out.push({k:'rebound',label:'Rebote tras caída',score:1,tone:'positive',why:c30.toFixed(1)+' % en 30 días, pero +'+c7.toFixed(1)+' % en 7'});
  if(qt.status==='divergent')out.push({k:'div',label:'Precio no coincide',score:0,tone:'warn',why:'Las fuentes difieren hasta un '+(num(qt.maxDeviationPct)||0).toFixed(2)+' %'});
  return out;
 }

 // ---------- Render ----------
 function sourceBadge(qt){
  if(!qt||qt.status==='none')return'<span class="crypto-src crypto-src-none" title="Ninguna fuente respondió">Sin precio</span>';
  if(qt.status==='single')return'<span class="crypto-src crypto-src-single" title="Solo una fuente: sin contraste">1 fuente</span>';
  if(qt.status==='divergent')return'<span class="crypto-src crypto-src-warn" title="'+esc((qt.outliers||[]).join(', '))+' se separan de la mediana">⚠ '+esc((num(qt.maxDeviationPct)||0).toLocaleString('es-ES',{maximumFractionDigits:2}))+' %</span>';
  return'<span class="crypto-src crypto-src-ok" title="'+esc(qt.count)+' fuentes coinciden (±'+esc(state.threshold)+' %)">✓ '+esc(qt.count)+' fuentes</span>';
 }
 function icon(sym,qt){
  const img=qt&&qt.image;
  // Solo logos de CoinGecko (permitidos por la CSP); si no cargan, se ven las siglas.
  return img&&/^https:\/\/(coin-images|assets)\.coingecko\.com\//.test(img)?'<img class="crypto-icon" src="'+esc(img)+'" alt="" loading="lazy" referrerpolicy="no-referrer" data-crypto-sym="'+esc(sym.slice(0,3))+'">':'<span class="crypto-icon crypto-icon-text">'+esc(sym.slice(0,3))+'</span>';
 }
 function marketCard(a){
  const qt=state.quotes[a.symbol]||{},held=state.positions.some(p=>p.symbol===a.symbol&&num(p.units)>0);
  return root.ViewInvAICards.render({context:'crypto',className:'crypto-card',title:a.symbol,subtitle:a.name+(held?' · en Mi cripto':''),
   rank:qt.rank?String(qt.rank):'',leadingHtml:icon(a.symbol,qt),
   openAttrs:' data-crypto-detail="'+esc(a.symbol)+'" role="button" tabindex="0"',
   cells:[{label:'Precio · 24 h',html:'<span class="crypto-price">'+esc(eur(qt.price))+'</span><b class="'+tone(qt.change24h)+'">'+esc(pct(qt.change24h))+'</b>'},
    {label:'Contraste',html:sourceBadge(qt)},{label:'7 días',value:pct(qt.change7d),tone:tone(qt.change7d)},{label:'Capitalización',value:compact(qt.marketCap)}]});
 }
 function filtered(){
  const s=state.search.trim().toLowerCase();
  const rows=state.assets.filter(a=>!s||a.symbol.toLowerCase().includes(s)||a.name.toLowerCase().includes(s));
  return rows.sort((x,y)=>(num(state.quotes[x.symbol]&&state.quotes[x.symbol].rank)??9999)-(num(state.quotes[y.symbol]&&state.quotes[y.symbol].rank)??9999));
 }
 function sourcesHealthHtml(){
  const list=Object.values(state.sources||{});
  if(!list.length)return'';
  return'<div class="crypto-health" aria-label="Estado de las fuentes">'+list.map(s=>{
   const title=s.ok?(s.stale?'Sin respuesta ahora: datos guardados ('+ageText(s.savedAt)+'), fuera de la mediana':s.count+' monedas')+(s.role==='datos'?' · solo capitalización y variaciones':''):s.error||'Sin respuesta';
   return'<span class="'+(s.ok&&!s.stale?'ok':'off')+'" title="'+esc(title)+'">'+(s.ok&&!s.stale?'●':'○')+' '+esc(s.label)+(s.role==='datos'?' (datos)':'')+(s.stale?' (guardado)':'')+'</span>'}).join('')+'</div>';
 }
 function marketHtml(){
  if(!state.assets.length)return state.error?'<p class="crypto-empty">No se pudieron cargar las cotizaciones: '+esc(state.error)+'</p>':'<p class="crypto-empty">Cargando cotizaciones…</p>';
  const rows=filtered();
  return sourcesHealthHtml()+(rows.length?'<div class="crypto-list">'+rows.map(marketCard).join('')+'</div>':'<p class="crypto-empty">Ninguna moneda coincide con la búsqueda.</p>');
 }
 function myHtml(){
  if(!auth())return'<div class="crypto-empty"><p>Inicia sesión para guardar tus criptoactivos de Bit2Me u otra plataforma. Se guardan solo en tu cuenta.</p></div>';
  const t=totals(),held=state.positions.filter(p=>num(p.units)>0),watch=state.positions.filter(p=>!(num(p.units)>0));
  const head='<div class="crypto-summary"><div><small>Valor</small><strong>'+esc(eur(t.value,{decimals:2}))+'</strong></div><div><small>24 h</small><strong class="'+tone(t.day)+'">'+esc((t.day>=0?'+':'')+eur(t.day,{decimals:2}))+'</strong></div><div><small>Ganancia'+(t.invested>0?' · '+esc(pct(t.pnl/t.invested*100)):'')+'</small><strong class="'+tone(t.pnl)+'">'+esc(t.invested>0?(t.pnl>=0?'+':'')+eur(t.pnl,{decimals:2}):'—')+'</strong></div></div>'+
   '<div class="crypto-actions"><button type="button" class="btn small" data-crypto-add>＋ Añadir</button><button type="button" class="btn small ghost" data-crypto-import>⇪ Importar Bit2Me</button></div>';
  const card=p=>{
   const v=valuation(p);
   return root.ViewInvAICards.render({context:'crypto-portfolio',className:'crypto-card',title:p.symbol,subtitle:units(p.units)+' · '+(p.platform||'Bit2Me'),leadingHtml:icon(p.symbol,v.quote),
    openAttrs:' data-crypto-detail="'+esc(p.symbol)+'" role="button" tabindex="0"',
    cells:[{label:'Valor',html:'<span class="crypto-price">'+esc(eur(v.value,{decimals:2}))+'</span>'+(v.quote?'<b class="'+tone(v.quote.change24h)+'">'+esc(pct(v.quote.change24h))+'</b>':'')},
     {label:'P&L',value:v.pnl===null?'—':(v.pnl>=0?'+':'')+eur(v.pnl,{decimals:2})+(v.pnlPct===null?'':' · '+pct(v.pnlPct)),tone:tone(v.pnl)},
     {label:'Precio medio',value:eur(p.avg_price_eur)},{label:'Contraste',html:sourceBadge(v.quote)}],
    rowActionsHtml:'<button type="button" class="btn small ghost crypto-icon-btn" data-crypto-edit="'+esc(p.id)+'" aria-label="Editar '+esc(p.symbol)+'" title="Editar">✏️</button><button type="button" class="btn small ghost crypto-icon-btn" data-crypto-delete="'+esc(p.id)+'" aria-label="Eliminar '+esc(p.symbol)+'" title="Eliminar">🗑</button>'});
  };
  return head+(held.length?'<div class="crypto-list">'+held.map(card).join('')+'</div>':'<p class="crypto-empty">Aún no tienes criptoactivos. Añádelos a mano o importa el historial de Bit2Me.</p>')+
   (watch.length?'<h3 class="crypto-subhead">En seguimiento</h3><div class="crypto-list">'+watch.map(card).join('')+'</div>':'');
 }
 function radarHtml(){
  const rows=state.assets.map(a=>({a,qt:state.quotes[a.symbol]})).filter(r=>r.qt&&r.qt.price)
   .map(r=>Object.assign(r,{signals:radarSignals(r.qt)})).filter(r=>r.signals.length)
   .sort((x,y)=>y.signals.reduce((s,z)=>s+z.score,0)-x.signals.reduce((s,z)=>s+z.score,0));
  const intro='<p class="crypto-note">Señales calculadas con reglas fijas sobre el precio de consenso, la variación (24 h, 7 y 30 días) y el volumen. Son una ayuda para fijarte en algo, no una recomendación de compra o venta.</p>';
  if(!rows.length)return intro+'<p class="crypto-empty">Ninguna moneda muestra ahora una señal destacada.</p>';
  return intro+'<div class="crypto-list">'+rows.map(({a,qt,signals})=>root.ViewInvAICards.render({context:'crypto-radar',className:'crypto-card',title:a.symbol,subtitle:a.name,leadingHtml:icon(a.symbol,qt),
   openAttrs:' data-crypto-detail="'+esc(a.symbol)+'" role="button" tabindex="0"',
   cells:[{label:'Precio · 24 h',html:'<span class="crypto-price">'+esc(eur(qt.price))+'</span><b class="'+tone(qt.change24h)+'">'+esc(pct(qt.change24h))+'</b>'},
    {label:'Señales',html:'<span class="crypto-signals">'+signals.map(s=>'<em class="crypto-signal '+esc(s.tone)+'" title="'+esc(s.why)+'">'+esc(s.label)+'</em>').join('')+'</span>'}],
   metaHtml:'<span class="crypto-why">'+signals.map(s=>esc(s.why)).join(' · ')+'</span>'})).join('')+'</div>';
 }
 function render(){
  const body=q('#cryptoBody');if(!body)return;
  document.querySelectorAll('[data-crypto-tab]').forEach(b=>{const on=b.dataset.cryptoTab===state.tab;b.classList.toggle('active',on);b.setAttribute('aria-selected',on?'true':'false')});
  const stamp=q('#cryptoUpdated');
  if(stamp)stamp.textContent=state.updatedAt?'Actualizado '+ageText(state.updatedAt):state.loading?'Actualizando…':'';
  const search=q('#cryptoSearch');if(search)search.hidden=state.tab!=='market';
  body.innerHTML=state.tab==='mine'?myHtml():state.tab==='radar'?radarHtml():marketHtml();
  if(state.detail)renderDetail();
 }

 // ---------- Ficha (modal) ----------
 function ensureModal(){
  let modal=q('#cryptoModal');if(modal)return modal;
  const backdrop=document.createElement('div');backdrop.id='cryptoModalBackdrop';backdrop.className='app-modal-backdrop';backdrop.setAttribute('aria-hidden','true');
  modal=document.createElement('section');modal.id='cryptoModal';modal.className='app-modal crypto-modal';modal.setAttribute('aria-hidden','true');modal.setAttribute('aria-label','Criptoactivo');
  modal.innerHTML='<div class="app-modal-head"><strong id="cryptoModalTitle">Cripto</strong><button type="button" data-crypto-close aria-label="Cerrar">×</button></div><div id="cryptoModalBody" class="app-modal-body"></div>';
  document.body.append(backdrop,modal);backdrop.addEventListener('click',closeModal);return modal;
 }
 function openModal(title,html){
  const modal=ensureModal();q('#cryptoModalTitle').textContent=title;q('#cryptoModalBody').innerHTML=html;
  modal.classList.add('open');modal.setAttribute('aria-hidden','false');q('#cryptoModalBackdrop').classList.add('open');q('#cryptoModalBackdrop').setAttribute('aria-hidden','false');document.body.classList.add('app-modal-open');
 }
 function closeModal(){
  state.detail=null;
  q('#cryptoModal')?.classList.remove('open');q('#cryptoModal')?.setAttribute('aria-hidden','true');
  q('#cryptoModalBackdrop')?.classList.remove('open');q('#cryptoModalBackdrop')?.setAttribute('aria-hidden','true');
  document.body.classList.remove('app-modal-open');
 }
 function chartSvg(points){
  if(!points||points.length<2)return'<p class="crypto-empty">Gráfico no disponible.</p>';
  const w=320,h=110,xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),dy=(y1-y0)||1;
  const d=points.map((p,i)=>(i?'L':'M')+((p[0]-x0)/((x1-x0)||1)*w).toFixed(1)+' '+(h-(p[1]-y0)/dy*(h-8)-4).toFixed(1)).join(' ');
  const up=ys[ys.length-1]>=ys[0];
  return'<svg class="crypto-chart '+(up?'positive':'negative')+'" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" role="img" aria-label="Evolución del precio"><path d="'+d+'"/></svg><div class="crypto-chart-range"><span>Mín. '+esc(eur(y0))+'</span><span>Máx. '+esc(eur(y1))+'</span></div>';
 }
 async function openDetail(sym){
  state.detail={symbol:sym,quote:state.quotes[sym]||null,chart:null};
  openModal(sym,'<p class="crypto-empty">Contrastando fuentes…</p>');renderDetail();
  try{const d=await fetchJson('/api/crypto/quotes?symbols='+encodeURIComponent(sym)+'&detail=1');if(state.detail&&state.detail.symbol===sym){state.detail.quote=(d.quotes||{})[sym]||state.detail.quote;renderDetail()}}catch(_){}
  loadChart(sym,state.chartDays);
 }
 async function loadChart(sym,days){
  state.chartDays=days;if(state.detail)state.detail.chart=null;renderDetail();
  try{const d=await fetchJson('/api/crypto/chart?symbol='+encodeURIComponent(sym)+'&days='+days);if(state.detail&&state.detail.symbol===sym){state.detail.chart=d.points||[];renderDetail()}}
  catch(_){if(state.detail){state.detail.chart=[];renderDetail()}}
 }
 function renderDetail(){
  const d=state.detail,body=q('#cryptoModalBody');if(!d||!body)return;
  const a=state.assets.find(x=>x.symbol===d.symbol)||{symbol:d.symbol,name:d.symbol},qt=d.quote||{};
  q('#cryptoModalTitle').textContent=a.symbol+' · '+a.name;
  const pos=state.positions.filter(p=>p.symbol===a.symbol);
  const sources=(qt.sources||[]).slice().sort((x,y)=>(num(y.price)||0)-(num(x.price)||0));
  body.innerHTML='<div class="crypto-detail-head">'+icon(a.symbol,qt)+'<div><strong>'+esc(eur(qt.price))+'</strong><b class="'+tone(qt.change24h)+'">'+esc(pct(qt.change24h))+' · 24 h</b></div>'+sourceBadge(qt)+'</div>'+
   '<div class="crypto-chart-tabs" role="tablist">'+[7,30,90,365].map(n=>'<button type="button" class="'+(state.chartDays===n?'active':'')+'" data-crypto-days="'+n+'">'+(n===365?'1 año':n+' d')+'</button>').join('')+'</div>'+
   (d.chart===null?'<p class="crypto-empty">Cargando gráfico…</p>':chartSvg(d.chart))+
   '<h3 class="crypto-subhead">Contraste de fuentes</h3>'+
   (sources.length?'<table class="crypto-sources"><thead><tr><th>Fuente</th><th>Tipo</th><th>Precio</th><th>Desv.</th></tr></thead><tbody>'+sources.map(s=>{const dev=num(s.deviationPct),bad=dev!==null&&Math.abs(dev)>state.threshold;return'<tr class="'+(bad?'is-outlier':'')+'"><td>'+esc(s.source)+'</td><td>'+esc(s.kind)+'</td><td>'+esc(eur(s.price))+'</td><td>'+(dev===null?'—':(bad?'⚠ ':'')+esc(pct(dev)))+'</td></tr>'}).join('')+'</tbody></table>':'<p class="crypto-empty">Sin fuentes disponibles ahora.</p>')+
   '<p class="crypto-note">Precio mostrado: mediana de las fuentes'+(qt.status==='divergent'&&qt.agreeing>=3?', sin las que se separan más de un '+esc(state.threshold)+' %':'')+'. Ningún organismo público publica precios de criptoactivos en tiempo real; por eso se contrastan mercados (Kraken, Bitstamp, Coinbase, Bit2Me) y agregadores (CoinGecko, CoinPaprika).</p>'+
   '<div class="crypto-metrics"><span>Capitalización <b>'+esc(compact(qt.marketCap))+'</b></span><span>Volumen 24 h <b>'+esc(compact(qt.volume24h))+'</b></span><span>7 días <b class="'+tone(qt.change7d)+'">'+esc(pct(qt.change7d))+'</b></span><span>30 días <b class="'+tone(qt.change30d)+'">'+esc(pct(qt.change30d))+'</b></span><span>Rango 24 h <b>'+esc(eur(qt.low24h))+' – '+esc(eur(qt.high24h))+'</b></span><span>Máximo histórico <b>'+esc(eur(qt.ath))+'</b></span></div>'+
   (pos.length?'<h3 class="crypto-subhead">En Mi cripto</h3>'+pos.map(p=>{const v=valuation(p);return'<p class="crypto-note">'+esc(units(p.units))+' '+esc(p.symbol)+' en '+esc(p.platform)+' · '+esc(eur(v.value,{decimals:2}))+(v.pnl!==null?' · <span class="'+tone(v.pnl)+'">'+esc((v.pnl>=0?'+':'')+eur(v.pnl,{decimals:2}))+'</span>':'')+'</p>'}).join(''):'')+
   '<div class="crypto-actions"><button type="button" class="btn small" data-crypto-add="'+esc(a.symbol)+'">'+(pos.length?'✏️ Editar posición':'＋ Añadir a Mi cripto')+'</button></div>';
 }

 // ---------- Formularios ----------
 function assetOptions(selected){return state.assets.map(a=>'<option value="'+esc(a.symbol)+'"'+(a.symbol===selected?' selected':'')+'>'+esc(a.symbol+' · '+a.name)+'</option>').join('')}
 function openForm(existing=null,symbol=''){
  if(!auth()){openModal('Mi cripto','<p class="crypto-empty">Inicia sesión para guardar tus criptoactivos.</p>');return}
  const p=existing||state.positions.find(x=>x.symbol===symbol)||null,sym=p?p.symbol:symbol||'BTC';
  openModal(p?'Editar '+p.symbol:'Añadir criptoactivo','<form id="cryptoPositionForm" class="portfolio-form">'+
   '<label><span>Moneda</span><select name="symbol"'+(p?' disabled':'')+'>'+assetOptions(sym)+'</select></label>'+
   '<label><span>Unidades</span><input name="units" inputmode="decimal" required value="'+esc(p?p.units:'')+'" placeholder="0,015"></label>'+
   '<label><span>Precio medio de compra (€)</span><input name="avgPriceEur" inputmode="decimal" value="'+esc(p&&p.avg_price_eur!==null?p.avg_price_eur:'')+'" placeholder="Opcional"></label>'+
   '<label><span>Plataforma</span><input name="platform" maxlength="40" value="'+esc(p?p.platform:'Bit2Me')+'"></label>'+
   '<p class="crypto-note">Con 0 unidades la moneda queda en seguimiento.</p><p class="crypto-form-error" hidden></p>'+
   '<button type="submit" class="btn">Guardar</button></form>');
  const form=q('#cryptoPositionForm');form.dataset.symbol=sym;
 }
 const parseNum=v=>{let s=String(v??'').trim().replace(/\s|€/g,'');if(!s)return null;if(/,\d+$/.test(s)&&s.includes('.'))s=s.replace(/\./g,'');s=s.replace(',','.');const n=Number(s);return Number.isFinite(n)?n:null};
 async function submitForm(form){
  const fd=new FormData(form),err=form.querySelector('.crypto-form-error');
  const body={symbol:form.dataset.symbol||fd.get('symbol'),units:parseNum(fd.get('units')),avgPriceEur:parseNum(fd.get('avgPriceEur')),platform:String(fd.get('platform')||'Bit2Me')};
  if(fd.get('symbol'))body.symbol=fd.get('symbol');
  try{const d=await api('/api/crypto-positions',{method:'POST',body:JSON.stringify(body)});state.positions=d.positions||[];state.positionsLoaded=true;publishTotals();closeModal();state.tab='mine';render()}
  catch(error){if(err){err.hidden=false;err.textContent=error.message}}
 }

 // ---------- Importación de Bit2Me (CSV) ----------
 // El historial de Bit2Me se exporta en CSV; las columnas cambian según el tipo de informe,
 // así que se detectan por su nombre. Se calcula el saldo y el coste medio de cada moneda y se
 // enseña un resumen antes de guardar nada.
 function splitCsv(text){
  const first=text.split(/\r?\n/).find(l=>l.trim())||'',delim=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':first.includes('\t')?'\t':',';
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
   const c=text[i];
   if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else quoted=false}else cell+=c;continue}
   if(c==='"')quoted=true;else if(c===delim){row.push(cell);cell=''}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell=''}else cell+=c;
  }
  if(cell||row.length){row.push(cell);rows.push(row)}
  return rows.filter(r=>r.some(x=>String(x).trim()));
 }
 const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
 function findCol(head,patterns,exclude){return head.findIndex(h=>patterns.some(p=>p.test(h))&&!(exclude&&exclude.test(h)))}
 function parseBit2me(text){
  const rows=splitCsv(text);if(rows.length<2)throw Error('El fichero está vacío o no es un CSV.');
  const head=rows[0].map(norm),known=new Set(state.assets.map(a=>a.symbol));
  const col={
   date:findCol(head,[/fecha|date|time/]),type:findCol(head,[/^tipo|type|operacion|movimiento|concepto/]),
   fromCur:findCol(head,[/(moneda|divisa|currency|activo).*(origen|from|enviad|pagad|sold)|origen.*(moneda|divisa)|from currency|sent currency/]),
   fromAmt:findCol(head,[/(cantidad|importe|amount).*(origen|from|enviad|pagad|sold)|origen.*(cantidad|importe)|from amount|sent amount/]),
   toCur:findCol(head,[/(moneda|divisa|currency|activo).*(destino|to|recib|bought)|destino.*(moneda|divisa)|to currency|received currency/]),
   toAmt:findCol(head,[/(cantidad|importe|amount).*(destino|to|recib|bought)|destino.*(cantidad|importe)|to amount|received amount/]),
   cur:findCol(head,[/^(moneda|divisa|currency|activo|asset|cripto|crypto|symbol|simbolo)$/]),
   amt:findCol(head,[/^(cantidad|amount|unidades|units|importe cripto)$/]),
   eurTotal:findCol(head,[/(total|valor|importe|contravalor|value).*(eur|€)|eur.*(total|valor|importe)|^total$|^importe$/]),
   fee:findCol(head,[/comision|fee/])
  };
  const book=new Map(),get=s=>{if(!book.has(s))book.set(s,{units:0,cost:0,costKnown:true});return book.get(s)};
  let used=0,skipped=0;
  const buy=(sym,u,eurCost)=>{const b=get(sym);b.units+=u;if(eurCost!==null)b.cost+=eurCost;else if(u>0)b.costKnown=false};
  // Devuelve el coste que sale con lo vendido (en una permuta pasa a la moneda recibida).
  const sell=(sym,u)=>{const b=get(sym);const share=b.units>0?Math.min(1,u/b.units):1,out=b.cost*share;b.cost-=out;b.units=Math.max(0,b.units-u);return b.costKnown?out:null};
  for(const r of rows.slice(1)){
   const v=i=>i>=0?r[i]:'',type=norm(v(col.type));
   const fc=String(v(col.fromCur)).trim().toUpperCase(),fa=Math.abs(parseNum(v(col.fromAmt))||0),tc=String(v(col.toCur)).trim().toUpperCase(),ta=Math.abs(parseNum(v(col.toAmt))||0);
   if(col.fromCur>=0&&col.toCur>=0&&(fc||tc)){
    // Formato de intercambio: «paga X de A, recibe Y de B».
    const fCrypto=known.has(fc),tCrypto=known.has(tc);
    // Permuta cripto por cripto: lo recibido hereda el coste de lo entregado.
    const carried=fCrypto&&fa>0?sell(fc,fa):null;
    if(tCrypto&&ta>0)buy(tc,ta,fc==='EUR'?fa:fCrypto?carried:null);
    if(fCrypto||tCrypto)used++;else skipped++;
    continue;
   }
   const sym=String(v(col.cur)).trim().toUpperCase(),amount=parseNum(v(col.amt)),total=parseNum(v(col.eurTotal));
   if(!known.has(sym)||amount===null||amount===0){skipped++;continue}
   const out=/venta|sell|retirad|withdraw|envio|send|salida|cargo/.test(type)||amount<0;
   if(out)sell(sym,Math.abs(amount));
   else buy(sym,Math.abs(amount),/recompensa|reward|staking|earn|interes|interest|airdrop|regalo|bono|cashback/.test(type)?0:total!==null?Math.abs(total):null);
   used++;
  }
  const positions=[...book.entries()].filter(([,b])=>b.units>1e-12).map(([symbol,b])=>({symbol,units:+b.units.toFixed(10),avgPriceEur:b.costKnown&&b.units>0?+(b.cost/b.units).toFixed(8):null}));
  return{positions,used,skipped,columns:col};
 }
 function openImport(){
  if(!auth()){openModal('Importar Bit2Me','<p class="crypto-empty">Inicia sesión para importar.</p>');return}
  openModal('Importar Bit2Me','<div class="crypto-import"><p class="crypto-note">En Bit2Me: <b>Perfil › Historial › Descargar</b> (CSV). El fichero se lee en tu dispositivo; solo se guarda el saldo y el precio medio de cada moneda.</p>'+
   '<input type="file" id="cryptoImportFile" accept=".csv,text/csv,text/plain"><div id="cryptoImportPreview"></div></div>');
 }
 let pendingImport=null;
 async function previewImport(file){
  const box=q('#cryptoImportPreview');if(!box)return;
  try{
   const text=await file.text(),r=parseBit2me(text);pendingImport=r.positions;
   if(!r.positions.length){box.innerHTML='<p class="crypto-form-error">No se reconoció ningún saldo de criptoactivos ('+r.skipped+' filas sin reconocer). Mándame el fichero o una captura de sus columnas para adaptarlo.</p>';return}
   box.innerHTML='<table class="crypto-sources"><thead><tr><th>Moneda</th><th>Unidades</th><th>Precio medio</th><th>Valor ahora</th></tr></thead><tbody>'+r.positions.map(p=>{const qt=state.quotes[p.symbol];return'<tr><td>'+esc(p.symbol)+'</td><td>'+esc(units(p.units))+'</td><td>'+esc(p.avgPriceEur===null?'—':eur(p.avgPriceEur))+'</td><td>'+esc(qt&&qt.price?eur(p.units*qt.price,{decimals:2}):'—')+'</td></tr>'}).join('')+'</tbody></table>'+
    '<p class="crypto-note">'+r.used+' movimientos leídos'+(r.skipped?', '+r.skipped+' sin reconocer (depósitos o retiradas en euros, por ejemplo)':'')+'. Compara las unidades con tu saldo en Bit2Me antes de guardar: las monedas que ya no aparezcan quedarán a 0.</p>'+
    '<button type="button" class="btn" data-crypto-import-save>Guardar '+r.positions.length+' monedas</button><p class="crypto-form-error" hidden></p>';
  }catch(error){box.innerHTML='<p class="crypto-form-error">'+esc(error.message)+'</p>'}
 }
 async function saveImport(){
  if(!pendingImport)return;
  try{const d=await api('/api/crypto-positions/import',{method:'POST',body:JSON.stringify({platform:'Bit2Me',positions:pendingImport})});state.positions=d.positions||[];state.positionsLoaded=true;pendingImport=null;publishTotals();closeModal();state.tab='mine';render()}
  catch(error){const e=q('#cryptoImportPreview .crypto-form-error');if(e){e.hidden=false;e.textContent=error.message}}
 }

 // ---------- Eventos ----------
 // Se refresca con la vista abierta, con una ficha abierta o en Mi día si tienes criptoactivos.
 function visible(){return document.visibilityState==='visible'&&(q('#view-crypto')?.classList.contains('active')||!!state.detail||(q('#view-today')?.classList.contains('active')&&state.positions.some(p=>num(p.units)>0)))}
 function schedule(){
  clearInterval(state.timer);
  state.timer=setInterval(()=>{if(visible())loadQuotes()},30000);
 }
 function init(){
  document.addEventListener('click',async e=>{
   const t=e.target.closest('[data-crypto-tab],[data-crypto-detail],[data-crypto-close],[data-crypto-add],[data-crypto-import],[data-crypto-import-save],[data-crypto-edit],[data-crypto-delete],[data-crypto-days],#cryptoRefresh');
   if(!t)return;
   if(t.id==='cryptoRefresh'){loadQuotes();return}
   if(t.dataset.cryptoTab){state.tab=t.dataset.cryptoTab;if(state.tab==='mine')loadPositions();render();return}
   if(t.dataset.cryptoDays){if(state.detail)loadChart(state.detail.symbol,Number(t.dataset.cryptoDays));return}
   if(t.hasAttribute('data-crypto-close')){closeModal();return}
   if(t.hasAttribute('data-crypto-import-save')){saveImport();return}
   if(t.hasAttribute('data-crypto-import')){openImport();return}
   if(t.hasAttribute('data-crypto-add')){openForm(null,t.dataset.cryptoAdd||'');return}
   if(t.dataset.cryptoEdit){e.stopPropagation();openForm(state.positions.find(p=>p.id===t.dataset.cryptoEdit));return}
   if(t.dataset.cryptoDelete){
    e.stopPropagation();const p=state.positions.find(x=>x.id===t.dataset.cryptoDelete);
    if(!p||!confirm('¿Eliminar '+p.symbol+' de Mi cripto?'))return;
    try{const d=await api('/api/crypto-positions/'+encodeURIComponent(p.id),{method:'DELETE'});state.positions=d.positions||[];publishTotals();render()}catch(error){alert(error.message)}
    return;
   }
   if(t.dataset.cryptoDetail&&!e.target.closest('button:not([data-crypto-detail])'))openDetail(t.dataset.cryptoDetail);
  });
  document.addEventListener('error',e=>{const img=e.target;if(img&&img.classList&&img.classList.contains('crypto-icon')&&img.dataset.cryptoSym){const span=document.createElement('span');span.className='crypto-icon crypto-icon-text';span.textContent=img.dataset.cryptoSym;img.replaceWith(span)}},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.detail)closeModal();const t=e.target.closest&&e.target.closest('[data-crypto-detail][role=button]');if(t&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openDetail(t.dataset.cryptoDetail)}});
  document.addEventListener('submit',e=>{if(e.target&&e.target.id==='cryptoPositionForm'){e.preventDefault();submitForm(e.target)}});
  document.addEventListener('change',e=>{if(e.target&&e.target.id==='cryptoImportFile'&&e.target.files[0])previewImport(e.target.files[0])});
  document.addEventListener('input',e=>{if(e.target&&e.target.id==='cryptoSearch'){state.search=e.target.value;render()}});
  root.addEventListener('viewinvai:view-changed',ev=>{if(ev.detail&&ev.detail.view==='crypto'){loadQuotes();loadPositions()}else if(ev.detail&&ev.detail.view==='today'&&visible()&&(!state.updatedAt||Date.now()-Date.parse(state.updatedAt)>30000))loadQuotes()});
  root.addEventListener('viewinvai:auth-changed',()=>{state.positionsLoaded=false;loadPositions(true)});
  root.addEventListener('viewinvai:account-ready',()=>{loadPositions(true).then(()=>{if(state.positions.length&&!state.updatedAt)loadQuotes()})});
  document.addEventListener('visibilitychange',()=>{if(visible()&&(!state.updatedAt||Date.now()-Date.parse(state.updatedAt)>30000))loadQuotes()});
  schedule();
  if(q('#view-crypto')?.classList.contains('active'))loadQuotes();
 }
 root.ViewInvAICrypto={totals,refresh:loadQuotes,positions:()=>state.positions.slice(),parseBit2me,radarSignals};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
