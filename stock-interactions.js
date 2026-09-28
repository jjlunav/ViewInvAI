/*
 * ViewInvAI stock interactions
 * ----------------------------
 * Event wiring for stock cards, profile controls, charts and AI actions.
 * Loaded after stock-profile.js and stock-charts.js, initialized by bootstrap.js.
 */

function showListCopyToast(text){
 let el=document.querySelector('.list-copy-toast');
 if(!el){el=document.createElement('div');el.className='list-copy-toast';document.body.appendChild(el)}
 el.textContent=text;el.classList.add('show');
 clearTimeout(showListCopyToast.timer);
 showListCopyToast.timer=setTimeout(()=>el.classList.remove('show'),1200);
}
function copyListIsin(value){
 value=String(value||'').trim();if(!value||value==='—')return;
 if(navigator.clipboard&&navigator.clipboard.writeText){
  navigator.clipboard.writeText(value).then(()=>showListCopyToast('ISIN copiado')).catch(()=>fallbackCopyListIsin(value));
  return;
 }
 fallbackCopyListIsin(value);
}
function fallbackCopyListIsin(value){
 let area=document.createElement('textarea');area.value=value;area.setAttribute('readonly','');
 area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();
 try{document.execCommand('copy');showListCopyToast('ISIN copiado')}catch(_){showListCopyToast(value)}
 area.remove();
}

function initStockInteractions(){
 initStockViewContinuity();
 $('#aiChatClose')?.addEventListener('click',closeAiChat);
 $('#aiChatBackdrop')?.addEventListener('click',closeAiChat);
 $('#aiChatForm')?.addEventListener('submit',e=>{
  e.preventDefault();
  askAiChat($('#aiChatInput')?.value||'');
 });

 document.addEventListener('click',e=>{
  let isinCopy=e.target.closest&&e.target.closest('[data-copy-isin]');
  if(isinCopy){
   e.preventDefault();e.stopPropagation();
   copyListIsin(isinCopy.dataset.copyIsin||isinCopy.textContent);
   return;
  }
  let recoGroup=e.target.closest&&e.target.closest('[data-reco-mobile-group]');
  if(recoGroup){
   e.preventDefault();e.stopPropagation();
   if(typeof setRecommendationMobileGroup==='function')setRecommendationMobileGroup(recoGroup.dataset.recoMobileGroup||'general');
   return;
  }
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
     if(s)activateProfileTabData(root,s,state.profilePreferTr===true,tab);
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
  if(!row||!['Enter',' '].includes(e.key)||e.target.closest('button,a,input,select,textarea,summary,.catalog-col-filter'))return;
  e.preventDefault();let s=stockByKey(row.dataset.stockKey),pref=row.dataset.stockPreferTr;if(s)openStock(s,row.dataset.stockReason||'',pref==='1'?true:pref==='0'?false:null);
 });
}

/* Preserve presentation state only across a render-host replacement.
 * No quote observation, persistent cache, form-value cache or cross-account state.
 */
