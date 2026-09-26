(() => {
  'use strict';

  const root = document.documentElement;
  const params = new URLSearchParams(location.search);
  const queryNative = params.get('native') === '1';
  const capacitorNative = !!(
    window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === 'function' &&
    window.Capacitor.isNativePlatform()
  );

  if (!queryNative && !capacitorNative && root.dataset.nativeApp !== '1') return;

  root.dataset.nativeApp = '1';
  root.classList.add('native-app');

  let bodyObserver = null;
  let navObserver = null;
  let chromeObserver = null;
  let observedChrome = null;
  let resizeFrame = 0;

  function px(value) {
    return Math.max(0, Math.round(Number(value) || 0)) + 'px';
  }

  function bottomNav() {
    return document.getElementById('mobileBottomNav');
  }

  function stockChrome() {
    return document.querySelector(
      'body.stock-detail-open #stockQuickDetail:not(.is-hidden) > .profile-sticky-shell'
    );
  }

  function observeStockChrome() {
    const chrome = stockChrome();
    if (chrome === observedChrome) return;
    if (chromeObserver) chromeObserver.disconnect();
    observedChrome = chrome || null;
    if (!chrome || typeof ResizeObserver !== 'function') return;
    chromeObserver = new ResizeObserver(() => requestMetricSync());
    chromeObserver.observe(chrome);
  }

  function syncViewportMetrics() {
    resizeFrame = 0;
    root.style.setProperty('--native-vh', px(window.innerHeight));
    root.style.setProperty('--native-vw', px(window.innerWidth));

    const nav = bottomNav();
    if (nav) {
      const rect = nav.getBoundingClientRect();
      if (rect.height > 20) root.style.setProperty('--native-nav-h', px(rect.height));
    }

    const chrome = stockChrome();
    const chromeRect = chrome && chrome.getBoundingClientRect();
    root.style.setProperty(
      '--native-stock-chrome-h',
      chromeRect && chromeRect.height > 20 ? px(chromeRect.height) : '0px'
    );
  }

  function requestMetricSync() {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(syncViewportMetrics);
  }

  function syncActiveView() {
    const active = document.querySelector('.view.active');
    const view = active && active.id ? active.id.replace(/^view-/, '') : '';
    if (view) document.body.dataset.nativeView = view;
    else delete document.body.dataset.nativeView;

    document.body.classList.toggle(
      'native-stock-open',
      document.body.classList.contains('stock-detail-open')
    );

    observeStockChrome();
    requestMetricSync();
  }

  function syncLayout() {
    observeStockChrome();
    requestMetricSync();
  }

  function observeNavigation() {
    if (navObserver) navObserver.disconnect();
    const nav = bottomNav();
    if (!nav || typeof ResizeObserver !== 'function') return;

    navObserver = new ResizeObserver(() => requestMetricSync());
    navObserver.observe(nav);
  }

  function keepFocusedFieldVisible(event) {
    const target = event.target;
    if (!target || !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

    setTimeout(() => {
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }, 120);
  }

  function init() {
    document.body.classList.add('native-app-body');

    bodyObserver = new MutationObserver(syncActiveView);
    bodyObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: false
    });

    document.querySelectorAll('.view').forEach(view => {
      bodyObserver.observe(view, {
        attributes: true,
        attributeFilter: ['class']
      });
    });

    document.addEventListener('focusin', keepFocusedFieldVisible, { passive: true });
    window.addEventListener('resize', requestMetricSync, { passive: true });
    window.addEventListener('orientationchange', requestMetricSync, { passive: true });
    window.visualViewport?.addEventListener('resize', requestMetricSync, { passive: true });

    observeNavigation();
    syncActiveView();
    syncLayout();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.ViewInvAINativeUI = Object.freeze({
    isNative: true,
    syncLayout
  });
})();
