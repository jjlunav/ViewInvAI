const state = {
  user: null,
  portfolios: [],
  positions: [],
  watchlist: [],
  selectedPortfolioId: null,
  detailStockKey: null,
  detailPreferTr: null,
  loading: false
};

const PORTFOLIO_UI_KEY = "viewinvai:portfolioUi:v2";
try {
  const saved = JSON.parse(localStorage.getItem(PORTFOLIO_UI_KEY) || "{}");
  state.selectedPortfolioId = saved && saved.selectedPortfolioId || null;
  state.detailStockKey = saved && saved.detailStockKey || null;
  state.detailPreferTr = saved && saved.detailPreferTr === true ? true : saved && saved.detailPreferTr === false ? false : null;
} catch (_) {}

const $ = selector => document.querySelector(selector);

function savePortfolioUi() {
  try {
    localStorage.setItem(PORTFOLIO_UI_KEY, JSON.stringify({
      selectedPortfolioId: state.selectedPortfolioId || null,
      detailStockKey: state.detailStockKey || null,
      detailPreferTr: state.detailPreferTr
    }));
  } catch (_) {}
}

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function num(value) {
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

function portfolioStockKeys() {
  return [...new Set(state.positions.filter(p => Number(p.active) !== 0).map(p => p.stock_key).filter(Boolean))];
}

function syncPortfolioStars() {
  if (window.ViewInvAI && typeof window.ViewInvAI.replaceFavoriteKeys === "function") {
    window.ViewInvAI.replaceFavoriteKeys(portfolioStockKeys());
  }
}

function openStockInline(key, preferTr = null) {
  if (!key) return false;
  state.detailStockKey = key;
  state.detailPreferTr = preferTr === true ? true : preferTr === false ? false : null;
  savePortfolioUi();
  renderApp();
  return true;
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
  if (window.ViewInvAI && typeof window.ViewInvAI.getCanonicalQuote === "function") {
    const quote = window.ViewInvAI.getCanonicalQuote(stock, !!preferTr) || {};
    return {
      price: num(quote.price),
      change: num(quote.change),
      currency: quote.nativeCurrency || (preferTr ? "EUR" : "USD"),
      eur: num(quote.eur),
      usd: num(quote.usd),
      source: quote.source || "",
      updatedAt: quote.updatedAt || null,
      live: quote.live === true
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
  return state.positions.filter(p => p.portfolio_id === portfolioId && Number(p.active) !== 0);
}

function portfolioSummaryHtml(portfolio, positions) {
  if (!portfolio || !positions.length) return "";
  const baseCurrency = String(portfolio.base_currency || "EUR").toUpperCase();
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
  const pnl = currentComplete && costComplete ? currentValue - invested : null;
  const pnlPct = pnl !== null && invested > 0 ? pnl / invested * 100 : null;
  return '<div class="portfolio-summary-bar">' +
    '<div><small>CARTERA</small><strong>' + esc(portfolio.name) + '</strong></div>' +
    '<div><small>VALOR ACTUAL</small><strong>' + (currentComplete ? formatMoney(currentValue, baseCurrency) : '—') + '</strong></div>' +
    (pnl === null ? '' : '<div><small>RESULTADO</small><strong class="' + (pnl >= 0 ? 'pnl-up' : 'pnl-down') + '">' + (pnl >= 0 ? '+' : '') + formatMoney(pnl, baseCurrency) + ' · ' + (pnlPct >= 0 ? '+' : '') + formatNumber(pnlPct, 2) + '%</strong></div>') +
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
  const selected = state.selectedPortfolioId === p.id;
  return '<button type="button" class="portfolio-tab' + (selected ? ' active' : '') + '" data-portfolio-select="' + esc(p.id) + '">' +
    '<strong>' + esc(p.name) + '</strong>' +
    '<span>' + count + '</span>' +
  '</button>';
}

function renderPositionRow(p, index = 0) {
  const stock = stockByKey(p.stock_key);
  if (!stock) return "";
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

  const context =
    '<div class="portfolio-position-context">' +
      '<div class="portfolio-position-numbers">' +
        '<span>' + (qty === null ? "Cantidad —" : formatNumber(qty, 4) + " uds.") + '</span>' +
        '<span>Media <b>' + formatMoney(avg, entryCurrency) + '</b></span>' +
        '<span>Valor <b>' + formatMoney(currentValue, entryCurrency) + '</b></span>' +
        (pnlPct === null ? '' : '<span class="' + (pnlPct >= 0 ? 'pnl-up' : 'pnl-down') + '"><b>' + (pnlPct >= 0 ? '+' : '') + formatNumber(pnlPct, 2) + '%' + (pnlAbs === null ? '' : ' · ' + (pnlAbs >= 0 ? '+' : '') + formatMoney(pnlAbs, entryCurrency)) + '</b> desde entrada</span>') +
      '</div>' +
      '<div class="portfolio-position-actions">' +
        '<span class="portfolio-position-signal">' + esc(signalLabel) + (num(p.last_confidence) === null ? '' : ' · ' + Math.round(num(p.last_confidence)) + '%') + '</span>' +
        '<button type="button" class="portfolio-analyze" data-analyze-type="position" data-analyze-id="' + esc(p.id) + '">Analizar IA</button>' +
      '</div>' +
    '</div>';

  if (window.ViewInvAI && typeof window.ViewInvAI.renderStandardStockCard === "function") {
    return window.ViewInvAI.renderStandardStockCard(stock, {
      index,
      preferTr,
      hint: "Cartera · posición activa",
      insight: "IA · " + signalLabel.toLowerCase(),
      rankLabel: "#" + (index + 1),
      className: "portfolio-investing-card",
      openAttrs: ' data-open-stock="' + esc(p.stock_key) + '" data-position-prefer-tr="' + (preferTr ? '1' : '0') + '" role="button" tabindex="0"',
      contextHtml: context
    });
  }

  return '<article class="portfolio-position" data-open-stock="' + esc(p.stock_key) + '" data-position-prefer-tr="' + (preferTr ? '1' : '0') + '">' +
    '<div class="portfolio-position-main"><div class="portfolio-position-id"><strong>' + esc(p.ticker || "—") + '</strong><span>' + esc(p.name || stock.name || "") + '</span></div>' +
    '<div class="portfolio-position-quote">' + quotePairHtml(stock, preferTr) + changeHtml(market.change) + '</div></div>' + context + '</article>';
}
function renderWatchRow(w) {
  const stock = stockByKey(w.stock_key);
  const market = currentMarket(stock);
  return '<article class="portfolio-watch-row" data-open-stock="' + esc(w.stock_key) + '">' +
    '<div class="portfolio-watch-id"><span class="portfolio-watch-star">★</span><div><strong>' + esc(w.ticker || "—") + '</strong><span>' + esc(w.name || (stock && stock.name) || "") + '</span></div></div>' +
    '<div class="portfolio-watch-quote"><strong>' + formatMoney(market.price, market.currency) + '</strong>' + changeHtml(market.change) + '</div>' +
    analysisBadge(w) +
    '<button type="button" class="portfolio-analyze compact" data-analyze-type="watchlist" data-analyze-id="' + esc(w.id) + '">IA</button>' +
  '</article>';
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
  if (state.selectedPortfolioId && !state.portfolios.some(p => p.id === state.selectedPortfolioId)) {
    state.selectedPortfolioId = state.portfolios[0] ? state.portfolios[0].id : null;
  }

  const selected = state.portfolios.find(p => p.id === state.selectedPortfolioId) || null;
  const positions = selected ? portfolioPositions(selected.id) : [];
  savePortfolioUi();

  box.innerHTML =
    '<div class="portfolio-workbar">' +
      '<div class="portfolio-tabs-wrap">' +
        '<div class="portfolio-tabs-track" id="portfolioTabsTrack" role="tablist" aria-label="Mis carteras">' +
          state.portfolios.map(renderPortfolioCard).join('') +
        '</div>' +
        '<button type="button" class="portfolio-tab portfolio-tab-add" data-new-portfolio="1" aria-label="Nueva cartera" title="Nueva cartera">＋</button>' +
        '<button type="button" class="portfolio-tabs-more" data-portfolio-tabs-more aria-label="Mostrar carteras ocultas" title="Más carteras" hidden>›</button>' +
        '<button type="button" class="portfolio-tabs-edit" data-portfolio-order-edit aria-label="Editar orden de carteras" title="Editar orden">✎</button>' +
        '<div class="portfolio-tabs-overflow" id="portfolioTabsOverflow" aria-hidden="true"></div>' +
      '</div>' +
      '<button type="button" class="btn small portfolio-add-current"' + (selected ? '' : ' disabled') + '>＋ Añadir posición</button>' +
      '<button type="button" class="portfolio-refresh compact" aria-label="Actualizar carteras" title="Actualizar">↻</button>' +
    '</div>' +
    '<div id="portfolioContext" class="portfolio-context">' +
      (selected
        ? portfolioSummaryHtml(selected, positions) + '<section class="portfolio-block integrated portfolio-positions-only">' +
            '<div class="portfolio-position-list stock-list portfolio-card-grid">' + (positions.length ? positions.map(renderPositionRow).join('') : '<div class="portfolio-empty-state compact">Esta cartera todavía no tiene posiciones. Pulsa “Añadir posición” para empezar.</div>') + '</div>' +
          '</section>'
        : '<div class="portfolio-empty-state"><h2>Crea tu primera cartera</h2><button type="button" class="btn" data-new-portfolio="1">＋ Crear cartera</button></div>') +
    '</div>';

  if (state.detailStockKey) {
    const context = $("#portfolioContext");
    const p = state.positions.find(x => x.stock_key === state.detailStockKey && Number(x.active) !== 0 && (!selected || x.portfolio_id === selected.id));
    const preferTr = p ? Number(p.prefer_tr) === 1 : state.detailPreferTr === true;
    if (context && window.ViewInvAI && typeof window.ViewInvAI.renderEmbeddedStockDetail === "function") {
      context.innerHTML = '<div id="portfolioInlineStock" class="portfolio-inline-stock"></div>';
      window.ViewInvAI.renderEmbeddedStockDetail($("#portfolioInlineStock"), state.detailStockKey, "Cartera · " + (selected ? selected.name : "posición"), preferTr);
    }
  }

  requestAnimationFrame(updatePortfolioTabOverflow);
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
  } catch (error) {
    console.warn("Portfolio loading failed", error);
    toast(error.message || "No se pudieron cargar las carteras.", true);
  } finally {
    state.loading = false;
    renderApp();
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

function openAddPositionModal(stockKey, preferTrOverride = null) {
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
  const preferTr = preferTrOverride === true ? true : preferTrOverride === false ? false : !!(stock.tradeRepublicTradable || stock.tradeRepublicVerified);
  const current = currentMarket(stock, preferTr);
  const options = state.portfolios.map(p => '<option value="' + esc(p.id) + '"' + (p.id === state.selectedPortfolioId ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
  openModal("Añadir " + (stock.trTicker || stock.ticker || "acción"),
    '<form id="addPositionForm" class="portfolio-form" data-stock-key="' + esc(stockKey) + '" data-prefer-tr="' + (preferTr ? '1' : '0') + '">' +
      '<div class="position-form-stock"><strong>' + esc(stock.trTicker || stock.ticker || "") + '</strong><span>' + esc(stock.name || "") + '</span><b>' + formatMoney(current.price, current.currency) + '</b></div>' +
      '<label><span>Cartera</span><select name="portfolioId" required>' + options + '</select></label>' +
      '<div class="portfolio-form-grid"><label><span>Cantidad</span><input name="quantity" type="number" inputmode="decimal" step="any" min="0" placeholder="0"></label>' +
      '<label><span>Precio medio</span><input name="avgPrice" type="number" inputmode="decimal" step="any" min="0" placeholder="' + esc(current.price || "") + '"></label></div>' +
      '<div class="portfolio-form-grid"><label><span>Divisa</span><select name="currency"><option' + (preferTr ? ' selected' : '') + '>EUR</option><option' + (!preferTr ? ' selected' : '') + '>USD</option><option>GBP</option></select></label>' +
      '<label><span>Fecha de entrada</span><span class="portfolio-date-field"><input id="openedAtInput" name="openedAt" type="date" value="' + localDateValue() + '" required><button type="button" class="portfolio-date-picker" data-open-date-picker aria-label="Abrir calendario">📅</button></span></label></div>' +
      '<label><span>Nota</span><textarea name="notes" rows="2" maxlength="1000" placeholder="Opcional"></textarea></label>' +
      '<div class="portfolio-form-status" data-position-status aria-live="polite"></div>' +
      '<button type="button" class="btn" data-save-position>Guardar posición</button>' +
    '</form>'
  );

  // Bind directly to the button created inside the dynamic modal. This avoids
  // relying on delegated form-submit behaviour in Android System WebView.
  const form = $("#addPositionForm");
  const saveButton = form?.querySelector("[data-save-position]");
  if (form && saveButton) {
    saveButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      savePositionForm(form);
    });
  }
}


function openStarMenu(stockKey, preferTr = null) {
  if (!state.user) return window.ViewInvAIAuth?.signIn?.();
  const stock = stockByKey(stockKey);
  if (!stock) return;
  const memberships = new Set(state.positions.filter(p => p.stock_key === stockKey && Number(p.active) !== 0).map(p => p.portfolio_id));
  const rows = state.portfolios.map(p =>
    '<button type="button" class="star-portfolio-choice' + (memberships.has(p.id) ? ' selected' : '') + '" data-star-add-portfolio="' + esc(p.id) + '" data-star-stock="' + esc(stockKey) + '" data-star-prefer-tr="' + (preferTr === true ? '1' : preferTr === false ? '0' : '') + '">' +
      '<span>★</span><strong>' + esc(p.name) + '</strong><small>' + (memberships.has(p.id) ? 'Ya está en esta cartera' : 'Añadir a esta cartera') + '</small>' +
    '</button>'
  ).join('');
  openModal("Añadir a cartera",
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
    const existing = state.watchlist.find(x => x.stock_key === key);
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
  document.addEventListener("click", event => {
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
      state.detailStockKey = null;
      state.detailPreferTr = null;
      savePortfolioUi();
      closePortfolioTabOverflow();
      renderApp();
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

    if (event.target.closest?.("[data-portfolio-detail-close]")) {
      state.detailStockKey = null;
      state.detailPreferTr = null;
      savePortfolioUi();
      renderApp();
      return;
    }

    const starChoice = event.target.closest?.("[data-star-add-portfolio]");
    if (starChoice) {
      if (starChoice.classList.contains("selected")) {
        closeModal();
        toast("La acción ya está en esa cartera.");
        return;
      }
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
      openAddPositionModal(add.dataset.addPortfolioStock, pref === "1" ? true : pref === "0" ? false : null);
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
    if (row && (event.key === "Enter" || event.key === " ")) {
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
    if (!event.detail || !state.positions.some(p => p.stock_key === event.detail.key)) return;
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
  getState: () => state
};

init();
