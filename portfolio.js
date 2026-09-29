const state = {
  user: null,
  portfolios: [],
  positions: [],
  watchlist: [],
  portfolioTransactionSummaries: {},
  selectedPortfolioId: null,
  primaryTab: "portfolio",
  goal: null,
  goals: {},
  goalError: "",
  goalCandidateCache: { at: 0, key: "", rows: [] },
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
  return num(selectedPortfolioGoal()&&selectedPortfolioGoal().target_value_eur);
}

function portfolioStockKeys() {
  return [...new Set(state.positions.filter(p => Number(p.active) !== 0).map(p => canonicalStockKey(p.stock_key)).filter(Boolean))];
}

function syncPortfolioStars() {
  if (window.ViewInvAI && typeof window.ViewInvAI.replaceFavoriteKeys === "function") {
    window.ViewInvAI.replaceFavoriteKeys(portfolioStockKeys());
  }
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
  if (!stock) return { price: null, change: null, currency: preferTr ? "EUR" : "USD", eur: null, usd: null, source: "", updatedAt: null };
  if (window.ViewInvAI && (typeof window.ViewInvAI.getDisplayQuote === "function" || typeof window.ViewInvAI.getCanonicalQuote === "function")) {
    const quote = (preferTr && typeof window.ViewInvAI.getCanonicalQuote === "function"
      ? window.ViewInvAI.getCanonicalQuote(stock, true)
      : typeof window.ViewInvAI.getDisplayQuote === "function"
        ? window.ViewInvAI.getDisplayQuote(stock, false)
        : window.ViewInvAI.getCanonicalQuote(stock, false)) || {};
    return {
      price: num(quote.price),
      change: num(quote.change),
      currency: quote.nativeCurrency || (preferTr ? "EUR" : "USD"),
      eur: num(quote.eur),
      usd: num(quote.usd),
      source: quote.source || "",
      updatedAt: quote.updatedAt || null,
      live: quote.live === true,
      fallback: quote.fallback === true
    };
  }
  if (preferTr) {
    const eur = num(stock.trLivePrice);
    return { price: eur, change: num(stock.trLiveChangePct), currency: "EUR", eur, usd: null, source: "Trade Republic / LSX" };
  }
  const usd = num(stock.usLivePrice) ?? num(stock.price);
  return { price: usd, change: num(stock.usLiveChangePct) ?? num(stock.changePct), currency: "USD", eur: null, usd, source: "EEUU" };
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

function portfolioSummaryHtml(portfolio, positions) {
  if (!portfolio) return "";
  const baseCurrency = String(portfolio.base_currency || "EUR").toUpperCase();
  const txSummary = state.portfolioTransactionSummaries[String(portfolio.id)] || null;
  if (!positions.length && !txSummary) return "";
  let currentValue = 0, invested = 0, currentComplete = true, costComplete = true, analyzed = 0;
  for (const p of positions) {
    const stock = stockByKey(p.stock_key);
    const qty = num(p.quantity);
    if (p.last_signal) analyzed++;
    if (!stock || qty === null) { currentComplete = false; costComplete = false; continue; }
    const preferTr = Number(p.prefer_tr) === 1;
    const market = currentMarket(stock, preferTr);
    const currentUnit = marketValueInCurrency(market, baseCurrency);
    if (currentUnit === null) currentComplete = false;
    else currentValue += qty * currentUnit;

    const entryCurrency = String(p.currency || (preferTr ? "EUR" : "USD")).toUpperCase();
    const avg = num(p.avg_price);
    if (avg === null || entryCurrency !== baseCurrency) costComplete = false;
    else invested += qty * avg;
  }

  const openPnl = currentComplete && costComplete ? currentValue - invested : null;
  const openPnlPct = openPnl !== null && invested > 0 ? openPnl / invested * 100 : null;
  const currencySummary = txSummary && txSummary.currencies && txSummary.currencies[baseCurrency] || null;
  const realizedPnl = currencySummary ? num(currencySummary.realizedPnl) : null;
  const totalPnl = openPnl !== null && realizedPnl !== null ? openPnl + realizedPnl : null;
  const pnlHtml = (label, value, suffix = "") => value === null ? "" :
    '<div><small>' + label + '</small><strong class="' + (value >= 0 ? 'pnl-up' : 'pnl-down') + '">' +
      (value > 0 ? '+' : '') + formatMoney(value, baseCurrency) + suffix + '</strong></div>';

  return '<div class="portfolio-summary-bar">' +
    '<div><small>CARTERA</small><strong>' + esc(portfolio.name) + '</strong></div>' +
    '<div><small>VALOR ACTUAL</small><strong>' + (currentComplete ? formatMoney(currentValue, baseCurrency) : '—') + '</strong></div>' +
    pnlHtml('ABIERTO', openPnl, openPnlPct === null ? '' : ' · ' + (openPnlPct >= 0 ? '+' : '') + formatNumber(openPnlPct, 2) + '%') +
    pnlHtml('REALIZADO', realizedPnl) +
    pnlHtml('TOTAL', totalPnl) +
    '<div><small>SEGUIMIENTO IA</small><strong>' + analyzed + '/' + positions.length + '</strong></div>' +
  '</div>';
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

  return window.ViewInvAI.renderStandardStockCard(stock, {
    index, preferTr, context: "portfolio", hint: "Cartera · posición activa", rankLabel: "",
    className: "portfolio-position-card",
    openAttrs: ' data-open-stock="' + esc(p.stock_key) + '" data-position-prefer-tr="' + (preferTr ? '1' : '0') + '" role="button" tabindex="0"',
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
      : '<div class="portfolio-empty-state compact">Esta cartera todavía no tiene posiciones. Pulsa “Añadir posición” para empezar.</div>';
    return summary +
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
function portfolioGoalPositionSnapshot(p,fxUsdEur){
  const stock=stockByKey(p.stock_key),qty=num(p.quantity);if(!stock||qty===null)return null;
  const preferTr=Number(p.prefer_tr)===1,market=currentMarket(stock,preferTr);
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
  let currentValue=0,openPnl=0,currentComplete=true,pnlComplete=true;
  for(const row of rows){if(row.valueEur===null)currentComplete=false;else currentValue+=row.valueEur;if(row.pnlEur===null)pnlComplete=false;else openPnl+=row.pnlEur}
  let realizedPnl=0,realizedKnown=true;
  const summary=state.portfolioTransactionSummaries[String(portfolio.id)]||null;
  if(summary){
    for(const [currency,data] of Object.entries(summary.currencies||{})){
      const v=num(data&&data.realizedPnl);if(v===null)continue;
      if(currency==="EUR")realizedPnl+=v;else if(currency==="USD"&&fxUsdEur!==null)realizedPnl+=v*fxUsdEur;else realizedKnown=false;
    }
  }
  const totalPnl=pnlComplete&&realizedKnown?openPnl+realizedPnl:null,target=portfolioGoalTarget(),capital=currentComplete?currentValue:null;
  const remaining=target!==null&&capital!==null?target-capital:null;
  const progress=target&&capital!==null?Math.max(0,Math.min(100,capital/target*100)):0;
  const requiredMultiple=target!==null&&capital!==null&&capital>0?target/capital:null;
  const requiredReturnPct=requiredMultiple!==null?(requiredMultiple-1)*100:null;
  const goalPressure=remaining!==null&&remaining>0&&capital>0?Math.max(0,Math.min(1,remaining/capital)):0;
  return{portfolio,rows,fxUsdEur,currentValue:capital,openPnl:pnlComplete?openPnl:null,realizedPnl,realizedKnown,totalPnl,target,remaining,progress,goalPressure,requiredMultiple,requiredReturnPct,marketScope:portfolioMarketScope(portfolio,positions)};
}

function coachPriceLevels(stock,preferTr,score){
  const market=currentMarket(stock,preferTr),price=num(market.price),change=Math.abs(num(market.change)||0);
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
    if(backendSignal==="SELL"||score<=35)targetWeight=0;
    else if(backendSignal==="REVIEW"||score<48)targetWeight=Math.min(currentWeight,12);
    else if(currentWeight>45)targetWeight=Math.min(currentWeight,score>=70?30:22);
    else if(currentWeight>35&&score<65)targetWeight=Math.min(currentWeight,28);
    if(goalReached&&backendSignal==="HOLD"&&score>=55)targetWeight=Math.min(targetWeight,currentWeight);
    const reducePct=currentWeight>0?Math.max(0,(currentWeight-targetWeight)/currentWeight*100):0;
    const units=row.qty*reducePct/100,released=row.valueEur===null?0:row.valueEur*reducePct/100;
    const action=reducePct>=95?"SALIR":reducePct>=8?"REDUCIR":"MANTENER",reasons=[];
    if(backendSignal)reasons.push("señal IA "+signalInfo(backendSignal)[0].toLowerCase());
    else reasons.push("pendiente de análisis IA de cartera");
    if(currentWeight>35)reasons.push("concentración "+formatNumber(currentWeight,1)+"%");
    reasons.push("score "+formatNumber(score,0)+"/100");
    if(quality)reasons.push("calidad de datos "+formatNumber(quality,0)+"/100");
    if(goalReached)reasons.push("objetivo alcanzado: priorizar protección");
    const levels=action==="SALIR"?{stop:null,take:null,stopPct:null,takePct:null,currency:row.market.currency||"EUR"}:coachPriceLevels(row.stock,row.preferTr,score);
    return{...row,score,quality,currentWeight,targetWeight,reducePct,units,released,action,reasons,levels};
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
  const excluded=new Set(metrics.rows.map(x=>portfolioStockKey(x.stock))),goalReached=num(metrics.remaining)!==null&&metrics.remaining<=0;
  const cacheKey=marketScope+"|"+String(metrics.portfolio&&metrics.portfolio.id||"")+"|"+[...excluded].sort().join("|")+"|"+String(Math.round(num(metrics.remaining)||0));
  if(state.goalCandidateCache.key===cacheKey&&Date.now()-state.goalCandidateCache.at<60000)return state.goalCandidateCache.rows;
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
  try{ingest(window.ViewInvAIPulseCoach?.rankCandidates?.(25,[...excluded],marketScope)||[],"Pulso IA")}catch(_){}
  try{ingest(window.ViewInvAIRadarCoach?.rankCandidates?.(25,[...excluded],marketScope)||[],"Radar")}catch(_){}
  const released=goalReached?0:positionRows.reduce((sum,row)=>sum+(num(row.released)||0),0),currentValue=num(metrics.currentValue)||0,remaining=Math.max(0,num(metrics.remaining)||0);
  const goalPressure=Math.max(0,Math.min(1,num(metrics.goalPressure)||0));
  const rotationPool=goalReached?0:(released>0?released:currentValue*Math.max(.15,Math.min(.35,.18+goalPressure*.17)));
  const allocationCapPct=Math.max(.08,Math.min(.35,.10+goalPressure*.25));
  const rows=[...merged.values()].map(row=>{
    const scores=[row.pulseScore,row.radarScore].filter(x=>x!==null);
    const score=scores.length?Math.min(100,Math.max(...scores)+(scores.length>1?3:0)):0;
    const velocity=portfolioGoalVelocityScore(row.stock,score,row.quality);
    return{...row,score,velocityScore:velocity.score,catalyst:velocity.catalyst};
  }).filter(row=>row.score>=58&&row.quality>=42)
    .sort((a,b)=>b.velocityScore-a.velocityScore||b.score-a.score||b.quality-a.quality).slice(0,6)
    .map((row,index,arr)=>{
      const slots=Math.max(1,Math.min(3,arr.length)),perSlot=rotationPool/slots;
      const allocation=Math.min(perSlot,currentValue*allocationCapPct);
      const levels=coachPriceLevels(row.stock,row.preferTr,row.score);
      const potentialGain=allocation>0&&levels.takePct!==null?allocation*levels.takePct/100:0;
      const goalShare=remaining>0?Math.min(100,potentialGain/remaining*100):0;
      return{...row,allocation,levels,potentialGain,goalShare,rotationScenario:released<=0&&allocation>0};
    });
  state.goalCandidateCache={at:Date.now(),key:cacheKey,rows};return rows;
}

function goalPositionPlanHtml(row){
  const tone=row.action==="SALIR"?"bad":row.action==="REDUCIR"?"warn":"good";
  const unitText=row.action==="MANTENER"?"Sin reducción propuesta":row.action==="SALIR"?"Revisar salida total de "+formatNumber(row.qty,4)+" uds.":"Reducir aprox. "+formatNumber(row.units,4)+" uds. ("+formatNumber(row.reducePct,0)+"%)";
  const levels=row.levels.stop!==null?'<span>Stop orientativo <b>'+formatMoney(row.levels.stop,row.levels.currency)+'</b> · Take profit <b>'+formatMoney(row.levels.take,row.levels.currency)+'</b></span>':'<span>Si se decide salir, no se propone mantener un stop/take artificial.</span>';
  return '<article class="portfolio-goal-action '+tone+'" data-open-stock="'+esc(row.p.stock_key)+'" data-position-prefer-tr="'+(row.preferTr?'1':'0')+'" role="button" tabindex="0">'+
    '<div class="goal-action-head"><div><strong>'+esc(row.stock.name||row.p.ticker||row.p.stock_key)+'</strong><small>'+esc(row.p.ticker||row.stock.ticker||'')+'</small></div><b>'+row.action+'</b></div>'+
    '<div class="goal-action-grid"><span>Exposición <b>'+formatNumber(row.currentWeight,1)+'% → '+formatNumber(row.targetWeight,1)+'%</b></span><span>'+unitText+'</span>'+levels+'</div><p>'+esc(row.reasons.join(" · "))+'</p></article>';
}
function goalCandidateHtml(row){
  const key=portfolioStockKey(row.stock);
  const alloc=row.allocation>0?(row.rotationScenario?'Escenario de rotación a estudiar: <b>'+formatMoney(row.allocation,"EUR")+'</b>':'Capital liberado a reasignar: <b>'+formatMoney(row.allocation,"EUR")+'</b>'):'Sin capital asignado en este escenario.';
  const levels=row.levels.stop!==null?'Stop orientativo <b>'+formatMoney(row.levels.stop,row.levels.currency)+'</b> · Take profit <b>'+formatMoney(row.levels.take,row.levels.currency)+'</b>':'Niveles pendientes de cotización válida.';
  const contribution=row.potentialGain>0?'Si alcanzara ese take profit, aportaría aproximadamente <b>'+formatMoney(row.potentialGain,"EUR")+'</b> ('+formatNumber(row.goalShare,1)+'% de lo que falta).':'La oportunidad se muestra por calidad, no como promesa de rentabilidad.';
  const catalyst=row.catalyst||portfolioGoalCatalyst(row.stock),action=row.allocation>0?(row.rotationScenario?"ROTACIÓN A ESTUDIAR":"COMPRAR / ROTAR"):"VIGILAR",marketLabel=row.preferTr?"TR / LSX":"EEUU";
  return '<article class="portfolio-goal-candidate" data-open-stock="'+esc(key)+'" data-position-prefer-tr="'+(row.preferTr?'1':'0')+'" role="button" tabindex="0">'+
    '<div class="goal-candidate-head"><div><strong>'+esc(row.stock.name||row.stock.ticker||key)+'</strong><small>'+esc([row.preferTr?(row.stock.trTicker||row.stock.ticker):row.stock.ticker,marketLabel,row.sources.join(" + ")].filter(Boolean).join(" · "))+'</small></div><b class="goal-candidate-action">'+action+'</b></div>'+
    '<div class="goal-candidate-kpis"><span>Velocidad IA <b>'+formatNumber(row.velocityScore,0)+'/100</b></span><span>Convicción <b>'+formatNumber(row.score,0)+'/100</b></span><span>Catalizador <b>'+esc(catalyst.label)+'</b></span><span>Cuándo <b>'+esc(catalyst.when||"Sin fecha")+'</b></span></div>'+
    (catalyst.title?'<p class="goal-candidate-catalyst">'+esc(catalyst.title)+'</p>':'')+'<p>'+alloc+'</p><p>'+levels+'</p><p>'+contribution+'</p></article>';
}
function portfolioGoalViewHtml(){
  const metrics=portfolioGoalMetrics(),portfolio=metrics.portfolio,positionRows=portfolioCoachPositionRows(metrics),candidates=portfolioCoachCandidates(metrics,positionRows),target=metrics.target;
  if(!portfolio)return'<div class="portfolio-empty-state">Selecciona o crea una cartera para definir su objetivo.</div>';
  const targetValue=target===null?"":String(Math.round(target*100)/100),marketLabel=portfolioMarketLabel(metrics.marketScope);
  const planHtml=positionRows.length?positionRows.map(goalPositionPlanHtml).join(""):'<div class="portfolio-empty-state compact">Añade posiciones a esta cartera para que el motor pueda comparar lo que mantienes con otras oportunidades del mismo mercado.</div>';
  let candidatesHtml='';
  if(metrics.marketScope==="auto")candidatesHtml='<div class="portfolio-empty-state compact">Configura el mercado de esta cartera para que el motor solo proponga acciones que puedas comprar en ella.</div>';
  else if(num(metrics.remaining)!==null&&metrics.remaining<=0)candidatesHtml='<div class="portfolio-empty-state compact">Objetivo de valor alcanzado. No se propone rotar capital solo por seguir operando.</div>';
  else candidatesHtml=candidates.length?candidates.map(goalCandidateHtml).join(""):'<div class="portfolio-empty-state compact">No hay ahora mismo candidatas del mercado '+esc(marketLabel)+' que superen el mínimo de calidad. No se fuerza una operación.</div>';
  const errorHtml=state.goalError?'<div class="portfolio-goal-error" role="alert">'+esc(state.goalError)+'</div>':'';
  const growthText=metrics.requiredMultiple!==null&&metrics.requiredMultiple>1
    ?'Para pasar de '+formatMoney(metrics.currentValue,"EUR")+' a '+formatMoney(target,"EUR")+' el capital tendría que multiplicarse aproximadamente por '+formatNumber(metrics.requiredMultiple,2)+' ('+formatNumber(metrics.requiredReturnPct,0)+'%). Es una distancia matemática, no una rentabilidad prevista.'
    :'El objetivo está alcanzado o no hay suficiente información de valoración para calcular la distancia.';
  return '<section class="portfolio-goal-view" data-goal-portfolio="'+esc(portfolio.id)+'">'+
    '<div class="portfolio-goal-hero"><div><small>MOTOR IA · '+esc(portfolio.name)+' · '+esc(marketLabel)+'</small><h2>Objetivo IA de '+esc(portfolio.name)+'</h2><p>El motor trabaja únicamente con esta cartera y con acciones compatibles con su mercado. Compara lo que ya tienes con Pulso IA, Radar y catalizadores para proponer mantener, reducir o estudiar una rotación. No ejecuta órdenes ni puede garantizar alcanzar el objetivo.</p></div>'+
      '<form id="portfolioGoalForm" class="portfolio-goal-form" data-portfolio-id="'+esc(portfolio.id)+'"><label><span>Valor objetivo de la cartera</span><div><input name="targetValueEur" type="number" min="1" step="0.01" inputmode="decimal" value="'+esc(targetValue)+'" placeholder="1000"><b>€</b></div></label><button type="submit" class="btn">'+(target===null?'Crear objetivo':'Guardar')+'</button><div class="portfolio-goal-form-status" data-goal-form-status aria-live="polite"></div></form>'+
    '</div>'+errorHtml+
    (target===null?'<div class="portfolio-goal-empty"><strong>Indica a qué valor quieres llevar esta cartera.</strong><span>Ejemplo: si hoy vale 90 € y marcas 1.000 €, el motor medirá la distancia desde esos 90 € y buscará alternativas compatibles con '+esc(marketLabel)+'.</span></div>':
    '<div class="portfolio-goal-metrics"><div><small>VALOR OBJETIVO</small><strong>'+formatMoney(target,"EUR")+'</strong></div><div><small>CAPITAL ACTUAL</small><strong>'+formatMoney(metrics.currentValue,"EUR")+'</strong></div><div><small>FALTA PARA EL OBJETIVO</small><strong>'+formatMoney(Math.max(0,num(metrics.remaining)||0),"EUR")+'</strong></div><div><small>CRECIMIENTO NECESARIO</small><strong>'+(metrics.requiredMultiple===null?'—':'×'+formatNumber(metrics.requiredMultiple,2))+'</strong></div></div>'+
    '<div class="portfolio-goal-progress"><div><span>Progreso por valor de cartera</span><b>'+formatNumber(metrics.progress,1)+'%</b></div><i><em style="width:'+Math.max(0,Math.min(100,metrics.progress))+'%"></em></i></div>'+
    '<div class="portfolio-goal-distance"><strong>Distancia al objetivo</strong><span>'+esc(growthText)+'</span></div>'+
    '<div class="portfolio-goal-strategy"><div><small>MERCADO</small><strong>'+esc(marketLabel)+'</strong></div><div><small>PRIORIDAD</small><strong>Velocidad ajustada por riesgo</strong></div><div><small>MOTOR</small><strong>Pulso IA + Radar + catalizadores</strong></div></div>'+
    '<div class="portfolio-goal-toolbar"><span>Las candidatas se filtran por el mercado configurado en '+esc(portfolio.name)+'. Una cartera LSX no recibirá propuestas exclusivas de Nasdaq/NYSE.</span><button type="button" class="btn ghost compact" data-goal-refresh-plan>↻ Reanalizar '+esc(portfolio.name)+'</button></div>'+
    '<section class="portfolio-goal-section"><header><div><small>PASO 1 · REVISAR LO QUE YA TIENES</small><h3>Mantener, reducir o liberar capital</h3></div></header><div class="portfolio-goal-actions">'+planHtml+'</div></section>'+
    '<section class="portfolio-goal-section"><header><div><small>PASO 2 · OPCIONES DEL MISMO MERCADO</small><h3>Rotaciones y compras a estudiar</h3></div></header><div class="portfolio-goal-candidates">'+candidatesHtml+'</div></section>'+
    '<p class="portfolio-goal-note">Los escenarios de rotación, stops, take profit y contribuciones son herramientas de análisis. No son resultados previstos ni una promesa de alcanzar el objetivo en un plazo concreto.</p>')+'</section>';
}

async function savePortfolioGoal(targetValueEur,portfolioId=state.selectedPortfolioId){
  if(!portfolioId)throw new Error("Selecciona una cartera.");
  const response=await api("/api/portfolio-goal",{method:"PATCH",body:JSON.stringify({portfolioId,targetValueEur})}),data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"No se pudo guardar el objetivo.");
  if(data.goal)state.goals[String(portfolioId)]=data.goal;
  state.goal=data.goal||null;state.goalError="";state.goalCandidateCache={at:0,key:"",rows:[]};renderApp();return state.goal;
}
async function refreshGoalSummaries(){
  if(state.selectedPortfolioId)await refreshPortfolioTransactionSummary(state.selectedPortfolioId,false).catch(()=>null);
  if(state.primaryTab==="goal")renderApp();
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

function portfolioPrimaryTabsHtml(selected){
  if(!selected)return'';
  const scope=portfolioMarketScope(selected);
  return '<div class="portfolio-selected-nav"><nav class="portfolio-primary-tabs market-tabs compact-tabs" role="tablist" aria-label="Vista de '+esc(selected.name)+'">'+
    '<button type="button" class="tab portfolio-primary-tab'+(state.primaryTab==="portfolio"?' active':'')+'" data-portfolio-primary="portfolio" role="tab" aria-selected="'+(state.primaryTab==="portfolio"?'true':'false')+'">Posiciones</button>'+
    '<button type="button" class="tab portfolio-primary-tab'+(state.primaryTab==="goal"?' active':'')+'" data-portfolio-primary="goal" role="tab" aria-selected="'+(state.primaryTab==="goal"?'true':'false')+'">Objetivo IA</button>'+
  '</nav><button type="button" class="portfolio-market-scope'+(scope==="auto"?' unresolved':'')+'" data-portfolio-market-config="'+esc(selected.id)+'"><span>MERCADO</span><strong>'+esc(portfolioMarketLabel(scope))+'</strong><em>Configurar</em></button></div>';
}

function portfolioWorkbarHtml(selected){
  return '<div class="portfolio-workbar">'+
    '<div class="portfolio-tabs-wrap">'+
      '<div class="portfolio-tabs-track" id="portfolioTabsTrack" role="tablist" aria-label="Mis carteras">'+state.portfolios.map(renderPortfolioCard).join('')+'</div>'+
      '<button type="button" class="portfolio-icon-action portfolio-tab-add" data-new-portfolio="1" aria-label="Nueva cartera" title="Nueva cartera">＋</button>'+
      '<button type="button" class="portfolio-tabs-more" data-portfolio-tabs-more aria-label="Mostrar carteras ocultas" title="Más carteras" hidden>›</button>'+
      '<button type="button" class="portfolio-icon-action portfolio-tabs-edit" data-portfolio-order-edit aria-label="Editar carteras" title="Editar carteras">✎</button>'+
      '<button type="button" class="portfolio-icon-action portfolio-history"'+(selected?' data-portfolio-history="'+esc(selected.id)+'"':' disabled')+' aria-label="Historial" title="Historial">◷</button>'+
      '<button type="button" class="portfolio-icon-action portfolio-add-current"'+(selected?'':' disabled')+' aria-label="Añadir posición" title="Añadir posición">⊕</button>'+
      '<div class="portfolio-tabs-overflow" id="portfolioTabsOverflow" aria-hidden="true"></div>'+
    '</div>'+
    '<button type="button" class="portfolio-refresh compact" aria-label="Actualizar carteras" title="Actualizar">↻</button>'+
  '</div>';
}

function renderApp() {
  const box=$("#portfolioApp");if(!box)return;if(!state.user)return renderLoggedOut(box);if(state.loading)return renderLoading(box);
  state.portfolios.sort((a,b)=>{const ao=num(a.sort_order)??0,bo=num(b.sort_order)??0;return ao-bo||String(a.created_at||"").localeCompare(String(b.created_at||""))});
  if(!state.selectedPortfolioId&&state.portfolios.length)state.selectedPortfolioId=state.portfolios[0].id;
  if(state.selectedPortfolioId&&!state.portfolios.some(p=>String(p.id??"")===String(state.selectedPortfolioId??"")))state.selectedPortfolioId=state.portfolios[0]?state.portfolios[0].id:null;
  const selected=state.portfolios.find(p=>String(p.id??"")===String(state.selectedPortfolioId??""))||null;
  const positions=selected?portfolioPositions(selected.id):[];
  savePortfolioUi();

  state.goal=selected?state.goals[String(selected.id)]||null:null;
  box.innerHTML=portfolioWorkbarHtml(selected)+portfolioPrimaryTabsHtml(selected)+
    (state.primaryTab==="goal"
      ? portfolioGoalViewHtml()
      : '<div id="portfolioContext" class="portfolio-context">'+portfolioContextHtml(selected,positions)+'</div>');

  requestAnimationFrame(()=>{
    updatePortfolioTabOverflow();
    if(window.ViewInvAI&&typeof window.ViewInvAI.observeLiveQuotes==="function")window.ViewInvAI.observeLiveQuotes(box);
  });
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
  renderApp();
  try {
    const [portfolios, positions, watchlist, goalData] = await Promise.all([
      fetchJson("/api/portfolios"),fetchJson("/api/positions"),fetchJson("/api/watchlist"),
      fetchJson("/api/portfolio-goal").then(data=>({goals:data.goals||[],error:""})).catch(error=>({goals:[],error:error.message||"No se pudieron cargar los objetivos."}))
    ]);
    state.portfolios=portfolios.portfolios||[];state.positions=positions.positions||[];state.watchlist=watchlist.watchlist||[];
    state.goals=Object.fromEntries((goalData.goals||[]).map(goal=>[String(goal.portfolio_id),goal]));
    state.goalError=goalData.error||"";
    syncPortfolioStars();
    window.dispatchEvent(new CustomEvent('viewinvai:portfolio-membership-changed', {detail:{}}));
  } catch (error) {
    ok = false;
    console.warn("Portfolio loading failed", error);
    toast(error.message || "No se pudieron cargar las carteras.", true);
  } finally {
    state.loading = false;
    renderApp();
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
    portfolioId: position.portfolio_id,
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
    if (rerender && String(state.selectedPortfolioId || "") === portfolioId) renderApp();
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

async function openTransactionsModal(positionId) {
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
            '<label><span>Tipo</span><select name="side"><option value="BUY">Compra</option><option value="SELL">Venta</option></select></label>' +
            '<label><span>Cantidad</span><input name="quantity" type="number" inputmode="decimal" step="any" min="0.00000001" required></label>' +
          '</div>' +
          '<div class="portfolio-form-grid">' +
            '<label><span>Precio</span><input name="price" type="number" inputmode="decimal" step="any" min="0" required placeholder="' + esc(market.price || '') + '"></label>' +
            '<label><span>Comisión</span><input name="fees" type="number" inputmode="decimal" step="any" min="0" value="0"></label>' +
          '</div>' +
          '<div class="portfolio-form-grid">' +
            '<label><span>Divisa</span><input name="currency" value="' + esc(currency) + '" readonly></label>' +
            '<label><span>Fecha y hora</span><input name="executedAt" type="datetime-local" value="' + localDateTimeValue() + '" required></label>' +
          '</div>' +
          '<label><span>Nota</span><input name="notes" maxlength="1000" placeholder="Opcional"></label>' +
          '<div class="portfolio-form-status" data-transaction-status aria-live="polite"></div>' +
          '<button type="submit" class="btn">Registrar operación</button>' +
        '</form>' +
        '<div class="transaction-history-head"><strong>Historial</strong><span>' + (data.transactions || []).length + ' operaciones</span></div>' +
        '<div class="transaction-history">' + transactionRowsHtml(data.transactions || [], currency) + '</div>' +
      '</div>';
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
    fees: num(fd.get('fees')) || 0,
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
    if (data.position && Number(data.position.active) !== 0) await openTransactionsModal(data.position.id);
    else closeModal();
  } catch (error) {
    if (status) status.textContent = error.message || 'No se pudo guardar la operación.';
    toast(error.message || 'No se pudo guardar la operación.', true);
  } finally {
    delete form.dataset.saving;
    if (button && button.isConnected) { button.disabled = false; button.textContent = 'Registrar operación'; }
  }
}

async function deleteTransaction(transactionId) {
  if (!transactionId) return;
  const ledger = document.querySelector('[data-transaction-position]');
  const positionId = ledger && ledger.dataset.transactionPosition;
  try {
    const response = await api('/api/transactions/' + encodeURIComponent(transactionId), {method:'DELETE'});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo eliminar la operación.');
    toast('Operación eliminada');
    await loadAll();
    if (data.position && Number(data.position.active) !== 0) await openTransactionsModal(data.position.id);
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
      '<button type="submit" class="btn">Crear cartera</button>' +
    '</form>'
  );
  setTimeout(() => $("#newPortfolioForm input[name=name]")?.focus(), 40);
}

function openPortfolioMarketModal(portfolioId){
  const portfolio=state.portfolios.find(p=>String(p.id)===String(portfolioId));if(!portfolio)return;
  const scope=String(portfolio.market_scope||"auto");
  openModal("Mercado · "+portfolio.name,
    '<form id="portfolioMarketForm" class="portfolio-form" data-portfolio-id="'+esc(portfolio.id)+'">'+
      '<p class="portfolio-form-note">Este ajuste limita tanto las posiciones nuevas como las recomendaciones del Objetivo IA.</p>'+
      '<label><span>Mercado permitido</span><select name="marketScope">'+
        '<option value="auto"'+(scope==="auto"?' selected':'')+'>Detectar por posiciones</option>'+
        '<option value="tr"'+(scope==="tr"?' selected':'')+'>Trade Republic / LSX</option>'+
        '<option value="us"'+(scope==="us"?' selected':'')+'>EEUU (NASDAQ / NYSE / AMEX)</option>'+
      '</select></label>'+
      '<button type="submit" class="btn">Guardar mercado</button>'+
    '</form>'
  );
}
async function savePortfolioMarket(form){
  const portfolioId=form.dataset.portfolioId,fd=new FormData(form),marketScope=String(fd.get("marketScope")||"auto");
  const response=await api("/api/portfolios/"+encodeURIComponent(portfolioId),{method:"PATCH",body:JSON.stringify({marketScope})});
  const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"No se pudo guardar el mercado.");
  const index=state.portfolios.findIndex(p=>String(p.id)===String(portfolioId));if(index>=0)state.portfolios[index]=data.portfolio;
  state.goalCandidateCache={at:0,key:"",rows:[]};closeModal();renderApp();toast("Mercado de la cartera actualizado");
}

function stockFormPayload(stock, form) {
  const fd = new FormData(form);
  const preferTr = form.dataset.preferTr === "1";
  const ticker = preferTr && stock.trTicker ? stock.trTicker : stock.ticker;
  return {
    portfolioId: String(fd.get("portfolioId") || ""),
    stockKey: window.ViewInvAI.getStockKey(stock),
    ticker: String(ticker || stock.ticker || ""),
    name: stock.name || "",
    exchange: preferTr ? (stock.trExchange || "LSX") : (stock.exchange || ""),
    isin: preferTr ? (stock.trIsin || stock.isin || "") : (stock.isin || stock.usIsin || ""),
    preferTr,
    quantity: num(fd.get("quantity")),
    avgPrice: num(fd.get("avgPrice")),
    currency: String(fd.get("currency") || (preferTr ? "EUR" : stock.currency || "USD")),
    openedAt: String(fd.get("openedAt") || ""),
    notes: String(fd.get("notes") || "")
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

function applyPositionFormState(form, stock, fallbackPreferTr) {
  if (!form || !stock) return;
  const portfolioId = form.querySelector('[name="portfolioId"]')?.value || '';
  const existing = positionForPortfolioStock(form.dataset.stockKey, portfolioId);
  const portfolio=state.portfolios.find(p=>String(p.id)===String(portfolioId))||null,scope=portfolioMarketScope(portfolio);
  const preferTr = existing ? Number(existing.prefer_tr) === 1 : scope==="tr"?true:scope==="us"?false:fallbackPreferTr;
  const current = currentMarket(stock, preferTr);
  form.dataset.preferTr = preferTr ? '1' : '0';
  form.dataset.existingPositionId = existing?.id || '';

  const quantity = form.querySelector('[name="quantity"]');
  const avgPrice = form.querySelector('[name="avgPrice"]');
  const currency = form.querySelector('[name="currency"]');
  const openedAt = form.querySelector('[name="openedAt"]');
  const notes = form.querySelector('[name="notes"]');
  const save = form.querySelector('[data-save-position]');
  const mode = form.querySelector('[data-position-form-mode]');

  if (quantity) quantity.value = existing && num(existing.quantity) !== null ? existing.quantity : '';
  if (avgPrice) {
    avgPrice.value = existing && num(existing.avg_price) !== null ? existing.avg_price : '';
    avgPrice.placeholder = current.price === null ? '' : String(current.price);
  }
  if (currency) currency.value = existing
    ? String(existing.currency || (preferTr ? 'EUR' : stock.currency || 'USD')).toUpperCase()
    : (preferTr ? 'EUR' : String(stock.currency || 'USD').toUpperCase());
  if (openedAt) openedAt.value = existing && existing.opened_at ? String(existing.opened_at).slice(0,10) : localDateValue();
  if (notes) notes.value = existing?.notes || '';
  if (save) save.textContent = existing ? 'Guardar cambios' : 'Guardar posición';
  if (mode) mode.textContent = existing
    ? 'Posición existente · modifica los datos o usa Operaciones para compras/ventas parciales.'
    : 'Nueva posición en esta cartera.';
}

function openAddPositionModal(stockKey, preferTrOverride = null, portfolioIdOverride = null) {
  if (!state.user) return window.ViewInvAIAuth && window.ViewInvAIAuth.signIn();
  if (!state.portfolios.length) {
    toast("Primero crea una cartera.", true);
    openNewPortfolioModal();
    return;
  }
  const stock = stockByKey(stockKey);
  if (!stock) {
    toast("Abre primero una acción para añadirla.", true);
    return;
  }

  const memberships = activePortfolioMemberships(stockKey);
  const preferredPortfolioId = portfolioIdOverride ||
    (state.selectedPortfolioId && state.portfolios.some(p => p.id === state.selectedPortfolioId) ? state.selectedPortfolioId : '') ||
    (memberships.length === 1 ? memberships[0].position.portfolio_id : '') ||
    state.portfolios[0].id;
  const existingInitial = positionForPortfolioStock(stockKey, preferredPortfolioId);
  const preferredPortfolio=state.portfolios.find(p=>String(p.id)===String(preferredPortfolioId))||null;
  const scope=portfolioMarketScope(preferredPortfolio);
  const preferTr = existingInitial
    ? Number(existingInitial.prefer_tr) === 1
    : scope==="tr" ? true : scope==="us" ? false
    : preferTrOverride === true ? true : preferTrOverride === false ? false : !!(stock.tradeRepublicTradable || stock.tradeRepublicVerified);
  if(scope==="tr"&&!(stock.tradeRepublicTradable===true||(stock.tradeRepublicVerified&&stock.trTicker))){
    toast("Esta acción no está verificada como negociable en Trade Republic / LSX.",true);return;
  }
  const current = currentMarket(stock, preferTr);
  const options = state.portfolios.map(p => '<option value="' + esc(p.id) + '"' + (String(p.id) === String(preferredPortfolioId) ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');

  openModal((existingInitial ? "Gestionar " : "Añadir ") + (stock.trTicker || stock.ticker || "acción"),
    '<form id="addPositionForm" class="portfolio-form" data-stock-key="' + esc(stockKey) + '" data-prefer-tr="' + (preferTr ? '1' : '0') + '">' +
      '<div class="position-form-stock"><strong>' + esc(stock.trTicker || stock.ticker || "") + '</strong><span>' + esc(stock.name || "") + '</span><b>' + formatMoney(current.price, current.currency) + '</b></div>' +
      '<div class="portfolio-form-mode" data-position-form-mode></div>' +
      '<label><span>Cartera</span><select name="portfolioId" required>' + options + '</select></label>' +
      '<div class="portfolio-form-grid"><label><span>Cantidad</span><input name="quantity" type="number" inputmode="decimal" step="any" min="0" placeholder="0"></label>' +
      '<label><span>Precio medio</span><input name="avgPrice" type="number" inputmode="decimal" step="any" min="0" placeholder="' + esc(current.price || "") + '"></label></div>' +
      '<div class="portfolio-form-grid"><label><span>Divisa</span><select name="currency"><option>EUR</option><option>USD</option><option>GBP</option></select></label>' +
      '<label><span>Fecha de entrada</span><span class="portfolio-date-field"><input id="openedAtInput" name="openedAt" type="date" value="' + localDateValue() + '" required><button type="button" class="portfolio-date-picker" data-open-date-picker aria-label="Abrir calendario">📅</button></span></label></div>' +
      '<label><span>Nota</span><textarea name="notes" rows="2" maxlength="1000" placeholder="Opcional"></textarea></label>' +
      '<div class="portfolio-form-status" data-position-status aria-live="polite"></div>' +
      '<button type="button" class="btn" data-save-position>Guardar posición</button>' +
    '</form>'
  );

  const form = $("#addPositionForm");
  const saveButton = form?.querySelector("[data-save-position]");
  if (form) {
    applyPositionFormState(form, stock, preferTr);
    form.querySelector('[name="portfolioId"]')?.addEventListener('change', () => {
      applyPositionFormState(form, stock, preferTrOverride === true ? true : preferTrOverride === false ? false : preferTr);
    });
  }
  if (form && saveButton) {
    saveButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      savePositionForm(form);
    });
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

  const rows = state.portfolios.map(p => {
    const existing = positionForPortfolioStock(stockKey, p.id);
    if (!existing) {
      return '<button type="button" class="star-portfolio-choice" data-star-add-portfolio="' + esc(p.id) + '" data-star-stock="' + esc(stockKey) + '" data-star-prefer-tr="' + (preferTr === true ? '1' : preferTr === false ? '0' : '') + '">' +
        '<span>☆</span><strong>' + esc(p.name) + '</strong><small>Añadir a esta cartera</small>' +
      '</button>';
    }

    const qty = num(existing.quantity), avg = num(existing.avg_price);
    const currency = String(existing.currency || (Number(existing.prefer_tr) === 1 ? 'EUR' : 'USD')).toUpperCase();
    const detail = (qty === null ? 'Posición activa' : formatNumber(qty,4) + ' uds.') + (avg === null ? '' : ' · media ' + formatMoney(avg,currency));
    return '<div class="star-portfolio-manager">' +
      '<button type="button" class="star-portfolio-choice selected" data-edit-portfolio-position="' + esc(existing.id) + '" data-star-stock="' + esc(stockKey) + '">' +
        '<span>★</span><strong>' + esc(p.name) + '</strong><small>' + esc(detail) + ' · editar datos</small>' +
      '</button>' +
      '<div class="star-portfolio-manager-actions">' +
        '<button type="button" data-manage-position-transactions="' + esc(existing.id) + '">Operaciones</button>' +
        '<button type="button" class="danger" data-remove-exposure-position="' + esc(existing.id) + '">Eliminar exposición</button>' +
      '</div>' +
    '</div>';
  }).join('');

  openModal(isInPortfolio(stockKey) ? "Gestionar carteras" : "Añadir a cartera",
    '<div class="star-portfolio-menu">' +
      '<div class="star-stock-summary"><strong>' + esc((preferTr && stock.trTicker) || stock.ticker || "") + '</strong><span>' + esc(stock.name || "") + '</span></div>' +
      (rows || '<div class="portfolio-empty-state compact">Todavía no tienes carteras.</div>') +
      '<button type="button" class="btn star-create-portfolio" data-star-create-stock="' + esc(stockKey) + '" data-star-prefer-tr="' + (preferTr === true ? '1' : preferTr === false ? '0' : '') + '">＋ Crear nueva cartera</button>' +
    '</div>'
  );
}

function openAddToSpecificPortfolio(stockKey, portfolioId, preferTr) {
  state.selectedPortfolioId = portfolioId || state.selectedPortfolioId;
  closeModal();
  setTimeout(() => openAddPositionModal(stockKey, preferTr), 30);
}

async function syncFavorite(active, key) {
  if (!state.user || !key) return;
  try {
    const existing = state.watchlist.find(x => sameStockRef(x.stock_key, key));
    if (active) {
      if (existing) return;
      const stock = stockByKey(key);
      if (!stock) return;
      const preferTr = !!(stock.tradeRepublicVerified || stock.tradeRepublicCandidate);
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
    renderApp();
  } catch (error) {
    console.warn("Favorite sync failed", error);
    toast("Favorito guardado localmente; sincronización pendiente.", true);
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

    await addPosition(payload);

    setStatus("Posición guardada");
    closeModal();
    toast("Posición guardada · análisis continuo activado");

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
    const primaryTab=event.target.closest?.("[data-portfolio-primary]");
    if(primaryTab){
      const next=primaryTab.dataset.portfolioPrimary==="goal"?"goal":"portfolio";
      if(state.primaryTab!==next){
        state.primaryTab=next;
        savePortfolioUi();
        state.goalCandidateCache={at:0,key:"",rows:[]};
        renderApp();
        if(next==="goal"){
          refreshGoalSummaries().catch(()=>{});
          setTimeout(()=>refreshGoalAnalysis(false).catch(()=>{}),40);
        }
      }
      return;
    }
    const marketConfig=event.target.closest?.("[data-portfolio-market-config]");
    if(marketConfig){openPortfolioMarketModal(marketConfig.dataset.portfolioMarketConfig);return}
    const goalRefresh=event.target.closest?.("[data-goal-refresh-plan]");
    if(goalRefresh){
      goalRefresh.disabled=true;const old=goalRefresh.textContent;goalRefresh.textContent="Analizando…";state.goalCandidateCache={at:0,key:"",rows:[]};
      try{
        const done=await refreshGoalAnalysis(true);
        toast(done?"Cartera reanalizada · "+done+" posiciones":"No había posiciones que analizar");
      }catch(error){toast(error.message||"No se pudo reanalizar la cartera.",true)}
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


    const editPosition = event.target.closest?.("[data-edit-portfolio-position]");
    if (editPosition) {
      event.preventDefault();
      event.stopPropagation();
      const position = transactionPosition(editPosition.dataset.editPortfolioPosition);
      if (position) {
        closeModal();
        setTimeout(() => openAddPositionModal(position.stock_key, Number(position.prefer_tr) === 1, position.portfolio_id), 20);
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
    if (row && !event.target.closest("button")) {
      const pref = row.dataset.positionPreferTr;
      openStockInline(row.dataset.openStock, pref === "1" ? true : pref === "0" ? false : null);
      return;
    }
  });

  document.addEventListener("submit", async event => {
    if(event.target.id==="portfolioGoalForm"){
      event.preventDefault();const form=event.target,fd=new FormData(form),target=num(fd.get("targetValueEur")),portfolioId=form.dataset.portfolioId||state.selectedPortfolioId,status=form.querySelector("[data-goal-form-status]");
      const setGoalStatus=(message,error=false)=>{if(status){status.textContent=message||"";status.classList.toggle("error",!!error)}};
      if(target===null||target<=0){setGoalStatus("Indica una cantidad mayor que 0 €.",true);toast("Indica un objetivo de rentabilidad mayor que 0 €.",true);return}
      const button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;setGoalStatus("Guardando…");
      try{
        await savePortfolioGoal(target,portfolioId);setGoalStatus("Objetivo guardado");toast("Objetivo de la cartera actualizado");
        setTimeout(()=>refreshGoalAnalysis(false).catch(()=>{}),40);
      }catch(error){
        const message=error.message||"No se pudo guardar el objetivo.";state.goalError=message;setGoalStatus(message,true);toast(message,true);renderApp();
      }finally{if(button&&button.isConnected)button.disabled=false}
      return;
    }
    if(event.target.id==="portfolioMarketForm"){
      event.preventDefault();
      try{await savePortfolioMarket(event.target)}catch(error){toast(error.message||"No se pudo guardar el mercado.",true)}
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
          baseCurrency: String(fd.get("baseCurrency") || "EUR")
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
      openStockInline(row.dataset.openStock, pref === "1" ? true : pref === "0" ? false : null);
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
      renderApp();
    } else {
      loadAll();
    }
  });

  window.addEventListener("viewinvai:account-ready", event => {
    const detail = event.detail || {};
    state.user = detail.user || window.ViewInvAIAuth?.getUser() || state.user;
    if (state.user) loadAll();
  });

  window.addEventListener("viewinvai:favorite-changed", () => {
    syncPortfolioStars();
  });

  window.addEventListener("viewinvai:quote-updated", event => {
    if (!event.detail || !state.positions.some(p => sameStockRef(p.stock_key, event.detail.key))) return;
    state.goalCandidateCache={at:0,key:"",rows:[]};
    clearTimeout(renderApp.quoteTimer);
    renderApp.quoteTimer = setTimeout(renderApp, 180);
  });
  window.addEventListener("viewinvai:fx-updated", () => {
    state.goalCandidateCache={at:0,key:"",rows:[]};
    clearTimeout(renderApp.quoteTimer);
    renderApp.quoteTimer = setTimeout(renderApp, 180);
  });
}

function init() {
  bind();
  state.user = window.ViewInvAIAuth?.getUser() || null;
  renderApp();
  if (state.user) loadAll();
}

window.ViewInvAIPortfolios = {
  render: renderApp,
  reload: () => loadAll(),
  openNewPortfolio: openNewPortfolioModal,
  openAddPosition: openAddPositionModal,
  openPositionPicker,
  openStarMenu,
  isInPortfolio,
  getPortfolioMemberships: stockKey => activePortfolioMemberships(stockKey).map(x => ({
    positionId: x.position.id,
    portfolioId: x.position.portfolio_id,
    portfolioName: x.portfolio?.name || ''
  })),
  removeStockFromPortfolio,
  setGoalVisible: visible => {
    state.primaryTab = visible ? "goal" : "portfolio";
    savePortfolioUi();
    renderApp();
  },
  getState: () => state
};

init();
