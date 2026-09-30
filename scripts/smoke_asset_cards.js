/* Runs only in the CI fixture copy, never in the deployed app or APK. */
window.checkAssetCards = async function () {
 const assert=(ok,message)=>{if(!ok)throw Error('Shared cards: '+message)};
 const stock=window.ViewInvAI.getAllStocks()[0];
 const key=window.ViewInvAI.getStockKey(stock);
 const test=document.createElement('div');
 test.style.cssText='position:fixed;top:0;left:0;width:min(420px,100%);z-index:99999;background:var(--bg)';
 document.body.appendChild(test);
 const cases=[
  ['home',homeStockRow(stock,0,'views')],
  ['radar',stockMobileRow(stock,0,'regular',false)],
  ['ideas',recommendationMobileItem('us',stock)],
  ['ideas desktop',recommendationCard('us',stock)],
  ['catalog',catalogMobileRow('us',stock,'regular')],
  ['events',eventMobileRow('calendar',stock,{},0,'Resultados','28/09/2026')]
 ];
 const trStock=window.ViewInvAI.getAllStocks().find(s=>s&&s.trTicker&&(s.tradeRepublicTradable===true||s.tradeRepublicVerified));
 if(trStock){
  test.innerHTML=standardStockCard(trStock,0,{se:'regular',preferTr:true,context:'ci-tr',detailsHtml:''});
  assert(test.querySelector('.asset-investing-quote[data-compact-quote-tr="1"]'),'TR card does not use the shared compact quote block');
  assert(test.querySelector('.asset-investing-main')&&test.querySelector('.asset-investing-status'),'TR compact quote is incomplete');
  assert(!test.querySelector('.asset-investing-extended'),'TR card leaked US pre/post data');
  test.innerHTML=quickProfileHtml(trStock,{preferTr:true});
  assert(test.querySelector('.profile-quote-lsx'),'TR profile hero does not use the LSX-only quote');
  assert(!test.querySelector('.profile-quote-extended'),'TR profile hero leaked US extended session');
  assert(test.querySelector('.profile-market-extra'),'TR profile does not keep market data permanently visible');
  assert(!test.querySelector('.profile-market-sessions'),'TR profile exposes US pre/post sessions');
  assert(!test.querySelector('[data-profile-panel="general"] details'),'TR general tab still contains collapsible market information');
 }
 test.innerHTML=quickProfileHtml(stock,{preferTr:false});
 assert(test.querySelector('.profile-market-sessions'),'US profile does not keep session data permanently visible');
 assert(test.querySelector('.profile-market-extra'),'US profile does not keep market data permanently visible');
 assert(!test.querySelector('[data-profile-panel="general"] details'),'US general tab still contains collapsible market information');
 assert(test.querySelector('.profile-market-sessions .profile-session-strip'),'US session values are not visible in General');

 const relativeFixture=extendedSessionDisplay({price:100,premarketPrice:101,premarketChangePct:9},'premarket');
 assert(Math.abs(relativeFixture.change-1)<0.0001,'extended percentage is not calculated versus regular price');

 for(const [name,html] of cases){
  test.innerHTML=html;
  assert(test.querySelectorAll('.asset-card').length===1,name+' has a different card template');
  const row=test.querySelector('.asset-card-row'),rect=row.getBoundingClientRect();
  assert(row.dataset.stockKey===key,name+' lost its stock target');
  assert(rect.height<=90&&rect.height>=48,name+' is not compact: '+rect.height);
  assert(row.scrollWidth<=row.clientWidth+1,name+' overflows horizontally');
  assert(test.querySelector('.fav-star'),name+' lost favourites');
  const compact=test.querySelector('.asset-investing-quote');
  assert(compact,name+' compact row lost the shared quote block');
  assert(compact.querySelector('.asset-investing-main'),name+' compact row lost regular/current market price');
  assert(compact.querySelector('.asset-investing-status'),name+' compact row lost market state/date');
  const isTrRow=compact.dataset.compactQuoteTr==='1';
  const hasExtendedFixture=[stock.premarketPrice,stock.postmarketPrice].some(v=>Number.isFinite(Number(v)));
  if(isTrRow)assert(!compact.querySelector('.asset-investing-extended'),name+' TR row leaked US pre/post data');
  else if(hasExtendedFixture&&['premarket','postmarket'].includes(currentMarketSession()))assert(compact.querySelector('.asset-investing-extended'),name+' US row lost available extended-session quote');
  assert(!/\bBID\b|\bASK\b/.test(test.textContent),name+' exposes BID/ASK in compact mode');
  const copy=test.querySelector('[data-copy-isin]');
  if(copy){copy.click();assert(!document.body.classList.contains('stock-detail-open'),name+' copy opened the detail')}
 }
 test.innerHTML=window.ViewInvAICards.render({title:'<img src=x onerror=alert(1)>',isin:'US"<123',cells:[{value:'<script>bad</script>'}]});
 assert(!test.querySelector('img,script'),'untrusted text is interpreted as markup');
 test.remove();

 const portfolio=window.ViewInvAIPortfolios,ps=portfolio.getState(),saved={...ps};
 const view=document.querySelector('#view-portfolios'),display=view.style.display;
 try{
  Object.assign(ps,{user:{uid:'ci-fixture'},loading:false,primaryTab:'portfolio',goal:{target_profit_eur:1000},selectedPortfolioId:'ci',portfolios:[{id:'ci',name:'CI fixture',base_currency:'USD'}],positions:[
   {id:'ci-1',portfolio_id:'ci',stock_key:key,ticker:stock.ticker,quantity:2,avg_price:8,currency:'USD',prefer_tr:0,active:1},
   {id:'ci-2',portfolio_id:'ci',stock_key:key,ticker:stock.ticker,quantity:3,avg_price:9,currency:'USD',prefer_tr:1,active:1}
  ],watchlist:[],portfolioTransactionSummaries:{}});
  portfolio.render();view.style.display='block';
  const rows=[...view.querySelectorAll('.portfolio-position-list .asset-card')];
  assert(rows.length===2,'portfolio positions did not render');
  const a=rows[0].getBoundingClientRect(),b=rows[1].getBoundingClientRect();
  assert(Math.abs(a.left-b.left)<2&&b.top>=a.bottom-1,'portfolio uses square tiles instead of one row per position');
  const row=rows[0].querySelector('[data-open-stock]');
  assert(row.dataset.positionPreferTr==='0','portfolio lost preferred market');
  const buyAction=rows[0].querySelector('[data-position-transactions][data-position-side="BUY"]');
  const sellAction=rows[0].querySelector('[data-position-transactions][data-position-side="SELL"]');
  assert(buyAction&&sellAction,'portfolio position lost direct buy/sell controls');
  assert(rows[0].querySelector('.asset-investing-quote[data-compact-quote-tr="0"]')&&rows[0].querySelector('.asset-investing-main'),'portfolio US position does not use the shared compact stock row');
  assert(rows[1].querySelector('.asset-investing-quote[data-compact-quote-tr="1"]'),'portfolio TR position does not use the shared LSX compact quote');
  assert(!rows[1].querySelector('.asset-investing-extended,.asset-session-icon'),'portfolio TR position leaked US pre/post data');
  assert(!view.querySelector('[data-portfolio-goal-toggle]'),'portfolio view still exposes the obsolete internal goal control');
  const goalTab=view.querySelector('[data-portfolio-asset="goal"]');
  assert(goalTab,'portfolio goal tab is missing after Funds / ETFs');
  const cashRow=view.querySelector('[data-portfolio-cash-edit="ci"]');
  assert(cashRow&&/Capital líquido/.test(cashRow.textContent),'manual liquid-capital row is missing');
  const assetTabs=[...view.querySelectorAll('.portfolio-asset-switch [role="tab"]')];
  assert(assetTabs.length===3&&assetTabs.every(t=>t.classList.contains('tab')),'portfolio asset control is not rendered as tabs');
  const fundsApi=window.ViewInvAIFunds,stockPanel=document.querySelector('#portfolioApp'),fundPanel=document.querySelector('#fundPortfolioApp');
  assert(fundsApi&&typeof fundsApi.setPortfolioAssetMode==='function','portfolio asset mode controller is missing');
  fundsApi.setPortfolioAssetMode('funds',false);
  assert(stockPanel.hidden&&stockPanel.classList.contains('is-hidden')&&!fundPanel.hidden&&!fundPanel.classList.contains('is-hidden'),'stock and fund portfolio panels are visible at the same time');
  fundsApi.setPortfolioAssetMode('stocks',false);
  assert(!stockPanel.hidden&&!stockPanel.classList.contains('is-hidden')&&fundPanel.hidden&&fundPanel.classList.contains('is-hidden'),'portfolio panels did not return to stocks-only mode');
  fundsApi.setPortfolioAssetMode('goal',false);
  const goalView=document.querySelector('#portfolioGoalApp');
  assert(!goalView.hidden&&!goalView.classList.contains('is-hidden'),'portfolio goal panel did not open');
  assert(goalView.querySelector('.portfolio-goal-view'),'portfolio goal view did not render');
  assert(goalView.querySelector('[data-goal-history="ci"]'),'goal recommendation history control is missing');
  const goalInput=goalView.querySelector('#portfolioGoalForm input[name="targetProfitEur"]');
  assert(goalInput&&goalInput.value==='1000'&&goalInput.step==='0.01'&&goalInput.checkValidity(),'goal amount 1000 is not a valid input');
  fundsApi.setPortfolioAssetMode('stocks',false);
  const liveRow=view.querySelector('.portfolio-position-list [data-open-stock]');
  liveRow.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  assert(!document.querySelector('#stockQuickDetail').classList.contains('is-hidden'),'portfolio row did not open the shared stock detail');
  assert(!document.querySelector('#portfolioModal')?.classList.contains('open'),'portfolio row incorrectly opened the exposure manager');
  assert(document.querySelectorAll('#stockQuickDetail .unified-stock-header').length===1,'portfolio row duplicated the shared detail');
  closeQuickProfile(false);
  const profileButton=view.querySelector('[data-portfolio-stock-profile]');
  assert(profileButton&&/Ficha/.test(profileButton.textContent||''),'explicit Ficha button is missing');
  profileButton.click();
  assert(!document.querySelector('#stockQuickDetail').classList.contains('is-hidden'),'Ficha button did not open the shared detail');
  assert(document.querySelectorAll('#stockQuickDetail .unified-stock-header').length===1,'detail was duplicated');
  assert(!document.querySelector('#stockQuickDetail .unified-stock-header .quote-spread'),'profile hero leaked BID/ASK');
  const generalBidAsk=[...document.querySelectorAll('#stockQuickDetail [data-profile-panel="general"] .profile-stat-row')].some(el=>/BID\s*\/\s*ASK/i.test(el.textContent||''));
  assert(generalBidAsk,'General tab lost BID/ASK');
  const chartTab=document.querySelector('#stockQuickDetail [data-profile-tab="chart"]');
  assert(chartTab,'profile chart tab is missing');
  chartTab.click();
  assert(document.querySelector('#stockQuickDetail [data-profile-panel="chart"]')?.hidden===false,'profile chart tab did not activate');
  const profileBack=document.querySelector('#stockQuickDetail [data-stock-detail-back]');
  assert(profileBack,'profile back control is missing after tab navigation');
  profileBack.click();
  assert(document.querySelector('#stockQuickDetail').classList.contains('is-hidden'),'profile back failed after navigating inside the profile');
  assert(document.querySelector('#view-portfolios').classList.contains('active'),'profile back did not return to portfolios after internal tab navigation');
 }finally{
  Object.assign(ps,saved);portfolio.render();view.style.display=display;
 }
 renderHome();
 await new Promise(resolve=>setTimeout(resolve,30));
 const disclosure=document.querySelector('#homeGroups .asset-card-details');
 if(disclosure){
  disclosure.querySelector("summary").click();
  await new Promise(resolve=>setTimeout(resolve,30));
  renderHome();
  await new Promise(resolve=>setTimeout(resolve,30));
  assert(document.querySelector('#homeGroups .asset-card-details').open,'quote refresh closed expanded details');
 }
 assert(document.documentElement.scrollWidth<=window.innerWidth+1,'page has horizontal overflow');
 document.documentElement.dataset.assetCardsSmoke='ok';
};
