const state = {
  user: null,
  portfolios: [],
  positions: [],
  watchlist: [],
  brokers: [],
  portfolioTransactionSummaries: {},
  portfolioTxIssues: {},
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
  // Shared with backend.js goalServerRiskBand: the user picks the risk level and these limits follow.
  // maxSpreadPct caps the bid/ask spread of a buy; maxRoundTripFeePct caps buy+sell fees vs. the ticket.
  const bands={
    conservative:{label:"Bajo",maxPosition:8,riskPerTradePct:.5,maxSpreadPct:2,maxRoundTripFeePct:.5,minCandidate:84,minQuality:75,minVelocity:80,minComposite:85,minTiming:78,minRR:2.2,maxExtensionPct:4,maxDayChangePct:6,maxWeekPerfPct:10,maxStopPct:5},
    balanced:{label:"Moderado",maxPosition:15,riskPerTradePct:1,maxSpreadPct:3,maxRoundTripFeePct:1,minCandidate:82,minQuality:70,minVelocity:78,minComposite:83,minTiming:72,minRR:2,maxExtensionPct:5.5,maxDayChangePct:8,maxWeekPerfPct:15,maxStopPct:6},
    aggressive:{label:"Alto",maxPosition:25,riskPerTradePct:2,maxSpreadPct:5,maxRoundTripFeePct:1.5,minCandidate:80,minQuality:66,minVelocity:76,minComposite:82,minTiming:68,minRR:1.8,maxExtensionPct:7,maxDayChangePct:10,maxWeekPerfPct:20,maxStopPct:7}
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
    {name:"Trade Republic",canonical_name:"Trade Republic",code:"TR",verification_status:"verified",plan:"Standard",fee_rules_json:JSON.stringify({type:"flat",buy:1,sell:1,currency:"EUR",market:"TR"})},
    {name:"IBKR",canonical_name:"Interactive Brokers",code:"IBKR",verification_status:"verified",plan:"Pro Fixed",fee_rules_json:JSON.stringify({type:"per_share",perShare:.005,min:1,maxPct:1,sellValueRate:.0000206,sellPerShareExtra:.000198,currency:"USD",market:"US"})}
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
  const base=String(row.name||row.canonical_name||"").trim(),plan=String(row.plan||"").trim();
  const status=String(row.verification_status||"").toLowerCase();
  return base+(plan&&plan.toLowerCase()!=="standard"?" · "+plan:"")+(status==="pending"?" · verificando…":"");
}
function brokerRecordByName(name){
  const key=String(name||"").trim().toLowerCase();
  return brokerRecords().find(row=>[row.name,row.canonical_name,row.code].some(v=>String(v||"").trim().toLowerCase()===key))||null;
}
function brokerFeeEstimate(brokerName,quantity,price,currency,side="BUY",exchange=""){
  const row=brokerRecordByName(brokerName),qty=Math.max(0,num(quantity)||0),px=Math.max(0,num(price)||0),tradeValue=qty*px;
  if(!row)return{fee:null,currency:String(currency||"EUR").toUpperCase(),verified:false,label:"Pendiente de verificar"};
  let rules={};try{rules=JSON.parse(row.fee_rules_json||"{}")||{}}catch(_){}
  const feeCurrency=String(rules.currency||currency||"EUR").toUpperCase(),type=String(rules.type||"").toLowerCase();
  const venue=String(exchange||"").trim().toUpperCase(),ruleMarket=String(rules.market||"").trim().toUpperCase(),usVenue=["NASDAQ","NYSE","AMEX","NYSE ARCA","NYSEARCA"].includes(venue);
  const label=row.plan||row.canonical_name||row.name||brokerName;
  if(ruleMarket==="TR"&&venue&&venue!=="LSX")return{fee:null,currency:feeCurrency,verified:false,label,reason:"market-mismatch"};
  if(ruleMarket==="US"&&venue&&!usVenue)return{fee:null,currency:feeCurrency,verified:false,label,reason:"market-mismatch"};
  let fee=null;
  if(type==="flat"){
    const value=num(String(side).toUpperCase()==="SELL"?rules.sell:rules.buy);
    fee=value!==null?value:null;
  }else if(type==="per_share"){
    const per=num(rules.perShare),minimum=num(rules.min)||0,maxPct=num(rules.maxPct);
    if(per!==null){
      fee=Math.max(minimum,qty*per);
      if(maxPct!==null&&tradeValue>0)fee=Math.min(fee,tradeValue*maxPct/100);
      if(String(side).toUpperCase()==="SELL")fee+=tradeValue*Math.max(0,num(rules.sellValueRate)||0)+qty*Math.max(0,num(rules.sellPerShareExtra)||0);
    }
  }
  return{fee,currency:feeCurrency,verified:String(row.verification_status||"verified")==="verified"&&fee!==null,label};
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
function brokerFeeInCurrency(brokerName,quantity,price,transactionCurrency,side="BUY",exchange=""){
  const fee=brokerFeeEstimate(brokerName,quantity,price,transactionCurrency,side,exchange);
  if(fee.fee===null)return fee;
  const target=String(transactionCurrency||fee.currency||"EUR").toUpperCase();
  const converted=portfolioConvertAmount(fee.fee,fee.currency,target);
  return Object.assign({},fee,{sourceFee:fee.fee,sourceCurrency:fee.currency,fee:converted,currency:target,verified:fee.verified&&converted!==null});
}
// Cotización de EE. UU. como referencia de una línea de LSX: si la empresa cotiza en un mercado de EE. UU.,
// durante su sesión regular el precio se forma allí y LSX lo replica con algo de retraso (y con el cambio €/$).
// Solo sirve para decidir; la orden se ejecuta y se registra con el precio de LSX.
function goalUsReference(stock,fxUsdEur){
  if(!stock||typeof currentUsQuote!=="function")return null;
  if(!/^(NASDAQ|NYSE|AMEX|NYSEARCA|ARCA|BATS|CBOE|NYSEAMERICAN)/i.test(String(stock.exchange||"")))return null;
  let q=null;try{q=currentUsQuote(stock)}catch(_){q=null}
  if(!q||!(num(q.price)>0)||q.kind!=="regular")return null;
  const at=num(q.at),ageMs=at?Math.max(0,Date.now()-at):null,fx=num(fxUsdEur);
  return{usd:num(q.price),eur:fx!==null?num(q.price)*fx:null,change:num(q.change),ageMs,recent:ageMs!==null&&ageMs<=900000,live:ageMs!==null&&ageMs<=120000};
}
function goalExecutionQuote(stock,preferTr,side,fxUsdEur,brokerName="",quantity=1){
  const market=currentMarket(stock,preferTr),currency=String(market.currency||(preferTr?"EUR":"USD")).toUpperCase();
  const bid=num(market.bid),ask=num(market.ask),last=num(market.price),spread=num(market.spreadPct),now=Date.now();
  const rawUpdated=market.updatedAt||(preferTr?(stock&&stock.trLiveUpdatedAt||stock&&stock.trLiveReceivedAt):(stock&&stock.usLiveTimestamp||stock&&stock.usLiveReceivedAt));
  const updatedAt=rawUpdated?new Date(rawUpdated).getTime():null;
  const ageMs=Number.isFinite(updatedAt)?Math.max(0,now-updatedAt):null;
  const direct=preferTr
    ?num(stock&&stock.trLivePrice)!==null
    :num(stock&&stock.usLivePrice)!==null&&!market.fallback;
  const quoteFresh=direct&&ageMs!==null&&ageMs<=120000;
  // Para decidir el plan basta una cotización en vivo de los últimos 15 min: las de Trade Republic se refrescan
  // cada pocos minutos y con el límite de 2 min una misma compra aparecía y desaparecía del plan sin motivo.
  // Para registrar la orden se sigue exigiendo la cotización reciente (quoteFresh).
  const usRef=preferTr?goalUsReference(stock,fxUsdEur):null;
  // En LSX, una acción de EE. UU. con cotización regular reciente allí también cuenta como «en vivo» para decidir.
  // Una línea de LSX sin operaciones sigue cotizando (horquilla del creador de mercado): basta con que el socket la
  // tenga suscrita y haya enviado su dato en esta conexión, aunque el último cruce tenga más de 15 minutos.
  const trSocketFresh=!!(preferTr&&window.ViewInvAI&&typeof window.ViewInvAI.trLiveFresh==="function"&&window.ViewInvAI.trLiveFresh(portfolioStockKey(stock)));
  const quoteRecent=direct&&((ageMs!==null&&ageMs<=900000)||!!(usRef&&usRef.recent)||trSocketFresh);
  const actionSide=String(side||"BUY").toUpperCase();
  const bookUsable=actionSide==="SELL"?bid!==null:(bid!==null&&ask!==null&&ask>=bid);
  let price=null,orderType="LIMITE",instruction="",immediate=false;
  if(actionSide==="SELL"){
    price=bid;
    instruction=bid!==null?"Venta límite en BID":"Esperar · BID no disponible";
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
    instruction="Esperar · BID/ASK incompleto";
  }
  if(price!==null){
    const decimals=Math.abs(price)<1?4:Math.abs(price)<10?3:2;
    price=Number(price.toFixed(decimals));
  }
  const unitEur=portfolioPriceToEur(price,currency,fxUsdEur);
  const broker=String(brokerName||"").trim();
  const feeInfo=brokerFeeInCurrency(broker,Math.max(1,Math.round(num(quantity)||1)),price,currency,side,preferTr?(stock.trExchange||"LSX"):(stock.exchange||""));
  const feeNative=feeInfo.fee;
  const feeEur=feeNative===null?0:(portfolioConvertAmount(feeNative,currency,"EUR",fxUsdEur)??0);
  const executable=quoteFresh&&bookUsable&&unitEur!==null&&feeInfo.verified===true;
  const executionReason=!quoteFresh?"Cotización ejecutable no disponible o desactualizada":!bookUsable?"BID/ASK ejecutable incompleto":feeInfo.verified!==true?"Comisión del broker no verificada":"Cotización ejecutable verificada";
  return{market,currency,bid,ask,spreadPct:spread,price,unitEur,feeEur,feeNative,feeVerified:feeInfo.verified,broker,orderType,instruction,immediate,updatedAt,ageMs,quoteFresh,quoteRecent,usRef,bookUsable,executable,executionReason};
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
    return window.ViewInvAI.openStockByKey(canonicalStockKey(key), "Cartera · posición activa", preferTr, "portfolios");
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
    // Posiciones de LSX: solo precio de LSX (en vivo o el último guardado), nunca el de EE. UU. convertido.
    if (!preferTr && (!quote || num(quote.price) === null) && typeof window.ViewInvAI.getDisplayQuote === "function") {
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
    return { price: eur, change: num(stock.trLiveChangePct), currency: "EUR", eur, usd: null, bid, ask, spreadPct:spread, source: "LS Exchange (vía Trade Republic)", updatedAt: stock.trLiveUpdatedAt || stock.trLiveReceivedAt || null, live: eur!==null, fallback:false };
  }
  const usd = num(stock.usLivePrice);
  return { price: usd, change: num(stock.usLiveChangePct), currency: "USD", eur: null, usd, bid, ask, spreadPct:spread, source: stock.usLiveSource || "Nasdaq", updatedAt: stock.usLiveTimestamp || stock.usLiveReceivedAt || null, live: usd!==null, fallback:false };
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

// Totales de una cartera en su divisa base: lo que enseña su resumen y lo que suma «Mi día».
function portfolioTotals(portfolio, positions) {
  const baseCurrency = String(portfolio.base_currency || "EUR").toUpperCase();
  const cashBalance = Math.max(0,num(portfolio.cash_balance)||0);
  let positionsValue = 0, invested = 0, day = 0, currentComplete = true, costComplete = true, analyzed = 0, pricingSessions = new Set();
  const fxUsdEur=portfolioUsdToEurRate();
  for (const p of positions) {
    const stock = stockByKey(p.stock_key);
    const qty = num(p.quantity);
    if (p.last_signal) analyzed++;
    if (!stock && qty !== null && positionIsin(p)) {
      // Fuera del catálogo: cotización por ISIN de Trade Republic (en EUR).
      const F = window.ViewInvAIFunds, q = F && typeof F.getLiveQuote === "function" ? F.getLiveQuote(positionIsin(p)) : null;
      const entryCurrency = String(p.currency || "EUR").toUpperCase(), unit = q && entryCurrency === "EUR" ? num(q.price) : null;
      const unitBase = unit === null ? null : portfolioConvertAmount(unit, "EUR", baseCurrency, fxUsdEur);
      if (unitBase === null) currentComplete = false;
      else {
        positionsValue += qty * unitBase;
        const prev = num(q.prev), prevBase = prev === null || prev <= 0 ? null : portfolioConvertAmount(prev, "EUR", baseCurrency, fxUsdEur);
        if (prevBase !== null) day += qty * (unitBase - prevBase);
      }
      const avg = num(p.avg_price), rawCost = num(p.cost_basis) ?? (avg !== null ? qty * avg : null);
      const costBase = portfolioConvertAmount(rawCost, entryCurrency, baseCurrency, fxUsdEur);
      if (costBase === null) costComplete = false; else invested += costBase;
      continue;
    }
    if (!stock || qty === null) { currentComplete = false; costComplete = false; continue; }
    const preferTr = Number(p.prefer_tr) === 1;
    const market = currentMarket(stock, preferTr);
    const currentUnit = marketValueInCurrency(market, baseCurrency);
    if (market && market.session) pricingSessions.add(String(market.session));
    if (currentUnit === null) currentComplete = false;
    else {
      const v = qty * currentUnit;
      positionsValue += v;
      if (market.change !== null && market.change > -100) day += v - v / (1 + market.change / 100);
    }

    const entryCurrency = String(p.currency || (preferTr ? "EUR" : "USD")).toUpperCase();
    const avg = num(p.avg_price);
    const rawCost=num(p.cost_basis)??(qty!==null&&avg!==null?qty*avg:null);
    const costBase=portfolioConvertAmount(rawCost,entryCurrency,baseCurrency,fxUsdEur);
    if (costBase === null) costComplete = false;
    else invested += costBase;
  }
  return {
    baseCurrency, cashBalance, positionsValue, invested, day, analyzed, pricingSessions, fxUsdEur,
    complete: currentComplete,
    // Valor de la cartera de valores: solo posiciones. El efectivo es aparte (como en el bróker).
    totalValue: currentComplete ? positionsValue : null,
    openPnl: currentComplete && costComplete ? positionsValue - invested : null
  };
}

function portfolioSummaryHtml(portfolio, positions) {
  if (!portfolio) return "";
  const txSummary = state.portfolioTransactionSummaries[String(portfolio.id)] || null;
  const T = portfolioTotals(portfolio, positions);
  const { baseCurrency, cashBalance, invested, pricingSessions, fxUsdEur, totalValue, openPnl } = T;
  if (!positions.length && !txSummary && cashBalance<=0) return "";
  const openPnlPct = openPnl !== null && invested > 0 ? openPnl / invested * 100 : null;
  let realizedPnl=null;
  if(txSummary&&txSummary.currencies){
    let convertedTotal=0,complete=true,seen=false;
    for(const [code,row] of Object.entries(txSummary.currencies)){
      const value=num(row&&row.realizedPnl);
      if(value===null)continue;
      seen=true;
      const converted=portfolioConvertAmount(value,code,baseCurrency,fxUsdEur);
      if(converted===null){complete=false;break}
      convertedTotal+=converted;
    }
    if(seen&&complete)realizedPnl=convertedTotal;
  }
  // Una pérdida realizada mayor que la mitad de lo vendido casi siempre es un dato mal importado.
  let sellGross=0;
  if(txSummary&&txSummary.currencies)for(const [code,row] of Object.entries(txSummary.currencies)){const v=portfolioConvertAmount(num(row&&row.sellGross)||0,code,baseCurrency,fxUsdEur);if(v!==null)sellGross+=v}
  const realizedSuspect=realizedPnl!==null&&realizedPnl<0&&sellGross>0&&-realizedPnl>sellGross*0.5;
  const totalPnl = openPnl !== null && realizedPnl !== null ? openPnl + realizedPnl : null;
  const pnlHtml = (label, value, suffix = "") => value === null ? "" :
    '<div><small>' + label + '</small><strong class="' + (value >= 0 ? 'pnl-up' : 'pnl-down') + '">' +
      (value > 0 ? '+' : '') + formatMoney(value, baseCurrency) + suffix + '</strong></div>';

  const pricingSessionLabel = pricingSessions.has('premarket') ? ' · preapertura' : pricingSessions.has('postmarket') ? ' · posmercado' : '';
  return '<div class="portfolio-summary-bar" title="Valorado con la cotización actual disponible'+pricingSessionLabel+'">' +
    '<div><small>CARTERA</small><strong>' + esc(portfolio.name) + '</strong></div>' +
    '<div><small>VALOR</small><strong>' + (totalValue!==null ? formatMoney(totalValue, baseCurrency) : '—') + '</strong></div>' +
    pnlHtml('ABIERTO', openPnl, openPnlPct === null ? '' : ' · ' + (openPnlPct >= 0 ? '+' : '') + formatNumber(openPnlPct, 2) + '%') +
    pnlHtml('REALIZADO', realizedPnl, realizedSuspect ? ' <button type="button" class="realized-check" data-portfolio-history="'+esc(portfolio.id)+'" title="La pérdida realizada parece imposible: abre el historial con las operaciones a revisar">⚠ revisar</button>' : '') +
    pnlHtml('TOTAL', totalPnl) +
  '</div>';
}

// Cuenta del bróker: la cartera de acciones y las de Fondos de la misma plataforma forman una
// cuenta (diseño D de Carteras).
function portfolioAccountKey(text){
  const t=String(text||"").toLowerCase();
  if(/trade\s*republic|\btr\b/.test(t))return"tr";
  if(/interactive|ibkr/.test(t))return"ibkr";
  if(/my\s*investor/.test(t))return"myinvestor";
  if(/bit2me|binance|kraken|coinbase/.test(t))return t.match(/bit2me|binance|kraken|coinbase/)[0];
  return"";
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
    '<b>'+formatMoney(cash,currency)+'</b><em>✎ Editar</em></button>';
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
    actionsHtml: '<button type="button" class="portfolio-transactions-open" data-position-transactions="' + esc(p.id) + '">⇄ Operaciones</button>' +
      '<button type="button" class="portfolio-analyze" data-edit-portfolio-position="' + esc(p.id) + '">Editar posición</button>'
  });
}

// Acciones fuera del catálogo (p. ej. europeas importadas de Trade Republic): se guardan con su
// ISIN y se cotizan directamente en LSX por ISIN, con la misma tarjeta que el resto.
function positionIsin(p) {
  const isin = String(p.isin || p.stock_key || "").toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin) ? isin : "";
}
function renderIsinPosition(p, isin) {
  const F = window.ViewInvAIFunds;
  if (F && typeof F.subscribeIsin === "function") F.subscribeIsin(isin);
  const q = F && typeof F.getLiveQuote === "function" ? F.getLiveQuote(isin) : null;
  const currency = String(p.currency || "EUR").toUpperCase();
  const price = q && currency === "EUR" ? num(q.price) : null, prev = q ? num(q.prev) : null;
  const qty = num(p.quantity), avg = num(p.avg_price);
  const value = qty !== null && price !== null ? qty * price : null;
  const estimatedFee = brokerFeeInCurrency(p.broker, qty, avg, currency, "BUY", p.exchange || "");
  const invested = num(p.cost_basis) ?? (qty !== null && avg !== null ? qty * avg + (estimatedFee.fee ?? 0) : null);
  const fees = num(p.fees_total) ?? (estimatedFee.fee ?? 0);
  const pnl = value !== null && invested !== null ? value - invested : null;
  const pnlPct = pnl !== null && invested > 0 ? pnl / invested * 100 : null;
  const fromBuy = price !== null && avg ? (price / avg - 1) * 100 : null;
  const tone = pnl === null ? "muted" : pnl >= 0 ? "positive" : "negative";
  const change = price !== null && prev ? price - prev : null, changePct = change !== null && prev ? change / prev * 100 : null;
  const quoteHtml = price === null
    ? '<span class="portfolio-isin-quote muted">Cotización de Trade Republic…</span>'
    : '<span class="portfolio-isin-quote"><b>' + esc(formatMoney(price, currency)) + '</b>' + (change !== null ? ' <em class="' + (change >= 0 ? "positive" : "negative") + '">' + esc((change > 0 ? "+" : "") + formatMoney(change, currency) + " (" + (changePct > 0 ? "+" : "") + formatNumber(changePct, 2) + "%)") + '</em>' : "") + '</span>';
  const exposureHtml = '<div class="portfolio-position-exposure">' +
    '<span><small>Valor</small><b>' + esc(formatMoney(value, currency)) + '</b></span>' +
    '<span class="' + tone + '"><small>P&L neto</small><b>' + (pnl === null ? "—" : esc((pnl > 0 ? "+" : "") + formatMoney(pnl, currency))) + (pnlPct === null ? "" : '<em> ' + esc((pnlPct > 0 ? "+" : "") + formatNumber(pnlPct, 2) + "%") + '</em>') + '</b></span>' +
    '<span><small>Precio medio</small><b>' + esc(formatMoney(avg, currency)) + '</b></span>' +
  '</div>';
  const brokerLabel = String(p.broker || "").trim();
  const metaHtml = '<div class="portfolio-position-strip">' +
    '<span><b>' + esc(formatNumber(qty, 4)) + '</b> uds.</span>' +
    (brokerLabel ? '<span>Broker <b>' + esc(brokerLabel) + '</b></span>' : "") +
    '<span>Coste <b>' + esc(formatMoney(invested, currency)) + '</b></span>' +
    '<span>Comisiones <b>' + esc(formatMoney(fees, currency)) + '</b></span>' +
    '<span class="' + (fromBuy === null ? "muted" : fromBuy >= 0 ? "positive" : "negative") + '" title="Precio actual frente a tu precio medio, sin comisiones">Precio vs. media <b>' + (fromBuy === null ? "—" : esc((fromBuy > 0 ? "+" : "") + formatNumber(fromBuy, 2) + "%")) + '</b></span>' +
  '</div>' + positionDecisionChip(p, avg, currency);
  return window.ViewInvAICards.render({
    context: "portfolio", className: "portfolio-position-card portfolio-isin-position", title: p.name || isin, isin,
    subtitle: (p.ticker && p.ticker !== isin ? p.ticker + " · " : "") + "LSX · fuera del catálogo",
    leadingHtml: "",
    cells: [{ label: "Cotización", html: quoteHtml }, { label: "Posición", html: exposureHtml, tone }],
    metaHtml,
    rowActionsHtml: '<button type="button" class="portfolio-register-operation-icon" data-position-transactions="' + esc(p.id) + '" aria-label="Registrar operación" title="Registrar operación"><span aria-hidden="true">💼</span></button>',
    detailsHtml: ""
  });
}

// portfolio-position-more: el detalle progresivo se abre ahora en la ficha completa de la acción.
function renderPositionRow(p, index = 0) {
  const stock = stockByKey(p.stock_key);
  if (!stock) { const isin = positionIsin(p); return isin ? renderIsinPosition(p, isin) : renderUnavailablePosition(p); }
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

  const estimatedFee=brokerFeeInCurrency(p.broker,qty,avg,entryCurrency,'BUY',p.exchange||'');
  const investedValue=num(p.cost_basis)??(qty!==null&&avg!==null?qty*avg+(estimatedFee.fee??0):null);
  const feesTotal=num(p.fees_total)??(estimatedFee.fee??0);
  const pnlAfterFees=currentValue!==null&&investedValue!==null?currentValue-investedValue:null;
  const pnlAfterFeesPct=investedValue!==null&&investedValue>0&&pnlAfterFees!==null?pnlAfterFees/investedValue*100:null;
  const brokerLabel=String(p.broker||'').trim();
  const exposureTone=pnlPct===null?'muted':pnlPct>=0?'positive':'negative';
  const pnlNetTone=pnlAfterFees===null?'muted':pnlAfterFees>=0?'positive':'negative';
  // Lo que más importa primero: valor actual y P&L neto (tras comisiones) en la misma línea.
  const exposureHtml='<div class="portfolio-position-exposure">'+
    '<span><small>Valor</small><b>'+esc(formatMoney(currentValue,entryCurrency))+'</b></span>'+
    '<span class="'+pnlNetTone+'"><small>P&L neto</small><b>'+(pnlAfterFees===null?'—':esc((pnlAfterFees>0?'+':'')+formatMoney(pnlAfterFees,entryCurrency)))+(pnlAfterFeesPct===null?'':'<em> '+esc((pnlAfterFeesPct>0?'+':'')+formatNumber(pnlAfterFeesPct,2)+'%')+'</em>')+'</b></span>'+
    '<span><small>Precio medio</small><b>'+esc(formatMoney(avg,entryCurrency))+'</b></span>'+
  '</div>';
  const metaHtml='<div class="portfolio-position-strip">'+
    '<span><b>'+esc(formatNumber(qty,4))+'</b> uds.</span>'+
    (brokerLabel?'<span>Broker <b>'+esc(brokerLabel)+'</b></span>':'')+
    '<span>Coste <b>'+esc(formatMoney(investedValue,entryCurrency))+'</b></span>'+
    '<span>Comisiones <b>'+esc(formatMoney(feesTotal,entryCurrency))+'</b></span>'+
    '<span class="'+exposureTone+'" title="Precio actual frente a tu precio medio, sin comisiones">Precio vs. media <b>'+(pnlPct===null?'—':esc((pnlPct>0?'+':'')+formatNumber(pnlPct,2)+'%'))+'</b></span>'+
  '</div>'+positionDecisionChip(p,avg,entryCurrency);
  return window.ViewInvAI.renderStandardStockCard(stock, {
    index, preferTr, context: "portfolio", hint: "Cartera · posición activa", rankLabel: "",
    className: "portfolio-position-card",
    leadingHtml: "",
    cells:[{label:'Posición',html:exposureHtml,tone:exposureTone}],
    openAttrs: ' data-open-stock="' + esc(p.stock_key) + '" data-position-prefer-tr="' + (preferTr ? '1' : '0') + '" role="button" tabindex="0"',
    openLabel: "Ficha", openIcon: true,
    openActionAttrs: ' data-portfolio-stock-profile="' + esc(p.stock_key) + '" data-profile-prefer-tr="' + (preferTr ? '1' : '0') + '" aria-label="Abrir ficha completa de ' + esc(stock.name||stock.ticker||p.stock_key) + '" title="Abrir ficha completa"',
    metaHtml,
    rowActionsHtml:'<button type="button" class="portfolio-register-operation-icon" data-position-transactions="'+esc(p.id)+'" aria-label="Registrar operación" title="Registrar operación"><span aria-hidden="true">💼</span></button>',
    detailsHtml: ""
  });

}

// Decisión tomada ante un aviso de venta («mantener», «decidir más tarde», «venderé»).
function positionDecisionChip(p, avg, currency, price = null) {
  const d = window.ViewInvAIDecisions && typeof window.ViewInvAIDecisions.forPosition === "function" ? window.ViewInvAIDecisions.forPosition(p.id) : null;
  if (!d) return "";
  const until = d.hold_until ? new Date(d.hold_until + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : "";
  const label = d.hold_mode === "pct" ? "Mantienes hasta +" + formatNumber(num(d.hold_pct) || 0, 1) + " %"
    : d.hold_mode === "catalyst" ? "Mantienes hasta el catalizador · " + until
    : d.hold_mode === "better" ? "Mantienes hasta un cambio mejor"
    : d.hold_mode === "date" ? "En pausa hasta el " + until
    : d.decision === "hold"
    // Mantener sin más condición = esperar a recuperar el precio medio (no es un precio objetivo de análisis).
    ? "Mantienes hasta recuperar tu precio medio " + formatMoney(avg, currency) + (num(price) > 0 && num(avg) > num(price) ? " · le falta +" + formatNumber((num(avg) / num(price) - 1) * 100, 1) + " %" : "")
    : d.decision === "later" ? "Decidir el " + new Date(d.review_at).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : "Vas a vender";
  return '<div class="position-decision-chip is-' + esc(d.decision) + '"><span>' + esc(label) + '</span>' +
    '<button type="button" data-decision-clear="' + esc(p.id) + '" aria-label="Quitar decisión" title="Quitar decisión">×</button></div>';
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

const POSITION_SORTS={value:'Valor',pnlPct:'P&L %',pnlAbs:'P&L €',name:'Nombre'};
function positionSortKey(){try{const k=localStorage.getItem('viewinvai:position-sort');return POSITION_SORTS[k]?k:'value'}catch(_){return'value'}}
// Comparable figures in EUR so positions in USD and EUR sort together.
function positionSortMetrics(p){
  const stock=stockByKey(p.stock_key);if(!stock)return{value:null,pnlAbs:null,pnlPct:null,name:String(p.name||p.stock_key||'')};
  const preferTr=Number(p.prefer_tr)===1,market=currentMarket(stock,preferTr),qty=num(p.quantity),avg=num(p.avg_price);
  const eur=marketValueInCurrency(market,'EUR'),entryCurrency=String(p.currency||(preferTr?'EUR':'USD')).toUpperCase(),inEntry=marketValueInCurrency(market,entryCurrency);
  const value=qty!==null&&eur!==null?qty*eur:null;
  const fee=brokerFeeInCurrency(p.broker,qty,avg,entryCurrency,'BUY',p.exchange||'');
  const invested=num(p.cost_basis)??(qty!==null&&avg!==null?qty*avg+(fee.fee??0):null);
  const current=qty!==null&&inEntry!==null?qty*inEntry:null;
  const pnlEntry=current!==null&&invested!==null?current-invested:null;
  const fx=inEntry&&eur?eur/inEntry:null;
  return{value,pnlAbs:pnlEntry!==null&&fx!==null?pnlEntry*fx:pnlEntry,pnlPct:pnlEntry!==null&&invested>0?pnlEntry/invested*100:null,name:String(stock.name||stock.ticker||'')};
}
function sortPositions(positions){
  const key=positionSortKey(),rows=positions.map(p=>({p,m:positionSortMetrics(p)}));
  if(key==='name')rows.sort((a,b)=>a.m.name.localeCompare(b.m.name,'es'));
  else rows.sort((a,b)=>(b.m[key]??-Infinity)-(a.m[key]??-Infinity));
  return rows.map(r=>r.p);
}
function positionSortBarHtml(count){
  if(count<2)return'';
  const key=positionSortKey();
  return '<div class="portfolio-sort-bar" role="group" aria-label="Ordenar posiciones"><span>Ordenar</span>'+
    Object.entries(POSITION_SORTS).map(([k,label])=>'<button type="button" class="tab'+(k===key?' active':'')+'" data-position-sort="'+k+'" aria-pressed="'+(k===key)+'">'+label+'</button>').join('')+
  '</div>';
}
document.addEventListener('click',event=>{
  const b=event.target.closest&&event.target.closest('[data-position-sort]');if(!b)return;
  try{localStorage.setItem('viewinvai:position-sort',b.dataset.positionSort)}catch(_){}
  if(state.primaryTab!=='goal')renderApp();
});
// ----- Riesgo y dividendos de la cartera (con los datos ya cargados, sin peticiones) -----
const SECTOR_ES={"Electronic Technology":"Tecnología electrónica","Technology Services":"Servicios tecnológicos","Health Technology":"Tecnología sanitaria","Health Services":"Servicios sanitarios","Finance":"Finanzas","Retail Trade":"Comercio minorista","Consumer Non-Durables":"Consumo básico","Consumer Durables":"Consumo duradero","Consumer Services":"Servicios al consumo","Producer Manufacturing":"Industria","Process Industries":"Industria de procesos","Industrial Services":"Servicios industriales","Energy Minerals":"Energía","Non-Energy Minerals":"Materias primas","Utilities":"Servicios públicos","Transportation":"Transporte","Communications":"Comunicaciones","Commercial Services":"Servicios comerciales","Distribution Services":"Distribución","Miscellaneous":"Otros","Government":"Sector público"};
const COUNTRY_ES={US:"EEUU",DE:"Alemania",NL:"Países Bajos",IE:"Irlanda",FR:"Francia",ES:"España",GB:"Reino Unido",CA:"Canadá",CH:"Suiza",JP:"Japón",CN:"China",KY:"Islas Caimán",LU:"Luxemburgo",IL:"Israel",TW:"Taiwán",DK:"Dinamarca",SE:"Suecia",IT:"Italia",BE:"Bélgica",AU:"Australia",BR:"Brasil",KR:"Corea del Sur",FI:"Finlandia",NO:"Noruega",BM:"Bermudas",JE:"Jersey",HK:"Hong Kong",IN:"India",SG:"Singapur",AT:"Austria",PT:"Portugal"};
window.ViewInvAISectorEs=v=>SECTOR_ES[v]||v||"Sin sector";
function portfolioInsightsData(portfolioId){
  const rows=portfolioPositionsDetail(portfolioId).filter(r=>r.valueEur!==null&&r.valueEur>0);
  const total=rows.reduce((a,r)=>a+r.valueEur,0);
  if(!(total>0))return null;
  const group=key=>{const m=new Map();rows.forEach(r=>{const k=key(r);m.set(k,(m.get(k)||0)+r.valueEur)});return[...m.entries()].map(([k,v])=>({k,v,pct:v/total*100})).sort((a,b)=>b.v-a.v)};
  const positions=group(r=>r.ticker||r.stockKey);
  const sectors=group(r=>window.ViewInvAISectorEs(r.sector));
  const countries=group(r=>COUNTRY_ES[r.country]||r.country||"—");
  let betaKnown=0,betaWeighted=0;
  rows.forEach(r=>{const b=r.beta!==null&&Number.isFinite(r.beta)?r.beta:1;if(r.beta!==null)betaKnown+=r.valueEur;betaWeighted+=b*r.valueEur});
  const beta=betaWeighted/total;
  const dividends=rows.reduce((a,r)=>a+(r.dividendYield>0?r.valueEur*r.dividendYield/100:0),0);
  return{total,positions,sectors,countries,beta,betaCoverage:betaKnown/total,dividends,count:rows.length};
}
function insightBars(list,limit=4){
  const top=list.slice(0,limit),rest=list.slice(limit).reduce((a,x)=>a+x.pct,0);
  return top.map(x=>'<div class="insight-bar"><span>'+esc(x.k)+'</span><i><b data-insight-w="'+Math.max(2,x.pct).toFixed(1)+'"></b></i><em>'+formatNumber(x.pct,0)+'%</em></div>').join('')+
    (rest>0.5?'<div class="insight-bar muted"><span>Resto</span><i><b data-insight-w="'+rest.toFixed(1)+'"></b></i><em>'+formatNumber(rest,0)+'%</em></div>':'');
}
function portfolioInsightsHtml(portfolio){
  const d=portfolio&&portfolioInsightsData(portfolio.id);
  if(!d||d.count<1)return'';
  const top=d.positions[0],topSector=d.sectors[0];
  const alerts=[];
  // Una sola posición es la máxima concentración (antes salía «Diversificada» con el 100 % en un valor).
  if(d.count===1)alerts.push('Una sola posición: '+esc(top.k)+' es el 100% de la cartera');
  else if(top.pct>=25)alerts.push(esc(top.k)+' pesa el '+formatNumber(top.pct,0)+'% de la cartera');
  if(d.count>2&&topSector.pct>=45)alerts.push(esc(topSector.k)+' concentra el '+formatNumber(topSector.pct,0)+'%');
  const shock=-0.10*d.beta*d.total;
  let open=false;try{open=localStorage.getItem('viewinvai:pf-insights-open')==='1'}catch(_){}
  return '<details class="portfolio-insights"'+(open?' open':'')+' data-pf-insights>'+
    '<summary><span class="insights-title">Riesgo y dividendos</span>'+
      '<span class="insights-chips"><b class="'+(alerts.length?'warn':'')+'">'+(alerts.length?'⚠ Concentración':'Diversificada')+'</b><b>β '+formatNumber(d.beta,2)+'</b><b>Div. ≈ '+formatMoney(d.dividends,'EUR')+'/año</b></span></summary>'+
    '<div class="insights-body">'+
      (alerts.length?'<p class="insights-alert">'+alerts.join(' · ')+'.</p>':'')+
      '<div class="insights-scenario"><small>ESCENARIO</small><strong>Si el Nasdaq cae un 10 %</strong><b class="negative">'+formatMoney(shock,'EUR')+'</b><span>β ponderada '+formatNumber(d.beta,2)+(d.betaCoverage<0.999?' · sin beta en '+formatNumber((1-d.betaCoverage)*100,0)+'% (se toma 1)':'')+'</span></div>'+
      '<div class="insights-scenario"><small>DIVIDENDOS ESTIMADOS</small><strong>≈ '+formatMoney(d.dividends,'EUR')+' al año</strong><b>'+formatNumber(d.dividends/d.total*100,2)+'%</b><span>Con la rentabilidad por dividendo actual; antes de retenciones.</span></div>'+
      '<div class="insights-group"><small>POR POSICIÓN</small>'+insightBars(d.positions)+'</div>'+
      '<div class="insights-group"><small>POR SECTOR</small>'+insightBars(d.sectors)+'</div>'+
      '<div class="insights-group"><small>POR PAÍS (ISIN)</small>'+insightBars(d.countries,3)+'</div>'+
    '</div></details>';
}
document.addEventListener('toggle',e=>{if(e.target&&e.target.matches&&e.target.matches('[data-pf-insights]')){try{localStorage.setItem('viewinvai:pf-insights-open',e.target.open?'1':'0')}catch(_){}}},true);
// ----- Rentabilidad: curva TWR en EUR frente a MSCI World y S&P 500 (servidor: /api/portfolio-performance) -----
const PERF_RANGES={'1m':'1M','3m':'3M','6m':'6M','ytd':'Año','1y':'1A','all':'Todo'};
const perfCache=new Map();
function perfRangeKey(){try{const k=localStorage.getItem('viewinvai:pf-perf-range');return PERF_RANGES[k]?k:'1y'}catch(_){return'1y'}}
function perfStartIndex(days,range){
  if(range==='all'||!days.length)return 0;
  const last=new Date(days[days.length-1]+'T12:00:00Z');
  let cutoff;
  if(range==='ytd')cutoff=(last.getUTCFullYear()-1)+'-12-31';
  else{const d=new Date(last);d.setUTCMonth(d.getUTCMonth()-({'1m':1,'3m':3,'6m':6,'1y':12}[range]||12));cutoff=d.toISOString().slice(0,10)}
  let i0=0;for(let i=0;i<days.length;i++){if(days[i]<=cutoff)i0=i;else break}
  return i0;
}
function perfMetrics(p,range){
  const n=p.days.length-1,i0=perfStartIndex(p.days,range);
  if(n<1||i0>=n)return null;
  const ratio=(arr)=>arr&&arr[i0]>0&&arr[n]>0?arr[n]/arr[i0]-1:null;
  const twr=ratio(p.twr),local=ratio(p.twrLocal);
  let peak=-Infinity,dd=0;
  for(let i=i0;i<=n;i++){const v=p.twr[i];if(v>peak)peak=v;if(peak>0)dd=Math.min(dd,v/peak-1)}
  let flows=0;for(let i=i0+1;i<=n;i++)flows+=p.flow[i]||0;
  const gain=p.value[n]-(i0===0?0:p.value[i0])-(i0===0?flows+(p.flow[0]||0):flows);
  const bench={};for(const k of Object.keys(p.benchmarks||{}))bench[k]=ratio(p.benchmarks[k]);
  return{i0,n,twr,local,fx:twr!==null&&local!==null?twr-local:null,dd,gain,bench,from:p.days[i0],partial:i0===0&&range!=='all'};
}
const perfPct=(v,d=1)=>v===null||v===undefined||!Number.isFinite(v)?'—':(v>0?'+':'')+formatNumber(v*100,d)+' %';
const perfPp=v=>v===null||!Number.isFinite(v)?'—':(v>0?'+':'')+formatNumber(v*100,1)+' pp';
const perfDay=d=>{const[y,m,dd]=String(d||'').split('-');return dd?dd+'/'+m+'/'+y:''};
function perfChartSvg(p,m){
  const keys=[['twr','perf-line-pf'],['msci','perf-line-msci'],['sp500','perf-line-sp']];
  const series=keys.map(([k,cls])=>{
    const arr=k==='twr'?p.twr:(p.benchmarks||{})[k];
    if(!arr||!(arr[m.i0]>0))return null;
    const pts=[];const step=Math.max(1,Math.ceil((m.n-m.i0+1)/220));
    for(let i=m.i0;i<=m.n;i+=step)if(arr[i]>0)pts.push([i,arr[i]/arr[m.i0]-1]);
    if(pts.length&&pts[pts.length-1][0]!==m.n&&arr[m.n]>0)pts.push([m.n,arr[m.n]/arr[m.i0]-1]);
    return{cls,pts};
  }).filter(Boolean);
  let lo=0,hi=0;series.forEach(s=>s.pts.forEach(([,y])=>{lo=Math.min(lo,y);hi=Math.max(hi,y)}));
  const pad=(hi-lo)*.08||.01;lo-=pad;hi+=pad;
  const W=320,H=120,x=i=>(i-m.i0)/Math.max(1,m.n-m.i0)*W,y=v=>H-(v-lo)/(hi-lo)*H;
  const path=pts=>pts.map(([i,v],j)=>(j?'L':'M')+x(i).toFixed(1)+' '+y(v).toFixed(1)).join('');
  return '<div class="perf-chart-wrap"><span class="perf-y top">'+perfPct(hi,0)+'</span><span class="perf-y bottom">'+perfPct(lo,0)+'</span><svg class="perf-chart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="Curva de rentabilidad frente a los índices">'+
    '<line class="perf-zero" x1="0" x2="'+W+'" y1="'+y(0).toFixed(1)+'" y2="'+y(0).toFixed(1)+'"/>'+
    series.slice().reverse().map(s=>'<path class="'+s.cls+'" d="'+path(s.pts)+'"/>').join('')+
  '</svg></div>'+
  '<div class="perf-axis"><span>'+esc(perfDay(p.days[m.i0]))+'</span><span>'+esc(perfDay(p.days[m.n]))+'</span></div>';
}
function perfStat(label,value,cls,note){
  return '<div class="perf-stat"><small>'+esc(label)+'</small><b class="'+(cls||'')+'">'+value+'</b>'+(note?'<span>'+esc(note)+'</span>':'')+'</div>';
}
const perfTone=v=>v===null||!Number.isFinite(v)?'':v>0?'positive':v<0?'negative':'';
function portfolioPerformanceHtml(portfolio){
  if(!portfolio)return'';
  const id=String(portfolio.id),entry=perfCache.get(id),range=perfRangeKey();
  let open=false;try{open=localStorage.getItem('viewinvai:pf-perf-open')==='1'}catch(_){}
  const shell=(chips,body)=>'<details class="portfolio-insights portfolio-perf" data-pf-perf="'+esc(id)+'"'+(open?' open':'')+'>'+
    '<summary><span class="insights-title">Rentabilidad</span><span class="insights-chips">'+chips+'</span></summary>'+
    '<div class="insights-body">'+body+'</div></details>';
  if(!entry||(!entry.data&&entry.loading))return shell('<b>Calculando…</b>','<p class="perf-note">Reconstruyendo la curva con tus operaciones y los cierres diarios…</p>');
  if(entry.data&&entry.data.computing){
    const d=entry.data,pct=d.total?Math.round(d.done/d.total*100):0;
    return shell('<b>Calculando… '+pct+'%</b>','<p class="perf-note">Descargando los cierres diarios de tus valores: '+esc(String(d.done))+' de '+esc(String(d.total))+'. La primera vez tarda un poco; después queda guardado.</p>');
  }
  if(!entry.data)return shell('<b class="warn">No disponible</b>','<p class="perf-note">'+(entry.error&&!/^Error de backend$/.test(entry.error)?esc(entry.error)+' ':'No se pudo calcular ahora mismo. ')+'<button type="button" class="perf-retry" data-pf-perf-retry="'+esc(id)+'">↻ Reintentar</button></p>');
  const p=entry.data;
  if(p.empty||!p.days||p.days.length<2)return'';
  const m=perfMetrics(p,range);
  if(!m)return'';
  const labels=p.benchmarkLabels||{msci:'MSCI World',sp500:'S&P 500'};
  const vsMsci=m.twr!==null&&m.bench.msci!=null?m.twr-m.bench.msci:null;
  const chips='<b class="'+perfTone(m.twr)+'">'+perfPct(m.twr)+' · '+esc(PERF_RANGES[range])+'</b>'+
    (vsMsci!==null?'<b class="'+perfTone(vsMsci)+'">vs MSCI '+perfPp(vsMsci)+'</b>':'')+
    '<b>Máx. caída '+perfPct(m.dd)+'</b>';
  const tabs='<div class="portfolio-sort-bar perf-ranges" role="group" aria-label="Periodo">'+
    Object.entries(PERF_RANGES).map(([k,l])=>'<button type="button" class="tab'+(k===range?' active':'')+'" data-pf-perf-range="'+k+'" aria-pressed="'+(k===range)+'">'+l+'</button>').join('')+'</div>';
  const legend='<div class="perf-legend"><span class="pf">Cartera</span><span class="msci">'+esc(labels.msci||'MSCI World')+'</span><span class="sp">'+esc(labels.sp500||'S&P 500')+'</span></div>';
  const coverage=[];
  if(p.missing&&p.missing.length)coverage.push('Sin histórico de precios para '+p.missing.join(', ')+': se valoran al precio de compra.');
  if(p.approx&&p.approx.length)coverage.push('Histórico incompleto para '+p.approx.join(', ')+'.');
  const body=tabs+(m.partial?'<p class="perf-note">Tu primera operación es del '+esc(perfDay(m.from))+': el periodo empieza ahí.</p>':'')+
    perfChartSvg(p,m)+legend+
    '<div class="perf-stats">'+
      perfStat('Rentabilidad',perfPct(m.twr),perfTone(m.twr),'Ponderada por tiempo')+
      perfStat('Ganancia',formatMoney(m.gain,'EUR'),perfTone(m.gain),'Valor final − inicial − aportaciones')+
      perfStat('Máx. caída',perfPct(m.dd),m.dd<0?'negative':'','Desde el máximo previo')+
      perfStat(labels.msci||'MSCI World',perfPct(m.bench.msci),perfTone(m.bench.msci),vsMsci!==null?'Tú '+perfPp(vsMsci):'')+
      perfStat(labels.sp500||'S&P 500',perfPct(m.bench.sp500),perfTone(m.bench.sp500),m.twr!==null&&m.bench.sp500!=null?'Tú '+perfPp(m.twr-m.bench.sp500):'')+
      perfStat('Divisa',perfPp(m.fx),perfTone(m.fx),'Efecto del EUR/USD en tus valores en dólares')+
    '</div>'+
    (coverage.length?'<p class="insights-alert">'+esc(coverage.join(' '))+'</p>':'')+
    '<p class="perf-note">Rentabilidad ponderada por tiempo en EUR: tus compras y ventas no la distorsionan, así que se puede comparar con los índices. Índices: ETF de acumulación en EUR (con dividendos). No incluye el efectivo ni los dividendos cobrados.</p>';
  return shell(chips,body);
}
function refreshPerfCard(id){
  const el=document.querySelector('[data-pf-perf="'+(window.CSS&&CSS.escape?CSS.escape(id):id)+'"]');
  const selected=state.portfolios.find(p=>String(p.id)===String(id));
  const hero=document.querySelector('[data-d-hero="'+(window.CSS&&CSS.escape?CSS.escape(id):id)+'"]');
  if(hero&&selected){const tmp=document.createElement('div');tmp.innerHTML=dHeroHtml(selected,portfolioPositions(selected.id));hero.replaceWith(tmp.firstElementChild)}
  if(!el||!selected)return;
  const html=portfolioPerformanceHtml(selected);
  if(!html){el.remove();return}
  const tmp=document.createElement('div');tmp.innerHTML=html;el.replaceWith(tmp.firstElementChild);
}
async function loadPortfolioPerformance(id,force=false){
  id=String(id||'');if(!id)return;
  const entry=perfCache.get(id)||{};
  if(entry.loading)return;
  if(!force&&entry.at&&Date.now()-entry.at<(entry.data?5*60000:60000))return;
  entry.loading=true;perfCache.set(id,entry);
  try{entry.data=await fetchJson('/api/portfolio-performance?portfolioId='+encodeURIComponent(id));entry.error=''}
  catch(error){console.warn('Portfolio performance unavailable',error);entry.error=String(error&&error.message||'')}
  entry.loading=false;entry.at=Date.now();
  // El servidor completa los históricos por tandas: se vuelve a pedir hasta tener la curva.
  if(entry.data&&entry.data.computing){
    // Sin límite de valores: se sigue mientras avance; solo se para si se atasca varias rondas.
    const done=Number(entry.data.done)||0;
    entry.stuck=done>(entry.lastDone??-1)?0:(entry.stuck||0)+1;entry.lastDone=done;
    if(entry.stuck<4)setTimeout(()=>loadPortfolioPerformance(id,true),2500);
  }else{entry.stuck=0;entry.lastDone=-1}
  refreshPerfCard(id);
}
document.addEventListener('toggle',e=>{if(e.target&&e.target.matches&&e.target.matches('[data-pf-perf]')){try{localStorage.setItem('viewinvai:pf-perf-open',e.target.open?'1':'0')}catch(_){}}},true);
document.addEventListener('click',event=>{
  const r=event.target.closest&&event.target.closest('[data-pf-perf-range]');
  if(r){
    try{localStorage.setItem('viewinvai:pf-perf-range',r.dataset.pfPerfRange)}catch(_){}
    const card=r.closest('[data-pf-perf]');if(card)refreshPerfCard(card.dataset.pfPerf);
    return;
  }
  const retry=event.target.closest&&event.target.closest('[data-pf-perf-retry]');
  if(retry){event.preventDefault();loadPortfolioPerformance(retry.dataset.pfPerfRetry,true)}
});

// Same value twice in one portfolio: usually the position typed by hand plus the one
// imported from the broker. One tap keeps the broker history.
function portfolioDuplicatesHtml(selected, positions) {
  if (!selected || !positions || positions.length < 2) return '';
  const seen = new Map();
  positions.forEach(p => {
    const stock = stockByKey(p.stock_key) || {};
    const ref = String(p.isin || stock.isin || stock.trIsin || p.stock_key || '').toUpperCase();
    if (!ref) return;
    if (!seen.has(ref)) seen.set(ref, []);
    seen.get(ref).push(p);
  });
  const dup = [...seen.values()].filter(list => list.length > 1);
  if (!dup.length) return '';
  const names = dup.map(list => list[0].ticker || stockByKey(list[0].stock_key)?.ticker || list[0].stock_key);
  return '<div class="portfolio-dup-banner" role="status"><div><strong>' + dup.length + (dup.length === 1 ? ' valor aparece dos veces' : ' valores aparecen dos veces') + '</strong>' +
    '<span>' + esc(names.slice(0, 6).join(', ')) + (names.length > 6 ? '…' : '') + ': lo que apuntaste a mano y lo importado del bróker.</span></div>' +
    '<button type="button" class="btn small" data-portfolio-dedupe="' + esc(selected.id) + '">Quedarme con el historial del bróker</button></div>';
}

function portfolioContextHtml(selected, positions) {
  if (!selected) {
    // Si la carga falló, no se invita a crear una cartera: puede que el usuario ya tenga varias.
    if (state.loadError) return '<div class="portfolio-empty-state portfolio-load-error" role="alert"><h2>No se pudieron cargar tus carteras</h2><p>' + esc(state.loadError) + '</p><button type="button" class="btn" data-portfolio-retry>↻ Reintentar</button></div>';
    return '<div class="portfolio-empty-state"><h2>Crea tu primera cartera</h2><button type="button" class="btn" data-new-portfolio="1">＋ Crear cartera</button></div>';
  }
  try {
    const summary = portfolioSummaryHtml(selected, positions);
    const rows = positions.length
      ? sortPositions(positions).map(renderPositionRowSafe).join('')
      : '<div class="portfolio-empty-state compact">Esta cartera todavía no tiene posiciones. Pulsa “+” para añadir una.</div>';
    return portfolioDuplicatesHtml(selected, positions) + summary + portfolioCashRowHtml(selected) + portfolioPerformanceHtml(selected) + portfolioInsightsHtml(selected) +
      positionSortBarHtml(positions.length) +
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
    actionsHtml:'<button type="button" class="portfolio-analyze compact" data-analyze-type="watchlist" data-analyze-id="' + esc(w.id) + '">✦ IA</button>'
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
function portfolioCashFxRateFor(portfolio,transactionCurrency){
  const base=String(portfolio&&portfolio.base_currency||transactionCurrency||"EUR").toUpperCase();
  const tx=String(transactionCurrency||base).toUpperCase();
  if(base===tx)return null;
  const fx=num(portfolioUsdToEurRate());
  if(fx===null||fx<=0)return null;
  if(tx==="USD"&&base==="EUR")return fx;
  if(tx==="EUR"&&base==="USD")return 1/fx;
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
function goalIncludesCrypto(goal){const g=goal||selectedPortfolioGoal()||state.goal||{};return Number(g.include_crypto)===1}
// Efectivo para el objetivo (paso 1 del asistente): el dinero con el que juega el plan y del que salen las huchas.
// No cuenta como avance: el progreso solo mide lo invertido. Se guarda lo que queda fuera, así al comprar baja
// lo disponible para el objetivo en lo mismo que se invierte.
// Efectivo del que salen las huchas: el elegido para el objetivo (si lo hay) o todo el efectivo.
function goalSleeveBudgetEur(goal,cashEur){
  return String(goal&&goal.goal_cash_mode)==="amount"?goalCountedCashEur(goal,cashEur):Math.max(0,num(cashEur)||0);
}
function goalCountedCashEur(goal,cashEur){
  const g=goal||{},cash=Math.max(0,num(cashEur)||0),mode=String(g.goal_cash_mode||"none");
  if(mode==="amount")return Math.max(0,cash-(num(g.goal_cash_reserve_eur)||0));
  return 0;
}
// Valor de Mi cripto con precio de consenso; null si falta alguna cotización (no se suma a medias).
function goalCryptoValueEur(){
  const C=window.ViewInvAICrypto;if(!C||typeof C.totals!=="function")return null;
  const t=C.totals();return t&&t.count>0&&t.complete?num(t.value):t&&t.count===0?0:null;
}
function portfolioGoalMetrics(){
  const portfolio=selectedPortfolio();
  if(!portfolio)return{portfolio:null,rows:[],currentValue:null,totalPnl:null,target:null,remaining:null,progress:0,goalPressure:0,requiredMultiple:null,requiredReturnPct:null,marketScope:"auto"};
  const fxUsdEur=portfolioUsdToEurRate(),positions=portfolioPositions(portfolio.id),rows=positions.map(p=>portfolioGoalPositionSnapshot(p,fxUsdEur)).filter(Boolean);
  let investedValue=0,openPnl=0,currentComplete=true,pnlComplete=true,investedComplete=true;
  for(const row of rows){if(row.valueEur===null)currentComplete=investedComplete=false;else investedValue+=row.valueEur;if(row.pnlEur===null)pnlComplete=false;else openPnl+=row.pnlEur}
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
  // El progreso hacia la meta cuenta solo lo invertido: el efectivo sin invertir no es avance (sí es capital
  // para las compras). Mi cripto, si el objetivo la incluye, suma al progreso (no al capital de las compras).
  const includeCrypto=goalIncludesCrypto(),cryptoEur=includeCrypto?goalCryptoValueEur():null;
  // El progreso solo cuenta lo invertido (y Mi cripto si se incluye); el efectivo para el objetivo es capital, no avance.
  const budgetCashEur=goalCountedCashEur(selectedPortfolioGoal()||state.goal,cashEur);
  const goalValue=investedComplete?investedValue+(cryptoEur||0):null;
  const remaining=target!==null&&goalValue!==null?target-goalValue:null;
  const progress=target&&goalValue!==null?Math.max(0,Math.min(100,goalValue/target*100)):0;
  const requiredMultiple=target!==null&&goalValue!==null&&goalValue>0?target/goalValue:null;
  const requiredReturnPct=requiredMultiple!==null?(requiredMultiple-1)*100:null;
  const goalPressure=remaining!==null&&remaining>0&&capital>0?Math.max(0,Math.min(1,remaining/capital)):0;
  const riskBand=portfolioGoalRiskBand(goalConfig.riskProfile);
  return{portfolio,rows,fxUsdEur,currentValue:capital,goalValue,includeCrypto,cryptoEur,budgetCashEur,investedValue:investedComplete?investedValue:null,cashEur,openPnl:pnlComplete?openPnl:null,realizedPnl,realizedKnown,totalPnl,target,remaining,progress,goalPressure,requiredMultiple,requiredReturnPct,marketScope:portfolioMarketScope(portfolio,positions),goalConfig,riskBand};
}

function coachPriceLevels(stock,preferTr,score,entryPrice=null,riskBand=null){
  const market=currentMarket(stock,preferTr),price=num(entryPrice)??num(market.price),change=Math.abs(num(market.change)||0);
  if(price===null||price<=0)return{stop:null,take:null,stopPct:null,takePct:null,currency:market.currency||"EUR"};
  const maxStop=num(riskBand&&riskBand.maxStopPct)??7;
  const minRR=num(riskBand&&riskBand.minRR)??1.8;
  const stopPct=Math.max(3.5,Math.min(maxStop,4.5+change*.12+(score<50?.75:0)));
  const takePct=Math.max(7,Math.min(18,stopPct*Math.max(minRR,score>=70?2:1.8)));
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
    // Holding time counts from the latest buy, so a repurchase restarts the 3-day minimum.
    const openedAt=new Date(row.p.last_buy_at||row.p.opened_at||row.p.created_at||"").getTime();
    const holdingDays=Number.isFinite(openedAt)&&openedAt>0?Math.max(0,(Date.now()-openedAt)/86400000):null;
    const weekPerf=num(row.stock&&row.stock.perfWeek);
    const catalyst=portfolioGoalCatalyst(row.stock),catalystDays=num(catalyst.days);
    const imminentCatalyst=catalystDays!==null&&catalystDays<=3&&(num(catalyst.impact)||0)>=65;
    // A position is only "stagnant" after three weeks without progress; a week of calm is normal.
    const monthPerf=num(row.stock&&row.stock.perfMonth)??weekPerf;
    const stagnant=holdingDays!==null&&holdingDays>=21&&monthPerf!==null&&Math.abs(monthPerf)<2&&score<60&&!imminentCatalyst;
    const minHoldActive=holdingDays!==null&&holdingDays<3;
    const positionReturnPct=row.avgEur!==null&&row.avgEur>0&&row.unitEur!==null?(row.unitEur/row.avgEur-1)*100:null;
    const stopLimit=num(metrics.riskBand&&metrics.riskBand.maxStopPct)??7;
    const takeTrigger=stopLimit*(num(metrics.riskBand&&metrics.riskBand.minRR)??1.8);
    const stopHit=positionReturnPct!==null&&positionReturnPct<=-stopLimit;
    const takeHit=positionReturnPct!==null&&positionReturnPct>=takeTrigger;
    // Exits use lower thresholds than entries and respect a 3-day minimum hold (except the stop).
    if(stopHit)targetWeight=0;
    else if(minHoldActive)targetWeight=currentWeight;
    else if(backendSignal==="SELL"||score<=35||stagnant)targetWeight=0;
    else if(takeHit)targetWeight=Math.min(currentWeight,currentWeight*.5);
    else if(score<40)targetWeight=Math.min(currentWeight,12);
    else if(currentWeight>maxWeight+12)targetWeight=Math.min(currentWeight,score>=70?maxWeight:maxWeight*.8);
    else if(currentWeight>maxWeight&&score<65)targetWeight=Math.min(currentWeight,maxWeight);
    if(goalReached&&backendSignal==="HOLD"&&score>=55)targetWeight=Math.min(targetWeight,currentWeight);
    const desiredReducePct=currentWeight>0?Math.max(0,(currentWeight-targetWeight)/currentWeight*100):0;
    const units=wholeRecommendationUnits(row.qty,row.qty*desiredReducePct/100);
    const reducePct=row.qty>0?Math.max(0,Math.min(100,units/row.qty*100)):0;
    const execution=goalExecutionQuote(row.stock,row.preferTr,"SELL",metrics.fxUsdEur,row.p.broker,units);
    const releasedGross=execution.unitEur===null?0:execution.unitEur*units;
    const released=units>0?Math.max(0,releasedGross-execution.feeEur):0;
    const action=units<=0?"MANTENER":units>=Math.floor(row.qty+1e-9)&&Math.abs(row.qty-Math.floor(row.qty+1e-9))<1e-8?"SALIR":"REDUCIR",reasons=[];
    if(backendSignal)reasons.push("señal IA "+signalInfo(backendSignal)[0].toLowerCase());
    else reasons.push("pendiente de análisis IA de cartera");
    if(stopHit)reasons.push("stop de riesgo alcanzado ("+formatNumber(positionReturnPct,2)+"%)");
    if(takeHit)reasons.push("objetivo de beneficio alcanzado · asegurar parte");
    if(stagnant)reasons.push("sin avance en las últimas semanas");
    if(minHoldActive&&!stopHit)reasons.push("permanencia mínima de 3 días");
    if(currentWeight>(metrics.riskBand&&metrics.riskBand.maxPosition||30))reasons.push("concentración "+formatNumber(currentWeight,1)+"%");
    reasons.push("score "+formatNumber(score,0)+"/100");
    if(quality)reasons.push("calidad "+formatNumber(quality,0)+"/100");
    if(goalReached)reasons.push("objetivo alcanzado");
    const levels=action==="SALIR"?{stop:null,take:null,stopPct:null,takePct:null,currency:row.market.currency||"EUR"}:coachPriceLevels(row.stock,row.preferTr,score,null,metrics.riskBand);
    return{...row,score,quality,currentWeight,targetWeight,reducePct,units,released,releasedGross,execution,action,reasons,levels,holdingDays,weekPerf,stagnant,positionReturnPct,stopHit,takeHit};
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
function portfolioGoalVelocityScore(stock,score,quality,preferTr=false){
  const catalyst=portfolioGoalCatalyst(stock),days=num(catalyst.days);
  const rawChange=num(preferTr?(stock&&stock.trLiveChangePct):((stock&&stock.usLiveChangePct)??(stock&&stock.changePct)))??0;
  const relVolume=num(stock&&stock.relVolume);
  const adx=num(stock&&stock.adx);
  const ema20=num(stock&&stock.ema20),ema50=num(stock&&stock.ema50);
  const trend=ema20!==null&&ema50!==null&&ema20>=ema50?12:ema20!==null&&ema50!==null?-4:0;
  const momentum=Math.max(0,Math.min(34,(rawChange+1.5)*3.2));
  const volume=relVolume===null?6:Math.max(0,Math.min(22,relVolume*8));
  const trendStrength=adx===null?6:Math.max(0,Math.min(16,(adx-10)*.8));
  const timeBonus=days===null?0:days<=1?10:days<=3?8:days<=7?6:days<=14?3:1;
  const catalystBonus=Math.min(12,(num(catalyst.impact)||0)*.12);
  const qualityBonus=Math.min(6,(num(quality)||0)*.06);
  const scoreTieBreaker=Math.min(6,(num(score)||0)*.06);
  const value=Math.max(0,Math.min(100,momentum+volume+trendStrength+trend+timeBonus+catalystBonus+qualityBonus+scoreTieBreaker));
  return{score:value,catalyst};
}

function portfolioGoalEntryTiming(stock,preferTr,execution,band){
  const market=execution&&execution.market||currentMarket(stock,preferTr);
  const nativePrice=num(execution&&execution.price)??num(market&&market.price);
  // EMA, máximo y mínimo son niveles del mercado principal (NYSE/NASDAQ en $, o XETRA/Viena en €):
  // se comparan con el precio de ESE mismo mercado y solo se usan como porcentaje. Nunca se
  // convierte el precio de LSX a otra divisa para compararlo con niveles de otra bolsa.
  // La cotización en vivo de EE. UU. solo se usa si es reciente (puede ser de otra sesión);
  // si no, precio, máximo y mínimo salen juntos del snapshot.
  const usAt=num(stock&&stock.usLiveReceivedAt);
  const usLive=usAt!==null&&Date.now()-usAt<=10*60000?num(stock&&stock.usLivePrice):null;
  const technicalPrice=preferTr?(usLive??num(stock&&stock.price)):nativePrice;
  const ema20=num(stock&&stock.ema20),ema50=num(stock&&stock.ema50);
  const dayHigh=usLive!==null?num(stock&&stock.usLiveDayHigh):num(stock&&stock.dayHigh);
  const dayLow=usLive!==null?num(stock&&stock.usLiveDayLow):num(stock&&stock.dayLow);
  const dayChange=num(market&&market.change)??0,weekPerf=num(stock&&stock.perfWeek);
  const spread=num(execution&&execution.spreadPct);

  const extensionPct=technicalPrice!==null&&ema20!==null&&ema20>0?(technicalPrice/ema20-1)*100:null;
  const nearHighPct=technicalPrice!==null&&dayHigh!==null&&dayHigh>0&&technicalPrice<=dayHigh?(dayHigh-technicalPrice)/dayHigh*100:null;
  const supportCandidates=[ema20,dayLow].filter(v=>v!==null&&technicalPrice!==null&&v>0&&v<technicalPrice);
  const support=supportCandidates.length?Math.max(...supportCandidates):null;
  let stopPct=support!==null&&technicalPrice>0?(technicalPrice-support)/technicalPrice*100+0.7:4.5+Math.min(1.5,Math.abs(dayChange)*.10);
  stopPct=Math.max(3.5,Math.min(num(band&&band.maxStopPct)||7,stopPct));

  let takePct=12;
  if(extensionPct!==null)takePct-=Math.max(0,extensionPct)*.45;
  takePct-=Math.max(0,dayChange-3)*.22;
  if(weekPerf!==null)takePct-=Math.max(0,weekPerf-8)*.08;
  takePct=Math.max(5.5,Math.min(16,takePct));
  const rr=stopPct>0?takePct/stopPct:null;

  let timing=100;
  if(extensionPct!==null&&extensionPct>0)timing-=Math.min(34,extensionPct*3.1);
  if(dayChange>3)timing-=Math.min(24,(dayChange-3)*2);
  if(weekPerf!==null&&weekPerf>8)timing-=Math.min(18,(weekPerf-8)*.8);
  if(nearHighPct!==null&&nearHighPct<.8&&dayChange>4)timing-=10;
  if(spread!==null)timing-=Math.min(14,spread*1.8);
  if(ema20!==null&&ema50!==null&&ema20<ema50)timing-=14;
  if(dayChange<-.75)timing-=Math.min(18,Math.abs(dayChange+.75)*3);
  timing=Math.max(0,Math.min(100,timing));

  const reasons=[];
  if(extensionPct!==null&&extensionPct>(band.maxExtensionPct||7))reasons.push("demasiado alejada de EMA20");
  if(dayChange>(band.maxDayChangePct||10))reasons.push("subida intradía demasiado extendida");
  if(weekPerf!==null&&weekPerf>(band.maxWeekPerfPct||20))reasons.push("subida semanal demasiado extendida");
  if(dayChange<-.75)reasons.push("momentum de entrada deteriorado");
  if(rr!==null&&rr<(band.minRR||1.8))reasons.push("riesgo/beneficio insuficiente");
  if(timing<(band.minTiming||68))reasons.push("punto de entrada débil");
  if(nearHighPct!==null&&nearHighPct<.5&&dayChange>6)reasons.push("riesgo de perseguir máximos");

  const eligible=reasons.length===0&&rr!==null;
  return{eligible,timing,rr,stopPct,takePct,extensionPct,nearHighPct,dayChange,weekPerf,reasons};
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
      if(source==="Radar AI · alta convicción")old.pulseScore=num(row.score);else old.radarScore=num(row.score);
      old.quality=Math.max(old.quality||0,num(row.quality)||0);
      if(!old.sources.includes(source))old.sources.push(source);
      merged.set(key,old);
    }
  };
  try{ingest(window.ViewInvAIPulseCoach?.rankCandidates?.(40,[...excluded],marketScope)||[],"Radar AI · alta convicción")}catch(_){}
  try{ingest(window.ViewInvAIRadarCoach?.rankCandidates?.(40,[...excluded],marketScope)||[],"Radar AI · oportunidades")}catch(_){}
  const band=metrics.riskBand||portfolioGoalRiskBand("aggressive");
  const ranked=[...merged.values()].map(row=>{
    const scores=[row.pulseScore,row.radarScore].filter(x=>x!==null);
    const score=scores.length?Math.min(100,Math.max(...scores)+(scores.length>1?2:0)):0;
    const velocity=portfolioGoalVelocityScore(row.stock,score,row.quality,row.preferTr);
    const catalyst=velocity.catalyst||{},multiSource=row.sources.length>1;
    const brokerName=brokerDefaultName(metrics.portfolio,row.preferTr);
    const execution=goalExecutionQuote(row.stock,row.preferTr,"BUY",metrics.fxUsdEur,brokerName,1);
    const entry=portfolioGoalEntryTiming(row.stock,row.preferTr,execution,band);
    const spread=num(execution.spreadPct),spreadPenalty=spread===null?5:Math.min(16,spread*2);
    const confirmation=multiSource||score>=88||(num(catalyst.impact)||0)>=80;
    const composite=Math.max(0,Math.min(100,
      score*.34+(num(row.quality)||0)*.20+velocity.score*.16+entry.timing*.22+
      (multiSource?3:0)+Math.min(2,(num(catalyst.impact)||0)*.02)-spreadPenalty
    ));
    const spreadAcceptable=spread===null?row.quality>=80:spread<=(band.maxSpreadPct||6);
    return{...row,score,velocityScore:velocity.score,catalyst,confirmation,composite,execution,entry,brokerName,spreadAcceptable};
  }).filter(row=>
    row.confirmation&&row.spreadAcceptable&&row.entry&&row.entry.eligible&&
    row.execution.executable===true&&row.execution.unitEur!==null&&row.execution.unitEur>0&&
    row.score>=band.minCandidate&&row.quality>=band.minQuality&&
    row.velocityScore>=band.minVelocity&&row.composite>=band.minComposite
  ).sort((x,y)=>
    y.composite-x.composite||y.entry.timing-x.entry.timing||
    y.velocityScore-x.velocityScore||y.score-x.score||y.quality-x.quality
  );
  if(!ranked.length){state.goalCandidateCache={at:Date.now(),key:cacheKey,rows:[]};return[]}

  const finalists=[ranked[0]];
  if(ranked[1]&&ranked[1].composite>=Math.max(band.minComposite,ranked[0].composite-3))finalists.push(ranked[1]);
  const priced=finalists.filter(row=>row.execution.unitEur+row.execution.feeEur<=rotationPool);
  if(!priced.length){state.goalCandidateCache={at:Date.now(),key:cacheKey,rows:[]};return[]}

  const weights=priced.length===1?[1]:[.65,.35];
  const remainingGoal=Math.max(0,num(metrics.remaining)||0);
  const portfolioCapital=Math.max(rotationPool,num(metrics.currentValue)||0);
  let result=priced.map((row,index)=>{
    const feeEur=row.execution.feeEur||0;
    const existing=metrics.rows.find(item=>portfolioStockKey(item.stock)===portfolioStockKey(row.stock));
    const existingValue=Math.max(0,num(existing&&existing.valueEur)||0);
    const maxPositionEur=Math.max(0,portfolioCapital*(band.maxPosition||30)/100-existingValue);
    const riskBudgetEur=Math.max(0,portfolioCapital*(band.riskPerTradePct||2)/100);
    const riskAllocationCap=row.entry.stopPct>0?riskBudgetEur/(row.entry.stopPct/100):0;
    const allocationCap=Math.max(0,Math.min(maxPositionEur,riskAllocationCap));
    const budget=Math.min(rotationPool*weights[index],allocationCap);
    const units=Math.floor(Math.max(0,budget-feeEur)/row.execution.unitEur);
    if(units<1)return null;
    const allocation=units*row.execution.unitEur,totalCost=allocation+feeEur;
    // Not worth it when buying and later selling costs too much relative to the ticket.
    if(allocation>0&&feeEur*2/allocation*100>(band.maxRoundTripFeePct||1.5))return null;
    const price=num(row.execution.price),currency=row.execution.currency||(row.preferTr?"EUR":"USD");
    const levels=price===null
      ?{stop:null,take:null,stopPct:row.entry.stopPct,takePct:row.entry.takePct,currency}
      :{stop:price*(1-row.entry.stopPct/100),take:price*(1+row.entry.takePct/100),stopPct:row.entry.stopPct,takePct:row.entry.takePct,currency};
    const potentialGain=allocation>0&&levels.takePct!==null?allocation*levels.takePct/100:0;
    const goalShare=remainingGoal>0?Math.min(100,potentialGain/remainingGoal*100):0;
    return{...row,rank:index+1,unitEur:row.execution.unitEur,allocation,totalCost,feeEur,units,levels,potentialGain,goalShare,cashAvailable,released,maxPositionEur,riskBudgetEur,allocationCap};
  }).filter(Boolean);

  if(!result.length){state.goalCandidateCache={at:Date.now(),key:cacheKey,rows:[]};return[]}

  result=result.sort((x,y)=>y.composite-x.composite).map((row,index)=>{
    const finalExecution=goalExecutionQuote(row.stock,row.preferTr,"BUY",metrics.fxUsdEur,row.brokerName,row.units);
    const finalEntry=portfolioGoalEntryTiming(row.stock,row.preferTr,finalExecution,band);
    if(!finalEntry.eligible)return null;
    const allocation=(num(finalExecution.unitEur)||0)*row.units,totalCost=allocation+(num(finalExecution.feeEur)||0);
    if(allocation>row.allocationCap+0.01)return null;
    const price=num(finalExecution.price),currency=finalExecution.currency||(row.preferTr?"EUR":"USD");
    const levels=price===null
      ?{stop:null,take:null,stopPct:finalEntry.stopPct,takePct:finalEntry.takePct,currency}
      :{stop:price*(1-finalEntry.stopPct/100),take:price*(1+finalEntry.takePct/100),stopPct:finalEntry.stopPct,takePct:finalEntry.takePct,currency};
    const potentialGain=allocation>0&&levels.takePct!==null?allocation*levels.takePct/100:0;
    return{...row,entry:finalEntry,execution:finalExecution,levels,unitEur:finalExecution.unitEur,feeEur:finalExecution.feeEur,allocation,totalCost,rank:index+1,potentialGain,goalShare:remainingGoal>0?Math.min(100,potentialGain/remainingGoal*100):0};
  }).filter(Boolean);
  state.goalCandidateCache={at:Date.now(),key:cacheKey,rows:result};return result;
}
// Compras en acciones enteras; ventas con decimales (posiciones fraccionadas o parte libre de una congelación).
function goalOperationUnits(side,value){
  const v=Math.max(0,num(value)||0);
  return Math.floor(v*1e6+1e-6)/1e6;
}
function goalOperationButtonHtml({side,portfolioId,positionId="",broker="",stockKey,units,price,fees,currency,preferTr,executable=false,executionReason="",riskEur=null,dayChangePct=null,sleeve=""}){
  if(!(num(units)>0)||num(price)===null)return"";
  // Sin cotización ejecutable verificada la app no la propone como precio, pero si ya ejecutaste la orden
  // en tu bróker puedes registrarla con el precio real (el formulario parte del precio de referencia).
  const unverified=!executable;
  return (unverified?'<small class="portfolio-goal-execution-blocked" title="'+esc(executionReason||"Cotización no ejecutable")+'">Cotización ejecutable sin verificar</small>':'')+
    '<button type="button" class="'+(unverified?'goal2-decide':'btn ghost compact')+' portfolio-goal-register"'+(unverified?' data-goal-unverified="1" title="Ya la he ejecutado: registra la orden con su precio real"':'')+' data-register-goal-operation="'+esc(String(side||"BUY").toUpperCase())+'" data-goal-portfolio="'+esc(portfolioId||"")+'" data-goal-position-id="'+esc(positionId||"")+'" data-goal-broker="'+esc(broker||"")+'" data-goal-stock-key="'+esc(stockKey||"")+'" data-goal-units="'+esc(String(goalOperationUnits(side,units)))+'" data-goal-price="'+esc(String(num(price)))+'" data-goal-fees="'+esc(String(num(fees)||0))+'" data-goal-currency="'+esc(currency||"EUR")+'" data-goal-prefer-tr="'+(preferTr?'1':'0')+'"'+(num(riskEur)!==null?' data-goal-risk="'+esc(String(num(riskEur)))+'"':'')+(num(dayChangePct)!==null?' data-goal-day="'+esc(String(num(dayChangePct)))+'"':'')+(sleeve?' data-goal-sleeve="'+esc(sleeve)+'"':'')+'>'+(unverified?'✓ Ya ejecutada':'＋ Registrar estrategia')+'</button>';
}
function goalTradeInstructionHtml(row){
  const sellUnits=Math.max(0,Math.round(num(row.units)||0)),keepUnits=Math.max(0,(num(row.qty)||0)-sellUnits),execution=row.execution||{};
  const complete=sellUnits>=Math.floor((num(row.qty)||0)+1e-9)&&Math.abs((num(row.qty)||0)-Math.floor((num(row.qty)||0)+1e-9))<1e-8;
  const detail=complete?"Salida completa · "+formatNumber(sellUnits,0)+" acciones":"Vender "+formatNumber(sellUnits,0)+" acciones ("+formatNumber(row.reducePct,0)+"%) · mantener "+formatNumber(keepUnits,0);
  const price=execution.price!==null&&execution.price!==undefined?formatMoney(execution.price,execution.currency||"EUR"):"—";
  const spread=execution.spreadPct!==null&&execution.spreadPct!==undefined?" · spread "+formatNumber(execution.spreadPct,2)+"%":"";
  const fee=execution.feeEur?(" · comisión "+formatMoney(execution.feeEur,"EUR")):"";
  const button=goalOperationButtonHtml({side:"SELL",portfolioId:row.p.portfolio_id,positionId:row.p.id,broker:row.p.broker,stockKey:row.p.stock_key,units:sellUnits,price:execution.price,fees:execution.feeNative??execution.feeEur,currency:execution.currency||row.p.currency||"EUR",preferTr:row.preferTr,executable:execution.executable===true,executionReason:execution.executionReason});
  const reason=row.reasons&&row.reasons.length?'<small>Motivo: '+esc(row.reasons.join(" · "))+'</small>':'';
  return '<div class="portfolio-goal-trade sell" data-open-stock="'+esc(row.p.stock_key)+'" data-position-prefer-tr="'+(row.preferTr?'1':'0')+'" role="button" tabindex="0">'+
    '<em>VENDER</em><div><strong>'+esc(row.stock.name||row.p.ticker||row.p.stock_key)+'</strong><small>'+esc(detail)+'</small><small>'+esc((execution.instruction||"Venta límite")+" · "+price+spread+fee)+'</small>'+reason+button+'</div><b>≈ '+formatMoney(row.released,"EUR")+'</b></div>';
}
// A buy is only actionable once it also qualified in the server's previous daily review.
function goalCandidateConfirmed(stock){
  const goal=selectedPortfolioGoal();
  let list=[];
  try{list=JSON.parse(goal&&goal.review_candidates||"[]")}catch(_){list=[]}
  if(!Array.isArray(list)||!list.length)return false;
  const keys=new Set(list.map(x=>String(x||"").toUpperCase()));
  const variants=[portfolioStockKey(stock),stock&&stock.tvSymbol,stock&&((stock.exchange||"")+":"+(stock.ticker||""))].map(x=>String(x||"").trim().toUpperCase()).filter(Boolean);
  return variants.some(x=>keys.has(x));
}
function goalCandidateHtml(row){
  // Una IA externa que contradice la compra (respuesta pegada o con clave) la deja en observación.
  const C=window.ViewInvAIContrast,ai=C&&C.tickerVerdict?C.tickerVerdict(row.stock&&(row.stock.ticker||row.stock.trTicker),portfolioStockKey(row.stock)):null,aiBlocked=!!(ai&&ai.verdict==="contradice");
  const key=portfolioStockKey(row.stock),confirmed=goalCandidateConfirmed(row.stock)&&!aiBlocked,marketLabel=row.preferTr?"TR / LSX":"EEUU",units=formatNumber(Math.max(0,Math.round(num(row.units)||0)),0)+" acciones";
  const catalyst=row.catalyst||portfolioGoalCatalyst(row.stock),levels=row.levels||{},execution=row.execution||{};
  const stop=levels.stop!==null&&levels.stop!==undefined?formatMoney(levels.stop,levels.currency||"EUR"):"—";
  const take=levels.take!==null&&levels.take!==undefined?formatMoney(levels.take,levels.currency||"EUR"):"—";
  const bid=execution.bid!==null&&execution.bid!==undefined?formatMoney(execution.bid,execution.currency||"EUR"):"—";
  const ask=execution.ask!==null&&execution.ask!==undefined?formatMoney(execution.ask,execution.currency||"EUR"):"—";
  const spread=execution.spreadPct!==null&&execution.spreadPct!==undefined?formatNumber(execution.spreadPct,2)+"%":"N/D";
  const entry=execution.price!==null&&execution.price!==undefined?formatMoney(execution.price,execution.currency||"EUR"):"—";
  const fee=row.feeEur?(" · comisión "+formatMoney(row.feeEur,"EUR")):"";
  const spreadCost=num(execution.spreadPct)!==null&&num(row.allocation)>0?row.allocation*num(execution.spreadPct)/200:null;
  const costLine=spreadCost!==null||row.feeEur?'<small>Coste estimado de entrar: '+esc(formatMoney((num(row.feeEur)||0)+(spreadCost||0),"EUR"))+' (comisión + medio spread)</small>':"";
  const button=confirmed
    ?goalOperationButtonHtml({side:"BUY",portfolioId:state.selectedPortfolioId,broker:row.brokerName,stockKey:key,units:row.units,price:execution.price,fees:execution.feeNative??row.feeEur,currency:execution.currency||(row.preferTr?"EUR":"USD"),preferTr:row.preferTr,executable:execution.executable===true,executionReason:execution.executionReason})
    :aiBlocked?'<span class="portfolio-goal-execution-blocked">En observación · la IA externa lo desaconseja'+(ai.reason?': '+esc(ai.reason):'')+'</span>'
    :'<span class="portfolio-goal-execution-blocked">En observación · se confirma si vuelve a superar el filtro en la próxima revisión diaria</span>';
  return '<div class="portfolio-goal-trade buy" data-open-stock="'+esc(key)+'" data-position-prefer-tr="'+(row.preferTr?'1':'0')+'" role="button" tabindex="0">'+
    '<em>#'+esc(row.rank||1)+' · '+(confirmed?'COMPRAR':'EN OBSERVACIÓN')+(ai&&C?' '+C.badgeHtml(ai):'')+'</em><div><strong>'+esc(row.stock.name||row.stock.ticker||key)+'</strong><small>'+esc(units+" · "+marketLabel+" · acciones "+formatMoney(row.allocation,"EUR")+fee+" · total "+formatMoney(row.totalCost||row.allocation,"EUR"))+'</small><small>'+esc((execution.instruction||"Orden límite")+" · entrada "+entry+" · BID "+bid+" · ASK "+ask+" · spread "+spread)+'</small><small>Stop '+esc(stop)+' · Take profit '+esc(take)+' · revisión IA continua</small>'+costLine+button+'</div><b>'+formatNumber(row.composite,0)+'/100</b></div>'+
    '<p class="portfolio-goal-reason"><b>Rigor de entrada:</b> convicción '+formatNumber(row.score,0)+'/100 · timing '+formatNumber(row.entry&&row.entry.timing,0)+'/100 · R:R '+formatNumber(row.entry&&row.entry.rr,2)+' · velocidad '+formatNumber(row.velocityScore,0)+'/100 · calidad '+formatNumber(row.quality,0)+'/100'+(row.entry&&num(row.entry.extensionPct)!==null?' · extensión EMA20 '+formatNumber(row.entry.extensionPct,1)+'%':'')+(catalyst&&catalyst.label?' · '+esc(catalyst.label):'')+'.</p>';
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
    currentValueEur:goalHistoryRound(metrics.goalValue,2),targetEur:goalHistoryRound(metrics.target,2),
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
  const plan=entry&&entry.plan||{},sells=Array.isArray(plan.sells)?plan.sells:[],buys=Array.isArray(plan.buys)?plan.buys:[],waits=Array.isArray(plan.waits)?plan.waits:[];
  const when=entry&&entry.created_at?new Date(entry.created_at):null;
  const stamp=when&&Number.isFinite(when.getTime())?when.toLocaleString("es-ES"):"";
  const sellsHtml=sells.length?sells.map(x=>'<div class="goal-history-op sell"><b>VENDER</b><span>'+esc(String(x.units||0))+' '+esc(x.ticker||x.name||"")+'</span><small>'+esc(x.instruction||"")+(num(x.price)!==null?' · '+esc(String(x.price))+' '+esc(x.currency||""):'')+(num(x.feeEur)!==null?' · comisión '+esc(goalHistoryMoney(x.feeEur)):'')+'</small></div>').join(''):'';
  const buysHtml=buys.length?buys.map(x=>'<div class="goal-history-op buy"><b>#'+esc(String(x.rank||1))+' COMPRAR AHORA</b><span>'+esc(String(x.units||0))+' '+esc(x.ticker||x.name||"")+'</span><small>'+esc(x.instruction||"")+(num(x.price)!==null?' · precio '+esc(String(x.price))+' '+esc(x.currency||""):'')+(num(x.bid)!==null||num(x.ask)!==null?' · BID/ASK '+esc(String(x.bid??"—"))+'/'+esc(String(x.ask??"—")):'')+(num(x.feeEur)!==null?' · comisión '+esc(goalHistoryMoney(x.feeEur)):'')+(num(x.stop)!==null?' · stop '+esc(String(x.stop)):'')+(num(x.takeProfit)!==null?' · TP '+esc(String(x.takeProfit)):'')+'</small></div>').join(''):'';
  const waitsHtml=waits.length?waits.map(x=>'<div class="goal-history-op wait"><b>'+esc(x.decision||"ESPERAR")+'</b><span>'+esc(x.ticker||x.name||"")+'</span><small>'+esc(x.instruction||"")+(num(x.limitPrice)!==null?' · máximo '+esc(String(x.limitPrice))+' EUR':'')+(num(x.currentPrice)!==null?' · actual '+esc(String(x.currentPrice))+' EUR':'')+'</small></div>').join(''):'';
  const empty=!sellsHtml&&!buysHtml&&!waitsHtml?'<div class="goal-history-empty">Sin cambios recomendados en esta revisión.</div>':'';
  return '<article class="goal-history-entry"><header><div><strong>#'+esc(String(index+1))+' · '+esc(stamp)+'</strong><small>'+esc(entry.summary||"Recomendación Objetivo IA")+'</small></div><b>'+esc(goalHistoryMoney(plan.currentValueEur))+' → '+esc(goalHistoryMoney(plan.targetEur))+'</b></header>'+
    '<div class="goal-history-ops">'+sellsHtml+buysHtml+waitsHtml+empty+'</div>'+
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

// ----- Objetivo «rápido» con el motor común (goal-engine.js): «Hoy toca» + progreso -----
function goalStockKey(stock){return String(stock&&stock.tvSymbol||((stock&&stock.exchange||"")+":"+(stock&&stock.ticker||""))).toUpperCase()}
function goalAtrPct(stock){const a=num(stock&&stock.atr),p=num(stock&&stock.price);return a!==null&&p>0?a/p*100:null}
// Mismo veredicto que la etiqueta «IA …» de la tarjeta (por ticker y, si se da, por clave del valor).
function goalAiOf(ticker,key){
  const C=window.ViewInvAIContrast,v=C&&C.tickerVerdict?C.tickerVerdict(ticker,key):null;
  return v&&v.verdict||"";
}
// Motivo de la vigilancia de noticias (IA de la app + búsqueda web) cuando invalida una posición.
function goalNewsReasonOf(ticker){
  const C=window.ViewInvAIContrast,v=C&&C.tickerVerdict?C.tickerVerdict(ticker):null;
  return v&&v.provider==="viewinvai-ai"&&v.verdict==="contradice"?v.reason||"":"";
}
// Ideas del analista IA (búsqueda web + IA en el servidor, comunes a todos y cacheadas 3 h).
let goalIdeasMemo={at:0,map:new Map(),loading:false};
function goalIdeaOf(ticker,marketTicker){
  const m=goalIdeasMemo.map;return m.get(String(marketTicker||"").toUpperCase())||m.get(String(ticker||"").toUpperCase())||null;
}
async function refreshGoalIdeas(){
  const auth=window.ViewInvAIAuth;
  if(goalIdeasMemo.loading||Date.now()-goalIdeasMemo.at<20*60000||!auth||!auth.getUser||!auth.getUser())return;
  goalIdeasMemo.loading=true;
  try{const r=await auth.apiFetch("/api/goal-ideas");const d=await r.json().catch(()=>({}));
    if(r.ok){const had=goalIdeasMemo.map.size;goalIdeasMemo.map=new Map((d.ideas||[]).map(i=>[String(i.ticker||"").toUpperCase(),i]));goalIdeasMemo.at=Date.now();
      // Las revisiones de noticias del servidor llegan como contrastes: se recargan a la vez.
      try{window.ViewInvAIContrast?.reloadRecent?.()}catch(_){}
      if(had||goalIdeasMemo.map.size)renderApp()}}
  catch(_){}finally{goalIdeasMemo.loading=false;if(!goalIdeasMemo.at||Date.now()-goalIdeasMemo.at>20*60000)goalIdeasMemo.at=Date.now()-15*60000}
}
// Acciones congeladas de una posición que siguen vigentes hoy (fecha local, inclusive).
function positionFrozenQty(p){
  const until=String(p&&p.frozen_until||"").slice(0,10),qty=num(p&&p.frozen_qty)||0;
  if(!until||!(qty>0))return 0;
  const today=new Date().toLocaleDateString("sv-SE");
  return until>=today?Math.min(qty,Math.max(0,num(p.quantity)||qty)):0;
}
// Decisión «Decidir» vigente de una posición, en el formato del motor del Objetivo.
function goalDecisionFor(positionId){
  const D=window.ViewInvAIDecisions;
  const d=D&&typeof D.forPosition==="function"?D.forPosition(positionId):null;
  return d&&(d.decision==="hold"||d.decision==="later")?d:null;
}
function goalHoldFor(p,avgEur){
  const d=p?goalDecisionFor(p.id):null;if(!d)return null;
  return{mode:d.hold_mode||(d.decision==="hold"?"recover":"date"),pct:num(d.hold_pct),
    targetEur:num(d.target_eur)??(d.decision==="hold"&&!d.hold_mode?num(avgEur):null),emergencyEur:num(d.emergency_eur),
    until:d.hold_until||String(d.review_at||"").slice(0,10)};
}
// Próximo evento con fecha (resultados, FDA, junta…) de una acción, para «mantener hasta el catalizador».
function goalNextCatalyst(stock){
  let events=[];
  try{events=typeof stockEvents==="function"?stockEvents(stock):[]}catch(_){events=[]}
  const now=Date.now(),next=events.filter(e=>e&&e.eventKind!=="news"&&Number.isFinite(new Date(e.date||0).getTime())&&new Date(e.date).getTime()>=now-3600000)
    .sort((a,b)=>new Date(a.date)-new Date(b.date))[0];
  if(!next)return null;
  let label="";try{label=typeof EL==="function"?EL(next):String(next.title||next.type||"Catalizador")}catch(_){label=String(next.title||next.type||"Catalizador")}
  return{date:new Date(next.date).toLocaleDateString("sv-SE"),label};
}
let lastGoalCtx=null;
// Compras que el Objetivo ya recomendó (último plan del servidor y lo mostrado en esta sesión, menos de 2 días):
// el motor las mantiene salvo que otra candidata las supere con claridad, para que la recomendación no salte sin motivo.
const goalBuyMemory=new Map();
function goalRememberBuys(portfolioId,plan){
  const buys=((plan&&plan.actions)||[]).filter(a=>a.type==="BUY"&&a.key&&a.committed);
  const keys=buys.map(a=>String(a.key));
  if(keys.length)goalBuyMemory.set(String(portfolioId),{at:Date.now(),keys});
  // Ideas del día en este dispositivo: las que el motor sigue considerando fijadas (con su estado de límite) y las ya
  // cerradas (compradas o contradichas), que no vuelven aunque luego se venda la posición el mismo día.
  const store=goalIdeaStore(),pid=String(portfolioId||""),day=goalIdeaDay(),cur=store[pid]&&store[pid].day===day?store[pid]:{day,items:[],consumed:[]};
  const before=JSON.stringify(cur);
  for(const c of (plan&&plan.commitments)||[]){
    const old=cur.items.find(i=>i.key===c.key);
    if(old){old.limited=!!(old.limited||c.limited);if(num(old.ticketEur)===null)old.ticketEur=num(c.ticketEur);if(c.changed&&!old.changed)old.changed=String(c.changed)}else cur.items.push({key:c.key,priceEur:num(c.priceEur),at:c.at||new Date().toISOString(),ticker:c.ticker||"",name:c.name||"",limited:!!c.limited,ticketEur:num(c.ticketEur),changed:String(c.changed||"")});
  }
  cur.consumed=[...new Set([...(cur.consumed||[]),...((plan&&plan.consumedCommitments)||[]).map(c=>String(c.key))])];
  cur.items=cur.items.filter(i=>!cur.consumed.includes(i.key));
  if(JSON.stringify(cur)!==before){store[pid]=cur;try{localStorage.setItem(GOAL_IDEAS_KEY,JSON.stringify(store))}catch(_){}}
}
// Ideas fijadas del día por cartera (en este dispositivo y las del último plan revisado por el servidor hoy).
// Mientras exista una idea fijada, el Objetivo no la cambia por otra: solo se retira si la IA la contradice o si el
// precio se aleja más de un 3 % (entonces queda como compra límite). El día es el de Madrid, igual que en el servidor.
const GOAL_IDEAS_KEY="viewinvai:goal-ideas:v2";
const goalMadridDay=t=>new Date(t).toLocaleDateString("sv-SE",{timeZone:"Europe/Madrid"});
function goalIdeaDay(){return goalMadridDay(Date.now())}
function goalIdeaStore(){try{const s=JSON.parse(localStorage.getItem(GOAL_IDEAS_KEY)||"{}");return s&&typeof s==="object"?s:{}}catch(_){return{}}}
function goalTodayCommitments(portfolioId,goal){
  const day=goalIdeaDay(),out=new Map(),entry=goalIdeaStore()[String(portfolioId||"")];
  const put=c=>{const old=out.get(c.key);
    // Se conserva la primera vez que se vio la idea (su precio y su hora marcan el límite de persecución).
    if(!old){out.set(c.key,c);return}
    const first=String(c.at||"")&&String(c.at||"")<String(old.at||"")?c:old,other=first===c?old:c;
    // Un cambio de recomendación ya mostrado (en el servidor o aquí) se conserva el resto del día.
    out.set(c.key,{...other,...first,limited:!!(old.limited||c.limited),changed:String(old.changed||c.changed||""),ticketEur:num(first.ticketEur)??num(other.ticketEur),reviewVerdict:old.reviewVerdict||c.reviewVerdict||"",facts:old.facts||c.facts||null,pros:(old.pros||[]).length?old.pros:(c.pros||[]),cons:(old.cons||[]).length?old.cons:(c.cons||[])});
  };
  const consumed=new Set(entry&&entry.day===day?entry.consumed||[]:[]);
  try{
    const plan=JSON.parse(goal&&goal.plan_json||"{}"),at=Date.parse(plan.at||"");
    if(Number.isFinite(at)&&goalMadridDay(at)===day){
      for(const c of plan.consumedCommitments||[])consumed.add(String(c.key));
      const detail=new Map([...(plan.actions||[]).filter(x=>x&&x.type==="BUY"),...(plan.waits||[]).filter(x=>x&&x.committed)].map(a=>[String(a.key),a]));
      const base=Array.isArray(plan.commitments)?plan.commitments:[...detail.values()].map(a=>({key:String(a.key),priceEur:num(a.committedPriceEur??a.priceEur),at:a.committedAt||plan.at,limited:a.type==="WAIT"}));
      for(const c of base){const a=detail.get(String(c.key))||{};
        put({key:String(c.key),priceEur:num(c.priceEur),at:c.at||plan.at,limited:!!c.limited,ticketEur:num(c.ticketEur),changed:String(c.changed||""),ticker:c.ticker||a.ticker||"",name:c.name||a.name||"",score:num(a.burstScore),
          reviewVerdict:a.aiVerdict||"",facts:a.facts||null,pros:a.pros||[],cons:a.cons||[]})}
    }
  }catch(_){}
  if(entry&&entry.day===day)for(const i of entry.items||[])if(i&&i.key)put(i);
  const discarded=new Set(goalTodayDiscarded(portfolioId,goal));
  return[...out.values()].filter(c=>!consumed.has(c.key)&&!discarded.has(c.key)).sort((x,y)=>String(x.at||"").localeCompare(String(y.at||""))).slice(0,4);
}
// Ideas nuevas descartadas hoy tras un cambio de recomendación (servidor y este dispositivo): liberan su efectivo.
function goalTodayDiscarded(portfolioId,goal){
  const day=goalIdeaDay(),out=new Set(),entry=goalIdeaStore()[String(portfolioId||"")];
  try{const d=JSON.parse(goal&&goal.discarded_ideas||"{}");if(d&&d.day===day&&Array.isArray(d.keys))for(const k of d.keys)out.add(String(k))}catch(_){}
  if(entry&&entry.day===day)for(const k of entry.discarded||[])out.add(String(k));
  return[...out];
}
// Días (de Madrid) hasta los próximos resultados; el paquete de mercado los trae en segundos Unix o en texto.
function goalEarningsIn(stock){
  const raw=stock&&stock.earningsDate,v=num(raw),ms=v!==null?(v>1e12?v:v*1000):Date.parse(String(raw||"").slice(0,10)+"T12:00:00Z");
  if(!Number.isFinite(ms)||ms<=0)return{};
  const day=goalMadridDay(ms),d=Math.round((Date.parse(day+"T12:00:00Z")-Date.parse(goalIdeaDay()+"T12:00:00Z"))/864e5);
  return d>=0&&d<=60?{earningsDays:d,earningsDate:day}:{};
}
function goalClientStickyKeys(portfolioId,goal){
  const out=new Set(),fresh=at=>Number.isFinite(at)&&Date.now()-at<=2*86400000;
  try{
    const plan=JSON.parse(goal&&goal.plan_json||"{}");
    if(fresh(Date.parse(plan.at||"")))for(const a of plan.actions||[])if(a&&a.type==="BUY"&&a.key)out.add(String(a.key));
  }catch(_){}
  const mem=goalBuyMemory.get(String(portfolioId||""));
  if(mem&&fresh(mem.at))for(const k of mem.keys)out.add(k);
  return[...out].slice(0,5);
}
function goalEngineInput(metrics,positionRows){
  const goal=selectedPortfolioGoal()||state.goal||{},cfg=metrics.goalConfig||portfolioGoalConfig();
  const states=new Map((goal.position_state||[]).map(r=>[String(r.stock_key||"").toUpperCase(),r]));
  const mode=metrics.marketScope==="us"?"us":"tr",preferTr=mode==="tr",shortBand=portfolioGoalRiskBand(cfg.riskProfile);
  const radarPrimary=typeof radarAiCandidateRows==="function"?radarAiCandidateRows(mode,null):[];
  const broad=window.ViewInvAIPulseCoach&&typeof window.ViewInvAIPulseCoach.rankCandidates==="function"
    ?window.ViewInvAIPulseCoach.rankCandidates(60,[],mode,50):[];
  const merged=new Map();
  for(const row of radarPrimary||[]){const key=goalStockKey(row.s);if(key)merged.set(key,row)}
  for(const row of broad||[]){
    const stock=row.stock||row.s,key=goalStockKey(stock);if(!key)continue;
    const old=merged.get(key);
    if(!old)merged.set(key,{s:stock,score:row.score,quality:row.quality,tier:"watch",speculative:false,earlyPool:true});
    else{old.score=Math.max(num(old.score)||0,num(row.score)||0);old.quality=Math.max(num(old.quality)||0,num(row.quality)||0)}
  }
  const radar=[...merged.values()].sort((a,b)=>(num(b.score)||0)-(num(a.score)||0)||(num(b.quality)||0)-(num(a.quality)||0));
  const radarByKey=new Map(radar.map(r=>[goalStockKey(r.s),r]));
  // Las acciones congeladas suman al valor de la cartera, pero el plan no las vende ni les pone stop.
  let lockedValueEur=0,lockedHoldings=0,lockedHighRiskEur=0;const lockedKeys=[];
  // Huchas: las ideas cortas solo usan la hucha de riesgo alto. Las acciones de las huchas medio y bajo cuentan en el
  // valor, pero este plan no las vende ni ocupa sus huecos (tienen su propia estrategia).
  const sleeveState=goalSleeveStateOf(goal),otherSleeve=row=>!!sleeveState&&["medio","bajo"].includes(String(row.p.sleeve||""));
  for(const row of positionRows){
    if(otherSleeve(row)){if(row.unitEur!==null){lockedValueEur+=(num(row.qty)||0)*row.unitEur;lockedKeys.push(String(row.p.stock_key||"").toUpperCase(),goalStockKey(row.stock))}continue}
    const total=num(row.qty)||0,frozen=Math.min(total,positionFrozenQty(row.p));
    if(frozen>0&&row.unitEur!==null){
      lockedValueEur+=frozen*row.unitEur;lockedKeys.push(String(row.p.stock_key||"").toUpperCase(),goalStockKey(row.stock));
      // Lo congelado de riesgo alto cuenta para el límite de exposición de alto riesgo.
      const G1=window.ViewInvAIGoal;
      if(G1&&typeof G1.riskTier==="function"&&G1.riskTier({atrPct:goalAtrPct(row.stock),marketCap:num(row.stock&&row.stock.marketCap),sector:row.stock&&row.stock.sector,industry:row.stock&&row.stock.industry})==="alto")lockedHighRiskEur+=frozen*row.unitEur;
      if(total-frozen<=1e-9)lockedHoldings++;
    }
  }
  const positions=positionRows.filter(row=>!otherSleeve(row)).map(row=>({...row,qty:Math.max(0,(num(row.qty)||0)-positionFrozenQty(row.p))}))
    .filter(row=>row.qty>1e-9&&row.unitEur!==null).map(row=>{
    const key=String(row.p.stock_key||"").toUpperCase(),st=states.get(key)||{},rr=radarByKey.get(key)||radarByKey.get(goalStockKey(row.stock));
    const sell=goalExecutionQuote(row.stock,row.preferTr,"SELL",metrics.fxUsdEur,row.p.broker,row.qty);
    // Si LSX va con retraso (>2 min) y la cotización regular de EE. UU. es de ahora, el plan decide (stops, objetivos)
    // con el precio de EE. UU. convertido a €; la venta se registra luego con el precio real de LSX.
    const us=sell.usRef,lsxLag=sell.ageMs===null||sell.ageMs>120000,useUs=!!(us&&us.live&&us.eur!==null&&lsxLag);
    const ticker=String(row.stock.ticker||row.stock.trTicker||row.p.ticker||"").toUpperCase(),cat=portfolioGoalCatalyst(row.stock);
    const openedAt=new Date(row.p.last_buy_at||row.p.opened_at||row.p.created_at||"").getTime();
    const holdingDays=Number.isFinite(openedAt)&&openedAt>0?Math.max(0,(Date.now()-openedAt)/86400000):null;
    const marketTicker=String((row.preferTr?row.stock.trTicker:row.stock.ticker)||ticker).toUpperCase();
    return{hold:goalHoldFor(row.p,row.avgEur),positionId:row.p.id,key,ticker,marketTicker,name:row.stock.name||row.p.name||"",units:row.qty,avgEur:row.avgEur,priceEur:useUs?us.eur:row.unitEur,bidEur:useUs?us.eur:sell.unitEur,priceSource:useUs?"us":"lsx",score:row.score,quality:row.quality,
      tier:rr?rr.tier:"",speculative:!!(rr&&rr.speculative),atrPct:goalAtrPct(row.stock),marketCap:num(row.stock&&row.stock.marketCap),sector:String(row.stock&&row.stock.sector||""),industry:String(row.stock&&row.stock.industry||""),peakEur:num(st.peak_eur),stopEur:num(st.stop_eur),
      feeEur:sell.feeEur||portfolioOperationFee(row.preferTr),aiVerdict:goalAiOf(ticker),aiNewsReason:goalNewsReasonOf(ticker),holdingDays,
      catalystDays:num(cat.days),catalystImpact:num(cat.impact),perfWeek:num(row.stock&&row.stock.perfWeek),perfMonth:num(row.stock&&row.stock.perfMonth),row};
  });
  const held=new Set(positions.map(p=>p.key));
  // Sin efectivo invertible y todo en «mantener»: no se preparan candidatas ni se piden ideas a la IA.
  const sleeveInput=sleeveState?{alto:{cashEur:sleeveState.sleeves.alto.cashEur}}:null;
  const G0=window.ViewInvAIGoal,idle=!!(G0&&G0.isIdle&&G0.isIdle({config:{investCapEur:num(goal.invest_cap_eur),investCapPct:num(goal.invest_cap_pct),investReserveEur:num(goal.invest_reserve_eur)},cashEur:num(metrics.cashEur)||0,positions,sleeves:sleeveInput}));
  // Las ideas fijadas hoy siempre se evalúan, aunque hayan salido de las primeras del Radar.
  // Solo cuentan como «ya incluidas» las fijadas que entran en las 40 primeras del Radar; las demás se añaden aparte.
  const committed=goalTodayCommitments(metrics.portfolio&&metrics.portfolio.id,goal),topRadar=radar.filter(r=>!held.has(goalStockKey(r.s))).slice(0,40);
  const inTop=new Set(topRadar.map(r=>goalStockKey(r.s)));
  const fixedRows=committed.filter(c=>!inTop.has(c.key)).map(c=>{const hit=radarByKey.get(c.key);if(hit)return hit;const s=stockByKey(c.key);return s?{s,score:c.score??60,quality:70,tier:"watch",speculative:false}:null}).filter(Boolean);
  const rowsToQuote=idle?[]:[...topRadar,...fixedRows.filter(r=>!held.has(goalStockKey(r.s)))];
  // Cotización de LSX de todas las candidatas aunque no se pinten (si no, se podaban y salían «sin cotización»).
  if(preferTr&&window.ViewInvAI&&typeof window.ViewInvAI.pinTrLiveKeys==="function")window.ViewInvAI.pinTrLiveKeys("goal",rowsToQuote.map(r=>portfolioStockKey(r.s)));
  const candidates=rowsToQuote.map(r=>{
    const q=goalExecutionQuote(r.s,preferTr,"BUY",metrics.fxUsdEur,"",1);
    const market=currentMarket(r.s,preferTr),entry=portfolioGoalEntryTiming(r.s,preferTr,q,shortBand),cat=portfolioGoalCatalyst(r.s);
    // Valor de EE. UU. en LSX con LSX retrasado: se decide con la cotización regular de EE. UU. (en €) y su variación.
    const us=q.usRef,useUs=!!(us&&us.live&&us.eur!==null&&(q.ageMs===null||q.ageMs>120000));
    let priceEur=useUs?us.eur:q.unitEur??num(market.eur);
    if(priceEur===null&&String(market.currency||"").toUpperCase()==="EUR")priceEur=num(market.price);
    // Idea fijada sin cotización ahora: se sigue evaluando con el último precio conocido (marcado como tal) para que
    // pueda pasar a «cambio de recomendación» o quedar en «esperar cotización»; nunca se propone comprar con él.
    let priceFallback=false;
    if(!(priceEur>0)){
      const cm=committed.find(c=>c.key===goalStockKey(r.s)),fx=num(metrics.fxUsdEur);
      const last=String(r.s.currency||"").toUpperCase()==="USD"&&num(r.s.price)>0&&fx>0?num(r.s.price)*fx:String(r.s.currency||"").toUpperCase()==="EUR"?num(r.s.price):null;
      if(cm&&(last>0||num(cm.priceEur)>0)){priceEur=last>0?last:num(cm.priceEur);priceFallback=true}
    }
    const ticker=String(r.s.ticker||r.s.trTicker||"").toUpperCase();
    const marketTicker=String((preferTr?r.s.trTicker:r.s.ticker)||ticker).toUpperCase();
    const G=window.ViewInvAIGoal;
    const openFadePct=q.quoteRecent===true&&G&&G.openFadePct?G.openFadePct({market:preferTr?"tr":"us",marketStatus:r.s.usLiveMarketStatus,
      price:preferTr?(r.s.trLiveLast??r.s.trLivePrice):r.s.usLivePrice,open:preferTr?r.s.trLiveOpen:r.s.usLiveOpen}):null;
    return priceEur>0?{key:goalStockKey(r.s),ticker,marketTicker,name:r.s.name||"",quoteFresh:priceFallback?false:q.quoteRecent===true,priceFallback,openFadePct,priceEur,askEur:useUs?null:q.unitEur,score:r.score,quality:r.quality,tier:r.speculative?"spec":r.tier,speculative:!!r.speculative,
      atrPct:goalAtrPct(r.s),marketCap:num(r.s.marketCap),sector:String(r.s.sector||""),industry:String(r.s.industry||""),...goalEarningsIn(r.s),feeEur:q.feeEur||portfolioOperationFee(preferTr),aiVerdict:goalAiOf(ticker,goalStockKey(r.s)),stock:r.s,quote:q,
      relVolume:num(r.s.relVolume),rsi:num(r.s.rsi),adx:num(r.s.adx),ema20:num(r.s.ema20),ema50:num(r.s.ema50),technicalPrice:num(r.s.price),avgVolume:num(r.s.avgVolume),
      dayChangePct:useUs&&us.change!==null?us.change:num(entry.dayChange),perfWeek:num(entry.weekPerf),perfMonth:num(r.s.perfMonth),spreadPct:num(q.spreadPct),priceSource:useUs?"us":"lsx",
      extensionPct:num(entry.extensionPct),nearHighPct:num(entry.nearHighPct),
      catalystDays:num(cat.days),catalystImpact:num(cat.impact),
      ...(()=>{const i=goalIdeaOf(ticker,marketTicker);return i?{aiIdeaConfidence:num(i.confidence),aiIdeaThesis:i.thesis+(i.catalyst?" · "+i.catalyst:""),aiIdeaSources:i.sources||[]}:{}})()}:null;
  }).filter(Boolean);
  if(!idle)refreshGoalIdeas();
  // Órdenes puestas en el bróker y aún sin ejecutar: su importe ya no está libre y no se vuelven a proponer.
  const pending=goalPendingOrders(goal),pendingEur=pending.reduce((a,o)=>a+goalPendingOrderEur(o),0);
  // Una orden puesta de un valor que aún no tienes ocupa un hueco de «nº de acciones» hasta que se ejecuta o se cancela.
  const heldNow=new Set([...positions.map(p=>String(p.key)),...lockedKeys.map(String)]),pendingSlots=pending.filter(o=>!heldNow.has(String(o.key))).length;
  const altoOrders=pending.filter(o=>o.sleeve==="alto").reduce((a,o)=>a+goalPendingOrderEur(o),0);
  if(sleeveInput&&sleeveInput.alto)sleeveInput.alto={...sleeveInput.alto,cashEur:Math.max(0,(num(sleeveInput.alto.cashEur)||0)-altoOrders),ordersEur:altoOrders};
  return{config:{target:cfg.target,deadline:goal.target_date?goal.target_date+"T23:59:59Z":"",startValue:num(goal.start_value_eur),startDate:num(goal.start_value_eur)!==null?goal.start_date||goal.created_at:"",
      risk:cfg.riskProfile,maxPositions:num(goal.max_positions)??5,specMode:Math.max(0,Math.min(3,Math.round(num(goal.allow_spec)??1))),allowSpec:Number(goal.allow_spec)!==0,
      investCapEur:num(goal.invest_cap_eur),investCapPct:num(goal.invest_cap_pct),investReserveEur:num(goal.invest_reserve_eur),allowFractions:Number(goal.allow_fractions)!==0},
    positions,candidates:goalMarkNoFractions(candidates,goal),lockedValueEur,lockedHighRiskEur,lockedKeys,lockedHoldings:lockedHoldings+pendingSlots,cashEur:num(metrics.cashEur)||0,reservedCashEur:pendingEur,...(sleeveInput?{sleeves:sleeveInput}:{}),peakValueEur:num(goal.peak_value_eur),wasDefensive:Number(goal.defensive)===1,preferTr,
    extraValueEur:metrics.includeCrypto?metrics.cryptoEur:null,stickyKeys:goalClientStickyKeys(metrics.portfolio&&metrics.portfolio.id,goal),committed,discarded:[...new Set([...goalTodayDiscarded(metrics.portfolio&&metrics.portfolio.id,goal),...pending.map(o=>o.key)])],requireReview:true,
    market:(()=>{try{const p=JSON.parse(goal.plan_json||"{}");return Date.now()-Date.parse(p.at||"")<3600e3?p.market||null:null}catch(_){return null}})()};
}
// Valores que el usuario marcó como «no admite fracciones» en su bróker.
function goalNoFractionSet(goal){return new Set(String(goal&&goal.no_fraction_tickers||"").split(",").map(t=>t.trim().toUpperCase()).filter(Boolean))}
function goalMarkNoFractions(candidates,goal){
  const set=goalNoFractionSet(goal);if(!set.size)return candidates;
  for(const c of candidates)if(set.has(String(c.marketTicker||"").toUpperCase())||set.has(String(c.ticker||"").toUpperCase()))c.noFractions=true;
  return candidates;
}
// Plan del Objetivo para una acción concreta (lo usa la ficha): mismo motor y mismos datos que
// «Hoy toca» de la cartera seleccionada, para que la ficha no muestre un stop distinto.
let goalPlanCache=null;
function goalPlanForStock(stock){
  try{
    const engine=window.ViewInvAIGoal,key=stock?goalStockKey(stock):"";
    if(!engine||!key)return null;
    let c=goalPlanCache;
    if(!c||c.portfolioId!==state.selectedPortfolioId||Date.now()-c.at>20000){
      const metrics=portfolioGoalMetrics(),goal=selectedPortfolioGoal()||state.goal||null;
      c=goalPlanCache={at:Date.now(),portfolioId:state.selectedPortfolioId,plan:null};
      if(!metrics.portfolio||!goal||metrics.target===null||metrics.currentValue===null||!["tr","us"].includes(metrics.marketScope))return null;
      const input=goalEngineInput(metrics,portfolioCoachPositionRows(metrics));
      Object.assign(c,{plan:engine.plan(input),input,portfolioName:metrics.portfolio.name,risk:input.config.risk});
    }
    if(!c.plan)return null;
    // Todos los lotes de la misma acción en la cartera (puede haber varios por bróker o mercado).
    const lots=state.positions.filter(p=>String(p.portfolio_id)===String(c.portfolioId)&&Number(p.active)!==0&&
      (String(p.stock_key||"").toUpperCase()===key||goalStockKey(stockByKey(p.stock_key))===key));
    const heldQty=lots.reduce((s,p)=>s+(num(p.quantity)||0),0),frozenQty=lots.reduce((s,p)=>s+positionFrozenQty(p),0);
    const frozenUntil=lots.filter(p=>positionFrozenQty(p)>0).map(p=>String(p.frozen_until).slice(0,10)).sort()[0]||"";
    const base={portfolioName:c.portfolioName,preferTr:!!c.input.preferTr,frozenQty,frozenUntil};
    if(lots.length&&frozenQty>0&&frozenQty>=heldQty-1e-9)return{...base,kind:"frozen",label:lots[0].ticker||key};
    // Una posición en cartera manda sobre compras o esperas (la clave guardada puede ser el ISIN).
    const pos=c.input.positions.find(p=>p.key===key||goalStockKey(p.row&&p.row.stock)===key);
    if(pos){
      const st=engine.positionStop(pos,c.risk),act=c.plan.actions.find(a=>a.key===pos.key&&(a.type==="SELL"||a.type==="RAISE_STOP"));
      const bid=num(pos.bidEur),price=bid??num(pos.priceEur),stopEur=num(act&&act.stopEur)??num(st.stopEur);
      const held=pos.hold?c.plan.holds.find(h=>h.key===pos.key&&h.holdMode):null;
      return{...base,kind:"position",label:pos.label||pos.ticker,priceEur:price,priceIsBid:bid!==null,stopEur:held?null:stopEur,trailing:!!st.trailing,holdText:held?held.text:"",
        stopDistPct:price>0&&stopEur!==null?(1-stopEur/price)*100:null,action:act?{type:act.type,text:act.text}:null};
    }
    const buy=c.plan.actions.find(a=>a.type==="BUY"&&a.key===key);
    if(buy)return{...base,kind:"buy",label:buy.label,units:buy.units,entryEur:buy.priceEur,stopEur:buy.stopEur,stopPct:buy.stopPct,
      targetPct:buy.targetPct,targetEur:num(buy.priceEur)!==null&&num(buy.targetPct)!==null?buy.priceEur*(1+buy.targetPct/100):null};
    const wait=(c.plan.waits||[]).find(a=>a.key===key);
    if(wait)return{...base,kind:"wait",label:wait.label,decision:wait.decision,limitPriceEur:wait.limitPriceEur,currentPriceEur:wait.currentPriceEur,text:wait.text};
    return null;
  }catch(_){return null}
}
function goalRenewalHtml(plan){
  if(plan.pace.status!=="reached")return "";
  const next=num(plan.nextTargetEur);
  return '<div class="goal2-why" role="note"><b>Meta alcanzada.</b> '+(next!==null?'Siguiente hito editable: '+esc(formatMoney(next,"EUR"))+'. ':'Has llegado al límite actual del importe objetivo. ')+
    'Revisa la meta y el plazo; se conservan tu perfil y los límites de capital. Los stops y las revisiones de las posiciones siguen activos. '+
    '<button type="button" class="btn small" data-goal-wizard'+(next!==null?' data-goal-extend':'')+'>'+(next!==null?'Ampliar objetivo':'Revisar objetivo')+'</button></div>';
}
// Etiqueta del ritmo. Ir «en la trayectoria» no tranquiliza si lo que queda exige más de un 25 % al mes
// (la referencia puede haber empezado hoy): entonces se dice que el objetivo es muy exigente.
function goalPaceLabel(pc){
  const hard=(pc.status==="on"||pc.status==="ahead")&&num(pc.requiredMonthlyPct)!==null&&pc.requiredMonthlyPct>25;
  if(hard)return{label:"Muy exigente",short:"Muy exigente",cls:"warn"};
  return{label:{reached:"Objetivo alcanzado",ahead:"Vas adelantado",on:"En la trayectoria del objetivo",behind:"Vas con retraso",overdue:"La fecha ya pasó",unmeasured:"Sin referencia de ritmo",nodate:"Sin fecha objetivo"}[pc.status]||"",
    short:{reached:"Alcanzado",ahead:"Adelantado",on:"En camino",behind:"Con retraso",overdue:"Fecha pasada"}[pc.status]||"",
    cls:{reached:"ok",ahead:"ok",on:"ok",behind:"warn",overdue:"bad",unmeasured:"",nodate:""}[pc.status]||""};
}
// Una línea: lo invertido frente a la meta, la barra y el estado. El detalle está en «Progreso y ritmo».
function goalPaceMiniHtml(pc,metrics){
  if(!pc)return"";
  const L=goalPaceLabel(pc),progress=Math.max(0,Math.min(100,num(metrics.progress)||0)),shown=metrics.goalValue??metrics.currentValue;
  return '<div class="goal2-mini"><strong>'+formatMoney(shown,"EUR")+'</strong><span>/ '+formatMoney(metrics.target,"EUR")+'</span>'+
    '<div class="goal2-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.round(progress)+'"><i data-goal-progress="'+Math.round(progress)+'"></i></div>'+
    (L.short?'<b class="goal2-pace goal2-pace-'+L.cls+'">'+esc(L.short)+'</b>':'')+'</div>';
}
function goalPaceHtml(pc,metrics){
  if(!pc)return"";
  const {label,cls}=goalPaceLabel(pc);
  const bits=[];
  if(pc.daysLeft!==null&&pc.daysLeft!==undefined&&pc.status!=="reached")bits.push(pc.daysLeft+" días");
  // Con más del 100 % al mes la cifra mensual deja de ser legible: se muestra cuántas veces hay que multiplicar lo invertido.
  const mult=num(metrics.goalValue)>0&&num(metrics.target)>0?metrics.target/metrics.goalValue:null;
  if(pc.requiredMonthlyPct!==null&&pc.requiredMonthlyPct!==undefined&&pc.status!=="reached")bits.push(pc.requiredMonthlyPct>100&&mult!==null&&pc.daysLeft?"hace falta multiplicar ×"+formatNumber(mult,1)+" lo invertido":"hace falta "+formatNumber(pc.requiredMonthlyPct,1)+" % al mes");
  if(pc.expectedEur!==null&&pc.expectedEur!==undefined&&pc.status!=="reached")bits.push("referencia del plan hoy: "+formatMoney(pc.expectedEur,"EUR"));
  if(pc.remainingEur>0)bits.unshift("faltan "+formatMoney(pc.remainingEur,"EUR"));
  if(pc.requiredMonthlyPct!==null&&pc.requiredMonthlyPct!==undefined)bits.push("crecimiento necesario, no rentabilidad prevista");
  const progress=Math.max(0,Math.min(100,num(metrics.progress)||0));
  const shown=metrics.goalValue??metrics.currentValue;
  // El efectivo no cuenta como avance; se indica el que está disponible para el objetivo (sin invertir).
  const goalG=selectedPortfolioGoal()||state.goal,budget=String(goalG&&goalG.goal_cash_mode)==="amount"?num(metrics.budgetCashEur):null;
  if(num(metrics.cashEur)>0)bits.unshift(budget!==null?"sin contar el efectivo ("+formatMoney(budget,"EUR")+" para el objetivo sin invertir)":"sin contar el efectivo ("+formatMoney(metrics.cashEur,"EUR")+")");
  if(metrics.includeCrypto)bits.unshift(metrics.cryptoEur===null?"Mi cripto: esperando cotización":"incluye Mi cripto ("+formatMoney(metrics.cryptoEur,"EUR")+")");
  return '<div class="goal2-progress"><div class="goal2-progress-head"><strong>'+formatMoney(shown,"EUR")+'</strong><span>→ '+formatMoney(metrics.target,"EUR")+'</span>'+
    (label?'<b class="goal2-pace goal2-pace-'+cls+'">'+esc(label)+'</b>':'')+'</div>'+
    '<div class="goal2-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.round(progress)+'"><i data-goal-progress="'+Math.round(progress)+'"></i></div>'+
    (bits.length?'<small class="goal2-pace-bits">'+esc(bits.join(" · "))+'</small>':'')+'</div>';
}
// Enlaza en el texto del plan cada acción citada («CR6 (Wolfspeed, Inc.)») con su ficha completa.
function goalLinkedText(text,links){
  const list=links.filter(l=>l&&l.label&&l.key).sort((x,y)=>String(y.label).length-String(x.label).length);
  let html=esc(text||"");
  list.forEach((l,i)=>{html=html.split(esc(l.label)).join("\u0000"+i+"\u0000")});
  return html.replace(/\u0000(\d+)\u0000/g,(_,i)=>{const l=list[Number(i)];
    return '<button type="button" class="goal2-stock-link" data-open-stock="'+esc(l.key)+'" data-position-prefer-tr="'+(l.preferTr?'1':'0')+'" title="Abrir la ficha">'+esc(l.label)+'</button>'});
}
function goalCandidateLink(ctx,key,label){
  const c=key?ctx.candidates.find(x=>x.key===key):null;
  return c&&label?{label,key:portfolioStockKey(c.stock),preferTr:ctx.preferTr}:null;
}
function goalPositionLink(ctx,key,label){
  const p=key?ctx.positions.find(x=>x.key===key):null;
  return p&&label?{label,key:p.row.p.stock_key,preferTr:p.row.preferTr}:null;
}
// Etiqueta de una espera con su motivo concreto (la decisión interna sigue siendo «COMPRA LÍMITE» / «ESPERAR»).
// Etiqueta de riesgo de la acción (alto / medio / bajo), calculada en el motor por volatilidad, tamaño y sector.
function goalRiskPill(tier){
  // Volatilidad de la acción en sí (no confundir con la hucha de la que sale el dinero).
  const t={alto:"VOLATILIDAD ALTA",medio:"VOLATILIDAD MEDIA",bajo:"VOLATILIDAD BAJA"}[String(tier||"")];
  return t?' <span class="goal2-risk-pill goal2-risk-'+esc(tier)+'" title="Cuánto se mueve la acción. Alta: muy volátil, pequeña o biotecnológica pequeña. Baja: se mueve poco y es grande.">'+t+'</span>':'';
}
// Ideas a 1-3 meses por momento de 6 meses (señal medida en 10 años). Informativas; caché de 1 minuto.
let goalTrendCache={at:0,key:"",list:[]};
function goalTrendHtml(ctx,preferTr,heldKeys){
  const list=goalTrendList(preferTr,heldKeys);if(!list.length)return'';
  return goalTrendListHtml(list,preferTr);
}
// noHigh: para la hucha de riesgo medio, sin las de riesgo alto (esas van a la hucha alta).
function goalTrendList(preferTr,heldKeys,{noHigh=false}={}){
  const G=window.ViewInvAIGoal,all=window.ViewInvAI&&typeof window.ViewInvAI.getAllStocks==="function"?window.ViewInvAI.getAllStocks():[];
  if(!G||typeof G.trendIdeas!=="function"||!all.length)return[];
  const cacheKey=(preferTr?"tr":"us")+(noHigh?"|nohigh":"")+"|"+[...heldKeys].sort().join(",");
  if(goalTrendCache.key!==cacheKey||Date.now()-goalTrendCache.at>60000){
    const rows=[];
    for(const s of all){
      // Solo acciones de EE. UU., el universo medido en la prueba de 10 años; en Trade Republic, además, activas.
      if(!["NASDAQ","NYSE","AMEX","NYSE ARCA","NYSEARCA"].includes(String(s.exchange||"").toUpperCase()))continue;
      if(preferTr&&(s.tradeRepublicTradable===false||s.trActive===false||!(s.tradeRepublicTradable===true||(s.tradeRepublicVerified&&s.trTicker))))continue;
      const price=num(s.price),avgVol=num(s.avgVolume);
      rows.push({key:goalStockKey(s),ticker:String((preferTr?s.trTicker:s.ticker)||s.ticker||"").toUpperCase(),name:s.name||"",price,perf6M:num(s.perf6M),perfMonth:num(s.perfMonth),
        high52w:num(s.high52w),marketCap:num(s.marketCap),atrPct:goalAtrPct(s),tradedUsd:price!==null&&avgVol!==null?price*avgVol:null,sector:s.sector||"",industry:s.industry||"",stock:s});
    }
    const pool=noHigh?rows.filter(r=>G.riskTier(r)!=="alto"):rows;
    goalTrendCache={at:Date.now(),key:cacheKey,list:G.trendIdeas(pool,{limit:5,exclude:[...heldKeys]}).map(t=>({...t,stock:(rows.find(r=>r.key===t.key)||{}).stock}))};
  }
  return goalTrendCache.list;
}
function goalTrendListHtml(list,preferTr){
  return '<details class="goal2-alts goal2-trend" open><summary>Tendencia 1–3 meses · momento de 6 meses</summary><ol>'+list.map(t=>{
    const label=String(t.ticker||"")+(t.name&&t.name!==t.ticker?' ('+t.name+')':''),key=t.stock?portfolioStockKey(t.stock):t.key;
    return '<li>'+goalLinkedText(label,[{label,key,preferTr}])+goalRiskPill(t.riskTier)+' <small>6 meses sin el último: +'+formatNumber(t.momentumPct,1)+' %'+
      (num(t.fromHighPct)!==null?' · a '+formatNumber(Math.abs(t.fromHighPct),1)+' % de su máximo anual':'')+'</small></li>'}).join('')+
    '</ol><small class="goal2-alts-note">Solo acciones de EE. UU. (las medidas). En 10 años de históricos, el 10 % de acciones con más momento de 6 meses batió al S&amp;P 500 en algo más de la mitad de los trimestres, por +1 a +2,6 % de media antes de comisiones. Es una tendencia estadística, no una previsión: puede bajar y no ha pasado la revisión completa del Objetivo.</small></details>';
}
function goalWaitTag(a){
  if(a.decision==="COMPRA LÍMITE")return num(a.limitPriceEur)!==null?"ENTRADA MÁX. "+formatMoney(a.limitPriceEur,"EUR"):"SOLO CON LÍMITE";
  if(a.decision==="EN REVISIÓN")return"EN REVISIÓN";
  const t=String((a.reasons||[]).join(" ")+" "+(a.text||""));
  const ed=t.match(/presenta resultados (hoy|mañana|en \d+ días)/);
  if(ed)return"RESULTADOS "+ed[1].toUpperCase();
  if(/modo defensivo/i.test(t))return"MODO DEFENSIVO";
  if(/no hay cotización en vivo|sin cotización/i.test(t))return"SIN PRECIO EN VIVO";
  if(/IA tiene dudas/i.test(t))return"IA CON DUDAS";
  if(/consenso de analistas|rebaja de analistas/i.test(t))return"ANALISTAS EN CONTRA";
  if(/volatilidad|S&P 500|dato macro/i.test(t))return"MERCADO EN TENSIÓN";
  return"ESPERAR ENTRADA";
}
function goalActionHtml(a,ctx){
  const cand=(a.type==="BUY"||a.type==="WAIT")?ctx.candidates.find(c=>c.key===a.key):null,pos=(a.type!=="BUY"&&a.type!=="WAIT")?ctx.positions.find(p=>p.key===a.key):null;
  const C=window.ViewInvAIContrast;
  // Idea fijada: la etiqueta de IA es la de la revisión hecha ANTES de publicarla; una consulta posterior solo se anota.
  const commit=a.committed?(ctx.committed||[]).find(c=>c.key===String(a.key)):null;
  const later=C&&C.tickerVerdict?C.tickerVerdict(a.ticker,a.key):null;
  const ai=(a.type==="BUY"||a.type==="WAIT")&&C?C.badgeHtml(commit&&commit.reviewVerdict?{verdict:commit.reviewVerdict}:later):"";
  const laterNote=commit&&later&&later.verdict&&later.verdict!==commit.reviewVerdict&&later.verdict!=="contradice"?'<small class="goal2-later-ai">Una consulta posterior a la IA dice «'+esc(later.verdict)+'»; no cambia la idea fijada (solo la retiraría si la contradice).</small>':'';
  const tag={CHANGE:"CAMBIO DE RECOMENDACIÓN",BUY:"CUMPLE TUS REGLAS",WAIT:goalWaitTag(a),SELL:a.reason==="stop"?"STOP":"VENDER",RAISE_STOP:"SUBIR STOP",HOLD:"MANTENER"}[a.type]||a.type;
  let button="";
  if(a.type==="BUY"&&cand){
    const q=cand.quote||{};
    button=goalOperationButtonHtml({side:"BUY",portfolioId:state.selectedPortfolioId,broker:"",stockKey:portfolioStockKey(cand.stock),units:a.units,price:q.price??portfolioConvertAmount(a.priceEur,"EUR",q.currency||(ctx.preferTr?"EUR":"USD"),ctx.fx),fees:q.feeNative??q.feeEur,currency:q.currency||(ctx.preferTr?"EUR":"USD"),preferTr:ctx.preferTr,executable:q.executable===true,executionReason:q.executionReason,riskEur:a.riskEur,dayChangePct:cand.dayChangePct,sleeve:ctx.sleeves?"alto":""});
  }else if(a.type==="SELL"&&pos){
    const row=pos.row,q=goalExecutionQuote(row.stock,row.preferTr,"SELL",ctx.fx,row.p.broker,a.units);
    button=goalOperationButtonHtml({side:"SELL",portfolioId:row.p.portfolio_id,positionId:row.p.id,broker:row.p.broker,stockKey:row.p.stock_key,units:a.units,price:q.price??portfolioConvertAmount(num(pos.bidEur)??num(pos.priceEur),"EUR",q.currency||row.p.currency||"EUR",ctx.fx),fees:q.feeNative??q.feeEur,currency:q.currency||row.p.currency||"EUR",preferTr:row.preferTr,executable:q.executable===true,executionReason:q.executionReason});
  }
  // Tarjeta simple: quién, qué hacer y botones. Todo el detalle (texto completo, riesgo, a favor/en contra, datos)
  // queda detrás de «ⓘ Por qué», cerrado por defecto.
  let note="";
  if(button){const m=button.match(/^<small class="portfolio-goal-execution-blocked"[^>]*>[^<]*<\/small>/);if(m){note='<small class="goal2-why-note">'+m[0].replace(/<[^>]+>/g,"")+': si ya la ejecutaste en tu bróker, regístrala con su precio real.</small>';button=button.slice(m[0].length)}}
  if(button)button=button.replace('class="goal2-decide portfolio-goal-register"','class="goal2-btn goal2-btn-primary portfolio-goal-register"').replace('class="btn ghost compact portfolio-goal-register"','class="goal2-btn goal2-btn-primary portfolio-goal-register"').replace(/>(✓ Ya ejecutada|＋ Registrar estrategia)<\/button>$/,'>'+(a.type==="SELL"?'✓ Vendida':'✓ Comprada')+'</button>');
  if((a.type==="BUY"||a.type==="SELL")&&!button)note+='<small class="goal2-why-note">Esperando una cotización ejecutable para poder registrarla.</small>';
  const btns=[button];
  // Orden límite lanzada en el bróker pero aún sin ejecutar: se aparta su importe y la tarjeta pasa a vigilarla.
  if(a.type==="BUY"&&num(a.limitPriceEur)!==null&&num(a.units)>0)btns.push('<button type="button" class="goal2-btn" data-goal-place-order="'+esc(String(a.key||""))+'" data-ticker="'+esc(String(a.ticker||""))+'" data-name="'+esc(String(a.name||""))+'" data-units="'+esc(String(a.units))+'" data-limit="'+esc(String(a.limitPriceEur))+'" data-fee="'+esc(String(cand&&cand.quote?num(cand.quote.feeEur)||0:0))+'" data-sleeve="'+(ctx.sleeves?'alto':'')+'" title="Ya he puesto la orden límite en mi bróker y aún no se ha ejecutado">Orden puesta</button>');
  if(a.type==="SELL"&&pos)btns.push('<button type="button" class="goal2-btn" data-goal-decide="'+esc(pos.row.p.id)+'" title="Vender ahora o mantener con una condición">Decidir</button>');
  // Toda idea propuesta (compra, idea fijada en espera o cambio de recomendación) se puede descartar: se oculta hoy,
  // su efectivo queda libre y se puede volver a mostrar desde «Descartadas hoy».
  if(a.type==="BUY"||a.type==="CHANGE"||(a.type==="WAIT"&&a.committed))btns.push('<button type="button" class="goal2-btn" data-goal-discard="'+esc(String(a.key||""))+'" data-goal-discard-ticker="'+esc(String(a.ticker||""))+'" data-goal-discard-name="'+esc(String(a.name||""))+'" title="No la voy a comprar: ocultarla hoy y liberar su efectivo">Descartar</button>');
  const whyKey=String(a.type)+":"+String(a.key||""),open=goalOpenWhy.has(whyKey);
  btns.push('<button type="button" class="goal2-btn goal2-btn-why" data-goal-why="'+esc(whyKey)+'" aria-expanded="'+(open?'true':'false')+'">ⓘ Por qué</button>');
  const fraction=a.type==="BUY"&&a.fractional?'<button type="button" class="goal2-decide" data-goal-no-fraction="'+esc(String(a.ticker||""))+'" title="Pulsa solo si tu bróker no deja comprar una parte de acción de este valor; el plan propondrá acciones enteras">Mi bróker no la fracciona</button>':'';
  const key=(a.type==="BUY"||a.type==="WAIT")&&cand?portfolioStockKey(cand.stock):pos?pos.row.p.stock_key:a.key;
  const preferTr=(a.type==="BUY"||a.type==="WAIT")?ctx.preferTr:pos?pos.row.preferTr:ctx.preferTr;
  const fixedAt=a.committed&&a.committedAt?new Date(a.committedAt):null;
  const fixedNote=a.type==="BUY"&&a.committed?'<small class="goal2-fixed">📌 Idea fijada hoy'+(fixedAt&&Number.isFinite(fixedAt.getTime())?' a las '+fixedAt.toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"}):'')+(num(a.committedPriceEur)!==null?' a '+formatMoney(a.committedPriceEur,"EUR"):'')+': no se cambia por otra durante el día; se retira solo si la IA la contradice o el precio sube más de un 3 %.</small>':'';
  // Datos de la revisión del servidor (analistas, BPA, resultados) de la idea fijada; la app no los consulta.
  const f=(commit&&commit.facts)||a.facts||{},factBits=[];
  const pros=commit&&(commit.pros||[]).length?commit.pros:(a.pros||[]);
  // La comisión depende del importe de hoy: se toma siempre del plan en vivo, no de la revisión guardada al fijar la idea.
  const isFee=t=>/^(comisión|coste) de ida y vuelta/.test(String(t));
  const cons=commit&&(commit.cons||[]).length?[...commit.cons.filter(t=>!isFee(t)),...(a.cons||[]).filter(isFee)]:(a.cons||[]);
  if(a.type==="BUY"){
    if(f.earningsDate)factBits.push("Resultados "+f.earningsDate);
    if(f.analystConsensus)factBits.push("Analistas: "+({buy:"comprar",hold:"mantener",sell:"vender"}[f.analystConsensus]||f.analystConsensus)+(num(f.analystUpsidePct)!==null?" · objetivo "+(f.analystUpsidePct>0?"+":"")+formatNumber(f.analystUpsidePct,0)+" %":"")+(num(f.analysts)?" ("+formatNumber(f.analysts,0)+")":""));
    if(num(f.epsBeats)!==null)factBits.push("Superó el BPA "+formatNumber(f.epsBeats,0)+" de 4");
    if(f.fundamentalsChecked===false||(f.fundamentalsChecked===true&&!f.analystConsensus&&num(f.epsBeats)===null))factBits.push("sin datos de analistas ni BPA para este valor");
  }
  const riskLine=a.type==="BUY"&&num(a.riskEur)!==null?'<small class="goal2-risk">Si salta el stop perderías ≈ '+formatMoney(a.riskEur,"EUR")+' (−'+formatNumber(a.riskPct,1)+' %, comisiones'+(num(a.spreadPct)?' y horquilla':'')+'). Recorrido previsto +'+formatNumber(a.targetPct,1)+' %'+(num(a.moveRangePct)!==null?' (en 5 sesiones suele moverse ±'+formatNumber(a.moveRangePct,1)+' %)':'')+', no garantizado.</small>':'';
  const prosCons=a.type==="BUY"&&(pros.length||cons.length)?'<div class="goal2-proscons">'+(pros.length?'<small class="goal2-pro">A favor: '+esc(pros.join(" · "))+'</small>':'')+(cons.length?'<small class="goal2-con">En contra: '+esc(cons.join(" · "))+'</small>':'')+'</div>':'';
  const factsLine=factBits.length?'<small class="goal2-facts">'+esc(factBits.join(" · "))+'</small>':'';
  const extra=fixedNote+laterNote+riskLine+prosCons+factsLine+(a.type==="BUY"
    ?'<small>'+((a.burstPhase==="early")?'Fase temprana · ':'')+'score temprano '+formatNumber(a.burstScore,0)+'/100 · recorrido +'+formatNumber(a.targetPct,1)+' % · stop −'+formatNumber(a.stopPct,1)+' %'+(a.speculative?' · especulativa (peso pequeño)':'')+(a.aiScoutReason?' · '+esc(a.aiScoutReason):'')+'</small>'
    :a.type==="WAIT"
      ?'<small>score temprano '+formatNumber(a.burstScore,0)+'/100 · timing '+formatNumber(a.entryTiming,0)+'/100'+(num(a.limitPriceEur)!==null?' · límite máximo '+formatMoney(a.limitPriceEur,"EUR"):'')+'</small>'
      :'');
  // Cantidad tal cual (las fracciones no se redondean) y, en compras, el límite máximo de la orden siempre a la vista.
  const qty=u=>{const v=num(u)||0;return esc(Math.abs(v-Math.round(v))>1e-9?v.toLocaleString("es-ES",{maximumFractionDigits:6}):formatNumber(v,0))+(v===1?' acción':' acciones')};
  // Un solo precio a la vista: el límite que se pone en la orden. El importe es el máximo que pagarías (acciones ×
  // límite); antes salía el importe al precio de referencia y, con 1 acción, parecía otro precio.
  const lim=num(a.limitPriceEur),limit=lim!==null?' · límite <b>'+esc(formatMoney(lim,"EUR"))+'</b>'+(a.fractional?' si tu bróker lo permite':''):'';
  const what=a.type==="BUY"?(a.fractional?'Comprar '+esc(formatMoney(a.ticketEur,"EUR"))+' (fracción)'+limit:'Comprar '+qty(a.units)+limit+(lim!==null&&num(a.units)>1?' · total máx. '+esc(formatMoney(a.units*lim,"EUR")):lim===null?' · '+esc(formatMoney(a.ticketEur,"EUR")):''))
    :a.type==="WAIT"?esc(tag.charAt(0)+tag.slice(1).toLowerCase())
    :a.type==="SELL"?(a.reason==="stop"?'Saltó el stop: vender ':'Vender ')+qty(a.units)
    :a.type==="RAISE_STOP"&&num(a.stopEur)!==null?'Subir el stop a '+esc(formatMoney(a.stopEur,"EUR"))
    :a.type==="CHANGE"?'Cambio de recomendación: ya no cumple tus reglas'
    :esc(tag.charAt(0)+tag.slice(1).toLowerCase());
  const nm=String(a.name||a.ticker||""),initials=nm.replace(/[^\p{L}\p{N} ]/gu,"").split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase()||"·";
  // Límite por debajo del precio de compra inmediata (horquilla amplia): se avisa de que puede tardar en ejecutarse.
  let spreadNote="";
  if(a.type==="BUY"&&cand&&cand.quote){
    const q=cand.quote,askE=portfolioPriceToEur(num(q.ask),q.currency||"EUR",ctx.fx),bidE=portfolioPriceToEur(num(q.bid),q.currency||"EUR",ctx.fx);
    // Precio en vivo de este momento (la tarjeta se recalcula con cada cotización).
    const age=num(q.ageMs),ageText=age===null?'':age<60000?'hace '+Math.max(1,Math.round(age/1000))+' s':'hace '+Math.round(age/60000)+' min';
    spreadNote+=askE!==null?'<small class="goal2-live'+(q.quoteFresh?'':' stale')+'"><i aria-hidden="true"></i>'+(q.quoteFresh?'En vivo':'Sin precio en vivo')+' · compra '+esc(formatMoney(askE,"EUR"))+(bidE!==null?' · venta '+esc(formatMoney(bidE,"EUR")):'')+(ageText?' · '+esc(ageText):'')+'</small>':'';
    if(askE!==null&&num(a.limitPriceEur)!==null&&a.limitPriceEur<askE-1e-9)spreadNote+='<small class="goal2-spread-note">Horquilla '+esc(bidE!==null?formatMoney(bidE,"EUR")+' – ':'')+esc(formatMoney(askE,"EUR"))+': el límite queda por debajo del precio de compra y puede tardar en ejecutarse. No lo subas por encima del límite.</small>';
  }
  const why='<div class="goal2-why-body"'+(open?'':' hidden')+'><span class="goal2-why-text">'+goalLinkedText(a.text,[{label:a.label,key,preferTr},goalCandidateLink(ctx,a.intoKey,a.intoLabel)])+'</span>'+note+extra+fraction+'</div>';
  return '<div class="goal2-action goal2-'+esc(a.type.toLowerCase())+(a.reason==="stop"?' goal2-stop':'')+'" data-open-stock="'+esc(key)+'" data-position-prefer-tr="'+(preferTr?'1':'0')+'" role="button" tabindex="0">'+
    '<div class="goal2-action-top"><span class="goal2-logo" aria-hidden="true">'+esc(initials)+'</span><div class="goal2-action-main"><strong>'+esc(nm)+'</strong><span class="goal2-action-what">'+what+'</span></div>'+
    '<span class="goal2-action-side">'+goalRiskPill(a.riskTier)+ai+'</span></div>'+
    spreadNote+'<div class="goal2-action-buttons">'+btns.filter(Boolean).join('')+'</div>'+why+'</div>';
}
function goalPlanHistorySnapshot(metrics,plan){
  const portfolio=metrics.portfolio;if(!portfolio||metrics.target===null)return null;
  const sells=plan.actions.filter(a=>a.type==="SELL").map(a=>({ticker:a.ticker,name:a.name,units:a.units,price:goalHistoryRound(a.priceEur,4),currency:"EUR",instruction:a.reason==="stop"?"Stop alcanzado":a.reason==="rotation"?"Sustitución por "+(a.into||""):a.reason==="news"?"Noticia que invalida la operación":"Asegurar beneficio"}));
  const buys=plan.actions.filter(a=>a.type==="BUY").map((a,i)=>({rank:i+1,ticker:a.ticker,name:a.name,units:a.units,price:goalHistoryRound(a.priceEur,4),currency:"EUR",allocationEur:goalHistoryRound(a.ticketEur,2),stop:goalHistoryRound(a.stopEur,4),instruction:"Comprar ahora · stop "+a.stopEur}));
  const waits=(plan.waits||[]).map((a,i)=>({rank:i+1,ticker:a.ticker,name:a.name,decision:a.decision||"ESPERAR",limitPrice:goalHistoryRound(a.limitPriceEur,4),currentPrice:goalHistoryRound(a.currentPriceEur,4),instruction:a.text}));
  const all=[...plan.actions,...(plan.waits||[])];
  const summary=all.length?all.map(a=>a.text).join(" "):"Sin cambios";
  return{portfolioId:portfolio.id,signature:JSON.stringify(all.map(a=>[a.type,a.ticker,a.fractional?"frac":(a.units||a.stopEur||a.limitPriceEur||a.decision)])),summary,
    plan:{portfolioId:portfolio.id,portfolioName:portfolio.name,marketScope:metrics.marketScope,riskProfile:plan.band&&plan.band.risk,currentValueEur:goalHistoryRound(metrics.goalValue,2),
      targetEur:goalHistoryRound(metrics.target,2),cashEur:goalHistoryRound(metrics.cashEur,2),remainingEur:goalHistoryRound(metrics.remaining,2),sells,buys,waits,residualEur:goalHistoryRound(plan.cashLeftEur,2)}};
}
// El usuario indica que su bróker no permite fracciones de un valor: se guarda en el objetivo y se recalcula.
async function goalMarkNoFraction(ticker){
  const goal=selectedPortfolioGoal()||state.goal,portfolioId=state.selectedPortfolioId;
  if(!goal||!portfolioId||!ticker)return;
  try{
    const response=await api("/api/portfolio-goal",{method:"PATCH",body:JSON.stringify({portfolioId,targetValueEur:num(goal.target_value_eur),noFractionTicker:ticker})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"No se pudo guardar.");
    if(data.goal){state.goals[String(portfolioId)]=data.goal;state.goal=data.goal}
    goalPlanCache=null;renderGoalApp();toast(ticker+": el plan solo propondrá acciones enteras.");
  }catch(error){toast(error.message||"No se pudo guardar.",true)}
}
document.addEventListener("click",event=>{
  const b=event.target.closest&&event.target.closest("[data-goal-no-fraction]");if(!b)return;
  event.preventDefault();event.stopPropagation();b.disabled=true;goalMarkNoFraction(b.dataset.goalNoFraction);
});
// Idea nueva que dejó de cumplir las reglas sin haberse ejecutado: se descarta hoy y su efectivo vuelve al objetivo.
async function goalDiscardIdea(key,ticker,name){
  const goal=selectedPortfolioGoal()||state.goal,portfolioId=state.selectedPortfolioId;
  if(!goal||!portfolioId||!key)return;
  const store=goalIdeaStore(),pid=String(portfolioId),day=goalIdeaDay(),cur=store[pid]&&store[pid].day===day?store[pid]:{day,items:[],consumed:[]};
  cur.discarded=[...new Set([...(cur.discarded||[]),String(key)])];cur.items=(cur.items||[]).filter(i=>i.key!==String(key));
  // Nombre para la lista «Descartadas hoy» (el servidor solo guarda la clave).
  cur.discardedInfo={...(cur.discardedInfo||{}),[String(key)]:{ticker:String(ticker||""),name:String(name||"")}};
  store[pid]=cur;try{localStorage.setItem(GOAL_IDEAS_KEY,JSON.stringify(store))}catch(_){}
  try{
    const response=await api("/api/portfolio-goal",{method:"PATCH",body:JSON.stringify({portfolioId,discardIdea:String(key)})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"No se pudo guardar en el servidor.");
    if(data.goal){state.goals[String(portfolioId)]=data.goal;state.goal=data.goal}
    toast((ticker||"Idea")+" descartada hoy: su efectivo queda libre. Puedes volver a mostrarla en «Descartadas hoy».");
  }catch(error){toast((error.message||"No se pudo guardar en el servidor.")+" Queda descartada en este dispositivo.",true)}
  goalPlanCache=null;renderGoalApp();
}
// Volver a mostrar una idea descartada: el plan la propone otra vez si sigue cumpliendo tus reglas.
async function goalRestoreIdea(key,ticker){
  const portfolioId=state.selectedPortfolioId;if(!portfolioId||!key)return;
  const store=goalIdeaStore(),pid=String(portfolioId),cur=store[pid];
  if(cur){cur.discarded=(cur.discarded||[]).filter(k=>k!==String(key));if(cur.discardedInfo)delete cur.discardedInfo[String(key)];try{localStorage.setItem(GOAL_IDEAS_KEY,JSON.stringify(store))}catch(_){}}
  try{
    const response=await api("/api/portfolio-goal",{method:"PATCH",body:JSON.stringify({portfolioId,restoreIdea:String(key)})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"No se pudo guardar en el servidor.");
    if(data.goal){state.goals[String(portfolioId)]=data.goal;state.goal=data.goal}
    toast((ticker||"Idea")+" vuelve al plan: se propondrá si sigue cumpliendo tus reglas.");
  }catch(error){toast(error.message||"No se pudo guardar en el servidor.",true)}
  goalPlanCache=null;renderGoalApp();
}
// Órdenes límite puestas en el bróker y pendientes de ejecutar (servidor).
function goalPendingOrders(goal){
  // Se conservan hasta que las canceles o se ejecuten: la app no sabe cuándo caduca una orden en tu bróker.
  try{const list=JSON.parse(goal&&goal.pending_orders||"[]");
    return Array.isArray(list)?list.filter(o=>o&&o.key&&num(o.units)>0&&num(o.limitEur)>0):[]}catch(_){return[]}
}
function goalPendingOrderEur(o){return (num(o.units)||0)*(num(o.limitEur)||0)+(num(o.feeEur)||0)}
async function goalPendingPatch(body,okText){
  const portfolioId=state.selectedPortfolioId;if(!portfolioId)return;
  try{
    const response=await api("/api/portfolio-goal",{method:"PATCH",body:JSON.stringify({portfolioId,...body})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"No se pudo guardar en el servidor.");
    if(data.goal){state.goals[String(portfolioId)]=data.goal;state.goal=data.goal}
    if(okText)toast(okText);
  }catch(error){toast(error.message||"No se pudo guardar en el servidor.",true)}
  goalPlanCache=null;renderGoalApp();
}
// Tarjeta de una orden puesta: cuánto, a qué límite y, con el precio en vivo, si ya puede haberse ejecutado
// (una compra límite se ejecuta al precio de compra —ASK— en cuanto este llega a tu límite o por debajo).
function goalPendingOrderHtml(o,ctx){
  const s=stockByKey(o.key),preferTr=!!ctx.preferTr;
  const q=s?goalExecutionQuote(s,preferTr,"BUY",ctx.fx,"",o.units):null,askE=q?portfolioPriceToEur(num(q.ask),q.currency||"EUR",ctx.fx):null;
  const mins=Math.max(0,Math.round((Date.now()-Date.parse(o.at||""))/60000)),ago=mins<60?'hace '+mins+' min':mins<1440?'hace '+Math.round(mins/60)+' h':'hace '+Math.round(mins/1440)+' d';
  // Se compara en la divisa de la orden (un cambio de divisa no puede «ejecutar» una orden en dólares).
  const askN=q?num(q.ask):null,limN=num(o.limitNative)??o.limitEur,reached=askN!==null&&(o.currency&&q&&String(q.currency||"").toUpperCase()===String(o.currency).toUpperCase()?askN<=limN+1e-9:askE!==null&&askE<=o.limitEur+1e-9);
  const days=(Date.now()-Date.parse(o.at||""))/86400e3,stale=days>7?'<small class="goal2-order-status">Lleva más de 7 días: si tu orden caducó en el bróker, cancélala aquí.</small>':'';
  const live=askE===null?'<small class="goal2-order-status">Sin precio de compra en vivo ahora: compruébala en tu bróker.</small>'
    :reached?'<small class="goal2-order-status ok">Nuestro precio de compra ('+esc(formatMoney(askE,"EUR"))+') ha llegado a tu límite. Tu bróker usa su «mejor precio», que puede ser distinto: ¿se ha ejecutado allí? Si es así, pulsa «✓ Ejecutada».</small>'
    :o.reachedAt?'<small class="goal2-order-status ok">El '+esc(new Date(o.reachedAt).toLocaleString("es-ES",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}))+' nuestro precio de compra llegó a tu límite (ahora '+esc(formatMoney(askE,"EUR"))+'). ¿Se llegó a ejecutar en tu bróker? Si es así, pulsa «✓ Ejecutada».</small>'
    :'<small class="goal2-order-status">Precio de compra ahora '+esc(formatMoney(askE,"EUR"))+' (+'+esc(formatNumber((askE/o.limitEur-1)*100,1))+' % sobre tu límite): aún no se ejecuta. Te preguntaré cuando llegue.</small>';
  const currency=q&&q.currency||(preferTr?"EUR":"USD"),price=portfolioConvertAmount(o.limitEur,"EUR",currency,ctx.fx)??o.limitEur;
  let reg=s?goalOperationButtonHtml({side:"BUY",portfolioId:state.selectedPortfolioId,broker:"",stockKey:portfolioStockKey(s),units:o.units,price,fees:num(o.feeEur)||0,currency,preferTr,executable:true,sleeve:o.sleeve||""}):'';
  reg=reg.replace(/class="[^"]*portfolio-goal-register"/,'class="goal2-btn goal2-btn-primary portfolio-goal-register"').replace(/>[^<]*<\/button>$/,'>✓ Ejecutada</button>');
  const nm=String(o.name||o.ticker||o.key),initials=nm.replace(/[^\p{L}\p{N} ]/gu,"").split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase()||"·";
  const qty=Math.abs(o.units-Math.round(o.units))>1e-9?o.units.toLocaleString("es-ES",{maximumFractionDigits:6}):formatNumber(o.units,0);
  return '<div class="goal2-action goal2-order" data-open-stock="'+esc(s?portfolioStockKey(s):o.key)+'" data-position-prefer-tr="'+(preferTr?'1':'0')+'" role="button" tabindex="0">'+
    '<div class="goal2-action-top"><span class="goal2-logo" aria-hidden="true">'+esc(initials)+'</span><div class="goal2-action-main"><strong>'+esc(nm)+'</strong>'+
    '<span class="goal2-action-what">Orden puesta · '+esc(qty)+(Number(o.units)===1?' acción':' acciones')+' · límite <b>'+esc(num(o.limitNative)!==null&&o.currency&&o.currency!=="EUR"?formatMoney(o.limitNative,o.currency)+' (≈ '+formatMoney(o.limitEur,"EUR")+')':formatMoney(o.limitEur,"EUR"))+'</b></span></div>'+
    '<span class="goal2-action-side"><span class="goal2-order-pill">'+esc(ago)+'</span></span></div>'+live+stale+
    '<div class="goal2-action-buttons">'+reg+'<button type="button" class="goal2-btn" data-goal-cancel-order="'+esc(o.key)+'" data-goal-order-ticker="'+esc(o.ticker||nm)+'">Cancelar orden</button></div></div>';
}
// «Orden puesta»: a qué precio límite y cuántas acciones pusiste la orden en tu bróker. Su importe se aparta; cuando
// nuestro precio llegue al límite se pregunta si se ejecutó (la compra solo se registra con la confirmación del usuario).
function openGoalOrderModal(d){
  const s=stockByKey(d.goalPlaceOrder),preferTr=lastGoalCtx?!!lastGoalCtx.preferTr:true,fx=lastGoalCtx?lastGoalCtx.fx:null;
  if(!s)return toast("No se encuentra el valor de esta orden.",true);
  const q=goalExecutionQuote(s,preferTr,"BUY",fx,"",num(d.units)||1),currency=String(q.currency||(preferTr?"EUR":"USD")).toUpperCase();
  const limitNative=portfolioConvertAmount(num(d.limit),"EUR",currency,fx)??num(d.limit),dec=Math.abs(limitNative)<10?3:2;
  openModal("Orden puesta · "+(d.ticker||s.ticker||""),
    '<form id="goalOrderForm" class="portfolio-form" data-key="'+esc(d.goalPlaceOrder)+'" data-ticker="'+esc(d.ticker||"")+'" data-name="'+esc(d.name||"")+'" data-sleeve="'+esc(d.sleeve||"")+'" data-currency="'+esc(currency)+'">'+
      '<p class="portfolio-form-note">Pon los datos de la orden que lanzaste en tu bróker. Su importe queda apartado. Cuando nuestro precio de compra llegue a tu límite te avisaré; como tu bróker usa su «mejor precio», confirma tú si se ejecutó con «✓ Ejecutada» (pondrás la hora y el precio reales).</p>'+
      '<div class="portfolio-form-grid">'+
        '<label><span>Precio límite ('+esc(currency)+')</span><input name="limit" type="number" inputmode="decimal" step="any" min="0" value="'+esc(String(Number(limitNative.toFixed(dec))))+'" required></label>'+
        '<label><span>Acciones</span><input name="units" type="number" inputmode="decimal" step="any" min="0.000001" value="'+esc(String(num(d.units)||""))+'" required></label>'+
      '</div>'+
      (num(q.ask)!==null?'<small class="broker-fee-hint">Ahora: compra '+esc(formatMoney(q.ask,currency))+(num(q.bid)!==null?' · venta '+esc(formatMoney(q.bid,currency)):'')+'</small>':'')+
      '<button type="submit" class="btn">Guardar orden</button></form>');
}
document.addEventListener("submit",event=>{
  const f=event.target;if(!f||f.id!=="goalOrderForm")return;
  event.preventDefault();
  const d=f.dataset,s=stockByKey(d.key),preferTr=lastGoalCtx?!!lastGoalCtx.preferTr:true,fx=lastGoalCtx?lastGoalCtx.fx:null;
  const limitNative=num(f.elements.limit.value),units=num(f.elements.units.value);
  if(!s||!(limitNative>0)||!(units>0))return toast("Revisa el precio límite y las acciones.",true);
  const limitEur=portfolioPriceToEur(limitNative,d.currency,fx);if(!(limitEur>0))return toast("Falta el cambio de divisa para guardar la orden.",true);
  const portfolio=selectedPortfolio(),broker=brokerDefaultName(portfolio,preferTr),exchange=preferTr?(s.trExchange||"LSX"):(s.exchange||"");
  const fee=brokerFeeInCurrency(broker,units,limitNative,d.currency,"BUY",exchange).fee;
  goalPendingPatch({pendingOrder:{key:d.key,ticker:d.ticker,name:d.name,units,limitEur,feeEur:portfolioConvertAmount(num(fee)||0,d.currency,"EUR",fx)||0,sleeve:d.sleeve||"",
    stockKey:portfolioStockKey(s),txTicker:(preferTr&&s.trTicker)||s.ticker||d.ticker,exchange,isin:preferTr?(s.trIsin||s.isin||""):(s.usIsin||s.isin||""),preferTr:preferTr?1:0,currency:d.currency,limitNative,broker}},
    (d.ticker||"Orden")+": orden guardada. Su importe queda apartado; cuando se ejecute en tu bróker, pulsa «✓ Ejecutada».");
  closeModal();
});
// «✓ Ejecutada» de una orden puesta (lo confirma el usuario): se registra la compra al límite en el servidor
// (idempotente: una segunda pulsación no la duplica).
const goalFillingOrders=new Set();
async function goalAutoFillOrder(o){
  const id=o.key+"|"+o.at;if(goalFillingOrders.has(id))return;goalFillingOrders.add(id);
  try{
    const response=await api("/api/portfolio-goal",{method:"PATCH",body:JSON.stringify({portfolioId:state.selectedPortfolioId,fillOrder:o.key,fxUsdEur:lastGoalCtx?num(lastGoalCtx.fx):null})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"No se pudo registrar la compra.");
    if(data.goal){state.goals[String(state.selectedPortfolioId)]=data.goal;state.goal=data.goal}
    if(data.filled){await loadAll();goalAutoFillCache.at=0;toast((o.ticker||"Orden")+": compra registrada a tu límite ("+formatMoney(o.limitEur,"EUR")+"). Si tu bróker te dio otro precio, corrígelo en la operación.")}
  }catch(error){goalFillingOrders.delete(id);toast((error.message||"No se pudo registrar la compra.")+" Regístrala con «✓ Ejecutada».",true)}
  goalPlanCache=null;renderGoalApp();
}
// Compras que versiones anteriores registraron solas al llegar el precio al límite: se pueden deshacer si la orden
// no se ejecutó en el bróker (se borra la compra, vuelve el efectivo y la orden queda puesta otra vez).
const goalAutoFillCache={at:0,pid:"",rows:[],loading:false};
function goalAutoFillRows(portfolioId){
  const pid=String(portfolioId||"");
  if(!goalAutoFillCache.loading&&(goalAutoFillCache.pid!==pid||Date.now()-goalAutoFillCache.at>60000)){
    goalAutoFillCache.loading=true;
    api("/api/transactions?portfolioId="+encodeURIComponent(pid)+"&limit=60").then(r=>r.ok?r.json():null).then(d=>{
      const since=Date.now()-7*86400e3;
      const before=goalAutoFillCache.pid===pid?goalAutoFillCache.rows.map(t=>t.id).join(","):"";
      Object.assign(goalAutoFillCache,{at:Date.now(),pid,loading:false,rows:((d&&d.transactions)||[]).filter(t=>t.origin==="goal-order"&&t.side==="BUY"&&Date.parse(t.executed_at||"")>since)});
      if(goalAutoFillCache.rows.map(t=>t.id).join(",")!==before&&state.primaryTab==="goal")renderGoalApp();
    }).catch(()=>{goalAutoFillCache.loading=false;goalAutoFillCache.at=Date.now()});
  }
  return goalAutoFillCache.pid===pid?goalAutoFillCache.rows:[];
}
function goalAutoFillsHtml(portfolioId,ctx){
  const rows=goalAutoFillRows(portfolioId);if(!rows.length)return'';
  return '<div class="goal2-orders"><small class="goal2-orders-title">Compras registradas por una orden</small>'+rows.map(t=>{
    const s=stockByKey(t.stock_key),key=s?goalStockKey(s):t.stock_key,limitEur=String(t.currency||"EUR").toUpperCase()==="EUR"?num(t.price):portfolioPriceToEur(num(t.price),t.currency,ctx.fx);
    return '<div class="goal2-action goal2-order"><div class="goal2-action-top"><div class="goal2-action-main"><strong>'+esc(t.name||t.ticker)+'</strong>'+
      '<span class="goal2-action-what">Compra de '+esc(formatNumber(num(t.quantity),num(t.quantity)%1?4:0))+' a '+esc(formatMoney(num(t.price),t.currency||"EUR"))+'</span></div></div>'+
      '<small class="goal2-order-status">Registrada al llegar nuestro precio a tu límite. Si en tu bróker la orden sigue abierta, deshazla: se borra la compra, vuelve el efectivo y la orden queda puesta.</small>'+
      '<div class="goal2-action-buttons"><button type="button" class="goal2-btn" data-goal-undo-fill="'+esc(t.id)+'" data-key="'+esc(key)+'" data-limit="'+esc(String(limitEur??""))+'" data-ticker="'+esc(t.ticker||"")+'">No se ejecutó: deshacer</button></div></div>';
  }).join('')+'</div>';
}
async function goalUndoFill(txId,key,limitEur,ticker){
  try{
    const response=await api("/api/portfolio-goal",{method:"PATCH",body:JSON.stringify({portfolioId:state.selectedPortfolioId,undoFill:txId,order:{key,limitEur}})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"No se pudo deshacer.");
    if(data.goal){state.goals[String(state.selectedPortfolioId)]=data.goal;state.goal=data.goal}
    goalAutoFillCache.rows=goalAutoFillCache.rows.filter(t=>t.id!==txId);goalAutoFillCache.at=0;await loadAll();
    toast((ticker||"Compra")+": compra deshecha. El efectivo ha vuelto y la orden queda puesta.");
  }catch(error){toast(error.message||"No se pudo deshacer.",true)}
  goalPlanCache=null;renderGoalApp();
}
function goalDiscardedTodayHtml(portfolioId,goal,ctx){
  const keys=goalTodayDiscarded(portfolioId,goal);if(!keys.length)return'';
  const entry=goalIdeaStore()[String(portfolioId||"")],info=(entry&&entry.day===goalIdeaDay()&&entry.discardedInfo)||{};
  const items=keys.map(k=>{
    const c=(ctx.candidates||[]).find(x=>x.key===k),i=info[k]||{},st=stockByKey(k),label=(c&&c.stock&&c.stock.name)||i.name||(st&&st.name)||i.ticker||(c&&c.ticker)||(st&&(st.trTicker||st.ticker))||k.split(":").pop();
    return '<li><span>'+esc(label)+'</span><button type="button" class="goal2-decide" data-goal-restore="'+esc(k)+'" data-goal-restore-ticker="'+esc(i.ticker||label)+'">Volver a mostrar</button></li>';
  }).join('');
  return goalFoldHtml("discarded","Descartadas hoy",String(keys.length),'<ul class="goal2-discarded">'+items+'</ul><small class="goal2-alts-note">Mañana el plan puede volver a proponerlas.</small>');
}
document.addEventListener("click",event=>{
  const po=event.target.closest&&event.target.closest("[data-goal-place-order]");
  if(po){event.preventDefault();event.stopPropagation();openGoalOrderModal(po.dataset);return}
  const cf=event.target.closest&&event.target.closest("[data-goal-confirm-fill]");
  if(cf){event.preventDefault();event.stopPropagation();const o=goalPendingOrders(selectedPortfolioGoal()).find(x=>x.key===cf.dataset.goalConfirmFill);if(o){cf.disabled=true;goalAutoFillOrder(o)}return}
  const uf=event.target.closest&&event.target.closest("[data-goal-undo-fill]");
  if(uf){event.preventDefault();event.stopPropagation();uf.disabled=true;goalUndoFill(uf.dataset.goalUndoFill,uf.dataset.key,num(uf.dataset.limit),uf.dataset.ticker);return}
  const co=event.target.closest&&event.target.closest("[data-goal-cancel-order]");
  if(co){event.preventDefault();event.stopPropagation();co.disabled=true;goalPendingPatch({cancelOrder:co.dataset.goalCancelOrder},(co.dataset.goalOrderTicker||"Orden")+": orden cancelada; su efectivo vuelve a estar libre.");return}
  const r=event.target.closest&&event.target.closest("[data-goal-restore]");
  if(r){event.preventDefault();event.stopPropagation();r.disabled=true;goalRestoreIdea(r.dataset.goalRestore,r.dataset.goalRestoreTicker);return}
  const b=event.target.closest&&event.target.closest("[data-goal-discard]");if(!b)return;
  event.preventDefault();event.stopPropagation();
  b.disabled=true;goalDiscardIdea(b.dataset.goalDiscard,b.dataset.goalDiscardTicker,b.dataset.goalDiscardName);
});
// «ⓘ Por qué» de cada idea y desplegables del Objetivo: se recuerdan abiertos entre repintados (el plan se recalcula solo).
const goalOpenWhy=new Set(),goalOpenFolds=new Set();
function goalFoldHtml(id,title,hint,body){
  if(!body)return'';
  return '<details class="goal2-fold" data-goal-fold="'+esc(id)+'"'+(goalOpenFolds.has(id)?' open':'')+'><summary><span class="goal2-fold-title">'+esc(title)+'</span>'+(hint?'<span class="goal2-fold-hint">'+hint+'</span>':'')+'</summary><div class="goal2-fold-body">'+body+'</div></details>';
}
document.addEventListener("toggle",event=>{
  const d=event.target;if(!d||!d.dataset||!d.dataset.goalFold)return;
  if(d.open)goalOpenFolds.add(d.dataset.goalFold);else goalOpenFolds.delete(d.dataset.goalFold);
},true);
document.addEventListener("click",event=>{
  const b=event.target.closest&&event.target.closest("[data-goal-why]");if(!b)return;
  event.preventDefault();event.stopPropagation();
  const k=b.dataset.goalWhy,box=b.closest(".goal2-action")&&b.closest(".goal2-action").querySelector(".goal2-why-body");
  if(goalOpenWhy.has(k))goalOpenWhy.delete(k);else goalOpenWhy.add(k);
  if(box)box.hidden=!goalOpenWhy.has(k);b.setAttribute("aria-expanded",goalOpenWhy.has(k)?"true":"false");
});
// Por qué el plan no propone comprar (efectivo, modo defensivo, cartera llena, filtros o momento de entrada).
// Marcador de las ideas del Objetivo (servidor, caché de 10 min): cuántas se publicaron y cómo fueron frente al SPY.
let goalScoreboard={at:0,data:null,loading:false};
function goalScoreboardHtml(){
  if(!goalScoreboard.loading&&Date.now()-goalScoreboard.at>10*60000){
    goalScoreboard.loading=true;
    fetch("/api/goal-scoreboard",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>{goalScoreboard={at:Date.now(),data:d,loading:false};const box=document.querySelector("[data-goal-scoreboard]");if(box)box.outerHTML=goalScoreboardHtml()})
      .catch(()=>{goalScoreboard={at:Date.now(),data:null,loading:false}});
  }
  const d=goalScoreboard.data,s5=d&&d.stats&&d.stats.all&&d.stats.all["5d"],s1=d&&d.stats&&d.stats.all&&d.stats.all["1d"];
  const n=num(d&&d.signals)||0;
  const body=!d?'<small>Cargando el historial…</small>':!n?'<small>Aún no hay ideas medidas. Cada idea publicada se guarda y se mide a 1, 5 y 20 sesiones frente al S&P 500.</small>':
    '<small>'+formatNumber(n,0)+(n===1?' idea':' ideas')+' desde '+esc(d.since||"")+'.'+
      (s1&&s1.n?' A 1 sesión: '+formatNumber(s1.hitRate,0)+' % en positivo, media '+(s1.avgReturn>0?'+':'')+formatNumber(s1.avgReturn,1)+' %.':'')+
      (s5&&s5.n?' A 5 sesiones: '+formatNumber(s5.hitRate,0)+' % en positivo, media '+(s5.avgReturn>0?'+':'')+formatNumber(s5.avgReturn,1)+' %'+(s5.avgExcess!==null&&s5.avgExcess!==undefined?' ('+(s5.avgExcess>0?'+':'')+formatNumber(s5.avgExcess,1)+' % frente al S&P 500)':'')+'.':'')+
      (n<30?' Todavía son pocas para sacar conclusiones.':'')+' Sin comisiones; el pasado no garantiza nada.</small>';
  return '<section class="goal2-section goal2-scoreboard" data-goal-scoreboard>'+body+'</section>';
}
// El plan revisado por el servidor se actualiza solo mientras se mira el Objetivo (cada 2 min; lectura ligera).
setInterval(async()=>{
  try{
    if(document.visibilityState!=="visible"||!state.user||!document.querySelector(".portfolio-goal-view"))return;
    const data=await fetchJson("/api/portfolio-goal");if(!Array.isArray(data&&data.goals))return;
    const sel=String(state.selectedPortfolioId||""),before=(state.goals[sel]||{}).plan_json||"";
    state.goals=Object.fromEntries(data.goals.map(g=>[String(g.portfolio_id),g]));
    if(((state.goals[sel]||{}).plan_json||"")!==before)renderGoalApp();
  }catch(_){}
},120000);
// Otras opciones que pasan tus filtros, por puntuación y con su estado. Solo información: no son ideas publicadas.
function goalAlternativesHtml(plan,ctx,shown){
  // Sin repetir lo que ya aparece en «Hoy toca» (también las esperas del servidor).
  const list=((plan&&plan.alternatives)||[]).filter(a=>!(shown&&shown.has(String(a.key))));if(!list.length)return'';
  return '<div class="goal2-alts"><ol>'+list.map(a=>{
    const label=String(a.ticker||"")+(a.name&&a.name!==a.ticker?' ('+a.name+')':'');
    return '<li>'+goalLinkedText(label,[goalCandidateLink(ctx,a.key,label)])+goalRiskPill(a.riskTier)+' <small>'+formatNumber(a.burstScore,0)+'/100 · recorrido +'+formatNumber(a.targetPct,1)+' %'+
      (num(a.moveRangePct)!==null?' (suele moverse ±'+formatNumber(a.moveRangePct,1)+' % en 5 sesiones)':'')+' · '+esc(a.status||"")+'</small></li>'}).join('')+
    '</ol><small class="goal2-alts-note">Informativo: no han pasado la revisión completa (cotización real, resultados, analistas, noticias e IA) y por eso no tienen botón de compra. Las ideas ya revisadas aparecen arriba, en «Hoy toca».</small></div>';
}
function goalWhyNoBuyHtml(plan,portfolio){
  const why=(plan&&plan.whyNoBuy)||[];if(!why.length||plan.defensive)return'';
  const w=why[0];if(w.code==='reached')return '';
  const cashBtn=w.code==='cash'?' <button type="button" class="btn small" data-portfolio-cash-edit="'+esc(portfolio.id)+'">↻ Actualizar efectivo</button>':w.code==='cap'?' <button type="button" class="btn small" data-goal-wizard>✎ Cambiar capital</button>':w.code==='sleeve'?' <button type="button" class="goal2-btn goal2-why-btn" data-goal-sleeve-cash>Cambiar reparto</button>':'';
  return '<div class="goal2-why" role="note"><b>¿Por qué no hay compras?</b> '+esc(w.text)+cashBtn+'</div>';
}
// ----- Huchas del Objetivo: alto / medio / bajo, cada una con su efectivo, sus acciones y su estrategia -----
// El servidor lleva el libro (lo asignado y las operaciones de cada hucha); aquí se valoran sus acciones con los
// precios en vivo y se calcula cuánto ha crecido cada una frente a su 100 % (lo que le asignaste).
const GOAL_SLEEVES=["alto","medio","bajo"];
const GOAL_SLEEVE_META={
  alto:{label:"Alto",horizon:"1–5 sesiones",minTicket:50,slots:3,strategies:{catalysts:{name:"Catalizadores y volatilidad",short:"Catalizadores",
    note:"Resultados, FDA, contratos y subidas tempranas, con stop. Sin ventaja medida en 10 años de históricos: lo que se arriesga se limita al dinero de esta hucha."}}},
  medio:{label:"Medio",horizon:"1–3 meses",minTicket:100,slots:3,strategies:{momentum:{name:"Momento (O'Neil): las que más suben en 6 meses, cerca de máximos",short:"Momento",
    note:"La única señal con ventaja medida en 10 años de acciones de EE. UU.: batió al S&P 500 algo más de la mitad de los trimestres, por poco tras comisiones. Sale si pierde el momento o cae un 15 % desde la compra."}}},
  bajo:{label:"Bajo",horizon:"años",minTicket:100,slots:5,strategies:{quality:{name:"Calidad a buen precio (Buffett / Greenblatt)",short:"Calidad",
      note:"Grandes, rentables, con caja libre, poca deuda y precio razonable. No se puede medir hacia atrás con datos gratuitos: se mide desde hoy. Se mantiene años; se revisa si deja de ser rentable o se encarece mucho."},
    index:{name:"Fondo indexado mundial (lo que Buffett recomienda a la mayoría)",short:"Indexado",
      note:"Lo más sensato para dinero a años: barato, diversificado y sin elegir acciones. En Trade Republic, con plan de inversión sin comisión."}}}
};
function goalSleeveStateOf(goal){const s=goal&&goal.sleeves;return s&&s.startedAt&&s.sleeves&&s.sleeves.alto&&s.sleeves.medio&&s.sleeves.bajo?s:null}
function goalSleevePill(k){return k&&GOAL_SLEEVE_META[k]?'<span class="goal2-sleeve-pill goal2-risk-'+esc(k)+'">HUCHA '+esc(GOAL_SLEEVE_META[k].label.toUpperCase())+'</span>':''}
function goalSleeveStrategy(S,k){const m=GOAL_SLEEVE_META[k],id=S&&S.sleeves[k]&&S.sleeves[k].strategy;return m.strategies[id]||Object.values(m.strategies)[0]}
function goalSleeveOperationNote(side,sleeve,position){
  const k=side==="SELL"?String(position&&position.sleeve||""):String(sleeve||"");
  if(!GOAL_SLEEVE_META[k])return'';
  return '<p class="portfolio-form-note">'+goalSleevePill(k)+' '+(side==="SELL"?'Lo que cobres vuelve a la hucha '+esc(GOAL_SLEEVE_META[k].label.toLowerCase())+'.':'Se paga con el efectivo de la hucha '+esc(GOAL_SLEEVE_META[k].label.toLowerCase())+'.')+'</p>';
}
// Acciones de la cartera repartidas por hucha, con su valor de hoy.
function goalSleeveBuckets(positionRows){
  const out={alto:{rows:[],value:0,cost:0},medio:{rows:[],value:0,cost:0},bajo:{rows:[],value:0,cost:0},none:[]};
  for(const row of positionRows){
    const k=String(row.p.sleeve||""),qty=num(row.qty)||0,value=row.unitEur!==null?qty*row.unitEur:null;
    if(!out[k]||k==="none"){out.none.push({row,value});continue}
    out[k].rows.push({row,value});out[k].value+=value||0;out[k].cost+=row.avgEur!==null?qty*row.avgEur:0;
    if(value===null)out[k].unpriced=true;
  }
  return out;
}
// Valor de mercado de cada hucha ahora (efectivo + acciones): con él, el servidor reparte participaciones al
// meter o sacar dinero sin cambiar la rentabilidad. Sin precio de alguna acción no se manda (usa el coste).
function goalSleeveValues(S,positionRows){
  if(!S)return{};
  const B=goalSleeveBuckets(positionRows||[]);
  return Object.fromEntries(GOAL_SLEEVES.filter(k=>!B[k].unpriced).map(k=>[k,Math.round((S.sleeves[k].cashEur+B[k].value)*100)/100]));
}
function goalSleeveRowsFor(portfolioId){
  try{return String(portfolioId)===String(state.selectedPortfolioId)?portfolioCoachPositionRows(portfolioGoalMetrics()):[]}catch(_){return[]}
}
function goalSleeveEurPrice(stock,preferTr,fx){
  const q=goalExecutionQuote(stock,preferTr,"BUY",fx,"",1);
  if(num(q.unitEur)>0)return{priceEur:q.unitEur,q};
  const cur=String(stock&&stock.currency||"").toUpperCase(),last=num(stock&&stock.price);
  return{priceEur:last>0?(cur==="EUR"?last:cur==="USD"&&num(fx)>0?last*num(fx):null):null,q};
}
let goalQualityCache={at:0,key:"",list:[]};
function goalQualityList(preferTr,heldKeys){
  const G=window.ViewInvAIGoal,all=window.ViewInvAI&&typeof window.ViewInvAI.getAllStocks==="function"?window.ViewInvAI.getAllStocks():[];
  if(!G||typeof G.qualityIdeas!=="function"||!all.length)return[];
  const cacheKey=(preferTr?"tr":"us")+"|"+[...heldKeys].sort().join(",");
  if(goalQualityCache.key!==cacheKey||Date.now()-goalQualityCache.at>60000){
    const rows=[];
    for(const s of all){
      if(!["NASDAQ","NYSE","AMEX"].includes(String(s.exchange||"").toUpperCase()))continue;
      if(preferTr&&(s.tradeRepublicTradable===false||s.trActive===false||!(s.tradeRepublicTradable===true||(s.tradeRepublicVerified&&s.trTicker))))continue;
      rows.push({key:goalStockKey(s),ticker:String((preferTr?s.trTicker:s.ticker)||s.ticker||"").toUpperCase(),name:s.name||"",price:num(s.price),marketCap:num(s.marketCap),
        revenueTtm:num(s.revenueTtm),netIncomeTtm:num(s.netIncomeTtm),enterpriseValue:num(s.enterpriseValue),peRatio:num(s.peRatio),dividendYield:num(s.dividendYield),
        roicPct:num(s.roicPct),roePct:num(s.roePct),debtToEquity:num(s.debtToEquity),freeCashFlow:num(s.freeCashFlow),
        atrPct:goalAtrPct(s),high52w:num(s.high52w),perf6M:num(s.perf6M),sector:s.sector||"",industry:s.industry||"",stock:s});
    }
    goalQualityCache={at:Date.now(),key:cacheKey,list:G.qualityIdeas(rows,{limit:6,exclude:[...heldKeys]}).map(t=>({...t,stock:(rows.find(r=>r.key===t.key)||{}).stock}))};
  }
  return goalQualityCache.list;
}
// Ideas de la hucha con su importe: el efectivo libre de la hucha repartido entre las que caben.
function goalSleeveIdeasHtml(k,list,S,bucket,ctx,goal){
  const G=window.ViewInvAIGoal,m=GOAL_SLEEVE_META[k],cash=S.sleeves[k].cashEur;
  if(!G||!list.length)return{next:'',more:'<small class="goal2-alts-note">Ahora no hay ideas que cumplan esta estrategia.</small>'};
  const priced=list.filter(t=>t.stock).map(t=>({...t,...goalSleeveEurPrice(t.stock,ctx.preferTr,ctx.fx)}));
  if(ctx.preferTr&&window.ViewInvAI&&typeof window.ViewInvAI.pinTrLiveKeys==="function")window.ViewInvAI.pinTrLiveKeys("goal-"+k,priced.map(t=>portfolioStockKey(t.stock)));
  const noFrac=[...goalNoFractionSet(goal)];
  // Sin mínimo artificial: con poco efectivo también se propone comprar (desde 5 €), concentrado en una compra.
  const minTicket=5;
  const z=G.sleeveSizing(priced.filter(t=>num(t.priceEur)>0),{cashEur:cash,minTicketEur:minTicket,targetTicketEur:m.minTicket,slots:Math.max(0,m.slots-bucket.rows.length),feeEur:portfolioOperationFee(ctx.preferTr),allowFractions:Number(goal.allow_fractions)!==0,noFractions:noFrac});
  const sized=new Map(z.ideas.map(x=>[x.key,x]));
  const head=z.count>0?'Con '+formatMoney(cash,"EUR")+' libres: '+z.count+(z.count===1?' compra':' compras')+' de unos '+formatMoney(z.each,"EUR"):
    z.reason==="full"?'Hucha completa: ya tiene '+bucket.rows.length+' acciones.':'Con '+formatMoney(cash,"EUR")+' libres no llega para una compra de al menos '+formatMoney(minTicket,"EUR")+' (con 1 € por orden, la comisión sería más de la mitad).';
  let next='';
  const items=priced.map(t=>{
    const x=sized.get(t.key),label=String(t.ticker||"")+(t.name&&t.name!==t.ticker?' ('+t.name+')':''),key=portfolioStockKey(t.stock);
    const facts=k==="medio"?'6 meses sin el último: +'+formatNumber(t.momentumPct,1)+' %'+(num(t.fromHighPct)!==null?' · a '+formatNumber(Math.abs(t.fromHighPct),1)+' % de su máximo':'')
      :'rentab. del beneficio '+formatNumber(t.earningsYieldPct,1)+' % · '+(t.returnBasis==="roic"?'ROIC '+formatNumber(t.roicPct,0)+' %':'margen '+formatNumber(t.netMarginPct,0)+' %')+(num(t.pe)!==null?' · PER '+formatNumber(t.pe,0):'')+(num(t.debtToEquity)!==null?' · deuda/patrimonio '+formatNumber(t.debtToEquity,1):'');
    let buy='';
    if(x&&x.fits){
      const q=goalExecutionQuote(t.stock,ctx.preferTr,"BUY",ctx.fx,"",x.units),cur=q.currency||(ctx.preferTr?"EUR":"USD");
      const price=q.price??portfolioConvertAmount(t.priceEur,"EUR",cur,ctx.fx);
      const feePct=x.ticketEur>0?2*portfolioOperationFee(ctx.preferTr)/x.ticketEur*100:null;
      buy='<span class="goal2-sleeve-buy">'+(x.fractional?'≈ '+formatNumber(x.units,2)+' acciones (fracción)':x.units+(x.units===1?' acción':' acciones'))+' · '+formatMoney(x.ticketEur,"EUR")+'</span>'+
        (feePct!==null&&feePct>2?'<small class="goal2-sleeve-fee">Comisión de ida y vuelta: '+esc(formatNumber(feePct,1))+' % del importe; tiene que subir eso solo para no perder.</small>':'')+
        // Mismo botón que en «Hoy toca» (la nota de cotización sin verificar, en pequeño debajo).
        goalOperationButtonHtml({side:"BUY",portfolioId:state.selectedPortfolioId,broker:"",stockKey:key,units:x.units,price,fees:q.feeNative??q.feeEur,currency:cur,preferTr:ctx.preferTr,executable:q.executable===true,executionReason:q.executionReason,sleeve:k})
          .replace(/^(<small class="portfolio-goal-execution-blocked"[^>]*>[^<]*<\/small>)(.*)$/,'$2$1').replace(/class="(goal2-decide|btn ghost compact) portfolio-goal-register"/,'class="goal2-btn goal2-btn-primary portfolio-goal-register"').replace(/>(✓ Ya ejecutada|＋ Registrar estrategia)<\/button>/,'>✓ Comprada</button>');
    }
    // La primera que cabe es la «siguiente compra» de la hucha (a la vista); el resto, en la lista cerrada.
    if(buy&&!next){
      next='<div class="goal2-sleeve-next"><small>Siguiente compra</small><div><b data-open-name>'+esc(t.name||t.ticker||"")+'</b>'+goalRiskPill(t.riskTier)+'</div>'+buy+'</div>';
      return '';
    }
    return '<li>'+goalLinkedText(label,[{label,key,preferTr:ctx.preferTr}])+goalRiskPill(t.riskTier)+' <small>'+esc(facts)+'</small>'+buy+'</li>'}).join('');
  return{next:next?next.replace('<div class="goal2-sleeve-next">','<div class="goal2-sleeve-next" data-open-stock="'+esc(portfolioStockKey((priced.find(t=>sized.get(t.key)&&sized.get(t.key).fits)||{}).stock||{}))+'" data-position-prefer-tr="'+(ctx.preferTr?'1':'0')+'">'):'',
    more:'<small class="goal2-sleeve-sizing">'+esc(head)+'</small>'+(items?'<ol class="goal2-sleeve-ideas">'+items+'</ol>':'')};
}
// Reglas de salida de las acciones de las huchas medio y bajo (estas no las gestiona el plan de ideas cortas).
function goalSleeveExitNote(k,row){
  const s=row.stock||{},ret=row.avgEur>0&&row.unitEur!==null?(row.unitEur/row.avgEur-1)*100:null;
  if(k==="medio"){
    const p6=num(s.perf6M),pm=num(s.perfMonth),mom=p6!==null&&pm!==null?((1+p6/100)/(1+pm/100)-1)*100:null;
    if(ret!==null&&ret<=-15)return{tag:"SALIR",text:"cae un "+formatNumber(Math.abs(ret),1)+" % desde la compra (límite −15 %)"};
    if(mom!==null&&mom<=0)return{tag:"REVISAR",text:"ya no tiene momento de 6 meses ("+formatNumber(mom,1)+" %)"};
    return{tag:"MANTENER",text:mom!==null?"momento de 6 meses +"+formatNumber(mom,1)+" %":"sin datos de momento"};
  }
  if(k==="bajo"){
    const ni=num(s.netIncomeTtm),pe=num(s.peRatio);
    if(ni!==null&&ni<=0)return{tag:"REVISAR",text:"ha pasado a pérdidas"};
    if(pe!==null&&pe>45)return{tag:"REVISAR",text:"se ha encarecido mucho (PER "+formatNumber(pe,0)+")"};
    return{tag:"MANTENER",text:"sigue rentable"+(pe!==null?" · PER "+formatNumber(pe,0):"")};
  }
  return null;
}
function goalSleevesHtml(metrics,positionRows,goal,ctx){
  const S=goalSleeveStateOf(goal);if(!S)return'';
  const B=goalSleeveBuckets(positionRows),realCash=goalSleeveBudgetEur(goal,metrics.cashEur),diff=Math.round((realCash-S.totalCashEur)*100)/100;
  const held=new Set(positionRows.map(r=>goalStockKey(r.stock)));
  const cards=GOAL_SLEEVES.map(k=>{
    const x=S.sleeves[k],m=GOAL_SLEEVE_META[k],st=goalSleeveStrategy(S,k),b=B[k],total=x.cashEur+b.value;
    // Rentabilidad por participaciones: meter o sacar dinero no la cambia (cada participación empezó en 1 €).
    const units=num(x.units),pct=b.unpriced?null:units>1e-9?(total/units-1)*100:x.baseEur>0?(total/x.baseEur-1)*100:null,gain=total-x.baseEur;
    // Una línea por acción: resultado, valor y su estado (stop, «mantener» con «Cambiar», o la regla de salida).
    const pos=b.rows.length?'<ul class="goal2-poslist">'+b.rows.map(({row,value})=>{
      const ret=row.avgEur>0&&row.unitEur!==null?(row.unitEur/row.avgEur-1)*100:null,exit=goalSleeveExitNote(k,row);
      const ticker=String(row.stock&&(row.preferTr?row.stock.trTicker:row.stock.ticker)||row.p.ticker||""),name=row.stock&&row.stock.name||row.p.name||"";
      const status=(ctx.posStatus&&ctx.posStatus.get(String(row.p.id)))||(exit?'<i class="goal2-sleeve-exit goal2-sleeve-exit-'+esc(exit.tag.toLowerCase())+'">'+esc(exit.tag)+'</i> '+esc(exit.text):'');
      return '<li class="goal2-posrow" data-open-stock="'+esc(row.p.stock_key)+'" data-position-prefer-tr="'+(row.preferTr?'1':'0')+'">'+
        '<div class="goal2-posrow-head"><b data-open-name role="link" tabindex="0">'+esc(ticker)+'</b><small data-open-name>'+esc(name)+'</small>'+
        '<span class="'+(ret===null?'':ret>=0?'pnl-up':'pnl-down')+'">'+(ret===null?'—':(ret>0?'+':'')+formatNumber(ret,1)+' %')+'</span></div>'+
        '<small class="goal2-posrow-status">'+esc(value===null?'sin precio':formatMoney(value,"EUR"))+(status?' · '+status:'')+'</small>'+
        '<details class="goal2-sleeve-movebox"><summary>Cambiar de hucha</summary><select class="goal2-sleeve-move" data-goal-sleeve-assign="'+esc(row.p.id)+'" data-goal-sleeve-value="'+esc(String(value??""))+'" aria-label="Cambiar de hucha">'+goalSleeveOptions(k)+'</select></details></li>'}).join('')+'</ul>':'';
    let ideas={next:'',more:''};
    if(k==="medio")ideas=goalSleeveIdeasHtml(k,goalTrendList(ctx.preferTr,held,{noHigh:true}),S,b,ctx,goal);
    else if(k==="bajo"&&x.strategy==="quality")ideas=goalSleeveIdeasHtml(k,goalQualityList(ctx.preferTr,held),S,b,ctx,goal);
    else if(k==="bajo")ideas={next:'',more:'<ul class="goal2-sleeve-ideas">'+((window.ViewInvAIGoal&&window.ViewInvAIGoal.INDEX_ETFS)||[]).map(e=>'<li><b>'+esc(e.name)+'</b> <small translate="no">'+esc(e.isin)+'</small><br><small>'+esc(e.note)+'</small></li>').join('')+'</ul>'+
      '<small class="goal2-alts-note">Los ETF se siguen en Fondos. Si inviertes en uno el efectivo de esta hucha, bájalo en «Repartir efectivo» para que cuadre con tu cuenta.</small>'};
    const alto=k==="alto"?'<small class="goal2-posrow-status">Sus compras salen arriba, en «Hoy toca».</small>':'';
    return '<article class="goal2-sleeve goal2-sleeve-'+esc(k)+'"><header><span>'+goalSleevePill(k)+' <b>'+esc(st.short)+'</b> <small>'+esc(m.horizon)+'</small></span>'+
      '<strong class="goal2-sleeve-pct'+(pct===null?'':pct>=0?' up':' down')+'">'+(pct===null?'—':(pct>0?'+':'')+formatNumber(pct,1)+' %')+(b.unpriced?'':'<small>'+(gain>=0?'+':'−')+esc(formatMoney(Math.abs(gain),"EUR"))+'</small>')+'</strong></header>'+
      '<div class="goal2-sleeve-figs"><span>Libre <b>'+esc(formatMoney(x.cashEur,"EUR"))+'</b></span><span>En acciones <b>'+esc(b.unpriced?'—':formatMoney(b.value,"EUR"))+'</b></span></div>'+
      pos+alto+ideas.next+
      '<details class="goal2-sleeve-more" data-goal-fold="sleeve-'+esc(k)+'"'+(goalOpenFolds.has("sleeve-"+k)?' open':'')+'><summary>'+(k==="alto"?'Estrategia':'Estrategia y más ideas')+'</summary><small>'+esc(st.note)+'</small>'+ideas.more+'</details></article>';
  }).join('');
  const none=B.none.length?'<div class="goal2-why" role="note"><b>Acciones sin hucha.</b> Indica a qué hucha pertenece cada una: lo comprado desde que empezaron las huchas lo pagó esa hucha y lo que ya tenías se le suma por su valor de hoy.<ul class="goal2-sleeve-pos">'+
    B.none.map(({row,value})=>'<li>'+esc(String(row.p.ticker||""))+' '+esc(row.stock&&row.stock.name||row.p.name||'')+' <small>'+esc(value===null?'sin precio':formatMoney(value,"EUR"))+'</small><select class="goal2-sleeve-move" data-goal-sleeve-assign="'+esc(row.p.id)+'" data-goal-sleeve-value="'+esc(String(value??""))+'" aria-label="Elegir hucha">'+goalSleeveOptions("")+'</select></li>').join('')+'</ul></div>':'';
  const banner=diff>.5?'<div class="goal2-why" role="note"><b>Efectivo sin asignar: '+esc(formatMoney(diff,"EUR"))+'.</b> No lo usa ninguna hucha. <button type="button" class="btn small" data-goal-sleeve-cash>Repartir efectivo</button></div>'
    :diff<-.5?'<div class="goal2-why warn" role="alert"><b>Las huchas suman '+esc(formatMoney(S.totalCashEur,"EUR"))+' y el efectivo para el objetivo es '+esc(formatMoney(realCash,"EUR"))+'.</b> Falta '+esc(formatMoney(-diff,"EUR"))+': puede faltar por registrar una compra, o retiraste dinero. Mientras no cuadre, las compras no pasan del efectivo real. <button type="button" class="btn small" data-goal-sleeve-cash>Ajustar reparto</button></div>':'';
  const total=GOAL_SLEEVES.reduce((a,k)=>a+S.sleeves[k].cashEur+B[k].value,0),base=GOAL_SLEEVES.reduce((a,k)=>a+S.sleeves[k].baseEur,0);
  const mix=total>0?GOAL_SLEEVES.map(k=>GOAL_SLEEVE_META[k].label+' '+formatNumber((S.sleeves[k].cashEur+B[k].value)/total*100,0)+' %').join(' · '):'';
  // Resumen de una línea para el desplegable cerrado: el % de cada hucha (⚠ si el efectivo no cuadra).
  ctx.sleeveHint=(diff<-.5||B.none.length?'⚠ revisar · ':'')+GOAL_SLEEVES.map(k=>{const x=S.sleeves[k],t=x.cashEur+B[k].value,u=num(x.units),q=B[k].unpriced?null:u>1e-9?(t/u-1)*100:x.baseEur>0?(t/x.baseEur-1)*100:null;
    return GOAL_SLEEVE_META[k].label+' '+(q===null?'—':(q>0?'+':'')+formatNumber(q,1)+' %')}).join(' · ');
  return '<section class="goal2-section goal2-sleeves">'+banner+
    '<div class="goal2-sleeve-list">'+cards+'</div>'+none+'<div class="goal2-sleeves-actions"><button type="button" class="goal2-btn" data-goal-sleeve-cash>Repartir efectivo</button></div>'+
    (base>0?'<small class="goal2-alts-note">Total '+esc(formatMoney(total,"EUR"))+' ('+(total-base>=0?'+':'−')+esc(formatMoney(Math.abs(total-base),"EUR"))+' sobre lo aportado). El % de cada hucha no cambia al meter o sacar dinero.</small>':'')+
  '</section>';
}
function goalSleeveOptions(current){
  return ['<option value=""'+(current?'':' selected')+'>Sin hucha</option>',...GOAL_SLEEVES.map(k=>'<option value="'+k+'"'+(current===k?' selected':'')+'>Hucha '+GOAL_SLEEVE_META[k].label.toLowerCase()+'</option>')].join('');
}
async function goalSleevePatch(portfolioId,sleeves){
  const response=await api("/api/portfolio-goal",{method:"PATCH",body:JSON.stringify({portfolioId,sleeves})}),data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"No se pudo guardar el reparto.");
  if(data.goal)state.goals[String(portfolioId)]=data.goal;
  if(String(state.selectedPortfolioId)===String(portfolioId))state.goal=data.goal||state.goal;
  goalPlanCache=null;state.goalCandidateCache={at:0,key:"",rows:[]};
  return data.goal;
}
// Repartir el efectivo entre las huchas (al importar el efectivo de Trade Republic, al cambiarlo a mano o cuando se pida).
function openGoalSleeveCashModal(portfolioId,{reason=""}={}){
  const portfolio=state.portfolios.find(p=>String(p.id)===String(portfolioId)),goal=state.goals[String(portfolioId)];
  const S=goalSleeveStateOf(goal);if(!portfolio||!S)return;
  const total=Math.max(0,num(portfolio.cash_balance)||0),cash=goalSleeveBudgetEur(goal,total);
  openModal("Repartir efectivo · "+portfolio.name,
    '<form id="goalSleeveCashForm" class="portfolio-form goal2-sleeve-form" data-portfolio-id="'+esc(portfolio.id)+'" data-cash="'+esc(String(cash))+'">'+
      (reason?'<p class="portfolio-form-note">'+esc(reason)+'</p>':'')+
      '<p class="goal2-sleeve-form-total">Efectivo para el objetivo: <b>'+esc(formatMoney(cash,"EUR"))+'</b>'+(total>cash+.005?' <small>(de '+esc(formatMoney(total,"EUR"))+' en la cartera; se cambia en «Ajustar objetivo»)</small>':'')+'</p>'+
      GOAL_SLEEVES.map(k=>'<div class="goal2-sleeve-form-row"><div class="goal2-sleeve-form-head">'+goalSleevePill(k)+'<small>'+esc(goalSleeveStrategy(S,k).short)+' · ahora '+esc(formatMoney(S.sleeves[k].cashEur,"EUR"))+'</small></div>'+
        '<label><input name="'+k+'" type="number" min="0" step="0.01" inputmode="decimal" value="'+esc(String(S.sleeves[k].cashEur))+'" data-goal-sleeve-eur aria-label="Euros de la hucha '+k+'"><b>€</b></label>'+
        '<label><input type="number" min="0" max="100" step="0.1" inputmode="decimal" value="'+(cash>0?esc(String(Math.round(S.sleeves[k].cashEur/cash*1000)/10)):'')+'" data-goal-sleeve-pct="'+k+'" aria-label="Porcentaje de la hucha '+k+'"><b>%</b></label></div>').join('')+
      '<p class="goal2-sleeve-form-left" data-goal-sleeve-left></p>'+
      '<p class="portfolio-form-note">Lo que subas en una hucha cuenta como dinero nuevo (sube su 100 %); lo que bajes, como retirada. No cambia su rentabilidad.</p>'+
      '<div class="portfolio-form-status" data-goal-sleeve-status aria-live="polite"></div>'+
      '<button type="submit" class="btn">Guardar reparto</button>'+
    '</form>');
  goalSleeveCashSync();
}
function goalSleeveCashSync(changed){
  const form=document.getElementById("goalSleeveCashForm");if(!form)return;
  const cash=num(form.dataset.cash)||0;
  if(changed&&changed.dataset.goalSleevePct){
    const eur=form.querySelector('[name="'+changed.dataset.goalSleevePct+'"]'),p=num(changed.value);
    if(eur)eur.value=p===null?"":String(Math.round(cash*Math.max(0,Math.min(100,p)))/100);
  }else if(changed&&changed.hasAttribute("data-goal-sleeve-eur")){
    const pct=form.querySelector('[data-goal-sleeve-pct="'+changed.name+'"]'),e=num(changed.value);
    if(pct)pct.value=e===null||!(cash>0)?"":String(Math.round(e/cash*1000)/10);
  }
  const sum=GOAL_SLEEVES.reduce((a,k)=>a+(num(form.querySelector('[name="'+k+'"]').value)||0),0),left=Math.round((cash-sum)*100)/100;
  const el=form.querySelector("[data-goal-sleeve-left]");
  if(el){el.textContent=left>=0?"Sin asignar: "+formatMoney(left,"EUR")+(left>0?" (no lo usa ninguna hucha)":""):"Te pasas en "+formatMoney(-left,"EUR")+": las huchas no pueden sumar más que el efectivo para el objetivo.";el.classList.toggle("bad",left<0)}
  const submit=form.querySelector('button[type="submit"]');if(submit)submit.disabled=left<-.005;
}
async function saveGoalSleeveCash(form){
  const status=form.querySelector("[data-goal-sleeve-status]"),button=form.querySelector('button[type="submit"]');
  const cash={};for(const k of GOAL_SLEEVES)cash[k]=Math.max(0,num(form.querySelector('[name="'+k+'"]').value)||0);
  if(button)button.disabled=true;
  const S=goalSleeveStateOf(state.goals[String(form.dataset.portfolioId)]);
  try{await goalSleevePatch(form.dataset.portfolioId,{cash,values:goalSleeveValues(S,goalSleeveRowsFor(form.dataset.portfolioId))});closeModal();renderGoalApp();toast("Reparto guardado.")}
  catch(error){if(status)status.textContent=error.message||"No se pudo guardar.";if(button)button.disabled=false}
}
// Tras cambiar el efectivo (a mano o al importar de Trade Republic): si no cuadra con las huchas, se pregunta el reparto.
function goalSleeveCashPrompt(portfolioId){
  const portfolio=state.portfolios.find(p=>String(p.id)===String(portfolioId)),goal=state.goals[String(portfolioId)],S=goalSleeveStateOf(goal);
  if(!portfolio||!S)return false;
  const diff=Math.round((goalSleeveBudgetEur(goal,portfolio.cash_balance)-S.totalCashEur)*100)/100;
  if(Math.abs(diff)<=.5)return false;
  openGoalSleeveCashModal(portfolioId,{reason:diff>0?"Tienes "+formatMoney(diff,"EUR")+" de efectivo para el objetivo sin asignar. ¿A qué hucha va?":"El efectivo para el objetivo es "+formatMoney(-diff,"EUR")+" menor que lo que suman las huchas. ¿De qué hucha sale?"});
  return true;
}
async function goalSleeveAssign(select){
  const portfolioId=state.selectedPortfolioId,positionId=select.dataset.goalSleeveAssign,sleeve=select.value,valueEur=num(select.dataset.goalSleeveValue);
  const S=goalSleeveStateOf(state.goals[String(portfolioId)]);
  select.disabled=true;
  try{await goalSleevePatch(portfolioId,{assign:[{positionId,sleeve,valueEur}],values:goalSleeveValues(S,goalSleeveRowsFor(portfolioId))});await loadAll();renderGoalApp();toast(sleeve?"Acción asignada a la hucha "+GOAL_SLEEVE_META[sleeve].label.toLowerCase()+".":"Acción sin hucha.")}
  catch(error){toast(error.message||"No se pudo asignar.",true);select.disabled=false}
}
document.addEventListener("click",event=>{
  const b=event.target.closest&&event.target.closest("[data-goal-sleeve-cash]");
  if(b){event.preventDefault();openGoalSleeveCashModal(state.selectedPortfolioId)}
});
document.addEventListener("input",event=>{
  const t=event.target.closest&&event.target.closest("#goalSleeveCashForm input");
  if(t)goalSleeveCashSync(t);
});
document.addEventListener("change",event=>{
  const t=event.target.closest&&event.target.closest("[data-goal-sleeve-assign]");
  if(t)goalSleeveAssign(t);
});
document.addEventListener("submit",event=>{
  if(event.target&&event.target.id==="goalSleeveCashForm"){event.preventDefault();saveGoalSleeveCash(event.target)}
});
function portfolioGoalViewHtml(){
  const metrics=portfolioGoalMetrics(),portfolio=metrics.portfolio;
  if(!portfolio)return'<div class="portfolio-empty-state">Selecciona o crea una cartera para definir su objetivo.</div>';
  state.pendingGoalHistory=null;
  const goal=selectedPortfolioGoal()||state.goal||null,errorHtml=state.goalError?'<div class="portfolio-goal-error" role="alert">'+esc(state.goalError)+'</div>':'';
  const head='<div class="goal2-head"><div><h2>Objetivo · '+esc(portfolio.name)+'</h2>'+(goal?'':'<small>'+esc(portfolioMarketLabel(metrics.marketScope))+'</small>')+'</div>'+
    '<button type="button" class="btn small'+(goal?' ghost':'')+'" data-goal-wizard>'+(goal?'Ajustar':'Crear objetivo')+'</button></div>';
  if(!goal||metrics.target===null)return '<section class="portfolio-goal-view goal2" data-goal-portfolio="'+esc(portfolio.id)+'">'+head+errorHtml+
    '<div class="portfolio-goal-no-action"><strong>Define tu objetivo.</strong> Te haré unas preguntas: cuánto quieres alcanzar, para cuándo, cuánto riesgo y con cuántas acciones. Después, cada día verás qué toca hacer.</div></section>';
  if(metrics.marketScope==="auto")return '<section class="portfolio-goal-view goal2">'+head+errorHtml+'<div class="portfolio-goal-no-action">Configura el mercado de esta cartera (Trade Republic o EEUU) antes de pedir un plan.</div></section>';
  if(metrics.currentValue===null)return '<section class="portfolio-goal-view goal2">'+head+errorHtml+'<div class="portfolio-goal-no-action">Esperando cotizaciones para calcular el plan…</div></section>';
  const positionRows=portfolioCoachPositionRows(metrics);
  const engine=window.ViewInvAIGoal;
  if(!engine)return '<section class="portfolio-goal-view goal2">'+head+'<div class="portfolio-goal-no-action">Cargando el motor del objetivo…</div></section>';
  const input=goalEngineInput(metrics,positionRows),plan=engine.plan(input);
  goalRememberBuys(metrics.portfolio.id,plan);
  const ctx={candidates:input.candidates,positions:input.positions,preferTr:input.preferTr,fx:metrics.fxUsdEur,committed:input.committed||[],sleeves:goalSleeveStateOf(goal)};
  lastGoalCtx=ctx;
  // Las candidatas que aún revisa el servidor no se nombran (irían cambiando): solo se dice que hay revisión en curso.
  // Las esperas que se enseñan son las del último plan revisado por el servidor (cambian solo cuando él revisa);
  // las que calcula el móvil al momento irían cambiando con cada dato. Las ideas fijadas en espera se calculan aquí.
  let serverWaits=[];
  try{const sp=JSON.parse((selectedPortfolioGoal()||{}).plan_json||"{}");if(Date.now()-Date.parse(sp.at||"")<3600e3)serverWaits=plan.pace.status==="reached"?[]:(sp.waits||[]).filter(w=>w&&!w.committed&&!plan.actions.some(a=>a.key===w.key))}catch(_){}
  // «Hoy toca» solo lleva lo que se puede hacer (y las ideas fijadas). Las esperas que calculó el servidor van a
  // «Otras opciones» con su motivo; las de «sin cotización en vivo» se quitan si ahora sí hay precio en vivo.
  serverWaits=serverWaits.filter(w=>{
    if(!/sin cotizaci[oó]n en vivo|no hay cotizaci[oó]n en vivo|SIN PRECIO EN VIVO/i.test(goalWaitTag(w)+" "+String(w.text||"")+" "+(w.reasons||[]).join(" ")))return true;
    const st=stockByKey(w.key);if(!st)return true;
    return !goalExecutionQuote(st,ctx.preferTr,"BUY",ctx.fx,"",1).quoteRecent;
  });
  const visibleDecisions=[...plan.actions,...(plan.waits||[]).filter(w=>w.committed)];
  const today=visibleDecisions.length?visibleDecisions.map(a=>goalActionHtml(a,ctx)).join('')
    :'<div class="portfolio-goal-no-action"><strong>Nada que hacer ahora.</strong> '+esc(plan.defensive?'Modo defensivo activo.':plan.pace&&plan.pace.status==="reached"?'Objetivo alcanzado: el plan no fuerza operaciones.':'Ninguna acción supera ahora el filtro o no queda efectivo ni hueco libre; se revisa en cuanto cambie el mercado.')+'</div>';
  const holds=plan.holds.length?'<ul class="goal2-notes">'+plan.holds.map(h=>{const pos=h.holdMode?(ctx.positions.find(p=>String(p.positionId)===String(h.positionId))||ctx.positions.find(p=>p.key===h.key)):null;
    return '<li>'+goalLinkedText(h.text,[goalPositionLink(ctx,h.key,h.label),goalCandidateLink(ctx,h.altKey,h.altLabel)])+
      (pos?' <button type="button" class="goal2-decide-change" data-goal-decide="'+esc(pos.row.p.id)+'">Cambiar</button>':'')+'</li>'}).join('')+'</ul>':'';
  const frozenRows=positionRows.map(row=>({row,q:Math.min(num(row.qty)||0,positionFrozenQty(row.p))})).filter(x=>x.q>0);
  const frozenNote=frozenRows.length?'<ul class="goal2-notes muted goal2-frozen">'+frozenRows.map(({row,q})=>'<li>🔒 '+esc(formatNumber(q,6))+' × '+esc(row.stock&&row.stock.name||row.p.name||row.p.ticker||'')+' congeladas hasta el '+esc(new Date(String(row.p.frozen_until).slice(0,10)+"T12:00:00").toLocaleDateString("es-ES",{day:"numeric",month:"short",year:"numeric"}))+': el plan no las toca.</li>').join('')+'</ul>':'';
  const notes=plan.notes.length?'<ul class="goal2-notes muted">'+plan.notes.slice(0,4).map(n=>'<li>'+esc(n)+'</li>').join('')+'</ul>':'';
  // Todas las acciones de la cartera, una fila cada una (también las de las huchas medio y bajo y las congeladas):
  // nombre, resultado y su estado (stop, decisión «mantener» con «Cambiar», hucha o congelada).
  const statusOf=row=>{
      const p=input.positions.find(x=>String(x.positionId)===String(row.p.id));
      const h=p?plan.holds.find(x=>x.holdMode&&(x.positionId!==undefined&&x.positionId!==null&&x.positionId!==""?String(x.positionId)===String(row.p.id):x.key===p.key)):null;
      if(h)return esc(String(h.text||"").replace(/^Mantener [^:]*: /,"Mantener: "))+' <button type="button" class="goal2-decide-change" data-goal-decide="'+esc(row.p.id)+'">Cambiar</button>';
      const fq=Math.min(num(row.qty)||0,positionFrozenQty(row.p)),until=fq>0?esc(new Date(String(row.p.frozen_until).slice(0,10)+"T12:00:00").toLocaleDateString("es-ES",{day:"numeric",month:"short"})):'';
      // Congelada solo en parte: el stop es del resto y se indica cuántas están congeladas y hasta cuándo.
      if(p){const st=engine.positionStop(p,input.config.risk);return 'Stop '+(st.stopEur!==null?esc(formatMoney(st.stopEur,"EUR")):'—')+(st.trailing?' · sube con el precio':'')+(fq>0?' · 🔒 '+esc(formatNumber(fq,fq%1?4:0))+' congeladas hasta el '+until:'')}
      if(fq>0)return '🔒 Congelada hasta el '+until+': el plan no la toca';
      return '';
    };
  ctx.posStatus=new Map(positionRows.map(row=>[String(row.p.id),statusOf(row)]));
  const posList=positionRows.length?'<ul class="goal2-poslist">'+positionRows.map(row=>{
      const ret=row.avgEur>0&&row.unitEur!==null?(row.unitEur/row.avgEur-1)*100:null;
      const ticker=String(row.stock&&(row.preferTr?row.stock.trTicker:row.stock.ticker)||row.p.ticker||""),name=row.stock&&row.stock.name||row.p.name||"";
      const status=ctx.posStatus.get(String(row.p.id))||"";
      return '<li class="goal2-posrow" data-open-stock="'+esc(row.p.stock_key)+'" data-position-prefer-tr="'+(row.preferTr?'1':'0')+'">'+
        '<div class="goal2-posrow-head"><b data-open-name role="link" tabindex="0">'+esc(ticker)+'</b><small data-open-name>'+esc(name)+'</small>'+
        '<span class="'+(ret===null?'':ret>=0?'pnl-up':'pnl-down')+'">'+(ret===null?'—':(ret>0?'+':'')+formatNumber(ret,1)+' %')+'</span></div>'+
        (status?'<small class="goal2-posrow-status">'+status+'</small>':'')+'</li>';
    }).join('')+'</ul>':'';
  state.pendingGoalHistory=goalPlanHistorySnapshot(metrics,plan);
  // Orden: lo que toca hacer hoy arriba; el resto, en desplegables cerrados con un resumen de una línea.
  const sleevesBody=goalSleevesHtml(metrics,positionRows,goal,ctx);
  const waitsHtml=serverWaits.length?'<div class="goal2-alts"><small class="goal2-orders-title">En espera</small><ul class="goal2-waitlist">'+serverWaits.map(w=>{
      const label=String(w.name||w.ticker||w.key),tag=goalWaitTag(w);
      return '<li>'+goalLinkedText(label,[goalCandidateLink(ctx,w.key,label)])+' <small>'+esc(tag.charAt(0)+tag.slice(1).toLowerCase())+'</small></li>'}).join('')+'</ul></div>':'';
  const alts=waitsHtml+goalAlternativesHtml(plan,ctx,new Set([...visibleDecisions,...serverWaits].map(d=>String(d.key)))),altCount=serverWaits.length+((plan.alternatives||[]).filter(x=>![...visibleDecisions,...serverWaits].some(d=>String(d.key)===String(x.key)))).length;
  const trend=ctx.sleeves?'':goalTrendHtml(ctx,ctx.preferTr,new Set([...(ctx.positions||[]).map(p=>String(p.key)),...(input.lockedKeys||[]).map(String)]));
  const sb=goalScoreboard.data,sbN=num(sb&&sb.signals);
  const sub='<small class="goal2-sub">'+esc(portfolioMarketLabel(metrics.marketScope))+' · horizonte 1–5 sesiones · riesgo '+esc((engine.RISK[metrics.goalConfig.riskProfile]||{}).label||"")+' · '+esc(String(num(goal.max_positions)??5))+' acciones'+(goal.target_date?' · hasta '+esc(new Date(goal.target_date+"T12:00:00Z").toLocaleDateString("es-ES",{day:"numeric",month:"short",year:"numeric"})):'')+'</small>';
  const pc=plan.pace||{},paceHint=[pc.remainingEur>0?'faltan '+formatMoney(pc.remainingEur,"EUR"):'',num(pc.daysLeft)!==null&&pc.status!=="reached"?pc.daysLeft+' días':''].filter(Boolean).join(' · ');
  const nDec=visibleDecisions.length,pendingOrders=goalPendingOrders(goal);
  const pendingHtml=pendingOrders.length?'<div class="goal2-orders"><small class="goal2-orders-title">Órdenes puestas · '+pendingOrders.length+'</small>'+pendingOrders.map(o=>goalPendingOrderHtml(o,ctx)).join('')+'</div>':'';
  return '<section class="portfolio-goal-view goal2 goal2-simple" data-goal-portfolio="'+esc(portfolio.id)+'">'+head+errorHtml+
    goalPaceMiniHtml(plan.pace,metrics)+
    goalRenewalHtml(plan)+
    (plan.defensive?'<div class="goal2-defensive">Modo defensivo: la cartera está un '+formatNumber(plan.drawdownPct,1)+' % por debajo de su máximo. No se abren compras hasta que se recupere; los stops siguen activos.</div>':'')+
    '<section class="goal2-today"><h3><span>Hoy toca</span>'+(nDec?'<small>'+nDec+(nDec===1?' idea':' ideas')+'</small>':'')+'</h3>'+(ctx.sleeves&&nDec?'<small class="goal2-today-sleeve">Corto plazo (1–5 sesiones) con el dinero de la '+goalSleevePill("alto")+'</small>':'')+goalAutoFillsHtml(portfolio.id,ctx)+pendingHtml+today+goalWhyNoBuyHtml(plan,portfolio)+goalDiscardedTodayHtml(portfolio.id,goal,ctx)+'</section>'+
    '<section class="goal2-more"><h3>Más información</h3>'+
      goalFoldHtml("sleeves","Tus huchas",esc(ctx.sleeveHint||""),sleevesBody)+
      (ctx.sleeves?'':goalFoldHtml("positions","Tus posiciones",String(positionRows.length),posList))+
      goalFoldHtml("alts","Otras opciones",altCount?String(altCount):"",alts+trend)+
      goalFoldHtml("pace","Progreso y ritmo",esc(paceHint),sub+goalPaceHtml(plan.pace,metrics)+notes+'<p class="portfolio-goal-note compact-note">El plan se recalcula al momento con los precios en vivo. No vende una acción en pérdidas para cambiarla salvo que la nueva prevea recuperar esa pérdida y las comisiones con margen; los stops suben solos cuando la acción gana.</p>')+
      goalFoldHtml("score","¿Aciertan estas ideas?",sbN?formatNumber(sbN,0)+(sbN===1?' idea':' ideas'):'',goalScoreboardHtml())+
      goalAiContrastPanel(metrics,portfolio,positionRows,plan.actions.filter(a=>a.type==="BUY").map(a=>{const c=input.candidates.find(x=>x.key===a.key);return c?{stock:c.stock,score:c.score,quality:c.quality,entry:{rr:null},levels:{stopPct:a.stopPct,takePct:a.targetPct}}:null}).filter(Boolean),[])+
    '</section>'+
    '<p class="goal2-disclaimer">Información, no asesoramiento. Decides tú y puedes perder dinero.</p>'+
  '</section>';
}
// Objetivo con Mi cripto: se repinta cuando llegan cotizaciones o cambian las posiciones de cripto.
let goalCryptoTimer=null;
function goalCryptoRefresh(){
  if(goalCryptoTimer||!goalIncludesCrypto())return;
  goalCryptoTimer=setTimeout(()=>{goalCryptoTimer=null;
    const v=document.getElementById("view-portfolios");
    if(v&&v.classList.contains("active")&&v.dataset.portfolioAssetMode==="goal"&&!goalWizard)renderGoalApp();
  },1500);
}
window.addEventListener("viewinvai:crypto-totals",goalCryptoRefresh);
window.addEventListener("viewinvai:crypto-quotes",goalCryptoRefresh);
// ----- Asistente del Objetivo: una pregunta por paso y resumen final editable -----
let goalWizard=null;
function goalWizardSteps(){return["target","date","risk","positions","sleeves","capital","spec","summary"]}
function openGoalWizard(options={}){
  const metrics=portfolioGoalMetrics(),portfolio=metrics.portfolio;if(!portfolio)return;
  const goal=selectedPortfolioGoal()||state.goal||{},stockCur=num(metrics.investedValue),cryptoNow=goalCryptoValueEur(),includeCrypto=goalIncludesCrypto(goal);
  const cur=stockCur!==null&&includeCrypto?stockCur+(cryptoNow||0):stockCur;
  const in6=new Date(Date.now()+182*86400000).toISOString().slice(0,10);
  goalWizard={step:0,portfolioId:portfolio.id,name:portfolio.name,current:cur,
    v:{target:num(goal.target_value_eur)??num(goal.target_profit_eur)??(cur?Math.round(cur*1.5):null),date:goal.target_date||in6,risk:goal.risk_profile||"aggressive",
       positions:num(goal.max_positions)??4,specMode:goal.allow_spec===undefined?1:Math.max(0,Math.min(3,Math.round(num(goal.allow_spec)??1))),
       capEur:num(goal.invest_cap_eur),capPct:num(goal.invest_cap_pct),fractions:goal.allow_fractions===undefined?1:(Number(goal.allow_fractions)===0?0:1),
       noFrac:[...goalNoFractionSet(goal)],fracRestore:[],crypto:includeCrypto?1:0,
       goalCash:goalWizardInitialBudget(goal,metrics.cashEur)},
    stockCurrent:stockCur,cryptoEur:cryptoNow,
    cash:num(metrics.cashEur),capInit:[num(goal.invest_cap_eur),num(goal.invest_cap_pct)],reserveInit:num(goal.invest_reserve_eur),fromSummary:false};
  // Huchas: efectivo de cada una (por defecto 30 / 20 / 50 % del efectivo), su estrategia y la hucha de cada acción.
  const S=goalSleeveStateOf(goal),cash0=Math.max(0,num(metrics.cashEur)||0),def={alto:.3,medio:.2,bajo:.5};
  goalWizard.sleevesInit=!!S;
  // Las huchas llevan sus importes en euros: solo en carteras en euros (las de Trade Republic lo son).
  goalWizard.eurBase=String(portfolio.base_currency||"EUR").toUpperCase()==="EUR";
  // Un objetivo que ya existía sigue como estaba hasta que el usuario elija repartir en huchas; uno nuevo empieza con huchas.
  goalWizard.v.sleevesOn=goalWizard.eurBase&&(S||!selectedPortfolioGoal())?1:0;
  // Sin huchas todavía, el reparto por defecto se calcula sobre el efectivo elegido para el objetivo (paso 1).
  goalWizard.v.sl=Object.fromEntries(GOAL_SLEEVES.map(k=>[k,S?S.sleeves[k].cashEur:Math.floor(Math.min(cash0,num(goalWizard.v.goalCash)??cash0)*def[k]*100)/100]));
  goalWizard.slDefaults=!S;
  goalWizard.v.strat=Object.fromEntries(GOAL_SLEEVES.map(k=>[k,S?S.sleeves[k].strategy:Object.keys(GOAL_SLEEVE_META[k].strategies)[0]]));
  const wizardRows=portfolioCoachPositionRows(metrics);
  goalWizard.sleeveValues=goalSleeveValues(S,wizardRows);
  goalWizard.posList=wizardRows.map(row=>{
    const init=String(row.p.sleeve||""),frozen=positionFrozenQty(row.p)>=(num(row.qty)||0)-1e-9&&positionFrozenQty(row.p)>0;
    return{id:String(row.p.id),label:String(row.p.ticker||"")+(row.stock&&row.stock.name?' · '+row.stock.name:''),value:row.unitEur!==null?(num(row.qty)||0)*row.unitEur:null,init,sleeve:init||(S||frozen?"":"alto")};
  });
  if(options.extend){
    const proposed=window.ViewInvAIGoal&&window.ViewInvAIGoal.nextGoal(goalWizard.v.target,cur);
    if(proposed!==null&&proposed!==undefined)goalWizard.v.target=proposed;
    goalWizard.v.date="";goalWizard.extending=true;
  }
  let el=document.getElementById("goalWizard");
  if(!el){el=document.createElement("div");el.id="goalWizard";el.setAttribute("role","dialog");el.setAttribute("aria-modal","true");document.body.appendChild(el)}
  el.hidden=false;document.body.classList.add("goal-wizard-open");
  paintGoalWizard();
}
function closeGoalWizard(){const el=document.getElementById("goalWizard");if(el){el.hidden=true;el.innerHTML=""}document.body.classList.remove("goal-wizard-open");goalWizard=null}
function goalWizardChoice(name,value,label,sub,checked){
  return '<button type="button" class="goal-wizard-choice'+(checked?' on':'')+'" data-gw-set="'+esc(name)+'" data-gw-value="'+esc(String(value))+'" aria-pressed="'+(checked?'true':'false')+'"><b>'+esc(label)+'</b>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</button>';
}
// Misma aritmética que el motor; el plazo expresa exigencia, nunca una promesa de retorno.
function goalWizardDemandHtml(v,current){
  const G=window.ViewInvAIGoal;if(!G)return "";
  const pc=G.pace({target:num(v.target),deadline:v.date?v.date+"T23:59:59Z":""},current,Date.now());
  const risk=G.RISK[v.risk]||G.RISK.aggressive,parts=[];
  if(pc.requiredGrowthPct!==null&&pc.requiredGrowthPct>0)parts.push("Crecimiento total necesario: +"+formatNumber(pc.requiredGrowthPct,1)+" %.");
  if(pc.daysLeft!==null)parts.push("Plazo restante: "+pc.daysLeft+" días.");
  if(pc.requiredMonthlyPct!==null)parts.push("Equivale a +"+formatNumber(pc.requiredMonthlyPct,1)+" % cada 30 días, compuesto.");
  else if(v.date&&pc.daysLeft>0&&current>0)parts.push("El crecimiento exigido por ese plazo excede el rango del cálculo.");
  else if(!(current>0))parts.push("Sin capital invertido no se puede calcular una rentabilidad necesaria.");
  else if(!v.date)parts.push("Elige un plazo para calcular la exigencia por periodo.");
  parts.push("Perfil "+risk.label+": presupuesto de riesgo al stop y comisiones de "+formatNumber(risk.riskPerTradePct,1)+" % de la cartera por operación; peso máximo ordinario de "+risk.maxWeight+" % por posición.");
  parts.push("Son requisitos y reglas de dimensionamiento, no una previsión ni una garantía de pérdida máxima. Acortar el plazo eleva la exigencia; no aumenta automáticamente el riesgo permitido. Si no encaja contigo, revisa la meta o el plazo.");
  return '<p class="goal-wizard-hint">'+esc(parts.join(" "))+'</p>';
}
// Efectivo para el objetivo (paso 1): de todo el efectivo de la cartera, lo que el usuario quiere usar. Solo con
// eso compra el plan, de eso salen las huchas y eso cuenta en el progreso; el resto no lo toca nada.
function goalWizardInitialBudget(goal,cashEur){
  const cash=Math.max(0,num(cashEur)||0),g=goal||{},r=v=>Math.round(Math.max(0,Math.min(cash,v))*100)/100;
  if(String(g.goal_cash_mode)==="amount")return r(goalCountedCashEur(g,cash));
  const S=goalSleeveStateOf(g);if(S)return r(S.totalCashEur);
  if(num(g.invest_reserve_eur)!==null)return r(cash-num(g.invest_reserve_eur));
  let u=cash;if(num(g.invest_cap_eur)!==null)u=Math.min(u,num(g.invest_cap_eur));if(num(g.invest_cap_pct)!==null&&num(g.invest_cap_pct)<100)u=Math.min(u,cash*num(g.invest_cap_pct)/100);
  return r(u);
}
function goalWizardCountedCash(v){
  const w=goalWizard,cash=Math.max(0,num(w&&w.cash)||0);
  return Math.min(cash,Math.max(0,num(v.goalCash)??cash));
}
function goalWizardCurrent(){
  const w=goalWizard;if(!w||w.stockCurrent===null||w.stockCurrent===undefined)return w?w.current:null;
  return w.stockCurrent+(w.v.crypto===1?(num(w.cryptoEur)||0):0);
}
function goalWizardCurrentText(cur,v){
  return 'Hoy tienes invertido '+esc(cur!==null?formatMoney(cur,"EUR"):"—")+(v.crypto===1?' (con Mi cripto)':'')+'. Indica el valor invertido que quieres alcanzar: el efectivo no cuenta como avance.';
}
function goalWizardCashHtml(w,v){
  const cash=Math.max(0,num(w.cash)||0);
  return '<h3>¿Cuánto efectivo usas para este objetivo?</h3><p class="goal-wizard-hint">Tu efectivo en la cartera: <b>'+esc(formatMoney(cash,"EUR"))+'</b>. El plan solo invierte lo que pongas aquí, las huchas se reparten sobre esta cantidad y el resto no lo toca nada.</p>'+
    '<div class="goal-wizard-pair"><label class="goal-wizard-input"><input type="number" min="0" step="0.01" inputmode="decimal" data-gw-input="goalCash" value="'+esc(String(v.goalCash??""))+'" aria-label="Euros para el objetivo"><b>€</b></label>'+
    '<label class="goal-wizard-input"><input type="number" min="0" max="100" step="0.1" inputmode="decimal" data-gw-input="goalCashPct" value="'+(cash>0&&num(v.goalCash)!==null?esc(String(Math.round(num(v.goalCash)/cash*1000)/10)):'')+'" aria-label="Porcentaje del efectivo para el objetivo"><b>%</b></label></div>'+
    '<div class="goal-wizard-chips">'+[25,50,100].map(q=>'<button type="button" class="goal-wizard-chip" data-gw-cash-pct="'+q+'">'+(q===100?'Todo':q+' %')+'</button>').join('')+'</div>'+
    '<p class="goal-wizard-hint" data-gw-cash-left>'+goalWizardCashLeftText(cash,v)+'</p>';
}
// Atajos del objetivo (+25 %, +50 %, +100 %) sobre el valor de hoy; se rehacen al cambiar el efectivo del objetivo.
function goalWizardTargetChips(cur){
  return cur?[1.25,1.5,2].map(f=>Math.round(cur*f)).map(q=>'<button type="button" class="goal-wizard-chip" data-gw-set="target" data-gw-value="'+q+'">'+formatMoney(q,"EUR")+' <small>(+'+Math.round((q/cur-1)*100)+' %)</small></button>').join(''):'';
}
function goalWizardCashLeftText(cash,v){
  const b=goalWizardCountedCash(v),out=Math.max(0,cash-b);
  return 'Para el objetivo: '+esc(formatMoney(b,"EUR"))+(out>.005?' · fuera del objetivo: '+esc(formatMoney(out,"EUR")):'')+'. No cuenta como avance: el objetivo solo mide lo invertido.';
}
function goalWizardStepHtml(id){
  const w=goalWizard,v=w.v,cur=w.current;
  const months=d=>{const ms=Date.parse(d+"T12:00:00Z")-Date.now();return ms>0?Math.max(1,Math.round(ms/2629800000)):0};
  if(id==="target"){
    const hasCrypto=num(w.cryptoEur)>0||v.crypto===1;
    const counted=goalWizardCountedCash(v);
    return '<h2>¿A cuánto quieres llevar «'+esc(w.name)+'»?</h2><p data-gw-current>'+goalWizardCurrentText(cur,v,counted)+'</p>'+
      '<label class="goal-wizard-input"><input type="number" min="1" step="1" inputmode="decimal" data-gw-input="target" value="'+esc(v.target??"")+'"><b>€</b></label>'+
      '<div class="goal-wizard-chips" data-gw-target-chips>'+goalWizardTargetChips(cur)+'</div>'+
      (hasCrypto?'<h3>¿Cuenta Mi cripto?</h3><div class="goal-wizard-choices">'+
        goalWizardChoice("crypto","0","Solo esta cartera","El objetivo mide lo invertido en acciones de «"+w.name+"».",v.crypto!==1)+
        goalWizardChoice("crypto","1","Sumar también Mi cripto",(num(w.cryptoEur)!==null?"Hoy "+formatMoney(w.cryptoEur,"EUR")+". ":"")+"Cuenta en el progreso y el ritmo; el plan de acciones no la compra ni la vende y no cambia el tamaño de sus compras.",v.crypto===1)+'</div>':'')+
      goalWizardCashHtml(w,v);
  }
  if(id==="date"){
    const quick=[3,6,12].map(m=>({m,d:new Date(Date.now()+m*30.44*86400000).toISOString().slice(0,10)}));
    return '<h2>¿Para cuándo?</h2><p>El plazo determina el crecimiento necesario. El plan conserva el riesgo que elijas aunque se retrase.</p>'+
      '<label class="goal-wizard-input"><input type="date" data-gw-input="date" value="'+esc(v.date||"")+'" min="'+new Date(Date.now()+86400000).toISOString().slice(0,10)+'"></label>'+
      '<div class="goal-wizard-chips">'+quick.map(q=>'<button type="button" class="goal-wizard-chip'+(v.date===q.d?' on':'')+'" data-gw-set="date" data-gw-value="'+q.d+'">'+q.m+' meses</button>').join('')+'</div>'+goalWizardDemandHtml(v,cur);
  }
  if(id==="risk")return '<h2>¿Cuánto riesgo aceptas?</h2><p>Marca cuánto exige el filtro para comprar y cuánto se arriesga en cada operación.</p><div class="goal-wizard-choices">'+
    goalWizardChoice("risk","conservative","Bajo","Solo entradas muy claras, operaciones pequeñas.",v.risk==="conservative")+
    goalWizardChoice("risk","balanced","Medio","Equilibrio entre ritmo y seguridad.",v.risk==="balanced")+
    goalWizardChoice("risk","aggressive","Alto","Crecer rápido: más entradas y más tamaño, siempre con stop.",v.risk==="aggressive")+'</div>'+goalWizardDemandHtml(v,cur);
  if(id==="positions")return '<h2>¿Cuántas acciones a la vez?</h2><p>Concentrado para crecer rápido sin depender de una sola acción.</p><div class="goal-wizard-choices row">'+
    [3,4,5].map(nn=>goalWizardChoice("positions",nn,String(nn),nn===3?"Más concentrado":nn===5?"Más repartido":"Equilibrado",v.positions===nn)).join('')+'</div>';
  // El capital para invertir se elige ya en el paso 1 (efectivo para el objetivo); aquí solo las fracciones.
  if(id==="capital")return '<h2>Compras fraccionadas</h2><p>'+(v.sleevesOn===1?'Cada plan invierte solo el efectivo de su hucha.':'El plan invierte solo los '+esc(formatMoney(goalWizardCountedCash(v),"EUR"))+' que elegiste para el objetivo.')+'</p><div class="goal-wizard-choices">'+
      goalWizardChoice("fractions","1","Sí, invertir importes","Compra la parte de acción que permita el efectivo de la hucha (en Trade Republic, orden a mercado).",v.fractions===1)+
      goalWizardChoice("fractions","0","No, solo acciones enteras","Para brókers que no admiten fracciones.",v.fractions===0)+'</div>';
  if(id==="capital"){
    const cash=w.cash,usable=goalWizardUsable(v,cash);
    return '<h2>¿Cuánto efectivo puede invertir?</h2><p>Hoy tienes '+(cash!==null?formatMoney(cash,"EUR"):"—")+' en efectivo. El plan solo invierte la parte que indiques; el resto queda apartado. Pon una cifra o un porcentaje: el otro se calcula solo.</p>'+
      '<div class="goal-wizard-pair"><label class="goal-wizard-input"><input type="number" min="0" step="any" inputmode="decimal" placeholder="Sin límite" aria-label="Máximo en euros" data-gw-input="capEur" value="'+esc(v.capEur??"")+'"><b>€</b></label>'+
      '<label class="goal-wizard-input"><input type="number" min="0" max="100" step="any" inputmode="decimal" placeholder="100" aria-label="Porcentaje del efectivo" data-gw-input="capPct" value="'+esc(v.capPct??"")+'"><b>%</b></label></div>'+
      '<div class="goal-wizard-chips">'+[25,50,75,100].map(q=>'<button type="button" class="goal-wizard-chip'+((v.capPct??100)===q?' on':'')+'" data-gw-set="capPct" data-gw-value="'+q+'">'+q+' %</button>').join('')+'</div>'+
      '<p class="goal-wizard-hint" data-gw-usable>'+goalWizardUsableText(usable,cash)+'</p>'+
      '<h3>Compras fraccionadas</h3><div class="goal-wizard-choices">'+
      goalWizardChoice("fractions","1","Sí, invertir importes","Compra la parte de acción que permita el capital (en Trade Republic, orden a mercado).",v.fractions===1)+
      goalWizardChoice("fractions","0","No, solo acciones enteras","Para brókers que no admiten fracciones.",v.fractions===0)+'</div>'+
      (v.noFrac.length?'<p class="goal-wizard-hint">Valores en los que tu bróker no deja comprar fracciones (toca para quitar la marca):</p><div class="goal-wizard-chips">'+
        v.noFrac.map(t=>'<button type="button" class="goal-wizard-chip" data-gw-unfrac="'+esc(t)+'" translate="no">'+esc(t)+' ×</button>').join('')+'</div>':'');
  }
  if(id==="sleeves"&&!w.eurBase)return '<h2>Reparto y estrategia</h2><p>Las huchas (alto, medio y bajo riesgo) solo están disponibles en carteras en euros. Esta cartera sigue con un solo plan.</p>';
  if(id==="sleeves"){
    const cash=goalWizardCountedCash(v),on=v.sleevesOn===1;
    if(w.slDefaults)v.sl={alto:Math.floor(cash*30)/100,medio:Math.floor(cash*20)/100,bajo:Math.round((cash-Math.floor(cash*30)/100-Math.floor(cash*20)/100)*100)/100};
    const sum=GOAL_SLEEVES.reduce((a,k)=>a+(num(v.sl[k])||0),0),left=Math.round((cash-sum)*100)/100;
    return '<h2>Reparto y estrategia</h2><p>Reparte los '+esc(formatMoney(cash,"EUR"))+' del objetivo en tres huchas. Cada una tiene su dinero, su estrategia y su propia rentabilidad; lo que vendas vuelve a su hucha.</p><div class="goal-wizard-choices">'+
      goalWizardChoice("sleevesOn","1","Repartir en huchas","Alto, medio y bajo riesgo, cada una con su plan.",on)+
      goalWizardChoice("sleevesOn","0","Un solo plan","Todo el efectivo del objetivo para las ideas cortas, como hasta ahora.",!on)+'</div>'+
      (on?'<div class="goal-wizard-sleeves">'+GOAL_SLEEVES.map(k=>{
        const m=GOAL_SLEEVE_META[k],ids=Object.keys(m.strategies),st=m.strategies[v.strat[k]]||m.strategies[ids[0]];
        return '<div class="goal-wizard-sleeve">'+goalSleevePill(k)+'<small>'+esc(m.horizon)+'</small>'+
          '<div class="goal-wizard-pair"><label class="goal-wizard-input"><input type="number" min="0" step="0.01" inputmode="decimal" data-gw-sleeve="'+k+'" value="'+esc(String(v.sl[k]??""))+'" aria-label="Euros de la hucha '+k+'"><b>€</b></label>'+
          '<label class="goal-wizard-input"><input type="number" min="0" max="100" step="0.1" inputmode="decimal" data-gw-sleeve-pct="'+k+'" value="'+(cash>0?esc(String(Math.round((num(v.sl[k])||0)/cash*1000)/10)):'')+'" aria-label="Porcentaje de la hucha '+k+'"><b>%</b></label></div>'+
          (ids.length>1?'<select data-gw-strategy="'+k+'" aria-label="Estrategia de la hucha '+k+'">'+ids.map(id=>'<option value="'+id+'"'+(v.strat[k]===id?' selected':'')+'>'+esc(m.strategies[id].name)+'</option>').join('')+'</select>':'<b class="goal-wizard-sleeve-strategy">'+esc(st.name)+'</b>')+
          '<small class="goal-wizard-hint">'+esc(st.note)+'</small></div>'}).join('')+'</div>'+
        '<p class="goal-wizard-hint" data-gw-sleeve-left>'+(left>=0?'Para el objetivo '+esc(formatMoney(cash,"EUR"))+' · sin asignar '+esc(formatMoney(left,"EUR")):'Te pasas en '+esc(formatMoney(-left,"EUR"))+' del efectivo para el objetivo ('+esc(formatMoney(cash,"EUR"))+')')+'</p>'+
        (w.posList.length?'<h3>¿A qué hucha va cada acción que ya tienes?</h3><div class="goal-wizard-sleeve-pos">'+w.posList.map(p=>'<label><span>'+esc(p.label)+(p.value!==null?' <small>'+esc(formatMoney(p.value,"EUR"))+'</small>':'')+'</span><select data-gw-assign="'+esc(p.id)+'">'+goalSleeveOptions(p.sleeve)+'</select></label>').join('')+'</div>'+
          '<p class="goal-wizard-hint">Lo comprado desde que empezaron las huchas lo pagó su hucha; lo que ya tenías se suma a su 100 % por su valor de hoy. Las de la hucha alta las gestiona el plan de ideas cortas; las demás siguen la estrategia de su hucha.</p>':'')
      :(w.sleevesInit?'<p class="goal-wizard-hint">Al guardar se quita el reparto en huchas. No se borra ninguna operación ni posición.</p>':''));
  }
  if(id==="spec")return '<h2>¿Acciones especulativas?</h2><p>Solo entran si el potencial temprano compensa claramente el riesgo. Siempre mantienen stop, control de liquidez, spread y dilución.</p><div class="goal-wizard-choices">'+
    goalWizardChoice("specMode","1","Solo una y pequeña","Máximo 1 posición · hasta 10 % de la cartera.",v.specMode===1)+
    goalWizardChoice("specMode","2","Hasta 2, con control estricto","Máximo 2 · hasta 10 % cada una y 20 % entre ambas · filtros reforzados.",v.specMode===2)+
    goalWizardChoice("specMode","3","Flexible para alcanzar el objetivo","El motor decide cuántas, sin superar el máximo de posiciones ni el 35 % agregado especulativo.",v.specMode===3)+
    goalWizardChoice("specMode","0","No, nunca","Solo Oportunidad y Alta convicción.",v.specMode===0)+'</div>';
  const riskLabel={conservative:"Bajo",balanced:"Medio",aggressive:"Alto"}[v.risk]||v.risk;
  const specLabel={0:"No",1:"Una y pequeña",2:"Hasta 2 · control estricto",3:"Flexible · control de riesgo"}[v.specMode]||"Una y pequeña";
  const row=(step,label,value)=>'<button type="button" class="goal-wizard-sum-row" data-gw-goto="'+step+'"><span>'+esc(label)+'</span><b>'+esc(value)+'</b><i aria-hidden="true">›</i></button>';
  return '<h2>Resumen</h2><p>Toca una línea para cambiarla.</p><div class="goal-wizard-sum">'+
    row(0,"Objetivo",v.target?formatMoney(v.target,"EUR"):"—")+
    row(1,"Fecha",v.date?new Date(v.date+"T12:00:00Z").toLocaleDateString("es-ES",{day:"numeric",month:"long",year:"numeric"}):"Sin fecha")+
    row(2,"Riesgo",riskLabel)+row(3,"Acciones a la vez",String(v.positions))+
    (num(w.cryptoEur)>0||v.crypto===1?row(0,"Mi cripto",v.crypto===1?"Cuenta en el objetivo":"No cuenta"):'')+
    row(0,"Efectivo para el objetivo",formatMoney(goalWizardCountedCash(v),"EUR")+" de "+formatMoney(num(w.cash)||0,"EUR"))+
    row(4,"Huchas",v.sleevesOn===1?GOAL_SLEEVES.map(k=>GOAL_SLEEVE_META[k].label+" "+formatMoney(num(v.sl[k])||0,"EUR")).join(" · "):"Un solo plan")+
    row(5,"Fracciones",v.fractions?"con fracciones":"acciones enteras")+row(6,"Especulativas",specLabel)+'</div>'+goalWizardDemandHtml(v,cur)+
    '<p class="goal-wizard-hint">Fondos y ETFs van aparte. El plan compra al momento con stop según volatilidad, sube el stop cuando gana y no cambia una acción en pérdidas salvo que la nueva prevea recuperar la pérdida y las comisiones.</p>';
}
function goalWizardCapChanged(v){
  const w=goalWizard;if(!w)return true;
  const pct=num(v.capPct)!==null&&num(v.capPct)<100?num(v.capPct):null,initPct=w.capInit[1]!==null&&w.capInit[1]<100?w.capInit[1]:null;
  return num(v.capEur)!==w.capInit[0]||pct!==initPct;
}
function goalWizardUsable(v,cash){
  if(cash===null||cash===undefined)return null;
  // Límite sin cambios: lo apartado al guardarlo sigue apartado (las compras ya hechas gastaron capital permitido).
  if(goalWizard&&goalWizard.reserveInit!==null&&!goalWizardCapChanged(v))return Math.max(0,cash-goalWizard.reserveInit);
  let u=Math.max(0,cash);
  // Cuenta el límite que puso el usuario; el otro campo es solo su equivalente redondeado.
  if(v.capSource!=="capPct"&&num(v.capEur)!==null&&num(v.capEur)>=0)u=Math.min(u,num(v.capEur));
  if(v.capSource!=="capEur"&&num(v.capPct)!==null&&num(v.capPct)>=0&&num(v.capPct)<100)u=Math.min(u,cash*num(v.capPct)/100);
  return u;
}
function goalWizardUsableText(usable,cash){
  return usable===null?"":'Podrá invertir <b>'+esc(formatMoney(usable,"EUR"))+'</b>'+(cash>usable+.005?' y dejará apartados '+esc(formatMoney(cash-usable,"EUR"))+'. Lo apartado se fija al guardar: las compras que hagas gastan del capital permitido':'')+'. Lo que liberen las ventas del plan también se puede reinvertir.';
}
function goalWizardCapLabel(v){
  const bits=[];
  if(num(v.capEur)!==null)bits.push("máx. "+formatMoney(num(v.capEur),"EUR"));
  if(num(v.capPct)!==null&&num(v.capPct)<100)bits.push(formatNumber(num(v.capPct),0)+" % del efectivo");
  return bits.length?bits.join(" y "):"Todo el efectivo";
}
function paintGoalWizard(){
  const el=document.getElementById("goalWizard");if(!el||!goalWizard)return;
  const steps=goalWizardSteps(),id=steps[goalWizard.step],last=goalWizard.step===steps.length-1;
  const pct=Math.round(goalWizard.step/(steps.length-1)*100);
  el.innerHTML='<div class="goal-wizard-card"><div class="goal-wizard-head"><div><small>OBJETIVO DE LA CARTERA</small><b>Paso '+(goalWizard.step+1)+' de '+steps.length+'</b></div><button type="button" class="goal-wizard-x" data-gw-close aria-label="Cerrar">×</button></div>'+
    '<div class="goal-wizard-bar"><i data-goal-progress="'+pct+'"></i></div>'+
    '<div class="goal-wizard-body">'+goalWizardStepHtml(id)+'<div class="goal-wizard-msg" data-gw-msg aria-live="polite"></div></div>'+
    '<div class="goal-wizard-foot">'+(goalWizard.step>0&&!goalWizard.fromSummary?'<button type="button" class="btn ghost" data-gw-back>‹ Atrás</button>':'<span></span>')+
      (last?'<button type="button" class="btn" data-gw-save>Guardar objetivo</button>':'<button type="button" class="btn" data-gw-next>'+(goalWizard.fromSummary?'Volver al resumen':'Siguiente')+'</button>')+'</div></div>';
  el.querySelectorAll('[data-goal-progress]').forEach(x=>x.style.setProperty("width",x.dataset.goalProgress+"%"));
  const input=el.querySelector("[data-gw-input]");if(input)setTimeout(()=>input.focus(),30);
}
function goalWizardMsg(text){const m=document.querySelector("#goalWizard [data-gw-msg]");if(m)m.textContent=text||""}
function goalWizardValid(){
  const w=goalWizard,id=goalWizardSteps()[w.step],v=w.v;
  if(id==="target"&&!(num(v.target)>0))return"Indica un objetivo en euros.";
  if(id==="target"&&num(v.goalCash)!==null&&num(v.goalCash)<0)return"El efectivo para el objetivo no puede ser negativo.";
  if(id==="target"&&num(v.goalCash)!==null&&num(v.goalCash)>(num(w.cash)||0)+.005)return"No puedes usar más efectivo del que tienes ("+formatMoney(num(w.cash)||0,"EUR")+").";
  if(id==="target"&&w.current!==null&&num(v.target)<=w.current)return"El objetivo debe ser mayor que el valor actual ("+formatMoney(w.current,"EUR")+").";
  if(id==="date"&&(!v.date||Date.parse(v.date+"T23:59:59Z")<=Date.now()))return"Elige una fecha futura.";
  if(id==="sleeves"&&v.sleevesOn===1){
    const sum=GOAL_SLEEVES.reduce((a,k)=>a+(num(v.sl[k])||0),0);
    if(GOAL_SLEEVES.some(k=>num(v.sl[k])!==null&&num(v.sl[k])<0))return"Las cifras no pueden ser negativas.";
    if(sum>goalWizardCountedCash(v)+.005)return"Las huchas suman "+formatMoney(sum,"EUR")+" y el efectivo para el objetivo es "+formatMoney(goalWizardCountedCash(v),"EUR")+". Reparte menos o sube esa cantidad en el paso 1.";
  }
  if(id==="capital"&&num(v.capEur)!==null&&num(v.capEur)<0)return"La cifra no puede ser negativa.";
  if(id==="capital"&&num(v.capPct)!==null&&(num(v.capPct)<0||num(v.capPct)>100))return"El porcentaje debe estar entre 0 y 100.";
  return"";
}
// Capital invertible: la cifra y el porcentaje del efectivo se mantienen sincronizados (al cambiar uno se recalcula el otro).
function goalWizardSyncCap(changed){
  const v=goalWizard&&goalWizard.v,cash=num(goalWizard&&goalWizard.cash);
  if(!v||!(cash>0))return;
  v.capSource=changed;
  if(changed==="capPct"){const p=num(v.capPct);v.capEur=p===null?null:Math.round(cash*Math.max(0,Math.min(100,p)))/100}
  else if(changed==="capEur"){const e=num(v.capEur);v.capPct=e===null?null:Math.round(Math.max(0,Math.min(100,e/cash*100))*10)/10}
}
async function saveGoalWizard(){
  const w=goalWizard;if(!w)return;
  const btn=document.querySelector("#goalWizard [data-gw-save]");if(btn)btn.disabled=true;
  try{
    const payload={portfolioId:w.portfolioId,targetValueEur:num(w.v.target),targetDate:w.v.date||null,monthlyContributionEur:0,riskProfile:w.v.risk,maxPositions:w.v.positions,specMode:w.v.specMode,allowSpec:w.v.specMode>0,currentValueEur:w.current,
      // Solo se guarda el límite que puso el usuario: el otro es un cálculo redondeado y no debe recortarlo.
      investCapEur:w.v.capSource==="capPct"?null:num(w.v.capEur),investCapPct:w.v.capSource==="capEur"?null:(num(w.v.capPct)!==null&&num(w.v.capPct)<100?num(w.v.capPct):null),allowFractions:w.v.fractions!==0,
      fractionTickers:w.v.fracRestore,includeCrypto:w.v.crypto===1,
      // «El de las huchas» sin huchas no tiene sentido: queda en «solo lo invertido».
      goalCashMode:"amount",goalCashEur:goalWizardCountedCash(w.v),goalCashReserveEur:Math.round(Math.max(0,(num(w.cash)||0)-goalWizardCountedCash(w.v))*100)/100};
    // El límite de capital del plan es el mismo efectivo para el objetivo: lo que queda fuera se aparta.
    payload.investCapEur=goalWizardCountedCash(w.v);payload.investCapPct=null;payload.investReserveEur=Math.round(Math.max(0,(num(w.cash)||0)-goalWizardCountedCash(w.v))*100)/100;
    payload.currentValueEur=goalWizardCurrent();
    // Lo que queda apartado se fija al cambiar el límite: las compras que registres después gastan del capital
    // permitido. Si el límite no cambia, se conserva lo apartado (guardar otra vez no renueva el capital).

    // Con huchas no hay límite de capital aparte: lo que invierte cada plan es el efectivo de su hucha.
    // El objetivo y sus huchas viajan en la misma petición: el servidor los guarda juntos o ninguno.
    let assign=[];
    if(w.v.sleevesOn===1){
      assign=w.posList.filter(p=>p.sleeve!==p.init).map(p=>({positionId:p.id,sleeve:p.sleeve,valueEur:p.value}));
      const unpriced=w.posList.filter(p=>p.sleeve&&p.sleeve!==p.init&&p.value===null);
      if(unpriced.length)throw new Error("Aún no hay precio de "+unpriced.map(p=>p.label.split(" · ")[0]).join(", ")+": espera a que coticen para meterlas en una hucha.");
      payload.sleeves={cash:Object.fromEntries(GOAL_SLEEVES.map(k=>[k,Math.max(0,num(w.v.sl[k])||0)])),strategies:w.v.strat,assign,values:w.sleeveValues||{}};
    }else if(w.sleevesInit)payload.sleeves={disable:true};
    const response=await api("/api/portfolio-goal",{method:"PATCH",body:JSON.stringify(payload)}),data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"No se pudo guardar el objetivo.");
    if(data.goal)state.goals[String(w.portfolioId)]=data.goal;
    state.goal=data.goal||null;state.goalError="";goalPlanCache=null;
    if(assign.length)await loadAll();
    closeGoalWizard();renderGoalApp();toast("Objetivo guardado.");
  }catch(error){goalWizardMsg(error.message||"No se pudo guardar.");if(btn)btn.disabled=false}
}
document.addEventListener("click",event=>{
  const open=event.target.closest&&event.target.closest("[data-goal-wizard]");
  if(open){event.preventDefault();openGoalWizard({extend:open.hasAttribute("data-goal-extend")});return}
  const root=event.target.closest&&event.target.closest("#goalWizard");if(!root||!goalWizard)return;
  const t=event.target.closest("[data-gw-close],[data-gw-next],[data-gw-back],[data-gw-save],[data-gw-set],[data-gw-goto],[data-gw-unfrac],[data-gw-cash-pct]");if(!t)return;
  if(t.hasAttribute("data-gw-cash-pct")){
    goalWizard.v.goalCash=Math.round(Math.max(0,num(goalWizard.cash)||0)*Number(t.dataset.gwCashPct))/100;goalWizardMsg("");
    goalWizard.current=goalWizardCurrent();paintGoalWizard();return;
  }
  if(t.hasAttribute("data-gw-unfrac")){
    const tk=t.dataset.gwUnfrac;goalWizard.v.noFrac=goalWizard.v.noFrac.filter(x=>x!==tk);
    if(!goalWizard.v.fracRestore.includes(tk))goalWizard.v.fracRestore.push(tk);paintGoalWizard();return;
  }
  const steps=goalWizardSteps();
  if(t.hasAttribute("data-gw-close")){closeGoalWizard();return}
  if(t.hasAttribute("data-gw-set")){
    const k=t.dataset.gwSet,val=t.dataset.gwValue;
    goalWizard.v[k]=["positions","target","specMode","capPct","fractions","crypto","sleevesOn"].includes(k)?Number(val):val;
    // El valor de partida (y los atajos +25 %…) cambia según cuente o no Mi cripto.
    if(k==="capPct")goalWizardSyncCap("capPct");
    if((k==="crypto"||k==="sleevesOn")&&goalWizard.stockCurrent!==null)goalWizard.current=goalWizardCurrent();
    goalWizardMsg("");paintGoalWizard();return;
  }
  if(t.hasAttribute("data-gw-goto")){goalWizard.step=Number(t.dataset.gwGoto)||0;goalWizard.fromSummary=true;paintGoalWizard();return}
  if(t.hasAttribute("data-gw-back")){goalWizard.step=Math.max(0,goalWizard.step-1);paintGoalWizard();return}
  if(t.hasAttribute("data-gw-next")){
    const err=goalWizardValid();if(err){goalWizardMsg(err);return}
    goalWizard.step=goalWizard.fromSummary?steps.length-1:Math.min(steps.length-1,goalWizard.step+1);goalWizard.fromSummary=false;paintGoalWizard();return;
  }
  if(t.hasAttribute("data-gw-save"))saveGoalWizard();
});
document.addEventListener("input",event=>{
  const t=event.target.closest&&event.target.closest("#goalWizard [data-gw-input]");if(!t||!goalWizard)return;
  const k=t.dataset.gwInput;goalWizard.v[k]=["target","capEur","capPct","goalCash","goalCashPct"].includes(k)?(t.value===""?null:num(t.value)):t.value;goalWizardMsg("");
  if(k==="goalCash"||k==="goalCashPct"){
    const cash=Math.max(0,num(goalWizard.cash)||0);
    if(k==="goalCashPct"){const p=num(goalWizard.v.goalCashPct);goalWizard.v.goalCash=p===null?null:Math.round(cash*Math.max(0,Math.min(100,p)))/100;const o=document.querySelector('#goalWizard [data-gw-input="goalCash"]');if(o)o.value=goalWizard.v.goalCash??""}
    else{const o=document.querySelector('#goalWizard [data-gw-input="goalCashPct"]'),e=num(goalWizard.v.goalCash);if(o)o.value=e===null||!(cash>0)?"":String(Math.round(e/cash*1000)/10)}
    goalWizard.current=goalWizardCurrent();
    const h=document.querySelector("#goalWizard [data-gw-current]");if(h)h.innerHTML=goalWizardCurrentText(goalWizard.current,goalWizard.v,goalWizardCountedCash(goalWizard.v));
    const l=document.querySelector("#goalWizard [data-gw-cash-left]");if(l)l.innerHTML=goalWizardCashLeftText(cash,goalWizard.v);
    const c=document.querySelector("#goalWizard [data-gw-target-chips]");if(c)c.innerHTML=goalWizardTargetChips(goalWizard.current);
    return;
  }
  if(k==="capEur"||k==="capPct"){
    goalWizardSyncCap(k);
    const other=k==="capEur"?"capPct":"capEur",o=document.querySelector('#goalWizard [data-gw-input="'+other+'"]');
    if(o)o.value=goalWizard.v[other]??"";
    document.querySelectorAll('#goalWizard [data-gw-set="capPct"]').forEach(c=>c.classList.toggle("on",num(goalWizard.v.capPct)===Number(c.dataset.gwValue)));
    const h=document.querySelector("#goalWizard [data-gw-usable]");if(h)h.innerHTML=goalWizardUsableText(goalWizardUsable(goalWizard.v,goalWizard.cash),goalWizard.cash)}
  if(k==="date"){const body=document.querySelector("#goalWizard .goal-wizard-body");if(body){paintGoalWizard()}}
});
// Huchas del asistente: euros y % sincronizados, estrategia y hucha de cada acción.
document.addEventListener("input",event=>{
  const t=event.target.closest&&event.target.closest("#goalWizard [data-gw-sleeve],#goalWizard [data-gw-sleeve-pct]");if(!t||!goalWizard)return;
  const v=goalWizard.v,cash=goalWizardCountedCash(goalWizard.v);goalWizard.slDefaults=false;
  if(t.dataset.gwSleeve){const k=t.dataset.gwSleeve;v.sl[k]=t.value===""?null:num(t.value);const o=document.querySelector('#goalWizard [data-gw-sleeve-pct="'+k+'"]');if(o)o.value=cash>0&&num(v.sl[k])!==null?String(Math.round(num(v.sl[k])/cash*1000)/10):""}
  else{const k=t.dataset.gwSleevePct,p=num(t.value);v.sl[k]=p===null?null:Math.round(cash*Math.max(0,Math.min(100,p)))/100;const o=document.querySelector('#goalWizard [data-gw-sleeve="'+k+'"]');if(o)o.value=v.sl[k]??""}
  const sum=GOAL_SLEEVES.reduce((a,k)=>a+(num(v.sl[k])||0),0),left=Math.round((cash-sum)*100)/100,h=document.querySelector("#goalWizard [data-gw-sleeve-left]");
  if(h)h.textContent=left>=0?"Para el objetivo "+formatMoney(cash,"EUR")+" · sin asignar "+formatMoney(left,"EUR"):"Te pasas en "+formatMoney(-left,"EUR")+" del efectivo para el objetivo ("+formatMoney(cash,"EUR")+")";
  goalWizardMsg("");
});
document.addEventListener("change",event=>{
  const t=event.target.closest&&event.target.closest("#goalWizard [data-gw-strategy],#goalWizard [data-gw-assign]");if(!t||!goalWizard)return;
  if(t.dataset.gwStrategy){goalWizard.v.strat[t.dataset.gwStrategy]=t.value;paintGoalWizard();return}
  const p=goalWizard.posList.find(x=>x.id===t.dataset.gwAssign);if(p)p.sleeve=t.value;
});
document.addEventListener("keydown",event=>{if(event.key==="Escape"&&goalWizard)closeGoalWizard()});
// Contraste opcional con las IA del usuario: no cambia el plan, añade su opinión.
// Solo se envían datos públicos y porcentajes; nunca importes de la cartera.
function goalAiContrastPanel(metrics,portfolio,positionRows,buys,sells){
  const C=window.ViewInvAIContrast;if(!C)return"";
  const tickerOf=(stock,p)=>String(stock&&(stock.ticker||stock.trTicker)||p&&p.ticker||"").toUpperCase();
  const pct=v=>num(v)===null?"—":(v>0?"+":"")+formatNumber(v,1)+"%";
  const held=positionRows.map(r=>"- "+tickerOf(r.stock,r.p)+" ("+(r.stock&&r.stock.name||"")+") · peso "+formatNumber(r.currentWeight,1)+"% · resultado "+pct(r.positionReturnPct)+" · score "+formatNumber(r.score,0)+"/100 · acción propuesta: "+r.action+(r.reasons&&r.reasons.length?" ("+r.reasons.join(", ")+")":""));
  const sellLines=sells.map(r=>"- VENDER "+formatNumber(r.reducePct,0)+"% de "+tickerOf(r.stock,r.p));
  const buyLines=buys.map(r=>{const lv=r.levels||{},s=r.stock||{};return "- COMPRAR "+tickerOf(s)+" ("+(s.name||"")+") · convicción "+formatNumber(r.score,0)+"/100 · calidad "+formatNumber(r.quality,0)+"/100 · R:R "+formatNumber(r.entry&&r.entry.rr,2)+(num(lv.stopPct)!==null?" · stop -"+formatNumber(lv.stopPct,1)+"%":"")+(num(lv.takePct)!==null?" · objetivo +"+formatNumber(lv.takePct,1)+"%":"")+(r.catalyst&&r.catalyst.label?" · "+r.catalyst.label:"")});
  const contextStocks=[];const seenContext=new Set();
  for(const row of positionRows){const st=row.stock,t=tickerOf(st,row.p);if(st&&t&&!seenContext.has(t)){seenContext.add(t);contextStocks.push({stock:st,preferTr:!!row.preferTr})}}
  for(const row of buys){const st=row.stock,t=tickerOf(st);if(st&&t&&!seenContext.has(t)){seenContext.add(t);contextStocks.push({stock:st,preferTr:metrics.marketScope!=="us"})}}
  const publicContext=contextStocks.map(x=>C.stockContext?C.stockContext(x.stock,x.preferTr,3):"").filter(Boolean).join("\n\n");
  const prompt="Objetivo de cartera en ViewInvAI. Mercado: "+portfolioMarketLabel(metrics.marketScope)+". Perfil de riesgo: "+((metrics.riskBand&&metrics.riskBand.label)||"alto")+". Progreso hacia el objetivo: "+formatNumber(metrics.progress,1)+"%.\n"+
    "El motor rota la cartera hacia las acciones con mejor convicción y momento, con stop-loss y sin perseguir subidas.\n"+
    "Contrasta el plan usando prioritariamente los datos actuales aportados por ViewInvAI. Si faltan noticias recientes o un dato no está verificado, dilo; no lo inventes.\n\n"+
    "Posiciones actuales:\n"+(held.length?held.join("\n"):"(sin posiciones)")+"\n\n"+
    "Plan propuesto:\n"+([...sellLines,...buyLines].join("\n")||"No hacer cambios ahora.")+
    (publicContext?"\n\nDATOS ACTUALES Y EVENTOS APORTADOS POR VIEWINVAI:\n"+publicContext:"");
  const day=new Date().toLocaleDateString("en-CA",{timeZone:"Europe/Madrid"});
  const tickers=[...new Set([...positionRows.map(r=>tickerOf(r.stock,r.p)),...buys.map(r=>tickerOf(r.stock))].filter(Boolean))];
  // Pregunta manual más extensa (ChatGPT/Claude/Gemini con la cuenta del usuario), a demanda.
  const manualPrompt=()=>"Eres un gestor de carteras independiente. Responde en español, investiga en la web con datos actuales y no inventes nada: si un dato no se puede verificar, dilo.\n\n"+
    prompt+"\n\n"+
    "QUIERO UN ANÁLISIS EXTENSO DE LA SITUACIÓN ACTUAL:\n"+
    "1. Para cada posición: qué ha pasado en los últimos días (noticias, resultados, filings, dilución, rating, sector) y si conviene MANTENER, REDUCIR o SALIR ahora, con el motivo y el riesgo principal.\n"+
    "2. Para cada compra propuesta: si la entrada tiene sentido ahora (catalizadores próximos con fecha, técnica, valoración, riesgos de dilución o de noticia), y si el stop y el objetivo son razonables.\n"+
    "3. La cartera en conjunto: concentración por sector o factor, correlación entre posiciones, riesgo de eventos (resultados, macro) en las próximas 2 semanas y si el plan acerca al objetivo con un riesgo coherente con el perfil.\n"+
    "4. Qué cambiarías del plan y en qué orden, y qué vigilar en los próximos días.\n"+
    "5. Señala datos contradictorios entre fuentes y enlaza las fuentes principales con fecha.\n\n"+
    "Al final incluye SOLO un bloque JSON con esta forma (un elemento por cada acción citada: "+tickers.join(", ")+"):\n"+
    '{"veredicto":"respalda|dudas|contradice","resumen":"una o dos frases sobre el plan","valores":[{"ticker":"XXX","veredicto":"respalda|dudas|contradice","motivo":"dato clave"}]}\n'+
    "«respalda» = mantener/comprar tiene sentido; «dudas» = hay riesgos que lo debilitan; «contradice» = hay hechos para no comprar o para salir.";
  return C.panelHtml({type:"goal",key:portfolio.id+":"+day,title:"Plan de "+(portfolio.name||"la cartera"),tickers,prompt,manualPrompt});
}
function goalRiskSummaryHtml(band){
  if(!band)return"";
  return '<p class="portfolio-goal-risk-summary">Máx. '+formatNumber(band.maxPosition,0)+'% por acción · riesgo '+formatNumber(band.riskPerTradePct,1)+'% de la cartera por operación · spread ≤ '+formatNumber(band.maxSpreadPct,0)+'% · stop hasta '+formatNumber(band.maxStopPct,0)+'%</p>';
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

// Iconos de la barra de Carteras: trazos SVG del mismo tamaño y grosor (los símbolos de
// texto ⊞ ✎ ⇩ ◷ ◉ se dibujaban cada uno con un tamaño y una altura distintos).
const PF_ICONS={
  import:'<path d="M8 20V5"/><path d="m4 9 4-4 4 4"/><path d="M16 4v15"/><path d="m12 15 4 4 4-4"/>',
  plus:'<path d="M12 5v14"/><path d="M5 12h14"/>',
  history:'<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  globe:'<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4c2.5 2.6 2.5 13.4 0 16"/><path d="M12 4c-2.5 2.6-2.5 13.4 0 16"/>',
  folderPlus:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6"/><path d="M9 13h6"/>',
  edit:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  refresh:'<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>'
};
function pfIcon(name){return '<svg class="pf-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(PF_ICONS[name]||'')+'</svg>'}

function portfolioWorkbarHtml(selected){
  return '<div class="portfolio-workbar'+(state.primaryTab==="goal"?' goal-mode':'')+'">'+
    '<div class="portfolio-tabs-wrap">'+
      '<div class="portfolio-tabs-track" id="portfolioTabsTrack" role="tablist" aria-label="Mis carteras">'+state.portfolios.map(renderPortfolioCard).join('')+'</div>'+
      '<button type="button" class="portfolio-tabs-more" data-portfolio-tabs-more aria-label="Mostrar carteras ocultas" title="Más carteras" hidden>›</button>'+
      '<div class="portfolio-tabs-overflow" id="portfolioTabsOverflow" aria-hidden="true"></div>'+
    '</div>'+
    '<div class="portfolio-workbar-actions">'+
      '<button type="button" class="portfolio-icon-action portfolio-import" data-broker-import aria-label="Importar operaciones del bróker" title="Importar operaciones (Trade Republic, IBKR o CSV)">'+pfIcon('import')+'</button>'+
      '<button type="button" class="portfolio-icon-action portfolio-add-current"'+(selected?'':' disabled')+' aria-label="Añadir posición" title="Añadir posición">'+pfIcon('plus')+'</button>'+
      '<button type="button" class="portfolio-icon-action portfolio-history"'+(selected?' data-portfolio-history="'+esc(selected.id)+'"':' disabled')+' aria-label="Historial de operaciones" title="Historial de operaciones">'+pfIcon('history')+'</button>'+
      '<button type="button" class="portfolio-icon-action portfolio-market-current"'+(selected?' data-portfolio-market-config="'+esc(selected.id)+'"':' disabled')+' aria-label="Mercado de la cartera" title="Mercado de la cartera">'+pfIcon('globe')+'</button>'+
      '<button type="button" class="portfolio-icon-action portfolio-tab-add" data-new-portfolio="1" aria-label="Nueva cartera" title="Nueva cartera">'+pfIcon('folderPlus')+'</button>'+
      '<button type="button" class="portfolio-icon-action portfolio-tabs-edit" data-portfolio-order-edit aria-label="Editar carteras" title="Editar carteras">'+pfIcon('edit')+'</button>'+
      '<button type="button" class="portfolio-refresh compact" aria-label="Actualizar carteras" title="Actualizar">'+pfIcon('refresh')+'</button>'+
    '</div>'+
  '</div>';
}

function portfolioAssetMode(){
  const view=$("#view-portfolios"),goalBox=$("#portfolioGoalApp"),goalTab=$("#portfolioGoalTab");
  const declared=String(view&&view.dataset&&view.dataset.portfolioAssetMode||"").toLowerCase();
  if(["stocks","funds","goal","favorites"].includes(declared))return declared;
  if(goalTab&&goalTab.getAttribute("aria-selected")==="true")return"goal";
  if(goalBox&&!goalBox.hidden&&!goalBox.classList.contains("is-hidden"))return"goal";
  return"stocks";
}

function renderApp() {
  // Un repintado secundario (favoritos, posiciones, efectivo, etc.) no puede vaciar Objetivo
  // mientras esa pestaña siga visible. Antes se borraba #portfolioGoalApp y quedaba en blanco
  // hasta cambiar de pestaña.
  if(portfolioAssetMode()==="goal")return renderGoalApp();
  const box=$("#portfolioApp");if(!box)return;
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
  const designD=dIsDesign()&&!!selected;
  let contextHtml;
  if(designD){try{contextHtml=dPortfolioContextHtml(selected,positions)}catch(error){console.error("Design D portfolio render failed",error);contextHtml=portfolioContextHtml(selected,positions)}}
  else contextHtml=portfolioContextHtml(selected,positions);
  box.innerHTML=(designD?dPortfolioWorkbarHtml():portfolioWorkbarHtml(selected))+
    '<div id="portfolioContext" class="portfolio-context'+(designD?' d-context':'')+'">'+contextHtml+'</div>';

  box.querySelectorAll("[data-insight-w]").forEach(el=>el.style.setProperty("width",el.dataset.insightW+"%"));
  requestAnimationFrame(()=>{
    updatePortfolioTabOverflow();
    if(window.ViewInvAI&&typeof window.ViewInvAI.observeLiveQuotes==="function")window.ViewInvAI.observeLiveQuotes(box);
    if(state.primaryTab==="goal")persistPendingGoalHistory();
    else if(selected)loadPortfolioPerformance(selected.id);
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
    box.querySelectorAll("[data-goal-progress]").forEach(el=>el.style.setProperty("width",el.dataset.goalProgress+"%"));
    if(window.ViewInvAI&&typeof window.ViewInvAI.observeLiveQuotes==="function")window.ViewInvAI.observeLiveQuotes(box);
    persistPendingGoalHistory();
  });
}

// Live quotes repaint the panel; never do it under the user's fingers (an open list,
// a half-typed amount or a modal), or the control vanishes mid-edit. Retry shortly.
function portfolioUserBusy(){
  const view=document.querySelector("#view-portfolios");
  const active=document.activeElement;
  if(view&&active&&view.contains(active)&&/^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName))return true;
  return document.body.classList.contains("select-sheet-open");
}

function schedulePortfolioQuoteRender(){
  // Como mucho un repintado por segundo: con precios llegando sin parar, reiniciar la espera lo aplazaba sin fin.
  if(renderApp.quoteTimer)return;
  renderApp.quoteTimer = setTimeout(()=>{
    renderApp.quoteTimer=null;
    if(!document.querySelector("#view-portfolios.active")||document.hidden)return;
    if(portfolioUserBusy())return schedulePortfolioQuoteRender();
    renderActivePortfolioPanel();
  }, 900);
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
let portfolioNameDrafts = {};

function portfolioDraftName(p) {
  const draft = portfolioNameDrafts[String(p.id)];
  return draft !== undefined ? draft : (p.name || "");
}

function captureNameDrafts() {
  document.querySelectorAll("[data-portfolio-name-input]").forEach(input => {
    portfolioNameDrafts[String(input.dataset.portfolioNameInput)] = input.value;
  });
}

function portfolioOrderRows() {
  return state.portfolios.map((p, index) =>
    '<div class="portfolio-order-row" data-portfolio-order-id="' + esc(p.id) + '">' +
      '<input type="text" class="portfolio-order-name" maxlength="80" data-portfolio-name-input="' + esc(p.id) + '" value="' + esc(portfolioDraftName(p)) + '" aria-label="Nombre de la cartera">' +
      '<div>' +
        '<button type="button" data-portfolio-order-move="-1" aria-label="Subir cartera"' + (index === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" data-portfolio-order-move="1" aria-label="Bajar cartera"' + (index === state.portfolios.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="portfolio-order-delete" data-portfolio-delete="' + esc(p.id) + '" aria-label="Borrar cartera ' + esc(p.name) + '" title="Borrar cartera">🗑</button>' +
      '</div>' +
    '</div>'
  ).join("");
}

function refreshPortfolioOrderModal() {
  captureNameDrafts();
  const list = $("#portfolioOrderList");
  if (list) list.innerHTML = portfolioOrderRows();
}

function openPortfolioOrderModal(keepDrafts = false) {
  if (!state.portfolios.length) { closeModal(); return; }
  if (!keepDrafts) portfolioNameDrafts = {};
  openModal("Editar carteras",
    '<div class="portfolio-order-editor">' +
      '<p>Cambia el nombre, el orden o borra una cartera.</p>' +
      '<div id="portfolioOrderList" class="portfolio-order-list">' + portfolioOrderRows() + '</div>' +
      '<button type="button" class="btn" data-portfolio-order-save>Guardar cambios</button>' +
    '</div>'
  );
}

function openPortfolioDeleteConfirm(id) {
  captureNameDrafts();
  const p = state.portfolios.find(x => String(x.id) === String(id));
  if (!p) return;
  const count = state.positions.filter(x => String(x.portfolio_id) === String(id) && Number(x.active ?? 1) !== 0).length;
  openModal("Borrar cartera",
    '<div class="portfolio-remove-confirm">' +
      '<strong>' + esc(p.name) + '</strong>' +
      '<p>Se borrará la cartera con ' + (count === 1 ? '1 posición' : count + ' posiciones') + ', su historial de operaciones y su objetivo. No se puede deshacer.</p>' +
      '<div class="portfolio-remove-confirm-actions">' +
        '<button type="button" class="btn ghost" data-portfolio-delete-cancel>✕ Cancelar</button>' +
        '<button type="button" class="btn danger" data-portfolio-delete-confirm="' + esc(p.id) + '">Borrar cartera</button>' +
      '</div>' +
    '</div>'
  );
}

async function deletePortfolio(id, button) {
  if (button) { button.disabled = true; button.textContent = "Borrando…"; }
  try {
    const response = await api("/api/portfolios/" + encodeURIComponent(id), { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo borrar la cartera.");
    const removed = state.portfolios.find(p => String(p.id) === String(id));
    const keys = state.positions.filter(p => String(p.portfolio_id) === String(id)).map(p => p.stock_key);
    state.portfolios = state.portfolios.filter(p => String(p.id) !== String(id));
    state.positions = state.positions.filter(p => String(p.portfolio_id) !== String(id));
    delete state.goals[String(id)];
    delete state.portfolioTransactionSummaries[String(id)];
    delete portfolioNameDrafts[String(id)];
    if (String(state.selectedPortfolioId) === String(id)) {
      state.selectedPortfolioId = state.portfolios[0] ? state.portfolios[0].id : null;
      state.goal = state.goals[String(state.selectedPortfolioId)] || null;
    }
    state.goalCandidateCache = { at:0, key:"", rows:[] };
    savePortfolioUi();
    syncPortfolioStars();
    keys.forEach(stockKey => window.dispatchEvent(new CustomEvent("viewinvai:portfolio-membership-changed", { detail:{ stockKey } })));
    renderApp();
    if (state.portfolios.length) openPortfolioOrderModal(true); else closeModal();
    toast("Cartera «" + (removed && removed.name || "") + "» borrada");
  } catch (error) {
    toast(error.message || "No se pudo borrar la cartera.", true);
    if (button && button.isConnected) { button.disabled = false; button.textContent = "Borrar cartera"; }
  }
}

async function savePortfolioOrder() {
  captureNameDrafts();
  const names = state.portfolios.map(p => String(portfolioDraftName(p)).trim());
  if (names.some(name => !name)) { toast("Cada cartera necesita un nombre.", true); return; }
  const button = document.querySelector("[data-portfolio-order-save]");
  if (button) { button.disabled = true; button.textContent = "Guardando…"; }
  try {
    await Promise.all(state.portfolios.map((p, index) => {
      const name = names[index], body = { sortOrder: index };
      if (name !== p.name) body.name = name;
      if (Number(p.sort_order) === index && body.name === undefined) return null;
      return api("/api/portfolios/" + encodeURIComponent(p.id), {
        method: "PATCH",
        body: JSON.stringify(body)
      }).then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "No se pudieron guardar los cambios.");
        p.sort_order = index;
        if (data.portfolio && data.portfolio.name) p.name = data.portfolio.name; else if (body.name) p.name = body.name;
      });
    }));
    portfolioNameDrafts = {};
    closeModal();
    renderApp();
    toast("Carteras actualizadas");
  } catch (error) {
    toast(error.message || "No se pudieron guardar los cambios.", true);
    if (button && button.isConnected) { button.disabled = false; button.textContent = "Guardar cambios"; }
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

let portfolioLoadPromise=null;
async function loadAll({ syncFavorites = false } = {}) {
  if(portfolioLoadPromise)return portfolioLoadPromise;
  portfolioLoadPromise=(async()=>{
  if (!state.user || state.loading) return;
  perfCache.forEach(entry=>{entry.at=0});
  let ok = true;
  state.loading = true;
  renderActivePortfolioPanel();
  try {
    const [portfolios, positions, watchlist, brokerData, goalData] = await Promise.all([
      fetchJson("/api/portfolios"),fetchJson("/api/positions"),fetchJson("/api/watchlist"),
      fetchJson("/api/brokers").catch(()=>({brokers:[]})),
      fetchJson("/api/portfolio-goal").then(data=>({goals:data.goals||[],error:"",ok:true})).catch(error=>({goals:null,error:error.message||"No se pudieron cargar los objetivos.",ok:false}))
    ]);
    state.loadError="";
    state.portfolios=portfolios.portfolios||[];try{window.ViewInvAII18n&&window.ViewInvAII18n.protect(state.portfolios.map(x=>x&&x.name))}catch(_){}state.positions=positions.positions||[];state.watchlist=watchlist.watchlist||[];state.brokers=brokerData.brokers||[];
    if(Array.isArray(goalData.goals))state.goals=Object.fromEntries(goalData.goals.map(goal=>[String(goal.portfolio_id),goal]));
    const goalErrorText=String(goalData.error||"");
    state.goalError=/too many requests/i.test(goalErrorText)?"":goalErrorText;
    syncPortfolioStars();
    window.dispatchEvent(new CustomEvent('viewinvai:portfolio-membership-changed', {detail:{}}));
  } catch (error) {
    ok = false;
    console.warn("Portfolio loading failed", error);
    const raw=String(error&&error.message||"");
    state.loadError=/expired|invalid|authentication/i.test(raw)?"Tu sesión ha caducado o no se pudo verificar. Pulsa «Reintentar»; si sigue fallando, cierra sesión y vuelve a entrar.":
      /temporarily|unavailable|Failed to fetch|NetworkError/i.test(raw)?"El servidor no responde ahora mismo. Pulsa «Reintentar» en unos segundos.":(raw||"No se pudieron cargar las carteras.");
    if(state.portfolios.length)toast(state.loadError,true);
  } finally {
    state.loading = false;
    renderActivePortfolioPanel();
    goalPlanCache=null;
    window.dispatchEvent(new CustomEvent('viewinvai:portfolios-loaded', { detail: { ok } }));
    const summaryPortfolioId = state.selectedPortfolioId;
    if (summaryPortfolioId) refreshPortfolioTransactionSummary(summaryPortfolioId).catch(() => {});
  }
  return ok;
  })().finally(()=>{portfolioLoadPromise=null});
  return portfolioLoadPromise;
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

// Detector de operaciones incoherentes: explica un P&L realizado imposible antes de que se
// tome por bueno. No cambia nada; solo señala qué revisar y por qué.
function transactionIssues(rows){
  const issues=[],byStock=new Map();
  for(const tx of rows||[]){const k=String(tx.stock_key||tx.ticker||'');if(!byStock.has(k))byStock.set(k,[]);byStock.get(k).push(tx)}
  for(const list of byStock.values()){
    const sorted=list.slice().sort((a,b)=>String(a.executed_at||'').localeCompare(String(b.executed_at||''))||String(a.created_at||'').localeCompare(String(b.created_at||'')));
    const label=sorted[0].ticker||sorted[0].name||sorted[0].stock_key||'—';
    const trades=sorted.filter(t=>String(t.origin||'')!=='position-adjustment'&&num(t.quantity)>0&&num(t.price)>0);
    const currencies=new Set(trades.map(t=>String(t.currency||'EUR').toUpperCase()));
    if(currencies.size>1)issues.push({tx:null,ticker:label,kind:'currency',text:'Operaciones en varias divisas ('+[...currencies].join(', ')+'): el P&L no se puede calcular bien.'});
    // Precio muy alejado del resto (precio total en vez de unitario, contrasplit o divisa equivocada).
    const prices=trades.map(t=>num(t.price)).sort((a,b)=>a-b),med=prices.length>=3?prices[Math.floor(prices.length/2)]:null;
    const seen=new Map();let held=0,cost=0;
    const hasSeed=trades.some(t=>t.origin==='position-seed'),hasImport=trades.some(t=>/import|broker|sync|csv|flex/i.test(String(t.origin||'')));
    if(hasSeed&&hasImport)issues.push({tx:null,ticker:label,kind:'seed',text:'Tiene la compra inicial creada a mano y también compras importadas: puede contar dos veces la misma compra.'});
    for(const t of sorted){
      const side=String(t.side||'').toUpperCase(),q=num(t.quantity)||0,pr=num(t.price)||0,day=String(t.executed_at||'').slice(0,10);
      if(String(t.origin||'')==='position-adjustment'){held=q;cost=q*pr;continue}
      const dupKey=side+'|'+day+'|'+q+'|'+pr;
      if(seen.has(dupKey))issues.push({tx:t,ticker:label,kind:'dup',text:'Posible duplicado: misma fecha, cantidad y precio que otra '+(side==='BUY'?'compra':'venta')+'.'});
      seen.set(dupKey,t);
      if(med&&pr>0&&(pr<med*0.4||pr>med*2.5))issues.push({tx:t,ticker:label,kind:'price',text:'Precio '+formatMoney(pr,t.currency||'EUR')+' muy distinto del habitual ('+formatMoney(med,t.currency||'EUR')+'): ¿importe total en lugar de precio por acción, o un split?'});
      if(side==='BUY'){held+=q;cost+=q*pr;continue}
      if(side==='SELL'){
        if(q>held+1e-8)issues.push({tx:t,ticker:label,kind:'oversell',text:'Vende '+formatNumber(q,4)+' pero solo había '+formatNumber(held,4)+': falta alguna compra.'});
        const avg=held>1e-8?cost/held:null;
        if(avg&&pr<avg*0.4)issues.push({tx:t,ticker:label,kind:'loss',text:'Venta a '+formatMoney(pr,t.currency||'EUR')+' con coste medio '+formatMoney(avg,t.currency||'EUR')+' (−'+Math.round((1-pr/avg)*100)+' %): revisa precio o cantidades.'});
        const out=Math.min(q,held);cost-=avg?out*avg:0;held=Math.max(0,held-q);if(held<=1e-8){held=0;cost=0}
      }
    }
  }
  return issues;
}
function transactionIssuesHtml(rows){
  const issues=transactionIssues(rows);
  if(!issues.length)return '<div class="transaction-issues ok">✓ No se ven operaciones incoherentes.</div>';
  return '<details class="transaction-issues warn" open><summary>⚠ '+issues.length+' '+(issues.length===1?'operación a revisar':'operaciones a revisar')+'</summary><ul>'+
    issues.slice(0,40).map(i=>'<li><b>'+esc(i.ticker)+'</b>'+(i.tx&&i.tx.executed_at?' · '+esc(new Date(i.tx.executed_at).toLocaleDateString('es-ES')):'')+' — '+esc(i.text)+'</li>').join('')+
    '</ul><p>Corrígelo en el fichero del bróker y vuelve a importarlo, o borra la operación manual que sobre. El P&L realizado depende de estas filas.</p></details>';
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
      '<div class="transaction-total"><strong>' + (isAdjustment ? 'Saldo corregido' : formatMoney((num(tx.quantity) || 0) * (num(tx.price) || 0), txCurrency)) + '</strong><small>' + esc(tx.ticker || '') + (tx.notes ? ' · <span translate="no">' + esc(tx.notes) + '</span>' : '') + '</small></div>' +
      (['manual','position-adjustment'].includes(origin) ? '<button type="button" class="transaction-delete" data-transaction-delete="' + esc(tx.id) + '" aria-label="Eliminar operación">×</button>' : '') +
    '</div>';
  }).join('');
}

async function fetchTransactions(position) {
  const qs = new URLSearchParams({
    positionId: String(position.id || ''),
    portfolioId: String(position.portfolio_id || ''),
    stockKey: String(position.stock_key || ''),
    limit: '300'
  });
  return fetchJson('/api/transactions?' + qs.toString());
}

async function refreshPortfolioTransactionSummary(portfolioId, rerender = true) {
  portfolioId = String(portfolioId || "");
  if (!state.user || !portfolioId) return null;
  try {
    // Se traen las operaciones (no solo el resumen) para detectar las incoherentes: un precio o una cantidad
    // mal puestos dan un P&L realizado imposible y no se puede enseñar como bueno sin avisar.
    const data = await fetchJson('/api/transactions?portfolioId=' + encodeURIComponent(portfolioId) + '&limit=500');
    state.portfolioTransactionSummaries[portfolioId] = data.portfolioSummary || null;
    try { state.portfolioTxIssues[portfolioId] = transactionIssues(data.transactions || []).length; } catch (_) { state.portfolioTxIssues[portfolioId] = 0; }
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
        transactionIssuesHtml(rows) +
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
  // Bróker de la operación: el de la posición; si no lo tiene, el de su cartera (no se supone IBKR por
  // mirar la cotización de EE. UU.). Se puede cambiar: cada operación guarda su bróker y su comisión.
  const txPortfolio = (state.portfolios || []).find(pf => String(pf.id) === String(position.portfolio_id));
  const txBroker = String(position.broker || txPortfolio?.broker || (preferTr ? 'Trade Republic' : 'IBKR'));
  const txBrokerOptions = (brokerRecords().some(r => [r.name, r.canonical_name].some(v => String(v || '').toLowerCase() === txBroker.toLowerCase())) ? '' : '<option value="' + esc(txBroker) + '" selected>' + esc(txBroker) + '</option>') + brokerSelectOptions(txBroker);

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
            '<label><span>Bróker</span><select name="broker">' + txBrokerOptions + '</select></label>' +
            '<label><span>Divisa</span><input name="currency" value="' + esc(currency) + '" readonly></label>' +
          '</div>' +
          '<small class="broker-fee-hint" data-transaction-fee-hint></small>'+
          '<label><span>Fecha y hora</span><input name="executedAt" type="datetime-local" value="' + localDateTimeValue() + '" required></label>' +
          '<label><span>Nota</span><input name="notes" maxlength="1000" placeholder="Opcional"></label>' +
          '<div class="portfolio-form-status" data-transaction-status aria-live="polite"></div>' +
          '<button type="submit" class="btn">Registrar operación</button>' +
        '</form>' +
        positionFreezeFormHtml(position) +
        '<div class="transaction-history-head"><strong>Historial</strong><span>' + (data.transactions || []).length + ' operaciones</span></div>' +
        '<div class="transaction-history">' + transactionRowsHtml(data.transactions || [], currency) + '</div>' +
      '</div>';
    const txForm=$('#transactionForm');
    if(txForm){
      const refreshFee=()=>{
        const side=String(txForm.querySelector('[name="side"]')?.value||'BUY').toUpperCase();
        const qty=num(txForm.querySelector('[name="quantity"]')?.value)||0;
        const price=num(txForm.querySelector('[name="price"]')?.value)||num(market.price)||0;
        const broker=String(txForm.querySelector('[name="broker"]')?.value||txBroker);
        const fee=brokerFeeInCurrency(broker,qty,price,currency,side,position.exchange||'');
        const input=txForm.querySelector('[name="fees"]'),hint=txForm.querySelector('[data-transaction-fee-hint]'),submit=txForm.querySelector('button[type="submit"]');
        if(input)input.value=fee.fee===null?'':String(Math.round((fee.fee+Number.EPSILON)*1000000)/1000000);
        if(hint){
          hint.textContent=fee.fee===null?'Comisión pendiente de verificación · no se registrará una operación con una tarifa inventada':'Comisión '+formatMoney(fee.fee,fee.currency)+' · '+fee.label;
          hint.classList.toggle('pending',fee.fee===null);
        }
        if(submit)submit.disabled=fee.fee===null;
      };
      ['side','quantity','price','broker'].forEach(name=>txForm.querySelector('[name="'+name+'"]')?.addEventListener(name==='side'||name==='broker'?'change':'input',refreshFee));
      refreshFee();
    }
  } catch (error) {
    const body = $('#portfolioModalBody');
    if (body) body.innerHTML = '<div class="portfolio-empty-state compact">No se pudieron cargar las operaciones.</div>';
    toast(error.message || 'No se pudieron cargar las operaciones.', true);
  }
}

// «Congelar acciones»: cantidad (con decimales) y fecha hasta la que el Objetivo no las toca.
function positionFreezeFormHtml(position){
  const held=num(position.quantity)||0,active=positionFrozenQty(position),until=String(position.frozen_until||"").slice(0,10);
  const today=new Date().toLocaleDateString("sv-SE");
  const status=active>0
    ?'Congeladas '+formatNumber(active,6)+' de '+formatNumber(held,6)+' acciones hasta el '+new Date(until+"T12:00:00").toLocaleDateString("es-ES",{day:"numeric",month:"long",year:"numeric"})+' (incluido). El Objetivo no propone vender, stops ni cambios con ellas.'
    :'Ninguna acción congelada. El Objetivo puede proponer vender, stops o cambios con toda la posición.';
  return '<form id="positionFreezeForm" class="portfolio-form transaction-form position-freeze-form" data-position-id="'+esc(position.id)+'">'+
    '<div class="transaction-form-head"><strong>Congelar acciones</strong><span>no se tocan hasta la fecha</span></div>'+
    '<p class="position-freeze-status'+(active>0?' active':'')+'">'+esc(status)+'</p>'+
    '<div class="portfolio-form-grid">'+
      '<label><span>Cantidad congelada</span><input name="frozenQty" type="number" inputmode="decimal" step="any" min="0" max="'+esc(String(held))+'" value="'+(active>0?esc(String(active)):'')+'" placeholder="p. ej. '+esc(formatNumber(held,4))+'"></label>'+
      '<label><span>Hasta (incluido)</span><input name="frozenUntil" type="date" min="'+today+'" value="'+(active>0?esc(until):'')+'"></label>'+
    '</div>'+
    '<div class="portfolio-form-status" data-freeze-status aria-live="polite"></div>'+
    '<div class="position-freeze-actions"><button type="submit" class="btn">Guardar congelación</button>'+
    (active>0?'<button type="button" class="btn ghost" data-freeze-clear>❄ Descongelar</button>':'')+'</div>'+
  '</form>';
}
async function savePositionFreeze(form,clear=false){
  if(!form||form.dataset.saving==='1')return;
  const position=transactionPosition(form.dataset.positionId);
  if(!position)return toast('No se encuentra la posición.',true);
  const status=form.querySelector('[data-freeze-status]');
  const quantity=clear?0:(num(form.querySelector('[name="frozenQty"]')?.value)||0);
  const until=clear?'':String(form.querySelector('[name="frozenUntil"]')?.value||'');
  if(!clear&&quantity>0&&!until){if(status)status.textContent='Indica hasta qué fecha quedan congeladas.';return}
  if(!clear&&quantity>(num(position.quantity)||0)+1e-9){if(status)status.textContent='No puedes congelar más acciones de las que tienes.';return}
  form.dataset.saving='1';if(status)status.textContent='Guardando…';
  try{
    const response=await api('/api/positions/'+encodeURIComponent(position.id)+'/freeze',{method:'POST',body:JSON.stringify({quantity,until})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'No se pudo guardar la congelación.');
    if(data.position){
      const i=state.positions.findIndex(p=>String(p.id)===String(position.id));
      if(i>=0)state.positions[i]={...state.positions[i],...data.position};
    }
    goalPlanCache=null;
    toast(quantity>0?'Acciones congeladas: el Objetivo no las tocará hasta la fecha.':'Acciones descongeladas.');
    form.outerHTML=positionFreezeFormHtml(transactionPosition(position.id)||position);
    renderApp();
  }catch(error){
    if(status)status.textContent=error.message||'No se pudo guardar la congelación.';
  }finally{form.dataset.saving=''}
}

// «Decidir ▾» en una tarjeta de STOP/VENDER del Objetivo: vender ahora o mantener con una condición.
function openGoalDecisionModal(positionId){
  const ctx=lastGoalCtx,pos=ctx&&ctx.positions.find(p=>String(p.row.p.id)===String(positionId));
  const raw=state.positions.find(p=>String(p.id)===String(positionId));
  if(!pos||!raw)return toast("No se encuentra la posición en el plan del Objetivo.",true);
  const price=num(pos.bidEur)??num(pos.priceEur),avg=num(pos.avgEur),units=num(pos.units)||0,fee=num(pos.feeEur)||1;
  // Punto sin pérdidas: coste neto que queda (compras con sus comisiones) más la comisión de venta.
  const totalQty=num(raw.quantity)||units,cost=num(raw.cost_basis);
  const costEur=cost!==null?portfolioConvertAmount(cost*(totalQty>0?units/totalQty:1),String(raw.currency||"EUR").toUpperCase(),"EUR",ctx.fx):null;
  const breakeven=units>0?(costEur!==null?(costEur+fee)/units:avg!==null?avg+(2*fee)/units:null):null;
  const cat=goalNextCatalyst(pos.row.stock),current=goalDecisionFor(positionId);
  const in7=new Date(Date.now()+7*86400000).toLocaleDateString("sv-SE"),today=new Date().toLocaleDateString("sv-SE");
  const eur=v=>v===null?"—":formatMoney(v,"EUR");
  const opt=(value,title,desc,extra="",disabled=false)=>'<label class="goal-decide-option'+(disabled?' disabled':'')+'"><input type="radio" name="mode" value="'+value+'"'+(disabled?' disabled':'')+'><span><b>'+esc(title)+'</b><small>'+desc+'</small>'+extra+'</span></label>';
  openModal("Decidir · "+(pos.label||pos.ticker),
    '<form id="goalDecisionForm" class="portfolio-form goal-decide-form" data-position-id="'+esc(positionId)+'">'+
      '<p class="goal-decide-head">Precio actual '+eur(price)+' · tu precio medio '+eur(avg)+(breakeven!==null?' · sin pérdidas desde '+eur(breakeven)+' (con comisiones)':'')+'</p>'+
      opt("sell","Vender ahora","Abre el registro de la venta con el precio ejecutable.")+
      opt("recover","Mantener hasta recuperar","El Objetivo propondrá vender cuando llegue a "+esc(eur(breakeven))+".")+
      opt("pct","Mantener hasta +X %","Vender cuando gane este porcentaje sobre tu precio medio (con comisiones).",'<span class="goal-decide-inline"><input name="pct" type="number" inputmode="decimal" step="any" min="0.1" value="5" aria-label="Porcentaje"> %</span>')+
      opt("catalyst","Mantener hasta el catalizador",cat?esc(cat.label)+" · "+esc(new Date(cat.date+"T12:00:00").toLocaleDateString("es-ES",{day:"numeric",month:"long"}))+". Al día siguiente el Objetivo la vuelve a evaluar.":"Sin catalizador con fecha conocido para esta acción.","",!cat)+
      opt("better","Mantener hasta un cambio mejor","Solo propone soltarla si aparece una alternativa con score ≥ 85/100 cuya ganancia prevista cubra la pérdida y las comisiones.")+
      opt("date","Revisar el día…","Pausa: el Objetivo no propone nada hasta esa fecha.",'<input name="until" type="date" min="'+today+'" value="'+in7+'" aria-label="Fecha">')+
      '<label class="goal-decide-emergency"><input type="checkbox" name="emergency" checked> Stop de emergencia si cae otro <input name="emergencyPct" type="number" inputmode="decimal" step="any" min="1" max="90" value="15" aria-label="Caída"> % desde ahora</label>'+
      '<div class="portfolio-form-status" data-goal-decide-status aria-live="polite"></div>'+
      '<div class="position-freeze-actions"><button type="submit" class="btn">Guardar decisión</button>'+
      (current?'<button type="button" class="btn ghost" data-goal-decide-clear="'+esc(positionId)+'">✕ Quitar decisión</button>':'')+'</div>'+
    '</form>');
  const form=$("#goalDecisionForm");
  if(form)form.dataset.ctx=JSON.stringify({price,avg,breakeven,catDate:cat?cat.date:"",units,fee});
}
async function saveGoalDecisionForm(form){
  if(!form||form.dataset.saving==="1")return;
  const positionId=form.dataset.positionId,c=JSON.parse(form.dataset.ctx||"{}"),fd=new FormData(form),mode=String(fd.get("mode")||"");
  const status=form.querySelector("[data-goal-decide-status]");
  if(!mode){if(status)status.textContent="Elige una opción.";return}
  if(mode==="sell"){
    closeModal();
    // La venta se prepara aquí (no depende de que haya una tarjeta de venta en pantalla).
    const pos=lastGoalCtx&&lastGoalCtx.positions.find(p=>String(p.positionId)===String(positionId));
    const row=pos&&pos.row;
    const q=row?goalExecutionQuote(row.stock,row.preferTr,"SELL",lastGoalCtx.fx,row.p.broker,pos.units):null;
    const html=row&&q?goalOperationButtonHtml({side:"SELL",portfolioId:row.p.portfolio_id,positionId:row.p.id,broker:row.p.broker,stockKey:row.p.stock_key,units:pos.units,price:q.price??portfolioConvertAmount(num(pos.bidEur)??num(pos.priceEur),"EUR",q.currency||row.p.currency||"EUR",lastGoalCtx.fx),fees:q.feeNative??q.feeEur,currency:q.currency||row.p.currency||"EUR",preferTr:row.preferTr,executable:q.executable===true,executionReason:q.executionReason}):"";
    const holder=document.createElement("div");holder.innerHTML=html;
    const btn=holder.querySelector("[data-register-goal-operation]");
    if(btn)openGoalOperationModal(btn);else toast("La venta se podrá registrar cuando haya cotización ejecutable.");
    if(goalDecisionFor(positionId)&&window.ViewInvAIDecisions)try{await window.ViewInvAIDecisions.clear(positionId)}catch(_){}
    return;
  }
  const price=num(c.price),avg=num(c.avg),units=num(c.units)||0,fee=num(c.fee)||1;
  const body={positionId,decision:mode==="catalyst"||mode==="date"?"later":"hold",holdMode:mode};
  if(mode==="recover")body.targetEur=num(c.breakeven);
  if(mode==="pct"){
    const pct=num(fd.get("pct"));if(!(pct>0)){if(status)status.textContent="Indica el porcentaje.";return}
    const be=num(c.breakeven)??(avg!==null?avg+(units>0?2*fee/units:0):null);
    body.holdPct=pct;body.targetEur=be!==null?be*(1+pct/100):null;
  }
  if(mode==="catalyst")body.holdUntil=c.catDate;
  if(mode==="date"){body.holdUntil=String(fd.get("until")||"");if(!body.holdUntil){if(status)status.textContent="Indica la fecha.";return}}
  if(fd.get("emergency")&&price!==null){const e=num(fd.get("emergencyPct"));if(e>0)body.emergencyEur=price*(1-e/100)}
  const raw=state.positions.find(p=>String(p.id)===String(positionId));
  if(raw&&String(raw.currency||"EUR").toUpperCase()==="EUR"&&price!==null)body.price=price;
  form.dataset.saving="1";if(status)status.textContent="Guardando…";
  try{
    const response=await api("/api/position-decisions",{method:"POST",body:JSON.stringify(body)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"No se pudo guardar la decisión.");
    if(window.ViewInvAIDecisions&&typeof window.ViewInvAIDecisions.load==="function")await window.ViewInvAIDecisions.load(true);
    goalPlanCache=null;closeModal();toast("Decisión guardada: el Objetivo la respetará.");renderApp();
  }catch(error){if(status)status.textContent=error.message||"No se pudo guardar la decisión."}
  finally{form.dataset.saving=""}
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
    positionId: position.id,
    broker: String(fd.get('broker') || position.broker || (preferTr ? 'Trade Republic' : 'IBKR')),
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
    currency: String(fd.get('currency') || position.currency || 'EUR').toUpperCase(),
    executedAt: Number.isFinite(executedDate.getTime()) ? executedDate.toISOString() : '',
    notes: String(fd.get('notes') || '')
  };
  const portfolio=state.portfolios.find(item=>String(item.id)===String(position.portfolio_id));
  const cashFxRate=portfolioCashFxRateFor(portfolio,payload.currency);
  if(cashFxRate!==null)payload.cashFxRate=cashFxRate;
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

// Antes de registrar una compra: tres comprobaciones contra el FOMO y avisos si se opera mucho o la acción ya ha subido.
function goalBuyChecklistHtml(portfolioId,riskEur,dayPct){
  const week=Date.now()-7*864e5;
  const recent=state.positions.filter(p=>String(p.portfolio_id)===String(portfolioId)&&Date.parse(p.last_buy_at||p.opened_at||"")>=week).length;
  const warn=[];
  if(recent>=4)warn.push("Llevas "+recent+" compras esta semana en esta cartera: operar mucho suele salir caro (comisiones y decisiones precipitadas).");
  if(dayPct!==null&&dayPct>=5)warn.push("Hoy ya sube un "+formatNumber(dayPct,1)+" %: comprar después de una subida fuerte es la forma más habitual de FOMO.");
  const box=(name,text)=>'<label class="goal-fomo-check"><input type="checkbox" data-goal-fomo="'+name+'"> <span>'+text+'</span></label>';
  return '<div class="goal-fomo" data-goal-fomo-box>'+(warn.length?'<p class="portfolio-form-note warn">'+warn.map(esc).join('<br>')+'</p>':'')+
    '<strong>Antes de registrarla</strong>'+
    box("why","Sé por qué compro y qué me haría vender (el stop).")+
    box("loss",riskEur!==null?"Acepto que puedo perder ≈ "+esc(formatMoney(riskEur,"EUR"))+" si salta el stop, o más si abre con un hueco.":"Acepto que puedo perder dinero si salta el stop, o más si abre con un hueco.")+
    box("fomo","No la compro solo porque está subiendo o porque «se me escapa».")+'</div>';
}
function openGoalOperationModal(button){
  if(!button)return;
  const side=String(button.dataset.registerGoalOperation||"BUY").toUpperCase();
  const portfolioId=button.dataset.goalPortfolio||state.selectedPortfolioId,stockKey=button.dataset.goalStockKey||"";
  const stock=stockByKey(stockKey),portfolio=state.portfolios.find(p=>String(p.id)===String(portfolioId));
  if(!stock||!portfolio)return toast("No se pudo preparar la operación.",true);
  const preferTr=button.dataset.goalPreferTr==="1",currency=String(button.dataset.goalCurrency||(preferTr?"EUR":"USD")).toUpperCase();
  const units=goalOperationUnits(side,button.dataset.goalUnits),price=num(button.dataset.goalPrice);
  if(!(units>0)||price===null)return toast("La recomendación no contiene una operación ejecutable.",true);
  const positionId=String(button.dataset.goalPositionId||"");
  const position=positionId
    ?state.positions.find(p=>String(p.id)===positionId&&Number(p.active)!==0)||null
    :null;
  if(side==="SELL"&&!position)return toast("No se encuentra la posición exacta que se quiere vender.",true);
  const broker=String((position&&position.broker)||button.dataset.goalBroker||brokerDefaultName(portfolio,preferTr)).trim();
  const ticker=(preferTr&&stock.trTicker)||stock.ticker||position?.ticker||"",name=stock.name||position?.name||ticker;
  const exchange=preferTr?(stock.trExchange||"LSX"):(stock.exchange||position?.exchange||"");
  const isin=preferTr?(stock.trIsin||stock.isin||position?.isin||""):(stock.usIsin||stock.isin||position?.isin||"");
  const feeInfo=brokerFeeInCurrency(broker,units,price,currency,side,exchange),fee=feeInfo.fee;
  // Orden ya ejecutada con un bróker cuya comisión no sabemos calcular: la escribe el usuario (la de su extracto).
  const manualFee=fee===null&&button.dataset.goalUnverified==="1";
  openModal((side==="BUY"?"Registrar estrategia de compra · ":"Registrar estrategia de venta · ")+ticker,
    '<form id="goalOperationForm" class="portfolio-form transaction-form" data-portfolio-id="'+esc(portfolioId)+'" data-sleeve="'+esc(side==="BUY"?String(button.dataset.goalSleeve||""):"")+'" data-position-id="'+esc(position?.id||"")+'" data-broker="'+esc(broker)+'" data-stock-key="'+esc(stockKey)+'" data-prefer-tr="'+(preferTr?'1':'0')+'" data-ticker="'+esc(ticker)+'" data-name="'+esc(name)+'" data-exchange="'+esc(exchange)+'" data-isin="'+esc(isin)+'">'+
      '<div class="transaction-form-head"><strong>'+esc(side==="BUY"?"Compra recomendada":"Venta recomendada")+'</strong><span>'+esc(name)+' · '+esc(portfolio.name)+'</span></div>'+
      goalSleeveOperationNote(side,button.dataset.goalSleeve,position)+
      '<input name="side" type="hidden" value="'+esc(side)+'">'+
      '<div class="portfolio-form-grid">'+
        '<label><span>Acciones</span><input name="quantity" type="number" inputmode="decimal" step="any" min="0.000001"'+(side==="SELL"&&position?' max="'+esc(String(Math.max(0,(num(position.quantity)||0)-positionFrozenQty(position))))+'"':'')+' value="'+esc(String(units))+'" required></label>'+
        '<label><span>Precio ejecutado</span><input name="price" type="number" inputmode="decimal" step="any" min="0" value="'+esc(String(price))+'" required></label>'+
      '</div>'+
      '<div class="portfolio-form-grid">'+
        '<label><span>Broker</span><input name="broker" value="'+esc(broker)+'" readonly></label>'+
        '<label><span>Divisa</span><input name="currency" value="'+esc(currency)+'" readonly></label>'+
      '</div>'+
      '<label><span>'+(manualFee?'Comisión de tu orden':'Comisión automática')+'</span><input name="fees" type="number" inputmode="decimal" step="any" min="0" value="'+esc(fee===null?"":String(fee))+'"'+(manualFee?' required':' readonly')+'></label>'+
      '<small class="broker-fee-hint'+(fee===null?' pending':'')+'" data-goal-fee-hint>'+(manualFee?'Escribe la comisión que te cobró el bróker':fee===null?'Comisión pendiente de verificación':'Comisión '+esc(formatMoney(fee,currency))+' · '+esc(feeInfo.label||broker))+'</small>'+
      '<label><span>Fecha y hora</span><input name="executedAt" type="datetime-local" value="'+localDateTimeValue()+'" required></label>'+
      '<label><span>Nota</span><input name="notes" maxlength="1000" value="'+esc("Objetivo IA · "+(side==="BUY"?"compra":"venta")+" recomendada")+'"></label>'+
      (button.dataset.goalUnverified==="1"?'<p class="portfolio-form-note warn"><strong>Pon el precio real de tu orden.</strong> La app no pudo verificar una cotización ejecutable ahora; el precio de partida es solo de referencia.</p>':'')+
      (side==="BUY"?goalBuyChecklistHtml(portfolioId,num(button.dataset.goalRisk),num(button.dataset.goalDay)):'')+
      '<p class="portfolio-form-note">Registra la operación cuando se haya ejecutado. Corrige el precio si difiere del límite recomendado; la comisión y el efectivo se recalculan automáticamente.</p>'+
      '<div class="portfolio-form-status" data-goal-operation-status aria-live="polite"></div>'+
      '<button type="submit" class="btn"'+(fee===null&&!manualFee?' disabled':'')+'>＋ Registrar estrategia</button>'+
    '</form>'
  );
  const form=$("#goalOperationForm");
  if(form){
    // Compra: el botón de registrar se activa solo con las tres comprobaciones marcadas.
    const fomo=[...form.querySelectorAll("[data-goal-fomo]")];
    if(fomo.length){
      const submit=form.querySelector('button[type="submit"]'),sync=()=>{if(submit)submit.dataset.fomoBlocked=fomo.every(x=>x.checked)?"":"1";if(submit)submit.disabled=submit.dataset.fomoBlocked==="1"||submit.dataset.feeBlocked==="1"};
      if(submit)submit.dataset.feeBlocked=submit.disabled?"1":"";
      fomo.forEach(x=>x.addEventListener("change",sync));sync();
    }
    const refreshFee=()=>{
      if(manualFee)return;
      const qty=Math.max(0,num(form.querySelector('[name="quantity"]')?.value)||0);
      const px=num(form.querySelector('[name="price"]')?.value);
      const info=brokerFeeInCurrency(broker,qty,px,currency,side,exchange);
      const input=form.querySelector('[name="fees"]'),hint=form.querySelector('[data-goal-fee-hint]'),submit=form.querySelector('button[type="submit"]');
      if(input)input.value=info.fee===null?"":String(info.fee);
      if(hint){hint.textContent=info.fee===null?'Comisión pendiente de verificación':'Comisión '+formatMoney(info.fee,currency)+' · '+(info.label||broker);hint.classList.toggle('pending',info.fee===null)}
      if(submit){submit.dataset.feeBlocked=info.fee===null?"1":"";submit.disabled=info.fee===null||submit.dataset.fomoBlocked==="1"}
    };
    form.querySelector('[name="quantity"]')?.addEventListener('input',refreshFee);
    form.querySelector('[name="price"]')?.addEventListener('input',refreshFee);
  }
}

async function saveGoalOperationForm(form){
  if(!form||form.dataset.saving==="1")return;
  const fd=new FormData(form),preferTr=form.dataset.preferTr==="1",side=String(fd.get("side")||"BUY").toUpperCase();
  const executedDate=new Date(String(fd.get("executedAt")||""));
  const payload={
    portfolioId:form.dataset.portfolioId,positionId:form.dataset.positionId||"",broker:form.dataset.broker||String(fd.get("broker")||""),
    stockKey:form.dataset.stockKey,ticker:form.dataset.ticker||"",
    name:form.dataset.name||"",exchange:form.dataset.exchange||"",isin:form.dataset.isin||"",preferTr,
    side,quantity:goalOperationUnits(side,fd.get("quantity")),price:num(fd.get("price")),
    fees:num(fd.get("fees")),currency:String(fd.get("currency")||(preferTr?"EUR":"USD")).toUpperCase(),
    executedAt:Number.isFinite(executedDate.getTime())?executedDate.toISOString():"",notes:String(fd.get("notes")||""),
    ...(form.dataset.sleeve?{sleeve:form.dataset.sleeve}:{})
  };
  const portfolio=state.portfolios.find(item=>String(item.id)===String(payload.portfolioId));
  const baseCurrency=String(portfolio&&portfolio.base_currency||payload.currency).toUpperCase(),fxUsdEur=portfolioUsdToEurRate();
  if(baseCurrency!==payload.currency){
    if(payload.currency==="USD"&&baseCurrency==="EUR"&&num(fxUsdEur)!==null)payload.cashFxRate=num(fxUsdEur);
    else if(payload.currency==="EUR"&&baseCurrency==="USD"&&num(fxUsdEur)!==null&&num(fxUsdEur)>0)payload.cashFxRate=1/num(fxUsdEur);
  }
  const status=form.querySelector("[data-goal-operation-status]"),button=form.querySelector('button[type="submit"]');
  if(!(payload.quantity>0)||payload.price===null||payload.price<0||!payload.executedAt){if(status)status.textContent="Revisa cantidad, precio y fecha.";return}
  if(side==="SELL"&&payload.positionId){
    const pos=state.positions.find(p=>String(p.id)===String(payload.positionId));
    const free=pos?Math.max(0,(num(pos.quantity)||0)-positionFrozenQty(pos)):null;
    if(free!==null&&payload.quantity>free+1e-9){if(status)status.textContent="Solo puedes vender "+formatNumber(free,6)+" acciones: el resto están congeladas.";return}
  }
  form.dataset.saving="1";if(button){button.disabled=true;button.textContent="Guardando…"}
  try{
    const response=await api("/api/transactions",{method:"POST",body:JSON.stringify(payload)}),data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"No se pudo registrar la operación.");
    await loadAll();
    state.goalCandidateCache={at:0,key:"",rows:[]};
    const cash=data.cashAdjustment&&data.cashAdjustment.adjusted?(" · efectivo "+formatMoney(data.cashAdjustment.cashBalance,data.cashAdjustment.baseCurrency||"EUR")):"";
    toast((side==="BUY"?"Compra":"Venta")+" registrada"+cash);
    // Una compra registrada cierra la orden puesta de ese valor (si la había).
    if(side==="BUY"){const g=state.goals[String(payload.portfolioId)],k=goalStockKey(stockByKey(payload.stockKey))||String(payload.stockKey||"").toUpperCase(),o=goalPendingOrders(g).find(x=>x.key===k||sameStockRef(x.key,payload.stockKey));
      if(o)api("/api/portfolio-goal",{method:"PATCH",body:JSON.stringify({portfolioId:payload.portfolioId,cancelOrder:o.key})}).then(r=>r.json()).then(d=>{if(d&&d.goal){state.goals[String(payload.portfolioId)]=d.goal;if(String(state.selectedPortfolioId)===String(payload.portfolioId))state.goal=d.goal;if(state.primaryTab==="goal")renderGoalApp()}}).catch(()=>null)}
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

function openNewPortfolioModal(options={}) {
  if (!state.user) return window.ViewInvAIAuth && window.ViewInvAIAuth.signIn();
  const marketScope=String(options.marketScope||"auto");
  const broker=String(options.broker||"");
  const baseCurrency=String(options.baseCurrency||(marketScope==="us"?"USD":"EUR")).toUpperCase();
  openModal("Nueva cartera",
    '<form id="newPortfolioForm" class="portfolio-form">' +
      '<label><span>Nombre</span><input name="name" required maxlength="80" placeholder="'+(marketScope==="us"?'Cartera EEUU':'Trade Republic')+'"></label>' +
      '<label><span>Bróker</span><input name="broker" maxlength="80" value="'+esc(broker)+'" placeholder="Trade Republic, IBKR…"></label>' +
      '<label><span>Mercado de la cartera</span><select name="marketScope" required><option value="auto"'+(marketScope==="auto"?' selected':'')+'>Detectar por posiciones</option><option value="tr"'+(marketScope==="tr"?' selected':'')+'>Trade Republic / LSX</option><option value="us"'+(marketScope==="us"?' selected':'')+'>EEUU (NASDAQ / NYSE / AMEX)</option></select></label>' +
      '<label><span>Divisa base</span><select name="baseCurrency"><option'+(baseCurrency==="EUR"?' selected':'')+'>EUR</option><option'+(baseCurrency==="USD"?' selected':'')+'>USD</option><option'+(baseCurrency==="GBP"?' selected':'')+'>GBP</option></select></label>' +
      '<label><span>Efectivo disponible</span><input name="cashBalance" type="number" min="0" step="0.01" inputmode="decimal" value="0" placeholder="0"></label>' +
      '<button type="submit" class="btn">Crear cartera</button>' +
    '</form>'
  );
  const form=$("#newPortfolioForm");
  if(form){
    if(options.pendingStockKey)form.dataset.pendingStockKey=String(options.pendingStockKey);
    if(options.pendingPreferTr!==undefined&&options.pendingPreferTr!==null)form.dataset.pendingPreferTr=options.pendingPreferTr===true?"1":options.pendingPreferTr===false?"0":String(options.pendingPreferTr);
  }
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
  goalSleeveCashPrompt(portfolioId);
}

function stockFormPayload(stock, form) {
  const fd = new FormData(form);
  const preferTr = form.dataset.preferTr === "1";
  const ticker = preferTr && stock.trTicker ? stock.trTicker : stock.ticker;
  const payload={
    portfolioId: String(fd.get("portfolioId") || form.querySelector('[name="portfolioId"]')?.value || ""),
    stockKey: window.ViewInvAI.getStockKey(stock),
    ticker: String(ticker || stock.ticker || ""),
    name: stock.name || "",
    exchange: preferTr ? (stock.trExchange || "LSX") : (stock.exchange || ""),
    isin: preferTr ? (stock.trIsin || stock.isin || "") : (stock.isin || stock.usIsin || ""),
    preferTr,
    quantity: num(fd.get("quantity")),
    avgPrice: num(fd.get("avgPrice")),
    currency: String(fd.get("currency") || form.querySelector('[name="currency"]')?.value || (preferTr ? "EUR" : stock.currency || "USD")).toUpperCase(),
    openedAt: String(fd.get("openedAt") || ""),
    notes: String(fd.get("notes") || ""),
    broker: String(fd.get("broker") || form.querySelector('[data-broker-select]')?.value || "")
  };
  const portfolio=state.portfolios.find(item=>String(item.id)===String(payload.portfolioId));
  const feeInfo=brokerFeeInCurrency(payload.broker,payload.quantity,payload.avgPrice,payload.currency,'BUY',payload.exchange);
  if(feeInfo.fee!==null)payload.fees=feeInfo.fee;
  const cashFxRate=portfolioCashFxRateFor(portfolio,payload.currency);
  if(cashFxRate!==null)payload.cashFxRate=cashFxRate;
  return payload;
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
function brokerIsIbkr(name){
  const row=brokerRecordByName(name),key=String(row&&row.code||row&&row.canonical_name||name||"").toLowerCase();
  return key==="ibkr"||/interactive\s*brokers/.test(key);
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
  const marketLock=String(form.dataset.marketLock||'');
  const lockedPreferTr=marketLock==='tr'?true:marketLock==='us'?false:null;
  const brokerSelect=form.querySelector('[data-broker-select]');
  let broker=String(brokerSelect?.value||form.dataset.defaultBroker||brokerDefaultName(portfolio,lockedPreferTr===null?fallbackPreferTr:lockedPreferTr)).trim();
  if(brokerSelect&&!brokerSelect.value){
    brokerSelect.value=broker;
    broker=brokerSelect.value||broker;
  }
  let preferTr=lockedPreferTr!==null
    ?lockedPreferTr
    :(brokerIsTradeRepublic(broker)?true:brokerIsIbkr(broker)?false:(scope==="tr"?true:scope==="us"?false:fallbackPreferTr));
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
    else if(brokerIsIbkr(broker))currency.value='USD';
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

  const listingConflict=(scope==="tr"&&!preferTr)||(scope==="us"&&preferTr);
  const brokerListingConflict=(marketLock==='us'&&brokerIsTradeRepublic(broker))||(marketLock==='tr'&&brokerIsIbkr(broker));
  const incompatible=(preferTr&&!(stock.tradeRepublicTradable===true||(stock.tradeRepublicVerified&&stock.trTicker)))||listingConflict||brokerListingConflict;
  const feePreview=brokerFeeInCurrency(broker,num(quantity?.value)||1,num(avgPrice?.value)||num(current.price)||0,finalCurrency,'BUY',exchange);
  if(save){
    save.disabled=!portfolio||incompatible||(!isEdit&&feePreview.fee===null);
    save.textContent=isEdit?'Guardar cambios':existing?'Añadir compra':'Registrar operación';
  }
  if(mode)mode.textContent=!portfolio
    ?'Selecciona una cartera compatible para registrar la operación.'
    :listingConflict
      ?'Esta cartera no admite el mercado desde el que has abierto la acción.'
    :brokerListingConflict
      ?'El broker seleccionado no corresponde al mercado desde el que has abierto la acción.'
    :incompatible
      ?'Esta acción no está verificada para Trade Republic / LSX y no puede añadirse a esta cartera.'
    :isEdit&&existing
      ?'Corrigiendo posición · broker y mercado bloqueados para no mezclar historiales.'
      :existing
        ?'Ya tienes '+formatNumber(existing.quantity,4)+' uds. en '+broker+' · media '+formatMoney(existing.avg_price,existing.currency||finalCurrency)+'. Esta compra se sumará y recalculará el precio medio.'
        :'Nueva posición · '+broker+' · '+portfolioMarketLabel(scope)+'.';
  if(feeHint){
    const fee=feePreview;
    feeHint.textContent=fee.fee===null
      ?(fee.reason==="market-mismatch"?'Comisión no disponible para este mercado con el plan seleccionado':'Comisión: pendiente de verificar')
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
  const fee=brokerFeeInCurrency(broker,quantity,price,currency,'BUY',form.dataset.preferTr==="1"?(stock.trExchange||"LSX"):(stock.exchange||""));
  hint.textContent=fee.fee===null?(fee.reason==="market-mismatch"?'Comisión no disponible para este mercado con el plan seleccionado':'Comisión automática pendiente de verificar'):'Comisión estimada '+formatMoney(fee.fee,fee.currency)+' · '+fee.label;
  hint.classList.toggle('pending',fee.fee===null);
  const save=form.querySelector('[data-save-position]');
  if(save&&!form.dataset.editPositionId)save.disabled=fee.fee===null;
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
function openAddPositionModal(stockKey, preferTrOverride = null, portfolioIdOverride = null, editPositionId = null, preset = null) {
  if(!state.user)return window.ViewInvAIAuth&&window.ViewInvAIAuth.signIn();
  if(!state.portfolios.length){toast("Primero crea una cartera.",true);openNewPortfolioModal();return}
  const stock=stockByKey(stockKey);
  if(!stock){toast("Abre primero una acción para añadirla.",true);return}

  const editPosition=editPositionId?state.positions.find(p=>String(p.id)===String(editPositionId))||null:null;
  const memberships=activePortfolioMemberships(stockKey);
  const explicitMarket=editPosition?null:(preferTrOverride===true?'tr':preferTrOverride===false?'us':null);
  const portfolioCompatible=p=>{
    if(!p)return false;
    const ps=portfolioMarketScope(p);
    if(explicitMarket==='tr')return ps!=='us';
    if(explicitMarket==='us')return ps!=='tr';
    return true;
  };
  const candidateIds=[
    editPosition?.portfolio_id,
    portfolioIdOverride,
    state.selectedPortfolioId,
    ...memberships
      .filter(m=>explicitMarket===null||Number(m.position.prefer_tr)===(explicitMarket==='tr'?1:0))
      .map(m=>m.position.portfolio_id),
    ...state.portfolios.filter(portfolioCompatible).map(p=>p.id)
  ].filter(Boolean);
  const preferredPortfolioId=candidateIds.find(id=>{
    const p=state.portfolios.find(row=>String(row.id)===String(id));
    return p&&(editPosition||portfolioCompatible(p));
  })||'';
  const preferredPortfolio=state.portfolios.find(p=>String(p.id)===String(preferredPortfolioId))||null;
  const hasCompatiblePortfolio=!!preferredPortfolio;
  const scope=portfolioMarketScope(preferredPortfolio);
  const preferTr=editPosition?Number(editPosition.prefer_tr)===1:
    explicitMarket==='tr'?true:explicitMarket==='us'?false:
    scope==="tr"?true:scope==="us"?false:!!(stock.tradeRepublicTradable||stock.tradeRepublicVerified);
  if(preferTr&&!(stock.tradeRepublicTradable===true||(stock.tradeRepublicVerified&&stock.trTicker))){
    toast("Esta acción no está verificada como negociable en Trade Republic / LSX.",true);return;
  }
  const defaultBroker=String(editPosition?.broker||brokerDefaultName(preferredPortfolio,preferTr)).trim();
  const current=currentMarket(stock,preferTr);
  const options=(hasCompatiblePortfolio?'':'<option value="" selected>Selecciona una cartera compatible</option>')+state.portfolios.map(p=>{
    const compatible=editPosition||portfolioCompatible(p);
    const scopeLabel=portfolioMarketLabel(portfolioMarketScope(p));
    return '<option value="'+esc(p.id)+'"'+(String(p.id)===String(preferredPortfolioId)?' selected':'')+(compatible?'':' disabled')+'>'+esc(p.name)+(scopeLabel?' · '+esc(scopeLabel):'')+'</option>';
  }).join('');
  const brokerDisabled=!!editPosition;

  const selectedTicker=preferTr?(stock.trTicker||stock.ticker||"acción"):(stock.ticker||stock.trTicker||"acción");
  openModal(editPosition?('Editar '+selectedTicker):('Operaciones · '+selectedTicker),
    '<form id="addPositionForm" class="portfolio-form'+(editPosition?'':' transaction-form')+'" data-stock-key="'+esc(stockKey)+'" data-prefer-tr="'+(preferTr?'1':'0')+'" data-market-lock="'+(explicitMarket||'')+'" data-default-broker="'+esc(defaultBroker)+'"'+(editPosition?' data-edit-position-id="'+esc(editPosition.id)+'"':'')+' data-return-view="'+esc(document.querySelector('.view.active')?.id||'')+'" data-return-scroll="'+esc(String(Math.max(0,Math.round(window.scrollY||0))))+'">'+
      (!editPosition?'<div class="transaction-form-head"><strong>Nueva operación</strong><span>'+esc(stock.name||"")+'</span></div>':'')+
      '<div class="position-form-stock"><strong>'+esc(preferTr?(stock.trTicker||stock.ticker||""):(stock.ticker||stock.trTicker||""))+'</strong><span>'+esc(stock.name||"")+'</span><b>'+formatMoney(current.price,current.currency)+'</b></div>'+
      (!editPosition?'<div class="portfolio-form-grid"><label><span>Tipo</span><select name="initialSide" aria-label="Tipo de operación"><option value="BUY" selected>Compra</option><option value="SELL" disabled>Venta · sin posición</option></select></label><label><span>Comisión</span><input data-first-operation-fee readonly></label></div>':'')+
      '<div class="portfolio-form-mode" data-position-form-mode></div>'+
      '<label><span>Cartera</span><select name="portfolioId" required'+(editPosition?' disabled':'')+'>'+options+'</select></label>'+
      (!editPosition&&!hasCompatiblePortfolio?'<button type="button" class="btn ghost compact" data-create-compatible-portfolio data-market="'+esc(explicitMarket||'')+'">＋ Crear cartera compatible</button>':'')+
      '<div class="portfolio-broker-field"><label><span>Broker</span><div class="portfolio-broker-select-row"><select name="broker" data-broker-select'+(brokerDisabled?' disabled':'')+'>'+brokerSelectOptions(defaultBroker)+'</select>'+
        (!brokerDisabled?'<button type="button" class="portfolio-broker-add" data-toggle-broker-create aria-label="Añadir broker" title="Añadir broker">＋</button>':'')+
      '</div></label>'+
      (!brokerDisabled?'<div class="broker-create-inline" data-broker-create-inline hidden><input type="text" data-new-broker-name maxlength="80" placeholder="Nombre del broker, p. ej. DEGIRO"><button type="button" data-create-broker>＋ Añadir</button></div>':'')+
      '<small class="broker-fee-hint" data-broker-fee-hint></small></div>'+
      '<div class="portfolio-form-grid"><label><span>'+(editPosition?'Cantidad':'Cantidad de esta compra')+'</span><input name="quantity" type="number" inputmode="decimal" step="any" min="0" placeholder="0"></label>'+
      '<label><span>'+(editPosition?'Precio medio':'Precio de compra')+'</span><input name="avgPrice" type="number" inputmode="decimal" step="any" min="0" placeholder="'+esc(current.price||"")+'"></label></div>'+
      '<div class="portfolio-form-grid"><label><span>Divisa</span><select name="currency"'+(editPosition?' disabled':'')+'><option>EUR</option><option>USD</option><option>GBP</option></select></label>'+
      '<label><span>Fecha de entrada</span><span class="portfolio-date-field"><input id="openedAtInput" name="openedAt" type="date" value="'+localDateValue()+'" required><button type="button" class="portfolio-date-picker" data-open-date-picker aria-label="Abrir calendario">📅</button></span></label></div>'+
      '<label><span>Nota</span><textarea name="notes" rows="2" maxlength="1000" placeholder="Opcional"></textarea></label>'+
      '<div class="portfolio-form-status" data-position-status aria-live="polite"></div>'+
      '<button type="button" class="btn" data-save-position>'+(editPosition?'Guardar cambios':'Registrar operación')+'</button>'+
    '</form>'
  );

  const form=$("#addPositionForm"),saveButton=form?.querySelector("[data-save-position]");
  if(form){
    const brokerSelect=form.querySelector('[data-broker-select]');
    const currencySelect=form.querySelector('[name="currency"]');
    if(editPosition&&currencySelect)currencySelect.disabled=false;
    applyPositionFormState(form,stock,preferTr);
    if(!editPosition&&preset&&typeof preset==='object'){
      const quantityInput=form.querySelector('[name="quantity"]'),priceInput=form.querySelector('[name="avgPrice"]');
      const presetQty=num(preset.quantity),presetPrice=num(preset.price);
      if(quantityInput&&presetQty!==null&&presetQty>0)quantityInput.value=String(presetQty);
      if(priceInput&&presetPrice!==null&&presetPrice>=0)priceInput.value=String(presetPrice);
      updatePositionBrokerFeeHint(form,stock);
    }
    if(editPosition&&currencySelect)currencySelect.disabled=true;
    form.querySelector('[name="portfolioId"]')?.addEventListener('change',()=>applyPositionFormState(form,stock,preferTrOverride===true?true:preferTrOverride===false?false:preferTr));
    brokerSelect?.addEventListener('change',()=>applyPositionFormState(form,stock,form.dataset.preferTr==="1"));
    currencySelect?.addEventListener('change',()=>applyPositionFormState(form,stock,form.dataset.preferTr==="1"));
    form.querySelector('[data-toggle-broker-create]')?.addEventListener('click',()=>{
      const creator=form.querySelector('[data-broker-create-inline]');if(!creator)return;
      creator.hidden=!creator.hidden;if(!creator.hidden)creator.querySelector('input')?.focus();
    });
    form.querySelector('[data-create-broker]')?.addEventListener('click',()=>createBrokerFromPositionForm(form,stock));
    form.querySelector('[data-create-compatible-portfolio]')?.addEventListener('click',()=>{
      const market=String(form.querySelector('[data-create-compatible-portfolio]')?.dataset.market||explicitMarket||'');
      closeModal();
      openNewPortfolioModal({
        marketScope:market||"auto",
        broker:market==="us"?"IBKR":market==="tr"?"Trade Republic":"",
        baseCurrency:market==="us"?"USD":"EUR",
        pendingStockKey:stockKey,
        pendingPreferTr:market==="tr"
      });
    });
    ['quantity','avgPrice'].forEach(name=>form.querySelector('[name="'+name+'"]')?.addEventListener('input',()=>updatePositionBrokerFeeHint(form,stock)));
    updatePositionBrokerFeeHint(form,stock);
    const feePreview=form.querySelector('[data-first-operation-fee]');
    if(feePreview){
      const refreshFirstFee=()=>{
        const qty=num(form.querySelector('[name="quantity"]')?.value)||0;
        const px=num(form.querySelector('[name="avgPrice"]')?.value)||0;
        const broker=String(form.querySelector('[data-broker-select]')?.value||defaultBroker);
        const currency=String(form.querySelector('[name="currency"]')?.value||(preferTr?'EUR':'USD'));
        const exchange=form.dataset.preferTr==="1"?(stock.trExchange||"LSX"):(stock.exchange||"");
        const fee=brokerFeeInCurrency(broker,qty,px,currency,'BUY',exchange);
        feePreview.value=fee.fee===null?'Pendiente':formatMoney(fee.fee,fee.currency);
      };
      ['quantity','avgPrice'].forEach(name=>form.querySelector('[name="'+name+'"]')?.addEventListener('input',refreshFirstFee));
      form.querySelector('[data-broker-select]')?.addEventListener('change',refreshFirstFee);
      form.querySelector('[name="currency"]')?.addEventListener('change',refreshFirstFee);
      refreshFirstFee();
    }
  }
  if(form&&saveButton){
    saveButton.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();savePositionForm(form)});
  }
}


function activePortfolioMemberships(stockKey, preferTr = null) {
  const marketFilter=preferTr===true?1:preferTr===false?0:null;
  return state.positions
    .filter(p =>
      sameStockRef(p.stock_key, stockKey) &&
      Number(p.active) !== 0 &&
      (marketFilter===null || Number(p.prefer_tr)===marketFilter)
    )
    .map(p => ({
      position: p,
      portfolio: state.portfolios.find(x => String(x.id) === String(p.portfolio_id)) || null
    }));
}

function isInPortfolio(stockKey, preferTr = null) {
  return activePortfolioMemberships(stockKey,preferTr).length > 0;
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
        '<button type="button" class="btn ghost" data-cancel-remove-exposure>✕ Cancelar</button>' +
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
        '<button type="button" class="btn ghost exposure-sell" data-position-operation="'+esc(existing.id)+'" data-operation-side="SELL">↘ Vender</button>'+
        '<button type="button" class="btn ghost" data-edit-portfolio-position="'+esc(existing.id)+'">✎ Modificar exposición</button>'+
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

    // The local position state is already updated by add/edit. Repaint immediately;
    // background analysis will reconcile server state without a second full reload.
    renderActivePortfolioPanel();
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
    if(event.target.closest?.("[data-portfolio-retry]")){event.preventDefault();loadAll();return}
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
      goalRefresh.disabled=true;const oldLabel=goalRefresh.getAttribute("aria-label")||"Reanalizar estrategia";
      goalRefresh.setAttribute("aria-busy","true");goalRefresh.setAttribute("aria-label","Reanalizando estrategia");goalRefresh.title="Reanalizando estrategia";
      state.goalCandidateCache={at:0,key:"",rows:[]};
      const selected=selectedPortfolio(),noticeId="goal-reanalysis:"+(selected&&selected.id||state.selectedPortfolioId||"current");
      const notice=typeof window.AppAlerts?.pushNotice==="function"?window.AppAlerts.pushNotice:null;
      if(notice)notice({id:noticeId,kind:"portfolio-goal",severity:"info",title:"Reanalizando estrategia",
        message:"Cartera: "+(selected&&selected.name||"seleccionada")+" · buscando oportunidades y actualizando recomendaciones.",createdAt:new Date().toISOString()});
      try{
        const done=await refreshGoalAnalysis(true);
        const message=done?"Se han actualizado las recomendaciones ("+done+" posiciones analizadas).":"No había posiciones que analizar; el plan se ha recalculado con los datos disponibles.";
        if(notice)notice({id:noticeId,kind:"portfolio-goal",severity:"success",title:"Análisis completado",
          message:"Cartera: "+(selected&&selected.name||"seleccionada")+" · "+message,createdAt:new Date().toISOString()});
        else toast(done?"Estrategia reanalizada · "+done+" posiciones":"Estrategia recalculada");
      }catch(error){
        const message=/too many requests/i.test(String(error&&error.message||""))?"Demasiadas solicitudes. Espera un momento y vuelve a reanalizar.":(error.message||"No se pudo reanalizar la estrategia.");
        if(notice)notice({id:noticeId,kind:"portfolio-goal",severity:"error",title:"No se pudo reanalizar la estrategia",
          message:"Cartera: "+(selected&&selected.name||"seleccionada")+" · "+message,createdAt:new Date().toISOString()});
        else toast(message,true);
      }
      finally{if(goalRefresh.isConnected){goalRefresh.disabled=false;goalRefresh.removeAttribute("aria-busy");goalRefresh.setAttribute("aria-label",oldLabel);goalRefresh.title=oldLabel}}return;
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

    const dedupe = event.target.closest?.("[data-portfolio-dedupe]");
    if (dedupe) {
      dedupe.disabled = true; dedupe.textContent = "Limpiando…";
      try {
        const res = await api("/api/portfolios/" + encodeURIComponent(dedupe.dataset.portfolioDedupe) + "/dedupe", { method: "POST", body: "{}" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "No se pudo limpiar la cartera.");
        toast(data.removed ? "Quitados " + data.removed + " apuntes manuales repetidos" : "No había apuntes manuales que quitar: revisa si tienes la misma posición importada dos veces.");
        await loadAll();
        if (window.ViewInvAITax) window.ViewInvAITax._invalidate();
      } catch (error) { toast(error.message || "No se pudo limpiar la cartera.", true); dedupe.disabled = false; dedupe.textContent = "Reintentar"; }
      return;
    }

    if (event.target.closest?.("[data-broker-import]")) {
      if (window.ViewInvAIBrokerImport) window.ViewInvAIBrokerImport.open();
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

    const deletePf = event.target.closest?.("[data-portfolio-delete]");
    if (deletePf) {
      openPortfolioDeleteConfirm(deletePf.dataset.portfolioDelete);
      return;
    }

    if (event.target.closest?.("[data-portfolio-delete-cancel]")) {
      openPortfolioOrderModal(true);
      return;
    }

    const confirmDeletePf = event.target.closest?.("[data-portfolio-delete-confirm]");
    if (confirmDeletePf) {
      deletePortfolio(confirmDeletePf.dataset.portfolioDeleteConfirm, confirmDeletePf);
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
      const key=add.dataset.addPortfolioStock;
      const pref=add.dataset.addPortfolioPreferTr;
      const preferTr=pref==="1"?true:pref==="0"?false:null;
      const memberships=activePortfolioMemberships(key,preferTr);
      if(!memberships.length){
        openAddPositionModal(key,preferTr);
      }else{
        let target=state.selectedPortfolioId
          ?memberships.find(x=>String(x.position.portfolio_id)===String(state.selectedPortfolioId))||null
          :null;
        if(!target&&memberships.length===1)target=memberships[0];
        if(target)openTransactionsModal(target.position.id);
        else openStarMenu(key,preferTr);
      }
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

    const decideButton = event.target.closest?.("[data-goal-decide]");
    if (decideButton) {
      event.preventDefault();
      event.stopPropagation();
      openGoalDecisionModal(decideButton.dataset.goalDecide);
      return;
    }
    const decideClear = event.target.closest?.("[data-goal-decide-clear]");
    if (decideClear) {
      event.preventDefault();
      try { await window.ViewInvAIDecisions.clear(decideClear.dataset.goalDecideClear); goalPlanCache=null; closeModal(); toast("Decisión quitada."); renderApp(); }
      catch (error) { toast(error.message || "No se pudo quitar la decisión.", true); }
      return;
    }
    const freezeClear = event.target.closest?.("[data-freeze-clear]");
    if (freezeClear) {
      event.preventDefault();
      await savePositionFreeze(freezeClear.closest("#positionFreezeForm"), true);
      return;
    }
    const transactionsButton = event.target.closest?.("[data-position-transactions]");
    if (transactionsButton) {
      event.preventDefault();
      event.stopPropagation();
      const preferredSide=String(transactionsButton.dataset.positionSide||"").toUpperCase();
      openTransactionsModal(transactionsButton.dataset.positionTransactions,preferredSide==="BUY"||preferredSide==="SELL"?preferredSide:null);
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

    if (event.target.id === "goalDecisionForm") {
      event.preventDefault();
      await saveGoalDecisionForm(event.target);
      return;
    }
    if (event.target.id === "positionFreezeForm") {
      event.preventDefault();
      await savePositionFreeze(event.target);
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
  });

  window.addEventListener("viewinvai:decisions-changed", () => { if (state.user) renderActivePortfolioPanel(); });
  // Una opinión nueva de IA (pegada o con clave) puede dejar una compra del Objetivo en observación.
  window.addEventListener("viewinvai:ai-contrast", () => {
    if (!state.user || !document.querySelector(".portfolio-goal-view")) return;
    if (document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    renderGoalApp();
  });
  // Cotización por ISIN de una posición fuera del catálogo: repinta como mucho cada 2 s.
  let isinQuoteTimer = null;
  window.addEventListener("viewinvai:tr-isin-quote", () => {
    if (!state.user || isinQuoteTimer || !document.querySelector(".portfolio-isin-position, .pf-account")) return;
    isinQuoteTimer = setTimeout(() => { isinQuoteTimer = null; if (!document.querySelector("#view-portfolios.active, #view-portfolios:not([hidden])")) return; if (!document.activeElement || !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) renderActivePortfolioPanel(); }, 2000);
  });
  // La tarjeta «Cuenta» suma los fondos: se repinta cuando llegan las carteras de Fondos.
  window.addEventListener("viewinvai:fund-portfolios-changed", () => {
    if (!state.user || document.documentElement.dataset.design !== "d" || portfolioAssetMode() !== "stocks") return;
    if (document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    renderApp();
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
    if (!event.detail) return;
    // Las ideas de «Hoy toca» y las órdenes puestas también se recalculan con cada precio (no solo las posiciones):
    // el importe, el límite y el aviso de horquilla tienen que ser los del momento en que pones la orden.
    const k=String(event.detail.key||"");
    const inGoal=state.primaryTab==="goal"&&((lastGoalCtx&&(lastGoalCtx.candidates||[]).some(c=>sameStockRef(c.stock&&portfolioStockKey(c.stock)||c.key,k)||sameStockRef(c.key,k)))||goalPendingOrders(selectedPortfolioGoal()).some(o=>sameStockRef(o.key,k)));
    if (!inGoal && !state.positions.some(p => sameStockRef(p.stock_key, k))) return;
    state.goalCandidateCache={at:0,key:"",rows:[]};
    if(!document.querySelector("#view-portfolios.active")||document.hidden)return;
    schedulePortfolioQuoteRender();
  });
  window.addEventListener("viewinvai:fx-updated", () => {
    state.goalCandidateCache={at:0,key:"",rows:[]};
    if(!document.querySelector("#view-portfolios.active")||document.hidden)return;
    schedulePortfolioQuoteRender();
  });
  document.addEventListener("visibilitychange",()=>{
    if(document.hidden||portfolioAssetMode()!=="goal")return;
    const box=$("#portfolioGoalApp");
    if(box&&(!box.innerHTML.trim()||!box.querySelector(".portfolio-goal-controls,.portfolio-empty-state,.portfolio-loading")))renderGoalApp();
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

// Resumen para «Mi día»: valor en EUR, cambio del día y P&L neto abierto por cartera.
function portfolioDaySummary(){
  if(!state.user)return{signedIn:false};
  const open=state.positions.filter(p=>Number(p.active)!==0);
  // Cada cartera aporta lo que muestra su resumen: valor de las posiciones (sin efectivo) y P&L abierto;
  // el efectivo se suma aparte.
  const rows=state.portfolios.map(pf=>{
    const positions=portfolioPositions(pf.id),T=portfolioTotals(pf,positions),cur=T.baseCurrency;
    const eur=v=>portfolioConvertAmount(v,cur,'EUR',T.fxUsdEur);
    const value=T.complete?eur(T.totalValue):eur(T.positionsValue);
    // Semana y mes en €: cada posición con la variación del periodo en euros (las de EE. UU. con el cambio
    // euro/dólar del BCE). Si a alguna le falta el dato, la cuenta queda sin cifra (null), no a medias.
    const P=window.ViewInvAIPeriod,period={};
    for(const m of ['week','month']){
      let sum=0,ok=!!P;
      if(ok)for(const p of positions){
        const stock=stockByKey(p.stock_key),v=positionSortMetrics(p).value;
        if(!stock||v===null){ok=false;break}
        const basis=positionPeriodBasis(p,m),pnl=positionSortMetrics(p).pnlAbs;
        const pct=P.stockPct(stock,true,null,m),amt=basis==="since"?pnl:P.amountFromPct(v,pct);
        if(amt===null){ok=false;break}
        sum+=amt;
      }
      period[m]=ok?sum:null;
    }
    return{id:pf.id,name:pf.name,value:value??0,cash:eur(T.cashBalance)??0,day:eur(T.day)??0,pnl:eur(T.openPnl)??0,week:period.week,month:period.month,count:positions.length,complete:T.complete&&value!==null,kind:'stocks'};
  });
  // Carteras de fondos (Fondos): mismo valor que sus tarjetas.
  const F=window.ViewInvAIFunds;
  if(F&&typeof F.getPortfolioTotals==='function')rows.push(...F.getPortfolioTotals().map(r=>({...r,kind:'funds'})));
  // Criptoactivos (Mi cripto): precio de consenso; sin efectivo.
  const X=window.ViewInvAICrypto,ct=X&&typeof X.totals==='function'?X.totals():null;
  if(ct&&ct.count>0)rows.push({id:'crypto',name:'Criptoactivos',value:ct.value,cash:0,day:ct.day,pnl:ct.pnl,count:ct.count,complete:ct.complete&&!!ct.updatedAt,kind:'crypto'});
  const total=rows.reduce((t,r)=>({value:t.value+r.value,cash:t.cash+(r.cash||0),day:t.day+r.day,pnl:t.pnl+r.pnl}),{value:0,cash:0,day:0,pnl:0});
  const keys=[...new Set([...open.map(p=>p.stock_key),...state.watchlist.map(w=>w.stock_key)].filter(Boolean))];
  return{signedIn:true,loading:!!state.loading,portfolios:rows,total,stockKeys:keys,positionKeys:[...new Set(open.map(p=>p.stock_key))]};
}

// Open positions valued in EUR, for the tax view and the risk/dividend card.
function portfolioPositionsDetail(portfolioId=null){
  if(!state.user)return[];
  return state.positions.filter(p=>Number(p.active)!==0&&(portfolioId===null||String(p.portfolio_id)===String(portfolioId))).map(p=>{
    const stock=stockByKey(p.stock_key)||{};
    const m=positionSortMetrics(p);
    const isin=String(Number(p.prefer_tr)===1?(stock.trIsin||p.isin||stock.isin||""):(stock.isin||stock.usIsin||p.isin||"")).toUpperCase();
    return{
      id:p.id,portfolioId:p.portfolio_id,stockKey:p.stock_key,ticker:p.ticker||stock.ticker||"",name:stock.name||p.name||"",isin,
      broker:p.broker||"",preferTr:Number(p.prefer_tr)===1,quantity:num(p.quantity),valueEur:m.value,pnlEur:m.pnlAbs,pnlPct:m.pnlPct,
      lastBuyAt:p.last_buy_at||p.opened_at||null,sector:stock.sector||"",industry:stock.industry||"",
      beta:num(stock.beta1Y),dividendYield:num(stock.dividendYield),country:isin.slice(0,2)||""
    };
  });
}

// ===== Carteras · diseño D: la cuenta como en el bróker =====
// Pestañas por cuenta, total de la cuenta (acciones + ETF/ETC + fondos del mismo bróker) con su
// gráfico, tres datos (invertido, desde la compra, efectivo), lectura AI, botones con nombre y
// una sola lista agrupada con el anillo AI y el veredicto en cada fila. Debajo siguen Riesgo y
// dividendos y Rentabilidad frente a índices. El diseño clásico no pasa por aquí.
const D_RANGES={'1d':'1D','1w':'1S','1m':'1M','3m':'3M','1y':'1A','all':'Máx'};
function dRangeKey(){try{const k=localStorage.getItem('viewinvai:pf-d-range');return D_RANGES[k]?k:'1m'}catch(_){return'1m'}}
function dIsDesign(){return document.documentElement.dataset.design==="d"}
const dMoney=v=>v===null||v===undefined||!Number.isFinite(v)?"—":formatMoney(v,"EUR");
function dChip(v,{pct=null,money=true,suffix=""}={}){
  if(v===null||v===undefined||!Number.isFinite(v))return"";
  const up=v>0,down=v<0,txt=money?formatMoney(Math.abs(v),"EUR"):formatNumber(Math.abs(v),2)+" %";
  return '<span class="d-chip '+(up?"up":down?"down":"flat")+'">'+(up?"▲ ":down?"▼ ":"")+txt+(pct!==null&&Number.isFinite(pct)?" · "+formatNumber(Math.abs(pct),2)+" %":"")+(suffix?" "+esc(suffix):"")+'</span>';
}
// Chip de una fila según el botón de periodo (1D, 1S, 1M, Σ): importe en la divisa de la posición y %.
// Si no hay dato fiable para el periodo, «—» con su etiqueta (nunca una cifra inventada).
// Cómo contar el periodo de una posición: si la compraste entera dentro del periodo, cuenta desde tu compra
// (la variación de la semana incluiría días en que aún no la tenías); si añadiste acciones dentro, la cifra es
// aproximada (≈); si es anterior al periodo, valor × variación del periodo.
function positionPeriodBasis(p,m){
  if(!p||m==="since")return"period";
  const now=new Date(),start=m==="day"?new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime():now.getTime()-(m==="week"?7:30)*864e5;
  const opened=Date.parse(p.opened_at||""),last=Date.parse(p.last_buy_at||"");
  if(Number.isFinite(opened)&&opened>start)return"since";
  if(Number.isFinite(last)&&last>start)return"approx";
  return"period";
}
function dPeriodChip(r){
  const P=window.ViewInvAIPeriod,m=P?P.get():"day",cur=r.cur||"EUR",basis=positionPeriodBasis(r.p,m);
  let money=null,pct=null;
  if(m==="since"||basis==="since"){money=r.nPnl;pct=r.nPnlPct}
  else if(m==="day"){pct=r.dayPct;money=P?P.amountFromPct(r.nValue,pct):null}
  else{pct=r.stock&&P?P.stockPct(r.stock,r.preferTr,r.dayPct,m):null;money=P?P.amountFromPct(r.nValue,pct):null}
  const tag=P?P.tag(m):"",ok=v=>v!==null&&v!==undefined&&Number.isFinite(v);
  if(!ok(money)&&!ok(pct))return'<span class="d-chip flat">—'+(tag?" "+esc(tag):"")+'</span>';
  const v=ok(money)?money:pct,up=v>0,down=v<0;
  const approx=basis==="approx"?"≈ ":"",title=basis==="since"?' title="Comprada dentro del periodo: cuenta desde tu compra"':basis==="approx"?' title="Añadiste acciones dentro del periodo: cifra aproximada"':"";
  // Con signo (como el precio por acción de debajo): «▼ −1,35 US$ · −3,78 %», no dos cifras sin signo.
  const sg=x=>x>0?"+":x<0?"−":"";
  return'<span class="d-chip '+(up?"up":down?"down":"flat")+'"'+title+'>'+(up?"▲ ":down?"▼ ":"")+approx+(ok(money)?sg(money)+esc(formatMoney(Math.abs(money),cur)):"")+(ok(money)&&ok(pct)?" · ":"")+(ok(pct)?sg(pct)+formatNumber(Math.abs(pct),2)+" %":"")+(tag?" "+esc(tag):"")+'</span>';
}
// Valor, P&L y cambio del día de una posición, en euros (también las de fuera del catálogo).
function dPositionRow(p){
  const stock=stockByKey(p.stock_key),qty=num(p.quantity),preferTr=Number(p.prefer_tr)===1;
  const name=String(stock?(stock.name||stock.ticker||p.name):(p.name||p.ticker||positionIsin(p)||"Posición")).replace(/,?\s+(Inc|Corp|Corporation|Ltd|plc|S\.?A|N\.?V|AG|SE)\.?$/i,"");
  let value=null,pnl=null,pnlPct=null,dayPct=null,score=null,signal=String(p.last_signal||"").toUpperCase(),etf=false,venue="";
  let cur="EUR",nValue=null,nPnl=null,nPnlPct=null;
  if(stock){
    const m=positionSortMetrics(p),market=currentMarket(stock,preferTr);
    value=m.value;pnl=m.pnlAbs;pnlPct=m.pnlPct;dayPct=market.change;
    // En la divisa de la posición (LSX/Trade Republic en €, EE. UU. en $): sin mezclar € y $.
    cur=String(p.currency||(preferTr?"EUR":"USD")).toUpperCase();
    const unit=marketValueInCurrency(market,cur),avgN=num(p.avg_price),costN=num(p.cost_basis)??(qty!==null&&avgN!==null?qty*avgN:null);
    nValue=qty!==null&&unit!==null?qty*unit:null;nPnl=nValue!==null&&costN!==null?nValue-costN:null;nPnlPct=nPnl!==null&&costN>0?nPnl/costN*100:null;
    etf=/etf|etc|etp|fund|trust/i.test(String(stock.instrumentType||""));
    venue=preferTr?"LSX":String(stock.exchange||"EE. UU.");
    score=num(p.last_score);
    const pulse=window.ViewInvAIPulseCoach&&typeof window.ViewInvAIPulseCoach.analyzeStock==="function"?window.ViewInvAIPulseCoach.analyzeStock(stock,preferTr):null;
    if(score===null&&pulse)score=num(pulse.score);
    if(!signal&&pulse)signal=String(pulse.signal||"").toUpperCase();
  }else{
    const isin=positionIsin(p),F=window.ViewInvAIFunds,q=isin&&F&&typeof F.getLiveQuote==="function"?F.getLiveQuote(isin):null;
    if(isin&&F&&typeof F.subscribeIsin==="function")F.subscribeIsin(isin);
    const fundCur=String(p.currency||"EUR").toUpperCase(),price=q&&fundCur==="EUR"?num(q.price):null,prev=q?num(q.prev):null,avg=num(p.avg_price);
    value=qty!==null&&price!==null?qty*price:null;
    const cost=num(p.cost_basis)??(qty!==null&&avg!==null?qty*avg:null);
    pnl=value!==null&&cost!==null?value-cost:null;pnlPct=pnl!==null&&cost>0?pnl/cost*100:null;
    dayPct=price!==null&&prev>0?(price/prev-1)*100:null;
    etf=/\b(ETC|ETF|ETP|UCITS|ETN)\b/i.test(name);venue="LSX";
    cur="EUR";nValue=value;nPnl=pnl;nPnlPct=pnlPct;
  }
  // Veredicto: tu decisión, luego la acción del Objetivo, luego la señal de la IA.
  let verdict="";
  const d=window.ViewInvAIDecisions&&typeof window.ViewInvAIDecisions.forPosition==="function"?window.ViewInvAIDecisions.forPosition(p.id):null;
  if(d)verdict=d.decision==="hold"?"Mantienes (tu decisión)":d.decision==="later"?"Decidir el "+new Date(d.review_at).toLocaleDateString("es-ES",{day:"numeric",month:"short"}):"Vas a vender";
  if(!verdict&&stock){
    const plan=goalPlanForStock(stock);
    if(plan&&plan.kind==="position"){
      if(plan.action&&plan.action.text)verdict=plan.action.text;
      else if(plan.holdText)verdict=plan.holdText;
      else if(num(plan.stopEur)!==null)verdict="Mantener · stop "+formatMoney(plan.stopEur,"EUR");
    }
  }
  if(!verdict&&signal){const[label]=signalInfo(signal);verdict=label.charAt(0)+label.slice(1).toLowerCase()}
  const dayEur=value!==null&&dayPct!==null&&dayPct>-100?value-value/(1+dayPct/100):null;
  return{p,stock,name,qty,value,pnl,pnlPct,dayPct,dayEur,score,signal,verdict,etf,venue,preferTr,cur,nValue,nPnl,nPnlPct};
}
function dRing(score,label){
  if(score===null||!Number.isFinite(score))return'<span class="d-ring d-ring-kind">'+esc(label||"")+'</span>';
  const n=Math.max(0,Math.min(100,Math.round(score)));
  return'<em class="ai-score d-ring" data-band="'+(n>=80?"high":n>=60?"mid":"low")+'" data-p="'+Math.round(n/5)*5+'" title="Puntuación AI '+n+'/100">'+n+'</em>';
}
// Filas desplegadas: se recuerdan aunque Carteras se repinte al llegar cotizaciones.
const dOpenRows=new Set();
function dRowDetailHtml(r,open=false){
  const p=r.p,avg=num(p.avg_price),qty=r.qty,cur=String(p.currency||(r.preferTr?"EUR":"USD")).toUpperCase();
  const fee=brokerFeeInCurrency(p.broker,qty,avg,cur,"BUY",p.exchange||"");
  const cost=num(p.cost_basis)??(qty!==null&&avg!==null?qty*avg+(fee.fee??0):null);
  // Comisiones coherentes con el coste: si no hay total guardado, lo que el coste lleva por encima de acciones × precio
  // medio (antes salía la tarifa teórica del bróker aunque el coste no la incluyera).
  const fees=num(p.fees_total)??(num(p.cost_basis)!==null&&qty!==null&&avg!==null?Math.max(0,num(p.cost_basis)-qty*avg):(fee.fee??0));
  let quote="",vsAvg=null,unitNow=null;
  if(r.stock){
    const unit=marketValueInCurrency(currentMarket(r.stock,r.preferTr),cur);unitNow=unit;
    if(unit!==null&&avg)vsAvg=(unit/avg-1)*100;
    // Cotización compartida (se actualiza en vivo y muestra pre/post); el rótulo «Precio por acción» la distingue
    // de la cabecera, que es la posición entera.
    quote=typeof compactInvestingQuoteHtml==="function"?compactInvestingQuoteHtml(r.stock,r.preferTr):"";
  }else{
    const isin=positionIsin(p),F=window.ViewInvAIFunds,q=isin&&F&&typeof F.getLiveQuote==="function"?F.getLiveQuote(isin):null,price=q&&cur==="EUR"?num(q.price):null;
    quote='<span class="portfolio-isin-quote">'+(price===null?"Cotización de Trade Republic…":"<b>"+esc(formatMoney(price,cur))+"</b>"+(r.dayPct!==null?" · hoy "+(r.dayPct>=0?"+":"")+formatNumber(r.dayPct,2)+" %":""))+'</span>';
    if(price!==null&&avg)vsAvg=(price/avg-1)*100;
    unitNow=price;
  }
  const cell=(label,value,cls="")=>'<div'+(cls?' class="'+cls+'"':'')+'><small>'+label+'</small><b>'+value+'</b></div>';
  return '<div class="d-row-detail"'+(open?'':' hidden')+'>'+
    // Arriba, la posición entera (valor y cambio de hoy); aquí, el precio de UNA acción: se rotula para no confundirlos.
    '<div class="d-row-quote"><small class="d-row-quote-h">Precio por '+(r.etf?'participación':'acción')+'</small>'+quote+'</div>'+
    '<div class="d-row-cells">'+
      cell("Precio medio",esc(formatMoney(avg,cur)))+cell("Coste",esc(formatMoney(cost,cur)))+cell("Comisiones",esc(formatMoney(fees,cur)))+
      cell("Precio vs. media",vsAvg===null?"—":(vsAvg>0?"+":"")+formatNumber(vsAvg,2)+" %",vsAvg===null?"":vsAvg>=0?"d-pos":"d-neg")+
      (String(p.broker||"").trim()?cell("Bróker",esc(String(p.broker).trim())):"")+
    '</div>'+positionDecisionChip(p,avg,cur,unitNow)+
    '<div class="d-row-actions"><button type="button" class="portfolio-register-operation-icon" data-position-transactions="'+esc(p.id)+'">⇄ Registrar operación</button>'+
      (r.stock?'<button type="button" data-portfolio-stock-profile="'+esc(p.stock_key)+'" data-profile-prefer-tr="'+(r.preferTr?"1":"0")+'">Ver ficha ›</button>':'')+'</div>'+
  '</div>';
}
function dRowHtml(r){
  const qtyTxt=r.qty===null?"":formatNumber(r.qty,r.qty%1?4:0)+(r.etf?" uds.":" acc.");
  const open=r.stock?' data-portfolio-stock-profile="'+esc(r.p.stock_key)+'" data-profile-prefer-tr="'+(r.preferTr?"1":"0")+'"':' data-position-transactions="'+esc(r.p.id)+'"';
  const isOpen=dOpenRows.has(String(r.p.id));
  return'<li class="d-row d-position'+(isOpen?' open':'')+'" data-collapsible data-position-id="'+esc(r.p.id)+'"><button type="button" class="d-row-main"'+open+' aria-label="'+(r.stock?'Abrir ficha de ':'Operaciones de ')+esc(r.name)+'">'+dRing(r.score,r.etf?"ETF":"")+
    '<span class="d-row-text"><b>'+esc(r.name)+'</b><small>'+esc([qtyTxt,r.venue].filter(Boolean).join(" · "))+'</small>'+
    (r.verdict?'<i class="d-row-ai">✦ '+esc(r.verdict)+'</i>':'')+'</span>'+
    '<span class="d-row-num"><b>'+(r.nValue===null?dMoney(r.value):esc(formatMoney(r.nValue,r.cur)))+'</b>'+(r.nValue===null&&r.value===null?'<small>sin precio</small>':dPeriodChip(r))+'</span></button>'+
    '<button type="button" class="d-row-toggle" data-d-row-toggle aria-expanded="'+(isOpen?'true':'false')+'" aria-label="Más datos de '+esc(r.name)+'" title="Precio, coste, comisiones y operaciones">▾</button>'+
    dRowDetailHtml(r,isOpen)+'</li>';
}
function dFundRowHtml(f){
  return'<li class="d-row"><button type="button" class="d-row-main" data-portfolio-asset="funds" aria-label="Abrir Fondos">'+dRing(null,f.kind)+
    '<span class="d-row-text"><b>'+esc(f.name)+'</b><small>'+esc(f.kind+" · en Fondos")+'</small>'+(f.dayPct!==null?'<i class="d-row-ai">Hoy '+(f.dayPct>=0?"+":"")+formatNumber(f.dayPct,2)+' %</i>':'')+'</span>'+
    '<span class="d-row-num"><b>'+dMoney(f.value)+'</b>'+dPeriodChip({cur:"EUR",nValue:f.value,nPnl:f.pnl,nPnlPct:f.pnlPct,dayPct:f.dayPct,stock:null})+'</span></button></li>';
}
function dAccountFunds(portfolio){
  const F=window.ViewInvAIFunds;
  if(!F||typeof F.getFundPortfolios!=="function"||typeof F.getPortfolioDetail!=="function")return[];
  const key=portfolioAccountKey(portfolio.broker)||portfolioAccountKey(portfolio.name);
  if(!key)return[];
  return F.getFundPortfolios().filter(f=>(portfolioAccountKey(f.platform)||portfolioAccountKey(f.name))===key)
    .flatMap(f=>F.getPortfolioDetail(f.id)).filter(r=>r.currency==="EUR");
}
// 1D: suma de la cotización intradía de cada posición (LSX para las de Trade Republic, Nasdaq para
// EE. UU.) por sus unidades, en euros. Lo que no tiene serie intradía cuenta con su valor actual.
const dIntraday=new Map();
async function dLoadIntraday(portfolio){
  const id=String(portfolio.id),hit=dIntraday.get(id);
  if(hit&&(hit.loading||Date.now()-hit.at<3*60000))return;
  dIntraday.set(id,{...(hit||{}),loading:true});
  const fx=portfolioUsdToEurRate(),positions=portfolioPositions(portfolio.id).slice(0,15);
  const series=[],fixed={value:0};
  await Promise.all(positions.map(async p=>{
    const stock=stockByKey(p.stock_key),qty=num(p.quantity);if(!stock||qty===null)return;
    const preferTr=Number(p.prefer_tr)===1;
    try{
      if(preferTr&&typeof trIsin==="function"&&trIsin(stock)){
        const r=await fetch('/api/tr-history?isin='+encodeURIComponent(trIsin(stock))+'&exchange='+encodeURIComponent(stock.trExchange||'LSX')+'&range=1d&resolution=300000',{cache:'no-store'});
        const d=await r.json();const pts=(d.points||[]).map(x=>[Number(x.time),num(x.close)]).filter(x=>x[1]!==null&&Number.isFinite(x[0]));
        if(pts.length>1){series.push({qty,mult:1,pts});return}
      }else if(!preferTr&&stock.ticker){
        const r=await fetch('/api/us-chart?symbol='+encodeURIComponent(stock.ticker),{cache:'no-store'});
        const d=await r.json(),day=Date.now()-20*3600e3;const pts=(d.points||[]).map(x=>[Number(x.time),num(x.price)]).filter(x=>x[1]!==null&&x[0]>=day);
        if(pts.length>1&&fx){series.push({qty,mult:fx,pts});return}
      }
    }catch(_){}
    const v=positionSortMetrics(p).value;if(v!==null)fixed.value+=v;
  }));
  let points=[];
  if(series.length){
    const times=[...new Set(series.flatMap(x=>x.pts.map(p=>Math.floor(p[0]/300000)*300000)))].sort((a,b)=>a-b);
    points=times.map(t=>[t,fixed.value+series.reduce((sum,x)=>{let last=x.pts[0][1];for(const p of x.pts){if(p[0]<=t+299999)last=p[1];else break}return sum+x.qty*last*x.mult},0)]);
  }
  dIntraday.set(id,{at:Date.now(),loading:false,points});
  if(dRangeKey()==='1d'){const hero=document.querySelector('[data-d-hero="'+(window.CSS&&CSS.escape?CSS.escape(id):id)+'"]');if(hero){const tmp=document.createElement('div');tmp.innerHTML=dHeroHtml(portfolio,portfolioPositions(portfolio.id));hero.replaceWith(tmp.firstElementChild)}}
}
function dSvg(vals,i0,n,gain){
  let lo=Infinity,hi=-Infinity;vals.forEach(([,v])=>{lo=Math.min(lo,v);hi=Math.max(hi,v)});
  const pad=(hi-lo)*.12||Math.max(1,hi*.02);lo-=pad;hi+=pad;
  const W=320,H=96,x=i=>(i-i0)/Math.max(1,n-i0)*W,y=v=>H-(v-lo)/(hi-lo)*H;
  const line=vals.map(([i,v],j)=>(j?"L":"M")+x(i).toFixed(1)+" "+y(v).toFixed(1)).join("");
  const tone=gain===null||gain>=0?"up":"down";
  return '<svg class="d-chart '+tone+'" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="Valor de la cartera de acciones en el periodo"><path class="area" d="'+line+'L'+W+' '+H+'L0 '+H+'Z"/><path class="line" d="'+line+'"/></svg>';
}
function dChartHtml(portfolio){
  const entry=perfCache.get(String(portfolio.id)),range=dRangeKey();
  const tabs='<div class="d-ranges" role="group" aria-label="Periodo del gráfico">'+Object.entries(D_RANGES).map(([k,l])=>'<button type="button" class="'+(k===range?"active":"")+'" data-pf-d-range="'+k+'" aria-pressed="'+(k===range)+'">'+l+'</button>').join("")+'</div>';
  if(range==='1d'){
    const it=dIntraday.get(String(portfolio.id));
    if(!it||(!it.points&&it.loading)||(it.loading&&!it.points.length)){dLoadIntraday(portfolio);return{svg:'<div class="d-chart d-chart-empty">Cargando la sesión de hoy…</div>'+tabs,gain:null,intraday:true}}
    if(Date.now()-it.at>=3*60000)dLoadIntraday(portfolio);
    if(it.points.length<2)return{svg:'<div class="d-chart d-chart-empty">Sin cotización intradía todavía</div>'+tabs,gain:null,intraday:true};
    const t0=it.points[0][0],vals=it.points.map(([t,v])=>[(t-t0)/300000,v]),n=vals[vals.length-1][0];
    return{svg:dSvg(vals,0,n,vals[vals.length-1][1]-vals[0][1])+tabs,gain:null,intraday:true};
  }
  const p=entry&&entry.data;
  if(!p||p.computing||!p.days||p.days.length<2||!p.value)return{svg:'<div class="d-chart d-chart-empty">'+(entry&&entry.error?"Gráfico no disponible ahora":"Preparando el gráfico…")+'</div>'+tabs,gain:null};
  const n=p.days.length-1,map={'1w':null,'1m':'1m','3m':'3m','1y':'1y','all':'all'};
  let i0;
  if(range==='1w'){const last=new Date(p.days[n]+'T12:00:00Z');last.setUTCDate(last.getUTCDate()-7);const cut=last.toISOString().slice(0,10);i0=0;for(let i=0;i<p.days.length;i++){if(p.days[i]<=cut)i0=i;else break}}
  else i0=perfStartIndex(p.days,map[range]);
  if(i0>=n)i0=Math.max(0,n-1);
  const vals=[];for(let i=i0;i<=n;i++){const v=num(p.value[i]);if(v!==null)vals.push([i,v])}
  let flows=0;for(let i=i0+1;i<=n;i++)flows+=num(p.flow&&p.flow[i])||0;
  const gain=vals.length>1?vals[vals.length-1][1]-vals[0][1]-flows:null;
  if(vals.length<2)return{svg:'<div class="d-chart d-chart-empty">Sin datos suficientes en este periodo</div>'+tabs,gain:null};
  let lo=Infinity,hi=-Infinity;vals.forEach(([,v])=>{lo=Math.min(lo,v);hi=Math.max(hi,v)});
  const pad=(hi-lo)*.12||Math.max(1,hi*.02);lo-=pad;hi+=pad;
  const W=320,H=96,x=i=>(i-i0)/Math.max(1,n-i0)*W,y=v=>H-(v-lo)/(hi-lo)*H;
  const line=vals.map(([i,v],j)=>(j?"L":"M")+x(i).toFixed(1)+" "+y(v).toFixed(1)).join("");
  const tone=gain===null||gain>=0?"up":"down";
  return{gain,svg:'<svg class="d-chart '+tone+'" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="Valor de la cartera de acciones en el periodo"><path class="area" d="'+line+'L'+W+' '+H+'L0 '+H+'Z"/><path class="line" d="'+line+'"/></svg>'+tabs};
}
function dReadingHtml(label,groups,rows,funds){
  const total=groups.reduce((a,g)=>a+g.value,0);
  if(!(total>0))return"";
  const parts=groups.filter(g=>g.value>0).sort((a,b)=>b.value-a.value).map(g=>"el "+formatNumber(g.value/total*100,0)+" % en "+g.text);
  const movers=rows.concat(funds.map(f=>({name:f.name,dayEur:f.value!==null&&f.dayPct!==null?f.value-f.value/(1+f.dayPct/100):null}))).filter(r=>r.dayEur!==null&&Math.abs(r.dayEur)>=0.005).sort((a,b)=>Math.abs(b.dayEur)-Math.abs(a.dayEur));
  const top=movers[0];
  const text=(parts.length?parts.join(", ").replace(/^el/,"El")+".":"")+(top?" Hoy lo que más mueve la cuenta es "+top.name+" ("+(top.dayEur>0?"+":"−")+formatMoney(Math.abs(top.dayEur),"EUR")+").":" Hoy la cuenta va en plano.");
  const ask="Analiza mi cuenta de "+label+": cómo está repartida, qué la mueve hoy y qué debería vigilar.";
  const q2=top?"¿Qué hago con "+top.name+"?":"¿Estoy bien diversificado?";
  const html='<div class="d-reading"><p><span aria-hidden="true">✦</span> '+esc(text)+'</p><div class="ai-chips"><button type="button" data-ai-ask-q="'+esc(ask)+'">Analizar con AI</button><button type="button" data-ai-ask-q="'+esc(q2)+'">'+esc(q2)+'</button></div></div>';
  return typeof window.ViewInvAIFold==="function"?window.ViewInvAIFold("pf-reading","Lectura AI de la cuenta",text,html):html;
}
function dGroupHtml(title,items,sortable){
  if(!items.length)return"";
  const key=positionSortKey(),next={value:"pnlPct",pnlPct:"pnlAbs",pnlAbs:"name",name:"value"}[key]||"value";
  return'<section class="d-group"><header><h3>'+esc(title)+'</h3>'+(window.ViewInvAIPeriod?window.ViewInvAIPeriod.buttonHtml():'')+(sortable?'<button type="button" class="d-sort" data-position-sort="'+next+'" title="Cambiar orden">'+esc(POSITION_SORTS[key]||"Valor")+' ▾</button>':'<span>'+items.length+'</span>')+'</header><ul class="d-list">'+items.join("")+'</ul></section>';
}
function dHeroHtml(portfolio,positions){
  const label={tr:"Trade Republic",ibkr:"Interactive Brokers",myinvestor:"MyInvestor"}[portfolioAccountKey(portfolio.broker)||portfolioAccountKey(portfolio.name)]||portfolio.broker||portfolio.name;
  const T=portfolioTotals(portfolio,positions),fx=T.fxUsdEur,eur=v=>portfolioConvertAmount(v,T.baseCurrency,"EUR",fx);
  const funds=dAccountFunds(portfolio);
  const stockValue=eur(T.positionsValue)||0,fundValue=funds.reduce((a,f)=>a+(f.value||0),0);
  const partial=!T.complete||funds.some(f=>f.value===null);
  const total=stockValue+fundValue,cash=eur(T.cashBalance)||0;
  const fundInvested=funds.reduce((a,f)=>a+(f.value!==null&&f.pnl!==null?f.value-f.pnl:0),0);
  const invested=(eur(T.invested)||0)+fundInvested;
  // «Desde la compra»: abierto (acciones + fondos) + realizado, como lo enseña el bróker.
  const txSummary=state.portfolioTransactionSummaries[String(portfolio.id)]||null;
  let realized=0;if(txSummary&&txSummary.currencies)for(const[code,row]of Object.entries(txSummary.currencies)){const v=portfolioConvertAmount(num(row&&row.realizedPnl)||0,code,"EUR",fx);if(v!==null)realized+=v}
  const openPnl=eur(T.openPnl),fundPnl=funds.reduce((a,f)=>a+(f.pnl||0),0);
  const sinceBuy=openPnl===null?null:openPnl+fundPnl+realized;
  const txIssues=Number(state.portfolioTxIssues[String(portfolio.id)])||0;
  const chart=dChartHtml(portfolio),range=dRangeKey();
  const fundDay=funds.reduce((a,f)=>a+(f.value!==null&&f.dayPct!==null?f.value-f.value/(1+f.dayPct/100):0),0);
  const day=(eur(T.day)||0)+fundDay;
  return'<section class="d-hero" data-d-hero="'+esc(portfolio.id)+'"><small>Cuenta de valores · '+esc(label)+'</small>'+
    '<div class="d-hero-total"><strong>'+dMoney(total)+'</strong>'+(chart.gain!==null?dChip(chart.gain,{suffix:D_RANGES[range]}):dChip(day,{suffix:"hoy"}))+'</div>'+
    (partial?'<p class="d-hero-note">Parcial: falta el precio de alguna posición.</p>':(chart.gain!==null?'<p class="d-hero-note">Hoy '+(day>=0?"+":"−")+formatMoney(Math.abs(day),"EUR")+(funds.length?' · gráfico de acciones y ETC':'')+'</p>':''))+
    chart.svg+
    '<div class="d-stats"><div><small>Invertido</small><b>'+dMoney(invested)+'</b></div>'+
      '<div><small>Desde la compra</small><b class="'+(sinceBuy===null?"":sinceBuy>=0?"d-pos":"d-neg")+'">'+(sinceBuy===null?"—":(sinceBuy>0?"+":sinceBuy<0?"−":"")+formatMoney(Math.abs(sinceBuy),"EUR"))+'</b>'+(realized?'<span>'+(realized>0?"+":"−")+formatMoney(Math.abs(realized),"EUR")+' realizado</span>':'')+
        (txIssues?'<button type="button" class="d-stat-warn" data-portfolio-history="'+esc(portfolio.id)+'">⚠ '+txIssues+(txIssues===1?' operación':' operaciones')+' a revisar</button>':'')+'</div>'+
      '<button type="button" data-portfolio-cash-edit="'+esc(portfolio.id)+'" aria-label="Editar capital líquido"><small>Capital líquido ✎</small><b>'+dMoney(cash)+'</b></button></div>'+
  '</section>';
}
function dActionsHtml(selected){
  const id=selected?esc(selected.id):"";
  return'<div class="d-actions">'+
    '<button type="button" class="d-primary portfolio-add-current"'+(selected?'':' disabled')+'>＋ Operación</button>'+
    '<button type="button" data-broker-import>'+pfIcon('import')+' Importar</button>'+
    '<button type="button"'+(selected?' data-portfolio-history="'+id+'"':' disabled')+'>'+pfIcon('history')+' Historial</button>'+
    '<details class="d-more"><summary aria-label="Más opciones de la cartera">⋯</summary><div class="d-more-menu">'+
      '<button type="button"'+(selected?' data-portfolio-market-config="'+id+'"':' disabled')+'>'+pfIcon('globe')+' Mercado de la cartera</button>'+
      '<button type="button" data-new-portfolio="1">'+pfIcon('folderPlus')+' Nueva cartera</button>'+
      '<button type="button" data-portfolio-order-edit>'+pfIcon('edit')+' Editar carteras</button>'+
      '<button type="button" class="portfolio-refresh">'+pfIcon('refresh')+' Actualizar precios</button>'+
    '</div></details></div>';
}
function dPortfolioContextHtml(selected,positions){
  const label=selected.broker||selected.name;
  const rows=sortPositions(positions).map(dPositionRow),funds=dAccountFunds(selected);
  const stocks=rows.filter(r=>!r.etf),etfs=rows.filter(r=>r.etf);
  const sum=list=>list.reduce((a,r)=>a+(r.value||0),0);
  const groups=[{text:stocks.length===1?"una acción":stocks.length+" acciones",value:sum(stocks)},{text:"ETF y ETC",value:sum(etfs)},{text:"fondos",value:sum(funds)}];
  const empty=!rows.length&&!funds.length?'<div class="portfolio-empty-state compact">Esta cartera todavía no tiene posiciones. Pulsa «＋ Operación» para añadir una.</div>':'';
  return portfolioDuplicatesHtml(selected,positions)+dHeroHtml(selected,positions)+dReadingHtml(label,groups,rows,funds)+dActionsHtml(selected)+empty+
    dGroupHtml("Acciones",stocks.map(dRowHtml),stocks.length>1)+
    dGroupHtml("ETF y ETC",etfs.map(dRowHtml),false)+
    dGroupHtml("Fondos",funds.map(dFundRowHtml),false)+
    '<div class="d-extras">'+portfolioPerformanceHtml(selected)+portfolioInsightsHtml(selected)+'</div>';
}
function dPortfolioWorkbarHtml(){
  return'<div class="portfolio-workbar d-workbar"><div class="portfolio-tabs-wrap">'+
    '<div class="portfolio-tabs-track" id="portfolioTabsTrack" role="tablist" aria-label="Mis cuentas">'+state.portfolios.map(renderPortfolioCard).join('')+'</div>'+
    '<button type="button" class="portfolio-tabs-more" data-portfolio-tabs-more aria-label="Mostrar carteras ocultas" title="Más carteras" hidden>›</button>'+
    '<div class="portfolio-tabs-overflow" id="portfolioTabsOverflow" aria-hidden="true"></div></div></div>';
}
document.addEventListener('click',event=>{
  const r=event.target.closest&&event.target.closest('[data-pf-d-range]');if(!r)return;
  try{localStorage.setItem('viewinvai:pf-d-range',r.dataset.pfDRange)}catch(_){}
  const hero=document.querySelector('[data-d-hero]'),pf=hero&&state.portfolios.find(p=>String(p.id)===String(hero.dataset.dHero));
  if(pf){const tmp=document.createElement('div');tmp.innerHTML=dHeroHtml(pf,portfolioPositions(pf.id));hero.replaceWith(tmp.firstElementChild)}
});
document.addEventListener('click',event=>{
  const t=event.target.closest&&event.target.closest('[data-d-row-toggle]');if(!t)return;
  const li=t.closest('.d-row'),detail=li&&li.querySelector('.d-row-detail');if(!detail)return;
  const open=detail.hidden;detail.hidden=!open;li.classList.toggle('open',open);t.setAttribute('aria-expanded',open?'true':'false');
  const id=String(li.dataset.positionId||'');if(id){if(open)dOpenRows.add(id);else dOpenRows.delete(id)}
  if(open&&window.ViewInvAI&&typeof window.ViewInvAI.observeLiveQuotes==="function")window.ViewInvAI.observeLiveQuotes(detail);
});
// Se pliegan solas solo cuando ya te has ido lejos de ellas (collapse.js decide cuándo: mientras
// alguna parte de la fila siga en pantalla, no). Una cotización nueva nunca las cierra.
document.addEventListener('viewinvai:collapse-away',e=>{
  const li=e.target&&e.target.closest&&e.target.closest('.d-position');if(!li)return;
  dOpenRows.delete(String(li.dataset.positionId||''));
  li.classList.remove('open');const d=li.querySelector('.d-row-detail');if(d)d.hidden=true;const t=li.querySelector('[data-d-row-toggle]');if(t)t.setAttribute('aria-expanded','false');
});
document.addEventListener('click',event=>{
  if(event.target.closest&&event.target.closest('.d-more-menu button')){const d=event.target.closest('details');if(d)d.open=false}
});

window.ViewInvAIPortfolios = {
  render: renderApp,
  getPositionsDetail: portfolioPositionsDetail,
  isSignedIn: () => !!state.user,
  getPortfolios: () => state.portfolios.map(p => ({ id: p.id, name: p.name, broker: p.broker || "", base_currency: p.base_currency })),
  getSelectedPortfolioId: () => state.selectedPortfolioId,
  openModal,
  closeModal,
  toast,
  getDaySummary: portfolioDaySummary,
  getGoalPlanFor: goalPlanForStock,
  renderGoal: renderGoalApp,
  reload: () => loadAll(),
  // Tras importar el efectivo de Trade Republic: si no cuadra con las huchas del Objetivo, pregunta el reparto.
  promptGoalSleeveCash: portfolioId => goalSleeveCashPrompt(portfolioId),
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
  getPortfolioMemberships: (stockKey,preferTr=null) => activePortfolioMemberships(stockKey,preferTr).map(x => ({
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

window.addEventListener('viewinvai:period-changed',()=>{try{if(state.primaryTab!=='goal')renderApp()}catch(_){}});
init();
