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
 const profileRoot=$('#stockQuickDetail');
 profileRoot?.addEventListener('click',e=>{
  const back=e.target.closest&&e.target.closest('[data-stock-detail-back],[data-profile-back],[data-portfolio-detail-close]');
  if(!back)return;
  e.preventDefault();e.stopImmediatePropagation();
  if(typeof returnFromProfileToOrigin==='function'&&(state.profileKey||document.body.classList.contains('stock-detail-open'))){
   returnFromProfileToOrigin();
  }else if(window.ViewInvAINavigation?.back){
   window.ViewInvAINavigation.back();
  }else{
   closeQuickProfile(true);
  }
 },true);
 $('#aiChatClose')?.addEventListener('click',closeAiChat);
 $('#aiChatBackdrop')?.addEventListener('click',closeAiChat);
 $('#aiChatForm')?.addEventListener('submit',e=>{
  e.preventDefault();
  askAiChat($('#aiChatInput')?.value||'');
 });

 const radarRoot=$('#recommendationResults');
 const openRadarCard=(event)=>{
  const explicit=event.target&&event.target.closest?event.target.closest('[data-radar-open-key]'):null;
  if(explicit&&radarRoot&&radarRoot.contains(explicit)){
   const control=event.target.closest&&event.target.closest('button,a,input,select,textarea,summary,label,[data-reco-mobile-group],[data-radar-tier],[data-radar-market]');
   if(control)return false;
   const stock=stockByKey(explicit.dataset.radarOpenKey);
   if(!stock)return false;
   event.preventDefault();event.stopPropagation();
   openStock(stock,'Radar AI',explicit.dataset.radarOpenTr==='1');
   return true;
  }
  const card=event.target&&event.target.closest?event.target.closest('.asset-card[data-card-context="recommendation"]'):null;
  if(!card||!radarRoot||!radarRoot.contains(card))return false;
  const control=event.target.closest&&event.target.closest('button,a,input,select,textarea,summary,label,[data-reco-mobile-group]');
  if(control)return false;
  const row=card.querySelector('[data-stock-key],[data-open-stock]');
  if(!row)return false;
  const key=row.dataset.stockKey||row.dataset.openStock;
  const stock=stockByKey(key);
  if(!stock)return false;
  const pref=row.dataset.stockPreferTr||row.dataset.positionPreferTr;
  event.preventDefault();
  event.stopPropagation();
  openStock(stock,row.dataset.stockReason||'Radar AI',pref==='1'?true:pref==='0'?false:null);
  return true;
 };
 radarRoot?.addEventListener('click',event=>{openRadarCard(event)},true);
 radarRoot?.addEventListener('keydown',event=>{
  if(!['Enter',' '].includes(event.key))return;
  if(openRadarCard(event))event.preventDefault();
 },true);

 document.addEventListener('click',e=>{
  let isinCopy=e.target.closest&&e.target.closest('[data-copy-isin]');
  if(isinCopy){
   if(isinCopy.closest('.portfolio-position-list'))return;
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
  // Solo los botones de pestaña: el contenedor de la ficha también lleva data-profile-tab (la pestaña activa) y
  // antes cualquier toque dentro de la ficha se tomaba como cambio de pestaña y no abría los desplegables.
  let profileTab=e.target.closest&&e.target.closest('button[data-profile-tab]');
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
  let profileEdit=e.target.closest&&e.target.closest('[data-profile-edit-position]');
  if(profileEdit){
   e.preventDefault();e.stopPropagation();
   window.ViewInvAIPortfolios?.openPositionEditorForStock?.(profileEdit.dataset.profileEditPosition||'');
   return;
  }
  let recoSold=e.target.closest&&e.target.closest('[data-reco-sold]');
  if(recoSold){e.preventDefault();e.stopPropagation();markRecommendationSold(recoSold.dataset.recoSold);return}

  // Pulso IA y Radar de entrada: toda la tarjeta compacta abre la ficha completa.
  // Los controles internos conservan su acción propia.
  let compactCard=e.target.closest&&e.target.closest('.asset-card[data-card-context="recommendation"],.asset-card[data-card-context="entry"]');
  if(compactCard){
   let control=e.target.closest&&e.target.closest('button,a,input,select,textarea,summary,[data-copy-isin],[data-reco-mobile-group]');
   if(!control){
    let row=compactCard.querySelector('[data-stock-key],[data-open-stock]');
    if(row){
     e.preventDefault();e.stopPropagation();
     let key=row.dataset.stockKey||row.dataset.openStock;
     let s=stockByKey(key),pref=row.dataset.stockPreferTr||row.dataset.positionPreferTr;
     if(s)openStock(s,row.dataset.stockReason||'',pref==='1'?true:pref==='0'?false:null);
     return;
    }
   }
  }

  let recoOpen=e.target.closest&&e.target.closest('[data-reco-open]');
  if(recoOpen){e.preventDefault();e.stopPropagation();let s=stockByKey(recoOpen.dataset.recoOpen);if(s)openStock(s,'Recomendación actual',recoOpen.dataset.recoPreferTr==='1');return}
  let b=e.target.closest&&e.target.closest('.fav-star');
  if(b){
   e.preventDefault();e.stopPropagation();
   let pref=b.dataset.favPreferTr;
   toggleFavorite(b.dataset.favKey,pref==='1'?true:pref==='0'?false:null);
   return;
  }
  let quickBack=e.target.closest&&e.target.closest('[data-stock-detail-back],[data-profile-back],[data-portfolio-detail-close]');
  if(quickBack){
   e.preventDefault();e.stopPropagation();
   if(window.ViewInvAINavigation?.back)window.ViewInvAINavigation.back();
   else closeQuickProfile(true);
   return
  }
  let row=e.target.closest&&e.target.closest('[data-stock-key][role="button"],.stock-open-row[data-stock-key],[data-open-stock]');
  // Un botón que lleva su propio data-open-stock (p. ej. el nombre enlazado en «Hoy toca») abre esa ficha.
  const ownButton=e.target.closest&&e.target.closest('button[data-open-stock]');
  if(ownButton)row=ownButton;
  if(row){
   if(!ownButton&&e.target.closest&&e.target.closest('button,a,input,select,textarea,summary,label,.external-links,.event-sources,.event-link,.catalog-col-filter'))return;
   e.preventDefault();e.stopPropagation();
   let key=row.dataset.stockKey||row.dataset.openStock,s=stockByKey(key),pref=row.dataset.stockPreferTr||row.dataset.positionPreferTr;
   if(s)openStock(s,row.dataset.stockReason||'',pref==='1'?true:pref==='0'?false:null);
  }
 });
 document.addEventListener('keydown',e=>{
  let row=e.target.closest&&e.target.closest('[data-stock-key][role="button"],.stock-open-row[data-stock-key],[data-open-stock]');
  if(!row||!['Enter',' '].includes(e.key)||e.target.closest('button,a,input,select,textarea,summary,label,.catalog-col-filter'))return;
  e.preventDefault();
  let key=row.dataset.stockKey||row.dataset.openStock,s=stockByKey(key),pref=row.dataset.stockPreferTr||row.dataset.positionPreferTr;
  if(s)openStock(s,row.dataset.stockReason||'',pref==='1'?true:pref==='0'?false:null);
 });
}

