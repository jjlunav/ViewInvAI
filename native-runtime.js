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
    if (raw.startsWith('/data/')) return raw.slice(1);
    if (/^data\/market(?:-version)?\.json(?:[?#].*)?$/i.test(raw)) return raw;
    return raw;
  };

  const websocketUrl = path => {
    const raw = String(path || '');
    if (!localNativeOrigin) {
      if (/^wss?:\/\//i.test(raw)) return raw;
      return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + (raw.startsWith('/') ? raw : '/' + raw);
    }
    if (/^wss?:\/\//i.test(raw)) return raw;
    return 'wss://viewinvai.sonarlab.workers.dev' + (raw.startsWith('/') ? raw : '/' + raw);
  };

  window.ViewInvAIRuntime = Object.freeze({
    isPackagedNative: localNativeOrigin,
    backendOrigin: BACKEND_ORIGIN,
    url: absoluteRemoteUrl,
    websocketUrl
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