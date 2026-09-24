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
let webAuth = null;
let currentUser = null;
let toastTimer = null;
let busy = false;

const $ = selector => document.querySelector(selector);

function isNativePlatform() {
  try {
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

async function apiFetch(path, options = {}, retry = true) {
  const token = await getIdToken(false);
  if (!token) throw new Error("Debes iniciar sesión.");
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", "Bearer " + token);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response = await fetch(path, Object.assign({}, options, { headers }));
  if (response.status === 401 && retry) {
    const fresh = await getIdToken(true);
    if (fresh) {
      headers.set("Authorization", "Bearer " + fresh);
      response = await fetch(path, Object.assign({}, options, { headers }));
    }
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
  return data;
}

async function signInNative() {
  const plugin = nativeAuthPlugin();
  if (!plugin) throw new Error("Esta APK todavía no incluye el módulo de autenticación nativa.");
  const result = await plugin.signInWithGoogle({ useCredentialManager: true });
  let user = result && result.user ? result.user : null;
  if (!user) {
    const current = await plugin.getCurrentUser();
    user = current && current.user;
  }
  if (!user) throw new Error("Google no devolvió una sesión válida.");
  setUser(user, { sync: false });
  await syncBackendUser();
  return currentUser;
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
    if (code.includes("unauthorized-domain")) {
      showToast("Falta autorizar este dominio en Firebase Authentication.", true);
    } else if (!code.includes("popup-closed-by-user") && !code.includes("cancel")) {
      showToast(error && error.message ? error.message : "No se pudo iniciar sesión con Google.", true);
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
  isNative: isNativePlatform
};

bindUi();
renderAccount();
if (isNativePlatform()) initializeNative();
else initializeWeb();
