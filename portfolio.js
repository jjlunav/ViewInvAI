const state = {
  user: null,
  portfolios: [],
  positions: [],
  watchlist: [],
  brokers: [],
  portfolioTransactionSummaries: {},
  selectedPortfolioId: null,
  primaryTab: "portfolio",
  goal: null,
  goals: {},
  goalError: "",
  goalCandidateCache: { at: 0, key: "", rows: [] },
  goalReviewTimers: {},
  pendingGoalHistory: null,
  goalHistoryPosted: {},
  loading: false
};

const PORTFOLIO_UI_KEY = "viewinvai:portfolioUi:v2";
try {
  const saved = JSON.parse(localStorage.getItem(PORTFOLIO_UI_KEY) || "{}");
  state.selectedPortfolioId = saved && saved.selectedPortfolioId || null;
  state.primaryTab = saved && saved.primaryTab === "goal" ? "goal" : "portfolio";
} catch (_) {}

const $ = selector => document.querySelector(selector);

function savePortfolioUi() {
  try {
    localStorage.setItem(PORTFOLIO_UI_KEY, JSON.stringify({
      selectedPortfolioId: state.selectedPortfolioId || null,
      primaryTab: state.primaryTab === "goal" ? "goal" : "portfolio"
    }));
  } catch (_) {}
}

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function num(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatNumber(value, digits = 2) {
  const n = num(value);
  return n === null ? "—" : n.toLocaleString("es-ES", { maximumFractionDigits: digits });
}

function formatMoney(value, currency = "EUR") {
  const n = num(value);
  if (n === null) return "—";
  try {
    return n.toLocaleString("es-ES", { style: "currency", currency: currency || "EUR", maximumFractionDigits: 2 });
  } catch (_) {
    return formatNumber(n, 2) + " " + (currency || "");
  }
}

function toast(message, error = false) {
  let el = $("#portfolioToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "portfolioToast";
    el.className = "portfolio-toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.toggle("error", !!error);
  el.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("visible"), 2300);
}

function api(path, options = {}) {
  if (!window.ViewInvAIAuth || typeof window.ViewInvAIAuth.apiFetch !== "function") {
    throw new Error("La cuenta todavía no está disponible.");
  }
  return window.ViewInvAIAuth.apiFetch(path, options);
}

function stockByKey(key) {
  return window.ViewInvAI && typeof window.ViewInvAI.getStockByKey === "function"
    ? window.ViewInvAI.getStockByKey(key)
    : null;
}

function canonicalStockKey(value) {
  const stock = stockByKey(value);
  if (stock && window.ViewInvAI && typeof window.ViewInvAI.getStockKey === "function") {
    return String(window.ViewInvAI.getStockKey(stock) || "").trim().toUpperCase();
  }
  return String(value || "").trim().toUpperCase();
}

function sameStockRef(a, b) {
  const left = canonicalStockKey(a), right = canonicalStockKey(b);
  return !!left && !!right && left === right;
}

function selectedPortfolio(){
  return state.portfolios.find(p=>String(p.id||"")===String(state.selectedPortfolioId||""))||null;
}
function selectedPortfolioGoal(){
  const selected=selectedPortfolio();if(!selected)return null;
  return state.goals[String(selected.id)]||null;
}
function portfolioMarketScope(portfolio,positions=null){
  if(!portfolio)return"auto";
  const explicit=String(portfolio.market_scope||"auto").toLowerCase();
  if(explicit==="tr"||explicit==="us")return explicit;
  const rows=positions||portfolioPositions(portfolio.id);
  if(rows.length&&rows.every(p=>Number(p.prefer_tr)===1))return"tr";
  if(rows.length&&rows.every(p=>Number(p.prefer_tr)!==1))return"us";
  if(/trade\s*republic|lsx/i.test(String(portfolio.broker||"")))return"tr";
  return"auto";
}
function portfolioMarketLabel(scope){
  return scope==="tr"?"Trade Republic / LSX":scope==="us"?"EEUU (NASDAQ / NYSE / AMEX)":"Mercado sin definir";
}
function portfolioMarketPreferTr(portfolio){
  return portfolioMarketScope(portfolio)==="tr";
}
function portfolioGoalTarget(){
  const goal=selectedPortfolioGoal()||state.goal||null;
  if(!goal)return null;
  return num(goal.target_value_eur!==undefined?goal.target_value_eur:goal.target_profit_eur);
}
function portfolioGoalConfig(){
  const goal=selectedPortfolioGoal()||state.goal||null;
  return{
    target:goal?num(goal.target_value_eur!==undefined?goal.target_value_eur:goal.target_profit_eur):null,
    riskProfile:goal&&["conservative","balanced","aggressive"].includes(String(goal.risk_profile||"").toLowerCase())?String(goal.risk_profile).toLowerCase():"aggressive"
  };
}
function portfolioGoalRiskBand(riskProfile){
  const bands={
    conservative:{label:"Conservador",maxPosition:18,minCandidate:82,minQuality:72,minVelocity:82,minComposite:84},
    balanced:{label:"Equilibrado",maxPosition:30,minCandidate:80,minQuality:68,minVelocity:80,minComposite:82},
    aggressive:{label:"Agresivo",maxPosition:45,minCandidate:78,minQuality:62,minVelocity:78,minComposite:80}
  };
  return bands[riskProfile]||bands.aggressive;
}
function wholeRecommendationUnits(quantity,desired){
  const qty=Math.max(0,num(quantity)||0),available=Math.max(0,Math.floor(qty+1e-9));
  if(available<1||!(desired>0))return 0;
  return Math.max(1,Math.min(available,Math.round(desired)));
}
function portfolioOperationFee(preferTr){
  return preferTr?1:0;
}
function brokerRecords(){
  const builtins=[
    {name:"Trade Republic",canonical_name:"Trade Republic",code:"TR",verification_status:"verified",plan:"Standard",fee_rules_json:JSON.stringify({type:"flat",buy:1,sell:1,currency:"EUR"})},
    {name:"IBKR",canonical_name:"Interactive Brokers",code:"IBKR",verification_status:"verified",plan:"Pro Fixed",fee_rules_json:JSON.stringify({type:"per_share",perShare:.005,min:1,maxPct:1,currency:"USD",market:"US"})}
  ];
  const seen=new Set(),rows=[];
  for(const row of [...builtins,...(state.brokers||[])]){
    const key=String(row.code||row.canonical_name||row.name||"").trim().toLowerCase();
    if(!key||seen.has(key))continue;seen.add(key);rows.push(row);
  }
  return rows;
}
function brokerDisplayName(row){
  if(!row)return"";
  const base=String(row.name||row.canonical_name||"").trim();
  const status=String(row.verification_status||"").toLowerCase();
  return base+(status==="pending"?" · verificando…":"");
}
function brokerRecordByName(name){
  const key=String(name||"").trim().toLowerCase();
  return brokerRecords().find(row=>[row.name,row.canonical_name,row.code].some(v=>String(v||"").trim().toLowerCase()===key))||null;
}
function brokerFeeEstimate(brokerName,quantity,price,currency,side="BUY"){
  const row=brokerRecordByName(brokerName),qty=Math.max(0,num(quantity)||0),px=Math.max(0,num(price)||0),tradeValue=qty*px;
  if(!row)return{fee:null,currency:String(currency||"EUR").toUpperCase(),verified:false,label:"Pendiente de verificar"};
  let rules={};try{rules=JSON.parse(row.fee_rules_json||"{}")||{}}catch(_){}
  const feeCurrency=String(rules.currency||currency||"EUR").toUpperCase(),type=String(rules.type||"").toLowerCase();
  let fee=null;
  if(type==="flat"){
    const value=num(String(side).toUpperCase()==="SELL"?rules.sell:rules.buy);
    fee=value!==null?value:null;
  }else if(type==="per_share"){
    const per=num(rules.perShare),minimum=num(rules.min)||0,maxPct=num(rules.maxPct);
    if(per!==null){
      fee=Math.max(minimum,qty*per);
      if(maxPct!==null&&tradeValue>0)fee=Math.min(fee,tradeValue*maxPct/100);
    }
  }
  return{fee,currency:feeCurrency,verified:String(row.verification_status||"verified")==="verified",label:row.plan||row.canonical_name||row.name||brokerName};
}

function portfolioPriceToEur(price,currency,fxUsdEur){
  const value=num(price),code=String(currency||"EUR").toUpperCase();
  if(value===null)return null;
  if(code==="EUR")return value;
  if(code==="USD"&&num(fxUsdEur)!==null)return value*num(fxUsdEur);
  return null;
}
function portfolioConvertAmount(value,fromCurrency,toCurrency,fxUsdEur=portfolioUsdToEurRate()){
  const amount=num(value),from=String(fromCurrency||"EUR").toUpperCase(),to=String(toCurrency||"EUR").toUpperCase(),fx=num(fxUsdEur);
  if(amount===null)return null;
  if(from===to)return amount;
  if(from==="USD"&&to==="EUR"&&fx!==null)return amount*fx;
  if(from==="EUR"&&to==="USD"&&fx!==null&&fx>0)return amount/fx;
  return null;
}
function goalExecutionQuote(stock,preferTr,side,fxUsdEur){
  const market=currentMarket(stock,preferTr),currency=String(market.currency||(preferTr?"EUR":"USD")).toUpperCase();
  const bid=num(market.bid),ask=num(market.ask),last=num(market.price),spread=num(market.spreadPct);
  let price=null,orderType="LIMITE",instruction="",immediate=false;
  if(String(side||"BUY").toUpperCase()==="SELL"){
    price=bid??last;
    instruction=bid!==null?"Venta límite en BID":"Venta límite sobre último precio";
    immediate=bid!==null;
  }else if(bid!==null&&ask!==null&&ask>=bid){
    const gap=ask-bid;
    if(spread!==null&&spread<=1.2){
      price=ask;instruction="Límite al ASK";immediate=true;
    }else if(spread!==null&&spread<=3){
      price=bid+gap*.50;instruction="Límite en zona media del spread";
    }else{
      price=bid+gap*.25;instruction="Esperar · límite conservador dentro del spread";
    }
  }else{
    price=last;instruction="Límite sobre último precio · BID/ASK incompleto";
  }
  if(price!==null){
    const decimals=Math.abs(price)<1?4:Math.abs(price)<10?3:2;
    price=Number(price.toFixed(decimals));
  }
  const unitEur=portfolioPriceToEur(price,currency,fxUsdEur),feeEur=preferTr?1:0;
  return{market,currency,bid,ask,spreadPct:spread,price,unitEur,feeEur,orderType,instruction,immediate};
}

function portfolioStockKeys() {
  return [...new Set(state.positions.filter(p => Number(p.active) !== 0).map(p => canonicalStockKey(p.stock_key)).filter(Boolean))];
}
function watchlistStockKeys(){
  return [...new Set(state.watchlist.map(w=>canonicalStockKey(w.stock_key)).filter(Boolean))];
}
function favoriteStockKeys(){
  return watchlistStockKeys();
}
function syncPortfolioStars() {
  if (window.ViewInvAI && typeof window.ViewInvAI.replaceFavoriteKeys === "function") {
    window.ViewInvAI.replaceFavoriteKeys(favoriteStockKeys());
  }
  try{
    const key=typeof state!=="undefined"&&state.profileKey?state.profileKey:null,stock=key?stockByKey(key):null;
    if(stock&&typeof refreshProfilePortfolioActions==="function")refreshProfilePortfolioActions(stock);
  }catch(_){}
}

function openStockInline(key, preferTr = null) {
  const stock = stockByKey(key);
  if (!stock) {
    toast("No se pudo localizar esa acción en el mercado actual.", true);
    return false;
  }
  if (window.ViewInvAI && typeof window.ViewInvAI.openStockByKey === "function") {
    return window.ViewInvAI.openStockByKey(canonicalStockKey(key), "Cartera · posición activa", preferTr);
  }
  return false;
}

function signalInfo(signal) {
  const key = String(signal || "").toUpperCase();
  const map = {
    HOLD: ["MANTENER", "good"],
    REVIEW: ["REVISAR", "warn"],
    SELL: ["VENDER", "bad"],
    BUY: ["COMPRAR", "good"],
    WATCH: ["VIGILAR", "neutral"],
    AVOID: ["EVITAR", "bad"]
  };
  return map[key] || ["SIN ANALIZAR", "neutral"];
}

function currentMarket(stock, preferTr = false) {
  if (!stock) return { price: null, change: null, currency: preferTr ? "EUR" : "USD", eur: null, usd: null, bid: null, ask: null, spreadPct: null, source: "", updatedAt: null };
  const bid=num(preferTr?stock.trLiveBid:stock.usLiveBid),ask=num(preferTr?stock.trLiveAsk:stock.usLiveAsk);
  const mid=bid!==null&&ask!==null&&ask>=bid?(bid+ask)/2:null;
  const spread=mid&&mid>0?(ask-bid)/mid*100:null;
  if (window.ViewInvAI && (typeof window.ViewInvAI.getCanonicalQuote === "function" || typeof window.ViewInvAI.getDisplayQuote === "function")) {
    let quote = typeof window.ViewInvAI.getCanonicalQuote === "function"
      ? window.ViewInvAI.getCanonicalQuote(stock, !!preferTr)
      : null;
    if ((!quote || num(quote.price) === null) && typeof window.ViewInvAI.getDisplayQuote === "function") {
      quote = window.ViewInvAI.getDisplayQuote(stock, !!preferTr);
    }
    quote = quote || {};
    return {
      price: num(quote.price),
      change: num(quote.change),
      currency: quote.nativeCurrency || (preferTr ? "EUR" : "USD"),
      eur: num(quote.eur),
      usd: num(quote.usd),
      bid, ask, spreadPct:spread,
      source: quote.source || "",
      updatedAt: quote.updatedAt || null,
      session: quote.session || null,
      live: quote.live === true,
      fallback: quote.fallback === true
    };
  }
  if (preferTr) {
    const eur = num(stock.trLivePrice);
    return { price: eur, change: num(stock.trLiveChangePct), currency: "EUR", eur, usd: null, bid, ask, spreadPct:spread, source: "Trade Republic / LSX" };
  }
  const usd = num(stock.usLivePrice) ?? num(stock.price);
  return { price: usd, change: num(stock.usLiveChangePct) ?? num(stock.changePct), currency: "USD", eur: null, usd, bid, ask, spreadPct:spread, source: "EEUU" };
}

function marketValueInCurrency(market, currency) {
  const c = String(currency || "").toUpperCase();
  if (c === "EUR") return num(market && market.eur);
  if (c === "USD") return num(market && market.usd);
  return num(market && market.price);
}

function quotePairHtml(stock, preferTr) {
  if (window.ViewInvAI && typeof window.ViewInvAI.renderPricePair === "function") {
    return window.ViewInvAI.renderPricePair(stock, !!preferTr);
  }
  const market = currentMarket(stock, preferTr);
  return '<strong>' + formatMoney(market.price, market.currency) + '</strong>';
}

function changeHtml(value) {
  const n = num(value);
  if (n === null) return '<span class="portfolio-change neutral">—</span>';
  const cls = n > 0 ? "up" : n < 0 ? "down" : "neutral";
  return '<span class="portfolio-change ' + cls + '">' + (n > 0 ? "+" : "") + formatNumber(n, 2) + "%</span>";
}

function analysisBadge(item) {
  const [label, cls] = signalInfo(item.last_signal);
  const confidence = num(item.last_confidence);
  const score = num(item.last_score);
  return '<div class="portfolio-ai-state ' + cls + '">' +
    '<strong>' + esc(label) + '</strong>' +
    '<span>' + (confidence === null ? "Pendiente" : Math.round(confidence) + "% confianza") + '</span>' +
    (score === null ? "" : '<small>score ' + Math.round(score) + '</small>') +
  '</div>';
}

function portfolioPositions(portfolioId) {
  const id = String(portfolioId ?? "");
  return state.positions.filter(p => String(p.portfolio_id ?? "") === id && Number(p.active) !== 0);
}

function portfolioGoalHoldingsSignature(metrics){
  if(!metrics||!metrics.portfolio)return"";
  const rows=(metrics.rows||[]).map(row=>{
    const key=portfolioStockKey(row.stock)||String(row.p&&row.p.stock_key||"");
    const qty=num(row.qty),avg=num(row.avgEur),value=num(row.valueEur);
    return [key,qty===null?"":qty.toFixed(8),avg===null?"":avg.toFixed(6),value===null?"":value.toFixed(4),row.preferTr?1:0].join("~");
  }).sort();
  const cash=num(metrics.cashEur),current=num(metrics.currentValue);
  return [String(metrics.portfolio.id||""),String(metrics.marketScope||"auto"),cash===null?"":cash.toFixed(4),current===null?"":current.toFixed(4),...rows].join("|");
}

function portfolioHasGoal(portfolioId){
  return !!state.goals[String(portfolioId||"")];
}

function scheduleGoalPortfolioReview(portfolioId,positionId=null){
  const id=String(portfolioId||"");if(!id)return;
  state.goalCandidateCache={at:0,key:"",rows:[]};
  const old=state.goalReviewTimers[id];if(old)clearTimeout(old);
  state.goalReviewTimers[id]=setTimeout(async()=>{
    delete state.goalReviewTimers[id];
    if(!state.user||!portfolioHasGoal(id))return;
    try{
      const target=positionId?state.positions.find(p=>String(p.id)===String(positionId)&&String(p.portfolio_id)===id&&Number(p.active)!==0):null;
      if(target){
        await api("/api/analysis/run",{method:"POST",body:JSON.stringify({subjectType:"position",subjectId:target.id})}).catch(()=>null);
      }
      await loadAll();
      state.goalCandidateCache={at:0,key:"",rows:[]};
      if(String(state.selectedPortfolioId||"")===id&&state.primaryTab==="goal")renderGoalApp();
    }catch(error){
      console.warn("Goal portfolio movement review failed",id,error);
    }
  },120);
}

function portfolioSummaryHtml(portfolio, positions) {
  if (!portfolio) return "";
  const baseCurrency = String(portfolio.base_currency || "EUR").toUpperCase();
  const cashBalance = Math.max(0,num(portfolio.cash_balance)||0);
  const txSummary = state.portfolioTransactionSummaries[String(portfolio.id)] || null;
  if (!positions.length && !txSummary && cashBalance<=0) return "";
  let positionsValue = 0, invested = 0, currentComplete = true, costComplete = true, analyzed = 0, pricingSessions = new Set();
  const fxUsdEur=portfolioUsdToEurRate();
  for (const p of positions) {
    const stock = stockByKey(p.stock_key);
    const qty = num(p.quantity);
    if (p.last_signal) analyzed++;
    if (!stock || qty === null) { currentComplete = false; costComplete = false; continue; }
    const preferTr = Number(p.prefer_tr) === 1;
    const market = currentMarket(stock, preferTr);
    const currentUnit = marketValueInCurrency(market, baseCurrency);
    if (market && market.session) pricingSessions.add(String(market.session));
    if (currentUnit === null) currentComplete = false;
    else positionsValue += qty * currentUnit;

    const entryCurrency = String(p.currency || (preferTr ? "EUR" : "USD")).toUpperCase();
    const avg = num(p.avg_price);
    const avgBase=portfolioConvertAmount(avg,entryCurrency,baseCurrency,fxUsdEur);
    const feeBase=portfolioConvertAmount(portfolioOperationFee(preferTr),preferTr?"EUR":entryCurrency,baseCurrency,fxUsdEur);
    if (avgBase === null || feeBase===null) costComplete = false;
    else invested += qty * avgBase + feeBase;
  }

  const totalValue = currentComplete ? positionsValue + cashBalance : null;
  const openPnl = currentComplete && costComplete ? positionsValue - invested : null;
  const openPnlPct = openPnl !== null && invested > 0 ? openPnl / invested * 100 : null;
  const currencySummary = txSummary && txSummary.currencies && txSummary.currencies[baseCurrency] || null;
  const realizedPnl = currencySummary ? num(currencySummary.realizedPnl) : null;
  const totalPnl = openPnl !== null && realizedPnl !== null ? openPnl + realizedPnl : null;
  const pnlHtml = (label, value, suffix = "") => value === null ? "" :
    '<div><small>' + label + '</small><strong class="' + (value >= 0 ? 'pnl-up' : 'pnl-down') + '">' +
      (value > 0 ? '+' : '') + formatMoney(value, baseCurrency) + suffix + '</strong></div>';

  const pricingSessionLabel = pricingSessions.has('premarket') ? ' · preapertura' : pricingSessions.has('postmarket') ? ' · posmercado' : '';
  return '<div class="portfolio-summary-bar" title="Valorado con la cotización actual disponible'+pricingSessionLabel+'">' +
    '<div><small>CARTERA</small><strong>' + esc(portfolio.name) + '</strong></div>' +
    '<div><small>VALOR TOTAL</small><strong>' + (totalValue!==null ? formatMoney(totalValue, baseCurrency) : '—') + '</strong></div>' +
    pnlHtml('ABIERTO', openPnl, openPnlPct === null ? '' : ' · ' + (openPnlPct >= 0 ? '+' : '') + formatNumber(openPnlPct, 2) + '%') +
    pnlHtml('REALIZADO', realizedPnl) +
    pnlHtml('TOTAL', totalPnl) +
  '</div>';
}

function portfolioCurrencySymbol(currency){
  const code=String(currency||"EUR").toUpperCase();
  return code==="EUR"?"€":code==="USD"?"$":code==="GBP"?"£":code;
}
function portfolioCashRowHtml(portfolio){
  if(!portfolio)return"";
  const currency=String(portfolio.base_currency||"EUR").toUpperCase();
  const cash=Math.max(0,num(portfolio.cash_balance)||0);
  return '<button type="button" class="portfolio-cash-row" data-portfolio-cash-edit="'+esc(portfolio.id)+'" aria-label="Editar capital líquido">'+
    '<span class="portfolio-cash-icon" aria-hidden="true">'+esc(portfolioCurrencySymbol(currency))+'</span>'+
    '<span class="portfolio-cash-copy"><strong>Capital líquido</strong><small>Disponible para la siguiente decisión de Objetivo IA</small></span>'+
    '<b>'+formatMoney(cash,currency)+'</b><em>Editar</em></button>';
}

function renderLoggedOut(box) {
  box.innerHTML = '<div class="portfolio-auth-gate">' +
    '<div class="portfolio-auth-icon">★</div>' +
    '<h2>Tus carteras, siempre sincronizadas</h2>' +
    '<p>Inicia sesión para guardar posiciones por bróker y mantenerlas bajo análisis continuo.</p>' +
    '<button type="button" class="btn portfolio-google-login">Entrar con Google</button>' +
  '</div>';
}

function renderLoading(box) {
  box.innerHTML = '<div class="portfolio-loading"><span></span><p>Cargando carteras…</p></div>';
}

function renderPortfolioCard(p) {
  const count = portfolioPositions(p.id).length;
  const selected = String(state.selectedPortfolioId ?? "") === String(p.id ?? "");
  return '<button type="button" class="portfolio-tab' + (selected ? ' active' : '') + '" data-portfolio-select="' + esc(p.id) + '">' +
    '<strong>' + esc(p.name) + '</strong>' +
    '<span>' + count + '</span>' +
  '</button>';
}

function renderUnavailablePosition(p = {}, message = "El valor no está disponible en el catálogo actual") {
  const currency = p.currency || (Number(p.prefer_tr) === 1 ? "EUR" : "USD");
  return window.ViewInvAICards.render({
    context: "portfolio", title: p.name || "Posición guardada", subtitle: p.ticker || p.stock_key || "—",
    cells: [{label: "Cantidad", value: formatNumber(p.quantity, 4)}, {label: "Media", value: formatMoney(p.avg_price, currency)}],
    detailsLabel: "Posición sin cotización", detailsHtml: "<p>" + esc(message) + "</p>",
    actionsHtml: '<button type="button" class="portfolio-transactions-open" data-position-transactions="' + esc(p.id) + '">Operaciones</button>' +
      '<button type="button" class="portfolio-analyze" data-edit-portfolio-position="' + esc(p.id) + '">Editar posición</button>'
  });
}

// portfolio-position-more: el detalle progresivo se abre ahora en la ficha completa de la acción.
function renderPositionRow(p, index = 0) {
  const stock = stockByKey(p.stock_key);
  if (!stock) return renderUnavailablePosition(p);
  const preferTr = Number(p.prefer_tr) === 1;
  const market = currentMarket(stock, preferTr);
  const qty = num(p.quantity);
  const avg = num(p.avg_price);
  const entryCurrency = String(p.currency || (preferTr ? "EUR" : "USD")).toUpperCase();
  const currentEntryPrice = marketValueInCurrency(market, entryCurrency);
  const currentValue = qty !== null && currentEntryPrice !== null ? qty * currentEntryPrice : null;
  const pnlAbs = qty !== null && avg !== null && currentEntryPrice !== null ? (currentEntryPrice - avg) * qty : null;
  const pnlPct = avg !== null && avg > 0 && currentEntryPrice !== null ? (currentEntryPrice / avg - 1) * 100 : null;
  const [signalLabel] = signalInfo(p.last_signal);
  const pnlTone = pnlAbs === null ? "muted" : pnlAbs >= 0 ? "positive" : "negative";
  const priceTone = market.change === null ? "muted" : market.change >= 0 ? "positive" : "negative";

  const entryFee=portfolioOperationFee(preferTr);
  const investedValue=qty!==null&&avg!==null?qty*avg+entryFee:null;
  const pnlAfterFees=currentValue!==null&&investedValue!==null?currentValue-investedValue:null;
  const pnlAfterFeesPct=investedValue!==null&&investedValue>0&&pnlAfterFees!==null?pnlAfterFees/investedValue*100:null;
  const brokerLabel=String(p.broker||'').trim();
  const exposureTone=pnlPct===null?'muted':pnlPct>=0?'positive':'negative';
  const exposureHtml='<div class="portfolio-position-exposure">'+
    '<span><small>Precio medio</small><b>'+esc(formatMoney(avg,entryCurrency))+'</b></span>'+
    '<span class="'+exposureTone+'"><small>Desde compra</small><b>'+(pnlPct===null?'—':esc((pnlPct>0?'+':'')+formatNumber(pnlPct,2)+'%'))+'</b></span>'+
    '<span><small>Total</small><b>'+esc(formatMoney(currentValue,entryCurrency))+'</b></span>'+
  '</div>';
  const metaHtml='<div class="portfolio-position-strip">'+
    '<span><b>'+esc(formatNumber(qty,4))+'</b> uds.</span>'+
    (brokerLabel?'<span>Broker <b>'+esc(brokerLabel)+'</b></span>':'')+
    '<span>Coste <b>'+esc(formatMoney(investedValue,entryCurrency))+'</b></span>'+
    '<span class="'+(pnlAfterFees===null?'muted':pnlAfterFees>=0?'positive':'negative')+'">P&L neto <b>'+(pnlAfterFees===null?'—':esc((pnlAfterFees>0?'+':'')+formatMoney(pnlAfterFees,entryCurrency)+(pnlAfterFeesPct===null?'':' · '+(pnlAfterFeesPct>0?'+':'')+formatNumber(pnlAfterFeesPct,2)+'%')))+'</b></span>'+
  '</div>';
  return window.ViewInvAI.renderStandardStockCard(stock, {
    index, preferTr, context: "portfolio", hint: "Cartera · posición activa", rankLabel: "",
    className: "portfolio-position-card",
    leadingHtml: "",
    cells:[{label:'Posición',html:exposureHtml,tone:exposureTone}],
    openAttrs: ' data-open-stock="' + esc(p.stock_key) + '" data-position-prefer-tr="' + (preferTr ? '1' : '0') + '" role="button" tabindex="0"',
    openLabel: "Ficha",
    openActionAttrs: ' data-portfolio-stock-profile="' + esc(p.stock_key) + '" data-profile-prefer-tr="' + (preferTr ? '1' : '0') + '" aria-label="Abrir ficha completa de ' + esc(stock.name||stock.ticker||p.stock_key) + '" title="Abrir ficha completa"',
    metaHtml,
    detailsHtml: ""
  });

}

function renderPositionRowSafe(p, index = 0) {
  try {
    const html = renderPositionRow(p, index);
    if (html) return html;
    throw new Error("La posición no generó contenido");
  } catch (error) {
    console.error("Portfolio position render failed", {
      positionId: p && p.id,
      portfolioId: p && p.portfolio_id,
      stockKey: p && p.stock_key,
      error
    });
    return renderUnavailablePosition(p || {}, "No se pudo dibujar la cotización, pero la posición sigue disponible");
  }
}

function portfolioContextHtml(selected, positions) {
  if (!selected) {
    return '<div class="portfolio-empty-state"><h2>Crea tu primera cartera</h2><button type="button" class="btn" data-new-portfolio="1">＋ Crear cartera</button></div>';
  }
  try {
    const summary = portfolioSummaryHtml(selected, positions);
    const rows = positions.length
      ? positions.map(renderPositionRowSafe).join('')
      : '<div class="portfolio-empty-state compact">Esta cartera todavía no tiene posiciones. Pulsa “+” para añadir una.</div>';
    return summary + portfolioCashRowHtml(selected) +
      '<section class="portfolio-block integrated portfolio-positions-only">' +
        '<div class="portfolio-position-list stock-list">' + rows + '</div>' +
      '</section>';
  } catch (error) {
    console.error("Portfolio context render failed", {
      portfolioId: selected && selected.id,
      positions: positions && positions.length,
      error
    });
    const rows = (positions || []).map(renderPositionRowSafe).join('') ||
      '<div class="portfolio-empty-state compact">No se pudo dibujar el resumen de la cartera.</div>';
    return '<div class="portfolio-render-warning">El resumen no se ha podido actualizar, pero tus posiciones siguen disponibles.</div>' +
      '<section class="portfolio-block integrated portfolio-positions-only">' +
        '<div class="portfolio-position-list stock-list">' + rows + '</div>' +
      '</section>';
  }
}

function renderWatchRow(w) {
  const stock = stockByKey(w.stock_key);
  if (!stock) return "";
  const preferTr = Number(w.prefer_tr) === 1;
  return window.ViewInvAI.renderStandardStockCard(stock, {
    index:0, preferTr, context:"watchlist", hint:"Seguimiento", rankLabel:"",
    openAttrs:' data-open-stock="' + esc(w.stock_key) + '" role="button" tabindex="0"',
    detailsHtml:"",
    actionsHtml:'<button type="button" class="portfolio-analyze compact" data-analyze-type="watchlist" data-analyze-id="' + esc(w.id) + '">IA</button>'
  });
}


function portfolioStockKey(stock) {
  return stock && window.ViewInvAI && typeof window.ViewInvAI.getStockKey === "function"
    ? String(window.ViewInvAI.getStockKey(stock) || "").trim().toUpperCase()
    : String(stock && (stock.tvSymbol || stock.ticker || stock.trTicker) || "").trim().toUpperCase();
}
function portfolioUsdToEurRate() {
  for (const p of state.positions) {
    const stock = stockByKey(p.stock_key); if (!stock) continue;
    const m = currentMarket(stock, Number(p.prefer_tr) === 1);
    if (num(m.usd) !== null && num(m.eur) !== null && Number(m.usd) !== 0) return Number(m.eur) / Number(m.usd);
  }
  const stocks = window.ViewInvAI && typeof window.ViewInvAI.getAllStocks === "function" ? window.ViewInvAI.getAllStocks() : [];
  for (const stock of stocks.slice(0,80)) {
    const m=currentMarket(stock,false);
    if(num(m.usd)!==null&&num(m.eur)!==null&&Number(m.usd)!==0)return Number(m.eur)/Number(m.usd);
  }
  return null;
}
function portfolioCashEur(portfolio,fxUsdEur){
  const cash=Math.max(0,num(portfolio&&portfolio.cash_balance)||0),currency=String(portfolio&&portfolio.base_currency||"EUR").toUpperCase();
  if(cash===0)return 0;
  if(currency==="EUR")return cash;
  if(currency==="USD"&&num(fxUsdEur)!==null)return cash*num(fxUsdEur);
  return null;
}
function portfolioGoalPositionSnapshot(p,fxUsdEur){
  const stock=stockByKey(p.stock_key),qty=num(p.quantity);if(!stock||qty===null)return null;
  const preferTr=Number(p.prefer_tr)===1;
  if(preferTr&&window.ViewInvAI?.ensureTrLiveKey)window.ViewInvAI.ensureTrLiveKey(portfolioStockKey(stock));
  const market=currentMarket(stock,preferTr);
  let unitEur=num(market.eur);if(unitEur===null&&String(market.currency||"").toUpperCase()==="EUR")unitEur=num(market.price);
  const avg=num(p.avg_price),entryCurrency=String(p.currency||(preferTr?"EUR":"USD")).toUpperCase();
  let avgEur=avg;if(avg!==null&&entryCurrency==="USD")avgEur=fxUsdEur===null?null:avg*fxUsdEur;else if(avg!==null&&entryCurrency!=="EUR")avgEur=null;
  const valueEur=unitEur===null?null:qty*unitEur,costEur=avgEur===null?null:qty*avgEur,pnlEur=valueEur!==null&&costEur!==null?valueEur-costEur:null;
  return{p,stock,qty,preferTr,market,unitEur,avgEur,valueEur,costEur,pnlEur};
}
function portfolioGoalMetrics(){
  const portfolio=selectedPortfolio();
  if(!portfolio)return{portfolio:null,rows:[],currentValue:null,totalPnl:null,target:null,remaining:null,progress:0,goalPressure:0,requiredMultiple:null,requiredReturnPct:null,marketScope:"auto"};
  const fxUsdEur=portfolioUsdToEurRate(),positions=portfolioPositions(portfolio.id),rows=positions.map(p=>portfolioGoalPositionSnapshot(p,fxUsdEur)).filter(Boolean);
  let investedValue=0,openPnl=0,currentComplete=true,pnlComplete=true;
  for(const row of rows){if(row.valueEur===null)currentComplete=false;else investedValue+=row.valueEur;if(row.pnlEur===null)pnlComplete=false;else openPnl+=row.pnlEur}
  const cashEur=portfolioCashEur(portfolio,fxUsdEur);
  if(cashEur===null)currentComplete=false;
  let realizedPnl=0,realizedKnown=true;
  const summary=state.portfolioTransactionSummaries[String(portfolio.id)]||null;
  if(summary){
    for(const [currency,data] of Object.entries(summary.currencies||{})){
      const v=num(data&&data.realizedPnl);if(v===null)continue;
      if(currency==="EUR")realizedPnl+=v;else if(currency==="USD"&&fxUsdEur!==null)realizedPnl+=v*fxUsdEur;else realizedKnown=false;
    }
  }
  const totalPnl=pnlComplete&&realizedKnown?openPnl+realizedPnl:null,goalConfig=portfolioGoalConfig(),target=goalConfig.target,capital=currentComplete?investedValue+(cashEur||0):null;
  const remaining=target!==null&&capital!==null?target-capital:null;
  const progress=target&&capital!==null?Math.max(0,Math.min(100,capital/target*100)):0;
  const requiredMultiple=target!==null&&capital!==null&&capital>0?target/capital:null;
  const requiredReturnPct=requiredMultiple!==null?(requiredMultiple-1)*100:null;
  const goalPressure=remaining!==null&&remaining>0&&capital>0?Math.max(0,Math.min(1,remaining/capital)):0;
  const riskBand=portfolioGoalRiskBand(goalConfig.riskProfile);
  return{portfolio,rows,fxUsdEur,currentValue:capital,investedValue:currentComplete?investedValue:null,cashEur,openPnl:pnlComplete?openPnl:null,realizedPnl,realizedKnown,totalPnl,target,remaining,progress,goalPressure,requiredMultiple,requiredReturnPct,marketScope:portfolioMarketScope(portfolio,positions),goalConfig,riskBand};
}

function coachPriceLevels(stock,preferTr,score,entryPrice=null){
  const market=currentMarket(stock,preferTr),price=num(entryPrice)??num(market.price),change=Math.abs(num(market.change)||0);
  if(price===null||price<=0)return{stop:null,take:null,stopPct:null,takePct:null,currency:market.currency||"EUR"};
  const stopPct=Math.max(4.5,Math.min(12,5.5+change*.35+(score<50?1.5:0))),takePct=Math.max(8,Math.min(25,stopPct*(score>=70?2:1.7)));
  return{stop:price*(1-stopPct/100),take:price*(1+takePct/100),stopPct,takePct,currency:market.currency||(preferTr?"EUR":"USD")};
}
function portfolioCoachPositionRows(metrics){
  const total=num(metrics.currentValue)||0,goalReached=num(metrics.remaining)!==null&&metrics.remaining<=0;
  return metrics.rows.map(row=>{
    const pulse=window.ViewInvAIPulseCoach&&typeof window.ViewInvAIPulseCoach.analyzeStock==="function"?window.ViewInvAIPulseCoach.analyzeStock(row.stock,row.preferTr):null;
    const backendScore=num(row.p.last_score),score=backendScore??num(pulse&&pulse.score)??50;
    const quality=num(pulse&&pulse.quality)??0,currentWeight=total>0&&row.valueEur!==null?row.valueEur/total*100:0;
    const backendSignal=String(row.p.last_signal||"").toUpperCase();
    let targetWeight=currentWeight;
    const maxWeight=metrics.riskBand?metrics.riskBand.maxPosition:28;
    const openedAt=new Date(row.p.opened_at||row.p.created_at||0).getTime();
    const holdingDays=Number.isFinite(openedAt)?Math.max(0,(Date.now()-openedAt)/86400000):null;
    const weekPerf=num(row.stock&&row.stock.perfWeek);
    const catalyst=portfolioGoalCatalyst(row.stock),catalystDays=num(catalyst.days);
    const imminentCatalyst=catalystDays!==null&&catalystDays<=3&&(num(catalyst.impact)||0)>=65;
    const stagnant=holdingDays!==null&&holdingDays>=7&&weekPerf!==null&&Math.abs(weekPerf)<1.25&&score<68&&!imminentCatalyst;
    if(backendSignal==="SELL"||score<=35||stagnant)targetWeight=0;
    else if(backendSignal==="REVIEW"||score<48)targetWeight=Math.min(currentWeight,12);
    else if(currentWeight>maxWeight+12)targetWeight=Math.min(currentWeight,score>=70?maxWeight:maxWeight*.8);
    else if(currentWeight>maxWeight&&score<65)targetWeight=Math.min(currentWeight,maxWeight);
    if(goalReached&&backendSignal==="HOLD"&&score>=55)targetWeight=Math.min(targetWeight,currentWeight);
    const desiredReducePct=currentWeight>0?Math.max(0,(currentWeight-targetWeight)/currentWeight*100):0;
    const units=wholeRecommendationUnits(row.qty,row.qty*desiredReducePct/100);
    const reducePct=row.qty>0?Math.max(0,Math.min(100,units/row.qty*100)):0;
    const execution=goalExecutionQuote(row.stock,row.preferTr,"SELL",metrics.fxUsdEur);
    const releasedGross=execution.unitEur===null?0:execution.unitEur*units;
    const released=units>0?Math.max(0,releasedGross-execution.feeEur):0;
    const action=units<=0?"MANTENER":units>=Math.floor(row.qty+1e-9)&&Math.abs(row.qty-Math.floor(row.qty+1e-9))<1e-8?"SALIR":"REDUCIR",reasons=[];
    if(backendSignal)reasons.push("señal IA "+signalInfo(backendSignal)[0].toLowerCase());
    else reasons.push("pendiente de análisis IA de cartera");
    if(stagnant)reasons.push("sin avance semanal suficiente");
    if(currentWeight>35)reasons.push("concentración "+formatNumber(currentWeight,1)+"%");
    reasons.push("score "+formatNumber(score,0)+"/100");
    if(quality)reasons.push("calidad "+formatNumber(quality,0)+"/100");
    if(goalReached)reasons.push("objetivo alcanzado");
    const levels=action==="SALIR"?{stop:null,take:null,stopPct:null,takePct:null,currency:row.market.currency||"EUR"}:coachPriceLevels(row.stock,row.preferTr,score);
    return{...row,score,quality,currentWeight,targetWeight,reducePct,units,released,releasedGross,execution,action,reasons,levels,holdingDays,weekPerf,stagnant};
  }).sort((a,b)=>b.released-a.released||a.score-b.score);
}
function portfolioGoalCatalyst(stock){
  let events=[];
  try{events=typeof stockEvents==="function"?stockEvents(stock):[]}catch(_){events=[]}
  const now=Date.now(),future=events.filter(event=>{
    const t=new Date(event&&event.date||0).getTime();
    return Number.isFinite(t)&&t>=now-3600000&&t<=now+60*86400000;
  }).sort((a,b)=>new Date(a.date)-new Date(b.date)||((num(b.impactScore)||0)-(num(a.impactScore)||0)));
  const recentNews=events.filter(event=>event&&event.eventKind==="news").sort((a,b)=>new Date(b.date)-new Date(a.date));
  const event=future[0]||recentNews[0]||null;
  if(!event)return{label:"Sin catalizador próximo verificado",when:"",impact:0,days:null,title:""};
  const timestamp=new Date(event.date||0).getTime(),days=Number.isFinite(timestamp)?Math.max(0,(timestamp-now)/86400000):null;
  let label="";
  try{label=typeof EL==="function"?EL(event):String(event.type||"Catalizador")}catch(_){label=String(event.type||"Catalizador")}
  let when="";
  try{when=typeof eventWhen==="function"?eventWhen(event):String(event.date||"")}catch(_){when=String(event.date||"")}
  return{label,when,impact:Math.max(0,Math.min(100,num(event.impactScore)||50)),days,title:String(event.title||event.fact||"")};
}
function portfolioGoalVelocityScore(stock,score,quality){
  const catalyst=portfolioGoalCatalyst(stock),days=num(catalyst.days);
  const timeBonus=days===null?0:days<=1?14:days<=3?11:days<=7?8:days<=14?5:2;
  const catalystBonus=catalyst.impact*.08;
  const value=Math.min(100,(num(score)||0)*.72+(num(quality)||0)*.14+catalystBonus+timeBonus);
  return{score:value,catalyst};
}

function portfolioCoachCandidates(metrics,positionRows){
  const marketScope=metrics.marketScope;
  if(!["tr","us"].includes(marketScope))return[];
  const excluded=new Set(positionRows.filter(x=>x.action!=="MANTENER").map(x=>portfolioStockKey(x.stock))),goalReached=num(metrics.remaining)!==null&&metrics.remaining<=0;
  const released=goalReached?0:positionRows.reduce((sum,row)=>sum+(num(row.released)||0),0);
  const cashAvailable=goalReached?0:Math.max(0,num(metrics.cashEur)||0),rotationPool=goalReached?0:cashAvailable+released;
  const cacheKey=marketScope+"|"+String(metrics.portfolio&&metrics.portfolio.id||"")+"|"+portfolioGoalHoldingsSignature(metrics)+"|"+[...excluded].sort().join("|")+"|"+String(Math.round(rotationPool*100)/100);
  if(state.goalCandidateCache.key===cacheKey&&Date.now()-state.goalCandidateCache.at<15000)return state.goalCandidateCache.rows;
  if(rotationPool<=0){state.goalCandidateCache={at:Date.now(),key:cacheKey,rows:[]};return[]}
  const merged=new Map(),ingest=(rows,source)=>{
    for(const row of Array.isArray(rows)?rows:[]){
      const stock=row.stock||row.s;if(!stock)continue;
      const preferTr=marketScope==="tr";
      if(preferTr&&!(stock.tradeRepublicTradable===true||(stock.tradeRepublicVerified&&stock.trTicker)))continue;
      if(!preferTr&&!["NASDAQ","NYSE","AMEX","NYSE ARCA","NYSEARCA"].includes(String(stock.exchange||"").toUpperCase()))continue;
      const key=portfolioStockKey(stock);if(!key||excluded.has(key))continue;
      if(preferTr&&typeof window.ViewInvAI?.ensureTrLiveKey==="function")window.ViewInvAI.ensureTrLiveKey(key);
      const old=merged.get(key)||{stock,preferTr,pulseScore:null,radarScore:null,quality:0,sources:[]};
      if(source==="Pulso IA")old.pulseScore=num(row.score);else old.radarScore=num(row.score);
      old.quality=Math.max(old.quality||0,num(row.quality)||0);
      if(!old.sources.includes(source))old.sources.push(source);
      merged.set(key,old);
    }
  };
  try{ingest(window.ViewInvAIPulseCoach?.rankCandidates?.(40,[...excluded],marketScope)||[],"Pulso IA")}catch(_){}
  try{ingest(window.ViewInvAIRadarCoach?.rankCandidates?.(40,[...excluded],marketScope)||[],"Radar")}catch(_){}
  const band=metrics.riskBand||portfolioGoalRiskBand("aggressive");
  const ranked=[...merged.values()].map(row=>{
    const scores=[row.pulseScore,row.radarScore].filter(x=>x!==null);
    const score=scores.length?Math.min(100,Math.max(...scores)+(scores.length>1?3:0)):0;
    const velocity=portfolioGoalVelocityScore(row.stock,score,row.quality);
    const catalyst=velocity.catalyst||{},multiSource=row.sources.length>1;
    const execution=goalExecutionQuote(row.stock,row.preferTr,"BUY",metrics.fxUsdEur);
    const spread=num(execution.spreadPct),spreadPenalty=spread===null?4:Math.min(18,spread*2.2);
    const confirmation=multiSource||score>=86||(num(catalyst.impact)||0)>=75;
    const composite=Math.max(0,Math.min(100,score*.44+(num(row.quality)||0)*.20+velocity.score*.28+(multiSource?5:0)+Math.min(3,(num(catalyst.impact)||0)*.03)-spreadPenalty));
    const spreadAcceptable=spread===null?row.quality>=75:spread<=8;
    return{...row,score,velocityScore:velocity.score,catalyst,confirmation,composite,execution,spreadAcceptable};
  }).filter(row=>row.confirmation&&row.spreadAcceptable&&row.execution.unitEur!==null&&row.execution.unitEur>0&&row.score>=band.minCandidate&&row.quality>=band.minQuality&&row.velocityScore>=band.minVelocity&&row.composite>=band.minComposite)
    .sort((x,y)=>y.composite-x.composite||y.velocityScore-x.velocityScore||y.score-x.score||y.quality-x.quality);
  if(!ranked.length){state.goalCandidateCache={at:Date.now(),key:cacheKey,rows:[]};return[]}
  const finalists=[ranked[0]];
  if(ranked[1]&&ranked[1].composite>=Math.max(82,ranked[0].composite-4))finalists.push(ranked[1]);
  if(ranked[2]&&ranked[2].composite>=Math.max(84,ranked[0].composite-3))finalists.push(ranked[2]);
  const priced=finalists.filter(row=>row.execution.unitEur+row.execution.feeEur<=rotationPool);
  if(!priced.length){state.goalCandidateCache={at:Date.now(),key:cacheKey,rows:[]};return[]}
  const weights=priced.length===1?[1]:priced.length===2?[.65,.35]:[.55,.30,.15],remainingGoal=Math.max(0,num(metrics.remaining)||0);
  let result=priced.map((row,index)=>{
    const budget=rotationPool*weights[index],feeEur=row.execution.feeEur||0;
    const units=Math.floor(Math.max(0,budget-feeEur)/row.execution.unitEur);
    const allocation=units*row.execution.unitEur,totalCost=units>0?allocation+feeEur:0,levels=coachPriceLevels(row.stock,row.preferTr,row.score,row.execution&&row.execution.price);
    const potentialGain=allocation>0&&levels.takePct!==null?allocation*levels.takePct/100:0;
    const goalShare=remainingGoal>0?Math.min(100,potentialGain/remainingGoal*100):0;
    return{...row,rank:index+1,unitEur:row.execution.unitEur,allocation,totalCost,feeEur,units,levels,potentialGain,goalShare,cashAvailable,released};
  }).filter(row=>row.units>=1);
  if(!result.length){
    const row=priced[0],feeEur=row.execution.feeEur||0,units=Math.floor(Math.max(0,rotationPool-feeEur)/row.execution.unitEur);
    if(units<1){state.goalCandidateCache={at:Date.now(),key:cacheKey,rows:[]};return[]}
    const allocation=units*row.execution.unitEur,totalCost=allocation+feeEur,levels=coachPriceLevels(row.stock,row.preferTr,row.score,row.execution&&row.execution.price);
    const potentialGain=allocation>0&&levels.takePct!==null?allocation*levels.takePct/100:0;
    result=[{...row,rank:1,unitEur:row.execution.unitEur,allocation,totalCost,feeEur,units,levels,potentialGain,goalShare:remainingGoal>0?Math.min(100,potentialGain/remainingGoal*100):0,cashAvailable,released}];
  }
  let spent=result.reduce((sum,row)=>sum+(num(row.totalCost)||0),0),left=Math.max(0,rotationPool-spent);
  for(const row of priced){
    if(result.some(item=>portfolioStockKey(item.stock)===portfolioStockKey(row.stock)))continue;
    const firstCost=row.execution.unitEur+(row.execution.feeEur||0);
    if(result.length<3&&left>=firstCost){
      const levels=coachPriceLevels(row.stock,row.preferTr,row.score,row.execution&&row.execution.price),allocation=row.execution.unitEur,totalCost=firstCost;
      const potentialGain=allocation>0&&levels.takePct!==null?allocation*levels.takePct/100:0;
      result.push({...row,rank:result.length+1,unitEur:row.execution.unitEur,allocation,totalCost,feeEur:row.execution.feeEur||0,units:1,levels,potentialGain,goalShare:remainingGoal>0?Math.min(100,potentialGain/remainingGoal*100):0,cashAvailable,released});
      left-=firstCost;
    }
  }
  let safety=0;
  while(result.length&&safety++<5000){
    const row=result.find(item=>item.unitEur<=left+1e-9);
    if(!row)break;
    row.units+=1;row.allocation+=row.unitEur;row.totalCost+=row.unitEur;left=Math.max(0,left-row.unitEur);
  }
  result=result.sort((x,y)=>y.composite-x.composite).map((row,index)=>{
    const potentialGain=row.allocation>0&&row.levels.takePct!==null?row.allocation*row.levels.takePct/100:0;
    return{...row,rank:index+1,potentialGain,goalShare:remainingGoal>0?Math.min(100,potentialGain/remainingGoal*100):0};
  });
  state.goalCandidateCache={at:Date.now(),key:cacheKey,rows:result};return result;
}
function goalOperationButtonHtml({side,portfolioId,stockKey,units,price,fees,currency,preferTr}){
  if(!(num(units)>0)||num(price)===null)return"";
  return '<button type="button" class="btn ghost compact portfolio-goal-register" data-register-goal-operation="'+esc(String(side||"BUY").toUpperCase())+'" data-goal-portfolio="'+esc(portfolioId||"")+'" data-goal-stock-key="'+esc(stockKey||"")+'" data-goal-units="'+esc(String(Math.round(num(units)||0)))+'" data-goal-price="'+esc(String(num(price)))+'" data-goal-fees="'+esc(String(num(fees)||0))+'" data-goal-currency="'+esc(currency||"EUR")+'" data-goal-prefer-tr="'+(preferTr?'1':'0')+'">Registrar estrategia</button>';
}
function goalTradeInstructionHtml(row){
  const sellUnits=Math.max(0,Math.round(num(row.units)||0)),keepUnits=Math.max(0,(num(row.qty)||0)-sellUnits),execution=row.execution||{};
  const complete=sellUnits>=Math.floor((num(row.qty)||0)+1e-9)&&Math.abs((num(row.qty)||0)-Math.floor((num(row.qty)||0)+1e-9))<1e-8;
  const detail=complete?"Salida completa · "+formatNumber(sellUnits,0)+" acciones":"Vender "+formatNumber(sellUnits,0)+" acciones ("+formatNumber(row.reducePct,0)+"%) · mantener "+formatNumber(keepUnits,0);
  const price=execution.price!==null&&execution.price!==undefined?formatMoney(execution.price,execution.currency||"EUR"):"—";
  const spread=execution.spreadPct!==null&&execution.spreadPct!==undefined?" · spread "+formatNumber(execution.spreadPct,2)+"%":"";
  const fee=execution.feeEur?(" · comisión "+formatMoney(execution.feeEur,"EUR")):"";
  const button=goalOperationButtonHtml({side:"SELL",portfolioId:row.p.portfolio_id,stockKey:row.p.stock_key,units:sellUnits,price:execution.price,fees:execution.feeEur,currency:execution.currency||row.p.currency||"EUR",preferTr:row.preferTr});
  return '<div class="portfolio-goal-trade sell" data-open-stock="'+esc(row.p.stock_key)+'" data-position-prefer-tr="'+(row.preferTr?'1':'0')+'" role="button" tabindex="0">'+
    '<em>VENDER</em><div><strong>'+esc(row.stock.name||row.p.ticker||row.p.stock_key)+'</strong><small>'+esc(detail)+'</small><small>'+esc((execution.instruction||"Venta límite")+" · "+price+spread+fee)+'</small>'+button+'</div><b>≈ '+formatMoney(row.released,"EUR")+'</b></div>';
}
function goalCandidateHtml(row){
  const key=portfolioStockKey(row.stock),marketLabel=row.preferTr?"TR / LSX":"EEUU",units=formatNumber(Math.max(0,Math.round(num(row.units)||0)),0)+" acciones";
  const catalyst=row.catalyst||portfolioGoalCatalyst(row.stock),levels=row.levels||{},execution=row.execution||{};
  const stop=levels.stop!==null&&levels.stop!==undefined?formatMoney(levels.stop,levels.currency||"EUR"):"—";
  const take=levels.take!==null&&levels.take!==undefined?formatMoney(levels.take,levels.currency||"EUR"):"—";
  const bid=execution.bid!==null&&execution.bid!==undefined?formatMoney(execution.bid,execution.currency||"EUR"):"—";
  const ask=execution.ask!==null&&execution.ask!==undefined?formatMoney(execution.ask,execution.currency||"EUR"):"—";
  const spread=execution.spreadPct!==null&&execution.spreadPct!==undefined?formatNumber(execution.spreadPct,2)+"%":"N/D";
  const entry=execution.price!==null&&execution.price!==undefined?formatMoney(execution.price,execution.currency||"EUR"):"—";
  const fee=row.feeEur?(" · comisión "+formatMoney(row.feeEur,"EUR")):"";
  const button=goalOperationButtonHtml({side:"BUY",portfolioId:state.selectedPortfolioId,stockKey:key,units:row.units,price:execution.price,fees:row.feeEur,currency:execution.currency||(row.preferTr?"EUR":"USD"),preferTr:row.preferTr});
  return '<div class="portfolio-goal-trade buy" data-open-stock="'+esc(key)+'" data-position-prefer-tr="'+(row.preferTr?'1':'0')+'" role="button" tabindex="0">'+
    '<em>#'+esc(row.rank||1)+' · COMPRAR</em><div><strong>'+esc(row.stock.name||row.stock.ticker||key)+'</strong><small>'+esc(units+" · "+marketLabel+" · acciones "+formatMoney(row.allocation,"EUR")+fee+" · total "+formatMoney(row.totalCost||row.allocation,"EUR"))+'</small><small>'+esc((execution.instruction||"Orden límite")+" · entrada "+entry+" · BID "+bid+" · ASK "+ask+" · spread "+spread)+'</small><small>Stop '+esc(stop)+' · Take profit '+esc(take)+' · revisión IA continua</small>'+button+'</div><b>'+formatNumber(row.composite,0)+'/100</b></div>'+
    '<p class="portfolio-goal-reason"><b>Rigor de entrada:</b> convicción '+formatNumber(row.score,0)+'/100 · velocidad '+formatNumber(row.velocityScore,0)+'/100 · calidad '+formatNumber(row.quality,0)+'/100'+(catalyst&&catalyst.label?' · '+esc(catalyst.label):'')+'.</p>';
}

function goalHistoryRound(value,decimals=4){
  const n=num(value);if(n===null)return null;
  const p=Math.pow(10,decimals);return Math.round(n*p)/p;
}
function buildGoalHistorySnapshot(metrics,positionRows,candidates,rotationRows,residual){
  const portfolio=metrics.portfolio;if(!portfolio||metrics.target===null)return null;
  const sells=rotationRows.map(row=>({
    stockKey:row.p.stock_key,ticker:row.p.ticker||row.stock.ticker||"",name:row.stock.name||row.p.name||"",
    units:Math.max(0,Math.round(num(row.units)||0)),releasedEur:goalHistoryRound(row.released,2),
    price:goalHistoryRound(row.execution&&row.execution.price,4),currency:String(row.execution&&row.execution.currency||row.p.currency||"EUR"),
    bid:goalHistoryRound(row.execution&&row.execution.bid,4),ask:goalHistoryRound(row.execution&&row.execution.ask,4),
    spreadPct:goalHistoryRound(row.execution&&row.execution.spreadPct,3),instruction:String(row.execution&&row.execution.instruction||""),
    feeEur:goalHistoryRound(row.execution&&row.execution.feeEur,2)
  }));
  const buys=candidates.slice(0,3).map(row=>({
    rank:row.rank||1,stockKey:portfolioStockKey(row.stock),ticker:(row.preferTr&&row.stock.trTicker)||row.stock.ticker||"",
    name:row.stock.name||"",units:Math.max(0,Math.round(num(row.units)||0)),allocationEur:goalHistoryRound(row.allocation,2),
    totalCostEur:goalHistoryRound(row.totalCost||row.allocation,2),price:goalHistoryRound(row.execution&&row.execution.price,4),
    currency:String(row.execution&&row.execution.currency||(row.preferTr?"EUR":"USD")),
    bid:goalHistoryRound(row.execution&&row.execution.bid,4),ask:goalHistoryRound(row.execution&&row.execution.ask,4),
    spreadPct:goalHistoryRound(row.execution&&row.execution.spreadPct,3),instruction:String(row.execution&&row.execution.instruction||""),
    feeEur:goalHistoryRound(row.feeEur,2),stop:goalHistoryRound(row.levels&&row.levels.stop,4),takeProfit:goalHistoryRound(row.levels&&row.levels.take,4),
    score:goalHistoryRound(row.composite,0),conviction:goalHistoryRound(row.score,0),velocity:goalHistoryRound(row.velocityScore,0),quality:goalHistoryRound(row.quality,0)
  }));
  const plan={
    portfolioId:portfolio.id,portfolioName:portfolio.name,marketScope:metrics.marketScope,
    riskProfile:metrics.goalConfig&&metrics.goalConfig.riskProfile||"aggressive",
    currentValueEur:goalHistoryRound(metrics.currentValue,2),targetEur:goalHistoryRound(metrics.target,2),
    cashEur:goalHistoryRound(metrics.cashEur,2),remainingEur:goalHistoryRound(metrics.remaining,2),
    sells,buys,residualEur:goalHistoryRound(residual,2)
  };
  const signature=JSON.stringify({
    sells:sells.map(x=>[x.stockKey,x.units,x.price,x.instruction]),
    buys:buys.map(x=>[x.stockKey,x.units,x.price,x.instruction]),
    residual:goalHistoryRound(residual,2),risk:plan.riskProfile
  });
  const summary=[
    sells.length?"Vender "+sells.map(x=>x.units+" "+x.ticker).join(", "):"",
    buys.length?"Comprar "+buys.map(x=>"#"+x.rank+" "+x.units+" "+x.ticker).join(", "):"",
    !sells.length&&!buys.length?"Sin cambios":""
  ].filter(Boolean).join(" · ");
  return{portfolioId:portfolio.id,signature,summary,plan};
}
async function persistPendingGoalHistory(){
  const snap=state.pendingGoalHistory;if(!snap||!state.user)return;
  if(state.goalHistoryPosted[String(snap.portfolioId)]===snap.signature)return;
  state.goalHistoryPosted[String(snap.portfolioId)]=snap.signature;
  try{
    const response=await api("/api/portfolio-goal-history",{method:"POST",body:JSON.stringify(snap)});
    if(!response.ok)throw new Error("history-store-failed");
  }catch(error){
    delete state.goalHistoryPosted[String(snap.portfolioId)];
    console.warn("Portfolio goal history store failed",error);
  }
}
function goalHistoryMoney(value){return num(value)===null?"—":formatMoney(value,"EUR")}
function goalHistoryEntryHtml(entry,index){
  const plan=entry&&entry.plan||{},sells=Array.isArray(plan.sells)?plan.sells:[],buys=Array.isArray(plan.buys)?plan.buys:[];
  const when=entry&&entry.created_at?new Date(entry.created_at):null;
  const stamp=when&&Number.isFinite(when.getTime())?when.toLocaleString("es-ES"):"";
  const sellsHtml=sells.length?sells.map(x=>'<div class="goal-history-op sell"><b>VENDER</b><span>'+esc(String(x.units||0))+' '+esc(x.ticker||x.name||"")+'</span><small>'+esc(x.instruction||"")+(num(x.price)!==null?' · '+esc(String(x.price))+' '+esc(x.currency||""):'')+(num(x.feeEur)!==null?' · comisión '+esc(goalHistoryMoney(x.feeEur)):'')+'</small></div>').join(''):'';
  const buysHtml=buys.length?buys.map(x=>'<div class="goal-history-op buy"><b>#'+esc(String(x.rank||1))+' COMPRAR</b><span>'+esc(String(x.units||0))+' '+esc(x.ticker||x.name||"")+'</span><small>'+esc(x.instruction||"")+(num(x.price)!==null?' · límite '+esc(String(x.price))+' '+esc(x.currency||""):'')+(num(x.bid)!==null||num(x.ask)!==null?' · BID/ASK '+esc(String(x.bid??"—"))+'/'+esc(String(x.ask??"—")):'')+(num(x.feeEur)!==null?' · comisión '+esc(goalHistoryMoney(x.feeEur)):'')+(num(x.stop)!==null?' · stop '+esc(String(x.stop)):'')+(num(x.takeProfit)!==null?' · TP '+esc(String(x.takeProfit)):'')+'</small></div>').join(''):'';
  const empty=!sellsHtml&&!buysHtml?'<div class="goal-history-empty">Sin cambios recomendados en esta revisión.</div>':'';
  return '<article class="goal-history-entry"><header><div><strong>#'+esc(String(index+1))+' · '+esc(stamp)+'</strong><small>'+esc(entry.summary||"Recomendación Objetivo IA")+'</small></div><b>'+esc(goalHistoryMoney(plan.currentValueEur))+' → '+esc(goalHistoryMoney(plan.targetEur))+'</b></header>'+
    '<div class="goal-history-ops">'+sellsHtml+buysHtml+empty+'</div>'+
    '<footer><span>Efectivo '+esc(goalHistoryMoney(plan.cashEur))+'</span><span>Remanente '+esc(goalHistoryMoney(plan.residualEur))+'</span><span>Riesgo '+esc(plan.riskProfile||"—")+'</span></footer></article>';
}
async function openGoalHistory(portfolioId){
  const portfolio=state.portfolios.find(p=>String(p.id)===String(portfolioId));if(!portfolio)return;
  openModal("Historial de estrategias · "+portfolio.name,'<div class="portfolio-loading compact"><span></span><p>Cargando recomendaciones…</p></div>');
  try{
    const data=await fetchJson("/api/portfolio-goal-history?portfolioId="+encodeURIComponent(portfolioId)),rows=data.history||[];
    const body=$("#portfolioModalBody");if(!body)return;
    body.innerHTML=rows.length?'<div class="goal-history-list">'+rows.map(goalHistoryEntryHtml).join('')+'</div>':'<div class="portfolio-empty-state compact">Todavía no hay recomendaciones guardadas para esta cartera.</div>';
  }catch(error){
    const body=$("#portfolioModalBody");if(body)body.innerHTML='<div class="portfolio-empty-state compact">No se pudo cargar el historial de recomendaciones.</div>';
    toast(error.message||"No se pudo cargar el historial.",true);
  }
}

function portfolioGoalViewHtml(){
  const metrics=portfolioGoalMetrics(),portfolio=metrics.portfolio,positionRows=portfolioCoachPositionRows(metrics),candidates=portfolioCoachCandidates(metrics,positionRows),target=metrics.target;
  if(!portfolio)return'<div class="portfolio-empty-state">Selecciona o crea una cartera para definir su objetivo.</div>';
  const targetValue=target===null?"":String(Math.round(target*100)/100),marketLabel=portfolioMarketLabel(metrics.marketScope),goalConfig=metrics.goalConfig||portfolioGoalConfig(),riskProfile=goalConfig.riskProfile||"aggressive";
  state.pendingGoalHistory=null;
  const errorHtml=state.goalError?'<div class="portfolio-goal-error" role="alert">'+esc(state.goalError)+'</div>':'';
  const candidate=candidates[0]||null,rotationRows=positionRows.filter(row=>row.action!=="MANTENER"&&(num(row.released)||0)>.01);
  let decisionHtml='';
  if(metrics.marketScope==="auto")decisionHtml='<div class="portfolio-goal-no-action">Configura el mercado de esta cartera antes de pedir una rotación.</div>';
  else if(num(metrics.remaining)!==null&&metrics.remaining<=0)decisionHtml='<div class="portfolio-goal-no-action">Objetivo alcanzado. El modelo no fuerza nuevas operaciones.</div>';
  else if(!candidate)decisionHtml='<div class="portfolio-goal-no-action"><strong>No hacer cambios ahora.</strong> Ninguna entrada supera simultáneamente los filtros estrictos de Pulso IA, Radar, velocidad, catalizadores y calidad de datos.</div>';
  else{
    const sells=rotationRows.map(goalTradeInstructionHtml).join('');
    const cashSource=(num(metrics.cashEur)||0)>0?'<div class="portfolio-goal-trade cash"><em>EFECTIVO</em><div><strong>Capital ya disponible</strong><small>Se suma al capital neto liberado por las ventas.</small></div><b>'+formatMoney(metrics.cashEur,"EUR")+'</b></div>':'';
    const source=sells+cashSource;
    const buys=candidates.slice(0,3).map(goalCandidateHtml).join('');
    const pool=Math.max(0,(num(metrics.cashEur)||0)+rotationRows.reduce((sum,row)=>sum+(num(row.released)||0),0));
    const spent=candidates.reduce((sum,row)=>sum+(num(row.totalCost)||0),0),residual=Math.max(0,pool-spent);
    const residualHtml=residual>=.01?'<div class="portfolio-goal-trade cash"><em>LÍQUIDO</em><div><strong>Remanente</strong><small>No alcanza otra acción entera sin rebajar el filtro de entrada.</small></div><b>'+formatMoney(residual,"EUR")+'</b></div>':'';
    decisionHtml=(source||'')+buys+residualHtml;
    state.pendingGoalHistory=buildGoalHistorySnapshot(metrics,positionRows,candidates,rotationRows,residual);
  }
  if(!candidate&&target!==null)state.pendingGoalHistory=buildGoalHistorySnapshot(metrics,positionRows,[],[],Math.max(0,num(metrics.cashEur)||0));
  return '<section class="portfolio-goal-view" data-goal-portfolio="'+esc(portfolio.id)+'">'+
    '<div class="portfolio-goal-hero compact-goal-hero"><div class="portfolio-goal-intro"><h2>Objetivo IA · '+esc(portfolio.name)+'</h2><small>'+esc(marketLabel)+'</small></div>'+
      '<form id="portfolioGoalForm" class="portfolio-goal-form compact-goal-form" data-portfolio-id="'+esc(portfolio.id)+'">'+
        '<label><span>Objetivo</span><div><input name="targetValueEur" type="number" min="1" step="0.01" inputmode="decimal" value="'+esc(targetValue)+'" placeholder="1000"><b>€</b></div></label>'+
        '<label><span>Riesgo</span><select name="riskProfile"><option value="conservative"'+(riskProfile==="conservative"?' selected':'')+'>Conservador</option><option value="balanced"'+(riskProfile==="balanced"?' selected':'')+'>Equilibrado</option><option value="aggressive"'+(riskProfile==="aggressive"?' selected':'')+'>Agresivo</option></select></label>'+
        '<input name="targetProfitEur" class="portfolio-goal-legacy-input" type="number" min="1" step="0.01" value="'+esc(targetValue)+'" hidden aria-hidden="true" tabindex="-1"><button type="submit" class="btn">'+(target===null?'Crear objetivo':'Guardar')+'</button><div class="portfolio-goal-form-status" data-goal-form-status aria-live="polite"></div></form>'+
    '</div>'+errorHtml+
    (target===null?'<div class="portfolio-goal-no-action">Indica el valor al que quieres llevar esta cartera. El motor trabajará únicamente con el capital que ya existe en ella.</div>':
      '<div class="portfolio-goal-summary"><strong>'+formatMoney(metrics.currentValue,"EUR")+'</strong><span>→ '+formatMoney(target,"EUR")+'</span><b>Faltan '+formatMoney(Math.max(0,num(metrics.remaining)||0),"EUR")+' · '+formatNumber(metrics.progress,1)+'%</b></div>'+
      '<section class="portfolio-goal-decision"><div class="portfolio-goal-decision-head"><h3>Plan recomendado ahora · ranking estricto</h3></div><div class="portfolio-goal-trades">'+decisionHtml+'</div></section>'+
      '<p class="portfolio-goal-note compact-note">El plan intenta reasignar en una sola jugada todo el capital ejecutable, descontando comisiones y respetando acciones enteras. Si el BID/ASK no justifica entrar al precio actual, propone una orden límite y no persigue el precio.</p>')+
    '</section>';
}

async function savePortfolioGoal(targetValueEur,portfolioId=state.selectedPortfolioId,options={}){
  if(!portfolioId)throw new Error("Selecciona una cartera.");
  const payload={portfolioId,targetValueEur,targetDate:null,monthlyContributionEur:0,riskProfile:options.riskProfile||"aggressive"};
  const response=await api("/api/portfolio-goal",{method:"PATCH",body:JSON.stringify(payload)}),data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"No se pudo guardar el objetivo.");
  if(data.goal)state.goals[String(portfolioId)]=data.goal;
  state.goal=data.goal||null;state.goalError="";state.goalCandidateCache={at:0,key:"",rows:[]};(state.primaryTab==="goal"?renderGoalApp:renderApp)();return state.goal;
}
async function refreshGoalSummaries(){
  if(state.selectedPortfolioId)await refreshPortfolioTransactionSummary(state.selectedPortfolioId,false).catch(()=>null);
  if(state.primaryTab==="goal")renderGoalApp();
}
async function refreshGoalAnalysis(force=false){
  const active=state.positions.filter(p=>Number(p.active)!==0&&String(p.portfolio_id)===String(state.selectedPortfolioId));
  if(!active.length){await refreshGoalSummaries();return 0}
  const now=Date.now(),due=active.filter(p=>{
    if(force)return true;
    const t=new Date(p.last_analysis_at||0).getTime();
    return !Number.isFinite(t)||now-t>15*60000;
  });
  let done=0;
  for(let i=0;i<due.length;i+=3){
    const batch=due.slice(i,i+3);
    await Promise.all(batch.map(p=>api("/api/analysis/run",{method:"POST",body:JSON.stringify({subjectType:"position",subjectId:p.id})})
      .then(r=>{if(r.ok)done+=1;return r}).catch(()=>null)));
  }
  await loadAll();
  await refreshGoalSummaries();
  return done;
}