/* Preserve presentation state only across a render-host replacement.
 * No quote observation, persistent cache, form-value cache or cross-account state.
 */
let stockViewContinuityInitialized=false;
function initStockViewContinuity(){
 if(stockViewContinuityInitialized||typeof MutationObserver!=='function')return;
 stockViewContinuityInitialized=true;
 const detailsSelector='details.asset-card-details,details.stock-card-details,details.reco-disclosure,details.reco-mobile-detail,details.portfolio-position-more,details.catalog-mobile-filters,details.profile-disclosure';
 const scrollSelector='.stock-mobile-groups,.portfolio-tabs-track,.reco-mobile-groups,.event-mobile-groups,.catalog-mobile-groups,.fund-mobile-groups,.profile-tabs';
 const controlSelector='summary,button,a,input,select,textarea,[tabindex]';
 const hosts=['homeGroups','entryResults','recommendationResults','portfolioApp','fundPortfolioApp','fundsApp','futureResults','calendarResults','catalogResults','catalogUSResults','stockQuickDetail']
  .map(id=>document.getElementById(id)).filter(Boolean);
 const focusByHost=new WeakMap(),scrollByElement=new WeakMap();
 const elements=(node,selector)=>node.nodeType===1
  ?[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]:[];
 function continuityScope(host){
  try{
   const user=window.ViewInvAIAuth?.getUser?.();
   const account=String(user?.uid??user?.id??'');
   const portfolio=host.id==='portfolioApp'?window.ViewInvAIPortfolios?.getState?.():null;
   const profile=host.id==='stockQuickDetail'&&typeof state==='object'?state:null;
   return JSON.stringify([account,portfolio?.selectedPortfolioId??null,profile?.profileKey??null,profile?.profilePreferTr??null]);
  }catch(_){return '';}
 }
 function cardKey(el){
  const card=el.closest('.asset-card');
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
   const card=el.closest('.asset-card');
   const index=[...card.querySelectorAll(detailsSelector)].indexOf(el);
   return JSON.stringify(['card',key,el.dataset.uiStateKey||el.className,index]);
  }
  if(el.matches('details.profile-disclosure')){
   return JSON.stringify(['profile',el.dataset.uiStateKey||el.className,el.querySelector('summary')?.textContent.trim()||'']);
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
  let owner=continuityScope(host);
  host.addEventListener('focusout',event=>{
   const previous=event.target;
   queueMicrotask(()=>{
    if(previous.isConnected&&focusByHost.get(host)===previous&&document.activeElement!==previous)focusByHost.set(host,null);
   });
  });
  host.addEventListener('scroll',event=>{
   if(event.target.matches?.(scrollSelector))scrollByElement.set(event.target,event.target.scrollLeft);
  },true);
  new MutationObserver(records=>{
   const currentOwner=continuityScope(host);
   if(currentOwner!==owner){
    owner=currentOwner;focusByHost.set(host,null);
    if(host.id==='stockQuickDetail')delete host.dataset.profileTab;
    return;
   }
   const removed=records.flatMap(record=>[...record.removedNodes]).filter(node=>!node.isConnected);
   if(!removed.length)return;
   const openByKey=new Map(),leftByKey=new Map();
   let activeProfileTab=null;
   for(const node of removed){
    for(const details of elements(node,detailsSelector)){
     const key=detailKey(details);
     if(key&&!openByKey.has(key))openByKey.set(key,details.open);
    }
    for(const scroller of elements(node,scrollSelector)){
     const key=scrollKey(scroller);
     if(!leftByKey.has(key))leftByKey.set(key,scrollByElement.get(scroller)??scroller.scrollLeft);
    }
    if(host.id==='stockQuickDetail'&&!activeProfileTab){
     activeProfileTab=elements(node,'[data-profile-tab][aria-selected="true"]')[0]?.dataset.profileTab||null;
    }
   }
   if(openByKey.size)host.querySelectorAll(detailsSelector).forEach(details=>{
    const key=detailKey(details);
    if(openByKey.has(key))details.open=openByKey.get(key);
   });
   if(activeProfileTab&&host.querySelector('[data-profile-panel="'+CSS.escape(activeProfileTab)+'"]')){
    host.dataset.profileTab=activeProfileTab;
    host.querySelectorAll('[data-profile-tab]').forEach(button=>{
     const active=button.dataset.profileTab===activeProfileTab;
     button.classList.toggle('active',active);button.setAttribute('aria-selected',active?'true':'false');
    });
    host.querySelectorAll('[data-profile-panel]').forEach(panel=>{
     const active=panel.dataset.profilePanel===activeProfileTab||(activeProfileTab==='general'&&panel.dataset.profilePanel==='general-extra');
     panel.hidden=!active;panel.classList.toggle('active',active);
    });
    if(['chart','ai'].includes(activeProfileTab)&&typeof stockByKey==='function'&&typeof activateProfileTabData==='function'){
     const stock=stockByKey(state.profileKey);
     if(stock)activateProfileTabData(host,stock,state.profilePreferTr===true,activeProfileTab);
    }
    window.ViewInvAINativeUI?.syncLayout?.();
   }
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
