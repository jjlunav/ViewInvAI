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
initLeadersDock();
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
window.ViewInvAI={
 openStockByKey:(key,reason='Aviso',preferTr=null)=>{let s=stockByKey(key);if(!s)return false;openStock(s,reason,preferTr);return true},
 getStockByKey:key=>stockByKey(key),
 getAllStocks:()=>db.stocks.slice(),
 getStockKey:s=>stockKey(s),
 getCurrentStockKey:()=>state.profileKey||null,
 getQuoteUpdatedLabel:(stock,preferTr=false)=>quoteUpdatedLabel(stock,preferTr),
 getCanonicalQuote:(stock,preferTr=false)=>canonicalQuote(stock,preferTr),
 getDisplayQuote:(stock,preferTr=false)=>verifiedDisplayQuote(stock,preferTr,currentMarketSession()),
 observeLiveQuotes:(root=document)=>{observeTrLivePrices(root||document);setTimeout(pollUsLive,0);},
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
load(true);
