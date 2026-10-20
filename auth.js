const FIREBASE_CONFIG = Object.freeze({
  apiKey: "AIzaSyAzv3BLvB9XdFEKznndz3jpCzjEWG4UsUw",
  authDomain: "viewinvai.firebaseapp.com",
  projectId: "viewinvai",
  storageBucket: "viewinvai.firebasestorage.app",
  messagingSenderId: "638735053048",
  appId: "1:638735053048:web:aa48c2a397727854820b0d"
});

const FIREBASE_VERSION = "12.19.0";

let webSdkPromise = null;
let webMessagingPromise = null;
let webAuth = null;
let webMessaging = null;
let webServiceWorkerRegistration = null;
let currentUser = null;
let toastTimer = null;
let busy = false;

const $ = selector => document.querySelector(selector);

function isNativePlatform() {
  try {
    if (nativeAuthPlugin()) return true;
    return !!(window.Capacitor && typeof window.Capacitor.getPlatform === "function" && window.Capacitor.getPlatform() !== "web");
  } catch (_) {
    return false;
  }
}

function nativeAuthPlugin() {
  return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FirebaseAuthentication
    ? window.Capacitor.Plugins.FirebaseAuthentication
    : null;
}

let nativeMessagingProxy = null;
function nativeMessagingPlugin() {
  const cap = window.Capacitor;
  if (!cap) return null;
  if (nativeMessagingProxy) return nativeMessagingProxy;
  if (cap.Plugins && cap.Plugins.FirebaseMessaging) {
    nativeMessagingProxy = cap.Plugins.FirebaseMessaging;
    return nativeMessagingProxy;
  }
  if (typeof cap.isPluginAvailable === "function" &&
      typeof cap.registerPlugin === "function" &&
      cap.isPluginAvailable("FirebaseMessaging")) {
    try {
      nativeMessagingProxy = cap.registerPlugin("FirebaseMessaging");
      return nativeMessagingProxy;
    } catch (error) {
      console.warn("FirebaseMessaging bridge registration failed", error);
    }
  }
  return null;
}

let pushListenersBound = false;
let pushLifecycleBound = false;
let lastRegisteredPushToken = "";

async function registerPushToken(token, platform = "android") {
  token = String(token || "").trim();
  if (!token || !currentUser) return false;
  if (token === lastRegisteredPushToken) {
    window.dispatchEvent(new CustomEvent("viewinvai:push-status", { detail: { enabled: true, registered: true } }));
    return true;
  }
  const response = await apiFetch("/api/devices", {
    method: "POST",
    body: JSON.stringify({
      pushToken: token,
      platform: String(platform || "android").toLowerCase(),
      appVersion: document.documentElement.dataset.appVersion || "",
      // Idioma de la app en este dispositivo: el servidor traduce los avisos a este idioma.
      lang: (window.ViewInvAII18n && window.ViewInvAII18n.lang) || document.documentElement.lang || "es"
    })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "No se pudo registrar este dispositivo para avisos.");
  }
  lastRegisteredPushToken = token;
  window.dispatchEvent(new CustomEvent("viewinvai:push-status", { detail: { enabled: true } }));
  return true;
}

function openPushTarget(notification) {
  const data = notification && notification.data || {};
  const route=String(data.route||""),portfolioId=String(data.portfolioId||data.portfolio_id||"");
  if(route==="portfolio-goal"||portfolioId){
    const openGoal=()=>{
      document.querySelector('.nav-item[data-view="portfolios"]')?.click();
      return !!window.ViewInvAIPortfolios?.openGoal?.(portfolioId);
    };
    if(!openGoal())setTimeout(openGoal,900);
    return;
  }
  const stockKey = String(data.stockKey || data.stock_key || "");
  const preferTr = String(data.preferTr || data.prefer_tr || "") === "1" || data.preferTr === true;
  if (!stockKey) return;
  const open = () => window.ViewInvAI && window.ViewInvAI.openStockByKey && window.ViewInvAI.openStockByKey(stockKey, "Aviso push", preferTr);
  if (!open()) setTimeout(open, 900);
}