function portfolioWorkbarHtml(selected){
  return '<div class="portfolio-workbar'+(state.primaryTab==="goal"?' goal-mode':'')+'">'+
    '<div class="portfolio-tabs-wrap">'+
      '<div class="portfolio-tabs-track" id="portfolioTabsTrack" role="tablist" aria-label="Mis carteras">'+state.portfolios.map(renderPortfolioCard).join('')+'</div>'+
      '<button type="button" class="portfolio-tabs-more" data-portfolio-tabs-more aria-label="Mostrar carteras ocultas" title="Más carteras" hidden>›</button>'+
      '<div class="portfolio-tabs-overflow" id="portfolioTabsOverflow" aria-hidden="true"></div>'+
    '</div>'+
    '<div class="portfolio-workbar-actions">'+
      '<button type="button" class="portfolio-icon-action portfolio-tab-add" data-new-portfolio="1" aria-label="Nueva cartera" title="Nueva cartera">⊞</button>'+
      '<button type="button" class="portfolio-icon-action portfolio-tabs-edit" data-portfolio-order-edit aria-label="Editar carteras" title="Editar carteras">✎</button>'+
      '<button type="button" class="portfolio-icon-action portfolio-history"'+(selected?' data-portfolio-history="'+esc(selected.id)+'"':' disabled')+' aria-label="Historial" title="Historial">◷</button>'+
      '<button type="button" class="portfolio-icon-action portfolio-market-current"'+(selected?' data-portfolio-market-config="'+esc(selected.id)+'"':' disabled')+' aria-label="Mercado de la cartera" title="Mercado de la cartera">◉</button>'+
      '<button type="button" class="portfolio-icon-action portfolio-add-current"'+(selected?'':' disabled')+' aria-label="Añadir posición" title="Añadir posición">+</button>'+
      '<button type="button" class="portfolio-refresh compact" aria-label="Actualizar carteras" title="Actualizar">↻</button>'+
    '</div>'+
  '</div>';
}