let stockViewContinuityInitialized=false;
function initStockViewContinuity(){
 if(stockViewContinuityInitialized||typeof MutationObserver!=='function')return;
 stockViewContinuityInitialized=true;
 const detailsSelector='details.stock-card-details,details.reco-disclosure,details.reco-mobile-detail,details.portfolio-position-more,details.catalog-mobile-filters';
 const scrollSelector='.stock-mobile-groups,.portfolio-tabs-track,.reco-mobile-groups,.event-mobile-groups,.catalog-mobile-groups,.fund-mobile-groups';
 const controlSelector='summary,button,a,input,select,textarea,[tabindex]';
 const hosts=['homeGroups','entryResults','recommendationResults','portfolioApp','fundPortfolioApp','fundsApp','futureResults','calendarResults','catalogResults','catalogUSResults']
  .map(id=>document.getElementById(id)).filter(Boolean);
 const focusByHost=new WeakMap(),scrollByElement=new WeakMap();
 const elements=(node,selector)=>node.nodeType===1
  ?[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]:[];
 function accountKey(){
  try{
   const user=window.ViewInvAIAuth?.getUser?.();
   return String(user?.uid??user?.id??'');
  }catch(_){return '';}
 }
 function cardKey(el){
  const card=el.closest('.investing-stock-card,.recommendation-card,.stock-mobile-line,.reco-mobile-line,.event-mobile-line,.catalog-mobile-line,.portfolio-position,.fund-mobile-row');
  if(!card)return '';
  const selector='[data-stock-key],[data-open-stock],[data-reco-open],[data-fund-detail],[data-fund-isin]';
  const ref=card.matches(selector)?card:card.querySelector(selector);
  if(!ref)return '';
  const data=ref.dataset;
  const position=card.querySelector('[data-position-transactions]');
  return JSON.stringify([
   data.stockKey||data.openStock||data.recoOpen||data.fundDetail||data.fundIsin||'',
   data.stockPreferTr??data.positionPreferTr??data.recoPreferTr??'',
   position?.dataset.positionTransactions||'',
   card.closest('.home-market-panel')?.className||''
  ]);
 }
 function detailKey(el){
  const key=cardKey(el);
  if(key){
   const card=el.closest('.investing-stock-card,.recommendation-card,.stock-mobile-line,.reco-mobile-line,.event-mobile-line,.catalog-mobile-line,.portfolio-position,.fund-mobile-row');
   const index=[...card.querySelectorAll(detailsSelector)].indexOf(el);
   return JSON.stringify(['card',key,el.dataset.uiStateKey||el.className,index]);
  }
  const host=hosts.find(item=>item.contains(el));
  if(!host)return '';
  const index=[...host.querySelectorAll(detailsSelector)].indexOf(el);
  return JSON.stringify(['host',host.id,el.id||el.className,index]);
 }
 function controlKey(el){
  if(el.tagName==='SUMMARY'){
   const details=el.closest(detailsSelector),key=details&&detailKey(details);
   return key?'summary:'+key:'';
  }
  if(el.id)return 'id:'+el.id;
  const attrs=[...el.attributes].filter(a=>a.name.startsWith('data-')&&a.name!=='data-stock-reason')
   .map(a=>[a.name,a.value]).sort((a,b)=>a[0].localeCompare(b[0]));
  return attrs.length?JSON.stringify([el.tagName,cardKey(el),attrs]):'';
 }
 function scrollKey(el){
  return el.id||JSON.stringify([el.className,el.getAttribute('aria-label')||'',el.closest('.home-market-panel')?.className||'']);
 }
 document.addEventListener('focusin',event=>{
  hosts.forEach(host=>focusByHost.set(host,host.contains(event.target)?event.target:null));
 });
 hosts.forEach(host=>{
  let owner=accountKey();
  host.addEventListener('scroll',event=>{
   if(event.target.matches?.(scrollSelector))scrollByElement.set(event.target,event.target.scrollLeft);
  },true);
  new MutationObserver(records=>{
   const currentOwner=accountKey();
   if(currentOwner!==owner){owner=currentOwner;focusByHost.set(host,null);return;}
   const removed=records.flatMap(record=>[...record.removedNodes]);
   if(!removed.length)return;
   const openByKey=new Map(),leftByKey=new Map();
   for(const node of removed){
    for(const details of elements(node,detailsSelector)){
     const key=detailKey(details);
     if(key&&!openByKey.has(key))openByKey.set(key,details.open);
    }
    for(const scroller of elements(node,scrollSelector)){
     const key=scrollKey(scroller);
     if(!leftByKey.has(key))leftByKey.set(key,scrollByElement.get(scroller)??scroller.scrollLeft);
    }
   }
   if(openByKey.size)host.querySelectorAll(detailsSelector).forEach(details=>{
    const key=detailKey(details);
    if(openByKey.has(key))details.open=openByKey.get(key);
   });
   if(leftByKey.size)host.querySelectorAll(scrollSelector).forEach(scroller=>{
    const left=leftByKey.get(scrollKey(scroller));
    if(left!==undefined){scroller.scrollLeft=left;scrollByElement.set(scroller,left);}
   });
   const previous=focusByHost.get(host);
   if(!previous||previous.isConnected||document.activeElement!==document.body)return;
   if(!removed.some(node=>node===previous||node.contains?.(previous)))return;
   const key=controlKey(previous);
   const next=key&&[...host.querySelectorAll(controlSelector)].find(el=>controlKey(el)===key);
   // Do not move focus to an inactive view or a closed disclosure.
   if(next&&next.getClientRects().length)next.focus({preventScroll:true});
   else focusByHost.set(host,null);
  }).observe(host,{childList:true});
 });
}
