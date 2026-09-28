const state = {
  user: null,
  portfolios: [],
  positions: [],
  watchlist: [],
  portfolioTransactionSummaries: {},
  selectedPortfolioId: null,
  loading: false
};

const PORTFOLIO_UI_KEY = "viewinvai:portfolioUi:v2";
try {
  const saved = JSON.parse(localStorage.getItem(PORTFOLIO_UI_KEY) || "{}");
  state.selectedPortfolioId = saved && saved.selectedPortfolioId || null;
} catch (_) {}

const $ = selector => document.querySelector(selector);

function savePortfolioUi() {
  try {
    localStorage.setItem(PORTFOLIO_UI_KEY, JSON.stringify({
      selectedPortfolioId: state.selectedPortfolioId || null
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
    const quote = (typeof window.ViewInvAI.getDisplayQuote === "function"
      ? window.ViewInvAI.getDisplayQuote(stock, !!preferTr)
      : window.ViewInvAI.getCanonicalQuote(stock, !!preferTr)) || {};
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

  const meta =
    '<div class="portfolio-position-strip">' +
      '<span>' + (qty === null ? "Cantidad —" : formatNumber(qty, 4) + " uds.") + '</span>' +
      '<span>Media <b>' + formatMoney(avg, entryCurrency) + '</b></span>' +
      '<span>Valor <b>' + formatMoney(currentValue, entryCurrency) + '</b></span>' +
      (market.fallback ? '<span>EEUU ref.</span>' : '') +
      (pnlAbs === null ? '' : '<span class="' + (pnlAbs >= 0 ? 'pnl-up' : 'pnl-down') + '"><b>' + (pnlAbs > 0 ? '+' : '') + formatMoney(pnlAbs, entryCurrency) + '</b></span>') +
      '<button type="button" class="portfolio-meta-action portfolio-analyze" data-analyze-type="position" data-analyze-id="' + esc(p.id) + '">IA</button>' +
      '<button type="button" class="portfolio-meta-action portfolio-transactions-open" data-position-transactions="' + esc(p.id) + '">Operaciones</button>' +
    '</div>';

  return window.ViewInvAI.renderStandardStockCard(stock, {
    index, preferTr, context: "portfolio", hint: "Cartera · posición activa", rankLabel: "",
    className: "portfolio-position-card",
    subtitle: [p.ticker || stock.ticker || "", signalLabel].filter(Boolean).join(" · "),
    cells: [
      {label: "Precio", value: formatMoney(currentEntryPrice, entryCurrency), tone: priceTone},
      {label: "P&L", value: pnlPct === null ? "—" : (pnlPct > 0 ? "+" : "") + formatNumber(pnlPct, 2) + "%", tone: pnlTone}
    ],
    openAttrs: ' data-open-stock="' + esc(p.stock_key) + '" data-position-prefer-tr="' + (preferTr ? '1' : '0') + '" role="button" tabindex="0"',
    detailsHtml: "",
    metaHtml: meta
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
  const stock = stockByKey(w.stock_key), market = currentMarket(stock);
  return window.ViewInvAICards.render({
    context: "watchlist", title: w.name || stock?.name || w.ticker, subtitle: w.ticker,
    isin: stock?.isin || stock?.trIsin,
    openAttrs: ' data-open-stock="' + esc(w.stock_key) + '" role="button" tabindex="0"',
    cells: [{label:"Precio",value:formatMoney(market.price,market.currency)},{label:"Variación",html:changeHtml(market.change)}],
    detailsLabel: "Seguimiento IA", detailsHtml: analysisBadge(w),
    actionsHtml:'<button type="button" class="portfolio-analyze compact" data-analyze-type="watchlist" data-analyze-id="' + esc(w.id) + '">IA</button>'
  });
}

function renderApp() {
  const box = $("#portfolioApp");
  if (!box) return;
  if (!state.user) return renderLoggedOut(box);
  if (state.loading) return renderLoading(box);

  state.portfolios.sort((a, b) => {
    const ao = num(a.sort_order) ?? 0, bo = num(b.sort_order) ?? 0;
    return ao - bo || String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });

  if (!state.selectedPortfolioId && state.portfolios.length) state.selectedPortfolioId = state.portfolios[0].id;
  if (state.selectedPortfolioId && !state.portfolios.some(p => String(p.id ?? "") === String(state.selectedPortfolioId ?? ""))) {
    state.selectedPortfolioId = state.portfolios[0] ? state.portfolios[0].id : null;
  }

  const selected = state.portfolios.find(p => String(p.id ?? "") === String(state.selectedPortfolioId ?? "")) || null;
  const positions = selected ? portfolioPositions(selected.id) : [];
  savePortfolioUi();

  box.innerHTML =
    '<div class="portfolio-workbar">' +
      '<div class="portfolio-tabs-wrap">' +
        '<div class="portfolio-tabs-track" id="portfolioTabsTrack" role="tablist" aria-label="Mis carteras">' +
          state.portfolios.map(renderPortfolioCard).join('') +
        '</div>' +
        '<button type="button" class="portfolio-icon-action portfolio-tab-add" data-new-portfolio="1" aria-label="Nueva cartera" title="Nueva cartera">＋</button>' +
        '<button type="button" class="portfolio-tabs-more" data-portfolio-tabs-more aria-label="Mostrar carteras ocultas" title="Más carteras" hidden>›</button>' +
        '<button type="button" class="portfolio-icon-action portfolio-tabs-edit" data-portfolio-order-edit aria-label="Editar carteras" title="Editar carteras">✎</button>' +
        '<button type="button" class="portfolio-icon-action portfolio-history"' + (selected ? ' data-portfolio-history="' + esc(selected.id) + '"' : ' disabled') + ' aria-label="Historial" title="Historial">◷</button>' +
        '<button type="button" class="portfolio-icon-action portfolio-add-current"' + (selected ? '' : ' disabled') + ' aria-label="Añadir posición" title="Añadir posición">⊕</button>' +
        '<div class="portfolio-tabs-overflow" id="portfolioTabsOverflow" aria-hidden="true"></div>' +
      '</div>' +
      '<button type="button" class="portfolio-refresh compact" aria-label="Actualizar carteras" title="Actualizar">↻</button>' +
    '</div>' +
    '<div id="portfolioContext" class="portfolio-context">' +
      portfolioContextHtml(selected, positions) +
    '</div>';

  requestAnimationFrame(() => {
    updatePortfolioTabOverflow();
    if (window.ViewInvAI && typeof window.ViewInvAI.observeLiveQuotes === "function") {
      window.ViewInvAI.observeLiveQuotes(box);
    }
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
  const q = String(query || "").trim().toUpperCase();
  let rows = all.filter(stock => {
    if (!q) return true;
    return [stock.ticker, stock.trTicker, stock.name, stock.isin, stock.trIsin].some(v => String(v || "").toUpperCase().includes(q));
  });
  rows.sort((a, b) => (num(b.marketCap) || 0) - (num(a.marketCap) || 0));
  return rows.slice(0, 35);
}

function portfolioPickerRows(query = "") {
  const rows = portfolioPickerStocks(query);
  if (!rows.length) return '<div class="portfolio-empty-state compact">No se han encontrado acciones.</div>';
  return rows.map(stock => {
    const key = window.ViewInvAI.getStockKey(stock);
    const tr = !!(stock.tradeRepublicTradable || stock.tradeRepublicVerified);
    return '<div class="portfolio-stock-picker-row">' +
      '<div><strong>' + esc(stock.ticker || stock.trTicker || "—") + '</strong><span>' + esc(stock.name || "") + '</span></div>' +
      '<div class="portfolio-stock-picker-markets">' +
        (tr ? '<button type="button" data-position-pick="' + esc(key) + '" data-position-pick-market="tr">TR</button>' : '') +
        '<button type="button" data-position-pick="' + esc(key) + '" data-position-pick-market="us">EEUU</button>' +
      '</div>' +
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
  state.loading = true;
  renderApp();
  try {
    const [portfolios, positions, watchlist] = await Promise.all([
      fetchJson("/api/portfolios"),
      fetchJson("/api/positions"),
      fetchJson("/api/watchlist")
    ]);
    state.portfolios = portfolios.portfolios || [];
    state.positions = positions.positions || [];
    state.watchlist = watchlist.watchlist || [];
    syncPortfolioStars();
    window.dispatchEvent(new CustomEvent('viewinvai:portfolio-membership-changed', {detail:{}}));
  } catch (error) {
    console.warn("Portfolio loading failed", error);
    toast(error.message || "No se pudieron cargar las carteras.", true);
  } finally {
    state.loading = false;
    renderApp();
    const summaryPortfolioId = state.selectedPortfolioId;
    if (summaryPortfolioId) refreshPortfolioTransactionSummary(summaryPortfolioId).catch(() => {});
  }
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
      '<label><span>Divisa base</span><select name="baseCurrency"><option>EUR</option><option>USD</option><option>GBP</option></select></label>' +
      '<button type="submit" class="btn">Crear cartera</button>' +
    '</form>'
  );
  setTimeout(() => $("#newPortfolioForm input[name=name]")?.focus(), 40);
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
  const preferTr = existing ? Number(existing.prefer_tr) === 1 : fallbackPreferTr;
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
  const preferTr = existingInitial
    ? Number(existingInitial.prefer_tr) === 1
    : preferTrOverride === true ? true : preferTrOverride === false ? false : !!(stock.tradeRepublicTradable || stock.tradeRepublicVerified);
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
      loadAll();
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
    clearTimeout(renderApp.quoteTimer);
    renderApp.quoteTimer = setTimeout(renderApp, 180);
  });
  window.addEventListener("viewinvai:fx-updated", () => {
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
  getState: () => state
};

init();