function renderApp() {
  const box=$("#portfolioApp");if(!box)return;
  const goalBox=$("#portfolioGoalApp");if(goalBox)goalBox.innerHTML="";
  state.primaryTab="portfolio";
  if(!state.user)return renderLoggedOut(box);if(state.loading)return renderLoading(box);
  state.portfolios.sort((a,b)=>{const ao=num(a.sort_order)??0,bo=num(b.sort_order)??0;return ao-bo||String(a.created_at||"").localeCompare(String(b.created_at||""))});
  if(!state.selectedPortfolioId&&state.portfolios.length)state.selectedPortfolioId=state.portfolios[0].id;
  if(state.selectedPortfolioId&&!state.portfolios.some(p=>String(p.id??"")===String(state.selectedPortfolioId??"")))state.selectedPortfolioId=state.portfolios[0]?state.portfolios[0].id:null;
  const selected=state.portfolios.find(p=>String(p.id??"")===String(state.selectedPortfolioId??""))||null;
  const positions=selected?portfolioPositions(selected.id):[];
  savePortfolioUi();

  const mappedGoal=selected?state.goals[String(selected.id)]||null:null;
  if(mappedGoal)state.goal=mappedGoal;
  else if(!state.goal||state.goal.portfolio_id)state.goal=null;
  box.innerHTML=portfolioWorkbarHtml(selected)+
    '<div id="portfolioContext" class="portfolio-context">'+portfolioContextHtml(selected,positions)+'</div>';

  requestAnimationFrame(()=>{
    updatePortfolioTabOverflow();
    if(window.ViewInvAI&&typeof window.ViewInvAI.observeLiveQuotes==="function")window.ViewInvAI.observeLiveQuotes(box);
    if(state.primaryTab==="goal")persistPendingGoalHistory();
  });
}

