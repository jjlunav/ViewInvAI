/* Global search: ticker, name or ISIN across the US/Trade Republic universe and the
 * funds/ETF catalogue. Opens from the ⌕ button, «/» or Ctrl+K. */
(function(root){
 'use strict';
 const RECENT_KEY='viewinvai:search-recent';
 let box=null,input=null,list=null,lastFocus=null,active=-1,rows=[],timer=null,fundsRequested=false;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const norm=v=>String(v||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().trim();
 const app=()=>root.ViewInvAI||null;
 const tradable=s=>s&&(s.tradeRepublicTradable===true||(s.tradeRepublicTradable!==false&&s.tradeRepublicVerified&&s.trIsin&&s.trTicker&&s.trActive!==false));
 function recent(){try{const a=JSON.parse(localStorage.getItem(RECENT_KEY)||'[]');return Array.isArray(a)?a.slice(0,8):[]}catch(_){return[]}}
 function remember(item){
  try{const a=recent().filter(x=>!(x.kind===item.kind&&x.key===item.key));a.unshift(item);localStorage.setItem(RECENT_KEY,JSON.stringify(a.slice(0,8)))}catch(_){}
 }
 function scoreStock(s,q,words){
  const t=norm(s.ticker),tr=norm(s.trTicker),name=norm(s.name),isin=norm(s.isin||s.trIsin||s.usIsin);
  if(!q)return 0;
  if(t===q||tr===q)return 100;
  if(isin&&(isin===q||norm(s.trIsin)===q||norm(s.usIsin)===q))return 99;
  let sc=0;
  if(t.startsWith(q))sc=82-Math.min(10,t.length-q.length);
  else if(tr&&tr.startsWith(q))sc=78;
  if(words.every(w=>name.split(/[^A-Z0-9]+/).some(p=>p.startsWith(w))))sc=Math.max(sc,name.startsWith(words[0])?70:62);
  else if(q.length>=3&&name.includes(q))sc=Math.max(sc,45);
  if(q.length>=4&&isin.startsWith(q))sc=Math.max(sc,60);
  return sc;
 }
 function scoreFund(p,q,words){
  const name=norm(p.name),isin=norm(p.isin),tk=norm(p.ticker||p.symbol);
  if(isin===q||tk===q)return 98;
  let sc=0;
  if(words.every(w=>name.split(/[^A-Z0-9]+/).some(x=>x.startsWith(w))))sc=60;
  else if(q.length>=3&&name.includes(q))sc=42;
  if(q.length>=4&&isin.startsWith(q))sc=Math.max(sc,58);
  return sc;
 }
 function fundProducts(){
  const f=root.ViewInvAIFunds,st=f&&f.getState&&f.getState();
  if(st&&st.products&&st.products.length)return st.products;
  if(f&&f.load&&!fundsRequested){fundsRequested=true;Promise.resolve(f.load()).then(()=>{if(isOpen())run()}).catch(()=>{})}
  return[];
 }
 function money(v,cur){const n=Number(v);if(!Number.isFinite(n))return'';return n.toLocaleString('es-ES',{minimumFractionDigits:n<1?3:2,maximumFractionDigits:n<1?4:2})+' '+cur}
 function chg(v){const n=Number(v);if(!Number.isFinite(n))return'';return'<em class="'+(n>0?'up':n<0?'down':'')+'">'+(n>0?'+':'')+n.toLocaleString('es-ES',{maximumFractionDigits:2})+' %</em>'}
 function stockRow(s,i){
  const a=app(),key=a.getStockKey(s),tr=tradable(s);
  return '<button type="button" class="gs-row" role="option" id="gs-opt-'+i+'" data-gs-kind="stock" data-gs-key="'+esc(key)+'">'+
   '<span class="gs-ticker">'+esc(s.ticker||s.trTicker||'')+'</span>'+
   '<span class="gs-main"><b>'+esc(s.name||s.ticker)+'</b><small>'+esc(s.exchange||'')+(tr?' · <i class="gs-tr">TR</i>':'')+(s.isin||s.trIsin?' · '+esc(s.isin||s.trIsin):'')+'</small></span>'+
   '<span class="gs-quote">'+money(s.price,'$')+chg(s.changePct)+'</span></button>';
 }
 function fundRow(p,i){
  const ter=Number(p.ter);
  return '<button type="button" class="gs-row" role="option" id="gs-opt-'+i+'" data-gs-kind="fund" data-gs-key="'+esc(p.isin)+'" data-fund-detail="'+esc(p.isin)+'">'+
   '<span class="gs-ticker fund">'+(p.type==='fund'?'FONDO':p.type==='etf'?'ETF':'ETP')+'</span>'+
   '<span class="gs-main"><b>'+esc(p.name||p.isin)+'</b><small>'+esc(p.isin)+(Number.isFinite(ter)&&ter>0?' · TER '+ter.toLocaleString('es-ES',{maximumFractionDigits:2})+' %':'')+'</small></span>'+
   '<span class="gs-quote">'+(Number.isFinite(Number(p.perf1Y))?'<small>1 año</small>'+chg(p.perf1Y):'')+'</span></button>';
 }
 function run(){
  const a=app();if(!a||!list)return;
  const raw=input.value,q=norm(raw),words=q.split(/\s+/).filter(Boolean);
  rows=[];active=-1;
  if(!q){
   const r=recent();
   if(!r.length){list.innerHTML='<p class="gs-hint">Busca por ticker (AAPL), nombre (Apple) o ISIN (US0378331005). Incluye acciones de EEUU, Trade Republic, fondos y ETFs.</p>';return}
   let html='<div class="gs-group">Recientes</div>';
   r.forEach(item=>{
    if(item.kind==='stock'){const s=a.getStockByKey(item.key);if(s){html+=stockRow(s,rows.length);rows.push(item)}}
    else{const p=fundProducts().find(x=>x.isin===item.key);if(p){html+=fundRow(p,rows.length);rows.push(item)}}
   });
   list.innerHTML=rows.length?html:'<p class="gs-hint">Busca por ticker, nombre o ISIN.</p>';return;
  }
  const stocks=a.getAllStocks().map(s=>({s,sc:scoreStock(s,q,words)})).filter(x=>x.sc>0)
   .sort((x,y)=>y.sc-x.sc||(Number(y.s.marketCap)||0)-(Number(x.s.marketCap)||0)).slice(0,25);
  const funds=fundProducts().map(p=>({p,sc:scoreFund(p,q,words)})).filter(x=>x.sc>0)
   .sort((x,y)=>y.sc-x.sc||(Number(y.p.aum||y.p.fundSize)||0)-(Number(x.p.aum||x.p.fundSize)||0)).slice(0,12);
  let html='';
  if(stocks.length){html+='<div class="gs-group">Acciones</div>';stocks.forEach(x=>{html+=stockRow(x.s,rows.length);rows.push({kind:'stock',key:a.getStockKey(x.s)})})}
  if(funds.length){html+='<div class="gs-group">Fondos y ETFs</div>';funds.forEach(x=>{html+=fundRow(x.p,rows.length);rows.push({kind:'fund',key:x.p.isin})})}
  list.innerHTML=html||'<p class="gs-hint">Sin resultados para «'+esc(raw.trim())+'».</p>';
  if(rows.length)setActive(0);
 }
 function setActive(i){
  const opts=list.querySelectorAll('.gs-row');if(!opts.length)return;
  active=(i+opts.length)%opts.length;
  opts.forEach((o,j)=>o.classList.toggle('active',j===active));
  input.setAttribute('aria-activedescendant','gs-opt-'+active);
  opts[active].scrollIntoView({block:'nearest'});
 }
 function choose(el){
  if(!el)return;
  const kind=el.dataset.gsKind,key=el.dataset.gsKey;
  remember({kind,key});
  close(false);
  if(kind==='stock')app()?.openStockByKey?.(key,'Búsqueda',null);
  // Funds open through their own [data-fund-detail] handler on the same click.
 }
 function build(){
  if(box)return box;
  box=document.createElement('div');box.id='globalSearch';box.className='gs-overlay';box.setAttribute('aria-hidden','true');
  box.innerHTML='<div class="gs-panel" role="dialog" aria-modal="true" aria-label="Buscar">'+
   '<div class="gs-bar"><span class="gs-icon" aria-hidden="true"></span><input type="search" id="globalSearchInput" placeholder="Ticker, nombre o ISIN" autocomplete="off" autocapitalize="characters" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="globalSearchList" enterkeyhint="search"><button type="button" class="gs-close" data-gs-close aria-label="Cerrar">✕</button></div>'+
   '<div class="gs-list" id="globalSearchList" role="listbox"></div></div>';
  document.body.appendChild(box);
  input=box.querySelector('input');list=box.querySelector('.gs-list');
  input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(run,90)});
  input.addEventListener('keydown',e=>{
   if(e.key==='ArrowDown'){e.preventDefault();setActive(active+1)}
   else if(e.key==='ArrowUp'){e.preventDefault();setActive(active-1)}
   else if(e.key==='Enter'){e.preventDefault();const el=list.querySelectorAll('.gs-row')[Math.max(0,active)];if(el)el.click()}
   else if(e.key==='Escape'){e.preventDefault();close()}
  });
  box.addEventListener('click',e=>{
   if(e.target===box||e.target.closest('[data-gs-close]')){close();return}
   const row=e.target.closest('.gs-row');if(row)choose(row);
  });
  return box;
 }
 function isOpen(){return!!(box&&box.classList.contains('open'))}
 function open(prefill=''){
  build();lastFocus=document.activeElement;
  box.classList.add('open');box.setAttribute('aria-hidden','false');document.body.classList.add('gs-open');
  input.value=prefill;
  // Focus inside the tap itself so mobile browsers open the keyboard.
  try{input.focus({preventScroll:true})}catch(_){input.focus()}
  run();
 }
 function close(restoreFocus=true){
  if(!box)return;
  box.classList.remove('open');box.setAttribute('aria-hidden','true');document.body.classList.remove('gs-open');
  if(restoreFocus&&lastFocus&&lastFocus.focus)try{lastFocus.focus({preventScroll:true})}catch(_){}
 }
 function mountButton(){
  if(document.getElementById('globalSearchButton'))return;
  const b=document.createElement('button');
  b.type='button';b.id='globalSearchButton';b.className='global-search-button';
  b.setAttribute('aria-label','Buscar acciones, fondos o ETFs');b.title='Buscar (/)';
  b.innerHTML='<span class="gs-icon" aria-hidden="true"></span><span class="gs-label">Buscar</span><kbd>/</kbd>';
  b.addEventListener('click',()=>open());
  const area=document.getElementById('accountArea');
  if(area)area.insertBefore(b,area.firstChild);else document.body.appendChild(b);
 }
 document.addEventListener('keydown',e=>{
  if(isOpen())return;
  const t=e.target,typing=t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  if((e.key==='k'||e.key==='K')&&(e.ctrlKey||e.metaKey)){e.preventDefault();open();return}
  if(e.key==='/'&&!typing&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();open()}
 });
 document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-global-search]');if(b){e.preventDefault();open()}});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountButton);else mountButton();
 root.ViewInvAISearch={open,close,isOpen};
})(window);
