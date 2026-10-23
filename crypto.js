/*
 * ViewInvAI · Criptoactivos
 * -------------------------
 * Mercado (precio de consenso de varias fuentes públicas), Mi cripto (posiciones en D1,
 * importación de Bit2Me), Radar cripto (señales con reglas a la vista) y Alpha (tokens de Binance
 * Alpha, solo consulta: Binance no opera en España sin licencia MiCA).
 * El precio es la mediana de las fuentes; si alguna se separa más del umbral se avisa.
 */
(root=>{
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const num=v=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null};
 const q=s=>document.querySelector(s);
 const state={assets:[],quotes:{},sources:{},threshold:1,updatedAt:null,loading:false,error:'',tab:'market',search:'',limit:60,alpha:{tokens:[],updatedAt:null,loading:false,error:'',stale:false,limit:40},positions:[],positionsLoaded:false,timer:null,detail:null,chartDays:30};

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
 // Binance Alpha: solo consulta (ver alphaTokens en crypto-server.js).
 async function loadAlpha(){
  const A=state.alpha;if(A.loading)return;A.loading=true;if(state.tab==='alpha')render();
  try{const d=await fetchJson('/api/crypto/alpha');A.tokens=Array.isArray(d.tokens)?d.tokens:[];A.updatedAt=d.updatedAt||new Date().toISOString();A.stale=!!d.stale;A.sources=d.sources||{};A.threshold=num(d.divergenceThresholdPct)||2;A.error=''}
  catch(error){A.error=error&&error.message||'Sin conexión'}
  finally{A.loading=false;render()}
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
  let costValue=0;
  for(const p of held){const v=valuation(p);if(v.value===null){complete=false;continue}value+=v.value;if(v.day!==null)day+=v.day;if(v.pnl!==null){pnl+=v.pnl;invested+=v.invested;costValue+=v.value}}
  return{value,day,pnl,invested,costValue,count:held.length,complete,updatedAt:state.updatedAt};
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
  if(qt.status==='unchecked')return'<span class="crypto-src crypto-src-single" title="Fuera de las 60 de más volumen: se contrasta al abrir la ficha">Sin contrastar</span>';
  if(qt.status==='divergent')return'<span class="crypto-src crypto-src-warn" title="'+esc((qt.outliers||[]).join(', '))+' se separan de la mediana">⚠ '+esc((num(qt.maxDeviationPct)||0).toLocaleString('es-ES',{maximumFractionDigits:2}))+' %</span>';
  return'<span class="crypto-src crypto-src-ok" title="'+esc(qt.count)+' fuentes coinciden (±'+esc(state.threshold)+' %)">✓ '+esc(qt.count)+' fuentes</span>';
 }
 function icon(sym,qt){
  const img=qt&&qt.image;
  // Solo logos de CoinGecko (permitidos por la CSP); si no cargan, se ven las siglas.
  return img&&/^https:\/\/((coin-images|assets)\.coingecko\.com|bin\.bnbstatic\.com)\//.test(img)?'<img class="crypto-icon" src="'+esc(img)+'" alt="" loading="lazy" referrerpolicy="no-referrer" data-crypto-sym="'+esc(sym.slice(0,3))+'">':'<span class="crypto-icon crypto-icon-text">'+esc(sym.slice(0,3))+'</span>';
 }
 // Formato de las listas (el mismo selector que acciones y fondos): compacto = nombre y precio;
 // detallado y cuadrícula = además contraste, 7 días y capitalización.
 const listMode=()=>document.documentElement.dataset.listView||'detailed';
 function quoteCellHtml(qt,withDot){
  const dot=withDot?'<i class="crypto-dot '+(qt.status==='ok'?'ok':qt.status==='divergent'?'warn':'off')+'" title="'+esc(qt.status==='ok'?(qt.count||0)+' fuentes coinciden':qt.status==='divergent'?'Alguna fuente se separa':'Sin contraste')+'"></i>':'';
  return '<span class="crypto-quote"><span class="crypto-price">'+esc(eur(qt.price))+'</span><b class="'+tone(qt.change24h)+'">'+dot+esc(pct(qt.change24h))+'</b></span>';
 }
 function marketCard(a){
  const qt=state.quotes[a.symbol]||{},held=state.positions.some(p=>p.symbol===a.symbol&&num(p.units)>0),compactMode=listMode()==='compact';
  return root.ViewInvAICards.render({context:'crypto',className:'crypto-card',title:a.symbol,subtitle:a.name+(held?' · en Mi cripto':''),
   rank:qt.rank?String(qt.rank):'',leadingHtml:icon(a.symbol,qt),
   openAttrs:' data-crypto-detail="'+esc(a.symbol)+'" role="button" tabindex="0"',
   cells:compactMode?[{label:'',html:quoteCellHtml(qt,true)}]:[{label:'Precio · 24 h',html:quoteCellHtml(qt,false)},
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
  const rows=filtered(),shown=state.search.trim()?rows:rows.slice(0,state.limit);
  return sourcesHealthHtml()+(rows.length?'<div class="crypto-list">'+shown.map(marketCard).join('')+'</div>'+
   (shown.length<rows.length?'<div class="crypto-actions crypto-more"><button type="button" class="btn small ghost" data-crypto-more>Ver más ('+(rows.length-shown.length)+')</button></div>':''):'<p class="crypto-empty">Ninguna moneda coincide con la búsqueda.</p>')+
   '<p class="crypto-note">'+state.assets.length+' criptoactivos que cotizan en euros en Kraken, Bitstamp o Bit2Me.</p>';
 }
 function myHtml(){
  if(!auth())return'<div class="crypto-empty"><p>Inicia sesión para guardar tus criptoactivos de Bit2Me u otra plataforma. Se guardan solo en tu cuenta.</p></div>';
  const t=totals(),held=state.positions.filter(p=>num(p.units)>0),watch=state.positions.filter(p=>!(num(p.units)>0));
  const head='<div class="crypto-summary"><div><small>Valor</small><strong>'+esc(eur(t.value,{decimals:2}))+'</strong></div><div><small>24 h</small><strong class="'+tone(t.day)+'">'+esc((t.day>=0?'+':'')+eur(t.day,{decimals:2}))+'</strong></div><div><small>Ganancia'+(t.invested>=1?' · '+esc(pct(t.pnl/t.invested*100)):'')+'</small><strong class="'+tone(t.pnl)+'">'+esc(t.invested>=1?(t.pnl>=0?'+':'')+eur(t.pnl,{decimals:2}):'—')+'</strong>'+(t.invested>=1&&t.costValue<t.value*0.95?'<small class="crypto-cost-note" title="Solo se calcula sobre las monedas con precio medio conocido">sobre '+esc(eur(t.costValue,{decimals:2}))+' con coste</small>':t.invested<1&&t.value>0?'<small class="crypto-cost-note">sin precio medio</small>':'')+'</div></div>'+
   '<div class="crypto-actions"><button type="button" class="btn small" data-crypto-add>＋ Añadir</button><button type="button" class="btn small ghost" data-crypto-import>⇪ Importar extracto</button></div>';
  const card=p=>{
   const v=valuation(p);
   // Compacta: valor y P&L en una línea; editar y borrar quedan en la ficha (botón 💼) y en la detallada.
   if(listMode()==='compact')return root.ViewInvAICards.render({context:'crypto-portfolio',className:'crypto-card',title:p.symbol,subtitle:units(p.units)+' · '+(p.platform||'Bit2Me'),leadingHtml:icon(p.symbol,v.quote),
    openAttrs:' data-crypto-detail="'+esc(p.symbol)+'" role="button" tabindex="0"',
    cells:[{label:'',html:'<span class="crypto-quote"><span class="crypto-price">'+esc(eur(v.value,{decimals:2}))+'</span><b class="'+tone(v.pnl)+'">'+esc(v.pnl===null?(v.quote?pct(v.quote.change24h)+' · 24 h':'—'):(v.pnl>=0?'+':'')+eur(v.pnl,{decimals:2})+(v.pnlPct===null?'':' · '+pct(v.pnlPct)))+'</b></span>'}]});
   return root.ViewInvAICards.render({context:'crypto-portfolio',className:'crypto-card',title:p.symbol,subtitle:units(p.units)+' · '+(p.platform||'Bit2Me'),leadingHtml:icon(p.symbol,v.quote),
    openAttrs:' data-crypto-detail="'+esc(p.symbol)+'" role="button" tabindex="0"',
    cells:[{label:'Valor',html:'<span class="crypto-price">'+esc(eur(v.value,{decimals:2}))+'</span>'+(v.quote?'<b class="'+tone(v.quote.change24h)+'">'+esc(pct(v.quote.change24h))+'</b>':'')},
     {label:'P&L',value:v.pnl===null?'—':(v.pnl>=0?'+':'')+eur(v.pnl,{decimals:2})+(v.pnlPct===null?'':' · '+pct(v.pnlPct)),tone:tone(v.pnl)},
     {label:'Precio medio',value:eur(p.avg_price_eur)},{label:'Contraste',html:sourceBadge(v.quote)}],
    rowActionsHtml:'<button type="button" class="btn small ghost crypto-icon-btn" data-crypto-edit="'+esc(p.id)+'" aria-label="Editar '+esc(p.symbol)+'" title="Editar">✏️</button><button type="button" class="btn small ghost crypto-icon-btn" data-crypto-delete="'+esc(p.id)+'" aria-label="Eliminar '+esc(p.symbol)+'" title="Eliminar">🗑</button>'});
  };
  return head+(held.length?'<div class="crypto-list">'+held.map(card).join('')+'</div>':'<p class="crypto-empty">Aún no tienes criptoactivos. Añádelos a mano o importa el extracto de tu plataforma.</p>')+
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
   cells:listMode()==='compact'?[{label:'',html:quoteCellHtml(qt,false)}]:[{label:'Precio · 24 h',html:'<span class="crypto-price">'+esc(eur(qt.price))+'</span><b class="'+tone(qt.change24h)+'">'+esc(pct(qt.change24h))+'</b>'},
    {label:'Señales',html:'<span class="crypto-signals">'+signals.map(s=>'<em class="crypto-signal '+esc(s.tone)+'" title="'+esc(s.why)+'">'+esc(s.label)+'</em>').join('')+'</span>'}],
   metaHtml:'<span class="crypto-why">'+signals.map(s=>esc(s.why)).join(' · ')+'</span>'})).join('')+'</div>';
 }
 // Alpha: tokens en cadena que destaca Binance antes de listarlos. Binance no opera con residentes
 // en España desde julio de 2026 (sin licencia MiCA): se muestran como radar temprano, sin enlaces
 // de compra, y se indica si la moneda ya se puede comprar en euros en un exchange autorizado.
 function whereBadge(t){
  return t.euroMarket?'<span class="crypto-where ok" title="Cotiza en euros en Kraken, Bitstamp, Bit2Me o Coinbase (con licencia MiCA)">€ · MiCA</span>'
   :'<span class="crypto-where dex" title="Solo en cadena (DEX): no está en un exchange autorizado en España">Solo en cadena</span>';
 }
 function alphaFiltered(){
  const s=state.search.trim().toLowerCase(),A=state.alpha;
  return A.tokens.filter(t=>!s||t.symbol.toLowerCase().includes(s)||String(t.name).toLowerCase().includes(s)||String(t.chain).toLowerCase().includes(s));
 }
 function alphaCard(t){
  const qt=Object.assign({image:t.icon},t);
  return root.ViewInvAICards.render({context:'crypto-alpha',className:'crypto-card crypto-card-alpha',title:t.symbol,subtitle:t.name+' · '+t.chain,leadingHtml:icon(t.symbol,qt),
   openAttrs:' data-crypto-detail="'+esc(t.id)+'" role="button" tabindex="0"',
   cells:listMode()==='compact'?[{label:'',html:quoteCellHtml(qt,true)}]:[{label:'Precio · 24 h',html:quoteCellHtml(qt,false)},
    {label:'Contraste',html:sourceBadge(qt)},{label:'Volumen 24 h',value:compact(t.volume24h)},{label:'Dónde',html:whereBadge(t)}]});
 }
 function alphaHtml(){
  const A=state.alpha;
  const intro='<p class="crypto-note crypto-alpha-note"><b>Solo consulta.</b> Tokens que Binance destaca antes de listarlos. Binance no tiene licencia MiCA y no admite compras desde España: «€ · MiCA» indica que ya cotiza en euros en Kraken, Bitstamp, Bit2Me o Coinbase.</p>';
  if(!A.tokens.length)return intro+(A.error?'<p class="crypto-empty">Binance Alpha no responde ahora: '+esc(A.error)+'</p>':'<p class="crypto-empty">Cargando tokens Alpha…</p>');
  const rows=alphaFiltered(),shown=state.search.trim()?rows:rows.slice(0,A.limit);
  const health=Object.values(A.sources||{}).length?'<div class="crypto-health" aria-label="Estado de las fuentes"><span class="'+(A.stale?'off':'ok')+'">'+(A.stale?'○':'●')+' Binance Alpha</span>'+Object.values(A.sources).map(h=>{const ok=h.ok>0;return'<span class="'+(ok?'ok':'off')+'" title="'+esc(ok?h.ok+' consultas correctas':h.error||'Sin respuesta')+'">'+(ok?'●':'○')+' '+esc(h.label)+'</span>'}).join('')+'</div>':'';
  return intro+health+(A.stale?'<p class="crypto-note">Binance Alpha no responde: lista guardada, precios contrastados ahora con DexScreener.</p>':'')+
   (rows.length?'<div class="crypto-list">'+shown.map(alphaCard).join('')+'</div>'+
   (shown.length<rows.length?'<div class="crypto-actions crypto-more"><button type="button" class="btn small ghost" data-alpha-more>Ver más ('+(rows.length-shown.length)+')</button></div>':''):'<p class="crypto-empty">Ningún token coincide con la búsqueda.</p>')+
   '<p class="crypto-note">'+A.tokens.length+' tokens por volumen. Precio de Binance Alpha contrastado con DexScreener (par de más liquidez) y GeckoTerminal en las 60 de más volumen; el resto, al abrir su ficha. Pasado a € con el precio de USDT en los mercados en euros.</p>';
 }
 // Carteras › Cripto: la misma vista «Mi cripto», dentro de Carteras.
 function renderPortfolioPanel(){
  const el=q('#portfolioCryptoApp');if(!el||el.hidden)return;
  el.innerHTML='<div class="crypto-portfolio">'+myHtml()+'</div>';
 }
 async function showPortfolio(){
  renderPortfolioPanel();
  await Promise.all([loadPositions(),state.updatedAt&&Date.now()-Date.parse(state.updatedAt)<30000?null:loadQuotes()]);
  renderPortfolioPanel();
 }
 function render(){
  renderPortfolioPanel();
  const body=q('#cryptoBody');if(!body)return;
  document.querySelectorAll('[data-crypto-tab]').forEach(b=>{const on=b.dataset.cryptoTab===state.tab;b.classList.toggle('active',on);b.setAttribute('aria-selected',on?'true':'false')});
  const stamp=q('#cryptoUpdated'),at=state.tab==='alpha'?state.alpha.updatedAt:state.updatedAt,busy=state.tab==='alpha'?state.alpha.loading:state.loading;
  if(stamp)stamp.textContent=at?'Actualizado '+ageText(at):busy?'Actualizando…':'';
  const search=q('#cryptoSearch');if(search)search.hidden=state.tab!=='market'&&state.tab!=='alpha';
  body.innerHTML=state.tab==='mine'?myHtml():state.tab==='radar'?radarHtml():state.tab==='alpha'?alphaHtml():marketHtml();
  if(state.detail&&!state.detail.alpha){const fresh=state.quotes[state.detail.symbol];if(fresh&&!(state.detail.quote&&state.detail.quote.sources&&state.detail.quote.sources.length>(fresh.sources||[]).length))state.detail.quote=Object.assign({},state.detail.quote||{},fresh);renderDetail()}
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
  q('#cryptoModal')?.classList.remove('open');q('#cryptoModal')?.setAttribute('aria-hidden','true');
  q('#cryptoModalBackdrop')?.classList.remove('open');q('#cryptoModalBackdrop')?.setAttribute('aria-hidden','true');
  document.body.classList.remove('app-modal-open');
 }
 function chartSvg(points,h=170){
  if(!points||points.length<2)return'<p class="crypto-empty">Gráfico no disponible.</p>';
  const w=360,xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),dy=(y1-y0)||1;
  const pts=points.map(p=>[((p[0]-x0)/((x1-x0)||1)*w),(h-(p[1]-y0)/dy*(h-12)-6)]);
  const d=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  const up=ys[ys.length-1]>=ys[0],first=ys[0],last=ys[ys.length-1];
  return'<svg class="crypto-chart '+(up?'positive':'negative')+'" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" role="img" aria-label="Evolución del precio"><path class="area" d="'+d+' L'+w+' '+h+' L0 '+h+' Z"/><path class="line" d="'+d+'"/></svg>'+
   '<div class="crypto-chart-range"><span>Mín. '+esc(eur(y0))+'</span><b class="'+tone(last-first)+'">'+esc(pct((last/first-1)*100))+' en el periodo</b><span>Máx. '+esc(eur(y1))+'</span></div>';
 }
 // ---------- Ficha a pantalla completa (como la de una acción) ----------
 // Se abre dentro de la vista Cripto, con su propia entrada de historial: el gesto o botón
 // «atrás» de Android (y el del navegador) vuelve a la lista donde estabas.
 function profileBox(){
  let box=q('#cryptoProfile');
  if(!box){box=document.createElement('section');box.id='cryptoProfile';box.className='crypto-profile view';box.hidden=true;(q('main.main')||q('main')||document.body).appendChild(box)}
  return box;
 }
 const isAlphaId=s=>/^ALPHA_\d{1,6}$/.test(String(s||''));
 function nativeApp(){return document.documentElement.dataset.nativeApp==='1'}
 async function openDetail(sym){
  const scrollY=window.scrollY||0;
  const alpha=isAlphaId(sym);
  state.detail={symbol:sym,alpha,quote:alpha?state.alpha.tokens.find(t=>t.id===sym)||null:state.quotes[sym]||null,chart:null,tab:'general',scrollY};
  // Como la ficha de una acción: una página encima de la vista actual (Cripto, Carteras, Mi día…);
  // «atrás» vuelve exactamente a donde estabas.
  document.body.classList.add('crypto-detail-open');
  const box=profileBox();box.hidden=false;
  try{const st=history.state||{};history.pushState(Object.assign({},st,{cryptoProfile:sym,__viewinvaiDepth:(Number(st.__viewinvaiDepth)||0)+1}),'',location.href)}catch(_){}
  renderDetail();window.scrollTo({top:0,behavior:'auto'});
  if(alpha){
   try{const d=await fetchJson('/api/crypto/alpha?ids='+encodeURIComponent(sym));const t=(d.tokens||[])[0];if(t&&state.detail&&state.detail.symbol===sym){state.detail.quote=t;renderDetail()}}catch(_){}
   loadChart(sym,state.alphaDays||7);return;
  }
  try{const d=await fetchJson('/api/crypto/quotes?symbols='+encodeURIComponent(sym)+'&detail=1');if(state.detail&&state.detail.symbol===sym){state.detail.quote=(d.quotes||{})[sym]||state.detail.quote;renderDetail()}}catch(_){}
  loadChart(sym,state.chartDays);
 }
 // Cierra la ficha sin tocar el historial (lo usan «atrás» y el cambio de vista).
 function closeDetail(){
  if(!state.detail)return false;
  const y=state.detail.scrollY||0;state.detail=null;
  document.body.classList.remove('crypto-detail-open');
  const box=q('#cryptoProfile');if(box){box.hidden=true;box.innerHTML=''}
  render();requestAnimationFrame(()=>window.scrollTo({top:y,behavior:'auto'}));
  return true;
 }
 function backFromDetail(){if(history.state&&history.state.cryptoProfile)history.back();else closeDetail()}
 async function loadChart(sym,days){
  const alpha=isAlphaId(sym);
  if(alpha)state.alphaDays=days;else state.chartDays=days;if(state.detail)state.detail.chart=null;renderDetail();
  try{const d=await fetchJson(alpha?'/api/crypto/alpha/chart?id='+encodeURIComponent(sym)+'&days='+days:'/api/crypto/chart?symbol='+encodeURIComponent(sym)+'&days='+days);if(state.detail&&state.detail.symbol===sym){state.detail.chart=d.points||[];state.detail.chartSource=d.source||'';renderDetail()}}
  catch(_){if(state.detail){state.detail.chart=[];renderDetail()}}
 }
 const row=(label,value,sub='',cls='')=>'<div class="profile-stat-row"><div><span>'+esc(label)+'</span>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</div><strong class="'+esc(cls)+'">'+value+'</strong></div>';
 const section=(title,meta,body)=>'<section class="profile-section profile-stats-section crypto-profile-section"><div class="profile-section-head"><h3>'+esc(title)+'</h3>'+(meta?'<span>'+esc(meta)+'</span>':'')+'</div><div class="profile-stat-list">'+body+'</div></section>';
 function shortAddr(a){a=String(a||'');return a.length>14?a.slice(0,6)+'…'+a.slice(-4):a}
 function renderAlphaDetail(d,box){
  const t=d.quote||{symbol:d.symbol,name:d.symbol},thr=state.alpha.threshold||2;
  const sources=(t.sources||[]);
  const tabs=[['general','General'],['chart','Gráfico'],['sources','Fuentes']];
  const head='<header class="crypto-profile-head">'+
   (nativeApp()?'':'<button type="button" class="btn ghost small crypto-profile-back" data-crypto-back>← Volver</button>')+
   '<div class="crypto-profile-id">'+icon(t.symbol||'?',{image:t.icon})+'<div><small>BINANCE ALPHA · '+esc(String(t.chain||'').toUpperCase())+'</small><strong>'+esc(t.name||t.symbol)+'</strong><span>'+esc(t.symbol||'')+'</span></div></div>'+
   '<div class="crypto-profile-quote"><strong>'+esc(eur(t.price))+'</strong><b class="'+tone(t.change24h)+'">'+esc(pct(t.change24h))+' · 24 h</b>'+sourceBadge(t)+'</div>'+
   '<nav class="compact-tabs crypto-profile-tabs" aria-label="Secciones de la ficha">'+tabs.map(([k,l])=>'<button type="button" class="tab'+(d.tab===k?' active':'')+'" data-crypto-profile-tab="'+k+'">'+l+'</button>').join('')+'</nav>'+
   '</header>';
  let body;
  const days=state.alphaDays||7;
  if(d.tab==='chart'){
   body='<section class="profile-section crypto-profile-section"><div class="profile-section-head"><h3>Evolución del precio</h3><span>'+esc(d.chartSource||'GeckoTerminal')+'</span></div>'+
    '<nav class="compact-tabs crypto-range-tabs">'+[1,7,30,90].map(n=>'<button type="button" class="tab'+(days===n?' active':'')+'" data-crypto-days="'+n+'">'+(n===1?'24 h':n+' d')+'</button>').join('')+'</nav>'+
    '<div class="crypto-chart-wrap">'+(d.chart===null?'<p class="crypto-empty">Cargando gráfico…</p>':chartSvg(d.chart,200))+'</div>'+
    '<p class="crypto-note">Velas del pool con más liquidez, en USD pasadas a € con el cambio actual.</p></section>';
  }else if(d.tab==='sources'){
   body='<section class="profile-section crypto-profile-section"><div class="profile-section-head"><h3>Contraste de fuentes</h3><span>Desviación sobre Binance Alpha</span></div>'+
    (sources.length?'<table class="crypto-sources"><thead><tr><th>Fuente</th><th>Tipo</th><th>Precio</th><th>Desv.</th></tr></thead><tbody>'+sources.map(s=>{const dev=num(s.deviationPct),bad=dev!==null&&Math.abs(dev)>thr;return'<tr class="'+(bad?'is-outlier':'')+'"><td>'+esc(s.source)+(s.dex?' <small>'+esc(s.dex)+'</small>':'')+'</td><td>'+esc(s.kind)+'</td><td>'+esc(eur(s.price))+'</td><td>'+(s.source==='Binance Alpha'?'ref.':dev===null?'—':(bad?'⚠ ':'')+esc(pct(dev)))+'</td></tr>'}).join('')+'</tbody></table>':'<p class="crypto-empty">Contrastando fuentes…</p>')+
    '<p class="crypto-note">Se contrasta con el par de DexScreener con más liquidez (mínimo 20.000 $) y con GeckoTerminal. Se avisa si alguna se separa más de un '+esc(thr)+' %: en tokens poco líquidos el precio puede moverse mucho entre mercados.</p></section>';
  }else{
   const range=num(t.low24h)!==null&&num(t.high24h)!==null?esc(eur(t.low24h))+' – '+esc(eur(t.high24h)):'—';
   const listed=num(t.listingTime)?new Date(t.listingTime).toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'}):'—';
   body='<p class="crypto-note crypto-alpha-note"><b>Solo consulta.</b> Binance no opera con residentes en España desde julio de 2026 (sin licencia MiCA). '+(t.euroMarket?'Esta moneda ya cotiza en euros en un exchange autorizado del catálogo: búscala en la pestaña Mercado.':'Esta moneda solo existe en cadena (DEX): no la ofrece ningún exchange autorizado del catálogo. Comprar en un DEX conlleva riesgo de liquidez, de contrato falso y de pérdida total.')+'</p>'+
    section('Resumen de mercado','Lo esencial primero',
     row('Precio',esc(eur(t.price)),t.count?t.count+' fuentes':'')+
     row('Variación 24 h',esc(pct(t.change24h)),'',tone(t.change24h))+
     row('Rango 24 h',range,'Mínimo – máximo')+
     row('Volumen 24 h',esc(compact(t.volume24h)),num(t.trades24h)?Math.round(t.trades24h).toLocaleString('es-ES')+' operaciones':'')+
     row('Capitalización',esc(compact(t.marketCap)),num(t.fdv)?'Totalmente diluida '+compact(t.fdv):'')+
     row('Liquidez en cadena',esc(compact(t.liquidity)),'Binance Alpha'))+
    section('Token','Datos en cadena',
     row('Dónde comprar en España',whereBadge(t),t.euroMarket?'Kraken, Bitstamp, Bit2Me o Coinbase':'No disponible en exchanges MiCA')+
     row('Red',esc(t.chain||'—'))+
     row('Contrato','<span translate="no" title="'+esc(t.contract)+'">'+esc(shortAddr(t.contract))+'</span>','Compruébalo siempre: hay copias falsas')+
     row('Titulares',num(t.holders)?esc(Math.round(t.holders).toLocaleString('es-ES')):'—')+
     row('En Alpha desde',esc(listed)))+
    (d.chart&&d.chart.length>1?'<section class="profile-section crypto-profile-section"><div class="profile-section-head"><h3>Últimos '+esc(days===1?'24 h':days+' días')+'</h3><span>'+esc(d.chartSource||'')+'</span></div><div class="crypto-chart-wrap">'+chartSvg(d.chart,120)+'</div></section>':'');
  }
  box.innerHTML=head+'<div class="crypto-profile-body">'+body+'</div>';
 }
 function renderDetail(){
  const d=state.detail,box=q('#cryptoProfile');if(!d||!box)return;
  if(d.alpha)return renderAlphaDetail(d,box);
  const a=state.assets.find(x=>x.symbol===d.symbol)||{symbol:d.symbol,name:(d.quote&&d.quote.name)||d.symbol},qt=d.quote||{};
  const pos=state.positions.filter(p=>p.symbol===a.symbol),held=pos.filter(p=>num(p.units)>0);
  const sources=(qt.sources||[]).slice().sort((x,y)=>(num(y.price)||0)-(num(x.price)||0));
  const tabs=[['general','General'],['chart','Gráfico'],['sources','Fuentes']];
  const head='<header class="crypto-profile-head">'+
   (nativeApp()?'':'<button type="button" class="btn ghost small crypto-profile-back" data-crypto-back>← Volver</button>')+
   '<div class="crypto-profile-id">'+icon(a.symbol,qt)+'<div><small>CRIPTOACTIVO · EUR</small><strong>'+esc(a.name)+'</strong><span>'+esc(a.symbol)+(qt.rank?' · #'+esc(qt.rank):'')+'</span></div></div>'+
   '<div class="crypto-profile-quote"><strong>'+esc(eur(qt.price))+'</strong><b class="'+tone(qt.change24h)+'">'+esc(pct(qt.change24h))+' · 24 h</b>'+sourceBadge(qt)+
   '<button type="button" class="profile-add-portfolio crypto-profile-wallet'+(held.length?' is-managed':'')+'" data-crypto-add="'+esc(a.symbol)+'" title="'+(pos.length?'Editar en Mi cripto':'Añadir a Mi cripto')+'" aria-label="'+(pos.length?'Editar en Mi cripto':'Añadir a Mi cripto')+'"><span aria-hidden="true">💼</span></button></div>'+
   '<nav class="compact-tabs crypto-profile-tabs" aria-label="Secciones de la ficha">'+tabs.map(([k,l])=>'<button type="button" class="tab'+(d.tab===k?' active':'')+'" data-crypto-profile-tab="'+k+'">'+l+'</button>').join('')+'</nav>'+
  '</header>';
  let body='';
  if(d.tab==='chart'){
   body='<section class="profile-section crypto-profile-section"><div class="profile-section-head"><h3>Evolución del precio</h3><span>'+esc(d.chartSource||'Kraken')+'</span></div>'+
    '<nav class="compact-tabs crypto-range-tabs">'+[7,30,90,365].map(n=>'<button type="button" class="tab'+(state.chartDays===n?' active':'')+'" data-crypto-days="'+n+'">'+(n===365?'1 año':n+' d')+'</button>').join('')+'</nav>'+
    '<div class="crypto-chart-wrap">'+(d.chart===null?'<p class="crypto-empty">Cargando gráfico…</p>':chartSvg(d.chart,200))+'</div></section>';
  }else if(d.tab==='sources'){
   body='<section class="profile-section crypto-profile-section"><div class="profile-section-head"><h3>Contraste de fuentes</h3><span>Desviación sobre la mediana</span></div>'+
    (sources.length?'<table class="crypto-sources"><thead><tr><th>Fuente</th><th>Tipo</th><th>Precio</th><th>Desv.</th></tr></thead><tbody>'+sources.map(s=>{const dev=num(s.deviationPct),bad=dev!==null&&Math.abs(dev)>state.threshold;return'<tr class="'+(bad?'is-outlier':'')+'"><td>'+esc(s.source)+'</td><td>'+esc(s.kind)+'</td><td>'+esc(eur(s.price))+'</td><td>'+(dev===null?'—':(bad?'⚠ ':'')+esc(pct(dev)))+'</td></tr>'}).join('')+'</tbody></table>':'<p class="crypto-empty">Contrastando fuentes…</p>')+
    '<p class="crypto-note">Precio mostrado: mediana de las fuentes'+(qt.status==='divergent'&&qt.agreeing>=3?', sin las que se separan más de un '+esc(state.threshold)+' %':'')+'. Se usa el punto medio entre compra y venta y no entran mercados sin volumen. Ningún organismo público publica precios de criptoactivos en tiempo real: por eso se contrastan mercados (Kraken, Bitstamp, Coinbase, Bit2Me) y agregadores (CoinGecko, CoinPaprika).</p></section>';
  }else{
   const range=num(qt.low24h)!==null&&num(qt.high24h)!==null?esc(eur(qt.low24h))+' – '+esc(eur(qt.high24h)):'—';
   const top=num(qt.ath)!==null?['Máximo histórico',esc(eur(qt.ath)),'CoinGecko']:num(qt.high2y)!==null?['Máximo 2 años',esc(eur(qt.high2y)),'Velas diarias de Kraken']:['Máximo histórico','—',''];
   body=section('Resumen de mercado','Lo esencial primero',
     row('Precio de consenso',esc(eur(qt.price)),qt.count?qt.count+' fuentes':'')+
     row('Variación 24 h',esc(pct(qt.change24h)),'',tone(qt.change24h))+
     row('Rango 24 h',range,'Mínimo – máximo')+
     row('Capitalización',esc(compact(qt.marketCap)),qt.rank?'Puesto #'+qt.rank:'')+
     row('Volumen 24 h',esc(compact(qt.volume24h)),'Negociado en 24 h')+
     row('Contraste',sourceBadge(qt),qt.status==='divergent'?'Alguna fuente se separa':'Fuentes independientes'))+
    section('Rendimiento','Frente al precio actual',
     row('7 días',esc(pct(qt.change7d)),'',tone(qt.change7d))+
     row('30 días',esc(pct(qt.change30d)),'',tone(qt.change30d))+
     row(top[0],top[1],top[2]))+
    (d.chart&&d.chart.length>1?'<section class="profile-section crypto-profile-section"><div class="profile-section-head"><h3>Últimos '+esc(state.chartDays===365?'12 meses':state.chartDays+' días')+'</h3><span>'+esc(d.chartSource||'')+'</span></div><div class="crypto-chart-wrap">'+chartSvg(d.chart,120)+'</div></section>':'')+
    (pos.length?section('En Mi cripto',pos.length+' '+(pos.length===1?'posición':'posiciones'),pos.map(p=>{const v=valuation(p);return row(p.platform||'—',esc(eur(v.value,{decimals:2})),units(p.units)+' '+p.symbol+(num(p.avg_price_eur)!==null?' · medio '+eur(p.avg_price_eur):''))+(v.pnl!==null?row('Ganancia',esc((v.pnl>=0?'+':'')+eur(v.pnl,{decimals:2})+(v.pnlPct!==null?' · '+pct(v.pnlPct):'')),'',tone(v.pnl)):'')}).join('')):'')+
    '<div class="crypto-actions crypto-profile-cta"><button type="button" class="btn small" data-crypto-add="'+esc(a.symbol)+'">'+(pos.length?'Editar en Mi cripto':'＋ Añadir a Mi cripto')+'</button></div>';
  }
  box.innerHTML=head+'<div class="crypto-profile-body">'+body+'</div>';
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

 // ---------- Importación de extractos (CSV y Excel) ----------
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
 // ---------- Excel (.xlsx) ----------
 // Bit2Me descarga los movimientos en Excel. Un .xlsx es un ZIP con XML: se descomprime en el
 // propio dispositivo (DecompressionStream) y se lee la primera hoja. Sin librerías externas.
 async function unzipEntries(buf,wanted){
  const v=new DataView(buf),u8=new Uint8Array(buf),dec=new TextDecoder();
  let eocd=-1;for(let i=buf.byteLength-22;i>=Math.max(0,buf.byteLength-65557);i--)if(v.getUint32(i,true)===0x06054b50){eocd=i;break}
  if(eocd<0)throw Error('El fichero no es un Excel (.xlsx) válido.');
  const count=v.getUint16(eocd+10,true);let p=v.getUint32(eocd+16,true);const out=new Map();
  for(let k=0;k<count&&v.getUint32(p,true)===0x02014b50;k++){
   const method=v.getUint16(p+10,true),size=v.getUint32(p+20,true),nameLen=v.getUint16(p+28,true),extra=v.getUint16(p+30,true),comment=v.getUint16(p+32,true),local=v.getUint32(p+42,true);
   const name=dec.decode(u8.subarray(p+46,p+46+nameLen));p+=46+nameLen+extra+comment;
   if(!wanted(name))continue;
   const start=local+30+v.getUint16(local+26,true)+v.getUint16(local+28,true),data=u8.subarray(start,start+size);
   if(method===0){out.set(name,dec.decode(data));continue}
   if(method!==8)continue;
   if(typeof DecompressionStream!=='function')throw Error('Este navegador no puede abrir Excel: exporta el extracto en CSV.');
   const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
   out.set(name,await new Response(stream).text());
  }
  return out;
 }
 async function xlsxRows(buf){
  const files=await unzipEntries(buf,n=>/^xl\/(sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(n));
  const xml=t=>new DOMParser().parseFromString(t,'application/xml');
  const shared=files.has('xl/sharedStrings.xml')?[...xml(files.get('xl/sharedStrings.xml')).getElementsByTagName('si')].map(si=>[...si.getElementsByTagName('t')].map(t=>t.textContent).join('')):[];
  // Primera hoja según el libro (si no, la primera que haya).
  let sheet='';
  try{
   const wb=xml(files.get('xl/workbook.xml')),first=wb.getElementsByTagName('sheet')[0];
   const rid=first&&(first.getAttribute('r:id')||first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'));
   const rel=[...xml(files.get('xl/_rels/workbook.xml.rels')).getElementsByTagName('Relationship')].find(r=>r.getAttribute('Id')===rid);
   if(rel)sheet='xl/'+rel.getAttribute('Target').replace(/^\/?xl\//,'').replace(/^\//,'');
  }catch(_){}
  if(!files.has(sheet))sheet=[...files.keys()].filter(n=>/^xl\/worksheets\//.test(n)).sort()[0];
  if(!sheet)throw Error('El Excel no tiene ninguna hoja.');
  const colIndex=ref=>{const m=String(ref||'').match(/^([A-Z]+)/);let n=0;if(m)for(const ch of m[1])n=n*26+ch.charCodeAt(0)-64;return n-1};
  const rows=[];
  for(const r of xml(files.get(sheet)).getElementsByTagName('row')){
   const row=[];
   for(const c of r.getElementsByTagName('c')){
    const t=c.getAttribute('t'),vEl=c.getElementsByTagName('v')[0],raw=vEl?vEl.textContent:'';
    const val=t==='s'?(shared[Number(raw)]??''):t==='inlineStr'?[...c.getElementsByTagName('t')].map(x=>x.textContent).join(''):raw;
    let i=colIndex(c.getAttribute('r'));if(i<0)i=row.length;
    while(row.length<i)row.push('');row[i]=val;
   }
   if(row.some(x=>String(x).trim()))rows.push(row);
  }
  return rows;
 }
 // Fecha de una fila: texto (dd/mm/aaaa hh:mm, ISO…) o número de serie de Excel.
 function rowTime(v){
  const s=String(v??'').trim();if(!s)return null;
  if(/^\d{4,5}(\.\d+)?$/.test(s)){const n=Number(s);if(n>20000&&n<80000)return(n-25569)*86400000}
  let m=s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m){const y=Number(m[3].length===2?'20'+m[3]:m[3]);return Date.UTC(y,Number(m[2])-1,Number(m[1]),Number(m[4]||0),Number(m[5]||0),Number(m[6]||0))}
  const t=Date.parse(s);return Number.isFinite(t)?t:null;
 }
 const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
 function findCol(head,patterns,exclude){return head.findIndex(h=>patterns.some(p=>p.test(h))&&!(exclude&&exclude.test(h)))}
 // Plataformas del extracto: dónde se descarga y cómo se lee. El fichero se procesa en el
 // dispositivo; solo se guardan el saldo y el precio medio de cada moneda.
 const IMPORT_PLATFORMS=[
  {id:'bit2me',name:'Bit2Me',help:'En Bit2Me: <b>Wallet › Historial › Descargar</b>, un Excel (.xlsx) por año. Selecciónalos todos a la vez.'},
  {id:'coinbase',name:'Coinbase',help:'En Coinbase: <b>Perfil › Extractos › Generar informe › Historial de transacciones</b> (CSV).'},
  {id:'kraken',name:'Kraken',help:'En Kraken: <b>Historial › Exportar › Libro mayor (Ledgers)</b> (CSV).'},
  {id:'binance',name:'Binance',help:'En Binance: <b>Órdenes › Historial de operaciones › Exportar</b> (CSV).'},
  {id:'otra',name:'Otra plataforma',help:'Cualquier Excel (.xlsx) o CSV con columnas de moneda, cantidad y, si puede ser, importe en euros.'}
 ];
 // Códigos de Kraken (XXBT, XETH, XXDG, ZEUR, ETH2.S…) a símbolos normales.
 function krakenAsset(code){
  let c=String(code||'').trim().toUpperCase().replace(/\.(S|M|F|P|B)$/,'').replace(/^ETH2$/,'ETH');
  if(c.length===4&&/^[XZ]/.test(c)&&!/^(XTZ|ZEC|ZRX|XLM|XRP|XMR|XDC)$/.test(c))c=c.slice(1);
  return {XBT:'BTC',XDG:'DOGE'}[c]||c;
 }
 function newBook(){
  const book=new Map(),get=s=>{if(!book.has(s))book.set(s,{units:0,cost:0,costKnown:true});return book.get(s)};
  return{book,
   buy:(sym,u,eurCost)=>{const b=get(sym);b.units+=u;if(eurCost!==null&&eurCost!==undefined)b.cost+=eurCost;else if(u>0)b.costKnown=false},
   // Devuelve el coste que sale con lo vendido (en una permuta pasa a la moneda recibida).
   sell:(sym,u)=>{const b=get(sym);const share=b.units>0?Math.min(1,u/b.units):1,out=b.cost*share;b.cost-=out;b.units=Math.max(0,b.units-u);return b.costKnown?out:null},
   positions:()=>[...book.entries()].filter(([,b])=>b.units>1e-12).map(([symbol,b])=>({symbol,units:+b.units.toFixed(10),avgPriceEur:b.costKnown&&b.units>0?+(b.cost/b.units).toFixed(8):null}))};
 }
 const REWARD_RE=/recompensa|reward|staking|earn|interes|interest|airdrop|regalo|bono|cashback|income|learning/;
 const OUT_RE=/venta|sell|retirad|withdraw|envio|send|salida|cargo|convert/;
 function parseStatement(text,platform='otra'){
  let rows=Array.isArray(text)?text:splitCsv(text);if(rows.length<2)throw Error('El fichero está vacío o no tiene movimientos.');
  // Algunos informes llevan líneas de título antes de la cabecera: se toma la primera fila con
  // al menos tres columnas con nombre.
  const headAt=rows.findIndex(r=>r.filter(x=>String(x).trim()).length>=3);if(headAt>0)rows=rows.slice(headAt);
  const head=rows[0].map(norm),known=new Set(state.assets.map(a=>a.symbol));
  // El coste medio depende del orden: los movimientos se procesan del más antiguo al más reciente.
  const dateCol=findCol(head,[/^(fecha|date|time|timestamp|hora|fecha y hora|fecha de la operacion|created at|date utc|date\(utc\))/]);
  if(dateCol>=0){const body=rows.slice(1).map((r,i)=>({r,i,t:rowTime(r[dateCol])}));if(body.filter(x=>x.t!==null).length>=body.length*0.8){body.sort((a,b)=>(a.t??0)-(b.t??0)||a.i-b.i);rows=[rows[0],...body.map(x=>x.r)]}}
  const B=newBook();let used=0,skipped=0;
  // Formato CoinTracking (el Excel actual de Bit2Me): Tipo · Compra · Moneda · Venta · Moneda ·
  // Comisión · Moneda · … · Fecha. Las columnas de moneda pueden llamarse igual («Cur.»): se toma
  // la que va justo después de cada importe.
  const ctIn=findCol(head,[/^(buy|buy amount|compra|cantidad compra|cantidad de destino|cantidad destino|entrada|recibido)$/]),ctOut=findCol(head,[/^(sell|sell amount|venta|cantidad venta|cantidad de origen|cantidad origen|salida|enviado)$/]);
  if(ctIn>=0&&ctOut>=0){
   const curAfter=(i,named)=>{const n=findCol(head,named);if(n>=0)return n;const h=head[i+1]||'';return/^(cur|currency|moneda|divisa|cur \d+)$/.test(h)||h.length<=4?i+1:-1};
   const inCur=curAfter(ctIn,[/^(buy currency|moneda compra|divisa compra|moneda de destino|moneda destino)$/]),outCur=curAfter(ctOut,[/^(sell currency|moneda venta|divisa venta|moneda de origen|moneda origen)$/]);
   const fee=findCol(head,[/^(fee|fee amount|comision|comision de la operacion|tarifa)$/]),feeCur=fee>=0?curAfter(fee,[/^(fee currency|moneda comision|divisa comision|moneda de la comision)$/]):-1;
   const type=findCol(head,[/^(type|tipo|tipo de operacion|operacion)$/]);
   const FREE=/income|staking|reward|interest|airdrop|bonus|gift|mining|lending|earn|recompensa|interes|regalo|bono|cashback|mineria|prestamo|bloqueo/;
   const counts={},parked=new Map();
   for(const r of rows.slice(1)){
    const t=norm(type>=0?r[type]:''),ic=String(inCur>=0?r[inCur]:'').trim().toUpperCase(),ia=Math.abs(parseNum(r[ctIn])||0);
    const oc=String(outCur>=0?r[outCur]:'').trim().toUpperCase(),oa=Math.abs(parseNum(r[ctOut])||0);
    const fc=String(feeCur>=0?r[feeCur]:'').trim().toUpperCase(),fa=Math.abs(parseNum(fee>=0?r[fee]:'')||0);
    const inK=known.has(ic)&&ia>0,outK=known.has(oc)&&oa>0;
    if(!inK&&!outK&&!(known.has(fc)&&fa>0)){skipped++;continue}
    // Movimiento interno (de Wallet a Earn y vuelta): misma moneda y cantidad a los dos lados.
    if(inK&&outK&&ic===oc&&Math.abs(ia-oa)<=1e-12*Math.max(ia,1)){used++;continue}
    counts[t||'sin tipo']=(counts[t||'sin tipo']||0)+1;
    const carried=outK?B.sell(oc,oa):null;
    // Salida sin contrapartida (a Earn, a otra wallet…): se aparta su coste por si vuelve.
    if(outK&&!inK&&carried!==null){if(!parked.has(oc))parked.set(oc,[]);parked.get(oc).push({units:oa,cost:carried})}
    if(inK){
     const eurFee=fc==='EUR'?fa:0;
     let cost=oc==='EUR'&&oa>0?oa+eurFee:outK?carried:FREE.test(t)?0:null;
     // Entrada sin contrapartida: si vuelve lo que salió (±1 %), recupera su coste.
     if(cost===null&&!outK){const list=parked.get(ic)||[],k=list.findIndex(x=>Math.abs(x.units-ia)<=0.01*Math.max(x.units,ia));if(k>=0){cost=list[k].cost*Math.min(1,ia/list[k].units);list.splice(k,1)}}
     B.buy(ic,ia,cost);
    }
    if(known.has(fc)&&fa>0)B.sell(fc,fa);
    used++;
   }
   return{positions:B.positions(),used,skipped,format:'Excel de Bit2Me (origen → destino)',types:counts};
  }
  // Kraken · libro mayor: cada operación son dos filas con el mismo refid (cripto y euros).
  const refid=findCol(head,[/^refid$/]),kAsset=findCol(head,[/^asset$/]),kAmount=findCol(head,[/^amount$/]),kType=findCol(head,[/^type$/]);
  if(refid>=0&&kAsset>=0&&kAmount>=0){
   const groups=new Map();
   for(const r of rows.slice(1)){const k=r[refid]||Math.random();if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r)}
   for(const g of groups.values()){
    const type=norm(g[0][kType]),eur=g.filter(r=>krakenAsset(r[kAsset])==='EUR').reduce((t,r)=>t+(parseNum(r[kAmount])||0),0);
    const cryptos=g.filter(r=>known.has(krakenAsset(r[kAsset])));
    if(!cryptos.length){skipped+=g.length;continue}
    const outs=cryptos.filter(r=>(parseNum(r[kAmount])||0)<0),ins=cryptos.filter(r=>(parseNum(r[kAmount])||0)>0);
    let carried=null;
    for(const r of outs){const c=B.sell(krakenAsset(r[kAsset]),Math.abs(parseNum(r[kAmount])));carried=carried===null?c:carried+(c||0)}
    for(const r of ins){const u=parseNum(r[kAmount]);B.buy(krakenAsset(r[kAsset]),u,REWARD_RE.test(type)?0:eur<0?-eur/ins.length:outs.length?carried:null)}
    used+=g.length;
   }
   return{positions:B.positions(),used,skipped,format:'Kraken · libro mayor'};
  }
  // Binance · historial de operaciones: Pair (BTCEUR), Side, Executed (0.01BTC), Amount (50EUR).
  const bPair=findCol(head,[/^pair$|^market$|^par$/]),bSide=findCol(head,[/^side$|^lado$/]),bExec=findCol(head,[/^executed$|^ejecutado$/]),bAmt=findCol(head,[/^amount$|^importe$|^total$/]);
  if(bPair>=0&&bSide>=0&&bExec>=0){
   const split=v=>{const m=String(v||'').replace(/,/g,'').match(/^([\d.]+)\s*([A-Z0-9]+)$/i);return m?{n:Number(m[1]),c:m[2].toUpperCase()}:null};
   for(const r of rows.slice(1)){
    const e=split(r[bExec]),a=split(r[bAmt]),buy=/buy|compra/i.test(r[bSide]);
    if(!e||!known.has(e.c)){skipped++;continue}
    if(buy)B.buy(e.c,e.n,a&&a.c==='EUR'?a.n:null);else B.sell(e.c,e.n);
    used++;
   }
   return{positions:B.positions(),used,skipped,format:'Binance · operaciones'};
  }
  const col={
   type:findCol(head,[/^tipo|type|operacion|movimiento|concepto/]),
   fromCur:findCol(head,[/(moneda|divisa|currency|activo).*(origen|from|enviad|pagad|sold)|origen.*(moneda|divisa)|from currency|sent currency/]),
   fromAmt:findCol(head,[/(cantidad|importe|amount).*(origen|from|enviad|pagad|sold)|origen.*(cantidad|importe)|from amount|sent amount/]),
   toCur:findCol(head,[/(moneda|divisa|currency|activo).*(destino|to|recib|bought)|destino.*(moneda|divisa)|to currency|received currency/]),
   toAmt:findCol(head,[/(cantidad|importe|amount).*(destino|to|recib|bought)|destino.*(cantidad|importe)|to amount|received amount/]),
   cur:findCol(head,[/^(moneda|divisa|currency|activo|asset|cripto|crypto|symbol|simbolo)$/]),
   amt:findCol(head,[/^(cantidad|amount|unidades|units|importe cripto|quantity transacted|quantity|cantidad realizada)$/]),
   eurTotal:findCol(head,[/(total|valor|importe|contravalor|value).*(eur|€)|eur.*(total|valor|importe)|^total\b|^importe$/]),
   priceCur:findCol(head,[/price currency|spot price currency|moneda del precio/])
  };
  for(const r of rows.slice(1)){
   const v=i=>i>=0?r[i]:'',type=norm(v(col.type));
   const fc=String(v(col.fromCur)).trim().toUpperCase(),fa=Math.abs(parseNum(v(col.fromAmt))||0),tc=String(v(col.toCur)).trim().toUpperCase(),ta=Math.abs(parseNum(v(col.toAmt))||0);
   if(col.fromCur>=0&&col.toCur>=0&&(fc||tc)){
    // Formato de intercambio: «paga X de A, recibe Y de B». Una permuta hereda el coste.
    const fCrypto=known.has(fc),tCrypto=known.has(tc);
    const carried=fCrypto&&fa>0?B.sell(fc,fa):null;
    if(tCrypto&&ta>0)B.buy(tc,ta,fc==='EUR'?fa:fCrypto?carried:null);
    if(fCrypto||tCrypto)used++;else skipped++;
    continue;
   }
   const sym=String(v(col.cur)).trim().toUpperCase(),amount=parseNum(v(col.amt)),total=parseNum(v(col.eurTotal));
   const eurPriced=col.priceCur<0||String(v(col.priceCur)).trim().toUpperCase()==='EUR';
   if(!known.has(sym)||amount===null||amount===0){skipped++;continue}
   if(OUT_RE.test(type)||amount<0)B.sell(sym,Math.abs(amount));
   else B.buy(sym,Math.abs(amount),REWARD_RE.test(type)?0:total!==null&&eurPriced?Math.abs(total):null);
   used++;
  }
  return{positions:B.positions(),used,skipped,format:col.fromCur>=0&&col.toCur>=0?'Intercambios (origen → destino)':'Movimientos por moneda'};
 }
 const parseBit2me=text=>parseStatement(text,'bit2me');
 let importPlatform='bit2me',pendingImport=null;
 function importPlatformHtml(){
  const p=IMPORT_PLATFORMS.find(x=>x.id===importPlatform)||IMPORT_PLATFORMS[0];
  return'<label class="crypto-import-platform"><span>¿De dónde es el extracto?</span><select id="cryptoImportPlatform">'+IMPORT_PLATFORMS.map(x=>'<option value="'+x.id+'"'+(x.id===p.id?' selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select></label>'+
   '<p class="crypto-note" id="cryptoImportHelp">'+p.help+' El fichero se lee en tu dispositivo; solo se guardan el saldo y el precio medio de cada moneda.</p>';
 }
 function openImport(){
  if(!auth()){openModal('Importar extracto','<p class="crypto-empty">Inicia sesión para importar.</p>');return}
  pendingImport=null;
  openModal('Importar extracto','<div class="crypto-import">'+importPlatformHtml()+
   '<input type="file" id="cryptoImportFile" multiple accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"><div id="cryptoImportPreview"></div></div>');
 }
 // Lee uno o varios ficheros (Bit2Me exporta un Excel por año) y los une en una sola tabla.
 async function readStatementRows(files){
  let head=null,body=[];
  for(const file of files){
   const isXlsx=/\.xlsx$/i.test(file.name||'')||/spreadsheetml/.test(file.type||'');
   let rows=isXlsx?await xlsxRows(await file.arrayBuffer()):splitCsv(await file.text());
   const at=rows.findIndex(r=>r.filter(x=>String(x).trim()).length>=3);if(at<0)continue;rows=rows.slice(at);
   if(!head)head=rows[0];
   else if(rows[0].map(norm).join('|')!==head.map(norm).join('|'))throw Error('«'+file.name+'» tiene otras columnas: importa los ficheros de la misma plataforma y del mismo tipo de informe.');
   body.push(...rows.slice(1));
  }
  if(!head)throw Error('Los ficheros están vacíos.');
  return[head,...body];
 }
 function statementPeriod(rows){
  const head=rows[0].map(norm),c=findCol(head,[/^(fecha|date|time|timestamp|hora|fecha y hora|fecha de la operacion|created at|date utc)/]);
  if(c<0)return'';
  const ts=rows.slice(1).map(r=>rowTime(r[c])).filter(t=>t!==null);if(!ts.length)return'';
  const f=t=>new Date(t).toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'});
  return f(Math.min(...ts))+' – '+f(Math.max(...ts));
 }
 // Menos de 1 céntimo: restos de operaciones («polvo»), no se guardan.
 const isDust=p=>{const qt=state.quotes[p.symbol];return num(p.units)<=1e-7||(qt&&qt.price>0&&p.units*qt.price<0.01)};
 async function previewImport(files){
  const box=q('#cryptoImportPreview');if(!box)return;
  files=[...(files||[])];if(!files.length)return;
  const platform=IMPORT_PLATFORMS.find(x=>x.id===importPlatform)||IMPORT_PLATFORMS[0];
  try{
   const rows=await readStatementRows(files),period=statementPeriod(rows),r=parseStatement(rows,platform.id);
   const dust=r.positions.filter(isDust).length;
   pendingImport=r.positions.filter(p=>!isDust(p));
   if(!pendingImport.length){box.innerHTML='<p class="crypto-form-error">No se reconoció ningún saldo de criptoactivos ('+r.skipped+' filas sin reconocer). Mándame una captura de la fila de títulos de las columnas para adaptarlo.</p>';return}
   const types=r.types?Object.entries(r.types).sort((a,b)=>b[1]-a[1]).map(([k,n])=>k+' '+n).join(' · '):'';
   box.innerHTML='<p class="crypto-note">Formato detectado: <b>'+esc(r.format)+'</b>'+(period?' · '+esc(period):'')+' · '+files.length+' '+(files.length===1?'fichero':'ficheros')+(types?'<br><small>'+esc(types)+'</small>':'')+'</p>'+
    (platform.id==='bit2me'?'<p class="crypto-note crypto-alpha-note"><b>Bit2Me exporta un Excel por año.</b> Selecciona a la vez los de todos los años en que operaste: si falta alguno, los saldos salen mal. Lo que esté en Earn puede no aparecer: compara con tu Wallet y corrige las unidades aquí antes de guardar.</p>':'')+
    '<table class="crypto-sources crypto-import-table"><thead><tr><th>Moneda</th><th>Unidades</th><th>Precio medio</th><th>Valor ahora</th></tr></thead><tbody>'+pendingImport.map((p,i)=>{const qt=state.quotes[p.symbol];return'<tr><td>'+esc(p.symbol)+'</td><td><input class="crypto-import-units" type="number" step="any" min="0" inputmode="decimal" data-import-units="'+i+'" value="'+esc(String(p.units))+'" aria-label="Unidades de '+esc(p.symbol)+'"></td><td>'+esc(p.avgPriceEur===null?'—':eur(p.avgPriceEur))+'</td><td data-import-value="'+i+'">'+esc(qt&&qt.price?eur(p.units*qt.price,{decimals:2}):'—')+'</td></tr>'}).join('')+'</tbody></table>'+
    '<p class="crypto-note">'+r.used+' movimientos leídos'+(r.skipped?', '+r.skipped+' sin cripto (euros, por ejemplo)':'')+(dust?', '+dust+' '+(dust===1?'resto':'restos')+' de menos de 1 céntimo descartados':'')+'. Si cambias unidades, el precio medio se mantiene. Sustituye la importación anterior de '+esc(platform.name)+'; lo que añadiste a mano y no esté en la lista queda a 0.</p>'+
    '<button type="button" class="btn" data-crypto-import-save>Guardar '+pendingImport.length+' monedas</button><p class="crypto-form-error" hidden></p>';
  }catch(error){box.innerHTML='<p class="crypto-form-error">'+esc(error.message)+'</p>'}
 }
 async function saveImport(){
  if(!pendingImport)return;
  // Unidades corregidas a mano en la vista previa.
  document.querySelectorAll('#cryptoImportPreview [data-import-units]').forEach(inp=>{const p=pendingImport[Number(inp.dataset.importUnits)],v=parseNum(inp.value);if(p&&v!==null&&v>=0)p.units=v});
  const positions=pendingImport.filter(p=>p.units>0);
  const platform=(IMPORT_PLATFORMS.find(x=>x.id===importPlatform)||IMPORT_PLATFORMS[0]).name;
  try{const d=await api('/api/crypto-positions/import',{method:'POST',body:JSON.stringify({platform:platform==='Otra plataforma'?'Otra':platform,positions})});state.positions=d.positions||[];state.positionsLoaded=true;pendingImport=null;publishTotals();closeModal();state.tab='mine';render()}
  catch(error){const e=q('#cryptoImportPreview .crypto-form-error');if(e){e.hidden=false;e.textContent=error.message}}
 }


 // ---------- Eventos ----------
 // Se refresca con la vista abierta, con una ficha abierta o en Mi día si tienes criptoactivos.
 function visible(){return document.visibilityState==='visible'&&(q('#view-crypto')?.classList.contains('active')||!!state.detail||(q('#view-portfolios')?.classList.contains('active')&&q('#portfolioCryptoApp')&&!q('#portfolioCryptoApp').hidden)||((q('#view-today')?.classList.contains('active')||(q('#view-portfolios')?.classList.contains('active')&&q('#view-portfolios').dataset.portfolioAssetMode==='goal'))&&state.positions.some(p=>num(p.units)>0)))}
 function schedule(){
  clearInterval(state.timer);
  state.timer=setInterval(()=>{if(visible()){loadQuotes();if(state.tab==='alpha'&&q('#view-crypto')?.classList.contains('active'))loadAlpha()}},30000);
 }
 function init(){
  document.addEventListener('click',async e=>{
   const t=e.target.closest('[data-crypto-back],[data-crypto-profile-tab],[data-crypto-more],[data-crypto-tab],[data-crypto-detail],[data-crypto-close],[data-crypto-add],[data-crypto-import],[data-crypto-import-save],[data-crypto-edit],[data-crypto-delete],[data-crypto-days],#cryptoRefresh');
   if(!t)return;
   if(t.id==='cryptoRefresh'){if(state.tab==='alpha')loadAlpha();else loadQuotes();return}
   if(t.hasAttribute('data-crypto-more')){state.limit+=60;render();return}
   if(t.hasAttribute('data-alpha-more')){state.alpha.limit+=40;render();return}
   if(t.dataset.cryptoTab){state.tab=t.dataset.cryptoTab;if(state.tab==='mine')loadPositions();if(state.tab==='alpha'&&(!state.alpha.updatedAt||Date.now()-Date.parse(state.alpha.updatedAt)>60000))loadAlpha();render();return}
   if(t.dataset.cryptoDays){if(state.detail)loadChart(state.detail.symbol,Number(t.dataset.cryptoDays));return}
   if(t.dataset.cryptoProfileTab){if(state.detail){state.detail.tab=t.dataset.cryptoProfileTab;renderDetail()}return}
   if(t.hasAttribute('data-crypto-back')){backFromDetail();return}
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
  root.addEventListener('popstate',e=>{if(state.detail&&!(e.state&&e.state.cryptoProfile===state.detail.symbol))closeDetail()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&q('#cryptoModal.open'))closeModal();const t=e.target.closest&&e.target.closest('[data-crypto-detail][role=button]');if(t&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openDetail(t.dataset.cryptoDetail)}});
  document.addEventListener('submit',e=>{if(e.target&&e.target.id==='cryptoPositionForm'){e.preventDefault();submitForm(e.target)}});
  document.addEventListener('change',e=>{
   if(e.target&&e.target.id==='cryptoImportFile'&&e.target.files.length)previewImport(e.target.files);
   if(e.target&&e.target.id==='cryptoImportPlatform'){importPlatform=e.target.value;const p=IMPORT_PLATFORMS.find(x=>x.id===importPlatform);const h=q('#cryptoImportHelp');if(h&&p)h.innerHTML=p.help+' El fichero se lee en tu dispositivo; solo se guardan el saldo y el precio medio de cada moneda.';const f=q('#cryptoImportFile');if(f&&f.files.length)previewImport(f.files)}
  });
  document.addEventListener('input',e=>{
   if(e.target&&e.target.id==='cryptoSearch'){state.search=e.target.value;render()}
   const iu=e.target&&e.target.dataset&&e.target.dataset.importUnits;
   if(iu!==undefined&&pendingImport){const p=pendingImport[Number(iu)],qt=p&&state.quotes[p.symbol],v=parseNum(e.target.value),cell=q('#cryptoImportPreview [data-import-value="'+iu+'"]');if(cell)cell.textContent=qt&&qt.price&&v!==null?eur(v*qt.price,{decimals:2}):'—'}
  });
  root.addEventListener('viewinvai:view-changed',ev=>{if(state.detail)closeDetail();if(ev.detail&&ev.detail.view==='crypto'){loadQuotes();loadPositions()}else if(ev.detail&&ev.detail.view==='today'&&visible()&&(!state.updatedAt||Date.now()-Date.parse(state.updatedAt)>30000))loadQuotes()});
  root.addEventListener('viewinvai:auth-changed',()=>{state.positionsLoaded=false;loadPositions(true)});
  root.addEventListener('viewinvai:account-ready',()=>{loadPositions(true).then(()=>{if(state.positions.length&&!state.updatedAt)loadQuotes()})});
  document.addEventListener('visibilitychange',()=>{if(visible()&&(!state.updatedAt||Date.now()-Date.parse(state.updatedAt)>30000))loadQuotes()});
  schedule();
  // Al cambiar el formato de las listas se vuelven a pintar las tarjetas.
  new MutationObserver(()=>{if(q('#view-crypto')?.classList.contains('active')&&!state.detail)render()}).observe(document.documentElement,{attributes:true,attributeFilter:['data-list-view']});
  if(q('#view-crypto')?.classList.contains('active'))loadQuotes();
 }
 root.ViewInvAICrypto={showPortfolio,openDetail,closeDetail,isProfileOpen:()=>!!state.detail,totals,refresh:loadQuotes,positions:()=>state.positions.slice(),parseBit2me,parseStatement,xlsxRows,radarSignals};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