function renderGoalApp() {
  const box=$("#portfolioGoalApp");if(!box)return;
  state.primaryTab="goal";
  if(!state.user)return renderLoggedOut(box);
  if(state.loading)return renderLoading(box);
  state.portfolios.sort((a,b)=>{const ao=num(a.sort_order)??0,bo=num(b.sort_order)??0;return ao-bo||String(a.created_at||"").localeCompare(String(b.created_at||""))});
  if(!state.selectedPortfolioId&&state.portfolios.length)state.selectedPortfolioId=state.portfolios[0].id;
  if(state.selectedPortfolioId&&!state.portfolios.some(p=>String(p.id??"")===String(state.selectedPortfolioId??"")))state.selectedPortfolioId=state.portfolios[0]?state.portfolios[0].id:null;
  const selected=selectedPortfolio();
  const mappedGoal=selected?state.goals[String(selected.id)]||null:null;
  if(mappedGoal)state.goal=mappedGoal;
  else if(!state.goal||state.goal.portfolio_id)state.goal=null;
  savePortfolioUi();
  const portfolioOptions=state.portfolios.map(item=>'<option value="'+esc(item.id)+'"'+(selected&&String(item.id)===String(selected.id)?' selected':'')+'>'+esc(item.name)+'</option>').join('');
  const cashLabel=selected?formatMoney(Math.max(0,num(selected.cash_balance)||0),String(selected.base_currency||"EUR").toUpperCase()):"—";
  box.innerHTML='<div class="portfolio-goal-controls">'+
    '<label class="portfolio-goal-picker"><span>Cartera</span><select data-goal-portfolio-select'+(!state.portfolios.length?' disabled':'')+'>'+portfolioOptions+'</select></label>'+
    '<div class="portfolio-goal-cash-status"><small>EFECTIVO DISPONIBLE</small><strong>'+esc(cashLabel)+'</strong></div>'+
    '<div class="portfolio-goal-tools" role="toolbar" aria-label="Herramientas de estrategia">'+
      '<button type="button" class="portfolio-icon-action portfolio-goal-history"'+(selected?' data-goal-history="'+esc(selected.id)+'"':' disabled')+' aria-label="Historial de estrategias" title="Historial de estrategias">≣</button>'+
      '<button type="button" class="portfolio-icon-action" data-goal-refresh-plan'+(selected?'':' disabled')+' aria-label="Reanalizar estrategia" title="Reanalizar estrategia">↻</button>'+
    '</div>'+
  '</div>'+portfolioGoalViewHtml();
  requestAnimationFrame(()=>{
    if(window.ViewInvAI&&typeof window.ViewInvAI.observeLiveQuotes==="function")window.ViewInvAI.observeLiveQuotes(box);
    persistPendingGoalHistory();
  });
}

function renderActivePortfolioPanel(){
  if(state.primaryTab==="goal")return renderGoalApp();
  return renderApp();
}

function activateGoalPanel({reanalyze=false}={}){
  state.primaryTab="goal";
  savePortfolioUi();
  renderGoalApp();
  const portfolioId=state.selectedPortfolioId;
  if(portfolioId){
    refreshPortfolioTransactionSummary(portfolioId,false).then(()=>{
      if(state.primaryTab==="goal"&&String(state.selectedPortfolioId)===String(portfolioId))renderGoalApp();
    }).catch(()=>{});
  }
  if(reanalyze)setTimeout(()=>refreshGoalAnalysis(false).catch(()=>{}),40);
}

async function fetchJson(path) {
  const response = await api(path);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Error de backend");
  return data;
}

function closePortfolioTabOverflow() {
  const menu = $("#portfolioTabsOverflow");
  if (menu) {
    menu.classList.remove("open");
    menu.setAttribute("aria-hidden", "true");
  }
  const more = document.querySelector("[data-portfolio-tabs-more]");
  if (more) more.setAttribute("aria-expanded", "false");
}

function updatePortfolioTabOverflow() {
  const track = $("#portfolioTabsTrack");
  const more = document.querySelector("[data-portfolio-tabs-more]");
  const menu = $("#portfolioTabsOverflow");
  if (!track || !more || !menu) return;

  const selected = track.querySelector(".portfolio-tab.active");
  if (selected) {
    const left = selected.offsetLeft;
    const right = left + selected.offsetWidth;
    if (left < track.scrollLeft) track.scrollLeft = Math.max(0, left - 4);
    else if (right > track.scrollLeft + track.clientWidth) track.scrollLeft = Math.max(0, right - track.clientWidth + 4);
  }

  requestAnimationFrame(() => {
    // The arrow exists only when portfolio tabs are actually clipped.
    const overflowing = track.clientWidth > 0 && track.scrollWidth > track.clientWidth + 2;
    more.hidden = !overflowing;
    if (!overflowing) {
      menu.innerHTML = "";
      closePortfolioTabOverflow();
      return;
    }

    const trackRect = track.getBoundingClientRect();
    const hidden = [...track.querySelectorAll("[data-portfolio-select]")].filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.left < trackRect.left - 1 || rect.right > trackRect.right + 1;
    });

    menu.innerHTML = hidden.map(el => {
      const p = state.portfolios.find(x => String(x.id) === String(el.dataset.portfolioSelect));
      if (!p) return "";
      const count = portfolioPositions(p.id).length;
      return '<button type="button" class="portfolio-overflow-item' + (p.id === state.selectedPortfolioId ? ' active' : '') + '" data-portfolio-select="' + esc(p.id) + '">' +
        '<strong>' + esc(p.name) + '</strong><span>' + count + '</span></button>';
    }).join("");

    // If everything fits after layout settles, never show a meaningless >.
    if (!hidden.length) {
      more.hidden = true;
      closePortfolioTabOverflow();
    }
  });
}
function portfolioOrderRows() {
  return state.portfolios.map((p, index) =>
    '<div class="portfolio-order-row" data-portfolio-order-id="' + esc(p.id) + '">' +
      '<span class="portfolio-order-handle">≡</span>' +
      '<strong>' + esc(p.name) + '</strong>' +
      '<div>' +
        '<button type="button" data-portfolio-order-move="-1" aria-label="Subir cartera"' + (index === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" data-portfolio-order-move="1" aria-label="Bajar cartera"' + (index === state.portfolios.length - 1 ? ' disabled' : '') + '>↓</button>' +
      '</div>' +
    '</div>'
  ).join("");
}

function refreshPortfolioOrderModal() {
  const list = $("#portfolioOrderList");
  if (list) list.innerHTML = portfolioOrderRows();
}

function openPortfolioOrderModal() {
  if (!state.portfolios.length) return;
  openModal("Ordenar carteras",
    '<div class="portfolio-order-editor">' +
      '<p>Ordena las carteras como quieres que aparezcan en la barra.</p>' +
      '<div id="portfolioOrderList" class="portfolio-order-list">' + portfolioOrderRows() + '</div>' +
      '<button type="button" class="btn" data-portfolio-order-save>Guardar orden</button>' +
    '</div>'
  );
}

async function savePortfolioOrder() {
  const button = document.querySelector("[data-portfolio-order-save]");
  if (button) { button.disabled = true; button.textContent = "Guardando…"; }
  try {
    await Promise.all(state.portfolios.map((p, index) =>
      api("/api/portfolios/" + encodeURIComponent(p.id), {
        method: "PATCH",
        body: JSON.stringify({ sortOrder: index })
      }).then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "No se pudo guardar el orden.");
        p.sort_order = index;
      })
    ));
    closeModal();
    renderApp();
    toast("Orden de carteras guardado");
  } catch (error) {
    toast(error.message || "No se pudo guardar el orden.", true);
    if (button && button.isConnected) { button.disabled = false; button.textContent = "Guardar orden"; }
  }
}

function portfolioPickerStocks(query = "") {
  const all = window.ViewInvAI && typeof window.ViewInvAI.getAllStocks === "function" ? window.ViewInvAI.getAllStocks() : [];
  const q = String(query || "").trim().toUpperCase(),scope=portfolioMarketScope(selectedPortfolio());
  let rows = all.filter(stock => {
    if(scope==="tr"&&!(stock.tradeRepublicTradable===true||(stock.tradeRepublicVerified&&stock.trTicker)))return false;
    if(scope==="us"&&!["NASDAQ","NYSE","AMEX","NYSE ARCA","NYSEARCA"].includes(String(stock.exchange||"").toUpperCase()))return false;
    if (!q) return true;
    return [stock.ticker, stock.trTicker, stock.name, stock.isin, stock.trIsin].some(v => String(v || "").toUpperCase().includes(q));
  });
  rows.sort((a, b) => (num(b.marketCap) || 0) - (num(a.marketCap) || 0));
  return rows.slice(0, 35);
}

