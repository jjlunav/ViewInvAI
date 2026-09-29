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
  assert(test.querySelector('.asset-venue-price'),'TR card does not use the LSX price cell');
  assert(!test.querySelector('.asset-extended-price,.asset-extended-change,.asset-session-icon'),'TR card leaked US pre/post data');
  test.innerHTML=quickProfileHtml(trStock,{preferTr:true});
  assert(test.querySelector('.profile-quote-lsx'),'TR profile hero does not use the LSX-only quote');
  assert(!test.querySelector('.profile-quote-extended'),'TR profile hero leaked US extended session');
  assert(![...test.querySelectorAll('.profile-disclosure summary')].some(x=>/Sesiones de mercado/i.test(x.textContent||'')),'TR profile exposes US pre/post disclosure');
 }
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
  assert(test.querySelector('.asset-regular-price')&&test.querySelector('.asset-regular-change'),name+' compact row lost primary quote');
  const isTrRow=!!test.querySelector('.asset-venue-price');
  const hasExtendedFixture=[stock.premarketPrice,stock.postmarketPrice].some(v=>Number.isFinite(Number(v)));
  if(isTrRow)assert(!test.querySelector('.asset-extended-price,.asset-extended-change,.asset-session-icon'),name+' TR row leaked US pre/post data');
  else if(hasExtendedFixture)assert(test.querySelector('.asset-extended-price')&&test.querySelector('.asset-extended-change'),name+' US row lost available REG/extended quote');
  else assert(!test.querySelector('.asset-extended-price,.asset-extended-change'),'US row fabricated extended data that the source does not contain');
  const ext=test.querySelector('.asset-extended-price')?.textContent||'';
  assert(!/10[.,]20|9[.,]80/.test(ext),name+' extended line shows the extended absolute price instead of the move');
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
  assert(rows[0].querySelector('.asset-regular-price')&&rows[0].querySelector('.asset-regular-change'),'portfolio US position does not use the shared compact stock row');
  const portfolioHasExtended=[stock.premarketPrice,stock.postmarketPrice].some(v=>Number.isFinite(Number(v)));
  if(portfolioHasExtended)assert(rows[0].querySelector('.asset-extended-price')&&rows[0].querySelector('.asset-extended-change'),'portfolio US position lost available extended quote');
  assert(rows[1].querySelector('.asset-venue-price'),'portfolio TR position does not use the LSX quote cell');
  assert(!rows[1].querySelector('.asset-extended-price,.asset-extended-change,.asset-session-icon'),'portfolio TR position leaked US pre/post data');
  assert(!view.querySelector('.portfolio-primary-tabs'),'obsolete portfolio/goal primary tabs remain');
  assert(view.querySelector('.portfolio-workbar [data-portfolio-goal-toggle]'),'goal control is not inside the stock portfolio toolbar');
  const assetTabs=[...view.querySelectorAll('.portfolio-asset-switch [role="tab"]')];
  assert(assetTabs.length===2&&assetTabs.every(t=>t.classList.contains('tab')),'portfolio asset control is not rendered as tabs');
  assert(view.querySelector('[data-portfolio-goal-toggle] svg'),'portfolio goal does not use the target SVG icon');
  const fundsApi=window.ViewInvAIFunds,stockPanel=document.querySelector('#portfolioApp'),fundPanel=document.querySelector('#fundPortfolioApp');
  assert(fundsApi&&typeof fundsApi.setPortfolioAssetMode==='function','portfolio asset mode controller is missing');
  fundsApi.setPortfolioAssetMode('funds',false);
  assert(stockPanel.hidden&&stockPanel.classList.contains('is-hidden')&&!fundPanel.hidden&&!fundPanel.classList.contains('is-hidden'),'stock and fund portfolio panels are visible at the same time');
  fundsApi.setPortfolioAssetMode('stocks',false);
  assert(!stockPanel.hidden&&!stockPanel.classList.contains('is-hidden')&&fundPanel.hidden&&fundPanel.classList.contains('is-hidden'),'portfolio panels did not return to stocks-only mode');
  ps.primaryTab='goal';portfolio.render();
  assert(view.querySelector('.portfolio-workbar [data-portfolio-goal-toggle].active'),'goal toolbar control did not become active');
  assert(view.querySelector('.portfolio-goal-view'),'goal view did not render inside stocks');
  const goalInput=view.querySelector('#portfolioGoalForm input[name="targetProfitEur"]');
  assert(goalInput&&goalInput.value==='1000'&&goalInput.step==='0.01'&&goalInput.checkValidity(),'goal amount 1000 is not a valid input');
  ps.primaryTab='portfolio';portfolio.render();
  const liveRow=view.querySelector('.portfolio-position-list [data-open-stock]');
  liveRow.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  assert(!document.querySelector('#stockQuickDetail').classList.contains('is-hidden'),'portfolio row did not open the shared detail');
  assert(document.querySelectorAll('#stockQuickDetail .unified-stock-header').length===1,'detail was duplicated');
  assert(!document.querySelector('#stockQuickDetail .unified-stock-header .quote-spread'),'profile hero leaked BID/ASK');
  const generalBidAsk=[...document.querySelectorAll('#stockQuickDetail [data-profile-panel="general"] .profile-stat-row')].some(el=>/BID\s*\/\s*ASK/i.test(el.textContent||''));
  assert(generalBidAsk,'General tab lost BID/ASK');
  closeQuickProfile(false);
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
