/*
 * ViewInvAI funds & ETFs
 * ---------------------
 * Shared web/Android catalogue for index funds and ETFs.
 * Products are identified by ISIN; platform availability must be source-verified.
 */
(function(root){
 'use strict';

 const DATA='data/funds.json';
 const PERIODS=[
  ['1M','perf1M'],['3M','perf3M'],['6M','perf6M'],['YTD','perfYtd'],
  ['1A','perf1Y'],['3A','perf3Y'],['5A','perf5Y'],['10A','perf10Y'],['Hist.','perfSinceInception']
 ];
 const state={products:[],meta:{},loaded:false,loading:false,query:'',platform:'all',type:'all',sort:'perf1Y',selectedIsin:null};
 const account={user:null,portfolios:[],positions:[],selectedPortfolioId:null,loading:false};

 function q(s){return document.querySelector(s)}
 function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
 function num(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null}
 function pct(v){v=num(v);return v===null?'—':(v>=0?'+':'')+v.toLocaleString('es-ES',{maximumFractionDigits:2})+'%'}
 function money(v,c='EUR'){v=num(v);if(v===null)return'—';try{return v.toLocaleString('es-ES',{style:'currency',currency:c||'EUR',maximumFractionDigits:4})}catch(_){return v.toLocaleString('es-ES',{maximumFractionDigits:4})+' '+c}}
 function dateText(v){if(!v)return'—';let d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleDateString('es-ES'):'—'}
 function safeHttpsUrl(v){
  try{const u=new URL(String(v||''),location.href);return u.protocol==='https:'?u.href:''}catch(_){return''}
 }
 function ageText(v){
  if(!v)return'Sin fecha';
  let t=new Date(v).getTime();if(!Number.isFinite(t))return'Sin fecha';
  let age=Math.max(0,Date.now()-t);
  if(age<86400000)return'Actualizado hoy';
  let d=Math.max(1,Math.floor(age/86400000));
  return'Actualizado hace '+d+' '+(d===1?'día':'días');
 }
 function norm(p){
  const platforms=p&&p.platforms&&typeof p.platforms==='object'?p.platforms:{};
  return Object.assign({
   isin:'',name:'',type:'fund',provider:'',index:'',category:'',region:'',currency:'EUR',
   distribution:'',ter:null,nav:null,valueDate:null,sourceUpdatedAt:null,
   perf1M:null,perf3M:null,perf6M:null,perfYtd:null,perf1Y:null,perf3Y:null,perf5Y:null,perf10Y:null,perfSinceInception:null,
   volatility3Y:null,maxDrawdown:null,sharpe3Y:null,trackingDifference:null,assetsUnderManagement:null,
   platforms:{tradeRepublic:'unknown',myInvestor:'unknown'},sources:[]
  },p,{platforms:Object.assign({tradeRepublic:'unknown',myInvestor:'unknown'},platforms)});
 }
 function verified(v){return v===true||v==='verified'||v==='yes'}
 function rejected(v){return v===false||v==='no'||v==='unavailable'}
 function platformLabel(p){
  let rows=[];
  const tr=p.platforms.tradeRepublic,mi=p.platforms.myInvestor;
  rows.push('<span class="fund-platform '+(verified(tr)?'ok':rejected(tr)?'no':'pending')+'">TR '+(verified(tr)?'✓':rejected(tr)?'—':'?')+'</span>');
  rows.push('<span class="fund-platform '+(verified(mi)?'ok':rejected(mi)?'no':'pending')+'">MyInvestor '+(verified(mi)?'✓':rejected(mi)?'—':'?')+'</span>');
  return rows.join('');
 }
 function matchesPlatform(p){
  if(state.platform==='all')return true;
  if(state.platform==='tr')return verified(p.platforms.tradeRepublic);
  if(state.platform==='mi')return verified(p.platforms.myInvestor);
  if(state.platform==='both')return verified(p.platforms.tradeRepublic)&&verified(p.platforms.myInvestor);
  return true;
 }
 function filtered(){
  const needle=state.query.trim().toLowerCase();
  let rows=state.products.filter(p=>{
   if(state.type!=='all'&&p.type!==state.type)return false;
   if(!matchesPlatform(p))return false;
   if(!needle)return true;
   return [p.name,p.isin,p.provider,p.index,p.category,p.region].some(v=>String(v||'').toLowerCase().includes(needle));
  });
  const key=state.sort;
  rows.sort((a,b)=>{
   let av=num(a[key]),bv=num(b[key]);
   if(av===null&&bv===null)return String(a.name).localeCompare(String(b.name));
   if(av===null)return 1;if(bv===null)return-1;
   return bv-av||String(a.name).localeCompare(String(b.name));
  });
  return rows;
 }
 function perfStrip(p){
  return '<div class="fund-performance">'+PERIODS.map(([label,key])=>'<span><small>'+label+'</small><b class="'+((num(p[key])||0)>=0?'positive':'negative')+'">'+pct(p[key])+'</b></span>').join('')+'</div>';
 }
 function compactFacts(p){
  const facts=[
   ['Índice',p.index],['Gestora',p.provider],['TER',num(p.ter)===null?'—':num(p.ter).toLocaleString('es-ES',{maximumFractionDigits:3})+'%'],
   ['Clase',p.distribution],['Categoría',p.category],['Región',p.region]
  ];
  return '<div class="fund-facts">'+facts.map(([k,v])=>'<div><small>'+esc(k)+'</small><strong>'+esc(v||'—')+'</strong></div>').join('')+'</div>';
 }
 function detail(p){
  const risk=[
   ['Volatilidad 3A',pct(p.volatility3Y)],['Drawdown máx.',pct(p.maxDrawdown)],['Sharpe 3A',num(p.sharpe3Y)===null?'—':num(p.sharpe3Y).toLocaleString('es-ES',{maximumFractionDigits:2})],
   ['Tracking diff.',pct(p.trackingDifference)],['Patrimonio',num(p.assetsUnderManagement)===null?'—':money(p.assetsUnderManagement,p.currency)]
  ];
  const sources=(p.sources||[]).map(s=>{const url=safeHttpsUrl(s&&s.url);return url?'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.label||s.url||'Fuente')+'</a>':''}).filter(Boolean).join(' · ');
  return '<details class="fund-more"><summary>Más datos</summary>'+
   compactFacts(p)+
   '<div class="fund-risk-grid">'+risk.map(([k,v])=>'<div><small>'+esc(k)+'</small><strong>'+esc(v)+'</strong></div>').join('')+'</div>'+
   '<div class="fund-source-line"><span>'+esc(ageText(p.sourceUpdatedAt||p.valueDate))+'</span>'+(sources?'<span>·</span>'+sources:'')+'</div>'+
  '</details>';
 }
 function card(p){
  const value=num(p.nav);
  const valueLabel=p.type==='etf'?'Precio':'VL oficial';
  const stale=ageText(p.valueDate||p.sourceUpdatedAt);
  return '<article class="fund-card" data-fund-isin="'+esc(p.isin)+'">'+
   '<div class="fund-card-head"><div><span class="fund-kind">'+(p.type==='etf'?'ETF':'FONDO INDEXADO')+'</span><h3>'+esc(p.name||p.isin)+'</h3><p>'+esc(p.isin)+'</p></div><div class="fund-platforms">'+platformLabel(p)+'</div></div>'+
   '<div class="fund-primary-row"><div><small>'+valueLabel+'</small><strong>'+money(value,p.currency)+'</strong><span>'+esc(dateText(p.valueDate))+' · '+esc(stale)+'</span></div>'+
   '<div><small>1 año</small><strong class="'+((num(p.perf1Y)||0)>=0?'positive':'negative')+'">'+pct(p.perf1Y)+'</strong><span>'+esc(p.index||p.category||'')+'</span></div></div>'+
   perfStrip(p)+detail(p)+
   '<div class="fund-card-actions"><button type="button" class="btn small" data-fund-position="'+esc(p.isin)+'">＋ Añadir a cartera</button></div>'+
  '</article>';
 }
 function render(){
  const box=q('#fundsApp');if(!box)return;
  if(state.loading){box.innerHTML='<div class="empty-state">Actualizando fondos y ETFs…</div>';return}
  const rows=filtered();
  const updated=state.meta&&state.meta.updatedAt?new Date(state.meta.updatedAt):null;
  const stamp=updated&&Number.isFinite(updated.getTime())?updated.toLocaleString('es-ES'):'sin actualización verificada';
  box.innerHTML=
   '<div class="funds-status"><span>'+rows.length+' productos</span><span>·</span><span>'+esc(stamp)+'</span></div>'+
   (rows.length?'<div class="fund-grid">'+rows.map(card).join('')+'</div>':
    '<div class="empty-state">No hay productos que coincidan con los filtros. Si el catálogo todavía está vacío, ejecuta la sincronización de fuentes verificadas.</div>');
 }
 async function load(force=false){
  if(state.loading)return;
  if(state.loaded&&!force){render();return}
  state.loading=true;render();
  try{
   const r=await fetch(DATA+(force?'?v='+Date.now():''),{cache:force?'reload':'no-cache'});
   if(!r.ok)throw Error(String(r.status));
   const data=await r.json();
   state.products=(Array.isArray(data.products)?data.products:[]).map(norm).filter(p=>p.isin);
   state.meta=data.meta||{};
   state.loaded=true;
  }catch(e){
   console.warn('Funds catalogue loading failed',e);
   state.products=[];state.meta={};
  }finally{state.loading=false;render()}
 }

 function api(path,options={}){
  if(!root.ViewInvAIAuth||typeof root.ViewInvAIAuth.apiFetch!=='function')throw Error('La cuenta todavía no está disponible.');
  return root.ViewInvAIAuth.apiFetch(path,options);
 }
 function productForPosition(position){
  return state.products.find(p=>p.isin===position.isin)||norm({
   isin:position.isin,name:position.name,type:position.product_type,provider:position.provider,index:position.index_name,
   currency:position.currency,platforms:{tradeRepublic:'unknown',myInvestor:'unknown'}
  });
 }
 function selectedFundPortfolio(){
  return account.portfolios.find(p=>String(p.id)===String(account.selectedPortfolioId))||account.portfolios[0]||null;
 }
 function fundPositions(portfolioId){
  return account.positions.filter(p=>String(p.fund_portfolio_id)===String(portfolioId)&&Number(p.active)!==0);
 }
 function fundPositionCard(position){
  const p=productForPosition(position),units=num(position.units),avg=num(position.avg_price),current=num(p.nav);
  const value=units!==null&&current!==null?units*current:null;
  const invested=units!==null&&avg!==null?units*avg:null;
  const pnl=value!==null&&invested!==null?value-invested:null;
  const pnlPct=pnl!==null&&invested>0?pnl/invested*100:null;
  return '<article class="fund-position-card">'+
   '<div class="fund-position-main"><div><span class="fund-kind">'+(p.type==='etf'?'ETF':'FONDO')+'</span><h3>'+esc(p.name||position.name||p.isin)+'</h3><p>'+esc(p.isin)+'</p></div>'+
   '<div class="fund-position-value"><small>VALOR ACTUAL</small><strong>'+money(value,position.currency||p.currency)+'</strong><span>'+esc(ageText(p.valueDate||p.sourceUpdatedAt))+'</span></div></div>'+
   '<div class="fund-position-metrics">'+
    '<span><small>Participaciones</small><b>'+esc(units===null?'—':units.toLocaleString('es-ES',{maximumFractionDigits:6}))+'</b></span>'+
    '<span><small>Media</small><b>'+money(avg,position.currency||p.currency)+'</b></span>'+
    '<span><small>P&L</small><b class="'+((pnl||0)>=0?'positive':'negative')+'">'+(pnl===null?'—':money(pnl,position.currency||p.currency)+(pnlPct===null?'':' · '+pct(pnlPct)))+'</b></span>'+
    '<span><small>Plataforma</small><b>'+esc(position.platform||'—')+'</b></span>'+
   '</div>'+
   '<details class="fund-more"><summary>Detalles</summary>'+compactFacts(p)+perfStrip(p)+'</details>'+
   '<div class="fund-card-actions"><button type="button" class="btn small" data-fund-transactions="'+esc(position.id)+'">Operaciones</button><button type="button" class="btn small ghost" data-fund-position-edit="'+esc(position.id)+'">Editar</button><button type="button" class="btn small ghost" data-fund-position-delete="'+esc(position.id)+'">Eliminar</button></div>'+
  '</article>';
 }
 function renderPortfolio(){
  const box=q('#fundPortfolioApp');if(!box)return;
  account.user=root.ViewInvAIAuth?.getUser?.()||account.user;
  if(!account.user){
   box.innerHTML='<div class="portfolio-empty-state"><h2>Cartera de fondos</h2><p>Inicia sesión con Google para sincronizar tus fondos y ETFs entre web y Android.</p><button type="button" class="btn" data-fund-login>Entrar con Google</button></div>';
   return;
  }
  if(account.loading){box.innerHTML='<div class="portfolio-loading"><span></span><p>Cargando fondos…</p></div>';return}
  const selected=selectedFundPortfolio();
  if(!selected){
   box.innerHTML='<div class="portfolio-empty-state"><h2>Tu cartera de fondos está vacía</h2><p>Al añadir el primer fondo se creará automáticamente una cartera “Fondos y ETFs”.</p><button type="button" class="btn" data-fund-new-portfolio>＋ Crear cartera</button></div>';
   return;
  }
  account.selectedPortfolioId=selected.id;
  const rows=fundPositions(selected.id);
  let total=0,invested=0,complete=true;
  for(const position of rows){
   const p=productForPosition(position),units=num(position.units),avg=num(position.avg_price),nav=num(p.nav);
   if(units===null||nav===null){complete=false;continue}
   total+=units*nav;
   if(avg!==null)invested+=units*avg;else complete=false;
  }
  const pnl=complete?total-invested:null,pnlPct=pnl!==null&&invested>0?pnl/invested*100:null;
  box.innerHTML=
   '<div class="fund-portfolio-toolbar"><div class="portfolio-tabs-track">'+account.portfolios.map(p=>'<button type="button" class="portfolio-tab'+(String(p.id)===String(selected.id)?' active':'')+'" data-fund-portfolio-select="'+esc(p.id)+'"><strong>'+esc(p.name)+'</strong><span>'+fundPositions(p.id).length+'</span></button>').join('')+'</div><button type="button" class="btn small" data-fund-new-portfolio>＋ Cartera</button></div>'+
   '<div class="portfolio-summary-bar">'+
    '<div><small>CARTERA</small><strong>'+esc(selected.name)+'</strong></div>'+
    '<div><small>VALOR ACTUAL</small><strong>'+(complete?money(total,selected.base_currency||'EUR'):'—')+'</strong></div>'+
    '<div><small>P&L</small><strong class="'+((pnl||0)>=0?'pnl-up':'pnl-down')+'">'+(pnl===null?'—':money(pnl,selected.base_currency||'EUR')+(pnlPct===null?'':' · '+pct(pnlPct)))+'</strong></div>'+
    '<div><small>POSICIONES</small><strong>'+rows.length+'</strong></div>'+
   '</div>'+
   (rows.length?'<div class="fund-position-grid">'+rows.map(fundPositionCard).join('')+'</div>':'<div class="portfolio-empty-state compact">Todavía no hay fondos en esta cartera. Añádelos desde el menú Fondos y ETFs.</div>');
 }
 async function loadPortfolio(force=false){
  account.user=root.ViewInvAIAuth?.getUser?.()||null;
  if(!account.user){account.portfolios=[];account.positions=[];renderPortfolio();return}
  if(account.loading&&!force)return;
  account.loading=true;renderPortfolio();
  try{
   const [pr,ps]=await Promise.all([api('/api/fund-portfolios'),api('/api/fund-positions')]);
   const pd=await pr.json().catch(()=>({})),sd=await ps.json().catch(()=>({}));
   if(!pr.ok)throw Error(pd.error||'No se pudieron cargar las carteras de fondos.');
   if(!ps.ok)throw Error(sd.error||'No se pudieron cargar las posiciones de fondos.');
   account.portfolios=pd.portfolios||[];account.positions=sd.positions||[];
   if(!account.selectedPortfolioId&&account.portfolios.length)account.selectedPortfolioId=account.portfolios[0].id;
  }catch(e){console.warn('Fund portfolio loading failed',e)}
  finally{account.loading=false;renderPortfolio()}
 }
 async function ensureDefaultFundPortfolio(){
  if(account.portfolios.length)return account.portfolios[0];
  const r=await api('/api/fund-portfolios',{method:'POST',body:JSON.stringify({name:'Fondos y ETFs',platform:'',baseCurrency:'EUR'})});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudo crear la cartera de fondos.');
  account.portfolios=[data.portfolio];account.selectedPortfolioId=data.portfolio.id;return data.portfolio;
 }
 function ensureModal(){
  let backdrop=q('#fundModalBackdrop'),modal=q('#fundModal');
  if(backdrop&&modal)return modal;
  backdrop=document.createElement('div');backdrop.id='fundModalBackdrop';backdrop.className='portfolio-modal-backdrop';backdrop.setAttribute('aria-hidden','true');
  modal=document.createElement('section');modal.id='fundModal';modal.className='portfolio-modal';modal.setAttribute('aria-hidden','true');
  modal.innerHTML='<div class="portfolio-modal-card"><div class="portfolio-modal-head"><h2 id="fundModalTitle">Fondos</h2><button type="button" data-fund-modal-close aria-label="Cerrar">×</button></div><div id="fundModalBody"></div></div>';
  document.body.append(backdrop,modal);return modal;
 }
 function closeModal(){
  q('#fundModal')?.classList.remove('open');q('#fundModal')?.setAttribute('aria-hidden','true');
  q('#fundModalBackdrop')?.classList.remove('open');q('#fundModalBackdrop')?.setAttribute('aria-hidden','true');
  document.body.classList.remove('app-modal-open');
 }
 function openModal(title,html){
  const modal=ensureModal(),backdrop=q('#fundModalBackdrop');
  q('#fundModalTitle').textContent=title;q('#fundModalBody').innerHTML=html;
  modal.classList.add('open');modal.setAttribute('aria-hidden','false');backdrop.classList.add('open');backdrop.setAttribute('aria-hidden','false');document.body.classList.add('app-modal-open');
 }
 function platformOptions(product,current=''){
  let rows=[];
  if(verified(product.platforms.tradeRepublic))rows.push('Trade Republic');
  if(verified(product.platforms.myInvestor))rows.push('MyInvestor');
  if(current&&!rows.includes(current))rows.push(current);
  rows.push('Otra');
  return [...new Set(rows)].map(x=>'<option value="'+esc(x)+'"'+(x===current?' selected':'')+'>'+esc(x)+'</option>').join('');
 }
 async function openPositionForm(product,existing=null){
  account.user=root.ViewInvAIAuth?.getUser?.()||null;
  if(!account.user){root.ViewInvAIAuth?.signIn?.();return}
  if(!account.portfolios.length)await ensureDefaultFundPortfolio();
  const portfolio=selectedFundPortfolio()||account.portfolios[0];
  const currentPlatform=existing?.platform||(verified(product.platforms.myInvestor)&&!verified(product.platforms.tradeRepublic)?'MyInvestor':verified(product.platforms.tradeRepublic)?'Trade Republic':'Otra');
  openModal(existing?'Editar posición':'Añadir a cartera',
   '<form id="fundPositionForm" class="portfolio-form" data-position-id="'+esc(existing?.id||'')+'" data-isin="'+esc(product.isin)+'">'+
    '<div class="portfolio-form-grid"><label><span>Cartera</span><select name="fundPortfolioId">'+account.portfolios.map(p=>'<option value="'+esc(p.id)+'"'+(String(p.id)===String(existing?.fund_portfolio_id||portfolio.id)?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label>'+
    '<label><span>Plataforma</span><select name="platform">'+platformOptions(product,currentPlatform)+'</select></label></div>'+
    '<div class="portfolio-form-grid"><label><span>Participaciones</span><input name="units" type="number" inputmode="decimal" step="any" min="0" required value="'+esc(existing?.units??'')+'"></label>'+
    '<label><span>Precio / VL medio</span><input name="avgPrice" type="number" inputmode="decimal" step="any" min="0" value="'+esc(existing?.avg_price??'')+'"></label></div>'+
    '<div class="portfolio-form-grid"><label><span>Divisa</span><input name="currency" maxlength="3" value="'+esc(existing?.currency||product.currency||'EUR')+'"></label>'+
    '<label><span>Fecha inicial</span><input name="openedAt" type="date" value="'+esc((existing?.opened_at||'').slice(0,10))+'"></label></div>'+
    '<label><span>Notas</span><input name="notes" maxlength="1000" value="'+esc(existing?.notes||'')+'"></label>'+
    '<button type="submit" class="btn">'+(existing?'Guardar cambios':'Añadir posición')+'</button>'+
   '</form>');
 }
 async function savePosition(form){
  const product=state.products.find(p=>p.isin===form.dataset.isin)||productForPosition({isin:form.dataset.isin,name:''});
  const fd=new FormData(form),id=form.dataset.positionId;
  const payload={
   fundPortfolioId:String(fd.get('fundPortfolioId')||''),
   isin:product.isin,name:product.name,productType:product.type,provider:product.provider,indexName:product.index,
   platform:String(fd.get('platform')||''),units:num(fd.get('units')),avgPrice:num(fd.get('avgPrice')),
   currency:String(fd.get('currency')||product.currency||'EUR').toUpperCase(),openedAt:String(fd.get('openedAt')||''),notes:String(fd.get('notes')||'')
  };
  const r=await api(id?'/api/fund-positions/'+encodeURIComponent(id):'/api/fund-positions',{method:id?'PATCH':'POST',body:JSON.stringify(payload)});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudo guardar la posición.');
  closeModal();await loadPortfolio(true);
 }

 function fundTransactionRowsHtml(rows,currency){
  if(!rows||!rows.length)return '<div class="portfolio-empty-state compact">Todavía no hay operaciones registradas.</div>';
  return rows.map(tx=>{
   const buy=String(tx.side||'').toUpperCase()==='BUY';
   const when=tx.executed_at?new Date(tx.executed_at):null;
   const date=when&&Number.isFinite(when.getTime())?when.toLocaleString('es-ES',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
   const total=(num(tx.units)||0)*(num(tx.price)||0);
   return '<div class="transaction-row">'+
    '<span class="transaction-side '+(buy?'buy':'sell')+'">'+(buy?'COMPRA':'VENTA')+'</span>'+
    '<div class="transaction-main"><strong>'+esc((num(tx.units)||0).toLocaleString('es-ES',{maximumFractionDigits:6}))+' × '+money(tx.price,tx.currency||currency)+'</strong><small>'+esc(date)+(num(tx.fees)?' · comisión '+money(tx.fees,tx.currency||currency):'')+'</small></div>'+
    '<div class="transaction-total"><strong>'+money(total,tx.currency||currency)+'</strong><small>'+esc(tx.notes||'')+'</small></div>'+
    '<button type="button" class="transaction-delete" data-fund-transaction-delete="'+esc(tx.id)+'" aria-label="Eliminar operación">×</button>'+
   '</div>';
  }).join('');
 }
 async function openFundTransactions(positionId){
  const position=account.positions.find(p=>String(p.id)===String(positionId));
  if(!position)return;
  const product=productForPosition(position),currency=position.currency||product.currency||'EUR';
  openModal('Operaciones · '+(product.name||position.isin),'<div class="portfolio-loading compact"><span></span><p>Cargando operaciones…</p></div>');
  try{
   const r=await api('/api/fund-transactions?positionId='+encodeURIComponent(position.id));
   const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudieron cargar las operaciones.');
   const summary=data.summary||{};
   q('#fundModalBody').innerHTML=
    '<div class="transaction-ledger">'+
     '<div class="transaction-summary">'+
      '<div><small>POSICIÓN</small><strong>'+esc((num(summary.units)||0).toLocaleString('es-ES',{maximumFractionDigits:6}))+' uds.</strong></div>'+
      '<div><small>MEDIA</small><strong>'+money(summary.avgPrice,currency)+'</strong></div>'+
      '<div><small>P&L REALIZADO</small><strong class="'+((num(summary.realizedPnl)||0)>=0?'pnl-up':'pnl-down')+'">'+money(summary.realizedPnl,currency)+'</strong></div>'+
      '<div><small>COMISIONES</small><strong>'+money(summary.totalFees,currency)+'</strong></div>'+
     '</div>'+
     '<form id="fundTransactionForm" class="portfolio-form transaction-form" data-position-id="'+esc(position.id)+'">'+
      '<div class="portfolio-form-grid"><label><span>Tipo</span><select name="side"><option value="BUY">Compra / aportación</option><option value="SELL">Venta / reembolso</option></select></label>'+
      '<label><span>Participaciones</span><input name="units" type="number" inputmode="decimal" step="any" min="0.00000001" required></label></div>'+
      '<div class="portfolio-form-grid"><label><span>Precio / VL</span><input name="price" type="number" inputmode="decimal" step="any" min="0" required value="'+esc(num(product.nav)??'')+'"></label>'+
      '<label><span>Comisión</span><input name="fees" type="number" inputmode="decimal" step="any" min="0" value="0"></label></div>'+
      '<div class="portfolio-form-grid"><label><span>Divisa</span><input name="currency" value="'+esc(currency)+'" readonly></label>'+
      '<label><span>Fecha y hora</span><input name="executedAt" type="datetime-local" value="'+new Date().toISOString().slice(0,16)+'" required></label></div>'+
      '<label><span>Nota</span><input name="notes" maxlength="1000" placeholder="Opcional"></label>'+
      '<button type="submit" class="btn">Registrar operación</button>'+
     '</form>'+
     '<div class="transaction-history-head"><strong>Historial</strong><span>'+(data.transactions||[]).length+' operaciones</span></div>'+
     '<div class="transaction-history">'+fundTransactionRowsHtml(data.transactions||[],currency)+'</div>'+
    '</div>';
  }catch(e){q('#fundModalBody').innerHTML='<div class="portfolio-empty-state compact">'+esc(e.message||'No se pudieron cargar las operaciones.')+'</div>'}
 }
 async function saveFundTransaction(form){
  const position=account.positions.find(p=>String(p.id)===String(form.dataset.positionId));
  if(!position)throw Error('No se encuentra la posición.');
  const fd=new FormData(form),raw=String(fd.get('executedAt')||''),date=new Date(raw);
  const payload={
   positionId:position.id,side:String(fd.get('side')||'BUY'),units:num(fd.get('units')),price:num(fd.get('price')),
   fees:num(fd.get('fees'))||0,currency:String(fd.get('currency')||position.currency||'EUR'),
   executedAt:Number.isFinite(date.getTime())?date.toISOString():'',notes:String(fd.get('notes')||'')
  };
  const r=await api('/api/fund-transactions',{method:'POST',body:JSON.stringify(payload)});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudo guardar la operación.');
  await loadPortfolio(true);await openFundTransactions(position.id);
 }

 async function createFundPortfolio(){
  openModal('Nueva cartera de fondos','<form id="fundPortfolioForm" class="portfolio-form"><label><span>Nombre</span><input name="name" maxlength="80" required value="Fondos y ETFs"></label><label><span>Plataforma principal</span><select name="platform"><option value="">Mixta / varias</option><option>MyInvestor</option><option>Trade Republic</option><option>Otra</option></select></label><button type="submit" class="btn">Crear cartera</button></form>');
 }
 function bind(){
  q('#fundSearch')?.addEventListener('input',e=>{state.query=String(e.target.value||'');render()});
  q('#fundPlatform')?.addEventListener('change',e=>{state.platform=e.target.value;render()});
  q('#fundType')?.addEventListener('change',e=>{state.type=e.target.value;render()});
  q('#fundSort')?.addEventListener('change',e=>{state.sort=e.target.value;render()});
  q('#refreshFunds')?.addEventListener('click',()=>load(true));
  document.addEventListener('click',async e=>{
   const asset=e.target.closest&&e.target.closest('[data-portfolio-asset]');
   if(asset){
    const mode=asset.dataset.portfolioAsset;
    document.querySelectorAll('[data-portfolio-asset]').forEach(b=>{const active=b.dataset.portfolioAsset===mode;b.classList.toggle('active',active);b.setAttribute('aria-selected',active?'true':'false')});
    document.querySelectorAll('[data-portfolio-asset-panel]').forEach(p=>p.classList.toggle('is-hidden',p.dataset.portfolioAssetPanel!==mode));
    if(mode==='funds')loadPortfolio(false);
    return;
   }
   if(e.target.closest?.('[data-fund-login]')){root.ViewInvAIAuth?.signIn?.();return}
   const select=e.target.closest&&e.target.closest('[data-fund-portfolio-select]');
   if(select){account.selectedPortfolioId=select.dataset.fundPortfolioSelect;renderPortfolio();return}
   if(e.target.closest?.('[data-fund-new-portfolio]')){createFundPortfolio();return}
   if(e.target.closest?.('[data-fund-modal-close]')||e.target.id==='fundModalBackdrop'){closeModal();return}
   const add=e.target.closest&&e.target.closest('[data-fund-position]');
   if(add){
    const p=state.products.find(x=>x.isin===add.dataset.fundPosition);if(p)await openPositionForm(p);return;
   }
   const transactions=e.target.closest&&e.target.closest('[data-fund-transactions]');
   if(transactions){await openFundTransactions(transactions.dataset.fundTransactions);return}
   const deleteTx=e.target.closest&&e.target.closest('[data-fund-transaction-delete]');
   if(deleteTx){
    const txId=deleteTx.dataset.fundTransactionDelete;
    const positionId=q('#fundTransactionForm')?.dataset.positionId;
    const r=await api('/api/fund-transactions/'+encodeURIComponent(txId),{method:'DELETE'});
    if(r.ok){await loadPortfolio(true);if(positionId)await openFundTransactions(positionId)}
    return;
   }
   const edit=e.target.closest&&e.target.closest('[data-fund-position-edit]');
   if(edit){
    const position=account.positions.find(p=>String(p.id)===String(edit.dataset.fundPositionEdit));if(position)await openPositionForm(productForPosition(position),position);return;
   }
   const del=e.target.closest&&e.target.closest('[data-fund-position-delete]');
   if(del){
    const id=del.dataset.fundPositionDelete;
    const r=await api('/api/fund-positions/'+encodeURIComponent(id),{method:'DELETE'});if(r.ok)await loadPortfolio(true);return;
   }
  });
  document.addEventListener('submit',async e=>{
   if(e.target.id==='fundPositionForm'){e.preventDefault();try{await savePosition(e.target)}catch(err){console.warn(err);q('#fundModalBody')?.insertAdjacentHTML('afterbegin','<div class="portfolio-render-warning">'+esc(err.message||'No se pudo guardar la posición.')+'</div>')}return}
   if(e.target.id==='fundTransactionForm'){e.preventDefault();try{await saveFundTransaction(e.target)}catch(err){console.warn(err);q('#fundModalBody')?.insertAdjacentHTML('afterbegin','<div class="portfolio-render-warning">'+esc(err.message||'No se pudo guardar la operación.')+'</div>')}return}
   if(e.target.id==='fundPortfolioForm'){
    e.preventDefault();const fd=new FormData(e.target);
    try{
     const r=await api('/api/fund-portfolios',{method:'POST',body:JSON.stringify({name:String(fd.get('name')||''),platform:String(fd.get('platform')||''),baseCurrency:'EUR'})});
     const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'No se pudo crear la cartera.');
     closeModal();account.selectedPortfolioId=data.portfolio.id;await loadPortfolio(true);
    }catch(err){console.warn(err);q('#fundModalBody')?.insertAdjacentHTML('afterbegin','<div class="portfolio-render-warning">'+esc(err.message||'No se pudo crear la cartera.')+'</div>')}
   }
  });
  window.addEventListener('viewinvai:auth-changed',()=>loadPortfolio(true));
  window.addEventListener('viewinvai:account-ready',()=>loadPortfolio(true));
 }
 function init(){bind();if(document.querySelector('#view-funds'))load(false);renderPortfolio()}

 root.ViewInvAIFunds={init,load,render,loadPortfolio,renderPortfolio,getState:()=>state,getAccountState:()=>account,getByIsin:isin=>state.products.find(p=>p.isin===isin)||null};
})(window);