function portfolioPickerRows(query = "") {
  const rows = portfolioPickerStocks(query);
  if (!rows.length) return '<div class="portfolio-empty-state compact">No se han encontrado acciones.</div>';
  const scope=portfolioMarketScope(selectedPortfolio());
  return rows.map(stock => {
    const key = window.ViewInvAI.getStockKey(stock),tr=!!(stock.tradeRepublicTradable || stock.tradeRepublicVerified);
    const displayTicker=scope==="tr"?(stock.trTicker||stock.ticker):(stock.ticker||stock.trTicker);
    const buttons=scope==="tr"
      ?(tr?'<button type="button" data-position-pick="'+esc(key)+'" data-position-pick-market="tr">Añadir LSX</button>':'')
      :scope==="us"
        ?'<button type="button" data-position-pick="'+esc(key)+'" data-position-pick-market="us">Añadir EEUU</button>'
        :(tr?'<button type="button" data-position-pick="'+esc(key)+'" data-position-pick-market="tr">TR</button>':'')+'<button type="button" data-position-pick="'+esc(key)+'" data-position-pick-market="us">EEUU</button>';
    return '<div class="portfolio-stock-picker-row">' +
      '<div><strong>' + esc(displayTicker||"—") + '</strong><span>' + esc(stock.name || "") + '</span></div>' +
      '<div class="portfolio-stock-picker-markets">' +buttons+'</div>' +
    '</div>';
  }).join("");
}

function openPositionPicker() {
  if (!state.user) return window.ViewInvAIAuth?.signIn?.();
  if (!state.selectedPortfolioId) {
    toast("Primero selecciona o crea una cartera.", true);
    return;
  }
  openModal("Añadir posición",
    '<div class="portfolio-stock-picker">' +
      '<input id="portfolioStockSearch" class="input" type="search" autocomplete="off" placeholder="Buscar ticker, empresa o ISIN…">' +
      '<div class="portfolio-stock-picker-results" id="portfolioStockPickerResults">' + portfolioPickerRows("") + '</div>' +
    '</div>'
  );
  const input = $("#portfolioStockSearch");
  if (input) {
    input.addEventListener("input", () => {
      const results = $("#portfolioStockPickerResults");
      if (results) results.innerHTML = portfolioPickerRows(input.value);
    });
    setTimeout(() => input.focus(), 30);
  }
}

async function loadAll({ syncFavorites = false } = {}) {
  if (!state.user || state.loading) return;
  let ok = true;
  state.loading = true;
  renderActivePortfolioPanel();
  try {
    const [portfolios, positions, watchlist, brokerData, goalData] = await Promise.all([
      fetchJson("/api/portfolios"),fetchJson("/api/positions"),fetchJson("/api/watchlist"),
      fetchJson("/api/brokers").catch(()=>({brokers:[]})),
      fetchJson("/api/portfolio-goal").then(data=>({goals:data.goals||[],error:"",ok:true})).catch(error=>({goals:null,error:error.message||"No se pudieron cargar los objetivos.",ok:false}))
    ]);
    state.portfolios=portfolios.portfolios||[];state.positions=positions.positions||[];state.watchlist=watchlist.watchlist||[];state.brokers=brokerData.brokers||[];
    if(Array.isArray(goalData.goals))state.goals=Object.fromEntries(goalData.goals.map(goal=>[String(goal.portfolio_id),goal]));
    const goalErrorText=String(goalData.error||"");
    state.goalError=/too many requests/i.test(goalErrorText)?"":goalErrorText;
    syncPortfolioStars();
    window.dispatchEvent(new CustomEvent('viewinvai:portfolio-membership-changed', {detail:{}}));
  } catch (error) {
    ok = false;
    console.warn("Portfolio loading failed", error);
    toast(error.message || "No se pudieron cargar las carteras.", true);
  } finally {
    state.loading = false;
    renderActivePortfolioPanel();
    const summaryPortfolioId = state.selectedPortfolioId;
    if (summaryPortfolioId) refreshPortfolioTransactionSummary(summaryPortfolioId).catch(() => {});
  }
  return ok;
}