// Android no pinta en la bandeja del sistema los push que llegan con la app abierta: el plugin
// solo los entrega a la app. Se publican como notificación local en el mismo canal, para que se
// vean igual que con la app cerrada (sonido, bandeja y pantalla de bloqueo).
let localNotificationsProxy = null, localNotificationsBound = false, localNotificationSeq = 0;
function nativeLocalNotifications() {
  const cap = window.Capacitor;
  if (!cap) return null;
  if (localNotificationsProxy) return localNotificationsProxy;
  if (cap.Plugins && cap.Plugins.LocalNotifications) return (localNotificationsProxy = cap.Plugins.LocalNotifications);
  if (typeof cap.isPluginAvailable === "function" && typeof cap.registerPlugin === "function" && cap.isPluginAvailable("LocalNotifications")) {
    try { localNotificationsProxy = cap.registerPlugin("LocalNotifications"); return localNotificationsProxy; }
    catch (error) { console.warn("LocalNotifications bridge registration failed", error); }
  }
  return null;
}
// El toque se escucha desde el arranque: si Android cerró la app, la notificación local sigue en
// la bandeja y al pulsarla la app reabierta debe poder abrir el valor o el Objetivo.
async function bindLocalNotificationTaps() {
  const local = nativeLocalNotifications();
  if (!local || localNotificationsBound || typeof local.addListener !== "function") return;
  localNotificationsBound = true;
  try {
    await local.addListener("localNotificationActionPerformed", event => {
      const extra = event && event.notification && event.notification.extra || {};
      openPushTarget({ data: extra });
    });
  } catch (error) { console.warn("Local notification tap listener failed", error); }
}
async function showForegroundPush(title, body, data) {
  const local = nativeLocalNotifications();
  if (!local || typeof local.schedule !== "function") return false;
  try {
    await bindLocalNotificationTaps();
    localNotificationSeq = (localNotificationSeq + 1) % 100000;
    await local.schedule({ notifications: [{
      id: Math.floor(Date.now() / 1000) % 1000000000 + localNotificationSeq,
      title, body, largeBody: body, channelId: "viewinvai_market_alerts",
      smallIcon: "ic_stat_viewinvai", iconColor: "#43E4B2", extra: data || {}
    }] });
    return true;
  } catch (error) {
    console.warn("Foreground push display failed", error);
    return false;
  }
}

async function bindPushListeners(plugin) {
  if (!plugin || pushListenersBound) return;
  pushListenersBound = true;
  await bindLocalNotificationTaps();
  await plugin.addListener("tokenReceived", event => {
    registerPushToken(event && event.token).catch(error => console.warn("FCM token sync failed", error));
  });
  await plugin.addListener("notificationActionPerformed", event => {
    openPushTarget(event && event.notification);
  });
  await plugin.addListener("notificationReceived", event => {
    const notification = event && event.notification ? event.notification : (event || {});
    const title = String(notification.title || "ViewInvAI");
    const body = String(notification.body || notification.message || "");
    window.dispatchEvent(new CustomEvent("viewinvai:push-received", { detail: event || {} }));
    showForegroundPush(title, body, notification.data || {}).then(shown => {
      if (!shown) showToast(body ? title + " · " + body : title);
    });
  });
}

