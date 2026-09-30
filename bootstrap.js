function openPushTargetFromUrl(){
 const params=new URLSearchParams(location.search);
 const route=String(params.get('pushRoute')||''),portfolioId=String(params.get('portfolioId')||''),stockKey=String(params.get('stockKey')||''),preferTr=params.get('preferTr')==='1';
 if(!route&&!portfolioId&&!stockKey)return;
 const clean=()=>{try{const url=new URL(location.href);['pushRoute','portfolioId','stockKey','preferTr'].forEach(k=>url.searchParams.delete(k));history.replaceState(history.state||{},'',url.pathname+url.search+url.hash)}catch(_){}};
 let tries=0;
 const attempt=()=>{
  tries++;
  if(route==='portfolio-goal'||portfolioId){
   window.ViewInvAINavigation?.go?.('portfolios');
   if(window.ViewInvAIPortfolios?.openGoal?.(portfolioId)){clean();return}
  }else if(stockKey&&window.ViewInvAI?.openStockByKey?.(stockKey,'Aviso web',preferTr)){
   clean();return;
  }
  if(tries<8)setTimeout(attempt,tries<3?500:900);else clean();
 };
 setTimeout(attempt,350);
}

/*
 * ViewInvAI bootstrap
 * -------------------
 * Single application startup point. All shared modules are loaded before this file.
 */

initSettings();
restoreUiState();
renderNavigation();
initAppHistory();
initNativeBackHandling();
toUI(state.filters);
initHelpSystem();
initStockInteractions();
initCatalogInteractions();
initHeatmapInteractions();
initEventViewInteractions();
initStockListInteractions();
window.ViewInvAIFunds?.init?.();
window.addEventListener('viewinvai:portfolio-membership-changed',()=>{
 let s=state.profileKey?stockByKey(state.profileKey):null;
 if(s)refreshProfilePortfolioActions(s);
});
lockAllCriteria();
initTrLive();
initUsLive();
pollFxLive();
setInterval(()=>{if(!document.hidden)pollFxLive()},15000);
clock();
window.addEventListener('scroll',queueUiSave,{passive:true});
let lastCatalogMobile=catalogIsMobile();
window.addEventListener('resize',()=>{
 let next=catalogIsMobile();
 if(next!==lastCatalogMobile){lastCatalogMobile=next;if(['catalog','catalogUS'].includes(state.currentView)){catalogResetLimit(state.currentView==='catalog'?'tr':'us');renderCurrentView()}}
},{passive:true});
window.addEventListener('pagehide',()=>{saveUiState();syncCurrentHistorySnapshot();releaseScreenWakeLock()});
window.addEventListener('beforeunload',()=>{saveUiState();syncCurrentHistorySnapshot()});
document.addEventListener('visibilitychange',()=>{
 if(document.hidden){saveUiState();releaseScreenWakeLock()}
 else{syncScreenWakeLock();load(false);pollUsLive();scheduleLiveViewRefresh(0)}
});
setInterval(clock,1000);
setInterval(()=>{if(!document.hidden&&state.currentView==='recommendation'&&!document.body.classList.contains('stock-detail-open'))renderRecommendation()},60000);
setTimeout(()=>window.ViewInvAIMarketBoard?.refreshSocialTrending?.(false),0);
openPushTargetFromUrl();
window.ViewInvAI={
 openStockByKey:(key,reason='Aviso',preferTr=null,originView=null)=>{let s=stockByKey(key);if(!s)return false;openStock(s,reason,preferTr,originView);return true},
 getStockByKey:key=>stockByKey(key),
 getAllStocks:()=>db.stocks.slice(),
 mergeLiveEvents:events=>{
  const rows=Array.isArray(events)?events:[];
  if(!rows.length)return 0;
  const merged=[...(db.events||[])],seen=new Set(merged.map(event=>String(event&&event.id||"")||[String(event&&event.eventKind||""),String(event&&event.ticker||""),String(event&&event.title||event&&event.fact||""),String(event&&event.date||"")].join("|")));
  let added=0;
  for(const event of rows){
   if(!event)continue;
   const key=String(event.id||"")||[String(event.eventKind||""),String(event.ticker||""),String(event.title||event.fact||""),String(event.date||"")].join("|");
   if(seen.has(key))continue;
   seen.add(key);merged.push(event);added++;
  }
  if(added){
   db.events=merged;
   rebuildMarketIndexes();
  }
  return added;
 },
 getStockKey:s=>stockKey(s),
 getCurrentStockKey:()=>state.profileKey||null,
 getQuoteUpdatedLabel:(stock,preferTr=false)=>quoteUpdatedLabel(stock,preferTr),
 getCanonicalQuote:(stock,preferTr=false)=>canonicalQuote(stock,preferTr),
 getDisplayQuote:(stock,preferTr=false)=>verifiedDisplayQuote(stock,preferTr,currentMarketSession()),
 observeLiveQuotes:(root=document)=>{observeTrLivePrices(root||document);setTimeout(pollUsLive,0);},
 ensureTrLiveKey:key=>ensureTrLiveKey(key),
 renderAssetCard:options=>window.ViewInvAICards.render(options),
 renderStandardStockCard:(stock,options={})=>standardStockCard(stock,Number(options.index)||0,options||{}),
 renderPricePair:(stock,preferTr=false)=>pricePair(stock,SP(stock,currentMarketSession()),preferTr),
 renderLiveChange:(stock,preferTr=false)=>liveChangeHtml(stock,SC(stock,currentMarketSession()),preferTr),
 getEurUsd:()=>eurUsd(),
 getFavoriteKeys:()=>[...favorites],
 replaceFavoriteKeys:keys=>{favorites=new Set((Array.isArray(keys)?keys:[]).filter(Boolean));saveFavorites();renderFavorites();$$('.fav-star').forEach(b=>{let on=favorites.has(b.dataset.favKey);b.classList.toggle('active',on);b.textContent=on?'★':'☆'});return true;},
 mergeFavoriteKeys:keys=>{
  let changed=false;
  for(let key of (Array.isArray(keys)?keys:[])){if(key&&!favorites.has(key)){favorites.add(key);changed=true}}
  if(changed){saveFavorites();renderFavorites()}
  return changed;
 },
 highConvictionRecommendation
};
setInterval(()=>load(false),DATA_REFRESH_MS);
load(false);