async function createPortfolio(payload) {
  const nextOrder = state.portfolios.length
    ? Math.max(...state.portfolios.map(p => num(p.sort_order) ?? 0)) + 1
    : 0;
  const response = await api("/api/portfolios", {
    method: "POST",
    body: JSON.stringify(Object.assign({}, payload, { sortOrder: nextOrder }))
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "No se pudo crear la cartera.");
  state.selectedPortfolioId = data.portfolio && data.portfolio.id || state.selectedPortfolioId;
  savePortfolioUi();
  await loadAll();
  return data.portfolio;
}

async function addPosition(payload) {
  const response = await api("/api/positions", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "No se pudo guardar la posición.");

  // Do not block the modal waiting for a full portfolio reload. Update the
  // current state immediately and refresh the rest in the background.
  if (data.position) {
    const index = state.positions.findIndex(item => item.id === data.position.id);
    if (index >= 0) state.positions[index] = data.position;
    else state.positions.unshift(data.position);
    syncPortfolioStars();
    if(portfolioHasGoal(data.position.portfolio_id)){
      scheduleGoalPortfolioReview(data.position.portfolio_id,data.position.id);
    }else{
      setTimeout(async () => {
        try {
          await api("/api/analysis/run", {
            method: "POST",
            body: JSON.stringify({ subjectType: "position", subjectId: data.position.id })
          });
          await loadAll();
        } catch (error) {
          console.warn("Automatic position AI analysis failed", error);
        }
      }, 50);
    }
  }
  return data.position;
}

async function analyze(subjectType, subjectId, button) {
  if (button) {
    button.disabled = true;
    button.dataset.oldText = button.textContent;
    button.textContent = "Analizando…";
  }
  try {
    const response = await api("/api/analysis/run", {
      method: "POST",
      body: JSON.stringify({ subjectType, subjectId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo completar el análisis.");
    const analysis = data.analysis || {};
    toast((signalInfo(analysis.signal)[0] || "Análisis") + " · " + Math.round(num(analysis.confidence) || 0) + "% confianza");
    await loadAll();
  } catch (error) {
    toast(error.message || "Error durante el análisis.", true);
  } finally {
    if (button && button.isConnected) {
      button.disabled = false;
      button.textContent = button.dataset.oldText || "Analizar IA";
    }
  }
}

function closeModal() {
  const modal = $("#portfolioModal");
  const backdrop = $("#portfolioModalBackdrop");
  if (modal) {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }
  if (backdrop) {
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
  }
  document.body.classList.remove("app-modal-open");
}

function openModal(title, html) {
  const modal = $("#portfolioModal");
  const backdrop = $("#portfolioModalBackdrop");
  const body = $("#portfolioModalBody");
  const titleEl = $("#portfolioModalTitle");
  if (!modal || !backdrop || !body || !titleEl) return;
  titleEl.textContent = title;
  body.innerHTML = html;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  backdrop.classList.add("open");
  backdrop.setAttribute("aria-hidden", "false");
  document.body.classList.add("app-modal-open");
}

function localDateTimeValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return y + "-" + m + "-" + d + "T" + hh + ":" + mm;
}

function transactionPosition(positionId) {
  return state.positions.find(p => String(p.id) === String(positionId)) || null;
}

function transactionCurrencyAmounts(map, scalar, fallbackCurrency, signed = false) {
  const entries = map && typeof map === "object"
    ? Object.entries(map).map(([key, value]) => [String(key || fallbackCurrency || "EUR").toUpperCase(), num(value)]).filter(([, value]) => value !== null)
    : [];
  if (entries.length) {
    return entries.map(([key, value]) =>
      '<span class="' + (signed ? (value < 0 ? 'pnl-down' : 'pnl-up') : '') + '">' +
        (signed && value > 0 ? '+' : '') + formatMoney(value, key) +
      '</span>'
    ).join('<span class="transaction-currency-sep"> · </span>');
  }
  const value = num(scalar);
  return value === null ? '—' :
    '<span class="' + (signed ? (value < 0 ? 'pnl-down' : 'pnl-up') : '') + '">' +
      (signed && value > 0 ? '+' : '') + formatMoney(value, fallbackCurrency) +
    '</span>';
}

function transactionSummaryHtml(summary, currency) {
  if (!summary) return "";
  const qty = num(summary.quantity), avg = num(summary.avgPrice);
  const realizedHtml = transactionCurrencyAmounts(summary.realizedByCurrency, summary.realizedPnl, currency, true);
  const feesHtml = transactionCurrencyAmounts(summary.feesByCurrency, summary.totalFees, currency, false);
  return '<div class="transaction-summary">' +
    '<div><small>POSICIÓN</small><strong>' + (qty === null ? '—' : formatNumber(qty, 4) + ' uds.') + '</strong></div>' +
    '<div><small>MEDIA</small><strong>' + formatMoney(avg, currency) + '</strong></div>' +
    '<div><small>P&L REALIZADO</small><strong class="transaction-currency-values">' + realizedHtml + '</strong></div>' +
    '<div><small>COMISIONES</small><strong class="transaction-currency-values">' + feesHtml + '</strong></div>' +
  '</div>';
}

function transactionRowsHtml(rows, currency) {
  if (!rows || !rows.length) return '<div class="portfolio-empty-state compact">Todavía no hay operaciones registradas.</div>';
  return rows.map(tx => {
    const side = String(tx.side || '').toUpperCase();
    const origin = String(tx.origin || '');
    const isAdjustment = origin === 'position-adjustment';
    const isBuy = side === 'BUY';
    const txCurrency = String(tx.currency || currency || 'EUR').toUpperCase();
    const executed = tx.executed_at ? new Date(tx.executed_at) : null;
    const when = executed && !isNaN(executed)
      ? executed.toLocaleString('es-ES',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})
      : '—';
    const fees = num(tx.fees);
    return '<div class="transaction-row">' +
      '<span class="transaction-side ' + (isAdjustment ? 'adjust' : isBuy ? 'buy' : 'sell') + '">' + (isAdjustment ? 'AJUSTE' : isBuy ? 'COMPRA' : 'VENTA') + '</span>' +
      '<div class="transaction-main"><strong>' + (isAdjustment
        ? formatNumber(tx.quantity, 4) + ' uds. · media ' + formatMoney(tx.price, txCurrency)
        : formatNumber(tx.quantity, 4) + ' × ' + formatMoney(tx.price, txCurrency)) +
      '</strong><small>' + esc(when) + (fees ? ' · comisión ' + esc(formatMoney(fees, txCurrency)) : '') + '</small></div>' +
      '<div class="transaction-total"><strong>' + (isAdjustment ? 'Saldo corregido' : formatMoney((num(tx.quantity) || 0) * (num(tx.price) || 0), txCurrency)) + '</strong><small>' + esc(tx.ticker || '') + (tx.notes ? ' · ' + esc(tx.notes) : '') + '</small></div>' +
      (['manual','position-adjustment'].includes(origin) ? '<button type="button" class="transaction-delete" data-transaction-delete="' + esc(tx.id) + '" aria-label="Eliminar operación">×</button>' : '') +
    '</div>';
  }).join('');
}

async function fetchTransactions(position) {
  const qs = new URLSearchParams({
    positionId: position.id,
    portfolioId: position.portfolio_id,
    positionId: position.id,
    broker: String(position.broker || fd.get('broker') || (preferTr ? 'Trade Republic' : 'IBKR')),
    stockKey: position.stock_key,
    limit: '300'
  });
  return fetchJson('/api/transactions?' + qs.toString());
}

async function refreshPortfolioTransactionSummary(portfolioId, rerender = true) {
  portfolioId = String(portfolioId || "");
  if (!state.user || !portfolioId) return null;
  try {
    const data = await fetchJson('/api/transactions?portfolioId=' + encodeURIComponent(portfolioId) + '&limit=1');
    state.portfolioTransactionSummaries[portfolioId] = data.portfolioSummary || null;
    if (rerender && String(state.selectedPortfolioId || "") === portfolioId) renderActivePortfolioPanel();
    return data.portfolioSummary || null;
  } catch (error) {
    console.warn("Portfolio transaction summary failed", error);
    return null;
  }
}

function portfolioTransactionSummaryHtml(summary) {
  if (!summary) return "";
  const currencies = summary.currencies && typeof summary.currencies === "object" ? summary.currencies : {};
  const currencyRows = Object.entries(currencies).map(([currency, row]) => {
    const realized = num(row.realizedPnl) || 0;
    return '<div class="portfolio-history-currency">' +
      '<div><small>' + esc(currency) + ' · COMPRAS</small><strong>' + formatMoney(row.buyGross, currency) + '</strong></div>' +
      '<div><small>VENTAS</small><strong>' + formatMoney(row.sellGross, currency) + '</strong></div>' +
      '<div><small>P&L REALIZADO</small><strong class="' + (realized < 0 ? 'pnl-down' : 'pnl-up') + '">' + (realized > 0 ? '+' : '') + formatMoney(realized, currency) + '</strong></div>' +
      '<div><small>COMISIONES</small><strong>' + formatMoney(row.fees, currency) + '</strong></div>' +
    '</div>';
  }).join('');
  return '<div class="portfolio-history-overview">' +
    '<div class="transaction-history-summary">' +
      '<span><b>' + Number(summary.total || 0) + '</b> operaciones</span>' +
      '<span><b>' + Number(summary.buys || 0) + '</b> compras</span>' +
      '<span><b>' + Number(summary.sells || 0) + '</b> ventas</span>' +
      '<span><b>' + Number(summary.adjustments || 0) + '</b> ajustes</span>' +
      '<span><b>' + Number(summary.stocks || 0) + '</b> valores</span>' +
    '</div>' +
    (currencyRows ? '<div class="portfolio-history-currencies">' + currencyRows + '</div>' : '') +
  '</div>';
}

async function openPortfolioTransactionHistory(portfolioId) {
  const portfolio = state.portfolios.find(p => String(p.id) === String(portfolioId));
  if (!portfolio) return toast('No se encuentra la cartera.', true);
  openModal('Historial · ' + portfolio.name,
    '<div class="portfolio-loading compact"><span></span><p>Cargando operaciones…</p></div>'
  );
  try {
    const data = await fetchJson('/api/transactions?portfolioId=' + encodeURIComponent(portfolioId) + '&limit=500');
    const rows = data.transactions || [];
    const body = $('#portfolioModalBody');
    if (!body) return;
    body.innerHTML =
      '<div class="transaction-ledger portfolio-transaction-history">' +
        portfolioTransactionSummaryHtml(data.portfolioSummary) +
        '<div class="transaction-history-head"><strong>Movimientos de ' + esc(portfolio.name) + '</strong><span>Más reciente primero</span></div>' +
        '<div class="transaction-history">' + transactionRowsHtml(rows, portfolio.base_currency || 'EUR') + '</div>' +
      '</div>';
  } catch (error) {
    const body = $('#portfolioModalBody');
    if (body) body.innerHTML = '<div class="portfolio-empty-state compact">No se pudo cargar el historial.</div>';
    toast(error.message || 'No se pudo cargar el historial.', true);
  }
}

async function openTransactionsModal(positionId, preferredSide = null) {
  const position = transactionPosition(positionId);
  if (!position) return toast('No se encuentra la posición.', true);
  const stock = stockByKey(position.stock_key);
  const preferTr = Number(position.prefer_tr) === 1;
  const market = currentMarket(stock, preferTr);
  const currency = String(position.currency || (preferTr ? 'EUR' : 'USD')).toUpperCase();

  openModal('Operaciones · ' + (position.ticker || stock?.ticker || ''),
    '<div class="portfolio-loading compact"><span></span><p>Cargando operaciones…</p></div>'
  );

  try {
    const data = await fetchTransactions(position);
    const body = $('#portfolioModalBody');
    if (!body) return;
    body.innerHTML =
      '<div class="transaction-ledger" data-transaction-position="' + esc(position.id) + '">' +
        transactionSummaryHtml(data.summary, currency) +
        '<form id="transactionForm" class="portfolio-form transaction-form" data-position-id="' + esc(position.id) + '">' +
          '<div class="transaction-form-head"><strong>Nueva operación</strong><span>' + esc(position.name || stock?.name || '') + '</span></div>' +
          '<div class="portfolio-form-grid">' +
            '<label><span>Tipo</span><select name="side"><option value="BUY"' + (preferredSide === 'BUY' ? ' selected' : '') + '>Compra</option><option value="SELL"' + (preferredSide === 'SELL' ? ' selected' : '') + '>Venta</option></select></label>' +
            '<label><span>Cantidad</span><input name="quantity" type="number" inputmode="decimal" step="any" min="0.00000001" required></label>' +
          '</div>' +
          '<div class="portfolio-form-grid">' +
            '<label><span>Precio</span><input name="price" type="number" inputmode="decimal" step="any" min="0" required placeholder="' + esc(market.price || '') + '"></label>' +
            '<label><span>Comisión automática</span><input name="fees" type="number" inputmode="decimal" step="any" min="0" readonly></label>' +
          '</div>' +
          '<div class="portfolio-form-grid">' +
            '<label><span>Broker</span><input name="broker" value="' + esc(position.broker || (preferTr ? 'Trade Republic' : 'IBKR')) + '" readonly></label>' +
            '<label><span>Divisa</span><input name="currency" value="' + esc(currency) + '" readonly></label>' +
          '</div>' +
          '<small class="broker-fee-hint" data-transaction-fee-hint></small>'+
          '<label><span>Fecha y hora</span><input name="executedAt" type="datetime-local" value="' + localDateTimeValue() + '" required></label>' +
          '<label><span>Nota</span><input name="notes" maxlength="1000" placeholder="Opcional"></label>' +
          '<div class="portfolio-form-status" data-transaction-status aria-live="polite"></div>' +
          '<button type="submit" class="btn">Registrar operación</button>' +
        '</form>' +
        '<div class="transaction-history-head"><strong>Historial</strong><span>' + (data.transactions || []).length + ' operaciones</span></div>' +
        '<div class="transaction-history">' + transactionRowsHtml(data.transactions || [], currency) + '</div>' +
      '</div>';
    const txForm=$('#transactionForm');
    if(txForm){
      const refreshFee=()=>{
        const side=String(txForm.querySelector('[name="side"]')?.value||'BUY').toUpperCase();
        const qty=num(txForm.querySelector('[name="quantity"]')?.value)||0;
        const price=num(txForm.querySelector('[name="price"]')?.value)||num(market.price)||0;
        const broker=String(position.broker||(preferTr?'Trade Republic':'IBKR'));
        const fee=brokerFeeEstimate(broker,qty,price,currency,side);
        const input=txForm.querySelector('[name="fees"]'),hint=txForm.querySelector('[data-transaction-fee-hint]'),submit=txForm.querySelector('button[type="submit"]');
        if(input)input.value=fee.fee===null?'':String(Math.round((fee.fee+Number.EPSILON)*1000000)/1000000);
        if(hint){
          hint.textContent=fee.fee===null?'Comisión pendiente de verificación · no se registrará una operación con una tarifa inventada':'Comisión '+formatMoney(fee.fee,fee.currency)+' · '+fee.label;
          hint.classList.toggle('pending',fee.fee===null);
        }
        if(submit)submit.disabled=fee.fee===null;
      };
      ['side','quantity','price'].forEach(name=>txForm.querySelector('[name="'+name+'"]')?.addEventListener(name==='side'?'change':'input',refreshFee));
      refreshFee();
    }
  } catch (error) {
    const body = $('#portfolioModalBody');
    if (body) body.innerHTML = '<div class="portfolio-empty-state compact">No se pudieron cargar las operaciones.</div>';
    toast(error.message || 'No se pudieron cargar las operaciones.', true);
  }
}

async function saveTransactionForm(form) {
  if (!form || form.dataset.saving === '1') return;
  const position = transactionPosition(form.dataset.positionId);
  if (!position) return toast('No se encuentra la posición.', true);
  const stock = stockByKey(position.stock_key);
  const preferTr = Number(position.prefer_tr) === 1;
  const fd = new FormData(form);
  const executedRaw = String(fd.get('executedAt') || '');
  const executedDate = new Date(executedRaw);
  const payload = {
    portfolioId: position.portfolio_id,
    stockKey: position.stock_key,
    ticker: position.ticker || stock?.ticker || '',
    name: position.name || stock?.name || '',
    exchange: position.exchange || (preferTr ? stock?.trExchange : stock?.exchange) || '',
    isin: position.isin || (preferTr ? stock?.trIsin : stock?.isin) || '',
    preferTr,
    side: String(fd.get('side') || 'BUY'),
    quantity: num(fd.get('quantity')),
    price: num(fd.get('price')),
    fees: num(fd.get('fees')),
    currency: String(fd.get('currency') || position.currency || 'EUR'),
    executedAt: Number.isFinite(executedDate.getTime()) ? executedDate.toISOString() : '',
    notes: String(fd.get('notes') || '')
  };
  const status = form.querySelector('[data-transaction-status]');
  const button = form.querySelector('button[type="submit"]');
  if (!payload.quantity || payload.quantity <= 0 || payload.price === null || payload.price < 0 || !payload.executedAt) {
    if (status) status.textContent = 'Revisa cantidad, precio y fecha.';
    return;
  }

  form.dataset.saving = '1';
  if (button) { button.disabled = true; button.textContent = 'Guardando…'; }
  try {
    const response = await api('/api/transactions', {method:'POST',body:JSON.stringify(payload)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar la operación.');
    if (data.position) {
      const i = state.positions.findIndex(p => p.id === data.position.id);
      if (Number(data.position.active) === 0) {
        if (i >= 0) state.positions.splice(i, 1);
      } else if (i >= 0) state.positions[i] = data.position;
      else state.positions.unshift(data.position);
    }
    toast(payload.side === 'BUY' ? 'Compra registrada' : 'Venta registrada');
    await loadAll();
    const activePositionId=data.position&&Number(data.position.active)!==0?data.position.id:null;
    if(portfolioHasGoal(payload.portfolioId))scheduleGoalPortfolioReview(payload.portfolioId,activePositionId);
    if (activePositionId) await openTransactionsModal(activePositionId);
    else closeModal();
  } catch (error) {
    if (status) status.textContent = error.message || 'No se pudo guardar la operación.';
    toast(error.message || 'No se pudo guardar la operación.', true);
  } finally {
    delete form.dataset.saving;
    if (button && button.isConnected) { button.disabled = false; button.textContent = 'Registrar operación'; }
  }
}

function openGoalOperationModal(button){
  if(!button)return;
  const side=String(button.dataset.registerGoalOperation||"BUY").toUpperCase();
  const portfolioId=button.dataset.goalPortfolio||state.selectedPortfolioId,stockKey=button.dataset.goalStockKey||"";
  const stock=stockByKey(stockKey),portfolio=state.portfolios.find(p=>String(p.id)===String(portfolioId));
  if(!stock||!portfolio)return toast("No se pudo preparar la operación.",true);
  const preferTr=button.dataset.goalPreferTr==="1",currency=String(button.dataset.goalCurrency||(preferTr?"EUR":"USD")).toUpperCase();
  const units=Math.max(0,Math.round(num(button.dataset.goalUnits)||0)),price=num(button.dataset.goalPrice),fees=Math.max(0,num(button.dataset.goalFees)||0);
  if(units<1||price===null)return toast("La recomendación no contiene una operación ejecutable.",true);
  const position=state.positions.find(p=>Number(p.active)!==0&&String(p.portfolio_id)===String(portfolioId)&&sameStockRef(p.stock_key,stockKey))||null;
  if(side==="SELL"&&!position)return toast("No se encuentra la posición que se quiere vender.",true);
  const ticker=(preferTr&&stock.trTicker)||stock.ticker||position?.ticker||"",name=stock.name||position?.name||ticker;
  const exchange=preferTr?(stock.trExchange||"LSX"):(stock.exchange||position?.exchange||"");
  const isin=preferTr?(stock.trIsin||stock.isin||position?.isin||""):(stock.usIsin||stock.isin||position?.isin||"");
  openModal((side==="BUY"?"Registrar estrategia de compra · ":"Registrar estrategia de venta · ")+ticker,
    '<form id="goalOperationForm" class="portfolio-form transaction-form" data-portfolio-id="'+esc(portfolioId)+'" data-stock-key="'+esc(stockKey)+'" data-prefer-tr="'+(preferTr?'1':'0')+'" data-ticker="'+esc(ticker)+'" data-name="'+esc(name)+'" data-exchange="'+esc(exchange)+'" data-isin="'+esc(isin)+'">'+
      '<div class="transaction-form-head"><strong>'+esc(side==="BUY"?"Compra recomendada":"Venta recomendada")+'</strong><span>'+esc(name)+' · '+esc(portfolio.name)+'</span></div>'+
      '<input name="side" type="hidden" value="'+esc(side)+'">'+
      '<div class="portfolio-form-grid">'+
        '<label><span>Acciones</span><input name="quantity" type="number" inputmode="numeric" step="1" min="1" value="'+esc(String(units))+'" required></label>'+
        '<label><span>Precio ejecutado</span><input name="price" type="number" inputmode="decimal" step="any" min="0" value="'+esc(String(price))+'" required></label>'+
      '</div>'+
      '<div class="portfolio-form-grid">'+
        '<label><span>Comisión</span><input name="fees" type="number" inputmode="decimal" step="any" min="0" value="'+esc(String(fees))+'"></label>'+
        '<label><span>Divisa</span><input name="currency" value="'+esc(currency)+'" readonly></label>'+
      '</div>'+
      '<label><span>Fecha y hora</span><input name="executedAt" type="datetime-local" value="'+localDateTimeValue()+'" required></label>'+
      '<label><span>Nota</span><input name="notes" maxlength="1000" value="'+esc("Objetivo IA · "+(side==="BUY"?"compra":"venta")+" recomendada")+'"></label>'+
      '<p class="portfolio-form-note">Registra la operación cuando se haya ejecutado. Corrige el precio si el precio real difiere del límite recomendado. El efectivo se recalculará automáticamente; seguirá pudiendo editarse manualmente.</p>'+
      '<div class="portfolio-form-status" data-goal-operation-status aria-live="polite"></div>'+
      '<button type="submit" class="btn">Registrar estrategia</button>'+
    '</form>'
  );
}
async function saveGoalOperationForm(form){
  if(!form||form.dataset.saving==="1")return;
  const fd=new FormData(form),preferTr=form.dataset.preferTr==="1",side=String(fd.get("side")||"BUY").toUpperCase();
  const executedDate=new Date(String(fd.get("executedAt")||""));
  const payload={
    portfolioId:form.dataset.portfolioId,stockKey:form.dataset.stockKey,ticker:form.dataset.ticker||"",
    name:form.dataset.name||"",exchange:form.dataset.exchange||"",isin:form.dataset.isin||"",preferTr,
    side,quantity:Math.max(0,Math.round(num(fd.get("quantity"))||0)),price:num(fd.get("price")),
    fees:Math.max(0,num(fd.get("fees"))??(preferTr?1:0)),currency:String(fd.get("currency")||(preferTr?"EUR":"USD")).toUpperCase(),
    executedAt:Number.isFinite(executedDate.getTime())?executedDate.toISOString():"",notes:String(fd.get("notes")||"")
  };
  const portfolio=state.portfolios.find(item=>String(item.id)===String(payload.portfolioId));
  const baseCurrency=String(portfolio&&portfolio.base_currency||payload.currency).toUpperCase(),fxUsdEur=portfolioUsdToEurRate();
  if(baseCurrency!==payload.currency){
    if(payload.currency==="USD"&&baseCurrency==="EUR"&&num(fxUsdEur)!==null)payload.cashFxRate=num(fxUsdEur);
    else if(payload.currency==="EUR"&&baseCurrency==="USD"&&num(fxUsdEur)!==null&&num(fxUsdEur)>0)payload.cashFxRate=1/num(fxUsdEur);
  }
  const status=form.querySelector("[data-goal-operation-status]"),button=form.querySelector('button[type="submit"]');
  if(payload.quantity<1||payload.price===null||payload.price<0||!payload.executedAt){if(status)status.textContent="Revisa cantidad, precio y fecha.";return}
  form.dataset.saving="1";if(button){button.disabled=true;button.textContent="Guardando…"}
  try{
    const response=await api("/api/transactions",{method:"POST",body:JSON.stringify(payload)}),data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"No se pudo registrar la operación.");
    await loadAll();
    state.goalCandidateCache={at:0,key:"",rows:[]};
    const cash=data.cashAdjustment&&data.cashAdjustment.adjusted?(" · efectivo "+formatMoney(data.cashAdjustment.cashBalance,data.cashAdjustment.baseCurrency||"EUR")):"";
    toast((side==="BUY"?"Compra":"Venta")+" registrada"+cash);
    closeModal();
    if(state.primaryTab==="goal")renderGoalApp();
    if(portfolioHasGoal(payload.portfolioId))scheduleGoalPortfolioReview(payload.portfolioId,data.position&&Number(data.position.active)!==0?data.position.id:null);
  }catch(error){
    if(status)status.textContent=error.message||"No se pudo registrar la operación.";
    toast(error.message||"No se pudo registrar la operación.",true);
  }finally{
    delete form.dataset.saving;if(button&&button.isConnected){button.disabled=false;button.textContent="Registrar estrategia"}
  }
}

async function deleteTransaction(transactionId) {
  if (!transactionId) return;
  const ledger = document.querySelector('[data-transaction-position]');
  const positionId = ledger && ledger.dataset.transactionPosition;
  const beforePosition=positionId?transactionPosition(positionId):null;
  const portfolioId=beforePosition&&beforePosition.portfolio_id||null;
  try {
    const response = await api('/api/transactions/' + encodeURIComponent(transactionId), {method:'DELETE'});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo eliminar la operación.');
    toast('Operación eliminada');
    await loadAll();
    const activePositionId=data.position&&Number(data.position.active)!==0?data.position.id:null;
    if(portfolioId&&portfolioHasGoal(portfolioId))scheduleGoalPortfolioReview(portfolioId,activePositionId);
    if (activePositionId) await openTransactionsModal(activePositionId);
    else if (positionId) closeModal();
  } catch (error) {
    toast(error.message || 'No se pudo eliminar la operación.', true);
  }
}

function openNewPortfolioModal() {
  if (!state.user) return window.ViewInvAIAuth && window.ViewInvAIAuth.signIn();
  openModal("Nueva cartera",
    '<form id="newPortfolioForm" class="portfolio-form">' +
      '<label><span>Nombre</span><input name="name" required maxlength="80" placeholder="Trade Republic"></label>' +
      '<label><span>Bróker</span><input name="broker" maxlength="80" placeholder="Trade Republic, IBKR…"></label>' +
      '<label><span>Mercado de la cartera</span><select name="marketScope" required><option value="auto">Detectar por posiciones</option><option value="tr">Trade Republic / LSX</option><option value="us">EEUU (NASDAQ / NYSE / AMEX)</option></select></label>' +
      '<label><span>Divisa base</span><select name="baseCurrency"><option>EUR</option><option>USD</option><option>GBP</option></select></label>' +
      '<label><span>Efectivo disponible</span><input name="cashBalance" type="number" min="0" step="0.01" inputmode="decimal" value="0" placeholder="0"></label>' +
      '<button type="submit" class="btn">Crear cartera</button>' +
    '</form>'
  );
  setTimeout(() => $("#newPortfolioForm input[name=name]")?.focus(), 40);
}

function openPortfolioMarketModal(portfolioId){
  const portfolio=state.portfolios.find(p=>String(p.id)===String(portfolioId));if(!portfolio)return;
  const scope=String(portfolio.market_scope||"auto"),currency=String(portfolio.base_currency||"EUR").toUpperCase();
  openModal("Mercado · "+portfolio.name,
    '<form id="portfolioMarketForm" class="portfolio-form" data-portfolio-id="'+esc(portfolio.id)+'">'+
      '<label><span>Mercado permitido</span><select name="marketScope">'+
        '<option value="auto"'+(scope==="auto"?' selected':'')+'>Detectar por posiciones</option>'+
        '<option value="tr"'+(scope==="tr"?' selected':'')+'>Trade Republic / LSX</option>'+
        '<option value="us"'+(scope==="us"?' selected':'')+'>EEUU (NASDAQ / NYSE / AMEX)</option>'+
      '</select></label>'+
      '<label><span>Divisa base</span><select name="baseCurrency"><option value="EUR"'+(currency==="EUR"?' selected':'')+'>EUR</option><option value="USD"'+(currency==="USD"?' selected':'')+'>USD</option><option value="GBP"'+(currency==="GBP"?' selected':'')+'>GBP</option></select></label>'+
      '<button type="submit" class="btn">Guardar</button>'+
    '</form>'
  );
}
async function savePortfolioMarket(form){
  const portfolioId=form.dataset.portfolioId,fd=new FormData(form),marketScope=String(fd.get("marketScope")||"auto"),baseCurrency=String(fd.get("baseCurrency")||"EUR").toUpperCase();
  const response=await api("/api/portfolios/"+encodeURIComponent(portfolioId),{method:"PATCH",body:JSON.stringify({marketScope,baseCurrency})});
  const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"No se pudo guardar el mercado.");
  const index=state.portfolios.findIndex(p=>String(p.id)===String(portfolioId));if(index>=0)state.portfolios[index]=data.portfolio;
  state.goalCandidateCache={at:0,key:"",rows:[]};closeModal();renderActivePortfolioPanel();if(portfolioHasGoal(portfolioId))scheduleGoalPortfolioReview(portfolioId,null);toast("Mercado de la cartera actualizado");
}
function openPortfolioCashModal(portfolioId){
  const portfolio=state.portfolios.find(p=>String(p.id)===String(portfolioId));if(!portfolio)return;
  const cash=Math.max(0,num(portfolio.cash_balance)||0),currency=String(portfolio.base_currency||"EUR").toUpperCase();
  openModal("Capital líquido · "+portfolio.name,
    '<form id="portfolioCashBalanceForm" class="portfolio-form" data-portfolio-id="'+esc(portfolio.id)+'">'+
      '<label><span>Disponible ('+esc(currency)+')</span><input name="cashBalance" type="number" min="0" step="0.01" inputmode="decimal" value="'+esc(String(Math.round(cash*100)/100))+'" autofocus></label>'+
      '<button type="submit" class="btn">Guardar efectivo</button>'+
    '</form>'
  );
}
async function savePortfolioCash(form){
  const portfolioId=form.dataset.portfolioId,fd=new FormData(form),cashBalance=Math.max(0,num(fd.get("cashBalance"))||0);
  const response=await api("/api/portfolios/"+encodeURIComponent(portfolioId),{method:"PATCH",body:JSON.stringify({cashBalance})});
  const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"No se pudo guardar el capital líquido.");
  const index=state.portfolios.findIndex(p=>String(p.id)===String(portfolioId));if(index>=0)state.portfolios[index]=data.portfolio;
  state.goalCandidateCache={at:0,key:"",rows:[]};closeModal();renderActivePortfolioPanel();if(portfolioHasGoal(portfolioId))scheduleGoalPortfolioReview(portfolioId,null);toast("Capital líquido actualizado");
}

function stockFormPayload(stock, form) {
  const fd = new FormData(form);
  const preferTr = form.dataset.preferTr === "1";
  const ticker = preferTr && stock.trTicker ? stock.trTicker : stock.ticker;
  return {
    portfolioId: String(fd.get("portfolioId") || form.querySelector('[name="portfolioId"]')?.value || ""),
    stockKey: window.ViewInvAI.getStockKey(stock),
    ticker: String(ticker || stock.ticker || ""),
    name: stock.name || "",
    exchange: preferTr ? (stock.trExchange || "LSX") : (stock.exchange || ""),
    isin: preferTr ? (stock.trIsin || stock.isin || "") : (stock.isin || stock.usIsin || ""),
    preferTr,
    quantity: num(fd.get("quantity")),
    avgPrice: num(fd.get("avgPrice")),
    currency: String(fd.get("currency") || form.querySelector('[name="currency"]')?.value || (preferTr ? "EUR" : stock.currency || "USD")),
    openedAt: String(fd.get("openedAt") || ""),
    notes: String(fd.get("notes") || ""),
    broker: String(fd.get("broker") || form.querySelector('[data-broker-select]')?.value || "")
  };
}

function localDateValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

function positionForPortfolioStock(stockKey, portfolioId) {
  return state.positions.find(p =>
    sameStockRef(p.stock_key, stockKey) &&
    String(p.portfolio_id) === String(portfolioId) &&
    Number(p.active) !== 0
  ) || null;
}
function positionForPortfolioIdentity(stockKey,portfolioId,broker,currency,preferTr,exchange){
  const brokerKey=String(broker||"").trim().toLowerCase(),currencyKey=String(currency||"").trim().toUpperCase(),exchangeKey=String(exchange||"").trim().toUpperCase();
  return state.positions.find(p =>
    sameStockRef(p.stock_key,stockKey) &&
    String(p.portfolio_id)===String(portfolioId) &&
    Number(p.active)!==0 &&
    String(p.broker||"").trim().toLowerCase()===brokerKey &&
    String(p.currency||"").trim().toUpperCase()===currencyKey &&
    Number(p.prefer_tr)===(preferTr?1:0) &&
    String(p.exchange||"").trim().toUpperCase()===exchangeKey
  )||null;
}
function brokerSelectOptions(selected=""){
  const selectedKey=String(selected||"").trim().toLowerCase();
  return brokerRecords().map(row=>{
    const value=String(row.name||row.canonical_name||row.code||"").trim();
    const active=value.toLowerCase()===selectedKey||String(row.canonical_name||"").toLowerCase()===selectedKey;
    return '<option value="'+esc(value)+'"'+(active?' selected':'')+'>'+esc(brokerDisplayName(row))+'</option>';
  }).join('');
}
function brokerIsTradeRepublic(name){
  const row=brokerRecordByName(name),key=String(row&&row.code||row&&row.canonical_name||name||"").toLowerCase();
  return key==="tr"||/trade\s*republic/.test(key);
}
function brokerDefaultName(portfolio,preferTr){
  const portfolioBroker=String(portfolio&&portfolio.broker||"").trim();
  if(portfolioBroker)return portfolioBroker;
  return preferTr?"Trade Republic":"IBKR";
}

function applyPositionFormState(form, stock, fallbackPreferTr) {
  if(!form||!stock)return;
  const portfolioId=form.querySelector('[name="portfolioId"]')?.value||'';
  const portfolio=state.portfolios.find(p=>String(p.id)===String(portfolioId))||null,scope=portfolioMarketScope(portfolio);
  const brokerSelect=form.querySelector('[name="broker"]');
  let broker=String(brokerSelect?.value||form.dataset.defaultBroker||brokerDefaultName(portfolio,fallbackPreferTr)).trim();
  if(brokerSelect&&!brokerSelect.value){
    brokerSelect.value=broker;
    broker=brokerSelect.value||broker;
  }
  let preferTr=brokerIsTradeRepublic(broker)?true:(scope==="tr"?true:scope==="us"?false:fallbackPreferTr);
  const editId=String(form.dataset.editPositionId||"");
  let existing=editId?state.positions.find(p=>String(p.id)===editId)||null:null;
  const currency=form.querySelector('[name="currency"]');
  const preferredCurrency=existing
    ?String(existing.currency||(preferTr?'EUR':stock.currency||'USD')).toUpperCase()
    :(preferTr?'EUR':String(currency?.value||stock.currency||'USD').toUpperCase());
  const exchange=preferTr?(stock.trExchange||'LSX'):(stock.exchange||'');
  if(!existing)existing=positionForPortfolioIdentity(form.dataset.stockKey,portfolioId,broker,preferredCurrency,preferTr,exchange);
  const isEdit=!!editId;
  if(existing&&isEdit){
    preferTr=Number(existing.prefer_tr)===1;
    broker=String(existing.broker||broker);
    if(brokerSelect){brokerSelect.value=broker;brokerSelect.disabled=true}
  }
  const current=currentMarket(stock,preferTr);
  form.dataset.preferTr=preferTr?'1':'0';
  form.dataset.existingPositionId=existing?.id||'';

  const quantity=form.querySelector('[name="quantity"]');
  const avgPrice=form.querySelector('[name="avgPrice"]');
  const openedAt=form.querySelector('[name="openedAt"]');
  const notes=form.querySelector('[name="notes"]');
  const save=form.querySelector('[data-save-position]');
  const mode=form.querySelector('[data-position-form-mode]');
  const feeHint=form.querySelector('[data-broker-fee-hint]');

  if(currency){
    if(isEdit&&existing)currency.value=String(existing.currency||preferredCurrency).toUpperCase();
    else if(brokerIsTradeRepublic(broker))currency.value='EUR';
  }
  const finalCurrency=String(currency?.value||preferredCurrency).toUpperCase();
  if(!isEdit&&existing&&String(existing.currency||'').toUpperCase()!==finalCurrency)existing=null;

  if(quantity)quantity.value=isEdit&&existing&&num(existing.quantity)!==null?existing.quantity:'';
  if(avgPrice){
    avgPrice.value=isEdit&&existing&&num(existing.avg_price)!==null?existing.avg_price:'';
    avgPrice.placeholder=current.price===null?'':String(current.price);
  }
  if(openedAt)openedAt.value=isEdit&&existing&&existing.opened_at?String(existing.opened_at).slice(0,10):localDateValue();
  if(notes)notes.value=isEdit&&existing?(existing.notes||''):'';

  const incompatible=scope==="tr"&&!(stock.tradeRepublicTradable===true||(stock.tradeRepublicVerified&&stock.trTicker));
  if(save){
    save.disabled=incompatible;
    save.textContent=isEdit?'Guardar cambios':existing?'Añadir compra':'Añadir posición';
  }
  if(mode)mode.textContent=incompatible
    ?'Esta acción no está verificada para Trade Republic / LSX y no puede añadirse a esta cartera.'
    :isEdit&&existing
      ?'Corrigiendo posición · broker y mercado bloqueados para no mezclar historiales.'
      :existing
        ?'Ya tienes '+formatNumber(existing.quantity,4)+' uds. en '+broker+' · media '+formatMoney(existing.avg_price,existing.currency||finalCurrency)+'. Esta compra se sumará y recalculará el precio medio.'
        :'Nueva posición · '+broker+' · '+portfolioMarketLabel(scope)+'.';
  if(feeHint){
    const fee=brokerFeeEstimate(broker,num(quantity?.value)||1,num(avgPrice?.value)||num(current.price)||0,finalCurrency,'BUY');
    feeHint.textContent=fee.fee===null
      ?'Comisión: pendiente de verificar'
      :'Comisión estimada: '+formatMoney(fee.fee,fee.currency)+' · '+fee.label;
    feeHint.classList.toggle('pending',fee.fee===null);
  }
}

function updatePositionBrokerFeeHint(form,stock){
  if(!form||!stock)return;
  const broker=String(form.querySelector('[data-broker-select]')?.value||"").trim();
  const quantity=num(form.querySelector('[name="quantity"]')?.value)||0;
  const price=num(form.querySelector('[name="avgPrice"]')?.value)||num(currentMarket(stock,form.dataset.preferTr==="1").price)||0;
  const currency=String(form.querySelector('[name="currency"]')?.value||(form.dataset.preferTr==="1"?"EUR":"USD")).toUpperCase();
  const hint=form.querySelector('[data-broker-fee-hint]');
  if(!hint)return;
  const fee=brokerFeeEstimate(broker,quantity,price,currency,'BUY');
  hint.textContent=fee.fee===null?'Comisión automática pendiente de verificar':'Comisión estimada '+formatMoney(fee.fee,fee.currency)+' · '+fee.label;
  hint.classList.toggle('pending',fee.fee===null);
}
async function createBrokerFromPositionForm(form,stock){
  const input=form&&form.querySelector('[data-new-broker-name]'),button=form&&form.querySelector('[data-create-broker]');
  const name=String(input&&input.value||"").trim();
  if(!name)return;
  if(button){button.disabled=true;button.textContent='Añadiendo…'}
  try{
    const response=await api('/api/brokers',{method:'POST',body:JSON.stringify({name})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'No se pudo crear el broker.');
    if(data.broker){
      const idx=state.brokers.findIndex(x=>String(x.id)===String(data.broker.id)||String(x.name).toLowerCase()===String(data.broker.name).toLowerCase());
      if(idx>=0)state.brokers[idx]=data.broker;else state.brokers.push(data.broker);
      const select=form.querySelector('[data-broker-select]');
      if(select){
        select.innerHTML=brokerSelectOptions(data.broker.name);
        select.value=data.broker.name;
      }
      const creator=form.querySelector('[data-broker-create-inline]');if(creator)creator.hidden=true;
      applyPositionFormState(form,stock,form.dataset.preferTr==="1");
      toast(name+' añadido · verificando comisiones oficiales');
      if(data.broker.id){
        api('/api/brokers/'+encodeURIComponent(data.broker.id)+'/verify',{method:'POST'}).then(async r=>{
          const verified=await r.json().catch(()=>({}));
          if(!r.ok||!verified.broker)return;
          const i=state.brokers.findIndex(x=>String(x.id)===String(verified.broker.id));
          if(i>=0)state.brokers[i]=verified.broker;
          const sel=form.isConnected&&form.querySelector('[data-broker-select]');
          if(sel){
            const value=sel.value;
            sel.innerHTML=brokerSelectOptions(value);
            sel.value=value;
            updatePositionBrokerFeeHint(form,stock);
          }
          if(String(verified.broker.verification_status)==='verified')toast((verified.broker.canonical_name||verified.broker.name)+' · comisiones verificadas');
        }).catch(()=>null);
      }
    }
  }catch(error){toast(error.message||'No se pudo crear el broker.',true)}
  finally{if(button&&button.isConnected){button.disabled=false;button.textContent='Añadir'}}
}
function openAddPositionModal(stockKey, preferTrOverride = null, portfolioIdOverride = null, editPositionId = null) {
  if(!state.user)return window.ViewInvAIAuth&&window.ViewInvAIAuth.signIn();
  if(!state.portfolios.length){toast("Primero crea una cartera.",true);openNewPortfolioModal();return}
  const stock=stockByKey(stockKey);
  if(!stock){toast("Abre primero una acción para añadirla.",true);return}

  const editPosition=editPositionId?state.positions.find(p=>String(p.id)===String(editPositionId))||null:null;
  const memberships=activePortfolioMemberships(stockKey);
  const preferredPortfolioId=editPosition?.portfolio_id||portfolioIdOverride||
    (state.selectedPortfolioId&&state.portfolios.some(p=>p.id===state.selectedPortfolioId)?state.selectedPortfolioId:'')||
    (memberships.length===1?memberships[0].position.portfolio_id:'')||state.portfolios[0].id;
  const preferredPortfolio=state.portfolios.find(p=>String(p.id)===String(preferredPortfolioId))||null;
  const scope=portfolioMarketScope(preferredPortfolio);
  const preferTr=editPosition?Number(editPosition.prefer_tr)===1:
    scope==="tr"?true:scope==="us"?false:
    preferTrOverride===true?true:preferTrOverride===false?false:!!(stock.tradeRepublicTradable||stock.tradeRepublicVerified);
  if(scope==="tr"&&!(stock.tradeRepublicTradable===true||(stock.tradeRepublicVerified&&stock.trTicker))){
    toast("Esta acción no está verificada como negociable en Trade Republic / LSX.",true);return;
  }
  const defaultBroker=String(editPosition?.broker||brokerDefaultName(preferredPortfolio,preferTr)).trim();
  const current=currentMarket(stock,preferTr);
  const options=state.portfolios.map(p=>'<option value="'+esc(p.id)+'"'+(String(p.id)===String(preferredPortfolioId)?' selected':'')+'>'+esc(p.name)+'</option>').join('');
  const brokerDisabled=!!editPosition;

  openModal((editPosition?'Editar ':'Añadir ')+(stock.trTicker||stock.ticker||"acción"),
    '<form id="addPositionForm" class="portfolio-form" data-stock-key="'+esc(stockKey)+'" data-prefer-tr="'+(preferTr?'1':'0')+'" data-default-broker="'+esc(defaultBroker)+'"'+(editPosition?' data-edit-position-id="'+esc(editPosition.id)+'"':'')+' data-return-view="'+esc(document.querySelector('.view.active')?.id||'')+'" data-return-scroll="'+esc(String(Math.max(0,Math.round(window.scrollY||0))))+'">'+
      '<div class="position-form-stock"><strong>'+esc(stock.trTicker||stock.ticker||"")+'</strong><span>'+esc(stock.name||"")+'</span><b>'+formatMoney(current.price,current.currency)+'</b></div>'+
      '<div class="portfolio-form-mode" data-position-form-mode></div>'+
      '<label><span>Cartera</span><select name="portfolioId" required'+(editPosition?' disabled':'')+'>'+options+'</select></label>'+
      '<div class="portfolio-broker-field"><label><span>Broker</span><div class="portfolio-broker-select-row"><select data-broker-select'+(brokerDisabled?' disabled':'')+'>'+brokerSelectOptions(defaultBroker)+'</select>'+
        (!brokerDisabled?'<button type="button" class="portfolio-broker-add" data-toggle-broker-create aria-label="Añadir broker" title="Añadir broker">＋</button>':'')+
      '</div></label>'+
      (!brokerDisabled?'<div class="broker-create-inline" data-broker-create-inline hidden><input type="text" data-new-broker-name maxlength="80" placeholder="Nombre del broker, p. ej. DEGIRO"><button type="button" data-create-broker>Añadir</button></div>':'')+
      '<small class="broker-fee-hint" data-broker-fee-hint></small></div>'+
      '<div class="portfolio-form-grid"><label><span>'+(editPosition?'Cantidad':'Cantidad de esta compra')+'</span><input name="quantity" type="number" inputmode="decimal" step="any" min="0" placeholder="0"></label>'+
      '<label><span>'+(editPosition?'Precio medio':'Precio de compra')+'</span><input name="avgPrice" type="number" inputmode="decimal" step="any" min="0" placeholder="'+esc(current.price||"")+'"></label></div>'+
      '<div class="portfolio-form-grid"><label><span>Divisa</span><select name="currency"'+(editPosition?' disabled':'')+'><option>EUR</option><option>USD</option><option>GBP</option></select></label>'+
      '<label><span>Fecha de entrada</span><span class="portfolio-date-field"><input id="openedAtInput" name="openedAt" type="date" value="'+localDateValue()+'" required><button type="button" class="portfolio-date-picker" data-open-date-picker aria-label="Abrir calendario">📅</button></span></label></div>'+
      '<label><span>Nota</span><textarea name="notes" rows="2" maxlength="1000" placeholder="Opcional"></textarea></label>'+
      '<div class="portfolio-form-status" data-position-status aria-live="polite"></div>'+
      '<button type="button" class="btn" data-save-position>'+(editPosition?'Guardar cambios':'Añadir posición')+'</button>'+
    '</form>'
  );

  const form=$("#addPositionForm"),saveButton=form?.querySelector("[data-save-position]");
  if(form){
    const brokerSelect=form.querySelector('[data-broker-select]');
    const currencySelect=form.querySelector('[name="currency"]');
    if(editPosition&&currencySelect)currencySelect.disabled=false;
    applyPositionFormState(form,stock,preferTr);
    if(editPosition&&currencySelect)currencySelect.disabled=true;
    form.querySelector('[name="portfolioId"]')?.addEventListener('change',()=>applyPositionFormState(form,stock,preferTrOverride===true?true:preferTrOverride===false?false:preferTr));
    brokerSelect?.addEventListener('change',()=>applyPositionFormState(form,stock,form.dataset.preferTr==="1"));
    currencySelect?.addEventListener('change',()=>applyPositionFormState(form,stock,form.dataset.preferTr==="1"));
    form.querySelector('[data-toggle-broker-create]')?.addEventListener('click',()=>{
      const creator=form.querySelector('[data-broker-create-inline]');if(!creator)return;
      creator.hidden=!creator.hidden;if(!creator.hidden)creator.querySelector('input')?.focus();
    });
    form.querySelector('[data-create-broker]')?.addEventListener('click',()=>createBrokerFromPositionForm(form,stock));
    ['quantity','avgPrice'].forEach(name=>form.querySelector('[name="'+name+'"]')?.addEventListener('input',()=>updatePositionBrokerFeeHint(form,stock)));
    updatePositionBrokerFeeHint(form,stock);
  }
  if(form&&saveButton){
    saveButton.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();savePositionForm(form)});
  }
}


function activePortfolioMemberships(stockKey) {
  return state.positions
    .filter(p => sameStockRef(p.stock_key, stockKey) && Number(p.active) !== 0)
    .map(p => ({
      position: p,
      portfolio: state.portfolios.find(x => String(x.id) === String(p.portfolio_id)) || null
    }));
}

function isInPortfolio(stockKey) {
  return activePortfolioMemberships(stockKey).length > 0;
}

function confirmRemoveExposure(positionId) {
  const position = transactionPosition(positionId);
  if (!position) return toast('No se encuentra la posición.', true);
  const portfolio = state.portfolios.find(p => String(p.id) === String(position.portfolio_id));
  const currency = String(position.currency || 'EUR').toUpperCase();
  openModal('Eliminar exposición',
    '<div class="portfolio-remove-confirm">' +
      '<strong>' + esc(position.ticker || '') + ' · ' + esc(portfolio?.name || 'Cartera') + '</strong>' +
      '<p>Esto elimina completamente esta posición de la cartera. No se interpreta como una venta parcial ni modifica otras carteras.</p>' +
      '<div class="portfolio-remove-confirm-data"><span>' + esc(formatNumber(position.quantity,4)) + ' uds.</span><span>Media ' + esc(formatMoney(position.avg_price,currency)) + '</span></div>' +
      '<div class="portfolio-remove-confirm-actions">' +
        '<button type="button" class="btn ghost" data-cancel-remove-exposure>Cancelar</button>' +
        '<button type="button" class="btn danger" data-confirm-remove-exposure="' + esc(position.id) + '">Eliminar exposición completa</button>' +
      '</div>' +
    '</div>'
  );
}

async function removePositionMembership(position) {
  if (!position || !position.id) return false;
  const response = await api('/api/positions/' + encodeURIComponent(position.id), {method:'DELETE'});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'No se pudo quitar de la cartera.');
  state.positions = state.positions.filter(p => p.id !== position.id);
  syncPortfolioStars();
  window.dispatchEvent(new CustomEvent('viewinvai:portfolio-membership-changed', {detail:{stockKey:position.stock_key}}));
  state.goalCandidateCache={at:0,key:"",rows:[]};
  if(portfolioHasGoal(position.portfolio_id))scheduleGoalPortfolioReview(position.portfolio_id,null);
  renderApp();
  return true;
}