function bindPushLifecycle(){
  if(pushLifecycleBound)return;
  const app=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.App;
  if(app&&typeof app.addListener==="function"){
    app.addListener("appStateChange",event=>{
      if(event&&event.isActive&&currentUser)ensurePushRegistration(false).catch(error=>console.warn("Push resume sync failed",error));
    });
    pushLifecycleBound=true;
  }
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible"&&currentUser)ensurePushRegistration(false).catch(()=>{});
  });
}
async function loadWebMessagingSdk() {
  if (!webMessagingPromise) {
    webMessagingPromise = Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-messaging.js`)
    ]).then(async ([appSdk, messagingSdk]) => {
      const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(FIREBASE_CONFIG);
      webMessaging = messagingSdk.getMessaging(app);
      if (!webServiceWorkerRegistration) {
        webServiceWorkerRegistration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
      }
      return { messagingSdk, messaging: webMessaging, registration: webServiceWorkerRegistration };
    });
  }
  return webMessagingPromise;
}

async function ensureNativePushRegistration(requestPermission = true) {
  const plugin = nativeMessagingPlugin();
  if (!plugin || !currentUser) return false;
  try {
    const supported = await plugin.isSupported().catch(() => ({ isSupported: true }));
    if (supported && supported.isSupported === false) return false;
    await bindPushListeners(plugin);
    if (typeof plugin.createChannel === "function") {
      try {
        await plugin.createChannel({
          id: "viewinvai_market_alerts",
          name: "Alertas de mercado",
          description: "Cambios relevantes en cartera y señales de ViewInvAI",
          importance: 4,
          vibration: true,
          lights: true
        });
      } catch (error) {
        console.warn("Push channel setup failed", error);
      }
    }
    let permission = await plugin.checkPermissions();
    if ((!permission || permission.receive !== "granted") && requestPermission) permission = await plugin.requestPermissions();
    if (!permission || permission.receive !== "granted") {
      window.dispatchEvent(new CustomEvent("viewinvai:push-status", { detail: { enabled: false, permission: permission && permission.receive || "denied", platform:"android" } }));
      return false;
    }
    const result = await plugin.getToken();
    return registerPushToken(result && result.token, "android");
  } catch (error) {
    console.warn("Push registration unavailable", error);
    const raw=String(error && error.message || error || "");
    const message=/failed to fetch|networkerror|network request failed/i.test(raw)
      ?"No se puede contactar con el servidor push. Reintentando al volver a abrir la app."
      :raw;
    window.dispatchEvent(new CustomEvent("viewinvai:push-status", { detail: { enabled: false, error: message, platform:"android" } }));
    return false;
  }
}

async function ensureWebPushRegistration(requestPermission = true) {
  if (!currentUser || !("serviceWorker" in navigator) || !("Notification" in window)) return false;
  try {
    let permission = Notification.permission;
    if (permission === "default" && requestPermission) permission = await Notification.requestPermission();
    if (permission !== "granted") {
      window.dispatchEvent(new CustomEvent("viewinvai:push-status", { detail: { enabled:false, permission, platform:"web" } }));
      return false;
    }
    const { messagingSdk, messaging, registration } = await loadWebMessagingSdk();
    const token = await messagingSdk.getToken(messaging, { serviceWorkerRegistration: registration });
    if (!token) throw new Error("Firebase no devolvió un token web.");
    if (!ensureWebPushRegistration._listenerBound) {
      ensureWebPushRegistration._listenerBound = true;
      messagingSdk.onMessage(messaging, payload => {
        const notification = payload && payload.notification || {};
        const data = payload && payload.data || {};
        const title = String(notification.title || data.title || "ViewInvAI");
        const body = String(notification.body || data.body || "");
        window.dispatchEvent(new CustomEvent("viewinvai:push-received", { detail: payload || {} }));
        // Con la web abierta, Firebase no muestra nada: se publica como notificación del sistema.
        Promise.resolve(registration && Notification.permission === "granted"
          ? registration.showNotification(title, { body, icon: "/favicon.svg", badge: "/favicon.svg", data: { ...data, url: "/" } }).then(() => true)
          : false).catch(() => false).then(shown => { if (!shown) showToast(body ? title + " · " + body : title); });
      });
    }
    const ok = await registerPushToken(token, "web");
    window.dispatchEvent(new CustomEvent("viewinvai:push-status", { detail: { enabled:!!ok, registered:!!ok, platform:"web" } }));
    return ok;
  } catch (error) {
    console.warn("Web push registration unavailable", error);
    window.dispatchEvent(new CustomEvent("viewinvai:push-status", { detail: { enabled:false, error:String(error && error.message || error), platform:"web" } }));
    return false;
  }
}

async function ensurePushRegistration(requestPermission = true) {
  return isNativePlatform()
    ? ensureNativePushRegistration(requestPermission)
    : ensureWebPushRegistration(requestPermission);
}

async function loadWebSdk() {
  if (!webSdkPromise) {
    webSdkPromise = Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`)
    ]).then(([appSdk, authSdk]) => {
      const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(FIREBASE_CONFIG);
      webAuth = authSdk.getAuth(app);
      return { appSdk, authSdk, auth: webAuth };
    });
  }
  return webSdkPromise;
}

