const state = {
  user: null,
  portfolios: [],
  positions: [],
  watchlist: [],
  selectedPortfolioId: null,
  loading: false,
  syncingFavorites: false
};

const $ = selector => document.querySelector(selector);

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

function localFavoriteKeys() {
  return window.ViewInvAI && typeof window.ViewInvAI.getFavoriteKeys === "function"
    ? window.ViewInvAI.getFavoriteKeys()
    : [];
}

function mergeFavoriteKeys(keys) {
  if (window.ViewInvAI && typeof window.ViewInvAI.mergeFavoriteKeys === "function") {
    window.ViewInvAI.mergeFavoriteKeys(keys);
  }
}

function openStock(key, reason = "Cartera") {
  if (window.ViewInvAI && typeof window.ViewInvAI.openStockByKey === "function") {
    return window.ViewInvAI.openStockByKey(key, reason, null);
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

function currentMarket(stock) {
  if (!stock) return { price: null, change: null, currency: "USD" };
  const preferTr = !!(stock.tradeRepublicVerified || stock.tradeRepublicCandidate);
  if (preferTr && num(stock.trLivePrice) !== null) {
    return { price: num(stock.trLivePrice), change: num(stock.trLiveChangePct), currency: "EUR" };
  }
  return {
    price: num(stock.usLivePrice) ?? num(stock.price),
    change: num(stock.usLiveChangePct) ?? num(stock.changePct),
    currency: stock.currency || "USD"
  };
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
  return '<button type="button" class="portfolio-card' + (selected ? ' active' : '') + '" data-portfolio-select="' + esc(p.id) + '">' +
    '<span class="portfolio-card-icon">▣</span>' +
    '<span class="portfolio-card-copy"><strong>' + esc(p.name) + '</strong><small>' + esc(p.broker || "Sin bróker") + '</small></span>' +
    '<span class="portfolio-card-count">' + count + '</span>' +
  '</button>';
}

function renderPositionRow(p) {
  const stock = stockByKey(p.stock_key);
  const market = currentMarket(stock);
  const qty = num(p.quantity);
  const avg = num(p.avg_price);
  const currentValue = qty !== null && market.price !== null ? qty * market.price : null;
  const pnlPct = avg !== null && avg > 0 && market.price !== null ? (market.price / avg - 1) * 100 : null;
  return '<article class="portfolio-position" data-open-stock="' + esc(p.stock_key) + '">' +
    '<div class="portfolio-position-main">' +
      '<div class="portfolio-position-id"><strong>' + esc(p.ticker || "—") + '</strong><span>' + esc(p.name || (stock && stock.name) || "") + '</span></div>' +
      '<div class="portfolio-position-quote"><strong>' + formatMoney(market.price, market.currency) + '</strong>' + changeHtml(market.change) + '</div>' +
    '</div>' +
    '<div class="portfolio-position-meta">' +
      '<span>' + (qty === null ? "Cantidad —" : formatNumber(qty, 4) + " uds.") + '</span>' +
      '<span>Media ' + formatMoney(avg, p.currency || "EUR") + '</span>' +
      '<span>Valor ' + formatMoney(currentValue, market.currency) + '</span>' +
      (pnlPct === null ? '' : '<span class="' + (pnlPct >= 0 ? 'pnl-up' : 'pnl-down') + '">' + (pnlPct >= 0 ? '+' : '') + formatNumber(pnlPct, 2) + '% desde entrada</span>') +
    '</div>' +
    '<div class="portfolio-position-ai">' +
      analysisBadge(p) +
      '<button type="button" class="portfolio-analyze" data-analyze-type="position" data-analyze-id="' + esc(p.id) + '">Analizar IA</button>' +
    '</div>' +
  '</article>';
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

  if (!state.selectedPortfolioId && state.portfolios.length) state.selectedPortfolioId = state.portfolios[0].id;
  if (state.selectedPortfolioId && !state.portfolios.some(p => p.id === state.selectedPortfolioId)) {
    state.selectedPortfolioId = state.portfolios[0] ? state.portfolios[0].id : null;
  }

  const selected = state.portfolios.find(p => p.id === state.selectedPortfolioId) || null;
  const positions = selected ? portfolioPositions(selected.id) : [];

  box.innerHTML =
    '<div class="portfolio-account-strip"><div><strong>' + esc(state.user.displayName || state.user.email || "Mi cuenta") + '</strong><span>' + state.portfolios.length + ' carteras · ' + state.positions.filter(p => Number(p.active) !== 0).length + ' posiciones · ' + state.watchlist.length + ' seguidas</span></div><button type="button" class="portfolio-refresh" aria-label="Actualizar">↻</button></div>' +
    '<div class="portfolio-selector">' +
      state.portfolios.map(renderPortfolioCard).join('') +
      '<button type="button" class="portfolio-card add" data-new-portfolio="1"><span>＋</span><strong>Nueva cartera</strong></button>' +
    '</div>' +
    (selected
      ? '<section class="portfolio-block"><div class="portfolio-block-head"><div><h2>' + esc(selected.name) + '</h2><span>' + esc(selected.broker || "") + '</span></div><button type="button" class="btn small portfolio-add-current">＋ Añadir posición</button></div>' +
        '<div class="portfolio-position-list">' + (positions.length ? positions.map(renderPositionRow).join('') : '<div class="portfolio-empty-state compact">Esta cartera todavía no tiene posiciones. Abre una acción y pulsa “Añadir a cartera”.</div>') + '</div></section>'
      : '<div class="portfolio-empty-state"><h2>Crea tu primera cartera</h2><p>Por ejemplo: Trade Republic, IBKR, Trade activo o Largo plazo.</p><button type="button" class="btn" data-new-portfolio="1">＋ Crear cartera</button></div>') +
    '<section class="portfolio-block watchlist-block"><div class="portfolio-block-head"><div><h2>Seguimiento IA</h2><span>Favoritos sincronizados</span></div><span class="portfolio-count-pill">' + state.watchlist.length + '</span></div>' +
      '<div class="portfolio-watch-list">' + (state.watchlist.length ? state.watchlist.map(renderWatchRow).join('') : '<div class="portfolio-empty-state compact">Marca una acción con ★ para añadirla al seguimiento continuo.</div>') + '</div>' +
    '</section>';
}

async function fetchJson(path) {
  const response = await api(path);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Error de backend");
  return data;
}

async function loadAll({ syncFavorites = true } = {}) {
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
    if (syncFavorites) await syncLocalFavorites();
    mergeFavoriteKeys(state.watchlist.map(x => x.stock_key));
  } catch (error) {
    console.warn("Portfolio loading failed", error);
    toast(error.message || "No se pudieron cargar las carteras.", true);
  } finally {
    state.loading = false;
    renderApp();
  }
}

async function createPortfolio(payload) {
  const response = await api("/api/portfolios", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "No se pudo crear la cartera.");
  state.selectedPortfolioId = data.portfolio && data.portfolio.id || state.selectedPortfolioId;
  await loadAll({ syncFavorites: false });
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
    await loadAll({ syncFavorites: false });
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
  const preferTr = !!(stock && (stock.tradeRepublicVerified || stock.tradeRepublicCandidate));
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

function openAddPositionModal(stockKey) {
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
  const preferTr = !!(stock.tradeRepublicVerified || stock.tradeRepublicCandidate);
  const current = currentMarket(stock);
  const options = state.portfolios.map(p => '<option value="' + esc(p.id) + '"' + (p.id === state.selectedPortfolioId ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
  openModal("Añadir " + (stock.trTicker || stock.ticker || "acción"),
    '<form id="addPositionForm" class="portfolio-form" data-stock-key="' + esc(stockKey) + '">' +
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

async function syncLocalFavorites() {
  if (state.syncingFavorites || !state.user) return;
  state.syncingFavorites = true;
  try {
    const remote = new Set(state.watchlist.map(x => x.stock_key));
    for (const key of localFavoriteKeys()) {
      if (remote.has(key)) continue;
      const stock = stockByKey(key);
      if (!stock) continue;
      await syncFavorite(true, key);
      remote.add(key);
    }
  } finally {
    state.syncingFavorites = false;
  }
}

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
    setTimeout(() => loadAll({ syncFavorites: false }), 0);
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

    const selector = event.target.closest?.("[data-portfolio-select]");
    if (selector) {
      state.selectedPortfolioId = selector.dataset.portfolioSelect;
      renderApp();
      return;
    }

    if (event.target.closest?.(".portfolio-refresh")) {
      loadAll({ syncFavorites: true });
      return;
    }

    const add = event.target.closest?.("[data-add-portfolio-stock]");
    if (add) {
      event.preventDefault();
      event.stopPropagation();
      openAddPositionModal(add.dataset.addPortfolioStock);
      return;
    }

    if (event.target.closest?.(".portfolio-add-current")) {
      const currentKey = window.ViewInvAI && window.ViewInvAI.getCurrentStockKey ? window.ViewInvAI.getCurrentStockKey() : null;
      if (currentKey) openAddPositionModal(currentKey);
      else toast("Abre una acción y pulsa “Añadir a cartera”.");
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
      openStock(row.dataset.openStock, "Carteras · seguimiento IA");
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
        await createPortfolio({
          name: String(fd.get("name") || ""),
          broker: String(fd.get("broker") || ""),
          baseCurrency: String(fd.get("baseCurrency") || "EUR")
        });
        closeModal();
        toast("Cartera creada");
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

  $("#portfolioModalClose")?.addEventListener("click", closeModal);
  $("#portfolioModalBackdrop")?.addEventListener("click", closeModal);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeModal();
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
      loadAll({ syncFavorites: true });
    }
  });

  window.addEventListener("viewinvai:account-ready", event => {
    const detail = event.detail || {};
    state.user = detail.user || window.ViewInvAIAuth?.getUser() || state.user;
    if (state.user) loadAll({ syncFavorites: true });
  });

  window.addEventListener("viewinvai:favorite-changed", event => {
    const detail = event.detail || {};
    syncFavorite(!!detail.active, detail.key);
  });
}

function init() {
  bind();
  state.user = window.ViewInvAIAuth?.getUser() || null;
  renderApp();
  if (state.user) loadAll({ syncFavorites: true });
}

window.ViewInvAIPortfolios = {
  render: renderApp,
  reload: () => loadAll({ syncFavorites: true }),
  openNewPortfolio: openNewPortfolioModal,
  openAddPosition: openAddPositionModal,
  getState: () => state
};

init();