async function removeStockFromPortfolio(stockKey, portfolioId = null) {
  const memberships = activePortfolioMemberships(stockKey);
  if (!memberships.length) return false;

  let target = null;
  if (portfolioId) target = memberships.find(x => String(x.position.portfolio_id) === String(portfolioId)) || null;
  else if (memberships.length === 1) target = memberships[0];

  if (target) {
    try {
      await removePositionMembership(target.position);
      toast('Quitada de ' + (target.portfolio?.name || 'la cartera'));
      closeModal();
      return true;
    } catch (error) {
      toast(error.message || 'No se pudo quitar de la cartera.', true);
      return false;
    }
  }

  const rows = memberships.map(({position,portfolio}) =>
    '<button type="button" class="star-portfolio-choice selected portfolio-remove-choice" data-remove-stock-portfolio="' + esc(position.portfolio_id) + '" data-remove-stock-key="' + esc(stockKey) + '">' +
      '<span>−</span><strong>' + esc(portfolio?.name || 'Cartera') + '</strong><small>Quitar de esta cartera</small>' +
    '</button>'
  ).join('');
  const stock = stockByKey(stockKey);
  openModal('Quitar de cartera',
    '<div class="star-portfolio-menu">' +
      '<div class="star-stock-summary"><strong>' + esc(stock?.trTicker || stock?.ticker || '') + '</strong><span>' + esc(stock?.name || '') + '</span></div>' +
      rows +
    '</div>'
  );
  return true;
}

function openStarMenu(stockKey, preferTr = null) {
  if (!state.user) return window.ViewInvAIAuth?.signIn?.();
  const stock = stockByKey(stockKey);
  if (!stock) return;
  const ticker=(preferTr&&stock.trTicker)||stock.ticker||stock.trTicker||"";
  const memberships=activePortfolioMemberships(stockKey);
  const rows = memberships.map(({position:existing,portfolio:p}) => {
    if(!p)return"";
    const qty=num(existing.quantity),avg=num(existing.avg_price),currency=String(existing.currency||(Number(existing.prefer_tr)===1?'EUR':'USD')).toUpperCase();
    const detail=(qty===null?'Posición activa':formatNumber(qty,4)+' uds.')+(avg===null?'':' · media '+formatMoney(avg,currency));
    return '<div class="exposure-manager-row">'+
      '<div class="exposure-manager-copy"><strong>'+esc(p.name)+'</strong><small>'+esc(detail)+'</small></div>'+
      '<div class="exposure-manager-actions exposure-manager-trade-actions">'+
        '<button type="button" class="btn exposure-buy" data-position-operation="'+esc(existing.id)+'" data-operation-side="BUY">Comprar</button>'+
        '<button type="button" class="btn ghost exposure-sell" data-position-operation="'+esc(existing.id)+'" data-operation-side="SELL">Vender</button>'+
        '<button type="button" class="btn ghost" data-edit-portfolio-position="'+esc(existing.id)+'">Modificar exposición</button>'+
        '<button type="button" class="btn danger" data-remove-exposure-position="'+esc(existing.id)+'">Eliminar exposición</button>'+
      '</div>'+
    '</div>';
  }).join('');
  const hasExposure=memberships.length>0;
  const addAction = !hasExposure
    ? '<button type="button" class="btn star-create-portfolio" data-star-create-stock="' + esc(stockKey) + '" data-star-prefer-tr="' + (preferTr === true ? '1' : preferTr === false ? '0' : '') + '">＋ Añadir a una cartera</button>'
    : '';
  openModal(hasExposure ? "Gestionar exposición de "+ticker : "Añadir "+ticker+" a cartera",
    '<div class="star-portfolio-menu exposure-manager-menu">'+
      (rows || '<div class="portfolio-empty-state compact">Esta acción no está en ninguna cartera.</div>')+
      addAction+
    '</div>'
  );
}

function openAddToSpecificPortfolio(stockKey, portfolioId, preferTr) {
  state.selectedPortfolioId = portfolioId || state.selectedPortfolioId;
  closeModal();
  setTimeout(() => openAddPositionModal(stockKey, preferTr), 30);
}