function initials(user) {
  const name = String(user && (user.displayName || user.name || user.email) || "G").trim();
  if (!name) return "G";
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
}

function normalizeUser(user) {
  if (!user) return null;
  return {
    uid: user.uid || user.id || "",
    displayName: user.displayName || user.name || "",
    email: user.email || "",
    photoUrl: user.photoUrl || user.photoURL || "",
    emailVerified: user.emailVerified !== false
  };
}

function showToast(message, error = false) {
  let el = $("#authToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "authToast";
    el.className = "auth-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  if (toastTimer) clearTimeout(toastTimer);
  el.textContent = String(message || "");
  el.classList.toggle("error", !!error);
  el.classList.add("visible");
  toastTimer = setTimeout(() => el.classList.remove("visible"), 2600);
}

function renderAccount() {
  const button = $("#accountButton");
  const avatar = $("#accountAvatar");
  const name = $("#accountName");
  const email = $("#accountEmail");
  const menuUser = $("#accountMenuUser");
  const signOut = $("#accountSignOut");
  if (!button || !avatar || !name || !email || !menuUser || !signOut) return;

  const user = currentUser;
  avatar.innerHTML = "";
  if (user && user.photoUrl) {
    const img = document.createElement("img");
    img.src = user.photoUrl;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    avatar.appendChild(img);
  } else {
    avatar.textContent = initials(user);
  }

  // Con sesión, el nombre y el correo no se traducen (i18n.js respeta translate="no").
  for (const el of [button, menuUser]) {
    if (user) el.setAttribute("translate", "no"); else el.removeAttribute("translate");
  }
  if (user) {
    name.textContent = user.displayName || "Mi cuenta";
    email.textContent = user.email || "Google";
    menuUser.innerHTML = "<strong>" + escapeHtml(user.displayName || "ViewInvAI") + "</strong><br>" + escapeHtml(user.email || "");
    signOut.hidden = false;
    button.dataset.signedIn = "1";
    button.setAttribute("aria-label", "Abrir cuenta de " + (user.displayName || user.email || "Google"));
  } else {
    name.textContent = "Entrar";
    email.textContent = "Google";
    menuUser.textContent = "Inicia sesión para sincronizar carteras, posiciones, favoritos y análisis.";
    signOut.hidden = true;
    button.dataset.signedIn = "0";
    button.setAttribute("aria-label", "Entrar con Google");
  }
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function setUser(user, { sync = true } = {}) {
  currentUser = normalizeUser(user);
  renderAccount();
  window.dispatchEvent(new CustomEvent("viewinvai:auth-changed", { detail: { user: currentUser } }));
  if (currentUser && sync) {
    syncBackendUser().catch(error => console.warn("Backend account sync failed", error));
  }
}

async function getNativeToken(forceRefresh = false) {
  const plugin = nativeAuthPlugin();
  if (!plugin) throw new Error("Autenticación nativa no disponible en esta APK.");
  const result = await plugin.getIdToken({ forceRefresh: !!forceRefresh });
  return result && result.token ? result.token : "";
}

async function getWebToken(forceRefresh = false) {
  const { auth } = await loadWebSdk();
  const user = auth.currentUser;
  if (!user) return "";
  return user.getIdToken(!!forceRefresh);
}

async function getIdToken(forceRefresh = false) {
  return isNativePlatform() ? getNativeToken(forceRefresh) : getWebToken(forceRefresh);
}

function resolvedApiUrl(path) {
  const raw = String(path || "");
  if (!raw) return raw;
  try {
    if (window.ViewInvAIRuntime && typeof window.ViewInvAIRuntime.url === "function") {
      return window.ViewInvAIRuntime.url(raw);
    }
  } catch (_) {}
  if (isNativePlatform() && raw.startsWith("/api/")) {
    return "https://viewinvai.sonarlab.workers.dev" + raw;
  }
  return raw;
}

async function apiFetch(path, options = {}, retry = true) {
  const token = await getIdToken(false);
  if (!token) throw new Error("Debes iniciar sesión.");
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", "Bearer " + token);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const target = resolvedApiUrl(path);
  const requestOptions = Object.assign({}, options, { headers });
  let response;
  try {
    response = await fetch(target, requestOptions);
  } catch (error) {
    if (!(retry && isNativePlatform() && String(path || "").startsWith("/api/"))) throw error;
    await new Promise(resolve => setTimeout(resolve, 650));
    response = await fetch("https://viewinvai.sonarlab.workers.dev" + String(path), requestOptions);
  }
  if (response.status === 401 && retry) {
    // Sesión caducada (p. ej. tras suspender el equipo): se renueva el token y se repite.
    const fresh = await getIdToken(true).catch(() => "");
    if (fresh) {
      headers.set("Authorization", "Bearer " + fresh);
      response = await fetch(target, Object.assign({}, options, { headers }));
    }
  }
  if (response.status === 503 && retry) {
    // Fallo temporal del servidor (claves de Google o base de datos): un reintento tras una pausa.
    await new Promise(resolve => setTimeout(resolve, 900));
    response = await fetch(target, Object.assign({}, options, { headers }));
  }
  return response;
}

async function syncBackendUser() {
  const response = await apiFetch("/api/me", { method: "GET" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "No se pudo sincronizar la cuenta.");
  }
  const data = await response.json();
  window.dispatchEvent(new CustomEvent("viewinvai:account-ready", { detail: data }));
  ensurePushRegistration(false).catch(error => console.warn("Push setup failed", error));
  return data;
}

function nativeGoogleAuthCancelled(error) {
  const raw = String((error && (error.code || error.message)) || "").toLowerCase();
  return raw.includes("cancel") || raw.includes("12501") || raw.includes("popup-closed");
}

async function nativeGoogleAttempt(plugin, useCredentialManager) {
  const result = await plugin.signInWithGoogle({ useCredentialManager });
  let user = result && result.user ? result.user : null;
  if (!user) {
    const current = await plugin.getCurrentUser();
    user = current && current.user;
  }
  return user || null;
}

async function signInNative() {
  const plugin = nativeAuthPlugin();
  if (!plugin) throw new Error("Esta APK todavía no incluye el módulo de autenticación nativa.");

  // Prefer Android Credential Manager on current devices. If the device/Google
  // Play Services rejects that path, retry with the legacy Google Sign-In API.
  // This also covers the native ApiException/DEVELOPER_ERROR that often reaches
  // Capacitor only as the terse message "10:".
  let lastError = null;
  for (const useCredentialManager of [true, false]) {
    try {
      const user = await nativeGoogleAttempt(plugin, useCredentialManager);
      if (!user) throw new Error("Google no devolvió una sesión válida.");
      setUser(user, { sync: false });
      await syncBackendUser();
      return currentUser;
    } catch (error) {
      if (nativeGoogleAuthCancelled(error)) throw error;
      lastError = error;
      console.warn(
        "Google Android sign-in path failed",
        useCredentialManager ? "credential-manager" : "legacy",
        error
      );
    }
  }

  const raw = String(lastError && lastError.message || "");
  if (/^10\s*:/.test(raw) || String(lastError && lastError.code || "") === "10") {
    const error = new Error("Google Android no aceptó la configuración OAuth de esta instalación (error 10).");
    error.code = "10";
    throw error;
  }
  throw lastError || new Error("No se pudo iniciar sesión con Google.");
}

async function signInWeb() {
  const { authSdk, auth } = await loadWebSdk();
  const provider = new authSdk.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await authSdk.signInWithPopup(auth, provider);
  setUser(result.user, { sync: false });
  await syncBackendUser();
  return currentUser;
}

async function signIn() {
  if (busy) return;
  busy = true;
  try {
    const user = isNativePlatform() ? await signInNative() : await signInWeb();
    if (user) showToast("Sesión iniciada · " + (user.displayName || user.email || "Google"));
    closeAccountMenu();
  } catch (error) {
    console.warn("Google sign-in failed", error);
    const code = String(error && error.code || "");
    const native = isNativePlatform();
    if (code.includes("unauthorized-domain")) {
      showToast("Falta autorizar este dominio en Firebase Authentication.", true);
    } else if (!code.includes("popup-closed-by-user") && !code.includes("cancel")) {
      const message = error && error.message ? error.message : "No se pudo iniciar sesión con Google.";
      const detail = native ? "Google Android" + (code ? " · " + code : "") + " · " + message : message;
      window.__viewInvAIAuthLastError = { code, message, native, at: new Date().toISOString() };
      showToast(detail, true);
    }
  } finally {
    busy = false;
  }
}

async function signOutAccount() {
  if (busy) return;
  busy = true;
  try {
    if (isNativePlatform()) {
      const plugin = nativeAuthPlugin();
      if (plugin) await plugin.signOut();
    } else {
      const { authSdk, auth } = await loadWebSdk();
      await authSdk.signOut(auth);
    }
    try {
      if (isNativePlatform()) {
        const messaging = nativeMessagingPlugin();
        if (messaging) await messaging.deleteToken();
      } else if (webMessaging) {
        const { messagingSdk, messaging } = await loadWebMessagingSdk();
        await messagingSdk.deleteToken(messaging);
      }
    } catch (_) {}
    lastRegisteredPushToken = "";
    setUser(null, { sync: false });
    closeAccountMenu();
    showToast("Sesión cerrada");
  } catch (error) {
    console.warn("Sign out failed", error);
    showToast("No se pudo cerrar la sesión.", true);
  } finally {
    busy = false;
  }
}

function closeAccountMenu() {
  const menu = $("#accountMenu");
  const button = $("#accountButton");
  if (menu) {
    menu.classList.remove("open");
    menu.setAttribute("aria-hidden", "true");
  }
  if (button) button.setAttribute("aria-expanded", "false");
}

function toggleAccountMenu() {
  const menu = $("#accountMenu");
  const button = $("#accountButton");
  if (!menu || !button) return;
  const open = !menu.classList.contains("open");
  menu.classList.toggle("open", open);
  menu.setAttribute("aria-hidden", open ? "false" : "true");
  button.setAttribute("aria-expanded", open ? "true" : "false");
}

async function initializeNative() {
  bindPushLifecycle();
  const plugin = nativeAuthPlugin();
  if (!plugin) {
    setUser(null, { sync: false });
    return;
  }
  try {
    const result = await plugin.getCurrentUser();
    setUser(result && result.user ? result.user : null);
  } catch (_) {
    setUser(null, { sync: false });
  }
}

async function initializeWeb() {
  try {
    const { authSdk, auth } = await loadWebSdk();
    authSdk.onAuthStateChanged(auth, user => setUser(user));
  } catch (error) {
    console.warn("Firebase web initialization failed", error);
    setUser(null, { sync: false });
  }
}

function bindUi() {
  $("#accountButton")?.addEventListener("click", event => {
    event.stopPropagation();
    if (!currentUser) {
      signIn();
      return;
    }
    toggleAccountMenu();
  });
  $("#accountSignOut")?.addEventListener("click", signOutAccount);
  document.addEventListener("click", event => {
    if (!event.target.closest?.("#accountArea")) closeAccountMenu();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeAccountMenu();
  });
}

window.ViewInvAIAuth = {
  signIn,
  signOut: signOutAccount,
  getUser: () => currentUser,
  getIdToken,
  apiFetch,
  syncBackendUser,
  ensurePushRegistration,
  hasNativeMessaging: () => !!nativeMessagingPlugin(),
  hasWebPush: () => !isNativePlatform() && 'serviceWorker' in navigator && 'Notification' in window,
  isNative: isNativePlatform
};

bindUi();
renderAccount();
if (isNativePlatform()) initializeNative();
else initializeWeb();
