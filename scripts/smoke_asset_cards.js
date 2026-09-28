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
 for(const [name,html] of cases){
  test.innerHTML=html;
  assert(test.querySelectorAll('.asset-card').length===1,name+' has a different card template');
  const row=test.querySelector('.asset-card-row'),rect=row.getBoundingClientRect();
  assert(row.dataset.stockKey===key,name+' lost its stock target');
  assert(rect.height<=90&&rect.height>=48,name+' is not compact: '+rect.height);
  assert(row.scrollWidth<=row.clientWidth+1,name+' overflows horizontally');
  assert(test.querySelector('.fav-star'),name+' lost favourites');
  const copy=test.querySelector('[data-copy-isin]');
  if(copy){copy.click();assert(!document.body.classList.contains('stock-detail-open'),name+' copy opened the detail')}
 }
 test.innerHTML=window.ViewInvAICards.render({title:'<img src=x onerror=alert(1)>',isin:'US"<123',cells:[{value:'<script>bad</script>'}]});
 assert(!test.querySelector('img,script'),'untrusted text is interpreted as markup');
 test.remove();

 const portfolio=window.ViewInvAIPortfolios,ps=portfolio.getState(),saved={...ps};
 const view=document.querySelector('#view-portfolios'),display=view.style.display;
 try{
  Object.assign(ps,{user:{uid:'ci-fixture'},loading:false,selectedPortfolioId:'ci',portfolios:[{id:'ci',name:'CI fixture',base_currency:'USD'}],positions:[
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
  assert(rows[0].textContent.includes('P&L'),'portfolio result is not visible');
  row.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  assert(!document.querySelector('#stockQuickDetail').classList.contains('is-hidden'),'portfolio row did not open the shared detail');
  assert(document.querySelectorAll('#stockQuickDetail .unified-stock-header').length===1,'detail was duplicated');
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