async function syncFavorite(active, key, preferTrOverride=null) {
  if (!state.user || !key) return;
  try {
    const existing = state.watchlist.find(x => sameStockRef(x.stock_key, key));
    if (active) {
      if (existing) return existing;
      const stock = stockByKey(key);
      if (!stock) return;
      const preferTr = preferTrOverride===true?true:preferTrOverride===false?false:!!(stock.tradeRepublicTradable||stock.tradeRepublicVerified);
      const response = await api("/api/watchlist", {
        method: "POST",
        body: JSON.stringify({
          stockKey: key,
          ticker: preferTr && stock.trTicker ? stock.trTicker : stock.ticker,
          name: stock.name || "",
          exchange: preferTr ? (stock.trExchange || "LSX") : (stock.exchange || ""),
          isin: preferTr ? (stock.trIsin || stock.isin || "") : (stock.isin || stock.usIsin || ""),
          preferTr
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se pudo sincronizar el favorito.");
      if (data.item) state.watchlist.unshift(data.item);
    } else if (existing) {
      const response = await api("/api/watchlist/" + encodeURIComponent(existing.id), { method: "DELETE" });
      if (!response.ok) throw new Error("No se pudo quitar del seguimiento.");
      state.watchlist = state.watchlist.filter(x => x.id !== existing.id);
    }
    syncPortfolioStars();
    renderApp();
    return state.watchlist.find(x=>sameStockRef(x.stock_key,key))||null;
  } catch (error) {
    console.warn("Favorite sync failed", error);
    toast("No se pudo actualizar el seguimiento.", true);
    throw error;
  }
}

async function syncLocalFavorites(){ syncPortfolioStars(); }

async function savePositionForm(form) {
  if (!form || form.dataset.saving === "1") return;

  const stock = stockByKey(form.dataset.stockKey);
  if (!stock) {
    toast("La acción ya no está disponible.", true);
    return;
  }

  const button = form.querySelector("[data-save-position],button[type=\"submit\"]");
  const status = form.querySelector("[data-position-status]");
  const oldText = button ? button.textContent : "";

  const setStatus = (message, error = false) => {
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("error", !!error);
    status.classList.toggle("visible", !!message);
  };

  try {
    if (!form.reportValidity()) {
      setStatus("Revisa los campos marcados.", true);
      return;
    }

    const payload = stockFormPayload(stock, form);
    if (!payload.openedAt || !/^\d{4}-\d{2}-\d{2}$/.test(payload.openedAt)) {
      throw new Error("Selecciona una fecha de entrada válida.");
    }

    form.dataset.saving = "1";
    if (button) {
      button.disabled = true;
      button.textContent = "Guardando…";
    }
    setStatus("Guardando posición…");

    const editPositionId=String(form.dataset.editPositionId||"");
    if(editPositionId){
      const response=await api('/api/positions/'+encodeURIComponent(editPositionId),{method:'PATCH',body:JSON.stringify(payload)});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.error||'No se pudo actualizar la posición.');
      if(data.position){
        const idx=state.positions.findIndex(p=>String(p.id)===String(data.position.id));
        if(idx>=0)state.positions[idx]=data.position;
      }
    }else{
      await addPosition(payload);
    }

    setStatus(editPositionId?"Posición actualizada":"Posición guardada");
    const returnView=form.dataset.returnView||'';
    const returnScroll=Math.max(0,Number(form.dataset.returnScroll)||0);
    closeModal();

    // If the position was created from Cartera, always return to that exact
    // context instead of allowing a stock-profile click/history side effect to win.
    if(returnView==='view-portfolios'){
      const portfolioView=document.getElementById('view-portfolios');
      const profileOpen=document.body.classList.contains('stock-detail-open');
      if(profileOpen||!portfolioView?.classList.contains('active')){
        window.ViewInvAINavigation?.show?.('portfolios');
        requestAnimationFrame(()=>window.scrollTo({top:returnScroll,behavior:'auto'}));
      }
    }
    toast(editPositionId?"Posición actualizada":"Compra registrada · análisis continuo activado");

    // Refresh server state after the modal has closed; saving no longer appears
    // frozen while portfolios/watchlist are reloaded.
    setTimeout(() => loadAll(), 0);
  } catch (error) {
    console.warn("Position save failed", error);
    const message = error && error.message ? error.message : "No se pudo guardar la posición.";
    setStatus(message, true);
    toast(message, true);
  } finally {
    delete form.dataset.saving;
    if (button && button.isConnected) {
      button.disabled = false;
      button.textContent = oldText || "Guardar posición";
    }
  }
}

function bind() {
  document.addEventListener("click", async event => {
    const goalHistory=event.target.closest?.("[data-goal-history]");
    if(goalHistory){
      event.preventDefault();event.stopPropagation();openGoalHistory(goalHistory.dataset.goalHistory);return;
    }

    const portfolioProfile=event.target.closest?.("[data-portfolio-stock-profile]");
    if(portfolioProfile){
      event.preventDefault();event.stopPropagation();
      const pref=portfolioProfile.dataset.profilePreferTr;
      openStockInline(portfolioProfile.dataset.portfolioStockProfile,pref==="1"?true:pref==="0"?false:null);
      return;
    }

    const registerGoalOperation=event.target.closest?.("[data-register-goal-operation]");
    if(registerGoalOperation){
      event.preventDefault();event.stopPropagation();openGoalOperationModal(registerGoalOperation);return;
    }
    const goalToggle=event.target.closest?.("[data-portfolio-goal-toggle]");
    if(goalToggle){
      const portfolioId=goalToggle.dataset.portfolioGoalToggle;
      if(portfolioId&&String(state.selectedPortfolioId)!==String(portfolioId))state.selectedPortfolioId=portfolioId;
      state.primaryTab=state.primaryTab==="goal"?"portfolio":"goal";
      savePortfolioUi();state.goalCandidateCache={at:0,key:"",rows:[]};renderActivePortfolioPanel();
      if(state.primaryTab==="goal"){
        refreshGoalSummaries().catch(()=>{});
        setTimeout(()=>refreshGoalAnalysis(false).catch(()=>{}),40);
      }
      return;
    }
    const cashEdit=event.target.closest?.("[data-portfolio-cash-edit]");
    if(cashEdit){openPortfolioCashModal(cashEdit.dataset.portfolioCashEdit);return}
    const marketConfig=event.target.closest?.("[data-portfolio-market-config]");
    if(marketConfig){openPortfolioMarketModal(marketConfig.dataset.portfolioMarketConfig);return}
    const goalRefresh=event.target.closest?.("[data-goal-refresh-plan]");
    if(goalRefresh){
      goalRefresh.disabled=true;const old=goalRefresh.textContent;goalRefresh.textContent="Analizando…";state.goalCandidateCache={at:0,key:"",rows:[]};
      try{
        const done=await refreshGoalAnalysis(true);
        toast(done?"Estrategia reanalizada · "+done+" posiciones":"No había posiciones que analizar");
      }catch(error){
        const message=/too many requests/i.test(String(error&&error.message||""))?"Demasiadas solicitudes. Espera un momento y vuelve a reanalizar.":(error.message||"No se pudo reanalizar la estrategia.");
        toast(message,true);
      }
      finally{if(goalRefresh.isConnected){goalRefresh.disabled=false;goalRefresh.textContent=old||"↻ Reanalizar cartera"}}return;
    }
    const login = event.target.closest?.(".portfolio-google-login");
    if (login) {
      window.ViewInvAIAuth?.signIn();
      return;
    }

    if (event.target.closest?.("#newPortfolioButton,[data-new-portfolio]")) {
      openNewPortfolioModal();
      return;
    }

    if (event.target.closest?.("[data-portfolio-order-edit]")) {
      openPortfolioOrderModal();
      return;
    }

    const moveOrder = event.target.closest?.("[data-portfolio-order-move]");
    if (moveOrder) {
      const row = moveOrder.closest("[data-portfolio-order-id]");
      const id = row && row.dataset.portfolioOrderId;
      const from = state.portfolios.findIndex(p => String(p.id) === String(id));
      const delta = Number(moveOrder.dataset.portfolioOrderMove) || 0;
      const to = from + delta;
      if (from >= 0 && to >= 0 && to < state.portfolios.length) {
        const [item] = state.portfolios.splice(from, 1);
        state.portfolios.splice(to, 0, item);
        refreshPortfolioOrderModal();
      }
      return;
    }

    if (event.target.closest?.("[data-portfolio-order-save]")) {
      savePortfolioOrder();
      return;
    }

    const selector = event.target.closest?.("[data-portfolio-select]");
    if (selector) {
      state.selectedPortfolioId = selector.dataset.portfolioSelect;
      state.goal=state.goals[String(state.selectedPortfolioId)]||null;
      state.primaryTab = "portfolio";
      savePortfolioUi();
      closePortfolioTabOverflow();
      renderApp();
      refreshPortfolioTransactionSummary(state.selectedPortfolioId).catch(() => {});
      return;
    }

    const moreTabs = event.target.closest?.("[data-portfolio-tabs-more]");
    if (moreTabs) {
      const menu = $("#portfolioTabsOverflow");
      const open = !!menu && !menu.classList.contains("open");
      if (menu) {
        menu.classList.toggle("open", open);
        menu.setAttribute("aria-hidden", open ? "false" : "true");
      }
      moreTabs.setAttribute("aria-expanded", open ? "true" : "false");
      return;
    }


    const positionOperation = event.target.closest?.("[data-position-operation]");
    if (positionOperation) {
      event.preventDefault();
      event.stopPropagation();
      const positionId=positionOperation.dataset.positionOperation;
      const side=String(positionOperation.dataset.operationSide||"BUY").toUpperCase();
      openTransactionsModal(positionId, side==="SELL"?"SELL":"BUY");
      return;
    }

    const editPosition = event.target.closest?.("[data-edit-portfolio-position]");
    if (editPosition) {
      event.preventDefault();
      event.stopPropagation();
      const position = transactionPosition(editPosition.dataset.editPortfolioPosition);
      if (position) {
        closeModal();
        setTimeout(() => openAddPositionModal(position.stock_key, Number(position.prefer_tr) === 1, position.portfolio_id, position.id), 20);
      }
      return;
    }

    const manageTransactions = event.target.closest?.("[data-manage-position-transactions]");
    if (manageTransactions) {
      event.preventDefault();
      event.stopPropagation();
      openTransactionsModal(manageTransactions.dataset.managePositionTransactions);
      return;
    }

    const removeExposure = event.target.closest?.("[data-remove-exposure-position]");
    if (removeExposure) {
      event.preventDefault();
      event.stopPropagation();
      confirmRemoveExposure(removeExposure.dataset.removeExposurePosition);
      return;
    }

    const cancelRemove = event.target.closest?.("[data-cancel-remove-exposure]");
    if (cancelRemove) {
      event.preventDefault();
      event.stopPropagation();
      closeModal();
      return;
    }

    const confirmRemove = event.target.closest?.("[data-confirm-remove-exposure]");
    if (confirmRemove) {
      event.preventDefault();
      event.stopPropagation();
      const position = transactionPosition(confirmRemove.dataset.confirmRemoveExposure);
      if (!position) return;
      try {
        await removePositionMembership(position);
        toast('Exposición eliminada de la cartera');
        closeModal();
      } catch (error) {
        toast(error.message || 'No se pudo eliminar la exposición.', true);
      }
      return;
    }

    const watchToggle=event.target.closest?.("[data-star-watch-toggle]");
    if(watchToggle){
      event.preventDefault();event.stopPropagation();
      const key=watchToggle.dataset.starWatchToggle,pref=watchToggle.dataset.starPreferTr,active=watchToggle.dataset.starWatchActive==="1";
      watchToggle.disabled=true;
      try{
        await syncFavorite(!active,key,pref==="1"?true:pref==="0"?false:null);
        toast(active?"Quitado de seguimiento":"Añadido a Solo seguimiento");
        closeModal();
      }catch(_){if(watchToggle.isConnected)watchToggle.disabled=false}
      return;
    }

    const starChoice = event.target.closest?.("[data-star-add-portfolio]");
    if (starChoice) {
      const pref = starChoice.dataset.starPreferTr;
      openAddToSpecificPortfolio(starChoice.dataset.starStock, starChoice.dataset.starAddPortfolio, pref === "1" ? true : pref === "0" ? false : null);
      return;
    }

    const starCreate = event.target.closest?.("[data-star-create-stock]");
    if (starCreate) {
      const key = starCreate.dataset.starCreateStock;
      const pref = starCreate.dataset.starPreferTr;
      closeModal();
      openNewPortfolioModal();
      const form = $("#newPortfolioForm");
      if (form) {
        form.dataset.pendingStockKey = key;
        form.dataset.pendingPreferTr = pref;
      }
      return;
    }

    if (event.target.closest?.(".portfolio-refresh")) {
      const stamp=()=>state.positions.map(x=>String(x.updated_at||x.id||'')).join('|');
      if(window.ViewInvAIRefreshFeedback)await window.ViewInvAIRefreshFeedback.run(()=>loadAll(),stamp);
      else await loadAll();
      return;
    }

    const add = event.target.closest?.("[data-add-portfolio-stock]");
    if (add) {
      event.preventDefault();
      event.stopPropagation();
      const pref = add.dataset.addPortfolioPreferTr;
      openStarMenu(add.dataset.addPortfolioStock, pref === "1" ? true : pref === "0" ? false : null);
      return;
    }

    if (event.target.closest?.(".portfolio-add-current")) {
      openPositionPicker();
      return;
    }

    const pick = event.target.closest?.("[data-position-pick]");
    if (pick) {
      const key = pick.dataset.positionPick;
      const preferTr = pick.dataset.positionPickMarket === "tr";
      closeModal();
      setTimeout(() => openAddPositionModal(key, preferTr), 20);
      return;
    }

    const datePicker = event.target.closest?.("[data-open-date-picker]");
    if (datePicker) {
      event.preventDefault();
      event.stopPropagation();
      const input = datePicker.closest(".portfolio-date-field")?.querySelector('input[type="date"]');
      if (input) {
        input.focus();
        try {
          if (typeof input.showPicker === "function") input.showPicker();
          else input.click();
        } catch (_) {
          input.click();
        }
      }
      return;
    }

    const savePosition = event.target.closest?.("[data-save-position]");
    if (savePosition) {
      event.preventDefault();
      event.stopPropagation();
      savePositionForm(savePosition.closest("form"));
      return;
    }

    const analyzeButton = event.target.closest?.("[data-analyze-type][data-analyze-id]");
    if (analyzeButton) {
      event.preventDefault();
      event.stopPropagation();
      analyze(analyzeButton.dataset.analyzeType, analyzeButton.dataset.analyzeId, analyzeButton);
      return;
    }

    const transactionsButton = event.target.closest?.("[data-position-transactions]");
    if (transactionsButton) {
      event.preventDefault();
      event.stopPropagation();
      openTransactionsModal(transactionsButton.dataset.positionTransactions);
      return;
    }

    const portfolioHistory = event.target.closest?.("[data-portfolio-history]");
    if (portfolioHistory) {
      event.preventDefault();
      event.stopPropagation();
      openPortfolioTransactionHistory(portfolioHistory.dataset.portfolioHistory);
      return;
    }

    const deleteTx = event.target.closest?.("[data-transaction-delete]");
    if (deleteTx) {
      event.preventDefault();
      event.stopPropagation();
      deleteTransaction(deleteTx.dataset.transactionDelete);
      return;
    }

    const row = event.target.closest?.("[data-open-stock]");
    const portfolioIsin=event.target.closest?.(".portfolio-position-list .list-copy-isin");
    if (row && (!event.target.closest("button") || portfolioIsin)) {
      const pref = row.dataset.positionPreferTr;
      const preferTr=pref === "1" ? true : pref === "0" ? false : null;
      if(row.closest(".portfolio-position-list")){
        if(portfolioIsin){event.preventDefault();event.stopPropagation()}
        openStarMenu(row.dataset.openStock,preferTr);
      }else{
        openStockInline(row.dataset.openStock,preferTr);
      }
      return;
    }
  });

  document.addEventListener("change", event => {
    const selector=event.target.closest?.("[data-goal-portfolio-select]");
    if(!selector)return;
    const id=selector.value;
    if(!id||!state.portfolios.some(item=>String(item.id)===String(id)))return;
    state.selectedPortfolioId=id;
    state.goal=state.goals[String(id)]||null;
    state.goalCandidateCache={at:0,key:"",rows:[]};
    savePortfolioUi();
    renderGoalApp();
    refreshPortfolioTransactionSummary(id,false).then(()=>{
      if(state.primaryTab==="goal"&&String(state.selectedPortfolioId)===String(id))renderGoalApp();
    }).catch(()=>{});
  });

  document.addEventListener("submit", async event => {
    if(event.target.id==="portfolioGoalForm"){
      event.preventDefault();const form=event.target,fd=new FormData(form),target=num(fd.get("targetValueEur")),portfolioId=form.dataset.portfolioId||state.selectedPortfolioId,status=form.querySelector("[data-goal-form-status]"),riskProfile=String(fd.get("riskProfile")||"aggressive");
      const setGoalStatus=(message,error=false)=>{if(status){status.textContent=message||"";status.classList.toggle("error",!!error)}};
      if(target===null||target<=0){setGoalStatus("Indica una cantidad mayor que 0 €.",true);toast("Indica un objetivo de rentabilidad mayor que 0 €.",true);return}
      const button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;setGoalStatus("Guardando…");
      try{
        await savePortfolioGoal(target,portfolioId,{riskProfile});setGoalStatus("Objetivo guardado");toast("Objetivo de la cartera actualizado");
        setTimeout(()=>refreshGoalAnalysis(false).catch(()=>{}),40);
      }catch(error){
        const message=error.message||"No se pudo guardar el objetivo.";state.goalError=message;setGoalStatus(message,true);toast(message,true);(state.primaryTab==="goal"?renderGoalApp:renderApp)();
      }finally{if(button&&button.isConnected)button.disabled=false}
      return;
    }
    if(event.target.id==="portfolioMarketForm"){
      event.preventDefault();
      try{await savePortfolioMarket(event.target)}catch(error){toast(error.message||"No se pudo guardar el mercado.",true)}
      return;
    }
    if(event.target.id==="portfolioCashBalanceForm"){
      event.preventDefault();
      try{await savePortfolioCash(event.target)}catch(error){toast(error.message||"No se pudo guardar el capital líquido.",true)}
      return;
    }
    if (event.target.id === "newPortfolioForm") {
      event.preventDefault();
      const form = event.target;
      const fd = new FormData(form);
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const created = await createPortfolio({
          name: String(fd.get("name") || ""),
          broker: String(fd.get("broker") || ""),
          marketScope: String(fd.get("marketScope") || "auto"),
          baseCurrency: String(fd.get("baseCurrency") || "EUR"),
          cashBalance: Math.max(0,num(fd.get("cashBalance"))||0)
        });
        const pendingKey = form.dataset.pendingStockKey;
        const pendingPref = form.dataset.pendingPreferTr;
        closeModal();
        toast("Cartera creada");
        if (pendingKey && created && created.id) {
          setTimeout(() => openAddPositionModal(pendingKey, pendingPref === "1" ? true : pendingPref === "0" ? false : null), 40);
        }
      } catch (error) {
        toast(error.message || "No se pudo crear la cartera.", true);
      } finally {
        if (button.isConnected) button.disabled = false;
      }
      return;
    }

    if (event.target.id === "addPositionForm") {
      event.preventDefault();
      await savePositionForm(event.target);
      return;
    }

    if (event.target.id === "transactionForm") {
      event.preventDefault();
      await saveTransactionForm(event.target);
      return;
    }
    if(event.target.id==="goalOperationForm"){
      event.preventDefault();
      await saveGoalOperationForm(event.target);
      return;
    }
  });

  document.addEventListener("click", event => {
    if (!event.target.closest?.(".portfolio-tabs-wrap")) closePortfolioTabOverflow();
  });
  window.addEventListener("resize", () => {
    clearTimeout(updatePortfolioTabOverflow.timer);
    updatePortfolioTabOverflow.timer = setTimeout(updatePortfolioTabOverflow, 80);
  }, { passive: true });

  $("#portfolioModalClose")?.addEventListener("click", closeModal);
  $("#portfolioModalBackdrop")?.addEventListener("click", closeModal);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") { closePortfolioTabOverflow(); closeModal(); return; }
    const row = event.target.closest?.("[data-open-stock]");
    if (row && !event.target.closest("button,a,input,select,textarea,summary") && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      const pref = row.dataset.positionPreferTr;
      const preferTr=pref === "1" ? true : pref === "0" ? false : null;
      if(row.closest(".portfolio-position-list")){
        openStarMenu(row.dataset.openStock,preferTr);
      }else{
        openStockInline(row.dataset.openStock,preferTr);
      }
    }
  });

  window.addEventListener("viewinvai:auth-changed", event => {
    state.user = event.detail && event.detail.user || null;
    if (!state.user) {
      state.portfolios = [];
      state.positions = [];
      state.watchlist = [];
      state.portfolioTransactionSummaries = {};
      state.selectedPortfolioId = null;
      state.goal = null;
      state.goals = {};
      state.goalError = "";
      state.goalCandidateCache = { at:0,key:"",rows:[] };
      Object.values(state.goalReviewTimers).forEach(timer=>clearTimeout(timer));state.goalReviewTimers={};
      renderActivePortfolioPanel();
    } else {
      loadAll();
    }
  });

  window.addEventListener("viewinvai:account-ready", event => {
    const detail = event.detail || {};
    state.user = detail.user || window.ViewInvAIAuth?.getUser() || state.user;
    if (state.user) loadAll();
  });

  window.addEventListener("viewinvai:favorite-changed", event => {
    // Account favorites are authoritative from positions + backend watchlist.
    // Re-sync instead of allowing a local-only star to drift from the account state.
    if(state.user)syncPortfolioStars();
  });

  window.addEventListener("viewinvai:quote-updated", event => {
    if (!event.detail || !state.positions.some(p => sameStockRef(p.stock_key, event.detail.key))) return;
    state.goalCandidateCache={at:0,key:"",rows:[]};
    clearTimeout(renderApp.quoteTimer);
    renderApp.quoteTimer = setTimeout(renderActivePortfolioPanel, 180);
  });
  window.addEventListener("viewinvai:fx-updated", () => {
    state.goalCandidateCache={at:0,key:"",rows:[]};
    clearTimeout(renderApp.quoteTimer);
    renderApp.quoteTimer = setTimeout(renderActivePortfolioPanel, 180);
  });
}

function init() {
  bind();
  state.user = window.ViewInvAIAuth?.getUser() || null;
  renderApp();
  if (state.user) loadAll();
}

function openPositionEditorForStock(stockKey,portfolioId=null){
  const memberships=activePortfolioMemberships(stockKey);
  if(!memberships.length)return false;
  let target=null;
  if(portfolioId)target=memberships.find(x=>String(x.position.portfolio_id)===String(portfolioId))||null;
  if(!target&&state.selectedPortfolioId)target=memberships.find(x=>String(x.position.portfolio_id)===String(state.selectedPortfolioId))||null;
  if(!target&&memberships.length===1)target=memberships[0];
  if(!target){openStarMenu(stockKey);return true}
  closeModal();
  setTimeout(()=>openAddPositionModal(target.position.stock_key,Number(target.position.prefer_tr)===1,target.position.portfolio_id,target.position.id),20);
  return true;
}

window.ViewInvAIPortfolios = {
  render: renderApp,
  renderGoal: renderGoalApp,
  reload: () => loadAll(),
  openNewPortfolio: openNewPortfolioModal,
  openAddPosition: openAddPositionModal,
  openPositionPicker,
  openStarMenu,
  toggleFavoriteOnly: async (stockKey,preferTr=null) => {
    const existing=state.watchlist.find(x=>sameStockRef(x.stock_key,stockKey));
    const result=await syncFavorite(!existing,stockKey,preferTr);
    if(typeof renderFavoritesDashboard==='function')renderFavoritesDashboard();
    return result;
  },
  getWatchlist: () => state.watchlist.slice(),
  openPositionEditorForStock,
  isInPortfolio,
  getPortfolioMemberships: stockKey => activePortfolioMemberships(stockKey).map(x => ({
    positionId: x.position.id,
    portfolioId: x.position.portfolio_id,
    portfolioName: x.portfolio?.name || ''
  })),
  removeStockFromPortfolio,
  setGoalVisible: visible => {
    if(visible)activateGoalPanel({reanalyze:false});
    else{
      state.primaryTab="portfolio";
      savePortfolioUi();
      renderApp();
    }
  },
  openGoal: portfolioId => {
    if(portfolioId&&state.portfolios.some(p=>String(p.id)===String(portfolioId)))state.selectedPortfolioId=portfolioId;
    state.goalCandidateCache={at:0,key:"",rows:[]};
    activateGoalPanel({reanalyze:false});
    return true;
  },
  getState: () => state
};

init();
