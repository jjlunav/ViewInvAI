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

 function q(s){return document.querySelector(s)}
 function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
 function num(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null}
 function pct(v){v=num(v);return v===null?'—':(v>=0?'+':'')+v.toLocaleString('es-ES',{maximumFractionDigits:2})+'%'}
 function money(v,c='EUR'){v=num(v);if(v===null)return'—';try{return v.toLocaleString('es-ES',{style:'currency',currency:c||'EUR',maximumFractionDigits:4})}catch(_){return v.toLocaleString('es-ES',{maximumFractionDigits:4})+' '+c}}
 function dateText(v){if(!v)return'—';let d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleDateString('es-ES'):'—'}
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
  const sources=(p.sources||[]).map(s=>'<a href="'+esc(s.url||'#')+'" target="_blank" rel="noopener noreferrer">'+esc(s.label||s.url||'Fuente')+'</a>').join(' · ');
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
 function bind(){
  q('#fundSearch')?.addEventListener('input',e=>{state.query=String(e.target.value||'');render()});
  q('#fundPlatform')?.addEventListener('change',e=>{state.platform=e.target.value;render()});
  q('#fundType')?.addEventListener('change',e=>{state.type=e.target.value;render()});
  q('#fundSort')?.addEventListener('change',e=>{state.sort=e.target.value;render()});
  q('#refreshFunds')?.addEventListener('click',()=>load(true));
  document.addEventListener('click',e=>{
   const b=e.target.closest&&e.target.closest('[data-fund-position]');if(!b)return;
   const isin=b.dataset.fundPosition,p=state.products.find(x=>x.isin===isin);
   if(!p)return;
   window.dispatchEvent(new CustomEvent('viewinvai:fund-position-request',{detail:{product:p}}));
  });
 }
 function init(){bind();if(document.querySelector('#view-funds'))load(false)}

 root.ViewInvAIFunds={init,load,render,getState:()=>state,getByIsin:isin=>state.products.find(p=>p.isin===isin)||null};
})(window);
