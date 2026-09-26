/*
 * ViewInvAI stock interactions
 * ----------------------------
 * Event wiring for stock cards, profile controls, charts and AI actions.
 * Loaded after stock-profile.js and stock-charts.js, initialized by bootstrap.js.
 */

function initStockInteractions(){
 $('#aiChatClose')?.addEventListener('click',closeAiChat);
 $('#aiChatBackdrop')?.addEventListener('click',closeAiChat);
 $('#aiChatForm')?.addEventListener('submit',e=>{
  e.preventDefault();
  askAiChat($('#aiChatInput')?.value||'');
 });

 document.addEventListener('click',e=>{
  let aiOpen=e.target.closest&&e.target.closest('[data-ai-chat-stock]');
  if(aiOpen){
   e.preventDefault();e.stopPropagation();
   openAiChat(aiOpen.dataset.aiChatStock,aiOpen.dataset.aiChatPreferTr==='1');
   return;
  }
  let externalChat=e.target.closest&&e.target.closest('[data-chatgpt-stock]');
  if(externalChat){
   e.preventDefault();e.stopPropagation();
   openExternalChatGpt(externalChat.dataset.chatgptStock,externalChat.dataset.chatgptPreferTr==='1');
   return;
  }
  let aiQuick=e.target.closest&&e.target.closest('[data-ai-quick]');
  if(aiQuick){
   e.preventDefault();e.stopPropagation();
   askAiChat(aiQuick.dataset.aiQuick||'');
   return;
  }
  let chartRetry=e.target.closest&&e.target.closest('[data-chart-retry]');
  if(chartRetry){e.preventDefault();e.stopPropagation();retryMiniChart(chartRetry);return}
  let trRange=e.target.closest&&e.target.closest('[data-tr-chart-range]');
  if(trRange){e.preventDefault();e.stopPropagation();switchTrChartRange(trRange);return}
  let chartToggle=e.target.closest&&e.target.closest('.chart-market-toggle');
  if(chartToggle){e.preventDefault();e.stopPropagation();switchMiniChartMarket(chartToggle);return}
  let profileTab=e.target.closest&&e.target.closest('[data-profile-tab]');
  if(profileTab){
   e.preventDefault();e.stopPropagation();
   let root=profileDetailRoot(profileTab),tab=profileTab.dataset.profileTab;
   if(root&&tab){
    root.dataset.profileTab=tab;
    root.querySelectorAll('[data-profile-tab]').forEach(button=>{
     let active=button.dataset.profileTab===tab;
     button.classList.toggle('active',active);
     button.setAttribute('aria-selected',active?'true':'false');
    });
    root.querySelectorAll('[data-profile-panel]').forEach(panel=>{
     let active=panel.dataset.profilePanel===tab||(tab==='general'&&panel.dataset.profilePanel==='general-extra');
     panel.hidden=!active;
     panel.classList.toggle('active',active);
    });
    if(tab==='chart'||tab==='ai'){
     let s=state.profileKey?stockByKey(state.profileKey):null;
     if(s)activateProfileVisualAnalysis(root,s,state.profilePreferTr===true);
    }
    window.ViewInvAINativeUI?.syncLayout?.();
    requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'smooth'}));
   }
   return;
  }
  let recoSold=e.target.closest&&e.target.closest('[data-reco-sold]');
  if(recoSold){e.preventDefault();e.stopPropagation();markRecommendationSold(recoSold.dataset.recoSold);return}
  let recoOpen=e.target.closest&&e.target.closest('[data-reco-open]');
  if(recoOpen){e.preventDefault();e.stopPropagation();let s=stockByKey(recoOpen.dataset.recoOpen);if(s)openStock(s,'Recomendación actual',recoOpen.dataset.recoPreferTr==='1');return}
  let b=e.target.closest&&e.target.closest('.fav-star');
  if(b){
   e.preventDefault();e.stopPropagation();
   let pref=b.dataset.favPreferTr;
   toggleFavorite(b.dataset.favKey,pref==='1'?true:pref==='0'?false:null);
   return;
  }
  let quickBack=e.target.closest&&e.target.closest('[data-stock-detail-back]');
  if(quickBack){e.preventDefault();e.stopPropagation();closeQuickProfile(true);return}
  let back=e.target.closest&&e.target.closest('[data-profile-back]');
  if(back){e.preventDefault();e.stopPropagation();closeQuickProfile(true);return}
  let row=e.target.closest&&e.target.closest('[data-stock-key]');
  if(row){
   if(e.target.closest&&e.target.closest('.external-links,.event-sources,.event-link,.catalog-col-filter'))return;
   e.preventDefault();e.stopPropagation();let s=stockByKey(row.dataset.stockKey),pref=row.dataset.stockPreferTr;if(s)openStock(s,row.dataset.stockReason||'',pref==='1'?true:pref==='0'?false:null);
  }
 });
 document.addEventListener('keydown',e=>{
  let row=e.target.closest&&e.target.closest('[data-stock-key]');
  if(!row||!['Enter',' '].includes(e.key)||e.target.closest('.fav-star,.catalog-col-filter'))return;
  e.preventDefault();let s=stockByKey(row.dataset.stockKey),pref=row.dataset.stockPreferTr;if(s)openStock(s,row.dataset.stockReason||'',pref==='1'?true:pref==='0'?false:null);
 });
}
