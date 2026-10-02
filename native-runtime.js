(() => {
  'use strict';

  const BACKEND_ORIGIN = 'https://viewinvai.sonarlab.workers.dev';
  const localNativeOrigin = (() => {
    const origin = String(location.origin || '').toLowerCase();
    if (['https://localhost','http://localhost','capacitor://localhost','ionic://localhost'].includes(origin)) return true;
    try {
      return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
    } catch (_) {
      return false;
    }
  })();

  const absoluteRemoteUrl = value => {
    const raw = String(value || '');
    if (!localNativeOrigin) return raw;
    if (/^https?:\/\//i.test(raw) || /^wss?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/api/')) return BACKEND_ORIGIN + raw;
    if (/^\/data\/(?:funds|market|market-version)\.json(?:[?#].*)?$/i.test(raw)) return BACKEND_ORIGIN + raw;
    if (raw.startsWith('/data/')) return raw.slice(1);
    if (/^data\/(?:funds|market|market-version)\.json(?:[?#].*)?$/i.test(raw)) return BACKEND_ORIGIN + '/' + raw;
    return raw;
  };

  const websocketUrl = path => {
    const raw = String(path || '');
    if (/^wss?:\/\//i.test(raw)) return raw;
    // WebSocket market feeds always terminate at the Worker. Static web hosting
    // may serve HTTP /api routes, but cannot be relied on to proxy WS upgrades.
    if (raw.startsWith('/api/')) {
      return 'wss://viewinvai.sonarlab.workers.dev' + raw;
    }
    if (!localNativeOrigin) {
      return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + (raw.startsWith('/') ? raw : '/' + raw);
    }
    return 'wss://viewinvai.sonarlab.workers.dev' + (raw.startsWith('/') ? raw : '/' + raw);
  };

  // La APK no lleva catálogos dentro: guarda en el móvil la última copia descargada del
  // servidor y solo la usa si al abrir no hay conexión.
  const OFFLINE_CACHE = 'viewinvai-data-v1';
  const saveOffline = async (name, response) => {
    try {
      if (!localNativeOrigin || !('caches' in window) || !response) return false;
      const cache = await caches.open(OFFLINE_CACHE);
      await cache.put('/offline/' + name, response);
      return true;
    } catch (_) { return false; }
  };
  const loadOffline = async name => {
    try {
      if (!('caches' in window)) return null;
      const cache = await caches.open(OFFLINE_CACHE);
      return (await cache.match('/offline/' + name)) || null;
    } catch (_) { return null; }
  };

  window.ViewInvAIRuntime = Object.freeze({
    isPackagedNative: localNativeOrigin,
    backendOrigin: BACKEND_ORIGIN,
    url: absoluteRemoteUrl,
    websocketUrl,
    saveOffline,
    loadOffline
  });

  if (!localNativeOrigin) return;

  window.__VIEWINVAI_NATIVE__ = true;
  document.documentElement.dataset.nativeApp = '1';
  document.documentElement.classList.add('native-app');

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    try {
      if (typeof input === 'string' || input instanceof URL) {
        input = absoluteRemoteUrl(input);
      } else if (input instanceof Request) {
        const nextUrl = absoluteRemoteUrl(input.url);
        if (nextUrl !== input.url) input = new Request(nextUrl, input);
      }
    } catch (_) {}
    return originalFetch(input, init);
  };
})();